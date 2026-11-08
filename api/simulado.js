// Simulado: prova cronometrada com as questões das aulas já escritas para o edital,
// proporcional ao peso de cada disciplina. As questões são inéditas, escritas pela IA.
// GET ?info=1                      → quantas questões há disponíveis e os últimos simulados
// GET ?n=20&formato=ce|me|misto    → monta a prova
// POST {resultado: {itens, segundos, formato}} → grava a nota; o que errou vai para o caderno
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, editalAtivo, acessoDoAluno } = require('./_lib');
const { topicosSuspensos } = require('./_normas');
const R = require('./_revisao');

const MIN_QUESTOES = 5;
const MAX_QUESTOES = 80;

function embaralhar(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function acervo(db, alunoId, editalId, formato) {
  const suspensos = await topicosSuspensos(db, alunoId);
  const r = await db.execute({
    sql: `SELECT c.topico_id, c.parte, c.partes, t.nome AS topico, d.nome AS disciplina, d.questoes AS peso,
                 json_extract(k.json, '$.questoes') AS ce, json_extract(k.json, '$.questoes_me') AS me
          FROM cronograma c
          JOIN topicos t ON t.id = c.topico_id JOIN disciplinas d ON d.id = t.disciplina_id
          JOIN conteudos k ON k.topico_id IN (
            CASE WHEN COALESCE(c.partes, 1) > 1 THEN c.topico_id || ':' || c.parte || '/' || c.partes ELSE c.topico_id END,
            CASE WHEN COALESCE(c.partes, 1) > 1 THEN c.topico_id || ':' || c.parte || '/' || c.partes ELSE c.topico_id END || '::pratica')
          WHERE c.aluno_id = ? AND c.edital_id = ?`,
    args: [alunoId, editalId]
  });
  const porDisc = {}, vistas = new Set();
  for (const x of r.rows) {
    if (suspensos.has(x.topico_id)) continue;
    const entra = (lista, tipo) => {
      let qs = []; try { qs = JSON.parse(lista || '[]'); } catch (_) {}
      for (const q of qs) {
        if (!q || !q.enunciado || vistas.has(q.enunciado)) continue;
        if (tipo === 'me' && !Array.isArray(q.alternativas)) continue;
        vistas.add(q.enunciado);
        const o = porDisc[x.disciplina] = porDisc[x.disciplina] || { peso: Number(x.peso) || 1, itens: [] };
        o.itens.push({ tipo, enunciado: q.enunciado, alternativas: q.alternativas, correta: q.correta, gabarito: q.gabarito,
          comentario: q.comentario, topico_id: x.topico_id, parte: x.parte || 1, partes: x.partes || 1, topico: x.topico, disciplina: x.disciplina });
      }
    };
    if (formato !== 'me') entra(x.ce, 'ce');
    if (formato !== 'ce') entra(x.me, 'me');
  }
  return porDisc;
}

// Distribui as vagas pelo peso de cada disciplina, sem passar do que ela tem.
function montar(porDisc, n) {
  const nomes = Object.keys(porDisc), vagas = {};
  nomes.forEach(k => { vagas[k] = 0; embaralhar(porDisc[k].itens); });
  let resta = Math.min(n, nomes.reduce((s, k) => s + porDisc[k].itens.length, 0));
  while (resta > 0) {
    const k = nomes.filter(x => vagas[x] < porDisc[x].itens.length)
      .sort((a, b) => (vagas[a] / porDisc[a].peso) - (vagas[b] / porDisc[b].peso))[0];
    if (!k) break;
    vagas[k]++; resta--;
  }
  const prova = [];
  nomes.forEach(k => {
    // um assunto de cada vez, para a disciplina não ficar presa num tema só
    const porTopico = {}; porDisc[k].itens.forEach(i => { (porTopico[i.topico_id] = porTopico[i.topico_id] || []).push(i); });
    const filas = Object.values(porTopico); let i = 0, tirados = 0;
    while (tirados < vagas[k]) { const f = filas[i++ % filas.length]; if (f.length) { prova.push(f.shift()); tirados++; } }
  });
  return embaralhar(prova);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });
  const db = getDb();
  try {
    const edital = await editalAtivo(db, aluno.id);
    if (!edital) return res.status(200).json({ disponiveis: 0, historico: [], minimo: MIN_QUESTOES });

    if (req.method === 'POST') {
      const b = (req.body || {}).resultado || {};
      const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, MAX_QUESTOES);
      if (!itens.length) return res.status(400).json({ erro: 'Simulado vazio' });
      const respondidas = itens.filter(i => i.resposta !== null && i.resposta !== undefined);
      const acertos = respondidas.filter(i => i.certa).length;
      const resumo = itens.map(i => ({ disciplina: i.disciplina, topico: i.topico, respondeu: i.resposta !== null && i.resposta !== undefined, certa: !!i.certa }));
      await db.execute({
        sql: 'INSERT INTO simulados (id, aluno_id, edital_id, total, respondidas, acertos, segundos, detalhe, criado_em) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [id(), aluno.id, edital.id, itens.length, respondidas.length, acertos, Number(b.segundos) || 0, JSON.stringify(resumo), agora()]
      });
      for (const i of respondidas) {
        if (!i.certa && i.topico_id) await R.anotarErro(db, aluno.id, edital.id, i.topico_id, i.parte, i.partes, i);
      }
      return res.status(200).json({ ok: true, total: itens.length, respondidas: respondidas.length, acertos });
    }

    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('info')) {
      const pc = await acervo(db, aluno.id, edital.id, 'misto');
      const hist = await db.execute({
        sql: 'SELECT total, respondidas, acertos, segundos, criado_em FROM simulados WHERE aluno_id = ? AND edital_id = ? ORDER BY criado_em DESC LIMIT 5',
        args: [aluno.id, edital.id]
      });
      return res.status(200).json({
        disponiveis: Object.values(pc).reduce((s, o) => s + o.itens.length, 0),
        disciplinas: Object.keys(pc).length, minimo: MIN_QUESTOES, historico: hist.rows
      });
    }

    const formato = ['ce', 'me', 'misto'].includes(url.searchParams.get('formato')) ? url.searchParams.get('formato') : 'misto';
    const n = Math.min(MAX_QUESTOES, Math.max(MIN_QUESTOES, Number(url.searchParams.get('n')) || 20));
    const prova = montar(await acervo(db, aluno.id, edital.id, formato), n);
    if (prova.length < MIN_QUESTOES) return res.status(200).json({ insuficiente: true, disponiveis: prova.length, minimo: MIN_QUESTOES });
    const minutos = prova.reduce((s, q) => s + (q.tipo === 'me' ? 3 : 2), 0);
    return res.status(200).json({ questoes: prova, minutos });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
