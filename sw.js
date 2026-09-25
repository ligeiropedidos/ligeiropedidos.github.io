/*
 * Ligeiro - cache leve para o site abrir rapido e aguentar internet fraca.
 * Os pedidos em si nunca passam por aqui (vao direto pro banco de dados).
 */
/* MESMO numero do ?v= do index.html: os dois sobem juntos. */
var VERSAO = 'ligeiro-20260928g';
/* So a casca entra no cache na instalacao; o resto (js/css com ?v=) entra na primeira visita, pela rede.
   O icone de 512 e o mascote em PNG ficam de fora: so servem para instalar na tela de inicio, e o navegador busca
   sozinho quando precisa (antes todo cliente baixava os dois a toa) */
var ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icone-192.png', './img/mascote-192.webp', './img/favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (chaves) {
    return Promise.all(chaves.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Avisos no celular (o mensageiro manda pelo Google ou pela Apple): aparecem com a tela apagada e o site fechado.
   Pedido novo fica na tela ate alguem tocar (fixo); aviso do mesmo pedido substitui o anterior (tag). */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { texto: e.data ? e.data.text() : '' }; }
  var opcoes = {
    body: d.texto || '', icon: './icone-192.png', badge: './img/aviso-badge.png', lang: 'pt-BR',
    requireInteraction: !!d.fixo, vibrate: d.fixo ? [300, 120, 300, 120, 300] : [160, 80, 160],
    data: { url: typeof d.url === 'string' && d.url.charAt(0) === '#' ? d.url : '#/' },
  };
  if (d.tag) { opcoes.tag = d.tag; opcoes.renotify = true; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Ligeiro', opcoes));
});

/* tocar no aviso: volta para a aba do Ligeiro que ja estava aberta (na tela certa) ou abre uma */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var hash = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    var nossas = lista.filter(function (c) { return c.url.indexOf(self.registration.scope) === 0; });
    var certa = nossas.filter(function (c) { return c.url.split('#')[1] === hash.slice(1); })[0] || nossas[0];
    if (certa) { certa.postMessage({ ligeiroIr: hash }); return certa.focus(); }
    return self.clients.openWindow(self.registration.scope + hash);
  }));
});

/* Rede primeiro (pra pegar versao nova); se cair, usa o que esta guardado. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* de fora (Firebase, Mercado Pago, fontes): o proprio navegador guarda. Aqui dentro a resposta viria opaca e nao
     daria para guardar */
  if (url.origin !== location.origin) return;
  /* video vai direto da rede: o navegador pede em pedacos (range) e guardar ocuparia o celular a toa */
  if (/\.(mp4|webm)$/.test(url.pathname)) return;
  /* codigo com a versao no endereco (?v=) e imagens: nao mudam dentro da mesma versao do site (versao nova = cache novo,
     o antigo e apagado), entao saem direto do aparelho, sem esperar a internet */
  var ehPaginaSw = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  if (!ehPaginaSw && url.search.indexOf('agora=') < 0 && (/[?&]v=/.test(url.search) || /\.(png|webp|jpe?g|svg)$/.test(url.pathname))) {
    e.respondWith(caches.match(e.request).then(function (guardado) {
      return guardado || fetch(e.request).then(function (resposta) {
        if (resposta && resposta.ok) { var copia = resposta.clone(); caches.open(VERSAO).then(function (c) { c.put(e.request, copia); }); }
        return resposta;
      });
    }));
    return;
  }
  /* rede primeiro, mas com prazo: se a internet esta arrastando e ja temos copia, usa a copia */
  e.respondWith(caches.match(e.request).then(function (guardado) {
    /* tenta duas vezes: servidor engasgado por um instante nao vira tela quebrada */
    /* a pagina em si (index.html) vem sempre fresca da rede, sem o cache de 10 minutos do navegador */
    var ehPagina = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
    var buscar = function () { return ehPagina ? fetch(e.request.url, { cache: 'no-store' }) : fetch(e.request); };
    var pelaRede = buscar().catch(function () { return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return buscar(); }); }).then(function (resposta) {
      /* o site mudou de endereco (github.io -> dominio proprio): a pagina vai para o endereco novo pelo navegador (resposta
         redirecionada na navegacao da erro) e este service worker, que ficou no endereco velho, se desliga */
      if (resposta && resposta.redirected && ehPagina) {
        if (new URL(resposta.url).origin !== location.origin) self.registration.unregister();
        return Response.redirect(resposta.url, 302);   /* o #/loja/... o navegador leva junto sozinho */
      }
      if (resposta && resposta.ok) {
        /* a checagem de versao (index.html?agora=...) muda de endereco a cada vez: guardar so encheria o cache */
        if (url.search.indexOf('agora=') < 0) { var copia = resposta.clone(); caches.open(VERSAO).then(function (c) { c.put(e.request, copia); }); }
        return resposta;
      }
      /* servidor respondeu com erro (404, 500) e existe copia boa guardada: usa a copia */
      return guardado || resposta;
    });
    if (!guardado) return pelaRede.catch(function () { return new Response('Sem internet agora. Tente de novo em instantes.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
    /* pagina: se a rede mandar para outro endereco, vale o endereco novo, mesmo passando do prazo */
    var prazo = new Promise(function (resolve) { setTimeout(function () { resolve(guardado); }, 2500); });
    return Promise.race([pelaRede.catch(function () { return guardado; }), prazo]);
  }));
});
