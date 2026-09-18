/*
 * Ligeiro - camada de dados.
 *
 * Duas implementacoes com a MESMA cara:
 *   - DemoStore: tudo no localStorage deste navegador. Modo demonstracao.
 *   - FirebaseStore: lojas e pedidos na nuvem (Firestore), painel em tempo
 *     real em qualquer aparelho. Liga sozinha quando LIGEIRO_CONFIG.firebase
 *     esta preenchido.
 *
 * As telas nunca sabem qual das duas esta por baixo: chamam
 * window.LigeiroDados.store e pronto.
 */
(function () {
  'use strict';

  var R = window.LigeiroRegras;
  var CHAVE = 'ligeiro.demo.v3';

  function agoraISO() { return new Date().toISOString(); }
  function clonar(x) { return JSON.parse(JSON.stringify(x)); }
  var SEM_ESPACO = 'O aparelho está sem espaço pra guardar. Apague fotos antigas ou zere a demonstração.';

  /*
   * Firestore nao aceita array dentro de array: na nuvem as faixas de horario
   * viram "18:00-23:00". E a senha do painel nunca vai pro documento (que e
   * publico): no modo de verdade a senha e a do login.
   */
  function paraNuvem(loja) {
    var l = clonar(loja);
    delete l.senhaPainel;
    if (l.horarios) Object.keys(l.horarios).forEach(function (dia) {
      l.horarios[dia] = (l.horarios[dia] || []).map(function (f) { return Array.isArray(f) ? f[0] + '-' + f[1] : f; });
    });
    return l;
  }
  function daNuvem(dados) {
    if (!dados) return dados;
    if (dados.horarios) Object.keys(dados.horarios).forEach(function (dia) {
      dados.horarios[dia] = (dados.horarios[dia] || []).map(function (f) { return typeof f === 'string' ? f.split('-') : f; });
    });
    return dados;
  }

  function idAleatorio(tamanho) {
    var letras = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var saida = '';
    var bytes = new Uint8Array(tamanho);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < tamanho; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < tamanho; j++) saida += letras[bytes[j] % letras.length];
    return saida;
  }

  /*
   * Vitrine: resumo leve da loja (sem cardapio completo, fotos ou dados de pagamento)
   * que o hub e a pagina das cidades leem. Na nuvem vive em vitrine/{slug} e e
   * gravado junto com a loja. Uns 5 a 20 KB em vez de 100+ KB por loja.
   */
  function resumoDaLoja(l) {
    var ativos = (l.produtos || []).filter(function (p) { return p.ativo !== false; });
    return {
      slug: l.slug, nome: l.nome || '', tipo: l.tipo || '', emoji: l.emoji || '', descricao: (l.descricao || '').slice(0, 120),
      cidade: l.cidade || '', cidadeSlug: l.cidadeSlug || '', uf: l.uf || '',
      logoDados: l.logoDados || '', logoUrl: l.logoUrl || '', capa: l.capa || '', capaUrl: l.capaUrl || '', cor: l.cor || '',
      aberta: l.aberta !== false, usarHorarios: !!l.usarHorarios, horarios: l.horarios || {},
      tempoEntrega: l.tempoEntrega || 40, tempoPreparo: l.tempoPreparo || 20,
      aceitaEntrega: l.aceitaEntrega !== false, aceitaRetirada: l.aceitaRetirada !== false,
      freteGratis: !!l.freteGratis, taxaEntrega: l.taxaEntrega || 0, entregaGratisAcima: l.entregaGratisAcima || 0,
      plano: l.plano || null, ativa: l.ativa !== false, verificada: l.verificada === true, criadoEm: l.criadoEm || '',
      categorias: (l.categorias || []).map(function (c) { return { id: c.id, nome: c.nome, ativa: c.ativa !== false }; }),
      produtos: ativos.slice(0, 40).map(function (p) { return { id: p.id, nome: p.nome, categoria: p.categoria, ativo: true }; }),
      atualizadoEm: agoraISO(),
    };
  }

  /* Tudo que uma loja tem, com os valores de fabrica. */
  function modeloDeLoja() {
    return {
      slug: '',
      nome: '',
      tipo: 'Lanchonete',
      emoji: '🍔',
      cidade: 'Juquiá',
      cidadeSlug: 'juquia',
      uf: 'SP',
      endereco: '',
      whatsapp: '',
      instagram: '',
      descricao: '',
      avisoTopo: '',
      aberta: true,
      usarHorarios: false,
      horarios: {
        seg: [['18:00', '23:00']], ter: [['18:00', '23:00']], qua: [['18:00', '23:00']],
        qui: [['18:00', '23:00']], sex: [['18:00', '23:30']], sab: [['18:00', '23:30']], dom: [['18:00', '23:00']],
      },
      tempoPreparo: 20,
      tempoEntrega: 40,
      taxaEntrega: 500,
      entregaGratisAcima: 0,
      freteGratis: false, /* true = entrega gratis em todo pedido, a taxa acima nao vale */
      pedidoMinimo: 0,
      aceitaEntrega: true,
      aceitaRetirada: true,
      aceitaPix: true,
      aceitaCartaoEntrega: true,
      aceitaDinheiroEntrega: true,
      aceitaPagarNoBalcao: true,
      permitePersonalizar: true,
      mostrarOutras: false, /* link 'ver outros estabelecimentos' no site da loja */
      pix: { chave: '', nome: '', cidade: '' },
      senhaPainel: '1234',
      logoDados: '',
      capa: '',
      cor: '',
      estilo: { cantos: 'arredondado', logo: 'quadrada', titulos: 'moderna', capa: 'normal' },
      mpAtivo: false, /* Pix automatico pelo Mercado Pago (token fica em segredo, fora deste documento) */
      fotosVersao: '',
      categorias: [],
      produtos: [],
      grupos: {},
      gruposPorCategoria: {},
      cupons: [],
      plano: { status: 'teste', desde: agoraISO() },
      configurada: true, /* lojas criadas em #/comecar nascem com false e ganham o cartao de primeiros passos */
      ativa: true,
      criadoEm: agoraISO(),
      atualizadoEm: agoraISO(),
    };
  }

  /* ============================================================
   * DemoStore
   * ========================================================== */

  function DemoStore() {
    this.tipo = 'demo';
    this.ouvintes = [];
    var eu = this;
    this.canal = ('BroadcastChannel' in window) ? new BroadcastChannel('ligeiro-demo') : null;
    if (this.canal) this.canal.onmessage = function () { eu._avisar(); };
    window.addEventListener('storage', function (e) { if (e.key === CHAVE) eu._avisar(); });
  }

  DemoStore.prototype._ler = function () {
    var texto = null;
    try {
      texto = localStorage.getItem(CHAVE);
      if (texto) {
        var db0 = JSON.parse(texto);
        /* loja de exemplo guardada antes de um campo novo existir (capa, cor...): completa com o que o seed tem, sem sobrescrever o que o dono mudou */
        if (db0 && db0.lojas) {
          /* endereco da cidade sempre derivado do nome (corrige registro salvo com "juquia-sp") */
          Object.keys(db0.lojas).forEach(function (k) { var lj = db0.lojas[k]; if (lj && lj.cidade && lj.cidadeSlug !== R.slug(lj.cidade)) lj.cidadeSlug = R.slug(lj.cidade); });
          /* emoji sem fonte no Windows 10 (mirtilo, U+1FAD0) vira uva, em categorias e itens ja guardados */
          /* Pix passou a ser so automatico: loja de exemplo guardada antes disso liga o modo simulado */
          Object.keys(db0.lojas).forEach(function (k) { var lj = db0.lojas[k]; if (lj && window.LigeiroSeed && window.LigeiroSeed().lojas[k] && !lj.pixAutomaticoMigrado) { lj.mpAtivo = true; lj.pixAutomaticoMigrado = true; } });
          var mirtilo = String.fromCodePoint(0x1FAD0), uva = String.fromCodePoint(0x1F347);
          Object.keys(db0.lojas).forEach(function (k) { var lj = db0.lojas[k]; if (!lj) return; (lj.categorias || []).concat(lj.produtos || []).forEach(function (x) { if (x && x.emoji === mirtilo) x.emoji = uva; }); });
        }
        if (window.LigeiroSeed && db0 && db0.lojas) {
          var seedLojas = window.LigeiroSeed().lojas || {};
          Object.keys(seedLojas).forEach(function (slug) {
            var atual = db0.lojas[slug];
            if (!atual) return;
            Object.keys(seedLojas[slug]).forEach(function (k) { if (!(k in atual)) atual[k] = clonar(seedLojas[slug][k]); });
          });
        }
        return db0;
      }
    } catch (_) {
      /* banco ilegivel: guarda uma copia antes de recomecar, pra nao perder nada de vez */
      try { if (texto) localStorage.setItem(CHAVE + '.corrompido', texto); } catch (_2) { /* ignora */ }
    }
    var db = window.LigeiroSeed ? clonar(window.LigeiroSeed()) : { lojas: {}, pedidos: {}, contadores: {} };
    this._gravar(db, true);
    return db;
  };

  /* Fotos dos produtos ficam separadas da loja: sao grandes e mudam pouco. */
  /* Uma foto so (a capa pro hub): na demonstracao vem do mesmo mapa. */
  DemoStore.prototype.obterFoto = function (lojaSlug, id) {
    var db = this._ler();
    var mapa = (db.fotos && db.fotos[lojaSlug]) || {};
    return Promise.resolve(mapa[id] || null);
  };

  DemoStore.prototype.listarFotos = function (lojaSlug) {
    var db = this._ler();
    return Promise.resolve(clonar((db.fotos && db.fotos[lojaSlug]) || {}));
  };

  DemoStore.prototype.salvarFoto = function (lojaSlug, id, dados) {
    var db = this._ler();
    db.fotos = db.fotos || {};
    db.fotos[lojaSlug] = db.fotos[lojaSlug] || {};
    db.fotos[lojaSlug][id] = dados;
    if (db.lojas[lojaSlug]) db.lojas[lojaSlug].fotosVersao = agoraISO();
    if (!this._gravar(db)) return Promise.reject(new Error('Sem espaço no aparelho pra guardar mais fotos. Apague alguma ou use uma foto menor.'));
    return Promise.resolve(id);
  };

  DemoStore.prototype.excluirFoto = function (lojaSlug, id) {
    var db = this._ler();
    if (db.fotos && db.fotos[lojaSlug]) delete db.fotos[lojaSlug][id];
    if (db.lojas[lojaSlug]) db.lojas[lojaSlug].fotosVersao = agoraISO();
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve();
  };

  /* Devolve false quando nao coube no localStorage: quem chamou avisa a pessoa em vez de fingir que salvou. */
  DemoStore.prototype._gravar = function (db, silencio) {
    var ok = true;
    try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (_) { ok = false; }
    if (silencio) return ok;
    this._avisar();
    if (this.canal) { try { this.canal.postMessage('mudou'); } catch (_) { /* ignora */ } }
    return ok;
  };

  DemoStore.prototype._avisar = function () {
    for (var i = 0; i < this.ouvintes.length; i++) {
      try { this.ouvintes[i](); } catch (_) { /* um ouvinte com erro nao derruba os outros */ }
    }
  };

  DemoStore.prototype.pronto = function () { return Promise.resolve(); };

  /* Chama f() sempre que qualquer coisa mudar. Devolve funcao para parar. */
  DemoStore.prototype.assistir = function (f) {
    var eu = this;
    this.ouvintes.push(f);
    return function () { eu.ouvintes = eu.ouvintes.filter(function (o) { return o !== f; }); };
  };

  DemoStore.prototype.assistirPedidos = function (lojaSlug, cb, opcoes) {
    var eu = this;
    var entregar = function () { eu.listarPedidos(lojaSlug, opcoes).then(cb); };
    entregar();
    return this.assistir(entregar);
  };

  DemoStore.prototype.assistirPedido = function (lojaSlug, id, cb) {
    var eu = this;
    var entregar = function () { eu.obterPedido(lojaSlug, id).then(cb); };
    entregar();
    return this.assistir(entregar);
  };

  DemoStore.prototype.assistirLoja = function (slug, cb) {
    var eu = this;
    var entregar = function () { eu.obterLoja(slug).then(cb); };
    entregar();
    return this.assistir(entregar);
  };

  DemoStore.prototype.listarCidades = function () {
    var db = this._ler();
    var mapa = {};
    Object.keys(db.lojas).forEach(function (slug) {
      var l = db.lojas[slug];
      if (l.ativa === false || R.lojaBloqueada(l)) return;
      var k = l.cidadeSlug;
      if (!mapa[k]) mapa[k] = { slug: k, nome: l.cidade, uf: l.uf || '', lojas: 0 };
      mapa[k].lojas += 1;
    });
    return Promise.resolve(Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome); }));
  };

  DemoStore.prototype.listarLojas = function (cidadeSlug) {
    var db = this._ler();
    var lista = Object.keys(db.lojas).map(function (s) { return db.lojas[s]; })
      .filter(function (l) { return l.ativa !== false && (!cidadeSlug || l.cidadeSlug === cidadeSlug); })
      .map(clonar)
      .sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    return Promise.resolve(lista);
  };

  /* Contatos da pagina de vendas: "deixa seu WhatsApp que a gente chama". */
  DemoStore.prototype.salvarLead = function (dados) {
    var db = this._ler();
    db.leads = db.leads || {};
    var id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    db.leads[id] = Object.assign({ id: id, criadoEm: agoraISO(), atendidoEm: '' }, clonar(dados));
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(db.leads[id]));
  };
  DemoStore.prototype.listarLeads = function () {
    var db = this._ler();
    var l = db.leads || {};
    return Promise.resolve(Object.keys(l).map(function (k) { return clonar(l[k]); }).sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; }));
  };
  DemoStore.prototype.atualizarLead = function (id, mudancas) {
    var db = this._ler();
    if (!db.leads || !db.leads[id]) return Promise.reject(new Error('Contato não encontrado.'));
    Object.assign(db.leads[id], clonar(mudancas));
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(db.leads[id]));
  };

  /* ---- contas (assinatura e da conta; lojas.plano e espelho) ---- */
  function espelhoDoPlano(plano) {
    var p = plano || {};
    return { status: p.status || 'teste', tipo: p.tipo || 'mensal', planoId: p.planoId || 'uma', planoPago: p.planoPago || '', fundador: p.fundador === true, desde: p.desde || agoraISO(), pagoAte: p.pagoAte || '', avisoPagamentoEm: p.avisoPagamentoEm || '', avisoValor: p.avisoValor || 0 };
  }
  DemoStore.prototype.obterConta = function (email) {
    var db = this._ler();
    var c = db.contas && db.contas[String(email || '').toLowerCase()];
    return Promise.resolve(c ? clonar(c) : null);
  };
  DemoStore.prototype.listarContas = function () {
    var db = this._ler();
    var c = db.contas || {};
    return Promise.resolve(Object.keys(c).map(function (k) { return clonar(c[k]); }).sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; }));
  };
  /* Cria se nao existe; mudancas.plano e mesclado; espelha o plano nas lojas do dono. */
  DemoStore.prototype.salvarConta = function (email, mudancas) {
    var db = this._ler();
    var e = String(email || '').toLowerCase();
    if (!e) return Promise.reject(new Error('Conta sem e-mail.'));
    db.contas = db.contas || {};
    var atual = db.contas[e] || { email: e, criadoEm: agoraISO(), plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: agoraISO() } };
    var m = clonar(mudancas || {});
    if (m.plano) { m.plano = Object.assign({}, atual.plano || {}, m.plano); }
    db.contas[e] = Object.assign({}, atual, m, { atualizadoEm: agoraISO() });
    Object.keys(db.lojas).forEach(function (k) { var l = db.lojas[k]; if (l && String(l.donoEmail || '').toLowerCase() === e) l.plano = espelhoDoPlano(db.contas[e].plano); });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(db.contas[e]));
  };
  DemoStore.prototype.espelharPlanoNasLojas = function (email) {
    var db = this._ler();
    var e = String(email || '').toLowerCase();
    var conta = db.contas && db.contas[e];
    if (!conta) return Promise.resolve(false);
    Object.keys(db.lojas).forEach(function (k) { var l = db.lojas[k]; if (l && String(l.donoEmail || '').toLowerCase() === e) l.plano = espelhoDoPlano(conta.plano); });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(true);
  };
  /* Quantas vezes um cupom ja foi usado (na demonstracao fica no proprio cupom). */
  DemoStore.prototype.usosDoCupom = function (lojaSlug, codigo) {
    var db = this._ler();
    var l = db.lojas[lojaSlug];
    var c = l && (l.cupons || []).filter(function (x) { return x.codigo === codigo; })[0];
    return Promise.resolve(c ? (Number(c.usos) || 0) : 0);
  };

  /* Vagas de fundador ja ocupadas (numero publico, de verdade). */
  DemoStore.prototype.obterFundadores = function () {
    var db = this._ler();
    return Promise.resolve({ usados: ((db.publico || {}).fundadores || {}).usados || 0 });
  };
  DemoStore.prototype.ocuparVagaFundador = function () {
    var db = this._ler();
    db.publico = db.publico || {};
    db.publico.fundadores = { usados: (((db.publico.fundadores || {}).usados) || 0) + 1, atualizadoEm: agoraISO() };
    this._gravar(db);
    return Promise.resolve(db.publico.fundadores);
  };

  /* Na demonstracao a vitrine sao as proprias lojas (tudo e local, nao custa nada). */
  DemoStore.prototype.listarVitrine = function () {
    var db = this._ler();
    return Promise.resolve(Object.keys(db.lojas).map(function (s) { return resumoDaLoja(db.lojas[s]); }));
  };

  DemoStore.prototype.listarTodasLojas = function () {
    var db = this._ler();
    return Promise.resolve(Object.keys(db.lojas).map(function (s) { return clonar(db.lojas[s]); })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome); }));
  };

  DemoStore.prototype.obterLoja = function (slug) {
    var l = this._ler().lojas[slug];
    return Promise.resolve(l ? clonar(l) : null);
  };

  DemoStore.prototype.salvarLoja = function (loja) {
    var db = this._ler();
    var atual = db.lojas[loja.slug] || modeloDeLoja();
    var nova = Object.assign({}, atual, clonar(loja), { atualizadoEm: agoraISO() });
    db.lojas[loja.slug] = nova;
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(nova));
  };

  DemoStore.prototype.criarLoja = function (dados) {
    var db = this._ler();
    var base = R.slug(dados.nome) || 'loja';
    var slug = base;
    var n = 2;
    while (db.lojas[slug]) slug = base + '-' + (n++);
    var loja = Object.assign(modeloDeLoja(), clonar(dados), {
      slug: slug,
      cidadeSlug: R.slug(dados.cidade || 'Juquiá'),
      criadoEm: agoraISO(),
      atualizadoEm: agoraISO(),
    });
    db.lojas[slug] = loja;
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(loja));
  };

  DemoStore.prototype.excluirLoja = function (slug) {
    var db = this._ler();
    delete db.lojas[slug];
    delete db.pedidos[slug];
    delete db.contadores[slug];
    if (db.fotos) delete db.fotos[slug];
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve();
  };

  DemoStore.prototype.criarPedido = function (lojaSlug, pedido) {
    var db = this._ler();
    if (!db.lojas[lojaSlug]) return Promise.reject(new Error('Loja não encontrada.'));
    var contador = R.proximaSenha(db.contadores[lojaSlug]);
    db.contadores[lojaSlug] = contador;
    var id = idAleatorio(20);
    var completo = Object.assign({}, clonar(pedido), { id: id, senha: contador.ultima });
    if (!db.pedidos[lojaSlug]) db.pedidos[lojaSlug] = {};
    db.pedidos[lojaSlug][id] = completo;
    if (completo.cupom) {
      var cupons = db.lojas[lojaSlug].cupons || [];
      for (var i = 0; i < cupons.length; i++) if (cupons[i].codigo === completo.cupom) cupons[i].usos = (cupons[i].usos || 0) + 1;
    }
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(completo));
  };

  DemoStore.prototype.obterPedido = function (lojaSlug, id) {
    var db = this._ler();
    var p = db.pedidos[lojaSlug] && db.pedidos[lojaSlug][id];
    return Promise.resolve(p ? clonar(p) : null);
  };

  DemoStore.prototype.listarPedidos = function (lojaSlug, opcoes) {
    var o = opcoes || {};
    var db = this._ler();
    var todos = db.pedidos[lojaSlug] || {};
    var lista = Object.keys(todos).map(function (k) { return todos[k]; });
    if (o.desde) lista = lista.filter(function (p) { return p.criadoEm >= o.desde; });
    lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
    if (o.limite) lista = lista.slice(0, o.limite);
    return Promise.resolve(lista.map(clonar));
  };

  DemoStore.prototype.atualizarPedido = function (lojaSlug, id, mudancas) {
    var db = this._ler();
    var p = db.pedidos[lojaSlug] && db.pedidos[lojaSlug][id];
    if (!p) return Promise.reject(new Error('Pedido não encontrado.'));
    Object.assign(p, clonar(mudancas), { atualizadoEm: agoraISO() });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(p));
  };

  DemoStore.prototype.entrarPainel = function (lojaSlug, senha) {
    var loja = this._ler().lojas[lojaSlug];
    return Promise.resolve(!!loja && String(loja.senhaPainel || '') === String(senha || ''));
  };

  DemoStore.prototype.criarConta = function () { return Promise.resolve(true); };
  DemoStore.prototype.obterIdToken = function () { return Promise.resolve('demo'); };

  /* Segredos da loja (token do Mercado Pago): na demonstracao ficam so neste aparelho. */
  DemoStore.prototype.lerSegredo = function (slug, nome) {
    try { return Promise.resolve(JSON.parse(localStorage.getItem('ligeiro:segredo:' + slug + ':' + nome) || 'null')); } catch (_) { return Promise.resolve(null); }
  };
  DemoStore.prototype.guardarSegredo = function (slug, nome, dados) {
    try { localStorage.setItem('ligeiro:segredo:' + slug + ':' + nome, JSON.stringify(dados)); } catch (_) { /* ignora */ }
    return Promise.resolve(true);
  };

  /* ---- conta do dono (demonstracao: fica so neste aparelho) ---- */
  var CHAVE_CONTA = 'ligeiro:conta';
  function contaDemo() { try { return JSON.parse(localStorage.getItem(CHAVE_CONTA) || 'null'); } catch (_) { return null; } }
  DemoStore.prototype.usuarioAtual = function () { return Promise.resolve(contaDemo()); };
  DemoStore.prototype.assistirUsuario = function (cb) { cb(contaDemo()); return function () {}; };
  DemoStore.prototype.entrarComGoogle = function () {
    var u = { email: 'voce@demo.ligeiro', nome: 'Você (demonstração)', foto: '', via: 'google' };
    try { localStorage.setItem(CHAVE_CONTA, JSON.stringify(u)); } catch (_) { /* ignora */ }
    return Promise.resolve(u);
  };
  DemoStore.prototype.entrarComEmail = function (email) {
    var e = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return Promise.reject(new Error('Digite um e-mail válido.'));
    var u = { email: e, nome: e.split('@')[0], foto: '', via: 'email' };
    try { localStorage.setItem(CHAVE_CONTA, JSON.stringify(u)); } catch (_) { /* ignora */ }
    return Promise.resolve(u);
  };
  DemoStore.prototype.recuperarSenha = function () { return Promise.resolve(true); };
  DemoStore.prototype.sair = function () { try { localStorage.removeItem(CHAVE_CONTA); } catch (_) { /* ignora */ } return Promise.resolve(true); };
  /* Na demonstracao, as lojas de exemplo (sem dono) sao suas tambem. */
  DemoStore.prototype.listarMinhasLojas = function (email) {
    var db = this._ler();
    var e = String(email || '').toLowerCase();
    return Promise.resolve(Object.keys(db.lojas).map(function (k) { return clonar(db.lojas[k]); })
      .filter(function (l) { return l.ativa !== false && (!l.donoEmail || String(l.donoEmail).toLowerCase() === e); })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }));
  };
  /* O painel abre sem senha quando quem esta logado e o dono (ou, na demonstracao, qualquer conta logada). */
  DemoStore.prototype.donoLogado = function (loja) {
    var u = contaDemo();
    return Promise.resolve(!!u && (!loja.donoEmail || String(loja.donoEmail).toLowerCase() === u.email));
  };

  DemoStore.prototype.entrarAdmin = function (senha) {
    return Promise.resolve(String(senha || '') === String(window.LIGEIRO_CONFIG.senhaAdmin || ''));
  };

  DemoStore.prototype.zerarDemo = function () {
    try { localStorage.removeItem(CHAVE); } catch (_) { /* ignora */ }
    this._gravar(this._ler());
    return Promise.resolve();
  };

  /* ============================================================
   * FirebaseStore (Firestore + Auth, SDK "compat" carregado na hora)
   * ========================================================== */

  function carregarScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Não carregou ' + src)); };
      document.head.appendChild(s);
    });
  }

  function FirebaseStore(config) {
    this.tipo = 'firebase';
    this.config = config;
    this._pronto = this._iniciar();
  }

  FirebaseStore.prototype._iniciar = function () {
    var eu = this;
    var base = 'https://www.gstatic.com/firebasejs/10.14.1/';
    return carregarScript(base + 'firebase-app-compat.js')
      .then(function () { return carregarScript(base + 'firebase-firestore-compat.js'); })
      .then(function () { return carregarScript(base + 'firebase-auth-compat.js'); })
      .then(function () {
        window.firebase.initializeApp(eu.config);
        eu.db = window.firebase.firestore();
        eu.auth = window.firebase.auth();
        return eu.db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* ok sem cache */ });
      });
  };

  FirebaseStore.prototype.pronto = function () { return this._pronto; };

  FirebaseStore.prototype.assistirLoja = function (slug, cb) {
    var parar = function () {};
    var cancelado = false;
    this._pronto.then(function () {
      if (cancelado) return;
      parar = this.db.collection('lojas').doc(slug).onSnapshot(function (d) { cb(d.exists ? daNuvem(d.data()) : null); });
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  FirebaseStore.prototype.assistirPedidos = function (lojaSlug, cb, opcoes) {
    var o = opcoes || {};
    var parar = function () {};
    var cancelado = false;
    this._pronto.then(function () {
      if (cancelado) return;
      var q = this.db.collection('lojas').doc(lojaSlug).collection('pedidos');
      if (o.desde) q = q.where('criadoEm', '>=', o.desde);
      q = q.orderBy('criadoEm', 'desc');
      if (o.limite) q = q.limit(o.limite);
      parar = q.onSnapshot(function (snap) {
        var lista = [];
        /* pedido torto (sem cliente ou sem itens) nao pode derrubar a fila inteira da loja */
        snap.forEach(function (d) { var x = d.data(); if (!x.cliente || typeof x.cliente !== 'object') x.cliente = {}; if (!Array.isArray(x.itens)) x.itens = []; lista.push(x); });
        cb(lista);
      }, function (e) {
        /* banco recusou (saiu da conta, senha da equipe trocada): a tela precisa saber, senao fica muda pra sempre */
        if (typeof o.aoErro === 'function') o.aoErro(e);
      });
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  FirebaseStore.prototype.assistirPedido = function (lojaSlug, id, cb) {
    var parar = function () {};
    var cancelado = false;
    this._pronto.then(function () {
      if (cancelado) return;
      parar = this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id)
        .onSnapshot(function (d) { cb(d.exists ? d.data() : null); });
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  FirebaseStore.prototype.listarTodasLojas = function () {
    return this._pronto.then(function () {
      return this.db.collection('lojas').get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { lista.push(daNuvem(d.data())); });
        return lista.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
      });
    }.bind(this));
  };

  /* ---- contas na nuvem: contas/{email}. Dono le e avisa pagamento; admin confirma e espelha nas lojas. ---- */
  FirebaseStore.prototype.obterConta = function (email) {
    var e = String(email || '').toLowerCase();
    if (!e) return Promise.resolve(null);
    return this._pronto.then(function () {
      return this.db.collection('contas').doc(e).get().then(function (d) { return d.exists ? d.data() : null; });
    }.bind(this)).catch(function () { return null; });
  };
  FirebaseStore.prototype.listarContas = function () {
    return this._pronto.then(function () {
      return this.db.collection('contas').orderBy('criadoEm', 'desc').limit(500).get().then(function (snap) {
        var lista = []; snap.forEach(function (d) { lista.push(d.data()); }); return lista;
      });
    }.bind(this));
  };
  FirebaseStore.prototype.salvarConta = function (email, mudancas) {
    var e = String(email || '').toLowerCase();
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('contas').doc(e);
      return ref.get().then(function (d) {
        var atual = d.exists ? d.data() : { email: e, criadoEm: agoraISO(), plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: agoraISO() } };
        var m = clonar(mudancas || {});
        if (m.plano) m.plano = Object.assign({}, atual.plano || {}, m.plano);
        var nova = Object.assign({}, atual, m, { atualizadoEm: agoraISO() });
        return ref.set(nova).then(function () {
          /* espelha nas lojas (encerrar/reativar precisa chegar no site da loja). Se a regra recusar, a conta ja ficou salva. */
          return eu.espelharPlanoNasLojas(e).catch(function (err) { if (window.console) console.warn('espelho do plano', err); });
        }).then(function () { return nova; });
      });
    });
  };
  /* Admin: copia o plano da conta pra todas as lojas dela (o dono nao pode, pelas regras). */
  FirebaseStore.prototype.espelharPlanoNasLojas = function (email) {
    var e = String(email || '').toLowerCase();
    var eu = this;
    return this.obterConta(e).then(function (conta) {
      if (!conta) return false;
      return eu.db.collection('lojas').where('donoEmail', '==', e).get().then(function (snap) {
        if (snap.empty) return true;
        /* dois lotes: a regra da vitrine confere o plano com o que JA esta gravado na loja */
        var lojas = eu.db.batch();
        var vitrine = eu.db.batch();
        snap.forEach(function (d) {
          lojas.update(d.ref, { plano: espelhoDoPlano(conta.plano), atualizadoEm: agoraISO() });
          vitrine.set(eu.db.collection('vitrine').doc(d.id), { plano: espelhoDoPlano(conta.plano), atualizadoEm: agoraISO() }, { merge: true });
        });
        return lojas.commit().then(function () { return vitrine.commit(); }).then(function () { limparCacheVitrine(); return true; });
      });
    });
  };

  /* Contatos: qualquer visitante cria (regra do Firestore), so o admin le e atualiza. */
  FirebaseStore.prototype.salvarLead = function (dados) {
    return this._pronto.then(function () {
      var ref = this.db.collection('leads').doc();
      var lead = Object.assign({ id: ref.id, criadoEm: agoraISO(), atendidoEm: '' }, clonar(dados));
      return ref.set(lead).then(function () { return lead; });
    }.bind(this));
  };
  FirebaseStore.prototype.listarLeads = function () {
    return this._pronto.then(function () {
      return this.db.collection('leads').orderBy('criadoEm', 'desc').limit(200).get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { lista.push(d.data()); });
        return lista;
      });
    }.bind(this));
  };
  FirebaseStore.prototype.atualizarLead = function (id, mudancas) {
    return this._pronto.then(function () {
      return this.db.collection('leads').doc(id).update(clonar(mudancas)).then(function () { return true; });
    }.bind(this));
  };

  function limparCacheVitrine() { try { localStorage.removeItem('ligeiro:vitrine'); } catch (_) { /* ignora */ } }
  /* Vitrine na nuvem: 1 leitura por loja, documentos pequenos, e cache de 5 minutos no aparelho. */
  FirebaseStore.prototype.listarVitrine = function () {
    var chave = 'ligeiro:vitrine';
    try {
      var c = JSON.parse(localStorage.getItem(chave) || 'null');
      if (c && c.em && Date.now() - c.em < 5 * 60 * 1000 && Array.isArray(c.lista)) return Promise.resolve(c.lista);
    } catch (_) { /* segue */ }
    return this._pronto.then(function () {
      return this.db.collection('vitrine').get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { lista.push(daNuvem(d.data())); });
        try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), lista: lista })); } catch (_) { /* sem espaco */ }
        return lista;
      });
    }.bind(this));
  };

  FirebaseStore.prototype.listarCidades = function () {
    return this.listarVitrine().then(function (lojas) {
      var mapa = {};
      lojas.forEach(function (l) {
        if (l.ativa === false || R.lojaBloqueada(l)) return;
        if (!mapa[l.cidadeSlug]) mapa[l.cidadeSlug] = { slug: l.cidadeSlug, nome: l.cidade, uf: l.uf || '', lojas: 0 };
        mapa[l.cidadeSlug].lojas += 1;
      });
      return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    });
  };

  FirebaseStore.prototype.listarLojas = function (cidadeSlug) {
    return this.listarVitrine().then(function (lojas) {
      return lojas.filter(function (l) { return l.ativa !== false && (!cidadeSlug || l.cidadeSlug === cidadeSlug); });
    });
  };

  FirebaseStore.prototype.obterLoja = function (slug) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(slug).get().then(function (d) { return d.exists ? daNuvem(d.data()) : null; });
    }.bind(this));
  };

  /* update() troca cada campo inteiro (um grupo apagado some de verdade); set+merge fundiria mapas e ressuscitaria o grupo. */
  FirebaseStore.prototype.salvarLoja = function (loja) {
    var nova = Object.assign({}, clonar(loja), { atualizadoEm: agoraISO() });
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('lojas').doc(loja.slug);
      return ref.update(paraNuvem(nova)).then(function () {
        /* vitrine acompanha: precisa da loja inteira pra montar o resumo */
        return ref.get().then(function (d) {
          if (!d.exists) return nova;
          return eu.db.collection('vitrine').doc(loja.slug).set(paraNuvem(resumoDaLoja(daNuvem(d.data())))).then(function () { limparCacheVitrine(); return nova; });
        }).catch(function () { return nova; });
      });
    });
  };
  /* Admin: reconstroi a vitrine a partir de todas as lojas (primeira vez, ou se algo desencontrar). */
  FirebaseStore.prototype.reconstruirVitrine = function () {
    var eu = this;
    return this.listarTodasLojas().then(function (lojas) {
      var lote = eu.db.batch();
      lojas.forEach(function (l) { lote.set(eu.db.collection('vitrine').doc(l.slug), paraNuvem(resumoDaLoja(l))); });
      return lote.commit().then(function () { try { localStorage.removeItem('ligeiro:vitrine'); } catch (_) { /* ignora */ } return lojas.length; });
    });
  };

  FirebaseStore.prototype.criarLoja = function (dados) {
    var eu = this;
    return this._pronto.then(function () {
      var base = R.slug(dados.nome) || 'loja';
      var col = eu.db.collection('lojas');
      var tentar = function (slug, n) {
        return col.doc(slug).get().then(function (d) {
          if (d.exists) return tentar(base + '-' + n, n + 1);
          var loja = Object.assign(modeloDeLoja(), clonar(dados), {
            slug: slug, cidadeSlug: R.slug(dados.cidade || 'Juquiá'), criadoEm: agoraISO(), atualizadoEm: agoraISO(),
          });
          /* primeiro a loja, depois a vitrine: a regra da vitrine le a loja pra saber quem e o dono */
          return col.doc(slug).set(paraNuvem(loja)).then(function () {
            return eu.db.collection('vitrine').doc(slug).set(paraNuvem(resumoDaLoja(loja)));
          }).then(function () { limparCacheVitrine(); return loja; });
        });
      };
      return tentar(base, 2);
    });
  };

  /*
   * Fotos: uma por documento em lojas/{slug}/fotos/{id}. O documento da loja
   * tem limite de 1 MB, por isso as fotos nao vao dentro dele. Como mudam
   * pouco, ficam guardadas no aparelho e so baixam de novo quando a
   * fotosVersao da loja muda (economiza as leituras gratis do Firestore).
   */
  /* Uma foto so (a capa pro hub): 1 leitura por loja, guardada neste aparelho pra nao ler de novo. */
  FirebaseStore.prototype.obterFoto = function (lojaSlug, id) {
    var chave = 'ligeiro:foto:' + lojaSlug + ':' + id;
    try { var c = localStorage.getItem(chave); if (c) return Promise.resolve(c); } catch (_) { /* ignora */ }
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('fotos').doc(id).get().then(function (d) {
        var dados = d.exists ? (d.data().dados || null) : null;
        if (dados) { try { localStorage.setItem(chave, dados); } catch (_) { /* sem espaco: segue sem guardar */ } }
        return dados;
      });
    }.bind(this)).catch(function () { return null; });
  };

  FirebaseStore.prototype.listarFotos = function (lojaSlug, versao) {
    var chaveCache = 'ligeiro:fotos:' + lojaSlug;
    var cache = null;
    try { cache = JSON.parse(localStorage.getItem(chaveCache) || 'null'); } catch (_) { cache = null; }
    if (cache && versao && cache.versao === versao) return Promise.resolve(cache.mapa);
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('fotos').get().then(function (snap) {
        var mapa = {};
        snap.forEach(function (d) { mapa[d.id] = d.data().dados; });
        var pacote = JSON.stringify({ versao: versao || '', mapa: mapa });
        try { localStorage.setItem(chaveCache, pacote); } catch (_) {
          /* nao coube: solta o cache das outras lojas e tenta uma vez */
          try {
            Object.keys(localStorage).forEach(function (k) { if (k.indexOf('ligeiro:fotos:') === 0 && k !== chaveCache) localStorage.removeItem(k); });
            localStorage.setItem(chaveCache, pacote);
          } catch (_2) { /* segue sem cache */ }
        }
        return mapa;
      });
    }.bind(this));
  };

  FirebaseStore.prototype.salvarFoto = function (lojaSlug, id, dados) {
    return this._pronto.then(function () {
      var lojaRef = this.db.collection('lojas').doc(lojaSlug);
      var lote = this.db.batch();
      lote.set(lojaRef.collection('fotos').doc(id), { dados: dados, criadoEm: agoraISO() });
      lote.set(lojaRef, { fotosVersao: agoraISO() }, { merge: true });
      return lote.commit().then(function () { return id; });
    }.bind(this));
  };

  FirebaseStore.prototype.excluirFoto = function (lojaSlug, id) {
    return this._pronto.then(function () {
      var lojaRef = this.db.collection('lojas').doc(lojaSlug);
      var lote = this.db.batch();
      lote.delete(lojaRef.collection('fotos').doc(id));
      lote.set(lojaRef, { fotosVersao: agoraISO() }, { merge: true });
      return lote.commit();
    }.bind(this));
  };

  FirebaseStore.prototype.excluirLoja = function (slug) {
    return this._pronto.then(function () {
      var lote = this.db.batch();
      lote.set(this.db.collection('lojas').doc(slug), { ativa: false }, { merge: true });
      lote.set(this.db.collection('vitrine').doc(slug), { ativa: false }, { merge: true });
      return lote.commit();
    }.bind(this));
  };

  FirebaseStore.prototype.criarPedido = function (lojaSlug, pedido) {
    var eu = this;
    return this._pronto.then(function () {
      var lojaRef = eu.db.collection('lojas').doc(lojaSlug);
      var contadorRef = lojaRef.collection('contadores').doc('senha');
      var id = idAleatorio(20);
      var codigo = pedido.cupom ? String(pedido.cupom).toUpperCase() : '';
      var cupomRef = codigo ? lojaRef.collection('contadores').doc('cupom-' + codigo) : null;
      return eu.db.runTransaction(function (tx) {
        /* Firestore exige todas as leituras antes de qualquer escrita */
        return tx.get(contadorRef).then(function (d) {
          var contador = R.proximaSenha(d.exists ? d.data() : null);
          var lerCupom = cupomRef
            ? tx.get(lojaRef).then(function (dl) { return tx.get(cupomRef).then(function (dc) { return { loja: dl.exists ? dl.data() : null, usos: dc.exists ? (dc.data().usos || 0) : 0 }; }); })
            : Promise.resolve(null);
          return lerCupom.then(function (c) {
            if (c) {
              var regra = ((c.loja && c.loja.cupons) || []).filter(function (x) { return x.codigo === codigo; })[0];
              if (regra && regra.limite > 0 && c.usos >= regra.limite) throw R.ErroDoCliente('Esse código já foi usado o máximo de vezes.');
              tx.set(cupomRef, { usos: c.usos + 1, atualizadoEm: agoraISO() });
            }
            tx.set(contadorRef, contador);
            var completo = Object.assign({}, clonar(pedido), { id: id, senha: contador.ultima });
            tx.set(lojaRef.collection('pedidos').doc(id), completo);
            return completo;
          });
        });
      });
    });
  };

  /* Vagas de fundador ja ocupadas: documento publico publico/fundadores (so o admin escreve). Cache de 10 min. */
  FirebaseStore.prototype.obterFundadores = function () {
    var chave = 'ligeiro:fundadores';
    try { var c = JSON.parse(localStorage.getItem(chave) || 'null'); if (c && Date.now() - c.em < 10 * 60 * 1000) return Promise.resolve({ usados: c.usados || 0 }); } catch (_) { /* segue */ }
    return this._pronto.then(function () {
      return this.db.collection('publico').doc('fundadores').get().then(function (d) {
        var usados = d.exists ? (Number(d.data().usados) || 0) : 0;
        try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), usados: usados })); } catch (_) { /* ignora */ }
        return { usados: usados };
      });
    }.bind(this)).catch(function () { return { usados: 0 }; });
  };
  FirebaseStore.prototype.ocuparVagaFundador = function () {
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('publico').doc('fundadores');
      return eu.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (d) {
          var usados = (d.exists ? (Number(d.data().usados) || 0) : 0) + 1;
          tx.set(ref, { usados: usados, atualizadoEm: agoraISO() });
          return { usados: usados };
        });
      }).then(function (r) { try { localStorage.removeItem('ligeiro:fundadores'); } catch (_) { /* ignora */ } return r; });
    });
  };

  /* Usos do cupom na nuvem: contador publico em lojas/{slug}/contadores/cupom-CODIGO. */
  FirebaseStore.prototype.usosDoCupom = function (lojaSlug, codigo) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('contadores').doc('cupom-' + String(codigo || '').toUpperCase()).get()
        .then(function (d) { return d.exists ? (Number(d.data().usos) || 0) : 0; });
    }.bind(this)).catch(function () { return 0; });
  };

  FirebaseStore.prototype.obterPedido = function (lojaSlug, id) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id).get()
        .then(function (d) { return d.exists ? d.data() : null; });
    }.bind(this));
  };

  FirebaseStore.prototype.listarPedidos = function (lojaSlug, opcoes) {
    var o = opcoes || {};
    return this._pronto.then(function () {
      var q = this.db.collection('lojas').doc(lojaSlug).collection('pedidos');
      if (o.desde) q = q.where('criadoEm', '>=', o.desde);
      q = q.orderBy('criadoEm', 'desc');
      if (o.limite) q = q.limit(o.limite);
      return q.get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { lista.push(d.data()); });
        return lista;
      });
    }.bind(this));
  };

  FirebaseStore.prototype.atualizarPedido = function (lojaSlug, id, mudancas) {
    return this._pronto.then(function () {
      var ref = this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id);
      /* devolve o que mudou (quem esta na tela ja escuta o pedido pelo onSnapshot): economiza uma leitura por clique */
      var novo = Object.assign({}, clonar(mudancas), { atualizadoEm: agoraISO() });
      return ref.update(novo).then(function () { return Object.assign({ id: id }, novo); });
    }.bind(this));
  };

  /* No modo de verdade, o painel entra com e-mail do dono + senha (Firebase Auth). */
  /* E-mail do usuario de equipe da loja (criado pelo mensageiro quando o dono define a senha da equipe). */
  function emailEquipe(slug) { return 'equipe-' + slug + '@equipe.ligeiro.app.br'; }
  FirebaseStore.prototype.entrarPainel = function (lojaSlug, senha) {
    var eu = this;
    var pin = String(senha || '').trim();
    return this.obterLoja(lojaSlug).then(function (loja) {
      if (!loja) return false;
      /* 1) senha da equipe; 2) dono com e-mail e senha (quem criou a conta sem Google) */
      return eu.auth.signInWithEmailAndPassword(emailEquipe(lojaSlug), 'LIG-' + pin).then(function () { return true; }).catch(function () {
        if (!loja.donoEmail) return false;
        return eu.auth.signInWithEmailAndPassword(loja.donoEmail, pin).then(function () { return true; }).catch(function () { return false; });
      });
    });
  };
  /* Token de identidade do usuario logado (pro mensageiro conferir quem esta pedindo). */
  FirebaseStore.prototype.obterIdToken = function () {
    return this._pronto.then(function () {
      var u = this.auth.currentUser;
      if (!u) throw new Error('Entre na sua conta primeiro.');
      return u.getIdToken();
    }.bind(this));
  };

  /* Segredos da loja: documento privado lojas/<slug>/privado/<nome>, que as regras so deixam o dono ler. */
  FirebaseStore.prototype.lerSegredo = function (slug, nome) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(slug).collection('privado').doc(nome).get()
        .then(function (d) { return d.exists ? d.data() : null; })
        .catch(function () { return null; });
    }.bind(this));
  };
  FirebaseStore.prototype.guardarSegredo = function (slug, nome, dados) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(slug).collection('privado').doc(nome).set(clonar(dados)).then(function () { return true; });
    }.bind(this));
  };

  /* Dono cria o proprio login em #/comecar. Se o e-mail ja existe, tenta entrar com a senha dada. */
  FirebaseStore.prototype.criarConta = function (email, senha) {
    return this._pronto.then(function () {
      var auth = this.auth;
      return auth.createUserWithEmailAndPassword(email, senha).then(function () { return true; }).catch(function (e) {
        if (e && e.code === 'auth/email-already-in-use') {
          return auth.signInWithEmailAndPassword(email, senha).then(function () { return true; })
            .catch(function () { throw new Error('Esse e-mail já tem cadastro com outra senha. Entre com a senha certa ou use outro e-mail.'); });
        }
        if (e && e.code === 'auth/weak-password') throw new Error('Senha muito curta: use pelo menos 6 letras ou números.');
        if (e && e.code === 'auth/invalid-email') throw new Error('Esse e-mail não parece válido.');
        throw new Error('Não deu pra criar o acesso agora. Tente de novo em instantes.');
      });
    }.bind(this));
  };

  /* ---- conta do dono (Firebase Authentication: Google ou e-mail e senha) ---- */
  function usuarioDoFirebase(u) {
    if (!u || !u.email) return null;
    return { email: String(u.email).toLowerCase(), nome: u.displayName || '', foto: u.photoURL || '', via: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || '' };
  }
  FirebaseStore.prototype.usuarioAtual = function () {
    return this._pronto.then(function () {
      var auth = this.auth;
      /* espera o Firebase lembrar a sessao (primeira chamada depois de abrir a pagina) */
      return new Promise(function (resolve) {
        var parar = auth.onAuthStateChanged(function (u) { parar(); resolve(usuarioDoFirebase(u)); });
      });
    }.bind(this)).catch(function () { return null; });
  };
  FirebaseStore.prototype.assistirUsuario = function (cb) {
    var parar = function () {};
    this._pronto.then(function () { parar = this.auth.onAuthStateChanged(function (u) { cb(usuarioDoFirebase(u)); }); }.bind(this));
    return function () { parar(); };
  };
  function erroDeLogin(e) {
    var c = (e && e.code) || '';
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return new Error('Login cancelado.');
    if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return new Error('E-mail ou senha errados.');
    if (c === 'auth/invalid-email') return new Error('Esse e-mail não parece válido.');
    if (c === 'auth/too-many-requests') return new Error('Muitas tentativas. Espere um minuto e tente de novo.');
    if (c === 'auth/network-request-failed') return new Error('Sem internet agora. Tente de novo.');
    return new Error('Não deu pra entrar agora. Tente de novo em instantes.');
  }
  /* Navegador de dentro de outro app (Instagram, Facebook, TikTok...): o Google nao deixa entrar por ali. */
  function navegadorDeApp() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(ua);
  }
  /* Login com Google SEMPRE por janela (popup), aberta direto no toque.
     Nunca por redirecionamento: no iPhone o Safari isola o armazenamento entre o site e o firebaseapp.com e o
     redirecionamento termina numa tela branca ("Unable to save initial state"). */
  FirebaseStore.prototype.entrarComGoogle = function () {
    var eu = this;
    if (navegadorDeApp()) return Promise.reject(new Error('Você abriu o Ligeiro por dentro de outro app, e o Google não deixa entrar por aqui. Toque nos três pontinhos e escolha "Abrir no navegador" (Safari ou Chrome).'));
    function abrirJanela() {
      var provedor = new window.firebase.auth.GoogleAuthProvider();
      provedor.setCustomParameters({ prompt: 'select_account' });
      return eu.auth.signInWithPopup(provedor).then(function (r) { return usuarioDoFirebase(r.user); }).catch(function (e) {
        var c = (e && e.code) || '';
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') throw new Error('O navegador bloqueou a janela do Google. Toque em "Entrar com o Google" de novo. Se continuar, libere pop-ups pra este site ou abra no Safari ou Chrome.');
        throw erroDeLogin(e);
      });
    }
    /* banco ja carregado (o normal): abre a janela na hora, ainda dentro do toque, senao o navegador bloqueia */
    if (eu.auth && window.firebase && window.firebase.auth) return abrirJanela();
    /* ainda carregando: espera e pede outro toque (abrir janela fora do toque seria bloqueado) */
    return eu._pronto.then(function () { throw new Error('Quase lá. Toque em "Entrar com o Google" de novo.'); });
  };
  FirebaseStore.prototype.entrarComEmail = function (email, senha) {
    return this._pronto.then(function () {
      return this.auth.signInWithEmailAndPassword(String(email || '').trim().toLowerCase(), String(senha || ''))
        .then(function (r) { return usuarioDoFirebase(r.user); }).catch(function (e) { throw erroDeLogin(e); });
    }.bind(this));
  };
  FirebaseStore.prototype.recuperarSenha = function (email) {
    return this._pronto.then(function () {
      return this.auth.sendPasswordResetEmail(String(email || '').trim().toLowerCase()).then(function () { return true; }).catch(function (e) { throw erroDeLogin(e); });
    }.bind(this));
  };
  FirebaseStore.prototype.listarMinhasLojas = function (email) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').where('donoEmail', '==', String(email || '').toLowerCase()).get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { lista.push(daNuvem(d.data())); });
        return lista.filter(function (l) { return l.ativa !== false; }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
      });
    }.bind(this));
  };
  FirebaseStore.prototype.donoLogado = function (loja) {
    return this.usuarioAtual().then(function (u) {
      if (!u) return false;
      var admin = String((window.LIGEIRO_CONFIG || {}).adminEmail || '').toLowerCase();
      return u.email === String(loja.donoEmail || '').toLowerCase() || (!!admin && u.email === admin);
    });
  };

  /* Sair de verdade: derruba a sessao do Firebase (tablet compartilhado nao fica logado). */
  FirebaseStore.prototype.sair = function () {
    var eu = this;
    return this._pronto.then(function () { return eu.auth.signOut(); }).catch(function () { return true; });
  };

  FirebaseStore.prototype.entrarAdmin = function (senha) {
    var email = window.LIGEIRO_CONFIG.adminEmail;
    if (!email) return Promise.resolve(false);
    return this._pronto.then(function () {
      return this.auth.signInWithEmailAndPassword(email, String(senha || ''))
        .then(function () { return true; })
        .catch(function () { return false; });
    }.bind(this));
  };

  FirebaseStore.prototype.zerarDemo = function () { return Promise.resolve(); };

  /* ============================================================
   * Escolha da implementacao
   * ========================================================== */

  var config = window.LIGEIRO_CONFIG || {};
  var store = config.firebase ? new FirebaseStore(config.firebase) : new DemoStore();

  /* Qual imagem mostrar: foto enviada pelo painel, ou um link, ou nada. */
  function fotoSrc(objeto, fotos) {
    if (!objeto) return null;
    if (objeto.foto && fotos && fotos[objeto.foto]) return fotos[objeto.foto];
    if (objeto.fotoUrl) return objeto.fotoUrl;
    return null;
  }
  function logoSrc(loja) {
    if (!loja) return null;
    return loja.logoDados || loja.logoUrl || null;
  }

  window.LigeiroDados = {
    store: store,
    fotoSrc: fotoSrc,
    logoSrc: logoSrc,
    modeloDeLoja: modeloDeLoja,
    idAleatorio: idAleatorio,
    clonar: clonar,
    modoDemo: store.tipo === 'demo',
  };
})();
