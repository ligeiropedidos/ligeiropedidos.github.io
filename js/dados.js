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
  var SEM_ESPACO = 'O aparelho está sem espaço para guardar. Apague fotos antigas ou zere a demonstração.';

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
  /* Loja ou resumo vindo do banco (ou da borda): os tipos que as telas usam, sempre. Um dono que grave um horario ou um
     nome torto por fora nao derruba a pagina das cidades de todo mundo. O slug e o do documento (id), nunca o escrito
     dentro: uma loja nao se passa por outra */
  function daNuvem(dados, id) {
    if (!dados || typeof dados !== 'object') return dados;
    if (id) dados.slug = id;
    var h = dados.horarios;
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      Object.keys(h).forEach(function (dia) {
        h[dia] = (Array.isArray(h[dia]) ? h[dia] : []).map(function (f) { return typeof f === 'string' ? f.split('-') : f; })
          .filter(function (f) { return Array.isArray(f) && f.length === 2 && typeof f[0] === 'string' && typeof f[1] === 'string'; });
      });
    } else if ('horarios' in dados) dados.horarios = {};
    ['nome', 'descricao', 'cidade', 'cidadeSlug', 'tipo', 'emoji', 'uf', 'avisoTopo'].forEach(function (k) {
      if (k in dados && dados[k] != null && typeof dados[k] !== 'string') dados[k] = String(dados[k]);
    });
    if (dados.cidadeSlug && !/^[a-z0-9-]{1,60}$/.test(dados.cidadeSlug)) dados.cidadeSlug = '';
    /* imagem so do proprio site ou em dados (nada de endereco de fora para rastrear quem abre a loja) */
    ['logoUrl', 'capaUrl', 'logoDados'].forEach(function (k) { if (dados[k] && !imagemSegura(dados[k])) dados[k] = ''; });
    if (Array.isArray(dados.produtos)) dados.produtos.forEach(function (p) { if (p && p.fotoUrl && !imagemSegura(p.fotoUrl)) p.fotoUrl = ''; });
    return dados;
  }
  function imagemSegura(url) { var t = String(url || ''); return /^data:image\/(jpeg|png|webp|gif);/i.test(t) || /^img\/[A-Za-z0-9_\/.-]+$/.test(t); }
  /* o que pode ir para <img src> e url(): imagem segura ou foto servida pelo proprio mensageiro */
  function srcSeguro(v) {
    if (!v || typeof v !== 'string') return null;
    if (imagemSegura(v)) return v;
    var borda = enderecoBorda();
    return borda && v.indexOf(borda + '/foto/') === 0 ? v : null;
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
  /* resumo com a logo pequena (160 px, ~8 KB em vez de ~30 KB): e o que o hub e a pagina da cidade baixam por loja */
  var miniLogos = {};
  function resumoLeve(l) {
    var r = resumoDaLoja(l);
    var logo = r.logoDados;
    if (!logo || !/^data:image\//.test(logo) || logo.length < 12000) return Promise.resolve(r);
    if (miniLogos[logo]) { r.logoDados = miniLogos[logo]; return Promise.resolve(r); }
    return miniatura(logo, 160, 0.78).then(function (mini) {
      if (mini && mini.length < logo.length) { miniLogos[logo] = mini; r.logoDados = mini; }
      return r;
    }).catch(function () { return r; });
  }
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

  /*
   * Vendas de um periodo sem ler todos os pedidos: cada dia que ja fechou vira um resumo guardado
   * (lojas/{slug}/resumos/{AAAA-MM-DD}). O relatorio de 30 dias le 30 documentos pequenos
   * e so os pedidos do que ainda esta aberto (hoje; e ontem ate as 6 h, que pizzaria fecha tarde).
   * O dia e o dia de trabalho, das 5 h as 5 h, igual ao da fila e da cozinha: o pedido das 00:20 conta no dia que comecou
   * na vespera (antes, "Hoje" zerava a meia-noite, no meio do fechamento do caixa).
   * fontes: { lerDias(dias), listarPedidos(desde), gravarDia(dia, resumo) }
   */
  var VIRADA_DO_DIA = 5 * 36e5;
  function diaDeTrabalho(ms) { return R.diaLocal(new Date(ms - VIRADA_DO_DIA)); }
  function diaFechado(k, agora) {
    var p = k.split('-');
    return agora >= new Date(+p[0], +p[1] - 1, +p[2] + 1, 6, 0, 0, 0).getTime();
  }
  function vendasDoPeriodo(fontes, dias, agora) {
    agora = agora || Date.now();
    var chaves = [];
    for (var i = dias - 1; i >= 0; i--) { var d = new Date(agora - VIRADA_DO_DIA); d.setDate(d.getDate() - i); chaves.push(R.diaLocal(d)); }
    var fechados = chaves.filter(function (k) { return diaFechado(k, agora); });
    var lerDias = fechados.length ? fontes.lerDias(fechados).catch(function () { return {}; }) : Promise.resolve({});
    return lerDias.then(function (docs) {
      var guardados = {};
      fechados.forEach(function (k) { if (docs && docs[k]) guardados[k] = docs[k]; });
      var faltam = fechados.filter(function (k) { return !guardados[k]; });
      var abertos = chaves.filter(function (k) { return !diaFechado(k, agora); });
      var lerDe = faltam.concat(abertos);
      var juntar = function () { var escolhidos = {}; chaves.forEach(function (k) { if (guardados[k]) escolhidos[k] = guardados[k]; }); return R.juntarResumos(escolhidos); };
      if (!lerDe.length) return juntar();
      var p0 = lerDe[0].split('-');
      var desde = new Date(+p0[0], +p0[1] - 1, +p0[2], 5, 0, 0, 0).toISOString();
      return fontes.listarPedidos(desde).then(function (pedidos) {
        var porDia = {};
        lerDe.forEach(function (k) { porDia[k] = []; });
        (pedidos || []).forEach(function (x) { var t = new Date(x.criadoEm).getTime(); var k = diaDeTrabalho(t); if (porDia[k] && t <= agora) porDia[k].push(x); });
        var novos = {};
        faltam.forEach(function (k) { novos[k] = guardados[k] = R.resumoDoDia(porDia[k]); });
        abertos.forEach(function (k) { guardados[k] = R.resumoDoDia(porDia[k]); });
        /* guarda os dias fechados que faltavam (dia sem venda tambem: zero guardado nao le de novo). Sem permissao ainda: segue sem guardar */
        Object.keys(novos).forEach(function (k) { try { fontes.gravarDia(k, novos[k]).catch(function () { /* regra antiga: sem guardar */ }); } catch (_) { /* idem */ } });
        return juntar();
      });
    });
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
      googleUrl: '',
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
    if (!this._gravar(db)) return Promise.reject(new Error('Sem espaço no aparelho para guardar mais fotos. Apague alguma ou use uma foto menor.'));
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
  DemoStore.prototype.aquecer = function () {};

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

  /* na demonstracao ler e de graca: primeira = obterLoja, e o assistir e o assistirLoja de sempre */
  DemoStore.prototype.lojaAoVivo = function (slug) {
    var eu = this, paradas = [];
    return {
      primeira: eu.obterLoja(slug),
      assistir: function (cb) { var p = eu.assistirLoja(slug, cb); paradas.push(p); return p; },
      parar: function () { paradas.forEach(function (p) { try { p(); } catch (_) { /* ignora */ } }); paradas = []; },
    };
  };

  /* o site do cliente le a loja e as fotos por aqui; na demonstracao e tudo local, igual ao de sempre */
  DemoStore.prototype.lojaPublica = function (slug) { var v = this.lojaAoVivo(slug); v.conferirAgora = function () { return Promise.resolve(null); }; return v; };
  DemoStore.prototype.fotosPublicas = function (slug, versao, loja) { return this.listarFotos(slug, versao, loja); };
  DemoStore.prototype.fotoPublica = function (slug, id) { return this.obterFoto(slug, id); };
  DemoStore.prototype.publicarLoja = function () { return Promise.resolve(false); };
  DemoStore.prototype.avisarPausa = function () {};
  DemoStore.prototype.vendasDoPeriodo = function (slug, dias, agora) {
    var eu = this;
    return vendasDoPeriodo({
      lerDias: function (dias) {
        var r = ((eu._ler().resumos || {})[slug]) || {};
        var saida = {};
        dias.forEach(function (k) { if (r[k]) saida[k] = clonar(r[k]); });
        return Promise.resolve(saida);
      },
      listarPedidos: function (desde) { return eu.listarPedidos(slug, { desde: desde }); },
      gravarDia: function (dia, resumo) {
        var db = eu._ler();
        db.resumos = db.resumos || {};
        (db.resumos[slug] = db.resumos[slug] || {})[dia] = resumo;
        eu._gravar(db, true);
        return Promise.resolve();
      },
    }, dias, agora);
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
  DemoStore.prototype.listarListaEspera = function () {
    var l = this._ler().leads || {};
    return Promise.resolve(Object.keys(l).map(function (k) { return clonar(l[k]); }).filter(function (c) { return c.origem === 'lista-espera'; })
      .sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; }));
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
  /* LGPD (admin): tudo o que existe de uma pessoa pelo telefone e o apagar a pedido (ajudantes titular* mais abaixo) */
  DemoStore.prototype.dadosDoTitular = function (telefone) {
    var db = this._ler(), achados = titularVazio(telefone);
    var nomeDe = function (slug) { return ((db.lojas || {})[slug] || {}).nome || slug; };
    Object.keys(db.pedidos || {}).forEach(function (slug) {
      Object.keys(db.pedidos[slug] || {}).forEach(function (id) { achados.lidos++; titularAcharPedido(achados, slug, nomeDe(slug), db.pedidos[slug][id]); });
    });
    Object.keys(db.resumos || {}).forEach(function (slug) {
      Object.keys(db.resumos[slug] || {}).forEach(function (dia) { achados.lidos++; titularAcharResumo(achados, slug, nomeDe(slug), dia, db.resumos[slug][dia]); });
    });
    Object.keys(db.leads || {}).forEach(function (id) { achados.lidos++; titularAcharLead(achados, db.leads[id]); });
    return Promise.resolve(achados);
  };
  DemoStore.prototype.anonimizarTitular = function (achados) {
    var db = this._ler(), agora = agoraISO();
    achados.pedidos.forEach(function (x) {
      var p = db.pedidos[x.loja] && db.pedidos[x.loja][x.id];
      if (p) { Object.assign(p, titularAnonimo(agora)); delete p.aviso; }
    });
    achados.resumos.forEach(function (x) {
      var r = db.resumos && db.resumos[x.loja] && db.resumos[x.loja][x.dia];
      if (r) r.clientes = clonar(x.restantes);
    });
    achados.leads.forEach(function (l) { if (db.leads) delete db.leads[l.id]; });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve({ pedidos: achados.pedidos.length, resumos: achados.resumos.length, leads: achados.leads.length });
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
  /* Cupom novo com codigo de um cupom excluido: na demonstracao os usos ficam no proprio cupom, nada a zerar. */
  DemoStore.prototype.zerarUsosDoCupom = function () { return Promise.resolve(true); };

  /* Vagas de fundador ja ocupadas (numero publico, de verdade). */
  DemoStore.prototype.obterFundadores = function () { /* opcoes { semCache } nao importam aqui: tudo e local */
    var db = this._ler();
    var f = (db.publico || {}).fundadores || {};
    return Promise.resolve({ usados: f.usados || 0, capacidade: f.capacidade || null });
  };
  /* limite de lojas e vagas abertas/fechadas (so o admin muda) */
  DemoStore.prototype.salvarCapacidade = function (mudancas) {
    var db = this._ler();
    db.publico = db.publico || {};
    var f = db.publico.fundadores = db.publico.fundadores || {};
    f.capacidade = Object.assign({}, f.capacidade || {}, clonar(mudancas), { atualizadoEm: agoraISO() });
    this._gravar(db);
    return Promise.resolve(clonar(f.capacidade));
  };
  DemoStore.prototype.ocuparVagaFundador = function () {
    var db = this._ler();
    db.publico = db.publico || {};
    db.publico.fundadores = Object.assign({}, db.publico.fundadores || {}, { usados: (((db.publico.fundadores || {}).usados) || 0) + 1, atualizadoEm: agoraISO() });
    this._gravar(db);
    return Promise.resolve(db.publico.fundadores);
  };

  DemoStore.prototype.liberarVagaFundador = function () {
    var db = this._ler();
    db.publico = db.publico || {};
    db.publico.fundadores = Object.assign({}, db.publico.fundadores || {}, { usados: Math.max(0, (((db.publico.fundadores || {}).usados) || 0) - 1), atualizadoEm: agoraISO() });
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
      cidadeSlug: R.slugDaCidade(dados.cidade || 'Juquiá', dados.uf || 'SP'),
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
    if (o.status) lista = lista.filter(function (p) { return o.status.indexOf(p.status) >= 0 && (!o.tipoEntrega || p.tipoEntrega === o.tipoEntrega); });
    else if (o.devolver) lista = lista.filter(function (p) { return p.status === 'cancelado' && p.pagamentoStatus === 'pago'; });
    else if (o.desde) lista = lista.filter(function (p) { return p.criadoEm >= o.desde; });
    lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
    if (o.limite) lista = lista.slice(0, o.limite);
    return Promise.resolve(lista.map(clonar));
  };

  DemoStore.prototype.pedidoDoCache = function (lojaSlug, id) { return this.obterPedido(lojaSlug, id).catch(function () { return null; }); };
  DemoStore.prototype.pedidosDoDia = function (lojaSlug, desde) { return this.listarPedidos(lojaSlug, { desde: desde }); };

  DemoStore.prototype.atualizarPedido = function (lojaSlug, id, mudancas) {
    var db = this._ler();
    var p = db.pedidos[lojaSlug] && db.pedidos[lojaSlug][id];
    if (!p) return Promise.reject(new Error('Pedido não encontrado.'));
    Object.assign(p, clonar(mudancas), { atualizadoEm: agoraISO() });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(clonar(p));
  };

  /* Pix vencido sai da fila so se o pedido ainda espera o pagamento e nao tem pagoEm. Devolve true se cancelou. */
  DemoStore.prototype.cancelarPixVencido = function (lojaSlug, id) {
    var db = this._ler();
    var p = db.pedidos[lojaSlug] && db.pedidos[lojaSlug][id];
    if (!p || p.status !== R.STATUS.AGUARDANDO || p.pagoEm) return Promise.resolve(false);
    Object.assign(p, { status: R.STATUS.CANCELADO, canceladoPor: 'pix-vencido', atualizadoEm: agoraISO() });
    if (!this._gravar(db)) return Promise.reject(new Error(SEM_ESPACO));
    return Promise.resolve(true);
  };

  DemoStore.prototype.entrarPainel = function (lojaSlug, senha) {
    var loja = this._ler().lojas[lojaSlug];
    return Promise.resolve(!!loja && String(loja.senhaPainel || '') === String(senha || ''));
  };

  DemoStore.prototype.obterIdToken = function () { return Promise.resolve('demo'); };
  DemoStore.prototype.marcarDono = function () { return Promise.resolve(false); };
  DemoStore.prototype.lojaDaEquipe = function (slug) { return this.obterLoja(slug); };

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
  DemoStore.prototype.pareceLogado = function () { return !!contaDemo(); };
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

  /* o que ja baixou nao baixa de novo; o que falhou sai da pagina para a proxima tentativa baixar outra vez */
  var scriptsCarregados = {};
  function carregarScript(src) {
    if (scriptsCarregados[src]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { scriptsCarregados[src] = true; resolve(); };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        var e = new Error('Sem internet agora. Confira a conexão e toque de novo.');
        e.publico = true;
        reject(e);
      };
      document.head.appendChild(s);
    });
  }

  /*
   * Cardapio na borda: o site do cliente le a loja, as fotos e a vitrine do mensageiro no Cloudflare (KV gratis),
   * e nao do Firestore. O banco gratis fica so para os pedidos. Se o mensageiro ainda nao tem essas rotas
   * (ou esta fora do ar), tudo volta sozinho para o Firestore, como era antes.
   */
  var CHAVE_BORDA_FORA = 'ligeiro:borda-fora';
  function enderecoBorda() {
    var c = window.LIGEIRO_CONFIG || {};
    if (!c.firebase || !c.proxyMercadoPago) return '';
    try { if (sessionStorage.getItem(CHAVE_BORDA_FORA) === '1') return ''; } catch (_) { /* segue */ }
    return String(c.proxyMercadoPago).replace(/\/$/, '');
  }
  function erroBorda() { var e = new Error('borda indisponível'); e.fora = true; return e; }
  /* GET na borda: resolve { status, dados }. Rota que nao existe (mensageiro antigo) ou sem KV: esta visita inteira vai pro Firestore */
  function pegarBorda(caminho, fresco) {
    var base = enderecoBorda();
    if (!base || typeof fetch !== 'function') return Promise.reject(erroBorda());
    return fetch(base + caminho, fresco ? { cache: 'no-store' } : {}).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j && j.borda === 1) return { status: r.status, dados: j };
        /* respondeu, mas nao e a borda (mensageiro antigo responde "ok" a tudo, ou sem o KV): esta visita vai pro Firestore */
        try { sessionStorage.setItem(CHAVE_BORDA_FORA, '1'); } catch (_) { /* segue */ }
        throw erroBorda();
      });
    }, function () { throw erroBorda(); });
  }
  /* as fotos chegam como o banco guarda (o mensageiro nao abre megas de foto): monta o mapa id -> imagem aqui */
  function mapaDaBorda(j) {
    var mapa = {};
    (j.docs || []).forEach(function (bruto) {
      var docs = bruto && bruto.documents ? bruto.documents : (bruto && bruto.name ? [bruto] : []);
      docs.forEach(function (d) {
        var id = String(d.name || '').split('/').pop();
        var f = d.fields || {};
        if (ehPacote(id)) {
          if (!j.pacote) return; /* pacote velho de quando a loja usava miniaturas */
          var m = (f.fotos && f.fotos.mapValue && f.fotos.mapValue.fields) || {};
          Object.keys(m).forEach(function (k) { if (m[k] && m[k].stringValue) mapa[k] = m[k].stringValue; });
        } else if (f.dados && f.dados.stringValue) mapa[id] = f.dados.stringValue;
      });
    });
    return mapa;
  }
  /* foto por endereco: so entrega depois de carregar (se falhar, quem chamou fica com o que ja mostrava) */
  function precarregar(src) {
    return new Promise(function (ok, erro) {
      var img = new Image();
      img.onload = function () { ok(src); };
      img.onerror = function () { erro(new Error('foto')); };
      img.src = src;
    });
  }
  function guardarFotosNoAparelho(chave, valor) {
    var texto = JSON.stringify(valor);
    try { localStorage.setItem(chave, texto); } catch (_) {
      try {
        Object.keys(localStorage).forEach(function (k) { if ((k.indexOf('ligeiro:fotos:') === 0 && k !== chave) || k.indexOf('ligeiro:foto:') === 0) localStorage.removeItem(k); });
        localStorage.setItem(chave, texto);
      } catch (_2) { /* segue sem cache */ }
    }
  }

  function FirebaseStore(config) {
    this.tipo = 'firebase';
    this.config = config;
    this._pacotes = {}; /* loja -> fotos em pacotes de miniaturas? (definido quando a loja carrega as fotos) */
    this._incompleto = {}; /* loja -> pacote sem alguma foto (app antigo gravou so a foto): o painel refaz */
    /* o programa do banco (uns 300 KB) so baixa quando alguem precisa dele: o cardapio vem da borda, entao quem so olha
       a loja nem baixa; comeca a vir quando a pessoa poe o primeiro item no carrinho (aquecer) ou abre o painel */
    var eu = this, carregando = null;
    /* falhou (a internet piscou na hora): a proxima chamada tenta de novo. Antes a falha ficava guardada e nenhum
       pedido saia ate a pessoa recarregar a pagina, coisa que o cliente nao sabe fazer */
    Object.defineProperty(this, '_pronto', { get: function () {
      if (!carregando) { carregando = eu._iniciar(); carregando.catch(function () { carregando = null; }); }
      return carregando;
    } });
  }
  FirebaseStore.prototype.aquecer = function () { this._pronto.catch(function () { /* quem precisar de verdade ve o erro */ }); };

  FirebaseStore.prototype._iniciar = function () {
    var eu = this;
    var base = 'https://www.gstatic.com/firebasejs/10.14.1/';
    /* banco e login so dependem do app: baixam juntos (um vai e volta a menos na internet do celular) */
    /* App Check (reCAPTCHA v3): so o site de verdade fala com o banco; robo e script de fora ficam de fora.
       Liga quando config.appCheck tiver a chave do site; vazio, fica como sempre foi */
    var appCheck = String((window.LIGEIRO_CONFIG || {}).appCheck || '').trim();
    return carregarScript(base + 'firebase-app-compat.js')
      .then(function () {
        var partes = [carregarScript(base + 'firebase-firestore-compat.js'), carregarScript(base + 'firebase-auth-compat.js')];
        if (appCheck) partes.push(carregarScript(base + 'firebase-app-check-compat.js'));
        return Promise.all(partes);
      })
      .then(function () {
        if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.initializeApp(eu.config);
        if (appCheck && window.firebase.appCheck) { try { window.firebase.appCheck().activate(appCheck, true); } catch (_) { /* segue sem: o banco decide */ } }
        eu.db = window.firebase.firestore();
        eu.auth = window.firebase.auth();
        eu.auth.onAuthStateChanged(function (u) { lembrarSessao(!!usuarioDoFirebase(u)); });
        /* cache do banco no aparelho (IndexedDB) so nas telas de quem trabalha na loja. No celular do cliente, o pedido
           acompanhado (nome, telefone, endereco) ficava guardado ali, e o "Apagar meus dados" nao alcancava: la o cache
           antigo e apagado ao abrir (antes de qualquer leitura, como o Firebase exige) e nada novo e guardado */
        var rota = String(location.hash || '').replace(/^#\/?/, '').split('/')[0];
        if (['painel', 'cozinha', 'entrega', 'balcao', 'admin', 'conta'].indexOf(rota) < 0) {
          return eu.db.clearPersistence().catch(function () { /* outra aba aberta usando o cache: fica para a proxima */ });
        }
        return eu.db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* ok sem cache */ });
      });
  };

  /* Marca, neste aparelho, se tem alguem logado. Serve so pra desenhar a barra do topo certa na hora
     ("Minha conta" em vez de "Entrar" piscando); quem manda de verdade e o Firebase, que confirma logo depois. */
  var CHAVE_SESSAO = 'ligeiro:sessao';
  function lembrarSessao(tem) {
    try { if (tem) localStorage.setItem(CHAVE_SESSAO, '1'); else localStorage.removeItem(CHAVE_SESSAO); } catch (_) { /* ignora */ }
  }
  FirebaseStore.prototype.pareceLogado = function () {
    try { return localStorage.getItem(CHAVE_SESSAO) === '1'; } catch (_) { return false; }
  };

  FirebaseStore.prototype.pronto = function () { return this._pronto; };

  /* Loja ao vivo com UMA leitura: a primeira foto abre a tela (no lugar do get) e as seguintes chegam por aqui.
     Antes era get + onSnapshot = a loja inteira (com a logo) baixada 2 vezes a cada visita. */
  FirebaseStore.prototype.lojaAoVivo = function (slug) {
    var eu = this, ouvintes = [], ultimo, ultimoJson, tem = false, parar = function () {}, cancelado = false, resolver, rejeitar;
    var daMemoria = null, prazoPassou = false, prazo = null;
    var primeira = new Promise(function (ok, erro) { resolver = ok; rejeitar = erro; });
    function abrir(valor) { if (tem) return; tem = true; clearTimeout(prazo); ultimo = valor; ultimoJson = JSON.stringify(valor); resolver(valor); }
    function falhar(e) { if (tem) return; tem = true; clearTimeout(prazo); rejeitar(e); }
    this._pronto.then(function () {
      if (cancelado) return;
      /* A primeira foto pode vir da MEMORIA do aparelho, com dado velho (loja desativada ontem, preco antigo), e a tela
         ficava presa nela. A tela so abre com a resposta do servidor, como era no get; a memoria so vale sem internet
         (4 s sem resposta). includeMetadataChanges: sem ele, quando o servidor confirma um dado igual ao da memoria,
         a escuta nao avisa nada e a tela nunca abriria. */
      prazo = setTimeout(function () {
        prazoPassou = true;
        if (daMemoria) { if (daMemoria.valor) abrir(daMemoria.valor); else falhar(new Error('sem internet')); }
      }, 4000);
      parar = eu.db.collection('lojas').doc(slug).onSnapshot({ includeMetadataChanges: true }, function (d) {
        var valor = d.exists ? daNuvem(d.data(), d.id) : null;
        if (!tem) {
          if (!d.metadata.fromCache) { abrir(valor); return; }
          if (!prazoPassou) { daMemoria = { valor: valor }; return; }
          /* sem internet e sem essa loja na memoria: e erro de conexao, nao "loja nao existe" */
          if (valor) abrir(valor); else falhar(new Error('sem internet'));
          return;
        }
        /* aberta: so avisa quem assiste quando o dado muda de verdade (nao a cada troca de metadados) */
        var json = JSON.stringify(valor);
        if (json === ultimoJson) return;
        ultimo = valor; ultimoJson = json;
        ouvintes.slice().forEach(function (f) { try { f(ultimo); } catch (_) { /* um ouvinte com erro nao derruba os outros */ } });
      }, falhar);
    }).catch(falhar);
    return {
      primeira: primeira,
      /* como o assistirLoja: entrega o estado atual na hora e depois cada mudanca */
      assistir: function (cb) {
        ouvintes.push(cb);
        if (tem) setTimeout(function () { if (ouvintes.indexOf(cb) >= 0) cb(ultimo); }, 0);
        return function () { ouvintes = ouvintes.filter(function (f) { return f !== cb; }); };
      },
      parar: function () { cancelado = true; ouvintes = []; clearTimeout(prazo); parar(); },
    };
  };

  /*
   * A loja para o site do cliente: vem da borda (0 leitura no Firestore) e confere de novo a cada minuto com a tela
   * aberta (e na volta para a aba). Sem borda, e a loja ao vivo do Firestore, como antes.
   * conferirAgora: a loja de agora, antes de mandar o pedido (fechou? mudou preco?).
   */
  FirebaseStore.prototype.lojaPublica = function (slug) {
    var eu = this, ouvintes = [], ultimoJson = '', parado = false, relogio = null, viva = null, conferidaEm = 0;
    function buscar(fresco) {
      return pegarBorda('/loja/' + encodeURIComponent(slug), fresco).then(function (x) {
        if (x.status === 404) return null;
        if (x.status !== 200 || !x.dados.loja) throw erroBorda();
        var l = daNuvem(x.dados.loja, slug);
        /* o banco gratis chegou no limite de hoje: a loja manda o pedido pelo WhatsApp ate zerar (de madrugada) */
        if (x.dados.pausa === true) l._pausaSite = true;
        return l;
      });
    }
    function avisar(l) {
      var j = JSON.stringify(l);
      if (!l || j === ultimoJson) return;
      ultimoJson = j;
      ouvintes.slice().forEach(function (f) { try { f(l); } catch (_) { /* um ouvinte com erro nao derruba os outros */ } });
    }
    function conferir() {
      if (parado || viva || document.hidden) return;
      /* celular que troca de app toda hora dispara a volta varias vezes: no maximo uma conferida a cada 15 s */
      if (Date.now() - conferidaEm < 15000) return;
      conferidaEm = Date.now();
      buscar(true).then(function (l) { if (!parado) avisar(l); }).catch(function () { /* sem internet agora: tenta no proximo minuto */ });
    }
    function aoVoltar() { if (!document.hidden) conferir(); }
    var primeira = buscar(false).then(function (l) {
      ultimoJson = JSON.stringify(l);
      if (l && !parado) { relogio = setInterval(conferir, 60000); document.addEventListener('visibilitychange', aoVoltar); }
      return l;
    }, function () {
      if (parado) return null;
      viva = eu.lojaAoVivo(slug);
      return viva.primeira;
    });
    return {
      primeira: primeira,
      assistir: function (cb) {
        if (viva) return viva.assistir(cb);
        ouvintes.push(cb);
        return function () { ouvintes = ouvintes.filter(function (f) { return f !== cb; }); };
      },
      conferirAgora: function () {
        if (viva) return Promise.resolve(null); /* ao vivo pelo Firestore: a escuta ja traz tudo */
        return buscar(true).then(function (l) { avisar(l); return l; });
      },
      parar: function () {
        parado = true; ouvintes = []; clearInterval(relogio);
        document.removeEventListener('visibilitychange', aoVoltar);
        if (viva) viva.parar();
      },
    };
  };

  /* Fotos para o site do cliente: um pacote da borda por versao, guardado no aparelho. Sem borda, do Firestore. */
  FirebaseStore.prototype.fotosPublicas = function (lojaSlug, versao, loja) {
    var eu = this;
    var chaveCache = 'ligeiro:fotos:' + lojaSlug;
    var cache = null;
    try { cache = JSON.parse(localStorage.getItem(chaveCache) || 'null'); } catch (_) { cache = null; }
    if (cache && versao && cache.versao === versao && cache.borda) { eu._pacotes[lojaSlug] = !!cache.pacote; return Promise.resolve(cache.mapa); }
    return pegarBorda('/fotos/' + encodeURIComponent(lojaSlug) + '?v=' + encodeURIComponent(versao || '')).then(function (x) {
      if (x.status !== 200) throw erroBorda();
      var mapa = mapaDaBorda(x.dados);
      var pacote = x.dados.pacote === true;
      /* pacote sem a foto de algum item (app antigo gravou so a foto): esta visita le do Firestore, que sabe se virar */
      var produtos = (loja && loja.produtos) || [];
      if (pacote && produtos.some(function (p) { return p && p.foto && !ehCapa(p.foto) && !mapa[p.foto]; })) throw erroBorda();
      eu._pacotes[lojaSlug] = pacote;
      if (x.dados.versao === versao) guardarFotosNoAparelho(chaveCache, { versao: versao || '', pacote: pacote, borda: true, mapa: mapa });
      return mapa;
    }).catch(function () { return eu.listarFotos(lojaSlug, versao, loja); });
  };

  /* Uma foto grande (capa no hub, item aberto): pela borda, guardada no celular pelo proprio navegador. Falhou: Firestore. */
  FirebaseStore.prototype.fotoPublica = function (lojaSlug, id) {
    var eu = this;
    var base = enderecoBorda();
    if (!base || !id) return this.obterFoto(lojaSlug, id);
    return precarregar(base + '/foto/' + encodeURIComponent(lojaSlug) + '/' + encodeURIComponent(id)).catch(function () { return eu.obterFoto(lojaSlug, id); });
  };

  /* O painel salvou: avisa a borda para a loja do cliente mudar na hora (e nao so quando a copia vencer).
     Espera 3 s sem salvar nada para avisar uma vez so (subir 10 fotos seguidas e um aviso). */
  FirebaseStore.prototype.publicarLoja = function (slug) {
    var eu = this;
    var base = enderecoBorda();
    if (!base || !slug) return Promise.resolve(false);
    eu._aPublicar = eu._aPublicar || {};
    clearTimeout(eu._aPublicar[slug]);
    return new Promise(function (ok) {
      eu._aPublicar[slug] = setTimeout(function () {
        delete eu._aPublicar[slug];
        eu.obterIdToken().then(function (t) {
          return fetch(base + '/publicar', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ loja: slug }) });
        }).then(function (r) { ok(!!r && r.ok); }, function () { ok(false); });
      }, 3000);
    });
  };

  /* O banco recusou por limite do dia: conta para a borda, que confere e avisa as lojas (os proximos clientes ja pedem pelo WhatsApp) */
  FirebaseStore.prototype.avisarPausa = function () {
    var base = enderecoBorda();
    if (!base || this._pausaAvisada) return;
    this._pausaAvisada = true;
    fetch(base + '/pausa', { method: 'POST' }).catch(function () { /* segue: o cliente ja foi para o WhatsApp */ });
  };

  /* Vendas do periodo: resumos guardados por dia (lojas/{slug}/resumos/{AAAA-MM-DD}) + os pedidos do que ainda esta aberto.
     Os dias vem numa consulta so (do primeiro ao ultimo dia): dia que nao existe nao custa leitura */
  FirebaseStore.prototype.vendasDoPeriodo = function (slug, dias, agora) {
    var eu = this;
    return this._pronto.then(function () {
      var col = eu.db.collection('lojas').doc(slug).collection('resumos');
      var id = window.firebase.firestore.FieldPath.documentId();
      return vendasDoPeriodo({
        lerDias: function (lista) {
          return col.where(id, '>=', lista[0]).where(id, '<=', lista[lista.length - 1]).get().then(function (snap) {
            var saida = {};
            snap.forEach(function (d) { saida[d.id] = d.data(); });
            return saida;
          });
        },
        listarPedidos: function (desde) { return eu.listarPedidos(slug, { desde: desde }); },
        gravarDia: function (dia, resumo) { return col.doc(dia).set(Object.assign({}, resumo, { atualizadoEm: agoraISO() })); },
      }, dias, agora);
    });
  };

  FirebaseStore.prototype.assistirLoja = function (slug, cb) {
    var parar = function () {};
    var cancelado = false;
    this._pronto.then(function () {
      if (cancelado) return;
      parar = this.db.collection('lojas').doc(slug).onSnapshot(function (d) { cb(d.exists ? daNuvem(d.data(), d.id) : null); });
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  /* Pedido que chega do banco passa por aqui antes de qualquer tela: cliente sempre objeto, itens sempre lista de itens
     com texto e numero no lugar certo, adicionais e removidos sempre listas. Um pedido torto (gravado por fora) nunca
     derruba a fila do painel, da cozinha ou do entregador. O id e o do documento (nunca o que veio escrito dentro) */
  function texto(v, max) { return v == null ? '' : String(v).slice(0, max || 300); }
  function sanearPedido(doc) {
    var x = doc && typeof doc.data === 'function' ? (doc.data() || {}) : (doc || {});
    if (doc && doc.id) x.id = doc.id;
    if (!x.cliente || typeof x.cliente !== 'object' || Array.isArray(x.cliente)) x.cliente = {};
    x.cliente.nome = texto(x.cliente.nome, 80);
    x.cliente.telefone = texto(x.cliente.telefone, 20);
    if (x.endereco && (typeof x.endereco !== 'object' || Array.isArray(x.endereco))) x.endereco = {};
    if (x.endereco) Object.keys(x.endereco).forEach(function (k) { x.endereco[k] = texto(x.endereco[k], 140); });
    x.itens = (Array.isArray(x.itens) ? x.itens : []).filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
      var y = Object.assign({}, it);
      y.nome = texto(it.nome, 120);
      y.quantidade = Math.max(0, Math.floor(Number(it.quantidade) || 0));
      y.adicionais = (Array.isArray(it.adicionais) ? it.adicionais : []).filter(function (a) { return a && typeof a === 'object'; });
      y.removidos = (Array.isArray(it.removidos) ? it.removidos : []).map(function (r) { return texto(r, 60); });
      if (y.tamanho && typeof y.tamanho !== 'object') y.tamanho = null;
      y.observacao = texto(it.observacao, 300);
      return y;
    });
    x.observacao = texto(x.observacao, 300);
    ['total', 'subtotal', 'taxaEntrega', 'desconto', 'trocoPara', 'acrescimoCartao'].forEach(function (k) { if (k in x) x[k] = Math.round(Number(x[k]) || 0); });
    return x;
  }

  FirebaseStore.prototype.assistirPedidos = function (lojaSlug, cb, opcoes) {
    var o = opcoes || {};
    var parar = function () {};
    var cancelado = false;
    var db = null;
    function ouvir(comTipo) {
      var q = db.collection('lojas').doc(lojaSlug).collection('pedidos');
      /* filtro por situacao (cozinha, entregador): so o que esta em andamento, sem ordenar no banco (dispensa indice composto) */
      /* sempre com limite: as regras do banco exigem (a equipe nunca puxa o historico inteiro de clientes) */
      if (o.status) {
        /* entregador: o tipo de entrega tambem no banco. Pedido de retirada nem chega (antes ele pagava a leitura de
           todos e separava no aparelho: ~40% das leituras dele eram de retirada) */
        if (comTipo) q = q.where('tipoEntrega', '==', o.tipoEntrega);
        q = q.where('status', 'in', o.status).limit(300);
      } else if (o.devolver) {
        /* cancelado com o dinheiro pago pelo site: poucos, e a tela separa os ja devolvidos */
        q = q.where('status', '==', 'cancelado').where('pagamentoStatus', '==', 'pago').limit(50);
      } else {
        if (o.desde) q = q.where('criadoEm', '>=', o.desde);
        q = q.orderBy('criadoEm', 'desc').limit(Math.min(o.limite || 300, 300));
      }
      parar = q.onSnapshot(function (snap) {
        var lista = [];
        /* pedido torto (sem cliente ou sem itens) nao pode derrubar a fila inteira da loja */
        snap.forEach(function (d) { try { lista.push(sanearPedido(d)); } catch (_) { /* pedido ilegivel: fica de fora, a fila segue */ } });
        if (o.status || o.devolver) {
          if (o.tipoEntrega) lista = lista.filter(function (p) { return p.tipoEntrega === o.tipoEntrega; });
          lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
        }
        cb(lista, !!(snap.metadata && snap.metadata.fromCache));
      }, function (e) {
        /* o banco pediu um indice para os dois filtros: volta para o filtro de sempre (so a situacao), sem a tela parar */
        if (comTipo && e && e.code === 'failed-precondition' && !cancelado) { ouvir(false); return; }
        if (o.devolver) return; /* a lista do "Falta devolver" e extra: sem ela o painel segue */
        /* banco recusou (saiu da conta, senha da equipe trocada): a tela precisa saber, senao fica muda pra sempre */
        if (typeof o.aoErro === 'function') o.aoErro(e);
      });
    }
    this._pronto.then(function () {
      if (cancelado) return;
      db = this.db;
      ouvir(!!(o.status && o.tipoEntrega));
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  FirebaseStore.prototype.assistirPedido = function (lojaSlug, id, cb) {
    var parar = function () {};
    var cancelado = false;
    this._pronto.then(function () {
      if (cancelado) return;
      parar = this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id)
        .onSnapshot(function (d) { var x = null; try { x = d.exists ? sanearPedido(d) : null; } catch (_) { x = null; } cb(x); });
    }.bind(this));
    return function () { cancelado = true; parar(); };
  };

  FirebaseStore.prototype.listarTodasLojas = function () {
    return this._pronto.then(function () {
      return this.db.collection('lojas').get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { try { lista.push(daNuvem(d.data(), d.id)); } catch (_) { /* loja ilegivel: fica de fora */ } });
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
        return lojas.commit().then(function () { return vitrine.commit(); }).then(function () {
          limparCacheVitrine();
          /* plano mudou (pagou, encerrou): a loja do cliente destrava ou trava na hora */
          snap.forEach(function (d) { eu.publicarLoja(d.id); });
          return true;
        });
      });
    });
  };

  /* Contatos: qualquer visitante cria (regra do Firestore), so o admin le e atualiza. */
  /* o contato nasce no mensageiro (/lead), que conta as tentativas por aparelho. Mensageiro antigo, sem a rota (404):
     grava direto, como antes (ate as regras novas entrarem) */
  FirebaseStore.prototype.salvarLead = function (dados) {
    var eu = this;
    var base = enderecoBorda();
    var direto = function () {
      return eu._pronto.then(function () {
        var ref = eu.db.collection('leads').doc();
        var lead = Object.assign({ id: ref.id, criadoEm: agoraISO(), atendidoEm: '' }, clonar(dados));
        return ref.set(lead).then(function () { return lead; });
      });
    };
    if (!base || !window.fetch) return direto();
    return fetch(base + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clonar(dados)) })
      .then(function (r) {
        if (r.status === 404) return direto();
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j || !j.ok) { var e = new Error((j && j.erro) || 'Não deu para enviar. Tente de novo.'); e.publico = true; throw e; }
          return Object.assign({ id: j.id }, clonar(dados));
        });
      });
  };
  /* so a lista de espera, sem limite de 200 (uma condicao de igualdade: nao precisa de indice) */
  FirebaseStore.prototype.listarListaEspera = function () {
    return this._pronto.then(function () {
      return this.db.collection('leads').where('origem', '==', 'lista-espera').get().then(function (snap) {
        var l = []; snap.forEach(function (d) { l.push(d.data()); });
        return l.sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; });
      });
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
  /* LGPD (so o admin): le os pedidos e os resumos de cada loja, uma loja por vez, e os contatos do "Fale com a gente".
     Custa uma leitura por pedido guardado: so roda quando alguem pede os proprios dados (prazo da lei: 15 dias) */
  FirebaseStore.prototype.dadosDoTitular = function (telefone, aoAndar) {
    var eu = this, achados = titularVazio(telefone);
    return this.listarTodasLojas().then(function (lojas) {
      var fila = Promise.resolve();
      lojas.forEach(function (loja, i) {
        fila = fila.then(function () {
          if (aoAndar) aoAndar(i + 1, lojas.length, loja.nome);
          var ref = eu.db.collection('lojas').doc(loja.slug);
          return Promise.all([ref.collection('pedidos').get(), ref.collection('resumos').get()]).then(function (r) {
            r[0].forEach(function (d) { achados.lidos++; try { titularAcharPedido(achados, loja.slug, loja.nome, sanearPedido(d)); } catch (_) { /* ilegivel */ } });
            r[1].forEach(function (d) { achados.lidos++; titularAcharResumo(achados, loja.slug, loja.nome, d.id, d.data() || {}); });
          });
        });
      });
      return fila;
    }).then(function () {
      return eu.db.collection('leads').get().then(function (snap) {
        snap.forEach(function (d) { achados.lidos++; titularAcharLead(achados, Object.assign({ id: d.id }, d.data())); });
        return achados;
      });
    });
  };
  /* Apaga nome, telefone, endereco, observacao e o aviso no celular dos pedidos (os valores das vendas ficam), tira a
     pessoa da lista de clientes dos resumos e apaga os contatos. Lotes de 400 (o limite do Firestore e 500) */
  FirebaseStore.prototype.anonimizarTitular = function (achados) {
    var eu = this, agora = agoraISO(), ops = [];
    return this._pronto.then(function () {
      var FV = window.firebase.firestore.FieldValue;
      achados.pedidos.forEach(function (x) {
        ops.push(function (lote) { lote.update(eu.db.collection('lojas').doc(x.loja).collection('pedidos').doc(x.id), Object.assign(titularAnonimo(agora), { aviso: FV.delete() })); });
      });
      achados.resumos.forEach(function (x) {
        ops.push(function (lote) { lote.update(eu.db.collection('lojas').doc(x.loja).collection('resumos').doc(x.dia), { clientes: clonar(x.restantes) }); });
      });
      achados.leads.forEach(function (l) { ops.push(function (lote) { lote.delete(eu.db.collection('leads').doc(l.id)); }); });
      var fila = Promise.resolve();
      for (var i = 0; i < ops.length; i += 400) {
        (function (fatia) { fila = fila.then(function () { var lote = eu.db.batch(); fatia.forEach(function (f) { f(lote); }); return lote.commit(); }); })(ops.slice(i, i + 400));
      }
      return fila.then(function () { return { pedidos: achados.pedidos.length, resumos: achados.resumos.length, leads: achados.leads.length }; });
    });
  };

  /* ---------- LGPD: achar uma pessoa pelo telefone ---------- */
  function soDigitosTel(t) {
    var d = String(t || '').replace(/\D/g, '');
    return d.indexOf('55') === 0 && d.length > 11 ? d.slice(2) : d;
  }
  /* mesmo DDD e os mesmos 8 ultimos numeros: acha com ou sem o 9 da frente e com ou sem o +55 */
  function mesmoTelefone(a, b) {
    a = soDigitosTel(a); b = soDigitosTel(b);
    if (a.length < 10 || b.length < 10) return false;
    return a.slice(0, 2) === b.slice(0, 2) && a.slice(-8) === b.slice(-8);
  }
  function titularVazio(telefone) {
    return { telefone: soDigitosTel(telefone), consultadoEm: agoraISO(), lidos: 0, pedidos: [], resumos: [], leads: [] };
  }
  function titularAcharPedido(achados, slug, lojaNome, p) {
    if (!p || !mesmoTelefone(p.cliente && p.cliente.telefone, achados.telefone)) return;
    achados.pedidos.push({ loja: slug, lojaNome: lojaNome, id: p.id, senha: p.senha, criadoEm: p.criadoEm || '', status: p.status || '',
      tipoEntrega: p.tipoEntrega || '', cliente: clonar(p.cliente || {}), endereco: clonar(p.endereco || {}), observacao: p.observacao || '',
      itens: clonar(p.itens || []), total: p.total || 0, formaPagamento: p.formaPagamento || '', avisoNoCelular: !!p.aviso });
  }
  function titularAcharResumo(achados, slug, lojaNome, dia, r) {
    var cs = Array.isArray(r && r.clientes) ? r.clientes : [];
    var dela = cs.filter(function (c) { return mesmoTelefone(c && c.t, achados.telefone); });
    if (!dela.length) return;
    achados.resumos.push({ loja: slug, lojaNome: lojaNome, dia: dia, registros: clonar(dela),
      restantes: clonar(cs.filter(function (c) { return !mesmoTelefone(c && c.t, achados.telefone); })) });
  }
  function titularAcharLead(achados, l) {
    if (l && mesmoTelefone(l.whatsapp, achados.telefone)) achados.leads.push(clonar(l));
  }
  function titularAnonimo(agora) {
    return { cliente: { nome: 'Apagado a pedido (LGPD)', telefone: '' }, endereco: {}, observacao: '', anonimizadoEm: agora };
  }

  /* 'ligeiro:vitrine2': a chave antiga podia ter lojas com o slug trocado pela posicao na lista */
  var CHAVE_VITRINE = 'ligeiro:vitrine2';
  function limparCacheVitrine() { try { localStorage.removeItem(CHAVE_VITRINE); localStorage.removeItem('ligeiro:vitrine'); } catch (_) { /* ignora */ } }
  /* Vitrine na nuvem: 1 leitura por loja, documentos pequenos, e cache de 5 minutos no aparelho. */
  /* opcoes.semCache: lista de agora (o cadastro conta as lojas no ar antes de deixar criar outra) */
  FirebaseStore.prototype.listarVitrine = function (opcoes) {
    var chave = CHAVE_VITRINE;
    if (!(opcoes && opcoes.semCache)) try {
      var c = JSON.parse(localStorage.getItem(chave) || 'null');
      if (c && c.em && Date.now() - c.em < 5 * 60 * 1000 && Array.isArray(c.lista)) return Promise.resolve(c.lista);
    } catch (_) { /* segue */ }
    var eu = this;
    function guardar(lista) { try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), lista: lista })); } catch (_) { /* sem espaco */ } return lista; }
    function doBanco() {
      return eu._pronto.then(function () {
        return eu.db.collection('vitrine').get().then(function (snap) {
          var lista = [];
          snap.forEach(function (d) { try { lista.push(daNuvem(d.data(), d.id)); } catch (_) { /* loja ilegivel: fica de fora */ } });
          return guardar(lista);
        });
      });
    }
    /* a lista de agora (o cadastro conta as lojas no ar) vem do banco; o resto, da borda (0 leitura por visita) */
    if (opcoes && opcoes.semCache) return doBanco();
    return pegarBorda('/vitrine').then(function (x) {
      if (x.status !== 200 || !Array.isArray(x.dados.lista)) throw erroBorda();
      /* sem passar a posicao da lista: daNuvem(dados, id) trocava o slug de toda loja depois da primeira por "1", "2"... */
      return guardar(x.dados.lista.map(function (l) { return daNuvem(l); }));
    }).catch(doBanco);
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
      return this.db.collection('lojas').doc(slug).get().then(function (d) { return d.exists ? daNuvem(d.data(), d.id) : null; });
    }.bind(this));
  };

  /* update() troca cada campo inteiro (um grupo apagado some de verdade); set+merge fundiria mapas e ressuscitaria o grupo. */
  /* completa: a loja inteira ja com as mudancas (o painel tem). Com ela a vitrine sai sem reler o documento (50 KB). */
  FirebaseStore.prototype.salvarLoja = function (loja, completa) {
    var nova = Object.assign({}, clonar(loja), { atualizadoEm: agoraISO() });
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('lojas').doc(loja.slug);
      return ref.update(paraNuvem(nova)).then(function () {
        eu.publicarLoja(loja.slug);
        /* vitrine acompanha: precisa da loja inteira pra montar o resumo */
        var inteira = completa ? Promise.resolve(Object.assign({}, clonar(completa), nova)) : ref.get().then(function (d) { return d.exists ? daNuvem(d.data(), d.id) : null; });
        return inteira.then(function (l) {
          if (!l) return nova;
          /* so grava a vitrine quando o resumo mudou (preco de item, foto e recado nao aparecem nela): cada gravacao
             custava uma escrita e uma leitura na regra, a cada salvar do painel. A primeira da sessao sempre vai */
          return resumoLeve(l).then(function (r) {
            var chave = JSON.stringify(Object.assign({}, r, { atualizadoEm: '' }));
            eu._vitrineFeita = eu._vitrineFeita || {};
            if (eu._vitrineFeita[loja.slug] === chave) return nova;
            return eu.db.collection('vitrine').doc(loja.slug).set(paraNuvem(r)).then(function () { eu._vitrineFeita[loja.slug] = chave; limparCacheVitrine(); return nova; });
          });
        }).catch(function () { return nova; });
      });
    });
  };
  /* Admin: reconstroi a vitrine a partir de todas as lojas (primeira vez, ou se algo desencontrar). */
  FirebaseStore.prototype.reconstruirVitrine = function () {
    var eu = this;
    return this.listarTodasLojas().then(function (lojas) {
      return Promise.all(lojas.map(resumoLeve)).then(function (resumos) {
        var lote = eu.db.batch();
        resumos.forEach(function (r) { lote.set(eu.db.collection('vitrine').doc(r.slug), paraNuvem(r)); });
        return lote.commit();
      }).then(function () { limparCacheVitrine(); return lojas.length; });
    });
  };

  FirebaseStore.prototype.criarLoja = function (dados) {
    var eu = this;
    return this._pronto.then(function () {
      /* o dono: a loja nasce no mensageiro, que confere o plano da conta, as vagas e o endereco (o banco nao deixa criar
         direto). O admin, pela Central, grava direto como antes */
      var admin = String((window.LIGEIRO_CONFIG || {}).adminEmail || '').toLowerCase();
      var u = eu.auth.currentUser;
      var borda = enderecoBorda();
      if (u && borda && String(u.email || '').toLowerCase() !== admin) {
        var nova = Object.assign(modeloDeLoja(), clonar(dados), { cidadeSlug: R.slugDaCidade(dados.cidade || 'Juquiá', dados.uf || 'SP') });
        return resumoLeve(nova).then(function (r) {
          return u.getIdToken().then(function (t) {
            return fetch(borda + '/loja-nova', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ loja: paraNuvem(nova), vitrine: paraNuvem(r) }) });
          });
        }).then(function (resp) {
          /* mensageiro de antes desta rota (404): cai no caminho antigo, direto no banco */
          if (resp.status === 404) return null;
          return resp.json().catch(function () { return {}; }).then(function (j) {
            if (!resp.ok || !j.ok || !j.loja) { var e = new Error(j.erro || 'Não deu para criar a loja agora. Tente de novo.'); e.publico = true; throw e; }
            limparCacheVitrine();
            return daNuvem(j.loja, j.slug);
          });
        }).then(function (criada) { return criada || criarDireto(); });
      }
      return criarDireto();
    });
    function criarDireto() {
      var base = R.slug(dados.nome) || 'loja';
      var col = eu.db.collection('lojas');
      var tentar = function (slug, n) {
        return col.doc(slug).get().then(function (d) {
          if (d.exists) return tentar(base + '-' + n, n + 1);
          var loja = Object.assign(modeloDeLoja(), clonar(dados), {
            slug: slug, cidadeSlug: R.slugDaCidade(dados.cidade || 'Juquiá', dados.uf || 'SP'), criadoEm: agoraISO(), atualizadoEm: agoraISO(),
          });
          /* primeiro a loja, depois a vitrine: a regra da vitrine le a loja pra saber quem e o dono */
          return col.doc(slug).set(paraNuvem(loja)).then(function () {
            return resumoLeve(loja).then(function (r) { return eu.db.collection('vitrine').doc(slug).set(paraNuvem(r)); });
          }).then(function () { limparCacheVitrine(); eu.publicarLoja(slug); return loja; });
        });
      };
      return tentar(base, 2);
    }
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
        if (dados && !imagemSegura(dados)) dados = null;
        if (dados) { try { localStorage.setItem(chave, dados); } catch (_) { /* sem espaco: segue sem guardar */ } }
        return dados;
      });
    }.bind(this)).catch(function () { return null; });
  };

  /* Pacotes de miniaturas: as fotos dos produtos tambem ficam juntas em 4 documentos (_pacote0.._pacote3), em 320px.
     O cliente novo le 4 documentos (e nao 1 por foto) e baixa so miniaturas; a foto grande vem quando ele abre o item.
     A capa (id "capa-...") nao entra: e grande e vem inteira, foto por foto. */
  var PACOTES = 4;
  function pacoteDe(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return '_pacote' + (h % PACOTES); }
  function ehPacote(id) { return /^_pacote\d+$/.test(id); }
  function ehCapa(id) { return /^capa-/.test(id); }
  /* miniatura em jpeg (320px no lado maior): nitida no cartao de 108-116px ate em tela de alta resolucao */
  function miniatura(src, lado, qualidade) {
    lado = lado || 320; qualidade = qualidade || 0.72;
    return new Promise(function (ok) {
      if (!src || typeof document === 'undefined') { ok(null); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) { ok(null); return; }
          var e = Math.min(1, lado / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * e)); c.height = Math.max(1, Math.round(h * e));
          var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', qualidade));
        } catch (_) { ok(null); }
      };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }
  function fotosDaColecao(snap) { var mapa = {}; snap.forEach(function (d) { if (!ehPacote(d.id)) mapa[d.id] = d.data().dados; }); return mapa; }

  FirebaseStore.prototype.listarFotos = function (lojaSlug, versao, loja) {
    var eu = this;
    var pacote = !!(loja && loja.fotosPacote === 1 && !loja.fotosAvulsas);
    eu._pacotes[lojaSlug] = pacote;
    var chaveCache = 'ligeiro:fotos:' + lojaSlug;
    var cache = null;
    try { cache = JSON.parse(localStorage.getItem(chaveCache) || 'null'); } catch (_) { cache = null; }
    if (cache && versao && cache.versao === versao && !!cache.pacote === pacote) return Promise.resolve(cache.mapa);
    return this._pronto.then(function () {
      var col = eu.db.collection('lojas').doc(lojaSlug).collection('fotos');
      var ler = pacote ? eu._lerPacotes(col, loja, lojaSlug) : col.get().then(fotosDaColecao);
      return ler.then(function (mapa) {
        var pacote = JSON.stringify({ versao: versao || '', pacote: eu._pacotes[lojaSlug], mapa: mapa });
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

  /* 4 pacotes (4 leituras) + a capa inteira. Faltou foto de produto no pacote: le foto por foto desta vez (e o painel refaz). */
  FirebaseStore.prototype._lerPacotes = function (col, loja, lojaSlug) {
    var eu = this;
    var nums = []; for (var i = 0; i < PACOTES; i++) nums.push(i);
    return Promise.all(nums.map(function (i) { return col.doc('_pacote' + i).get(); })).then(function (docs) {
      var mapa = {};
      docs.forEach(function (d) { var f = d.exists ? (d.data().fotos || {}) : {}; Object.keys(f).forEach(function (id) { if (f[id]) mapa[id] = f[id]; }); });
      var faltou = (loja.produtos || []).some(function (p) { return p && p.foto && !ehCapa(p.foto) && !mapa[p.foto]; });
      if (faltou) {
        eu._incompleto[lojaSlug] = true;
        eu._pacotes[lojaSlug] = false; /* esta visita segue com as fotos inteiras */
        return col.get().then(fotosDaColecao);
      }
      if (!loja.capa || mapa[loja.capa]) return mapa;
      return eu.obterFoto(lojaSlug, loja.capa).then(function (c) { if (c) mapa[loja.capa] = c; return mapa; });
    });
  };
  /* o mapa da ultima leitura veio da pasta inteira (e nao dos pacotes)? Entao foto que nao esta nele nao existe mais */
  FirebaseStore.prototype.leuTodasAsFotos = function (lojaSlug) { return !this._pacotes[lojaSlug]; };
  /* foto grande de um produto quando a loja usa miniaturas (null = ja esta inteira no mapa) */
  FirebaseStore.prototype.fotoCheia = function (lojaSlug, id) {
    if (!id || !this._pacotes[lojaSlug]) return Promise.resolve(null);
    return this.fotoPublica(lojaSlug, id);
  };
  /* painel: loja com 5 fotos ou mais ainda sem pacotes (ou com pacote faltando foto) junta as miniaturas */
  FirebaseStore.prototype.precisaEmpacotar = function (lojaSlug, loja, mapa) {
    if (this._incompleto[lojaSlug]) return true;
    if (!loja || loja.fotosPacote === 1 || loja.fotosAvulsas) return false;
    return Object.keys(mapa || {}).filter(function (id) { return mapa[id] && !ehCapa(id); }).length >= 5;
  };
  FirebaseStore.prototype.empacotarFotos = function (lojaSlug, mapa) {
    var eu = this;
    var ids = Object.keys(mapa || {}).filter(function (id) { return mapa[id] && !ehCapa(id) && !ehPacote(id); });
    return Promise.all(ids.map(function (id) { return miniatura(mapa[id]).then(function (m) { return [id, m]; }); })).then(function (pares) {
      var grupos = {}; for (var i = 0; i < PACOTES; i++) grupos['_pacote' + i] = {};
      var falhou = false;
      pares.forEach(function (x) { if (x[1]) grupos[pacoteDe(x[0])][x[0]] = x[1]; else falhou = true; });
      if (falhou || Object.keys(grupos).some(function (k) { return JSON.stringify(grupos[k]).length > 900000; })) return false;
      return eu._pronto.then(function () {
        var lojaRef = eu.db.collection('lojas').doc(lojaSlug);
        var lote = eu.db.batch();
        Object.keys(grupos).forEach(function (k) { lote.set(lojaRef.collection('fotos').doc(k), { fotos: grupos[k], atualizadoEm: agoraISO() }); });
        lote.set(lojaRef, { fotosPacote: 1, fotosAvulsas: false }, { merge: true });
        return lote.commit().then(function () { eu._pacotes[lojaSlug] = true; eu._incompleto[lojaSlug] = false; eu.publicarLoja(lojaSlug); return true; });
      });
    });
  };

  FirebaseStore.prototype.salvarFoto = function (lojaSlug, id, dados) {
    var eu = this;
    var comPacote = !!eu._pacotes[lojaSlug] && !ehCapa(id);
    return this._pronto.then(function () { return comPacote ? miniatura(dados) : null; }).then(function (mini) {
      var lojaRef = eu.db.collection('lojas').doc(lojaSlug);
      var col = lojaRef.collection('fotos');
      var lote = eu.db.batch();
      lote.set(col.doc(id), { dados: dados, criadoEm: agoraISO() });
      if (mini) { var campo = {}; campo[id] = mini; lote.set(col.doc(pacoteDe(id)), { fotos: campo, atualizadoEm: agoraISO() }, { merge: true }); }
      lote.set(lojaRef, { fotosVersao: agoraISO() }, { merge: true });
      return lote.commit().then(function () { eu.publicarLoja(lojaSlug); return id; }, function (e) {
        if (!mini) throw e;
        /* pacote passou do limite (1 MB): grava so a foto e a loja volta a ler foto por foto */
        eu._pacotes[lojaSlug] = false;
        var l2 = eu.db.batch();
        l2.set(col.doc(id), { dados: dados, criadoEm: agoraISO() });
        l2.set(lojaRef, { fotosVersao: agoraISO(), fotosAvulsas: true }, { merge: true });
        return l2.commit().then(function () { eu.publicarLoja(lojaSlug); return id; });
      });
    });
  };

  FirebaseStore.prototype.excluirFoto = function (lojaSlug, id) {
    var eu = this;
    return this._pronto.then(function () {
      var lojaRef = eu.db.collection('lojas').doc(lojaSlug);
      var lote = eu.db.batch();
      lote.delete(lojaRef.collection('fotos').doc(id));
      if (eu._pacotes[lojaSlug] && !ehCapa(id)) { var campo = {}; campo[id] = window.firebase.firestore.FieldValue.delete(); lote.set(lojaRef.collection('fotos').doc(pacoteDe(id)), { fotos: campo }, { merge: true }); }
      lote.set(lojaRef, { fotosVersao: agoraISO() }, { merge: true });
      return lote.commit().then(function () { eu.publicarLoja(lojaSlug); });
    });
  };

  FirebaseStore.prototype.excluirLoja = function (slug) {
    var eu = this;
    return this._pronto.then(function () {
      var lote = eu.db.batch();
      lote.set(eu.db.collection('lojas').doc(slug), { ativa: false }, { merge: true });
      lote.set(eu.db.collection('vitrine').doc(slug), { ativa: false }, { merge: true });
      return lote.commit().then(function () { eu.publicarLoja(slug); });
    });
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
              if (regra && regra.limite > 0 && c.usos >= regra.limite) throw R.ErroDoCliente('Esse código já foi todo usado.');
              tx.set(cupomRef, { usos: c.usos + 1, atualizadoEm: agoraISO() });
            }
            tx.set(contadorRef, contador);
            var completo = Object.assign({}, clonar(pedido), { id: id, senha: contador.ultima });
            /* as regras do banco nao deixam o pedido nascer com campos do pagamento (so o mensageiro e o painel escrevem):
               tira os que o montador de pedido poe vazios, senao o banco recusa o pedido inteiro */
            ['pagoEm', 'mp', 'pixCodigo', 'pixExpiraEm', 'confirmadoPor', 'pagoAposCancelar'].forEach(function (k) { delete completo[k]; });
            tx.set(lojaRef.collection('pedidos').doc(id), completo);
            return completo;
          });
        });
      });
    });
  };

  /* Vagas de fundador ja ocupadas e o limite de lojas: documento publico publico/fundadores (so o admin escreve). Cache de 10 min. */
  /* opcoes.semCache: le do servidor (cadastro e Central decidem vagas com o numero de agora). Falhou: devolve null
     (quem chama fica com o que ja sabia; nunca vira "vaga aberta" por erro de rede). */
  FirebaseStore.prototype.obterFundadores = function (opcoes) {
    var chave = 'ligeiro:fundadores';
    if (!(opcoes && opcoes.semCache)) {
      try { var c = JSON.parse(localStorage.getItem(chave) || 'null'); if (c && Date.now() - c.em < 10 * 60 * 1000) return Promise.resolve({ usados: c.usados || 0, capacidade: c.capacidade || null }); } catch (_) { /* segue */ }
    }
    return this._pronto.then(function () {
      return this.db.collection('publico').doc('fundadores').get().then(function (d) {
        var dados = d.exists ? d.data() : {};
        var usados = Number(dados.usados) || 0;
        var capacidade = dados.capacidade || null;
        try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), usados: usados, capacidade: capacidade })); } catch (_) { /* ignora */ }
        return { usados: usados, capacidade: capacidade };
      });
    }.bind(this)).catch(function () { return null; });
  };
  /* Admin: limite de lojas e vagas abertas/fechadas. merge: nao mexe no contador de fundadores. */
  FirebaseStore.prototype.salvarCapacidade = function (mudancas) {
    var eu = this;
    var dados = Object.assign({}, clonar(mudancas), { atualizadoEm: agoraISO() });
    return this._pronto.then(function () {
      return eu.db.collection('publico').doc('fundadores').set({ capacidade: dados }, { merge: true });
    }).then(function () { try { localStorage.removeItem('ligeiro:fundadores'); } catch (_) { /* ignora */ } return dados; });
  };
  FirebaseStore.prototype.ocuparVagaFundador = function () {
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('publico').doc('fundadores');
      return eu.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (d) {
          var usados = (d.exists ? (Number(d.data().usados) || 0) : 0) + 1;
          tx.set(ref, { usados: usados, atualizadoEm: agoraISO() }, { merge: true });
          return { usados: usados };
        });
      }).then(function (r) { try { localStorage.removeItem('ligeiro:fundadores'); } catch (_) { /* ignora */ } return r; });
    });
  };

  /* pagamento desfeito pelo admin (era teste): a vaga de fundador que ele ocupou volta pro contador */
  FirebaseStore.prototype.liberarVagaFundador = function () {
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('publico').doc('fundadores');
      return eu.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (d) {
          var usados = Math.max(0, (d.exists ? (Number(d.data().usados) || 0) : 0) - 1);
          tx.set(ref, { usados: usados, atualizadoEm: agoraISO() }, { merge: true });
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
  /* Cupom novo com codigo de um cupom excluido: apaga o contador antigo, senao ele nasce esgotado (so dono e admin podem). */
  FirebaseStore.prototype.zerarUsosDoCupom = function (lojaSlug, codigo) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('contadores').doc('cupom-' + String(codigo || '').toUpperCase()).delete()
        .then(function () { return true; });
    }.bind(this));
  };

  FirebaseStore.prototype.obterPedido = function (lojaSlug, id) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id).get()
        .then(function (d) { return d.exists ? sanearPedido(d) : null; });
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
        snap.forEach(function (d) { try { lista.push(sanearPedido(d)); } catch (_) { /* ilegivel: fora */ } });
        return lista;
      });
    }.bind(this));
  };

  /* Pedidos que ficaram andando de outros dias (ninguem concluiu): uma leitura avulsa ao abrir o painel, sem escuta.
     So o filtro de situacao vai ao banco (dispensa indice composto); a data e separada no aparelho */
  /* A versao que ja esta no aparelho (sem leitura): o pedido que saiu da fila do painel chega junto com a escuta */
  FirebaseStore.prototype.pedidoDoCache = function (lojaSlug, id) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id).get({ source: 'cache' });
    }.bind(this)).then(function (d) { return d.exists ? sanearPedido(d) : null; }).catch(function () { return null; });
  };
  /* Todos os pedidos do dia de trabalho, uma vez (o dono abriu "Concluidos e cancelados hoje") */
  FirebaseStore.prototype.pedidosDoDia = function (lojaSlug, desde) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(lojaSlug).collection('pedidos').where('criadoEm', '>=', desde).orderBy('criadoEm', 'desc').limit(300).get();
    }.bind(this)).then(function (snap) {
      var lista = [];
      snap.forEach(function (doc) { try { lista.push(sanearPedido(doc)); } catch (_) { /* ilegivel: fora */ } });
      return lista;
    });
  };

  FirebaseStore.prototype.atualizarPedido = function (lojaSlug, id, mudancas) {
    return this._pronto.then(function () {
      var ref = this.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id);
      /* devolve o que mudou (quem esta na tela ja escuta o pedido pelo onSnapshot): economiza uma leitura por clique */
      var novo = Object.assign({}, clonar(mudancas), { atualizadoEm: agoraISO() });
      return ref.update(novo).then(function () { return Object.assign({ id: id }, novo); });
    }.bind(this));
  };

  /* Pix vencido: transacao que rele o pedido e so cancela se ainda espera o pagamento e nao tem pagoEm
     (o mensageiro pode ter gravado o "pago" nesse meio tempo). Devolve true se cancelou. */
  FirebaseStore.prototype.cancelarPixVencido = function (lojaSlug, id) {
    var eu = this;
    return this._pronto.then(function () {
      var ref = eu.db.collection('lojas').doc(lojaSlug).collection('pedidos').doc(id);
      return eu.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (d) {
          var p = d.exists ? d.data() : null;
          if (!p || p.status !== R.STATUS.AGUARDANDO || p.pagoEm) return false;
          tx.update(ref, { status: R.STATUS.CANCELADO, canceladoPor: 'pix-vencido', atualizadoEm: agoraISO() });
          return true;
        });
      });
    });
  };

  /* No modo de verdade, o painel entra com e-mail do dono + senha (Firebase Auth). */
  /* E-mail do usuario de equipe da loja (criado pelo mensageiro quando o dono define a senha da equipe). Fica no nosso
     dominio; o velho (ligeiro.app.br, que nao e nosso) so vale ate o dono salvar a senha da equipe de novo */
  var EMAIL_EQUIPE = /^equipe-([a-z0-9-]+)@equipe\.(ligeiropedidos\.com\.br|ligeiro\.app\.br)$/i;
  function emailEquipe(slug) { return 'equipe-' + slug + '@equipe.ligeiropedidos.com.br'; }
  /* a loja de um login de equipe ('' quando nao e) */
  function lojaDaEquipe(email) { var m = EMAIL_EQUIPE.exec(String(email || '')); return m ? m[1].toLowerCase() : ''; }
  function entrarEquipe(eu, slug, pin) {
    return eu.auth.signInWithEmailAndPassword(emailEquipe(slug), 'LIG-' + pin).catch(function (e) {
      var c = (e && e.code) || '';
      if (c === 'auth/network-request-failed' || c === 'auth/too-many-requests') throw e;
      /* login de antes da troca de dominio (ligeiro.app.br, que nao e nosso): a senha confere, mas ele nao vale mais.
         Sai na hora e diz o que fazer (sem isso, a equipe ouviria "senha errada" com a senha certa) */
      return eu.auth.signInWithEmailAndPassword('equipe-' + slug + '@equipe.ligeiro.app.br', 'LIG-' + pin).then(function () {
        return eu.auth.signOut().catch(function () { /* segue */ }).then(function () {
          var aviso = new Error('A senha está certa, mas o dono precisa salvar a senha da equipe de novo no painel (Minha loja, Senha da equipe). Depois é só entrar com a mesma senha.');
          aviso.publico = true;
          throw aviso;
        });
      }, function () { throw e; });
    });
  }
  FirebaseStore.prototype.entrarPainel = function (lojaSlug, senha) {
    var eu = this;
    var pin = String(senha || '').trim();
    /* 1) senha da equipe (sem ler a loja); 2) dono com e-mail e senha (quem criou a conta sem Google): ai sim le a
       loja, para saber o e-mail do dono */
    return this._pronto.then(function () {
      return entrarEquipe(eu, lojaSlug, pin).then(function () { return true; });
    }).catch(function (e1) {
      if (e1 && e1.publico) throw e1;
      /* sem internet ou tentativas demais: dizer "Senha errada." fazia a equipe achar que o dono trocou a senha */
      var c1 = (e1 && e1.code) || '';
      if (c1 === 'auth/network-request-failed' || c1 === 'auth/too-many-requests') throw erroDeLogin(e1);
      return eu.obterLoja(lojaSlug).then(function (loja) {
        if (!loja || !loja.donoEmail) return false;
        return eu.auth.signInWithEmailAndPassword(loja.donoEmail, pin).then(function (r) {
          if (r && r.user && r.user.emailVerified === true) return true;
          /* e-mail ainda nao conferido: o banco recusa tudo. Manda o e-mail de confirmacao, sai e avisa (senao o painel recarrega sem fim) */
          var enviar = r && r.user ? r.user.sendEmailVerification().catch(function () { /* ja mandou ha pouco */ }) : Promise.resolve();
          return enviar.then(function () { return eu.auth.signOut(); }).catch(function () { /* segue */ }).then(function () {
            throw new Error('Falta confirmar o seu e-mail. Mandamos um link para ' + loja.donoEmail + ' (olhe também no spam). Toque no link e entre de novo.');
          });
        }, function (e2) {
          var c2 = (e2 && e2.code) || '';
          if (c2 === 'auth/network-request-failed' || c2 === 'auth/too-many-requests') throw erroDeLogin(e2);
          return false;
        });
      });
    });
  };
  /* Loja para as telas da equipe: a copia da borda (a mesma do cliente, 0 leituras no banco). Sem borda: o banco */
  FirebaseStore.prototype.lojaDaEquipe = function (slug) {
    var eu = this;
    return pegarBorda('/loja/' + encodeURIComponent(slug), false).then(function (x) {
      if (x.status === 404) return null;
      if (x.status !== 200 || !x.dados.loja) throw erroBorda();
      return daNuvem(x.dados.loja, slug);
    }).catch(function () { return eu.obterLoja(slug); });
  };
  /* Marca do dono no login: com ela as regras reconhecem o dono sem ler a loja (cada pedido que anda no painel custava
     2 leituras, agora 1). Pedida uma vez por loja na vida: o login ja com a marca nao chama ninguem. Falhou: tudo segue
     igual, so mais caro */
  FirebaseStore.prototype.marcarDono = function (slug) {
    var eu = this;
    var base = enderecoBorda();
    if (!base || !slug) return Promise.resolve(false);
    return this._pronto.then(function () {
      var u = eu.auth.currentUser;
      if (!u || !u.getIdTokenResult) return false;
      return u.getIdTokenResult().then(function (res) {
        var lojas = (res && res.claims && res.claims.lojas) || [];
        var ate = Number(res && res.claims && res.claims.lojasAte) || 0;
        /* a marca vale 3 dias: com mais de 1 dia de folga, nada a fazer */
        if (Array.isArray(lojas) && lojas.indexOf(slug) >= 0 && ate - Date.now() / 1000 > 86400) return false;
        return fetch(base + '/dono', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + res.token }, body: JSON.stringify({ loja: slug }) })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          /* marca nova: token novo, e o banco passa a usar ele sozinho (as escutas abertas seguem) */
          .then(function (j) { return j && j.marca ? u.getIdToken(true).then(function () { return true; }) : false; });
      });
    }).catch(function () { return false; });
  };

  /* Token de identidade do usuario logado (pro mensageiro conferir quem esta pedindo). forcar = pega um token novo. */
  FirebaseStore.prototype.obterIdToken = function (forcar) {
    return this._pronto.then(function () {
      var u = this.auth.currentUser;
      if (!u) throw new Error('Entre na sua conta primeiro.');
      return u.getIdToken(forcar === true);
    }.bind(this));
  };

  /* Segredos da loja: documento privado lojas/<slug>/privado/<nome>, que as regras so deixam o dono ler. */
  /* falhar = true: a leitura que nao deu devolve erro (quem vai salvar em cima precisa saber que nao leu) */
  FirebaseStore.prototype.lerSegredo = function (slug, nome, falhar) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(slug).collection('privado').doc(nome).get()
        .then(function (d) { return d.exists ? d.data() : null; })
        .catch(function (e) { if (falhar) throw e; return null; });
    }.bind(this));
  };
  FirebaseStore.prototype.guardarSegredo = function (slug, nome, dados) {
    var eu = this;
    return this._pronto.then(function () {
      return this.db.collection('lojas').doc(slug).collection('privado').doc(nome).set(clonar(dados)).then(function () {
        /* token do Mercado Pago trocado ou desconectado: o mensageiro esquece a copia que guardava (vale na hora) */
        if (nome === 'mercadopago' && dados && 'token' in dados) eu.publicarLoja(slug);
        return true;
      });
    }.bind(this));
  };

  /* ---- conta do dono (Firebase Authentication: Google ou e-mail e senha) ---- */
  function usuarioDoFirebase(u) {
    if (!u || !u.email) return null;
    return { email: String(u.email).toLowerCase(), nome: u.displayName || '', foto: u.photoURL || '', via: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || '', emailVerified: u.emailVerified === true };
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
    return new Error('Não deu para entrar agora. Tente de novo em instantes.');
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
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') throw new Error('O navegador bloqueou a janela do Google. Toque em "Entrar com o Google" de novo. Se continuar, libere pop-ups para este site ou abra no Safari ou Chrome.');
        throw erroDeLogin(e);
      });
    }
    /* banco ja carregado (o normal): abre a janela na hora, ainda dentro do toque, senao o navegador bloqueia */
    if (eu.auth && window.firebase && window.firebase.auth) return abrirJanela();
    /* ainda carregando: espera e pede outro toque (abrir janela fora do toque seria bloqueado) */
    return eu._pronto.then(function () { throw new Error('Quase lá. Toque em "Entrar com o Google" de novo.'); });
  };
  FirebaseStore.prototype.listarMinhasLojas = function (email) {
    return this._pronto.then(function () {
      return this.db.collection('lojas').where('donoEmail', '==', String(email || '').toLowerCase()).get().then(function (snap) {
        var lista = [];
        snap.forEach(function (d) { try { lista.push(daNuvem(d.data(), d.id)); } catch (_) { /* loja ilegivel: fica de fora */ } });
        return lista.filter(function (l) { return l.ativa !== false; }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
      });
    }.bind(this));
  };
  FirebaseStore.prototype.donoLogado = function (loja) {
    var eu = this;
    return this.usuarioAtual().then(function (u) {
      /* e-mail nao conferido: as regras do banco recusam o dono, entao nao abre o painel sem senha */
      if (!u || u.emailVerified !== true || lojaDaEquipe(u.email)) return false;
      var admin = String((window.LIGEIRO_CONFIG || {}).adminEmail || '').toLowerCase();
      if (admin && u.email === admin) return true;
      if (loja.donoEmail) return u.email === String(loja.donoEmail).toLowerCase();
      /* loja da borda (sem o e-mail do dono): a marca de dono do login responde sem ler o banco; sem ela, le a loja.
         E so o atalho para entrar sem senha: quem decide o acesso de verdade sao as regras do banco */
      var cu = eu.auth.currentUser;
      return (cu && cu.getIdTokenResult ? cu.getIdTokenResult() : Promise.resolve(null)).then(function (res) {
        var lojas = res && res.claims && res.claims.lojas;
        if (Array.isArray(lojas) && lojas.indexOf(loja.slug) >= 0) return true;
        return eu.obterLoja(loja.slug).then(function (l) { return !!l && u.email === String(l.donoEmail || '').toLowerCase(); });
      }).catch(function () { return false; });
    });
  };

  /* Sair de verdade: derruba a sessao do Firebase (tablet compartilhado nao fica logado). */
  FirebaseStore.prototype.sair = function () {
    var eu = this;
    lembrarSessao(false);
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
  /* endereco de fora (pixel de rastreio posto pelo dono de uma loja) nunca chega na tela de quem abre */
  function fotoSrc(objeto, fotos) {
    if (!objeto) return null;
    if (objeto.foto && fotos && fotos[objeto.foto]) return srcSeguro(fotos[objeto.foto]);
    if (objeto.fotoUrl) return srcSeguro(objeto.fotoUrl);
    return null;
  }
  function logoSrc(loja) {
    if (!loja) return null;
    return srcSeguro(loja.logoDados) || srcSeguro(loja.logoUrl) || null;
  }

  /* o banco gratis chegou no limite do dia (leituras ou gravacoes)? */
  function ehLimite(e) { return !!e && (e.code === 'resource-exhausted' || /quota|resource.exhausted/i.test(String(e.message || ''))); }
  /* erro do banco em portugues de gente. Mensagem nossa (e.publico, ou ja em portugues e sem codigo) passa como esta */
  function erroAmigavel(e, padrao) {
    var c = (e && e.code) || '', m = String((e && e.message) || '');
    if (e && e.publico) return m;
    if (ehLimite(e)) return 'Muito movimento agora. Tente de novo em alguns minutos.';
    if (c === 'unavailable' || c === 'deadline-exceeded' || c === 'aborted' || e instanceof TypeError || /network|failed to fetch|load failed|offline/i.test(m)) return 'Sem internet agora. Confira a conexão e toque de novo.';
    if (c === 'permission-denied' || c === 'unauthenticated' || /permission/i.test(m)) return 'Sua sessão caiu. Entre de novo.';
    if (c === 'not-found') return 'Isso não existe mais. Atualize a tela.';
    /* mensagem nossa (em portugues, sem codigo do banco): passa como esta. Ingles ou tecnica: troca pela padrao */
    if (m && !c && m.length < 200 && !/(the|of|is|not|failed|error|missing|permissions?|unexpected|invalid|fetch|token|json|firestore|get|http|undefined|null)/i.test(m)) return m;
    return padrao || 'Não deu agora. Tente de novo.';
  }

  window.LigeiroDados = {
    store: store,
    ehLimite: ehLimite,
    erroAmigavel: erroAmigavel,
    fotoSrc: fotoSrc,
    logoSrc: logoSrc,
    modeloDeLoja: modeloDeLoja,
    idAleatorio: idAleatorio,
    clonar: clonar,
    modoDemo: store.tipo === 'demo',
    navegadorDeApp: navegadorDeApp,
    lojaDaEquipe: lojaDaEquipe,
  };
})();
