// Revisão espaçada e caderno de erros — regras compartilhadas.
//
// Cada sessão estudada (um assunto, ou uma parte dele) entra na revisão:
// volta em 1 dia; se a aluna acerta 70% ou mais, o intervalo cresce
// (7, 30, 60 dias; na revisão, 2 de 3 certas bastam); se fica abaixo, volta para 1 dia marcada como reforço.
// Questão errada vai para o caderno de erros e volta até ser acertada duas
// vezes seguidas.

const INTERVALOS = [1, 7, 30, 60];
const META = 0.7;          // questões da aula (6 a 14): 70%
const META_REVISAO = 0.65; // revisão (3 por assunto): 2 de 3 já é firme

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function maisDias(n) {
  const d = new Date(hojeISO() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// sessão concluída: agenda a primeira revisão (ou reagenda, se refez)
async function agendarRevisao(db, alunoId, editalId, topicoId, parte, partes, nota) {
  const n = (nota == null || !isFinite(Number(nota))) ? null : Number(nota);
  const reforco = n != null && n < META ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO revisoes (aluno_id, edital_id, topico_id, parte, partes, etapa, proxima, nota, reforco, atualizado_em)
          VALUES (?,?,?,?,?,0,?,?,?,?)
          ON CONFLICT(aluno_id, topico_id, parte) DO UPDATE SET
            nota = excluded.nota, reforco = excluded.reforco, atualizado_em = excluded.atualizado_em`,
    args: [alunoId, editalId || null, topicoId, Number(parte) || 1, Number(partes) || 1,
           maisDias(INTERVALOS[0]), n, reforco, new Date().toISOString()]
  });
}

// resultado de uma revisão: sobe ou recomeça a escada
async function registrarRevisao(db, alunoId, topicoId, parte, acertos, total) {
  const r = await db.execute({
    sql: 'SELECT etapa FROM revisoes WHERE aluno_id = ? AND topico_id = ? AND parte = ?',
    args: [alunoId, topicoId, Number(parte) || 1]
  });
  if (!r.rows.length || !total) return null;
  const nota = acertos / total;
  const passou = nota >= META_REVISAO;
  const etapa = passou ? Math.min(INTERVALOS.length - 1, Number(r.rows[0].etapa) + 1) : 0;
  const proxima = maisDias(INTERVALOS[etapa]);
  await db.execute({
    sql: `UPDATE revisoes SET etapa = ?, proxima = ?, nota = ?, reforco = ?, feitas = feitas + 1, atualizado_em = ?
          WHERE aluno_id = ? AND topico_id = ? AND parte = ?`,
    args: [etapa, proxima, nota, passou ? 0 : 1, new Date().toISOString(), alunoId, topicoId, Number(parte) || 1]
  });
  return { passou, proxima, nota };
}

// questão errada entra no caderno (a mesma questão não se duplica)
function chaveDaQuestao(q) {
  return require('crypto').createHash('sha1').update(String(q.enunciado || '')).digest('hex').slice(0, 20);
}
async function anotarErro(db, alunoId, editalId, topicoId, parte, partes, q) {
  const agoraTxt = new Date().toISOString();
  const limpa = {
    tipo: Array.isArray(q.alternativas) ? 'me' : 'ce',
    enunciado: String(q.enunciado || '').slice(0, 2000),
    alternativas: Array.isArray(q.alternativas) ? q.alternativas.map(String).slice(0, 6) : undefined,
    correta: Array.isArray(q.alternativas) ? Number(q.correta) : undefined,
    gabarito: Array.isArray(q.alternativas) ? undefined : !!q.gabarito,
    comentario: String(q.comentario || '').slice(0, 1200)
  };
  if (!limpa.enunciado) return;
  await db.execute({
    sql: `INSERT INTO erros (id, aluno_id, edital_id, topico_id, parte, partes, chave, questao, proxima, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(aluno_id, chave) DO UPDATE SET
            acertos_seguidos = 0, dominado = 0, vezes_errada = erros.vezes_errada + 1,
            proxima = excluded.proxima, atualizado_em = excluded.atualizado_em`,
    args: [require('crypto').randomUUID(), alunoId, editalId || null, topicoId || null,
           Number(parte) || 1, Number(partes) || 1, chaveDaQuestao(limpa), JSON.stringify(limpa),
           maisDias(1), agoraTxt, agoraTxt]
  });
}

// erro revisto: duas vezes certo seguidas = dominado
async function registrarErro(db, alunoId, erroId, acertou) {
  const r = await db.execute({ sql: 'SELECT acertos_seguidos FROM erros WHERE id = ? AND aluno_id = ?', args: [erroId, alunoId] });
  if (!r.rows.length) return;
  const seguidos = acertou ? Number(r.rows[0].acertos_seguidos) + 1 : 0;
  const dominado = seguidos >= 2 ? 1 : 0;
  await db.execute({
    sql: `UPDATE erros SET acertos_seguidos = ?, dominado = ?, proxima = ?, atualizado_em = ?,
            vezes_errada = vezes_errada + ? WHERE id = ? AND aluno_id = ?`,
    args: [seguidos, dominado, maisDias(acertou ? 3 : 1), new Date().toISOString(), acertou ? 0 : 1, erroId, alunoId]
  });
}

module.exports = { INTERVALOS, META, hojeISO, maisDias, agendarRevisao, registrarRevisao, anotarErro, registrarErro, chaveDaQuestao };
