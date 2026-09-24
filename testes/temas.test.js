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
      /* o proprio escopo (.tema-x ... ou .algo.tema-x, como a janela que leva o tema) ou o body que contem o tema */
      return !(s.indexOf(classe) >= 0 && (s.indexOf(classe) === 0 || /^[.#a-z-]+\.tema-/.test(s) || s.indexOf('body:has(' + classe + ')') === 0));
    });
    assert.deepStrictEqual(fora, [], 'regras fora do escopo do tema ' + nome);
  });

  test('tema ' + nome + ': nao mexe na posicao das pecas do sistema (tutorial e mensagens por cima da tela)', function () {
    const css = fs.readFileSync(path.join(PASTA, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /* essas pecas ficam presas na tela: o tema pode mudar cor, borda e letra, nunca position, top, inset ou z-index */
    const perigo = /(\.tour[\w-]*|\.modal[\w-]*|\.toast[\w-]*|\.pausa-fundo)[^{]*\{[^}]*\b(position|inset|top|bottom|z-index)\s*:/g;
    const achados = css.match(perigo) || [];
    assert.deepStrictEqual(achados.map(function (x) { return x.slice(0, 80); }), [], 'o tema mexeu na posicao de peca do sistema');
  });
});
