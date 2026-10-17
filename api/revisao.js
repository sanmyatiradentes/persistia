// Revisão do dia e caderno de erros.
// GET                       → revisão de hoje: assuntos vencidos + erros vencidos,
//                             questões misturadas entre disciplinas (intercaladas)
// GET ?caderno=1            → caderno de erros completo
// POST {erro: {topico_id, parte, partes, questao}}           → anota uma questão errada
// POST {resultado: {topicos: [{topico_id, parte, acertos, total}], erros: [{id, acertou}]}}
const { getDb, ensureSchema, alunoDoToken, cors, editalAtivo } = require('./_lib');
const R = require('./_revisao');

const MAX_ASSUNTOS = 4;      // assuntos por revisão (os outros ficam para amanhã)
const POR_ASSUNTO = 3;       // questões de cada assunto
const MAX_ERROS = 5;         // erros do caderno por revisão

function embaralhar(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function pacoteDe(db, topicoId, parte, partes) {
  const chave = Number(partes) > 1 ? topicoId + ':' + parte + '/' + partes : topicoId;
  for (const k of [chave, chave + '::pratica']) {
    const r = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [k] });
    if (r.rows.length) { try { return JSON.parse(r.rows[0].json); } catch (_) { /* segue */ } }
  }
  return null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();
  const edital = await editalAtivo(db, aluno.id);
  const editalId = edital ? edital.id : null;
  const hoje = R.hojeISO();

  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.erro && b.erro.questao) {
        await R.anotarErro(db, aluno.id, editalId, b.erro.topico_id, b.erro.parte, b.erro.partes, b.erro.questao);
        return res.status(200).json({ ok: true });
      }
      if (b.resultado) {
        const saida = [];
        for (const t of (b.resultado.topicos || [])) {
          const r = await R.registrarRevisao(db, aluno.id, String(t.topico_id), t.parte, Number(t.acertos) || 0, Number(t.total) || 0);
          if (r) saida.push(Object.assign({ topico_id: t.topico_id, parte: t.parte }, r));
        }
        for (const e of (b.resultado.erros || [])) await R.registrarErro(db, aluno.id, String(e.id), !!e.acertou);
        return res.status(200).json({ ok: true, topicos: saida });
      }
      return res.status(400).json({ erro: 'Pedido inválido' });
    }

    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('caderno')) {
      const r = await db.execute({
        sql: `SELECT e.id, e.questao, e.acertos_seguidos, e.vezes_errada, e.dominado, e.proxima, e.criado_em,
                     e.parte, e.partes, t.nome AS topico, d.nome AS disciplina
              FROM erros e LEFT JOIN topicos t ON t.id = e.topico_id LEFT JOIN disciplinas d ON d.id = t.disciplina_id
              WHERE e.aluno_id = ? AND (e.edital_id = ? OR e.edital_id IS NULL OR ? IS NULL)
              ORDER BY e.dominado, e.atualizado_em DESC LIMIT 400`,
        args: [aluno.id, editalId, editalId]
      });
      return res.status(200).json({
        erros: r.rows.map(x => ({
          id: x.id, questao: JSON.parse(x.questao), topico: x.topico, disciplina: x.disciplina,
          parte: x.parte, partes: x.partes, vezes_errada: x.vezes_errada,
          dominado: !!x.dominado, acertos_seguidos: x.acertos_seguidos, devido: !x.dominado && x.proxima <= hoje
        }))
      });
    }

    // quem já tinha sessões concluídas antes da revisão existir: elas entram
    // na revisão a partir de hoje (uma vez só; depois seguem a escada normal)
    if (editalId) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO revisoes (aluno_id, edital_id, topico_id, parte, partes, etapa, proxima, atualizado_em)
              SELECT aluno_id, edital_id, topico_id, COALESCE(parte, 1), COALESCE(partes, 1), 0, ?, ?
              FROM cronograma WHERE aluno_id = ? AND edital_id = ? AND status = 'concluido'`,
        args: [hoje, new Date().toISOString(), aluno.id, editalId]
      });
    }

    // assuntos vencidos: reforço primeiro, depois o mais atrasado
    const venc = await db.execute({
      sql: `SELECT r.topico_id, r.parte, r.partes, r.etapa, r.reforco, r.proxima, t.nome AS topico, d.nome AS disciplina
            FROM revisoes r JOIN topicos t ON t.id = r.topico_id JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE r.aluno_id = ? AND r.proxima <= ? AND (r.edital_id = ? OR ? IS NULL)
            ORDER BY r.reforco DESC, r.proxima, r.atualizado_em`,
      args: [aluno.id, hoje, editalId, editalId]
    });
    const errosVenc = await db.execute({
      sql: `SELECT e.id, e.questao, e.topico_id, e.parte, e.chave, t.nome AS topico, d.nome AS disciplina
            FROM erros e LEFT JOIN topicos t ON t.id = e.topico_id LEFT JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE e.aluno_id = ? AND e.dominado = 0 AND e.proxima <= ? AND (e.edital_id = ? OR e.edital_id IS NULL OR ? IS NULL)
            ORDER BY e.proxima LIMIT ?`,
      args: [aluno.id, hoje, editalId, editalId, MAX_ERROS]
    });
    const usadas = new Set(errosVenc.rows.map(e => e.chave));

    const assuntos = [], questoes = [];
    for (const v of venc.rows) {
      if (assuntos.length >= MAX_ASSUNTOS) break;
      const p = await pacoteDe(db, v.topico_id, v.parte, v.partes);
      if (!p) continue;
      const ce = embaralhar((p.questoes || []).filter(q => q && q.enunciado && !usadas.has(R.chaveDaQuestao(q))));
      const me = embaralhar((p.questoes_me || []).filter(q => q && q.enunciado && Array.isArray(q.alternativas) && !usadas.has(R.chaveDaQuestao(q))));
      // de preferência 2 de Certo/Errado e 1 de múltipla escolha
      const escolha = ce.slice(0, me.length ? POR_ASSUNTO - 1 : POR_ASSUNTO).concat(me.slice(0, 1));
      if (escolha.length < POR_ASSUNTO) escolha.push(...ce.slice(escolha.length, POR_ASSUNTO));
      if (!escolha.length) continue;
      const cron = await db.execute({
        sql: 'SELECT id FROM cronograma WHERE aluno_id = ? AND topico_id = ? AND COALESCE(parte, 1) = ? LIMIT 1',
        args: [aluno.id, v.topico_id, Number(v.parte) || 1]
      });
      assuntos.push({
        topico_id: v.topico_id, parte: v.parte, partes: v.partes, topico: v.topico, disciplina: v.disciplina,
        etapa: v.etapa, reforco: !!v.reforco, cron_id: (cron.rows[0] || {}).id || null, questoes: escolha.length
      });
      for (const q of escolha) {
        questoes.push({
          origem: 'revisao', topico_id: v.topico_id, parte: v.parte, partes: v.partes, topico: v.topico, disciplina: v.disciplina,
          tipo: Array.isArray(q.alternativas) ? 'me' : 'ce', enunciado: q.enunciado, alternativas: q.alternativas,
          correta: q.correta, gabarito: q.gabarito, comentario: q.comentario
        });
      }
    }
    for (const e of errosVenc.rows) {
      let q; try { q = JSON.parse(e.questao); } catch (_) { continue; }
      questoes.push(Object.assign({ origem: 'erro', erro_id: e.id, topico_id: e.topico_id, parte: e.parte,
        topico: e.topico, disciplina: e.disciplina }, q));
    }

    const fc = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM flashcards WHERE aluno_id = ? AND proxima_revisao <= ?',
      args: [aluno.id, new Date().toISOString()]
    });
    const cad = await db.execute({
      sql: 'SELECT COUNT(*) AS total, SUM(CASE WHEN dominado = 0 THEN 1 ELSE 0 END) AS ativos FROM erros WHERE aluno_id = ?',
      args: [aluno.id]
    });

    return res.status(200).json({
      assuntos,
      assuntos_vencidos: venc.rows.length,
      // intercaladas: disciplinas misturadas, como na prova
      questoes: embaralhar(questoes),
      erros_vencidos: errosVenc.rows.length,
      fc_vencidos: Number((fc.rows[0] || {}).n) || 0,
      caderno: { total: Number((cad.rows[0] || {}).total) || 0, ativos: Number((cad.rows[0] || {}).ativos) || 0 },
      minutos: Math.max(1, Math.round(questoes.length * 1.2 + Math.min(10, Number((fc.rows[0] || {}).n) || 0) * 0.5))
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
