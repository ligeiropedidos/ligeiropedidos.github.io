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
    return (gratis ? 'entrega grátis' : 'entrega') + ' em ~' + (l.tempoEntrega || 40) + '\u00a0min';
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
      el('img', { class: 'hub-mascote-fundo', src: 'img/mascote.webp', alt: '' }),
      el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      el('h1', { class: 'hub-titulo so-texto', text: 'Em que cidade você está?' }),
      el('p', { class: 'slogan', text: 'Peça no delivery da sua cidade. Sem app, sem cadastro, sem comissão.' }),
      el('div', { class: 'hub-selos' }, [el('span', {}, [UI.iconeLinha('check'), 'Sem taxa de serviço']), el('span', {}, [UI.iconeLinha('check'), 'Direto com a loja']), el('span', {}, [UI.iconeLinha('check'), 'Acompanha pela senha'])]),
    ]));
    var busca = el('input', { type: 'search', class: 'busca', placeholder: 'Digite o nome da sua cidade', 'aria-label': 'Buscar cidade' });
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
      var detalhe = c.lojas.length + (c.lojas.length === 1 ? ' loja' : ' lojas') + '\u00a0· ' + (abertas ? abertas + (abertas === 1 ? ' aberta agora' : ' abertas agora') : 'nenhuma aberta agora');
      return el('button', { class: 'cidade-linha' + (destaque ? ' minha' : ''), onclick: function () { ir(c.slug); } }, [
        logos,
        el('span', { class: 'cidade-info' }, [
          el('span', { class: 'cidade-nome' }, [c.nome, el('small', { text: '\u00a0· ' + (c.uf || '') })]),
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
          el('img', { class: 'mascote-vazio', src: 'img/mascote.webp', alt: '' }),
          el('p', { class: 'forte', text: termo ? 'Ainda não tem loja em "' + busca.value.trim() + '".' : 'Nenhuma cidade cadastrada ainda.' }),
          el('p', { class: 'muted', text: 'Tem uma lanchonete, pizzaria ou marmitaria aí? Ela pode ser a primeira.' }),
          el('a', { class: 'btn btn-principal', href: '#/', text: 'Cadastrar minha loja' }),
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
      UI.limpar(lista); lista.appendChild(UI.erroCarregar('Não deu para carregar as cidades.')); return null;
    }).then(function (lojas) {
      if (!lojas) return;
      var mapa = Object.create(null); /* cidade "__proto__" gravada por fora nao contamina o site */
      lojas.forEach(function (l) {
        if (l.ativa === false || R.lojaBloqueada(l)) return;
        if (!mapa[l.cidadeSlug]) mapa[l.cidadeSlug] = { slug: l.cidadeSlug, nome: l.cidade, uf: l.uf || '', lojas: [] };
        mapa[l.cidadeSlug].lojas.push(l);
      });
      cidades = Object.keys(mapa).map(function (k) { return mapa[k]; });
      /* so uma cidade com loja: nao faz a pessoa escolher, vai direto pro seletor de lojas */
      if (cidades.length === 1) { window.LigeiroApp.trocar(cidades[0].slug); return; }
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
      /* convite pro lojista: um cartao so, um botao principal e o WhatsApp como segunda opcao */
      var precoUma = R.dinheiro(R.precoDoPlano('uma', 'mensal')).replace(',00', '');
      var dias = (cfg.precos || {}).diasGratis || 7;
      filhos.push(el('div', { class: 'chamada-lojista' }, [
        el('div', { class: 'chamada-texto' }, [
          el('b', { text: 'Tem uma loja? Venda por aqui também.' }),
          el('span', { text: precoUma + ' por mês, sem comissão. ' + dias + ' dias grátis para testar.' }),
        ]),
        el('div', { class: 'chamada-acoes' }, [
          el('a', { class: 'btn btn-principal', href: '#/', text: 'Conhecer o Ligeiro' }),
          cfg.whatsappLigeiro ? el('a', { class: 'chamada-whats', href: R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero colocar meu estabelecimento no Ligeiro.'), target: '_blank', rel: 'noopener', text: 'ou fale no WhatsApp' }) : null,
        ]),
      ]));
    }
    filhos.push(el('div', { class: 'ligeiro' }, [el('a', { href: '#/', text: 'Ligeiro: pedido ligeiro, sem comissão' })]));
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
      el('img', { class: 'hub-mascote-fundo', src: 'img/mascote.webp', alt: '' }),
      el('a', { class: 'marca centro', href: '#/cidades' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      tituloCidade,
      el('p', { class: 'slogan', text: 'Peça pelo link, pague no Pix e acompanhe pela senha. Sem app, sem cadastro.' }),
      el('div', { class: 'hub-selos' }, [el('span', {}, [UI.iconeLinha('check'), 'Sem taxa de serviço']), el('span', {}, [UI.iconeLinha('check'), 'Direto com a loja']), el('span', {}, [UI.iconeLinha('check'), 'Acompanha pela senha'])]),
    ]));

    var busca = el('input', { type: 'search', class: 'busca', placeholder: 'O que você procura? Ex.: pizza, marmita, açaí', 'aria-label': 'Buscar produto ou loja' });
    var chips = el('div', { class: 'hub-chips' });
    var lista = el('div', { class: 'hub-lista' });
    var conteudo = el('div', { class: 'conteudo hub-conteudo' }, [busca, chips, lista]);
    raiz.appendChild(conteudo);

    /* titulo: "Peca no delivery de <cidade>". Com mais de uma cidade no Ligeiro, a cidade vira botao que abre a lista. */
    function pintarTitulo() {
      UI.limpar(tituloCidade);
      var nome = estadoHub.nomeCidade || '';
      var varias = (estadoHub.cidades || []).length > 1;
      tituloCidade.appendChild(el('span', { text: estadoHub.lojas.length || varias ? 'Peça no delivery de' : 'Delivery de' }));
      tituloCidade.appendChild(el('button', { class: 'hub-cidade-seletor', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Escolher a cidade. Agora: ' + nome, onclick: abrirCidades }, [nome, el('span', { class: 'seta' }, [UI.iconeLinha('abrir')])]));
    }
    function abrirCidades() {
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, (estadoHub.cidades || []).map(function (c) {
        var atual = c.slug === cidadeSlug;
        return el('button', { class: 'cidade-linha' + (atual ? ' minha' : ''), type: 'button', onclick: function () { UI.fecharModal(); if (!atual) ir(c.slug); } }, [
          el('span', { class: 'cidade-info' }, [
            el('span', { class: 'cidade-nome' }, [c.nome, el('small', { text: '\u00a0· ' + (c.uf || '') })]),
            el('span', { class: 'cidade-detalhe', text: c.lojas + (c.lojas === 1 ? ' loja' : ' lojas') + '\u00a0· ' + (c.abertas ? c.abertas + (c.abertas === 1 ? ' aberta agora' : ' abertas agora') : 'nenhuma aberta agora') }),
          ]),
          el('span', { class: 'cidade-acao', text: atual ? 'Você está aqui' : 'Ver lojas' }),
        ]);
      }));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', style: { margin: '6px 0 0' } }, ['Sua cidade não está aqui? ', el('a', { href: '#/', onclick: function () { UI.fecharModal(); }, text: 'Leve o Ligeiro para ela' }), '.']));
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
      chips.appendChild(el('button', { class: 'aba-painel' + (estadoHub.soAbertas ? ' ativa' : ''), type: 'button', 'aria-pressed': estadoHub.soAbertas ? 'true' : 'false', onclick: function () { estadoHub.soAbertas = !estadoHub.soAbertas; desenharChips(); desenharLista(); } }, [el('span', { class: 'chip-ponto', 'aria-hidden': 'true' }), 'Abertas agora', abertas ? el('span', { class: 'chip-qtd', text: String(abertas) }) : null]));
      if (tipos.length > 1) tipos.forEach(function (t) {
        chips.appendChild(el('button', { class: 'aba-painel' + (estadoHub.tipo === t ? ' ativa' : ''), type: 'button', text: String(t).toLowerCase() === 'outro' ? 'Outros' : t, onclick: function () { estadoHub.tipo = estadoHub.tipo === t ? '' : t; desenharChips(); desenharLista(); } }));
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

    function desenharLista() {
      situacaoLojas = situacaoAgora();
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
          el('img', { class: 'mascote-vazio', src: 'img/mascote.webp', alt: '' }),
          el('p', { class: 'forte', text: termo ? 'Ninguém aqui vende "' + estadoHub.termo.trim() + '" ainda.' : (estadoHub.soAbertas ? 'Nenhuma loja aberta agora.' : 'Ainda não tem loja nesta cidade.') }),
          el('p', { class: 'muted', text: termo || estadoHub.soAbertas ? 'Tente outra palavra ou tire o filtro.' : 'Tem uma lanchonete, pizzaria ou marmitaria? Ela pode ser a primeira.' }),
          termo || estadoHub.soAbertas
            ? el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Limpar filtros', onclick: function () { estadoHub.termo = ''; busca.value = ''; estadoHub.soAbertas = false; estadoHub.tipo = ''; desenharChips(); desenharLista(); } })
            : el('a', { class: 'btn btn-principal', href: '#/comecar', text: 'Cadastrar minha loja: 7 dias grátis' }),
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
      /* no maximo 30 quadrados no trilho (abertas primeiro): cidade grande nao pesa a tela; o resto aparece pela busca e pelos filtros */
      var totalDaFila = abertas.length + fechadas.length;
      var fila = abertas.concat(fechadas).slice(0, 30);
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
        /* capa so de quem esta escolhida: baixar a de todas a cada visita gastava o Firebase gratis a toa */
        if (!(l.slug in capas) && l.capa && store.obterFoto) {
          capas[l.slug] = '';
          (store.fotoPublica ? store.fotoPublica(l.slug, l.capa) : store.obterFoto(l.slug, l.capa)).then(function (c) { if (c) { capas[l.slug] = c; if (estadoHub.sel === l.slug) pintarFundo(l); } }).catch(function () { /* fica a logo */ });
        }
      }
      function pintarDetalhe(x) {
        var l = x.loja;
        var aberta = R.lojaAberta(l);
        var abreAs = aberta ? null : R.proximaAbertura(l);
        var tempo = l.aceitaEntrega === false ? 'só retirada' : 'entrega em ~' + (l.tempoEntrega || 40) + '\u00a0min';
        var frete = l.aceitaEntrega === false ? '' : R.descreverFrete(l);
        UI.limpar(detalhe);
        detalhe.appendChild(el('div', { class: 'ps-texto' }, [
          el('div', { class: 'ps-nome' }, [el('span', { text: l.nome }), UI.seloVerificada(l)]),
          el('div', { class: 'ps-meta', text: [l.tipo ? R.tipoVisivel(l) : '', x.itens.length ? 'tem: ' + x.itens.slice(0, 2).join(', ') + (x.itens.length > 2 ? ' +' + (x.itens.length - 2) : '') : (l.descricao || '')].filter(Boolean).join('\u00a0· ') }),
          el('div', { class: 'ps-status' }, [
            el('span', { class: aberta ? 'aberta' : 'fechada' }, [el('span', { class: 'bolinha', 'aria-hidden': 'true' }), aberta ? 'Aberta agora' : (abreAs ? 'Abre às ' + abreAs : 'Fechada')]),
            el('span', {}, [UI.iconeLinha('relogio'), tempo]),
            frete ? el('span', {}, [UI.iconeLinha('entrega'), frete.split(', ')[0]]) : null,
            frete && frete.split(', ')[1] ? el('span', { text: frete.split(', ')[1].replace(/^./, function (c) { return c.toUpperCase(); }) }) : null,
          ]),
        ]));
        detalhe.appendChild(el('button', { class: 'btn btn-principal ps-abrir', type: 'button', text: aberta ? 'Abrir loja →' : 'Ver a loja →', onclick: function () { ir(l.cidadeSlug + '/' + l.slug); } }));
      }
      function escolher(slugLoja, rolar) {
        estadoHub.sel = slugLoja;
        Object.keys(tiles).forEach(function (k) { tiles[k].classList.toggle('escolhida', k === slugLoja); tiles[k].setAttribute('aria-selected', k === slugLoja ? 'true' : 'false'); });
        var x = fila.filter(function (y) { return y.loja.slug === slugLoja; })[0];
        if (!x) return;
        pintarFundo(x.loja);
        pintarDetalhe(x);
        /* rola SO o trilho (scrollIntoView empurrava o palco inteiro pro lado quando havia mais lojas que a largura) */
        if (rolar) {
          var t = tiles[slugLoja];
          var alvo = Math.max(0, t.offsetLeft - (trilho.clientWidth - t.offsetWidth) / 2);
          if (trilho.scrollTo) trilho.scrollTo({ left: alvo, behavior: 'smooth' }); else trilho.scrollLeft = alvo;
        }
        if (trilho.parentNode) trilho.parentNode.scrollLeft = 0;
      }
      var podePairar = window.matchMedia && window.matchMedia('(hover: hover)').matches;
      fila.forEach(function (x) {
        var l = x.loja;
        var src = (lojaOficial(l.slug) && lojaOficial(l.slug).logo) || D.logoSrc(l);
        var t = el('button', { class: 'ps-tile' + (R.lojaAberta(l) ? '' : ' fechada'), type: 'button', role: 'option', 'aria-label': l.nome, title: l.nome }, [
          src ? el('img', { src: src, alt: '' }) : document.createTextNode(l.emoji || '🍽️'),
          UI.seloVerificada(l, 'no-tile'),
        ]);
        if (!src && l.cor) t.style.background = tintaDaLoja(l.cor) || '#fff';
        /* no computador: passar o mouse escolhe, clicar abre. No celular: o primeiro toque escolhe, o segundo abre. */
        t.addEventListener('click', function () { if (estadoHub.sel === l.slug || podePairar) ir(l.cidadeSlug + '/' + l.slug); else escolher(l.slug, true); });
        if (podePairar) t.addEventListener('mouseenter', function () { escolher(l.slug, false); });
        t.addEventListener('focus', function () { escolher(l.slug, false); });
        tiles[l.slug] = t;
        trilho.appendChild(t);
        UI.lembrarCor(l.slug, l.cor || '#84CC16', true); /* so semente: quem manda e a pagina da loja (dados completos) */
        if (l.capaUrl) capas[l.slug] = l.capaUrl;
      });
      /* tem mais quadrado do que cabe: a borda direita do trilho esmaece (mostra que rola, sem cortar seco) */
      setTimeout(function () { if (trilho.scrollWidth > trilho.clientWidth + 2) trilho.classList.add('rola'); }, 60);
      if (totalDaFila > fila.length) lista.appendChild(el('p', { class: 'muted pequeno centro', text: 'Mostrando ' + fila.length + ' de ' + totalDaFila + ' lojas. Use a busca ou os filtros para achar as outras.' }));
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
        var mapa = Object.create(null);
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
      tituloCidade.textContent = 'Não deu para carregar';
      var caixa = raiz.querySelector('.hub-lista') || raiz;
      UI.limpar(caixa); caixa.appendChild(UI.erroCarregar('Não deu para carregar as lojas de agora.'));
    });
    var parar = store.assistir ? store.assistir(function () { store.listarLojas(cidadeSlug).then(desenhar); }) : function () {};
    /* "abre as" e "aberto agora" andam sozinhos, mas so redesenha quando alguma loja abriu ou fechou: redesenhar
       a cada minuto fazia a fileira de lojas voltar ao comeco e tirava o foco de quem estava olhando */
    var situacaoLojas = '';
    function situacaoAgora() { return estadoHub.lojas.map(function (l) { return l.slug + ':' + (R.lojaAberta(l) ? 1 : 0) + ':' + (R.proximaAbertura(l) || ''); }).join('|'); }
    var relogio = setInterval(function () {
      if (!estadoHub.lojas.length) return;
      var agora = situacaoAgora();
      if (agora !== situacaoLojas) desenharLista();
    }, 60000);
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

  /* Loja oficial do Ligeiro (config.lojasOficiais): selo no hub e tema exclusivo no site (a mesma conta do UI) */
  var lojaOficial = UI.lojaOficial;

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
   * Pecas do pedido sem tela (os testes usam direto)
   * ========================================================== */

  /* Chave do pedido: 20 letras e numeros, sorteada uma vez por fechamento e mandada em todo toque de novo no mesmo
     pedido. Resposta que se perde na volta (internet caiu) nao vira pedido em dobro: o servidor devolve o que ja nasceu */
  var LETRAS_DA_CHAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function novaChave() {
    var bytes = null, s = '';
    try {
      var c = window.crypto || window.msCrypto;
      if (c && c.getRandomValues) { bytes = new Uint8Array(20); c.getRandomValues(bytes); }
    } catch (_) { bytes = null; }
    for (var i = 0; i < 20; i++) s += LETRAS_DA_CHAVE.charAt((bytes ? bytes[i] : Math.floor(Math.random() * 256)) % 62);
    return s;
  }

  /* Resumo curto do que vai no pedido (carrinho, jeito de receber, pagamento, dados): mudou qualquer coisa, e outro
     pedido e ganha outra chave. So o resumo fica guardado, nunca nome, telefone ou endereco */
  function assinaturaDe(dados) {
    var s = JSON.stringify(dados || {}), a = 5381, b = 52711;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = (a * 33) ^ c; b = (b * 31) ^ c; }
    return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + '.' + s.length;
  }

  /* A chave guardada vale para o mesmo pedido (mesma assinatura) por ate 30 min; senao, uma nova */
  var CHAVE_VALE = 30 * 60 * 1000;
  function chaveDoEnvio(guardada, assinatura, agora) {
    var g = guardada || {};
    var em = Number(g.em) || 0;
    if (typeof g.chave === 'string' && /^[A-Za-z0-9]{20}$/.test(g.chave) && g.de === assinatura && Math.abs(agora - em) < CHAVE_VALE) return g;
    return { chave: novaChave(), de: assinatura, em: agora };
  }

  /* Resposta do /pedido: { pedido, avisado }, ou null quando o mensageiro e antigo (sem a rota), ou o erro com o texto
     do servidor. 404 com texto nosso ("Essa loja nao existe mais") e erro de verdade, nao mensageiro antigo */
  function lerRespostaDoPedido(status, j) {
    if (status >= 200 && status < 300 && j && j.pedido) return j;
    if (status === 404 && !(j && j.erro && j.erro !== 'rota')) return null;
    var e = new Error((j && j.erro) || 'Não conseguimos enviar o pedido. Tente de novo.');
    e.publico = true;
    e.status = status;
    if (j && j.pausa) e.pausa = true;
    throw e;
  }

  /* 422 do /pedido "Essa forma de pagamento nao esta disponivel agora" (a loja desligou a forma escolhida): a tela volta
     para a escolha da forma */
  function pedeOutraForma(erro) { return !!erro && erro.status === 422 && /forma de pagamento|pague no pix/i.test(String(erro.message || '')); }

  /* Diferenca do relogio do servidor para o do aparelho, pela hora em que o pedido nasceu no servidor (a resposta chega
     logo depois). Menos de 1 minuto e so a demora da internet: fica zero */
  function desvioDoRelogio(criadoEm, agora) {
    var t = Date.parse(criadoEm || '');
    if (isNaN(t) || Math.abs(t - agora) < 60 * 1000) return 0;
    return t - agora;
  }

  /* O /status disse que o dinheiro passou (Pix caiu, cartao aprovado, ou o pedido ja andou na loja)? */
  function pagoNoStatus(resp) {
    var s = resp && resp.status;
    return typeof s === 'string' && [R.STATUS.PAGO, R.STATUS.PRODUCAO, R.STATUS.PRONTO, R.STATUS.FINALIZADO].indexOf(s) >= 0;
  }

  /* Cartao com cobranca sem resposta do banco (em analise, ou a resposta nao chegou): o dinheiro pode estar saindo,
     entao ninguem desiste do pedido agora. A marca de "cobrando" sozinha vale 5 min (a mesma do mensageiro) */
  function emAnalise(p, agora) {
    if (!p || p.status !== R.STATUS.AGUARDANDO) return false;
    if (p.cobrancaIncerta) return true;
    var t = Date.parse(p.cobrandoEm || '');
    return !isNaN(t) && agora - t < 5 * 60 * 1000;
  }

  /* "O cardapio mudou... Monte o pedido de novo": tentar de novo nao adianta, o pedido tem que ser montado outra vez */
  function pedeMontarDeNovo(mensagem) { return /card[aá]pio mudou|monte o pedido de novo/i.test(String(mensagem || '')); }

  /* A loja devolveu o dinheiro do pedido (painel, "Devolver"): a tela nunca diz "pagamento confirmado" */
  function foiDevolvido(pedido) { return !!pedido && (pedido.pagamentoStatus === 'devolvido' || !!pedido.devolvidoEm); }

  /* O rotulo de cima da tela da senha: esperando, cancelado, devolvido ou confirmado */
  function rotuloDaSenha(pedido) {
    if (pedido.status === R.STATUS.AGUARDANDO) return { icone: 'ampulheta', texto: pedido.formaPagamento === 'cartao_online' ? 'Pedido enviado, esperando o pagamento' : 'Pedido enviado, esperando o Pix' };
    if (foiDevolvido(pedido)) return { icone: 'dinheiro', texto: pedido.status === R.STATUS.CANCELADO ? 'Pedido cancelado, dinheiro devolvido' : 'Dinheiro devolvido' };
    if (pedido.status === R.STATUS.CANCELADO) return { icone: 'fechar', texto: 'Pedido cancelado' };
    return { icone: 'feito', texto: (pedido.pagamentoStatus === 'na_entrega' || pedido.total === 0) ? 'Pedido confirmado' : 'Pagamento confirmado' };
  }

  /* Primeira etapa da linha do tempo, pelo jeito que pagou */
  function rotuloDoPagamento(pedido) {
    if (foiDevolvido(pedido)) return 'Dinheiro devolvido';
    if (pedido.total === 0 || pedido.pagamentoStatus === 'na_entrega') return 'Pedido confirmado';
    if (pedido.formaPagamento === 'pix') return 'Pix confirmado';
    if (pedido.formaPagamento === 'cartao_online') return 'Cartão aprovado';
    return 'Pedido confirmado';
  }

  /* ============================================================
   * LOJA: vitrine + pedido em modo totem
   * ========================================================== */

  function loja(raiz, slug, opcoes) {
    /* loja oficial: tema e tela de carregamento ANTES de qualquer coisa aparecer (sem piscar o visual padrao) */
    var oficialCedo = UI.lojaOficial(slug);
    var tirarSplash = function () {};
    if (oficialCedo) { UI.aplicarTemaOficial(raiz, slug); tirarSplash = UI.splashOficial(oficialCedo); }
    /* as outras lojas: tela simples, tres bolinhas na cor da loja (sem marca do Ligeiro), ate a loja estar inteira */
    else tirarSplash = UI.splashLoja(slug);
    var o = opcoes || {};
    var balcao = !!o.balcao;

    var estado = {
      loja: null,
      carrinho: [],
      tipoEntrega: 'retirada',
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

    /* hora certa: a do aparelho mais a diferenca para o servidor, medida quando um pedido nasce (guardada na aba).
       Celular com a hora adiantada nao cancela sozinho o Pix ou o cartao de quem ainda esta pagando */
    var CHAVE_DESVIO = 'ligeiro:desvio-relogio';
    try { estado.desvioRelogio = Number(sessionStorage.getItem(CHAVE_DESVIO)) || 0; } catch (_) { estado.desvioRelogio = 0; }
    function agoraCerto() { return Date.now() + (estado.desvioRelogio || 0); }
    function guardarDesvio(ms) {
      estado.desvioRelogio = ms;
      try { sessionStorage.setItem(CHAVE_DESVIO, String(ms)); } catch (_) { /* segue sem guardar */ }
    }

    raiz.innerHTML = esqueletoDaLoja(balcao);

    /* ---------- utilidades de tela ---------- */

    /* Telas de montar o pedido (antes de enviar). Com a loja fechada ninguem entra nelas, venha de onde vier (botao,
       carrinho guardado, "adicionar mais"); e se ela fechar com o cliente dentro, ele volta para o inicio com o carrinho
       guardado, em vez de descobrir so no ultimo botao. Pagamento e senha nao: esse pedido entrou com a loja aberta e segue. */
    var TELAS_DE_MONTAR = ['tela-tipo', 'tela-cardapio', 'tela-carrinho', 'tela-dados'];
    function avisoLojaFechou() {
      var abreAs = R.proximaAbertura(estado.loja);
      UI.avisar(abreAs ? 'A loja fechou agora. Ela abre às ' + abreAs + ' e seu carrinho fica guardado.' : 'A loja fechou agora. Seu carrinho fica guardado para quando ela abrir.');
    }
    function fechouNoMeio() {
      if (!estado.loja || R.lojaAberta(estado.loja)) return false;
      var atual = raiz.querySelector('.tela.ativa');
      if (!atual || TELAS_DE_MONTAR.indexOf(atual.id) < 0) return false;
      UI.fecharModal(); /* a janela do item fica fora da tela: nao pode ficar aberta por cima do inicio */
      avisoLojaFechou();
      irPara('tela-inicio');
      return true;
    }

    function irPara(idTela) {
      if (TELAS_DE_MONTAR.indexOf(idTela) >= 0 && estado.loja && !R.lojaAberta(estado.loja)) {
        avisoLojaFechou();
        montarInicio();
        idTela = 'tela-inicio';
      }
      var atual = raiz.querySelector('.tela.ativa');
      if (atual) atual.classList.remove('ativa');
      if (idTela !== 'tela-cartao' && estado.montandoCartao) desmontarCartao();
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
      armarRelogioParado();
    }

    /* balcao: carrinho ou nome largado no tablet nao fica pro proximo cliente.
       3 min sem toque no cardapio, no carrinho ou nos dados: volta pro inicio limpo. */
    var TELAS_DO_PEDIDO = ['tela-cardapio', 'tela-carrinho', 'tela-dados'];
    function armarRelogioParado() {
      clearTimeout(estado.relogioParado);
      estado.relogioParado = null;
      if (!balcao || !vivo) return;
      var atual = raiz.querySelector('.tela.ativa');
      if (!atual || TELAS_DO_PEDIDO.indexOf(atual.id) < 0) return;
      estado.relogioParado = setTimeout(function () {
        estado.relogioParado = null;
        if (!vivo) return;
        if (estado.enviandoPedido) { armarRelogioParado(); return; } /* pedido saindo: espera a resposta */
        var agora = raiz.querySelector('.tela.ativa');
        if (!agora || TELAS_DO_PEDIDO.indexOf(agora.id) < 0) return;
        UI.fecharModal(); /* a janela do item (fica fora da raiz) nao pode ficar aberta por cima do inicio */
        novoPedido();
      }, 3 * 60 * 1000);
    }
    /* qualquer toque ou tecla (inclusive na janela do item, que fica fora da raiz) zera o relogio */
    function mexeuNoTablet() { if (estado.relogioParado) armarRelogioParado(); }
    if (balcao) {
      document.addEventListener('pointerdown', mexeuNoTablet, true);
      document.addEventListener('touchstart', mexeuNoTablet, true);
      document.addEventListener('keydown', mexeuNoTablet, true);
    }

    raiz.querySelectorAll('[data-voltar]').forEach(function (b) {
      b.addEventListener('click', function () { UI.soar('toque'); irPara(b.dataset.voltar); });
    });

    /* ---------- carregar a loja ---------- */

    /* a loja chega uma vez so: a primeira foto abre a pagina e as mudancas (abriu, fechou, preco) seguem pela mesma escuta.
       lojaPublica: vem da borda (Cloudflare), sem gastar o banco gratis; sem borda, e a escuta ao vivo do Firestore */
    var lojaViva = store.lojaPublica ? store.lojaPublica(slug)
      : store.lojaAoVivo ? store.lojaAoVivo(slug) : { primeira: store.obterLoja(slug), assistir: function (cb) { return store.assistirLoja(slug, cb); }, parar: function () {} };
    estado.pararLoja = lojaViva.parar;
    lojaViva.primeira.catch(function () { return { _erro: true }; }).then(function (dados) {
      if (!vivo) return;
      if (!dados || dados._erro || dados.ativa === false) tirarSplash();
      if (dados && dados._erro) {
        raiz.innerHTML = '';
        raiz.appendChild(UI.erroCarregar('Não deu para abrir a loja agora.'));
        return;
      }
      /* link de acompanhar um pedido: abre o pedido mesmo com a loja desativada ou parada (o cliente que esta esperando a
         entrega nao pode cair em "fora do ar" com o pedido dele andando) */
      if (!dados || (dados.ativa === false && !o.pedidoId)) {
        raiz.innerHTML = '';
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [
          el('div', { class: 'icone' }, [UI.iconeLinha('busca')]),
          el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' }),
          el('button', { class: 'btn btn-fantasma', style: { marginTop: '16px' }, text: 'Ver as cidades', onclick: function () { ir('cidades'); } }),
        ]));
        return;
      }
      if (R.lojaBloqueada(dados) && !o.pedidoId) {
        tirarSplash();
        raiz.innerHTML = '';
        /* loja parada (teste acabou ou parou de pagar): a mesma tela de vidro da pausa, em vermelho. O cliente nao fica
           sem pedir (vai pelo WhatsApp) e o motivo nao aparece para ele; o dono tem o caminho para regularizar */
        var oficialB = UI.lojaOficial && UI.lojaOficial(dados.slug);
        var logoB = (oficialB && oficialB.logo) || D.logoSrc(dados);
        /* loja inativa (nao pagou): o Ligeiro nao entrega cliente para quem parou de pagar, nem por WhatsApp nem para
           outra loja. O cliente cobra o dono, e o dono tem o caminho para regularizar */
        raiz.appendChild(el('div', { class: 'pausa-fundo pausa-pagina vermelho' }, el('div', { class: 'pausa-caixa' }, [
          el('img', { class: 'pausa-mascote' + (logoB && !(oficialB && oficialB.logo) ? ' logo-loja' : ''), src: logoB || 'img/mascote-192.webp', alt: '' }),
          el('div', { class: 'pausa-selo' }, [el('i', { 'aria-hidden': 'true' }), 'Loja inativa']),
          el('h1', { text: 'Esta loja está fora do ar' }),
          el('p', { text: (dados.nome || 'A loja') + ' não está recebendo pedidos pelo Ligeiro no momento.' }),
          el('a', { class: 'btn btn-contorno btn-largo pausa-dono-btn', href: '#/conta' }, 'Sou o dono desta loja'),
        ])));
        return;
      }
      if (!balcao && o.cidadeSlug && o.cidadeSlug !== dados.cidadeSlug) {
        /* Endereco com a cidade errada: corrige sem alarde. */
        window.LigeiroApp.substituir(dados.cidadeSlug + '/' + dados.slug + (o.pedidoId ? '/pedido/' + o.pedidoId : ''));
      }
      if (!balcao) UI.guardarLocal(CHAVE_CIDADE, dados.cidadeSlug);
      /* a cor da loja ja chegou: as bolinhas da tela de carregamento passam pra ela enquanto as fotos baixam */
      if (tirarSplash.pintar) tirarSplash.pintar(dados.cor || '#84CC16');
      /* internet boa: a loja abre ja com as fotos. Fraca: espera no maximo 1,5 s e abre com os emojis; as fotos entram
         quando chegarem (antes esperava todas, e no 3G o cliente desistia antes de ver o cardapio) */
      var abriu = false;
      var abrirLoja = function () {
        if (abriu || !vivo) return;
        abriu = true;
        aplicarLoja(dados);
        lojaViva.assistir(function (nova) {
          if (nova && vivo) carregarFotos(nova).then(function () { if (vivo) aplicarLoja(nova, true); });
        });
        if (o.pedidoId) abrirPedidoSalvo(o.pedidoId);
      };
      carregarFotos(dados).then(function (mudou) {
        if (!vivo) return;
        if (!abriu) abrirLoja();
        else if (mudou && estado.loja) aplicarLoja(estado.loja, true);
      });
      setTimeout(abrirLoja, 1500);
    });

    /* O pedido em andamento fica guardado neste aparelho: "voltar" do celular ou recarregar nao apaga o carrinho. */
    function guardarRascunho() {
      if (balcao) return;
      try {
        if (estado.carrinho.length === 0 && !estado.cupom.codigo) sessionStorage.removeItem(CHAVE_RASCUNHO);
        else sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ carrinho: estado.carrinho, tipoEntrega: estado.tipoEntrega, cupom: estado.cupom, cuponsExtra: estado.cuponsExtra || [], chave: estado.chavePedido || null }));
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
        /* a regra do cupom que o mensageiro confirmou volta junto (a copia publica da loja nao traz a lista de cupons:
           sem ela, o cupom valido virava "Esse codigo nao existe" depois de recarregar). O desconto de verdade quem
           decide e o mensageiro, ao criar o pedido */
        if (Array.isArray(r.cuponsExtra) && r.cuponsExtra.length) { estado.cuponsExtra = r.cuponsExtra.slice(0, 5); estado.loja = juntarCupons(estado.loja); }
        /* a chave do envio que ficou sem resposta volta junto: tocar de novo depois de recarregar nao faz outro pedido */
        if (r.chave && typeof r.chave === 'object' && typeof r.chave.chave === 'string') estado.chavePedido = r.chave;
      } catch (_) { /* rascunho ilegivel: ignora */ }
    }
    function limparRascunho() { try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch (_) { /* ignora */ } }

    /* Fotos (produtos e capa): baixa uma vez e so de novo quando a loja trocar alguma. */
    function carregarFotos(dados) {
      var versao = dados.fotosVersao || '';
      if (estado.fotosVersao === versao) return Promise.resolve(false);
      /* a mesma versao ja esta baixando (a loja chegou de novo pela escuta): espera a mesma, sem pedir outra vez */
      if (estado.fotosBaixando && estado.fotosBaixando.versao === versao) return estado.fotosBaixando.promessa.then(function () { return false; });
      var promessa = (store.fotosPublicas ? store.fotosPublicas(slug, versao, dados) : store.listarFotos(slug, versao, dados)).then(function (mapa) {
        estado.fotos = mapa || {};
        estado.fotosVersao = versao;
        return true;
      }).catch(function () { estado.fotosVersao = versao; return false; });
      estado.fotosBaixando = { versao: versao, promessa: promessa };
      return promessa;
    }

    function aplicarTemaOficial(oficial) {
      if (!oficial || !oficial.tema) return;
      UI.aplicarTemaOficial(raiz, estado.loja.slug);
      var abertura = raiz.querySelector('.abertura');
      if (abertura && !abertura.querySelector('.enfeites') && oficial.enfeites) {
        abertura.insertBefore(el('div', { class: 'enfeites', 'aria-hidden': 'true' }, oficial.enfeites.map(function (e) { return el('span', { text: e }); })), abertura.firstChild);
      }
    }

    /* cupom confirmado pelo mensageiro (a lista de cupons nao vem na loja publica): fica junto da loja nesta visita,
       ate quando a loja se atualiza */
    function juntarCupons(l) {
      var extras = estado.cuponsExtra || [];
      if (!l || !extras.length) return l;
      var lista = (l.cupons || []).filter(function (c) { return extras.every(function (x) { return x.codigo !== c.codigo; }); }).concat(extras);
      return Object.assign({}, l, { cupons: lista });
    }
    function aplicarLoja(dados, atualizacao) {
      var primeira = !estado.loja;
      estado.loja = juntarCupons(dados);
      estado.oficial = lojaOficial(dados.slug);
      UI.aplicarTema(dados.cor, dados.estilo);
      if (primeira && estado.oficial) aplicarTemaOficial(estado.oficial);
      if (primeira && estado.oficial) UI.oficialPronto(estado.oficial, 600).then(tirarSplash);
      if (primeira && !estado.oficial) setTimeout(function () { UI.imagensProntas(raiz.querySelector('.abertura'), 2500).then(tirarSplash); }, 0);
      UI.lembrarCor(dados.slug, dados.cor || '#84CC16');
      montarInicio();
      /* o carrinho guardado volta ANTES de montar o fluxo: se a loja desligou a entrega enquanto a pessoa estava em outro
         app, o fluxo corrige para a retirada (antes a entrega voltava sem endereco e sem como trocar) */
      if (primeira) restaurarRascunho();
      configurarFluxo();
      if (primeira) {
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
        /* o dono fechou a loja agora: quem estava montando o pedido volta para o inicio, com o carrinho guardado */
        fechouNoMeio();
      }
    }

    /* ---------- tela inicial ---------- */

    /* O video da Loja do Ligeiro que o dono pos no site: capa com play; toca em tela cheia com o "Pedir agora" embaixo.
       O arquivo so baixa quando a pessoa toca (a capa e um JPG pequeno) */
    function desenharVideoDaLoja(l) {
      var caixa = $('videoLoja');
      if (!caixa) return;
      UI.limpar(caixa);
      var v = l && l.video;
      var ok = v && /^[a-z0-9]{20}$/.test(String(v.id || '')) && !balcao;
      caixa.hidden = !ok;
      if (!ok) return;
      var base = String(((window.LIGEIRO_CONFIG || {}).cobranca || {}).mensageiro || '').replace(/\/+$/, '');
      var url = function (q) { return D.modoDemo ? (q === 'v' ? 'midia/comercial-ligeiro.mp4' : 'midia/comercial-ligeiro.jpg') : base + '/servicos/' + q + '/' + v.id; };
      var dur = Number(v.dur) || 0;
      caixa.appendChild(el('div', { class: 'video-loja-titulo' }, [el('b', { text: 'Vídeo da loja' }), dur ? el('span', { text: dur + ' segundos' }) : null]));
      caixa.appendChild(el('button', { class: 'video-loja-capa', type: 'button', 'aria-label': 'Assistir o vídeo ' + (v.titulo || 'da loja'), onclick: function () { tocarVideoDaLoja(url('v'), v.titulo); } }, [
        v.capa || D.modoDemo ? el('img', { src: url('c'), alt: '', loading: 'lazy' }) : null,
        el('span', { class: 'video-loja-sombra' }),
        v.titulo ? el('span', { class: 'video-loja-nome', text: v.titulo }) : null,
        el('span', { class: 'video-loja-play' }, [el('span', { class: 'video-loja-bolinha' }, [UI.iconeLinha('tocar')]), 'Assistir']),
      ]));
    }
    function tocarVideoDaLoja(src, titulo) {
      var fundo = el('div', { class: 'srv-player', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || 'Vídeo da loja' });
      var video = el('video', { src: src, autoplay: true, playsinline: true, controls: true, preload: 'auto' });
      var tecla = function (e) { if (e.key === 'Escape') fechar(); };
      function fechar() { try { video.pause(); } catch (_) { /* ja parou */ } if (fundo.parentNode) fundo.parentNode.removeChild(fundo); document.removeEventListener('keydown', tecla); UI.travarRolagem('video', false); }
      fundo.appendChild(video);
      fundo.appendChild(el('button', { class: 'srv-player-fechar', type: 'button', 'aria-label': 'Fechar o vídeo', onclick: fechar }, [UI.iconeLinha('fechar')]));
      fundo.appendChild(el('div', { class: 'srv-player-rodape' }, [el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'PEDIR AGORA', onclick: function () { fechar(); var b = $('btnComecar'); if (b && !b.disabled) b.click(); } })]));
      document.body.appendChild(fundo);
      document.addEventListener('keydown', tecla);
      UI.travarRolagem('video', true);
    }

    function montarInicio() {
      var l = estado.loja;
      document.title = l.nome + ' · Ligeiro';
      if (!balcao && window.LigeiroApp && window.LigeiroApp.manifestDaLoja) window.LigeiroApp.manifestDaLoja((l.cidadeSlug || 'loja') + '/' + l.slug, l.nome);
      var logo = $('logoLoja');
      UI.limpar(logo);
      var srcLogo = (estado.oficial && estado.oficial.logo) || D.logoSrc(l);
      logo.appendChild(srcLogo ? el('img', { src: srcLogo, alt: l.nome }) : document.createTextNode(l.emoji || '🍽️'));
      /* a linha embaixo do nome: a frase do lojista ou "Lanchonete em Juquiá" */
      var textoTopo = l.descricao || (l.tipo ? R.tipoVisivel(l) + ' em ' + l.cidade : '');
      /* fim da primeira tela: confianca (todas) e o bloco da loja oficial */
      var fim = $('fimInicio');
      if (fim) {
        UI.limpar(fim);
        if (estado.oficial && estado.oficial.ilustracao) {
          fim.appendChild(el('div', { class: 'oficial-extra' }, [
            el('img', { src: estado.oficial.ilustracao, alt: '' }),
            el('div', {}, [el('b', { text: estado.oficial.frase || 'Feito na hora, do forno para sua porta' }), el('span', { text: estado.oficial.subfrase || '' })]),
          ]));
        }
        /* so o que nao foi dito em outro lugar: a entrega (gratis, taxa, tempo) ja esta no botao de pedir, e a cidade
           so entra se a linha embaixo do nome nao falou dela e se o endereco (logo abaixo, com a cidade) nao vai aparecer */
        var partes = [];
        var pixSite = pixDisponivel(l), cartaoSite = cartaoDisponivel(l);
        if (pixSite || cartaoSite) partes.push(['escudo', pixSite && cartaoSite ? 'Pix e cartão protegidos pelo Mercado Pago' : pixSite ? 'Pix protegido pelo Mercado Pago' : 'Cartão protegido pelo Mercado Pago']);
        if (l.cidade && !l.endereco && !R.mencionaCidade(textoTopo, l.cidade)) partes.push(['mapa', 'Somos de ' + l.cidade]);
        /* cada item inteiro numa linha: quebra entre itens, nunca no meio de um */
        if (partes.length) fim.appendChild(el('div', { class: 'confianca' }, partes.map(function (t) { return el('span', {}, [UI.iconeLinha(t[0]), t[1]]); })));
      }
      var capa = $('capaLoja');
      var srcCapa = l.capa ? D.fotoSrc({ foto: l.capa }, estado.fotos) : (l.capaUrl || null);
      UI.limpar(capa);
      capa.hidden = !srcCapa;
      if (srcCapa) capa.appendChild(el('img', { src: srcCapa, alt: '' }));
      capa.parentNode.classList.toggle('com-capa', !!srcCapa);
      $('nomeLoja').textContent = l.nome;
      var seloV = UI.seloVerificada(l, 'no-nome');
      if (seloV) $('nomeLoja').appendChild(seloV);
      $('descLoja').textContent = textoTopo;

      var aberta = R.lojaAberta(l);
      estado.abertaNaTela = aberta; /* o relogio de 60 s compara com isto */
      var selo = $('seloAberto');
      selo.classList.toggle('fechado', !aberta);
      $('textoAberto').textContent = aberta ? 'Aberto agora' : 'Fechado no momento';
      /* avaliacoes no Google: so link do Google (conferido de novo aqui, o banco aceita qualquer texto); no balcao nao,
         la o cliente ja esta dentro da loja e nao pode sair da tela de pedir */
      var google = R.linkGooglePerfil(l.googleUrl);
      var seloG = $('seloGoogle');
      seloG.hidden = balcao || !google;
      if (google) seloG.href = google; else seloG.removeAttribute('href');

      /* recado da loja ("Hoje: feijoada"): a mesma peca dos avisos, icone e texto */
      var aviso = $('avisoTopo');
      aviso.hidden = !l.avisoTopo;
      UI.limpar(aviso);
      if (l.avisoTopo) { aviso.appendChild(UI.iconeLinha('sino')); aviso.appendChild(el('span', { text: l.avisoTopo })); }

      var botao = $('btnComecar');
      botao.disabled = !aberta;
      $('btnComecarForte').textContent = aberta ? (balcao ? 'TOQUE PARA PEDIR' : 'PEDIR AGORA') : 'LOJA FECHADA';
      /* fechada: com horario cadastrado, diz quando abre (a mesma conta da lista de lojas da cidade) */
      var abreAs = aberta ? null : R.proximaAbertura(l);
      $('btnComecarFraca').textContent = aberta
        ? (balcao ? 'e pague aqui mesmo' : fraseEntrega(l))
        : (abreAs ? 'abre às ' + abreAs : 'volte mais tarde');

      /* as tres etapas com duas linhas cada (antes "Pix, maquininha ou dinheiro" virava quatro linhas no meio):
         maquininha ou dinheiro a pessoa escolhe no fechamento, onde as duas aparecem */
      var temPix = pixDisponivel(l), temCartao = cartaoDisponivel(l), aoReceber = !!(l.aceitaCartaoEntrega || l.aceitaDinheiroEntrega);
      var linhas;
      if (temPix && temCartao) linhas = aoReceber ? ['Pix, cartão', 'ou ao receber'] : ['Pix ou cartão', 'pelo site'];
      else if (temPix || temCartao) linhas = aoReceber ? [temPix ? 'Pague no Pix' : 'Pague no cartão', 'ou ao receber'] : ['Pague', temPix ? 'no Pix' : 'no cartão'];
      else linhas = ['Pague', aoReceber ? 'ao receber' : 'na loja'];
      var como = $('comoPagamento');
      UI.limpar(como);
      como.appendChild(document.createTextNode(linhas[0]));
      como.appendChild(el('br'));
      como.appendChild(document.createTextNode(linhas[1]));

      desenharVideoDaLoja(l);

      /* destaques: os dois primeiros produtos ativos que nao sao bebida */
      var trilho = $('destaquesTrilho');
      UI.limpar(trilho);
      var vitrine = R.produtosAtivos(l).filter(function (p) { return !/bebida/i.test(p.categoria); }).slice(0, 2);
      $('destaques').hidden = vitrine.length === 0 || balcao || !aberta;
      vitrine.forEach(function (p) {
        var card = el('button', { class: 'card-produto', onclick: function () {
          /* confere a hora de agora (a tela pode ter ficado aberta desde antes de a loja fechar) */
          if (!R.lojaAberta(estado.loja)) { comecarPedido(); return; }
          comecarPedido(); montarGrade(p.categoria); abrirPersonalizacao(p);
        } }, [
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
      if (l.whatsapp) contatos.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(l.whatsapp, 'Olá! Vim pelo Ligeiro.'), target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'WhatsApp']));
      if (l.instagram) contatos.appendChild(el('a', { class: 'btn btn-fantasma', href: 'https://instagram.com/' + String(l.instagram).replace(/^@/, ''), target: '_blank', rel: 'noopener' }, [UI.icone('insta'), '@' + String(l.instagram).replace(/^@/, '')]));
      var enderecoJaTemCidade = l.endereco && l.cidade && R.semAcento(l.endereco).toLowerCase().indexOf(R.semAcento(l.cidade).toLowerCase()) >= 0;
      var endLoja = $('enderecoLoja');
      UI.limpar(endLoja);
      if (l.endereco) { endLoja.appendChild(UI.iconeLinha('mapa')); endLoja.appendChild(document.createTextNode(l.endereco + (l.cidade && !enderecoJaTemCidade ? '\u00a0· ' + l.cidade : ''))); }
      /* confianca no rodape: loja verificada (com o selo) e o CNPJ, se o lojista informou */
      var legal = $('legalLoja');
      if (legal) {
        UI.limpar(legal);
        var verificada = UI.ehOficial(l.slug) || l.verificada === true;
        if (verificada) legal.appendChild(el('span', { class: 'rodape-verificada' }, [el('img', { class: 'selo-mini', src: 'img/selo-verificado.svg', alt: '' }), UI.ehOficial(l.slug) ? 'Loja oficial, verificada pelo Ligeiro' : 'Loja verificada pelo Ligeiro']));
        var cnpj = R.cnpjValido(l.cnpj);
        if (cnpj) legal.appendChild(el('span', { text: 'CNPJ ' + R.formatarCnpj(cnpj) }));
        legal.hidden = !legal.children.length;
      }
      var outras = $('btnOutrasLojas');
      outras.textContent = 'Ver outros estabelecimentos de ' + l.cidade;
      /* Desligado por padrao: o link da loja e da loja, nao manda cliente pro concorrente. O dono liga em Ajustes se quiser. */
      outras.hidden = balcao || l.mostrarOutras !== true;
      outras.onclick = function () { ir(l.cidadeSlug); };

      atualizarFaixaAcompanhar();
      /* pedidos "andando" guardados neste aparelho: confere o status de verdade (a aba pode ter fechado antes do fim).
         Uma vez por minuto no maximo: o inicio redesenha a cada mudanca da loja, e cada conferida e uma leitura */
      estado.conferidos = estado.conferidos || {};
      lerMeusPedidos().filter(andandoAgora).forEach(function (p) {
        if (Date.now() - (estado.conferidos[p.id] || 0) < 60000) return;
        estado.conferidos[p.id] = Date.now();
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
      /* sem recado (chave da loja): o "Algum recado?" do fechamento some junto com o do item */
      if ($('blocoRecado')) $('blocoRecado').hidden = !!estado.loja && estado.loja.permitePersonalizar === false;
      var l = estado.loja;
      var modos = [];
      if (l.aceitaEntrega !== false) modos.push('entrega');
      if (l.aceitaRetirada !== false) modos.push('retirada');
      /* so oferece o jeito de receber que tem como pagar (antes a pessoa montava tudo e so no ultimo passo via que nao dava) */
      var temPixLoja = pixDisponivel(l) || (cartaoDisponivel(l) && !balcao), pagaNaPorta = !!(l.aceitaCartaoEntrega || l.aceitaDinheiroEntrega);
      /* pagar no balcao: sem o campo vale ligado, so o false desliga (a mesma conta das regras) */
      var pagaveis = modos.filter(function (m) { return temPixLoja || (pagaNaPorta && (m === 'entrega' || l.aceitaPagarNoBalcao !== false)); });
      if (pagaveis.length) modos = pagaveis; /* sem pagamento nenhum: fica o aviso do ultimo passo (fale com a loja) */
      if (balcao) modos = ['retirada'];
      var tipoAntes = estado.tipoEntrega;
      estado.pularEscolhaTipo = modos.length === 1;
      if (estado.pularEscolhaTipo) estado.tipoEntrega = modos[0];
      $('opcaoEntrega').disabled = modos.indexOf('entrega') < 0;
      $('opcaoRetirada').disabled = modos.indexOf('retirada') < 0;
      /* espaco que nao quebra: a linha nunca comeca com o ponto e o "min" nunca fica sozinho embaixo */
      $('detalheRetirada').textContent = 'Fica pronto em ~' + (l.tempoPreparo || 20) + '\u00a0min';
      $('detalheEntrega').textContent = R.descreverFrete(l) + '\u00a0· ~' + (l.tempoEntrega || 40) + '\u00a0min';
      /* a escolha so aparece fora do caminho normal quando o jeito escolhido saiu (tipoSaiu) */
      var passoTipo = raiz.querySelector('#tela-tipo .topo-passo');
      if (passoTipo && estado.pularEscolhaTipo) passoTipo.textContent = 'Confira';

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
      /* o jeito de receber que a pessoa tinha mudou sozinho (a loja desligou a entrega ou a retirada): avisa, em vez de
         trocar calado. So para quem esta montando um pedido (carrinho com item, ou numa tela de montar) */
      var telaAgora = raiz.querySelector('.tela.ativa');
      var montando = estado.carrinho.length > 0 || (!!telaAgora && TELAS_DE_MONTAR.indexOf(telaAgora.id) >= 0);
      if (estado.tipoEntrega !== tipoAntes && montando) tipoSaiu(tipoAntes);
    }

    /* Avisa (balao e aviso na tela da escolha) e, se a pessoa estava montando o pedido, volta para a escolha: o total
       muda (a taxa de entrega entra ou sai) e o endereco aparece ou some */
    function tipoSaiu(antes) {
      var texto = antes === 'entrega'
        ? 'A loja parou de fazer entrega agora. Seu pedido fica para buscar no balcão.'
        : 'A loja parou a retirada no balcão agora. Seu pedido fica para entrega.';
      var aviso = $('avisoTipo');
      UI.limpar(aviso);
      aviso.appendChild(UI.iconeLinha('alerta'));
      aviso.appendChild(el('span', { text: texto }));
      aviso.hidden = false;
      UI.avisar(texto);
      var atual = raiz.querySelector('.tela.ativa');
      if (atual && ['tela-cardapio', 'tela-carrinho', 'tela-dados'].indexOf(atual.id) >= 0) irPara('tela-tipo');
    }

    function comecarPedido() {
      if (!estado.loja) return;
      if (!R.lojaAberta(estado.loja)) {
        /* fechou com a tela aberta: avisa e mostra a loja fechada, em vez de nao fazer nada */
        avisoLojaFechou();
        montarInicio();
        return;
      }
      irPara(estado.pularEscolhaTipo ? 'tela-cardapio' : 'tela-tipo');
    }

    /* horario automatico: a tela inicial abre e fecha sozinha, sem precisar recarregar a pagina */
    estado.relogioAberta = setInterval(function () {
      if (!vivo || !estado.loja) return;
      if (R.lojaAberta(estado.loja) !== estado.abertaNaTela) { montarInicio(); fechouNoMeio(); }
    }, 60000);

    $('btnComecar').addEventListener('click', comecarPedido);
    $('btnCardapio').addEventListener('click', comecarPedido);

    raiz.querySelectorAll('[data-tipo]').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.tipoEntrega = b.dataset.tipo;
        $('avisoTipo').hidden = true;
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
        grade.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone' }, [UI.iconeLinha('cardapio')]), el('p', { text: R.catalogo(estado.loja).Nome + ' em atualização. Volte daqui a pouco.' })]));
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
      /* foto que nao abre (link quebrado, arquivo apagado): some o quadro, igual item sem foto */
      function montarFoto() {
        var caixaFoto = el('div', { class: 'foto-modal' }, [el('img', { src: srcFoto, alt: produto.nome })]);
        caixaFoto.firstChild.addEventListener('error', function () { caixaFoto.remove(); var cx = $('modalCaixa'), m = $('modal'); if (cx) cx.classList.remove('com-lado'); });
        /* loja com miniaturas: mostra a miniatura na hora e troca pela foto grande quando ela chegar */
        if (store.fotoCheia && produto.foto) store.fotoCheia(slug, produto.foto).then(function (cheia) { if (cheia && caixaFoto.isConnected) caixaFoto.firstChild.src = cheia; }).catch(function () { /* fica a miniatura */ });
        return caixaFoto;
      }
      if (srcFoto) corpo.appendChild(montarFoto());

      /* tamanho e adicionais sao do produto: aparecem sempre. A chave da loja so tira o "Tirar alguma coisa?" e o recado
         (antes sumia tudo junto, e a pizzaria que so nao queria recado nao vendia a pizza grande) */
      grupos.forEach(function (g) { corpo.appendChild(montarGrupo(g)); });
      if (podePersonalizar) {
        if (produto.ingredientes && produto.ingredientes.length) corpo.appendChild(montarGrupoRemover(produto.ingredientes));
        var obs = el('div', { class: 'campo', style: { marginTop: '16px' } }, [
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
      var valor = el('span', { class: 'add-valor' });
      /* duas partes que nunca quebram por dentro: "Adicionar" e o preco. Em tela estreita o preco desce inteiro pra segunda linha. */
      var adicionar = el('button', { class: 'btn btn-principal btn-adicionar', style: { flex: '1' } }, [el('span', { class: 'add-rotulo', text: 'Adicionar' }), valor]);

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
        classe: 'modal-item',
        centro: true,
        lado: srcFoto ? montarFoto() : null, /* no PC: foto quadrada na esquerda, escolhas na direita */
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
          el('span', { class: 'marcador ' + (grupo.tipo === 'unico' ? 'redondo' : 'quadrado') }, [UI.iconeLinha('check')]),
          el('span', { class: 'rotulo' }, [opcao.nome, opcao.descricao ? el('small', { text: opcao.descricao }) : null]),
          el('span', { class: 'valor' + (opcao.preco > 0 ? '' : ' gratis'), text: opcao.preco > 0 ? '+ ' + dinheiro(opcao.preco) : 'grátis' }),
        ]);
        campo.addEventListener('change', function () {
          if (grupo.tipo === 'unico') {
            m.tamanho = opcao.id;
            bloco.querySelectorAll('.opcao').forEach(function (x) { x.classList.remove('marcada'); });
            linha.classList.add('marcada');
          } else if (campo.checked) {
            /* o limite e do GRUPO (borda, extras...), nao de tudo que a pessoa marcou no item */
            var doGrupo = m.adicionais.filter(function (idAd) { return (grupo.opcoes || []).some(function (o) { return o.id === idAd; }); }).length;
            if (grupo.max && doGrupo >= grupo.max) {
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
        var linha = el('label', { class: 'opcao remover' }, [campo, el('span', { class: 'marcador quadrado' }, [UI.iconeLinha('fechar')]), el('span', { class: 'rotulo', text: ing })]);
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
      /* primeiro item: o programa do banco comeca a baixar agora, e ja esta pronto quando a pessoa for mandar o pedido */
      if (store.aquecer) store.aquecer();
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
        /* a forma so pesa no fechamento (taxa do cartao repassada); no carrinho vale a conta sem ela */
        return R.orcar(estado.loja, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: estado.cupom.codigo, formaPagamento: $('tela-dados').classList.contains('ativa') ? formaEscolhida() : '' });
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
        $('carrinhoBarraValor').textContent = orc.erro ? '' : (orc.total === 0 ? 'GRÁTIS' : dinheiro(orc.total));
        $('dadosBarraValor').textContent = orc.erro ? '' : (orc.total === 0 ? 'GRÁTIS' : dinheiro(orc.total));
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
        $('progressoTexto').textContent = falta > 0 ? 'Faltam ' + dinheiro(falta) + ' para a entrega sair de graça' : 'Boa! Sua entrega saiu de graça.';
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
        lista.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone' }, [UI.iconeLinha('retirada')]), el('p', { text: 'Seu pedido está vazio' })]));
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
      estado.carrinho.forEach(function (item, i) {
        /* nome, opcoes e preco da linha pela conta de agora (o dono pode ter mudado preco ou nome no meio do pedido);
           com erro na conta, fica o que foi guardado ao adicionar e o aviso vermelho explica */
        var conta = orcAgora.itens && orcAgora.itens[i];
        var nomeTamanho = conta ? (conta.tamanho && conta.tamanho.nome) : item.tamanhoNome;
        var nomesAdicionais = conta ? conta.adicionais.map(function (a) { return a.nome; }) : (item.adicionaisNomes || []);
        var removidos = conta ? conta.removidos : (item.removidos || []);
        var detalhes = [];
        if (nomeTamanho) detalhes.push(nomeTamanho);
        if (nomesAdicionais.length) detalhes.push('Com ' + nomesAdicionais.join(', '));
        if (item.observacao) detalhes.push('Obs: ' + item.observacao);
        var det = el('div', { class: 'detalhes', text: detalhes.join('\u00a0· ') });
        if (removidos.length) det.appendChild(el('div', { class: 'sem', text: 'SEM: ' + removidos.join(', ') }));
        var produtoDoItem = (estado.loja.produtos || []).filter(function (x) { return x.id === item.produtoId; })[0];
        var srcItem = D.fotoSrc(produtoDoItem, estado.fotos);
        lista.appendChild(el('div', { class: 'item-carrinho' }, [
          el('span', { class: 'miniatura' }, srcItem ? el('img', { src: srcItem, alt: '' }) : (item.emoji || '🍽️')),
          el('div', { class: 'corpo' }, [
            el('div', { class: 'nome', text: item.quantidade + 'x ' + (conta ? conta.nome : item.nome) }),
            det,
            el('div', { class: 'linha-preco' }, [
              el('span', { class: 'preco', text: dinheiro(conta ? conta.totalItem : item.precoUnitario * item.quantidade) }),
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
      $('blocoCupom').hidden = !(estado.loja && (estado.loja.temCupom === true || (estado.loja.cupons && estado.loja.cupons.length))) && !tem;
    }
    $('btnAbrirCupom').addEventListener('click', function () { $('formCupom').hidden = false; $('btnAbrirCupom').hidden = true; $('campoCupom').focus(); });
    $('btnTirarCupom').addEventListener('click', function () { estado.cupom = { codigo: '', percentual: 0, desconto: 0 }; $('campoCupom').value = ''; $('msgCupom').hidden = true; montarCarrinho(); atualizarBarraCarrinho(); });
    /* O codigo vale? Pergunta ao mensageiro (a lista de cupons e da loja, nao do publico). Mensageiro antigo: null, e
       vale a lista que vier na loja. Na demonstracao, a lista guardada no aparelho */
    function buscarCupom(codigo) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo) {
        return (store.lerSegredo ? store.lerSegredo(estado.loja.slug, 'cupons') : Promise.resolve(null)).then(function (s) {
          var regra = ((s && s.lista) || []).filter(function (x) { return x.codigo === codigo; })[0];
          return regra ? { cupom: regra } : null;
        }).catch(function () { return null; });
      }
      if (!cfg.proxyMercadoPago || !window.fetch) return Promise.resolve(null);
      return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/cupom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loja: estado.loja.slug, codigo: codigo }) })
        .then(function (r) { return r.status === 404 ? null : r.json().catch(function () { return {}; }).then(function (j) { return j || {}; }); })
        .catch(function () { return { erro: 'Sem internet agora. Confira e tente de novo.' }; });
    }
    function aplicarCupom() {
      var digitado = $('campoCupom').value.trim();
      var msg = $('msgCupom');
      if (!digitado) { msg.hidden = false; msg.textContent = 'Digite o código para aplicar.'; return; }
      if (estado.carrinho.length === 0) { msg.hidden = false; msg.textContent = 'Adicione um item antes do código.'; return; }
      var codigo = R.semAcento(digitado).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
      var conhecido = (estado.loja.cupons || []).some(function (x) { return x.codigo === codigo; });
      var botao = $('btnAplicarCupom');
      botao.disabled = true;
      (conhecido ? Promise.resolve(null) : buscarCupom(codigo)).then(function (res) {
        botao.disabled = false;
        if (res && res.erro) { UI.soar('erro'); msg.hidden = false; msg.textContent = res.erro; estado.cupom = { codigo: '', percentual: 0, desconto: 0 }; return; }
        if (res && res.cupom) {
          estado.cuponsExtra = (estado.cuponsExtra || []).filter(function (x) { return x.codigo !== res.cupom.codigo; }).concat([res.cupom]);
          estado.loja = juntarCupons(estado.loja);
        }
        aplicarCupomConferido(digitado, msg);
      });
    }
    function aplicarCupomConferido(digitado, msg) {
      var orc;
      try { orc = R.orcar(estado.loja, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: digitado }); }
      catch (e) { msg.hidden = false; msg.textContent = e && e.message ? e.message : 'Algo mudou no cardápio. Confira o pedido.'; return; }
      if (orc.cupomErro) { UI.soar('erro'); msg.hidden = false; msg.textContent = orc.cupomErro; estado.cupom = { codigo: '', percentual: 0, desconto: 0 }; return; }
      /* cupom com limite: quem conta os usos e o mensageiro, na hora de criar o pedido (o contador e fechado para o
         publico). Esgotado, o envio avisa "Esse codigo ja foi todo usado" e o pedido nao nasce: nenhuma leitura aqui */
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
      prepararAvisoCel();
      /* o QR do Pix (57 KB) baixa agora, enquanto a pessoa preenche os dados: a tela do Pix abre com ele pronto */
      if (Pix.carregarQr && !balcao) Pix.carregarQr().catch(function () { /* o Copiar codigo continua valendo */ });
      irPara('tela-dados');
    });

    /* "Me avise no celular": o aviso vai dentro do proprio pedido (a mesma gravacao, nada a mais no banco).
       So aparece onde funciona (Android; iPhone so com o site na tela de inicio). Quem ligou uma vez, vem ligado. */
    function pintarAvisoCel(ligado) {
      var chave = $('chaveAvisoCel');
      chave.classList.toggle('on', ligado);
      chave.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    }
    function prepararAvisoCel() {
      var A = window.LigeiroAvisos;
      var bloco = $('blocoAvisoCel');
      if (!A || balcao) { bloco.hidden = true; estado.avisoCel = null; return; }
      /* o mensageiro ainda nao confirmou os avisos: confere uma vez e volta aqui */
      if (A.situacao() === 'sem' && !estado.avisosConferidos) { estado.avisosConferidos = true; A.preparar().then(function (sit) { if (sit !== 'sem' && vivo) prepararAvisoCel(); }); }
      if (!A.podeCliente()) { bloco.hidden = true; estado.avisoCel = null; return; }
      if (!$('icoAvisoCel').firstChild) $('icoAvisoCel').innerHTML = A.icone();
      bloco.hidden = false;
      if (estado.avisoCel || estado.avisoCelQuer) { pintarAvisoCel(true); return; }
      pintarAvisoCel(false);
      if (!A.clienteQuer() || estado.avisoCelQuer === false) return;
      estado.avisoCelQuer = true;
      pintarAvisoCel(true);
      estado.avisoCelPromessa = A.avisoDoPedido(estado.loja.cidadeSlug, estado.loja.slug, false).then(function (aviso) {
        if (estado.avisoCelQuer) estado.avisoCel = aviso; /* desligou enquanto ligava: fica desligado */
      }, function () { estado.avisoCel = null; estado.avisoCelQuer = false; pintarAvisoCel(false); });
    }
    $('blocoAvisoCel').addEventListener('click', function () {
      var A = window.LigeiroAvisos;
      if (!A) return;
      /* desligar vale na hora, mesmo com a inscricao ainda chegando */
      if (estado.avisoCel || estado.avisoCelQuer) { estado.avisoCel = null; estado.avisoCelQuer = false; A.clienteNaoQuer(); pintarAvisoCel(false); return; }
      estado.avisoCelQuer = true;
      pintarAvisoCel(true);
      estado.avisoCelPromessa = A.avisoDoPedido(estado.loja.cidadeSlug, estado.loja.slug, true).then(function (aviso) {
        if (!estado.avisoCelQuer) return;
        estado.avisoCel = aviso;
        UI.soar('toque');
      }, function (e) {
        estado.avisoCelQuer = false;
        pintarAvisoCel(false);
        UI.avisar((e && e.message) || 'Não deu para ligar os avisos neste celular.');
      });
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
      if (estado.enviandoPedido) return; /* fica "Enviando…" ate a resposta */
      var orc = orcamento();
      var forma = formaEscolhida();
      $('btnPagar').textContent = orc.total === 0 ? 'Confirmar pedido grátis' : (forma === 'pix' ? 'Pagar no Pix' : forma === 'cartao_online' ? 'Pagar com cartão' : 'Confirmar pedido');
    }

    function atualizarFormasDePagamento() {
      var l = estado.loja;
      if (!l) return;
      var naPorta = estado.tipoEntrega === 'entrega' || l.aceitaPagarNoBalcao !== false || balcao;
      var temPix = pixDisponivel(l);
      /* cartao pelo site: nunca no tablet do balcao (cartao digitado em aparelho da loja; la tem a maquininha) */
      var temCartaoSite = cartaoDisponivel(l) && !balcao;
      var temCartao = naPorta && !!l.aceitaCartaoEntrega;
      var temDinheiro = naPorta && !!l.aceitaDinheiroEntrega;
      /* retirada numa loja que so aceita pagar na porta da entrega: diz isso, em vez de "nao configurou pagamento" */
      var soNaEntrega = !naPorta && !temPix && !temCartaoSite && !!(l.aceitaCartaoEntrega || l.aceitaDinheiroEntrega);
      $('semFormaPagamento').textContent = soNaEntrega
        ? 'Esta loja só recebe o pagamento na entrega.' + (l.aceitaEntrega !== false ? ' Volte e escolha "Quero entrega" para pagar na porta.' : ' Para retirar, fale com ela pelo WhatsApp.')
        : 'A loja ainda não configurou uma forma de pagamento. Fale com ela pelo WhatsApp.';
      $('opcaoPix').hidden = !temPix;
      $('opcaoCartaoOnline').hidden = !temCartaoSite;
      $('opcaoCartao').hidden = !temCartao;
      $('opcaoDinheiro').hidden = !temDinheiro;
      var noBalcao = estado.tipoEntrega !== 'entrega';
      /* o titulo do grupo diz QUANDO paga (agora pelo site, na entrega, no balcao); a opcao diz O QUE e. A maquininha
         aceita debito tambem: e o que separa ela do "Cartao de credito" pago agora no site */
      $('nomeCartao').textContent = 'Cartão na maquininha';
      $('detalheCartao').textContent = 'Crédito ou débito, ' + (balcao ? 'aqui no caixa' : noBalcao ? 'na hora de pegar' : 'o entregador leva até você');
      $('nomeDinheiro').textContent = 'Dinheiro';
      $('detalheDinheiro').textContent = balcao ? 'Você paga aqui no caixa' : noBalcao ? 'Você paga na hora de pegar' : 'Você paga quando o pedido chegar';
      /* com as duas turmas (pelo site e na porta), um titulo curto separa uma da outra */
      var agora = temPix || temCartaoSite, depois = temCartao || temDinheiro;
      $('grupoAgora').hidden = !(agora && depois);
      $('grupoNaPorta').hidden = !(agora && depois);
      $('grupoNaPorta').textContent = balcao ? 'Pague no caixa' : noBalcao ? 'Pague no balcão' : 'Pague na entrega';
      $('nomePix').textContent = agora && depois ? 'Pix' : 'Pix agora';
      var disponiveis = { pix: temPix, cartao_online: temCartaoSite, cartao_entrega: temCartao, dinheiro_entrega: temDinheiro };
      var formaAntes = formaEscolhida();
      if (!disponiveis[formaAntes]) {
        var campos = { pix: 'pgtoPix', cartao_online: 'pgtoCartaoOnline', cartao_entrega: 'pgtoCartao', dinheiro_entrega: 'pgtoDinheiro' };
        var primeira = Object.keys(disponiveis).filter(function (f) { return disponiveis[f]; })[0];
        if (primeira) {
          $(campos[primeira]).checked = true;
          /* a forma que a pessoa via marcada saiu agora (a loja desligou o Pix, o cartao...): avisa e mostra o bloco do
             pagamento, em vez de trocar calado. Fora do fechamento ela ainda nao viu a escolha: troca sem aviso */
          if ($('tela-dados').classList.contains('ativa')) formaSaiu(formaAntes);
        }
      }
      marcarFormaEscolhida();
      var orc = orcamento();
      $('blocoTroco').hidden = orc.total === 0 || formaEscolhida() !== 'dinheiro_entrega';
      /* mesmo com uma forma so o bloco fica: e nele que mora o "precisa de troco?" */
      pintarTaxaDoCartao();
      var algumaForma = temPix || temCartaoSite || temCartao || temDinheiro;
      $('blocoPagamento').hidden = orc.total === 0 || !algumaForma;
      $('semFormaPagamento').hidden = algumaForma;
      atualizarBotaoPagar();
      $('btnPagar').disabled = !!estado.enviandoPedido || !algumaForma;
      if (!$('blocoTroco').hidden) atualizarTroco();
      renumerarPassos();
    }

    var NOME_DA_FORMA = { pix: 'O Pix', cartao_online: 'O cartão pelo site', cartao_entrega: 'O cartão na maquininha', dinheiro_entrega: 'O dinheiro' };
    function formaSaiu(forma) {
      var texto = (NOME_DA_FORMA[forma] || 'Essa forma de pagamento') + ' não está mais disponível agora. Confira como você quer pagar.';
      var aviso = $('avisoForma');
      UI.limpar(aviso);
      aviso.appendChild(UI.iconeLinha('alerta'));
      aviso.appendChild(el('span', { text: texto }));
      aviso.hidden = false;
      UI.avisar(texto);
      $('blocoPagamento').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /* Taxa do cartao repassada pela loja: o cliente ve em reais antes de escolher (e o Pix aparece como "sem taxa") */
    function pintarTaxaDoCartao() {
      var l = estado.loja;
      if (!l || $('opcaoCartaoOnline').hidden || !estado.carrinho.length) return;
      try {
        var semCartao = R.orcar(l, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: estado.cupom.codigo, formaPagamento: 'pix' });
        var comCartao = R.orcar(l, { itens: itensParaRegras(), tipoEntrega: estado.tipoEntrega, cupom: estado.cupom.codigo, formaPagamento: 'cartao_online' });
        var taxa = comCartao.acrescimoCartao || 0;
        $('detalheCartaoOnline').textContent = taxa > 0 ? 'À vista, + ' + dinheiro(taxa) + ' de taxa do cartão' : 'À vista, pago agora aqui no site';
        $('detalhePix').textContent = taxa > 0 && semCartao.total > 0 ? 'Sem taxa, direto para a loja' : 'Paga pelo celular, direto para a loja';
      } catch (_) { /* item saiu do cardapio: a tela ja mostra o motivo */ }
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
      r.addEventListener('change', function () { $('avisoForma').hidden = true; if (r.value === 'cartao_online' && r.checked) carregarSdkCartao().catch(function () { /* tenta de novo na tela do cartao */ }); marcarFormaEscolhida(); atualizarBotaoPagar(); atualizarBarraCarrinho(); $('blocoTroco').hidden = formaEscolhida() !== 'dinheiro_entrega'; if (!$('blocoTroco').hidden) atualizarTroco(); });
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
        if (!v) { erros.push('Diga com quanto você vai pagar, para separarem o troco.'); $('campoTroco').classList.add('erro'); }
        else if (v < orcamento().total) { erros.push('O valor do troco precisa ser maior que o total.'); $('campoTroco').classList.add('erro'); }
      }
      var caixa = $('erroDados');
      if (erros.length) {
        UI.soar('erro');
        /* campo faltando: o balao diz o que falta e o campo fica vermelho, com a tela rolando ate ele. A caixa de baixo
           fica so para erro do envio (total mudou, sem internet), que nao aparece em outro lugar */
        caixa.hidden = true;
        UI.avisar(erros[0]);
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
      /* um pedido por vez: da conferencia da loja ate a resposta do banco, nada religa o botao (voltar e tocar em
         Continuar, ou a loja chegando de novo, reativavam e saia pedido em dobro com internet fraca) */
      if (estado.enviandoPedido) return;
      var dados = validarFormulario();
      if (!dados) return;
      if (fechouNoMeio()) return; /* fechou nos ultimos segundos: nada de erro no fim, volta com o carrinho guardado */
      var botao = $('btnPagar');
      estado.enviandoPedido = true;
      botao.disabled = true;
      botao.textContent = 'Enviando…';
      var soltar = function () { estado.enviandoPedido = false; botao.disabled = false; atualizarBotaoPagar(); };
      var totalVisto = orcamento().total;
      /* a loja de agora (a copia da borda so confere a cada minuto): fechou ou mudou o preco nesse meio tempo? */
      var conferir = lojaViva.conferirAgora && !balcao ? lojaViva.conferirAgora().catch(function () { return null; }) : Promise.resolve(null);
      conferir.then(function (fresca) {
        if (!vivo) return;
        if (fresca) {
          estado.loja = juntarCupons(fresca);
          if (fechouNoMeio()) { soltar(); return; }
          var orcNovo = orcamento();
          if (orcNovo.erro || orcNovo.total !== totalVisto) {
            UI.soar('erro');
            atualizarBarraCarrinho();
            /* item que saiu do cardapio nao e "o total mudou para R$ 0,00": diz qual item e o que fazer */
            mostrarErroDados(orcNovo.erro
              ? orcNovo.erro + ' Volte ao carrinho e tire esse item para continuar.'
              : 'A loja acabou de atualizar o cardápio e o total mudou para ' + dinheiro(orcNovo.total) + '. Confira e toque de novo.');
            soltar();
            return;
          }
        }
        enviarPedido(dados, botao);
      });
    });

    /* Erro do envio: a caixa fica no fim do formulario, entao a tela rola ate ela e o balao repete o texto */
    function mostrarErroDados(texto) {
      var caixa = $('erroDados');
      caixa.textContent = texto;
      caixa.hidden = false;
      UI.avisar(texto);
      caixa.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /* A chave deste pedido: a mesma em todo toque de novo com o mesmo carrinho e os mesmos dados; mudou algo, outra.
       Fica no rascunho da aba (vale mesmo se a pagina recarregar) e sai quando o pedido nasce e aparece na tela */
    function chaveDoPedido(dados) {
      estado.chavePedido = chaveDoEnvio(estado.chavePedido, assinaturaDe(dados), Date.now());
      return estado.chavePedido;
    }

    function enviarPedido(dados, botao) {
      var pedido;
      try {
        pedido = R.montarPedido(estado.loja, dados);
      } catch (erro) {
        UI.soar('erro');
        mostrarErroDados(erro.message);
        estado.enviandoPedido = false;
        botao.disabled = false;
        atualizarBotaoPagar();
        return;
      }
      /* banco no limite de hoje (a borda avisou, ou o banco ja recusou antes): o pedido vai pronto pelo WhatsApp */
      if (estado.loja && (estado.loja._pausaSite || estado.pausaLocal)) {
        estado.enviandoPedido = false;
        botao.disabled = false;
        atualizarBotaoPagar();
        abrirPausa(pedido);
        return;
      }
      estado.enviandoPedido = true;
      var envio = chaveDoPedido(dados);
      var reenvio = !!envio.enviou; /* toque de novo: o pedido pode ter nascido no primeiro envio, minutos antes */
      envio.enviou = true;
      guardarRascunho();
      /* o aviso no celular ainda ligando (tocou em pagar logo depois da chave): espera ate 4 s para ir junto com o pedido */
      var esperarAviso = estado.avisoCelPromessa && !balcao
        ? Promise.race([estado.avisoCelPromessa.then(function () {}, function () {}), new Promise(function (r) { setTimeout(r, 4000); })])
        : Promise.resolve();
      var avisado = false;
      esperarAviso.then(function () {
        if (estado.avisoCel && estado.avisoCelQuer !== false && !balcao) pedido.aviso = estado.avisoCel;
        /* o pedido nasce no servidor (ele refaz a conta pelo cardapio, da a senha e conta o cupom); o banco nao aceita
           pedido gravado direto. Servidor antigo, sem a rota: o caminho de antes, ate o novo entrar no ar */
        return criarNoServidor(dados, pedido.aviso, envio.chave).then(function (r) {
          if (r === null) return store.criarPedido(estado.loja.slug, pedido);
          avisado = !!r.avisado;
          /* a hora do servidor veio no pedido: a diferenca para o relogio daqui (so no primeiro envio) */
          if (!reenvio) guardarDesvio(desvioDoRelogio(r.pedido.criadoEm, Date.now()));
          return r.pedido;
        });
      }).then(function (gravado) {
        estado.enviandoPedido = false;
        estado.pedido = gravado;
        estado.chavePedido = null; /* o pedido nasceu e vai aparecer: o proximo fechamento ganha outra chave */
        /* pedido ja na fila (pago ou para cobrar na entrega): o painel e a cozinha apitam, mesmo com a tela apagada
           (o servidor novo ja avisou quando criou) */
        if (window.LigeiroAvisos && !avisado) window.LigeiroAvisos.pedidoNovo(estado.loja.slug, gravado);
        salvarDadosDoCliente();
        if (!balcao) guardarMeuPedido(estado.loja.slug, gravado);
        /* se desistir do Pix ou do cartao, os itens DESTE pedido voltam (pedido ja na fila nao guarda nada) */
        estado.ultimoCarrinho = gravado.status === R.STATUS.AGUARDANDO ? { id: gravado.id, itens: estado.carrinho } : null;
        /* e voltam mesmo se a pagina recarregar no meio (iPhone depois do app do banco): guardado ate o Pix cair ou vencer */
        if (!balcao && gravado.status === R.STATUS.AGUARDANDO) { try { sessionStorage.setItem('ligeiro:carrinho-do-pix:' + gravado.id, JSON.stringify(estado.carrinho)); } catch (_) { /* segue */ } }
        estado.carrinho = [];
        estado.cupom = { codigo: '', percentual: 0, desconto: 0 };
        limparRascunho();
        if (!balcao) window.LigeiroApp.substituir(estado.loja.cidadeSlug + '/' + estado.loja.slug + '/pedido/' + gravado.id);
        if (gravado.status === R.STATUS.AGUARDANDO) mostrarPagar(gravado);
        else mostrarSenha(gravado);
      }).catch(function (erro) {
        if ((erro && erro.pausa) || (D.ehLimite && D.ehLimite(erro))) {
          estado.pausaLocal = true;
          if (store.avisarPausa) store.avisarPausa();
          abrirPausa(pedido);
          return;
        }
        UI.soar('erro');
        /* o banco recusa pedido gravado direto do celular (so o mensageiro cria): so acontece no caminho de antes,
           com mensageiro antigo. Nao e o relogio do celular */
        var semPermissao = !!erro && (erro.code === 'permission-denied' || /permission/i.test(String(erro.message || '')));
        mostrarErroDados(semPermissao
          ? 'Não deu para enviar o pedido pelo site agora. Chame a loja no WhatsApp ou tente de novo daqui a pouco.'
          : D.erroAmigavel(erro, 'Não conseguimos enviar o pedido. Tente de novo.'));
        if (pedeOutraForma(erro)) voltarParaAsFormas();
      }).then(function () {
        estado.enviandoPedido = false;
        botao.disabled = false;
        atualizarBotaoPagar();
      });
    }

    /* A forma escolhida saiu (o servidor recusou): a loja de agora chega, a forma que saiu some da lista (com o aviso
       do formaSaiu) e a tela volta para o bloco "Como voce quer pagar?" */
    function voltarParaAsFormas() {
      var conferir = lojaViva.conferirAgora ? lojaViva.conferirAgora().catch(function () { return null; }) : Promise.resolve(null);
      conferir.then(function (fresca) {
        if (!vivo) return;
        if (fresca) aplicarLoja(fresca, true);
        if ($('tela-dados').classList.contains('ativa') && !$('blocoPagamento').hidden) $('blocoPagamento').scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }

    /* Cria o pedido no servidor. Devolve { pedido, avisado }, ou null quando nao da para usar o servidor (demonstracao,
       sem mensageiro, ou mensageiro antigo sem a rota): ai o pedido vai pelo caminho de antes.
       chave: a do fechamento (dados.chave); mensageiro antigo ignora */
    function criarNoServidor(dados, aviso, chave) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || !cfg.proxyMercadoPago || !window.fetch) return Promise.resolve(null);
      var login = balcao && store.obterIdToken ? store.obterIdToken().catch(function () { return ''; }) : Promise.resolve('');
      return login.then(function (token) {
        var cab = { 'Content-Type': 'application/json' };
        if (token) cab.Authorization = 'Bearer ' + token;
        var comChave = chave ? Object.assign({}, dados, { chave: chave }) : dados;
        return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/pedido', { method: 'POST', headers: cab, body: JSON.stringify({ loja: estado.loja.slug, dados: comChave, aviso: aviso || null }) });
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return lerRespostaDoPedido(r.status, j); });
      });
    }

    /* Site em pausa (banco gratis no limite de hoje): tela por cima de tudo, com degrade e desfoque, e o pedido pronto
       para mandar no WhatsApp da loja. Nada se perde; o carrinho continua guardado. */
    function abrirPausa(pedido) {
      var l = estado.loja || {};
      var velho = document.querySelector('.pausa-fundo');
      if (velho) velho.remove();
      var oficial = UI.lojaOficial && UI.lojaOficial(l.slug);
      var link = l.whatsapp ? R.linkWhatsapp(l.whatsapp, R.pedidoParaWhatsapp(l, pedido)) : '';
      var fundo = el('div', { class: 'pausa-fundo', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pausaTitulo' });
      function fechar() { fundo.remove(); document.removeEventListener('keydown', tecla); }
      function tecla(e) { if (e.key === 'Escape') fechar(); }
      fundo.appendChild(el('div', { class: 'pausa-caixa' }, [
        el('img', { class: 'pausa-mascote', src: (oficial && oficial.logo) || 'img/mascote-192.webp', alt: '' }),
        el('div', { class: 'pausa-selo laranja' }, [el('i', { 'aria-hidden': 'true' }), 'Muito movimento agora']),
        link
          ? el('h2', { id: 'pausaTitulo' }, ['Seu pedido vai pelo ', el('span', { class: 'pausa-destaque', text: 'WhatsApp' })])
          : el('h2', { id: 'pausaTitulo', text: 'Chame a loja para pedir' }),
        el('p', { text: link
          ? 'O site da ' + (l.nome || 'loja') + ' está com movimento demais agora. Seu pedido já vai escrito, é só enviar.'
          : 'O site da ' + (l.nome || 'loja') + ' está com movimento demais agora. Chame a loja para fazer o seu pedido.' }),
        el('div', { class: 'pausa-botoes' }, [
          link ? el('a', { class: 'btn btn-whats btn-largo', href: link, target: '_blank', rel: 'noopener', onclick: function () { UI.soar('toque'); } }, [UI.icone('zap'), 'Mandar pelo WhatsApp']) : null,
          el('button', { class: 'btn btn-contorno btn-largo', type: 'button', text: 'Voltar', onclick: fechar }),
        ]),
      ]));
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(); });
      document.addEventListener('keydown', tecla);
      document.body.appendChild(fundo);
      var primeiro = fundo.querySelector('.btn');
      if (primeiro) primeiro.focus();
    }

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
        var codigo = Pix.gerar({ chave: 'demo@ligeiropedidos.com.br', nome: estado.loja.nome, cidade: estado.loja.cidade || 'Juquia', valor: pedido.total, txid: R.txidPix(pedido), descricao: 'Pedido ' + pedido.senha });
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
      }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j.codigo) return j.codigo;
          var e = new Error(j.erro || 'O Pix não veio.');
          /* o cardapio mudou depois do pedido: a tela diz isso e oferece montar de novo (tentar de novo nao adianta) */
          e.montarDeNovo = r.status === 409 && pedeMontarDeNovo(j.erro);
          throw e;
        });
      });
    }

    /* Pergunta ao mensageiro como esta o Pix do pedido. Sem mensageiro (demonstracao) ou sem internet, devolve {}.
       Com o id do Mercado Pago e o prazo (vem no pedido), o mensageiro pergunta direto ao Mercado Pago e nao le o banco */
    function consultarStatusPix(idPedido) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || !cfg.proxyMercadoPago) return Promise.resolve({});
      var p = estado.pedido && estado.pedido.id === idPedido ? estado.pedido : null;
      var leve = p && p.mp && p.mp.id && p.pixExpiraEm ? '&mp=' + encodeURIComponent(p.mp.id) + '&expira=' + encodeURIComponent(p.pixExpiraEm) : '';
      return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/status?loja=' + encodeURIComponent(estado.loja.slug) + '&pedido=' + encodeURIComponent(idPedido) + leve)
        .then(function (r) { return r.json(); })
        .then(function (j) { return j || {}; })
        .catch(function () { return {}; });
    }

    function aindaEsperandoPix(idPedido) {
      return vivo && !!estado.pedido && estado.pedido.id === idPedido && estado.pedido.status === R.STATUS.AGUARDANDO;
    }

    /* Enquanto espera o Pix cair: pergunta ao mensageiro a cada 10 s (o aviso do Mercado Pago e o caminho principal
       e chega pela escuta do pedido). Com a tela apagada ou em outra aba nao pergunta: na volta, pergunta de novo. */
    function vigiarPix(pedido) {
      pararVigia();
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || !cfg.proxyMercadoPago) return;
      var vigia = estado.vigiaPix = setInterval(function () {
        if (!aindaEsperandoPix(pedido.id)) { pararVigia(); return; }
        if (document.hidden) return;
        /* quem diz se o Pix venceu (30 min) e o relogio do servidor, no campo "vencido" da resposta:
           celular com a hora errada nao cancela o pedido de quem ainda esta pagando.
           Mensageiro antigo, sem esse campo (ou sem resposta): vale o relogio do aparelho (corrigido), como antes. */
        var vencidoAqui = R.pixVencido(estado.pedido, agoraCerto());
        consultarStatusPix(pedido.id).then(function (resp) {
          if (estado.vigiaPix !== vigia || !aindaEsperandoPix(pedido.id)) return;
          /* pagou: a senha agora, mesmo se a escuta do pedido nao comecou (o programa do banco nao baixou) */
          if (pagoNoStatus(resp)) { mostrarPago(pedido.id); return; }
          var vencido = typeof resp.vencido === 'boolean' ? resp.vencido : vencidoAqui;
          if (!vencido) return;
          pararVigia();
          return cancelarPedidoDoPix('O Pix venceu (30 minutos) e o pedido foi cancelado.', false, 'pix-vencido', true);
        }).catch(function () { /* o painel da loja cancela do lado de la */ });
      }, 10000);
    }
    function pararVigia() { if (estado.vigiaPix) clearInterval(estado.vigiaPix); estado.vigiaPix = null; }

    /* O dinheiro passou (o /status ou o pedido lido agora disse): a senha no lugar da tela de pagar. A escuta do pedido
       faz o mesmo quando chega; aqui e para quando ela atrasa ou nem comecou */
    function mostrarPago(idPedido, fresco) {
      if (!vivo || !estado.pedido || estado.pedido.id !== idPedido) return;
      if (estado.pedido.status !== R.STATUS.AGUARDANDO && $('tela-senha').classList.contains('ativa')) return; /* a escuta chegou antes */
      pararVigia();
      desmontarCartao();
      var base = fresco && fresco.id === idPedido ? fresco : estado.pedido;
      var pago = base.status !== R.STATUS.AGUARDANDO ? base : Object.assign({}, base, { status: R.STATUS.PAGO, pagamentoStatus: 'pago' });
      estado.pedido = pago;
      atualizarMeuPedido(pago);
      UI.soar('sucesso');
      UI.vibrar([80, 40, 80]);
      mostrarSenha(pago);
    }

    /* Pedido pago: os itens dele nao voltam mais para o carrinho (nem num "desistir" de outro pedido depois) */
    function esquecerCarrinho(idPedido) {
      if (estado.ultimoCarrinho && estado.ultimoCarrinho.id === idPedido) estado.ultimoCarrinho = null;
      try { sessionStorage.removeItem('ligeiro:carrinho-do-pix:' + idPedido); } catch (_) { /* segue */ }
    }

    /* O prazo para pagar acabou? O relogio do aparelho (corrigido pela diferenca medida quando o pedido nasceu) so
       desconfia; quem confirma e o servidor, no "vencido" do /status. Pagou nesse meio tempo: a senha. Cartao em analise:
       espera o banco. Sem resposta do servidor (demonstracao, mensageiro antigo), vale o aparelho, como antes.
       Devolve true se cancelou */
    function cancelarSeVenceu(pedido, aviso) {
      if (!R.pixVencido(pedido, agoraCerto())) return Promise.resolve(false);
      return consultarStatusPix(pedido.id).then(function (resp) {
        if (!aindaEsperandoPix(pedido.id)) return false;
        if (pagoNoStatus(resp)) { mostrarPago(pedido.id); return false; }
        if (resp.vencido === false || emAnalise(estado.pedido, agoraCerto())) return false;
        pararVigia();
        desmontarCartao();
        return cancelarPedidoDoPix(aviso, true, 'pix-vencido', true);
      });
    }

    /* Tela de pagar abrindo com o prazo vencido pelo relogio daqui (pedido velho, ou celular com a hora adiantada):
       confere com o servidor antes. Ainda vale: abre a tela (uma vez por pedido; depois quem vigia e o relogio da tela) */
    function prazoEmDuvida(pedido, aviso, abrir) {
      if (estado.prazoConferido === pedido.id || !R.pixVencido(pedido, agoraCerto())) return false;
      cancelarSeVenceu(pedido, aviso).then(function (cancelou) {
        if (cancelou || !aindaEsperandoPix(pedido.id)) return;
        estado.prazoConferido = pedido.id;
        abrir(estado.pedido);
      }).catch(function () { if (vivo) irPara('tela-inicio'); });
      return true;
    }

    function mostrarPagamento(pedido) {
      estado.pedido = pedido;
      var codigo = pedido.pixCodigo || '';
      /* pedido de Pix antigo (aberto pelo "Meus pedidos" horas depois, ou que nunca ganhou codigo): confere o prazo com o
         servidor ANTES de mostrar a tela. Antes, com codigo, a tela abria com o QR ja vencido e so depois de ate 10 s a vigia
         cancelava e jogava a pessoa para o inicio. Vencido de verdade: cancela e avisa; pago nesse meio tempo: a senha */
      if (prazoEmDuvida(pedido, 'Esse Pix passou do prazo e o pedido foi cancelado.', mostrarPagamento)) return;
      $('pixValor').textContent = dinheiro(pedido.total);
      $('pixNomeLoja').textContent = 'Para: ' + estado.loja.nome;
      var gerando = $('pixGerando');
      var falhou = $('pixFalhou');
      var pronto = !!codigo;
      gerando.hidden = pronto;
      falhou.hidden = true;
      $('btnTentarPix').hidden = false;
      $('btnRemontarPix').hidden = true;
      $('pixPagar').hidden = !pronto;
      $('pixQr').hidden = !pronto;
      $('pixCodigo').hidden = !pronto;
      $('btnCopiarPix').hidden = !pronto;
      $('passosPix').hidden = !pronto;
      if (pronto) {
        $('pixCodigo').textContent = codigo;
        /* 228: o QR grande o bastante para outro celular ler, e o "Copiar" ainda na primeira tela do celular */
        var desenhou = Pix.desenharQr($('pixQr'), codigo, 228);
        $('pixQr').hidden = !desenhou;
        $('btnCopiarPix').onclick = function () {
          UI.copiar(codigo).then(function (ok) { UI.avisar(ok ? 'Código copiado! Cole no app do seu banco.' : 'Não deu para copiar sozinho. Toque e segure no código para copiar.'); });
        };
      } else if (estado.pedindoPix !== pedido.id) {
        estado.pedindoPix = pedido.id; /* por pedido: desistir de um e abrir outro nao deixa o novo preso em "gerando" */
        pedirCodigoPix(pedido).then(function (c) {
          if (estado.pedindoPix === pedido.id) estado.pedindoPix = null;
          if (!estado.pedido || estado.pedido.id !== pedido.id) return;
          if (!estado.pedido.pixCodigo) mostrarPagamento(Object.assign({}, estado.pedido, { pixCodigo: c }));
        }).catch(function (e) {
          if (estado.pedindoPix === pedido.id) estado.pedindoPix = null;
          if (!estado.pedido || estado.pedido.id !== pedido.id) return;
          /* o codigo pode ter chegado por outro caminho (onSnapshot) enquanto isso: ai nao e falha */
          if (estado.pedido.pixCodigo) { mostrarPagamento(estado.pedido); return; }
          gerando.hidden = true;
          falhou.hidden = false;
          /* o cliente ve uma frase simples; o detalhe tecnico vai pro console (e nunca JSON cru na tela) */
          if (window.console && e) console.warn('Pix nao gerou:', e.message || e);
          /* o cardapio mudou depois do pedido: o texto do servidor ja diz o que fazer, e o botao monta de novo */
          var montar = !!(e && e.montarDeNovo);
          $('btnTentarPix').hidden = montar;
          $('btnRemontarPix').hidden = !montar;
          /* motivo em palavras de cliente: o texto tecnico (em ingles, ou o recado para o lojista) fica so no console */
          var m = String((e && e.message) || '');
          var motivo = (e instanceof TypeError || /failed to fetch|load failed|network/i.test(m)) ? ' Confira a sua internet.'
            : (/chave Pix|ligou o Pix|Mercado Pago/i.test(m) ? ' O Pix desta loja está fora do ar agora.' : '');
          $('pixFalhouTexto').textContent = montar ? m : 'Não deu para gerar o Pix agora.' + motivo + ' Tente de novo ou volte e escolha outra forma de pagamento.';
        });
      }
      irPara('tela-pagamento');
      acompanhar(pedido);
      vigiarPix(pedido);

      /* balcao: Pix esquecido no tablet nao fica pro proximo cliente. 3 min sem pagar: volta pro inicio.
         Conta uma vez por pedido (o codigo chegar ou "tentar de novo" nao zeram o prazo). */
      if (balcao && estado.relogioPixDe !== pedido.id) {
        clearTimeout(estado.relogioBalcao);
        estado.relogioPixDe = pedido.id;
        estado.relogioBalcao = setTimeout(function () { pixEsquecidoNoBalcao(pedido.id); }, 3 * 60 * 1000);
      }
    }

    /* O tablet volta pro inicio, mas o pedido NAO e cancelado: o codigo vale 30 min, e quem paga devagar no celular nao
       pode ouvir "cancelado" e depois pagar. Pago depois, ele entra na fila da loja sozinho (com a senha no painel);
       nunca pago, o painel tira da fila quando o Pix vence */
    function pixEsquecidoNoBalcao(idPedido) {
      if (!aindaEsperandoPix(idPedido)) return;
      consultarStatusPix(idPedido).then(function (resp) {
        if (!aindaEsperandoPix(idPedido)) return;
        if (pagoNoStatus(resp)) { mostrarPago(idPedido); return; }
        pararVigia();
        novoPedido();
        UI.avisar('O tempo desta tela acabou. Se o Pix for pago, o pedido entra na fila da loja.');
      }).catch(function () { if (vivo) novoPedido(); });
    }

    $('btnTentarPix').addEventListener('click', function () { if (estado.pedido) mostrarPagamento(estado.pedido); });

    /* ---------- cartao de credito pelo site ---------- */

    /* A loja ligou o cartao, o Mercado Pago esta conectado e a chave publica chegou. Na demonstracao, simula. */
    function cartaoDisponivel(l) {
      var cfg = window.LIGEIRO_CONFIG || {};
      return !!l && R.cartaoPeloSite(l) && (D.modoDemo || !!cfg.proxyMercadoPago);
    }

    /* pedido que espera pagamento pelo site: cada forma na sua tela */
    function mostrarPagar(pedido) {
      if (pedido.formaPagamento === 'cartao_online') mostrarCartao(pedido);
      else mostrarPagamento(pedido);
    }

    /* o formulario do Mercado Pago (numero, validade, codigo e CPF) vem do proprio Mercado Pago: o numero do cartao nunca
       passa pelo Ligeiro, so um codigo de uso unico. Baixa uma vez, quando a pessoa escolhe o cartao */
    var sdkCartao = null;
    function carregarSdkCartao() {
      if (D.modoDemo) return Promise.resolve();
      if (window.MercadoPago) return Promise.resolve();
      if (sdkCartao) return sdkCartao;
      sdkCartao = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://sdk.mercadopago.com/js/v2';
        s.onload = function () { if (window.MercadoPago) resolve(); else { sdkCartao = null; reject(new Error('sdk')); } };
        s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); sdkCartao = null; reject(new Error('sdk')); };
        document.head.appendChild(s);
      });
      return sdkCartao;
    }

    var CHAVE_EMAIL = 'ligeiro:email-do-cartao';
    function desmontarCartao() {
      var b = estado.brickCartao;
      estado.brickCartao = null;
      estado.montandoCartao = null;
      clearInterval(estado.relogioCartao);
      estado.relogioCartao = null;
      if (b && typeof b.unmount === 'function') { try { b.unmount(); } catch (_) { /* ja saiu */ } }
      UI.limpar($('cartaoForm'));
    }

    function mostrarCartao(pedido) {
      estado.pedido = pedido;
      /* pedido de cartao velho (a pagina ficou aberta): o mensageiro recusa depois de 40 min. Vencido de verdade (o
         servidor confirma): cancela e devolve os itens */
      if (prazoEmDuvida(pedido, 'O tempo para pagar acabou e o pedido foi cancelado.', mostrarCartao)) return;
      $('cartaoValor').textContent = dinheiro(pedido.total);
      $('cartaoNomeLoja').textContent = 'Para: ' + estado.loja.nome;
      $('cartaoTaxa').hidden = !(pedido.acrescimoCartao > 0);
      $('cartaoTaxa').textContent = pedido.acrescimoCartao > 0 ? 'Inclui ' + dinheiro(pedido.acrescimoCartao) + ' de taxa do cartão' : '';
      $('cartaoRecusado').hidden = true;
      $('btnOutraForma').hidden = true;
      $('btnCancelarCartao').hidden = false;
      irPara('tela-cartao');
      acompanhar(pedido);
      /* cobranca em analise (voltou para esta tela, ou recarregou): espera o banco, sem formulario e sem o X */
      if (emAnalise(pedido, agoraCerto())) pintarAnalise();
      else montarFormCartao(pedido);
      /* tela aberta e esquecida: passou do prazo, cancela sozinho (o servidor confirma antes) */
      clearInterval(estado.relogioCartao);
      estado.relogioCartao = setInterval(function () {
        if (!aindaEsperandoPix(pedido.id) || !$('tela-cartao').classList.contains('ativa')) { clearInterval(estado.relogioCartao); return; }
        if (estado.pagandoCartao || emAnalise(estado.pedido, agoraCerto())) return;
        cancelarSeVenceu(estado.pedido, 'O tempo para pagar acabou e o pedido foi cancelado.').catch(function () { /* a loja cancela do lado de la */ });
      }, 30000);
    }

    var TEXTO_ANALISE = 'Seu pagamento está em análise pelo banco. Assim que aprovar, o pedido entra na fila sozinho.';
    var TEXTO_ANALISE_CURTO = 'O banco ainda está conferindo o seu pagamento. Espere um pouco.';

    /* cartao em analise: sem formulario (o mensageiro nao cobra de novo agora) e sem o X (o dinheiro pode estar saindo).
       Quando o banco responder, a escuta do pedido mostra a senha ou devolve o formulario (travaDoCartao) */
    function pintarAnalise(motivo) {
      desmontarCartao();
      $('cartaoCarregando').hidden = true;
      $('cartaoFalhou').hidden = true;
      cartaoRecusado(motivo || TEXTO_ANALISE, true);
      $('btnCancelarCartao').hidden = true;
    }

    /* a escuta trouxe o pedido de cartao ainda esperando: a analise acabou sem aprovar? O X volta, e o formulario tambem */
    function travaDoCartao(p) {
      var travado = emAnalise(p, agoraCerto());
      var estava = $('btnCancelarCartao').hidden;
      $('btnCancelarCartao').hidden = travado;
      if (estava && !travado && !estado.montandoCartao && !estado.pagandoCartao) {
        cartaoRecusado('O banco não aprovou o pagamento. Tente outro cartão ou pague no Pix.');
        montarFormCartao(p);
      }
    }

    /* montar: o cardapio mudou depois do pedido. So o "Montar de novo" (tentar de novo ou trocar a forma nao adianta) */
    function cartaoFalhou(texto, montar) {
      $('cartaoCarregando').hidden = true;
      $('cartaoFalhou').hidden = false;
      $('cartaoFalhouTexto').textContent = texto;
      $('btnTentarCartao').hidden = !!montar;
      $('btnRemontarCartao').hidden = !montar;
      $('btnOutraForma').hidden = !!montar;
    }

    function cartaoRecusado(motivo, esperando) {
      var caixa = $('cartaoRecusado');
      UI.limpar(caixa);
      caixa.classList.toggle('cartao-esperando', !!esperando);
      caixa.appendChild(UI.iconeLinha(esperando ? 'relogio' : 'alerta'));
      caixa.appendChild(el('span', { text: motivo || 'O banco recusou o pagamento. Tente outro cartão ou pague no Pix.' }));
      caixa.hidden = false;
      $('btnOutraForma').hidden = !!esperando;
      if (esperando) return;
      UI.soar('erro');
      UI.vibrar([60, 40, 60]);
    }

    /* manda o codigo do cartao para o mensageiro, que cobra no Mercado Pago e marca o pedido pago */
    function cobrarCartao(pedido, dados) {
      var cfg = window.LIGEIRO_CONFIG || {};
      var pagador = dados.payer || {};
      var email = String(pagador.email || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) UI.guardarLocal(CHAVE_EMAIL, email);
      return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/cartao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loja: estado.loja.slug, pedido: pedido.id, token: dados.token, metodo: dados.payment_method_id,
          email: email, documento: (pagador.identification && pagador.identification.number) || '',
        }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          j = j || {};
          if (r.ok || j.status) return j;
          var e = new Error(j.erro || 'cartao');
          e.montarDeNovo = r.status === 409 && pedeMontarDeNovo(j.erro);
          throw e;
        });
      });
    }

    function pagamentoAprovado(pedido) {
      if (!estado.pedido || estado.pedido.id !== pedido.id) return;
      if (!$('tela-cartao').classList.contains('ativa')) return; /* a escuta do pedido chegou antes e ja mostrou a senha */
      mostrarPago(pedido.id);
    }

    /* o formulario do Mercado Pago nas cores da loja (e nas da casa, na Dom Conizza): primeira variavel que existir */
    function corDaTela(nomes, reserva) {
      var estilo = getComputedStyle($('tela-cartao'));
      for (var i = 0; i < nomes.length; i++) { var v = estilo.getPropertyValue(nomes[i]).trim(); if (v) return v; }
      return reserva;
    }

    function montarFormCartao(pedido) {
      desmontarCartao();
      var chave = pedido.id + ':' + Date.now();
      estado.montandoCartao = chave;
      $('cartaoCarregando').hidden = false;
      $('cartaoFalhou').hidden = true;
      if (D.modoDemo) { montarCartaoDeTeste(pedido); return; }
      carregarSdkCartao().then(function () {
        if (estado.montandoCartao !== chave || !$('tela-cartao').classList.contains('ativa')) return;
        var mp = new window.MercadoPago(estado.loja.mpChavePublica, { locale: 'pt-BR' });
        var emailSalvo = UI.lerLocal(CHAVE_EMAIL);
        var inicio = { amount: Number(pedido.total) / 100 };
        if (typeof emailSalvo === 'string' && emailSalvo) inicio.payer = { email: emailSalvo };
        return mp.bricks().create('cardPayment', 'cartaoForm', {
          initialization: inicio,
          customization: {
            paymentMethods: { minInstallments: 1, maxInstallments: 1, types: { excluded: ['debit_card', 'prepaid_card'] } },
            visual: {
              hideFormTitle: true,
              texts: { formSubmit: 'Pagar ' + dinheiro(pedido.total), emailSectionTitle: 'Seu e-mail para o comprovante' },
              style: {
                theme: 'default',
                customVariables: {
                  baseColor: corDaTela(['--cz-vermelho', '--lime'], '#84CC16'),
                  baseColorFirstVariant: corDaTela(['--cz-vermelho-escuro', '--lime-escuro'], '#5E9A0C'),
                  baseColorSecondVariant: corDaTela(['--cz-vermelho-escuro', '--lime-escuro'], '#5E9A0C'),
                  buttonTextColor: corDaTela(['--cz-creme', '--texto-no-destaque'], '#0E1F14'),
                  textPrimaryColor: corDaTela(['--cz-tinta', '--ink'], '#0E1F14'),
                  textSecondaryColor: corDaTela(['--cz-tinta-suave', '--muted'], '#6F7D72'),
                  inputBackgroundColor: corDaTela(['--cz-branco', '--card'], '#FFFFFF'),
                  formBackgroundColor: corDaTela(['--cz-branco', '--card'], '#FFFFFF'),
                  outlinePrimaryColor: corDaTela(['--cz-tinta', '--line-forte'], '#B9CBAB'),
                  outlineSecondaryColor: corDaTela(['--cz-creme-borda', '--line'], '#DCE7D3'),
                  errorColor: corDaTela(['--cz-vermelho', '--erro'], '#C0392B'),
                  successColor: corDaTela(['--cz-verde', '--lime-escuro'], '#5E9A0C'),
                  borderRadiusSmall: '10px', borderRadiusMedium: '12px', borderRadiusLarge: '18px',
                  formPadding: '16px',
                },
              },
            },
          },
          callbacks: {
            onReady: function () { if (estado.montandoCartao === chave) $('cartaoCarregando').hidden = true; },
            onError: function (erro) {
              if (window.console && erro) console.warn('Cartao:', erro.message || erro.type || erro);
              /* erro de digitacao o proprio formulario mostra no campo; so o que impede de abrir vira aviso */
              if (erro && erro.type === 'critical' && estado.montandoCartao === chave) { desmontarCartao(); cartaoFalhou('Não deu para abrir o pagamento com cartão agora. Tente de novo ou pague de outro jeito.'); }
            },
            onSubmit: function (dados) {
              $('cartaoRecusado').hidden = true;
              estado.pagandoCartao = true;
              return cobrarCartao(pedido, dados).then(function (resp) {
                estado.pagandoCartao = false;
                if (resp.status === 'aprovado') { pagamentoAprovado(pedido); return; }
                if (resp.status === 'analise') { pintarAnalise(resp.motivo); return; }
                cartaoRecusado(resp.motivo, resp.status === 'conferindo');
                /* o banco nao respondeu: o dinheiro pode ter saido, entao sem o X ate a resposta chegar pela escuta */
                if (resp.status === 'conferindo') $('btnCancelarCartao').hidden = true;
                /* o codigo do cartao so vale uma vez: o formulario abre de novo, limpo, para outra tentativa */
                if (estado.montandoCartao === chave) montarFormCartao(estado.pedido || pedido);
              }).catch(function (e) {
                estado.pagandoCartao = false;
                if (window.console && e) console.warn('Cartao nao cobrou:', e.message || e);
                /* o cardapio mudou depois do pedido: o texto do servidor e o "Montar de novo" (tentar de novo nao passa) */
                if (e && e.montarDeNovo) { desmontarCartao(); cartaoFalhou(e.message, true); return; }
                var semInternet = e instanceof TypeError || /failed to fetch|load failed|network/i.test(String((e && e.message) || ''));
                /* sem resposta nao quer dizer recusado: pode ter passado. A escuta do pedido mostra a senha se passou */
                cartaoRecusado(semInternet ? 'A internet caiu no meio do pagamento. Se o valor não aparecer no seu cartão em 1 minuto, tente de novo.' : 'Não deu para concluir o pagamento agora. Tente de novo.');
                if (estado.montandoCartao === chave) montarFormCartao(estado.pedido || pedido);
              });
            },
          },
        }).then(function (b) {
          if (estado.montandoCartao !== chave) { try { b.unmount(); } catch (_) { /* segue */ } return; }
          estado.brickCartao = b;
        });
      }).catch(function (e) {
        if (estado.montandoCartao !== chave) return;
        if (window.console && e) console.warn('Cartao nao abriu:', e.message || e);
        cartaoFalhou('Não deu para abrir o pagamento com cartão. Confira a sua internet e tente de novo.');
      });
    }

    /* demonstracao: um cartao de teste que "passa" em 1,5 s (nada e cobrado) */
    function montarCartaoDeTeste(pedido) {
      var alvo = $('cartaoForm');
      UI.limpar(alvo);
      $('cartaoCarregando').hidden = true;
      var botao = el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'Pagar ' + dinheiro(pedido.total) });
      alvo.appendChild(el('div', { class: 'cartao-teste' }, [
        el('div', { class: 'cartao-teste-numero', text: '5031 4332 1540 6351' }),
        el('div', { class: 'cartao-teste-linha' }, [el('span', { text: 'Cartão de teste' }), el('span', { text: '11/30' })]),
      ]));
      alvo.appendChild(el('p', { class: 'nota', text: 'Demonstração: nenhum valor é cobrado.' }));
      alvo.appendChild(botao);
      botao.addEventListener('click', function () {
        botao.disabled = true;
        botao.textContent = 'Pagando…';
        setTimeout(function () {
          store.atualizarPedido(estado.loja.slug, pedido.id, { status: R.STATUS.PAGO, pagamentoStatus: 'pago', pagoEm: new Date().toISOString(), confirmadoPor: 'simulacao', mp: { id: 'SIM-C-' + pedido.id, criadoEm: new Date().toISOString(), cartao: true, simulado: true } })
            .then(function () { pagamentoAprovado(pedido); })
            .catch(function () { botao.disabled = false; botao.textContent = 'Pagar ' + dinheiro(pedido.total); cartaoRecusado('Não deu para concluir agora. Tente de novo.'); });
        }, 1500);
      });
    }

    $('btnTentarCartao').addEventListener('click', function () { if (estado.pedido) mostrarCartao(estado.pedido); });

    /* desistir do cartao (o X) e trocar de forma: o pedido sai da fila e os itens voltam */
    function sairDoCartao(trocar) {
      if (!estado.pedido) return;
      if (estado.pagandoCartao) { UI.avisar('Espere um instante: o pagamento está sendo conferido.'); return; }
      /* cobranca sem resposta do banco: o dinheiro pode estar saindo, ninguem desiste agora */
      if (emAnalise(estado.pedido, agoraCerto())) { UI.avisar(TEXTO_ANALISE_CURTO); return; }
      var pergunta = trocar
        ? UI.perguntar('Pagar de outro jeito? Este pedido é cancelado e seus itens voltam para você escolher Pix ou pagar na entrega.', { sim: 'Trocar', nao: 'Continuar no cartão' })
        : UI.perguntar('Desistir deste pedido? Ele sai da fila da loja e seus itens voltam para o carrinho.', { sim: 'Desistir', nao: 'Continuar pagando', perigo: true });
      pergunta.then(function (sim) {
        if (!sim || !estado.pedido) return;
        /* o formulario sai antes: ninguem paga enquanto o pedido esta sendo cancelado */
        desmontarCartao();
        cancelarPedidoDoPix(trocar ? 'Escolha outra forma de pagamento.' : 'Pedido cancelado.', true).then(function (cancelou) {
          /* trocar: volta direto para o fechamento, ja sem o cartao marcado */
          if (!cancelou || !trocar || !estado.carrinho.length || !$('tela-carrinho').classList.contains('ativa')) return;
          $('btnIrDados').click();
          var outra = ['pgtoPix', 'pgtoCartao', 'pgtoDinheiro'].filter(function (id) { return !$(id).parentNode.hidden; })[0];
          if (outra) { $(outra).checked = true; marcarFormaEscolhida(); atualizarBotaoPagar(); $('blocoTroco').hidden = formaEscolhida() !== 'dinheiro_entrega'; if (!$('blocoTroco').hidden) atualizarTroco(); }
        }).catch(function () { UI.avisar('Não deu para cancelar agora. Tente de novo.'); });
      });
    }
    $('btnCancelarCartao').addEventListener('click', function () { sairDoCartao(false); });
    $('btnOutraForma').addEventListener('click', function () { sairDoCartao(true); });

    /* o cardapio mudou depois do pedido (item desligado, preco novo): este pedido sai da fila e os itens voltam para o
       carrinho, que mostra a conta de agora e o item que saiu */
    function montarDeNovo() {
      if (!estado.pedido) return;
      desmontarCartao();
      cancelarPedidoDoPix('Pedido cancelado.', true).catch(function () { UI.avisar('Não deu para cancelar agora. Tente de novo.'); });
    }
    $('btnRemontarCartao').addEventListener('click', montarDeNovo);
    $('btnRemontarPix').addEventListener('click', montarDeNovo);

    /* Antes de cancelar: o dinheiro ja passou? Pergunta ao mensageiro (ele pergunta ao Mercado Pago e grava o "pago" se
       caiu; o aviso do Mercado Pago pode chegar depois do toque). No cartao, le tambem o pedido de agora: a cobranca em
       analise fica marcada nele. Sem mensageiro (demonstracao) ou sem resposta, segue como antes */
    function situacaoParaCancelar(pedido) {
      return consultarStatusPix(pedido.id).then(function (resp) {
        if (pagoNoStatus(resp)) return { pago: true };
        if (pedido.formaPagamento !== 'cartao_online') return { pode: true };
        return store.obterPedido(estado.loja.slug, pedido.id).catch(function () { return null; }).then(function (p) {
          return situacaoDoPedido(p || (estado.pedido && estado.pedido.id === pedido.id ? estado.pedido : pedido));
        });
      });
    }
    function situacaoDoPedido(p) {
      if (!p) return {};
      if (p.status === R.STATUS.CANCELADO) return { jaCancelado: true };
      if (p.status !== R.STATUS.AGUARDANDO) return { pago: true, pedido: p };
      if (emAnalise(p, agoraCerto())) return { analise: true, pedido: p };
      return { pode: true };
    }

    /* O pedido nao saiu da fila: mostra o que houve com ele (a senha, o cartao em analise ou o aviso), nunca "cancelado" */
    function naoCancelou(idPedido, sit) {
      if (!vivo || !estado.pedido || estado.pedido.id !== idPedido) return;
      if (sit.pago) { UI.avisar('O pagamento passou! Seu pedido já está com a loja.'); mostrarPago(idPedido, sit.pedido); return; }
      if (sit.analise) { UI.avisar(TEXTO_ANALISE_CURTO); estado.pedido = sit.pedido; mostrarCartao(sit.pedido); return; }
      UI.avisar('Não deu para cancelar agora. Tente de novo.');
      /* cartao: o formulario tinha saido para cancelar; volta */
      if (estado.pedido.formaPagamento === 'cartao_online' && $('tela-cartao').classList.contains('ativa') && !estado.montandoCartao) mostrarCartao(estado.pedido);
    }

    /* Tira o pedido da fila da loja e devolve os itens pro carrinho. Usado no "desistir" e quando o Pix vence.
       manterCarrinho: so o X "desistir" (quem esta no tablet troca a forma de pagamento sem montar tudo de novo).
       conferido: quem chamou acabou de perguntar ao mensageiro (nao pergunta de novo). Devolve true se cancelou */
    function cancelarPedidoDoPix(aviso, manterCarrinho, motivo, conferido) {
      if (!estado.pedido) return Promise.resolve(false);
      var cancelado = estado.pedido;
      var idCancelado = cancelado.id;
      var gravar = function (quem) { return store.atualizarPedido(estado.loja.slug, idCancelado, { status: R.STATUS.CANCELADO, canceladoPor: quem }); };
      var depois = function () {
        pararAcompanhar();
        pararVigia();
        atualizarMeuPedido({ id: idCancelado, status: R.STATUS.CANCELADO });
        estado.pedido = null;
        /* os itens DESTE pedido (o guardado de outro pedido nao serve); a pagina recarregou desde o pedido: vem do guardado da aba */
        var itens = estado.ultimoCarrinho && estado.ultimoCarrinho.id === idCancelado ? estado.ultimoCarrinho.itens : null;
        var chaveCarrinho = 'ligeiro:carrinho-do-pix:' + idCancelado;
        if (!(itens && itens.length)) {
          try { var guardado = JSON.parse(sessionStorage.getItem(chaveCarrinho) || 'null'); if (Array.isArray(guardado) && guardado.length) itens = guardado; } catch (_) { /* segue */ }
        }
        try { sessionStorage.removeItem(chaveCarrinho); } catch (_) { /* segue */ }
        estado.ultimoCarrinho = null;
        if (balcao && !(manterCarrinho && itens && itens.length)) {
          /* balcao, cancelado sozinho: o proximo cliente nao herda o carrinho nem o nome de quem desistiu */
          novoPedido();
          UI.avisar(aviso);
          return true;
        }
        if (balcao) { clearTimeout(estado.relogioBalcao); estado.relogioPixDe = null; }
        else window.LigeiroApp.substituir(estado.loja.cidadeSlug + '/' + estado.loja.slug);
        if (itens && itens.length) {
          estado.carrinho = itens;
          /* o pedido volta como era: entrega continua entrega (depois de recarregar a pagina, a tela comecava em
             retirada e o endereco sumia) e o cupom volta junto (se deixou de valer, o carrinho tira e avisa) */
          if (!estado.pularEscolhaTipo && cancelado.tipoEntrega) {
            estado.tipoEntrega = cancelado.tipoEntrega === 'entrega' ? 'entrega' : 'retirada';
            $('blocoEndereco').hidden = estado.tipoEntrega !== 'entrega';
          }
          if (cancelado.cupom && cancelado.desconto > 0 && !(estado.cupom && estado.cupom.codigo)) estado.cupom = { codigo: cancelado.cupom, percentual: cancelado.cupomPercentual || 0, desconto: cancelado.desconto };
          montarCarrinho();
          irPara('tela-carrinho');
          atualizarBarraCarrinho();
          UI.avisar(aviso + ' Seus itens continuam aqui.');
        } else {
          irPara('tela-inicio');
          UI.avisar(aviso);
        }
        return true;
      };
      var antes = conferido ? Promise.resolve({ pode: true }) : situacaoParaCancelar(cancelado);
      return antes.then(function (sit) {
        if (sit.jaCancelado) return depois();
        if (!sit.pode) { naoCancelou(idCancelado, sit); return false; }
        /* Pix que venceu nao e desistencia: grava 'pix-vencido' e o painel nao apita "o cliente cancelou". Se o banco ainda
           estiver com as regras antigas (sem esse valor), grava como antes */
        var passo = motivo === 'pix-vencido' ? gravar('pix-vencido').catch(function () { return gravar('cliente'); }) : gravar('cliente');
        return passo.then(depois, function () {
          /* o banco recusou: o pagamento passou bem nessa hora, o cartao entrou em analise ou a loja ja cancelou */
          return store.obterPedido(estado.loja.slug, idCancelado).catch(function () { return null; }).then(function (p) {
            var s = situacaoDoPedido(p);
            if (s.jaCancelado) return depois();
            naoCancelou(idCancelado, s);
            return false;
          });
        });
      });
    }
    $('btnCancelarPix').addEventListener('click', function () {
      UI.perguntar('Desistir deste pedido? Ele sai da fila da loja e seus itens voltam para o carrinho.', { sim: 'Desistir', nao: 'Continuar pagando', perigo: true }).then(function (sim) {
        if (!sim || !estado.pedido) return;
        /* o Pix pago no app do banco (aviso do Mercado Pago ainda a caminho) vira a senha, nao "cancelado" */
        cancelarPedidoDoPix('Pedido cancelado.', true).catch(function () { UI.avisar('Não deu para cancelar agora. Tente de novo.'); });
      });
    });

    /* ---------- senha e acompanhamento ---------- */

    /* o que o cliente separa para pagar (ou o cupom): tambem quando o pedido muda com a tela aberta */
    function desenharACobrar(pedido) {
      var aviso = $('avisoACobrar');
      var ico = '', texto = '';
      if (pedido.pagamentoStatus === 'na_entrega' && pedido.status !== R.STATUS.CANCELADO && pedido.status !== R.STATUS.FINALIZADO) {
        var noBalcao = pedido.tipoEntrega !== 'entrega';
        if (pedido.formaPagamento === 'dinheiro_entrega') {
          ico = 'dinheiro';
          texto = pedido.trocoPara > 0
            ? 'Separe ' + dinheiro(pedido.trocoPara) + '. ' + (noBalcao ? 'O caixa' : 'O entregador') + ' devolve ' + dinheiro(pedido.trocoPara - pedido.total) + ' de troco.'
            : 'Separe ' + dinheiro(pedido.total) + ' em dinheiro' + (noBalcao ? ' para pagar no balcão.' : ' para pagar na entrega.');
        } else {
          ico = 'cartao';
          texto = dinheiro(pedido.total) + ' na maquininha' + (noBalcao ? ', no balcão.' : ', quando o entregador chegar.');
        }
      } else if (pedido.desconto > 0) {
        ico = 'cupom';
        texto = pedido.total === 0 ? 'Cupom ' + pedido.cupom + ': este pedido é cortesia.' : 'Cupom ' + pedido.cupom + ': você economizou ' + dinheiro(pedido.desconto);
      }
      UI.limpar(aviso);
      aviso.hidden = !texto;
      if (texto) { aviso.appendChild(UI.iconeLinha(ico)); aviso.appendChild(el('span', { text: texto })); }
    }

    function rotuloConfirmado(icone, texto) {
      var c = $('confirmado');
      UI.limpar(c);
      c.appendChild(UI.iconeLinha(icone));
      c.appendChild(document.createTextNode(texto));
    }

    function mostrarSenha(pedido) {
      estado.pedido = pedido;
      if (pedido.status !== R.STATUS.AGUARDANDO && pedido.status !== R.STATUS.CANCELADO) esquecerCarrinho(pedido.id);
      $('senhaNumero').textContent = pedido.senha;
      /* o Pix confirma sozinho (Mercado Pago): ninguem da loja precisa conferir. Dinheiro devolvido nunca vira "confirmado" */
      var rotulo = rotuloDaSenha(pedido);
      rotuloConfirmado(rotulo.icone, rotulo.texto);
      $('senhaInstrucao').textContent = R.textoDoEstagio(pedido, estado.loja);

      desenharACobrar(pedido);

      montarLinhaDoTempo(pedido);

      /* pedido aberto por link de outro aparelho: sem o WhatsApp com o nome de quem pediu e sem voltar pro Pix */
      var deFora = estado.pedidoDeFora === pedido.id;
      var whats = $('btnWhatsCliente');
      if (estado.loja.whatsapp && !balcao && !deFora) { whats.href = R.linkWhatsapp(estado.loja.whatsapp, R.mensagemDoCliente(estado.loja, pedido)); whats.hidden = false; }
      else whats.hidden = true;

      var voltarPix = $('btnVoltarPix');
      voltarPix.hidden = !(pedido.status === R.STATUS.AGUARDANDO && !balcao && !deFora);
      voltarPix.textContent = pedido.formaPagamento === 'cartao_online' ? 'Voltar para o pagamento' : 'Ver o código Pix de novo';
      desenharAvisoCelPedido(pedido, balcao || deFora);
      desenharAvaliarGoogle(pedido, balcao || deFora);
      desenharConviteJogo(pedido, balcao);

      irPara('tela-senha');
      if (pedido.status !== R.STATUS.CANCELADO) { UI.vibrar(); UI.soar('sucesso'); }
      acompanhar(pedido);

      if (balcao) {
        estado.relogioPixDe = null;
        clearTimeout(estado.relogioBalcao);
        estado.relogioBalcao = setTimeout(function () { novoPedido(); }, pedido.status === R.STATUS.AGUARDANDO ? 90000 : 30000);
      }
    }

    $('btnVoltarPix').addEventListener('click', function () { if (estado.pedido) mostrarPagar(estado.pedido); });

    /* Depois da entrega: convite para avaliar a loja no Google (e o que faz a loja subir no Google Maps).
       Uma vez por loja: quem ja tocou em Avaliar nao e convidado de novo; "Agora nao" some por 30 dias. */
    var ESTRELAS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5-4.9-4.5 6.6-.8z"/></svg>';
    function desenharAvaliarGoogle(pedido, esconder) {
      var caixa = $('avaliarGoogle');
      UI.limpar(caixa);
      var link = R.linkGoogleAvaliar(estado.loja && estado.loja.googleUrl);
      var chave = 'ligeiro:avaliar:' + estado.loja.slug;
      var marca = UI.lerLocal(chave);
      var jaAvaliou = marca === 'avaliou';
      var adiado = typeof marca === 'number' && marca > Date.now();
      if (esconder || !link || pedido.status !== R.STATUS.FINALIZADO || jaAvaliou || adiado) { caixa.hidden = true; return; }
      caixa.hidden = false;
      caixa.appendChild(el('div', { class: 'avaliar-estrelas', 'aria-hidden': 'true', html: ESTRELAS + ESTRELAS + ESTRELAS + ESTRELAS + ESTRELAS }));
      caixa.appendChild(el('b', { class: 'avaliar-titulo', text: 'Gostou do pedido?' }));
      caixa.appendChild(el('p', { class: 'avaliar-texto', text: 'Uma avaliação no Google ajuda muito a ' + estado.loja.nome + ' e leva só um minuto.' }));
      caixa.appendChild(el('a', { class: 'btn btn-principal btn-largo', href: link, target: '_blank', rel: 'noopener noreferrer', onclick: function () {
        UI.guardarLocal(chave, 'avaliou');
        setTimeout(function () { UI.limpar(caixa); caixa.appendChild(el('b', { class: 'avaliar-titulo', text: 'Obrigado!' })); caixa.appendChild(el('p', { class: 'avaliar-texto', text: 'A ' + estado.loja.nome + ' agradece a sua avaliação.' })); }, 400);
      } }, 'Avaliar no Google'));
      caixa.appendChild(el('button', { class: 'avaliar-depois', type: 'button', text: 'Agora não', onclick: function () {
        UI.guardarLocal(chave, Date.now() + 30 * 864e5);
        caixa.hidden = true;
      } }));
    }

    /* cartao da tela da senha: "vamos te avisar" (ja ligado) ou o botao para ligar agora (1 gravacao no pedido) */
    /* Corrida e Pulo do Ligeiro: os joguinhos enquanto o pedido fica pronto. So depois de pago (antes, o certo e pagar) e
       ate sair ou ficar pronto. Zero banco: rodam no aparelho, e o codigo de cada um so baixa quando a pessoa toca em Jogar */
    /* arte do icone da Corrida: ceu, sol, morro, a rua em perspectiva com as faixas e a motinho do Ligeiro de costas */
    var ARTE_CORRIDA = '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<defs><linearGradient id="arteCorridaCeu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FB6EE"/><stop offset="1" stop-color="#D4F0FF"/></linearGradient></defs>' +
      '<rect width="48" height="48" fill="url(#arteCorridaCeu)"/>' +
      '<circle cx="37.5" cy="9.5" r="7" fill="#FFF3B8" opacity=".6"/><circle cx="37.5" cy="9.5" r="4.6" fill="#FFD84A"/>' +
      '<path d="M0 21c7-6 13-6 19-2s12 2 17-3 9-2 12 1v7H0z" fill="#A9D98C"/>' +
      '<path d="M0 23c9-4 16-3 24 0s16 2 24-1v26H0z" fill="#7CC35A"/>' +
      '<path d="M20.6 23h6.8L47 48H1z" fill="#E3DCCB"/>' +
      '<path d="M21.6 23h4.8L43 48H5z" fill="#4B5058"/>' +
      '<path d="M21.6 23 5 48H2.6L20.9 23zM26.4 23 43 48h2.4L27.1 23z" fill="#D64541"/>' +
      '<path d="M23.2 23.5 19.5 48M24.8 23.5 28.5 48" stroke="#fff" stroke-width=".9" stroke-dasharray="2.2 2.4" opacity=".9"/>' +
      '<circle cx="28" cy="27" r="1" fill="#F7C325" stroke="#D9A109" stroke-width=".4"/><circle cx="29.8" cy="30.6" r="1.35" fill="#F7C325" stroke="#D9A109" stroke-width=".45"/><circle cx="32.2" cy="35.6" r="1.75" fill="#F7C325" stroke="#D9A109" stroke-width=".5"/>' +
      '<path d="M7 29.5 3.5 36M41 29.5l3.5 6.5M9.5 37 6.5 43M38.5 37l3 6" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>' +
      '<g stroke="#A99FB0" stroke-width=".45"><circle cx="20.5" cy="31.3" r="2.3" fill="#DDD6E2"/><circle cx="27.5" cy="31.3" r="2.3" fill="#DDD6E2"/>' +
      '<circle cx="24" cy="32.6" r="2.9" fill="#F1EDF3"/></g>' +
      '<g fill="#fff" stroke="#C9CFCC" stroke-width=".4"><rect x="21.3" y="28" width="5.4" height="2.2" rx=".8"/><circle cx="22.2" cy="27.5" r="1.5"/><circle cx="25.8" cy="27.5" r="1.5"/><circle cx="24" cy="26.8" r="1.8"/></g>' +
      '<path d="M18.7 34.6h10.6l-.9-1.5h-8.8z" fill="#1B6B4A"/>' +
      '<rect x="18.2" y="34.4" width="11.6" height="8.2" rx="1.7" fill="#0F3D2E"/>' +
      '<circle cx="24" cy="37.8" r="2.4" fill="#fff"/><circle cx="24" cy="37.8" r="1.1" fill="#84CC16"/>' +
      '<rect x="18.4" y="40.5" width="11.2" height="1.1" fill="#84CC16"/>' +
      '<rect x="20.6" y="42" width="6.8" height="3.8" rx="1.6" fill="#84CC16"/>' +
      '<rect x="22.4" y="42.7" width="3.2" height="1.2" rx=".5" fill="#FF3B30"/>' +
      '<rect x="22.5" y="44.9" width="3" height="3.1" rx="1.2" fill="#1D1F22"/>' +
      '</svg>';
    /* arte do icone do Pulo: ceu, nuvens, as tabuas (verde, azul e a caixa de papelao), a moeda e o ratinho no ar */
    var ARTE_PULO = '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<defs><linearGradient id="artePuloCeu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FB6EE"/><stop offset="1" stop-color="#D4F0FF"/></linearGradient></defs>' +
      '<rect width="48" height="48" fill="url(#artePuloCeu)"/>' +
      '<g fill="#fff" opacity=".9"><rect x="4" y="9" width="13" height="4" rx="2"/><circle cx="8.5" cy="9.2" r="2.6"/><circle cx="12.4" cy="8.4" r="3.2"/><rect x="33" y="26" width="11" height="3.6" rx="1.8"/><circle cx="36.8" cy="26.2" r="2.3"/><circle cx="40" cy="25.6" r="2.7"/></g>' +
      '<circle cx="39" cy="11" r="3" fill="#F7C325" stroke="#D9A109" stroke-width=".8"/><path d="M38.2 9.6v2.8h1.8" stroke="#0F3D2E" stroke-width=".8" fill="none"/>' +
      '<rect x="3" y="40" width="17" height="4.4" rx="2.2" fill="#84CC16"/><rect x="3" y="42.6" width="17" height="1.8" rx=".9" fill="#5E9A0C"/>' +
      '<rect x="29" y="35" width="15" height="4" rx="2" fill="#3BA3E8"/><rect x="29" y="37.3" width="15" height="1.7" rx=".85" fill="#1E78B8"/>' +
      '<rect x="6" y="24" width="12" height="3.6" rx=".8" fill="#C8955A"/><rect x="11.2" y="24" width="1.6" height="3.6" fill="#E8D3A8"/>' +
      '<path d="M13 39.4C14.5 33 17.5 31.5 20.5 31" stroke="#fff" stroke-width="1" stroke-dasharray="1.4 1.6" fill="none" opacity=".95"/>' +
      '<g transform="translate(24 12.5)">' +
      '<circle cx="-4.6" cy="4.2" r="3.1" fill="#E6E1E8"/><circle cx="4.6" cy="4.2" r="3.1" fill="#E6E1E8"/><circle cx="-4.6" cy="4.2" r="1.7" fill="#F4A7B9"/><circle cx="4.6" cy="4.2" r="1.7" fill="#F4A7B9"/>' +
      '<path d="M-3.4 14.4-6 10.2M3.4 14.4 6 10.2" stroke="#E6E1E8" stroke-width="1.7" stroke-linecap="round"/>' +
      '<rect x="-3.5" y="12" width="7" height="7" rx="2.6" fill="#84CC16"/><rect x="-3.5" y="16.8" width="7" height="2.2" rx="1" fill="#5E9A0C"/>' +
      '<ellipse cx="-1.8" cy="19.6" rx="1.7" ry="1" fill="#F4A7B9"/><ellipse cx="1.8" cy="19.6" rx="1.7" ry="1" fill="#F4A7B9"/>' +
      '<circle cx="0" cy="7" r="4.9" fill="#ECE8EE" stroke="#C9C1CE" stroke-width=".5"/>' +
      '<circle cx="-1.7" cy="6.8" r=".8" fill="#1D1F22"/><circle cx="1.7" cy="6.8" r=".8" fill="#1D1F22"/><circle cx="0" cy="8.7" r=".7" fill="#F07A9A"/>' +
      '<circle cx="-1.8" cy="-.4" r="1.8" fill="#fff"/><circle cx="0" cy="-1.2" r="2.1" fill="#fff"/><circle cx="1.8" cy="-.4" r="1.8" fill="#fff"/><rect x="-2.8" y="-.2" width="5.6" height="2.6" rx=".7" fill="#fff"/><rect x="-2.8" y="1.5" width="5.6" height=".9" fill="#2E9D4F"/>' +
      '</g>' +
      '</svg>';
    /* os dois joguinhos da espera: a Corrida e, embaixo dela, o Pulo. Cada um no seu arquivo, que so baixa no "Jogar" */
    var JOGOS = [
      { caixa: 'jogoConvite', global: 'LigeiroJogo', arquivo: 'js/jogo.js', nome: 'Corrida do Ligeiro', chamada: 'Jogue enquanto espera', recorde: 'ligeiro:jogo:recorde', arte: ARTE_CORRIDA },
      { caixa: 'puloConvite', global: 'LigeiroPulo', arquivo: 'js/pulo.js', nome: 'Pulo do Ligeiro', chamada: 'Pule até o céu', recorde: 'ligeiro:pulo:recorde', arte: ARTE_PULO },
    ];
    function cadaJogoAberto(fn) { JOGOS.forEach(function (g) { var M = window[g.global]; if (M && M.aberto()) fn(M); }); }
    function desenharConviteJogo(pedido, esconder) { JOGOS.forEach(function (g) { desenharConvite(g, pedido, esconder); }); }
    function desenharConvite(g, pedido, esconder) {
      var caixa = $(g.caixa);
      if (!caixa) return;
      UI.limpar(caixa);
      var andando = pedido.status === R.STATUS.PAGO || pedido.status === R.STATUS.PRODUCAO || (pedido.status === R.STATUS.PRONTO && pedido.tipoEntrega === 'entrega');
      if (esconder || !andando || estado.loja.jogoDesligado === true) { caixa.hidden = true; return; }
      caixa.hidden = false;
      var recorde = Number(UI.lerLocal(g.recorde)) || 0;
      caixa.appendChild(el('span', { class: 'jogo-convite-ico', 'aria-hidden': 'true', html: g.arte }));
      /* textos curtos: cada um numa linha so, ate no celular estreito (o do lado, "Quer saber quando sair?", tambem) */
      caixa.appendChild(el('span', { class: 'aviso-cel-pedido-texto' }, [
        el('b', { text: g.nome }),
        /* o recorde numa etiqueta com o trofeu (e o que chama para jogar de novo) */
        recorde > 0
          ? el('span', { class: 'jogo-recorde-selo' }, [UI.iconeLinha('trofeu'), 'Recorde ' + recorde.toLocaleString('pt-BR')])
          : el('span', { text: g.chamada }),
      ]));
      var btn = el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', onclick: function () {
        btn.disabled = true;
        carregarJogo(g).then(function (J) {
          btn.disabled = false;
          if (!vivo || !estado.pedido) return;
          /* um jogo por vez */
          var outro = false;
          cadaJogoAberto(function () { outro = true; });
          if (outro) return;
          J.abrir({
            cidade: estado.loja.cidade,
            logo: D.logoSrc ? D.logoSrc(estado.loja) : null,
            /* os lanches da loja viram os poderes do jogo (do cardapio que ja esta no celular: nada vem do banco) */
            nomeLoja: estado.loja.nome,
            produtos: produtosDoJogo(),
            podePedir: function () { return !!(vivo && estado.loja && R.lojaAberta(estado.loja)); },
            aoVerProduto: function (id) {
              var p = R.produtosAtivos(estado.loja).filter(function (x) { return x.id === id; })[0];
              novoPedido();
              if (!p || !R.lojaAberta(estado.loja)) return;
              comecarPedido(); montarGrade(p.categoria); abrirPersonalizacao(p);
            },
            rotulo: 'Senha ' + estado.pedido.senha + '\u00a0· ' + R.rotuloStatusCliente(estado.pedido),
            aoFechar: function () { if (vivo && estado.pedido) desenharConviteJogo(estado.pedido, false); },
          });
        }, function () { btn.disabled = false; UI.avisar('Não deu para abrir o jogo agora. Confira a internet.'); });
      } }, 'Jogar');
      caixa.appendChild(btn);
    }
    /* ate 3 lanches (sem bebida), os com foto primeiro: a foto so se ja estiver no celular */
    function produtosDoJogo() {
      var lista = R.produtosAtivos(estado.loja).filter(function (p) { return p.preco > 0 && !/bebida/i.test(p.categoria || ''); });
      var comFoto = lista.filter(function (p) { return D.fotoSrc(p, estado.fotos); }), semFoto = lista.filter(function (p) { return !D.fotoSrc(p, estado.fotos); });
      return comFoto.concat(semFoto).slice(0, 3).map(function (p) { return { id: p.id, nome: p.nome, preco: p.preco, emoji: p.emoji || '', foto: D.fotoSrc(p, estado.fotos) || '' }; });
    }
    function carregarJogo(g) {
      if (window[g.global]) return Promise.resolve(window[g.global]);
      estado.jogosBaixando = estado.jogosBaixando || {};
      if (estado.jogosBaixando[g.global]) return estado.jogosBaixando[g.global];
      var tag = (((document.querySelector('script[src*="js/cliente.js"]') || {}).src || '').match(/\?v=([0-9a-z]+)/) || [])[1] || '1';
      estado.jogosBaixando[g.global] = new Promise(function (ok, falhou) {
        var s = document.createElement('script');
        s.src = g.arquivo + '?v=' + tag;
        s.onload = function () { if (window[g.global]) ok(window[g.global]); else falhou(new Error('jogo')); };
        s.onerror = function () { estado.jogosBaixando[g.global] = null; if (s.parentNode) s.parentNode.removeChild(s); falhou(new Error('jogo')); };
        document.body.appendChild(s);
      });
      return estado.jogosBaixando[g.global];
    }

    function desenharAvisoCelPedido(pedido, esconder) {
      var A = window.LigeiroAvisos;
      var caixa = $('avisoCelPedido');
      UI.limpar(caixa);
      var acabou = pedido.status === R.STATUS.FINALIZADO || pedido.status === R.STATUS.CANCELADO;
      var ligado = !!(pedido.aviso && (pedido.aviso.e || pedido.aviso.demo));
      if (A && !ligado && !esconder && !acabou && A.situacao() === 'sem' && !estado.avisosConferidos) {
        estado.avisosConferidos = true;
        A.preparar().then(function (sit) { if (sit !== 'sem' && vivo && estado.pedido && estado.pedido.id === pedido.id) desenharAvisoCelPedido(pedido, esconder); });
      }
      if (!A || esconder || acabou || (!ligado && !A.podeCliente())) { caixa.hidden = true; return; }
      caixa.hidden = false;
      caixa.classList.toggle('ligado', ligado);
      caixa.appendChild(el('span', { class: 'aviso-cel-ico', 'aria-hidden': 'true', html: A.icone() }));
      if (ligado) {
        caixa.appendChild(el('span', { class: 'aviso-cel-pedido-texto', text: 'Vamos te avisar neste celular quando o pedido andar.' }));
        return;
      }
      caixa.appendChild(el('span', { class: 'aviso-cel-pedido-texto' }, [el('b', { text: 'Quer saber quando sair?' }), el('span', { text: 'Avisamos no celular, mesmo com a tela apagada.' })]));
      var btn = el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Avisar', onclick: function () {
        btn.disabled = true;
        A.ligarNoPedido(estado.loja.cidadeSlug, estado.loja.slug, pedido.id).then(function (aviso) {
          UI.soar('toque');
          pedido.aviso = aviso;
          if (estado.pedido && estado.pedido.id === pedido.id) estado.pedido.aviso = aviso;
          desenharAvisoCelPedido(pedido, false);
        }, function (e) {
          btn.disabled = false;
          UI.avisar((e && e.message) || 'Não deu para ligar os avisos neste celular.');
        });
      } });
      caixa.appendChild(btn);
    }

    function montarLinhaDoTempo(pedido) {
      var entrega = pedido.tipoEntrega === 'entrega';
      var etapas = [
        { chave: R.STATUS.PAGO, icone: 'recibo', texto: rotuloDoPagamento(pedido) },
        { chave: R.STATUS.PRODUCAO, icone: 'fogo', texto: 'Preparando' },
        { chave: R.STATUS.PRONTO, icone: entrega ? 'entrega' : 'retirada', texto: entrega ? 'Saiu para entrega' : 'Pronto para retirar' },
        { chave: R.STATUS.FINALIZADO, icone: 'sorriso', texto: entrega ? 'Entregue' : 'Retirado' },
      ];
      var posicao = etapas.map(function (e) { return e.chave; }).indexOf(pedido.status);
      var c = $('linhaDoTempo');
      UI.limpar(c);
      if (pedido.status === R.STATUS.CANCELADO) return;
      etapas.forEach(function (etapa, i) {
        var feita = posicao > i;
        var atual = posicao === i;
        c.appendChild(el('div', { class: 'etapa' + (feita ? ' feita' : '') + (atual ? ' atual' : '') }, [
          el('span', { class: 'bolha' }, [UI.iconeLinha(feita ? 'check' : etapa.icone)]),
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
        var devolveuAgora = foiDevolvido(novo) && !foiDevolvido(estado.pedido);
        estado.pedido = novo;
        atualizarMeuPedido(novo);
        if (mudou && novo.status !== R.STATUS.AGUARDANDO && novo.status !== R.STATUS.CANCELADO) esquecerCarrinho(novo.id);
        if (codigoNovo && !mudou && $('tela-pagamento').classList.contains('ativa')) { mostrarPagamento(novo); return; }
        /* a loja devolveu o dinheiro de um pedido ja cancelado (o status nao muda): o rotulo muda na hora */
        if (devolveuAgora && !mudou && $('tela-senha').classList.contains('ativa')) { var rotuloD = rotuloDaSenha(novo); rotuloConfirmado(rotuloD.icone, rotuloD.texto); montarLinhaDoTempo(novo); return; }
        /* cartao ainda esperando: a analise do banco comecou ou acabou sem aprovar (o X some ou volta) */
        if (!mudou && novo.status === R.STATUS.AGUARDANDO && $('tela-cartao').classList.contains('ativa')) { travaDoCartao(novo); return; }
        if (!mudou) return;
        /* jogando: a etiqueta do jogo muda; saiu, ficou pronto, chegou ou foi cancelado, o jogo pausa e pergunta */
        cadaJogoAberto(function (J) { J.pedidoMudou(novo, 'Senha ' + novo.senha + '\u00a0· ' + R.rotuloStatusCliente(novo), [R.STATUS.PRONTO, R.STATUS.FINALIZADO, R.STATUS.CANCELADO].indexOf(novo.status) >= 0); });
        if ($('tela-cartao').classList.contains('ativa') && novo.status !== R.STATUS.AGUARDANDO) { desmontarCartao(); if (novo.status === R.STATUS.PAGO) { UI.soar('sucesso'); UI.vibrar([80, 40, 80]); } mostrarSenha(novo); return; }
        if ($('tela-pagamento').classList.contains('ativa') && novo.status !== R.STATUS.AGUARDANDO) { pararVigia(); if (novo.status === R.STATUS.PAGO) { UI.soar('sucesso'); UI.vibrar([80, 40, 80]); } mostrarSenha(novo); return; }
        if ($('tela-senha').classList.contains('ativa')) {
          $('senhaInstrucao').textContent = R.textoDoEstagio(novo, estado.loja);
          montarLinhaDoTempo(novo);
          var deFora = estado.pedidoDeFora === novo.id;
          desenharAvisoCelPedido(novo, balcao || deFora);
          desenharAvaliarGoogle(novo, balcao || deFora);
          desenharConviteJogo(novo, balcao);
          desenharACobrar(novo);
          if (novo.status === R.STATUS.PAGO || novo.status === R.STATUS.CANCELADO) { var rotuloN = rotuloDaSenha(novo); rotuloConfirmado(rotuloN.icone, rotuloN.texto); }
          $('btnVoltarPix').hidden = true;
          UI.avisar(R.rotuloStatusCliente(novo));
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
        /* pedido que nao foi feito neste aparelho (link copiado da barra e mandado pra alguem):
           mostra so a senha e o andamento, sem a tela do Pix e sem o "desistir" */
        var meu = balcao || lerMeusPedidos().some(function (x) { return x.id === p.id; });
        estado.pedidoDeFora = meu ? null : p.id;
        estado.pedido = p;
        if (p.status === R.STATUS.AGUARDANDO && meu) mostrarPagar(p);
        else mostrarSenha(p);
      }).catch(function (e) {
        if (!vivo) return;
        /* passou dos 3 dias do link: o banco nao mostra mais o pedido (nome, telefone, endereco) para quem so tem o link */
        var semAcesso = e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));
        UI.avisar(semAcesso ? PEDIDO_SO_COM_A_LOJA : 'Não deu para abrir o pedido agora. Confira a internet e tente de novo.');
      });
    }
    var PEDIDO_SO_COM_A_LOJA = 'Os detalhes desse pedido agora ficam só com a loja (o link vale por 3 dias). Para saber dele, fale com a loja.';
    function pedidoVelho(p) { var t = new Date(p.criadoEm || 0).getTime(); return !!t && Date.now() - t > 3 * 864e5; }

    /* pedido "andando" de mais de 12 horas atras ja acabou (a aba fechou antes do ultimo status). Esperando o Pix, o
       prazo e o do proprio Pix (30 min, o servidor da como vencido aos 35): passou de 40, o codigo nem paga mais e o
       pedido sai da faixa "Meu pedido" (antes ficava 12 h la, como se ainda fosse sair) */
    function andandoAgora(p) {
      if (p.lojaSlug !== slug) return false;
      if (p.status && R.EM_ANDAMENTO.indexOf(p.status) < 0) return false;
      var t = new Date(p.criadoEm || 0).getTime();
      if (t && p.status === R.STATUS.AGUARDANDO && Date.now() - t > 40 * 60e3) return false;
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
      var btnMeus = $('btnMeusPedidosRodape');
      if (btnMeus) btnMeus.hidden = balcao || !lerMeusPedidos().some(function (p) { return p.lojaSlug === slug; });
      if (andando.length) {
        /* o numero numa etiqueta colada no texto: no celular estreito o "(3)" caia sozinho na linha de baixo */
        $('faixaTexto').textContent = andando.length === 1 ? 'Meu pedido' : 'Meus pedidos';
        $('faixaQtd').textContent = andando.length === 1 ? 'senha ' + andando[0].senha : String(andando.length);
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
      if (meus.length === 0) lista.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone' }, [UI.iconeLinha('recibo')]), el('p', { text: 'Nenhum pedido por aqui' })]));
      meus.forEach(function (p) {
        /* o status guardado so anda enquanto a pessoa acompanha: "andando" de mais de 12 h ja acabou, e a lista nao
           afirma o que nao sabe (tocar abre o pedido e traz o status de verdade) */
        var andando = R.EM_ANDAMENTO.indexOf(p.status) >= 0;
        var sabido = !andando || andandoAgora(p);
        var cancelado = p.status === R.STATUS.CANCELADO;
        var velho = pedidoVelho(p);
        lista.appendChild(el('button', { class: 'escolha-grande', onclick: function () { if (velho) UI.avisar(PEDIDO_SO_COM_A_LOJA); else abrirPedidoSalvo(p.id); } }, [
          el('span', { class: 'icone' }, [UI.iconeLinha(!sabido ? 'recibo' : cancelado ? 'fechar' : andando ? 'relogio' : 'feito')]),
          el('span', {}, [
            el('span', { class: 'rotulo', text: 'Senha ' + p.senha }),
            el('span', { class: 'detalhe', text: UI.dataCurta(p.criadoEm) + ' ' + UI.horaCurta(p.criadoEm) + '\u00a0· ' + dinheiro(p.total) }),
            el('span', { class: 'meu-status' + (!sabido || velho ? '' : cancelado ? ' cancelado' : andando ? ' andando' : ''), text: velho ? 'Detalhes com a loja' : (sabido ? R.rotuloStatusCliente(p) : 'Toque para ver como ficou') }),
          ]),
          el('span', { class: 'seta', text: '→' }),
        ]));
      });
      irPara('tela-meus-pedidos');
    }

    function novoPedido() {
      pararAcompanhar();
      clearTimeout(estado.relogioBalcao);
      clearTimeout(estado.relogioParado);
      estado.relogioPixDe = null;
      estado.carrinho = [];
      estado.pedido = null;
      estado.cupom = { codigo: '', percentual: 0, desconto: 0 };
      estado.chavePedido = null; /* pedido novo, chave nova */
      if (balcao) estado.ultimoCarrinho = null; /* o proximo cliente nao herda os itens de ninguem */
      limparRascunho();
      $('avisoTipo').hidden = true;
      /* o formulario nao pode carregar o nome, o recado e o troco do cliente anterior (balcao) */
      var form = $('formDados');
      if (form) {
        if (balcao) form.reset();
        else { $('campoObs').value = ''; $('trocoNao').checked = true; $('campoTroco').value = ''; }
        $('campoTrocoValor').hidden = true;
        $('blocoTroco').hidden = true;
        $('erroDados').hidden = true;
        $('avisoForma').hidden = true;
        marcarFormaEscolhida();
        atualizarTroco();
      }
      if (!balcao) window.LigeiroApp.substituir(estado.loja.cidadeSlug + '/' + estado.loja.slug);
      irPara('tela-inicio');
      atualizarFaixaAcompanhar();
    }
    $('btnNovoPedido').addEventListener('click', novoPedido);
    $('btnVoltarInicio').addEventListener('click', function () { irPara('tela-inicio'); });
    $('btnMeusPedidosRodape').addEventListener('click', abrirMeusPedidos);
    /* LGPD: a pessoa apaga daqui mesmo o que ficou no celular (nome, telefone, endereco, e-mail do cartao e a lista de pedidos) */
    $('btnApagarAparelho').addEventListener('click', function () {
      UI.perguntar('Apagar deste aparelho o seu nome, telefone, endereço, e-mail do cartão e a lista dos seus pedidos? Os pedidos continuam com a loja. Para apagar lá também, fale com a loja ou com o Ligeiro.',
        { titulo: 'Apagar meus dados', sim: 'Apagar', perigo: true }).then(function (sim) {
        if (!sim) return;
        [CHAVE_CLIENTE, CHAVE_MEUS_PEDIDOS, CHAVE_EMAIL, 'ligeiro:avisos-cliente'].forEach(function (k) { try { localStorage.removeItem(k); } catch (_) { /* ignora */ } });
        limparRascunho();
        UI.avisar('Pronto: seus dados foram apagados deste aparelho.');
        abrirMeusPedidos();
        atualizarFaixaAcompanhar();
      });
    });

    return function () {
      vivo = false;
      cadaJogoAberto(function (J) { J.fechar(); });
      tirarSplash();
      UI.limparTemaOficial(raiz); /* a mesma limpeza das outras telas (tira o tema das janelas tambem) */
      UI.limparTema();
      pararAcompanhar();
      pararVigia(); /* a vigia do Pix nao pode continuar rodando (e cancelando pedido) depois que a pessoa saiu da loja */
      clearTimeout(estado.relogioBalcao);
      clearTimeout(estado.relogioParado);
      if (balcao) {
        document.removeEventListener('pointerdown', mexeuNoTablet, true);
        document.removeEventListener('touchstart', mexeuNoTablet, true);
        document.removeEventListener('keydown', mexeuNoTablet, true);
      }
      clearInterval(estado.relogioAberta);
      if (typeof estado.pararLoja === 'function') estado.pararLoja();
      document.title = 'Ligeiro: pedido ligeiro, sem comissão';
    };
  }

  /* ============================================================
   * O HTML das telas da loja (escrito por nos: o que vem de fora
   * entra sempre por textContent, nunca aqui dentro).
   * ========================================================== */

  function esqueletoDaLoja(balcao) {
    return '' +
    '<button class="faixa-acompanhar" id="faixaAcompanhar" hidden>' + UI.iconeHtml('recibo') + '<span class="faixa-texto" id="faixaTexto"></span><span class="faixa-qtd" id="faixaQtd"></span><span class="seta">' + UI.iconeHtml('avancar') + '</span></button>' +

    '<section class="tela ativa" id="tela-inicio">' +
      '<div class="abertura">' +
        '<div class="capa-loja" id="capaLoja" hidden></div>' +
        '<div class="logo-grande" id="logoLoja"></div>' +
        '<h1 class="promessa" id="nomeLoja"></h1>' +
        '<p class="muted" id="descLoja" style="margin-top:-6px"></p>' +
        '<div class="selos"><div class="selo" id="seloAberto"><span class="bolinha"></span><span id="textoAberto">Carregando…</span></div>' +
        /* estrela de traco, como os outros icones (em desenho, nao em letra: um simbolo de outra fonte mudaria a altura do selo) */
        '<a class="selo selo-google" id="seloGoogle" hidden target="_blank" rel="noopener noreferrer">' +
          UI.iconeHtml('estrela').replace('class="ico-traco"', 'class="ico-traco selo-google-estrela"') +
          'Avaliações no Google</a></div>' +
        '<div class="aviso-topo" id="avisoTopo" hidden></div>' +
        '<button class="btn btn-principal btn-gigante btn-largo" id="btnComecar" style="max-width:440px" disabled>' +
          '<span><span id="btnComecarForte">PEDIR AGORA</span><span class="sub" id="btnComecarFraca"></span></span>' +
        '</button>' +
        '<div class="como-funciona">' +
          '<div class="como-passo"><span class="n">1</span>Escolha<br>do seu jeito</div>' +
          '<div class="como-passo"><span class="n">2</span><span id="comoPagamento"></span></div>' +
          '<div class="como-passo"><span class="n">3</span>Acompanhe<br>pela senha</div>' +
        '</div>' +
        /* o video da loja (Loja do Ligeiro): o dono escolhe no painel, vem junto da loja */
        '<div class="video-loja" id="videoLoja" hidden></div>' +
        '<div id="destaques" hidden style="width:100%;max-width:440px;text-align:left">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 10px"><b>Os mais pedidos</b><button class="cupom-abrir" id="btnCardapio">ver tudo →</button></div>' +
          '<div class="pilha" id="destaquesTrilho"></div>' +
        '</div>' +
      '</div>' +
      '<div class="fim-inicio" id="fimInicio"></div>' +
      '<footer class="rodape">' +
        '<div id="enderecoLoja"></div>' +
        '<div class="rodape-legal" id="legalLoja"></div>' +
        '<div class="contatos" id="contatosLoja"></div>' +
        /* a lista dos pedidos feitos neste aparelho sempre tem porta: a faixa de cima so aparece com pedido andando */
        '<button class="cupom-abrir" id="btnMeusPedidosRodape" hidden style="display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;width:100%">' + UI.iconeHtml('recibo') + 'Meus pedidos</button>' +
        '<button class="cupom-abrir" id="btnOutrasLojas" style="text-align:center;justify-content:center;width:100%"></button>' +
        '<div class="ligeiro"><a href="#/">Feito com Ligeiro&nbsp;· quero isso na minha loja →</a></div>' +
      '</footer>' +
    '</section>' +

    '<section class="tela" id="tela-meus-pedidos">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-inicio" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Acompanhamento</div><div class="topo-titulo">Meus pedidos</div></div></header>' +
      '<div class="conteudo"><div class="pilha" id="listaMeusPedidos"></div>' +
      '<p class="nota">' + UI.iconeHtml('cadeado') + 'Seus pedidos ficam guardados só neste aparelho.</p>' +
      '<button class="btn btn-fantasma btn-largo" id="btnVoltarInicio">Fazer um novo pedido</button>' +
      '<button class="apagar-aparelho" id="btnApagarAparelho" type="button">Apagar meus dados deste aparelho</button></div>' +
    '</section>' +

    '<section class="tela" id="tela-tipo">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-inicio" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 1 de 4</div><div class="topo-titulo">Como você quer receber?</div></div></header>' +
      '<div class="escolhas">' +
        '<div class="aviso aviso-falta" id="avisoTipo" hidden></div>' +
        '<button class="escolha-grande" id="opcaoEntrega" data-tipo="entrega"><span class="icone">' + UI.iconeHtml('entrega') + '</span><span><span class="rotulo">Quero entrega</span><span class="detalhe" id="detalheEntrega"></span></span><span class="seta">→</span></button>' +
        '<button class="escolha-grande" id="opcaoRetirada" data-tipo="retirada"><span class="icone">' + UI.iconeHtml('retirada') + '</span><span><span class="rotulo">Vou buscar</span><span class="detalhe" id="detalheRetirada"></span></span><span class="seta">→</span></button>' +
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
          '<button type="button" class="cupom-abrir" id="btnAbrirCupom">' + UI.iconeHtml('cupom') + 'Tenho um código de desconto</button>' +
          '<div class="cupom-linha campo" id="formCupom" hidden><input type="text" id="campoCupom" placeholder="Digite o código" autocapitalize="characters" autocomplete="off" maxlength="20" aria-label="Código de desconto"><button type="button" class="btn btn-escuro" id="btnAplicarCupom">Aplicar</button></div>' +
          '<p class="cupom-recado" id="msgCupom" hidden></p>' +
          '<div class="cupom-valendo" id="cupomValendo" hidden><span>' + UI.iconeHtml('cupom') + '<b id="cupomNome"></b> <span id="cupomQuanto"></span></span><button type="button" id="btnTirarCupom">Tirar</button></div>' +
        '</div>' +
        '<div class="totais" id="totaisCarrinho"></div>' +
        '<button class="btn btn-fantasma btn-largo" id="btnAddMais">+ Adicionar mais</button>' +
      '</div>' +
      '<div class="barra-carrinho visivel"><div class="linha-barra"><div class="resumo"><div class="qtd" id="carrinhoBarraQtd"></div><div class="valor" id="carrinhoBarraValor"></div></div><button class="btn btn-principal" id="btnIrDados">Continuar →</button></div></div>' +
    '</section>' +

    '<section class="tela" id="tela-dados">' +
      '<header class="topo"><button class="voltar" data-voltar="tela-carrinho" aria-label="Voltar">←</button><div class="topo-texto"><div class="topo-passo">Passo 4 de 4</div><div class="topo-titulo">' + (balcao ? 'Quase lá' : 'Seus dados') + '</div></div></header>' +
      '<div class="conteudo">' +
        '<div class="aviso" id="avisoVolta" hidden>' + UI.iconeHtml('sorriso') + '<span id="textoVolta"></span></div>' +
        '<form id="formDados" novalidate>' +
          '<div class="bloco-form">' +
            '<div class="bloco-titulo"><span class="bloco-numero">1</span>' + (balcao ? 'Seu nome, para te chamar' : 'Quem vai receber') + '</div>' +
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
            '<div class="aviso aviso-falta" id="avisoForma" hidden style="margin-bottom:12px"></div>' +
            '<div class="forma-grupo" id="grupoAgora" hidden>Pague agora pelo site</div>' +
            '<label class="forma-pgto marcada" for="pgtoPix" id="opcaoPix"><input type="radio" name="formaPagamento" id="pgtoPix" value="pix" checked><span class="forma-icone">' + UI.iconeHtml('celular') + '</span><span class="forma-texto"><span class="forma-nome" id="nomePix">Pix agora</span><span class="forma-detalhe" id="detalhePix">Paga pelo celular, direto para a loja</span></span><span class="forma-marca">' + UI.iconeHtml('check') + '</span></label>' +
            '<label class="forma-pgto" for="pgtoCartaoOnline" id="opcaoCartaoOnline" hidden><input type="radio" name="formaPagamento" id="pgtoCartaoOnline" value="cartao_online"><span class="forma-icone">' + UI.iconeHtml('cartao') + '</span><span class="forma-texto"><span class="forma-nome">Cartão de crédito</span><span class="forma-detalhe" id="detalheCartaoOnline">À vista, pago agora aqui no site</span></span><span class="forma-marca">' + UI.iconeHtml('check') + '</span></label>' +
            '<div class="forma-grupo" id="grupoNaPorta" hidden>Pague na entrega</div>' +
            '<label class="forma-pgto" for="pgtoCartao" id="opcaoCartao" hidden><input type="radio" name="formaPagamento" id="pgtoCartao" value="cartao_entrega"><span class="forma-icone">' + UI.iconeHtml('maquininha') + '</span><span class="forma-texto"><span class="forma-nome" id="nomeCartao">Cartão na maquininha</span><span class="forma-detalhe" id="detalheCartao"></span></span><span class="forma-marca">' + UI.iconeHtml('check') + '</span></label>' +
            '<label class="forma-pgto" for="pgtoDinheiro" id="opcaoDinheiro" hidden><input type="radio" name="formaPagamento" id="pgtoDinheiro" value="dinheiro_entrega"><span class="forma-icone">' + UI.iconeHtml('dinheiro') + '</span><span class="forma-texto"><span class="forma-nome" id="nomeDinheiro">Dinheiro</span><span class="forma-detalhe" id="detalheDinheiro"></span></span><span class="forma-marca">' + UI.iconeHtml('check') + '</span></label>' +
            '<div id="blocoTroco" hidden>' +
              '<div class="forte" style="margin:6px 0 8px">Precisa de troco?</div>' +
              '<label class="opcao opcao-troco marcada" for="trocoNao"><input type="radio" class="opcao-campo" name="precisaTroco" id="trocoNao" value="nao" checked><span class="marcador redondo">' + UI.iconeHtml('check') + '</span><span class="rotulo">Não, tenho o valor certo</span></label>' +
              '<label class="opcao opcao-troco" for="trocoSim"><input type="radio" class="opcao-campo" name="precisaTroco" id="trocoSim" value="sim"><span class="marcador redondo">' + UI.iconeHtml('check') + '</span><span class="rotulo">Sim, vou pagar com uma nota maior</span></label>' +
              '<div class="campo" id="campoTrocoValor" hidden style="margin-top:12px"><label for="campoTroco">Vou pagar com quanto?</label><p class="ajuda" id="dicaTroco"></p><input type="text" id="campoTroco" inputmode="numeric" placeholder="R$ 50,00" maxlength="12"><div class="troco-calculado" id="trocoCalculado" hidden></div></div>' +
            '</div>' +
          '</div>' +
          '<div class="msg-erro" id="semFormaPagamento" hidden>A loja ainda não configurou uma forma de pagamento. Fale com ela pelo WhatsApp.</div>' +
          '<div class="bloco-form" id="blocoRecado"><div class="bloco-titulo"><span class="bloco-numero">4</span> Algum recado? <span class="bloco-opcional">opcional</span></div>' +
            '<div class="campo"><textarea id="campoObs" aria-label="Recado para a loja" placeholder="Ex: sem cebola em tudo, tocar a campainha…" maxlength="300"></textarea></div>' +
          '</div>' +
          '<div class="interruptor aviso-cel" id="blocoAvisoCel" hidden><span class="aviso-cel-ico" aria-hidden="true" id="icoAvisoCel"></span><div class="texto">Me avise no celular<small>Quando o pedido sair, mesmo com a tela apagada.</small></div><button type="button" class="chave" id="chaveAvisoCel" aria-label="Me avise no celular" aria-pressed="false"></button></div>' +
          (balcao ? '' : '<p class="nota">' + UI.iconeHtml('cadeado') + 'Seus dados ficam guardados só neste aparelho.</p>') +
          /* quem pede sabe com quem esta comprando e onde estao as regras (sem caixinha: pedir comida nao pode ter atrito) */
          '<p class="nota nota-termos">Ao pedir, você compra da loja e concorda com os <a href="#/termos" target="_blank" rel="noopener">termos</a> e a <a href="#/privacidade" target="_blank" rel="noopener">privacidade</a>.</p>' +
          '<div class="msg-erro" id="erroDados" role="alert" hidden></div>' +
        '</form>' +
      '</div>' +
      '<div class="barra-carrinho visivel"><div class="linha-barra"><div class="resumo"><div class="qtd">Total a pagar</div><div class="valor" id="dadosBarraValor"></div></div><button class="btn btn-principal" id="btnPagar">Pagar no Pix</button></div></div>' +
    '</section>' +

    '<section class="tela" id="tela-pagamento">' +
      '<header class="topo"><button class="voltar" id="btnCancelarPix" aria-label="Desistir do pedido" title="Desistir do pedido">✕</button><div class="topo-texto"><div class="topo-passo">Falta só pagar</div><div class="topo-titulo">Pague com Pix</div></div></header>' +
      '<div class="pix">' +
        '<div class="valor-grande" id="pixValor"></div>' +
        '<div class="muted" id="pixNomeLoja"></div>' +
        '<div class="pix-gerando" id="pixGerando"><span class="girando"></span> Gerando o seu Pix…</div>' +
        '<div class="pix-falhou" id="pixFalhou" hidden><p id="pixFalhouTexto"></p><button class="btn btn-escuro btn-pequeno" id="btnTentarPix" type="button">Tentar de novo</button><button class="btn btn-escuro btn-pequeno" id="btnRemontarPix" type="button" hidden>Montar de novo</button></div>' +
        /* o jeito de pagar num cartao so, logo abaixo do valor: o QR Code (quem paga de outro aparelho le com a camera) e o
           "Copiar" (quem paga no mesmo celular cola no app do banco). Antes o QR ficava la embaixo, depois dos passos */
        '<div class="cartao pix-pagar" id="pixPagar">' +
          '<div class="qr-caixa" id="pixQr"></div>' +
          '<button class="btn btn-escuro btn-largo" id="btnCopiarPix">' + UI.iconeHtml('copiar') + 'Copiar código Pix</button>' +
          '<code class="codigo-pix" id="pixCodigo"></code>' +
        '</div>' +
        '<div class="passos-pix" id="passosPix">' +
          '<div class="passo-pix"><span class="numero">1</span><span>Abra o aplicativo do seu banco</span></div>' +
          '<div class="passo-pix"><span class="numero">2</span><span>Escolha <b>Pix</b> e depois <b>Pix copia e cola</b> (ou leia o QR Code)</span></div>' +
          '<div class="passo-pix"><span class="numero">3</span><span>Cole o código, confira o valor e confirme</span></div>' +
        '</div>' +
        '<p class="aviso">' + UI.iconeHtml('raio') + '<span>Pagou, confirmou: esta tela muda sozinha e o pedido já entra na cozinha.</span></p>' +
        '<p class="nota">O Pix vale por 30 minutos. Não precisa avisar ninguém: assim que cair, você recebe a senha do pedido.</p>' +
        /* as mesmas garantias da tela do cartao, no mesmo lugar (fim da coluna) */
        '<ul class="garantias">' +
          '<li>' + UI.iconeHtml('escudo') + '<span>Pix protegido pelo Mercado Pago</span></li>' +
          '<li>' + UI.iconeHtml('loja') + '<span>O dinheiro vai direto para a loja</span></li>' +
        '</ul>' +
      '</div>' +
    '</section>' +

    '<section class="tela" id="tela-cartao">' +
      '<header class="topo"><button class="voltar" id="btnCancelarCartao" aria-label="Desistir do pedido" title="Desistir do pedido">✕</button><div class="topo-texto"><div class="topo-passo">Falta só pagar</div><div class="topo-titulo">Pague com cartão</div></div></header>' +
      '<div class="pix pix-cartao">' +
        '<div class="valor-grande" id="cartaoValor"></div>' +
        '<div class="muted" id="cartaoNomeLoja"></div>' +
        '<div class="muted pequeno cartao-taxa" id="cartaoTaxa" hidden></div>' +
        '<div class="cartao-recusado" id="cartaoRecusado" role="alert" hidden></div>' +
        '<div class="pix-gerando" id="cartaoCarregando"><span class="girando"></span> Abrindo o pagamento seguro…</div>' +
        '<div class="pix-falhou" id="cartaoFalhou" hidden><p id="cartaoFalhouTexto"></p><button class="btn btn-escuro btn-pequeno" id="btnTentarCartao" type="button">Tentar de novo</button><button class="btn btn-escuro btn-pequeno" id="btnRemontarCartao" type="button" hidden>Montar de novo</button></div>' +
        '<div class="cartao-form" id="cartaoForm"></div>' +
        '<button class="btn btn-fantasma btn-largo" id="btnOutraForma" type="button" style="max-width:440px" hidden>Pagar de outro jeito</button>' +
        /* o que o cliente precisa ouvir antes de digitar o cartao num site que nao conhece (e e verdade: o site so recebe
           um codigo de uso unico; numero, validade e codigo de seguranca ficam no Mercado Pago) */
        '<ul class="garantias">' +
          '<li>' + UI.iconeHtml('escudo') + '<span>Cartão protegido pelo Mercado Pago</span></li>' +
          '<li>' + UI.iconeHtml('cadeado') + '<span>O cartão vai direto para o Mercado Pago</span></li>' +
          '<li>' + UI.iconeHtml('olho') + '<span>A loja não vê nem guarda o seu cartão</span></li>' +
        '</ul>' +
      '</div>' +
    '</section>' +

    '<section class="tela" id="tela-senha">' +
      '<div class="sucesso">' +
        '<div class="confirmado" id="confirmado"></div>' +
        '<div class="painel-senha"><div class="rotulo">Sua senha</div><div class="senha-gigante" id="senhaNumero"></div><div class="instrucao" id="senhaInstrucao"></div></div>' +
        '<div class="a-cobrar" id="avisoACobrar" hidden></div>' +
        '<div class="linha-do-tempo" id="linhaDoTempo"></div>' +
        '<div class="avaliar-google" id="avaliarGoogle" hidden></div>' +
        '<div class="aviso-cel-pedido" id="avisoCelPedido" hidden></div>' +
        '<div class="aviso-cel-pedido jogo-convite" id="jogoConvite" hidden></div>' +
        '<div class="aviso-cel-pedido jogo-convite" id="puloConvite" hidden></div>' +
        '<button class="btn btn-fantasma btn-largo" id="btnVoltarPix" style="max-width:420px" hidden>Ver o código Pix de novo</button>' +
        '<a class="btn btn-whats btn-largo" id="btnWhatsCliente" style="max-width:420px" href="#" target="_blank" rel="noopener"><span class="icone-zap" aria-hidden="true"></span>Falar com a loja</a>' +
        '<button class="btn btn-fantasma btn-largo" id="btnNovoPedido" style="max-width:420px">' + (balcao ? 'Próximo cliente' : 'Fazer outro pedido') + '</button>' +
      '</div>' +
    '</section>' +

    '<div class="barra-carrinho" id="barraCarrinho">' +
      '<div class="progresso-entrega" id="progressoEntrega" hidden><div id="progressoTexto"></div><div class="progresso-trilho"><span id="progressoBarra"></span></div></div>' +
      '<div class="linha-barra"><div class="resumo"><div class="qtd" id="barraQtd"></div><div class="valor" id="barraValor"></div></div><button class="btn btn-principal" id="btnVerCarrinho">Ver pedido →</button></div>' +
    '</div>';
  }

  window.LigeiroCliente = {
    hub: hub, cidade: cidade, loja: loja, lerMeusPedidos: lerMeusPedidos,
    _teste: { novaChave: novaChave, assinaturaDe: assinaturaDe, chaveDoEnvio: chaveDoEnvio, lerRespostaDoPedido: lerRespostaDoPedido, desvioDoRelogio: desvioDoRelogio, pagoNoStatus: pagoNoStatus, emAnalise: emAnalise, pedeMontarDeNovo: pedeMontarDeNovo, rotuloDoPagamento: rotuloDoPagamento, rotuloDaSenha: rotuloDaSenha, pedeOutraForma: pedeOutraForma },
  };
})();
