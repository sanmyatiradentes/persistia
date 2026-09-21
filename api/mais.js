// "Quero mais": gera um lote extra de questões ou flashcards para um tópico que
// o candidato quer aprofundar. O lote entra no pacote já guardado, então serve
// todos os alunos daquele assunto — e o aluno decide quando gastar.
// POST {topico_id, parte, partes, tipo:'questoes'|'questoes_me'|'flashcards'}
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, chamarGemini, falhaIA } = require('./_lib');

const LOTES = {
  questoes: {
    n: 8,
    schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { enunciado: { type: 'string' }, gabarito: { type: 'boolean' }, comentario: { type: 'string' } },
            required: ['enunciado', 'gabarito', 'comentario']
          }
        }
      },
      required: ['itens']
    },
    regra: 'itens inéditos no formato Certo/Errado, com "gabarito" (true = Certo) e "comentario" de até 45 palavras'
  },
  questoes_me: {
    n: 6,
    schema: {
      type: 'object',
      properties: {
        itens: {
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
        }
      },
      required: ['itens']
    },
    regra: 'questões inéditas de múltipla escolha, cada uma com 5 "alternativas" (texto puro), "correta" (índice 0 a 4) e "comentario" de até 45 palavras'
  },
  flashcards: {
    n: 10,
    schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { frente: { type: 'string' }, verso: { type: 'string' } },
            required: ['frente', 'verso']
          }
        }
      },
      required: ['itens']
    },
    regra: 'flashcards inéditos, frente e verso curtos'
  }
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

  const { topico_id, parte, partes, tipo } = req.body || {};
  const cfg = LOTES[tipo];
  if (!topico_id || !cfg) return res.status(400).json({ erro: 'Informe topico_id e um tipo válido' });

  const chave = (Number(partes) > 1 && parte) ? String(topico_id) + ':' + parte + '/' + partes : String(topico_id);
  const db = getDb();

  try {
    // O conteúdo de um assunto pode estar em dois estados: já consolidado numa
    // linha só, ou ainda em blocos (texto, apoio, midia, pratica), que é como
    // ele fica enquanto o aluno está estudando o assunto pela primeira vez.
    // Antes esta função só conhecia o primeiro estado e devolvia 404 — "gere o
    // conteúdo primeiro" — justamente para quem estava com o conteúdo aberto.
    const chavePratica = chave + '::pratica';
    let alvo = chave;
    let c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave] });
    if (!c.rows.length) {
      c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chavePratica] });
      if (!c.rows.length) return res.status(404).json({ erro: 'Gere o conteúdo deste assunto primeiro' });
      alvo = chavePratica;
    }
    const pacote = JSON.parse(c.rows[0].json);

    // Disciplina, tópico e banca vêm do banco, não do pacote: o bloco de
    // prática não carrega esses campos, e a banca pode ter mudado desde que o
    // conteúdo foi escrito.
    const ctx = await db.execute({
      sql: `SELECT t.nome AS topico, d.nome AS disciplina, e.banca AS banca FROM topicos t
            JOIN disciplinas d ON d.id = t.disciplina_id
            JOIN editais e ON e.id = d.edital_id WHERE t.id = ?`,
      args: [String(topico_id)]
    });
    const info = ctx.rows[0] || {};
    const banca = info.banca || pacote.banca || null;

    const jaTem = (pacote[tipo] || []).slice(-14)
      .map(x => x.enunciado || x.frente || '')
      .filter(Boolean)
      .join('\n- ');

    const sis = `Você produz material de estudo para concursos públicos brasileiros, em português do Brasil.
Gere ${cfg.n} ${cfg.regra}, sobre o tópico indicado.
${banca ? 'A banca do concurso é ' + banca + '; siga o estilo dela.' : 'Estilo clássico de concurso, sem imitar banca específica.'}
Cobre pontos DIFERENTES dos que já foram usados. Quando afirmar regra jurídica, cite o dispositivo; se não tiver certeza da fonte, omita a citação.`;

    const pedido = `Disciplina: ${info.disciplina || pacote.disciplina || ''}\nTópico: ${info.topico || pacote.topico || ''}` +
      (Number(partes) > 1 ? `\nRecorte: ${pacote.subtitulo || ('parte ' + parte + ' de ' + partes)}` : '') +
      (jaTem ? `\n\nJá foram usados (não repita nem reformule):\n- ${jaTem}` : '');

    const bruto = await chamarGemini(sis, pedido, cfg.schema);
    const novos = (JSON.parse(bruto).itens || []).filter(Boolean);
    if (!novos.length) return res.status(422).json({ erro: 'O modelo não devolveu itens novos' });

    pacote[tipo] = (pacote[tipo] || []).concat(novos);
    await db.execute({
      sql: 'INSERT OR REPLACE INTO conteudos (topico_id, json, criado_em) VALUES (?,?,?)',
      args: [alvo, JSON.stringify(pacote), agora()]
    });

    return res.status(200).json({ ok: true, tipo, novos, total: pacote[tipo].length });
  } catch (e) {
    const f = falhaIA(e, 'Não consegui gerar mais agora');
    return res.status(f.status).json(f.corpo);
  }
};
