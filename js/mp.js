/*
 * Ligeiro - Pix automatico com Mercado Pago (opcional, por loja).
 *
 * Igual ao da Dom Conizza, mas sem servidor proprio: quem faz o trabalho e o
 * painel do dono, que ja fica aberto o dia todo.
 *
 *   1. Entra um pedido no Pix -> o painel cria um pagamento Pix no Mercado
 *      Pago (POST /v1/payments) e grava o "copia e cola" deles no pedido.
 *      O site do cliente troca o codigo na hora.
 *   2. A cada 10 segundos o painel pergunta ao Mercado Pago se caiu
 *      (GET /v1/payments/{id}). Caiu -> o pedido vira "pago" sozinho.
 *
 * O navegador consegue fazer o GET direto, mas o POST o Mercado Pago bloqueia
 * (CORS). Por isso o POST passa por um proxy de 20 linhas no Cloudflare
 * Workers, gratis (ferramentas/worker-mercadopago.js). O token da loja fica
 * so com a loja (localStorage na demonstracao, documento privado na nuvem) e
 * nunca vai pro documento publico.
 *
 * O codigo Pix tambem nasce no worker na hora do pedido (ferramentas/worker-mercadopago.js,
 * rota /criar), entao nao depende do painel aberto; aqui e o reforco de quem esta com o painel ligado.
 * Na demonstracao, token "SIMULACAO" aprova sozinho em 20 segundos.
 */
(function () {
  'use strict';

  var R = window.LigeiroRegras;
  function D() { return window.LigeiroDados; }
  var API = 'https://api.mercadopago.com';
  var SEGREDO = 'mercadopago';

  function expiracaoBrasilia(minutos) {
    var alvo = new Date(Date.now() + minutos * 60 * 1000);
    var emBrasilia = new Date(alvo.getTime() - 3 * 60 * 60 * 1000);
    return emBrasilia.toISOString().replace('Z', '-03:00');
  }

  function separarNome(nomeCompleto, lojaNome) {
    var partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
    var primeiro = partes.shift() || 'Cliente';
    return { primeiro: primeiro, sobrenome: partes.join(' ') || lojaNome || 'Ligeiro' };
  }

  function lerToken(slug) {
    return D().store.lerSegredo(slug, SEGREDO).then(function (s) { return s && s.token ? String(s.token).trim() : ''; });
  }
  function guardarToken(slug, token) {
    return D().store.guardarSegredo(slug, SEGREDO, { token: String(token || '').trim(), atualizadoEm: new Date().toISOString() });
  }

  function chamar(url, opcoes, token) {
    var o = opcoes || {};
    return fetch(url, {
      method: o.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, o.method === 'POST' ? { 'Content-Type': 'application/json' } : {}, o.headers || {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
    }).then(function (r) {
      return r.text().then(function (texto) {
        var dados = null;
        try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = { raw: texto }; }
        if (!r.ok) {
          var erro = new Error('Mercado Pago respondeu ' + r.status + ': ' + ((dados && (dados.message || dados.error)) || r.statusText));
          erro.status = r.status;
          throw erro;
        }
        return dados;
      });
    });
  }

  /*
   * Motor que roda dentro do painel. store e o LigeiroDados.store; aoMudar e
   * chamado com um texto de status pra mostrar no painel.
   */
  function iniciar(slug, loja, aoMudar) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var estado = { token: '', ativo: false, parado: false, pedidos: [], emAndamento: {}, relogio: null, ultimoErro: '', simulado: false };
    var store = D().store;

    function avisar(texto) { estado.status = texto; if (aoMudar) aoMudar(texto, estado); }

    lerToken(slug).then(function (token) {
      if (estado.parado) return; /* parou antes do token chegar: nao liga mais nada */
      estado.token = token;
      estado.simulado = token === 'SIMULACAO' || (D().modoDemo && !!token);
      estado.ativo = !!token && (estado.simulado || !!cfg.proxyMercadoPago);
      if (!token) return avisar('Pix automático desligado: cadastre o token do Mercado Pago em Ajustes.');
      if (!estado.ativo) return avisar('Token cadastrado, mas o Ligeiro ainda não ligou o proxy do Mercado Pago (config.proxyMercadoPago).');
      avisar(estado.simulado ? 'Pix automático em simulação: aprova sozinho em 20 s.' : 'Pix automático ligado: o pedido vira pago sozinho quando o Pix cair.');
      estado.relogio = setInterval(conferir, 10000);
      processar(estado.pedidos);
    });

    function elegivel(p) {
      /* com o mensageiro no ar, quem cria o Pix e ele (na hora do pedido); o painel so confere se caiu */
      if (cfg.proxyMercadoPago && !estado.simulado) return false;
      return p.status === R.STATUS.AGUARDANDO && p.formaPagamento === 'pix' && p.total > 0 && !p.mp && !estado.emAndamento[p.id]
        && (Date.now() - new Date(p.criadoEm).getTime()) < 60 * 60 * 1000;
    }

    function processar(lista) {
      estado.pedidos = lista || [];
      if (!estado.ativo) return;
      estado.pedidos.filter(elegivel).forEach(criar);
    }

    function criar(p) {
      estado.emAndamento[p.id] = true;
      var promessa;
      if (estado.simulado) {
        promessa = Promise.resolve({ mp: { id: 'SIM-' + p.id, criadoEm: new Date().toISOString(), simulado: true } });
      } else {
        var nome = separarNome(p.cliente && p.cliente.nome, loja.nome);
        var corpo = {
          transaction_amount: Number((p.total / 100).toFixed(2)),
          description: loja.nome + ' - Pedido ' + p.senha,
          payment_method_id: 'pix',
          external_reference: p.id,
          date_of_expiration: expiracaoBrasilia(30),
          payer: { email: 'cliente' + p.senha + '@' + (loja.slug || 'loja') + '.ligeiro.app.br', first_name: nome.primeiro, last_name: nome.sobrenome },
        };
        promessa = chamar(cfg.proxyMercadoPago, { method: 'POST', body: corpo, headers: { 'X-Idempotency-Key': p.id } }, estado.token).then(function (pg) {
          var dadosPix = (pg.point_of_interaction && pg.point_of_interaction.transaction_data) || {};
          if (!dadosPix.qr_code) throw new Error('O Mercado Pago não devolveu o código Pix. Confira se a chave Pix está cadastrada na conta Mercado Pago.');
          return { mp: { id: String(pg.id), criadoEm: new Date().toISOString() }, pixCodigo: dadosPix.qr_code, pixExpiraEm: pg.date_of_expiration || '' };
        });
      }
      promessa.then(function (mudancas) {
        return store.atualizarPedido(slug, p.id, mudancas);
      }).catch(function (e) {
        estado.ultimoErro = e.message;
        avisar('Pix automático com problema: ' + e.message + ' Confira o token em Ajustes › Pagamento.');
      }).then(function () { delete estado.emAndamento[p.id]; });
    }

    function aprovar(p) {
      return store.atualizarPedido(slug, p.id, { status: R.STATUS.PAGO, pagamentoStatus: 'pago', pagoEm: new Date().toISOString(), confirmadoPor: 'mercadopago' })
        .then(function () { if (window.LigeiroUI) { window.LigeiroUI.soar('sucesso'); window.LigeiroUI.avisar('Pix da senha ' + p.senha + ' caiu. Pedido liberado.'); } });
    }

    function conferir() {
      if (!estado.ativo) return;
      estado.pedidos.filter(function (p) { return p.status === R.STATUS.AGUARDANDO && p.mp && p.mp.id; }).forEach(function (p) {
        if (p.mp.simulado || String(p.mp.id).indexOf('SIM-') === 0) {
          if (Date.now() - new Date(p.mp.criadoEm || p.criadoEm).getTime() > 20000) aprovar(p);
          return;
        }
        chamar(API + '/v1/payments/' + encodeURIComponent(p.mp.id), {}, estado.token).then(function (pg) {
          if (pg.status === 'approved') return aprovar(p);
        }).catch(function (e) { estado.ultimoErro = e.message; });
      });
    }

    function parar() { estado.parado = true; clearInterval(estado.relogio); estado.ativo = false; }

    return { processar: processar, parar: parar, estado: estado };
  }

  window.LigeiroMP = { iniciar: iniciar, lerToken: lerToken, guardarToken: guardarToken };
})();
