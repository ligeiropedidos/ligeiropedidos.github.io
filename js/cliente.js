/*
 * Ligeiro - lado do cliente: hub da cidade, vitrine da loja e o pedido
 * em modo totem (uma decisao por tela).
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var Pix = window.LigeiroPix;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;

  /* "entrega gratis em ~40 min" / "entrega em ~40 min" / "retirar no balcao" */
  function fraseEntrega(l) {
    if (l.aceitaEntrega === false) return 'retirar no balcão';
    var gratis = R.descreverFrete(l) === 'Entrega grátis';
    return (gratis ? 'entrega grátis' : 'entrega') + ' em ~' + (l.tempoEntrega || 40) + ' min';
  }
  var $ = UI.$;
  var dinheiro = R.dinheiro;

  var CHAVE_CLIENTE = 'ligeiro:cliente';
  var CHAVE_CIDADE = 'ligeiro:cidade';
  var CHAVE_MEUS_PEDIDOS = 'ligeiro:meus-pedidos';

  function ir(caminho) { window.LigeiroApp.ir(caminho); }

  /* ============================================================
   * HUB: escolher a cidade
   * ========================================================== */

  function hub(raiz) {
    var lembrada = UI.lerLocal(CHAVE_CIDADE);
    raiz.classList.add('fundo-hub');
    raiz.appendChild(el('div', { class: 'hub-capa hub-cidade' }, [
      el('img', { class: 'hub-mascote-fundo', src: 'img/mascote.png', alt: '' }),
      el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.png', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      el('h1', { class: 'hub-titulo', text: 'Em que cidade você está?' }),
      el('p', { class: 'slogan', text: 'Peça no delivery da sua cidade. Sem app, sem cadastro, sem comissão.' }),
      el('div', { class: 'hub-selos' }, [el('span', { text: '✓ Sem taxa' }), el('span', { text: '✓ Pix pelo Mercado Pago' }), el('span', { text: '✓ Acompanha pela senha' })]),
    ]));
    var busca = el('input', { type: 'search', class: 'busca', placeholder: '🔍 Digite o nome da sua cidade', 'aria-label': 'Buscar cidade' });
    var lista = el('div', { class: 'hub-lista' });
    raiz.appendChild(el('div', { class: 'conteudo hub-conteudo' }, [busca, lista]));
    lista.appendChild(el('p', { class: 'centro muted', text: 'Carregando…' }));
    var cidades = [];

    /* Uma linha por cidade: logos das lojas, nome, quantas abertas agora. */
    function linhaCidade(c, destaque) {
      var logos = el('span', { class: 'cidade-logos' }, c.lojas.slice(0, 4).map(function (l) {
        var src = D.logoSrc(l);
        return el('span', { class: 'cidade-logo', title: l.nome }, src ? el('img', { src: src, alt: '' }) : (l.emoji || '🍔'));
      }));
      if (c.lojas.length > 4) logos.appendChild(el('span', { class: 'cidade-logo mais', text: '+' + (c.lojas.length - 4) }));
      var abertas = c.lojas.filter(function (l) { return R.lojaAberta(l); }).length;
      var detalhe = c.lojas.length + (c.lojas.length === 1 ? ' loja' : ' lojas') + ' · ' + (abertas ? abertas + (abertas === 1 ? ' aberta agora' : ' abertas agora') : 'nenhuma aberta agora');
      return el('button', { class: 'cidade-linha' + (destaque ? ' minha' : ''), onclick: function () { ir(c.slug); } }, [
        logos,
        el('span', { class: 'cidade-info' }, [
          el('span', { class: 'cidade-nome' }, [c.nome, el('small', { text: ' · ' + (c.uf || '') })]),
          el('span', { class: 'cidade-detalhe', text: detalhe }),
        ]),
        el('span', { class: 'cidade-acao', text: destaque ? 'Continuar' : 'Ver lojas' }),
      ]);
    }

    function desenhar() {
      UI.limpar(lista);
      var termo = R.semAcento(String(busca.value || '')).toLowerCase().trim();
      var visiveis = cidades.filter(function (c) { return !termo || R.semAcento(c.nome + ' ' + (c.uf || '')).toLowerCase().indexOf(termo) >= 0; });
      if (!visiveis.length) {
        lista.appendChild(el('div', { class: 'vazio hub-vazio' }, [
          el('img', { class: 'mascote-vazio', src: 'img/mascote.png', alt: '' }),
          el('p', { class: 'forte', text: termo ? 'Ainda não tem loja em "' + busca.value.trim() + '".' : 'Nenhuma cidade cadastrada ainda.' }),
          el('p', { class: 'muted', text: 'Tem uma lanchonete, pizzaria ou marmitaria aí? Ela pode ser a primeira.' }),
          el('a', { class: 'btn btn-principal', href: '#/lojas', text: 'Cadastrar minha loja' }),
        ]));
        return;
      }
      var minha = visiveis.filter(function (c) { return c.slug === lembrada; });
      var outras = visiveis.filter(function (c) { return c.slug !== lembrada; }).sort(function (a, b) { return b.lojas.length - a.lojas.length || a.nome.localeCompare(b.nome, 'pt-BR'); });
      if (minha.length) {
        lista.appendChild(el('div', { class: 'hub-secao', text: 'Sua cidade' }));
        minha.forEach(function (c) { lista.appendChild(linhaCidade(c, true)); });
      }
      if (outras.length) {
        lista.appendChild(el('div', { class: 'hub-secao', text: minha.length ? 'Outras cidades' : 'Cidades com Ligeiro' }));
        outras.forEach(function (c) { lista.appendChild(linhaCidade(c, false)); });
      }
    }
    busca.addEventListener('input', desenhar);
    store.listarVitrine().catch(function () {
      UI.limpar(lista); lista.appendChild(UI.erroCarregar('Não deu pra carregar as cidades.')); return null;
    }).then(function (lojas) {
      if (!lojas) return;
      var mapa = {};
      lojas.forEach(function (l) {
        if (l.ativa === false || R.lojaBloqueada(l)) return;
        if (!mapa[l.cidadeSlug]) mapa[l.cidadeSlug] = { slug: l.cidadeSlug, nome: l.cidade, uf: l.uf || '', lojas: [] };
        mapa[l.cidadeSlug].lojas.push(l);
      });
      cidades = Object.keys(mapa).map(function (k) { return mapa[k]; });
      /* so uma cidade com loja: nao faz a pessoa escolher, vai direto pro seletor de lojas */
      if (cidades.length === 1) { location.replace('#/' + cidades[0].slug); return; }
      busca.hidden = cidades.length < 4;
      desenhar();
    });

    raiz.appendChild(rodapeLigeiro(true));
    return function () {};
  }

  function rodapeLigeiro(comChamada) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var filhos = [];
    if (comChamada) {
      filhos.push(el('p', { class: 'forte', text: 'Tem lanchonete, pizzaria ou marmitaria?' }));
      filhos.push(el('p', { text: 'Coloque seu cardápio no Ligeiro. R$ 79 por mês, sem comissão, a gente configura na sua loja.' }));
      var botoes = [el('a', { class: 'btn btn-principal', href: '#/lojas', text: 'Quero o Ligeiro na minha loja' }), el('a', { class: 'btn btn-fantasma', href: '#/assinar', text: 'Assinar agora' })];
      if (cfg.whatsappLigeiro) botoes.push(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero colocar meu estabelecimento no Ligeiro.'), target: '_blank', rel: 'noopener', text: '💬 Falar com o Ligeiro' }));
      filhos.push(el('div', { class: 'contatos' }, botoes));
    }
    filhos.push(el('div', { class: 'ligeiro' }, [el('a', { href: '#/lojas', text: 'Ligeiro — pedido ligeiro, sem comissão' })]));
    return el('footer', { class: 'rodape' }, filhos);
  }

  /* ============================================================
   * CIDADE: lista de lojas
   * ========================================================== */

  function cidade(raiz, cidadeSlug) {
    var estadoHub = { lojas: [], termo: '', soAbertas: false, tipo: '' };

    var tituloCidade = el('h1', { class: 'hub-titulo', text: 'Carregando…' });
    raiz.classList.add('fundo-hub');
    raiz.appendChild(el('div', { class: 'hub-capa hub-cidade' }, [
      el('img', { class: 'hub-mascote-fundo', src: 'img/mascote.png', alt: '' }),
      el('a', { class: 'marca centro', href: '#/cidades' }, [el('img', { class: 'mascote', src: 'img/mascote-192.png', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      tituloCidade,
      el('p', { class: 'slogan', text: 'Peça pelo link, pague no Pix e acompanhe pela senha. Sem app, sem cadastro.' }),
      el('div', { class: 'hub-selos' }, [el('span', { text: '✓ Sem taxa' }), el('span', { text: '✓ Pix pelo Mercado Pago' }), el('span', { text: '✓ Acompanha pela senha' })]),
    ]));

    var busca = el('input', { type: 'search', class: 'busca', placeholder: '🔍 O que você procura? Ex.: pizza, marmita, açaí', 'aria-label': 'Buscar produto ou loja' });
    var chips = el('div', { class: 'hub-chips' });
    var lista = el('div', { class: 'hub-lista' });
    var conteudo = el('div', { class: 'conteudo hub-conteudo' }, [busca, chips, lista]);
    raiz.appendChild(conteudo);

    /* titulo: "Peca no delivery de <cidade>". Com mais de uma cidade no Ligeiro, a cidade vira botao que abre a lista. */
    function pintarTitulo() {
      UI.limpar(tituloCidade);
      var nome = estadoHub.nomeCidade || '';
      var varias = (estadoHub.cidades || []).length > 1;
      tituloCidade.appendChild(document.createTextNode(estadoHub.lojas.length || varias ? 'Peça no delivery de ' : 'Delivery de '));
      if (!varias) { tituloCidade.appendChild(document.createTextNode(nome)); return; }
      tituloCidade.appendChild(el('button', { class: 'hub-cidade-seletor', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Trocar de cidade. Agora: ' + nome, onclick: abrirCidades }, [nome, el('span', { class: 'seta', text: '▾' })]));
    }
    function abrirCidades() {
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, (estadoHub.cidades || []).map(function (c) {
        var atual = c.slug === cidadeSlug;
        return el('button', { class: 'cidade-linha' + (atual ? ' minha' : ''), type: 'button', onclick: function () { UI.fecharModal(); if (!atual) ir(c.slug); } }, [
          el('span', { class: 'cidade-info' }, [
            el('span', { class: 'cidade-nome' }, [c.nome, el('small', { text: ' · ' + (c.uf || '') })]),
            el('span', { class: 'cidade-detalhe', text: c.lojas + (c.lojas === 1 ? ' loja' : ' lojas') + ' · ' + (c.abertas ? c.abertas + (c.abertas === 1 ? ' aberta agora' : ' abertas agora') : 'nenhuma aberta agora') }),
          ]),
          el('span', { class: 'cidade-acao', text: atual ? 'Você está aqui' : 'Ver lojas' }),
        ]);
      }));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', style: { margin: '6px 0 0' } }, ['Sua cidade não está aqui? ', el('a', { href: '#/lojas', onclick: function () { UI.fecharModal(); }, text: 'Leve o Ligeiro pra ela' }), '.']));
      UI.abrirModal({ titulo: 'Em que cidade você está?', corpo: corpo, rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Fechar', onclick: UI.fecharModal })] });
    }

    function normal(t) { return R.semAcento(String(t || '')).toLowerCase(); }

    /* Itens do cardapio que batem com a busca (so ativos): "tem: Pizza Calabresa, Pizza 4 Queijos" */
    function itensQueBatem(l, termo) {
      if (!termo) return [];
      return R.produtosAtivos(l).filter(function (p) { return normal(p.nome).indexOf(termo) >= 0; }).map(function (p) { return p.nome; });
    }

    function desenharChips() {
      UI.limpar(chips);
      var tipos = [];
      estadoHub.lojas.forEach(function (l) { if (l.tipo && tipos.indexOf(l.tipo) < 0) tipos.push(l.tipo); });
      var abertas = estadoHub.lojas.filter(function (l) { return R.lojaAberta(l); }).length;
      chips.appendChild(el('button', { class: 'aba-painel' + (estadoHub.soAbertas ? ' ativa' : ''), type: 'button', text: '● Abertas agora' + (abertas ? ' · ' + abertas : ''), onclick: function () { estadoHub.soAbertas = !estadoHub.soAbertas; desenharChips(); desenharLista(); } }));
      if (tipos.length > 1) tipos.forEach(function (t) {
        chips.appendChild(el('button', { class: 'aba-painel' + (estadoHub.tipo === t ? ' ativa' : ''), type: 'button', text: t, onclick: function () { estadoHub.tipo = estadoHub.tipo === t ? '' : t; desenharChips(); desenharLista(); } }));
      });
    }

    /* Tom bem claro da cor da loja pro fundo do quadrado (a logo e quem manda). */
    function tintaDaLoja(cor) {
      var m = /^#([0-9a-f]{6})$/i.exec(String(cor || ''));
      if (!m) return '';
      var n = parseInt(m[1], 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      var mix = function (c) { return Math.round(c * 0.16 + 255 * 0.84); };
      return 'rgb(' + mix(r) + ', ' + mix(g) + ', ' + mix(b) + ')';
    }

    /* Cartao quadrado: a imagem da loja ocupa o topo, o texto fica curto embaixo. */
    function cartao(l, itens) {
      var aberta = R.lojaAberta(l);
      var abreAs = aberta ? null : R.proximaAbertura(l);
      var gratis = l.aceitaEntrega !== false && R.descreverFrete(l) === 'Entrega grátis';
      var tempo = l.aceitaEntrega === false ? 'retirada' : '~' + (l.tempoEntrega || 40) + ' min';
      var status = aberta ? '● Aberto · ' + tempo : (abreAs ? '● Abre às ' + abreAs : '● Fechado');
      var logo = D.logoSrc(l);
      var tinta = tintaDaLoja(l.cor);
      /* capa da loja como fundo do quadrado (com leve desfoque, pra logo mandar); sem capa fica a cor */
      var fundo = el('span', { class: 'tile-img', style: tinta ? { background: tinta } : null }, [
        logo ? el('img', { class: 'tile-logo', src: logo, alt: '' }) : el('span', { class: 'emoji', text: l.emoji || '🍽️' }),
        gratis ? el('span', { class: 'tile-selo', text: '🛵 Entrega grátis' }) : null,
        lojaOficial(l.slug) ? el('span', { class: 'tile-selo tile-oficial', text: '⭐ Oficial' }) : null,
      ]);
      function porCapa(src) {
        if (!src || fundo.classList.contains('com-capa')) return;
        fundo.insertBefore(el('img', { class: 'tile-capa', src: src, alt: '' }), fundo.firstChild);
        fundo.classList.add('com-capa');
      }
      if (l.capaUrl) porCapa(l.capaUrl);
      else if (l.capa && store.obterFoto) store.obterFoto(l.slug, l.capa).then(porCapa).catch(function () { /* fica a cor */ });
      return el('button', {
        class: 'loja-tile' + (aberta ? '' : ' fechada'),
        'aria-label': l.nome + ', ' + status,
        onclick: function () { ir(l.cidadeSlug + '/' + l.slug); },
      }, [
        fundo,
        el('span', { class: 'tile-info' }, [
          el('span', { class: 'nome', text: l.nome }),
          el('span', { class: 'desc', text: l.tipo || (l.descricao || '') }),
          itens.length ? el('span', { class: 'bate', text: 'Tem: ' + itens.slice(0, 2).join(', ') + (itens.length > 2 ? ' +' + (itens.length - 2) : '') }) : null,
          el('span', { class: 'status ' + (aberta ? 'aberta' : 'fechada'), text: status }),
        ]),
      ]);
    }

    function desenharLista() {
      UI.limpar(lista);
      var termo = normal(estadoHub.termo).trim();
      var todas = estadoHub.lojas.slice();
      if (estadoHub.tipo) todas = todas.filter(function (l) { return l.tipo === estadoHub.tipo; });
      if (estadoHub.soAbertas) todas = todas.filter(function (l) { return R.lojaAberta(l); });
      var comItens = todas.map(function (l) {
        var itens = itensQueBatem(l, termo);
        var bateLoja = !termo || normal(l.nome + ' ' + (l.tipo || '') + ' ' + (l.descricao || '')).indexOf(termo) >= 0;
        return { loja: l, itens: itens, mostra: bateLoja || itens.length > 0 };
      }).filter(function (x) { return x.mostra; });
      if (!comItens.length) {
        lista.appendChild(el('div', { class: 'vazio hub-vazio' }, [
          el('img', { class: 'mascote-vazio', src: 'img/mascote.png', alt: '' }),
          el('p', { class: 'forte', text: termo ? 'Ninguém aqui vende "' + estadoHub.termo.trim() + '" ainda.' : (estadoHub.soAbertas ? 'Nenhuma loja aberta agora.' : 'Ainda não tem loja nesta cidade.') }),
          el('p', { class: 'muted', text: termo || estadoHub.soAbertas ? 'Tente outra palavra ou tire o filtro.' : 'Tem uma lanchonete, pizzaria ou marmitaria? Ela pode ser a primeira.' }),
          termo || estadoHub.soAbertas
            ? el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Limpar filtros', onclick: function () { estadoHub.termo = ''; busca.value = ''; estadoHub.soAbertas = false; estadoHub.tipo = ''; desenharChips(); desenharLista(); } })
            : el('a', { class: 'btn btn-principal', href: '#/comecar', text: 'Cadastrar minha loja grátis' }),
        ]));
        return;
      }
      var abertas = comItens.filter(function (x) { return R.lojaAberta(x.loja); });
      var fechadas = comItens.filter(function (x) { return !R.lojaAberta(x.loja); });
      function ordenar(a, b) {
        var oa = UI.ehOficial(a.loja.slug) ? 0 : 1, ob = UI.ehOficial(b.loja.slug) ? 0 : 1;
        return oa - ob || a.loja.nome.localeCompare(b.loja.nome, 'pt-BR');
      }
      abertas.sort(ordenar); fechadas.sort(ordenar);
      var fila = abertas.concat(fechadas);
      if (!fila.some(function (x) { return x.loja.slug === estadoHub.sel; })) estadoHub.sel = fila[0].loja.slug;

      /* palco: fundo desfocado da loja escolhida, trilho de quadrados, e embaixo os dados dela */
      var fundo = el('div', { class: 'ps-fundo' });
      var trilho = el('div', { class: 'ps-trilho', role: 'listbox', 'aria-label': 'Lojas' });
      var detalhe = el('div', { class: 'ps-detalhe' });
      lista.appendChild(el('div', { class: 'hub-secao', text: abertas.length ? (abertas.length === 1 ? '1 loja aberta agora' : abertas.length + ' lojas abertas agora') : 'Todas fechadas agora' }));
      lista.appendChild(el('div', { class: 'ps-palco' }, [fundo, trilho, detalhe]));
      var tiles = {};
      var capas = {};

      function pintarFundo(l) {
        var tinta = l.cor && /^#[0-9a-f]{6}$/i.test(l.cor) ? l.cor : '';
        fundo.style.backgroundColor = tinta || '';
        var src = capas[l.slug] || (lojaOficial(l.slug) && lojaOficial(l.slug).logo) || D.logoSrc(l) || '';
        fundo.style.backgroundImage = src ? 'url("' + String(src).replace(/"/g, '%22') + '")' : 'none';
      }
      function pintarDetalhe(x) {
        var l = x.loja;
        var aberta = R.lojaAberta(l);
        var abreAs = aberta ? null : R.proximaAbertura(l);
        var tempo = l.aceitaEntrega === false ? 'só retirada' : 'entrega em ~' + (l.tempoEntrega || 40) + ' min';
        var frete = l.aceitaEntrega === false ? '' : R.descreverFrete(l);
        UI.limpar(detalhe);
        detalhe.appendChild(el('div', { class: 'ps-texto' }, [
          el('div', { class: 'ps-nome' }, [l.nome, UI.ehOficial(l.slug) ? el('span', { class: 'ps-selo-oficial' }, [el('span', { class: 'estrela', text: '★' }), 'Loja oficial']) : null]),
          el('div', { class: 'ps-meta', text: [l.tipo, x.itens.length ? 'tem: ' + x.itens.slice(0, 2).join(', ') + (x.itens.length > 2 ? ' +' + (x.itens.length - 2) : '') : (l.descricao || '')].filter(Boolean).join(' · ') }),
          el('div', { class: 'ps-status' }, [
            el('span', { class: aberta ? 'aberta' : 'fechada', text: aberta ? '● Aberta agora' : (abreAs ? '● Abre às ' + abreAs : '● Fechada') }),
            el('span', { text: '🕒 ' + tempo }),
            frete ? el('span', { text: '🛵 ' + frete }) : null,
          ]),
        ]));
        detalhe.appendChild(el('button', { class: 'btn btn-principal ps-abrir', type: 'button', text: aberta ? 'Abrir loja →' : 'Ver cardápio →', onclick: function () { ir(l.cidadeSlug + '/' + l.slug); } }));
      }
      function escolher(slugLoja, rolar) {
        estadoHub.sel = slugLoja;
        Object.keys(tiles).forEach(function (k) { tiles[k].classList.toggle('escolhida', k === slugLoja); tiles[k].setAttribute('aria-selected', k === slugLoja ? 'true' : 'false'); });
        var x = fila.filter(function (y) { return y.loja.slug === slugLoja; })[0];
        if (!x) return;
        pintarFundo(x.loja);
        pintarDetalhe(x);
        if (rolar && tiles[slugLoja].scrollIntoView) tiles[slugLoja].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
      var podePairar = window.matchMedia && window.matchMedia('(hover: hover)').matches;
      fila.forEach(function (x) {
        var l = x.loja;
        var src = (lojaOficial(l.slug) && lojaOficial(l.slug).logo) || D.logoSrc(l);
        var t = el('button', { class: 'ps-tile' + (R.lojaAberta(l) ? '' : ' fechada'), type: 'button', role: 'option', 'aria-label': l.nome, title: l.nome }, [
          src ? el('img', { src: src, alt: '' }) : document.createTextNode(l.emoji || '🍽️'),
          UI.ehOficial(l.slug) ? el('span', { class: 'ps-oficial', text: '★', title: 'Loja oficial do Ligeiro' }) : null,
        ]);
        if (!src && l.cor) t.style.background = tintaDaLoja(l.cor) || '#fff';
        /* no computador: passar o mouse escolhe, clicar abre. No celular: o primeiro toque escolhe, o segundo abre. */
        t.addEventListener('click', function () { if (estadoHub.sel === l.slug || podePairar) ir(l.cidadeSlug + '/' + l.slug); else escolher(l.slug, true); });
        if (podePairar) t.addEventListener('mouseenter', function () { escolher(l.slug, false); });
        t.addEventListener('focus', function () { escolher(l.slug, false); });
        tiles[l.slug] = t;
        trilho.appendChild(t);
        if (l.capaUrl) capas[l.slug] = l.capaUrl;
        else if (l.capa && store.obterFoto) store.obterFoto(l.slug, l.capa).then(function (c) { if (c) { capas[l.slug] = c; if (estadoHub.sel === l.slug) pintarFundo(l); } }).catch(function () { /* fica a logo */ });
      });
      /* setas do teclado andam pelo trilho */
      trilho.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var ordem = fila.map(function (y) { return y.loja.slug; });
        var i = ordem.indexOf(estadoHub.sel) + (e.key === 'ArrowRight' ? 1 : -1);
        if (i < 0 || i >= ordem.length) return;
        e.preventDefault();
        tiles[ordem[i]].focus();
        escolher(ordem[i], true);
      });
      escolher(estadoHub.sel, false);
    }

    function desenhar(lojas) {
      /* sem pagar (bloqueada, pausada ou cancelada) a loja sai do ar: nem no hub aparece */
      estadoHub.lojas = lojas.filter(function (l) { return !R.lojaBloqueada(l); });
      estadoHub.nomeCidade = lojas.length ? lojas[0].cidade : cidadeSlug.replace(/-/g, ' ');
      pintarTitulo();
      busca.hidden = lojas.length === 0;
      chips.hidden = lojas.length < 2;
      desenharChips();
      desenharLista();
    }

    busca.addEventListener('input', function () { estadoHub.termo = busca.value; desenharLista(); });

    store.listarLojas(cidadeSlug).then(function (lojas) {
      /* so lembra a cidade quando ela existe de verdade (senao "#/painel" digitado errado virava a cidade da pessoa) */
      if (lojas && lojas.length) UI.guardarLocal(CHAVE_CIDADE, cidadeSlug);
      desenhar(lojas);
      /* outras cidades com loja: o nome da cidade no titulo vira seletor */
      if (store.listarVitrine) store.listarVitrine().then(function (todas) {
        var mapa = {};
        todas.forEach(function (l) {
          if (l.ativa === false || R.lojaBloqueada(l)) return;
          if (!mapa[l.cidadeSlug]) mapa[l.cidadeSlug] = { slug: l.cidadeSlug, nome: l.cidade, uf: l.uf || '', lojas: 0, abertas: 0 };
          mapa[l.cidadeSlug].lojas++;
          if (R.lojaAberta(l)) mapa[l.cidadeSlug].abertas++;
        });
        estadoHub.cidades = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.lojas - a.lojas || a.nome.localeCompare(b.nome, 'pt-BR'); });
        pintarTitulo();
      }).catch(function () { /* fica so o nome */ });
    }).catch(function () {
      tituloCidade.textContent = 'Não deu pra carregar';
      var caixa = raiz.querySelector('.hub-lista') || raiz;
      UI.limpar(caixa); caixa.appendChild(UI.erroCarregar('Não deu pra carregar as lojas de agora.'));
    });
    var parar = store.assistir ? store.assistir(function () { store.listarLojas(cidadeSlug).then(desenhar); }) : function () {};
    var relogio = setInterval(function () { if (estadoHub.lojas.length) desenharLista(); }, 60000); /* "abre as" e "aberto agora" andam sozinhos */
    raiz.appendChild(rodapeLigeiro(true));
    return function () { clearInterval(relogio); parar(); };
  }

  /* ============================================================
   * Meus pedidos (guardados so neste aparelho)
   * ========================================================== */

  function lerMeusPedidos() {
    var lista = UI.lerLocal(CHAVE_MEUS_PEDIDOS);
    return Array.isArray(lista) ? lista : [];
  }

  /* Loja oficial do Ligeiro (config.lojasOficiais): selo no hub e tema exclusivo no site */
  function lojaOficial(slugLoja) {
    var cfg = window.LIGEIRO_CONFIG || {};
    return (cfg.lojasOficiais || {})[slugLoja] || null;
  }

  function guardarMeuPedido(lojaSlug, pedido) {
    var lista = lerMeusPedidos().filter(function (p) { return p.id !== pedido.id; });
    lista.unshift({ lojaSlug: lojaSlug, id: pedido.id, senha: pedido.senha, total: pedido.total, status: pedido.status, criadoEm: pedido.criadoEm });
    UI.guardarLocal(CHAVE_MEUS_PEDIDOS, lista.slice(0, 10));
  }

  function atualizarMeuPedido(pedido) {
    var lista = lerMeusPedidos().map(function (p) { return p.id === pedido.id ? Object.assign({}, p, { status: pedido.status }) : p; });
    UI.guardarLocal(CHAVE_MEUS_PEDIDOS, lista);
  }

  /* ============================================================
   * LOJA: vitrine + pedido em modo totem
   * ========================================================== */

  function loja(raiz, slug, opcoes) {
    /* loja oficial: tema e tela de carregamento ANTES de qualquer coisa aparecer (sem piscar o visual padrao) */
    var oficialCedo = UI.lojaOficial(slug);
    var tirarSplash = function () {};
    if (oficialCedo) { UI.aplicarTemaOficial(raiz, slug); tirarSplash = UI.splashOficial(oficialCedo); }
    /* as outras lojas: o mascote do Ligeiro, e so se a loja demorar mais que um instante (internet fraca) */
    else tirarSplash = UI.splashOficial({ logo: 'img/mascote.png', corFundo: '#FAFDF6', ligeiro: true });
    var o = opcoes || {};
    var balcao = !!o.balcao;

    var estado = {
      loja: null,
      carrinho: [],
      tipoEntrega: balcao ? 'retirada' : 'retirada',
      pularEscolhaTipo: balcao,
      cupom: { codigo: '', percentual: 0, desconto: 0 },
      pedido: null,
      pararPedido: null,
      pararLoja: null,
      modal: null,
      relogioBalcao: null,
      fotos: {},
      fotosVersao: null,
    };
    var vivo = true; /* vira false quando a pessoa sai da loja antes de tudo carregar */
    var CHAVE_RASCUNHO = 'ligeiro:rascunho:' + slug;

    raiz.innerHTML = esqueletoDaLoja(balcao);

    /* ---------- utilidades de tela ---------- */

    function irPara(idTela) {
      var atual = raiz.querySelector('.tela.ativa');
      if (atual) atual.classList.remove('ativa');
      $(idTela).classList.add('ativa');
      window.scrollTo(0, 0);
      /* o carrinho sempre redesenha ao entrar: nunca mostra lista velha, venha de onde vier */
      if (idTela === 'tela-carrinho') montarCarrinho();
      atualizarBarraCarrinho();
      var faixa = $('faixaAcompanhar');
      if (faixa) faixa.hidden = balcao || idTela !== 'tela-inicio' || !temPedidoAndando();
      if (idTela === 'tela-cardapio') {
        /* mede o cabecalho so quando ele esta visivel; escondido ele mede zero */
        var topo = raiz.querySelector('#tela-cardapio .topo');
        if (topo) document.documentElement.style.setProperty('--altura-topo', Math.round(topo.getBoundingClientRect().height || 64) + 'px');
      }
    }

    raiz.querySelectorAll('[data-voltar]').forEach(function (b) {
      b.addEventListener('click', function () { UI.soar('toque'); irPara(b.dataset.voltar); });
    });

    /* ---------- carregar a loja ---------- */

    store.obterLoja(slug).catch(function () { return { _erro: true }; }).then(function (dados) {
      if (!vivo) return;
      if (!dados || dados._erro || dados.ativa === false) tirarSplash();
      if (dados && dados._erro) {
        raiz.innerHTML = '';
        raiz.appendChild(UI.erroCarregar('Não deu pra abrir a loja agora.'));
        return;
      }
      if (!dados || dados.ativa === false) {
        raiz.innerHTML = '';
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [
          el('div', { class: 'icone', text: '🔍' }),
          el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' }),
          el('button', { class: 'btn btn-fantasma', style: { marginTop: '16px' }, text: 'Ver as cidades', onclick: function () { ir('cidades'); } }),
        ]));
        return;
      }
      if (R.lojaBloqueada(dados)) {
        raiz.innerHTML = '';
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [
          el('div', { class: 'icone', text: (dados.emoji || '🍽️') }),
          el('p', { class: 'forte', text: dados.nome + ' está com o cadastro pendente no Ligeiro.' }),
          el('p', { class: 'muted', text: 'Por enquanto, peça direto pelo WhatsApp da loja.' }),
          dados.whatsapp ? el('a', { class: 'btn btn-whats', style: { marginTop: '16px' }, href: R.linkWhatsapp(dados.whatsapp, 'Oi! Quero fazer um pedido.'), target: '_blank', rel: 'noopener', text: '💬 Pedir pelo WhatsApp' }) : null,
          el('button', { class: 'btn btn-fantasma', style: { marginTop: '10px' }, text: 'Ver as cidades', onclick: function () { ir('cidades'); } }),
        ]));
        return;
      }
      if (!balcao && o.cidadeSlug && o.cidadeSlug !== dados.cidadeSlug) {
        /* Endereco com a cidade errada: corrige sem alarde. */
        history.replaceState(null, '', '#/' + dados.cidadeSlug + '/' + dados.slug + (o.pedidoId ? '/pedido/' + o.pedidoId : ''));
      }
      if (!balcao) UI.guardarLocal(CHAVE_CIDADE, dados.cidadeSlug);
      carregarFotos(dados).then(function () {
        if (!vivo) return;
        aplicarLoja(dados);
        estado.pararLoja = store.assistirLoja(slug, function (nova) {
          if (nova && vivo) carregarFotos(nova).then(function () { if (vivo) aplicarLoja(nova, true); });
        });
        if (o.pedidoId) abrirPedidoSalvo(o.pedidoId);
      });
    });

    /* O pedido em andamento fica guardado neste aparelho: "voltar" do celular ou recarregar nao apaga o carrinho. */
    function guardarRascunho() {
      if (balcao) return;
      try {
        if (estado.carrinho.length === 0 && !estado.cupom.codigo) sessionStorage.removeItem(CHAVE_RASCUNHO);
        else sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ carrinho: estado.carrinho, tipoEntrega: estado.tipoEntrega, cupom: estado.cupom }));
      } catch (_) { /* sem espaco: segue sem rascunho */ }
    }
    function restaurarRascunho() {
      if (balcao) return;
      try {
        var r = JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO) || 'null');
        if (!r || !Array.isArray(r.carrinho) || !r.carrinho.length) return;
        estado.carrinho = r.carrinho;
        estado.tipoEntrega = r.tipoEntrega === 'entrega' ? 'entrega' : 'retirada';
        estado.cupom = r.cupom || { codigo: '', percentual: 0, desconto: 0 };
      } catch (_) { /* rascunho ilegivel: ignora */ }
    }
    function limparRascunho() { try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch (_) { /* ignora */ } }

    /* Fotos (produtos e capa): baixa uma vez e so de novo quando a loja trocar alguma. */
    function carregarFotos(dados) {
      var versao = dados.fotosVersao || '';
      if (estado.fotosVersao === versao) return Promise.resolve(false);
      return store.listarFotos(slug, versao).then(function (mapa) {
        estado.fotos = mapa || {};
        estado.fotosVersao = versao;
        return true;
      }).catch(function () { estado.fotosVersao = versao; return false; });
    }

    function aplicarTemaOficial(oficial) {
      if (!oficial || !oficial.tema) return;
      UI.aplicarTemaOficial(raiz, estado.loja.slug);
      var abertura = raiz.querySelector('.abertura');
      if (abertura && !abertura.querySelector('.enfeites') && oficial.enfeites) {
        abertura.insertBefore(el('div', { class: 'enfeites', 'aria-hidden': 'true' }, oficial.enfeites.map(function (e) { return el('span', { text: e }); })), abertura.firstChild);
      }
    }

    function aplicarLoja(dados, atualizacao) {
      var primeira = !estado.loja;
      estado.loja = dados;
      estado.oficial = lojaOficial(dados.slug);
      UI.aplicarTema(dados.cor, dados.estilo);
      if (primeira && estado.oficial) aplicarTemaOficial(estado.oficial);
      if (primeira) UI.oficialPronto(estado.oficial, estado.oficial ? 600 : 120).then(tirarSplash);
      montarInicio();
      configurarFluxo();
      if (primeira) {
        restaurarRascunho();
        montarAbas();
        montarGrade(dados.categorias[0] && dados.categorias[0].id);
      } else {
        /* cardapio mudou (preco, item desligado): refaz mesmo que a pessoa esteja em outra tela */
        var ativa = raiz.querySelector('.aba.ativa');
        montarAbas();
        montarGrade(ativa ? ativa.dataset.categoria : (dados.categorias[0] && dados.categorias[0].id));
      }
      if (atualizacao) {
        atualizarBarraCarrinho();
        /* carrinho aberto acompanha o cardapio novo (preco mudou, item saiu) */
        if ($('tela-carrinho') && $('tela-carrinho').classList.contains('ativa')) montarCarrinho();
      }
    }

    /* ---------- tela inicial ---------- */

    function montarInicio() {
      var l = estado.loja;
      document.title = l.nome + ' — Ligeiro';
      var logo = $('logoLoja');
      UI.limpar(logo);
      var srcLogo = (estado.oficial && estado.oficial.logo) || D.logoSrc(l);
      logo.appendChild(srcLogo ? el('img', { src: srcLogo, alt: l.nome }) : document.createTextNode(l.emoji || '🍽️'));
      /* fim da primeira tela: confianca (todas) e o bloco da loja oficial */
      var fim = $('fimInicio');
      if (fim) {
        UI.limpar(fim);
        if (estado.oficial && estado.oficial.ilustracao) {
          fim.appendChild(el('div', { class: 'oficial-extra' }, [
            el('img', { src: estado.oficial.ilustracao, alt: '' }),
            el('div', {}, [el('b', { text: estado.oficial.frase || 'Feito na hora, do forno pra sua porta' }), el('span', { text: estado.oficial.subfrase || '' })]),
          ]));
        }
        var partes = [];
        if (pixDisponivel(l)) partes.push('🔒 Pix seguro pelo Mercado Pago');
        if (l.cidade) partes.push('📍 Somos de ' + l.cidade);
        if (l.aceitaEntrega !== false) partes.push('🛵 Entrega própria');
        /* cada item inteiro numa linha: quebra entre itens, nunca no meio de um */
        if (partes.length) fim.appendChild(el('div', { class: 'confianca' }, partes.map(function (t) { return el('span', { text: t }); })));
      }
      /* selo de loja oficial do Ligeiro */
      var selos = raiz.querySelector('.selos');
      var seloOficial = selos && selos.querySelector('.selo-oficial');
      if (estado.oficial && UI.ehOficial(l.slug) && selos && !seloOficial) selos.appendChild(el('div', { class: 'selo selo-oficial' }, [el('span', { class: 'estrela', text: '★' }), 'Loja oficial Ligeiro']));
      var capa = $('capaLoja');
      var srcCapa = l.capa ? D.fotoSrc({ foto: l.capa }, estado.fotos) : (l.capaUrl || null);
      UI.limpar(capa);
      capa.hidden = !srcCapa;
      if (srcCapa) capa.appendChild(el('img', { src: srcCapa, alt: '' }));
      capa.parentNode.classList.toggle('com-capa', !!srcCapa);
      $('nomeLoja').textContent = l.nome;
      $('descLoja').textContent = l.descricao || (l.tipo ? l.tipo + ' em ' + l.cidade : '');

      var aberta = R.lojaAberta(l);
      var selo = $('seloAberto');
      selo.classList.toggle('fechado', !aberta);
      $('seloFrete').hidden = balcao || !aberta || l.aceitaEntrega === false || R.descreverFrete(l) !== 'Entrega grátis';
      $('textoAberto').textContent = aberta ? 'Aberto agora' : 'Fechado no momento';

      var aviso = $('avisoTopo');
      aviso.hidden = !l.avisoTopo;
      aviso.textContent = l.avisoTopo || '';

      var botao = $('btnComecar');
      botao.disabled = !aberta;
      $('btnComecarForte').textContent = aberta ? (balcao ? 'TOQUE PARA PEDIR' : 'PEDIR AGORA') : 'LOJA FECHADA';
      $('btnComecarFraca').textContent = aberta
        ? (balcao ? 'e pague aqui mesmo' : fraseEntrega(l))
        : 'volte mais tarde';

      var formas = [];
      if (pixDisponivel(l)) formas.push('Pix');
      if (l.aceitaCartaoEntrega) formas.push('maquininha');
      if (l.aceitaDinheiroEntrega) formas.push('dinheiro');
      var como = $('comoPagamento');
      UI.limpar(como);
      como.appendChild(document.createTextNode(formas.length ? 'Pague com' : 'Pague'));
      como.appendChild(el('br'));
      como.appendChild(document.createTextNode(formas.length ? formas.slice(0, -1).join(', ') + (formas.length > 1 ? ' ou ' : '') + formas[formas.length - 1] : 'na loja'));

      /* destaques: os dois primeiros produtos ativos que nao sao bebida */
      var trilho = $('destaquesTrilho');
      UI.limpar(trilho);
      var vitrine = R.produtosAtivos(l).filter(function (p) { return !/bebida/i.test(p.categoria); }).slice(0, 2);
      $('destaques').hidden = vitrine.length === 0 || balcao || !aberta;
      vitrine.forEach(function (p) {
        var card = el('button', { class: 'card-produto', onclick: function () { if (!aberta) return; comecarPedido(); montarGrade(p.categoria); abrirPersonalizacao(p); } }, [
          el('span', { class: 'foto' }, fotoDoProduto(p)),
          el('span', { class: 'info' }, [
            el('span', { class: 'nome', text: p.nome }),
            el('span', { class: 'desc', text: p.descricao || '' }),
            el('span', { class: 'rodape-card' }, [el('span', { class: 'preco', text: dinheiro(p.preco) }), el('span', { class: 'mais', text: 'PEDIR' })]),
          ]),
        ]);
        trilho.appendChild(card);
      });

      /* rodape */
      var contatos = $('contatosLoja');
      UI.limpar(contatos);
      if (l.whatsapp) contatos.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(l.whatsapp, 'Olá! Vim pelo Ligeiro.'), target: '_blank', rel: 'noopener', text: '💬 WhatsApp' }));
      if (l.instagram) contatos.appendChild(el('a', { class: 'btn btn-fantasma', href: 'https://instagram.com/' + String(l.instagram).replace(/^@/, ''), target: '_blank', rel: 'noopener', text: '📷 @' + String(l.instagram).replace(/^@/, '') }));
      var enderecoJaTemCidade = l.endereco && l.cidade && R.semAcento(l.endereco).toLowerCase().indexOf(R.semAcento(l.cidade).toLowerCase()) >= 0;
      $('enderecoLoja').textContent = l.endereco ? '📍 ' + l.endereco + (l.cidade && !enderecoJaTemCidade ? ' · ' + l.cidade : '') : '';
      var outras = $('btnOutrasLojas');
      outras.textContent = 'Ver outros estabelecimentos de ' + l.cidade;
      /* Desligado por padrao: o link da loja e da loja, nao manda cliente pro concorrente. O dono liga em Ajustes se quiser. */
      outras.hidden = balcao || l.mostrarOutras !== true;
      outras.onclick = function () { ir(l.cidadeSlug); };

      atualizarFaixaAcompanhar();
      /* pedidos "andando" guardados neste aparelho: confere o status de verdade (a aba pode ter fechado antes do fim) */
      lerMeusPedidos().filter(andandoAgora).forEach(function (p) {
        store.obterPedido(slug, p.id).then(function (novo) {
          if (!vivo || !novo) return;
          atualizarMeuPedido(novo);
          atualizarFaixaAcompanhar();
        }).catch(function () { /* fica como esta */ });
      });
    }

    function fotoDoProduto(p) {
      var src = D.fotoSrc(p, estado.fotos);
      if (src) {
        var img = el('img', { src: src, alt: p.nome, loading: 'lazy' });
        img.addEventListener('error', function () { img.replaceWith(document.createTextNode(p.emoji || '🍽️')); });
        return img;
      }
      return document.createTextNode(p.emoji || '🍽️');
    }

    /* ---------- fluxo: quantas telas ---------- */

    function configurarFluxo() {
      var l = estado.loja;
      var modos = [];
      if (l.aceitaEntrega !== false) modos.push('entrega');
      if (l.aceitaRetirada !== false) modos.push('retirada');
      if (balcao) modos = ['retirada'];
      estado.pularEscolhaTipo = modos.length === 1;
      if (estado.pularEscolhaTipo) estado.tipoEntrega = modos[0];
      $('opcaoEntrega').disabled = modos.indexOf('entrega') < 0;
      $('opcaoRetirada').disabled = modos.indexOf('retirada') < 0;
      $('detalheRetirada').textContent = 'Fica pronto em ~' + (l.tempoPreparo || 20) + ' min';
      $('detalheEntrega').textContent = R.descreverFrete(l) + ' · ~' + (l.tempoEntrega || 40) + ' min';

      var passos = estado.pularEscolhaTipo
        ? { 'tela-cardapio': 1, 'tela-carrinho': 2, 'tela-dados': 3 }
        : { 'tela-tipo': 1, 'tela-cardapio': 2, 'tela-carrinho': 3, 'tela-dados': 4 };
      var total = estado.pularEscolhaTipo ? 3 : 4;
      Object.keys(passos).forEach(function (tela) {
        var r = raiz.querySelector('#' + tela + ' .topo-passo');
        if (r) r.textContent = 'Passo ' + passos[tela] + ' de ' + total;
      });
      var voltar = raiz.querySelector('#tela-cardapio .voltar');
      if (voltar) voltar.dataset.voltar = estado.pularEscolhaTipo ? 'tela-inicio' : 'tela-tipo';
      $('blocoEndereco').hidden = estado.tipoEntrega !== 'entrega';
      atualizarFormasDePagamento();
    }

    function comecarPedido() {
      if (!estado.loja || !R.lojaAberta(estado.loja)) return;
      irPara(estado.pularEscolhaTipo ? 'tela-cardapio' : 'tela-tipo');
    }

    $('btnComecar').addEventListener('click', comecarPedido);
    $('btnCardapio').addEventListener('click', comecarPedido);

    raiz.querySelectorAll('[data-tipo]').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.tipoEntrega = b.dataset.tipo;
        $('blocoEndereco').hidden = estado.tipoEntrega !== 'entrega';
        atualizarFormasDePagamento();
        irPara('tela-cardapio');
      });
    });

    /* ---------- cardapio ---------- */

    function montarAbas() {
      var abas = $('abas');
      UI.limpar(abas);
      (estado.loja.categorias || []).forEach(function (c) {
        var temProduto = R.produtosAtivos(estado.loja).some(function (p) { return p.categoria === c.id; });
        if (!temProduto) return;
        abas.appendChild(el('button', { class: 'aba', dataset: { categoria: c.id }, text: (c.emoji ? c.emoji + ' ' : '') + c.nome, onclick: function () { montarGrade(c.id); } }));
      });
    }

    function montarGrade(categoriaId) {
      var topo = raiz.querySelector('#tela-cardapio .topo');
      if (topo) document.documentElement.style.setProperty('--altura-topo', Math.round(topo.getBoundingClientRect().height || 64) + 'px');
      raiz.querySelectorAll('.aba').forEach(function (a) { a.classList.toggle('ativa', a.dataset.categoria === categoriaId); });
      var grade = $('grade');
      UI.limpar(grade);
      var lista = R.produtosAtivos(estado.loja).filter(function (p) { return p.categoria === categoriaId; });
      if (lista.length === 0 && estado.loja.categorias.length) {
        var primeira = raiz.querySelector('.aba');
        if (primeira && primeira.dataset.categoria !== categoriaId) return montarGrade(primeira.dataset.categoria);
      }
      if (lista.length === 0) {
        grade.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone', text: '🍽️' }), el('p', { text: 'Cardápio em atualização. Volte daqui a pouco.' })]));
        return;
      }
      lista.forEach(function (p) {
        grade.appendChild(el('button', { class: 'card-produto', onclick: function () { abrirPersonalizacao(p); } }, [
          el('span', { class: 'foto' }, fotoDoProduto(p)),
          el('span', { class: 'info' }, [
            el('span', { class: 'nome', text: p.nome }),
            el('span', { class: 'desc', text: p.descricao || '' }),
            el('span', { class: 'rodape-card' }, [el('span', { class: 'preco', text: dinheiro(p.preco) }), el('span', { class: 'mais', text: 'PEDIR' })]),
          ]),
        ]));
      });
    }

    /* ---------- personalizar o item ---------- */

    function abrirPersonalizacao(produto) {
      var grupos = R.gruposDaCategoria(estado.loja, produto.categoria);
      var grupoTamanho = grupos.filter(function (g) { return g.tipo === 'unico'; })[0];
      var padrao = grupoTamanho ? (grupoTamanho.opcoes.filter(function (op) { return op.padrao; })[0] || grupoTamanho.opcoes[0]) : null;
      var m = estado.modal = { produto: produto, quantidade: 1, tamanho: padrao ? padrao.id : null, adicionais: [], removidos: [], observacao: '' };
      var podePersonalizar = estado.loja.permitePersonalizar !== false;

      var corpo = el('div');
      var srcFoto = D.fotoSrc(produto, estado.fotos);
      if (srcFoto) corpo.appendChild(el('div', { class: 'foto-modal' }, [el('img', { class: 'fundo', src: srcFoto, alt: '', 'aria-hidden': 'true' }), el('img', { class: 'frente', src: srcFoto, alt: produto.nome })]));

      if (podePersonalizar) {
        grupos.forEach(function (g) { corpo.appendChild(montarGrupo(g)); });
        if (produto.ingredientes && produto.ingredientes.length) corpo.appendChild(montarGrupoRemover(produto.ingredientes));
        var obs = el('div', { class: 'campo', style: { marginTop: '18px' } }, [
          el('label', { for: 'obsItem', html: 'Algum recado sobre este item? <span class="opcional">opcional</span>' }),
          el('textarea', { id: 'obsItem', maxlength: '140', placeholder: 'Ex: bem passado, pouca cebola…' }),
        ]);
        corpo.appendChild(obs);
      } else if (produto.ingredientes && produto.ingredientes.length) {
        corpo.appendChild(el('div', { class: 'grupo' }, [el('div', { class: 'grupo-titulo', text: 'O que vem' }), el('ul', { class: 'recheio' }, produto.ingredientes.map(function (i) { return el('li', { text: i }); }))]));
      }

      var numero = el('span', { class: 'numero', text: '1' });
      var menos = el('button', { type: 'button', 'aria-label': 'Diminuir', text: '−', disabled: true });
      var mais = el('button', { type: 'button', 'aria-label': 'Aumentar', text: '+' });
      var valor = el('span');
      var adicionar = el('button', { class: 'btn btn-principal', style: { flex: '1' } }, ['Adicionar ', valor]);

      function atualizarPreco() { valor.textContent = dinheiro(precoUnitarioModal() * m.quantidade); }
      menos.addEventListener('click', function () { if (m.quantidade > 1) { m.quantidade -= 1; numero.textContent = m.quantidade; menos.disabled = m.quantidade <= 1; atualizarPreco(); } });
      mais.addEventListener('click', function () { if (m.quantidade < 20) { m.quantidade += 1; numero.textContent = m.quantidade; menos.disabled = false; atualizarPreco(); } });
      adicionar.addEventListener('click', function () {
        var campoObs = $('obsItem');
        m.observacao = campoObs ? campoObs.value.trim() : '';
        adicionarAoCarrinho();
      });
      atualizarPreco();
      m.atualizarPreco = atualizarPreco;

      UI.abrirModal({
        titulo: produto.nome,
        sub: produto.descricao || '',
        corpo: corpo,
        rodape: [el('div', { class: 'contador' }, [menos, numero, mais]), adicionar],
      });
    }

    function montarGrupo(grupo) {
      var m = estado.modal;
      var bloco = el('div', { class: 'grupo' }, [
        el('div', { class: 'grupo-titulo', text: grupo.titulo }),
        el('div', { class: 'grupo-dica', text: grupo.tipo === 'unico' ? 'Escolha uma opção' : 'Pode escolher mais de um' + (grupo.max ? ' (até ' + grupo.max + ')' : '') }),
      ]);
      grupo.opcoes.forEach(function (opcao) {
        var marcada = grupo.tipo === 'unico' ? m.tamanho === opcao.id : m.adicionais.indexOf(opcao.id) >= 0;
        var campo = el('input', { type: grupo.tipo === 'unico' ? 'radio' : 'checkbox', class: 'opcao-campo', name: 'grupo-' + grupo.chave, value: opcao.id });
        campo.checked = marcada;
        var linha = el('label', { class: 'opcao' + (marcada ? ' marcada' : '') }, [
          campo,
          el('span', { class: 'marcador ' + (grupo.tipo === 'unico' ? 'redondo' : 'quadrado'), text: '✓' }),
          el('span', { class: 'rotulo' }, [opcao.nome, opcao.descricao ? el('small', { text: opcao.descricao }) : null]),
          el('span', { class: 'valor' + (opcao.preco > 0 ? '' : ' gratis'), text: opcao.preco > 0 ? '+ ' + dinheiro(opcao.preco) : 'grátis' }),
        ]);
        campo.addEventListener('change', function () {
          if (grupo.tipo === 'unico') {
            m.tamanho = opcao.id;
            bloco.querySelectorAll('.opcao').forEach(function (x) { x.classList.remove('marcada'); });
            linha.classList.add('marcada');
          } else if (campo.checked) {
            if (grupo.max && m.adicionais.length >= grupo.max) {
              UI.avisar('Dá para escolher no máximo ' + grupo.max + '.');
              campo.checked = false;
              return;
            }
            m.adicionais.push(opcao.id);
            linha.classList.add('marcada');
          } else {
            m.adicionais = m.adicionais.filter(function (x) { return x !== opcao.id; });
            linha.classList.remove('marcada');
          }
          m.atualizarPreco();
        });
        bloco.appendChild(linha);
      });
      return bloco;
    }

    function montarGrupoRemover(ingredientes) {
      var m = estado.modal;
      var bloco = el('div', { class: 'grupo' }, [
        el('div', { class: 'grupo-titulo', text: 'Tirar alguma coisa?' }),
        el('div', { class: 'grupo-dica', text: 'Toque no que você NÃO quer. Não muda o preço.' }),
      ]);
      ingredientes.forEach(function (ing) {
        var campo = el('input', { type: 'checkbox', class: 'opcao-campo', 'aria-label': 'Tirar ' + ing });
        var linha = el('label', { class: 'opcao remover' }, [campo, el('span', { class: 'marcador quadrado', text: '✕' }), el('span', { class: 'rotulo', text: ing })]);
        campo.addEventListener('change', function () {
          if (campo.checked) { m.removidos.push(ing); linha.classList.add('marcada'); }
          else { m.removidos = m.removidos.filter(function (x) { return x !== ing; }); linha.classList.remove('marcada'); }
        });
        bloco.appendChild(linha);
      });
      return bloco;
    }

    function precoUnitarioModal() {
      var m = estado.modal;
      try {
        var c = R.calcularItens(estado.loja, [{ produtoId: m.produto.id, quantidade: 1, tamanho: m.tamanho, adicionais: m.adicionais }]);
        return c.itens[0].precoUnitario;
      } catch (_) { return m.produto.preco; }
    }

    function adicionarAoCarrinho() {
      var m = estado.modal;
      var grupos = R.gruposDaCategoria(estado.loja, m.produto.categoria);
      var gT = grupos.filter(function (g) { return g.tipo === 'unico'; })[0];
      var opcoesExtras = [];
      grupos.filter(function (g) { return g.tipo === 'varios'; }).forEach(function (g) { opcoesExtras = opcoesExtras.concat(g.opcoes || []); });
      estado.carrinho.push({
        idLocal: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        produtoId: m.produto.id,
        nome: m.produto.nome,
        emoji: m.produto.emoji,
        quantidade: m.quantidade,
        tamanho: m.tamanho,
        tamanhoNome: gT && m.tamanho ? (gT.opcoes.filter(function (op) { return op.id === m.tamanho; })[0] || {}).nome : null,
        adicionais: m.adicionais.slice(),
        adicionaisNomes: m.adicionais.map(function (id) { return (opcoesExtras.filter(function (op) { return op.id === id; })[0] || {}).nome; }).filter(Boolean),
        removidos: m.removidos.slice(),
        observacao: m.observacao,
        precoUnitario: precoUnitarioModal(),
      });
      UI.fecharModal();
      UI.soar('adicionar');
      UI.avisar(m.quantidade + 'x ' + m.produto.nome + ' no pedido');
      atualizarBarraCarrinho();
    }

    /* ---------- carrinho e totais ---------- */

    function itensParaRegras() {
      return estado.carrinho.map(function (i) { return { produtoId: i.produtoId, quantidade: i.quantidade, tamanho: i.tamanho, adicionais: i.adicionais, removidos: i.removidos, observacao: i.observacao }; });
    }

    function orcamento() {
      if (estado.carrinho.length === 0) return { subtotal: 0, taxaEntrega: 0, desconto: 0, total: 0, cupomErro: '' };
      try {
        return R.orcar(estado.loja, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: estado.cupom.codigo });
      } catch (e) {
        /* um item saiu do cardapio no meio do pedido: a tela mostra o motivo em vez de "GRATIS" */
        return { subtotal: 0, taxaEntrega: 0, desconto: 0, total: 0, cupomErro: '', erro: e && e.message ? e.message : 'Algo mudou no cardápio.' };
      }
    }

    function quantidadeTotal() { return estado.carrinho.reduce(function (s, i) { return s + i.quantidade; }, 0); }

    function atualizarBarraCarrinho() {
      var barra = $('barraCarrinho');
      if (!barra) return;
      guardarRascunho();
      var naTelaCardapio = $('tela-cardapio').classList.contains('ativa');
      var q = quantidadeTotal();
      barra.classList.toggle('visivel', naTelaCardapio && q > 0);
      var orc = orcamento();
      if (q > 0) {
        $('barraQtd').textContent = q + (q === 1 ? ' item' : ' itens');
        $('barraValor').textContent = dinheiro(orc.subtotal);
        $('carrinhoBarraQtd').textContent = q + (q === 1 ? ' item' : ' itens');
        $('carrinhoBarraValor').textContent = orc.erro ? '—' : (orc.total === 0 ? 'GRÁTIS' : dinheiro(orc.total));
        $('dadosBarraValor').textContent = orc.erro ? '—' : (orc.total === 0 ? 'GRÁTIS' : dinheiro(orc.total));
      } else {
        $('barraQtd').textContent = '0 itens';
        $('barraValor').textContent = dinheiro(0);
        $('carrinhoBarraQtd').textContent = '0 itens';
        $('carrinhoBarraValor').textContent = dinheiro(0);
        $('dadosBarraValor').textContent = dinheiro(0);
      }
      var lojaAtual = estado.loja || {};
      var alvo = (!lojaAtual.freteGratis && Number(lojaAtual.taxaEntrega) > 0) ? (Number(lojaAtual.entregaGratisAcima) || 0) : 0;
      var prog = $('progressoEntrega');
      if (estado.tipoEntrega === 'entrega' && alvo > 0 && q > 0) {
        var falta = alvo - orc.subtotal;
        $('progressoTexto').textContent = falta > 0 ? 'Faltam ' + dinheiro(falta) + ' para a entrega sair de graça' : '🎉 Boa! Sua entrega saiu de graça.';
        $('progressoBarra').style.width = Math.min(100, Math.round((orc.subtotal / alvo) * 100)) + '%';
        prog.hidden = false;
      } else prog.hidden = true;
      UI.medirBarras();
    }

    function montarCarrinho() {
      var lista = $('listaCarrinho');
      UI.limpar(lista);
      var totais = $('totaisCarrinho');
      if (estado.carrinho.length === 0) {
        lista.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone', text: '🛒' }), el('p', { text: 'Seu pedido está vazio' })]));
        totais.hidden = true;
        $('btnIrDados').disabled = true;
        return;
      }
      totais.hidden = false;
      var orcAgora = orcamento();
      $('btnIrDados').disabled = !!orcAgora.erro;
      if (orcAgora.erro) lista.appendChild(el('div', { class: 'msg-erro', text: orcAgora.erro + ' Tire esse item do pedido para continuar.' }));
      /* pedido minimo: avisa aqui, nao so no ultimo clique */
      var minimo = Number(estado.loja.pedidoMinimo) || 0;
      if (!orcAgora.erro && minimo > 0 && orcAgora.subtotal < minimo) {
        $('btnIrDados').disabled = true;
        lista.appendChild(el('div', { class: 'msg-erro', text: 'O pedido mínimo desta loja é ' + dinheiro(minimo) + '. Faltam ' + dinheiro(minimo - orcAgora.subtotal) + '.' }));
      }
      estado.carrinho.forEach(function (item) {
        var detalhes = [];
        if (item.tamanhoNome) detalhes.push(item.tamanhoNome);
        if (item.adicionaisNomes.length) detalhes.push('Com ' + item.adicionaisNomes.join(', '));
        if (item.observacao) detalhes.push('Obs: ' + item.observacao);
        var det = el('div', { class: 'detalhes', text: detalhes.join(' · ') });
        if (item.removidos.length) det.appendChild(el('div', { class: 'sem', text: 'SEM: ' + item.removidos.join(', ') }));
        var produtoDoItem = (estado.loja.produtos || []).filter(function (x) { return x.id === item.produtoId; })[0];
        var srcItem = D.fotoSrc(produtoDoItem, estado.fotos);
        lista.appendChild(el('div', { class: 'item-carrinho' }, [
          el('span', { class: 'miniatura' }, srcItem ? el('img', { src: srcItem, alt: '' }) : (item.emoji || '🍽️')),
          el('div', { class: 'corpo' }, [
            el('div', { class: 'nome', text: item.quantidade + 'x ' + item.nome }),
            det,
            el('div', { class: 'linha-preco' }, [
              el('span', { class: 'preco', text: dinheiro(item.precoUnitario * item.quantidade) }),
              el('button', { class: 'remover-item', type: 'button', text: 'Remover', onclick: function () {
                estado.carrinho = estado.carrinho.filter(function (i) { return i.idLocal !== item.idLocal; });
                UI.soar('remover');
                montarCarrinho();
                atualizarBarraCarrinho();
              } }),
            ]),
          ]),
        ]));
      });

      var orc = orcamento();
      UI.limpar(totais);
      totais.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Itens' }), el('span', { text: dinheiro(orc.subtotal) })]));
      if (estado.tipoEntrega === 'entrega') {
        totais.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Entrega' }), orc.taxaEntrega > 0 ? el('span', { text: dinheiro(orc.taxaEntrega) }) : el('span', { class: 'gratis', text: 'GRÁTIS' })]));
      }
      if (orc.desconto > 0) totais.appendChild(el('div', { class: 'linha desconto' }, [el('span', { text: 'Cupom ' + estado.cupom.codigo + ' (' + orc.cupomPercentual + '%)' }), el('span', { text: '− ' + dinheiro(orc.desconto) })]));
      totais.appendChild(el('div', { class: 'linha total' }, [el('span', { text: 'Total' }), el('span', { text: orc.total === 0 ? 'GRÁTIS' : dinheiro(orc.total) })]));
      pintarCupom();
    }

    /* cupom */
    function pintarCupom() {
      if (estado.cupom.codigo && estado.carrinho.length) {
        /* o pedido mudou e o cupom deixou de valer (tirou item e ficou abaixo do minimo): avisa na hora */
        var orcC = orcamento();
        if (orcC.cupomErro) {
          estado.cupom = { codigo: '', percentual: 0, desconto: 0 };
          $('msgCupom').hidden = false;
          $('msgCupom').textContent = orcC.cupomErro;
          $('formCupom').hidden = false;
        }
      }
      var tem = !!estado.cupom.codigo;
      $('cupomValendo').hidden = !tem;
      /* o botao "tenho um codigo" some quando o cupom vale OU quando o campo de digitar ja esta aberto */
      $('btnAbrirCupom').hidden = tem || !$('formCupom').hidden;
      if (tem) {
        $('formCupom').hidden = true;
        $('cupomNome').textContent = estado.cupom.codigo;
        $('cupomQuanto').textContent = estado.cupom.percentual === 100 ? 'pedido grátis' : '−' + estado.cupom.percentual + '% nos itens';
      }
      $('blocoCupom').hidden = !(estado.loja && estado.loja.cupons && estado.loja.cupons.length) && !tem;
    }
    $('btnAbrirCupom').addEventListener('click', function () { $('formCupom').hidden = false; $('btnAbrirCupom').hidden = true; $('campoCupom').focus(); });
    $('btnTirarCupom').addEventListener('click', function () { estado.cupom = { codigo: '', percentual: 0, desconto: 0 }; $('campoCupom').value = ''; $('msgCupom').hidden = true; montarCarrinho(); atualizarBarraCarrinho(); });
    function aplicarCupom() {
      var digitado = $('campoCupom').value.trim();
      var msg = $('msgCupom');
      if (!digitado) { msg.hidden = false; msg.textContent = 'Digite o código para aplicar.'; return; }
      if (estado.carrinho.length === 0) { msg.hidden = false; msg.textContent = 'Adicione um item antes do código.'; return; }
      var orc;
      try { orc = R.orcar(estado.loja, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: digitado }); }
      catch (e) { msg.hidden = false; msg.textContent = e && e.message ? e.message : 'Algo mudou no cardápio. Confira o pedido.'; return; }
      if (orc.cupomErro) { UI.soar('erro'); msg.hidden = false; msg.textContent = orc.cupomErro; estado.cupom = { codigo: '', percentual: 0, desconto: 0 }; return; }
      msg.hidden = true;
      estado.cupom = { codigo: orc.cupom, percentual: orc.cupomPercentual, desconto: orc.desconto };
      UI.soar('sucesso');
      UI.avisar('Código aplicado! −' + dinheiro(orc.desconto));
      montarCarrinho();
      atualizarBarraCarrinho();
    }
    $('btnAplicarCupom').addEventListener('click', aplicarCupom);
    $('campoCupom').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); aplicarCupom(); } });

    $('btnVerCarrinho').addEventListener('click', function () { irPara('tela-carrinho'); });
    $('btnAddMais').addEventListener('click', function () { irPara('tela-cardapio'); });
    $('btnIrDados').addEventListener('click', function () {
      if (estado.carrinho.length === 0) return UI.avisar('Escolha pelo menos um item.');
      preencherDadosSalvos();
      atualizarFormasDePagamento();
      irPara('tela-dados');
    });

    /* ---------- dados e pagamento ---------- */

    function formaEscolhida() {
      var m = raiz.querySelector('input[name="formaPagamento"]:checked');
      return m ? m.value : 'pix';
    }

    function marcarFormaEscolhida() {
      raiz.querySelectorAll('.forma-pgto').forEach(function (f) { f.classList.toggle('marcada', f.querySelector('input').checked); });
    }

    function atualizarBotaoPagar() {
      var orc = orcamento();
      $('btnPagar').textContent = orc.total === 0 ? 'Confirmar pedido grátis' : (formaEscolhida() === 'pix' ? 'Pagar no Pix' : 'Confirmar pedido');
    }

    function atualizarFormasDePagamento() {
      var l = estado.loja;
      if (!l) return;
      var naPorta = estado.tipoEntrega === 'entrega' || l.aceitaPagarNoBalcao || balcao;
      var temPix = pixDisponivel(l);
      var temCartao = naPorta && !!l.aceitaCartaoEntrega;
      var temDinheiro = naPorta && !!l.aceitaDinheiroEntrega;
      /* retirada numa loja que so aceita pagar na porta da entrega: diz isso, em vez de "nao configurou pagamento" */
      var soNaEntrega = !naPorta && !temPix && !!(l.aceitaCartaoEntrega || l.aceitaDinheiroEntrega);
      $('semFormaPagamento').textContent = soNaEntrega ? 'Pra retirar no balcão, esta loja só aceita Pix. Escolha "Entrega" pra pagar na porta.' : 'A loja ainda não configurou uma forma de pagamento. Fale com ela pelo WhatsApp.';
      $('opcaoPix').hidden = !temPix;
      $('opcaoCartao').hidden = !temCartao;
      $('opcaoDinheiro').hidden = !temDinheiro;
      var noBalcao = estado.tipoEntrega !== 'entrega';
      $('nomeCartao').textContent = noBalcao ? 'Maquininha no balcão' : 'Maquininha na entrega';
      $('detalheCartao').textContent = noBalcao ? 'Você passa o cartão na hora de pegar' : 'O entregador leva a maquininha até você';
      $('nomeDinheiro').textContent = noBalcao ? 'Dinheiro no balcão' : 'Dinheiro na entrega';
      $('detalheDinheiro').textContent = noBalcao ? 'Paga em espécie quando pegar' : 'Você paga em espécie quando chegar';
      var disponiveis = { pix: temPix, cartao_entrega: temCartao, dinheiro_entrega: temDinheiro };
      if (!disponiveis[formaEscolhida()]) {
        var campos = { pix: 'pgtoPix', cartao_entrega: 'pgtoCartao', dinheiro_entrega: 'pgtoDinheiro' };
        var primeira = Object.keys(disponiveis).filter(function (f) { return disponiveis[f]; })[0];
        if (primeira) { $(campos[primeira]).checked = true; }
      }
      marcarFormaEscolhida();
      var orc = orcamento();
      $('blocoTroco').hidden = orc.total === 0 || formaEscolhida() !== 'dinheiro_entrega';
      /* mesmo com uma forma so o bloco fica: e nele que mora o "precisa de troco?" */
      $('blocoPagamento').hidden = orc.total === 0 || !(temPix || temCartao || temDinheiro);
      $('semFormaPagamento').hidden = temPix || temCartao || temDinheiro;
      atualizarBotaoPagar();
      $('btnPagar').disabled = !(temPix || temCartao || temDinheiro);
      if (!$('blocoTroco').hidden) atualizarTroco();
      renumerarPassos();
    }

    /* Os blocos escondidos (endereco na retirada, pagamento gratis) nao contam: a numeracao fica 1, 2, 3. */
    function renumerarPassos() {
      var n = 0;
      raiz.querySelectorAll('#formDados .bloco-form').forEach(function (b) {
        var num = b.querySelector('.bloco-numero');
        if (!num || b.hidden) return;
        n += 1;
        num.textContent = n;
      });
    }

    raiz.querySelectorAll('input[name="formaPagamento"]').forEach(function (r) {
      r.addEventListener('change', function () { marcarFormaEscolhida(); atualizarBotaoPagar(); $('blocoTroco').hidden = formaEscolhida() !== 'dinheiro_entrega'; if (!$('blocoTroco').hidden) atualizarTroco(); });
    });

    function atualizarTroco() {
      var precisa = $('trocoSim').checked;
      $('campoTrocoValor').hidden = !precisa;
      raiz.querySelectorAll('.opcao-troco').forEach(function (x) { x.classList.toggle('marcada', x.querySelector('input').checked); });
      var total = orcamento().total;
      $('dicaTroco').textContent = 'Seu pedido deu ' + dinheiro(total) + '. Diga o valor da nota que você vai entregar.';
      var caixa = $('trocoCalculado');
      if (!precisa) { caixa.hidden = true; return; }
      var valor = UI.centavosDoCampo($('campoTroco').value);
      if (!valor) { caixa.hidden = true; return; }
      if (valor < total) { caixa.className = 'troco-calculado erro'; caixa.textContent = 'Esse valor é menor que o total (' + dinheiro(total) + ')'; }
      else { caixa.className = 'troco-calculado'; caixa.textContent = 'Seu troco: ' + dinheiro(valor - total); }
      caixa.hidden = false;
    }
    raiz.querySelectorAll('input[name="precisaTroco"]').forEach(function (r) { r.addEventListener('change', atualizarTroco); });
    UI.mascaraDinheiro($('campoTroco'));
    $('campoTroco').addEventListener('input', atualizarTroco);
    UI.mascaraTelefone($('campoTelefone'));

    function preencherDadosSalvos() {
      var salvo = UI.lerLocal(CHAVE_CLIENTE);
      var aviso = $('avisoVolta');
      if (!salvo || balcao) { aviso.hidden = true; return; }
      $('campoNome').value = salvo.nome || '';
      $('campoTelefone').value = salvo.telefone || '';
      var e = salvo.endereco || {};
      $('campoRua').value = e.rua || '';
      $('campoNumero').value = e.numero || '';
      $('campoBairro').value = e.bairro || '';
      $('campoComplemento').value = e.complemento || '';
      $('campoReferencia').value = e.referencia || '';
      if (salvo.nome) { aviso.hidden = false; $('textoVolta').textContent = 'Oi de novo, ' + salvo.nome.split(' ')[0] + '! Já deixamos seus dados preenchidos. Confira se está tudo certo.'; }
      else aviso.hidden = true;
    }

    function salvarDadosDoCliente() {
      if (balcao) return;
      var nome = $('campoNome').value.trim();
      var telefone = $('campoTelefone').value.trim();
      if (!nome && !telefone) return;
      UI.guardarLocal(CHAVE_CLIENTE, {
        nome: nome, telefone: telefone,
        endereco: { rua: $('campoRua').value.trim(), numero: $('campoNumero').value.trim(), bairro: $('campoBairro').value.trim(), complemento: $('campoComplemento').value.trim(), referencia: $('campoReferencia').value.trim() },
      });
    }
    ['campoNome', 'campoTelefone', 'campoRua', 'campoNumero', 'campoBairro', 'campoComplemento', 'campoReferencia'].forEach(function (id) { $(id).addEventListener('change', salvarDadosDoCliente); });

    function validarFormulario() {
      var erros = [];
      raiz.querySelectorAll('#formDados .erro').forEach(function (x) { x.classList.remove('erro'); });
      var nome = $('campoNome').value.trim();
      if (nome.length < 2 && !balcao) { erros.push('Digite seu nome.'); $('campoNome').classList.add('erro'); }
      var telefone = $('campoTelefone').value.replace(/\D/g, '');
      if (telefone.length < 10 && !balcao) { erros.push('Digite seu WhatsApp com DDD.'); $('campoTelefone').classList.add('erro'); }
      if (estado.tipoEntrega === 'entrega') {
        [['campoRua', 'a rua'], ['campoBairro', 'o bairro']].forEach(function (par) {
          if (!$(par[0]).value.trim()) { erros.push('Preencha ' + par[1] + ' da entrega.'); $(par[0]).classList.add('erro'); }
        });
      }
      if (formaEscolhida() === 'dinheiro_entrega' && $('trocoSim').checked) {
        var v = UI.centavosDoCampo($('campoTroco').value);
        if (!v) erros.push('Diga com quanto você vai pagar, para separarem o troco.');
        else if (v < orcamento().total) erros.push('O valor do troco precisa ser maior que o total.');
      }
      var caixa = $('erroDados');
      if (erros.length) {
        UI.soar('erro');
        caixa.hidden = false;
        caixa.textContent = erros[0];
        var primeiro = raiz.querySelector('#formDados .erro');
        if (primeiro) primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return null;
      }
      caixa.hidden = true;
      return {
        nome: nome, telefone: telefone,
        observacao: $('campoObs').value.trim(),
        tipoEntrega: estado.tipoEntrega,
        formaPagamento: formaEscolhida(),
        trocoPara: formaEscolhida() === 'dinheiro_entrega' && $('trocoSim').checked ? UI.centavosDoCampo($('campoTroco').value) : 0,
        endereco: estado.tipoEntrega === 'entrega' ? { rua: $('campoRua').value.trim(), numero: $('campoNumero').value.trim(), bairro: $('campoBairro').value.trim(), complemento: $('campoComplemento').value.trim(), referencia: $('campoReferencia').value.trim() } : {},
        itens: itensParaRegras(),
        cupom: estado.cupom.codigo,
        origem: balcao ? 'balcao' : 'link',
      };
    }

    $('btnPagar').addEventListener('click', function () {
      var dados = validarFormulario();
      if (!dados) return;
      var botao = $('btnPagar');
      botao.disabled = true;
      botao.textContent = 'Enviando…';
      var pedido;
      try {
        pedido = R.montarPedido(estado.loja, dados);
      } catch (erro) {
        UI.soar('erro');
        $('erroDados').hidden = false;
        $('erroDados').textContent = erro.message;
        botao.disabled = false;
        atualizarBotaoPagar();
        return;
      }
      store.criarPedido(estado.loja.slug, pedido).then(function (gravado) {
        estado.pedido = gravado;
        salvarDadosDoCliente();
        if (!balcao) guardarMeuPedido(estado.loja.slug, gravado);
        estado.ultimoCarrinho = estado.carrinho; /* se desistir do Pix, os itens voltam */
        estado.carrinho = [];
        estado.cupom = { codigo: '', percentual: 0, desconto: 0 };
        limparRascunho();
        if (!balcao) history.replaceState(null, '', '#/' + estado.loja.cidadeSlug + '/' + estado.loja.slug + '/pedido/' + gravado.id);
        if (gravado.status === R.STATUS.AGUARDANDO) mostrarPagamento(gravado);
        else mostrarSenha(gravado);
      }).catch(function (erro) {
        UI.soar('erro');
        $('erroDados').hidden = false;
        $('erroDados').textContent = erro.message || 'Não conseguimos enviar o pedido. Tente de novo.';
      }).then(function () {
        botao.disabled = false;
        atualizarBotaoPagar();
      });
    });

    /* ---------- Pix ---------- */

    /* Pix e sempre automatico: a loja liga o Mercado Pago no painel. Na demonstracao, simula. */
    function pixDisponivel(l) {
      var cfg = window.LIGEIRO_CONFIG || {};
      return l.aceitaPix !== false && !!l.mpAtivo && (D.modoDemo || !!cfg.proxyMercadoPago);
    }

    /* Pede o codigo Pix pro mensageiro (worker) na hora do pedido; ele grava no pedido e o onSnapshot traz. */
    function pedirCodigoPix(pedido) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo) {
        var codigo = Pix.gerar({ chave: 'demo@ligeiro.app.br', nome: estado.loja.nome, cidade: estado.loja.cidade || 'Juquia', valor: pedido.total, txid: R.txidPix(pedido), descricao: 'Pedido ' + pedido.senha });
        return store.atualizarPedido(estado.loja.slug, pedido.id, { mp: { id: 'SIM-' + pedido.id, criadoEm: new Date().toISOString(), simulado: true }, pixCodigo: codigo }).then(function () {
          /* demonstracao: "cai" em 20 segundos */
          setTimeout(function () {
            store.obterPedido(estado.loja.slug, pedido.id).then(function (p) {
              if (p && p.status === R.STATUS.AGUARDANDO) store.atualizarPedido(estado.loja.slug, pedido.id, { status: R.STATUS.PAGO, pagamentoStatus: 'pago', pagoEm: new Date().toISOString(), confirmadoPor: 'simulacao' });
            });
          }, 20000);
          return codigo;
        });
      }
      return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/criar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loja: estado.loja.slug, pedido: pedido.id }),
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.codigo) throw new Error(j.erro || 'O Pix não veio.'); return j.codigo; }); });
    }

    /* Enquanto espera o Pix cair: pergunta ao mensageiro a cada 8 s (o webhook do Mercado Pago e o caminho principal). */
    function vigiarPix(pedido) {
      pararVigia();
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || !cfg.proxyMercadoPago) return;
      estado.vigiaPix = setInterval(function () {
        if (!estado.pedido || estado.pedido.id !== pedido.id || estado.pedido.status !== R.STATUS.AGUARDANDO) { pararVigia(); return; }
        fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/status?loja=' + encodeURIComponent(estado.loja.slug) + '&pedido=' + encodeURIComponent(pedido.id)).catch(function () { /* tenta de novo depois */ });
      }, 8000);
    }
    function pararVigia() { if (estado.vigiaPix) clearInterval(estado.vigiaPix); estado.vigiaPix = null; }

    function mostrarPagamento(pedido) {
      estado.pedido = pedido;
      var codigo = pedido.pixCodigo || '';
      $('pixValor').textContent = dinheiro(pedido.total);
      $('pixNomeLoja').textContent = 'Para: ' + estado.loja.nome;
      var gerando = $('pixGerando');
      var falhou = $('pixFalhou');
      var pronto = !!codigo;
      gerando.hidden = pronto;
      falhou.hidden = true;
      $('pixQr').hidden = !pronto;
      $('pixCodigo').hidden = !pronto;
      $('btnCopiarPix').hidden = !pronto;
      $('passosPix').hidden = !pronto;
      if (pronto) {
        $('pixCodigo').textContent = codigo;
        var desenhou = Pix.desenharQr($('pixQr'), codigo, 260);
        $('pixQr').hidden = !desenhou;
        $('btnCopiarPix').onclick = function () {
          UI.copiar(codigo).then(function (ok) { UI.avisar(ok ? 'Código copiado! Cole no app do seu banco.' : 'Não deu pra copiar sozinho. Toque e segure no código pra copiar.'); });
        };
      } else if (!estado.pedindoPix) {
        estado.pedindoPix = true;
        pedirCodigoPix(pedido).then(function (c) {
          estado.pedindoPix = false;
          if (!estado.pedido || estado.pedido.id !== pedido.id) return;
          if (!estado.pedido.pixCodigo) mostrarPagamento(Object.assign({}, estado.pedido, { pixCodigo: c }));
        }).catch(function (e) {
          estado.pedindoPix = false;
          if (!estado.pedido || estado.pedido.id !== pedido.id) return;
          /* o codigo pode ter chegado por outro caminho (onSnapshot) enquanto isso: ai nao e falha */
          if (estado.pedido.pixCodigo) { mostrarPagamento(estado.pedido); return; }
          gerando.hidden = true;
          falhou.hidden = false;
          $('pixFalhouTexto').textContent = 'Não deu pra gerar o Pix agora' + (e && e.message ? ' (' + e.message + ')' : '') + '. Tente de novo ou desista e escolha outra forma de pagamento.';
        });
      }
      irPara('tela-pagamento');
      acompanhar(pedido);
      vigiarPix(pedido);
    }

    $('btnTentarPix').addEventListener('click', function () { if (estado.pedido) mostrarPagamento(estado.pedido); });

    $('btnCancelarPix').addEventListener('click', function () {
      UI.perguntar('Desistir deste pedido? Ele sai da fila da loja e seus itens voltam pro carrinho.', { sim: 'Desistir', nao: 'Continuar pagando', perigo: true }).then(function (sim) {
        if (!sim || !estado.pedido) return;
        var idCancelado = estado.pedido.id;
        store.atualizarPedido(estado.loja.slug, idCancelado, { status: R.STATUS.CANCELADO, canceladoPor: 'cliente' }).then(function () {
          pararAcompanhar();
          pararVigia();
          atualizarMeuPedido({ id: idCancelado, status: R.STATUS.CANCELADO });
          estado.pedido = null;
          history.replaceState(null, '', '#/' + estado.loja.cidadeSlug + '/' + estado.loja.slug);
          if (estado.ultimoCarrinho && estado.ultimoCarrinho.length) {
            estado.carrinho = estado.ultimoCarrinho; estado.ultimoCarrinho = null;
            irPara('tela-carrinho');
            atualizarBarraCarrinho();
            UI.avisar('Pedido cancelado. Seus itens continuam aqui.');
          } else {
            irPara('tela-inicio');
            UI.avisar('Pedido cancelado.');
          }
        }).catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu pra cancelar. Tente de novo.'); });
      });
    });

    /* ---------- senha e acompanhamento ---------- */

    function mostrarSenha(pedido) {
      estado.pedido = pedido;
      $('senhaNumero').textContent = pedido.senha;
      var confirmado = $('confirmado');
      if (pedido.status === R.STATUS.AGUARDANDO) confirmado.textContent = '⏳ Pedido enviado, esperando a loja conferir o Pix';
      else if (pedido.status === R.STATUS.CANCELADO) confirmado.textContent = '✕ Pedido cancelado';
      else confirmado.textContent = (pedido.pagamentoStatus === 'na_entrega' || pedido.total === 0) ? '✅ Pedido confirmado' : '✅ Pagamento confirmado';
      $('senhaInstrucao').textContent = R.textoDoEstagio(pedido, estado.loja);

      var aviso = $('avisoACobrar');
      if (pedido.pagamentoStatus === 'na_entrega' && pedido.status !== R.STATUS.CANCELADO) {
        var noBalcao = pedido.tipoEntrega !== 'entrega';
        if (pedido.formaPagamento === 'dinheiro_entrega') {
          aviso.textContent = pedido.trocoPara > 0
            ? '💵 Separe ' + dinheiro(pedido.trocoPara) + '. ' + (noBalcao ? 'O caixa' : 'O entregador') + ' devolve ' + dinheiro(pedido.trocoPara - pedido.total) + ' de troco.'
            : '💵 Separe ' + dinheiro(pedido.total) + ' em dinheiro' + (noBalcao ? ' para pagar no balcão.' : ' para pagar na entrega.');
        } else {
          aviso.textContent = '💳 ' + dinheiro(pedido.total) + ' na maquininha' + (noBalcao ? ', no balcão.' : ', quando o entregador chegar.');
        }
        aviso.hidden = false;
      } else if (pedido.desconto > 0) {
        aviso.textContent = pedido.total === 0 ? '🎟️ Cupom ' + pedido.cupom + ': este pedido é cortesia.' : '🎟️ Cupom ' + pedido.cupom + ': você economizou ' + dinheiro(pedido.desconto);
        aviso.hidden = false;
      } else aviso.hidden = true;

      montarLinhaDoTempo(pedido);

      var whats = $('btnWhatsCliente');
      if (estado.loja.whatsapp && !balcao) { whats.href = R.linkWhatsapp(estado.loja.whatsapp, R.mensagemDoCliente(estado.loja, pedido)); whats.hidden = false; }
      else whats.hidden = true;

      var voltarPix = $('btnVoltarPix');
      voltarPix.hidden = !(pedido.status === R.STATUS.AGUARDANDO && !balcao);

      irPara('tela-senha');
      if (pedido.status !== R.STATUS.CANCELADO) { UI.vibrar(); UI.soar('sucesso'); }
      acompanhar(pedido);

      if (balcao) {
        clearTimeout(estado.relogioBalcao);
        estado.relogioBalcao = setTimeout(function () { novoPedido(); }, pedido.status === R.STATUS.AGUARDANDO ? 90000 : 30000);
      }
    }

    $('btnVoltarPix').addEventListener('click', function () { if (estado.pedido) mostrarPagamento(estado.pedido); });

    function montarLinhaDoTempo(pedido) {
      var entrega = pedido.tipoEntrega === 'entrega';
      var etapas = [
        { chave: R.STATUS.PAGO, icone: '💳', texto: pedido.pagamentoStatus === 'na_entrega' || pedido.total === 0 ? 'Pedido confirmado' : 'Pix confirmado' },
        { chave: R.STATUS.PRODUCAO, icone: '🔥', texto: 'Preparando' },
        { chave: R.STATUS.PRONTO, icone: entrega ? '🛵' : '🛍️', texto: entrega ? 'Saiu para entrega' : 'Pronto para retirar' },
        { chave: R.STATUS.FINALIZADO, icone: '🎉', texto: entrega ? 'Entregue' : 'Retirado' },
      ];
      var posicao = etapas.map(function (e) { return e.chave; }).indexOf(pedido.status);
      var c = $('linhaDoTempo');
      UI.limpar(c);
      if (pedido.status === R.STATUS.CANCELADO) return;
      etapas.forEach(function (etapa, i) {
        var feita = posicao > i;
        var atual = posicao === i;
        c.appendChild(el('div', { class: 'etapa' + (feita ? ' feita' : '') + (atual ? ' atual' : '') }, [
          el('span', { class: 'bolha', text: feita ? '✓' : etapa.icone }),
          el('span', { class: 'texto', text: etapa.texto }),
        ]));
      });
    }

    function acompanhar(pedido) {
      pararAcompanhar();
      estado.pararPedido = store.assistirPedido(estado.loja.slug, pedido.id, function (novo) {
        if (!novo || !estado.pedido || novo.id !== estado.pedido.id) return;
        var mudou = novo.status !== estado.pedido.status;
        var codigoNovo = !!novo.pixCodigo && novo.pixCodigo !== estado.pedido.pixCodigo;
        estado.pedido = novo;
        atualizarMeuPedido(novo);
        if (codigoNovo && !mudou && $('tela-pagamento').classList.contains('ativa')) { mostrarPagamento(novo); return; }
        if (!mudou) return;
        if ($('tela-pagamento').classList.contains('ativa') && novo.status !== R.STATUS.AGUARDANDO) { pararVigia(); if (novo.status === R.STATUS.PAGO) { UI.soar('sucesso'); UI.vibrar([80, 40, 80]); } mostrarSenha(novo); return; }
        if ($('tela-senha').classList.contains('ativa')) {
          $('senhaInstrucao').textContent = R.textoDoEstagio(novo, estado.loja);
          montarLinhaDoTempo(novo);
          if (novo.status === R.STATUS.PAGO) $('confirmado').textContent = '✅ Pagamento confirmado';
          if (novo.status === R.STATUS.CANCELADO) $('confirmado').textContent = '✕ Pedido cancelado';
          $('btnVoltarPix').hidden = true;
          UI.avisar(R.rotuloStatus(novo));
          UI.vibrar([120]);
        }
      });
    }

    function pararAcompanhar() {
      if (typeof estado.pararPedido === 'function') estado.pararPedido();
      estado.pararPedido = null;
    }

    function abrirPedidoSalvo(id) {
      store.obterPedido(slug, id).then(function (p) {
        if (!vivo) return;
        if (!p) { UI.avisar('Não achamos esse pedido.'); return; }
        estado.pedido = p;
        if (p.status === R.STATUS.AGUARDANDO) mostrarPagamento(p);
        else mostrarSenha(p);
      });
    }

    /* pedido "andando" de mais de 12 horas atras ja acabou (a aba fechou antes do ultimo status) */
    function andandoAgora(p) {
      if (p.lojaSlug !== slug) return false;
      if (p.status && R.EM_ANDAMENTO.indexOf(p.status) < 0) return false;
      var t = new Date(p.criadoEm || 0).getTime();
      return !t || Date.now() - t < 12 * 3600e3;
    }
    function temPedidoAndando() {
      return lerMeusPedidos().some(andandoAgora);
    }

    function atualizarFaixaAcompanhar() {
      var faixa = $('faixaAcompanhar');
      if (!faixa) return;
      var andando = lerMeusPedidos().filter(andandoAgora);
      faixa.hidden = balcao || andando.length === 0 || !$('tela-inicio').classList.contains('ativa');
      if (andando.length) {
        $('faixaTexto').textContent = andando.length === 1 ? 'Acompanhar meu pedido (senha ' + andando[0].senha + ')' : 'Acompanhar meus pedidos (' + andando.length + ')';
        faixa.onclick = function () {
          if (andando.length === 1) abrirPedidoSalvo(andando[0].id);
          else abrirMeusPedidos();
        };
      }
    }

    function abrirMeusPedidos() {
      var lista = $('listaMeusPedidos');
      UI.limpar(lista);
      var meus = lerMeusPedidos().filter(function (p) { return p.lojaSlug === slug; });
      if (meus.length === 0) lista.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone', text: '📦' }), el('p', { text: 'Nenhum pedido por aqui' })]));
      meus.forEach(function (p) {
        lista.appendChild(el('button', { class: 'escolha-grande', onclick: function () { abrirPedidoSalvo(p.id); } }, [
          el('span', { class: 'icone', text: R.EM_ANDAMENTO.indexOf(p.status) >= 0 ? '🛵' : '✅' }),
          el('span', {}, [
            el('span', { class: 'rotulo', text: 'Senha ' + p.senha }),
            el('span', { class: 'detalhe', text: UI.dataCurta(p.criadoEm) + ' ' + UI.horaCurta(p.criadoEm) + ' · ' + dinheiro(p.total) + ' · ' + R.rotuloStatus(p) }),
          ]),
          el('span', { class: 'seta', text: '→' }),
        ]));
      });
      irPara('tela-meus-pedidos');
    }

    function novoPedido() {
      pararAcompanhar();
      clearTimeout(estado.relogioBalcao);
      estado.carrinho = [];
      estado.pedido = null;
      estado.cupom = { codigo: '', percentual: 0, desconto: 0 };
      limparRascunho();
      /* o formulario nao pode carregar o nome, o recado e o troco do cliente anterior (balcao) */
      var form = $('formDados');
      if (form) {
        if (balcao) form.reset();
        else { $('campoObs').value = ''; $('trocoNao').checked = true; $('campoTroco').value = ''; }
        $('campoTrocoValor').hidden = true;
        $('blocoTroco').hidden = true;
        $('erroDados').hidden = true;
        marcarFormaEscolhida();
        atualizarTroco();
      }
      if (!balcao) history.replaceState(null, '', '#/' + estado.loja.cidadeSlug + '/' + estado.loja.slug);
      irPara('tela-inicio');
      atualizarFaixaAcompanhar();
    }
    $('btnNovoPedido').addEventListener('click', novoPedido);
    $('btnVoltarInicio').addEventListener('click', function () { irPara('tela-inicio'); });

    return function () {
      vivo = false;
      raiz.className = raiz.className.replace(/\btema-[a-z0-9-]+\b|\bloja-oficial\b/g, '').trim();
      UI.limparTema();
      pararAcompanhar();
      clearTimeout(estado.relogioBalcao);
      if (typeof estado.pararLoja === 'function') estado.pararLoja();
      document.title = 'Ligeiro — pedido ligeiro, sem comissão';
    };
  }

  /* ============================================================
   * O HTML das telas da loja (escrito por nos: o que vem de fora
   * entra sempre por textContent, nunca aqui dentro).
   * ========================================================== */

  function esqueletoDaLoja(balcao) {
    return '' +
    '<button class="faixa-acompanhar" id="faixaAcompanhar" hidden><span>📦</span><span id="faixaTexto"></span><span class="seta">→</span></button>' +

    '<section class="tela ativa" id="tela-inicio">' +
      '<div class="abertura">' +
        '<div class="capa-loja" id="capaLoja" hidden></div>' +
        '<div class="logo-grande" id="logoLoja"></div>' +
        '<h1 class="promessa" id="nomeLoja"></h1>' +
        '<p class="muted" id="descLoja" style="margin-top:-6px"></p>' +
        '<div class="selos"><div class="selo" id="seloAberto"><span class="bolinha"></span><span id="textoAberto">Carregando…</span></div>' +
        '<div class="selo" id="seloFrete" hidden>🛵 Entrega grátis</div></div>' +
        '<div class="aviso-topo" id="avisoTopo" hidden></div>' +
        '<button class="btn btn-principal btn-gigante btn-largo" id="btnComecar" style="max-width:440px">' +
          '<span><span id="btnComecarForte">PEDIR AGORA</span><span class="sub" id="btnComecarFraca"></span></span>' +
        '</button>' +
        '<div class="como-funciona">' +
          '<div class="como-passo"><span class="n">1</span>Escolha<br>do seu jeito</div>' +
          '<div class="como-passo"><span class="n">2</span><span id="comoPagamento"></span></div>' +
          '<div class="como-passo"><span class="n">3</span>Acompanhe<br>pela senha</div>' +
        '</div>' +
        '<div id="destaques" hidden style="width:100%;max-width:440px;text-align:left">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 10px"><b>Os mais pedidos</b><button class="cupom-abrir" id="btnCardapio">ver cardápio →</button></div>' +
          '<div class="pilha" id="destaquesTrilho"></div>' +
        '</div>' +
      '</div>' +
      '<div class="fim-inicio" id="fimInicio"></div>' +
      '<footer class="rodape">' +
        '<div id="enderecoLoja"></div>' +
        '<div class="contatos" id="contatosLoja"></div>' +
        '<button class="cupom-abrir" id="btnOutrasLojas" style="text-align:center;width:100%"></button>' +
        '<div class="ligeiro"><a href="#/lojas">Feito com Ligeiro · quero isso na minha loja →</a></div>' +
      '</footer>' +
    '</section>' +

    '<section class="tela" id="tela-meus-pedidos">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-inicio" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Acompanhamento</div><div class="topo-titulo">Meus pedidos</div></div></header>' +
      '<div class="conteudo"><div class="pilha" id="listaMeusPedidos"></div>' +
      '<p class="nota">🔒 Seus pedidos ficam guardados só neste aparelho.</p>' +
      '<button class="btn btn-fantasma btn-largo" id="btnVoltarInicio">Fazer um novo pedido</button></div>' +
    '</section>' +

    '<section class="tela" id="tela-tipo">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-inicio" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 1 de 4</div><div class="topo-titulo">Como você quer receber?</div></div></header>' +
      '<div class="escolhas">' +
        '<button class="escolha-grande" id="opcaoEntrega" data-tipo="entrega"><span class="icone">🛵</span><span><span class="rotulo">Quero entrega</span><span class="detalhe" id="detalheEntrega"></span></span><span class="seta">→</span></button>' +
        '<button class="escolha-grande" id="opcaoRetirada" data-tipo="retirada"><span class="icone">🛍️</span><span><span class="rotulo">Vou buscar</span><span class="detalhe" id="detalheRetirada"></span></span><span class="seta">→</span></button>' +
      '</div>' +
    '</section>' +

    '<section class="tela" id="tela-cardapio">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-tipo" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 2 de 4</div><div class="topo-titulo">Escolha o que quer</div></div></header>' +
      '<nav class="abas" id="abas"></nav>' +
      '<div class="grade" id="grade"></div>' +
    '</section>' +

    '<section class="tela" id="tela-carrinho">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-cardapio" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 3 de 4</div><div class="topo-titulo">Confira seu pedido</div></div></header>' +
      '<div class="conteudo">' +
        '<div class="pilha" id="listaCarrinho"></div>' +
        '<div id="blocoCupom" hidden>' +
          '<button type="button" class="cupom-abrir" id="btnAbrirCupom">🎟️ Tenho um código de desconto</button>' +
          '<div class="cupom-linha campo" id="formCupom" hidden><input type="text" id="campoCupom" placeholder="Digite o código" autocapitalize="characters" autocomplete="off" maxlength="20" aria-label="Código de desconto"><button type="button" class="btn btn-escuro" id="btnAplicarCupom">Aplicar</button></div>' +
          '<p class="cupom-recado" id="msgCupom" hidden></p>' +
          '<div class="cupom-valendo" id="cupomValendo" hidden><span>🎟️ <b id="cupomNome"></b> <span id="cupomQuanto"></span></span><button type="button" id="btnTirarCupom">Tirar</button></div>' +
        '</div>' +
        '<div class="totais" id="totaisCarrinho"></div>' +
        '<button class="btn btn-fantasma btn-largo" id="btnAddMais">+ Adicionar mais alguma coisa</button>' +
      '</div>' +
      '<div class="barra-carrinho visivel"><div class="linha-barra"><div class="resumo"><div class="qtd" id="carrinhoBarraQtd"></div><div class="valor" id="carrinhoBarraValor"></div></div><button class="btn btn-principal" id="btnIrDados">Continuar →</button></div></div>' +
    '</section>' +

    '<section class="tela" id="tela-dados">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-carrinho" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 4 de 4</div><div class="topo-titulo">' + (balcao ? 'Quase lá' : 'Seus dados') + '</div></div></header>' +
      '<div class="conteudo">' +
        '<div class="aviso" id="avisoVolta" hidden><span style="font-size:24px">👋</span><span id="textoVolta"></span></div>' +
        '<form id="formDados" novalidate>' +
          '<div class="bloco-form">' +
            '<div class="bloco-titulo"><span class="bloco-numero">1</span>' + (balcao ? 'Seu nome, pra te chamar' : 'Quem vai receber') + '</div>' +
            '<div class="campo"><label for="campoNome">' + (balcao ? 'Seu nome <span class="opcional">opcional</span>' : 'Seu nome') + '</label><input type="text" id="campoNome" name="nome" placeholder="Como te chamamos?" autocomplete="name" maxlength="80"></div>' +
            '<div class="campo"' + (balcao ? ' hidden' : '') + '><label for="campoTelefone">Seu WhatsApp</label><p class="ajuda">É por aqui que a loja te avisa se precisar.</p><input type="tel" id="campoTelefone" name="telefone" placeholder="(13) 99999-9999" autocomplete="tel" inputmode="numeric" maxlength="16"></div>' +
          '</div>' +
          '<div class="bloco-form" id="blocoEndereco" hidden>' +
            '<div class="bloco-titulo"><span class="bloco-numero">2</span> Onde entregar</div>' +
            '<div class="campo"><label for="campoRua">Rua</label><input type="text" id="campoRua" placeholder="Nome da rua" autocomplete="address-line1" maxlength="120"></div>' +
            '<div class="linha-campos"><div class="campo"><label for="campoBairro">Bairro</label><input type="text" id="campoBairro" placeholder="Centro" maxlength="80"></div><div class="campo"><label for="campoNumero">Número</label><input type="text" id="campoNumero" placeholder="123" inputmode="numeric" maxlength="12"></div></div>' +
            '<div class="campo"><label for="campoReferencia">Ponto de referência</label><p class="ajuda">Vale mais que CEP. Ex: perto do mercado, portão azul.</p><input type="text" id="campoReferencia" placeholder="Em frente à praça, portão azul" maxlength="140"></div>' +
            '<div class="campo"><label for="campoComplemento">Complemento <span class="opcional">opcional</span></label><input type="text" id="campoComplemento" placeholder="Casa, apto, fundos…" maxlength="80"></div>' +
          '</div>' +
          '<div class="bloco-form" id="blocoPagamento">' +
            '<div class="bloco-titulo"><span class="bloco-numero">3</span> Como você quer pagar?</div>' +
            '<label class="forma-pgto marcada" for="pgtoPix" id="opcaoPix"><input type="radio" name="formaPagamento" id="pgtoPix" value="pix" checked><span class="forma-icone">📱</span><span class="forma-texto"><span class="forma-nome">Pix agora</span><span class="forma-detalhe">Paga pelo celular, direto pra loja</span></span><span class="forma-marca">✓</span></label>' +
            '<label class="forma-pgto" for="pgtoCartao" id="opcaoCartao" hidden><input type="radio" name="formaPagamento" id="pgtoCartao" value="cartao_entrega"><span class="forma-icone">💳</span><span class="forma-texto"><span class="forma-nome" id="nomeCartao">Maquininha na entrega</span><span class="forma-detalhe" id="detalheCartao"></span></span><span class="forma-marca">✓</span></label>' +
            '<label class="forma-pgto" for="pgtoDinheiro" id="opcaoDinheiro" hidden><input type="radio" name="formaPagamento" id="pgtoDinheiro" value="dinheiro_entrega"><span class="forma-icone">💵</span><span class="forma-texto"><span class="forma-nome" id="nomeDinheiro">Dinheiro na entrega</span><span class="forma-detalhe" id="detalheDinheiro"></span></span><span class="forma-marca">✓</span></label>' +
            '<div id="blocoTroco" hidden>' +
              '<div class="forte" style="margin:6px 0 8px">Precisa de troco?</div>' +
              '<label class="opcao opcao-troco marcada" for="trocoNao"><input type="radio" class="opcao-campo" name="precisaTroco" id="trocoNao" value="nao" checked><span class="marcador redondo">✓</span><span class="rotulo">Não, tenho o valor certo</span></label>' +
              '<label class="opcao opcao-troco" for="trocoSim"><input type="radio" class="opcao-campo" name="precisaTroco" id="trocoSim" value="sim"><span class="marcador redondo">✓</span><span class="rotulo">Sim, vou pagar com uma nota maior</span></label>' +
              '<div class="campo" id="campoTrocoValor" hidden style="margin-top:12px"><label for="campoTroco">Vou pagar com quanto?</label><p class="ajuda" id="dicaTroco"></p><input type="text" id="campoTroco" inputmode="numeric" placeholder="R$ 50,00" maxlength="12"><div class="troco-calculado" id="trocoCalculado" hidden></div></div>' +
            '</div>' +
          '</div>' +
          '<div class="msg-erro" id="semFormaPagamento" hidden>A loja ainda não configurou uma forma de pagamento. Fale com ela pelo WhatsApp.</div>' +
          '<div class="bloco-form"><div class="bloco-titulo"><span class="bloco-numero">4</span> Algum recado? <span class="bloco-opcional">opcional</span></div>' +
            '<div class="campo"><textarea id="campoObs" placeholder="Ex: sem cebola em tudo, tocar a campainha…" maxlength="300"></textarea></div>' +
          '</div>' +
          (balcao ? '' : '<p class="nota">🔒 Guardamos seus dados neste aparelho para o próximo pedido ser mais rápido.</p>') +
          '<div class="msg-erro" id="erroDados" hidden></div>' +
        '</form>' +
      '</div>' +
      '<div class="barra-carrinho visivel"><div class="linha-barra"><div class="resumo"><div class="qtd">Total a pagar</div><div class="valor" id="dadosBarraValor"></div></div><button class="btn btn-principal" id="btnPagar">Pagar no Pix</button></div></div>' +
    '</section>' +

    '<section class="tela" id="tela-pagamento">' +
      '<header class="topo"><button class="voltar" id="btnCancelarPix" aria-label="Desistir do pedido" title="Desistir do pedido">✕</button><div class="topo-texto"><div class="topo-passo">Falta só pagar</div><div class="topo-titulo">Pague com Pix</div></div></header>' +
      '<div class="pix">' +
        '<div class="valor-grande" id="pixValor"></div>' +
        '<div class="muted" id="pixNomeLoja"></div>' +
        '<p class="aviso">⚡ Pagou, confirmou: esta tela muda sozinha e o pedido já entra na cozinha.</p>' +
        '<div class="pix-gerando" id="pixGerando"><span class="girando"></span> Gerando o seu Pix…</div>' +
        '<div class="pix-falhou" id="pixFalhou" hidden><p id="pixFalhouTexto"></p><button class="btn btn-escuro btn-pequeno" id="btnTentarPix" type="button">Tentar de novo</button></div>' +
        '<div class="qr-caixa" id="pixQr"></div>' +
        '<div class="passos-pix" id="passosPix">' +
          '<div class="passo-pix"><span class="numero">1</span><span>Abra o aplicativo do seu banco</span></div>' +
          '<div class="passo-pix"><span class="numero">2</span><span>Escolha <b>Pix</b> e depois <b>Pix copia e cola</b> (ou leia o QR)</span></div>' +
          '<div class="passo-pix"><span class="numero">3</span><span>Cole o código, confira o valor e confirme</span></div>' +
        '</div>' +
        '<button class="btn btn-escuro btn-largo" id="btnCopiarPix" style="max-width:440px">📋 Copiar código Pix</button>' +
        '<code class="codigo-pix" id="pixCodigo"></code>' +
        '<p class="nota">O Pix vale por 30 minutos. Não precisa avisar ninguém: assim que cair, você recebe a senha do pedido.</p>' +
      '</div>' +
    '</section>' +

    '<section class="tela" id="tela-senha">' +
      '<div class="sucesso">' +
        '<div class="confirmado" id="confirmado"></div>' +
        '<div class="painel-senha"><div class="rotulo">Sua senha</div><div class="senha-gigante" id="senhaNumero">—</div><div class="instrucao" id="senhaInstrucao"></div></div>' +
        '<div class="a-cobrar" id="avisoACobrar" hidden></div>' +
        '<div class="linha-do-tempo" id="linhaDoTempo"></div>' +
        '<button class="btn btn-fantasma btn-largo" id="btnVoltarPix" style="max-width:420px" hidden>Ver o código Pix de novo</button>' +
        '<a class="btn btn-whats btn-largo" id="btnWhatsCliente" style="max-width:420px" href="#" target="_blank" rel="noopener">💬 Falar com a loja</a>' +
        '<button class="btn btn-fantasma btn-largo" id="btnNovoPedido" style="max-width:420px">' + (balcao ? 'Próximo cliente' : 'Fazer outro pedido') + '</button>' +
      '</div>' +
    '</section>' +

    '<div class="barra-carrinho" id="barraCarrinho">' +
      '<div class="progresso-entrega" id="progressoEntrega" hidden><div id="progressoTexto"></div><div class="progresso-trilho"><span id="progressoBarra"></span></div></div>' +
      '<div class="linha-barra"><div class="resumo"><div class="qtd" id="barraQtd"></div><div class="valor" id="barraValor"></div></div><button class="btn btn-principal" id="btnVerCarrinho">Ver pedido →</button></div>' +
    '</div>';
  }

  window.LigeiroCliente = { hub: hub, cidade: cidade, loja: loja, lerMeusPedidos: lerMeusPedidos };
})();
