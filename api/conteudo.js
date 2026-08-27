// Pacote didático dos 8 verbos para um tópico. Gerado uma vez pelo Gemini e
// guardado no Turso (catálogo: o mesmo pacote serve a todos os alunos).
// GET ?topico_id=...  → {resumo, acronimo, lei_seca, questoes, flashcards, feynman, podcast, musica}
const { getDb, ensureSchema, agora, alunoDoToken, cors, chamarGemini } = require('./_lib');

function sistema(banca) {
  const estilo = banca
    ? `A banca do concurso é ${banca}. Escreva os itens de Certo/Errado no estilo dessa banca e as questões de múltipla escolha também no padrão dela.`
    : 'A banca ainda não é conhecida. Gere os dois formatos em estilo neutro e clássico de concurso, sem imitar uma banca específica.';
  return SYSTEM_BASE + '\n' + estilo;
}

const SYSTEM_BASE = `Você produz material de estudo para concursos públicos brasileiros, em português do Brasil.
Regras:
- Baseie-se no conhecimento consolidado da matéria; quando afirmar regra jurídica, cite o dispositivo (artigo/lei, súmula). Se não tiver certeza da fonte exata, não a invente — omita a citação.
- "resumo": 5 a 7 parágrafos densos e completos sobre o tópico — conceito, fundamentos, classificações, exceções, pegadinhas de prova e exemplos concretos. Escreva como um professor experiente escreveria a teoria do assunto: sem encher linguiça, mas sem deixar buraco. Separe os parágrafos com uma linha em branco.
- "acronimo": um mnemônico ÚTIL para o tópico (sigla + o que cada letra significa). Se não couber mnemônico, crie um macete curto no campo sigla e explique nos itens.
- "lei_seca": um trecho essencial (lei seca ou definição canônica) com 4 a 6 palavras-chave marcadas entre colchetes duplos, ex.: "obedecerá aos princípios de [[legalidade]], [[impessoalidade]]...".
- "questoes": 8 itens inéditos no formato Certo/Errado, atacando armadilhas clássicas e cobrindo pontos diferentes do tópico; "gabarito" true = Certo; "comentario" explica em até 45 palavras.
- "questoes_me": 6 questões inéditas de MÚLTIPLA ESCOLHA sobre o mesmo tópico, cada uma com "enunciado", 5 "alternativas" (texto puro, sem letras A) B) etc.), "correta" (índice de 0 a 4 da alternativa certa) e "comentario" de até 45 palavras explicando por que a correta está certa.
- "flashcards": 10 pares frente/verso curtos, cobrindo o tópico inteiro.
- "feynman": 3 perguntas para o aluno explicar em voz alta, cada uma com 3 pontos-chave esperados.
- "mapa": um mapa mental do tópico — "centro" (2 a 4 palavras) e 4 a 6 "ramos", cada um com "titulo" (até 3 palavras) e 2 a 4 "itens" curtos (até 5 palavras cada).
- "podcast": um roteiro de 350 a 450 palavras em diálogo entre ANA e LÉO, com duas pausas de recuperação ("pensa aí… "), cobrindo o essencial do tópico e terminando com um resumo relâmpago. Use apenas "ANA:" e "LEO:" como marcadores de fala.
- "musica": estilo sugerido + letra mnemônica curta (refrão + 1 verso).`;

const SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    acronimo: { type: 'object', properties: { sigla: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } }, required: ['sigla', 'itens'] },
    lei_seca: { type: 'string' },
    questoes: { type: 'array', items: { type: 'object', properties: { enunciado: { type: 'string' }, gabarito: { type: 'boolean' }, comentario: { type: 'string' } }, required: ['enunciado', 'gabarito', 'comentario'] } },
    questoes_me: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          enunciado: { type: 'string' },
          alternativas: { type: 'array', items: { type: 'string' } },
          correta: { type: 'integer' },
          comentario: { type: 'string' }
        },
        required: ['enunciado', 'alternativas', 'correta', 'comentario']
      }
    },
    flashcards: { type: 'array', items: { type: 'object', properties: { frente: { type: 'string' }, verso: { type: 'string' } }, required: ['frente', 'verso'] } },
    feynman: { type: 'array', items: { type: 'object', properties: { pergunta: { type: 'string' }, pontos: { type: 'array', items: { type: 'string' } } }, required: ['pergunta', 'pontos'] } },
    mapa: {
      type: 'object',
      properties: {
        centro: { type: 'string' },
        ramos: {
          type: 'array',
          items: {
            type: 'object',
            properties: { titulo: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } },
            required: ['titulo', 'itens']
          }
        }
      },
      required: ['centro', 'ramos']
    },
    podcast: { type: 'string' },
    musica: { type: 'object', properties: { estilo: { type: 'string' }, letra: { type: 'string' } }, required: ['estilo', 'letra'] }
  },
  required: ['resumo', 'acronimo', 'lei_seca', 'questoes', 'questoes_me', 'flashcards', 'feynman', 'mapa', 'podcast', 'musica']
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
      sql: `SELECT t.nome AS topico, d.nome AS disciplina, e.banca AS banca FROM topicos t
            JOIN disciplinas d ON d.id = t.disciplina_id
            JOIN editais e ON e.id = d.edital_id WHERE t.id = ?`,
      args: [topicoId]
    });
    if (!t.rows.length) return res.status(404).json({ erro: 'Tópico não encontrado' });
    const banca = t.rows[0].banca || null;

    const bruto = await chamarGemini(
      sistema(banca),
      `Disciplina: ${t.rows[0].disciplina}\nTópico: ${t.rows[0].topico}\n\nGere o pacote didático completo deste tópico.`,
      SCHEMA
    );
    const pacote = JSON.parse(bruto);
    pacote.topico = t.rows[0].topico;
    pacote.disciplina = t.rows[0].disciplina;
    pacote.banca = banca;

    await db.execute({
      sql: 'INSERT OR REPLACE INTO conteudos (topico_id, json, criado_em) VALUES (?,?,?)',
      args: [topicoId, JSON.stringify(pacote), agora()]
    });
    return res.status(200).json(pacote);
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao gerar o conteúdo', detalhe: String(e).slice(0, 200) });
  }
};
