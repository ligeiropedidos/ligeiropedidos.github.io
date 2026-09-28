/*
 * Ligeiro - painel de demonstracao (link "Ver o painel" da faixa AMOSTRA).
 *
 * O dono de uma amostra ve o painel de verdade da loja dele sem entrar em conta: o nome, a logo, o design e o cardapio
 * que o site ja mostrou (a loja de exemplo quando nao veio nada), com pedidos de exemplo chegando. So roda com
 * ?demo=painel no endereco: o index.html desliga o banco e guarda tudo neste aparelho com o prefixo "demo:", longe dos
 * dados de verdade. Cada vez que abre, comeca do zero.
 */
(function () {
  'use strict';
  var DP = window.LIGEIRO_DEMO_PAINEL;
  if (!DP) return;
  var D = window.LigeiroDados, R = window.LigeiroRegras;
  if (!D || !D.modoDemo || !R || !window.LigeiroSeed) return;

  /* a loja: /painel/<slug> (endereco limpo) ou #/painel/<slug> */
  var rota = (location.hash.indexOf('#/') === 0 ? location.hash.slice(2) : location.pathname.replace(/^\/+/, '')).split('/');
  var slug = rota[0] === 'painel' && /^[a-z0-9-]{2,60}$/.test(rota[1] || '') ? rota[1] : 'lanchonete-do-ze';

  /* o que a pagina da amostra deixou (sessionStorage de verdade, lido antes do prefixo) */
  var veio = null;
  try { veio = JSON.parse(DP.original('ligeiro:demo-painel') || 'null'); } catch (_) { veio = null; }
  if (!veio || veio.slug !== slug || !veio.loja) veio = null;

  var seed = window.LigeiroSeed();
  var ze = seed.lojas['lanchonete-do-ze'];
  /* a loja da demonstracao: a de exemplo por baixo, a da amostra por cima, e as marcas de demonstracao */
  function montarLoja(daAmostra) {
    var l = Object.assign(D.modeloDeLoja(), D.clonar(ze), daAmostra ? D.clonar(daAmostra) : {});
    if (!(l.produtos || []).some(function (p) { return p && p.ativo !== false; })) { l.produtos = D.clonar(ze.produtos); l.categorias = D.clonar(ze.categorias); }
    Object.assign(l, {
      slug: slug, amostra: false, ativa: true, donoEmail: '', senhaPainel: '1234', aberta: true, usarHorarios: false,
      mpAtivo: true, pixAutomaticoMigrado: true, aceitaPix: true, mpChavePublica: 'TEST-demo', aceitaCartaoOnline: true, demoPainel: true,
    });
    /* termos ja aceitos (aceitar aqui nao vale nada) e o tutorial do ratinho na primeira vez, como numa loja nova */
    l.termos = { versao: R.TERMOS_VERSAO, em: new Date().toISOString(), por: 'demonstracao' };
    l.configurada = false;
    return l;
  }
  var loja = montarLoja(veio ? veio.loja : null);
  /* abriu sem passar pela amostra (endereco direto, aba nova): o nome sai do endereco na hora ("burger-house" vira
     "Burger House", nunca o da loja de exemplo) e a loja de verdade (a publica, a mesma que o site mostra) chega logo depois */
  if (!veio && slug !== 'lanchonete-do-ze') {
    loja.nome = slug.split('-').map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join(' ');
    loja.descricao = '';
  }

  /* pedidos de exemplo: a historia da semana (aba Vendas) e tres na fila, um em cada etapa */
  var NOMES = ['Maria', 'João', 'Dona Cida', 'Ana Paula', 'Carlos', 'Beatriz', 'Pedro', 'Fernanda', 'Lucas', 'Rita', 'Seu Antônio', 'Júlia'];
  var BAIRROS = ['Centro', 'Vila Nova', 'Jardim Alvorada', 'Vila Tupi', 'Centro'];
  var REFERENCIAS = ['perto da praça', 'em frente ao mercado', 'ao lado da farmácia', 'portão azul', 'depois da ponte'];
  var FORMAS = ['pix', 'cartao_entrega', 'pix', 'dinheiro_entrega'];
  var ativos = (loja.produtos || []).filter(function (p) { return p && p.ativo !== false; });
  var conta = 0;
  function montarPedido(n, status, quando) {
    for (var tenta = 0; tenta < ativos.length; tenta++) {
      var a = ativos[(n + tenta) % ativos.length], b = ativos[(n + tenta + 3) % ativos.length];
      var itens = [{ produtoId: a.id, quantidade: 1 + (n % 2) }];
      if (b && b.id !== a.id && n % 3 !== 0) itens.push({ produtoId: b.id, quantidade: 1 });
      var tipo = n % 4 === 3 ? 'retirada' : 'entrega';
      var o = null;
      try { o = R.orcar(loja, { itens: itens, tipoEntrega: tipo, tolerante: true }); } catch (_) { o = null; }
      if (!o || !o.itens || !o.itens.length || !(o.total > 0)) continue;
      conta += 1;
      var forma = FORMAS[n % FORMAS.length];
      return {
        id: 'demo' + String(conta).padStart(3, '0'),
        lojaSlug: slug, status: status, formaPagamento: forma,
        pagamentoStatus: forma === 'pix' ? 'pago' : 'na_entrega',
        trocoPara: forma === 'dinheiro_entrega' ? Math.ceil((o.total + 1) / 1000) * 1000 : 0,
        tipoEntrega: o.tipoEntrega,
        cliente: { nome: NOMES[n % NOMES.length], telefone: '1399' + String(9000000 + n * 7351).slice(-7) },
        endereco: o.tipoEntrega === 'entrega' ? { rua: 'Rua ' + (n % 9 + 1), numero: String(10 + n * 7), bairro: BAIRROS[n % BAIRROS.length], complemento: '', referencia: REFERENCIAS[n % REFERENCIAS.length], cidade: loja.cidade || 'Juquiá' } : {},
        itens: o.itens, observacao: n % 5 === 2 ? 'Sem cebola, por favor' : '',
        subtotal: o.subtotal, taxaEntrega: o.taxaEntrega, cupom: '', cupomPercentual: 0, desconto: 0, total: o.total,
        clientePagou: forma === 'pix', criadoEm: quando.toISOString(), atualizadoEm: quando.toISOString(),
        pagoEm: forma === 'pix' ? quando.toISOString() : null, origem: 'link',
      };
    }
    return null;
  }
  var pedidos = {}, agora = Date.now(), n = 0;
  for (var dia = 6; dia >= 1; dia--) {
    for (var k = 0; k < 2 + ((dia * 3) % 4); k++) {
      var q = new Date(agora - dia * 864e5); q.setHours(19 + (k % 4), (k * 13) % 60, 0, 0);
      var p = montarPedido(n++, R.STATUS.FINALIZADO, q);
      if (p) { p.senha = k + 1; pedidos[p.id] = p; }
    }
  }
  var fila = [[R.STATUS.PRONTO, 16], [R.STATUS.PRODUCAO, 7], [R.STATUS.PAGO, 1]];
  fila.forEach(function (f, i) {
    var p = montarPedido(n++, f[0], new Date(agora - f[1] * 60000));
    if (p) { p.senha = i + 1; pedidos[p.id] = p; }
  });
  var hoje = new Date(agora - new Date(agora).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  var db = { lojas: {}, pedidos: {}, contadores: {} };
  db.lojas[slug] = loja; db.pedidos[slug] = pedidos; db.contadores[slug] = { dia: hoje, ultima: fila.length };
  try {
    localStorage.setItem('ligeiro.demo.v3', JSON.stringify(db));
    sessionStorage.setItem('ligeiro:painel:' + slug, '1'); /* entra direto, sem a senha */
    /* Mercado Pago de mentira ja conectado: o dono ve o Pix e o cartao pelo site ligados, como fica depois de conectar */
    localStorage.setItem('ligeiro:segredo:' + slug + ':mercadopago', JSON.stringify({ token: 'SIMULACAO', refresh: 'demonstracao', conectadoEm: new Date().toISOString() }));
  } catch (_) { /* sem espaco: o painel abre na loja de exemplo com a senha 1234 */ }
  if (rota[0] !== 'painel') location.hash = '#/painel/' + slug;

  /* um pedido novo chega de tempos em tempos (o apito e o cartao de pedido novo), ate cinco */
  var chegaram = 0;
  function chegar() {
    if (chegaram >= 5) return;
    var p = montarPedido(n++, R.STATUS.PAGO, new Date());
    if (!p) return;
    delete p.id; delete p.senha;
    chegaram += 1;
    D.store.criarPedido(slug, p).catch(function () { /* ignora */ });
    setTimeout(chegar, 50000);
  }
  setTimeout(chegar, 25000);

  window.LigeiroDemoPainel = { slug: slug, loja: loja, voltar: veio && veio.voltar ? String(veio.voltar) : '' };

  var base = String((window.LIGEIRO_CONFIG || {}).proxyMercadoPago || '').replace(/\/$/, '');
  if (!veio && slug !== 'lanchonete-do-ze' && base && window.fetch) {
    fetch(base + '/loja/' + encodeURIComponent(slug)).then(function (r) { return r.json(); }).then(function (j) {
      var publica = j && j.borda === 1 && j.loja;
      if (!publica) return;
      publica.slug = slug;
      var nova = montarLoja(publica);
      window.LigeiroDemoPainel.loja = nova;
      D.store.salvarLoja(nova).catch(function () { /* fica a de exemplo */ });
      /* o "Voltar para a loja" da faixa, agora que se sabe a cidade */
      var faixa = document.querySelector('.faixa-demo-painel');
      if (faixa && !faixa.querySelector('a') && publica.cidadeSlug) {
        var volta = document.createElement('a'); volta.href = '/' + publica.cidadeSlug + '/' + slug; volta.textContent = 'Voltar para a loja'; faixa.appendChild(volta);
      }
    }).catch(function () { /* sem internet: fica o nome tirado do endereco */ });
  }
})();
