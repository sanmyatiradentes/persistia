// Envio de e-mail pelo Resend.
//
// Variáveis na Vercel (mesma convenção do ExecuteIA, para uma conta Resend
// atender aos dois projetos):
//   RESEND_API_KEY   → a chave da conta (re_...)
//   EMAIL_FROM       → remetente verificado, ex.: "PersisteIA <contato@persisteia.com.br>"
//                      (EMAIL_REMETENTE também é aceito, por compatibilidade)
//   EMAIL_RESPOSTA   → opcional: para onde vai a resposta do aluno
//
// Sem a chave configurada, nada quebra: o envio devolve {enviado:false} e quem
// chamou decide o que dizer ao aluno.
//
// ATENÇÃO ao remetente padrão: enquanto o domínio não estiver verificado no
// Resend, o endereço onboarding@resend.dev só entrega para o e-mail dono da
// conta. Serve para testar, NÃO serve para os alunos.

const REMETENTE_PADRAO = 'PersisteIA <onboarding@resend.dev>';

function remetente() {
  return process.env.EMAIL_FROM || process.env.EMAIL_REMETENTE || REMETENTE_PADRAO;
}

// true quando o remetente já é do domínio próprio (entrega para qualquer aluno)
function remetenteProprio() {
  return !/resend\.dev/i.test(remetente());
}

function escapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Carta simples, na cor da marca, que funciona bem em qualquer aplicativo de e-mail.
function molde({ titulo, corpo, botao, rodape }) {
  const acao = botao
    ? `<tr><td style="padding:6px 0 22px">
         <a href="${escapar(botao.url)}"
            style="display:inline-block;background:#0E8F6E;color:#ffffff;text-decoration:none;
                   font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">
           ${escapar(botao.texto)}
         </a>
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#EFF5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#16241D">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF5F0;padding:28px 14px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#FFFFFF;border:1px solid #DCE7DF;border-radius:18px;padding:30px 28px">
        <tr><td style="padding-bottom:18px;font-size:19px;font-weight:800;letter-spacing:-.5px">
          Persiste<span style="color:#0E8F6E">IA</span>
        </td></tr>
        <tr><td style="font-size:21px;font-weight:700;line-height:1.25;padding-bottom:14px">${escapar(titulo)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.7;color:#3A4A42;padding-bottom:20px">${corpo}</td></tr>
        ${acao}
        <tr><td style="border-top:1px solid #DCE7DF;padding-top:16px;font-size:12.5px;line-height:1.6;color:#5C6E64">
          ${rodape || 'Você recebeu este e-mail porque tem conta na PersisteIA.'}
        </td></tr>
      </table>
      <p style="max-width:520px;margin:16px auto 0;font-size:11.5px;color:#5C6E64;text-align:center;line-height:1.6">
        PersisteIA · persisteia.com.br · feito no Amazonas para concurseiros do Brasil inteiro
      </p>
    </td></tr>
  </table>
</body></html>`;
}

async function enviarEmail({ para, assunto, titulo, corpo, botao, rodape, texto }) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) return { enviado: false, motivo: 'sem_chave' };
  if (!para) return { enviado: false, motivo: 'sem_destinatario' };

  const corpoHtml = molde({ titulo, corpo, botao, rodape });
  const dados = {
    from: remetente(),
    to: Array.isArray(para) ? para : [para],
    subject: assunto,
    html: corpoHtml,
    text: texto || String(corpo).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  };
  if (process.env.EMAIL_RESPOSTA) dados.reply_to = process.env.EMAIL_RESPOSTA;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    const txt = await r.text();
    if (!r.ok) return { enviado: false, motivo: 'resend_' + r.status, detalhe: txt.slice(0, 200) };
    let id = null; try { id = JSON.parse(txt).id; } catch (_) {}
    return { enviado: true, id };
  } catch (e) {
    return { enviado: false, motivo: 'rede', detalhe: String(e).slice(0, 200) };
  }
}

module.exports = { enviarEmail, molde, remetente, remetenteProprio };
