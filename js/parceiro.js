/*
 * Ligeiro - paginas de venda e de assinatura.
 *
 *   #/lojas        landing pra dono de lanchonete (o que o Mateus manda no WhatsApp)
 *   #/assinar      escolher o plano (mensal ou anual) e seguir pro cadastro
 *   #/entrar       achar o painel da propria loja
 *   #/termos       termos de uso
 *   #/privacidade  politica de privacidade (LGPD)
 *
 * Estrutura da landing no modelo das startups (Anota AI): topo com Entrar e
 * Assinar, heroi com o preco, teste gratis sem cartao, calculadora, recursos,
 * planos, tudo incluso, antes e depois, raio-x da operacao, prova real,
 * duvidas e chamada final. So que sem numero inventado: a prova e a Dom
 * Conizza rodando de verdade.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var el = UI.el;
  var dinheiro = R.dinheiro;

  function cfg() { return window.LIGEIRO_CONFIG || {}; }
  function D() { return window.LigeiroDados; }
  /* preco que o visitante ve hoje (fundador enquanto houver vaga; depois o normal) */
  function precos() {
    var p = cfg().precos || {};
    return { mensal: R.precoDoPlano('uma', 'mensal'), anual: R.precoDoPlano('uma', 'anual'), diasGratis: p.diasGratis || 7 };
  }
  /* Faixa "preco de fundador": primeira linha da grade de planos. So aparece enquanto existir vaga de verdade. */
  /* vagas de loja cheias: faixa no topo dos planos, com a lista de espera (quem ja e cliente segue normal) */
  function faixaEspera() {
    return el('div', { class: 'fundador espera' }, [
      el('div', { class: 'fundador-lado' }, [
        el('span', { class: 'fundador-selo' }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('ampulheta')]), 'Vagas cheias por enquanto']),
        el('p', { class: 'fundador-texto', text: 'Abrimos vagas aos poucos para o Ligeiro continuar rápido para quem já vende com a gente. Entre na lista e chamamos você na ordem.' }),
      ]),
      el('div', { class: 'fundador-conta' }, [el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Entrar na lista de espera', onclick: function () { abrirContato('lista-espera'); } })]),
    ]);
  }
  function faixaFundador() {
    var restam = R.vagasFundador();
    var total = (cfg().fundador || {}).vagas || 0;
    if (!restam || !total) return null;
    var barra = el('div', { class: 'fundador-barra', role: 'img', 'aria-label': 'Restam ' + restam + ' de ' + total + ' vagas' }, el('i', { style: { width: Math.max(4, Math.round(restam / total * 100)) + '%' } }));
    return el('div', { class: 'fundador' }, [
      el('div', { class: 'fundador-lado' }, [
        el('span', { class: 'fundador-selo' }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), 'Preço de fundador']),
        el('p', { class: 'fundador-texto', text: 'Para as ' + total + ' primeiras lojas. O preço fica travado enquanto você não cancelar.' }),
      ]),
      el('div', { class: 'fundador-conta' }, [
        el('span', { class: 'fundador-vagas' }, [el('span', { class: 'fundador-relogio', 'aria-hidden': 'true' }, [UI.iconeLinha('ampulheta')]), 'Restam ', el('b', { text: String(restam) }), ' de ' + total + ' vagas']),
        barra,
      ]),
    ]);
  }
  function linkWhats(texto) {
    var c = cfg();
    return c.whatsappLigeiro ? R.linkWhatsapp(c.whatsappLigeiro, texto || 'Oi! Quero colocar meu estabelecimento no Ligeiro.') : '';
  }
  /* dinheiro redondo sem centavos: "R$ 79" (e nao "R$ 79,00"); com centavos, igual ao dinheiro() */
  function reais(centavos) { return dinheiro(centavos).replace(/,00$/, ''); }
  function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }

  /* Barra do topo: marca, Entrar e Assinar. Igual em todas as paginas daqui. */
  function barraTopo() {
    /* "Entrar" e o botao da conta tem o mesmo desenho: ao entrar, so a bolinha troca o bonequinho pela inicial */
    var entrar = el('a', { class: 'btn btn-conta btn-entrar', href: '#/entrar' }, [el('span', { class: 'conta-bolinha sem-letra', 'aria-hidden': 'true' }), el('span', { text: 'Entrar' })]);
    /* celular pequeno (ate 360): "Assinar"; o "agora" nao cabe do lado do Entrar */
    var assinar = el('a', { class: 'btn btn-principal btn-pequeno btn-assinar', href: '#/comecar' }, [el('span', { class: 'rot-longo', text: 'Começar grátis' }), el('span', { class: 'rot-curto', text: 'Começar' })]);
    var acoes = el('div', { class: 'barra-acoes' }, [entrar, assinar]);
    var barra = el('div', { class: 'barra-topo' }, [
      el('a', { class: 'marca', href: '#/lojas' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      acoes,
    ]);
    /* logado: "Entrar" vira o botao da conta (bolinha com a inicial + "Minha conta") e "Assinar agora" sai (o plano mora em Minha conta) */
    var bolinha = el('span', { class: 'conta-bolinha', 'aria-hidden': 'true' });
    var conta = el('a', { class: 'btn btn-conta', href: '#/conta', 'aria-label': 'Minha conta' }, [
      bolinha, el('span', { class: 'rot-longo', text: 'Minha conta' }), el('span', { class: 'rot-curto', text: 'Conta' }),
    ]);
    /* inicial do nome (ou do e-mail); sem nome ainda, a bolinha mostra o bonequinho desenhado */
    function inicial(u) {
      var base = String((u && (u.nome || u.email)) || '').trim();
      var letra = base ? base.charAt(0).toUpperCase() : '';
      bolinha.textContent = /[A-Z0-9À-Þ]/.test(letra) ? letra : '';
      bolinha.classList.toggle('sem-letra', !bolinha.textContent);
    }
    inicial(null);
    function comoLogado(sim, u) {
      if (sim) {
        if (entrar.parentNode) entrar.replaceWith(conta); else if (!conta.parentNode) acoes.insertBefore(conta, acoes.firstChild);
        if (assinar.parentNode) assinar.remove();
        if (u) inicial(u);
      } else {
        if (conta.parentNode) conta.replaceWith(entrar);
        if (!assinar.parentNode) acoes.appendChild(assinar);
      }
    }
    var store = D() && D().store;
    /* ja entrou antes neste aparelho: abre direto com a conta, sem piscar "Entrar" */
    if (store && store.pareceLogado && store.pareceLogado()) comoLogado(true);
    /* o Firebase confirma (e traz o nome) ou corrige se a sessao tiver caido */
    if (store && store.usuarioAtual) store.usuarioAtual().then(function (u) { comoLogado(!!u, u); });
    return barra;
  }

  /* ---------- contato: WhatsApp na hora ou "me chama" (vira lista no admin) ---------- */
  function campoSimples(rotulo, opcoes) {
    var o = opcoes || {};
    var input = el('input', { type: o.tipo || 'text', maxlength: o.max || 80, placeholder: o.placeholder || '', inputmode: o.inputmode || null, autocomplete: o.autocomplete || null });
    var b = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [el('label', {}, [rotulo, o.opcional ? el('span', { class: 'opcional', text: 'opcional' }) : null]), input]);
    b.input = input;
    return b;
  }

  /* textos do formulario quando ele e a lista de espera (vagas de loja fechadas) */
  var ESPERA = { titulo: 'Lista de espera', intro: 'Deixe seu WhatsApp. Assim que abrir vaga, a gente chama você, na ordem da lista.', botao: 'Entrar na lista', sucesso: 'Pronto! Você está na lista. A gente chama no WhatsApp quando abrir vaga.' };
  function abrirContato(origem) {
    var c = cfg();
    var espera = origem === 'lista-espera';
    var corpo = el('div', { class: 'pilha contato', style: { paddingTop: '8px' } });
    /* quem atende: o mascote e uma frase do que da para pedir (no lugar de um formulario seco) */
    corpo.appendChild(el('div', { class: 'contato-topo' }, [
      el('span', { class: 'contato-avatar', 'aria-hidden': 'true' }, [el('img', { src: 'img/mascote-192.webp', alt: '', width: '48', height: '48' }), el('span', { class: 'contato-online' })]),
      el('div', { class: 'contato-topo-texto' }, espera ? [
        el('b', { text: 'Vagas de loja fechadas agora' }),
        el('span', { text: ESPERA.intro }),
      ] : [
        el('b', { text: 'Resposta rápida pelo WhatsApp' }),
        el('span', { text: 'Tire dúvidas, veja uma demonstração ou peça ajuda para montar sua loja.' }),
      ]),
    ]));
    if (!espera && c.whatsappLigeiro) {
      corpo.appendChild(el('a', { class: 'btn btn-whats btn-largo', href: linkWhats('Oi! Quero saber mais sobre o Ligeiro para minha loja.'), target: '_blank', rel: 'noopener' }, [el('span', { class: 'icone-zap', 'aria-hidden': 'true' }), 'Chamar no WhatsApp agora']));
      corpo.appendChild(el('div', { class: 'contato-ou', text: 'ou a gente chama você' }));
    }
    var f = {
      nome: campoSimples('Seu nome', { max: 60, autocomplete: 'name' }),
      whatsapp: campoSimples('Seu WhatsApp', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999', autocomplete: 'tel' }),
      loja: campoSimples('Nome da loja', { max: 60, placeholder: 'Ex: Lanchonete do Zé', opcional: true }),
      cidade: window.LigeiroCidades ? window.LigeiroCidades.campo('', '', { rotulo: 'Cidade', placeholder: 'Digite e escolha' }) : campoSimples('Cidade', { max: 60, opcional: true }),
    };
    /* a cidade tambem e opcional (o contato nunca trava por ela) */
    var rotuloCidade = f.cidade.querySelector && f.cidade.querySelector('label');
    if (window.LigeiroCidades && rotuloCidade) rotuloCidade.appendChild(el('span', { class: 'opcional', text: 'opcional' }));
    UI.mascaraTelefone(f.whatsapp.input);
    corpo.appendChild(el('div', { class: 'grade-form' }, [f.nome, f.whatsapp, f.loja, f.cidade]));
    corpo.appendChild(el('p', { class: 'contato-seguro' }, [UI.iconeLinha('cadeado'), 'Seu número só é usado para a gente falar com você.']));
    var btn = el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: function () {
      var nome = f.nome.input.value.trim();
      var whatsapp = f.whatsapp.input.value.replace(/\D/g, '');
      if (whatsapp.length > 11 && whatsapp.indexOf('55') === 0) whatsapp = whatsapp.slice(2);
      if (nome.length < 2) { UI.avisar('Digite seu nome.'); f.nome.input.focus(); return; }
      if (whatsapp.length < 10) { UI.avisar('Digite o WhatsApp com DDD.'); f.whatsapp.input.focus(); return; }
      /* cidade: da lista, ou o que a pessoa digitou (contato nao pode travar por isso) */
      var cid = (f.cidade.valor && f.cidade.valor()) || { nome: f.cidade.input.value.replace(/\s*·\s*[A-Za-z]{2}$/, '').trim(), uf: '' };
      btn.disabled = true;
      D().store.salvarLead({ nome: nome, whatsapp: whatsapp, loja: f.loja.input.value.trim(), cidade: cid.nome || '', uf: cid.uf || '', origem: origem || 'site', pagina: location.hash })
        .then(function () { UI.soar('sucesso'); contatoRecebido(nome, f.whatsapp.input.value, espera); })
        .catch(function (e) { btn.disabled = false; UI.avisar(D().erroAmigavel(e, 'Não deu para enviar. Tente de novo.')); });
    } }, [UI.iconeLinha('check'), espera ? ESPERA.botao : 'Pode me chamar']);
    [f.nome, f.whatsapp, f.loja].forEach(function (c) { c.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } }); });
    UI.abrirModal({ titulo: espera ? ESPERA.titulo : 'Fale com a gente', corpo: corpo, rodape: [btn] });
    /* no PC o cursor ja vai para o nome; no celular nao: o teclado subiria e cobriria o botao do WhatsApp */
    var toque = false;
    try { toque = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (_) { toque = false; }
    if (!toque) setTimeout(function () { f.nome.input.focus(); }, 80);
  }

  /* recebido: a janela vira a confirmacao (com o numero, para a pessoa conferir), no lugar de sumir com um aviso rapido */
  function contatoRecebido(nome, numero, espera) {
    var primeiro = String(nome || '').split(/\s+/)[0];
    UI.abrirModal({
      titulo: espera ? 'Você está na lista' : 'Recebemos',
      corpo: el('div', { class: 'contato-ok' }, [
        el('span', { class: 'contato-ok-marca', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]),
        el('b', { text: 'Obrigado, ' + primeiro + '!' }),
        el('span', { text: espera ? 'Assim que abrir vaga, a gente chama você no WhatsApp ' + numero + ', na ordem da lista.' : 'A gente chama você no WhatsApp ' + numero + ' em breve.' }),
      ]),
      rodape: [el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'Fechar', onclick: UI.fecharModal })],
    });
  }

  /* Botao verde flutuante, igual ao das startups: aparece em todas as paginas de venda. */
  function botaoFlutuante(raiz) {
    raiz.appendChild(el('button', { class: 'zap-flutuante', type: 'button', 'aria-label': 'Fale conosco no WhatsApp', onclick: function () { abrirContato('botao-flutuante'); } }, [
      el('span', { class: 'zap-icone' }, el('span', { class: 'icone-zap', 'aria-hidden': 'true' })),
      el('span', { class: 'zap-texto', text: 'Fale conosco no WhatsApp' }),
      el('span', { class: 'zap-ponto' }),
    ]));
  }

  function rodape() {
    var e = cfg().empresa || {};
    var linhas = [
      el('div', { class: 'contatos' }, [
        el('a', { href: '#/termos', text: 'Termos de uso' }),
        el('a', { href: '#/privacidade', text: 'Privacidade' }),
        el('a', { href: '#/entrar', text: 'Minha conta' }),
        el('a', { href: '#/cidades', text: 'Lojas da cidade' }),
      ]),
      el('div', { class: 'ligeiro', text: 'Ligeiro: pedido ligeiro, sem comissão · ' + (e.cidade || 'Juquiá, SP') + (e.nome ? ' · ' + e.nome : '') + (e.cnpj ? ' · CNPJ ' + e.cnpj : '') }),
    ];
    return el('footer', { class: 'rodape rodape-vendas' }, linhas);
  }

  /* ============================================================ landing */
  function abrir(raiz) {
    var lojaDemo = cfg().lojaDemo || 'juquia/dom-conizza';
    var temWhats = !!cfg().whatsappLigeiro;
    var pr = precos();
    document.title = 'Ligeiro: sistema de pedidos para delivery, sem comissão';

    function botoesChamada(grande) {
      /* um caminho so para comecar: o cadastro de 3 minutos ("assinar" soava como pagar agora) */
      var lista = [el('a', { class: 'btn btn-principal' + (grande ? ' btn-gigante' : ''), href: '#/comecar', text: 'Começar grátis' })];
      /* o WhatsApp ja tem o botao flutuante: aqui nao repete. O segundo botao mostra o comercial (as lojas ficam no rodape) */
      lista.push(el('button', { class: 'btn btn-fantasma btn-video' + (grande ? '' : ' btn-pequeno'), type: 'button', onclick: abrirVideo }, [
        el('span', { class: 'video-play', 'aria-hidden': 'true' }), el('span', { text: 'Ver como funciona' }), el('span', { class: 'video-tempo', text: '51 s' }),
      ]));
      return el('div', { class: 'pilha chamada' }, lista);
    }

    /* Comercial por cima da pagina: o video so baixa quando a pessoa clica (a pagina nao fica mais pesada) */
    function abrirVideo(ev) {
      var antes = document.activeElement;
      var origem = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget : null;
      var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var video = el('video', { class: 'video-comercial', src: 'midia/comercial-ligeiro.mp4?v=5', poster: 'midia/comercial-ligeiro.jpg?v=4', controls: true, playsinline: true, preload: 'auto' });
      var fim = el('div', { class: 'video-fim', hidden: true }, [
        el('a', { class: 'btn btn-principal', href: '#/comecar', text: 'Criar minha loja grátis', onclick: fechar }),
        el('button', { class: 'btn btn-contorno', type: 'button', text: 'Quero que montem para mim', onclick: function () { fechar(); abrirContato('video'); } }),
        el('button', { class: 'video-denovo', type: 'button', onclick: function () { fim.hidden = true; video.currentTime = 0; video.play(); } }, [UI.iconeLinha('atualizar'), 'Ver de novo']),
      ]);
      var botaoX = el('button', { class: 'video-fechar', type: 'button', 'aria-label': 'Fechar vídeo', onclick: fechar }, [UI.iconeLinha('fechar')]);
      var caixa = el('div', { class: 'video-caixa' }, [video, fim, botaoX]);
      var fundo = el('div', { class: 'video-fundo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Comercial do Ligeiro' }, caixa);
      /* de onde o video "sai": o centro do botao tocado, bem pequeno (escala igual nos dois lados, sem achatar a imagem) */
      function saidaDoBotao() {
        if (!origem || !document.body.contains(origem)) return 'scale(0.9)';
        var o = origem.getBoundingClientRect(), f = caixa.getBoundingClientRect();
        var dx = (o.left + o.width / 2) - (f.left + f.width / 2), dy = (o.top + o.height / 2) - (f.top + f.height / 2);
        return 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + Math.max(0.08, o.height / f.height).toFixed(3) + ')';
      }
      var animar = !!caixa.animate;
      function tecla(e) { if (e.key === 'Escape') fechar(); }
      var fechando = false;
      function fechar() {
        if (!fundo.parentNode || fechando) return;
        fechando = true;
        try { video.pause(); } catch (_) { /* ignora */ }
        document.removeEventListener('keydown', tecla);
        window.removeEventListener('hashchange', fechar);
        function tirar() {
          if (!fundo.parentNode) return;
          video.removeAttribute('src'); video.load(); /* para de baixar */
          fundo.remove();
          UI.travarRolagem('video', false);
          if (antes && antes.focus) antes.focus();
        }
        if (!animar) return tirar();
        /* volta para dentro do botao (ou so some, com movimento reduzido) */
        fundo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
        caixa.animate(reduzir ? [{ transform: 'none', opacity: 1 }, { transform: 'scale(0.94)', opacity: 0 }] : [{ transform: 'none', opacity: 1 }, { transform: saidaDoBotao(), opacity: 0 }],
          { duration: reduzir ? 200 : 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
        setTimeout(tirar, reduzir ? 210 : 270);
      }
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(); });
      video.addEventListener('ended', function () { fim.hidden = false; });
      document.addEventListener('keydown', tecla);
      window.addEventListener('hashchange', fechar);
      UI.travarRolagem('video', true);
      document.body.appendChild(fundo);
      /* entrada: o fundo escurece e o video cresce de dentro do botao ate o meio da tela */
      if (animar) {
        fundo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduzir ? 180 : 260, easing: 'ease-out' });
        /* "Reduzir movimento" ligado (o iPhone vem assim para muita gente): nada de voar do botao, mas o video ainda
           cresce de leve no meio da tela, para a entrada nao parecer um corte seco */
        if (reduzir) {
          caixa.animate([{ transform: 'scale(0.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
          botaoX.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 200, easing: 'ease-out', fill: 'backwards' });
        } else {
          caixa.animate([{ transform: saidaDoBotao(), opacity: 0.35, borderRadius: '60px' }, { transform: 'none', opacity: 1, borderRadius: '22px' }],
            { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
          botaoX.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 300, easing: 'ease-out', fill: 'backwards' });
        }
      }
      botaoX.focus();
      var tocar = video.play();
      if (tocar && tocar.catch) tocar.catch(function () { /* navegador pediu toque: os controles ficam na tela */ });
    }

    function seloFundador() {
      var restam = R.vagasFundador();
      if (!(restam > 0)) return null;
      return el('a', { class: 'selo selo-fundador', href: '#planos', onclick: function (e) {
        var alvo = document.getElementById('planos');
        if (alvo) { e.preventDefault(); alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), 'Restam ' + restam + (restam === 1 ? ' vaga' : ' vagas') + ' de fundador']);
    }

    raiz.appendChild(barraTopo());

    /* ---------- heroi ---------- */
    var seloLojas = el('span', { class: 'selo', hidden: true });
    var capa = el('div', { class: 'vender-capa' }, [
      el('div', { class: 'heroi-mascote-caixa' }, el('img', { class: 'heroi-mascote', src: 'img/mascote.webp', alt: 'Mascote do Ligeiro: um rato chef com um pedido na bandeja e o celular na mão' })),
      el('div', { class: 'heroi-texto' }, [
        /* nome de marca nunca parte no meio ("Anota" numa linha e "AI" na outra) */
        el('div', { class: 'kicker' }, ['A alternativa ao ', el('span', { class: 'sem-quebra', text: 'iFood' }), ' e ao ', el('span', { class: 'sem-quebra', text: 'Anota AI' }), ' para delivery de cidade pequena']),
        /* abre pela dor (a comissao), como o comercial; a oferta vem logo embaixo */
        el('h1', { class: 'vender-titulo' }, ['Pare de dar até ', el('span', { class: 'dor-destaque', text: '26,2%' }), ' de cada pedido para o iFood.']),
        el('p', { class: 'vender-oferta' }, [pr.diasGratis + ' dias grátis. Depois, ', el('span', { class: 'preco-destaque', text: reais(pr.mensal) }), ' fixo por mês e ', el('span', { class: 'preco-destaque', text: '0%' }), ' de comissão.']),
        el('p', { class: 'vender-sub', text: 'Cardápio num link, o pedido caindo no seu celular e o pagamento confirmado sozinho pelo Mercado Pago, no Pix ou no cartão: comprovante falso não passa. Sem app para instalar.' }),
        botoesChamada(true),
        el('div', { class: 'vender-selos' }, [
          el('span', { class: 'selo' }, [UI.iconeLinha('check'), 'Sem cartão de crédito']),
          el('span', { class: 'selo' }, [UI.iconeLinha('check'), 'Sem fidelidade']),
          el('span', { class: 'selo' }, [UI.iconeLinha('check'), 'A gente monta para você']),
          seloFundador(),
          seloLojas,
        ]),
      ]),
    ]);
    raiz.appendChild(capa);
    /* prova social de verdade: so aparece quando tem loja suficiente pra impressionar */
    if (D() && D().store.listarCidades) D().store.listarCidades().then(function (cidades) {
      var total = cidades.reduce(function (n, c) { return n + (c.lojas || 0); }, 0);
      if (total >= 5) { seloLojas.textContent = total + ' lojas em ' + cidades.length + (cidades.length === 1 ? ' cidade' : ' cidades'); seloLojas.hidden = false; }
    }).catch(function () { /* sem lista, sem selo */ });

    var corpo = el('div', { class: 'conteudo vender' });
    raiz.appendChild(corpo);

    /* ---------- calculadora ---------- */
    var vendas = el('input', { type: 'text', inputmode: 'numeric', value: dinheiro(500000), 'aria-label': 'Vendas por mês no delivery' });
    UI.mascaraDinheiro(vendas);
    var pedidos = el('input', { type: 'number', min: '1', max: '5000', value: '150', inputmode: 'numeric', 'aria-label': 'Pedidos por mês' });
    var resultado = el('div', { class: 'calc-linhas' });
    var frase = el('p', { class: 'calc-frase' });

    function calcular() {
      var v = UI.centavosDoCampo(vendas.value) || 0;
      var n = Math.max(0, Math.round(Number(pedidos.value) || 0));
      var c = R.compararCustos(v, n);
      UI.limpar(resultado);
      [
        ['iFood, plano Entrega', c.ifoodEntrega, 'comissão de 26,2%' + (c.ifoodMensalidade ? ' + mensalidade' : '')],
        ['iFood, plano Básico', c.ifoodBasico, 'comissão de 15,2%' + (c.ifoodMensalidade ? ' + mensalidade' : '')],
        ['Anota AI', c.anotaAi, c.anotaFaixa],
        ['Ligeiro', c.ligeiro, 'fixo, em qualquer volume'],
      ].forEach(function (linha, i) {
        var maior = Math.max(c.ifoodEntrega, c.ifoodBasico, c.anotaAi, c.ligeiro, 1);
        resultado.appendChild(el('div', { class: 'calc-linha' + (i === 3 ? ' ligeiro' : '') }, [
          el('div', { class: 'calc-cabeca' }, [el('b', { text: linha[0] }), el('span', { class: 'calc-valor', text: dinheiro(linha[1]) + '/mês' })]),
          el('div', { class: 'calc-trilho' }, el('span', { style: { width: Math.max(2, Math.round(linha[1] / maior * 100)) + '%' } })),
          el('small', { text: linha[2] }),
        ]));
      });
      var economia = Math.min(c.ifoodBasico, c.anotaAi) - c.ligeiro;
      if (economia > 0) frase.textContent = 'Só a diferença para o mais barato deles são ' + dinheiro(economia) + ' por mês. Em um ano, ' + dinheiro(economia * 12) + ' que ficam com você.';
      else if (economia === 0) frase.textContent = 'Com esse volume o Ligeiro custa o mesmo que o mais barato deles. A diferença é que ele continua ' + dinheiro(pr.mensal) + ' quando a loja crescer.';
      else frase.textContent = 'Com esse volume, a comissão do iFood ainda sai mais barata que ' + dinheiro(pr.mensal) + '. A conta vira a seu favor a partir de uns ' + dinheiro(Math.ceil(pr.mensal / 0.152 / 10000) * 10000) + ' por mês de vendas.';
    }
    vendas.addEventListener('input', calcular);
    pedidos.addEventListener('input', calcular);
    calcular();

    corpo.appendChild(el('section', { class: 'vender-bloco vender-calc' }, [
      el('div', { class: 'calc-entrada' }, [
        el('div', { class: 'kicker', text: 'Faça a conta' }),
        el('h2', { text: 'Quanto você deixa na mesa hoje?' }),
        el('p', { class: 'muted', text: 'Coloque mais ou menos quanto vende no delivery por mês e quantos pedidos são. A conta é só com o que vai para o intermediário ou para o sistema.' }),
        el('div', { class: 'linha-campos' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Vendas por mês' }), vendas]),
          el('div', { class: 'campo' }, [el('label', { text: 'Pedidos' }), pedidos]),
        ]),
      ]),
      el('div', { class: 'calc-resultado' }, [resultado, frase, el('a', { class: 'btn btn-principal', href: '#/comecar', text: 'Quero essa economia' })]),
    ]));

    /* ---------- antes e depois ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Antes e depois' }),
      el('h2', { text: 'Sem Ligeiro vs com Ligeiro' }),
      el('div', { class: 'antes-depois' }, [
        el('div', { class: 'cartao lado sem' }, [el('b', { text: 'Sem Ligeiro' })].concat(['Comissão comendo a margem', 'Comprovante de Pix falso passando', 'WhatsApp lotado na hora do pico', 'Pedido anotado errado', 'Cliente pergunta "e o meu pedido?"', 'Fim do mês sem saber quanto vendeu'].map(function (t) { return el('p', {}, [UI.iconeLinha('fechar'), t]); }))),
        el('div', { class: 'cartao lado com' }, [el('b', { text: 'Com Ligeiro' })].concat(['0% de comissão: a margem fica com você', 'Pix e cartão confirmados pelo Mercado Pago: print falso não passa', 'Cliente monta o pedido sozinho pelo link', 'Pedido chega certo, com senha e endereço', 'Cliente acompanha pela senha, sem perguntar', 'Vendas do dia e da semana no painel'].map(function (t) { return el('p', {}, [UI.iconeLinha('check'), t]); }))),
      ]),
    ]));

    /* ---------- como funciona ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Como funciona' }),
      el('h2', { text: 'Três passos, e o pedido cai' }),
      el('div', { class: 'passos-venda' }, [
        passo('1', 'Sua loja nasce em 3 minutos', 'Nome, WhatsApp e frete. O cardápio já vem montado para o seu tipo de loja; você só ajusta preços. Se preferir, a gente vai até você e deixa tudo pronto, com fotos.'),
        passo('2', 'Você espalha o link', 'Bio do Instagram, status e saudação automática do WhatsApp, QR no balcão. Quem pede uma vez, pede de novo pelo link.'),
        passo('3', 'O pedido cai apitando', 'No seu celular ou no computador do caixa, com senha, itens, endereço com referência e o pagamento já conferido para você.'),
      ]),
    ]));

    /* ---------- o que vem ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'O que o Ligeiro faz por você' }),
      el('h2', { text: 'Atende, vende e organiza' }),
      el('div', { class: 'vender-grade' }, [
        item('link', 'Sua loja num link', 'Com a sua logo, cor e fotos. O cliente pede em um minuto, sem cadastro.'),
        item('dinheiro', 'Pix e cartão automáticos', 'Pelo Mercado Pago: o cliente paga no Pix ou no cartão de crédito e o pedido já cai pago na cozinha. Sem conferir comprovante.'),
        item('sino', 'Painel com apito', 'Cada pedido chega apitando, com endereço e WhatsApp do cliente.'),
        item('chef', 'Cozinha e entregador', 'Uma tela para cozinha e outra para o motoboy, com mapa e o que cobrar.'),
        item('imprimir', 'Impressão automática', 'A ficha sai sozinha na impressora que você já tem.'),
        item('vendas', 'Vendas e clientes', 'Quanto vendeu, horário de pico e o que mais sai.'),
      ]),
    ]));

    /* ---------- teste gratis ---------- */
    /* faixa escura da marca: selo, titulo, garantias e duas saidas (criar sozinho ou pedir para a gente montar) */
    corpo.appendChild(el('section', { class: 'teste-banner' }, [
      el('div', { class: 'teste-texto' }, [
        el('span', { class: 'teste-selo' }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), 'Teste grátis por ' + pr.diasGratis + ' dias']),
        el('h2', {}, ['Sua loja no ar ', el('span', { class: 'destaque', text: 'em 3 minutos' }), ', com o cardápio do seu tipo.']),
        el('ul', { class: 'teste-checks' }, ['Sem cartão de crédito', 'Cancela quando quiser', 'Todos os recursos'].map(function (t) { return el('li', { text: t }); })),
      ]),
      el('div', { class: 'teste-botoes' }, [
        el('a', { class: 'btn btn-principal btn-gigante', href: '#/comecar', text: 'Criar minha loja grátis' }),
        el('button', { class: 'btn btn-contorno', type: 'button', text: 'Quero que montem para mim', onclick: function () { abrirContato('teste-montar'); } }),
      ]),
    ]));

    /* ---------- planos ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco', id: 'planos' }, [
      el('div', { class: 'kicker', text: 'Preço' }),
      el('h2', { text: 'Um plano só. Tudo incluso.' }),
      el('p', { class: 'muted', text: 'Pedidos ilimitados, cardápio, painel, cozinha, entregador, Pix e cartão automáticos. Sem comissão, sem fidelidade, no cartão, boleto ou Pix.' }),
      (function () { var t = 'mensal'; var caixa = el('div', { class: 'pilha' }); function d() { UI.limpar(caixa); caixa.appendChild(el('div', { class: 'centro' }, seletorTipo(t, function (n) { t = n; d(); }))); caixa.appendChild(cartoesPlanos(false, null, null, t)); caixa.appendChild(linhaLojaExtra()); } d(); return caixa; })(),
      tabelaConcorrentes(pr),
    ]));

    /* ---------- duvidas ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Dúvidas' }),
      el('h2', { text: 'O que todo dono pergunta' }),
      el('div', { class: 'faq' }, [
        duvida('Preciso cadastrar cartão para testar?', 'Não. Você cria a loja, usa ' + pr.diasGratis + ' dias com tudo liberado e só então decide. Se não quiser continuar, não paga nada.'),
        duvida('Como eu pago a mensalidade?', 'Do jeito que preferir, em "Minha conta": cartão de crédito (cai sozinho todo mês, sem lembrar de pagar), boleto ou Pix na hora. Sem comissão e sem taxa escondida: é ' + reais(pr.mensal) + ' e pronto.'),
        duvida('Preciso de computador ou de algum aparelho?', 'Não. O painel roda no celular que você já tem. Tela na cozinha e impressora são opcionais.'),
        duvida('Como eu recebo o dinheiro do Pix?', 'Pela sua conta Mercado Pago (grátis, abre em 5 minutos no app), que você conecta no painel com um clique, sem copiar nada. O cliente paga, o Mercado Pago confirma na hora e o pedido já entra na cozinha. O dinheiro fica na sua conta Mercado Pago (taxa deles, cerca de 1% por Pix) e você transfere para o banco quando quiser. O Ligeiro nunca encosta no dinheiro. Sem Mercado Pago, a loja recebe na maquininha e em dinheiro.'),
        duvida('E o cartão de crédito pelo site?', 'Vem da mesma conexão com o Mercado Pago: você liga com um toque em Ajustes. O cliente digita o cartão no formulário seguro do próprio Mercado Pago (os números não passam pelo Ligeiro nem pela loja), paga à vista e o pedido já cai pago. A taxa é do Mercado Pago, cerca de 5% por venda, com o dinheiro na hora. Se preferir, repasse a taxa ao cliente (a lei permite): ele vê o valor antes de pagar, e no Pix não muda nada. Cancelou um pedido pago? O dinheiro volta sozinho para o cliente.'),
        duvida('E se acabar um item ou eu quiser mudar o preço?', 'No painel, um interruptor tira o item do site na hora e o preço muda direto na lista. Sem ligar para ninguém.'),
        duvida('E o Anota AI? Qual a diferença?', 'O Anota AI tem atendimento automático no WhatsApp e cardápio digital, com planos de R$ 99,99 a R$ 299,99 por mês (valores públicos de setembro de 2026). No Ligeiro é ' + reais(pr.mensal) + ' fixo por mês, sem robô no meio: o cliente pede sozinho pelo link e o Pix e o cartão são confirmados pelo Mercado Pago. Cardápio, painel, cozinha e entregador em qualquer plano.'),
        duvida('Já uso iFood. Preciso sair de lá?', 'Não. Muita loja usa os dois: o iFood para quem vem de fora e o Ligeiro para quem já é cliente, sem comissão. Cada pedido pelo seu link é margem que fica com você.'),
        duvida('Meu cliente precisa instalar alguma coisa?', 'Não. Ele abre o link, escolhe, paga e acompanha pela senha. Funciona em qualquer celular.'),
        duvida('Tem fidelidade? E se eu não gostar?', 'Não tem. Parou de pagar, a loja sai do ar depois de 10 dias de aviso e seus dados ficam guardados por 90 dias, caso volte.'),
        duvida('Meus clientes vão saber pedir pelo link?', 'Vão. É como um cardápio com foto: toca no lanche, escolhe e paga. E quem chamar no WhatsApp recebe o link na hora, pela saudação automática do WhatsApp Business, sem você digitar nada.'),
        duvida('Por que é mais barato que os outros?', 'Porque não tem escritório, não tem robô pago e não tem intermediário no Pix. O sistema é enxuto, e o preço acompanha.'),
      ]),
    ]));

    /* ---------- servico extra: loja com design exclusivo ---------- */
    (function () {
      var lc = cfg().lojaCustomizada || {};
      var msg = 'Oi! Quero um orçamento de loja com design exclusivo no Ligeiro.';
      var pedir = linkWhats(msg)
        ? el('a', { class: 'btn btn-principal', href: linkWhats(msg), target: '_blank', rel: 'noopener', text: 'Pedir orçamento' })
        : el('button', { class: 'btn btn-principal', type: 'button', text: 'Pedir orçamento', onclick: function () { abrirContato('loja-exclusiva'); } });
      /* celular de mentira: mostra a diferenca entre a loja padrao e a exclusiva */
      function celular(tipo) {
        var exclusivo = tipo === 'exclusivo';
        return el('div', { class: 'ex-cel ' + (exclusivo ? 'ex-cel-exclusivo' : 'ex-cel-padrao') }, [
          el('div', { class: 'ex-tela' }, [
            exclusivo ? el('img', { class: 'ex-logo', src: 'img/oficial/dom-conizza-logo.webp', alt: '' }) : el('div', { class: 'ex-logo ex-logo-emoji', text: '🍕' }),
            el('div', { class: 'ex-nome', text: exclusivo ? 'Dom Conizza' : 'Sua loja' }),
            el('div', { class: 'ex-botao', text: 'PEDIR AGORA' }),
            el('div', { class: 'ex-item' }, [el('span', { class: 'ex-foto' }), el('span', { class: 'ex-linhas' }, [el('i'), el('i')])]),
            el('div', { class: 'ex-item' }, [el('span', { class: 'ex-foto' }), el('span', { class: 'ex-linhas' }, [el('i'), el('i')])]),
          ]),
          el('div', { class: 'ex-rotulo', text: exclusivo ? 'Exclusivo' : 'Padrão' }),
        ]);
      }
      /* icone: um emoji, ou uma imagem (o selo verde), na mesma bolinha de 38px: o texto comeca no mesmo x em todas as linhas */
      function recurso(icone, titulo) {
        var caixa = typeof icone === 'string' ? el('span', { class: 'ex-icone', text: icone }) : el('span', { class: 'ex-icone' }, icone);
        return el('li', { class: 'ex-recurso' }, [caixa, el('b', { text: titulo })]);
      }
      corpo.appendChild(el('section', { class: 'vender-bloco' }, [
        el('div', { class: 'exclusiva' }, [
          el('div', { class: 'ex-vitrine', 'aria-hidden': 'true' }, [celular('padrao'), el('span', { class: 'ex-seta', text: '→' }), celular('exclusivo')]),
          el('div', { class: 'ex-texto' }, [
            el('div', { class: 'ex-kicker', text: 'Serviço extra' }),
            el('h2', { text: 'Uma loja com a cara da sua marca' }),
            el('p', { class: 'ex-sub', text: 'No painel, toda loja já escolhe cor, logo e capa. No exclusivo, a gente desenha a loja inteira do seu jeito, como fez na Dom Conizza, e você não mexe em nada.' }),
            /* quatro linhas curtas (eram seis cartoes com subtitulo): numero par, nas duas colunas nao sobra linha sozinha */
            el('ul', { class: 'ex-recursos' }, [
              recurso([UI.iconeLinha('imagem')], 'Suas cores, letras e botões'),
              recurso([UI.iconeLinha('estrela')], 'Abertura com a sua logo'),
              recurso([UI.iconeLinha('chef')], 'Combinando até na cozinha'),
              recurso(el('img', { class: 'ex-selo', src: 'img/selo-verificado.svg', alt: '' }), 'Selo de loja verificada'),
            ]),
            el('div', { class: 'ex-preco' }, [
              el('span', { class: 'ex-apartir', text: lc.aPartirDe ? 'a partir de' : '' }),
              el('b', { text: lc.aPartirDe ? reais(lc.aPartirDe) : 'Sob orçamento' }),
              el('span', { class: 'ex-obs' }, [el('span', { class: 'sem-quebra', text: 'Pago uma vez só.' }), ' ', el('span', { class: 'sem-quebra', text: 'A mensalidade não muda.' })]), /* se quebrar, quebra entre as frases */
            ]),
            el('div', { class: 'ex-botoes' }, [pedir, el('a', { class: 'btn btn-fantasma ex-ver', href: '#/' + lojaDemo, text: 'Ver a Dom Conizza' })]),
          ]),
        ]),
      ]));
    })();

    /* ---------- fechamento ---------- */
    corpo.appendChild(el('section', { class: 'vender-final' }, [
      el('img', { class: 'final-mascote', src: 'img/mascote-192.webp', alt: '' }),
      el('h2', { text: 'Quer ver funcionando na sua loja?' }),
      el('p', { class: 'muted', text: 'Comece grátis agora ou chame a gente: vamos até você, cadastramos tudo e os primeiros dias são por nossa conta.' }),
      botoesChamada(true),
      el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Prefiro que me chamem', onclick: function () { abrirContato('fechamento'); } }),
    ]));
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);

    /* barra fixa no celular: aparece quando o heroi sai da tela */
    var barra = el('div', { class: 'cta-fixa', hidden: true }, [
      el('span', {}, [el('b', { text: pr.diasGratis + ' dias grátis' }), ' · sem cartão']),
      el('a', { class: 'btn btn-principal btn-pequeno', href: '#/comecar', text: 'Começar grátis' }),
    ]);
    raiz.appendChild(barra);
    function conferirBarra() { barra.hidden = capa.getBoundingClientRect().bottom > 0; }
    window.addEventListener('scroll', conferirBarra, { passive: true });
    window.addEventListener('resize', conferirBarra);
    conferirBarra();

    return function () { window.removeEventListener('scroll', conferirBarra); window.removeEventListener('resize', conferirBarra); document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* "Tem mais de uma loja?": a loja a mais, numa linha so, embaixo do plano */
  function linhaLojaExtra() {
    var extra = Number((cfg() || {}).lojaExtra) || 0;
    if (!extra) return el('span');
    return el('p', { class: 'plano-extra' }, ['Tem mais de uma loja? ', el('b', { class: 'sem-quebra', text: '+ ' + reais(extra) + ' por mês' }), ' cada loja a mais, na mesma conta e na mesma cobrança.']);
  }

  /* Cartoes de plano. tipo = 'mensal' | 'anual'. Na pagina de vendas, so o plano de uma loja; em #/assinar viram escolha
     (1, 2 ou 3 lojas). Plano escondido (oculto) so vale para conta antiga que ja tinha escolhido. */
  function cartoesPlanos(selecionavel, escolhidoId, aoEscolher, tipo, ehCliente) {
    /* vagas cheias so mudam a tela de quem ainda nao e cliente (quem ja tem conta so troca de plano) */
    var fechado = R.capacidadeLojas().fechado && !ehCliente;
    var pr = precos();
    var t = tipo === 'anual' ? 'anual' : 'mensal';
    var lista = R.planos().filter(function (p) { return !p.oculto && (selecionavel || p.lojas === 1); });
    var grade = el('div', { class: 'planos planos-' + lista.length }, lista.map(function (p, i) {
      var preco = R.precoDoPlano(p.id, t);
      var normal = t === 'anual' && p.anual > 0 ? p.anual : p.mensal;
      var deFundador = preco < normal;
      var cadaUm = preco / (t === 'anual' ? 12 : 1) / p.lojas;
      var porLoja = Math.ceil(cadaUm / 100) * 100;
      var sai = cadaUm % 100 === 0 ? 'Sai por ' : 'Sai por menos de '; /* R$ 74 certinho nao e "menos de R$ 74" */
      /* anual: quanto sai mais barato que pagar 12 meses no mensal (mesmo preco, de fundador ou nao) */
      var economia = t === 'anual' ? R.precoDoPlano(p.id, 'mensal') * 12 - preco : 0;
      var destaque = ''; /* nada de "mais escolhido" sem cliente para provar */
      var linhas = [
        p.lojas === 1 ? '1 loja na sua conta' : 'Até ' + p.lojas + ' lojas na mesma conta',
        pr.diasGratis + ' dias grátis, sem cartão',
        p.lojas === 1 ? 'Pedidos ilimitados, tudo incluso' : (t === 'anual' ? 'Uma cobrança por ano para todas as lojas' : 'Uma cobrança por mês para todas as lojas'),
        'Cartão, boleto ou Pix',
        'Suporte 24 horas',
      ];
      /* o valor nunca parte no meio ("R$" numa linha e "70,00" na outra) */
      var sub = p.lojas > 1 ? [sai, el('span', { class: 'sem-quebra', text: reais(porLoja) }), ' por loja no mês']
        : (t === 'anual' ? [sai, el('span', { class: 'sem-quebra', text: reais(porLoja) }), ' por mês'] : (p.frase || ''));
      var card = el(selecionavel ? 'button' : 'div', { class: 'plano-card' + (destaque ? ' com-destaque' : '') + (selecionavel && escolhidoId === p.id ? ' escolhido' : ''), type: selecionavel ? 'button' : null }, [
        destaque ? el('span', { class: 'plano-etiqueta', text: destaque }) : null,
        el('div', { class: 'plano-titulo', text: p.nome }),
        el('div', { class: 'plano-preco-caixa' }, el('div', { class: 'plano-preco' }, [dinheiro(preco), el('small', { text: t === 'anual' ? ' /ano' : ' /mês' })])),
        economia > 0 ? el('div', { class: 'plano-economia' }, [el('b', { text: 'Economize ' + dinheiro(economia) }), ' no ano']) : null,
        deFundador ? el('div', { class: 'plano-fundador' }, [el('b', {}, [UI.iconeLinha('estrela'), 'Fundador']), ' · acabando as vagas, ' + dinheiro(normal)]) : null,
        el('div', { class: 'plano-sub' }, sub),
        el('ul', { class: 'plano-linhas' }, linhas.map(function (x) { return el('li', {}, [el('span', { class: 'plano-check', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]), el('span', { text: x })]); })),
        selecionavel ? el('span', { class: 'plano-marca' }, escolhidoId === p.id ? [UI.iconeLinha('check'), 'Escolhido'] : ['Escolher'])
          : (fechado
            ? el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Lista de espera', onclick: function () { abrirContato('lista-espera'); } })
            : el('a', { class: 'btn btn-principal btn-pequeno', href: '#/assinar/' + p.id + '/' + t, text: 'Começar grátis' })),
      ]);
      if (selecionavel) card.addEventListener('click', function () { aoEscolher(p.id); });
      /* quantas partes o cartao tem (a etiqueta flutua e nao conta): vira as linhas do subgrid */
      card.style.setProperty('--partes', [].filter.call(card.children, function (f) { return !f.classList.contains('plano-etiqueta'); }).length);
      return card;
    }));
    var temFundador = lista.some(function (p) { var n = t === 'anual' && p.anual > 0 ? p.anual : p.mensal; return R.precoDoPlano(p.id, t) < n; });
    var faixa = fechado ? faixaEspera() : (temFundador ? faixaFundador() : null);
    if (faixa) grade.insertBefore(faixa, grade.firstChild);
    return grade;
  }

  /* Mensal | Anual (paga 10 meses, usa 12: o selo mostra isso antes de tocar) */
  function seletorTipo(tipo, aoMudar) {
    var pr = precos();
    if (!(pr.anual > 0)) return el('span');
    var caixa = el('div', { class: 'estilo-linha seletor-tipo' });
    [['mensal', 'Mensal'], ['anual', 'Anual', '2 meses grátis']].forEach(function (op) {
      caixa.appendChild(el('button', { type: 'button', class: 'aba-painel' + (tipo === op[0] ? ' ativa' : ''), onclick: function () { aoMudar(op[0]); } },
        [op[1], op[2] ? el('span', { class: 'tipo-selo', text: op[2] }) : null]));
    });
    return caixa;
  }

  /* ============================================================ #/assinar */
  function assinar(raiz, planoInicial, tipoInicial) {
    var pr = precos();
    var lista = R.planos().filter(function (p) { return !p.oculto; });
    var escolhido = R.planos().some(function (p) { return p.id === planoInicial; }) ? planoInicial : lista[0].id;
    var tipo = tipoInicial === 'anual' && pr.anual > 0 ? 'anual' : 'mensal';
    /* compatibilidade com links antigos #/assinar/anual */
    if (planoInicial === 'anual' && pr.anual > 0) { tipo = 'anual'; escolhido = lista[0].id; }
    var conta = null;
    document.title = 'Assinar o Ligeiro';
    raiz.appendChild(barraTopo());
    var corpo = el('div', { class: 'conteudo vender assinar' });
    raiz.appendChild(corpo);
    var caixaTipo = el('div', { class: 'centro' });
    var caixaPlanos = el('div');
    var resumo = el('div', { class: 'cartao destaque resumo-assinatura' });
    var continuar = el('a', { class: 'btn btn-principal btn-gigante btn-largo', href: '#/comecar/' + escolhido + '/' + tipo, text: 'Criar minha loja' });
    /* so a duvida: o "Entrar" ja esta no topo, e quem tem conta e reconhecido no login de "Criar minha loja" */
    var linhaAjuda = el('p', { class: 'muted pequeno centro' }, ['Dúvida? ', el('a', { href: '#/lojas', text: 'Veja como funciona' }), '.']);

    function desenhar() {
      UI.limpar(caixaTipo); caixaTipo.appendChild(seletorTipo(tipo, function (t) { tipo = t; desenhar(); }));
      UI.limpar(caixaPlanos);
      caixaPlanos.appendChild(cartoesPlanos(true, escolhido, function (id) { escolhido = id; desenhar(); }, tipo, !!conta));
      var plano = R.planoPorId(escolhido);
      var valor = R.precoDoPlano(escolhido, tipo);
      var fim = new Date(Date.now() + pr.diasGratis * 864e5);
      UI.limpar(resumo);
      resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Plano' }), el('b', { text: plano.nome + ' · ' + (tipo === 'anual' ? 'anual' : 'mensal') })]));
      if (conta) {
        var pc = conta.plano || {};
        var atual = R.planoPorId(pc.planoId);
        var tipoAtual = pc.tipo === 'anual' ? 'anual' : 'mensal';
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Sua conta hoje' }), el('b', { text: atual.nome + ' · ' + tipoAtual })]));
        /* o mesmo plano que ja tem: nada para trocar, o caminho e pagar ou ver o vencimento em Minha conta */
        if (atual.id === plano.id && tipoAtual === tipo) {
          resumo.appendChild(el('p', { class: 'muted pequeno', text: 'Este já é o seu plano. Para pagar ou ver quando vence, vá em Minha conta.' }));
          continuar.textContent = 'Ir para Minha conta';
          continuar.setAttribute('href', '#/conta');
          continuar.onclick = null;
          return;
        }
        /* com assinatura no Asaas, a troca passa pelo mensageiro: mais lojas pagam so a diferenca, o resto vale na proxima fatura */
        var C = window.LigeiroCobranca;
        var comAssinatura = !D().modoDemo && !!(C && C.assinaturaAtiva && C.assinaturaAtiva(conta));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: comAssinatura
          ? 'Para mais lojas, você paga só a diferença dos dias que faltam, e elas liberam assim que ela cair. Menos lojas, ou trocar entre mensal e anual, vale na próxima fatura.'
          : 'A troca vale a partir do próximo pagamento: o valor passa a ser ' + dinheiro(valor) + (tipo === 'anual' ? ' por ano' : ' por mês') + '.' }));
        continuar.textContent = 'Mudar para este plano';
        continuar.setAttribute('href', '#');
        continuar.onclick = function (ev) {
          ev.preventDefault();
          var st = D().store;
          st.listarMinhasLojas(conta.email).then(function (minhas) {
            var reais = minhas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === conta.email; }).length;
            if (reais > plano.lojas) throw new Error('Você tem ' + reais + ' lojas e esse plano permite ' + plano.lojas + '. Para descer de plano, fale com o Ligeiro e diga qual loja fechar.');
            /* encerrada, mas a assinatura do Asaas ainda nao saiu (o Cron tira): primeiro reativa */
            if ((conta.assinaturaAsaas || conta.assinaturaPendente) && (conta.plano || {}).status === 'cancelado') throw new Error('Reative a assinatura em Minha conta antes de trocar de plano.');
            if (comAssinatura) return C.trocarPlano({ planoId: escolhido, tipo: tipo, nomePlano: plano.nome, aoTerminar: function () { window.LigeiroApp.ir('conta'); } }).then(function () { return 'feito'; });
            return st.salvarConta(conta.email, { plano: { planoId: escolhido, tipo: tipo } });
          }).then(function (c) {
            if (c === 'feito') return;
            UI.soar('sucesso');
            var pago = c && c.plano && c.plano.status === 'ativo' && c.plano.planoPago && c.plano.planoPago !== escolhido;
            UI.avisar(pago ? 'Plano trocado para ' + plano.nome + '. Vale assim que o Pix dele for confirmado.' : 'Plano trocado: ' + plano.nome + '.');
            window.LigeiroApp.ir('conta');
          }).catch(function (e) { UI.avisar(D().erroAmigavel(e, 'Não deu para trocar agora.')); });
        };
      } else {
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Hoje' }), el('b', { text: R.dinheiro(0) })]));
        /* curto para caber numa linha no celular ("A partir de 02/10/2026 (7 dias)" e "R$ 79,00 por mes" quebravam) */
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'A partir de ' + fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }), el('b', { text: dinheiro(valor) + (tipo === 'anual' ? '/ano' : '/mês') })]));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: 'Sem cartão agora. Quando o período grátis terminar, o Pix aparece na sua conta e no painel. Não gostou? Não paga e pronto.' }));
        continuar.setAttribute('href', '#/comecar/' + escolhido + '/' + tipo);
        continuar.textContent = 'Criar minha loja';
        continuar.onclick = null;
        if (R.capacidadeLojas().fechado) {
          continuar.textContent = 'Entrar na lista de espera';
          continuar.setAttribute('href', '#');
          continuar.onclick = function (ev) { ev.preventDefault(); abrirContato('lista-espera'); };
        }
      }
    }
    desenhar();
    D().store.usuarioAtual().then(function (u) {
      if (!u || !raiz.isConnected) return;
      /* o plano da conta so vale quando o link nao escolheu ("Começar grátis" do anual abre no anual, mesmo logado) */
      var linkEscolheu = lista.some(function (p) { return p.id === planoInicial; }), linkTipo = tipoInicial === 'anual' || tipoInicial === 'mensal' || planoInicial === 'anual';
      return D().store.obterConta(u.email).then(function (c) { if (c) { conta = c; if (!linkEscolheu) escolhido = (c.plano && c.plano.planoId) || escolhido; if (!linkTipo) tipo = (c.plano && c.plano.tipo) || tipo; desenhar(); } });
    });

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Assinar' }),
      el('h2', { text: 'Escolha o seu plano' }),
      el('p', { class: 'muted', text: 'A assinatura é da sua conta e vale para todas as lojas dela. Escolha pela quantidade de lojas e se paga por mês ou por ano, no cartão, boleto ou Pix.' }),
    ]));
    corpo.appendChild(caixaTipo);
    corpo.appendChild(caixaPlanos);
    corpo.appendChild(resumo);
    corpo.appendChild(continuar);
    corpo.appendChild(linhaAjuda);
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    return function () { document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* ============================================================ #/entrar */
  function entrar(raiz) {
    var store = D().store;
    document.title = 'Entrar · Ligeiro';
    raiz.appendChild(barraTopo());
    var corpo = el('div', { class: 'conteudo vender assinar' });
    raiz.appendChild(corpo);
    var erro = el('div', { class: 'msg-erro', hidden: true });
    function falhar(msg) { erro.hidden = false; erro.textContent = msg; UI.soar('erro'); }
    function destino() {
      var d = '';
      try { d = sessionStorage.getItem('ligeiro:depois') || ''; sessionStorage.removeItem('ligeiro:depois'); } catch (_) { /* ignora */ }
      return d && d.indexOf('#/') === 0 ? d.slice(2) : 'conta';
    }
    function depois(u) { if (u) { UI.soar('sucesso'); window.LigeiroApp.ir(destino()); } }

    var btnGoogle = el('button', { class: 'btn btn-google btn-largo', type: 'button', text: D().modoDemo ? 'Entrar na demonstração' : 'Entrar com o Google', onclick: function () {
      btnGoogle.disabled = true;
      store.entrarComGoogle().then(depois).catch(function (e) { falhar(D().erroAmigavel(e)); }).then(function () { btnGoogle.disabled = false; });
    } });

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Conta do dono' }),
      el('h2', { text: 'Entrar no Ligeiro' }),
      el('p', { class: 'muted', text: 'Uma conta só, e dentro dela todas as suas lojas: painel, cozinha, entregador, assinatura.' }),
    ]));
    /* So Google: sem senha para decorar nem para esquecer. Dentro do Instagram, o aviso de abrir no navegador vem antes */
    corpo.appendChild(el('div', { class: 'cartao login-caixa' }, [
      UI.avisoNavegadorDeApp('entrar'),
      btnGoogle,
      erro,
      el('p', { class: 'muted pequeno centro', text: D().modoDemo ? 'Na demonstração a conta é de mentira e fica só neste aparelho.' : 'É a mesma conta Google do seu celular. Primeira vez? A conta do Ligeiro nasce sozinha, e em seguida você cria a loja.' }),
    ]));
    corpo.appendChild(el('details', { class: 'avancado' }, [
      el('summary', { text: 'Sou da cozinha ou entregador' }),
      el('p', { class: 'muted pequeno', text: 'A equipe não precisa de conta: entra pelo link da cozinha ou do entregador com a senha da equipe. Peça o link e a senha para o dono da loja.' }),
    ]));
    corpo.appendChild(el('p', { class: 'muted pequeno centro' }, ['Sou do Ligeiro: ', el('a', { href: '#/admin', text: 'admin' }), '.']));
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    /* ja logado? vai direto pra conta */
    store.usuarioAtual().then(function (u) { if (u && raiz.isConnected) window.LigeiroApp.ir(destino()); });
    return function () { document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* ============================================================ termos e privacidade */
  function paginaLegal(raiz, titulo, blocos) {
    var e = cfg().empresa || {};
    document.title = titulo + ' · Ligeiro';
    raiz.appendChild(barraTopo());
    var corpo = el('div', { class: 'conteudo texto-legal' });
    raiz.appendChild(corpo);
    corpo.appendChild(el('h1', { text: titulo }));
    corpo.appendChild(el('p', { class: 'muted', text: 'Versão de ' + VERSAO_DOS_TERMOS + '. Escrito em português de gente, sem juridiquês. Se algo não estiver claro, chame a gente' + (e.email ? ' em ' + e.email : '') + '.' }));
    blocos.forEach(function (b) {
      corpo.appendChild(el('h2', { text: b[0] }));
      b[1].forEach(function (p) { corpo.appendChild(el('p', { text: p })); });
    });
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    window.scrollTo(0, 0);
    return function () { document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* data de verdade da ultima mudanca dos termos e da privacidade (antes aparecia sempre a data de hoje) */
  var VERSAO_DOS_TERMOS = '24/09/2026';

  function termos(raiz) {
    var pr = precos();
    /* o preco dos termos e o normal; o de fundador vem com a condicao (so para quem pagar enquanto houver vaga) */
    var normal = R.planoPorId('uma');
    var fund = normal.fundador || {};
    var vagas = R.vagasFundador ? R.vagasFundador() : 0;
    var e = cfg().empresa || {};
    var quem = e.nome ? e.nome + (e.cnpj ? ' (CNPJ ' + e.cnpj + ')' : '') : 'o Ligeiro';
    return paginaLegal(raiz, 'Termos de uso', [
      ['O que é o Ligeiro', ['O Ligeiro é um sistema de pedidos para lanchonetes, pizzarias, marmitarias e parecidos: cardápio num link, painel de pedidos, telas de cozinha e entrega, relatórios e cupons. Quem oferece o serviço é ' + quem + '.']],
      ['Quem pode usar', ['Qualquer estabelecimento que venda comida ou bebida e tenha um responsável maior de 18 anos. Ao criar a loja, você confirma que tem direito de vender o que cadastra e que as informações (nome, endereço, WhatsApp) são suas ou da sua empresa.']],
      ['Preço e pagamento', ['Os primeiros ' + pr.diasGratis + ' dias são grátis, sem cartão. Depois, o plano mensal custa ' + dinheiro(normal.mensal) + ' por mês' + (normal.anual > 0 ? ' e o anual ' + dinheiro(normal.anual) + ' por ano' : '') + ', pagos por cartão de crédito, boleto ou Pix em "Minha conta". Cada loja a mais na mesma conta custa ' + dinheiro(cfg().lojaExtra || 6900) + ' por mês.' + (vagas > 0 && fund.mensal ? ' Preço de fundador: as ' + ((cfg().fundador || {}).vagas || 5) + ' primeiras lojas que pagarem pagam ' + dinheiro(fund.mensal) + ' por mês' + (fund.anual > 0 ? ' (' + dinheiro(fund.anual) + ' por ano)' : '') + ', travado enquanto não cancelarem. Se as vagas acabarem antes do seu primeiro pagamento, vale o preço normal.' : '') + ' Não há comissão por pedido nem taxa escondida. O preço pode mudar com aviso de 30 dias no painel; a mudança nunca vale para um período já pago nem para o preço de fundador travado.', 'Acabando os dias grátis sem assinar, o site da loja para de aceitar pedidos até o pagamento ser confirmado. Quem já paga tem 10 dias de tolerância após o vencimento, com aviso no painel. Os dados ficam guardados por 90 dias e podem ser apagados a pedido.']],
      ['Aceite', ['Você aceita estes termos ao marcar "Li e aceito" no cadastro da loja ou no painel. O Ligeiro guarda qual versão foi aceita e quando. Quando o texto muda de um jeito que importa, o painel pede um novo aceite antes de continuar.']],
      ['Cancelamento', ['Não tem fidelidade. Para cancelar, basta parar de pagar ou pedir no WhatsApp. Períodos já pagos não são devolvidos, mas continuam valendo até o fim.']],
      ['O dinheiro do cliente', ['O Pix e o cartão de crédito do cliente vão para a conta Mercado Pago da loja, que confirma o pagamento e libera o pedido. O Ligeiro não recebe, não guarda e não repassa dinheiro de pedido. Valem as regras e taxas do Mercado Pago. Os números do cartão são digitados no formulário do próprio Mercado Pago e não passam pelo Ligeiro nem pela loja.', 'Quando a loja cancela um pedido pago pelo site, o valor volta ao cliente pelo Mercado Pago. Maquininha e dinheiro são cobrados pela própria loja na entrega ou no balcão.']],
      ['Responsabilidades da loja', ['Cardápio, preços, prazos, entrega, qualidade e segurança dos alimentos, licenças (inclusive da vigilância sanitária), notas fiscais e tributos são da loja. O Ligeiro é a ferramenta de pedido; quem vende é você. Bebida alcoólica e outros produtos com idade mínima só podem ser entregues a maiores de 18 anos, e conferir isso é da loja.', 'A loja também é responsável por usar os dados dos clientes só para atender e avisar sobre pedidos e promoções da própria loja, conforme a Política de privacidade. Pela LGPD, a loja é a controladora dos dados dos clientes dela e o Ligeiro é o operador, que só guarda e leva esses dados para o pedido acontecer.']],
      ['Pagamentos, estornos e contestações', ['O pagamento pelo site é feito entre o cliente e a conta Mercado Pago da loja. Estornos, contestações (chargeback) e devoluções seguem as regras do Mercado Pago e são resolvidos entre a loja, o cliente e o Mercado Pago. O Ligeiro não é parte desse pagamento e não responde por valores retidos, contestados ou devolvidos.', 'Se a loja escolher cobrar a taxa do cartão do cliente, o site mostra o valor antes do pagamento, como a Lei 13.455/2017 pede. A decisão de cobrar e o valor são da loja.']],
      ['Dados pessoais (LGPD)', ['Com os dados de quem pede na loja (nome, WhatsApp, endereço), a loja é a controladora: é ela quem decide para que usa. O Ligeiro é o operador: guarda e processa esses dados em nome da loja, só para o pedido funcionar, seguindo a Lei Geral de Proteção de Dados (Lei 13.709/2018) e a política de privacidade.', 'A loja usa esses dados só para atender o pedido e falar com o cliente sobre ele, e responde aos pedidos dos clientes dela sobre os próprios dados. O Ligeiro ajuda: acha, entrega ou apaga os dados de uma pessoa a pedido, e avisa a loja se acontecer um incidente de segurança que envolva os clientes dela.']],
      ['Conteúdo da loja', ['Nome, fotos, logo, textos e marcas que a loja envia precisam ser dela ou ter autorização de uso. A loja autoriza o Ligeiro a mostrar esse conteúdo no site dela, nas páginas da cidade e na divulgação do próprio Ligeiro. O Ligeiro pode tirar do ar conteúdo falso, ilegal, ofensivo ou que use marca de outra pessoa.']],
      ['Acesso e senhas', ['A loja cuida da conta do Google que abre o painel e da senha da equipe. O que for feito com esses acessos é de responsabilidade da loja. Suspeitou de acesso indevido, troque a senha da equipe e avise o Ligeiro.']],
      ['Disponibilidade', ['O sistema roda em serviços de nuvem de grandes fornecedores (Google, Cloudflare, GitHub, Mercado Pago) e é mantido para ficar no ar o tempo todo, mas pode haver falhas, limites de uso ou manutenções, inclusive desses fornecedores. Nesses casos, a loja segue atendendo pelo WhatsApp e o Ligeiro avisa pelo painel ou pelo WhatsApp da loja.']],
      ['Limite de responsabilidade', ['O Ligeiro não responde por lucro cessante, pedidos perdidos por falta de internet, falhas de fornecedores, erros no cardápio cadastrado pela loja ou problemas na entrega. Em qualquer caso, a responsabilidade do Ligeiro fica limitada ao valor que a loja pagou nos últimos 3 meses.']],
      ['Uso indevido e suspensão', ['É proibido cadastrar loja falsa, vender produto ilegal, usar o sistema para enviar spam, fraudar pagamentos ou tentar acessar dados de outras lojas. Nesses casos, ou por ordem da justiça, a loja pode ser suspensa ou desligada sem devolução.']],
      ['Para quem pede', ['Quem faz um pedido compra da loja, não do Ligeiro. Dúvidas, trocas e reclamações sobre o pedido são com a loja, pelo WhatsApp dela. O Ligeiro ajuda a loja a resolver quando for problema do sistema.']],
      ['Mudanças nestes termos', ['Se os termos mudarem de um jeito que importa, o painel pede um novo aceite antes de continuar. Versão de ' + R.TERMOS_VERSAO.slice(0, 10).split('-').reverse().join('/') + '.']],
      ['Foro', ['Estes termos seguem as leis do Brasil. Fica eleito o foro da comarca da sede do Ligeiro, ressalvados os direitos do consumidor previstos em lei.']],
    ]);
  }

  function privacidade(raiz) {
    var e = cfg().empresa || {};
    var quem = e.nome ? e.nome + (e.cnpj ? ' (CNPJ ' + e.cnpj + ')' : '') : 'o Ligeiro';
    var falar = 'no WhatsApp do Ligeiro' + (e.email ? ' ou pelo e-mail ' + e.email : '');
    return paginaLegal(raiz, 'Política de privacidade', [
      ['Resumo', ['O Ligeiro guarda só o necessário para um pedido chegar na loja e para a loja usar o sistema. Ninguém vende, aluga ou repassa esses dados, e nada é usado para anúncio. Esta política segue a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).']],
      ['Quem é o responsável', ['Pelos dados de quem pede numa loja, a responsável (controladora) é a loja: é ela quem decide para que usa. O Ligeiro é o operador, que guarda e processa esses dados em nome dela, só para o pedido funcionar.', 'Pelos dados das lojas e dos donos (cadastro, login e assinatura) e pelos contatos do "Fale com a gente", o responsável é ' + quem + '.']],
      ['Dados de quem pede, e para quê', ['Nome e WhatsApp: para a loja saber de quem é o pedido e falar com você sobre ele. Endereço e referência (só na entrega): para entregar. Itens, observações e forma de pagamento: para preparar e cobrar o pedido.', 'No cartão pelo site, o CPF e o e-mail vão direto para o Mercado Pago, para a cobrança, e não ficam guardados no Ligeiro. Se você ligar os avisos no celular, o endereço técnico do aviso fica no próprio pedido, só para avisar sobre ele.', 'A base legal é a execução do pedido que você fez (art. 7º, V, da LGPD).']],
      ['Dados das lojas e dos donos', ['Nome, tipo, cidade, endereço, WhatsApp, e-mail de login (conta do Google), cardápio, fotos, pedidos e relatórios de vendas. Servem para a loja funcionar e para a cobrança da assinatura (execução do contrato). A conexão com o Mercado Pago fica numa parte privada, que só a loja e o Ligeiro acessam.']],
      ['Contato do "Fale com a gente"', ['Nome, WhatsApp, cidade e nome da loja, só para a gente responder. Apagamos quando você pedir ou quando o contato não tiver mais uso.']],
      ['Com quem os dados são compartilhados', ['Só com os serviços que fazem o Ligeiro funcionar:',
        'Google (Firebase): banco de dados e login com o Google. Pode guardar dados fora do Brasil, como nos Estados Unidos.',
        'Cloudflare: o mensageiro do Ligeiro (pedidos, pagamentos e avisos) e uma cópia do cardápio, que já é público, para o site abrir rápido. Rede no mundo todo, com sede nos Estados Unidos.',
        'GitHub: guarda os arquivos do site. Estados Unidos.',
        'Mercado Pago: Pix e cartão do pedido, direto na conta da loja. Brasil.',
        'Asaas: cobrança da assinatura das lojas (cartão, boleto e Pix). Brasil.',
        'Serviço de avisos do navegador (Google, Apple ou Mozilla): só se você ligar os avisos no celular. Levam o aviso até o seu aparelho, com a mensagem criptografada.',
        'WhatsApp (Meta): só quando você toca num botão de WhatsApp. A conversa segue as regras do WhatsApp.',
        'Mais ninguém recebe dados pessoais pelo Ligeiro.']],
      ['Dados fora do Brasil', ['Alguns desses serviços guardam ou processam dados fora do Brasil, principalmente nos Estados Unidos. Isso acontece porque é necessário para o pedido e para o serviço contratado funcionarem (art. 33, IX, da LGPD), e o Ligeiro usa fornecedores grandes, com regras próprias de proteção de dados.']],
      ['Por quanto tempo', ['Os pedidos ficam guardados enquanto a loja usar o Ligeiro, porque são o histórico de vendas dela. Pelo link do pedido, nome, telefone e endereço só aparecem por 3 dias. Depois do cancelamento da loja, os dados ficam 90 dias (caso ela volte) e então são apagados.', 'A pedido, apagamos antes: o pedido fica só com os valores, sem nome, telefone nem endereço.']],
      ['Seus direitos', ['Você pode pedir a qualquer momento: confirmar se temos dados seus, receber uma cópia, corrigir, apagar ou saber com quem foram compartilhados. Fale ' + falar + ', de preferência do mesmo número que você usou nos pedidos, para a gente confirmar que é você. Respondemos em até 15 dias. Se o pedido for sobre os dados de uma loja, avisamos a loja também.', 'Você também pode reclamar na Autoridade Nacional de Proteção de Dados (ANPD).']],
      ['Cookies e o que fica no seu celular', ['O site guarda no próprio aparelho o pedido em andamento, a cidade escolhida, os seus pedidos e, para o próximo pedido ser mais rápido, o nome, o telefone e o endereço que você digitou. Nada disso serve para anúncio, e o site não usa cookies de anúncio nem rastreadores.', 'Para apagar tudo isso do seu celular, abra Meus pedidos na loja e toque em "Apagar meus dados deste aparelho".']],
      ['Segurança', ['Os dados trafegam protegidos (https). O banco tem regras de acesso por loja: uma loja não vê os dados de outra, e cada cliente só vê o próprio pedido. As chaves e a conexão com o Mercado Pago ficam em áreas privadas, e o sistema passa por testes de invasão.', 'Se acontecer um incidente de segurança que possa trazer risco a você, avisamos você, a loja e a ANPD, como manda a lei.']],
      ['Contato sobre dados pessoais', ['Para qualquer assunto sobre dados pessoais, fale ' + falar + '.']],
    ]);
  }

  /* ---------- pecas ---------- */
  function passo(n, titulo, texto) {
    return el('div', { class: 'passo-venda' }, [el('span', { class: 'n', text: n }), el('div', {}, [el('b', { text: titulo }), el('p', { text: texto })])]);
  }
  function item(icone, titulo, texto) {
    return el('div', { class: 'cartao item-venda' }, [el('span', { class: 'icone' }, [UI.iconeLinha(icone)]), el('b', { text: titulo }), el('p', { text: texto })]);
  }
  /* Comparativo com os concorrentes. Valores publicos conferidos em setembro de 2026 (sites e blogs do setor). */
  function tabelaConcorrentes(pr) {
    var linhas = [
      /* os dois concorrentes de verdade logo abaixo do Ligeiro; a comissao do iFood e a mesma da calculadora e do titulo */
      ['Ligeiro', reais(pr.mensal) + ' fixo', 'Nenhuma', true],
      ['iFood', 'R$ 110 a R$ 150', '15,2% a 26,2% de cada venda'],
      ['Anota AI', 'R$ 99,99 a R$ 299,99', 'Nenhuma'],
      ['Goomer', 'R$ 99,90 a R$ 299,90', 'Nenhuma'],
      ['Cardápio Web', 'R$ 169,99 a R$ 269,99', 'Nenhuma'],
      ['Delivery Direto', 'R$ 129 a R$ 289', 'Nenhuma'],
      ['aiqfome', 'Sem mensalidade', '12% a 18% de cada venda + taxa do pagamento'],
    ];
    return el('div', { class: 'comparativo' }, [
      el('div', { class: 'kicker', text: 'Quanto cobram o iFood, o Anota AI e os outros' }),
      el('div', { class: 'rolagem' }, el('table', { class: 'tabela tabela-concorrentes' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Sistema' }), el('th', { text: 'Por mês' }), el('th', { text: 'Comissão' })])),
        el('tbody', {}, linhas.map(function (l) {
          return el('tr', { class: l[3] ? 'destaque' : '' }, [el('td', {}, el('b', { text: l[0] })), el('td', { text: l[1] }), el('td', { text: l[2] })]);
        })),
      ])),
      el('p', { class: 'muted pequeno', text: 'Valores públicos em setembro de 2026, conferidos nos sites e blogs do setor. Cada um pode mudar a tabela; o Ligeiro é ' + reais(pr.mensal) + ' e não sobe com os pedidos. iFood, Anota AI e os outros nomes são marcas dos seus donos; o Ligeiro não tem ligação com eles.' }),
    ]);
  }

  function raio(icone, titulo, texto, tag) {
    return el('div', { class: 'cartao raio' }, [el('span', { class: 'icone', text: icone }), el('b', { text: titulo }), el('p', { text: texto }), el('span', { class: 'tag', text: tag })]);
  }
  function duvida(pergunta, resposta) {
    return el('details', { class: 'duvida' }, [el('summary', { text: pergunta }), el('p', { text: resposta })]);
  }

  window.LigeiroParceiro = { abrir: abrir, assinar: assinar, entrar: entrar, termos: termos, privacidade: privacidade, barraTopo: barraTopo, abrirContato: abrirContato };
})();
