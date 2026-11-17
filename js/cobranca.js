/*
 * Ligeiro - pagar a assinatura (usado pelo painel e pela conta).
 *
 * O dono paga sem sair do Ligeiro (15/11/2026): o mensageiro do Asaas cria a cobranca com o e-mail da conta e a janela
 * mostra o Pix (QR e copia e cola) ou o botao do cartao. Pagou, a janela vira "Pagamento confirmado" sozinha.
 * Sem o mensageiro novo no ar, sobra a fatura que ja existir ou o WhatsApp do Ligeiro.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var el = UI.el;

  /*
   * o = { valor, periodo ('30 dias' | '12 meses'), planoId, tipo, quem (nome da loja ou e-mail), email (login do dono),
   *       txid, descricao, avisar: function () -> Promise (grava "ja paguei") }
   */
  /* Fatura do mes em aberto no Asaas (o mensageiro guarda em contas/{email}.faturaAsaas). No painel ela aparece para
     Pix e boleto nos 7 dias antes de vencer, e para qualquer forma depois de vencida (cartao em dia e cobrado sozinho).
     opcoes.todas: qualquer fatura em aberto (o botao Pagar abre ela, e nao o link que criaria outra assinatura) */
  function faturaAberta(conta, opcoes, agora) {
    var f = conta && conta.faturaAsaas;
    if (!f || !/^https:\/\/(www\.)?asaas\.com\//.test(String(f.url || ''))) return null;
    if (f.status !== 'PENDING' && f.status !== 'OVERDUE') return null;
    var hoje = agora || new Date();
    var p = String(f.vencimento || '').split('-');
    var venc = p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
    var dias = venc ? Math.round((venc.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / 864e5) : null;
    var vencida = f.status === 'OVERDUE' || (dias != null && dias < 0);
    /* assinatura que ainda nao pagou nenhuma vez (fechou o Pix ou o boleto do link): a fatura dela aparece sempre. Antes,
       no periodo gratis o botao de pagar sumia (o link criaria outra assinatura) e nao sobrava onde pagar */
    var primeira = !conta.assinaturaAsaas && !!conta.assinaturaPendente && String(f.assinatura || '') === String(conta.assinaturaPendente);
    if (!(opcoes && opcoes.todas) && !primeira) {
      if (!vencida && f.forma === 'CREDIT_CARD') return null;
      if (!vencida && (dias == null || dias > 7)) return null;
    }
    return { url: f.url, valor: Number(f.valor) || 0, vencimento: venc, dias: dias, vencida: vencida, cartao: f.forma === 'CREDIT_CARD' };
  }
  /* "vence em 3 dias (28/10)", "vence hoje", "venceu em 20/10" */
  function textoFatura(f) {
    var data = f.vencimento ? f.vencimento.toLocaleDateString('pt-BR') : '';
    if (f.vencida) return 'venceu em ' + data;
    if (f.dias === 0) return 'vence hoje';
    return 'vence em ' + f.dias + (f.dias === 1 ? ' dia' : ' dias') + (data ? ' (' + data + ')' : '');
  }

  /* Assinatura viva no Asaas (o mensageiro guarda em contas/{email}.assinaturaAsaas). Com ela, trocar de plano e encerrar
     passam pelo mensageiro (que muda a mesma assinatura) e o link de assinatura nao aparece: criaria outra assinatura,
     cobrando em dobro no cartao */
  function assinaturaAtiva(conta) {
    var p = (conta && conta.plano) || {};
    /* a pendente (so fatura, ainda nao pagou) conta: trocar e encerrar mudam ou cancelam ela junto */
    return !!(conta && (conta.assinaturaAsaas || conta.assinaturaPendente)) && p.status !== 'cancelado' && p.status !== 'pausado';
  }
  /* as rotas do dono no mensageiro do Asaas (/plano/simular, /plano/trocar, /plano/encerrar), com o login do Google */
  function pedirAoMensageiro(rota, corpo) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var base = String((cfg.cobranca && cfg.cobranca.mensageiro) || '').replace(/\/+$/, '');
    var D = window.LigeiroDados;
    var falha = function (texto) { var e = new Error(texto); e.publico = true; return e; };
    if (!base || !D || !D.store || !D.store.obterIdToken) return Promise.reject(falha('Não deu agora. Tente de novo em instantes.'));
    return D.store.obterIdToken().then(function (t) {
      return fetch(base + '/plano/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo || {}) })
        .catch(function () { throw falha('Sem internet agora. Confira a conexão e toque de novo.'); });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw falha(j.erro || 'Não deu agora. Tente de novo em instantes.');
        return j;
      });
    });
  }
  function porPeriodo(tipo) { return tipo === 'anual' ? ' por ano' : ' por mês'; }
  function diaCurto(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }

  /* Mensal <-> anual com a assinatura ativa: primeiro mostra o que acontece (o mensageiro diz o valor novo e desde quando,
     sem mexer em nada), depois troca a MESMA assinatura. o = { tipo, nomePlano, aoTerminar(resposta) } */
  function trocarPlano(o) {
    /* planoId vai junto: o mensageiro novo e o antigo aceitam (1 loja por conta) */
    return pedirAoMensageiro('simular', { planoId: 'uma', tipo: o.tipo }).then(function (s) {
      if (s.acao === 'igual') { UI.avisar('Este já é o seu plano.'); return null; }
      var linhas = [[s.proxima ? 'A partir de ' + diaCurto(s.proxima) : 'Na próxima fatura', R.dinheiro(s.valorNovo) + porPeriodo(s.tipo)]];
      var nota = s.acao === 'marcar' ? 'O próximo pagamento já é do plano novo.' : 'Até lá, vale o que você já pagou, sem cobrança a mais e sem devolução.';
      return new Promise(function (fim) {
        var confirmar = el('button', { class: 'btn btn-principal', style: { flex: '1' }, type: 'button', text: 'Confirmar troca' });
        confirmar.addEventListener('click', function () {
          var soltar = UI.ocupar(confirmar, 'Trocando…');
          if (!soltar) return;
          pedirAoMensageiro('trocar', { planoId: 'uma', tipo: o.tipo }).then(function (t) {
            UI.fecharModal();
            UI.avisar('Pronto: ' + (o.tipo === 'anual' ? 'anual' : 'mensal') + ' a partir da próxima fatura.');
            if (o.aoTerminar) o.aoTerminar(t);
            fim(t);
          }).catch(function (e) { soltar(); UI.avisar(e.message); });
        });
        UI.abrirModal({
          titulo: 'Trocar para ' + o.nomePlano,
          corpo: el('div', { class: 'pilha' }, [
            el('div', { class: 'resumo-assinatura resumo-troca' }, linhas.map(function (l) { return el('div', { class: 'linha' }, [el('span', { text: l[0] }), el('b', { text: l[1] })]); })),
            el('p', { class: 'muted pequeno', text: nota }),
          ]),
          rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, type: 'button', text: 'Voltar', onclick: function () { UI.fecharModal(); fim(null); } }), confirmar],
        });
      });
    });
  }

  /* ---------------- pagar dentro do painel (15/11/2026) ----------------
     Antes este botao abria uma janela com um aviso laranja ("use ESTE e-mail no Asaas"), uma caixinha de "Li" e dois botoes
     que levavam para o mesmo link do Asaas, onde o dono digitava nome, CPF, telefone e o e-mail de novo. A unica cliente
     de verdade nao passou dali. Agora o mensageiro cria a cobranca com o e-mail da conta (POST /plano/pagar) e a janela ja
     mostra o Pix: o QR, o Copiar codigo e a espera. Pagou, a janela vira "Pagamento confirmado" sozinha. Cartao: um botao
     para a fatura (o cartao e digitado na pagina do Asaas, e a mensalidade passa a cair sozinha). A unica coisa que o dono
     digita e o CPF ou CNPJ, e so na primeira vez (o banco exige para emitir a cobranca).
     O valor que aparece e o que o mensageiro cobra (ele e quem manda no preco). */
  function chamarMensageiro(rota, corpo) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var base = String((cfg.cobranca && cfg.cobranca.mensageiro) || '').replace(/\/+$/, '');
    var D = window.LigeiroDados;
    if (D && D.modoDemo) return demonstracao(rota, corpo);
    if (!base || !D || !D.store || !D.store.obterIdToken) return Promise.resolve({ status: 0, j: {} });
    return D.store.obterIdToken().then(function (t) {
      return fetch(base + '/plano/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo || {}) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j || {} }; });
    }).catch(function () { return { status: -1, j: {} }; });
  }
  /* na demonstracao (sem servidor) a janela e a mesma, com um Pix de mentira: "Ja paguei" marca a conta como paga */
  var demo = { doc: false, pago: false };
  function demonstracao(rota, corpo) {
    var plano = R.planoPorId('uma');
    return new Promise(function (ok) {
      setTimeout(function () {
        if (rota === 'conferir') { ok({ status: 200, j: { ok: true, pago: !!demo.pago } }); return; }
        if (rota === 'historico') {
          var h = new Date();
          var diaDe = function (meses) { var d = new Date(h.getFullYear(), h.getMonth() - meses, Math.min(h.getDate(), 28)); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
          ok({ status: 200, j: { ok: true, demo: true, pagamentos: [0, 1, 2].map(function (m) { return { id: 'pay_demo' + m, dia: diaDe(m), valor: plano.mensal, forma: m === 2 ? 'cartao' : 'pix', situacao: 'pago', recibo: m === 2 ? '' : String(location.origin + location.pathname) }; }) } });
          return;
        }
        if (!demo.doc && !(corpo && corpo.documento)) { ok({ status: 200, j: { ok: false, precisaDocumento: true, erro: 'Para gerar a cobrança, o banco pede o CPF ou o CNPJ de quem paga. É só na primeira vez.' } }); return; }
        demo.doc = true;
        var tipo = corpo && corpo.tipo === 'anual' ? 'anual' : 'mensal';
        var forma = corpo && corpo.forma === 'cartao' ? 'cartao' : 'pix';
        var em5 = new Date(Date.now() + 5 * 864e5);
        ok({ status: 200, j: { ok: true, cobranca: 'pay_demo', valor: tipo === 'anual' ? plano.anual : plano.mensal, tipo: tipo, forma: forma, demo: true,
          vencimento: em5.getFullYear() + '-' + ('0' + (em5.getMonth() + 1)).slice(-2) + '-' + ('0' + em5.getDate()).slice(-2),
          pix: forma === 'pix' ? { codigo: '00020126580014br.gov.bcb.pix0136demonstracao-do-ligeiro-sem-valor-0000520400005303986540' + (tipo === 'anual' ? '6399.00' : '539.90') + '5802BR5907LIGEIRO6006BRASIL62070503***6304ABCD' } : null,
          fatura: forma === 'cartao' ? String(location.origin + location.pathname) : '' } });
      }, 500);
    });
  }

  function reais(c) { return R.dinheiro(c).replace(/,00$/, ''); }
  function dataCurta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }
  function diasAteDia(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    var h = new Date();
    return Math.round((new Date(+p[0], +p[1] - 1, +p[2]).getTime() - new Date(h.getFullYear(), h.getMonth(), h.getDate()).getTime()) / 864e5);
  }
  function cpfOuCnpj(n) {
    function igual(s) { return /^(\d)\1+$/.test(s); }
    function digito(base, pesos) { var s = 0; for (var i = 0; i < pesos.length; i++) s += Number(base.charAt(i)) * pesos[i]; var r = s % 11; return r < 2 ? 0 : 11 - r; }
    if (n.length === 11 && !igual(n)) {
      var a = digito(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]), b = digito(n, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
      return a === Number(n.charAt(9)) && b === Number(n.charAt(10));
    }
    if (n.length === 14 && !igual(n)) {
      var c = digito(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), d = digito(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      return c === Number(n.charAt(12)) && d === Number(n.charAt(13));
    }
    return false;
  }
  function mascararDocumento(v) {
    var n = String(v || '').replace(/\D/g, '').slice(0, 14);
    if (n.length <= 11) return n.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
    return n.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }

  /*
   * o = { valor, periodo, planoId, tipo, quem (nome da loja ou e-mail), email (login do dono), fatura (faturaAberta),
   *       assinatura (ja tem assinatura paga), atrasada, aoPagar: function (conta), aoFechar: function () }
   */
  function abrir(o) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var D = window.LigeiroDados;
    var Pix = window.LigeiroPix;
    var plano = R.planoPorId('uma');
    var provedor = (cfg.cobranca && cfg.cobranca.provedor) || 'Asaas';
    var zap = cfg.whatsappLigeiro ? R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero pagar a assinatura de ' + o.quem + ' (' + R.dinheiro(o.valor) + ').') : '';
    var e = { tipo: o.tipo === 'anual' && plano.anual > 0 ? 'anual' : 'mensal', forma: 'pix', r: null, vez: 0, pago: false, doc: '', relogio: 0, lendo: false, desde: Date.now() };
    /* quem ja paga uma assinatura muda de plano em Minha conta (a assinatura dele e a mesma); quem ainda nao paga escolhe aqui */
    var podeEscolher = !o.assinatura && plano.anual > 0;
    var renovacao = !!(o.assinatura || o.fatura);

    var miolo = el('div', { class: 'assinar-miolo' });
    var formas = el('div', { class: 'assinar-formas', role: 'group', 'aria-label': 'Forma de pagamento' });
    var corpo = el('div', { class: 'assinar' }, [formas, miolo]);
    var btnFechar = el('button', { class: 'btn btn-fantasma', style: { flex: '1 1 calc(50% - 6px)' }, type: 'button', text: 'Fechar', onclick: function () { UI.fecharModal(); } });
    var btnPaguei = el('button', { class: 'btn btn-principal', style: { flex: '1 1 calc(50% - 6px)' }, type: 'button', text: 'Já paguei', hidden: true });
    var rodape = [btnFechar, btnPaguei];

    function forma(id, icone, titulo, sub) {
      var b = el('button', { class: 'assinar-forma' + (e.forma === id ? ' ativa' : ''), type: 'button', 'aria-pressed': String(e.forma === id) }, [
        el('span', { class: 'assinar-forma-ico', 'aria-hidden': 'true' }, [UI.iconeLinha(icone)]),
        el('span', { class: 'assinar-forma-texto' }, [el('b', { text: titulo }), el('small', { text: sub })]),
      ]);
      b.addEventListener('click', function () { if (e.forma === id || e.pago) return; e.forma = id; pedir(); });
      return b;
    }
    function pintarFormas() {
      UI.limpar(formas);
      formas.appendChild(forma('pix', 'celular', 'Pix', 'Libera na hora'));
      formas.appendChild(forma('cartao', 'cartao', 'Cartão', e.tipo === 'anual' ? 'Renova sozinho' : 'Cai todo mês'));
    }
    /* o quadro do valor: o que e, quanto e quando vence (o mesmo desenho da fatura) */
    function quadroValor() {
      var valor = e.r && e.r.valor ? e.r.valor : (e.tipo === 'anual' ? plano.anual : R.precoDoPlano('uma', 'mensal'));
      var dias = e.r ? diasAteDia(e.r.vencimento) : null;
      var quando = dias == null ? null
        : dias < 0 ? [UI.iconeLinha('alerta'), 'Venceu em ' + dataCurta(e.r.vencimento)]
        : dias === 0 ? [UI.iconeLinha('relogio'), 'Vence hoje']
        : [UI.iconeLinha('relogio'), 'Vence em ' + dias + (dias === 1 ? ' dia' : ' dias') + ' · ' + dataCurta(e.r.vencimento)];
      return el('div', { class: 'fatura-cartao assinar-valor' + (dias != null && dias < 0 ? ' vencida' : '') }, [
        el('span', { class: 'fatura-rotulo', text: 'Ligeiro ' + (e.tipo === 'anual' ? 'anual' : 'mensal') }),
        el('b', { class: 'fatura-valor', text: R.dinheiro(valor) }),
        quando ? el('span', { class: 'fatura-quando' }, quando) : el('span', { class: 'fatura-quando', text: e.tipo === 'anual' ? 'por ano' : 'por mês' }),
      ]);
    }
    /* mensal <-> anual, numa linha discreta embaixo do valor (so para quem ainda nao paga) */
    function trocaDeTipo() {
      if (!podeEscolher) return null;
      var outro = e.tipo === 'anual' ? 'mensal' : 'anual';
      var texto = outro === 'anual' ? 'Pagar o ano: ' + reais(plano.anual) + ' (2 meses grátis)' : 'Voltar para o mensal: ' + reais(R.precoDoPlano('uma', 'mensal'));
      return el('button', { class: 'assinar-troca', type: 'button', onclick: function () { if (e.pago) return; e.tipo = outro; pedir(); } }, [UI.iconeLinha(outro === 'anual' ? 'presente' : 'desfazer'), el('span', { text: texto })]);
    }
    function seguro() { return el('p', { class: 'garantia-botao' }, [UI.iconeLinha('cadeado'), 'Pagamento seguro pelo ' + provedor + '.']); }
    function pintar(filhos, comPaguei) {
      UI.limpar(miolo);
      filhos.forEach(function (f) { if (f) miolo.appendChild(f); });
      btnPaguei.hidden = !comPaguei;
      pintarFormas();
      formas.hidden = e.pago;
    }

    function telaGerando() {
      pintar([quadroValor(), el('div', { class: 'pix-gerando', role: 'status' }, [el('span', { class: 'girando', 'aria-hidden': 'true' }), el('span', { text: e.forma === 'cartao' ? 'Preparando o pagamento…' : 'Gerando o seu Pix…' })])], false);
    }
    function telaDocumento(aviso) {
      var campo = el('input', { id: 'assinarDoc', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '18', placeholder: '000.000.000-00', value: mascararDocumento(e.doc) });
      var erro = el('p', { class: 'msg-erro', role: 'alert', hidden: !aviso, text: aviso || '' });
      var continuar = el('button', { class: 'btn btn-principal btn-largo', type: 'button', text: e.forma === 'cartao' ? 'Continuar' : 'Gerar o Pix' });
      function enviar() {
        var n = campo.value.replace(/\D/g, '');
        if (!cpfOuCnpj(n)) { erro.textContent = n.length === 11 || n.length === 14 ? 'Esse número não confere. Veja se digitou certo.' : 'Digite o CPF (11 números) ou o CNPJ (14 números).'; erro.hidden = false; campo.classList.add('erro'); campo.focus(); return; }
        e.doc = n;
        pedir();
      }
      campo.addEventListener('input', function () { campo.value = mascararDocumento(campo.value); campo.classList.remove('erro'); erro.hidden = true; });
      campo.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); enviar(); } });
      continuar.addEventListener('click', enviar);
      pintar([
        quadroValor(),
        el('div', { class: 'campo assinar-doc' }, [
          el('label', { for: 'assinarDoc', text: 'CPF ou CNPJ de quem paga' }),
          campo,
          el('p', { class: 'campo-ajuda' }, [UI.iconeLinha('cadeado'), 'O banco pede para emitir a cobrança. É só na primeira vez.']),
        ]),
        erro, continuar,
      ], false);
      setTimeout(function () { if (campo.isConnected) { try { campo.focus({ preventScroll: true }); } catch (_) { campo.focus(); } } }, 80);
    }
    function telaPix() {
      var codigo = e.r.pix.codigo;
      var qr = el('div', { class: 'qr-caixa assinar-qr', role: 'img', 'aria-label': 'QR Code do Pix' });
      try { Pix.desenharQr(qr, codigo, 144); } catch (_) { qr.hidden = true; }
      var copiar = el('button', { class: 'btn btn-escuro btn-largo', type: 'button' }, [UI.iconeLinha('copiar'), 'Copiar código Pix']);
      copiar.addEventListener('click', function () { UI.copiar(codigo).then(function () { UI.avisar('Código copiado. Abra o app do banco e cole em Pix copia e cola.'); }); });
      pintar([
        quadroValor(), trocaDeTipo(), qr, copiar,
        el('p', { class: 'assinar-espera', role: 'status' }, [el('span', { class: 'girando', 'aria-hidden': 'true' }), el('span', { text: 'Pagou, a loja libera sozinha. Não precisa mandar comprovante.' })]),
        seguro(),
      ], true);
    }
    function telaCartao() {
      var ir = el('a', { class: 'btn btn-principal btn-largo', href: e.r.fatura, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('cartao'), 'Pagar com cartão']);
      pintar([
        quadroValor(), trocaDeTipo(),
        el('ul', { class: 'assinar-lista' }, [
          ['cadeado', 'Você digita o cartão na página segura do ' + provedor + '.'],
          ['relogio', e.tipo === 'anual' ? 'A renovação cai sozinha todo ano, sem precisar lembrar.' : 'A mensalidade cai sozinha todo mês, sem precisar lembrar.'],
          ['check', 'Cancela quando quiser, em Minha conta.'],
        ].map(function (x) { return el('li', {}, [el('span', { class: 'assinar-lista-ico', 'aria-hidden': 'true' }, [UI.iconeLinha(x[0])]), el('span', { text: x[1] })]); })),
        ir, seguro(),
      ], true);
    }
    /* sem o codigo do Pix (o banco nao devolveu): a fatura tem o Pix, o boleto e o cartao */
    function telaFatura() {
      pintar([
        quadroValor(), trocaDeTipo(),
        el('a', { class: 'btn btn-principal btn-largo', href: e.r.fatura, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('recibo'), 'Abrir a fatura']),
        el('p', { class: 'muted pequeno centro', text: 'Na fatura você paga por Pix, boleto ou cartão. Pagou, a loja libera sozinha.' }),
        seguro(),
      ], true);
    }
    function telaErro(texto, tentar) {
      pintar([
        el('div', { class: 'pix-falhou', role: 'alert' }, [
          el('p', { text: texto }),
          tentar ? el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Tentar de novo', onclick: pedir }) : null,
          zap ? el('a', { class: 'btn btn-fantasma btn-pequeno', href: zap, target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'Chamar o Ligeiro']) : null,
        ]),
      ], false);
    }
    function telaEmDia() {
      e.pago = true;
      pintar([el('div', { class: 'contato-ok assinar-pago' }, [
        el('span', { class: 'contato-ok-marca', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]),
        el('b', { text: 'Assinatura em dia' }),
        el('span', { text: 'Não há nada para pagar agora. A próxima fatura aparece aqui uns dias antes de vencer.' }),
      ])], false);
    }
    function telaPago(pagoAte) {
      e.pago = true;
      clearInterval(e.relogio);
      var ate = pagoAte ? new Date(pagoAte).toLocaleDateString('pt-BR') : '';
      pintar([el('div', { class: 'contato-ok assinar-pago', role: 'status' }, [
        el('span', { class: 'contato-ok-marca', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]),
        el('b', { text: 'Pagamento confirmado!' }),
        el('span', { text: ate ? 'Sua loja está garantida até ' + ate + ' e já recebe pedidos.' : 'Sua loja está liberada e já recebe pedidos.' }),
      ])], false);
      btnFechar.textContent = 'Fechar';
      btnFechar.className = 'btn btn-principal';
      UI.soar('sucesso');
      UI.vibrar();
    }

    /* o pedido ao mensageiro: cada troca (forma, plano, CPF) pede de novo; so a resposta do ultimo pedido vale */
    function pedir() {
      if (e.pago) return;
      var vez = ++e.vez;
      e.r = null;
      telaGerando();
      chamarMensageiro('pagar', { tipo: e.tipo, forma: e.forma, documento: e.doc || undefined, nome: o.quem && o.quem.indexOf('@') < 0 ? o.quem : undefined }).then(function (resp) {
        if (vez !== e.vez || !miolo.isConnected) return;
        var j = resp.j || {};
        if (j.precisaDocumento) { telaDocumento(''); return; }
        if (resp.status === 400 && e.doc && /CPF|CNPJ/.test(String(j.erro || ''))) { telaDocumento(j.erro); return; }
        /* pentest 17/11/2026: pagou e o aviso do Asaas ainda nao tinha chegado: o mensageiro faz o pagamento entrar e
           responde "pago" (antes apagava a assinatura paga e gerava outra cobranca) */
        if (j.ok && j.pago) { telaPago(j.pagoAte); return; }
        if (j.ok && j.emDia) { telaEmDia(); return; }
        if (j.ok && j.cobranca) {
          e.r = j;
          if (j.tipo === 'anual' || j.tipo === 'mensal') e.tipo = j.tipo;
          if (e.forma === 'pix' && j.pix && j.pix.codigo) telaPix();
          else if (j.fatura) { if (e.forma === 'cartao') telaCartao(); else telaFatura(); }
          else telaErro('Não deu para gerar o pagamento agora. Tente de novo em instantes.', true);
          return;
        }
        if (resp.status === -1) { telaErro('Sem internet agora. Confira a conexão e toque de novo.', true); return; }
        /* o mensageiro antigo (sem o pagamento pelo painel) ou sem mensageiro: a fatura que ja existe, ou o WhatsApp */
        if (resp.status === 404 || resp.status === 0) {
          if (o.fatura && o.fatura.url) { e.r = { valor: o.fatura.valor, vencimento: '', fatura: o.fatura.url }; telaFatura(); }
          else telaErro('O pagamento pelo painel está sendo ligado. Chame o Ligeiro no WhatsApp e a gente resolve agora.', false);
          return;
        }
        telaErro(j.erro || 'Não deu agora. Tente de novo em instantes.', resp.status !== 409 && resp.status !== 403);
      });
    }

    /* "Ja paguei": o mensageiro le a cobranca no banco e libera na hora (nao precisa esperar o aviso) */
    function entrou(pagoAte) {
      var D2 = window.LigeiroDados;
      var ler = o.email && D2 && D2.store && D2.store.obterConta ? D2.store.obterConta(o.email).catch(function () { return null; }) : Promise.resolve(null);
      ler.then(function (conta) {
        telaPago((conta && conta.plano && conta.plano.pagoAte) || pagoAte || '');
        if (o.aoPagar) { try { o.aoPagar(conta); } catch (_) { /* a tela de tras atualiza ao fechar */ } }
      });
    }
    btnPaguei.addEventListener('click', function () {
      if (e.pago) return;
      var soltar = UI.ocupar(btnPaguei, 'Conferindo…');
      if (!soltar) return;
      var D2 = window.LigeiroDados;
      var antes = D2 && D2.modoDemo && o.email ? D2.store.salvarConta(o.email, { plano: { status: 'ativo', planoPago: 'uma', pagoAte: new Date(Date.now() + (e.tipo === 'anual' ? 365 : 30) * 864e5).toISOString(), ultimoPagamentoEm: new Date().toISOString() } }).then(function () { demo.pago = true; }).catch(function () { /* segue */ }) : Promise.resolve();
      antes.then(function () { return chamarMensageiro('conferir', { cobranca: e.r && e.r.cobranca ? e.r.cobranca : undefined }); }).then(function (resp) {
        soltar();
        if (!miolo.isConnected) return;
        var j = resp.j || {};
        if (j.ok && j.pago) { entrou(j.pagoAte); return; }
        if (resp.status === 429) { UI.avisar(j.erro || 'Espere um instante e toque de novo.'); return; }
        UI.avisar(e.forma === 'cartao' ? 'Ainda não caiu. No cartão leva até um minuto: a janela avisa sozinha.' : 'Ainda não caiu. O Pix leva alguns segundos: a janela avisa sozinha.');
      });
    });

    UI.abrirModal({ titulo: renovacao ? (e.tipo === 'anual' ? 'Pagar a fatura' : 'Pagar a mensalidade') : 'Assinar o Ligeiro', sub: renovacao ? null : 'Pix ou cartão, sem sair daqui.', corpo: corpo, rodape: rodape, centro: true, classe: 'modal-assinar' });
    pedir();

    /* enquanto a janela esta aberta: a cada 5 s le a conta (uma leitura) para ver se o pagamento ja entrou; depois de 3
       minutos, a cada 15 s; depois de 15 minutos para (o "Ja paguei" continua valendo). Fechou a janela, para tudo */
    var passo = 0;
    e.relogio = setInterval(function () {
      var modal = document.getElementById('modal');
      if (!miolo.isConnected || !modal || !modal.classList.contains('aberto')) {
        clearInterval(e.relogio);
        e.vez++;
        if (o.aoFechar) { try { o.aoFechar(e.pago); } catch (_) { /* nada */ } }
        return;
      }
      passo++;
      var idade = Date.now() - e.desde;
      if (e.pago || e.lendo || !e.r || !e.r.cobranca || document.hidden || idade > 15 * 60000) return;
      if (passo % (idade > 3 * 60000 ? 15 : 5) !== 0) return;
      var D2 = window.LigeiroDados;
      if (!o.email || !D2 || !D2.store || !D2.store.obterConta || D2.modoDemo) return;
      e.lendo = true;
      D2.store.obterConta(o.email).then(function (conta) {
        e.lendo = false;
        if (e.pago || !conta || !miolo.isConnected) return;
        if (Array.isArray(conta.pagamentos) && conta.pagamentos.indexOf(e.r.cobranca) >= 0) {
          telaPago((conta.plano || {}).pagoAte || '');
          if (o.aoPagar) { try { o.aoPagar(conta); } catch (_) { /* nada */ } }
        }
      }).catch(function () { e.lendo = false; });
    }, 1000);
  }

  /* ---------------- os pagamentos que a conta ja fez (15/11/2026) ----------------
     Minha conta > Pagamentos. A janela pede a lista ao mensageiro (POST /plano/historico, que le no Asaas) e mostra, de
     cada pagamento, o dia, a forma, o valor e o recibo. A linha inteira abre o recibo (no celular, o toque nao precisa
     acertar a palavra). Nada fica guardado no aparelho. */
  var FORMA_PAGA = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
  function diaInteiro(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }
  function verPagamentos() {
    var miolo = el('div', { class: 'pagamentos' });
    function pintar(no) { UI.limpar(miolo); miolo.appendChild(no); }
    function linha(x) {
      var pago = x.situacao === 'pago';
      var quando = diaInteiro(x.dia) || 'Sem data';
      var forma = [FORMA_PAGA[x.forma], pago ? '' : (x.situacao === 'contestado' ? 'Contestado' : 'Devolvido')].filter(Boolean).join(' · ') || 'Pago';
      var lados = [
        el('span', { class: 'pagamento-lado' }, [el('b', { text: quando }), el('span', { text: forma })]),
        el('span', { class: 'pagamento-lado direita' }, [el('b', { text: R.dinheiro(x.valor) }), x.recibo ? el('span', { class: 'pagamento-recibo', text: 'Ver recibo' }) : null]),
      ];
      return el('li', { class: 'pagamento' + (pago ? '' : ' devolvido') }, [
        x.recibo
          ? el('a', { class: 'pagamento-linha', href: x.recibo, target: '_blank', rel: 'noopener', 'aria-label': 'Pagamento de ' + quando + ', ' + R.dinheiro(x.valor) + ': abrir o recibo' }, lados)
          : el('div', { class: 'pagamento-linha' }, lados),
      ]);
    }
    function carregar() {
      pintar(el('div', { class: 'pagamentos-aviso', role: 'status' }, [el('div', { class: 'carregando-pontos', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]), el('p', { class: 'muted pequeno', text: 'Buscando os pagamentos…' })]));
      chamarMensageiro('historico', {}).then(function (resp) {
        if (!miolo.isConnected) return;
        var l = resp.status === 200 && resp.j.ok && Array.isArray(resp.j.pagamentos) ? resp.j.pagamentos : null;
        if (!l) {
          pintar(el('div', { class: 'pagamentos-aviso', role: 'alert' }, [
            el('p', { text: resp.status === -1 ? 'Sem internet agora. Confira a conexão.' : 'Não deu para buscar os pagamentos agora.' }),
            el('button', { class: 'btn btn-principal btn-pequeno', type: 'button', text: 'Tentar de novo', onclick: carregar }),
          ]));
          return;
        }
        if (!l.length) {
          pintar(el('div', { class: 'pagamentos-aviso' }, [
            el('p', { class: 'forte', text: 'Nenhum pagamento por aqui ainda.' }),
            el('p', { class: 'muted pequeno', text: 'Pagamento combinado direto com o Ligeiro não aparece nesta lista.' }),
          ]));
          return;
        }
        pintar(el('ul', { class: 'pagamentos-lista' }, l.map(linha)));
      });
    }
    UI.abrirModal({
      titulo: 'Pagamentos', corpo: miolo, centro: true, classe: 'modal-assinar',
      rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, type: 'button', text: 'Fechar', onclick: function () { UI.fecharModal(); } })],
    });
    carregar();
  }

  window.LigeiroCobranca = { verPagamentos: verPagamentos, abrir: abrir, faturaAberta: faturaAberta, textoFatura: textoFatura, assinaturaAtiva: assinaturaAtiva, pedirAoMensageiro: pedirAoMensageiro, trocarPlano: trocarPlano };
})();
