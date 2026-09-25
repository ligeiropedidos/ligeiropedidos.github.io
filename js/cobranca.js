/*
 * Ligeiro - pagar a assinatura (usado pelo painel e pela conta).
 *
 * Tres jeitos, na ordem que menos da trabalho pro dono:
 *   1. Cartao de credito com cobranca automatica (link de assinatura do Asaas): paga uma vez, cai todo mes.
 *   2. Boleto (mesmo link).
 *   3. Pix na hora pra chave do Ligeiro + botao "Ja paguei" (o admin confirma).
 * Sem link e sem chave Pix, sobra o WhatsApp do Ligeiro.
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
    if (!(opcoes && opcoes.todas)) {
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
          if (confirmar.disabled) return;
          confirmar.disabled = true;
          pedirAoMensageiro('trocar', { planoId: 'uma', tipo: o.tipo }).then(function (t) {
            UI.fecharModal();
            UI.avisar('Pronto: ' + (o.tipo === 'anual' ? 'anual' : 'mensal') + ' a partir da próxima fatura.');
            if (o.aoTerminar) o.aoTerminar(t);
            fim(t);
          }).catch(function (e) { confirmar.disabled = false; UI.avisar(e.message); });
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

  function abrir(o) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var pixL = cfg.pixLigeiro || {};
    var Pix = window.LigeiroPix;
    var fatura = o.fatura && o.fatura.url ? o.fatura : null;
    /* assinatura ativa e nenhuma fatura em aberto: nada a pagar agora (o link criaria outra assinatura). So a atrasada sem
       fatura (sumiu no Asaas) cai no link: o mensageiro cancela a velha quando a nova pagar */
    if (!fatura && o.assinatura && !o.atrasada) {
      UI.abrirModal({
        titulo: 'Assinatura em dia',
        corpo: el('p', { class: 'muted', text: 'Sua assinatura já está ativa. No cartão, a ' + (o.tipo === 'anual' ? 'renovação' : 'mensalidade') + ' cai sozinha. No Pix ou boleto, a fatura aparece aqui e chega por e-mail uns dias antes de vencer.' }),
        rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, type: 'button', text: 'Fechar', onclick: UI.fecharModal })],
      });
      return;
    }
    var link = fatura ? fatura.url : R.linkDeCobranca(o.planoId, o.tipo, !!o.fundador);
    /* ainda sem link de cartao/boleto e sem Pix do Ligeiro: vai direto para o WhatsApp com a mensagem pronta (antes abria
       uma janela so para mostrar esse mesmo botao) */
    if (!link && !pixL.chave && cfg.whatsappLigeiro) {
      window.open(R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero pagar a assinatura de ' + o.quem + ' (' + R.dinheiro(o.valor) + ', ' + o.periodo + ').'), '_blank', 'noopener');
      return;
    }
    var provedor = (cfg.cobranca && cfg.cobranca.provedor) || 'Asaas';
    var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } });
    /* com fatura, o valor e o vencimento ficam no cartao dela (antes o valor aparecia duas vezes) */
    if (!fatura) corpo.appendChild(el('p', { class: 'centro forte', text: R.dinheiro(o.valor) + ' · ' + o.periodo + ' de Ligeiro' + (o.sufixo || '') }));

    /* ja tem fatura do mes em aberto: paga ela (o link de assinatura criaria outra assinatura em cima desta) */
    if (fatura) {
      /* cartao da fatura: o valor grande no meio, quando vence logo abaixo e as formas aceitas; vencida fica vermelha */
      var dia = fatura.vencimento ? fatura.vencimento.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
      var quando = fatura.vencida ? 'Venceu em ' + dia
        : fatura.dias === 0 ? 'Vence hoje'
        : 'Vence em ' + fatura.dias + (fatura.dias === 1 ? ' dia' : ' dias') + (dia ? ' · ' + dia : '');
      corpo.appendChild(el('div', { class: 'fatura-cartao' + (fatura.vencida ? ' vencida' : '') }, [
        /* plano anual: "Fatura" (a aberta pode ser a anual, ou a ultima mensal de quem acabou de trocar) */
        el('span', { class: 'fatura-rotulo', text: o.tipo === 'anual' ? 'Fatura do Ligeiro' : 'Mensalidade do Ligeiro' }),
        el('b', { class: 'fatura-valor', text: R.dinheiro(fatura.valor) }),
        el('span', { class: 'fatura-quando' }, [UI.iconeLinha(fatura.vencida ? 'alerta' : 'relogio'), quando]),
        el('div', { class: 'fatura-formas' }, ['Pix', 'Boleto', 'Cartão'].map(function (t) { return el('span', { class: 'fatura-forma', text: t }); })),
      ]));
      corpo.appendChild(el('div', { class: 'cobranca-opcoes' }, [
        el('a', { class: 'btn btn-principal btn-largo', href: fatura.url, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('recibo'), 'Pagar a fatura']),
      ]));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', text: 'Abre a fatura segura do ' + provedor + '. Assim que o pagamento cai, sua loja é liberada sozinha.' }));
    } else if (link) {
      var botoes = [
        /* rotulos curtos, numa linha: com "cai sozinho todo mes" o do cartao quebrava em 2 linhas e ficava torto ao lado do outro */
        el('a', { class: 'btn btn-principal btn-largo', href: link, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('cartao'), 'Cartão de crédito']),
        el('a', { class: 'btn btn-fantasma btn-largo', href: link, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('boleto'), 'Pix ou boleto']),
      ];
      /* o pagamento acha a conta pelo e-mail que a pessoa digita no Asaas: com outro e-mail, o dinheiro entra e a loja nao
         libera sozinha. Por isso o e-mail vem antes dos botoes, com Copiar, e os botoes so abrem depois do "Li" */
      if (o.email) {
        var confirmou = false;
        var campoLi = el('input', { type: 'checkbox', class: 'aceite-campo', id: 'liEmailCobranca' });
        var li = el('label', { class: 'aceite-termos', for: 'liEmailCobranca' }, [
          campoLi,
          el('span', { class: 'aceite-caixa', 'aria-hidden': 'true' }, [UI.iconeLinha('check')]),
          el('span', { class: 'aceite-texto', text: 'Li e vou usar este e-mail no ' + provedor + '.' }),
        ]);
        var travar = function () {
          botoes.forEach(function (b) {
            b.classList.toggle('btn-travado', !confirmou);
            if (confirmou) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
          });
        };
        campoLi.addEventListener('change', function () { confirmou = campoLi.checked; li.classList.remove('falta'); travar(); });
        botoes.forEach(function (b) {
          b.addEventListener('click', function (e) {
            if (confirmou) return;
            e.preventDefault();
            li.classList.remove('falta'); void li.offsetWidth; li.classList.add('falta');
            UI.avisar('Confira o e-mail e marque a caixinha antes de pagar.');
          });
        });
        travar();
        corpo.appendChild(el('div', { class: 'cobranca-email' }, [
          el('div', { class: 'cobranca-email-topo' }, [UI.iconeLinha('alerta'), el('b', { text: 'Use este e-mail no ' + provedor })]),
          el('div', { class: 'cobranca-email-linha' }, [
            el('span', { class: 'cobranca-email-valor', text: o.email }),
            el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { UI.copiar(o.email).then(function () { UI.avisar('E-mail copiado. Cole na página do ' + provedor + '.'); }); } }, [UI.iconeLinha('copiar'), 'Copiar e-mail']),
          ]),
          el('p', { class: 'pequeno', text: 'É por ele que sua loja é liberada sozinha. Com outro e-mail, o pagamento entra, mas a liberação fica esperando o Ligeiro conferir.' }),
          li,
        ]));
      }
      corpo.appendChild(el('div', { class: 'cobranca-opcoes' }, botoes));
      corpo.appendChild(el('p', { class: 'muted pequeno centro', text: 'Abre a página segura do ' + provedor + '. No cartão, a cobrança cai sozinha todo ' + (o.tipo === 'anual' ? 'ano' : 'mês') + ', sem precisar lembrar. Cancela quando quiser, em "Minha conta". Assim que o pagamento cai, sua loja é liberada sozinha.' }));
    }

    /* 3: Pix manual */
    if (pixL.chave) {
      var codigo = null;
      try { codigo = Pix.gerar({ chave: pixL.chave, nome: pixL.nome || 'Ligeiro', cidade: pixL.cidade || 'Juquia', valor: o.valor, txid: o.txid, descricao: o.descricao || 'Ligeiro assinatura' }); } catch (e) { codigo = null; }
      if (codigo) {
        var bloco = el('div', { class: 'pilha cobranca-pix' });
        if (link) bloco.appendChild(el('div', { class: 'hub-secao', text: 'Ou pague agora no Pix' }));
        var qr = el('div', { class: 'qr-caixa', style: { width: '180px', margin: '0 auto' } });
        bloco.appendChild(qr);
        Pix.desenharQr(qr, codigo, 180);
        bloco.appendChild(el('div', { class: 'codigo-pix', text: codigo }));
        bloco.appendChild(el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { UI.copiar(codigo).then(function () { UI.avisar('Código copiado. Cole no app do banco.'); }); } }, [UI.iconeLinha('copiar'), 'Copiar Pix copia e cola']));
        bloco.appendChild(el('p', { class: 'muted pequeno', text: 'Pagou no Pix? Toque em "Já paguei". A gente confere no banco e libera mais ' + o.periodo + '. Sua loja não para enquanto isso.' }));
        corpo.appendChild(bloco);
      }
    }

    if (!link && !pixL.chave) {
      corpo.appendChild(el('p', { text: 'Combine o pagamento de ' + R.dinheiro(o.valor) + ' (' + o.periodo + ') direto com o Ligeiro.' }));
      if (cfg.whatsappLigeiro) corpo.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero pagar a assinatura de ' + o.quem + ' (' + R.dinheiro(o.valor) + ').'), target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'Chamar o Ligeiro']));
      else corpo.appendChild(el('p', { class: 'muted pequeno', text: 'O Ligeiro ainda não cadastrou como receber a assinatura.' }));
      UI.abrirModal({ titulo: 'Pagar assinatura', corpo: corpo, rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Fechar', onclick: UI.fecharModal })] });
      return;
    }

    var rodape = [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Depois', onclick: UI.fecharModal })];
    if (pixL.chave) rodape.push(el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Já paguei no Pix', onclick: function () { o.avisar().then(function () { UI.fecharModal(); }); } }));
    UI.abrirModal({ titulo: 'Pagar assinatura', corpo: corpo, rodape: rodape });
  }

  window.LigeiroCobranca = { abrir: abrir, faturaAberta: faturaAberta, textoFatura: textoFatura, assinaturaAtiva: assinaturaAtiva, pedirAoMensageiro: pedirAoMensageiro, trocarPlano: trocarPlano };
})();
