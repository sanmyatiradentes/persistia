/**
 * PersistIA — api/chat.js
 * Padrão idêntico ao InspireIA que funciona
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

const SYSTEM_PROMPT = `Você é PersistIA, tutora de concursos. Tom motivador e técnico.

REGRAS:
- Máximo 250 palavras por resposta
- NUNCA gere cronograma sem o candidato digitar SIM
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

FASE 1B — quando disser SIM, 10 itens:

CRONOGRAMA — BLOCO [N]
Como usar: marque (X) em Feito, Rev.24h, Rev.7d.

1. [Disciplina] - [Seção] - [Subseção] | [Xh] | [PRIORIDADE] | Feito: ( ) | Rev.24h: ( ) | Rev.7d: ( )
[PARE em 10. Escreva: "Digite CONTINUE para os próximos."]

SALVE AGORA.

FASE 2 — quando informar assunto específico:
Pergunte qual etapa: 1.Teoria 2.Analogia 3.Mnemônicos 4.Gatilhos 5.Lab.Sensorial 6.Simulado
Entregue só a etapa pedida. Máximo 250 palavras (exceto simulado).

BANCAS: CESPE=quase-certas; FCC=letra-da-lei; FGV=raciocínio-encadeado; VUNESP=jurisprudência`;

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
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Body inválido' }); }
  }

  const userContents = Array.isArray(body.contents) ? body.contents : [];

  // Manter só últimas 8 mensagens para evitar payload gigante
  const MAX_HIST = 8;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;

  // Strip PDF de mensagens antigas
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p.inline_data);
    if (hasPdf && !pdfSeen) { pdfSeen = true; return msg; }
    return { ...msg, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF já analisado]' } : p) };
  });

  const contents = [
    { role: 'user',  parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: '🎯 Olá! Seja bem-vindo(a) à PersistIA! Informe: cargo, banca, data da prova e conteúdo programático — ou anexe o PDF do edital. 💪' }] },
    ...safeContents,
  ];

  try {
    const geminiRes = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500, topP: 0.95 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API. Tente novamente.';
      if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED'))
        msg = '⚠️ Limite diário atingido (20 req/dia no plano gratuito). Aguarde o reset ou ative plano pago em aistudio.google.com.';
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
    }

    // Consume SSE stream and accumulate full text
    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) fullText += text;
        } catch(e) {}
      }
    }

    return res.status(200).json({
      candidates: [{ content: { parts: [{ text: fullText || '⚠️ Sem resposta. Tente novamente.' }], role: 'model' }, finishReason: 'STOP' }]
    });

  } catch (err) {
    let msg = '⚠️ Erro de conexão. Tente novamente.';
    if (err.message?.includes('429') || err.message?.includes('quota'))
      msg = '⚠️ Limite diário atingido. Aguarde o reset ou ative plano pago em aistudio.google.com.';
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
  }
};
