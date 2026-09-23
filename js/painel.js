/*
 * Ligeiro - painel do dono: fila de pedidos, cardapio, vendas, ajustes e links.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var Pix = window.LigeiroPix;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;
  var $ = UI.$;
  var dinheiro = R.dinheiro;

  function abrir(raiz, slug) {
    var estado = { loja: null, pedidos: [], conhecidos: null, aba: 'pedidos', parar: [], somLigado: UI.somLigado(), fotos: {}, fotosVersao: null, impressaoAuto: UI.lerLocal('ligeiro:impressao:' + slug) === true, impressos: {}, abertoEm: new Date().toISOString() };
    var chaveSessao = 'ligeiro:painel:' + slug;
    var vivo = true; /* vira false quando a pessoa sai da tela antes de tudo carregar */

    function logado() { try { return sessionStorage.getItem(chaveSessao) === '1'; } catch (_) { return false; } }
    function marcarLogado(v) { try { if (v) sessionStorage.setItem(chaveSessao, '1'); else sessionStorage.removeItem(chaveSessao); } catch (_) { /* ignora */ } }
    /* Recarga depois que o banco recusa a fila: no maximo uma vez por sessao (a mesma marca da cozinha).
       Sem isso, uma conta sem acesso recarrega sem fim. Sair zera a marca, e a fila de pe por 60 s tambem. */
    var chaveRecarga = 'ligeiro:recarga:' + slug;
    function podeRecarregar() {
      try {
        if (sessionStorage.getItem(chaveRecarga) === '1') return false;
        sessionStorage.setItem(chaveRecarga, '1');
        return true;
      } catch (_) { return false; }
    }
    function esquecerRecarga() { try { sessionStorage.removeItem(chaveRecarga); } catch (_) { /* ignora */ } }

    UI.abrirOficialCedo(raiz, slug);
    /* a loja chega uma vez so: a primeira foto abre o painel e as mudancas seguem pela mesma escuta */
    var lojaViva = store.lojaAoVivo ? store.lojaAoVivo(slug) : { primeira: store.obterLoja(slug), assistir: function (cb) { return store.assistirLoja(slug, cb); }, parar: function () {} };
    lojaViva.primeira.catch(function () { return { _erro: true }; }).then(function (loja) {
      if (!vivo) return;
      if (loja && loja._erro) { raiz.appendChild(UI.erroCarregar('Não deu para abrir o painel.')); return; }
      if (!loja) {
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [el('div', { class: 'icone', text: '🔍' }), el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' })]));
        return;
      }
      estado.loja = loja;
      UI.aplicarTemaOficial(raiz, slug);
      carregarFotos(loja);
      /* demonstracao: vale a marca da sessao. Na nuvem a marca nao basta (a pessoa pode ter saido da conta em outra tela). */
      if (D.modoDemo && logado()) { montarPainel(); return; }
      var jaEntrou = logado();
      var checa = store.donoLogado ? store.donoLogado(loja) : Promise.resolve(false);
      if (jaEntrou && store.usuarioAtual) checa = store.usuarioAtual().then(function (u) { return !!u; });
      checa.then(function (ok) {
        if (!vivo) return;
        if (ok) { marcarLogado(true); montarPainel(); } else telaLogin();
      }).catch(function () { if (vivo) telaLogin(); });
    });

    /* Fotos (produtos e capa): baixa uma vez e so de novo quando alguma mudar. */
    function carregarFotos(loja) {
      var versao = loja.fotosVersao || '';
      if (estado.fotosVersao === versao) return Promise.resolve(false);
      return store.listarFotos(slug, versao, loja).then(function (mapa) {
        estado.fotos = mapa || {};
        estado.fotosVersao = versao;
        /* produto apontando pra foto que nao existe mais (a troca parou no meio): volta pro emoji. Sem isso o site acharia
           o pacote incompleto e leria foto por foto a cada visita */
        var leuTudo = !store.leuTodasAsFotos || store.leuTodasAsFotos(slug);
        var soltas = leuTudo ? (loja.produtos || []).filter(function (p) { return p && p.foto && !estado.fotos[p.foto]; }) : [];
        if (soltas.length) {
          var limpos = (loja.produtos || []).map(function (p) { return p && p.foto && !estado.fotos[p.foto] ? Object.assign({}, p, { foto: '' }) : p; });
          salvarLoja({ produtos: limpos }).catch(function () { /* tenta de novo na proxima vez */ });
          loja = Object.assign({}, loja, { produtos: limpos });
        }
        /* 5 fotos ou mais: junta as miniaturas em pacotes (cliente novo le 4 documentos em vez de 1 por foto) */
        if (store.precisaEmpacotar && store.precisaEmpacotar(slug, loja, estado.fotos)) store.empacotarFotos(slug, estado.fotos).catch(function () { /* fica foto por foto */ });
        return true;
      }).catch(function () { estado.fotosVersao = versao; return false; });
    }

    /* ---------------------------------------------------------- login */
    function telaLogin() {
      UI.limpar(raiz);
      var cfgL = window.LIGEIRO_CONFIG || {};
      if (!D.modoDemo && !estado.loja.donoEmail) {
        /* loja cadastrada sem e-mail do dono: nao tem como entrar; nada de "senha errada" */
        raiz.appendChild(el('div', { class: 'login' }, [
          el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
          el('h2', { class: 'centro', text: 'Painel · ' + estado.loja.nome }),
          el('p', { class: 'centro muted', text: 'Esta loja ainda não tem login. O Ligeiro liga o painel para você em minutos.' }),
          cfgL.whatsappLigeiro ? el('a', { class: 'btn btn-whats btn-largo', href: R.linkWhatsapp(cfgL.whatsappLigeiro, 'Oi! Quero ligar o painel da ' + estado.loja.nome + '.'), target: '_blank', rel: 'noopener', text: '💬 Chamar o Ligeiro' }) : null,
          el('button', { class: 'btn btn-fantasma btn-largo', text: 'Ver a loja como cliente', onclick: function () { window.LigeiroApp.ir(estado.loja.cidadeSlug + '/' + slug); } }),
        ]));
        return;
      }
      var campo = el('input', { type: 'password', inputmode: 'numeric', placeholder: '••••', autocomplete: 'current-password', 'aria-label': 'Senha do painel' });
      var erro = el('div', { class: 'msg-erro', hidden: true });
      var caixa = el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: 'Painel · ' + estado.loja.nome }),
        el('p', { class: 'centro muted', text: D.modoDemo && estado.loja.senhaPainel === '1234' ? 'Digite a senha do painel. Na demonstração é 1234.' : 'Digite a senha do painel.' }),
        el('div', { class: 'campo' }, campo),
        erro,
        el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar }),
        el('button', { class: 'btn btn-fantasma btn-largo', text: 'Ver a loja como cliente', onclick: function () { window.LigeiroApp.ir(estado.loja.cidadeSlug + '/' + slug); } }),
      ]);
      function entrar() {
        store.entrarPainel(slug, campo.value).then(function (ok) {
          if (!vivo) return; /* saiu da tela enquanto o login respondia */
          if (!ok) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Senha errada. Tente de novo.'; campo.value = ''; campo.focus(); return; }
          marcarLogado(true);
          montarPainel();
        }, function (e) {
          /* ex.: dono com e-mail ainda nao conferido (o aviso diz o que fazer) */
          if (!vivo) return;
          UI.soar('erro'); erro.hidden = false; erro.textContent = e && e.message ? e.message : 'Não deu para entrar agora. Tente de novo.';
        });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(caixa);
      setTimeout(function () { campo.focus(); }, 50);
    }

    function sairDoPainel() { pararTudo(); marcarLogado(false); esquecerRecarga(); if (store.sair) store.sair(); telaLogin(); }

    /* O banco recusou a fila de novo logo depois da recarga: esta conta nao tem acesso (sem laco de recarga). */
    function telaSemAcesso() {
      pararTudo();
      marcarLogado(false);
      UI.limpar(raiz);
      raiz.appendChild(el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: 'Painel · ' + estado.loja.nome }),
        el('p', { class: 'centro muted', text: 'Esta conta não tem acesso a esta loja. Se entrou com a senha da equipe, peça para o dono salvar essa senha de novo em Minha loja.' }),
        el('button', { class: 'btn btn-principal btn-largo', text: 'Sair', onclick: sairDoPainel }),
      ]));
    }

    /* ---------------------------------------------------------- painel */
    function montarPainel() {
      UI.limpar(raiz);
      /* voltou do "Conectar com Mercado Pago" */
      var mpVolta = (location.hash.match(/\/mp-(ok|erro)(?:\?(.*))?$/) || [])[1];
      if (mpVolta) {
        history.replaceState(null, '', '#/painel/' + slug);
        estado.aba = 'ajustes';
        setTimeout(function () {
          if (mpVolta === 'ok') { UI.soar('sucesso'); UI.avisar('Mercado Pago conectado! Pix automático ligado.'); }
          else UI.avisar('O Mercado Pago não autorizou. Tente de novo ou cole o token.');
        }, 400);
      }
      /* loja oficial com tema (Dom Conizza): o topo usa as cores do tema; as outras, as do Ligeiro */
      var topoComTema = !!(UI.lojaOficial(slug) && UI.lojaOficial(slug).tema);
      /* rotulo do botao do topo: icone e nome; no celular vale o nome curto (os quatro botoes ficam identicos numa linha) */
      /* icones de traco do mesmo desenho (os emojis variavam de estilo e o bonequinho cinza destoava) */
      var ICONES_TOPO = {
        loja: '<path d="M4 10v10h16V10"/><path d="M2.5 10 5 4h14l2.5 6z"/><path d="M10 20v-5h4v5"/>',
        conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
        sino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
        semsino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>',
        impressora: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
        sair: '<path d="M10 4H5.5v16H10"/><path d="M14.5 8 18.5 12l-4 4"/><path d="M18.5 12H9"/>',
      };
      function rotuloTopo(botao, icone, longo, curto) {
        UI.limpar(botao);
        botao.appendChild(el('span', { class: 'topo-ico', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + ICONES_TOPO[icone] + '</svg>' }));
        botao.appendChild(el('span', { class: 'rot-longo', text: longo }));
        botao.appendChild(el('span', { class: 'rot-curto', text: curto }));
        return botao;
      }
      function pintarSom() { rotuloTopo(btnSom, estado.somLigado ? 'sino' : 'semsino', estado.somLigado ? 'Apito ligado' : 'Apito desligado', 'Apito'); btnSom.setAttribute('aria-label', estado.somLigado ? 'Apito ligado' : 'Apito desligado'); }
      var btnSom = el('button', { class: 'btn btn-pequeno' + (estado.somLigado ? ' on' : ''), onclick: function () {
        estado.somLigado = UI.somLigado(!estado.somLigado);
        pintarSom();
        btnSom.classList.toggle('on', estado.somLigado);
        if (estado.somLigado) UI.soar('apito');
      } });
      pintarSom();
      /* Impressao automatica: cada pedido novo (pago ou pra cobrar na entrega) sai na impressora sozinho.
         No computador do caixa, abra o Chrome com --kiosk-printing pra nao aparecer a janela de imprimir. */
      function pintarImp() {
        rotuloTopo(btnImp, 'impressora', estado.impressaoAuto ? 'Imprime sozinho' : 'Impressão manual', estado.impressaoAuto ? 'Automático' : 'Manual');
      }
      var btnImp = el('button', { class: 'btn btn-pequeno' + (estado.impressaoAuto ? ' on' : ''), title: 'Imprimir cada pedido novo sozinho', onclick: function () {
        estado.impressaoAuto = !estado.impressaoAuto;
        if (estado.impressaoAuto) (estado.pedidos || []).forEach(function (p) { estado.impressos[p.id] = true; });
        UI.guardarLocal('ligeiro:impressao:' + slug, estado.impressaoAuto);
        pintarImp();
        btnImp.classList.toggle('on', estado.impressaoAuto);
        UI.avisar(estado.impressaoAuto ? 'Cada pedido novo vai sair na impressora deste aparelho.' : 'Impressão só pelo botão 🖨️ do pedido.');
      } });
      pintarImp();
      /* No celular nao existe impressao silenciosa: o botao so aparece em tela grande (computador do caixa). */
      if (navigator.maxTouchPoints > 0 && window.innerWidth < 900) btnImp.hidden = true;
      raiz.appendChild(el('header', { class: 'painel-topo topo-app' + (topoComTema ? '' : ' topo-ligeiro') }, [
        (UI.lojaOficial(slug) && UI.lojaOficial(slug).logo) ? el('img', { class: 'logo-mini', src: UI.lojaOficial(slug).logo, alt: '' }) : null,
        el('div', { class: 'nome', text: estado.loja.nome }),
        el('div', { class: 'painel-topo-acoes' }, [
          rotuloTopo(el('a', { class: 'btn btn-pequeno', href: '#/' + estado.loja.cidadeSlug + '/' + slug, target: '_blank', rel: 'noopener', title: 'Abre a loja em outra aba, do jeito que o cliente vê' }), 'loja', 'Ver loja', 'Loja'),
          rotuloTopo(el('a', { class: 'btn btn-pequeno', href: '#/conta', title: 'Suas lojas e sua assinatura' }), 'conta', 'Minha conta', 'Conta'),
          btnImp, btnSom,
          rotuloTopo(el('button', { class: 'btn btn-pequeno', onclick: sairDoPainel }), 'sair', 'Sair', 'Sair'),
        ]),
      ]));

      /* as abas grudam logo abaixo do topo, seja qual for a altura dele (tema, celular com duas linhas) */
      var topoEl = raiz.querySelector('.painel-topo');
      var medirTopo = function () { if (topoEl) raiz.style.setProperty('--altura-painel-topo', topoEl.offsetHeight + 'px'); };
      medirTopo();
      if (window.ResizeObserver && topoEl) new ResizeObserver(medirTopo).observe(topoEl);
      setTimeout(medirTopo, 600);

      var abas = el('nav', { class: 'abas-painel' });
      var defs = [['pedidos', '📋 Pedidos'], ['cardapio', R.catalogo(estado.loja).icone + ' ' + R.catalogo(estado.loja).Nome], ['vendas', '📊 Vendas'], ['ajustes', '⚙️ Ajustes'], ['links', '🏪 Minha loja']];
      defs.forEach(function (d) {
        var b = el('button', { class: 'aba-painel' + (estado.aba === d[0] ? ' ativa' : ''), dataset: { aba: d[0] }, text: d[1], onclick: function () { trocarAba(d[0]); } });
        if (d[0] === 'pedidos') b.appendChild(el('span', { class: 'badge', id: 'badgePedidos', hidden: true }));
        abas.appendChild(b);
      });
      raiz.appendChild(abas);
      raiz.appendChild(el('section', { class: 'secao', id: 'secaoPainel' }));

      pararTudo();
      estado.parar.push(lojaViva.assistir(function (loja) {
        if (!loja) return;
        var mpMudou = !!estado.loja && !!loja.mpAtivo !== !!estado.loja.mpAtivo;
        estado.loja = loja;
        if (mpMudou) ligarMP();
        if (estado.aba === 'pedidos') desenharCabecaPedidos();
        if (estado.aba === 'cardapio') desenharCardapio(true);
        carregarFotos(loja).then(function (mudou) { if (mudou && estado.aba === 'cardapio') desenharCardapio(true); });
      }));
      /* fila de pe 60 s sem o banco recusar: zera a marca da recarga (o primeiro retorno pode vir do cache, antes da recusa) */
      var zerarRecarga = setTimeout(esquecerRecarga, 60000);
      var pararZerar = function () { clearTimeout(zerarRecarga); };
      estado.parar.push(pararZerar);
      /* fila do dia de operacao (desde as 5h; de madrugada, desde as 5h de ontem): o inicio nao muda a cada abertura,
         entao reabrir em menos de 30 min so paga o que mudou */
      var inicio = new Date(); if (inicio.getHours() < 5) inicio.setDate(inicio.getDate() - 1);
      inicio.setHours(5, 0, 0, 0);
      var desde = inicio.toISOString();
      estado.parar.push(store.assistirPedidos(slug, function (lista) {
        var novos = [];
        if (estado.conhecidos) {
          lista.forEach(function (p) { if (!estado.conhecidos[p.id] && R.EM_ANDAMENTO.indexOf(p.status) >= 0 && p.status !== R.STATUS.PRODUCAO && p.status !== R.STATUS.PRONTO) novos.push(p.id); });
        }
        /* o que mudou desde a ultima vez: Pix que caiu e pedido que o cliente cancelou ganham som proprio */
        if (estado.statusAntes) {
          lista.forEach(function (p) {
            var antes = estado.statusAntes[p.id];
            if (!antes || antes === p.status) return;
            if (p.status === R.STATUS.PAGO && (antes === R.STATUS.AGUARDANDO || antes === R.STATUS.CANCELADO) && p.formaPagamento === 'pix') {
              UI.soar('pago'); UI.vibrar([80, 40, 160]);
              UI.avisar(p.pagoAposCancelar ? 'Pix da senha ' + p.senha + ' caiu depois do cancelamento. Confira com o cliente.' : 'Pix da senha ' + p.senha + ' caiu! Pode começar.');
            } else if (p.status === R.STATUS.CANCELADO && p.canceladoPor === 'cliente') {
              UI.soar('cancelado');
              UI.avisar('O cliente cancelou o pedido da senha ' + p.senha + '.');
            }
          });
        }
        estado.statusAntes = {};
        lista.forEach(function (p) { estado.statusAntes[p.id] = p.status; });
        estado.conhecidos = estado.conhecidos || {};
        lista.forEach(function (p) { estado.conhecidos[p.id] = true; });
        estado.pedidos = lista;
        conferirPixVencidos(lista);
        estado.novos = novos;
        if (novos.length) { UI.soar('apito'); UI.vibrar([200, 100, 200]); UI.avisar(novos.length === 1 ? 'Pedido novo!' : novos.length + ' pedidos novos!'); }
        imprimirNovosSozinho(lista);
        if (estado.mp) estado.mp.processar(lista);
        atualizarBadge();
        if (estado.aba === 'pedidos') desenharPedidos();
      }, { desde: desde, aoErro: function () {
        /* o banco recusou a fila: a conta saiu (ou caiu). Volta pro login em vez de ficar mostrando "nenhum pedido".
           Recarrega uma vez so; se recusar de novo, mostra que a conta nao tem acesso */
        pararZerar();
        marcarLogado(false);
        if (!podeRecarregar()) { telaSemAcesso(); return; }
        UI.avisar('Sua sessão caiu. Entre de novo.');
        /* token novo antes de recarregar: pega e-mail recem conferido ou permissao nova */
        var token = store.obterIdToken ? store.obterIdToken(true) : Promise.resolve();
        token.catch(function () { /* sem conta: a recarga pede a senha */ }).then(function () { setTimeout(function () { location.reload(); }, 1200); });
      } }));

      /* Pix automatico (Mercado Pago), se a loja ligou */
      ligarMP();
      /* assinatura da conta do dono (o cartao redesenha quando chegar) */
      carregarConta().then(function () { if (estado.aba === 'pedidos') desenharCabecaPedidos(); });

      /* "ha 3 min" precisa andar mesmo sem pedido novo */
      var relogio = setInterval(function () {
        if (estado.aba === 'pedidos') desenharPedidos();
        /* horario automatico: o cartao da loja passa de aberta para fechada (e volta) sozinho, sem ninguem mexer */
        raiz.querySelectorAll('.status-loja').forEach(function (n) {
          var novo = interruptorLoja();
          if (n.dataset.situacao !== novo.dataset.situacao) n.replaceWith(novo);
        });
        conferirPixVencidos(estado.pedidos || []); /* Pix vence mesmo sem mudar nada na fila */
        /* pedido pago parado em "Novos" ha mais de 5 minutos: lembrete suave, no maximo a cada 2 minutos */
        var parados = (estado.pedidos || []).filter(function (p) { return p.status === R.STATUS.PAGO && Date.now() - new Date(p.pagoEm || p.criadoEm).getTime() > 5 * 60 * 1000; });
        if (parados.length && Date.now() - (estado.ultimoLembrete || 0) > 2 * 60 * 1000) {
          estado.ultimoLembrete = Date.now();
          UI.soar('lembrete');
          UI.avisar(parados.length === 1 ? 'A senha ' + parados[0].senha + ' está esperando para começar.' : parados.length + ' pedidos esperando para começar.');
        }
      }, 60000);
      estado.parar.push(function () { clearInterval(relogio); });

      trocarAba(estado.aba);
    }

    /* Pix vencido que ficou pra tras (cliente fechou a aba): sai da fila sozinho.
       O relogio deste aparelho so diz quando perguntar; quem decide e o mensageiro, pelo relogio dele. */
    function conferirPixVencidos(lista) {
      estado.vencendo = estado.vencendo || {};
      lista.forEach(function (p) {
        var marca = estado.vencendo[p.id];
        if (!R.pixVencido(p) || marca === true || (marca && Date.now() < marca)) return;
        estado.vencendo[p.id] = true;
        pixVenceuMesmo(p).then(function (venceu) {
          if (!vivo) return;
          /* ainda nao venceu (ou sem resposta): pergunta de novo daqui a 2 minutos */
          if (!venceu) { estado.vencendo[p.id] = Date.now() + 2 * 60 * 1000; return; }
          /* transacao: so cancela se o pedido ainda espera o Pix (o pagamento pode ter caido agora) */
          return store.cancelarPixVencido(slug, p.id);
        }).catch(function () { /* tenta na proxima */ estado.vencendo[p.id] = false; });
      });
    }
    /* Pergunta ao mensageiro (/status). O novo responde "vencido"; o antigo nao, e ai vale o relogio daqui, como antes. */
    function pixVenceuMesmo(p) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || !cfg.proxyMercadoPago) return Promise.resolve(true);
      return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/status?loja=' + encodeURIComponent(slug) + '&pedido=' + encodeURIComponent(p.id))
        .then(function (r) { return r.json().then(function (j) { return r.ok && j && typeof j === 'object' ? j : null; }); })
        .catch(function () { return null; })
        .then(function (resp) {
          if (!resp || resp.status === 'pago') return false; /* sem resposta nao cancela as cegas; pago: o pedido muda sozinho */
          if ('vencido' in resp) return resp.vencido === true;
          return true;
        });
    }

    function pararTudo() {
      if (estado.mp) { estado.mp.parar(); estado.mp = null; }
      estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
      estado.parar = [];
    }

    function trocarAba(aba) {
      estado.aba = aba;
      raiz.querySelectorAll('.aba-painel').forEach(function (b) { b.classList.toggle('ativa', b.dataset.aba === aba); });
      var s = $('secaoPainel');
      UI.limpar(s);
      if (aba === 'pedidos') { desenharCabecaPedidos(); desenharPedidos(); }
      else if (aba === 'cardapio') desenharCardapio();
      else if (aba === 'vendas') desenharVendas();
      else if (aba === 'ajustes') desenharAjustes();
      else if (aba === 'links') desenharLinks();
      window.scrollTo(0, 0);
    }

    function atualizarBadge() {
      var b = $('badgePedidos');
      if (!b) return;
      var n = estado.pedidos.filter(function (p) { return p.status === R.STATUS.AGUARDANDO || p.status === R.STATUS.PAGO; }).length;
      b.hidden = n === 0;
      b.textContent = n;
    }

    /* ---------------------------------------------------------- pedidos */
    /* O que o cliente ve agora: aberta (recebendo pedidos), fechada na chave, ou fechada pelo horario cadastrado
       (a chave ligada, mas fora da faixa: abre sozinha na proxima). */
    /* frases curtas de proposito: uma linha so ate no celular de 320 px (a coluna do texto tem 160 px), em qualquer fonte */
    function situacaoDaLoja(l) {
      if (l.aberta === false) return { classe: 'fechada', titulo: 'Loja fechada', sub: 'Não recebe pedidos' };
      if (l.usarHorarios && l.horarios && !R.dentroDoHorario(l.horarios)) {
        var abre = R.proximaAbertura(l);
        return { classe: 'horario', titulo: 'Fora do horário', sub: abre ? 'Abre sozinha às ' + abre : 'Hoje não abre mais' };
      }
      var fecha = R.fechamentoDeHoje(l);
      return { classe: 'aberta', titulo: 'Loja aberta', sub: fecha ? 'Fecha sozinha às ' + fecha : 'Recebendo pedidos' };
    }

    function interruptorLoja() {
      var l = estado.loja;
      var aberta = l.aberta !== false;
      var chave = el('button', { class: 'chave' + (aberta ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': aberta ? 'true' : 'false', 'aria-label': 'Receber pedidos' });
      chave.addEventListener('click', function () {
        var nova = !(estado.loja.aberta !== false);
        var trocar = function () { salvarLoja({ aberta: nova }, nova ? 'Loja aberta para pedidos' : 'Loja fechada: pedidos novos pararam de entrar').catch(function () { /* ja avisou */ }); };
        if (nova) { trocar(); return; }
        /* fechar = parar de receber pedido NOVO. O que ja entrou continua aqui ate concluir (Pix vencido nao conta:
           ele sai da fila sozinho) */
        var andando = estado.pedidos.filter(function (p) {
          return [R.STATUS.PAGO, R.STATUS.PRODUCAO, R.STATUS.PRONTO].indexOf(p.status) >= 0 || (p.status === R.STATUS.AGUARDANDO && !R.pixVencido(p));
        });
        if (!andando.length) { trocar(); return; }
        var pix = andando.filter(function (p) { return p.status === R.STATUS.AGUARDANDO; }).length;
        var texto = 'Pedidos novos param de entrar. ' +
          (andando.length === 1 ? 'O pedido que já entrou continua aqui até você concluir.' : 'Os ' + andando.length + ' pedidos que já entraram continuam aqui até você concluir.') +
          (pix === 1 ? ' Um deles ainda espera o Pix: se o cliente pagar, ele entra normalmente.' : pix > 1 ? ' ' + pix + ' deles ainda esperam o Pix: se o cliente pagar, eles entram normalmente.' : '');
        UI.perguntar(texto, { titulo: 'Fechar a loja?', sim: 'Fechar', nao: 'Voltar' }).then(function (sim) { if (sim) trocar(); });
      });
      /* cartao na cor do estado, bolinha "ao vivo" quando esta recebendo pedidos */
      var s = situacaoDaLoja(l);
      var cartao = el('div', { class: 'interruptor status-loja ' + s.classe, role: 'status' }, [
        el('span', { class: 'status-ponto', 'aria-hidden': 'true' }),
        el('b', { class: 'status-titulo', text: s.titulo }),
        el('small', { class: 'status-sub', text: s.sub }),
        chave,
      ]);
      cartao.dataset.situacao = s.classe + '|' + s.sub; /* o relogio de 60 s so redesenha se isto mudar */
      return cartao;
    }

    function desenharCabecaPedidos() {
      var s = $('secaoPainel');
      if (!s) return;
      var antigo = $('cabecaPedidos');
      var avisoMP = estado.loja.mpAtivo && estado.mpStatus ? el('p', { class: 'aviso', style: { fontSize: '14px' }, text: '⚡ ' + estado.mpStatus }) : null;
      var cabeca = el('div', { id: 'cabecaPedidos', class: 'pilha' }, [cartaoAssinatura(false), primeirosPassos(), interruptorLoja(), avisoMP]);
      if (antigo) antigo.replaceWith(cabeca); else s.insertBefore(cabeca, s.firstChild);
    }

    /* ---------------------------------------------------------- assinatura */
    function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }
    /* A assinatura e da conta do dono (estado.conta); sem conta, vale o espelho na loja. */
    function fonteAssinatura() { return estado.conta && estado.conta.plano ? estado.conta : estado.loja; }
    function precoAssinatura(tipo) {
      var p = (fonteAssinatura().plano || {});
      return R.precoDoPlano(p.planoId || 'uma', tipo, fonteAssinatura());
    }
    function carregarConta() {
      if (!estado.loja.donoEmail || !store.obterConta) return Promise.resolve(null);
      return store.obterConta(estado.loja.donoEmail).then(function (c) { estado.conta = c; return c; }).catch(function () { return null; });
    }

    /*
     * Cartao "Assinatura" na aba Pedidos: so aparece quando precisa de atencao (vencendo, vencida, bloqueada ou
     * periodo gratis). Em dia, some. Mudar plano, encerrar e pagar em dia ficam em Minha conta.
     */
    function cartaoAssinatura(sempre) {
      var fonte = fonteAssinatura();
      var a = R.assinatura(fonte);
      var plano = fonte.plano || {};
      var valor = precoAssinatura(a.tipo);
      var periodo = a.tipo === 'anual' ? 'ano' : 'mês';
      var nomePlano = R.planoPorId(plano.planoId || 'uma').nome;
      var tranquila = a.estado === 'ativa' || (a.estado === 'gratis' && (a.cortesia || a.dias > 15));
      if (!sempre && tranquila) return null;
      var textos = {
        gratis: 'Seu período grátis vai até ' + dataBR(a.limite) + ' (' + a.dias + ' dias). Depois é ' + dinheiro(valor) + ' por ' + periodo + ': cartão, boleto ou Pix, aqui mesmo.',
        ativa: a.cortesia ? 'Assinatura liberada pelo Ligeiro.' : 'Assinatura paga até ' + dataBR(a.limite) + '.',
        vencendo: (a.gratis ? 'Seu período grátis termina' : 'Sua assinatura vence') + ' em ' + a.dias + (a.dias === 1 ? ' dia' : ' dias') + ' (' + dataBR(a.limite) + '). Assine para loja não parar.',
        vencida: 'Assinatura vencida desde ' + dataBR(a.limite) + '. A loja segue no ar por mais ' + Math.max(0, a.tolerancia + a.dias) + ' dias.',
        bloqueada: a.gratis ? 'Os dias grátis acabaram em ' + dataBR(a.limite) + ': o site parou de aceitar pedidos. Assine e ele volta na hora.' : 'Assinatura vencida há mais de ' + a.tolerancia + ' dias: o site parou de aceitar pedidos. Pague e ele volta assim que confirmarmos.',
        pausada: 'Assinatura pausada pelo Ligeiro. Fale com a gente.',
        cancelada: 'Assinatura encerrada. Para voltar, reative em Minha conta.',
      };
      if (a.encerrando) textos.ativa = 'Assinatura encerrada por você: as lojas ficam no ar até ' + dataBR(a.limite) + '. Mudou de ideia? É só reativar.';
      var alerta = a.estado === 'vencida' || a.estado === 'bloqueada';
      var filhos = [
        el('h3', { text: (alerta ? '⚠️ ' : '') + 'Assinatura · ' + nomePlano + (a.estado === 'gratis' ? ' · período grátis' : a.estado === 'ativa' ? ' · em dia' : '') }),
        el('p', { class: 'pequeno', text: (textos[a.estado] || '') + (estado.conta ? ' Vale para todas as lojas da sua conta.' : '') }),
      ];
      if (a.estado !== 'cancelada' && a.estado !== 'pausada' && !a.cortesia) {
        /* pagamento avisado: o mesmo aviso de Minha conta (icone, titulo e uma linha), em vez de selo que virava bolha em 2 linhas */
        if (plano.avisoPagamentoEm) filhos.push(el('div', { class: 'aviso-plano aviso-espera aviso-no-cartao', role: 'note' }, [
          el('span', { class: 'aviso-plano-ico', 'aria-hidden': 'true', text: '⏳' }),
          el('span', { class: 'aviso-plano-texto' }, [el('b', { text: 'Pagamento avisado' }), el('span', { text: 'Em ' + dataBR(plano.avisoPagamentoEm) + '. Assim que confirmarmos, os dias entram na hora.' })]),
        ]));
        filhos.push(el('div', { class: 'linha-botoes acoes-assinatura' }, [
          el('button', { class: 'btn ' + (tranquila ? 'btn-fantasma' : 'btn-principal') + ' btn-pequeno', type: 'button', text: (a.gratis ? 'Assinar · ' : 'Pagar ') + dinheiro(valor), onclick: abrirPagamentoAssinatura }),
        ]));
      }
      return el('div', { class: 'cartao' + (tranquila ? '' : ' destaque'), id: 'cartaoAssinatura' }, filhos);
    }

    function abrirPagamentoAssinatura() {
      var a = R.assinatura(fonteAssinatura());
      var valor = precoAssinatura(a.tipo);
      var periodo = a.tipo === 'anual' ? '12 meses' : '30 dias';
      var plano = (fonteAssinatura().plano || {});
      function avisar() {
        var aviso = { avisoPagamentoEm: new Date().toISOString(), avisoValor: valor };
        var grava = estado.conta
          ? store.salvarConta(estado.conta.email, { plano: aviso }).then(function (c) { estado.conta = c; UI.avisar('Avisado! Assim que cair, liberamos mais ' + periodo + '.'); })
          : salvarLoja({ plano: Object.assign({}, estado.loja.plano || {}, aviso) }, 'Avisado! Assim que cair, liberamos mais ' + periodo + '.');
        return grava.then(function () { desenharCabecaPedidos(); if (estado.aba === 'ajustes') desenharAjustes(); }).catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu para avisar agora.'); });
      }
      window.LigeiroCobranca.abrir({
        valor: valor, periodo: periodo, planoId: plano.planoId || 'uma', tipo: a.tipo, fundador: R.ehPrecoFundador(fonteAssinatura()), quem: estado.loja.nome,
        txid: 'LIG' + slug.replace(/[^a-z0-9]/gi, '').slice(0, 20), descricao: 'Ligeiro ' + estado.loja.nome, avisar: avisar,
      });
    }

    /* abre a aba e, se tiver bloco, rola ate ele e acende (o dono nao precisa cacar o campo) */
    function irPara(aba, blocoId) {
      trocarAba(aba);
      if (!blocoId) return;
      var alvo = $(blocoId);
      if (!alvo) return;
      var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var topo = alvo.getBoundingClientRect().top + window.pageYOffset - 88; /* abaixo da barra fixa do painel */
      window.scrollTo({ top: Math.max(0, topo), behavior: reduzir ? 'auto' : 'smooth' });
      alvo.classList.remove('realce'); void alvo.offsetWidth; alvo.classList.add('realce');
      setTimeout(function () { alvo.classList.remove('realce'); }, 2600);
    }

    /* Loja recem-criada: o que falta pra vender, com um toque pra cada coisa. Some quando o dono manda. */
    function primeirosPassos() {
      var l = estado.loja;
      if (l.configurada !== false) return null;
      var comPreco = (l.produtos || []).filter(function (p) { return p.ativo !== false && p.preco > 0; }).length;
      /* na ordem do que mais importa para vender; cada item leva direto ao bloco certo (e acende ele) */
      var itens = [
        [!!l.mpAtivo, 'Pix automático ligado (Mercado Pago)', 'ajustes', 'aj-pagamento'],
        [comPreco > 0, comPreco > 0 ? comPreco + ' itens com preço no ' + R.catalogo(l).nome + ' (confira os valores)' : R.catalogo(l).Nome + ' com preços', 'cardapio', ''],
        [l.aceitaEntrega === false || !!l.freteGratis || Number(l.taxaEntrega) > 0, 'Frete: ' + R.descreverFrete(l).replace(/^./, function (c) { return c.toLowerCase(); }).replace(/r\$/g, 'R$'), 'ajustes', 'aj-entrega'],
        [!!l.whatsapp, 'WhatsApp da loja', 'ajustes', 'aj-dados'],
        [!!l.usarHorarios || l.aberta !== false, l.usarHorarios ? 'Horários cadastrados' : 'Loja aberta (ou horários de funcionamento)', 'ajustes', 'aj-funcionamento'],
        [!!D.logoSrc(l), 'Logo da loja', 'ajustes', 'aj-aparencia'],
        [(l.produtos || []).some(function (p) { return p.foto || p.fotoUrl; }), 'Foto nos itens que mais saem', 'cardapio', ''],
      ];
      var feitos = itens.filter(function (i) { return i[0]; }).length;
      var lista = el('div', { class: 'lista-simples' }, itens.map(function (i) {
        return el('button', { class: 'linha passo-config' + (i[0] ? ' feito' : ''), type: 'button', onclick: function () { irPara(i[2], i[3]); } }, [
          el('span', { text: (i[0] ? '✅ ' : '⬜ ') + i[1] }),
          el('b', { text: i[0] ? '' : 'Ir →' }),
        ]);
      }));
      return el('div', { class: 'cartao destaque' }, [
        el('h3', { text: 'Primeiros passos · ' + feitos + ' de ' + itens.length }),
        el('p', { class: 'muted pequeno', text: 'Com o Pix ligado e os preços conferidos você já vende. O resto deixa a loja mais bonita.' }),
        lista,
        el('div', { class: 'linha-botoes', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '🔗 Pegar meu link', onclick: function () { trocarAba('links'); window.scrollTo(0, 0); } }),
          el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Pronto, esconder', onclick: function () { salvarLoja({ configurada: true }, 'Boa! Agora é vender.').then(desenharCabecaPedidos).catch(function () { /* ja avisou */ }); } }),
        ]),
      ]);
    }

    function desenharPedidos() {
      var s = $('secaoPainel');
      if (!s) return;
      var antigo = $('listaPedidos');
      var caixa = el('div', { id: 'listaPedidos', class: 'pilha' });
      var hoje = R.diaLocal();
      var grupos = [
        { titulo: 'Aguardando Pix', filtro: function (p) { return p.status === R.STATUS.AGUARDANDO; } },
        { titulo: 'Novos, para começar', filtro: function (p) { return p.status === R.STATUS.PAGO; } },
        { titulo: 'Preparando', filtro: function (p) { return p.status === R.STATUS.PRODUCAO; } },
        { titulo: 'Saiu ou pronto', filtro: function (p) { return p.status === R.STATUS.PRONTO; } },
        { titulo: 'Concluídos hoje', filtro: function (p) { return p.status === R.STATUS.FINALIZADO && R.diaLocal(new Date(p.criadoEm)) === hoje; }, fechado: true },
        { titulo: 'Cancelados hoje', filtro: function (p) { return p.status === R.STATUS.CANCELADO && R.diaLocal(new Date(p.criadoEm)) === hoje; }, fechado: true },
      ];
      var algum = false;
      grupos.forEach(function (g) {
        var lista = estado.pedidos.filter(g.filtro);
        if (lista.length === 0) return;
        algum = true;
        var titulo = el('div', { class: 'fila-titulo' }, [el('span', { text: g.titulo }), el('span', { text: lista.length })]);
        caixa.appendChild(titulo);
        if (g.fechado) {
          var det = el('details');
          det.appendChild(el('summary', { text: 'Mostrar ' + lista.length, style: { cursor: 'pointer', color: '#6F7D72', fontWeight: '600', padding: '6px 0' } }));
          lista.forEach(function (p) { det.appendChild(cartaoPedido(p)); });
          caixa.appendChild(det);
        } else {
          lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
          lista.forEach(function (p) { caixa.appendChild(cartaoPedido(p)); });
        }
      });
      if (!algum) caixa.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone', text: '🧾' }), el('p', { text: 'Nenhum pedido por enquanto. Quando entrar, ele aparece aqui apitando.' })]));
      if (antigo) antigo.replaceWith(caixa); else s.appendChild(caixa);
    }

    function cartaoPedido(p) {
      var loja = estado.loja;
      var novo = estado.novos && estado.novos.indexOf(p.id) >= 0;
      var entrega = p.tipoEntrega === 'entrega';
      var card = el('div', { class: 'pedido-card' + (novo ? ' novo' : '') + (p.status === R.STATUS.AGUARDANDO && p.clientePagou ? ' atencao' : '') });

      /* ordem fixa em todo cartao: pagamento e entrega numa linha, extras (troco, cancelado) na linha de baixo */
      var selos = [], extras = [];
      if (p.status === R.STATUS.AGUARDANDO) selos.push(el('span', { class: 'selo ' + (p.clientePagou ? 'laranja' : 'cinza'), text: p.clientePagou ? 'Diz que pagou' : 'Aguardando Pix' })); /* curtos: cabem com o selo de entrega na mesma linha ate em 320 */
      else if (p.formaPagamento === 'pix') selos.push(el('span', { class: 'selo', text: p.total === 0 ? 'Cortesia' : 'Pix confirmado' }));
      else if (p.formaPagamento === 'cartao_entrega') selos.push(el('span', { class: 'selo laranja', text: 'Maquininha' })); /* onde paga ja esta no selo do lado (Entrega, Retirada, Balcao) */
      else if (p.formaPagamento === 'dinheiro_entrega') {
        selos.push(el('span', { class: 'selo laranja', text: 'Dinheiro' }));
        if (p.trocoPara > 0) extras.push(el('span', { class: 'selo laranja', text: 'Troco de ' + dinheiro(p.trocoPara - p.total) }));
      }
      selos.push(el('span', { class: 'selo cinza', text: entrega ? '🛵 Entrega' : (p.origem === 'balcao' ? '🧾 Balcão' : '🛍️ Retirada') }));
      if (p.status === R.STATUS.CANCELADO) extras.push(el('span', { class: 'selo fechado', text: 'Cancelado' + (p.canceladoPor === 'cliente' ? ' pelo cliente' : '') }));
      if (p.pagoAposCancelar) extras.push(el('span', { class: 'selo laranja', text: 'Pagou depois de cancelado' }));

      /* mesmo desenho em todo cartao: senha e "ha X" em cima, selos embaixo (antes o selo de entrega pulava de linha so em alguns) */
      card.appendChild(el('div', { class: 'cabeca' }, [
        el('span', { class: 'senha', 'aria-label': 'Senha ' + p.senha }, [el('small', { text: 'Senha' }), el('b', { text: String(p.senha) })]),
        UI.seloHorario(p.criadoEm, p.status === R.STATUS.PAGO ? (p.pagoEm || p.criadoEm) : null), /* pago esperando comecar: cor avisa o atraso */
        el('div', { class: 'cabeca-selos' }, selos),
        el('div', { class: 'cabeca-selos' }, extras), /* extras numa linha propria: a de cima fica igual em todo cartao */
      ]));
      card.appendChild(el('div', { class: 'cliente' }, [p.cliente.nome, p.cliente.telefone ? ' · ' : '', p.cliente.telefone ? el('span', { class: 'sem-quebra', text: R.formatarTelefone(p.cliente.telefone) }) : '']) /* telefone nunca parte no meio */);
      if (entrega) {
        var e = p.endereco || {};
        var end = el('div', { class: 'endereco' }, [e.rua + (e.numero ? ', ' + e.numero : '') + (e.complemento ? ' · ' + e.complemento : '') + ' · ' + e.bairro]);
        if (e.referencia) end.appendChild(el('div', {}, [el('b', { text: 'Referência: ' + e.referencia })]));
        card.appendChild(end);
      }
      var itens = el('div', { class: 'itens' });
      p.itens.forEach(function (it) {
        var partes = [it.quantidade + 'x ' + it.nome];
        if (it.tamanho && it.tamanho.nome) partes.push(it.tamanho.nome);
        if (it.adicionais && it.adicionais.length) partes.push('com ' + it.adicionais.map(function (a) { return a.nome; }).join(', '));
        var linha = el('div', {}, [el('b', { text: partes[0] }), partes.length > 1 ? ' · ' + partes.slice(1).join(' · ') : '']);
        if (it.removidos && it.removidos.length) linha.appendChild(el('span', { class: 'sem', text: ' · SEM ' + it.removidos.join(', ') }));
        if (it.observacao) linha.appendChild(el('span', { text: ' · obs: ' + it.observacao }));
        itens.appendChild(linha);
      });
      card.appendChild(itens);
      if (p.observacao) card.appendChild(el('div', { class: 'obs', text: '📝 ' + p.observacao }));
      var conferencia = R.conferirTotal(loja, p);
      if (!conferencia.ok) card.appendChild(el('div', { class: 'divergente', text: 'Atenção: pelo ' + R.catalogo(estado.loja).nome + ' de hoje este pedido daria ' + dinheiro(conferencia.esperado) + ', mas veio com ' + dinheiro(p.total) + '. Confira antes de fazer.' }));
      card.appendChild(el('div', { class: 'total' }, [
        el('span', { text: 'Total ' + dinheiro(p.total) }),
        el('span', { class: 'forma', text: (p.desconto > 0 ? 'cupom ' + p.cupom + ' · ' : '') + (p.taxaEntrega > 0 ? 'entrega ' + dinheiro(p.taxaEntrega) : (p.tipoEntrega === 'entrega' ? 'entrega grátis' : 'retirada')) }),
      ]));

      var acoes = el('div', { class: 'acoes acoes-pedido' });
      var proximo = R.proximoStatus(p);
      if (proximo) {
        acoes.appendChild(el('button', { class: 'btn btn-principal', text: R.rotuloProximoPasso(p), onclick: function () { avancar(p); } }));
      }
      if (p.cliente.telefone) {
        acoes.appendChild(el('a', { class: 'btn btn-whats btn-pequeno', href: R.linkWhatsapp(p.cliente.telefone, R.mensagemParaCliente(loja, p)), target: '_blank', rel: 'noopener', text: '💬' , title: 'Avisar o cliente no WhatsApp' }));
      }
      acoes.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', text: '🖨️', title: 'Imprimir', onclick: function () { imprimir(p); } }));
      if (p.status !== R.STATUS.FINALIZADO && p.status !== R.STATUS.CANCELADO) {
        acoes.appendChild(el('button', { class: 'btn btn-erro btn-pequeno', text: 'Cancelar', onclick: function () { cancelar(p); } }));
      }
      card.appendChild(acoes);
      return card;
    }

    function avancar(p) {
      var proximo = R.proximoStatus(p);
      if (!proximo) return;
      var mudancas = { status: proximo };
      if (proximo === R.STATUS.PAGO) { mudancas.pagamentoStatus = 'pago'; mudancas.pagoEm = new Date().toISOString(); }
      store.atualizarPedido(slug, p.id, mudancas).then(function () { UI.soar('toque'); }).catch(function (e) { UI.avisar(e.message); });
    }

    function cancelar(p) {
      UI.perguntar('Cancelar o pedido de senha ' + p.senha + '? Avise o cliente pelo WhatsApp se ele já pagou.', { sim: 'Cancelar pedido', nao: 'Voltar', perigo: true }).then(function (sim) {
        if (!sim) return;
        store.atualizarPedido(slug, p.id, { status: R.STATUS.CANCELADO, canceladoPor: 'loja' }).then(function () { UI.avisar('Pedido cancelado.'); });
      });
    }

    /* Liga ou desliga o motor do Mercado Pago conforme o interruptor da loja. */
    function ligarMP() {
      if (estado.mp) { estado.mp.parar(); estado.mp = null; }
      if (!estado.loja.mpAtivo || !window.LigeiroMP) return;
      estado.mp = window.LigeiroMP.iniciar(slug, estado.loja, function (texto) { estado.mpStatus = texto; if (estado.aba === 'pedidos') desenharCabecaPedidos(); });
      estado.mp.processar(estado.pedidos || []);
    }

    function imprimir(p) {
      var ficha = $('fichaImpressao');
      ficha.textContent = R.fichaDoPedido(estado.loja, p).replace(/\*/g, '');
      window.print();
    }

    /* Imprime uma vez cada pedido que entrou pra fila depois que o painel abriu (Pix confirmado ou pra cobrar na entrega). */
    function imprimirNovosSozinho(lista) {
      if (!estado.impressaoAuto) return;
      var fila = lista.filter(function (p) {
        return !estado.impressos[p.id] && (p.pagoEm || p.criadoEm) >= estado.abertoEm && (p.status === R.STATUS.PAGO || p.status === R.STATUS.PRODUCAO);
      }).sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
      fila.forEach(function (p, i) {
        estado.impressos[p.id] = true;
        setTimeout(function () { imprimir(p); }, 400 + i * 1500);
      });
    }

    /* ---------------------------------------------------------- cardapio */
    /* Manda so o que mudou: o que outro aparelho editou enquanto isso nao e sobrescrito. */
    function salvarLoja(mudancas, aviso) {
      var nova = Object.assign({ slug: slug }, mudancas);
      delete nova.fotosVersao; /* so salvarFoto/excluirFoto mexem nisso */
      return store.salvarLoja(nova, Object.assign({}, estado.loja || {}, nova)).then(function (salva) {
        estado.loja = Object.assign({}, estado.loja, salva || nova);
        if (aviso) UI.avisar(aviso);
        return estado.loja;
      }).catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu para salvar. Tente de novo.'); throw e; });
    }

    function desenharCardapio(deAtualizacao) {
      var s = $('secaoPainel');
      if (!s || estado.aba !== 'cardapio') return;
      var foco = document.activeElement;
      if (deAtualizacao && foco && s.contains(foco) && /INPUT|TEXTAREA|SELECT/.test(foco.tagName)) {
        /* alguem esta digitando um preco: redesenha quando soltar o campo */
        foco.addEventListener('blur', function () { setTimeout(function () { desenharCardapio(true); }, 150); }, { once: true });
        return;
      }
      UI.limpar(s);
      var l = estado.loja;
      s.appendChild(interruptorLoja());

      /* categorias */
      var linhaCat = el('div', { class: 'abas-painel abas-categorias' });
      if (!estado.categoriaAtiva || !l.categorias.some(function (c) { return c.id === estado.categoriaAtiva; })) estado.categoriaAtiva = l.categorias[0] ? l.categorias[0].id : null;
      l.categorias.forEach(function (c) {
        var desligada = c.ativa === false;
        var qtd = l.produtos.filter(function (p) { return p.categoria === c.id; }).length;
        linhaCat.appendChild(el('button', { class: 'aba-painel aba-categoria' + (c.id === estado.categoriaAtiva ? ' ativa' : '') + (desligada ? ' apagada' : ''), title: desligada ? 'Categoria desligada: não aparece no site' : qtd + (qtd === 1 ? ' item' : ' itens'), onclick: function () { estado.categoriaAtiva = c.id; desenharCardapio(); } }, [
          el('span', { class: 'cat-emoji', text: emojiSeguro(c.emoji) }),
          el('span', { class: 'cat-nome', text: c.nome }),
          el('span', { class: 'badge cat-qtd', text: desligada ? 'off' : String(qtd) }),
        ]));
      });
      linhaCat.appendChild(el('button', { class: 'aba-painel aba-nova', text: '+ Categoria', onclick: editarCategoria.bind(null, null) }));
      s.appendChild(el('h2', { text: R.catalogo(estado.loja).Nome }));

      /* com muitos itens, achar pelo nome em vez de rolar categoria por categoria */
      var busca = null;
      if (l.produtos.length > 8) {
        busca = el('input', { type: 'search', class: 'busca', placeholder: '🔍 Buscar item pelo nome', 'aria-label': 'Buscar item' });
        busca.value = estado.buscaCardapio || '';
        s.appendChild(busca);
      } else estado.buscaCardapio = '';
      s.appendChild(linhaCat);
      var conteudo = el('div', { class: 'pilha', id: 'conteudoCardapio' });
      s.appendChild(conteudo);

      function desenharConteudo() {
        UI.limpar(conteudo);
        var termo = R.semAcento(String(estado.buscaCardapio || '')).toLowerCase().trim();
        if (termo) {
          var achados = l.produtos.filter(function (p) { return R.semAcento(p.nome + ' ' + (p.descricao || '')).toLowerCase().indexOf(termo) >= 0; });
          conteudo.appendChild(el('p', { class: 'muted pequeno', text: achados.length ? achados.length + (achados.length === 1 ? ' item encontrado' : ' itens encontrados') + (achados.length > 40 ? ' (mostrando 40)' : '') : 'Nenhum item com esse nome.' }));
          achados.slice(0, 40).forEach(function (p) { conteudo.appendChild(linhaProduto(p)); });
          return;
        }
        var cat = l.categorias.filter(function (c) { return c.id === estado.categoriaAtiva; })[0];
        if (!cat) {
          conteudo.appendChild(el('p', { class: 'muted', text: 'Crie a primeira categoria (ex.: Lanches) e depois os itens.' }));
          return;
        }
        if (cat.ativa === false) conteudo.appendChild(el('p', { class: 'aviso', text: 'Esta categoria está desligada: ela e os itens não aparecem no site. Ligue em "Editar categoria".' }));
        conteudo.appendChild(el('div', { class: 'linha-botoes dupla' }, [
          el('button', { class: 'btn btn-fantasma btn-pequeno', text: '✏️ Editar', title: 'Editar categoria', 'aria-label': 'Editar categoria', onclick: function () { editarCategoria(cat); } }),
          el('button', { class: 'btn btn-principal btn-pequeno', text: '+ Novo item', onclick: function () { editarProduto(null, cat.id); } }),
        ]));
        var lista = el('div', { class: 'pilha' });
        var produtos = l.produtos.filter(function (p) { return p.categoria === cat.id; });
        if (produtos.length === 0) lista.appendChild(el('p', { class: 'muted', text: 'Nenhum item nesta categoria ainda. Toque em "+ Novo item".' }));
        produtos.forEach(function (p) { lista.appendChild(linhaProduto(p)); });
        conteudo.appendChild(lista);

        /* grupos de opcoes desta categoria */
        var chaves = (l.gruposPorCategoria || {})[cat.id] || [];
        conteudo.appendChild(el('h2', { text: 'Tamanhos e adicionais de ' + cat.nome, style: { marginTop: '10px' } }));
        conteudo.appendChild(el('p', { class: 'muted pequeno', text: R.catalogo(estado.loja).comida ? 'Acabou o bacon? Desliga aqui e ele some do site na hora.' : 'Acabou um tamanho ou uma opção? Desliga aqui e some do site na hora.' }));
        chaves.forEach(function (chave) {
          var g = (l.grupos || {})[chave];
          if (g) conteudo.appendChild(blocoGrupo(chave, g, cat.id));
        });
        conteudo.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', text: '+ Novo grupo de opções', onclick: function () { editarGrupo(null, cat.id); } }));
      }
      if (busca) busca.addEventListener('input', function () { estado.buscaCardapio = busca.value; desenharConteudo(); });
      desenharConteudo();
    }

    function linhaProduto(p) {
      var preco = el('input', { class: 'preco', type: 'text', inputmode: 'numeric', value: dinheiro(p.preco), 'aria-label': 'Preço de ' + p.nome });
      UI.mascaraDinheiro(preco);
      preco.addEventListener('change', function () {
        var c = UI.centavosDoCampo(preco.value);
        if (!c) { preco.value = dinheiro(p.preco); return; }
        var produtos = estado.loja.produtos.map(function (x) { return x.id === p.id ? Object.assign({}, x, { preco: c }) : x; });
        salvarLoja({ produtos: produtos }, 'Preço de ' + p.nome + ' salvo');
      });
      var chave = el('button', { class: 'chave' + (p.ativo !== false ? ' on' : ''), 'aria-label': 'Ligar ou desligar ' + p.nome, onclick: function () {
        var produtos = estado.loja.produtos.map(function (x) { return x.id === p.id ? Object.assign({}, x, { ativo: !(x.ativo !== false) }) : x; });
        salvarLoja({ produtos: produtos }, p.ativo !== false ? p.nome + ' saiu do site' : p.nome + ' voltou para o site');
      } });
      var srcFoto = D.fotoSrc(p, estado.fotos);
      return el('div', { class: 'linha-produto item' + (p.ativo !== false ? '' : ' desligado') }, [
        srcFoto ? el('img', { class: 'miniatura-produto', src: srcFoto, alt: '' }) : el('span', { class: 'emoji', text: p.emoji || '🍽️' }),
        el('div', { class: 'nome' }, [p.nome, el('small', { text: p.descricao || '' })]),
        preco,
        el('button', { class: 'editar apagar', text: '🗑️', 'aria-label': 'Excluir ' + p.nome, title: 'Excluir', onclick: function () { excluirProduto(p); } }),
        el('button', { class: 'editar', text: '✏️', 'aria-label': 'Editar ' + p.nome, title: 'Editar', onclick: function () { editarProduto(p, p.categoria); } }),
        chave,
      ]);
    }

    function campoTexto(rotulo, valor, opcoes) {
      var o = opcoes || {};
      var input = o.area ? el('textarea', { maxlength: o.max || 300 }) : el('input', { type: o.tipo || 'text', maxlength: o.max || 120, placeholder: o.placeholder || '', inputmode: o.inputmode || null });
      input.value = valor == null ? '' : valor;
      var bloco = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [el('label', { text: rotulo }), o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null, input]);
      bloco.input = input;
      return bloco;
    }

    function campoDinheiro(rotulo, centavos, ajuda) {
      var b = campoTexto(rotulo, centavos ? dinheiro(centavos) : '', { inputmode: 'numeric', placeholder: 'R$ 0,00', ajuda: ajuda });
      UI.mascaraDinheiro(b.input);
      b.centavos = function () { return UI.centavosDoCampo(b.input.value); };
      return b;
    }

    /* Estilo do site: cantos, logo, titulos e altura da capa. Sao so variaveis de CSS, nao pesam nada. */
    function campoEstilo(rotulo, atual, aoMudar) {
      var escolhido = Object.assign({ cantos: 'arredondado', logo: 'quadrada', titulos: 'moderna', capa: 'normal' }, atual || {});
      var nomes = { cantos: 'Cantos', logo: 'Formato da logo', titulos: 'Letra dos títulos', capa: 'Altura da capa' };
      var linhas = Object.keys(UI.ESTILOS).map(function (chave) {
        var botoes = UI.ESTILOS[chave].map(function (op) {
          var b = el('button', { type: 'button', class: 'aba-painel' + (escolhido[chave] === op[0] ? ' ativa' : ''), text: op[1], dataset: { chave: chave, valor: op[0] } });
          b.addEventListener('click', function () {
            escolhido[chave] = op[0];
            linha.querySelectorAll('.aba-painel').forEach(function (x) { x.classList.toggle('ativa', x.dataset.valor === op[0]); });
            if (aoMudar) aoMudar(Object.assign({}, escolhido));
          });
          return b;
        });
        var linha = el('div', { class: 'estilo-linha' }, [el('span', { class: 'rotulo', text: nomes[chave] })].concat(botoes));
        return linha;
      });
      var bloco = el('div', { class: 'campo largo campo-estilo' }, [el('label', { text: rotulo }), el('p', { class: 'ajuda', text: 'Combina com a sua cor. Muda na prévia agora e no site quando salvar.' }), el('div', { class: 'estilos' }, linhas)]);
      bloco.valor = function () { return Object.assign({}, escolhido); };
      return bloco;
    }

    /* Frete: dois botoes, "Entrega gratis" ou "Cobro taxa". bloco.valor() -> 'gratis' | 'taxa'. */
    function campoFrete(l, aoMudar) {
      var modo = l.freteGratis ? 'gratis' : 'taxa';
      var opcoes = [['gratis', '🛵 Entrega grátis'], ['taxa', 'Cobro taxa']];
      var botoes = opcoes.map(function (op) {
        var b = el('button', { type: 'button', class: 'aba-painel' + (modo === op[0] ? ' ativa' : ''), text: op[1], dataset: { valor: op[0] } });
        b.addEventListener('click', function () {
          modo = op[0];
          linha.querySelectorAll('.aba-painel').forEach(function (x) { x.classList.toggle('ativa', x.dataset.valor === modo); });
          if (aoMudar) aoMudar(modo);
        });
        return b;
      });
      var linha = el('div', { class: 'estilo-linha' }, botoes);
      var bloco = el('div', { class: 'campo largo' }, [el('label', { text: 'Frete' }), el('p', { class: 'ajuda', text: 'Você decide. Muda para o cliente na hora que salvar. Entrega grátis aparece em destaque no site e na vitrine.' }), linha]);
      bloco.valor = function () { return modo; };
      if (aoMudar) setTimeout(function () { aoMudar(modo); }, 0);
      return bloco;
    }

    /*
     * Previa do site em formato de celular, como a capa do perfil: toca na
     * camera da capa ou da logo e escolhe a foto; cor e estilo mudam na hora.
     * Usa os campos de foto escondidos (f.logo, f.capa) pra ler e trocar a imagem.
     */
    function previaDaLoja(l, f) {
      function imgDe(campo) {
        var img = campo.querySelector('.foto-previa img');
        return img && !img.hidden && img.getAttribute('src') ? img.getAttribute('src') : null;
      }
      function botaoDe(campo, re) { return [].slice.call(campo.querySelectorAll('button')).filter(function (b) { return re.test(b.textContent); })[0]; }
      var capa = el('div', { class: 'previa-capa' });
      var logo = el('div', { class: 'previa-logo' });
      var nome = el('div', { class: 'previa-nome' });
      var tipo = el('div', { class: 'previa-tipo' });
      var botao = el('span', { class: 'btn btn-principal btn-gigante previa-botao', text: 'PEDIR AGORA' });
      var tela = el('div', { class: 'previa-site' }, [
        el('div', { class: 'previa-status' }, [el('span', { text: '9:41' }), el('span', { text: '●●● ▮' })]),
        el('div', { class: 'previa-entalhe' }),
        capa,
        el('div', { class: 'previa-corpo' }, [logo, nome, tipo, botao]),
        el('div', { class: 'previa-home' }),
      ]);
      var acoes = el('div', { class: 'previa-acoes' }, [
        el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', text: '🖼️ Trocar capa', onclick: function () { var b = botaoDe(f.capa, /Escolher|Trocar/); if (b) b.click(); } }),
        el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', text: '🙂 Trocar logo', onclick: function () { var b = botaoDe(f.logo, /Escolher|Trocar/); if (b) b.click(); } }),
      ]);
      function atualizar() {
        var srcCapa = imgDe(f.capa);
        var srcLogo = imgDe(f.logo);
        UI.limpar(capa);
        if (srcCapa) capa.appendChild(el('img', { src: srcCapa, alt: '' }));
        capa.appendChild(el('button', { type: 'button', class: 'previa-cam', 'aria-label': 'Trocar capa', text: '📷', onclick: function () { var b = botaoDe(f.capa, /Escolher|Trocar/); if (b) b.click(); } }));
        if (srcCapa) capa.appendChild(el('button', { type: 'button', class: 'previa-cam previa-tirar', 'aria-label': 'Tirar capa', text: '✕', onclick: function () { var b = botaoDe(f.capa, /Remover/); if (b) b.click(); } }));
        capa.classList.toggle('sem-capa', !srcCapa);
        UI.limpar(logo);
        logo.appendChild(srcLogo ? el('img', { src: srcLogo, alt: '' }) : el('span', { class: 'emoji', text: (f.emoji && f.emoji.input.value.trim()) || l.emoji || '🍽️' }));
        logo.appendChild(el('button', { type: 'button', class: 'previa-cam mini', 'aria-label': 'Trocar logo', text: '📷', onclick: function () { var b = botaoDe(f.logo, /Escolher|Trocar/); if (b) b.click(); } }));
        nome.textContent = f.nome.input.value.trim() || l.nome;
        tipo.textContent = R.tipoVisivel({ tipo: f.tipo.input.value.trim() || l.tipo }) + (l.cidade ? ' em ' + l.cidade : '');
        var cor = f.cor ? f.cor.valor() : l.cor;
        var estilo = f.estilo ? f.estilo.valor() : l.estilo;
        UI.aplicarTemaEm(tela, cor, estilo);
        tela.classList.toggle('capa-alta', !!(estilo && estilo.capa === 'alta'));
        tela.classList.toggle('com-capa', !!srcCapa);
      }
      /* quando a foto escondida muda (escolheu ou removeu), a previa acompanha */
      var obs = new MutationObserver(function () { atualizar(); });
      obs.observe(f.logo, { subtree: true, attributes: true, childList: true });
      obs.observe(f.capa, { subtree: true, attributes: true, childList: true });
      var bloco = el('div', { class: 'campo largo previa-bloco' }, [
        el('label', { text: 'A cara da sua loja' }),
        el('p', { class: 'ajuda', text: 'É assim que o cliente vê no celular. Toque na câmera para trocar a capa ou a logo. Cor e estilo mudam aqui embaixo.' }),
        tela,
        acoes,
      ]);
      bloco.atualizar = atualizar;
      setTimeout(atualizar, 0);
      return bloco;
    }

    /* Emojis de comida que todo celular e Windows desenham. O primeiro da lista e o padrao. */
    var EMOJIS = ['🍔', '🍕', '🌭', '🍟', '🥪', '🌮', '🍗', '🥩', '🍖', '🍱', '🍛', '🍝', '🍜', '🥗', '🍣', '🍤', '🥟', '🧀', '🥐', '🍞', '🎂', '🍰', '🍩', '🍪', '🍫', '🍦', '🍨', '🥤', '🍹', '☕', '🍺', '🍷', '🥂', '🥛', '🍇', '🍓', '🥑', '🌽', '🍿', '🍬'];
    function emojiSeguro(e) {
      var t = String(e || '').trim();
      return t || '🍔';
    }
    /* Grade de emojis: toca e escolhe. Sem digitar, sem quadradinho quebrado. bloco.valor() -> '🍕' */
    function campoEmoji(rotulo, atual, opcoes) {
      var o = opcoes || {};
      var escolhido = emojiSeguro(atual);
      var lista = EMOJIS.slice();
      if (lista.indexOf(escolhido) < 0) lista.unshift(escolhido); /* emoji antigo continua valendo */
      var grade = el('div', { class: 'grade-emoji' });
      var atualEl = el('span', { class: 'emoji-atual', text: escolhido });
      function pintar() {
        grade.querySelectorAll('button').forEach(function (b) { b.classList.toggle('marcado', b.dataset.e === escolhido); });
        atualEl.textContent = escolhido;
        if (o.aoMudar) o.aoMudar(escolhido);
      }
      lista.forEach(function (e) {
        grade.appendChild(el('button', { type: 'button', class: 'emoji-opcao', dataset: { e: e }, text: e, 'aria-label': 'Emoji ' + e, onclick: function () { escolhido = e; pintar(); } }));
      });
      pintar();
      var bloco = el('div', { class: 'campo largo campo-emoji' }, [el('label', {}, [rotulo, ' ', atualEl]), o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null, grade]);
      bloco.valor = function () { return escolhido; };
      bloco.input = { get value() { return escolhido; } }; /* compatibilidade com quem le .input.value */
      return bloco;
    }

    /* Bolinhas de cor pra loja escolher a cara do site dela. bloco.valor() -> '#RRGGBB' ou '' (padrao). */
    function campoCor(rotulo, atual, aoMudar) {
      var escolhida = UI.corValida(atual) ? atual.toUpperCase() : '';
      var lista = el('div', { class: 'paleta' });
      var previa = el('span', { class: 'btn btn-principal btn-pequeno previa-cor', text: 'PEDIR AGORA' });
      var entrada = el('input', { type: 'color', value: escolhida || '#84CC16', 'aria-label': 'Outra cor' });
      var outra = el('label', { class: 'cor outra', title: 'Outra cor' }, [entrada, el('span', { text: '+' })]);
      function pintar() {
        lista.querySelectorAll('button.cor').forEach(function (b) { b.classList.toggle('marcada', b.dataset.cor === escolhida); });
        var naPaleta = UI.PALETA.some(function (c) { return c[0] === escolhida; });
        outra.classList.toggle('marcada', !!escolhida && !naPaleta);
        if (escolhida && !naPaleta) outra.style.background = escolhida; else outra.style.background = '';
        previa.style.background = escolhida || '#84CC16';
        previa.style.color = UI.corDeTexto(escolhida || '#84CC16');
        if (aoMudar) aoMudar(escolhida);
      }
      UI.PALETA.forEach(function (c) {
        lista.appendChild(el('button', { type: 'button', class: 'cor', dataset: { cor: c[0] }, title: c[1], 'aria-label': c[1], style: { background: c[0] || '#84CC16' }, onclick: function () { escolhida = c[0]; pintar(); } }));
      });
      entrada.addEventListener('input', function () { escolhida = entrada.value.toUpperCase(); pintar(); });
      lista.appendChild(outra);
      pintar();
      var bloco = el('div', { class: 'campo largo campo-cor' }, [el('label', { text: rotulo }), el('p', { class: 'ajuda', text: 'Botões e destaques do seu site ficam nessa cor. Veja na prévia acima.' }), lista]);
      bloco.valor = function () { return escolhida; };
      return bloco;
    }

    function campoSelect(rotulo, valor, opcoes) {
      var sel = el('select', {}, opcoes.map(function (op) { var o = el('option', { value: op[0], text: op[1] }); if (op[0] === valor) o.selected = true; return o; }));
      var bloco = el('div', { class: 'campo' }, [el('label', { text: rotulo }), sel]);
      bloco.input = sel;
      return bloco;
    }

    /* Excluir um item (lixeira da linha e botao de dentro do editar). Devolve a promessa com true se excluiu. */
    function excluirProduto(p) {
      return UI.perguntar('Excluir "' + p.nome + '" do ' + R.catalogo(estado.loja).nome + '? Se for só por hoje, prefira desligar o item.', { sim: 'Excluir', perigo: true }).then(function (sim) {
        if (!sim) return false;
        if (p.foto) store.excluirFoto(slug, p.foto).catch(function () { /* ignora */ });
        return salvarLoja({ produtos: estado.loja.produtos.filter(function (x) { return x.id !== p.id; }) }, 'Item excluído').then(function () { desenharCardapio(); return true; });
      });
    }

    function editarProduto(p, categoriaId) {
      var novo = !p;
      var f = {
        nome: campoTexto('Nome', p ? p.nome : '', { max: 60, placeholder: 'Ex: X-Bacon' }),
        descricao: campoTexto('Descrição curta', p ? p.descricao : '', { max: 140, placeholder: 'O que vem, em uma linha' }),
        preco: campoDinheiro('Preço', p ? p.preco : 0),
        foto: UI.campoFoto('Foto do item', D.fotoSrc(p, estado.fotos), { lado: 640, vazio: (p && p.emoji) || '🍽️', ajuda: 'Qualquer foto do celular serve: o sistema diminui para 640 px. Prato no centro, ocupando a foto toda; quadrada ou 4:3 fica melhor.' }),
        emoji: campoEmoji('Emoji (aparece quando não tem foto)', p ? p.emoji : '🍔'),
        categoria: campoSelect('Categoria', categoriaId, estado.loja.categorias.map(function (c) { return [c.id, c.nome]; })),
        ingredientes: campoTexto('Ingredientes que o cliente pode tirar', p && p.ingredientes ? p.ingredientes.join(', ') : '', { max: 300, placeholder: 'Separe por vírgula: Cebola, Tomate, Maionese', ajuda: 'Aparece no "Tirar alguma coisa?". Deixe vazio se não tiver.' }),
      };
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [f.nome, f.preco, f.foto, f.descricao, f.categoria, f.ingredientes, f.emoji]);
      if (!novo) {
        var mesmos = estado.loja.produtos.filter(function (x) { return x.categoria === p.categoria; }).map(function (x) { return x.id; });
        var posP = mesmos.indexOf(p.id);
        if (mesmos.length > 1) {
          var subir = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '⬆ Subir na lista', onclick: function () { moverProduto(p, -1); } });
          var descer = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '⬇ Descer na lista', onclick: function () { moverProduto(p, 1); } });
          subir.disabled = posP <= 0;
          descer.disabled = posP >= mesmos.length - 1;
          corpo.appendChild(el('div', { class: 'campo' }, [el('label', { text: 'Posição na lista: ' + (posP + 1) + ' de ' + mesmos.length }), el('div', { class: 'linha-botoes' }, [subir, descer])]));
        }
      }
      var btnSalvar = el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: novo ? 'Adicionar ao ' + R.catalogo(estado.loja).nome : 'Salvar', onclick: function () {
        var nome = f.nome.input.value.trim();
        var preco = f.preco.centavos();
        if (nome.length < 2) return UI.avisar('Digite o nome do item.');
        if (!preco) return UI.avisar('Digite o preço.');
        var dados = {
          nome: nome, descricao: f.descricao.input.value.trim(), preco: preco, emoji: f.emoji.valor() || '🍔',
          categoria: f.categoria.input.value,
          ingredientes: f.ingredientes.input.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        };
        /* Foto: primeiro guarda a imagem (documento separado), depois o item aponta pra ela. */
        var foto = f.foto.valor();
        var fotoAntiga = p && p.foto;
        var passo = Promise.resolve();
        if (foto.dados) {
          var idFoto = 'f' + D.idAleatorio(10);
          passo = store.salvarFoto(slug, idFoto, foto.dados).then(function () {
            dados.foto = idFoto;
            dados.fotoUrl = '';
            if (fotoAntiga) return store.excluirFoto(slug, fotoAntiga).catch(function () { /* a antiga pode ja ter sumido */ });
          });
        } else if (foto.removida) {
          dados.foto = '';
          dados.fotoUrl = '';
          if (fotoAntiga) passo = store.excluirFoto(slug, fotoAntiga).catch(function () { /* idem */ });
        }
        btnSalvar.disabled = true;
        btnSalvar.textContent = 'Salvando…';
        passo.then(function () {
          var produtos;
          if (novo) {
            var base = R.slug(nome) || 'item';
            var id = base;
            var n = 2;
            while (estado.loja.produtos.some(function (x) { return x.id === id; })) id = base + '-' + (n++);
            produtos = estado.loja.produtos.concat([Object.assign({ id: id, ativo: true, ordem: estado.loja.produtos.length }, dados)]);
          } else {
            produtos = estado.loja.produtos.map(function (x) { return x.id === p.id ? Object.assign({}, x, dados) : x; });
          }
          return salvarLoja({ produtos: produtos }, novo ? nome + ' entrou no ' + R.catalogo(estado.loja).nome : 'Item salvo');
        }).then(function () {
          UI.fecharModal();
          estado.categoriaAtiva = dados.categoria;
          desenharCardapio();
        }).catch(function (e) {
          UI.avisar(e && e.message ? e.message : 'Não deu para salvar. Tente de novo.');
          btnSalvar.disabled = false;
          btnSalvar.textContent = novo ? 'Adicionar ao ' + R.catalogo(estado.loja).nome : 'Salvar';
        });
      } });
      var botoes = [btnSalvar];
      if (!novo) {
        botoes.unshift(el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Duplicar', onclick: function () { duplicarProduto(p); } }));
        botoes.unshift(el('button', { class: 'btn btn-erro btn-pequeno', text: 'Excluir', onclick: function () {
          excluirProduto(p).then(function (excluiu) { if (excluiu) UI.fecharModal(); else editarProduto(p, categoriaId); });
        } }));
      }
      UI.abrirModal({ titulo: novo ? 'Novo item' : p.nome, corpo: corpo, rodape: botoes });
      setTimeout(function () { f.nome.input.focus(); }, 60);
    }

    /* Sobe ou desce o item dentro da categoria dele (a ordem da lista e a ordem do site). */
    function moverProduto(p, delta) {
      var lista = estado.loja.produtos.slice();
      var indices = [];
      lista.forEach(function (x, i) { if (x.categoria === p.categoria) indices.push(i); });
      var k = indices.indexOf(lista.map(function (x) { return x.id; }).indexOf(p.id));
      var j = k + delta;
      if (k < 0 || j < 0 || j >= indices.length) return;
      var a = indices[k], b = indices[j];
      var t = lista[a]; lista[a] = lista[b]; lista[b] = t;
      salvarLoja({ produtos: lista }, 'Ordem salva').then(function () {
        UI.fecharModal();
        desenharCardapio();
        editarProduto(estado.loja.produtos.filter(function (x) { return x.id === p.id; })[0], p.categoria);
      }).catch(function () { /* ja avisou */ });
    }

    /* Copia do item logo abaixo dele, sem a foto (foto e por item), pra ajustar nome e preco. */
    function duplicarProduto(p) {
      var lista = estado.loja.produtos.slice();
      var base = (R.slug(p.nome) || 'item') + '-copia';
      var id = base;
      var k = 2;
      while (lista.some(function (x) { return x.id === id; })) id = base + '-' + (k++);
      var copia = Object.assign({}, D.clonar(p), { id: id, nome: p.nome + ' (cópia)', foto: '', ativo: false });
      var i = lista.map(function (x) { return x.id; }).indexOf(p.id);
      lista.splice(i + 1, 0, copia);
      salvarLoja({ produtos: lista }, 'Cópia criada desligada. Ajuste e ligue.').then(function () {
        UI.fecharModal();
        desenharCardapio();
        editarProduto(copia, copia.categoria);
      }).catch(function () { /* ja avisou */ });
    }

    function editarCategoria(cat) {
      var novo = !cat;
      var l = estado.loja;
      var nome = campoTexto('Nome da categoria', cat ? cat.nome : '', { max: 40, placeholder: 'Ex: Lanches' });
      var emoji = campoEmoji('Emoji da categoria', cat ? cat.emoji : '🍔');
      var ligada = novo ? null : interruptorCampo('Categoria ligada', 'Desligada, ela e todos os itens somem do site na hora e voltam quando você ligar. Bom para "Almoço" fora do horário.', cat.ativa !== false);
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [nome, emoji, ligada]);
      if (!novo) {
        var ids = l.categorias.map(function (c) { return c.id; });
        var pos = ids.indexOf(cat.id);
        var qtd = l.produtos.filter(function (p) { return p.categoria === cat.id; }).length;
        corpo.appendChild(el('p', { class: 'muted pequeno', text: qtd + (qtd === 1 ? ' item' : ' itens') + ' nesta categoria · posição ' + (pos + 1) + ' de ' + ids.length + ' no site' }));
        if (ids.length > 1) {
          var antes = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '← Mover para antes', onclick: function () { moverCategoria(cat.id, -1); } });
          var depois = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Mover para depois →', onclick: function () { moverCategoria(cat.id, 1); } });
          antes.disabled = pos === 0;
          depois.disabled = pos === ids.length - 1;
          corpo.appendChild(el('div', { class: 'linha-botoes' }, [antes, depois]));
        }
      }
      var botoes = [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: novo ? 'Criar' : 'Salvar', onclick: function () {
        var n = nome.input.value.trim();
        if (n.length < 2) return UI.avisar('Digite o nome.');
        var categorias;
        if (novo) {
          var base = R.slug(n) || 'cat';
          var id = base;
          var k = 2;
          while (estado.loja.categorias.some(function (c) { return c.id === id; })) id = base + '-' + (k++);
          categorias = estado.loja.categorias.concat([{ id: id, nome: n, emoji: emoji.valor(), ativa: true }]);
          estado.categoriaAtiva = id;
        } else {
          categorias = estado.loja.categorias.map(function (c) { return c.id === cat.id ? Object.assign({}, c, { nome: n, emoji: emoji.valor(), ativa: ligada.chave.ligado }) : c; });
        }
        /* trava o botao ate o banco responder: toque duplo com internet lenta criava duas categorias */
        var botao = this;
        botao.disabled = true; botao.textContent = 'Salvando…';
        salvarLoja({ categorias: categorias }, 'Categoria salva').then(function () { UI.fecharModal(); desenharCardapio(); })
          .catch(function () { botao.disabled = false; botao.textContent = novo ? 'Criar' : 'Salvar'; });
      } })];
      if (!novo) botoes.unshift(el('button', { class: 'btn btn-erro btn-pequeno', text: 'Excluir', onclick: function () { UI.fecharModal(); excluirCategoria(cat); } }));
      UI.abrirModal({ titulo: novo ? 'Nova categoria' : 'Categoria', corpo: corpo, rodape: botoes });
    }

    /* Troca a categoria de lugar na ordem do site e reabre a janela ja na posicao nova. */
    function moverCategoria(id, delta) {
      var lista = estado.loja.categorias.slice();
      var i = lista.map(function (c) { return c.id; }).indexOf(id);
      var j = i + delta;
      if (i < 0 || j < 0 || j >= lista.length) return;
      var t = lista[i]; lista[i] = lista[j]; lista[j] = t;
      salvarLoja({ categorias: lista }, 'Ordem salva').then(function () {
        UI.fecharModal();
        desenharCardapio();
        editarCategoria(estado.loja.categorias.filter(function (c) { return c.id === id; })[0]);
      }).catch(function () { /* ja avisou */ });
    }

    /*
     * Excluir categoria. Sem itens: so confirma. Com itens: o dono escolhe
     * mover tudo pra outra categoria ou excluir os itens junto. Os grupos de
     * opcoes que so ela usava vao embora tambem.
     */
    function excluirCategoria(cat) {
      var l = estado.loja;
      var itens = l.produtos.filter(function (p) { return p.categoria === cat.id; });
      var outras = l.categorias.filter(function (c) { return c.id !== cat.id; });
      function limparGrupos() {
        l = estado.loja; /* a loja pode ter mudado enquanto a janela estava aberta */
        var gpc = D.clonar(l.gruposPorCategoria || {});
        var minhas = gpc[cat.id] || [];
        delete gpc[cat.id];
        var usados = {};
        Object.keys(gpc).forEach(function (k) { (gpc[k] || []).forEach(function (ch) { usados[ch] = true; }); });
        var grupos = D.clonar(l.grupos || {});
        minhas.forEach(function (ch) { if (!usados[ch]) delete grupos[ch]; });
        return { gruposPorCategoria: gpc, grupos: grupos };
      }
      function concluir(mudancas, aviso) {
        Object.assign(mudancas, limparGrupos(), { categorias: estado.loja.categorias.filter(function (c) { return c.id !== cat.id; }) });
        return salvarLoja(mudancas, aviso).then(function () { UI.fecharModal(); estado.categoriaAtiva = null; desenharCardapio(); }).catch(function () { /* ja avisou */ });
      }
      var n = itens.length;
      if (!n) {
        UI.perguntar('Excluir a categoria "' + cat.nome + '"? Os grupos de opções que só ela usa vão junto.', { sim: 'Excluir', perigo: true })
          .then(function (sim) { if (sim) concluir({}, 'Categoria excluída'); else editarCategoria(cat); });
        return;
      }
      var destino = outras.length ? campoSelect('Mover os itens para', outras[0].id, outras.map(function (c) { return [c.id, (c.emoji ? c.emoji + ' ' : '') + c.nome]; })) : null;
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
        el('p', { text: '"' + cat.nome + '" tem ' + n + (n === 1 ? ' item' : ' itens') + '. O que fazer com ' + (n === 1 ? 'ele' : 'eles') + '?' }),
        destino,
        el('p', { class: 'muted pequeno', text: 'Se for só por hoje, prefira desligar a categoria em "Editar categoria": ela some do site e volta quando você quiser.' }),
      ]);
      var botoes = [];
      if (destino) botoes.push(el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Mover e excluir a categoria', onclick: function () {
        var alvo = destino.input.value;
        var produtos = estado.loja.produtos.map(function (p) { return p.categoria === cat.id ? Object.assign({}, p, { categoria: alvo }) : p; });
        estado.categoriaAtiva = alvo;
        concluir({ produtos: produtos }, n + (n === 1 ? ' item movido' : ' itens movidos') + '. Categoria excluída.').then(function () { estado.categoriaAtiva = alvo; desenharCardapio(); });
      } }));
      botoes.push(el('button', { class: 'btn btn-erro' + (destino ? ' btn-pequeno' : ''), style: { flex: '1' }, text: 'Excluir tudo', onclick: function () {
        UI.perguntar('Excluir a categoria e ' + (n === 1 ? 'o item' : 'os ' + n + ' itens') + ' de uma vez? Não dá para desfazer.', { sim: 'Excluir tudo', perigo: true }).then(function (sim) {
          if (!sim) return excluirCategoria(cat);
          estado.loja.produtos.filter(function (p) { return p.categoria === cat.id && p.foto; }).forEach(function (p) { store.excluirFoto(slug, p.foto).catch(function () { /* ignora */ }); });
          concluir({ produtos: estado.loja.produtos.filter(function (p) { return p.categoria !== cat.id; }) }, 'Categoria e itens excluídos');
        });
      } }));
      UI.abrirModal({ titulo: 'Excluir "' + cat.nome + '"', corpo: corpo, rodape: botoes });
    }

    function blocoGrupo(chave, g, categoriaId) {
      var bloco = el('div', { class: 'cartao' });
      bloco.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } }, [
        el('div', { style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' } }, [
          el('h3', { text: g.titulo }),
          el('span', { class: 'selo cinza', style: { whiteSpace: 'nowrap' }, text: g.tipo === 'unico' ? 'escolhe 1' : 'vários' + (g.max ? ', até ' + g.max : '') }),
        ]),
        el('button', { class: 'editar', style: { border: '1.5px solid #B9CBAB', background: '#fff', borderRadius: '10px', minHeight: '40px', padding: '0 10px' }, text: '✏️', onclick: function () { editarGrupo(chave, categoriaId); } }),
      ]));
      var lista = el('div', { class: 'pilha' });
      (g.opcoes || []).forEach(function (op, indice) {
        var preco = el('input', { class: 'preco', type: 'text', inputmode: 'numeric', value: op.preco ? dinheiro(op.preco) : 'grátis', 'aria-label': 'Acréscimo de ' + op.nome });
        UI.mascaraDinheiro(preco);
        preco.addEventListener('change', function () {
          var c = UI.centavosDoCampo(preco.value);
          atualizarOpcao(chave, indice, { preco: c });
          if (!c) preco.value = 'grátis';
        });
        var chaveAtiva = el('button', { class: 'chave' + (op.ativo !== false ? ' on' : ''), 'aria-label': 'Ligar ou desligar ' + op.nome, onclick: function () { atualizarOpcao(chave, indice, { ativo: !(op.ativo !== false) }); } });
        lista.appendChild(el('div', { class: 'linha-produto opcao' + (op.ativo !== false ? '' : ' desligado') }, [
          el('div', { class: 'nome' }, [op.nome + (op.padrao ? ' (padrão)' : ''), op.descricao ? el('small', { text: op.descricao }) : null]),
          preco,
          el('button', { class: 'editar', text: '✕', 'aria-label': 'Remover ' + op.nome, onclick: function () {
            UI.perguntar('Remover a opção "' + op.nome + '"?', { sim: 'Remover', perigo: true }).then(function (sim) { if (sim) removerOpcao(chave, indice); });
          } }),
          chaveAtiva,
        ]));
      });
      bloco.appendChild(lista);
      bloco.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', style: { marginTop: '10px' }, text: '+ Opção', onclick: function () { novaOpcao(chave); } }));
      return bloco;
    }

    function atualizarOpcao(chave, indice, mudancas) {
      var grupos = D.clonar(estado.loja.grupos);
      Object.assign(grupos[chave].opcoes[indice], mudancas);
      salvarLoja({ grupos: grupos }, 'Salvo').then(desenharCardapio);
    }
    function removerOpcao(chave, indice) {
      var grupos = D.clonar(estado.loja.grupos);
      grupos[chave].opcoes.splice(indice, 1);
      salvarLoja({ grupos: grupos }, 'Opção removida').then(desenharCardapio);
    }
    function novaOpcao(chave) {
      var nome = campoTexto('Nome da opção', '', { max: 40, placeholder: 'Ex: Bacon' });
      var preco = campoDinheiro('Acréscimo no preço', 0, 'Deixe vazio se for grátis');
      UI.abrirModal({ titulo: 'Nova opção', corpo: el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [nome, preco]), rodape: [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Adicionar', onclick: function () {
        var n = nome.input.value.trim();
        if (n.length < 1) return UI.avisar('Digite o nome.');
        var grupos = D.clonar(estado.loja.grupos);
        var base = R.slug(n) || 'op';
        var id = base;
        var k = 2;
        while (grupos[chave].opcoes.some(function (o) { return o.id === id; })) id = base + '-' + (k++);
        grupos[chave].opcoes.push({ id: id, nome: n, preco: preco.centavos(), ativo: true, padrao: grupos[chave].tipo === 'unico' && grupos[chave].opcoes.length === 0 });
        /* trava o botao ate o banco responder: toque duplo criava a opcao repetida */
        var botao = this;
        botao.disabled = true; botao.textContent = 'Salvando…';
        salvarLoja({ grupos: grupos }, 'Opção adicionada').then(function () { UI.fecharModal(); desenharCardapio(); })
          .catch(function () { botao.disabled = false; botao.textContent = 'Adicionar'; });
      } })] });
      setTimeout(function () { nome.input.focus(); }, 60);
    }

    function editarGrupo(chave, categoriaId) {
      var novo = !chave;
      var g = novo ? { titulo: '', tipo: 'varios', max: 0, opcoes: [] } : estado.loja.grupos[chave];
      var titulo = campoTexto('Título que o cliente vê', g.titulo, { max: 50, placeholder: 'Ex: Tamanho, Adicionais' });
      var tipo = campoSelect('Como escolhe', g.tipo, [['unico', 'Escolhe só um (tamanho)'], ['varios', 'Pode escolher vários (adicionais)']]);
      var max = campoTexto('Máximo de escolhas (só para "vários")', g.max || '', { tipo: 'number', placeholder: '0 = sem limite' });
      max.input.min = '0';
      var usa = el('div', { class: 'pilha' });
      estado.loja.categorias.forEach(function (c) {
        var marcado = novo ? c.id === categoriaId : ((estado.loja.gruposPorCategoria || {})[c.id] || []).indexOf(chave) >= 0;
        var cb = el('input', { type: 'checkbox', class: 'opcao-campo', value: c.id });
        cb.checked = marcado;
        var linha = el('label', { class: 'opcao' + (marcado ? ' marcada' : '') }, [cb, el('span', { class: 'marcador quadrado', text: '✓' }), el('span', { class: 'rotulo', text: c.nome })]);
        cb.addEventListener('change', function () { linha.classList.toggle('marcada', cb.checked); });
        usa.appendChild(linha);
      });
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [titulo, tipo, max, el('div', {}, [el('label', { class: 'forte', text: 'Vale para quais categorias?' }), usa])]);
      var botoes = [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: novo ? 'Criar grupo' : 'Salvar', onclick: function () {
        var t = titulo.input.value.trim();
        if (t.length < 2) return UI.avisar('Digite o título.');
        var grupos = D.clonar(estado.loja.grupos || {});
        var k = chave;
        if (novo) {
          var base = R.slug(t) || 'grupo';
          k = base;
          var n = 2;
          while (grupos[k]) k = base + '-' + (n++);
          grupos[k] = { titulo: t, tipo: tipo.input.value, max: Math.max(0, Math.floor(Number(max.input.value) || 0)), opcoes: [] };
        } else {
          Object.assign(grupos[k], { titulo: t, tipo: tipo.input.value, max: Math.max(0, Math.floor(Number(max.input.value) || 0)) });
        }
        var gpc = D.clonar(estado.loja.gruposPorCategoria || {});
        estado.loja.categorias.forEach(function (c) {
          var lista = (gpc[c.id] || []).filter(function (x) { return x !== k; });
          var cb = usa.querySelector('input[value="' + c.id + '"]');
          if (cb && cb.checked) lista.push(k);
          gpc[c.id] = lista;
        });
        /* o site so guarda uma escolha "Escolhe so um" por item: dois na mesma categoria, o segundo apaga o primeiro */
        if (grupos[k].tipo === 'unico') {
          var repetido = estado.loja.categorias.some(function (c) {
            var doCat = gpc[c.id] || [];
            return doCat.indexOf(k) >= 0 && doCat.some(function (x) { return x !== k && grupos[x] && grupos[x].tipo === 'unico'; });
          });
          if (repetido) return UI.avisar('Só um grupo "Escolhe só um" por categoria. Use "Pode escolher vários" com máximo 1.');
        }
        /* trava o botao ate o banco responder: toque duplo criava dois grupos iguais */
        var botao = this;
        botao.disabled = true; botao.textContent = 'Salvando…';
        salvarLoja({ grupos: grupos, gruposPorCategoria: gpc }, 'Grupo salvo').then(function () { UI.fecharModal(); desenharCardapio(); })
          .catch(function () { botao.disabled = false; botao.textContent = novo ? 'Criar grupo' : 'Salvar'; });
      } })];
      if (!novo) botoes.unshift(el('button', { class: 'btn btn-erro btn-pequeno', text: 'Excluir', onclick: function () {
        UI.perguntar('Excluir o grupo "' + g.titulo + '" e todas as opções dele?', { sim: 'Excluir', perigo: true }).then(function (sim) {
          if (!sim) { editarGrupo(chave, categoriaId); return; }
          var grupos = D.clonar(estado.loja.grupos);
          delete grupos[chave];
          var gpc = D.clonar(estado.loja.gruposPorCategoria || {});
          Object.keys(gpc).forEach(function (c) { gpc[c] = gpc[c].filter(function (x) { return x !== chave; }); });
          salvarLoja({ grupos: grupos, gruposPorCategoria: gpc }, 'Grupo excluído').then(function () { UI.fecharModal(); desenharCardapio(); });
        });
      } }));
      UI.abrirModal({ titulo: novo ? 'Novo grupo de opções' : g.titulo, corpo: corpo, rodape: botoes });
    }

    /* ---------------------------------------------------------- vendas */
    function desenharVendas() {
      var s = $('secaoPainel');
      UI.limpar(s);
      var dias = estado.diasVendas || 7;
      var seletor = el('div', { class: 'seletor-periodo', role: 'group', 'aria-label': 'Período' });
      [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias']].forEach(function (d) {
        seletor.appendChild(el('button', { class: 'aba-painel' + (dias === d[0] ? ' ativa' : ''), text: d[1], onclick: function () { estado.diasVendas = d[0]; desenharVendas(); } }));
      });
      s.appendChild(el('h2', { text: 'Vendas' }));
      s.appendChild(seletor);
      var conteudo = el('div', { class: 'pilha' }, el('p', { class: 'muted', text: 'Somando…' }));
      s.appendChild(conteudo);

      var desde = new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000);
      desde.setHours(0, 0, 0, 0);
      /* memoria de 5 minutos por periodo: trocar de aba ou de periodo e voltar nao le o banco de novo (leituras gratis rendem mais) */
      estado.vendasMemoria = estado.vendasMemoria || {};
      var guardada = estado.vendasMemoria[dias];
      var buscar = guardada && Date.now() - guardada.em < 5 * 60 * 1000 ? Promise.resolve(guardada.pedidos)
        : store.listarPedidos(slug, { desde: desde.toISOString() }).then(function (lista) { estado.vendasMemoria[dias] = { em: Date.now(), pedidos: lista }; return lista; });
      buscar.catch(function () {
        UI.limpar(conteudo); conteudo.appendChild(el('p', { class: 'muted centro', text: 'Não deu para carregar as vendas. Confira a internet e abra a aba de novo.' })); return null;
      }).then(function (pedidos) {
        if (!pedidos) return;
        var r = R.resumoVendas(pedidos, dias);
        UI.limpar(conteudo);
        conteudo.appendChild(el('div', { class: 'metricas' }, [
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: dinheiro(r.total) }), el('div', { class: 'l', text: 'faturamento' })]),
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: String(r.pedidos) }), el('div', { class: 'l', text: 'pedidos' })]),
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: dinheiro(r.ticketMedio) }), el('div', { class: 'l', text: 'por pedido' })]),
        ]));

        if (dias > 1) {
          var maximo = 0;
          var diasLista = [];
          for (var i = dias - 1; i >= 0; i--) {
            var d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            var k = R.diaLocal(d);
            var v = r.porDia[k] || 0;
            maximo = Math.max(maximo, v);
            diasLista.push({ k: k, v: v, hoje: i === 0, rotulo: d.getDate() + '/' + (d.getMonth() + 1), semana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()] });
          }
          conteudo.appendChild(el('h3', { text: 'Por dia' }));
          if (!maximo) {
            conteudo.appendChild(el('div', { class: 'grafico-vazio' }, [el('div', { class: 'icone', text: '📊' }), el('p', { text: 'Nenhuma venda nesse período ainda. Assim que entrar pedido, o gráfico aparece aqui.' })]));
          } else {
            var poucos = dias <= 7;
            var barras = el('div', { class: 'barras' + (poucos ? ' poucos' : '') });
            diasLista.forEach(function (d, i) {
              var alt = Math.max(2, Math.round((d.v / maximo) * 100));
              barras.appendChild(el('div', { class: 'b' + (d.hoje ? ' hoje' : '') + (d.v ? '' : ' zero'), title: d.rotulo + ': ' + dinheiro(d.v) }, [
                el('div', { class: 'area' }, [
                  poucos && d.v ? el('div', { class: 'val', text: dinheiro(d.v).replace('R$', '').replace(/,00$/, '').trim() }) : null,
                  el('div', { class: 'col', style: { height: alt + '%' } }),
                ]),
                el('div', { class: 'lab', text: poucos ? (d.hoje ? 'hoje' : d.semana) : ((i % 5 === 0 || d.hoje) ? d.rotulo : '') }),
              ]));
            });
            conteudo.appendChild(barras);
          }
        }

        var horas = Object.keys(r.porHora).map(Number).sort(function (a, b) { return r.porHora[b] - r.porHora[a]; }).slice(0, 3);
        if (horas.length) conteudo.appendChild(el('p', { class: 'muted', text: 'Horários com mais pedidos: ' + horas.map(function (h) { return h + 'h'; }).join(', ') + '.' }));

        if (r.maisVendidos.length) {
          conteudo.appendChild(el('h3', { text: 'Mais vendidos' }));
          conteudo.appendChild(el('div', { class: 'lista-simples' }, r.maisVendidos.map(function (m) { return el('div', { class: 'linha' }, [el('span', { text: m.nome }), el('b', { text: m.quantidade + 'x' })]); })));
        }

        var formas = Object.keys(r.porForma);
        if (formas.length) {
          var nomes = { pix: 'Pix', cartao_entrega: 'Maquininha', dinheiro_entrega: 'Dinheiro' };
          conteudo.appendChild(el('h3', { text: 'Como pagaram' }));
          conteudo.appendChild(el('div', { class: 'lista-simples' }, formas.map(function (f) { return el('div', { class: 'linha' }, [el('span', { text: nomes[f] || f }), el('b', { text: r.porForma[f] + ' pedidos' })]); })));
        }

        /* clientes */
        var clientes = {};
        pedidos.forEach(function (p) {
          if (p.status === R.STATUS.CANCELADO || p.status === R.STATUS.AGUARDANDO || !p.cliente.telefone) return;
          var c = clientes[p.cliente.telefone] || { nome: p.cliente.nome, telefone: p.cliente.telefone, pedidos: 0, total: 0, bairro: '' };
          c.pedidos += 1;
          c.total += p.total;
          if (p.endereco && p.endereco.bairro) c.bairro = p.endereco.bairro;
          clientes[p.cliente.telefone] = c;
        });
        var listaClientes = Object.keys(clientes).map(function (k) { return clientes[k]; }).sort(function (a, b) { return b.total - a.total; });
        if (listaClientes.length) {
          conteudo.appendChild(el('h3', { text: 'Seus clientes no período · ' + listaClientes.length }));
          /* a lista cresce sem limite: 15 de cada vez, com filtro, pra pagina nao virar um rolo */
          var filtro = el('input', { type: 'search', class: 'busca', placeholder: '🔍 Nome, bairro ou telefone', 'aria-label': 'Filtrar clientes' });
          var caixaTabela = el('div', { style: { overflowX: 'auto' } });
          var mostrar = 15;
          function desenharClientes() {
            UI.limpar(caixaTabela);
            var termo = R.semAcento(String(filtro.value || '')).toLowerCase().trim();
            var visiveis = termo ? listaClientes.filter(function (c) { return R.semAcento(String(c.nome + ' ' + c.bairro + ' ' + c.telefone)).toLowerCase().indexOf(termo) >= 0; }) : listaClientes;
            if (!visiveis.length) { caixaTabela.appendChild(el('p', { class: 'muted', text: 'Nenhum cliente com esse nome.' })); return; }
            var tabela = el('table', { class: 'tabela tabela-clientes' }, [el('tr', {}, [el('th', { text: 'Cliente' }), el('th', { text: 'WhatsApp' }), el('th', { text: 'Pedidos' }), el('th', { text: 'Gastou' })])]);
            visiveis.slice(0, mostrar).forEach(function (c) {
              /* no celular as colunas do meio somem e aparecem como segunda linha (tab-sub) */
              tabela.appendChild(el('tr', {}, [
                el('td', {}, [c.nome + (c.bairro ? ' · ' + c.bairro : ''), c.telefone ? el('span', { class: 'tab-sub', text: R.formatarTelefone(c.telefone) }) : null]),
                el('td', { class: 'sem-quebra', text: R.formatarTelefone(c.telefone) }),
                el('td', { text: String(c.pedidos) }),
                el('td', { class: 'sem-quebra' }, [dinheiro(c.total), el('span', { class: 'tab-sub', text: c.pedidos + (c.pedidos === 1 ? ' pedido' : ' pedidos') })]),
              ]));
            });
            caixaTabela.appendChild(tabela);
            if (visiveis.length > mostrar) caixaTabela.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', style: { marginTop: '8px' }, text: 'Mostrar mais (' + (visiveis.length - mostrar) + ' restantes)', onclick: function () { mostrar += 25; desenharClientes(); } }));
          }
          filtro.addEventListener('input', function () { mostrar = 15; desenharClientes(); });
          if (listaClientes.length > 8) conteudo.appendChild(filtro);
          conteudo.appendChild(caixaTabela);
          desenharClientes();
          conteudo.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', text: '📋 Copiar para o Excel', onclick: function () {
            var csv = 'Nome;WhatsApp;Bairro;Pedidos;Total\n' + listaClientes.map(function (c) { return [c.nome, c.telefone, c.bairro, c.pedidos, (c.total / 100).toFixed(2).replace('.', ',')].join(';'); }).join('\n');
            UI.copiar(csv).then(function () { UI.avisar('Lista copiada. Cole no Excel ou no Planilhas.'); });
          } }));
        }
      });
    }

    /* ---------------------------------------------------------- ajustes */
    function interruptorCampo(rotulo, ajuda, valor) {
      var chave = el('button', { class: 'chave' + (valor ? ' on' : ''), type: 'button', 'aria-label': rotulo });
      chave.ligado = !!valor;
      chave.addEventListener('click', function () { chave.ligado = !chave.ligado; chave.classList.toggle('on', chave.ligado); });
      var bloco = el('div', { class: 'interruptor' }, [el('div', { class: 'texto' }, [rotulo, ajuda ? el('small', { text: ajuda }) : null]), chave]);
      bloco.chave = chave;
      return bloco;
    }

    function desenharAjustes() {
      var s = $('secaoPainel');
      UI.limpar(s);
      var l = estado.loja;
      var f = { original: D.clonar(l) };

      s.appendChild(el('h2', { text: 'Ajustes da loja' }));
      var identidade = el('div', { class: 'bloco-form', id: 'aj-dados' }, [el('div', { class: 'bloco-titulo', text: 'Dados da loja' })]);
      var aparencia = el('div', { class: 'bloco-form', id: 'aj-aparencia' }, [el('div', { class: 'bloco-titulo', text: 'Aparência do site' })]);
      var g1 = el('div', { class: 'grade-form' });
      f.nome = campoTexto('Nome', l.nome, { max: 60 });
      f.tipo = campoTexto('Tipo', l.tipo, { max: 30, placeholder: 'Lanchonete, Pizzaria, Marmitaria…' });
      f.logo = UI.campoFoto('Logo', D.logoSrc(l), { quadrado: true, lado: 200, qualidade: 0.82, vazio: l.emoji || '🍽️' });
      f.capa = UI.campoFoto('Capa', l.capa ? D.fotoSrc({ foto: l.capa }, estado.fotos) : (l.capaUrl || null), { lado: 1080, qualidade: 0.72, larga: true, vazio: '🖼️' });
      f.logo.hidden = true; f.capa.hidden = true; /* quem mostra e a previa; eles so guardam a foto */
      f.previa = previaDaLoja(l, f);
      f.cor = campoCor('Cor da sua loja', l.cor, function () { f.previa.atualizar(); });
      f.estilo = campoEstilo('Estilo do site', l.estilo, function () { f.previa.atualizar(); });
      f.nome.input.addEventListener('input', function () { f.previa.atualizar(); });
      f.tipo.input.addEventListener('input', function () { f.previa.atualizar(); });
      f.medidas = el('details', { class: 'avancado campo largo' }, [
        el('summary', { text: 'Medidas das imagens, para quem for fazer a arte' }),
        el('p', { class: 'muted pequeno' }, [el('b', { text: 'Logo: ' }), 'quadrada, 500 × 500 px ou maior (JPG ou PNG). O sistema corta o centro e diminui. Aparece com 120 px no site e 60 px na vitrine: símbolo grande, sem letra pequena.']),
        el('p', { class: 'muted pequeno' }, [el('b', { text: 'Capa: ' }), 'deitada, 1200 × 500 px (proporção 12 por 5). No celular aparece só a faixa do meio: deixe o que importa no centro e nada escrito nas bordas. Uma foto do celular na horizontal serve.']),
        el('p', { class: 'muted pequeno' }, [el('b', { text: 'Foto de item: ' }), 'qualquer foto do celular, prato no centro. O sistema diminui para 640 px.']),
      ]);
      f.emoji = campoEmoji('Emoji da loja', l.emoji, { ajuda: 'Aparece no lugar da logo enquanto você não manda uma.', aoMudar: function () { if (f.previa) f.previa.atualizar(); } });
      f.descricao = campoTexto('Frase de apresentação', l.descricao, { max: 120, largo: true, placeholder: 'Ex: Lanche bem servido, feito na hora.' });
      f.avisoTopo = campoTexto('Aviso no topo do site', l.avisoTopo, { max: 120, largo: true, placeholder: 'Ex: Hoje só entrega no Centro', ajuda: 'Aparece em destaque para o cliente. Deixe vazio para não mostrar.' });
      f.cidade = window.LigeiroCidades.campo(l.cidade, l.uf, { rotulo: 'Cidade', ajuda: 'Escolha na lista. É a página da cidade em que sua loja aparece.' });
      f.endereco = campoTexto('Endereço da loja', l.endereco, { max: 120, largo: true });
      f.whatsapp = campoTexto('WhatsApp da loja', R.formatarTelefone(l.whatsapp), { max: 16, inputmode: 'numeric', ajuda: 'Com DDD. É para onde o cliente fala com você.' });
      UI.mascaraTelefone(f.whatsapp.input);
      f.instagram = campoTexto('Instagram (sem @)', l.instagram, { max: 40 });
      f.google = campoTexto('Sua loja no Google (opcional)', l.googleUrl, { max: 400, inputmode: 'url', placeholder: 'https://maps.app.goo.gl/…', ajuda: 'No Google Maps, abra sua loja, toque em Compartilhar e cole o link aqui.' });
      f.cnpj = campoTexto('CNPJ (opcional)', l.cnpj ? R.formatarCnpj(l.cnpj) : '', { max: 18, inputmode: 'numeric', placeholder: '00.000.000/0000-00', ajuda: 'Se preencher, aparece no rodapé do seu site. Passa confiança para o cliente.' });
      f.cnpj.input.addEventListener('input', function () { var n = f.cnpj.input.value.replace(/\D/g, '').slice(0, 14); f.cnpj.input.value = n.length === 14 ? R.formatarCnpj(n) : n; });
      /* Aparencia: celular de um lado, controles compactos do outro */
      var emojiDetalhe = el('details', { class: 'avancado campo largo' }, [el('summary', { text: 'Sem logo? Escolha um emoji' }), f.emoji]);
      if (!D.logoSrc(l)) emojiDetalhe.open = true;
      var cfgEx = window.LIGEIRO_CONFIG || {};
      var exclusivo = (cfgEx.whatsappLigeiro && !UI.lojaOficial(slug)) ? el('p', { class: 'muted pequeno exclusivo-convite' }, [
        'Quer um visual só seu, desenhado para sua marca? ',
        el('a', { href: R.linkWhatsapp(cfgEx.whatsappLigeiro, 'Oi! Quero um orçamento de design exclusivo para ' + l.nome + ' no Ligeiro.'), target: '_blank', rel: 'noopener', text: 'Peça um orçamento de design exclusivo' }),
        '.',
      ]) : null;
      var controles = el('div', { class: 'aparencia-controles' }, [f.cor, f.estilo, emojiDetalhe, f.medidas, exclusivo]);
      aparencia.appendChild(el('div', { class: 'aparencia' }, [f.previa, controles]));
      aparencia.appendChild(f.logo);
      aparencia.appendChild(f.capa);
      s.appendChild(aparencia);
      [f.nome, f.tipo, f.descricao, f.avisoTopo, f.cidade, f.endereco, f.whatsapp, f.instagram, f.google, f.cnpj].forEach(function (c) { g1.appendChild(c); });
      identidade.appendChild(g1);
      /* ID da loja: o codigo unico dela (o mesmo do link). E o que o dono manda para o Ligeiro para ganhar o design exclusivo. */
      identidade.appendChild(el('div', { class: 'id-loja' }, [
        el('div', { class: 'id-loja-texto' }, [el('b', { text: 'ID da loja' }), el('span', { class: 'muted pequeno', text: 'É o código único desta loja. Para pedir o design exclusivo, mande ele para o Ligeiro.' })]),
        el('div', { class: 'id-loja-linha' }, [
          el('code', { class: 'id-loja-valor', text: l.slug }),
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📋 Copiar', onclick: function () { UI.copiar(l.slug).then(function (ok) { UI.avisar(ok ? 'ID copiado: ' + l.slug : 'Toque e segure no código para copiar'); }); } }),
        ]),
      ]));
      s.appendChild(identidade);

      var funcionamento = el('div', { class: 'bloco-form', id: 'aj-funcionamento' }, [el('div', { class: 'bloco-titulo', text: 'Funcionamento' })]);
      f.aberta = interruptorCampo('Loja aberta para pedidos', 'Interruptor manual. Desligado, ninguém consegue pedir.', l.aberta !== false);
      f.usarHorarios = interruptorCampo('Fechar sozinha fora do horário', 'Além do interruptor, respeita os horários abaixo.', !!l.usarHorarios);
      funcionamento.appendChild(f.aberta);
      funcionamento.appendChild(f.usarHorarios);
      var dias = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
      f.horarios = campoHorarios(l.horarios, dias);
      funcionamento.appendChild(f.horarios);
      s.appendChild(funcionamento);

      var entrega = el('div', { class: 'bloco-form', id: 'aj-entrega' }, [el('div', { class: 'bloco-titulo', text: 'Entrega e retirada' })]);
      f.aceitaEntrega = interruptorCampo('Faz entrega', 'É o botão "Quero entrega" que o cliente vê.', l.aceitaEntrega !== false);
      f.aceitaRetirada = interruptorCampo('Cliente pode buscar na loja', 'É o botão "Vou buscar". Desligue se você só entrega.', l.aceitaRetirada !== false);
      entrega.appendChild(f.aceitaEntrega);
      entrega.appendChild(f.aceitaRetirada);
      /* Frete: o dono manda. "Entrega gratis" desliga a taxa em todo pedido; "Cobro taxa" mostra os valores. */
      f.taxaEntrega = campoDinheiro('Taxa de entrega', l.taxaEntrega, 'O que o cliente paga pela entrega.');
      f.entregaGratisAcima = campoDinheiro('Grátis a partir de', l.entregaGratisAcima, 'Vazio = a taxa vale sempre. Com valor, o site mostra "faltam R$ X para entrega grátis", e o pedido cresce.');
      f.frete = campoFrete(l, function (modo) {
        f.taxaEntrega.hidden = modo === 'gratis';
        f.entregaGratisAcima.hidden = modo === 'gratis';
      });
      entrega.appendChild(f.frete);
      var ge = el('div', { class: 'grade-form' });
      f.pedidoMinimo = campoDinheiro('Pedido mínimo', l.pedidoMinimo, 'Vazio = sem mínimo');
      f.tempoPreparo = campoTexto('Tempo de preparo (min)', l.tempoPreparo, { tipo: 'number' });
      f.tempoEntrega = campoTexto('Tempo de entrega (min)', l.tempoEntrega, { tipo: 'number' });
      f.tempoPreparo.input.min = '1'; f.tempoPreparo.input.max = '240'; f.tempoEntrega.input.min = '1'; f.tempoEntrega.input.max = '240';
      [f.taxaEntrega, f.entregaGratisAcima, f.pedidoMinimo, f.tempoPreparo, f.tempoEntrega].forEach(function (c) { ge.appendChild(c); });
      entrega.appendChild(ge);
      s.appendChild(entrega);

      var pagamento = el('div', { class: 'bloco-form', id: 'aj-pagamento' }, [el('div', { class: 'bloco-titulo', text: 'Pagamento' })]);
      /* Pix e sempre automatico, pela conta Mercado Pago da loja: o cliente paga e o pedido cai pronto */
      var cfgMP = window.LIGEIRO_CONFIG || {};
      var pixPossivel = D.modoDemo || !!cfgMP.proxyMercadoPago;
      var temConexao = D.modoDemo || !!cfgMP.mercadoPagoClientId;
      f.mpAtivo = interruptorCampo('Pix automático', 'O cliente paga no Pix e o pedido cai pronto na cozinha, sem ninguém conferir nada.', !!l.mpAtivo);
      f.mpToken = campoTexto('Access Token do Mercado Pago', '', { max: 200, tipo: 'password', placeholder: D.modoDemo ? 'Digite SIMULACAO' : 'Começa com APP_USR-', ajuda: 'Fica guardado em segredo, só a loja e o Ligeiro veem. Cole outro só para trocar.' });
      f.mpToken.input.setAttribute('autocomplete', 'off');
      f.mpToken.temSalvo = false;
      f.mpToken.lido = false; /* vira true quando a leitura da conexao responde */

      /* caixa da conexao: "Conectar com Mercado Pago" ou "Conectado desde ..." */
      var conexao = el('div', { class: 'mp-conexao' });
      function desenharConexao(c) {
        f.mpToken.lido = true;
        UI.limpar(conexao);
        if (c && c.token) {
          f.mpToken.temSalvo = true;
          conexao.appendChild(el('div', { class: 'mp-conectado' }, [
            el('span', { class: 'mp-selo', text: '✅ Mercado Pago conectado' }),
            el('span', { class: 'muted pequeno', text: (c.conectadoEm ? 'desde ' + new Date(c.conectadoEm).toLocaleDateString('pt-BR') : '') + (c.mpUserId ? ' · conta ' + c.mpUserId : '') }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Desconectar', onclick: function () {
              UI.perguntar('Desconectar o Mercado Pago? O Pix para de funcionar até conectar de novo.', { sim: 'Desconectar', perigo: true }).then(function (sim) {
                if (!sim) return;
                window.LigeiroMP.desconectar(slug).then(function () { f.mpToken.temSalvo = false; f.mpAtivo.chave.definir ? f.mpAtivo.chave.definir(false) : null; return salvarLoja({ mpAtivo: false, aceitaPix: false }, 'Mercado Pago desconectado.'); }).then(function () { desenharAjustes(); });
              });
            } }),
          ]));
          return;
        }
        conexao.appendChild(el('button', { class: 'btn btn-principal btn-largo btn-mp', type: 'button', text: '🔗 Conectar Mercado Pago', onclick: function () {
          window.LigeiroMP.conectar(slug).then(function (r) {
            if (r === 'demo') { UI.avisar('Na demonstração, conectado (simulado).'); return salvarLoja({ mpAtivo: true, aceitaPix: true }, 'Pix automático ligado.').then(function () { desenharAjustes(); }); }
          }).catch(function (e) { UI.avisar(e.message || 'Não deu para conectar agora.'); });
        } }));
        conexao.appendChild(el('p', { class: 'muted pequeno', text: 'Abre o Mercado Pago, você entra na sua conta (ou cria uma, grátis) e toca em Autorizar. Volta para cá com o Pix ligado. Sem copiar nada.' }));
      }
      if (window.LigeiroMP) window.LigeiroMP.lerConexao(l.slug).then(desenharConexao); else desenharConexao(null);
      pagamento.appendChild(f.mpAtivo);
      if (temConexao) pagamento.appendChild(conexao);
      var avancadoMP = el('details', { class: 'avancado' }, [
        el('summary', { text: temConexao ? 'Colar o token (avançado)' : 'Colar o token do Mercado Pago' }),
        f.mpToken,
        el('ol', { class: 'passos-mp' }, [
          el('li', {}, [el('b', { text: 'Tenha uma conta no Mercado Pago' }), ' (app, grátis) com uma chave Pix cadastrada nela. É lá que o dinheiro do cliente cai; você transfere para o banco quando quiser.']),
          el('li', {}, [el('b', { text: 'Pegue o Access Token' }), ': no site do Mercado Pago, Suas integrações › Criar aplicação › Credenciais de produção › Access Token. Começa com APP_USR.']),
          el('li', {}, [el('b', { text: 'Cole acima, ligue e salve.' }), ' Faça um pedido de teste de R$ 1 pelo seu site: pagou, o pedido vira "pago" sozinho em segundos.']),
        ]),
      ]);
      if (!temConexao) avancadoMP.open = true;
      pagamento.appendChild(avancadoMP);
      pagamento.appendChild(el('p', { class: 'aviso' + (l.mpAtivo ? '' : ' aviso-falta'), text: l.mpAtivo
        ? '✅ Pix automático ligado. O Mercado Pago cobra cerca de 1% por Pix recebido.'
        : (pixPossivel ? '⚠️ Pix desligado. Sem ele, o cliente só paga na entrega ou no balcão (maquininha ou dinheiro).' : '⚠️ O Ligeiro ainda não ligou o mensageiro do Pix. Enquanto isso, o cliente paga na entrega ou no balcão.') }));
      f.aceitaCartaoEntrega = interruptorCampo('Maquininha na entrega ou no balcão', '', !!l.aceitaCartaoEntrega);
      f.aceitaDinheiroEntrega = interruptorCampo('Dinheiro na entrega ou no balcão', 'O cliente já diz se precisa de troco.', !!l.aceitaDinheiroEntrega);
      f.aceitaPagarNoBalcao = interruptorCampo('Quem retira pode pagar no balcão', 'Desligado, retirada só com Pix.', l.aceitaPagarNoBalcao !== false);
      f.permitePersonalizar = interruptorCampo('Cliente pode tirar ingredientes e mandar recado', '', l.permitePersonalizar !== false);
      f.mostrarOutras = interruptorCampo('Mostrar "outros estabelecimentos da cidade" no meu site', 'Desligado, o seu link é só seu: o cliente não vê concorrente. Ligado, sua loja vira parte da vitrine da cidade e ganha o link de volta.', l.mostrarOutras === true);
      [f.aceitaCartaoEntrega, f.aceitaDinheiroEntrega, f.aceitaPagarNoBalcao, f.permitePersonalizar, f.mostrarOutras].forEach(function (c) { pagamento.appendChild(c); });
      s.appendChild(pagamento);

      var cupons = el('div', { class: 'bloco-form' }, [el('div', { class: 'bloco-titulo', text: 'Cupons de desconto' })]);
      var listaCupons = el('div', { class: 'pilha' });
      (l.cupons || []).forEach(function (c, i) {
        var chave = el('button', { class: 'chave' + (c.ativo !== false ? ' on' : ''), type: 'button', 'aria-label': 'Ligar ou desligar ' + c.codigo, onclick: function () {
          var lista = D.clonar(estado.loja.cupons);
          lista[i].ativo = !(lista[i].ativo !== false);
          salvarLoja({ cupons: lista }, 'Cupom ' + (lista[i].ativo ? 'ligado' : 'desligado')).then(desenharAjustes);
        } });
        var excluir = el('button', { class: 'editar', type: 'button', text: '✕', 'aria-label': 'Excluir ' + c.codigo, onclick: function () {
          UI.perguntar('Excluir o cupom ' + c.codigo + '?', { sim: 'Excluir', perigo: true }).then(function (sim) {
            if (!sim) return;
            salvarLoja({ cupons: estado.loja.cupons.filter(function (x) { return x.codigo !== c.codigo; }) }, 'Cupom excluído').then(desenharAjustes);
          });
        } });
        function textoUsos(usos) { return (c.minimo ? 'a partir de ' + dinheiro(c.minimo) + ' · ' : '') + (c.limite ? usos + ' de ' + c.limite + ' usos' : usos + ' usos'); }
        var usosTexto = el('small', { text: textoUsos(c.usos || 0) });
        /* na nuvem os usos contam em contadores/cupom-CODIGO (o numero do cupom nao muda): mostra o de verdade */
        if (store.usosDoCupom) store.usosDoCupom(slug, c.codigo).then(function (n) { usosTexto.textContent = textoUsos(Number(n) || 0); }).catch(function () { /* fica o que estava */ });
        listaCupons.appendChild(el('div', { class: 'linha-produto' + (c.ativo !== false ? '' : ' desligado') }, [
          el('div', { class: 'nome' }, [c.codigo + ' · ' + c.percentual + '%', usosTexto]),
          excluir,
          chave,
        ]));
      });
      cupons.appendChild(listaCupons);
      cupons.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '+ Criar cupom', onclick: novoCupom }));
      s.appendChild(cupons);

      /* sons do painel: o dono ouve cada um e sabe o que significa */
      var listaSons = [['apito', '🔔 Pedido novo', 'Alto, para ouvir da cozinha'], ['pago', '💸 Pix caiu', 'O pedido já pode começar'], ['cancelado', '✕ Cliente cancelou', 'O pedido saiu da fila'], ['lembrete', '⏰ Pedido parado', 'Pago há mais de 5 minutos sem começar']];
      s.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Sons do painel' }),
        el('p', { class: 'muted pequeno', text: 'Toque para ouvir cada aviso. Para silenciar tudo, use o botão Apito lá em cima.' }),
        el('div', { class: 'sons-lista' }, listaSons.map(function (x) {
          return el('button', { type: 'button', class: 'som-linha', onclick: function () { if (!UI.somLigado()) { UI.avisar('O apito está desligado. Ligue no botão Apito, lá em cima.'); return; } UI.soar(x[0]); } }, [
            el('span', { class: 'som-texto' }, [el('b', { text: x[1] }), el('small', { text: x[2] })]),
            el('span', { class: 'som-tocar', 'aria-hidden': 'true', text: '▶' }),
          ]);
        })),
      ]));

      if (D.modoDemo) {
        var seguranca = el('div', { class: 'bloco-form' }, [el('div', { class: 'bloco-titulo', text: 'Senha do painel' })]);
        f.senhaPainel = campoTexto('Nova senha (deixe vazio para não mudar)', '', { max: 20, tipo: 'password', inputmode: 'numeric' });
        f.senhaPainel.input.setAttribute('autocomplete', 'new-password');
        seguranca.appendChild(f.senhaPainel);
        s.appendChild(seguranca);
      }

      s.appendChild(el('button', { class: 'btn btn-principal btn-largo', text: 'Salvar tudo', onclick: function () { salvarAjustes(f); } }));
      /* barra fixa: salva de qualquer ponto da pagina, sem descer ate o fim */
      var estadoSalvar = el('span', { class: 'salvar-estado', text: 'Ajustes da loja' });
      var barraSalvar = el('div', { class: 'salvar-fixo' }, [estadoSalvar, el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: '💾 Salvar tudo', onclick: function () { salvarAjustes(f); } })]);
      s.appendChild(barraSalvar);
      s.classList.add('com-salvar');
      function marcarMudanca() { estadoSalvar.textContent = '● Alterações não salvas'; estadoSalvar.classList.add('pendente'); }
      s.addEventListener('input', marcarMudanca);
      s.addEventListener('change', marcarMudanca);
      s.addEventListener('click', function (e) { if (e.target.closest('.chave, .cor, .aba-painel, .previa-cam, .foto-botoes button')) marcarMudanca(); });
    }

    /* Aceita "18:00-23:00", "18h-23h30", "11:00 as 14:00; 18:00-23:00". Se nao entender, avisa e devolve null. */
    /* Devolve { seg: [['18:00','23:00'], ...], ... } ou null (ja avisou o que falta). */
    function lerHorarios(f) {
      return f.horarios.valor();
    }

    /*
     * Horarios sem digitar nada: cada dia tem um interruptor Aberto/Fechado, um
     * relogio "de" e "ate" (o seletor nativo do celular) e, se quiser, um
     * segundo turno (almoco e janta). "Copiar pra todos" repete a segunda.
     */
    function campoHorarios(horarios, dias) {
      var nomes = {};
      dias.forEach(function (d) { nomes[d[0]] = d[1]; });
      function faixaPar(fx) {
        if (typeof fx === 'string') { var p = fx.split('-'); return p.length === 2 ? [p[0].trim(), p[1].trim()] : null; }
        return Array.isArray(fx) && fx.length === 2 ? [String(fx[0]), String(fx[1])] : null;
      }
      var estadoH = {};
      dias.forEach(function (d) {
        var faixas = ((horarios && horarios[d[0]]) || []).map(faixaPar).filter(Boolean).slice(0, 2);
        estadoH[d[0]] = { aberto: faixas.length > 0, turnos: faixas.length ? faixas : [['18:00', '23:00']] };
      });

      var caixa = el('div', { class: 'horarios' });
      function relogio(valor, aoMudar) {
        var i = el('input', { type: 'time', value: valor, step: '300', required: true });
        i.addEventListener('change', function () { aoMudar(i.value); });
        return i;
      }
      function desenharDia(dia) {
        var e = estadoH[dia];
        var linha = el('div', { class: 'dia-linha' + (e.aberto ? '' : ' fechado') });
        var chave = el('button', { type: 'button', class: 'chave' + (e.aberto ? ' on' : ''), 'aria-label': (e.aberto ? 'Fechar ' : 'Abrir ') + nomes[dia] });
        chave.addEventListener('click', function () { e.aberto = !e.aberto; redesenhar(dia); });
        /* no celular a acao do 2o turno mora no cabecalho, do lado da chave: as linhas de hora ficam so com hora */
        var acao = !e.aberto ? null : el('button', { type: 'button', class: 'dia-acao' + (e.turnos.length > 1 ? ' tirar' : ''), 'aria-label': (e.turnos.length > 1 ? 'Tirar o 2º turno de ' : 'Adicionar 2º turno em ') + nomes[dia], text: e.turnos.length > 1 ? '✕ 2º turno' : '+ 2º turno', onclick: function () {
          if (e.turnos.length > 1) e.turnos.splice(1, 1); else e.turnos.push(['18:00', '23:00']);
          redesenhar(dia);
        } });
        linha.appendChild(el('div', { class: 'dia-cabeca' }, [el('b', { class: 'dia-nome', text: nomes[dia] }), chave, el('span', { class: 'dia-estado', text: e.aberto ? 'Aberto' : 'Fechado' }), acao]));
        if (e.aberto) {
          var turnos = el('div', { class: 'turnos' + (e.turnos.length > 1 ? ' dois' : '') });
          e.turnos.forEach(function (t, i) {
            var turno = el('div', { class: 'turno' }, [
              el('span', { class: 'muted', text: i === 0 ? 'das' : 'e das' }),
              relogio(t[0], function (v) { t[0] = v; }),
              el('span', { class: 'muted', text: 'até' }),
              relogio(t[1], function (v) { t[1] = v; }),
              i === 1 ? el('button', { type: 'button', class: 'btn btn-fantasma btn-mini', 'aria-label': 'Tirar o segundo turno', text: '✕', onclick: function () { e.turnos.splice(1, 1); redesenhar(dia); } }) : null,
            ]);
            turnos.appendChild(turno);
          });
          linha.appendChild(turnos);
          if (e.turnos.length < 2) linha.appendChild(el('button', { type: 'button', class: 'btn btn-fantasma btn-mini dia-mais', title: 'Adicionar 2º turno (para quem abre no almoço e na janta)', 'aria-label': 'Adicionar 2º turno em ' + nomes[dia], html: '<span class="mais-sinal">+</span><span class="mais-texto"> 2º turno</span>', onclick: function () { e.turnos.push(['18:00', '23:00']); redesenhar(dia); } }));
        }
        return linha;
      }
      var linhas = {};
      function redesenhar(dia) {
        var nova = desenharDia(dia);
        linhas[dia].replaceWith(nova);
        linhas[dia] = nova;
      }
      dias.forEach(function (d) { linhas[d[0]] = desenharDia(d[0]); caixa.appendChild(linhas[d[0]]); });
      caixa.appendChild(el('div', { class: 'linha-botoes', style: { marginTop: '10px' } }, [
        el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', text: '📋 Repetir a segunda', title: 'Copia o horário de segunda para todos os outros dias', onclick: function () {
          var base = estadoH.seg;
          dias.forEach(function (d) { if (d[0] !== 'seg') { estadoH[d[0]] = { aberto: base.aberto, turnos: base.turnos.map(function (t) { return [t[0], t[1]]; }) }; redesenhar(d[0]); } });
          UI.avisar('Segunda copiada para os outros dias. Ajuste o que for diferente.');
        } }),
      ]));
      var bloco = el('div', { class: 'campo largo' }, [
        el('label', { text: 'Horário de cada dia' }),
        el('p', { class: 'ajuda', text: 'Fecha depois da meia-noite? Coloque "até 01:00" que o sistema entende. Abre no almoço e na janta? Use o 2º turno.' }),
        caixa,
      ]);
      bloco.valor = function (silencioso) {
        var saida = {};
        var erro = null;
        dias.forEach(function (d) {
          var e = estadoH[d[0]];
          saida[d[0]] = [];
          if (!e.aberto) return;
          e.turnos.forEach(function (t) {
            if (!/^\d{2}:\d{2}$/.test(t[0]) || !/^\d{2}:\d{2}$/.test(t[1])) { erro = erro || ('Preencha o horário de ' + nomes[d[0]].toLowerCase() + ' (de e até).'); return; }
            if (t[0] === t[1]) { erro = erro || ('Em ' + nomes[d[0]].toLowerCase() + ' o horário de abrir e fechar está igual.'); return; }
            /* fecha "antes" de abrir: madrugada (ate 06:00) e normal; depois disso parece invertido */
            if (t[1] < t[0] && t[1] > '06:00') { erro = erro || ('Em ' + nomes[d[0]].toLowerCase() + ' o horário parece invertido (das ' + t[0] + ' até ' + t[1] + '). Se fecha de madrugada, tudo bem até 06:00.'); return; }
            saida[d[0]].push([t[0], t[1]]);
          });
        });
        if (erro) { if (!silencioso) UI.avisar(erro); return null; }
        return saida;
      };
      return bloco;
    }

    /* minutos: inteiro entre 1 e 240; vazio ou invalido volta pro padrao */
    function minutos(v, padrao) {
      var n = Math.round(Number(v));
      if (!n || n < 1) return padrao;
      return Math.min(240, n);
    }

    function salvarAjustes(f) {
      /* com "fechar sozinha" desligado, um horario mal preenchido nao trava o resto dos ajustes */
      var usaHorarios = f.usarHorarios.chave.ligado;
      var horarios = usaHorarios ? lerHorarios(f) : (f.horarios.valor(true) || estado.loja.horarios || {});
      if (!horarios) return;
      var tokenDigitado = f.mpToken.input.value.trim();
      var aceitaPix = f.mpAtivo.chave.ligado;
      /* Pix que ja estava ligado so passa sem token enquanto a leitura da conexao nao respondeu (ela pode atrasar).
         Depois que respondeu sem token, trava: loja com Pix ligado e sem token nao recebe Pix nenhum. */
      var aindaLendo = estado.loja.mpAtivo === true && !f.mpToken.lido;
      if (aceitaPix && !tokenDigitado && !f.mpToken.temSalvo && !aindaLendo) return UI.avisar('Cole o Access Token do Mercado Pago ou desligue o Pix.');
      var mudancas = {
        nome: f.nome.input.value.trim() || estado.loja.nome,
        tipo: f.tipo.input.value.trim(),
        emoji: f.emoji.input.value.trim() || '🍔',
        cor: f.cor.valor(),
        estilo: f.estilo.valor(),
        descricao: f.descricao.input.value.trim(),
        avisoTopo: f.avisoTopo.input.value.trim(),
        cidade: (f.cidade.valor() || { nome: estado.loja.cidade }).nome,
        cidadeSlug: R.slug((f.cidade.valor() || { nome: estado.loja.cidade }).nome),
        uf: (f.cidade.valor() || { uf: estado.loja.uf }).uf,
        endereco: f.endereco.input.value.trim(),
        whatsapp: f.whatsapp.input.value.replace(/\D/g, ''),
        cnpj: R.cnpjValido(f.cnpj.input.value),
        instagram: f.instagram.input.value.trim().replace(/^@/, ''),
        googleUrl: R.linkGoogle(f.google.input.value),
        aberta: f.aberta.chave.ligado,
        usarHorarios: f.usarHorarios.chave.ligado,
        horarios: horarios,
        aceitaEntrega: f.aceitaEntrega.chave.ligado,
        aceitaRetirada: f.aceitaRetirada.chave.ligado,
        freteGratis: f.frete.valor() === 'gratis',
        taxaEntrega: f.taxaEntrega.centavos(),
        entregaGratisAcima: f.entregaGratisAcima.centavos(),
        pedidoMinimo: f.pedidoMinimo.centavos(),
        tempoPreparo: minutos(f.tempoPreparo.input.value, 20),
        tempoEntrega: minutos(f.tempoEntrega.input.value, 40),
        aceitaPix: aceitaPix,
        mpAtivo: aceitaPix,
        aceitaCartaoEntrega: f.aceitaCartaoEntrega.chave.ligado,
        aceitaDinheiroEntrega: f.aceitaDinheiroEntrega.chave.ligado,
        aceitaPagarNoBalcao: f.aceitaPagarNoBalcao.chave.ligado,
        permitePersonalizar: f.permitePersonalizar.chave.ligado,
        mostrarOutras: f.mostrarOutras.chave.ligado,
      };
      var logo = f.logo.valor();
      if (logo.dados) { mudancas.logoDados = logo.dados; mudancas.logoUrl = ''; }
      else if (logo.removida) { mudancas.logoDados = ''; mudancas.logoUrl = ''; }
      if (f.cnpj.input.value.trim() && !mudancas.cnpj) { f.cnpj.input.focus(); return UI.avisar('Esse CNPJ não confere. Veja se digitou os 14 números certos, ou deixe o campo vazio.'); }
      if (f.google.input.value.trim() && !mudancas.googleUrl) { f.google.input.focus(); return UI.avisar('Esse link não é do Google. No Google Maps, abra sua loja, toque em Compartilhar e cole o link aqui.'); }
      if (!mudancas.aceitaEntrega && !mudancas.aceitaRetirada) return UI.avisar('Ligue entrega ou retirada, senão ninguém consegue pedir.');
      if (mudancas.aceitaEntrega && !mudancas.freteGratis && mudancas.taxaEntrega <= 0) return UI.avisar('Taxa de entrega em branco. Coloque o valor ou marque "Entrega grátis".');
      if (mudancas.aceitaEntrega && !mudancas.freteGratis && mudancas.entregaGratisAcima > 0 && mudancas.entregaGratisAcima <= mudancas.taxaEntrega) return UI.avisar('"Grátis a partir de" precisa ser maior que a taxa de entrega.');
      var novaSenha = f.senhaPainel ? f.senhaPainel.input.value.trim() : '';
      if (novaSenha && novaSenha.length < 4) return UI.avisar('A senha do painel precisa ter pelo menos 4 caracteres.');
      if (novaSenha) mudancas.senhaPainel = novaSenha;
      /* Campo igual ao que estava na tela nao vai: assim nao apaga o que mudou em outro aparelho enquanto isso. */
      var original = f.original || {};
      Object.keys(mudancas).forEach(function (k) { if (k !== 'senhaPainel' && JSON.stringify(mudancas[k]) === JSON.stringify(original[k])) delete mudancas[k]; });
      /* Token do Mercado Pago: segredo, fora do documento da loja. So grava se a pessoa digitou algo. */
      var tokenMP = f.mpToken.input.value.trim();
      if (tokenMP && !/^(APP_USR-|TEST-)/.test(tokenMP) && !(D.modoDemo && tokenMP === 'SIMULACAO')) {
        /* para aqui: salvar assim ligaria o Pix sem token nenhum */
        return UI.avisar('Esse token não parece do Mercado Pago: o de produção começa com APP_USR-. Confira em Credenciais › Produção.');
      }
      /* token primeiro: o Pix so liga na loja depois que o segredo ficou guardado */
      var passo = Promise.resolve();
      if (tokenMP && window.LigeiroMP) {
        passo = window.LigeiroMP.guardarToken(slug, tokenMP)
          .catch(function () { throw new Error('Não deu para guardar o token do Mercado Pago. Confira a internet e tente de novo.'); })
          .then(function () { if (estado.loja.mpAtivo) ligarMP(); });
      }

      /* Capa: e uma foto grande, vai num documento separado (igual as fotos dos produtos). */
      var capa = f.capa.valor();
      var capaAntiga = estado.loja.capa;
      if (capa.dados) {
        var idCapa = 'capa-' + D.idAleatorio(8);
        passo = passo.then(function () { return store.salvarFoto(slug, idCapa, capa.dados); }).then(function () {
          mudancas.capa = idCapa;
          mudancas.capaUrl = '';
          if (capaAntiga) return store.excluirFoto(slug, capaAntiga).catch(function () { /* ignora */ });
        });
      } else if (capa.removida) {
        mudancas.capa = '';
        mudancas.capaUrl = '';
        if (capaAntiga) passo = passo.then(function () { return store.excluirFoto(slug, capaAntiga).catch(function () { /* ignora */ }); });
      }
      passo.then(function () { return salvarLoja(mudancas, 'Ajustes salvos'); })
        .then(function () { window.scrollTo(0, 0); desenharAjustes(); })
        .catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu para salvar. Tente de novo.'); });
    }

    function novoCupom() {
      var codigo = campoTexto('Código', '', { max: 20, placeholder: 'Ex: BEMVINDO' });
      var percentual = campoTexto('Desconto em %', '10', { tipo: 'number' });
      var minimo = campoDinheiro('Vale a partir de', 0, 'Vazio = qualquer valor');
      var limite = campoTexto('Quantas vezes pode ser usado', '', { tipo: 'number', placeholder: 'vazio = sem limite' });
      UI.abrirModal({ titulo: 'Novo cupom', corpo: el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [codigo, percentual, minimo, limite]), rodape: [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Criar cupom', onclick: function () {
        var cod = R.semAcento(codigo.input.value).toUpperCase().replace(/[^A-Z0-9]/g, '');
        var pct = Number(percentual.input.value);
        if (cod.length < 3) return UI.avisar('Código com pelo menos 3 letras ou números.');
        if (!(pct >= 1 && pct <= 100)) return UI.avisar('Desconto entre 1 e 100.');
        var antigo = (estado.loja.cupons || []).filter(function (c) { return c.codigo === cod; })[0];
        var lista = (estado.loja.cupons || []).filter(function (c) { return c.codigo !== cod; });
        lista.push({ codigo: cod, percentual: pct, minimo: minimo.centavos(), limite: Number(limite.input.value) || 0, usos: antigo ? (antigo.usos || 0) : 0, ativo: true });
        /* codigo novo (ou de um cupom excluido): zera o contador antigo antes, senao o cupom nasce esgotado.
           Se o banco recusar (regra antiga), segue e cria do mesmo jeito. */
        var zerar = antigo || !store.zerarUsosDoCupom ? Promise.resolve() : store.zerarUsosDoCupom(slug, cod).catch(function () { /* ignora */ });
        zerar.then(function () { return salvarLoja({ cupons: lista }, 'Cupom ' + cod + (antigo ? ' atualizado' : ' criado')); }).then(function () { UI.fecharModal(); desenharAjustes(); });
      } })] });
    }

    /* ---------------------------------------------------------- links */
    /* Aba "Minha loja": as telas da equipe (cozinha e entregador) e o material pra divulgar. */
    function desenharLinks() {
      var s = $('secaoPainel');
      UI.limpar(s);
      var l = estado.loja;
      var linkLoja = UI.linkDaLoja(l);
      var linkPainel = UI.linkDoPainel(l);
      var base = UI.baseUrl();

      function copiar(texto, aviso) { return function () { UI.copiar(texto).then(function () { UI.avisar(aviso || 'Link copiado.'); }); }; }
      function tela(icone, titulo, texto, link, abrir) {
        return el('div', { class: 'tela-card' }, [
          el('span', { class: 'icone', text: icone }),
          el('b', { text: titulo }),
          el('p', { text: texto }),
          el('div', { class: 'linha-botoes' }, [
            el('a', { class: 'btn btn-principal btn-pequeno', href: link, target: '_blank', rel: 'noopener', text: abrir || 'Abrir' }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📋 Copiar link', onclick: copiar(link) }), /* fila .tela-acoes: duas metades iguais */
          ]),
        ]);
      }

      /* 1. telas */
      s.appendChild(el('h2', { text: 'Minha loja' }));
      s.appendChild(el('p', { class: 'muted', text: 'Cada tela abre em outra aba, sem fechar o painel. As duas usam a senha da equipe, que você define aqui embaixo.' }));
      s.appendChild(el('div', { class: 'telas-grade' }, [
        tela('👨‍🍳', 'Cozinha', 'Fila do dia em letra grande, apita quando entra pedido. Num tablet ou celular velho na cozinha.', base + '#/cozinha/' + l.slug),
        tela('🛵', 'Entregador', 'No celular do motoboy: endereço, o que cobrar, mapa, WhatsApp do cliente e "entregue".', base + '#/entrega/' + l.slug),
      ]));
      s.appendChild(el('p', { class: 'muted pequeno linha-painel-link' }, [
        'Este painel em outro aparelho: ',
        el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📋 Copiar link do painel', onclick: copiar(linkPainel, 'Link do painel copiado.') }),
      ]));
      s.appendChild(el('div', { class: 'bloco-form senha-equipe' }, [
        el('div', { class: 'senha-equipe-texto' }, [
          el('div', { class: 'bloco-titulo', text: '🔑 Senha da equipe' }),
          el('p', { class: 'muted pequeno', text: 'Cozinha e entregador abrem com ela (6 a 8 números). Você, logado, entra sem senha. Esqueceu? É só definir outra.' }),
        ]),
        el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: estado.loja.senhaEquipeEm ? 'Trocar a senha' : 'Definir a senha', onclick: function () { window.LigeiroEquipe.definirSenha(estado.loja); } }),
      ]));

      /* 2. divulgar */
      var msgWhats = 'Olá! 😊 Faça seu pedido pelo nosso ' + R.catalogo(estado.loja).nome + ': ' + linkLoja + ' — é rápido, você paga no Pix e acompanha pela senha.';
      var qr = el('div', { class: 'qr-caixa', style: { width: '180px', margin: '0', flex: 'none' } });
      Pix.desenharQr(qr, linkLoja, 180);
      s.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Divulgar o ' + R.catalogo(estado.loja).nome }),
        el('p', { class: 'muted pequeno', text: 'Coloque o link na bio do Instagram, no status e na mensagem automática do WhatsApp. Imprima o QR e cole no balcão e na sacola.' }),
        el('div', { class: 'divulgar' }, [
          qr,
          el('div', { class: 'pilha divulgar-acoes' }, [
            el('div', { class: 'caixa-link', text: linkLoja }),
            el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: '📋 Copiar link do ' + R.catalogo(estado.loja).nome, onclick: copiar(linkLoja) }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '💬 Copiar a mensagem', onclick: copiar(msgWhats, 'Mensagem copiada. No WhatsApp Business: Ferramentas > Mensagem de saudação.') }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📄 Copiar ' + R.catalogo(estado.loja).nome + ' em texto', onclick: function () { UI.copiar(R.cardapioEmTexto(estado.loja, linkLoja)).then(function () { UI.avisar(R.catalogo(estado.loja).Nome + ' copiado. Cole no WhatsApp.'); }); } }),
          ]),
        ]),
      ]));
      s.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Resposta automática grátis no WhatsApp' }),
        el('p', { text: 'No WhatsApp Business, vá em Ferramentas comerciais > Mensagem de saudação e cole a mensagem com o seu link. Quem mandar "oi" já recebe o ' + R.catalogo(estado.loja).nome + ' na hora, sem robô pago.' }),
      ]));
    }

    return function () { vivo = false; pararTudo(); lojaViva.parar(); UI.limparTemaOficial(raiz); };
  }

  window.LigeiroPainel = { abrir: abrir };
})();
