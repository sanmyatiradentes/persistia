// Aviso do Mercado Pago (webhook). Só confia no que a própria API confirma:
// recebe o id da notificação, consulta o recurso e atualiza a assinatura.
// Configure em "Suas integrações" → Webhooks: https://SEUSITE/api/mp-webhook
// Tópicos: subscription_preapproval e subscription_authorized_payment.
const crypto = require('crypto');
const { getDb, ensureSchema, agora, cors } = require('./_lib');

const MP = 'https://api.mercadopago.com';

async function mpGet(caminho) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurada');
  const r = await fetch(MP + caminho, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('MP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

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

async function aplicar(db, preapprovalId) {
  const info = await mpGet('/preapproval/' + preapprovalId);
  const alunoId = info.external_reference;
  if (!alunoId) return;
  const ativa = info.status === 'authorized';
  const estado = ativa ? 'ativa' : (info.status === 'paused' ? 'pausada' : (info.status === 'pending' ? 'pendente' : 'cancelada'));
  await db.execute({
    sql: `UPDATE assinaturas SET estado = ?, preapproval_id = ?, proxima_cobranca = ?, atualizado_em = ?
          WHERE aluno_id = ?`,
    args: [estado, preapprovalId, info.next_payment_date || null, agora(), alunoId]
  });
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
    if (!assinaturaValida(req, dataId)) return res.status(401).json({ erro: 'assinatura inválida' });

    if (tipo.indexOf('subscription_preapproval') === 0 || tipo === 'preapproval') {
      await aplicar(db, String(dataId));
    } else if (tipo === 'subscription_authorized_payment') {
      const pag = await mpGet('/authorized_payments/' + dataId);
      if (pag && pag.preapproval_id) await aplicar(db, String(pag.preapproval_id));
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, detalhe: String(e).slice(0, 200) });
  }
};
