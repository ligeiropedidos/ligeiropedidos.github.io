/*
 * Auditoria visual do Ligeiro: colar no console do navegador (ou rodar pela ferramenta do navegador) com a tela aberta.
 * Roda em cada tema (loja comum e loja com tema exclusivo) e em 320, 375 e 390 px antes de publicar.
 *
 *   ligeiroAuditar()          -> conteudo passando da tela, texto cortado com "...", pagina rolando de lado
 *   ligeiroBotoes()           -> botao com texto quebrado em duas linhas ou cortado
 *
 * Cada uma devolve uma lista; ['ok'] (ou []) quer dizer que passou. Enfeites da capa da Dom Conizza passam da borda de
 * proposito (cortados pela propria capa) e podem aparecer como "FORA DA TELA: SPAN".
 */
(function () {
  function visivel(e) {
    var r = e.getBoundingClientRect();
    var cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.modal:not(.aberto)');
  }

  window.ligeiroAuditar = function (raiz) {
    raiz = raiz || document.querySelector('.tela.ativa') || document.getElementById('app');
    var W = document.documentElement.clientWidth, out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push('PAGINA ROLA DE LADO: ' + document.documentElement.scrollWidth + ' > ' + W);
    raiz.querySelectorAll('*').forEach(function (e) {
      if (!visivel(e) || e.closest('#cartaoForm') || e.closest('svg')) return;
      var r = e.getBoundingClientRect();
      /* trilhos que rolam de lado de proposito (categorias, destaques, chips) */
      if ((r.right > W + 0.5 || r.left < -0.5) && !e.closest('.abas, [class*=trilho], .abas-painel:not(.abas-principais), .hub-chips, .adm-chips')) {
        out.push('FORA DA TELA: ' + String(e.id || e.className || e.tagName).slice(0, 40) + ' esq ' + Math.round(r.left) + ' dir ' + Math.round(W - r.right));
      }
      var cs = getComputedStyle(e);
      if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push('TEXTO CORTADO: "' + e.textContent.trim().slice(0, 40) + '"');
    });
    return out.length ? out : ['ok'];
  };

  window.ligeiroBotoes = function (raiz) {
    raiz = raiz || document.getElementById('app');
    var out = [];
    raiz.querySelectorAll('button.btn, a.btn').forEach(function (b) {
      if (!visivel(b)) return;
      var linhas = [];
      var andar = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = andar.nextNode())) {
        if (!n.textContent.trim()) continue;
        var faixa = document.createRange();
        faixa.selectNodeContents(n);
        [].forEach.call(faixa.getClientRects(), function (r) {
          if (r.width > 1 && !linhas.some(function (t) { return Math.abs(t - r.top) < 6; })) linhas.push(r.top);
        });
      }
      var nome = b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (linhas.length > 1) out.push('QUEBRA EM ' + linhas.length + ' LINHAS: "' + nome + '"');
      if (b.scrollWidth > b.clientWidth + 1) out.push('CORTADO: "' + nome + '"');
    });
    return out;
  };
})();
