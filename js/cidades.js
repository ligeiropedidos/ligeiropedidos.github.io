/*
 * Ligeiro - cidades do Brasil (lista oficial do IBGE, 5.571 municipios).
 *
 * dados/cidades.json = { "SP": ["Adamantina", ...], ... } (84 KB). So baixa
 * quando alguma tela precisa (cadastro, admin, ajustes), uma vez por sessao.
 *
 * LigeiroCidades.campo(nome, uf) -> bloco de formulario com busca: a pessoa
 * digita "juq", escolhe "Juquiá · SP" e pronto. bloco.valor() devolve
 * { nome, uf } so se a cidade for da lista; senao null. Assim nao entra
 * "aaaaaa" como cidade no hub.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var el = UI.el;
  var lista = null;   /* [{ nome, uf, chave }] */
  var carregando = null;

  function normal(t) { return R.semAcento(String(t || '')).toLowerCase().trim(); }

  function carregar() {
    if (lista) return Promise.resolve(lista);
    if (carregando) return carregando;
    carregando = fetch('dados/cidades.json').then(function (r) { return r.json(); }).then(function (porUf) {
      lista = [];
      Object.keys(porUf).forEach(function (uf) {
        porUf[uf].forEach(function (nome) { lista.push({ nome: nome, uf: uf, chave: normal(nome) }); });
      });
      return lista;
    }).catch(function () { carregando = null; lista = null; return []; });
    return carregando;
  }

  /* Busca: primeiro quem comeca com o termo, depois quem contem. Aceita "juquia sp". */
  function buscar(termo, limite) {
    if (!lista) return [];
    var t = normal(termo);
    var uf = '';
    var m = /^(.*?)[\s,\-·]+([a-z]{2})$/.exec(t);
    if (m && lista.some(function (c) { return c.uf.toLowerCase() === m[2]; })) { t = m[1].trim(); uf = m[2].toUpperCase(); }
    if (!t) return [];
    var comeca = [], contem = [];
    for (var i = 0; i < lista.length && (comeca.length + contem.length) < 400; i++) {
      var c = lista[i];
      if (uf && c.uf !== uf) continue;
      var pos = c.chave.indexOf(t);
      if (pos === 0) comeca.push(c); else if (pos > 0) contem.push(c);
    }
    return comeca.concat(contem).slice(0, limite || 8);
  }

  function existe(nome, uf) {
    if (!lista) return true; /* sem lista (offline), nao trava ninguem */
    var n = normal(nome), u = String(uf || '').toUpperCase();
    return lista.some(function (c) { return c.chave === n && (!u || c.uf === u); });
  }

  /* Campo com sugestoes. opcoes: { rotulo, ajuda, largo } */
  function campo(nome, uf, opcoes) {
    var o = opcoes || {};
    var escolhida = nome ? { nome: nome, uf: uf || '' } : null;
    var input = el('input', { type: 'text', maxlength: 60, placeholder: o.placeholder || 'Digite e escolha na lista', autocomplete: 'off', autocapitalize: 'words' });
    input.value = escolhida ? escolhida.nome + (escolhida.uf ? ' · ' + escolhida.uf : '') : '';
    /* A lista vive solta no body (position: fixed): nenhuma janela ou caixa com rolagem corta ela. */
    var sugestoes = el('div', { class: 'sugestoes', hidden: true });
    document.body.appendChild(sugestoes);
    var bloco = el('div', { class: 'campo campo-cidade' + (o.largo ? ' largo' : '') }, [
      el('label', { text: o.rotulo || 'Cidade' }),
      o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null,
      input,
    ]);
    bloco.input = input;

    function posicionar() {
      if (sugestoes.hidden) return;
      var r = input.getBoundingClientRect();
      var altura = sugestoes.offsetHeight || 0;
      var cabeEmbaixo = window.innerHeight - r.bottom >= altura + 12;
      var acima = !cabeEmbaixo && r.top > altura + 12;
      sugestoes.style.left = Math.round(r.left) + 'px';
      sugestoes.style.width = Math.round(r.width) + 'px';
      sugestoes.style.top = acima ? Math.round(r.top - altura - 6) + 'px' : Math.round(r.bottom + 6) + 'px';
      sugestoes.classList.toggle('acima', acima);
    }
    function esconder() { sugestoes.hidden = true; }
    function mostrar(itens) {
      UI.limpar(sugestoes);
      if (!itens.length) { esconder(); return; }
      itens.forEach(function (c) {
        sugestoes.appendChild(el('button', { type: 'button', class: 'sugestao', text: c.nome + ' · ' + c.uf, onmousedown: function (e) { e.preventDefault(); }, onclick: function () { escolher(c); } }));
      });
      sugestoes.hidden = false;
      posicionar();
    }
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
    /* toque fora do campo e da lista: fecha */
    function foraDaLista(e) { if (e.target !== input && !sugestoes.contains(e.target)) esconder(); }
    document.addEventListener('pointerdown', foraDaLista, true);
    /* o campo saiu da tela (janela fechou, troca de pagina): a lista vai junto, na hora */
    var vigia = setInterval(function () {
      if (document.body.contains(input)) {
        /* janela fechada mas ainda no DOM (animacao): campo sem tamanho = lista some */
        if (!sugestoes.hidden && !input.getClientRects().length) esconder();
        return;
      }
      clearInterval(vigia);
      window.removeEventListener('scroll', posicionar, true);
      window.removeEventListener('resize', posicionar);
      document.removeEventListener('pointerdown', foraDaLista, true);
      sugestoes.remove();
    }, 200);
    function escolher(c) {
      escolhida = { nome: c.nome, uf: c.uf };
      input.value = c.nome + ' · ' + c.uf;
      input.classList.remove('erro');
      sugestoes.hidden = true;
    }
    input.addEventListener('focus', function () { carregar(); });
    input.addEventListener('input', function () {
      escolhida = null;
      carregar().then(function () { if (document.activeElement === input) mostrar(buscar(input.value, 6)); });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !sugestoes.hidden) {
        var primeiro = sugestoes.querySelector('.sugestao');
        if (primeiro) { e.preventDefault(); primeiro.click(); }
      }
      if (e.key === 'Escape') esconder();
    });
    input.addEventListener('blur', function (e) {
      if (e.relatedTarget && sugestoes.contains(e.relatedTarget)) return; /* foi pra lista pelo teclado */
      setTimeout(function () {
        esconder();
        /* digitou o nome inteiro certinho sem clicar: aceita igual */
        if (!escolhida && lista) {
          var achados = buscar(input.value, 2);
          if (achados.length === 1 && achados[0].chave === normal(input.value.replace(/\s*·\s*[A-Za-z]{2}$/, ''))) escolher(achados[0]);
        }
        input.classList.toggle('erro', !!input.value && !escolhida);
      }, 120);
    });

    bloco.valor = function () {
      if (escolhida) return { nome: escolhida.nome, uf: escolhida.uf };
      /* lista nao carregou (sem internet no primeiro acesso): aceita o que foi digitado, sem travar ninguem */
      if (!lista && input.value.trim()) return { nome: input.value.replace(/\s*·\s*[A-Za-z]{2}$/, '').trim(), uf: '' };
      return null;
    };
    return bloco;
  }

  window.LigeiroCidades = { carregar: carregar, buscar: buscar, existe: existe, campo: campo };
})();
