// Registra um evento de estudo e atualiza o progresso do verbo.
// POST {tipo, assunto, verbo, status?, detalhe?}
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, iniciarTeste } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const { tipo, assunto, verbo, status, detalhe } = req.body || {};
  if (!tipo) return res.status(400).json({ erro: 'tipo é obrigatório' });

  const db = getDb();
  try {
    await db.execute({
      sql: 'INSERT INTO eventos (id, aluno_id, tipo, assunto, verbo, detalhe, criado_em) VALUES (?,?,?,?,?,?,?)',
      args: [id(), aluno.id, String(tipo), assunto || null, verbo || null,
             detalhe ? JSON.stringify(detalhe).slice(0, 2000) : null, agora()]
    });
    if (assunto && verbo) {
      await db.execute({
        sql: `INSERT INTO progresso (aluno_id, assunto, verbo, status, atualizado_em) VALUES (?,?,?,?,?)
              ON CONFLICT(aluno_id, assunto, verbo) DO UPDATE SET
                -- verbo concluído não volta para "em andamento" (rever um cartão
                -- ou responder mais uma questão depois de terminar desfazia o feito)
                status = CASE WHEN progresso.status = 'concluido' THEN 'concluido' ELSE excluded.status END,
                atualizado_em=excluded.atualizado_em`,
        args: [aluno.id, String(assunto), String(verbo), status || 'concluido', agora()]
      });
      // primeira atividade de estudo concluída: é aqui que os dias de teste começam a contar
      if ((status || 'concluido') === 'concluido') await iniciarTeste(aluno.id);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
