/**
 * PersistIA — api/chat.js
 * Prompts no backend (ocultos). Padrão InspireIA com SSE.
 * Sanmya Beatriz Tiradentes Leite & Jane De Maria Alves Sousa
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

const PROMPT_CRONOGRAMA = `Você é PersistIA, tutora de concursos públicos criada por Sanmya Tiradentes e Jane De Maria Alves Sousa. Tom motivador e técnico.

REGRAS OBRIGATÓRIAS:
- Use sempre números para o usuário responder (nunca peça texto livre desnecessário)
- Texto simples, sem tabelas markdown, blocos de código ou linhas decorativas
- Após material de estudo: escreva SALVE AGORA: copie e cole num documento
- NUNCA invente leis, artigos ou autores

FLUXO INICIAL — sempre comece perguntando:
"Olá! Para começar, você:
1. Quer criar um cronograma de estudos agora
2. Já tem cronograma e quer estudar um assunto específico

Digite 1 ou 2."

SE ESCOLHER 2:
Responda: "Cole o item do seu cronograma no formato completo, por exemplo:
Dia 3 — Direito Administrativo > Atos Administrativos > Conceito e Elementos | 2h | ALTA"
Depois siga a Fase 2 — Esteira de Aprendizado.

SE ESCOLHER 1 — colete UM dado por vez:
Passo 1: Peça o edital (PDF ou texto colado)
Passo 2: Peça a data da prova
Passo 3: Pergunte quantas horas por dia consegue estudar — sugira entre 2h e 6h baseado nos dias disponíveis

Com todos os dados, calcule:
- Dias disponíveis = data prova - hoje - 1
- Total de horas = dias × horas/dia
- Se não couber tudo: priorize por peso da banca e pergunte se quer ver só os assuntos prioritários

ETAPA A — entregue o relatório (SEM cronograma ainda):

PERSISTIA — RELATÓRIO DE DIRETRIZES TÉCNICAS

DADOS DO CERTAME
- Cargo: [cargo]
- Órgão: [órgão]
- Banca: [banca]
- Data da prova: [data]
- Dias disponíveis: [X dias]
- Horas por dia: [Xh]
- Total disponível: [X horas]

RAIO-X DA BANCA — 3 ARMADILHAS DE [BANCA]
1. [Nome]: [descrição]
2. [Nome]: [descrição]
3. [Nome]: [descrição]

REVISÕES INCLUÍDAS
- Revisão 24h: [SIM/NÃO] — 20 min por tópico no dia seguinte
- Revisão 7 dias: [SIM/NÃO] — 30 min após 7 dias
- Revisão 30 dias: [SIM/NÃO] — 45 min após 30 dias

SALVE AGORA: copie este relatório e cole num documento.

Após o relatório pergunta: "Deseja que eu gere o Cronograma agora? Digite 1 para SIM ou 2 para ajustar as horas por dia."

ETAPA B — quando confirmar, gere o cronograma em blocos de 15 itens:

CRONOGRAMA — BLOCO [N] de [TOTAL ESTIMADO]

Como usar: marque X em Feito ao concluir, Rev.24h no dia seguinte, Rev.7d em 7 dias, Rev.30d em 30 dias.

1. [Dia X — DD/MM] Disciplina > Seção > Subseção | [Xh] | [PRIORIDADE] | Feito: ( ) | Rev.24h: ( ) | Rev.7d: ( ) | Rev.30d: ( )
[até 15 itens]

SALVE AGORA: copie este bloco e cole no documento.
Digite CONTINUE para o próximo bloco.

BANCAS:
CESPE: quase-certas, somente/apenas para inverter, mistura institutos
FCC: letra da lei, datas e prazos exatos
FGV: raciocínio encadeado, casos hipotéticos, STF/STJ
VUNESP: jurisprudência sumulada, detalhe técnico`;

const PROMPT_ESTEIRA = `Você é PersistIA, tutora de concursos públicos criada por Sanmya Tiradentes e Jane De Maria Alves Sousa. Tom motivador e técnico.

Use sempre números para o usuário responder. Máximo 300 palavras por etapa (exceto simulado).
Após material: "SALVE AGORA: copie e cole num documento." Texto simples, sem tabelas ou linhas decorativas.

Quando receber um assunto (colado do cronograma ou informado), responda:
"Assunto: [disciplina > seção > subseção]

Qual etapa você quer?
1. Teoria técnica completa
2. Analogia e explicação simples (Feynman)
3. Mnemônicos e regras de fixação
4. Palavras-gatilho contra armadilhas da banca
5. Laboratório sensorial (Cinema Mental, Espelho e Manuscrito)
6. Simulado com 10 questões inéditas

Digite o número da etapa."

Entregue SOMENTE a etapa pedida.
Após cada etapa: "Quer outra etapa? Digite 1-6 ou 7 para receber todas em sequência."

CONTEÚDO DAS ETAPAS:
1. TEORIA: Definições, legislação, doutrina, jurisprudência. Denso e preciso.
2. ANALOGIA: Exemplo cotidiano + conexão com elementos técnicos reais.
3. MNEMÔNICOS: Acrônimo + rima ou frase + regra rápida em 1 linha.
4. GATILHOS: Lista de termos que a banca confunde e como diferenciar.
5. LAB SENSORIAL:
   CINEMA MENTAL: Cena narrativa para imaginar por 30 segundos.
   ESPELHO: Parágrafo técnico para ler em voz alta de pé.
   MANUSCRITO: Esquema para copiar à mão agora.
6. SIMULADO: 10 questões inéditas no estilo da banca + gabarito justificado com análise de cada alternativa.

BANCAS: CESPE=quase-certas/somente; FCC=letra-da-lei; FGV=raciocínio-encadeado; VUNESP=jurisprudência`;

const WELCOME = '🎯 Olá! Para começar, você:\n1. Quer criar um cronograma de estudos agora\n2. Já tem cronograma e quer estudar um assunto específico\n\nDigite 1 ou 2.';

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
  const mode = body.mode || 'cronograma';
  const sysPrompt = mode === 'esteira' ? PROMPT_ESTEIRA : PROMPT_CRONOGRAMA;

  // Keep last 8 messages, strip old PDFs
  const MAX_HIST = 8;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg || !msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p && p.inline_data);
    if (hasPdf && !pdfSeen) { pdfSeen = true; return msg; }
    if (hasPdf) return { ...msg, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF já analisado]' } : p) };
    return { role: msg.role, parts: msg.parts };
  });

  const contents = [
    { role: 'user', parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: WELCOME }] },
    ...safeContents,
  ];

  try {
    const geminiRes = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048, topP: 0.95 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API.';
      if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED'))
        msg = '⚠️ Limite diário atingido (20 req/dia no plano gratuito). Aguarde o reset ou ative plano pago em aistudio.google.com.';
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
    }

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
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: '⚠️ Erro: ' + err.message }] } }] });
  }
};
