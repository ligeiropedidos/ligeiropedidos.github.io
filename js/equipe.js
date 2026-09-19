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

  function chaveSessao(slug) { return 'ligeiro:painel:' + slug; }
  function logado(slug) { try { return sessionStorage.getItem(chaveSessao(slug)) === '1'; } catch (_) { return false; } }
  function marcarLogado(slug) { try { sessionStorage.setItem(chaveSessao(slug), '1'); } catch (_) { /* ignora */ } }

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

  /* Carrega a loja, pede a senha se precisar e chama montar(loja). Devolve a funcao de limpeza. */
  function abrirComSenha(raiz, slug, titulo, montar) {
    var limpar = function () {};
    var vivo = true;
    UI.abrirOficialCedo(raiz, slug);
    store.obterLoja(slug).catch(function () { return { _erro: true }; }).then(function (loja) {
      if (!vivo) return;
      if (loja && loja._erro) { raiz.appendChild(UI.erroCarregar('Não deu para abrir esta tela. Confira a internet.', function () { location.reload(); })); return; }
      if (!loja) {
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [el('div', { class: 'icone', text: '🔍' }), el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' })]));
        return;
      }
      UI.aplicarTemaOficial(raiz, slug);
      /* na nuvem a marca da sessao so vale se ainda existe alguem logado (senha da equipe trocada derruba o login antigo) */
      if (logado(slug)) {
        if (D.modoDemo || !store.usuarioAtual) { limpar = montar(loja) || limpar; return; }
        store.usuarioAtual().then(function (u) {
          if (!vivo) return;
          if (u) { limpar = montar(loja) || limpar; return; }
          try { sessionStorage.removeItem(chaveSessao(slug)); } catch (_) { /* ignora */ }
          pedirSenha();
        }).catch(function () { if (vivo) pedirSenha(); });
        return;
      }
      /* dono ja logado neste navegador: entra sem senha */
      var donoCheca = store.donoLogado ? store.donoLogado(loja) : Promise.resolve(false);
      donoCheca.then(function (ehDono) {
        if (!vivo) return;
        if (ehDono) { marcarLogado(slug); UI.limpar(raiz); limpar = montar(loja) || limpar; return; }
        pedirSenha();
      });
      function pedirSenha() {
      var campo = el('input', { type: 'password', inputmode: 'numeric', placeholder: '••••', 'aria-label': 'Senha' });
      var erro = el('p', { class: 'cupom-recado', hidden: true, text: 'Senha errada.' });
      var btnEntrar = el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar });
      var entrando = false; /* Enter + toque no botao: uma entrada so, senao a tela monta duas vezes */
      function entrar() {
        if (entrando) return;
        entrando = true;
        btnEntrar.disabled = true;
        store.entrarPainel(slug, campo.value).then(function (ok) {
          if (!vivo) return;
          if (!ok) { erro.textContent = 'Senha errada.'; erro.hidden = false; campo.value = ''; campo.focus(); UI.soar('erro'); return; }
          marcarLogado(slug);
          UI.limpar(raiz);
          limpar(); /* derruba uma montagem anterior, se houver */
          limpar = montar(loja) || limpar;
        }, function (e) {
          /* ex.: dono com e-mail ainda nao conferido (o aviso diz o que fazer) */
          if (!vivo) return;
          erro.textContent = e && e.message ? e.message : 'Não deu para entrar agora. Tente de novo.';
          erro.hidden = false; UI.soar('erro');
        }).then(function () { entrando = false; btnEntrar.disabled = false; });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: titulo + ' · ' + loja.nome }),
        el('p', { class: 'muted centro', text: 'Senha da equipe (o dono define em Minha loja ou Minha conta).' }),
        campo, erro,
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
      el('p', { class: 'muted pequeno', text: 'Anote e passe para quem trabalha com você. Quem já estava logado continua até fechar a tela.' }),
    ]);
    function salvar() {
      var pin = campo.value.replace(/\D/g, '');
      if (pin.length < 6 || pin.length > 8) return UI.avisar('Use de 6 a 8 números.');
      var promessa = D.modoDemo
        ? store.salvarLoja({ slug: loja.slug, senhaPainel: pin })
        : store.obterIdToken().then(function (idToken) {
          var cfg = window.LIGEIRO_CONFIG || {};
          if (!cfg.proxyMercadoPago) throw new Error('O mensageiro ainda não está no ar.');
          return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ loja: loja.slug, pin: pin }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || 'Não deu para salvar.'); return j; }); });
        });
      promessa.then(function () { UI.fecharModal(); UI.soar('sucesso'); UI.avisar('Senha da equipe salva.'); }).catch(function (e) { UI.avisar(e.message || 'Não deu para salvar agora.'); });
    }
    campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') salvar(); });
    UI.abrirModal({ titulo: 'Senha da equipe', corpo: corpo, rodape: [
      el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Cancelar', onclick: UI.fecharModal }),
      el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Salvar senha', onclick: salvar }),
    ] });
    setTimeout(function () { campo.focus(); }, 50);
  }

  function minutosDesde(iso) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }

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
    if (p.observacao) caixa.appendChild(el('div', { class: 'obs', text: '📝 ' + p.observacao }));
    return caixa;
  }

  /* ============================================================
   * Cozinha
   * ========================================================== */
  function abrirCozinha(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Cozinha', function (lojaInicial) {
      var estado = { loja: lojaInicial, pedidos: [], conhecidos: null, parar: [], relogio: null, somLigado: UI.somLigado() };
      document.body.classList.add('cozinha-modo');

      var btnSom = el('button', { class: 'btn btn-pequeno' + (estado.somLigado ? ' on' : ''), text: estado.somLigado ? '🔔 Apito ligado' : '🔕 Apito desligado', onclick: function () {
        estado.somLigado = UI.somLigado(!estado.somLigado);
        btnSom.textContent = estado.somLigado ? '🔔 Apito ligado' : '🔕 Apito desligado';
        btnSom.classList.toggle('on', estado.somLigado);
        if (estado.somLigado) UI.soar('toque');
      } });
      var contador = el('span', { class: 'selo', text: '' });
      raiz.appendChild(el('header', { class: 'painel-topo' }, [
        el('div', { class: 'nome', text: '👨‍🍳 Cozinha · ' + estado.loja.nome }),
        contador, btnSom,
        el('button', { class: 'btn btn-pequeno', text: 'Painel', onclick: function () { window.LigeiroApp.ir('painel/' + slug); } }),
      ]));
      var colunas = el('div', { class: 'cozinha' });
      raiz.appendChild(colunas);

      function desenhar() {
        UI.limpar(colunas);
        var fazer = estado.pedidos.filter(function (p) { return p.status === R.STATUS.PAGO; });
        var fazendo = estado.pedidos.filter(function (p) { return p.status === R.STATUS.PRODUCAO; });
        fazer.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        fazendo.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        contador.textContent = (fazer.length + fazendo.length) + ' na fila';
        [['Para fazer', fazer, 'Ainda não tem nada esperando. Bom sinal.'], ['Fazendo agora', fazendo, 'Nada no fogo ainda.']].forEach(function (col) {
          var caixa = el('section', { class: 'coluna' }, [el('h2', {}, [col[0], el('span', { class: 'n', text: col[1].length ? ' ' + col[1].length : '' })])]);
          if (!col[1].length) caixa.appendChild(el('p', { class: 'muted', text: col[2] }));
          col[1].forEach(function (p) { caixa.appendChild(ficha(p)); });
          colunas.appendChild(caixa);
        });
      }

      function ficha(p) {
        var min = minutosDesde(p.pagoEm || p.criadoEm);
        var limite = Number(estado.loja.tempoPreparo) || 20;
        var f = el('div', { class: 'ficha-cozinha' + (min >= limite ? ' atrasado' : '') });
        f.appendChild(el('div', { class: 'cabeca' }, [
          el('span', { class: 'senha', text: p.senha }),
          el('span', { class: 'tipo', text: p.tipoEntrega === 'entrega' ? '🛵 Entrega' : (p.origem === 'balcao' ? '🧾 Balcão' : '🛍️ Retirada') }),
          el('span', { class: 'tempo', text: min + ' min' }),
        ]));
        f.appendChild(itensGrandes(p));
        var proximo = R.proximoStatus(p);
        var rotulo = p.status === R.STATUS.PAGO ? 'COMEÇAR' : (p.tipoEntrega === 'entrega' ? 'PRONTO, PODE SAIR' : 'PRONTO');
        if (proximo) {
          f.appendChild(el('button', { class: 'btn ' + (p.status === R.STATUS.PAGO ? 'btn-escuro' : 'btn-principal') + ' btn-largo', text: rotulo, onclick: function () {
            if (proximo !== R.STATUS.PRODUCAO) estado.movidosAqui[p.id] = true; /* saiu da fila por esta tela: nao e cancelamento */
            store.atualizarPedido(slug, p.id, { status: proximo }).then(function () { UI.soar('toque'); }).catch(function (e) { UI.avisar(e.message); });
          } }));
        }
        return f;
      }

      /* a loja veio uma vez ao abrir; a cozinha nao precisa da loja inteira de novo a cada vez que o dono salva algo */
      var pararZerar = zerarRecargaDepois(slug);
      estado.parar.push(pararZerar);
      estado.movidosAqui = {};
      estado.parar.push(store.assistirPedidos(slug, function (lista) {
        var novos = 0;
        if (estado.conhecidos) lista.forEach(function (p) { if (p.status === R.STATUS.PAGO && !estado.conhecidos[p.id + p.status]) novos += 1; });
        /* saiu da fila sem ter sido esta tela (cancelado, ou o painel mexeu): confere 1 vez; cancelado ganha som e aviso */
        if (estado.statusAntes) {
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
        lista.forEach(function (p) { estado.statusAntes[p.id] = p.status; });
        estado.conhecidos = estado.conhecidos || {};
        lista.forEach(function (p) { estado.conhecidos[p.id + p.status] = true; });
        estado.pedidos = lista;
        if (novos) { UI.soar('apito'); UI.vibrar([200, 100, 200]); }
        desenhar();
      }, { status: [R.STATUS.PAGO, R.STATUS.PRODUCAO], aoErro: function () { pararZerar(); sessaoCaiu(raiz, slug, 'Cozinha', estado.loja.nome, pararCozinha); } }));
      estado.relogio = setInterval(desenhar, 30000);

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
  function oQueCobrar(p) {
    function selo(texto, classe) { return el('span', { class: 'selo ' + (classe || ''), text: texto }); }
    if (p.status === R.STATUS.AGUARDANDO) return [selo('Pix ainda não confirmado', 'fechado')];
    if (p.formaPagamento === 'pix') return [selo('Já pago no Pix, não cobrar')];
    if (p.formaPagamento === 'cartao_entrega') return [selo('Cobrar ' + dinheiro(p.total) + ' na maquininha', 'laranja')];
    if (p.formaPagamento === 'dinheiro_entrega') return [selo('Cobrar ' + dinheiro(p.total) + ' em dinheiro', 'laranja')].concat(p.trocoPara > 0
      ? [selo('Paga com ' + dinheiro(p.trocoPara), 'laranja'), selo('Levar troco de ' + dinheiro(p.trocoPara - p.total), 'laranja')]
      : [selo('Sem troco', 'laranja')]);
    return [selo('Total ' + dinheiro(p.total), 'cinza')];
  }

  function abrirEntrega(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Entregas', function (lojaInicial) {
      var estado = { loja: lojaInicial, pedidos: [], parar: [], relogio: null };

      raiz.appendChild(el('header', { class: 'painel-topo' }, [
        el('div', { class: 'nome', text: '🛵 Entregas · ' + estado.loja.nome }),
        el('button', { class: 'btn btn-pequeno', text: 'Painel', onclick: function () { window.LigeiroApp.ir('painel/' + slug); } }),
      ]));
      var lista = el('div', { class: 'conteudo' });
      raiz.appendChild(lista);

      function desenhar() {
        UI.limpar(lista);
        var entregas = estado.pedidos.filter(function (p) { return p.tipoEntrega === 'entrega'; });
        var naRua = entregas.filter(function (p) { return p.status === R.STATUS.PRONTO; });
        var vindo = entregas.filter(function (p) { return p.status === R.STATUS.PAGO || p.status === R.STATUS.PRODUCAO; });
        naRua.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        vindo.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
        lista.appendChild(el('h2', {}, ['Para entregar agora', el('span', { class: 'muted', text: naRua.length ? '  ' + naRua.length : '' })]));
        if (!naRua.length) lista.appendChild(el('p', { class: 'muted', text: 'Nenhuma entrega na rua. Quando a cozinha marcar "pronto", aparece aqui.' }));
        naRua.forEach(function (p) { lista.appendChild(cartao(p, true)); });
        lista.appendChild(el('h2', { style: { marginTop: '14px' }, text: 'Sendo preparadas' }));
        if (!vindo.length) lista.appendChild(el('p', { class: 'muted', text: 'Nada em preparo agora.' }));
        vindo.forEach(function (p) { lista.appendChild(cartao(p, false)); });
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
        var acoes = el('div', { class: 'acoes acoes-entrega' });
        acoes.appendChild(el('a', { class: 'btn btn-fantasma', href: linkMapa(estado.loja, p), target: '_blank', rel: 'noopener', text: '🗺️ Mapa' }));
        if (p.cliente.telefone) acoes.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(p.cliente.telefone, 'Olá! Sou o entregador da ' + estado.loja.nome + ', estou chegando com o seu pedido (senha ' + p.senha + ').'), target: '_blank', rel: 'noopener', text: '💬 Cliente' }));
        if (naRua) acoes.appendChild(el('button', { class: 'btn btn-principal', text: '✓ Entregue', onclick: function () {
          store.atualizarPedido(slug, p.id, { status: R.STATUS.FINALIZADO }).then(function () { UI.soar('sucesso'); }).catch(function (err) { UI.avisar(err.message); });
        } }));
        card.appendChild(acoes);
        return card;
      }

      /* so as entregas em andamento (a loja veio uma vez ao abrir) */
      var pararZerar = zerarRecargaDepois(slug);
      estado.parar.push(pararZerar);
      estado.parar.push(store.assistirPedidos(slug, function (lista) { estado.pedidos = lista; desenhar(); }, { status: [R.STATUS.PAGO, R.STATUS.PRODUCAO, R.STATUS.PRONTO], tipoEntrega: 'entrega', aoErro: function () { pararZerar(); sessaoCaiu(raiz, slug, 'Entregas', estado.loja.nome, pararEntrega); } }));
      estado.relogio = setInterval(desenhar, 60000);

      function pararEntrega() {
        estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
        estado.parar = [];
        clearInterval(estado.relogio);
      }
      return pararEntrega;
    });
  }

  /* Balcao (tablet no caixa): pede a senha do painel uma vez por aparelho; depois abre a loja em modo totem. */
  function abrirBalcao(raiz, slug) {
    return abrirComSenha(raiz, slug, 'Balcão', function () {
      document.body.classList.add('balcao');
      return window.LigeiroCliente.loja(raiz, slug, { balcao: true });
    });
  }

  window.LigeiroEquipe = { abrirCozinha: abrirCozinha, abrirEntrega: abrirEntrega, abrirBalcao: abrirBalcao, definirSenha: definirSenha, linkMapa: linkMapa };
})();
