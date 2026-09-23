/*
 * Ligeiro - conta do dono (#/conta).
 *
 * A pessoa entra com Google ou e-mail e ve as lojas dela: status da
 * assinatura, botoes pro painel, cozinha e entregador, link e QR.
 * Dali cria outra loja. E o "meu perfil" do lojista.
 *
 * Na demonstracao a conta e de mentira (fica so neste aparelho) e todas as
 * lojas de exemplo aparecem como suas.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;

  function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }
  /* data do selo: dia/mes (o ano so aparece se estiver longe), pro selo caber numa linha */
  function dataCurta(d) { var x = new Date(d); return Math.abs(x.getTime() - Date.now()) > 300 * 864e5 ? dataBR(x) : x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
  /* carregando da pagina: as tres bolinhas do Ligeiro (surgem depois de um instante, pra nao piscar) */
  function carregandoEl() {
    return el('div', { class: 'conta-carregando', role: 'status', 'aria-label': 'Carregando' }, el('div', { class: 'carregando-pontos' }, [el('span'), el('span'), el('span')]));
  }
  function diasGratis() { var p = (window.LIGEIRO_CONFIG || {}).precos || {}; return p.diasGratis || 7; }

  function abrir(raiz) {
    var vivo = true;
    var carregar = function () {};
    document.title = 'Minha conta — Ligeiro';
    raiz.appendChild(window.LigeiroParceiro.barraTopo());
    var corpo = el('div', { class: 'conteudo conta' });
    raiz.appendChild(corpo);
    corpo.appendChild(carregandoEl());

    store.usuarioAtual().then(function (u) {
      if (!vivo) return;
      if (!u) { window.LigeiroApp.ir('entrar'); return; }
      UI.limpar(corpo);
      /* selo de fundador do lado do nome: aparece quando a conta travou o preco (ou e a do proprio Ligeiro) */
      var seloTopo = el('span', { class: 'selo selo-fundador', text: '★ Fundador', hidden: true });
      corpo.appendChild(el('div', { class: 'conta-cabeca' }, [
        u.foto ? el('img', { class: 'conta-foto', src: u.foto, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'conta-foto conta-inicial', text: (u.nome || u.email || '?').trim().charAt(0).toUpperCase() }),
        el('div', { class: 'conta-texto' }, [
          el('div', { class: 'kicker', text: 'Minha conta' }),
          el('h1', { class: 'conta-ola' }, [el('span', { text: 'Olá, ' + ((u.nome || '').split(' ')[0] || 'dono') }), seloTopo]),
          el('p', { class: 'muted', text: u.email + (D.modoDemo ? ' · conta de demonstração, só neste aparelho' : '') }),
        ]),
        el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Sair', onclick: function () { store.sair().then(function () { window.LigeiroApp.ir('lojas'); }); } }),
      ]));
      /* so a conta do Ligeiro: atalho pra Central (o #/admin confere o Google de novo, ninguem mais entra) */
      if (R.ehDoLigeiro({ email: u.email })) corpo.appendChild(el('a', { class: 'btn btn-escuro conta-painel conta-central', href: '#/admin' }, [
        el('span', { class: 'conta-painel-texto' }, [el('b', { text: '🛠️ Central do Ligeiro' }), el('small', { text: 'Lojas, assinaturas, contatos e pagamentos' })]),
        el('span', { class: 'conta-painel-seta', 'aria-hidden': 'true', text: '→' }),
      ]));
      var caixaPlano = el('div');
      corpo.appendChild(caixaPlano);
      var lista = el('div', { class: 'conta-lojas' });
      var tituloLojas = el('div', { class: 'hub-secao', text: 'Suas lojas', hidden: true });
      corpo.appendChild(tituloLojas);
      corpo.appendChild(lista);
      var rodapeLojas = el('div', { class: 'linha-botoes', style: { justifyContent: 'center' } });
      corpo.appendChild(rodapeLojas);

      var vezes = 0, desenhou = false;
      /* plano e lojas chegam juntos: enquanto nao chegam, o carregando (ou o erro) ocupa o lugar dos dois */
      function semConteudo(no) {
        tituloLojas.hidden = true;
        UI.limpar(caixaPlano); UI.limpar(lista); UI.limpar(rodapeLojas);
        caixaPlano.appendChild(no);
      }
      function falhou(texto) {
        desenhou = false;
        semConteudo(UI.erroCarregar(texto, function () { carregar(); }));
      }
      carregar = function () {
      var vez = ++vezes;
      /* primeira carga (ou depois de um erro): mostra o carregando, a tela nunca fica em branco */
      if (!desenhou) semConteudo(carregandoEl());
      var demorou = setTimeout(function () { if (vivo && vez === vezes && !desenhou) falhou('Está demorando para carregar sua conta.'); }, 15000);
      Promise.all([store.listarMinhasLojas(u.email), store.obterConta ? store.obterConta(u.email) : Promise.resolve(null)]).catch(function () {
        clearTimeout(demorou);
        if (vivo && vez === vezes) falhou('Não deu para carregar sua conta.');
        return null;
      }).then(function (r) {
        clearTimeout(demorou);
        if (!vivo || !r || vez !== vezes) return;
        try { desenharTudo(r); desenhou = true; } catch (e) { falhou('Não deu para mostrar sua conta.'); }
      });
      };
      function desenharTudo(r) {
        var lojas = r[0], conta = r[1];
        tituloLojas.hidden = false;
        var reais = lojas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === u.email; }).length;
        seloTopo.hidden = !((conta && conta.plano && conta.plano.fundador === true) || R.ehDoLigeiro(conta || { email: u.email }));
        desenharPlano(caixaPlano, conta, reais);
        UI.limpar(rodapeLojas);
        var limite = R.limiteDeLojas(conta || { email: u.email });
        var sit = conta && conta.plano ? R.assinatura(conta).estado : 'gratis';
        if (sit === 'vencida' || sit === 'bloqueada' || sit === 'cancelada' || sit === 'pausada') rodapeLojas.appendChild(el('span', { class: 'muted pequeno', text: 'Regularize a assinatura para criar outra loja.' }));
        else if (reais >= limite) rodapeLojas.appendChild(cartaoPlanoCheio(conta, limite));
        else rodapeLojas.appendChild(el('a', { class: 'btn btn-principal', href: '#/comecar', text: '+ Criar outra loja' }));
        UI.limpar(lista);
        if (!lojas.length) UI.limpar(rodapeLojas); /* sem loja, o convite grande ja esta no meio da tela */
        if (!lojas.length) {
          lista.appendChild(el('div', { class: 'vazio hub-vazio' }, [
            el('img', { class: 'mascote-vazio', src: 'img/mascote.webp', alt: '' }),
            el('p', { class: 'forte', text: 'Você ainda não tem loja no Ligeiro.' }),
            el('p', { class: 'muted', text: 'Leva três minutos: nome, WhatsApp e frete. Os primeiros ' + diasGratis() + ' dias são grátis.' }),
            el('a', { class: 'btn btn-principal', href: '#/comecar', text: 'Criar minha loja grátis' }),
          ]));
          return;
        }
        lojas.forEach(function (l) { lista.appendChild(cartaoLoja(l)); });
      }
      carregar();
    });

    /* Caixa do plano: nome, situacao, lojas usadas, pagar e mudar. */
    function desenharPlano(caixa, conta, reais) {
      UI.limpar(caixa);
      if (!conta || !conta.plano) {
        caixa.appendChild(el('div', { class: 'cartao destaque conta-plano' }, [
          el('b', { text: 'Sem plano ainda' }),
          el('p', { class: 'muted pequeno', text: 'Ao criar a primeira loja você escolhe o plano. Os ' + diasGratis() + ' dias grátis começam nesse dia.' }),
        ]));
        return;
      }
      var p = conta.plano;
      var plano = R.planoPorId(p.planoId || 'uma');
      var valendo = R.planoPorId(R.planoQueVale(conta));
      var a = R.assinatura(conta);
      var valor = R.precoDoPlano(plano.id, p.tipo, conta);
      var fundador = R.ehPrecoFundador(conta);
      var textos = {
        gratis: 'Grátis até ' + dataBR(a.limite) + '. Depois, ' + R.dinheiro(valor) + (p.tipo === 'anual' ? ' por ano' : ' por mês') + '. Cadastre o cartão agora e não precisa lembrar de pagar.',
        ativa: a.cortesia ? 'Assinatura liberada pelo Ligeiro.' : 'Paga até ' + dataBR(a.limite) + '.',
        vencendo: 'Vence em ' + a.dias + (a.dias === 1 ? ' dia' : ' dias') + '. Pague pelo Pix para não parar.',
        vencida: 'Vencida desde ' + dataBR(a.limite) + '. Suas lojas seguem no ar por mais ' + Math.max(0, a.tolerancia + a.dias) + ' dias.',
        bloqueada: a.gratis ? 'Os dias grátis acabaram em ' + dataBR(a.limite) + ': os sites pararam de aceitar pedidos. Assine e volta na hora.' : 'Vencida há mais de ' + a.tolerancia + ' dias: os sites pararam de aceitar pedidos. Pague e volta na hora.',
        pausada: 'Pausada pelo Ligeiro. Fale com a gente.', cancelada: 'Encerrada. Reative quando quiser.',
      };
      if (a.encerrando) textos.ativa = 'Encerrada por você: as lojas ficam no ar até ' + dataBR(a.limite) + '. Mudou de ideia? Reative.';
      var alerta = a.estado === 'vencida' || a.estado === 'bloqueada' || a.estado === 'vencendo';
      var rotuloStatus = { gratis: 'Período grátis', ativa: a.cortesia ? 'Liberada' : (a.encerrando ? 'Encerrando' : 'Em dia'), vencendo: 'Vence em ' + a.dias + (a.dias === 1 ? ' dia' : ' dias'), vencida: 'Vencida', bloqueada: 'Bloqueada', pausada: 'Pausada', cancelada: 'Encerrada' }[a.estado] || a.estado;
      var corStatus = a.estado === 'ativa' || a.estado === 'gratis' ? '' : a.estado === 'vencendo' ? 'laranja' : 'cinza';
      /* quadro 1: quando e o proximo pagamento (ou o que vale no lugar dele) */
      var q1 = a.cortesia || !a.limite
        ? ['Assinatura', a.estado === 'pausada' ? 'Pausada' : (a.estado === 'cancelada' ? 'Encerrada' : 'Liberada'), a.cortesia ? 'pelo Ligeiro' : '']
        : [a.estado === 'gratis' ? 'Grátis até' : (a.encerrando ? 'No ar até' : (a.estado === 'vencida' || a.estado === 'bloqueada' ? 'Venceu em' : 'Paga até')), dataBR(a.limite),
           a.dias >= 0 ? (a.dias === 0 ? 'é hoje' : 'faltam ' + a.dias + (a.dias === 1 ? ' dia' : ' dias')) : 'há ' + Math.abs(a.dias) + (Math.abs(a.dias) === 1 ? ' dia' : ' dias')];
      var semLimite = R.ehDoLigeiro(conta);
      var usoLojas = semLimite ? 100 : Math.min(100, Math.round(reais / Math.max(1, valendo.lojas) * 100));
      function quadro(rotulo, valorTxt, sub, extra) {
        return el('div', { class: 'plano-dado' + (extra ? ' largo' : '') }, [el('span', { class: 'plano-dado-rotulo', text: rotulo }), el('b', { class: 'plano-dado-valor', text: valorTxt }), sub ? el('span', { class: 'plano-dado-sub', text: sub }) : null, extra || null]);
      }
      caixa.appendChild(el('div', { class: 'cartao ' + (alerta ? 'destaque' : '') + ' conta-plano' }, [
        el('div', { class: 'conta-plano-topo' }, [
          el('div', {}, [el('div', { class: 'kicker', text: 'Seu plano' }), el('b', { class: 'conta-plano-nome', text: plano.nome + ' · ' + (p.tipo === 'anual' ? 'anual' : 'mensal') })]),
          el('span', { class: 'selo ' + corStatus, text: (corStatus ? '' : '● ') + rotuloStatus }),
        ]),
        el('div', { class: 'plano-dados' }, [
          quadro(q1[0], q1[1], q1[2]),
          quadro('Valor', a.cortesia ? R.dinheiro(0) : R.dinheiro(valor), a.cortesia ? 'cortesia' : (p.tipo === 'anual' ? 'por ano' : 'por mês') + (p.fundador === true ? ', travado' : '')),
          quadro('Lojas', semLimite ? String(reais) : reais + ' de ' + valendo.lojas, semLimite ? 'conta do Ligeiro, sem limite' : (reais >= valendo.lojas ? 'plano cheio' : 'cabe mais ' + (valendo.lojas - reais)), el('span', { class: 'plano-barra', 'aria-hidden': 'true' }, el('i', { style: { width: Math.max(4, usoLojas) + '%' } }))),
        ]),
        (alerta || a.estado === 'gratis' || a.encerrando || a.estado === 'pausada' || a.estado === 'cancelada') ? el('p', { class: 'pequeno plano-recado', text: (alerta ? '⚠️ ' : '') + (textos[a.estado] || '') }) : null,
        p.fundador === true ? null : (fundador && !R.ehDoLigeiro(conta) && R.vagasFundador() > 0 ? avisoPlano('fundador', '★', 'Preço de fundador', ['Assine agora e trave este valor. Restam ', el('b', { text: R.vagasFundador() + (R.vagasFundador() === 1 ? ' vaga' : ' vagas') }), '.']) : null),
        p.avisoPagamentoEm ? avisoPlano('espera', '⏳', 'Pagamento avisado', 'Em ' + dataBR(p.avisoPagamentoEm) + '. Assim que confirmarmos, os dias entram na hora.') : null,
        valendo.id !== plano.id ? el('p', { class: 'pequeno', text: 'Hoje vale o ' + valendo.nome + ' (' + valendo.lojas + (valendo.lojas === 1 ? ' loja' : ' lojas') + '). O ' + plano.nome + ' começa a valer assim que o Pix de ' + R.dinheiro(valor) + ' for confirmado.' }) : null,
        el('div', { class: 'plano-acoes' }, [
          /* em dia nao tem o que pagar: o botao volta 7 dias antes de vencer, ou quando trocou pra um plano maior */
          (a.estado !== 'cancelada' && a.estado !== 'pausada' && !a.cortesia && (a.estado !== 'ativa' || valendo.id !== plano.id)) ? el('button', { class: 'btn btn-principal btn-pequeno plano-pagar', type: 'button', text: (a.estado === 'gratis' ? 'Assinar · ' : 'Pagar ') + R.dinheiro(valor), onclick: function () { abrirPagamento(conta, valor, p.tipo === 'anual' ? '12 meses' : '30 dias', function () { carregar(); }); } }) : null,
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/assinar', text: 'Mudar plano' }),
          p.status === 'cancelado'
            ? el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Reativar', onclick: function () { store.salvarConta(conta.email, { plano: { status: 'teste', reativadoEm: new Date().toISOString() } }).then(function (c) { var s2 = R.assinatura(c).estado; UI.avisar(s2 === 'vencida' || s2 === 'bloqueada' ? 'Reativada. Pague o Pix para suas lojas voltarem ao ar.' : 'Assinatura reativada.'); carregar(); }).catch(function (e) { UI.avisar(e.message || 'Não deu agora.'); }); } })
            : (a.estado !== 'pausada' ? el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: 'Encerrar', onclick: function () {
                UI.perguntar('Encerrar a assinatura? Suas lojas continuam no ar até ' + (a.limite ? dataBR(a.limite) : 'o fim do período') + ' e depois param de receber pedidos.', { sim: 'Encerrar', perigo: true }).then(function (sim) {
                  if (!sim) return;
                  store.salvarConta(conta.email, { plano: { status: 'cancelado', canceladoEm: new Date().toISOString() } }).then(function () { UI.avisar('Assinatura encerrada.'); carregar(); }).catch(function (e) { UI.avisar(e.message || 'Não deu agora.'); });
                });
              } }) : null),
        ]),
      ]));
    }

    /* aviso do plano: icone num circulo, titulo e uma linha curta (tipo: 'fundador' dourado, 'espera' laranja) */
    function avisoPlano(tipo, icone, titulo, texto) {
      return el('div', { class: 'aviso-plano aviso-' + tipo, role: 'note' }, [
        el('span', { class: 'aviso-plano-ico', 'aria-hidden': 'true', text: icone }),
        el('span', { class: 'aviso-plano-texto' }, [el('b', { text: titulo }), el('span', {}, texto)]),
      ]);
    }

    function abrirPagamento(conta, valor, periodo, aoAvisar) {
      var p = conta.plano || {};
      function avisar() {
        return store.salvarConta(conta.email, { plano: { avisoPagamentoEm: new Date().toISOString(), avisoValor: valor } })
          .then(function (c) { UI.soar('sucesso'); UI.avisar('Avisado! Assim que cair, liberamos mais ' + periodo + '.'); aoAvisar(c); })
          .catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu para avisar agora.'); });
      }
      window.LigeiroCobranca.abrir({
        valor: valor, periodo: periodo, planoId: p.planoId || 'uma', tipo: p.tipo, fundador: R.ehPrecoFundador(conta), quem: 'conta ' + conta.email, sufixo: ', todas as suas lojas',
        txid: 'LIG' + conta.email.replace(/[^a-z0-9]/gi, '').slice(0, 20), descricao: 'Ligeiro assinatura', avisar: avisar,
      });
    }

    /* Plano cheio: um lugar tracejado "pra proxima loja", com o caminho pro plano maior (no maximo, so o aviso) */
    function cartaoPlanoCheio(conta, limite) {
      var nome = R.planoPorId(R.planoQueVale(conta || {})).nome;
      var temMaior = R.planos().some(function (p) { return p.lojas > limite; });
      return el('div', { class: 'conta-cheio' }, [
        el('span', { class: 'conta-cheio-ico', 'aria-hidden': 'true', text: '🏪' }),
        el('div', { class: 'conta-cheio-texto' }, [
          el('b', { text: 'Quer abrir outra loja?' }),
          el('span', { text: temMaior ? 'Seu plano ' + nome + ' já está cheio. Um plano maior libera mais lojas.' : 'Você já está no maior plano (' + limite + ' lojas). Fale com o Ligeiro para ter mais.' }),
        ]),
        temMaior ? el('a', { class: 'btn btn-principal', href: '#/assinar', text: 'Ver planos maiores' }) : null,
      ]);
    }

    function ladrilho(tag, atributos, icone, rotulo) {
      atributos.class = 'btn btn-fantasma btn-pequeno conta-ladrilho';
      return el(tag, atributos, [el('span', { class: 'conta-ladrilho-icone', 'aria-hidden': 'true', text: icone }), el('span', { text: rotulo })]);
    }

    function cartaoLoja(l) {
      var a = R.assinatura(l);
      var aberta = R.lojaAberta(l);
      var textos = {
        gratis: 'Grátis até ' + dataCurta(a.limite), ativa: a.cortesia ? 'Assinatura liberada' : 'Paga até ' + dataCurta(a.limite),
        vencendo: 'Vence em ' + a.dias + (a.dias === 1 ? ' dia' : ' dias'), vencida: 'Vencida, pague para não parar',
        bloqueada: 'Bloqueada: site sem pedidos', pausada: 'Pausada', cancelada: 'Cancelada',
      };
      var classeSelo = a.estado === 'ativa' || a.estado === 'gratis' ? '' : a.estado === 'vencendo' ? 'laranja' : 'cinza';
      var link = UI.linkDaLoja(l);
      var logo = D.logoSrc(l);
      return el('div', { class: 'conta-loja' }, [
        el('div', { class: 'conta-loja-topo' }, [
          el('span', { class: 'conta-logo' }, logo ? el('img', { src: logo, alt: '' }) : (l.emoji || '🍔')),
          el('div', { class: 'conta-loja-info' }, [
            el('div', { class: 'conta-loja-nome', text: l.nome }),
            /* se quebrar, quebra depois do ponto: nunca uma linha comecando com "·" */
            el('div', { class: 'muted pequeno' }, [l.tipo ? R.tipoVisivel(l) + '\u00A0· ' : '', el('span', { class: 'sem-quebra', text: (l.cidade || '') + (l.uf ? '/' + l.uf : '') })]),
          ]),
        ]),
        /* selos numa linha propria, com a largura toda do cartao: lado a lado ate em 320 */
        el('div', { class: 'conta-selos' }, [
          el('span', { class: 'selo ' + (aberta ? '' : 'fechado') }, [el('span', { class: 'rot-longo', text: aberta ? '● Aberta agora' : '● Fechada agora' }), el('span', { class: 'rot-curto', text: aberta ? '● Aberta' : '● Fechada' })]),
          el('span', { class: 'selo ' + classeSelo, text: textos[a.estado] || a.estado }),
        ]),
        /* entrada principal: o painel. Depois o site da loja e, separadas, as telas da equipe. */
        el('a', { class: 'btn btn-principal conta-painel', href: '#/painel/' + l.slug }, [
          el('span', { class: 'conta-painel-texto' }, [el('b', { text: 'Abrir o painel' }), el('small', { text: 'Pedidos, ' + R.catalogo(l).nome + ', vendas e ajustes' })]),
          el('span', { class: 'conta-painel-seta', 'aria-hidden': 'true', text: '→' }),
        ]),
        el('div', { class: 'conta-acoes' }, [
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/' + l.cidadeSlug + '/' + l.slug, text: '👁️ Ver loja' }),
          el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', text: '📋 Copiar link', onclick: function () { UI.copiar(link).then(function (ok) { UI.avisar(ok ? 'Link copiado' : 'Toque e segure no link para copiar'); }); } }),
        ]),
        /* equipe: tres quadradinhos iguais (antes a senha sobrava sozinha numa linha inteira) */
        el('div', { class: 'conta-grupo', text: 'Equipe' }),
        el('div', { class: 'conta-equipe' }, [
          ladrilho('a', { href: '#/cozinha/' + l.slug }, '👨‍🍳', 'Cozinha'),
          ladrilho('a', { href: '#/entrega/' + l.slug }, '🛵', 'Entregador'),
          ladrilho('button', { type: 'button', title: 'Senha da equipe: cozinha e entregador', 'aria-label': 'Senha da equipe', onclick: function () { window.LigeiroEquipe.definirSenha(l); } }, '🔑', 'Senha'),
        ]),
      ]);
    }

    return function () { vivo = false; document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  window.LigeiroConta = { abrir: abrir };
})();
