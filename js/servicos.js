/*
 * Loja do Ligeiro: os servicos que o Ligeiro vende para as lojas (fotos do cardapio, logo, video promocional e design
 * exclusivo), as telas do dono (loja, detalhe, compra, Meus servicos, Videos da loja, termos) e a parte da Central
 * (quadro de pedidos, criar pedido do WhatsApp, entregar video, reembolsar).
 *
 * Nada aqui le o banco: tudo passa pelo mensageiro do Asaas (rotas /servicos/*), que guarda os pedidos e os videos no KV
 * da Cloudflare. Quem decide preco, dono e situacao e o mensageiro; esta tela so mostra e pede.
 */
(function () {
  'use strict';
  var UI = window.LigeiroUI;
  var el = UI.el;
  var D = window.LigeiroDados;

  function geral() { return window.LIGEIRO_CONFIG || {}; }
  function cfg() { return geral().lojaLigeiro || {}; }
  function catalogo() { return cfg().servicos || []; }
  function servico(id) { var c = catalogo(); for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return null; }
  function mensageiro() { return String((geral().cobranca || {}).mensageiro || '').replace(/\/+$/, ''); }
  function ehAdmin(email) { return !!email && String(email).toLowerCase() === String(geral().adminEmail || '').toLowerCase(); }
  /* ligada: todo dono ve; desligada: so o admin (testa depois de colar o mensageiro, sem ninguem ver pela metade) */
  function visivel(email) { return cfg().ligada === true || ehAdmin(email) || !!D.modoDemo; }
  function reais(c) { var v = Math.round(Number(c) || 0); return 'R$ ' + String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (v % 100 ? ',' + String(v % 100).padStart(2, '0') : ''); }
  function diaMes(iso) { var s = String(iso || ''); var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return ''; if (s.length > 10) { var d = new Date(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); } return m[3] + '/' + m[2]; }
  function whatsSuporte(texto) { var n = geral().whatsappLigeiro; return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto) : ''; }
  function ico(nome) { return UI.iconeLinha(nome); }
  function rota(slug, resto) { return '#/servicos/' + slug + (resto ? '/' + resto : ''); }
  function midia(qual, id) {
    if (D.modoDemo) return qual === 'v' ? 'midia/comercial-ligeiro.mp4' : 'midia/comercial-ligeiro.jpg';
    return mensageiro() + '/servicos/' + qual + '/' + id;
  }

  /* ---------- conversa com o mensageiro ---------- */
  function erroPublico(texto, dados) { var e = new Error(texto); e.publico = true; e.dados = dados || {}; return e; }
  function api(rotaApi, corpo) {
    if (D.modoDemo) return demo(rotaApi, corpo || {});
    var base = mensageiro();
    if (!base || !D.store || !D.store.obterIdToken) return Promise.reject(erroPublico('Não deu agora. Tente de novo em instantes.'));
    return D.store.obterIdToken().then(function (t) {
      return fetch(base + '/servicos/' + rotaApi, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo || {}) })
        .catch(function () { throw erroPublico('Sem internet agora. Confira a conexão e toque de novo.'); });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw erroPublico(j.erro || (r.status === 404 ? 'O mensageiro ainda não tem a Loja do Ligeiro. Cole a versão nova.' : 'Não deu agora. Tente de novo em instantes.'), j);
        return j;
      });
    });
  }
  function subirArquivo(pedido, tipo, blob, extra) {
    if (D.modoDemo) return demo('subir', { pedido: pedido, tipo: tipo, id: extra && extra.id, dur: extra && extra.dur });
    var q = 'pedido=' + encodeURIComponent(pedido) + '&tipo=' + tipo + (extra && extra.id ? '&id=' + encodeURIComponent(extra.id) : '') + (extra && extra.dur ? '&dur=' + Math.round(extra.dur) : '');
    return D.store.obterIdToken().then(function (t) {
      return fetch(mensageiro() + '/servicos/subir?' + q, { method: 'POST', headers: { 'Content-Type': tipo === 'capa' ? 'image/jpeg' : 'video/mp4', Authorization: 'Bearer ' + t }, body: blob })
        .catch(function () { throw erroPublico('Sem internet agora. Confira a conexão e tente de novo.'); });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw erroPublico(j.erro || 'Não subiu o arquivo. Tente de novo.', j); return j; });
    });
  }

  /* ---------- demonstracao (copia de teste): o mensageiro de mentira guarda tudo neste aparelho ---------- */
  var CHAVE_DEMO = 'ligeiro:servicos-demo';
  function lerDemo() { var d = UI.lerLocal(CHAVE_DEMO); return d && typeof d === 'object' ? d : { pedidos: {}, lojas: {} }; }
  function gravarDemo(d) { UI.guardarLocal(CHAVE_DEMO, d); }
  function idDemo() { var s = ''; while (s.length < 20) s += Math.random().toString(36).slice(2); return s.slice(0, 20); }
  function demo(r, c) {
    var d = lerDemo();
    var loja = function (slug) { d.lojas[slug] = d.lojas[slug] || { videos: [], noSite: null }; return d.lojas[slug]; };
    var lista = function (slug) { return Object.keys(d.pedidos).map(function (k) { return d.pedidos[k]; }).filter(function (p) { return !slug || p.loja === slug; }).sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; }); };
    var res;
    if (r === 'meus') { var l = loja(c.loja); res = { pedidos: lista(c.loja), videos: l.videos, noSite: l.noSite, maxVideos: 10 }; }
    else if (r === 'comprar' || r === 'criar') {
      var s = servico(c.servico);
      if (!s) return Promise.reject(erroPublico('Esse serviço não existe.'));
      if (r === 'criar' && c.fora === true) {
        var agora = new Date().toISOString();
        var pf = { id: idDemo(), loja: c.loja, lojaNome: c.lojaNome || c.loja, servico: s.id, nome: s.nome, valor: Number(c.valor) || 0, status: 'producao', criadoEm: agora, pagoEm: agora, materialEm: agora, prazoAte: agora.slice(0, 10), forma: 'FORA', whatsapp: '', origem: 'fora' };
        d.pedidos[pf.id] = pf; gravarDemo(d);
        return new Promise(function (ok) { setTimeout(function () { ok({ ok: true, pedido: pf }); }, 250); });
      }
      var p = { id: idDemo(), loja: c.loja, lojaNome: c.lojaNome || c.loja, servico: s.id, nome: s.nome, valor: s.valor, status: 'aguardando_pagamento', criadoEm: new Date().toISOString(), venceEm: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), whatsapp: String(c.whatsapp || ''), origem: r === 'criar' ? 'whatsapp' : 'site', link: '' };
      d.pedidos[p.id] = p; res = { pedido: p, link: '' };
      /* o "Asaas" de mentira confirma o pagamento em 3 s */
      setTimeout(function () { var x = lerDemo(); if (x.pedidos[p.id] && x.pedidos[p.id].status === 'aguardando_pagamento') { x.pedidos[p.id].status = 'material'; x.pedidos[p.id].pagoEm = new Date().toISOString(); x.pedidos[p.id].forma = 'PIX'; gravarDemo(x); } }, 3000);
    }
    else if (r === 'video') { loja(c.loja).noSite = c.video || null; res = { noSite: loja(c.loja).noSite }; }
    else if (r === 'apagar-video') { var lv = loja(c.loja); lv.videos = lv.videos.filter(function (v) { return v.id !== c.video; }); if (lv.noSite === c.video) lv.noSite = null; res = { videos: lv.videos, noSite: lv.noSite }; }
    else if (r === 'central') res = { pedidos: lista('') };
    else if (r === 'etapa') { var pe = d.pedidos[c.id]; pe.status = 'producao'; pe.materialEm = new Date().toISOString(); var dd = new Date(); dd.setDate(dd.getDate() + 7); pe.prazoAte = dd.toISOString().slice(0, 10); res = { pedido: pe }; }
    else if (r === 'subir') res = { id: c.tipo === 'capa' ? c.id : idDemo(), dur: c.dur };
    else if (r === 'entregar') {
      var pd = d.pedidos[c.id]; pd.status = 'entregue'; pd.entregueEm = new Date().toISOString(); if (c.titulo) pd.titulo = c.titulo;
      if (pd.servico === 'video' && c.video) { var lj = loja(pd.loja); lj.videos.unshift({ id: c.video, titulo: c.titulo, dur: 20, capa: true, em: pd.entregueEm }); if (c.noSite) lj.noSite = c.video; pd.video = c.video; }
      res = { pedido: pd };
    }
    else if (r === 'reembolsar') { var pr = d.pedidos[c.id]; var tot = ((pr.reembolso && pr.reembolso.valor) || 0) + (c.valor || (pr.valor - ((pr.reembolso && pr.reembolso.valor) || 0))); pr.reembolso = { valor: tot, motivo: c.motivo, em: new Date().toISOString() }; if (tot >= pr.valor) pr.status = 'reembolsado'; res = { pedido: pr }; }
    gravarDemo(d);
    return new Promise(function (ok) { setTimeout(function () { ok(Object.assign({ ok: true }, res)); }, 250); });
  }

  /* ---------- pecas de tela ---------- */
  function topo(passo, titulo, voltar) {
    return el('header', { class: 'topo srv-topo' }, [
      el('a', { class: 'voltar', href: voltar, 'aria-label': 'Voltar' }, [ico('voltar')]),
      el('div', { class: 'topo-texto' }, [el('div', { class: 'topo-passo', text: passo }), el('h1', { class: 'topo-titulo', text: titulo })]),
    ]);
  }
  function chip(icone, texto, classe) { return el('span', { class: 'srv-chip' + (classe ? ' ' + classe : '') }, [icone ? ico(icone) : null, texto]); }
  function chipsDo(s) {
    return el('div', { class: 'srv-chips' }, [
      /* curtos de proposito: os dois selos cabem numa linha ate no iPhone com Tela ampliada (320); o "ate" e o "incluso"
         estao na pagina do servico e nos termos */
      chip('ampulheta', s.dias + ' dias úteis'),
      s.id === 'video' ? chip('check', 'Roteiro aprovado') : chip('check', s.ajustes === 1 ? '1 ajuste' : s.ajustes + ' ajustes'),
    ]);
  }
  function carregando(alvo, texto) { UI.limpar(alvo); alvo.appendChild(UI.carregandoMascote(texto)); }
  function mensagemTela(alvo, titulo, texto, botao) {
    UI.limpar(alvo);
    alvo.appendChild(el('div', { class: 'srv-vazio' }, [el('h2', { class: 'srv-h2', text: titulo }), el('p', { class: 'srv-peq', text: texto }), botao || null]));
  }
  var PRINTS = { padrao: 'img/loja-ligeiro/padrao.webp', exclusivo: 'img/loja-ligeiro/exclusivo.webp' };
  function comparar() {
    /* o nome em cima de cada celular: le-se primeiro o que e, depois olha a tela */
    function fig(img, alt, t, s, destaque) { return el('figure', { class: destaque ? 'destaque' : '' }, [el('figcaption', {}, [el('strong', { text: t }), el('span', { text: s })]), el('div', { class: 'srv-celular' }, el('img', { src: img, alt: alt, loading: 'lazy', width: '390', height: '620' }))]); }
    return el('div', { class: 'srv-comparar' }, [fig(PRINTS.padrao, 'Loja com o visual padrão do Ligeiro', 'Visual padrão', 'Loja de exemplo'), fig(PRINTS.exclusivo, 'Site da Dom Conizza com o design exclusivo', 'Design exclusivo', 'Dom Conizza, Juquiá/SP', true)]);
  }
  function capaDeVideo(v, classe) {
    var caixa = el('div', { class: 'srv-poster ' + (classe || ''), role: 'img', 'aria-label': 'Capa do vídeo ' + (v.titulo || '') });
    if (v.capa) caixa.appendChild(el('img', { src: midia('c', v.id), alt: '', loading: 'lazy' }));
    else caixa.appendChild(el('video', { src: midia('v', v.id) + '#t=1', preload: 'metadata', muted: true, playsinline: true }));
    if (v.dur) caixa.appendChild(el('span', { class: 'srv-tempo', text: '0:' + String(Math.min(59, v.dur)).padStart(2, '0') }));
    return caixa;
  }
  /* o player em tela cheia (o mesmo do site da loja) */
  function tocarVideo(url, titulo, rodape) {
    var fundo = el('div', { class: 'srv-player', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || 'Vídeo' });
    var video = el('video', { src: url, autoplay: true, playsinline: true, controls: true, preload: 'auto' });
    var fechar = function () { try { video.pause(); } catch (_) { /* ja parou */ } fundo.remove(); document.removeEventListener('keydown', tecla); UI.travarRolagem && UI.travarRolagem('video', false); };
    var tecla = function (e) { if (e.key === 'Escape') fechar(); };
    fundo.appendChild(video);
    fundo.appendChild(el('button', { class: 'srv-player-fechar', type: 'button', 'aria-label': 'Fechar o vídeo', onclick: fechar }, [ico('fechar')]));
    if (rodape) fundo.appendChild(el('div', { class: 'srv-player-rodape' }, rodape));
    document.body.appendChild(fundo);
    document.addEventListener('keydown', tecla);
    if (UI.travarRolagem) UI.travarRolagem('video', true);
    return fechar;
  }

  /* ---------- banner no painel (aba Minha loja) ---------- */
  function banner(slug, email) {
    if (!visivel(email)) return null;
    var serv = [['camera', 'Fotos'], ['pena', 'Logo'], ['video', 'Vídeo'], ['paleta', 'Design']];
    return el('a', { class: 'srv srv-banner', href: rota(slug) }, [
      el('div', { class: 'srv-banner-topo' }, [
        el('div', { class: 'srv-banner-texto' }, [
          el('div', { class: 'srv-linha-sobre' }, [el('span', { class: 'srv-sobre', text: 'Loja do Ligeiro' }), el('span', { class: 'srv-novo', text: 'Novo' })]),
          el('strong', { class: 'srv-banner-titulo', text: 'Sua loja com cara de marca grande' }),
          el('span', { class: 'srv-banner-frase' }, ['Logo, fotos e vídeo feitos pela nossa equipe, ', el('span', { class: 'sem-quebra', text: 'a partir de ' + reais(Math.min.apply(null, catalogo().map(function (s) { return s.valor; }))) + '.' })]),
        ]),
        /* o mascote com as cores dele, grande e cortado so um pouco pela borda de baixo da faixa */
        el('img', { class: 'srv-banner-mascote', src: 'img/mascote.webp', alt: '', width: '512', height: '512' }),
      ]),
      el('div', { class: 'srv-banner-servicos', 'aria-hidden': 'true' }, serv.map(function (x) { return el('span', { class: 'srv-banner-serv' }, [ico(x[0]), el('span', { class: 'srv-banner-serv-nome', text: x[1] })]); })),
      el('span', { class: 'btn srv-btn srv-banner-btn' }, ['Conhecer a loja', ico('seta')]),
    ]);
  }

  /* ---------- telas do dono ---------- */
  function abrir(raiz, partes) {
    raiz.className = 'app larga srv';
    var slug = partes[1] || '';
    var qual = partes[2] || '';
    var vivo = true;
    var paradas = [];
    UI.limpar(raiz);
    carregando(raiz, 'Abrindo a Loja do Ligeiro…');
    D.store.usuarioAtual().then(function (u) {
      if (!vivo) return;
      if (!u && !D.modoDemo) { window.LigeiroApp.substituir('painel/' + slug); return; }
      u = u || { email: '' };
      if (!visivel(u.email)) { mensagemTela(raiz, 'Em breve', 'A Loja do Ligeiro ainda não abriu. Assim que abrir, ela aparece no seu painel.', el('a', { class: 'btn srv-btn btn-fantasma', href: '#/painel/' + slug }, 'Voltar para o painel')); return; }
      if (qual === 'item' && servico(partes[3])) return telaItem(raiz, slug, servico(partes[3]), u);
      if (qual === 'meus') return telaMeus(raiz, slug, paradas, u);
      if (qual === 'videos') return telaVideos(raiz, slug, u);
      if (qual === 'termos') return telaTermos(raiz, slug);
      return telaLoja(raiz, slug, u);
    }).catch(function () { if (vivo) mensagemTela(raiz, 'Não abriu agora', 'Confira a internet e tente de novo.'); });
    return function () { vivo = false; paradas.forEach(function (f) { f(); }); var m = document.querySelector('.srv-player'); if (m) m.remove(); };
  }

  function cartaoServico(slug, s) {
    var artigo = el('article', { class: 'srv-cartao srv-prod' + (s.premium ? ' srv-premium' : '') }, [
      el('div', { class: 'srv-prod-cabeca' }, [
        el('div', { class: 'srv-ico-tile' }, [ico(s.icone)]),
        el('div', { class: 'srv-prod-txt' }, [
          el('div', { class: 'srv-prod-nome' }, [el('h3', { class: 'srv-h3', text: s.nome }), s.premium ? el('span', { class: 'srv-premium-selo', text: 'Premium' }) : null]),
          el('p', { class: 'srv-peq srv-prod-desc', text: s.resumo }),
        ]),
      ]),
      s.premium ? comparar() : null, /* no celular: titulo, a comparacao e depois selos e preco; no PC a grade poe ao lado */
      chipsDo(s),
      /* no PC o cartao do design e alto (os dois celulares do lado): o que vem incluso ocupa a sobra, sem repetir os ajustes dos selos */
      s.premium && s.inclui ? el('ul', { class: 'srv-premium-inclui' }, s.inclui.filter(function (t) { return !/ajuste/i.test(t); }).slice(0, 4).map(function (t) { return el('li', {}, [ico('check'), t]); })) : null,
      el('div', { class: 'srv-prod-pe' }, [
        el('div', { class: 'srv-preco' }, [el('strong', { text: reais(s.valor) }), el('span', { text: s.sub })]),
        el('a', { class: 'btn srv-btn ' + (s.premium ? '' : 'btn-fantasma'), href: rota(slug, 'item/' + s.id) }, ['Ver detalhes', ico('seta')]),
      ]),
    ]);
    return artigo;
  }
  function passos() {
    var dados = [['Escolha e pague', 'Pix, cartão ou boleto. Confirma sozinho, sem mandar comprovante.'], ['Mande o material', 'A gente chama você no WhatsApp para pegar fotos, logo antiga e ideias.'], ['Receba no prazo', 'O prazo conta a partir do material. Você acompanha em Meus serviços.'], ['Aprove o resultado', 'Fotos, logo e design têm ajuste incluso. No vídeo, você aprova o roteiro antes.']];
    return el('div', { class: 'srv-cartao srv-passos' }, dados.map(function (d, i) {
      return el('div', { class: 'srv-passo' }, [el('span', { class: 'srv-num', text: String(i + 1) }), el('div', {}, [el('strong', { text: d[0] }), el('span', { class: 'srv-peq', text: d[1] })])]);
    }));
  }
  /* o horario ("das 9h às 18h") nunca se parte no meio: o "18h" sozinho na linha de baixo fica feio */
  function textoSemQuebrar(t) {
    var m = /das \d{1,2}h(\d{2})? às \d{1,2}h(\d{2})?/.exec(t);
    return m ? [t.slice(0, m.index), el('span', { class: 'sem-quebra', text: m[0] }), t.slice(m.index + m[0].length)] : [t];
  }
  function linhaLink(href, icone, titulo, sub) {
    return el('a', { class: 'srv-cartao srv-linha-link', href: href }, [el('div', { class: 'srv-ico-tile' }, [ico(icone)]), el('div', { class: 'srv-linha-texto' }, [el('strong', { text: titulo }), el('span', { class: 'srv-peq', text: sub })]), el('span', { class: 'srv-seta-fim' }, [ico('avancar')])]);
  }
  function cartaoDuvida() {
    var link = whatsSuporte('Oi! Tenho uma dúvida sobre a Loja do Ligeiro.');
    return el('div', { class: 'srv-cartao srv-duvida' }, [
      el('div', {}, [el('h3', { class: 'srv-h3', text: 'Ficou com dúvida?' }), el('p', { class: 'srv-peq', text: 'Fale com a gente antes de comprar. A resposta vem no mesmo WhatsApp do suporte.' })]),
      el('span', { class: 'srv-atendimento' }, [ico('relogio'), el('span', {}, textoSemQuebrar(cfg().atendimento || ''))]),
      link ? el('a', { class: 'btn srv-btn btn-whats btn-largo', href: link, target: '_blank', rel: 'noopener' }, [ico('telefone'), 'Falar no WhatsApp']) : null,
    ]);
  }

  function telaLoja(raiz, slug) {
    UI.limpar(raiz);
    document.title = 'Loja do Ligeiro';
    var hero = el('div', { class: 'srv-hero srv-grad' + (cfg().videoExplicativo ? ' com-video' : '') }, [
      el('div', { class: 'srv-hero-texto' }, [
        el('span', { class: 'srv-sobre', text: 'Feito sob medida' }),
        el('h2', { class: 'srv-hero-titulo', text: 'Sua loja com cara de marca grande' }),
        el('p', { class: 'srv-hero-frase', text: cfg().videoExplicativo ? 'Veja em 30 segundos como funciona e o que a gente faz pela sua loja.' : 'Logo, fotos e vídeo para quem vende no delivery. Preço fechado e prazo certo.' }),
        el('div', { class: 'srv-hero-garantias' }, [['check', 'Preço fechado, sem surpresa'], ['ampulheta', 'Prazo em dias úteis'], ['lista', 'Você acompanha cada etapa']].map(function (g) {
          return el('span', { class: 'srv-hero-garantia' }, [ico(g[0]), g[1]]);
        })),
      ]),
      cfg().videoExplicativo
        ? el('button', { class: 'srv-video-hero', type: 'button', 'aria-label': 'Assistir: como funciona a Loja do Ligeiro', onclick: function () { tocarVideo(midia('v', cfg().videoExplicativo), 'Como funciona a Loja do Ligeiro'); } }, [
          el('img', { src: midia('c', cfg().videoExplicativo), alt: '' }), el('span', { class: 'srv-tocar' }, [ico('tocar')]), el('span', { class: 'srv-legenda', text: 'Como funciona a Loja do Ligeiro' })])
        : el('img', { class: 'srv-hero-mascote', src: 'img/mascote.webp', alt: '', width: '124', height: '124' }),
    ]);
    var secao = el('section', { class: 'secao srv-secao srv-secao-loja' }, [
      hero,
      el('div', { class: 'srv-titulo-linha srv-antes-titulo' }, [el('h2', { class: 'srv-h2', text: 'Escolha o serviço' }), el('span', { class: 'srv-peq', text: 'Pagamento único' })]),
      el('div', { class: 'srv-produtos' }, catalogo().map(function (s) { return cartaoServico(slug, s); })),
    ].concat([
      el('h2', { class: 'srv-h2 srv-antes-titulo', text: 'Como funciona' }),
      passos(),
      el('div', { class: 'srv-fim-loja' }, [
        linhaLink(rota(slug, 'meus'), 'lista', 'Meus serviços', 'Acompanhe suas compras'),
        linhaLink(rota(slug, 'videos'), 'video', 'Vídeos da loja', 'Escolha o vídeo do site'),
      ]),
      cartaoDuvida(),
      el('a', { class: 'srv-termos-link', href: rota(slug, 'termos') }, 'Termos da Loja do Ligeiro'),
    ]));
    raiz.appendChild(topo('Serviços para a sua loja', 'Loja do Ligeiro', '#/painel/' + slug));
    raiz.appendChild(secao);
    window.scrollTo(0, 0);
  }

  var FAQ = {
    prazo: function (s) { return ['Quanto tempo leva?', 'Até ' + s.dias + ' dias úteis depois que o material chega. Você acompanha tudo em Meus serviços.']; },
    gostar: function (s) { return s.id === 'video' ? ['E se eu não gostar?', 'Antes de produzir, você aprova o roteiro e os textos do vídeo. Por isso ele não tem ajuste depois de pronto.'] : ['E se eu não gostar?', (s.ajustes === 1 ? 'Um ajuste já está' : s.ajustes + ' ajustes já estão') + ' no preço: é só dizer o que mudar em até 7 dias da entrega.']; },
    fora: function (s) { return ['Posso usar fora do Ligeiro?', 'Pode. O que a gente faz é seu: use no Instagram, no WhatsApp, na sacola e onde quiser.']; },
    desistir: function () { return ['E se eu desistir?', 'Antes de a produção começar, a gente devolve tudo. Depois, vale o que está nos termos.']; },
  };
  function telaItem(raiz, slug, s, u) {
    UI.limpar(raiz);
    document.title = s.nome + ' · Loja do Ligeiro';
    var vitrine = null;
    if (s.id === 'video') {
      vitrine = el('div', { class: 'srv-vitrine srv-grad' }, [
        el('button', { class: 'srv-vitrine-video', type: 'button', 'aria-label': 'Assistir o exemplo', onclick: function () { tocarVideo('midia/comercial-ligeiro.mp4', 'Exemplo de vídeo'); } }, [el('img', { src: 'img/loja-ligeiro/exemplo-video.webp', alt: '' }), el('span', { class: 'srv-tocar' }, [ico('tocar')])]),
        el('span', { class: 'srv-vitrine-legenda', text: 'Exemplo: o comercial do próprio Ligeiro' }),
      ]);
    } else if (s.premium) vitrine = el('div', { class: 'srv-vitrine srv-grad' }, [comparar()]);
    var lista = function (itens, icone) { return el('ul', { class: 'srv-lista' }, itens.map(function (t) { return el('li', {}, [ico(icone), el('span', { text: t })]); })); };
    var secao = el('section', { class: 'secao srv-secao' }, [
      vitrine,
      el('div', { class: 'srv-item-cabeca' }, [
        vitrine ? null : el('div', { class: 'srv-ico-tile srv-ico-grande' }, [ico(s.icone)]),
        el('h2', { class: 'srv-item-titulo', text: s.nome }),
        el('p', { class: 'srv-txt', text: s.resumo }),
      ]),
      el('div', { class: 'srv-item-preco' }, [el('strong', { text: reais(s.valor) }), el('span', { class: 'srv-peq', text: 'pagamento único, ' + s.sub })]),
      chipsDo(s),
      el('div', { class: 'srv-cartao srv-bloco' }, [el('h3', { class: 'srv-h3', text: 'O que vem' }), lista(s.inclui, 'check')]),
      el('div', { class: 'srv-cartao srv-bloco' }, [el('h3', { class: 'srv-h3', text: 'O que a gente precisa de você' }), lista(s.precisa, 'seta')]),
      el('h2', { class: 'srv-h2 srv-antes-titulo', text: 'Perguntas' }),
    ].concat([FAQ.prazo(s), FAQ.gostar(s), FAQ.desistir(s), FAQ.fora(s)].map(function (f) { return el('div', { class: 'srv-cartao srv-faq' }, [el('strong', { text: f[0] }), el('span', { class: 'srv-peq', text: f[1] })]); })));
    var barra = el('div', { class: 'srv-barra-compra' }, [
      el('div', { class: 'srv-barra-preco' }, [el('strong', { text: reais(s.valor) }), el('span', { text: 'Pix, cartão ou boleto' })]),
      el('button', { class: 'btn srv-btn-grande', type: 'button', onclick: function () { comprar(slug, s, u); } }, 'Comprar'),
    ]);
    raiz.appendChild(topo('Loja do Ligeiro', s.nome, rota(slug)));
    raiz.appendChild(secao);
    raiz.appendChild(barra);
    window.scrollTo(0, 0);
  }

  var CHAVE_WHATS = 'ligeiro:servicos-whats';
  function comprar(slug, s, u) {
    var whats = el('input', { id: 'srvWhats', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '20', placeholder: '(13) 99999-0000', value: UI.lerLocal(CHAVE_WHATS) || '' });
    var docCampo = el('div', { class: 'srv-campo', hidden: true }, [el('label', { for: 'srvDoc', text: 'CPF ou CNPJ de quem paga' }), el('input', { id: 'srvDoc', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '18', placeholder: 'Só números' }), el('span', { class: 'srv-peq', text: 'O Asaas pede uma vez só, para emitir a cobrança.' })]);
    var aceite = el('input', { id: 'srvTermos', type: 'checkbox' });
    var erro = el('p', { class: 'srv-erro', role: 'alert', hidden: true });
    var corpo = el('div', { class: 'srv srv-compra' }, [
      el('div', { class: 'srv-resumo' }, [el('div', { class: 'srv-ico-tile' }, [ico(s.icone)]), el('div', { class: 'srv-linha-texto' }, [el('strong', { text: s.nome }), el('span', { class: 'srv-peq', text: 'Pronto em até ' + s.dias + ' dias úteis' })]), el('strong', { class: 'srv-resumo-valor', text: reais(s.valor) })]),
      el('div', { class: 'srv-campo' }, [el('label', { for: 'srvWhats', text: 'WhatsApp para combinar o material' }), whats]),
      docCampo,
      el('label', { class: 'srv-aceite', for: 'srvTermos' }, [aceite, el('span', {}, ['Li e aceito os ', el('a', { href: rota(slug, 'termos'), target: '_blank', rel: 'noopener', text: 'termos da Loja do Ligeiro' }), '.'])]),
      el('div', { class: 'srv-aviso' }, [ico('escudo'), el('span', { text: 'Você paga na página segura do Asaas, por Pix, cartão ou boleto. Não precisa mandar comprovante: o pagamento confirma sozinho e a gente chama você nesse WhatsApp.' })]),
      erro,
    ]);
    var botao = el('button', { class: 'btn btn-principal', type: 'button', style: { flex: '1' } }, [ico('cadeado'), 'Ir para o pagamento']);
    UI.abrirModal({ titulo: 'Confirmar compra', sub: 'Confira antes de ir para o pagamento.', corpo: corpo, rodape: [botao] });
    var mostrarErro = function (t) { erro.textContent = t; erro.hidden = false; };
    botao.addEventListener('click', function () {
      erro.hidden = true;
      var numero = whats.value.replace(/\D/g, '');
      if (!/^[1-9]\d{9,10}$/.test(numero)) { mostrarErro('Confira o WhatsApp, com o DDD.'); whats.focus(); return; }
      if (!aceite.checked) { mostrarErro('Para continuar, leia e aceite os termos.'); return; }
      var doc = docCampo.hidden ? '' : $doc().value.replace(/\D/g, '');
      if (!docCampo.hidden && !/^(\d{11}|\d{14})$/.test(doc)) { mostrarErro('Digite o CPF (11 números) ou o CNPJ (14 números).'); return; }
      UI.guardarLocal(CHAVE_WHATS, whats.value);
      botao.disabled = true;
      api('comprar', { loja: slug, servico: s.id, whatsapp: numero, termos: cfg().termos, documento: doc || undefined }).then(function (r) {
        UI.fecharModal();
        try { sessionStorage.setItem('ligeiro:servico-novo', r.pedido.id); } catch (_) { /* segue */ }
        /* volta do Asaas cai em Meus servicos (o endereco desta aba ja e o de la) */
        /* com o link: a aba vai para o Asaas e, na volta, cai em Meus servicos; sem ele (demonstracao), abre Meus servicos ja */
        if (/^https:\/\//.test(String(r.link || ''))) { window.LigeiroApp.substituir('servicos/' + slug + '/meus'); window.location.href = r.link; }
        else window.LigeiroApp.trocar('servicos/' + slug + '/meus');
      }).catch(function (e) {
        botao.disabled = false;
        if (e.dados && e.dados.precisaDocumento) { docCampo.hidden = false; mostrarErro(e.message); $doc().focus(); return; }
        mostrarErro(e.message || 'Não deu agora. Tente de novo em instantes.');
      });
    });
    function $doc() { return document.getElementById('srvDoc'); }
  }

  var ROTULOS = {
    aguardando_pagamento: ['Falta pagar', 'srv-st-voce'], material: ['Falta o material', 'srv-st-voce'], producao: ['Em produção', 'srv-st-producao'],
    entregue: ['Pronto', 'srv-st-pronto'], reembolsado: ['Reembolsado', 'srv-st-neutro'], cancelado: ['Link vencido', 'srv-st-neutro'], contestado: ['Contestado', 'srv-st-neutro'],
  };
  function etapas(p) {
    var ordem = ['pago', 'material', 'producao', 'pronto'];
    var agora = { aguardando_pagamento: 0, material: 1, producao: 2, entregue: 4 }[p.status];
    if (agora === undefined) return null;
    var nomes = ['Pagamento', 'Material', 'Produção', 'Pronto'];
    return el('div', { class: 'srv-etapas', 'aria-label': 'Andamento: etapa ' + Math.min(4, agora + 1) + ' de 4' }, ordem.map(function (_, i) {
      var cls = i < agora ? 'feita' : (i === agora ? 'agora' : '');
      return el('div', { class: 'srv-etapa ' + cls }, [el('span', { class: 'srv-bola' }, i < agora ? [ico('check')] : []), nomes[i]]);
    }));
  }
  function cartaoPedido(slug, p, novo) {
    var s = servico(p.servico) || { icone: 'loja', ajustes: 0 };
    var rot = ROTULOS[p.status] || [p.status, 'srv-st-neutro'];
    var titulo = p.titulo && p.servico === 'video' ? p.titulo : p.nome;
    var sub = p.servico === 'video' && p.titulo ? 'Vídeo, ' : '';
    if (p.status === 'aguardando_pagamento') sub += 'pedido em ' + diaMes(p.criadoEm);
    else if (p.status === 'entregue') sub += 'entregue em ' + diaMes(p.entregueEm);
    else if (p.pagoEm) sub += 'pago em ' + diaMes(p.pagoEm);
    else sub += 'pedido em ' + diaMes(p.criadoEm);
    var texto = null, acoes = null;
    var zap = function (msg, rotulo) { var l = whatsSuporte(msg); return l ? el('a', { class: 'btn srv-btn btn-whats btn-largo', href: l, target: '_blank', rel: 'noopener' }, [ico('telefone'), rotulo]) : null; };
    if (p.status === 'aguardando_pagamento') {
      texto = (p.venceEm ? 'O link de pagamento vale até ' + diaMes(p.venceEm) : 'O link de pagamento vale 3 dias') + '. Assim que pagar, este pedido muda sozinho.';
      acoes = /^https:\/\//.test(String(p.link || '')) ? el('a', { class: 'btn srv-btn btn-largo', href: p.link }, [ico('cadeado'), 'Pagar agora']) : null;
    } else if (p.status === 'material') {
      texto = 'A gente chama você no WhatsApp. Se preferir, mande o material agora.';
      acoes = zap('Oi! Vou mandar o material do pedido ' + p.nome + ' da loja ' + (p.lojaNome || slug) + '.', 'Mandar pelo WhatsApp');
    } else if (p.status === 'producao') {
      texto = 'Fica pronto até ' + diaMes(p.prazoAte) + '. A gente avisa por e-mail.';
    } else if (p.status === 'entregue') {
      var dias = (Date.now() - Date.parse(p.entregueEm || 0)) / 864e5;
      if (p.servico === 'video') { texto = 'Está em Vídeos da loja.'; acoes = el('a', { class: 'btn srv-btn btn-fantasma btn-largo', href: rota(slug, 'videos') }, [ico('video'), 'Ver vídeos']); }
      else if (s.ajustes > 0 && dias <= 7) { texto = 'Quer mudar algo? O ajuste já está pago (até ' + diaMes(new Date(Date.parse(p.entregueEm) + 7 * 864e5).toISOString()) + ').'; acoes = zap('Oi! Quero pedir um ajuste no ' + p.nome + ' da loja ' + (p.lojaNome || slug) + '.', 'Pedir ajuste'); }
      else texto = 'Entregue. Os arquivos foram pelo WhatsApp.';
    } else if (p.status === 'reembolsado') texto = 'Devolvemos ' + reais(p.reembolso && p.reembolso.valor) + '. ' + ((p.reembolso && p.reembolso.motivo) || '');
    else if (p.status === 'cancelado') texto = 'O link de pagamento venceu sem pagamento. Se ainda quiser, peça de novo.';
    else if (p.status === 'contestado') texto = 'O pagamento foi contestado no cartão. Fale com a gente pelo WhatsApp.';
    return el('article', { class: 'srv-cartao srv-pedido' + (novo ? ' srv-novo-destaque' : ''), id: 'srv-' + p.id }, [
      el('div', { class: 'srv-pedido-cabeca' }, [el('div', { class: 'srv-ico-tile' }, [ico(s.icone)]), el('div', { class: 'srv-linha-texto' }, [el('h2', { class: 'srv-h3', text: titulo }), el('span', { class: 'srv-meta', text: sub }), el('span', { class: 'srv-status srv-status-baixo ' + rot[1] }, [p.status === 'entregue' ? el('span', { class: 'srv-ponto' }) : null, rot[0]])])]),
      etapas(p),
      texto ? el('p', { class: 'srv-peq srv-texto-escuro', text: texto }) : null,
      acoes,
    ]);
  }
  function telaMeus(raiz, slug, paradas) {
    UI.limpar(raiz);
    document.title = 'Meus serviços · Loja do Ligeiro';
    var secao = el('section', { class: 'secao srv-secao' });
    raiz.appendChild(topo('Loja do Ligeiro', 'Meus serviços', rota(slug)));
    raiz.appendChild(secao);
    carregando(secao, 'Buscando os seus serviços…');
    var novo = ''; try { novo = sessionStorage.getItem('ligeiro:servico-novo') || ''; sessionStorage.removeItem('ligeiro:servico-novo'); } catch (_) { novo = ''; }
    var avisou = false, relogio = null, voltas = 0;
    function desenhar() {
      return api('meus', { loja: slug }).then(function (r) {
        if (!secao.isConnected) return;
        UI.limpar(secao);
        var pedidos = r.pedidos || [];
        if (!pedidos.length) { secao.appendChild(el('div', { class: 'srv-cartao srv-vazio-cartao' }, [el('strong', { text: 'Nenhum serviço ainda' }), el('span', { class: 'srv-peq', text: 'O que você comprar na Loja do Ligeiro aparece aqui, com o andamento.' })])); secao.appendChild(el('a', { class: 'btn srv-btn btn-largo', href: rota(slug) }, 'Ver os serviços')); return; }
        pedidos.forEach(function (p) { secao.appendChild(cartaoPedido(slug, p, p.id === novo)); });
        if (novo && !avisou) {
          avisou = true;
          var p0 = pedidos.filter(function (p) { return p.id === novo; })[0];
          if (p0) { UI.avisar(p0.status === 'aguardando_pagamento' ? 'Pedido feito. Assim que o pagamento cair, ele muda aqui sozinho.' : 'Pagamento confirmado.'); var alvo = document.getElementById('srv-' + novo); if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ block: 'center' }); }
        }
        /* pedido esperando pagamento: confere de novo a cada 20 s por 10 min (1 leitura do KV, nada no banco) */
        clearTimeout(relogio);
        if (pedidos.some(function (p) { return p.status === 'aguardando_pagamento'; }) && voltas++ < 30) relogio = setTimeout(function () { if (!document.hidden) desenhar(); else relogio = setTimeout(desenhar, 20000); }, 20000);
      }).catch(function (e) { mensagemTela(secao, 'Não abriu agora', e.message || 'Tente de novo em instantes.', el('button', { class: 'btn srv-btn btn-fantasma', type: 'button', onclick: desenhar }, 'Tentar de novo')); });
    }
    /* voltou para a aba (do app do banco, do Asaas): confere na hora */
    var aoVoltar = function () { if (!document.hidden && secao.isConnected) { clearTimeout(relogio); desenhar(); } };
    document.addEventListener('visibilitychange', aoVoltar);
    paradas.push(function () { clearTimeout(relogio); document.removeEventListener('visibilitychange', aoVoltar); });
    desenhar();
  }

  function telaVideos(raiz, slug) {
    UI.limpar(raiz);
    document.title = 'Vídeos da loja';
    var secao = el('section', { class: 'secao srv-secao' });
    raiz.appendChild(topo('Minha loja', 'Vídeos da loja', rota(slug)));
    raiz.appendChild(secao);
    carregando(secao, 'Buscando os vídeos da loja…');
    var estado = null;
    function mudar(video) {
      return api('video', { loja: slug, video: video }).then(function (r) { estado.noSite = r.noSite; desenhar(); UI.avisar(r.noSite ? 'Pronto: o site da loja já mostra esse vídeo.' : 'Pronto: o site da loja está sem vídeo agora.'); }).catch(function (e) { UI.avisar(e.message); });
    }
    function apagar(v) {
      UI.perguntar('Apagar o vídeo "' + v.titulo + '"? Ele sai daqui e do site. Baixe antes se quiser guardar.', { titulo: 'Apagar vídeo', sim: 'Apagar', perigo: true }).then(function (sim) {
        if (!sim) return;
        api('apagar-video', { loja: slug, video: v.id }).then(function (r) { estado.videos = r.videos; estado.noSite = r.noSite; desenhar(); UI.avisar('Vídeo apagado.'); }).catch(function (e) { UI.avisar(e.message); });
      });
    }
    function desenhar() {
      UI.limpar(secao);
      var videos = estado.videos || [];
      secao.appendChild(el('p', { class: 'srv-txt', text: 'Um vídeo por vez aparece no site da loja, logo abaixo do botão de pedir. O cliente assiste sem sair da página.' }));
      if (!videos.length) {
        secao.appendChild(el('div', { class: 'srv-cartao srv-vazio-cartao' }, [el('strong', { text: 'Nenhum vídeo ainda' }), el('span', { class: 'srv-peq', text: 'O vídeo promocional que você comprar aparece aqui, pronto para pôr no site.' })]));
        secao.appendChild(el('a', { class: 'btn srv-btn btn-largo', href: rota(slug, 'item/video') }, 'Ver o vídeo promocional'));
        return;
      }
      var sel = videos.filter(function (v) { return v.id === estado.noSite; })[0];
      secao.appendChild(el('h2', { class: 'srv-h2 srv-antes-titulo', text: 'No site agora' }));
      if (sel) {
        secao.appendChild(el('article', { class: 'srv-cartao srv-no-site' }, [
          el('button', { class: 'srv-poster-botao', type: 'button', 'aria-label': 'Assistir ' + sel.titulo, onclick: function () { tocarVideo(midia('v', sel.id), sel.titulo); } }, [capaDeVideo(sel, 'grande')]),
          el('div', { class: 'srv-no-site-texto' }, [
            el('h3', { class: 'srv-h3', text: sel.titulo }),
            el('span', { class: 'srv-meta', text: (sel.dur ? sel.dur + ' segundos, ' : '') + 'entregue em ' + diaMes(sel.em) }),
            el('span', { class: 'srv-status srv-st-pronto' }, [el('span', { class: 'srv-ponto' }), 'No site agora']),
            el('div', { class: 'srv-no-site-acoes' }, [
              el('a', { class: 'btn srv-btn-p btn-fantasma', href: midia('v', sel.id), target: '_blank', rel: 'noopener', download: '' }, [ico('baixar'), 'Baixar']),
              el('button', { class: 'btn srv-btn-p btn-fantasma', type: 'button', onclick: function () { mudar(null); } }, 'Tirar do site'),
            ]),
          ]),
        ]));
      } else secao.appendChild(el('div', { class: 'srv-cartao srv-vazio-cartao' }, [el('strong', { text: 'Nenhum vídeo no site agora' }), el('span', { class: 'srv-peq', text: 'Escolha um da lista abaixo.' })]));
      var outros = videos.filter(function (v) { return v.id !== estado.noSite; });
      if (outros.length) {
        var mostrarTodos = outros.length <= 5 || estado.todos;
        secao.appendChild(el('div', { class: 'srv-titulo-linha srv-antes-titulo' }, [el('h2', { class: 'srv-h2', text: 'Outros vídeos' }), el('span', { class: 'srv-peq', text: videos.length + ' de ' + (estado.maxVideos || 10) })]));
        secao.appendChild(el('div', { class: 'srv-cartao srv-lista-videos' }, (mostrarTodos ? outros : outros.slice(0, 5)).map(function (v) {
          return el('div', { class: 'srv-linha-video' }, [
            el('button', { class: 'srv-poster-botao', type: 'button', 'aria-label': 'Assistir ' + v.titulo, onclick: function () { tocarVideo(midia('v', v.id), v.titulo); } }, [capaDeVideo(v, 'mini')]),
            el('div', { class: 'srv-linha-texto' }, [
              el('strong', { text: v.titulo }), el('span', { class: 'srv-meta', text: (v.dur ? v.dur + ' segundos, ' : '') + 'entregue em ' + diaMes(v.em) }),
              el('div', { class: 'srv-linha-video-acoes' }, [
                el('button', { class: 'btn srv-btn-p', type: 'button', onclick: function () { mudar(v.id); } }, 'Pôr no site'),
                el('button', { class: 'srv-icone-botao', type: 'button', 'aria-label': 'Apagar ' + v.titulo, onclick: function () { apagar(v); } }, [ico('lixeira')]),
              ]),
            ]),
          ]);
        })));
        if (!mostrarTodos) secao.appendChild(el('button', { class: 'btn srv-btn btn-fantasma btn-largo', type: 'button', onclick: function () { estado.todos = true; desenhar(); } }, 'Ver todos os ' + outros.length));
      }
      secao.appendChild(el('span', { class: 'srv-atendimento srv-nota' }, [ico('info'), 'Cabem até ' + (estado.maxVideos || 10) + ' vídeos. Para liberar espaço, baixe e apague os antigos.']));
      secao.appendChild(linhaLink(rota(slug), 'loja', 'Quer outro vídeo?', 'Peça na Loja do Ligeiro'));
    }
    api('meus', { loja: slug }).then(function (r) { if (!secao.isConnected) return; estado = { videos: r.videos || [], noSite: r.noSite, maxVideos: r.maxVideos }; desenhar(); })
      .catch(function (e) { mensagemTela(secao, 'Não abriu agora', e.message || 'Tente de novo em instantes.'); });
  }

  function telaTermos(raiz, slug) {
    UI.limpar(raiz);
    document.title = 'Termos da Loja do Ligeiro';
    var blocos = [
      ['O que é', 'A Loja do Ligeiro vende serviços de criação para as lojas que usam o Ligeiro: melhoria das fotos do cardápio, logo, vídeo promocional e design exclusivo do site. Estes termos completam os Termos de uso do Ligeiro.'],
      ['Preço e pagamento', 'O preço aparece antes da compra e é fechado, em pagamento único. Você paga na página do Asaas, por Pix, cartão ou boleto. O link vale 3 dias; depois disso o pedido é cancelado sozinho, sem custo. O pagamento confirma sem precisar de comprovante.'],
      ['Prazo', 'O prazo é contado em dias úteis a partir do dia em que o material completo chega (fotos, logo antiga, ideias). Enquanto o material não chega, o prazo não corre. Se o material não chegar em 30 dias, combinamos com você: produzimos com o que houver ou devolvemos o valor.'],
      ['Ajustes', 'Fotos do cardápio têm 1 ajuste; logo e design exclusivo têm 2. Ajuste é mudar o que foi entregue, não começar um trabalho novo, e vale para pedidos feitos em até 7 dias depois da entrega. O vídeo promocional não tem ajuste: antes de produzir, você aprova o roteiro e os textos.'],
      ['Desistência e reembolso', 'Antes de a produção começar, você pode desistir e recebe o valor inteiro de volta. Depois que a produção começa, não há reembolso, a não ser que o Ligeiro não entregue no prazo: aí devolvemos o valor inteiro ou a parte que couber. O reembolso volta pelo Asaas: no Pix, para a conta de quem pagou; no cartão, como estorno na fatura. Contestar no cartão uma compra entregue suspende novos pedidos.'],
      ['Seu material e seus direitos', 'Você garante que pode usar as fotos, marcas e textos que nos manda. O resultado entregue é seu: use onde quiser. A música dos vídeos é liberada para redes sociais. O Ligeiro pode mostrar o trabalho como exemplo, a não ser que você peça para não mostrar.'],
      ['Vídeos no site', 'Guardamos até 10 vídeos por loja enquanto a conta estiver ativa, e você escolhe qual aparece no site. Baixe uma cópia dos que quiser guardar. Se a conta for encerrada, os vídeos são apagados depois de 90 dias.'],
      ['Atendimento', (cfg().atendimento || 'Atendimento de segunda a sexta') + ', pelo WhatsApp do suporte. Vale a versão destes termos aceita na compra (versão de ' + String(cfg().termos || '').split('-').reverse().join('/') + ').'],
    ];
    /* o mesmo desenho dos Termos de uso do site (documento corrido: titulo, versao e secoes), so com a barra de voltar */
    var e = geral().empresa || {};
    var versao = String(cfg().termos || '').split('-').reverse().join('/');
    var corpo = el('div', { class: 'conteudo texto-legal' }, [
      el('h1', { text: 'Termos da Loja do Ligeiro' }),
      el('p', { class: 'muted', text: 'Versão de ' + versao + '. Escrito em português de gente, sem juridiquês. Se algo não estiver claro, chame a gente' + (e.email ? ' em ' + e.email : '') + '.' }),
    ]);
    blocos.forEach(function (b) { corpo.appendChild(el('h2', { text: b[0] })); corpo.appendChild(el('p', { text: b[1] })); });
    raiz.appendChild(topo('Loja do Ligeiro', 'Termos', rota(slug)));
    raiz.appendChild(corpo);
    window.scrollTo(0, 0);
  }

  /* ---------- Central (aba Loja do Ligeiro) ---------- */
  var COLUNAS = [['Esperando pagamento', ['aguardando_pagamento']], ['Esperando material', ['material']], ['Em produção', ['producao']], ['Entregues', ['entregue', 'reembolsado', 'contestado']]];
  function central(alvo, lojas) {
    carregando(alvo, 'Buscando os pedidos da loja…');
    var todos = [], recursos = D.modoDemo ? ['fora'] : [];
    function desenhar() {
      UI.limpar(alvo);
      var pagos = todos.filter(function (p) { return ['material', 'producao', 'entregue'].indexOf(p.status) >= 0 && String(p.pagoEm || '').slice(0, 7) === new Date().toISOString().slice(0, 7); });
      var vendido = pagos.reduce(function (s, p) { return s + (Number(p.valor) || 0) - (Number(p.reembolso && p.reembolso.valor) || 0); }, 0);
      var semana = todos.filter(function (p) { return p.status === 'producao' && p.prazoAte && Date.parse(p.prazoAte) - Date.now() < 7 * 864e5; }).length;
      alvo.appendChild(el('div', { class: 'srv srv-central' }, [
        el('div', { class: 'srv-central-cabeca' }, [
          el('div', {}, [el('h2', { text: 'Loja do Ligeiro' }), el('p', { text: 'Serviços que as lojas compraram. O pagamento já chega confirmado pelo Asaas; você leva cada um até Entregue.' })]),
          el('div', { class: 'srv-central-botoes' }, [
            el('button', { class: 'btn srv-btn btn-fantasma', type: 'button', onclick: function () { enviarVideo(); } }, [ico('subir'), 'Enviar vídeo']),
            el('button', { class: 'btn srv-btn btn-fantasma', type: 'button', onclick: function () { criar(); } }, [ico('telefone'), 'Pedido do WhatsApp']),
            el('button', { class: 'btn srv-btn btn-fantasma', type: 'button', onclick: carregar }, [ico('atualizar'), 'Atualizar']),
          ]),
        ]),
        el('div', { class: 'srv-kpis' }, [
          ['Para fazer', todos.filter(function (p) { return p.status === 'material' || p.status === 'producao'; }).length],
          ['Vencem em até 7 dias', semana], ['Pagos este mês', pagos.length], ['Vendido este mês', reais(vendido)],
        ].map(function (k) { return el('div', { class: 'srv-kpi' }, [el('span', { class: 'srv-kpi-rotulo', text: k[0] }), el('span', { class: 'srv-kpi-valor', text: String(k[1]) })]); })),
        el('div', { class: 'srv-quadro' }, COLUNAS.map(function (c) {
          var itens = todos.filter(function (p) { return c[1].indexOf(p.status) >= 0; });
          return el('div', { class: 'srv-coluna' }, [el('div', { class: 'srv-coluna-cabeca' }, [el('h3', { text: c[0] }), el('span', { class: 'srv-qtd', text: String(itens.length) })])].concat(itens.length ? itens.slice(0, 40).map(cartaoCentral) : [el('p', { class: 'srv-peq srv-coluna-vazia', text: 'Nada aqui.' })]));
        })),
      ]));
    }
    function cartaoCentral(p) {
      var s = servico(p.servico) || { icone: 'loja' };
      var zap = /^\d{10,11}$/.test(String(p.whatsapp || '')) ? el('a', { class: 'btn srv-btn-p btn-whats srv-btn-icone', href: 'https://wa.me/55' + p.whatsapp, target: '_blank', rel: 'noopener', 'aria-label': 'Chamar a loja no WhatsApp' }, [ico('telefone')]) : null;
      var acao = null;
      if (p.status === 'aguardando_pagamento') acao = el('button', { class: 'btn srv-btn-p btn-fantasma', type: 'button', onclick: function () { UI.copiar(p.link || '').then(function (ok) { UI.avisar(ok ? 'Link de pagamento copiado. Mande no WhatsApp da loja.' : 'Não copiou.'); }); } }, [ico('copiar'), 'Copiar link']);
      else if (p.status === 'material') acao = el('button', { class: 'btn srv-btn-p btn-fantasma', type: 'button', onclick: function () { acaoCentral('etapa', { id: p.id }, 'Material recebido. O prazo começou.'); } }, [ico('check'), 'Material chegou']);
      else if (p.status === 'producao') acao = el('button', { class: 'btn srv-btn-p', type: 'button', onclick: function () { entregar(p); } }, [ico(p.servico === 'video' ? 'subir' : 'check'), p.servico === 'video' ? 'Entregar vídeo' : 'Marcar entregue']);
      var rot = ROTULOS[p.status] || [p.status, 'srv-st-neutro'];
      var linhaStatus = p.status === 'producao' ? 'Entregar até ' + diaMes(p.prazoAte) : p.status === 'aguardando_pagamento' ? 'Link vale até ' + diaMes(p.venceEm) : p.status === 'entregue' ? 'Entregue em ' + diaMes(p.entregueEm) : rot[0];
      var podeReembolsar = ['material', 'producao', 'entregue'].indexOf(p.status) >= 0 && Number(p.valor) > 0;
      return el('article', { class: 'srv-pserv' }, [
        el('div', { class: 'srv-pserv-cabeca' }, [el('div', { class: 'srv-ico-tile srv-ico-p' }, [ico(s.icone)]), el('div', { class: 'srv-linha-texto' }, [el('strong', { class: 'srv-pserv-nome', text: p.servico === 'video' && p.titulo ? 'Vídeo: ' + p.titulo : p.nome }), el('span', { class: 'srv-meta', text: p.lojaNome || p.loja })]), el('strong', { class: 'srv-pserv-valor', text: reais(p.valor) })]),
        el('span', { class: 'srv-status ' + rot[1] }, linhaStatus),
        zap || acao ? el('div', { class: 'srv-pserv-acoes' }, [zap, acao]) : null,
        el('div', { class: 'srv-pserv-pe' }, [el('span', { text: (p.forma ? ({ PIX: 'Pix', CREDIT_CARD: 'Cartão', BOLETO: 'Boleto', FORA: 'Combinado por fora' }[p.forma] || p.forma) + ', ' + diaMes(p.pagoEm) : 'Pedido em ' + diaMes(p.criadoEm)) + (p.origem === 'whatsapp' ? ', pelo WhatsApp' : '') }), podeReembolsar ? el('button', { class: 'srv-link-reembolso', type: 'button', onclick: function () { reembolsar(p); } }, 'Reembolsar') : (p.reembolso ? el('span', { text: 'Devolvido ' + reais(p.reembolso.valor) }) : null)]),
      ]);
    }
    function acaoCentral(rotaApi, corpo, ok) {
      return api(rotaApi, corpo).then(function () { UI.avisar(ok); UI.fecharModal(); return carregar(); }).catch(function (e) { UI.avisar(e.message); throw e; });
    }
    function criar() {
      var selLoja = el('select', { id: 'srvCriarLoja' }, [el('option', { value: '', text: 'Escolha a loja' })].concat((lojas || []).map(function (l) { return el('option', { value: l.slug, text: l.nome + (l.cidade ? ', ' + l.cidade : '') }); })));
      var selServ = el('select', { id: 'srvCriarServ' }, catalogo().map(function (s) { return el('option', { value: s.id, text: s.nome + ' (' + reais(s.valor) + ')' }); }));
      var whats = el('input', { id: 'srvCriarWhats', type: 'tel', inputmode: 'tel', placeholder: '(13) 99999-0000' });
      var doc = el('input', { id: 'srvCriarDoc', type: 'text', inputmode: 'numeric', placeholder: 'Só se o Asaas pedir' });
      var erro = el('p', { class: 'srv-erro', role: 'alert', hidden: true });
      var botao = el('button', { class: 'btn btn-principal', type: 'button', style: { flex: '1' } }, [ico('link'), 'Gerar link de pagamento']);
      UI.abrirModal({ titulo: 'Pedido do WhatsApp', sub: 'Gera o link do Asaas para você mandar para a loja.', centro: true, corpo: el('div', { class: 'srv srv-form' }, [
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvCriarLoja', text: 'Loja' }), selLoja]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvCriarServ', text: 'Serviço' }), selServ]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvCriarWhats', text: 'WhatsApp da loja' }), whats]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvCriarDoc', text: 'CPF ou CNPJ de quem paga' }), doc]),
        el('div', { class: 'srv-aviso' }, [ico('info'), el('span', { text: 'A loja aceita os termos ao pagar: mande junto o link ligeiropedidos.com.br/servicos/<loja>/termos.' })]),
        erro,
      ]), rodape: [botao] });
      botao.addEventListener('click', function () {
        erro.hidden = true; botao.disabled = true;
        api('criar', { loja: selLoja.value, servico: selServ.value, whatsapp: whats.value.replace(/\D/g, ''), documento: doc.value.replace(/\D/g, '') || undefined }).then(function (r) {
          return UI.copiar(r.link || '').then(function (ok) { UI.fecharModal(); UI.avisar(ok ? 'Link copiado. Mande no WhatsApp da loja junto com os termos.' : 'Pedido criado. Copie o link no quadro.'); carregar(); });
        }).catch(function (e) { botao.disabled = false; erro.textContent = e.message; erro.hidden = false; });
      });
    }
    function entregar(p) {
      var video = p.servico === 'video';
      var campo = campoVideo('srvArquivo'), arquivo = campo.input;
      var titulo = el('input', { id: 'srvTitulo', type: 'text', maxlength: '60', placeholder: 'Ex.: Promoção de sexta', value: p.titulo || '' });
      var noSite = el('input', { id: 'srvNoSite', type: 'checkbox', checked: true });
      var avisar = el('input', { id: 'srvAvisar', type: 'checkbox', checked: true });
      var info = el('p', { class: 'srv-peq', text: video ? 'Passe o vídeo no comprimir-video.bat antes: ele deixa leve sem perder qualidade.' : 'Mande os arquivos pelo WhatsApp da loja e marque como entregue.' });
      var erro = el('p', { class: 'srv-erro', role: 'alert', hidden: true });
      var botao = el('button', { class: 'btn btn-principal', type: 'button', style: { flex: '1' } }, [ico('check'), video ? 'Entregar vídeo' : 'Marcar entregue']);
      var toggle = function (input, t, s) { return el('label', { class: 'srv-toggle', for: input.id }, [el('span', { class: 'srv-linha-texto' }, [el('strong', { text: t }), el('span', { class: 'srv-meta', text: s })]), input]); };
      UI.abrirModal({ titulo: video ? 'Entregar vídeo' : 'Entregar ' + p.nome, sub: p.lojaNome, centro: true, corpo: el('div', { class: 'srv srv-form' }, [
        video ? el('div', { class: 'srv-campo' }, [el('span', { class: 'srv-campo-rotulo', text: 'O vídeo' }), campo.caixa]) : null,
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvTitulo', text: video ? 'Nome do vídeo (a loja vê)' : 'Observação (opcional)' }), titulo]),
        video ? toggle(noSite, 'Colocar no site da loja agora', 'O vídeo que estiver no site sai, mas continua em Vídeos da loja.') : null,
        toggle(avisar, 'Avisar a loja por e-mail', 'Vai para o e-mail da conta da loja.'),
        info, erro,
      ]), rodape: [botao] });
      botao.addEventListener('click', function () {
        erro.hidden = true;
        var fim = function (e) { botao.disabled = false; erro.textContent = e.message; erro.hidden = false; };
        if (!video) { botao.disabled = true; acaoCentral('entregar', { id: p.id, titulo: titulo.value, avisar: avisar.checked }, 'Pedido entregue.').catch(fim); return; }
        var f = arquivo.files && arquivo.files[0];
        if (!f) return fim(new Error('Escolha o vídeo.'));
        if (!titulo.value.trim()) return fim(new Error('Dê um nome ao vídeo.'));
        if (f.size > 15 * 1024 * 1024) return fim(new Error('O vídeo tem ' + (f.size / 1048576).toFixed(1) + ' MB. Passe no comprimir-video.bat (fica com uns 3 a 6 MB).'));
        botao.disabled = true; botao.lastChild.textContent = 'Enviando...';
        medirVideoValido(f).then(function (m) { return subirVideo(p.id, f, m); }).then(function (id) {
          return acaoCentral('entregar', { id: p.id, titulo: titulo.value, video: id, noSite: noSite.checked, avisar: avisar.checked }, 'Vídeo entregue.');
        }).catch(function (e) { botao.lastChild.textContent = 'Entregar vídeo'; fim(e); });
      });
    }
    /* video combinado por fora: registra o pedido ja pago (sem Asaas) e entrega na hora, pelo mesmo caminho */
    function enviarVideo() {
      /* mensageiro antigo nao conhece o "combinado por fora" e criaria uma cobranca de verdade: so libera depois de colar o novo */
      if (recursos.indexOf('fora') < 0) { UI.avisar('Cole o mensageiro do Asaas novo (worker-asaas.js) antes de usar o Enviar vídeo.'); return; }
      var selLoja = el('select', { id: 'srvEnvLoja' }, [el('option', { value: '', text: 'Escolha a loja' })].concat((lojas || []).map(function (l) { return el('option', { value: l.slug, text: l.nome + (l.cidade ? ', ' + l.cidade : '') }); })));
      var campo = campoVideo('srvEnvArquivo'), arquivo = campo.input;
      var titulo = el('input', { id: 'srvEnvTitulo', type: 'text', maxlength: '60', placeholder: 'Ex.: Promoção de sexta' });
      var valor = el('input', { id: 'srvEnvValor', type: 'text', inputmode: 'decimal', placeholder: 'Ex.: 149,00 (vazio se foi cortesia)' });
      var noSite = el('input', { id: 'srvEnvNoSite', type: 'checkbox', checked: true });
      var avisar = el('input', { id: 'srvEnvAvisar', type: 'checkbox', checked: true });
      var erro = el('p', { class: 'srv-erro', role: 'alert', hidden: true });
      var botao = el('button', { class: 'btn btn-principal', type: 'button', style: { flex: '1' } }, [ico('subir'), 'Enviar vídeo']);
      var toggle = function (input, t, s) { return el('label', { class: 'srv-toggle', for: input.id }, [el('span', { class: 'srv-linha-texto' }, [el('strong', { text: t }), el('span', { class: 'srv-meta', text: s })]), input]); };
      UI.abrirModal({ titulo: 'Enviar vídeo', sub: 'Para vídeo combinado por fora: não gera cobrança.', centro: true, corpo: el('div', { class: 'srv srv-form' }, [
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvEnvLoja', text: 'Loja' }), selLoja]),
        el('div', { class: 'srv-campo' }, [el('span', { class: 'srv-campo-rotulo', text: 'O vídeo' }), campo.caixa]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvEnvTitulo', text: 'Nome do vídeo (a loja vê)' }), titulo]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvEnvValor', text: 'Valor combinado (opcional)' }), valor]),
        toggle(noSite, 'Colocar no site da loja agora', 'O vídeo que estiver no site sai, mas continua em Vídeos da loja.'),
        toggle(avisar, 'Avisar a loja por e-mail', 'Vai para o e-mail da conta da loja.'),
        el('p', { class: 'srv-peq', text: 'Passe o vídeo no comprimir-video.bat antes: ele deixa leve sem perder qualidade. O valor entra no Vendido do mês.' }),
        erro,
      ]), rodape: [botao] });
      botao.addEventListener('click', function () {
        erro.hidden = true;
        var fim = function (e) { botao.disabled = false; botao.lastChild.textContent = 'Enviar vídeo'; erro.textContent = e.message; erro.hidden = false; };
        var f = arquivo.files && arquivo.files[0];
        var centavos = valor.value.trim() ? Math.round(Number(valor.value.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')) * 100) : 0;
        if (!selLoja.value) return fim(new Error('Escolha a loja.'));
        if (!f) return fim(new Error('Escolha o vídeo.'));
        if (!titulo.value.trim()) return fim(new Error('Dê um nome ao vídeo.'));
        if (!(centavos >= 0 && centavos <= 1000000)) return fim(new Error('Confira o valor (até R$ 10.000,00).'));
        if (f.size > 15 * 1024 * 1024) return fim(new Error('O vídeo tem ' + (f.size / 1048576).toFixed(1) + ' MB. Passe no comprimir-video.bat (fica com uns 2 MB).'));
        botao.disabled = true; botao.lastChild.textContent = 'Enviando...';
        var pedido = null;
        /* confere o arquivo ANTES de registrar o pedido: arquivo errado nao deixa pedido pela metade no quadro */
        medirVideoValido(f).then(function (m) {
          return api('criar', { loja: selLoja.value, servico: 'video', fora: true, valor: centavos }).then(function (r) { pedido = r.pedido; return subirVideo(pedido.id, f, m); });
        }).then(function (id) {
          return acaoCentral('entregar', { id: pedido.id, titulo: titulo.value, video: id, noSite: noSite.checked, avisar: avisar.checked }, 'Vídeo enviado para a loja.');
        }).catch(function (e) {
          if (pedido) { carregar(); fim(new Error(e.message + ' O pedido ficou em Em produção: toque em Entregar vídeo nele para tentar de novo.')); } else fim(e);
        });
      });
    }
    function reembolsar(p) {
      var pago = Number(p.valor) || 0, ja = Number(p.reembolso && p.reembolso.valor) || 0;
      var tudo = el('input', { type: 'radio', name: 'srvQuanto', id: 'srvTudo', checked: true });
      var parte = el('input', { type: 'radio', name: 'srvQuanto', id: 'srvParte' });
      var valor = el('input', { id: 'srvValor', type: 'text', inputmode: 'decimal', placeholder: 'Ex.: 60,00', disabled: true });
      var motivo = el('textarea', { id: 'srvMotivo', maxlength: '300', rows: '3', placeholder: 'A loja vê em Meus serviços' });
      var manual = el('input', { id: 'srvManual', type: 'checkbox' });
      var erro = el('p', { class: 'srv-erro', role: 'alert', hidden: true });
      tudo.addEventListener('change', function () { valor.disabled = true; });
      parte.addEventListener('change', function () { valor.disabled = false; valor.focus(); });
      var botao = el('button', { class: 'btn btn-erro', type: 'button', style: { flex: '1' } }, 'Reembolsar');
      UI.abrirModal({ titulo: 'Reembolsar serviço', sub: p.nome + ', ' + (p.lojaNome || p.loja) + ', pago ' + reais(pago), centro: true, corpo: el('div', { class: 'srv srv-form' }, [
        el('div', { class: 'srv-escolhas', role: 'radiogroup', 'aria-label': 'Quanto devolver' }, [
          el('label', { class: 'srv-escolha', for: 'srvTudo' }, [tudo, el('span', { class: 'srv-linha-texto' }, [el('strong', { text: 'Tudo' }), el('span', { class: 'srv-meta', text: reais(pago - ja) })])]),
          el('label', { class: 'srv-escolha', for: 'srvParte' }, [parte, el('span', { class: 'srv-linha-texto' }, [el('strong', { text: 'Uma parte' }), el('span', { class: 'srv-meta', text: 'Você digita o valor' })])]),
        ]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvValor', text: 'Valor a devolver' }), valor]),
        el('div', { class: 'srv-campo' }, [el('label', { for: 'srvMotivo', text: 'Motivo (a loja vê)' }), motivo]),
        el('label', { class: 'srv-aceite', for: 'srvManual' }, [manual, el('span', { text: 'Já devolvi por fora (boleto ou Pix manual): só registrar' })]),
        el('div', { class: 'srv-aviso srv-aviso-laranja' }, [ico('alerta'), el('span', { text: 'No Pix, o valor volta para a conta de quem pagou; no cartão, aparece como estorno na fatura. Não dá para desfazer.' })]),
        erro,
      ]), rodape: [botao] });
      botao.addEventListener('click', function () {
        erro.hidden = true;
        var centavos = null;
        if (parte.checked) { centavos = Math.round(Number(String(valor.value).replace(/\./g, '').replace(',', '.')) * 100); if (!(centavos > 0 && centavos <= pago - ja)) { erro.textContent = 'Valor inválido: até ' + reais(pago - ja) + '.'; erro.hidden = false; return; } }
        if (motivo.value.trim().length < 5) { erro.textContent = 'Escreva o motivo (a loja vê).'; erro.hidden = false; return; }
        botao.disabled = true;
        acaoCentral('reembolsar', { id: p.id, valor: centavos == null ? undefined : centavos, motivo: motivo.value, manual: manual.checked }, 'Reembolso feito.').catch(function (e) { botao.disabled = false; erro.textContent = e.message; erro.hidden = false; if (e.dados && e.dados.manual) manual.focus(); });
      });
    }
    function carregar() {
      return api('central', {}).then(function (r) { todos = r.pedidos || []; recursos = r.recursos || recursos; if (alvo.isConnected) desenhar(); })
        .catch(function (e) { mensagemTela(alvo, 'A Loja do Ligeiro não abriu', e.message || 'Tente de novo.'); });
    }
    carregar();
  }
  /* area de envio do video (no lugar do "Escolher arquivo" cru do navegador): toca para escolher ou arrasta o arquivo
     em cima; escolhido, mostra o nome e o tamanho */
  function campoVideo(id) {
    var input = el('input', { id: id, class: 'srv-arquivo-input', type: 'file', accept: 'video/mp4' });
    var nome = el('strong', { text: 'Escolher o vídeo' });
    var sub = el('span', { class: 'srv-meta', text: 'MP4 de até 20 segundos e 15 MB' });
    var caixa = el('label', { class: 'srv-arquivo', for: id }, [ico('subir'), el('span', { class: 'srv-linha-texto' }, [nome, sub]), input]);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      caixa.classList.toggle('escolhido', !!f);
      nome.textContent = f ? f.name : 'Escolher o vídeo';
      sub.textContent = f ? (f.size / 1048576).toFixed(1).replace('.', ',') + ' MB. Toque para trocar.' : 'MP4 de até 20 segundos e 15 MB';
    });
    ['dragenter', 'dragover'].forEach(function (ev) { caixa.addEventListener(ev, function (e) { e.preventDefault(); caixa.classList.add('arrastando'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { caixa.addEventListener(ev, function () { caixa.classList.remove('arrastando'); }); });
    caixa.addEventListener('drop', function (e) {
      e.preventDefault();
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs[0]) { try { input.files = fs; } catch (_) { return; } input.dispatchEvent(new Event('change')); }
    });
    return { caixa: caixa, input: input };
  }
  /* o video da entrega: ate 20 s (o mensageiro aceita ate 30; a folga e do arredondamento) */
  function medirVideoValido(f) {
    return medirVideo(f).then(function (m) { if (m.dur > 21) throw new Error('O vídeo tem ' + Math.round(m.dur) + ' segundos. O limite é 20.'); return m; });
  }
  /* sobe o video e a capa de um pedido e devolve o id do video (sem capa o video vai assim mesmo) */
  function subirVideo(pedido, f, m) {
    return subirArquivo(pedido, 'video', f, { dur: m.dur }).then(function (r) {
      return (m.capa ? subirArquivo(pedido, 'capa', m.capa, { id: r.id }).catch(function () { return null; }) : Promise.resolve()).then(function () { return r.id; });
    });
  }
  /* o video escolhido: duracao e a capa (o quadro de 1 s, em JPG), lidos no proprio computador */
  function medirVideo(arquivo) {
    return new Promise(function (ok, falhou) {
      var url = URL.createObjectURL(arquivo);
      var v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
      var pronto = false;
      v.addEventListener('error', function () { URL.revokeObjectURL(url); falhou(new Error('Esse arquivo não abre como vídeo. Use MP4.')); });
      v.addEventListener('loadedmetadata', function () { v.currentTime = Math.min(1, (v.duration || 1) / 2); });
      v.addEventListener('seeked', function () {
        if (pronto) return; pronto = true;
        var dur = v.duration || 0;
        try {
          var c = document.createElement('canvas');
          var escala = Math.min(1, 540 / (v.videoWidth || 540));
          c.width = Math.round((v.videoWidth || 540) * escala); c.height = Math.round((v.videoHeight || 960) * escala);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(function (b) { URL.revokeObjectURL(url); ok({ dur: dur, capa: b }); }, 'image/jpeg', 0.8);
        } catch (_) { URL.revokeObjectURL(url); ok({ dur: dur, capa: null }); }
      });
    });
  }

  window.LigeiroServicos = { abrir: abrir, banner: banner, central: central, visivel: visivel, tocarVideo: tocarVideo };
})();
