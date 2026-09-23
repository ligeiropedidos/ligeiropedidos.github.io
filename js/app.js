/*
 * Ligeiro - roteador: decide qual tela abrir a partir do endereco.
 *
 *   #/                      hub (escolher a cidade)
 *   #/juquia                lojas de Juquia
 *   #/juquia/dom-conizza    a loja (o cliente pede aqui)
 *   #/juquia/dom-conizza/pedido/<id>   acompanhar um pedido
 *   #/balcao/dom-conizza    modo balcao (tablet no caixa)
 *   #/painel/dom-conizza    painel do dono
 *   #/cozinha/dom-conizza   tela da cozinha (so o que tem pra fazer)
 *   #/entrega/dom-conizza   tela do entregador (endereco, mapa, o que cobrar)
 *   #/admin                 cadastro de estabelecimentos (Ligeiro)
 *   #/lojas                 pagina de vendas pro dono de lanchonete
 *   #/comecar               o dono cria a propria loja
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var limparTelaAtual = null;

  function partes() {
    var hash = location.hash.replace(/^#\/?/, '');
    return hash.split('/').map(function (p) { try { return decodeURIComponent(p).trim(); } catch (_) { return p.trim(); } }).filter(Boolean);
  }

  /* Medicao de visitas, so se o Ligeiro colocou o token (config.analytics.cloudflareToken). */
  (function () {
    var an = (window.LIGEIRO_CONFIG || {}).analytics || {};
    if (!an.cloudflareToken || location.protocol === 'file:') return;
    var sc = document.createElement('script');
    sc.defer = true;
    sc.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    sc.setAttribute('data-cf-beacon', JSON.stringify({ token: an.cloudflareToken, spa: true }));
    document.head.appendChild(sc);
  })();

  function ir(caminho) { location.hash = '#/' + caminho.replace(/^\/+/, ''); }

  /* Codigo do dono (painel, Central, cozinha e entregador, conta, crie sua loja): so baixa quando uma dessas telas abre.
     Quem so pede no site da loja nao baixa nada disso. Os arquivos baixam juntos e rodam na ordem da lista. */
  var TAG = ((((document.querySelector('script[src*="js/app.js"]') || {}).src) || '').match(/\?v=([0-9a-z]+)/) || [])[1] || '1';
  var GRUPO_DONO = ['js/seed.js', 'js/mp.js', 'js/cobranca.js', 'js/painel.js', 'js/admin.js', 'js/equipe.js', 'js/conta.js', 'js/comecar.js'];
  var ROTAS_DONO = ['comecar', 'conta', 'admin', 'painel', 'cozinha', 'entrega', 'balcao'];
  var donoPronto = null, donoCarregado = false;
  function carregarDono() {
    if (donoPronto) return donoPronto;
    donoPronto = Promise.all(GRUPO_DONO.map(function (src) {
      if (document.querySelector('script[src^="' + src + '"]')) return Promise.resolve(); /* ja veio no index (copia de teste) */
      return new Promise(function (ok, falhou) {
        var s = document.createElement('script');
        s.src = src + '?v=' + TAG;
        s.async = false;
        s.onload = ok;
        s.onerror = function () { falhou(new Error('Não carregou ' + src)); };
        document.body.appendChild(s);
      });
    })).then(function () { donoCarregado = true; }, function (e) { donoPronto = null; throw e; });
    return donoPronto;
  }

  function render() {
    if (typeof limparTelaAtual === 'function') { try { limparTelaAtual(); } catch (_) { /* ignora */ } }
    limparTelaAtual = null;
    UI.fecharModal();
    window.scrollTo(0, 0);

    var raiz = UI.$('app');
    UI.limpar(raiz);
    raiz.className = 'app';
    document.body.classList.remove('balcao');
    document.documentElement.style.setProperty('--altura-barra', '0px');

    var p = partes();
    ajustarManifest(p);
    /* tela do dono e o codigo dele ainda nao veio: bolinhas do Ligeiro ate chegar (aparecem so se demorar) */
    if (ROTAS_DONO.indexOf(p[0]) >= 0 && !donoCarregado) {
      raiz.appendChild(UI.el('div', { class: 'conta-carregando', role: 'status', 'aria-label': 'Carregando' }, UI.el('div', { class: 'carregando-pontos' }, [UI.el('span'), UI.el('span'), UI.el('span')])));
      var pedido = location.hash;
      carregarDono().then(function () { if (location.hash === pedido) render(); }, function () {
        if (location.hash !== pedido) return;
        UI.limpar(raiz);
        raiz.appendChild(UI.erroCarregar('Não deu para abrir esta tela.', function () { render(); }));
      });
      return;
    }
    /* paginas de venda: o dono chega por aqui; o codigo dele vem em segundo plano, depois que a pagina aparece */
    if (!donoCarregado && (p.length === 0 || ['lojas', 'assinar', 'entrar'].indexOf(p[0]) >= 0)) {
      setTimeout(function () { carregarDono().catch(function () { /* tenta de novo quando precisar */ }); }, 2500);
    }
    var C = window.LigeiroCliente;
    var P = window.LigeiroPainel;
    var A = window.LigeiroAdmin;
    var E = window.LigeiroEquipe;

    /* pagina inicial = pagina de vendas; as cidades ficam em #/cidades */
    if (p.length === 0) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.abrir(raiz); return; }
    if (p[0] === 'cidades' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = C.hub(raiz); return; }
    if (p[0] === 'comecar' && p.length <= 3) { limparTelaAtual = window.LigeiroComecar.abrir(raiz, { plano: p[1], tipo: p[2] }); return; }
    if (p[0] === 'lojas' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.abrir(raiz); return; }
    if (p[0] === 'assinar' && p.length <= 3) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.assinar(raiz, p[1], p[2]); return; }
    if (p[0] === 'entrar' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.entrar(raiz); return; }
    if (p[0] === 'conta' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroConta.abrir(raiz); return; }
    if (p[0] === 'termos' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.termos(raiz); return; }
    if (p[0] === 'privacidade' && p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = window.LigeiroParceiro.privacidade(raiz); return; }
    if (p[0] === 'admin') { raiz.className = 'app larga'; limparTelaAtual = A.abrir(raiz); return; }
    if (p[0] === 'painel' && p[1]) { raiz.className = 'app larga'; limparTelaAtual = P.abrir(raiz, p[1]); return; }
    if (p[0] === 'cozinha' && p[1]) { raiz.className = 'app larga'; limparTelaAtual = E.abrirCozinha(raiz, p[1]); return; }
    if (p[0] === 'entrega' && p[1]) { limparTelaAtual = E.abrirEntrega(raiz, p[1]); return; }
    if (p[0] === 'balcao' && p[1]) { limparTelaAtual = E.abrirBalcao(raiz, p[1]); return; }
    /* tela de equipe sem a loja: volta pro inicio (nao vira "cidade") */
    if (['painel', 'cozinha', 'entrega', 'balcao'].indexOf(p[0]) >= 0 && p.length === 1) { location.replace('#/'); return; }
    if (p.length === 1) { raiz.className = 'app larga'; limparTelaAtual = C.cidade(raiz, p[0]); return; }
    if (p.length >= 4 && p[2] === 'pedido') { limparTelaAtual = C.loja(raiz, p[1], { pedidoId: p[3], cidadeSlug: p[0] }); return; }
    limparTelaAtual = C.loja(raiz, p[1], { cidadeSlug: p[0] });
  }

  /*
   * "Adicionar a tela inicial" no painel, cozinha, entregador ou balcao abre
   * direto nessa tela (e nao no hub): o manifesto e trocado conforme a rota.
   */
  var manifestPadrao = document.querySelector('link[rel="manifest"]');
  var manifestAtual = '';
  function ajustarManifest(p) {
    if (!manifestPadrao) return;
    var telas = { painel: 'Painel', cozinha: 'Cozinha', entrega: 'Entregas', balcao: 'Balcão' };
    var chave = telas[p[0]] && p[1] ? p[0] + '/' + p[1] : '';
    if (chave === manifestAtual) return;
    manifestAtual = chave;
    if (!chave) { manifestPadrao.href = 'manifest.webmanifest'; return; }
    var manifesto = {
      name: 'Ligeiro ' + telas[p[0]], short_name: telas[p[0]],
      start_url: location.origin + location.pathname + '#/' + chave, scope: location.origin + location.pathname,
      display: 'standalone', background_color: '#FAFDF6', theme_color: '#0F3D2E', lang: 'pt-BR',
      icons: [{ src: new URL('icone-192.png', location.href).href, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: new URL('icone-512.png', location.href).href, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    };
    try {
      if (manifestPadrao.href && manifestPadrao.href.indexOf('blob:') === 0) URL.revokeObjectURL(manifestPadrao.href);
      manifestPadrao.href = URL.createObjectURL(new Blob([JSON.stringify(manifesto)], { type: 'application/manifest+json' }));
    } catch (_) { /* ignora */ }
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('resize', UI.medirBarras);

  window.LigeiroApp = { ir: ir, render: render, partes: partes };

  /* vagas de fundador: valor guardado neste aparelho na hora; o numero de verdade chega em seguida e, se mudou, redesenha a pagina de vendas */
  try { var cf = JSON.parse(localStorage.getItem('ligeiro:fundadores') || 'null'); window.LigeiroFundadores = { usados: (cf && cf.usados) || 0, capacidade: (cf && cf.capacidade) || null }; } catch (_) { window.LigeiroFundadores = { usados: 0, capacidade: null }; }
  /* so quem vende ou administra precisa do numero (pagina de vendas, assinar, conta, painel, Central). A loja do cliente
     e o hub nao leem nada: eram ~2% das leituras do dia. Busca uma vez, quando entrar numa dessas telas. */
  var ROTAS_COM_VAGAS = ['lojas', 'assinar', 'comecar', 'conta', 'admin', 'painel', 'entrar'];
  var vagasBuscadas = false;
  function buscarVagas() {
    var p = partes();
    /* telas do dono e do admin usam o banco (e o login do Google tem que estar pronto no toque): ja comeca a baixar */
    if (p.length && ROTAS_COM_VAGAS.indexOf(p[0]) >= 0 && window.LigeiroDados.store.aquecer) window.LigeiroDados.store.aquecer();
    if (vagasBuscadas || !p.length || ROTAS_COM_VAGAS.indexOf(p[0]) < 0) return;
    vagasBuscadas = true;
    window.LigeiroDados.store.obterFundadores().then(function (f) {
      if (!f) return; /* nao deu para ler: fica o que tinha */
      var antes = window.LigeiroFundadores.usados;
      var fechadoAntes = window.LigeiroRegras.capacidadeLojas().fechado;
      window.LigeiroFundadores = { usados: f.usados || 0, capacidade: f.capacidade || null };
      var p = partes();
      /* vagas de fundador ou de loja mudaram: redesenha as paginas de venda (o cadastro confere sozinho ao abrir) */
      var mudou = antes !== f.usados || fechadoAntes !== window.LigeiroRegras.capacidadeLojas().fechado;
      if (mudou && (p[0] === 'lojas' || p[0] === 'assinar')) render();
    }).catch(function () { vagasBuscadas = false; /* tenta de novo na proxima tela */ });
  }
  if (window.LigeiroDados && window.LigeiroDados.store.obterFundadores) {
    buscarVagas();
    window.addEventListener('hashchange', buscarVagas);
  }

  /* Modo demonstracao: avisa em cima de tudo. */
  if (window.LigeiroDados.modoDemo) {
    var faixa = document.createElement('div');
    faixa.className = 'faixa-teste';
    faixa.textContent = 'MODO DEMONSTRAÇÃO — os dados ficam só neste aparelho';
    document.body.insertBefore(faixa, document.body.firstChild);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sem cache offline, segue normal */ });
    });
    /* tocou no aviso com o site ja aberto: vai para a tela do aviso (pedido do cliente, painel, cozinha) */
    navigator.serviceWorker.addEventListener('message', function (e) {
      var ir = e.data && e.data.ligeiroIr;
      if (typeof ir === 'string' && ir.charAt(0) === '#' && location.hash !== ir) location.hash = ir;
    });
  }

  /* Versao nova no ar? Ao abrir o site, confere o index.html direto na rede; se o numero mudou, recarrega uma vez.
     Assim ninguem fica preso na versao antiga (celular segura cache por varios minutos). */
  (function () {
    if (location.protocol === 'file:' || !window.fetch) return;
    var meu = ((document.querySelector('script[src*="js/app.js"]') || {}).src || '').match(/\?v=([0-9a-z]+)/);
    if (!meu) return;
    fetch('index.html?agora=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
      var novo = html.match(/js\/app\.js\?v=([0-9a-z]+)/);
      if (!novo || novo[1] === meu[1]) return;
      var ja = null; try { ja = sessionStorage.getItem('ligeiro:recarregou'); } catch (_) { /* ignora */ }
      if (ja === novo[1]) return; /* ja tentou pra esta versao: nao entra em laco */
      try { sessionStorage.setItem('ligeiro:recarregou', novo[1]); } catch (_) { return; }
      var limpar = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
      limpar.catch(function () {}).then(function () { location.reload(); });
    }).catch(function () { /* sem internet: segue com o que tem */ });
  })();

  render();
})();
