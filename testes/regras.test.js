'use strict';

/*
 * Testes das regras do pedido. Rodar com:
 *   node --test testes/regras.test.js testes/pix.test.js   (o do mensageiro: node testes/worker.test.mjs)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/regras.js');

function lojaDeTeste() {
  return {
    slug: 'teste',
    nome: 'Loja Teste',
    cidade: 'Juquiá',
    aberta: true,
    aceitaEntrega: true,
    aceitaRetirada: true,
    aceitaPix: true,
    mpAtivo: true,
    aceitaCartaoEntrega: true,
    aceitaDinheiroEntrega: true,
    aceitaPagarNoBalcao: false,
    pix: { chave: 'loja@exemplo.com', nome: 'Loja Teste', cidade: 'Juquia' },
    taxaEntrega: 500,
    entregaGratisAcima: 6000,
    pedidoMinimo: 0,
    tempoPreparo: 20,
    tempoEntrega: 40,
    categorias: [{ id: 'lanche', nome: 'Lanches' }, { id: 'bebida', nome: 'Bebidas' }],
    produtos: [
      { id: 'x', categoria: 'lanche', nome: 'X-Burguer', preco: 1800, ativo: true, ingredientes: ['Alface', 'Tomate'] },
      { id: 'sumiu', categoria: 'lanche', nome: 'Antigo', preco: 1000, ativo: false },
      { id: 'refri', categoria: 'bebida', nome: 'Refri', preco: 600, ativo: true },
    ],
    grupos: {
      tamanho: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0, padrao: true }, { id: 'g', nome: 'G', preco: 700 }] },
      extras: { titulo: 'Extras', tipo: 'varios', max: 2, opcoes: [{ id: 'bacon', nome: 'Bacon', preco: 400 }, { id: 'ovo', nome: 'Ovo', preco: 200 }, { id: 'off', nome: 'Desligado', preco: 100, ativo: false }] },
    },
    gruposPorCategoria: { lanche: ['tamanho', 'extras'], bebida: [] },
    cupons: [{ codigo: 'DEZ', percentual: 10, minimo: 0, limite: 0, usos: 0, ativo: true }],
  };
}

test('slug tira acento e espaco', () => {
  assert.equal(R.slug('Lanchonete do Zé'), 'lanchonete-do-ze');
  assert.equal(R.slug('  Açaí & Cia!! '), 'acai-cia');
});

test('telefone aceita DDD + numero, com ou sem 55', () => {
  assert.equal(R.validarTelefone('(13) 99999-0001'), '13999990001');
  assert.equal(R.validarTelefone('5513999990001'), '13999990001');
  assert.throws(() => R.validarTelefone('9999'), /WhatsApp/);
});

test('conta do item usa tamanho e adicionais do cardapio, nunca da tela', () => {
  const loja = lojaDeTeste();
  const c = R.calcularItens(loja, [
    { produtoId: 'x', quantidade: 2, tamanho: 'g', adicionais: ['bacon', 'ovo', 'bacon'], removidos: ['Tomate', 'Inventado'], precoUnitario: 1 },
  ]);
  assert.equal(c.itens[0].precoUnitario, 1800 + 700 + 400 + 200);
  assert.equal(c.itens[0].totalItem, 2 * 3100);
  assert.deepEqual(c.itens[0].removidos, ['Tomate']);
  assert.equal(c.itens[0].adicionais.length, 2);
  assert.equal(c.subtotal, 6200);
});

test('sem tamanho cai no padrao; tamanho que nao existe e produto desligado sao recusados', () => {
  const loja = lojaDeTeste();
  const c = R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1 }]);
  assert.equal(c.itens[0].tamanho.id, 'p');
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: '' }]).itens[0].tamanho.id, 'p');
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'zzz' }]), /em "X-Burguer"/);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'sumiu', quantidade: 1 }]), /sair do cardápio/);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 0 }]), /Quantidade/);
  assert.throws(() => R.calcularItens(loja, []), /vazio/);
});

test('mais adicionais que o maximo e recusado', () => {
  const loja = lojaDeTeste();
  loja.grupos.extras.opcoes.push({ id: 'queijo', nome: 'Queijo', preco: 100 });
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, adicionais: ['bacon', 'ovo', 'queijo'] }]), /Máximo/);
});

test('taxa de entrega some acima do valor de entrega gratis', () => {
  const loja = lojaDeTeste();
  assert.equal(R.calcularTaxaEntrega(loja, 'entrega', 5000), 500);
  assert.equal(R.calcularTaxaEntrega(loja, 'entrega', 6000), 0);
  assert.equal(R.calcularTaxaEntrega(loja, 'retirada', 1000), 0);
  /* frete gratis manda acima da taxa e do "gratis acima de" */
  var gratis = Object.assign({}, loja, { freteGratis: true });
  assert.equal(R.calcularTaxaEntrega(gratis, 'entrega', 1000), 0);
  assert.equal(R.descreverFrete(gratis), 'Entrega grátis');
  assert.equal(R.descreverFrete(loja), 'Taxa R$\u00A05,00, grátis a partir de R$\u00A060,00');
  assert.equal(R.descreverFrete(Object.assign({}, loja, { entregaGratisAcima: 0 })), 'Taxa R$\u00A05,00');
  assert.equal(R.descreverFrete(Object.assign({}, loja, { taxaEntrega: 0 })), 'Entrega grátis');
  assert.equal(R.descreverFrete(Object.assign({}, loja, { aceitaEntrega: false })), 'Só retirada');
  /* categoria desligada some do site com os itens dela */
  var primeira = loja.categorias[0].id;
  var comDesligada = Object.assign({}, loja, { categorias: loja.categorias.map(function (c) { return c.id === primeira ? Object.assign({}, c, { ativa: false }) : c; }) });
  assert.equal(R.categoriaAtiva(loja, primeira), true);
  assert.equal(R.categoriaAtiva(comDesligada, primeira), false);
  assert.equal(R.produtosAtivos(comDesligada).some(function (p) { return p.categoria === primeira; }), false);
  assert.equal(R.produtosAtivos(loja).some(function (p) { return p.categoria === primeira; }), true);
});

test('próxima abertura de hoje', function () {
  var loja = Object.assign({}, lojaDeTeste(), { usarHorarios: true, horarios: { qui: ['11:00-14:00', '18:00-23:00'] } });
  var quintaCedo = new Date('2026-09-17T09:30:00'); /* quinta */
  assert.equal(R.proximaAbertura(loja, quintaCedo), '11:00');
  assert.equal(R.proximaAbertura(loja, new Date('2026-09-17T15:00:00')), '18:00');
  assert.equal(R.proximaAbertura(loja, new Date('2026-09-17T23:30:00')), null);
  assert.equal(R.proximaAbertura(Object.assign({}, loja, { aberta: false }), quintaCedo), null);
});

test('assinatura: grátis, paga, vencendo, vencida, bloqueada e cortesia', function () {
  var hoje = new Date('2026-09-17T12:00:00Z');
  function em(dias) { return new Date(hoje.getTime() + dias * 864e5).toISOString(); }
  var loja = lojaDeTeste();
  /* 7 dias gratis: e gratis ate o ultimo dia (nunca "vencendo") e acabou, bloqueou (sem tolerancia) */
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'teste', desde: em(-2) } }), hoje).estado, 'gratis');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'teste', desde: em(-6) } }), hoje).estado, 'gratis');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'teste', desde: em(-8) } }), hoje).estado, 'bloqueada');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'teste', desde: em(-8) } }), hoje).tolerancia, 0);
  /* quem paga: aviso a 7 dias, 10 dias de tolerancia depois do vencimento */
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo', desde: em(-100), pagoAte: em(20) } }), hoje).estado, 'ativa');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo', desde: em(-100), pagoAte: em(3) } }), hoje).estado, 'vencendo');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo', desde: em(-100), pagoAte: em(-5) } }), hoje).estado, 'vencida');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo', desde: em(-100), pagoAte: em(-12) } }), hoje).estado, 'bloqueada');
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo' } }), hoje).cortesia, true);
  /* encerrada pelo dono: fica no ar ate o fim do periodo, depois cancela */
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'cancelado', desde: em(-2) } }), hoje).encerrando, true);
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'cancelado', desde: em(-10) } }), hoje).estado, 'cancelada');
  assert.equal(R.lojaBloqueada(Object.assign({}, loja, { plano: { status: 'teste', desde: em(-9) } })), true);
  assert.equal(R.lojaBloqueada(loja), false);
});

test('cupom desconta so nos itens e respeita minimo e limite', () => {
  const loja = lojaDeTeste();
  const o = R.orcar(loja, { itens: [{ produtoId: 'x', quantidade: 1 }], tipoEntrega: 'entrega', cupom: 'dez' });
  assert.equal(o.desconto, 180);
  assert.equal(o.total, 1800 - 180 + 500);
  loja.cupons[0].minimo = 5000;
  assert.match(R.orcar(loja, { itens: [{ produtoId: 'x', quantidade: 1 }], cupom: 'DEZ' }).cupomErro, /a partir de/);
  loja.cupons[0].minimo = 0;
  loja.cupons[0].limite = 1;
  loja.cupons[0].usos = 1;
  assert.match(R.orcar(loja, { itens: [{ produtoId: 'x', quantidade: 1 }], cupom: 'DEZ' }).cupomErro, /todo usado/);
  assert.match(R.orcar(loja, { itens: [{ produtoId: 'x', quantidade: 1 }], cupom: 'NAOEXISTE' }).cupomErro, /não existe/);
});

test('pedido no Pix nasce aguardando; na maquininha nasce pago (a cobrar na porta)', () => {
  const loja = lojaDeTeste();
  const base = {
    nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega',
    endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'perto da praça' },
    itens: [{ produtoId: 'x', quantidade: 1 }],
  };
  const pix = R.montarPedido(loja, Object.assign({}, base, { formaPagamento: 'pix' }));
  assert.equal(pix.status, R.STATUS.AGUARDANDO);
  assert.equal(pix.pagamentoStatus, 'pendente');
  assert.equal(pix.total, 2300);
  assert.equal(pix.endereco.referencia, 'perto da praça');

  const cartao = R.montarPedido(loja, Object.assign({}, base, { formaPagamento: 'cartao_entrega' }));
  assert.equal(cartao.status, R.STATUS.PAGO);
  assert.equal(cartao.pagamentoStatus, 'na_entrega');

  const dinheiro = R.montarPedido(loja, Object.assign({}, base, { formaPagamento: 'dinheiro_entrega', trocoPara: 5000 }));
  assert.equal(dinheiro.trocoPara, 5000);
  assert.throws(() => R.montarPedido(loja, Object.assign({}, base, { formaPagamento: 'dinheiro_entrega', trocoPara: 1000 })), /troco/);
});

test('loja fechada, entrega desligada e retirada com maquininha sao recusadas', () => {
  const loja = lojaDeTeste();
  const base = { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', itens: [{ produtoId: 'x', quantidade: 1 }] };
  assert.throws(() => R.montarPedido(loja, Object.assign({}, base, { formaPagamento: 'cartao_entrega' })), /balcão/);
  loja.aberta = false;
  assert.throws(() => R.montarPedido(loja, base), /fechada/);
  loja.aberta = true;
  loja.aceitaEntrega = false;
  assert.throws(() => R.montarPedido(loja, Object.assign({}, base, { tipoEntrega: 'entrega', endereco: { rua: 'A', bairro: 'B' } })), /sem entrega/);
});

test('entrega exige rua e bairro; numero pode faltar', () => {
  const loja = lojaDeTeste();
  const base = { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega', itens: [{ produtoId: 'x', quantidade: 1 }] };
  assert.throws(() => R.montarPedido(loja, Object.assign({}, base, { endereco: { rua: 'A' } })), /rua e do bairro/);
  const p = R.montarPedido(loja, Object.assign({}, base, { endereco: { rua: 'Rua A', bairro: 'Centro' } }));
  assert.equal(p.endereco.numero, 's/n');
});

test('horario da loja, inclusive faixa que vira a noite', () => {
  const horarios = { seg: [['18:00', '01:00']], ter: [] };
  const segNoite = new Date(2026, 8, 14, 22, 0); /* segunda */
  const segTarde = new Date(2026, 8, 14, 15, 0);
  const terMadrugada = new Date(2026, 8, 15, 0, 30); /* ja e terca, mas ainda dentro da noite de segunda */
  const segMadrugada = new Date(2026, 8, 14, 0, 30); /* madrugada de segunda: domingo nao abre */
  assert.equal(R.dentroDoHorario(horarios, segNoite), true);
  assert.equal(R.dentroDoHorario(horarios, segTarde), false);
  assert.equal(R.dentroDoHorario(horarios, terMadrugada), true);
  assert.equal(R.dentroDoHorario(horarios, segMadrugada), false);
  assert.equal(R.dentroDoHorario({ seg: ['18:00-01:00'] }, segNoite), true, 'faixa em texto, como fica na nuvem');
  assert.equal(R.lojaAberta({ aberta: true, usarHorarios: true, horarios: horarios }, segNoite), true);
  assert.equal(R.lojaAberta({ aberta: false, usarHorarios: true, horarios: horarios }, segNoite), false);
});

test('senha recomeca a cada dia', () => {
  const hoje = new Date(2026, 8, 13, 20, 0);
  const s1 = R.proximaSenha(null, hoje);
  assert.equal(s1.ultima, 1);
  const s2 = R.proximaSenha(s1, hoje);
  assert.equal(s2.ultima, 2);
  const amanha = new Date(2026, 8, 14, 9, 0);
  assert.equal(R.proximaSenha(s2, amanha).ultima, 1);
});

test('transicoes e rotulos', () => {
  assert.deepEqual(R.TRANSICOES[R.STATUS.PAGO], [R.STATUS.PRODUCAO, R.STATUS.CANCELADO]);
  assert.equal(R.proximoStatus({ status: R.STATUS.PRODUCAO }), R.STATUS.PRONTO);
  assert.equal(R.proximoStatus({ status: R.STATUS.FINALIZADO }), null);
  assert.equal(R.rotuloStatus({ status: R.STATUS.PRONTO, tipoEntrega: 'entrega' }), 'Saiu para entrega');
  assert.equal(R.rotuloStatus({ status: R.STATUS.AGUARDANDO, clientePagou: true }), 'Cliente diz que pagou');
  assert.equal(R.rotuloProximoPasso({ status: R.STATUS.PRONTO, tipoEntrega: 'retirada' }), 'Retirado, concluir');
});

test('painel confere o total gravado contra o cardapio', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1 }] });
  assert.equal(R.conferirTotal(loja, p).ok, true);
  p.total = 100;
  const c = R.conferirTotal(loja, p);
  assert.equal(c.ok, false);
  assert.equal(c.esperado, 1800);
});

test('conferencia do total entende tamanho, adicionais, entrega gratis e cupom ja gravados', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'pix', endereco: { rua: 'A', bairro: 'B' }, cupom: 'DEZ', itens: [{ produtoId: 'x', quantidade: 2, tamanho: 'g', adicionais: ['bacon'] }] });
  /* 2 x (18 + 7 + 4) = 58,00; cupom 10% = 5,80; entrega gratis acima de 60 nao vale (52,20 < 60) -> +5,00 */
  assert.equal(p.total, 5800 - 580 + 500);
  assert.equal(R.conferirTotal(loja, p).ok, true);
  /* cupom esgotado depois de usado: a conferencia continua batendo */
  loja.cupons[0].limite = 1;
  loja.cupons[0].usos = 1;
  assert.equal(R.conferirTotal(loja, p).ok, true);
  /* preco mudou no cardapio: avisa. 2 x (20 + 7 + 4) = 62,00, acima de 60 a entrega sai gratis */
  loja.produtos[0].preco = 2000;
  const c = R.conferirTotal(loja, p);
  assert.equal(c.ok, false);
  assert.equal(c.esperado, 2 * (2000 + 700 + 400) - 580);
});

test('mensagens de WhatsApp e link', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria Silva', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'dinheiro_entrega', trocoPara: 5000, endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'portão azul' }, itens: [{ produtoId: 'x', quantidade: 2, adicionais: ['bacon'] }] });
  p.senha = 7;
  const ficha = R.fichaDoPedido(loja, p);
  assert.match(ficha, /SENHA 7/);
  assert.match(ficha, /Referência: portão azul/);
  /* 2 x (18,00 + 4,00 de bacon) = 44,00, mais 5,00 de entrega = 49,00; paga com 50,00 */
  assert.match(ficha, /TOTAL A COBRAR: R\$ 49,00/);
  assert.match(ficha, /LEVAR R\$ 1,00 DE TROCO/);
  assert.match(R.mensagemDoCliente(loja, p), /senha 7/);
  assert.match(R.mensagemParaCliente(loja, p), /Maria/);
  const link = R.linkWhatsapp('(13) 99999-0001', 'oi');
  assert.equal(link, 'https://wa.me/5513999990001?text=oi');
  assert.equal(R.linkWhatsapp('', 'oi'), '');
});

test('WhatsApp do pedido: a mensagem e o botao mudam com o status', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria Silva', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'dinheiro_entrega', endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro' }, itens: [{ produtoId: 'x', quantidade: 1 }] });
  p.senha = 12;
  const com = (status, tipo) => Object.assign({}, p, { status, tipoEntrega: tipo || 'entrega' });
  assert.match(R.mensagemParaCliente(loja, com('pago')), /Recebemos seu pedido \(senha 12\) e ele já está na fila\. Chega em cerca de \d+ minutos\./);
  assert.match(R.mensagemParaCliente(loja, com('producao')), /já está sendo preparado\. Logo sai para entrega\./);
  assert.match(R.mensagemParaCliente(loja, com('pronto')), /saiu para entrega! Já está a caminho\./);
  assert.match(R.mensagemParaCliente(loja, com('pronto', 'retirada')), /está pronto! Pode vir buscar\./);
  assert.match(R.mensagemParaCliente(loja, com('finalizado')), /Obrigado pelo pedido!/);
  assert.match(R.mensagemParaCliente(loja, com('cancelado')), /foi cancelado/);
  assert.equal(R.rotuloAvisoWhats(com('pago')), 'Pedido recebido');
  assert.equal(R.rotuloAvisoWhats(com('pronto')), 'Saiu para entrega');
  assert.equal(R.rotuloAvisoWhats(com('pronto', 'retirada')), 'Pronto para retirar');
  assert.equal(R.rotuloAvisoWhats(com('aguardando_pagamento')), 'Lembrar do Pix');
  /* nenhuma mensagem da loja sai com "pra" nem com travessao */
  ['aguardando_pagamento', 'pago', 'producao', 'pronto', 'finalizado', 'cancelado'].forEach((s) => {
    const m = R.mensagemParaCliente(loja, com(s));
    assert.doesNotMatch(m, /\bpra\b|—/);
    assert.match(m, /^Oi, Maria! Aqui é da /);
  });
});

test('comercio: o pedido nasce marcado e todo texto do pedido fala de separar, sem cozinha nem comida', () => {
  const loja = Object.assign(lojaDeTeste(), { tipo: 'Roupas', aceitaPagarNoBalcao: true });
  const p = R.montarPedido(loja, { nome: 'Bia Lima', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'dinheiro_entrega', itens: [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }] });
  assert.equal(p.segmento, 'comercio');
  p.senha = 31;
  const com = (status, tipo) => Object.assign({}, p, { status, tipoEntrega: tipo || 'retirada' });
  /* so com o pedido (equipe, aviso, push) */
  assert.equal(R.rotuloStatus(com('pago')), 'Novo, separar');
  assert.equal(R.rotuloStatus(com('producao')), 'Separando');
  assert.equal(R.rotuloStatusCliente(com('producao')), 'Separando');
  assert.equal(R.rotuloProximoPasso(com('pago')), 'Começar a separar');
  assert.equal(R.rotuloAvisoWhats(com('producao')), 'Separando');
  assert.equal(R.refPedido(com('pago')), 'pedido nº 31');
  /* tela do cliente */
  assert.match(R.textoDoEstagio(com('pago'), loja), /^Mostre o número do pedido na loja\. Fica separado em cerca de 20 minutos\.$/);
  assert.equal(R.textoDoEstagio(com('producao'), loja), 'A loja está separando o seu pedido agora.');
  assert.equal(R.textoDoEstagio(com('finalizado'), loja), 'Retirado. Obrigado pela compra!');
  assert.equal(R.textoDoEstagio(com('finalizado', 'entrega'), loja), 'Entregue. Obrigado pela compra!');
  /* WhatsApp e ficha */
  assert.match(R.mensagemParaCliente(loja, com('pago')), /Recebemos seu pedido \(pedido nº 31\) e ele já está na fila\. Fica separado em cerca de 20 minutos\./);
  assert.match(R.mensagemParaCliente(loja, com('producao')), /já está sendo separado\. Logo fica pronto para retirar\./);
  assert.match(R.mensagemParaCliente(loja, com('finalizado')), /Obrigado pela compra!/);
  assert.match(R.mensagemDoCliente(loja, p), /\*nº 31\*/);
  const ficha = R.fichaDoPedido(loja, p);
  assert.match(ficha, /PEDIDO Nº 31/);
  assert.match(ficha, /RETIRADA NA LOJA/);
  /* nada de comida em nenhum texto do pedido */
  const todos = ['aguardando_pagamento', 'pago', 'producao', 'pronto', 'finalizado', 'cancelado'].map((s) => [
    R.mensagemParaCliente(loja, com(s)), R.mensagemParaCliente(loja, com(s, 'entrega')), R.textoDoEstagio(com(s), loja), R.textoDoEstagio(com(s, 'entrega'), loja),
    R.rotuloStatus(com(s)), R.rotuloStatusCliente(com(s)), R.rotuloProximoPasso(com(s)), R.rotuloAvisoWhats(com(s)),
  ].join(' ')).join(' ') + ' ' + ficha + ' ' + R.mensagemDoCliente(loja, p);
  ['senha', 'cozinha', 'preparando', 'preparado', 'apetite', 'balcão', 'cardápio'].forEach((w) => assert.ok(todos.toLowerCase().indexOf(w) < 0, w));
  /* a loja sem marca no pedido (pedido antigo) ainda acerta pela loja */
  const antigo = Object.assign({}, p); delete antigo.segmento;
  assert.match(R.mensagemParaCliente(loja, Object.assign(antigo, { status: 'pago' })), /pedido nº 31/);
  /* retirada desligada: o aviso fala da loja */
  assert.throws(() => R.montarPedido(Object.assign({}, loja, { aceitaRetirada: false }), { nome: 'Bia', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }] }), /A retirada na loja está indisponível agora\./);
});

test('comida: o pedido segue sem marca e com os textos de sempre', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1 }] });
  assert.equal('segmento' in p, false);
  p.senha = 5;
  assert.equal(R.rotuloStatus(Object.assign({}, p, { status: 'pago' })), 'Novo, preparar');
  assert.equal(R.refPedido(p), 'senha 5');
  assert.match(R.fichaDoPedido(loja, p), /SENHA 5[\s\S]*RETIRADA NO BALCÃO/);
  assert.equal(R.textoDoEstagio(Object.assign({}, p, { status: 'finalizado' }), loja), 'Retirado. Bom apetite!');
});

test('estoque no site: o cartao soma os tamanhos e o carrinho se ajusta ao que tem', () => {
  const loja = Object.assign(lojaDeTeste(), { tipo: 'Roupas' });
  loja.produtos[0].controlaEstoque = true; /* X-Burguer com tamanho P e G */
  loja.produtos[2].controlaEstoque = true; /* Refri sem tamanho */
  const x = loja.produtos[0], refri = loja.produtos[2];
  assert.deepEqual(R.situacaoDoProduto(loja, x, { 'x|p': 1, 'x|g': 1 }), { tem: 2, esgotado: false, pouco: true });
  assert.deepEqual(R.situacaoDoProduto(loja, x, { 'x|p': 0 }), { tem: 0, esgotado: true, pouco: false });
  assert.deepEqual(R.situacaoDoProduto(loja, x, { 'x|p': 10, 'x|g': 2 }), { tem: 12, esgotado: false, pouco: false });
  assert.deepEqual(R.situacaoDoProduto(loja, refri, { refri: 3 }), { tem: 3, esgotado: false, pouco: true });
  assert.equal(R.situacaoDoProduto(loja, loja.produtos[1], {}), null);
  assert.equal(R.chaveDoItem(loja, { produtoId: 'x', tamanho: 'g' }), 'x|g');
  assert.equal(R.chaveDoItem(loja, { produtoId: 'x', tamanho: { id: 'p', nome: 'P' } }), 'x|p');
  assert.equal(R.chaveDoItem(loja, { produtoId: 'refri', tamanho: 'qualquer' }), 'refri');
  assert.equal(R.chaveDoItem(lojaDeTeste(), { produtoId: 'x', tamanho: 'g' }), '');
  const carrinho = [
    { idLocal: 'a', produtoId: 'x', tamanho: 'g', quantidade: 2 },
    { idLocal: 'b', produtoId: 'x', tamanho: 'g', quantidade: 1 },
    { idLocal: 'c', produtoId: 'x', tamanho: 'p', quantidade: 1 },
    { idLocal: 'd', produtoId: 'refri', quantidade: 5 },
  ];
  const r = R.ajustarAoEstoque(loja, carrinho, { 'x|g': 2, refri: 3 });
  assert.deepEqual(r.itens.map((i) => [i.idLocal, i.quantidade]), [['a', 2], ['d', 3]]);
  assert.deepEqual(r.avisos, ['X-Burguer (G) esgotou e saiu do pedido.', 'X-Burguer (P) esgotou e saiu do pedido.', 'Só tinha 3 de Refri, então ficou 3.']);
  assert.equal(carrinho[3].quantidade, 5, 'o carrinho de quem chamou nao muda');
  assert.deepEqual(R.ajustarAoEstoque(loja, carrinho, { 'x|g': 9, 'x|p': 9, refri: 9 }).avisos, []);
  assert.deepEqual(R.catalogo(loja).iconePreparo, 'caixa');
  assert.deepEqual(R.catalogo(lojaDeTeste()).iconePreparo, 'fogo');
});

test('preco por tamanho: cada tamanho com o preco dele, o item no menor ("a partir de"), a oferta junto', () => {
  const loja = lojaDeTeste();
  const x = loja.produtos[0];
  /* sem preco por tamanho: vale o acrescimo da categoria (G +7,00) */
  assert.equal(R.precosDoTamanho(x), null);
  assert.deepEqual(R.faixaDePreco(loja, x), { de: 1800, ate: 2500 });
  /* com: P 18,00 e G 29,90 (o painel guarda no item o menor) */
  x.precosTamanho = { p: 1800, g: 2990 };
  assert.deepEqual(Object.assign({}, R.precosDoTamanho(x)), { p: 1800, g: 2990 });
  /* chave estranha no banco nao acha nada herdado */
  assert.equal(R.precosDoTamanho({ precosTamanho: { constructor: 5 } }).toString, undefined);
  assert.deepEqual(R.grupoTamanho(loja, x).opcoes.map((o) => [o.id, o.preco]), [['p', 0], ['g', 1190]]);
  assert.deepEqual(R.faixaDePreco(loja, x), { de: 1800, ate: 2990 });
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }]).subtotal, 2990);
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 2, tamanho: 'p' }]).subtotal, 3600);
  /* a categoria do outro item nao muda (o acrescimo dela continua 7,00) */
  assert.equal(loja.grupos.tamanho.opcoes[1].preco, 700);
  /* tamanho sem preco proprio (entrou depois na categoria) segue o acrescimo da categoria */
  loja.grupos.tamanho.opcoes.push({ id: 'gg', nome: 'GG', preco: 1500 });
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'gg' }]).subtotal, 3300);
  loja.grupos.tamanho.opcoes.pop();
  /* com os tamanhos que o item nao tem */
  x.tamanhosFora = ['g'];
  assert.deepEqual(R.grupoTamanho(loja, x).opcoes.map((o) => o.id), ['p']);
  assert.deepEqual(R.faixaDePreco(loja, x), { de: 1800, ate: 1800 });
  x.tamanhosFora = [];
  /* oferta: o menor cai para o preco da oferta e o G sobe junto (a diferenca do tamanho fica) */
  const agora = new Date('2026-10-06T15:00:00Z');
  x.oferta = { ate: new Date(agora.getTime() + 3600 * 1000).toISOString(), preco: 1500, some: false };
  assert.deepEqual(R.faixaDePreco(loja, x, agora), { de: 1500, ate: 2690 });
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }], { agora }).subtotal, 2690);
  /* preco torto (texto, zero, negativo) nao conta; preco menor que o do item nunca vira desconto */
  x.oferta = null;
  x.precosTamanho = { p: 'abc', g: 0 };
  assert.equal(R.precosDoTamanho(x), null);
  x.precosTamanho = { p: 1000, g: 2990 };
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'p' }]).subtotal, 1800);
  x.precosTamanho = ['p', 1000];
  assert.equal(R.precosDoTamanho(x), null);
});

test('oferta x conferencia do painel: o pedido guarda o preco da oferta; oferta criada, mudada ou tirada depois nao acende aviso', () => {
  const loja = lojaDeTeste();
  const agora = new Date('2026-10-06T15:00:00Z');
  const dados = { nome: 'Ana', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'refri', quantidade: 2 }] };
  /* pedido de antes da oferta: depois o dono cria a oferta (sem hora de comeco) e o pedido continua conferindo */
  const antes = R.montarPedido(loja, dados, agora, agora);
  assert.equal(antes.total, 1200);
  assert.equal(antes.itens[0].precoOferta, undefined);
  loja.produtos[2].oferta = { ate: new Date(agora.getTime() + 3600 * 1000).toISOString(), preco: 450, some: false };
  assert.equal(R.conferirTotal(loja, antes).ok, true);
  /* pedido na oferta: o item anota 4,50 */
  const durante = R.montarPedido(loja, dados, agora, agora);
  assert.equal(durante.total, 900);
  assert.equal(durante.itens[0].precoOferta, 450);
  assert.equal(R.conferirTotal(loja, durante).ok, true);
  /* o dono muda a oferta para 5,00 ou tira: o pedido de 4,50 continua conferindo */
  loja.produtos[2].oferta = { ate: new Date(agora.getTime() + 3600 * 1000).toISOString(), preco: 500, some: false };
  assert.equal(R.conferirTotal(loja, durante).ok, true);
  loja.produtos[2].oferta = null;
  assert.equal(R.conferirTotal(loja, durante).ok, true);
  assert.equal(R.conferirTotal(loja, antes).ok, true);
  /* e o total mexido continua acendendo */
  assert.equal(R.conferirTotal(loja, Object.assign({}, durante, { total: 100 })).ok, false);
});

test('cardapio em texto: "a partir de", oferta riscada com o fogo e item que saiu por tempo some', () => {
  const loja = lojaDeTeste();
  const agora = Date.now();
  loja.produtos[0].precosTamanho = { p: 1800, g: 2990 };
  loja.produtos[2].oferta = { ate: new Date(agora + 3600 * 1000).toISOString(), preco: 450, some: false };
  const texto = R.cardapioEmTexto(loja, 'https://ligeiropedidos.com.br/teste');
  assert.match(texto, /• X-Burguer: a partir de R\$ 18,00/);
  assert.match(texto, /• Refri: ~R\$ 6,00~ R\$ 4,50 🔥 por tempo limitado/);
  /* acabou e era "so ate la": sai da lista */
  loja.produtos[2].oferta = { ate: new Date(agora - 60 * 1000).toISOString(), some: true };
  assert.doesNotMatch(R.cardapioEmTexto(loja, ''), /Refri/);
});

test('tamanhos do item: o item tira o que nao tem; sem nenhum, vira tamanho unico', () => {
  const loja = Object.assign(lojaDeTeste(), { tipo: 'Roupas' });
  const x = loja.produtos[0];
  x.tamanhosFora = ['g'];
  assert.deepEqual(R.grupoTamanho(loja, x).opcoes.map((o) => o.id), ['p']);
  assert.deepEqual(R.gruposDoProduto(loja, x).map((g) => g.tipo + ':' + g.opcoes.map((o) => o.id).join(',')), ['unico:p', 'varios:bacon,ovo']);
  /* a categoria continua com os dois (os outros itens nao mudam) */
  assert.deepEqual(R.gruposDaCategoria(loja, 'lanche')[0].opcoes.map((o) => o.id), ['p', 'g']);
  /* pedir o tamanho que o item nao tem: recusa dizendo qual */
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }]), /Não tem mais "G" em "X-Burguer"/);
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'p' }]).itens[0].tamanho.id, 'p');
  /* o painel conferindo pedido antigo nao trava */
  assert.doesNotThrow(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }], { tolerante: true }));
  /* tira todos: o item fica sem tamanho, e o comercio nao pede tamanho nenhum */
  x.tamanhosFora = ['p', 'g'];
  assert.equal(R.grupoTamanho(loja, x), null);
  assert.deepEqual(R.gruposDoProduto(loja, x).map((g) => g.tipo), ['varios']);
  const unico = R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1 }]);
  assert.equal(unico.itens[0].tamanho, null);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'p' }]), /Não tem mais "P"/);
  /* estoque do item sem tamanho: uma quantidade so */
  x.controlaEstoque = true;
  assert.equal(R.chaveDoItem(loja, { produtoId: 'x', tamanho: 'p' }), 'x');
  assert.deepEqual(R.situacaoDoProduto(loja, x, { x: 2 }), { tem: 2, esgotado: false, pouco: true });
  /* comida: o padrao que o item nao tem cai no primeiro que ele tem */
  const comida = lojaDeTeste();
  comida.produtos[0].tamanhosFora = ['p'];
  assert.equal(R.calcularItens(comida, [{ produtoId: 'x', quantidade: 1 }]).itens[0].tamanho.id, 'g');
  /* o cartao soma so os tamanhos que o item tem */
  const l2 = Object.assign(lojaDeTeste(), { tipo: 'Roupas' });
  l2.produtos[0].controlaEstoque = true; l2.produtos[0].tamanhosFora = ['p'];
  assert.deepEqual(R.situacaoDoProduto(l2, l2.produtos[0], { 'x|p': 9, 'x|g': 0 }), { tem: 0, esgotado: true, pouco: false });
  /* lista torta (texto, numero) nao derruba nada */
  l2.produtos[0].tamanhosFora = 'g';
  assert.deepEqual(R.grupoTamanho(l2, l2.produtos[0]).opcoes.map((o) => o.id), ['p', 'g']);
});

test('por tempo limitado: preco da oferta ate a hora, depois some ou volta ao normal; o pedido confere pela hora dele', () => {
  const loja = lojaDeTeste();
  const agora = new Date('2026-10-06T15:00:00Z');
  const fim = new Date(agora.getTime() + 2 * 3600 * 1000).toISOString();
  loja.produtos[2].oferta = { ate: fim, preco: 450, some: false }; /* Refri: de 6,00 por 4,50 ate daqui a 2 h, depois volta */
  loja.produtos[0].oferta = { ate: fim, some: true };              /* X-Burguer: so ate daqui a 2 h (sem preco: so o selo) */
  assert.deepEqual(R.ofertaAtiva(loja.produtos[2], agora), { fim: Date.parse(fim), preco: 450, some: false });
  assert.equal(R.precoDoProduto(loja.produtos[2], agora), 450);
  assert.equal(R.precoDoProduto(loja.produtos[0], agora), 1800);
  /* durante: o pedido cobra o preco da oferta */
  const durante = R.calcularItens(loja, [{ produtoId: 'refri', quantidade: 2 }], { agora });
  assert.equal(durante.subtotal, 900);
  /* depois: o refri volta ao normal e o X-Burguer sai (o pedido recusa, a lista nao mostra) */
  const depois = new Date(agora.getTime() + 3 * 3600 * 1000);
  assert.equal(R.calcularItens(loja, [{ produtoId: 'refri', quantidade: 2 }], { agora: depois }).subtotal, 1200);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1 }], { agora: depois }), /era por tempo limitado e acabou/);
  assert.ok(R.produtosAtivos(loja, agora).some((p) => p.id === 'x'));
  assert.ok(!R.produtosAtivos(loja, depois).some((p) => p.id === 'x'));
  assert.ok(R.produtosAtivos(loja, depois).some((p) => p.id === 'refri'));
  /* o pedido feito durante a oferta confere pela hora dele (o painel nao acende "valor nao confere" depois) */
  const pedido = R.montarPedido(loja, { nome: 'Ana', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'refri', quantidade: 2 }] }, agora, agora);
  assert.equal(pedido.subtotal, 900);
  assert.equal(R.conferirTotal(loja, pedido).ok, true);
  /* preco da oferta maior ou igual ao do item nao vale (nada de "oferta" mais cara) */
  loja.produtos[2].oferta = { ate: fim, preco: 600 };
  assert.equal(R.precoDoProduto(loja.produtos[2], agora), 600);
  assert.equal(R.ofertaAtiva(loja.produtos[2], agora).preco, 0);
  /* oferta torta (sem data, texto) nao muda nada */
  loja.produtos[2].oferta = { ate: 'amanha' };
  assert.equal(R.ofertaAtiva(loja.produtos[2], agora), null);
  assert.equal(R.saiuPorTempo(loja.produtos[2], depois), false);
  /* o prazo para o cliente ler */
  assert.equal(R.textoDoPrazo(agora.getTime() + 30 * 1000, agora), 'Últimos minutos');
  assert.equal(R.textoDoPrazo(agora.getTime() + 12 * 60 * 1000, agora), 'Acaba em 12 min');
  assert.equal(R.textoDoPrazo(agora.getTime() + (2 * 60 + 15) * 60 * 1000, agora), 'Acaba em 2h 15min');
  assert.equal(R.textoDoPrazo(agora.getTime() + 3 * 60 * 60 * 1000, agora), 'Acaba em 3h');
  assert.match(R.textoDoPrazo(agora.getTime() + 3 * 24 * 3600 * 1000, agora), /^Até (dom|seg|ter|qua|qui|sex|sáb)\., \d\d:\d\d$/);
  assert.match(R.textoDoPrazo(agora.getTime() + 9 * 24 * 3600 * 1000, agora), /^Até \d\d\/\d\d, \d\d:\d\d$/);
  /* o curto (selo do cartao no celular estreito): o mesmo prazo, sem a hora e sem os minutos */
  var manha = new Date(2026, 9, 6, 9, 0, 0);
  assert.equal(R.textoDoPrazo(manha.getTime() + 30 * 1000, manha, true), 'Últimos minutos');
  assert.equal(R.textoDoPrazo(manha.getTime() + 12 * 60 * 1000, manha, true), 'Faltam 12 min');
  assert.equal(R.textoDoPrazo(new Date(2026, 9, 6, 23, 59).getTime(), manha, true), 'Acaba hoje');
  assert.equal(R.textoDoPrazo(new Date(2026, 9, 7, 8, 0).getTime(), manha, true), 'Acaba amanhã');
  assert.match(R.textoDoPrazo(manha.getTime() + 3 * 24 * 3600 * 1000, manha, true), /^Até (dom|seg|ter|qua|qui|sex|sáb)\.$/);
  assert.equal(R.textoDoPrazo(new Date(2026, 9, 20, 18, 0).getTime(), manha, true), 'Até 20/10');
});

test('tipo visivel: "Outra comida" e "Outro comercio" mostram o nome livre', () => {
  assert.equal(R.tipoVisivel({ tipo: 'Outro comércio', tipoNome: 'Papelaria' }), 'Papelaria');
  assert.equal(R.tipoVisivel({ tipo: 'Outra comida', tipoNome: '  Tapiocaria ' }), 'Tapiocaria');
  assert.equal(R.tipoVisivel({ tipo: 'Outro comércio' }), 'Loja');
  assert.equal(R.tipoVisivel({ tipo: 'Outro' }), 'Loja');
  assert.equal(R.tipoVisivel({ tipo: 'Roupas', tipoNome: 'Ignorado' }), 'Roupas');
  assert.equal(R.tipoVisivel({ tipo: '' }), 'Loja');
});

test('Google: o selo mostra o perfil e o convite abre a tela de avaliar', () => {
  assert.equal(R.linkGooglePerfil('https://g.page/r/CabcDEF123/review'), 'https://g.page/r/CabcDEF123');
  assert.equal(R.linkGoogleAvaliar('g.page/r/CabcDEF123'), 'https://g.page/r/CabcDEF123/review');
  assert.equal(R.linkGoogleAvaliar('https://maps.app.goo.gl/xyz'), 'https://maps.app.goo.gl/xyz');
  assert.equal(R.linkGooglePerfil('https://maps.app.goo.gl/xyz'), 'https://maps.app.goo.gl/xyz');
  assert.equal(R.linkGoogleAvaliar('https://outro.site/g.page/r/x/review'), '');
  const loja = Object.assign(lojaDeTeste(), { googleUrl: 'https://g.page/r/Cab123/review' });
  const p = R.montarPedido(loja, { nome: 'Ana', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'dinheiro_entrega', endereco: { rua: 'Rua A', numero: '1', bairro: 'Centro' }, itens: [{ produtoId: 'x', quantidade: 1 }] });
  p.senha = 3; p.status = 'finalizado';
  assert.match(R.mensagemParaCliente(loja, p), /deixe sua avaliação no Google, ajuda muito a gente: https:\/\/g\.page\/r\/Cab123\/review$/);
  assert.match(R.mensagemParaCliente(lojaDeTeste(), p), /Qualquer coisa, é só chamar aqui\.$/);
});

test('resumo de vendas ignora cancelados e aguardando', () => {
  const agora = new Date(2026, 8, 13, 21, 0);
  const iso = (d) => new Date(2026, 8, d, 19, 0).toISOString();
  const pedidos = [
    { status: 'finalizado', total: 3000, criadoEm: iso(13), formaPagamento: 'pix', itens: [{ nome: 'X', quantidade: 2 }] },
    { status: 'pago', total: 2000, criadoEm: iso(12), formaPagamento: 'pix', itens: [{ nome: 'Y', quantidade: 1 }] },
    { status: 'cancelado', total: 9000, criadoEm: iso(13), formaPagamento: 'pix', itens: [] },
    { status: 'aguardando_pagamento', total: 9000, criadoEm: iso(13), formaPagamento: 'pix', itens: [] },
    { status: 'finalizado', total: 1000, criadoEm: iso(1), formaPagamento: 'pix', itens: [] },
  ];
  const r = R.resumoVendas(pedidos, 7, agora);
  assert.equal(r.pedidos, 2);
  assert.equal(r.total, 5000);
  assert.equal(r.ticketMedio, 2500);
  assert.equal(r.maisVendidos[0].nome, 'X');
});

test('cardápio em texto lista só itens ativos, por categoria, com link no fim', () => {
  const loja = lojaDeTeste();
  loja.produtos.push({ id: 'off', categoria: 'lanche', nome: 'Sumido', preco: 100, ativo: false });
  const texto = R.cardapioEmTexto(loja, 'https://exemplo.com/#/juquia/teste');
  assert.match(texto, /^\*Loja Teste\*/);
  assert.match(texto, /\*LANCHES\*/);
  /* o X-Burguer tem o tamanho G (+7,00): o preco muda com o tamanho, vai "a partir de"; o Refri tem preco unico */
  assert.match(texto, /• X-Burguer: a partir de R\$ 18,00/);
  assert.match(texto, /• Refri: R\$ 6,00/);
  assert.doesNotMatch(texto, /Sumido/);
  assert.match(texto, /Entrega: R\$ 5,00, grátis a partir de R\$ 60,00/);
  assert.match(R.cardapioEmTexto(Object.assign({}, loja, { freteGratis: true }), ''), /Entrega grátis/);
  assert.match(texto, /https:\/\/exemplo\.com\/#\/juquia\/teste$/);
});

test('comparador de custos: iFood por porcentagem, Anota AI por faixa, Ligeiro fixo mais o Pix do Mercado Pago', () => {
  const c = R.compararCustos(500000, 200);
  assert.equal(c.ifoodBasico, 76000 + 11000);
  assert.equal(c.ifoodEntrega, 131000 + 15000); // 26,2% (23% + 3,2% do pagamento online)
  assert.equal(c.anotaAi, 19999);
  assert.equal(c.ligeiroMensal, 8900); // sem config, o preco normal do plano unico (R$ 89)
  assert.equal(c.ligeiroPix, 4950); // 0,99% de R$ 5.000 (o Pix do Mercado Pago, pago direto a ele)
  assert.equal(c.ligeiro, 8900 + 4950);
  assert.equal(R.compararCustos(0, 0).ligeiro, 8900);
  const pequena = R.compararCustos(150000, 40);
  assert.equal(pequena.ifoodBasico, 22800);
  assert.equal(pequena.ifoodMensalidade, false);
  assert.equal(pequena.anotaAi, 9999);
  assert.equal(R.compararCustos(0, 300).anotaAi, 29999);
});

test('categoria com dois grupos de adicionais cobra os dois; balcão pode retirar e pagar no caixa', () => {
  const loja = lojaDeTeste();
  loja.grupos = {
    extras: { titulo: 'Extras', tipo: 'varios', opcoes: [{ id: 'bacon', nome: 'Bacon', preco: 400 }] },
    molhos: { titulo: 'Molhos', tipo: 'varios', max: 1, opcoes: [{ id: 'barbecue', nome: 'Barbecue', preco: 200 }, { id: 'mostarda', nome: 'Mostarda', preco: 200 }] },
  };
  loja.gruposPorCategoria = { lanche: ['extras', 'molhos'] };
  const c = R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, adicionais: ['bacon', 'barbecue'] }]);
  assert.equal(c.itens[0].precoUnitario, 1800 + 400 + 200);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, adicionais: ['barbecue', 'mostarda'] }]), /Máximo de 1/);
  loja.aceitaRetirada = false;
  loja.aceitaPagarNoBalcao = false;
  const p = R.montarPedido(loja, { origem: 'balcao', tipoEntrega: 'retirada', formaPagamento: 'dinheiro_entrega', trocoPara: 0, itens: [{ produtoId: 'x', quantidade: 1 }] });
  assert.equal(p.formaPagamento, 'dinheiro_entrega');
  assert.equal(p.status, 'pago');
});

test('planoQueVale: pago vale o plano confirmado pelo admin, gratis vale o escolhido', () => {
  const antes = global.window;
  global.window = { LIGEIRO_CONFIG: { planos: [{ id: 'uma', lojas: 1, mensal: 7900, anual: 79000 }, { id: 'cinco', lojas: 5, mensal: 29900, anual: 299000 }] } };
  try {
  assert.equal(R.planoQueVale({ plano: { status: 'teste', planoId: 'cinco' } }), 'cinco');
  assert.equal(R.planoQueVale({ plano: { status: 'ativo', planoId: 'cinco', planoPago: 'uma' } }), 'uma');
  assert.equal(R.planoQueVale({ plano: { status: 'ativo', planoId: 'cinco' } }), 'cinco');
  assert.equal(R.planoQueVale(null), 'uma');
  } finally { global.window = antes; }
});

test('preco de fundador: vale enquanto houver vaga e pra quem ja travou; depois, preco normal', () => {
  const antes = global.window;
  const planos = [{ id: 'uma', lojas: 1, mensal: 8900, anual: 89000, fundador: { mensal: 7900, anual: 79000 } }];
  try {
    global.window = { LIGEIRO_CONFIG: { planos, fundador: { vagas: 20 } }, LigeiroFundadores: { usados: 3 } };
    assert.equal(R.vagasFundador(), 17);
    assert.equal(R.precoDoPlano('uma', 'mensal'), 7900);
    assert.equal(R.precoDoPlano('uma', 'anual', { plano: { status: 'teste' } }), 79000);
    /* ja pagou sem ser fundador: preco normal, mesmo com vaga sobrando */
    assert.equal(R.precoDoPlano('uma', 'mensal', { plano: { status: 'ativo', planoPago: 'uma', ultimoPagamentoEm: '2026-09-01' } }), 8900);
    global.window.LigeiroFundadores = { usados: 20 };
    assert.equal(R.vagasFundador(), 0);
    assert.equal(R.precoDoPlano('uma', 'mensal'), 8900);
    /* quem travou continua no preco de fundador pra sempre */
    assert.equal(R.precoDoPlano('uma', 'mensal', { plano: { status: 'ativo', fundador: true, ultimoPagamentoEm: '2026-09-01' } }), 7900);
  } finally { global.window = antes; }
});

test('conta do proprio Ligeiro: cortesia permanente e sem limite de lojas', () => {
  const antes = global.window;
  try {
    global.window = { LIGEIRO_CONFIG: { adminEmail: 'ligeiro@exemplo.com', planos: [{ id: 'uma', lojas: 1, mensal: 8900, anual: 89000 }] } };
    const conta = { email: 'Ligeiro@Exemplo.com', plano: { status: 'teste', desde: '2020-01-01T00:00:00Z' } };
    assert.equal(R.assinatura(conta).estado, 'ativa');
    assert.equal(R.assinatura(conta).cortesia, true);
    assert.equal(R.limiteDeLojas(conta), 999);
    assert.equal(R.lojaBloqueada({ donoEmail: 'ligeiro@exemplo.com', plano: { status: 'teste', desde: '2020-01-01T00:00:00Z' } }), false);
    assert.equal(R.limiteDeLojas({ email: 'outro@exemplo.com', plano: { status: 'teste', planoId: 'uma' } }), 1);
  } finally { global.window = antes; }
});

test('vagas de fundador: as ja ocupadas (Dom Conizza) saem da conta', () => {
  const antes = global.window;
  try {
    global.window = { LIGEIRO_CONFIG: { fundador: { vagas: 20, jaOcupadas: 1 } }, LigeiroFundadores: { usados: 2 } };
    assert.equal(R.vagasFundador(), 17);
  } finally { global.window = antes; }
});

test('catalogo: comida fala cardapio, o resto fala catalogo', () => {
  assert.equal(R.catalogo({ tipo: 'Pizzaria' }).nome, 'cardápio');
  assert.equal(R.catalogo({ tipo: 'Pizza cone' }).nome, 'cardápio');
  assert.equal(R.catalogo({}).nome, 'cardápio');
  /* o "Outro" antigo do cadastro ficava entre as comidas (garfo e faca): continua comida */
  assert.equal(R.catalogo({ tipo: 'Outro' }).nome, 'cardápio');
  assert.equal(R.catalogo({ tipo: 'Roupas' }).Nome, 'Catálogo');
  assert.equal(R.catalogo({ tipo: 'Outro comércio' }).nome, 'catálogo');
});

test('segmento: comida e comercio, com o vocabulario de cada um', () => {
  ['Lanchonete', 'Pizzaria', 'Outra comida', 'Outro', '', 'Qualquer coisa'].forEach((tipo) => assert.equal(R.segmento({ tipo }), 'comida', tipo));
  R.TIPOS_DE_COMERCIO.forEach((t) => assert.equal(R.segmento({ tipo: t[0] }), 'comercio', t[0]));
  assert.equal(R.segmento({ tipo: '  roupas ' }), 'comercio');
  const c = R.catalogo({ tipo: 'Calçados' }), f = R.catalogo({ tipo: 'Pizzaria' });
  assert.equal(c.preparando, 'Separando'); assert.equal(f.preparando, 'Preparando');
  assert.equal(c.tela, 'Separação'); assert.equal(f.tela, 'Cozinha');
  assert.equal(c.maisPedidos, 'Os mais vendidos');
  /* nenhum texto do comercio fala de comida */
  const textos = Object.keys(c).map((k) => String(c[k])).join(' ').toLowerCase();
  ['cozinha', 'cardápio', 'preparo', 'fome', 'lanche', 'cebola'].forEach((w) => assert.ok(textos.indexOf(w) < 0, w));
});

test('comercio: o tamanho e escolha do cliente (sem tamanho padrao); comida segue com o padrao', () => {
  const loja = Object.assign(lojaDeTeste(), { tipo: 'Roupas' });
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1 }]), /Escolha o tamanho de "X-Burguer"/);
  const ok = R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }]);
  assert.equal(ok.itens[0].tamanho.id, 'g');
  /* o painel conferindo pedido ja feito (tolerante) nao trava */
  assert.doesNotThrow(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1 }], { tolerante: true }));
  const comida = R.calcularItens(lojaDeTeste(), [{ produtoId: 'x', quantidade: 1 }]);
  assert.equal(comida.itens[0].tamanho.id, 'p');
  /* categoria sem tamanho: nada a escolher */
  assert.doesNotThrow(() => R.calcularItens(loja, [{ produtoId: 'refri', quantidade: 1 }]));
});

test('estoque: chaves por produto e por tamanho, o que o pedido tira e o que falta', () => {
  const loja = Object.assign(lojaDeTeste(), { tipo: 'Roupas' });
  loja.produtos[0].controlaEstoque = true; /* X-Burguer: tem tamanho, entao o estoque e por tamanho */
  loja.produtos[2].controlaEstoque = true; /* Refri: sem tamanho, estoque do produto */
  const { itens } = R.calcularItens(loja, [
    { produtoId: 'x', quantidade: 2, tamanho: 'g' }, { produtoId: 'x', quantidade: 1, tamanho: 'g' }, { produtoId: 'x', quantidade: 1, tamanho: 'p' }, { produtoId: 'refri', quantidade: 3 },
  ]);
  assert.deepEqual(R.estoqueDoPedido(loja, itens), { 'x|g': 3, 'x|p': 1, refri: 3 });
  assert.deepEqual(R.faltaNoEstoque(loja, itens, { 'x|g': 3, 'x|p': 1, refri: 3 }), []);
  const falta = R.faltaNoEstoque(loja, itens, { 'x|g': 2, refri: 5 });
  assert.deepEqual(falta.map((f) => [f.chave, f.pediu, f.tem]), [['x|g', 3, 2], ['x|p', 1, 0]]);
  assert.equal(R.fraseFaltaEstoque(falta), 'Só tem 2 de X-Burguer (G). X-Burguer (P) esgotou.');
  /* produto sem controle nao entra na conta */
  loja.produtos[2].controlaEstoque = false;
  assert.equal(R.estoqueDoPedido(loja, itens).refri, undefined);
  /* o que o site mostra */
  assert.equal(R.situacaoEstoque({ id: 'a' }, { a: 0 }), null);
  assert.deepEqual(R.situacaoEstoque({ id: 'a', controlaEstoque: true }, { a: 0 }), { tem: 0, esgotado: true, pouco: false });
  assert.deepEqual(R.situacaoEstoque({ id: 'a', controlaEstoque: true }, { 'a|m': 2 }, 'm'), { tem: 2, esgotado: false, pouco: true });
  assert.deepEqual(R.situacaoEstoque({ id: 'a', controlaEstoque: true }, { a: 9 }), { tem: 9, esgotado: false, pouco: false });
  assert.deepEqual(R.situacaoEstoque({ id: 'a', controlaEstoque: true }, {}), { tem: 0, esgotado: true, pouco: false });
});

test('pixVencido: 30 min do codigo, 35 min sem codigo, so pedido esperando Pix', () => {
  const agora = new Date('2026-09-18T12:00:00Z');
  const base = { status: 'aguardando_pagamento', formaPagamento: 'pix', criadoEm: '2026-09-18T11:40:00Z' };
  assert.equal(R.pixVencido(Object.assign({}, base, { pixExpiraEm: '2026-09-18T11:59:00Z' }), agora), true);
  assert.equal(R.pixVencido(Object.assign({}, base, { pixExpiraEm: '2026-09-18T12:10:00Z' }), agora), false);
  assert.equal(R.pixVencido(base, agora), false);
  assert.equal(R.pixVencido(Object.assign({}, base, { criadoEm: '2026-09-18T11:20:00Z' }), agora), true);
  assert.equal(R.pixVencido(Object.assign({}, base, { status: 'pago', pixExpiraEm: '2026-09-18T11:00:00Z' }), agora), false);
});

test('planoQueVale: periodo pago correndo vale o plano PAGO mesmo depois de encerrar e reativar', () => {
  const antes = global.window;
  try {
    global.window = { LIGEIRO_CONFIG: { planos: [{ id: 'uma', lojas: 1, mensal: 8900, anual: 89000 }, { id: 'duas', lojas: 2, mensal: 15900, anual: 159000 }, { id: 'oito', lojas: 8, mensal: 47900, anual: 479000 }] } };
    const futuro = new Date(Date.now() + 10 * 864e5).toISOString();
    const passado = new Date(Date.now() - 10 * 864e5).toISOString();
    assert.equal(R.planoQueVale({ plano: { status: 'teste', planoId: 'oito', planoPago: 'uma', pagoAte: futuro } }), 'uma');
    assert.equal(R.planoQueVale({ plano: { status: 'ativo', planoId: 'oito', planoPago: 'uma', pagoAte: futuro } }), 'uma');
    assert.equal(R.planoQueVale({ plano: { status: 'teste', planoId: 'duas', planoPago: 'uma', pagoAte: passado } }), 'duas');
    assert.equal(R.planoQueVale({ plano: { status: 'teste', planoId: 'duas' } }), 'duas');
  } finally { global.window = antes; }
});

test('CNPJ: confere os digitos, aceita com ou sem pontuacao e formata', () => {
  assert.equal(R.cnpjValido('11.222.333/0001-81'), '11222333000181');
  assert.equal(R.cnpjValido('11222333000181'), '11222333000181');
  assert.equal(R.cnpjValido('11.222.333/0001-80'), '');
  assert.equal(R.cnpjValido('00000000000000'), '');
  assert.equal(R.cnpjValido(''), '');
  assert.equal(R.cnpjValido('123'), '');
  assert.equal(R.formatarCnpj('11222333000181'), '11.222.333/0001-81');
});

test('fecha as: fim da faixa de agora, inclusive a que vira a noite', () => {
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const todos = (faixas) => { const h = {}; DIAS.forEach((d) => { h[d] = faixas; }); return h; };
  const as = (hh, mm) => new Date(2026, 8, 21, hh, mm);
  const loja = { usarHorarios: true, horarios: todos(['11:00-14:00', '18:00-23:00']) };
  assert.equal(R.fechamentoDeHoje(loja, as(12, 0)), '14:00');
  assert.equal(R.fechamentoDeHoje(loja, as(20, 30)), '23:00');
  assert.equal(R.fechamentoDeHoje(loja, as(15, 0)), null);
  const noite = { usarHorarios: true, horarios: todos(['18:00-02:00']) };
  assert.equal(R.fechamentoDeHoje(noite, as(23, 0)), '02:00');
  assert.equal(R.fechamentoDeHoje(noite, as(1, 0)), '02:00');
  assert.equal(R.fechamentoDeHoje(noite, as(3, 0)), null);
  assert.equal(R.fechamentoDeHoje({ usarHorarios: false, horarios: todos(['18:00-23:00']) }, as(20, 0)), null);
});

test('abrir agora: fora do horario a chave abre na hora e o horario segue depois (Dom Conizza, 07/10/2026)', () => {
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const todos = (faixas) => { const h = {}; DIAS.forEach((d) => { h[d] = faixas; }); return h; };
  const as = (dia, hh, mm) => new Date(2026, 9, dia, hh, mm); /* outubro de 2026: o dia 7 e uma quarta */
  const loja = { aberta: true, usarHorarios: true, horarios: todos(['18:00-23:00']) };
  /* 17:00, horario das 18:00 as 23:00: fechada; o "Abrir agora" vai ate as 18:00 e dali o horario segue ate as 23:00 */
  assert.equal(R.lojaAberta(loja, as(7, 17, 0)), false);
  assert.equal(R.proximaAbertura(loja, as(7, 17, 0)), '18:00');
  const fim = R.fimDeAbrirAgora(loja, as(7, 17, 0));
  assert.equal(fim.getTime(), as(7, 18, 0).getTime());
  const aberta = Object.assign({}, loja, { abertaAte: fim.toISOString() });
  assert.equal(R.lojaAberta(aberta, as(7, 17, 0)), true);
  assert.equal(R.lojaAberta(aberta, as(7, 17, 59)), true);
  assert.equal(R.lojaAberta(aberta, as(7, 18, 30)), true, 'dali em diante, o horario de sempre');
  assert.equal(R.lojaAberta(aberta, as(7, 23, 10)), false, 'fecha no fim do horario, como sempre');
  assert.equal(R.fechamentoDeHoje(aberta, as(7, 17, 0)), '23:00');
  assert.equal(R.abertaForaDoHorario(aberta, as(7, 17, 0)), true);
  assert.equal(R.abertaForaDoHorario(aberta, as(7, 18, 0)), false);
  /* a chave desligada manda mais que tudo */
  assert.equal(R.lojaAberta(Object.assign({}, aberta, { aberta: false }), as(7, 17, 0)), false);
  assert.equal(R.fechamentoDeHoje(Object.assign({}, aberta, { aberta: false }), as(7, 17, 0)), null);
  /* dentro do horario ou sem horario cadastrado: a chave ja abre sozinha, nao precisa */
  assert.equal(R.fimDeAbrirAgora(loja, as(7, 19, 0)), null);
  assert.equal(R.fimDeAbrirAgora({ aberta: true, usarHorarios: false, horarios: todos(['18:00-23:00']) }, as(7, 17, 0)), null);
  /* depois do horario, sem faixa pela frente no mesmo dia de trabalho: ate a virada das 5 h */
  const tarde = R.fimDeAbrirAgora(loja, as(7, 23, 30));
  assert.equal(tarde.getTime(), as(8, 5, 0).getTime());
  assert.equal(R.fechamentoDeHoje(Object.assign({}, loja, { abertaAte: tarde.toISOString() }), as(7, 23, 30)), '05:00');
  assert.equal(R.fimDeAbrirAgora(loja, as(8, 2, 0)).getTime(), as(8, 5, 0).getTime(), 'de madrugada a virada e a das 5 h de hoje');
  /* faixa que vira a noite: abre antes e segue ate o fim dela */
  const noite = { aberta: true, usarHorarios: true, horarios: todos(['18:00-02:00']) };
  const n = Object.assign({}, noite, { abertaAte: R.fimDeAbrirAgora(noite, as(7, 17, 0)).toISOString() });
  assert.equal(R.fechamentoDeHoje(n, as(7, 17, 0)), '02:00');
  /* faixa que comeca de madrugada (padaria das 04:00): vai ate ela, e ela segue */
  const padaria = { aberta: true, usarHorarios: true, horarios: todos(['04:00-12:00']) };
  assert.equal(R.fimDeAbrirAgora(padaria, as(7, 23, 0)).getTime(), as(8, 4, 0).getTime());
  /* dia de folga (sem faixa hoje): ate a virada */
  const folga = { aberta: true, usarHorarios: true, horarios: { qui: ['18:00-23:00'] } };
  assert.equal(R.fimDeAbrirAgora(folga, as(7, 14, 0)).getTime(), as(8, 5, 0).getTime());
  /* passou da hora: volta para o horario de sempre; valor torto nao abre nada */
  assert.equal(R.lojaAberta(Object.assign({}, loja, { abertaAte: as(7, 16, 0).toISOString() }), as(7, 17, 0)), false);
  assert.equal(R.lojaAberta(Object.assign({}, loja, { abertaAte: 'amanha' }), as(7, 17, 0)), false);
  assert.equal(R.lojaAberta(Object.assign({}, loja, { abertaAte: 123 }), as(7, 17, 0)), false);
});

test('abrir agora no mensageiro: o horario pela hora da loja (agora) e o "Abrir agora" pelo instante de verdade', () => {
  const as = (hh, mm) => new Date(2026, 9, 7, hh, mm);
  const loja = Object.assign(lojaDeTeste(), { usarHorarios: true, horarios: { qua: ['18:00-23:00'] }, abertaAte: as(18, 0).toISOString() });
  const dados = {
    nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'pix',
    endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'perto da praça' },
    itens: [{ produtoId: 'x', quantidade: 1 }],
  };
  assert.equal(R.montarPedido(loja, dados, as(17, 0), as(17, 0)).status, R.STATUS.AGUARDANDO);
  /* sem o instante (no site), o agora vale para os dois */
  assert.equal(R.montarPedido(loja, dados, as(17, 30)).status, R.STATUS.AGUARDANDO);
  /* o "Abrir agora" conta pelo instante: ja passou dele, e fora do horario a loja recusa */
  assert.throws(() => R.montarPedido(loja, dados, as(17, 0), as(18, 30)), /fechada/);
  assert.throws(() => R.montarPedido(Object.assign({}, loja, { abertaAte: '' }), dados, as(17, 0), as(17, 0)), /fechada/);
});

test('texto que ja fala da cidade: palavra inteira, sem acento e sem maiuscula', () => {
  assert.equal(R.mencionaCidade('Lanchonete em Juquiá', 'Juquiá'), true);
  assert.equal(R.mencionaCidade('PIZZARIA EM JUQUIA', 'Juquiá'), true);
  assert.equal(R.mencionaCidade('O melhor lanche de Sete Barras!', 'Sete Barras'), true);
  assert.equal(R.mencionaCidade('Pizza cone quentinha na sua porta', 'Juquiá'), false);
  assert.equal(R.mencionaCidade('Juquiazinho Lanches', 'Juquiá'), false);
  assert.equal(R.mencionaCidade('', 'Juquiá'), false);
  assert.equal(R.mencionaCidade('Lanchonete em Juquiá', ''), false);
});

test('link do Google: aceita Maps, busca e links de compartilhar; recusa qualquer outro site', () => {
  assert.equal(R.linkGoogle('https://maps.app.goo.gl/AbC123'), 'https://maps.app.goo.gl/AbC123');
  assert.equal(R.linkGoogle('  maps.app.goo.gl/AbC123 '), 'https://maps.app.goo.gl/AbC123');
  assert.equal(R.linkGoogle('http://maps.google.com/?cid=123'), 'https://maps.google.com/?cid=123');
  assert.equal(R.linkGoogle('https://www.google.com/maps/place/Dom+Conizza/@-24.3,-47.6,17z'), 'https://www.google.com/maps/place/Dom+Conizza/@-24.3,-47.6,17z');
  assert.equal(R.linkGoogle('https://www.google.com.br/search?q=dom+conizza'), 'https://www.google.com.br/search?q=dom+conizza');
  assert.equal(R.linkGoogle('https://g.page/r/CQx9/review'), 'https://g.page/r/CQx9/review');
  assert.equal(R.linkGoogle('https://share.google/xyz'), 'https://share.google/xyz');
  assert.equal(R.linkGoogle('https://goo.gl/maps/abc'), 'https://goo.gl/maps/abc');
  assert.equal(R.linkGoogle('https://goo.gl/abc'), '');
  assert.equal(R.linkGoogle('https://google.com.golpe.com/x'), '');
  assert.equal(R.linkGoogle('https://google.com@golpe.com/'), '');
  assert.equal(R.linkGoogle('https://golpe.com/?u=google.com'), '');
  assert.equal(R.linkGoogle('javascript:alert(1)'), '');
  assert.equal(R.linkGoogle('https://maps.app.goo.gl/a b'), '');
  assert.equal(R.linkGoogle(''), '');
  assert.equal(R.linkGoogle(null), '');
});

test('opcao desligada com o item no carrinho e recusada (nao troca calada)', () => {
  const loja = lojaDeTeste();
  loja.grupos.tamanho.opcoes[1].ativo = false; /* G desligado */
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }]), /Não tem mais "G" em "X-Burguer"/);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, adicionais: ['off'] }]), /Não tem mais "Desligado" em "X-Burguer"/);
  assert.throws(() => R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, adicionais: ['apagado'] }]), /Uma opção escolhida em "X-Burguer" acabou/);
  /* grupo inteiro desligado */
  const semExtras = lojaDeTeste();
  semExtras.grupos.extras.opcoes.forEach((o) => { o.ativo = false; });
  assert.throws(() => R.calcularItens(semExtras, [{ produtoId: 'x', quantidade: 1, adicionais: ['bacon'] }]), /"Bacon"/);
  const semTamanho = lojaDeTeste();
  semTamanho.grupos.tamanho.opcoes.forEach((o) => { o.ativo = false; });
  assert.throws(() => R.calcularItens(semTamanho, [{ produtoId: 'x', quantidade: 1, tamanho: 'p' }]), /"P"/);
  /* o pedido tambem nao sai */
  assert.throws(() => R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1, tamanho: 'g' }] }), /Não tem mais "G"/);
  /* o que continua ligado passa normal */
  assert.equal(R.calcularItens(loja, [{ produtoId: 'x', quantidade: 1, tamanho: 'p', adicionais: ['bacon'] }]).itens[0].precoUnitario, 1800 + 400);
});

test('conferencia do painel segue tolerante com opcao desligada depois do pedido', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1, tamanho: 'g', adicionais: ['bacon'] }] });
  assert.equal(p.total, 1800 + 700 + 400);
  loja.grupos.tamanho.opcoes[1].ativo = false;
  loja.grupos.extras.opcoes[0].ativo = false;
  const c = R.conferirTotal(loja, p);
  /* conta como antes (tamanho padrao, sem o adicional) e mostra a diferenca, em vez de esconder */
  assert.equal(c.ok, false);
  assert.equal(c.esperado, 1800);
});

test('loja nao vira cortesia do Ligeiro por um campo email gravado pelo dono', () => {
  const antes = global.window;
  try {
    global.window = { LIGEIRO_CONFIG: { adminEmail: 'ligeiro@exemplo.com' } };
    const truque = { donoEmail: 'dono@exemplo.com', email: 'ligeiro@exemplo.com', plano: { status: 'teste', desde: '2020-01-01T00:00:00Z' } };
    assert.equal(R.ehDoLigeiro(truque), false);
    assert.equal(R.assinatura(truque).cortesia, undefined);
    assert.equal(R.lojaBloqueada(truque), true);
    assert.equal(R.ehDoLigeiro({ donoEmail: 'Ligeiro@Exemplo.com' }), true);
    assert.equal(R.ehDoLigeiro({ email: 'ligeiro@exemplo.com' }), true, 'conta do Ligeiro (so tem email)');
    assert.equal(R.ehDoLigeiro({ donoEmail: 'dono@exemplo.com' }), false);
  } finally { global.window = antes; }
});

test('assinatura: data que nao se le bloqueia em vez de dar gratis pra sempre', function () {
  var hoje = new Date('2026-09-17T12:00:00Z');
  var loja = lojaDeTeste();
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'teste', desde: '2026-09-19x' } }), hoje).estado, 'bloqueada');
  assert.equal(R.lojaBloqueada(Object.assign({}, loja, { plano: { status: 'teste', desde: 'lixo' } }), hoje), true);
  /* quem pagou continua valendo pelo pagoAte, mesmo com o desde estragado */
  var pagoAte = new Date(hoje.getTime() + 20 * 864e5).toISOString();
  assert.equal(R.assinatura(Object.assign({}, loja, { plano: { status: 'ativo', desde: 'lixo', pagoAte: pagoAte } }), hoje).estado, 'ativa');
});

test('senha: so recomeca quando o dia gravado ficou para tras (celular adiantado nao zera)', () => {
  const agora = new Date(2026, 8, 19, 21, 30);
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-18', ultima: 40 }, agora), { dia: '2026-09-19', ultima: 1 });
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-19', ultima: 7 }, agora), { dia: '2026-09-19', ultima: 8 });
  /* outro celular ja gravou amanha: continua no dia gravado, sem repetir senha */
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-20', ultima: 1 }, agora), { dia: '2026-09-20', ultima: 2 });
  assert.deepEqual(R.proximaSenha({ dia: '2026-10-01', ultima: 4 }, new Date(2026, 8, 30, 23, 0)), { dia: '2026-10-01', ultima: 5 });
  /* amanha gravado antes das 21 h o banco nao aceita: recomeca de hoje; das 21 h em diante continua */
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-20', ultima: 6 }, new Date(2026, 8, 19, 12, 0)), { dia: '2026-09-19', ultima: 1 });
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-20', ultima: 6 }, new Date(2026, 8, 19, 20, 59)), { dia: '2026-09-19', ultima: 1 });
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-20', ultima: 6 }, new Date(2026, 8, 19, 22, 0)), { dia: '2026-09-20', ultima: 7 });
  /* dia gravado longe demais ou ilegivel: recomeca de hoje */
  assert.deepEqual(R.proximaSenha({ dia: '2026-09-25', ultima: 3 }, agora), { dia: '2026-09-19', ultima: 1 });
  assert.deepEqual(R.proximaSenha({ dia: 'lixo', ultima: 3 }, agora), { dia: '2026-09-19', ultima: 1 });
  assert.deepEqual(R.proximaSenha(null, agora), { dia: '2026-09-19', ultima: 1 });
});

test('vagas de loja: limite, fechado na mao e sem limite', () => {
  const antes = global.window;
  try {
    global.window = { LIGEIRO_CONFIG: { capacidade: { maxLojas: 60 } }, LigeiroFundadores: { usados: 0, capacidade: { lojas: 47 } } };
    let c = R.capacidadeLojas();
    assert.equal(c.max, 60); assert.equal(c.restam, 13); assert.equal(c.fechado, false); assert.equal(c.perto, false);
    global.window.LigeiroFundadores.capacidade = { lojas: 48 };
    assert.equal(R.capacidadeLojas().perto, true);
    global.window.LigeiroFundadores.capacidade = { lojas: 60 };
    assert.equal(R.capacidadeLojas().fechado, true);
    /* limite da Central vale mais que o do config */
    global.window.LigeiroFundadores.capacidade = { lojas: 60, max: 80 };
    c = R.capacidadeLojas(); assert.equal(c.fechado, false); assert.equal(c.restam, 20);
    /* fechado na mao, mesmo com vaga */
    global.window.LigeiroFundadores.capacidade = { lojas: 10, max: 80, fechado: true };
    assert.equal(R.capacidadeLojas().fechado, true);
    /* sem limite */
    global.window = { LIGEIRO_CONFIG: {}, LigeiroFundadores: { usados: 0, capacidade: null } };
    c = R.capacidadeLojas(); assert.equal(c.max, 0); assert.equal(c.fechado, false); assert.equal(c.restam, null);
  } finally { global.window = antes; }
});

test('vagas de loja: o que a Central grava ao abrir', () => {
  /* primeira vez, com limite no config: grava o limite e a contagem */
  assert.deepEqual(R.decidirCapacidade(null, 10, 60), { lojas: 10, max: 60 });
  /* bateu o limite: fecha sozinha */
  assert.deepEqual(R.decidirCapacidade({ max: 60, lojas: 59 }, 60, 0), { lojas: 60, fechado: true, automatico: true });
  /* fechada por ela e caiu abaixo do limite: reabre */
  assert.deepEqual(R.decidirCapacidade({ max: 60, lojas: 60, fechado: true, automatico: true }, 58, 0), { lojas: 58, fechado: false, automatico: false });
  /* fechada na mao: nunca reabre sozinha */
  assert.deepEqual(R.decidirCapacidade({ max: 60, lojas: 30, fechado: true, automatico: false }, 30, 0), {});
  /* sem limite: so conta */
  assert.deepEqual(R.decidirCapacidade({ max: 0, lojas: 3 }, 4, 0), { lojas: 4 });
});

test('vagas de loja: mudar o limite', () => {
  /* abaixo das lojas: fecha (automatico) */
  assert.deepEqual(R.novoLimite({ max: 60, lojas: 55 }, 55, 50), { max: 50, fechado: true, automatico: true });
  /* fechada na mao e limite baixou: continua na mao (nao reabre sozinha depois) */
  assert.deepEqual(R.novoLimite({ max: 60, fechado: true, automatico: false }, 55, 50), { max: 50, fechado: true, automatico: false });
  /* fechada pelo limite e o limite subiu: reabre */
  assert.deepEqual(R.novoLimite({ max: 60, fechado: true, automatico: true }, 60, 80), { max: 80, fechado: false, automatico: false });
  /* fechada na mao e o limite subiu: continua fechada */
  assert.deepEqual(R.novoLimite({ max: 60, fechado: true, automatico: false }, 40, 80), { max: 80 });
  /* sem limite (0) e estava fechada pelo limite: reabre */
  assert.deepEqual(R.novoLimite({ max: 60, fechado: true, automatico: true }, 60, 0), { max: 0, fechado: false, automatico: false });
});

test('vendas: resumo por dia guardado da o mesmo numero que somar todos os pedidos', () => {
  const agora = new Date(2026, 8, 23, 23, 59, 0); /* depois do ultimo pedido do dia */
  const pedidos = [];
  const formas = ['pix', 'dinheiro', 'cartao'];
  for (let d = 0; d < 30; d++) {
    for (let i = 0; i < 7; i++) {
      const quando = new Date(2026, 8, 23 - d, 18 + (i % 5), 10 * i, 0);
      const status = i === 3 ? 'cancelado' : (i === 5 && d === 0 ? 'aguardando_pagamento' : 'finalizado');
      pedidos.push({ criadoEm: quando.toISOString(), status, total: 1000 + 137 * i + d, formaPagamento: formas[i % 3],
        cliente: { nome: 'Cliente ' + (i % 4), telefone: '1399999000' + (i % 4) }, endereco: { bairro: 'Bairro ' + d },
        itens: [{ nome: i % 2 ? 'Pizza calabresa' : 'Coca 2.0 L', quantidade: 1 + (i % 3) }, { nome: 'Borda recheada', quantidade: 1 }] });
    }
  }
  const direto = R.resumoVendas(pedidos, 30, agora.getTime());
  const porDia = {};
  pedidos.forEach((p) => { const k = R.diaLocal(new Date(p.criadoEm)); (porDia[k] = porDia[k] || []).push(p); });
  const dias = {};
  Object.keys(porDia).forEach((k) => { dias[k] = JSON.parse(JSON.stringify(R.resumoDoDia(porDia[k]))); }); /* ida e volta pelo banco */
  const junto = R.juntarResumos(dias);
  assert.equal(junto.pedidos, direto.pedidos);
  assert.equal(junto.total, direto.total);
  assert.equal(junto.ticketMedio, direto.ticketMedio);
  assert.deepEqual(junto.porDia, direto.porDia);
  assert.deepEqual(junto.porForma, direto.porForma);
  assert.deepEqual(Object.keys(junto.porHora).sort(), Object.keys(direto.porHora).map(String).sort());
  Object.keys(direto.porHora).forEach((h) => assert.equal(junto.porHora[h], direto.porHora[h]));
  assert.deepEqual(junto.maisVendidos, direto.maisVendidos);
  /* clientes do periodo: a mesma conta que o painel fazia pedido por pedido */
  const cli = {};
  pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'aguardando_pagamento').sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1)).forEach((p) => {
    const c = cli[p.cliente.telefone] || (cli[p.cliente.telefone] = { nome: p.cliente.nome, telefone: p.cliente.telefone, pedidos: 0, total: 0, bairro: '' });
    c.pedidos += 1; c.total += p.total; c.bairro = p.endereco.bairro;
  });
  assert.deepEqual(junto.clientes, Object.values(cli).sort((a, b) => b.total - a.total));
  const hoje = R.diaLocal(agora);
  assert.equal(junto.porDiaQtd[hoje], 5); /* 7 do dia menos 1 cancelado e 1 esperando o Pix */
  /* dia sem venda nenhuma guarda zero (e nao fica lendo de novo) */
  assert.deepEqual(R.resumoDoDia([]), { pedidos: 0, total: 0, porHora: {}, porForma: {}, produtos: [], clientes: [] });
});

test('vagas: quem ocupa vaga no limite de lojas', () => {
  const agora = Date.now();
  const antigo = new Date(agora - 60 * 864e5).toISOString();
  const futuro = new Date(agora + 20 * 864e5).toISOString();
  const passado = new Date(agora - 20 * 864e5).toISOString();
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'teste', desde: new Date(agora).toISOString() } }), true); /* teste gratis correndo */
  assert.equal(R.ocupaVaga({ ativa: true, amostra: true, plano: { status: 'ativo', pagoAte: '' } }), false); /* amostra nao tira vaga de quem paga */
  assert.equal(R.testeAindaNaoComecou({ plano: { status: 'teste', desde: '2026-01-01T00:00:00.000Z' } }), true); /* esperou vaga: o teste nao comecou */
  assert.equal(R.testeAindaNaoComecou({ lojaCriadaEm: '2026-01-02T00:00:00.000Z', plano: { status: 'teste', desde: '2026-01-01T00:00:00.000Z' } }), false); /* ja teve loja */
  assert.equal(R.testeAindaNaoComecou({ plano: { status: 'teste', ultimoPagamentoEm: '2026-01-01T00:00:00.000Z' } }), false); /* ja pagou */
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'ativo', planoPago: 'uma', pagoAte: futuro } }), true); /* pagando */
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'ativo', planoPago: 'uma', pagoAte: passado, desde: antigo } }), true); /* pagou e atrasou: volta quando pagar */
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'teste', desde: antigo } }), false); /* teste acabou sem nunca pagar: libera */
  assert.equal(R.ocupaVaga({ ativa: false, plano: { status: 'ativo', planoPago: 'uma', pagoAte: futuro } }), false); /* desativada pelo Ligeiro */
  assert.equal(R.ocupaVaga(null), false);
});

test('divulgação: a frase de pagamento segue o que a loja aceita (sem prometer Pix a quem não tem Mercado Pago)', () => {
  const base = lojaDeTeste();
  assert.equal(R.frasePagamento(base), 'paga no Pix ou ao receber');
  assert.equal(R.frasePagamento(Object.assign({}, base, { aceitaCartaoEntrega: false, aceitaDinheiroEntrega: false })), 'paga no Pix');
  const semPix = Object.assign({}, base, { mpAtivo: false });
  assert.equal(R.frasePagamento(semPix), 'paga ao receber');
  assert.equal(R.frasePagamento(Object.assign({}, semPix, { aceitaCartaoEntrega: false, aceitaDinheiroEntrega: false })), 'paga na loja');
  const texto = R.cardapioEmTexto(semPix, 'https://exemplo.com/#/juquia/teste');
  assert.ok(!/Pix/.test(texto), 'loja sem Pix não promete Pix no cardápio em texto');
  assert.ok(/paga ao receber/.test(texto));
});

test('tipos de loja: a lista mora nas regras (o cadastro não baixa a Central)', () => {
  assert.ok(Array.isArray(R.TIPOS_DE_LOJA) && R.TIPOS_DE_LOJA.length >= 10);
  assert.deepEqual(R.TIPOS_DE_LOJA[0], ['Lanchonete', '🍔']);
  assert.equal(R.TIPOS_DE_LOJA[R.TIPOS_DE_LOJA.length - 1][0], 'Outra comida');
  assert.ok(Array.isArray(R.TIPOS_DE_COMERCIO) && R.TIPOS_DE_COMERCIO.length >= 8);
  assert.equal(R.TIPOS_DE_COMERCIO[R.TIPOS_DE_COMERCIO.length - 1][0], 'Outro comércio');
});

test('conferência: item que não existe no cardápio não passa como "ok" (pedido adulterado acende o aviso)', () => {
  const loja = lojaDeTeste();
  const falso = { itens: [{ produtoId: 'nao-existe', nome: 'Pizza grande', quantidade: 5, preco: 20 }], tipoEntrega: 'retirada', total: 100, desconto: 0 };
  const c = R.conferirTotal(loja, falso);
  assert.equal(c.ok, false);
  assert.equal(c.esperado, null);
});

test('cartão pelo site: espera o pagamento como o Pix e só vale com a loja ligada e a chave do Mercado Pago', () => {
  const loja = Object.assign(lojaDeTeste(), { aceitaCartaoOnline: true, mpChavePublica: 'APP_USR-chave' });
  const dados = { nome: 'Ana Souza', telefone: '13999990000', tipoEntrega: 'retirada', itens: [{ produtoId: 'x', quantidade: 1 }], formaPagamento: 'cartao_online' };
  const p = R.montarPedido(loja, dados);
  assert.equal(p.formaPagamento, 'cartao_online');
  assert.equal(p.status, R.STATUS.AGUARDANDO);
  assert.equal(p.pagamentoStatus, 'pendente');
  assert.equal(p.pagoEm, null);
  /* retirada com cartao pelo site passa mesmo sem "pagar no balcao" (paga antes, como o Pix) */
  assert.equal(R.montarPedido(Object.assign({}, loja, { aceitaPagarNoBalcao: false }), dados).formaPagamento, 'cartao_online');
  /* sem a chave publica (conectou antes do cartao existir) ou com o cartao desligado: nao vira cartao (e nem outra forma calada) */
  assert.throws(() => R.montarPedido(Object.assign({}, loja, { mpChavePublica: '' }), dados), /forma de pagamento não está disponível/);
  assert.throws(() => R.montarPedido(Object.assign({}, loja, { aceitaCartaoOnline: false }), dados), /forma de pagamento não está disponível/);
  /* vence como o Pix: 35 min sem pagar */
  const velho = Object.assign({}, p, { criadoEm: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
  assert.equal(R.pixVencido(velho), true);
  assert.equal(R.rotuloStatus(p), 'Aguardando cartão');
  assert.equal(R.rotuloProximoPasso(p), '');
  assert.match(R.fichaDoPedido(loja, Object.assign({}, p, { status: R.STATUS.PAGO, pagamentoStatus: 'pago', senha: 3 })), /cartão pelo site/);
  assert.equal(R.frasePagamento(loja), 'paga no Pix, no cartão ou ao receber');
});

test('taxa do cartão repassada: entra só no cartão pelo site, respeita o teto e o painel confere', () => {
  const loja = Object.assign(lojaDeTeste(), { aceitaCartaoOnline: true, mpChavePublica: 'APP_USR-chave' });
  const dados = { nome: 'Ana Souza', telefone: '13999990000', tipoEntrega: 'retirada', itens: [{ produtoId: 'x', quantidade: 1 }], formaPagamento: 'cartao_online' };
  /* a loja paga a taxa (padrao): nada muda e o pedido nem ganha o campo */
  const semTaxa = R.montarPedido(loja, dados);
  assert.equal(semTaxa.acrescimoCartao, undefined);
  /* repassa 5%: o total sobe 5%, arredondado no centavo, e o painel confere */
  const comTaxa = Object.assign({}, loja, { taxaCartao: 5 });
  const p = R.montarPedido(comTaxa, dados);
  assert.equal(p.acrescimoCartao, Math.round(semTaxa.total * 5 / 100));
  assert.equal(p.total, semTaxa.total + p.acrescimoCartao);
  assert.equal(R.conferirTotal(comTaxa, p).ok, true);
  /* no Pix, na maquininha e no dinheiro nao existe taxa */
  assert.equal(R.montarPedido(comTaxa, Object.assign({}, dados, { formaPagamento: 'pix' })).total, semTaxa.total);
  /* teto de 6%: quem gravar 20% na loja cobra so 6% */
  const exagero = R.montarPedido(Object.assign({}, loja, { taxaCartao: 20 }), dados);
  assert.equal(exagero.acrescimoCartao, Math.round(semTaxa.total * R.TAXA_CARTAO_MAX / 100));
  /* a loja mudou a % depois do pedido: a taxa que veio (dentro do teto) continua valendo na conferencia */
  assert.equal(R.conferirTotal(Object.assign({}, loja, { taxaCartao: 3 }), p).ok, true);
  /* pedido mexido para pagar menos que o cardapio acende o aviso */
  assert.equal(R.conferirTotal(comTaxa, Object.assign({}, p, { total: semTaxa.total - 100, acrescimoCartao: 0 })).ok, false);
  /* taxa acima do teto no pedido nao passa */
  assert.equal(R.conferirTotal(comTaxa, Object.assign({}, p, { acrescimoCartao: semTaxa.total, total: semTaxa.total * 2 })).ok, false);
  /* WhatsApp e impressao mostram a taxa */
  assert.match(R.fichaDoPedido(comTaxa, Object.assign({}, p, { status: R.STATUS.PAGO, pagamentoStatus: 'pago', senha: 4 })), /Taxa do cartão/);
});

test('texto do cliente nunca cria linha falsa na ficha (quebra de linha e inversor de direção viram espaço)', () => {
  const loja = lojaDeTeste();
  const p = R.montarPedido(loja, {
    nome: 'Maria\n*TOTAL PAGO: R$ 0,00*', telefone: '13999990001', tipoEntrega: 'entrega', formaPagamento: 'dinheiro_entrega',
    endereco: { rua: 'Rua A\r\nPAGO', numero: '10', bairro: 'Centro', referencia: 'casa \u202Eazul' },
    observacao: 'sem cebola\n\n*TOTAL PAGO: R$ 0,00* (Pix)',
    itens: [{ produtoId: 'x', quantidade: 1, observacao: 'bem passado\u2028*CORTESIA*' }],
  });
  const ficha = R.fichaDoPedido(loja, p);
  ficha.split('\n').forEach((linha) => assert.ok(!/^\*?(TOTAL PAGO|CORTESIA|PAGO)/.test(linha.trim()), 'linha forjada: ' + linha));
  assert.ok(ficha.indexOf('\u202E') < 0 && ficha.indexOf('\u2028') < 0);
  const zap = R.pedidoParaWhatsapp(loja, Object.assign({}, p, { observacao: 'a\nTotal: R$ 0,00' }));
  assert.equal(zap.split('\n').filter((l) => /^Total:/.test(l)).length, 1);
});

/* roda as regras num processo com outro fuso: o site no celular (Brasil) e o mensageiro no Cloudflare (UTC).
   preparo: codigo que roda antes (ex.: aparelho sem o Intl) */
function emFuso(tz, corpo, preparo) {
  const { execFileSync } = require('node:child_process');
  const regras = JSON.stringify(require('node:path').join(__dirname, '..', 'js', 'regras.js'));
  const codigo = 'process.env.TZ=' + JSON.stringify(tz) + ';' + (preparo || '') +
    'const R=require(' + regras + ');console.log(JSON.stringify((function(){' + corpo + '})()));';
  return JSON.parse(execFileSync(process.execPath, ['-e', codigo], { encoding: 'utf8' }));
}

test('assinatura: o site no Brasil e o mensageiro em UTC contam o mesmo dia para o mesmo instante', () => {
  const corpo = `
    const pago = { plano: { status: 'ativo', desde: '2026-08-01T12:00:00.000Z', pagoAte: '2026-10-01T02:00:00.000Z' } }; /* 30/09 23:00 de Brasilia */
    const teste = { plano: { status: 'teste', desde: '2026-09-18T15:00:00.000Z', pagoAte: '' } }; /* gratis ate 25/09 */
    const r = {};
    ['2026-10-10T13:00:00.000Z', '2026-10-11T02:59:00.000Z', '2026-10-11T03:00:00.000Z'].forEach((i) => { const a = R.assinatura(pago, new Date(i)); r['pago ' + i] = a.estado + ' ' + a.dias; });
    ['2026-09-26T00:30:00.000Z', '2026-09-26T02:59:00.000Z', '2026-09-26T03:00:00.000Z'].forEach((i) => { const a = R.assinatura(teste, new Date(i)); r['teste ' + i] = a.estado + ' ' + a.dias; r['vaga ' + i] = R.ocupaVaga(teste, new Date(i)); });
    /* /pedido do mensageiro: a hora de Brasilia para o horario da loja e o instante de verdade para a assinatura */
    const loja = Object.assign({ slug: 'l', nome: 'L', aberta: true, mpAtivo: true, categorias: [{ id: 'c' }], produtos: [{ id: 'x', nome: 'X', categoria: 'c', preco: 2500 }] }, pago);
    const dados = { itens: [{ produtoId: 'x', quantidade: 1 }], nome: 'Ana', telefone: '13999999999', tipoEntrega: 'retirada', formaPagamento: 'pix' };
    ['2026-10-11T02:59:00.000Z', '2026-10-11T03:00:00.000Z'].forEach((i) => {
      const agora = new Date(i);
      try { const p = R.montarPedido(loja, dados, new Date(agora.getTime() - 3 * 3600e3), agora); r['pedido ' + i] = 'aceito ' + p.criadoEm; } catch (e) { r['pedido ' + i] = e.message; }
    });
    return r;`;
  const esperado = {
    'pago 2026-10-10T13:00:00.000Z': 'vencida -10',
    'pago 2026-10-11T02:59:00.000Z': 'vencida -10', /* 10/10 23:59 de Brasilia: ultimo dia de tolerancia */
    'pago 2026-10-11T03:00:00.000Z': 'bloqueada -11', /* 11/10 00:00 de Brasilia */
    'teste 2026-09-26T00:30:00.000Z': 'gratis 0', /* 25/09 21:30: "Minha conta" diz que ainda da e o mensageiro cria a loja */
    'vaga 2026-09-26T00:30:00.000Z': true,
    'teste 2026-09-26T02:59:00.000Z': 'gratis 0',
    'vaga 2026-09-26T02:59:00.000Z': true,
    'teste 2026-09-26T03:00:00.000Z': 'bloqueada -1',
    'vaga 2026-09-26T03:00:00.000Z': false,
    'pedido 2026-10-11T02:59:00.000Z': 'aceito 2026-10-11T02:59:00.000Z', /* o pedido nasce com a hora de verdade */
    'pedido 2026-10-11T03:00:00.000Z': 'Esta loja está com o cadastro pendente no Ligeiro. Peça direto pelo WhatsApp dela.',
  };
  assert.deepEqual(emFuso('UTC', corpo), esperado, 'mensageiro (UTC)');
  assert.deepEqual(emFuso('America/Sao_Paulo', corpo), esperado, 'site em Brasilia');
  assert.deepEqual(emFuso('America/Rio_Branco', corpo), esperado, 'celular no Acre (UTC-5) conta o dia de Brasilia');
  assert.deepEqual(emFuso('UTC', corpo, 'globalThis.Intl = undefined;'), esperado, 'sem o Intl: -3 h fixo');
  assert.deepEqual(emFuso('UTC', corpo, 'Intl.DateTimeFormat.prototype.formatToParts = undefined;'), esperado, 'Intl sem o formatToParts: le o texto AAAA-MM-DD');
});

test('forma de pagamento que a loja nao aceita agora e recusada; pedido sem forma segue como antes', () => {
  const semPix = Object.assign(lojaDeTeste(), { mpAtivo: false });
  const base = { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega', endereco: { rua: 'Rua A', bairro: 'Centro' }, itens: [{ produtoId: 'x', quantidade: 1 }] };
  /* a loja desligou o Mercado Pago enquanto o cliente fechava no Pix: nada de virar maquininha calado */
  assert.throws(() => R.montarPedido(semPix, Object.assign({}, base, { formaPagamento: 'pix' })), /Essa forma de pagamento não está disponível agora. Escolha outra./);
  assert.throws(() => R.montarPedido(semPix, Object.assign({}, base, { formaPagamento: 'boleto' })), /não está disponível/);
  assert.throws(() => R.montarPedido(Object.assign(lojaDeTeste(), { aceitaDinheiroEntrega: false }), Object.assign({}, base, { formaPagamento: 'dinheiro_entrega' })), /não está disponível/);
  assert.equal(R.montarPedido(semPix, Object.assign({}, base, { formaPagamento: 'dinheiro_entrega' })).formaPagamento, 'dinheiro_entrega');
  /* tela antiga, sem a forma: Pix se tiver, senao a primeira que a loja aceita */
  assert.equal(R.montarPedido(lojaDeTeste(), base).formaPagamento, 'pix');
  assert.equal(R.montarPedido(semPix, base).formaPagamento, 'cartao_entrega');
  const nenhuma = Object.assign(lojaDeTeste(), { mpAtivo: false, aceitaCartaoEntrega: false, aceitaDinheiroEntrega: false });
  assert.throws(() => R.montarPedido(nenhuma, Object.assign({}, base, { formaPagamento: 'pix' })), /sem forma de pagamento configurada/);
});

test('"quem retira pode pagar no balcao": sem o campo vale ligado, como o painel mostra', () => {
  const loja = lojaDeTeste();
  delete loja.aceitaPagarNoBalcao;
  const dados = { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'dinheiro_entrega', itens: [{ produtoId: 'x', quantidade: 1 }] };
  assert.equal(R.montarPedido(loja, dados).formaPagamento, 'dinheiro_entrega');
  assert.equal(R.montarPedido(Object.assign({}, loja, { aceitaPagarNoBalcao: true }), dados).status, R.STATUS.PAGO);
  assert.throws(() => R.montarPedido(Object.assign({}, loja, { aceitaPagarNoBalcao: false }), dados), /Para retirar no balcão, pague no Pix/);
});

test('dias gratis: um numero so, nas regras (o config do site nao muda o que o mensageiro conta)', () => {
  const antes = global.window;
  const loja = { plano: { status: 'teste', desde: '2026-09-15T15:00:00.000Z', pagoAte: '' } };
  const agora = new Date('2026-09-25T15:00:00.000Z'); /* 10 dias depois */
  try {
    assert.equal(R.DIAS_GRATIS, 7);
    delete global.window;
    const mensageiro = R.assinatura(loja, agora).estado;
    global.window = { LIGEIRO_CONFIG: { precos: { mensal: 8900, anual: 89000, diasGratis: 14 } } };
    assert.equal(R.assinatura(loja, agora).estado, mensageiro);
    assert.equal(mensageiro, 'bloqueada');
  } finally { global.window = antes; }
});

test('endereco da loja: o corte em 40 letras nao deixa hifen no fim', () => {
  assert.equal(R.slug('Restaurante e Churrascaria Bom Sabor do Vale Ribeira'), 'restaurante-e-churrascaria-bom-sabor-do');
  assert.equal(R.slug('Lanchonete e Pastelaria do Seu Joao da Esquina'), 'lanchonete-e-pastelaria-do-seu-joao-da-e');
  assert.ok(/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(R.slug('Restaurante e Churrascaria Bom Sabor do Vale Ribeira')), 'passa na regra de endereco do mensageiro');
});

test('fecha as: faixas que se cruzam ou se encostam contam como uma so', () => {
  const seg = (hh, mm) => new Date(2026, 8, 28, hh, mm); /* segunda */
  const cruzam = { usarHorarios: true, horarios: { seg: ['11:00-15:00', '14:00-23:00'] } };
  assert.equal(R.fechamentoDeHoje(cruzam, seg(14, 30)), '23:00');
  assert.equal(R.fechamentoDeHoje(cruzam, seg(12, 0)), '23:00');
  assert.equal(R.fechamentoDeHoje({ usarHorarios: true, horarios: { seg: ['14:00-23:00', '11:00-15:00'] } }, seg(12, 0)), '23:00', 'a ordem das faixas nao importa');
  assert.equal(R.fechamentoDeHoje({ usarHorarios: true, horarios: { seg: ['11:00-14:00', '14:00-23:00'] } }, seg(13, 0)), '23:00', 'coladas');
  assert.equal(R.fechamentoDeHoje({ usarHorarios: true, horarios: { seg: ['11:00-14:00', '14:30-23:00'] } }, seg(13, 0)), '14:00', 'com intervalo, fecha no intervalo');
  /* a de hoje vai ate a meia-noite e a de amanha comeca nela: aberta direto ate as 02:00 */
  assert.equal(R.fechamentoDeHoje({ usarHorarios: true, horarios: { seg: ['18:00-00:00'], ter: ['00:00-02:00'] } }, seg(23, 0)), '02:00');
  /* a madrugada de ontem que emenda na faixa de hoje */
  assert.equal(R.fechamentoDeHoje({ usarHorarios: true, horarios: { dom: ['18:00-02:00'], seg: ['02:00-06:00'] } }, seg(1, 0)), '06:00');
});

test('link do Google de avaliar com placeid (o que o proprio Google da) vale', () => {
  const avaliar = 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
  assert.equal(R.linkGoogle(avaliar), avaliar);
  assert.equal(R.linkGoogle('search.google.com/local/writereview?placeid=abc'), 'https://search.google.com/local/writereview?placeid=abc');
  assert.equal(R.linkGooglePerfil(avaliar), 'https://search.google.com/local/reviews?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(R.linkGoogleAvaliar(avaliar), avaliar);
  assert.equal(R.linkGoogleAvaliar('https://search.google.com/local/reviews?placeid=abc'), 'https://search.google.com/local/writereview?placeid=abc');
  assert.match(R.mensagemParaCliente({ nome: 'L', googleUrl: avaliar }, { status: R.STATUS.FINALIZADO, cliente: { nome: 'Ana' } }), /writereview\?placeid=/);
  /* no search.google.com, so o /local/ de avaliacoes */
  assert.equal(R.linkGoogle('https://search.google.com/url?q=https://golpe.com'), '');
  assert.equal(R.linkGoogle('https://search.google.com/'), '');
  assert.equal(R.linkGoogle('https://search.google.com/local/writereviewx'), '');
  assert.equal(R.linkGoogle('https://search.google.com.golpe.com/local/writereview?placeid=a'), '');
});

test('Pix com cobranca no Mercado Pago: sem "Marcar como pago" e sem "diz que pagou" (o Mercado Pago confirma sozinho)', () => {
  const naMao = { status: R.STATUS.AGUARDANDO, formaPagamento: 'pix', tipoEntrega: 'retirada', clientePagou: true };
  const noMp = Object.assign({}, naMao, { mp: { id: 'ORD123' } });
  const loja = { tempoPreparo: 20 };
  /* Pix conferido na mao (sem cobranca no Mercado Pago): como antes */
  assert.equal(R.rotuloProximoPasso(naMao), 'Pix caiu? Marcar como pago');
  assert.equal(R.rotuloStatus(naMao), 'Cliente diz que pagou');
  assert.match(R.textoDoEstagio(naMao, loja), /Assim que ela conferir o Pix/);
  /* com mp.id: nada de botao de confirmar na mao, e o "diz que pagou" nao conta */
  assert.equal(R.rotuloProximoPasso(noMp), '');
  assert.equal(R.rotuloStatus(noMp), 'Aguardando Pix');
  assert.equal(R.textoDoEstagio(noMp, loja), 'Falta só pagar o Pix para o pedido entrar na fila.');
  assert.equal(R.cobrancaNoMp(noMp), true);
  assert.equal(R.cobrancaNoMp(Object.assign({}, naMao, { mp: {} })), false);
  /* cartao continua sem o botao, e o pago segue para o proximo passo */
  assert.equal(R.rotuloProximoPasso({ status: R.STATUS.AGUARDANDO, formaPagamento: 'cartao_online' }), '');
  assert.equal(R.rotuloProximoPasso(Object.assign({}, noMp, { status: R.STATUS.PAGO })), 'Começar a fazer');
});

test('dinheiro devolvido: a mensagem do cliente e a ficha dizem devolvido, nao pago', () => {
  const loja = lojaDeTeste();
  const pago = Object.assign(R.montarPedido(loja, { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'x', quantidade: 1 }] }),
    { status: R.STATUS.CANCELADO, pagamentoStatus: 'pago', senha: 9, mp: { id: 'ORD9' } });
  assert.match(R.mensagemDoCliente(loja, pago), /Já pago no Pix\./);
  assert.match(R.fichaDoPedido(loja, pago), /TOTAL PAGO: R\$ 18,00\* \(Pix\)/);
  /* o mensageiro grava pagamentoStatus 'devolvido' ao devolver */
  const devolvido = Object.assign({}, pago, { pagamentoStatus: 'devolvido', devolvidoEm: '2026-09-25T20:00:00.000Z' });
  /* pedido de antes: so o devolvidoEm, com o pagamentoStatus ainda 'pago' */
  const antigo = Object.assign({}, pago, { devolvidoEm: '2026-09-25T20:00:00.000Z' });
  [devolvido, antigo].forEach((p) => {
    assert.equal(R.dinheiroDevolvido(p), true);
    const msg = R.mensagemDoCliente(loja, p);
    assert.match(msg, /O dinheiro do Pix foi devolvido\./);
    assert.ok(!/Já pago/.test(msg));
    const ficha = R.fichaDoPedido(loja, p);
    assert.match(ficha, /\*DINHEIRO DEVOLVIDO: R\$ 18,00\* \(Pix\)/);
    assert.ok(!/TOTAL PAGO/.test(ficha));
  });
  const cartao = Object.assign({}, devolvido, { formaPagamento: 'cartao_online' });
  assert.match(R.mensagemDoCliente(loja, cartao), /O dinheiro do cartão foi devolvido\./);
  assert.match(R.fichaDoPedido(loja, cartao), /DINHEIRO DEVOLVIDO: R\$ 18,00\* \(cartão pelo site\)/);
  assert.equal(R.dinheiroDevolvido(pago), false);
});

test('tipo "Outra comida": emoji de comida (vira o emoji da loja)', () => {
  const outro = R.TIPOS_DE_LOJA.filter((t) => t[0] === 'Outra comida')[0];
  assert.deepEqual(outro, ['Outra comida', '🍴']);
  assert.ok(R.TIPOS_DE_LOJA.every((t) => t[1] !== '🛵'));
});

test('dias gratis: config das telas, regras e worker do Asaas dizem o mesmo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.join(__dirname, '..');
  const cfg = /diasGratis:\s*(\d+)/.exec(fs.readFileSync(path.join(raiz, 'js/config.js'), 'utf8'));
  const asaas = /const DIAS_GRATIS = (\d+);/.exec(fs.readFileSync(path.join(raiz, 'ferramentas/worker-asaas.js'), 'utf8'));
  assert.ok(cfg && asaas, 'achou os dois numeros');
  assert.equal(Number(cfg[1]), R.DIAS_GRATIS);
  assert.equal(Number(asaas[1]), R.DIAS_GRATIS);
});

test('nome parecido: o cliente confundiria (igual sem acento ou com uma letra de diferenca em nome comprido)', () => {
  assert.equal(R.nomeParecido('Dom Conizza', 'dom conizza'), true);
  assert.equal(R.nomeParecido('Dom Conizza', 'Dom-Conizza!'), true);
  assert.equal(R.nomeParecido('Dom Conizza', 'Dom Conisza'), true, 'uma letra trocada: o jeito da loja falsa');
  assert.equal(R.nomeParecido('Lanchonete do Zé', 'LANCHONETE DO ZE'), true);
  assert.equal(R.nomeParecido('Pizzaria Bella Napoli', 'Pizzaria Bela Napolli'), true, 'nome bem comprido aceita duas');
  assert.equal(R.nomeParecido('Açaí da Ju', 'Açaí da Lu'), false, 'nome curto: so igual conta');
  assert.equal(R.nomeParecido('Lanchonete do Zé', 'Lanchonete do Zeca'), false);
  assert.equal(R.nomeParecido('Pastel da Vila', 'Pastel do Vilela'), false);
  assert.equal(R.nomeParecido('', 'Qualquer'), false);
});

test('Pix combinado com a loja (sem Mercado Pago): so com o interruptor e o WhatsApp; nasce esperando, sem vencer sozinho', () => {
  const base = { nome: 'Maria', telefone: '13999990001', tipoEntrega: 'entrega', endereco: { rua: 'Rua A', bairro: 'Centro' }, itens: [{ produtoId: 'x', quantidade: 1 }], formaPagamento: 'pix_combinado' };
  const semMp = Object.assign(lojaDeTeste(), { mpAtivo: false, whatsapp: '13996447414' });
  /* desligado (o padrao): recusa, como qualquer forma que a loja nao aceita */
  assert.throws(() => R.montarPedido(semMp, base), /não está disponível/);
  /* ligado sem o WhatsApp da loja: nao tem por onde combinar */
  assert.throws(() => R.montarPedido(Object.assign({}, semMp, { aceitaPixCombinado: true, whatsapp: '' }), base), /não está disponível/);
  const loja = Object.assign({}, semMp, { aceitaPixCombinado: true });
  assert.equal(R.pixCombinadoNaLoja(loja), true);
  const p = R.montarPedido(loja, base);
  assert.equal(p.formaPagamento, 'pix_combinado');
  assert.equal(p.status, R.STATUS.AGUARDANDO);
  assert.equal(p.pagamentoStatus, 'a_combinar');
  assert.equal(p.pagoEm, null);
  /* retirada tambem vale (paga o Pix antes de buscar), mesmo com "pagar no balcao" desligado */
  assert.equal(R.montarPedido(loja, Object.assign({}, base, { tipoEntrega: 'retirada', endereco: undefined })).status, R.STATUS.AGUARDANDO);
  /* nao vence sozinho: quem confirma e a loja (nao ha cobranca no Mercado Pago para conferir) */
  const velho = Object.assign({}, p, { senha: 7, criadoEm: '2020-01-01T00:00:00.000Z' });
  assert.equal(R.pixVencido(velho), false);
  /* palavras na loja, no cliente e no WhatsApp */
  assert.equal(R.rotuloStatus(velho), 'Pix a combinar');
  assert.equal(R.rotuloStatusCliente(velho), 'Combinando o Pix');
  assert.match(R.textoDoEstagio(velho, loja), /Chame a loja no WhatsApp para combinar o Pix/);
  assert.equal(R.rotuloProximoPasso(velho), 'Pix caiu? Marcar como pago');
  assert.equal(R.rotuloAvisoWhats(velho), 'Combinar o Pix');
  assert.match(R.mensagemDoCliente(loja, velho), /senha 7\* .*Quero pagar no Pix: pode me mandar a chave\?/);
  assert.match(R.mensagemDoCliente(loja, Object.assign({}, velho, { status: R.STATUS.PAGO, pagamentoStatus: 'pago' })), /Já paguei no Pix\./);
  assert.match(R.mensagemParaCliente(loja, velho), /Vamos combinar o Pix por aqui/);
  assert.match(R.fichaDoPedido(loja, velho), /Pix a combinar, ainda não pago/);
  assert.match(R.fichaDoPedido(loja, Object.assign({}, velho, { status: R.STATUS.PAGO, pagamentoStatus: 'pago' })), /TOTAL PAGO: .*Pix combinado/);
  assert.match(R.pedidoParaWhatsapp(loja, velho), /Pagamento: Pix \(combinar com a loja\)/);
  assert.equal(R.frasePagamento(Object.assign({}, loja, { aceitaCartaoEntrega: false, aceitaDinheiroEntrega: false })), 'paga no Pix');
  /* o Pix do Mercado Pago continua separado */
  assert.equal(R.montarPedido(Object.assign({}, loja, { mpAtivo: true }), Object.assign({}, base, { formaPagamento: 'pix' })).pagamentoStatus, 'pendente');
});

/* resposta automatica do WhatsApp (08/10/2026) */
test('horario por extenso: todos os dias, grupos seguidos, dia fechado e meia-noite', () => {
  const H = (x) => R.horariosEmTexto(x).replace(/ /g, ' '); /* a hora vem presa na palavra (espaco que nao quebra) */
  const todo = { seg: ['18:00-23:00'], ter: ['18:00-23:00'], qua: ['18:00-23:00'], qui: ['18:00-23:00'], sex: ['18:00-23:00'], sab: ['18:00-23:00'], dom: ['18:00-23:00'] };
  assert.equal(H(todo), 'todos os dias, das 18h às 23h');
  assert.equal(H(Object.assign({}, todo, { seg: [] })), 'de terça a domingo, das 18h às 23h');
  assert.equal(H({ seg: ['11:00-15:00'], ter: ['11:00-15:00'], qua: ['11:00-15:00'], qui: ['11:00-15:00'], sex: ['11:00-15:00'], sab: [['18:00', '00:00']], dom: [['18:00', '00:00']] }),
    'de segunda a sexta, das 11h às 15h; sábado e domingo, das 18h à meia-noite');
  assert.equal(H({ sex: ['18:30-23:00'], sab: ['18:30-23:00'], dom: ['18:30-23:00'], seg: ['18:30-23:00'] }), 'de sexta a segunda, das 18h30 às 23h');
  assert.equal(H({ qua: ['11:00-14:00', '18:00-22:00'] }), 'quarta, das 11h às 14h e das 18h às 22h');
  assert.equal(H({}), '');
  assert.equal(H(null), '');
});

test('mensagens da resposta automatica: link numa linha, cardapio ou catalogo, horario so com horarios ligados', () => {
  const loja = lojaDeTeste();
  const link = 'https://ligeiropedidos.com.br/teste';
  const s = R.mensagemDeSaudacao(loja, link);
  assert.ok(s.split('\n').includes(link));
  assert.match(s, /nosso cardápio:/);
  assert.match(s, /paga no Pix/);
  assert.ok(!/\bpra\b/.test(s));
  const fechado = R.mensagemDeAusencia(Object.assign({}, loja, { usarHorarios: true, horarios: { ter: ['18:00-23:00'], qua: ['18:00-23:00'], qui: ['18:00-23:00'] } }), link);
  assert.match(fechado.replace(/ /g, ' '), /Nosso horário: de terça a quinta, das 18h às 23h\./);
  assert.match(fechado, /das 18h às 23h/);
  assert.ok(fechado.split('\n').includes(link));
  const semHora = R.mensagemDeAusencia(Object.assign({}, loja, { usarHorarios: false, horarios: { ter: ['18:00-23:00'] } }), link);
  assert.ok(!/Nosso horário/.test(semHora));
  assert.match(semHora, /Assim que der/);
});
