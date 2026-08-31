// Áudio do assunto: podcast (diálogo em duas vozes) e música (letra recitada/cantada).
// POST {topico_id, tipo:'podcast'|'musica'} → {audio_base64, mime:'audio/wav'}
// Usa o TTS do Gemini (mesma GEMINI_API_KEY). Guarda em cache no Turso quando couber.
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, falhaIA } = require('./_lib');

const VOZ_A = process.env.GEMINI_VOZ_A || 'Kore';   // ANA
const VOZ_B = process.env.GEMINI_VOZ_B || 'Puck';   // LÉO
// Modelos de TTS em ordem de preferência (o mais barato primeiro).
// Se o Google aposentar um deles, o próximo assume sem precisar mexer no código.
const TTS_MODELS = (process.env.GEMINI_TTS_MODEL ||
  'gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview'
).split(',').map(s => s.trim()).filter(Boolean);

// PCM 16 bits mono → WAV (o navegador toca direto)
function pcmParaWav(pcmBase64, taxa) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + pcm.length, 4);
  cab.write('WAVE', 8);
  cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);            // PCM
  cab.writeUInt16LE(1, 22);            // mono
  cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * 2, 28);     // byte rate
  cab.writeUInt16LE(2, 32);            // block align
  cab.writeUInt16LE(16, 34);           // bits
  cab.write('data', 36);
  cab.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cab, pcm]).toString('base64');
}

// Quebra o roteiro em pedaços que cabem numa chamada, sem cortar fala no meio.
function pedacos(texto, max) {
  const linhas = String(texto).split(/\n+/);
  const saida = [];
  let atual = '';
  for (const l of linhas) {
    if ((atual + '\n' + l).length > max && atual) { saida.push(atual); atual = l; }
    else { atual = atual ? atual + '\n' + l : l; }
  }
  if (atual) saida.push(atual);
  return saida;
}

// Junta vários WAV de mesma taxa num só (concatena o PCM e refaz o cabeçalho).
function juntarWav(lista) {
  const pcms = lista.map(b64 => Buffer.from(b64, 'base64').slice(44));
  const taxa = lista.length ? Buffer.from(lista[0], 'base64').readUInt32LE(24) : 24000;
  const pcm = Buffer.concat(pcms);
  return pcmParaWav(pcm.toString('base64'), taxa);
}

async function falar(texto, doisLocutores) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');

  const speechConfig = doisLocutores
    ? {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'ANA', voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ_A } } },
            { speaker: 'LEO', voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ_B } } }
          ]
        }
      }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ_A } } };

  let r = null, ultimoErro = '';
  for (const modelo of TTS_MODELS) {
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: texto }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig }
        })
      }
    );
    if (r.ok) break;
    ultimoErro = 'TTS HTTP ' + r.status + ' (' + modelo + '): ' + (await r.text()).slice(0, 200);
    // 404/400 = modelo indisponível → tenta o próximo; outros erros param aqui
    if (r.status !== 404 && r.status !== 400) throw new Error(ultimoErro);
    r = null;
  }
  if (!r) throw new Error(ultimoErro || 'Nenhum modelo de TTS disponível');

  const data = await r.json();
  const parte = (((data.candidates || [])[0] || {}).content || {}).parts?.find(p => p.inlineData);
  if (!parte) throw new Error('O modelo não devolveu áudio');
  const mime = parte.inlineData.mimeType || '';
  const taxa = parseInt((mime.match(/rate=(\d+)/) || [])[1], 10) || 24000;
  return pcmParaWav(parte.inlineData.data, taxa);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ erro: 'Use GET ou POST' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

  const q = new URL(req.url, 'http://x').searchParams;
  const body = req.body || {};
  const topico_id = body.topico_id || q.get('topico_id');
  const tipo = body.tipo || q.get('tipo');
  // um tópico dividido em partes tem um áudio por parte
  const parte = Number(body.parte || q.get('parte')) || 0;
  const partes = Number(body.partes || q.get('partes')) || 0;
  const chave = (partes > 1 && parte) ? String(topico_id) + ':' + parte + '/' + partes : String(topico_id);
  const kind = (tipo === 'musica') ? 'musica' : 'podcast';
  if (!topico_id) return res.status(400).json({ erro: 'topico_id é obrigatório' });

  const db = getDb();
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS audios (
      topico_id TEXT NOT NULL, tipo TEXT NOT NULL, dados TEXT NOT NULL, criado_em TEXT NOT NULL,
      PRIMARY KEY (topico_id, tipo))`);

    // GET = só consulta o catálogo. Se o áudio já existe, sai de graça;
    // se não existe, o app usa a voz do próprio celular (custo zero) e só
    // gera a voz de estúdio (POST) se o aluno pedir.
    if (req.method === 'GET') {
      const c = await db.execute({
        sql: 'SELECT dados FROM audios WHERE topico_id = ? AND tipo = ?',
        args: [chave, kind]
      });
      return c.rows.length
        ? res.status(200).json({ audio_base64: c.rows[0].dados, mime: 'audio/wav', cache: true })
        : res.status(200).json({ cache: false });
    }

    const cache = await db.execute({
      sql: 'SELECT dados FROM audios WHERE topico_id = ? AND tipo = ?',
      args: [chave, kind]
    });
    if (cache.rows.length) {
      return res.status(200).json({ audio_base64: cache.rows[0].dados, mime: 'audio/wav', cache: true });
    }

    const c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave] });
    if (!c.rows.length) return res.status(404).json({ erro: 'Conteúdo do tópico ainda não foi gerado' });
    const pacote = JSON.parse(c.rows[0].json);

    let texto, dois;
    if (kind === 'podcast') {
      dois = true;
      const roteiro = String(pacote.podcast || '').slice(0, 9000)
        .replace(/L[ÉE]O/g, 'LEO')
        .replace(/^\s*[-–]\s*/gm, '');
      texto = 'Leia este roteiro de podcast de estudos em português do Brasil, com naturalidade e ritmo de conversa:\n\n' + roteiro;
    } else {
      dois = false;
      const letra = String((pacote.musica || {}).letra || '').slice(0, 1800);
      const estilo = String((pacote.musica || {}).estilo || 'ritmo animado');
      texto = 'Recite esta letra mnemônica de estudos em português do Brasil, com muita energia e cadência de ' +
              estilo + ', marcando bem o refrão:\n\n' + letra;
    }

    // roteiro grande vira 2 ou 3 chamadas e volta como um áudio só
    const blocos = pedacos(texto, 2600).slice(0, 4);
    const wavs = [];
    for (const bloco of blocos) {
      wavs.push(await falar(bloco, dois));
    }
    const wav = wavs.length > 1 ? juntarWav(wavs) : wavs[0];

    // cache best-effort (áudio grande pode não caber numa linha)
    try {
      await db.execute({
        sql: 'INSERT OR REPLACE INTO audios (topico_id, tipo, dados, criado_em) VALUES (?,?,?,?)',
        args: [chave, kind, wav, agora()]
      });
    } catch (_) {}

    return res.status(200).json({ audio_base64: wav, mime: 'audio/wav' });
  } catch (e) {
    const f = falhaIA(e, 'Falha ao gerar o áudio');
    return res.status(f.status).json(f.corpo);
  }
};
