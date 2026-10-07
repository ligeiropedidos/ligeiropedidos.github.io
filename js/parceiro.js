/*
 * Ligeiro - paginas de venda e de assinatura.
 *
 *   #/ (e #/lojas)  landing pra dono de lanchonete (o que o Mateus manda no WhatsApp)
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
    /* nenhuma vaga usada ainda: sem a contagem ("restam 5 de 5" com a barra cheia parecia que ninguem comprou) */
    var nenhumaUsada = restam >= total;
    return el('div', { class: 'fundador' + (nenhumaUsada ? ' sem-contagem' : '') }, [
      el('div', { class: 'fundador-lado' }, [
        el('span', { class: 'fundador-selo' }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), 'Preço de fundador']),
        el('p', { class: 'fundador-texto', text: 'Para as ' + total + ' primeiras lojas: ' + reais(R.precoDoPlano('uma', 'mensal')) + ' por mês, travado enquanto você não cancelar.' }),
      ]),
      nenhumaUsada ? null : el('div', { class: 'fundador-conta' }, [
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
    /* o dedo encostou no Entrar: o banco ja comeca a baixar, e o botao do Google chega pronto mais cedo */
    entrar.addEventListener('pointerdown', function () { var s = D() && D().store; if (s && s.aquecer) s.aquecer(); });
    /* celular pequeno (ate 360): "Assinar"; o "agora" nao cabe do lado do Entrar */
    var assinar = el('a', { class: 'btn btn-principal btn-pequeno btn-assinar', href: '#/comecar' }, [el('span', { class: 'rot-longo', text: 'Começar grátis' }), el('span', { class: 'rot-curto', text: 'Começar' })]);
    var acoes = el('div', { class: 'barra-acoes' }, [entrar, assinar]);
    var barra = el('div', { class: 'barra-topo' }, [
      el('a', { class: 'marca', href: '#/' }, [el('img', { class: 'mascote', src: 'img/mascote-192.webp', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
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
    var logado = !!(store && store.pareceLogado && store.pareceLogado());
    if (logado) comoLogado(true);
    /* o Firebase confirma (e traz o nome) ou corrige se a sessao tiver caido. Quem nunca entrou neste aparelho nao
       espera por ele: o banco e o login (uns 300 KB, e o processador do celular ocupado com eles) so vem quando a pessoa
       mexe na pagina (toque, rolagem ou tecla). Quem so abre e sai nao gasta internet nem bateria com isso */
    function conferir() { store.usuarioAtual().then(function (u) { comoLogado(!!u, u); }); }
    function aoPrimeiroToque(fn) {
      var eventos = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'], feito = false;
      function uma() { if (feito) return; feito = true; eventos.forEach(function (e) { window.removeEventListener(e, uma, true); }); fn(); }
      eventos.forEach(function (e) { window.addEventListener(e, uma, { capture: true, passive: true }); });
    }
    if (store && store.usuarioAtual) {
      if (logado) conferir();
      else aoPrimeiroToque(function () { setTimeout(conferir, 1200); });
    }
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
      var soltar = UI.ocupar(btn, 'Enviando…');
      if (!soltar) return;
      D().store.salvarLead({ nome: nome, whatsapp: whatsapp, loja: f.loja.input.value.trim(), cidade: cid.nome || '', uf: cid.uf || '', origem: origem || 'site', pagina: '#/' + window.LigeiroApp.rota() + ' [' + (window.LigeiroVariante || 'ifood') + ']' })
        .then(function () { if (window.LigeiroMeta) window.LigeiroMeta.evento('Lead'); UI.soar('sucesso'); contatoRecebido(nome, f.whatsapp.input.value, espera); })
        .catch(function (e) {
          soltar();
          /* nao salvou (limite do banco no pico, internet): o contato nao se perde, vai pronto pelo WhatsApp do Ligeiro */
          if (c.whatsappLigeiro && !corpo.querySelector('.contato-falhou')) {
            var texto = [espera ? 'Oi! Quero entrar na lista de espera do Ligeiro.' : 'Oi! Quero saber mais sobre o Ligeiro para minha loja.', 'Nome: ' + nome, 'WhatsApp: ' + f.whatsapp.input.value, f.loja.input.value.trim() ? 'Loja: ' + f.loja.input.value.trim() : '', cid.nome ? 'Cidade: ' + cid.nome + (cid.uf ? '/' + cid.uf : '') : ''].filter(Boolean).join(String.fromCharCode(10));
            corpo.appendChild(el('a', { class: 'btn btn-whats btn-largo contato-falhou', href: linkWhats(texto), target: '_blank', rel: 'noopener' }, [el('span', { class: 'icone-zap', 'aria-hidden': 'true' }), 'Mandar pelo WhatsApp']));
            UI.avisar('Não deu para salvar agora. Toque em Mandar pelo WhatsApp que a gente anota.');
          } else UI.avisar(D().erroAmigavel(e, 'Não deu para enviar. Tente de novo.'));
        });
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
    /* abre o WhatsApp direto, como o nome promete (antes abria um formulario: dois toques e outra coisa) */
    var zap = linkWhats('Oi! Quero saber mais sobre o Ligeiro para minha loja.');
    var filhos = [
      el('span', { class: 'zap-icone' }, el('span', { class: 'icone-zap', 'aria-hidden': 'true' })),
      el('span', { class: 'zap-texto', text: 'Chamar no WhatsApp' }),
    ];
    raiz.appendChild(zap
      ? el('a', { class: 'zap-flutuante', href: zap, target: '_blank', rel: 'noopener', 'aria-label': 'Chamar no WhatsApp' }, filhos)
      : el('button', { class: 'zap-flutuante', type: 'button', 'aria-label': 'Chamar no WhatsApp', onclick: function () { abrirContato('botao-flutuante'); } }, filhos));
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
      /* a cidade ("Juquiá, SP") e o CNPJ nunca se partem no meio da linha */
      el('div', { class: 'ligeiro' }, ['Ligeiro: pedido ligeiro, sem comissão · ', el('span', { class: 'sem-quebra', text: e.cidade || 'Juquiá, SP' }), e.nome ? ' · ' + e.nome : '', e.cnpj ? el('span', { class: 'sem-quebra', text: ' · CNPJ ' + e.cnpj }) : '']),
    ];
    return el('footer', { class: 'rodape rodape-vendas' }, linhas);
  }

  /* ============================================================ landing */
  function abrir(raiz) {
    var lojaDemo = cfg().lojaDemo || 'juquia/dom-conizza';
    /* o link da loja de exemplo no formato de cada lugar: sem # no site publicado, com # na copia de teste (la o endereco
       sem # dava "arquivo nao encontrado") */
    var linkLojaDemo = UI.linkDoSite(lojaDemo);
    var pr = precos();
    document.title = 'Cardápio e catálogo digital com Pix, sem comissão | Ligeiro';

    function botoesChamada(grande, garantia) {
      /* um caminho so para comecar: o cadastro de 3 minutos ("assinar" soava como pagar agora) */
      var lista = [el('a', { class: 'btn btn-principal' + (grande ? ' btn-gigante' : ''), href: '#/comecar', text: 'Começar grátis' })];
      /* o que mais tira o medo de comecar fica colado no botao, sem precisar rolar */
      if (garantia) lista.push(el('p', { class: 'garantia-botao' }, [UI.iconeLinha('check'), 'Loja pronta em 3 minutos, sem cartão de crédito e sem fidelidade.']));
      /* o WhatsApp ja tem o botao flutuante: aqui nao repete. O segundo botao mostra o comercial (as lojas ficam no rodape) */
      lista.push(el('button', { class: 'btn btn-fantasma btn-video' + (grande ? '' : ' btn-pequeno'), type: 'button', onclick: abrirVideo }, [
        el('span', { class: 'video-play', 'aria-hidden': 'true' }), el('span', { text: 'Ver como funciona' }), el('span', { class: 'video-tempo', text: '51 s' }),
      ]));
      /* prova na hora, sem cadastro: uma loja de verdade para abrir e pedir (so no topo) */
      if (grande) lista.push(el('a', { class: 'link-loja-real', href: linkLojaDemo, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('loja'), 'Ou abra uma loja de verdade']));
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
      var total = (cfg().fundador || {}).vagas || 0;
      var rotulo = restam >= total ? 'Preço de fundador: ' + reais(pr.mensal) + ' travado' : 'Restam ' + restam + (restam === 1 ? ' vaga' : ' vagas') + ' de fundador';
      return el('a', { class: 'selo selo-fundador', href: '#planos', onclick: function (e) {
        var alvo = document.getElementById('planos');
        if (alvo) { e.preventDefault(); alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), rotulo]);
    }

    raiz.appendChild(barraTopo());

    /* o que o dono manda no WhatsApp se reveza no titulo: cardapio (comida) e catalogo (comercio). Todas as palavras no
       mesmo lugar da grade (a mais larga reserva o espaco: a linha nao pula) e a troca e so opacidade e deslize (anima
       tambem com "Reduzir movimento", como o resto do site). O leitor de tela ouve "cardapio ou catalogo" */
    var trocaTitulo = 0;
    function palavraQueTroca(palavras) {
      /* a palavra vem do CSS (data-p): para o Google, para quem copia e para o leitor de tela o titulo e um so, "Chega de
         mandar cardapio ou catalogo no WhatsApp." */
      var itens = palavras.map(function (p, i) { return el('span', { class: 'troca-item' + (i ? '' : ' ativa'), dataset: { p: p } }); });
      var caixa = el('span', { class: 'dor-destaque troca-palavra', 'aria-hidden': 'true' }, itens);
      var i = 0;
      trocaTitulo = setInterval(function () {
        if (!caixa.isConnected) { clearInterval(trocaTitulo); return; }
        var saiu = itens[i];
        saiu.classList.remove('ativa');
        saiu.classList.add('saindo');
        /* ja invisivel, volta para baixo sem aparecer (fica pronta para a proxima entrada) */
        setTimeout(function () { saiu.classList.remove('saindo'); }, 260);
        i = (i + 1) % itens.length;
        itens[i].classList.add('ativa');
      }, 2600);
      return [el('span', { class: 'oculto-visual', text: palavras.join(' ou ') }), caixa];
    }

    /* O cartao "a gente monta" do topo (07/10/2026, ideia do formulario do Anota AI, em versao curta): 3 campos, sem login,
       e o contato cai na Central (aba Contatos) como o "Fale com a gente". Dono de loja quase nunca se cadastra sozinho; deixar
       o WhatsApp para a gente montar e o caminho que mais converte. Sem salvar (internet, limite do banco), o contato vai pronto
       pelo WhatsApp do Ligeiro: nada se perde */
    function cartaoMontamos() {
      var c = cfg();
      var cartao = el('section', { class: 'cartao-montamos', 'aria-labelledby': 'montamosTitulo' });
      var f = {
        nome: campoSimples('Seu nome', { max: 60, autocomplete: 'name' }),
        whatsapp: campoSimples('Seu WhatsApp', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999', autocomplete: 'tel' }),
        loja: campoSimples('Nome da loja', { max: 60, placeholder: 'Ex: Lanchonete do Zé', autocomplete: 'organization' }),
      };
      UI.mascaraTelefone(f.whatsapp.input);
      function enviar() {
        var nome = f.nome.input.value.trim();
        var whatsapp = f.whatsapp.input.value.replace(/\D/g, '');
        var loja = f.loja.input.value.trim();
        if (whatsapp.length > 11 && whatsapp.indexOf('55') === 0) whatsapp = whatsapp.slice(2);
        if (nome.length < 2) { UI.avisar('Digite seu nome.'); f.nome.input.focus(); return; }
        if (whatsapp.length < 10) { UI.avisar('Digite o WhatsApp com DDD.'); f.whatsapp.input.focus(); return; }
        if (loja.length < 2) { UI.avisar('Digite o nome da loja.'); f.loja.input.focus(); return; }
        var soltar = UI.ocupar(botao, 'Enviando…');
        if (!soltar) return;
        var texto = ['Oi! Quero a minha loja pronta no Ligeiro.', 'Nome: ' + nome, 'WhatsApp: ' + f.whatsapp.input.value, 'Loja: ' + loja].join('\n');
        D().store.salvarLead({ nome: nome, whatsapp: whatsapp, loja: loja, cidade: '', uf: '', origem: 'home-cartao', pagina: '#/' + window.LigeiroApp.rota() + ' [' + (window.LigeiroVariante || 'ifood') + ']' })
          .then(function () {
            if (window.LigeiroMeta) window.LigeiroMeta.evento('Lead');
            UI.soar('sucesso');
            /* o cartao vira a confirmacao, com o numero para a pessoa conferir e o WhatsApp para quem quer falar ja */
            UI.limpar(cartao);
            cartao.classList.add('enviado');
            cartao.appendChild(el('div', { class: 'contato-ok', role: 'status' }, [
              el('span', { class: 'contato-ok-marca', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]),
              el('b', { text: 'Recebemos, ' + nome.split(/\s+/)[0] + '!' }),
              el('span', { text: 'A gente chama você no WhatsApp ' + f.whatsapp.input.value + ' em breve.' }),
            ]));
            if (c.whatsappLigeiro) cartao.appendChild(el('a', { class: 'btn btn-whats btn-largo', href: linkWhats(texto), target: '_blank', rel: 'noopener' }, [el('span', { class: 'icone-zap', 'aria-hidden': 'true' }), 'Falar agora no WhatsApp']));
          })
          .catch(function (e) {
            soltar();
            if (c.whatsappLigeiro && !cartao.querySelector('.contato-falhou')) {
              cartao.insertBefore(el('a', { class: 'btn btn-whats btn-largo contato-falhou', href: linkWhats(texto), target: '_blank', rel: 'noopener' }, [el('span', { class: 'icone-zap', 'aria-hidden': 'true' }), 'Mandar pelo WhatsApp']), seguro);
              UI.avisar('Não deu para salvar agora. Toque em Mandar pelo WhatsApp que a gente anota.');
            } else UI.avisar(D().erroAmigavel(e, 'Não deu para enviar. Tente de novo.'));
          });
      }
      var botao = el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: enviar, text: 'Quero minha loja pronta' });
      var seguro = el('p', { class: 'contato-seguro' }, [UI.iconeLinha('cadeado'), 'Sem compromisso. Seu número só é usado para a gente falar com você.']);
      [f.nome, f.whatsapp, f.loja].forEach(function (x) { x.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(); } }); });
      /* o topo do formulario, limpo como nos sites profissionais (07/10/2026: ele nao gostou da faixa verde com o mascotinho
         dentro do cartao): titulo e frase de apoio no proprio cartao, no meio */
      cartao.appendChild(el('div', { class: 'montamos-topo' }, [el('h2', { id: 'montamosTitulo', text: 'Quer a sua loja pronta?' }), el('p', { text: 'A gente monta tudo e chama você no WhatsApp.' })]));
      cartao.appendChild(el('div', { class: 'grade-form' }, [f.nome, f.whatsapp, f.loja]));
      cartao.appendChild(botao);
      cartao.appendChild(seguro);
      return cartao;
    }

    /* ---------- heroi ---------- */
    var porCardapio = window.LigeiroVariante === 'cardapio';
    var seloLojas = el('span', { class: 'selo', hidden: true });
    /* os selos do topo: o de fundador (so com vaga) e o de lojas (so com 5 ou mais). Sem nenhum, a linha some (senao ficava o vao) */
    var seloFund = seloFundador();
    var selosTopo = el('div', { class: 'vender-selos', hidden: !seloFund }, [seloFund, seloLojas]);
    var capa = el('div', { class: 'vender-capa' }, [
      el('div', { class: 'heroi-mascote-caixa' }, el('img', { class: 'heroi-mascote', src: 'img/mascote.webp', alt: 'Mascote do Ligeiro: um rato chef com um pedido na bandeja e o celular na mão' })),
      el('div', { class: 'heroi-texto' }, [
        /* nome de marca nunca parte no meio ("Anota" numa linha e "AI" na outra) */
        /* dois titulos (app.js decide: LigeiroVariante). Anuncio do Meta: o cardapio que recebe pedido e Pix sozinho, que e a dor de quem
           vende pelo WhatsApp (no Vale o iFood pesa pouco). O resto: a comissao */
        porCardapio
          ? el('div', { class: 'kicker', text: 'Cardápio e catálogo digital, com pedido e Pix automáticos' })
          : el('div', { class: 'kicker' }, ['A alternativa ao ', el('span', { class: 'sem-quebra', text: 'iFood' }), ' e ao ', el('span', { class: 'sem-quebra', text: 'Anota AI' }), ' para receber pedidos pelo WhatsApp']),
        /* abre pela dor (a comissao), como o comercial; a oferta vem logo embaixo */
        porCardapio
          ? el('h1', { class: 'vender-titulo' }, ['Chega de mandar '].concat(palavraQueTroca(['cardápio', 'catálogo']), [' no WhatsApp.']))
          : el('h1', { class: 'vender-titulo' }, ['Pare de dar até ', el('span', { class: 'dor-destaque', text: '26,2%' }), ' de cada pedido para o iFood.']),
        el('p', { class: 'vender-oferta' }, [pr.diasGratis + ' dias grátis. Depois, ', el('span', { class: 'preco-destaque', text: reais(pr.mensal) }), ' fixo por mês e ', el('span', { class: 'preco-destaque', text: '0%' }), ' de comissão.']),
        el('p', { class: 'vender-sub', text: porCardapio ? 'O cliente escolhe no seu cardápio ou catálogo, paga no Pix e o pedido apita no seu celular.' : 'Seu cliente pede por um link, o Pix cai confirmado e o pedido apita no seu celular.' }),
        botoesChamada(true, true),
        /* o "a gente monta para voce" virou o cartao ao lado (no celular, logo abaixo): o selo do WhatsApp saiu daqui */
        selosTopo,
      ]),
      cartaoMontamos(),
    ]);
    raiz.appendChild(capa);
    /* prova social de verdade: so aparece quando tem loja suficiente pra impressionar */
    if (D() && D().store.listarCidades) D().store.listarCidades().then(function (cidades) {
      var total = cidades.reduce(function (n, c) { return n + (c.lojas || 0); }, 0);
      if (total >= 5) { seloLojas.textContent = total + ' lojas em ' + cidades.length + (cidades.length === 1 ? ' cidade' : ' cidades'); seloLojas.hidden = false; selosTopo.hidden = false; }
    }).catch(function () { /* sem lista, sem selo */ });

    /* a capa pinta sozinha no primeiro quadro (e o que se ve ao abrir); o resto da pagina e o rodape aparecem no quadro
       seguinte. Montar e medir as secoes todas antes da primeira pintura travava o celular por 1,3 s (com a lentidao de 4x)
       antes do titulo aparecer */
    var corpo = el('div', { class: 'conteudo vender', hidden: true });
    raiz.appendChild(corpo);

    /* ---------- para quem e: comida e comercio, com os tipos do cadastro ---------- */
    var semOutro = function (lista) { return lista.map(function (x) { return x[0]; }).filter(function (n) { return !/^outr[oa] /i.test(n); }); };
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Para quem é' }),
      el('h2', { text: 'Comida ou comércio, a loja fala a sua língua' }),
      el('p', { class: 'muted segmentos-intro', text: 'Você escolhe o tipo no cadastro e o site se ajusta sozinho: cardápio com senha na lanchonete, catálogo com tamanho e estoque na loja de roupa.' }),
      el('div', { class: 'segmentos' }, [
        segmento('cardapio', 'Comida', 'Cardápio com foto, adicionais e "tirar ingrediente", senha do pedido e tela da cozinha.', semOutro(R.TIPOS_DE_LOJA)),
        segmento('sacola', 'Comércio', 'Catálogo com até 3 fotos por peça, tamanho com preço próprio, estoque que esgota sozinho e tela de separação.', semOutro(R.TIPOS_DE_COMERCIO)),
      ]),
    ]));

    /* ---------- calculadora ---------- */
    var vendas = el('input', { type: 'text', inputmode: 'numeric', value: dinheiro(500000), 'aria-label': 'Vendas por mês em pedidos' });
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
        /* as barras: o que cada sistema cobra (no iFood o pagamento online ja vem na comissao; nos de mensalidade, a taxa
           do pagamento fica a parte, e a do Ligeiro entra na frase e na nota de baixo) */
        ['Ligeiro', c.ligeiroMensal, 'fixo, em qualquer volume'],
      ].forEach(function (linha, i) {
        var maior = Math.max(c.ifoodEntrega, c.ifoodBasico, c.anotaAi, c.ligeiroMensal, 1);
        resultado.appendChild(el('div', { class: 'calc-linha' + (i === 3 ? ' ligeiro' : '') }, [
          el('div', { class: 'calc-cabeca' }, [el('b', { text: linha[0] }), el('span', { class: 'calc-valor', text: dinheiro(linha[1]) + '/mês' })]),
          el('div', { class: 'calc-trilho' }, el('span', { style: { width: Math.max(2, Math.round(linha[1] / maior * 100)) + '%' } })),
          el('small', { text: linha[2] }),
        ]));
      });
      /* a frase fecha a conta contra o iFood (o que a pagina promete no titulo); o Anota AI fica nas barras */
      var economia = c.ifoodBasico - c.ligeiro;
      UI.limpar(frase);
      if (economia > 0) {
        frase.appendChild(document.createTextNode('Pelo iFood, no plano Básico, iriam ' + dinheiro(c.ifoodBasico) + ' por mês. No Ligeiro, ' + dinheiro(c.ligeiroMensal) + ' de mensalidade e ' + dinheiro(c.ligeiroPix) + ' de taxa do Pix no Mercado Pago. '));
        frase.appendChild(el('b', { text: 'Ficam ' + dinheiro(economia) + ' por mês com você, ' + dinheiro(economia * 12) + ' em um ano.' }));
      } else if (economia === 0) frase.textContent = 'Com esse volume o Ligeiro custa o mesmo que o iFood. A diferença é que a mensalidade continua ' + dinheiro(pr.mensal) + ' quando a loja crescer.';
      else frase.textContent = 'Com esse volume, a comissão do iFood ainda sai mais barata que o Ligeiro. A conta vira a seu favor a partir de uns ' + dinheiro(Math.ceil(pr.mensal / (0.152 - c.taxaPix) / 10000) * 10000) + ' por mês de vendas.';
      /* o botao leva o numero da conta (o que a pessoa acabou de ver que fica com ela) */
      UI.limpar(ctaCalc);
      ctaCalc.appendChild(el('span', { text: 'Começar grátis' }));
      if (economia > 0) ctaCalc.appendChild(el('span', { class: 'sub', text: 'e ficar com ' + reais(Math.round(economia / 100) * 100) + ' por mês' }));
    }
    var ctaCalc = el('a', { class: 'btn btn-principal btn-calc', href: '#/comecar' });
    vendas.addEventListener('input', calcular);
    pedidos.addEventListener('input', calcular);
    calcular();

    corpo.appendChild(el('section', { class: 'vender-bloco vender-calc' }, [
      el('div', { class: 'calc-entrada' }, [
        el('div', { class: 'kicker', text: 'Faça a conta' }),
        el('h2', { text: 'Quanto você deixa na mesa hoje?' }),
        el('p', { class: 'muted', text: 'Coloque mais ou menos quanto vende por mês em pedidos (entrega e retirada) e quantos pedidos são. A conta é só com o que vai para o intermediário ou para o sistema.' }),
        el('div', { class: 'linha-campos' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Vendas por mês' }), vendas]),
          el('div', { class: 'campo' }, [el('label', { text: 'Pedidos' }), pedidos]),
        ]),
      ]),
      el('div', { class: 'calc-resultado' }, [resultado, frase, ctaCalc, el('p', { class: 'calc-fonte', text: 'Preços públicos do iFood e do Anota AI em setembro de 2026. No iFood, o pagamento online já está na comissão; no Ligeiro, o Pix tem a taxa do Mercado Pago (0,99% por venda), paga direto a ele e já descontada na conta acima.' })]),
    ]));

    /* ---------- antes e depois: um celular em cada lado (07/10/2026, como o do Anota AI). Sem: o WhatsApp lotado, com as dores
       na ordem (o Pix falso primeiro). Com: o painel de verdade (a loja de exemplo da demonstracao) com o Pix confirmado. O
       celular e o mesmo da "loja de verdade" e a lista sobe por cima dele num cartao branco ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Antes e depois' }),
      el('h2', { text: 'Sem Ligeiro vs com Ligeiro' }),
      el('div', { class: 'antes-depois com-celular' }, [
        el('div', { class: 'cartao lado sem' }, [
          el('div', { class: 'ad-cena', 'aria-hidden': 'true' }, celularAberto('ad-cel ad-cel-zap', [telaWhatsLotado()])),
          el('div', { class: 'ad-lista' }, [el('b', { text: 'Sem Ligeiro' })].concat(['Comissão comendo a margem', 'Comprovante de Pix falso passando', 'WhatsApp lotado na hora do pico', 'Pedido anotado errado', 'Cliente perguntando "tem no M?" e "e o meu pedido?"', 'Fim do mês sem saber quanto vendeu'].map(function (t) { return el('p', {}, [UI.iconeLinha('fechar'), t]); }))),
        ]),
        el('div', { class: 'cartao lado com' }, [
          el('div', { class: 'ad-cena' }, celularAberto('ad-cel ad-cel-painel', [el('img', { src: 'img/venda/painel-pedido-pix.webp', alt: 'O painel do Ligeiro com um pedido novo e o Pix confirmado', width: '520', height: '827', loading: 'lazy', decoding: 'async' })])),
          el('div', { class: 'ad-lista' }, [el('b', { text: 'Com Ligeiro' })].concat(['0% de comissão: a margem fica com você', 'Pix e cartão confirmados pelo Mercado Pago: print falso não passa', 'Cliente monta o pedido sozinho pelo link', 'Pedido chega certo, com número e endereço', 'Tamanho, estoque e andamento do pedido na tela do cliente', 'Vendas do dia e da semana no painel'].map(function (t) { return el('p', {}, [UI.iconeLinha('check'), t]); }))),
        ]),
      ]),
    ]));

    /* ---------- como funciona ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Como funciona' }),
      el('h2', { text: 'Três passos, e o pedido cai' }),
      el('div', { class: 'passos-venda' }, [
        passo('1', 'Sua loja nasce em 3 minutos', 'Nome, WhatsApp e frete. O cardápio ou o catálogo já vem montado para o seu tipo de loja; você só ajusta os preços.', 'lima', cenaPassoLoja()),
        passo('2', 'Você espalha o link', 'Bio do Instagram, status e saudação automática do WhatsApp, QR no balcão. Quem pede uma vez, pede de novo pelo link.', 'azul', cenaPassoLink()),
        passo('3', 'O pedido cai apitando', 'No seu celular ou no computador do caixa, com número, itens, endereço com referência e o pagamento já conferido para você.', 'laranja', cenaPassoAviso()),
      ]),
    ]));

    /* ---------- loja de verdade: o que o cliente do dono vai ver ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco loja-real' }, [
      /* no celular o texto vem primeiro, o celular no meio e o botao embaixo; no computador o texto fica ao lado */
      el('div', { class: 'loja-real-texto' }, [
        el('div', { class: 'kicker', text: 'Loja de verdade' }),
        el('h2', { text: 'Veja o que o seu cliente vai ver' }),
        el('p', { class: 'muted', text: 'A Dom Conizza montada no Ligeiro: abra o cardápio e veja como o cliente escolhe e paga.' }),
        el('a', { class: 'btn btn-fantasma loja-real-botao', href: linkLojaDemo, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('loja'), 'Abrir a loja']),
      ]),
      el('a', { class: 'loja-real-vitrine', href: linkLojaDemo, target: '_blank', rel: 'noopener', 'aria-label': 'Abrir a loja da Dom Conizza', tabindex: '-1' }, [
        /* o aparelho: borda, ilha, hora e bateria em CSS (sem imagem a mais); a tela e o print da loja */
        el('span', { class: 'loja-real-cel' }, el('span', { class: 'loja-real-tela' }, [
          barraDoCelular(),
          el('img', { src: 'img/loja-ligeiro/exclusivo.webp', alt: 'A loja da Dom Conizza no celular', width: '390', height: '620', loading: 'lazy', decoding: 'async' }),
        ])),
      ]),
    ]));

    /* ---------- o que vem: as funcoes em abas (07/10/2026, como as abas do Anota AI): 3 assuntos com 4 cartoes cada, icone
       em quadrado colorido com o titulo do lado. 4 por aba: 2 x 2 no tablet e 4 numa linha no PC (com 9 soltos, um sobrava
       sozinho na largura toda). So o que o Ligeiro tem de verdade ---------- */
    corpo.appendChild(secaoFuncoes());

    /* ---------- a gente monta: o que a pessoa manda e o que recebe (sem tempo de montar nao e motivo para ficar de fora) ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Sem tempo de montar?' }),
      el('h2', { text: 'A gente monta a loja para você' }),
      el('p', { class: 'muted', text: 'Você manda pelo WhatsApp o que já tem. A gente cadastra tudo e devolve a loja pronta para vender.' }),
      el('div', { class: 'antes-depois monta' }, [
        /* a conversa no WhatsApp: o dono manda as fotos do cardapio e recebe a loja pronta (sem horario nos baloes: nada de prazo) */
        el('div', { class: 'monta-cena', 'aria-hidden': 'true' }, celularAberto('ad-cel ad-cel-chat', [telaConversaMonta()])),
        el('div', { class: 'cartao lado manda' }, [el('b', { text: 'Você manda' })].concat([['camera', 'Fotos do cardápio ou dos produtos'], ['dinheiro', 'Os preços (e os tamanhos, se tiver)'], ['imagem', 'Sua logo, se tiver'], ['relogio', 'Horário e taxa de entrega']].map(function (x) { return el('p', {}, [UI.iconeLinha(x[0]), x[1]]); }))),
        el('div', { class: 'cartao lado com' }, [el('b', { text: 'Você recebe' })].concat(['A loja montada, com fotos e categorias', 'O link para a bio do Instagram e o status', 'O QR code para imprimir no balcão', 'Ajuda para ligar o Pix do Mercado Pago'].map(function (x) { return el('p', {}, [UI.iconeLinha('check'), x]); }))),
      ]),
    ]));

    /* ---------- teste gratis ---------- */
    /* faixa escura da marca: selo, titulo, garantias e duas saidas (criar sozinho ou pedir para a gente montar) */
    corpo.appendChild(el('section', { class: 'teste-banner' }, [
      el('div', { class: 'teste-texto' }, [
        el('span', { class: 'teste-selo' }, [el('span', { class: 'estrela', 'aria-hidden': 'true' }, [UI.iconeLinha('estrela')]), 'Teste grátis por ' + pr.diasGratis + ' dias']),
        el('h2', {}, ['Sua loja no ar ', el('span', { class: 'destaque', text: 'em 3 minutos' }), ', já montada para o que você vende.']),
        el('ul', { class: 'teste-checks' }, ['Sem cartão de crédito', 'Cancela quando quiser', 'Todos os recursos'].map(function (t) { return el('li', { text: t }); })),
      ]),
      el('div', { class: 'teste-botoes' }, [
        el('a', { class: 'btn btn-principal btn-gigante', href: '#/comecar', text: 'Começar grátis' }),
        el('button', { class: 'btn btn-contorno', type: 'button', text: 'Quero que montem para mim', onclick: function () { abrirContato('teste-montar'); } }),
      ]),
    ]));

    /* ---------- planos ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco', id: 'planos' }, [
      el('div', { class: 'kicker', text: 'Preço' }),
      el('h2', { text: 'Um plano só. Tudo incluso.' }),
      el('p', { class: 'muted' }, [el('b', { class: 'por-dia', text: 'Menos de ' + reais(Math.floor(pr.mensal / 30 / 10) * 10 + 10) + ' por dia.' }), ' Com cardápio ou catálogo, estoque, ofertas, painel, cozinha e entregador, Pix e cartão automáticos.']), /* o resto esta na lista do lado (ilimitados, sem comissao, cartao, boleto ou Pix) e no cartao do plano (sem fidelidade) */
      (function () {
        var t = 'mensal';
        var caixa = el('div', { class: 'pilha planos-venda' });
        function d() {
          UI.limpar(caixa);
          /* as partes saem da caixa dos cartoes para a secao: no computador ela vira duas colunas (a faixa do fundador em
             cima; cartoes e botao na esquerda, o que vem incluso na direita). No celular a ordem continua a mesma */
          var planos = cartoesPlanos(t, function (n) { t = n; d(); });
          var faixa = planos.querySelector(':scope > .fundador');
          var incluso = planos.querySelector(':scope > .plano-incluso');
          if (faixa) caixa.appendChild(faixa);
          caixa.appendChild(planos);
          if (incluso) caixa.appendChild(incluso);
          /* um botao so, grande: vai direto criar a loja com o que foi escolhido (a tela Assinar repetiria os cartoes) */
          caixa.appendChild(R.capacidadeLojas().fechado
            ? el('button', { class: 'btn btn-principal btn-gigante btn-largo', type: 'button', text: 'Entrar na lista de espera', onclick: function () { abrirContato('lista-espera'); } })
            : el('a', { class: 'btn btn-principal btn-gigante btn-largo', href: '#/comecar/uma/' + t, text: 'Começar grátis' }));
        }
        d();
        return caixa;
      })(),
      tabelaConcorrentes(pr),
    ]));

    /* ---------- duvidas ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Dúvidas' }),
      el('h2', { text: 'O que todo dono pergunta' }),
      el('div', { class: 'faq' }, [
        duvida('Preciso cadastrar cartão para testar?', 'Não. Você cria a loja, usa ' + pr.diasGratis + ' dias com tudo liberado e só então decide. Se não quiser continuar, não paga nada.'),
        duvida('Eu não entendo de internet. Vou conseguir?', 'Vai. Se preferir, a gente monta a loja para você e tira dúvidas pelo WhatsApp. Depois, mudar preço ou pausar um item é um toque no celular.'),
        duvida('Já uso iFood. Preciso sair de lá?', 'Não. Muita loja usa os dois: o iFood para quem vem de fora e o Ligeiro para quem já é cliente, sem comissão. Cada pedido pelo seu link é margem que fica com você.'),
        duvida('Tem fidelidade? E se eu não gostar?', 'Não tem. Para cancelar, toque em "Encerrar assinatura" em Minha conta: a cobrança do cartão para na hora. Parou de pagar, a loja sai do ar depois de 10 dias de aviso e seus dados ficam guardados por 90 dias, caso volte.'),
        duvida('Como eu recebo o dinheiro do Pix?', 'Direto na sua conta do Mercado Pago, que você conecta no painel com um toque; o Ligeiro nunca encosta no dinheiro. O Mercado Pago confirma na hora e o pedido já entra pago no painel (taxa deles: 0,99% por Pix).'),
        duvida('O Ligeiro vê a minha senha do Mercado Pago?', 'Não. Você autoriza dentro do próprio Mercado Pago, pela autorização oficial deles: o Ligeiro recebe só uma permissão limitada para criar os pagamentos da sua loja, nunca a sua senha. O dinheiro cai direto na sua conta, e você desconecta quando quiser, no painel.', { texto: 'Ver a explicação do Mercado Pago', href: 'https://www.mercadopago.com.br/developers/pt/docs/security/oauth/introduction' }),
        duvida('E o cartão de crédito pelo site?', 'Vem da mesma conexão: o cliente digita o cartão no formulário seguro do Mercado Pago e o pedido já cai pago. A taxa é do Mercado Pago, cerca de 5% por venda, e você pode repassar ao cliente.'),
        duvida('Serve para entrega e para retirada?', 'Serve. Na hora de pedir, o cliente escolhe: entrega no endereço, com a taxa que você definir, ou retirada na loja.'),
        duvida('Meus clientes vão saber pedir pelo link?', 'Vão. É como um cardápio ou catálogo com foto: toca no item, escolhe e paga. E quem chamar no WhatsApp recebe o link na hora, pela saudação automática do WhatsApp Business, sem você digitar nada.'),
        duvida('Tem sistema grátis. Por que eu pagaria ' + reais(pr.mensal) + '?', 'Os planos grátis que olhamos em setembro de 2026 costumam limitar os pedidos por mês (de 30 a 65, em vários) e cobrar por pedido a mais ou parar de receber. No Ligeiro o pedido é ilimitado e o Pix cai confirmado sozinho. Você testa ' + pr.diasGratis + ' dias com tudo liberado, sem cartão, e só paga se compensar.'),
        duvida('Preciso de CNPJ para criar a loja?', 'O Ligeiro não pede CNPJ para criar a loja. O dinheiro do Pix e do cartão cai na sua conta do Mercado Pago, que tem as próprias regras para abrir a conta.'),
        duvida('Como eu pago a mensalidade?', 'Do jeito que preferir, em "Minha conta": cartão de crédito (cai sozinho todo mês, sem lembrar de pagar), boleto ou Pix na hora. Sem comissão e sem taxa escondida: é ' + reais(pr.mensal) + ' e pronto.'),
        duvida('Preciso instalar alguma coisa?', 'Não. Você usa o painel no celular que já tem (tela na cozinha ou na separação e impressora são opcionais). E o seu cliente só abre o link: escolhe, paga e acompanha o pedido, em qualquer celular.'),
        duvida('E o Anota AI? Qual a diferença?', 'O Anota AI tem robô no WhatsApp e cobra por faixa de pedidos (os valores estão na tabela de preços acima). Ele pertence ao iFood desde 2022. No Ligeiro é ' + reais(pr.mensal) + ' fixo por mês, sem limite de pedidos e sem robô no meio: o cliente pede sozinho pelo link e o Pix e o cartão são confirmados pelo Mercado Pago.'),
      ]),
    ]));

    /* o design exclusivo (servico extra) saiu daqui: oferecer R$ 399 a quem ainda nao decidiu os R$ 79 atrapalhava o
       cadastro. Ele mora na Loja do Ligeiro, dentro do painel, e aparece numa pergunta das duvidas */

    /* ---------- fechamento ---------- */
    corpo.appendChild(el('section', { class: 'vender-final' }, [
      el('img', { class: 'final-mascote', src: 'img/mascote-192.webp', alt: '' }),
      el('h2', { text: 'Quer ver funcionando na sua loja?' }),
      el('p', { class: 'muted', text: 'Comece grátis agora ou peça para a gente montar: cadastramos tudo e os primeiros dias são por nossa conta.' }),
      /* dois caminhos so: comecar sozinho ou pedir para a gente montar */
      el('div', { class: 'pilha chamada' }, [
        el('a', { class: 'btn btn-principal btn-gigante', href: '#/comecar', text: 'Começar grátis' }),
        el('button', { class: 'btn btn-fantasma', type: 'button', text: 'Quero que montem para mim', onclick: function () { abrirContato('fechamento'); } }),
      ]),
    ]));
    var rodapeDaPagina = rodape();
    rodapeDaPagina.hidden = true;
    raiz.appendChild(rodapeDaPagina);
    botaoFlutuante(raiz);

    /* barra fixa no celular: aparece quando o heroi sai da tela */
    var barra = el('div', { class: 'cta-fixa', 'aria-hidden': 'true' }, [
      el('span', {}, [el('b', { text: pr.diasGratis + ' dias grátis' }), el('span', { class: 'cta-sep', text: ' · ' }), 'sem cartão']),
      el('a', { class: 'btn btn-principal btn-pequeno', href: '#/comecar', text: 'Começar grátis' }),
    ]);
    raiz.appendChild(barra);
    /* some tambem quando um "Começar grátis" grande ja esta na tela (dois botoes iguais, um em cima do outro, confundem) */
    /* todos os "Começar grátis" grandes da pagina, inclusive o dos precos (#/comecar/uma/mensal ou anual); o pequeno do topo nao conta */
    var grandes = [].slice.call(corpo.querySelectorAll('a.btn-principal[href^="#/comecar"]')).filter(function (a) { return !a.classList.contains('btn-pequeno'); });
    /* com folga, e folga diferente para sumir e para voltar: no iPhone a barra de endereco encolhe e cresce ao rolar e muda
       a altura da tela; com o botao grande bem na beirada, a barra sumia e voltava sem parar (piscava) */
    var mostrando = false, trocouEm = 0;
    function naTela(e) {
      /* a altura estavel da tela (no iPhone ela nao muda com a barra de endereco, a innerHeight muda) */
      var h = document.documentElement.clientHeight || window.innerHeight;
      var r = e.getBoundingClientRect(), folga = mostrando ? 200 : 80;
      return r.height > 0 && r.bottom > folga && r.top < h - folga;
    }
    /* no celular o botao do WhatsApp so aparece depois do heroi: na primeira tela ele ficava em cima do "Começar grátis" */
    var zapBotao = raiz.querySelector('.zap-flutuante');
    /* o botao do WhatsApp nao fica em cima de um botao da pagina ("Comecar gratis" da faixa, os planos...): enquanto cobre, some */
    function zapCobreBotao() {
      if (!zapBotao || zapBotao.classList.contains('no-heroi')) return false;
      var z = zapBotao.getBoundingClientRect();
      return [].some.call(raiz.querySelectorAll('.btn'), function (b) {
        if (b === zapBotao || b.closest('.cta-fixa')) return false;
        var r = b.getBoundingClientRect();
        return r.width > 0 && r.right > z.left && r.left < z.right && r.bottom > z.top && r.top < z.bottom;
      });
    }
    function conferirZap() {
      if (!zapBotao) return;
      /* no celular ele fica 16 acima da barra "Comecar gratis" quando ela aparece e 16 acima do pe quando ela some (antes ficava
         sempre na altura da barra: sem ela, sobrava um buraco embaixo) */
      zapBotao.classList.toggle('com-barra', mostrando);
      zapBotao.classList.toggle('sobre-botao', zapCobreBotao());
    }
    function conferirBarra() {
      var heroi = capa.getBoundingClientRect().bottom > 0;
      if (zapBotao) zapBotao.classList.toggle('no-heroi', heroi);
      var mostrar = !heroi && !grandes.some(naTela);
      /* no maximo uma troca a cada 0,35 s (a rolagem com embalo cruzava a beirada varias vezes); a ultima confere de novo */
      if (mostrar !== mostrando && Date.now() - trocouEm < 350) { clearTimeout(conferirBarra.depois); conferirBarra.depois = setTimeout(conferirBarra, 360); conferirZap(); return; }
      if (mostrar !== mostrando) {
        trocouEm = Date.now();
        mostrando = mostrar;
        barra.classList.toggle('visivel', mostrar);
        barra.setAttribute('aria-hidden', mostrar ? 'false' : 'true');
        /* depois de subir ou descer junto com a barra, confere de novo se ficou em cima de algum botao */
        clearTimeout(conferirZap.depois); conferirZap.depois = setTimeout(conferirZap, 300);
      }
      conferirZap();
    }
    window.addEventListener('scroll', conferirBarra, { passive: true });
    window.addEventListener('resize', conferirBarra);
    /* depois da primeira pintura: mostra o resto e so entao mede (medir antes forcava o layout da pagina inteira) */
    var mostrarResto = 0;
    requestAnimationFrame(function () {
      mostrarResto = setTimeout(function () {
        corpo.hidden = false;
        rodapeDaPagina.hidden = false;
        conferirBarra();
      }, 0);
    });

    return function () { clearTimeout(mostrarResto); clearInterval(trocaTitulo); clearTimeout(conferirBarra.depois); window.removeEventListener('scroll', conferirBarra); window.removeEventListener('resize', conferirBarra); document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* Mensal e anual lado a lado (1 loja por conta), com o que vem incluso uma vez so, embaixo: da para comparar sem tocar
     em nada. O toque escolhe (borda verde e o check); o botao grande fica fora, embaixo (na pagina de vendas "Começar
     grátis", em #/assinar o "Mudar para"). conta: o preco dela (fundador fica travado mesmo depois que as vagas acabam) */
  function cartoesPlanos(escolhido, aoEscolher, conta) {
    var ehCliente = !!conta;
    /* vagas cheias so mudam a tela de quem ainda nao e cliente (quem ja tem conta so troca mensal/anual) */
    var fechado = R.capacidadeLojas().fechado && !ehCliente;
    var pr = precos();
    var p = R.planoPorId('uma');
    var tipos = p.anual > 0 ? ['mensal', 'anual'] : ['mensal'];
    var deFundador = R.precoDoPlano(p.id, 'mensal', conta) < p.mensal;
    var jaFundador = !!(conta && conta.plano && conta.plano.fundador === true);
    var cartoes = tipos.map(function (t) {
      var preco = R.precoDoPlano(p.id, t, conta);
      var normal = t === 'anual' ? p.anual : p.mensal;
      /* anual: quanto sai por mes, com os centavos (R$ 74,17 e nao "R$ 74") */
      var sub = t === 'anual' ? el('span', { class: 'sem-quebra', text: dinheiro(Math.round(preco / 12)) + '/mês' }) : 'Sem fidelidade';
      /* preco de fundador: o normal riscado em cima (a faixa de cima explica as vagas); quem ja e fundador: "travado" */
      var antes = !deFundador ? null
        : jaFundador ? el('div', { class: 'plano-antes' }, [UI.iconeLinha('estrela'), 'Fundador, travado'])
        : el('div', { class: 'plano-antes' }, [el('s', { text: reais(normal) }), el('span', { class: 'plano-antes-rotulo' }, [UI.iconeLinha('estrela'), 'Fundador'])]);
      var card = el('button', { class: 'plano-card' + (escolhido === t ? ' escolhido' : ''), type: 'button', 'aria-pressed': String(escolhido === t) }, [
        t === 'anual' ? el('span', { class: 'plano-etiqueta', text: '2 meses grátis' }) : null,
        /* o circulo de escolha nos dois (vazio ou verde com o check): mostra que da para tocar */
        el('span', { class: 'plano-visto', 'aria-hidden': 'true' }, escolhido === t ? [UI.iconeLinha('check')] : []),
        el('div', { class: 'plano-titulo', text: p.nome + (t === 'anual' ? ' Anual' : ' Mensal') }),
        antes,
        el('div', { class: 'plano-preco-caixa' }, el('div', { class: 'plano-preco' }, [reais(preco), el('small', { text: t === 'anual' ? '/ano' : '/mês' })])),
        el('div', { class: 'plano-sub' }, sub),
      ]);
      if (aoEscolher) card.addEventListener('click', function () { aoEscolher(t); });
      /* quantas partes o cartao tem (a etiqueta e o visto flutuam e nao contam): vira as linhas do subgrid, para as partes
         dos dois cartoes ficarem na mesma altura */
      card.style.setProperty('--partes', [].filter.call(card.children, function (f) { return !f.classList.contains('plano-etiqueta') && !f.classList.contains('plano-visto'); }).length);
      return card;
    });
    var linhas = ['1 loja na sua conta', pr.diasGratis + ' dias grátis, sem cartão', 'Pedidos ilimitados, sem comissão', 'Cartão, boleto ou Pix', 'Suporte pelo WhatsApp'];
    /* a faixa das vagas: so para quem ainda pode virar fundador (quem ja e, ja tem o preco) */
    var faixa = fechado ? faixaEspera() : (deFundador && !jaFundador ? faixaFundador() : null);
    return el('div', { class: 'pilha planos-caixa' }, [
      faixa,
      el('div', { class: 'planos planos-lado' + (cartoes.length === 1 ? ' planos-um' : ''), role: 'group', 'aria-label': 'Mensal ou anual' }, cartoes),
      el('div', { class: 'plano-incluso' }, [
        el('b', { class: 'plano-incluso-titulo', text: p.frase || 'Tudo incluso' }),
        el('ul', { class: 'plano-linhas' }, linhas.map(function (x) { return el('li', {}, [el('span', { class: 'plano-check', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]), el('span', { text: x })]); })),
      ]),
    ]);
  }

  /* ============================================================ #/assinar */
  /* Um plano so (1 loja por conta): aqui se escolhe mensal ou anual. #/assinar/uma/anual (e o antigo #/assinar/anual)
     abre no anual; o plano do endereco nao importa mais */
  function assinar(raiz, planoInicial, tipoInicial) {
    var pr = precos();
    var plano = R.planoPorId('uma');
    var linkTipo = (tipoInicial === 'anual' || tipoInicial === 'mensal' || planoInicial === 'anual');
    var tipo = (tipoInicial === 'anual' || planoInicial === 'anual') && pr.anual > 0 ? 'anual' : 'mensal';
    var conta = null;
    document.title = 'Assinar o Ligeiro';
    raiz.appendChild(barraTopo());
    var corpo = el('div', { class: 'conteudo vender assinar' });
    raiz.appendChild(corpo);
    var caixaPlanos = el('div');
    var resumo = el('div', { class: 'cartao destaque resumo-assinatura' });
    var continuar = el('a', { class: 'btn btn-principal btn-gigante btn-largo', href: '#/comecar/' + plano.id + '/' + tipo, text: 'Criar minha loja' });
    /* so a duvida: o "Entrar" ja esta no topo, e quem tem conta e reconhecido no login de "Criar minha loja" */
    var linhaAjuda = el('p', { class: 'muted pequeno centro' }, ['Dúvida? ', el('a', { href: '#/', text: 'Veja como funciona' }), '.']);
    var porExtenso = function (t) { return t === 'anual' ? 'anual' : 'mensal'; };

    function desenhar() {
      UI.limpar(caixaPlanos);
      caixaPlanos.appendChild(cartoesPlanos(tipo, function (t) { tipo = t; desenhar(); }, conta));
      var valor = R.precoDoPlano(plano.id, tipo, conta);
      var fim = new Date(Date.now() + pr.diasGratis * 864e5);
      UI.limpar(resumo);
      resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Plano' }), el('b', { text: plano.nome + ' · ' + porExtenso(tipo) })]));
      if (conta) {
        var pc = conta.plano || {};
        var tipoAtual = porExtenso(pc.tipo);
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Sua conta hoje' }), el('b', { text: plano.nome + ' · ' + tipoAtual })]));
        /* o mesmo que ja tem: nada para trocar, o caminho e pagar ou ver o vencimento em Minha conta */
        if (tipoAtual === tipo) {
          resumo.appendChild(el('p', { class: 'muted pequeno' }, ['Este já é o seu plano. Para pagar ou ver quando vence, vá em ', el('span', { class: 'sem-quebra', text: 'Minha conta.' })]));
          continuar.textContent = 'Ir para Minha conta';
          continuar.setAttribute('href', '#/conta');
          continuar.onclick = null;
          return;
        }
        /* com assinatura no Asaas, a troca passa pelo mensageiro (muda a mesma assinatura): vale na proxima fatura */
        var C = window.LigeiroCobranca;
        var comAssinatura = !D().modoDemo && !!(C && C.assinaturaAtiva && C.assinaturaAtiva(conta));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: 'A troca vale a partir do próximo pagamento: o valor passa a ser ' + dinheiro(valor) + (tipo === 'anual' ? ' por ano' : ' por mês') + '.' }));
        continuar.textContent = tipo === 'anual' ? 'Mudar para o anual' : 'Mudar para o mensal';
        continuar.setAttribute('href', '#');
        continuar.onclick = function (ev) {
          ev.preventDefault();
          /* encerrada, mas a assinatura do Asaas ainda nao saiu (o Cron tira): primeiro reativa */
          if ((conta.assinaturaAsaas || conta.assinaturaPendente) && (conta.plano || {}).status === 'cancelado') { UI.avisar('Reative a assinatura em Minha conta antes de trocar.'); return; }
          var soltar = UI.ocupar(continuar, comAssinatura ? 'Calculando a troca…' : 'Trocando…');
          if (!soltar) return;
          /* volta como era (uma vez so) e redesenha: a pessoa pode ter trocado mensal e anual enquanto esperava */
          var olho = null, voltou = false;
          var voltar = function () { if (voltou) return; voltou = true; if (olho) olho.disconnect(); soltar(); desenhar(); };
          if (comAssinatura) {
            /* a janela da troca abriu: o botao volta (fechar ela no X nao deixa ele girando para sempre) */
            var modal = document.getElementById('modal');
            if (modal && window.MutationObserver) {
              olho = new MutationObserver(function () { if (modal.classList.contains('aberto')) voltar(); });
              olho.observe(modal, { attributes: true, attributeFilter: ['class'] });
            }
            C.trocarPlano({ tipo: tipo, nomePlano: plano.nome + ' ' + porExtenso(tipo), aoTerminar: function () { window.LigeiroApp.ir('conta'); } })
              .then(function (t) { if (!t) voltar(); }, function (e) { voltar(); UI.avisar(D().erroAmigavel(e, 'Não deu para trocar agora.')); });
            return;
          }
          D().store.salvarConta(conta.email, { plano: { planoId: plano.id, tipo: tipo } }).then(function () {
            UI.soar('sucesso');
            UI.avisar('Pronto: ' + porExtenso(tipo) + ' a partir do próximo pagamento.');
            window.LigeiroApp.ir('conta');
          }).catch(function (e) { voltar(); UI.avisar(D().erroAmigavel(e, 'Não deu para trocar agora.')); });
        };
      } else {
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Hoje' }), el('b', { text: R.dinheiro(0) })]));
        /* curto para caber numa linha no celular ("A partir de 02/10/2026 (7 dias)" e "R$ 79,00 por mes" quebravam) */
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'A partir de ' + fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }), el('b', { text: dinheiro(valor) + (tipo === 'anual' ? '/ano' : '/mês') })]));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: 'Sem cartão agora. Quando o período grátis terminar, o Pix aparece na sua conta e no painel. Não gostou? Não paga e pronto.' }));
        continuar.setAttribute('href', '#/comecar/' + plano.id + '/' + tipo);
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
    /* botao esperando (girando): nem o Enter do teclado segue o link */
    continuar.addEventListener('click', function (ev) { if (continuar.getAttribute('aria-busy') === 'true') ev.preventDefault(); });
    /* ja entrou neste aparelho: o botao espera a conta chegar (um toque rapido mandaria o dono criar outra loja).
       Solta antes de redesenhar: o soltar poe de volta o texto de antes */
    var soltarConta = D().store.pareceLogado && D().store.pareceLogado() ? UI.ocupar(continuar, 'Conferindo sua conta…') : null;
    var contaConferida = function () { if (!soltarConta) return; soltarConta(); soltarConta = null; desenhar(); };
    D().store.usuarioAtual().then(function (u) {
      if (!u || !raiz.isConnected) return;
      /* o tipo da conta so vale quando o link nao escolheu ("Começar grátis" do anual abre no anual, mesmo logado) */
      return D().store.obterConta(u.email).then(function (c) { if (c) { conta = c; if (!linkTipo) tipo = porExtenso((c.plano && c.plano.tipo) || tipo); if (soltarConta) contaConferida(); else desenhar(); } });
    }).then(contaConferida, contaConferida);

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Assinar' }),
      el('h2', { text: 'Mensal ou anual' }),
      el('p', { class: 'muted' }, ['Cada conta tem uma loja. Escolha se paga por mês ou por ano, no cartão, boleto ou Pix. Tem outra loja? Ela ganha a própria conta, com outro ', el('span', { class: 'sem-quebra', text: 'e-mail.' })]),
    ]));
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
    var corpo = el('div', { class: 'conteudo vender assinar entrar' });
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
      /* a janela do Google abre aqui dentro do toque (o banco ja esta pronto: o botao so libera depois disso) */
      var soltar = UI.ocupar(btnGoogle, 'Abrindo o Google…');
      if (!soltar) return;
      store.entrarComGoogle().then(function (u) { depois(u); if (btnGoogle.isConnected) soltar(); }).catch(function (e) { soltar(); falhar(D().erroAmigavel(e)); });
    } });
    /* o banco ainda baixando: o botao espera girando (tocar antes so dava o "toque de novo") */
    if (store.pronto) {
      var soltarPreparo = UI.ocupar(btnGoogle, 'Preparando o login…');
      store.pronto().then(soltarPreparo, soltarPreparo);
    }

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Conta do dono' }),
      el('h2', { text: 'Entrar no Ligeiro' }),
      el('p', { class: 'muted', text: 'A conta da sua loja: painel, cozinha, entregador e assinatura, tudo num lugar só.' }),
    ]));
    /* So Google: sem senha para decorar nem para esquecer. Dentro do Instagram, o aviso de abrir no navegador vem antes */
    corpo.appendChild(el('div', { class: 'cartao login-caixa' }, [
      UI.avisoNavegadorDeApp('entrar'),
      btnGoogle,
      UI.loginSeguro(false),
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
      ['O que é o Ligeiro', ['O Ligeiro é um sistema de pedidos para lojas de comida (lanchonete, pizzaria, marmitaria e parecidos) e de comércio (roupa, calçado, presente, pet shop e outros): cardápio ou catálogo num link, painel de pedidos, telas de cozinha ou separação e de entrega, estoque, ofertas, relatórios e cupons. Quem oferece o serviço é ' + quem + '.']],
      ['Quem pode usar', ['Qualquer estabelecimento que venda comida, bebida ou outros produtos (roupa, calçado, presente e outros) e tenha um responsável maior de 18 anos. Ao criar a loja, você confirma que tem direito de vender o que cadastra e que as informações (nome, endereço, WhatsApp) são suas ou da sua empresa.']],
      ['Preço e pagamento', ['Os primeiros ' + pr.diasGratis + ' dias são grátis, sem cartão. Depois, o plano mensal custa ' + dinheiro(normal.mensal) + ' por mês' + (normal.anual > 0 ? ' e o anual ' + dinheiro(normal.anual) + ' por ano' : '') + ', pagos por cartão de crédito, boleto ou Pix em "Minha conta". Cada conta tem uma loja: outra loja ganha a própria conta, com a própria assinatura.' + (vagas > 0 && fund.mensal ? ' Preço de fundador: as ' + ((cfg().fundador || {}).vagas || 5) + ' primeiras lojas que pagarem pagam ' + dinheiro(fund.mensal) + ' por mês' + (fund.anual > 0 ? ' (' + dinheiro(fund.anual) + ' por ano)' : '') + ', travado enquanto não cancelarem. Se as vagas acabarem antes do seu primeiro pagamento, vale o preço normal.' : '') + ' Não há comissão por pedido nem taxa escondida. O preço pode mudar com aviso de 30 dias no painel; a mudança nunca vale para um período já pago nem para o preço de fundador travado.', 'Acabando os dias grátis sem assinar, o site da loja para de aceitar pedidos até o pagamento ser confirmado. Quem já paga tem 10 dias de tolerância após o vencimento, com aviso no painel. Os dados ficam guardados por 90 dias e podem ser apagados a pedido.']],
      ['Aceite', ['Você aceita estes termos ao marcar "Li e aceito" no cadastro da loja ou no painel. O Ligeiro guarda qual versão foi aceita e quando. Quando o texto muda de um jeito que importa, o painel pede um novo aceite antes de continuar.']],
      ['Cancelamento', ['Não tem fidelidade. Para cancelar, toque em Encerrar assinatura, em Minha conta, ou peça no WhatsApp: a cobrança automática do cartão para na hora. Períodos já pagos não são devolvidos, mas continuam valendo até o fim.']],
      ['O dinheiro do cliente', ['O Pix e o cartão de crédito do cliente vão para a conta Mercado Pago da loja, que confirma o pagamento e libera o pedido. O Ligeiro não recebe, não guarda e não repassa dinheiro de pedido. Valem as regras e taxas do Mercado Pago. Os números do cartão são digitados no formulário do próprio Mercado Pago e não passam pelo Ligeiro nem pela loja.', 'Quando a loja cancela um pedido pago pelo site, o valor volta ao cliente pelo Mercado Pago. Maquininha e dinheiro são cobrados pela própria loja na entrega ou no balcão.']],
      ['Responsabilidades da loja', ['Cardápio ou catálogo, preços, ofertas, estoque, prazos, entrega, qualidade dos produtos (e segurança dos alimentos), trocas e devoluções, licenças (inclusive da vigilância sanitária), notas fiscais e tributos são da loja. O Ligeiro é a ferramenta de pedido; quem vende é você. Bebida alcoólica e outros produtos com idade mínima só podem ser entregues a maiores de 18 anos, e conferir isso é da loja.', 'A loja também é responsável por usar os dados dos clientes só para atender e avisar sobre pedidos e promoções da própria loja, conforme a Política de privacidade. Pela LGPD, a loja é a controladora dos dados dos clientes dela e o Ligeiro é o operador, que só guarda e leva esses dados para o pedido acontecer.']],
      ['Pagamentos, estornos e contestações', ['O pagamento pelo site é feito entre o cliente e a conta Mercado Pago da loja. Estornos, contestações (chargeback) e devoluções seguem as regras do Mercado Pago e são resolvidos entre a loja, o cliente e o Mercado Pago. O Ligeiro não é parte desse pagamento e não responde por valores retidos, contestados ou devolvidos.', 'Se a loja escolher cobrar a taxa do cartão do cliente, o site mostra o valor antes do pagamento, como a Lei 13.455/2017 pede. A decisão de cobrar e o valor são da loja.']],
      ['Dados pessoais (LGPD)', ['Com os dados de quem pede na loja (nome, WhatsApp, endereço), a loja é a controladora: é ela quem decide para que usa. O Ligeiro é o operador: guarda e processa esses dados em nome da loja, só para o pedido funcionar, seguindo a Lei Geral de Proteção de Dados (Lei 13.709/2018) e a política de privacidade.', 'A loja usa esses dados só para atender o pedido e falar com o cliente sobre ele, e responde aos pedidos dos clientes dela sobre os próprios dados. O Ligeiro ajuda: acha, entrega ou apaga os dados de uma pessoa a pedido, e avisa a loja se acontecer um incidente de segurança que envolva os clientes dela.']],
      ['Conteúdo da loja', ['Nome, fotos, logo, textos e marcas que a loja envia precisam ser dela ou ter autorização de uso. A loja autoriza o Ligeiro a mostrar esse conteúdo no site dela, nas páginas da cidade e na divulgação do próprio Ligeiro. O Ligeiro pode tirar do ar conteúdo falso, ilegal, ofensivo ou que use marca de outra pessoa.']],
      ['Acesso e senhas', ['A loja cuida da conta do Google que abre o painel e da senha da equipe. O que for feito com esses acessos é de responsabilidade da loja. Suspeitou de acesso indevido, troque a senha da equipe e avise o Ligeiro.']],
      ['Disponibilidade', ['O sistema roda em serviços de nuvem de grandes fornecedores (Google, Cloudflare, GitHub, Mercado Pago) e é mantido para ficar no ar o tempo todo, mas pode haver falhas, limites de uso ou manutenções, inclusive desses fornecedores. Nesses casos, a loja segue atendendo pelo WhatsApp e o Ligeiro avisa pelo painel ou pelo WhatsApp da loja.']],
      ['Limite de responsabilidade', ['O Ligeiro não responde por lucro cessante, pedidos perdidos por falta de internet, falhas de fornecedores, erros no cardápio ou catálogo cadastrado pela loja (preços, estoque e ofertas inclusive) ou problemas na entrega. Em qualquer caso, a responsabilidade do Ligeiro fica limitada ao valor que a loja pagou nos últimos 3 meses.']],
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
      ['Dados das lojas e dos donos', ['Nome, tipo, cidade, endereço, WhatsApp, e-mail de login (conta do Google), cardápio ou catálogo, estoque, fotos, pedidos e relatórios de vendas. Servem para a loja funcionar e para a cobrança da assinatura (execução do contrato). A conexão com o Mercado Pago fica numa parte privada, que só a loja e o Ligeiro acessam.']],
      ['Contato do "Fale com a gente"', ['Nome, WhatsApp, cidade e nome da loja, só para a gente responder. Apagamos quando você pedir ou quando o contato não tiver mais uso.']],
      ['Com quem os dados são compartilhados', ['Só com os serviços que fazem o Ligeiro funcionar:',
        'Google (Firebase): banco de dados e login com o Google. Pode guardar dados fora do Brasil, como nos Estados Unidos.',
        'Cloudflare: o mensageiro do Ligeiro (pedidos, pagamentos, estoque e avisos) e uma cópia do cardápio ou catálogo, que já é público, para o site abrir rápido. Rede no mundo todo, com sede nos Estados Unidos.',
        'GitHub: guarda os arquivos do site. Estados Unidos.',
        'Mercado Pago: Pix e cartão do pedido, direto na conta da loja. Brasil.',
        'Asaas: cobrança da assinatura das lojas (cartão, boleto e Pix). Brasil.',
        'Serviço de avisos do navegador (Google, Apple ou Mozilla): só se você ligar os avisos no celular. Levam o aviso até o seu aparelho, com a mensagem criptografada.',
        'WhatsApp (Meta): só quando você toca num botão de WhatsApp. A conversa segue as regras do WhatsApp.',
        'Mais ninguém recebe dados pessoais pelo Ligeiro.']],
      ['Dados fora do Brasil', ['Alguns desses serviços guardam ou processam dados fora do Brasil, principalmente nos Estados Unidos. Isso acontece porque é necessário para o pedido e para o serviço contratado funcionarem (art. 33, IX, da LGPD), e o Ligeiro usa fornecedores grandes, com regras próprias de proteção de dados.']],
      ['Por quanto tempo', ['Os pedidos ficam guardados enquanto a loja usar o Ligeiro, porque são o histórico de vendas dela. Pelo link do pedido, nome, telefone e endereço só aparecem por 3 dias. Depois do cancelamento da loja, os dados ficam 90 dias (caso ela volte) e então são apagados.', 'A pedido, apagamos antes: o pedido fica só com os valores, sem nome, telefone nem endereço.']],
      ['Seus direitos', ['Você pode pedir a qualquer momento: confirmar se temos dados seus, receber uma cópia, corrigir, apagar ou saber com quem foram compartilhados. Fale ' + falar + ', de preferência do mesmo número que você usou nos pedidos, para a gente confirmar que é você. Respondemos em até 15 dias. Se o pedido for sobre os dados de uma loja, avisamos a loja também.', 'Você também pode reclamar na Autoridade Nacional de Proteção de Dados (ANPD).']],
      ['Cookies e o que fica no seu celular', ['O site guarda no próprio aparelho o pedido em andamento, a cidade escolhida, os seus pedidos e, para o próximo pedido ser mais rápido, o nome, o telefone e o endereço que você digitou. Nada disso serve para anúncio.' + (((window.LIGEIRO_CONFIG || {}).analytics || {}).metaPixel ? ' Nas páginas de venda do Ligeiro (as que o dono de loja vê antes de criar a loja), o site usa o Pixel do Meta, só para contar quantos donos chegaram pelo anúncio no Instagram e no Facebook. O Pixel não é carregado na página das lojas, nem nos pedidos dos clientes.' : ' O site não usa cookies de anúncio nem rastreadores.'), 'Para apagar tudo isso do seu celular, abra Meus pedidos na loja e toque em "Apagar meus dados deste aparelho".']],
      ['Segurança', ['Os dados trafegam protegidos (https). O banco tem regras de acesso por loja: uma loja não vê os dados de outra, e cada cliente só vê o próprio pedido. As chaves e a conexão com o Mercado Pago ficam em áreas privadas, e o sistema passa por testes de invasão.', 'Se acontecer um incidente de segurança que possa trazer risco a você, avisamos você, a loja e a ANPD, como manda a lei.']],
      ['Contato sobre dados pessoais', ['Para qualquer assunto sobre dados pessoais, fale ' + falar + '.']],
    ]);
  }

  /* ---------- pecas ---------- */
  /* um passo do "como funciona": a cena desenhada em cima (na cor do passo) e, embaixo, o numero e o titulo numa linha e o texto
     na largura toda (como nos cartoes de "O que o Ligeiro faz") */
  function passo(n, titulo, texto, cor, cena) {
    return el('div', { class: 'passo-venda cor-' + cor }, [
      el('div', { class: 'passo-cena', 'aria-hidden': 'true' }, cena),
      el('div', { class: 'passo-corpo' }, [el('span', { class: 'n', text: n }), el('b', { text: titulo }), el('p', { text: texto })]),
    ]);
  }
  /* As cenas dos passos: pedacos das telas de verdade em miniatura (na letra do celular), com a loja de exemplo da cópia de
     demonstracao: a mesma capa, a mesma logo e os mesmos produtos, precos e fotos (Pexels, licenca livre: ver
     ligeiro/comercial/assets/fotos/CREDITOS.txt). 1) a loja pronta como o cliente ve: capa, logo, "Aberto" e um produto */
  function fotoDoExemplo(arquivo, classe, lado) {
    return el('img', { class: classe, src: 'img/venda/' + arquivo + '.webp', alt: '', width: String(lado[0]), height: String(lado[1]), loading: 'lazy', decoding: 'async' });
  }
  function cenaPassoLoja() {
    return el('span', { class: 'mini-vitrine' }, [
      fotoDoExemplo('exemplo-capa', 'mini-vitrine-capa', [464, 116]),
      el('span', { class: 'mini-vitrine-topo' }, [
        fotoDoExemplo('exemplo-logo', 'mini-vitrine-logo', [96, 96]),
        el('span', { class: 'mini-vitrine-nome' }, [el('b', { text: 'Lanchonete do Zé' }), el('span', { class: 'mini-aberta', text: 'Aberto' })]),
      ]),
      el('span', { class: 'mini-produto' }, [
        fotoDoExemplo('exemplo-x-burguer', 'mini-produto-foto', [112, 112]),
        el('span', { class: 'mini-produto-texto' }, [el('b', { text: 'X-Burguer' }), el('strong', { text: 'R$ 18,00' })]),
        el('span', { class: 'mini-pedir', text: 'PEDIR' }),
      ]),
    ]);
  }
  /* 2) o link espalhado: o perfil da loja com o link na bio e a placa do balcao com o QR igual ao que o painel baixa para imprimir
     (o QR, o nome da loja e "Aponte a camera para pedir"); o QR e de verdade e abre ligeiropedidos.com.br */
  var QR_DO_SITE = 'M0 0h7v1h-7zM8 0h1v1h-1zM10 0h5v1h-5zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h2v1h-2zM12 1h2v1h-2zM16 1h1v1h-1zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM10 2h4v1h-4zM15 2h1v1h-1zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM13 3h1v1h-1zM16 3h1v1h-1zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM9 4h1v1h-1zM13 4h2v1h-2zM16 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM10 5h3v1h-3zM16 5h1v1h-1zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h7v1h-7zM8 7h1v1h-1zM10 7h4v1h-4zM0 8h2v1h-2zM3 8h2v1h-2zM6 8h1v1h-1zM9 8h2v1h-2zM12 8h1v1h-1zM14 8h2v1h-2zM18 8h1v1h-1zM24 8h1v1h-1zM5 9h1v1h-1zM7 9h3v1h-3zM11 9h1v1h-1zM14 9h2v1h-2zM19 9h5v1h-5zM2 10h2v1h-2zM5 10h3v1h-3zM10 10h3v1h-3zM15 10h3v1h-3zM20 10h2v1h-2zM24 10h1v1h-1zM0 11h1v1h-1zM2 11h3v1h-3zM7 11h4v1h-4zM15 11h1v1h-1zM18 11h7v1h-7zM0 12h1v1h-1zM2 12h1v1h-1zM6 12h1v1h-1zM8 12h2v1h-2zM12 12h1v1h-1zM16 12h1v1h-1zM18 12h2v1h-2zM24 12h1v1h-1zM0 13h1v1h-1zM3 13h1v1h-1zM8 13h1v1h-1zM11 13h2v1h-2zM14 13h3v1h-3zM20 13h1v1h-1zM23 13h1v1h-1zM0 14h4v1h-4zM6 14h2v1h-2zM10 14h1v1h-1zM14 14h5v1h-5zM20 14h5v1h-5zM0 15h1v1h-1zM2 15h3v1h-3zM9 15h2v1h-2zM15 15h3v1h-3zM19 15h1v1h-1zM21 15h2v1h-2zM24 15h1v1h-1zM0 16h1v1h-1zM3 16h1v1h-1zM6 16h3v1h-3zM10 16h1v1h-1zM12 16h2v1h-2zM15 16h6v1h-6zM22 16h2v1h-2zM8 17h3v1h-3zM14 17h3v1h-3zM20 17h1v1h-1zM22 17h2v1h-2zM0 18h7v1h-7zM10 18h2v1h-2zM14 18h1v1h-1zM16 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM24 18h1v1h-1zM0 19h1v1h-1zM6 19h1v1h-1zM9 19h3v1h-3zM13 19h1v1h-1zM15 19h2v1h-2zM20 19h1v1h-1zM23 19h2v1h-2zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM8 20h1v1h-1zM10 20h3v1h-3zM15 20h6v1h-6zM23 20h1v1h-1zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM8 21h4v1h-4zM13 21h6v1h-6zM23 21h2v1h-2zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM11 22h1v1h-1zM13 22h1v1h-1zM15 22h3v1h-3zM20 22h5v1h-5zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h1v1h-1zM10 23h1v1h-1zM12 23h1v1h-1zM18 23h3v1h-3zM22 23h3v1h-3zM0 24h7v1h-7zM8 24h2v1h-2zM11 24h2v1h-2zM16 24h1v1h-1zM18 24h1v1h-1zM21 24h1v1h-1zM24 24h1v1h-1z';
  function cenaPassoLink() {
    return el('span', { class: 'mini-divulga' }, [
      el('span', { class: 'mini-perfil' }, [
        el('span', { class: 'mini-perfil-topo' }, [
          fotoDoExemplo('exemplo-logo', 'mini-perfil-foto', [96, 96]),
          el('span', { class: 'mini-perfil-nome' }, [el('b', { text: 'lanchonetedoze' }), el('small', { text: 'Lanchonete' })]),
        ]),
        el('span', { class: 'mini-perfil-bio', text: 'Lanche bem servido, feito na hora.' }),
        el('span', { class: 'mini-perfil-link' }, [UI.iconeLinha('link'), el('span', { text: 'ligeiropedidos.com.br' })]),
      ]),
      el('span', { class: 'mini-placa' }, [
        el('span', { class: 'mini-placa-papel' }, [
          el('span', { class: 'mini-qr-codigo', html: '<svg viewBox="0 0 25 25" shape-rendering="crispEdges"><path d="' + QR_DO_SITE + '" fill="#0E1F14"/></svg>' }), /* a margem branca do QR e o proprio papel */
          el('b', { text: 'Lanchonete do Zé' }),
          el('small', { text: 'Aponte a câmera para pedir' }),
        ]),
        el('span', { class: 'mini-placa-base' }),
      ]),
    ]);
  }
  /* 3) o pedido chegando com o celular bloqueado: a hora grande e o aviso igual ao de verdade (o icone do app, o titulo e o texto
     como o mensageiro manda), com mais avisos empilhados atras */
  function cenaPassoAviso() {
    return el('span', { class: 'mini-bloqueio' }, [
      el('span', { class: 'mini-bloqueio-hora', text: '19:42' }),
      el('span', { class: 'mini-avisos' }, [
        el('span', { class: 'mini-aviso' }, [
          fotoDoExemplo('aviso-icone', 'mini-aviso-icone', [72, 72]),
          el('span', { class: 'mini-aviso-texto' }, [
            el('span', { class: 'mini-aviso-linha' }, [el('b', { text: 'Pix pago! Senha 42' }), el('small', { text: 'agora' })]),
            el('span', { class: 'mini-aviso-corpo', text: 'R$ 46,00 · Entrega · Toque para abrir' }),
          ]),
        ]),
        el('span', { class: 'mini-aviso-pilha' }),
      ]),
    ]);
  }
  /* para quem e: o icone e o titulo numa linha, o texto e os tipos de loja embaixo, na largura toda */
  function segmento(icone, titulo, texto, tipos) {
    return el('div', { class: 'cartao segmento' }, [
      el('div', { class: 'segmento-cabeca' }, [el('span', { class: 'icone' }, [UI.iconeLinha(icone)]), el('b', { text: titulo })]),
      el('p', { text: texto }),
      el('ul', { class: 'segmento-tipos', 'aria-label': 'Tipos de loja de ' + titulo.toLowerCase() }, tipos.map(function (x) { return el('li', { text: x }); }).concat([el('li', { class: 'e-outros', text: 'e outros' })])),
    ]);
  }
  /* A barra do celular desenhado (hora, ilha, sinal e bateria), igual nos celulares da pagina de vendas */
  function barraDoCelular() {
    return el('span', { class: 'loja-real-status', 'aria-hidden': 'true', html: '<b>19:30</b><i class="ilha"></i><span class="icones">' +
      '<svg viewBox="0 0 18 12" width="16" height="11"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
      '<svg viewBox="0 0 27 13" width="24" height="12"><rect x="0.75" y="0.75" width="22" height="11.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><rect x="2.75" y="2.75" width="15" height="7.5" rx="2"/><path d="M24.5 4.5v4c.9-.3 1.5-1.1 1.5-2s-.6-1.7-1.5-2z" opacity="0.4"/></svg></span>' });
  }
  /* O celular aberto embaixo (a moldura da "loja de verdade"), com a barra em cima e o conteudo na tela */
  function celularAberto(classe, conteudo) {
    return el('span', { class: 'loja-real-cel ' + (classe || '') }, el('span', { class: 'loja-real-tela' }, [barraDoCelular()].concat(conteudo)));
  }
  /* A tela do "sem Ligeiro": o WhatsApp do dono lotado na hora do pico, com as duvidas de sempre (o Pix falso primeiro) */
  function telaWhatsLotado() {
    var conversas = [
      ['Carla', '#E57373', 'Já fiz o Pix', true, '19:42', 2], /* com o icone da foto: o print do comprovante (o texto inteiro cortava no celular) */
      ['Diego', '#64B5F6', 'Manda o cardápio?', false, '19:41', 3],
      ['Seu Antônio', '#F2A541', 'Cadê meu pedido?', false, '19:40', 4],
      ['Bruna', '#BA68C8', 'Tem no tamanho M?', false, '19:38', 1],
      ['Patrícia', '#4DB6AC', 'Quanto é a entrega?', false, '19:37', 2],
      ['Rafael', '#90A4AE', 'Aceita cartão?', false, '19:35', 1],
    ];
    return el('span', { class: 'zap-lotado' }, [
      el('span', { class: 'zap-lotado-topo' }, [el('b', { text: 'WhatsApp' }), el('span', { text: '13 não lidas' })]),
      /* os filtros do WhatsApp de verdade: descem as conversas para a lista do cartao comecar logo depois da 3a (sem cortar texto no meio) */
      el('span', { class: 'zap-filtros' }, ['Tudo', 'Não lidas', 'Favoritas'].map(function (x, i) { return el('span', { class: 'zap-filtro' + (i === 0 ? ' ativo' : ''), text: x }); })),
    ].concat(conversas.map(function (c) {
      return el('span', { class: 'zap-conversa' }, [
        el('span', { class: 'zap-avatar', style: { background: c[1] }, text: c[0].replace(/^Seu /, '').charAt(0) }),
        el('span', { class: 'zap-meio' }, [el('b', { text: c[0] }), el('span', { class: 'zap-previa' }, [c[3] ? UI.iconeLinha('camera') : null, el('span', { text: c[2] })])]),
        el('span', { class: 'zap-lado' }, [el('span', { class: 'zap-hora', text: c[4] }), el('span', { class: 'zap-naolidas', text: String(c[5]) })]),
      ]);
    })));
  }

  /* A conversa do "a gente monta" (desenhada): o dono manda as fotos do cardapio de papel, a taxa e o horario; a equipe
     devolve a loja pronta, com a previa do link como o WhatsApp mostra (logo, nome e dominio; o endereco de verdade leva a
     cidade, por isso so o dominio). Sem horario nos baloes: nada de prazo */
  function telaConversaMonta() {
    function folha() { return el('span', { class: 'zap-folha' }, [el('i'), el('i'), el('i'), el('i'), el('i')]); }
    return el('span', { class: 'zap-chat' }, [
      el('span', { class: 'zap-chat-topo' }, [
        el('img', { class: 'zap-chat-avatar', src: 'img/mascote-192.webp', alt: '', width: '30', height: '30', loading: 'lazy', decoding: 'async' }),
        el('span', { class: 'zap-chat-quem' }, [el('b', { text: 'Ligeiro' }), el('small', { text: 'online' })]),
      ]),
      el('span', { class: 'zap-chat-corpo' }, [
        el('span', { class: 'zap-balao sai' }, [el('span', { class: 'zap-fotos' }, [folha(), folha(), folha()]), el('span', { text: 'Segue o cardápio' })]),
        el('span', { class: 'zap-balao sai', text: 'Entrega R$ 5, abro às 18h' }),
        el('span', { class: 'zap-balao chega', text: 'Recebido! A gente monta tudo e manda o link aqui.' }),
        el('span', { class: 'zap-balao chega com-link' }, [
          el('span', { class: 'zap-link' }, [
            fotoDoExemplo('exemplo-logo', 'zap-logo', [96, 96]),
            el('span', { class: 'zap-link-texto' }, [el('b', { text: 'Lanchonete do Zé' }), el('small', { text: 'ligeiropedidos.com.br' })]),
          ]),
          el('span', { text: 'Sua loja está pronta!' }),
        ]),
      ]),
    ]);
  }

  /* As funcoes da pagina de vendas em abas. Cada cartao: [icone, cor do quadrado, titulo, texto] */
  var FUNCOES = [
    { aba: 'Vendas', itens: [
      ['link', 'lima', 'Sua loja num link', 'Com a sua logo, cor e fotos. O cliente pede em um minuto, sem cadastro.'],
      ['dinheiro', 'azul', 'Pix e cartão automáticos', 'Pelo Mercado Pago: o cliente paga no Pix ou no cartão e o pedido já cai pago no painel. Sem conferir comprovante.'],
      ['fogo', 'laranja', 'Oferta por tempo limitado', 'Um foguinho com quanto falta e o preço antigo riscado. Na hora marcada, o preço volta sozinho.'],
      ['cupom', 'roxo', 'Cupom de desconto', 'Você cria o código, a porcentagem e o limite de usos. O site confere sozinho na hora do pedido.'],
    ] },
    { aba: 'Pedidos', itens: [
      ['sino', 'laranja', 'Painel com apito', 'Cada pedido chega apitando, com endereço e WhatsApp do cliente.'],
      ['chef', 'lima', 'Cozinha, separação e entregador', 'Uma tela para quem prepara e outra para o motoboy, com mapa e o que cobrar.'],
      ['imprimir', 'azul', 'Impressão automática', 'A ficha sai sozinha na impressora que você já tem.'],
      ['celular', 'roxo', 'Cliente acompanha pela senha', 'Depois de pedir, ele vê a senha e cada etapa do pedido, sem precisar perguntar no WhatsApp.'],
    ] },
    { aba: 'Gestão', itens: [
      ['caixa', 'azul', 'Estoque e tamanhos', 'Cada tamanho com o seu preço e a sua quantidade. Esgotou, o site avisa e ninguém consegue pedir.'],
      ['camera', 'roxo', 'Até 3 fotos por item', 'A principal na lista e mais duas: o cliente desliza para ver.'],
      ['lapis', 'lima', 'Cardápio sempre em dia', 'Mudou um preço ou acabou um item? Você muda no painel e o site já mostra.'],
      ['vendas', 'laranja', 'Vendas e clientes', 'Quanto vendeu, horário de pico e o que mais sai.'],
    ] },
  ];
  function secaoFuncoes() {
    var abas = [], paineis = [];
    function escolher(i, foco) {
      abas.forEach(function (a, k) { a.setAttribute('aria-selected', k === i ? 'true' : 'false'); a.tabIndex = k === i ? 0 : -1; });
      paineis.forEach(function (p, k) { p.hidden = k !== i; });
      if (foco) abas[i].focus();
    }
    FUNCOES.forEach(function (f, i) {
      var idAba = 'funcoesAba' + i, idPainel = 'funcoesPainel' + i;
      abas.push(el('button', { class: 'funcoes-aba', type: 'button', role: 'tab', id: idAba, 'aria-controls': idPainel, 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1', text: f.aba,
        onclick: function () { escolher(i, false); },
        onkeydown: function (e) {
          /* setas trocam de aba (o padrao das abas): da ultima volta para a primeira */
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); escolher((i + (e.key === 'ArrowRight' ? 1 : FUNCOES.length - 1)) % FUNCOES.length, true); }
        } }));
      paineis.push(el('div', { class: 'funcoes-painel', role: 'tabpanel', id: idPainel, 'aria-labelledby': idAba, hidden: i !== 0 }, f.itens.map(function (x) {
        return el('div', { class: 'funcao cor-' + x[1] }, [
          el('div', { class: 'funcao-topo' }, [el('span', { class: 'funcao-icone', 'aria-hidden': 'true' }, [UI.iconeLinha(x[0])]), el('b', { text: x[2] })]),
          el('p', { text: x[3] }),
        ]);
      })));
    });
    return el('section', { class: 'vender-bloco funcoes' }, [
      el('div', { class: 'kicker', text: 'O que o Ligeiro faz por você' }),
      el('h2', { text: 'Do pedido ao Pix, sem você digitar nada' }),
      el('p', { class: 'muted', text: 'Tudo isso já vem no mesmo plano, sem comissão. Toque nos assuntos para ver.' }),
      el('div', { class: 'funcoes-abas', role: 'tablist', 'aria-label': 'Funções do Ligeiro' }, abas),
    ].concat(paineis));
  }

  /* Comparativo com os concorrentes. Valores publicos conferidos em setembro de 2026 (sites e blogs do setor). */
  function tabelaConcorrentes(pr) {
    var linhas = [
      /* os dois concorrentes de verdade logo abaixo do Ligeiro; a comissao do iFood e a mesma da calculadora e do titulo */
      ['Ligeiro', reais(pr.mensal) + ' fixo', 'Nenhuma', true],
      ['iFood', 'R$ 110 a R$ 150', '15,2% a 26,2% de cada venda'],
      ['Anota AI', 'R$ 99,99 até 150 pedidos; sobe para R$ 199,99 e R$ 299,99', 'Nenhuma'],
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
      el('p', { class: 'muted pequeno', text: 'Valores públicos em setembro de 2026, conferidos nos sites e blogs do setor. Cada um pode mudar a tabela; o Ligeiro é ' + reais(pr.mensal) + ' e não sobe com os pedidos (o Mercado Pago cobra a taxa dele no Pix e no cartão, direto da loja). O Anota AI pertence ao iFood desde 2022. iFood, Anota AI e os outros nomes são marcas dos seus donos; o Ligeiro não tem ligação com eles.' }),
    ]);
  }

  function raio(icone, titulo, texto, tag) {
    return el('div', { class: 'cartao raio' }, [el('span', { class: 'icone', text: icone }), el('b', { text: titulo }), el('p', { text: texto }), el('span', { class: 'tag', text: tag })]);
  }
  /* extra (opcional): um link de referencia embaixo da resposta, { texto, href } */
  function duvida(pergunta, resposta, extra) {
    return el('details', { class: 'duvida' }, [el('summary', { text: pergunta }), el('p', { text: resposta }),
      extra ? el('p', {}, [el('a', { href: extra.href, target: '_blank', rel: 'noopener noreferrer', text: extra.texto })]) : null]);
  }

  window.LigeiroParceiro = { abrir: abrir, assinar: assinar, entrar: entrar, termos: termos, privacidade: privacidade, barraTopo: barraTopo, abrirContato: abrirContato };
})();
