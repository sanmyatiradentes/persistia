// "Quero mais": gera um lote extra de questões ou flashcards para um tópico que
// o candidato quer aprofundar. O lote entra no pacote já guardado, então serve
// todos os alunos daquele assunto — e o aluno decide quando gastar.
// POST {topico_id, parte, partes, tipo:'questoes'|'questoes_me'|'flashcards'}
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, chamarGemini } = require('./_lib');

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
    const c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave] });
    if (!c.rows.length) return res.status(404).json({ erro: 'Gere o conteúdo deste assunto primeiro' });
    const pacote = JSON.parse(c.rows[0].json);

    const jaTem = (pacote[tipo] || []).slice(-14)
      .map(x => x.enunciado || x.frente || '')
      .filter(Boolean)
      .join('\n- ');

    const sis = `Você produz material de estudo para concursos públicos brasileiros, em português do Brasil.
Gere ${cfg.n} ${cfg.regra}, sobre o tópico indicado.
${pacote.banca ? 'A banca do concurso é ' + pacote.banca + '; siga o estilo dela.' : 'Estilo clássico de concurso, sem imitar banca específica.'}
Cobre pontos DIFERENTES dos que já foram usados. Quando afirmar regra jurídica, cite o dispositivo; se não tiver certeza da fonte, omita a citação.`;

    const pedido = `Disciplina: ${pacote.disciplina || ''}\nTópico: ${pacote.topico || ''}` +
      (Number(pacote.partes) > 1 ? `\nRecorte: ${pacote.subtitulo || ('parte ' + pacote.parte)}` : '') +
      (jaTem ? `\n\nJá foram usados (não repita nem reformule):\n- ${jaTem}` : '');

    const bruto = await chamarGemini(sis, pedido, cfg.schema);
    const novos = (JSON.parse(bruto).itens || []).filter(Boolean);
    if (!novos.length) return res.status(422).json({ erro: 'O modelo não devolveu itens novos' });

    pacote[tipo] = (pacote[tipo] || []).concat(novos);
    await db.execute({
      sql: 'INSERT OR REPLACE INTO conteudos (topico_id, json, criado_em) VALUES (?,?,?)',
      args: [chave, JSON.stringify(pacote), agora()]
    });

    return res.status(200).json({ ok: true, tipo, novos, total: pacote[tipo].length });
  } catch (e) {
    return res.status(500).json({ erro: 'Não consegui gerar mais agora', detalhe: String(e).slice(0, 200) });
  }
};
