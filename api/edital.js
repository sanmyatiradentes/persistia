// Análise real de edital: POST {texto} → Gemini extrai estrutura → salva no Turso.
// Retorna {titulo, data_prova, n_disciplinas, n_topicos, disciplinas:[{nome, topicos}]}
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, chamarGemini, chamarGeminiPartes } = require('./_lib');

const SYSTEM = `Você analisa editais de concurso público brasileiros (ou programas de vestibular).
Extraia APENAS do texto fornecido:
- titulo: nome curto do concurso/cargo (ex.: "Perito Criminal — PC-AM").
- data_prova: data da prova objetiva no formato AAAA-MM-DD, ou null se o texto não trouxer.
- disciplinas: lista de disciplinas do conteúdo programático, cada uma com a lista de tópicos.
Divida tópicos longos em itens de até 12 palavras. Não invente disciplinas nem tópicos que não estejam no texto.`;

const SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    data_prova: { type: 'string', nullable: true },
    disciplinas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          topicos: { type: 'array', items: { type: 'string' } }
        },
        required: ['nome', 'topicos']
      }
    }
  },
  required: ['titulo', 'disciplinas']
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const body = req.body || {};
  const texto = String(body.texto || '').slice(0, 150000);
  const pdf = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
  if (!pdf && texto.length < 200) {
    return res.status(400).json({ erro: 'Cole o conteúdo programático do edital, ou envie o PDF' });
  }
  if (pdf && pdf.length > 6000000) {
    return res.status(413).json({ erro: 'PDF muito grande. Envie só as páginas do conteúdo programático, ou cole o texto.' });
  }

  try {
    const bruto = pdf
      ? await chamarGeminiPartes(SYSTEM, [
          { inlineData: { mimeType: 'application/pdf', data: pdf } },
          { text: 'Extraia deste edital em PDF o título, a data da prova objetiva e todo o conteúdo programático (disciplinas e tópicos).' }
        ], SCHEMA)
      : await chamarGemini(SYSTEM, `Texto do edital:\n\n${texto}`, SCHEMA);
    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados.disciplinas) || !dados.disciplinas.length) {
      return res.status(422).json({ erro: 'Não encontrei conteúdo programático nesse texto — cole a seção das disciplinas' });
    }

    const db = getDb();
    const editalId = id();
    await db.execute({
      sql: 'INSERT INTO editais (id, aluno_id, titulo, data_prova, criado_em) VALUES (?,?,?,?,?)',
      args: [editalId, aluno.id, dados.titulo || 'Meu edital', dados.data_prova || null, agora()]
    });
    let nTop = 0;
    for (let i = 0; i < dados.disciplinas.length; i++) {
      const d = dados.disciplinas[i];
      const discId = id();
      await db.execute({
        sql: 'INSERT INTO disciplinas (id, edital_id, nome, ordem) VALUES (?,?,?,?)',
        args: [discId, editalId, String(d.nome).slice(0, 200), i]
      });
      const tops = (d.topicos || []).slice(0, 400);
      for (let j = 0; j < tops.length; j++) {
        await db.execute({
          sql: 'INSERT INTO topicos (id, disciplina_id, nome, ordem) VALUES (?,?,?,?)',
          args: [id(), discId, String(tops[j]).slice(0, 300), j]
        });
        nTop++;
      }
    }

    return res.status(200).json({
      ok: true, edital_id: editalId,
      titulo: dados.titulo, data_prova: dados.data_prova || null,
      n_disciplinas: dados.disciplinas.length, n_topicos: nTop,
      disciplinas: dados.disciplinas.map(d => ({ nome: d.nome, topicos: (d.topicos || []).length }))
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao analisar o edital', detalhe: String(e).slice(0, 200) });
  }
};
