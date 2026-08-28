// Biblioteca do aluno: tudo o que já foi criado para ele, num lugar só.
// GET → { assuntos: [...], gravacoes: [...] }
//
// Os assuntos saem do cruzamento entre o cronograma dele e o catálogo de
// conteúdos já gerados — por isso mapa mental, infográfico e vídeo aparecem em
// qualquer aparelho: eles são desenhados na hora a partir do conteúdo.
// As gravações de voz ficam no aparelho onde foram feitas; aqui vem só a ficha
// (assunto, data, duração, fluência), para o aluno saber o que gravou e onde.
const { getDb, ensureSchema, alunoDoToken, cors, acessoDoAluno } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

  const db = getDb();
  try {
    const linhas = await db.execute({
      sql: `SELECT c.id AS cron_id, c.data, c.status, c.parte, c.partes, c.horas,
                   t.id AS topico_id, t.nome AS topico, d.nome AS disciplina, d.ordem AS d_ordem
            FROM cronograma c
            JOIN topicos t ON t.id = c.topico_id
            JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE c.aluno_id = ? ORDER BY c.ordem`,
      args: [aluno.id]
    });

    // quais desses já têm pacote gerado (e áudio de estúdio pronto)
    const assuntos = [];
    for (const r of linhas.rows) {
      const chave = Number(r.partes) > 1 ? r.topico_id + ':' + r.parte + '/' + r.partes : r.topico_id;
      const c = await db.execute({ sql: 'SELECT json, criado_em FROM conteudos WHERE topico_id = ?', args: [chave] });
      if (!c.rows.length) continue;

      let p = {};
      try { p = JSON.parse(c.rows[0].json); } catch (_) {}

      let audios = [];
      try {
        const a = await db.execute({ sql: 'SELECT tipo FROM audios WHERE topico_id = ?', args: [chave] });
        audios = a.rows.map(x => x.tipo);
      } catch (_) {}

      assuntos.push({
        cron_id: r.cron_id,
        topico_id: r.topico_id,
        topico: r.topico,
        disciplina: r.disciplina,
        subtitulo: p.subtitulo || null,
        parte: Number(r.parte) || 1,
        partes: Number(r.partes) || 1,
        horas: r.horas || null,
        data: r.data,
        concluido: r.status === 'concluido',
        criado_em: c.rows[0].criado_em,
        tem_mapa: !!(p.mapa && (p.mapa.ramos || []).length),
        tem_numeros: !!(p.numeros || []).length,
        n_questoes: (p.questoes || []).length + (p.questoes_me || []).length,
        n_flashcards: (p.flashcards || []).length,
        audios
      });
    }

    // gravações de voz: a ficha fica no servidor, o áudio no aparelho
    const ev = await db.execute({
      sql: `SELECT assunto, detalhe, criado_em FROM eventos
            WHERE aluno_id = ? AND tipo = 'voz_alta' ORDER BY criado_em DESC LIMIT 100`,
      args: [aluno.id]
    });
    const gravacoes = ev.rows.map(r => {
      let d = {};
      try { d = JSON.parse(r.detalhe || '{}'); } catch (_) {}
      return {
        assunto: r.assunto || 'Leitura',
        quando: r.criado_em,
        segundos: Number(d.segundos) || null,
        ppm: Number(d.ppm) || null,
        trecho: (d.transcricao || '').slice(0, 160) || null
      };
    });

    return res.status(200).json({
      assuntos,
      gravacoes,
      resumo: {
        assuntos: assuntos.length,
        com_audio: assuntos.filter(a => a.audios.length).length,
        gravacoes: gravacoes.length
      }
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
