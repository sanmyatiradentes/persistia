// Persi, o tira-dúvidas (verbo Perguntar). POST {question, assunto}
// Responde via Gemini e, se o aluno estiver logado, salva a dúvida no Turso.
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, chamarGemini, MODELO_LEVE } = require('./_lib');

const SYSTEM = `Você é o Persi, o tira-dúvidas do PersisteIA, um aplicativo brasileiro de estudos para concursos públicos.

Regras:
- Responda em português do Brasil, tom amigável e didático, em no máximo 120 palavras.
- Sempre que afirmar uma regra jurídica ou fato cobrado em prova, cite a fonte entre parênteses: artigo e diploma legal, súmula ou jurisprudência. Ex.: (art. 37, caput, CF) ou (Súmula 473, STF).
- Se não tiver certeza da fonte exata, diga isso claramente em vez de inventar.
- Quando couber, feche com um macete ou mnemônico curto.
- Seu escopo é o estudo (conteúdo, técnica de estudo, organização). Se a pergunta fugir disso, redirecione gentilmente para o estudo.
- Não use markdown, listas nem títulos: escreva texto corrido.`;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });

  const { question, assunto } = req.body || {};
  if (!question || typeof question !== 'string' || question.length > 1000) {
    return res.status(400).json({ erro: 'Pergunta ausente ou longa demais' });
  }

  try {
    const answer = await chamarGemini(
      SYSTEM,
      `Assunto em estudo agora: ${assunto || 'preparação para concurso público'}.\n\nDúvida do aluno: ${question}`,
      null,
      MODELO_LEVE
    );

    try {
      await ensureSchema();
      const aluno = await alunoDoToken(req);
      if (aluno) {
        await getDb().execute({
          sql: 'INSERT INTO duvidas (id, aluno_id, assunto, pergunta, resposta, criado_em) VALUES (?,?,?,?,?,?)',
          args: [id(), aluno.id, assunto || null, question.slice(0, 1000), answer.slice(0, 4000), agora()]
        });
      }
    } catch (_) { /* salvar a dúvida é melhor-esforço; a resposta vale sozinha */ }

    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao consultar o modelo', detalhe: String(e).slice(0, 200) });
  }
};
