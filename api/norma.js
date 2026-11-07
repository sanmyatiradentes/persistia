// A escolha da aluna para uma norma local (ver _normas.js).
// POST {topico_id, modo:'texto', texto, origem} → aula a partir do texto oficial
// POST {topico_id, modo:'geral'}                → só conceitos gerais, sem artigos
// POST {topico_id, modo:'federal'}              → não é norma local: segue normal
// POST {topico_id, modo:'material', texto, origem} → qualquer assunto: aula a partir do material da aluna
// POST {topico_id, modo:'ia'}                   → desfaz o material e volta à aula da IA
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno } = require('./_lib');
const { materialFalaDoAssunto } = require('./_normas');

const MAX_TEXTO = 1500000;
const MAX_POR_DIA = 10;   // cada envio refaz a aula inteira na IA

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });
  const db = getDb();
  try {
    const { topico_id, modo, origem } = req.body || {};
    const dono = await db.execute({
      sql: `SELECT t.id, t.nome FROM topicos t JOIN disciplinas d ON d.id = t.disciplina_id JOIN editais e ON e.id = d.edital_id
            WHERE t.id = ? AND e.aluno_id = ?`,
      args: [String(topico_id || ''), aluno.id]
    });
    if (!dono.rows.length) return res.status(404).json({ erro: 'Assunto não encontrado' });
    if (!['texto', 'geral', 'federal', 'material', 'ia'].includes(modo)) return res.status(400).json({ erro: 'Escolha inválida' });

    const limpar = async () => {
      const tid = String(topico_id);
      await db.execute({ sql: 'DELETE FROM conteudos WHERE topico_id = ? OR topico_id LIKE ?', args: [tid, tid + ':%'] });
      // a tabela de áudios só nasce na primeira gravação
      try { await db.execute({ sql: 'DELETE FROM audios WHERE topico_id = ? OR topico_id LIKE ?', args: [tid, tid + ':%'] }); } catch (_) {}
    };
    if (modo === 'ia') {
      await db.execute({ sql: 'DELETE FROM normas_locais WHERE topico_id = ? AND aluno_id = ?', args: [String(topico_id), aluno.id] });
      await limpar();
      return res.status(200).json({ ok: true, modo });
    }
    if (modo === 'texto' || modo === 'material') {
      const hoje = await db.execute({
        sql: 'SELECT COUNT(*) AS n FROM normas_locais WHERE aluno_id = ? AND substr(criado_em, 1, 10) = ?',
        args: [aluno.id, agora().slice(0, 10)]
      });
      if (Number(hoje.rows[0].n) >= MAX_POR_DIA) return res.status(429).json({ erro: 'Você já enviou ' + MAX_POR_DIA + ' arquivos hoje. Tente de novo amanhã.' });
    }

    let texto = null;
    if (modo === 'material') {
      texto = String((req.body || {}).texto || '').replace(/[ \t]+/g, ' ').trim();
      if (texto.length < 300) return res.status(400).json({ erro: 'Não encontrei texto suficiente. Se o PDF for digitalizado (uma foto), ele não dá para ler: envie um PDF com texto selecionável.' });
      if (texto.length > MAX_TEXTO) return res.status(400).json({ erro: 'Arquivo grande demais. Envie só a parte deste assunto.' });
      if (!materialFalaDoAssunto(texto, dono.rows[0].nome)) return res.status(400).json({ erro: 'Não encontrei este assunto no arquivo. Confira se é o material certo.' });
    }
    if (modo === 'texto') {
      texto = String((req.body || {}).texto || '').replace(/[ \t]+/g, ' ').trim();
      if (texto.length < 300) return res.status(400).json({ erro: 'Não encontrei texto suficiente. Se o PDF for digitalizado (uma foto), copie e cole o texto da lei.' });
      if (texto.length > MAX_TEXTO) return res.status(400).json({ erro: 'Arquivo grande demais. Envie só a lei pedida no edital.' });
      if (!/\bart(?:igo)?\.?\s*\d|\bart\.\s*1/i.test(texto)) return res.status(400).json({ erro: 'Isso não parece o texto de uma lei: não encontrei artigos. Confira o arquivo.' });
    }

    await db.execute({
      sql: 'INSERT OR REPLACE INTO normas_locais (topico_id, aluno_id, modo, texto, origem, criado_em) VALUES (?,?,?,?,?,?)',
      args: [String(topico_id), aluno.id, modo, texto, origem ? String(origem).slice(0, 200) : null, agora()]
    });
    // material próprio troca só a aula: cartões e caderno da aluna continuam
    if (modo === 'material') await limpar();
    if (modo === 'texto' || modo === 'geral') {
      // o que foi escrito de memória sai junto: aula, áudio, cartões e erros desse assunto
      await limpar();
      await db.execute({ sql: 'DELETE FROM flashcards WHERE aluno_id = ? AND origem = ?', args: [aluno.id, 'topico:' + topico_id] });
      await db.execute({ sql: 'DELETE FROM erros WHERE aluno_id = ? AND topico_id = ?', args: [aluno.id, String(topico_id)] });
    }
    return res.status(200).json({ ok: true, modo });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
