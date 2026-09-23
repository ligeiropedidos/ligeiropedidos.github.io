'use strict';

/*
 * Testes das regras do pedido. Rodar com:
 *   node --test testes/
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
  assert.match(texto, /• X-Burguer: R\$ 18,00/);
  assert.doesNotMatch(texto, /Sumido/);
  assert.match(texto, /Entrega: R\$ 5,00, grátis a partir de R\$ 60,00/);
  assert.match(R.cardapioEmTexto(Object.assign({}, loja, { freteGratis: true }), ''), /Entrega grátis/);
  assert.match(texto, /https:\/\/exemplo\.com\/#\/juquia\/teste$/);
});

test('comparador de custos: iFood por porcentagem, Anota AI por faixa, Ligeiro fixo', () => {
  const c = R.compararCustos(500000, 200);
  assert.equal(c.ifoodBasico, 76000 + 11000);
  assert.equal(c.ifoodEntrega, 132500 + 15000);
  assert.equal(c.anotaAi, 19999);
  assert.equal(c.ligeiro, 7900);
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
  assert.equal(R.catalogo({ tipo: 'Outro' }).nome, 'catálogo');
  assert.equal(R.catalogo({ tipo: 'Roupas' }).Nome, 'Catálogo');
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
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'ativo', planoPago: 'uma', pagoAte: futuro } }), true); /* pagando */
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'ativo', planoPago: 'uma', pagoAte: passado, desde: antigo } }), true); /* pagou e atrasou: volta quando pagar */
  assert.equal(R.ocupaVaga({ ativa: true, plano: { status: 'teste', desde: antigo } }), false); /* teste acabou sem nunca pagar: libera */
  assert.equal(R.ocupaVaga({ ativa: false, plano: { status: 'ativo', planoPago: 'uma', pagoAte: futuro } }), false); /* desativada pelo Ligeiro */
  assert.equal(R.ocupaVaga(null), false);
});
