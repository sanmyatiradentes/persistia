// Painel da gestora. Só responde a e-mails listados em ADMIN_EMAILS.
// GET                                   → métricas + lista de alunos
// POST {aluno_id, acao:'cortesia', dias} → libera acesso sem cobrança
// POST {aluno_id, acao:'bloquear'|'liberar'}
// POST {aluno_id, acao:'resetar_teste', dias}
// POST {aluno_id, acao:'editar', nome?, email?}
// POST {aluno_id, acao:'nova_senha'}            → manda o link de nova senha
// POST {aluno_id, acao:'senha_provisoria'}      → define uma senha na hora e devolve para repassar
// POST {acao:'avisar', assunto, mensagem, para} → aviso por e-mail (todos ou um grupo)
// POST {acao:'testar_email', para?}             → confere se o Resend está ligado
const { getDb, ensureSchema, agora, emDias, alunoDoToken, cors, ehAdmin, hashSenha, PRECO, TRIAL_DIAS } = require('./_lib');
const { enviarEmail, remetente, remetenteProprio } = require('./_email');
const crypto = require('crypto');

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'persisteia.com.br';
  return 'https://' + host;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });
  if (!ehAdmin(aluno.email)) return res.status(403).json({ erro: 'Área restrita' });
  const db = getDb();

  try {
    if (req.method === 'POST') {
      const { aluno_id, acao, dias } = req.body || {};
      if (!aluno_id || !acao) return res.status(400).json({ erro: 'Informe aluno_id e acao' });

      if (acao === 'cortesia') {
        const n = Math.min(3650, Math.max(1, Number(dias) || 30));
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, cortesia_ate, valor, atualizado_em)
                VALUES (?,?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET cortesia_ate = excluded.cortesia_ate, atualizado_em = excluded.atualizado_em`,
          args: [aluno_id, 'teste', emDias(n), PRECO, agora()]
        });
        return res.status(200).json({ ok: true, cortesia_dias: n });
      }
      if (acao === 'resetar_teste') {
        const n = Math.min(365, Math.max(1, Number(dias) || TRIAL_DIAS));
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, inicio_teste, fim_teste, valor, atualizado_em)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET estado='teste', inicio_teste=excluded.inicio_teste,
                  fim_teste=excluded.fim_teste, atualizado_em=excluded.atualizado_em`,
          args: [aluno_id, 'teste', agora(), emDias(n), PRECO, agora()]
        });
        return res.status(200).json({ ok: true, teste_dias: n });
      }
      if (acao === 'bloquear' || acao === 'liberar') {
        await db.execute({
          sql: `INSERT INTO assinaturas (aluno_id, estado, valor, atualizado_em) VALUES (?,?,?,?)
                ON CONFLICT(aluno_id) DO UPDATE SET estado = excluded.estado, atualizado_em = excluded.atualizado_em`,
          args: [aluno_id, acao === 'bloquear' ? 'bloqueada' : 'teste', PRECO, agora()]
        });
        return res.status(200).json({ ok: true });
      }

      // ----- corrigir nome e e-mail do aluno -----
      if (acao === 'editar') {
        const { nome, email } = req.body || {};
        const campos = [], valores = [];
        if (nome != null && String(nome).trim()) { campos.push('nome = ?'); valores.push(String(nome).trim().slice(0, 120)); }
        if (email != null && String(email).trim()) {
          const mail = String(email).trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ erro: 'E-mail inválido' });
          const ja = await db.execute({ sql: 'SELECT id FROM alunos WHERE email = ? AND id <> ?', args: [mail, aluno_id] });
          if (ja.rows.length) return res.status(409).json({ erro: 'Já existe outra conta com esse e-mail' });
          campos.push('email = ?'); valores.push(mail);
        }
        if (!campos.length) return res.status(400).json({ erro: 'Nada para alterar' });
        valores.push(aluno_id);
        await db.execute({ sql: 'UPDATE alunos SET ' + campos.join(', ') + ' WHERE id = ?', args: valores });
        const r = await db.execute({ sql: 'SELECT nome, email FROM alunos WHERE id = ?', args: [aluno_id] });
        return res.status(200).json({ ok: true, aluno: r.rows[0] || null });
      }

      // ----- mandar o link de nova senha para o aluno -----
      // A gestora nunca vê nem escolhe a senha de ninguém: o aluno recebe um
      // link e cria a dele. Se o e-mail não sair, devolvemos o link para você
      // passar por WhatsApp.
      if (acao === 'nova_senha') {
        const r = await db.execute({ sql: 'SELECT id, nome, email FROM alunos WHERE id = ?', args: [aluno_id] });
        const al = r.rows[0];
        if (!al) return res.status(404).json({ erro: 'Aluno não encontrado' });

        const chave = crypto.randomBytes(24).toString('hex');
        await db.execute({
          sql: 'INSERT INTO tokens_senha (token, aluno_id, expira_em, usado, criado_em) VALUES (?,?,?,0,?)',
          args: [chave, al.id, emDias(2), agora()]
        });
        const link = siteUrl(req) + '/?nova-senha=' + chave;

        const envio = await enviarEmail({
          para: al.email,
          assunto: 'Link para criar sua nova senha da PersisteIA',
          titulo: 'Crie uma nova senha',
          corpo: `<p style="margin:0 0 14px">Oi, ${al.nome ? String(al.nome).split(' ')[0] : 'tudo bem'}!</p>
                  <p style="margin:0 0 14px">Geramos um link para você criar uma senha nova e voltar a estudar.</p>
                  <p style="margin:0">Ele vale por <b>48 horas</b> e pode ser usado uma vez só.</p>`,
          botao: { texto: 'Criar minha nova senha', url: link },
          rodape: 'Se você não pediu isso, avise a gente respondendo este e-mail.',
          texto: 'Crie sua nova senha em: ' + link
        });

        return res.status(200).json({
          ok: true, email: al.email, enviado: !!envio.enviado,
          motivo: envio.motivo || null,
          // o link volta sempre: é a saída quando o e-mail falha
          link
        });
      }

      // ----- aviso por e-mail -----
      if (acao === 'avisar') {
        const { assunto, mensagem, para } = req.body || {};
        if (!assunto || !mensagem) return res.status(400).json({ erro: 'Informe assunto e mensagem' });

        let destinos = [];
        if (aluno_id && aluno_id !== 'todos') {
          const r = await db.execute({ sql: 'SELECT nome, email FROM alunos WHERE id = ?', args: [aluno_id] });
          destinos = r.rows;
        } else {
          const r = await db.execute('SELECT a.nome, a.email, s.estado, s.fim_teste, s.cortesia_ate, s.acesso_ate FROM alunos a LEFT JOIN assinaturas s ON s.aluno_id = a.id LIMIT 500');
          const hoje2 = agora();
          destinos = r.rows.filter(x => {
            if (para === 'assinantes') return x.estado === 'ativa' || (x.acesso_ate && x.acesso_ate > hoje2);
            if (para === 'teste') return (x.estado || 'teste') === 'teste' && x.fim_teste && x.fim_teste > hoje2;
            if (para === 'expirados') {
              const vivo = x.estado === 'ativa' || (x.acesso_ate && x.acesso_ate > hoje2) ||
                           (x.cortesia_ate && x.cortesia_ate > hoje2) || (x.fim_teste && x.fim_teste > hoje2);
              return !vivo;
            }
            return true;
          });
        }

        let enviados = 0, falhas = 0;
        for (const d of destinos) {
          const nomeCurto = d.nome ? String(d.nome).split(' ')[0] : 'tudo bem';
          const corpoHtml = '<p style="margin:0 0 14px">Oi, ' + nomeCurto + '!</p>' +
            String(mensagem).split(/\n{2,}/).map(par =>
              '<p style="margin:0 0 14px">' + String(par).replace(/\n/g, '<br>') + '</p>').join('');
          const envio = await enviarEmail({
            para: d.email,
            assunto: String(assunto).slice(0, 160),
            titulo: String(assunto).slice(0, 160),
            corpo: corpoHtml,
            botao: { texto: 'Abrir a PersisteIA', url: siteUrl(req) },
            rodape: 'Você recebeu este aviso porque tem conta na PersisteIA.'
          });
          if (envio.enviado) enviados++; else falhas++;
        }
        return res.status(200).json({ ok: true, destinatarios: destinos.length, enviados, falhas });
      }

      // ----- definir uma senha provisória na hora -----
      // O caminho preferido continua sendo o link ("nova_senha"): ninguém, nem
      // você, precisa saber a senha de um aluno. Mas quando o e-mail não chega
      // ou o aluno está no telefone com você, isto resolve na hora. A senha é
      // sorteada pelo sistema, aparece UMA vez para você repassar, e todas as
      // sessões antigas daquele aluno caem.
      if (acao === 'senha_provisoria') {
        const r = await db.execute({ sql: 'SELECT id, nome, email FROM alunos WHERE id = ?', args: [aluno_id] });
        const al = r.rows[0];
        if (!al) return res.status(404).json({ erro: 'Aluno não encontrado' });

        // fácil de ditar por telefone: sem caracteres que se confundem
        const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
        let senha = '';
        const sorteio = crypto.randomBytes(10);
        for (let i = 0; i < 10; i++) senha += alfabeto[sorteio[i] % alfabeto.length];

        const sal = crypto.randomBytes(16).toString('hex');
        await db.execute({
          sql: 'UPDATE alunos SET senha_hash = ?, sal = ? WHERE id = ?',
          args: [hashSenha(senha, sal), sal, al.id]
        });
        await db.execute({ sql: 'DELETE FROM sessoes WHERE aluno_id = ?', args: [al.id] });
        await db.execute({ sql: 'UPDATE tokens_senha SET usado = 1 WHERE aluno_id = ? AND usado = 0', args: [al.id] });

        // avisa o aluno de que a senha mudou — trocar senha sem avisar é feio
        enviarEmail({
          para: al.email,
          assunto: 'Sua senha da PersisteIA foi redefinida',
          titulo: 'Definimos uma senha provisória',
          corpo: '<p style="margin:0 0 14px">Oi, ' + (al.nome ? String(al.nome).split(' ')[0] : 'tudo bem') + '!</p>' +
                 '<p style="margin:0 0 14px">A pedido do suporte, criamos uma senha provisória para a sua conta. ' +
                 'Ela foi passada a você diretamente.</p>' +
                 '<p style="margin:0">Assim que entrar, troque por uma senha sua em “Esqueci minha senha”.</p>',
          botao: { texto: 'Entrar na PersisteIA', url: siteUrl(req) },
          rodape: 'Se não foi você que pediu, responda este e-mail imediatamente.'
        }).catch(function () {});

        return res.status(200).json({ ok: true, email: al.email, nome: al.nome, senha });
      }

      // ----- conferir se o e-mail está mesmo saindo -----
      if (acao === 'testar_email') {
        const destino = String((req.body || {}).para || aluno.email).trim();
        const envio = await enviarEmail({
          para: destino,
          assunto: 'Teste de e-mail da PersisteIA',
          titulo: 'O envio está funcionando',
          corpo: '<p style="margin:0 0 14px">Se você está lendo isto, o Resend está ligado corretamente ao PersisteIA.</p>' +
                 '<p style="margin:0">A partir de agora, o “esqueci minha senha”, as boas-vindas e os avisos chegam por aqui.</p>',
          rodape: 'Mensagem de teste enviada pelo painel da gestora.'
        });
        return res.status(200).json({
          ok: true,
          destino,
          enviado: !!envio.enviado,
          motivo: envio.motivo || null,
          detalhe: envio.detalhe || null,
          remetente: remetente(),
          dominio_proprio: remetenteProprio(),
          chave_configurada: !!process.env.RESEND_API_KEY
        });
      }

      return res.status(400).json({ erro: 'Ação não reconhecida' });
    }

    const q = new URL(req.url, 'http://x').searchParams;

    // ----- ver o que o aluno vê: o material gerado para ele -----
    // Só o conteúdo de estudo. Anotações no texto, gravações de voz e mensagens
    // continuam sendo do aluno: nada disso passa por aqui.
    if (q.get('aluno')) {
      const alunoId = q.get('aluno');
      const dono = await db.execute({ sql: 'SELECT id, nome, email FROM alunos WHERE id = ?', args: [alunoId] });
      if (!dono.rows.length) return res.status(404).json({ erro: 'Aluno não encontrado' });

      const ed = await db.execute({
        sql: 'SELECT id, titulo, banca, data_prova FROM editais WHERE aluno_id = ? ORDER BY criado_em DESC LIMIT 1',
        args: [alunoId]
      });
      if (!ed.rows.length) return res.status(200).json({ aluno: dono.rows[0], edital: null, itens: [] });

      const itens = await db.execute({
        sql: `SELECT c.id AS cron_id, c.data, c.status, c.parte, c.partes, c.horas,
                     t.id AS topico_id, t.nome AS topico, t.ordem AS ordem_topico,
                     d.nome AS disciplina, d.ordem AS ordem_disc,
                     (SELECT COUNT(*) FROM conteudos k
                       WHERE k.topico_id = t.id OR k.topico_id LIKE t.id || ':%') AS pacotes
              FROM cronograma c
              JOIN topicos t ON t.id = c.topico_id
              JOIN disciplinas d ON d.id = t.disciplina_id
              WHERE c.aluno_id = ?
              ORDER BY d.ordem, t.ordem, c.parte`,
        args: [alunoId]
      });

      return res.status(200).json({
        aluno: dono.rows[0],
        edital: ed.rows[0],
        itens: itens.rows.map(r => ({
          cron_id: r.cron_id, data: r.data, status: r.status,
          parte: Number(r.parte) || 1, partes: Number(r.partes) || 1, horas: r.horas,
          topico_id: r.topico_id, topico: r.topico, disciplina: r.disciplina,
          gerado: Number(r.pacotes) > 0
        }))
      });
    }

    // ----- o pacote gerado de um tópico, como o aluno recebeu -----
    if (q.get('conteudo')) {
      const topicoId = q.get('conteudo');
      // a chave do cache é a mesma que o gerador usa: "topico:2/3" quando o
      // assunto foi dividido em partes
      const parte = Math.max(1, Number(q.get('parte')) || 1);
      const partes = Math.max(1, Number(q.get('partes')) || 1);
      const chave = partes > 1 ? topicoId + ':' + parte + '/' + partes : topicoId;
      const r = await db.execute({
        sql: 'SELECT json, criado_em FROM conteudos WHERE topico_id = ?', args: [chave]
      });
      if (!r.rows.length) {
        return res.status(404).json({ erro: 'Este assunto ainda não foi gerado — o material nasce quando o aluno abre o dia.' });
      }
      let pacote = null;
      try { pacote = JSON.parse(r.rows[0].json); } catch (_) {}
      return res.status(200).json({ pacote, criado_em: r.rows[0].criado_em });
    }

    const alunos = await db.execute(`
      SELECT a.id, a.nome, a.email, a.criado_em,
             s.estado, s.fim_teste, s.cortesia_ate, s.proxima_cobranca,
             (SELECT COUNT(*) FROM eventos e WHERE e.aluno_id = a.id) AS eventos,
             (SELECT MAX(criado_em) FROM eventos e WHERE e.aluno_id = a.id) AS ultimo_evento,
             (SELECT titulo FROM editais ed WHERE ed.aluno_id = a.id ORDER BY ed.criado_em DESC LIMIT 1) AS edital,
             (SELECT COUNT(*) FROM cronograma c WHERE c.aluno_id = a.id) AS sessoes,
             (SELECT COUNT(*) FROM cronograma c WHERE c.aluno_id = a.id AND c.status = 'concluido') AS concluidas
      FROM alunos a LEFT JOIN assinaturas s ON s.aluno_id = a.id
      ORDER BY a.criado_em DESC LIMIT 500`);

    const hoje = agora();
    const lista = alunos.rows.map(r => {
      const cortesia = r.cortesia_ate && r.cortesia_ate > hoje;
      const emTeste = (r.estado || 'teste') === 'teste' && r.fim_teste && r.fim_teste > hoje;
      let situacao = 'expirado';
      if (r.estado === 'bloqueada') situacao = 'bloqueado';
      else if (r.estado === 'ativa') situacao = 'assinante';
      else if (cortesia) situacao = 'cortesia';
      else if (emTeste) situacao = 'teste';
      else if (!r.estado) situacao = 'novo';
      const fim = cortesia ? r.cortesia_ate : r.fim_teste;
      return {
        id: r.id, nome: r.nome, email: r.email, criado_em: r.criado_em,
        situacao,
        dias_restantes: fim ? Math.max(0, Math.ceil((new Date(fim) - new Date()) / 86400000)) : null,
        proxima_cobranca: r.proxima_cobranca || null,
        edital: r.edital || null,
        sessoes: Number(r.sessoes) || 0,
        concluidas: Number(r.concluidas) || 0,
        eventos: Number(r.eventos) || 0,
        ultimo_evento: r.ultimo_evento || null
      };
    });

    const cont = k => lista.filter(a => a.situacao === k).length;
    const ativos7 = lista.filter(a => a.ultimo_evento && (Date.now() - new Date(a.ultimo_evento)) < 7 * 86400000).length;
    const conteudos = await db.execute('SELECT COUNT(*) AS n FROM conteudos');
    let audios = 0;
    try { audios = Number((await db.execute('SELECT COUNT(*) AS n FROM audios')).rows[0].n); } catch (_) {}

    return res.status(200).json({
      metricas: {
        alunos: lista.length,
        assinantes: cont('assinante'),
        em_teste: cont('teste') + cont('novo'),
        cortesia: cont('cortesia'),
        expirados: cont('expirado'),
        bloqueados: cont('bloqueado'),
        ativos_7d: ativos7,
        receita_mensal: Math.round(cont('assinante') * PRECO * 100) / 100,
        preco: PRECO,
        catalogo_conteudos: Number(conteudos.rows[0].n) || 0,
        catalogo_audios: audios
      },
      alunos: lista
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno', detalhe: String(e).slice(0, 200) });
  }
};
