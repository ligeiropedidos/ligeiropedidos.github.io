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
  function faixaFundador() {
    var restam = R.vagasFundador();
    var total = (cfg().fundador || {}).vagas || 0;
    if (!restam || !total) return null;
    var barra = el('div', { class: 'fundador-barra', role: 'img', 'aria-label': 'Restam ' + restam + ' de ' + total + ' vagas' }, el('i', { style: { width: Math.max(4, Math.round(restam / total * 100)) + '%' } }));
    return el('div', { class: 'fundador' }, [
      el('div', { class: 'fundador-lado' }, [
        el('span', { class: 'fundador-selo' }, [el('span', { class: 'estrela', text: '★' }), 'Preço de fundador']),
        el('p', { class: 'fundador-texto', text: 'Pras ' + total + ' primeiras lojas. O preço fica travado enquanto você não cancelar.' }),
      ]),
      el('div', { class: 'fundador-conta' }, [
        el('span', { class: 'fundador-vagas' }, ['Restam ', el('b', { text: String(restam) }), ' de ' + total + ' vagas']),
        barra,
      ]),
    ]);
  }
  function linkWhats(texto) {
    var c = cfg();
    return c.whatsappLigeiro ? R.linkWhatsapp(c.whatsappLigeiro, texto || 'Oi! Quero colocar meu estabelecimento no Ligeiro.') : '';
  }
  function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }

  /* Barra do topo: marca, Entrar e Assinar. Igual em todas as paginas daqui. */
  function barraTopo() {
    var entrar = el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/entrar', text: 'Entrar' });
    var assinar = el('a', { class: 'btn btn-principal btn-pequeno', href: '#/assinar', text: 'Assinar agora' });
    var barra = el('div', { class: 'barra-topo' }, [
      el('a', { class: 'marca', href: '#/lojas' }, [el('img', { class: 'mascote', src: 'img/mascote-192.png', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]),
      el('div', { class: 'barra-acoes' }, [entrar, assinar]),
    ]);
    /* logado: "Entrar" vira "Minha conta" e "Assinar agora" vira "Meu plano" */
    if (D() && D().store.usuarioAtual) D().store.usuarioAtual().then(function (u) {
      if (!u || !barra.isConnected) return;
      entrar.textContent = '👤 Minha conta'; entrar.setAttribute('href', '#/conta');
      assinar.remove(); /* logado, o plano mora em Minha conta */
      entrar.classList.remove('btn-fantasma'); entrar.classList.add('btn-principal');
    });
    return barra;
  }

  /* ---------- contato: WhatsApp na hora ou "me chama" (vira lista no admin) ---------- */
  function campoSimples(rotulo, opcoes) {
    var o = opcoes || {};
    var input = el('input', { type: o.tipo || 'text', maxlength: o.max || 80, placeholder: o.placeholder || '', inputmode: o.inputmode || null, autocomplete: o.autocomplete || null });
    var b = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [el('label', { text: rotulo }), input]);
    b.input = input;
    return b;
  }

  function abrirContato(origem) {
    var c = cfg();
    var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } });
    if (c.whatsappLigeiro) corpo.appendChild(el('a', { class: 'btn btn-whats btn-largo', href: linkWhats('Oi! Quero saber mais sobre o Ligeiro pra minha loja.'), target: '_blank', rel: 'noopener', text: '💬 Chamar no WhatsApp agora' }));
    corpo.appendChild(el('p', { class: 'muted pequeno' + (c.whatsappLigeiro ? ' centro' : ''), text: c.whatsappLigeiro ? 'Ou deixe seu número que a gente chama você:' : 'Deixe seu número que a gente chama você no WhatsApp, sem compromisso:' }));
    var f = {
      nome: campoSimples('Seu nome', { max: 60, autocomplete: 'name' }),
      whatsapp: campoSimples('Seu WhatsApp', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999', autocomplete: 'tel' }),
      loja: campoSimples('Nome da loja', { max: 60, placeholder: 'Ex: Lanchonete do Zé' }),
      cidade: window.LigeiroCidades ? window.LigeiroCidades.campo('', '', { rotulo: 'Cidade', placeholder: 'Digite e escolha' }) : campoSimples('Cidade', { max: 60 }),
    };
    UI.mascaraTelefone(f.whatsapp.input);
    corpo.appendChild(el('div', { class: 'grade-form' }, [f.nome, f.whatsapp, f.loja, f.cidade]));
    var btn = el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Pode me chamar', onclick: function () {
      var nome = f.nome.input.value.trim();
      var whatsapp = f.whatsapp.input.value.replace(/\D/g, '');
      if (whatsapp.length > 11 && whatsapp.indexOf('55') === 0) whatsapp = whatsapp.slice(2);
      if (nome.length < 2) { UI.avisar('Digite seu nome.'); f.nome.input.focus(); return; }
      if (whatsapp.length < 10) { UI.avisar('Digite o WhatsApp com DDD.'); f.whatsapp.input.focus(); return; }
      /* cidade: da lista, ou o que a pessoa digitou (contato nao pode travar por isso) */
      var cid = (f.cidade.valor && f.cidade.valor()) || { nome: f.cidade.input.value.replace(/\s*·\s*[A-Za-z]{2}$/, '').trim(), uf: '' };
      btn.disabled = true;
      D().store.salvarLead({ nome: nome, whatsapp: whatsapp, loja: f.loja.input.value.trim(), cidade: cid.nome || '', uf: cid.uf || '', origem: origem || 'site', pagina: location.hash })
        .then(function () { UI.fecharModal(); UI.soar('sucesso'); UI.avisar('Recebemos! A gente chama você no WhatsApp.'); })
        .catch(function (e) { btn.disabled = false; UI.avisar(e && e.message ? e.message : 'Não deu pra enviar. Tente de novo.'); });
    } });
    [f.nome, f.whatsapp, f.loja].forEach(function (c) { c.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } }); });
    UI.abrirModal({ titulo: 'Fale com a gente', corpo: corpo, rodape: [el('button', { class: 'btn btn-fantasma', text: 'Fechar', onclick: UI.fecharModal }), btn] });
    setTimeout(function () { f.nome.input.focus(); }, 80);
  }

  /* Botao verde flutuante, igual ao das startups: aparece em todas as paginas de venda. */
  function botaoFlutuante(raiz) {
    raiz.appendChild(el('button', { class: 'zap-flutuante', type: 'button', 'aria-label': 'Fale conosco no WhatsApp', onclick: function () { abrirContato('botao-flutuante'); } }, [
      el('span', { class: 'zap-icone', text: '💬' }),
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
      el('div', { class: 'ligeiro', text: 'Ligeiro — pedido ligeiro, sem comissão · ' + (e.cidade || 'Juquiá, SP') + (e.nome ? ' · ' + e.nome : '') + (e.cnpj ? ' · CNPJ ' + e.cnpj : '') }),
    ];
    return el('footer', { class: 'rodape rodape-vendas' }, linhas);
  }

  /* ============================================================ landing */
  function abrir(raiz) {
    var lojaDemo = cfg().lojaDemo || 'juquia/dom-conizza';
    var temWhats = !!cfg().whatsappLigeiro;
    var pr = precos();
    document.title = 'Ligeiro pra sua loja — pedido ligeiro, sem comissão';

    function botoesChamada(grande) {
      var lista = [el('a', { class: 'btn btn-principal' + (grande ? ' btn-gigante' : ''), href: '#/assinar', text: '🚀 Assinar agora' })];
      /* o WhatsApp ja tem o botao flutuante: aqui nao repete */
      lista.push(el('a', { class: 'btn btn-fantasma' + (grande ? '' : ' btn-pequeno'), href: '#/cidades', text: 'Ver lojas do Ligeiro' }));
      return el('div', { class: 'pilha chamada' }, lista);
    }

    raiz.appendChild(barraTopo());

    /* ---------- heroi ---------- */
    var seloLojas = el('span', { class: 'selo', hidden: true });
    var capa = el('div', { class: 'vender-capa' }, [
      el('div', { class: 'heroi-mascote-caixa' }, el('img', { class: 'heroi-mascote', src: 'img/mascote.png', alt: 'Mascote do Ligeiro: um rato chef com um pedido na bandeja e o celular na mão' })),
      el('div', { class: 'heroi-texto' }, [
        el('div', { class: 'kicker', text: 'Sistema de pedidos pra delivery de cidade pequena' }),
        el('h1', { class: 'vender-titulo' }, [pr.diasGratis + ' dias grátis. Depois, ', el('span', { class: 'preco-destaque', text: dinheiro(pr.mensal) }), ' fixo por mês, ', el('span', { class: 'preco-destaque', text: '0%' }), ' de comissão.']),
        el('p', { class: 'vender-sub', text: 'Cardápio num link, pedido caindo no seu celular e o Pix confirmado sozinho pelo Mercado Pago. Sem comissão, sem app pra instalar, sem robô caro.' }),
        botoesChamada(true),
        el('div', { class: 'vender-selos' }, [
          el('span', { class: 'selo', text: '✓ ' + pr.diasGratis + ' dias grátis' }),
          el('span', { class: 'selo', text: '✓ Sem cartão de crédito' }),
          el('span', { class: 'selo', text: '✓ Sem fidelidade' }),
          el('span', { class: 'selo', text: '✓ 0% de comissão' }),
          seloLojas,
        ]),
      ]),
    ]);
    raiz.appendChild(capa);
    /* prova social de verdade: so aparece quando tem loja suficiente pra impressionar */
    if (D() && D().store.listarCidades) D().store.listarCidades().then(function (cidades) {
      var total = cidades.reduce(function (n, c) { return n + (c.lojas || 0); }, 0);
      if (total >= 5) { seloLojas.textContent = '✓ ' + total + ' lojas em ' + cidades.length + (cidades.length === 1 ? ' cidade' : ' cidades'); seloLojas.hidden = false; }
    }).catch(function () { /* sem lista, sem selo */ });

    var corpo = el('div', { class: 'conteudo vender' });
    raiz.appendChild(corpo);

    /* ---------- teste gratis ---------- */
    corpo.appendChild(el('section', { class: 'teste-caixa' }, [
      el('h2', {}, ['Teste grátis por ', el('span', { class: 'preco-destaque', text: pr.diasGratis + ' dias' })]),
      el('p', { class: 'muted', text: 'Crie sua loja agora, sem cartão de crédito. Em três minutos ela está no ar com um cardápio do seu tipo.' }),
      el('a', { class: 'btn btn-principal btn-gigante', href: '#/comecar', text: 'Criar minha loja grátis' }),
      el('div', { class: 'checks' }, [
        el('span', { text: '✓ Sem cartão' }), el('span', { text: '✓ Cancela quando quiser' }), el('span', { text: '✓ Todos os recursos' }),
      ]),
    ]));

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
        ['iFood, plano Entrega', c.ifoodEntrega, 'comissão de 26,5%' + (c.ifoodMensalidade ? ' + mensalidade' : '')],
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
      if (economia > 0) frase.textContent = 'Só a diferença pro mais barato deles são ' + dinheiro(economia) + ' por mês. Em um ano, ' + dinheiro(economia * 12) + ' que ficam com você.';
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
        el('p', { class: 'muted', text: 'Coloque mais ou menos quanto vende no delivery por mês e quantos pedidos são. A conta é só com o que vai pro intermediário ou pro sistema.' }),
        el('div', { class: 'linha-campos' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Vendas por mês' }), vendas]),
          el('div', { class: 'campo' }, [el('label', { text: 'Pedidos' }), pedidos]),
        ]),
      ]),
      el('div', { class: 'calc-resultado' }, [resultado, frase, el('a', { class: 'btn btn-principal', href: '#/assinar', text: 'Quero ficar com essa diferença' })]),
    ]));

    /* ---------- como funciona ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Como funciona' }),
      el('h2', { text: 'Três passos, e o pedido cai' }),
      el('div', { class: 'passos-venda' }, [
        passo('1', 'Sua loja nasce em 3 minutos', 'Nome, WhatsApp, chave Pix e frete. O cardápio já vem montado pro seu tipo de loja; você só ajusta preços. Se preferir, a gente vai até você e deixa tudo pronto, com fotos.'),
        passo('2', 'Você espalha o link', 'Bio do Instagram, status e saudação automática do WhatsApp, QR no balcão. Quem pede uma vez, pede de novo pelo link.'),
        passo('3', 'O pedido cai apitando', 'No seu celular ou no computador do caixa, com senha, itens, endereço com referência e o Pix já conferido pra você.'),
      ]),
    ]));

    /* ---------- o que vem ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'O que o Ligeiro faz por você' }),
      el('h2', { text: 'Atende, vende e organiza' }),
      el('div', { class: 'vender-grade' }, [
        item('🔗', 'Link próprio', 'Seu cardápio com a sua cara: logo, capa, cor e foto dos produtos.'),
        item('📱', 'Pedido em modo totem', 'Botão grande, uma decisão por tela, sem cadastro. O cliente pede em um minuto.'),
        item('💸', 'Pix automático pelo Mercado Pago', 'Você conecta sua conta Mercado Pago com um clique. O cliente paga e o pedido cai pronto na cozinha. Maquininha e dinheiro na entrega também.'),
        item('🔔', 'Painel com apito', 'Fila do dia, WhatsApp do cliente em um toque, cardápio com interruptores.'),
        item('👨‍🍳', 'Cozinha e entregador', 'Tela da cozinha em letra grande e tela do motoboy com mapa e o que cobrar.'),
        item('🖨️', 'Impressão automática', 'A ficha sai sozinha na impressora que você já tem.'),
        item('🧾', 'Modo balcão', 'Um tablet simples no caixa vira totem de autoatendimento.'),
        item('📊', 'Vendas e clientes', 'Quanto vendeu, horário de pico, o que mais sai e a lista de clientes.'),
        item('🏙️', 'Vitrine da cidade', 'Sua loja na página da cidade, junto com quem mais usa o Ligeiro.'),
      ]),
    ]));

    /* ---------- planos ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco', id: 'planos' }, [
      el('div', { class: 'kicker', text: 'Planos' }),
      el('h2', { text: 'Planos por quantidade de lojas. Tudo incluso.' }),
      el('p', { class: 'muted', text: 'Pedidos ilimitados e todos os recursos em qualquer plano. A assinatura é da sua conta: uma cobrança só, no cartão, boleto ou Pix, vale pra todas as lojas dela.' }),
      (function () { var t = 'mensal'; var caixa = el('div', { class: 'pilha' }); function d() { UI.limpar(caixa); caixa.appendChild(el('div', { class: 'centro' }, seletorTipo(t, function (n) { t = n; d(); }))); caixa.appendChild(cartoesPlanos(false, null, null, t)); } d(); return caixa; })(),
      tabelaConcorrentes(pr),
    ]));

    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Tudo incluso em qualquer plano' }),
      el('h2', { text: 'Sem surpresa, sem recurso trancado' }),
      el('ul', { class: 'checklist' }, [
        'Cardápio digital com foto, logo, capa e cor da loja', 'Pedidos ilimitados', 'Pix automático pelo Mercado Pago: pagou, caiu na cozinha', 'Maquininha e dinheiro na entrega ou no balcão',
        'Painel de pedidos em tempo real com apito', 'Tela da cozinha (KDS)', 'Tela do entregador com mapa', 'Modo balcão (autoatendimento no tablet)',
        'Impressão automática da ficha', 'Cupons de desconto', 'Entrega grátis a partir de R$ X', 'Horários com fechamento automático',
        'Relatório de vendas e lista de clientes', 'QR code e link pra WhatsApp e Instagram', 'Vitrine da cidade', 'Aviso do dia no topo do site',
        'Atualizações e novidades incluídas', 'Suporte por WhatsApp, na sua loja',
      ].map(function (t) { return el('li', { text: t }); })),
    ]));

    /* ---------- antes e depois ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Antes e depois' }),
      el('h2', { text: 'Sem Ligeiro vs com Ligeiro' }),
      el('div', { class: 'antes-depois' }, [
        el('div', { class: 'cartao lado sem' }, [el('b', { text: 'Sem Ligeiro' })].concat(['WhatsApp lotado na hora do pico', 'Pedido anotado errado', 'Cliente pergunta "e o meu pedido?"', 'Comissão comendo a margem', 'Fim do mês sem saber quanto vendeu'].map(function (t) { return el('p', { text: '✕ ' + t }); }))),
        el('div', { class: 'cartao lado com' }, [el('b', { text: 'Com Ligeiro' })].concat(['Cliente monta o pedido sozinho pelo link', 'Pedido chega certo, com senha e endereço', 'Cliente acompanha pela senha, sem perguntar', 'Pix cai na sua conta, sem intermediário', 'Vendas do dia e da semana no painel'].map(function (t) { return el('p', { text: '✓ ' + t }); }))),
      ]),
    ]));

    /* ---------- raio-x ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Raio-x da operação' }),
      el('h2', { text: 'A loja inteira no mesmo sistema' }),
      el('div', { class: 'raiox' }, [
        raio('🔗', 'Site da loja', 'Cardápio, pedido e pagamento no celular do cliente.', 'NO AR'),
        raio('🔔', 'Painel', 'Pedido chega apitando com tudo que a cozinha precisa.', 'TEMPO REAL'),
        raio('👨‍🍳', 'Cozinha', 'Fila em letra grande, laranja quando passa do tempo.', 'FILA DO DIA'),
        raio('🛵', 'Entrega', 'Mapa, o que cobrar e um toque pra avisar o cliente.', 'A CAMINHO'),
        raio('🧾', 'Balcão', 'Tablet no caixa vira totem de autoatendimento.', 'AUTOATENDIMENTO'),
        raio('📊', 'Gestão', 'Vendas, horários de pico, clientes e cupons.', 'SEM PLANILHA'),
      ]),
    ]));

    /* ---------- prova ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Feito por quem tem delivery' }),
      el('h2', { text: 'Rodando de verdade, não em slide' }),
      el('div', { class: 'prova' }, [
        el('div', { class: 'metrica' }, [el('div', { class: 'v', text: '0%' }), el('div', { class: 'l', text: 'de comissão, sempre' })]),
        el('div', { class: 'metrica' }, [el('div', { class: 'v', text: '3 min' }), el('div', { class: 'l', text: 'pra sua loja ficar no ar' })]),
        el('div', { class: 'metrica' }, [el('div', { class: 'v', text: '1 preço' }), el('div', { class: 'l', text: 'com 50 ou 500 pedidos' })]),
      ]),
      el('div', { class: 'cartao destaque' }, [
        el('b', { text: 'Dom Conizza, Juquiá/SP' }),
        el('p', { text: 'O Ligeiro nasceu dentro de uma pizzaria de cone de cidade pequena, pra resolver o pedido pelo WhatsApp e a comissão do iFood. Abra a loja e faça um pedido de teste: é o mesmo sistema que você vai usar.' }),
        el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/' + lojaDemo, text: 'Abrir a Dom Conizza' }),
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
            exclusivo ? el('img', { class: 'ex-logo', src: 'img/oficial/dom-conizza-logo.png', alt: '' }) : el('div', { class: 'ex-logo ex-logo-emoji', text: '🍕' }),
            el('div', { class: 'ex-nome', text: exclusivo ? 'Dom Conizza' : 'Sua loja' }),
            el('div', { class: 'ex-botao', text: 'PEDIR AGORA' }),
            el('div', { class: 'ex-item' }, [el('span', { class: 'ex-foto' }), el('span', { class: 'ex-linhas' }, [el('i'), el('i')])]),
            el('div', { class: 'ex-item' }, [el('span', { class: 'ex-foto' }), el('span', { class: 'ex-linhas' }, [el('i'), el('i')])]),
          ]),
          el('div', { class: 'ex-rotulo', text: exclusivo ? 'Exclusivo' : 'Padrão' }),
        ]);
      }
      function recurso(icone, titulo, texto) {
        return el('div', { class: 'ex-recurso' }, [el('span', { class: 'ex-icone', text: icone }), el('div', {}, [el('b', { text: titulo }), el('span', { text: texto })])]);
      }
      corpo.appendChild(el('section', { class: 'vender-bloco' }, [
        el('div', { class: 'exclusiva' }, [
          el('div', { class: 'ex-vitrine', 'aria-hidden': 'true' }, [celular('padrao'), el('span', { class: 'ex-seta', text: '→' }), celular('exclusivo')]),
          el('div', { class: 'ex-texto' }, [
            el('div', { class: 'ex-kicker', text: 'Serviço extra · sob medida' }),
            el('h2', { text: 'Uma loja com a cara da sua marca' }),
            el('p', { class: 'ex-sub', text: 'Toda loja do Ligeiro já escolhe cor, logo e capa no painel. No design exclusivo a gente desenha o site inteiro do seu jeito, como fizemos na Dom Conizza.' }),
            el('div', { class: 'ex-recursos' }, [
              recurso('🎨', 'Sua identidade', 'Cores, letras e botões da sua marca'),
              recurso('✨', 'Abertura animada', 'Sua logo grande chegando na tela'),
              recurso('⏳', 'Carregamento com sua logo', 'O cliente vê você desde o primeiro segundo'),
              recurso('🧑‍🍳', 'Tudo no mesmo visual', 'Painel, cozinha e entregador combinando'),
            ]),
            el('div', { class: 'ex-preco' }, [
              el('span', { class: 'ex-apartir', text: lc.aPartirDe ? 'a partir de' : '' }),
              el('b', { text: lc.aPartirDe ? dinheiro(lc.aPartirDe) : 'Sob orçamento' }),
              el('span', { class: 'ex-obs', text: 'pago uma vez · a mensalidade não muda' }),
            ]),
            el('div', { class: 'ex-botoes' }, [pedir, el('a', { class: 'btn btn-fantasma ex-ver', href: '#/' + lojaDemo, text: 'Ver a Dom Conizza' })]),
          ]),
        ]),
      ]));
    })();

    /* ---------- duvidas ---------- */
    corpo.appendChild(el('section', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Dúvidas' }),
      el('h2', { text: 'O que todo dono pergunta' }),
      el('div', { class: 'faq' }, [
        duvida('Preciso cadastrar cartão pra testar?', 'Não. Você cria a loja, usa ' + pr.diasGratis + ' dias com tudo liberado e só então decide. Se não quiser continuar, não paga nada.'),
        duvida('Como eu pago a mensalidade?', 'Do jeito que preferir, em "Minha conta": cartão de crédito (cai sozinho todo mês, sem lembrar de pagar), boleto ou Pix na hora. Sem comissão e sem taxa escondida: é ' + dinheiro(pr.mensal) + ' e pronto.'),
        duvida('Preciso ter conta no Mercado Pago?', 'Pra receber Pix automático, sim: é grátis, abre em 5 minutos no app, e no painel você conecta com um clique (sem copiar nada). O dinheiro do Pix fica na sua conta Mercado Pago, com a taxa deles (cerca de 1%), e você transfere pro banco quando quiser. Sem Mercado Pago, a loja recebe na maquininha e em dinheiro.'),
        duvida('Preciso de computador ou de algum aparelho?', 'Não. O painel roda no celular que você já tem. Tablet no balcão, tela na cozinha e impressora são opcionais.'),
        duvida('Como eu recebo o dinheiro do Pix?', 'Pela sua conta Mercado Pago, que você liga no painel em dois minutos. O cliente paga, o Mercado Pago confirma na hora e o pedido já entra na cozinha. O dinheiro fica na sua conta Mercado Pago (taxa deles, cerca de 1% por Pix) e você transfere pro banco quando quiser. O Ligeiro nunca encosta no dinheiro.'),
        duvida('E se acabar um item ou eu quiser mudar o preço?', 'No painel, um interruptor tira o item do site na hora e o preço muda direto na lista. Sem ligar pra ninguém.'),
        duvida('Já uso iFood. Preciso sair de lá?', 'Não. Muita loja usa os dois: o iFood pra quem vem de fora e o Ligeiro pra quem já é cliente, sem comissão. Cada pedido pelo seu link é margem que fica com você.'),
        duvida('Meu cliente precisa instalar alguma coisa?', 'Não. Ele abre o link, escolhe, paga e acompanha pela senha. Funciona em qualquer celular.'),
        duvida('Tem fidelidade? E se eu não gostar?', 'Não tem. Parou de pagar, a loja sai do ar depois de 10 dias de aviso e seus dados ficam guardados por 90 dias, caso volte.'),
        duvida('Por que é mais barato que os outros?', 'Porque não tem escritório, não tem robô pago e não tem intermediário no Pix. É feito e mantido por quem tem delivery em cidade pequena.'),
      ]),
    ]));

    /* ---------- fechamento ---------- */
    corpo.appendChild(el('section', { class: 'vender-final' }, [
      el('img', { class: 'final-mascote', src: 'img/mascote-192.png', alt: '' }),
      el('h2', { text: 'Quer ver funcionando na sua loja?' }),
      el('p', { class: 'muted', text: 'Comece grátis agora ou chame a gente: vamos até você, cadastramos tudo e os primeiros dias são por nossa conta.' }),
      botoesChamada(true),
      el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Prefiro que vocês me chamem', onclick: function () { abrirContato('fechamento'); } }),
    ]));
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);

    /* barra fixa no celular: aparece quando o heroi sai da tela */
    var barra = el('div', { class: 'cta-fixa', hidden: true }, [
      el('span', {}, [el('b', { text: pr.diasGratis + ' dias grátis' }), ' · sem cartão']),
      el('a', { class: 'btn btn-principal btn-pequeno', href: '#/assinar', text: 'Assinar agora' }),
    ]);
    raiz.appendChild(barra);
    function conferirBarra() { barra.hidden = capa.getBoundingClientRect().bottom > 0; }
    window.addEventListener('scroll', conferirBarra, { passive: true });
    window.addEventListener('resize', conferirBarra);
    conferirBarra();

    return function () { window.removeEventListener('scroll', conferirBarra); window.removeEventListener('resize', conferirBarra); document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  /* Cartoes de plano (por quantidade de lojas). tipo = 'mensal' | 'anual'. Em #/assinar viram escolha. */
  function cartoesPlanos(selecionavel, escolhidoId, aoEscolher, tipo) {
    var pr = precos();
    var t = tipo === 'anual' ? 'anual' : 'mensal';
    var lista = R.planos();
    var grade = el('div', { class: 'planos planos-' + lista.length }, lista.map(function (p, i) {
      var preco = R.precoDoPlano(p.id, t);
      var normal = t === 'anual' && p.anual > 0 ? p.anual : p.mensal;
      var deFundador = preco < normal;
      var porLoja = Math.ceil(preco / (t === 'anual' ? 12 : 1) / p.lojas / 100) * 100;
      var destaque = i === 1 && lista.length > 2 ? 'Mais escolhido' : '';
      var linhas = [
        p.lojas === 1 ? '1 loja na sua conta' : 'Até ' + p.lojas + ' lojas na mesma conta',
        pr.diasGratis + ' dias grátis, sem cartão',
        p.lojas === 1 ? 'Pedidos ilimitados, tudo incluso' : (t === 'anual' ? 'Uma cobrança por ano pra todas as lojas' : 'Uma cobrança por mês pra todas as lojas'),
        'Cartão, boleto ou Pix',
      ];
      var sub = p.lojas > 1 ? 'Sai por menos de ' + dinheiro(porLoja) + ' por loja no mês' : (p.frase || '');
      var card = el(selecionavel ? 'button' : 'div', { class: 'plano-card' + (destaque ? ' com-destaque' : '') + (selecionavel && escolhidoId === p.id ? ' escolhido' : ''), type: selecionavel ? 'button' : null }, [
        destaque ? el('span', { class: 'plano-etiqueta', text: destaque }) : null,
        el('div', { class: 'plano-titulo', text: p.nome }),
        el('div', { class: 'plano-preco' }, [dinheiro(preco), el('small', { text: t === 'anual' ? ' /ano' : ' /mês' })]),
        deFundador ? el('div', { class: 'plano-fundador' }, [el('b', { text: '★ Fundador' }), ' · acabando as vagas, ' + dinheiro(normal)]) : null,
        el('div', { class: 'plano-sub', text: sub }),
        el('ul', { class: 'plano-linhas' }, linhas.map(function (x) { return el('li', { text: '✓ ' + x }); })),
        selecionavel ? el('span', { class: 'plano-marca', text: escolhidoId === p.id ? '● Escolhido' : '○ Escolher' }) : el('a', { class: 'btn btn-principal btn-pequeno', href: '#/assinar/' + p.id + '/' + t, text: 'Começar grátis' }),
      ]);
      if (selecionavel) card.addEventListener('click', function () { aoEscolher(p.id); });
      return card;
    }));
    var temFundador = lista.some(function (p) { var n = t === 'anual' && p.anual > 0 ? p.anual : p.mensal; return R.precoDoPlano(p.id, t) < n; });
    var faixa = temFundador ? faixaFundador() : null;
    if (faixa) grade.insertBefore(faixa, grade.firstChild);
    return grade;
  }

  /* Mensal | Anual (paga 10 meses, usa 12) */
  function seletorTipo(tipo, aoMudar) {
    var pr = precos();
    if (!(pr.anual > 0)) return el('span');
    var caixa = el('div', { class: 'estilo-linha seletor-tipo' });
    [['mensal', 'Mensal'], ['anual', 'Anual · paga 10, usa 12']].forEach(function (op) {
      caixa.appendChild(el('button', { type: 'button', class: 'aba-painel' + (tipo === op[0] ? ' ativa' : ''), text: op[1], onclick: function () { aoMudar(op[0]); } }));
    });
    return caixa;
  }

  /* ============================================================ #/assinar */
  function assinar(raiz, planoInicial, tipoInicial) {
    var pr = precos();
    var lista = R.planos();
    var escolhido = lista.some(function (p) { return p.id === planoInicial; }) ? planoInicial : lista[0].id;
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
    var continuar = el('a', { class: 'btn btn-principal btn-gigante btn-largo', href: '#/comecar/' + escolhido + '/' + tipo, text: 'Continuar: criar minha loja' });

    function desenhar() {
      UI.limpar(caixaTipo); caixaTipo.appendChild(seletorTipo(tipo, function (t) { tipo = t; desenhar(); }));
      UI.limpar(caixaPlanos);
      caixaPlanos.appendChild(cartoesPlanos(true, escolhido, function (id) { escolhido = id; desenhar(); }, tipo));
      var plano = R.planoPorId(escolhido);
      var valor = R.precoDoPlano(escolhido, tipo);
      var fim = new Date(Date.now() + pr.diasGratis * 864e5);
      UI.limpar(resumo);
      resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Plano' }), el('b', { text: plano.nome + ' · ' + (tipo === 'anual' ? 'anual' : 'mensal') })]));
      if (conta) {
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Sua conta hoje' }), el('b', { text: R.planoPorId((conta.plano || {}).planoId).nome })]));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: 'Trocar de plano vale a partir do próximo Pix: o valor passa a ser ' + dinheiro(valor) + (tipo === 'anual' ? ' por ano' : ' por mês') + '.' }));
        continuar.textContent = 'Mudar meu plano pra este';
        continuar.setAttribute('href', '#');
        continuar.onclick = function (ev) {
          ev.preventDefault();
          var st = D().store;
          st.listarMinhasLojas(conta.email).then(function (minhas) {
            var reais = minhas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === conta.email; }).length;
            if (reais > plano.lojas) throw new Error('Você tem ' + reais + ' lojas e esse plano permite ' + plano.lojas + '. Feche uma loja em "Minha conta" antes de trocar.');
            return st.salvarConta(conta.email, { plano: { planoId: escolhido, tipo: tipo } });
          }).then(function (c) {
            UI.soar('sucesso');
            var pago = c && c.plano && c.plano.status === 'ativo' && c.plano.planoPago && c.plano.planoPago !== escolhido;
            UI.avisar(pago ? 'Plano trocado pra ' + plano.nome + '. Vale assim que o Pix dele for confirmado.' : 'Plano trocado: ' + plano.nome + '.');
            window.LigeiroApp.ir('conta');
          }).catch(function (e) { UI.avisar(e.message || 'Não deu pra trocar agora.'); });
        };
      } else {
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'Hoje' }), el('b', { text: 'R$ 0,00' })]));
        resumo.appendChild(el('div', { class: 'linha' }, [el('span', { text: 'A partir de ' + dataBR(fim) + ' (' + pr.diasGratis + ' dias)' }), el('b', { text: dinheiro(valor) + (tipo === 'anual' ? ' por ano' : ' por mês') })]));
        resumo.appendChild(el('p', { class: 'muted pequeno', text: 'Sem cartão agora. Quando o período grátis terminar, o Pix aparece na sua conta e no painel. Não gostou? Não paga e pronto.' }));
        continuar.setAttribute('href', '#/comecar/' + escolhido + '/' + tipo);
      }
    }
    desenhar();
    D().store.usuarioAtual().then(function (u) {
      if (!u || !raiz.isConnected) return;
      return D().store.obterConta(u.email).then(function (c) { if (c) { conta = c; escolhido = (c.plano && c.plano.planoId) || escolhido; tipo = (c.plano && c.plano.tipo) || tipo; desenhar(); } });
    });

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Assinar' }),
      el('h2', { text: 'Escolha o seu plano' }),
      el('p', { class: 'muted', text: 'A assinatura é da sua conta e vale pra todas as lojas dela. Escolha pela quantidade de lojas e se paga por mês ou por ano, no cartão, boleto ou Pix.' }),
    ]));
    corpo.appendChild(caixaTipo);
    corpo.appendChild(caixaPlanos);
    corpo.appendChild(resumo);
    corpo.appendChild(continuar);
    corpo.appendChild(el('p', { class: 'muted pequeno centro' }, ['Já tem conta? ', el('a', { href: '#/entrar', text: 'Entrar' }), '. Dúvida? ', el('a', { href: '#/lojas', text: 'Veja como funciona' }), '.']));
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    return function () { document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  /* ============================================================ #/entrar */
  function entrar(raiz) {
    var store = D().store;
    document.title = 'Entrar — Ligeiro';
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

    var btnGoogle = el('button', { class: 'btn btn-google btn-largo', type: 'button', text: D().modoDemo ? 'Entrar na demonstração' : 'Continuar com o Google', onclick: function () {
      btnGoogle.disabled = true;
      store.entrarComGoogle().then(depois).catch(function (e) { falhar(e.message); }).then(function () { btnGoogle.disabled = false; });
    } });
    var email = campoSimples('Seu e-mail', { tipo: 'email', autocomplete: 'email', placeholder: 'voce@exemplo.com', largo: true });
    var senha = campoSimples('Sua senha', { tipo: 'password', autocomplete: 'current-password', placeholder: '••••••', largo: true });
    var btnEmail = el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'Entrar', onclick: function () {
      var e = email.input.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(e)) return falhar('Digite um e-mail válido.');
      if (!D().modoDemo && senha.input.value.length < 6) return falhar('Digite a senha (pelo menos 6 letras ou números).');
      btnEmail.disabled = true;
      store.entrarComEmail(e, senha.input.value).then(depois).catch(function (err) { falhar(err.message); }).then(function () { btnEmail.disabled = false; });
    } });
    [email.input, senha.input].forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') btnEmail.click(); }); });
    var esqueci = el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Esqueci a senha', onclick: function () {
      var e = email.input.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(e)) return falhar('Digite seu e-mail acima e toque de novo em "Esqueci a senha".');
      store.recuperarSenha(e).then(function () { UI.avisar('Mandamos um e-mail pra você criar uma senha nova.'); }).catch(function (err) { falhar(err.message); });
    } });

    corpo.appendChild(el('div', { class: 'vender-bloco' }, [
      el('div', { class: 'kicker', text: 'Conta do dono' }),
      el('h2', { text: 'Entrar no Ligeiro' }),
      el('p', { class: 'muted', text: 'Uma conta só, e dentro dela todas as suas lojas: painel, cozinha, entregador, assinatura.' }),
    ]));
    /* So Google: sem senha pra decorar nem pra esquecer. O e-mail e senha continua existindo por baixo
       (contas antigas e admin), mas nao aparece na tela. */
    corpo.appendChild(el('div', { class: 'cartao login-caixa' }, [
      btnGoogle,
      erro,
      el('p', { class: 'muted pequeno centro', text: D().modoDemo ? 'Na demonstração a conta é de mentira e fica só neste aparelho.' : 'É a mesma conta Google do seu celular. Primeira vez? A conta do Ligeiro nasce sozinha, e em seguida você cria a loja.' }),
    ]));
    corpo.appendChild(el('details', { class: 'avancado' }, [
      el('summary', { text: 'Sou da cozinha ou entregador' }),
      el('p', { class: 'muted pequeno', text: 'A equipe não precisa de conta: entra pelo link da cozinha, do entregador ou do balcão com a senha da equipe. Peça o link e a senha pro dono da loja.' }),
    ]));
    corpo.appendChild(el('p', { class: 'muted pequeno centro' }, ['Sou do Ligeiro: ', el('a', { href: '#/admin', text: 'admin' }), '.']));
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    /* ja logado? vai direto pra conta */
    store.usuarioAtual().then(function (u) { if (u && raiz.isConnected) window.LigeiroApp.ir(destino()); });
    return function () { document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  /* ============================================================ termos e privacidade */
  function paginaLegal(raiz, titulo, blocos) {
    var e = cfg().empresa || {};
    document.title = titulo + ' — Ligeiro';
    raiz.appendChild(barraTopo());
    var corpo = el('div', { class: 'conteudo texto-legal' });
    raiz.appendChild(corpo);
    corpo.appendChild(el('h1', { text: titulo }));
    corpo.appendChild(el('p', { class: 'muted', text: 'Versão de ' + dataBR(new Date()) + '. Escrito em português de gente, sem juridiquês. Se algo não estiver claro, chame a gente' + (e.email ? ' em ' + e.email : '') + '.' }));
    blocos.forEach(function (b) {
      corpo.appendChild(el('h2', { text: b[0] }));
      b[1].forEach(function (p) { corpo.appendChild(el('p', { text: p })); });
    });
    raiz.appendChild(rodape());
    botaoFlutuante(raiz);
    window.scrollTo(0, 0);
    return function () { document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  function termos(raiz) {
    var pr = precos();
    var e = cfg().empresa || {};
    var quem = e.nome ? e.nome + (e.cnpj ? ' (CNPJ ' + e.cnpj + ')' : '') : 'o Ligeiro';
    return paginaLegal(raiz, 'Termos de uso', [
      ['O que é o Ligeiro', ['O Ligeiro é um sistema de pedidos pra lanchonetes, pizzarias, marmitarias e parecidos: cardápio num link, painel de pedidos, telas de cozinha, entrega e balcão, relatórios e cupons. Quem oferece o serviço é ' + quem + '.']],
      ['Quem pode usar', ['Qualquer estabelecimento que venda comida ou bebida e tenha um responsável maior de 18 anos. Ao criar a loja, você confirma que tem direito de vender o que cadastra e que as informações (nome, endereço, WhatsApp, chave Pix) são suas ou da sua empresa.']],
      ['Preço e pagamento', ['Os primeiros ' + pr.diasGratis + ' dias são grátis, sem cartão. Depois, o plano mensal custa ' + dinheiro(pr.mensal) + ' por mês' + (pr.anual > 0 ? ' e o anual ' + dinheiro(pr.anual) + ' por ano' : '') + ', pagos por cartão de crédito, boleto ou Pix em "Minha conta". Não há comissão por pedido nem taxa escondida. O preço pode mudar com aviso de 30 dias no painel; a mudança nunca vale pra um período já pago.', 'Acabando os dias grátis sem assinar, o site da loja para de aceitar pedidos até o pagamento ser confirmado. Quem já paga tem 10 dias de tolerância após o vencimento, com aviso no painel. Os dados ficam guardados por 90 dias e podem ser apagados a pedido.']],
      ['Cancelamento', ['Não tem fidelidade. Pra cancelar, basta parar de pagar ou pedir no WhatsApp. Períodos já pagos não são devolvidos, mas continuam valendo até o fim.']],
      ['O dinheiro do cliente', ['O Pix do cliente vai pra conta Mercado Pago da loja, que confirma o pagamento e libera o pedido. O Ligeiro não recebe, não guarda e não repassa dinheiro de pedido. Valem as regras e taxas do Mercado Pago. Maquininha e dinheiro são cobrados pela própria loja na entrega ou no balcão.']],
      ['Responsabilidades da loja', ['Cardápio, preços, prazos, entrega, qualidade da comida, notas fiscais e tributos são da loja. O Ligeiro é a ferramenta de pedido; quem vende é você. A loja também é responsável por usar os dados dos clientes só pra atender e avisar sobre pedidos e promoções da própria loja, conforme a Política de privacidade.']],
      ['Disponibilidade', ['O sistema roda em serviços de nuvem de grandes fornecedores e é mantido pra ficar no ar o tempo todo, mas pode haver falhas ou manutenções. Nesses casos, a loja segue atendendo pelo WhatsApp e o Ligeiro avisa pelo painel ou pelo WhatsApp da loja. O Ligeiro não responde por lucro cessante.']],
      ['Uso indevido', ['É proibido cadastrar loja falsa, vender produto ilegal, usar o sistema pra enviar spam ou tentar acessar dados de outras lojas. Nesses casos a loja pode ser desligada sem devolução.']],
      ['Mudanças nestes termos', ['Se os termos mudarem, o painel avisa. Continuar usando depois do aviso é concordar com a versão nova.']],
    ]);
  }

  function privacidade(raiz) {
    var e = cfg().empresa || {};
    return paginaLegal(raiz, 'Política de privacidade', [
      ['Resumo', ['O Ligeiro guarda só o necessário pra um pedido chegar na loja: o que o cliente digitou pra pedir e o que a loja cadastrou pra vender. Ninguém vende, aluga ou repassa esses dados. Esta política segue a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).']],
      ['Dados do cliente que pede', ['Nome, WhatsApp, endereço com referência (só em entrega), itens do pedido, forma de pagamento e observações. Servem pra loja preparar e entregar o pedido e pra ela avisar o cliente sobre o andamento. O cliente não cria conta nem senha.', 'A loja vê esses dados no painel dela e pode copiar a lista de clientes pra avisar promoções da própria loja. Cada loja é responsável por esse uso e o cliente pode pedir à loja pra sair da lista.']],
      ['Dados da loja', ['Nome, tipo, cidade, endereço, WhatsApp, e-mail de login, cardápio, fotos e, com o Pix ligado, o token do Mercado Pago (guardado em segredo). Se a loja ligar o Pix automático, o token do Mercado Pago, guardado em documento privado que só a loja e o Ligeiro acessam.']],
      ['Onde fica', ['Os dados ficam no Firebase (Google), em servidores seguros, com regras de acesso por loja: uma loja não vê os dados da outra. O site é publicado no GitHub Pages. Nenhum dado é vendido a terceiros. Não usamos rastreadores de publicidade.']],
      ['Por quanto tempo', ['Enquanto a loja usar o Ligeiro. Depois do cancelamento, 90 dias, e então tudo é apagado. A loja pode pedir a exclusão antes, e o cliente pode pedir à loja ou ao Ligeiro que apague os dados dele.']],
      ['Seus direitos', ['Você pode pedir a qualquer momento: ver os dados que temos sobre você, corrigir, apagar, ou saber com quem foram compartilhados (com ninguém, além da loja em que você pediu). Basta chamar no WhatsApp do Ligeiro' + (e.email ? ' ou escrever pra ' + e.email : '') + '.']],
      ['Cookies e o que fica no seu celular', ['O site guarda no próprio aparelho só o pedido em andamento, a cidade escolhida e a senha do painel (se for o dono). Nada disso sai do aparelho nem serve pra anúncio.']],
      ['Encarregado', ['O responsável pelos dados é ' + (e.nome || 'o Ligeiro') + (e.email ? ', contato ' + e.email : ', contato pelo WhatsApp do Ligeiro') + '.']],
    ]);
  }

  /* ---------- pecas ---------- */
  function passo(n, titulo, texto) {
    return el('div', { class: 'passo-venda' }, [el('span', { class: 'n', text: n }), el('div', {}, [el('b', { text: titulo }), el('p', { text: texto })])]);
  }
  function item(icone, titulo, texto) {
    return el('div', { class: 'cartao item-venda' }, [el('span', { class: 'icone', text: icone }), el('b', { text: titulo }), el('p', { text: texto })]);
  }
  /* Comparativo com os concorrentes. Valores publicos conferidos em setembro de 2026 (sites e blogs do setor). */
  function tabelaConcorrentes(pr) {
    var linhas = [
      ['Ligeiro', dinheiro(pr.mensal) + ' fixo', 'Nenhuma', true],
      ['Anota AI', 'R$ 99,99 a R$ 399,99', 'Nenhuma'],
      ['Goomer', 'R$ 99,90 a R$ 299,90', 'Nenhuma'],
      ['Cardápio Web', 'R$ 169,99 a R$ 269,99', 'Nenhuma'],
      ['Delivery Direto', 'R$ 129 a R$ 289', 'Nenhuma'],
      ['iFood', 'R$ 110 a R$ 150', '15% a 27% de cada venda'],
      ['aiqfome', 'Sem mensalidade', '12% a 18% de cada venda + taxa do pagamento'],
    ];
    return el('div', { class: 'comparativo' }, [
      el('div', { class: 'kicker', text: 'Quanto os outros cobram' }),
      el('div', { class: 'rolagem' }, el('table', { class: 'tabela tabela-concorrentes' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Sistema' }), el('th', { text: 'Por mês' }), el('th', { text: 'Comissão' })])),
        el('tbody', {}, linhas.map(function (l) {
          return el('tr', { class: l[3] ? 'destaque' : '' }, [el('td', {}, el('b', { text: l[0] })), el('td', { text: l[1] }), el('td', { text: l[2] })]);
        })),
      ])),
      el('p', { class: 'muted pequeno', text: 'Valores públicos em setembro de 2026, conferidos nos sites e blogs do setor. Cada um pode mudar a tabela; o Ligeiro é ' + dinheiro(pr.mensal) + ' e não sobe com os pedidos.' }),
    ]);
  }

  function raio(icone, titulo, texto, tag) {
    return el('div', { class: 'cartao raio' }, [el('span', { class: 'icone', text: icone }), el('b', { text: titulo }), el('p', { text: texto }), el('span', { class: 'tag', text: tag })]);
  }
  function duvida(pergunta, resposta) {
    return el('details', { class: 'duvida' }, [el('summary', { text: pergunta }), el('p', { text: resposta })]);
  }

  window.LigeiroParceiro = { abrir: abrir, assinar: assinar, entrar: entrar, termos: termos, privacidade: privacidade, barraTopo: barraTopo };
})();
