/*
 * Ligeiro - cache leve para o site abrir rapido e aguentar internet fraca.
 * Os pedidos em si nunca passam por aqui (vao direto pro banco de dados).
 */
/* MESMO numero do ?v= do index.html: os dois sobem juntos. */
var VERSAO = 'ligeiro-20260920z';
/* So a casca entra no cache na instalacao; o resto (js/css com ?v=) entra na primeira visita, pela rede. */
var ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icone-192.png', './icone-512.png', './img/mascote-192.png', './img/favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (chaves) {
    return Promise.all(chaves.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Rede primeiro (pra pegar versao nova); se cair, usa o que esta guardado. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* SDK do Firebase (gstatic): guarda a primeira vez e serve do cache depois (nao muda de versao sozinho) */
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(caches.match(e.request).then(function (guardado) {
      return guardado || fetch(e.request).then(function (resposta) {
        if (resposta && resposta.ok) { var copia = resposta.clone(); caches.open(VERSAO).then(function (c) { c.put(e.request, copia); }); }
        return resposta;
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  /* rede primeiro, mas com prazo: se a internet esta arrastando e ja temos copia, usa a copia */
  e.respondWith(caches.match(e.request).then(function (guardado) {
    /* tenta duas vezes: servidor engasgado por um instante nao vira tela quebrada */
    var pelaRede = fetch(e.request).catch(function () { return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return fetch(e.request); }); }).then(function (resposta) {
      if (resposta && resposta.ok) {
        var copia = resposta.clone();
        caches.open(VERSAO).then(function (c) { c.put(e.request, copia); });
      }
      return resposta;
    });
    if (!guardado) return pelaRede.catch(function () { return new Response('Sem internet agora. Tente de novo em instantes.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
    var prazo = new Promise(function (resolve) { setTimeout(function () { resolve(guardado); }, 2500); });
    return Promise.race([pelaRede.catch(function () { return guardado; }), prazo]);
  }));
});
