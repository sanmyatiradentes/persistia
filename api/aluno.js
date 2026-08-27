// GET: perfil + config do aluno logado (401 sem token — sinaliza que a API existe).
// POST: salva config {data_prova, horas_dia, dias_semana}.
const { getDb, ensureSchema, agora, alunoDoToken, cors } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    if (req.method === 'GET') {
      const c = await db.execute({ sql: 'SELECT data_prova, horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [aluno.id] });
      const ev = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM eventos WHERE aluno_id = ?', args: [aluno.id] });
      const fc = await db.execute({
        sql: "SELECT COUNT(*) AS n FROM flashcards WHERE aluno_id = ? AND proxima_revisao <= ?",
        args: [aluno.id, agora()]
      });
      const ed = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM editais WHERE aluno_id = ?', args: [aluno.id] });
      return res.status(200).json({
        nome: aluno.nome, email: aluno.email,
        config: c.rows[0] || null,
        tem_edital: Number(ed.rows[0].n) > 0,
        eventos: Number(ev.rows[0].n),
        flashcards_devidos: Number(fc.rows[0].n)
      });
    }

    if (req.method === 'POST') {
      const { data_prova, horas_dia, dias_semana } = req.body || {};
      await db.execute({
        sql: `INSERT INTO config (aluno_id, data_prova, horas_dia, dias_semana, atualizado_em)
              VALUES (?,?,?,?,?)
              ON CONFLICT(aluno_id) DO UPDATE SET data_prova=excluded.data_prova,
                horas_dia=excluded.horas_dia, dias_semana=excluded.dias_semana,
                atualizado_em=excluded.atualizado_em`,
        args: [aluno.id, data_prova || null, Number(horas_dia) || null, Number(dias_semana) || null, agora()]
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ erro: 'Método não suportado' });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
