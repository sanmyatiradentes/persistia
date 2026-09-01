// PersisteIA — utilitários compartilhados das funções serverless
// Banco: Turso (libSQL). Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.
// Sem as variáveis, usa um arquivo local (file:local.db) — útil só para teste.

const { createClient } = require('@libsql/client');
const crypto = require('crypto');

let db = null;
let schemaOk = false;

function getDb() {
  if (!db) {
    const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
    db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  }
  return db;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS alunos (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL, sal TEXT NOT NULL, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS config (
    aluno_id TEXT PRIMARY KEY, data_prova TEXT, horas_dia REAL, dias_semana INTEGER,
    atualizado_em TEXT)`,
  `CREATE TABLE IF NOT EXISTS editais (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, titulo TEXT, data_prova TEXT, criado_em TEXT)`,
  `CREATE TABLE IF NOT EXISTS disciplinas (
    id TEXT PRIMARY KEY, edital_id TEXT NOT NULL, nome TEXT NOT NULL, ordem INTEGER)`,
  `CREATE TABLE IF NOT EXISTS topicos (
    id TEXT PRIMARY KEY, disciplina_id TEXT NOT NULL, nome TEXT NOT NULL, ordem INTEGER)`,
  `CREATE TABLE IF NOT EXISTS eventos (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, tipo TEXT NOT NULL,
    assunto TEXT, verbo TEXT, detalhe TEXT, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS progresso (
    aluno_id TEXT NOT NULL, assunto TEXT NOT NULL, verbo TEXT NOT NULL,
    status TEXT NOT NULL, atualizado_em TEXT NOT NULL,
    PRIMARY KEY (aluno_id, assunto, verbo))`,
  `CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, frente TEXT NOT NULL, verso TEXT NOT NULL,
    origem TEXT, intervalo_dias REAL NOT NULL DEFAULT 0,
    proxima_revisao TEXT NOT NULL, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cronograma (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, topico_id TEXT NOT NULL,
    data TEXT NOT NULL, ordem INTEGER, status TEXT NOT NULL DEFAULT 'pendente')`,
  `CREATE TABLE IF NOT EXISTS conteudos (
    topico_id TEXT PRIMARY KEY, json TEXT NOT NULL, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS assinaturas (
    aluno_id TEXT PRIMARY KEY, estado TEXT NOT NULL DEFAULT 'teste',
    inicio_teste TEXT, fim_teste TEXT, preapproval_id TEXT, valor REAL,
    proxima_cobranca TEXT, cortesia_ate TEXT, atualizado_em TEXT)`,
  `CREATE TABLE IF NOT EXISTS sugestoes (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, nome TEXT, email TEXT,
    texto TEXT NOT NULL, print TEXT, pagina TEXT,
    status TEXT NOT NULL DEFAULT 'nova', resposta TEXT,
    criado_em TEXT NOT NULL, respondido_em TEXT)`,
  // um pagamento avulso só pode creditar dias uma vez, por mais avisos que cheguem
  `CREATE TABLE IF NOT EXISTS pagamentos (
    id TEXT PRIMARY KEY, aluno_id TEXT NOT NULL, meses INTEGER, valor REAL,
    meio TEXT, status TEXT, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS duvidas (
    id TEXT PRIMARY KEY, aluno_id TEXT, assunto TEXT, pergunta TEXT NOT NULL,
    resposta TEXT NOT NULL, criado_em TEXT NOT NULL)`
];

const MIGRACOES = [
  'ALTER TABLE editais ADD COLUMN banca TEXT',
  'ALTER TABLE config ADD COLUMN estilo_questao TEXT',
  // peso = horas de estudo que o tópico realmente exige (estimadas na leitura do edital)
  'ALTER TABLE topicos ADD COLUMN peso REAL',
  // um tópico grande vira várias sessões: parte 2 de 3, 1,5 h cada
  'ALTER TABLE cronograma ADD COLUMN parte INTEGER',
  'ALTER TABLE cronograma ADD COLUMN partes INTEGER',
  'ALTER TABLE cronograma ADD COLUMN horas REAL',
  // acesso comprado avulso (Pix, boleto, cartão à vista): vale até esta data
  'ALTER TABLE assinaturas ADD COLUMN acesso_ate TEXT'
];

async function ensureSchema() {
  if (schemaOk) return;
  const d = getDb();
  for (const sql of DDL) await d.execute(sql);
  for (const sql of MIGRACOES) { try { await d.execute(sql); } catch (_) { /* já existe */ } }
  schemaOk = true;
}

function agora() { return new Date().toISOString(); }
function emDias(n, base) {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

// ----- assinatura -----
const TRIAL_DIAS = Number(process.env.TRIAL_DIAS) || 7;
const PRECO = Number(process.env.PRECO_MENSAL) || 59.9;

function admins() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}
function ehAdmin(email) {
  const lista = admins();
  return !!email && lista.includes(String(email).toLowerCase());
}

// Estado de acesso do aluno. O teste começa no primeiro acesso e dura TRIAL_DIAS.
// Admin e cortesia nunca são bloqueados.
async function acessoDoAluno(aluno) {
  const d = getDb();
  let r = await d.execute({ sql: 'SELECT * FROM assinaturas WHERE aluno_id = ?', args: [aluno.id] });
  if (!r.rows.length) {
    await d.execute({
      sql: `INSERT INTO assinaturas (aluno_id, estado, inicio_teste, fim_teste, valor, atualizado_em)
            VALUES (?,?,?,?,?,?)`,
      args: [aluno.id, 'teste', agora(), emDias(TRIAL_DIAS), PRECO, agora()]
    });
    r = await d.execute({ sql: 'SELECT * FROM assinaturas WHERE aluno_id = ?', args: [aluno.id] });
  }
  const a = r.rows[0];
  const hoje = agora();
  const admin = ehAdmin(aluno.email);
  const cortesia = a.cortesia_ate && a.cortesia_ate > hoje;
  const emTeste = a.estado === 'teste' && a.fim_teste && a.fim_teste > hoje;
  const ativa = a.estado === 'ativa';
  const bloqueado = a.estado === 'bloqueada';
  // Quem cancela não perde o que já pagou: segue com acesso até a data da
  // próxima cobrança que não vai mais acontecer.
  const encerrando = a.estado === 'cancelada' && a.proxima_cobranca && a.proxima_cobranca > hoje;
  // acesso pago avulso (Pix e afins): vale sozinho, sem depender do estado
  const avulso = a.acesso_ate && a.acesso_ate > hoje;

  let estado = 'expirado';
  if (bloqueado && !admin) estado = 'bloqueada';
  else if (admin) estado = 'admin';
  else if (ativa) estado = 'ativa';
  else if (avulso) estado = 'avulso';
  else if (encerrando) estado = 'encerrando';
  else if (cortesia) estado = 'cortesia';
  else if (emTeste) estado = 'teste';

  const fim = estado === 'cortesia' ? a.cortesia_ate : (estado === 'avulso' ? a.acesso_ate : a.fim_teste);
  const dias = fim ? Math.max(0, Math.ceil((new Date(fim) - new Date()) / 86400000)) : null;

  return {
    estado,
    estado_bruto: a.estado || null,
    liberado: estado !== 'expirado' && estado !== 'bloqueada',
    dias_restantes: (estado === 'teste' || estado === 'cortesia' || estado === 'avulso') ? dias : null,
    acesso_ate: a.acesso_ate || null,
    fim_teste: a.fim_teste || null,
    proxima_cobranca: a.proxima_cobranca || null,
    preapproval_id: a.preapproval_id || null,
    valor: Number(a.valor) || PRECO,
    admin
  };
}
// ----- pagamento avulso (Pix, boleto, cartão à vista) -----
// Assinatura recorrente só existe em cartão de crédito, e boa parte dos
// candidatos não tem um. Aqui o aluno compra um período fechado e o acesso vale
// até a data comprada — sem cobrança automática e sem nada para cancelar depois.
//
// PACOTES_AVULSOS aceita "meses:preço" separados por vírgula, por exemplo:
//   PACOTES_AVULSOS="1:59.90,3:161.70,6:305.40,12:574.80"
// Sem a variável, cada pacote sai pelo preço cheio multiplicado pelos meses.
function pacotesAvulsos() {
  const bruto = String(process.env.PACOTES_AVULSOS || '').trim();
  if (bruto) {
    const lista = bruto.split(',').map(p => {
      const [m, v] = p.split(':');
      return { meses: Number(String(m).trim()), valor: Math.round(Number(String(v).trim()) * 100) / 100 };
    }).filter(p => p.meses > 0 && p.valor > 0);
    if (lista.length) return lista.sort((a, b) => a.meses - b.meses);
  }
  return [1, 3, 6, 12].map(m => ({ meses: m, valor: Math.round(PRECO * m * 100) / 100 }));
}

function pacotePorMeses(meses) {
  return pacotesAvulsos().find(p => p.meses === Number(meses)) || null;
}

/**
 * Credita dias de acesso a partir de um pagamento aprovado, uma única vez.
 * Se o aluno ainda tem acesso, os dias somam ao fim do período atual — quem
 * paga adiantado não perde o que já tinha.
 */
async function creditarAcesso(pagamentoId, alunoId, meses, valor, meio) {
  const d = getDb();
  const ja = await d.execute({ sql: 'SELECT id FROM pagamentos WHERE id = ?', args: [String(pagamentoId)] });
  if (ja.rows.length) return { creditado: false, motivo: 'ja_creditado' };

  const r = await d.execute({ sql: 'SELECT acesso_ate FROM assinaturas WHERE aluno_id = ?', args: [alunoId] });
  if (!r.rows.length) return { creditado: false, motivo: 'aluno_sem_assinatura' };

  const atual = r.rows[0].acesso_ate;
  const base = (atual && atual > agora()) ? atual : agora();
  const ate = emDias(Math.round(Number(meses) * 30), base);

  await d.execute({
    sql: `INSERT INTO pagamentos (id, aluno_id, meses, valor, meio, status, criado_em) VALUES (?,?,?,?,?,?,?)`,
    args: [String(pagamentoId), alunoId, Number(meses), Number(valor) || null, meio || null, 'aprovado', agora()]
  });
  await d.execute({
    sql: 'UPDATE assinaturas SET acesso_ate = ?, atualizado_em = ? WHERE aluno_id = ?',
    args: [ate, agora(), alunoId]
  });
  return { creditado: true, acesso_ate: ate };
}

function id() { return crypto.randomUUID(); }

function hashSenha(senha, sal) {
  return crypto.scryptSync(String(senha), sal, 32).toString('hex');
}

async function alunoDoToken(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT a.id, a.nome, a.email FROM sessoes s JOIN alunos a ON a.id = s.aluno_id WHERE s.token = ?`,
    args: [token]
  });
  return r.rows[0] || null;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

// Modelos por tarefa:
//   GEMINI_MODEL       → qualidade (edital e conteúdo, gerados uma vez e cacheados)
//   GEMINI_MODEL_LEVE  → volume (Persi tira-dúvidas, muitas chamadas por aluno)
// Para economizar ao máximo, basta apontar os dois para o mesmo modelo lite.
const MODELO_PADRAO = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MODELO_LEVE = process.env.GEMINI_MODEL_LEVE || 'gemini-2.5-flash-lite';

const espera = ms => new Promise(r => setTimeout(r, ms));

// Fila de modelos: se o primeiro estiver sobrecarregado, tentamos o seguinte.
// GEMINI_MODELOS_RESERVA permite acrescentar outros sem mexer no código.
function filaDeModelos(modelo) {
  const primeiro = modelo || MODELO_PADRAO;
  const reserva = String(process.env.GEMINI_MODELOS_RESERVA || '')
    .split(',').map(m => m.trim()).filter(Boolean);
  const padrao = [MODELO_PADRAO, MODELO_LEVE, 'gemini-2.0-flash'];
  const fila = [primeiro, ...reserva, ...padrao];
  return fila.filter((m, i) => m && fila.indexOf(m) === i);
}

// Erros que passam com o tempo (sobrecarga, limite momentâneo, queda de rede)
// merecem outra tentativa; erro de chave ou de pedido malfeito, não.
function ehPassageiro(status, msg) {
  if (status === 429 || status === 408 || (status >= 500 && status <= 599)) return true;
  if (status) return false;
  return /fetch failed|network|timeout|socket|ECONN|EAI_AGAIN|aborted|vazia|incompleta/i.test(String(msg || ''));
}

function corpoGemini(systemText, partes, jsonSchema) {
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS) || 24576,
      // o raciocínio interno do 2.5 gasta o mesmo orçamento da resposta e é o que
      // vinha cortando o texto no meio da frase; aqui ele fica desligado por padrão
      thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING || 0) }
    }
  };
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = jsonSchema;
  }
  return body;
}

async function umaChamada(model, body, key) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!r.ok) {
    const e = new Error('Gemini HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  const cand = (data.candidates || [])[0] || {};
  const text = (cand.content || {}).parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Resposta vazia do modelo');
  // MAX_TOKENS = veio pela metade. Melhor tentar de novo do que gravar no cache
  // um texto que morre no meio da frase.
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error('Resposta incompleta do modelo (' + cand.finishReason + ')');
  }
  return text;
}

// Núcleo com paciência: para cada modelo da fila, tenta algumas vezes com
// intervalos crescentes. Sobrecarga do Google deixa de virar erro na tela do
// aluno — ele só espera alguns segundos a mais.
async function geminiComPaciencia(systemText, partes, jsonSchema, modelo) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const body = corpoGemini(systemText, partes, jsonSchema);
  const modelos = filaDeModelos(modelo);
  const tentativasPorModelo = Math.max(1, Number(process.env.GEMINI_TENTATIVAS) || 3);
  const pausas = [700, 1800, 4000, 7000];
  // A função tem tempo limitado no servidor: insistir além disso derruba tudo.
  const limite = Date.now() + (Number(process.env.GEMINI_ORCAMENTO_MS) || 45000);
  let ultimo = null;

  for (let m = 0; m < modelos.length; m++) {
    for (let t = 0; t < tentativasPorModelo; t++) {
      try {
        return await umaChamada(modelos[m], body, key);
      } catch (e) {
        ultimo = e;
        if (!ehPassageiro(e.status, e.message)) throw e; // chave inválida, pedido malfeito
        const ultimaChance = (m === modelos.length - 1) && (t === tentativasPorModelo - 1);
        const pausa = pausas[Math.min(t, pausas.length - 1)] * (e.status === 429 ? 2 : 1)
                    + Math.floor(Math.random() * 400); // jitter: evita repetir o mesmo instante
        if (ultimaChance || Date.now() + pausa > limite) throw e;
        await espera(pausa);
      }
    }
  }
  throw ultimo || new Error('Falha ao chamar o modelo');
}

// Traduz a falha da IA para algo que o aluno entenda, e devolve 503 quando o
// problema é fila do Google — assim o aplicativo sabe que vale tentar de novo.
function falhaIA(e, mensagemPadrao) {
  const msg = String((e && e.message) || e || '');
  const congestionado = ehPassageiro(e && e.status, msg);
  if (congestionado) {
    return {
      status: 503,
      corpo: {
        erro: 'A IA está com muita procura neste momento',
        congestionado: true,
        detalhe: 'Tentei algumas vezes automaticamente. É passageiro — em alguns minutos costuma voltar.'
      }
    };
  }
  return { status: 500, corpo: { erro: mensagemPadrao, detalhe: msg.slice(0, 200) } };
}

async function chamarGeminiPartes(systemText, partes, jsonSchema, modelo) {
  return geminiComPaciencia(systemText, partes, jsonSchema, modelo);
}

async function chamarGemini(systemText, userText, jsonSchema, modelo) {
  return geminiComPaciencia(systemText, [{ text: userText }], jsonSchema, modelo);
}

module.exports = { getDb, ensureSchema, agora, emDias, id, hashSenha, alunoDoToken, cors, chamarGemini, chamarGeminiPartes, falhaIA, MODELO_PADRAO, MODELO_LEVE, acessoDoAluno, ehAdmin, TRIAL_DIAS, PRECO, pacotesAvulsos, pacotePorMeses, creditarAcesso };
