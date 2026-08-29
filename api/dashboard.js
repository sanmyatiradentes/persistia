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

    // série semanal de acerto (8 semanas)
    const qsem = await db.execute({
      sql: `SELECT criado_em, detalhe FROM eventos WHERE aluno_id = ? AND tipo = 'questao' ORDER BY criado_em`,
      args: [aluno.id]
    });
    const semanas = [];
    const hojeMs = Date.now();
    for (let w = 7; w >= 0; w--) {
      const ini = hojeMs - (w + 1) * 7 * 86400000, fim = hojeMs - w * 7 * 86400000;
      let t = 0, c = 0;
      for (const r of qsem.rows) {
        const ts = Date.parse(r.criado_em);
        if (ts > ini && ts <= fim) {
          try { const d = JSON.parse(r.detalhe || '{}'); if (typeof d.respondeu_certo === 'boolean') { t++; if (d.respondeu_certo) c++; } } catch (_) {}
        }
      }
      semanas.push({ semana: 8 - w, total: t, pct: t ? Math.round(100 * c / t) : null });
    }

    // ----- evolução dia a dia (últimos 30 dias) -----
    const ev30 = await db.execute({
      sql: `SELECT substr(criado_em,1,10) AS dia, tipo, verbo, detalhe FROM eventos
            WHERE aluno_id = ? AND criado_em >= ? ORDER BY criado_em`,
      args: [aluno.id, new Date(Date.now() - 30 * 86400000).toISOString()]
    });
    const mapaDia = {};
    for (const r of ev30.rows) {
      const d = mapaDia[r.dia] || (mapaDia[r.dia] = { dia: r.dia, eventos: 0, verbos: {}, questoes: 0, certas: 0, sessoes: 0 });
      d.eventos++;
      if (r.verbo) d.verbos[r.verbo] = (d.verbos[r.verbo] || 0) + 1;
      if (r.tipo === 'questao') {
        try {
          const x = JSON.parse(r.detalhe || '{}');
          if (typeof x.respondeu_certo === 'boolean') { d.questoes++; if (x.respondeu_certo) d.certas++; }
        } catch (_) {}
      }
      if (r.tipo === 'sessao_concluida' || r.tipo === 'topico_concluido') d.sessoes++;
    }
    const porDia = [];
    for (let i = 29; i >= 0; i--) {
      const iso = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const d = mapaDia[iso];
      porDia.push({
        dia: iso,
        eventos: d ? d.eventos : 0,
        verbos: d ? Object.keys(d.verbos).sort() : [],
        questoes: d ? d.questoes : 0,
        certas: d ? d.certas : 0,
        pct: d && d.questoes ? Math.round(100 * d.certas / d.questoes) : null,
        sessoes: d ? d.sessoes : 0
      });
    }

    const primeiro = await db.execute({
      sql: 'SELECT MIN(criado_em) AS d FROM eventos WHERE aluno_id = ?', args: [aluno.id]
    });
    const inicio = primeiro.rows[0].d || agora();
    const diaJornada = Math.max(1, Math.floor((Date.now() - Date.parse(inicio)) / 86400000) + 1);

    const devidos = await db.execute({
      sql: `SELECT frente, origem, proxima_revisao FROM flashcards
            WHERE aluno_id = ? AND proxima_revisao <= ? ORDER BY proxima_revisao LIMIT 6`,
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
      dias_ativos: dias.rows.map(r => r.dia),
      por_dia: porDia,
      semanas,
      dia_jornada: diaJornada,
      revisoes: devidos.rows.map(r => ({ frente: r.frente, origem: r.origem }))
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
