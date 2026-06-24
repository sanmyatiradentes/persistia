/**
 * PersisteIA — api/chat.js
 * Prompts no backend (ocultos). Padrão InspireIA com SSE.
 * Sanmya Beatriz Tiradentes Leite & Jane De Maria Alves Sousa
 *
 * ARQUITETURA gerar_docx (2 passos — elimina timeout):
 *   Passo 1 — Gemini extrai SOMENTE a lista de tópicos do edital (~10-20s)
 *   Passo 2 — Backend Node.js calcula datas/horas/revisões (instantâneo, sem IA)
 */

const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';
const GEMINI_DOCX_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const FILES_API      = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

// ── Prompts do chat ──────────────────────────────────────────────────────────

const PROMPT_CRONOGRAMA = `Você é PersisteIA, tutora de concursos. Tom motivador.

REGRAS: Máximo 80 palavras por resposta. Nunca repita pergunta já respondida. Nunca gere cronograma no chat.

FLUXO:
"Olá! Para começar:
1. Criar cronograma
2. Estudar um assunto específico
Digite 1 ou 2."

SE 2: Peça o item do cronograma. Ative a Esteira.

SE 1: Colete em ordem, UM por vez:
1. Cargo (se não informado na sidebar)
2. Banca (CESPE, FCC, FGV, VUNESP, etc.)
3. Data da prova (DD/MM/AAAA)
4. Horas por dia — peça: "Quantas horas por dia? Digite só o número (entre 2 e 6)."

Com os 4 dados, responda APENAS (máximo 3 linhas):
"✅ Dados completos! Cargo: [X] | Banca: [X] | Data: [X] | [Y] dias | [X]h/dia. Clique em GERAR DOCX abaixo. 📅"

BANCAS: CESPE=quase-certas; FCC=lei; FGV=STF/STJ; VUNESP=jurisprudência`;

const PROMPT_ESTEIRA = `Você é PersisteIA, tutora de concursos públicos criada por Sanmya Tiradentes e Jane De Maria Alves Sousa. Tom motivador e técnico.

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

// ── Prompt de extração de tópicos — cargo-específico (gerado dinamicamente) ──
// Antes era uma constante genérica que pedia TODOS os cargos, gerando listas
// enormes que excediam os tokens e faziam o Gemini responder em prosa.
// Agora o cargo é injetado no prompt para que apenas as disciplinas relevantes
// sejam extraídas, tornando a resposta menor, mais rápida e mais confiável.
function buildPromptExtrai(cargo) {
  return `Você é um analisador de editais de concurso público.
Leia o CONTEÚDO PROGRAMÁTICO (normalmente no Anexo I) deste edital e extraia APENAS os tópicos do cargo: "${cargo}".
Responda SOMENTE com JSON puro, sem markdown, sem texto antes ou depois:
{"orgao":"nome do orgao extraído do edital","topicos":["Disciplina > Secao","Disciplina > Secao > Subitem"]}
REGRAS OBRIGATORIAS:
- Extraia SOMENTE as disciplinas e tópicos do cargo "${cargo}" (ignore todos os outros cargos)
- Um item do array por tópico ou subitem do conteúdo programático
- Formato: "NomeDisciplina > NomeSecao" ou "NomeDisciplina > NomeSecao > NomeSubitem"
- Maximo 80 caracteres por string — sem quebras de linha, sem aspas nos valores
- Se um tópico tiver muitos subitens, crie um elemento do array por subitem
- NUNCA inclua texto fora do JSON`;
}

// ── Parser robusto de JSON (5 estratégias em cascata) ────────────────────────
function tryParseJsonRobust(rawText) {
  let text = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  text = text.substring(s, e + 1);

  try { return JSON.parse(text); } catch(_) {}

  const v2 = text.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(v2); } catch(_) {}

  const v3 = escaparControlesEmStringsJson(text);
  try { return JSON.parse(v3); } catch(_) {}

  const v4 = escaparControlesEmStringsJson(v2);
  try { return JSON.parse(v4); } catch(_) {}

  const v5 = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ')
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(v5); } catch(_) {}

  return null;
}

function escaparControlesEmStringsJson(text) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { out += c; escape = false; continue; }
    if (c === '\\' && inString) { out += c; escape = true; continue; }
    if (c === '"') { out += c; inString = !inString; continue; }
    if (inString) {
      const code = c.charCodeAt(0);
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
    }
    out += c;
  }
  return out;
}

// ── Files API upload ─────────────────────────────────────────────────────────
async function uploadPdfToFilesApi(apiKey, pdfBase64) {
  const pdfBytes = Buffer.from(pdfBase64, 'base64');
  const initRes = await fetch(`${FILES_API}?uploadType=resumable&key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': pdfBytes.length,
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
    },
    body: JSON.stringify({ file: { display_name: 'edital.pdf' } }),
  });
  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files API não retornou upload URL');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': pdfBytes.length,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: pdfBytes,
  });
  const fileData = await uploadRes.json();
  return fileData?.file?.uri;
}

// ── Passo 2: cálculo de cronograma no backend (sem IA, sem timeout) ──────────
function calcularCronograma({ topicos, cargo, orgao, banca, dataProva, diasDisponiveis, horasPorDia }) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hpd = parseFloat(horasPorDia);

  // Matérias de alta prioridade por banca
  const altasPorBanca = {
    CESPE:    ['constitucional','administrativo','português','língua portuguesa'],
    CEBRASPE: ['constitucional','administrativo','português','língua portuguesa'],
    FCC:      ['português','língua portuguesa','administrativo','constitucional'],
    FGV:      ['constitucional','raciocínio lógico','administrativo','informática'],
    VUNESP:   ['constitucional','português','língua portuguesa','jurisprudência'],
    AOCP:     ['constitucional','administrativo','português'],
    IBFC:     ['constitucional','administrativo','português'],
    IADES:    ['constitucional','administrativo','português'],
  };
  const altas = (altasPorBanca[banca.toUpperCase()] || []);
  const getPrio = (t) => altas.some(p => t.toLowerCase().includes(p)) ? 'ALTA' : 'NORMAL';

  // Formata data somando N dias a partir de hoje
  const dataOffset = (n) => {
    if (n < 1 || n > diasDisponiveis + 60) return '';
    const d = new Date(hoje);
    d.setDate(d.getDate() + n);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  const HORAS_POR_TOPICO = 2; // 2h por tópico — padrão concurso
  const itens = [];
  let diaAtual = 1;
  let horasDia = 0;

  for (const topico of topicos) {
    if (diaAtual > diasDisponiveis) break;
    if (horasDia + HORAS_POR_TOPICO > hpd) { diaAtual++; horasDia = 0; }
    if (diaAtual > diasDisponiveis) break;

    const pts = topico.replace(/"/g, '').split('>').map(s => s.trim());
    itens.push({
      dia:        diaAtual,
      data:       dataOffset(diaAtual),
      disciplina: pts[0] || topico,
      secao:      pts[1] || '',
      subsecao:   pts[2] || '',
      horas:      HORAS_POR_TOPICO,
      prioridade: getPrio(topico),
      rev24h:     dataOffset(diaAtual + 1),
      rev7d:      dataOffset(diaAtual + 7),
      rev30d:     dataOffset(diaAtual + 30),
    });
    horasDia += HORAS_POR_TOPICO;
  }

  const pct = topicos.length > 0
    ? Math.min(100, Math.round((itens.length / topicos.length) * 100)) : 100;

  return {
    tipo: 'cronograma',
    certame: {
      cargo,
      orgao: (orgao || 'Conforme edital').slice(0, 80),
      banca,
      dataProva,
      diasDisponiveis,
      horasPorDia: hpd,
      totalHorasDisponiveis: diasDisponiveis * hpd,
    },
    analise: {
      coberturaPercent: pct,
      incluiRev24h: true,
      incluiRev7d:  true,
      incluiRev30d: pct === 100,
      mensagemCorte: pct < 100
        ? `${topicos.length - itens.length} tópico(s) não cabem nos ${diasDisponiveis} dias. Priorize os marcados como ALTA.`
        : '',
    },
    itens,
  };
}

// ── Handler principal ────────────────────────────────────────────────────────
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

  // ── AÇÃO: gerar cronograma completo ────────────────────────────────────────
  if (body.action === 'gerar_docx') {
    const { pdfBase64, pdfText, cargo, banca, dataProva, horasPorDia } = body;

    if (!cargo || !banca || !dataProva || !horasPorDia) {
      return res.status(400).json({ error: 'Dados incompletos: cargo, banca, dataProva e horasPorDia são obrigatórios.' });
    }
    if (!pdfText && !pdfBase64) {
      return res.status(400).json({ error: 'Conteúdo do edital não encontrado. Anexe o PDF ou cole o conteúdo programático.' });
    }

    try {
      // Dias disponíveis
      const hoje = new Date();
      const [dd, mm, yyyy] = dataProva.split('/');
      const prova = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      const diasDisponiveis = Math.max(1, Math.floor((prova - hoje) / 86400000) - 1);

      // ── PASSO 1: Gemini extrai SOMENTE os tópicos (~10-20s) ──────────────
      // Não pedimos datas, horas nem distribuição — só nomes. Isso é 5-10x mais rápido.
      let userParts;
      if (pdfText && pdfText.length > 100) {
        // Via: texto extraído pelo PDF.js (preferido — payload pequeno)
        // Prompt cargo-específico inline (usa variável `cargo` do escopo)
        const promptEspecifico = buildPromptExtrai(cargo);
        userParts = [{ text: `EDITAL (texto extraído):\n\n${pdfText.slice(0, 80000)}\n\n---\n${promptEspecifico}` }];
      } else {
        // Fallback: PDF binário via Files API ou inline
        let fileUri = null;
        try { fileUri = await uploadPdfToFilesApi(apiKey, pdfBase64); } catch(e) {
          console.error('[PersisteIA] Files API falhou:', e.message);
        }
        const pdfPart = fileUri
          ? { file_data: { mime_type: 'application/pdf', file_uri: fileUri } }
          : { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } };
        userParts = [pdfPart, { text: buildPromptExtrai(cargo) }];
      }

      const geminiRes = await fetch(`${GEMINI_DOCX_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: { temperature: 0.0, maxOutputTokens: 16384, topP: 0.95 },
        }),
      });

      if (!geminiRes.ok) {
        const errTxt = await geminiRes.text();
        console.error('[PersisteIA] Gemini HTTP error:', errTxt.slice(0, 300));
        return res.status(200).json({ error: 'Erro na API Gemini (HTTP ' + geminiRes.status + '): ' + errTxt.slice(0, 200) });
      }

      const geminiData = await geminiRes.json();
      const finishReason = geminiData?.candidates?.[0]?.finishReason || 'UNKNOWN';
      const rawText     = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Log diagnóstico — visível nos Logs da Vercel
      console.log('[PersisteIA] finishReason:', finishReason, '| rawText length:', rawText.length);
      console.log('[PersisteIA] rawText preview:', rawText.slice(0, 400));

      const parsed = tryParseJsonRobust(rawText);
      if (!parsed) {
        return res.status(200).json({
          error: `A IA não retornou JSON válido (finishReason=${finishReason}). ` +
                 `Resposta recebida: "${rawText.slice(0, 150)}..." — Tente novamente.`,
        });
      }
      if (!Array.isArray(parsed.topicos) || parsed.topicos.length === 0) {
        return res.status(200).json({
          error: `A IA retornou JSON mas sem tópicos (campos: ${Object.keys(parsed).join(', ')}). ` +
                 `Verifique se o cargo "${cargo}" está correto no edital, ou cole o conteúdo programático diretamente no chat.`,
        });
      }

      // ── PASSO 2: Backend calcula todo o cronograma (instantâneo, sem IA) ──
      const cronograma = calcularCronograma({
        topicos:         parsed.topicos,
        cargo,
        orgao:           parsed.orgao || '',
        banca,
        dataProva,
        diasDisponiveis,
        horasPorDia,
      });

      return res.status(200).json({ cronograma });

    } catch(err) {
      console.error('[PersisteIA] gerar_docx error:', err);
      return res.status(200).json({ error: 'Erro ao gerar cronograma: ' + err.message });
    }
  }

  // ── FLUXO NORMAL DE CHAT (SSE) ───────────────────────────────────────────
  const userContents = Array.isArray(body.contents) ? body.contents : [];
  const mode = body.mode || 'cronograma';
  const sysPrompt = mode === 'esteira' ? PROMPT_ESTEIRA : PROMPT_CRONOGRAMA;

  const MAX_HIST = 10;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg || !msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p && p.inline_data);
    if (hasPdf && !pdfSeen) { pdfSeen = true; return msg; }
    if (hasPdf) {
      return { role: msg.role, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF analisado]' } : p) };
    }
    return { role: msg.role || 'user', parts: msg.parts };
  });

  const contents = [
    { role: 'user',  parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: WELCOME }] },
    { role: 'user',  parts: [{ text: (() => { const n=new Date(); const d=String(n.getDate()).padStart(2,'0'); const m=String(n.getMonth()+1).padStart(2,'0'); return '[DATA DE HOJE: '+d+'/'+m+'/'+n.getFullYear()+'. Use esta data para calcular dias até a prova.]'; })() }] },
    { role: 'model', parts: [{ text: 'Entendido.' }] },
    ...safeContents,
  ];

  try {
    const geminiRes = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: mode === 'esteira' ? 4096 : 2048,
          topP: 0.95,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API.';
      if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED'))
        msg = '⚠️ Limite diário atingido (20 req/dia no plano gratuito). Aguarde o reset ou ative plano pago em aistudio.google.com.';
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
    }

    const reader  = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer   = '';

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
          const t = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (t) fullText += t;
        } catch(e) {}
      }
    }

    return res.status(200).json({
      candidates: [{ content: { parts: [{ text: fullText || '⚠️ Sem resposta. Tente novamente.' }], role: 'model' }, finishReason: 'STOP' }],
    });

  } catch (err) {
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: '⚠️ Erro: ' + err.message }] } }] });
  }
};

// Aumenta o limite de body e timeout máximo do handler para editais grandes.
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};
