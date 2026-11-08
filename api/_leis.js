// Conferência mecânica da lei seca: o trecho que a IA transcreveu só aparece se
// estiver, palavra por palavra, no texto oficial do Planalto guardado em /leis.
// Sem IA nenhuma no meio. Medição de 08/11/2026: das 212 transcrições com lei
// localizada, só 102 (48%) batiam exatamente — e a segunda leitura por IA tinha
// marcado como "conferido" 68 que não batiam. Por isso o selo agora é só este.
const fs = require('fs');
const path = require('path');
const { fonteOficial } = require('./_fontes');

const PASTA = path.join(__dirname, '..', 'leis');
const memoria = {};

// A mesma normalização usada para preparar os textos (scripts/atualizar-leis.js).
const NOTAS = /\((?:\s*(?:reda[cç][aã]o dada|inclu[ií]d[oa]|vide|vig[eê]ncia|revogad[oa]|regulamento|renumerad|produ[cç][aã]o de efeito|express[aã]o)[^()]*(?:\([^()]*\)[^()]*)*)\)/gi;
function normalizar(s) {
  return String(s || '').replace(/\s*\/\/\s*/g, ' ').replace(NOTAS, ' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/º|°/g, 'o').replace(/ª/g, 'a')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(\d+) ?o\b/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function textoOficial(chave) {
  if (!chave) return null;
  if (chave in memoria) return memoria[chave];
  try { memoria[chave] = ' ' + fs.readFileSync(path.join(PASTA, chave + '.txt'), 'utf8') + ' '; }
  catch (_) { memoria[chave] = null; }
  return memoria[chave];
}

// Devolve a lista com cada dispositivo marcado. O texto só fica se bater com o oficial.
function conferirNoPlanalto(lista) {
  return (Array.isArray(lista) ? lista : []).map(d => {
    if (!d) return d;
    if (d.fonte && d.fonte.tipo === 'enviado') return d;   // lei local: conferida no texto enviado
    const fonte = fonteOficial(d.rotulo) || d.fonte || null;
    const oficial = fonte && fonte.tipo === 'direto' ? textoOficial(fonte.chave) : null;
    const alvo = normalizar(d.texto);
    if (oficial && alvo.length >= 20 && oficial.includes(' ' + alvo + ' ')) {
      return Object.assign({}, d, { fonte, conferido: true, conferencia: 'planalto', alerta: null, motivo: '' });
    }
    // não bateu, ou a lei não está na base: a transcrição sai; fica a referência para ler na fonte
    return Object.assign({}, d, {
      fonte, texto: '', conferido: false, conferencia: oficial ? 'nao_bate' : 'sem_base', alerta: null, motivo: ''
    });
  });
}

module.exports = { normalizar, conferirNoPlanalto, textoOficial };
