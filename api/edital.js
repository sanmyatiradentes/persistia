// Análise real de edital (texto colado ou PDF lido pela IA).
// POST {pdf_base64|texto}          → se houver vários cargos: {precisa_cargo:true, cargos:[...]}
// POST {pdf_base64|texto, cargo}   → extrai o programa daquele cargo e salva no Turso
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, chamarGeminiPartes } = require('./_lib');

const SYS_CARGOS = `Você analisa editais de concurso público brasileiros (ou programas de vestibular/ENEM).
Responda APENAS com o que está no documento:
- titulo: nome curto do órgão/concurso (ex.: "Polícia Civil do Amazonas — 2026").
- data_prova: data da prova objetiva no formato AAAA-MM-DD, ou null se não constar.
- cargos: lista dos cargos (ou áreas/especialidades) para os quais o edital traz conteúdo programático.
  Use o nome exato do edital (ex.: "Perito Criminal — Área 3: Engenharia"). Se o edital for de um cargo único, retorne uma lista com um item.
Não invente cargos.`;

const SCHEMA_CARGOS = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    data_prova: { type: 'string', nullable: true },
    cargos: { type: 'array', items: { type: 'string' } }
  },
  required: ['titulo', 'cargos']
};

const SYS_PROGRAMA = `Você extrai o conteúdo programático de um edital de concurso público brasileiro.
Regras:
- Extraia o programa do CARGO indicado pelo usuário, incluindo as disciplinas de conhecimentos gerais/básicos que se aplicam a ele e as de conhecimentos específicos.
- disciplinas: cada uma com nome e a lista de tópicos.
- Divida tópicos longos em itens de até 12 palavras; não repita numeração do edital.
- Não invente disciplinas nem tópicos que não estejam no documento.`;

const SCHEMA_PROGRAMA = {
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

function partesDe(pdf, texto, instrucao) {
  return pdf
    ? [{ inlineData: { mimeType: 'application/pdf', data: pdf } }, { text: instrucao }]
    : [{ text: instrucao + '\n\nTexto do edital:\n\n' + texto }];
}

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
  const cargoEscolhido = String(body.cargo || '').trim();

  if (!pdf && texto.length < 200) {
    return res.status(400).json({ erro: 'Cole o conteúdo programático do edital, ou envie o PDF' });
  }
  if (pdf && pdf.length > 6000000) {
    return res.status(413).json({ erro: 'PDF muito grande. Envie só as páginas do conteúdo programático, ou cole o texto.' });
  }

  try {
    let titulo = '', dataProva = null, cargos = [];

    // Etapa 1 — descobrir os cargos (só quando o aluno ainda não escolheu)
    if (!cargoEscolhido) {
      const bruto = await chamarGeminiPartes(
        SYS_CARGOS,
        partesDe(pdf, texto, 'Liste o órgão, a data da prova objetiva e os cargos com conteúdo programático neste edital.'),
        SCHEMA_CARGOS
      );
      const info = JSON.parse(bruto);
      titulo = info.titulo || 'Meu edital';
      dataProva = info.data_prova || null;
      cargos = Array.isArray(info.cargos) ? info.cargos.filter(Boolean) : [];

      if (cargos.length > 1) {
        return res.status(200).json({ precisa_cargo: true, titulo, data_prova: dataProva, cargos: cargos.slice(0, 30) });
      }
    }

    // Etapa 2 — extrair o programa do cargo (escolhido, único ou inexistente)
    const alvo = cargoEscolhido || cargos[0] || '';
    const instrucao = alvo
      ? `Extraia o conteúdo programático completo do cargo "${alvo}" (conhecimentos gerais/básicos + específicos), além do título e da data da prova objetiva.`
      : 'Extraia todo o conteúdo programático deste documento, além do título e da data da prova objetiva.';

    const bruto2 = await chamarGeminiPartes(SYS_PROGRAMA, partesDe(pdf, texto, instrucao), SCHEMA_PROGRAMA);
    const dados = JSON.parse(bruto2);
    if (!Array.isArray(dados.disciplinas) || !dados.disciplinas.length) {
      return res.status(422).json({ erro: 'Não encontrei conteúdo programático — envie as páginas do programa do seu cargo' });
    }

    const tituloFinal = (titulo || dados.titulo || 'Meu edital') + (alvo ? ' — ' + alvo : '');
    const provaFinal = dataProva || dados.data_prova || null;

    const db = getDb();
    const editalId = id();
    await db.execute({
      sql: 'INSERT INTO editais (id, aluno_id, titulo, data_prova, criado_em) VALUES (?,?,?,?,?)',
      args: [editalId, aluno.id, tituloFinal.slice(0, 220), provaFinal, agora()]
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

    // um edital novo invalida o cronograma anterior
    await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ?', args: [aluno.id] });

    return res.status(200).json({
      ok: true, edital_id: editalId,
      titulo: tituloFinal, cargo: alvo || null, data_prova: provaFinal,
      n_disciplinas: dados.disciplinas.length, n_topicos: nTop,
      disciplinas: dados.disciplinas.map(d => ({ nome: d.nome, topicos: (d.topicos || []).length }))
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao analisar o edital', detalhe: String(e).slice(0, 200) });
  }
};
