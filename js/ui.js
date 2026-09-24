/*
 * Ligeiro - pecinhas de tela usadas por todas as partes:
 * criar elementos sem risco de HTML vindo de fora, avisos (torrada),
 * sons, modal, dinheiro, guardar no aparelho.
 */
(function () {
  'use strict';

  var R = window.LigeiroRegras;

  function $(id) { return document.getElementById(id); }

  /*
   * el('div', { class: 'x', onclick: f, text: 'oi' }, [filhos])
   * Texto sempre entra por textContent: nome de produto, endereco e recado
   * do cliente nunca viram HTML.
   */
  function el(tag, atributos, filhos) {
    var e = document.createElement(tag);
    var a = atributos || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v; /* so para HTML que a gente mesmo escreveu */
      else if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { e.dataset[d] = v[d]; });
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    var lista = Array.isArray(filhos) ? filhos : (filhos == null ? [] : [filhos]);
    lista.forEach(function (f) {
      if (f == null || f === false) return;
      e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    });
    return e;
  }

  function limpar(elemento) { while (elemento.firstChild) elemento.removeChild(elemento.firstChild); }

  function guardarLocal(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) { /* modo anonimo */ }
  }
  function lerLocal(chave) {
    try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (_) { return null; }
  }

  /* ---------- Torrada (aviso curto) ---------- */
  var tempoTorrada;
  function avisar(mensagem) {
    var t = $('torrada');
    if (!t) return;
    t.textContent = mensagem;
    t.classList.add('visivel');
    clearTimeout(tempoTorrada);
    tempoTorrada = setTimeout(function () { t.classList.remove('visivel'); }, 3200);
  }

  /* ---------- Sons (gerados na hora, sem arquivo) ---------- */
  /* vale a escolha guardada (Apito ligado ou desligado). "Reduzir movimento" do celular nao mexe no som: antes, no
     iPhone com essa opcao, o apito voltava desligado a cada abertura e o pedido novo entrava calado */
  var som = { contexto: null, ligado: lerLocal('ligeiro:som') !== false };

  function prepararSom() {
    if (som.contexto) { if (som.contexto.state === 'suspended') { var r = som.contexto.resume(); if (r && r.then) r.then(avisarLiberou, function () {}); } else avisarLiberou(); return; }
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) som.contexto = new C();
    } catch (_) { /* sem audio */ }
    if (som.contexto && som.contexto.state === 'running') avisarLiberou();
    else if (som.contexto && som.contexto.resume) { var p = som.contexto.resume(); if (p && p.then) p.then(avisarLiberou, function () {}); }
  }
  /* o navegador so toca som depois do primeiro toque na pagina: o botao Apito mostra "Ligar" ate isso acontecer */
  var aoLiberar = [];
  function avisarLiberou() {
    if (!som.contexto || som.contexto.state !== 'running') return;
    if (!som.liberouEm) som.liberouEm = Date.now();
    var lista = aoLiberar; aoLiberar = [];
    lista.forEach(function (fn) { try { fn(); } catch (_) { /* segue */ } });
  }
  function somTravado() { return som.ligado && !(som.contexto && som.contexto.state === 'running'); }
  /* o toque que liberou o som foi agora mesmo (o mesmo toque no botao Apito nao deve desligar o apito) */
  function somAcabouDeLiberar() { return !!som.liberouEm && Date.now() - som.liberouEm < 1000; }
  function quandoLiberarSom(fn) { if (!somTravado()) { fn(); return; } aoLiberar.push(fn); }

  function tocar(notas) {
    if (!som.ligado || !som.contexto) return;
    try {
      var agora = som.contexto.currentTime;
      notas.forEach(function (n) {
        var osc = som.contexto.createOscillator();
        var ganho = som.contexto.createGain();
        var inicio = agora + (n[3] || 0);
        osc.type = n[4] || 'sine';
        osc.frequency.setValueAtTime(n[0], inicio);
        ganho.gain.setValueAtTime(0.0001, inicio);
        ganho.gain.exponentialRampToValueAtTime(n[2], inicio + 0.012);
        ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + n[1]);
        osc.connect(ganho).connect(som.contexto.destination);
        osc.start(inicio);
        osc.stop(inicio + n[1] + 0.02);
      });
    } catch (_) { /* som nunca derruba a tela */ }
  }

  var SONS = {
    toque: function () { tocar([[520, 0.06, 0.05, 0]]); },
    adicionar: function () { tocar([[660, 0.07, 0.09, 0], [880, 0.09, 0.07, 0.06]]); },
    remover: function () { tocar([[420, 0.07, 0.07, 0], [300, 0.09, 0.05, 0.06]]); },
    erro: function () { tocar([[240, 0.14, 0.08, 0, 'square']]); },
    sucesso: function () { tocar([[660, 0.1, 0.09, 0], [880, 0.1, 0.09, 0.09], [1175, 0.22, 0.1, 0.18]]); },
    /* Pix caiu: duas notas de "moeda", alegres e curtas. */
    pago: function () { tocar([[988, 0.09, 0.2, 0, 'square'], [1319, 0.38, 0.2, 0.09, 'square']]); },
    /* Pedido cancelado: tres notas descendo, sem susto. */
    cancelado: function () { tocar([[440, 0.16, 0.16, 0, 'triangle'], [330, 0.16, 0.16, 0.17, 'triangle'], [247, 0.34, 0.16, 0.34, 'triangle']]); },
    /* Lembrete de pedido parado: tres batidas iguais e suaves. */
    lembrete: function () { tocar([[784, 0.12, 0.18, 0], [784, 0.12, 0.18, 0.2], [784, 0.24, 0.18, 0.4]]); },
    /* Apito do painel: mais alto e repetido, tem que ser ouvido da cozinha. */
    apito: function () { tocar([[880, 0.18, 0.25, 0, 'square'], [1175, 0.18, 0.25, 0.22, 'square'], [880, 0.18, 0.25, 0.44, 'square'], [1175, 0.3, 0.25, 0.66, 'square']]); },
  };

  function soar(nome) { prepararSom(); if (SONS[nome]) SONS[nome](); }
  function somLigado(valor) {
    if (typeof valor === 'boolean') { som.ligado = valor; guardarLocal('ligeiro:som', valor); }
    return som.ligado;
  }
  document.addEventListener('pointerdown', prepararSom, { once: true });
  function vibrar(padrao) { if (navigator.vibrate) { try { navigator.vibrate(padrao || [120, 60, 120]); } catch (_) { /* ignora */ } } }

  /* ---------- Modal generico ---------- */
  function abrirModal(opcoes) {
    focoAntesDoModal = document.activeElement;
    var modal = $('modal');
    var caixa = $('modalCaixa');
    limpar(caixa);
    caixa.className = 'modal-caixa' + (opcoes.classe ? ' ' + opcoes.classe : '') + (opcoes.lado ? ' com-lado' : '');
    modal.classList.toggle('modal-centro', !!(opcoes.lado || opcoes.centro)); /* no PC: janela no meio (o CSS decide pela largura) */
    /* "lado": coluna da esquerda no PC (a foto do item). No celular ela fica escondida e vale a do corpo. */
    if (opcoes.lado) caixa.appendChild(el('div', { class: 'modal-lado' }, [opcoes.lado]));
    var topo = el('div', { class: 'modal-topo' }, [
      el('div', { style: { flex: '1' } }, [
        el('div', { class: 'titulo', text: opcoes.titulo || '' }),
        opcoes.sub ? el('div', { class: 'sub', text: opcoes.sub }) : null,
      ]),
      el('button', { class: 'fechar', 'aria-label': 'Fechar', onclick: fecharModal }, [iconeLinha('fechar')]),
    ]);
    var corpo = el('div', { class: 'modal-corpo' });
    if (opcoes.corpo) corpo.appendChild(opcoes.corpo);
    caixa.appendChild(topo);
    caixa.appendChild(corpo);
    if (opcoes.rodape) caixa.appendChild(el('div', { class: 'modal-rodape' }, opcoes.rodape));
    modal.classList.add('aberto');
    document.body.style.overflow = 'hidden';
    medirBarraDoModal();
    /* leitor de tela: a janela tem nome e o foco entra nela (antes ficava na pagina de tras) */
    caixa.setAttribute('aria-label', opcoes.titulo || 'Janela');
    caixa.tabIndex = -1;
    setTimeout(function () { if (modal.classList.contains('aberto') && !caixa.contains(document.activeElement)) { try { caixa.focus({ preventScroll: true }); } catch (_) { caixa.focus(); } } }, 60);
    return { corpo: corpo };
  }
  /* largura da barra de rolagem do corpo (0 no celular), pro CSS descontar do padding da direita */
  function medirBarraDoModal() {
    var caixa = $('modalCaixa');
    var corpo = caixa && caixa.querySelector('.modal-corpo');
    if (corpo) caixa.style.setProperty('--barra', Math.max(0, corpo.offsetWidth - corpo.clientWidth) + 'px');
  }
  window.addEventListener('resize', function () { var m = $('modal'); if (m && m.classList.contains('aberto')) medirBarraDoModal(); });

  var focoAntesDoModal = null;
  function fecharModal() {
    var modal = $('modal');
    if (!modal) return;
    modal.classList.remove('aberto');
    document.body.style.overflow = '';
    if (focoAntesDoModal && focoAntesDoModal.focus && document.body.contains(focoAntesDoModal)) { try { focoAntesDoModal.focus(); } catch (_) { /* ignora */ } }
    focoAntesDoModal = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var m = $('modal'); if (m && m.classList.contains('aberto')) fecharModal(); }
  });

  /* Pergunta simples de sim/nao, no estilo do app (sem o confirm() feio do navegador). */
  function perguntar(texto, opcoes) {
    var o = opcoes || {};
    return new Promise(function (resolve) {
      var corpo = el('p', { text: texto, style: { fontSize: '17px', padding: '6px 0 12px' } });
      abrirModal({
        titulo: o.titulo || 'Tem certeza?',
        corpo: corpo,
        rodape: [
          el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: o.nao || 'Voltar', onclick: function () { fecharModal(); resolve(false); } }),
          el('button', { class: 'btn ' + (o.perigo ? 'btn-erro' : 'btn-principal'), style: { flex: '1' }, text: o.sim || 'Sim', onclick: function () { fecharModal(); resolve(true); } }),
        ],
      });
      /* os dois botoes lado a lado, iguais; se o texto de um nao couber inteiro (celular estreito, letra grande), um embaixo
         do outro com a largura toda, a acao em cima (antes o texto encostava na borda e cortava) */
      var rodape = document.querySelector('#modalCaixa .modal-rodape');
      if (rodape) {
        rodape.classList.remove('empilhado');
        var naoCabe = [].some.call(rodape.querySelectorAll('.btn'), function (b) { return b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 2; });
        if (naoCabe) rodape.classList.add('empilhado');
      }
    });
  }

  /* ---------- Copiar texto ---------- */
  function copiar(texto) {
    var feito = function () { return true; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(feito).catch(function () { return copiarNaMao(texto); });
    }
    return Promise.resolve(copiarNaMao(texto));
  }
  function copiarNaMao(texto) {
    var area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }

  /* ---------- Datas ---------- */
  function horaCurta(iso) {
    try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }
  function dataCurta(iso) {
    try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch (_) { return ''; }
  }
  function tempoRelativo(iso) {
    var seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seg < 60) return 'agora';
    var min = Math.round(seg / 60);
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    return dataCurta(iso) + ' ' + horaCurta(iso);
  }

  /* Selo de horario do pedido: relogio, hora do pedido e ha quanto tempo. esperandoDesde (pedido pago que ainda nao
     comecou): laranja com 5 min, vermelho com 15. */
  var ICONE_RELOGIO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function tempoPassado(iso) {
    var min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    /* ate 3 h com os minutos ("ha 1 h 53"): cortar para "ha 1 h" escondia quase uma hora */
    if (min < 180) { var mm = min % 60; return 'há ' + Math.floor(min / 60) + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : ''); }
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    var d = Math.floor(min / 1440);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }
  function seloHorario(iso, esperandoDesde) {
    var velho = Date.now() - new Date(iso).getTime() >= 864e5;
    var hora = horaCurta(iso); /* sempre HH:MM: selo do mesmo tamanho em todo cartao; a data fica no title */
    var cor = 'cinza';
    if (esperandoDesde) {
      var espera = (Date.now() - new Date(esperandoDesde).getTime()) / 60000;
      cor = espera >= 15 ? 'fechado' : (espera >= 5 ? 'laranja' : 'cinza');
    }
    var titulo = 'Pedido feito ' + (velho ? 'em ' + dataCurta(iso) + ' às ' : 'às ') + horaCurta(iso) + (esperandoDesde ? ' · pago ' + tempoPassado(esperandoDesde) + ', esperando começar' : '');
    return el('span', { class: 'selo ' + cor + ' quando', title: titulo }, [
      el('span', { class: 'quando-ico', html: ICONE_RELOGIO }),
      el('span', { class: 'quando-hora', text: hora + ' ·' }),
      el('span', { class: 'quando-rel', text: tempoPassado(iso) }),
    ]);
  }

  /* Campo de dinheiro: a pessoa digita so numeros e ve "R$ 12,50". */
  function centavosDoCampo(texto) {
    var digitos = String(texto || '').replace(/[^0-9]/g, '');
    return digitos ? Number(digitos) : 0;
  }
  function mascaraDinheiro(input) {
    input.addEventListener('input', function () {
      var c = centavosDoCampo(input.value);
      input.value = c ? R.dinheiro(c) : '';
    });
  }
  function mascaraTelefone(input) {
    input.addEventListener('input', function () { input.value = R.formatarTelefone(input.value); });
  }

  /* Endereco base do app, para montar links (funciona no GitHub Pages e local). */
  function baseUrl() {
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }
  function linkDaLoja(loja) { return baseUrl() + '#/' + loja.cidadeSlug + '/' + loja.slug; }
  function linkDoBalcao(loja) { return baseUrl() + '#/balcao/' + loja.slug; }
  function linkDoPainel(loja) { return baseUrl() + '#/painel/' + loja.slug; }
  function linkDoPedido(loja, pedidoId) { return baseUrl() + '#/' + loja.cidadeSlug + '/' + loja.slug + '/pedido/' + pedidoId; }

  /* ---------- Fotos: diminuir no navegador antes de guardar ---------- */
  /*
   * Recebe o arquivo escolhido (foto de celular costuma ter 3 a 5 MB) e
   * devolve um JPEG pequeno em data URL, pronto pra guardar no banco.
   * lado = maior lado em pixels. quadrado = corta no centro (bom pra logo).
   */
  function lerImagem(arquivo, opcoes) {
    var o = opcoes || {};
    var lado = o.lado || 480;
    var qualidade = o.qualidade || 0.74;
    return new Promise(function (resolve, reject) {
      var pareceImagem = /^image\//.test(arquivo && arquivo.type || '') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(arquivo && arquivo.name || '');
      if (!arquivo || !pareceImagem) return reject(new Error('Escolha um arquivo de imagem (JPG ou PNG).'));
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      var falhou = function () { URL.revokeObjectURL(url); reject(new Error('Não deu para ler essa imagem. Tente outra.')); };
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('vazia');
          var sx = 0, sy = 0, sw = w, sh = h;
          if (o.quadrado) { var m = Math.min(w, h); sx = Math.round((w - m) / 2); sy = Math.round((h - m) / 2); sw = m; sh = m; }
          var escala = Math.min(1, lado / Math.max(sw, sh));
          var cw = Math.max(1, Math.round(sw * escala));
          var ch = Math.max(1, Math.round(sh * escala));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          var ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', qualidade));
        } catch (_) { falhou(); }
      };
      img.onerror = falhou;
      img.src = url;
    });
  }

  /*
   * Campo de foto pro painel: quadradinho com a imagem atual, botao de
   * escolher (no celular abre camera ou galeria) e botao de remover.
   * bloco.valor() -> { dados: 'data:image/jpeg;base64,…' ou null, removida: true/false }
   */
  function campoFoto(rotulo, srcAtual, opcoes) {
    var o = opcoes || {};
    var estado = { dados: null, removida: false };
    var img = el('img', { alt: '' });
    var vazio = ICONES_TRACO[o.vazio || 'camera'] ? el('span', { class: 'sem-foto' }, [iconeLinha(o.vazio || 'camera')]) : el('span', { class: 'sem-foto', text: o.vazio });
    var previa = el('div', { class: 'foto-previa' + (o.redonda ? ' redonda' : '') + (o.larga ? ' larga' : '') }, [img, vazio]);
    var entrada = el('input', { type: 'file', accept: 'image/*', class: 'oculto-visual', tabindex: '-1', 'aria-hidden': 'true' });
    var btnEscolher = el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', onclick: function () { entrada.click(); } });
    function rotuloEscolher(texto) { limpar(btnEscolher); btnEscolher.appendChild(iconeLinha('camera')); btnEscolher.appendChild(document.createTextNode(texto)); }
    var btnRemover = el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', text: 'Remover foto', onclick: function () { estado.dados = null; estado.removida = true; mostrar(null); } });
    var ajuda = el('p', { class: 'ajuda', text: o.ajuda || 'Pode ser tirada na hora com o celular. O sistema diminui a foto sozinho.' });
    function mostrar(src) {
      if (src) { img.src = src; img.hidden = false; vazio.hidden = true; btnRemover.hidden = false; rotuloEscolher('Trocar foto'); }
      else { img.removeAttribute('src'); img.hidden = true; vazio.hidden = false; btnRemover.hidden = true; rotuloEscolher('Escolher foto'); }
    }
    entrada.addEventListener('change', function () {
      var arquivo = entrada.files && entrada.files[0];
      entrada.value = '';
      if (!arquivo) return;
      btnEscolher.disabled = true;
      btnEscolher.textContent = 'Preparando…';
      lerImagem(arquivo, o).then(function (dados) {
        estado.dados = dados;
        estado.removida = false;
        mostrar(dados);
      }).catch(function (e) { avisar(e.message); mostrar(estado.dados || (estado.removida ? null : srcAtual)); })
        .then(function () { btnEscolher.disabled = false; });
    });
    mostrar(srcAtual || null);
    var bloco = el('div', { class: 'campo campo-foto' + (o.largo ? ' largo' : '') }, [
      el('label', { text: rotulo }),
      el('div', { class: 'foto-linha' }, [previa, el('div', { class: 'foto-botoes' }, [btnEscolher, btnRemover, ajuda])]),
      entrada,
    ]);
    bloco.valor = function () { return { dados: estado.dados, removida: estado.removida }; };
    return bloco;
  }

  /* ---------- Cor da loja ---------- */
  /*
   * A loja escolhe uma cor e o site dela inteiro segue: botao, destaque,
   * fundo suave e a cor escura dos titulos, todas derivadas da mesma cor.
   * Sem cor escolhida, vale o verde limao do Ligeiro (que esta no CSS).
   */
  var PALETA = [
    ['', 'Verde limão (padrão)'], ['#FF8A3D', 'Laranja'], ['#E03131', 'Vermelho'], ['#E64980', 'Rosa'], ['#7048E8', 'Roxo'],
    ['#1C7ED6', 'Azul'], ['#2F9E44', 'Verde'], ['#FAB005', 'Amarelo'], ['#8D5524', 'Marrom'], ['#1F1F1F', 'Preto'],
  ];
  var VARS_TEMA = ['--lime', '--lime-escuro', '--lime-suave', '--deep', '--deep2', '--senha', '--texto-no-destaque', '--raio', '--raio-p', '--raio-btn-p', '--raio-btn-g', '--raio-logo', '--raio-logo-p', '--display', '--altura-capa'];
  var ESTILOS = {
    cantos: [['arredondado', 'Arredondados'], ['reto', 'Retos']],
    logo: [['quadrada', 'Quadrada'], ['redonda', 'Redonda']],
    titulos: [['moderna', 'Moderna'], ['classica', 'Clássica']],
    capa: [['normal', 'Normal'], ['alta', 'Alta']],
  };

  function corValida(hex) { return /^#[0-9a-f]{6}$/i.test(hex || ''); }

  function hexParaRgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }
  function hexParaHsl(hex) {
    var c = hexParaRgb(hex);
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function hsl(h, s, l) { return 'hsl(' + h + ' ' + s + '% ' + l + '%)'; }
  function luminancia(hex) {
    var c = hexParaRgb(hex);
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  /* Texto preto ou branco em cima da cor, o que der mais contraste. */
  function corDeTexto(hex) { return corValida(hex) && luminancia(hex) < 0.35 ? '#FFFFFF' : '#0E1F14'; }

  /* Variaveis de CSS que a cor e o estilo da loja geram. Serve pro site inteiro e pra previa no painel. */
  function varsDoTema(cor, estilo) {
    var e = estilo || {};
    var v = {};
    if (e.cantos === 'reto') { v['--raio'] = '8px'; v['--raio-p'] = '6px'; v['--raio-btn-p'] = '6px'; v['--raio-btn-g'] = '10px'; v['--raio-logo'] = '12px'; v['--raio-logo-p'] = '8px'; }
    if (e.logo === 'redonda') { v['--raio-logo'] = '50%'; v['--raio-logo-p'] = '50%'; }
    if (e.titulos === 'classica') v['--display'] = 'Georgia, "Times New Roman", "Noto Serif", serif';
    if (e.capa === 'alta') v['--altura-capa'] = '280px';
    if (corValida(cor)) {
      var c = hexParaHsl(cor);
      v['--lime'] = cor;
      v['--lime-escuro'] = hsl(c.h, Math.min(c.s, 80), Math.min(c.l, 34));
      v['--lime-suave'] = hsl(c.h, Math.min(c.s, 70), 94);
      v['--deep'] = hsl(c.h, Math.min(c.s, 45), 18);
      v['--deep2'] = hsl(c.h, Math.min(c.s, 50), 30);
      v['--texto-no-destaque'] = corDeTexto(cor);
      /* numero da senha em cima do fundo escuro da loja: a propria cor quando ela aparece; escura demais (Preto, Marrom),
         um tom claro da mesma cor */
      v['--senha'] = luminancia(cor) < 0.2 ? hsl(c.h, Math.min(c.s, 60), 80) : cor;
    }
    return v;
  }
  function aplicarTema(cor, estilo) {
    limparTema();
    var v = varsDoTema(cor, estilo);
    Object.keys(v).forEach(function (k) { document.documentElement.style.setProperty(k, v[k]); });
  }
  /* Aplica o tema so dentro de um elemento (a previa do painel), sem mexer no resto da tela. */
  function aplicarTemaEm(elemento, cor, estilo) {
    VARS_TEMA.forEach(function (k) { elemento.style.removeProperty(k); });
    var v = varsDoTema(cor, estilo);
    Object.keys(v).forEach(function (k) { elemento.style.setProperty(k, v[k]); });
  }
  function limparTema() {
    VARS_TEMA.forEach(function (v) { document.documentElement.style.removeProperty(v); });
  }

  /* Medida da barra fixa do carrinho, para o conteudo nao ficar por baixo dela. */
  function medirBarras() {
    var altura = 0;
    document.querySelectorAll('.barra-carrinho.visivel').forEach(function (b) {
      altura = Math.max(altura, Math.round(b.getBoundingClientRect().height));
    });
    document.documentElement.style.setProperty('--altura-barra', altura + 'px');
  }

  /* Caixa padrao de "nao deu pra carregar" com botao pra tentar de novo (recarrega a pagina). */
  function erroCarregar(mensagem, tentar) {
    return el('div', { class: 'vazio hub-vazio', style: { paddingTop: '60px' } }, [
      el('img', { class: 'mascote-vazio', src: 'img/mascote.webp', alt: '' }),
      el('p', { class: 'forte', text: mensagem || 'Não deu para carregar agora.' }),
      el('p', { class: 'muted', text: 'Confira a internet e tente de novo.' }),
      el('button', { class: 'btn btn-principal', type: 'button', text: 'Tentar de novo', onclick: tentar || function () { location.reload(); } }),
    ]);
  }

  /* Carrega uma folha de estilo extra (tema oficial) uma vez so. */
  var cssProntos = {};
  function carregarCss(url) {
    if (cssProntos[url]) return cssProntos[url];
    cssProntos[url] = new Promise(function (resolve) {
      var link = el('link', { rel: 'stylesheet', href: url, 'data-css': url });
      link.onload = function () { resolve(true); };
      link.onerror = function () { resolve(false); };
      document.head.appendChild(link);
      setTimeout(function () { resolve(false); }, 5000); /* nunca segura a tela pra sempre */
    });
    return cssProntos[url];
  }
  /* Tela de carregamento da loja oficial: a logo pulsando no fundo da marca, ate o tema e a loja chegarem.
     Evita o "pisca" do visual padrao antes do tema. Devolve a funcao que tira a tela. */
  function splashOficial(o) {
    var caixa = el('div', { class: 'splash-oficial' + (o.ligeiro ? ' splash-ligeiro' : ''), style: { background: o.corFundo || '#f6e6c4' }, role: 'status', 'aria-label': 'Abrindo a loja' }, [
      o.logo ? el('img', { src: o.logo, alt: '' }) : el('img', { src: 'img/mascote.webp', alt: '' }),
      o.ligeiro ? el('div', { class: 'splash-marca' }, ['Ligei', el('span', { text: 'ro' })]) : null,
      el('div', { class: 'splash-pontos' }, [el('span'), el('span'), el('span')]),
    ]);
    document.body.appendChild(caixa);
    var tirou = false;
    function tirar() {
      if (tirou) return; tirou = true;
      caixa.classList.add('saindo');
      setTimeout(function () { if (caixa.parentNode) caixa.parentNode.removeChild(caixa); }, 320);
    }
    setTimeout(tirar, 6000);
    return tirar;
  }

  /* Tela de carregamento das lojas comuns: so o fundo da pagina e tres bolinhas iguais na cor da loja.
     A cor e a da ultima visita (ou do quadro de lojas); loja nunca vista usa cinza neutro. */
  var CHAVE_CORES = 'ligeiro:cores';
  function lembrarCor(slug, cor, soSeNaoTiver) {
    if (!slug || !corValida(cor)) return;
    var mapa = lerLocal(CHAVE_CORES) || {};
    if (mapa[slug] === cor || (soSeNaoTiver && mapa[slug])) return;
    delete mapa[slug];
    mapa[slug] = cor;
    var chaves = Object.keys(mapa);
    while (chaves.length > 80) delete mapa[chaves.shift()];
    guardarLocal(CHAVE_CORES, mapa);
  }
  function splashLoja(slug) {
    var cor = (lerLocal(CHAVE_CORES) || {})[slug];
    var caixa = el('div', { class: 'splash-loja', role: 'status', 'aria-label': 'Abrindo a loja' }, [
      el('div', { class: 'carregando-pontos' }, [el('span'), el('span'), el('span')]),
    ]);
    if (corValida(cor)) caixa.style.setProperty('--cor-bolinha', cor);
    document.body.appendChild(caixa);
    var tirou = false;
    function tirar() {
      if (tirou) return; tirou = true;
      caixa.classList.add('saindo');
      setTimeout(function () { if (caixa.parentNode) caixa.parentNode.removeChild(caixa); }, 280);
    }
    setTimeout(tirar, 6000);
    /* a cor certa chega junto com os dados da loja: pinta as bolinhas na hora (primeira visita comeca cinza) */
    tirar.pintar = function (c) { if (corValida(c)) caixa.style.setProperty('--cor-bolinha', c); };
    return tirar;
  }
  /* Espera as imagens de um pedaco da tela (logo, capa) terminarem, no maximo 'teto' ms.
     Foto com loading="lazy" (fora da tela) nao entra: ela so baixa quando aparece e seguraria a espera a toa. */
  function imagensProntas(raiz, teto) {
    var imgs = raiz ? [].slice.call(raiz.querySelectorAll('img')).filter(function (i) { return i.loading !== 'lazy'; }) : [];
    var todas = Promise.all(imgs.map(function (i) {
      if (i.complete) return true;
      return new Promise(function (r) { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); });
    }));
    return Promise.race([todas, new Promise(function (r) { setTimeout(r, teto || 2500); })]);
  }

  var temaPronto = Promise.resolve(true);
  /* Loja oficial do Ligeiro (config.lojasOficiais): devolve a configuracao ou null. */
  function lojaOficial(slug) {
    var cfg = window.LIGEIRO_CONFIG || {};
    return (cfg.lojasOficiais || {})[slug] || null;
  }
  function ehOficial(slug) { var o = lojaOficial(slug); return !!(o && o.oficial !== false); }
  /* Liga o tema exclusivo da loja oficial num pedaco da tela (site, painel, cozinha, entregador, balcao). */
  function aplicarTemaOficial(raiz, slug) {
    var o = lojaOficial(slug);
    if (!o || !o.tema || !raiz) return null;
    var src = (document.querySelector('script[src*="js/ui.js"]') || {}).src || '';
    var tag = (src.match(/\?v=([0-9a-z]+)/) || [])[1] || '1';
    temaPronto = carregarCss('css/temas/' + o.tema + '.css?v=' + tag);
    raiz.classList.add('tema-' + o.tema, 'loja-oficial');
    /* as janelas (modal) moram fora da tela da loja: levam o tema junto, senao abriam no visual padrao */
    var modal = document.getElementById('modal');
    if (modal) modal.classList.add('tema-' + o.tema);
    return o;
  }
  /* Tudo que o visual da loja oficial precisa pra aparecer inteiro: folha do tema, letras e imagens da marca.
     Espera no minimo 'minimo' ms (a tela de carregamento nao pisca) e no maximo 4 s (internet ruim nao prende ninguem). */
  function oficialPronto(o, minimo) {
    var espera = new Promise(function (r) { setTimeout(r, minimo || 0); });
    if (!o || !o.tema) return Promise.all([temaPronto, espera]);
    var letras = temaPronto.then(function () {
      if (!document.fonts || !document.fonts.load) return true;
      return Promise.all((o.fontes || []).map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    });
    var imagens = [o.logo, o.ilustracao].filter(Boolean).map(function (src) {
      return new Promise(function (r) { var i = new Image(); i.onload = i.onerror = function () { r(true); }; i.src = src; });
    });
    var tudo = Promise.all([temaPronto, letras, espera].concat(imagens));
    var teto = new Promise(function (r) { setTimeout(r, 4000); });
    return Promise.race([tudo, teto]);
  }
  /* Tela de carregamento do Ligeiro nos paineis (painel, cozinha, entregador, Central): fundo branco, mascote
     pulsando, "Ligeiro" e tres bolinhas nas cores da marca. Fica no minimo 0,5 s pra nao piscar. */
  function splashLigeiro() {
    var tirar = splashOficial({ ligeiro: true, corFundo: '#FFFFFF', logo: 'img/mascote.webp' });
    var inicio = Date.now();
    return function () { setTimeout(tirar, Math.max(0, 500 - (Date.now() - inicio))); };
  }
  /* tira a tela quando a tela de baixo ganhar conteudo (login, painel ou aviso de erro) */
  function tirarQuandoMontar(raiz, tirar) {
    if (!raiz || !window.MutationObserver) { setTimeout(tirar, 800); return; }
    var obs = new MutationObserver(function () { if (raiz.children.length) { obs.disconnect(); tirar(); } });
    obs.observe(raiz, { childList: true });
  }
  /* Telas internas (painel, cozinha, entregador): loja oficial com tema cedo e a tela dela; as outras com a do Ligeiro. */
  function abrirOficialCedo(raiz, slug) {
    var o = lojaOficial(slug);
    if (!o || !o.tema) { tirarQuandoMontar(raiz, splashLigeiro()); return; }
    aplicarTemaOficial(raiz, slug);
    var tirar = splashOficial(o);
    oficialPronto(o, 500).then(tirar);
  }
  /* Selo de loja verificada pelo Ligeiro (campo "verificada", que so o admin liga). */
  function seloVerificada(loja, classe) {
    if (!loja) return null;
    var oficial = ehOficial(loja.slug);
    if (!oficial && loja.verificada !== true) return null;
    /* o mesmo selo verde vale pra loja oficial do Ligeiro e pra loja verificada pelo admin */
    var rotulo = oficial ? 'Loja oficial do Ligeiro' : 'Loja verificada pelo Ligeiro';
    return el('img', { class: 'selo-verificada' + (classe ? ' ' + classe : ''), src: 'img/selo-verificado.svg', alt: rotulo, title: rotulo });
  }
  function limparTemaOficial(raiz) {
    if (raiz) raiz.className = raiz.className.replace(/\btema-[a-z0-9-]+\b|\bloja-oficial\b/g, '').replace(/\s+/g, ' ').trim();
    var modal = document.getElementById('modal');
    if (modal) Array.prototype.slice.call(modal.classList).forEach(function (c) { if (c.indexOf('tema-') === 0) modal.classList.remove(c); });
  }

  /* largura da tela SEM a barra de rolagem (no Windows ela ocupa uns 15px): faixa de ponta a ponta nao passa da tela */
  (function () {
    var raiz = document.documentElement;
    function medir() { raiz.style.setProperty('--vw', raiz.clientWidth + 'px'); }
    medir();
    if (window.ResizeObserver) new ResizeObserver(medir).observe(raiz); else window.addEventListener('resize', medir);
  })();

  /* espera com o mascote: ele pula de leve, as tres bolinhas do Ligeiro andam e o texto diz o que esta acontecendo.
     Surge depois de um instante (quem abre rapido nem ve piscar) */
  function carregandoMascote(texto) {
    return el('div', { class: 'espera-mascote', role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'espera-mascote-palco', 'aria-hidden': 'true' }, [
        el('img', { class: 'espera-mascote-img', src: 'img/mascote-192.webp', alt: '', width: '112', height: '112' }),
        el('span', { class: 'espera-mascote-sombra' }),
      ]),
      el('div', { class: 'carregando-pontos', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
      el('p', { class: 'espera-mascote-texto', text: texto || 'Só um instante…' }),
    ]);
  }

  /* icones de traco do topo da Central (o mesmo desenho do topo do painel; a cor vem do texto do botao) */
  var ICONES_TRACO = {
    atualizar: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2"/><path d="M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2"/><path d="M20 19v-4h-4"/>',
    site: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>',
    sair: '<path d="M10 4H5.5v16H10"/><path d="M14.5 8 18.5 12l-4 4"/><path d="M18.5 12H9"/>',
    dinheiro: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01"/><path d="M17.5 14.5v.01"/>',
    alerta: '<path d="M10.3 4.4 2.9 17.5a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 10v4"/><path d="M12 17.3v.01"/>',
    ampulheta: '<path d="M6.5 3.5h11"/><path d="M6.5 20.5h11"/><path d="M8 3.5v2.3a4 4 0 0 0 1.6 3.2L12 11l2.4-2a4 4 0 0 0 1.6-3.2V3.5"/><path d="M8 20.5v-2.3a4 4 0 0 1 1.6-3.2L12 13l2.4 2a4 4 0 0 1 1.6 3.2v2.3"/>',
    telefone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    ferramenta: '<path d="M7 10h3V7L6.5 3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8L7 10"/>',
    check: '<path d="M5 12.5 10 17.5 19 7"/>',
    feito: '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.8 2.8 5.4-5.6"/>',
    pendente: '<circle cx="12" cy="12" r="9"/>',
    lista: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9.5 4V3h5v1"/><path d="M8.5 10h7"/><path d="M8.5 13.5h7"/><path d="M8.5 17h4"/>',
    cardapio: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    vendas: '<path d="M4 20h16"/><rect x="5.5" y="12" width="3" height="5" rx="1"/><rect x="10.5" y="8" width="3" height="9" rx="1"/><rect x="15.5" y="4.5" width="3" height="12.5" rx="1"/>',
    ajustes: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
    loja: '<path d="M4 10v10h16V10"/><path d="M2.5 10 5 4h14l2.5 6z"/><path d="M10 20v-5h4v5"/>',
    busca: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
    imprimir: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
    raio: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
    recibo: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8.5h6"/><path d="M9 12.5h6"/>',
    nota: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8.5 12.5h7"/><path d="M8.5 16h5"/>',
    lapis: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
    lixeira: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5"/><path d="M14 11v5.5"/>',
    imagem: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-5 4 4 2.5-2.5L20 17"/>',
    sorriso: '<circle cx="12" cy="12" r="8.5"/><path d="M8.8 14a4 4 0 0 0 6.4 0"/><path d="M9.5 10v.01"/><path d="M14.5 10v.01"/>',
    camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    copiar: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    texto: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h6"/><path d="M9 15.5h6"/>',
    chave: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2 2"/>',
    chef: '<path d="M8 17.5h8"/><path d="M8 20.5h8"/><path d="M8 17.5v-3.2A4 4 0 0 1 7.3 6.6a5 5 0 0 1 9.4 0 4 4 0 0 1-.7 7.7v3.2"/>',
    cartao: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M7 14.5h4"/>',
    maquininha: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><rect x="8.5" y="5" width="7" height="4.5" rx="1"/><path d="M9.5 13h.01"/><path d="M12 13h.01"/><path d="M14.5 13h.01"/><path d="M9.5 16.5h.01"/><path d="M12 16.5h.01"/><path d="M14.5 16.5h.01"/>',
    boleto: '<path d="M4 6v12"/><path d="M7 6v12"/><path d="M10.5 6v12"/><path d="M13 6v12"/><path d="M16.5 6v12"/><path d="M20 6v12"/>',
    presente: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5.5 13v7.5h13V13"/><path d="M12 9v11.5"/><path d="M12 9c-2.5 0-4.5-1-4.5-2.8S9.5 3.8 12 9c2.5-5.2 4.5-4.6 4.5-2.8S14.5 9 12 9z"/>',
    olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    estrela: '<path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.6l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"/>',
    subir: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    descer: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
    tocar: '<path d="M8 5.5v13l10.5-6.5z"/>',
    desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    abrir: '<path d="m6 9 6 6 6-6"/>',
    avancar: '<path d="m9 6 6 6-6 6"/>',
    fechar: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
    fogo: '<path d="M12 21a6 6 0 0 0 6-6c0-3.6-2.4-5.4-3.6-8.2-.7 1.8-1.8 2.9-2.9 3.4C11.3 7.6 10.4 5.3 11.6 3 7.9 4.6 6 8.6 6 12.4V15a6 6 0 0 0 6 6z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.6 1.3-2.4 2.5-4 1.2 1.6 2.5 2.4 2.5 4A2.5 2.5 0 0 1 12 21z"/>',
    escudo: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    cadeado: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    cupom: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z"/><path d="M14.5 6.5v2"/><path d="M14.5 11v2"/><path d="M14.5 15.5v2"/>',
    sino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    semsino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>',
    celular: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/><path d="M3.5 9v6"/><path d="M20.5 9v6"/>',
    entrega: '<circle cx="6" cy="17" r="2.8"/><circle cx="18" cy="17" r="2.8"/><path d="M8.8 17h6.4"/><path d="M18 17 15.5 8h-2.5"/><path d="M15.9 9.6 11.5 14H8.8"/><rect x="3" y="7" width="6.5" height="5" rx="1.2"/>',
    retirada: '<path d="M5.5 8.5h13l-1 12h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    balcao: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8.5h6"/><path d="M9 12.5h6"/>',
    mapa: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  };
  function iconeTraco(nome) { return el('span', { class: 'topo-ico', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + (ICONES_TRACO[nome] || '') + '</svg>' }); }
  /* o icone como texto, para as telas montadas em texto (index do cliente) */
  function iconeHtml(nome) { return '<span class="ico-traco" aria-hidden="true"><svg viewBox="0 0 24 24">' + (ICONES_TRACO[nome] || '') + '</svg></span>'; }
  /* o mesmo icone de traco dentro de botao ou selo (o tamanho vem do lugar) */
  function iconeLinha(nome) { return el('span', { class: 'ico-traco', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + (ICONES_TRACO[nome] || '') + '</svg>' }); }
  /* selo do tipo do pedido (painel, cozinha): Entrega, Retirada ou Balcao, com icone de traco */
  function seloTipo(p) {
    var tipo = p.tipoEntrega === 'entrega' ? 'entrega' : (p.origem === 'balcao' ? 'balcao' : 'retirada');
    return el('span', { class: 'selo cinza selo-tipo' }, [iconeLinha(tipo), { entrega: 'Entrega', balcao: 'Balcão', retirada: 'Retirada' }[tipo]]);
  }

  /* Dentro do Instagram ou do Facebook o Google nao deixa entrar. O aviso vem ANTES (no cadastro, o que foi digitado
     ali se perderia ao trocar de navegador). Android: um toque abre o Chrome direto na tela certa (?ir=, ver app.js);
     iPhone: o caminho dos tres pontinhos. Fora de app (ou na demonstracao), nada. */
  function avisoNavegadorDeApp(rota) {
    var D = window.LigeiroDados;
    if (!D || D.modoDemo || !D.navegadorDeApp || !D.navegadorDeApp()) return null;
    var ua = navigator.userAgent || '';
    var android = /Android/i.test(ua);
    var app = /Instagram/i.test(ua) ? 'do Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'do Facebook' : 'de outro app';
    var alvo = location.host + location.pathname + '?ir=' + encodeURIComponent(rota);
    return el('div', { class: 'aviso aviso-falta aviso-app' }, [
      iconeLinha('alerta'),
      el('div', { class: 'aviso-app-texto' }, [
        el('b', { text: 'Abra no navegador para continuar' }),
        el('span', { text: 'Por dentro ' + app + ' o Google não deixa entrar. ' + (android ? 'Toque no botão e continue no Chrome, na mesma tela.' : 'Toque nos três pontinhos lá em cima e escolha "Abrir no navegador".') }),
        android ? el('a', { class: 'btn btn-principal btn-largo', href: 'intent://' + alvo + '#Intent;scheme=https;package=com.android.chrome;end' }, [iconeLinha('site'), 'Abrir no Chrome']) : null,
      ]),
    ]);
  }

  /* faixa do painel, cozinha e entregas quando o banco gratis chega no limite do dia (uma so, fica ate recarregar) */
  function faixaLimite(raiz) {
    if (!raiz || raiz.querySelector('.faixa-limite')) return;
    var topo = raiz.querySelector('.painel-topo');
    var faixa = el('div', { class: 'faixa-limite', role: 'alert' }, [
      el('b', { text: 'O sistema chegou no limite de hoje.' }),
      el('span', { text: ' Os clientes estão mandando os pedidos pelo WhatsApp da loja até de madrugada: fique de olho nele.' }),
    ]);
    if (topo && topo.nextSibling) raiz.insertBefore(faixa, topo.nextSibling); else raiz.insertBefore(faixa, raiz.firstChild);
    soar('erro');
  }

  /* logo do WhatsApp ou do Instagram para ir dentro de botao (a cor vem do texto do botao) */
  function icone(nome) { return el('span', { class: 'icone-' + nome, 'aria-hidden': 'true' }); }

  window.LigeiroUI = {
    $: $, el: el, limpar: limpar, icone: icone, faixaLimite: faixaLimite, iconeTraco: iconeTraco, iconeLinha: iconeLinha, iconeHtml: iconeHtml, avisoNavegadorDeApp: avisoNavegadorDeApp, seloTipo: seloTipo, carregandoMascote: carregandoMascote,
    guardarLocal: guardarLocal, lerLocal: lerLocal, erroCarregar: erroCarregar, carregarCss: carregarCss, lojaOficial: lojaOficial, ehOficial: ehOficial, aplicarTemaOficial: aplicarTemaOficial, seloVerificada: seloVerificada, splashOficial: splashOficial, splashLigeiro: splashLigeiro, splashLoja: splashLoja, lembrarCor: lembrarCor, imagensProntas: imagensProntas, oficialPronto: oficialPronto, abrirOficialCedo: abrirOficialCedo, temaPronto: function () { return temaPronto; }, limparTemaOficial: limparTemaOficial,
    avisar: avisar, soar: soar, somLigado: somLigado, vibrar: vibrar, somTravado: somTravado, somAcabouDeLiberar: somAcabouDeLiberar, quandoLiberarSom: quandoLiberarSom,
    abrirModal: abrirModal, fecharModal: fecharModal, perguntar: perguntar,
    copiar: copiar,
    horaCurta: horaCurta, dataCurta: dataCurta, tempoRelativo: tempoRelativo, seloHorario: seloHorario,
    centavosDoCampo: centavosDoCampo, mascaraDinheiro: mascaraDinheiro, mascaraTelefone: mascaraTelefone,
    baseUrl: baseUrl, linkDaLoja: linkDaLoja, linkDoBalcao: linkDoBalcao, linkDoPainel: linkDoPainel, linkDoPedido: linkDoPedido,
    medirBarras: medirBarras,
    lerImagem: lerImagem, campoFoto: campoFoto,
    PALETA: PALETA, ESTILOS: ESTILOS, corValida: corValida, corDeTexto: corDeTexto, aplicarTema: aplicarTema, aplicarTemaEm: aplicarTemaEm, varsDoTema: varsDoTema, limparTema: limparTema,
    dinheiro: R.dinheiro,
  };
})();
