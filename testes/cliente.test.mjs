/*
 * Pecas do pedido do cliente (js/cliente.js), sem navegador: a chave que impede pedido em dobro, a leitura da resposta
 * do /pedido, o relogio do celular errado, o "ja pagou?" antes de desistir e o rotulo do pagamento.
 * Rodar com:  node testes/cliente.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = require('../js/regras.js');
const codigo = fs.readFileSync(path.join(aqui, '..', 'js', 'cliente.js'), 'utf8');

/* cliente.js so precisa destas pecas para carregar (as telas nao sao montadas aqui) */
function carregar(comCrypto) {
  const janela = {
    LigeiroUI: { el() {}, $() {}, lojaOficial() { return null; } },
    LigeiroRegras: R,
    LigeiroPix: {},
    LigeiroDados: { store: {} },
  };
  if (comCrypto) janela.crypto = webcrypto;
  janela.window = janela;
  const ctx = vm.createContext(janela);
  vm.runInContext(codigo, ctx, { filename: 'cliente.js' });
  return janela.LigeiroCliente._teste;
}
const C = carregar(true);
const MIN = 60 * 1000;

test('chave nova: 20 letras e numeros, uma diferente a cada fechamento (com e sem crypto)', () => {
  const vistas = new Set();
  for (let i = 0; i < 200; i++) {
    const k = C.novaChave();
    assert.match(k, /^[A-Za-z0-9]{20}$/);
    vistas.add(k);
  }
  assert.equal(vistas.size, 200);
  const semCrypto = carregar(false);
  assert.match(semCrypto.novaChave(), /^[A-Za-z0-9]{20}$/);
  assert.notEqual(semCrypto.novaChave(), semCrypto.novaChave());
});

test('chave do envio: o mesmo pedido tocado de novo leva a mesma chave; mudou algo ou passou 30 min, outra', () => {
  const dados = { nome: 'Maria Silva', telefone: '13999990000', tipoEntrega: 'entrega', formaPagamento: 'pix', itens: [{ produtoId: 'p1', quantidade: 1 }], cupom: '' };
  const a = C.assinaturaDe(dados);
  const t0 = Date.parse('2026-09-25T20:00:00Z');
  const primeira = C.chaveDoEnvio(null, a, t0);
  primeira.enviou = true;
  /* resposta perdida, toque de novo (mesmo depois de recarregar: o rascunho volta como JSON) */
  const guardada = JSON.parse(JSON.stringify(primeira));
  const segunda = C.chaveDoEnvio(guardada, C.assinaturaDe(JSON.parse(JSON.stringify(dados))), t0 + 2 * MIN);
  assert.equal(segunda.chave, primeira.chave);
  assert.equal(segunda.enviou, true, 'o toque de novo sabe que nao e o primeiro envio');
  /* carrinho mudou: outra chave */
  const outroCarrinho = Object.assign({}, dados, { itens: [{ produtoId: 'p1', quantidade: 2 }] });
  assert.notEqual(C.chaveDoEnvio(guardada, C.assinaturaDe(outroCarrinho), t0 + 2 * MIN).chave, primeira.chave);
  /* forma de pagamento mudou: outra chave */
  const outraForma = Object.assign({}, dados, { formaPagamento: 'dinheiro_entrega' });
  assert.notEqual(C.chaveDoEnvio(guardada, C.assinaturaDe(outraForma), t0 + 2 * MIN).chave, primeira.chave);
  /* 30 min depois: outra (o pedido de antes ja venceu ou ja foi feito) */
  const velha = C.chaveDoEnvio(guardada, a, t0 + 31 * MIN);
  assert.notEqual(velha.chave, primeira.chave);
  assert.equal(velha.enviou, undefined);
  /* rascunho torto: outra */
  assert.notEqual(C.chaveDoEnvio({ chave: 'curta', de: a, em: t0 }, a, t0).chave, 'curta');
});

test('assinatura: curta, sem nome, telefone ou endereco, e muda com qualquer dado', () => {
  const dados = { nome: 'Maria Silva', telefone: '13999990000', endereco: { rua: 'Rua das Flores' }, itens: [] };
  const a = C.assinaturaDe(dados);
  assert.ok(a.length < 40);
  assert.ok(!/Maria|13999990000|Flores/.test(a));
  assert.notEqual(a, C.assinaturaDe(Object.assign({}, dados, { telefone: '13999990001' })));
  assert.equal(a, C.assinaturaDe(JSON.parse(JSON.stringify(dados))));
});

test('resposta do /pedido: 404 com texto do servidor e erro de verdade; 404 sem rota e mensageiro antigo', () => {
  const ok = { pedido: { id: 'x', senha: 1 }, avisado: true };
  assert.equal(C.lerRespostaDoPedido(200, ok), ok);
  assert.equal(C.lerRespostaDoPedido(404, { erro: 'rota' }), null);
  assert.equal(C.lerRespostaDoPedido(404, {}), null);
  assert.throws(() => C.lerRespostaDoPedido(404, { erro: 'Essa loja não existe mais.' }), (e) => e.publico === true && e.message === 'Essa loja não existe mais.');
  assert.throws(() => C.lerRespostaDoPedido(503, { pausa: true, erro: 'O site está com movimento demais agora.' }), (e) => e.pausa === true);
  assert.throws(() => C.lerRespostaDoPedido(429, { erro: 'Muitos pedidos seguidos daqui.' }), /Muitos pedidos/);
  assert.throws(() => C.lerRespostaDoPedido(500, {}), /Não conseguimos enviar o pedido/);
  assert.throws(() => C.lerRespostaDoPedido(200, {}), /Não conseguimos enviar o pedido/);
});

test('422 da forma de pagamento que saiu: a tela volta para a escolha da forma (e so esse erro)', () => {
  const pegar = (status, erro) => { try { C.lerRespostaDoPedido(status, { erro }); } catch (e) { return e; } return null; };
  const forma = pegar(422, 'Essa forma de pagamento não está disponível agora. Escolha outra.');
  assert.equal(forma.status, 422);
  assert.equal(forma.message, 'Essa forma de pagamento não está disponível agora. Escolha outra.');
  assert.equal(C.pedeOutraForma(forma), true);
  assert.equal(C.pedeOutraForma(pegar(422, 'Para retirar no balcão, pague no Pix.')), true);
  assert.equal(C.pedeOutraForma(pegar(422, 'A loja está fechada no momento. Volte mais tarde!')), false);
  assert.equal(C.pedeOutraForma(pegar(429, 'Muitos pedidos seguidos daqui.')), false);
  assert.equal(C.pedeOutraForma(new TypeError('Failed to fetch')), false);
});

test('relogio 40 min adiantado: com a diferenca medida no pedido, o Pix e o cartao recem-criados nao vencem', () => {
  const servidor = Date.parse('2026-09-25T22:00:00Z');
  const celular = servidor + 40 * MIN;
  const criadoEm = new Date(servidor).toISOString();
  const desvio = C.desvioDoRelogio(criadoEm, celular + 2000); /* a resposta chega 2 s depois */
  assert.ok(Math.abs(desvio + 40 * MIN) < 5000);
  const pix = { status: R.STATUS.AGUARDANDO, formaPagamento: 'pix', criadoEm, pixCodigo: '' };
  const cartao = Object.assign({}, pix, { formaPagamento: 'cartao_online' });
  assert.equal(R.pixVencido(pix, celular), true, 'sem correcao o celular cancelaria');
  assert.equal(R.pixVencido(pix, celular + desvio), false);
  assert.equal(R.pixVencido(cartao, celular + desvio), false);
  /* e continua vencendo de verdade depois de 35 min */
  assert.equal(R.pixVencido(pix, celular + 36 * MIN + desvio), true);
  /* diferenca pequena e so a demora da internet */
  assert.equal(C.desvioDoRelogio(criadoEm, servidor + 20 * 1000), 0);
  assert.equal(C.desvioDoRelogio('torto', servidor), 0);
});

test('antes de desistir: o /status diz se o dinheiro ja passou', () => {
  assert.equal(C.pagoNoStatus({ status: 'pago', vencido: false }), true);
  assert.equal(C.pagoNoStatus({ status: 'producao' }), true);
  assert.equal(C.pagoNoStatus({ status: 'aguardando_pagamento', vencido: true }), false);
  assert.equal(C.pagoNoStatus({ status: 'cancelado' }), false);
  assert.equal(C.pagoNoStatus({}), false);
  assert.equal(C.pagoNoStatus(null), false);
});

test('cartao em analise ou sem resposta do banco: ninguem desiste; trava velha de "cobrando" solta em 5 min', () => {
  const agora = Date.parse('2026-09-25T22:00:00Z');
  const base = { status: R.STATUS.AGUARDANDO, formaPagamento: 'cartao_online' };
  assert.equal(C.emAnalise(Object.assign({}, base, { cobrancaIncerta: '2026-09-25T20:00:00Z', cobrandoEm: '2026-09-25T20:00:00Z' }), agora), true);
  assert.equal(C.emAnalise(Object.assign({}, base, { cobrandoEm: new Date(agora - 30 * 1000).toISOString() }), agora), true);
  assert.equal(C.emAnalise(Object.assign({}, base, { cobrandoEm: new Date(agora - 6 * MIN).toISOString() }), agora), false);
  assert.equal(C.emAnalise(Object.assign({}, base, { cobrandoEm: '', cobrancaIncerta: '' }), agora), false);
  assert.equal(C.emAnalise(Object.assign({}, base, { status: R.STATUS.PAGO, cobrancaIncerta: 'x' }), agora), false);
  assert.equal(C.emAnalise(null, agora), false);
});

test('409 do cardapio mudou pede montar de novo; os outros 409 nao', () => {
  assert.equal(C.pedeMontarDeNovo('O cardápio mudou ou o valor do pedido não confere. Monte o pedido de novo.'), true);
  assert.equal(C.pedeMontarDeNovo('esse pedido passou do prazo do Pix'), false);
  assert.equal(C.pedeMontarDeNovo('a loja não ligou o Pix automático'), false);
  assert.equal(C.pedeMontarDeNovo(undefined), false);
});

test('linha do tempo: cartao nao aparece como "Pix confirmado"', () => {
  assert.equal(C.rotuloDoPagamento({ formaPagamento: 'pix', pagamentoStatus: 'pago', total: 3000 }), 'Pix confirmado');
  assert.equal(C.rotuloDoPagamento({ formaPagamento: 'cartao_online', pagamentoStatus: 'pago', total: 3000 }), 'Cartão aprovado');
  assert.equal(C.rotuloDoPagamento({ formaPagamento: 'dinheiro_entrega', pagamentoStatus: 'na_entrega', total: 3000 }), 'Pedido confirmado');
  assert.equal(C.rotuloDoPagamento({ formaPagamento: 'cartao_entrega', pagamentoStatus: 'pago', total: 3000 }), 'Pedido confirmado');
  assert.equal(C.rotuloDoPagamento({ formaPagamento: 'pix', pagamentoStatus: 'pago', total: 0 }), 'Pedido confirmado');
});

test('dinheiro devolvido nunca aparece como "confirmado"', () => {
  const pagoPix = { status: R.STATUS.PAGO, formaPagamento: 'pix', pagamentoStatus: 'pago', total: 3000 };
  assert.equal(C.rotuloDaSenha(pagoPix).texto, 'Pagamento confirmado');
  assert.equal(C.rotuloDoPagamento(Object.assign({}, pagoPix, { pagamentoStatus: 'devolvido' })), 'Dinheiro devolvido');
  assert.equal(C.rotuloDoPagamento(Object.assign({}, pagoPix, { devolvidoEm: '2026-09-25T20:00:00Z' })), 'Dinheiro devolvido');
  const cancelado = Object.assign({}, pagoPix, { status: R.STATUS.CANCELADO });
  assert.equal(C.rotuloDaSenha(cancelado).texto, 'Pedido cancelado');
  assert.equal(C.rotuloDaSenha(Object.assign({}, cancelado, { devolvidoEm: '2026-09-25T20:00:00Z' })).texto, 'Pedido cancelado, dinheiro devolvido');
  assert.equal(C.rotuloDaSenha(Object.assign({}, pagoPix, { pagamentoStatus: 'devolvido' })).texto, 'Dinheiro devolvido');
  assert.equal(C.rotuloDaSenha({ status: R.STATUS.AGUARDANDO, formaPagamento: 'pix' }).texto, 'Pedido enviado, esperando o Pix');
  assert.equal(C.rotuloDaSenha({ status: R.STATUS.PAGO, formaPagamento: 'dinheiro_entrega', pagamentoStatus: 'na_entrega', total: 3000 }).texto, 'Pedido confirmado');
});

test('textos da tela: "para" (nunca "pra") e sem travessao', () => {
  const textos = [];
  const re = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(codigo))) textos.push(m[1]);
  const novos = ['Montar de novo', 'não está mais disponível agora', 'A loja parou de fazer entrega agora', 'O banco ainda está conferindo', 'O tempo desta tela acabou', 'Volte ao carrinho e tire esse item', 'Chame a loja no WhatsApp ou tente de novo'];
  novos.forEach((n) => assert.ok(textos.some((t) => t.indexOf(n) >= 0), 'falta o texto: ' + n));
  const daTela = textos.filter((t) => /[A-Za-zÀ-ú]{3,} [A-Za-zÀ-ú]{2,}/.test(t) && !/[<>]/.test(t));
  daTela.forEach((t) => {
    assert.ok(!/(^|\s)pra(\s|$)/i.test(t), 'pra: ' + t);
    assert.ok(!/[–—]/.test(t), 'travessao: ' + t);
  });
});
