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

  /* Carrega a loja, pede a senha se precisar e chama montar(loja). Devolve a funcao de limpeza. */
  function abrirComSenha(raiz, slug, titulo, montar) {
    var limpar = function () {};
    var vivo = true;
    store.obterLoja(slug).then(function (loja) {
      if (!vivo) return;
      if (!loja) {
        raiz.appendChild(el('div', { class: 'vazio', style: { paddingTop: '80px' } }, [el('div', { class: 'icone', text: '🔍' }), el('p', { class: 'forte', text: 'Não achamos esse estabelecimento.' })]));
        return;
      }
      if (logado(slug)) { limpar = montar(loja) || limpar; return; }
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
      function entrar() {
        store.entrarPainel(slug, campo.value).then(function (ok) {
          if (!vivo) return;
          if (!ok) { erro.hidden = false; campo.value = ''; campo.focus(); UI.soar('erro'); return; }
          marcarLogado(slug);
          UI.limpar(raiz);
          limpar = montar(loja) || limpar;
        });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(el('div', { class: 'login' }, [
        el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.png', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
        el('h2', { class: 'centro', text: titulo + ' · ' + loja.nome }),
        el('p', { class: 'muted centro', text: 'Senha da equipe (o dono define em Minha loja ou Minha conta).' }),
        campo, erro,
        el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar }),
      ]));
      setTimeout(function () { campo.focus(); }, 50);
      }
    });
    return function () { vivo = false; limpar(); };
  }

  /* Modal "Senha da equipe": 4 a 8 numeros. Na nuvem o mensageiro cria/troca o usuario de equipe da loja. */
  function definirSenha(loja) {
    var campo = el('input', { type: 'text', inputmode: 'numeric', maxlength: '8', placeholder: 'Ex: 2580', 'aria-label': 'Senha da equipe', autocomplete: 'off' });
    var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
      el('p', { text: 'Essa senha abre a cozinha, o entregador e o balcão da ' + loja.nome + '. Só números, de 4 a 8.' }),
      el('div', { class: 'campo' }, [el('label', { text: 'Nova senha da equipe' }), campo]),
      el('p', { class: 'muted pequeno', text: 'Anote e passe pra quem trabalha com você. Quem já estava logado continua até fechar a tela.' }),
    ]);
    function salvar() {
      var pin = campo.value.replace(/\D/g, '');
      if (pin.length < 4 || pin.length > 8) return UI.avisar('Use de 4 a 8 números.');
      var promessa = D.modoDemo
        ? store.salvarLoja({ slug: loja.slug, senhaPainel: pin })
        : store.obterIdToken().then(function (idToken) {
          var cfg = window.LIGEIRO_CONFIG || {};
          if (!cfg.proxyMercadoPago) throw new Error('O mensageiro ainda não está no ar.');
          return fetch(cfg.proxyMercadoPago.replace(/\/$/, '') + '/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ loja: loja.slug, pin: pin }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.erro || 'Não deu pra salvar.'); return j; }); });
        });
      promessa.then(function () { UI.fecharModal(); UI.soar('sucesso'); UI.avisar('Senha da equipe salva.'); }).catch(function (e) { UI.avisar(e.message || 'Não deu pra salvar agora.'); });
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
        [['Pra fazer', fazer, 'Ainda não tem nada esperando. Bom sinal.'], ['Fazendo agora', fazendo, 'Nada no fogo ainda.']].forEach(function (col) {
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
            store.atualizarPedido(slug, p.id, { status: proximo }).then(function () { UI.soar('toque'); }).catch(function (e) { UI.avisar(e.message); });
          } }));
        }
        return f;
      }

      estado.parar.push(store.assistirLoja(slug, function (loja) { if (loja) estado.loja = loja; }));
      var desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      estado.parar.push(store.assistirPedidos(slug, function (lista) {
        var novos = 0;
        if (estado.conhecidos) lista.forEach(function (p) { if (p.status === R.STATUS.PAGO && !estado.conhecidos[p.id + p.status]) novos += 1; });
        estado.conhecidos = estado.conhecidos || {};
        lista.forEach(function (p) { estado.conhecidos[p.id + p.status] = true; });
        estado.pedidos = lista;
        if (novos) { UI.soar('apito'); UI.vibrar([200, 100, 200]); }
        desenhar();
      }, { desde: desde }));
      estado.relogio = setInterval(desenhar, 30000);

      return function () {
        estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
        clearInterval(estado.relogio);
        document.body.classList.remove('cozinha-modo');
      };
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

  function oQueCobrar(p) {
    if (p.status === R.STATUS.AGUARDANDO) return { texto: 'Pix ainda não confirmado', classe: 'fechado' };
    if (p.formaPagamento === 'pix') return { texto: 'Já pago no Pix, não cobrar', classe: '' };
    if (p.formaPagamento === 'cartao_entrega') return { texto: 'Cobrar ' + dinheiro(p.total) + ' na maquininha', classe: 'laranja' };
    if (p.formaPagamento === 'dinheiro_entrega') return { texto: 'Cobrar ' + dinheiro(p.total) + ' em dinheiro' + (p.trocoPara > 0 ? ' · levar troco de ' + dinheiro(p.trocoPara - p.total) + ' (paga com ' + dinheiro(p.trocoPara) + ')' : ' · sem troco'), classe: 'laranja' };
    return { texto: 'Total ' + dinheiro(p.total), classe: 'cinza' };
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
        lista.appendChild(el('h2', {}, ['Pra entregar agora', el('span', { class: 'muted', text: naRua.length ? '  ' + naRua.length : '' })]));
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
          el('span', { class: 'senha', text: 'Senha ' + p.senha }),
          el('span', { class: 'selo ' + cobrar.classe, text: cobrar.texto }),
          el('span', { class: 'quando', text: UI.tempoRelativo(p.criadoEm) }),
        ]));
        card.appendChild(el('div', { class: 'cliente', text: p.cliente.nome + (p.cliente.telefone ? ' · ' + R.formatarTelefone(p.cliente.telefone) : '') }));
        var end = el('div', { class: 'endereco grande' }, [e.rua + (e.numero ? ', ' + e.numero : '') + (e.complemento ? ' · ' + e.complemento : '') + ' · ' + e.bairro]);
        if (e.referencia) end.appendChild(el('div', {}, [el('b', { text: 'Referência: ' + e.referencia })]));
        card.appendChild(end);
        card.appendChild(el('div', { class: 'itens' }, [el('span', { text: p.itens.map(function (it) { return it.quantidade + 'x ' + it.nome; }).join(', ') })]));
        var acoes = el('div', { class: 'acoes' });
        acoes.appendChild(el('a', { class: 'btn btn-fantasma', href: linkMapa(estado.loja, p), target: '_blank', rel: 'noopener', text: '🗺️ Mapa' }));
        if (p.cliente.telefone) acoes.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(p.cliente.telefone, 'Olá! Sou o entregador da ' + estado.loja.nome + ', estou chegando com o seu pedido (senha ' + p.senha + ').'), target: '_blank', rel: 'noopener', text: '💬 Cliente' }));
        if (naRua) acoes.appendChild(el('button', { class: 'btn btn-principal', text: '✓ Entregue', onclick: function () {
          store.atualizarPedido(slug, p.id, { status: R.STATUS.FINALIZADO }).then(function () { UI.soar('sucesso'); }).catch(function (err) { UI.avisar(err.message); });
        } }));
        card.appendChild(acoes);
        return card;
      }

      estado.parar.push(store.assistirLoja(slug, function (loja) { if (loja) estado.loja = loja; }));
      var desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      estado.parar.push(store.assistirPedidos(slug, function (lista) { estado.pedidos = lista; desenhar(); }, { desde: desde }));
      estado.relogio = setInterval(desenhar, 60000);

      return function () {
        estado.parar.forEach(function (f) { try { f(); } catch (_) { /* ignora */ } });
        clearInterval(estado.relogio);
      };
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
