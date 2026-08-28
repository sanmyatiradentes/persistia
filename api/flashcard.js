// Flashcards com repetição espaçada (agenda simplificada estilo SM-2).
// POST {frente, verso, origem?}            → cria
// GET                                       → lista os devidos (até 20)
// POST {revisar: id, nota: 0|1|2}           → 0 errei · 1 quase · 2 fácil
const { getDb, ensureSchema, agora, id, alunoDoToken, cors } = require('./_lib');

function proxima(intervaloAtual, nota) {
  // dias: errei → 10 min; quase → 1 dia; fácil → dobra (mín. 4 dias)
  if (nota === 0) return { dias: 10 / 1440 };
  if (nota === 1) return { dias: 1 };
  return { dias: Math.max(4, (Number(intervaloAtual) || 2) * 2) };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      // ?tudo=1 → o baralho inteiro (para a tela "abrir todos os cartões"),
      // com o nome do tópico de origem e a marca de quem já está vencido.
      if (url.searchParams.get('tudo')) {
        const r = await db.execute({
          sql: `SELECT f.id, f.frente, f.verso, f.origem, f.proxima_revisao, t.nome AS topico, d.nome AS disciplina
                FROM flashcards f
                LEFT JOIN topicos t ON ('topico:' || t.id) = f.origem
                LEFT JOIN disciplinas d ON d.id = t.disciplina_id
                WHERE f.aluno_id = ? ORDER BY f.proxima_revisao LIMIT 500`,
          args: [aluno.id]
        });
        const hoje = agora();
        const todos = r.rows.map(x => Object.assign({}, x, { devido: String(x.proxima_revisao) <= hoje }));
        return res.status(200).json({ todos, devidos: todos.filter(x => x.devido) });
      }
      const r = await db.execute({
        sql: `SELECT id, frente, verso, origem, proxima_revisao FROM flashcards
              WHERE aluno_id = ? AND proxima_revisao <= ? ORDER BY proxima_revisao LIMIT 20`,
        args: [aluno.id, agora()]
      });
      return res.status(200).json({ devidos: r.rows });
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.revisar) {
        const card = await db.execute({
          sql: 'SELECT intervalo_dias FROM flashcards WHERE id = ? AND aluno_id = ?',
          args: [String(b.revisar), aluno.id]
        });
        if (!card.rows.length) return res.status(404).json({ erro: 'Cartão não encontrado' });
        const { dias } = proxima(card.rows[0].intervalo_dias, Number(b.nota) || 0);
        const quando = new Date(Date.now() + dias * 86400000).toISOString();
        await db.execute({
          sql: 'UPDATE flashcards SET intervalo_dias = ?, proxima_revisao = ? WHERE id = ? AND aluno_id = ?',
          args: [dias, quando, String(b.revisar), aluno.id]
        });
        return res.status(200).json({ ok: true, proxima_revisao: quando });
      }

      if (Array.isArray(b.lote) && b.topico_id) {
        const ja = await db.execute({
          sql: 'SELECT COUNT(*) AS n FROM flashcards WHERE aluno_id = ? AND origem = ?',
          args: [aluno.id, 'topico:' + b.topico_id]
        });
        if (Number(ja.rows[0].n) > 0) return res.status(200).json({ ok: true, criados: 0, ja_existiam: true });
        let criados = 0;
        for (const c of b.lote.slice(0, 12)) {
          if (!c || !c.frente || !c.verso) continue;
          await db.execute({
            sql: `INSERT INTO flashcards (id, aluno_id, frente, verso, origem, intervalo_dias, proxima_revisao, criado_em)
                  VALUES (?,?,?,?,?,0,?,?)`,
            args: [id(), aluno.id, String(c.frente).slice(0, 1000), String(c.verso).slice(0, 2000),
                   'topico:' + b.topico_id, agora(), agora()]
          });
          criados++;
        }
        return res.status(200).json({ ok: true, criados });
      }

      if (!b.frente || !b.verso) return res.status(400).json({ erro: 'frente e verso são obrigatórios' });
      const fid = id();
      await db.execute({
        sql: `INSERT INTO flashcards (id, aluno_id, frente, verso, origem, intervalo_dias, proxima_revisao, criado_em)
              VALUES (?,?,?,?,?,0,?,?)`,
        args: [fid, aluno.id, String(b.frente).slice(0, 1000), String(b.verso).slice(0, 2000),
               b.origem || null, agora(), agora()]
      });
      return res.status(200).json({ ok: true, id: fid });
    }

    return res.status(405).json({ erro: 'Método não suportado' });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
