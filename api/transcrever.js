// Transcreve um áudio curto do aluno (pergunta falada para o Persi).
// POST {audio_base64, mime}  → {texto}
const { ensureSchema, alunoDoToken, cors, MODELO_LEVE } = require('./_lib');

const LIMITE = 3400000;  // ~3,4 MB de base64, abaixo do teto de corpo da Vercel

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const b = req.body || {};
  const audio = String(b.audio_base64 || '');
  if (!audio) return res.status(400).json({ erro: 'Envie o áudio' });
  if (audio.length > LIMITE) return res.status(413).json({ erro: 'Áudio longo demais — fale por até um minuto' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ erro: 'GEMINI_API_KEY não configurada' });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_LEVE}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text:
            'Transcreva a fala em português do Brasil, exatamente como foi dita. Devolva SOMENTE a transcrição, ' +
            'sem aspas, sem comentários e sem descrever o áudio. Se não houver fala inteligível, devolva uma string vazia.' }] },
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: b.mime || 'audio/webm', data: audio } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } }
        })
      }
    );
    if (!r.ok) return res.status(502).json({ erro: 'Não consegui transcrever agora' });
    const d = await r.json();
    const texto = ((((d.candidates || [])[0] || {}).content || {}).parts || [])
      .map(p => p.text).join('').trim();
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro ao transcrever', detalhe: String(e).slice(0, 200) });
  }
};
