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

Sem as variáveis do Turso, o site funciona em modo demonstração (sem login e sem salvar).

## Publicar / atualizar

Conecte o repositório à Vercel e faça Deploy — sem configuração extra.
Para atualizar, substitua os arquivos e faça commit: a Vercel republica sozinha.

© PersisteIA — Sanmya Leite e Jane Sousa. Todos os direitos reservados.
