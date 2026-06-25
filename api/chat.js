/**
 * PersisteIA — api/chat.js
 * Prompts no backend (ocultos). Padrão InspireIA com SSE.
 * Sanmya Beatriz Tiradentes Leite & Jane De Maria Alves Sousa
 *
 * ARQUITETURA gerar_docx (2 passos — elimina timeout):
 *   Passo 1 — Gemini extrai SOMENTE a lista de tópicos do edital (~10-20s)
 *   Passo 2 — Backend Node.js calcula datas/horas/revisões (instantâneo, sem IA)
 */

const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';
const GEMINI_DOCX_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const FILES_API      = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

// ── Prompts do chat ──────────────────────────────────────────────────────────

const PROMPT_CRONOGRAMA = `Você é PersisteIA, tutora de concursos. Tom motivador.

REGRAS: Máximo 80 palavras por resposta. Nunca repita pergunta já respondida. Nunca gere cronograma no chat.

FLUXO:
"Olá! Para começar:
1. Criar cronograma
2. Estudar um assunto específico
Digite 1 ou 2."

SE 2: Peça o item do cronograma. Ative a Esteira.

SE 1: Colete em ordem, UM por vez:
1. Cargo (se não informado na sidebar)
2. Banca (CESPE, FCC, FGV, VUNESP, etc.)
3. Data da prova (DD/MM/AAAA)
4. Horas por dia — peça: "Quantas horas por dia você consegue estudar? Digite só o número (de 1 a 12)."

Com os 4 dados, responda APENAS (máximo 3 linhas):
"✅ Dados completos! Cargo: [X] | Banca: [X] | Data: [X] | [Y] dias | [X]h/dia. Clique em GERAR DOCX abaixo. 📅"

BANCAS: CESPE=quase-certas; FCC=lei; FGV=STF/STJ; VUNESP=jurisprudência`;

const PROMPT_ESTEIRA = `Você é PersisteIA, tutora de concursos públicos. Criada por Sanmya Tiradentes e Jane De Maria Alves Sousa.

EXTRAÇÃO INICIAL — FAÇA SEMPRE NA PRIMEIRA MENSAGEM:
O candidato envia o tópico no formato "Disciplina > Seção > Subseção | BANCA"
(ex: "Medicina Legal > Traumatologia Forense > Lesões Contundentes | CESPE")
Extraia a banca se informada. Se não informada, use CESPE.
Nunca peça confirmação — inicie imediatamente.

╔══════════════════════════════════════════════════╗
  REGRA DE OURO — NUNCA VIOLE SOB NENHUMA HIPÓTESE
  Você NÃO faz perguntas ao candidato.
  ZERO perguntas. Nunca. Em nenhuma etapa.
  Perguntas existem SOMENTE nas questões do Simulado (opção 7).
  Sua função é ENSINAR e ENTREGAR conteúdo.
  O candidato interage APENAS escolhendo um número (1-7).
╚══════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE SAÍDA — SIGA À RISCA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Quando receber qualquer tópico, produza EXATAMENTE nesta estrutura:

📚 [Disciplina > Seção > Subseção]

▶ TEORIA TÉCNICA COMPLETA

[Entregue o conteúdo COMPLETO, DENSO e APROFUNDADO. Não resuma, não corte, não simplifique.
Cubra TUDO que o candidato precisa saber para acertar qualquer questão sobre este tema:

✦ Definições técnicas precisas (conceito legal ou técnico exato)
✦ Fundamentos, princípios, classificações e subdivisões do tema
✦ Base legal, normas e dispositivos aplicáveis — cite artigos específicos
  ↳ Ao final, indique: "📖 Leitura obrigatória: [Nome da Lei/Norma], art. X ao Y" para que o candidato consulte a lei seca
✦ Doutrina consolidada (autores e posições relevantes para a banca)
✦ Jurisprudência aplicada (STF, STJ, tribunais ou conselhos pertinentes ao cargo)
✦ Exceções, casos especiais e hipóteses controvertidas
✦ Conexões com outros tópicos do edital que o candidato deve relacionar
✦ Aplicação prática com exemplos concretos do contexto do cargo
✦ Pontos e termos mais cobrados pela banca identificada neste tema

Sem limite de extensão — entregue tudo que o tema exige.]

💾 SALVE AGORA: copie e cole num documento.

─────────────────────────────
Aprofunde este assunto — escolha uma opção:
1. 🧠 Analogia Feynman — explicação do zero com conexão ao cotidiano
2. 🔑 Mnemônicos e regras de fixação
3. ⚠️  Gatilhos — armadilhas e pegadinhas desta banca neste assunto
4. 🎬 Cinema Mental — narrativa sensorial para fixação profunda
5. 🎤 Oratória Acadêmica — texto técnico para ensinar em voz alta
6. ✍️  Escrita Cinestésica — esquema completo para copiar à mão
7. 📝 Simulado — 10 questões + gabarito por engenharia reversa
   ↳ Pode pedir quantas vezes quiser! Cada chamada gera 10 novas questões inéditas.

Cole o próximo tópico do cronograma para avançar na esteira.
─────────────────────────────

Após QUALQUER etapa entregue, repita sempre o menu acima completo. Não pergunte nada — só exiba o menu.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEÚDO DE CADA ETAPA — PROFUNDIDADE TOTAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1 — ANALOGIA FEYNMAN
Ensine como se o candidato nunca tivesse visto o assunto.
Escolha 1 situação do cotidiano que espelhe estruturalmente o conceito técnico.
Desenvolva a analogia em profundidade (mínimo 3 parágrafos):
  — Passo 1: descreva a situação cotidiana com riqueza de detalhes
  — Passo 2: faça a ponte explícita elemento por elemento (A no cotidiano = B no conceito técnico)
  — Passo 3: retorne ao conceito técnico completo, agora com a analogia como andaime
Encerre com o menu completo.

2 — MNEMÔNICOS
Crie ao menos 2 recursos de memorização robustos:
  — 1 acrônimo ou sigla que cubra os pontos principais (explique cada letra)
  — 1 frase-âncora narrativa com as palavras-chave encadeadas
  — 1 regra rápida para fixar exceções e casos especiais
  — Opcional: esquema visual em texto (lista com marcadores, setas) que reforce a estrutura
Encerre com o menu completo.

3 — GATILHOS ANTICARMADILHA
Liste sistematicamente os recursos que esta banca usa neste assunto específico:
  — Termos que a banca usa para induzir ao erro (coloque em negrito ou aspas)
  — Para cada armadilha: "A banca escreve: [X]" vs "O correto é: [Y]"
  — Inversões lógicas e afirmativas absolutas que tornam assertivas erradas
  — Pegadinhas com exceções apresentadas como regra geral
  — Palavras-gatilho positivas e negativas (sempre, nunca, apenas, somente, exceto...)
  — Ao menos 5 armadilhas concretas e documentadas para este tema
Encerre com o menu completo.

4 — CINEMA MENTAL
Narrativa imersiva e vívida para ativar memória episódica e sensorial.
Desenvolva uma cena completa (mínimo 10-15 linhas):
  — Contexto, cenário, personagens e ação que incorporam o conteúdo técnico
  — Use detalhes sensoriais: sons, texturas, cores, movimentos, diálogos
  — Cada elemento da cena representa um elemento do conteúdo a fixar
  — Ao final da cena, faça a decodificação: "O [elemento da cena] representa [conceito técnico]"
  — Instrua: "Feche os olhos. Releia a cena devagar. Visualize por 60 segundos. Depois releia o conteúdo técnico."
Encerre com o menu completo.

5 — ORATÓRIA ACADÊMICA
Texto técnico elaborado, fluente e autorizado, pronto para leitura em voz alta.
Mínimo 2-3 parágrafos densos, como uma aula oral para uma banca examinadora:
  — Apresente o tema com precisão técnica e vocabulário do concurso
  — Desenvolva os pontos principais com encadeamento lógico e argumentativo
  — Incorpore naturalmente os termos legais, doutrinários e jurisprudenciais
  — Conclua com síntese e relevância para a prova
  — Instrua: "Leia em voz alta de pé, como se estivesse ensinando uma plateia de juízes.
    Gravar em áudio e ouvir depois multiplica a fixação."
Encerre com o menu completo.

6 — ESCRITA CINESTÉSICA
Esquema completo e estruturado para copiar à mão no caderno.
Desenvolva um mapa do conteúdo rico e funcional:
  — Título centralizado com o tema
  — Hierarquia clara: conceito-raiz → ramificações → subramificações
  — Palavras-chave em CAIXA ALTA ou entre colchetes
  — Setas de relação (→ causa/efeito, ↔ equivalência, ≠ distinção)
  — Quadros comparativos quando houver distinções importantes
  — Exceções e pegadinhas sinalizadas com ⚠️
  — Referência legal ao lado do conceito: [art. X, Lei Y]
  — Ao final: instrua "Copie à mão AGORA, sem ler — só copiar.
    Feche o caderno e tente reproduzir de memória. A memória motora fixa o que a leitura não fixa."
Encerre com o menu completo.

7 — SIMULADO
Produza 10 questões INÉDITAS no estilo exato da banca identificada.
Após as 10 questões, entregue o GABARITO COM ENGENHARIA REVERSA:
Para cada questão:
  — Enuncie a alternativa correta e explique por que está certa (com base legal/doutrinária)
  — Para CADA alternativa errada: explique exatamente como a banca construiu o distrator
    e qual foi a técnica usada (inversão, generalização, troca de termo, etc.)
Esta é a ÚNICA etapa onde existem questões para o candidato responder.
Ao final do gabarito, informe: "Quer 10 novas questões? Digite 7 novamente — cada chamada gera questões inéditas."
Encerre com o menu completo.

BANCAS: CESPE/CEBRASPE=assertivas absolutas são armadilha, certo/errado sem alternativas; FCC=letra-da-lei exata, sem interpretação; FGV=raciocínio encadeado + jurisprudência recente; VUNESP=STJ + súmulas vinculantes.`;

const WELCOME = '🎯 Olá! Para começar, você:\n1. Quer criar um cronograma de estudos agora\n2. Já tem cronograma e quer estudar um assunto específico\n\nDigite 1 ou 2.';
const WELCOME_ESTEIRA = `📚 Esteira de Aprendizado Ativo ativada.

Informe o tópico exato do seu cronograma usando o caminho completo:

✏️ **Disciplina > Seção > Subseção (se houver) | BANCA**

Exemplos:
• "Medicina Legal > Traumatologia Forense > Lesões Contundentes | CESPE"
• "Odontologia Legal > Identificação Humana > Estimativa de Idade | CESPE"
• "Língua Portuguesa > Coesão e Coerência > Mecanismos de coesão | FGV"
• "Direito Constitucional > Direitos Fundamentais > Remédios constitucionais | CESPE"

💡 Use o tópico exato do cronograma — quanto mais detalhado, mais preciso o conteúdo.

A Esteira vai gerar automaticamente para você (escolha por número):
1. 🧠 Analogia Feynman
2. 🔑 Mnemônicos
3. ⚠️  Gatilhos anticarmadilha
4. 🎬 Cinema Mental
5. 🎤 Oratória Acadêmica
6. ✍️  Escrita Cinestésica
7. 📝 Simulado (pode repetir quantas vezes quiser!)`;

// ── Prompt de extração de tópicos — cargo-específico (gerado dinamicamente) ──
// Antes era uma constante genérica que pedia TODOS os cargos, gerando listas
// enormes que excediam os tokens e faziam o Gemini responder em prosa.
// Agora o cargo é injetado no prompt para que apenas as disciplinas relevantes
// sejam extraídas, tornando a resposta menor, mais rápida e mais confiável.
function buildPromptExtrai(cargo) {
  const cargoValido = cargo && cargo !== 'Não informado' && cargo !== 'Cargo conforme edital' && cargo.length > 3;
  if (cargoValido) {
    return `Você é um analisador de editais de concurso público.
Leia o CONTEÚDO PROGRAMÁTICO (normalmente no Anexo I) deste edital e extraia APENAS os tópicos do cargo: "${cargo}".
Responda SOMENTE com JSON puro, sem markdown, sem texto antes ou depois:
{"orgao":"nome do orgao extraído do edital","topicos":["Disciplina > Secao","Disciplina > Secao > Subitem"]}
REGRAS OBRIGATORIAS:
- Extraia SOMENTE as disciplinas e tópicos do cargo "${cargo}" (ignore todos os outros cargos)
- Um item do array por tópico ou subitem do conteúdo programático
- Formato: "NomeDisciplina > NomeSecao" ou "NomeDisciplina > NomeSecao > NomeSubitem"
- Maximo 80 caracteres por string — sem quebras de linha, sem aspas nos valores
- Se um tópico tiver muitos subitens, crie um elemento do array por subitem
- NUNCA inclua texto fora do JSON`;
  }
  // Cargo não identificado: extrai o primeiro cargo encontrado no edital
  return `Você é um analisador de editais de concurso público.
Leia o CONTEÚDO PROGRAMÁTICO (normalmente no Anexo I) deste edital.
Identifique o PRIMEIRO cargo listado e extraia todos os seus tópicos.
Responda SOMENTE com JSON puro, sem markdown, sem texto antes ou depois:
{"orgao":"nome do orgao extraído do edital","topicos":["Disciplina > Secao","Disciplina > Secao > Subitem"]}
REGRAS OBRIGATORIAS:
- Extraia SOMENTE o primeiro cargo encontrado no edital
- Um item do array por tópico ou subitem do conteúdo programático
- Formato: "NomeDisciplina > NomeSecao" ou "NomeDisciplina > NomeSecao > NomeSubitem"
- Maximo 80 caracteres por string — sem quebras de linha, sem aspas nos valores
- Se um tópico tiver muitos subitens, crie um elemento do array por subitem
- NUNCA inclua texto fora do JSON`;
}

// ── Parser robusto de JSON (6 estratégias em cascata) ────────────────────────
function tryParseJsonRobust(rawText) {
  let text = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) {
    // Sem chaves — tenta extrair array de tópicos direto
    return tryExtractTopicsArray(text);
  }
  text = text.substring(s, e + 1);

  try { return JSON.parse(text); } catch(_) {}

  const v2 = text.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(v2); } catch(_) {}

  const v3 = escaparControlesEmStringsJson(text);
  try { return JSON.parse(v3); } catch(_) {}

  const v4 = escaparControlesEmStringsJson(v2);
  try { return JSON.parse(v4); } catch(_) {}

  const v5 = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ')
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(v5); } catch(_) {}

  // 6ª estratégia: extrai tópicos via regex (JSON pode estar truncado)
  return tryExtractTopicsArray(rawText);
}

// Extrai array de tópicos mesmo de JSON truncado/malformado
function tryExtractTopicsArray(rawText) {
  // Tenta extrair o orgao
  const orgaoMatch = rawText.match(/"orgao"\s*:\s*"([^"]+)"/);
  const orgao = orgaoMatch ? orgaoMatch[1] : '';

  // Extrai todos os itens do array topicos (mesmo se o JSON estiver incompleto)
  const topicosMatch = rawText.match(/"topicos"\s*:\s*\[([^\]]*?)(?:\]|$)/s);
  if (!topicosMatch) return null;

  const arrayContent = topicosMatch[1];
  // Extrai strings individuais entre aspas
  const items = [];
  const itemRegex = /"([^"\\]|\\[\s\S])*"/g;
  let m;
  while ((m = itemRegex.exec(arrayContent)) !== null) {
    try {
      const val = JSON.parse(m[0]);
      if (val && val.trim()) items.push(val);
    } catch(_) {
      // descarta item malformado
    }
  }
  if (items.length === 0) return null;
  console.log('[PersisteIA] tryExtractTopicsArray: recuperados', items.length, 'tópicos via regex');
  return { orgao, topicos: items };
}

function escaparControlesEmStringsJson(text) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { out += c; escape = false; continue; }
    if (c === '\\' && inString) { out += c; escape = true; continue; }
    if (c === '"') { out += c; inString = !inString; continue; }
    if (inString) {
      const code = c.charCodeAt(0);
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
    }
    out += c;
  }
  return out;
}

// ── Files API upload ─────────────────────────────────────────────────────────
async function uploadPdfToFilesApi(apiKey, pdfBase64) {
  const pdfBytes = Buffer.from(pdfBase64, 'base64');
  const initRes = await fetch(`${FILES_API}?uploadType=resumable&key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': pdfBytes.length,
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
    },
    body: JSON.stringify({ file: { display_name: 'edital.pdf' } }),
  });
  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files API não retornou upload URL');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': pdfBytes.length,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: pdfBytes,
  });
  const fileData = await uploadRes.json();
  return fileData?.file?.uri;
}

// ── Raio-X da Banca — armadilhas hardcoded por banca (sem IA, sem timeout) ──
const RAIO_X_BANCA = {
  CESPE: [
    '🎯 Assertivas com "somente", "apenas", "sempre" ou "nunca" — desconfie, mas não as descarte automaticamente. A CESPE às vezes as torna verdadeiras para pegar quem generalizou.',
    '🎯 Uma parte verdadeira NÃO salva a assertiva. Se qualquer trecho for falso, a assertiva inteira é ERRADA.',
    '🎯 Inversão de conceitos: a banca troca "constitucional" por "legal", "administrativo" por "judicial". Leia cada palavra com atenção antes de julgar.',
  ],
  CEBRASPE: [
    '🎯 Assertivas com "somente", "apenas", "sempre" ou "nunca" — desconfie, mas não as descarte automaticamente. A CEBRASPE às vezes as torna verdadeiras para pegar quem generalizou.',
    '🎯 Uma parte verdadeira NÃO salva a assertiva. Se qualquer trecho for falso, a assertiva inteira é ERRADA.',
    '🎯 Inversão de conceitos: a banca troca "constitucional" por "legal", "administrativo" por "judicial". Leia cada palavra com atenção antes de julgar.',
  ],
  FGV: [
    '🎯 Atenção a assertivas absolutas ("somente", "apenas", "sempre") — FGV as usa para criar falsas verdades parciais. A lógica encadeada é a armadilha principal.',
    '🎯 Nas 5 alternativas, não marque a primeira que parece certa. FGV coloca a "quase certa" em B ou C para induzir pressa.',
    '🎯 Jurisprudência recente STF/STJ: FGV cobra acórdãos e informativos dos últimos 2 anos. Revise os mais recentes antes da prova.',
  ],
  FCC: [
    '🎯 Letra da lei é soberana — qualquer paráfrase imprecisa é considerada errada. Copie mentalmente o texto legal ao ler cada alternativa.',
    '🎯 Alternativas com a mesma ideia em palavras diferentes: uma é letra da lei, outra é interpretação. Só a literal está correta.',
    '🎯 A redação importa: FCC cobra "conforme redação dada pela Lei X". Saiba qual lei alterou o dispositivo e quando.',
  ],
  VUNESP: [
    '🎯 STJ além do STF: VUNESP cobra jurisprudência do Superior Tribunal de Justiça com frequência acima da média das bancas.',
    '🎯 Súmulas vinculantes vs persuasivas — saiba distinguir e o que cada uma obriga ou orienta.',
    '🎯 Questões com "exceto" ou "não é correto afirmar" — o estresse da prova faz inverter a lógica. Sublinhe mentalmente o "não" antes de analisar.',
  ],
  AOCP: [
    '🎯 Legislação local e estatutos específicos do cargo — AOCP cobra a lei da instituição com profundidade. Leia o edital inteiro para mapear as normas exigidas.',
    '🎯 Alternativas muito detalhadas com dados numéricos costumam ter um número inventado. Desconfie de especificidades não previstas na lei.',
    '🎯 Revise a lei específica do cargo (estatuto, regimento, regulamento) — são as mais cobradas nas questões de conhecimentos específicos.',
  ],
  IBFC: [
    '🎯 Legislação local e estatutos específicos do cargo — IBFC cobra a lei da instituição com profundidade. Leia o edital inteiro para mapear as normas exigidas.',
    '🎯 Alternativas muito detalhadas com dados numéricos costumam ter um número inventado. Desconfie de especificidades não previstas na lei.',
    '🎯 Revise a lei específica do cargo (estatuto, regimento, regulamento) — são as mais cobradas nas questões de conhecimentos específicos.',
  ],
  IADES: [
    '🎯 Legislação local com foco em saúde e assistência social — IADES cobra normas do SUS, SUAS e estatutos específicos do setor público.',
    '🎯 Alternativas que misturam conceitos de áreas diferentes (jurídico + técnico) são as mais perigosas.',
    '🎯 Revise portarias e resoluções recentes — IADES gosta de cobrar normas de publicação recente.',
  ],
  DEFAULT: [
    '🎯 Leia a assertiva inteira antes de marcar — a última palavra pode inverter completamente o sentido.',
    '🎯 Negativa dupla ("não é incorreto que...") — resolva passo a passo, destrinchando cada negação.',
    '🎯 As exceções às regras gerais são as mais cobradas. Para cada conceito, aprenda também o que foge à regra.',
  ],
};

function getRaioX(banca) {
  const key = (banca || '').toUpperCase().trim();
  return RAIO_X_BANCA[key] || RAIO_X_BANCA.DEFAULT;
}

// ── Passo 2: cálculo de cronograma no backend (sem IA, sem timeout) ──────────
function calcularCronograma({ topicos, cargo, orgao, banca, dataProva, diasDisponiveis, horasPorDia }) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hpd = parseFloat(horasPorDia);

  // Matérias de alta prioridade por banca
  const altasPorBanca = {
    CESPE:    ['constitucional','administrativo','português','língua portuguesa'],
    CEBRASPE: ['constitucional','administrativo','português','língua portuguesa'],
    FCC:      ['português','língua portuguesa','administrativo','constitucional'],
    FGV:      ['constitucional','raciocínio lógico','administrativo','informática'],
    VUNESP:   ['constitucional','português','língua portuguesa','jurisprudência'],
    AOCP:     ['constitucional','administrativo','português'],
    IBFC:     ['constitucional','administrativo','português'],
    IADES:    ['constitucional','administrativo','português'],
  };
  const altas = (altasPorBanca[banca.toUpperCase()] || []);
  const getPrio = (t) => altas.some(p => t.toLowerCase().includes(p)) ? 'ALTA' : 'NORMAL';

  // Formata data somando N dias a partir de hoje — retorna '' se ultrapassar a data da prova
  const dataOffset = (n) => {
    if (n < 1 || n > diasDisponiveis) return ''; // nunca além da prova
    const d = new Date(hoje);
    d.setDate(d.getDate() + n);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  const HORAS_POR_TOPICO = 2; // 2h por tópico — padrão concurso
  const itens = [];
  let diaAtual = 1;
  let horasDia = 0;

  for (const topico of topicos) {
    if (diaAtual > diasDisponiveis) break;
    if (horasDia + HORAS_POR_TOPICO > hpd) { diaAtual++; horasDia = 0; }
    if (diaAtual > diasDisponiveis) break;

    const pts = topico.replace(/"/g, '').split('>').map(s => s.trim());
    itens.push({
      dia:        diaAtual,
      data:       dataOffset(diaAtual),
      disciplina: pts[0] || topico,
      secao:      pts[1] || '',
      subsecao:   pts[2] || '',
      horas:      HORAS_POR_TOPICO,
      prioridade: getPrio(topico),
      rev24h:     dataOffset(diaAtual + 1),
      rev7d:      dataOffset(diaAtual + 7),
      rev30d:     dataOffset(diaAtual + 30),
    });
    horasDia += HORAS_POR_TOPICO;
  }

  const pct = topicos.length > 0
    ? Math.min(100, Math.round((itens.length / topicos.length) * 100)) : 100;

  return {
    tipo: 'cronograma',
    certame: {
      cargo,
      orgao: (orgao || 'Conforme edital').slice(0, 80),
      banca,
      dataProva,
      diasDisponiveis,
      horasPorDia: hpd,
      totalHorasDisponiveis: diasDisponiveis * hpd,
    },
    analise: {
      coberturaPercent: pct,
      incluiRev24h: true,
      incluiRev7d:  true,
      incluiRev30d: pct === 100,
      mensagemCorte: pct < 100
        ? `${topicos.length - itens.length} tópico(s) não cabem nos ${diasDisponiveis} dias. Priorize os marcados como ALTA.`
        : '',
    },
    raioX: getRaioX(banca),
    itens,
  };
}

// ── Handler principal ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Body inválido' });
    }
  }

  // ── AÇÃO: gerar cronograma completo ────────────────────────────────────────
  if (body.action === 'gerar_docx') {
    const { pdfBase64, pdfText, cargo, banca, dataProva, horasPorDia } = body;

    if (!cargo || !banca || !dataProva || !horasPorDia) {
      return res.status(400).json({ error: 'Dados incompletos: cargo, banca, dataProva e horasPorDia são obrigatórios.' });
    }
    if (!pdfText && !pdfBase64) {
      return res.status(400).json({ error: 'Conteúdo do edital não encontrado. Anexe o PDF ou cole o conteúdo programático.' });
    }

    try {
      // Dias disponíveis
      const hoje = new Date();
      const [dd, mm, yyyy] = dataProva.split('/');
      const prova = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      const diasDisponiveis = Math.max(1, Math.floor((prova - hoje) / 86400000) - 1);

      // ── PASSO 1: Gemini extrai SOMENTE os tópicos (~10-20s) ──────────────
      // Não pedimos datas, horas nem distribuição — só nomes. Isso é 5-10x mais rápido.
      let userParts;
      if (pdfText && pdfText.length > 100) {
        // Via: texto extraído pelo PDF.js (preferido — payload pequeno)
        // Prompt cargo-específico inline (usa variável `cargo` do escopo)
        const promptEspecifico = buildPromptExtrai(cargo);
        userParts = [{ text: `EDITAL (texto extraído):\n\n${pdfText.slice(0, 80000)}\n\n---\n${promptEspecifico}` }];
      } else {
        // Fallback: PDF binário via Files API ou inline
        let fileUri = null;
        try { fileUri = await uploadPdfToFilesApi(apiKey, pdfBase64); } catch(e) {
          console.error('[PersisteIA] Files API falhou:', e.message);
        }
        const pdfPart = fileUri
          ? { file_data: { mime_type: 'application/pdf', file_uri: fileUri } }
          : { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } };
        userParts = [pdfPart, { text: buildPromptExtrai(cargo) }];
      }

      const geminiRes = await fetch(`${GEMINI_DOCX_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: { temperature: 0.0, maxOutputTokens: 16384, topP: 0.95 },
        }),
      });

      if (!geminiRes.ok) {
        const errTxt = await geminiRes.text();
        console.error('[PersisteIA] Gemini HTTP error:', errTxt.slice(0, 300));
        return res.status(200).json({ error: 'Erro na API Gemini (HTTP ' + geminiRes.status + '): ' + errTxt.slice(0, 200) });
      }

      const geminiData = await geminiRes.json();
      const finishReason = geminiData?.candidates?.[0]?.finishReason || 'UNKNOWN';
      const rawText     = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Log diagnóstico — visível nos Logs da Vercel
      console.log('[PersisteIA] finishReason:', finishReason, '| rawText length:', rawText.length);
      console.log('[PersisteIA] rawText preview:', rawText.slice(0, 400));

      const parsed = tryParseJsonRobust(rawText);
      if (!parsed) {
        return res.status(200).json({
          error: `A IA não retornou JSON válido (finishReason=${finishReason}). ` +
                 `Resposta recebida: "${rawText.slice(0, 300)}..." — Tente novamente.`,
        });
      }
      if (!Array.isArray(parsed.topicos) || parsed.topicos.length === 0) {
        return res.status(200).json({
          error: `A IA retornou JSON mas sem tópicos (campos: ${Object.keys(parsed).join(', ')}). ` +
                 `Verifique se o cargo "${cargo}" está correto no edital, ou cole o conteúdo programático diretamente no chat.`,
        });
      }

      // ── PASSO 2: Backend calcula todo o cronograma (instantâneo, sem IA) ──
      const cronograma = calcularCronograma({
        topicos:         parsed.topicos,
        cargo,
        orgao:           parsed.orgao || '',
        banca,
        dataProva,
        diasDisponiveis,
        horasPorDia,
      });

      return res.status(200).json({ cronograma });

    } catch(err) {
      console.error('[PersisteIA] gerar_docx error:', err);
      return res.status(200).json({ error: 'Erro ao gerar cronograma: ' + err.message });
    }
  }

  // ── FLUXO NORMAL DE CHAT (SSE) ───────────────────────────────────────────
  const userContents = Array.isArray(body.contents) ? body.contents : [];
  const mode = body.mode || 'cronograma';
  const sysPrompt = mode === 'esteira' ? PROMPT_ESTEIRA : PROMPT_CRONOGRAMA;

  const MAX_HIST = 10;
  const trimmed = userContents.length > MAX_HIST ? userContents.slice(-MAX_HIST) : userContents;
  let pdfSeen = false;
  const safeContents = trimmed.map(msg => {
    if (!msg || !msg.parts) return msg;
    const hasPdf = msg.parts.some(p => p && p.inline_data);
    if (hasPdf && !pdfSeen) { pdfSeen = true; return msg; }
    if (hasPdf) {
      return { role: msg.role, parts: msg.parts.map(p => p.inline_data ? { text: '[PDF analisado]' } : p) };
    }
    return { role: msg.role || 'user', parts: msg.parts };
  });

  const contents = [
    { role: 'user',  parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: mode === 'esteira' ? WELCOME_ESTEIRA : WELCOME }] },
    { role: 'user',  parts: [{ text: (() => { const n=new Date(); const d=String(n.getDate()).padStart(2,'0'); const m=String(n.getMonth()+1).padStart(2,'0'); return '[DATA DE HOJE: '+d+'/'+m+'/'+n.getFullYear()+'. Use esta data para calcular dias até a prova.]'; })() }] },
    { role: 'model', parts: [{ text: 'Entendido.' }] },
    ...safeContents,
  ];

  try {
    const geminiRes = await fetch(`${GEMINI_URL}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: mode === 'esteira' ? 8192 : 2048,
          topP: 0.95,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let msg = '⚠️ Erro na API.';
      if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED'))
        msg = '⚠️ Limite diário atingido (20 req/dia no plano gratuito). Aguarde o reset ou ative plano pago em aistudio.google.com.';
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: msg }] } }] });
    }

    const reader  = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const t = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (t) fullText += t;
        } catch(e) {}
      }
    }

    return res.status(200).json({
      candidates: [{ content: { parts: [{ text: fullText || '⚠️ Sem resposta. Tente novamente.' }], role: 'model' }, finishReason: 'STOP' }],
    });

  } catch (err) {
    return res.status(200).json({ candidates: [{ content: { parts: [{ text: '⚠️ Erro: ' + err.message }] } }] });
  }
};

// Aumenta o limite de body e timeout máximo do handler para editais grandes.
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};
