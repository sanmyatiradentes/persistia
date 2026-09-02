// Pagamento avulso — a porta de entrada de quem não tem cartão de crédito.
//
// A assinatura recorrente do Mercado Pago só funciona em cartão de crédito. Aqui
// o aluno compra um período fechado (1, 3, 6 ou 12 meses) por Pix, boleto, cartão
// de crédito à vista ou parcelado, ou saldo do Mercado Pago. Não há cobrança
// automática depois: o acesso simplesmente vale até a data comprada, e o aluno
// volta e compra de novo quando quiser.
//
// GET                      → os pacotes disponíveis e a situação do acesso
// POST {meses: 3}          → cria a cobrança e devolve o link de pagamento
// POST {conferir: true}    → procura no Mercado Pago um pagamento aprovado deste
//                            aluno e credita na hora (rede de segurança do webhook)
const {
  getDb, ensureSchema, agora, alunoDoToken, cors,
  acessoDoAluno, pacotesAvulsos, pacotePorMeses, creditarAcesso, PRECO
} = require('./_lib');

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

function rotulo(meses) {
  if (meses === 1) return 'PersisteIA — 1 mês de acesso';
  if (meses === 12) return 'PersisteIA — 1 ano de acesso';
  return 'PersisteIA — ' + meses + ' meses de acesso';
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    const pacotes = pacotesAvulsos().map(p => {
      const cheio = PRECO * p.meses;
      const economia = Math.max(0, Math.round((cheio - p.valor) * 100) / 100);
      return Object.assign({}, p, {
        rotulo: rotulo(p.meses),
        por_mes: Math.round((p.valor / p.meses) * 100) / 100,
        economia,
        desconto: cheio > 0 ? Math.round(100 * economia / cheio) : 0,
        cheio: Math.round(cheio * 100) / 100
      });
    });

    if (req.method === 'GET') {
      const acesso = await acessoDoAluno(aluno);
      return res.status(200).json({ pacotes, acesso, preco_mensal: PRECO });
    }

    const body = req.body || {};

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(503).json({ erro: 'O pagamento ainda está sendo configurado. Fale com a gente pelo WhatsApp que liberamos seu acesso.' });
    }

    // ----- procura um pagamento aprovado que ainda não creditou -----
    if (body.conferir) {
      const busca = await mp('/v1/payments/search?sort=date_created&criteria=desc&limit=10' +
        '&external_reference=' + encodeURIComponent(aluno.id));
      const achados = (busca && busca.results) || [];
      let creditou = null;
      for (const pg of achados) {
        if (pg.status !== 'approved') continue;
        const meses = Number(String(pg.metadata && pg.metadata.meses || '').trim())
          || Number(String(pg.additional_info && pg.additional_info.items && pg.additional_info.items[0] && pg.additional_info.items[0].quantity || 0));
        if (!meses) continue;
        const r = await creditarAcesso(pg.id, aluno.id, meses, pg.transaction_amount, pg.payment_method_id);
        if (r.creditado) { creditou = r; break; }
      }
      const acesso = await acessoDoAluno(aluno);
      return res.status(200).json(Object.assign({}, acesso, {
        pacotes, creditado: !!creditou,
        pendente: achados.some(p => p.status === 'pending' || p.status === 'in_process')
      }));
    }

    // ----- cria a cobrança -----
    const meses = Number(body.meses);
    const pacote = pacotePorMeses(meses);
    if (!pacote) return res.status(400).json({ erro: 'Escolha um dos períodos disponíveis' });

    const base = siteUrl(req);
    const pref = await mp('/checkout/preferences', 'POST', {
      items: [{
        title: rotulo(pacote.meses),
        description: 'Acesso completo à PersisteIA por ' + pacote.meses + (pacote.meses === 1 ? ' mês' : ' meses') + ', sem renovação automática.',
        quantity: 1,
        unit_price: pacote.valor,
        currency_id: 'BRL'
      }],
      payer: { email: aluno.email, name: aluno.nome || undefined },
      // é isto que liga o pagamento ao aluno quando o aviso chegar
      external_reference: aluno.id,
      metadata: { aluno_id: aluno.id, meses: pacote.meses },
      statement_descriptor: 'PERSISTEIA',
      back_urls: {
        success: base + '/?pagamento=ok',
        pending: base + '/?pagamento=pendente',
        failure: base + '/?pagamento=falhou'
      },
      auto_return: 'approved',
      notification_url: base + '/api/mp-webhook',
      // sem exclusões: Pix, boleto, cartão de crédito e débito, saldo — tudo vale
      payment_methods: { installments: 12 },
      expires: false
    });

    await db.execute({
      sql: `UPDATE assinaturas SET atualizado_em = ? WHERE aluno_id = ?`,
      args: [agora(), aluno.id]
    });

    return res.status(200).json({
      ok: true,
      checkout: pref.init_point || pref.sandbox_init_point,
      preference_id: pref.id,
      meses: pacote.meses,
      valor: pacote.valor
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao abrir o pagamento', detalhe: String(e).slice(0, 220) });
  }
};
