/*
 * Ligeiro - telas da equipe, fora do painel do dono:
 *
 *   #/cozinha/<loja>   tela da cozinha: so o que tem pra fazer, letra grande,
 *                      um toque pra "comecar" e outro pra "pronto".
 *   #/entrega/<loja>   tela do entregador: endereco, referencia, o que cobrar,
 *                      botao do mapa, do WhatsApp e "entregue".
 *
 * As duas entram com a mesma senha do painel e ficam abertas o dia todo.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;
  var $ = UI.$;
  var dinheiro = R.dinheiro;

  /* um pedido torto nunca apaga a tela da cozinha ou do entregador: vira um cartao curto e o resto aparece */
  function seguro(montar, p) {
    try { return montar(); } catch (_) {
      return el('div', { class: 'pedido-card' }, [el('div', { class: 'cliente', text: 'Senha ' + String((p && p.senha) || '?') + ': pedido com dados incompletos. Chame o dono da loja.' })]);
    }
  }

  /* cozinha e entregador: so o que entrou desde as 5 h de ontem (a noite de ontem ainda aparece). Pedido mais velho que
     ninguem concluiu nao volta para a fila: o painel mostra e conclui esses de uma vez */
  function desdeOntem(lista) {
    var ini = new Date(); if (ini.getHours() < 5) ini.setDate(ini.getDate() - 1);
    ini.setHours(5, 0, 0, 0); ini.setDate(ini.getDate() - 1);
    var desde = ini.toISOString();
    return lista.filter(function (p) { return String(p.criadoEm || '') >= desde; });
  }

  /* marca de "ja entrou" desta aba. O balcao (tablet virado para o cliente) tem a marca dele: com a do painel, quem estava
     no balcao abria a fila da equipe (nome, telefone e endereco dos clientes, cancelar) sem digitar a senha */
  function chaveSessao(slug, marca) { return 'ligeiro:' + (marca || 'painel') + ':' + slug; }
  function logado(slug, marca) { try { return sessionStorage.getItem(chaveSessao(slug, marca)) === '1'; } catch (_) { return false; } }
  function marcarLogado(slug, marca) { try { sessionStorage.setItem(chaveSessao(slug, marca), '1'); } catch (_) { /* ignora */ } }

  /* Recarga depois que o banco recusa a fila: no maximo uma vez por sessao (a mesma marca do painel).
     Sem isso, uma conta sem acesso recarrega sem fim. Sair zera a marca, e a fila de pe por 60 s tambem. */
  function chaveRecarga(slug) { return 'ligeiro:recarga:' + slug; }
  function podeRecarregar(slug) {
    try {
      if (sessionStorage.getItem(chaveRecarga(slug)) === '1') return false;
      sessionStorage.setItem(chaveRecarga(slug), '1');
      return true;
    } catch (_) { return false; }
  }
  function esquecerRecarga(slug) { try { sessionStorage.removeItem(chaveRecarga(slug)); } catch (_) { /* ignora */ } }
  /* Fila de pe 60 s sem o banco recusar: zera a marca, pra uma queda de verdade mais tarde poder recarregar.
     Nao usa o primeiro retorno da fila: com o cache ligado ele pode vir antes da recusa. Devolve a funcao que cancela. */
  function zerarRecargaDepois(slug) {
    var t = setTimeout(function () { esquecerRecarga(slug); }, 60000);
    return function () { clearTimeout(t); };
  }

  /* O banco recusou a fila (senha da equipe trocada, sessao caiu ou conta sem acesso). */
  function sessaoCaiu(raiz, slug, titulo, nomeLoja, parar) {
    try { sessionStorage.removeItem(chaveSessao(slug)); } catch (_) { /* ignora */ }
    if (podeRecarregar(slug)) {
      UI.avisar('A senha da equipe mudou ou a sessão caiu. Entre de novo.');
      /* token novo antes de recarregar: pega a permissao que acabou de mudar */
      var token = store.obterIdToken ? store.obterIdToken(true) : Promise.resolve();
      token.catch(function () { /* sem conta: a recarga pede a senha */ }).then(function () { setTimeout(function () { location.reload(); }, 1500); });
      return;
    }
    parar();
    UI.limpar(raiz);
    raiz.appendChild(el('div', { class: 'login' }, [
      el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      el('h2', { class: 'centro', text: titulo + ' · ' + nomeLoja }),
      el('p', { class: 'muted centro', text: 'Esta conta não tem acesso a esta loja. Se entrou com a senha da equipe, peça para o dono salvar essa senha de novo em Minha loja.' }),
      el('button', { class: 'btn btn-principal btn-largo', text: 'Sair', onclick: function () {
        esquecerRecarga(slug);
        var recarregar = function () { location.reload(); };
        (store.sair ? store.sair() : Promise.resolve()).then(recarregar, recarregar);
      } }),
    ]));
  }

  /* Carrega a loja, pede a senha se precisar e chama montar(loja). Devolve a funcao de limpeza.
     marca: 'balcao' guarda o "ja entrou" a parte (o painel, a cozinha e o entregador nao abrem com ela) */
  function abrirComSenha(raiz, slug, titulo, montar, marca) {
    var limpar = function () {};
    var vivo = true;
    UI.abrirOficialCedo(raiz, slug);
    /* a copia da borda (0 leituras no banco); sem ela, o banco */
    (store.lojaDaEquipe ? store.lojaDaEquipe(slug) : store.obterLoja(slug)).catch(function () { return { _erro: true }; }).then(function (loja) {
      if (!vivo) return;
      if (loja && loja._erro) { raiz.appendChild(UI.erroCarregar('Não deu para abrir esta tela. Confira a internet.', function () { location.reload(); })); return; }
      if (!loja) {
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [el('div', { class: 'icone' }, [UI.iconeLinha('busca')]), el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' })]));
        return;
      }
      UI.aplicarTemaOficial(raiz, slug);
      /* na nuvem a marca da sessao so vale se ainda existe alguem logado (senha da equipe trocada derruba o login antigo) */
      if (logado(slug, marca)) {
        if (D.modoDemo || !store.usuarioAtual) { limpar = montar(loja) || limpar; return; }
        store.usuarioAtual().then(function (u) {
          if (!vivo) return;
          if (u) { limpar = montar(loja) || limpar; return; }
          try { sessionStorage.removeItem(chaveSessao(slug, marca)); } catch (_) { /* ignora */ }
          pedirSenha();
        }).catch(function () { if (vivo) pedirSenha(); });
        return;
      }
      /* dono ja logado neste navegador: entra sem senha */
      var donoCheca = store.donoLogado ? store.donoLogado(loja) : Promise.resolve(false);
      donoCheca.then(function (ehDono) {
        if (!vivo) return;
        if (ehDono) { marcarLogado(slug, marca); UI.limpar(raiz); limpar = montar(loja) || limpar; return; }
        pedirSenha();
      });
      function pedirSenha() {
      /* a mesma entrada do painel: campo com o desenho dos campos e o erro no vermelho de erro */
      var campo = el('input', { type: 'password', inputmode: 'numeric', placeholder: '••••••', autocomplete: 'current-password', 'aria-label': 'Senha da equipe' });
      var erro = el('div', { class: 'msg-erro', hidden: true, text: 'Senha errada.' });
      var btnEntrar = el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar });
      var entrando = false; /* Enter + toque no botao: uma entrada so, senao a tela monta duas vezes */
      function entrar() {
        if (entrando) return;
        entrando = true;
        btnEntrar.disabled = true;
        store.entrarPainel(slug, campo.value).then(function (ok) {
          if (!vivo) return;
          if (!ok) { erro.textContent = 'Senha errada.'; erro.hidden = false; campo.value = ''; campo.focus(); UI.soar('erro'); return; }
          marcarLogado(slug, marca);
          UI.limpar(raiz);
          limpar(); /* derruba uma montagem anterior, se houver */
          limpar = montar(loja) || limpar;
        }, function (e) {
          /* ex.: dono com e-mail ainda nao conferido (o aviso diz o que fazer) */
          if (!vivo) return;
          erro.textContent = D.erroAmigavel(e, 'Não deu para entrar agora. Tente de novo.');
          erro.hidden = false; UI.soar('erro');
        }).then(function () { entrando = false; btnEntrar.disabled = false; });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: titulo + ' · ' + loja.nome }),
        el('p', { class: 'muted centro', text: 'Digite a senha da equipe. O dono define em Minha loja.' }),
        el('div', { class: 'campo' }, campo), erro,
        btnEntrar,
      ]));
      setTimeout(function () { campo.focus(); }, 50);
      }
    });
    return function () { vivo = false; limpar(); UI.limparTemaOficial(raiz); };
  }

  /* Modal "Senha da equipe": 6 a 8 numeros. Na nuvem o mensageiro cria/troca o usuario de equipe da loja. */
  function definirSenha(loja) {
    var campo = el('input', { type: 'text', inputmode: 'numeric', maxlength: '8', placeholder: 'Ex: 258013', 'aria-label': 'Senha da equipe', autocomplete: 'off' });
    var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
      el('p', { text: 'Essa senha abre a cozinha e o entregador da ' + loja.nome + '. Só números, de 6 a 8.' }),
      el('div', { class: 'campo' }, [el('label', { text: 'Nova senha da equipe' }), campo]),
      /* trocar a senha derruba o login antigo, mas nao na hora: o Firebase so confere quando o acesso vence (ate 1 hora) */
      el('p', { class: 'muted pequeno', text: 'Anote e passe para quem trabalha com você. Quem entrou com a senha antiga vai precisar digitar a nova: a tela pede em até uma hora.' }),
    ]);
    /* a resposta do mensageiro ("senha facil demais: ...") vira frase: maiuscula no comeco e ponto no fim */
    function frase(t) { var s = String(t || '').trim(); if (!s) return s; s = s.charAt(0).toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; }
    function salvar() {
      var pin = campo.value.replace(/\D/g, '');
      if (pin.length < 6 || pin.length > 8) return UI.avisar('Use de 6 a 8 números.');
      /* a mesma conta do mensageiro: 123456, 111111 e 654321 sao as primeiras que alguem tenta */
      if (/^(\d)\1+$/.test(pin) || '0123456789'.indexOf(pin) >= 0 || '9876543210'.indexOf(pin) >= 0) return UI.avisar('Senha fácil demais. Evite números repetidos ou em sequência, como 123456.');
      var promessa = D.modoDemo
        ? store.salvarLoja({ slug: loja.slug, senhaPainel: pin })
        : store.obterIdToken().then(function (idToken) {
          var cfg = window.LIGEIRO_CONFIG || {};
          if (!cfg.proxyMercadoPago) throw new Error('O mensageiro ainda não está no ar.');
          return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ loja: loja.slug, pin: pin }) })
            .then(function (r) {
              return r.json().catch(function () { return {}; }).then(function (j) {
                if (r.ok && j.ok) return j;
                /* a mensagem do mensageiro e para o dono ler (senha fraca, conta errada): passa inteira */
                var e = new Error(j.erro ? frase(j.erro) : 'Não deu para salvar agora. Tente de novo.');
                e.publico = true;
                throw e;
              });
            });
        });
      promessa.then(function () { UI.fecharModal(); UI.soar('sucesso'); UI.avisar('Senha da equipe salva.'); }).catch(function (e) { UI.avisar(D.erroAmigavel(e, 'Não deu para salvar agora.')); });
    }
    campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') salvar(); });
    UI.abrirModal({ titulo: 'Senha da equipe', corpo: corpo, rodape: [
      el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Cancelar', onclick: UI.fecharModal }),
      el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Salvar senha', onclick: salvar }),
    ] });
    setTimeout(function () { campo.focus(); }, 50);
  }

  function minutosDesde(iso) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }
  /* "12 min", "1 h 05", "10 h", "2 dias": a mesma conta do "ha quanto tempo" do painel (antes a cozinha mostrava "584 min") */
  function tempoNaFila(min) {
    if (min < 60) return min + ' min';
    if (min < 180) { var mm = min % 60; return Math.floor(min / 60) + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : ''); }
    var h = Math.round(min / 60);
    if (h < 24) return h + ' h';
    var d = Math.floor(min / 1440);
    return d + (d === 1 ? ' dia' : ' dias');
  }

  /* A loja das telas da equipe acompanha o cardapio do dono pela copia da borda (a mesma do cliente, confere a cada
     minuto e nao gasta leitura do banco). Antes a cozinha e o entregador ficavam com o cardapio de quando a tela abriu,
     e preco novo ou item criado depois acendia "valor nao confere" em pedido certo. aoMudar(loja) a cada mudanca */
  function lojaAtualizada(slug, aoMudar) {
    var viva = store.lojaPublica ? store.lojaPublica(slug) : null;
    if (!viva) return { conferir: function () { return Promise.resolve(null); }, parar: function () {} };
    var parado = false, pararOuvir = function () {};
    /* escuta depois da primeira: sem a borda, a loja passa a vir do banco ao vivo, e so ai da para escutar */
    viva.primeira.then(function (l) {
      if (parado) return;
      if (l) aoMudar(l);
      pararOuvir = viva.assistir(function (l2) { if (l2 && !parado) aoMudar(l2); });
    }).catch(function () { /* sem internet: fica o cardapio de quando abriu */ });
    return {
      /* a loja de agora, uma vez (antes de acender o aviso de valor) */
      conferir: function () { return viva.conferirAgora ? viva.conferirAgora().catch(function () { return null; }) : Promise.resolve(null); },
      parar: function () { parado = true; try { pararOuvir(); } catch (_) { /* ignora */ } viva.parar(); },
    };
  }

  /* Botao do apito no topo da cozinha e do entregador: "Ligar" (com o pontinho) ate o navegador liberar o som no
     primeiro toque; depois liga e desliga */
  function botaoApito(estado) {
    var btnSom = el('button', { class: 'btn btn-pequeno', type: 'button', onclick: function () {
      if (UI.somAcabouDeLiberar()) { pintarSom(); UI.soar('toque'); return; } /* esse toque so liberou o som */
      estado.somLigado = UI.somLigado(!estado.somLigado);
      pintarSom();
      if (estado.somLigado) UI.soar('toque');
    } });
    function pintarSom() {
      var travado = UI.somTravado();
      var longo = travado ? 'Toque para ligar o apito' : estado.somLigado ? 'Apito ligado' : 'Apito desligado';
      rotuloTopo(btnSom, estado.somLigado ? 'sino' : 'semsino', longo, travado ? 'Ligar' : 'Apito');
      btnSom.setAttribute('aria-label', longo);
      btnSom.classList.toggle('on', estado.somLigado);
      btnSom.classList.toggle('pedindo', travado);
      if (travado) UI.quandoLiberarSom(pintarSom);
    }
    pintarSom();
    return btnSom;
  }

  /* Escuta da fila que volta sozinha depois do limite do banco gratis (a escuta que deu erro morre): tenta de novo a
     cada 10 min, como o painel, e a faixa sai quando a fila volta. Antes a cozinha e o entregador paravam de vez */
  function filaQueVolta(raiz, assinar) {
    var parar = function () {};
    var noLimite = false, tentouEm = 0;
    function ligar() {
      try { parar(); } catch (_) { /* ignora */ }
      parar = assinar(function () {
        if (!noLimite) return;
        noLimite = false;
        var fx = raiz.querySelector('.faixa-limite');
        if (fx) fx.remove();
      }, function () { noLimite = true; tentouEm = Date.now(); UI.faixaLimite(raiz); });
    }
    ligar();
    return {
      tentarDeNovo: function () { if (noLimite && Date.now() - tentouEm > 10 * 60 * 1000) { tentouEm = Date.now(); ligar(); } },
      parar: function () { try { parar(); } catch (_) { /* ignora */ } },
    };
  }

  /* botao do topo, como no painel: icone de traco, nome inteiro no PC e o curto no celular (tercos iguais) */
  function rotuloTopo(botao, icone, longo, curto) {
    UI.limpar(botao);
    botao.appendChild(UI.iconeTraco(icone));
    botao.appendChild(el('span', { class: 'rot-longo', text: longo }));
    botao.appendChild(el('span', { class: 'rot-curto', text: curto }));
    botao.setAttribute('aria-label', longo);
    return botao;
  }
  /* topo da cozinha e do entregador: o mesmo do painel (mascote ou logo da loja com tema, botoes de vidro) */
  function topoEquipe(slug, titulo, extras, botoes) {
    var oficial = UI.lojaOficial(slug);
    return el('header', { class: 'painel-topo topo-app' + (oficial && oficial.tema ? '' : ' topo-ligeiro') + ' topo-equipe' }, [
      el('img', { class: 'logo-mini', src: (oficial && oficial.logo) || 'img/mascote-192.webp', alt: '', width: '40', height: '40' }),
      el('div', { class: 'nome', text: titulo }),
    ].concat(extras, [el('div', { class: 'painel-topo-acoes' }, botoes.filter(Boolean))]));
  }

  /* Botao "Ligar avisos" do topo da cozinha e do entregador: pedido novo (ou entrega pronta) apita com a tela apagada.
     Ligado, um toque manda um aviso de teste. Sem suporte no navegador, o botao nem aparece. */
  function botaoAvisos(slug, papel) {
    var A = window.LigeiroAvisos;
    if (!A) return null;
    var b = el('button', { class: 'btn btn-pequeno', type: 'button' });
    function pintar() {
      var ligado = A.aparelhoLigado(slug, papel);
      b.classList.toggle('on', ligado);
      rotuloTopo(b, 'celular', ligado ? 'Tela apagada: ligado' : 'Avisar com a tela apagada', 'Tela apagada');
      b.title = ligado ? 'Ligado: este aparelho apita mesmo com a tela apagada. Toque para mandar um teste.' : 'Este aparelho apita mesmo com a tela apagada';
    }
    b.addEventListener('click', function () {
      var ligado = A.aparelhoLigado(slug, papel);
      if (!ligado && A.situacao() === 'instalar') { A.explicarIphone(); return; }
      b.disabled = true;
      (ligado ? A.testarAparelho(slug, papel) : A.ligarAparelho(slug, papel)).then(function (j) {
        if (!ligado) UI.soar('sucesso');
        var oque = papel === 'entregas' ? 'Entrega pronta' : 'Pedido novo';
        UI.avisar(ligado ? (j && j.simulado ? 'Na demonstração, o teste é simulado.' : 'Aviso de teste enviado. Chegou?') : 'Pronto! ' + oque + ' apita neste aparelho mesmo com a tela apagada.' + (j && j.simulado ? ' (Na demonstração, simulado.)' : ''));
      }, function (err) {
        if (err && err.motivo === 'instalar') { A.explicarIphone(); return; }
        UI.avisar((err && err.message) || 'Não deu para ligar os avisos agora.');
      }).then(function () { b.disabled = false; pintar(); });
    });
    pintar();
    /* so aparece quando o mensageiro ja tem os avisos e o aparelho consegue receber */
    b.hidden = A.situacao() === 'sem';
    A.preparar().then(function (sit) { b.hidden = sit === 'sem'; if (!b.hidden) { A.conferirAparelho(slug, papel); A.vigiar(slug, papel); } });
    return b;
  }

  /* o pedido andou: o cliente (se ligou o aviso) e o entregador ficam sabendo. Nada no banco */
  function avisarQueAndou(slug, p, status) {
    if (window.LigeiroAvisos) window.LigeiroAvisos.pedidoAndou(slug, p, status);
  }

  /* Itens do pedido em letra grande, do jeito que a cozinha le. */
  function itensGrandes(p) {
    var caixa = el('div', { class: 'itens' });
    (p.itens || []).forEach(function (it) {
      var linha = el('div', {}, [el('b', { text: it.quantidade + 'x ' + it.nome + (it.tamanho && it.tamanho.nome ? ' ' + it.tamanho.nome : '') })]);
      if (it.adicionais && it.adicionais.length) linha.appendChild(el('div', { class: 'com', text: '+ ' + it.adicionais.map(function (a) { return a.nome; }).join(', ') }));
      if (it.removidos && it.removidos.length) linha.appendChild(el('div', { class: 'sem', text: 'SEM ' + it.removidos.join(', ') }));
      if (it.observacao) linha.appendChild(el('div', { class: 'obs-item', text: 'obs: ' + it.observacao }));
      caixa.appendChild(linha);
    });
    if (p.observacao) caixa.appendChild(el('div', { class: 'obs' }, [UI.iconeLinha('nota'), el('span', { text: p.observacao })]));
    return caixa;
  }

  /* ============================================================
   * Cozinha
   * ========================================================== */
  function abrirCozinha(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Cozinha', function (lojaInicial) {
      var estado = { loja: lojaInicial, pedidos: [], conhecidos: null, parar: [], relogio: null, somLigado: UI.somLigado(), conferidos: {} };
      document.body.classList.add('cozinha-modo');

      /* um botao so para o apito: "Ligar" (com o pontinho) ate o navegador liberar o som no primeiro toque */
      var btnSom = botaoApito(estado);
      /* sem contador no topo (cada coluna ja diz quantos) e sem ir ao painel: a cozinha so cuida da fila */
      raiz.appendChild(topoEquipe(slug, 'Cozinha · ' + estado.loja.nome, [], [btnSom, botaoAvisos(slug, 'cozinha')]));
      var colunas = el('div', { class: 'cozinha' });
      raiz.appendChild(colunas);
      /* o cardapio do dono chega aqui quando muda (preco novo, item novo): o aviso de valor confere com o de agora */
      var loja = lojaAtualizada(slug, function (l) { estado.loja = l; desenhar(); });
      estado.parar.push(loja.parar);
      /* o valor nao bateu: antes de acender o aviso, confere uma vez o cardapio de agora (o dono pode ter acabado de mudar) */
      function avisoConferido(p) {
        var aviso = avisoDeValor(estado.loja, p);
        if (!aviso || estado.conferidos[p.id] === 'feito') return aviso;
        if (!estado.conferidos[p.id]) {
          estado.conferidos[p.id] = 'indo';
          loja.conferir().then(function () { estado.conferidos[p.id] = 'feito'; desenhar(); });
        }
        return null;
      }

      function desenhar() {
        UI.limpar(colunas);
        var fazer = estado.pedidos.filter(function (p) { return p.status === R.STATUS.PAGO; });
        var fazendo = estado.pedidos.filter(function (p) { return p.status === R.STATUS.PRODUCAO; });
        fazer.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        fazendo.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        [['Para fazer', fazer, 'Ainda não tem nada esperando. Bom sinal.'], ['Fazendo agora', fazendo, 'Nada no fogo ainda.']].forEach(function (col) {
          /* o mesmo titulo de fila do painel: nome a esquerda, quantos a direita */
          var caixa = el('section', { class: 'coluna' }, [el('div', { class: 'fila-titulo', role: 'heading', 'aria-level': '2' }, [el('span', { text: col[0] }), el('span', { text: col[1].length ? String(col[1].length) : '' })])]);
          if (!col[1].length) caixa.appendChild(el('p', { class: 'muted', text: col[2] }));
          col[1].forEach(function (p) { caixa.appendChild(seguro(function () { return ficha(p); }, p)); });
          colunas.appendChild(caixa);
        });
      }

      function ficha(p) {
        var min = minutosDesde(p.pagoEm || p.criadoEm);
        var limite = Number(estado.loja.tempoPreparo) || 20;
        var f = el('div', { class: 'ficha-cozinha' + (min >= limite ? ' atrasado' : '') });
        f.appendChild(el('div', { class: 'cabeca' }, [
          /* o desenho do cartao do painel: senha e tempo em cima, o tipo embaixo */
          el('span', { class: 'senha', 'aria-label': 'Senha ' + p.senha }, [el('small', { text: 'Senha' }), el('b', { text: String(p.senha) })]),
          el('span', { class: 'selo tempo ' + (min >= limite ? 'laranja' : 'cinza'), title: 'Desde que entrou na fila' }, [UI.iconeLinha('relogio'), tempoNaFila(min)]),
          UI.seloTipo(p),
        ]));
        f.appendChild(itensGrandes(p));
        var avisoValor = avisoConferido(p);
        if (avisoValor) f.appendChild(avisoValor);
        var proximo = R.proximoStatus(p);
        var rotulo = p.status === R.STATUS.PAGO ? 'COMEÇAR' : (p.tipoEntrega === 'entrega' ? 'PRONTO, PODE SAIR' : 'PRONTO');
        if (proximo) {
          f.appendChild(el('button', { class: 'btn ' + (p.status === R.STATUS.PAGO ? 'btn-escuro' : 'btn-principal') + ' btn-largo', text: rotulo, onclick: function () {
            if (proximo !== R.STATUS.PRODUCAO) estado.movidosAqui[p.id] = true; /* saiu da fila por esta tela: nao e cancelamento */
            store.atualizarPedido(slug, p.id, { status: proximo }).then(function () {
              UI.soar('toque');
              avisarQueAndou(slug, p, proximo);
            }).catch(function (e) { UI.avisar(D.erroAmigavel(e)); });
          } }));
        }
        return f;
      }

      /* a loja vem da copia da borda (lojaAtualizada, la em cima), sem ler o banco a cada vez que o dono salva algo */
      var pararZerar = zerarRecargaDepois(slug);
      estado.parar.push(pararZerar);
      estado.movidosAqui = {};
      var fila = filaQueVolta(raiz, function (voltou, noLimite) {
        return store.assistirPedidos(slug, function (lista, doCache) {
        if (!doCache) voltou(); /* a do cache chega antes da recusa do banco: so a do servidor tira a faixa */
        lista = desdeOntem(lista);
        var novos = 0;
        if (estado.conhecidos) lista.forEach(function (p) { if (p.status === R.STATUS.PAGO && !estado.conhecidos[p.id + p.status]) novos += 1; });
        /* saiu da fila sem ter sido esta tela (cancelado, ou o painel mexeu): confere 1 vez; cancelado ganha som e aviso.
           So entre duas listas do servidor: a do cache pode ter pedido de ontem que ja saiu (apito falso e leitura a toa) */
        if (estado.statusAntes && !estado.antesDoCache && !doCache) {
          var agora = {};
          lista.forEach(function (p) { agora[p.id] = true; });
          Object.keys(estado.statusAntes).forEach(function (id) {
            if (agora[id] || estado.movidosAqui[id]) return;
            store.obterPedido(slug, id).then(function (p) {
              if (p && p.status === R.STATUS.CANCELADO) { UI.soar('cancelado'); UI.avisar('Senha ' + p.senha + ' foi cancelada. Pode parar.'); }
            }).catch(function () { /* sem internet: segue */ });
          });
        }
        estado.statusAntes = {};
        estado.antesDoCache = !!doCache;
        lista.forEach(function (p) { estado.statusAntes[p.id] = p.status; });
        estado.conhecidos = estado.conhecidos || {};
        lista.forEach(function (p) { estado.conhecidos[p.id + p.status] = true; });
        estado.pedidos = lista;
        if (novos) { UI.soar('apito'); UI.vibrar([200, 100, 200]); }
        desenhar();
        }, { status: [R.STATUS.PAGO, R.STATUS.PRODUCAO], aoErro: function (e) { if (D.ehLimite && D.ehLimite(e)) { noLimite(); return; } pararZerar(); sessaoCaiu(raiz, slug, 'Cozinha', estado.loja.nome, pararCozinha); } });
      });
      estado.parar.push(fila.parar);
      /* o relogio redesenha o "ha quanto tempo" e, no limite do banco, tenta a fila de novo a cada 10 min */
      estado.relogio = setInterval(function () { fila.tentarDeNovo(); desenhar(); }, 30000);

      function pararCozinha() {
        estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
        estado.parar = [];
        clearInterval(estado.relogio);
        document.body.classList.remove('cozinha-modo');
      }
      return pararCozinha;
    });
  }

  /* ============================================================
   * Entregador
   * ========================================================== */
  function linkMapa(loja, p) {
    var e = p.endereco || {};
    var texto = [e.rua + (e.numero ? ', ' + e.numero : ''), e.bairro, loja.cidade + (loja.uf ? ' - ' + loja.uf : '')].filter(Boolean).join(', ');
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(texto);
  }

  /* o que o entregador cobra, em selos curtos (um selo comprido virava bolha de duas linhas) */
  /* o valor do pedido bate com o cardapio? Pedido adulterado (ou preco mudado depois) acende o mesmo aviso do painel
     na ficha da cozinha e no cartao do entregador: ninguem prepara nem cobra sem ver */
  function avisoDeValor(loja, p) {
    var c = R.conferirTotal(loja, p);
    if (c.ok) return null;
    return el('div', { class: 'divergente', text: c.esperado == null ? 'Atenção: item fora do cardápio. Confirme com a loja antes.' : 'Atenção: o valor não confere com o cardápio (' + dinheiro(p.total) + ' em vez de ' + dinheiro(c.esperado) + '). Confirme com a loja antes.' });
  }

  function oQueCobrar(p) {
    function selo(texto, classe) { return el('span', { class: 'selo ' + (classe || ''), text: texto }); }
    if (p.status === R.STATUS.AGUARDANDO) return [selo('Pix ainda não confirmado', 'fechado')];
    if (p.formaPagamento === 'pix') return [selo('Já pago no Pix, não cobrar')];
    if (p.formaPagamento === 'cartao_online') return [selo('Já pago no cartão, não cobrar')];
    if (p.formaPagamento === 'cartao_entrega') return [selo('Cobrar ' + dinheiro(p.total) + ' na maquininha', 'laranja')];
    if (p.formaPagamento === 'dinheiro_entrega') return [selo('Cobrar ' + dinheiro(p.total) + ' em dinheiro', 'laranja')].concat(p.trocoPara > 0
      ? [selo('Paga com ' + dinheiro(p.trocoPara), 'laranja'), selo('Levar troco de ' + dinheiro(p.trocoPara - p.total), 'laranja')]
      : [selo('Sem troco', 'laranja')]);
    return [selo('Total ' + dinheiro(p.total), 'cinza')];
  }

  function abrirEntrega(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Entregador', function (lojaInicial) {
      var estado = { loja: lojaInicial, pedidos: [], parar: [], relogio: null, somLigado: UI.somLigado(), conferidos: {}, naRua: null };

      /* espaco fixo depois do ponto: o nome da loja nunca quebra a linha logo depois do "·" */
      raiz.appendChild(topoEquipe(slug, 'Entregador\u00a0· ' + estado.loja.nome, [], [botaoApito(estado), botaoAvisos(slug, 'entregas')]));
      var lista = el('div', { class: 'conteudo' });
      raiz.appendChild(lista);
      /* o cardapio de agora (preco novo, item novo), como na cozinha */
      var loja = lojaAtualizada(slug, function (l) { estado.loja = l; desenhar(); });
      estado.parar.push(loja.parar);
      function avisoConferido(p) {
        var aviso = avisoDeValor(estado.loja, p);
        if (!aviso || estado.conferidos[p.id] === 'feito') return aviso;
        if (!estado.conferidos[p.id]) {
          estado.conferidos[p.id] = 'indo';
          loja.conferir().then(function () { estado.conferidos[p.id] = 'feito'; desenhar(); });
        }
        return null;
      }

      function desenhar() {
        UI.limpar(lista);
        var entregas = estado.pedidos.filter(function (p) { return p.tipoEntrega === 'entrega'; });
        var naRua = entregas.filter(function (p) { return p.status === R.STATUS.PRONTO; });
        var vindo = entregas.filter(function (p) { return p.status === R.STATUS.PAGO || p.status === R.STATUS.PRODUCAO; });
        naRua.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        vindo.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        lista.appendChild(el('div', { class: 'fila-titulo', role: 'heading', 'aria-level': '2' }, [el('span', { text: 'Para entregar agora' }), el('span', { text: naRua.length ? String(naRua.length) : '' })]));
        if (!naRua.length) lista.appendChild(el('p', { class: 'muted', text: 'Nenhuma entrega na rua. Quando a cozinha marcar "pronto", aparece aqui.' }));
        naRua.forEach(function (p) { lista.appendChild(seguro(function () { return cartao(p, true); }, p)); });
        lista.appendChild(el('div', { class: 'fila-titulo', role: 'heading', 'aria-level': '2' }, [el('span', { text: 'Sendo preparadas' }), el('span', { text: vindo.length ? String(vindo.length) : '' })]));
        if (!vindo.length) lista.appendChild(el('p', { class: 'muted', text: 'Nada em preparo agora.' }));
        vindo.forEach(function (p) { lista.appendChild(seguro(function () { return cartao(p, false); }, p)); });
      }

      function cartao(p, naRua) {
        var e = p.endereco || {};
        var cobrar = oQueCobrar(p);
        var card = el('div', { class: 'pedido-card' + (naRua ? '' : ' cinza') });
        card.appendChild(el('div', { class: 'cabeca' }, [
          el('span', { class: 'senha', 'aria-label': 'Senha ' + p.senha }, [el('small', { text: 'Senha' }), el('b', { text: String(p.senha) })]),
          UI.seloHorario(p.criadoEm),
          el('div', { class: 'cabeca-selos' }, cobrar),
        ]));
        card.appendChild(el('div', { class: 'cliente' }, [p.cliente.nome, p.cliente.telefone ? ' · ' : '', p.cliente.telefone ? el('span', { class: 'sem-quebra', text: R.formatarTelefone(p.cliente.telefone) }) : '']) /* telefone nunca parte no meio */);
        var end = el('div', { class: 'endereco grande' }, [e.rua + (e.numero ? ', ' + e.numero : '') + (e.complemento ? ' · ' + e.complemento : '') + ' · ' + e.bairro]);
        if (e.referencia) end.appendChild(el('div', {}, [el('b', { text: 'Referência: ' + e.referencia })]));
        card.appendChild(end);
        card.appendChild(el('div', { class: 'itens' }, [el('span', { text: p.itens.map(function (it) { return it.quantidade + 'x ' + it.nome; }).join(', ') })]));
        var avisoValorE = avisoConferido(p);
        if (avisoValorE) card.appendChild(avisoValorE);
        var acoes = el('div', { class: 'acoes acoes-entrega' });
        acoes.appendChild(el('a', { class: 'btn btn-fantasma', href: linkMapa(estado.loja, p), target: '_blank', rel: 'noopener' }, [UI.iconeLinha('mapa'), 'Mapa']));
        if (p.cliente.telefone) acoes.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(p.cliente.telefone, 'Olá! Sou o entregador da ' + estado.loja.nome + ', estou chegando com o seu pedido (senha ' + p.senha + ').'), target: '_blank', rel: 'noopener', title: 'Manda para o cliente, no WhatsApp: estou chegando com o seu pedido' }, [UI.icone('zap'), 'Chegando']));
        if (naRua) acoes.appendChild(el('button', { class: 'btn btn-principal' }, [UI.iconeLinha('check'), 'Entregue']));
        if (naRua) acoes.lastChild.addEventListener('click', function () {
          store.atualizarPedido(slug, p.id, { status: R.STATUS.FINALIZADO }).then(function () { UI.soar('sucesso'); }).catch(function (err) { UI.avisar(D.erroAmigavel(err)); });
        });
        card.appendChild(acoes);
        return card;
      }

      /* so as entregas em andamento (a loja vem da copia da borda, em lojaAtualizada) */
      var pararZerar = zerarRecargaDepois(slug);
      estado.parar.push(pararZerar);
      var fila = filaQueVolta(raiz, function (voltou, noLimite) {
        return store.assistirPedidos(slug, function (lista, doCache) {
          if (!doCache) voltou();
          estado.pedidos = desdeOntem(lista);
          /* entrega nova em "Para entregar agora" apita e vibra, como pedido novo na cozinha. A primeira lista so conta (e
             a do cache tambem: a primeira do servidor ainda e o ponto de partida, sem apito de coisa que ja estava la) */
          var prontas = estado.pedidos.filter(function (p) { return p.tipoEntrega === 'entrega' && p.status === R.STATUS.PRONTO; });
          var partida = !estado.naRua || estado.naRuaDoCache;
          var novas = partida ? 0 : prontas.filter(function (p) { return !estado.naRua[p.id]; }).length;
          estado.naRuaDoCache = partida && !!doCache;
          estado.naRua = estado.naRua || {};
          prontas.forEach(function (p) { estado.naRua[p.id] = true; });
          if (novas) { UI.soar('apito'); UI.vibrar([200, 100, 200]); }
          desenhar();
        }, { status: [R.STATUS.PAGO, R.STATUS.PRODUCAO, R.STATUS.PRONTO], tipoEntrega: 'entrega', aoErro: function (e) { if (D.ehLimite && D.ehLimite(e)) { noLimite(); return; } pararZerar(); sessaoCaiu(raiz, slug, 'Entregador', estado.loja.nome, pararEntrega); } });
      });
      estado.parar.push(fila.parar);
      /* o relogio redesenha e, no limite do banco, tenta a fila de novo a cada 10 min */
      estado.relogio = setInterval(function () { fila.tentarDeNovo(); desenhar(); }, 60000);

      function pararEntrega() {
        estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
        estado.parar = [];
        clearInterval(estado.relogio);
      }
      return pararEntrega;
    });
  }

  /* Balcao (tablet no caixa): pede a senha da equipe uma vez; depois abre a loja em modo totem. A marca de "ja entrou"
     e so do balcao: dali, o painel, a cozinha e o entregador pedem a senha de novo (o tablet fica com o cliente) */
  function abrirBalcao(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Balcão', function () {
      document.body.classList.add('balcao');
      return window.LigeiroCliente.loja(raiz, slug, { balcao: true });
    }, 'balcao');
  }

  window.LigeiroEquipe = { abrirCozinha: abrirCozinha, abrirEntrega: abrirEntrega, abrirBalcao: abrirBalcao, definirSenha: definirSenha, linkMapa: linkMapa };
})();
