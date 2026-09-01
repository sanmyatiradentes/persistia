// Da citação ao texto oficial.
//
// O aluno não precisa acreditar na IA: cada dispositivo citado vira um link
// para a fonte oficial — Planalto para leis e Constituição, o site do próprio
// tribunal para súmulas. Quando não conseguimos montar o endereço exato,
// mandamos para a busca oficial do LexML (Senado), nunca para lugar nenhum.
//
// Os endereços diretos são escritos à mão, um a um, justamente para não
// depender de palpite: diploma que não está na tabela cai na busca.

const PLANALTO = 'https://www.planalto.gov.br/ccivil_03/';

// Diplomas que caem em prova o tempo todo, com o endereço oficial conferido.
const DIRETO = {
  'cf': PLANALTO + 'constituicao/constituicao.htm',
  // códigos (decretos-lei)
  'dl2848': PLANALTO + 'decreto-lei/del2848compilado.htm',          // Código Penal
  'dl3689': PLANALTO + 'decreto-lei/del3689.htm',                   // CPP
  'dl5452': PLANALTO + 'decreto-lei/del5452.htm',                   // CLT
  'dl4657': PLANALTO + 'decreto-lei/del4657compilado.htm',          // LINDB
  'dl201':  PLANALTO + 'decreto-lei/del0201.htm',                   // crimes de responsabilidade
  // leis por número
  '13105': PLANALTO + '_ato2015-2018/2015/lei/l13105.htm',          // CPC/2015
  '10406': PLANALTO + 'leis/2002/l10406compilada.htm',              // Código Civil
  '14133': PLANALTO + '_ato2019-2022/2021/lei/L14133.htm',          // Licitações
  '8666':  PLANALTO + 'leis/l8666cons.htm',
  '8112':  PLANALTO + 'leis/l8112cons.htm',
  '8429':  PLANALTO + 'leis/l8429.htm',                             // improbidade
  '9784':  PLANALTO + 'leis/l9784.htm',                             // processo adm. federal
  '9455':  PLANALTO + 'leis/l9455.htm',                             // tortura
  '9605':  PLANALTO + 'leis/l9605.htm',                             // crimes ambientais
  '8069':  PLANALTO + 'leis/l8069.htm',                             // ECA
  '10741': PLANALTO + 'leis/2003/l10.741.htm',                      // Estatuto do Idoso
  '11340': PLANALTO + '_ato2004-2006/2006/lei/l11340.htm',          // Maria da Penha
  '11343': PLANALTO + '_ato2007-2010/2006/lei/l11343.htm',          // drogas
  '12527': PLANALTO + '_ato2011-2014/2011/lei/l12527.htm',          // acesso à informação
  '12850': PLANALTO + '_ato2011-2014/2013/lei/l12850.htm',          // organização criminosa
  '13709': PLANALTO + '_ato2015-2018/2018/lei/L13709.htm',          // LGPD
  '13869': PLANALTO + '_ato2019-2022/2019/lei/L13869.htm',          // abuso de autoridade
  '14230': PLANALTO + '_ato2019-2022/2021/lei/L14230.htm',          // nova improbidade
  '8080':  PLANALTO + 'leis/l8080.htm',
  '8078':  PLANALTO + 'leis/l8078compilado.htm',                    // CDC
  '4717':  PLANALTO + 'leis/l4717.htm',                             // ação popular
  '7210':  PLANALTO + 'leis/l7210.htm',                             // execução penal
  '9099':  PLANALTO + 'leis/l9099.htm',                             // juizados especiais
  '9503':  PLANALTO + 'leis/l9503compilado.htm',                    // CTB
  '5172':  PLANALTO + 'leis/l5172compilado.htm',                    // CTN
  '101':   PLANALTO + 'leis/lcp/lcp101.htm'                         // LRF (complementar)
};

// Apelidos que o aluno (e a IA) usam no lugar do número.
const APELIDOS = [
  [/constitui|cf\/?88|cf\b|crfb/i, 'cf'],
  [/c[óo]digo\s+penal|\bcp\b/i, 'dl2848'],
  [/processo\s+penal|\bcpp\b/i, 'dl3689'],
  [/consolida[çc][ãa]o\s+das\s+leis\s+do\s+trabalho|\bclt\b/i, 'dl5452'],
  [/lindb|introdu[çc][ãa]o\s+[àa]s\s+normas/i, 'dl4657'],
  [/c[óo]digo\s+civil|\bcc\/?2002\b/i, '10406'],
  [/processo\s+civil|\bcpc\b/i, '13105'],
  [/defesa\s+do\s+consumidor|\bcdc\b/i, '8078'],
  [/tribut[áa]rio\s+nacional|\bctn\b/i, '5172'],
  [/tr[âa]nsito\s+brasileiro|\bctb\b/i, '9503'],
  [/estatuto\s+da\s+crian[çc]a|\beca\b/i, '8069'],
  [/lgpd|prote[çc][ãa]o\s+de\s+dados/i, '13709'],
  [/maria\s+da\s+penha/i, '11340'],
  [/improbidade/i, '8429'],
  [/licita|contratos\s+administrativos/i, '14133'],
  [/execu[çc][ãa]o\s+penal|\blep\b/i, '7210'],
  [/responsabilidade\s+fiscal|\blrf\b/i, '101']
];

function normalizar(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

// "Lei n.º 9.784/1999" → "9784" ; "Lei 14.133, de 2021" → "14133"
function numeroDaLei(rotulo) {
  const m = normalizar(rotulo).match(/(?:lei|lc|lei\s+complementar)[^0-9]{0,12}(\d{1,3}(?:[.\s]\d{3})*|\d{3,6})/i);
  if (!m) return null;
  return m[1].replace(/[.\s]/g, '');
}

function buscaOficial(rotulo) {
  return 'https://www.lexml.gov.br/busca/search?keyword=' + encodeURIComponent(normalizar(rotulo));
}

// Súmulas: cada tribunal publica a sua lista oficial.
function linkDeSumula(rotulo) {
  const t = normalizar(rotulo).toLowerCase();
  if (!/s[úu]mula/.test(t)) return null;
  if (/vinculante/.test(t)) {
    return { url: 'https://portal.stf.jus.br/textos/verTexto.asp?servico=jurisprudenciaSumulaVinculante', tipo: 'lista', fonte: 'STF' };
  }
  if (/\bstj\b|superior\s+tribunal\s+de\s+justi/.test(t)) {
    return { url: 'https://scon.stj.jus.br/SCON/sumstj/', tipo: 'lista', fonte: 'STJ' };
  }
  if (/\btst\b/.test(t)) {
    return { url: 'https://www3.tst.jus.br/jurisprudencia/Sumulas_com_indice/Sumulas_Ind_1_50.html', tipo: 'lista', fonte: 'TST' };
  }
  if (/\bstf\b|supremo/.test(t)) {
    return { url: 'https://portal.stf.jus.br/textos/verTexto.asp?servico=jurisprudenciaSumula', tipo: 'lista', fonte: 'STF' };
  }
  return { url: buscaOficial(rotulo), tipo: 'busca', fonte: 'LexML' };
}

/**
 * Devolve para onde o aluno vai conferir a citação.
 *   tipo 'direto' → abre o texto oficial do diploma
 *   tipo 'lista'  → abre a lista oficial de súmulas do tribunal
 *   tipo 'busca'  → abre a busca oficial (não montamos o endereço exato)
 */
function fonteOficial(rotulo) {
  const t = normalizar(rotulo);
  if (!t) return null;

  const sum = linkDeSumula(t);
  if (sum) return { rotulo: t, url: sum.url, tipo: sum.tipo, fonte: sum.fonte };

  const num = numeroDaLei(t);
  if (num && DIRETO[num]) return { rotulo: t, url: DIRETO[num], tipo: 'direto', fonte: 'Planalto' };

  for (const [re, chave] of APELIDOS) {
    if (re.test(t) && DIRETO[chave]) {
      return { rotulo: t, url: DIRETO[chave], tipo: 'direto', fonte: 'Planalto' };
    }
  }

  return { rotulo: t, url: buscaOficial(t), tipo: 'busca', fonte: 'LexML' };
}

module.exports = { fonteOficial, buscaOficial };
