// Assinatura do PersisteIA — 7 dias de teste sem cartão e, depois, mensalidade
// recorrente pelo Mercado Pago (modelo "preapproval" com checkout hospedado).
// GET                    → estado do acesso do aluno
// POST {assinar:true}    → cria a assinatura e devolve o link de checkout
// POST {cancelar:true}   → cancela a assinatura no Mercado Pago
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, PRECO, TRIAL_DIAS } = require('./_lib');

const MP = 'https://api.mercadopago.com';

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'persisteia.com.br';
  return 'https://' + host;
}

async function mp(caminho, metodo, corpo) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurada');
  const r = await fetch(MP + caminho, {
    method: metodo || 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await r.text();
  let dados = null; try { dados = JSON.parse(texto); } catch (_) {}
  if (!r.ok) throw new Error('Mercado Pago ' + r.status + ': ' + texto.slice(0, 220));
  return dados;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const acesso = await acessoDoAluno(aluno);
      return res.status(200).json({ ...acesso, preco: PRECO, dias_teste: TRIAL_DIAS });
    }

    const body = req.body || {};

    if (body.assinar) {
      const acesso = await acessoDoAluno(aluno);
      if (acesso.estado === 'ativa') return res.status(200).json({ ja_assinante: true });

      const volta = siteUrl(req) + '/?assinatura=ok';
      const assinatura = await mp('/preapproval', 'POST', {
        reason: 'PersisteIA — assinatura mensal',
        external_reference: aluno.id,
        payer_email: aluno.email,
        back_url: volta,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: PRECO,
          currency_id: 'BRL'
        }
      });

      await db.execute({
        sql: `UPDATE assinaturas SET preapproval_id = ?, valor = ?, atualizado_em = ? WHERE aluno_id = ?`,
        args: [assinatura.id, PRECO, agora(), aluno.id]
      });

      return res.status(200).json({ ok: true, checkout: assinatura.init_point, preapproval_id: assinatura.id });
    }

    if (body.cancelar) {
      const r = await db.execute({ sql: 'SELECT preapproval_id FROM assinaturas WHERE aluno_id = ?', args: [aluno.id] });
      const pid = (r.rows[0] || {}).preapproval_id;
      if (!pid) return res.status(400).json({ erro: 'Você não tem assinatura ativa' });
      await mp('/preapproval/' + pid, 'PUT', { status: 'cancelled' });
      await db.execute({
        sql: `UPDATE assinaturas SET estado = 'cancelada', atualizado_em = ? WHERE aluno_id = ?`,
        args: [agora(), aluno.id]
      });
      return res.status(200).json({ ok: true });
    }

    // Sincroniza o estado com o Mercado Pago (usado ao voltar do checkout).
    if (body.conferir) {
      const r = await db.execute({ sql: 'SELECT preapproval_id FROM assinaturas WHERE aluno_id = ?', args: [aluno.id] });
      const pid = (r.rows[0] || {}).preapproval_id;
      if (!pid) return res.status(200).json({ ...(await acessoDoAluno(aluno)) });
      const info = await mp('/preapproval/' + pid);
      const ativa = info.status === 'authorized';
      await db.execute({
        sql: `UPDATE assinaturas SET estado = ?, proxima_cobranca = ?, atualizado_em = ? WHERE aluno_id = ?`,
        args: [ativa ? 'ativa' : 'pendente', info.next_payment_date || null, agora(), aluno.id]
      });
      return res.status(200).json({ ...(await acessoDoAluno(aluno)), status_mp: info.status });
    }

    return res.status(400).json({ erro: 'Ação não reconhecida' });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha na assinatura', detalhe: String(e).slice(0, 220) });
  }
};
