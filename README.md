# PersisteIA

Sistema de estudos para concursos: o aluno envia o edital e a Esteira de Aprendizado
Ativo (8 verbos) devolve um plano diário — com Leitor estilo Kindle, Persi tira-dúvidas,
flashcards com repetição espaçada e dashboard de evolução.

## Arquitetura (padrão da casa)

- `index.html` — o aplicativo (estático, mobile-first).
- `api/` — funções serverless na Vercel (prompts protegidos no servidor):
  `auth` (cadastro/login), `aluno` (perfil/config), `edital` (análise real com Gemini),
  `persi` (tira-dúvidas com Gemini), `evento` (progresso), `flashcard` (repetição espaçada).
- Banco: **Turso** (libSQL). O schema é criado automaticamente no primeiro uso.

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Valor |
|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio |
| `GEMINI_MODEL` | (opcional) modelo de qualidade — padrão `gemini-2.5-flash` |
| `GEMINI_MODEL_LEVE` | (opcional) modelo econômico do Persi — padrão `gemini-2.5-flash-lite` |
| `TURSO_DATABASE_URL` | URL `libsql://…` do banco no Turso |
| `TURSO_AUTH_TOKEN` | token do banco no Turso |
| `ADMIN_EMAILS` | e-mails com acesso ao painel da gestora, separados por vírgula |
| `MP_ACCESS_TOKEN` | Access Token de produção do Mercado Pago (Suas integrações → Credenciais) |
| `MP_WEBHOOK_SECRET` | (opcional, recomendado) segredo da assinatura do webhook |
| `SITE_URL` | (opcional) endereço público, ex.: `https://persisteia.com.br` |
| `PRECO_MENSAL` | (opcional) valor da assinatura — padrão `59.9` |
| `TRIAL_DIAS` | (opcional) dias de teste grátis — padrão `7` |
| `GEMINI_TTS_MODEL` | (opcional) modelos de voz em ordem de preferência, separados por vírgula |

Sem as variáveis do Turso, o site funciona em modo demonstração (sem login e sem salvar).

## Publicar / atualizar

Conecte o repositório à Vercel e faça Deploy — sem configuração extra.
Para atualizar, substitua os arquivos e faça commit: a Vercel republica sozinha.

© PersisteIA — Sanmya Leite e Jane Sousa. Todos os direitos reservados.


## Assinatura (Mercado Pago)

1. Em **Suas integrações → Criar aplicação**, gere as credenciais de produção e copie o
   *Access Token* para `MP_ACCESS_TOKEN` na Vercel.
2. Em **Webhooks**, cadastre `https://persisteia.com.br/api/mp-webhook` e marque os tópicos
   `subscription_preapproval` e `subscription_authorized_payment`. Copie o segredo para
   `MP_WEBHOOK_SECRET`.
3. O fluxo é: 7 dias de teste sem cartão (contados a partir do primeiro acesso) →
   `POST /api/assinatura {assinar:true}` cria a assinatura recorrente e devolve o
   `init_point` do checkout → o aluno paga → o webhook confirma e libera o acesso.
4. Cobrança automática mês a mês só existe com cartão. Se o aluno pagar por Pix, o Mercado
   Pago cobra a cada ciclo por link, sem débito automático.

## Painel da gestora

Com o e-mail em `ADMIN_EMAILS`, aparece a aba **Painel**: métricas (alunos, assinantes,
em teste, ativos em 7 dias, receita recorrente, tamanho do catálogo) e a lista de alunos,
com as ações de dar 30 dias de cortesia, reiniciar o teste e bloquear/desbloquear.

## Fotos do site

Coloque `foto-sanmya.jpg` e `foto-jane.jpg` na raiz do projeto (ao lado do `index.html`).
Sem elas, o site mostra as iniciais em um círculo — nada quebra.
