/*
 * Temas exclusivos (css/temas/*.css): cada regra vale so dentro da classe do proprio tema (.tema-<nome>).
 * Foi uma regra de tema com nome solto que prendeu o tutorial no rodape da Dom Conizza (".abertura" era da capa da
 * loja e pegou o balao do tutorial). Este teste falha se um tema tiver seletor fora do proprio escopo, ou se mexer
 * em pecas com nome reservado (tutorial, primeiros passos, Mercado Pago, cartao), que se ajustam so pelas variaveis.
 * Rodar: node --test testes/temas.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'css', 'temas');

/* seletores de primeiro nivel (entrando em @media e @supports; pulando @keyframes, @font-face e @import) */
function seletores(css) {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const achados = [];
  function varrer(texto) {
    let i = 0;
    while (i < texto.length) {
      const abre = texto.indexOf('{', i);
      if (abre < 0) break;
      const cabeca = texto.slice(i, abre).replace(/^[\s;]+/, '').trim();
      /* acha o fecha correspondente */
      let nivel = 1, j = abre + 1;
      while (j < texto.length && nivel) { if (texto[j] === '{') nivel++; else if (texto[j] === '}') nivel--; j++; }
      const corpo = texto.slice(abre + 1, j - 1);
      if (/^@(media|supports)/.test(cabeca)) varrer(corpo);
      else if (!/^@/.test(cabeca)) cabeca.split(',').forEach(function (s) { if (s.trim()) achados.push(s.trim()); });
      i = j;
    }
  }
  /* @import com ; no fim nao abre bloco: some antes */
  varrer(limpo.replace(/@import\s+url\([^)]*\)\s*;/g, '').replace(/@import[^;]+;/g, ''));
  return achados;
}

const temas = fs.readdirSync(PASTA).filter(function (f) { return /\.css$/.test(f); });

test('existe pelo menos um tema para conferir', function () {
  assert.ok(temas.length > 0);
});

temas.forEach(function (arquivo) {
  const nome = arquivo.replace(/\.css$/, '');
  const classe = '.tema-' + nome;
  const lista = seletores(fs.readFileSync(path.join(PASTA, arquivo), 'utf8'));

  test('tema ' + nome + ': toda regra fica dentro de ' + classe, function () {
    const fora = lista.filter(function (s) {
      /* o proprio escopo (.tema-x ... ou .algo.tema-x, como a janela que leva o tema) ou o body que contem o tema
         (tambem "body:has(.tema-x #tela-inicio)": o tema so no site da loja, sem pegar o painel) */
      return !(s.indexOf(classe) >= 0 && (s.indexOf(classe) === 0 || /^[.#a-z-]+\.tema-/.test(s) || (s.indexOf('body:has(' + classe) === 0 && /[) :]/.test(s.charAt(('body:has(' + classe).length)))));
    });
    assert.deepStrictEqual(fora, [], 'regras fora do escopo do tema ' + nome);
  });

  test('tema ' + nome + ': nao mexe na posicao das pecas do sistema (tutorial e mensagens por cima da tela)', function () {
    const css = fs.readFileSync(path.join(PASTA, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /* essas pecas ficam presas na tela: o tema pode mudar cor, borda e letra, nunca position, top, inset ou z-index */
    /* "margin-bottom" e "padding-top" sao espaco, nao posicao: so vale a propriedade sozinha (top:, bottom:...) */
    const perigo = /(\.tour[\w-]*|\.modal[\w-]*|\.toast[\w-]*|\.pausa-fundo)[^{]*\{[^}]*(?<![-\w])(position|inset|top|bottom|z-index)\s*:/g;
    const achados = css.match(perigo) || [];
    assert.deepStrictEqual(achados.map(function (x) { return x.slice(0, 80); }), [], 'o tema mexeu na posicao de peca do sistema');
  });

  /* 06/10/2026: o tema do Mak (e o da Kazoku, copiado dele) trocou o .topo de "sticky" para "relative" so para desenhar o fio de
     luz embaixo; o cabecalho passou a subir com a pagina e a barra das categorias (presa na altura dele) ficou solta no meio
     da tela, com os lanches aparecendo por cima. As barras presas ao rolar so mudam de cor e letra no tema, nunca de posicao */
  test('tema ' + nome + ': nao solta as barras presas ao rolar (cabecalho, categorias, topo e abas do painel)', function () {
    const css = fs.readFileSync(path.join(PASTA, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const achados = [];
    const bloco = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = bloco.exec(css))) {
      const mexe = /(^|[;\s])(position|top|bottom|inset)\s*:/.test(m[2]);
      if (!mexe) continue;
      m[1].split(',').forEach(function (sel) {
        if (/\.(topo|abas|painel-topo|abas-painel|barra-topo)\s*$/.test(sel.trim())) achados.push(sel.trim().slice(0, 80));
      });
    }
    assert.deepStrictEqual(achados, [], 'o tema mexeu na posicao de barra presa');
  });
});

/* 19/11/2026: o "PEDIDO" do selo escuro do painel (cor --senha-rotulo, ou --lime, sobre o --deep) tem que dar para ler:
   contraste minimo de 4,5 (WCAG AA, letra pequena). No tema da Cris dava 1,8 (rosa sobre vinho) */
function luminancia(hex) {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contraste(a, b) { const x = luminancia(a), y = luminancia(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
test('o selo do numero do pedido no painel tem contraste para ler em todo tema', () => {
  const blocos = [];
  temas.forEach(function (f) {
    const css = fs.readFileSync(path.join(PASTA, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*--deep:[^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) if (/painel-topo/.test(m[1])) blocos.push({ f: f, corpo: m[2] });
  });
  const raiz = fs.readFileSync(path.join(__dirname, '..', 'css', 'ligeiro.css'), 'utf8');
  blocos.push({ f: 'ligeiro.css', corpo: '--deep: ' + /--deep:\s*(#[0-9A-Fa-f]{6})/.exec(raiz)[1] + '; --lime: ' + /--lime:\s*(#[0-9A-Fa-f]{6})/.exec(raiz)[1] + ';' });
  assert.ok(blocos.length >= 6, 'achei ' + blocos.length + ' blocos do painel');
  blocos.forEach(function (b) {
    const cor = (n) => { const m = new RegExp('--' + n + ':\s*(#[0-9A-Fa-f]{6})').exec(b.corpo); return m ? m[1] : null; };
    const fundo = cor('deep'), letra = cor('senha-rotulo') || cor('lime');
    if (!fundo || !letra) return;
    assert.ok(contraste(fundo, letra) >= 4.5, b.f + ': "PEDIDO" ' + letra + ' sobre ' + fundo + ' dá ' + contraste(fundo, letra).toFixed(2));
    assert.ok(contraste(fundo, '#FFFFFF') >= 4.5, b.f + ': o numero branco sobre ' + fundo + ' dá ' + contraste(fundo, '#FFFFFF').toFixed(2));
  });
});
