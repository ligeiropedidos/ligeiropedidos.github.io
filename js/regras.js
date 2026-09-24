/*
 * Ligeiro - regras do pedido.
 *
 * Tudo que e "conta" e "regra" mora aqui, sem depender de tela nem de banco:
 * o mesmo arquivo roda no navegador (cliente e painel) e no Node (testes).
 *
 * REGRA DE OURO: o preco de um item nunca vem da tela. A tela manda so o que
 * a pessoa escolheu (produto, tamanho, adicionais) e a conta e refeita daqui,
 * em cima do cardapio da loja. O painel refaz a mesma conta ao receber o
 * pedido, e avisa se o valor nao bater.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.LigeiroRegras = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = {
    AGUARDANDO: 'aguardando_pagamento',
    PAGO: 'pago',
    PRODUCAO: 'producao',
    PRONTO: 'pronto',
    FINALIZADO: 'finalizado',
    CANCELADO: 'cancelado',
  };

  /* Para onde cada status pode ir. Evita clique errado no painel. */
  var TRANSICOES = {};
  TRANSICOES[STATUS.AGUARDANDO] = [STATUS.PAGO, STATUS.CANCELADO];
  TRANSICOES[STATUS.PAGO] = [STATUS.PRODUCAO, STATUS.CANCELADO];
  TRANSICOES[STATUS.PRODUCAO] = [STATUS.PRONTO, STATUS.CANCELADO];
  TRANSICOES[STATUS.PRONTO] = [STATUS.FINALIZADO, STATUS.CANCELADO];
  TRANSICOES[STATUS.FINALIZADO] = [];
  TRANSICOES[STATUS.CANCELADO] = [];

  var EM_ANDAMENTO = [STATUS.AGUARDANDO, STATUS.PAGO, STATUS.PRODUCAO, STATUS.PRONTO];

  function ErroDoCliente(mensagem) {
    var erro = new Error(mensagem);
    erro.publico = true;
    return erro;
  }

  /* ------------------------------------------------------------
   * Texto e numero
   * ---------------------------------------------------------- */

  function dinheiro(centavos) {
    var n = Number(centavos || 0);
    var negativo = n < 0;
    var partes = (Math.abs(n) / 100).toFixed(2).split('.');
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    /* espaco que nao quebra: "R$" e o numero nunca ficam em linhas diferentes */
    return (negativo ? '-' : '') + 'R$\u00A0' + inteiro + ',' + partes[1];
  }

  function limparTexto(valor, maximo) {
    return String(valor == null ? '' : valor).trim().slice(0, maximo || 200);
  }

  function semAcento(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* "Lanchonete do Zé" -> "lanchonete-do-ze" */
  /* O texto ja fala da cidade? Palavra inteira, sem acento e sem maiuscula: "Pizzaria em Juquiá" fala de "Juquia". */
  function mencionaCidade(texto, cidade) {
    var palavras = function (s) { return ' ' + semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '; };
    var c = palavras(cidade);
    return c.trim() !== '' && palavras(texto).indexOf(c) >= 0;
  }

  function slug(texto) {
    return semAcento(texto)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function validarTelefone(bruto) {
    var digitos = String(bruto || '').replace(/\D/g, '');
    var semPais = digitos.indexOf('55') === 0 && digitos.length > 11 ? digitos.slice(2) : digitos;
    if (semPais.length < 10 || semPais.length > 11) {
      throw ErroDoCliente('Confira o número do WhatsApp: precisa ter DDD + número.');
    }
    return semPais;
  }

  function formatarTelefone(digitos) {
    var d = String(digitos || '').replace(/\D/g, '');
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2); /* colou com +55 */
    d = d.slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    var corte = d.length > 10 ? 7 : 6;
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, corte) + '-' + d.slice(corte);
  }

  /* ------------------------------------------------------------
   * Loja aberta ou fechada
   *
   * "aberta" e o interruptor manual do painel. Se a loja cadastrou
   * horarios, eles mandam junto: aberta so quando o interruptor esta
   * ligado E o relogio esta dentro do horario.
   * ---------------------------------------------------------- */

  var DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  function minutos(hhmm) {
    var p = String(hhmm || '').split(':');
    return Number(p[0] || 0) * 60 + Number(p[1] || 0);
  }

  /* Uma faixa pode vir como ['18:00','23:00'] ou como '18:00-23:00' (jeito que fica na nuvem). */
  function faixaMinutos(faixa) {
    var partes = typeof faixa === 'string' ? faixa.split('-') : faixa;
    if (!partes || partes.length < 2) return null;
    return [minutos(partes[0]), minutos(partes[1])];
  }

  function dentroDoHorario(horarios, agora) {
    if (!horarios || typeof horarios !== 'object') return true;
    var data = agora || new Date();
    var atual = data.getHours() * 60 + data.getMinutes();
    var hoje = horarios[DIAS[data.getDay()]];
    var ontem = horarios[DIAS[(data.getDay() + 6) % 7]];
    var i, f;
    if (Array.isArray(hoje)) {
      for (i = 0; i < hoje.length; i++) {
        f = faixaMinutos(hoje[i]);
        if (!f) continue;
        /* Faixa que vira a noite (18:00 as 01:00): hoje vale a partir das 18:00 */
        if (f[1] <= f[0]) { if (atual >= f[0]) return true; }
        else if (atual >= f[0] && atual < f[1]) return true;
      }
    }
    /* ...e a madrugada pertence ao dia anterior: 00:30 de terca ainda e a faixa de segunda */
    if (Array.isArray(ontem)) {
      for (i = 0; i < ontem.length; i++) {
        f = faixaMinutos(ontem[i]);
        if (f && f[1] <= f[0] && atual < f[1]) return true;
      }
    }
    return false;
  }

  /* "Abre às 18:00": a proxima faixa de hoje que ainda nao comecou. null se nao tem. */
  function proximaAbertura(loja, agora) {
    if (!loja || loja.aberta === false || !loja.usarHorarios || !loja.horarios) return null;
    var data = agora || new Date();
    var atual = data.getHours() * 60 + data.getMinutes();
    var hoje = loja.horarios[DIAS[data.getDay()]];
    if (!Array.isArray(hoje)) return null;
    var melhor = null;
    for (var i = 0; i < hoje.length; i++) {
      var f = faixaMinutos(hoje[i]);
      if (f && f[0] > atual && (melhor === null || f[0] < melhor)) melhor = f[0];
    }
    if (melhor === null) return null;
    var h = Math.floor(melhor / 60), m = melhor % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* "Fecha às 23:00": o fim da faixa em que a loja esta agora (faixa que vira a noite, 18:00 as 02:00, tambem).
     null se nao usa horario ou se esta fora de qualquer faixa. */
  function fechamentoDeHoje(loja, agora) {
    if (!loja || !loja.usarHorarios || !loja.horarios) return null;
    var data = agora || new Date();
    var atual = data.getHours() * 60 + data.getMinutes();
    var hoje = loja.horarios[DIAS[data.getDay()]];
    var ontem = loja.horarios[DIAS[(data.getDay() + 6) % 7]];
    var fim = null, i, f;
    if (Array.isArray(hoje)) {
      for (i = 0; i < hoje.length && fim === null; i++) {
        f = faixaMinutos(hoje[i]);
        if (f && (f[1] <= f[0] ? atual >= f[0] : atual >= f[0] && atual < f[1])) fim = f[1];
      }
    }
    if (fim === null && Array.isArray(ontem)) {
      for (i = 0; i < ontem.length && fim === null; i++) {
        f = faixaMinutos(ontem[i]);
        if (f && f[1] <= f[0] && atual < f[1]) fim = f[1];
      }
    }
    if (fim === null) return null;
    var h = Math.floor(fim / 60) % 24, m = fim % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function lojaAberta(loja, agora) {
    if (!loja) return false;
    if (loja.aberta === false) return false;
    if (loja.usarHorarios && loja.horarios) return dentroDoHorario(loja.horarios, agora);
    return true;
  }

  /* ------------------------------------------------------------
   * Cardapio: grupos de opcoes de cada categoria
   * ---------------------------------------------------------- */

  function gruposDaCategoria(loja, categoriaId) {
    var chaves = (loja.gruposPorCategoria || {})[categoriaId] || [];
    var grupos = [];
    for (var i = 0; i < chaves.length; i++) {
      var g = (loja.grupos || {})[chaves[i]];
      if (!g) continue;
      var opcoes = (g.opcoes || []).filter(function (o) { return o.ativo !== false; });
      if (opcoes.length === 0) continue;
      grupos.push({
        chave: chaves[i],
        titulo: g.titulo,
        tipo: g.tipo,
        max: g.max || 0,
        opcoes: opcoes,
      });
    }
    return grupos;
  }

  /* Categoria desligada (ativa === false): ela e todos os itens somem do site. */
  function categoriaAtiva(loja, id) {
    var lista = loja.categorias || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i].ativa !== false;
    return true;
  }

  function produtosAtivos(loja) {
    return (loja.produtos || []).filter(function (p) { return p.ativo !== false && categoriaAtiva(loja, p.categoria); });
  }

  function buscarProduto(loja, id) {
    var lista = loja.produtos || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }

  /* ------------------------------------------------------------
   * A conta do pedido (a fonte da verdade)
   * ---------------------------------------------------------- */

  /* Nome de uma opcao pelo id, mesmo desligada (so pra mensagem de erro). */
  function nomeDaOpcao(loja, categoriaId, id) {
    var chaves = (loja.gruposPorCategoria || {})[categoriaId] || [];
    for (var i = 0; i < chaves.length; i++) {
      var ops = ((loja.grupos || {})[chaves[i]] || {}).opcoes || [];
      for (var j = 0; j < ops.length; j++) if (ops[j].id === id) return ops[j].nome || '';
    }
    return '';
  }

  function opcaoQueAcabou(loja, produto, id) {
    var nome = nomeDaOpcao(loja, produto.categoria, id);
    return ErroDoCliente(nome ? 'Não tem mais "' + nome + '" em "' + produto.nome + '".' : 'Uma opção escolhida em "' + produto.nome + '" acabou.');
  }

  /*
   * opcoes.tolerante: so o painel, conferindo pedido ja feito. Tamanho ou adicional que saiu
   * depois cai no padrao / e ignorado, como antes. No pedido novo (tela do cliente), recusa.
   */
  function calcularItens(loja, itensRecebidos, opcoes) {
    var tolerante = !!(opcoes && opcoes.tolerante);
    if (!Array.isArray(itensRecebidos) || itensRecebidos.length === 0) {
      throw ErroDoCliente('Seu carrinho está vazio.');
    }
    if (itensRecebidos.length > 40) {
      throw ErroDoCliente('Pedido muito grande. Fale com a loja no WhatsApp.');
    }

    var itens = [];
    var subtotal = 0;

    for (var n = 0; n < itensRecebidos.length; n++) {
      var bruto = itensRecebidos[n] || {};
      var produto = buscarProduto(loja, String(bruto.produtoId));
      if (!produto) throw ErroDoCliente('Um dos itens do carrinho não existe mais no cardápio.');
      if (produto.ativo === false) throw ErroDoCliente('"' + produto.nome + '" acabou de sair do cardápio.');
      if (!categoriaAtiva(loja, produto.categoria)) throw ErroDoCliente('"' + produto.nome + '" não está disponível agora.');

      var quantidade = Math.floor(Number(bruto.quantidade) || 0);
      if (quantidade < 1 || quantidade > 20) {
        throw ErroDoCliente('Quantidade inválida em "' + produto.nome + '".');
      }

      var grupos = gruposDaCategoria(loja, produto.categoria);
      var unitario = Number(produto.preco) || 0;

      /* tamanho: escolha unica */
      var tamanho = null;
      var grupoTamanho = grupos.filter(function (g) { return g.tipo === 'unico'; })[0];
      var pediuTamanho = bruto.tamanho != null && bruto.tamanho !== '';
      if (grupoTamanho) {
        var escolhido = null;
        for (var t = 0; t < grupoTamanho.opcoes.length; t++) {
          if (grupoTamanho.opcoes[t].id === bruto.tamanho) escolhido = grupoTamanho.opcoes[t];
        }
        /* o tamanho escolhido acabou (o dono desligou): avisa, em vez de trocar pelo padrao calado */
        if (!escolhido && pediuTamanho && !tolerante) throw opcaoQueAcabou(loja, produto, bruto.tamanho);
        if (!escolhido) {
          for (var d = 0; d < grupoTamanho.opcoes.length; d++) {
            if (grupoTamanho.opcoes[d].padrao) escolhido = grupoTamanho.opcoes[d];
          }
        }
        if (!escolhido) escolhido = grupoTamanho.opcoes[0];
        tamanho = { id: escolhido.id, nome: escolhido.nome, preco: Number(escolhido.preco) || 0 };
        unitario += tamanho.preco;
      } else if (pediuTamanho && !tolerante) {
        /* o grupo de tamanho inteiro saiu (todas as opcoes desligadas) */
        throw opcaoQueAcabou(loja, produto, bruto.tamanho);
      }

      /* adicionais: varios (a categoria pode ter mais de um grupo desses) */
      var adicionais = [];
      var gruposAdicionais = grupos.filter(function (g) { return g.tipo === 'varios'; });
      if (Array.isArray(bruto.adicionais)) {
        var vistos = {};
        for (var ga = 0; ga < gruposAdicionais.length; ga++) {
          var grupoAdicionais = gruposAdicionais[ga];
          var nesteGrupo = 0;
          for (var a = 0; a < bruto.adicionais.length; a++) {
            var idAd = bruto.adicionais[a];
            if (vistos[idAd]) continue;
            var opcao = null;
            for (var o = 0; o < grupoAdicionais.opcoes.length; o++) {
              if (grupoAdicionais.opcoes[o].id === idAd && grupoAdicionais.opcoes[o].ativo !== false) opcao = grupoAdicionais.opcoes[o];
            }
            if (!opcao) continue;
            vistos[idAd] = true;
            nesteGrupo += 1;
            adicionais.push({ id: opcao.id, nome: opcao.nome, preco: Number(opcao.preco) || 0 });
            unitario += Number(opcao.preco) || 0;
          }
          if (grupoAdicionais.max && nesteGrupo > grupoAdicionais.max) {
            throw ErroDoCliente('Máximo de ' + grupoAdicionais.max + ' em "' + (grupoAdicionais.titulo || 'adicionais') + '" por item.');
          }
        }
        /* adicional escolhido que acabou (desligado ou apagado): avisa, em vez de sumir do pedido calado */
        if (!tolerante) {
          for (var ax = 0; ax < bruto.adicionais.length; ax++) {
            var idX = bruto.adicionais[ax];
            if (idX != null && idX !== '' && !vistos[idX]) throw opcaoQueAcabou(loja, produto, idX);
          }
        }
      }

      /* ingredientes tirados: nao mudam o preco */
      var removidos = [];
      if (Array.isArray(bruto.removidos) && Array.isArray(produto.ingredientes)) {
        for (var r = 0; r < bruto.removidos.length; r++) {
          var nomeR = bruto.removidos[r];
          if (produto.ingredientes.indexOf(nomeR) >= 0 && removidos.indexOf(nomeR) < 0) removidos.push(nomeR);
        }
      }

      var totalItem = unitario * quantidade;
      subtotal += totalItem;

      itens.push({
        produtoId: produto.id,
        nome: produto.nome,
        categoria: produto.categoria,
        emoji: produto.emoji || '',
        quantidade: quantidade,
        precoBase: Number(produto.preco) || 0,
        tamanho: tamanho,
        adicionais: adicionais,
        removidos: removidos,
        observacao: limparTexto(bruto.observacao, 140),
        precoUnitario: unitario,
        totalItem: totalItem,
      });
    }

    return { itens: itens, subtotal: subtotal };
  }

  /*
   * Frete: o dono escolhe em Ajustes. freteGratis = true vale acima de tudo
   * (a taxa guardada fica so de lembranca pra quando ele voltar a cobrar).
   */
  function calcularTaxaEntrega(loja, tipoEntrega, subtotal) {
    if (tipoEntrega !== 'entrega') return 0;
    if (loja.freteGratis) return 0;
    var gratisAcima = Number(loja.entregaGratisAcima) || 0;
    if (gratisAcima > 0 && subtotal >= gratisAcima) return 0;
    return Number(loja.taxaEntrega) || 0;
  }

  /* Texto unico do frete, pro site, pro cardapio em texto e pro painel. */
  function descreverFrete(loja) {
    if (loja.aceitaEntrega === false) return 'Só retirada';
    var taxa = Number(loja.taxaEntrega) || 0;
    if (loja.freteGratis || taxa <= 0) return 'Entrega grátis';
    var acima = Number(loja.entregaGratisAcima) || 0;
    return 'Taxa ' + dinheiro(taxa) + (acima > 0 ? ', grátis a partir de ' + dinheiro(acima) : '');
  }

  /* Cupom simples: codigo, percentual, minimo, ativo, limite de usos. */
  function avaliarCupom(loja, codigoBruto, subtotal) {
    var codigo = semAcento(codigoBruto).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!codigo) return { codigo: '', desconto: 0, percentual: 0, erro: '' };
    var cupom = null;
    var lista = loja.cupons || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].codigo === codigo) cupom = lista[i];
    if (!cupom) return { codigo: codigo, desconto: 0, percentual: 0, erro: 'Esse código não existe. Confira as letras.' };
    if (cupom.ativo === false) return { codigo: codigo, desconto: 0, percentual: 0, erro: 'Esse código não está mais valendo.' };
    if (cupom.limite > 0 && (cupom.usos || 0) >= cupom.limite) {
      return { codigo: codigo, desconto: 0, percentual: 0, erro: 'Esse código já foi todo usado.' };
    }
    if (cupom.minimo > 0 && subtotal < cupom.minimo) {
      return { codigo: codigo, desconto: 0, percentual: 0, erro: 'Esse código vale a partir de ' + dinheiro(cupom.minimo) + ' em itens.' };
    }
    var percentual = Math.max(0, Math.min(100, Number(cupom.percentual) || 0));
    var desconto = Math.min(subtotal, Math.floor((subtotal * percentual) / 100));
    return { codigo: codigo, desconto: desconto, percentual: percentual, erro: '' };
  }

  /* Taxa do cartao pelo site repassada ao cliente, em % do pedido: 0 = a loja paga (o padrao). A lei 13.455/2017 deixa
     cobrar diferente por forma de pagamento, desde que o cliente veja antes de pagar (o site mostra na opcao e no total).
     Teto de 6%: cobre a taxa do Mercado Pago (cerca de 5%) sem virar lucro em cima do cliente */
  var TAXA_CARTAO_MAX = 6;
  /* a chave "Cliente paga a taxa do cartao" usa esta: soma o bastante para a loja receber o valor cheio depois dos
     cerca de 4,98% do Mercado Pago (50,00 vira 52,65; o Mercado Pago fica com 2,62; a loja recebe 50,03) */
  var TAXA_CARTAO_PADRAO = 5.3;
  function taxaCartaoRepassada(loja) {
    var t = Number((loja || {}).taxaCartao) || 0;
    return t > 0 ? Math.min(TAXA_CARTAO_MAX, Math.round(t * 10) / 10) : 0;
  }
  function acrescimoDoCartao(loja, forma, base) {
    if (forma !== 'cartao_online' || !cartaoPeloSite(loja) || !(base > 0)) return 0;
    var t = taxaCartaoRepassada(loja);
    return t ? Math.round((base * t) / 100) : 0;
  }

  function orcar(loja, dados) {
    var o = orcarBase(loja, dados);
    o.total = Math.max(0, o.subtotal - o.desconto + o.taxaEntrega) + o.acrescimoCartao;
    return o;
  }
  function orcarBase(loja, dados) {
    var conta = calcularItens(loja, dados.itens, { tolerante: !!dados.tolerante });
    var tipoEntrega = dados.tipoEntrega === 'entrega' ? 'entrega' : 'retirada';
    var cupom = avaliarCupom(loja, dados.cupom, conta.subtotal);
    var cortesia = cupom.percentual === 100 && cupom.desconto > 0;
    var taxaEntrega = cortesia ? 0 : calcularTaxaEntrega(loja, tipoEntrega, conta.subtotal);
    return {
      itens: conta.itens,
      subtotal: conta.subtotal,
      tipoEntrega: tipoEntrega,
      taxaEntrega: taxaEntrega,
      cupom: cupom.codigo,
      cupomErro: cupom.erro,
      cupomPercentual: cupom.percentual,
      desconto: cupom.desconto,
      acrescimoCartao: acrescimoDoCartao(loja, dados.formaPagamento, Math.max(0, conta.subtotal - cupom.desconto + taxaEntrega)),
      total: 0,
    };
  }

  /* ------------------------------------------------------------
   * Montar o pedido a partir do que a tela mandou
   *
   * Devolve o objeto pronto para gravar (sem id e sem senha - isso e o
   * banco quem da). Lanca ErroDoCliente com mensagem legivel se algo
   * estiver errado.
   * ---------------------------------------------------------- */

  function montarPedido(loja, dados, agora) {
    if (!lojaAberta(loja, agora)) {
      throw ErroDoCliente('A loja está fechada no momento. Volte mais tarde!');
    }

    var noBalcao = dados.origem === 'balcao';
    if (lojaBloqueada(loja, agora)) throw ErroDoCliente('Esta loja está com o cadastro pendente no Ligeiro. Peça direto pelo WhatsApp dela.');
    var tipoEntrega = dados.tipoEntrega === 'entrega' ? 'entrega' : 'retirada';
    if (tipoEntrega === 'entrega' && loja.aceitaEntrega === false) {
      throw ErroDoCliente('Estamos sem entrega agora. Você pode retirar no balcão.');
    }
    /* No tablet do balcao a pessoa esta na loja: retirada vale mesmo com "so entrega" ligado. */
    if (tipoEntrega === 'retirada' && loja.aceitaRetirada === false && !noBalcao) {
      throw ErroDoCliente('A retirada no balcão está indisponível agora.');
    }

    var nome = limparTexto(dados.nome, 80);
    if (nome.length < 2) {
      if (!noBalcao) throw ErroDoCliente('Digite seu nome.');
      nome = 'Cliente do balcão';
    }
    /* No tablet do balcao o WhatsApp e opcional: a pessoa esta na frente do caixa. */
    var telefone = (noBalcao && !String(dados.telefone || '').trim()) ? '' : validarTelefone(dados.telefone);

    var endereco = {};
    if (tipoEntrega === 'entrega') {
      var e = dados.endereco || {};
      var rua = limparTexto(e.rua, 120);
      var numero = limparTexto(e.numero, 12);
      var bairro = limparTexto(e.bairro, 80);
      if (!rua || !bairro) throw ErroDoCliente('Para entrega precisamos da rua e do bairro.');
      endereco = {
        rua: rua,
        numero: numero || 's/n',
        bairro: bairro,
        complemento: limparTexto(e.complemento, 80),
        referencia: limparTexto(e.referencia, 140),
        cidade: limparTexto(e.cidade || loja.cidade, 60),
      };
    }

    var formas = {
      pix: loja.aceitaPix !== false && !!loja.mpAtivo,
      cartao_online: cartaoPeloSite(loja),
      cartao_entrega: !!loja.aceitaCartaoEntrega,
      dinheiro_entrega: !!loja.aceitaDinheiroEntrega,
    };
    var formaPagamento = formas.hasOwnProperty(dados.formaPagamento) ? dados.formaPagamento : 'pix';
    if (!formas[formaPagamento]) {
      var primeira = Object.keys(formas).filter(function (f) { return formas[f]; })[0];
      if (!primeira) throw ErroDoCliente('A loja está sem forma de pagamento configurada.');
      formaPagamento = primeira;
    }
    var orcamento = orcar(loja, { itens: dados.itens, tipoEntrega: tipoEntrega, cupom: dados.cupom, formaPagamento: formaPagamento });
    if (orcamento.cupom && orcamento.cupomErro) throw ErroDoCliente(orcamento.cupomErro);
    /* pagar na porta: maquininha ou dinheiro. Pix e cartao pelo site pagam antes, como o Pix sempre fez */
    var naPorta = formaPagamento === 'cartao_entrega' || formaPagamento === 'dinheiro_entrega';
    if (naPorta && tipoEntrega !== 'entrega' && !loja.aceitaPagarNoBalcao && !noBalcao) {
      /* Retirada com maquininha/dinheiro so se a loja permitir cobrar no balcao. */
      throw ErroDoCliente('Para retirar no balcão, pague no Pix.');
    }

    var trocoPara = 0;
    if (formaPagamento === 'dinheiro_entrega' && dados.trocoPara) {
      trocoPara = Math.round(Number(dados.trocoPara));
      if (!isFinite(trocoPara) || trocoPara < 0) throw ErroDoCliente('Valor de troco inválido.');
    }

    var minimo = Number(loja.pedidoMinimo) || 0;
    if (minimo > 0 && orcamento.subtotal < minimo) {
      throw ErroDoCliente('O pedido mínimo é de ' + dinheiro(minimo) + '.');
    }
    if (!orcamento.desconto && orcamento.total < 100) throw ErroDoCliente('O pedido precisa somar pelo menos R$ 1,00.');
    if (trocoPara > 0 && trocoPara < orcamento.total) {
      throw ErroDoCliente('O troco precisa ser para um valor maior que ' + dinheiro(orcamento.total) + '.');
    }

    var pagoNaHora = orcamento.total === 0;
    var quando = (agora || new Date()).toISOString();

    var pedido = {
      lojaSlug: loja.slug,
      status: (naPorta || pagoNaHora) ? STATUS.PAGO : STATUS.AGUARDANDO,
      formaPagamento: formaPagamento,
      /* 'na_entrega' = o dinheiro ainda vai ser cobrado na porta. */
      pagamentoStatus: pagoNaHora ? 'pago' : (naPorta ? 'na_entrega' : 'pendente'),
      trocoPara: trocoPara,
      tipoEntrega: tipoEntrega,
      cliente: { nome: nome, telefone: telefone },
      endereco: endereco,
      itens: orcamento.itens,
      observacao: limparTexto(dados.observacao, 300),
      subtotal: orcamento.subtotal,
      taxaEntrega: orcamento.taxaEntrega,
      cupom: orcamento.desconto ? orcamento.cupom : '',
      cupomPercentual: orcamento.desconto ? orcamento.cupomPercentual : 0,
      desconto: orcamento.desconto,
      total: orcamento.total,
      clientePagou: false,
      criadoEm: quando,
      atualizadoEm: quando,
      pagoEm: (naPorta || pagoNaHora) ? quando : null,
      origem: dados.origem === 'balcao' ? 'balcao' : 'link',
    };
    /* so aparece quando existe: o pedido comum continua com os mesmos campos de sempre */
    if (orcamento.acrescimoCartao > 0) pedido.acrescimoCartao = orcamento.acrescimoCartao;
    return pedido;
  }

  /* Itens ja calculados (tamanho e adicionais como objetos) de volta ao formato bruto. */
  function itensBrutos(itens) {
    return (itens || []).map(function (it) {
      return {
        produtoId: it.produtoId,
        quantidade: it.quantidade,
        tamanho: it.tamanho && typeof it.tamanho === 'object' ? it.tamanho.id : it.tamanho,
        adicionais: (it.adicionais || []).map(function (a) { return a && typeof a === 'object' ? a.id : a; }),
        removidos: it.removidos || [],
        observacao: it.observacao || '',
      };
    });
  }

  /* O painel refaz a conta e compara com o total gravado. */
  function conferirTotal(loja, pedido) {
    try {
      /* tolerante: opcao desligada depois do pedido nao derruba a conferencia (conta como antes, pelo padrao) */
      var o = orcar(loja, { itens: itensBrutos(pedido.itens), tipoEntrega: pedido.tipoEntrega, cupom: pedido.cupom, tolerante: true });
      /* Cupom ja usado conta como valido aqui: o limite pode ter sido atingido por este mesmo pedido. */
      var desconto = pedido.desconto || 0;
      /* cortesia (cupom de 100%) zera a entrega tambem, mesmo que o cupom ja tenha esgotado por este pedido */
      var cortesia = Number(pedido.cupomPercentual) === 100 && desconto >= o.subtotal;
      var taxaSeErro = cortesia ? 0 : calcularTaxaEntrega(loja, pedido.tipoEntrega, o.subtotal);
      var total = Math.max(0, o.subtotal - desconto + (o.cupomErro ? taxaSeErro : o.taxaEntrega));
      var esperado = o.cupomErro ? total : o.total;
      /* taxa do cartao repassada: conta a que veio no pedido, se couber no teto (a loja pode ter mudado a % depois; quem
         mexer no pedido so consegue pagar mais, nunca menos) */
      var acrescimo = Math.round(Number(pedido.acrescimoCartao) || 0);
      if (pedido.formaPagamento === 'cartao_online' && acrescimo > 0 && acrescimo <= Math.ceil((total * TAXA_CARTAO_MAX) / 100)) esperado = total + acrescimo;
      return { ok: esperado === pedido.total, esperado: esperado };
    } catch (_) {
      /* item que nao existe no cardapio (ou quantidade fora do normal): nao da para refazer a conta. Antes passava como
         "ok" e um pedido adulterado (5 pizzas por R$ 1) nao acendia aviso nenhum */
      return { ok: false, esperado: null };
    }
  }

  /* ------------------------------------------------------------
   * Rotulos e textos
   * ---------------------------------------------------------- */

  function rotuloStatus(pedido) {
    var entrega = pedido.tipoEntrega === 'entrega';
    switch (pedido.status) {
      case STATUS.AGUARDANDO: return pedido.clientePagou ? 'Cliente diz que pagou' : 'Aguardando ' + nomeDoPagamento(pedido);
      case STATUS.PAGO: return 'Novo, preparar';
      case STATUS.PRODUCAO: return 'Preparando';
      case STATUS.PRONTO: return entrega ? 'Saiu para entrega' : 'Pronto para retirar';
      case STATUS.FINALIZADO: return entrega ? 'Entregue' : 'Retirado';
      case STATUS.CANCELADO: return 'Cancelado';
      default: return pedido.status;
    }
  }

  /* O status em palavras de cliente (o rotuloStatus e o da loja: "Novo, preparar", "Cliente diz que pagou") */
  function rotuloStatusCliente(pedido) {
    var entrega = pedido.tipoEntrega === 'entrega';
    switch (pedido.status) {
      case STATUS.AGUARDANDO: return pedido.formaPagamento === 'cartao_online' ? 'Esperando o pagamento' : 'Esperando o Pix';
      case STATUS.PAGO: return 'Na fila da loja';
      case STATUS.PRODUCAO: return 'Preparando';
      case STATUS.PRONTO: return entrega ? 'Saiu para entrega' : 'Pronto para retirar';
      case STATUS.FINALIZADO: return entrega ? 'Entregue' : 'Retirado';
      case STATUS.CANCELADO: return 'Cancelado';
      default: return '';
    }
  }

  function textoDoEstagio(pedido, loja) {
    var entrega = pedido.tipoEntrega === 'entrega';
    var tempo = entrega ? (loja.tempoEntrega || 40) : (loja.tempoPreparo || 20);
    switch (pedido.status) {
      case STATUS.AGUARDANDO:
        return pedido.clientePagou
          ? 'Avisamos a loja. Assim que ela conferir o Pix, o pedido entra na fila.'
          : (pedido.formaPagamento === 'cartao_online' ? 'Falta só pagar com o cartão para o pedido entrar na fila.' : 'Falta só pagar o Pix para o pedido entrar na fila.');
      case STATUS.PAGO:
        return entrega
          ? 'Pedido na fila! Chega em cerca de ' + tempo + ' minutos.'
          : 'Mostre esta senha no balcão. Fica pronto em cerca de ' + tempo + ' minutos.';
      case STATUS.PRODUCAO:
        return 'Estão preparando o seu pedido agora.';
      case STATUS.PRONTO:
        return entrega ? 'Saiu para entrega! Já está a caminho.' : 'Está pronto! Pode vir buscar.';
      case STATUS.FINALIZADO:
        return entrega ? 'Entregue. Bom apetite!' : 'Retirado. Bom apetite!';
      case STATUS.CANCELADO:
        return 'Este pedido foi cancelado. Fale com a loja pelo WhatsApp se tiver dúvida.';
      default:
        return '';
    }
  }

  /* Rotulo do botao que leva o pedido para o proximo passo (painel). */
  function rotuloProximoPasso(pedido) {
    var entrega = pedido.tipoEntrega === 'entrega';
    switch (pedido.status) {
      case STATUS.AGUARDANDO: return pedido.formaPagamento === 'cartao_online' ? '' : 'Pix caiu? Marcar como pago'; /* cartao: so o Mercado Pago confirma */
      case STATUS.PAGO: return 'Começar a fazer';
      case STATUS.PRODUCAO: return entrega ? 'Saiu para entrega' : 'Está pronto';
      case STATUS.PRONTO: return entrega ? 'Entregue, concluir' : 'Retirado, concluir';
      default: return '';
    }
  }

  function proximoStatus(pedido) {
    var lista = TRANSICOES[pedido.status] || [];
    return lista.filter(function (s) { return s !== STATUS.CANCELADO; })[0] || null;
  }

  /* ------------------------------------------------------------
   * WhatsApp: mensagens prontas e link
   * ---------------------------------------------------------- */

  function horaCurta(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function descreverItem(item) {
    var linhas = [item.quantidade + 'x ' + item.nome + '  ' + dinheiro(item.totalItem)];
    if (item.tamanho && item.tamanho.nome) linhas.push('   • ' + item.tamanho.nome);
    if (item.adicionais && item.adicionais.length) {
      linhas.push('   • Com: ' + item.adicionais.map(function (a) { return a.nome; }).join(', '));
    }
    if (item.removidos && item.removidos.length) linhas.push('   • SEM: ' + item.removidos.join(', '));
    if (item.observacao) linhas.push('   • Obs: ' + item.observacao);
    return linhas.join('\n');
  }

  function enderecoEmLinha(e) {
    if (!e || !e.rua) return '';
    var partes = [e.rua + (e.numero ? ', ' + e.numero : '')];
    if (e.complemento) partes.push(e.complemento);
    if (e.bairro) partes.push(e.bairro);
    if (e.referencia) partes.push('ref.: ' + e.referencia);
    return partes.join(' · ');
  }

  /* Mensagem que a LOJA manda para o cliente (botao do WhatsApp do pedido): muda com o status. */
  function mensagemParaCliente(loja, pedido) {
    var primeiro = String((pedido.cliente && pedido.cliente.nome) || '').split(' ')[0];
    var entrega = pedido.tipoEntrega === 'entrega';
    var oi = 'Oi, ' + primeiro + '! Aqui é da ' + loja.nome + '. ';
    var tempo = entrega ? (loja.tempoEntrega || 40) : (loja.tempoPreparo || 20);
    switch (pedido.status) {
      case STATUS.AGUARDANDO:
        return oi + 'Recebemos seu pedido (senha ' + pedido.senha + '). Assim que o ' + (pedido.formaPagamento === 'cartao_online' ? 'pagamento de ' + dinheiro(pedido.total) + ' no cartão for aprovado' : 'Pix de ' + dinheiro(pedido.total) + ' cair') + ', ele entra na fila.';
      case STATUS.PAGO:
        return oi + 'Recebemos seu pedido (senha ' + pedido.senha + ') e ele já está na fila. ' +
          (entrega ? 'Chega em cerca de ' + tempo + ' minutos.' : 'Fica pronto em cerca de ' + tempo + ' minutos.');
      case STATUS.PRODUCAO:
        return oi + 'Seu pedido (senha ' + pedido.senha + ') já está sendo preparado. ' + (entrega ? 'Logo sai para entrega.' : 'Logo fica pronto para retirar.');
      case STATUS.PRONTO:
        return oi + 'Seu pedido (senha ' + pedido.senha + ') ' + (entrega ? 'saiu para entrega! Já está a caminho.' : 'está pronto! Pode vir buscar.');
      case STATUS.FINALIZADO:
        /* com o link do Google: o agradecimento ja pede a avaliacao (e o que faz a loja subir no Maps) */
        var avaliar = linkGoogleAvaliar(loja.googleUrl);
        return oi + 'Obrigado pelo pedido! Bom apetite.' + (avaliar ? ' Se gostou, deixe sua avaliação no Google, ajuda muito a gente: ' + avaliar : ' Qualquer coisa, é só chamar aqui.');
      case STATUS.CANCELADO:
        return oi + 'Seu pedido (senha ' + pedido.senha + ') foi cancelado. Se tiver dúvida, é só responder aqui.';
      default:
        return oi + 'É sobre o seu pedido de senha ' + pedido.senha + '.';
    }
  }
  /* O que o botao do WhatsApp do pedido manda agora (curto: cabe no botao do celular). */
  function rotuloAvisoWhats(pedido) {
    var entrega = pedido.tipoEntrega === 'entrega';
    switch (pedido.status) {
      case STATUS.AGUARDANDO: return pedido.formaPagamento === 'cartao_online' ? 'Lembrar do pagamento' : 'Lembrar do Pix';
      case STATUS.PAGO: return 'Pedido recebido';
      case STATUS.PRODUCAO: return 'Preparando';
      case STATUS.PRONTO: return entrega ? 'Saiu para entrega' : 'Pronto para retirar';
      case STATUS.FINALIZADO: return 'Agradecer';
      case STATUS.CANCELADO: return 'Pedido cancelado';
      default: return 'Falar com o cliente';
    }
  }

  /* Mensagem que o CLIENTE manda para a loja (botao "Falar com a loja"). */
  function mensagemDoCliente(loja, pedido) {
    var pagamento = pedido.pagamentoStatus === 'na_entrega'
      ? (pedido.formaPagamento === 'dinheiro_entrega' ? 'Vou pagar em dinheiro na entrega.' : 'Vou pagar na maquininha na entrega.')
      : (pedido.status === STATUS.AGUARDANDO ? 'Estou pagando ' + (pedido.formaPagamento === 'cartao_online' ? 'com o cartão pelo site.' : 'no Pix.') : 'Já pago ' + (pedido.formaPagamento === 'cartao_online' ? 'com o cartão pelo site.' : 'no Pix.'));
    return 'Olá! Sou ' + pedido.cliente.nome + ', fiz o pedido *senha ' + pedido.senha + '* pelo site da ' +
      loja.nome + '. Total ' + dinheiro(pedido.total) + '. ' + pagamento;
  }

  /* Ficha completa do pedido em texto, para a loja copiar ou imprimir. */
  function fichaDoPedido(loja, pedido) {
    var l = [];
    l.push('*' + loja.nome.toUpperCase() + ' · SENHA ' + pedido.senha + '*');
    l.push(rotuloStatus(pedido) + ' • ' + horaCurta(pedido.criadoEm));
    l.push('');
    l.push('*Cliente:* ' + pedido.cliente.nome);
    l.push('*WhatsApp:* ' + formatarTelefone(pedido.cliente.telefone));
    l.push('');
    if (pedido.tipoEntrega === 'entrega') {
      var e = pedido.endereco || {};
      l.push('*ENTREGA*');
      l.push(e.rua + ', ' + e.numero + (e.complemento ? ' - ' + e.complemento : ''));
      l.push('Bairro: ' + e.bairro);
      if (e.referencia) l.push('Referência: ' + e.referencia);
    } else {
      l.push('*RETIRADA NO BALCÃO*');
    }
    l.push('');
    l.push('*ITENS*');
    for (var i = 0; i < pedido.itens.length; i++) l.push(descreverItem(pedido.itens[i]));
    if (pedido.observacao) { l.push(''); l.push('*Observação:* ' + pedido.observacao); }
    l.push('');
    l.push('Subtotal: ' + dinheiro(pedido.subtotal));
    if (pedido.desconto > 0) l.push('Cupom ' + pedido.cupom + ' (' + pedido.cupomPercentual + '%): -' + dinheiro(pedido.desconto));
    if (pedido.taxaEntrega > 0) l.push('Entrega: ' + dinheiro(pedido.taxaEntrega));
    if (pedido.acrescimoCartao > 0) l.push('Taxa do cartão: ' + dinheiro(pedido.acrescimoCartao));
    if (pedido.total === 0) {
      l.push('*CORTESIA: NADA A COBRAR*');
    } else if (pedido.pagamentoStatus === 'na_entrega') {
      l.push('*TOTAL A COBRAR: ' + dinheiro(pedido.total) + '*');
      if (pedido.formaPagamento === 'dinheiro_entrega') {
        l.push(pedido.trocoPara > 0
          ? 'EM DINHEIRO. Cliente paga com ' + dinheiro(pedido.trocoPara) + '. *LEVAR ' + dinheiro(pedido.trocoPara - pedido.total) + ' DE TROCO*'
          : 'EM DINHEIRO, valor certo.');
      } else {
        l.push('COBRAR NA MAQUININHA. Leve a maquininha.');
      }
    } else if (pedido.status === STATUS.AGUARDANDO) {
      l.push('*TOTAL: ' + dinheiro(pedido.total) + '* (' + (pedido.formaPagamento === 'cartao_online' ? 'cartão ainda não aprovado' : 'Pix ainda não conferido') + ')');
    } else {
      l.push('*TOTAL PAGO: ' + dinheiro(pedido.total) + '* (' + (pedido.formaPagamento === 'cartao_online' ? 'cartão pelo site' : 'Pix') + ')');
    }
    return textoSimples(l.join('\n'));
  }

  /*
   * Cardapio inteiro em texto, pra colar no WhatsApp quando o cliente pergunta
   * "o que tem?". Vem com link no fim; a loja copia no painel em um toque.
   */
  function cardapioEmTexto(loja, link) {
    var linhas = ['*' + loja.nome + '*'];
    if (loja.descricao) linhas.push(loja.descricao);
    linhas.push('');
    var ativos = produtosAtivos(loja);
    (loja.categorias || []).forEach(function (c) {
      var itens = ativos.filter(function (p) { return p.categoria === c.id; });
      if (!itens.length) return;
      linhas.push('*' + (c.emoji ? c.emoji + ' ' : '') + c.nome.toUpperCase() + '*');
      itens.forEach(function (p) { linhas.push('• ' + p.nome + ': ' + dinheiro(p.preco)); });
      linhas.push('');
    });
    if (loja.aceitaEntrega !== false) {
      var frete = descreverFrete(loja);
      linhas.push(frete === 'Entrega grátis' ? '🛵 Entrega grátis' : 'Entrega: ' + frete.replace(/^Taxa /, ''));
    }
    if (link) linhas.push('Peça pelo link, é rápido e ' + frasePagamento(loja) + ': ' + link);
    return textoSimples(linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  }

  /* texto que sai do site (WhatsApp, copiar e colar): espaco comum no lugar do que nao quebra (esse e so pra tela) */
  function textoSimples(t) { return String(t || '').replace(/\u00A0/g, ' '); }
  /* Pedido inteiro em texto para o WhatsApp da loja (site em pausa: o pedido nao se perde, vai pronto para a loja) */
  function pedidoParaWhatsapp(loja, p) {
    var formas = { pix: 'Pix', cartao_online: 'Cartão (pelo site)', cartao_entrega: 'Maquininha (cartão)', dinheiro_entrega: 'Dinheiro' };
    var l = ['Olá, ' + ((loja && loja.nome) || '') + '! Quero fazer este pedido (o site está em pausa agora):', ''];
    (p.itens || []).forEach(function (it) { l.push(descreverItem(it)); });
    l.push('');
    if (p.taxaEntrega) l.push('Entrega: ' + dinheiro(p.taxaEntrega));
    if (p.desconto) l.push('Desconto: -' + dinheiro(p.desconto));
    if (p.acrescimoCartao) l.push('Taxa do cartão: ' + dinheiro(p.acrescimoCartao));
    l.push('Total: ' + dinheiro(p.total));
    l.push(p.tipoEntrega === 'entrega' ? 'Entregar em: ' + enderecoEmLinha(p.endereco) : 'Vou retirar na loja');
    l.push('Pagamento: ' + (formas[p.formaPagamento] || p.formaPagamento || '') + (p.trocoPara ? ' (troco para ' + dinheiro(p.trocoPara) + ')' : ''));
    if (p.cliente && p.cliente.nome) l.push('Nome: ' + p.cliente.nome);
    if (p.observacao) l.push('Obs: ' + p.observacao);
    return l.join('\n');
  }
  function linkWhatsapp(numero, texto) {
    var limpo = String(numero || '').replace(/\D/g, '');
    if (!limpo) return '';
    if (limpo.length <= 11) limpo = '55' + limpo;
    return 'https://wa.me/' + limpo + '?text=' + encodeURIComponent(textoSimples(texto));
  }

  /* ------------------------------------------------------------
   * Senha do dia
   *
   * A senha reinicia a cada dia. Dado o ultimo contador gravado e a data
   * dele, devolve o proximo numero.
   * ---------------------------------------------------------- */

  function diaLocal(data) {
    var d = data || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /*
   * So recomeca quando o dia gravado ficou para tras. Celular com a data adiantada nao zera
   * a contagem da noite: se o dia gravado e hoje, ou amanha a partir das 21 h, continua nele (sem senha repetida).
   * O limite e o mesmo das regras do banco (dia de daqui a 3 h): "amanha" antes das 21 h o banco recusa,
   * entao recomeca de hoje. Dia gravado alem disso (ou ilegivel) esta errado: recomeca de hoje.
   */
  function proximaSenha(contador, agora) {
    var base = agora || new Date();
    var hoje = diaLocal(base);
    var limite = diaLocal(new Date(base.getTime() + 3 * 3600e3));
    var dia = contador && /^\d{4}-\d{2}-\d{2}$/.test(String(contador.dia || '')) ? String(contador.dia) : '';
    if (!dia || dia < hoje || dia > limite) return { dia: hoje, ultima: 1 };
    return { dia: dia, ultima: (Number(contador.ultima) || 0) + 1 };
  }

  /* Identificador do Pix: so letras e numeros, ate 25 caracteres. */
  function txidPix(pedido) {
    var base = 'LIG' + String(pedido.senha || 0) + String(pedido.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    return base.slice(0, 25);
  }

  /* ------------------------------------------------------------
   * Vendas: resumo simples para o painel
   * ---------------------------------------------------------- */

  /*
   * Quanto o dono paga por mes em cada opcao, em centavos. Numeros de set/2026:
   * iFood Basico 15,2% (+ R$ 110 de mensalidade acima de R$ 1.800 em vendas),
   * iFood Entrega 26,5% (+ R$ 150), Anota AI por faixa de pedidos, Ligeiro fixo.
   */
  /*
   * Assinatura da loja. plano = { status, tipo, desde, pagoAte, avisoPagamentoEm }.
   *   gratis    -> dentro dos dias gratis (sem cartao)
   *   ativa     -> paga (ou cortesia: status 'ativo' sem pagoAte, pelo admin)
   *   vencendo  -> faltam ate 7 dias
   *   vencida   -> passou, mas ainda no ar (10 dias de tolerancia)
   *   bloqueada -> o site para de aceitar pedidos ate confirmar o pagamento
   */
  var ASSINATURA = { diasGratis: 7, diasAviso: 7, diasTolerancia: 10 };
  function assinatura(loja, agora) {
    var cfg = (typeof window !== 'undefined' && window.LIGEIRO_CONFIG) || {};
    var diasGratis = (cfg.precos && cfg.precos.diasGratis) || ASSINATURA.diasGratis;
    var p = (loja && loja.plano) || null;
    var hoje = agora || new Date();
    /* conta e lojas do proprio Ligeiro (adminEmail): cortesia permanente, nunca vence nem bloqueia */
    if (ehDoLigeiro(loja)) return { estado: 'ativa', cortesia: true, ligeiro: true, dias: null, tipo: (p && p.tipo) || 'mensal' };
    /* loja de antes da assinatura existir (sem plano): fica liberada ate o admin cadastrar um plano */
    if (!p) return { estado: 'ativa', cortesia: true, dias: null, tipo: 'mensal' };
    if (p.status === 'pausado') return { estado: 'pausada', dias: 0, tipo: p.tipo || 'mensal' };
    var pagoAte = p.pagoAte ? new Date(p.pagoAte) : null;
    if (p.status === 'ativo' && !pagoAte) return { estado: 'ativa', cortesia: true, dias: null, tipo: p.tipo || 'mensal' };
    var inicio = new Date(p.desde || (loja && loja.criadoEm) || hoje);
    /* data que nao se le (ex.: '2026-09-19x') bloqueia; antes virava "hoje" e o gratis recomecava sempre */
    if (isNaN(inicio.getTime())) inicio = new Date(0);
    var fimGratis = new Date(inicio.getTime() + diasGratis * 864e5);
    var limite = pagoAte && pagoAte > fimGratis ? pagoAte : fimGratis;
    /* conta em dias de calendario (meia-noite local), pra bater com a data que aparece na tela */
    function meiaNoite(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
    var dias = Math.round((meiaNoite(limite) - meiaNoite(hoje)) / 864e5);
    var gratis = !pagoAte || pagoAte <= fimGratis;
    /* quem ja pagou ganha uns dias de tolerancia (banco atrasa); o periodo gratis acaba no dia */
    var tolerancia = gratis ? 0 : ASSINATURA.diasTolerancia;
    var r = { dias: dias, limite: limite.toISOString(), tipo: p.tipo || 'mensal', gratis: gratis, tolerancia: tolerancia };
    /* encerrada pelo dono: fica no ar ate o fim do que ja pagou (ou do periodo gratis), depois cancela */
    if (p.status === 'cancelado') {
      if (dias >= 0) { r.estado = 'ativa'; r.encerrando = true; return r; }
      r.estado = 'cancelada'; r.dias = 0; return r;
    }
    if (dias < 0) r.estado = dias >= -tolerancia ? 'vencida' : 'bloqueada';
    else if (r.gratis) r.estado = 'gratis';
    else r.estado = dias > ASSINATURA.diasAviso ? 'ativa' : 'vencendo';
    return r;
  }
  /* Planos da conta (config.planos). Sem config, um plano so, com o preco de config.precos. */
  function planos() {
    var cfg = (typeof window !== 'undefined' && window.LIGEIRO_CONFIG) || {};
    if (Array.isArray(cfg.planos) && cfg.planos.length) return cfg.planos;
    var pr = cfg.precos || {};
    return [{ id: 'uma', nome: 'Uma loja', lojas: 1, mensal: pr.mensal || 7900, anual: pr.anual == null ? 79000 : pr.anual }];
  }
  function planoPorId(id) {
    var lista = planos();
    return lista.filter(function (p) { return p.id === id; })[0] || lista[0];
  }
  /* Link de assinatura (cartao/boleto) do plano, se o Ligeiro cadastrou em config.cobranca.links. */
  function linkDeCobranca(planoId, tipo, fundador) {
    var cfg = (typeof window !== 'undefined' && window.LIGEIRO_CONFIG) || {};
    var links = (cfg.cobranca && (fundador ? cfg.cobranca.linksFundador : cfg.cobranca.links)) || {};
    var l = links[planoPorId(planoId).id] || {};
    return String(l[tipo === 'anual' ? 'anual' : 'mensal'] || '').trim();
  }
  /* Qual plano vale pra contar lojas: pago = o que o admin confirmou (planoPago); no gratis = o escolhido. */
  function planoQueVale(conta) {
    var p = (conta && conta.plano) || {};
    /* enquanto houver periodo pago correndo, vale o plano que foi PAGO, seja qual for o status
       (encerrar e reativar deixa o status em "teste", mas nao muda o que a pessoa pagou) */
    var pagoCorrendo = p.planoPago && p.pagoAte && new Date(p.pagoAte).getTime() > Date.now();
    if (p.planoPago && (p.status === 'ativo' || pagoCorrendo)) return planoPorId(p.planoPago).id;
    return planoPorId(p.planoId).id;
  }
  /* A conta (campo email) ou a loja (campo donoEmail) e do proprio Ligeiro?
     Na loja vale o donoEmail (travado nas regras); um campo email gravado pelo dono na loja nao conta. */
  function ehDoLigeiro(o) {
    var cfg = (typeof window !== 'undefined' && window.LIGEIRO_CONFIG) || {};
    var admin = String(cfg.adminEmail || '').toLowerCase();
    if (!admin || !o) return false;
    var e = o.donoEmail != null ? o.donoEmail : o.email;
    return String(e || '').toLowerCase() === admin;
  }
  /* Quantas lojas a conta pode ter. A do Ligeiro nao tem limite. */
  function limiteDeLojas(conta) {
    if (ehDoLigeiro(conta)) return 999;
    return planoPorId(conta && conta.plano ? planoQueVale(conta) : 'uma').lojas;
  }

  /* Como a loja chama a lista do que vende: comida fala "cardapio"; o resto (roupa, presente, servico) fala "catalogo". */
  var TIPOS_DE_COMIDA = ['lanchonete', 'pizzaria', 'pizza cone', 'marmitaria', 'restaurante', 'sorveteria', 'açaí', 'acai', 'padaria', 'espetinho', 'sushi', 'hamburgueria', 'pastelaria', 'doceria', 'cafeteria', 'bar'];
  function catalogo(loja) {
    var tipo = String((loja && loja.tipo) || '').trim().toLowerCase();
    var comida = !tipo || TIPOS_DE_COMIDA.indexOf(tipo) >= 0;
    return comida ? { comida: true, nome: 'cardápio', Nome: 'Cardápio', icone: '🍔', vazio: '🍽️' } : { comida: false, nome: 'catálogo', Nome: 'Catálogo', icone: '🛍️', vazio: '🛍️' };
  }

  /* Tipo da loja pra mostrar ao cliente: "Outro" nao diz nada, vira "Loja". */
  function tipoVisivel(loja) {
    var t = String((loja && loja.tipo) || '').trim();
    return !t || t.toLowerCase() === 'outro' ? 'Loja' : t;
  }

  /* Pedido esperando Pix que ja passou do prazo (30 min do codigo; 35 min se o codigo nem chegou a ser gerado). */
  function pixVencido(pedido, agora) {
    if (!pedido || pedido.status !== STATUS.AGUARDANDO || !pagaPeloSite(pedido)) return false;
    var t = agora ? new Date(agora).getTime() : Date.now();
    if (pedido.pixExpiraEm) return t > new Date(pedido.pixExpiraEm).getTime();
    return pedido.criadoEm ? t > new Date(pedido.criadoEm).getTime() + 35 * 60 * 1000 : false;
  }

  /* Link do perfil da loja no Google (Maps, busca ou link curto de compartilhar): devolve o endereco com https
     se for mesmo do Google, senao ''. O selo diz "Avaliacoes no Google": nao pode levar o cliente para outro site. */
  var HOSTS_GOOGLE = /^(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$|^(?:maps\.app\.goo\.gl|goo\.gl|g\.page|g\.co|share\.google)$/;
  function linkGoogle(texto) {
    var t = String(texto || '').trim();
    if (!t || t.length > 400 || /\s/.test(t)) return '';
    if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
    /* host sem usuario (google.com@outro.site) e sem nada depois dele alem de porta, caminho, busca ou ancora */
    var m = /^https?:\/\/([^\/?#@:]+)(?::\d+)?([\/?#].*)?$/i.exec(t);
    if (!m) return '';
    var host = m[1].toLowerCase();
    if (!HOSTS_GOOGLE.test(host)) return '';
    if (host === 'goo.gl' && !/^\/maps\//i.test(m[2] || '')) return ''; /* goo.gl sozinho encurtava qualquer site; so o /maps e do Google */
    return 'https://' + host + (m[2] || '/');
  }

  /* O link "Pedir avaliacoes" do Perfil da Empresa (g.page/r/<id>/review) abre direto a tela de avaliar.
     O selo da loja ("Avaliacoes no Google") mostra o perfil (sem o /review); o convite depois da entrega leva ao /review.
     Link do Maps (Compartilhar) vale para os dois: abre a loja no Google, onde tem o botao Avaliar. */
  var G_PAGE = /^(https:\/\/g\.page\/r\/[^\/?#]+)(?:\/review)?\/?(?=[?#]|$)/i;
  function linkGooglePerfil(texto) { var l = linkGoogle(texto); var m = G_PAGE.exec(l); return m ? m[1] : l; }
  function linkGoogleAvaliar(texto) { var l = linkGoogle(texto); var m = G_PAGE.exec(l); return m ? m[1] + '/review' : l; }

  /* CNPJ: devolve os 14 numeros se for valido (confere os dois digitos verificadores), senao ''. */
  function cnpjValido(texto) {
    var n = String(texto || '').replace(/\D/g, '');
    if (n.length !== 14 || /^(\d)\1{13}$/.test(n)) return '';
    function digito(base) {
      var pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      var soma = 0;
      for (var i = 0; i < base.length; i++) soma += Number(base.charAt(i)) * pesos[i];
      var resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    }
    var d1 = digito(n.slice(0, 12));
    var d2 = digito(n.slice(0, 12) + d1);
    return (d1 === Number(n.charAt(12)) && d2 === Number(n.charAt(13))) ? n : '';
  }
  function formatarCnpj(texto) {
    var n = String(texto || '').replace(/\D/g, '').slice(0, 14);
    if (n.length !== 14) return n;
    return n.slice(0, 2) + '.' + n.slice(2, 5) + '.' + n.slice(5, 8) + '/' + n.slice(8, 12) + '-' + n.slice(12);
  }

  /* ---- vagas de loja (limite do sistema) ---- */
  /* max: limite (0 = sem limite); lojas: quantas existem (a Central conta); fechado: cliente novo vai para a lista de espera */
  /* lojasAgora (opcional): contagem feita agora (cadastro), no lugar da ultima contagem gravada pela Central */
  function capacidadeLojas(lojasAgora) {
    var w = typeof window !== 'undefined' ? window : {};
    var cfg = w.LIGEIRO_CONFIG || {};
    var pub = (w.LigeiroFundadores && w.LigeiroFundadores.capacidade) || {};
    var max = pub.max != null ? Number(pub.max) || 0 : (cfg.capacidade && Number(cfg.capacidade.maxLojas)) || 0;
    var lojas = typeof lojasAgora === 'number' ? lojasAgora : Number(pub.lojas) || 0;
    var fechado = pub.fechado === true || (max > 0 && lojas >= max);
    return { max: max, lojas: lojas, fechado: fechado, restam: max > 0 ? Math.max(0, max - lojas) : null, perto: max > 0 && lojas >= Math.ceil(max * 0.8) };
  }
  /* Central ao abrir: o que gravar dado o estado publico (pub), as lojas contadas (n) e o limite do config.
     Fecha sozinha ao bater o limite; so reabre sozinha o que ela mesma fechou (automatico). */
  function decidirCapacidade(pub, n, maxConfig) {
    var p = pub || {};
    var max = p.max != null ? Number(p.max) || 0 : Number(maxConfig) || 0;
    var m = {};
    if (Number(p.lojas) !== n) m.lojas = n;
    if (p.max == null && max > 0) m.max = max;
    if (max > 0 && n >= max && p.fechado !== true) { m.fechado = true; m.automatico = true; }
    else if (p.fechado === true && p.automatico === true && max > 0 && n < max) { m.fechado = false; m.automatico = false; }
    return m;
  }
  /* Admin mudou o limite para v: fecha se ja bateu (mantendo "na mao" se estava fechado na mao); reabre so o automatico. */
  function novoLimite(pub, n, v) {
    var p = pub || {};
    var m = { max: v };
    var naMao = p.fechado === true && p.automatico !== true;
    if (v > 0 && n >= v) { m.fechado = true; m.automatico = !naMao; }
    else if (p.fechado === true && p.automatico === true) { m.fechado = false; m.automatico = false; }
    return m;
  }

  /* ---- preco de fundador ---- */
  function vagasFundador() {
    var cfg = (typeof window !== 'undefined' && window.LIGEIRO_CONFIG) || {};
    var total = (cfg.fundador && Number(cfg.fundador.vagas)) || 0;
    var usados = (typeof window !== 'undefined' && window.LigeiroFundadores && Number(window.LigeiroFundadores.usados)) || 0;
    var jaOcupadas = (cfg.fundador && Number(cfg.fundador.jaOcupadas)) || 0;
    return Math.max(0, total - jaOcupadas - usados);
  }
  /* Esta conta paga (ou vai pagar) o preco de fundador? Quem ja tem a vaga, sempre. Quem nunca pagou, enquanto houver vaga. */
  function ehPrecoFundador(conta) {
    var p = (conta && conta.plano) || null;
    if (p && p.fundador === true) return true;
    /* so perde a chance quem JA PAGOU alguma vez sem ser fundador. Cortesia ou plano marcado pelo admin (planoPago sem
       pagamento) nao tira a vaga de ninguem. */
    if (p && p.ultimoPagamentoEm) return false;
    return vagasFundador() > 0;
  }
  function precoDoPlano(planoId, tipo, conta) {
    var p = planoPorId(planoId);
    if (p.fundador && ehPrecoFundador(conta)) p = Object.assign({}, p, p.fundador);
    return tipo === 'anual' && p.anual > 0 ? p.anual : p.mensal;
  }

  /* A loja ocupa uma vaga do limite de lojas (capacidade do banco gratis)?
     Ativa e no ar ocupa. Parada por falta de pagamento tambem ocupa se ja pagou alguma vez (ela volta quando pagar);
     so o teste gratis que acabou sem nunca pagar libera a vaga. Desativada pelo Ligeiro nao ocupa. */
  function ocupaVaga(loja, agora) {
    if (!loja || loja.ativa === false) return false;
    if (!lojaBloqueada(loja, agora)) return true;
    var p = loja.plano || {};
    return !!(p.planoPago || p.pagoAte || p.ultimoPagamentoEm);
  }

  function lojaBloqueada(loja, agora) {
    var e = assinatura(loja, agora).estado;
    return e === 'bloqueada' || e === 'cancelada' || e === 'pausada';
  }

  function compararCustos(vendasMes, pedidosMes) {
    var v = Math.max(0, Math.round(Number(vendasMes) || 0));
    var n = Math.max(0, Math.round(Number(pedidosMes) || 0));
    var mensalidade = v > 180000;
    var faixa = n <= 150 ? 'até 150 pedidos' : (n <= 250 ? 'de 151 a 250 pedidos' : 'acima de 250 pedidos');
    var anota = n <= 150 ? 9999 : (n <= 250 ? 19999 : 29999);
    return {
      ifoodBasico: Math.round(v * 0.152) + (mensalidade ? 11000 : 0),
      ifoodEntrega: Math.round(v * 0.265) + (mensalidade ? 15000 : 0),
      ifoodMensalidade: mensalidade,
      anotaAi: anota,
      anotaFaixa: faixa,
      ligeiro: precoDoPlano('uma', 'mensal'),
    };
  }

  function resumoVendas(pedidos, dias, agora) {
    var fim = agora ? new Date(agora) : new Date();
    var inicio = new Date(fim.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    inicio.setHours(0, 0, 0, 0);
    var validos = pedidos.filter(function (p) {
      if (p.status === STATUS.CANCELADO || p.status === STATUS.AGUARDANDO) return false;
      var t = new Date(p.criadoEm).getTime();
      return t >= inicio.getTime() && t <= fim.getTime();
    });
    var total = 0;
    var porDia = {};
    var porProduto = {};
    var porHora = {};
    var porForma = {};
    for (var i = 0; i < validos.length; i++) {
      var p = validos[i];
      total += p.total;
      var dia = diaLocal(new Date(p.criadoEm));
      porDia[dia] = (porDia[dia] || 0) + p.total;
      var hora = new Date(p.criadoEm).getHours();
      porHora[hora] = (porHora[hora] || 0) + 1;
      porForma[p.formaPagamento] = (porForma[p.formaPagamento] || 0) + 1;
      for (var j = 0; j < p.itens.length; j++) {
        var it = p.itens[j];
        porProduto[it.nome] = (porProduto[it.nome] || 0) + it.quantidade;
      }
    }
    /* empate: pela ordem do nome (a lista sai sempre igual, venha dos pedidos ou dos resumos do dia) */
    var top = Object.keys(porProduto).map(function (n) { return { nome: n, quantidade: porProduto[n] }; })
      .sort(function (a, b) { return b.quantidade - a.quantidade || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0); }).slice(0, 5);
    return {
      pedidos: validos.length,
      total: total,
      ticketMedio: validos.length ? Math.round(total / validos.length) : 0,
      porDia: porDia,
      porHora: porHora,
      porForma: porForma,
      maisVendidos: top,
    };
  }

  /*
   * Resumo de UM dia, guardado no banco (lojas/{slug}/resumos/{AAAA-MM-DD}).
   * O relatorio de 30 dias le 30 documentos pequenos em vez de todos os pedidos do mes.
   * Produtos e clientes em listas (nome de produto pode ter ponto, e mapa do banco nao gosta); produtos, so os 60 que mais saem.
   * Cliente: t telefone, n nome, b bairro, p pedidos, v valor gasto.
   */
  function resumoDoDia(pedidos) {
    var r = { pedidos: 0, total: 0, porHora: {}, porForma: {}, produtos: [], clientes: [] };
    var porProduto = {};
    var porCliente = {};
    (pedidos || []).forEach(function (p) {
      if (!p || p.status === STATUS.CANCELADO || p.status === STATUS.AGUARDANDO) return;
      r.pedidos += 1;
      r.total += Number(p.total) || 0;
      var hora = String(new Date(p.criadoEm).getHours());
      r.porHora[hora] = (r.porHora[hora] || 0) + 1;
      var forma = String(p.formaPagamento || 'outro');
      r.porForma[forma] = (r.porForma[forma] || 0) + 1;
      (p.itens || []).forEach(function (it) { if (it && it.nome) porProduto[it.nome] = (porProduto[it.nome] || 0) + (Number(it.quantidade) || 0); });
      var cli = p.cliente || {};
      if (cli.telefone) {
        var c = porCliente[cli.telefone] || (porCliente[cli.telefone] = { t: String(cli.telefone), n: String(cli.nome || ''), b: '', p: 0, v: 0 });
        c.p += 1;
        c.v += Number(p.total) || 0;
        if (p.endereco && p.endereco.bairro) c.b = String(p.endereco.bairro);
      }
    });
    r.clientes = Object.keys(porCliente).map(function (k) { return porCliente[k]; });
    r.produtos = Object.keys(porProduto).map(function (n) { return { n: n, q: porProduto[n] }; })
      .sort(function (a, b) { return b.q - a.q; }).slice(0, 60);
    return r;
  }
  /* varios dias ({AAAA-MM-DD: resumoDoDia}) na mesma cara do resumoVendas; porDiaQtd e o numero de pedidos de cada dia;
     clientes: do que mais gastou para o que menos gastou, com o bairro do pedido mais recente */
  function juntarResumos(dias) {
    var total = 0, n = 0, porDia = {}, porDiaQtd = {}, porHora = {}, porForma = {}, porProduto = {}, porCliente = {};
    Object.keys(dias || {}).sort().forEach(function (k) {
      var d = dias[k];
      if (!d) return;
      n += d.pedidos || 0;
      total += d.total || 0;
      porDia[k] = (porDia[k] || 0) + (d.total || 0);
      porDiaQtd[k] = (porDiaQtd[k] || 0) + (d.pedidos || 0);
      Object.keys(d.porHora || {}).forEach(function (h) { porHora[h] = (porHora[h] || 0) + d.porHora[h]; });
      Object.keys(d.porForma || {}).forEach(function (f) { porForma[f] = (porForma[f] || 0) + d.porForma[f]; });
      (d.produtos || []).forEach(function (x) { porProduto[x.n] = (porProduto[x.n] || 0) + x.q; });
      (d.clientes || []).forEach(function (x) {
        var c = porCliente[x.t] || (porCliente[x.t] = { nome: x.n, telefone: x.t, pedidos: 0, total: 0, bairro: '' });
        c.pedidos += x.p || 0;
        c.total += x.v || 0;
        if (x.b) c.bairro = x.b;
      });
    });
    return {
      pedidos: n,
      total: total,
      ticketMedio: n ? Math.round(total / n) : 0,
      porDia: porDia,
      porDiaQtd: porDiaQtd,
      porHora: porHora,
      porForma: porForma,
      maisVendidos: Object.keys(porProduto).map(function (x) { return { nome: x, quantidade: porProduto[x] }; })
        .sort(function (a, b) { return b.quantidade - a.quantidade || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0); }).slice(0, 5),
      clientes: Object.keys(porCliente).map(function (t) { return porCliente[t]; }).sort(function (a, b) { return b.total - a.total; }),
    };
  }

  /* cartao de credito pelo site: a loja ligou, o Mercado Pago esta conectado e a chave publica chegou (e ela que deixa o
     formulario do cartao abrir no celular do cliente) */
  function cartaoPeloSite(loja) {
    var l = loja || {};
    return l.aceitaCartaoOnline === true && !!l.mpAtivo && !!l.mpChavePublica;
  }
  /* pedido que espera pagamento pelo site: Pix ou cartao */
  function pagaPeloSite(pedido) { return !!pedido && (pedido.formaPagamento === 'pix' || pedido.formaPagamento === 'cartao_online'); }
  function nomeDoPagamento(pedido) { return pedido && pedido.formaPagamento === 'cartao_online' ? 'cartão' : 'Pix'; }

  /* como o cliente paga, em uma frase (divulgacao e cardapio em texto): a mesma conta do site, sem prometer Pix a quem
     nao tem Mercado Pago */
  function frasePagamento(loja) {
    var l = loja || {};
    var pix = l.aceitaPix !== false && !!l.mpAtivo;
    var cartao = cartaoPeloSite(l);
    var aoReceber = !!(l.aceitaCartaoEntrega || l.aceitaDinheiroEntrega);
    var agora = pix && cartao ? 'no Pix, no cartão' : pix ? 'no Pix' : cartao ? 'no cartão' : '';
    if (agora && aoReceber) return 'paga ' + agora + ' ou ao receber';
    if (agora) return 'paga ' + (pix && cartao ? 'no Pix ou no cartão' : agora);
    return aoReceber ? 'paga ao receber' : 'paga na loja';
  }

  /* tipos de loja do cadastro e da Central (nome e emoji): moram aqui para o cadastro nao precisar baixar a Central */
  var TIPOS_DE_LOJA = [['Lanchonete', '🍔'], ['Pizzaria', '🍕'], ['Marmitaria', '🍱'], ['Restaurante', '🍽️'], ['Sorveteria', '🍨'], ['Açaí', '🍇'], ['Padaria', '🥐'], ['Espetinho', '🍢'], ['Sushi', '🍣'], ['Outro', '🛵']];

  return {
    TIPOS_DE_LOJA: TIPOS_DE_LOJA,
    frasePagamento: frasePagamento,
    cartaoPeloSite: cartaoPeloSite,
    taxaCartaoRepassada: taxaCartaoRepassada,
    TAXA_CARTAO_MAX: TAXA_CARTAO_MAX,
    TAXA_CARTAO_PADRAO: TAXA_CARTAO_PADRAO,
    pagaPeloSite: pagaPeloSite,
    nomeDoPagamento: nomeDoPagamento,
    STATUS: STATUS,
    TRANSICOES: TRANSICOES,
    EM_ANDAMENTO: EM_ANDAMENTO,
    ErroDoCliente: ErroDoCliente,
    dinheiro: dinheiro,
    limparTexto: limparTexto,
    semAcento: semAcento,
    mencionaCidade: mencionaCidade,
    slug: slug,
    validarTelefone: validarTelefone,
    formatarTelefone: formatarTelefone,
    lojaAberta: lojaAberta,
    proximaAbertura: proximaAbertura,
    fechamentoDeHoje: fechamentoDeHoje,
    assinatura: assinatura,
    lojaBloqueada: lojaBloqueada,
    planos: planos,
    planoPorId: planoPorId,
    precoDoPlano: precoDoPlano,
    planoQueVale: planoQueVale,
    cnpjValido: cnpjValido,
    linkGoogle: linkGoogle,
    linkGooglePerfil: linkGooglePerfil,
    linkGoogleAvaliar: linkGoogleAvaliar,
    formatarCnpj: formatarCnpj,
    pixVencido: pixVencido,
    catalogo: catalogo,
    tipoVisivel: tipoVisivel,
    ehDoLigeiro: ehDoLigeiro,
    limiteDeLojas: limiteDeLojas,
    vagasFundador: vagasFundador,
    capacidadeLojas: capacidadeLojas,
    decidirCapacidade: decidirCapacidade,
    novoLimite: novoLimite,
    ehPrecoFundador: ehPrecoFundador,
    linkDeCobranca: linkDeCobranca,
    dentroDoHorario: dentroDoHorario,
    gruposDaCategoria: gruposDaCategoria,
    produtosAtivos: produtosAtivos,
    categoriaAtiva: categoriaAtiva,
    buscarProduto: buscarProduto,
    calcularItens: calcularItens,
    calcularTaxaEntrega: calcularTaxaEntrega,
    descreverFrete: descreverFrete,
    avaliarCupom: avaliarCupom,
    orcar: orcar,
    montarPedido: montarPedido,
    conferirTotal: conferirTotal,
    rotuloStatus: rotuloStatus,
    textoDoEstagio: textoDoEstagio,
    rotuloProximoPasso: rotuloProximoPasso,
    proximoStatus: proximoStatus,
    mensagemParaCliente: mensagemParaCliente,
    rotuloAvisoWhats: rotuloAvisoWhats,
    rotuloStatusCliente: rotuloStatusCliente,
    mensagemDoCliente: mensagemDoCliente,
    fichaDoPedido: fichaDoPedido,
    enderecoEmLinha: enderecoEmLinha,
    linkWhatsapp: linkWhatsapp,
    pedidoParaWhatsapp: pedidoParaWhatsapp,
    cardapioEmTexto: cardapioEmTexto,
    proximaSenha: proximaSenha,
    diaLocal: diaLocal,
    txidPix: txidPix,
    resumoVendas: resumoVendas,
    resumoDoDia: resumoDoDia,
    ocupaVaga: ocupaVaga,
    juntarResumos: juntarResumos,
    compararCustos: compararCustos,
  };
});
