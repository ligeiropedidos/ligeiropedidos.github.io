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
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [el('div', { class: 'icone' }, [UI.iconeLinha('busca')]), el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' })]));
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
        if (ok) { marcarLogado(true); entrarComPapel(); publicarSeDono(); } else telaLogin();
      }).catch(function () { if (vivo) telaLogin(); });
    });

    /* Senha da equipe: o painel vira so a fila (o banco so deixa a equipe andar com os pedidos; assinatura, cardapio,
       ajustes e Minha conta dariam erro). O dono entra com a conta dele e ve tudo. */
    function entrarComPapel() {
      var qual = D.modoDemo || !store.usuarioAtual ? Promise.resolve(null) : store.usuarioAtual().catch(function () { return null; });
      qual.then(function (u) {
        if (!vivo) return;
        estado.equipe = !!(u && /@equipe\.ligeiro\.app\.br$/i.test(String(u.email || '')));
        if (estado.equipe) estado.aba = 'pedidos';
        montarPainel();
      });
    }

    /* o dono abriu o painel: a copia da loja na borda (o que o cliente ve) fica igual ao banco, mesmo que algo
       tenha mudado por fora (pagamento confirmado, Pix conectado). Uma leitura por abertura, so para o dono */
    function publicarSeDono() {
      if (!store.publicarLoja || !store.usuarioAtual || !estado.loja) return;
      store.usuarioAtual().then(function (u) {
        if (!(u && u.email && u.email === String(estado.loja.donoEmail || '').toLowerCase())) return;
        store.publicarLoja(slug);
        /* marca de dono no login (uma vez por loja): a fila passa a custar 1 leitura por pedido que anda, nao 2 */
        if (store.marcarDono) store.marcarDono(slug);
      }).catch(function () { /* segue */ });
    }

    /* Fotos (produtos e capa): baixa uma vez e so de novo quando alguma mudar. */
    function carregarFotos(loja) {
      var versao = loja.fotosVersao || '';
      if (estado.fotosVersao === versao) return Promise.resolve(false);
      return store.listarFotos(slug, versao, loja).then(function (mapa) {
        estado.fotos = mapa || {};
        estado.fotosVersao = versao;
        /* produto apontando pra foto que nao existe mais (a troca parou no meio): volta pro emoji. Sem isso o site acharia
           o pacote incompleto e leria foto por foto a cada visita. Sempre sobre a loja de AGORA (a que chegou pela escuta
           pode ser uma versao de antes da ultima edicao) e nunca com uma troca de foto no meio: regravar a lista velha
           desfazia a edicao (preco antigo de volta, item excluido de volta) */
        var atual = estado.loja || loja;
        var mesmaVersao = (atual.fotosVersao || '') === versao;
        var leuTudo = !store.leuTodasAsFotos || store.leuTodasAsFotos(slug);
        var soltas = leuTudo && mesmaVersao && !estado.fotoEmTroca ? (atual.produtos || []).filter(function (p) { return p && p.foto && !estado.fotos[p.foto]; }) : [];
        if (soltas.length) {
          var limpos = (atual.produtos || []).map(function (p) { return p && p.foto && !estado.fotos[p.foto] ? Object.assign({}, p, { foto: '' }) : p; });
          salvarLoja({ produtos: limpos }).catch(function () { /* tenta de novo na proxima vez */ });
          loja = Object.assign({}, atual, { produtos: limpos });
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
          cfgL.whatsappLigeiro ? el('a', { class: 'btn btn-whats btn-largo', href: R.linkWhatsapp(cfgL.whatsappLigeiro, 'Oi! Quero ligar o painel da ' + estado.loja.nome + '.'), target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'Chamar o Ligeiro']) : null,
          el('button', { class: 'btn btn-fantasma btn-largo', text: 'Ver a loja como cliente', onclick: function () { window.LigeiroApp.ir(estado.loja.cidadeSlug + '/' + slug); } }),
        ]));
        return;
      }
      var campo = el('input', { type: 'password', inputmode: 'numeric', placeholder: '••••••', autocomplete: 'current-password', 'aria-label': D.modoDemo ? 'Senha do painel' : 'Senha da equipe' });
      var erro = el('div', { class: 'msg-erro', hidden: true });
      /* o dono entra com o Google (a conta dele); a senha de numeros e a da equipe (cozinha, entregador, balcao) */
      var dono = D.modoDemo || !store.entrarComGoogle ? null : el('button', { class: 'btn btn-google btn-largo', type: 'button', text: 'Dono: entrar com o Google', onclick: function (ev) {
        var b = ev.currentTarget;
        b.disabled = true;
        store.entrarComGoogle().then(function (u) {
          if (!u || !vivo) return null;
          return store.donoLogado(estado.loja).then(function (ehDono) {
            if (!vivo) return;
            if (!ehDono) { if (store.sair) store.sair(); UI.soar('erro'); erro.hidden = false; erro.textContent = 'Essa conta do Google não é a dona desta loja. Entre com a conta que criou a loja.'; return; }
            marcarLogado(true);
            entrarComPapel();
            publicarSeDono();
          });
        }).catch(function (e) { if (vivo) { erro.hidden = false; erro.textContent = D.erroAmigavel(e, 'Não deu para entrar com o Google agora.'); } }).then(function () { b.disabled = false; });
      } });
      var letras = D.modoDemo ? null : el('button', { class: 'login-letras', type: 'button', text: 'Minha senha tem letras', onclick: function (ev) { campo.setAttribute('inputmode', 'text'); ev.currentTarget.hidden = true; campo.focus(); } });
      var caixa = el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: 'Painel · ' + estado.loja.nome }),
        dono,
        el('p', { class: 'centro muted', text: D.modoDemo ? (estado.loja.senhaPainel === '1234' ? 'Digite a senha do painel. Na demonstração é 1234.' : 'Digite a senha do painel.') : 'Equipe (cozinha, entregador): digite a senha da equipe.' }),
        el('div', { class: 'campo' }, campo),
        erro,
        el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar }),
        letras,
        el('button', { class: 'btn btn-fantasma btn-largo', text: 'Ver a loja como cliente', onclick: function () { window.LigeiroApp.ir(estado.loja.cidadeSlug + '/' + slug); } }),
      ]);
      function entrar() {
        store.entrarPainel(slug, campo.value).then(function (ok) {
          if (!vivo) return; /* saiu da tela enquanto o login respondia */
          if (!ok) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Senha errada. Tente de novo.'; campo.value = ''; campo.focus(); return; }
          marcarLogado(true);
          entrarComPapel();
        }, function (e) {
          /* ex.: dono com e-mail ainda nao conferido (o aviso diz o que fazer) */
          if (!vivo) return;
          UI.soar('erro'); erro.hidden = false; erro.textContent = D.erroAmigavel(e, 'Não deu para entrar agora. Tente de novo.');
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
        var querCartao = !!UI.lerLocal('ligeiro:ligar-cartao:' + slug);
        UI.guardarLocal('ligeiro:ligar-cartao:' + slug, null);
        setTimeout(function () {
          if (mpVolta === 'ok' && querCartao && estado.loja && estado.loja.mpChavePublica) {
            salvarLoja({ aceitaCartaoOnline: true, mpAtivo: true }, 'Cartão de crédito ligado! O cliente já vê a opção no seu site.').then(function () { if (estado.aba === 'ajustes') desenharAjustes(); }).catch(function () { UI.avisar('Mercado Pago conectado. Ligue o cartão em Ajustes, Pagamento.'); });
            UI.soar('sucesso');
            return;
          }
          if (mpVolta === 'ok') { UI.soar('sucesso'); UI.avisar('Mercado Pago conectado! Pix ligado. O cartão liga com um toque em Pagamento.'); }
          else UI.avisar('O Mercado Pago não autorizou. Tente de novo em Ajustes, Pagamento.');
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
        site: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>',
      };
      function rotuloTopo(botao, icone, longo, curto) {
        UI.limpar(botao);
        botao.appendChild(el('span', { class: 'topo-ico', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + ICONES_TOPO[icone] + '</svg>' }));
        botao.appendChild(el('span', { class: 'rot-longo', text: longo }));
        botao.appendChild(el('span', { class: 'rot-curto', text: curto }));
        return botao;
      }
      /* um botao so para o apito: "Ligar" (com o pontinho) ate o navegador liberar o som no primeiro toque; depois liga e desliga */
      function pintarSom() {
        var travado = UI.somTravado();
        var longo = travado ? 'Toque para ligar o apito' : estado.somLigado ? 'Apito ligado' : 'Apito desligado';
        rotuloTopo(btnSom, estado.somLigado ? 'sino' : 'semsino', longo, travado ? 'Ligar' : 'Apito');
        btnSom.setAttribute('aria-label', longo);
        btnSom.classList.toggle('pedindo', travado);
        if (travado) UI.quandoLiberarSom(pintarSom);
      }
      var btnSom = el('button', { class: 'btn btn-pequeno' + (estado.somLigado ? ' on' : ''), onclick: function () {
        if (UI.somAcabouDeLiberar()) { pintarSom(); UI.soar('apito'); return; } /* esse toque so liberou o som */
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
        UI.avisar(estado.impressaoAuto ? 'Cada pedido novo vai sair na impressora deste aparelho.' : 'Impressão só pelo botão de imprimir de cada pedido.');
      } });
      pintarImp();
      /* No celular nao existe impressao silenciosa: o botao so aparece em tela grande (computador do caixa). */
      if (navigator.maxTouchPoints > 0 && window.innerWidth < 900) btnImp.hidden = true;
      raiz.appendChild(el('header', { class: 'painel-topo topo-app' + (topoComTema ? '' : ' topo-ligeiro') }, [
        (UI.lojaOficial(slug) && UI.lojaOficial(slug).logo) ? el('img', { class: 'logo-mini', src: UI.lojaOficial(slug).logo, alt: '' }) : null,
        el('div', { class: 'nome', text: estado.loja.nome }),
        el('div', { class: 'painel-topo-acoes' }, [
          rotuloTopo(el('a', { class: 'btn btn-pequeno', href: '#/' + estado.loja.cidadeSlug + '/' + slug, target: '_blank', rel: 'noopener', title: 'Abre o site da loja em outra aba, do jeito que o cliente vê' }), 'site', 'Ver site', 'Site'),
          estado.equipe ? null : rotuloTopo(el('a', { class: 'btn btn-pequeno', href: '#/conta', title: 'Suas lojas e sua assinatura' }), 'conta', 'Minha conta', 'Conta'),
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

      var abas = el('nav', { class: 'abas-painel abas-principais' });
      /* abas com icone de traco (o desenho do topo), no lugar dos emojis */
      /* no celular as cinco cabem numa linha (icone em cima, nome curto embaixo), como o topo: antes Ajustes e Minha loja ficavam fora da tela */
      /* no celular o nome curto: "Menu" (comida) ou "Itens" (outras lojas); no PC continua Cardapio ou Catalogo */
      var defs = [['pedidos', 'Pedidos', 'lista'], ['cardapio', R.catalogo(estado.loja).Nome, 'cardapio', R.catalogo(estado.loja).comida ? 'Menu' : 'Itens'], ['vendas', 'Vendas', 'vendas'], ['ajustes', 'Ajustes', 'ajustes'], ['links', 'Minha loja', 'loja', 'Loja']];
      /* equipe: so a fila (sem as abas) */
      if (estado.equipe) { defs = defs.slice(0, 1); abas.hidden = true; }
      defs.forEach(function (d) {
        var b = el('button', { class: 'aba-painel' + (estado.aba === d[0] ? ' ativa' : ''), dataset: { aba: d[0] }, onclick: function () { trocarAba(d[0]); } }, [UI.iconeLinha(d[2]), el('span', { class: 'rot-longo', text: d[1] }), el('span', { class: 'rot-curto', text: d[3] || d[1] })]);
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
      /* A fila escuta SO o que esta andando (aguardando, pago, preparando, pronto). O celular que volta do bloqueio
         depois de 30 min rele so esses (antes relia todos os pedidos do dia, ate 150 leituras por volta). Concluidos
         e cancelados do dia vem quando o dono abre a lista; o que ficou andando de outros dias vem na mesma escuta */
      estado.deOutrosDias = [];
      estado.encerrados = null;
      var ATIVOS = [R.STATUS.AGUARDANDO, R.STATUS.PAGO, R.STATUS.PRODUCAO, R.STATUS.PRONTO];
      /* a escuta da fila se refaz: dia novo (sem recarregar) e volta do limite do banco */
      var pararFila = function () {};
      var filaNoLimite = false;
      function assinarFila() {
        pararFila();
        pararFila = store.assistirPedidos(slug, function (listaToda) {
        if (filaNoLimite || raiz.querySelector('.faixa-limite')) { filaNoLimite = false; var fx = raiz.querySelector('.faixa-limite'); if (fx) fx.remove(); }
        /* do dia de trabalho, na fila; de outros dias, o aviso de concluir todos (Pix velho so passa pelo vencimento) */
        var lista = [], velhos = [], pixVelhos = [];
        listaToda.forEach(function (x) {
          if (String(x.criadoEm || '') >= desde) lista.push(x);
          else if (x.status === R.STATUS.AGUARDANDO) pixVelhos.push(x);
          else velhos.push(x);
        });
        estado.deOutrosDias = velhos;
        if (pixVelhos.length) conferirPixVencidos(pixVelhos);
        /* saiu da fila (concluido ou cancelado): a versao nova ja veio junto com a escuta e esta no aparelho */
        if (estado.statusAntes) {
          var naFila = {};
          lista.forEach(function (x) { naFila[x.id] = true; });
          Object.keys(estado.statusAntes).forEach(function (id) {
            if (naFila[id] || ATIVOS.indexOf(estado.statusAntes[id]) < 0) return;
            estado.statusAntes[id] = 'fora';
            if (!store.pedidoDoCache) return;
            store.pedidoDoCache(slug, id).then(function (x) {
              if (!x || !vivo || ATIVOS.indexOf(x.status) >= 0) return;
              estado.statusAntes[id] = x.status;
              if (estado.encerrados) estado.encerrados[id] = x;
              if (x.status === R.STATUS.CANCELADO && x.canceladoPor === 'cliente') {
                UI.soar('cancelado');
                UI.avisar('O cliente cancelou o pedido da senha ' + x.senha + '.');
              }
              if (estado.aba === 'pedidos') desenharPedidos();
            });
          });
        }
        var novos = [];
        if (estado.conhecidos) {
          lista.forEach(function (p) { if (!estado.conhecidos[p.id] && R.EM_ANDAMENTO.indexOf(p.status) >= 0 && p.status !== R.STATUS.PRODUCAO && p.status !== R.STATUS.PRONTO) novos.push(p.id); });
        }
        /* o que mudou desde a ultima vez: Pix que caiu e pedido que o cliente cancelou ganham som proprio */
        if (estado.statusAntes) {
          lista.forEach(function (p) {
            var antes = estado.statusAntes[p.id];
            if (!antes || antes === p.status) return;
            if (p.status === R.STATUS.PAGO && (antes === R.STATUS.AGUARDANDO || antes === R.STATUS.CANCELADO || (antes === 'fora' && p.pagoAposCancelar)) && R.pagaPeloSite(p)) {
              UI.soar('pago'); UI.vibrar([80, 40, 160]);
              var comoPagou = p.formaPagamento === 'cartao_online' ? 'Cartão da senha ' + p.senha + ' aprovado' : 'Pix da senha ' + p.senha + ' caiu';
              UI.avisar(p.pagoAposCancelar ? comoPagou + ' depois do cancelamento. Confira com o cliente.' : comoPagou + '! Pode começar.');
            } else if (p.status === R.STATUS.CANCELADO && p.canceladoPor === 'cliente') {
              UI.soar('cancelado');
              UI.avisar('O cliente cancelou o pedido da senha ' + p.senha + '.');
            }
          });
        }
        /* guarda tambem quem saiu da fila: um cancelado que foi pago depois volta e apita como Pix que caiu */
        estado.statusAntes = estado.statusAntes || {};
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
      }, { status: ATIVOS, aoErro: function (e) {
        /* banco gratis no limite de hoje: nao e o login. Os clientes vao para o WhatsApp da loja ate zerar; o relogio
           tenta de novo a cada 10 min (a escuta que deu erro morre) */
        if (D.ehLimite && D.ehLimite(e)) { filaNoLimite = true; estado.filaTentouEm = Date.now(); UI.faixaLimite(raiz); return; }
        /* o banco recusou a fila: a conta saiu (ou caiu). Volta pro login em vez de ficar mostrando "nenhum pedido".
           Recarrega uma vez so; se recusar de novo, mostra que a conta nao tem acesso */
        pararZerar();
        marcarLogado(false);
        if (!podeRecarregar()) { telaSemAcesso(); return; }
        UI.avisar('Sua sessão caiu. Entre de novo.');
        /* token novo antes de recarregar: pega e-mail recem conferido ou permissao nova */
        var token = store.obterIdToken ? store.obterIdToken(true) : Promise.resolve();
        token.catch(function () { /* sem conta: a recarga pede a senha */ }).then(function () { setTimeout(function () { location.reload(); }, 1200); });
      } });
      }
      assinarFila();
      estado.parar.push(function () { pararFila(); });
      /* cancelado com o dinheiro pago pelo site (a loja cancelou, ou pagou depois de cancelado): lista pequena propria,
         de qualquer dia, ate devolver. So o dono devolve */
      estado.aDevolver = [];
      if (!estado.equipe) estado.parar.push(store.assistirPedidos(slug, function (l) {
        /* o devolvido sai daqui e volta para "Cancelados hoje" ja na versao nova (sem o botao) */
        if (estado.encerrados) l.forEach(function (p) { if (estado.encerrados[p.id]) estado.encerrados[p.id] = p; });
        estado.aDevolver = l.filter(pagoPeloSite);
        if (estado.aba === 'pedidos') desenharPedidos();
      }, { devolver: true }));

      /* avisos com a tela apagada: o mensageiro ja tem? (o cartao aparece so depois) e o aparelho continua inscrito? */
      if (window.LigeiroAvisos) {
        var semAvisos = window.LigeiroAvisos.situacao() === 'sem';
        window.LigeiroAvisos.preparar().then(function (sit) {
          if (semAvisos && sit !== 'sem' && vivo && estado.aba === 'pedidos') desenharCabecaPedidos();
          window.LigeiroAvisos.conferirAparelho(slug, 'painel');
          window.LigeiroAvisos.vigiar(slug, 'painel');
        });
      }
      /* Pix automatico (Mercado Pago), se a loja ligou */
      ligarMP();
      /* assinatura da conta do dono (o cartao redesenha quando chegar) */
      carregarConta().then(function () { if (estado.aba === 'pedidos') desenharCabecaPedidos(); });

      /* "ha 3 min" precisa andar mesmo sem pedido novo */
      var relogio = setInterval(function () {
        /* painel aberto de um dia para o outro (o PC do caixa): virou o dia de trabalho e nao ha pedido andando, a fila
           passa a contar do dia novo (sem recarregar: o som liberado pelo toque continua valendo). Com pedido andando,
           espera o proximo minuto */
        var hoje = new Date(); if (hoje.getHours() < 5) hoje.setDate(hoje.getDate() - 1);
        hoje.setHours(5, 0, 0, 0);
        var andando = (estado.pedidos || []).some(function (x) { return R.EM_ANDAMENTO.indexOf(x.status) >= 0; });
        if (hoje.toISOString() !== desde && !andando) { desde = hoje.toISOString(); estado.encerrados = null; assinarFila(); }
        /* banco no limite: tenta de novo a cada 10 min; quando a cota zerar, a fila volta sozinha e a faixa sai */
        else if (filaNoLimite && Date.now() - (estado.filaTentouEm || 0) > 10 * 60 * 1000) { estado.filaTentouEm = Date.now(); assinarFila(); }
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
      /* primeiro o aceite dos termos (se faltar); depois, na primeira vez de uma loja nova, o tutorial */
      setTimeout(function () {
        if (!raiz.isConnected) return;
        pedirAceiteDosTermos(function () {
          if (!estado.equipe && !mpVolta && estado.loja && estado.loja.configurada === false && !UI.lerLocal(CHAVE_TOUR)) abrirTour();
        });
      }, 900);
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

    /* Ajustes mudados e nao salvos: sair da aba (ou ir ao Mercado Pago) perdia tudo sem aviso */
    function ajustesPendentes() { var s = $('secaoPainel'); return estado.aba === 'ajustes' && !!(s && s.querySelector('.salvar-estado.pendente')); }
    function trocarAba(aba) {
      if (ajustesPendentes()) { /* inclusive tocar em Ajustes de novo, que redesenha a aba */
        UI.perguntar('Você mudou os ajustes e ainda não salvou. Sair sem salvar?', { sim: 'Sair sem salvar', nao: 'Voltar para salvar' }).then(function (sim) {
          if (sim) { var s = $('secaoPainel'); var p = s && s.querySelector('.salvar-estado.pendente'); if (p) p.classList.remove('pendente'); trocarAba(aba); }
        });
        return;
      }
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
      var avisoMP = estado.loja.mpAtivo && estado.mpStatus ? el('p', { class: 'aviso', style: { fontSize: '14px' } }, [UI.iconeLinha('raio'), el('span', { text: estado.mpStatus })]) : null;
      /* equipe: sem assinatura, primeiros passos e interruptor da loja (so o dono mexe na loja) */
      var cabeca = el('div', { id: 'cabecaPedidos', class: 'pilha' }, estado.equipe ? [cartaoAvisos()] : [cartaoAssinatura(false), primeirosPassos(), interruptorLoja(), cartaoAvisos(), avisoMP]);
      if (antigo) antigo.replaceWith(cabeca); else s.insertBefore(cabeca, s.firstChild);
    }

    /* ---------------------------------------------------------- avisos com a tela apagada */
    /* Cartao na aba Pedidos ate ligar (ou "Agora nao", que esconde por 7 dias). Depois some: Testar e Desligar ficam em Minha loja. */
    function cartaoAvisos() {
      var A = window.LigeiroAvisos;
      if (!A || A.aparelhoLigado(slug, 'painel')) return null;
      var sit = A.situacao();
      if (sit === 'sem' || (Number(UI.lerLocal('ligeiro:avisos-depois:' + slug)) || 0) > Date.now()) return null;
      var texto = sit === 'instalar' ? 'No iPhone, coloque o painel na tela de início e ligue os avisos por lá. Leva 20 segundos.'
        : sit === 'bloqueado' ? A.motivo('bloqueado')
        : 'Este celular apita quando entra pedido, mesmo com a tela apagada e o painel fechado.';
      var botoes = [];
      if (sit === 'pronto') botoes.push(el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Ligar avisos', onclick: function (e) { ligarAvisos(e.currentTarget); } }));
      if (sit === 'instalar') botoes.push(el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Ver como', onclick: function () { A.explicarIphone(); } }));
      botoes.push(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Agora não', onclick: function () { UI.guardarLocal('ligeiro:avisos-depois:' + slug, Date.now() + 7 * 864e5); desenharCabecaPedidos(); } }));
      return el('div', { class: 'cartao cartao-avisos' }, [
        el('div', { class: 'avisos-linha' }, [
          el('span', { class: 'avisos-ico', 'aria-hidden': 'true', html: A.icone() }),
          el('div', { class: 'avisos-texto' }, [el('b', { text: 'Receba os pedidos com a tela apagada' }), el('span', { text: texto })]),
        ]),
        el('div', { class: 'linha-botoes avisos-botoes' }, botoes),
      ]);
    }
    function ligarAvisos(botao) {
      var A = window.LigeiroAvisos;
      var texto = botao.textContent;
      botao.disabled = true; botao.textContent = 'Ligando…';
      A.ligarAparelho(slug, 'painel').then(function (j) {
        UI.soar('sucesso');
        UI.avisar(j && j.simulado ? 'Avisos ligados (na demonstração é simulado).' : 'Avisos ligados! Chegou um aviso de teste neste celular.');
      }, function (e) {
        botao.disabled = false; botao.textContent = texto;
        if (e && e.motivo === 'instalar') { A.explicarIphone(); return; }
        UI.avisar(D.erroAmigavel(e, 'Não deu para ligar os avisos agora.'));
      }).then(function () {
        if (estado.aba === 'pedidos') desenharCabecaPedidos();
        if (estado.aba === 'links') desenharLinks();
      });
    }
    /* o pedido andou: o celular do cliente (se ele quis), o entregador e a cozinha ficam sabendo. Nada no banco */
    function avisarQueAndou(p, status) {
      if (!window.LigeiroAvisos) return;
      window.LigeiroAvisos.pedidoAndou(slug, p, status).then(function (r) {
        if (r === 'sim') UI.avisar('Cliente avisado no celular.');
        /* o cliente tinha pedido aviso, mas nao chegou (desligou, trocou de celular): a loja avisa pelo WhatsApp */
        else if (r === 'nao') UI.avisar('O aviso não chegou no celular do cliente. Se precisar, avise pelo WhatsApp.');
      });
    }
    /* o WhatsApp do pedido ja mandado neste aparelho (por status), para o botao mostrar "Avisado" */
    function zapMandados() { return UI.lerLocal('ligeiro:zap-mandados') || {}; }
    function marcarZap(id, status) {
      var m = zapMandados();
      m[id] = status;
      var ids = Object.keys(m);
      if (ids.length > 300) ids.slice(0, ids.length - 300).forEach(function (k) { delete m[k]; });
      UI.guardarLocal('ligeiro:zap-mandados', m);
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
      /* periodo gratis (7 dias): o cartao so aparece nos 3 ultimos; antes ficava a semana toda em cima do interruptor e dos pedidos */
      var tranquila = a.estado === 'ativa' || (a.estado === 'gratis' && (a.cortesia || a.dias > 3));
      if (!sempre && tranquila) return null;
      var textos = {
        gratis: 'Seu período grátis vai até ' + dataBR(a.limite) + (a.dias > 0 ? ' (' + a.dias + (a.dias === 1 ? ' dia' : ' dias') + ')' : ' (acaba hoje)') + '. Depois é ' + dinheiro(valor) + ' por ' + periodo + ': cartão, boleto ou Pix, aqui mesmo.',
        ativa: a.cortesia ? 'Assinatura liberada pelo Ligeiro.' : 'Assinatura paga até ' + dataBR(a.limite) + '.',
        vencendo: (a.gratis ? 'Seu período grátis termina' : 'Sua assinatura vence') + ' em ' + a.dias + (a.dias === 1 ? ' dia' : ' dias') + ' (' + dataBR(a.limite) + '). Assine para a loja não parar.',
        vencida: 'Assinatura vencida desde ' + dataBR(a.limite) + '. A loja segue no ar por mais ' + Math.max(0, a.tolerancia + a.dias) + (Math.max(0, a.tolerancia + a.dias) === 1 ? ' dia.' : ' dias.'),
        bloqueada: a.gratis ? 'Os dias grátis acabaram em ' + dataBR(a.limite) + ': o site parou de aceitar pedidos. Assine e ele volta na hora.' : 'Assinatura vencida há mais de ' + a.tolerancia + ' dias: o site parou de aceitar pedidos. Pague e ele volta assim que confirmarmos.',
        pausada: 'Assinatura pausada pelo Ligeiro. Fale com a gente.',
        cancelada: 'Assinatura encerrada. Para voltar, reative em Minha conta.',
      };
      if (a.encerrando) textos.ativa = 'Assinatura encerrada por você: as lojas ficam no ar até ' + dataBR(a.limite) + '. Mudou de ideia? É só reativar.';
      var alerta = a.estado === 'vencida' || a.estado === 'bloqueada';
      var filhos = [
        el('h3', { class: alerta ? 'titulo-alerta' : null }, [alerta ? UI.iconeLinha('alerta') : null, 'Assinatura · ' + nomePlano + (a.estado === 'gratis' ? ' · período grátis' : a.estado === 'ativa' ? ' · em dia' : '')]),
        el('p', { class: 'pequeno', text: (textos[a.estado] || '') + (estado.conta ? ' Vale para todas as lojas da sua conta.' : '') }),
      ];
      if (a.estado !== 'cancelada' && a.estado !== 'pausada' && !a.cortesia) {
        /* pagamento avisado: o mesmo aviso de Minha conta (icone, titulo e uma linha), em vez de selo que virava bolha em 2 linhas */
        if (plano.avisoPagamentoEm) filhos.push(el('div', { class: 'aviso-plano aviso-espera aviso-no-cartao', role: 'note' }, [
          el('span', { class: 'aviso-plano-ico', 'aria-hidden': 'true' }, [UI.iconeLinha('ampulheta')]),
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
        return grava.then(function () { desenharCabecaPedidos(); if (estado.aba === 'ajustes') desenharAjustes(); }).catch(function (e) { UI.avisar(D.erroAmigavel(e, 'Não deu para avisar agora.')); });
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
      /* ja entrou pedido neste aparelho alguma vez (a fila e so do dia: sem guardar, o item voltava a ficar pendente) */
      function teveVenda() { var k = 'ligeiro:teve-pedido:' + slug; if ((estado.pedidos || []).length) { UI.guardarLocal(k, true); return true; } return !!UI.lerLocal(k); }
      /* na ordem do que mais importa para vender; cada item leva direto ao bloco certo (e acende ele).
         [feito, titulo, dica, icone, aba, bloco] */
      var cat = R.catalogo(l);
      var itens = [
        [!!l.mpAtivo, l.mpAtivo ? 'Recebe pelo site: ' + (l.aceitaPix !== false && R.cartaoPeloSite(l) ? 'Pix e cartão' : R.cartaoPeloSite(l) ? 'cartão' : 'Pix') : 'Conectar o Mercado Pago', 'Pix e cartão caem pagos na cozinha', 'dinheiro', 'ajustes', 'aj-pagamento'],
        [comPreco > 0, comPreco > 0 ? comPreco + (comPreco === 1 ? ' item' : ' itens') + ' com preço' : 'Montar o ' + cat.nome, comPreco > 0 ? 'Confira os valores antes de divulgar' : 'Categorias, itens e preços', 'cardapio', 'cardapio', ''],
        [l.aceitaEntrega === false || !!l.freteGratis || Number(l.taxaEntrega) > 0, 'Frete: ' + R.descreverFrete(l).replace(/^./, function (c) { return c.toLowerCase(); }).replace(/r\$/g, 'R$'), 'Taxa e tempo de entrega', 'entrega', 'ajustes', 'aj-entrega'],
        [!!l.whatsapp, 'WhatsApp da loja', 'Para o cliente falar com você', 'telefone', 'ajustes', 'aj-dados'],
        [!!l.usarHorarios || l.aberta !== false, l.usarHorarios ? 'Horários cadastrados' : 'Horários de funcionamento', 'A loja abre e fecha sozinha', 'relogio', 'ajustes', 'aj-funcionamento'],
        [!!D.logoSrc(l), 'Logo da loja', 'Aparece no topo do seu site', 'imagem', 'ajustes', 'aj-aparencia'],
        [(l.produtos || []).some(function (p) { return p.foto || p.fotoUrl; }), 'Foto nos itens', 'Item com foto vende mais', 'camera', 'cardapio', ''],
        /* o teste que tira o medo: um pedido de verdade pelo proprio link (de R$ 1 no Pix, se quiser), visto chegando aqui */
        [teveVenda(), 'Pedido de teste pelo seu link', 'Peça e veja o pedido chegar aqui', 'link', 'links', ''],
      ];
      var feitos = itens.filter(function (i) { return i[0]; }).length;
      var faltam = itens.length - feitos;
      /* o que falta: um cartao por passo, com icone, titulo, dica e a setinha */
      var pendentes = el('div', { class: 'passos-lista' }, itens.filter(function (i) { return !i[0]; }).map(function (i) {
        return el('button', { class: 'passo-item', type: 'button', onclick: function () { irPara(i[4], i[5]); } }, [
          el('span', { class: 'passo-ico' }, [UI.iconeLinha(i[3])]),
          el('span', { class: 'passo-textos' }, [el('b', { text: i[1] }), el('small', { text: i[2] })]),
          el('span', { class: 'passo-seta' }, [UI.iconeLinha('avancar')]),
        ]);
      }));
      /* o que ja foi: recolhido numa linha que abre (a lista nao vira um rolo) */
      var prontos = feitos ? el('details', { class: 'passos-feitos' }, [
        el('summary', {}, [UI.iconeLinha('feito'), el('span', { text: feitos === 1 ? '1 já pronto' : feitos + ' já prontos' }), el('span', { class: 'passos-abre' }, [UI.iconeLinha('avancar')])]),
        el('div', { class: 'passos-feitos-lista' }, itens.filter(function (i) { return i[0]; }).map(function (i) {
          return el('button', { class: 'passo-feito', type: 'button', onclick: function () { irPara(i[4], i[5]); } }, [UI.iconeLinha('feito'), el('span', { class: 'passo-feito-texto', text: i[1] }), el('span', { class: 'passo-seta' }, [UI.iconeLinha('avancar')])]);
        })),
      ]) : null;
      return el('div', { class: 'cartao destaque passos-card' + (faltam ? '' : ' completo'), id: 'primeirosPassosCartao' }, [
        el('div', { class: 'passos-topo' }, [
          el('img', { class: 'passos-mascote', src: 'img/mascote-192.webp', alt: '', width: 192, height: 192 }),
          el('div', { class: 'passos-titulos' }, [
            el('h3', { text: faltam ? 'Primeiros passos' : 'Tudo pronto!' }),
            el('span', { text: faltam ? (faltam === 1 ? 'Falta 1 para a sua loja ficar completa' : 'Faltam ' + faltam + ' para a sua loja ficar completa') : 'Sua loja está completa. Agora é vender!' }),
          ]),
          el('span', { class: 'passos-conta', text: feitos + ' de ' + itens.length }),
        ]),
        el('div', { class: 'progresso-passos', role: 'progressbar', 'aria-label': 'Primeiros passos', 'aria-valuemin': '0', 'aria-valuemax': String(itens.length), 'aria-valuenow': String(feitos) }, [el('span', { style: { width: Math.round(feitos / itens.length * 100) + '%' } })]),
        faltam ? pendentes : null,
        prontos,
        /* dois atalhos lado a lado (nome curto, uma linha) e o "Pronto" embaixo com a largura toda */
        el('div', { class: 'linha-botoes passos-botoes' }, [
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { trocarAba('links'); window.scrollTo(0, 0); } }, [UI.iconeLinha('link'), 'Meu link']),
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { abrirTour(); } }, [UI.iconeLinha('tocar'), 'Tutorial']),
          el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: faltam ? 'Pronto, esconder' : 'Esconder esta lista', onclick: function () { salvarLoja({ configurada: true }, 'Boa! Agora é vender.').then(desenharCabecaPedidos).catch(function () { /* ja avisou */ }); } }),
        ]),
      ]);
    }

    /* ---------------------------------------------------------- tutorial com o mascote */
    /* O Ligeiro (o ratinho chef) guia o dono pelo painel num balao de fala, como um personagem de jogo: a abertura de
       boas-vindas e depois um lugar por vez, com o resto da tela escurecido. Nao bloqueia nada (o escuro nao pega toque):
       da para ir preenchendo enquanto le. Tudo no aparelho, nada no banco. */
    var CHAVE_TOUR = 'ligeiro:tutorial:' + slug;
    var tour = null;
    function passosDoTour() {
      var l = estado.loja || {};
      var cat = R.catalogo(l);
      return [
        { abertura: true, titulo: 'Bem-vindo à sua loja no Ligeiro!', texto: 'Eu sou o Ligeiro, o ajudante da ' + (l.nome || 'sua loja') + '. Em um minutinho eu te mostro onde fica cada coisa para você começar a vender.' },
        { aba: 'cardapio', alvo: '.aba-painel[data-aba=cardapio]', texto: 'Aqui mora o seu ' + cat.nome + '. Crie as categorias, os itens e os preços. Foto é opcional, mas vende mais!' },
        { aba: 'ajustes', alvo: '#aj-pagamento', texto: 'Aqui você liga o Pix e o cartão pelo Mercado Pago. O pedido já chega pago na cozinha, sem ninguém conferir comprovante.' },
        { aba: 'ajustes', alvo: '#aj-entrega', texto: 'Quanto custa a entrega e em quanto tempo chega. Dá até para dar entrega grátis a partir de um valor.' },
        { aba: 'ajustes', alvo: '#aj-funcionamento', texto: 'Seus horários. Com eles cadastrados, a loja abre e fecha sozinha, sem você lembrar.' },
        { aba: 'links', alvo: '.aba-painel[data-aba=links]', texto: 'Aqui está o link da sua loja. Mande no WhatsApp, ponha na bio do Instagram e no Google.' },
        { aba: 'pedidos', alvo: '.cartao-avisos', texto: 'Os pedidos chegam aqui, apitando. Ligue os avisos para ouvir até com a tela apagada.' },
        { aba: 'pedidos', alvo: '#primeirosPassosCartao', texto: 'Pronto! Esta lista mostra o que ainda falta. Faça um pedido de teste pelo seu link e veja ele chegar aqui. Boas vendas!' },
      ];
    }
    function fecharTour(concluido) {
      if (!tour) return;
      window.removeEventListener('scroll', tour.reposicionar);
      window.removeEventListener('resize', tour.reposicionar);
      document.removeEventListener('keydown', tour.tecla);
      if (tour.caixa.parentNode) tour.caixa.parentNode.removeChild(tour.caixa);
      if (tour.foco.parentNode) tour.foco.parentNode.removeChild(tour.foco);
      if (tour.escuro.parentNode) tour.escuro.parentNode.removeChild(tour.escuro);
      tour = null;
      UI.guardarLocal(CHAVE_TOUR, true);
      if (concluido) UI.soar('sucesso');
    }
    /* Termos novos (ou loja de antes do aceite registrado): o Ligeiro pede o aceite antes de tudo, no mesmo balao do
       tutorial. Sem "Pular": ou aceita, ou fica na tela (a loja continua recebendo pedidos normalmente) */
    function pedirAceiteDosTermos(depois) {
      if (estado.equipe || !estado.loja || R.termosEmDia(estado.loja) || R.ehDoLigeiro(estado.loja) || raiz.querySelector('.tour')) { if (depois) depois(); return; }
      var botao = el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Li e aceito' });
      var caixa = el('div', { class: 'tour tour-abertura tour-termos', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Termos de uso', tabindex: '-1' }, [
        el('span', { class: 'tour-mascote-caixa' }, [el('img', { class: 'tour-mascote pulando', src: 'img/mascote-192.webp', alt: '', width: 192, height: 192 })]),
        el('div', { class: 'tour-balao entrando' }, [
          el('span', { class: 'tour-nome', text: 'Ligeiro' }),
          el('div', { class: 'tour-titulo', text: 'Combinado entre a gente' }),
          el('p', { class: 'tour-texto', text: 'Antes de continuar, confira o que combinamos. Em resumo:' }),
          el('ul', { class: 'termos-resumo' }, [
            el('li', { text: 'Quem vende é a sua loja: cardápio, preços, entrega e qualidade são seus.' }),
            el('li', { text: 'O dinheiro dos pedidos vai direto para o seu Mercado Pago. O Ligeiro não encosta nele.' }),
            el('li', { text: 'Os dados dos seus clientes são para atender e avisar da sua loja, nunca para repassar.' }),
            el('li', { text: 'Sem fidelidade: parou de pagar, a loja para de receber pedidos pelo site.' }),
          ]),
          el('p', { class: 'termos-links' }, [el('a', { href: '#/termos', target: '_blank', rel: 'noopener', text: 'Ler os termos de uso' }), el('a', { href: '#/privacidade', target: '_blank', rel: 'noopener', text: 'Política de privacidade' })]),
          el('div', { class: 'tour-rodape' }, [botao]),
        ]),
      ]);
      botao.addEventListener('click', function () {
        botao.disabled = true;
        botao.textContent = 'Guardando…';
        salvarLoja({ termos: { versao: R.TERMOS_VERSAO, aceitoEm: new Date().toISOString() } }).then(function () {
          if (caixa.parentNode) caixa.parentNode.removeChild(caixa);
          UI.soar('sucesso');
          if (depois) depois();
        }).catch(function (e) {
          botao.disabled = false;
          botao.textContent = 'Li e aceito';
          UI.avisar(D.erroAmigavel(e, 'Não deu para guardar agora. Tente de novo.'));
        });
      });
      raiz.appendChild(caixa);
      estado.parar.push(function () { if (caixa.parentNode) caixa.parentNode.removeChild(caixa); });
      try { caixa.focus({ preventScroll: true }); } catch (_) { caixa.focus(); }
    }

    function abrirTour() {
      if (tour || estado.equipe) return;
      var passos = passosDoTour();
      /* anima sempre, tambem com "Reduzir movimento" (o dono pediu): so transform e opacity, que o celular faz de graca */
      var foco = el('div', { class: 'tour-foco', 'aria-hidden': 'true', hidden: true });
      /* o escuro e uma camada com um recorte no lugar certo (sombra gigante nao aparece em todo celular) */
      var escuro = el('div', { class: 'tour-escuro', 'aria-hidden': 'true', hidden: true });
      var titulo = el('div', { class: 'tour-titulo' });
      var texto = el('p', { class: 'tour-texto' });
      var conta = el('span', { class: 'tour-conta' });
      var pular = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Pular' });
      var proximo = el('button', { class: 'btn btn-principal btn-pequeno', type: 'button' });
      /* o nome do personagem na etiqueta da esquerda e o "3 de 7" na da direita: o rodape fica so com os botoes */
      var balao = el('div', { class: 'tour-balao' }, [el('span', { class: 'tour-nome', text: 'Ligeiro' }), conta, titulo, texto, el('div', { class: 'tour-rodape' }, [pular, proximo])]);
      var mascote = el('img', { class: 'tour-mascote', src: 'img/mascote-192.webp', alt: '', width: 192, height: 192 });
      /* a caixa flutua devagar; a imagem dentro dela pula a cada passo (dois movimentos que nao brigam) */
      var caixa = el('div', { class: 'tour', role: 'dialog', 'aria-label': 'Tutorial do painel', 'aria-live': 'polite', tabindex: '-1' }, [
        el('span', { class: 'tour-mascote-caixa' }, [mascote]),
        balao,
      ]);
      tour = { caixa: caixa, foco: foco, escuro: escuro, i: 0, alvo: '' };
      /* o escuro com o buraco em volta do lugar certo acompanha a rolagem */
      var pedido = 0;
      tour.reposicionar = function () {
        if (pedido) return;
        pedido = requestAnimationFrame(function () {
          pedido = 0;
          if (!tour) return;
          var alvo = tour.alvo && raiz.querySelector(tour.alvo);
          var r = alvo && alvo.getBoundingClientRect();
          if (!r || !r.height) { foco.hidden = true; escuro.hidden = true; return; }
          var m = 6;
          foco.hidden = false;
          escuro.hidden = false;
          var x1 = r.left - m, y1 = r.top - m, x2 = r.right + m, y2 = r.bottom + m;
          escuro.style.clipPath = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' + x1 + 'px ' + y1 + 'px, ' + x1 + 'px ' + y2 + 'px, ' + x2 + 'px ' + y2 + 'px, ' + x2 + 'px ' + y1 + 'px, ' + x1 + 'px ' + y1 + 'px)';
          foco.style.top = (r.top - m) + 'px';
          foco.style.left = (r.left - m) + 'px';
          foco.style.width = (r.width + m * 2) + 'px';
          foco.style.height = (r.height + m * 2) + 'px';
        });
      };
      tour.tecla = function (e) { if (e.key === 'Escape' && !$('modal').classList.contains('aberto')) fecharTour(false); };
      /* onde o lugar deveria ficar: logo abaixo das abas (que ficam presas no topo) */
      function destinoDe(alvo) {
        if (alvo.classList.contains('aba-painel')) return 0;
        var abas = raiz.querySelector('.abas-painel');
        var livre = abas ? abas.getBoundingClientRect().bottom + 16 : 100;
        return Math.max(0, Math.round(alvo.getBoundingClientRect().top + window.pageYOffset - livre));
      }
      function rolarAte(alvo) {
        if (!alvo) return;
        window.scrollTo({ top: destinoDe(alvo), behavior: 'smooth' });
      }
      function mostrar(i) {
        var passo = passos[i];
        tour.i = i;
        if (passo.aba && estado.aba !== passo.aba) trocarAba(passo.aba);
        tour.alvo = passo.alvo || '';
        caixa.classList.toggle('tour-abertura', !!passo.abertura); /* nome proprio: "abertura" ja e a capa da loja no tema da Conizza */
        titulo.hidden = !passo.titulo;
        titulo.textContent = passo.titulo || '';
        texto.textContent = passo.texto;
        conta.textContent = passo.abertura ? '' : i + ' de ' + (passos.length - 1);
        conta.hidden = !!passo.abertura;
        pular.hidden = i === passos.length - 1;
        proximo.textContent = passo.abertura ? 'Vamos lá!' : (i === passos.length - 1 ? 'Começar a vender' : 'Próximo');
        /* reinicia a animacao do balao e o pulo do mascote a cada passo */
        balao.classList.remove('entrando'); mascote.classList.remove('pulando'); void balao.offsetWidth;
        balao.classList.add('entrando'); mascote.classList.add('pulando');
        /* espera a aba desenhar para achar o lugar; e confere de novo quando a tela assenta (a caixa do Mercado Pago
           cresce depois de conferir a conexao e empurrava o lugar para baixo do balao) */
        var este = i;
        setTimeout(function () {
          if (!tour || tour.i !== este) return;
          rolarAte(tour.alvo && raiz.querySelector(tour.alvo));
          tour.reposicionar();
        }, 80);
        [700, 1500].forEach(function (ms) {
          setTimeout(function () {
            if (!tour || tour.i !== este) return;
            var alvo = tour.alvo && raiz.querySelector(tour.alvo);
            if (alvo && Math.abs(destinoDe(alvo) - window.pageYOffset) > 24) rolarAte(alvo);
            tour.reposicionar();
          }, ms);
        });
      }
      proximo.addEventListener('click', function () { if (tour.i >= passos.length - 1) fecharTour(true); else mostrar(tour.i + 1); });
      pular.addEventListener('click', function () { fecharTour(false); });
      window.addEventListener('scroll', tour.reposicionar, { passive: true });
      window.addEventListener('resize', tour.reposicionar);
      document.addEventListener('keydown', tour.tecla);
      raiz.appendChild(escuro);
      raiz.appendChild(foco);
      raiz.appendChild(caixa);
      /* sai do painel (outra tela): o tutorial vai junto, sem marcar como visto */
      var este = tour;
      estado.parar.push(function () { if (tour === este) { tour = null; [este.caixa, este.foco, este.escuro].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); window.removeEventListener('scroll', este.reposicionar); window.removeEventListener('resize', este.reposicionar); document.removeEventListener('keydown', este.tecla); } });
      mostrar(0);
      /* o foco vai para o balao (leitor de tela le o texto), sem acender o anel de teclado no botao */
      try { caixa.focus({ preventScroll: true }); } catch (_) { caixa.focus(); }
    }

    function desenharPedidos() {
      var s = $('secaoPainel');
      if (!s) return;
      var antigo = $('listaPedidos');
      var caixa = el('div', { id: 'listaPedidos', class: 'pilha' });
      /* ficaram andando de outros dias: um aviso so, com as senhas e um toque para concluir tudo */
      var velhos = estado.deOutrosDias || [];
      if (velhos.length) {
        var senhas = velhos.map(function (x) { return x.senha; });
        caixa.appendChild(el('div', { class: 'aviso aviso-falta de-outros-dias' }, [
          UI.iconeLinha('relogio'),
          el('div', { class: 'aviso-app-texto' }, [
            el('b', { text: velhos.length === 1 ? 'Um pedido ficou aberto de outro dia' : velhos.length + ' pedidos ficaram abertos de outros dias' }),
            el('span', { text: (senhas.length === 1 ? 'Senha ' : 'Senhas ') + (senhas.length > 1 ? senhas.slice(0, -1).join(', ') + ' e ' + senhas[senhas.length - 1] : senhas[0]) + '. Se já foram entregues, conclua todos de uma vez: somem da cozinha e do entregador.' }),
            /* um embaixo do outro, largura toda (lado a lado, "Concluir todos" nao cabia no celular); a acao em cima */
            el('div', { class: 'botoes-empilhados' }, [
              el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', onclick: function (e) {
                var b = e.currentTarget;
                var lista = velhos.slice();
                /* concluir mexe em varios pedidos de uma vez: pergunta antes */
                UI.perguntar((lista.length === 1 ? 'O pedido sai' : 'Os ' + lista.length + ' pedidos saem') + ' da cozinha e do entregador e ' + (lista.length === 1 ? 'conta' : 'contam') + ' nas vendas do dia em que ' + (lista.length === 1 ? 'foi feito.' : 'foram feitos.'), {
                  titulo: lista.length === 1 ? 'Concluir o pedido de outro dia?' : 'Concluir os ' + lista.length + ' pedidos?', sim: 'Concluir',
                }).then(function (sim) {
                  if (!sim) return;
                  b.disabled = true; b.textContent = 'Concluindo…';
                  lista.reduce(function (passo, x) { return passo.then(function () { return store.atualizarPedido(slug, x.id, { status: R.STATUS.FINALIZADO }); }); }, Promise.resolve()).then(function () {
                    estado.deOutrosDias = [];
                    UI.avisar(lista.length === 1 ? 'Pedido concluído.' : lista.length + ' pedidos concluídos.');
                    desenharPedidos();
                  }).catch(function () { b.disabled = false; b.textContent = 'Concluir todos'; UI.avisar('Não deu para concluir agora. Confira a internet e tente de novo.'); });
                });
              } }, [UI.iconeLinha('check'), 'Concluir todos']),
              /* ver antes de concluir: abre a lista "De outros dias", com cada pedido */
              el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () {
                estado.gruposAbertos = estado.gruposAbertos || {};
                estado.gruposAbertos['De outros dias'] = true;
                desenharPedidos();
                var alvo = $('grupoOutrosDias');
                if (alvo) alvo.scrollIntoView({ block: 'start' });
              } }, [UI.iconeLinha('olho'), 'Ver pedidos']),
            ]),
          ]),
        ]));
      }
      /* "hoje" e o dia de trabalho da fila (desde as 5 h; de madrugada, desde as 5 h de ontem), contado agora */
      var ini = new Date(); if (ini.getHours() < 5) ini.setDate(ini.getDate() - 1);
      ini.setHours(5, 0, 0, 0);
      var inicioDoDia = ini.toISOString();
      var grupos = [
        /* cancelado com o dinheiro ainda com a loja: fica no topo, aberto, ate devolver (de qualquer dia) */
        { titulo: 'Falta devolver', lista: estado.aDevolver || [] },
        { titulo: 'Aguardando pagamento', filtro: function (p) { return p.status === R.STATUS.AGUARDANDO; } },
        { titulo: 'Novos, para começar', filtro: function (p) { return p.status === R.STATUS.PAGO; } },
        { titulo: 'Preparando', filtro: function (p) { return p.status === R.STATUS.PRODUCAO; } },
        { titulo: 'Saiu ou pronto', filtro: function (p) { return p.status === R.STATUS.PRONTO; } },
      ];
      /* os de outros dias, fechados embaixo da fila (o aviso la em cima abre e conclui) */
      if (velhos.length) grupos.push({ titulo: 'De outros dias', lista: velhos.slice().sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; }), fechado: true, id: 'grupoOutrosDias' });
      /* "hoje" e o dia de trabalho da fila (desde as 5 h): depois da meia-noite os pedidos da noite continuam aqui.
         Concluidos e cancelados so depois que o dono abre (a fila nao escuta mais o dia inteiro) */
      var encerrados = estado.encerrados ? Object.keys(estado.encerrados).map(function (id) { return estado.encerrados[id]; }).filter(function (p) { return p.criadoEm >= inicioDoDia; }) : null;
      if (encerrados) {
        var devolver = {};
        (estado.aDevolver || []).forEach(function (p) { devolver[p.id] = true; });
        grupos.push({ titulo: 'Concluídos hoje', lista: encerrados.filter(function (p) { return p.status === R.STATUS.FINALIZADO; }), fechado: true });
        grupos.push({ titulo: 'Cancelados hoje', lista: encerrados.filter(function (p) { return p.status === R.STATUS.CANCELADO && !devolver[p.id]; }), fechado: true });
      }
      var algum = false;
      grupos.forEach(function (g) {
        var lista = g.lista || estado.pedidos.filter(g.filtro);
        if (lista.length === 0) return;
        algum = true;
        var titulo = el('div', { class: 'fila-titulo', id: g.id || null }, [el('span', { text: g.titulo }), el('span', { text: lista.length })]);
        caixa.appendChild(titulo);
        if (g.fechado) {
          var det = el('details');
          /* a lista redesenha a cada minuto e a cada pedido: lembra se estava aberta */
          estado.gruposAbertos = estado.gruposAbertos || {};
          det.open = !!estado.gruposAbertos[g.titulo];
          /* aberto, o mesmo lugar fecha: "Esconder" (antes continuava "Mostrar 3" com a lista aberta) */
          var resumoGrupo = el('summary', { class: 'fila-mostrar' });
          var rotularGrupo = function (d, r, n) { r.textContent = d.open ? 'Esconder' : 'Mostrar ' + n; };
          det.addEventListener('toggle', function () { estado.gruposAbertos[g.titulo] = det.open; rotularGrupo(det, resumoGrupo, lista.length); });
          rotularGrupo(det, resumoGrupo, lista.length);
          det.appendChild(resumoGrupo);
          lista.forEach(function (p) { det.appendChild(cartaoSeguro(p)); });
          caixa.appendChild(det);
        } else {
          lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
          lista.forEach(function (p) { caixa.appendChild(cartaoSeguro(p)); });
        }
      });
      if (!algum) caixa.appendChild(el('div', { class: 'vazio' }, [el('div', { class: 'icone' }, [UI.iconeLinha('recibo')]), el('p', { text: 'Nenhum pedido por enquanto. Quando entrar, ele aparece aqui apitando.' })]));
      /* concluidos e cancelados do dia: um toque carrega (uma leitura por pedido do dia, so quando o dono quer ver) */
      if (!encerrados && store.pedidosDoDia) {
        var carregar = el('details', {}, [el('summary', { class: 'fila-mostrar', text: estado.carregandoEncerrados ? 'Carregando…' : 'Mostrar' })]);
        carregar.addEventListener('toggle', function () {
          if (!carregar.open || estado.carregandoEncerrados) return;
          estado.carregandoEncerrados = true;
          carregar.querySelector('summary').textContent = 'Carregando…';
          store.pedidosDoDia(slug, inicioDoDia).then(function (l) {
            estado.encerrados = {};
            l.forEach(function (p) { if (p.status === R.STATUS.FINALIZADO || p.status === R.STATUS.CANCELADO) estado.encerrados[p.id] = p; });
            estado.gruposAbertos = estado.gruposAbertos || {};
            estado.gruposAbertos['Concluídos hoje'] = true;
            estado.gruposAbertos['Cancelados hoje'] = true;
          }).catch(function () { UI.avisar('Não deu para carregar agora. Confira a internet e tente de novo.'); })
            .then(function () { estado.carregandoEncerrados = false; if (vivo && estado.aba === 'pedidos') desenharPedidos(); });
        });
        caixa.appendChild(el('div', { class: 'fila-titulo' }, [el('span', { text: 'Concluídos e cancelados hoje' }), el('span')]));
        caixa.appendChild(carregar);
      }
      if (antigo) antigo.replaceWith(caixa); else s.appendChild(caixa);
    }

    /* um pedido torto nunca apaga a fila inteira: ele vira um cartao curto e os outros aparecem normais */
    function cartaoSeguro(p) {
      try { return cartaoPedido(p); } catch (_) {
        return el('div', { class: 'pedido-card' }, [el('div', { class: 'cliente', text: 'Senha ' + String((p && p.senha) || '?') + ': pedido com dados incompletos. Abra a ficha ou fale com o cliente.' })]);
      }
    }
    function cartaoPedido(p) {
      var loja = estado.loja;
      var novo = estado.novos && estado.novos.indexOf(p.id) >= 0;
      var entrega = p.tipoEntrega === 'entrega';
      var card = el('div', { class: 'pedido-card' + (novo ? ' novo' : '') + (p.status === R.STATUS.AGUARDANDO && p.clientePagou ? ' atencao' : '') });

      /* ordem fixa em todo cartao: pagamento e entrega numa linha, extras (troco, cancelado) na linha de baixo */
      var selos = [], extras = [];
      if (p.status === R.STATUS.AGUARDANDO) selos.push(el('span', { class: 'selo ' + (p.clientePagou ? 'laranja' : 'cinza'), text: p.clientePagou ? 'Diz que pagou' : (p.formaPagamento === 'cartao_online' ? 'Aguardando cartão' : 'Aguardando Pix') })); /* curtos: cabem com o selo de entrega na mesma linha ate em 320 */
      else if (p.devolvidoEm) selos.push(el('span', { class: 'selo cinza', text: 'Devolvido' }));
      else if (p.formaPagamento === 'pix') selos.push(el('span', { class: 'selo', text: p.total === 0 ? 'Cortesia' : 'Pix confirmado' }));
      else if (p.formaPagamento === 'cartao_online') selos.push(el('span', { class: 'selo', text: 'Cartão pago' }));
      else if (p.formaPagamento === 'cartao_entrega') selos.push(el('span', { class: 'selo laranja', text: 'Maquininha' })); /* onde paga ja esta no selo do lado (Entrega, Retirada, Balcao) */
      else if (p.formaPagamento === 'dinheiro_entrega') {
        selos.push(el('span', { class: 'selo laranja', text: 'Dinheiro' }));
        if (p.trocoPara > 0) extras.push(el('span', { class: 'selo laranja', text: 'Troco de ' + dinheiro(p.trocoPara - p.total) }));
      }
      selos.push(UI.seloTipo(p));
      if (p.status === R.STATUS.CANCELADO) extras.push(el('span', { class: 'selo fechado', text: p.canceladoPor === 'pix-vencido' ? 'Pix venceu' : 'Cancelado' + (p.canceladoPor === 'cliente' ? ' pelo cliente' : '') }));
      if (p.pagoAposCancelar && !p.devolvidoEm) extras.push(el('span', { class: 'selo laranja', text: 'Pagou depois de cancelado' }));

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
      if (p.observacao) card.appendChild(el('div', { class: 'obs' }, [UI.iconeLinha('nota'), el('span', { text: p.observacao })]));
      var conferencia = R.conferirTotal(loja, p);
      if (!conferencia.ok) card.appendChild(el('div', { class: 'divergente', text: conferencia.esperado == null
        ? 'Atenção: este pedido tem item que não está no ' + R.catalogo(estado.loja).nome + ' e veio com ' + dinheiro(p.total) + '. Confira antes de fazer.'
        : 'Atenção: pelo ' + R.catalogo(estado.loja).nome + ' de hoje este pedido daria ' + dinheiro(conferencia.esperado) + ', mas veio com ' + dinheiro(p.total) + '. Confira antes de fazer.' }));
      card.appendChild(el('div', { class: 'total' }, [
        el('span', { text: 'Total ' + dinheiro(p.total) }),
        el('span', { class: 'forma', text: (p.desconto > 0 ? 'cupom ' + p.cupom + ' · ' : '') + (p.acrescimoCartao > 0 ? 'taxa do cartão ' + dinheiro(p.acrescimoCartao) + ' · ' : '') + (p.taxaEntrega > 0 ? 'entrega ' + dinheiro(p.taxaEntrega) : (p.tipoEntrega === 'entrega' ? 'entrega grátis' : 'retirada')) }),
      ]));

      /* cliente que ligou o aviso no celular: recebe sozinho. Os outros: um toque manda a mensagem certa do status no WhatsApp */
      var avisoSozinho = !!(p.aviso && (p.aviso.e || p.aviso.demo));
      if (avisoSozinho && p.status !== R.STATUS.FINALIZADO) {
        card.appendChild(el('div', { class: 'cliente-avisado' }, [
          el('span', { class: 'cliente-avisado-ico', 'aria-hidden': 'true', html: window.LigeiroAvisos ? window.LigeiroAvisos.icone() : '' }),
          el('span', { text: 'Cliente recebe os avisos no celular' }),
        ]));
      } else if (!avisoSozinho && p.cliente.telefone) {
        var mandado = zapMandados()[p.id] === p.status;
        var rotuloZap = function (feito) { return [el('span', { class: 'zap-status-texto' }, [feito ? 'Avisado: ' : 'Avisar: ', el('b', { text: R.rotuloAvisoWhats(p) })]), el('span', { class: 'zap-status-fim', 'aria-hidden': 'true' }, [UI.iconeLinha(feito ? 'check' : 'avancar')])]; };
        var zap = el('a', { class: 'zap-status' + (mandado ? ' feito' : ''), href: R.linkWhatsapp(p.cliente.telefone, R.mensagemParaCliente(loja, p)), target: '_blank', rel: 'noopener', onclick: function () {
          marcarZap(p.id, p.status);
          setTimeout(function () { zap.classList.add('feito'); UI.limpar(zap); zap.appendChild(UI.icone('zap')); rotuloZap(true).forEach(function (n) { zap.appendChild(n); }); }, 400);
        } }, [UI.icone('zap')].concat(rotuloZap(mandado)));
        card.appendChild(zap);
      }

      var acoes = el('div', { class: 'acoes acoes-pedido' });
      var proximo = R.proximoStatus(p);
      if (proximo && R.rotuloProximoPasso(p)) {
        acoes.appendChild(el('button', { class: 'btn btn-principal', text: R.rotuloProximoPasso(p), onclick: function () { avancar(p); } }));
      }
      /* cancelado com o dinheiro ainda com a loja (pagou depois de cancelar, ou a devolucao falhou): devolve daqui,
         no lugar do botao principal (o mesmo desenho dos outros cartoes) */
      if (p.status === R.STATUS.CANCELADO && pagoPeloSite(p)) {
        acoes.appendChild(el('button', { class: 'btn btn-principal', text: 'Devolver ' + dinheiro(p.total), onclick: function () {
          UI.perguntar('Devolver ' + dinheiro(p.total) + ' da senha ' + p.senha + ' para o cliente pelo Mercado Pago?', { sim: 'Devolver', nao: 'Voltar' }).then(function (sim) { if (sim) devolverPagamento(p); });
        } }));
      }
      /* conversa com quem ja recebe os avisos sozinho (duvida, troco, endereco) */
      if (avisoSozinho && p.cliente.telefone) {
        acoes.appendChild(el('a', { class: 'btn btn-whats btn-pequeno btn-so-icone', href: R.linkWhatsapp(p.cliente.telefone, R.mensagemParaCliente(loja, p)), target: '_blank', rel: 'noopener', title: 'Falar com o cliente no WhatsApp', 'aria-label': 'Falar com o cliente no WhatsApp' }, [UI.icone('zap')]));
      }
      acoes.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno btn-so-icone', title: 'Imprimir', 'aria-label': 'Imprimir', onclick: function () { imprimir(p); } }, [UI.iconeLinha('imprimir')]));
      if (p.status !== R.STATUS.FINALIZADO && p.status !== R.STATUS.CANCELADO) {
        acoes.appendChild(el('button', { class: 'btn btn-erro btn-pequeno', text: 'Cancelar', onclick: function () { cancelar(p); } }));
      }
      card.appendChild(acoes);
      return card;
    }

    function avancar(p) {
      var proximo = R.proximoStatus(p);
      if (!proximo) return;
      if (proximo === R.STATUS.PAGO && p.status === R.STATUS.AGUARDANDO) {
        UI.perguntar('O Pix de ' + dinheiro(p.total) + ' da senha ' + p.senha + ' caiu mesmo? Confira no app do banco antes. O pedido vai para a cozinha.', { sim: 'Caiu, marcar como pago', nao: 'Voltar' }).then(function (sim) { if (sim) avancarAgora(p, proximo); });
        return;
      }
      avancarAgora(p, proximo);
    }
    function avancarAgora(p, proximo) {
      var mudancas = { status: proximo };
      if (proximo === R.STATUS.PAGO) { mudancas.pagamentoStatus = 'pago'; mudancas.pagoEm = new Date().toISOString(); }
      store.atualizarPedido(slug, p.id, mudancas).then(function () { UI.soar('toque'); avisarQueAndou(p, proximo); }).catch(function (e) { UI.avisar(D.erroAmigavel(e)); });
    }

    /* pago pelo site (Pix ou cartao, pelo Mercado Pago): cancelar devolve o dinheiro sozinho, sem a loja abrir o app */
    function pagoPeloSite(p) { return R.pagaPeloSite(p) && p.pagamentoStatus === 'pago' && p.total > 0 && !!(p.mp && p.mp.id) && !p.devolvidoEm; }
    function cancelar(p) {
      var devolver = pagoPeloSite(p);
      var texto = devolver
        ? 'Cancelar o pedido de senha ' + p.senha + '? Os ' + dinheiro(p.total) + ' voltam para o cliente pelo Mercado Pago, ' + (p.formaPagamento === 'cartao_online' ? 'no mesmo cartão.' : 'na mesma conta do Pix.')
        : 'Cancelar o pedido de senha ' + p.senha + '? Avise o cliente pelo WhatsApp se ele já pagou.';
      UI.perguntar(texto, { sim: devolver ? 'Cancelar e devolver' : 'Cancelar pedido', nao: 'Voltar', perigo: true }).then(function (sim) {
        if (!sim) return;
        store.atualizarPedido(slug, p.id, { status: R.STATUS.CANCELADO, canceladoPor: 'loja' }).then(function () {
          avisarQueAndou(p, R.STATUS.CANCELADO);
          if (!devolver) { UI.avisar('Pedido cancelado.'); return; }
          UI.avisar('Pedido cancelado. Devolvendo o dinheiro…');
          return devolverPagamento(p);
        }).catch(function () { UI.avisar('Não deu para cancelar agora. Confira a internet e tente de novo.'); });
      });
    }
    function devolverPagamento(p) {
      var cfg = window.LIGEIRO_CONFIG || {};
      if (D.modoDemo || (p.mp && p.mp.simulado)) {
        return store.atualizarPedido(slug, p.id, { devolvidoEm: new Date().toISOString() }).then(function () { UI.avisar('Dinheiro devolvido ao cliente (simulado).'); }, function () {});
      }
      var semDevolver = function (motivo) {
        UI.abrirModal({
          titulo: 'Falta devolver',
          corpo: el('p', { text: (motivo ? motivo + ' ' : '') + 'Devolva pelo app do Mercado Pago: abra a venda de ' + dinheiro(p.total) + ' da senha ' + p.senha + ' e toque em Devolver.', style: { fontSize: '17px', padding: '6px 0 12px' } }),
          rodape: [el('button', { class: 'btn btn-principal', type: 'button', style: { flex: '1' }, text: 'Entendi', onclick: UI.fecharModal })],
        });
      };
      if (!cfg.proxyMercadoPago || !store.obterIdToken) { semDevolver(''); return Promise.resolve(); }
      return store.obterIdToken().then(function (idToken) {
        return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/devolver', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ loja: slug, pedido: p.id }),
        });
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j && j.ok, erro: (j && j.erro) || '' }; }); })
        .then(function (res) {
          if (res.ok) { UI.soar('sucesso'); UI.avisar('Pronto: ' + dinheiro(p.total) + ' devolvidos ao cliente.'); return; }
          semDevolver(/dono/.test(res.erro) ? 'Só o dono da loja devolve pagamentos.' : 'O Mercado Pago não devolveu agora.');
        }, function () { semDevolver('Sem internet agora.'); });
    }

    /* Liga ou desliga o motor do Mercado Pago conforme o interruptor da loja. */
    function ligarMP() {
      if (estado.mp) { estado.mp.parar(); estado.mp = null; }
      if (!estado.loja.mpAtivo || !window.LigeiroMP) return;
      /* a faixa do Pix so aparece com problema (ligado, some: o estado fica em Ajustes). "Sem token" so para o dono:
         a equipe nao le a conexao do Mercado Pago e veria "desligado" com o Pix funcionando */
      var mostrar = function (texto) { estado.mpStatus = texto; if (estado.aba === 'pedidos') desenharCabecaPedidos(); };
      estado.mp = window.LigeiroMP.iniciar(slug, estado.loja, function (texto, _e, tipo) {
        if (tipo === 'ok') { mostrar(''); return; }
        if (tipo !== 'semToken' || D.modoDemo) { mostrar(texto); return; }
        store.usuarioAtual().then(function (u) { mostrar(u && u.email && u.email === String(estado.loja.donoEmail || '').toLowerCase() ? texto : ''); }).catch(function () { mostrar(''); });
      });
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
      /* vale na tela na hora: o proximo toque (a chave logo depois de digitar o preco, o lapis) ja parte do valor novo.
         Antes partia da loja velha e a segunda gravacao desfazia a primeira. Falhou: volta o que era, campo por campo */
      var antes = estado.loja || {};
      estado.loja = Object.assign({}, antes, nova);
      return store.salvarLoja(nova, Object.assign({}, estado.loja)).then(function (salva) {
        estado.loja = Object.assign({}, estado.loja, salva || nova);
        if (aviso) UI.avisar(aviso);
        return estado.loja;
      }).catch(function (e) {
        Object.keys(mudancas).forEach(function (k) { if (estado.loja[k] === nova[k]) estado.loja[k] = antes[k]; });
        UI.avisar(D.erroAmigavel(e, 'Não deu para salvar. Tente de novo.'));
        throw e;
      });
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
      linhaCat.appendChild(el('button', { class: 'aba-painel aba-nova', text: '+ Categoria', onclick: function () { if (cabeMais('categorias')) editarCategoria(null); } }));
      s.appendChild(el('h2', { text: R.catalogo(estado.loja).Nome }));

      /* com muitos itens, achar pelo nome em vez de rolar categoria por categoria */
      var busca = null;
      if (l.produtos.length > 8) {
        busca = el('input', { type: 'search', class: 'busca', placeholder: 'Buscar item pelo nome', 'aria-label': 'Buscar item' });
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
          el('button', { class: 'btn btn-fantasma btn-pequeno', title: 'Editar categoria', 'aria-label': 'Editar categoria', onclick: function () { editarCategoria(cat); } }, [UI.iconeLinha('lapis'), 'Editar']),
          el('button', { class: 'btn btn-principal btn-pequeno', text: '+ Novo item', onclick: function () { if (cabeMais('itens')) editarProduto(null, cat.id); } }),
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
        conteudo.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', text: '+ Novo grupo de opções', onclick: function () { if (cabeMais('grupos')) editarGrupo(null, cat.id); } }));
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
        el('button', { class: 'editar apagar', 'aria-label': 'Excluir ' + p.nome, title: 'Excluir', onclick: function () { excluirProduto(p); } }, [UI.iconeLinha('lixeira')]),
        el('button', { class: 'editar', 'aria-label': 'Editar ' + p.nome, title: 'Editar', onclick: function () { editarProduto(p, p.categoria); } }, [UI.iconeLinha('lapis')]),
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
      var opcoes = [['gratis', 'Entrega grátis'], ['taxa', 'Cobro taxa']];
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
    function previaDaLoja(l, f, exclusiva) {
      function imgDe(campo) {
        var img = campo.querySelector('.foto-previa img');
        return img && !img.hidden && img.getAttribute('src') ? img.getAttribute('src') : null;
      }
      function botaoDe(campo, re) { return [].slice.call(campo.querySelectorAll('button')).filter(function (b) { return re.test(b.textContent); })[0]; }
      var capa = el('div', { class: 'previa-capa' });
      var logo = el('div', { class: 'previa-logo' });
      var nome = el('div', { class: 'previa-nome' });
      var texto = el('div', { class: 'previa-tipo' });
      var fraseBotao = el('span', { class: 'sub' });
      var botao = el('span', { class: 'btn btn-principal btn-gigante previa-botao' }, [el('span', {}, [el('span', { text: 'PEDIR AGORA' }), fraseBotao])]);
      /* barra de cima desenhada (sinal, wi-fi, bateria): antes eram letras soltas */
      var icones = '<svg viewBox="0 0 52 12" width="52" height="12" aria-hidden="true">'
        + '<rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.5" y="5.5" width="3" height="6.5" rx="1"/><rect x="9" y="3" width="3" height="9" rx="1"/><rect x="13.5" y="0.5" width="3" height="11.5" rx="1"/>'
        + '<path d="M26 11.2a1.3 1.3 0 1 0 0-.01zM22.4 7.6a5.1 5.1 0 0 1 7.2 0l-1.1 1.1a3.5 3.5 0 0 0-5 0zM20 5.2a8.5 8.5 0 0 1 12 0l-1.1 1.1a6.9 6.9 0 0 0-9.8 0z"/>'
        + '<rect x="36" y="1.5" width="13" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="37.6" y="3.1" width="9.8" height="5.8" rx="1.3"/><rect x="49.8" y="4.3" width="1.6" height="3.4" rx="0.8"/>'
        + '</svg>';
      var tela = el('div', { class: 'previa-site' }, [
        el('div', { class: 'previa-status' }, [el('span', { text: '9:41' }), el('span', { class: 'previa-icones', html: icones })]),
        el('div', { class: 'previa-ilha' }),
        capa,
        el('div', { class: 'previa-corpo' }, [logo, nome, texto, el('span', { class: 'selo previa-selo' }, [el('span', { class: 'bolinha' }), 'Aberto agora']), botao]),
        el('div', { class: 'previa-home' }),
      ]);
      var aparelho = el('div', { class: 'previa-aparelho' }, [tela]);
      /* um jeito so de trocar: os botoes com nome (as cameras em cima da previa eram o segundo jeito, e a da capa ficava
         torta na borda). Tirar a capa ou a logo aparece so quando tem */
      var tirarCapa = el('button', { type: 'button', class: 'btn btn-fantasma btn-mini', onclick: function () { var b = botaoDe(f.capa, /Remover/); if (b) b.click(); } }, [UI.iconeLinha('fechar'), 'Tirar a capa']);
      var tirarLogo = el('button', { type: 'button', class: 'btn btn-fantasma btn-mini', onclick: function () { var b = botaoDe(f.logo, /Remover/); if (b) b.click(); } }, [UI.iconeLinha('fechar'), 'Tirar a logo']);
      /* design exclusivo: a capa e parte do design (travada); a logo o dono troca quando quiser */
      /* sem "tirar" no design exclusivo: sem logo o design quebra; o dono so troca por outra */
      var tirar = el('div', { class: 'previa-tirar-linha' }, exclusiva ? [] : [tirarCapa, tirarLogo]);
      var trocarLogo = el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', onclick: function () { var b = botaoDe(f.logo, /Escolher|Trocar/); if (b) b.click(); } }, [UI.iconeLinha('sorriso'), 'Trocar logo']);
      var acoes = el('div', { class: 'previa-acoes' + (exclusiva ? ' so-logo' : '') }, exclusiva ? [trocarLogo] : [
        el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', onclick: function () { var b = botaoDe(f.capa, /Escolher|Trocar/); if (b) b.click(); } }, [UI.iconeLinha('imagem'), 'Trocar capa']),
        trocarLogo,
      ]);
      function atualizar() {
        var srcCapa = imgDe(f.capa);
        var srcLogo = imgDe(f.logo);
        UI.limpar(capa);
        if (srcCapa) capa.appendChild(el('img', { src: srcCapa, alt: '' }));
        capa.classList.toggle('sem-capa', !srcCapa);
        UI.limpar(logo);
        logo.appendChild(srcLogo ? el('img', { src: srcLogo, alt: '' }) : el('span', { class: 'emoji', text: (f.emoji && f.emoji.input.value.trim()) || l.emoji || '🍽️' }));
        nome.textContent = f.nome.input.value.trim() || l.nome;
        /* a mesma linha do topo da loja: a frase de apresentacao; sem ela, o tipo e a cidade */
        var frase = f.descricao ? f.descricao.input.value.trim() : (l.descricao || '');
        texto.textContent = frase || (R.tipoVisivel({ tipo: f.tipo.input.value.trim() || l.tipo }) + (l.cidade ? ' em ' + l.cidade : ''));
        fraseBotao.textContent = l.aceitaEntrega === false ? 'retirar no balcão' : (R.descreverFrete(l) === 'Entrega grátis' ? 'entrega grátis' : 'entrega') + ' em ~' + (l.tempoEntrega || 40) + ' min';
        tirarCapa.hidden = !srcCapa || !!exclusiva;
        tirarLogo.hidden = !srcLogo;
        tirar.hidden = !!exclusiva || (!srcCapa && !srcLogo);
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
        el('p', { class: 'ajuda', text: exclusiva ? 'É assim que o cliente vê no celular. A logo você troca no botão embaixo; o resto é do seu design exclusivo.' : 'É assim que o cliente vê no celular. Troque a capa e a logo nos botões embaixo; a cor e o estilo, mais abaixo.' }),
        aparelho,
        acoes,
        tirar,
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
        if (escolhida && !naPaleta) { outra.style.background = escolhida; outra.style.color = UI.corDeTexto(escolhida); } else { outra.style.background = ''; outra.style.color = ''; }
        previa.style.background = escolhida || '#84CC16';
        previa.style.color = UI.corDeTexto(escolhida || '#84CC16');
        if (aoMudar) aoMudar(escolhida);
      }
      UI.PALETA.forEach(function (c) {
        lista.appendChild(el('button', { type: 'button', class: 'cor', dataset: { cor: c[0] }, title: c[1], 'aria-label': c[1], style: { background: c[0] || '#84CC16', color: UI.corDeTexto(c[0] || '#84CC16') }, onclick: function () { escolhida = c[0]; pintar(); } }));
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
        /* primeiro o item sai da lista; so depois a foto (antes, a foto sumia com o item ainda apontando para ela) */
        return salvarLoja({ produtos: estado.loja.produtos.filter(function (x) { return x.id !== p.id; }) }, 'Item excluído').then(function () {
          if (p.foto) store.excluirFoto(slug, p.foto).catch(function () { /* ignora */ });
          desenharCardapio();
          return true;
        });
      });
    }

    function editarProduto(p, categoriaId) {
      /* o item como esta agora (o da lista desenhada pode ser de antes de uma mudanca que acabou de sair) */
      if (p) p = estado.loja.produtos.filter(function (x) { return x.id === p.id; })[0] || p;
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
          var subir = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { moverProduto(p, -1); } }, [UI.iconeLinha('subir'), 'Subir na lista']);
          var descer = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { moverProduto(p, 1); } }, [UI.iconeLinha('descer'), 'Descer na lista']);
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
        /* Foto: primeiro guarda a imagem (documento separado), depois o item aponta pra ela, e so entao a antiga sai.
           Enquanto isso, a limpeza de foto solta (carregarFotos) espera: ela via o item na foto velha ja apagada. */
        var foto = f.foto.valor();
        var fotoAntiga = p && p.foto;
        var apagarDepois = '';
        var passo = Promise.resolve();
        estado.fotoEmTroca = (estado.fotoEmTroca || 0) + 1;
        if (foto.dados) {
          var idFoto = 'f' + D.idAleatorio(10);
          passo = store.salvarFoto(slug, idFoto, foto.dados).then(function () {
            dados.foto = idFoto;
            dados.fotoUrl = '';
            apagarDepois = fotoAntiga || '';
          });
        } else if (foto.removida) {
          dados.foto = '';
          dados.fotoUrl = '';
          apagarDepois = fotoAntiga || '';
        }
        var fimDaTroca = function () { estado.fotoEmTroca = Math.max(0, (estado.fotoEmTroca || 1) - 1); };
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
          if (apagarDepois) store.excluirFoto(slug, apagarDepois).catch(function () { /* a antiga pode ja ter sumido */ });
          fimDaTroca();
          UI.fecharModal();
          estado.categoriaAtiva = dados.categoria;
          desenharCardapio();
        }).catch(function (e) {
          fimDaTroca();
          UI.avisar(D.erroAmigavel(e, 'Não deu para salvar. Tente de novo.'));
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
      if (!cabeMais('itens')) return;
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

    /* Cardapio com tamanho de gente (config.limites): tudo fica num documento so do banco e baixa inteiro no celular
       do cliente. No limite, avisa com calma o que fazer; as regras do banco conferem o mesmo numero */
    /* limites do cardapio (o banco trava categorias, itens e grupos; aqui o dono ouve o motivo antes de tentar) */
    var LIMITES_PADRAO = { categorias: 20, itens: 300, grupos: 30, opcoes: 30 };
    function cabeMais(tipo, chaveGrupo) {
      var lim = ((window.LIGEIRO_CONFIG || {}).limites || {})[tipo] || LIMITES_PADRAO[tipo];
      var l = estado.loja;
      var qtd = tipo === 'categorias' ? l.categorias.length
        : tipo === 'itens' ? l.produtos.length
        : tipo === 'grupos' ? Object.keys(l.grupos || {}).length
        : (((l.grupos || {})[chaveGrupo] || {}).opcoes || []).length;
      if (qtd < lim) return true;
      UI.avisar(tipo === 'categorias' ? 'Chegou no limite de ' + lim + ' categorias. Para criar outra, junte duas ou exclua uma que não usa mais.'
        : tipo === 'itens' ? 'Chegou no limite de ' + lim + ' itens no ' + R.catalogo(l).nome + '. Para criar outro, exclua um que não vende mais.'
        : tipo === 'grupos' ? 'Chegou no limite de ' + lim + ' grupos de opções. Um grupo vale para várias categorias: use o mesmo em vez de criar outro igual.'
        : 'Esse grupo chegou no limite de ' + lim + ' opções. Exclua uma que não usa mais para criar outra.');
      return false;
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
        return salvarLoja(mudancas, aviso).then(function () { UI.fecharModal(); estado.categoriaAtiva = null; desenharCardapio(); return true; }).catch(function () { return false; /* ja avisou */ });
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
          var fotos = estado.loja.produtos.filter(function (p) { return p.categoria === cat.id && p.foto; }).map(function (p) { return p.foto; });
          concluir({ produtos: estado.loja.produtos.filter(function (p) { return p.categoria !== cat.id; }) }, 'Categoria e itens excluídos').then(function (ok) {
            if (ok) fotos.forEach(function (id) { store.excluirFoto(slug, id).catch(function () { /* ignora */ }); });
          });
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
        el('button', { class: 'editar editar-grupo', 'aria-label': 'Editar', title: 'Editar', onclick: function () { editarGrupo(chave, categoriaId); } }, [UI.iconeLinha('lapis')]),
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
          el('button', { class: 'editar', 'aria-label': 'Remover ' + op.nome, onclick: function () {
            UI.perguntar('Remover a opção "' + op.nome + '"?', { sim: 'Remover', perigo: true }).then(function (sim) { if (sim) removerOpcao(chave, indice); });
          } }, [UI.iconeLinha('fechar')]),
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
      if (!cabeMais('opcoes', chave)) return;
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
        var linha = el('label', { class: 'opcao' + (marcado ? ' marcada' : '') }, [cb, el('span', { class: 'marcador quadrado' }, [UI.iconeLinha('check')]), el('span', { class: 'rotulo', text: c.nome })]);
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

      /* dia que ja fechou vem do resumo guardado (1 documento por mes); so hoje le os pedidos.
         Memoria de 5 minutos por periodo: trocar de aba ou de periodo e voltar nao le o banco de novo */
      estado.vendasMemoria = estado.vendasMemoria || {};
      var guardada = estado.vendasMemoria[dias];
      var buscar = guardada && Date.now() - guardada.em < 5 * 60 * 1000 ? Promise.resolve(guardada.r)
        : store.vendasDoPeriodo(slug, dias).then(function (r) { estado.vendasMemoria[dias] = { em: Date.now(), r: r }; return r; });
      buscar.catch(function () {
        UI.limpar(conteudo); conteudo.appendChild(el('p', { class: 'muted centro', text: 'Não deu para carregar as vendas. Confira a internet e abra a aba de novo.' })); return null;
      }).then(function (r) {
        if (!r) return;
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
            conteudo.appendChild(el('div', { class: 'grafico-vazio' }, [el('div', { class: 'icone' }, [UI.iconeLinha('vendas')]), el('p', { text: 'Nenhuma venda nesse período ainda. Assim que entrar pedido, o gráfico aparece aqui.' })]));
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
          var nomes = { pix: 'Pix', cartao_online: 'Cartão pelo site', cartao_entrega: 'Maquininha', dinheiro_entrega: 'Dinheiro' };
          conteudo.appendChild(el('h3', { text: 'Como pagaram' }));
          conteudo.appendChild(el('div', { class: 'lista-simples' }, formas.map(function (f) { return el('div', { class: 'linha' }, [el('span', { text: nomes[f] || f }), el('b', { text: r.porForma[f] + ' pedidos' })]); })));
        }

        /* clientes (ja somados por dia no resumo) */
        var listaClientes = r.clientes || [];
        if (listaClientes.length) {
          conteudo.appendChild(el('h3', { text: 'Seus clientes no período · ' + listaClientes.length }));
          /* a lista cresce sem limite: 15 de cada vez, com filtro, pra pagina nao virar um rolo */
          var filtro = el('input', { type: 'search', class: 'busca', placeholder: 'Nome, bairro ou telefone', 'aria-label': 'Filtrar clientes' });
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
          conteudo.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', onclick: function () {
            /* celula segura: texto que comeca com = + - @ vira texto (nada de formula no Excel), com aspas quando precisa */
            var celula = function (v) { var t = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' '); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
            var csv = 'Nome;WhatsApp;Bairro;Pedidos;Total\n' + listaClientes.map(function (c) { return [celula(c.nome), celula(c.telefone), celula(c.bairro), c.pedidos, (c.total / 100).toFixed(2).replace('.', ',')].join(';'); }).join('\n');
            UI.copiar(csv).then(function () { UI.avisar('Lista copiada. Cole no Excel ou no Planilhas.'); });
          } }, [UI.iconeLinha('copiar'), 'Copiar para o Excel']));
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
      f.capa = UI.campoFoto('Capa', l.capa ? D.fotoSrc({ foto: l.capa }, estado.fotos) : (l.capaUrl || null), { lado: 1080, qualidade: 0.72, larga: true, vazio: 'imagem' });
      f.logo.hidden = true; f.capa.hidden = true; /* quem mostra e a previa; eles so guardam a foto */
      /* loja com design exclusivo (feito pelo Ligeiro): cores, estilo e capa sao do design e ficam travados, para o dono
         nao quebrar o visual sem querer (e o tema passaria por cima do que ele mudasse). So a logo continua livre */
      var exclusiva = !!UI.lojaOficial(slug);
      f.previa = previaDaLoja(l, f, exclusiva);
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
      f.descricao.input.addEventListener('input', function () { f.previa.atualizar(); });
      f.avisoTopo = campoTexto('Aviso no topo do site', l.avisoTopo, { max: 120, largo: true, placeholder: 'Ex: Hoje só entrega no Centro', ajuda: 'Aparece em destaque para o cliente. Deixe vazio para não mostrar.' });
      f.cidade = window.LigeiroCidades.campo(l.cidade, l.uf, { rotulo: 'Cidade', ajuda: 'Escolha na lista. É a página da cidade em que sua loja aparece.' });
      f.endereco = campoTexto('Endereço da loja', l.endereco, { max: 120, largo: true });
      f.whatsapp = campoTexto('WhatsApp da loja', R.formatarTelefone(l.whatsapp), { max: 16, inputmode: 'numeric', ajuda: 'Com DDD. É para onde o cliente fala com você.' });
      UI.mascaraTelefone(f.whatsapp.input);
      f.instagram = campoTexto('Instagram (sem @)', l.instagram, { max: 40 });
      f.google = campoTexto('Avaliações no Google (opcional)', l.googleUrl, { max: 400, inputmode: 'url', placeholder: 'https://g.page/r/…/review', ajuda: 'No seu Perfil da Empresa no Google, toque em Pedir avaliações e cole o link aqui (serve também o link da loja no Maps). Depois da entrega, o cliente é convidado a avaliar: é o que faz a loja subir no Google.' });
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
      var controles = exclusiva ? el('div', { class: 'aparencia-controles' }, [
        el('div', { class: 'design-exclusivo' }, [
          el('div', { class: 'design-exclusivo-topo' }, [
            el('span', { class: 'design-exclusivo-ico' }, [UI.iconeLinha('cadeado')]),
            el('div', { class: 'design-exclusivo-texto' }, [
              el('b', { text: 'Design exclusivo' }),
              el('span', { text: 'Sua loja tem um visual feito sob medida pelo Ligeiro. Cores, estilo e capa ficam travados para nada sair do lugar. A logo você troca quando quiser.' }),
            ]),
          ]),
        ]),
        f.medidas,
      ]) : el('div', { class: 'aparencia-controles' }, [f.cor, f.estilo, emojiDetalhe, f.medidas, exclusivo]);
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
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { UI.copiar(l.slug).then(function (ok) { UI.avisar(ok ? 'ID copiado: ' + l.slug : 'Toque e segure no código para copiar'); }); } }, [UI.iconeLinha('copiar'), 'Copiar']),
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
      /* Duas turmas, como o cliente ve no fechamento: "Pelo site" (Pix e cartao, pela conta Mercado Pago da loja) e "Na
         entrega ou no balcao". A conexao e uma so para o Pix e o cartao: desconectada, a caixa ensina em 3 passos e os
         interruptores do site nem aparecem (ligado sem conexao dizia "ligado" com nada funcionando). No fim, o resumo do
         que vale hoje, que muda na hora a cada interruptor. */
      var cfgMP = window.LIGEIRO_CONFIG || {};
      var pixPossivel = D.modoDemo || !!cfgMP.proxyMercadoPago;
      var temConexao = D.modoDemo || !!cfgMP.mercadoPagoClientId;
      pagamento.appendChild(el('div', { class: 'forma-grupo', text: 'Pelo site · Mercado Pago' }));
      f.mpAtivo = interruptorCampo('Pix pelo site', 'Cai na hora na sua conta. Taxa do Mercado Pago: cerca de 1%.', !!l.mpAtivo);
      f.mpToken = campoTexto('Access Token do Mercado Pago', '', { max: 200, tipo: 'password', placeholder: D.modoDemo ? 'Digite SIMULACAO' : 'Começa com APP_USR-', ajuda: 'Fica guardado em segredo, só a loja e o Ligeiro veem. Cole outro só para trocar.' });
      f.mpToken.input.setAttribute('autocomplete', 'off');
      f.mpToken.temSalvo = false;
      f.mpToken.lido = false; /* vira true quando a leitura da conexao responde */
      f.mpToken.erro = false; /* a leitura falhou: salvar nao mexe no Pix nem no cartao */
      function desligarChavePix() { f.mpAtivo.chave.ligado = false; f.mpAtivo.chave.classList.remove('on'); }
      /* Cartao de credito pelo site: o formulario seguro do Mercado Pago abre no celular do cliente e o pedido cai pago.
         Vem da mesma conexao do Pix (e dela que sai a chave publica do formulario). Conexao antiga, sem a chave: um toque
         em "Liberar o cartao" abre o Mercado Pago, a pessoa toca em Autorizar e volta com o cartao ligado */
      f.aceitaCartaoOnline = interruptorCampo('Cartão de crédito pelo site', 'À vista, cai na hora. Taxa do Mercado Pago: cerca de 5%.', l.aceitaCartaoOnline === true);
      var liberarCartao = el('div', { class: 'mp-liberar', hidden: true }, [
        el('p', { class: 'muted pequeno', text: 'Falta um toque para o cartão: autorize de novo no Mercado Pago e volte. Ele já volta ligado.' }),
        el('button', { class: 'btn btn-principal btn-largo btn-mp', type: 'button', onclick: function () {
          if (ajustesPendentes()) { UI.avisar('Salve os ajustes antes: a liberação sai desta tela.'); return; }
          if (D.modoDemo) { salvarLoja({ mpChavePublica: 'TEST-demo', aceitaCartaoOnline: true, mpAtivo: true }, 'Cartão de crédito ligado (simulado).').then(function () { desenharAjustes(); }); return; }
          UI.guardarLocal('ligeiro:ligar-cartao:' + slug, true);
          window.LigeiroMP.conectar(slug).catch(function (e) { UI.guardarLocal('ligeiro:ligar-cartao:' + slug, null); UI.avisar(D.erroAmigavel(e, 'Não deu para abrir o Mercado Pago agora.')); });
        } }, [UI.iconeLinha('cartao'), 'Liberar o cartão']),
      ]);
      /* os interruptores do site: so aparecem com o Mercado Pago conectado */
      /* Taxa do cartao: uma chave so, sem porcentagem (o dono nao faz conta). Ligada, o site soma o bastante para a loja
         receber o valor cheio (R.TAXA_CARTAO_PADRAO); o cliente ve em reais antes de pagar, como a lei 13.455/2017 pede.
         Loja com outra % ja gravada mantem a dela. O exemplo em reais diz o que acontece nos dois jeitos */
      var taxaAtual = R.taxaCartaoRepassada(l);
      f.repassarTaxa = interruptorCampo('Cliente paga a taxa do cartão', 'Ele vê o valor antes de pagar. No Pix não muda nada.', taxaAtual > 0);
      f.repassarTaxa.valor = function () { return f.repassarTaxa.chave.ligado ? (taxaAtual || R.TAXA_CARTAO_PADRAO) : 0; };
      var exemploTaxa = el('p', { class: 'taxa-exemplo' });
      function pintarTaxa() {
        var venda = 5000, t = f.repassarTaxa.valor();
        var cliente = venda + Math.round(venda * t / 100);
        var recebe = cliente - Math.round(cliente * 0.0498);
        UI.limpar(exemploTaxa);
        exemploTaxa.appendChild(UI.iconeLinha('cartao'));
        exemploTaxa.appendChild(el('span', { text: t
          ? 'Numa venda de ' + dinheiro(venda) + ', o cliente paga ' + dinheiro(cliente) + ' no cartão e você recebe ' + (recebe >= venda ? 'os ' + dinheiro(venda) + ' inteiros.' : 'cerca de ' + dinheiro(recebe) + '.')
          : 'Numa venda de ' + dinheiro(venda) + ' no cartão, o Mercado Pago desconta cerca de ' + dinheiro(venda - recebe) + ' de você.' }));
      }
      f.repassarTaxa.chave.addEventListener('click', pintarTaxa);
      var taxaDoCartao = el('div', { class: 'mp-taxa' }, [f.repassarTaxa, exemploTaxa]);
      pintarTaxa();
      var formasDoSite = el('div', { class: 'mp-formas', hidden: true }, [f.mpAtivo, f.aceitaCartaoOnline, taxaDoCartao, liberarCartao]);
      var conexao = el('div', { class: 'mp-conexao' });
      var caixaMP = el('div', { class: 'mp-caixa' }, [conexao, formasDoSite]);
      function mostrarFormasDoSite(sim) { formasDoSite.hidden = !sim; f.mpAtivo.chave.hidden = !sim; }
      function botaoConectar() {
        return el('button', { class: 'btn btn-principal btn-largo btn-mp', type: 'button', onclick: function () {
          if (ajustesPendentes()) { UI.avisar('Salve os ajustes antes de conectar: a conexão sai desta tela.'); return; }
          window.LigeiroMP.conectar(slug).then(function (r) {
            if (r === 'demo') { UI.avisar('Na demonstração, conectado (simulado).'); return salvarLoja({ mpAtivo: true, aceitaPix: true, mpChavePublica: 'TEST-demo' }, 'Mercado Pago conectado. Pix ligado.').then(function () { ligarMP(); desenharAjustes(); }); }
          }).catch(function (e) { UI.avisar(D.erroAmigavel(e, 'Não deu para conectar agora.')); });
        } }, [UI.iconeLinha('link'), 'Conectar Mercado Pago']);
      }
      /* caixa da conexao: desconectada ensina em 3 passos; conectada, o selo com a data e o Desconectar */
      function desenharConexao(c) {
        f.mpToken.lido = true;
        f.mpToken.erro = false;
        UI.limpar(conexao);
        var conectado = !!(c && c.token);
        f.mpToken.temSalvo = conectado;
        /* sem conexao o Pix nao funciona: os interruptores somem e salvar grava desligado (o cliente para de ver um Pix quebrado) */
        mostrarFormasDoSite(conectado);
        if (!conectado) desligarChavePix();
        pintarCartao();
        pintarResumo();
        if (conectado) {
          conexao.appendChild(el('div', { class: 'mp-conectado' }, [
            el('span', { class: 'mp-selo' }, [UI.iconeLinha('feito'), 'Mercado Pago conectado']),
            el('span', { class: 'muted pequeno', text: (c.conectadoEm ? 'desde ' + new Date(c.conectadoEm).toLocaleDateString('pt-BR') : '') + (c.mpUserId ? ' · conta ' + c.mpUserId : '') }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Desconectar', onclick: function () {
              UI.perguntar('Desconectar o Mercado Pago? O Pix e o cartão pelo site param até conectar de novo.', { sim: 'Desconectar', perigo: true }).then(function (sim) {
                if (!sim) return;
                window.LigeiroMP.desconectar(slug).then(function () { return salvarLoja({ mpAtivo: false, aceitaPix: false, aceitaCartaoOnline: false }, 'Mercado Pago desconectado.'); }).then(function () { desenharAjustes(); });
              });
            } }),
          ]));
          return;
        }
        conexao.appendChild(el('div', { class: 'mp-convite' }, [
          el('b', { text: 'Receba Pix e cartão pelo site' }),
          el('span', { class: 'muted pequeno', text: 'O pedido chega pago na cozinha. Ninguém confere comprovante, e print falso não passa.' }),
        ]));
        conexao.appendChild(el('ol', { class: 'passos-conectar' }, [
          el('li', {}, [el('span', { class: 'numero', text: '1' }), el('span', {}, ['Toque em ', el('b', { text: 'Conectar Mercado Pago' })])]),
          el('li', {}, [el('span', { class: 'numero', text: '2' }), el('span', { text: 'Entre na sua conta do Mercado Pago (ou crie uma, grátis)' })]),
          el('li', {}, [el('span', { class: 'numero', text: '3' }), el('span', {}, ['Toque em ', el('b', { text: 'Autorizar' }), ' e volte: o Pix já volta ligado'])]),
        ]));
        conexao.appendChild(botaoConectar());
        conexao.appendChild(el('p', { class: 'muted pequeno', text: 'Taxas do Mercado Pago: cerca de 1% no Pix e 5% no cartão. O dinheiro cai na sua conta e o Ligeiro não cobra nada por venda.' }));
      }
      /* a leitura falhou (internet caiu): diz e deixa tentar de novo. Os interruptores ficam como estavam: salvar nao mexe */
      function erroConexao() {
        UI.limpar(conexao);
        f.mpToken.lido = true;
        f.mpToken.erro = true;
        formasDoSite.hidden = true;
        pintarResumo();
        conexao.appendChild(el('p', { class: 'aviso aviso-falta' }, [UI.iconeLinha('alerta'), el('span', { text: 'Não deu para conferir a conexão com o Mercado Pago agora.' })]));
        conexao.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Tentar de novo', onclick: lerConexaoAgora }));
      }
      function lerConexaoAgora() {
        UI.limpar(conexao);
        formasDoSite.hidden = true;
        conexao.appendChild(el('p', { class: 'mp-lendo' }, [el('span', { class: 'girando' }), 'Conferindo a conexão com o Mercado Pago…']));
        window.LigeiroMP.lerConexao(l.slug).then(desenharConexao, erroConexao);
      }
      if (!pixPossivel) {
        desligarChavePix();
        f.mpToken.lido = true;
        conexao.appendChild(el('p', { class: 'muted pequeno', text: 'Pix e cartão pelo site chegam em breve.' }));
      } else if (temConexao) {
        if (window.LigeiroMP) lerConexaoAgora(); else desenharConexao(null);
      } else {
        /* sem o aplicativo do Ligeiro no Mercado Pago: colar o token (so o Pix; o cartao pede a conexao pelo botao) */
        f.mpToken.lido = true;
        mostrarFormasDoSite(true);
        caixaMP.appendChild(el('details', { class: 'avancado', open: true }, [
          el('summary', { text: 'Colar o token do Mercado Pago' }),
          f.mpToken,
          el('ol', { class: 'passos-mp' }, [
            el('li', {}, [el('b', { text: 'Tenha uma conta no Mercado Pago' }), ' (app, grátis) com uma chave Pix cadastrada nela. É lá que o dinheiro do cliente cai; você transfere para o banco quando quiser.']),
            el('li', {}, [el('b', { text: 'Pegue o Access Token' }), ': no site do Mercado Pago, Suas integrações › Criar aplicação › Credenciais de produção › Access Token. Começa com APP_USR.']),
            el('li', {}, [el('b', { text: 'Cole acima, ligue e salve.' }), ' Faça um pedido de teste de R$ 1 pelo seu site: pagou, o pedido vira "pago" sozinho em segundos.']),
          ]),
        ]));
        if (window.LigeiroMP) window.LigeiroMP.lerConexao(l.slug).then(function (c) { f.mpToken.temSalvo = !!(c && c.token); pintarResumo(); }, function () { /* fica o que esta na tela */ });
      }
      pagamento.appendChild(caixaMP);
      /* pode ligar: Mercado Pago conectado pelo botao e com a chave publica */
      function cartaoPodeLigar() { return pixPossivel && temConexao && f.mpToken.temSalvo && !!estado.loja.mpChavePublica; }
      function pintarCartao() {
        if (!liberarCartao) return; /* a conexao respondeu antes de a linha do cartao existir: ela se pinta ao nascer */
        if (f.mpToken.erro) return; /* sem saber da conexao: fica como estava */
        var pode = cartaoPodeLigar();
        var falta = pixPossivel && temConexao && f.mpToken.temSalvo && !estado.loja.mpChavePublica;
        f.aceitaCartaoOnline.hidden = !pode && !falta;
        f.aceitaCartaoOnline.chave.hidden = !pode;
        liberarCartao.hidden = !falta;
        taxaDoCartao.hidden = !pode || !f.aceitaCartaoOnline.chave.ligado;
        if (!pode && f.mpToken.lido) { f.aceitaCartaoOnline.chave.ligado = false; f.aceitaCartaoOnline.chave.classList.remove('on'); }
      }
      f.aceitaCartaoOnline.chave.addEventListener('click', pintarCartao);
      pintarCartao();
      f.aceitaCartaoEntrega = interruptorCampo('Cartão na maquininha', 'Crédito ou débito, quando o cliente recebe ou busca.', !!l.aceitaCartaoEntrega);
      f.aceitaDinheiroEntrega = interruptorCampo('Dinheiro', 'O cliente já diz se precisa de troco.', !!l.aceitaDinheiroEntrega);
      f.aceitaPagarNoBalcao = interruptorCampo('Quem retira pode pagar no balcão', 'Desligado, quem retira paga pelo site.', l.aceitaPagarNoBalcao !== false);
      pagamento.appendChild(el('div', { class: 'forma-grupo mais-longe', text: 'Na entrega ou no balcão' }));
      [f.aceitaCartaoEntrega, f.aceitaDinheiroEntrega, f.aceitaPagarNoBalcao].forEach(function (c) { pagamento.appendChild(c); });
      /* o que vale hoje, com as mesmas contas do site do cliente: sem Pix e sem "pagar no balcao", quem busca nao tem como pagar */
      var resumoPag = el('p', { class: 'aviso', hidden: true });
      function pintarResumo() {
        if (!f.mpToken.lido || f.mpToken.erro) { resumoPag.hidden = true; return; }
        var pix = pixPossivel && f.mpAtivo.chave.ligado && (f.mpToken.temSalvo || !!f.mpToken.input.value.trim());
        var cartaoSite = cartaoPodeLigar() && f.aceitaCartaoOnline.chave.ligado;
        var cartao = f.aceitaCartaoEntrega.chave.ligado, dinheiroNaPorta = f.aceitaDinheiroEntrega.chave.ligado;
        var formas = [];
        if (pix) formas.push('Pix');
        if (cartaoSite) formas.push('cartão pelo site');
        if (cartao) formas.push('maquininha');
        if (dinheiroNaPorta) formas.push('dinheiro');
        /* "pagar no balcao" so faz sentido com maquininha ou dinheiro ligados */
        f.aceitaPagarNoBalcao.hidden = !cartao && !dinheiroNaPorta;
        var retiradaSemComo = !pix && !cartaoSite && formas.length && f.aceitaRetirada.chave.ligado && !f.aceitaPagarNoBalcao.chave.ligado;
        var texto = !formas.length ? 'Nenhuma forma de pagamento ligada: o cliente não consegue fechar o pedido.'
          : retiradaSemComo ? 'Sem pagar pelo site, quem vai buscar não tem como pagar. Ligue "Quem retira pode pagar no balcão".'
          : 'Hoje o cliente paga com ' + (formas.length > 1 ? formas.slice(0, -1).join(', ') + ' e ' + formas[formas.length - 1] : formas[0]) + '.';
        var falta = !formas.length || retiradaSemComo;
        UI.limpar(resumoPag);
        resumoPag.hidden = false;
        resumoPag.classList.toggle('aviso-falta', falta);
        resumoPag.appendChild(UI.iconeLinha(falta ? 'alerta' : 'feito'));
        resumoPag.appendChild(el('span', { text: texto }));
      }
      pagamento.appendChild(resumoPag);
      /* os interruptores trocam no clique deles; o resumo vem logo depois (o clique sobe ate o bloco) */
      pagamento.addEventListener('click', function (e) { if (e.target.closest('.chave')) pintarResumo(); });
      pagamento.addEventListener('input', pintarResumo);
      f.aceitaRetirada.chave.addEventListener('click', pintarResumo);
      pintarResumo();
      s.appendChild(pagamento);

      var noSite = el('div', { class: 'bloco-form', id: 'aj-site' }, [el('div', { class: 'bloco-titulo', text: 'No seu site' })]);
      f.permitePersonalizar = interruptorCampo('Cliente pode tirar ingredientes e mandar recado', 'Ex.: sem cebola, bem passado.', l.permitePersonalizar !== false);
      f.mostrarOutras = interruptorCampo('Mostrar "outros estabelecimentos da cidade" no meu site', 'Desligado, o seu link é só seu: o cliente não vê concorrente. Ligado, sua loja vira parte da vitrine da cidade e ganha o link de volta.', l.mostrarOutras === true);
      noSite.appendChild(f.permitePersonalizar);
      noSite.appendChild(f.mostrarOutras);
      /* o jogo vem ligado em toda loja; so some se o dono desligar aqui (campo jogoDesligado) */
      f.jogo = interruptorCampo('Joguinho enquanto o cliente espera', 'Depois de pago, a tela do pedido convida para a Corrida do Ligeiro. Roda no celular do cliente e não gasta nada do banco.', l.jogoDesligado !== true);
      noSite.appendChild(f.jogo);
      s.appendChild(noSite);

      var cupons = el('div', { class: 'bloco-form' }, [el('div', { class: 'bloco-titulo', text: 'Cupons de desconto' })]);
      var listaCupons = el('div', { class: 'pilha' });
      /* a lista mora na parte privada da loja (o cliente nao ve os codigos): carrega na primeira vez que os Ajustes abrem,
         e so a lista se redesenha (o resto dos Ajustes, talvez com algo digitado, fica como esta) */
      function buscarCupons() {
        UI.limpar(listaCupons);
        listaCupons.appendChild(el('small', { class: 'muted', text: 'Carregando os cupons…' }));
        carregarCupons().then(function () { if (vivo && listaCupons.isConnected) pintarCupons(); }, function () {
          if (!vivo || !listaCupons.isConnected) return;
          UI.limpar(listaCupons);
          listaCupons.appendChild(el('div', { class: 'aviso' }, [UI.iconeLinha('alerta'), el('span', { text: 'Não deu para carregar os cupons agora.' })]));
          listaCupons.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Tentar de novo', onclick: buscarCupons }));
        });
      }
      if (!estado.cupons) buscarCupons();
      else pintarCupons();
      function pintarCupons() {
        UI.limpar(listaCupons);
        (estado.cupons || []).forEach(function (c, i) {
          var chave = el('button', { class: 'chave' + (c.ativo !== false ? ' on' : ''), type: 'button', 'aria-label': 'Ligar ou desligar ' + c.codigo, onclick: function () {
            var lista = D.clonar(estado.cupons);
            lista[i].ativo = !(lista[i].ativo !== false);
            salvarCupons(lista, 'Cupom ' + (lista[i].ativo ? 'ligado' : 'desligado')).then(desenharAjustes);
          } });
          var excluir = el('button', { class: 'editar', type: 'button', 'aria-label': 'Excluir ' + c.codigo, onclick: function () {
            UI.perguntar('Excluir o cupom ' + c.codigo + '?', { sim: 'Excluir', perigo: true }).then(function (sim) {
              if (!sim) return;
              salvarCupons(estado.cupons.filter(function (x) { return x.codigo !== c.codigo; }), 'Cupom excluído').then(desenharAjustes);
            });
          } }, [UI.iconeLinha('fechar')]);
          function textoUsos(usos) { return (c.minimo ? 'a partir de ' + dinheiro(c.minimo) + ' · ' : '') + (c.limite ? usos + ' de ' + c.limite + ' usos' : usos + ' usos'); }
          var usosTexto = el('small', { text: textoUsos(c.usos || 0) });
          /* na nuvem os usos contam em contadores/cupom-CODIGO (o numero do cupom nao muda): mostra o de verdade.
             Guardado 2 min: os Ajustes redesenham a cada salvar, e cada conferida era uma leitura por cupom */
          estado.usosCupom = estado.usosCupom || {};
          var sabido = estado.usosCupom[c.codigo];
          if (sabido && Date.now() - sabido.em < 2 * 60 * 1000) usosTexto.textContent = textoUsos(sabido.n);
          else if (store.usosDoCupom) store.usosDoCupom(slug, c.codigo).then(function (n) { estado.usosCupom[c.codigo] = { n: Number(n) || 0, em: Date.now() }; usosTexto.textContent = textoUsos(Number(n) || 0); }).catch(function () { /* fica o que estava */ });
          listaCupons.appendChild(el('div', { class: 'linha-produto' + (c.ativo !== false ? '' : ' desligado') }, [
            el('div', { class: 'nome nome-cupom' }, [c.codigo + ' · ' + c.percentual + '%', usosTexto]),
            excluir,
            chave,
          ]));
        });
      }
      cupons.appendChild(listaCupons);
      cupons.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '+ Criar cupom', onclick: novoCupom }));
      s.appendChild(cupons);

      /* sons do painel: o dono ouve cada um e sabe o que significa */
      var listaSons = [['apito', 'Pedido novo', 'Alto, para ouvir da cozinha', 'sino'], ['pago', 'Pagamento caiu', 'Pix ou cartão: o pedido já pode começar', 'dinheiro'], ['cancelado', 'Cliente cancelou', 'O pedido saiu da fila', 'fechar'], ['lembrete', 'Pedido parado', 'Pago há mais de 5 minutos sem começar', 'relogio']];
      s.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Sons do painel' }),
        el('p', { class: 'muted pequeno', text: 'Toque para ouvir cada aviso. Para silenciar tudo, use o botão Apito lá em cima.' }),
        el('div', { class: 'sons-lista' }, listaSons.map(function (x) {
          return el('button', { type: 'button', class: 'som-linha', onclick: function () { if (!UI.somLigado()) { UI.avisar('O apito está desligado. Ligue no botão Apito, lá em cima.'); return; } UI.soar(x[0]); } }, [
            el('span', { class: 'som-texto' }, [el('b', {}, [UI.iconeLinha(x[3]), x[1]]), el('small', { text: x[2] })]),
            el('span', { class: 'som-tocar', 'aria-hidden': 'true' }, [UI.iconeLinha('tocar')]),
          ]);
        })),
      ]));

      /* senha do painel: nenhuma no site de verdade (o dono entra com a conta Google). Na demonstracao ela e a senha da
         equipe (Minha loja, Senha da equipe): um lugar so, igual ao site de verdade */

      s.appendChild(el('button', { class: 'btn btn-principal btn-largo', text: 'Salvar tudo', onclick: function () { salvarAjustes(f); } }));
      /* barra fixa: salva de qualquer ponto da pagina, sem descer ate o fim */
      var estadoSalvar = el('span', { class: 'salvar-estado', text: 'Ajustes da loja' });
      var barraSalvar = el('div', { class: 'salvar-fixo' }, [estadoSalvar, el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', onclick: function () { salvarAjustes(f); } }, [UI.iconeLinha('check'), 'Salvar tudo'])]);
      s.appendChild(barraSalvar);
      s.classList.add('com-salvar');
      function marcarMudanca() {
        if (estadoSalvar.classList.contains('pendente')) return;
        UI.limpar(estadoSalvar);
        estadoSalvar.appendChild(el('span', { class: 'bolinha', 'aria-hidden': 'true' }));
        estadoSalvar.appendChild(document.createTextNode('Alterações não salvas'));
        estadoSalvar.classList.add('pendente');
      }
      s.addEventListener('input', marcarMudanca);
      s.addEventListener('change', marcarMudanca);
      s.addEventListener('click', function (e) { if (e.target.closest('.chave, .cor, .aba-painel, .foto-botoes button')) marcarMudanca(); });
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
      /* o 2o turno nasce sem bater no primeiro: quem abre a noite ganha o almoco; quem abre de dia ganha a janta */
      function segundoTurno(e) { var t = e.turnos[0] || ['', '']; return t[0] >= '15:00' ? ['11:00', '14:00'] : ['18:00', '23:00']; }
      function desenharDia(dia) {
        var e = estadoH[dia];
        var linha = el('div', { class: 'dia-linha' + (e.aberto ? '' : ' fechado') });
        var chave = el('button', { type: 'button', class: 'chave' + (e.aberto ? ' on' : ''), 'aria-label': (e.aberto ? 'Fechar ' : 'Abrir ') + nomes[dia] });
        chave.addEventListener('click', function () { e.aberto = !e.aberto; redesenhar(dia); });
        /* no celular a acao do 2o turno mora no cabecalho, do lado da chave: as linhas de hora ficam so com hora */
        var acao = !e.aberto ? null : el('button', { type: 'button', class: 'dia-acao' + (e.turnos.length > 1 ? ' tirar' : ''), 'aria-label': (e.turnos.length > 1 ? 'Tirar o 2º turno de ' : 'Adicionar 2º turno em ') + nomes[dia], onclick: function () {
          if (e.turnos.length > 1) e.turnos.splice(1, 1); else e.turnos.push(segundoTurno(e));
          redesenhar(dia);
        } }, e.turnos.length > 1 ? [UI.iconeLinha('fechar'), '2º turno'] : ['+ 2º turno']);
        linha.appendChild(el('div', { class: 'dia-cabeca' }, [el('b', { class: 'dia-nome', text: nomes[dia] }), chave, el('span', { class: 'dia-estado', text: e.aberto ? 'Aberto' : 'Fechado' }), acao]));
        if (e.aberto) {
          var turnos = el('div', { class: 'turnos' + (e.turnos.length > 1 ? ' dois' : '') });
          e.turnos.forEach(function (t, i) {
            var turno = el('div', { class: 'turno' }, [
              el('span', { class: 'muted', text: i === 0 ? 'das' : 'e das' }),
              relogio(t[0], function (v) { t[0] = v; }),
              el('span', { class: 'muted', text: 'até' }),
              relogio(t[1], function (v) { t[1] = v; }),
              i === 1 ? el('button', { type: 'button', class: 'btn btn-fantasma btn-mini', 'aria-label': 'Tirar o segundo turno', onclick: function () { e.turnos.splice(1, 1); redesenhar(dia); } }, [UI.iconeLinha('fechar')]) : null,
            ]);
            turnos.appendChild(turno);
          });
          linha.appendChild(turnos);
          if (e.turnos.length < 2) linha.appendChild(el('button', { type: 'button', class: 'btn btn-fantasma btn-mini dia-mais', title: 'Adicionar 2º turno (para quem abre no almoço e na janta)', 'aria-label': 'Adicionar 2º turno em ' + nomes[dia], html: '<span class="mais-sinal">+</span><span class="mais-texto"> 2º turno</span>', onclick: function () { e.turnos.push(segundoTurno(e)); redesenhar(dia); } }));
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
        el('button', { type: 'button', class: 'btn btn-fantasma btn-pequeno', title: 'Copia o horário de segunda para todos os outros dias', onclick: function () {
          var base = estadoH.seg;
          dias.forEach(function (d) { if (d[0] !== 'seg') { estadoH[d[0]] = { aberto: base.aberto, turnos: base.turnos.map(function (t) { return [t[0], t[1]]; }) }; redesenhar(d[0]); } });
          UI.avisar('Segunda copiada para os outros dias. Ajuste o que for diferente.');
        } }, [UI.iconeLinha('copiar'), 'Repetir a segunda']),
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
      var cartaoLigado = f.mpToken.erro ? estado.loja.aceitaCartaoOnline === true : (!f.aceitaCartaoOnline.hidden && !f.aceitaCartaoOnline.chave.hidden && f.aceitaCartaoOnline.chave.ligado);
      /* taxa do cartao: desligada grava 0 (a loja paga); ligada, a padrao (ou a que a loja ja tinha) */
      var taxaCartao = f.repassarTaxa ? f.repassarTaxa.valor() : 0;
      /* Pix que ja estava ligado so passa sem token enquanto a leitura da conexao nao respondeu (ela pode atrasar).
         Depois que respondeu sem token, trava: loja com Pix ligado e sem token nao recebe Pix nenhum. */
      var aindaLendo = estado.loja.mpAtivo === true && !f.mpToken.lido;
      if (aceitaPix && !tokenDigitado && !f.mpToken.temSalvo && !aindaLendo) return UI.avisar((D.modoDemo || !!(window.LIGEIRO_CONFIG || {}).mercadoPagoClientId) ? 'Conecte o Mercado Pago no botão do bloco Pagamento, ou desligue o Pix.' : 'Cole o Access Token do Mercado Pago ou desligue o Pix.');
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
        aceitaCartaoOnline: cartaoLigado,
        taxaCartao: taxaCartao,
        /* Mercado Pago em uso: Pix ou cartao (o cartao sozinho, com o Pix desligado, tambem precisa dele) */
        mpAtivo: aceitaPix || cartaoLigado,
        aceitaCartaoEntrega: f.aceitaCartaoEntrega.chave.ligado,
        aceitaDinheiroEntrega: f.aceitaDinheiroEntrega.chave.ligado,
        aceitaPagarNoBalcao: f.aceitaPagarNoBalcao.chave.ligado,
        permitePersonalizar: f.permitePersonalizar.chave.ligado,
        mostrarOutras: f.mostrarOutras.chave.ligado,
        jogoDesligado: !f.jogo.chave.ligado,
      };
      var logo = f.logo.valor();
      if (logo.dados) { mudancas.logoDados = logo.dados; mudancas.logoUrl = ''; }
      else if (logo.removida) { mudancas.logoDados = ''; mudancas.logoUrl = ''; }
      if (f.cnpj.input.value.trim() && !mudancas.cnpj) { f.cnpj.input.focus(); return UI.avisar('Esse CNPJ não confere. Veja se digitou os 14 números certos, ou deixe o campo vazio.'); }
      if (f.google.input.value.trim() && !mudancas.googleUrl) { f.google.input.focus(); return UI.avisar('Esse link não é do Google. No Google Maps, abra sua loja, toque em Compartilhar e cole o link aqui.'); }
      if (!mudancas.aceitaEntrega && !mudancas.aceitaRetirada) return UI.avisar('Ligue entrega ou retirada, senão ninguém consegue pedir.');
      /* o mesmo que o resumo do bloco Pagamento: sem nenhuma forma ligada, o cliente monta o pedido e nao consegue fechar */
      var pixValendo = aceitaPix && (!!tokenDigitado || f.mpToken.temSalvo || aindaLendo);
      if (!pixValendo && !cartaoLigado && !mudancas.aceitaCartaoEntrega && !mudancas.aceitaDinheiroEntrega) { document.getElementById('aj-pagamento').scrollIntoView({ block: 'center' }); return UI.avisar('Ligue pelo menos uma forma de pagamento, senão ninguém consegue fechar o pedido.'); }
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
        });
      } else if (capa.removida) {
        mudancas.capa = '';
        mudancas.capaUrl = '';
      }
      /* a capa antiga sai so depois que a loja apontou para a nova */
      var capaSai = (capa.dados || capa.removida) && capaAntiga ? capaAntiga : '';
      passo.then(function () { return salvarLoja(mudancas, 'Ajustes salvos'); })
        .then(function () { if (capaSai) store.excluirFoto(slug, capaSai).catch(function () { /* ignora */ }); window.scrollTo(0, 0); desenharAjustes(); })
        .catch(function (e) { UI.avisar(D.erroAmigavel(e, 'Não deu para salvar. Tente de novo.')); });
    }

    var MAX_CUPONS = 20;
    function novoCupom() {
      if (!estado.cupons) { UI.avisar('Espere os cupons carregarem para criar outro.'); return; }
      /* ate 20 por loja: cada cupom da lista custa uma leitura (os usos) a cada vez que os Ajustes abrem */
      if (estado.cupons.length >= MAX_CUPONS) { UI.avisar('Sua loja já tem ' + MAX_CUPONS + ' cupons, o máximo. Exclua um antigo para criar outro.'); return; }
      var codigo = campoTexto('Código', '', { max: 20, placeholder: 'Ex: BEMVINDO' });
      var percentual = campoTexto('Desconto em %', '10', { tipo: 'number' });
      var minimo = campoDinheiro('Vale a partir de', 0, 'Vazio = qualquer valor');
      var limite = campoTexto('Quantas vezes pode ser usado', '', { tipo: 'number', placeholder: 'vazio = sem limite' });
      UI.abrirModal({ titulo: 'Novo cupom', corpo: el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [codigo, percentual, minimo, limite]), rodape: [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Criar cupom', onclick: function () {
        var cod = R.semAcento(codigo.input.value).toUpperCase().replace(/[^A-Z0-9]/g, '');
        var pct = Number(percentual.input.value);
        if (cod.length < 3) return UI.avisar('Código com pelo menos 3 letras ou números.');
        if (!(pct >= 1 && pct <= 100)) return UI.avisar('Desconto entre 1 e 100.');
        var antigo = (estado.cupons || []).filter(function (c) { return c.codigo === cod; })[0];
        var lista = (estado.cupons || []).filter(function (c) { return c.codigo !== cod; });
        lista.push({ codigo: cod, percentual: pct, minimo: minimo.centavos(), limite: Number(limite.input.value) || 0, usos: antigo ? (antigo.usos || 0) : 0, ativo: true });
        /* codigo novo (ou de um cupom excluido): zera o contador antigo antes, senao o cupom nasce esgotado.
           Se o banco recusar (regra antiga), segue e cria do mesmo jeito. */
        var zerar = antigo || !store.zerarUsosDoCupom ? Promise.resolve() : store.zerarUsosDoCupom(slug, cod).catch(function () { /* ignora */ });
        zerar.then(function () { return salvarCupons(lista, 'Cupom ' + cod + (antigo ? ' atualizado' : ' criado')); }).then(function () { UI.fecharModal(); desenharAjustes(); });
      } })] });
    }

    /* Cupons na parte privada da loja (lojas/{slug}/privado/cupons): o cliente nao le a lista (antes qualquer um via os
       codigos, ate um cupom secreto de 100%). A loja publica guarda so "temCupom", para o site mostrar o campo.
       Loja antiga, com a lista no documento: passa para a parte privada aqui, uma vez */
    /* a lista mora na parte privada da loja. Leitura que falha (internet, banco) NAO vira lista vazia: salvar em cima
       apagaria os cupons de verdade. Loja antiga, com a lista ainda no documento publico: passa para a parte privada */
    function carregarCupons() {
      if (estado.cupons) return Promise.resolve(estado.cupons);
      var antigos = D.clonar(estado.loja.cupons || []);
      if (!store.lerSegredo) { estado.cupons = antigos; return Promise.resolve(estado.cupons); }
      return store.lerSegredo(slug, 'cupons', true).then(function (seg) {
        var lista = seg && Array.isArray(seg.lista) ? seg.lista : [];
        antigos.forEach(function (c) { if (!lista.some(function (x) { return x.codigo === c.codigo; })) lista.push(c); });
        estado.cupons = lista;
        if (antigos.length) return salvarCupons(lista, '').then(function () { return estado.cupons; }, function () { return estado.cupons; });
        return estado.cupons;
      });
    }
    function salvarCupons(lista, msg) {
      estado.cupons = lista;
      return store.guardarSegredo(slug, 'cupons', { lista: D.clonar(lista), atualizadoEm: new Date().toISOString() })
        .then(function () { return salvarLoja({ cupons: [], temCupom: lista.some(function (c) { return c.ativo !== false; }) }, msg); });
    }

    /* ---------------------------------------------------------- links */
    /* Avisos com a tela apagada neste aparelho: ligar, testar e desligar (cozinha e entregador ligam na tela deles) */
    function blocoDosAvisos() {
      var A = window.LigeiroAvisos;
      if (!A) return null;
      var sit = A.situacao();
      var ligado = A.aparelhoLigado(slug, 'painel');
      if (sit === 'sem' && !ligado) return null;
      var texto = ligado ? 'Ligados neste aparelho: pedido novo e Pix pago apitam aqui mesmo com a tela apagada.'
        : sit === 'instalar' ? 'No iPhone, coloque o painel na tela de início e ligue os avisos por lá.'
        : sit === 'pronto' ? 'Desligados neste aparelho. Ligue para receber pedido novo com a tela apagada.'
        : A.motivo(sit);
      var botoes = [];
      if (ligado) {
        botoes.push(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Testar', onclick: function (e) {
          var b = e.currentTarget; b.disabled = true;
          A.testarAparelho(slug, 'painel').then(function (j) { UI.avisar(j && j.simulado ? 'Na demonstração, o teste é simulado.' : 'Aviso de teste enviado. Chegou?'); }, function (err) { UI.avisar((err && err.message) || 'Não deu para testar agora.'); }).then(function () { b.disabled = false; });
        } }));
        botoes.push(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Desligar', onclick: function () {
          A.desligarAparelho(slug, 'painel').then(function () { UI.avisar('Avisos desligados neste aparelho.'); desenharLinks(); });
        } }));
      } else if (sit === 'pronto') {
        botoes.push(el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Ligar avisos', onclick: function (e) { ligarAvisos(e.currentTarget); } }));
      } else if (sit === 'instalar') {
        botoes.push(el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Ver como', onclick: function () { A.explicarIphone(); } }));
      }
      return el('div', { class: 'bloco-form senha-equipe bloco-avisos' }, [
        el('div', { class: 'senha-equipe-texto' }, [
          el('div', { class: 'bloco-titulo' }, [UI.iconeLinha('celular'), 'Avisos com a tela apagada']),
          el('p', { class: 'muted pequeno', text: texto + ' Cozinha e entregador ligam na tela deles, no botão Tela apagada.' }),
        ]),
        botoes.length ? el('div', { class: 'bloco-avisos-botoes' }, botoes) : null,
      ]);
    }

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
          el('span', { class: 'icone' }, [UI.iconeLinha(icone)]),
          el('b', { text: titulo }),
          el('p', { text: texto }),
          el('div', { class: 'linha-botoes' }, [
            el('a', { class: 'btn btn-principal btn-pequeno', href: link, target: '_blank', rel: 'noopener', text: abrir || 'Abrir' }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: copiar(link) }, [UI.iconeLinha('copiar'), 'Copiar link']), /* fila .tela-acoes: duas metades iguais */
          ]),
        ]);
      }

      /* 1. telas */
      s.appendChild(el('h2', { text: 'Minha loja' }));
      s.appendChild(el('p', { class: 'muted', text: 'Cada tela abre em outra aba, sem fechar o painel. As duas usam a senha da equipe, que você define aqui embaixo.' }));
      s.appendChild(el('div', { class: 'telas-grade' }, [
        tela('chef', 'Cozinha', 'Fila do dia em letra grande, apita quando entra pedido. Num tablet ou celular velho na cozinha.', base + '#/cozinha/' + l.slug),
        tela('entrega', 'Entregador', 'No celular do motoboy: endereço, o que cobrar, mapa, WhatsApp do cliente e "entregue".', base + '#/entrega/' + l.slug),
      ]));
      s.appendChild(el('p', { class: 'muted pequeno linha-painel-link' }, [
        'Este painel em outro aparelho: ',
        el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: copiar(linkPainel, 'Link do painel copiado.') }, [UI.iconeLinha('copiar'), 'Copiar link do painel']),
      ]));
      s.appendChild(el('div', { class: 'bloco-form senha-equipe' }, [
        el('div', { class: 'senha-equipe-texto' }, [
          el('div', { class: 'bloco-titulo' }, [UI.iconeLinha('chave'), 'Senha da equipe']),
          el('p', { class: 'muted pequeno', text: 'Cozinha e entregador abrem com ela (6 a 8 números). Você, logado, entra sem senha. Esqueceu? É só definir outra.' }),
        ]),
        el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: estado.loja.senhaEquipeEm ? 'Trocar a senha' : 'Definir a senha', onclick: function () { window.LigeiroEquipe.definirSenha(estado.loja); } }),
      ]));
      var blocoAvisos = blocoDosAvisos();
      if (blocoAvisos) s.appendChild(blocoAvisos);

      /* 2. divulgar */
      var msgWhats = 'Olá! 😊 Faça seu pedido pelo nosso ' + R.catalogo(estado.loja).nome + ': ' + linkLoja + '. É rápido, você ' + R.frasePagamento(estado.loja) + ' e acompanha pela senha.';
      var qr = el('div', { class: 'qr-caixa', style: { width: '180px', margin: '0', flex: 'none' } });
      Pix.desenharQr(qr, linkLoja, 180);
      s.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Divulgar o ' + R.catalogo(estado.loja).nome }),
        el('p', { class: 'muted pequeno', text: 'Coloque o link na bio do Instagram e no status. No WhatsApp Business, cole a mensagem em Ferramentas comerciais, Mensagem de saudação: quem mandar "oi" já recebe o ' + R.catalogo(estado.loja).nome + ', sem robô pago. Imprima o QR e cole no balcão e na sacola.' }),
        el('div', { class: 'divulgar' }, [
          qr,
          el('div', { class: 'pilha divulgar-acoes' }, [
            el('div', { class: 'caixa-link', text: linkLoja }),
            el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', onclick: copiar(linkLoja) }, [UI.iconeLinha('copiar'), 'Copiar link do ' + R.catalogo(estado.loja).nome]),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: copiar(msgWhats, 'Mensagem copiada. Cole em Ferramentas comerciais, Mensagem de saudação.') }, [UI.icone('zap'), 'Copiar a mensagem']),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { UI.copiar(R.cardapioEmTexto(estado.loja, linkLoja)).then(function () { UI.avisar(R.catalogo(estado.loja).Nome + ' copiado. Cole no WhatsApp.'); }); } }, [UI.iconeLinha('texto'), 'Copiar ' + R.catalogo(estado.loja).nome + ' em texto']),
          ]),
        ]),
      ]));
    }

    return function () { vivo = false; pararTudo(); lojaViva.parar(); UI.limparTemaOficial(raiz); };
  }

  window.LigeiroPainel = { abrir: abrir };
})();
