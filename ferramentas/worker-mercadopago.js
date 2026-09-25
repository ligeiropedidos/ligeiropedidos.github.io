/*
 * Ligeiro - mensageiro (Cloudflare Workers, plano gratis).
 *
 * Duas funcoes no mesmo worker:
 *
 * 1) CARDAPIO NA BORDA (o que tira o peso do banco gratis)
 *   GET  /loja/{slug}        -> a loja (cardapio, horarios, precos) guardada no KV do Cloudflare.
 *                               O cliente le daqui, e nao do Firestore: o banco nao gasta leitura nem download por visita.
 *                               A copia confere o banco de novo so quando alguem pede e ela tem mais de 6 h
 *                               (e na hora, quando o dono salva algo no painel: rota /publicar).
 *   GET  /fotos/{slug}?v=... -> as miniaturas do cardapio, num pacote so. Guardado pela versao das fotos:
 *                               o celular do cliente guarda para sempre e so baixa de novo quando a loja troca alguma.
 *   GET  /foto/{slug}/{id}   -> uma foto grande (item aberto, capa). Cada foto tem nome unico: fica guardada para sempre.
 *   GET  /vitrine            -> o resumo das lojas (pagina das cidades e pagina de vendas), conferido a cada 3 h.
 *   POST /publicar { loja } + Authorization: Bearer <idToken do dono> -> o painel avisa que salvou; a copia se atualiza.
 *   POST /dono     { loja } + Authorization: Bearer <idToken do dono> -> grava a marca "lojas" no login do dono (uma vez
 *                               por loja): as regras do banco reconhecem o dono por ela, sem ler a loja a cada pedido.
 *                  { email }  + login do admin -> refaz a marca desse e-mail pelas lojas dele de verdade (troca de dono).
 *
 * 2) PIX AUTOMATICO pela conta Mercado Pago de cada loja
 *   POST /criar    { loja, pedido }  -> cria o Pix no Mercado Pago com o token da loja e grava o "copia e cola" no pedido.
 *   POST /cartao   { loja, pedido, token, metodo, email, documento } -> cobra o cartao de credito (codigo de uso
 *                                       unico do formulario do Mercado Pago) e marca o pedido pago.
 *                                       /criar e /cartao refazem a conta do pedido com as regras do site (js/regras.js,
 *                                       embutidas aqui por ferramentas/embutir-regras.py) e so cobram se o total bater.
 *   POST /devolver { loja, pedido } + Authorization: Bearer <idToken do dono> -> a loja cancelou um pedido pago pelo
 *                                       site (Pix ou cartao): devolve o valor inteiro ao cliente pelo Mercado Pago.
 *   POST /pedido   { loja, dados, aviso } -> CRIA o pedido. O celular manda so o que a pessoa escolheu; o pedido e
 *                                       montado aqui com as regras (js/regras.js) e o cardapio da loja, com a senha do
 *                                       dia e o uso do cupom gravados no mesmo lote. O banco nao aceita pedido de fora.
 *                                       No balcao (origem "balcao") so com o login da equipe ou do dono.
 *   POST /cupom    { loja, codigo }  -> o codigo vale? Devolve o desconto (a lista de cupons nao e publica: mora na parte
 *                                       privada da loja). Poucas tentativas por aparelho: ninguem descobre codigo no chute.
 *   POST /webhook                    -> o Mercado Pago avisa que pagou; o pedido vira "pago" e cai na cozinha.
 *                                       O aviso ja traz a loja e o pedido (external_reference): nao precisa de indice.
 *   GET  /status?loja&pedido&mp&expira -> reforco: o site do cliente pergunta enquanto espera. Com mp e expira,
 *                                       pergunta direto ao Mercado Pago e so le o banco quando o Pix caiu.
 *   POST /equipe   { loja, pin } + Authorization: Bearer <idToken do dono> -> senha da equipe da loja.
 *   GET  /mp/volta                   -> volta do "Conectar com Mercado Pago" (OAuth).
 *   POST /                           -> repasse antigo (o painel manda o POST com o proprio token).
 *
 * 3) AVISOS NO CELULAR (Web Push, gratis: o Google e a Apple entregam de graca, mesmo com a tela apagada)
 *   GET  /vapid                      -> a chave publica dos avisos. O par de chaves nasce sozinho no KV na primeira vez.
 *   POST /aparelho { loja, papel, inscricao, testar, remover } + Bearer (dono ou equipe)
 *                                    -> guarda este aparelho da loja (painel, cozinha ou entregas) no KV.
 *   POST /novo     { loja, pedido }  -> o site do cliente avisa que fez um pedido (pago ou para cobrar na entrega):
 *                                       o painel e a cozinha apitam. So le o banco se a loja tiver aparelho ligado.
 *   POST /inscrever { loja, pedido, cidade, inscricao, remover } -> o cliente quer saber do pedido no celular.
 *   POST /avisar   { loja, pedido, status, resumo, aviso } + Bearer (dono ou equipe)
 *                                    -> o pedido andou: avisa o cliente (se ele quis) e o entregador (saiu para entrega).
 *   Pix que cai pelo Mercado Pago avisa a loja e o cliente sozinho, sem ninguem chamar nada.
 *
 * Como publicar (Cloudflare, sem cartao):
 *   1. Storage & Databases > KV > Create a namespace > nome "ligeiro-cardapio".
 *   2. Workers & Pages > ligeiro-mp > Edit code > apague tudo, cole este arquivo > Deploy.
 *   3. ligeiro-mp > Settings > Bindings > Add binding > KV namespace:
 *        Variable name: CARDAPIO      KV namespace: ligeiro-cardapio      > Save (ele publica sozinho).
 *   4. Os segredos continuam os mesmos (Settings > Variables and Secrets):
 *        FIREBASE_SA       o JSON inteiro da conta de servico do Firebase
 *        MP_CLIENT_ID      Client ID da aplicacao "Ligeiro plataforma" no Mercado Pago
 *        MP_CLIENT_SECRET  Client Secret da mesma aplicacao
 *   Sem o KV ligado, o site percebe e continua lendo do Firestore como antes (nada quebra).
 *
 * Limites do plano gratis: Workers 100 mil chamadas por dia; KV 100 mil leituras e 1 mil gravacoes por dia, 1 GB.
 * Uma visita ao cardapio usa 1 a 2 chamadas; um pedido com Pix, umas 5 a 15.
 */
/* o primeiro e para onde volta o "Conectar Mercado Pago" (o GitHub manda o github.io para o dominio proprio sozinho) */
const ORIGENS = ['https://ligeiropedidos.github.io', 'https://ligeiropedidos.com.br', 'https://www.ligeiropedidos.com.br', 'https://ligeiro.app.br', 'http://localhost:8765'];
const MP = 'https://api.mercadopago.com';
const ADMIN = 'ligeiro.pedidos@gmail.com';
/* a copia da loja confere o banco de novo depois disso (so se alguem pedir); o painel atualiza na hora ao salvar */
/* A copia da loja confere o banco a cada 6 h e a vitrine a cada 3 h. Toda mudanca de verdade ja chega na hora: o
   painel avisa ao salvar (/publicar), o Asaas apaga a copia quando o pagamento cai e o Conectar do Mercado Pago
   refaz a loja. O prazo so cobre o que mudou por fora (na mao, pelo console). Antes: 20 e 15 min, o que gastava
   leitura do banco e gravacao do KV (1 mil por dia no gratis) sem nada ter mudado */
const LOJA_VALE = 6 * 3600 * 1000;
const VITRINE_VALE = 3 * 3600 * 1000;
const SLUG = /^[a-z0-9-]{1,60}$/;
/* memoria do worker: dura enquanto o Cloudflare deixa ele ligado (minutos). Nunca e a unica copia de nada. */
const MEM = {
  cupons: {}, google: null, mp: {}, lojas: {}, vitrine: null, atualizando: {}, montando: {}, pausa: null, pausaGravadaEm: 0, pausaConferidaEm: 0, vapid: null, jwt: {}, quem: {}, avisados: {}, inscritos: {}, cartao: {}, vezes: {} };
/* Conta quantas vezes uma chave (IP, loja) chamou numa janela de tempo. Serve para barrar quem gasta o banco gratis
   de proposito (loja inventada, publicar em sequencia). Vale por copia do worker; o grosso fica pela regra do banco. */
function demais(chave, maximo, janelaMs) {
  const agora = Date.now();
  const lista = (MEM.vezes[chave] || []).filter((t) => agora - t < janelaMs);
  if (lista.length >= maximo) { MEM.vezes[chave] = lista; return true; }
  lista.push(agora);
  MEM.vezes[chave] = lista;
  if (Object.keys(MEM.vezes).length > 5000) MEM.vezes = {};
  return false;
}
const PEDIDO_ID = /^[A-Za-z0-9]{20}$/;
/* avisos so vao para os servicos de aviso dos navegadores (Google, Apple, Mozilla, Microsoft), nunca para endereco qualquer */
const SERVICO_AVISO = /^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\//i;
const PAPEIS = ['painel', 'cozinha', 'entregas'];

/* ===== REGRAS DO PEDIDO: copia de js/regras.js (gerada por ferramentas/embutir-regras.py; nao editar aqui) ===== */
const REGRAS = (function () {
  const module = { exports: {} };
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

  /* Texto que o cliente digita: uma linha so. Quebra de linha, caractere de controle e os que invertem a direcao do
     texto (RLO) viram espaco: ninguem escreve na observacao uma linha falsa "*TOTAL PAGO*" na ficha da loja */
  function umaLinha(valor) {
    return String(valor == null ? '' : valor).replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]+/g, ' ').replace(/ {2,}/g, ' ');
  }
  function limparTexto(valor, maximo) {
    return umaLinha(valor).trim().slice(0, maximo || 200);
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
  /* Versao dos termos de uso e da politica de privacidade. Mudou o texto de um jeito que importa: muda aqui e o painel
     pede o aceite de novo (o aceite fica na loja: termos.versao e termos.aceitoEm) */
  var TERMOS_VERSAO = '2026-09-24.2';   /* data + numero do dia: o que vem depois do ponto nao aparece na tela */
  function termosEmDia(loja) { var t = (loja || {}).termos; return !!t && t.versao === TERMOS_VERSAO; }
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
    /* troco com teto: "troco para R$ 1.000" num pedido de R$ 30 fazia o entregador sair com dinheiro demais */
    if (trocoPara > 0 && trocoPara > Math.max(orcamento.total * 2, orcamento.total + 20000)) {
      throw ErroDoCliente('O troco pode ser para até ' + dinheiro(Math.max(orcamento.total * 2, orcamento.total + 20000)) + '. Para mais, combine com a loja no WhatsApp.');
    }
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
    var linhas = [item.quantidade + 'x ' + umaLinha(item.nome) + '  ' + dinheiro(item.totalItem)];
    if (item.tamanho && item.tamanho.nome) linhas.push('   • ' + umaLinha(item.tamanho.nome));
    if (item.adicionais && item.adicionais.length) {
      linhas.push('   • Com: ' + item.adicionais.map(function (a) { return umaLinha(a.nome); }).join(', '));
    }
    if (item.removidos && item.removidos.length) linhas.push('   • SEM: ' + item.removidos.map(umaLinha).join(', '));
    if (item.observacao) linhas.push('   • Obs: ' + umaLinha(item.observacao));
    return linhas.join('\n');
  }

  function enderecoEmLinha(e) {
    if (!e || !e.rua) return '';
    var partes = [umaLinha(e.rua) + (e.numero ? ', ' + umaLinha(e.numero) : '')];
    if (e.complemento) partes.push(umaLinha(e.complemento));
    if (e.bairro) partes.push(umaLinha(e.bairro));
    if (e.referencia) partes.push('ref.: ' + umaLinha(e.referencia));
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
    l.push('*Cliente:* ' + umaLinha(pedido.cliente.nome));
    l.push('*WhatsApp:* ' + formatarTelefone(pedido.cliente.telefone));
    l.push('');
    if (pedido.tipoEntrega === 'entrega') {
      var e = pedido.endereco || {};
      l.push('*ENTREGA*');
      l.push(umaLinha(e.rua) + ', ' + umaLinha(e.numero) + (e.complemento ? ' - ' + umaLinha(e.complemento) : ''));
      l.push('Bairro: ' + umaLinha(e.bairro));
      if (e.referencia) l.push('Referência: ' + umaLinha(e.referencia));
    } else {
      l.push('*RETIRADA NO BALCÃO*');
    }
    l.push('');
    l.push('*ITENS*');
    for (var i = 0; i < pedido.itens.length; i++) l.push(descreverItem(pedido.itens[i]));
    if (pedido.observacao) { l.push(''); l.push('*Observação:* ' + umaLinha(pedido.observacao)); }
    l.push('');
    l.push('Subtotal: ' + dinheiro(pedido.subtotal));
    if (pedido.desconto > 0) l.push('Cupom ' + umaLinha(pedido.cupom) + ' (' + pedido.cupomPercentual + '%): -' + dinheiro(pedido.desconto));
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
    if (p.cliente && p.cliente.nome) l.push('Nome: ' + umaLinha(p.cliente.nome));
    if (p.observacao) l.push('Obs: ' + umaLinha(p.observacao));
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
   * iFood Entrega 26,2% (23% de comissao + 3,2% do pagamento online, blog de parceiros do iFood, jun/2026) (+ R$ 150), Anota AI por faixa de pedidos, Ligeiro fixo.
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
    var caminho = m[2] || '/';
    /* nada de caminho que redireciona para fora (/url?q=, /amp/s/, /aclk, /imgres) */
    if (/^\/(url|amp|aclk|imgres|interstitial)\b/i.test(caminho)) return '';
    /* no google.* so o mapa e a busca (o perfil da loja); o resto do Google nao e perfil de loja */
    if (/^(www\.)?google\./.test(host) && !/^\/(maps|search)\b/i.test(caminho)) return '';
    return 'https://' + host + caminho;
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
    /* numero ainda nao conferido: nenhuma vaga (fecha no seguro; o preco de fundador so aparece com vaga confirmada) */
    if (typeof window !== 'undefined' && window.LigeiroFundadores && window.LigeiroFundadores.usados == null) return 0;
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
      ifoodEntrega: Math.round(v * 0.262) + (mensalidade ? 15000 : 0),
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
    /* mapas sem prototipo: telefone "__proto__" (gravado por fora) nao contamina o resto do site */
    var r = { pedidos: 0, total: 0, porHora: Object.create(null), porForma: Object.create(null), produtos: [], clientes: [] };
    var porProduto = {};
    var porCliente = Object.create(null);
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
    r.porHora = comum(r.porHora);
    r.porForma = comum(r.porForma);
    return r;
  }
  /* varios dias ({AAAA-MM-DD: resumoDoDia}) na mesma cara do resumoVendas; porDiaQtd e o numero de pedidos de cada dia;
     clientes: do que mais gastou para o que menos gastou, com o bairro do pedido mais recente */
  function juntarResumos(dias) {
    var total = 0, n = 0, porDia = Object.create(null), porDiaQtd = Object.create(null), porHora = Object.create(null), porForma = Object.create(null), porProduto = Object.create(null), porCliente = Object.create(null);
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
      porDia: comum(porDia),
      porDiaQtd: comum(porDiaQtd),
      porHora: comum(porHora),
      porForma: comum(porForma),
      maisVendidos: Object.keys(porProduto).map(function (x) { return { nome: x, quantidade: porProduto[x] }; })
        .sort(function (a, b) { return b.quantidade - a.quantidade || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0); }).slice(0, 5),
      clientes: Object.keys(porCliente).map(function (t) { return porCliente[t]; }).sort(function (a, b) { return b.total - a.total; }),
    };
  }

  /* cartao de credito pelo site: a loja ligou, o Mercado Pago esta conectado e a chave publica chegou (e ela que deixa o
     formulario do cartao abrir no celular do cliente) */
  /* mapa sem prototipo de volta a objeto comum, so com chaves seguras (nunca __proto__, constructor ou prototype) */
  function comum(mapa) {
    var o = {};
    Object.keys(mapa).forEach(function (k) { if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') o[k] = mapa[k]; });
    return o;
  }
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
    TERMOS_VERSAO: TERMOS_VERSAO,
    termosEmDia: termosEmDia,
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
  return module.exports;
})();
/* ===== FIM DAS REGRAS DO PEDIDO ===== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origem = request.headers.get('Origin') || '';
    const conferir = !ORIGENS.some((o) => o.indexOf('SEU-USUARIO') >= 0);
    const cors = {
      'Access-Control-Allow-Origin': conferir ? (ORIGENS.indexOf(origem) >= 0 ? origem : 'null') : '*',
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Idempotency-Key',
      'Access-Control-Max-Age': '86400',
    };
    const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...(extra || {}) } });
    /* corpo ja pronto (texto ou fluxo do KV), sem montar de novo */
    const pronto = (corpo, guardar) => new Response(corpo, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': guardar } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const caminho = url.pathname.replace(/\/+$/, '') || '/';

    try {
      /* ---- volta do "Conectar com Mercado Pago" (OAuth): troca o codigo pelo token da loja ---- */
      if (caminho === '/mp/volta' && request.method === 'GET') {
        const site = ORIGENS[0];
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const ponto = state.indexOf('.');
        const slug = ponto > 0 ? state.slice(0, ponto) : '';
        const nonce = ponto > 0 ? state.slice(ponto + 1) : '';
        const voltar = (ok) => Response.redirect(site + '/#/painel/' + encodeURIComponent(slug || '') + '/mp-' + (ok ? 'ok' : 'erro'), 302);
        if (!code || !SLUG.test(slug) || !/^[A-Za-z0-9]{8,80}$/.test(nonce) || !env.MP_CLIENT_ID || !env.MP_CLIENT_SECRET) return voltar(false);
        const fb = await firebase(env);
        const seg = (await fb.get('lojas/' + slug + '/privado/mercadopago')) || {};
        const recente = seg.oauthEm && (Date.now() - new Date(seg.oauthEm).getTime()) < 30 * 60 * 1000;
        if (!seg.oauthNonce || seg.oauthNonce !== nonce || !recente) return voltar(false);
        const r = await fetch(MP + '/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: 'authorization_code', code: code, redirect_uri: url.origin + '/mp/volta' }),
        });
        const t = await r.json().catch(() => ({}));
        /* o codigo de uso unico vale uma vez so, deu certo ou nao */
        if (!r.ok || !t.access_token) { await fb.merge('lojas/' + slug + '/privado/mercadopago', { oauthNonce: '', oauthEm: '' }).catch(() => {}); return voltar(false); }
        const agora = new Date().toISOString();
        await fb.merge('lojas/' + slug + '/privado/mercadopago', {
          token: t.access_token, refresh: t.refresh_token || '', mpUserId: String(t.user_id || ''), publica: String(t.public_key || ''),
          tokenExpiraEm: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(),
          conectadoEm: agora, atualizadoEm: agora, oauthNonce: '', oauthEm: '',
        });
        esquecerToken(env, ctx, slug);
        /* a chave publica e publica mesmo (o formulario do cartao no site precisa dela): vai no documento da loja */
        await fb.merge('lojas/' + slug, Object.assign({ mpAtivo: true, aceitaPix: true, atualizadoEm: agora }, t.public_key ? { mpChavePublica: String(t.public_key) } : {}));
        await fb.merge('vitrine/' + slug, { aceitaPix: true, atualizadoEm: agora }).catch(() => {});
        /* o Pix aparece na loja na hora, sem esperar a copia da borda vencer */
        await atualizarLoja(env, slug).catch(() => {});
        return voltar(true);
      }

      /* ---- webhook do Mercado Pago (vem do servidor deles, sem Origin) ---- */
      if (caminho === '/webhook' && request.method === 'POST') {
        let slug = url.searchParams.get('loja') || '';
        let corpo = {};
        try { corpo = await request.json(); } catch (_) { corpo = {}; }
        const dados = corpo.data || {};
        const id = String(dados.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ ok: true, ignorado: true });
        if (slug && !SLUG.test(slug)) return json({ ok: true, ignorado: 'loja' });
        /* com o segredo do webhook (MP_WEBHOOK_SECRET) guardado, so aceita aviso assinado pelo Mercado Pago */
        if (env.MP_WEBHOOK_SECRET && !(await assinaturaMpConfere(request, env.MP_WEBHOOK_SECRET, url.searchParams.get('data.id') || id))) {
          /* aviso do app da propria loja (?loja=): a chave e a dela. Nada muda sem o Mercado Pago confirmar com o token da loja */
          if (!slug) return json({ ok: false, erro: 'assinatura' }, 401);
          if (demais('aviso:' + (request.headers.get('CF-Connecting-IP') || 'sem-ip'), 120, 60 * 1000)) return json({ ok: false, erro: 'devagar' }, 429);
        }
        let pedidoId = null;
        if (!slug) {
          /* o aviso de order traz o external_reference (loja__pedido): acha a loja sem ler o banco.
             Ninguem ganha nada inventando: o pagamento e conferido no Mercado Pago com o token da loja, pela referencia e pelo valor */
          const ref = String(dados.external_reference || '');
          const i = ref.indexOf('__');
          if (i > 0 && SLUG.test(ref.slice(0, i)) && PEDIDO_ID.test(ref.slice(i + 2))) { slug = ref.slice(0, i); pedidoId = ref.slice(i + 2); }
        }
        const fb = await firebase(env);
        if (!slug) {
          /* aviso sem referencia (ou cortada em 64 letras): acha pelo indice gravado na criacao */
          const idx = await fb.get('mp_indice/' + id);
          if (idx && SLUG.test(String(idx.loja || '')) && (!idx.pedido || PEDIDO_ID.test(String(idx.pedido)))) { slug = idx.loja; pedidoId = idx.pedido || null; }
        }
        if (!slug) return json({ ok: true, ignorado: 'sem loja' });
        await conferirPagamento(fb, slug, id, pedidoId, env);
        return json({ ok: true });
      }

      if (conferir && origem && ORIGENS.indexOf(origem) < 0) return json({ erro: 'origem não permitida' }, 403);

      /* ---- cardapio na borda (publico, so leitura) ---- */
      if (request.method === 'GET') {
        let m = /^\/loja\/([a-z0-9-]{1,60})$/.exec(caminho);
        if (m) {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          /* quem inventa endereco de loja para gastar o banco gratis: depois de 30 "nao existe" em 10 min, para de ler */
          const ipL = request.headers.get('CF-Connecting-IP') || 'sem-ip';
          const faltas = (MEM.vezes['falta:' + ipL] || []).filter((t) => Date.now() - t < 10 * 60 * 1000).length;
          if (!MEM.lojas[m[1]] && faltas >= 30) return json({ borda: 1, erro: 'nao-existe' }, 404, { 'Cache-Control': 'public, max-age=60' });
          const item = await lerLoja(env, ctx, m[1]);
          if (!item.existe) demais('falta:' + ipL, 1000, 10 * 60 * 1000);
          if (!item.existe) return json({ borda: 1, erro: 'nao-existe' }, 404, { 'Cache-Control': 'public, max-age=30' });
          /* banco no limite de hoje: a loja manda o pedido pelo WhatsApp ate zerar */
          const emPausa = await pausaAtiva(env);
          return pronto(emPausa ? item.corpo.replace('{"borda":1,', '{"borda":1,"pausa":true,') : item.corpo, 'public, max-age=15');
        }
        m = /^\/fotos\/([a-z0-9-]{1,60})$/.exec(caminho);
        if (m) {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return await servirFotos(env, ctx, m[1], url.searchParams.get('v') || '', pronto, json);
        }
        m = /^\/foto\/([a-z0-9-]{1,60})\/([A-Za-z0-9_-]{1,60})$/.exec(caminho);
        if (m) return await servirFoto(env, ctx, m[1], m[2]);
        if (caminho === '/vitrine') {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return pronto(await lerVitrine(env, ctx), 'public, max-age=60');
        }
        if (caminho === '/vapid') {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return json({ borda: 1, chave: (await chavesVapid(env)).publica }, 200, { 'Cache-Control': 'public, max-age=600' });
        }
      }

      /* ---- avisos no celular ---- */
      if (caminho === '/aparelho' && request.method === 'POST') {
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '')) return json({ ok: false, erro: 'faltou a loja' }, 400);
        const quem = await quemChamou(env, request);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        if (!(await ehDaLoja(env, c.loja, quem))) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const lista = await aparelhosDaLoja(env, c.loja).catch(() => null);
        if (!lista) return json({ ok: false, erro: 'não deu para ligar agora. Tente de novo daqui a pouco.' }, 503);
        const papel = PAPEIS.indexOf(c.papel) >= 0 ? c.papel : 'painel';
        if (c.remover) {
          /* tira so este papel do aparelho (o mesmo celular pode ser painel e entregas) */
          const nova = [];
          lista.forEach((a) => { if (a.e !== String(c.remover)) { nova.push(a); return; } const ps = papeisDe(a).filter((x) => x !== papel); if (ps.length) nova.push(Object.assign({}, a, { p: ps })); });
          if (JSON.stringify(nova) !== JSON.stringify(lista)) await gravarAparelhos(env, c.loja, nova);
          return json({ ok: true });
        }
        const insc = limparInscricao(c.inscricao);
        if (!insc) return json({ ok: false, erro: 'este navegador mandou um aviso que não dá para usar' }, 400);
        const vapid = await chavesVapid(env);
        const atual = lista.filter((a) => a.e === insc.endpoint)[0];
        const papeis = atual ? papeisDe(atual) : [];
        /* mesmo aparelho, mesmas chaves e o papel ja la: nao grava de novo (o KV gratis tem 1 mil gravacoes por dia) */
        if (!atual || atual.k !== insc.p256dh || atual.a !== insc.auth || papeis.indexOf(papel) < 0 || atual.v !== vapid.publica.slice(0, 12)) {
          const nova = lista.filter((a) => a.e !== insc.endpoint).concat([{ e: insc.endpoint, k: insc.p256dh, a: insc.auth, p: papeis.concat(papeis.indexOf(papel) < 0 ? [papel] : []), v: vapid.publica.slice(0, 12), em: Date.now() }]);
          if (!(await gravarAparelhos(env, c.loja, nova))) return json({ ok: false, erro: 'não deu para guardar agora. Tente de novo daqui a pouco.' }, 503);
        }
        let teste = 0;
        if (c.testar) teste = await mandarAviso(env, insc, { titulo: 'Avisos ligados', texto: 'Pedido novo vai chegar assim, mesmo com a tela apagada.', url: urlDoPapel(c.loja, papel), tag: 'teste-' + papel });
        return json({ ok: true, teste: teste });
      }

      if (caminho === '/novo' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        /* zero leitura no banco: o aviso so leva numeros (senha, valor) e o tipo, nunca texto de quem pediu.
           Quem inventar um pedido so faz o painel apitar a toa (e no maximo 20 vezes por minuto) */
        const r = c.resumo && typeof c.resumo === 'object' ? c.resumo : {};
        const senha = String(r.senha == null ? '' : r.senha);
        const total = Number(r.total);
        if (!/^\d{1,6}$/.test(senha) || !Number.isInteger(total) || total < 0 || total > 10000000) return json({ ok: false, erro: 'faltou o resumo do pedido' }, 400);
        const marca = c.loja + '/' + c.pedido;
        if (MEM.avisados[marca]) return json({ ok: true, repetido: true });
        lembrar(MEM.avisados, marca);
        const minuto = Math.floor(Date.now() / 60000);
        const ritmo = MEM.avisados['ritmo/' + c.loja] = MEM.avisados['ritmo/' + c.loja] && MEM.avisados['ritmo/' + c.loja].m === minuto ? MEM.avisados['ritmo/' + c.loja] : { m: minuto, n: 0 };
        if (++ritmo.n > 20) return json({ ok: true, enviados: 0, devagar: true });
        const aparelhos = ((await aparelhosDaLoja(env, c.loja).catch(() => null)) || []).filter((a) => temPapel(a, 'painel') || temPapel(a, 'cozinha'));
        if (!aparelhos.length) return json({ ok: true, enviados: 0 });
        const p = { id: c.pedido, senha: senha, total: total, tipoEntrega: r.tipoEntrega === 'entrega' ? 'entrega' : 'retirada', origem: r.origem === 'balcao' ? 'balcao' : '' };
        const enviados = await avisarAparelhos(env, c.loja, aparelhos, (a) => avisoDaLoja(p, c.loja, temPapel(a, 'painel') ? 'painel' : 'cozinha', false));
        return json({ ok: true, enviados: enviados });
      }

      if (caminho === '/inscrever' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        const marca = c.loja + '/' + c.pedido + (c.remover ? '/sai' : '');
        if (MEM.inscritos[marca] && Date.now() - MEM.inscritos[marca] < 10 * 1000) return json({ ok: true, repetido: true });
        let aviso = null;
        if (!c.remover) {
          const insc = limparInscricao(c.inscricao);
          if (!insc || !SLUG.test(c.cidade || '')) return json({ ok: false, erro: 'este navegador mandou um aviso que não dá para usar' }, 400);
          aviso = { e: insc.endpoint, k: insc.p256dh, a: insc.auth, u: '#/' + c.cidade + '/' + c.loja + '/pedido/' };
        }
        const fb = await firebase(env);
        /* grava no proprio pedido (1 gravacao, sem ler): o painel ja recebe junto e sabe que o cliente e avisado sozinho */
        const existe = await fb.mergeSeExiste('lojas/' + c.loja + '/pedidos/' + c.pedido, { aviso: aviso });
        if (!existe) return json({ ok: false, erro: 'pedido não existe' }, 404);
        lembrar(MEM.inscritos, marca);
        return json({ ok: true });
      }

      if (caminho === '/avisar' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        const quem = await quemChamou(env, request);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        if (!(await ehDaLoja(env, c.loja, quem))) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const r = resumoLimpo(c.resumo, c.pedido);
        const tarefas = [];
        let cliente = 0, equipe = 0;
        const insc = limparInscricao(c.aviso);
        const texto = insc ? avisoDoCliente(c.status, r, await nomeDaLoja(env, c.loja)) : null;
        if (texto) tarefas.push(mandarAviso(env, insc, Object.assign(texto, { url: urlDoCliente(c.aviso, c.pedido), tag: 'p' + c.pedido, topico: 'p' + c.pedido })).then((s) => { cliente = s; }));
        /* saiu para entrega: o entregador fica sabendo. Pix conferido a mao no painel: a cozinha fica sabendo */
        const papel = c.status === 'pronto' && r.tipoEntrega === 'entrega' ? 'entregas' : (c.status === 'pago' ? 'cozinha' : '');
        if (papel && env.CARDAPIO) {
          tarefas.push(aparelhosDaLoja(env, c.loja).then((lista) => {
            const deles = lista.filter((a) => temPapel(a, papel));
            return deles.length ? avisarAparelhos(env, c.loja, deles, () => (papel === 'entregas' ? avisoDeEntrega(r, c.loja) : avisoDaLoja(r, c.loja, 'cozinha', true))) : 0;
          }).then((n) => { equipe = n; }, () => { equipe = 0; }));
        }
        await Promise.all(tarefas);
        return json({ ok: true, cliente: cliente, equipe: equipe });
      }

      /* ---- um cliente bateu no limite do banco: confere (uma gravacao e uma leitura, no maximo 1 vez por minuto) ---- */
      if (caminho === '/pausa' && request.method === 'POST') {
        if (Date.now() - MEM.pausaConferidaEm < 60 * 1000) return json({ pausa: !!(MEM.pausa && MEM.pausa.valor) });
        MEM.pausaConferidaEm = Date.now();
        const fb = await firebase(env);
        try {
          await fb.merge('publico/saude', { conferidoEm: new Date().toISOString() });
          await fb.get('publico/fundadores');
          return json({ pausa: false });
        } catch (_) {
          return json({ pausa: !!(MEM.pausa && MEM.pausa.valor) });
        }
      }

      /* ---- o painel salvou: a copia da borda se atualiza agora (so o dono da loja ou o admin) ---- */
      if (caminho === '/publicar' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja } = await request.json().catch(() => ({}));
        if (!idToken || !SLUG.test(loja || '')) return json({ ok: false, erro: 'faltou a loja ou o login' }, 400);
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        /* salvar em sequencia (ou de proposito) nao gasta as gravacoes do KV de todas as lojas */
        if (demais('publicar:' + loja, 6, 60 * 1000)) return json({ ok: false, erro: 'muitas vezes seguidas; tente daqui a pouco' }, 429);
        const fb = await firebase(env);
        const quem = (await usuarioDoToken(fb, idToken)).toLowerCase();
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        /* confere o dono pela copia que ja existe (sem ler o banco); loja sem copia ainda: le uma vez */
        const antes = await lerKv(env, 'loja:' + loja, 'text');
        const donoAntes = antes && antes.metadata ? String(antes.metadata.dono || '') : '';
        if (donoAntes && donoAntes !== quem && quem !== ADMIN) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const item = await atualizarLoja(env, loja);
        if (!item.existe) return json({ ok: false, erro: 'loja não existe' }, 404);
        if (item.meta.dono !== quem && quem !== ADMIN) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        /* o token do Mercado Pago pode ter mudado (colou outro, desconectou): a copia guardada sai agora */
        esquecerToken(env, ctx, loja);
        /* mudou algo que a pagina da cidade mostra (aberta, nome, logo, frete, tempo): a vitrine da borda sai e e refeita
           na proxima visita. Antes ficava ate ~20 min dizendo "Aberta agora" de loja que ja tinha fechado. Preco e foto
           de item nao mexem nela (nao gasta gravacao do KV a cada edicao) */
        if (!antes || !antes.value || camposDaVitrine(antes.value) !== camposDaVitrine(item.corpo)) {
          MEM.vitrine = null;
          if (ctx && ctx.waitUntil) ctx.waitUntil(env.CARDAPIO.delete('vitrine').catch(() => {}));
        }
        return json({ ok: true, versao: item.meta.em });
      }

      /* ---- marca do dono no login (as regras reconhecem o dono sem ler a loja) ---- */
      if (caminho === '/dono' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const c = await request.json().catch(() => ({}));
        if (!idToken || idToken.length > 4000) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        const fb = await firebase(env);
        const conta = await contaDoToken(fb, idToken);
        if (!conta) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        if (demais('dono:' + conta.email, 10, 10 * 60 * 1000)) return json({ ok: false, erro: 'muitas vezes seguidas; tente daqui a pouco' }, 429);
        /* admin: loja que trocou de dono na mao. A marca do e-mail vira a lista das lojas que sao dele HOJE */
        if (conta.email === ADMIN && c.email) {
          const alvo = String(c.email).trim().toLowerCase();
          if (!/^[^\s@\/]{1,64}@[^\s@\/]{1,190}$/.test(alvo)) return json({ ok: false, erro: 'e-mail inválido' }, 400);
          const lojas = await fb.lojasDoDono(alvo);
          const feito = await gravarMarcaDono(fb, alvo, null, lojas);
          return json({ ok: feito, lojas: lojas });
        }
        const loja = String(c.loja || '');
        if (!SLUG.test(loja)) return json({ ok: false, erro: 'faltou a loja' }, 400);
        const ateMarca = Number(conta.marca.lojasAte || 0);
        if (Array.isArray(conta.marca.lojas) && conta.marca.lojas.indexOf(loja) >= 0 && ateMarca - Date.now() / 1000 > 86400) return json({ ok: true, marca: false });
        /* a verdade e o banco: as lojas que tem este e-mail como dono HOJE (uma loja que trocou de dono na mao sai da marca) */
        const lista = await fb.lojasDoDono(conta.email);
        if (lista.indexOf(loja) < 0) {
          if (Array.isArray(conta.marca.lojas) && conta.marca.lojas.length) await gravarMarcaDono(fb, conta.email, conta, lista).catch(() => {});
          return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        }
        await gravarMarcaDono(fb, conta.email, conta, lista);
        return json({ ok: true, marca: true });
      }

      /* ---- senha da equipe: o dono (logado) define; criamos/trocamos o usuario de equipe da loja ---- */
      if (caminho === '/equipe' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja, pin } = await request.json().catch(() => ({}));
        const senha = String(pin || '').replace(/\D/g, '');
        if (!idToken || !SLUG.test(String(loja || '')) || senha.length < 6 || senha.length > 8) return json({ ok: false, erro: 'senha de 6 a 8 números' }, 400);
        /* senha fraca e a primeira que alguem tenta: nada de 123456, 000000, 111111... */
        if (/^(\d)\1+$/.test(senha) || '0123456789'.indexOf(senha) >= 0 || '9876543210'.indexOf(senha) >= 0) return json({ ok: false, erro: 'senha fácil demais: evite números repetidos ou em sequência' }, 400);
        const fb = await firebase(env);
        const quem = await usuarioDoToken(fb, idToken);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        const l = await fb.get('lojas/' + loja);
        if (!l || String(l.donoEmail || '').toLowerCase() !== quem.toLowerCase()) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        await definirUsuarioEquipe(fb, 'equipe-' + loja + '@equipe.ligeiro.app.br', 'LIG-' + senha, loja);
        await fb.merge('lojas/' + loja, { senhaEquipeEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
        return json({ ok: true });
      }

      /* ---- o codigo de desconto vale? (a lista de cupons nao e publica) ---- */
      if (caminho === '/cupom' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        const loja = String(c.loja || '');
        const codigo = String(c.codigo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        if (!SLUG.test(loja) || !codigo) return json({ erro: 'Digite o código para aplicar.' }, 400);
        /* chute de codigo: poucas tentativas por aparelho (e por loja), senao dava para descobrir um cupom secreto */
        const ip = ipDaCasa(request.headers.get('CF-Connecting-IP'));
        if (demais('cupom-ip:' + ip, 12, 10 * 60 * 1000) || demais('cupom-loja:' + loja, 300, 10 * 60 * 1000)) return json({ erro: 'Muitas tentativas de código. Espere alguns minutos.' }, 429);
        /* a copia da loja diz se ela existe e se tem cupom: loja inventada, ou sem cupom, nao gasta o banco */
        const copiaLoja = await lerLoja(env, ctx, loja);
        if (!copiaLoja.existe || !/"temCupom":true/.test(String(copiaLoja.corpo || ''))) return json({ erro: 'Esse código não existe. Confira as letras.' });
        const fb = await firebase(env);
        const lista = await cuponsDaLoja(env, fb, loja);
        const regra = lista.filter((x) => x.codigo === codigo)[0];
        if (!regra) return json({ erro: 'Esse código não existe. Confira as letras.' });
        if (regra.ativo === false) return json({ erro: 'Esse código não está mais valendo.' });
        if (regra.limite > 0) {
          const uso = await fb.get('lojas/' + loja + '/contadores/cupom-' + codigo);
          if (uso && (Number(uso.usos) || 0) >= regra.limite) return json({ erro: 'Esse código já foi todo usado.' });
        }
        return json({ cupom: { codigo: regra.codigo, percentual: regra.percentual, minimo: regra.minimo, ativo: true } });
      }

      /* ---- contato da pagina de vendas ("Fale com a gente", lista de espera): 3 por aparelho em 10 min, 300 por dia no
         total. Um robo nao gasta mais a cota de gravacoes do banco (a mesma dos pedidos) ---- */
      if (caminho === '/lead' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
        const nome = txt(c.nome, 60);
        let whatsapp = String(c.whatsapp || '').replace(/\D/g, '');
        if (whatsapp.length > 11 && whatsapp.indexOf('55') === 0) whatsapp = whatsapp.slice(2);
        if (nome.length < 2 || whatsapp.length < 10 || whatsapp.length > 11) return json({ ok: false, erro: 'Confira o nome e o WhatsApp com DDD.' }, 400);
        const ip = ipDaCasa(request.headers.get('CF-Connecting-IP'));
        if (demais('lead-ip:' + ip, 3, 10 * 60 * 1000)) return json({ ok: false, erro: 'Recebemos seus dados. Espere alguns minutos antes de mandar de novo.' }, 429);
        if (demais('lead-dia', 300, 24 * 3600 * 1000)) return json({ ok: false, erro: 'Muitos contatos agora. Chame a gente no WhatsApp.' }, 429);
        const fb = await firebase(env);
        const id = idAleatorio(20);
        const lead = { id: id, nome: nome, whatsapp: whatsapp, loja: txt(c.loja, 80), cidade: txt(c.cidade, 80), uf: txt(c.uf, 2).toUpperCase().replace(/[^A-Z]/g, ''), origem: txt(c.origem, 40) || 'site', pagina: txt(c.pagina, 200), criadoEm: new Date().toISOString(), atendidoEm: '' };
        await fb.merge('leads/' + id, lead);
        return json({ ok: true, id: id });
      }

      /* ---- cria o pedido (o banco nao aceita pedido gravado direto pelo celular) ---- */
      if (caminho === '/pedido' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        const loja = String(c.loja || '');
        const dados = c.dados && typeof c.dados === 'object' ? c.dados : null;
        if (!SLUG.test(loja) || !dados) return json({ erro: 'faltou a loja ou o pedido' }, 400);
        /* banco no limite de hoje: o site manda o pedido pronto pelo WhatsApp da loja */
        if (await pausaAtiva(env)) return json({ pausa: true, erro: 'O site está com movimento demais agora.' }, 503);
        const ip = request.headers.get('CF-Connecting-IP') || 'sem-ip';
        const muitos = 'Muitos pedidos seguidos daqui. Espere alguns minutos ou chame a loja no WhatsApp.';
        if (demais('pedido-ip:' + ip, 15, 10 * 60 * 1000)) return json({ erro: muitos }, 429);
        const fone = String(dados.telefone || '').replace(/\D/g, '').slice(-11);
        if (fone && demais('pedido-fone:' + loja + ':' + fone, 6, 10 * 60 * 1000)) return json({ erro: muitos }, 429);
        /* balcao (tablet da loja): so com o login da equipe ou do dono (a regra do balcao dispensa WhatsApp e endereco) */
        if (dados.origem === 'balcao') {
          const quem = await quemChamou(env, request);
          if (!quem || !(await ehDaLoja(env, loja, quem))) return json({ erro: 'Entre de novo com a senha da equipe.' }, 401);
        }
        /* a loja de agora: copia da borda (o painel publica a cada salvar); sem borda, le o banco */
        let l = null;
        const fb = await firebase(env);
        if (env.CARDAPIO) { const item = await lerLoja(env, ctx, loja); if (item.existe) { try { l = JSON.parse(item.corpo).loja; } catch (_) { l = null; } } }
        else l = await fb.get('lojas/' + loja);
        if (!l) return json({ erro: 'Essa loja não existe mais.' }, 404);
        if (l.ativa === false) return json({ erro: 'Esta loja não está recebendo pedidos pelo site.' }, 409);
        /* cupons: a lista privada, so quando o pedido veio com codigo (pedido sem codigo nao gasta nada com isso) */
        const comCodigo = !!String(dados.cupom || '').trim();
        if (comCodigo && (demais('cupom-ped:' + ipDaCasa(ip), 30, 10 * 60 * 1000) || demais('cupom-loja:' + loja, 300, 10 * 60 * 1000))) return json({ erro: 'Muitas tentativas de código. Espere alguns minutos.' }, 429);
        l = Object.assign({}, l, { cupons: comCodigo && (l.temCupom === true || (Array.isArray(l.cupons) && l.cupons.length > 0)) ? await cuponsDaLoja(env, fb, loja) : [] });
        /* as regras contam o horario da loja pelo relogio local: o Cloudflare roda no horario de Londres, entao elas
           recebem a hora de Brasilia (o Brasil nao tem mais horario de verao). No pedido fica a hora de verdade */
        const agoraBr = new Date(Date.now() - 3 * 3600 * 1000);
        let pedido;
        try {
          pedido = REGRAS.montarPedido(l, Object.assign({}, dados, { origem: dados.origem === 'balcao' ? 'balcao' : 'link' }), agoraBr);
        } catch (e) {
          if (e && e.publico) return json({ erro: e.message }, 422);
          throw e;
        }
        const quando = new Date().toISOString();
        pedido.criadoEm = quando;
        pedido.atualizadoEm = quando;
        if (pedido.pagoEm) pedido.pagoEm = quando;
        ['pagoEm', 'mp', 'pixCodigo', 'pixExpiraEm', 'confirmadoPor', 'pagoAposCancelar'].forEach((k) => { if (pedido[k] == null) delete pedido[k]; });
        /* "me avise no celular": so o endereco de aviso de um servico de aviso de verdade */
        const insc = limparInscricao(c.aviso);
        const volta = String((c.aviso && c.aviso.u) || '');
        if (insc && dados.origem !== 'balcao') pedido.aviso = { e: insc.endpoint, k: insc.p256dh, a: insc.auth, u: /^#\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}\/pedido\/$/.test(volta) ? volta : '' };
        /* senha do dia, uso do cupom e o pedido: um lote so, com trava (dois pedidos juntos nunca pegam a mesma senha) */
        const lojaDoc = 'lojas/' + loja;
        const codigo = pedido.desconto > 0 && pedido.cupom ? String(pedido.cupom) : '';
        const regraCupom = codigo ? ((l.cupons || []).filter((x) => x.codigo === codigo)[0] || null) : null;
        const id = idAleatorio(20);
        let completo = null;
        for (let tentativa = 0; tentativa < 5 && !completo; tentativa++) {
          const cont = await fb.get(lojaDoc + '/contadores/senha', true);
          const senha = REGRAS.proximaSenha(cont, agoraBr);
          const escritas = [
            { caminho: lojaDoc + '/contadores/senha', dados: { dia: senha.dia, ultima: senha.ultima }, trava: cont ? { updateTime: cont._atualizadoNoBanco } : { exists: false } },
          ];
          if (codigo) {
            const uso = await fb.get(lojaDoc + '/contadores/cupom-' + codigo, true);
            const usos = uso ? (Number(uso.usos) || 0) : 0;
            if (regraCupom && regraCupom.limite > 0 && usos >= regraCupom.limite) return json({ erro: 'Esse código já foi todo usado.' }, 422);
            escritas.push({ caminho: lojaDoc + '/contadores/cupom-' + codigo, dados: { usos: usos + 1, atualizadoEm: quando }, trava: uso ? { updateTime: uso._atualizadoNoBanco } : { exists: false } });
          }
          const doc = Object.assign({}, pedido, { id: id, senha: senha.ultima });
          escritas.push({ caminho: lojaDoc + '/pedidos/' + id, dados: doc, trava: { exists: false } });
          if (await fb.gravarJuntos(escritas)) completo = doc;
        }
        if (!completo) return json({ erro: 'Muita gente pedindo agora. Toque em enviar de novo.' }, 503);
        /* pedido ja na fila (pago ou para cobrar na porta): o painel e a cozinha apitam daqui mesmo */
        if (completo.status === 'pago' && env.CARDAPIO && ctx && ctx.waitUntil) {
          ctx.waitUntil((async () => {
            const aparelhos = ((await aparelhosDaLoja(env, loja).catch(() => null)) || []).filter((a) => temPapel(a, 'painel') || temPapel(a, 'cozinha'));
            if (!aparelhos.length) return;
            lembrar(MEM.avisados, loja + '/' + id);
            await avisarAparelhos(env, loja, aparelhos, (a) => avisoDaLoja(completo, loja, temPapel(a, 'painel') ? 'painel' : 'cozinha', false));
          })().catch(() => {}));
        }
        return json({ pedido: completo, avisado: true });
      }

      /* ---- cria o Pix do pedido ---- */
      if (caminho === '/criar' && request.method === 'POST') {
        const { loja, pedido } = await request.json().catch(() => ({}));
        if (!SLUG.test(String(loja || '')) || !PEDIDO_ID.test(String(pedido || ''))) return json({ erro: 'faltou loja ou pedido' }, 400);
        const fb = await firebase(env);
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido, true);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.pixCodigo) return json({ codigo: p.pixCodigo, expiraEm: p.pixExpiraEm || '' });
        if (p.status !== 'aguardando_pagamento' || p.formaPagamento !== 'pix' || !(p.total > 0)) return json({ erro: 'esse pedido não está esperando Pix' }, 400);
        /* pedido antigo que nunca ganhou codigo: nada de Pix novo horas depois. Vale a hora em que o pedido nasceu no
           banco (o criadoEm e o relogio do aparelho) */
        if (Date.now() - nasceuEm(p) > 40 * 60 * 1000) return json({ erro: 'esse pedido passou do prazo do Pix' }, 409);
        /* o valor tem que ser o do cardapio: pedido gravado direto no banco com total inventado nao vira Pix */
        if (!(await valorConfere(env, fb, loja, p))) return json({ erro: 'O cardápio mudou ou o valor do pedido não confere. Monte o pedido de novo.' }, 409);
        const token = await tokenDaLoja(fb, loja, env);
        if (!token) return json({ erro: 'a loja não ligou o Pix automático' }, 409);
        /* nome da loja (sobrenome de quem pediu com um nome so): da copia da borda, sem ler o banco */
        const nome = separarNome(p.cliente && p.cliente.nome, await nomeDaLoja(env, loja));
        /* API Orders do Mercado Pago (a de Payments vai ser descontinuada) */
        const valor = (p.total / 100).toFixed(2);
        const inteira = loja + '__' + pedido;
        /* a API Orders so aceita letras, numeros, hifen e sublinhado (ate 64): nada de "|" */
        const referencia = inteira.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const corpo = {
          type: 'online',
          total_amount: valor,
          external_reference: referencia,
          processing_mode: 'automatic',
          transactions: { payments: [{ amount: valor, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT30M' }] },
          payer: { email: 'cliente' + (p.senha || '0') + '@' + loja + '.ligeiro.app.br', first_name: nome.primeiro, last_name: nome.sobrenome },
        };
        const caminhoPix = 'lojas/' + loja + '/pedidos/' + pedido;
        const codigoDa = (o) => { const pg = (o && o.transactions && o.transactions.payments && o.transactions.payments[0]) || {}; return { pagto: pg, qr: (pg.payment_method && pg.payment_method.qr_code) || '' }; };
        let ord = null;
        /* a order deste Pix ja foi criada (a resposta nao chegou ou veio sem o codigo): busca, nao cria outra */
        if (p.mp && p.mp.id && !p.mp.cartao) {
          try { ord = await mp(token, '/v1/orders/' + encodeURIComponent(String(p.mp.id)), {}); } catch (e) { if (e && e.status === 401) delete MEM.mp[loja]; ord = null; }
          if (ord && ['action_required', 'processing', 'created'].indexOf(String(ord.status)) < 0) ord = null;
        }
        if (!ord) {
          const criar = (chave) => mp(token, '/v1/orders', { method: 'POST', body: JSON.stringify(corpo), headers: { 'X-Idempotency-Key': chave } });
          try {
            try { ord = await criar(pedido + '-o2'); } catch (e1) {
              if (e1 && e1.status === 401) delete MEM.mp[loja];
              /* chave ja usada numa order que se perdeu: uma chave nova (o cliente so ve um codigo) */
              if (e1 && e1.status === 409) ord = await criar(pedido + '-o3');
              else if (e1 && e1.status >= 400 && e1.status < 500) throw e1;
              else ord = await criar(pedido + '-o2');
            }
          } catch (e) {
            console.error('pix nao criou', loja, pedido, e && e.message);
            return json({ erro: 'Não deu para gerar o Pix agora. Tente de novo em instantes.' }, 502);
          }
          /* o id fica guardado na hora: se o codigo demorar, a proxima tentativa busca esta mesma order */
          if (ord && ord.id && !codigoDa(ord).qr) await fb.merge(caminhoPix, { mp: { id: String(ord.id), criadoEm: new Date().toISOString() }, atualizadoEm: new Date().toISOString() }).catch(() => {});
        }
        let { pagto, qr } = codigoDa(ord);
        /* o Mercado Pago pode gerar o codigo um instante depois (order "processing"): pergunta de novo, ate 3 vezes */
        for (let volta = 0; !qr && ord && ord.id && volta < 3; volta++) {
          await new Promise((ok) => setTimeout(ok, 1000));
          const de = await mp(token, '/v1/orders/' + encodeURIComponent(String(ord.id)), {}).catch(() => null);
          if (de) { ord = de; ({ pagto, qr } = codigoDa(ord)); }
        }
        if (!qr) return json({ erro: 'o Mercado Pago não devolveu o Pix (a conta tem chave Pix cadastrada?)' }, 502);
        /* o prazo que o Mercado Pago deu ao codigo (o do relogio daqui so se ele nao disser) */
        const fimMp = Date.parse(pagto.date_of_expiration || '');
        const expira = new Date(!isNaN(fimMp) && fimMp > Date.now() ? Math.min(fimMp, Date.now() + 30 * 60 * 1000) : Date.now() + 30 * 60 * 1000).toISOString();
        const agora2 = new Date().toISOString();
        await fb.merge(caminhoPix, { mp: { id: String(ord.id), pagamentoId: String(pagto.id || ''), criadoEm: agora2 }, pixCodigo: qr, pixExpiraEm: expira, atualizadoEm: agora2 });
        /* indice pro webhook so quando a referencia foi cortada (loja de nome muito comprido): o aviso normal ja traz loja e pedido */
        if (referencia !== inteira) await fb.merge('mp_indice/' + String(ord.id), { loja: loja, pedido: pedido, criadoEm: agora2 }).catch(() => {});
        return json({ codigo: qr, expiraEm: expira, mp: String(ord.id) });
      }

      /* ---- cobra o cartao do pedido: o numero do cartao nunca passa aqui (vem o token do formulario do Mercado Pago),
         a cobranca vai para a conta da propria loja e o "pago" sai pelo mesmo conferirPagamento do Pix ---- */
      if (caminho === '/cartao' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        const loja = String(c.loja || ''), pedido = String(c.pedido || ''), cartao = String(c.token || ''), metodo = String(c.metodo || '');
        if (!SLUG.test(loja) || !PEDIDO_ID.test(pedido) || !/^[A-Za-z0-9-]{8,80}$/.test(cartao) || !/^[a-z0-9_]{2,30}$/.test(metodo)) return json({ erro: 'faltou o cartão' }, 400);
        /* poucas tentativas por pedido e por aparelho: quem testa cartao roubado nao faz da loja o laboratorio dele */
        const ip = request.headers.get('CF-Connecting-IP') || 'sem-ip';
        const agoraC = Date.now();
        const tent = MEM.cartao;
        Object.keys(tent).forEach((k) => { tent[k] = tent[k].filter((t) => agoraC - t < 10 * 60 * 1000); if (!tent[k].length) delete tent[k]; });
        if ((tent['p:' + pedido] || []).length >= 4 || (tent['ip:' + ip] || []).length >= 8) return json({ status: 'recusado', motivo: 'Tentativas demais com cartão. Espere alguns minutos ou pague no Pix.' });
        (tent['p:' + pedido] = tent['p:' + pedido] || []).push(agoraC);
        (tent['ip:' + ip] = tent['ip:' + ip] || []).push(agoraC);
        /* a loja liga o cartao nos Ajustes: confere pela copia da borda (sem ler o banco) */
        const copia = await lerKv(env, 'loja:' + loja, 'text');
        if (copia && copia.value) { try { if (JSON.parse(copia.value).loja.aceitaCartaoOnline !== true) return json({ erro: 'a loja não aceita cartão pelo site' }, 409); } catch (_) { /* copia torta: segue */ } }
        const fb = await firebase(env);
        const caminhoPedido = 'lojas/' + loja + '/pedidos/' + pedido;
        const p = await fb.get(caminhoPedido, true);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.formaPagamento !== 'cartao_online') return json({ erro: 'esse pedido não é de cartão' }, 400);
        if (p.status === 'pago' || p.pagamentoStatus === 'pago') return json({ status: 'aprovado' }); /* toque duplo: ja foi */
        if (p.status !== 'aguardando_pagamento' || !(p.total > 0)) return json({ erro: 'esse pedido não está esperando o cartão' }, 400);
        if (Date.now() - nasceuEm(p) > 40 * 60 * 1000) return json({ erro: 'esse pedido passou do prazo' }, 409);
        /* tentativas contadas no proprio pedido (valem em todas as copias do worker, nao so nesta) */
        if ((Number(p.tentativasCartao) || 0) >= 5) return json({ status: 'recusado', motivo: 'Tentativas demais com cartão neste pedido. Pague no Pix ou faça um pedido novo.' });
        /* outra cobranca deste pedido em andamento (dois toques, duas abas): espera, nunca cobra duas vezes */
        if (p.cobrandoEm && Date.now() - Date.parse(p.cobrandoEm) < (p.cobrancaIncerta ? 5 * 60 * 1000 : 90 * 1000)) {
          return json({ status: 'recusado', motivo: p.cobrancaIncerta ? 'Ainda estamos confirmando o pagamento anterior com o banco. Espere alguns minutos: se ele passar, o pedido entra sozinho.' : 'Um pagamento deste pedido já está em andamento. Espere um instante.' });
        }
        /* o valor tem que ser o do cardapio: pedido gravado direto no banco com total inventado nao e cobrado */
        if (!(await valorConfere(env, fb, loja, p))) return json({ erro: 'O cardápio mudou ou o valor do pedido não confere. Monte o pedido de novo.' }, 409);
        const token = await tokenDaLoja(fb, loja, env);
        if (!token) return json({ erro: 'a loja não ligou o cartão' }, 409);
        /* a cobranca anterior deste pedido pode ter passado depois (analise do banco, resposta que nao chegou): pergunta
           ao Mercado Pago antes de cobrar de novo. Nunca duas cobrancas do mesmo pedido */
        if (p.mp && p.mp.cartao && p.mp.id) {
          let antiga = null;
          try { antiga = await mp(token, '/v1/orders/' + encodeURIComponent(String(p.mp.id)), {}); } catch (e) { if (!(e && e.status === 404)) return json({ status: 'recusado', motivo: 'Não deu para conferir o pagamento anterior agora. Espere um minuto e tente de novo.' }); }
          const est = String((antiga && antiga.status) || '');
          if (est === 'processed') {
            const r0 = await conferirPagamento(fb, loja, String(p.mp.id), pedido, env).catch(() => null);
            if (r0 === 'pago') return json({ status: 'aprovado' });
          }
          if (est === 'processing' || est === 'in_process') return json({ status: 'analise', motivo: 'Seu pagamento anterior ainda está em análise pelo banco. Assim que aprovar, o pedido entra na fila sozinho.' });
        }
        /* a trava: grava "cobrando" so se o pedido nao mudou desde a leitura. Duas cobrancas ao mesmo tempo: so uma passa */
        const travou = await fb.mergeSeIgual(caminhoPedido, { cobrandoEm: new Date().toISOString(), tentativasCartao: (Number(p.tentativasCartao) || 0) + 1 }, p._atualizadoNoBanco);
        if (!travou) return json({ status: 'recusado', motivo: 'Um pagamento deste pedido já está em andamento. Espere um instante.' });
        const soltar = () => fb.merge(caminhoPedido, { cobrandoEm: '' }).catch(() => {});
        const nome = separarNome(p.cliente && p.cliente.nome, await nomeDaLoja(env, loja));
        const valor = (p.total / 100).toFixed(2);
        const inteira = loja + '__' + pedido;
        const referencia = inteira.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const email = /^[^\s@]{1,64}@[^\s@]{1,120}\.[a-z]{2,}$/i.test(String(c.email || '')) ? String(c.email) : 'cliente' + (p.senha || '0') + '@' + loja + '.ligeiro.app.br';
        const pagador = { email: email, first_name: nome.primeiro, last_name: nome.sobrenome };
        const documento = String(c.documento || '').replace(/\D/g, '');
        if (documento.length === 11 || documento.length === 14) pagador.identification = { type: documento.length === 11 ? 'CPF' : 'CNPJ', number: documento };
        const corpo = {
          type: 'online', total_amount: valor, external_reference: referencia, processing_mode: 'automatic',
          transactions: { payments: [{ amount: valor, payment_method: { id: metodo, type: 'credit_card', token: cartao, installments: 1 } }] },
          payer: pagador,
        };
        let ord;
        const chaveCobranca = pedido + '-c' + cartao.slice(-16);
        const cobrarUmaVez = () => mp(token, '/v1/orders', { method: 'POST', body: JSON.stringify(corpo), headers: { 'X-Idempotency-Key': chaveCobranca } });
        try {
          try { ord = await cobrarUmaVez(); } catch (e1) {
            /* sem resposta ou erro do lado deles: a mesma chave de novo devolve a mesma cobranca (nunca cobra duas vezes) */
            if (e1 && e1.status >= 400 && e1.status < 500) throw e1;
            ord = await cobrarUmaVez();
          }
        } catch (e) {
          if (e && e.status === 401) delete MEM.mp[loja];
          /* recusa de verdade (4xx, menos o 409 da chave repetida, que quer dizer "ja estava cobrando"): nada foi cobrado */
          if (e && e.status >= 400 && e.status < 500 && e.status !== 409) {
            const idRecusa = e.dados && e.dados.id ? String(e.dados.id) : '';
            await fb.merge(caminhoPedido, Object.assign({ cobrandoEm: '', cobrancaIncerta: '' }, idRecusa ? { cobrancas: ((Array.isArray(p.cobrancas) ? p.cobrancas : []).concat([idRecusa])).slice(-10) } : {})).catch(() => {});
            return json({ status: 'recusado', motivo: motivoDoCartao(detalheDoCartao(e.dados)) });
          }
          /* sem resposta (queda, demora, erro do Mercado Pago): pode ter passado. A trava fica por 5 minutos e o aviso do
             Mercado Pago (ou a proxima tentativa, que confere antes) resolve */
          console.error('cartao sem resposta', loja, pedido, e && e.message);
          await fb.merge(caminhoPedido, { cobrancaIncerta: new Date().toISOString(), cobrandoEm: new Date().toISOString() }).catch(() => {});
          return json({ status: 'conferindo', motivo: 'O banco não respondeu a tempo. Se o valor aparecer no seu cartão, o pedido entra sozinho. Se não aparecer, tente de novo daqui a 5 minutos.' });
        }
        const detalhe = detalheDoCartao(ord);
        const agoraMp = new Date().toISOString();
        if (referencia !== inteira) await fb.merge('mp_indice/' + String(ord.id), { loja: loja, pedido: pedido, criadoEm: agoraMp }).catch(() => {});
        const idMp = { id: String(ord.id), criadoEm: agoraMp, cartao: true };
        /* toda cobranca do pedido fica anotada: a devolucao alcanca todas */
        const cobrancas = ((Array.isArray(p.cobrancas) ? p.cobrancas : []).concat([String(ord.id)])).filter((x, i, l) => l.indexOf(x) === i).slice(-10);
        /* em analise pelo banco: a trava fica (ninguem cobra de novo); o aviso do Mercado Pago libera ou recusa depois */
        const detalheOrd = String(detalhe || '').toLowerCase();
        if (ord.status === 'processing' || ord.status === 'in_process' || (ord.status === 'action_required' && /waiting_retry|in_process|review/.test(detalheOrd))) {
          await fb.merge(caminhoPedido, { mp: idMp, cobrancas: cobrancas, cobrandoEm: agoraMp, cobrancaIncerta: agoraMp, atualizadoEm: agoraMp }).catch(() => {});
          return json({ status: 'analise', motivo: 'Seu pagamento está em análise pelo banco. Assim que aprovar, o pedido entra na fila sozinho.' });
        }
        /* aprovado na hora, deste pedido e do mesmo valor: o "pago" vai junto com o id, numa gravacao so, travada na
           hora da trava (ninguem mexeu no pedido desde ela). Mexeram (o cliente cancelou no meio): o caminho de sempre */
        const aprovadoNoMp = ord.status === 'processed' && String(ord.external_reference || '') === referencia && Math.round(Number(ord.total_amount) * 100) === p.total;
        if (aprovadoNoMp && typeof travou === 'string') {
          let pagou = false;
          try {
            pagou = await fb.mergeSeIgual(caminhoPedido, { mp: idMp, cobrancas: cobrancas, cobrandoEm: '', cobrancaIncerta: '', status: 'pago', pagamentoStatus: 'pago', pagoEm: agoraMp, confirmadoPor: 'mercadopago', atualizadoEm: agoraMp }, travou);
          } catch (e) {
            /* o banco falhou agora: o pagamento esta aprovado no Mercado Pago. O cliente ouve "aprovado", a trava fica
               (nenhum toque cobra de novo) e o aviso do Mercado Pago marca o pedido pago daqui a pouco */
            console.error('cartao aprovado, banco falhou', loja, pedido, e && e.message);
            return json({ status: 'aprovado' });
          }
          if (pagou) {
            await avisarPixPago(env, loja, Object.assign({}, p, { id: pedido, status: 'pago' })).catch(() => {});
            return json({ status: 'aprovado' });
          }
        }
        await fb.merge(caminhoPedido, { mp: idMp, cobrancas: cobrancas, cobrandoEm: '', cobrancaIncerta: '', atualizadoEm: agoraMp }).catch(() => {});
        if (ord.status === 'processed') {
          let r2 = null;
          try { r2 = await conferirPagamento(fb, loja, ord.id, pedido, env); } catch (e) { if (aprovadoNoMp) return json({ status: 'aprovado' }); throw e; }
          if (r2 === 'pago') return json({ status: 'aprovado' });
        }
        if (ord.status === 'action_required') return json({ status: 'recusado', motivo: 'O banco pediu uma confirmação que ainda não fazemos por aqui. Tente outro cartão ou pague no Pix.' });
        return json({ status: 'recusado', motivo: motivoDoCartao(detalhe) });
      }

      /* ---- a loja cancelou um pedido pago pelo site: o dinheiro volta ao cliente (so o dono da loja ou o admin) ---- */
      if (caminho === '/devolver' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja, pedido } = await request.json().catch(() => ({}));
        if (!idToken || !SLUG.test(loja || '') || !PEDIDO_ID.test(pedido || '')) return json({ ok: false, erro: 'faltou a loja, o pedido ou o login' }, 400);
        const fb = await firebase(env);
        const quem = (await usuarioDoToken(fb, idToken)).toLowerCase();
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        /* o dono vem da copia da borda (sem ler o banco); loja sem copia: le uma vez */
        const copia = await lerKv(env, 'loja:' + loja, 'text');
        let dono = copia && copia.metadata ? String(copia.metadata.dono || '') : '';
        if (!dono) { const item = await atualizarLoja(env, loja).catch(() => null); dono = item && item.meta ? String(item.meta.dono || '') : ''; }
        if (!dono || (dono !== quem && quem !== ADMIN)) return json({ ok: false, erro: 'só o dono da loja devolve pagamentos' }, 403);
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido);
        if (!p) return json({ ok: false, erro: 'pedido não existe' }, 404);
        if (p.devolvidoEm) return json({ ok: true, ja: true });
        if (p.status !== 'cancelado') return json({ ok: false, erro: 'cancele o pedido antes de devolver' }, 409);
        if ((p.formaPagamento !== 'pix' && p.formaPagamento !== 'cartao_online') || p.pagamentoStatus !== 'pago' || !p.mp || !p.mp.id || p.mp.simulado) return json({ ok: false, erro: 'esse pedido não foi pago pelo site' }, 409);
        const token = await tokenDaLoja(fb, loja, env);
        if (!token) return json({ ok: false, erro: 'a loja está sem Mercado Pago conectado' }, 409);
        /* todas as cobrancas aprovadas do pedido voltam (a ultima e as anteriores, se alguma tiver passado) */
        const ids = [String(p.mp.id)].concat(Array.isArray(p.cobrancas) ? p.cobrancas.map(String) : []).filter((x, i, l) => x && l.indexOf(x) === i && /^[A-Za-z0-9_-]{1,64}$/.test(x));
        try {
          for (const mpId of ids) {
            /* pedido novo e uma "order" (ORD...); os Pix antigos eram pagamento avulso. Os dois devolvem o valor inteiro */
            const ehOrder = mpId.indexOf('ORD') === 0;
            if (mpId !== String(p.mp.id)) {
              /* cobranca anterior: so devolve se ela foi aprovada (a recusada nao tem o que devolver) */
              const o = await mp(token, (ehOrder ? '/v1/orders/' : '/v1/payments/') + encodeURIComponent(mpId), {}).catch(() => null);
              if (!o || ['processed', 'approved'].indexOf(String(o.status)) < 0) continue;
            }
            try {
              await mp(token, ehOrder ? '/v1/orders/' + encodeURIComponent(mpId) + '/refund' : '/v1/payments/' + encodeURIComponent(mpId) + '/refunds', { method: 'POST', body: ehOrder ? '' : '{}', headers: { 'X-Idempotency-Key': 'devolver-' + pedido + (mpId === String(p.mp.id) ? '' : '-' + mpId) } });
            } catch (e) {
              /* ja devolvido, ou devolucao em andamento (o toque anterior passou e a resposta se perdeu): confere e segue */
              if (!(e && e.status === 409)) throw e;
              const o = await mp(token, (ehOrder ? '/v1/orders/' : '/v1/payments/') + encodeURIComponent(mpId), {}).catch(() => null);
              const est = String((o && (o.status_detail || o.status)) || '') + ' ' + String((o && o.status) || '');
              if (!/refund/.test(est) && !/already_refunded|refund_already_in_process|idempotency_key_already_used/.test(JSON.stringify(e.dados || {}))) throw e;
            }
          }
        } catch (e) {
          console.error('devolver', loja, pedido, e && e.message);
          return json({ ok: false, erro: 'o Mercado Pago não devolveu' }, 502);
        }
        const agoraD = new Date().toISOString();
        await fb.merge('lojas/' + loja + '/pedidos/' + pedido, { devolvidoEm: agoraD, devolvidoPor: quem.slice(0, 120), atualizadoEm: agoraD }).catch(() => {});
        return json({ ok: true });
      }

      /* ---- o site pergunta se caiu ---- */
      if (caminho === '/status' && request.method === 'GET') {
        const loja = url.searchParams.get('loja') || '';
        const pedido = url.searchParams.get('pedido') || '';
        if (!SLUG.test(loja) || !PEDIDO_ID.test(pedido)) return json({ erro: 'faltou loja ou pedido' }, 400);
        /* "caiu?" do jeito antigo le o banco: no maximo 60 por minuto por IP */
        if (demais('status:' + (request.headers.get('CF-Connecting-IP') || 'sem-ip'), 60, 60 * 1000)) return json({ status: 'aguardando_pagamento', vencido: false }, 429);
        const mpId = url.searchParams.get('mp') || '';
        const expira = Date.parse(url.searchParams.get('expira') || '');
        const fb = await firebase(env);
        if (/^[A-Za-z0-9_-]{1,64}$/.test(mpId) && !isNaN(expira)) {
          /* caminho leve (site novo): pergunta direto ao Mercado Pago; o banco so e lido se o Pix caiu.
             O prazo vem do proprio pedido (pixExpiraEm) e vale pelo relogio do servidor, nunca o do aparelho */
          let novo = null;
          try { novo = await conferirPagamento(fb, loja, mpId, pedido, env); } catch (_) { novo = null; }
          const status = novo || 'aguardando_pagamento';
          return json({ status: status, vencido: status === 'aguardando_pagamento' && Date.now() > expira });
        }
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido, true);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.status !== 'aguardando_pagamento' || !p.mp || !p.mp.id) return json({ status: p.status, vencido: pixVencidoNoServidor(p, Date.now()) });
        let novo = null;
        try { novo = await conferirPagamento(fb, loja, String(p.mp.id), pedido, env); } catch (_) { novo = null; /* Mercado Pago fora do ar: responde pelo que o banco tem */ }
        const status = novo || p.status;
        return json({ status: status, vencido: status === 'aguardando_pagamento' && pixVencidoNoServidor(p, Date.now()) });
      }

      /* ---- repasse antigo: o painel manda o POST com o proprio token ---- */
      if (caminho === '/' && request.method === 'POST') {
        /* so o painel do proprio site (com o token da propria loja) usa: nada de repasse aberto para qualquer um */
        if (conferir && ORIGENS.indexOf(origem) < 0) return json({ erro: 'origem não permitida' }, 403);
        const token = request.headers.get('Authorization') || '';
        if (!token.startsWith('Bearer ')) return json({ message: 'Sem token' }, 401);
        const resposta = await fetch(MP + '/v1/payments', {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json', 'X-Idempotency-Key': request.headers.get('X-Idempotency-Key') || crypto.randomUUID() },
          body: await request.text(),
        });
        return new Response(await resposta.text(), { status: resposta.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (request.method === 'GET') return new Response('Ligeiro + Mercado Pago: ok', { status: 200, headers: cors });
      return json({ erro: 'rota' }, 404);
    } catch (e) {
      /* o detalhe (resposta do banco ou do Mercado Pago) fica so no log do Cloudflare, nunca na resposta */
      console.error(caminho, e && e.message);
      return json({ erro: 'não deu certo agora, tente de novo' }, 500);
    }
  },
};

/* ================= banco no limite do dia ================= */

/* o limite do Firebase gratis zera a meia-noite do Pacifico (4 h ou 5 h em Brasilia): o aviso vale ate la */
function segundosAteZerar() {
  const agora = new Date();
  const pacifico = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const fim = new Date(pacifico); fim.setHours(24, 5, 0, 0);
  return Math.max(120, Math.round((fim - pacifico) / 1000));
}
/* o banco respondeu 429 (limite): guarda o aviso no KV ate zerar (uma gravacao a cada 5 min no maximo) */
function marcarPausa(env) {
  MEM.pausa = { valor: true, lida: Date.now() };
  if (!env || !env.CARDAPIO || Date.now() - MEM.pausaGravadaEm < 5 * 60 * 1000) return;
  MEM.pausaGravadaEm = Date.now();
  env.CARDAPIO.put('sistema:pausa', '1', { expirationTtl: segundosAteZerar() }).catch(() => {});
}
async function pausaAtiva(env) {
  if (MEM.pausa && Date.now() - MEM.pausa.lida < 60 * 1000) return MEM.pausa.valor;
  let valor = false;
  if (env.CARDAPIO) { try { valor = (await env.CARDAPIO.get('sistema:pausa')) === '1'; } catch (_) { valor = false; } }
  MEM.pausa = { valor: valor, lida: Date.now() };
  return valor;
}

/* ================= cardapio na borda ================= */

async function lerKv(env, chave, tipo) {
  if (!env.CARDAPIO) return null;
  try { return await env.CARDAPIO.getWithMetadata(chave, { type: tipo || 'text' }); } catch (_) { return null; }
}
async function gravarKv(env, chave, valor, metadata) {
  if (!env.CARDAPIO) return false;
  /* passou do limite de gravacoes do dia (1 mil no gratis): segue servindo o que leu do banco, sem guardar */
  try { await env.CARDAPIO.put(chave, valor, { metadata: metadata }); return true; } catch (_) { return false; }
}

/* A loja pronta para o site: da memoria (1 min), do KV (e confere o banco por tras se passou de 6 h) ou do banco. */
async function lerLoja(env, ctx, slug) {
  const mem = MEM.lojas[slug];
  if (mem && Date.now() - mem.lida < 60 * 1000) return mem;
  const g = await lerKv(env, 'loja:' + slug, 'text');
  if (g && g.value && g.metadata && g.metadata.em) {
    const item = { existe: true, corpo: g.value, meta: g.metadata, lida: Date.now() };
    MEM.lojas[slug] = item;
    if (Date.now() - g.metadata.em > LOJA_VALE) atualizarDepois(ctx, 'loja:' + slug, () => atualizarLoja(env, slug));
    return item;
  }
  return atualizarLoja(env, slug);
}

/* Le a loja no banco (1 leitura), tira o que nao e publico e guarda a resposta pronta no KV. */
async function atualizarLoja(env, slug) {
  const fb = await firebase(env);
  const doc = await fb.get('lojas/' + slug);
  if (!doc) {
    const nada = { existe: false, lida: Date.now(), meta: { em: Date.now(), dono: '' } };
    MEM.lojas[slug] = nada;
    return nada;
  }
  const publica = Object.assign({}, doc);
  delete publica.donoEmail; delete publica.senhaEquipeEm; delete publica.email;
  /* cupons: so "tem cupom" (o site mostra o campo do codigo); a lista fica na parte privada (loja antiga: ate o painel
     abrir e mudar, ela ainda esta no documento, mas a copia publica ja nao mostra) */
  publica.temCupom = doc.temCupom === true || (Array.isArray(doc.cupons) && doc.cupons.some((c) => c && c.ativo !== false));
  delete publica.cupons;
  const meta = {
    em: Date.now(),
    dono: String(doc.donoEmail || '').toLowerCase().slice(0, 200),
    fotosVersao: String(doc.fotosVersao || '').slice(0, 60),
    pacote: doc.fotosPacote === 1 && !doc.fotosAvulsas ? 1 : 0,
    capa: String(doc.capa || '').slice(0, 60),
    nome: String(doc.nome || '').slice(0, 80),
  };
  const corpo = '{"borda":1,"loja":' + JSON.stringify(publica) + '}';
  await gravarKv(env, 'loja:' + slug, corpo, meta);
  const item = { existe: true, corpo: corpo, meta: meta, lida: Date.now() };
  MEM.lojas[slug] = item;
  return item;
}

/* atualiza depois de responder (quem pediu nao espera); uma vez so por vez neste worker */
function atualizarDepois(ctx, chave, fazer) {
  if (MEM.atualizando[chave]) return;
  MEM.atualizando[chave] = true;
  const p = Promise.resolve().then(fazer).catch(() => {}).then(() => { delete MEM.atualizando[chave]; });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

async function nomeDaLoja(env, slug) {
  const meta = await etiquetaDaLoja(env, slug);
  return (meta && meta.nome) || '';
}
/* a etiqueta da copia da loja (dono, nome, versao das fotos): da memoria ou do KV, sem ler o corpo (o cardapio inteiro) */
async function etiquetaDaLoja(env, slug) {
  const mem = MEM.lojas[slug];
  if (mem && mem.meta && mem.existe) return mem.meta;
  const g = await lerKv(env, 'loja:' + slug, 'stream');
  if (g && g.value && g.value.cancel) g.value.cancel().catch(() => {});
  return g && g.metadata ? g.metadata : null;
}

/* Miniaturas: guardadas pela versao das fotos da loja. Os documentos do banco vao como vieram (texto), sem o worker
   abrir e remontar megas de foto (o plano gratis tem 10 ms de processamento por chamada); o site junta no aparelho. */
async function servirFotos(env, ctx, slug, versaoPedida, pronto, json) {
  const loja = await lerLoja(env, ctx, slug);
  if (!loja.existe) return json({ borda: 1, erro: 'nao-existe' }, 404, { 'Cache-Control': 'public, max-age=30' });
  const atual = String(loja.meta.fotosVersao || '');
  const guardar = versaoPedida && versaoPedida === atual ? 'public, max-age=31536000, immutable' : 'public, max-age=30';
  const g = await lerKv(env, 'fotos:' + slug, 'stream');
  if (g && g.value && g.metadata && g.metadata.versao === atual) return pronto(g.value, guardar);
  if (g && g.value && g.value.cancel) g.value.cancel().catch(() => {});
  /* versao nova: monta uma vez so (varios clientes ao mesmo tempo esperam a mesma montagem) */
  const chave = 'fotos:' + slug + ':' + atual;
  if (!MEM.montando[chave]) {
    MEM.montando[chave] = montarFotos(env, slug, loja.meta).then(async (corpo) => {
      await gravarKv(env, 'fotos:' + slug, corpo, { versao: atual });
      return corpo;
    }).finally(() => { delete MEM.montando[chave]; });
  }
  return pronto(await MEM.montando[chave], guardar);
}

async function montarFotos(env, slug, meta) {
  const fb = await firebase(env);
  const pasta = 'lojas/' + slug + '/fotos';
  const docs = [];
  let pacote = false;
  if (meta.pacote) {
    /* 4 pacotes de miniaturas + a capa inteira */
    const partes = await Promise.all([0, 1, 2, 3].map((i) => fb.getTexto(pasta + '/_pacote' + i)));
    partes.forEach((t) => { if (t) docs.push(t); });
    if (meta.capa) { const c = await fb.getTexto(pasta + '/' + meta.capa); if (c) docs.push(c); }
    pacote = true;
  } else {
    /* loja sem pacote (poucas fotos): a pasta inteira, de 50 em 50 */
    let pagina = '';
    for (let i = 0; i < 20; i++) {
      const t = await fb.listarTexto(pasta, 50, pagina);
      if (!t) break;
      docs.push(t);
      const prox = /"nextPageToken"\s*:\s*"([^"]+)"/.exec(t.slice(-400));
      if (!prox) break;
      pagina = prox[1];
    }
  }
  return '{"borda":1,"versao":' + JSON.stringify(String(meta.fotosVersao || '')) + ',"pacote":' + pacote + ',"docs":[' + docs.join(',') + ']}';
}

/* Uma foto grande: nome unico por foto, entao fica guardada para sempre (no KV e no celular do cliente). */
async function servirFoto(env, ctx, slug, id) {
  /* so foto de verdade (jpeg, png, webp, gif), sem o navegador adivinhar o tipo e sem rodar nada: uma "foto" SVG com
     script gravada por fora nao vira pagina no endereco do mensageiro */
  const TIPOS = { 'image/jpeg': 1, 'image/jpg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 };
  const imagem = (bytes, tipo) => {
    const t = String(tipo || 'image/jpeg').toLowerCase();
    return new Response(bytes, { status: 200, headers: { 'Content-Type': TIPOS[t] ? (t === 'image/jpg' ? 'image/jpeg' : t) : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  };
  const chave = 'foto:' + slug + ':' + id;
  const g = await lerKv(env, chave, 'arrayBuffer');
  if (g && g.value) return imagem(g.value, g.metadata && g.metadata.tipo);
  /* so busca no banco foto que a loja usa de verdade (item ou capa): endereco inventado nao gasta leitura */
  const naoTem = () => new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
  if (env.CARDAPIO) {
    const loja = await lerLoja(env, ctx, slug);
    if (!loja.existe) return naoTem();
    let usadas = loja.fotos;
    if (!usadas) {
      try {
        const l = JSON.parse(loja.corpo).loja || {};
        usadas = [l.capa].concat((l.produtos || []).map((p) => p && p.foto)).filter(Boolean);
      } catch (_) { usadas = []; }
      loja.fotos = usadas;
    }
    if (usadas.indexOf(id) < 0) return naoTem();
  }
  const fb = await firebase(env);
  const d = await fb.get('lojas/' + slug + '/fotos/' + id);
  const m = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/i.exec(d && typeof d.dados === 'string' ? d.dados : '');
  if (!m) return new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } });
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const gravar = gravarKv(env, chave, bytes.buffer, { tipo: m[1] });
  if (ctx && ctx.waitUntil) ctx.waitUntil(gravar);
  return imagem(bytes, m[1]);
}

/* o que a vitrine (pagina da cidade) mostra de cada loja: se nada disso mudou, a vitrine da borda continua valendo */
function camposDaVitrine(texto) {
  try {
    const x = JSON.parse(texto).loja || {};
    return JSON.stringify([x.aberta, x.usarHorarios, x.horarios, x.nome, x.tipo, x.emoji, x.descricao, x.logoDados, x.logoUrl, x.capa, x.capaUrl, x.cor,
      x.tempoEntrega, x.tempoPreparo, x.aceitaEntrega, x.aceitaRetirada, x.freteGratis, x.taxaEntrega, x.entregaGratisAcima, x.ativa, x.cidadeSlug, x.plano]);
  } catch (_) { return ''; }
}

/* Vitrine: o resumo de todas as lojas (N leituras) no maximo a cada 3 h, e so quando alguem pede. */
async function lerVitrine(env, ctx) {
  if (MEM.vitrine && Date.now() - MEM.vitrine.lida < 60 * 1000) return MEM.vitrine.corpo;
  const g = await lerKv(env, 'vitrine', 'text');
  if (g && g.value && g.metadata && g.metadata.em) {
    MEM.vitrine = { corpo: g.value, lida: Date.now() };
    if (Date.now() - g.metadata.em > VITRINE_VALE) atualizarDepois(ctx, 'vitrine', () => atualizarVitrine(env));
    return g.value;
  }
  return atualizarVitrine(env);
}
async function atualizarVitrine(env) {
  const fb = await firebase(env);
  const lista = await fb.listar('vitrine');
  const corpo = '{"borda":1,"lista":' + JSON.stringify(lista.map((d) => { const x = Object.assign({}, d); delete x._id; return x; })) + '}';
  await gravarKv(env, 'vitrine', corpo, { em: Date.now() });
  MEM.vitrine = { corpo: corpo, lida: Date.now() };
  return corpo;
}

/* ================= avisos no celular (Web Push) ================= */
/* Nada aqui le o banco: os aparelhos da loja ficam no KV e o aviso do cliente vai dentro do proprio pedido.
   O aviso sai criptografado (RFC 8291): so o celular de destino consegue ler; o Google e a Apple so entregam. */

/* guarda a marca por uma hora (a memoria nao cresce sem fim) */
function lembrar(mapa, chave) {
  const agora = Date.now();
  const chaves = Object.keys(mapa);
  if (chaves.length > 500) chaves.forEach((k) => { if (agora - mapa[k] > 60 * 60 * 1000) delete mapa[k]; });
  mapa[chave] = agora;
}

/* O par de chaves dos avisos (VAPID) nasce na primeira vez e fica no KV: ninguem precisa criar segredo no Cloudflare. */
async function chavesVapid(env) {
  if (MEM.vapid) return MEM.vapid;
  /* erro de leitura sobe (quem chamou responde erro): trocar a chave derrubaria todos os aparelhos e clientes inscritos */
  const t = await env.CARDAPIO.get('sistema:vapid');
  let guardada = null;
  try { guardada = t ? JSON.parse(t) : null; } catch (_) { guardada = null; }
  if (!t) {
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
    guardada = { privada: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, publica: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))) };
    await env.CARDAPIO.put('sistema:vapid', JSON.stringify(guardada));
  } else if (!guardada || !guardada.privada || !guardada.publica) {
    throw new Error('chave dos avisos estragada no KV');
  }
  const chave = await crypto.subtle.importKey('jwk', guardada.privada, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  MEM.vapid = { publica: guardada.publica, chave: chave };
  return MEM.vapid;
}

/* assinatura do Ligeiro para o servico de avisos (uma por servico, guardada 1 hora) */
async function jwtVapid(vapid, aud) {
  const m = MEM.jwt[aud];
  if (m && Date.now() < m.vale) return m.jwt;
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64url(JSON.stringify({ aud: aud, exp: agora + 12 * 3600, sub: 'mailto:' + ADMIN }));
  const ass = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.chave, new TextEncoder().encode(cab + '.' + corpo)));
  const jwt = cab + '.' + corpo + '.' + b64url(ass);
  MEM.jwt[aud] = { jwt: jwt, vale: Date.now() + 60 * 60 * 1000 };
  return jwt;
}

function deB64url(s) {
  const t = String(s || '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function juntar() {
  const partes = Array.prototype.slice.call(arguments);
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  partes.forEach((p) => { out.set(p, i); i += p.length; });
  return out;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, k, bytes * 8));
}
/* chave de uso unico desta chamada (vale para todos os aparelhos avisados nela: o sal de cada aviso e novo) */
async function efemeraNova() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privada: par.privateKey, publica: new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)) };
}
async function cifrarAviso(insc, texto, efemera) {
  const enc = new TextEncoder();
  const doAparelho = deB64url(insc.p256dh);
  const auth = deB64url(insc.auth);
  const chaveAparelho = await crypto.subtle.importKey('raw', doAparelho, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveAparelho }, efemera.privada, 256));
  const ikm = await hkdf(auth, segredo, juntar(enc.encode('WebPush: info\0'), doAparelho, efemera.publica), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, juntar(enc.encode(texto), new Uint8Array([2]))));
  return juntar(sal, new Uint8Array([0, 0, 16, 0]), new Uint8Array([efemera.publica.length]), efemera.publica, cifrado);
}

/* inscricao que o navegador mandou, conferida: so servico de aviso conhecido e chaves do tamanho certo */
function limparInscricao(x) {
  if (!x || typeof x !== 'object') return null;
  const e = String(x.endpoint || x.e || '');
  const k = String((x.keys && x.keys.p256dh) || x.k || '').replace(/=+$/, '');
  const a = String((x.keys && x.keys.auth) || x.a || '').replace(/=+$/, '');
  if (e.length > 1000 || !SERVICO_AVISO.test(e) || !/^[A-Za-z0-9_-]{86,88}$/.test(k) || !/^[A-Za-z0-9_-]{20,24}$/.test(a)) return null;
  return { endpoint: e, p256dh: k, auth: a };
}

/* Manda um aviso. Devolve o codigo do servico: 201 entregue; 404/410 o aparelho saiu; 403 chave antiga. */
async function mandarAviso(env, insc, aviso, efemera) {
  if (!insc || !env.CARDAPIO) return 0;
  const vapid = await chavesVapid(env);
  const jwt = await jwtVapid(vapid, new URL(insc.endpoint).origin);
  const carga = JSON.stringify({ titulo: aviso.titulo, texto: aviso.texto, url: aviso.url || '#/', tag: aviso.tag || '', fixo: !!aviso.fixo });
  const cab = { Authorization: 'vapid t=' + jwt + ', k=' + vapid.publica, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(aviso.validade || 3600), Urgency: 'high' };
  /* aviso do mesmo pedido com o celular desligado: chega so o ultimo (saiu para entrega, e nao preparando + saiu) */
  if (aviso.topico) cab.Topic = aviso.topico;
  try {
    const r = await fetch(insc.endpoint, { method: 'POST', headers: cab, body: await cifrarAviso(insc, carga, efemera || await efemeraNova()) });
    return r.status;
  } catch (_) { return 0; }
}

/* Avisa varios aparelhos da loja de uma vez; aparelho que saiu (desinstalou, trocou de chave) sai da lista. */
async function avisarAparelhos(env, slug, lista, montar) {
  const efemera = await efemeraNova();
  const mortos = [];
  let enviados = 0;
  await Promise.all(lista.map(async (a) => {
    const s = await mandarAviso(env, { endpoint: a.e, p256dh: a.k, auth: a.a }, montar(a), efemera);
    if (s >= 200 && s < 300) enviados += 1;
    else if (s === 403 || s === 404 || s === 410) mortos.push(a.e);
  }));
  if (mortos.length) {
    /* leitura que falhou nao pode virar lista vazia gravada por cima */
    const atual = await aparelhosDaLoja(env, slug).catch(() => null);
    if (atual) await gravarAparelhos(env, slug, atual.filter((a) => mortos.indexOf(a.e) < 0));
  }
  return enviados;
}

async function aparelhosDaLoja(env, slug) {
  if (!env.CARDAPIO) return [];
  const t = await env.CARDAPIO.get('aparelhos:' + slug); /* erro de leitura sobe: quem chama nao grava nada */
  if (!t) return [];
  try { const l = JSON.parse(t); return Array.isArray(l) ? l : []; } catch (_) { return []; }
}
/* papeis do aparelho: painel, cozinha e/ou entregas (o mesmo celular pode ter mais de um) */
function papeisDe(a) { return Array.isArray(a.p) ? a.p.filter((x) => PAPEIS.indexOf(x) >= 0) : (PAPEIS.indexOf(a.p) >= 0 ? [a.p] : ['painel']); }
function temPapel(a, papel) { return papeisDe(a).indexOf(papel) >= 0; }
/* no maximo 8 aparelhos por loja (os mais novos ficam): cada aviso cifrado gasta um pouco dos 10 ms do plano gratis */
function gravarAparelhos(env, slug, lista) { return gravarKv(env, 'aparelhos:' + slug, JSON.stringify(lista.slice(-8)), { em: Date.now() }); }

/* quem chamou (login do Firebase), guardado 20 min: o painel nao confere o login a cada pedido que anda */
async function quemChamou(env, request) {
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken || idToken.length > 4000) return '';
  const m = MEM.quem[idToken];
  if (m && Date.now() - m.em < 20 * 60 * 1000 && Date.now() < m.vence) return m.email;
  const email = (await usuarioDoToken(await firebase(env), idToken)).toLowerCase();
  if (email) {
    const chaves = Object.keys(MEM.quem);
    if (chaves.length > 200) chaves.forEach((k) => { if (Date.now() - MEM.quem[k].em > 20 * 60 * 1000) delete MEM.quem[k]; });
    MEM.quem[idToken] = { email: email, em: Date.now(), vence: venceDoToken(idToken) };
  }
  return email;
}
/* dono (pela copia da borda, sem ler o banco), equipe da loja ou o admin */
async function ehDaLoja(env, slug, email) {
  if (!email) return false;
  if (email === ADMIN || email === 'equipe-' + slug + '@equipe.ligeiro.app.br') return true;
  const meta = await etiquetaDaLoja(env, slug);
  let dono = meta ? String(meta.dono || '') : '';
  if (!dono) { const item = await atualizarLoja(env, slug); dono = item.existe ? item.meta.dono : ''; }
  return !!dono && dono === email;
}

function reais(centavos) {
  const v = Math.round(Number(centavos) || 0);
  const inteiro = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + inteiro + ',' + String(v % 100).padStart(2, '0');
}
function urlDoPapel(slug, papel) { return '#/' + (papel === 'cozinha' ? 'cozinha' : papel === 'entregas' ? 'entrega' : 'painel') + '/' + slug; }
/* a tela do pedido do cliente: o aviso guarda "#/cidade/loja/pedido/" (nasce junto com o pedido, antes do numero) */
function urlDoCliente(aviso, id) {
  const u = String((aviso && aviso.u) || '');
  if (/^#\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}\/pedido\/$/.test(u) && PEDIDO_ID.test(id || '')) return u + id;
  return /^#\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}\/pedido\/[A-Za-z0-9]{20}$/.test(u) ? u : '#/';
}
/* o que o painel manda sobre o pedido, conferido e cortado (vira texto de aviso, nunca mais que isso) */
function resumoLimpo(r, id) {
  const x = r && typeof r === 'object' ? r : {};
  const curto = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  return {
    id: id, senha: curto(x.senha, 8), total: Math.max(0, Math.round(Number(x.total) || 0)),
    tipoEntrega: x.tipoEntrega === 'entrega' ? 'entrega' : 'retirada', origem: x.origem === 'balcao' ? 'balcao' : '',
    cliente: { nome: curto(x.nome, 40) }, bairro: curto(x.bairro, 40),
  };
}

/* pedido novo (ou Pix que caiu) para o painel e a cozinha: senha, valor e o tipo (o resto a equipe ve no painel) */
function avisoDaLoja(p, slug, papel, pix) {
  const onde = p.tipoEntrega === 'entrega' ? 'Entrega' : (p.origem === 'balcao' ? 'Balcão' : 'Retirada');
  return { titulo: (pix ? (p.formaPagamento === 'cartao_online' ? 'Cartão pago! Senha ' : 'Pix pago! Senha ') : 'Pedido novo! Senha ') + p.senha, texto: reais(p.total) + ' · ' + onde + ' · Toque para abrir', url: urlDoPapel(slug, papel), tag: 'pedido-' + p.id, fixo: true, validade: 1800 };
}
/* saiu da cozinha para entrega: para o entregador */
function avisoDeEntrega(r, slug) {
  return { titulo: 'Entrega pronta! Senha ' + r.senha, texto: (r.bairro ? r.bairro + ' · ' : '') + 'Toque para ver o endereço.', url: urlDoPapel(slug, 'entregas'), tag: 'entrega-' + r.id, fixo: true, validade: 1800 };
}
/* o pedido andou: o que o cliente le no celular (titulo com o nome da loja, que ele reconhece) */
function avisoDoCliente(status, r, nomeLoja) {
  const loja = nomeLoja || 'Seu pedido';
  const senha = ' Senha ' + r.senha + '.';
  const entrega = r.tipoEntrega === 'entrega';
  if (status === 'pago') return { titulo: loja, texto: 'Pagamento confirmado! Seu pedido entrou na fila.' + senha };
  if (status === 'producao') return { titulo: loja, texto: 'Estão preparando o seu pedido. ' + (entrega ? 'Logo sai para entrega.' : 'Logo fica pronto para retirar.') + senha };
  if (status === 'pronto') return { titulo: loja, texto: entrega ? 'Seu pedido saiu para entrega! Já está a caminho.' + senha : 'Seu pedido está pronto! Pode vir buscar.' + senha };
  if (status === 'cancelado') return { titulo: loja, texto: 'Seu pedido foi cancelado pela loja. Toque para ver.' + senha };
  return null;
}

/* Pix que caiu pelo Mercado Pago: avisa o painel e a cozinha e, se o cliente quis, o celular dele. Uma vez por pedido. */
async function avisarPixPago(env, slug, p) {
  if (!env || !env.CARDAPIO) return;
  const marca = 'pix/' + slug + '/' + p.id;
  if (MEM.avisados[marca]) return;
  lembrar(MEM.avisados, marca);
  const tarefas = [];
  const lista = ((await aparelhosDaLoja(env, slug).catch(() => null)) || []).filter((a) => temPapel(a, 'painel') || temPapel(a, 'cozinha'));
  if (lista.length) tarefas.push(avisarAparelhos(env, slug, lista, (a) => avisoDaLoja(p, slug, temPapel(a, 'painel') ? 'painel' : 'cozinha', true)));
  const insc = limparInscricao(p.aviso);
  if (insc) {
    const texto = avisoDoCliente('pago', { senha: p.senha, tipoEntrega: p.tipoEntrega }, await nomeDaLoja(env, slug));
    tarefas.push(mandarAviso(env, insc, Object.assign(texto, { url: urlDoCliente(p.aviso, p.id), tag: 'p' + p.id, topico: 'p' + p.id })));
  }
  await Promise.all(tarefas);
}

/* ================= Pix ================= */

/* Consulta o pagamento no Mercado Pago com o token da loja e, se aprovado, libera o pedido. Devolve o status novo. */
async function conferirPagamento(fb, slug, idPagamento, pedidoId, env) {
  const token = await tokenDaLoja(fb, slug, env);
  if (!token) return null;
  const ehOrder = String(idPagamento).indexOf('ORD') === 0;
  let pg;
  try {
    pg = await mp(token, (ehOrder ? '/v1/orders/' : '/v1/payments/') + encodeURIComponent(idPagamento), {});
  } catch (e) {
    if (e && e.status === 401) delete MEM.mp[slug]; /* token trocado ou desconectado: le de novo na proxima */
    /* order ou pagamento que nao existe nesta conta (aviso inventado, ou de outra conta): nada a conferir */
    if (e && e.status === 404) return null;
    throw e;
  }
  let ref = String(pg.external_reference || '');
  if (ref.indexOf('|') > 0) ref = ref.split('|')[1];
  else if (ref.indexOf('__') > 0) ref = ref.split('__')[1];
  const id = pedidoId || ref;
  if (!id) return null;
  if (pg.status === 'approved' || pg.status === 'processed') {
    const p = await fb.get('lojas/' + slug + '/pedidos/' + id);
    if (!p) return null;
    /* o pagamento tem que ser DESTE pedido e do MESMO valor: ninguem reaproveita um Pix de R$ 1 pra liberar outro pedido */
    const limpo = (t) => String(t || '').replace(/[^A-Za-z0-9_-]/g, '');
    const refDoMp = String(pg.external_reference || '');
    const refCerta = refDoMp === limpo(slug + '__' + id).slice(0, 64) || refDoMp === slug + '|' + id || refDoMp === id;
    const valorMp = Math.round(Number(pg.total_amount != null ? pg.total_amount : pg.transaction_amount) * 100);
    if (!refCerta || valorMp !== p.total) return 'aguardando_pagamento';
    const agora3 = new Date().toISOString();
    let entrou = true;
    if (p.status === 'aguardando_pagamento') {
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && (p.canceladoPor === 'cliente' || p.canceladoPor === 'pix-vencido') && !p.pagoEm) {
      /* pagou e o pedido ja tinha sido cancelado (desistiu depois de copiar o codigo, ou o Pix "venceu" pelo relogio do aparelho):
         o dinheiro entrou, entao o pedido volta pra fila, marcado pra loja ver */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && p.canceladoPor === 'pix-vencido' && p.pagoEm && !p.pagoAposCancelar) {
      /* o painel cancelou por vencimento em cima do "pago" que o mensageiro tinha acabado de gravar:
         o dinheiro entrou, entao volta pra fila do mesmo jeito (mantem o pagoEm de quando caiu) */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && p.pagamentoStatus !== 'pago') {
      /* a loja cancelou e o pagamento caiu depois: o pedido continua cancelado, mas fica "pago" para o painel mostrar o
         "Devolver" (antes o dinheiro ficava parado sem ninguem saber) */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
      entrou = false;
    } else entrou = false;
    /* o pedido acabou de entrar na fila: avisa a loja e o cliente (aviso que falha nunca derruba o pagamento) */
    if (entrou) await avisarPixPago(env, slug, Object.assign({}, p, { id: id })).catch(() => {});
    return 'pago';
  }
  if (['failed', 'cancelled', 'expired', 'rejected'].indexOf(String(pg.status)) >= 0) {
    /* cartao que estava em analise e foi recusado: solta a trava, para o cliente tentar outro cartao ou o Pix */
    const p = await fb.get('lojas/' + slug + '/pedidos/' + id).catch(() => null);
    if (p && p.formaPagamento === 'cartao_online' && p.status === 'aguardando_pagamento' && p.mp && String(p.mp.id) === String(idPagamento) && p.cobrandoEm) {
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { cobrandoEm: '', cobrancaIncerta: '', atualizadoEm: new Date().toISOString() }).catch(() => {});
    }
  }
  return 'aguardando_pagamento';
}

/* Token da loja: da memoria (10 min), da borda (6 h, so o worker le: nenhuma rota publica chega nessa chave) ou do
   banco. A copia da borda sai quando o dono salva algo (/publicar) ou conecta de novo: trocar de conta vale na hora.
   Se veio pelo "Conectar" e esta perto de vencer, renova sozinho com o refresh_token. */
const TOKEN_VALE = 6 * 3600 * 1000;
function esquecerToken(env, ctx, slug) {
  /* a copia da borda nao precisa sair: ela vale so para a versao da copia da loja em que foi guardada, e o /publicar
     (ou o conectar) acabou de fazer uma copia nova. Apagar gastava 2 exclusoes do KV a cada "Salvar" do dono */
  delete MEM.mp[slug];
  delete MEM.cupons[slug];
}
/* versao da copia da loja na borda (a hora em que foi feita): muda a cada /publicar, conectar ou copia renovada */
async function versaoDaCopia(env, slug) {
  const mem = MEM.lojas[slug];
  if (mem && mem.existe && mem.meta && Date.now() - mem.lida < 60 * 1000) return Number(mem.meta.em) || 0;
  const g = await lerKv(env, 'loja:' + slug, 'stream');
  if (g && g.value && g.value.cancel) g.value.cancel().catch(() => {});
  return g && g.metadata ? Number(g.metadata.em) || 0 : 0;
}
/* Cupons da loja (lista privada): da memoria (1 min), da borda (6 h, chave que nenhuma rota publica alcanca) ou do
   banco (a parte privada; loja antiga, ainda com a lista no documento: dali). O painel salva: a copia sai (/publicar) */
async function cuponsDaLoja(env, fb, slug) {
  const m = MEM.cupons[slug];
  if (m && Date.now() - m.em < 60 * 1000) return m.lista;
  let lista = null;
  const versao = await versaoDaCopia(env, slug);
  const g = await lerKv(env, 'cupons:' + slug, 'text');
  if (g && g.value && g.metadata && versao && Number(g.metadata.loja || 0) === versao && Date.now() - Number(g.metadata.em || 0) < TOKEN_VALE) { try { lista = JSON.parse(g.value); } catch (_) { lista = null; } }
  if (!Array.isArray(lista)) {
    const priv = await fb.get('lojas/' + slug + '/privado/cupons');
    if (priv && Array.isArray(priv.lista)) lista = priv.lista;
    else { const l = await fb.get('lojas/' + slug); lista = l && Array.isArray(l.cupons) ? l.cupons : []; }
    lista = lista.filter((c) => c && typeof c.codigo === 'string').map((c) => ({ codigo: String(c.codigo).slice(0, 20), percentual: Number(c.percentual) || 0, minimo: Number(c.minimo) || 0, limite: Number(c.limite) || 0, ativo: c.ativo !== false }));
    if (versao) await gravarKv(env, 'cupons:' + slug, JSON.stringify(lista), { em: Date.now(), loja: versao });
  }
  MEM.cupons[slug] = { lista: lista, em: Date.now() };
  return lista;
}
async function tokenDaLoja(fb, slug, env) {
  const m = MEM.mp[slug];
  if (m && Date.now() - m.em < 10 * 60 * 1000) return m.token;
  const versao = env && env.CARDAPIO ? await versaoDaCopia(env, slug) : 0;
  if (env && env.CARDAPIO) {
    const g = await lerKv(env, 'mptoken:' + slug, 'text');
    if (g && g.value && g.metadata && versao && Number(g.metadata.loja || 0) === versao && Date.now() - Number(g.metadata.em || 0) < TOKEN_VALE && (!g.metadata.vence || g.metadata.vence - Date.now() > 7 * 864e5)) {
      MEM.mp[slug] = { token: g.value, em: Date.now() };
      return g.value;
    }
  }
  let seg = await fb.get('lojas/' + slug + '/privado/mercadopago');
  if (env && env.CARDAPIO) {
    /* renovacao que o banco nao aceitou na hora: grava agora (o refresh que vale e esse) */
    const pend = await lerKv(env, 'mpnovo:' + slug, 'text');
    if (pend && pend.value) {
      try {
        const novo = JSON.parse(pend.value);
        await fb.merge('lojas/' + slug + '/privado/mercadopago', novo);
        seg = Object.assign({}, seg || {}, novo);
        await env.CARDAPIO.delete('mpnovo:' + slug).catch(() => {});
      } catch (_) { /* fica para a proxima */ }
    }
  }
  let token = seg && seg.token ? String(seg.token).trim() : '';
  const vence = seg && seg.tokenExpiraEm ? new Date(seg.tokenExpiraEm).getTime() : 0;
  if (token && seg.refresh && env && env.MP_CLIENT_ID && env.MP_CLIENT_SECRET && vence && vence - Date.now() < 7 * 864e5) {
    try {
      const r = await fetch(MP + '/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: seg.refresh }),
      });
      const t = await r.json().catch(() => ({}));
      if (r.ok && t.access_token) {
        const novo = { token: t.access_token, refresh: t.refresh_token || seg.refresh, publica: String(t.public_key || seg.publica || ''), tokenExpiraEm: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(), atualizadoEm: new Date().toISOString() };
        /* o refresh antigo ja nao vale: grava o novo com insistencia; se o banco nao aceitar, guarda na borda para a proxima */
        let gravou = false;
        for (let v = 0; v < 3 && !gravou; v++) { try { await fb.merge('lojas/' + slug + '/privado/mercadopago', novo); gravou = true; } catch (_) { /* tenta de novo */ } }
        if (!gravou) await gravarKv(env, 'mpnovo:' + slug, JSON.stringify(novo), { em: Date.now() });
        if (t.public_key && t.public_key !== seg.publica) {
          await fb.merge('lojas/' + slug, { mpChavePublica: String(t.public_key), atualizadoEm: new Date().toISOString() }).catch(() => {});
          /* o formulario do cartao no site usa a chave publica: a copia da borda muda agora, nao em 6 h */
          if (env && env.CARDAPIO) await atualizarLoja(env, slug).catch(() => {});
        }
        token = t.access_token;
      }
    } catch (_) { /* segue com o token atual */ }
  }
  MEM.mp[slug] = { token: token, em: Date.now() };
  /* sem token (loja desconectada) nao guarda: a proxima conferencia le o banco, e o Pix volta assim que conectar */
  if (token && versao && env && env.CARDAPIO) {
    const venceEm = seg && seg.tokenExpiraEm ? new Date(seg.tokenExpiraEm).getTime() : 0;
    await gravarKv(env, 'mptoken:' + slug, token, { em: Date.now(), vence: venceEm || 0, loja: versao });
  }
  return token;
}

async function mp(token, caminho, opcoes) {
  const extra = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(20000) } : {};
  const r = await fetch(MP + caminho, Object.assign({}, extra, opcoes, { headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, (opcoes && opcoes.headers) || {}) }));
  const texto = await r.text();
  let dados = {};
  try { dados = JSON.parse(texto); } catch (_) { dados = { message: texto }; }
  if (!r.ok) { const e = new Error('Mercado Pago ' + r.status + ': ' + (dados.message || texto.slice(0, 120))); e.status = r.status; e.dados = dados; throw e; }
  return dados;
}

/* id de documento como o do Firestore: 20 letras e numeros, sorteados com o gerador seguro */
function idAleatorio(n) {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += letras[b[i] % 62];
  return s;
}

/* Hora em que o pedido nasceu: a do banco (relogio do Google); sem ela, a do aparelho */
function nasceuEm(p) {
  const banco = Date.parse((p && p._criadoNoBanco) || '');
  if (!isNaN(banco)) return banco;
  const aparelho = Date.parse((p && p.criadoEm) || '');
  return isNaN(aparelho) ? 0 : aparelho;
}

/* O valor do pedido confere com o cardapio? Refaz a conta com as MESMAS regras do site e do painel (REGRAS, copia do
   js/regras.js), em cima da copia da loja na borda (sem ler o banco). Nao bateu com a copia (a loja pode ter acabado de
   mudar um preco): le a loja uma vez e confere de novo. Sem cardapio legivel, nao cobra. */
async function valorConfere(env, fb, slug, p) {
  const conferir = (loja) => { try { return !!loja && REGRAS.conferirTotal(loja, p).ok === true; } catch (_) { return false; } };
  if (env.CARDAPIO) {
    const copia = await lerKv(env, 'loja:' + slug, 'text');
    if (copia && copia.value) { try { if (conferir(JSON.parse(copia.value).loja)) return true; } catch (_) { /* copia torta: le o banco */ } }
    const item = await atualizarLoja(env, slug).catch(() => null);
    if (!item || !item.existe) return false;
    try { return conferir(JSON.parse(item.corpo).loja); } catch (_) { return false; }
  }
  return conferir(await fb.get('lojas/' + slug));
}

/* Aviso do Mercado Pago assinado com a chave secreta do webhook (cabecalho x-signature: ts=...,v1=...) */
async function assinaturaMpConfere(request, segredo, idDados) {
  const cab = request.headers.get('x-signature') || '';
  const pedidoId = request.headers.get('x-request-id') || '';
  const partes = {};
  cab.split(',').forEach((p) => { const i = p.indexOf('='); if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  if (!partes.ts || !partes.v1) return false;
  const molde = 'id:' + String(idDados).toLowerCase() + ';' + (pedidoId ? 'request-id:' + pedidoId + ';' : '') + 'ts:' + partes.ts + ';';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(molde)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}

/* ate quando vale o token do Google (o "exp" dele); sem ler, 20 min */
function venceDoToken(idToken) {
  try {
    const meio = String(idToken).split('.')[1] || '';
    const json = JSON.parse(atob(meio.replace(/-/g, '+').replace(/_/g, '/')));
    if (json && json.exp) return Number(json.exp) * 1000;
  } catch (_) { /* segue */ }
  return Date.now() + 20 * 60 * 1000;
}

/* Pix vencido pelo relogio do SERVIDOR (o do aparelho pode estar errado): prazo do codigo no passado ou,
   sem codigo, pedido que nasceu no banco ha mais de 35 min (hora do proprio Firestore, nao o criadoEm do celular) */
function pixVencidoNoServidor(p, agora) {
  if (!p || p.status !== 'aguardando_pagamento' || (p.formaPagamento !== 'pix' && p.formaPagamento !== 'cartao_online')) return false;
  if (p.pixExpiraEm) { const fim = Date.parse(p.pixExpiraEm); return !isNaN(fim) && agora > fim; }
  const nasceu = Date.parse(p._criadoNoBanco || '');
  return !isNaN(nasceu) && agora > nasceu + 35 * 60 * 1000;
}

/* o motivo da recusa que o Mercado Pago devolveu (no pedido ou no erro) */
function detalheDoCartao(d) {
  const pg = d && d.transactions && d.transactions.payments && d.transactions.payments[0];
  const erros = d && Array.isArray(d.errors) ? d.errors.map((x) => (x && [x.code, x.message].concat(Array.isArray(x.details) ? x.details : []).filter(Boolean).join(' ')) || '').join(' ') : '';
  return String((pg && (pg.status_detail || pg.status)) || (d && d.status_detail) || erros || (d && d.message) || '');
}
function motivoDoCartao(detalhe) {
  const t = String(detalhe || '').toLowerCase();
  if (/insufficient/.test(t)) return 'O cartão está sem limite para esse valor. Tente outro cartão ou pague no Pix.';
  if (/security_code|cvv/.test(t)) return 'O código de segurança (atrás do cartão) não confere. Confira e tente de novo.';
  if (/3ds|challenge/.test(t)) return 'O banco pediu uma confirmação que ainda não fazemos por aqui. Tente outro cartão ou pague no Pix.';
  if (/date|expir/.test(t)) return 'A validade do cartão não confere. Confira e tente de novo.';
  if (/call_for_authorize|authoriz/.test(t)) return 'O banco pediu para você autorizar a compra no aplicativo dele. Autorize e tente de novo.';
  if (/disabled|blocked/.test(t)) return 'Esse cartão está bloqueado. Fale com o banco ou use outro cartão.';
  if (/max_attempts/.test(t)) return 'Tentativas demais com esse cartão. Use outro cartão ou pague no Pix.';
  if (/duplicated/.test(t)) return 'Esse pagamento parece repetido. Confira no aplicativo do banco antes de tentar de novo.';
  if (/high_risk|fraud|blacklist/.test(t)) return 'O pagamento não passou na análise de segurança. Use outro cartão ou pague no Pix.';
  if (/bad_filled|card_number|invalid/.test(t)) return 'Algum dado do cartão não confere. Confira e tente de novo.';
  return 'O banco recusou o pagamento. Tente outro cartão ou pague no Pix.';
}

/* o endereco de quem chama, para os limites: no IPv6 vale a casa (/64), porque o celular troca o fim a toda hora */
function ipDaCasa(ip) {
  const t = String(ip || 'sem-ip');
  return t.indexOf(':') >= 0 ? t.split(':').slice(0, 4).join(':') + '::/64' : t;
}

function separarNome(nomeCompleto, lojaNome) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  const primeiro = partes.shift() || 'Cliente';
  return { primeiro, sobrenome: partes.join(' ') || lojaNome || 'Ligeiro' };
}

/* ---------------- usuarios (Identity Toolkit) com a mesma conta de servico ---------------- */
async function usuarioDoToken(fb, idToken) {
  const conta = await contaDoToken(fb, idToken);
  return conta ? conta.email : '';
}
/* e-mail (minusculo), id e a marca atual do login; so e-mail conferido e conta ativa: quem criou conta de e-mail e
   senha com o e-mail do dono, sem confirmar, nao passa */
async function contaDoToken(fb, idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ idToken }) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const u = (j.users || [])[0];
  if (!u || !u.email || u.emailVerified !== true || u.disabled === true) return null;
  let marca = {};
  try { marca = JSON.parse(u.customAttributes || '{}') || {}; } catch (_) { marca = {}; }
  return { email: String(u.email).toLowerCase(), localId: u.localId, marca: marca };
}
/* marca "lojas" no login do dono: a lista das lojas dele (as regras leem daqui, sem ler a loja). Cabe em 1000
   caracteres: fica com as mais novas. Login de equipe nunca recebe (a marca da equipe e outra) */
/* a marca de dono vale 3 dias; o painel renova quando falta menos de 1 (1 leitura no banco a cada ~2 dias) */
const MARCA_VALE = 3 * 86400;
async function gravarMarcaDono(fb, email, conta, lojas) {
  if (/@equipe\.ligeiro\.app\.br$/.test(email)) return false;
  if (!conta) {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + fb.projeto + '/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email: [email] }) });
    const u = ((r.ok ? await r.json().catch(() => ({})) : {}).users || [])[0];
    if (!u || !u.localId) return false;
    let marca = {};
    try { marca = JSON.parse(u.customAttributes || '{}') || {}; } catch (_) { marca = {}; }
    conta = { email: email, localId: u.localId, marca: marca };
  }
  let lista = lojas.filter((x) => SLUG.test(x));
  const nova = Object.assign({}, conta.marca);
  delete nova.lojas;
  delete nova.lojasAte;
  while (lista.length && JSON.stringify(Object.assign({}, nova, { lojas: lista, lojasAte: 0 })).length > 900) lista = lista.slice(1);
  if (lista.length) { nova.lojas = lista; nova.lojasAte = Math.floor(Date.now() / 1000) + MARCA_VALE; }
  const r2 = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + fb.projeto + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: conta.localId, customAttributes: JSON.stringify(nova) }) });
  if (!r2.ok) throw new Error('marca do dono ' + r2.status);
  return true;
}
async function definirUsuarioEquipe(fb, email, senha, slug) {
  const base = 'https://identitytoolkit.googleapis.com/v1/projects/' + fb.projeto;
  /* marca da equipe no login: as regras do banco reconhecem a equipe por ela (quem se cadastra sozinho nao consegue) */
  const marca = JSON.stringify({ equipe: slug });
  const r = await fetch(base + '/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email: [email] }) });
  const j = r.ok ? await r.json().catch(() => ({})) : {};
  const u = (j.users || [])[0];
  if (u && u.localId) {
    const r2 = await fetch(base + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: u.localId, password: senha, emailVerified: true, customAttributes: marca }) }); /* conferido: as regras do banco exigem */
    if (!r2.ok) throw new Error('não deu pra trocar a senha (' + r2.status + ')');
    return;
  }
  const r3 = await fetch(base + '/accounts', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email, password: senha, emailVerified: true, displayName: 'Equipe' }) });
  if (!r3.ok) throw new Error('não deu pra criar o usuário de equipe (' + r3.status + ' ' + (await r3.text()).slice(0, 120) + ')');
  /* a criacao nao aceita a marca: grava logo depois. Se falhar, o dono salva a senha de novo e cai no caminho de cima */
  const criado = await r3.json().catch(() => ({}));
  const r4 = criado.localId ? await fetch(base + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: criado.localId, customAttributes: marca }) }) : null;
  if (!r4 || !r4.ok) throw new Error('não deu pra liberar o usuário de equipe, salve a senha de novo (' + (r4 ? r4.status : 'sem id') + ')');
}

/* ---------------- Firestore pela REST, autenticado com a conta de servico (JWT RS256) ---------------- */
/* A chave do Google vale 1 hora: guardada 50 min na memoria (antes era assinada de novo a cada chamada). */
async function firebase(env) {
  if (!env.FIREBASE_SA) throw new Error('falta o segredo FIREBASE_SA no worker');
  const sa = JSON.parse(env.FIREBASE_SA);
  let g = MEM.google;
  if (!g || g.email !== sa.client_email || Date.now() > g.vence) {
    g = MEM.google = { email: sa.client_email, token: await tokenDaContaDeServico(sa), vence: Date.now() + 50 * 60 * 1000 };
  }
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents/';
  const cab = { Authorization: 'Bearer ' + g.token, 'Content-Type': 'application/json' };
  /* chave recusada: assina outra na proxima. 429: o banco gratis chegou no limite de hoje */
  const recusou = (r) => { if (r.status === 401) MEM.google = null; if (r.status === 429) marcarPausa(env); };
  /* defesa extra: caminho de documento nunca carrega ?, #, % ou .. (nem que alguma rota esqueca de conferir) */
  const seguro = (caminho) => { if (/[?#%\s]|\.\./.test(String(caminho))) throw new Error('caminho inválido'); return caminho; };
  return {
    cab: cab, projeto: sa.project_id,
    async get(caminho, comHora) {
      const r = await fetch(base + seguro(caminho), { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) { recusou(r); throw new Error('Firestore get ' + r.status); }
      const doc = await r.json();
      const dados = deFirestore(doc.fields || {});
      /* comHora: junta a hora em que o documento nasceu no banco (relogio do Google, nao o do aparelho) */
      if (comHora) { dados._criadoNoBanco = doc.createTime || ''; dados._atualizadoNoBanco = doc.updateTime || ''; }
      return dados;
    },
    /* o documento como o banco manda (texto), sem abrir: fotos grandes passam direto */
    async getTexto(caminho) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return '';
      if (!r.ok) { recusou(r); throw new Error('Firestore get ' + r.status); }
      return r.text();
    },
    async listarTexto(colecao, tamanho, pagina) {
      const r = await fetch(base + colecao + '?pageSize=' + (tamanho || 50) + (pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''), { headers: cab });
      if (r.status === 404) return '';
      if (!r.ok) { recusou(r); throw new Error('Firestore list ' + r.status); }
      return r.text();
    },
    async listar(colecao) {
      const lista = [];
      let pagina = '';
      for (let i = 0; i < 20; i++) {
        const r = await fetch(base + colecao + '?pageSize=100' + (pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''), { headers: cab });
        if (!r.ok) { recusou(r); throw new Error('Firestore list ' + r.status); }
        const j = await r.json();
        (j.documents || []).forEach((d) => { const x = deFirestore(d.fields || {}); x._id = String(d.name || '').split('/').pop(); lista.push(x); });
        if (!j.nextPageToken) break;
        pagina = j.nextPageToken;
      }
      return lista;
    },
    /* lojas de um dono (so os nomes): a consulta custa 1 leitura por loja achada */
    async lojasDoDono(email) {
      const q = { structuredQuery: { from: [{ collectionId: 'lojas' }], where: { fieldFilter: { field: { fieldPath: 'donoEmail' }, op: 'EQUAL', value: { stringValue: email } } }, select: { fields: [{ fieldPath: '__name__' }] }, limit: 20 } };
      const r = await fetch(base.replace(/\/$/, '') + ':runQuery', { method: 'POST', headers: cab, body: JSON.stringify(q) });
      if (!r.ok) { recusou(r); throw new Error('Firestore consulta ' + r.status); }
      const linhas = await r.json();
      return (Array.isArray(linhas) ? linhas : []).filter((l) => l.document).map((l) => l.document.name.split('/').pop());
    },
    async merge(caminho, dados) {
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + seguro(caminho) + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (!r.ok) { recusou(r); throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
    },
    /* grava so se o documento ja existe (nunca cria pedido fantasma); devolve false se nao existe */
    async mergeSeExiste(caminho, dados) {
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + seguro(caminho) + '?' + mask + '&currentDocument.exists=true', { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (r.status === 404) return false;
      if (!r.ok) { recusou(r); throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
      return true;
    },
    /* varios documentos num lote so (tudo ou nada), cada um com a sua trava: exists=false (nasce agora) ou a hora da
       ultima mudanca (ninguem mexeu desde a leitura). Devolve false se alguma trava falhou (quem chama tenta de novo) */
    async gravarJuntos(escritas) {
      const nomeBase = 'projects/' + sa.project_id + '/databases/(default)/documents/';
      const writes = escritas.map((e) => {
        const x = { update: { name: nomeBase + seguro(e.caminho), fields: camposFirestore(e.dados) } };
        if (e.trava && e.trava.exists === false) x.currentDocument = { exists: false };
        else if (e.trava && e.trava.updateTime) x.currentDocument = { updateTime: e.trava.updateTime };
        return x;
      });
      const r = await fetch(base.replace(/\/$/, '') + ':commit', { method: 'POST', headers: cab, body: JSON.stringify({ writes: writes }) });
      if (r.status === 400 || r.status === 409 || r.status === 412 || r.status === 404) return false;
      if (!r.ok) { recusou(r); throw new Error('Firestore commit ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
      return true;
    },
    /* grava so se o documento nao mudou desde a leitura (hora da ultima mudanca igual): a trava do "cobrando agora" */
    async mergeSeIgual(caminho, dados, atualizadoEm) {
      if (!atualizadoEm) return false;
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + seguro(caminho) + '?' + mask + '&currentDocument.updateTime=' + encodeURIComponent(atualizadoEm), { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (r.status === 400 || r.status === 409 || r.status === 412 || r.status === 404) return false;
      if (!r.ok) { recusou(r); throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
      /* devolve a hora nova do documento: a proxima gravacao trava nela (ninguem mexeu desde esta) */
      const doc = await r.json().catch(() => ({}));
      return (doc && doc.updateTime) || true;
    },
  };
}
/* documento = mapa de campos tipados (sem o envelope mapValue no topo) */
function camposFirestore(obj) { const f = {}; Object.keys(obj || {}).forEach((k) => { f[k] = paraFirestore(obj[k]); }); return f; }
function paraFirestore(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFirestore) } };
  if (typeof v === 'object') { const fields = {}; Object.keys(v).forEach((k) => { fields[k] = paraFirestore(v[k]); }); return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}
function deFirestore(fields) { const o = {}; Object.keys(fields || {}).forEach((k) => { o[k] = valorDe(fields[k]); }); return o; }
function valorDe(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorDe);
  if ('mapValue' in v) return deFirestore(v.mapValue.fields || {});
  return null;
}
async function tokenDaContaDeServico(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey('pkcs8', pemParaDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(cabecalho + '.' + corpo)));
  const jwt = cabecalho + '.' + corpo + '.' + b64url(assinatura);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('token Google ' + r.status);
  return (await r.json()).access_token;
}
function pemParaDer(pem) {
  const bin = atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function b64url(dados) {
  let bin = '';
  if (typeof dados === 'string') bin = unescape(encodeURIComponent(dados));
  else { for (let i = 0; i < dados.length; i++) bin += String.fromCharCode(dados[i]); }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

