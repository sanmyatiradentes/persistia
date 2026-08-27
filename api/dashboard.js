// Dashboard real do aluno: cobertura, verbos, acerto em questões, constância.
const { getDb, ensureSchema, agora, alunoDoToken, cors } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    const cron = await db.execute({
      sql: `SELECT c.status, d.nome AS disciplina FROM cronograma c
            JOIN topicos t ON t.id = c.topico_id JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE c.aluno_id = ?`,
      args: [aluno.id]
    });
    const porDisc = {};
    let total = 0, concl = 0;
    for (const r of cron.rows) {
      total++;
      porDisc[r.disciplina] = porDisc[r.disciplina] || { total: 0, concluidos: 0 };
      porDisc[r.disciplina].total++;
      if (r.status === 'concluido') { concl++; porDisc[r.disciplina].concluidos++; }
    }

    const verbos = await db.execute({
      sql: `SELECT verbo, COUNT(*) AS n FROM eventos WHERE aluno_id = ? AND verbo IS NOT NULL GROUP BY verbo`,
      args: [aluno.id]
    });

    const qs = await db.execute({
      sql: `SELECT detalhe FROM eventos WHERE aluno_id = ? AND tipo = 'questao' ORDER BY criado_em DESC LIMIT 200`,
      args: [aluno.id]
    });
    let qTotal = 0, qCertas = 0;
    for (const r of qs.rows) {
      try {
        const d = JSON.parse(r.detalhe || '{}');
        if (typeof d.respondeu_certo === 'boolean') { qTotal++; if (d.respondeu_certo) qCertas++; }
      } catch (_) {}
    }

    const dias = await db.execute({
      sql: `SELECT DISTINCT substr(criado_em, 1, 10) AS dia FROM eventos WHERE aluno_id = ? ORDER BY dia DESC LIMIT 60`,
      args: [aluno.id]
    });
    let streak = 0;
    const hoje = new Date();
    for (let i = 0; i < dias.rows.length; i++) {
      const esperado = new Date(hoje.getTime() - streak * 86400000).toISOString().slice(0, 10);
      const anterior = new Date(hoje.getTime() - (streak + 1) * 86400000).toISOString().slice(0, 10);
      const dia = dias.rows[i].dia;
      if (dia === esperado || (streak === 0 && dia === anterior)) streak++;
      else break;
    }

    const fc = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM flashcards WHERE aluno_id = ? AND proxima_revisao <= ?',
      args: [aluno.id, agora()]
    });

    return res.status(200).json({
      cobertura: { total, concluidos: concl, pct: total ? Math.round(100 * concl / total) : 0 },
      por_disciplina: Object.keys(porDisc).map(nome => ({
        nome, total: porDisc[nome].total, concluidos: porDisc[nome].concluidos,
        pct: Math.round(100 * porDisc[nome].concluidos / porDisc[nome].total)
      })),
      por_verbo: verbos.rows.map(r => ({ verbo: r.verbo, eventos: Number(r.n) })),
      questoes: { total: qTotal, certas: qCertas, pct: qTotal ? Math.round(100 * qCertas / qTotal) : null },
      constancia_dias: streak,
      flashcards_devidos: Number(fc.rows[0].n),
      dias_ativos: dias.rows.map(r => r.dia)
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
