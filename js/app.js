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
  try { var cf = JSON.parse(localStorage.getItem('ligeiro:fundadores') || 'null'); window.LigeiroFundadores = { usados: (cf && cf.usados) || 0 }; } catch (_) { window.LigeiroFundadores = { usados: 0 }; }
  if (window.LigeiroDados && window.LigeiroDados.store.obterFundadores) {
    window.LigeiroDados.store.obterFundadores().then(function (f) {
      var antes = window.LigeiroFundadores.usados;
      window.LigeiroFundadores = { usados: f.usados || 0 };
      var p = partes();
      if (antes !== f.usados && (p.length === 0 || p[0] === 'lojas' || p[0] === 'assinar')) render();
    }).catch(function () { /* fica o que tinha */ });
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
  }

  render();
})();
