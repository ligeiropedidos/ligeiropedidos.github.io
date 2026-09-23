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
   * o = { valor, periodo ('30 dias' | '12 meses'), planoId, tipo, quem (nome da loja ou e-mail),
   *       txid, descricao, avisar: function () -> Promise (grava "ja paguei") }
   */
  function abrir(o) {
    var cfg = window.LIGEIRO_CONFIG || {};
    var pixL = cfg.pixLigeiro || {};
    var Pix = window.LigeiroPix;
    var link = R.linkDeCobranca(o.planoId, o.tipo, !!o.fundador);
    var provedor = (cfg.cobranca && cfg.cobranca.provedor) || 'Asaas';
    var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } });
    corpo.appendChild(el('p', { class: 'centro forte', text: R.dinheiro(o.valor) + ' · ' + o.periodo + ' de Ligeiro' + (o.sufixo || '') }));

    /* 1 e 2: cartao e boleto pelo link de assinatura */
    if (link) {
      corpo.appendChild(el('div', { class: 'cobranca-opcoes' }, [
        el('a', { class: 'btn btn-principal btn-largo', href: link, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('cartao'), 'Cartão de crédito · cai sozinho todo ' + (o.tipo === 'anual' ? 'ano' : 'mês')]),
        el('a', { class: 'btn btn-fantasma btn-largo', href: link, target: '_blank', rel: 'noopener' }, [UI.iconeLinha('boleto'), 'Boleto']),
      ]));
      corpo.appendChild(el('p', { class: 'muted pequeno', text: 'Abre a página segura do ' + provedor + '. Você cadastra uma vez e não precisa lembrar de pagar. Cancela quando quiser, em "Minha conta". Assim que o pagamento cai, suas lojas são liberadas sozinhas.' }));
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
        bloco.appendChild(el('p', { class: 'muted pequeno', text: 'Pagou no Pix? Toque em "Já paguei". A gente confere no banco e libera mais ' + o.periodo + '. Suas lojas não param enquanto isso.' }));
        corpo.appendChild(bloco);
      }
    }

    if (!link && !pixL.chave) {
      corpo.appendChild(el('p', { text: 'Combine o pagamento de ' + R.dinheiro(o.valor) + ' (' + o.periodo + ') direto com o Ligeiro.' }));
      if (cfg.whatsappLigeiro) corpo.appendChild(el('a', { class: 'btn btn-whats', href: R.linkWhatsapp(cfg.whatsappLigeiro, 'Oi! Quero pagar a assinatura de ' + o.quem + ' (' + R.dinheiro(o.valor) + ').'), target: '_blank', rel: 'noopener' }, [UI.icone('zap'), 'Chamar o Ligeiro']));
      else corpo.appendChild(el('p', { class: 'muted pequeno', text: 'O Ligeiro ainda não cadastrou como receber a mensalidade.' }));
      UI.abrirModal({ titulo: 'Pagar assinatura', corpo: corpo, rodape: [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Fechar', onclick: UI.fecharModal })] });
      return;
    }

    var rodape = [el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Depois', onclick: UI.fecharModal })];
    if (pixL.chave) rodape.push(el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Já paguei no Pix', onclick: function () { o.avisar().then(function () { UI.fecharModal(); }); } }));
    UI.abrirModal({ titulo: 'Pagar assinatura', corpo: corpo, rodape: rodape });
  }

  window.LigeiroCobranca = { abrir: abrir };
})();
