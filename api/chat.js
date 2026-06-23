/**
 * PersisteIA — api/chat.js
 * Prompts no backend (ocultos). Padrão InspireIA com SSE.
 * Sanmya Beatriz Tiradentes Leite & Jane De Maria Alves Sousa
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

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

// Gemini 2.0 Flash para DOCX (mais barato)
const GEMINI_DOCX_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const FILES_API = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

async function uploadPdfToFilesApi(apiKey, pdfBase64) {
  // Step 1: initiate resumable upload
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

  // Step 2: upload the bytes
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

  // ── AÇÃO: gerar cronograma completo em JSON para DOCX ─────────────────────
  if (body.action === 'gerar_docx') {
    const { pdfBase64, cargo, banca, dataProva, horasPorDia } = body;
    if (!pdfBase64 || !cargo || !banca || !dataProva || !horasPorDia) {
      return res.status(400).json({ error: 'Dados incompletos: cargo, banca, dataProva, horasPorDia e pdfBase64 são obrigatórios.' });
    }

    try {
      // Calcular dias disponíveis
      const hoje = new Date();
      const [dia, mes, ano] = dataProva.split('/');
      const prova = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      const diasDisponiveis = Math.max(0, Math.floor((prova - hoje) / 86400000) - 1);
      const totalHoras = diasDisponiveis * parseFloat(horasPorDia);

      // Upload PDF via Files API
      let fileUri = null;
      try {
        fileUri = await uploadPdfToFilesApi(apiKey, pdfBase64);
      } catch(e) {
        console.error('Files API failed, using inline:', e.message);
      }

      // Build Gemini request
      const userParts = fileUri
        ? [{ file_data: { mime_type: 'application/pdf', file_uri: fileUri } }]
        : [{ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }];

      userParts.push({ text: `GERE O CRONOGRAMA EM JSON PURO. Nenhum texto fora do JSON.

Dados: Cargo=${cargo} | Banca=${banca} | DataProva=${dataProva} | Dias=${diasDisponiveis} | Horas/dia=${horasPorDia}h | TotalHoras=${totalHoras}h

Leia o edital anexado e extraia TODOS os tópicos do conteúdo programático.
Distribua nos ${diasDisponiveis} dias disponíveis, máximo ${horasPorDia}h por dia.
Rev.24h = dia seguinte | Rev.7d = 7 dias após | Rev.30d = 30 dias após (se couber)
Prioridade por banca ${banca}: matérias mais cobradas = ALTA.

Responda APENAS com este JSON (sem espaços extras, sem markdown):
{"tipo":"cronograma","certame":{"cargo":"${cargo}","orgao":"extrair do edital","banca":"${banca}","dataProva":"${dataProva}","diasDisponiveis":${diasDisponiveis},"horasPorDia":${horasPorDia},"totalHorasDisponiveis":${totalHoras}},"analise":{"coberturaPercent":100,"incluiRev24h":true,"incluiRev7d":true,"incluiRev30d":false,"mensagemCorte":""},"itens":[{"dia":1,"data":"DD/MM/AAAA","disciplina":"Nome","secao":"Nome","subsecao":"Nome","horas":2,"prioridade":"ALTA","rev24h":"DD/MM/AAAA","rev7d":"DD/MM/AAAA","rev30d":""}]}

Substitua o exemplo acima pelos dados reais do edital. Gere um item por tópico/subseção.`
      });

      // ── CHAMADA À API GEMINI (estava faltando — causava "geminiRes is not defined") ──
      const geminiRes = await fetch(`${GEMINI_DOCX_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192, topP: 0.95 }
        })
      });

      if (!geminiRes.ok) {
        const err = await geminiRes.text();
        return res.status(200).json({ error: err });
      }

      const data = await geminiRes.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Extract JSON from response (handle markdown fences)
      // Strip any markdown or text around the JSON
      let cleanText = text
        .replace(/^[\s\S]*?(?=\{)/,'')  // remove anything before first {
        .replace(/```json/g,'').replace(/```/g,'').trim();
      const jsonStart = cleanText.indexOf('{');
      const jsonEnd = cleanText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        console.error('[PersisteIA] No JSON found in response:', text.slice(0,200));
        return res.status(200).json({ error: 'IA não retornou JSON. Tente novamente — o Gemini pode demorar para processar editais grandes.' });
      }
      cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
      let cronograma;
      try {
        cronograma = JSON.parse(cleanText);
      } catch(parseErr) {
        // Try to fix common JSON issues
        try {
          cleanText = cleanText.replace(/,\s*}/g,'}').replace(/,\s*]/g,']');
          cronograma = JSON.parse(cleanText);
        } catch(e2) {
          return res.status(200).json({ error: 'Erro ao processar JSON: ' + parseErr.message.slice(0,100) + '. Tente novamente.' });
        }
      }
      return res.status(200).json({ cronograma });

    } catch(err) {
      return res.status(200).json({ error: 'Erro ao gerar cronograma: ' + err.message });
    }
  }

  const userContents = Array.isArray(body.contents) ? body.contents : [];
  const mode = body.mode || 'cronograma';
  const sysPrompt = mode === 'esteira' ? PROMPT_ESTEIRA : PROMPT_CRONOGRAMA;

  // Keep last 8 messages, strip old PDFs
  const MAX_HIST = 10;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;
  // Keep PDF only in first message of full history (not trimmed)
  // After trimming, if PDF ended up stripped, replace with note
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg || !msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p && p.inline_data);
    if (hasPdf && !pdfSeen) {
      pdfSeen = true;
      // Keep PDF but also add text summary request to save tokens
      return msg;
    }
    if (hasPdf) {
      // Strip PDF from duplicate/old messages
      return { role: msg.role, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF analisado]' } : p) };
    }
    return { role: msg.role || 'user', parts: msg.parts };
  });

  const contents = [
    { role: 'user', parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: WELCOME }] },
    { role: 'user', parts: [{ text: (() => { const n=new Date(); const d=String(n.getDate()).padStart(2,'0'); const m=String(n.getMonth()+1).padStart(2,'0'); return '[DATA DE HOJE: '+d+'/'+m+'/'+n.getFullYear()+'. Use esta data para calcular dias até a prova.]'; })() }] },
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
          topP: 0.95 
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
