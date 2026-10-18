// PersisteIA — Leitura do dia (leitura, técnica e Constituição do dia), trilhas
// de 21 dias e "Ouvir o dia". Conteúdo fixo em conteudo/diario.js: todos veem a
// mesma leitura no mesmo dia. O progresso das trilhas fica no aparelho.
//
// O mesmo bloco aparece no site (antes do cadastro) e na aba Método do app:
// cada lugar tem um <div class="ld-raiz" data-modo="site|app">.

(function () {
  var C = window.PERSIS_DIARIO;
  if (!C) return;

  var MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  var SEMANA = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  var SITE = 'https://www.persisteia.com.br/#leitura';
  var desloc = 0;            // dias de distância de hoje (setas ‹ ›)
  var trilhaAberta = null;   // id da trilha com o detalhe aberto

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function hojeLocal(d) { d = d || new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function chaveData(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  // Número do dia contado a partir de 1/1/2026 — todos veem o mesmo conteúdo no mesmo dia.
  function numeroDia(d) { return Math.round((hojeLocal(d) - new Date(2026, 0, 1)) / 86400000); }
  function item(lista, n) { return lista[((n % lista.length) + lista.length) % lista.length]; }
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, v) { try { localStorage.setItem(chave, JSON.stringify(v)); } catch (e) {} }

  function dataDoDia() { var d = hojeLocal(); d.setDate(d.getDate() + desloc); return d; }
  function conteudo(n) {
    if (n == null) n = numeroDia(dataDoDia());
    return { lt: item(C.leituras, n), tec: item(C.tecnicas, n), cf: item(C.constituicao, n), n: n };
  }
  function noApp(raiz) { return raiz && raiz.getAttribute('data-modo') === 'app'; }

  // --- sequência de dias com a leitura aberta ---
  function registrarVisita() {
    var v = ler('persis_leitura_visitas', { ultimo: null, seq: 0 });
    var hoje = chaveData(hojeLocal());
    if (v.ultimo === hoje) return v.seq;
    var ontem = hojeLocal(); ontem.setDate(ontem.getDate() - 1);
    v.seq = (v.ultimo === chaveData(ontem)) ? v.seq + 1 : 1;
    v.ultimo = hoje;
    gravar('persis_leitura_visitas', v);
    return v.seq;
  }

  function botoes(qual, raiz) {
    return '<div class="ld-botoes">' +
      '<button class="ld-btn" data-ld="ouvir" data-qual="' + qual + '">Ouvir</button>' +
      (noApp(raiz)
        ? '<button class="ld-btn" data-ld="perguntar" data-qual="' + qual + '">Perguntar ao Persi</button>'
        : '') +
      '<button class="ld-btn discreto" data-ld="compartilhar" data-qual="' + qual + '">Compartilhar</button>' +
    '</div>';
  }

  function rotuloDia() {
    return desloc === 0 ? 'Hoje' : (desloc === -1 ? 'Ontem' : (desloc === 1 ? 'Amanhã'
      : (desloc < 0 ? 'Há ' + (-desloc) + ' dias' : 'Daqui a ' + desloc + ' dias')));
  }

  function htmlDia(raiz) {
    var d = dataDoDia(), c = conteudo();
    var lt = c.lt, t = c.tec, cf = c.cf;
    return '' +
      '<div class="ld-topo">' +
        '<div class="ld-nav">' +
          '<button class="ld-seta" data-ld="ant" aria-label="Dia anterior">‹</button>' +
          '<div class="ld-dia"><b>' + rotuloDia() + '</b><span>' + SEMANA[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + '</span>' +
            (desloc ? '<button class="ld-hoje" data-ld="hoje">voltar para hoje</button>' : '') + '</div>' +
          '<button class="ld-seta" data-ld="prox" aria-label="Próximo dia">›</button>' +
        '</div>' +
        '<div class="ld-extra"><button class="ld-btn" data-ld="ouvir" data-qual="dia">Ouvir o dia</button>' +
          '<span class="ld-seq">' + (SEQ > 1 ? SEQ + ' dias seguidos' : 'Comece sua sequência hoje') + '</span></div>' +
      '</div>' +
      '<div class="ld-grade">' +
        '<article class="ld-card principal">' +
          '<div class="ld-tag">Leitura do dia · ' + esc(lt.eixo) + '</div>' +
          '<h3 class="ld-tit">' + esc(lt.tema) + '</h3>' +
          '<div class="ld-autor">' + esc(lt.fonte) + '</div>' +
          '<p class="ld-texto">' + esc(lt.ideia) + '</p>' +
          '<div class="ld-acao"><strong>Na prática, hoje</strong><p>' + esc(lt.pratica) + '</p></div>' +
          '<p class="ld-pergunta">' + esc(lt.pergunta) + '</p>' +
          '<p class="ld-frase">' + esc(lt.frase) + '</p>' +
          botoes('leitura', raiz) +
        '</article>' +
        '<div class="ld-lado">' +
          '<article class="ld-card">' +
            '<div class="ld-tag">Técnica do dia</div>' +
            '<h3 class="ld-tit">' + esc(t.nome) + '</h3>' +
            '<div class="ld-autor">' + esc(t.origem) + '</div>' +
            '<p class="ld-ideia">' + esc(t.em_uma_frase) + '</p>' +
            '<ol class="ld-passos">' + t.como_usar.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>' +
            '<p class="ld-ex">' + esc(t.exemplo) + '</p>' +
            '<div class="ld-alerta"><strong>Cuidado</strong><p>' + esc(t.armadilha) + '</p></div>' +
            botoes('tecnica', raiz) +
          '</article>' +
          '<article class="ld-card">' +
            '<div class="ld-tag">Constituição do dia</div>' +
            '<h3 class="ld-tit">' + esc(cf.tema) + '</h3>' +
            '<a class="ld-ref" href="' + esc(cf.link) + '" target="_blank" rel="noopener">' + esc(cf.dispositivo) + ' <span>· ler no Planalto ↗</span></a>' +
            '<p class="ld-ideia">' + esc(cf.o_que_diz) + '</p>' +
            '<div class="ld-acao"><strong>Como cai na prova</strong><p>' + esc(cf.como_cai) + '</p></div>' +
            '<div class="ld-alerta"><strong>Pegadinha</strong><p>' + esc(cf.pegadinha) + '</p></div>' +
            botoes('cf', raiz) +
          '</article>' +
        '</div>' +
      '</div>' +
      (noApp(raiz) ? '' :
        '<div class="ld-cta"><p>Quer isso junto do seu cronograma, com aula, questões e revisão de cada assunto do seu edital?</p>' +
        '<button class="btn small" onclick="abrirConta(\'cadastro\')">Começar meus 7 dias grátis</button></div>') +
      htmlTrilhas();
  }

  // --- trilhas de 21 dias ---
  function estadoTrilhas() { return ler('persis_trilhas', {}); }
  function diaAtualTrilha(s) {
    if (!s) return 0;
    var n = s.feitos.length;
    if (s.feitos.indexOf(chaveData(hojeLocal())) !== -1) return n - 1;
    return Math.min(n, 20);
  }
  function htmlTrilhas() {
    var est = estadoTrilhas();
    var cards = C.trilhas.map(function (t) {
      var s = est[t.id], feitos = s ? s.feitos.length : 0;
      var status = !s ? 'Começar trilha' : (feitos >= 21 ? '✓ Concluída' : 'Continuar · dia ' + Math.min(feitos + 1, 21));
      return '<div class="ld-trilha' + (s ? ' iniciada' : '') + '">' +
        '<b>' + esc(t.nome) + '</b>' +
        '<p>' + esc(t.subtitulo) + '</p>' +
        '<small>' + esc(t.para_quem) + '</small>' +
        '<div class="ld-barra"><span style="width:' + Math.round(feitos / 21 * 100) + '%"></span></div>' +
        '<button class="ld-btn" data-ld="trilha" data-id="' + esc(t.id) + '">' + status + '</button>' +
      '</div>';
    }).join('');
    return '<div class="ld-trilhas">' +
      '<h3 class="ld-sub">Trilhas de 21 dias</h3>' +
      '<p class="ld-subtxt">Uma ação pequena por dia. O dia seguinte só libera amanhã — hábito vem de constância, não de pressa.</p>' +
      '<div class="ld-trilhas-grade">' + cards + '</div>' +
      (trilhaAberta ? htmlDetalheTrilha(trilhaAberta) : '') +
    '</div>';
  }
  function htmlDetalheTrilha(id) {
    var t = C.trilhas.filter(function (x) { return x.id === id; })[0];
    if (!t) return '';
    var s = estadoTrilhas()[id] || { feitos: [] };
    var feitos = s.feitos.length;
    var jaFezHoje = s.feitos.indexOf(chaveData(hojeLocal())) !== -1;
    var atual = diaAtualTrilha(s), dia = t.dias[atual];
    var acoes;
    if (feitos >= 21) acoes = '<p class="ld-msg">Você concluiu os 21 dias. Agora é seu — continue sem a trilha.</p>';
    else if (jaFezHoje) acoes = '<p class="ld-msg">✓ Feito hoje. O dia ' + (feitos + 1) + ' libera amanhã.</p>';
    else acoes = '<button class="btn small" data-ld="feito" data-id="' + esc(id) + '">✓ Fiz hoje</button>';
    return '<div class="ld-detalhe">' +
      '<button class="ld-fechar" data-ld="fechar" aria-label="Fechar">×</button>' +
      '<div class="ld-tag">Trilha de 21 dias · ' + feitos + ' de 21</div>' +
      '<h3 class="ld-tit">' + esc(t.nome) + '</h3>' +
      '<div class="ld-barra"><span style="width:' + Math.round(feitos / 21 * 100) + '%"></span></div>' +
      '<div class="ld-diatr"><span class="ld-num">Dia ' + (atual + 1) + '</span>' +
        '<h4>' + esc(dia.titulo) + '</h4><p>' + esc(dia.acao) + '</p>' +
        '<p class="ld-pq"><strong>Por quê:</strong> ' + esc(dia.por_que) + '</p>' + acoes + '</div>' +
      '<div class="ld-mapa">' + t.dias.map(function (d, i) {
        var cls = i < feitos ? 'ok' : (i === atual ? 'agora' : '');
        return '<span class="' + cls + '" title="Dia ' + (i + 1) + ' — ' + esc(d.titulo) + '">' + (i < feitos ? '✓' : i + 1) + '</span>';
      }).join('') + '</div>' +
      '<p class="ld-fontes">Base: ' + esc(t.fontes) + '</p>' +
      '<button class="ld-btn discreto" data-ld="recomecar" data-id="' + esc(id) + '">Recomeçar trilha</button>' +
    '</div>';
  }

  // --- desenhar ---
  var SEQ = 0;
  function render() {
    document.querySelectorAll('.ld-raiz').forEach(function (r) { r.innerHTML = htmlDia(r); });
    var tz = document.getElementById('ldTeaser');
    if (tz) {
      var c = conteudo(numeroDia(new Date()));
      tz.innerHTML = '<p class="eyebrow" style="margin-bottom:4px">Leitura do dia · ' + esc(c.lt.eixo) + '</p>' +
        '<h2 style="font-size:1rem">' + esc(c.lt.tema) + '</h2>' +
        '<p class="muted" style="font-size:.78rem; margin:4px 0 10px">Mais a técnica e a Constituição do dia · cerca de 5 min</p>' +
        '<button class="btn ghost small" data-ld="abrir-app">Ler agora</button>';
    }
  }

  // --- ouvir (voz do navegador) ---
  var falando = false;
  function vozPt() {
    var vozes = speechSynthesis.getVoices().filter(function (v) { return /^pt(-|_)BR/i.test(v.lang); });
    var pref = ['Luciana', 'Google português do Brasil', 'Francisca', 'Thalita', 'Microsoft Maria'];
    for (var i = 0; i < pref.length; i++) {
      var v = vozes.filter(function (x) { return x.name.indexOf(pref[i]) === 0; })[0];
      if (v) return v;
    }
    return vozes[0] || null;
  }
  function falar(blocos, botao) {
    if (!('speechSynthesis' in window)) { alert('Seu navegador não tem leitura em voz alta.'); return; }
    if (falando) { pararFala(); return; }
    var frases = [];
    blocos.forEach(function (b) {
      (String(b).match(/[^.!?…]+[.!?…]*/g) || []).forEach(function (f) { f = f.trim(); if (f) frases.push(f); });
    });
    var voz = vozPt();
    falando = true;
    botao.dataset.rotulo = botao.textContent; botao.textContent = 'Parar'; botao.classList.add('falando');
    frases.forEach(function (f, i) {
      var u = new SpeechSynthesisUtterance(f);
      u.lang = 'pt-BR'; u.rate = 1;
      if (voz) u.voice = voz;
      if (i === frases.length - 1) u.onend = pararFala;
      speechSynthesis.speak(u);
    });
  }
  function pararFala() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    falando = false;
    document.querySelectorAll('.ld-btn.falando').forEach(function (b) {
      b.classList.remove('falando'); if (b.dataset.rotulo) { b.textContent = b.dataset.rotulo; delete b.dataset.rotulo; }
    });
  }
  function paraVoz(s) {
    return String(s).replace(/\bArts?\.\s*/g, 'artigo ').replace(/§§?\s*/g, 'parágrafo ').replace(/\bCF\/88\b/g, 'Constituição Federal');
  }
  function roteiro(qual) {
    var c = conteudo();
    if (qual === 'leitura') return ['Leitura do dia. ' + c.lt.tema + '.', c.lt.ideia, 'Na prática, hoje. ' + c.lt.pratica, 'Para pensar. ' + c.lt.pergunta, c.lt.frase];
    if (qual === 'tecnica') return ['Técnica do dia. ' + c.tec.nome + '.', c.tec.em_uma_frase, 'Como usar.'].concat(c.tec.como_usar).concat([c.tec.exemplo, 'Cuidado. ' + c.tec.armadilha]);
    if (qual === 'cf') return ['Constituição do dia. ' + c.cf.tema + '. ' + paraVoz(c.cf.dispositivo) + '.', paraVoz(c.cf.o_que_diz), 'Como cai na prova. ' + paraVoz(c.cf.como_cai), 'Pegadinha. ' + paraVoz(c.cf.pegadinha)];
    var d = dataDoDia();
    return ['Olá! Aqui é a Persiste I A, com a leitura do dia. ' + SEMANA[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + '.']
      .concat(roteiro('leitura'), roteiro('tecnica'), roteiro('cf'))
      .concat(['Isso é tudo por hoje. Um pouco todo dia vence muito de vez em quando. Até amanhã!']);
  }

  function textoPergunta(qual) {
    var c = conteudo();
    if (qual === 'leitura') return 'Li a leitura de hoje, "' + c.lt.tema + '". Como aplico isso na minha rotina de estudo? ';
    if (qual === 'tecnica') return 'Como uso a técnica "' + c.tec.nome + '" nos assuntos do meu edital? ';
    return 'Explique o ' + c.cf.dispositivo + ' (' + c.cf.tema + ') e me dê um exemplo de como a banca cobra. ';
  }
  function perguntar(qual) {
    if (typeof openChat !== 'function' || !document.getElementById('cInput')) return;
    openChat();
    var inp = document.getElementById('cInput');
    inp.value = textoPergunta(qual);
    setTimeout(function () { inp.focus(); }, 200);
  }
  function compartilhar(qual) {
    var c = conteudo(), texto;
    if (qual === 'leitura') texto = c.lt.tema + '\n\n' + c.lt.ideia + '\n\nNa prática, hoje: ' + c.lt.pratica;
    else if (qual === 'tecnica') texto = 'Técnica do dia: ' + c.tec.nome + '\n\n' + c.tec.em_uma_frase + '\n\nCuidado: ' + c.tec.armadilha;
    else texto = 'Constituição do dia: ' + c.cf.dispositivo + ' — ' + c.cf.tema + '\n\n' + c.cf.o_que_diz + '\n\nPegadinha: ' + c.cf.pegadinha + '\n\nTexto oficial: ' + c.cf.link;
    texto += '\n\nLeitura do dia do concurseiro na PersisteIA: ' + SITE;
    if (navigator.share) navigator.share({ title: 'PersisteIA — Leitura do dia', text: texto }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  }

  // --- eventos ---
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ld]');
    if (!b) return;
    var acao = b.getAttribute('data-ld'), raiz = b.closest('.ld-raiz');
    if (acao === 'ant') { desloc--; pararFala(); render(); }
    else if (acao === 'prox') { desloc++; pararFala(); render(); }
    else if (acao === 'hoje') { desloc = 0; pararFala(); render(); }
    else if (acao === 'ouvir') falar(roteiro(b.dataset.qual), b);
    else if (acao === 'perguntar') perguntar(b.dataset.qual);
    else if (acao === 'compartilhar') compartilhar(b.dataset.qual);
    else if (acao === 'trilha') { trilhaAberta = b.dataset.id; render(); rolarDetalhe(raiz); }
    else if (acao === 'fechar') { trilhaAberta = null; render(); }
    else if (acao === 'feito') {
      var est = estadoTrilhas(), id = b.dataset.id, hoje = chaveData(hojeLocal());
      var s = est[id] = est[id] || { inicio: hoje, feitos: [] };
      if (s.feitos.indexOf(hoje) === -1 && s.feitos.length < 21) s.feitos.push(hoje);
      gravar('persis_trilhas', est); render(); rolarDetalhe(raiz);
    }
    else if (acao === 'recomecar') {
      if (!confirm('Recomeçar esta trilha do dia 1? O progresso atual será zerado.')) return;
      var est2 = estadoTrilhas(); delete est2[b.dataset.id]; gravar('persis_trilhas', est2); render(); rolarDetalhe(raiz);
    }
    else if (acao === 'abrir-app') {
      var tab = document.querySelector('.tab[data-scr="metodo"]');
      if (typeof nav === 'function' && tab) nav('metodo', tab);
      setTimeout(function () { var r = document.querySelector('.ld-raiz[data-modo="app"]'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
    }
  });
  function rolarDetalhe(raiz) {
    var alvo = (raiz || document).querySelector('.ld-detalhe');
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function iniciar() {
    SEQ = registrarVisita();
    render();
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
