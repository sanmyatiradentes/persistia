// Pacote didático dos 8 verbos para uma SESSÃO de estudo.
// O tamanho do pacote acompanha o tamanho real do assunto: um tópico de 30 min
// recebe menos teoria e menos questões que um de 2 h, e um tópico grande é
// dividido em partes (parte 2 de 3), cada uma com seu próprio pacote.
// GET ?topico_id=...&parte=2  → {subtitulo, resumo, acronimo, trecho_chave, questoes, ...}
const { getDb, ensureSchema, agora, alunoDoToken, cors, acessoDoAluno, chamarGemini } = require('./_lib');

function tamanhos(h) {
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));
  return {
    paragrafos: clamp(3 + h * 3, 4, 10),
    questoes: clamp(4 + h * 4, 6, 14),
    me: clamp(3 + h * 2, 4, 8),
    flashcards: clamp(5 + h * 4, 6, 14),
    feynman: h >= 1.5 ? 4 : 3,
    ramos: clamp(4 + h * 1.5, 5, 8),
    itens: clamp(3 + h, 4, 6),
    chaves: clamp(5 + h * 2, 6, 12),
    dispositivos: clamp(1 + h, 2, 5),
    destaques: clamp(10 + h * 4, 12, 22),
    palavras: clamp(380 + h * 260, 450, 1100)
  };
}

function sistema(banca, t, recorte) {
  const estilo = banca
    ? `A banca do concurso é ${banca}. Escreva os itens de Certo/Errado no estilo dessa banca e as questões de múltipla escolha também no padrão dela.`
    : 'A banca ainda não é conhecida. Gere os dois formatos em estilo neutro e clássico de concurso, sem imitar uma banca específica.';

  return `Você produz material de estudo para concursos públicos brasileiros, em português do Brasil.

${recorte}

Regras:
- Baseie-se no conhecimento consolidado da matéria; quando afirmar regra jurídica, cite o dispositivo (artigo/lei, súmula). Se não tiver certeza da fonte exata, não a invente — omita a citação.
- "subtitulo": em até 8 palavras, o recorte exato que este pacote cobre (ex.: "Conceito, fontes e princípios" ou "Modalidades de licitação"). Se o pacote cobre o tópico inteiro, resuma o tópico.
- "resumo": ${t.paragrafos} parágrafos densos — conceito, fundamentos, classificações, exceções, pegadinhas de prova e exemplos concretos. Escreva como um professor experiente escreveria a teoria: sem encher linguiça e sem deixar buraco. Separe os parágrafos com uma linha em branco. Se o assunto for curto, prefira parágrafos mais enxutos a inventar conteúdo que não existe.
- "acronimo": um mnemônico ÚTIL. "sigla" é a palavra-chave (ex.: "LIMPE"). "itens" tem UM item por letra, na ordem, no formato "L — Legalidade: só se pode fazer o que a lei autoriza" — a letra, o que ela significa e uma explicação de até 12 palavras. Quem lê os itens tem de entender o mnemônico inteiro sem precisar de mais nada. Se não couber mnemônico, crie um macete curto na sigla e explique cada parte nos itens no mesmo formato.
- "explicacao_simples": explique este assunto COMO SE O ALUNO TIVESSE 12 ANOS — e faça isso a fundo, não por cima. Escreva de 4 a 6 parágrafos, em linguagem do dia a dia, cada parágrafo separado por linha em branco. Regras: (a) comece dizendo, em uma frase, para que serve isso no mundo real; (b) sempre que aparecer um termo técnico ou uma palavra difícil do assunto — inclusive os termos em latim e o "juridiquês" —, PARE e explique o que ela significa em palavras simples, entre travessões, antes de seguir; (c) use pelo menos duas analogias concretas do cotidiano (escola, casa, jogo, fila, futebol) para os conceitos centrais; (d) mostre um exemplo real, com nomes e situação, de como isso aparece na prática; (e) termine com o "resumo da ópera" em duas ou três frases. NÃO repita o texto do "resumo" com outras palavras: aqui o compromisso é fazer entender, não cobrir o edital.
- "trecho_chave": o trecho essencial para memorizar — lei seca, definição canônica, súmula, fórmula ou regra central — com 40 a 90 palavras, completo o bastante para o aluno digitar de memória e sair sabendo. Marque ${t.chaves} palavras-chave entre colchetes duplos, ex.: "obedecerá aos princípios de [[legalidade]], [[impessoalidade]]...". Se o assunto tiver mais de um dispositivo central, junte-os no mesmo trecho separando por " // ".
- "questoes": ${t.questoes} itens inéditos no formato Certo/Errado, atacando armadilhas clássicas e cobrindo pontos diferentes; "gabarito" true = Certo; "comentario" explica em até 45 palavras.
- "questoes_me": ${t.me} questões inéditas de MÚLTIPLA ESCOLHA, cada uma com "enunciado", 5 "alternativas" (texto puro, sem letras A) B) etc.), "correta" (índice de 0 a 4) e "comentario" de até 45 palavras.
- "flashcards": ${t.flashcards} pares frente/verso curtos, cobrindo o recorte inteiro.
- "feynman": ${t.feynman} perguntas para o aluno explicar em voz alta, cada uma com 3 pontos-chave esperados.
- "mapa": "centro" (2 a 4 palavras) e ${t.ramos} "ramos" que cubram o assunto inteiro, cada um com "titulo" (até 3 palavras) e ${t.itens} "itens" curtos (até 6 palavras cada). Os itens devem trazer conteúdo de prova — classificação, exceção, prazo — e não rótulos genéricos.
- "podcast": roteiro de cerca de ${t.palavras} palavras em diálogo entre ANA e LÉO — uma aula de verdade, não uma chamada: abertura de 2 frases, desenvolvimento do assunto com exemplos, três pausas de recuperação ("pensa aí…"), os erros que a banca explora e um resumo relâmpago no fim. Use apenas "ANA:" e "LEO:" como marcadores de fala.
- "musica": estilo sugerido + letra mnemônica com refrão e 3 estrofes, cobrindo os pontos principais do assunto (o refrão repete depois de cada estrofe).
- "dispositivos": a LEI SECA do assunto. Quando o tópico tiver base normativa, transcreva LITERALMENTE, palavra por palavra, até ${t.dispositivos} dispositivos centrais (artigo de lei ou da Constituição, inciso, parágrafo, súmula ou enunciado). Cada item tem "rotulo" com a citação exata e abreviada (ex.: "Art. 37, caput, CF/88", "Art. 5.º, LXIII, CF/88", "Art. 2.º da Lei n.º 9.784/1999", "Súmula Vinculante 13") e "texto" com a transcrição fiel e integral do dispositivo, sem cortes, sem resumo e sem adaptação. Regra inegociável: só transcreva o que você tem CERTEZA de reproduzir literalmente. Se houver qualquer dúvida sobre a redação exata, não inclua aquele dispositivo — é melhor devolver a lista vazia do que apresentar paráfrase como se fosse texto de lei. Se o assunto não for jurídico (português, informática, raciocínio lógico, história), devolva lista vazia.
- "palavras_chave": ${t.destaques} termos que APARECEM literalmente no texto do "resumo" e merecem destaque colorido, cada um com "termo" (1 a 3 palavras, exatamente como escrito no resumo) e "tipo", escolhido entre exatamente estes seis rótulos: "conceito" (definição ou instituto central), "principio" (princípio, regra ou fundamento), "prazo" (prazo, número, quórum, percentual, valor, idade), "excecao" (exceção, ressalva, hipótese de não aplicação), "orgao" (órgão, autoridade ou competência) e "pegadinha" (o ponto exato em que a banca costuma trocar uma palavra pela outra). Distribua entre os tipos; não classifique tudo como "conceito".
- "numeros": até 4 dados que a prova cobra de cor — prazo, quórum, percentual, idade, valor — cada um com "valor" curto (ex.: "5 anos", "2/3", "48 h") e "rotulo" de até 6 palavras. Se o assunto não tiver números decorativos, devolva lista vazia; não invente.
- "pegadinhas": 3 erros que as bancas mais exploram neste assunto, cada um em até 18 palavras, escrito como alerta ("Confundir X com Y: ...").
${estilo}`;
}

const S_TEORIA = {
  type: 'object',
  properties: {
    subtitulo: { type: 'string' },
    resumo: { type: 'string' },
    acronimo: { type: 'object', properties: { sigla: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } }, required: ['sigla', 'itens'] },
    explicacao_simples: { type: 'string' },
    trecho_chave: { type: 'string' },
    mapa: {
      type: 'object',
      properties: {
        centro: { type: 'string' },
        ramos: {
          type: 'array',
          items: {
            type: 'object',
            properties: { titulo: { type: 'string' }, itens: { type: 'array', items: { type: 'string' } } },
            required: ['titulo', 'itens']
          }
        }
      },
      required: ['centro', 'ramos']
    },
    dispositivos: {
      type: 'array',
      items: { type: 'object', properties: { rotulo: { type: 'string' }, texto: { type: 'string' } }, required: ['rotulo', 'texto'] }
    },
    palavras_chave: {
      type: 'array',
      items: { type: 'object', properties: { termo: { type: 'string' }, tipo: { type: 'string' } }, required: ['termo', 'tipo'] }
    },
    numeros: {
      type: 'array',
      items: { type: 'object', properties: { valor: { type: 'string' }, rotulo: { type: 'string' } }, required: ['valor', 'rotulo'] }
    },
    pegadinhas: { type: 'array', items: { type: 'string' } },
    podcast: { type: 'string' },
    musica: { type: 'object', properties: { estilo: { type: 'string' }, letra: { type: 'string' } }, required: ['estilo', 'letra'] }
  },
  required: ['subtitulo', 'resumo', 'explicacao_simples', 'acronimo', 'trecho_chave', 'dispositivos', 'palavras_chave', 'mapa', 'numeros', 'pegadinhas', 'podcast', 'musica']
};

const S_PRATICA = {
  type: 'object',
  properties: {
    questoes: { type: 'array', items: { type: 'object', properties: { enunciado: { type: 'string' }, gabarito: { type: 'boolean' }, comentario: { type: 'string' } }, required: ['enunciado', 'gabarito', 'comentario'] } },
    questoes_me: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          enunciado: { type: 'string' },
          alternativas: { type: 'array', items: { type: 'string' } },
          correta: { type: 'integer' },
          comentario: { type: 'string' }
        },
        required: ['enunciado', 'alternativas', 'correta', 'comentario']
      }
    },
    flashcards: { type: 'array', items: { type: 'object', properties: { frente: { type: 'string' }, verso: { type: 'string' } }, required: ['frente', 'verso'] } },
    feynman: { type: 'array', items: { type: 'object', properties: { pergunta: { type: 'string' }, pontos: { type: 'array', items: { type: 'string' } } }, required: ['pergunta', 'pontos'] } }
  },
  required: ['questoes', 'questoes_me', 'flashcards', 'feynman']
};

// Texto que morre no meio da frase é resposta cortada, não conteúdo pronto.
function terminaInteiro(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /[.!?…)\]"'\u201d\u00bb]$/.test(s);
}
function pacoteCompleto(p, minParagrafos) {
  if (!p || !p.resumo) return false;
  const resumo = String(p.resumo).trim();
  if (resumo.length < 200 || !terminaInteiro(resumo)) return false;
  const paras = resumo.split(/\n+/).filter(x => x.trim());
  if (paras.length < Math.min(3, minParagrafos || 3)) return false;
  // o roteiro do podcast é longo: se ele terminar no meio, a resposta foi cortada
  const pod = String(p.podcast || '').trim();
  if (pod.length > 200 && !terminaInteiro(pod)) return false;
  return true;
}

// Uma resposta gigante é o que trunca e devolve JSON pela metade. Duas respostas
// menores, em paralelo, cabem folgadas — e se ainda assim vier quebrada, tenta de
// novo pedindo menos.
async function gerar(sistemaTxt, pedido, schema, tentativas) {
  let ultimo = null;
  for (let n = 0; n < (tentativas || 2); n++) {
    const extra = n === 0 ? '' : '\n\nIMPORTANTE: a resposta anterior veio incompleta. Seja mais econômico nos textos e devolva o JSON inteiro, fechado.';
    try {
      const bruto = await chamarGemini(sistemaTxt + extra, pedido, schema);
      return JSON.parse(bruto);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo || new Error('Falha ao gerar');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET' });
  await ensureSchema();
  const aluno = await alunoDoToken(req);
  if (!aluno) return res.status(401).json({ erro: 'Entre na sua conta' });

  const acesso = await acessoDoAluno(aluno);
  if (!acesso.liberado) return res.status(402).json({ erro: 'Seu período de teste terminou', assinatura: acesso });

  const url = new URL(req.url, 'http://x');
  const topicoId = url.searchParams.get('topico_id');
  if (!topicoId) return res.status(400).json({ erro: 'topico_id é obrigatório' });

  const db = getDb();
  try {
    const t = await db.execute({
      sql: `SELECT t.nome AS topico, t.peso AS peso, d.nome AS disciplina, e.banca AS banca FROM topicos t
            JOIN disciplinas d ON d.id = t.disciplina_id
            JOIN editais e ON e.id = d.edital_id WHERE t.id = ?`,
      args: [topicoId]
    });
    if (!t.rows.length) return res.status(404).json({ erro: 'Tópico não encontrado' });

    // Quantas partes tem este tópico e qual delas o aluno está estudando?
    // A verdade está no cronograma dele; sem cronograma, cai no peso do tópico.
    const cr = await db.execute({
      sql: `SELECT parte, partes, horas FROM cronograma
            WHERE aluno_id = ? AND topico_id = ? ORDER BY parte`,
      args: [aluno.id, topicoId]
    });
    const pedida = Number(url.searchParams.get('parte')) || 0;
    const linha = cr.rows.find(r => Number(r.parte) === pedida) || cr.rows[0] || null;
    const partes = Number(linha && linha.partes) || 1;
    const parte = Number(linha && linha.parte) || 1;
    const peso = Math.min(12, Math.max(0.5, Number(t.rows[0].peso) || 1.5));
    const horas = Number(linha && linha.horas) || Math.min(2, peso);

    const chave = partes > 1 ? topicoId + ':' + parte + '/' + partes : topicoId;
    // ?refazer=1 joga fora o conteúdo guardado e gera outro do zero
    if (url.searchParams.get('refazer')) {
      await db.execute({ sql: 'DELETE FROM conteudos WHERE topico_id = ?', args: [chave] });
    } else {
      const cache = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [chave] });
      if (cache.rows.length) {
        const guardado = JSON.parse(cache.rows[0].json);
        // conteúdo antigo que ficou truncado no cache: refaz em vez de repetir o defeito
        if (pacoteCompleto(guardado, 3)) return res.status(200).json(guardado);
        await db.execute({ sql: 'DELETE FROM conteudos WHERE topico_id = ?', args: [chave] });
      }
    }

    const recorte = partes > 1
      ? `Este tópico é amplo e foi dividido em ${partes} sessões de estudo. Divida o assunto em ${partes} blocos, na ordem didática natural (do fundamento ao detalhe), e desenvolva SOMENTE o bloco ${parte}. Não repita o que pertence aos outros blocos; escreva como quem continua uma aula.`
      : 'Este tópico cabe em uma única sessão de estudo. Cubra-o por inteiro, sem inflar: se o assunto é curto, o pacote é curto e completo.';

    const alvo = tamanhos(horas);
    const sis = sistema(t.rows[0].banca || null, alvo, recorte);
    const cabecalho = `Disciplina: ${t.rows[0].disciplina}\nTópico: ${t.rows[0].topico}\n` +
      (partes > 1 ? `Sessão: parte ${parte} de ${partes}\n` : '') +
      `Duração prevista da sessão: ${horas} h\n\n`;

    // A teoria é o texto grande e o que mais corta: se vier pela metade, refaz
    // antes de mostrar — e, se ainda assim vier truncada, não vai para o cache.
    let teoria = null, pratica = null;
    [teoria, pratica] = await Promise.all([
      gerar(sis, cabecalho + 'Gere APENAS estes campos: subtitulo, resumo, explicacao_simples, acronimo, trecho_chave, dispositivos, palavras_chave, mapa, numeros, pegadinhas, podcast e musica.', S_TEORIA),
      gerar(sis, cabecalho + 'Gere APENAS estes campos: questoes, questoes_me, flashcards e feynman.', S_PRATICA)
    ]);
    if (!pacoteCompleto(teoria, alvo.paragrafos)) {
      try {
        teoria = await gerar(
          sis,
          cabecalho + 'Gere APENAS estes campos: subtitulo, resumo, explicacao_simples, acronimo, trecho_chave, dispositivos, palavras_chave, mapa, numeros, pegadinhas, podcast e musica.\n\n' +
          'ATENÇÃO: a tentativa anterior foi cortada no meio. Escreva parágrafos mais curtos e um roteiro de podcast mais enxuto, mas TERMINE todas as frases e feche o JSON.',
          S_TEORIA, 2
        );
      } catch (_) {}
    }
    const pacote = Object.assign({}, teoria, pratica);
    pacote.topico = t.rows[0].topico;
    pacote.disciplina = t.rows[0].disciplina;
    pacote.banca = t.rows[0].banca || null;
    pacote.parte = parte;
    pacote.partes = partes;
    pacote.horas = horas;
    pacote.lei_seca = pacote.trecho_chave; // compatibilidade com pacotes antigos

    const inteiro = pacoteCompleto(pacote, alvo.paragrafos);
    pacote.incompleto = !inteiro;
    if (inteiro) {
      await db.execute({
        sql: 'INSERT OR REPLACE INTO conteudos (topico_id, json, criado_em) VALUES (?,?,?)',
        args: [chave, JSON.stringify(pacote), agora()]
      });
    }
    return res.status(200).json(pacote);
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao gerar o conteúdo', detalhe: String(e).slice(0, 200) });
  }
};
