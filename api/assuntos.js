// Páginas públicas de assunto — a vitrine do catálogo no Google.
//
// Cada assunto que algum aluno já estudou vira uma página aberta, sem login:
// a explicação simples inteira, o começo da aula, o macete, a lei seca que
// passou na conferência, o mapa mental, as pegadinhas e algumas questões com
// gabarito. O resto do pacote (aula completa, podcast, música, flashcards,
// cronograma) fica dentro do app — a página termina convidando para ele.
//
// Rotas (vercel.json):
//   /assuntos            → índice por disciplina
//   /assuntos/<slug>     → página do assunto
//   /sitemap.xml         → mapa do site com todas as páginas
//   POST {slug, ocultar} → (só gestora) tira ou devolve uma página do ar
//
// Nada do aluno aparece aqui: nem nome, nem edital, nem cargo. Só o conteúdo
// do assunto, que é o mesmo para qualquer pessoa que o estude.
const { getDb, ensureSchema, agora, alunoDoToken, cors, ehAdmin } = require('./_lib');
const { fonteOficial } = require('./_fontes');

const SITE = (process.env.SITE_URL || 'https://www.persisteia.com.br').replace(/\/$/, '');
const GA4 = 'G-ZYB21YK520';
// abaixo disso a aula é curta demais para valer uma página própria
const MIN_RESUMO = 2500;

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugDe(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[\d.\s\-–—)]+/, '')          // "1.2 - Atos" → "atos"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90).replace(/-+$/, '');
}

// "LÍNGUA PORTUGUESA" → "Língua Portuguesa"
function titulo(t) {
  const s = String(t || '').trim();
  if (s !== s.toUpperCase()) return s;
  const menores = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no']);
  return s.toLowerCase().split(/\s+/).map((p, i) =>
    i > 0 && menores.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// Índice leve do catálogo: só os metadados, sem carregar os pacotes inteiros.
// Quando o mesmo assunto existe em vários editais, fica a versão mais completa.
async function catalogo() {
  const db = getDb();
  const r = await db.execute(`
    SELECT c.topico_id, c.criado_em,
           COALESCE(json_extract(c.json, '$.topico'), t.nome) AS topico,
           COALESCE(json_extract(c.json, '$.disciplina'), d.nome) AS disciplina,
           COALESCE(json_extract(c.json, '$.partes'), 1) AS partes,
           COALESCE(json_extract(c.json, '$.parte'), 1) AS parte,
           json_extract(c.json, '$.incompleto') AS incompleto,
           length(json_extract(c.json, '$.resumo')) AS tam
      FROM conteudos c
      LEFT JOIN topicos t ON t.id = CASE WHEN instr(c.topico_id, ':') > 0
                                         THEN substr(c.topico_id, 1, instr(c.topico_id, ':') - 1)
                                         ELSE c.topico_id END
      LEFT JOIN disciplinas d ON d.id = t.disciplina_id
     WHERE c.topico_id NOT LIKE '%::%'`);
  const ocultas = new Set((await db.execute('SELECT slug FROM paginas_ocultas')).rows.map(x => x.slug));

  const porSlug = new Map();
  for (const x of r.rows) {
    if (!x.topico || Number(x.incompleto) === 1 || (Number(x.tam) || 0) < MIN_RESUMO) continue;
    // de um assunto dividido em partes, a página mostra a primeira
    if (Number(x.partes) > 1 && Number(x.parte) !== 1) continue;
    const slug = slugDe(x.topico);
    if (!slug || slug.length < 4) continue;
    const item = {
      slug, chave: x.topico_id, topico: String(x.topico).trim().replace(/[.;:,\s]+$/, ''), disciplina: titulo(x.disciplina || 'Outros'),
      partes: Number(x.partes) || 1, tam: Number(x.tam) || 0, criado_em: x.criado_em, oculta: ocultas.has(slug)
    };
    const atual = porSlug.get(slug);
    // prefere o assunto inteiro (sem partes); entre iguais, a aula mais longa
    const melhor = !atual ||
      (item.partes === 1 && atual.partes > 1) ||
      (item.partes === atual.partes && item.tam > atual.tam);
    if (melhor) porSlug.set(slug, item);
  }
  return [...porSlug.values()];
}

/* ---------------- HTML ---------------- */

function casca({ titulo: tit, descricao, caminho, corpo, jsonld }) {
  const url = SITE + caminho;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tit)}</title>
<meta name="description" content="${esc(descricao)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="PersisteIA">
<meta property="og:title" content="${esc(tit)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/og-persisteia.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="192x192" href="/icone-192.png">
<link rel="apple-touch-icon" href="/icone-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Albert+Sans:wght@400;600;700&display=swap">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA4}');</script>
<style>
:root{--bg:#EFF5F0;--card:#FFFFFF;--card2:#F7FAF7;--ink:#16241D;--muted:#5C6E64;--line:#DCE7DF;
  --accent:#0E8F6E;--accent-soft:#E2F2EB;--on-accent:#FFFFFF;--warm:#B97A0F;--warm-soft:#F6EDDC;
  --violet:#7A4FD6;--crit:#C24A3A;--crit-soft:#F7E4E0;--shadow:0 1px 2px rgba(22,36,29,.06),0 8px 24px rgba(22,36,29,.07)}
@media (prefers-color-scheme:dark){:root{--bg:#0D1411;--card:#16201B;--card2:#1B2620;--ink:#E7F0EA;--muted:#93A69B;
  --line:#24312A;--accent:#2FBE92;--accent-soft:#153328;--on-accent:#08130E;--warm:#D2953A;--warm-soft:#2E2415;
  --violet:#9C8BEA;--crit:#E07B6B;--crit-soft:#3A211C;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Albert Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.topo{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:820px;margin:0 auto;padding:14px 16px}
.marca{font:800 1.15rem "Bricolage Grotesque",sans-serif;color:var(--ink);text-decoration:none;letter-spacing:-.02em}
.marca b{color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:0 16px 48px}
.migalha{font-size:.85rem;color:var(--muted);margin:6px 0 10px}
.migalha a{color:var(--muted)}
h1{font:800 clamp(1.7rem,4.6vw,2.5rem)/1.15 "Bricolage Grotesque",sans-serif;letter-spacing:-.025em;margin:.2em 0 .35em;text-wrap:balance}
h2{font:700 1.3rem/1.25 "Bricolage Grotesque",sans-serif;letter-spacing:-.015em;margin:0 0 .6em}
.sub{color:var(--muted);font-size:1.05rem;margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:16px 0;box-shadow:var(--shadow)}
.card p{margin:0 0 .9em}.card p:last-child{margin-bottom:0}
.rotulo{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.cta{display:block;background:var(--accent);color:var(--on-accent);border-radius:16px;padding:22px;margin:22px 0;text-decoration:none;box-shadow:var(--shadow)}
.cta strong{display:block;font:800 1.25rem/1.25 "Bricolage Grotesque",sans-serif;margin-bottom:4px}
.cta span{opacity:.92}
.cta .btn{display:inline-block;margin-top:12px;background:var(--on-accent);color:var(--accent);font-weight:700;border-radius:999px;padding:10px 18px}
.corte{position:relative;max-height:13.5em;overflow:hidden}
.corte:after{content:"";position:absolute;inset:auto 0 0 0;height:6em;background:linear-gradient(to bottom,transparent,var(--card))}
.macete{font:800 2rem "Bricolage Grotesque",sans-serif;letter-spacing:.08em;color:var(--violet);margin:0 0 6px}
ul.lista{margin:0;padding-left:1.1em}ul.lista li{margin:.3em 0}
.lei{border-left:3px solid var(--accent);background:var(--card2);padding:12px 14px;border-radius:0 10px 10px 0;margin:10px 0}
.lei b{display:block;font-size:.85rem}
.lei small{display:block;margin-top:6px;color:var(--muted)}
mark{background:var(--warm-soft);color:inherit;padding:0 .15em;border-radius:3px}
.ramos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.ramo{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:12px}
.ramo b{display:block;margin-bottom:4px}
.ramo ul{margin:0;padding-left:1.1em;font-size:.93rem}
.peg li{margin:.45em 0}
details.q{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0;background:var(--card2)}
details.q summary{cursor:pointer;list-style:none}
details.q summary::-webkit-details-marker{display:none}
details.q summary .ver{display:block;margin-top:8px;font-size:.85rem;font-weight:700;color:var(--accent)}
details.q[open] summary .ver{display:none}
.gab{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.gab .c{font-weight:800;color:var(--accent)}.gab .e{font-weight:800;color:var(--crit)}
.trancado{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin:12px 0 0;padding:0;list-style:none}
.trancado li{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:.92rem}
.nota{font-size:.85rem;color:var(--muted)}
.disc{margin:26px 0 8px}
.idx{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.idx a{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;text-decoration:none;color:var(--ink);font-weight:600}
.idx a:hover{border-color:var(--accent)}
.rel{list-style:none;padding:0;margin:0}.rel li{margin:.4em 0}
footer{max-width:820px;margin:0 auto;padding:24px 16px 40px;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}
#admBar{display:none;position:fixed;left:16px;right:16px;bottom:16px;max-width:520px;margin:auto;background:var(--ink);color:var(--bg);border-radius:14px;padding:12px 14px;font-size:.9rem;box-shadow:var(--shadow);gap:10px;align-items:center;justify-content:space-between}
#admBar button{background:var(--crit);color:#fff;border:0;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer}
</style>
</head>
<body>
<header class="topo">
  <a class="marca" href="/">Persiste<b>IA</b></a>
  <a href="/?comecar=1&amp;origem=assunto" onclick="gtag('event','cta_assunto',{local:'topo'})">Testar grátis</a>
</header>
<main class="wrap">
${corpo}
</main>
<footer>
  <p>Material de estudo gerado por inteligência artificial e organizado pela PersisteIA, com a lei seca conferida por uma segunda leitura independente e link para o texto oficial. Não substitui a leitura da lei, da jurisprudência atualizada e do edital do seu concurso. Encontrou um erro? Escreva para <a href="mailto:persisteiamentoria@outlook.com">persisteiamentoria@outlook.com</a>.</p>
  <p><a href="/">PersisteIA</a> · <a href="/assuntos">Todos os assuntos</a> · Instagram <a href="https://instagram.com/persisteia" rel="noopener">@persisteia</a></p>
</footer>
</body>
</html>`;
}

function cta(local, assunto) {
  return `<a class="cta" href="/?comecar=1&amp;origem=assunto" onclick="gtag('event','cta_assunto',{local:'${local}'})">
  <strong>${assunto ? `Estude ${esc(assunto)} no ritmo do seu edital` : 'Envie o edital e receba o cronograma até a prova'}</strong>
  <span>Envie o PDF do edital: a PersisteIA monta o cronograma até a prova e entrega cada assunto em 8 formatos, com aula completa, podcast, flashcards e questões no estilo da banca.</span>
  <span class="btn">Começar meus 7 dias grátis →</span>
</a>`;
}

function paragrafos(texto, max) {
  const ps = String(texto || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return (max ? ps.slice(0, max) : ps).map(p => `<p>${esc(p)}</p>`).join('\n');
}

function paginaAssunto(item, p, relacionados) {
  const assunto = item.topico;
  const disciplina = item.disciplina;
  const banca = p.banca ? String(p.banca) : '';
  const caminho = '/assuntos/' + item.slug;

  const simples = String(p.explicacao_simples || '');
  const primeira = simples.split(/\n\s*\n/)[0] || p.subtitulo || '';
  const descricao = (assunto + ' para concurso: ' + primeira).replace(/\s+/g, ' ').slice(0, 155).replace(/\s\S*$/, '') + '…';

  const sec = [];

  sec.push(`<nav class="migalha"><a href="/assuntos">Assuntos</a> › <a href="/assuntos#${esc(slugDe(disciplina))}">${esc(disciplina)}</a></nav>
<h1>${esc(assunto)}</h1>
<p class="sub">${esc(p.subtitulo || '')}${p.subtitulo ? ' · ' : ''}resumo, macete e questões${banca ? ' no estilo ' + esc(banca) : ''} para concurso</p>`);

  if (simples) {
    sec.push(`<section class="card"><span class="rotulo">Entenda primeiro</span>
<h2>Entenda ${esc(assunto)} de um jeito simples</h2>
${paragrafos(simples)}</section>`);
  }

  if (p.acronimo && p.acronimo.sigla && Array.isArray(p.acronimo.itens) && p.acronimo.itens.length) {
    sec.push(`<section class="card"><span class="rotulo">Macete</span>
<h2>Como memorizar</h2>
<p class="macete">${esc(p.acronimo.sigla)}</p>
<ul class="lista">${p.acronimo.itens.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`);
  }

  // só a lei seca que passou pela conferência independente vai para a vitrine
  const leis = (Array.isArray(p.dispositivos) ? p.dispositivos : []).filter(d => d && d.conferido && d.texto);
  if (leis.length) {
    sec.push(`<section class="card"><span class="rotulo">Lei seca</span>
<h2>O que diz a lei</h2>
${leis.map(d => {
  const fonte = d.fonte || fonteOficial(d.rotulo);
  const link = fonte && (fonte.url || fonte.link || (typeof fonte === 'string' ? fonte : ''));
  return `<div class="lei"><b>${esc(d.rotulo)}</b>${esc(d.texto)}${link ? `<small><a href="${esc(link)}" rel="noopener nofollow" target="_blank">Ler no texto oficial ↗</a></small>` : ''}</div>`;
}).join('\n')}</section>`);
  }

  if (p.resumo) {
    sec.push(`<section class="card"><span class="rotulo">Aula escrita</span>
<h2>O assunto completo</h2>
<div class="corte">${paragrafos(p.resumo, 2)}</div>
<p class="nota" style="margin-top:12px">A aula inteira tem cerca de ${Math.round((p.palavras_resumo || String(p.resumo).split(/\s+/).length) / 100) * 100} palavras${item.partes > 1 ? `, dividida em ${item.partes} partes` : ''}. Continue lendo dentro da PersisteIA, com palavras-chave coloridas, marca-texto e leitura em voz alta.</p></section>`);
  }

  sec.push(cta('meio', assunto));

  if (p.mapa && Array.isArray(p.mapa.ramos) && p.mapa.ramos.length) {
    sec.push(`<section class="card"><span class="rotulo">Mapa mental</span>
<h2>${esc(p.mapa.centro || assunto)}</h2>
<div class="ramos">${p.mapa.ramos.map(r => `<div class="ramo"><b>${esc(r.titulo)}</b><ul>${(r.itens || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div></section>`);
  }

  const pegs = Array.isArray(p.pegadinhas) ? p.pegadinhas.filter(Boolean) : [];
  if (pegs.length) {
    sec.push(`<section class="card"><span class="rotulo">Atenção</span>
<h2>Pegadinhas que a banca explora</h2>
<ul class="lista peg">${pegs.map(x => `<li>${esc(typeof x === 'string' ? x : (x.texto || x.pegadinha || ''))}</li>`).join('')}</ul></section>`);
  }

  // até 5 itens Certo/Errado com gabarito; o resto fica para o app
  const qs = (Array.isArray(p.questoes) ? p.questoes : []).filter(q => q && q.enunciado).slice(0, 5);
  if (qs.length) {
    sec.push(`<section class="card"><span class="rotulo">Treine</span>
<h2>Questões de Certo ou Errado${banca ? ' no estilo ' + esc(banca) : ''}</h2>
<p class="nota">Julgue o item antes de abrir o gabarito.</p>
${qs.map((q, i) => `<details class="q"><summary><b>${i + 1}.</b> ${esc(q.enunciado)}<span class="ver">Ver gabarito</span></summary>
<div class="gab">${q.gabarito ? '<span class="c">CERTO.</span>' : '<span class="e">ERRADO.</span>'} ${esc(q.comentario || '')}</div></details>`).join('\n')}
</section>`);
  }

  sec.push(`<section class="card"><span class="rotulo">Dentro do app</span>
<h2>O que mais vem neste assunto</h2>
<ul class="trancado">
<li>🎧 Podcast em duas vozes</li><li>🎵 Música do assunto</li><li>🃏 Flashcards com revisão espaçada</li>
<li>✍️ Questões de múltipla escolha</li><li>🎬 Cinema Mental</li><li>🗣️ Explicação em voz alta corrigida pela IA</li>
<li>📅 Cronograma até a prova</li><li>💬 Persi, o tira-dúvidas</li>
</ul></section>`);

  sec.push(cta('fim'));

  if (ehForense(item)) {
    sec.push(`<p class="nota" style="margin:18px 0 0"><a href="/pericia">Concurso de perícia? Veja todos os assuntos forenses →</a></p>`);
  }

  if (relacionados.length) {
    sec.push(`<section><h2>Outros assuntos de ${esc(disciplina)}</h2>
<ul class="rel">${relacionados.map(r => `<li><a href="/assuntos/${esc(r.slug)}">${esc(r.topico)}</a></li>`).join('')}</ul></section>`);
  }

  // barra discreta que só aparece para a gestora logada neste navegador
  sec.push(`<div id="admBar"><span>Página pública deste assunto</span><button type="button" id="admOcultar">Tirar do ar</button></div>
<script>
(function(){var t;try{t=localStorage.getItem('persisteia_token')}catch(e){}if(!t)return;
fetch('/api/aluno',{headers:{Authorization:'Bearer '+t}}).then(function(r){return r.ok?r.json():null}).then(function(d){
 if(!d||!d.admin)return;var b=document.getElementById('admBar');b.style.display='flex';
 document.getElementById('admOcultar').onclick=function(){if(!confirm('Tirar esta página do ar?'))return;
  fetch('/api/assuntos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({slug:${JSON.stringify(item.slug)},ocultar:true})})
  .then(function(r){b.firstChild.textContent=r.ok?'Fora do ar. Pode levar até 1 hora para sumir do cache.':'Não consegui tirar do ar.'})};
});})();
</script>`);

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LearningResource',
        name: assunto,
        description: descricao,
        inLanguage: 'pt-BR',
        educationalLevel: 'Concurso público',
        about: disciplina,
        url: SITE + caminho,
        isAccessibleForFree: true,
        provider: { '@type': 'Organization', name: 'PersisteIA', url: SITE }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Assuntos', item: SITE + '/assuntos' },
          { '@type': 'ListItem', position: 2, name: disciplina, item: SITE + '/assuntos#' + slugDe(disciplina) },
          { '@type': 'ListItem', position: 3, name: assunto, item: SITE + caminho }
        ]
      }
    ]
  };

  return casca({
    titulo: assunto + ' — resumo, macete e questões para concurso | PersisteIA',
    descricao, caminho, corpo: sec.join('\n'), jsonld
  });
}

function paginaIndice(itens) {
  const porDisc = new Map();
  for (const it of itens) {
    if (!porDisc.has(it.disciplina)) porDisc.set(it.disciplina, []);
    porDisc.get(it.disciplina).push(it);
  }
  const discs = [...porDisc.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const corpo = `<h1>Assuntos de concurso explicados</h1>
<p class="sub">${itens.length} assuntos com explicação simples, macete, mapa mental, pegadinhas e questões com gabarito — grátis, sem cadastro.</p>
${cta('indice')}
${discs.map(d => `<h2 class="disc" id="${esc(slugDe(d))}">${esc(d)}</h2>
<ul class="idx">${porDisc.get(d).sort((a, b) => a.topico.localeCompare(b.topico, 'pt-BR'))
  .map(it => `<li><a href="/assuntos/${esc(it.slug)}">${esc(it.topico)}</a></li>`).join('')}</ul>`).join('\n')}`;
  return casca({
    titulo: 'Assuntos de concurso explicados: resumo, macete e questões | PersisteIA',
    descricao: 'Assuntos de concurso público explicados de forma simples, com macete, mapa mental, pegadinhas da banca e questões com gabarito. Grátis.',
    caminho: '/assuntos', corpo
  });
}

// ---------- /pericia: página de chegada para concursos de perícia ----------
// Quem busca "concurso perito criminal" e cai na lista geral vê primeiro
// Administração e Língua Portuguesa. Aqui as matérias forenses vêm primeiro,
// com quem fez o sistema e o convite para o teste — é a página do anúncio de
// perícia, do link da bio e da busca do Google.
const FORENSE = /medicina legal|forens|odontoleg|odonto-?legal|per[ií]cia|perito|tanatolog|traumatolog|les(ões|oes) corporais|marcas de mordida|desastres? em massa|corpo de delito|cadeia de cust|criminal[ií]stica|papilosc|bal[ií]stic|toxicolog|identifica[cç][aã]o humana|dna/i;
function ehForense(it) { return FORENSE.test(it.disciplina) || FORENSE.test(it.topico); }

function paginaPericia(itens) {
  const forenses = itens.filter(ehForense);
  const porDisc = new Map();
  for (const it of forenses) {
    const d = FORENSE.test(it.disciplina) ? it.disciplina : 'Perícia em outras matérias';
    if (!porDisc.has(d)) porDisc.set(d, []);
    porDisc.get(d).push(it);
  }
  const discs = [...porDisc.keys()].sort((a, b) =>
    (a === 'Perícia em outras matérias') - (b === 'Perícia em outras matérias') || a.localeCompare(b, 'pt-BR'));
  const botao = local => `<a class="cta" href="/?comecar=1&amp;origem=pericia" onclick="gtag('event','cta_assunto',{local:'pericia-${local}'})">
  <strong>Envie o edital do seu concurso de perícia</strong>
  <span>A PersisteIA monta o cronograma até a prova e entrega cada assunto em 8 formatos — aula completa, podcast, mapa mental, flashcards e questões no estilo da banca.</span>
  <span class="btn">Começar meus 7 dias grátis →</span>
</a>`;
  const corpo = `<nav class="migalha"><a href="/assuntos">Assuntos</a> › Perícia</nav>
<h1>Concurso de perícia? Estude pelo seu edital.</h1>
<p class="sub">Medicina legal, criminalística, odontologia legal e as matérias que a banca cobra de perito — explicadas de um jeito simples, com macete, mapa mental e questões com gabarito.</p>
${botao('topo')}
<section class="card"><span class="rotulo">Quem fez</span>
<h2>Feito por uma perita oficial</h2>
<p>A PersisteIA foi criada por Sanmya Tiradentes, Perita Odontolegista da Polícia Civil do Amazonas, aprovada em três concursos públicos. O método por trás do sistema é o que ela gostaria de ter tido quando estudava: o edital vira um plano diário, cada assunto do tamanho que ele merece, e o estudo ativo no lugar da releitura.</p>
<p class="nota">O material é gerado por inteligência artificial, com a lei seca conferida por uma segunda leitura e link para o texto oficial.</p></section>
<section><h2>${forenses.length} assuntos de perícia para estudar agora, grátis</h2>
${discs.map(d => `<h2 class="disc" id="${esc(slugDe(d))}">${esc(d)}</h2>
<ul class="idx">${porDisc.get(d).sort((a, b) => a.topico.localeCompare(b.topico, 'pt-BR'))
  .map(it => `<li><a href="/assuntos/${esc(it.slug)}">${esc(it.topico)}</a></li>`).join('')}</ul>`).join('\n')}
</section>
${botao('fim')}
<p class="nota" style="margin-top:18px">Seu concurso cobra também português, informática e direito? Veja <a href="/assuntos">todos os assuntos</a>.</p>`;
  return casca({
    titulo: 'Concurso de perícia: medicina legal, criminalística e odontologia legal | PersisteIA',
    descricao: 'Assuntos de concurso de perito explicados de forma simples: medicina legal, tanatologia, traumatologia, odontologia legal e mais. Cronograma pelo seu edital, 7 dias grátis.',
    caminho: '/pericia', corpo
  });
}

function sitemap(itens) {
  const hoje = agora().slice(0, 10);
  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE}/assuntos</loc><lastmod>${hoje}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
    `<url><loc>${SITE}/pericia</loc><lastmod>${hoje}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...itens.map(it => `<url><loc>${SITE}/assuntos/${it.slug}</loc><lastmod>${String(it.criado_em || hoje).slice(0, 10)}</lastmod><priority>0.6</priority></url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function naoEncontrado(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  return res.status(404).send(casca({
    titulo: 'Assunto não encontrado | PersisteIA',
    descricao: 'Este assunto não está disponível.',
    caminho: '/assuntos',
    corpo: `<h1>Assunto não encontrado</h1><p class="sub">Ele pode ter mudado de endereço. Veja <a href="/assuntos">todos os assuntos</a>.</p>${cta('404')}`
  }).replace('<head>', '<head>\n<meta name="robots" content="noindex">'));
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  await ensureSchema();
  const db = getDb();

  if (req.method === 'POST') {
    const quem = await alunoDoToken(req);
    if (!quem || !ehAdmin(quem.email)) return res.status(403).json({ erro: 'Só a gestora' });
    const { slug, ocultar } = req.body || {};
    if (!slug) return res.status(400).json({ erro: 'slug é obrigatório' });
    if (ocultar) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO paginas_ocultas (slug, criado_em) VALUES (?,?)', args: [String(slug), agora()] });
    } else {
      await db.execute({ sql: 'DELETE FROM paginas_ocultas WHERE slug = ?', args: [String(slug)] });
    }
    return res.status(200).json({ ok: true });
  }

  const url = new URL(req.url, 'http://x');
  try {
    const todos = await catalogo();
    const itens = todos.filter(it => !it.oculta);
    // a CDN da Vercel guarda a página por 1 hora; o banco quase não é tocado
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    if (url.searchParams.get('sitemap')) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(sitemap(itens));
    }

    const slug = url.searchParams.get('slug');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.searchParams.get('area') === 'pericia') return res.status(200).send(paginaPericia(itens));
    if (!slug) return res.status(200).send(paginaIndice(itens));

    const item = itens.find(it => it.slug === slug);
    if (!item) return naoEncontrado(res);
    const r = await db.execute({ sql: 'SELECT json FROM conteudos WHERE topico_id = ?', args: [item.chave] });
    let p = null;
    try { p = JSON.parse(r.rows[0].json); } catch (_) {}
    if (!p) return naoEncontrado(res);

    const relacionados = itens
      .filter(it => it.disciplina === item.disciplina && it.slug !== item.slug)
      .sort((a, b) => a.topico.localeCompare(b.topico, 'pt-BR'))
      .slice(0, 8);
    return res.status(200).send(paginaAssunto(item, p, relacionados));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send('Erro ao montar a página.');
  }
};

module.exports.slugDe = slugDe;
