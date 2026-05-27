/**
 * PersistIA — api/chat.js
 * Gemini 2.5 Flash-Lite para cronograma, Flash para esteira
 */

const GEMINI_LITE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse';
const GEMINI_FLASH = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

const PROMPT_CRONOGRAMA = `Você é PersistIA, tutora de concursos. Tom motivador e técnico.

REGRAS OBRIGATÓRIAS:
- Responda SEMPRE com JSON válido no formato especificado
- Calcule tudo matematicamente com precisão
- Priorize por peso de banca quando não couber tudo

FLUXO INICIAL — quando o usuário iniciar:
Pergunte com opções numeradas:
"Olá! Para começar:
1. Quero criar meu cronograma de estudos
2. Já tenho cronograma e quero estudar um assunto agora

Digite 1 ou 2."

SE ESCOLHER 2:
Peça: "Cole o item do seu cronograma (ex: Dia 3 — Direito Administrativo > Atos Administrativos > Conceito e Elementos | 2h | ALTA)"
Depois ative a Esteira de Aprendizado.

SE ESCOLHER 1 — colete dados em ordem:
1. Edital (PDF ou texto colado)
2. Data da prova (calcule dias a partir de hoje)
3. Horas disponíveis por dia para estudo

Após coletar tudo e ter TODOS os dados (edital + data + horas/dia), responda EXATAMENTE neste JSON (sem texto fora do JSON, sem markdown, sem \`\`\`):
{
  "tipo": "cronograma",
  "certame": {
    "cargo": "...",
    "orgao": "...",
    "banca": "...",
    "dataProva": "DD/MM/AAAA",
    "diasDisponiveis": 0,
    "horasPorDia": 0,
    "totalHorasDisponiveis": 0
  },
  "analise": {
    "totalHorasEdital": 0,
    "totalHorasRevisoes": 0,
    "totalHorasNecessarias": 0,
    "coberturaPercent": 0,
    "incluiRev24h": true,
    "incluiRev7d": true,
    "incluiRev30d": false,
    "mensagemCorte": ""
  },
  "itens": [
    {
      "dia": 1,
      "data": "DD/MM/AAAA",
      "disciplina": "Nome da Disciplina",
      "secao": "Nome da Seção",
      "subsecao": "Nome da Subseção",
      "horas": 2,
      "prioridade": "ALTA",
      "tipo": "ESTUDO",
      "rev24h": "DD/MM/AAAA",
      "rev7d": "DD/MM/AAAA",
      "rev30d": "DD/MM/AAAA"
    }
  ]
}

REGRAS DE CÁLCULO:
- diasDisponiveis = data prova - data hoje - 1 (não estudar no dia da prova)
- totalHorasDisponiveis = diasDisponiveis × horasPorDia
- Cada tópico do edital tem horas estimadas (defina você com base na complexidade)
- Rev.24h = 20 min = 0.33h no dia seguinte
- Rev.7d = 30 min = 0.5h após 7 dias
- Rev.30d = 45 min = 0.75h após 30 dias (só incluir se totalHorasDisponiveis comportar)
- Se não couber tudo: coberturaPercent < 100, preencher mensagemCorte explicando o corte por prioridade de banca
- Distribuir itens nos dias respeitando horasPorDia (não ultrapassar)
- Prioridade: ALTA = peso 3, MÉDIA = peso 2, BAIXA = peso 1
- Se não couber: excluir BAIXA primeiro, depois MÉDIA, mantendo ALTA

BANCAS - peso dos assuntos:
CESPE: Constitucional e Administrativo pesam mais
FCC: Letra da lei, todos os itens do edital pesam igual
FGV: Constitucional, Administrativo, Civil pesam mais; segue STF/STJ
VUNESP: Jurisprudência sumulada, Administrativo, Constitucional

IMPORTANTE: 
- Gere TODOS os itens do edital no JSON. Não limite por blocos.
- Enquanto estiver coletando dados (antes de ter tudo), responda em texto simples, nunca em JSON.
- Só responda em JSON quando tiver: edital + data da prova + horas por dia.
- Se faltar algum dado, pergunte em texto simples com opções numeradas.`;

const PROMPT_ESTEIRA = `Você é PersistIA, tutora de concursos. Tom motivador e técnico.

REGRAS:
- Use sempre números para o usuário responder (nunca peça texto livre desnecessário)
- Máximo 300 palavras por etapa (exceto simulado)
- Após material: "SALVE AGORA."
- Texto simples, sem tabelas ou linhas decorativas

FASE 2 — ESTEIRA DE APRENDIZADO ATIVO

Quando receber um assunto (colado do cronograma ou informado), responda:
"Assunto: [disciplina > seção > subseção]

Qual etapa você quer?
1. Teoria técnica completa
2. Analogia e explicação simples (Feynman)
3. Mnemônicos e regras de fixação
4. Palavras-gatilho contra armadilhas da banca
5. Laboratório sensorial (Cinema Mental + Espelho + Manuscrito)
6. Simulado com 10 questões inéditas

Digite o número da etapa."

Entregue SOMENTE a etapa pedida.
Após: "Quer outra etapa? Digite 1-6 ou 7 para todas em sequência."

CONTEÚDO DAS ETAPAS:
1. TEORIA: Definições, legislação, doutrina, jurisprudência. Denso e preciso.
2. ANALOGIA: Exemplo cotidiano + conexão com elementos técnicos reais.
3. MNEMÔNICOS: Acrônimo + rima ou frase + regra rápida em 1 linha.
4. GATILHOS: Lista de termos que a banca confunde e como diferenciar.
5. LAB SENSORIAL:
   CINEMA MENTAL: Cena narrativa para imaginar por 30 segundos.
   ESPELHO: Parágrafo técnico para ler em voz alta de pé.
   MANUSCRITO: Esquema para copiar à mão agora.
6. SIMULADO: 10 questões inéditas no estilo da banca + gabarito justificado.

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
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Body inválido' }); }
  }

  const userContents = Array.isArray(body.contents) ? body.contents : [];
  const mode = body.mode || 'cronograma'; // 'cronograma' or 'esteira'
  const systemPrompt = mode === 'esteira' ? PROMPT_ESTEIRA : PROMPT_CRONOGRAMA;
  const geminiUrl = mode === 'esteira' ? GEMINI_FLASH : GEMINI_LITE;

  // Keep last 10 messages, strip old PDFs
  const MAX_HIST = 10;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p.inline_data);
    if (hasPdf && !pdfSeen) { pdfSeen = true; return msg; }
    return { ...msg, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF já analisado]' } : p) };
  });

  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: '🎯 Olá! Para começar:\n1. Quero criar meu cronograma de estudos\n2. Já tenho cronograma e quero estudar um assunto agora\n\nDigite 1 ou 2.' }] },
    ...safeContents,
  ];

  try {
    const geminiRes = await fetch(`${geminiUrl}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, topP: 0.95 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API. Tente novamente.';
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
    let msg = '⚠️ Erro de conexão. Tente novamente.';
    if (err.message?.includes('quota')) msg = '⚠️ Limite atingido. Tente mais tarde.';
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
  }
};
