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

  /* Loja so nasce dentro de uma conta: sem login, vai pra #/entrar e volta pra ca depois. */
  function abrir(raiz, opcoes) {
    var vivo = true;
    raiz.appendChild(UI.carregandoMascote('Abrindo o cadastro…'));
    /* vagas de loja: numero de agora, direto do servidor (quem foi chamado da lista entra na hora); se a leitura falhar,
       vale o que este aparelho ja sabia */
    var vagas = store.obterFundadores ? store.obterFundadores({ semCache: true }).then(function (f) {
      if (f) window.LigeiroFundadores = { usados: f.usados || 0, capacidade: f.capacidade || null };
    }).catch(function () { /* fica o que tinha */ }) : Promise.resolve();
    /* e conta agora as lojas no ar (a Central so conta quando abre): com o limite batido, ninguem passa */
    var lojasAgora = null;
    var contagem = store.listarVitrine ? store.listarVitrine({ semCache: true }).then(function (lista) {
      lojasAgora = (lista || []).filter(function (l) { return R.ocupaVaga(l); }).length;
    }).catch(function () { /* fica a contagem da Central */ }) : Promise.resolve();
    function listaDeEspera() { telaListaDeEspera(raiz); }
    /* sem conta neste aparelho (quem vem da pagina de vendas): as primeiras perguntas nao precisam do banco, entao o
       cadastro abre na hora e as vagas se conferem por tras. Sem vaga, troca para a lista de espera (a pessoa ainda
       esta nas primeiras perguntas quando a resposta chega) */
    if (store.pareceLogado && !store.pareceLogado()) {
      UI.limpar(raiz);
      montar(raiz, opcoes, null);
      Promise.all([vagas, contagem]).then(function () {
        if (vivo && R.capacidadeLojas(lojasAgora).fechado && !raiz.querySelector('.montando-lista')) listaDeEspera();
      });
      return function () { vivo = false; document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
    }
    /* com conta: vagas, contagem e login ao mesmo tempo (antes era um depois do outro) */
    Promise.all([vagas, contagem, store.usuarioAtual()]).then(function (r) { return r[2]; }).then(function (u) {
      if (!vivo) return;
      var fechado = R.capacidadeLojas(lojasAgora).fechado;
      /* sem conta e sem vaga: nem pede login, vai direto para a lista */
      if (!u && fechado) { listaDeEspera(); return; }
      /* sem conta: o cadastro abre na hora e o login (Google) fica para o ultimo passo */
      if (!u) { UI.limpar(raiz); montar(raiz, opcoes, null); return; }
      /* conta da senha da equipe: nao cria loja (so o dono, com a conta dele) */
      if (/@equipe\.ligeiro\.app\.br$/i.test(String(u.email || ''))) { window.LigeiroApp.ir('conta'); return; }
      /* vagas fechadas ou limite batido: ninguem abre loja nova (nem quem ja e cliente); o Ligeiro sempre pode.
         Vem antes de tudo: sem vaga, nao adianta mandar trocar de plano. As lojas que ja existem continuam normais. */
      if (fechado && !R.ehDoLigeiro({ email: u.email })) { listaDeEspera(); return; }
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
            raiz.appendChild(telaAviso('Sua assinatura precisa de atenção', sit === 'pausada' ? 'Ela está pausada. Fale com o Ligeiro para criar outra loja.' : (sit === 'cancelada' ? 'Ela está encerrada. Reative em "Minha conta" para criar outra loja.' : 'Ela está vencida. Pague em "Minha conta" e a loja nova sai na hora.'), [
              el('a', { class: 'btn btn-principal btn-largo', href: '#/conta', text: 'Ir para Minha conta' }),
            ]));
            return;
          }
          if (reais >= R.limiteDeLojas(conta)) {
            UI.limpar(raiz);
            var texto = escolhido.id !== valendo.id
              ? 'Seu plano pago (' + valendo.nome + ') permite ' + valendo.lojas + (valendo.lojas === 1 ? ' loja' : ' lojas') + ', e você já tem ' + reais + '. O ' + escolhido.nome + ' libera mais lojas assim que o Pix dele for confirmado.'
              : 'Seu plano (' + valendo.nome + ') permite ' + valendo.lojas + (valendo.lojas === 1 ? ' loja' : ' lojas') + ', e você já tem ' + reais + '. Para abrir mais uma, escolha um plano maior. A troca vale para todas as suas lojas.';
            raiz.appendChild(telaAviso('Para criar outra loja, mude de plano', texto, [
              escolhido.id !== valendo.id ? el('a', { class: 'btn btn-principal btn-largo', href: '#/conta', text: 'Pagar o ' + escolhido.nome }) : el('a', { class: 'btn btn-principal btn-largo', href: '#/assinar', text: 'Ver planos e mudar' }),
              el('a', { class: 'btn btn-fantasma btn-largo', href: '#/conta', text: 'Ir para Minha conta' }),
            ]));
            return;
          }
        }
        UI.limpar(raiz);
        montar(raiz, opcoes, u);
      });
    });
    return function () { vivo = false; document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  /* Vagas de loja fechadas (limite do banco gratis): ninguem cria loja nova ate o Ligeiro abrir mais vagas */
  function telaListaDeEspera(raiz) {
    UI.limpar(raiz);
    var P = window.LigeiroParceiro || {};
    raiz.appendChild(telaAviso('Vagas cheias por enquanto', 'Abrimos vagas aos poucos para o Ligeiro continuar rápido para quem já vende com a gente. Entre na lista de espera: assim que abrir vaga, chamamos você no WhatsApp, na ordem da lista.', [
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: 'Entrar na lista de espera', onclick: function () { if (P.abrirContato) P.abrirContato('lista-espera'); } }),
      el('a', { class: 'btn btn-fantasma btn-largo', href: '#/lojas', text: 'Voltar' }),
    ]));
  }

  /* Tem vaga AGORA? Limite e contagem direto do servidor, na hora de criar (o cadastro abre na hora e as vagas
     podem ter acabado enquanto a pessoa respondia). Leitura que falha: vale o que o aparelho ja sabia. O Ligeiro sempre pode. */
  function temVagaAgora(email) {
    if (email && R.ehDoLigeiro({ email: email })) return Promise.resolve(true);
    var n = null;
    var vagas = store.obterFundadores ? store.obterFundadores({ semCache: true }).then(function (f) {
      if (f) window.LigeiroFundadores = { usados: f.usados || 0, capacidade: f.capacidade || null };
    }).catch(function () { /* fica o que tinha */ }) : Promise.resolve();
    var contagem = store.listarVitrine ? store.listarVitrine({ semCache: true }).then(function (lista) {
      n = (lista || []).filter(function (l) { return R.ocupaVaga(l); }).length;
    }).catch(function () { /* fica a contagem da Central */ }) : Promise.resolve();
    return Promise.all([vagas, contagem]).then(function () { return !R.capacidadeLojas(n).fechado; });
  }

  /* Tela de aviso no lugar do formulario: titulo, explicacao e os botoes certos. */
  function telaAviso(titulo, texto, botoes) {
    return el('div', { class: 'conteudo' }, [
      window.LigeiroParceiro && window.LigeiroParceiro.barraTopo ? window.LigeiroParceiro.barraTopo() : null,
      el('div', { class: 'vazio hub-vazio', style: { paddingTop: '40px' } }, [
        el('img', { class: 'mascote-vazio', src: 'img/mascote.webp', alt: '' }),
        el('p', { class: 'forte', text: titulo }),
        el('p', { class: 'muted', text: texto }),
        el('div', { class: 'pilha', style: { width: '100%', maxWidth: '360px' } }, botoes),
      ]),
    ]);
  }

  /*
   * Cadastro em passos: uma pergunta por tela, cartao grande para tocar, Enter avanca e voltar nao perde nada.
   * O login fica por ultimo (quem ja respondeu tudo nao desiste na porta). A loja nasce igual a antes.
   */
  function montar(raiz, opcoes, usuario) {
    var precos = Object.assign({ mensal: 7900, anual: 79000, diasGratis: 7 }, (window.LIGEIRO_CONFIG || {}).precos || {});
    var o = opcoes || {};
    /* #/comecar/<plano>/<tipo>; links antigos #/comecar/anual continuam valendo */
    var planoId = R.planos().some(function (p) { return p.id === o.plano; }) ? o.plano : R.planos()[0].id;
    var planoTipo = (o.tipo === 'anual' || o.plano === 'anual') && R.planoPorId(planoId).anual > 0 ? 'anual' : 'mensal';
    var precoPlano = R.precoDoPlano(planoId, planoTipo); /* visitante: fundador enquanto houver vaga */
    var planoNome = R.planoPorId(planoId).nome;
    var TIPOS = R.TIPOS_DE_LOJA;
    document.title = 'Crie sua loja no Ligeiro';

    /* respostas guardadas: voltar um passo nunca apaga o que ja foi digitado */
    var st = { nome: '', tipo: '', emoji: '', cidade: null, whatsapp: '', frete: '', taxa: '', senhaDemo: '' };
    var contaLogada = usuario || null;
    /* ultimo passo: na demonstracao, a senha do painel; sem conta, entrar com o Google; com conta, nada (cria direto) */
    var PASSOS = ['nome', 'tipo', 'cidade', 'whatsapp', 'frete'];
    if (D.modoDemo) PASSOS.push('senha'); else if (!contaLogada) PASSOS.push('acesso');
    var atual = 0;

    var rotuloPasso = el('div', { class: 'topo-passo' });
    raiz.appendChild(el('header', { class: 'topo' }, [
      el('button', { class: 'voltar', 'aria-label': 'Voltar', text: '←', onclick: voltar }),
      el('div', { class: 'topo-texto' }, [rotuloPasso, el('div', { class: 'topo-titulo', text: 'Crie sua loja grátis' })]),
    ]));
    var barra = el('div', { class: 'cadastro-progresso', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(PASSOS.length) }, el('i'));
    raiz.appendChild(barra);
    /* dentro do Instagram o Google nao deixa entrar no ultimo passo: avisa ja no primeiro, antes de digitar tudo */
    var avisoApp = contaLogada ? null : UI.avisoNavegadorDeApp('comecar');
    if (avisoApp) raiz.appendChild(el('div', { class: 'conteudo cadastro-aviso-app' }, [avisoApp]));
    var corpo = el('div', { class: 'conteudo cadastro' });
    raiz.appendChild(corpo);
    var erro = el('div', { class: 'msg-erro', hidden: true, role: 'alert' });

    var criando = false, criada = null;
    /* depois de criada, voltar leva ao painel (e nao ao ultimo passo); enquanto cria, espera */
    function voltar() { if (criada) { window.LigeiroApp.ir('painel/' + criada.slug); return; } if (criando) return; if (atual > 0) { atual--; desenhar(); } else window.LigeiroApp.ir('lojas'); }
    function avancar() { erro.hidden = true; if (atual < PASSOS.length - 1) { atual++; desenhar(); } else criar(); }
    function falhar(msg) { erro.hidden = false; erro.textContent = msg; UI.soar('erro'); if (botao) { botao.disabled = false; botao.textContent = textoBotao(); } }
    var botao = null;
    function textoBotao() { return atual === PASSOS.length - 1 && PASSOS[atual] !== 'acesso' ? 'Criar minha loja' : 'Continuar'; }
    function pergunta(titulo, ajuda) {
      return [el('h2', { class: 'cadastro-pergunta', text: titulo }), ajuda ? el('p', { class: 'muted cadastro-ajuda', text: ajuda }) : null];
    }
    function botaoContinuar(validar) {
      botao = el('button', { class: 'btn btn-principal btn-gigante btn-largo', type: 'button', text: textoBotao(), onclick: function () { if (validar()) avancar(); } });
      return botao;
    }
    /* campo de texto grande; Enter vale o botao */
    function entrada(opcoes) {
      var i = el('input', { class: 'cadastro-entrada', type: opcoes.tipo || 'text', maxlength: opcoes.max || 60, placeholder: opcoes.placeholder || '', inputmode: opcoes.inputmode || null, autocomplete: opcoes.autocomplete || null, 'aria-label': opcoes.rotulo });
      if (opcoes.valor) i.value = opcoes.valor;
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (botao) botao.click(); } });
      return i;
    }
    function focar(i) { setTimeout(function () { try { i.focus(); } catch (_) { /* ignora */ } }, 60); }
    function legal() {
      return el('p', { class: 'muted pequeno centro cadastro-legal' }, [
        'Grátis por ' + precos.diasGratis + ' dias. Depois, ' + R.dinheiro(precoPlano).replace(/,00$/, '') + (planoTipo === 'anual' ? ' por ano' : ' por mês') + ', sem cartão agora, sem fidelidade e sem comissão. Ao criar a loja você aceita os ',
        el('a', { href: '#/termos', target: '_blank', text: 'termos de uso' }), ' e a ', el('a', { href: '#/privacidade', target: '_blank', text: 'política de privacidade' }), '.',
      ]);
    }

    function desenhar() {
      UI.limpar(corpo);
      erro.hidden = true;
      botao = null;
      var passo = PASSOS[atual];
      rotuloPasso.textContent = 'Passo ' + (atual + 1) + ' de ' + PASSOS.length;
      barra.setAttribute('aria-valuenow', String(atual + 1));
      barra.firstChild.style.width = Math.round((atual + 1) / PASSOS.length * 100) + '%';
      var ultimo = atual === PASSOS.length - 1;

      if (passo === 'nome') {
        var iNome = entrada({ rotulo: 'Nome da loja', placeholder: 'Ex: Lanchonete do Zé', valor: st.nome, autocomplete: 'organization' });
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Como se chama sua loja?', 'É o nome que o cliente vê quando abre o seu link.').concat([iNome, erro, botaoContinuar(function () {
          st.nome = iNome.value.trim();
          if (st.nome.length < 2) { falhar('Digite o nome da loja.'); return false; }
          return true;
        })])));
        focar(iNome);
      }

      if (passo === 'tipo') {
        var grade = el('div', { class: 'escolhas-grade' }, TIPOS.map(function (t) {
          return el('button', { class: 'escolha-grande escolha-tile' + (st.tipo === t[0] ? ' marcada' : ''), type: 'button', onclick: function (e) {
            st.tipo = t[0]; st.emoji = t[1];
            [].forEach.call(grade.children, function (b) { b.classList.toggle('marcada', b === e.currentTarget); });
            /* um toque so: marca e ja segue. Toque duplo (ou em dois tipos) nao anda dois passos: pulava a cidade */
            var passoDoToque = atual;
            setTimeout(function () { if (atual === passoDoToque) avancar(); }, 180);
          } }, [el('span', { class: 'icone', 'aria-hidden': 'true', text: t[1] }), el('span', { class: 'rotulo', text: t[0] })]);
        }));
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('O que você vende?', 'Sua loja já nasce com um cardápio de exemplo desse tipo. Depois você só ajusta nomes e preços.').concat([grade, erro])));
      }

      if (passo === 'cidade') {
        var fCidade = window.LigeiroCidades.campo(st.cidade ? st.cidade.nome : '', st.cidade ? st.cidade.uf : '', { rotulo: 'Cidade', placeholder: 'Digite o nome da cidade', ajuda: 'Toque na cidade certa na lista.', largo: true });
        fCidade.classList.add('cadastro-cidade');
        if (fCidade.input) fCidade.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && fCidade.valor && fCidade.valor()) { e.preventDefault(); if (botao) botao.click(); } });
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Em qual cidade fica a loja?', null).concat([fCidade, erro, botaoContinuar(function () {
          var c = fCidade.valor && fCidade.valor();
          if (!c) { falhar('Escolha a cidade na lista: digite o nome e toque na opção certa.'); return false; }
          st.cidade = c;
          return true;
        })])));
        if (fCidade.input) focar(fCidade.input);
      }

      if (passo === 'whatsapp') {
        var iZap = entrada({ rotulo: 'WhatsApp da loja', placeholder: '(13) 99999-9999', inputmode: 'numeric', max: 16, valor: st.whatsapp, autocomplete: 'tel' });
        UI.mascaraTelefone(iZap);
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Qual o WhatsApp da loja?', 'É por onde o cliente fala com você. Aparece no seu link.').concat([iZap, erro, botaoContinuar(function () {
          st.whatsapp = iZap.value;
          if (iZap.value.replace(/\D/g, '').length < 10) { falhar('Digite o WhatsApp com DDD.'); return false; }
          return true;
        })])));
        focar(iZap);
      }

      if (passo === 'frete') {
        var iTaxa = entrada({ rotulo: 'Valor da taxa de entrega', placeholder: 'R$ 0,00', inputmode: 'numeric', max: 12, valor: st.taxa });
        UI.mascaraDinheiro(iTaxa);
        var caixaTaxa = el('div', { class: 'cadastro-taxa', hidden: st.frete !== 'taxa' }, [el('label', { class: 'cadastro-rotulo', text: 'Quanto é a taxa?' }), iTaxa]);
        var opcoes = [['gratis', 'presente', 'Entrega grátis', 'O cliente não paga pela entrega'], ['taxa', 'entrega', 'Cobro uma taxa', 'Você diz quanto logo abaixo']].map(function (op) {
          return el('button', { class: 'escolha-grande' + (st.frete === op[0] ? ' marcada' : ''), type: 'button', onclick: function (e) {
            st.frete = op[0];
            [].forEach.call(e.currentTarget.parentNode.children, function (b) { b.classList.toggle('marcada', b === e.currentTarget); });
            caixaTaxa.hidden = op[0] !== 'taxa';
            erro.hidden = true;
            if (op[0] === 'taxa') focar(iTaxa);
          } }, [el('span', { class: 'icone', 'aria-hidden': 'true' }, [UI.iconeLinha(op[1])]), el('span', {}, [el('span', { class: 'rotulo', text: op[2] }), el('span', { class: 'detalhe', text: op[3] })])]);
        });
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Como é a entrega?', 'Você troca quando quiser no painel.').concat([
          el('div', { class: 'escolhas-lista' }, opcoes), caixaTaxa, erro, botaoContinuar(function () {
            if (!st.frete) { falhar('Toque em "Entrega grátis" ou em "Cobro uma taxa".'); return false; }
            st.taxa = iTaxa.value;
            if (st.frete === 'taxa' && UI.centavosDoCampo(iTaxa.value) <= 0) { falhar('Coloque o valor da taxa de entrega.'); focar(iTaxa); return false; }
            return true;
          }), ultimo ? legal() : null,
        ])));
      }

      if (passo === 'senha') {
        var iSenha = entrada({ rotulo: 'Senha do painel', placeholder: '4 números', inputmode: 'numeric', max: 20, valor: st.senhaDemo });
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Crie a senha do painel', 'Você digita ela para ver os pedidos. Na demonstração, 4 números bastam.').concat([iSenha, erro, botaoContinuar(function () {
          st.senhaDemo = iSenha.value.trim();
          if (st.senhaDemo.length < 4) { falhar('Senha do painel com pelo menos 4 números.'); return false; }
          return true;
        }), legal()])));
        focar(iSenha);
      }

      if (passo === 'acesso') {
        corpo.appendChild(el('div', { class: 'cadastro-caixa' }, pergunta('Última coisa: onde guardar sua loja?', 'Entre com o Google e pronto. É com ele que você abre o painel depois, em qualquer celular.').concat([
          el('button', { class: 'btn btn-google btn-gigante btn-largo', type: 'button', text: 'Entrar com o Google', onclick: function (e) {
            botao = e.currentTarget;
            store.entrarComGoogle().then(function (u) { if (u) { contaLogada = u; criar(); } }).catch(function (x) { falhar(x.message); });
          } }),
          erro, legal(),
        ])));
      }
      window.scrollTo(0, 0);
    }

    /* cria a loja com as respostas (mesma regra de antes: plano da conta, limite de lojas, cardapio-modelo do tipo) */
    function criar() {
      erro.hidden = true;
      var falta = !st.nome ? 'nome' : !st.cidade ? 'cidade' : !st.whatsapp ? 'whatsapp' : '';
      if (falta && PASSOS.indexOf(falta) >= 0) { atual = PASSOS.indexOf(falta); desenhar(); falhar('Falta responder este passo.'); return; }
      if (botao) { botao.disabled = true; botao.textContent = 'Criando…'; }
      var tipo = st.tipo || 'Outro';
      var emoji = st.emoji || '🍽️';
      var taxaEntrega = st.frete === 'gratis' ? 0 : UI.centavosDoCampo(st.taxa);
      var dados = {
        nome: st.nome, tipo: tipo, emoji: emoji, cidade: st.cidade.nome, uf: st.cidade.uf,
        whatsapp: st.whatsapp.replace(/\D/g, ''),
        pix: { chave: '', nome: '', cidade: '' },
        aceitaPix: false, mpAtivo: false, aceitaCartaoEntrega: true, aceitaDinheiroEntrega: true, aceitaPagarNoBalcao: true,
        aceitaEntrega: true, aceitaRetirada: true,
        freteGratis: st.frete === 'gratis', taxaEntrega: taxaEntrega, entregaGratisAcima: 0,
        categorias: [], produtos: [], grupos: {}, gruposPorCategoria: {},
        configurada: false,
        plano: { status: 'teste', tipo: planoTipo, planoId: planoId, desde: new Date().toISOString() },
      };
      if (D.modoDemo) dados.senhaPainel = st.senhaDemo;
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
      /* primeiro a vaga (antes ate de criar o login): sem vaga, nada nasce */
      var semVaga = new Error('sem vaga');
      var conta = temVagaAgora(contaLogada ? contaLogada.email : '').then(function (tem) {
        if (!tem) throw semVaga;
        return true;
      });
      /* a assinatura e da conta: garante a conta com o plano escolhido e copia o plano dela pra loja */
      var emailConta = contaLogada ? contaLogada.email : '';
      criando = true;
      var fim = montando();
      conta.then(function () {
        if (!emailConta) return null;
        return store.obterConta(emailConta).then(function (c) {
          if (c) return c;
          return store.salvarConta(emailConta, { nome: (contaLogada && contaLogada.nome) || '', plano: { planoId: planoId, tipo: planoTipo, status: 'teste', desde: new Date().toISOString() } });
        });
      }).then(function (c) {
        if (c && c.plano) {
          var sit = R.assinatura(c);
          if (sit.estado === 'vencida' || sit.estado === 'bloqueada') throw new Error('Sua assinatura está vencida. Pague em "Minha conta" para criar outra loja.');
          if (sit.estado === 'cancelada') throw new Error('Sua assinatura está encerrada. Reative em "Minha conta" para criar outra loja.');
          if (sit.estado === 'pausada') throw new Error('Sua assinatura está pausada. Fale com o Ligeiro para criar outra loja.');
          var valendo = R.planoPorId(R.planoQueVale(c));
          var limite = R.limiteDeLojas(c);
          return store.listarMinhasLojas(emailConta).then(function (minhas) {
            var reais = minhas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === emailConta; }).length;
            if (reais >= limite) {
              var escolhido = R.planoPorId(c.plano.planoId);
              if (escolhido.id !== valendo.id) throw new Error('Seu plano pago (' + valendo.nome + ') permite ' + limite + (limite === 1 ? ' loja' : ' lojas') + '. O plano ' + escolhido.nome + ' libera mais lojas assim que o Pix dele for confirmado: pague em "Minha conta".');
              throw new Error('Seu plano (' + valendo.nome + ') permite ' + limite + (limite === 1 ? ' loja' : ' lojas') + '. Para abrir mais uma, mude o plano em Assinar.');
            }
            dados.plano = { status: c.plano.status || 'teste', tipo: c.plano.tipo || planoTipo, planoId: c.plano.planoId || planoId, planoPago: c.plano.planoPago || '', fundador: c.plano.fundador === true, desde: c.plano.desde || new Date().toISOString(), pagoAte: c.plano.pagoAte || '' };
          });
        }
      }).then(function () { return store.criarLoja(dados); }).then(function (loja) {
        try { sessionStorage.setItem('ligeiro:painel:' + loja.slug, '1'); } catch (_) { /* ignora */ }
        criada = loja;
        fim.then(function () { UI.soar('sucesso'); mostrarPronto(loja); });
      }).catch(function (e) {
        fim.cancelar();
        criando = false;
        if (e === semVaga) { telaListaDeEspera(raiz); return; }
        desenhar();
        falhar(D.erroAmigavel(e, 'Não deu para criar agora. Tente de novo em instantes.'));
      });
    }

    /* tela de "montando": tres linhas que se completam (dura o minimo para ser lida, mesmo se a loja nascer antes) */
    function montando() {
      UI.limpar(corpo);
      rotuloPasso.textContent = 'Quase lá';
      barra.firstChild.style.width = '100%';
      var linhas = ['Cardápio de exemplo do seu tipo', 'Seu link para os clientes', 'Seu painel de pedidos'].map(function (t) {
        return el('li', { class: 'montando-linha' }, [el('span', { class: 'montando-marca', 'aria-hidden': 'true' }), el('span', { text: t })]);
      });
      corpo.appendChild(el('div', { class: 'cadastro-caixa centro' }, [
        el('img', { class: 'cadastro-mascote', src: 'img/mascote.webp', alt: '' }),
        el('h2', { class: 'cadastro-pergunta', text: 'Montando sua loja…' }),
        el('ul', { class: 'montando-lista' }, linhas),
      ]));
      var cancelado = false, timers = [];
      var pronto = new Promise(function (ok) {
        linhas.forEach(function (li, i) { timers.push(setTimeout(function () { if (!cancelado) li.classList.add('feita'); }, 350 + i * 450)); });
        timers.push(setTimeout(ok, 350 + linhas.length * 450));
      });
      pronto.cancelar = function () { cancelado = true; timers.forEach(clearTimeout); };
      return pronto;
    }

    function mostrarPronto(loja) {
      UI.limpar(corpo);
      rotuloPasso.textContent = 'Pronto';
      var link = UI.linkDaLoja(loja);
      var qr = el('div', { class: 'qr-caixa', style: { width: '200px', margin: '0 auto' } });
      var textoZap = 'Agora você pode pedir na ' + loja.nome + ' pelo nosso link: ' + link;
      corpo.appendChild(el('div', { class: 'cartao destaque centro', style: { padding: '26px 18px' } }, [
        el('img', { class: 'pronto-mascote', src: 'img/mascote-192.webp', alt: '', width: '96', height: '96' }),
        el('h2', { text: loja.nome + ' está no ar' }),
        el('p', { class: 'muted', text: 'Sua loja já tem itens de exemplo. Ajuste nomes e preços no painel e comece a divulgar.' }),
        el('p', { class: 'muted pequeno', text: 'Grátis até ' + new Date(Date.now() + precos.diasGratis * 864e5).toLocaleDateString('pt-BR') + '. Depois, ' + R.dinheiro(precoPlano).replace(/,00$/, '') + (planoTipo === 'anual' ? ' por ano' : ' por mês') + ', no cartão, boleto ou Pix, em Minha conta.' }),
      ]));
      corpo.appendChild(el('div', { class: 'bloco-form' }, [
        el('div', { class: 'bloco-titulo', text: 'Seu link (para bio e para o WhatsApp)' }),
        el('div', { class: 'caixa-link', text: link }),
        el('a', { class: 'btn btn-whats btn-largo', href: 'https://wa.me/?text=' + encodeURIComponent(textoZap), target: '_blank', rel: 'noopener' }, [el('span', { class: 'icone-zap', 'aria-hidden': 'true' }), 'Mandar no WhatsApp']),
        el('div', { class: 'linha-botoes' }, [
          el('button', { class: 'btn btn-fantasma btn-pequeno', onclick: function () { UI.copiar(link).then(function (ok) { UI.avisar(ok ? 'Link copiado' : 'Toque e segure no link para copiar'); }); } }, [UI.iconeLinha('copiar'), 'Copiar link']),
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: link, target: '_blank', rel: 'noopener', text: 'Ver minha loja' }),
        ]),
        qr,
      ]));
      Pix.desenharQr(qr, link, 200);
      corpo.appendChild(el('button', { class: 'btn btn-principal btn-gigante btn-largo', text: 'Abrir meu painel', onclick: function () { window.LigeiroApp.ir('painel/' + loja.slug); } }));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', text: 'No painel, o cartão "Primeiros passos" leva você a cada coisa que falta: Mercado Pago (Pix e cartão), logo, horários e fotos.' }));
      window.scrollTo(0, 0);
    }

    desenhar();
    return function () { document.title = 'Ligeiro: pedido ligeiro, sem comissão'; };
  }

  window.LigeiroComecar = { abrir: abrir, modeloDoTipo: modeloDoTipo };
})();
