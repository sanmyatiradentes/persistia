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
  `CREATE TABLE IF NOT EXISTS duvidas (
    id TEXT PRIMARY KEY, aluno_id TEXT, assunto TEXT, pergunta TEXT NOT NULL,
    resposta TEXT NOT NULL, criado_em TEXT NOT NULL)`
];

async function ensureSchema() {
  if (schemaOk) return;
  const d = getDb();
  for (const sql of DDL) await d.execute(sql);
  schemaOk = true;
}

function agora() { return new Date().toISOString(); }
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

async function chamarGeminiPartes(systemText, partes, jsonSchema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: partes }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
  };
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = jsonSchema;
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error('Gemini HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Resposta vazia do modelo');
  return text;
}

async function chamarGemini(systemText, userText, jsonSchema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
  };
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = jsonSchema;
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error('Gemini HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Resposta vazia do modelo');
  return text;
}

module.exports = { getDb, ensureSchema, agora, id, hashSenha, alunoDoToken, cors, chamarGemini, chamarGeminiPartes };
