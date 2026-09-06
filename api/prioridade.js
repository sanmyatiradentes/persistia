// Nota de incidência dos assuntos de um edital JÁ cadastrado.
//
// Por que existe: o cronograma decide o que estudar primeiro pela incidência —
// o quanto cada assunto costuma cair na prova daquela banca. Editais lidos
// antes desta funcionalidade não têm essa nota, e o aluno não deveria precisar
// reenviar o PDF só por isso. Aqui a IA lê a LISTA de tópicos já extraída e dá
// a nota, uma disciplina por requisição (uma chamada de IA por requisição, para
// nunca estourar o tempo da função no servidor).
//
// GET                      → {disciplinas:[{id, nome, topicos, com_nota}], edital}
// POST {disciplina_id}     → dá nota aos tópicos daquela disciplina
const { getDb, ensureSchema, alunoDoToken, cors, chamarGemini, acessoDoAluno, falhaIA, editalAtivo, MODELO_LEVE } = require('./_lib');

const SISTEMA = `Você conhece o padrão das bancas de concurso público brasileiras.
Recebe o nome de um concurso, o cargo, a banca, a disciplina e a lista numerada dos tópicos do edital.
Para CADA tópico, devolva "incidencia": de 0 a 10, o quanto ele costuma ser cobrado na prova objetiva desse cargo nessa banca.
  10 = cai em praticamente toda prova;
  7 a 9 = cai com muita frequência;
  4 a 6 = cai às vezes;
  1 a 3 = periférico, raro.
Regras:
- Devolva exatamente um item para CADA tópico recebido, na MESMA ordem, repetindo o número.
- NÃO padronize: um edital real tem assuntos que caem sempre e assuntos que quase nunca caem. Use a régua inteira.
- Julgue o assunto em si e o histórico da banca, não o tamanho do texto do tópico.`;

const SCHEMA = {
  type: 'object',
  properties: {
    notas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'number' }, incidencia: { type: 'number' } },
        required: ['n', 'incidencia']
      }
    }
  },
  required: ['notas']
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();

  try {
    const edital = await editalAtivo(db, aluno.id);
    if (!edital) return res.status(200).json({ sem_edital: true });

    /* ---------- GET: o que já tem nota e o que falta ---------- */
    if (req.method !== 'POST') {
      const r = await db.execute({
        sql: `SELECT d.id, d.nome, d.ordem, COUNT(t.id) AS topicos,
                     SUM(CASE WHEN t.incidencia IS NOT NULL THEN 1 ELSE 0 END) AS com_nota
              FROM disciplinas d LEFT JOIN topicos t ON t.disciplina_id = d.id
              WHERE d.edital_id = ? GROUP BY d.id ORDER BY d.ordem`,
        args: [edital.id]
      });
      const discs = r.rows.map(x => ({
        id: x.id, nome: x.nome,
        topicos: Number(x.topicos) || 0,
        com_nota: Number(x.com_nota) || 0
      }));
      return res.status(200).json({
        edital: edital.titulo, edital_id: edital.id, disciplinas: discs,
        faltam: discs.filter(d => d.com_nota < d.topicos).length
      });
    }

    /* ---------- POST: dá nota a uma disciplina ---------- */
    const acesso = await acessoDoAluno(aluno);
    if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

    const discId = String((req.body || {}).disciplina_id || '').trim();
    if (!discId) return res.status(400).json({ erro: 'Diga qual disciplina' });

    const d = await db.execute({
      sql: 'SELECT d.id, d.nome FROM disciplinas d WHERE d.id = ? AND d.edital_id = ?',
      args: [discId, edital.id]
    });
    if (!d.rows.length) return res.status(404).json({ erro: 'Disciplina não encontrada neste edital' });

    const tops = await db.execute({
      sql: 'SELECT id, nome, ordem FROM topicos WHERE disciplina_id = ? ORDER BY ordem',
      args: [discId]
    });
    if (!tops.rows.length) return res.status(200).json({ ok: true, notas: 0 });

    // uma disciplina pode ter 60 tópicos; em lotes de 40 a resposta nunca trunca
    const LOTE = 40;
    let gravadas = 0;
    for (let i = 0; i < tops.rows.length; i += LOTE) {
      const parte = tops.rows.slice(i, i + LOTE);
      const lista = parte.map((t, k) => `${k + 1}. ${t.nome}`).join('\n');
      const pedido =
        `Concurso: ${edital.titulo}\n` +
        (edital.cargo ? `Cargo: ${edital.cargo}\n` : '') +
        (edital.banca ? `Banca: ${edital.banca}\n` : '') +
        `Disciplina: ${d.rows[0].nome}\n\nTópicos:\n${lista}\n\n` +
        `Devolva ${parte.length} notas, uma para cada tópico, na mesma ordem.`;

      let r;
      try {
        r = JSON.parse(await chamarGemini(SISTEMA, pedido, SCHEMA, MODELO_LEVE));
      } catch (e) {
        const f = falhaIA(e, 'Não consegui avaliar esta disciplina agora');
        return res.status(f.status).json(f.corpo);
      }

      const notas = Array.isArray(r.notas) ? r.notas : [];
      for (const item of notas) {
        const pos = Number(item && item.n) - 1;
        if (!(pos >= 0 && pos < parte.length)) continue;
        let inc = Number(item.incidencia);
        if (!isFinite(inc)) continue;
        inc = Math.min(10, Math.max(0, Math.round(inc * 10) / 10));
        await db.execute({
          sql: 'UPDATE topicos SET incidencia = ? WHERE id = ?',
          args: [inc, parte[pos].id]
        });
        gravadas++;
      }
    }

    return res.status(200).json({ ok: true, disciplina: d.rows[0].nome, notas: gravadas, topicos: tops.rows.length });
  } catch (e) {
    const f = falhaIA(e, 'Erro ao calcular as prioridades');
    return res.status(f.status).json(f.corpo);
  }
};
