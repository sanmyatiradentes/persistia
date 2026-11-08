// Baixa do Planalto os textos das leis da tabela de api/_fontes.js e guarda em
// leis/<chave>.txt já normalizados (texto riscado, isto é, revogado, fica de fora).
// Uso: node scripts/atualizar-leis.js [pasta-com-htm-ja-baixados]
// Faz uma pausa entre as leis: o Planalto recusa quem baixa muitas de uma vez.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizar } = require('../api/_leis');
const { DIRETO } = require('../api/_fontes');

const SAIDA = path.join(__dirname, '..', 'leis');
const CACHE = process.argv[2] || null;

function decodificar(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) { return new TextDecoder('windows-1252').decode(buf); }
}
function limpar(html) {
  return html
    .replace(/<(strike|s|del)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&([a-z]+);/gi, (m, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', ordm: 'º', ordf: 'ª', sect: '§' }[n.toLowerCase()] || m));
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const resumo = [];
  for (const [chave, url] of Object.entries(DIRETO)) {
    let buf = null;
    const local = CACHE && path.join(CACHE, crypto.createHash('md5').update(url).digest('hex') + '.htm');
    if (local && fs.existsSync(local) && fs.statSync(local).size > 5000) buf = fs.readFileSync(local);
    else {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (PersisteIA, conferencia de lei seca)' } });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        else resumo.push(chave + ': HTTP ' + r.status);
      } catch (e) { resumo.push(chave + ': sem conexão'); }
      await new Promise(ok => setTimeout(ok, 8000));
    }
    if (!buf) continue;
    const texto = normalizar(limpar(decodificar(buf)));
    if (texto.length < 2000) { resumo.push(chave + ': texto curto demais'); continue; }
    fs.writeFileSync(path.join(SAIDA, chave + '.txt'), texto);
    resumo.push(chave + ': ok, ' + Math.round(texto.length / 1024) + ' KB');
  }
  fs.writeFileSync(path.join(SAIDA, 'LEIAME.txt'), 'Textos oficiais do Planalto, normalizados, para a conferência da lei seca.\nAtualizado em ' + new Date().toISOString().slice(0, 10) + ' por scripts/atualizar-leis.js.\n\n' + resumo.join('\n') + '\n');
  console.log(resumo.join('\n'));
})();
