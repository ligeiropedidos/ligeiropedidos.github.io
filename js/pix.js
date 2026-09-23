/*
 * Ligeiro - Pix "copia e cola" gerado no proprio navegador.
 *
 * Monta o codigo no padrao BR Code do Banco Central (o mesmo que o app do
 * banco le no QR ou no "copia e cola"). Nao precisa de banco, de API nem de
 * intermediario: so da chave Pix da loja, do nome, da cidade e do valor.
 *
 * O dinheiro vai do cliente direto para a conta da loja. O Ligeiro nunca
 * encosta nele.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.LigeiroPix = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* CRC16-CCITT (polinomio 0x1021, inicio 0xFFFF), exigido no fim do codigo. */
  function crc16(texto) {
    var crc = 0xFFFF;
    var bytes = utf8(texto);
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function utf8(texto) {
    var s = String(texto);
    var saida = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) saida.push(c);
      else if (c < 0x800) saida.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = s.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        saida.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else saida.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return saida;
  }

  /* Cada campo do BR Code e "ID + tamanho com 2 digitos + valor". */
  function campo(id, valor) {
    var v = String(valor);
    return id + String(v.length).padStart(2, '0') + v;
  }

  /* Nome e cidade vao sem acento e em maiusculas, como os bancos gostam. */
  function limpar(texto, maximo) {
    return String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 .\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
      .slice(0, maximo);
  }

  /*
   * Aceita a chave do jeito que o dono digitou e devolve no formato que o
   * Pix espera: telefone com +55, CPF/CNPJ so numeros, e-mail minusculo,
   * chave aleatoria como esta.
   */
  function normalizarChave(bruta) {
    var chave = String(bruta || '').trim();
    if (!chave) return '';
    if (chave.indexOf('@') > 0) return chave.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) return chave.toLowerCase();
    var digitos = chave.replace(/\D/g, '');
    if (digitos.length === 11 && chave.indexOf('+') < 0 && !/^[6-9]/.test(digitos.slice(2, 3))) {
      /* 11 digitos pode ser CPF ou celular. Celular comeca com DDD + 9. */
      return digitos;
    }
    if (digitos.length === 11 && /^[1-9][0-9]9/.test(digitos) && !cpfValido(digitos)) return '+55' + digitos;
    if (digitos.length === 13 && digitos.indexOf('55') === 0) return '+' + digitos;
    if (digitos.length === 14) return digitos;
    if (digitos.length === 11) return digitos;
    return chave;
  }

  /* Digitos verificadores do CPF: separa 123.456.789-09 de um celular (13) 99999-9999. */
  function cpfValido(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    var soma = 0, i;
    for (i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
    var dv1 = (soma * 10) % 11; if (dv1 === 10) dv1 = 0;
    if (dv1 !== Number(d[9])) return false;
    soma = 0;
    for (i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
    var dv2 = (soma * 10) % 11; if (dv2 === 10) dv2 = 0;
    return dv2 === Number(d[10]);
  }

  function tipoDaChave(chave) {
    var c = String(chave || '');
    if (!c) return 'vazia';
    if (c.indexOf('@') > 0) return 'e-mail';
    if (c.indexOf('+') === 0) return 'telefone';
    if (/^[0-9a-f-]{36}$/i.test(c)) return 'aleatória';
    var d = c.replace(/\D/g, '');
    if (d.length === 11) return 'CPF';
    if (d.length === 14) return 'CNPJ';
    return 'desconhecida';
  }

  /*
   * gerar({ chave, nome, cidade, valor (centavos), txid, descricao })
   * -> texto do "copia e cola"
   */
  function gerar(dados) {
    var chave = normalizarChave(dados.chave);
    if (!chave) throw new Error('A loja ainda não cadastrou a chave Pix.');

    var conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
    if (dados.descricao) {
      var desc = limpar(dados.descricao, 30);
      /* O campo 26 inteiro tem no maximo 99 caracteres. */
      if (desc && (conta.length + 4 + desc.length) <= 99) conta += campo('02', desc);
    }

    var payload = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
    var valor = Math.round(Number(dados.valor) || 0);
    if (valor > 0) payload += campo('54', (valor / 100).toFixed(2));
    payload += campo('58', 'BR');
    payload += campo('59', limpar(dados.nome, 25) || 'LOJA');
    payload += campo('60', limpar(dados.cidade, 15) || 'BRASIL');
    var txid = String(dados.txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
    payload += campo('62', campo('05', txid));
    payload += '6304';
    return payload + crc16(payload);
  }

  /* Le de volta os campos principais de um codigo (usado nos testes e na tela de ajustes). */
  function ler(codigo) {
    var s = String(codigo || '');
    var i = 0;
    var campos = {};
    while (i + 4 <= s.length) {
      var id = s.slice(i, i + 2);
      var tam = Number(s.slice(i + 2, i + 4));
      var valor = s.slice(i + 4, i + 4 + tam);
      campos[id] = valor;
      i += 4 + tam;
    }
    var conta = {};
    var m = campos['26'] || '';
    var j = 0;
    while (j + 4 <= m.length) {
      var id2 = m.slice(j, j + 2);
      var tam2 = Number(m.slice(j + 2, j + 4));
      conta[id2] = m.slice(j + 4, j + 4 + tam2);
      j += 4 + tam2;
    }
    var crcOk = s.length > 4 && crc16(s.slice(0, -4)) === s.slice(-4);
    return {
      chave: conta['01'] || '',
      descricao: conta['02'] || '',
      valor: campos['54'] ? Math.round(Number(campos['54']) * 100) : 0,
      nome: campos['59'] || '',
      cidade: campos['60'] || '',
      txid: (campos['62'] || '').slice(4),
      crcOk: crcOk,
    };
  }

  /* A biblioteca de QR (57 KB) so baixa quando algum QR vai aparecer: quem so olha o cardapio nao baixa.
     O fechamento do pedido ja chama carregarQr(), para a tela do Pix abrir com o QR pronto. */
  var carregandoQr = null;
  function carregarQr() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('sem navegador'));
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (carregandoQr) return carregandoQr;
    var tag = ((((document.querySelector('script[src*="js/app.js"]') || {}).src) || '').match(/\?v=([0-9a-z]+)/) || [])[1] || '1';
    carregandoQr = new Promise(function (ok, nao) {
      var s = document.createElement('script');
      s.src = 'vendor/qrcode.js?v=' + tag;
      s.onload = function () { if (window.qrcode) ok(window.qrcode); else { carregandoQr = null; nao(new Error('QR')); } };
      s.onerror = function () { carregandoQr = null; nao(new Error('QR')); };
      document.head.appendChild(s);
    });
    return carregandoQr;
  }
  function desenharAgora(elemento, codigo, tamanho, lib) {
    try {
      var qr = lib(0, 'M');
      qr.addData(codigo);
      qr.make();
      var celulas = qr.getModuleCount();
      var px = Math.max(2, Math.floor((tamanho || 240) / celulas));
      elemento.innerHTML = qr.createSvgTag({ cellSize: px, margin: 2, scalable: true });
      var svg = elemento.querySelector('svg');
      if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
      return true;
    } catch (_) {
      return false;
    }
  }
  /* Desenha o QR num elemento. Sem a biblioteca ainda: busca e desenha quando chegar (some se nao der). */
  function desenharQr(elemento, codigo, tamanho) {
    if (!elemento) return false;
    var lib = (typeof window !== 'undefined') ? window.qrcode : null;
    if (lib) return desenharAgora(elemento, codigo, tamanho, lib);
    if (typeof document === 'undefined') return false;
    carregarQr().then(function (l) { if (!desenharAgora(elemento, codigo, tamanho, l)) elemento.hidden = true; }, function () { elemento.hidden = true; });
    return true;
  }

  return {
    crc16: crc16,
    campo: campo,
    limpar: limpar,
    normalizarChave: normalizarChave,
    tipoDaChave: tipoDaChave,
    gerar: gerar,
    ler: ler,
    desenharQr: desenharQr,
    carregarQr: carregarQr,
  };
});
