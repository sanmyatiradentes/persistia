// Mercado Pago — regras compartilhadas entre o aviso (mp-webhook) e o Painel.
// Toda decisão sai do que a API do Mercado Pago responde com o nosso token,
// nunca do que veio escrito no aviso.
const { agora, creditarAcesso, emailDeCompra, dataBr } = require('./_lib');

const MP = 'https://api.mercadopago.com';

async function mpGet(caminho) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurada');
  const r = await fetch(MP + caminho, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('MP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function aplicarAssinatura(db, preapprovalId, infoPronta) {
  const info = infoPronta || await mpGet('/preapproval/' + preapprovalId);
  const alunoId = info.external_reference;
  if (!alunoId) return;
  const ativa = info.status === 'authorized';
  const estado = ativa ? 'ativa' : (info.status === 'paused' ? 'pausada' : (info.status === 'pending' ? 'pendente' : 'cancelada'));
  const antes = (await db.execute({ sql: 'SELECT estado FROM assinaturas WHERE aluno_id = ?', args: [alunoId] })).rows[0];
  // Ao cancelar, o MP devolve next_payment_date vazio. Guardamos a data que já
  // tínhamos para o aluno seguir até o fim do mês que ele pagou.
  await db.execute({
    sql: `UPDATE assinaturas SET estado = ?, preapproval_id = ?,
                 proxima_cobranca = COALESCE(?, proxima_cobranca), atualizado_em = ?
          WHERE aluno_id = ?`,
    args: [estado, String(preapprovalId), info.next_payment_date || null, agora(), alunoId]
  });
  // só na passagem para ativa: os avisos e a conferência do Painel se repetem
  if (antes && ativa && antes.estado !== 'ativa') await emailDeAssinatura(alunoId, info);
}

function emailDeAssinatura(alunoId, info) {
  const prox = dataBr(info.next_payment_date);
  return emailDeCompra(alunoId, {
    assunto: 'Assinatura confirmada: seu acesso à PersisteIA está liberado',
    titulo: 'Assinatura confirmada',
    detalhe: 'A sua assinatura mensal está ativa e o acesso está liberado.' + (prox ? ` A próxima cobrança será em <b>${prox}</b>.` : '') + ' Você pode cancelar quando quiser em Plano › Minha conta.'
  });
}

// Pagamento avulso aprovado → credita os meses comprados, uma única vez.
// O Pix avisa em segundos; o boleto, em dias. Os dois passam por aqui.
async function creditarPagamento(dataId, tipo) {
  let pagamentos = [];
  if (tipo === 'merchant_order') {
    const ordem = await mpGet('/merchant_orders/' + dataId);
    pagamentos = ((ordem && ordem.payments) || []).map(p => String(p.id));
  } else {
    pagamentos = [dataId];
  }
  for (const id of pagamentos) {
    const pg = await mpGet('/v1/payments/' + id);
    if (!pg || pg.status !== 'approved') continue;
    const alunoId = pg.external_reference || (pg.metadata && pg.metadata.aluno_id);
    const meses = Number((pg.metadata && pg.metadata.meses) || 0);
    if (!alunoId || !meses) continue;
    await creditarAcesso(pg.id, String(alunoId), meses, pg.transaction_amount, pg.payment_method_id);
  }
}

// Confere direto no Mercado Pago o que foi pago nos últimos 90 dias. Pega o que
// se perdeu no caminho (aviso recusado, fora do ar) sem ninguém precisar agir:
// creditar duas vezes não acontece, porque cada pagamento só credita uma vez.
async function conferirMercadoPago(db) {
  const creditados = [], semAluno = [];
  const busca = await mpGet('/v1/payments/search?sort=date_created&criteria=desc&limit=50' +
    '&status=approved&range=date_created&begin_date=NOW-90DAYS&end_date=NOW');
  for (const pg of (busca.results || [])) {
    const alunoId = String(pg.external_reference || (pg.metadata && pg.metadata.aluno_id) || '');
    const existe = alunoId && (await db.execute({ sql: 'SELECT id FROM alunos WHERE id = ?', args: [alunoId] })).rows.length;
    if (!existe) {
      semAluno.push({ id: String(pg.id), valor: pg.transaction_amount, meio: pg.payment_method_id, data: pg.date_approved || pg.date_created });
      continue;
    }
    const meses = Number((pg.metadata && pg.metadata.meses) || 0);
    if (meses) {
      const r = await creditarAcesso(pg.id, alunoId, meses, pg.transaction_amount, pg.payment_method_id);
      if (r.creditado) creditados.push(String(pg.id));
    } else {
      // mensalidade da assinatura: só registra; o acesso vem do estado da assinatura
      await db.execute({
        sql: 'INSERT OR IGNORE INTO pagamentos (id, aluno_id, meses, valor, meio, status, criado_em) VALUES (?,?,?,?,?,?,?)',
        args: [String(pg.id), alunoId, null, Number(pg.transaction_amount) || null, pg.payment_method_id || null, 'aprovado', pg.date_approved || agora()]
      });
    }
  }
  const pre = await mpGet('/preapproval/search?status=authorized&limit=50');
  for (const info of (pre.results || [])) await aplicarAssinatura(db, info.id, info);
  return { creditados, sem_aluno: semAluno };
}

module.exports = { mpGet, emailDeAssinatura, aplicarAssinatura, creditarPagamento, conferirMercadoPago };
