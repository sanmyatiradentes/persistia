// Análise real de edital (texto colado ou PDF lido pela IA).
// POST {pdf_base64|texto}          → se houver vários cargos: {precisa_cargo:true, cargos:[...]}
// POST {pdf_base64|texto, cargo}   → extrai o programa daquele cargo e salva no Turso
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, chamarGeminiPartes, acessoDoAluno } = require('./_lib');

const SYS_CARGOS = `Você analisa editais de concurso público brasileiros (ou programas de vestibular/ENEM).
Responda APENAS com o que está no documento:
- titulo: nome curto do órgão/concurso (ex.: "Polícia Civil do Amazonas — 2026").
- data_prova: data da prova objetiva no formato AAAA-MM-DD, ou null se não constar.
- banca: nome da banca organizadora (ex.: "Cebraspe", "FGV", "Vunesp", "Instituto AOCP"), ou null se o documento não disser.
- cargos: lista dos cargos (ou áreas/especialidades) para os quais o edital traz conteúdo programático.
  Use o nome exato do edital (ex.: "Perito Criminal — Área 3: Engenharia"). Se o edital for de um cargo único, retorne uma lista com um item.
Não invente cargos.`;

const SCHEMA_CARGOS = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    data_prova: { type: 'string', nullable: true },
    banca: { type: 'string', nullable: true },
    cargos: { type: 'array', items: { type: 'string' } }
  },
  required: ['titulo', 'cargos']
};

const SYS_PROGRAMA = `Você extrai o conteúdo programático de um edital de concurso público brasileiro e dimensiona o esforço de estudo de cada tópico.
Regras:
- Extraia o programa do CARGO indicado pelo usuário, incluindo as disciplinas de conhecimentos gerais/básicos que se aplicam a ele e as de conhecimentos específicos.
- disciplinas: cada uma com nome e a lista de tópicos.
- Divida tópicos longos em itens de até 12 palavras; não repita numeração do edital.
- Não invente disciplinas nem tópicos que não estejam no documento.
- Para CADA tópico, estime "horas": quantas horas de estudo inicial ele realmente exige de um candidato mediano, considerando a amplitude do assunto, a densidade de regras/exceções e o quanto costuma ser cobrado em prova. Use a escala:
  0,5 h = conceito único e curto (ex.: "conceito de ato administrativo");
  1 a 2 h = tópico comum de uma aula;
  3 a 5 h = assunto extenso, com classificações e exceções (ex.: "licitações: modalidades e procedimento");
  6 a 10 h = bloco muito amplo, que na prática vira várias aulas (ex.: "Direito Penal: parte geral").
  Seja honesto: NÃO padronize as horas. Tópicos curtos devem receber horas baixas e tópicos amplos, horas altas.`;

const SYS_DISCIPLINAS = `Você lê editais de concurso público brasileiros e identifica as disciplinas do conteúdo programático de um cargo.
Devolva apenas os nomes das disciplinas que têm programa para o cargo indicado (conhecimentos gerais/básicos + específicos), na ordem em que aparecem. Não invente disciplinas.`;

const SCHEMA_DISCIPLINAS = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    data_prova: { type: 'string', nullable: true },
    disciplinas: { type: 'array', items: { type: 'string' } }
  },
  required: ['titulo', 'disciplinas']
};

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
          topicos: {
            type: 'array',
            items: {
              type: 'object',
              properties: { nome: { type: 'string' }, horas: { type: 'number' } },
              required: ['nome', 'horas']
            }
          }
        },
        required: ['nome', 'topicos']
      }
    }
  },
  required: ['titulo', 'disciplinas']
};

// A IA às vezes devolve 03/04/2022 em vez de 2022-04-03. Normaliza ou descarta.
function normalizarData(v) {
  if (!v) return null;
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    m = t.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})/);
    if (m) m = [null, m[3], m[2], m[1]];
  }
  if (!m) return null;
  const [_, a, mes, d] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
  return `${a}-${mes}-${d}`;
}

// Edital inteiro tem 120 páginas de burocracia e 6 de programa. Se der para
// achar onde começa o programa, manda só dali para frente: mais barato, mais
// rápido e com muito menos chance de a resposta vir truncada.
function recorteProgramatico(texto) {
  if (!texto || texto.length < 12000) return texto;
  const marcas = [
    /conte[úu]do\s+program[áa]tico/gi,
    /programa\s+das?\s+provas?/gi,
    /objetos?\s+de\s+avalia[çc][ãa]o/gi,
    /anexo\s+[ivx0-9]+\s*[-–—:]?\s*(do\s+)?conte[úu]do/gi
  ];
  let melhor = -1;
  for (const re of marcas) {
    let m;
    while ((m = re.exec(texto)) !== null) {
      // a última ocorrência costuma ser o anexo em si, não o sumário
      if (m.index > melhor && texto.length - m.index > 1500) melhor = m.index;
    }
  }
  if (melhor < 0) return texto;
  const corte = texto.slice(Math.max(0, melhor - 400));
  return corte.length > 1500 ? corte : texto;
}

function partesDe(pdf, texto, instrucao, paginas) {
  if (pdf) return [{ inlineData: { mimeType: 'application/pdf', data: pdf } }, { text: instrucao }];
  // edital digitalizado: as páginas chegam como imagem, lidas no aparelho do aluno
  if (paginas && paginas.length) {
    return paginas.map(p => ({ inlineData: { mimeType: 'image/jpeg', data: p } })).concat([{ text: instrucao }]);
  }
  return [{ text: instrucao + '\n\nTexto do edital:\n\n' + texto }];
}

// Resposta truncada devolve JSON quebrado. Tenta de novo pedindo menos.
async function tentar(sistema, partes, schema, vezes) {
  let erro = null;
  for (let n = 0; n < (vezes || 2); n++) {
    try {
      const extra = n === 0 ? '' : '\n\nA resposta anterior veio incompleta. Seja mais enxuto e devolva o JSON inteiro, fechado.';
      return JSON.parse(await chamarGeminiPartes(sistema + extra, partes, schema));
    } catch (e) { erro = e; }
  }
  throw erro || new Error('falha');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

  const body = req.body || {};
  // O app lê o PDF no próprio aparelho e manda o texto: por isso um edital de
  // 30 MB passa, mesmo com o teto de 4,5 MB por requisição da Vercel.
  const texto = String(body.texto || '').slice(0, 400000);
  const pdf = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
  const paginas = Array.isArray(body.paginas) ? body.paginas.filter(p => typeof p === 'string').slice(0, 40) : [];
  const cargoEscolhido = String(body.cargo || '').trim();

  if (!pdf && !paginas.length && texto.length < 200) {
    return res.status(400).json({ erro: 'Cole o conteúdo programático do edital, ou envie o PDF' });
  }
  if (pdf && pdf.length > 3800000) {
    return res.status(413).json({ erro: 'Este PDF é grande demais para enviar inteiro. Envie só o anexo do conteúdo programático, ou cole o texto.' });
  }

  const textoBase = recorteProgramatico(texto);

  try {
    let titulo = '', dataProva = null, cargos = [], banca = String(body.banca || '') || null;

    // Etapa 1 — descobrir os cargos (só quando o aluno ainda não escolheu)
    if (!cargoEscolhido) {
      const info = await tentar(
        SYS_CARGOS,
        partesDe(pdf, textoBase, 'Liste o órgão, a data da prova objetiva e os cargos com conteúdo programático neste edital.', paginas),
        SCHEMA_CARGOS
      );
      titulo = info.titulo || 'Meu edital';
      dataProva = normalizarData(info.data_prova);
      cargos = Array.isArray(info.cargos) ? info.cargos.filter(Boolean) : [];
      banca = info.banca || banca;

      if (cargos.length > 1) {
        return res.status(200).json({ precisa_cargo: true, titulo, data_prova: dataProva, banca, cargos: cargos.slice(0, 30) });
      }
    }

    // Etapa 2 — extrair o programa do cargo (escolhido, único ou inexistente)
    const alvo = cargoEscolhido || cargos[0] || '';
    const instrucao = alvo
      ? `Extraia o conteúdo programático completo do cargo "${alvo}" (conhecimentos gerais/básicos + específicos), além do título e da data da prova objetiva.`
      : 'Extraia todo o conteúdo programático deste documento, além do título e da data da prova objetiva.';

    // Passo A: só os nomes das disciplinas (resposta curta, nunca trunca).
    const lista = await tentar(
      SYS_DISCIPLINAS,
      partesDe(pdf, textoBase, instrucao + ' Liste apenas os NOMES das disciplinas, na ordem do edital.', paginas),
      SCHEMA_DISCIPLINAS
    );
    const nomes = (lista.disciplinas || []).map(x => String(x).trim()).filter(Boolean).slice(0, 30);
    if (!nomes.length) {
      return res.status(422).json({ erro: 'Não encontrei conteúdo programático — envie as páginas do programa do seu cargo' });
    }

    // Passo B: os tópicos, em lotes de 3 disciplinas — cada resposta cabe folgada.
    const dados = { titulo: lista.titulo || titulo, data_prova: lista.data_prova || null, disciplinas: [] };
    for (let i = 0; i < nomes.length; i += 3) {
      const lote = nomes.slice(i, i + 3);
      const r = await tentar(
        SYS_PROGRAMA,
        partesDe(pdf, textoBase,
          instrucao + ` Extraia agora SOMENTE os tópicos destas disciplinas: ${lote.join(' | ')}. Mantenha exatamente esses nomes.`,
          paginas),
        SCHEMA_PROGRAMA
      );
      (r.disciplinas || []).forEach(d => { if (d && d.nome) dados.disciplinas.push(d); });
    }
    if (!dados.disciplinas.length) {
      return res.status(422).json({ erro: 'Não consegui ler os tópicos — envie só as páginas do programa do seu cargo' });
    }

    const tituloFinal = (titulo || dados.titulo || 'Meu edital') + (alvo ? ' — ' + alvo : '');
    const provaFinal = dataProva || normalizarData(dados.data_prova);

    const db = getDb();
    const editalId = id();
    await db.execute({
      sql: 'INSERT INTO editais (id, aluno_id, titulo, data_prova, banca, criado_em) VALUES (?,?,?,?,?,?)',
      args: [editalId, aluno.id, tituloFinal.slice(0, 220), provaFinal, banca, agora()]
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
        const t = tops[j];
        const nome = typeof t === 'string' ? t : String(t.nome || '');
        if (!nome) continue;
        // horas estimadas pela IA, com piso e teto para não distorcer o cronograma
        let horas = typeof t === 'object' ? Number(t.horas) : NaN;
        if (!isFinite(horas) || horas <= 0) horas = 1.5;
        horas = Math.min(12, Math.max(0.5, Math.round(horas * 2) / 2));
        await db.execute({
          sql: 'INSERT INTO topicos (id, disciplina_id, nome, ordem, peso) VALUES (?,?,?,?,?)',
          args: [id(), discId, nome.slice(0, 300), j, horas]
        });
        nTop++;
      }
    }

    // Trocar de edital: o anterior sai de cena junto com o cronograma dele.
    await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ?', args: [aluno.id] });
    const antigos = await db.execute({
      sql: 'SELECT id FROM editais WHERE aluno_id = ? AND id <> ?', args: [aluno.id, editalId]
    });
    for (const velho of antigos.rows) {
      await db.execute({
        sql: `DELETE FROM topicos WHERE disciplina_id IN (SELECT id FROM disciplinas WHERE edital_id = ?)`,
        args: [velho.id]
      });
      await db.execute({ sql: 'DELETE FROM disciplinas WHERE edital_id = ?', args: [velho.id] });
      await db.execute({ sql: 'DELETE FROM editais WHERE id = ?', args: [velho.id] });
    }

    return res.status(200).json({
      ok: true, edital_id: editalId,
      titulo: tituloFinal, cargo: alvo || null, data_prova: provaFinal, banca: banca || null,
      n_disciplinas: dados.disciplinas.length, n_topicos: nTop,
      disciplinas: dados.disciplinas.map(d => ({
        nome: d.nome,
        topicos: (d.topicos || []).length,
        horas: Math.round((d.topicos || []).reduce((s, t) => s + (Number(t && t.horas) || 1.5), 0) * 10) / 10
      }))
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao analisar o edital', detalhe: String(e).slice(0, 200) });
  }
};
