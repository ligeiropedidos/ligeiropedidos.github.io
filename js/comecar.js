/*
 * Ligeiro - o dono cria a propria loja (#/comecar).
 *
 * Tres minutos, um formulario so: nome, tipo, cidade, WhatsApp e chave Pix.
 * A loja nasce com um cardapio-modelo do tipo dela, o painel abre logado e o
 * link ja esta pronto. O resto (logo, capa, cor, horarios, fotos) e ajuste
 * fino, feito depois em Ajustes, com o cartao "primeiros passos" guiando.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var D = window.LigeiroDados;
  var Pix = window.LigeiroPix;
  var store = D.store;
  var el = UI.el;

  /* Que cardapio-modelo combina com cada tipo de loja. */
  function modeloDoTipo(tipo) {
    var t = R.semAcento(tipo || '').toLowerCase();
    if (/pizza/.test(t)) return 'dom-conizza';
    if (/marmit|restaur|self/.test(t)) return 'marmitaria-da-cida';
    if (/sorvet|acai|gelad/.test(t)) return 'sorveteria-da-lu';
    if (/lanch|burg|hamb|espet|padar|sushi|pastel/.test(t)) return 'lanchonete-do-ze';
    return 'vazio';
  }

  function campo(rotulo, opcoes) {
    var o = opcoes || {};
    var input = el('input', { type: o.tipo || 'text', maxlength: o.max || 80, placeholder: o.placeholder || '', inputmode: o.inputmode || null, autocomplete: o.autocomplete || null });
    if (o.valor) input.value = o.valor;
    var b = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [
      el('label', {}, [rotulo, o.opcional ? el('span', { class: 'opcional', text: 'opcional' }) : null]),
      o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null,
      input,
    ]);
    b.input = input;
    return b;
  }

  /* Loja so nasce dentro de uma conta: sem login, vai pra #/entrar e volta pra ca depois. */
  function abrir(raiz, opcoes) {
    var vivo = true;
    raiz.appendChild(el('p', { class: 'centro muted', style: { padding: '40px 16px' }, text: 'Só um instante…' }));
    store.usuarioAtual().then(function (u) {
      if (!vivo) return;
      if (!u) {
        try { sessionStorage.setItem('ligeiro:depois', location.hash); } catch (_) { /* ignora */ }
        UI.avisar('Entre na sua conta pra criar a loja. Leva 10 segundos.');
        window.LigeiroApp.ir('entrar');
        return;
      }
      /* conta no limite do plano (ou vencida): guia pra trocar de plano em vez de mostrar o formulario */
      var pedidos = [store.obterConta ? store.obterConta(u.email) : Promise.resolve(null), store.listarMinhasLojas ? store.listarMinhasLojas(u.email) : Promise.resolve([])];
      Promise.all(pedidos).catch(function () { return [null, []]; }).then(function (r) {
        if (!vivo) return;
        var conta = r[0], minhas = r[1] || [];
        var reais = minhas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === u.email; }).length;
        if (conta && conta.plano) {
          var sit = R.assinatura(conta).estado;
          var valendo = R.planoPorId(R.planoQueVale(conta));
          var escolhido = R.planoPorId(conta.plano.planoId);
          if (sit === 'vencida' || sit === 'bloqueada' || sit === 'cancelada' || sit === 'pausada') {
            UI.limpar(raiz);
            raiz.appendChild(telaAviso('Sua assinatura precisa de atenção', sit === 'pausada' ? 'Ela está pausada. Fale com o Ligeiro pra criar outra loja.' : (sit === 'cancelada' ? 'Ela está encerrada. Reative em "Minha conta" pra criar outra loja.' : 'Ela está vencida. Pague em "Minha conta" e a loja nova sai na hora.'), [
              el('a', { class: 'btn btn-principal btn-largo', href: '#/conta', text: 'Ir pra Minha conta' }),
            ]));
            return;
          }
          if (reais >= R.limiteDeLojas(conta)) {
            UI.limpar(raiz);
            var texto = escolhido.id !== valendo.id
              ? 'Seu plano pago (' + valendo.nome + ') permite ' + valendo.lojas + (valendo.lojas === 1 ? ' loja' : ' lojas') + ', e você já tem ' + reais + '. O ' + escolhido.nome + ' libera mais lojas assim que o Pix dele for confirmado.'
              : 'Seu plano (' + valendo.nome + ') permite ' + valendo.lojas + (valendo.lojas === 1 ? ' loja' : ' lojas') + ', e você já tem ' + reais + '. Pra abrir mais uma, escolha um plano maior. A troca vale pra todas as suas lojas.';
            raiz.appendChild(telaAviso('Pra criar outra loja, mude de plano', texto, [
              escolhido.id !== valendo.id ? el('a', { class: 'btn btn-principal btn-largo', href: '#/conta', text: 'Pagar o ' + escolhido.nome }) : el('a', { class: 'btn btn-principal btn-largo', href: '#/assinar', text: 'Ver planos e mudar' }),
              el('a', { class: 'btn btn-fantasma btn-largo', href: '#/conta', text: 'Voltar pra Minha conta' }),
            ]));
            return;
          }
        }
        UI.limpar(raiz);
        montar(raiz, opcoes, u);
      });
    });
    return function () { vivo = false; document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  /* Tela de aviso no lugar do formulario: titulo, explicacao e os botoes certos. */
  function telaAviso(titulo, texto, botoes) {
    return el('div', { class: 'conteudo' }, [
      window.LigeiroParceiro && window.LigeiroParceiro.barraTopo ? window.LigeiroParceiro.barraTopo() : null,
      el('div', { class: 'vazio hub-vazio', style: { paddingTop: '40px' } }, [
        el('img', { class: 'mascote-vazio', src: 'img/mascote.png', alt: '' }),
        el('p', { class: 'forte', text: titulo }),
        el('p', { class: 'muted', text: texto }),
        el('div', { class: 'pilha', style: { width: '100%', maxWidth: '360px' } }, botoes),
      ]),
    ]);
  }

  function montar(raiz, opcoes, usuario) {
    var A = window.LigeiroAdmin || {};
    var precos = Object.assign({ mensal: 7900, anual: 79000, diasGratis: 7 }, (window.LIGEIRO_CONFIG || {}).precos || {});
    var o = opcoes || {};
    /* #/comecar/<plano>/<tipo>; links antigos #/comecar/anual continuam valendo */
    var planoId = R.planos().some(function (p) { return p.id === o.plano; }) ? o.plano : R.planos()[0].id;
    var planoTipo = (o.tipo === 'anual' || o.plano === 'anual') && R.planoPorId(planoId).anual > 0 ? 'anual' : 'mensal';
    var precoPlano = R.precoDoPlano(planoId, planoTipo); /* visitante: fundador enquanto houver vaga */
    var planoNome = R.planoPorId(planoId).nome;
    var TIPOS = A.TIPOS || [['Lanchonete', '🍔'], ['Pizzaria', '🍕'], ['Marmitaria', '🍱'], ['Outro', '🛵']];
    var cfg = window.LIGEIRO_CONFIG || {};
    document.title = 'Crie sua loja no Ligeiro';

    raiz.appendChild(el('header', { class: 'topo' }, [
      el('button', { class: 'voltar', 'aria-label': 'Voltar', text: '←', onclick: function () { window.LigeiroApp.ir('lojas'); } }),
      el('div', { class: 'topo-texto' }, [el('div', { class: 'topo-passo', text: precos.diasGratis + ' dias grátis · ' + planoNome + ' · ' + planoTipo }), el('div', { class: 'topo-titulo', text: 'Crie sua loja em 3 minutos' })]),
    ]));
    var corpo = el('div', { class: 'conteudo' });
    raiz.appendChild(corpo);

    var f = {};
    f.nome = campo('Nome da loja', { max: 60, placeholder: 'Ex: Lanchonete do Zé', largo: true });
    var tipoSel = el('select', {}, TIPOS.map(function (t) { return el('option', { value: t[0], text: t[1] + ' ' + t[0] }); }));
    f.tipo = el('div', { class: 'campo' }, [el('label', { text: 'Tipo' }), tipoSel]);
    f.cidade = window.LigeiroCidades.campo('', '', { rotulo: 'Cidade', placeholder: 'Ex: Juquiá', ajuda: 'Digite e escolha na lista (todas as cidades do Brasil).', largo: true });
    f.whatsapp = campo('WhatsApp da loja', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999', ajuda: 'É por onde o cliente fala com você.' });
    UI.mascaraTelefone(f.whatsapp.input);
    /* Frete: gratis ou taxa. Fica gravado na loja e o dono troca quando quiser em Ajustes. */
    var freteModo = 'taxa';
    f.taxaEntrega = campo('Taxa de entrega', { max: 12, inputmode: 'numeric', placeholder: 'R$ 0,00', ajuda: 'O que o cliente paga pela entrega. Depois dá pra colocar "grátis a partir de R$ X" no painel.' });
    UI.mascaraDinheiro(f.taxaEntrega.input);
    var botoesFrete = [['gratis', '🛵 Entrega grátis'], ['taxa', 'Cobro taxa']].map(function (op) {
      var b = el('button', { type: 'button', class: 'aba-painel' + (freteModo === op[0] ? ' ativa' : ''), text: op[1], dataset: { valor: op[0] } });
      b.addEventListener('click', function () {
        freteModo = op[0];
        linhaFrete.querySelectorAll('.aba-painel').forEach(function (x) { x.classList.toggle('ativa', x.dataset.valor === freteModo); });
        f.taxaEntrega.hidden = freteModo === 'gratis';
      });
      return b;
    });
    var linhaFrete = el('div', { class: 'estilo-linha' }, botoesFrete);
    f.frete = el('div', { class: 'campo largo' }, [el('label', { text: 'Frete' }), el('p', { class: 'ajuda', text: 'Você decide, e troca quando quiser no painel.' }), linhaFrete]);
    if (D.modoDemo) {
      f.senha = campo('Senha do painel', { max: 20, inputmode: 'numeric', placeholder: '4 números', ajuda: 'Você digita ela pra ver os pedidos.' });
    } else {
      f.email = campo('Seu e-mail (login do painel)', { max: 80, tipo: 'email', autocomplete: 'email', largo: true });
      f.senha = campo('Crie uma senha', { max: 40, tipo: 'password', autocomplete: 'new-password', ajuda: 'Pelo menos 6 letras ou números.' });
    }

    var blocoLoja = el('div', { class: 'bloco-form' }, [
      el('div', { class: 'bloco-titulo' }, [el('span', { class: 'bloco-numero', text: '1' }), 'Sua loja']),
      el('div', { class: 'grade-form' }, [f.nome, f.cidade, f.tipo, f.whatsapp, f.frete, f.taxaEntrega]),
    ]);
    var contaLogada = null;
    var blocoAcesso = el('div', { class: 'bloco-form' }, [
      el('div', { class: 'bloco-titulo' }, [el('span', { class: 'bloco-numero', text: '2' }), 'Seu acesso ao painel']),
      el('div', { class: 'grade-form' }, D.modoDemo ? [(f.senha.classList.add('largo'), f.senha)] : [f.email, f.senha]),
    ]);
    if (!D.modoDemo) blocoAcesso.insertBefore(el('button', { class: 'btn btn-google btn-largo', type: 'button', text: 'Continuar com o Google', onclick: function () {
      store.entrarComGoogle().then(function (u) { if (u) usarConta(u); }).catch(function (e) { falhar(e.message); });
    } }), blocoAcesso.children[1]);
    function usarConta(u) {
      contaLogada = u;
      UI.limpar(blocoAcesso);
      blocoAcesso.appendChild(el('div', { class: 'bloco-titulo' }, [el('span', { class: 'bloco-numero', text: '3' }), 'Seu acesso ao painel']));
      blocoAcesso.appendChild(el('p', { class: 'aviso', text: '✅ Entrando como ' + u.email + (D.modoDemo ? ' (demonstração)' : '') + '. A loja fica na sua conta.' }));
    }
    if (usuario && !D.modoDemo) usarConta(usuario); else if (usuario) contaLogada = usuario;
    var erro = el('div', { class: 'msg-erro', hidden: true });
    var btn = el('button', { class: 'btn btn-principal btn-gigante btn-largo', text: 'Criar minha loja' });
    corpo.appendChild(el('p', { class: 'muted', text: 'Só o essencial. Logo, fotos, horários e cor você ajusta depois no painel, em minutos.' }));
    corpo.appendChild(blocoLoja);
    corpo.appendChild(blocoAcesso);
    corpo.appendChild(erro);
    corpo.appendChild(btn);
    corpo.appendChild(el('p', { class: 'muted pequeno centro' }, [
      'Plano ' + planoNome + ': ' + R.dinheiro(precoPlano) + (planoTipo === 'anual' ? ' por ano' : ' por mês') + ' depois dos ' + precos.diasGratis + ' dias grátis, pago por Pix na sua conta. Sem cartão, sem fidelidade, sem comissão. Ao criar a loja você aceita os ',
      el('a', { href: '#/termos', target: '_blank', text: 'termos de uso' }), ' e a ', el('a', { href: '#/privacidade', target: '_blank', text: 'política de privacidade' }), '.',
    ]));

    function falhar(msg) { erro.hidden = false; erro.textContent = msg; UI.soar('erro'); btn.disabled = false; btn.textContent = 'Criar minha loja'; window.scrollTo(0, erro.offsetTop - 80); }

    btn.addEventListener('click', function () {
      erro.hidden = true;
      var nome = f.nome.input.value.trim();
      var cidadeEscolhida = f.cidade.valor();
      var cidade = cidadeEscolhida ? cidadeEscolhida.nome : '';
      var whatsapp = f.whatsapp.input.value.replace(/\D/g, '');
      var senha = f.senha.input.value.trim();
      var email = f.email ? f.email.input.value.trim().toLowerCase() : '';
      if (nome.length < 2) return falhar('Digite o nome da loja.');
      if (!cidadeEscolhida) return falhar('Escolha a cidade na lista: digite o nome e toque na opção certa.');
      if (whatsapp.length < 10) return falhar('Digite o WhatsApp com DDD.');
      var taxaEntrega = freteModo === 'gratis' ? 0 : UI.centavosDoCampo(f.taxaEntrega.input.value);
      if (freteModo === 'taxa' && taxaEntrega <= 0) return falhar('Coloque o valor da taxa de entrega ou marque "Entrega grátis".');
      if (D.modoDemo) { if (senha.length < 4) return falhar('Senha do painel com pelo menos 4 números.'); }
      else if (contaLogada) { /* ja entrou: nao precisa de e-mail nem senha */ }
      else {
        if (!/^\S+@\S+\.\S+$/.test(email)) return falhar('Digite um e-mail válido.');
        if (senha.length < 6) return falhar('Senha com pelo menos 6 letras ou números.');
      }
      btn.disabled = true;
      btn.textContent = 'Criando…';

      var tipo = tipoSel.value;
      var emoji = (TIPOS.filter(function (t) { return t[0] === tipo; })[0] || ['', '🍽️'])[1];
      var dados = {
        nome: nome, tipo: tipo, emoji: emoji, cidade: cidade, uf: cidadeEscolhida.uf,
        whatsapp: whatsapp,
        pix: { chave: '', nome: '', cidade: '' },
        aceitaPix: false, mpAtivo: false, aceitaCartaoEntrega: true, aceitaDinheiroEntrega: true, aceitaPagarNoBalcao: true,
        aceitaEntrega: true, aceitaRetirada: true,
        freteGratis: freteModo === 'gratis', taxaEntrega: taxaEntrega, entregaGratisAcima: 0,
        categorias: [], produtos: [], grupos: {}, gruposPorCategoria: {},
        configurada: false,
        plano: { status: 'teste', tipo: planoTipo, planoId: planoId, desde: new Date().toISOString() },
      };
      if (D.modoDemo) dados.senhaPainel = senha; else dados.donoEmail = email;
      var modelo = modeloDoTipo(tipo);
      if (modelo !== 'vazio' && window.LigeiroSeed) {
        var base = window.LigeiroSeed().lojas[modelo];
        if (base) {
          dados.categorias = D.clonar(base.categorias);
          dados.produtos = D.clonar(base.produtos);
          dados.grupos = D.clonar(base.grupos);
          dados.gruposPorCategoria = D.clonar(base.gruposPorCategoria);
        }
      } else {
        dados.categorias = [{ id: 'cardapio', nome: R.catalogo({ tipo: tipo }).Nome, emoji: emoji }];
      }

        if (contaLogada) dados.donoEmail = contaLogada.email;
      var conta = contaLogada ? Promise.resolve(true) : (D.modoDemo ? Promise.resolve(true) : store.criarConta(email, senha));
      /* a assinatura e da conta: garante a conta com o plano escolhido e copia o plano dela pra loja */
      var emailConta = contaLogada ? contaLogada.email : (D.modoDemo ? '' : email);
      conta.then(function () {
        if (!emailConta) return null;
        return store.obterConta(emailConta).then(function (c) {
          if (c) return c;
          return store.salvarConta(emailConta, { nome: (contaLogada && contaLogada.nome) || '', plano: { planoId: planoId, tipo: planoTipo, status: 'teste', desde: new Date().toISOString() } });
        });
      }).then(function (c) {
        if (c && c.plano) {
          var sit = R.assinatura(c);
          if (sit.estado === 'vencida' || sit.estado === 'bloqueada') throw new Error('Sua assinatura está vencida. Pague em "Minha conta" pra criar outra loja.');
          if (sit.estado === 'cancelada') throw new Error('Sua assinatura está encerrada. Reative em "Minha conta" pra criar outra loja.');
          if (sit.estado === 'pausada') throw new Error('Sua assinatura está pausada. Fale com o Ligeiro pra criar outra loja.');
          var valendo = R.planoPorId(R.planoQueVale(c));
          var limite = R.limiteDeLojas(c);
          return store.listarMinhasLojas(emailConta).then(function (minhas) {
            var reais = minhas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === emailConta; }).length;
            if (reais >= limite) {
              var escolhido = R.planoPorId(c.plano.planoId);
              if (escolhido.id !== valendo.id) throw new Error('Seu plano pago (' + valendo.nome + ') permite ' + limite + (limite === 1 ? ' loja' : ' lojas') + '. O plano ' + escolhido.nome + ' libera mais lojas assim que o Pix dele for confirmado: pague em "Minha conta".');
              throw new Error('Seu plano (' + valendo.nome + ') permite ' + limite + (limite === 1 ? ' loja' : ' lojas') + '. Pra abrir mais uma, mude o plano em Assinar.');
            }
            dados.plano = { status: c.plano.status || 'teste', tipo: c.plano.tipo || planoTipo, planoId: c.plano.planoId || planoId, planoPago: c.plano.planoPago || '', fundador: c.plano.fundador === true, desde: c.plano.desde || new Date().toISOString(), pagoAte: c.plano.pagoAte || '' };
          });
        }
      }).then(function () { return store.criarLoja(dados); }).then(function (loja) {
        try { sessionStorage.setItem('ligeiro:painel:' + loja.slug, '1'); } catch (_) { /* ignora */ }
        UI.soar('sucesso');
        mostrarPronto(loja);
      }).catch(function (e) {
        falhar(e && e.message ? e.message : 'Não deu pra criar agora. Tente de novo em instantes.');
      });
    });

    function mostrarPronto(loja) {
      UI.limpar(corpo);
      var link = UI.linkDaLoja(loja);
      var qr = el('div', { class: 'qr-caixa', style: { width: '200px', margin: '0 auto' } });
      corpo.appendChild(el('div', { class: 'cartao destaque centro', style: { padding: '26px 18px' } }, [
        el('div', { style: { fontSize: '46px' } }, '🎉'),
        el('h2', { text: loja.nome + ' está no ar' }),
        el('p', { class: 'muted', text: 'Sua loja já tem itens de exemplo. Ajuste nomes e preços no painel e comece a divulgar.' }),
        el('p', { class: 'muted pequeno', text: 'Plano ' + planoNome + '. Grátis até ' + new Date(Date.now() + precos.diasGratis * 864e5).toLocaleDateString('pt-BR') + '. Depois, ' + R.dinheiro(precoPlano) + (planoTipo === 'anual' ? ' por ano' : ' por mês') + ', no cartão, boleto ou Pix, em Minha conta.' }),
      ]));
      corpo.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Seu link (pra bio e pro WhatsApp)' }),
        el('div', { class: 'caixa-link', text: link }),
        el('div', { class: 'linha-botoes' }, [
          el('button', { class: 'btn btn-fantasma btn-pequeno', text: '📋 Copiar link', onclick: function () { UI.copiar(link).then(function (ok) { UI.avisar(ok ? 'Link copiado' : 'Toque e segure no link pra copiar'); }); } }),
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: link, target: '_blank', rel: 'noopener', text: 'Ver minha loja' }),
        ]),
        qr,
      ]));
      Pix.desenharQr(qr, link, 200);
      corpo.appendChild(el('button', { class: 'btn btn-principal btn-gigante btn-largo', text: 'Abrir meu painel', onclick: function () { window.LigeiroApp.ir('painel/' + loja.slug); } }));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', text: 'No painel, o cartão "Primeiros passos" mostra o que falta: logo, horários, foto dos itens.' }));
      window.scrollTo(0, 0);
    }

    return function () { document.title = 'Ligeiro — pedido ligeiro, sem comissão'; };
  }

  window.LigeiroComecar = { abrir: abrir, modeloDoTipo: modeloDoTipo };
})();
