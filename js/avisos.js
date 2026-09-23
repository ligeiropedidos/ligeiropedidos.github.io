/*
 * Ligeiro - avisos no celular (Web Push): chegam com a tela apagada e o site fechado, como mensagem de aplicativo.
 * Quem manda e o mensageiro (Cloudflare, rotas /aparelho, /novo, /inscrever e /avisar). O banco nao gasta nada:
 * os aparelhos da loja ficam no Cloudflare e o aviso do cliente vai dentro do proprio pedido.
 * iPhone: so com o site na tela de inicio (regra da Apple). Na copia de demonstracao tudo e simulado.
 */
(function () {
  'use strict';

  function cfg() { return window.LIGEIRO_CONFIG || {}; }
  function demo() { return !cfg().firebase; }
  function base() { var c = cfg(); return c.firebase && c.proxyMercadoPago ? String(c.proxyMercadoPago).replace(/\/$/, '') : ''; }
  function ler(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function guardar(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* ignora */ } }
  function ehIOS() { var ua = navigator.userAgent || ''; return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function instalado() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function temPush() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  /* iPhone antes do iOS 16.4 nao recebe aviso de site nem na tela de inicio */
  function iosAntigo() { var m = /OS (\d+)_(\d+)/.exec(navigator.userAgent || ''); return !!m && (Number(m[1]) < 16 || (Number(m[1]) === 16 && Number(m[2]) < 4)); }

  /* o mensageiro ja tem os avisos? (a chave dele ja veio uma vez). Ate confirmar, nenhum botao de aviso aparece */
  var chaveOk = false;
  try { chaveOk = !!JSON.parse(ler('ligeiro:vapid') || 'null'); } catch (_) { chaveOk = false; }

  /* 'pronto': da para ligar | 'instalar': iPhone fora da tela de inicio | 'bloqueado': negou antes | 'sem': nao tem */
  function situacao() {
    if (demo()) return 'pronto';
    if (!base() || !chaveOk) return 'sem';
    if (ehIOS() && iosAntigo()) return 'sem';
    if (ehIOS() && !instalado()) return 'instalar';
    if (!temPush()) return 'sem';
    if (Notification.permission === 'denied') return 'bloqueado';
    return 'pronto';
  }
  var MOTIVOS = {
    instalar: 'No iPhone, os avisos só funcionam com o Ligeiro na tela de início.',
    bloqueado: 'Os avisos estão bloqueados neste navegador. Libere em Configurações do site, Notificações.',
    fechou: 'Sem a sua permissão não dá para avisar. Toque de novo e escolha Permitir.',
    falhou: 'Não deu para ligar os avisos neste aparelho agora. Tente de novo daqui a pouco.',
    sem: 'Este navegador não recebe avisos. Use o Chrome no Android ou o Ligeiro na tela de início do iPhone.',
  };
  function erro(motivo) { var e = new Error(MOTIVOS[motivo] || MOTIVOS.sem); e.motivo = motivo; return e; }
  function simplificar(e) { return e && (e.motivo || e.nossa) ? e : erro('falhou'); }
  function nossa(texto) { var e = new Error(texto); e.nossa = true; return e; }
  /* o service worker que nao instalou (internet fraca) deixaria o botao em "Ligando..." para sempre */
  function swPronto() {
    return Promise.race([navigator.serviceWorker.ready, new Promise(function (_, nao) { setTimeout(function () { nao(erro('falhou')); }, 8000); })]);
  }

  /* confere uma vez se o mensageiro ja tem os avisos (mensageiro antigo ou sem KV: continua tudo escondido) */
  var conferindo = null;
  function preparar() {
    if (demo() || chaveOk || !base()) return Promise.resolve(situacao());
    if (!conferindo) conferindo = chaveVapid().then(function () { chaveOk = true; }, function () { /* segue escondido */ });
    return conferindo.then(situacao);
  }
  function chaveVapid() {
    var g = null;
    try { g = JSON.parse(ler('ligeiro:vapid') || 'null'); } catch (_) { g = null; }
    if (g && g.chave && Date.now() - g.em < 24 * 3600 * 1000) return Promise.resolve(g.chave);
    return fetch(base() + '/vapid').then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      if (!j || !j.chave) throw erro('sem');
      guardar('ligeiro:vapid', JSON.stringify({ chave: j.chave, em: Date.now() }));
      return j.chave;
    });
  }
  function bytes(b64) {
    var t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    t += '==='.slice((t.length + 3) % 4);
    var bin = atob(t), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pedirPermissao() {
    if (Notification.permission === 'granted') return Promise.resolve(true);
    return new Promise(function (ok) {
      var feito = false;
      var fim = function (x) { if (!feito) { feito = true; ok(x === 'granted'); } };
      try { var p = Notification.requestPermission(fim); if (p && p.then) p.then(fim, function () { fim('denied'); }); } catch (_) { fim('denied'); }
    });
  }
  /* a inscricao deste navegador (uma nova se a chave do Ligeiro mudou) */
  function inscricao(nova) {
    return Promise.all([swPronto(), chaveVapid()]).then(function (r) {
      var reg = r[0], chave = r[1];
      return reg.pushManager.getSubscription().then(function (atual) {
        if (atual && !nova && ler('ligeiro:vapid-usada') === chave) return atual;
        return (atual ? atual.unsubscribe().catch(function () { /* segue */ }) : Promise.resolve()).then(function () {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(chave) });
        }).then(function (s) { guardar('ligeiro:vapid-usada', chave); return s; });
      });
    });
  }
  function simples(s) { var j = s.toJSON ? s.toJSON() : s; return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }; }
  function postar(caminho, corpo, idToken) {
    var cab = { 'Content-Type': 'application/json' };
    if (idToken) cab.Authorization = 'Bearer ' + idToken;
    return fetch(base() + caminho, { method: 'POST', keepalive: true, headers: cab, body: JSON.stringify(corpo) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  function token() { var s = window.LigeiroDados && window.LigeiroDados.store; return s && s.obterIdToken ? s.obterIdToken() : Promise.reject(new Error('Entre na sua conta primeiro.')); }

  /* ================= aparelhos da loja (painel, cozinha, entregas) ================= */
  function chaveAparelho(slug, papel) { return 'ligeiro:avisos:' + slug + ':' + papel; }
  function aparelhoLigado(slug, papel) {
    if (ler(chaveAparelho(slug, papel)) !== '1') return false;
    return demo() || (temPush() && Notification.permission === 'granted');
  }
  function enviarAparelho(slug, papel, testar, nova) {
    var sub = null;
    return inscricao(nova).then(function (s) {
      sub = s;
      return token().then(function (t) { return postar('/aparelho', { loja: slug, papel: papel, inscricao: simples(s), testar: !!testar }, t); });
    }).then(function (j) {
      /* o teste nao chegou: inscricao velha (404/410) ou chave do Ligeiro nova (403). Inscreve de novo, uma vez */
      if (j.ok && testar && !nova && (j.teste === 403 || j.teste === 404 || j.teste === 410)) {
        if (j.teste === 403) guardar('ligeiro:vapid', null);
        return enviarAparelho(slug, papel, testar, true);
      }
      if (!j.ok) throw nossa(j.erro || 'Não deu para ligar os avisos agora. Tente de novo.');
      if (testar && !(j.teste >= 200 && j.teste < 300)) throw nossa('O aviso de teste não chegou. Confira a internet e toque de novo.');
      guardar(chaveAparelho(slug, papel), '1');
      guardar(chaveAparelho(slug, papel) + ':em', String(Date.now()));
      guardar(chaveAparelho(slug, papel) + ':fim', sub.endpoint);
      return j;
    });
  }
  /* liga os avisos deste aparelho e manda um de teste (o dono ve na hora que funciona) */
  function ligarAparelho(slug, papel) {
    if (demo()) { guardar(chaveAparelho(slug, papel), '1'); return Promise.resolve({ ok: true, simulado: true }); }
    var s = situacao();
    if (s !== 'pronto') return Promise.reject(erro(s));
    return pedirPermissao().then(function (sim) {
      if (!sim) throw erro(Notification.permission === 'denied' ? 'bloqueado' : 'fechou');
      return enviarAparelho(slug, papel, true, false);
    }).catch(function (e) { throw simplificar(e); });
  }
  function testarAparelho(slug, papel) {
    if (demo()) return Promise.resolve({ ok: true, simulado: true });
    return enviarAparelho(slug, papel, true, false).catch(function (e) { throw simplificar(e); });
  }
  function desligarAparelho(slug, papel) {
    guardar(chaveAparelho(slug, papel), null);
    if (demo() || !temPush()) return Promise.resolve();
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return null;
      return token().then(function (t) { return postar('/aparelho', { loja: slug, papel: papel, remover: sub.endpoint }, t); });
    }).catch(function () { /* sem internet: o aparelho sai da lista sozinho no primeiro aviso que falhar */ });
  }
  /* ao abrir a tela: confere se continua inscrito. Na hora se o navegador trocou o endereco do aviso;
     senao, no maximo a cada 12 h (sem teste e sem gravar nada no Cloudflare se nada mudou) */
  function conferirAparelho(slug, papel) {
    if (demo() || !aparelhoLigado(slug, papel) || situacao() !== 'pronto') return;
    var em = Number(ler(chaveAparelho(slug, papel) + ':em')) || 0;
    var fim = ler(chaveAparelho(slug, papel) + ':fim') || '';
    swPronto().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (atual) {
      if (atual && atual.endpoint === fim && Date.now() - em < 12 * 3600 * 1000) return null;
      return enviarAparelho(slug, papel, false, false);
    }).catch(function () { /* tenta de novo na proxima vez */ });
  }
  /* tela aberta o dia todo (tablet da cozinha): confere de novo cada vez que ela volta a aparecer */
  var vigiados = {};
  function vigiar(slug, papel) {
    var chave = slug + ':' + papel;
    if (vigiados[chave]) return;
    vigiados[chave] = true;
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') conferirAparelho(slug, papel); });
  }

  /* ================= cliente ================= */
  var CHAVE_CLIENTE = 'ligeiro:avisos-cliente';
  function podeCliente() { return situacao() === 'pronto'; }
  /* ja ligou numa compra anterior e o navegador ainda deixa: vem ligado sozinho */
  function clienteQuer() { return ler(CHAVE_CLIENTE) === '1' && podeCliente() && (demo() || Notification.permission === 'granted'); }
  function clienteNaoQuer() { guardar(CHAVE_CLIENTE, '0'); }
  /* o aviso que vai junto com o pedido (mesma gravacao do pedido: nada a mais no banco).
     pedir: pode abrir a pergunta do navegador (so num toque do cliente) */
  function avisoDoPedido(cidade, loja, pedir) {
    if (demo()) { guardar(CHAVE_CLIENTE, '1'); return Promise.resolve({ demo: true }); }
    if (!podeCliente()) return Promise.reject(erro(situacao()));
    return (pedir ? pedirPermissao() : Promise.resolve(Notification.permission === 'granted')).then(function (sim) {
      if (!sim) throw erro(Notification.permission === 'denied' ? 'bloqueado' : 'fechou');
      return inscricao(false);
    }).catch(function (e) { throw simplificar(e); }).then(function (s) {
      guardar(CHAVE_CLIENTE, '1');
      var x = simples(s);
      return { e: x.endpoint, k: x.keys.p256dh, a: x.keys.auth, u: '#/' + cidade + '/' + loja + '/pedido/' };
    });
  }
  /* depois do pedido feito (tela da senha): 1 gravacao no pedido */
  function ligarNoPedido(cidade, loja, pedidoId) {
    return avisoDoPedido(cidade, loja, true).then(function (aviso) {
      if (demo()) return aviso;
      return postar('/inscrever', { loja: loja, pedido: pedidoId, cidade: cidade, inscricao: { endpoint: aviso.e, keys: { p256dh: aviso.k, auth: aviso.a } } }).then(function (j) {
        if (!j.ok) throw erro('falhou');
        return aviso;
      }, function () { throw erro('falhou'); });
    });
  }

  /* ================= o pedido entrou ou andou ================= */
  /* pedido novo, ja na fila (pago ou para cobrar na entrega): o painel e a cozinha apitam. Nada no banco */
  function pedidoNovo(loja, p) {
    if (!base() || !p || !p.id || p.status !== 'pago') return;
    postar('/novo', { loja: loja, pedido: p.id, resumo: { senha: p.senha, total: p.total, tipoEntrega: p.tipoEntrega, origem: p.origem || '' } }).catch(function () { /* o painel aberto apita do mesmo jeito */ });
  }
  var PARA_CLIENTE = ['pago', 'producao', 'pronto', 'cancelado'];
  /* a loja mudou o status: avisa o cliente (se ele quis), o entregador (saiu) e a cozinha (Pix conferido a mao).
     Resolve com 'sim' (o celular do cliente recebeu), 'nao' (o cliente quis, mas nao chegou) ou '' (nao era para ele). */
  function pedidoAndou(loja, p, status) {
    if (!base() || !p || !p.id) return Promise.resolve('');
    var entrega = p.tipoEntrega === 'entrega';
    var cliente = !!(p.aviso && p.aviso.e) && PARA_CLIENTE.indexOf(status) >= 0;
    if (!cliente && !(status === 'pronto' && entrega) && status !== 'pago') return Promise.resolve('');
    return token().then(function (t) {
      return postar('/avisar', {
        loja: loja, pedido: p.id, status: status, aviso: cliente ? p.aviso : null,
        resumo: { senha: p.senha, total: p.total, tipoEntrega: p.tipoEntrega, origem: p.origem || '', nome: String((p.cliente && p.cliente.nome) || '').split(' ')[0], bairro: entrega && p.endereco ? p.endereco.bairro : '' },
      }, t);
    }).then(function (j) { return !cliente ? '' : (j.cliente >= 200 && j.cliente < 300 ? 'sim' : 'nao'); }).catch(function () { return cliente ? 'nao' : ''; });
  }

  /* ================= telas ================= */
  var TRACO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  /* celular vibrando, de traco (o sino e do apito da tela aberta: os dois lado a lado confundiam) */
  var CELULAR = '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/><path d="M3.5 9v6"/><path d="M20.5 9v6"/>';
  function icone() { return TRACO + CELULAR + '</svg>'; }
  /* iPhone: os 3 passos para por o Ligeiro na tela de inicio (so assim a Apple deixa avisar) */
  function explicarIphone() {
    var UI = window.LigeiroUI, el = UI.el;
    var passo = function (n, icone, texto) {
      return el('li', { class: 'passo-iphone' }, [
        el('span', { class: 'passo-iphone-n', text: String(n) }),
        el('span', { class: 'passo-iphone-ico', 'aria-hidden': 'true', html: TRACO + icone + '</svg>' }),
        el('span', { class: 'passo-iphone-texto' }, texto),
      ]);
    };
    UI.abrirModal({
      titulo: 'Avisos no iPhone', sub: 'A Apple só deixa avisar com o Ligeiro na tela de início.', centro: true, classe: 'modal-iphone',
      corpo: el('ol', { class: 'passos-iphone' }, [
        passo(1, '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>', ['No Safari, toque em ', el('b', { text: 'Compartilhar' }), ' (o quadrado com a seta).']),
        passo(2, '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/>', ['Escolha ', el('b', { text: 'Adicionar à Tela de Início' }), ' e toque em Adicionar.']),
        passo(3, CELULAR, ['Abra o Ligeiro pelo ícone novo e ', el('b', { text: 'ligue os avisos' }), ' por lá.']),
      ]),
      rodape: [el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'Entendi', onclick: UI.fecharModal })],
    });
  }

  window.LigeiroAvisos = {
    icone: icone, explicarIphone: explicarIphone,
    situacao: situacao, preparar: preparar, motivo: function (s) { return MOTIVOS[s] || ''; }, ehIOS: ehIOS, instalado: instalado,
    aparelhoLigado: aparelhoLigado, ligarAparelho: ligarAparelho, testarAparelho: testarAparelho, desligarAparelho: desligarAparelho, conferirAparelho: conferirAparelho, vigiar: vigiar,
    podeCliente: podeCliente, clienteQuer: clienteQuer, clienteNaoQuer: clienteNaoQuer, avisoDoPedido: avisoDoPedido, ligarNoPedido: ligarNoPedido,
    pedidoNovo: pedidoNovo, pedidoAndou: pedidoAndou,
  };
})();
