// Os editais do aluno — todos, com a evolução de cada um.
//
// Uma conta guarda quantos editais o aluno quiser: o concurso que ele estuda
// hoje, o que ficou para depois, o do ano passado. Cada um tem cronograma,
// progresso e histórico próprios; trocar de edital não apaga nada, só muda
// qual deles está em estudo.
//
// GET                     → {editais:[...], ativo}
// POST {ativar: id}       → passa a estudar aquele edital (e adota a data de prova dele)
// POST {apagar: id}       → remove o edital e tudo que é dele (pede confirmação no app)
// POST {renomear: id, titulo}
const { getDb, ensureSchema, agora, alunoDoToken, cors, editalAtivo, marcarEditalAtivo } = require('./_lib');

function pct(feito, total) {
  return total > 0 ? Math.round((feito / total) * 100) : 0;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    const ativo = await editalAtivo(db, aluno.id);

    /* ---------------- POST ---------------- */
    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.ativar) {
        const alvo = await db.execute({
          sql: 'SELECT id, titulo, data_prova FROM editais WHERE id = ? AND aluno_id = ?',
          args: [String(body.ativar), aluno.id]
        });
        if (!alvo.rows.length) return res.status(404).json({ erro: 'Edital não encontrado' });
        await marcarEditalAtivo(db, aluno.id, alvo.rows[0].id);
        // a data da prova acompanha o edital escolhido, senão o plano fica
        // sendo medido contra a prova de outro concurso
        if (alvo.rows[0].data_prova) {
          await db.execute({
            sql: `INSERT INTO config (aluno_id, data_prova, atualizado_em) VALUES (?,?,?)
                  ON CONFLICT(aluno_id) DO UPDATE SET data_prova = excluded.data_prova,
                                                      atualizado_em = excluded.atualizado_em`,
            args: [aluno.id, alvo.rows[0].data_prova, agora()]
          });
        }
        const temPlano = await db.execute({
          sql: 'SELECT COUNT(*) AS n FROM cronograma WHERE aluno_id = ? AND edital_id = ?',
          args: [aluno.id, alvo.rows[0].id]
        });
        return res.status(200).json({
          ok: true, edital_id: alvo.rows[0].id, titulo: alvo.rows[0].titulo,
          // quando o edital nunca chegou a ter cronograma, o app manda gerar
          tem_cronograma: Number(temPlano.rows[0].n) > 0
        });
      }

      if (body.renomear) {
        const novo = String(body.titulo || '').trim().slice(0, 220);
        if (!novo) return res.status(400).json({ erro: 'Dê um nome ao edital' });
        await db.execute({
          sql: 'UPDATE editais SET titulo = ? WHERE id = ? AND aluno_id = ?',
          args: [novo, String(body.renomear), aluno.id]
        });
        return res.status(200).json({ ok: true });
      }

      if (body.apagar) {
        const alvoId = String(body.apagar);
        const existe = await db.execute({
          sql: 'SELECT id FROM editais WHERE id = ? AND aluno_id = ?', args: [alvoId, aluno.id]
        });
        if (!existe.rows.length) return res.status(404).json({ erro: 'Edital não encontrado' });

        await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ? AND edital_id = ?', args: [aluno.id, alvoId] });
        await db.execute({
          sql: 'DELETE FROM topicos WHERE disciplina_id IN (SELECT id FROM disciplinas WHERE edital_id = ?)',
          args: [alvoId]
        });
        await db.execute({ sql: 'DELETE FROM disciplinas WHERE edital_id = ?', args: [alvoId] });
        await db.execute({ sql: 'DELETE FROM editais WHERE id = ? AND aluno_id = ?', args: [alvoId, aluno.id] });

        // se o apagado era o que estava em estudo, adota o mais recente que sobrou
        let novoAtivo = null;
        if (ativo && ativo.id === alvoId) {
          const resta = await db.execute({
            sql: 'SELECT id FROM editais WHERE aluno_id = ? ORDER BY criado_em DESC LIMIT 1', args: [aluno.id]
          });
          if (resta.rows.length) {
            await marcarEditalAtivo(db, aluno.id, resta.rows[0].id);
            novoAtivo = resta.rows[0].id;
          }
        }
        return res.status(200).json({ ok: true, ativo: novoAtivo });
      }

      return res.status(400).json({ erro: 'Diga o que fazer: ativar, renomear ou apagar' });
    }

    /* ---------------- GET: a lista com a evolução ---------------- */
    const eds = await db.execute({
      sql: 'SELECT id, titulo, data_prova, banca, cargo, criado_em FROM editais WHERE aluno_id = ? ORDER BY criado_em DESC',
      args: [aluno.id]
    });
    if (!eds.rows.length) return res.status(200).json({ editais: [], ativo: null });

    // números de todos os editais de uma vez só: uma consulta por métrica,
    // em vez de uma por edital (a conta pode ter muitos)
    const conteudo = await db.execute({
      sql: `SELECT d.edital_id AS eid, COUNT(DISTINCT d.id) AS discs, COUNT(t.id) AS tops,
                   COALESCE(SUM(t.peso), 0) AS horas
            FROM disciplinas d LEFT JOIN topicos t ON t.disciplina_id = d.id
            WHERE d.edital_id IN (SELECT id FROM editais WHERE aluno_id = ?)
            GROUP BY d.edital_id`,
      args: [aluno.id]
    });
    const plano = await db.execute({
      sql: `SELECT edital_id AS eid, COUNT(*) AS sessoes,
                   SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END) AS feitas,
                   COALESCE(SUM(horas), 0) AS horas_plano,
                   COALESCE(SUM(CASE WHEN status = 'concluido' THEN horas ELSE 0 END), 0) AS horas_feitas,
                   COUNT(DISTINCT data) AS dias, MAX(data) AS ultima_data
            FROM cronograma WHERE aluno_id = ? AND edital_id IS NOT NULL
            GROUP BY edital_id`,
      args: [aluno.id]
    });

    const porId = {};
    for (const r of conteudo.rows) {
      porId[r.eid] = { discs: Number(r.discs) || 0, tops: Number(r.tops) || 0, horas: Number(r.horas) || 0 };
    }
    const planoPorId = {};
    for (const r of plano.rows) {
      planoPorId[r.eid] = {
        sessoes: Number(r.sessoes) || 0, feitas: Number(r.feitas) || 0,
        horas_plano: Number(r.horas_plano) || 0, horas_feitas: Number(r.horas_feitas) || 0,
        dias: Number(r.dias) || 0, termina_em: r.ultima_data || null
      };
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const lista = eds.rows.map(e => {
      const c = porId[e.id] || { discs: 0, tops: 0, horas: 0 };
      const p = planoPorId[e.id] || { sessoes: 0, feitas: 0, horas_plano: 0, horas_feitas: 0, dias: 0, termina_em: null };
      let diasParaProva = null;
      if (e.data_prova) {
        diasParaProva = Math.round((new Date(e.data_prova + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
      }
      return {
        id: e.id, titulo: e.titulo, banca: e.banca || null, cargo: e.cargo || null,
        data_prova: e.data_prova || null, dias_para_prova: diasParaProva,
        criado_em: e.criado_em,
        ativo: !!(ativo && ativo.id === e.id),
        n_disciplinas: c.discs, n_topicos: c.tops,
        horas_edital: Math.round(c.horas * 10) / 10,
        tem_cronograma: p.sessoes > 0,
        sessoes: p.sessoes, concluidas: p.feitas,
        percentual: pct(p.feitas, p.sessoes),
        horas_feitas: Math.round(p.horas_feitas * 10) / 10,
        horas_plano: Math.round(p.horas_plano * 10) / 10,
        dias_de_estudo: p.dias, termina_em: p.termina_em
      };
    });

    return res.status(200).json({ editais: lista, ativo: ativo ? ativo.id : null });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro ao ler seus editais', detalhe: String(e).slice(0, 200) });
  }
};
