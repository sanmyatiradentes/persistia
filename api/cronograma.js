// Cronograma vivo do aluno.
// POST {gerar:true}        → (re)gera o cronograma a partir do último edital + config
// POST {concluir: id}      → marca um item como concluído
// GET                      → {hoje, proximos, resumo}
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, editalAtivo } = require('./_lib');

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
async function replanejar(db, alunoId, dataProva, editalId) {
  const cfg = await db.execute({
    sql: 'SELECT horas_dia, dias_semana FROM config WHERE aluno_id = ?', args: [alunoId]
  });
  const horasDia = Math.max(0.5, Number((cfg.rows[0] || {}).horas_dia) || 2);
  const diasSemana = Number((cfg.rows[0] || {}).dias_semana) || 6;
  const teto = horasDia * (Number(process.env.FATOR_APERTO) || 1.5);

  const pend = await db.execute({
    sql: `SELECT id, data, ordem, horas, topico_id FROM cronograma
          WHERE aluno_id = ? AND edital_id = ? AND status <> 'concluido' ORDER BY ordem`,
    args: [alunoId, editalId]
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
    sql: "SELECT COUNT(*) AS n FROM cronograma WHERE aluno_id = ? AND edital_id = ? AND status = 'concluido'",
    args: [alunoId, editalId]
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

/**
 * O que cabe até a prova, e o que não cabe.
 *
 * Um edital grande simplesmente não entra num prazo curto. Fingir que entra é
 * pior do que dizer a verdade: aqui a gente separa o que fica dentro do prazo
 * do que fica fora, e mostra QUAIS assuntos ficaram de fora — como o plano é
 * ordenado pelo que mais cai, o que sobra no fim é o que menos cai.
 */
// Mesma leitura, mas a partir das linhas já gravadas no cronograma.
function coberturaDoPlano(itens, dataProva) {
  const total = itens.length;
  if (!dataProva || !total) return { tem_prova: !!dataProva, sessoes: total };
  let dentro = 0, horasDentro = 0, horasTotais = 0;
  const fora = [], vistos = {};
  for (const r of itens) {
    const h = Number(r.horas) || 0;
    horasTotais += h;
    if (r.data <= dataProva) { dentro++; horasDentro += h; }
    else if (!vistos[r.topico_id]) {
      vistos[r.topico_id] = true;
      fora.push({ nome: r.topico, disciplina: r.disciplina, incidencia: r.incidencia == null ? null : Number(r.incidencia) });
    }
  }
  // do que menos cai para o que mais cai: o aluno vê primeiro o que dói menos
  // perder, e enxerga na hora se algo importante ficou para trás
  fora.sort((a, b) => (a.incidencia == null ? 5 : a.incidencia) - (b.incidencia == null ? 5 : b.incidencia));
  return {
    tem_prova: true, sessoes: total, dentro, fora: total - dentro,
    assuntos_fora: fora.length,
    percentual: Math.round((dentro / total) * 100),
    horas_dentro: Math.round(horasDentro * 10) / 10,
    horas_totais: Math.round(horasTotais * 10) / 10,
    exemplos_fora: fora.slice(0, 12)
  };
}

function cobertura(plano, listaDatas, dataProva) {
  const total = plano.reduce((n, dia) => n + dia.length, 0);
  const horasTotais = plano.reduce((n, dia) => n + dia.reduce((h, s) => h + s.horas, 0), 0);
  if (!dataProva) {
    return { tem_prova: false, sessoes: total, horas: Math.round(horasTotais * 10) / 10 };
  }
  let dentro = 0, horasDentro = 0;
  const fora = [];
  for (let i = 0; i < plano.length; i++) {
    const antesDaProva = listaDatas[i] <= dataProva;
    for (const s of plano[i]) {
      if (antesDaProva) { dentro++; horasDentro += s.horas; }
      else fora.push(s);
    }
  }
  // agrupa o que ficou de fora por assunto, para a lista não repetir "parte 1, parte 2"
  const nomesFora = [];
  const vistos = {};
  for (const s of fora) {
    if (vistos[s.topico_id]) continue;
    vistos[s.topico_id] = true;
    nomesFora.push({ nome: s.nome, incidencia: s.incidencia == null ? null : Number(s.incidencia) });
  }
  return {
    tem_prova: true,
    sessoes: total,
    dentro, fora: fora.length,
    assuntos_fora: nomesFora.length,
    percentual: total ? Math.round((dentro / total) * 100) : 0,
    horas_dentro: Math.round(horasDentro * 10) / 10,
    horas_totais: Math.round(horasTotais * 10) / 10,
    // os primeiros da lista de fora são os de menor incidência — os que doem menos
    exemplos_fora: nomesFora.slice(0, 12)
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
    // Trabalha sempre sobre o edital que o aluno escolheu estudar. Vários
    // editais convivem na mesma conta, cada um com seu cronograma e seu progresso.
    const edital = await editalAtivo(db, aluno.id);
    if (!edital) return res.status(200).json({ sem_edital: true });

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
      const cfg = await db.execute({ sql: 'SELECT horas_dia, dias_semana, ordem_estudo, data_prova FROM config WHERE aluno_id = ?', args: [aluno.id] });
      const horasDia = Math.max(0.5, Number((cfg.rows[0] || {}).horas_dia) || 2);
      const dias = Number((cfg.rows[0] || {}).dias_semana) || 6;

      const tops = await db.execute({
        sql: `SELECT t.id AS topico_id, t.nome, t.peso, t.incidencia, t.ordem AS t_ordem,
                     d.id AS disc_id, d.nome AS disciplina, d.ordem AS d_ordem, d.questoes
              FROM topicos t JOIN disciplinas d ON d.id = t.disciplina_id
              WHERE d.edital_id = ? ORDER BY d.ordem, t.ordem`,
        args: [edital.id]
      });
      if (!tops.rows.length) return res.status(422).json({ erro: 'Edital sem tópicos' });

      // ---- ORDEM DE ESTUDO ----------------------------------------------
      // Quando o edital não cabe inteiro antes da prova, o que fica de fora não
      // pode ser "o que por acaso estava no fim do documento". Aqui os assuntos
      // são ordenados pelo que mais cai: a incidência estimada do tópico, com
      // peso maior para as disciplinas que têm mais questões na prova.
      // Quem preferir seguir o documento escolhe 'edital' e nada é reordenado.
      const ordemEscolhida = String((req.body || {}).ordem_estudo ||
        (cfg.rows[0] || {}).ordem_estudo || 'prioridade');
      if ((req.body || {}).ordem_estudo) {
        await db.execute({
          sql: `INSERT INTO config (aluno_id, ordem_estudo, atualizado_em) VALUES (?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET ordem_estudo = excluded.ordem_estudo,
                                                    atualizado_em = excluded.atualizado_em`,
          args: [aluno.id, ordemEscolhida, agora()]
        });
      }

      // peso da disciplina: proporcional às questões que ela tem na prova.
      // Sem esse dado no edital, todas valem igual (1).
      const questoesPorDisc = {};
      for (const t of tops.rows) {
        const q = Number(t.questoes);
        if (isFinite(q) && q > 0) questoesPorDisc[t.disc_id] = q;
      }
      const listaQ = Object.values(questoesPorDisc);
      const mediaQ = listaQ.length ? listaQ.reduce((a, b) => a + b, 0) / listaQ.length : 0;
      function pesoDisciplina(discId) {
        const q = questoesPorDisc[discId];
        if (!q || !mediaQ) return 1;
        // entre 0,5× e 2×: nenhuma disciplina some, nenhuma domina o plano inteiro
        return Math.min(2, Math.max(0.5, q / mediaQ));
      }
      function prioridade(t) {
        // sem estimativa de incidência (editais antigos), tudo vale 5 — e a
        // ordem acaba caindo no peso da disciplina + ordem do edital
        const inc = isFinite(Number(t.incidencia)) ? Number(t.incidencia) : 5;
        return inc * pesoDisciplina(t.disc_id);
      }

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
            topico_id: t.topico_id, nome: t.nome, parte: k, partes: partes, horas: horasParte,
            disc_id: t.disc_id, disciplina: t.disciplina,
            prioridade: prioridade(t), incidencia: t.incidencia, ordemEdital: [t.d_ordem, t.t_ordem]
          });
        }
      }

      // 2) monta os dias.
      //
      // Na ordem 'edital', as disciplinas se revezam e o edital é seguido como
      // está escrito. Na ordem 'prioridade', existe UMA fila só, do que mais cai
      // para o que menos cai: assim, se o prazo cortar o plano, o corte cai
      // sobre o rabo da fila — o que menos aparece na prova. O rodízio por
      // disciplina, que existia antes, dava vaga igual a todas e fazia uma
      // disciplina periférica ocupar o mesmo espaço da que vale mais questões.
      //
      // Duas partes do mesmo tópico nunca caem no mesmo dia, e um dia não fica
      // inteiro de uma disciplina só (no máximo metade das sessões do dia),
      // para a rotina não virar maratona de um assunto.
      const plano = [];
      let guarda = 0;

      if (ordemEscolhida === 'edital') {
        const filas = Array.from(sessoesPorDisc.values());
        let restam = filas.reduce((n, f) => n + f.length, 0);
        while (restam > 0 && guarda++ < 20000) {
          const dia = [];
          let usadas = 0, topicosNoDia = new Set(), avancou = true;
          while (avancou) {
            avancou = false;
            for (let i = 0; i < filas.length; i++) {
              const fila = filas[(guarda + i) % filas.length];
              if (!fila.length) continue;
              const s = fila[0];
              if (topicosNoDia.has(s.topico_id)) continue;
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
      } else {
        // Fila única, montada em duas camadas:
        //
        //  1) DENTRO de cada disciplina, o que mais cai vem primeiro.
        //  2) ENTRE as disciplinas, cada uma avança em proporção ao peso que tem
        //     na prova (as questões que o edital dá a ela).
        //
        // Ordenar só pela incidência bruta parecia melhor, mas no teste ele
        // apagava uma disciplina inteira do prazo — inclusive uma que valia 15
        // questões. Para pontuar, é melhor cobrir o topo de TODAS as disciplinas,
        // na proporção do que cada uma vale, do que esgotar duas e zerar outra.
        for (const f of sessoesPorDisc.values()) {
          f.sort((a, b) => (b.prioridade - a.prioridade)
            || (a.ordemEdital[0] - b.ordemEdital[0]) || (a.ordemEdital[1] - b.ordemEdital[1])
            || (a.parte - b.parte));
          // partes do mesmo tópico voltam à ordem natural (1, depois 2)
          f.forEach((s, i) => { s.posDisc = i; });
        }
        const fila = [];
        for (const f of sessoesPorDisc.values()) {
          const cota = pesoDisciplina(f.length ? f[0].disc_id : null);
          for (const s of f) { s.chave = s.posDisc / cota; fila.push(s); }
        }
        // avança em paralelo: a disciplina que vale mais entrega mais sessões
        // no mesmo trecho do plano, e nenhuma fica de fora por completo
        fila.sort((a, b) => (a.chave - b.chave) || (b.prioridade - a.prioridade)
          || (a.ordemEdital[0] - b.ordemEdital[0]) || (a.parte - b.parte));

        while (fila.length && guarda++ < 20000) {
          const dia = [];
          let usadas = 0;
          const topicosNoDia = new Set(), porDisc = {};
          // teto de sessões da mesma disciplina no dia: metade, no mínimo 1
          const tetoDisc = Math.max(1, Math.ceil(Math.max(1, horasDia / 2) / 2));
          for (let i = 0; i < fila.length; ) {
            const s = fila[i];
            const cheio = dia.length && usadas + s.horas > horasDia + 0.25;
            const repetido = topicosNoDia.has(s.topico_id);
            const demaisDaMesma = (porDisc[s.disc_id] || 0) >= tetoDisc && dia.length;
            if (cheio || repetido || demaisDaMesma) { i++; continue; }
            fila.splice(i, 1);
            dia.push(s); usadas += s.horas;
            topicosNoDia.add(s.topico_id);
            porDisc[s.disc_id] = (porDisc[s.disc_id] || 0) + 1;
            if (usadas >= horasDia - 0.25) break;
          }
          // nada coube com as restrições: relaxa o teto por disciplina
          if (!dia.length) {
            const s = fila.shift();
            dia.push(s);
          }
          plano.push(dia);
        }
      }

      const listaDatas = proximasDatas(plano.length, dias);
      // apaga só o cronograma DESTE edital: os outros continuam intactos
      await db.execute({ sql: 'DELETE FROM cronograma WHERE aluno_id = ? AND edital_id = ?', args: [aluno.id, edital.id] });
      let ordem = 0, totalHoras = 0;
      for (let i = 0; i < plano.length; i++) {
        for (const s of plano[i]) {
          await db.execute({
            sql: 'INSERT INTO cronograma (id, aluno_id, edital_id, topico_id, data, ordem, status, parte, partes, horas) VALUES (?,?,?,?,?,?,?,?,?,?)',
            args: [id(), aluno.id, edital.id, s.topico_id, listaDatas[i], ordem++, 'pendente', s.parte, s.partes, s.horas]
          });
          totalHoras += s.horas;
        }
      }
      return res.status(200).json({
        ok: true, itens: ordem, sessoes: ordem, dias: plano.length,
        horas_totais: Math.round(totalHoras * 10) / 10,
        horas_dia: horasDia, dias_semana: dias,
        ordem_estudo: ordemEscolhida,
        // quanto o dia realmente ficou cheio — é isto que a aluna quer conferir
        sessoes_por_dia: plano.length ? Math.round((ordem / plano.length) * 10) / 10 : 0,
        termina_em: listaDatas[listaDatas.length - 1],
        cobertura: cobertura(plano, listaDatas, (cfg.rows[0] || {}).data_prova || edital.data_prova)
      });
    }

    // GET — visão do dia
    // Antes de mostrar qualquer coisa, o plano se acerta com a realidade:
    // o que ficou para trás volta para os dias que ainda existem.
    const cfgP = await db.execute({ sql: 'SELECT data_prova FROM config WHERE aluno_id = ?', args: [aluno.id] });
    const provaPara = (cfgP.rows[0] || {}).data_prova || edital.data_prova || null;
    let replano = null;
    try { replano = await replanejar(db, aluno.id, provaPara, edital.id); } catch (_) { /* nunca derruba a tela */ }

    const rows = await db.execute({
      sql: `SELECT c.id AS cron_id, c.data, c.ordem, c.status, c.parte, c.partes, c.horas,
                   t.id AS topico_id, t.nome AS topico, t.peso, t.incidencia, d.nome AS disciplina
            FROM cronograma c
            JOIN topicos t ON t.id = c.topico_id
            JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE c.aluno_id = ? AND c.edital_id = ? ORDER BY c.ordem`,
      args: [aluno.id, edital.id]
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

    const cfgD = await db.execute({ sql: 'SELECT data_prova, horas_dia, dias_semana, ordem_estudo FROM config WHERE aluno_id = ?', args: [aluno.id] });
    const dataProvaFinal = (cfgD.rows[0] || {}).data_prova || edital.data_prova || null;
    const horasDiaAtual = Math.max(0.5, Number((cfgD.rows[0] || {}).horas_dia) || 2);
    const diasSemanaAtual = Number((cfgD.rows[0] || {}).dias_semana) || 6;

    const incOk = await db.execute({
      sql: `SELECT COUNT(*) AS com, (SELECT COUNT(*) FROM topicos t2 JOIN disciplinas d2 ON d2.id = t2.disciplina_id WHERE d2.edital_id = ?) AS tudo
            FROM topicos t JOIN disciplinas d ON d.id = t.disciplina_id
            WHERE d.edital_id = ? AND t.incidencia IS NOT NULL`,
      args: [edital.id, edital.id]
    });
    const prioridadePronta = {
      com_nota: Number((incOk.rows[0] || {}).com) || 0,
      total: Number((incOk.rows[0] || {}).tudo) || 0
    };

    const assuntoHoje = hoje.topico + (Number(hoje.partes) > 1 ? ' (parte ' + hoje.parte + ')' : '') + ' — ' + hoje.disciplina;
    const prog = await db.execute({
      sql: 'SELECT verbo, status FROM progresso WHERE aluno_id = ? AND assunto = ?',
      args: [aluno.id, assuntoHoje]
    });

    return res.status(200).json({
      edital: edital.titulo, edital_id: edital.id, data_prova: dataProvaFinal,
      // o app precisa saber com que ritmo o plano foi montado, para mostrar e
      // deixar a aluna corrigir sem refazer o edital inteiro
      horas_dia: horasDiaAtual, dias_semana: diasSemanaAtual,
      ordem_estudo: (cfgD.rows[0] || {}).ordem_estudo || 'prioridade',
      // o que cabe até a prova e o que ficou para depois dela, com os assuntos
      cobertura: coberturaDoPlano(todos, dataProvaFinal),
      // quantos tópicos já têm nota de incidência: sem isso a ordem é só o edital
      prioridade_pronta: prioridadePronta,
      verbos_hoje: prog.rows.map(r => ({ verbo: r.verbo, status: r.status })),
      itens: todos.map(r => ({ cron_id: r.cron_id, topico_id: r.topico_id, topico: r.topico, disciplina: r.disciplina, data: r.data, status: r.status, ordem: r.ordem, parte: r.parte || 1, partes: r.partes || 1, horas: r.horas || null, incidencia: r.incidencia == null ? null : Number(r.incidencia) })),
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
