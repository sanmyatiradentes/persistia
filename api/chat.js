/**
 * PersistIA — api/chat.js
 * Sanmya Beatriz Tiradentes Leite & Jane De Maria Alves Sousa
 * IMPORTANTE: Use generateContent (SEM streaming) para evitar timeout no Vercel gratuito
 */

// generateContent (síncrono) — mais confiável no Vercel free (timeout 10s)
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `Você é PersistIA, tutora de concursos. Tom motivador e técnico.

REGRAS CRÍTICAS:
- Máximo 200 palavras por resposta
- NUNCA gere cronograma sem o candidato pedir SIM
- Cronograma: máximo 10 itens, PARE e escreva "Digite CONTINUE"
- Após material: escreva "SALVE AGORA."
- Texto simples, sem tabelas ou linhas decorativas

FASE 1 — quando tiver Cargo+Banca+Data+Edital, entregue:

PERSISTIA — RELATÓRIO DE DIRETRIZES TÉCNICAS

DADOS DO CERTAME
- Cargo: [cargo]
- Órgão: [órgão]
- Banca: [banca]
- Data: [data]
- Dias: [X dias]

RAIO-X — 3 ARMADILHAS DE [BANCA]
1. [Nome]: [1 linha]
2. [Nome]: [1 linha]
3. [Nome]: [1 linha]

METODOLOGIA
- Matutino: teoria + Fase 2
- Vespertino: simulado + revisão

SALVE AGORA.
Deseja o Cronograma? Digite SIM.

FASE 1B — quando disser SIM, gere 10 itens:

CRONOGRAMA — BLOCO [N]
Como usar: marque (X) em Feito, Rev.24h, Rev.7d.

1. [Disciplina] - [Seção] - [Subseção] | [Xh] | [ALTA/MÉDIA/BAIXA] | Feito: ( ) | Rev.24h: ( ) | Rev.7d: ( )
[PARE em 10. Escreva: "Digite CONTINUE para os próximos."]

SALVE AGORA.

FASE 2 — quando informar assunto específico:
Pergunte qual etapa: 1.Teoria 2.Analogia 3.Mnemônicos 4.Gatilhos 5.Lab.Sensorial 6.Simulado
Entregue só a etapa pedida. Máximo 200 palavras (exceto simulado).

BANCAS: CESPE=quase-certas/somente; FCC=letra-da-lei; FGV=raciocínio-encadeado; VUNESP=jurisprudência`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Body inválido' });
    }
  }

  const userContents = Array.isArray(body.contents) ? body.contents : [];

  // Strip PDF de TODAS as mensagens exceto a primeira que contém PDF
  // Isso reduz drasticamente o tamanho do payload nas mensagens seguintes
  let pdfSeen = false;
  const safeContents = userContents.map((msg) => {
    if (!msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p.inline_data);
    if (hasPdf && !pdfSeen) {
      pdfSeen = true;
      return msg; // Mantém o PDF na primeira ocorrência
    }
    return {
      ...msg,
      parts: msg.parts.map(p => p.inline_data ? { text: '[PDF do edital enviado anteriormente — conteúdo já analisado]' } : p)
    };
  });

  // Manter apenas as últimas 8 mensagens para evitar payload gigante
  // O PDF já foi analisado — não precisamos do histórico completo para CONTINUE
  const MAX_HISTORY = 8;
  const trimmedContents = safeContents.length > MAX_HISTORY
    ? safeContents.slice(-MAX_HISTORY)
    : safeContents;

  const contents = [
    { role: 'user',  parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: '🎯 Olá! Seja bem-vindo(a) à PersistIA! Estou aqui para transformar seu edital em aprovação. 💪 Informe: cargo, banca, data da prova e conteúdo programático — ou anexe o PDF do edital.' }] },
    ...trimmedContents,
  ];

  const endpoint = `${GEMINI_URL}?key=${apiKey}`;

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800,
          topP: 0.95,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API. Tente novamente.';
      if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED'))
        msg = '⚠️ Limite diário atingido (plano gratuito: 20 req/dia). Aguarde o reset ou ative um plano pago em aistudio.google.com.';
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Sem resposta. Tente novamente.';

    return res.status(200).json({
      candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }]
    });

  } catch (err) {
    let msg = '⚠️ Erro de conexão. Tente novamente.';
    if (err.message?.includes('429') || err.message?.includes('quota'))
      msg = '⚠️ Limite diário atingido. Aguarde o reset ou ative um plano pago em aistudio.google.com.';
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
  }
};
