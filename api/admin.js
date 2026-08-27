// Painel da gestora. Só responde a e-mails listados em ADMIN_EMAILS.
// GET                                   → métricas + lista de alunos
// POST {aluno_id, acao:'cortesia', dias} → libera acesso sem cobrança
// POST {aluno_id, acao:'bloquear'|'liberar'}
// POST {aluno_id, acao:'resetar_teste', dias}
const { getDb, ensureSchema, agora, emDias, alunoDoToken, cors, ehAdmin, PRECO, TRIAL_DIAS } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  if (!ehAdmin(aluno.email)) return res.status(403).json({ erro: 'Área restrita' });
  const db = getDb();

  try {
    if (req.method === 'POST') {
      const { aluno_id, acao, dias } = req.body || {};
      if (!aluno_id || !acao) return res.status(400).json({ erro: 'Informe aluno_id e acao' });

      if (acao === 'cortesia') {
        const n = Math.min(3650, Math.max(1, Number(dias) || 30));
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, cortesia_ate, valor, atualizado_em)
                VALUES (?,?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET cortesia_ate = excluded.cortesia_ate, atualizado_em = excluded.atualizado_em`,
          args: [aluno_id, 'teste', emDias(n), PRECO, agora()]
        });
        return res.status(200).json({ ok: true, cortesia_dias: n });
      }
      if (acao === 'resetar_teste') {
        const n = Math.min(365, Math.max(1, Number(dias) || TRIAL_DIAS));
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, inicio_teste, fim_teste, valor, atualizado_em)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET estado='teste', inicio_teste=excluded.inicio_teste,
                  fim_teste=excluded.fim_teste, atualizado_em=excluded.atualizado_em`,
          args: [aluno_id, 'teste', agora(), emDias(n), PRECO, agora()]
        });
        return res.status(200).json({ ok: true, teste_dias: n });
      }
      if (acao === 'bloquear' || acao === 'liberar') {
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, valor, atualizado_em) VALUES (?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET estado = excluded.estado, atualizado_em = excluded.atualizado_em`,
          args: [aluno_id, acao === 'bloquear' ? 'bloqueada' : 'teste', PRECO, agora()]
        });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ erro: 'Ação não reconhecida' });
    }

    const alunos = await db.execute(`
      SELECT a.id, a.nome, a.email, a.criado_em,
             s.estado, s.fim_teste, s.cortesia_ate, s.proxima_cobranca,
             (SELECT COUNT(*) FROM eventos e WHERE e.aluno_id = a.id) AS eventos,
             (SELECT MAX(criado_em) FROM eventos e WHERE e.aluno_id = a.id) AS ultimo_evento,
             (SELECT titulo FROM editais ed WHERE ed.aluno_id = a.id ORDER BY ed.criado_em DESC LIMIT 1) AS edital,
             (SELECT COUNT(*) FROM cronograma c WHERE c.aluno_id = a.id) AS sessoes,
             (SELECT COUNT(*) FROM cronograma c WHERE c.aluno_id = a.id AND c.status = 'concluido') AS concluidas
      FROM alunos a LEFT JOIN assinaturas s ON s.aluno_id = a.id
      ORDER BY a.criado_em DESC LIMIT 500`);

    const hoje = agora();
    const lista = alunos.rows.map(r => {
      const cortesia = r.cortesia_ate && r.cortesia_ate > hoje;
      const emTeste = (r.estado || 'teste') === 'teste' && r.fim_teste && r.fim_teste > hoje;
      let situacao = 'expirado';
      if (r.estado === 'bloqueada') situacao = 'bloqueado';
      else if (r.estado === 'ativa') situacao = 'assinante';
      else if (cortesia) situacao = 'cortesia';
      else if (emTeste) situacao = 'teste';
      else if (!r.estado) situacao = 'novo';
      const fim = cortesia ? r.cortesia_ate : r.fim_teste;
      return {
        id: r.id, nome: r.nome, email: r.email, criado_em: r.criado_em,
        situacao,
        dias_restantes: fim ? Math.max(0, Math.ceil((new Date(fim) - new Date()) / 86400000)) : null,
        proxima_cobranca: r.proxima_cobranca || null,
        edital: r.edital || null,
        sessoes: Number(r.sessoes) || 0,
        concluidas: Number(r.concluidas) || 0,
        eventos: Number(r.eventos) || 0,
        ultimo_evento: r.ultimo_evento || null
      };
    });

    const cont = k => lista.filter(a => a.situacao === k).length;
    const ativos7 = lista.filter(a => a.ultimo_evento && (Date.now() - new Date(a.ultimo_evento)) < 7 * 86400000).length;
    const conteudos = await db.execute('SELECT COUNT(*) AS n FROM conteudos');
    let audios = 0;
    try { audios = Number((await db.execute('SELECT COUNT(*) AS n FROM audios')).rows[0].n); } catch (_) {}

    return res.status(200).json({
      metricas: {
        alunos: lista.length,
        assinantes: cont('assinante'),
        em_teste: cont('teste') + cont('novo'),
        cortesia: cont('cortesia'),
        expirados: cont('expirado'),
        bloqueados: cont('bloqueado'),
        ativos_7d: ativos7,
        receita_mensal: Math.round(cont('assinante') * PRECO * 100) / 100,
        preco: PRECO,
        catalogo_conteudos: Number(conteudos.rows[0].n) || 0,
        catalogo_audios: audios
      },
      alunos: lista
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
