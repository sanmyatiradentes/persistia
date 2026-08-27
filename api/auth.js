// Cadastro e login de alunos. POST {acao:'cadastro'|'login', nome?, email, senha}
const { getDb, ensureSchema, agora, id, hashSenha, cors } = require('./_lib');
const crypto = require('crypto');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  const { acao, nome, email, senha } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ erro: 'E-mail inválido' });
  if (!senha || String(senha).length < 6) return res.status(400).json({ erro: 'Senha precisa de pelo menos 6 caracteres' });

  await ensureSchema();
  const db = getDb();

  try {
    if (acao === 'cadastro') {
      if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Informe seu nome' });
      const ja = await db.execute({ sql: 'SELECT id FROM alunos WHERE email = ?', args: [mail] });
      if (ja.rows.length) return res.status(409).json({ erro: 'Este e-mail já tem conta — use Entrar' });
      const sal = crypto.randomBytes(16).toString('hex');
      const alunoId = id();
      await db.execute({
        sql: 'INSERT INTO alunos (id, nome, email, senha_hash, sal, criado_em) VALUES (?,?,?,?,?,?)',
        args: [alunoId, String(nome).trim(), mail, hashSenha(senha, sal), sal, agora()]
      });
      const token = crypto.randomUUID() + crypto.randomBytes(16).toString('hex');
      await db.execute({ sql: 'INSERT INTO sessoes (token, aluno_id, criado_em) VALUES (?,?,?)', args: [token, alunoId, agora()] });
      return res.status(200).json({ token, nome: String(nome).trim() });
    }

    // login
    const r = await db.execute({ sql: 'SELECT id, nome, senha_hash, sal FROM alunos WHERE email = ?', args: [mail] });
    const a = r.rows[0];
    if (!a || hashSenha(senha, a.sal) !== a.senha_hash) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    const token = crypto.randomUUID() + crypto.randomBytes(16).toString('hex');
    await db.execute({ sql: 'INSERT INTO sessoes (token, aluno_id, criado_em) VALUES (?,?,?)', args: [token, a.id, agora()] });
    return res.status(200).json({ token, nome: a.nome });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
