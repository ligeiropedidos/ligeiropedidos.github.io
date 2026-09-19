/*
 * Ligeiro - dados de demonstracao.
 *
 * Quatro estabelecimentos de exemplo, com cardapio de verdade, para o
 * sistema nascer com cara de uso. WhatsApp e chave Pix sao de mentira:
 * troque no painel de cada loja antes de usar de verdade.
 */
(function () {
  'use strict';

  function agora() { return new Date().toISOString(); }

  /* Logo da Dom Conizza ja diminuida (240px, JPEG). As outras lojas ficam so com emoji. */
  var LOGO_DOM_CONIZZA = 'data:image/jpeg;base64,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';

  function produto(id, categoria, nome, descricao, preco, emoji, ingredientes) {
    return { id: id, categoria: categoria, nome: nome, descricao: descricao || '', preco: preco, emoji: emoji || '', ingredientes: ingredientes || [], ativo: true, ordem: 0 };
  }

  function opcao(id, nome, preco, extra) {
    return Object.assign({ id: id, nome: nome, preco: preco || 0, ativo: true }, extra || {});
  }

  /* ---------------- Dom Conizza (Juquiá) ---------------- */
  function domConizza() {
    return {
      slug: 'dom-conizza',
      nome: 'Dom Conizza',
      tipo: 'Pizza cone',
      emoji: '🍕',
      cidade: 'Juquiá',
      cidadeSlug: 'juquia',
      uf: 'SP',
      endereco: 'Centro, Juquiá - SP',
      whatsapp: '13999990001',
      instagram: 'domconizza',
      descricao: 'Pizza cone quentinha na sua porta em minutos.',
      avisoTopo: '',
      aberta: true,
      usarHorarios: false,
      tempoPreparo: 20,
      tempoEntrega: 35,
      taxaEntrega: 500,
      entregaGratisAcima: 6000,
      pedidoMinimo: 0,
      aceitaEntrega: true,
      aceitaRetirada: true,
      aceitaPix: true,
      mpAtivo: true,
      aceitaCartaoEntrega: true,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      pix: { chave: 'domconizza@exemplo.com', nome: 'Dom Conizza', cidade: 'Juquia' },
      senhaPainel: '1234',
      logoDados: LOGO_DOM_CONIZZA,
      cor: '#E03131',
      capaUrl: 'img/capa-dom-conizza.jpg',
      categorias: [
        { id: 'salgada', nome: 'Salgados', emoji: '🍕' },
        { id: 'doce', nome: 'Doces', emoji: '🍫' },
        { id: 'porcao', nome: 'Porções', emoji: '🍟' },
        { id: 'bebida', nome: 'Bebidas', emoji: '🥤' },
      ],
      produtos: [
        produto('quatro-queijos', 'salgada', '4 Queijos', 'Mussarela, provolone, parmesão e catupiry', 2200, '🧀', ['Mussarela', 'Provolone', 'Parmesão', 'Catupiry']),
        produto('calabresa', 'salgada', 'Calabresa', 'Calabresa, mussarela, cebola e orégano', 2000, '🌭', ['Calabresa', 'Mussarela', 'Cebola', 'Orégano']),
        produto('frango-catupiry', 'salgada', 'Frango com Catupiry', 'Frango desfiado, catupiry, mussarela e orégano', 2100, '🍗', ['Frango desfiado', 'Catupiry', 'Mussarela', 'Orégano']),
        produto('carne-seca', 'salgada', 'Carne Seca', 'Carne seca, catupiry, mussarela e cebola', 2400, '🥩', ['Carne seca', 'Catupiry', 'Mussarela', 'Cebola']),
        produto('bacon', 'salgada', 'Bacon', 'Bacon, mussarela, catupiry e orégano', 2200, '🥓', ['Bacon', 'Mussarela', 'Catupiry', 'Orégano']),
        produto('presunto-queijo', 'salgada', 'Presunto e Queijo', 'Presunto, mussarela, tomate e orégano', 1900, '🍖', ['Presunto', 'Mussarela', 'Tomate', 'Orégano']),
        produto('chocolate', 'doce', 'Chocolate', 'Chocolate ao leite e chocolate branco', 2000, '🍫', ['Chocolate ao leite', 'Chocolate branco']),
        produto('porcao-batata', 'porcao', 'Batata Frita', 'Porção que serve 2', 2200, '🍟'),
        produto('porcao-batata-cheddar', 'porcao', 'Batata com Cheddar e Bacon', 'Porção que serve 2', 3000, '🧀'),
        produto('porcao-frango', 'porcao', 'Frango a Passarinho', 'Porção que serve 2', 3200, '🍗'),
        produto('coca-lata', 'bebida', 'Coca-Cola Lata', '350ml gelada', 700, '🥤'),
        produto('guarana-lata', 'bebida', 'Guaraná Lata', '350ml gelado', 700, '🥤'),
        produto('agua', 'bebida', 'Água Mineral', '500ml sem gás', 400, '💧'),
      ],
      grupos: {
        tamanho: {
          titulo: 'Tamanho do cone', tipo: 'unico',
          opcoes: [opcao('tradicional', 'Tradicional', 0, { padrao: true, descricao: 'O nosso clássico' }), opcao('grande', 'Grande', 600, { descricao: 'Leva bem mais recheio' })],
        },
        adicionaisSalgados: {
          titulo: 'Turbine seu cone', tipo: 'varios', max: 6,
          opcoes: [opcao('extra-mussarela', 'Extra mussarela', 300), opcao('extra-catupiry', 'Extra catupiry', 400), opcao('cheddar', 'Cheddar', 400), opcao('bacon-extra', 'Bacon', 450), opcao('calabresa-extra', 'Calabresa', 400), opcao('milho', 'Milho', 200), opcao('azeitona', 'Azeitona', 200), opcao('oregano-extra', 'Orégano', 0)],
        },
        adicionaisDoces: {
          titulo: 'Turbine seu cone', tipo: 'varios', max: 6,
          opcoes: [opcao('leite-condensado', 'Leite condensado', 300), opcao('morango', 'Morango', 500), opcao('chantilly', 'Chantilly', 400), opcao('granulado', 'Granulado', 0)],
        },
      },
      gruposPorCategoria: { salgada: ['tamanho', 'adicionaisSalgados'], doce: ['tamanho', 'adicionaisDoces'], porcao: [], bebida: [] },
      cupons: [{ codigo: 'BEMVINDO', percentual: 10, minimo: 3000, limite: 100, usos: 0, ativo: true }],
      plano: { status: 'ativo', desde: agora() },
      ativa: true,
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
  }

  /* ---------------- Lanchonete do Zé (Juquiá) ---------------- */
  function lanchoneteDoZe() {
    return {
      slug: 'lanchonete-do-ze',
      nome: 'Lanchonete do Zé',
      tipo: 'Lanchonete',
      emoji: '🍔',
      cidade: 'Juquiá',
      cidadeSlug: 'juquia',
      uf: 'SP',
      endereco: 'Rua do Comércio, 45 - Centro',
      whatsapp: '13999990002',
      instagram: '',
      descricao: 'Lanche bem servido, feito na hora.',
      avisoTopo: '',
      aberta: true,
      usarHorarios: false,
      tempoPreparo: 15,
      tempoEntrega: 30,
      taxaEntrega: 400,
      entregaGratisAcima: 0,
      pedidoMinimo: 0,
      aceitaEntrega: true,
      aceitaRetirada: true,
      aceitaPix: true,
      mpAtivo: true,
      aceitaCartaoEntrega: true,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      pix: { chave: '13999990002', nome: 'Jose da Silva', cidade: 'Juquia' },
      senhaPainel: '1234',
      categorias: [
        { id: 'lanches', nome: 'Lanches', emoji: '🍔' },
        { id: 'porcoes', nome: 'Porções', emoji: '🍟' },
        { id: 'bebidas', nome: 'Bebidas', emoji: '🥤' },
      ],
      produtos: [
        produto('x-burguer', 'lanches', 'X-Burguer', 'Pão, hambúrguer, queijo, alface e tomate', 1800, '🍔', ['Queijo', 'Alface', 'Tomate', 'Maionese']),
        produto('x-salada', 'lanches', 'X-Salada', 'Pão, hambúrguer, queijo, presunto, alface e tomate', 2000, '🍔', ['Queijo', 'Presunto', 'Alface', 'Tomate', 'Maionese']),
        produto('x-bacon', 'lanches', 'X-Bacon', 'Pão, hambúrguer, queijo, bacon e maionese', 2400, '🥓', ['Queijo', 'Bacon', 'Maionese', 'Alface']),
        produto('x-tudo', 'lanches', 'X-Tudo', 'Hambúrguer, queijo, presunto, ovo, bacon, calabresa e salada', 2800, '🍔', ['Queijo', 'Presunto', 'Ovo', 'Bacon', 'Calabresa', 'Alface', 'Tomate', 'Milho']),
        produto('batata', 'porcoes', 'Batata Frita', 'Porção média', 1500, '🍟'),
        produto('batata-cheddar', 'porcoes', 'Batata com Cheddar e Bacon', 'Porção média', 2200, '🧀'),
        produto('refri-lata', 'bebidas', 'Refrigerante Lata', '350ml gelado', 600, '🥤'),
        produto('suco', 'bebidas', 'Suco Natural', 'Laranja ou maracujá, 400ml', 800, '🍊'),
      ],
      grupos: {
        adicionais: {
          titulo: 'Quer turbinar?', tipo: 'varios', max: 5,
          opcoes: [opcao('bacon', 'Bacon', 400), opcao('ovo', 'Ovo', 200), opcao('cheddar', 'Cheddar', 300), opcao('queijo-extra', 'Queijo extra', 300), opcao('calabresa', 'Calabresa', 300)],
        },
      },
      gruposPorCategoria: { lanches: ['adicionais'], porcoes: [], bebidas: [] },
      cupons: [],
      plano: { status: 'teste', desde: agora() },
      ativa: true,
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
  }

  /* ---------------- Marmitaria da Cida (Juquiá) ---------------- */
  function marmitariaDaCida() {
    return {
      slug: 'marmitaria-da-cida',
      nome: 'Marmitaria da Cida',
      tipo: 'Marmitaria',
      emoji: '🍱',
      cidade: 'Juquiá',
      cidadeSlug: 'juquia',
      uf: 'SP',
      endereco: 'Av. Brasil, 210 - Vila Nova',
      whatsapp: '13999990003',
      instagram: '',
      descricao: 'Comida caseira, marmita quentinha de segunda a sábado.',
      avisoTopo: 'Hoje: frango grelhado, bife acebolado e feijoada',
      aberta: true,
      usarHorarios: false,
      tempoPreparo: 15,
      tempoEntrega: 30,
      taxaEntrega: 300,
      entregaGratisAcima: 0,
      pedidoMinimo: 0,
      aceitaEntrega: true,
      aceitaRetirada: true,
      aceitaPix: true,
      mpAtivo: true,
      aceitaCartaoEntrega: false,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      pix: { chave: '11122233344', nome: 'Aparecida Souza', cidade: 'Juquia' },
      senhaPainel: '1234',
      categorias: [
        { id: 'marmitas', nome: 'Marmitas', emoji: '🍱' },
        { id: 'bebidas', nome: 'Bebidas', emoji: '🥤' },
      ],
      produtos: [
        produto('frango-grelhado', 'marmitas', 'Frango grelhado', 'Arroz, feijão, frango grelhado, salada e farofa', 1600, '🍗', ['Arroz', 'Feijão', 'Salada', 'Farofa']),
        produto('bife-acebolado', 'marmitas', 'Bife acebolado', 'Arroz, feijão, bife acebolado, batata e salada', 1800, '🥩', ['Arroz', 'Feijão', 'Cebola', 'Batata', 'Salada']),
        produto('feijoada', 'marmitas', 'Feijoada', 'Feijoada completa com couve, farofa e laranja', 2000, '🍲', ['Couve', 'Farofa', 'Laranja']),
        produto('refri-lata', 'bebidas', 'Refrigerante Lata', '350ml gelado', 600, '🥤'),
        produto('suco', 'bebidas', 'Suco de Laranja', 'Natural, 400ml', 700, '🍊'),
      ],
      grupos: {
        tamanho: {
          titulo: 'Tamanho da marmita', tipo: 'unico',
          opcoes: [opcao('p', 'Pequena', 0, { padrao: true, descricao: 'Serve 1' }), opcao('m', 'Média', 300, { descricao: 'Bem servida' }), opcao('g', 'Grande', 700, { descricao: 'Para quem trabalha pesado' })],
        },
        extras: {
          titulo: 'Acompanhamentos', tipo: 'varios', max: 4,
          opcoes: [opcao('ovo-frito', 'Ovo frito', 200), opcao('salada-extra', 'Salada extra', 200), opcao('farofa-extra', 'Farofa extra', 0), opcao('mandioca', 'Mandioca cozida', 300)],
        },
      },
      gruposPorCategoria: { marmitas: ['tamanho', 'extras'], bebidas: [] },
      cupons: [],
      plano: { status: 'teste', desde: agora() },
      ativa: true,
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
  }

  /* ---------------- Sorveteria da Lu (Registro) ---------------- */
  function sorveteriaDaLu() {
    return {
      slug: 'sorveteria-da-lu',
      nome: 'Sorveteria da Lu',
      tipo: 'Sorveteria',
      emoji: '🍨',
      cidade: 'Registro',
      cidadeSlug: 'registro',
      uf: 'SP',
      endereco: 'Rua José Antônio de Campos, 88 - Centro',
      whatsapp: '13999990004',
      instagram: 'sorveteriadalu',
      descricao: 'Açaí, sorvete e milkshake. Peça pelo celular ou no tablet do balcão.',
      avisoTopo: '',
      aberta: true,
      usarHorarios: false,
      tempoPreparo: 10,
      tempoEntrega: 25,
      taxaEntrega: 400,
      entregaGratisAcima: 4000,
      pedidoMinimo: 0,
      aceitaEntrega: true,
      aceitaRetirada: true,
      aceitaPix: true,
      mpAtivo: true,
      aceitaCartaoEntrega: true,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      pix: { chave: 'lu.sorvetes@exemplo.com', nome: 'Luciana Pereira', cidade: 'Registro' },
      senhaPainel: '1234',
      categorias: [
        { id: 'acai', nome: 'Açaí', emoji: '🍇' },
        { id: 'sorvetes', nome: 'Sorvetes', emoji: '🍨' },
        { id: 'shakes', nome: 'Milkshakes', emoji: '🥤' },
      ],
      produtos: [
        produto('acai-copo', 'acai', 'Açaí no copo', 'Açaí batido, com os adicionais que você quiser', 1400, '🍇'),
        produto('acai-tigela', 'acai', 'Açaí na tigela', 'Tigela caprichada com banana e granola', 1800, '🍇', ['Banana', 'Granola']),
        produto('sorvete-2', 'sorvetes', 'Sorvete 2 bolas', 'Casquinha ou copo', 1200, '🍨'),
        produto('sundae', 'sorvetes', 'Sundae', 'Sorvete com calda e chantilly', 1500, '🍧', ['Calda', 'Chantilly']),
        produto('milkshake', 'shakes', 'Milkshake', 'Chocolate, morango ou ovomaltine, 500ml', 1600, '🥤'),
      ],
      grupos: {
        tamanhoAcai: {
          titulo: 'Tamanho', tipo: 'unico',
          opcoes: [opcao('300', '300 ml', 0, { padrao: true }), opcao('500', '500 ml', 500), opcao('700', '700 ml', 900)],
        },
        adicionaisAcai: {
          titulo: 'Adicionais', tipo: 'varios', max: 6,
          opcoes: [opcao('leite-ninho', 'Leite Ninho', 300), opcao('granola', 'Granola', 200), opcao('morango', 'Morango', 300), opcao('pacoca', 'Paçoca', 200), opcao('nutella', 'Nutella', 500), opcao('banana', 'Banana', 0)],
        },
      },
      gruposPorCategoria: { acai: ['tamanhoAcai', 'adicionaisAcai'], sorvetes: [], shakes: [] },
      cupons: [],
      plano: { status: 'teste', desde: agora() },
      ativa: true,
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
  }

  /* Pedidos antigos da Dom Conizza, para o painel de vendas nascer com historia. */
  function pedidosDeExemplo(loja) {
    var R = window.LigeiroRegras;
    var lista = {};
    var nomes = ['Maria', 'João', 'Dona Cida', 'Ana Paula', 'Carlos', 'Beatriz', 'Pedro', 'Fernanda', 'Lucas', 'Rita'];
    var bairros = ['Centro', 'Vila Nova', 'Jardim Alvorada', 'Barra do Juquiá', 'Centro'];
    var referencias = ['perto da praça', 'em frente ao mercado', 'ao lado da farmácia', 'portão azul', 'depois da ponte'];
    var contador = 0;
    var agoraMs = Date.now();
    for (var dia = 6; dia >= 1; dia--) {
      var quantos = 2 + ((dia * 3) % 4);
      for (var k = 0; k < quantos; k++) {
        var quando = new Date(agoraMs - dia * 24 * 60 * 60 * 1000);
        quando.setHours(18 + (k % 4), (k * 13) % 60, 0, 0);
        var escolha = loja.produtos[(dia + k) % 6];
        var qtd = 1 + (k % 2);
        var itens = [{ produtoId: escolha.id, quantidade: qtd, tamanho: k % 3 === 0 ? 'grande' : 'tradicional', adicionais: k % 2 ? ['bacon-extra'] : [] }];
        if (k % 3 === 1) itens.push({ produtoId: 'coca-lata', quantidade: 1 });
        var o = R.orcar(loja, { itens: itens, tipoEntrega: k % 4 === 3 ? 'retirada' : 'entrega' });
        contador += 1;
        var id = 'exemplo' + String(contador).padStart(3, '0');
        var forma = ['pix', 'pix', 'cartao_entrega', 'dinheiro_entrega'][k % 4];
        lista[id] = {
          id: id,
          senha: k + 1,
          lojaSlug: loja.slug,
          status: 'finalizado',
          formaPagamento: forma,
          pagamentoStatus: forma === 'pix' ? 'pago' : 'na_entrega',
          trocoPara: forma === 'dinheiro_entrega' ? o.total + 1000 : 0,
          tipoEntrega: o.tipoEntrega,
          cliente: { nome: nomes[(dia + k) % nomes.length], telefone: '139999' + String(10000 + contador * 37).slice(-5) },
          endereco: o.tipoEntrega === 'entrega' ? { rua: 'Rua ' + (k + 1), numero: String(10 + k * 7), bairro: bairros[k % bairros.length], complemento: '', referencia: referencias[k % referencias.length], cidade: 'Juquiá' } : {},
          itens: o.itens,
          observacao: '',
          subtotal: o.subtotal,
          taxaEntrega: o.taxaEntrega,
          cupom: '',
          cupomPercentual: 0,
          desconto: 0,
          total: o.total,
          clientePagou: forma === 'pix',
          criadoEm: quando.toISOString(),
          atualizadoEm: quando.toISOString(),
          pagoEm: quando.toISOString(),
          origem: 'link',
        };
      }
    }
    return lista;
  }

  window.LigeiroSeed = function () {
    var dc = domConizza();
    return {
      lojas: {
        'dom-conizza': dc,
        'lanchonete-do-ze': lanchoneteDoZe(),
        'marmitaria-da-cida': marmitariaDaCida(),
        'sorveteria-da-lu': sorveteriaDaLu(),
      },
      pedidos: { 'dom-conizza': pedidosDeExemplo(dc) },
      contadores: {},
    };
  };
})();
