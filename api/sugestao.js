// Canal direto do aluno com a desenvolvedora: sugestão ou dúvida, com print opcional.
// POST {texto, print?, pagina?}          → o aluno envia
// GET                                     → o aluno vê as suas e as respostas
// GET  ?todas=1                           → (gestora) fila completa
// POST {responder: id, resposta}          → (gestora) responde
// POST {arquivar: id}                     → (gestora) tira da fila sem responder
const { getDb, ensureSchema, agora, id, alunoDoToken, cors, ehAdmin } = require('./_lib');

const LIMITE_PRINT = 900000;   // ~900 KB de data URL, bem abaixo do teto de corpo da Vercel

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  const db = getDb();
  const admin = ehAdmin(aluno.email);

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('todas')) {
        if (!admin) return res.status(403).json({ erro: 'Área restrita' });
        // a lista da fila não carrega os prints: eles são pesados e vêm um a um
        const r = await db.execute({
          sql: `SELECT id, aluno_id, nome, email, texto, pagina, status, resposta, criado_em, respondido_em,
                       CASE WHEN print IS NULL THEN 0 ELSE 1 END AS tem_print
                FROM sugestoes ORDER BY (status = 'nova') DESC, criado_em DESC LIMIT 300`,
          args: []
        });
        return res.status(200).json({ sugestoes: r.rows, admin: true });
      }
      if (url.searchParams.get('print')) {
        const r = await db.execute({
          sql: 'SELECT aluno_id, print FROM sugestoes WHERE id = ?',
          args: [String(url.searchParams.get('print'))]
        });
        if (!r.rows.length) return res.status(404).json({ erro: 'Não encontrada' });
        if (!admin && r.rows[0].aluno_id !== aluno.id) return res.status(403).json({ erro: 'Sem acesso' });
        return res.status(200).json({ print: r.rows[0].print || null });
      }
      const r = await db.execute({
        sql: `SELECT id, texto, pagina, status, resposta, criado_em, respondido_em,
                     CASE WHEN print IS NULL THEN 0 ELSE 1 END AS tem_print
              FROM sugestoes WHERE aluno_id = ? ORDER BY criado_em DESC LIMIT 50`,
        args: [aluno.id]
      });
      return res.status(200).json({ sugestoes: r.rows, admin });
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (b.responder) {
        if (!admin) return res.status(403).json({ erro: 'Área restrita' });
        const txt = String(b.resposta || '').trim();
        if (!txt) return res.status(400).json({ erro: 'Escreva a resposta' });
        await db.execute({
          sql: `UPDATE sugestoes SET resposta = ?, status = 'respondida', respondido_em = ? WHERE id = ?`,
          args: [txt.slice(0, 4000), agora(), String(b.responder)]
        });
        return res.status(200).json({ ok: true });
      }

      if (b.arquivar) {
        if (!admin) return res.status(403).json({ erro: 'Área restrita' });
        await db.execute({
          sql: `UPDATE sugestoes SET status = 'arquivada' WHERE id = ?`,
          args: [String(b.arquivar)]
        });
        return res.status(200).json({ ok: true });
      }

      const texto = String(b.texto || '').trim();
      if (texto.length < 5) return res.status(400).json({ erro: 'Escreva um pouco mais para eu entender' });
      let print = b.print ? String(b.print) : null;
      if (print && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(print)) print = null;
      if (print && print.length > LIMITE_PRINT) {
        return res.status(413).json({ erro: 'A imagem ficou grande demais — tente um recorte menor' });
      }

      const sid = id();
      await db.execute({
        sql: `INSERT INTO sugestoes (id, aluno_id, nome, email, texto, print, pagina, status, criado_em)
              VALUES (?,?,?,?,?,?,?,'nova',?)`,
        args: [sid, aluno.id, aluno.nome || null, aluno.email || null,
               texto.slice(0, 4000), print, String(b.pagina || '').slice(0, 120), agora()]
      });
      return res.status(200).json({ ok: true, id: sid });
    }

    return res.status(405).json({ erro: 'Método não suportado' });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
