// Pacote didático dos 8 verbos para um tópico. Gerado uma vez pelo Gemini e
// guardado no Turso (catálogo: o mesmo pacote serve a todos os alunos).
// GET ?topico_id=...  → {resumo, acronimo, lei_seca, questoes, flashcards, feynman, podcast, musica}
const { getDb, ensureSchema, agora, alunoDoToken, cors, chamarGemini } = require('./_lib');

const SYSTEM = `Você produz material de estudo para concursos públicos brasileiros, em português do Brasil.
Regras:
- Baseie-se no conhecimento consolidado da matéria; quando afirmar regra jurídica, cite o dispositivo (artigo/lei, súmula). Se não tiver certeza da fonte exata, não a invente — omita a citação.
- "resumo": 2 a 3 parágrafos diretos, com o que mais cai em prova sobre o tópico.
- "acronimo": um mnemônico ÚTIL para o tópico (sigla + o que cada letra significa). Se não couber mnemônico, crie um macete curto no campo sigla e explique nos itens.
- "lei_seca": um trecho essencial (lei seca ou definição canônica) com 4 a 6 palavras-chave marcadas entre colchetes duplos, ex.: "obedecerá aos princípios de [[legalidade]], [[impessoalidade]]...".
- "questoes": 4 itens inéditos no estilo Certo/Errado (banca Cebraspe), atacando armadilhas clássicas; "gabarito" true = Certo; "comentario" explica em até 40 palavras.
- "flashcards": 5 pares frente/verso curtos.
- "feynman": 2 perguntas para o aluno explicar em voz alta, cada uma com 3 pontos-chave esperados.
- "podcast": um roteiro curto (150-200 palavras) em diálogo entre ANA e LÉO com uma pausa de recuperação.
- "musica": estilo sugerido + letra mnemônica curta (refrão + 1 verso).`;

const SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    acronimo: { type: 'object', properties: { sigla: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } }, required: ['sigla', 'itens'] },
    lei_seca: { type: 'string' },
    questoes: { type: 'array', items: { type: 'object', properties: { enunciado: { type: 'string' }, gabarito: { type: 'boolean' }, comentario: { type: 'string' } }, required: ['enunciado', 'gabarito', 'comentario'] } },
    flashcards: { type: 'array', items: { type: 'object', properties: { frente: { type: 'string' }, verso: { type: 'string' } }, required: ['frente', 'verso'] } },
    feynman: { type: 'array', items: { type: 'object', properties: { pergunta: { type: 'string' }, pontos: { type: 'array', items: { type: 'string' } } }, required: ['pergunta', 'pontos'] } },
    podcast: { type: 'string' },
    musica: { type: 'object', properties: { estilo: { type: 'string' }, letra: { type: 'string' } }, required: ['estilo', 'letra'] }
  },
  required: ['resumo', 'acronimo', 'lei_seca', 'questoes', 'flashcards', 'feynman', 'podcast', 'musica']
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const url = new URL(req.url, 'http://x');
  const topicoId = url.searchParams.get('topico_id');
  if (!topicoId) return res.status(400).json({ erro: 'topico_id é obrigatório' });

  const db = getDb();
  try {
    const cache = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [topicoId] });
    if (cache.rows.length) return res.status(200).json(JSON.parse(cache.rows[0].json));

    const t = await db.execute({
      sql: `SELECT t.nome AS topico, d.nome AS disciplina FROM topicos t
            JOIN disciplinas d ON d.id = t.disciplina_id WHERE t.id = ?`,
      args: [topicoId]
    });
    if (!t.rows.length) return res.status(404).json({ erro: 'Tópico não encontrado' });

    const bruto = await chamarGemini(
      SYSTEM,
      `Disciplina: ${t.rows[0].disciplina}\nTópico: ${t.rows[0].topico}\n\nGere o pacote didático completo deste tópico.`,
      SCHEMA
    );
    const pacote = JSON.parse(bruto);
    pacote.topico = t.rows[0].topico;
    pacote.disciplina = t.rows[0].disciplina;

    await db.execute({
      sql: 'INSERT OR REPLACE INTO conteudos (topico_id, json, criado_em) VALUES (?,?,?)',
      args: [topicoId, JSON.stringify(pacote), agora()]
    });
    return res.status(200).json(pacote);
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao gerar o conteúdo', detalhe: String(e).slice(0, 200) });
  }
};
