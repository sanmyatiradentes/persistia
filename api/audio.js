// Áudio do assunto: podcast (diálogo em duas vozes) e música (letra recitada/cantada).
// POST {topico_id, tipo:'podcast'|'musica'} → {audio_base64, mime:'audio/wav'}
// Usa o TTS do Gemini (mesma GEMINI_API_KEY). Guarda em cache no Turso quando couber.
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, falhaIA, ehAdmin } = require('./_lib');

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

/* ---------- normalização do roteiro do podcast ----------
   O TTS de duas vozes do Gemini casa a fala com a voz pelo RÓTULO do locutor:
   só sai na voz da Ana o que vier depois de exatamente "ANA:", e na do Léo o que
   vier depois de "LEO:". Quando o rótulo não bate, o modelo lê tudo numa voz só.

   O modelo escreve o roteiro do jeito dele: "Ana:", "Léo:", "**Ana:**",
   "— Léo:". O código antigo só trocava "LÉO" por "LEO" — e era sensível a
   maiúsculas —, então qualquer roteiro em title case (a forma mais comum) saía
   inteiro numa voz. O front-end já lidava com todas essas variações; o áudio não.

   Aqui cada linha de fala vira "ANA:" ou "LEO:" cravado, a narração entre
   parênteses some (senão vira texto lido em voz alta) e as linhas soltas grudam
   na fala anterior, para nenhuma sobra ficar sem dono. */
function normalizarRoteiro(bruto) {
  const linhas = String(bruto || '').split(/\r?\n/);
  const falas = [];

  for (let linha of linhas) {
    // tira marcas de lista/markdown do começo: "— ", "- ", "* ", "**"
    let l = linha.replace(/^\s*[-–—*]+\s*/, '').trim();
    if (!l) continue;
    l = l.replace(/^\*\*\s*/, '').replace(/^__\s*/, '');

    // "Ana:", "ANA :", "**Léo**:", "Leo -" … tudo vira o rótulo cravado
    const m = l.match(/^\**\s*(ana|l[éeè]o|leo)\s*\**\s*[:\-–]\s*(.*)$/i);
    if (m) {
      const quem = /^a/i.test(m[1]) ? 'ANA' : 'LEO';
      const dito = limparNarracao(m[2]);
      if (dito) falas.push({ quem, texto: dito });
      continue;
    }

    // linha sem rótulo: continua a fala anterior (não pode virar órfã)
    const dito = limparNarracao(l);
    if (!dito) continue;
    if (falas.length) falas[falas.length - 1].texto += ' ' + dito;
    else falas.push({ quem: 'ANA', texto: dito });
  }

  return {
    texto: falas.map(f => f.quem + ': ' + f.texto).join('\n'),
    anas: falas.filter(f => f.quem === 'ANA').length,
    leos: falas.filter(f => f.quem === 'LEO').length
  };
}

// Rubrica de roteiro — "(rindo)", "[pausa]" — não é fala: seria lida em voz alta.
function limparNarracao(t) {
  return String(t)
    .replace(/\*\*/g, '')
    .replace(/\[[^\]]{0,60}\]/g, ' ')
    .replace(/\((?:rindo|risos|pausa|silêncio|som[^)]{0,40}|vinheta[^)]{0,40})\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  /* ---------- teste da voz de estúdio (só gestora) ----------
     Responde de uma vez: a voz de estúdio está funcionando em produção, e com
     quantos locutores? Sem isto, a única forma de saber era gerar um episódio
     inteiro e ouvir — e confundir com a voz do navegador era fácil demais. */
  if ((body.teste === true || q.get('teste') === '1')) {
    if (!ehAdmin(aluno.email)) return res.status(403).json({ erro: 'Só a gestora pode testar a voz' });
    const roteiro = 'ANA: Oi! Aqui é a Ana, e esta é a minha voz.\nLEO: E eu sou o Leo. Se você ouviu duas vozes diferentes, está tudo certo.';
    try {
      const t0 = Date.now();
      const wav = await falar(
        'Leia em voz alta esta conversa de podcast em português do Brasil, entre ANA e LEO, ' +
        'cada fala na voz de quem a diz:\n\n' + roteiro, true);
      return res.status(200).json({
        ok: true, audio_base64: wav, mime: 'audio/wav',
        vozes: 2, voz_ana: VOZ_A, voz_leo: VOZ_B,
        modelos: TTS_MODELS, segundos: Math.round((Date.now() - t0) / 100) / 10,
        kb: Math.round(Buffer.from(wav, 'base64').length / 1024)
      });
    } catch (e) {
      return res.status(200).json({ ok: false, erro: String(e && e.message).slice(0, 300), modelos: TTS_MODELS });
    }
  }

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

    // "refazer" joga fora o áudio guardado e grava de novo. Sem isso, um
    // podcast que saiu com defeito ficaria para sempre: o cache é por tópico e
    // nunca expira — foi o que manteve em circulação os episódios gravados
    // numa voz só, mesmo depois do conserto.
    const refazer = body.refazer === true || q.get('refazer') === '1';
    if (refazer) {
      await db.execute({ sql: 'DELETE FROM audios WHERE topico_id = ? AND tipo = ?', args: [chave, kind] });
      // os pedaços meio-gravados também vão embora, senão o refazer reaproveita
      await db.execute({ sql: "DELETE FROM audios WHERE topico_id = ? AND tipo LIKE ?", args: [chave, kind + ':%'] });
    } else {
      const cache = await db.execute({
        sql: 'SELECT dados FROM audios WHERE topico_id = ? AND tipo = ?',
        args: [chave, kind]
      });
      if (cache.rows.length) {
        return res.status(200).json({ audio_base64: cache.rows[0].dados, mime: 'audio/wav', cache: true });
      }
    }

    // O roteiro pode estar no pacote consolidado ou ainda no bloco "midia",
    // que é onde ele nasce enquanto o aluno está com o assunto aberto pela
    // primeira vez. Procurar só no primeiro lugar dava "conteúdo ainda não
    // foi gerado" justamente para quem estava lendo o assunto.
    let c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave] });
    if (!c.rows.length) {
      c = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave + '::midia'] });
    }
    if (!c.rows.length) return res.status(404).json({ erro: 'Conteúdo do tópico ainda não foi gerado' });
    const pacote = JSON.parse(c.rows[0].json);

    let texto, dois, aviso = null;
    if (kind === 'podcast') {
      const r = normalizarRoteiro(String(pacote.podcast || '').slice(0, 9000));
      // duas vozes só quando há mesmo dois locutores no roteiro; com um só,
      // pedir multi-locutor faz o modelo devolver tudo numa voz de qualquer jeito
      dois = r.anas > 0 && r.leos > 0;
      if (!dois) aviso = 'roteiro_sem_dialogo';
      texto = dois
        ? 'Leia em voz alta esta conversa de podcast de estudos em português do Brasil, entre ANA e LEO, ' +
          'com naturalidade e ritmo de conversa — cada fala na voz de quem a diz:\n\n' + r.texto
        : 'Leia este roteiro de podcast de estudos em português do Brasil, com naturalidade:\n\n' + r.texto;
    } else {
      dois = false;
      const letra = String((pacote.musica || {}).letra || '').slice(0, 1800);
      const estilo = String((pacote.musica || {}).estilo || 'ritmo animado');
      texto = 'Recite esta letra mnemônica de estudos em português do Brasil, com muita energia e cadência de ' +
              estilo + ', marcando bem o refrão:\n\n' + letra;
    }

    // Roteiro grande vira 2 ou 3 chamadas e volta como um áudio só. Cada pedaço
    // leva a instrução junto: antes só o primeiro levava, e os seguintes
    // chegavam ao modelo como texto solto, sem dizer que era uma conversa.
    const cabecalho = texto.split('\n\n')[0] + '\n\n';
    const corpo = texto.slice(cabecalho.length);
    const blocos = pedacos(corpo, 2400).slice(0, 4).map(b => cabecalho + b);
    const total = blocos.length;

    // ============ UM PEDAÇO POR REQUISIÇÃO ============
    // Um roteiro de podcast vira até quatro chamadas de voz. Antes as quatro
    // aconteciam dentro da MESMA requisição: cada uma leva de 20 a 45 segundos,
    // e a função na Vercel morre aos 60. O aluno via "gravando…" por dois
    // minutos e recebia "sem conexão" — que não era a conexão dele, era a
    // função sendo desligada no meio. (O teste da gestora sempre funcionou
    // porque são duas frases curtas: uma chamada só.)
    //
    // Agora cada requisição grava UM pedaço e o guarda. O app chama de novo até
    // terminar, mostrando o progresso. Nenhuma requisição chega perto do limite.
    const chavePedaco = i => kind + ':' + i + '/' + total;
    const gravados = [];
    for (let i = 0; i < total; i++) {
      const r = await db.execute({
        sql: 'SELECT dados FROM audios WHERE topico_id = ? AND tipo = ?',
        args: [chave, chavePedaco(i)]
      });
      gravados.push(r.rows.length ? r.rows[0].dados : null);
    }

    const proximo = gravados.indexOf(null);
    if (proximo >= 0) {
      const pedacoWav = await falar(blocos[proximo], dois);
      gravados[proximo] = pedacoWav;
      try {
        await db.execute({
          sql: 'INSERT OR REPLACE INTO audios (topico_id, tipo, dados, criado_em) VALUES (?,?,?,?)',
          args: [chave, chavePedaco(proximo), pedacoWav, agora()]
        });
      } catch (_) { /* sem cache do pedaço, a próxima chamada regrava só ele */ }
    }

    const falta = gravados.indexOf(null);
    if (falta >= 0) {
      return res.status(200).json({
        parcial: true, feito: gravados.filter(Boolean).length, total,
        vozes: dois ? 2 : 1, voz_ana: VOZ_A, voz_leo: dois ? VOZ_B : null
      });
    }

    const wav = total > 1 ? juntarWav(gravados) : gravados[0];

    // cache best-effort (áudio grande pode não caber numa linha)
    try {
      await db.execute({
        sql: 'INSERT OR REPLACE INTO audios (topico_id, tipo, dados, criado_em) VALUES (?,?,?,?)',
        args: [chave, kind, wav, agora()]
      });
      await db.execute({ sql: "DELETE FROM audios WHERE topico_id = ? AND tipo LIKE ?", args: [chave, kind + ':%'] });
    } catch (_) {}

    return res.status(200).json({
      audio_base64: wav, mime: 'audio/wav',
      vozes: dois ? 2 : 1, aviso,
      voz_ana: VOZ_A, voz_leo: dois ? VOZ_B : null
    });
  } catch (e) {
    const f = falhaIA(e, 'Falha ao gerar o áudio');
    return res.status(f.status).json(f.corpo);
  }
};
