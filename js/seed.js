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
      aceitaCartaoOnline: true,
      mpChavePublica: 'TEST-demo',
      aceitaCartaoEntrega: true,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      pix: { chave: 'domconizza@exemplo.com', nome: 'Dom Conizza', cidade: 'Juquia' },
      senhaPainel: '1234',
      logoUrl: 'img/oficial/dom-conizza-logo.webp', /* o arquivo que o site ja usa (antes: a mesma logo em base64, 22 KB a mais para todo dono) */
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
      aceitaCartaoOnline: true,
      mpChavePublica: 'TEST-demo',
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
      aceitaCartaoOnline: true,
      mpChavePublica: 'TEST-demo',
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
      aceitaCartaoOnline: true,
      mpChavePublica: 'TEST-demo',
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
