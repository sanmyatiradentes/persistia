// Cronograma vivo do aluno.
// POST {gerar:true}        → (re)gera o cronograma a partir do último edital + config
// POST {concluir: id}      → marca um item como concluído
// GET                      → {hoje, proximos, resumo}
const { getDb, ensureSchema, agora, id, alunoDoToken, cors } = require('./_lib');

function hojeISO() { return new Date().toISOString().slice(0, 10); }

function proximasDatas(qtd, diasSemana) {
  // diasSemana: 5 (seg–sex), 6 (seg–sáb), 7 (todos)
  const datas = [];
  const d = new Date();
  while (datas.length < qtd) {
    const dow = d.getDay(); // 0 = domingo, 6 = sábado
    const ok = diasSemana >= 7 || (diasSemana === 6 && dow !== 0) || (diasSemana <= 5 && dow !== 0 && dow !== 6);
    if (ok) datas.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return datas;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    const ed = await db.execute({
      sql: 'SELECT id, titulo, data_prova FROM editais WHERE aluno_id = ? ORDER BY criado_em DESC LIMIT 1',
      args: [aluno.id]
    });
    if (!ed.rows.length) return res.status(200).json({ sem_edital: true });
    const edital = ed.rows[0];

    if (req.method === 'POST' && (req.body || {}).concluir) {
      await db.execute({
        sql: "UPDATE cronograma SET status='concluido' WHERE id = ? AND aluno_id = ?",
        args: [String(req.body.concluir), aluno.id]
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && (req.body || {}).gerar) {
      const cfg = await db.execute({ sql: 'SELECT horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [aluno.id] });
      const horas = Number((cfg.rows[0] || {}).horas_dia) || 2;
      const dias = Number((cfg.rows[0] || {}).dias_semana) || 6;
      const porDia = horas >= 3 ? 2 : 1;

      const tops = await db.execute({
        sql: `SELECT t.id AS topico_id, t.nome, t.ordem AS t_ordem, d.id AS disc_id, d.nome AS disciplina, d.ordem AS d_ordem
              FROM topicos t JOIN disciplinas d ON d.id = t.disciplina_id
              WHERE d.edital_id = ? ORDER BY d.ordem, t.ordem`,
        args: [edital.id]
      });
      if (!tops.rows.length) return res.status(422).json({ erro: 'Edital sem tópicos' });

      // intercalação: round-robin entre disciplinas
      const porDisc = new Map();
      for (const t of tops.rows) {
        if (!porDisc.has(t.disc_id)) porDisc.set(t.disc_id, []);
        porDisc.get(t.disc_id).push(t);
      }
      const filas = Array.from(porDisc.values());
      const ordenado = [];
      let resta = true;
      while (resta) {
        resta = false;
        for (const fila of filas) {
          if (fila.length) { ordenado.push(fila.shift()); resta = true; }
        }
      }

      await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ?', args: [aluno.id] });
      const nDias = Math.ceil(ordenado.length / porDia);
      const datas = proximasDatas(nDias, dias);
      for (let i = 0; i < ordenado.length; i++) {
        await db.execute({
          sql: 'INSERT INTO cronograma (id, aluno_id, topico_id, data, ordem, status) VALUES (?,?,?,?,?,?)',
          args: [id(), aluno.id, ordenado[i].topico_id, datas[Math.floor(i / porDia)], i, 'pendente']
        });
      }
      return res.status(200).json({ ok: true, itens: ordenado.length, termina_em: datas[datas.length - 1] });
    }

    // GET — visão do dia
    const rows = await db.execute({
      sql: `SELECT c.id AS cron_id, c.data, c.ordem, c.status, t.id AS topico_id, t.nome AS topico,
                   d.nome AS disciplina
            FROM cronograma c
            JOIN topicos t ON t.id = c.topico_id
            JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE c.aluno_id = ? ORDER BY c.ordem`,
      args: [aluno.id]
    });
    if (!rows.rows.length) return res.status(200).json({ sem_cronograma: true, edital: edital.titulo });

    const todos = rows.rows;
    const hoje = todos.find(r => r.status !== 'concluido') || todos[todos.length - 1];
    const proximos = todos.filter(r => r.ordem > hoje.ordem).slice(0, 12);

    const porDisc = {};
    for (const r of todos) {
      porDisc[r.disciplina] = porDisc[r.disciplina] || { total: 0, concluidos: 0 };
      porDisc[r.disciplina].total++;
      if (r.status === 'concluido') porDisc[r.disciplina].concluidos++;
    }
    const concluidos = todos.filter(r => r.status === 'concluido').length;

    const assuntoHoje = hoje.topico + ' — ' + hoje.disciplina;
    const prog = await db.execute({
      sql: 'SELECT verbo, status FROM progresso WHERE aluno_id = ? AND assunto = ?',
      args: [aluno.id, assuntoHoje]
    });

    return res.status(200).json({
      edital: edital.titulo, data_prova: edital.data_prova,
      verbos_hoje: prog.rows.map(r => ({ verbo: r.verbo, status: r.status })),
      hoje: { cron_id: hoje.cron_id, topico_id: hoje.topico_id, topico: hoje.topico, disciplina: hoje.disciplina, data: hoje.data, atrasado: hoje.data < hojeISO() },
      proximos: proximos.map(r => ({ topico: r.topico, disciplina: r.disciplina, data: r.data, status: r.status })),
      resumo: {
        total: todos.length, concluidos,
        termina_em: todos[todos.length - 1].data,
        por_disciplina: Object.keys(porDisc).map(nome => ({ nome, total: porDisc[nome].total, concluidos: porDisc[nome].concluidos }))
      }
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
