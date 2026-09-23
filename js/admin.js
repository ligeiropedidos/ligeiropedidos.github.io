/*
 * Ligeiro - Central do Ligeiro (#/admin, so o Mateus): visao geral do negocio,
 * lojas, assinaturas, contatos e ferramentas. Cadastra estabelecimentos e
 * entrega os links pro dono.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;
  var $ = UI.$;

  var TIPOS = [['Lanchonete', '🍔'], ['Pizzaria', '🍕'], ['Marmitaria', '🍱'], ['Restaurante', '🍽️'], ['Sorveteria', '🍨'], ['Açaí', '🍇'], ['Padaria', '🥐'], ['Espetinho', '🍢'], ['Sushi', '🍣'], ['Outro', '🛵']];
  var MODELOS = [['vazio', 'Cardápio vazio (monto na loja)'], ['lanchonete-do-ze', 'Modelo de lanchonete'], ['dom-conizza', 'Modelo de pizzaria'], ['marmitaria-da-cida', 'Modelo de marmitaria'], ['sorveteria-da-lu', 'Modelo de sorveteria / açaí']];

  var CHAVE_ABA = 'ligeiro:admin:aba';
  var DIAS_ALERTA = 7; /* "vencendo" e "acabam em 7 dias" */
  /* valor em dinheiro que nunca quebra entre o R$ e o numero */
  function din(v) { return R.dinheiro(v).replace(/ /g, '\u00A0'); }
  var ABAS = [['geral', 'Visão geral'], ['lojas', 'Lojas'], ['contas', 'Assinaturas'], ['contatos', 'Contatos'], ['ferramentas', 'Ferramentas']];
  var FILTROS_LOJAS = [['todas', 'Todas'], ['pagando', 'Pagando'], ['teste', 'Teste'], ['vencidas', 'Vencidas'], ['pausadas', 'Pausadas'], ['desativadas', 'Desativadas'], ['verificadas', 'Verificadas']];
  var FILTROS_CONTAS = [['todas', 'Todas'], ['avisos', 'Avisaram pagamento'], ['pagando', 'Pagando'], ['teste', 'Teste'], ['vencidas', 'Vencidas'], ['pausadas', 'Pausadas'], ['fundadores', 'Fundadores']];
  var FILTROS_CONTATOS = [['pendentes', 'Para chamar'], ['chamados', 'Já chamados'], ['todos', 'Todos']];

  /* ---------- pecinhas sem estado ---------- */

  function dataBR(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x.getTime()) ? '' : x.toLocaleDateString('pt-BR');
  }
  function horaBR(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x.getTime()) ? '' : x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  /* meia-noite de hoje (ou de N dias atras), no relogio deste aparelho */
  function inicioDoDia(diasAtras) {
    var x = new Date();
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - (diasAtras || 0));
    return x;
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  /* "R$ 1.234": reais inteiros, pro numero grande caber no cartao do celular */
  function reaisInteiros(centavos) { return String(Math.round((Number(centavos) || 0) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function normal(t) { return R.semAcento(String(t || '')).toLowerCase(); }
  function mesmoEmail(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
  function cidadeUF(l) { return (l.cidade || 'Sem cidade') + (l.uf ? '/' + l.uf : ''); }
  function erroTexto(e, padrao) { return e && e.message ? e.message : padrao; }
  function lerAba() {
    var a = '';
    try { a = sessionStorage.getItem(CHAVE_ABA) || ''; } catch (_) { /* ignora */ }
    return ABAS.some(function (x) { return x[0] === a; }) ? a : 'geral';
  }
  function guardarAba(a) { try { sessionStorage.setItem(CHAVE_ABA, a); } catch (_) { /* ignora */ } }

  /* busca: cada palavra digitada tem que aparecer em algum dos campos (sem acento, sem maiuscula) */
  function termos(q) { return normal(q).split(/\s+/).filter(Boolean); }
  function casa(lista, campos) {
    if (!lista.length) return true;
    var texto = normal(campos.join(' '));
    return lista.every(function (t) { return texto.indexOf(t) >= 0; });
  }

  function pagando(a) { return (a.estado === 'ativa' || a.estado === 'vencendo') && !a.cortesia && !a.gratis; }
  /* quanto a conta (ou a loja sem dono) paga por mes, em centavos: o anual conta 1/12 */
  function mensalidade(plano, conta) {
    var p = plano || {};
    var id = p.planoPago || p.planoId || 'uma';
    return p.tipo === 'anual' ? Math.round(R.precoDoPlano(id, 'anual', conta) / 12) : R.precoDoPlano(id, 'mensal', conta);
  }

  /* situacao da assinatura em palavra curta (selo), cor do selo e a data (linha de apoio) */
  function situacao(a, loja) {
    if (loja && loja.ativa === false) return { texto: 'Desativada', tom: 'cinza', data: 'fora do site' };
    var ate = a.limite ? dataBR(a.limite) : '';
    if (a.estado === 'ativa') {
      if (a.ligeiro) return { texto: 'Do Ligeiro', tom: '', data: 'sem vencimento' };
      if (a.cortesia) return { texto: 'Cortesia', tom: '', data: 'sem vencimento' };
      if (a.encerrando) return { texto: 'Encerrando', tom: 'laranja', data: 'no ar até ' + ate };
      return { texto: 'Pagando', tom: '', data: 'paga até ' + ate };
    }
    if (a.estado === 'vencendo') return { texto: 'Vencendo', tom: 'laranja', data: 'vence ' + ate };
    if (a.estado === 'gratis') return { texto: 'Teste', tom: '', data: 'grátis até ' + ate };
    if (a.estado === 'vencida') return { texto: 'Vencida', tom: 'laranja', data: 'venceu ' + ate };
    if (a.estado === 'bloqueada') return { texto: 'Bloqueada', tom: 'fechado', data: (a.gratis ? 'grátis acabou ' : 'venceu ') + ate };
    if (a.estado === 'pausada') return { texto: 'Pausada', tom: 'cinza', data: 'pausada pelo Ligeiro' };
    if (a.estado === 'cancelada') return { texto: 'Cancelada', tom: 'cinza', data: 'encerrada pelo dono' };
    return { texto: String(a.estado || ''), tom: 'cinza', data: '' };
  }
  function seloSituacao(sit) { return el('span', { class: 'selo adm-selo' + (sit.tom ? ' ' + sit.tom : ''), text: sit.texto }); }

  /* soma dos pedidos que valem (sem cancelado e sem Pix esperando), a partir de 'desde' */
  function somarPedidos(lista, desde) {
    var t = new Date(desde).getTime();
    var qtd = 0, total = 0;
    (lista || []).forEach(function (p) {
      if (!p || p.status === R.STATUS.CANCELADO || p.status === R.STATUS.AGUARDANDO) return;
      if (!(new Date(p.criadoEm).getTime() >= t)) return;
      qtd += 1;
      total += Number(p.total) || 0;
    });
    return { qtd: qtd, total: total };
  }

  function mensagemLead(c) {
    return 'Oi' + (c.nome ? ', ' + c.nome.split(' ')[0] : '') + '! Aqui é do Ligeiro. Você deixou seu contato no nosso site' + (c.loja ? ' para ' + c.loja : '') + '. Posso te mostrar como funciona?';
  }

  /* ---------- planilha (CSV pro Excel: ";" e BOM pra acentuar certo) ---------- */
  function celulaCsv(v) {
    var t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; /* o Excel nao roda como formula */
    return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function baixarCsv(nome, linhas) {
    try {
      var texto = '\uFEFF' + linhas.map(function (l) { return l.map(celulaCsv).join(';'); }).join('\r\n');
      var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
      var a = el('a', { href: url, download: nome, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
      UI.avisar('Planilha baixada: ' + nome);
    } catch (_) {
      UI.avisar('Não deu para gerar a planilha neste navegador.');
    }
  }

  /* ---------- pecas de tela ---------- */
  function cabeca(titulo, sub, acao) {
    return el('div', { class: 'adm-cabeca' }, [
      el('div', { class: 'adm-cabeca-texto' }, [el('h2', { text: titulo }), sub ? el('p', { text: sub }) : null]),
      acao || null,
    ]);
  }
  function tituloComNumero(texto, n) {
    return el('div', { class: 'adm-titulo' }, [el('h2', { text: texto }), n != null ? el('span', { class: 'chip-qtd', text: String(n) }) : null]);
  }
  function kpi(rotulo, valor, apoio, dica) {
    return el('div', { class: 'adm-kpi', title: dica || null }, [
      el('div', { class: 'adm-kpi-rotulo', text: rotulo }),
      el('div', { class: 'adm-kpi-valor' }, valor),
      el('div', { class: 'adm-kpi-apoio', text: apoio }),
    ]);
  }
  function chip(rotulo, n, ativo, onclick) {
    return el('button', { class: 'aba-painel' + (ativo ? ' ativa' : ''), type: 'button', 'aria-pressed': ativo ? 'true' : 'false', onclick: onclick }, [
      el('span', { text: rotulo }), el('span', { class: 'chip-qtd', text: String(n) }),
    ]);
  }
  function cabecaTabela(colunas) {
    return el('div', { class: 'adm-cab', 'aria-hidden': 'true' }, colunas.map(function (c) { return el('span', { text: c }); }).concat([el('span')]));
  }
  function dados(pares) {
    return el('dl', { class: 'adm-dados' }, pares.filter(Boolean).map(function (p) {
      return el('div', { class: 'adm-par' }, [el('dt', { text: p[0] }), el('dd', { text: p[1] })]);
    }));
  }
  /* botoes em colunas iguais: 3 no PC, 2 no celular (o ultimo sozinho ganha a linha) */
  function grade(botoes) {
    var lista = botoes.filter(Boolean);
    return el('div', { class: 'adm-acoes adm-acoes-' + Math.min(3, lista.length) }, lista);
  }
  function alerta(texto) { return el('div', { class: 'adm-alerta', role: 'status', text: texto }); }

  function abrir(raiz) {
    var chave = 'ligeiro:admin';
    function logado() { try { return sessionStorage.getItem(chave) === '1'; } catch (_) { return false; } }

    var parar = null;
    var vivo = true; /* saiu da tela antes do banco responder: nao desenha o admin por cima da outra pagina */
    /* tela do Ligeiro ate aparecer o login ou chegarem os dados da primeira carga */
    var tirarSplash = UI.splashLigeiro ? UI.splashLigeiro() : function () {};
    var cfgA = window.LIGEIRO_CONFIG || {};
    function ehAdmin(u) { return !!(u && cfgA.adminEmail && String(u.email || '').toLowerCase() === String(cfgA.adminEmail).toLowerCase()); }

    var estado = {
      lojas: null, contas: [], leads: [], contasOk: true, leadsOk: true, carregadoEm: null,
      aba: lerAba(),
      busca: { lojas: '', contas: '' },
      filtro: { lojas: 'todas', contas: 'todas', contatos: 'pendentes' },
      hoje: null, /* pedidos de hoje de todas as lojas: carrega uma vez por abertura (ou no Atualizar) */
      pedidosLoja: {}, /* pedidos de 7 dias de cada ficha aberta, guardados por 5 min */
      atencaoToda: false,
      ficha: null, /* ficha aberta agora: { tipo: 'loja', slug } ou { tipo: 'conta', email } */
      vez: 0, aplicada: 0, vezHoje: 0,
      btnAtualizar: null,
    };

    /* demonstracao: vale a marca da sessao. Na nuvem a marca nao basta: sempre confere se o Google logado e o do Ligeiro. */
    if (D.modoDemo && logado()) { parar = montar(); return function () { vivo = false; tirarSplash(); if (parar) parar(); }; }
    if (!D.modoDemo && store.usuarioAtual) {
      raiz.appendChild(UI.carregandoMascote('Abrindo a Central…'));
      store.usuarioAtual().then(function (u) {
        if (!vivo) return;
        if (ehAdmin(u)) { try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ } parar = montar(); }
        else telaLogin();
      }).catch(function () { if (vivo) telaLogin(); });
      return function () { vivo = false; tirarSplash(); if (parar) parar(); };
    }
    telaLogin();
    return function () { vivo = false; tirarSplash(); if (parar) parar(); };

    function telaLogin() {
      tirarSplash();
      UI.limpar(raiz);
      var erro = el('div', { class: 'msg-erro', hidden: true });
      var marca = el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]);
      /* na nuvem nao existe senha: so entra o Google do Ligeiro (adminEmail), e as regras do banco conferem de novo */
      if (!D.modoDemo) {
        raiz.appendChild(el('div', { class: 'login' }, [
          marca,
          el('h2', { class: 'centro', text: 'Central do Ligeiro' }),
          el('p', { class: 'centro muted', text: 'Entre com a conta Google do Ligeiro.' }),
          erro,
          el('button', { class: 'btn btn-google btn-largo', type: 'button', text: 'Entrar com o Google', onclick: function () {
            store.entrarComGoogle().then(function (u) {
              if (!ehAdmin(u)) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Essa conta Google não é a do Ligeiro. Saia dela em "Minha conta" e entre com a certa.'; return; }
              try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ }
              parar = montar();
            }).catch(function (e) { erro.hidden = false; erro.textContent = e.message || 'Não deu para entrar.'; });
          } }),
        ]));
        return;
      }
      var campo = el('input', { type: 'password', placeholder: '••••••', 'aria-label': 'Senha da demonstração' });
      function entrar() {
        store.entrarAdmin(campo.value).then(function (ok) {
          if (!ok) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Senha errada.'; campo.value = ''; return; }
          try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ }
          parar = montar();
        });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(el('div', { class: 'login' }, [
        marca,
        el('h2', { class: 'centro', text: 'Central do Ligeiro' }),
        el('p', { class: 'centro muted', text: 'Senha da demonstração: ligeiro' }),
        el('div', { class: 'campo' }, campo),
        erro,
        el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar }),
      ]));
      setTimeout(function () { campo.focus(); }, 50);
    }

    function sair() {
      try { sessionStorage.removeItem(chave); } catch (_) { /* ignora */ }
      if (parar) { parar(); parar = null; }
      UI.fecharModal();
      if (store.sair) store.sair();
      telaLogin();
    }

    /* ============================================================
     * Moldura: topo escuro, abas e a secao que cada aba desenha
     * ========================================================== */
    function montar() {
      UI.limpar(raiz);
      estado.lojas = null;
      estado.hoje = null;
      estado.pedidosLoja = {};
      /* mesmo topo do painel da loja: icones de traco (no lugar dos emojis de estilos diferentes) e botoes de vidro */
      function botaoTopo(icone, texto, onclick, dica) {
        return el('button', { class: 'btn btn-pequeno', type: 'button', title: dica || null, onclick: onclick }, [UI.iconeTraco(icone), el('span', { text: texto })]);
      }
      estado.btnAtualizar = botaoTopo('atualizar', 'Atualizar', atualizar, 'Buscar tudo de novo no banco');
      raiz.appendChild(el('header', { class: 'painel-topo topo-app topo-ligeiro adm-topo' }, [
        el('img', { class: 'logo-mini', src: 'img/mascote-192.webp', alt: '', width: '40', height: '40' }),
        el('div', { class: 'nome', text: 'Central do Ligeiro' }),
        /* mesma fileira do topo do painel: no celular os tres lado a lado, tercos iguais */
        el('div', { class: 'painel-topo-acoes' }, [
          estado.btnAtualizar,
          botaoTopo('site', 'Ver site', function () { window.LigeiroApp.ir('cidades'); }, 'Abre a página das cidades'),
          botaoTopo('sair', 'Sair', sair),
        ]),
      ]));

      var abas = el('nav', { class: 'abas-painel adm-abas', 'aria-label': 'Seções da central' });
      ABAS.forEach(function (d) {
        abas.appendChild(el('button', { class: 'aba-painel' + (estado.aba === d[0] ? ' ativa' : ''), type: 'button', dataset: { aba: d[0] }, onclick: function () { trocarAba(d[0]); } }, [
          el('span', { text: d[1] }), el('span', { class: 'adm-aba-extra', dataset: { extra: d[0] } }),
        ]));
      });
      raiz.appendChild(abas);
      raiz.appendChild(el('section', { class: 'secao adm-secao', id: 'secaoAdmin' }));

      /* as abas grudam logo abaixo do topo, seja qual for a altura dele (no celular sao duas linhas) */
      var topoEl = raiz.querySelector('.painel-topo');
      var medirTopo = function () { if (topoEl) raiz.style.setProperty('--altura-painel-topo', topoEl.offsetHeight + 'px'); };
      medirTopo();
      var observador = window.ResizeObserver && topoEl ? new ResizeObserver(medirTopo) : null;
      if (observador) observador.observe(topoEl);

      /* fechou a ficha (X ou Esc): acao que termina depois nao reabre ela por cima do que ele estiver fazendo */
      var modalEl = $('modal');
      var fechouNaMao = function (e) { if (e.type === 'keydown' ? e.key === 'Escape' : !!(e.target.closest && e.target.closest('.modal-topo .fechar'))) estado.ficha = null; };
      if (modalEl) modalEl.addEventListener('click', fechouNaMao);
      document.addEventListener('keydown', fechouNaMao);

      desenhar().then(tirarSplash, tirarSplash);
      var pararAssistir = store.assistir ? store.assistir(desenhar) : null;
      return function () {
        if (modalEl) modalEl.removeEventListener('click', fechouNaMao);
        document.removeEventListener('keydown', fechouNaMao);
        if (observador) observador.disconnect();
        if (pararAssistir) pararAssistir();
        raiz.style.removeProperty('--altura-painel-topo');
      };
    }

    function trocarAba(aba) {
      estado.aba = aba;
      guardarAba(aba);
      raiz.querySelectorAll('.adm-abas .aba-painel').forEach(function (b) {
        var ativa = b.dataset.aba === aba;
        b.classList.toggle('ativa', ativa);
        b.setAttribute('aria-pressed', ativa ? 'true' : 'false');
      });
      pintar();
      window.scrollTo(0, 0);
    }

    /* Busca tudo no banco (lojas, contas, contatos, vagas de fundador) e redesenha a aba aberta.
       E o que o store.assistir chama na demonstracao; na nuvem, o botao Atualizar e cada acao. */
    function desenhar() {
      var s = $('secaoAdmin');
      if (!s) return Promise.resolve(false);
      var vez = ++estado.vez;
      if (!estado.lojas) { UI.limpar(s); s.appendChild(el('p', { class: 'adm-carregando', text: 'Carregando a central…' })); }
      return Promise.all([
        store.listarTodasLojas(),
        store.listarContas ? store.listarContas().catch(function () { return null; }) : Promise.resolve([]),
        store.listarLeads ? store.listarLeads().catch(function () { return null; }) : Promise.resolve([]),
        /* vagas: sempre do servidor (a Central decide e grava em cima disso); se falhar, nao sincroniza nada */
        store.obterFundadores ? store.obterFundadores({ semCache: true }).then(function (f) { estado.capacidadeLida = !!f; if (f) window.LigeiroFundadores = { usados: f.usados || 0, capacidade: f.capacidade || null }; }).catch(function () { estado.capacidadeLida = false; }) : null,
        store.listarListaEspera ? store.listarListaEspera().catch(function () { return null; }) : Promise.resolve([]),
      ]).then(function (r) {
        if (!vivo || !$('secaoAdmin')) return false;
        if (vez < estado.aplicada) return true; /* chegou depois de uma resposta mais nova: fica a mais nova */
        estado.aplicada = vez;
        estado.lojas = r[0] || [];
        estado.contasOk = r[1] !== null;
        estado.contas = (r[1] || []).slice().sort(function (a, b) { return (b.plano && b.plano.avisoPagamentoEm ? 1 : 0) - (a.plano && a.plano.avisoPagamentoEm ? 1 : 0); });
        estado.leadsOk = r[2] !== null;
        estado.leads = r[2] || [];
        estado.espera = r[4] || null;
        estado.carregadoEm = new Date();
        sincronizarCapacidade();
        pintar();
        if (estado.hoje === null) carregarHoje();
        return true;
      }).catch(function (e) {
        if (!vivo) return false;
        var s2 = $('secaoAdmin');
        if (!s2) return false;
        if (!estado.lojas) { UI.limpar(s2); s2.appendChild(UI.erroCarregar('Não deu para carregar as lojas.', function () { desenhar(); })); }
        else UI.avisar('Não deu para atualizar agora. ' + erroTexto(e, ''));
        return false;
      });
    }

    /* ---------- vagas de loja ---------- */
    /* lojas que ocupam vaga: no ar (em teste ou pagando) e as paradas que ja pagaram alguma vez (voltam quando pagar) */
    function lojasNoSistema() { return (estado.lojas || []).filter(function (l) { return R.ocupaVaga(l); }).length; }
    /* a Central e quem conta: grava o numero, fecha sozinha ao bater o limite e reabre se foi ela que fechou */
    function sincronizarCapacidade() {
      if (!store.salvarCapacidade || !estado.capacidadeLida) return; /* sem leitura nova do servidor, nao decide nada */
      var pub = (window.LigeiroFundadores && window.LigeiroFundadores.capacidade) || {};
      var mudancas = R.decidirCapacidade(pub, lojasNoSistema(), ((window.LIGEIRO_CONFIG || {}).capacidade || {}).maxLojas);
      estado.contadoEm = new Date();
      if (!Object.keys(mudancas).length) return;
      salvarCapacidade(mudancas, mudancas.fechado === true ? 'O limite de lojas chegou: vagas fechadas. Cliente novo agora entra na lista de espera.' : '');
    }
    function salvarCapacidade(mudancas, aviso) {
      return store.salvarCapacidade(mudancas).then(function () {
        var f = window.LigeiroFundadores || { usados: 0 };
        window.LigeiroFundadores = { usados: f.usados || 0, capacidade: Object.assign({}, f.capacidade || {}, mudancas) };
        if (aviso) UI.avisar(aviso);
        if (estado.aba === 'geral') pintar();
      }).catch(function (e) { UI.avisar('Não deu para salvar as vagas. ' + erroTexto(e, '')); });
    }
    function mudarLimite() {
      var cap = R.capacidadeLojas();
      var campo = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', value: String(cap.max || ''), placeholder: 'Ex: 60' });
      var ok = el('button', { class: 'btn btn-principal', type: 'button', text: 'Salvar limite', onclick: function () {
        var v = Math.max(0, Math.floor(Number(campo.value) || 0));
        var m = R.novoLimite(window.LigeiroFundadores.capacidade, lojasNoSistema(), v);
        UI.fecharModal();
        salvarCapacidade(m, v ? 'Limite salvo: ' + v + ' lojas.' : 'Sem limite de lojas.');
      } });
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
      UI.abrirModal({ titulo: 'Limite de lojas', corpo: el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
        el('p', { class: 'muted pequeno', text: 'Quantas lojas o sistema aguenta hoje. Ao chegar nesse número, cliente novo entra na lista de espera; quem já tem loja continua normal. 0 = sem limite.' }),
        el('div', { class: 'campo' }, [el('label', { text: 'Limite de lojas' }), campo]),
      ]), rodape: [el('button', { class: 'btn btn-fantasma', type: 'button', text: 'Cancelar', onclick: UI.fecharModal }), ok] });
      setTimeout(function () { campo.focus(); campo.select(); }, 80);
    }
    function quadroCapacidade() {
      var cap = R.capacidadeLojas();
      var n = lojasNoSistema();
      var espera = (estado.espera || (estado.leads || []).filter(function (c) { return c.origem === 'lista-espera'; })).filter(function (c) { return !c.atendidoEm; }).length;
      var pct = cap.max > 0 ? Math.min(100, Math.round(n / cap.max * 100)) : 0;
      var classe = cap.fechado ? ' cheio' : (cap.max > 0 && n >= Math.ceil(cap.max * 0.8) ? ' perto' : '');
      var situacao = cap.fechado ? 'Vagas fechadas: cliente novo vai para a lista de espera' : (cap.max > 0 ? plural(Math.max(0, cap.max - n), 'vaga livre', 'vagas livres') : 'Sem limite');
      var peloLimite = cap.max > 0 && n >= cap.max;
      var naMao = !peloLimite && (window.LigeiroFundadores.capacidade || {}).fechado === true;
      return el('div', { class: 'adm-capacidade' + classe }, [
        el('div', { class: 'adm-capacidade-texto' }, ['Lojas no sistema: ', el('b', { text: cap.max > 0 ? n + ' de ' + cap.max : String(n) })]),
        el('div', { class: 'adm-capacidade-barra', role: 'progressbar', 'aria-label': 'Lojas no sistema', 'aria-valuemin': '0', 'aria-valuemax': String(cap.max || n), 'aria-valuenow': String(n) }, el('i', { style: { width: (cap.max > 0 ? Math.max(2, pct) : 0) + '%' } })),
        el('div', { class: 'adm-capacidade-situacao', text: situacao + (espera ? ' · ' + plural(espera, 'na lista de espera', 'na lista de espera') : '') }),
        el('div', { class: 'adm-capacidade-nota', text: 'Contado às ' + horaBR(estado.contadoEm || estado.carregadoEm || new Date()) + ', ao abrir a Central. Teste grátis que acabou sem pagar não conta; loja parada que já pagou conta, porque volta quando pagar.' }),
        /* cheio pelo limite: so aumentando o limite abre vaga. Fechado na mao: abrir. Aberto: mudar limite ou fechar. */
        el('div', { class: 'adm-capacidade-acoes' }, peloLimite
          ? [el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Aumentar limite', onclick: mudarLimite })]
          : [
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Mudar limite', onclick: mudarLimite }),
            naMao
              ? el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Abrir vagas', onclick: function () { salvarCapacidade({ fechado: false, automatico: false }, 'Vagas abertas.'); } })
              : el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Fechar vagas', onclick: function () { salvarCapacidade({ fechado: true, automatico: false }, 'Vagas fechadas: cliente novo vai para a lista de espera.'); } }),
          ]),
      ]);
    }

    function atualizar() {
      var b = estado.btnAtualizar;
      if (b && b.disabled) return;
      if (b) b.disabled = true;
      estado.hoje = null;
      estado.pedidosLoja = {};
      desenhar().then(function (ok) {
        if (b) b.disabled = false;
        if (ok) { soltarTravasParadas(); UI.avisar('Dados atualizados às ' + horaBR(new Date()) + '.'); }
      });
    }

    /* Pedidos de hoje de todas as lojas ativas: uma leitura so do dia, nada ao vivo (economiza o banco). */
    function carregarHoje() {
      var ativas = (estado.lojas || []).filter(function (l) { return l.ativa !== false; });
      var desde = inicioDoDia(0).toISOString();
      var vez = ++estado.vezHoje;
      estado.hoje = 'carregando';
      Promise.all(ativas.map(function (l) {
        return store.listarPedidos(l.slug, { desde: desde }).catch(function () { return []; });
      })).then(function (listas) {
        if (!vivo || vez !== estado.vezHoje) return;
        var todos = [];
        listas.forEach(function (x) { todos = todos.concat(x || []); });
        estado.hoje = somarPedidos(todos, desde);
        if (estado.aba === 'geral') pintar();
      }).catch(function () {
        if (!vivo || vez !== estado.vezHoje) return;
        estado.hoje = { qtd: 0, total: 0, erro: true };
        if (estado.aba === 'geral') pintar();
      });
    }

    function contarPendencias() {
      return {
        avisos: estado.contas.filter(function (c) { return c.plano && c.plano.avisoPagamentoEm; }).length,
        contatos: estado.leads.filter(function (c) { return !c.atendidoEm; }).length,
      };
    }
    function pintarAbas() {
      var n = contarPendencias();
      raiz.querySelectorAll('.adm-aba-extra').forEach(function (x) {
        UI.limpar(x);
        var k = x.getAttribute('data-extra');
        if (k === 'lojas') x.appendChild(el('span', { class: 'chip-qtd', text: String(estado.lojas.length) }));
        if (k === 'contas') {
          x.appendChild(el('span', { class: 'chip-qtd', text: String(estado.contas.length) }));
          if (n.avisos) x.appendChild(el('span', { class: 'adm-ponto', title: plural(n.avisos, 'conta avisou pagamento', 'contas avisaram pagamento'), 'aria-label': plural(n.avisos, 'conta avisou pagamento', 'contas avisaram pagamento') }));
        }
        if (k === 'contatos' && n.contatos) x.appendChild(el('span', { class: 'badge', title: plural(n.contatos, 'contato para chamar', 'contatos para chamar'), text: String(n.contatos) }));
      });
    }

    function pintar() {
      var s = $('secaoAdmin');
      if (!s || !estado.lojas) return;
      pintarAbas();
      /* redesenho com a busca em uso (dado novo chegou): o cursor continua no campo */
      var ativo = document.activeElement;
      var foco = ativo && ativo.getAttribute ? ativo.getAttribute('data-busca') : null;
      UI.limpar(s);
      try {
        if (estado.aba === 'lojas') abaLojas(s);
        else if (estado.aba === 'contas') abaContas(s);
        else if (estado.aba === 'contatos') abaContatos(s);
        else if (estado.aba === 'ferramentas') abaFerramentas(s);
        else abaGeral(s);
      } catch (e) {
        /* erro ao montar: nunca deixar a tela em branco */
        UI.limpar(s);
        s.appendChild(UI.erroCarregar('Deu erro ao montar esta tela' + (e && e.message ? ': ' + e.message : '.'), function () { desenhar(); }));
      }
      if (foco) {
        var b = s.querySelector('[data-busca="' + foco + '"]');
        if (b) { b.focus(); try { b.setSelectionRange(b.value.length, b.value.length); } catch (_) { /* campo sem selecao */ } }
      }
    }

    /* ---------- consultas no que ja esta carregado ---------- */
    function acharLoja(slug) { return (estado.lojas || []).filter(function (l) { return l.slug === slug; })[0] || null; }
    function acharConta(email) { return estado.contas.filter(function (c) { return mesmoEmail(c.email, email); })[0] || null; }
    function lojasDaConta(email) { return (estado.lojas || []).filter(function (l) { return mesmoEmail(l.donoEmail, email); }); }

    /* Cada "cliente" do Ligeiro conta uma vez: as contas, e as lojas ativas sem conta
       (ou com dono cuja conta nao veio, ai vale o espelho do plano na loja). */
    function unidades() {
      var vistas = {};
      var lista = [];
      estado.contas.forEach(function (c) {
        var k = String(c.email || '').toLowerCase();
        if (!k || vistas[k]) return;
        vistas[k] = true;
        lista.push({ plano: c.plano, conta: c, a: R.assinatura(c) });
      });
      estado.lojas.forEach(function (l) {
        if (l.ativa === false) return;
        var k = String(l.donoEmail || ('loja:' + l.slug)).toLowerCase();
        if (vistas[k]) return;
        vistas[k] = true;
        lista.push({ plano: l.plano, conta: { plano: l.plano || {} }, a: R.assinatura(l) }); /* o espelho do plano na loja traz o "fundador" */
      });
      return lista;
    }

    /* ============================================================
     * Aba: Visao geral
     * ========================================================== */
    function abaGeral(s) {
      var ativas = estado.lojas.filter(function (l) { return l.ativa !== false; });
      var cidades = {};
      ativas.forEach(function (l) { cidades[l.cidadeSlug] = true; });
      var nCidades = Object.keys(cidades).length;
      var receita = 0, pagantes = 0, gratis = 0, acabando = 0;
      unidades().forEach(function (u) {
        if (pagando(u.a)) { pagantes += 1; receita += mensalidade(u.plano, u.conta); }
        else if (u.a.estado === 'gratis') { gratis += 1; if (u.a.dias <= DIAS_ALERTA) acabando += 1; }
      });

      s.appendChild(cabeca('Visão geral', 'Atualizado às ' + horaBR(estado.carregadoEm) + (D.modoDemo ? ' · modo demonstração' : ''),
        el('button', { class: 'btn btn-principal', type: 'button', text: '+ Cadastrar estabelecimento', onclick: novaLoja })));

      var hoje = estado.hoje && estado.hoje.qtd != null ? estado.hoje : null;
      s.appendChild(el('div', { class: 'adm-kpis' }, [
        kpi('Receita por mês', [el('small', { class: 'adm-pre', text: 'R$' }), reaisInteiros(receita)], plural(pagantes, 'conta pagando', 'contas pagando'), 'Exato: ' + R.dinheiro(receita) + ' por mês (o anual conta 1/12)'),
        kpi('Lojas ativas', String(ativas.length), 'em ' + plural(nCidades, 'cidade', 'cidades')),
        kpi('Período grátis', [String(gratis), el('small', { class: 'adm-pos', text: gratis === 1 ? 'conta' : 'contas' })], acabando ? acabando + (acabando === 1 ? ' acaba' : ' acabam') + ' em 7 dias' : 'nenhuma acaba em 7 dias'),
        kpi('Pedidos hoje', hoje ? (hoje.erro ? '?' : String(hoje.qtd)) : '…', hoje ? (hoje.erro ? 'não deu para carregar' : R.dinheiro(hoje.total) + ' vendidos') : 'carregando…', 'Sem cancelados e sem Pix esperando pagamento'),
      ]));

      var fcfg = (window.LIGEIRO_CONFIG || {}).fundador || {};
      var totalVagas = Number(fcfg.vagas) || 0;
      if (totalVagas > 0) {
        var usadas = Math.max(0, Math.min(totalVagas, totalVagas - R.vagasFundador()));
        s.appendChild(el('div', { class: 'adm-fundadores' }, [
          el('div', { class: 'adm-fundadores-texto' }, [el('span', { class: 'adm-estrela', 'aria-hidden': 'true', text: '★' }), 'Fundadores: ', el('b', { text: usadas + ' de ' + totalVagas }), ' vagas usadas']),
          el('div', { class: 'adm-fundadores-barra', role: 'progressbar', 'aria-label': 'Vagas de fundador usadas', 'aria-valuemin': '0', 'aria-valuemax': String(totalVagas), 'aria-valuenow': String(usadas) }, el('i', { style: { width: Math.round(usadas / totalVagas * 100) + '%' } })),
          el('div', { class: 'adm-fundadores-livres', text: plural(totalVagas - usadas, 'vaga livre', 'vagas livres') }),
        ]));
      }

      s.appendChild(quadroCapacidade());

      var itens = itensAtencao();
      s.appendChild(tituloComNumero('Precisa de atenção', itens.length));
      var caixa = el('div', { class: 'adm-lista adm-atencao' });
      if (!itens.length) caixa.appendChild(el('div', { class: 'adm-tudo-ok' }, [el('span', { class: 'adm-ico', 'aria-hidden': 'true', text: '✓' }), el('span', { text: 'Tudo em dia.' })]));
      var limite = estado.atencaoToda ? itens.length : 6;
      itens.slice(0, limite).forEach(function (it) { caixa.appendChild(linhaAtencao(it)); });
      if (itens.length > 6) {
        caixa.appendChild(el('button', { class: 'adm-mais', type: 'button', text: estado.atencaoToda ? 'Mostrar menos' : 'Mostrar mais ' + (itens.length - 6), onclick: function () { estado.atencaoToda = !estado.atencaoToda; pintar(); } }));
      }
      s.appendChild(caixa);
    }

    /* Lista do que precisa de uma acao, do mais urgente pro menos. */
    function itensAtencao() {
      var itens = [];
      var alvos = estado.contas.map(function (c) {
        return { nome: c.email, plano: c.plano || {}, a: R.assinatura(c), temLoja: lojasDaConta(c.email).some(function (l) { return l.ativa !== false; }), abrir: function () { abrirConta(c.email); } };
      }).concat(estado.lojas.filter(function (l) { return l.ativa !== false && !l.donoEmail; }).map(function (l) {
        return { nome: l.nome, plano: l.plano || {}, a: R.assinatura(l), temLoja: true, abrir: function () { abrirLoja(l.slug); } };
      }));
      alvos.forEach(function (x) {
        var p = x.plano, a = x.a;
        if (p.avisoPagamentoEm) {
          itens.push({ ordem: 1, peso: new Date(p.avisoPagamentoEm).getTime() || 0, ico: '💸', tom: 'laranja', titulo: 'Avisou ' + din(p.avisoValor || 0), detalhe: x.nome + ' · ' + dataBR(p.avisoPagamentoEm), botao: 'Conferir', principal: true, acao: x.abrir });
          return;
        }
        if (!x.temLoja) return;
        if ((a.estado === 'vencida' || a.estado === 'bloqueada') && !a.gratis) {
          itens.push({ ordem: 2, peso: a.dias, ico: '⚠️', tom: 'erro', titulo: a.estado === 'bloqueada' ? 'Bloqueada, sem receber pedidos' : 'Vencida, ainda no ar', detalhe: x.nome + ' · venceu ' + dataBR(a.limite), botao: 'Ver', acao: x.abrir });
        } else if (a.estado === 'vencendo') {
          itens.push({ ordem: 3, peso: a.dias, ico: '⏳', tom: 'laranja', titulo: a.dias <= 0 ? 'Vence hoje' : (a.dias === 1 ? 'Vence amanhã' : 'Vence em ' + a.dias + ' dias'), detalhe: x.nome + ' · ' + dataBR(a.limite), botao: 'Ver', acao: x.abrir });
        } else if (a.estado === 'bloqueada' && a.gratis && a.dias >= -DIAS_ALERTA) {
          itens.push({ ordem: 3, peso: 100 - a.dias, ico: '⌛', tom: 'laranja', titulo: 'Período grátis acabou', detalhe: x.nome + ' · ' + dataBR(a.limite), botao: 'Ver', acao: x.abrir });
        }
      });
      estado.leads.filter(function (c) { return !c.atendidoEm; }).forEach(function (c) {
        itens.push({ ordem: 4, peso: -(new Date(c.criadoEm).getTime() || 0), ico: '📞', tom: '', titulo: (c.nome || 'Sem nome') + (c.loja ? ', ' + c.loja : ''), detalhe: 'Deixou o contato em ' + dataBR(c.criadoEm) + (c.whatsapp ? ' · ' + R.formatarTelefone(c.whatsapp).replace(/ /g, '\u00A0').replace(/-/g, '\u2011') : ''), /* telefone nunca parte no meio */ botao: 'Chamar', link: R.linkWhatsapp(c.whatsapp, mensagemLead(c)) });
      });
      estado.lojas.forEach(function (l) {
        if (l.ativa === false || R.lojaBloqueada(l)) return;
        var semPix = !(l.aceitaPix !== false && l.mpAtivo); /* mesma conta do site: Pix so com o Mercado Pago ligado */
        var semItem = R.produtosAtivos(l).length === 0;
        if (!semPix && !semItem) return;
        var cat = R.catalogo(l).nome;
        itens.push({ ordem: 5, peso: 0, ico: '🔧', tom: '', titulo: semPix && semItem ? 'Sem Pix e ' + cat + ' vazio' : (semPix ? 'Sem Pix automático' : R.catalogo(l).Nome + ' sem itens'), detalhe: l.nome + ' · ' + cidadeUF(l), botao: 'Ver loja', acao: function () { abrirLoja(l.slug); } });
      });
      itens.sort(function (x, y) { return x.ordem - y.ordem || x.peso - y.peso; });
      return itens;
    }

    function linhaAtencao(it) {
      var botao;
      if (it.link !== undefined) {
        botao = it.link
          ? el('a', { class: 'btn btn-whats btn-pequeno', href: it.link, target: '_blank', rel: 'noopener', text: it.botao })
          : el('button', { class: 'btn btn-whats btn-pequeno', type: 'button', disabled: true, title: 'Contato sem WhatsApp', text: it.botao });
      } else {
        botao = el('button', { class: 'btn btn-pequeno ' + (it.principal ? 'btn-principal' : 'btn-fantasma'), type: 'button', text: it.botao, onclick: it.acao });
      }
      return el('div', { class: 'adm-atencao-linha' }, [
        el('span', { class: 'adm-ico' + (it.tom ? ' ' + it.tom : ''), 'aria-hidden': 'true', text: it.ico }),
        el('div', { class: 'adm-atencao-texto' }, [el('b', { text: it.titulo }), el('span', { text: it.detalhe })]),
        botao,
      ]);
    }

    /* ============================================================
     * Aba: Lojas
     * ========================================================== */
    function filtroLoja(f, l) {
      if (f === 'todas') return true;
      if (f === 'desativadas') return l.ativa === false;
      if (f === 'verificadas') return l.verificada === true;
      if (l.ativa === false) return false;
      var a = R.assinatura(l);
      if (f === 'pagando') return pagando(a);
      if (f === 'teste') return a.estado === 'gratis';
      if (f === 'vencidas') return a.estado === 'vencida' || a.estado === 'bloqueada';
      if (f === 'pausadas') return a.estado === 'pausada' || a.estado === 'cancelada';
      return true;
    }

    function abaLojas(s) {
      var lojas = estado.lojas;
      var nAtivas = lojas.filter(function (l) { return l.ativa !== false; }).length;
      s.appendChild(cabeca('Lojas', plural(lojas.length, 'loja cadastrada', 'lojas cadastradas') + ', ' + plural(nAtivas, 'ativa', 'ativas'),
        el('button', { class: 'btn btn-principal', type: 'button', text: '+ Cadastrar estabelecimento', onclick: novaLoja })));
      var chips = el('div', { class: 'adm-chips', role: 'group', 'aria-label': 'Filtrar lojas' });
      var lista = el('div', { class: 'adm-lista adm-tabela' });
      var busca = campoBusca('lojas', 'Buscar loja, cidade ou dono', desenharLista);
      s.appendChild(el('div', { class: 'adm-barra' }, [busca, chips]));
      s.appendChild(lista);
      desenharLista();

      function desenharLista() {
        var q = termos(estado.busca.lojas);
        var achadas = lojas.filter(function (l) { return casa(q, [l.nome, l.cidade, l.uf, l.donoEmail, l.slug, l.tipo]); });
        var rolagem = chips.scrollLeft;
        UI.limpar(chips);
        FILTROS_LOJAS.forEach(function (f) {
          var n = achadas.filter(function (l) { return filtroLoja(f[0], l); }).length;
          chips.appendChild(chip(f[1], n, estado.filtro.lojas === f[0], function () { estado.filtro.lojas = f[0]; desenharLista(); }));
        });
        chips.scrollLeft = rolagem;
        var visiveis = achadas.filter(function (l) { return filtroLoja(estado.filtro.lojas, l); });
        UI.limpar(lista);
        if (!visiveis.length) {
          lista.appendChild(el('p', { class: 'adm-lista-vazia', text: lojas.length ? 'Nenhuma loja com essa busca ou filtro.' : 'Nenhuma loja ainda. Cadastre a primeira.' }));
          return;
        }
        lista.appendChild(cabecaTabela(['Loja', 'Cidade', 'Dono', 'Assinatura']));
        visiveis.forEach(function (l) { lista.appendChild(linhaLoja(l)); });
      }
    }

    function campoBusca(chaveBusca, dica, aoMudar) {
      var input = el('input', { class: 'busca', type: 'search', placeholder: dica, 'aria-label': dica, autocomplete: 'off', spellcheck: 'false', dataset: { busca: chaveBusca } });
      input.value = estado.busca[chaveBusca] || '';
      input.addEventListener('input', function () { estado.busca[chaveBusca] = input.value; aoMudar(); });
      return input;
    }

    /* linha da loja: no celular logo, nome e cidade + selo; no PC (dentro de .adm-tabela) vira tabela */
    function linhaLoja(l) {
      var sit = situacao(R.assinatura(l), l);
      var logo = D.logoSrc(l);
      return el('button', { class: 'adm-linha adm-com-logo' + (l.ativa === false ? ' desligada' : ''), type: 'button', onclick: function () { abrirLoja(l.slug); } }, [
        el('span', { class: 'adm-c-principal' }, [
          el('span', { class: 'adm-logo', 'aria-hidden': 'true' }, logo ? el('img', { src: logo, alt: '', loading: 'lazy' }) : (l.emoji || '🍽️')),
          el('span', { class: 'adm-textos' }, [
            el('span', { class: 'adm-nome' }, [l.nome || l.slug, UI.seloVerificada(l)]),
            el('span', { class: 'adm-sub adm-so-cel', text: cidadeUF(l) + (l.tipo ? ' · ' + l.tipo : '') }),
            el('span', { class: 'adm-sub adm-so-pc', text: (l.tipo || 'Loja') + ' · ' + l.slug }),
          ]),
        ]),
        el('span', { class: 'adm-c adm-so-pc', text: cidadeUF(l) }),
        el('span', { class: 'adm-c adm-so-pc' + (l.donoEmail ? '' : ' muted'), text: l.donoEmail || 'Sem conta' }),
        el('span', { class: 'adm-c-status' }, [seloSituacao(sit), sit.data ? el('span', { class: 'adm-data adm-so-pc', text: sit.data }) : null]),
        el('span', { class: 'adm-seta', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    /* ============================================================
     * Aba: Assinaturas (uma por conta, o e-mail do dono)
     * ========================================================== */
    function filtroConta(f, c) {
      if (f === 'todas') return true;
      var p = c.plano || {};
      var a = R.assinatura(c);
      if (f === 'avisos') return !!p.avisoPagamentoEm;
      if (f === 'pagando') return pagando(a);
      if (f === 'teste') return a.estado === 'gratis';
      if (f === 'vencidas') return a.estado === 'vencida' || a.estado === 'bloqueada';
      if (f === 'pausadas') return a.estado === 'pausada' || a.estado === 'cancelada';
      if (f === 'fundadores') return p.fundador === true;
      return true;
    }

    function abaContas(s) {
      var contas = estado.contas;
      var n = contarPendencias();
      s.appendChild(cabeca('Assinaturas', plural(contas.length, 'conta', 'contas') + (n.avisos ? ', ' + plural(n.avisos, 'avisou pagamento', 'avisaram pagamento') : '')));
      if (!estado.contasOk) { s.appendChild(UI.erroCarregar('Não deu para carregar as contas.', function () { desenhar(); })); return; }
      var chips = el('div', { class: 'adm-chips', role: 'group', 'aria-label': 'Filtrar assinaturas' });
      var lista = el('div', { class: 'adm-lista adm-tabela adm-tabela-contas' });
      var busca = campoBusca('contas', 'Buscar e-mail ou loja', desenharLista);
      s.appendChild(el('div', { class: 'adm-barra' }, [busca, chips]));
      s.appendChild(lista);
      desenharLista();

      function desenharLista() {
        var q = termos(estado.busca.contas);
        var achadas = contas.filter(function (c) { return casa(q, [c.email].concat(lojasDaConta(c.email).map(function (l) { return l.nome; }))); });
        var rolagem = chips.scrollLeft;
        UI.limpar(chips);
        FILTROS_CONTAS.forEach(function (f) {
          var qtd = achadas.filter(function (c) { return filtroConta(f[0], c); }).length;
          chips.appendChild(chip(f[1], qtd, estado.filtro.contas === f[0], function () { estado.filtro.contas = f[0]; desenharLista(); }));
        });
        chips.scrollLeft = rolagem;
        var visiveis = achadas.filter(function (c) { return filtroConta(estado.filtro.contas, c); });
        UI.limpar(lista);
        if (!visiveis.length) {
          lista.appendChild(el('p', { class: 'adm-lista-vazia', text: contas.length ? 'Nenhuma conta com essa busca ou filtro.' : 'Nenhuma conta ainda. Ela nasce quando o dono cria a loja com o e-mail dele.' }));
          return;
        }
        lista.appendChild(cabecaTabela(['Conta', 'Plano', 'Lojas', 'Assinatura']));
        visiveis.forEach(function (c) { lista.appendChild(linhaConta(c)); });
      }
    }

    function textoLojas(c, qtd) {
      var limite = R.limiteDeLojas(c);
      return limite >= 999 ? plural(qtd, 'loja', 'lojas') + ', sem limite' : qtd + ' de ' + plural(limite, 'loja', 'lojas');
    }

    function linhaConta(c) {
      var p = c.plano || {};
      var sit = situacao(R.assinatura(c), null);
      var plano = R.planoPorId(p.planoId || 'uma');
      var minhas = lojasDaConta(c.email);
      var tipo = p.tipo === 'anual' ? 'anual' : 'mensal';
      return el('button', { class: 'adm-linha', type: 'button', onclick: function () { abrirConta(c.email); } }, [
        el('span', { class: 'adm-c-principal' }, [
          el('span', { class: 'adm-textos' }, [
            /* fundador: estrela dourada logo depois do e-mail (igual o selo de verificada das lojas); a coluna da direita fica so com a situacao */
            el('span', { class: 'adm-nome' }, [c.email, p.fundador === true ? el('span', { class: 'adm-fund', title: 'Fundador', 'aria-label': 'Fundador', text: '★' }) : null]),
            el('span', { class: 'adm-sub adm-so-cel', text: plano.nome + ' · ' + tipo + ' · ' + textoLojas(c, minhas.length) }),
            el('span', { class: 'adm-sub adm-so-pc', text: minhas.length ? minhas.map(function (l) { return l.nome; }).join(', ') : 'Nenhuma loja ainda' }),
            p.avisoPagamentoEm ? el('span', { class: 'adm-sub adm-aviso-txt', text: '💸 Avisou pagamento de ' + din(p.avisoValor || 0) + ' em ' + dataBR(p.avisoPagamentoEm) }) : null,
          ]),
        ]),
        el('span', { class: 'adm-c adm-so-pc', text: plano.nome + ' · ' + tipo }),
        el('span', { class: 'adm-c adm-so-pc', text: textoLojas(c, minhas.length) }),
        el('span', { class: 'adm-c-status' }, [
          el('span', { class: 'adm-selos-linha' }, [seloSituacao(sit)]),
          sit.data ? el('span', { class: 'adm-data adm-so-pc', text: sit.data }) : null,
        ]),
        el('span', { class: 'adm-seta', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    /* ============================================================
     * Aba: Contatos (quem deixou o WhatsApp na pagina de vendas)
     * ========================================================== */
    function abaContatos(s) {
      var leads = estado.leads;
      var pendentes = leads.filter(function (c) { return !c.atendidoEm; }).length;
      s.appendChild(cabeca('Contatos', 'Quem deixou o WhatsApp na página de vendas. ' + (pendentes ? plural(pendentes, 'para chamar', 'para chamar') + '.' : 'Nenhum para chamar.')));
      if (!estado.leadsOk) { s.appendChild(UI.erroCarregar('Não deu para carregar os contatos.', function () { desenhar(); })); return; }
      var chips = el('div', { class: 'adm-chips', role: 'group', 'aria-label': 'Filtrar contatos' });
      FILTROS_CONTATOS.forEach(function (f) {
        var qtd = leads.filter(function (c) { return filtroContato(f[0], c); }).length;
        chips.appendChild(chip(f[1], qtd, estado.filtro.contatos === f[0], function () { estado.filtro.contatos = f[0]; pintar(); }));
      });
      s.appendChild(chips);
      var visiveis = leads.filter(function (c) { return filtroContato(estado.filtro.contatos, c); });
      var lista = el('div', { class: 'adm-lista' });
      if (!visiveis.length) lista.appendChild(el('p', { class: 'adm-lista-vazia', text: estado.filtro.contatos === 'pendentes' ? 'Ninguém esperando. Tudo em dia.' : 'Nenhum contato aqui.' }));
      visiveis.forEach(function (c) { lista.appendChild(linhaContato(c)); });
      s.appendChild(lista);
    }
    function filtroContato(f, c) {
      if (f === 'pendentes') return !c.atendidoEm;
      if (f === 'chamados') return !!c.atendidoEm;
      return true;
    }
    function linhaContato(c) {
      var pendente = !c.atendidoEm;
      var link = R.linkWhatsapp(c.whatsapp, mensagemLead(c));
      var detalhes = [c.loja, c.cidade ? c.cidade + (c.uf ? '/' + c.uf : '') : '', c.whatsapp ? R.formatarTelefone(c.whatsapp) : '', c.origem === 'lista-espera' ? '⏳ lista de espera' : (c.origem ? 'veio de: ' + c.origem : '')].filter(Boolean);
      var trava = { ocupado: false };
      function marcar(atendido) {
        return function () {
          if (trava.ocupado) return;
          trava.ocupado = true;
          store.atualizarLead(c.id, { atendidoEm: atendido ? new Date().toISOString() : '' }).then(function () {
            UI.avisar(atendido ? 'Contato marcado como atendido' : 'Contato voltou para lista de chamar');
            desenhar();
          }).catch(function (e) { trava.ocupado = false; UI.avisar(erroTexto(e, 'Não deu agora.')); });
        };
      }
      return el('div', { class: 'adm-contato' + (pendente ? '' : ' feito') }, [
        el('div', { class: 'adm-textos' }, [
          el('div', { class: 'adm-contato-topo' }, [
            el('span', { class: 'adm-nome', text: c.nome || 'Sem nome' }),
            el('span', { class: 'adm-data', text: dataBR(c.criadoEm) + ' ' + horaBR(c.criadoEm) }),
          ]),
          detalhes.length ? el('span', { class: 'adm-sub', text: detalhes.join(' · ') }) : null,
          pendente ? null : el('span', { class: 'adm-sub adm-ok-txt', text: '✓ Chamado em ' + dataBR(c.atendidoEm) }),
        ]),
        el('div', { class: 'adm-contato-acoes' }, [
          link ? el('a', { class: 'btn btn-whats btn-pequeno', href: link, target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'Chamar'])
            : el('button', { class: 'btn btn-whats btn-pequeno', type: 'button', disabled: true, title: 'Contato sem WhatsApp' }, [UI.icone('zap'), 'Chamar']),
          pendente ? el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '✓ Já chamei', onclick: marcar(true) })
            : el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', title: 'Volta para lista de quem falta chamar', text: 'Desmarcar', onclick: marcar(false) }),
        ]),
      ]);
    }

    /* ============================================================
     * Aba: Ferramentas
     * ========================================================== */
    function abaFerramentas(s) {
      s.appendChild(cabeca('Ferramentas', 'Manutenção, planilhas e informações do sistema.'));
      var cards = [];
      cards.push(ferramenta('📄', 'Exportar lojas', 'Planilha com ' + plural(estado.lojas.length, 'loja', 'lojas') + ': dono, WhatsApp, plano, vencimento e selo. Abre no Excel.',
        el('button', { class: 'btn btn-fantasma', type: 'button', text: 'Baixar planilha', onclick: exportarLojas })));
      cards.push(ferramenta('📄', 'Exportar contas', 'Planilha com ' + plural(estado.contas.length, 'conta', 'contas') + ': plano, cobrança, vencimento, fundador e lojas de cada uma.',
        el('button', { class: 'btn btn-fantasma', type: 'button', text: 'Baixar planilha', disabled: !estado.contasOk, onclick: exportarContas })));
      if (!D.modoDemo && store.reconstruirVitrine) {
        var btnVitrine = el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Refaz o resumo leve de todas as lojas (hub e cidades)', text: 'Reconstruir', onclick: function () {
          if (btnVitrine.disabled) return;
          btnVitrine.disabled = true; btnVitrine.textContent = 'Refazendo…';
          store.reconstruirVitrine().then(function (n) { UI.avisar('Vitrine refeita: ' + n + ' lojas.'); }).catch(function (e) { UI.avisar(e.message || 'Não deu.'); })
            .then(function () { btnVitrine.disabled = false; btnVitrine.textContent = 'Reconstruir'; });
        } });
        cards.push(ferramenta('♻️', 'Reconstruir vitrine', 'Refaz o resumo leve de todas as lojas, que a página das cidades usa. Use se alguma loja aparecer errada lá.', btnVitrine));
      }
      if (D.modoDemo) {
        cards.push(ferramenta('🗑️', 'Zerar demonstração', 'Apaga tudo deste navegador e volta aos dados de exemplo.', el('button', { class: 'btn btn-erro', type: 'button', text: 'Zerar demonstração', onclick: function () {
          UI.perguntar('Apagar tudo e voltar aos dados de exemplo? Só vale neste navegador.', { sim: 'Zerar', perigo: true }).then(function (sim) { if (sim) store.zerarDemo().then(function () { UI.avisar('Demonstração zerada'); }); });
        } })));
      }
      var an = (window.LIGEIRO_CONFIG || {}).analytics || {};
      cards.push(ferramenta('📈', 'Visitas do site', an.cloudflareToken
        ? 'Ficam no painel do Cloudflare Web Analytics (grátis, sem cookie), na sua conta Cloudflare › Analytics.'
        : 'Cole o token do Cloudflare Web Analytics em config.js (analytics.cloudflareToken) e as visitas de cada página aparecem no painel do Cloudflare, de graça e sem cookie.',
      el('a', { class: 'btn btn-fantasma', href: 'https://dash.cloudflare.com/?to=/:account/web-analytics', target: '_blank', rel: 'noopener', text: 'Abrir o Cloudflare' })));
      cards.push(ferramenta('🏷️', 'Preços em vigor', null, null, tabelaPrecos()));
      var src = (document.querySelector('script[src*="js/admin.js"]') || {}).src || '';
      var tag = (src.match(/\?v=([0-9a-z]+)/i) || [])[1] || 'sem número';
      cards.push(ferramenta('🔖', 'Versão do site', 'Versão ' + tag + '. ' + (D.modoDemo ? 'Modo demonstração: os dados ficam só neste navegador.' : 'Modo nuvem: dados no Firebase, iguais em todo aparelho.'),
        el('button', { class: 'btn btn-fantasma', type: 'button', text: 'Recarregar o site', onclick: function () { location.reload(); } })));
      s.appendChild(el('div', { class: 'adm-ferramentas' }, cards));
    }

    function ferramenta(icone, titulo, texto, botao, extra) {
      return el('div', { class: 'adm-ferramenta' }, [
        el('div', { class: 'adm-ferramenta-topo' }, [el('span', { class: 'adm-ico', 'aria-hidden': 'true', text: icone }), el('b', { text: titulo })]),
        texto ? el('p', { text: texto }) : null,
        extra || null,
        botao ? el('div', { class: 'adm-ferramenta-pe' }, botao) : null,
      ]);
    }

    function tabelaPrecos() {
      var celulas = [
        el('span', { class: 'adm-pc-cab', text: 'Plano' }),
        el('span', { class: 'adm-pc-cab adm-pc-num', text: 'Por mês' }),
        el('span', { class: 'adm-pc-cab adm-pc-num', text: 'Por ano' }),
      ];
      R.planos().forEach(function (p) {
        celulas.push(el('span', { class: 'adm-pc-nome', text: p.nome }));
        celulas.push(el('span', { class: 'adm-pc-num', text: R.dinheiro(p.mensal) }));
        celulas.push(el('span', { class: 'adm-pc-num', text: p.anual > 0 ? R.dinheiro(p.anual) : 'não tem' }));
        if (p.fundador) celulas.push(el('span', { class: 'adm-pc-fund', text: '★ Fundador: ' + R.dinheiro(p.fundador.mensal) + ' por mês' + (p.fundador.anual > 0 && p.anual > 0 ? ', ' + R.dinheiro(p.fundador.anual) + ' por ano' : '') }));
      });
      var dias = ((window.LIGEIRO_CONFIG || {}).precos || {}).diasGratis || 7;
      return el('div', { class: 'adm-precos-caixa' }, [
        el('div', { class: 'adm-precos' }, celulas),
        el('p', { class: 'adm-precos-nota', text: 'Período grátis: ' + plural(dias, 'dia', 'dias') + '. Vagas de fundador livres: ' + R.vagasFundador() + '.' }),
      ]);
    }

    function exportarLojas() {
      var linhas = [['slug', 'nome', 'cidade', 'uf', 'tipo', 'dono', 'whatsapp', 'status', 'pagoAte', 'verificada', 'ativa', 'criadoEm']];
      estado.lojas.forEach(function (l) {
        var p = l.plano || {};
        linhas.push([l.slug, l.nome, l.cidade, l.uf, l.tipo, l.donoEmail || '', l.whatsapp ? R.formatarTelefone(l.whatsapp) : '', p.status || '', dataBR(p.pagoAte), l.verificada === true ? 'sim' : 'não', l.ativa === false ? 'não' : 'sim', dataBR(l.criadoEm)]);
      });
      baixarCsv('ligeiro-lojas-' + R.diaLocal() + '.csv', linhas);
    }
    function exportarContas() {
      var linhas = [['email', 'plano', 'tipo', 'status', 'pagoAte', 'fundador', 'ultimoPagamentoEm', 'lojas']];
      estado.contas.forEach(function (c) {
        var p = c.plano || {};
        linhas.push([c.email, R.planoPorId(p.planoId || 'uma').nome, p.tipo || 'mensal', p.status || 'teste', dataBR(p.pagoAte), p.fundador === true ? 'sim' : 'não', dataBR(p.ultimoPagamentoEm), lojasDaConta(c.email).map(function (l) { return l.nome; }).join(', ')]);
      });
      baixarCsv('ligeiro-contas-' + R.diaLocal() + '.csv', linhas);
    }

    /* ============================================================
     * Fichas (modal): loja e conta
     * ========================================================== */

    /* Trava por loja ou por conta (nao por ficha): fechar e abrir a ficha de novo no meio da gravacao continua travado.
       So solta depois que os dados frescos chegam, deu certo ou nao: tocar de novo com dados velhos na tela poderia
       somar dias ou contar a vaga de fundador duas vezes. */
    function travaDe(chave) {
      estado.travas = estado.travas || {};
      return estado.travas[chave] || (estado.travas[chave] = { ocupado: false, voando: false });
    }
    /* Atualizar deu certo: solta as travas que nao tem gravacao no ar */
    function soltarTravasParadas() {
      Object.keys(estado.travas || {}).forEach(function (k) { if (!estado.travas[k].voando) estado.travas[k].ocupado = false; });
    }
    /* depois de uma acao (deu certo ou nao): busca os dados de novo; so com eles solta a trava e reabre a ficha */
    function concluir(marca, trava) {
      desenhar().then(function (ok) {
        if (ok) { if (trava) trava.ocupado = false; reabrir(marca); return; }
        /* sem dados frescos: fecha a ficha velha e a trava fica ate o Atualizar dar certo */
        if (marca && marca === estado.ficha) { estado.ficha = null; UI.fecharModal(); }
      });
    }
    function reabrir(marca) {
      if (!vivo || !marca || marca !== estado.ficha) return;
      if (marca.tipo === 'loja') abrirLoja(marca.slug);
      else abrirConta(marca.email);
    }
    /* acao simples de uma ficha: trava o toque duplo, avisa e reabre a ficha atualizada */
    function executar(trava, marca, fazer, textoOk) {
      if (trava.ocupado) return;
      trava.ocupado = true;
      trava.voando = true;
      Promise.resolve().then(fazer).then(function () {
        trava.voando = false;
        if (textoOk) UI.avisar(textoOk);
        concluir(marca, trava);
      }, function (e) {
        trava.voando = false;
        UI.avisar(erroTexto(e, 'Não deu agora. Tente de novo.'));
        concluir(marca, trava);
      });
    }

    function abrirLoja(slug) {
      var l = acharLoja(slug);
      if (!l) { UI.avisar('Loja não encontrada. Toque em Atualizar.'); return; }
      var marca = estado.ficha = { tipo: 'loja', slug: slug };
      var trava = travaDe('loja:' + slug);
      var plano = l.plano || { status: 'teste' };
      var a = R.assinatura(l);
      var sit = situacao(a, l);
      var linkLoja = UI.linkDaLoja(l);
      var corpo = el('div', { class: 'adm-ficha' });

      corpo.appendChild(el('div', { class: 'adm-selos' }, [
        seloSituacao(sit), l.verificada === true ? el('span', { class: 'selo adm-selo', text: '✔ Verificada' }) : null,
        sit.data ? el('span', { class: 'adm-data', text: sit.data }) : null,
      ]));
      corpo.appendChild(el('div', { class: 'adm-link' }, [
        el('div', { class: 'caixa-link', text: linkLoja }),
        el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📋 Copiar', onclick: function () { UI.copiar(linkLoja).then(function () { UI.avisar('Link copiado'); }); } }),
      ]));
      if (!l.donoEmail && plano.avisoPagamentoEm) corpo.appendChild(alerta('💸 Avisou pagamento de ' + din(plano.avisoValor || 0) + ' em ' + dataBR(plano.avisoPagamentoEm) + '. Confira no banco e confirme.'));

      corpo.appendChild(el('h3', { text: 'Dados' }));
      var cat = R.catalogo(l);
      corpo.appendChild(dados([
        ['WhatsApp', l.whatsapp ? R.formatarTelefone(l.whatsapp) : 'Não cadastrado'],
        ['Pix', l.pix && l.pix.chave ? l.pix.chave : 'Não cadastrado'],
        ['Mercado Pago', l.mpAtivo ? 'Conectado' : 'Não conectado'],
        ['Dono (login)', l.donoEmail || 'Sem conta'],
        ['Cidade', cidadeUF(l)],
        ['Tipo', l.tipo || 'Não informado'],
        ['Criada em', dataBR(l.criadoEm) || 'Sem data'],
        ['CNPJ', l.cnpj ? R.formatarCnpj(l.cnpj) : 'Não informado'],
        ['Aberta agora', R.lojaAberta(l) ? 'Sim' : 'Não'],
        ['Verificada', l.verificada === true ? 'Sim' : 'Não'],
        [cat.Nome, plural(R.produtosAtivos(l).length, 'item ativo', 'itens ativos')],
        D.modoDemo ? ['Senha do painel', l.senhaPainel || 'Sem senha'] : ['Endereço', l.cidadeSlug + '/' + l.slug],
      ]));

      corpo.appendChild(el('h3', { text: 'Pedidos' }));
      var caixaPedidos = el('div', { class: 'adm-numeros' });
      corpo.appendChild(caixaPedidos);
      pedidosDaLoja(caixaPedidos, l.slug);

      corpo.appendChild(el('h3', { text: 'Ações' }));
      var zap = R.linkWhatsapp(l.whatsapp, 'Oi! Aqui é do Ligeiro.');
      corpo.appendChild(grade([
        el('a', { class: 'btn btn-fantasma', href: '#/' + l.cidadeSlug + '/' + l.slug, target: '_blank', rel: 'noopener', text: '👁️ Ver loja' }),
        el('a', { class: 'btn btn-fantasma', href: '#/painel/' + l.slug, target: '_blank', rel: 'noopener', text: '⚙️ Abrir painel' }),
        zap ? el('a', { class: 'btn btn-whats', href: zap, target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'WhatsApp'])
          : el('button', { class: 'btn btn-whats', type: 'button', disabled: true, title: 'Loja sem WhatsApp cadastrado' }, [UI.icone('zap'), 'WhatsApp']),
        el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Copia o link da loja e o do painel, para mandar para o dono', text: '📋 Copiar links', onclick: function () {
          var texto = l.nome + '\nCardápio: ' + UI.linkDaLoja(l) + '\nPainel: ' + UI.linkDoPainel(l) + (D.modoDemo ? ' (senha ' + (l.senhaPainel || '') + ')' : (l.donoEmail ? ' (login ' + l.donoEmail + ')' : ''));
          UI.copiar(texto).then(function () { UI.avisar('Links da loja e do painel copiados'); });
        } }),
        el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Selo verde ao lado do nome. Ligue depois de conferir que a loja existe (WhatsApp, endereço).', text: l.verificada === true ? 'Tirar selo' : '✔ Verificar', onclick: function () {
          executar(trava, marca, function () { return store.salvarLoja({ slug: l.slug, verificada: l.verificada !== true }); }, l.verificada === true ? l.nome + ' sem o selo' : l.nome + ' verificada');
        } }),
        l.ativa === false
          ? el('button', { class: 'btn btn-principal', type: 'button', text: 'Reativar loja', onclick: function () {
            executar(trava, marca, function () { return store.salvarLoja({ slug: l.slug, ativa: true }); }, l.nome + ' voltou para o site');
          } })
          : el('button', { class: 'btn btn-erro', type: 'button', text: 'Desativar', onclick: function () {
            UI.perguntar('Desativar ' + l.nome + '? A loja sai do site e para de receber pedidos. Dá para reativar depois, aqui mesmo.', { titulo: 'Desativar loja?', sim: 'Desativar', perigo: true }).then(function (sim) {
              if (!sim) { reabrir(marca); return; }
              /* na nuvem excluirLoja so marca ativa: false; na demonstracao ela apagaria de vez, entao ali so desliga */
              executar(trava, marca, function () { return D.modoDemo ? store.salvarLoja({ slug: l.slug, ativa: false }) : store.excluirLoja(l.slug); }, l.nome + ' desativada');
            });
          } }),
      ]));

      if (!l.donoEmail) {
        /* loja sem conta: o plano mora nela mesma, e o admin libera direto aqui */
        corpo.appendChild(el('h3', { text: 'Plano desta loja' }));
        var rotulos = { teste: 'Teste grátis', ativo: 'Pagando', pausado: 'Pausado', cancelado: 'Cancelado' };
        var sel = el('select', { 'aria-label': 'Situação do plano' }, ['teste', 'ativo', 'pausado', 'cancelado'].map(function (v) { var o = el('option', { value: v, text: rotulos[v] }); if (plano.status === v) o.selected = true; return o; }));
        sel.addEventListener('change', function () {
          if (trava.ocupado) { sel.value = plano.status; return; }
          /* so os campos que mudam: a loja pode ter sido editada no painel enquanto isso */
          executar(trava, marca, function () {
            return store.salvarLoja({ slug: l.slug, plano: Object.assign({}, plano, { status: sel.value, desde: sel.value === plano.status ? plano.desde : new Date().toISOString() }), ativa: sel.value !== 'cancelado' });
          }, 'Plano de ' + l.nome + ': ' + rotulos[sel.value]);
        });
        var precos = (window.LIGEIRO_CONFIG || {}).precos || {};
        /* Confirmar pagamento: soma os dias a partir do fim atual (ou de hoje, se ja venceu). */
        var confirmarLoja = function (dias) {
          var base = Math.max(Date.now(), a.limite ? new Date(a.limite).getTime() : 0);
          var novo = new Date(base + dias * 864e5).toISOString();
          executar(trava, marca, function () {
            return store.salvarLoja({ slug: l.slug, plano: Object.assign({}, plano, { status: 'ativo', tipo: dias > 31 ? 'anual' : (plano.tipo || 'mensal'), pagoAte: novo, avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString() }), ativa: true });
          }, l.nome + ' liberada até ' + dataBR(novo));
        };
        corpo.appendChild(el('div', { class: 'adm-caixa adm-plano' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Situação' }), sel]),
          el('button', { class: 'btn btn-principal', type: 'button', title: 'Loja sem conta: libera direto nela', text: '✓ Pagou ' + R.dinheiro(precos.mensal || 7900) + ' (+30 dias)', onclick: function () { confirmarLoja(30); } }),
        ]));
      } else {
        /* loja com dono: o plano e da conta dele, aqui so aponta pra ficha da conta */
        corpo.appendChild(el('h3', { text: 'Assinatura' }));
        corpo.appendChild(el('div', { class: 'adm-caixa adm-conta-linha' }, [
          el('div', { class: 'adm-textos' }, [
            el('span', { class: 'adm-sub', text: plano.avisoPagamentoEm ? '💸 A conta avisou pagamento. Assinatura na conta' : 'Assinatura na conta' }),
            el('span', { class: 'adm-nome', text: l.donoEmail }),
          ]),
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Abrir conta', onclick: function () { abrirConta(l.donoEmail); } }),
        ]));
      }

      UI.abrirModal({ titulo: l.nome || l.slug, sub: cidadeUF(l) + (l.tipo ? ' · ' + l.tipo : ''), corpo: corpo, classe: 'adm-modal' });
    }

    /* pedidos de hoje e dos ultimos 7 dias da loja (uma leitura, guardada 5 min) */
    function pedidosDaLoja(caixa, slug) {
      function mostrar(r) {
        UI.limpar(caixa);
        if (r && r.erro) { caixa.appendChild(el('p', { class: 'adm-lista-vazia', text: 'Não deu para carregar os pedidos agora.' })); return; }
        [['Hoje', r && r.hoje], ['Últimos 7 dias', r && r.semana]].forEach(function (x) {
          var v = x[1];
          caixa.appendChild(kpi(x[0], v ? [String(v.qtd), el('small', { class: 'adm-pos', text: v.qtd === 1 ? 'pedido' : 'pedidos' })] : '…', v ? R.dinheiro(v.total) + ' vendidos' : 'carregando…'));
        });
      }
      var guardado = estado.pedidosLoja[slug];
      if (guardado && Date.now() - guardado.em < 5 * 60 * 1000) { mostrar(guardado); return; }
      mostrar(null);
      store.vendasDoPeriodo(slug, 7).then(function (v) {
        var hoje = R.diaLocal(new Date());
        var r = { em: Date.now(), hoje: { qtd: v.porDiaQtd[hoje] || 0, total: v.porDia[hoje] || 0 }, semana: { qtd: v.pedidos, total: v.total } };
        estado.pedidosLoja[slug] = r;
        if (caixa.isConnected) mostrar(r);
      }).catch(function () { if (caixa.isConnected) mostrar({ erro: true }); });
    }

    /* Ficha da conta: a assinatura e da conta (e-mail do dono); confirmar aqui espelha nas lojas dela. */
    function abrirConta(email, pronta) {
      var c = pronta || acharConta(email);
      if (!c) {
        if (!store.obterConta) { UI.avisar('Essa conta não foi encontrada.'); return; }
        store.obterConta(email).then(function (x) { if (x) abrirConta(email, x); else UI.avisar('Essa conta ainda não existe.'); });
        return;
      }
      var marca = estado.ficha = { tipo: 'conta', email: c.email };
      var lojas = estado.lojas || [];
      /* ---- mesma logica do cartao de assinatura de antes (ja corrigida varias vezes: nao mexer sem motivo) ---- */
      var p = c.plano || {};
      var a = R.assinatura(c);
      var plano = R.planoPorId(p.planoId || 'uma');
      var minhas = lojas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === String(c.email || '').toLowerCase(); });
      var textoA = {
        gratis: 'Grátis até ' + (a.limite ? dataBR(a.limite) : ''), ativa: a.cortesia ? 'Cortesia' : 'Paga até ' + dataBR(a.limite),
        vencendo: 'Vence ' + dataBR(a.limite), vencida: 'Vencida em ' + dataBR(a.limite), bloqueada: 'Bloqueada desde ' + dataBR(a.limite),
        pausada: 'Pausada', cancelada: 'Cancelada',
      }[a.estado] || a.estado;
      var primeiroPagamento = !p.ultimoPagamentoEm; /* cortesia nao conta como pagamento */
      var viraFundador = p.fundador !== true && primeiroPagamento && R.vagasFundador() > 0;
      var trava = travaDe('conta:' + String(c.email || '').toLowerCase()); /* um clique por vez: clique duplo contaria a vaga de fundador duas vezes */
      function confirmar(dias) {
        if (trava.ocupado) return; trava.ocupado = true; trava.voando = true;
        var base = Math.max(Date.now(), a.limite ? new Date(a.limite).getTime() : 0);
        var novo = new Date(base + dias * 864e5).toISOString();
        store.salvarConta(c.email, { plano: { status: 'ativo', tipo: dias > 31 ? 'anual' : (p.tipo || 'mensal'), pagoAte: novo, planoPago: plano.id, fundador: p.fundador === true || viraFundador, avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString(), ultimoPagamentoDias: dias, fundadorPeloPagamento: viraFundador, pagamentoDesfeitoEm: '' } })
          .then(function () { return viraFundador && store.ocuparVagaFundador ? store.ocuparVagaFundador().then(function (f) { window.LigeiroFundadores = Object.assign({}, window.LigeiroFundadores, { usados: f.usados }); }) : null; })
          .then(function () { return store.espelharPlanoNasLojas(c.email); })
          .then(function () { trava.voando = false; UI.avisar(c.email + ' liberada até ' + dataBR(novo) + ' (' + minhas.length + (minhas.length === 1 ? ' loja' : ' lojas') + ')'); concluir(marca, trava); })
          .catch(function (e) { trava.voando = false; UI.avisar(e && e.message ? e.message : 'Não deu para confirmar.'); concluir(marca, trava); });
      }
      function tornarFundador() {
        if (trava.ocupado) return; trava.ocupado = true; trava.voando = true;
        store.salvarConta(c.email, { plano: { fundador: true } })
          .then(function () { return store.ocuparVagaFundador ? store.ocuparVagaFundador().then(function (f) { window.LigeiroFundadores = Object.assign({}, window.LigeiroFundadores, { usados: f.usados }); }) : null; })
          .then(function () { return store.espelharPlanoNasLojas(c.email); })
          .then(function () { trava.voando = false; UI.avisar(c.email + ' agora é fundador'); concluir(marca, trava); })
          .catch(function (e) { trava.voando = false; UI.avisar(e && e.message ? e.message : 'Não deu agora.'); concluir(marca, trava); }); /* so solta com os dados frescos: ai a ficha mostra se ja virou fundador */
      }
      /* Desfaz o ultimo "Pagou" (teste ou toque sem querer): so tira os dias que ele somou, nunca da dias a mais.
         Se o que sobra cai dentro dos dias gratis, era o primeiro pagamento: volta pro gratis e sai da receita. */
      var podeDesfazer = !!(p.ultimoPagamentoEm && p.pagoAte && !(p.pagamentoDesfeitoEm && p.pagamentoDesfeitoEm >= p.ultimoPagamentoEm));
      function semUltimoPagamento() {
        var pago = new Date(p.pagoAte).getTime();
        var dias = p.ultimoPagamentoDias === 30 || p.ultimoPagamentoDias === 365 ? p.ultimoPagamentoDias
          : (pago - new Date(p.ultimoPagamentoEm).getTime() >= 364 * 864e5 ? 365 : 30); /* Pagou de antes desse campo existir */
        var antes = pago - dias * 864e5;
        var diasGratis = ((window.LIGEIRO_CONFIG || {}).precos || {}).diasGratis || 7;
        var fimGratis = new Date(p.desde || c.criadoEm || 0).getTime() + diasGratis * 864e5;
        var agora = new Date().toISOString();
        if (antes > fimGratis + 60e3) return { pagoAte: new Date(antes).toISOString(), pagamentoDesfeitoEm: agora };
        var r = { pagoAte: '', planoPago: '', ultimoPagamentoEm: '', ultimoPagamentoDias: 0, pagamentoDesfeitoEm: agora };
        if (p.status === 'ativo') r.status = 'teste';
        if (p.fundador === true && p.fundadorPeloPagamento === true) { r.fundador = false; r.fundadorPeloPagamento = false; }
        return r;
      }
      function desfazerPagamento() {
        var novo = semUltimoPagamento();
        var texto = 'Desfazer o pagamento marcado em ' + dataBR(p.ultimoPagamentoEm) + '? Use só se foi teste ou toque sem querer. '
          + (novo.pagoAte ? 'A conta perde os dias que ele somou e fica paga até ' + dataBR(novo.pagoAte) + '.' : 'Era o primeiro pagamento: a conta volta para o teste grátis e sai da receita.')
          + (novo.fundador === false ? ' O preço de fundador sai e a vaga volta para o contador.' : '');
        comPergunta(texto, { titulo: 'Desfazer pagamento?', sim: 'Desfazer', perigo: true }, function () {
          return store.salvarConta(c.email, { plano: novo }).then(function () {
            return novo.fundador === false && store.liberarVagaFundador ? store.liberarVagaFundador().then(function (f) { window.LigeiroFundadores = Object.assign({}, window.LigeiroFundadores, { usados: f.usados }); }) : null;
          });
        }, 'Pagamento desfeito');
      }
      /* pergunta antes (a pergunta ocupa o modal); "Voltar" reabre a ficha */
      function comPergunta(texto, opcoes, fazer, textoOk) {
        if (trava.ocupado) return;
        UI.perguntar(texto, opcoes).then(function (sim) {
          if (!sim) { reabrir(marca); return; }
          executar(trava, marca, function () { return fazer().then(function () { return store.espelharPlanoNasLojas(c.email); }); }, textoOk);
        });
      }
      var valorMensal = R.precoDoPlano(plano.id, 'mensal', c);
      var valorAnual = R.precoDoPlano(plano.id, 'anual', c);
      var temAnual = plano.anual > 0 && valorAnual > 0; /* anual: 0 na config esconde o anual */
      var parada = p.status === 'pausado' || p.status === 'cancelado';
      var sit = situacao(a, null);
      var tipo = p.tipo === 'anual' ? 'anual' : 'mensal';

      var corpo = el('div', { class: 'adm-ficha' });
      corpo.appendChild(el('div', { class: 'adm-selos' }, [
        seloSituacao(sit),
        p.fundador === true ? el('span', { class: 'selo adm-selo selo-fundador', text: '★ Fundador' }) : (viraFundador ? el('span', { class: 'selo adm-selo laranja', text: 'Vira fundador ao confirmar' }) : null),
        sit.data ? el('span', { class: 'adm-data', text: sit.data }) : null,
      ]));
      if (p.avisoPagamentoEm) corpo.appendChild(alerta('💸 Avisou pagamento de ' + din(p.avisoValor || 0) + ' em ' + dataBR(p.avisoPagamentoEm) + '. Confira no banco e confirme.'));

      corpo.appendChild(el('h3', { text: 'Resumo' }));
      corpo.appendChild(dados([
        ['Plano', plano.nome],
        ['Cobrança', tipo === 'anual' ? 'Anual' : 'Mensal'],
        ['Valor', (tipo === 'anual' && temAnual ? R.dinheiro(valorAnual) + ' por ano' : R.dinheiro(valorMensal) + ' por mês') + (R.ehPrecoFundador(c) ? ', preço de fundador' : '')],
        ['Situação', textoA],
        [a.estado === 'gratis' ? 'Grátis até' : 'Pago até', a.cortesia ? 'Sem vencimento' : (a.limite ? dataBR(a.limite) : 'Sem data')],
        ['Fundador', p.fundador === true ? 'Sim' : (viraFundador ? 'Vira ao confirmar o pagamento' : 'Não')],
        ['Último pagamento', p.ultimoPagamentoEm ? dataBR(p.ultimoPagamentoEm) : 'Nenhum ainda'],
        ['Conta criada em', dataBR(c.criadoEm) || 'Sem data'],
      ]));

      corpo.appendChild(el('h3', { text: 'Lojas · ' + textoLojas(c, minhas.length) }));
      if (minhas.length) corpo.appendChild(el('div', { class: 'adm-lista' }, minhas.map(function (l) { return linhaLoja(l); })));
      else corpo.appendChild(el('p', { class: 'muted', text: 'Nenhuma loja criada ainda.' }));

      corpo.appendChild(el('h3', { text: 'Ações' }));
      corpo.appendChild(el('div', { class: 'adm-acoes-linha' }, [
        el('button', { class: 'btn btn-principal', type: 'button', text: '✓ Pagou ' + R.dinheiro(valorMensal) + ' (+30 dias)', onclick: function () { confirmar(30); } }),
        temAnual ? el('button', { class: 'btn btn-escuro', type: 'button', text: '✓ Pagou ' + R.dinheiro(valorAnual) + ' (+1 ano)', onclick: function () { confirmar(365); } }) : null,
        podeDesfazer ? el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Foi teste ou toque sem querer: tira os dias que o último Pagou somou', text: '↩ Desfazer o último pagamento', onclick: desfazerPagamento }) : null,
      ]));
      corpo.appendChild(grade([
        el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Libera a conta sem data para vencer', text: 'Cortesia', onclick: function () {
          comPergunta('Dar cortesia para ' + c.email + '? A conta fica liberada sem data para vencer, até você mudar.', { titulo: 'Cortesia', sim: 'Dar cortesia' }, function () {
            return store.salvarConta(c.email, { plano: { status: 'ativo', pagoAte: '', planoPago: plano.id } });
          }, c.email + ' em cortesia');
        } }),
        parada
          ? el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Volta a assinatura, do jeito que o dono faz em Minha conta', text: 'Reativar', onclick: function () {
            executar(trava, marca, function () {
              var aindaPago = p.pagoAte && new Date(p.pagoAte).getTime() > Date.now();
              return store.salvarConta(c.email, { plano: { status: aindaPago ? 'ativo' : 'teste', reativadoEm: new Date().toISOString() } })
                .then(function () { return store.espelharPlanoNasLojas(c.email); });
            }, c.email + ' reativada');
          } })
          : el('button', { class: 'btn btn-erro', type: 'button', text: 'Pausar', onclick: function () {
            comPergunta('Pausar a assinatura de ' + c.email + '? ' + (minhas.length ? 'As lojas dela param de receber pedidos na hora.' : 'A conta fica parada até você reativar.'), { titulo: 'Pausar assinatura?', sim: 'Pausar', perigo: true }, function () {
              return store.salvarConta(c.email, { plano: { status: 'pausado' } });
            }, c.email + ' pausada');
          } }),
        p.fundador === true
          ? el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Use quando a conta cancelar: ela perde o preço travado', text: 'Tirar fundador', onclick: function () {
            comPergunta('Tirar o preço de fundador de ' + c.email + '? A vaga não volta para o contador sozinha.', { sim: 'Tirar', perigo: true }, function () {
              return store.salvarConta(c.email, { plano: { fundador: false } });
            }, c.email + ' sem preço de fundador');
          } })
          : (R.vagasFundador() > 0 ? el('button', { class: 'btn btn-fantasma', type: 'button', title: 'Trava o preço de fundador nesta conta e ocupa uma vaga', text: 'Tornar fundador', onclick: tornarFundador }) : null),
      ]));

      UI.abrirModal({ titulo: c.email, sub: plano.nome + ' · ' + tipo, corpo: corpo, classe: 'adm-modal' });
    }

    /* ============================================================
     * Cadastrar estabelecimento
     * ========================================================== */
    function campo(rotulo, valor, opcoes) {
      var o = opcoes || {};
      var input = el('input', { type: o.tipo || 'text', maxlength: o.max || 80, placeholder: o.placeholder || '', inputmode: o.inputmode || null });
      input.value = valor || '';
      var b = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [el('label', { text: rotulo }), o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null, input]);
      b.input = input;
      return b;
    }

    function novaLoja() {
      estado.ficha = null;
      var f = {};
      f.nome = campo('Nome do estabelecimento', '', { max: 60, placeholder: 'Ex: Lanchonete do Zé' });
      var tipoSel = el('select', {}, TIPOS.map(function (t) { return el('option', { value: t[0], text: t[1] + ' ' + t[0] }); }));
      f.tipo = el('div', { class: 'campo' }, [el('label', { text: 'Tipo' }), tipoSel]);
      f.cidade = window.LigeiroCidades.campo('Juquiá', 'SP', { rotulo: 'Cidade', largo: true });
      f.whatsapp = campo('WhatsApp da loja', '', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999' });
      UI.mascaraTelefone(f.whatsapp.input);
      f.senha = D.modoDemo
        ? campo('Senha do painel', String(1000 + Math.floor(Math.random() * 9000)), { max: 20, ajuda: 'Anote e entregue para o dono.' })
        : campo('E-mail do dono (login do painel)', '', { max: 80, tipo: 'email', ajuda: 'O dono entra com o Google deste e-mail.' });
      var modeloSel = el('select', {}, MODELOS.map(function (m) { return el('option', { value: m[0], text: m[1] }); }));
      f.modelo = el('div', { class: 'campo largo' }, [el('label', { text: 'Começar com que cardápio?' }), el('p', { class: 'ajuda', text: 'O modelo vem com categorias, itens e adicionais típicos. Depois é só ajustar nome e preço no painel.' }), modeloSel]);
      var corpo = el('div', { class: 'grade-form', style: { paddingTop: '8px' } }, [f.nome, f.tipo, f.cidade, f.whatsapp, f.senha, f.modelo]);

      UI.abrirModal({ titulo: 'Cadastrar estabelecimento', corpo: corpo, rodape: [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Cadastrar', onclick: function () {
        var nome = f.nome.input.value.trim();
        if (nome.length < 2) return UI.avisar('Digite o nome.');
        var tipo = tipoSel.value;
        var emoji = (TIPOS.filter(function (t) { return t[0] === tipo; })[0] || ['', '🍽️'])[1];
        var dadosLoja = {
          nome: nome, tipo: tipo, emoji: emoji,
          cidade: (f.cidade.valor() || { nome: 'Juquiá', uf: 'SP' }).nome, uf: (f.cidade.valor() || { nome: 'Juquiá', uf: 'SP' }).uf,
          whatsapp: f.whatsapp.input.value.replace(/\D/g, ''),
          senhaPainel: D.modoDemo ? (f.senha.input.value.trim() || '1234') : undefined,
          donoEmail: D.modoDemo ? undefined : f.senha.input.value.trim().toLowerCase(),
          aceitaPix: false, mpAtivo: false,
          categorias: [], produtos: [], grupos: {}, gruposPorCategoria: {},
        };
        var modelo = modeloSel.value;
        if (modelo !== 'vazio' && window.LigeiroSeed) {
          var base = window.LigeiroSeed().lojas[modelo];
          if (base) {
            dadosLoja.categorias = D.clonar(base.categorias);
            dadosLoja.produtos = D.clonar(base.produtos);
            dadosLoja.grupos = D.clonar(base.grupos);
            dadosLoja.gruposPorCategoria = D.clonar(base.gruposPorCategoria);
          }
        } else if (modelo === 'vazio') {
          dadosLoja.categorias = [{ id: 'cardapio', nome: 'Cardápio', emoji: emoji }];
        }
        /* trava o botao ate o banco responder: toque duplo cadastrava a loja duas vezes */
        var botao = this;
        botao.disabled = true; botao.textContent = 'Salvando…';
        /* loja com e-mail do dono: garante a conta dele (a assinatura mora la) */
        var conta = dadosLoja.donoEmail && store.obterConta
          ? store.obterConta(dadosLoja.donoEmail).then(function (c) { return c || store.salvarConta(dadosLoja.donoEmail, { plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: new Date().toISOString() } }); })
          : Promise.resolve(null);
        conta.then(function (c) {
          if (c && c.plano) dadosLoja.plano = { status: c.plano.status || 'teste', tipo: c.plano.tipo || 'mensal', planoId: c.plano.planoId || 'uma', planoPago: c.plano.planoPago || '', desde: c.plano.desde || new Date().toISOString(), pagoAte: c.plano.pagoAte || '' };
          return store.criarLoja(dadosLoja);
        }).then(function (loja) {
          UI.fecharModal();
          UI.soar('sucesso');
          mostrarLinks(loja);
          if (!store.assistir) desenhar(); /* na nuvem a lista de tras ja aparece com a loja nova */
        }).catch(function (e) { botao.disabled = false; botao.textContent = 'Cadastrar'; UI.avisar(e && e.message ? e.message : 'Não deu para cadastrar.'); });
      } })] });
      setTimeout(function () { f.nome.input.focus(); }, 60);
    }

    function mostrarLinks(loja) {
      estado.ficha = null;
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
        el('p', { text: 'Pronto! Entregue estes dois links para o dono:' }),
        el('div', {}, [el('b', { text: 'Cardápio (para o cliente)' }), el('div', { class: 'caixa-link', text: UI.linkDaLoja(loja) })]),
        el('div', {}, [el('b', { text: 'Painel (só o dono)' }), el('div', { class: 'caixa-link', text: UI.linkDoPainel(loja) }), el('p', { class: 'muted pequeno', text: D.modoDemo ? 'Senha do painel: ' + loja.senhaPainel : 'Login: ' + (loja.donoEmail || '') + ', entrando com o Google deste e-mail' })]),
      ]);
      UI.abrirModal({ titulo: loja.nome + ' cadastrado', corpo: corpo, rodape: [
        el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Copiar tudo', onclick: function () {
          var texto = loja.nome + '\nCardápio: ' + UI.linkDaLoja(loja) + '\nPainel: ' + UI.linkDoPainel(loja) + (D.modoDemo ? ' (senha ' + loja.senhaPainel + ')' : ' (login ' + (loja.donoEmail || '') + ')');
          UI.copiar(texto).then(function () { UI.avisar('Copiado'); });
        } }),
        el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Abrir o painel', onclick: function () { UI.fecharModal(); window.LigeiroApp.ir('painel/' + loja.slug); } }),
      ] });
    }
  }

  window.LigeiroAdmin = { abrir: abrir, TIPOS: TIPOS, MODELOS: MODELOS };
})();
