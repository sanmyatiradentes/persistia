// Aviso do Mercado Pago (webhook). Só confia no que a própria API confirma:
// recebe o id da notificação, consulta o recurso e atualiza a assinatura.
// Configure em "Suas integrações" → Webhooks: https://SEUSITE/api/mp-webhook
// Tópicos: subscription_preapproval e subscription_authorized_payment.
const crypto = require('crypto');
const { getDb, ensureSchema, cors } = require('./_lib');
const { mpGet, aplicarAssinatura, creditarPagamento } = require('./_mp');

// Assinatura HMAC do cabeçalho x-signature (quando a secret está configurada).
function assinaturaValida(req, dataId) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true; // sem secret configurada, não dá para validar
  try {
    const cab = String(req.headers['x-signature'] || '');
    const partes = Object.fromEntries(cab.split(',').map(p => p.split('=').map(x => x.trim())));
    const manifesto = `id:${dataId};request-id:${req.headers['x-request-id'] || ''};ts:${partes.ts};`;
    const hash = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
    return hash === partes.v1;
  } catch (_) { return false; }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  // O Mercado Pago espera 200 rápido; erro nosso não deve virar reenvio infinito.
  try {
    await ensureSchema();
    const db = getDb();
    const q = new URL(req.url, 'http://x').searchParams;
    const body = req.body || {};
    const tipo = body.type || body.topic || q.get('type') || q.get('topic') || '';
    const dataId = (body.data && body.data.id) || body.id || q.get('data.id') || q.get('id');

    if (!dataId) return res.status(200).json({ ok: true, ignorado: 'sem id' });
    // Assinatura que não confere fica só registrada, sem recusar o aviso. Recusar
    // perdia pagamento de verdade (o segredo pode estar desatualizado), e não
    // protege nada: um aviso falso só faria consultar o Mercado Pago, que é quem
    // diz se houve pagamento.
    if (!assinaturaValida(req, q.get('data.id') || dataId)) console.warn('mp-webhook: assinatura não confere', tipo, dataId);

    if (tipo.indexOf('subscription_preapproval') === 0 || tipo === 'preapproval') {
      await aplicarAssinatura(db, String(dataId));
    } else if (tipo === 'subscription_authorized_payment') {
      const pag = await mpGet('/authorized_payments/' + dataId);
      if (pag && pag.preapproval_id) await aplicarAssinatura(db, String(pag.preapproval_id));
    } else if (tipo === 'payment' || tipo === 'merchant_order') {
      // pagamento avulso (Pix, boleto, cartão): credita o período comprado
      await creditarPagamento(String(dataId), tipo);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('mp-webhook: falha', String(e).slice(0, 300));
    return res.status(200).json({ ok: false, detalhe: String(e).slice(0, 200) });
  }
};
