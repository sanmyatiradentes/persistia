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

// Dias de estudo daqui para frente, até um limite.
function datasAPartirDeHoje(qtd, diasSemana) { return proximasDatas(qtd, diasSemana); }

/**
 * Replanejamento automático.
 *
 * O que atrasou não desaparece nem some da fila: ele é redistribuído a partir de
 * hoje, respeitando os dias que o aluno estuda. A data da prova é sagrada — em
 * vez de empurrar o fim para depois dela, o sistema aperta os dias que restam,
 * até um teto (por padrão 1,5× a carga normal). Se nem apertando couber, ele diz
 * isso com todas as letras em vez de fingir que cabe.
 *
 * Vale também para quem adianta: as sessões pendentes puxam para a frente.
 */
async function replanejar(db, alunoId, dataProva) {
  const cfg = await db.execute({
    sql: 'SELECT horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [alunoId]
  });
  const horasDia = Math.max(0.5, Number((cfg.rows[0] || {}).horas_dia) || 2);
  const diasSemana = Number((cfg.rows[0] || {}).dias_semana) || 6;
  const teto = horasDia * (Number(process.env.FATOR_APERTO) || 1.5);

  const pend = await db.execute({
    sql: `SELECT id, data, ordem, horas, topico_id FROM cronograma
          WHERE aluno_id = ? AND status <> 'concluido' ORDER BY ordem`,
    args: [alunoId]
  });
  if (!pend.rows.length) return null;

  const hoje = hojeISO();
  const atrasadas = pend.rows.filter(r => r.data < hoje).length;

  // "Adiantado" é quem já concluiu sessões e ficou sem nada para hoje.
  // Sem esta conferência, um cronograma RECÉM-MONTADO era tratado como
  // adiantado — bastava o primeiro dia cair amanhã (hoje é domingo, ou dia de
  // descanso) — e o plano era comprimido na hora para 1,5× a carga escolhida:
  // a aluna pedia 6 h por dia e recebia dias de 9 h sem ter estudado nada ainda.
  const feitas = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM cronograma WHERE aluno_id = ? AND status = 'concluido'",
    args: [alunoId]
  });
  const jaEstudou = Number((feitas.rows[0] || {}).n) > 0;
  const adiantado = jaEstudou && pend.rows.every(r => r.data > hoje);
  if (!atrasadas && !adiantado) return null;               // nada a fazer

  // quantos dias de estudo existem até a prova (ou 180 dias, sem data)
  let limiteDias = 180;
  if (dataProva && dataProva >= hoje) {
    const bruto = Math.floor((new Date(dataProva + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
    limiteDias = Math.max(1, Math.min(400, bruto));
  }
  const candidatas = datasAPartirDeHoje(limiteDias, diasSemana)
    .filter(d => !dataProva || d < dataProva || !dataProva);
  const dias = (dataProva && dataProva >= hoje)
    ? candidatas.filter(d => d <= dataProva)
    : candidatas;
  if (!dias.length) return { sem_dias: true, sobraram: pend.rows.length };

  // Primeiro tenta na carga normal; só aperta se for preciso para caber.
  function distribuir(limitePorDia) {
    const mapa = [];
    let i = 0, usadas = 0, noDia = new Set();
    for (let k = 0; k < pend.rows.length; k++) {
      const s = pend.rows[k];
      const h = Number(s.horas) || 1;
      const estoura = usadas > 0 && (usadas + h > limitePorDia + 0.25);
      const repetido = noDia.has(s.topico_id);          // partes do mesmo tópico em dias diferentes
      if (estoura || repetido) { i++; usadas = 0; noDia = new Set(); }
      // Acabaram os dias: o que sobra NÃO é empilhado no último dia. Empilhar
      // criaria um dia de dez horas e um plano que mente que cabe.
      if (i >= dias.length) return { mapa, sobra: pend.rows.length - k };
      mapa.push({ id: s.id, data: dias[i] });
      usadas += h; noDia.add(s.topico_id);
    }
    return { mapa, sobra: 0 };
  }

  let r = distribuir(horasDia);
  let apertou = false;
  if (r.sobra > 0) { r = distribuir(teto); apertou = true; }

  for (const m of r.mapa) {
    await db.execute({ sql: 'UPDATE cronograma SET data = ? WHERE id = ?', args: [m.data, m.id] });
  }

  const ultima = r.mapa.length ? r.mapa[r.mapa.length - 1].data : null;
  return {
    replanejado: true,
    atrasadas,
    reagendadas: r.mapa.length,
    apertou,
    carga_dia: Math.round((apertou ? teto : horasDia) * 10) / 10,
    nao_coube: r.sobra,
    termina_em: ultima
  };
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
      // As horas podem vir no próprio pedido. Antes só vinham da tabela config,
      // e quem já tinha uma configuração antiga via a escolha nova ser ignorada
      // em silêncio: a aluna marcava 6 h por dia e o plano continuava montado
      // com as 3 h de antes, um assunto por dia. Agora o que ela escolher manda,
      // e fica gravado.
      const pedidoHoras = Number((req.body || {}).horas_dia);
      const pedidoDias = Number((req.body || {}).dias_semana);
      if (isFinite(pedidoHoras) && pedidoHoras > 0) {
        await db.execute({
          sql: `INSERT INTO config (aluno_id, horas_dia, dias_semana, atualizado_em)
                VALUES (?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET
                  horas_dia = excluded.horas_dia,
                  dias_semana = COALESCE(excluded.dias_semana, config.dias_semana),
                  atualizado_em = excluded.atualizado_em`,
          args: [aluno.id, Math.min(14, Math.max(0.5, pedidoHoras)),
                 (isFinite(pedidoDias) && pedidoDias >= 1 && pedidoDias <= 7) ? pedidoDias : null, agora()]
        });
      }
      const cfg = await db.execute({ sql: 'SELECT horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [aluno.id] });
      const horasDia = Math.max(0.5, Number((cfg.rows[0] || {}).horas_dia) || 2);
      const dias = Number((cfg.rows[0] || {}).dias_semana) || 6;

      const tops = await db.execute({
        sql: `SELECT t.id AS topico_id, t.nome, t.peso, t.ordem AS t_ordem, d.id AS disc_id, d.nome AS disciplina, d.ordem AS d_ordem
              FROM topicos t JOIN disciplinas d ON d.id = t.disciplina_id
              WHERE d.edital_id = ? ORDER BY d.ordem, t.ordem`,
        args: [edital.id]
      });
      if (!tops.rows.length) return res.status(422).json({ erro: 'Edital sem tópicos' });

      // 1) cada tópico vira uma ou mais SESSÕES, do tamanho do assunto.
      //    Assunto que não cabe no dia é dividido em partes (2 de 3, 3 de 3...).
      const sessoesPorDisc = new Map();
      for (const t of tops.rows) {
        const peso = Math.min(12, Math.max(0.5, Number(t.peso) || 1.5));
        // nunca deixa uma sessão passar do dia do aluno; blocos de no máximo 2h
        const tetoSessao = Math.min(horasDia, 2);
        const partes = Math.max(1, Math.ceil(peso / tetoSessao - 0.001));
        const horasParte = Math.round((peso / partes) * 100) / 100;
        if (!sessoesPorDisc.has(t.disc_id)) sessoesPorDisc.set(t.disc_id, []);
        for (let k = 1; k <= partes; k++) {
          sessoesPorDisc.get(t.disc_id).push({
            topico_id: t.topico_id, nome: t.nome, parte: k, partes: partes, horas: horasParte
          });
        }
      }

      // 2) monta os dias: intercala disciplinas e enche o dia até as horas do aluno.
      //    Duas partes do mesmo tópico nunca caem no mesmo dia (espaçamento).
      const filas = Array.from(sessoesPorDisc.values());
      const datas = [];
      const plano = [];           // [{data, sessao}]
      let restam = filas.reduce((n, f) => n + f.length, 0);
      let guarda = 0;
      while (restam > 0 && guarda++ < 5000) {
        const dia = [];
        let usadas = 0, topicosNoDia = new Set(), avancou = true;
        while (avancou) {
          avancou = false;
          for (let i = 0; i < filas.length; i++) {
            const fila = filas[(guarda + i) % filas.length];
            if (!fila.length) continue;
            const s = fila[0];
            if (topicosNoDia.has(s.topico_id)) continue;
            // cabe se não estourar o dia (tolerância de 15 min) ou se o dia ainda está vazio
            if (dia.length && usadas + s.horas > horasDia + 0.25) continue;
            fila.shift(); dia.push(s); usadas += s.horas; topicosNoDia.add(s.topico_id);
            restam--; avancou = true;
            if (usadas >= horasDia - 0.25) break;
          }
          if (usadas >= horasDia - 0.25) break;
        }
        if (!dia.length) break;
        plano.push(dia);
      }

      const listaDatas = proximasDatas(plano.length, dias);
      await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ?', args: [aluno.id] });
      let ordem = 0, totalHoras = 0;
      for (let i = 0; i < plano.length; i++) {
        for (const s of plano[i]) {
          await db.execute({
            sql: 'INSERT INTO cronograma (id, aluno_id, topico_id, data, ordem, status, parte, partes, horas) VALUES (?,?,?,?,?,?,?,?,?)',
            args: [id(), aluno.id, s.topico_id, listaDatas[i], ordem++, 'pendente', s.parte, s.partes, s.horas]
          });
          totalHoras += s.horas;
        }
      }
      return res.status(200).json({
        ok: true, itens: ordem, sessoes: ordem, dias: plano.length,
        horas_totais: Math.round(totalHoras * 10) / 10,
        horas_dia: horasDia, dias_semana: dias,
        // quanto o dia realmente ficou cheio — é isto que a aluna quer conferir
        sessoes_por_dia: plano.length ? Math.round((ordem / plano.length) * 10) / 10 : 0,
        termina_em: listaDatas[listaDatas.length - 1]
      });
    }

    // GET — visão do dia
    // Antes de mostrar qualquer coisa, o plano se acerta com a realidade:
    // o que ficou para trás volta para os dias que ainda existem.
    const cfgP = await db.execute({ sql: 'SELECT data_prova FROM config WHERE aluno_id = ?', args: [aluno.id] });
    const provaPara = (cfgP.rows[0] || {}).data_prova || edital.data_prova || null;
    let replano = null;
    try { replano = await replanejar(db, aluno.id, provaPara); } catch (_) { /* nunca derruba a tela */ }

    const rows = await db.execute({
      sql: `SELECT c.id AS cron_id, c.data, c.ordem, c.status, c.parte, c.partes, c.horas,
                   t.id AS topico_id, t.nome AS topico, t.peso, d.nome AS disciplina
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

    const cfgD = await db.execute({ sql: 'SELECT data_prova, horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [aluno.id] });
    const dataProvaFinal = (cfgD.rows[0] || {}).data_prova || edital.data_prova || null;
    const horasDiaAtual = Math.max(0.5, Number((cfgD.rows[0] || {}).horas_dia) || 2);
    const diasSemanaAtual = Number((cfgD.rows[0] || {}).dias_semana) || 6;

    const assuntoHoje = hoje.topico + (Number(hoje.partes) > 1 ? ' (parte ' + hoje.parte + ')' : '') + ' — ' + hoje.disciplina;
    const prog = await db.execute({
      sql: 'SELECT verbo, status FROM progresso WHERE aluno_id = ? AND assunto = ?',
      args: [aluno.id, assuntoHoje]
    });

    return res.status(200).json({
      edital: edital.titulo, data_prova: dataProvaFinal,
      // o app precisa saber com que ritmo o plano foi montado, para mostrar e
      // deixar a aluna corrigir sem refazer o edital inteiro
      horas_dia: horasDiaAtual, dias_semana: diasSemanaAtual,
      verbos_hoje: prog.rows.map(r => ({ verbo: r.verbo, status: r.status })),
      itens: todos.map(r => ({ cron_id: r.cron_id, topico_id: r.topico_id, topico: r.topico, disciplina: r.disciplina, data: r.data, status: r.status, ordem: r.ordem, parte: r.parte || 1, partes: r.partes || 1, horas: r.horas || null })),
      hoje: { cron_id: hoje.cron_id, topico_id: hoje.topico_id, topico: hoje.topico, disciplina: hoje.disciplina, data: hoje.data, parte: hoje.parte || 1, partes: hoje.partes || 1, horas: hoje.horas || null, atrasado: hoje.data < hojeISO() },
      dia_de_hoje: todos.filter(r => r.data === hoje.data).map(r => ({ cron_id: r.cron_id, topico_id: r.topico_id, topico: r.topico, disciplina: r.disciplina, parte: r.parte || 1, partes: r.partes || 1, horas: r.horas || null, status: r.status })),
      proximos: proximos.map(r => ({ topico: r.topico, disciplina: r.disciplina, data: r.data, status: r.status, parte: r.parte || 1, partes: r.partes || 1, horas: r.horas || null })),
      replano,
      resumo: {
        total: todos.length, concluidos,
        termina_em: todos[todos.length - 1].data,
        dias: new Set(todos.map(r => r.data)).size,
        horas_totais: Math.round(todos.reduce((n, r) => n + (Number(r.horas) || 0), 0) * 10) / 10,
        por_disciplina: Object.keys(porDisc).map(nome => ({ nome, total: porDisc[nome].total, concluidos: porDisc[nome].concluidos }))
      }
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
