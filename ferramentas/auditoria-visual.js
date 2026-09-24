/*
 * Auditoria visual do Ligeiro: colar no console do navegador (ou rodar pela ferramenta do navegador) com a tela aberta.
 * Roda em cada tema (loja comum e loja com tema exclusivo) e em 320, 375 e 390 px antes de publicar.
 *
 *   ligeiroAuditar()          -> conteudo passando da tela, texto cortado com "...", pagina rolando de lado
 *   ligeiroBotoes()           -> botao com texto quebrado em duas linhas ou cortado
 *   ligeiroRitmo()            -> o espaco que se ve entre os blocos de cada coluna (ja descontando a sombra chapada)
 *   ligeiroEspacos('.sucesso') -> os vaos de uma coluna so, com o que foge do mais comum
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

  /* quanto a sombra de um bloco desce abaixo dele (a sombra chapada da Dom Conizza "come" o espaco de baixo) */
  function sombraEmbaixo(e) {
    var bs = getComputedStyle(e).boxShadow;
    if (!bs || bs === 'none') return 0;
    var maior = 0;
    bs.split(/,(?![^(]*\))/).forEach(function (s) {
      if (/inset/.test(s)) return;
      var n = (s.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
      /* so a sombra chapada (sem desfoque) ocupa espaco de verdade; a sombra suave e so um brilho */
      if (n.length >= 2 && (n[2] || 0) <= 1) maior = Math.max(maior, n[1] + (n[3] || 0));
    });
    return Math.max(0, maior);
  }

  /*
   * ligeiroEspacos(raiz) -> o espaco que se ve entre cada bloco e o seguinte (descontando a sombra de baixo) e a margem
   * de cada lado. Aponta o espaco que foge do mais comum da mesma coluna ("FORA DO RITMO") e bloco com margem
   * diferente dos vizinhos ("MARGEM"). Rodar na coluna de cartoes da tela (ex.: .sucesso, .conteudo).
   */
  /* ligeiroRitmo() -> em cada coluna da tela aberta, o espaco que se ve entre um bloco e o seguinte (contando a sombra
     chapada dos blocos de dentro tambem). Para ler: 16 entre blocos, 8 entre linhas que andam juntas */
  function fundoVisto(e) {
    var b = e.getBoundingClientRect().bottom + sombraEmbaixo(e);
    e.querySelectorAll('*').forEach(function (c) {
      var r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      if (r.height > 0 && cs.position !== 'absolute' && cs.position !== 'fixed') b = Math.max(b, r.bottom + sombraEmbaixo(c));
    });
    return b;
  }
  window.ligeiroRitmo = function (raiz) {
    raiz = typeof raiz === 'string' ? document.querySelector(raiz) : (raiz || document.querySelector('.tela.ativa') || document.getElementById('app'));
    var out = [];
    [raiz].concat([].slice.call(raiz.querySelectorAll('*'))).forEach(function (e) {
      var cs = getComputedStyle(e);
      var coluna = (cs.display.indexOf('flex') >= 0 && cs.flexDirection === 'column') || (cs.display === 'grid' && cs.gridTemplateColumns.split(' ').length === 1) || (cs.display === 'block' && e.children.length >= 2);
      if (!coluna || !visivel(e)) return;
      var filhos = [].filter.call(e.children, function (c) { var p = getComputedStyle(c).position; return visivel(c) && c.getBoundingClientRect().height > 8 && p !== 'absolute' && p !== 'fixed' && getComputedStyle(c).display !== 'inline'; });
      if (filhos.length < 2) return;
      var vaos = [];
      for (var i = 1; i < filhos.length; i++) {
        var a = filhos[i - 1], b = filhos[i];
        if (b.getBoundingClientRect().top < a.getBoundingClientRect().bottom - 1) return; /* lado a lado: nao e coluna */
        vaos.push(String(b.id || b.className || b.tagName).split(' ')[0].slice(0, 22) + ' ' + Math.round(b.getBoundingClientRect().top - fundoVisto(a)));
      }
      out.push(String(e.id || e.className || e.tagName).split(' ')[0].slice(0, 26) + ': ' + vaos.join(' | '));
    });
    return out;
  };

  window.ligeiroEspacos = function (raiz) {
    raiz = typeof raiz === 'string' ? document.querySelector(raiz) : (raiz || document.querySelector('.tela.ativa'));
    if (!raiz) return ['sem raiz'];
    var filhos = [].filter.call(raiz.children, visivel);
    var W = document.documentElement.clientWidth;
    var linhas = [], vaos = [];
    for (var i = 0; i < filhos.length; i++) {
      var r = filhos[i].getBoundingClientRect();
      var nome = String(filhos[i].id || filhos[i].className || filhos[i].tagName).split(' ')[0].slice(0, 28);
      var item = { nome: nome, esq: Math.round(r.left), dir: Math.round(W - r.right), larg: Math.round(r.width) };
      if (i > 0) {
        var ant = filhos[i - 1].getBoundingClientRect();
        item.vao = Math.round(r.top - (ant.bottom + sombraEmbaixo(filhos[i - 1])));
        vaos.push(item.vao);
      }
      linhas.push(item);
    }
    var conta = {};
    vaos.forEach(function (v) { conta[v] = (conta[v] || 0) + 1; });
    var comum = Number(Object.keys(conta).sort(function (a, b) { return conta[b] - conta[a]; })[0]);
    linhas.forEach(function (l) {
      if (l.vao != null && Math.abs(l.vao - comum) > 2) l.alerta = 'FORA DO RITMO (' + l.vao + ' e o comum e ' + comum + ')';
    });
    return { comum: comum, blocos: linhas };
  };
})();
