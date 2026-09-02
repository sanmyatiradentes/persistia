// Cadastro, login e recuperação de senha.
//   POST {acao:'cadastro', nome, email, senha}
//   POST {acao:'login', email, senha}
//   POST {acao:'esqueci', email}                  → manda o link de redefinição
//   POST {acao:'redefinir', token, senha}         → troca a senha e já entra
const { getDb, ensureSchema, agora, emDias, id, hashSenha, cors } = require('./_lib');
const { enviarEmail } = require('./_email');
const crypto = require('crypto');

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'persisteia.com.br';
  return 'https://' + host;
}

function novaSessao(db, alunoId) {
  const token = crypto.randomUUID() + crypto.randomBytes(16).toString('hex');
  return db.execute({
    sql: 'INSERT INTO sessoes (token, aluno_id, criado_em) VALUES (?,?,?)',
    args: [token, alunoId, agora()]
  }).then(() => token);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });

  const { acao, nome, email, senha, token } = req.body || {};
  await ensureSchema();
  const db = getDb();

  try {
    // ---------- esqueci minha senha ----------
    // Resposta sempre igual, exista a conta ou não: ninguém descobre por aqui
    // quem tem cadastro na PersisteIA.
    if (acao === 'esqueci') {
      const mail = String(email || '').trim().toLowerCase();
      const generica = {
        ok: true,
        recado: 'Se existir uma conta com esse e-mail, o link de nova senha chega em instantes. Confira também a caixa de spam.'
      };
      if (!mail) return res.status(200).json(generica);

      const r = await db.execute({ sql: 'SELECT id, nome FROM alunos WHERE email = ?', args: [mail] });
      const a = r.rows[0];
      if (!a) return res.status(200).json(generica);

      const chave = crypto.randomBytes(24).toString('hex');
      await db.execute({
        sql: 'INSERT INTO tokens_senha (token, aluno_id, expira_em, usado, criado_em) VALUES (?,?,?,0,?)',
        args: [chave, a.id, emDias(1), agora()]
      });

      const link = siteUrl(req) + '/?nova-senha=' + chave;
      const envio = await enviarEmail({
        para: mail,
        assunto: 'Sua nova senha da PersisteIA',
        titulo: 'Vamos criar uma senha nova',
        corpo: `<p style="margin:0 0 14px">Oi, ${a.nome ? String(a.nome).split(' ')[0] : 'tudo bem'}!</p>
                <p style="margin:0 0 14px">Recebemos um pedido para trocar a senha da sua conta. É só tocar no botão abaixo e escolher a nova.</p>
                <p style="margin:0">O link vale por <b>24 horas</b> e só pode ser usado uma vez.</p>`,
        botao: { texto: 'Criar minha nova senha', url: link },
        rodape: 'Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo e ninguém teve acesso à sua conta.',
        texto: 'Para criar uma nova senha, acesse: ' + link + ' (o link vale por 24 horas).'
      });

      // Sem e-mail configurado, o link ainda serve pelo painel da gestora.
      if (!envio.enviado) {
        return res.status(200).json(Object.assign({}, generica, { aviso_interno: envio.motivo }));
      }
      return res.status(200).json(generica);
    }

    // ---------- redefinir com o link recebido ----------
    if (acao === 'redefinir') {
      if (!token) return res.status(400).json({ erro: 'Link inválido' });
      if (!senha || String(senha).length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres' });

      const r = await db.execute({
        sql: 'SELECT token, aluno_id, expira_em, usado FROM tokens_senha WHERE token = ?',
        args: [String(token)]
      });
      const t = r.rows[0];
      if (!t) return res.status(400).json({ erro: 'Este link não vale mais. Peça um novo em "Esqueci minha senha".' });
      if (Number(t.usado)) return res.status(400).json({ erro: 'Este link já foi usado. Peça um novo em "Esqueci minha senha".' });
      if (t.expira_em < agora()) return res.status(400).json({ erro: 'Este link expirou. Peça um novo em "Esqueci minha senha".' });

      const sal = crypto.randomBytes(16).toString('hex');
      await db.execute({
        sql: 'UPDATE alunos SET senha_hash = ?, sal = ? WHERE id = ?',
        args: [hashSenha(senha, sal), sal, t.aluno_id]
      });
      await db.execute({ sql: 'UPDATE tokens_senha SET usado = 1 WHERE token = ?', args: [String(token)] });
      // trocou a senha, derruba as sessões antigas: se alguém entrou, sai agora
      await db.execute({ sql: 'DELETE FROM sessoes WHERE aluno_id = ?', args: [t.aluno_id] });

      const dono = await db.execute({ sql: 'SELECT nome FROM alunos WHERE id = ?', args: [t.aluno_id] });
      const novoToken = await novaSessao(db, t.aluno_id);
      return res.status(200).json({ token: novoToken, nome: (dono.rows[0] || {}).nome || '' });
    }

    // ---------- cadastro e login ----------
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ erro: 'E-mail inválido' });
    if (!senha || String(senha).length < 6) return res.status(400).json({ erro: 'Senha precisa de pelo menos 6 caracteres' });

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
      const tk = await novaSessao(db, alunoId);

      // boas-vindas: melhor-esforço, nunca segura o cadastro
      enviarEmail({
        para: mail,
        assunto: 'Bem-vinda(o) à PersisteIA',
        titulo: 'Sua conta está pronta',
        corpo: `<p style="margin:0 0 14px">Oi, ${String(nome).trim().split(' ')[0]}!</p>
                <p style="margin:0 0 14px">Você tem <b>7 dias grátis</b>, sem cartão. O próximo passo é enviar o PDF do seu edital: a partir dele eu monto o cronograma até a data da prova e escrevo o material de cada dia.</p>
                <p style="margin:0">Qualquer dúvida, é só responder este e-mail ou chamar no WhatsApp.</p>`,
        botao: { texto: 'Enviar meu edital', url: siteUrl(req) },
        rodape: 'Guarde este e-mail: é por ele que você recupera o acesso se esquecer a senha.'
      }).catch(function () {});

      return res.status(200).json({ token: tk, nome: String(nome).trim() });
    }

    // login
    const r = await db.execute({ sql: 'SELECT id, nome, senha_hash, sal FROM alunos WHERE email = ?', args: [mail] });
    const a = r.rows[0];
    if (!a || hashSenha(senha, a.sal) !== a.senha_hash) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    const tk = await novaSessao(db, a.id);
    return res.status(200).json({ token: tk, nome: a.nome });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
