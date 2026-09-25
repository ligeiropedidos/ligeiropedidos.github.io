/*
 * Ligeiro - Pulo do Ligeiro: o segundo joguinho da espera do pedido (o convite fica embaixo do da Corrida).
 *
 * O ratinho do Ligeiro pula sozinho de plataforma em plataforma e sobe o mais alto que der; quem joga so escolhe o
 * lado (segurando o dedo na metade da tela, ou as setas). Saiu por um lado da tela, volta pelo outro. Caiu la embaixo,
 * acabou. O ceu muda com a altura: dia, por do sol, noite e o espaco.
 *
 * Plataformas: tabua verde (normal), azul (anda de lado), caixa de papelao (quebra: nao segura ninguem) e a mola (pulo
 * grande). O gato e o pombo derrubam o ratinho, menos se ele cair por cima deles. Os lanches da loja viram os poderes,
 * como na Corrida: turbo (sobe voando), ima (puxa as moedas) e capacete (salva uma vez, da queda ou do bicho).
 *
 * Tudo no aparelho, como a Corrida: nenhuma leitura nem gravacao no banco, nenhum anuncio, nenhuma imagem nova (o
 * desenho e feito em codigo, num canvas). O recorde fica no proprio celular. Este arquivo so baixa quando o cliente toca
 * em "Jogar".
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var el = UI.el;

  var CHAVE_RECORDE = 'ligeiro:pulo:recorde';
  /* som e musica: a mesma escolha da Corrida (quem desligou la nao quer som aqui) */
  var CHAVE_SOM = 'ligeiro:jogo:som';
  var CHAVE_MUSICA = 'ligeiro:jogo:musica';

  /* ---- o mundo, em unidades: a tela mostra sempre 360 de largura; a altura vai subindo ---- */
  var LARG = 360;
  var G = 1800;             /* gravidade */
  var PULO = 860;           /* pulo normal: sobe PULO^2 / (2G) = 205 */
  var MOLA = 1400;          /* pulo da mola: sobe 544 */
  var ALTURA_PULO = PULO * PULO / (2 * G);
  var VAO_TETO = Math.floor(ALTURA_PULO * 0.8); /* o maior vao entre duas plataformas firmes: sempre sobra folga */
  var VEL_LADO = 400;       /* velocidade maxima para o lado */
  var ACEL_LADO = 2400;     /* quanto acelera e freia para o lado */
  var PLAT_L = 64;          /* largura da plataforma */
  var PE = 10;              /* meia largura dos pes: pisa mesmo com o pe so na beirada */
  var CAMERA = 0.45;        /* o ratinho fica a 45% da altura da tela, de baixo para cima */
  var PODERES = { turbo: 2.2, ima: 8, escudo: 0 };
  var TURBO_VEL = 1250;
  var MARCO = 5000;         /* a cada 500 m, um recado */
  var DIF_TOPO = 26000;     /* altura em que o jogo chega na dificuldade maxima */

  /* o ceu por altura: [altura, cor de cima, cor de baixo]; entre dois pontos a cor vai mudando aos poucos */
  var CEU = [
    [0, '#4FB6EE', '#D4F0FF'], [6000, '#4FB6EE', '#D4F0FF'],
    [9000, '#F4845F', '#FFE0A3'], [13000, '#F4845F', '#FFE0A3'],
    [17000, '#0E1B3D', '#2B4A7C'], [28000, '#0E1B3D', '#2B4A7C'],
    [33000, '#03040B', '#161A38'],
  ];

  /* icones de traco que so o jogo usa (o resto vem do site) */
  var ICO = {
    pausa: '<path d="M9 5.5v13"/><path d="M15 5.5v13"/>',
    som: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    semSom: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>',
    lados: '<path d="M8 7 3 12l5 5"/><path d="M16 7l5 5-5 5"/><path d="M3 12h18"/>',
    sobe: '<path d="M5 19c2-6 5-9 7-9s5 3 7 9"/><path d="M12 10V3"/><path d="M9 6l3-3 3 3"/>',
  };
  function icone(nome) {
    if (!ICO[nome]) return UI.iconeLinha(nome);
    return el('span', { class: 'ico-traco', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + ICO[nome] + '</svg>' });
  }
  function numero(n) { return Math.floor(n).toLocaleString('pt-BR'); }
  function ler(chave, padrao) { var v = UI.lerLocal ? UI.lerLocal(chave) : null; return v == null ? padrao : v; }
  function guardar(chave, valor) { if (UI.guardarLocal) UI.guardarLocal(chave, valor); }
  var menosMovimento = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* posicao na largura, dando a volta (saiu de um lado, entra do outro) */
  function embrulhar(x) { x = x % LARG; return x < 0 ? x + LARG : x; }
  /* a menor distancia de lado entre dois pontos, contando a volta pela beirada (de -180 a 180) */
  function distX(a, b) { var d = embrulhar(a - b); return d > LARG / 2 ? d - LARG : d; }
  /* numero "sorteado" sempre igual para o mesmo n (nuvens e estrelas nao mudam de lugar a cada quadro) */
  function fixo(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ================================================================ desenhos (feitos uma vez so) ============ */

  /* um desenho guardado numa tela pequena: depois so e copiado, crescendo ou diminuindo (rapido ate em celular fraco) */
  function sprite(w, h, desenhar) {
    var esc = 2;
    var c = document.createElement('canvas');
    c.width = Math.ceil(w * esc); c.height = Math.ceil(h * esc);
    var x = c.getContext('2d');
    x.scale(esc, esc);
    x.lineJoin = 'round'; x.lineCap = 'round';
    desenhar(x, w, h);
    return c;
  }
  function retangulo(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py); x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }
  function bola(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); }
  function oval(x, cx, cy, rx, ry, giro) { x.beginPath(); x.ellipse(cx, cy, rx, ry, giro || 0, 0, Math.PI * 2); x.closePath(); }

  var SP = null;
  /* o adesivo no peito do ratinho: a logo da loja (ele entrega para ela); sem logo, o "L" do Ligeiro */
  var marca = null;
  /* os lanches da loja viram os poderes (foto ou emoji do cardapio, que ja esta no celular: nada vem do banco).
     O primeiro vira turbo, o segundo ima, o terceiro capacete (a mesma ordem da Corrida) */
  var PRODUTOS = [], PODER_DE = {};
  var TIPOS_PODER = ['turbo', 'ima', 'escudo'];
  var COR_PODER = { ima: '#E53935', turbo: '#FFB300', escudo: '#1E88E5' };
  var FAZ_PODER = { ima: 'vira ímã', turbo: 'dá turbo', escudo: 'vira capacete' };
  function nomeCurto(n) { n = String(n || ''); return n.length > 16 ? n.slice(0, 15).trim() + '…' : n; }
  function precoEmReais(c) { var R = window.LigeiroRegras; return R && R.dinheiro ? R.dinheiro(c) : 'R$ ' + (c / 100).toFixed(2).replace('.', ','); }

  /* o poder com a cara do lanche: foto redonda (ou o emoji), a borda na cor do poder e o icone do poder no canto */
  function poderesDaLoja() {
    PODER_DE = {};
    PRODUTOS.forEach(function (p, i) {
      var tipo = TIPOS_PODER[i];
      if (!tipo) return;
      var desenho = SP[tipo];
      SP[tipo] = sprite(64, 64, function (x) {
        bola(x, 32, 32, 31); x.fillStyle = 'rgba(255,255,255,0.4)'; x.fill();
        bola(x, 32, 32, 28); x.fillStyle = COR_PODER[tipo]; x.fill();
        bola(x, 32, 32, 24); x.fillStyle = '#FFFFFF'; x.fill();
        x.save(); bola(x, 32, 32, 23); x.clip();
        if (p.img && p.img.naturalWidth) {
          var k = Math.max(46 / p.img.naturalWidth, 46 / p.img.naturalHeight);
          var w = p.img.naturalWidth * k, h = p.img.naturalHeight * k;
          try { x.drawImage(p.img, 32 - w / 2, 32 - h / 2, w, h); } catch (_) { /* sem foto */ }
        } else {
          x.font = '28px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(p.emoji || '🍔', 32, 34);
        }
        x.restore();
        x.drawImage(desenho, 40, 40, 24, 24);
      });
      PODER_DE[tipo] = p;
    });
  }

  /* poder no ar: uma bolha colorida com o desenho branco dentro (ima vermelho, turbo amarelo, capacete azul) */
  function bolhaDePoder(cor, desenho) {
    return sprite(64, 64, function (x) {
      bola(x, 32, 32, 30); x.fillStyle = 'rgba(255,255,255,0.35)'; x.fill();
      bola(x, 32, 32, 26); x.fillStyle = cor; x.fill();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 3; bola(x, 32, 32, 26); x.stroke();
      x.fillStyle = '#FFFFFF'; x.strokeStyle = '#FFFFFF';
      desenho(x);
      x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 20, 3.7, 4.5); x.stroke();
    });
  }

  /* o ratinho do Ligeiro de frente, pulando de bracos para cima: chapeu de cozinheiro, jaqueta verde e a caixa de
     entrega nas costas (aparece dos lados). tonto: os olhos viram X (quando o gato pega) */
  function ratinho(tonto) {
    return sprite(64, 84, function (x) {
      /* rabo, atras de tudo */
      x.strokeStyle = '#F4A7B9'; x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(42, 72); x.bezierCurveTo(58, 70, 62, 56, 55, 50); x.stroke();
      /* caixa de entrega nas costas */
      x.fillStyle = '#0F3D2E'; retangulo(x, 13, 46, 38, 22, 5); x.fill();
      x.fillStyle = '#84CC16'; x.fillRect(13, 61, 38, 3);
      /* pernas e pes */
      x.fillStyle = '#D3CCD7'; retangulo(x, 24, 66, 6, 10, 3); x.fill(); retangulo(x, 34, 66, 6, 10, 3); x.fill();
      x.fillStyle = '#F4A7B9'; oval(x, 26, 79, 6.5, 4); x.fill(); oval(x, 38, 79, 6.5, 4); x.fill();
      /* bracos para cima */
      x.fillStyle = '#E6E1E8';
      oval(x, 17, 46, 4, 9, 0.55); x.fill(); oval(x, 47, 46, 4, 9, -0.55); x.fill();
      bola(x, 12.5, 38.5, 4); x.fill(); bola(x, 51.5, 38.5, 4); x.fill();
      /* jaqueta do Ligeiro */
      x.fillStyle = '#84CC16'; retangulo(x, 19, 45, 26, 25, 10); x.fill();
      x.fillStyle = '#5E9A0C'; retangulo(x, 19, 62, 26, 8, 4); x.fill();
      x.fillStyle = '#FFFFFF'; bola(x, 32, 54, 6.5); x.fill();
      if (marca && marca.img && marca.img.complete && marca.img.naturalWidth) {
        x.save(); bola(x, 32, 54, 6); x.clip();
        var iw = marca.img.naturalWidth, ih = marca.img.naturalHeight || iw;
        var esc = (marca.logo ? 11 : 13) / Math.max(iw, ih);
        try { x.drawImage(marca.img, 32 - (iw * esc) / 2, 54 - (ih * esc) / 2, iw * esc, ih * esc); } catch (_) { /* sem logo */ }
        x.restore();
      } else { x.fillStyle = '#0F3D2E'; x.font = '900 8px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('L', 32, 54.5); }
      /* orelhas */
      x.fillStyle = '#E6E1E8'; bola(x, 15, 22, 9.5); x.fill(); bola(x, 49, 22, 9.5); x.fill();
      x.fillStyle = '#F4A7B9'; bola(x, 15, 22, 5.5); x.fill(); bola(x, 49, 22, 5.5); x.fill();
      /* cabeca */
      x.fillStyle = '#ECE8EE'; bola(x, 32, 32, 15); x.fill();
      x.strokeStyle = '#C9C1CE'; x.lineWidth = 1.5; bola(x, 32, 32, 15); x.stroke();
      /* bochechas e bigode */
      x.fillStyle = 'rgba(244,120,150,0.35)'; oval(x, 22.5, 37.5, 3.2, 2); x.fill(); oval(x, 41.5, 37.5, 3.2, 2); x.fill();
      x.strokeStyle = '#B9AFC0'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(25, 36.5); x.lineTo(14, 34.5); x.moveTo(25, 38); x.lineTo(14, 39.5); x.moveTo(39, 36.5); x.lineTo(50, 34.5); x.moveTo(39, 38); x.lineTo(50, 39.5); x.stroke();
      /* olhos */
      if (tonto) {
        x.strokeStyle = '#1D1F22'; x.lineWidth = 1.8;
        [26.5, 37.5].forEach(function (ox) { x.beginPath(); x.moveTo(ox - 2.4, 28.6); x.lineTo(ox + 2.4, 33.4); x.moveTo(ox + 2.4, 28.6); x.lineTo(ox - 2.4, 33.4); x.stroke(); });
      } else {
        x.fillStyle = '#1D1F22'; bola(x, 26.5, 31, 2.7); x.fill(); bola(x, 37.5, 31, 2.7); x.fill();
        x.fillStyle = '#FFFFFF'; bola(x, 27.4, 30.1, 0.95); x.fill(); bola(x, 38.4, 30.1, 0.95); x.fill();
      }
      /* focinho e boca */
      x.fillStyle = '#F07A9A'; bola(x, 32, 36.5, 2.4); x.fill();
      x.strokeStyle = '#7A5A66'; x.lineWidth = 1.2;
      x.beginPath(); if (tonto) { x.arc(32, 42, 2.6, Math.PI * 1.1, Math.PI * 1.9); } else { x.arc(32, 38.4, 3, Math.PI * 0.15, Math.PI * 0.85); } x.stroke();
      /* chapeu de cozinheiro */
      x.fillStyle = '#FFFFFF';
      bola(x, 25, 12, 6.5); x.fill(); bola(x, 32, 8.5, 7.5); x.fill(); bola(x, 39, 12, 6.5); x.fill();
      retangulo(x, 23, 12, 18, 8, 2.5); x.fill();
      x.strokeStyle = '#DADFDD'; x.lineWidth = 1.2; retangulo(x, 23, 12, 18, 8, 2.5); x.stroke();
      x.fillStyle = '#2E9D4F'; x.fillRect(23, 17, 18, 3);
    });
  }

  /* tabua da plataforma: [cor, cor de cima, cor de baixo, contorno] */
  function tabua(cores, extra) {
    return sprite(68, 20, function (x) {
      x.fillStyle = 'rgba(14,31,20,0.16)'; retangulo(x, 4, 6, 62, 13, 6.5); x.fill(); /* sombrinha */
      x.fillStyle = cores[0]; retangulo(x, 2, 2, 64, 14, 7); x.fill();
      x.fillStyle = cores[2]; retangulo(x, 2, 10, 64, 6, 3); x.fill();
      x.fillStyle = cores[1]; retangulo(x, 6, 3.5, 56, 3.5, 1.75); x.fill();
      x.strokeStyle = cores[3]; x.lineWidth = 1.5; retangulo(x, 2, 2, 64, 14, 7); x.stroke();
      if (extra) extra(x);
    });
  }

  function montarDesenhos(cidade) {
    SP = {};
    SP.rato = ratinho(false);
    SP.ratoTonto = ratinho(true);
    SP.normal = tabua(['#84CC16', '#C6F27A', '#5E9A0C', '#4D7C0F']);
    SP.movel = tabua(['#3BA3E8', '#A8DCFF', '#1E78B8', '#17639A'], function (x) {
      x.fillStyle = '#FFFFFF';
      x.beginPath(); x.moveTo(9, 9); x.lineTo(14, 5.5); x.lineTo(14, 12.5); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(59, 9); x.lineTo(54, 5.5); x.lineTo(54, 12.5); x.closePath(); x.fill();
    });
    /* caixa de papelao: parece plataforma, mas rasga quando pisam */
    SP.quebra = sprite(68, 20, function (x) {
      x.fillStyle = 'rgba(14,31,20,0.14)'; retangulo(x, 4, 6, 62, 13, 3); x.fill();
      x.fillStyle = '#C8955A'; retangulo(x, 2, 2, 64, 14, 3); x.fill();
      x.fillStyle = '#A8733C'; x.fillRect(2, 11, 64, 5);
      x.fillStyle = '#E8D3A8'; x.fillRect(29, 2, 10, 14);
      x.strokeStyle = '#6B4423'; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(14, 2); x.lineTo(18, 7); x.lineTo(15, 10); x.lineTo(20, 16); x.stroke();
      x.beginPath(); x.moveTo(50, 2); x.lineTo(47, 6); x.lineTo(52, 10); x.lineTo(49, 16); x.stroke();
      x.strokeStyle = '#8A5A2E'; x.lineWidth = 1.5; retangulo(x, 2, 2, 64, 14, 3); x.stroke();
    });
    /* a mola em cima da tabua: encolhida e esticada (logo depois do pulo) */
    function mola(esticada) {
      var alt = esticada ? 26 : 14;
      return sprite(24, alt, function (x) {
        x.strokeStyle = '#8E9A9E'; x.lineWidth = 2.4;
        var voltas = 4, passo = (alt - 5) / voltas;
        x.beginPath(); x.moveTo(5, alt);
        for (var i = 0; i < voltas; i++) { x.lineTo(19, alt - passo * (i + 0.5)); x.lineTo(5, alt - passo * (i + 1)); }
        x.stroke();
        x.fillStyle = '#E53935'; retangulo(x, 1, 0, 22, 5, 2.5); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(4, 1, 10, 1.5);
      });
    }
    SP.mola = mola(false);
    SP.molaSolta = mola(true);
    /* moeda do Ligeiro (a mesma da Corrida) */
    SP.moeda = sprite(64, 64, function (x) {
      bola(x, 32, 32, 30); x.fillStyle = '#D9A109'; x.fill();
      bola(x, 32, 32, 25); x.fillStyle = '#F7C325'; x.fill();
      bola(x, 32, 32, 19); x.fillStyle = '#FFD84A'; x.fill();
      x.fillStyle = '#0F3D2E'; x.font = '900 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('L', 32, 34);
      x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 4; x.beginPath(); x.arc(32, 32, 22, 3.6, 4.6); x.stroke();
    });
    SP.ima = bolhaDePoder('#E53935', function (x) {
      x.lineWidth = 7; x.lineCap = 'butt';
      x.beginPath(); x.moveTo(22, 18); x.lineTo(22, 32); x.arc(32, 32, 10, Math.PI, 0, true); x.lineTo(42, 18); x.stroke();
      x.fillStyle = '#FFCDD2'; x.fillRect(18, 16, 8, 6); x.fillRect(38, 16, 8, 6);
    });
    SP.turbo = bolhaDePoder('#FFB300', function (x) {
      x.beginPath(); x.moveTo(35, 12); x.lineTo(20, 35); x.lineTo(30, 35); x.lineTo(27, 52); x.lineTo(44, 27); x.lineTo(34, 27); x.closePath(); x.fill();
    });
    SP.escudo = bolhaDePoder('#1E88E5', function (x) {
      x.beginPath(); x.moveTo(16, 38); x.quadraticCurveTo(16, 16, 32, 15); x.quadraticCurveTo(48, 16, 48, 38); x.closePath(); x.fill();
      x.fillStyle = '#1E88E5'; retangulo(x, 22, 30, 20, 7, 3); x.fill();
      x.fillStyle = '#FFFFFF'; retangulo(x, 14, 38, 36, 6, 3); x.fill();
    });
    /* gato laranja sentado, de frente, abanando o rabo (dois passos) */
    SP.gato = [0, 1].map(function (passo) {
      return sprite(56, 56, function (x) {
        x.strokeStyle = '#E0852B'; x.lineWidth = 5;
        x.beginPath(); x.moveTo(38, 50); x.bezierCurveTo(52, 50, 54, passo ? 34 : 38, passo ? 48 : 52, passo ? 26 : 30); x.stroke();
        x.fillStyle = '#F29D38'; oval(x, 28, 42, 13, 13); x.fill();
        x.fillStyle = '#FCE3C0'; oval(x, 28, 45, 7, 9); x.fill();
        x.fillStyle = '#F29D38'; oval(x, 21, 54, 5, 2.8); x.fill(); oval(x, 35, 54, 5, 2.8); x.fill();
        x.beginPath(); x.moveTo(15, 18); x.lineTo(17, 3); x.lineTo(26, 12); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(41, 18); x.lineTo(39, 3); x.lineTo(30, 12); x.closePath(); x.fill();
        x.fillStyle = '#F7B7C5';
        x.beginPath(); x.moveTo(18, 14); x.lineTo(19, 7); x.lineTo(23, 11.5); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(38, 14); x.lineTo(37, 7); x.lineTo(33, 11.5); x.closePath(); x.fill();
        x.fillStyle = '#F29D38'; oval(x, 28, 21, 14, 12); x.fill();
        x.strokeStyle = '#D9771C'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(28, 10); x.lineTo(28, 15); x.moveTo(23, 11); x.lineTo(24, 15); x.moveTo(33, 11); x.lineTo(32, 15); x.stroke();
        x.beginPath(); x.moveTo(17, 38); x.lineTo(22, 40); x.moveTo(16, 43); x.lineTo(21, 44); x.moveTo(39, 38); x.lineTo(34, 40); x.moveTo(40, 43); x.lineTo(35, 44); x.stroke();
        x.fillStyle = '#FCE3C0'; oval(x, 28, 26, 6.5, 4.5); x.fill();
        x.fillStyle = '#7BC043'; oval(x, 22.5, 20, 3.2, 3.6); x.fill(); oval(x, 33.5, 20, 3.2, 3.6); x.fill();
        x.fillStyle = '#1D1F22'; oval(x, 22.5, 20, 1, 3); x.fill(); oval(x, 33.5, 20, 1, 3); x.fill();
        x.fillStyle = '#E8707F'; x.beginPath(); x.moveTo(26, 24); x.lineTo(30, 24); x.lineTo(28, 26.5); x.closePath(); x.fill();
        x.strokeStyle = '#8A5A2E'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(24, 26); x.lineTo(14, 24.5); x.moveTo(24, 27.5); x.lineTo(14, 29); x.moveTo(32, 26); x.lineTo(42, 24.5); x.moveTo(32, 27.5); x.lineTo(42, 29); x.stroke();
      });
    });
    /* pombo cinza voando de lado (asa em cima e embaixo) */
    SP.pombo = [0, 1].map(function (passo) {
      return sprite(56, 40, function (x) {
        x.fillStyle = '#8C939E'; x.beginPath(); x.moveTo(6, 22); x.lineTo(0, 16); x.lineTo(0, 28); x.closePath(); x.fill();
        x.fillStyle = '#A9B0BA'; oval(x, 24, 24, 17, 9); x.fill();
        x.fillStyle = '#6FA88A'; oval(x, 38, 20, 6, 6); x.fill();
        x.fillStyle = '#8E7CC3'; oval(x, 37, 24, 5, 3); x.fill();
        x.fillStyle = '#A9B0BA'; bola(x, 43, 15, 6.5); x.fill();
        x.fillStyle = '#F5A623'; x.beginPath(); x.moveTo(49, 14); x.lineTo(55, 16); x.lineTo(49, 18); x.closePath(); x.fill();
        x.fillStyle = '#E8541E'; bola(x, 45, 13.5, 1.8); x.fill(); x.fillStyle = '#1D1F22'; bola(x, 45.3, 13.5, 0.8); x.fill();
        x.fillStyle = '#7F8792';
        x.beginPath();
        if (passo) { x.moveTo(14, 22); x.quadraticCurveTo(18, 0, 34, 4); x.quadraticCurveTo(30, 16, 30, 22); }
        else { x.moveTo(14, 25); x.quadraticCurveTo(18, 40, 34, 38); x.quadraticCurveTo(30, 30, 30, 25); }
        x.closePath(); x.fill();
        x.fillStyle = '#5E6570'; x.fillRect(16, 30, 2, 5); x.fillRect(22, 31, 2, 5);
      });
    });
    SP.nuvem = sprite(160, 64, function (x) {
      x.fillStyle = '#FFFFFF';
      bola(x, 42, 40, 22); x.fill(); bola(x, 76, 30, 28); x.fill(); bola(x, 112, 38, 22); x.fill();
      retangulo(x, 20, 38, 120, 24, 12); x.fill();
      x.fillStyle = 'rgba(160,190,210,0.25)'; retangulo(x, 22, 50, 116, 12, 6); x.fill();
    });
    /* a largada: casinhas, bananeira e a placa da cidade (como na Corrida) */
    SP.casas = ['#F6C9A8', '#BFE3F2', '#F7E1A1'].map(function (cor) {
      return sprite(240, 200, function (x) {
        x.fillStyle = cor; x.fillRect(20, 72, 200, 128);
        x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(20, 72, 200, 12);
        x.beginPath(); x.moveTo(4, 76); x.lineTo(120, 12); x.lineTo(236, 76); x.closePath(); x.fillStyle = '#C8553D'; x.fill();
        x.fillStyle = '#7A4A2A'; retangulo(x, 100, 128, 40, 72, 4); x.fill();
        x.fillStyle = '#F2D06B'; bola(x, 132, 166, 3); x.fill();
        [[38, 104], [162, 104]].forEach(function (j) {
          x.fillStyle = '#FFFFFF'; x.fillRect(j[0] - 3, j[1] - 3, 46, 40);
          x.fillStyle = '#9FD3F0'; x.fillRect(j[0], j[1], 40, 34);
          x.fillStyle = '#FFFFFF'; x.fillRect(j[0] + 19, j[1], 2, 34); x.fillRect(j[0], j[1] + 16, 40, 2);
        });
      });
    });
    SP.bananeira = sprite(170, 230, function (x) {
      x.fillStyle = '#8A7B3A';
      x.beginPath(); x.moveTo(76, 230); x.lineTo(80, 96); x.lineTo(90, 96); x.lineTo(96, 230); x.closePath(); x.fill();
      var folhas = [[-2.5, 70, '#2E8B3E'], [-1.9, 78, '#3FA34D'], [-1.1, 70, '#349848'], [-0.3, 64, '#3FA34D'], [0.4, 72, '#2E8B3E'], [1.1, 76, '#3FA34D']];
      folhas.forEach(function (f) {
        x.save(); x.translate(85, 96); x.rotate(f[0]);
        x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(f[1] * 0.5, -24, f[1], -6); x.quadraticCurveTo(f[1] * 0.55, 14, 0, 0); x.closePath();
        x.fillStyle = f[2]; x.fill();
        x.restore();
      });
      for (var i = 0; i < 4; i++) { x.beginPath(); x.ellipse(98 + (i % 2) * 8, 112 + i * 9, 5, 9, 0.5, 0, Math.PI * 2); x.fillStyle = '#E9C23B'; x.fill(); }
    });
    var nome = String(cidade || 'Juquiá').toUpperCase();
    var banana = /^juqui/i.test(String(cidade || 'Juquiá'));
    SP.placa = sprite(240, 170, function (x) {
      x.fillStyle = '#8E9A9E'; x.fillRect(40, 90, 8, 80); x.fillRect(192, 90, 8, 80);
      x.fillStyle = '#1E7B4A'; retangulo(x, 6, 6, 228, 104, 10); x.fill();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 4; retangulo(x, 14, 14, 212, 88, 6); x.stroke();
      x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '900 ' + (nome.length > 12 ? 24 : 32) + 'px system-ui, sans-serif';
      x.fillText(nome, 120, banana ? 50 : 58, 196);
      if (banana) { x.font = '700 16px system-ui, sans-serif'; x.fillText('Capital da Banana', 120, 82); }
    });
  }

  /* ================================================================ o jogo ================================ */

  var J = null;   /* o jogo aberto (so um por vez) */
  var audio = null;

  function som(tipo) {
    if (!J || !J.som) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var t = audio.currentTime;
      /* [onda, freq inicial, freq final, duracao, volume]; as notas tocam uma depois da outra */
      var notas = {
        pulo: [['triangle', 300, 620, 0.12, 0.05]],
        mola: [['sine', 180, 1100, 0.32, 0.07]],
        moeda: [['square', 988, 1319, 0.1, 0.035]],
        quebra: [['square', 180, 60, 0.16, 0.05]],
        pisou: [['square', 520, 260, 0.08, 0.05], ['square', 780, 780, 0.1, 0.04]],
        bateu: [['sawtooth', 220, 55, 0.4, 0.07]],
        miau: [['sine', 700, 1000, 0.12, 0.05], ['sine', 1000, 520, 0.22, 0.05]],
        cai: [['sine', 900, 180, 0.9, 0.05]],
        ima: [['sine', 660, 660, 0.08, 0.06], ['sine', 880, 880, 0.08, 0.06], ['sine', 1175, 1175, 0.12, 0.06]],
        turbo: [['sawtooth', 180, 900, 0.45, 0.05]],
        escudo: [['triangle', 523, 523, 0.09, 0.07], ['triangle', 659, 659, 0.09, 0.07], ['triangle', 784, 784, 0.16, 0.07]],
        marco: [['square', 659, 659, 0.08, 0.04], ['square', 784, 784, 0.08, 0.04], ['square', 988, 988, 0.08, 0.04], ['square', 1319, 1319, 0.2, 0.04]],
        conta: [['sine', 660, 660, 0.14, 0.07]],
        vai: [['square', 988, 1319, 0.28, 0.06]],
        recorde: [['square', 784, 784, 0.1, 0.04], ['square', 988, 988, 0.1, 0.04], ['square', 1319, 1319, 0.2, 0.04]],
        aviso: [['sine', 880, 880, 0.12, 0.07], ['sine', 1320, 1320, 0.18, 0.07]],
      }[tipo] || [];
      var inicio = t;
      notas.forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = n[0]; o.frequency.setValueAtTime(n[1], inicio); o.frequency.exponentialRampToValueAtTime(Math.max(20, n[2]), inicio + n[3]);
        g.gain.setValueAtTime(n[4], inicio); g.gain.exponentialRampToValueAtTime(0.0001, inicio + n[3]);
        o.connect(g); g.connect(audio.destination); o.start(inicio); o.stop(inicio + n[3] + 0.02);
        inicio += n[3] * 0.85;
      });
    } catch (_) { /* sem som neste aparelho: o jogo segue */ }
  }

  /* ---- musiquinha saltitante (do maior), feita na hora pelo celular (nenhum arquivo baixado) ---- */
  var MELODIA = [
    72, 0, 76, 79, 84, 0, 79, 76, 74, 0, 77, 81, 86, 0, 81, 77,
    72, 0, 76, 79, 84, 0, 88, 86, 84, 81, 79, 76, 74, 0, 72, 0,
  ];
  var BAIXO = [48, 50, 48, 43];
  function freq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function notaMusica(tipo, n, quando, dur, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = tipo; o.frequency.setValueAtTime(freq(n), quando);
    g.gain.setValueAtTime(vol, quando); g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
    o.connect(g); g.connect(J.musica.saida); o.start(quando); o.stop(quando + dur + 0.02);
  }
  function agendarMusica() {
    if (!J || !J.musica || !audio) return;
    var m = J.musica;
    var passo = 60 / 140 / 2; /* colcheia a 140 */
    while (m.proximo < audio.currentTime + 0.25) {
      var i = m.passo % 32;
      if (MELODIA[i]) notaMusica('square', MELODIA[i], m.proximo, passo * 0.8, 0.02);
      var raiz = BAIXO[Math.floor(i / 8)];
      var b = [raiz, 0, raiz + 12, 0][i % 4];
      if (b) notaMusica('triangle', b, m.proximo, passo * 1.4, 0.05);
      m.proximo += passo;
      m.passo += 1;
    }
  }
  function musicaLigar() {
    if (!J || !J.som || !J.comMusica || J.musica) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var saida = audio.createGain();
      saida.gain.setValueAtTime(0.0001, audio.currentTime); saida.gain.exponentialRampToValueAtTime(1, audio.currentTime + 0.4);
      saida.connect(audio.destination);
      J.musica = { saida: saida, passo: 0, proximo: audio.currentTime + 0.1, relogio: setInterval(agendarMusica, 60) };
      agendarMusica();
    } catch (_) { J.musica = null; }
  }
  function musicaParar() {
    if (!J || !J.musica) return;
    var m = J.musica;
    J.musica = null;
    clearInterval(m.relogio);
    try { m.saida.gain.setValueAtTime(m.saida.gain.value, audio.currentTime); m.saida.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25); setTimeout(function () { try { m.saida.disconnect(); } catch (_) { /* ja foi */ } }, 400); } catch (_) { /* segue */ }
  }
  /* interruptor de "Musica" (na tela de inicio e na pausa) */
  function chaveMusica() {
    var chave = el('button', { class: 'chave' + (J.comMusica ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': J.comMusica ? 'true' : 'false', 'aria-label': 'Música' });
    chave.onclick = function () {
      J.comMusica = !J.comMusica; guardar(CHAVE_MUSICA, J.comMusica ? '1' : '0');
      chave.classList.toggle('on', J.comMusica); chave.setAttribute('aria-checked', J.comMusica ? 'true' : 'false');
    };
    return el('div', { class: 'pulo-opcao' }, [el('span', { text: 'Música' }), chave]);
  }

  /* ---- uma subida nova: o ratinho no chao da cidade e as primeiras plataformas ---- */
  function novaSubida() {
    J.x = LARG / 2; J.y = 0; J.vx = 0; J.vy = PULO; J.dir = 0; J.olha = 1; J.amassa = 0;
    J.tonto = false; J.imune = 0; J.turbo = 0; J.ima = 0; J.escudo = false;
    J.cam = -70; J.topo = 0; J.bonus = 0; J.moedas = 0; J.pulos = 0; J.bichos = 0; J.pegos = {};
    J.tempo = 0; J.tremor = 0; J.conta = 0; J.caiuEm = 0; J.motivo = '';
    J.plats = []; J.moe = []; J.pod = []; J.bic = []; J.ped = []; J.part = []; J.textos = [];
    J.ultimaY = 0; J.evitar = null; J.proxPoder = 1400; J.proxBicho = 3200; J.proxMarco = MARCO;
    J.novoRecorde = false;
    gerarAte(J.cam + (J.visH || 900) + 300);
  }

  /* ---- o que aparece na subida ---- */
  function dificuldade(y) { return Math.min(1, Math.max(0, y) / DIF_TOPO); }
  function sorteioX(longeDe) {
    var m = PLAT_L / 2 + 4;
    for (var i = 0; i < 10; i++) {
      var x = m + Math.random() * (LARG - 2 * m);
      if (longeDe == null || Math.abs(distX(x, longeDe)) >= 110) return x;
    }
    return Math.min(LARG - m, Math.max(m, embrulhar(longeDe + LARG / 2)));
  }
  function plataforma(tipo, x, y) { var p = { tipo: tipo, x: x, y: y, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false }; J.plats.push(p); return p; }
  function poeMoeda(x, y) { J.moe.push({ x: embrulhar(x), y: y, pego: false }); }

  /* o proximo degrau: uma plataforma firme (verde, azul ou com mola) a um vao que da para pular, e em volta dela as
     caixas que rasgam, as moedas, os poderes e os bichos */
  function gerar() {
    var y0 = J.ultimaY, d = dificuldade(y0);
    var vaoMin = 30 + 56 * d, vaoMax = Math.min(VAO_TETO, 70 + 94 * d);
    if (y0 < 500) { vaoMin = 40; vaoMax = 72; } /* a largada e facil */
    var y = y0 + vaoMin + Math.random() * (vaoMax - vaoMin);
    /* perto do gato, as tabuas do caminho ficam longe da coluna dele ate passar da altura dele */
    var p = plataforma(y > 1800 && Math.random() < 0.06 + 0.3 * d ? 'movel' : 'normal', sorteioX(J.evitar ? J.evitar.x : null), y);
    if (J.evitar && y >= J.evitar.ate) J.evitar = null;
    if (p.tipo === 'movel') p.vx = (Math.random() < 0.5 ? -1 : 1) * (50 + 70 * d);
    else if (y > 500 && Math.random() < 0.055) { p.mola = true; p.molaX = (Math.random() - 0.5) * 30; }
    var vao = y - y0;
    /* caixa de papelao no meio do vao: parece o caminho, mas nao segura */
    if (y > 900 && vao > 60 && Math.random() < 0.18 + 0.3 * d) plataforma('quebra', sorteioX(null), y0 + vao * (0.35 + Math.random() * 0.3));
    /* no comeco, mais tabuas (quem ainda esta aprendendo nao cai logo) */
    if (y < 3000 && vao > 60 && Math.random() < 0.35) plataforma('normal', sorteioX(p.x), y0 + vao * 0.5);
    /* moedas em arco em cima da tabua */
    if (Math.random() < 0.3) { poeMoeda(p.x - 24, y + 34); poeMoeda(p.x, y + 50); poeMoeda(p.x + 24, y + 34); }
    else if (Math.random() < 0.15) poeMoeda(sorteioX(null), y0 + vao * 0.5);
    /* poder: a cada 1,5 a 2,8 mil de altura, em cima de uma tabua firme */
    if (y >= J.proxPoder) {
      J.pod.push({ tipo: TIPOS_PODER[Math.floor(Math.random() * 3)], x: p.x, y: y + 46 });
      J.proxPoder = y + 1500 + Math.random() * 1300;
    }
    /* bichos: o gato numa tabua so dele, longe do caminho; mais alto, o pombo voando de lado */
    if (y >= J.proxBicho) {
      J.proxBicho = y + 1300 - 500 * d + Math.random() * 900;
      if (y > 7000 && Math.random() < 0.45) {
        J.bic.push({ tipo: 'pombo', x: Math.random() * LARG, y: y + 70, vx: (Math.random() < 0.5 ? -1 : 1) * (60 + 70 * d), caindo: false, rot: 0 });
      } else {
        var gx = sorteioX(p.x), gy = y + 70 + Math.random() * 30;
        var casa = plataforma('normal', gx, gy);
        J.bic.push({ tipo: 'gato', x: gx, y: gy, plat: casa, caindo: false, rot: 0 });
        J.evitar = { x: gx, ate: gy + 30 }; /* as proximas tabuas do caminho tambem ficam longe do gato */
      }
    }
    J.ultimaY = y;
  }
  function gerarAte(limite) { var seguro = 0; while (J.ultimaY < limite && seguro++ < 400) gerar(); }

  /* o que ficou la embaixo sai da memoria */
  function limpar() {
    var corte = J.cam - 160;
    J.plats = J.plats.filter(function (p) { return p.y > corte; });
    J.moe = J.moe.filter(function (c) { return !c.pego && c.y > corte; });
    J.pod = J.pod.filter(function (o) { return o.y > corte; });
    J.bic = J.bic.filter(function (e) { return e.y > corte - (e.caindo ? 400 : 0); });
    J.ped = J.ped.filter(function (q) { return q.y > corte - 300; });
  }

  /* ---- a fisica: um passo pequeno (varios por quadro, para nada atravessar a tabua) ---- */
  function passoFisica(h) {
    var jogando = J.fase === 'jogando', caindo = J.fase === 'caindo';
    /* para o lado: acelera ate a velocidade maxima e freia quando solta */
    var alvo = (jogando && !J.tonto ? J.dir : 0) * VEL_LADO;
    var a = ACEL_LADO * h;
    if (J.vx < alvo) J.vx = Math.min(alvo, J.vx + a); else J.vx = Math.max(alvo, J.vx - a);
    if (J.vx > 20) J.olha = 1; else if (J.vx < -20) J.olha = -1;
    J.x = embrulhar(J.x + J.vx * h);
    if (J.turbo > 0 && jogando) {
      J.vy = TURBO_VEL;
      J.turbo -= h;
      if (J.turbo <= 0) { J.turbo = 0; J.vy = PULO; J.imune = 0.8; }
    } else J.vy -= G * h;
    var antes = J.y;
    J.y += J.vy * h;
    if (J.vy < 0 && !J.tonto && !caindo && J.turbo <= 0) pousar(antes);
    /* caiu perto da largada: fica no chao da cidade (e nao atravessa a grama) */
    if (caindo && J.y < 0) { J.y = 0; J.vy = 0; J.vx = 0; }
    if (!jogando) return;
    for (var i = 0; i < J.plats.length; i++) {
      var p = J.plats[i];
      if (p.tipo !== 'movel' || p.quebrou) continue;
      p.x += p.vx * h;
      var m = PLAT_L / 2;
      if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx); } else if (p.x > LARG - m) { p.x = LARG - m; p.vx = -Math.abs(p.vx); }
    }
    for (var k = 0; k < J.bic.length; k++) {
      var e = J.bic[k];
      if (e.caindo) continue;
      if (e.tipo === 'pombo') e.x = embrulhar(e.x + e.vx * h);
      else if (e.plat) e.x = e.plat.x;
    }
    /* a camera so sobe: quem ficou para baixo, ficou */
    var cam = J.y - J.visH * CAMERA;
    if (cam > J.cam) J.cam = cam;
    if (J.y > J.topo) J.topo = J.y;
    if (!J.tonto) { pegar(h); encostarNosBichos(); }
    if (J.fase === 'jogando' && J.y < J.cam - 30) cair();
  }

  /* caiu em cima de uma tabua: pula de novo (na caixa de papelao, rasga e continua caindo) */
  function pousar(antes) {
    var melhor = null;
    for (var i = 0; i < J.plats.length; i++) {
      var p = J.plats[i];
      if (p.quebrou || antes < p.y || J.y > p.y) continue;
      if (Math.abs(distX(J.x, p.x)) > PLAT_L / 2 + PE) continue;
      if (!melhor || p.y > melhor.y) melhor = p;
    }
    /* o chao da cidade, na largada */
    if (!melhor && antes >= 0 && J.y <= 0) melhor = { tipo: 'chao', y: 0 };
    if (!melhor) return;
    if (melhor.tipo === 'quebra') { quebrar(melhor); return; }
    J.y = melhor.y;
    var naMola = melhor.mola && Math.abs(distX(J.x, melhor.x + melhor.molaX)) <= 16;
    J.vy = naMola ? MOLA : PULO;
    J.amassa = 0.14;
    if (J.fase === 'jogando') J.pulos += 1;
    if (naMola) { melhor.molaT = 0.3; som('mola'); } else if (J.fase === 'jogando') som('pulo');
  }
  function quebrar(p) {
    p.quebrou = true;
    J.ped.push({ x: p.x - 16, y: p.y, vx: -50, vy: 40, rot: 0, vr: -2.4, lado: 0 }, { x: p.x + 16, y: p.y, vx: 50, vy: 40, rot: 0, vr: 2.4, lado: 1 });
    for (var i = 0; i < 6; i++) J.part.push({ x: p.x + (Math.random() - 0.5) * 50, y: p.y, vx: (Math.random() - 0.5) * 220, vy: 60 + Math.random() * 160, vida: 0.5, cor: i % 2 ? '#C8955A' : '#E8D3A8' });
    som('quebra');
  }

  /* moedas e poderes: pega o que encosta; com o ima, as moedas perto vem sozinhas */
  function pegar(h) {
    var cx = J.x, cy = J.y + 30;
    for (var i = 0; i < J.moe.length; i++) {
      var c = J.moe[i];
      if (c.pego) continue;
      var dx = distX(cx, c.x), dy = cy - c.y, d2 = dx * dx + dy * dy;
      if (J.ima > 0 && d2 < 200 * 200) {
        var dist = Math.sqrt(d2) || 1, v = Math.min(dist, 620 * h);
        c.x = embrulhar(c.x + dx / dist * v); c.y += dy / dist * v;
        dx = distX(cx, c.x); dy = cy - c.y; d2 = dx * dx + dy * dy;
      }
      if (d2 < 30 * 30) pegarMoeda(c);
    }
    for (var k = J.pod.length - 1; k >= 0; k--) {
      var o = J.pod[k];
      var ox = distX(cx, o.x), oy = cy - o.y;
      if (ox * ox + oy * oy < 36 * 36) { J.pod.splice(k, 1); pegarPoder(o.tipo); }
    }
  }
  function pegarMoeda(c) {
    c.pego = true;
    J.moedas += 1;
    J.bonus += 5;
    som('moeda');
    brilho(c.x, c.y, '#FFD84A', 5);
  }
  function pegarPoder(tipo) {
    /* o lanche da loja que deu o poder aparece no recado ("X-Bacon: turbo!") e entra na conta do "Bateu fome?" */
    var p = PODER_DE[tipo], nome = p ? nomeCurto(p.nome) + ': ' : '';
    if (p) J.pegos[p.id] = (J.pegos[p.id] || 0) + 1;
    if (tipo === 'ima') { J.ima = PODERES.ima; som('ima'); texto(nome ? nome + 'ímã!' : 'Ímã!', '#FF8A80'); brilho(J.x, J.y + 30, '#FF8A80', 8); }
    else if (tipo === 'turbo') { J.turbo = PODERES.turbo; J.vy = TURBO_VEL; som('turbo'); texto(nome ? nome + 'turbo!' : 'Turbo!', '#FFD54F'); brilho(J.x, J.y + 30, '#FFD54F', 8); }
    else { J.escudo = true; som('escudo'); texto(nome ? nome + 'capacete!' : 'Capacete!', '#90CAF9'); brilho(J.x, J.y + 30, '#90CAF9', 8); }
  }

  /* gato e pombo: caindo por cima, o ratinho pisa e pula de novo; de lado ou por baixo, eles derrubam */
  function encostarNosBichos() {
    for (var i = 0; i < J.bic.length; i++) {
      var e = J.bic[i];
      if (e.caindo) continue;
      var ey = e.y + (e.tipo === 'gato' ? 22 : 14);
      var dx = distX(J.x, e.x), dy = (J.y + 30) - ey;
      var r = e.tipo === 'gato' ? 36 : 32;
      if (dx * dx + dy * dy > r * r) continue;
      if (J.turbo > 0) { derrubar(e); J.bonus += 15; texto('+15', '#FFD54F'); continue; }
      if (J.vy < 0 && J.y > ey - 4) {
        derrubar(e);
        J.vy = PULO; J.amassa = 0.14; J.bonus += 25; J.bichos += 1;
        som('pisou'); texto('+25', '#C6FF7A');
        continue;
      }
      if (J.imune > 0) continue;
      if (J.escudo) { J.escudo = false; J.imune = 1.2; derrubar(e); som('escudo'); texto('Capacete!', '#90CAF9'); continue; }
      J.tonto = true; J.motivo = e.tipo; J.vy = Math.min(J.vy, 150);
      som(e.tipo === 'gato' ? 'miau' : 'bateu');
      J.tremor = menosMovimento ? 0 : 0.3;
      vibrar(60);
      return;
    }
  }
  function derrubar(e) {
    e.caindo = true; e.vy = 260; e.vx = (distX(e.x, J.x) >= 0 ? 1 : -1) * 90; e.vr = (e.vx > 0 ? 1 : -1) * 5;
    brilho(e.x, e.y + 20, e.tipo === 'gato' ? '#F29D38' : '#A9B0BA', 8);
    if (e.tipo === 'gato') som('miau');
  }

  /* caiu la embaixo: o capacete salva uma vez; sem ele, acabou */
  function cair() {
    if (J.escudo && !J.tonto) {
      J.escudo = false; J.vy = MOLA; J.y = Math.max(J.y, J.cam - 20); J.imune = 1.2;
      som('escudo'); texto('O capacete salvou!', '#90CAF9');
      return;
    }
    J.fase = 'caindo'; J.caiuEm = J.tempo;
    if (!J.motivo) J.motivo = 'queda';
    musicaParar();
    som('cai');
    vibrar(40);
  }
  function vibrar(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) { /* sem vibrar */ } } }

  function brilho(x, y, cor, n) {
    for (var i = 0; i < n; i++) J.part.push({ x: x, y: y, vx: (Math.random() - 0.5) * 320, vy: 120 + Math.random() * 240, vida: 0.45, cor: cor });
  }
  function texto(t, cor) {
    var y = J.y + 90;
    for (var i = 0; i < J.textos.length; i++) if (J.textos[i].vida > 0.55) y = Math.max(y, J.textos[i].y + 28);
    J.textos.push({ t: t, x: J.x, y: y, vida: 1, cor: cor || '#FFFFFF' });
  }

  function pontos() { return Math.floor(J.topo / 10) + J.bonus; }

  /* tudo o que anda sem precisar de passo fino: pedacos, bichos caindo, recados, relogios dos poderes */
  function animar(dt) {
    J.tempo += dt;
    if (J.amassa > 0) J.amassa = Math.max(0, J.amassa - dt);
    if (J.imune > 0) J.imune = Math.max(0, J.imune - dt);
    if (J.ima > 0) J.ima = Math.max(0, J.ima - dt);
    if (J.tremor > 0) J.tremor = Math.max(0, J.tremor - dt);
    var i;
    for (i = 0; i < J.plats.length; i++) if (J.plats[i].molaT > 0) J.plats[i].molaT -= dt;
    for (i = J.part.length - 1; i >= 0; i--) {
      var q = J.part[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy -= 900 * dt; q.vida -= dt;
      if (q.vida <= 0) J.part.splice(i, 1);
    }
    for (i = 0; i < J.ped.length; i++) { var d = J.ped[i]; d.x += d.vx * dt; d.vy -= G * 0.6 * dt; d.y += d.vy * dt; d.rot += d.vr * dt; }
    for (i = 0; i < J.bic.length; i++) { var e = J.bic[i]; if (!e.caindo) continue; e.x += e.vx * dt; e.vy -= G * dt; e.y += e.vy * dt; e.rot += e.vr * dt; }
    for (i = J.textos.length - 1; i >= 0; i--) {
      var tx = J.textos[i];
      tx.y += 40 * dt; tx.vida -= dt * 0.9;
      if (tx.vida <= 0) J.textos.splice(i, 1);
    }
    /* rastro do turbo */
    if (J.turbo > 0 && !menosMovimento && J.part.length < 60) J.part.push({ x: J.x + (Math.random() - 0.5) * 14, y: J.y - 4, vx: (Math.random() - 0.5) * 60, vy: -120, vida: 0.35, cor: Math.random() < 0.5 ? '#FFB300' : '#FF7043' });
    if (J.fase === 'jogando' && J.topo >= J.proxMarco) {
      var m = Math.round(J.proxMarco / 10);
      aviso(m % 1000 === 0 ? (m / 1000) + ' km de altura!' : m + ' m de altura!');
      som('marco');
      J.proxMarco += MARCO;
    }
  }

  function atualizar(dt) {
    var passos = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / passos;
    for (var i = 0; i < passos && J && (J.fase === 'jogando' || J.fase === 'caindo' || J.fase === 'inicio'); i++) passoFisica(h);
    if (!J) return;
    animar(dt);
    if (J.fase === 'jogando') {
      gerarAte(J.cam + J.visH + 260);
      J.quadros = (J.quadros || 0) + 1;
      if (J.quadros % 15 === 0) limpar();
      atualizarPlacar();
    } else if (J.fase === 'caindo') {
      /* a tela desce atras do ratinho e, um instante depois, o fim */
      var alvo = Math.max(-70, J.y - J.visH * 0.35); /* a tela desce ate o chao, nunca abaixo dele */
      if (alvo < J.cam) J.cam += (alvo - J.cam) * Math.min(1, dt * 5);
      if (J.tempo - J.caiuEm > 1.1) fimDeJogo();
    }
  }

  /* ================================================================ desenho de cada quadro ================ */

  function sx(x) { return J.ox + x * J.s; }
  function sy(y) { return J.h - (y - J.cam) * J.s; }

  /* desenha pela base (os pes, a tabua): x e y no mundo, w e h em unidades. Perto da beirada, desenha tambem do outro
     lado (o ratinho saindo por um lado ja aparece no outro) */
  function porBase(ctx, spr, x, y, w, h, espelha, giro) {
    var base = sy(y);
    if (base - h * J.s > J.h + 20 || base < -20 - h * J.s * 0.2) return;
    var xs = [x];
    if (x - w / 2 < 0) xs.push(x + LARG); else if (x + w / 2 > LARG) xs.push(x - LARG);
    for (var i = 0; i < xs.length; i++) {
      var px = sx(xs[i]), pw = w * J.s, ph = h * J.s;
      if (!espelha && !giro) { ctx.drawImage(spr, px - pw / 2, base - ph, pw, ph); continue; }
      ctx.save();
      ctx.translate(px, base - ph / 2);
      if (giro) ctx.rotate(giro);
      if (espelha) ctx.scale(-1, 1);
      ctx.drawImage(spr, -pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    }
  }

  function misturar(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
    var g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
    var bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function corDoCeu(alt) {
    for (var i = CEU.length - 1; i >= 0; i--) {
      if (alt >= CEU[i][0]) {
        var a = CEU[i], b = CEU[i + 1];
        if (!b) return [a[1], a[2]];
        var t = (alt - a[0]) / (b[0] - a[0]);
        return [misturar(a[1], b[1], t), misturar(a[2], b[2], t)];
      }
    }
    return [CEU[0][1], CEU[0][2]];
  }

  function ceu(ctx) {
    var alt = Math.max(0, J.cam);
    var cores = corDoCeu(alt);
    var g = ctx.createLinearGradient(0, 0, 0, J.h);
    g.addColorStop(0, cores[0]); g.addColorStop(1, cores[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, J.w, J.h);
    var noite = Math.min(1, Math.max(0, (alt - 13000) / 4000));
    var espaco = Math.min(1, Math.max(0, (alt - 28000) / 5000));
    /* estrelas: uma tela so, repetida, andando devagar */
    if (noite > 0 && J.estrelas) {
      var oy = (alt * J.s * 0.1) % J.h;
      ctx.globalAlpha = noite;
      ctx.drawImage(J.estrelas, 0, oy - J.h, J.w, J.h); ctx.drawImage(J.estrelas, 0, oy, J.w, J.h);
      /* a lua, e no espaco um planeta com anel */
      var ly = J.h * 0.18 + (alt - 15000) * J.s * 0.02;
      if (ly < J.h + 60) {
        ctx.fillStyle = '#FFF6D8'; ctx.beginPath(); ctx.arc(J.w * 0.78, ly, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,190,160,0.5)'; ctx.beginPath(); ctx.arc(J.w * 0.78 - 8, ly - 5, 5, 0, Math.PI * 2); ctx.arc(J.w * 0.78 + 9, ly + 7, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (espaco > 0) {
      var py = J.h * 0.3 + (alt - 30000) * J.s * 0.02;
      if (py < J.h + 80) {
        ctx.globalAlpha = espaco;
        ctx.fillStyle = '#C77DFF'; ctx.beginPath(); ctx.arc(J.w * 0.22, py, 34, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(J.w * 0.22 - 10, py - 10, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#FFD166'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(J.w * 0.22, py, 58, 13, -0.3, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    /* nuvens: andam mais devagar que as tabuas (parecem longe); somem no espaco */
    if (espaco < 1) {
      var fator = 0.55, faixa = 230;
      var base = J.cam * fator;
      var de = Math.floor((base - 80) / faixa), ate = Math.ceil((base + J.visH + 80) / faixa);
      ctx.globalAlpha = (1 - espaco) * (1 - noite * 0.55);
      for (var k = de; k <= ate; k++) {
        if (fixo(k + 3) < 0.3) continue;
        var w = (90 + fixo(k + 7) * 70) * J.s, h = w * 0.4;
        var x = fixo(k) * (J.w + w) - w;
        var y = J.h - (k * faixa - base) * J.s;
        ctx.drawImage(SP.nuvem, x, y - h, w, h);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* a largada: o chao da cidade com as casinhas, a bananeira e a placa */
  function chao(ctx) {
    var topo = sy(0);
    if (topo > J.h + 260 * J.s) return;
    porBase(ctx, SP.casas[0], 58, 0, 118, 98, false);
    porBase(ctx, SP.bananeira, 150, 0, 74, 100, false);
    porBase(ctx, SP.placa, 244, 0, 104, 74, false);
    porBase(ctx, SP.casas[1], 328, 0, 112, 94, false);
    ctx.fillStyle = '#7CC35A'; ctx.fillRect(0, topo, J.w, J.h - topo + 20);
    ctx.fillStyle = '#5FA83F'; ctx.fillRect(0, topo, J.w, 4);
  }

  function desenharJogador(ctx) {
    var tonto = J.tonto || J.motivo === 'gato' || J.motivo === 'pombo';
    var spr = tonto ? SP.ratoTonto : SP.rato;
    var k = J.amassa > 0 ? J.amassa / 0.14 : 0;
    var larg = 48 * (1 + 0.14 * k), alt = 63 * (1 - 0.16 * k) * (J.vy > 500 && J.turbo <= 0 ? 1.04 : 1);
    var pisca = J.imune > 0 && J.turbo <= 0 && Math.floor(J.tempo * 12) % 2 === 0;
    if (pisca) ctx.globalAlpha = 0.45;
    /* turbo: o foguinho embaixo dos pes */
    if (J.turbo > 0) {
      var fy = sy(J.y), fx = sx(J.x);
      var tam = (14 + Math.sin(J.tempo * 40) * 3) * J.s;
      ctx.fillStyle = '#FF7043'; ctx.beginPath(); ctx.ellipse(fx, fy + tam * 0.6, tam * 0.45, tam, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFD54F'; ctx.beginPath(); ctx.ellipse(fx, fy + tam * 0.4, tam * 0.25, tam * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    porBase(ctx, spr, J.x, J.y, larg, alt, J.olha < 0, J.fase === 'caindo' && tonto && !menosMovimento ? (J.tempo - J.caiuEm) * 6 : 0);
    ctx.globalAlpha = 1;
    var cx = sx(J.x), cy = sy(J.y + 32);
    if (J.escudo) {
      ctx.beginPath(); ctx.ellipse(cx, cy, 34 * J.s, 42 * J.s, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100,181,246,0.14)'; ctx.fill();
      ctx.strokeStyle = 'rgba(100,181,246,0.75)'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (J.ima > 0 && (J.ima > 2 || Math.floor(J.ima * 8) % 2 === 0)) {
      ctx.beginPath(); ctx.ellipse(cx, cy, 38 * J.s, 46 * J.s, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(229,57,53,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([8, 7]); ctx.lineDashOffset = -J.tempo * 30; ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* indicadores dos poderes ligados: bolinha com o desenho e um arco do tempo que falta (canto de baixo) */
  function poderesNaTela(ctx) {
    var lista = [];
    if (J.turbo > 0) lista.push([SP.turbo, J.turbo / PODERES.turbo]);
    if (J.ima > 0) lista.push([SP.ima, J.ima / PODERES.ima]);
    if (J.escudo) lista.push([SP.escudo, 1]);
    var y = J.h - 36 - J.baixoSeguro;
    for (var i = 0; i < lista.length; i++) {
      var x = 16 + 24 + i * 56;
      bola(ctx, x, y, 24); ctx.fillStyle = 'rgba(15,61,46,0.72)'; ctx.fill();
      ctx.drawImage(lista[i][0], x - 17, y - 17, 34, 34);
      ctx.beginPath(); ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, lista[i][1])); ctx.strokeStyle = '#C6FF7A'; ctx.lineWidth = 4; ctx.stroke();
    }
  }

  function textoGrande(ctx, t, x, y, tam, cor, limite) {
    ctx.font = '900 ' + tam + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    /* limite: [esquerda, direita] da coluna do jogo. Texto maior que ela encolhe; o resto e empurrado para dentro */
    if (limite) {
      var larg = ctx.measureText(t).width || 0, cabe = limite[1] - limite[0] - 16;
      if (larg > cabe && larg > 0) { tam = Math.floor(tam * cabe / larg); ctx.font = '900 ' + tam + 'px system-ui, -apple-system, "Segoe UI", sans-serif'; larg = cabe; }
      x = Math.min(limite[1] - 8 - larg / 2, Math.max(limite[0] + 8 + larg / 2, x));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(4, tam * 0.12); ctx.strokeStyle = 'rgba(15,61,46,0.85)'; ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y); ctx.fillStyle = cor; ctx.fillText(t, x, y);
  }

  function desenhar() {
    var ctx = J.ctx;
    ctx.setTransform(J.dpr, 0, 0, J.dpr, 0, 0);
    ceu(ctx);
    ctx.save();
    if (J.tremor > 0) ctx.translate((Math.random() - 0.5) * 10 * J.tremor, (Math.random() - 0.5) * 10 * J.tremor);
    chao(ctx);
    /* tela larga (computador): o jogo fica numa coluna no meio; o ceu vai de ponta a ponta */
    var largo = J.campo < J.w - 1;
    if (largo) { ctx.save(); ctx.beginPath(); ctx.rect(J.ox, 0, J.campo, J.h); ctx.clip(); }
    var i;
    for (i = 0; i < J.plats.length; i++) {
      var p = J.plats[i];
      if (p.quebrou) continue;
      porBase(ctx, SP[p.tipo] || SP.normal, p.x, p.y - 18, 68, 20, false); /* o topo da tabua fica no y dela, onde os pes pousam */
      if (p.mola) porBase(ctx, p.molaT > 0 ? SP.molaSolta : SP.mola, embrulhar(p.x + p.molaX), p.y, 24, p.molaT > 0 ? 26 : 14, false);
    }
    /* caixa rasgada: as duas metades caindo */
    for (i = 0; i < J.ped.length; i++) {
      var q = J.ped[i], my = sy(q.y - 8);
      if (my > J.h + 40) continue;
      ctx.save(); ctx.translate(sx(q.x), my); ctx.rotate(q.rot);
      ctx.drawImage(SP.quebra, q.lado * 68, 0, 68, 40, -17 * J.s, -10 * J.s, 34 * J.s, 20 * J.s);
      ctx.restore();
    }
    /* moedas girando (a largura vai e volta) */
    var gira = Math.abs(Math.cos(J.tempo * 4));
    for (i = 0; i < J.moe.length; i++) {
      var c = J.moe[i];
      if (c.pego) continue;
      var cy = sy(c.y);
      if (cy < -30 || cy > J.h + 30) continue;
      var tam = 22 * J.s;
      ctx.drawImage(SP.moeda, sx(c.x) - (tam * Math.max(0.15, gira)) / 2, cy - tam / 2, tam * Math.max(0.15, gira), tam);
    }
    for (i = 0; i < J.pod.length; i++) {
      var o = J.pod[i], flut = Math.sin(J.tempo * 3 + i) * 4;
      porBase(ctx, SP[o.tipo], o.x, o.y - 20 + flut, 40, 40, false);
    }
    for (i = 0; i < J.bic.length; i++) {
      var e = J.bic[i], passo = Math.floor(J.tempo * (e.tipo === 'pombo' ? 8 : 3)) % 2;
      if (e.tipo === 'gato') porBase(ctx, SP.gato[passo], e.x, e.y, 46, 46, false, e.caindo ? e.rot : 0);
      else porBase(ctx, SP.pombo[passo], e.x, e.y, 46, 33, e.vx < 0, e.caindo ? e.rot : 0);
    }
    for (i = 0; i < J.part.length; i++) {
      var pt = J.part[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.vida * 2.4));
      ctx.fillStyle = pt.cor;
      ctx.fillRect(sx(pt.x) - 3, sy(pt.y) - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    if (J.fase !== 'fim' || sy(J.y) < J.h + 80) desenharJogador(ctx);
    for (i = 0; i < J.textos.length; i++) {
      var tx = J.textos[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, tx.vida * 2));
      textoGrande(ctx, tx.t, sx(tx.x), sy(tx.y), 22, tx.cor, [J.ox, J.ox + J.campo]);
    }
    ctx.globalAlpha = 1;
    if (largo) {
      ctx.restore();
      ctx.fillStyle = 'rgba(15,61,46,0.1)'; ctx.fillRect(J.ox - 1, 0, 1, J.h); ctx.fillRect(J.ox + J.campo, 0, 1, J.h);
    }
    ctx.restore();
    poderesNaTela(ctx);
    if (J.fase === 'contagem') textoGrande(ctx, String(Math.max(1, Math.ceil(J.conta))), J.w / 2, J.h * 0.42, 72, '#FFFFFF');
  }

  /* ================================================================ laco ===================================== */

  function quadro(t) {
    if (!J || !J.vivo) return;
    J.raf = 0;
    var dt = J.ult ? Math.min(1 / 30, (t - J.ult) / 1000) : 1 / 60;
    J.ult = t;
    if (J.fase === 'jogando' || J.fase === 'caindo' || J.fase === 'inicio') atualizar(dt);
    else if (J.fase === 'contagem') contar(dt);
    if (!J) return;
    desenhar();
    /* parado (pausa, fim) ou escondido: nao gasta bateria redesenhando a mesma coisa */
    if (J.fase === 'jogando' || J.fase === 'caindo' || J.fase === 'inicio' || J.fase === 'contagem') pedirQuadro();
  }
  function contar(dt) {
    var antes = Math.ceil(J.conta);
    J.conta -= dt;
    if (J.conta <= 0) { J.fase = 'jogando'; som('vai'); }
    else if (Math.ceil(J.conta) < antes) som('conta');
  }
  function pedirQuadro() { if (J && J.vivo && !J.raf && !document.hidden) J.raf = requestAnimationFrame(quadro); }

  function medir() {
    var r = J.raiz.getBoundingClientRect();
    J.w = Math.max(200, r.width); J.h = Math.max(300, r.height);
    J.dpr = Math.min(window.devicePixelRatio || 1, 2);
    J.canvas.width = Math.round(J.w * J.dpr); J.canvas.height = Math.round(J.h * J.dpr);
    /* o jogo tem sempre 360 de largura: no celular ocupa a tela toda; no computador, uma coluna de ate 480 px */
    J.campo = Math.min(J.w, 480);
    J.ox = (J.w - J.campo) / 2;
    J.s = J.campo / LARG;
    J.visH = J.h / J.s;
    /* a barra do iPhone embaixo: os indicadores dos poderes ficam acima dela */
    var sb = 0;
    try { sb = parseFloat(getComputedStyle(J.raiz).getPropertyValue('--seguro-baixo')) || 0; } catch (_) { sb = 0; }
    J.baixoSeguro = sb;
    /* o ceu estrelado (uma tela so, feita aqui porque depende do tamanho) */
    J.estrelas = document.createElement('canvas');
    J.estrelas.width = Math.round(J.w); J.estrelas.height = Math.round(J.h);
    var x = J.estrelas.getContext('2d');
    for (var i = 0; i < Math.round(J.w * J.h / 2600); i++) {
      x.fillStyle = 'rgba(255,255,255,' + (0.35 + fixo(i + 11) * 0.65) + ')';
      var t = fixo(i + 5) < 0.12 ? 2.4 : 1.4;
      x.fillRect(fixo(i) * J.w, fixo(i + 1000) * J.h, t, t);
    }
    J.ult = 0;
    if (J.fase === 'inicio' || J.fase === 'jogando') gerarAte(J.cam + J.visH + 260);
    if (!J.raf) { desenhar(); pedirQuadro(); }
  }

  /* ================================================================ telas (DOM) ============================= */

  function atualizarPlacar() {
    var p = pontos();
    if (p !== J.pontosVistos) { J.pontosVistos = p; J.elPontos.textContent = numero(p); }
    if (J.moedas !== J.moedasVistas) { J.moedasVistas = J.moedas; J.elMoedas.textContent = numero(J.moedas); }
    if (!J.novoRecorde && J.recorde > 0 && p > J.recorde) { J.novoRecorde = true; som('recorde'); aviso('Novo recorde!'); }
  }

  function painel(conteudo) {
    UI.limpar(J.painel);
    if (!conteudo) { J.painel.hidden = true; return; }
    J.painel.appendChild(conteudo);
    J.painel.hidden = false;
  }

  /* os tres poderes, desenhados pequenos, para a explicacao da tela de inicio */
  function miniatura(spr) {
    var c = el('canvas', { class: 'pulo-poder-ico', width: 64, height: 64, 'aria-hidden': 'true' });
    try { c.getContext('2d').drawImage(spr, 0, 0, 64, 64); } catch (_) { /* sem desenho */ }
    return c;
  }

  function telaInicio() {
    J.fase = 'inicio';
    J.elTopo.hidden = true;
    var toque = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    var dicas = el('div', { class: 'pulo-dicas' }, [
      el('div', { class: 'pulo-dica' }, [icone('lados'), el('span', { text: toque ? 'Segure do lado que quer ir' : 'Setas para o lado: anda' })]),
      el('div', { class: 'pulo-dica' }, [icone('sobe'), el('span', { text: 'Pula sozinho. Fuja do gato!' })]),
    ]);
    var BASE_PODER = { ima: ['Ímã', 'puxa moedas'], turbo: ['Turbo', 'sobe voando'], escudo: ['Capacete', 'salva 1 vez'] };
    var poderes = el('div', { class: 'pulo-poderes' }, ['turbo', 'ima', 'escudo'].map(function (tipo) {
      var p = PODER_DE[tipo];
      return el('div', { class: 'pulo-poder' }, [miniatura(SP[tipo]), el('b', { text: p ? nomeCurto(p.nome) : BASE_PODER[tipo][0] }), el('span', { text: p ? FAZ_PODER[tipo] : BASE_PODER[tipo][1] })]);
    }));
    painel(el('div', { class: 'pulo-cartao' }, [
      el('img', { class: 'pulo-mascote', src: 'img/mascote-192.webp', alt: '', width: 192, height: 192 }),
      el('h2', { text: 'Pulo do Ligeiro' }),
      el('p', { class: 'pulo-texto', text: PRODUTOS.length && J.nomeLoja ? 'Suba o mais alto que der. Os lanches da ' + J.nomeLoja + ' viram poderes!' : 'Suba o mais alto que der e pegue as moedas no caminho.' }),
      dicas,
      poderes,
      chaveMusica(),
      J.recorde > 0 ? el('div', { class: 'pulo-recorde' }, [UI.iconeLinha('trofeu'), el('span', { text: 'Seu recorde: ' + numero(J.recorde) })]) : null,
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: function () { comecar(); } }, [UI.iconeLinha('tocar'), 'Jogar']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, 'Voltar ao pedido'),
      el('p', { class: 'pulo-nota', text: 'Seu pedido continua andando. Se ele mudar, avisamos aqui.' }),
    ]));
    pedirQuadro();
  }

  function comecar() {
    /* o som so pode nascer num toque (regra do iPhone) */
    if (J.som) { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) { /* sem som */ } }
    novaSubida();
    J.elTopo.hidden = false;
    J.pontosVistos = -1; J.moedasVistas = -1;
    atualizarPlacar();
    painel(null);
    J.ult = 0;
    J.fase = 'jogando';
    som('vai');
    musicaParar(); musicaLigar();
    if (!J.jaJogou) { J.jaJogou = true; mostrarDicaRapida(); }
    pedirQuadro();
  }

  function mostrarDicaRapida() {
    var d = el('div', { class: 'pulo-dica-rapida' }, [icone('lados'), el('span', { text: 'Segure do lado que quer ir' })]);
    J.raiz.appendChild(d);
    setTimeout(function () { d.classList.add('sai'); }, 2600);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
  }

  function pausar(titulo, texto) {
    if (!J || (J.fase !== 'jogando' && J.fase !== 'contagem')) return;
    J.fase = 'pausa';
    soltarTudo();
    musicaParar();
    painel(el('div', { class: 'pulo-cartao' }, [
      el('h2', { text: typeof titulo === 'string' ? titulo : 'Pausado' }),
      el('p', { class: 'pulo-texto', text: typeof texto === 'string' ? texto : numero(pontos()) + ' pontos até aqui.' }),
      chaveMusica(),
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: continuar }, [UI.iconeLinha('tocar'), 'Continuar']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, typeof titulo === 'string' ? 'Ver meu pedido' : 'Voltar ao pedido'),
    ]));
  }
  function continuar() {
    if (!J || J.fase !== 'pausa') return;
    painel(null);
    /* volta com uma contagem curta: da tempo de pegar o jeito antes de cair */
    J.fase = 'contagem'; J.conta = 2; J.ult = 0;
    som('conta');
    musicaLigar();
    pedirQuadro();
  }

  /* "Bateu fome?": o lanche que o cliente mais pegou (ou o primeiro da loja), com o preco e o caminho para o cardapio */
  function cartaoFome() {
    /* loja fechou durante o jogo: nao oferece o que nao da para pedir agora */
    if (!PRODUTOS.length || !J.aoVerProduto || (J.podePedir && !J.podePedir())) return null;
    var fav = PRODUTOS.slice().sort(function (a, b) { return (J.pegos[b.id] || 0) - (J.pegos[a.id] || 0); })[0];
    var foto = el('span', { class: 'pulo-fome-foto', 'aria-hidden': 'true' });
    if (fav.foto) { var im = el('img', { src: fav.foto, alt: '' }); im.onerror = function () { foto.textContent = fav.emoji || '🍔'; }; foto.appendChild(im); }
    else foto.textContent = fav.emoji || '🍔';
    return el('div', { class: 'pulo-fome' }, [
      foto,
      el('div', { class: 'pulo-fome-texto' }, [el('b', { text: 'Bateu fome?' }), el('span', { text: fav.nome + ' por ' + precoEmReais(fav.preco) })]),
      el('button', { class: 'btn btn-fantasma btn-pequeno', type: 'button', onclick: function () { var ir = J.aoVerProduto, id = fav.id; fecharEDepois(function () { ir(id); }); } }, 'Ver no cardápio'),
    ]);
  }

  function fimDeJogo() {
    J.fase = 'fim';
    soltarTudo();
    var p = pontos();
    var recorde = p > J.recorde;
    if (recorde) { J.recorde = p; guardar(CHAVE_RECORDE, p); }
    var titulo = recorde && p > 0 ? 'Novo recorde!' : ({ gato: 'O gato pegou!', pombo: 'Trombou no pombo!' }[J.motivo] || 'Caiu!');
    painel(el('div', { class: 'pulo-cartao' }, [
      el('h2', { text: titulo }),
      el('div', { class: 'pulo-final' }, [el('b', { text: numero(p) }), el('span', { text: 'pontos' })]),
      el('div', { class: 'pulo-numeros' }, [
        el('div', {}, [el('b', { text: numero(J.topo / 10) }), el('span', { text: 'metros' })]),
        el('div', {}, [el('b', { text: numero(J.moedas) }), el('span', { text: J.moedas === 1 ? 'moeda' : 'moedas' })]),
        el('div', {}, [el('b', { text: numero(J.pulos) }), el('span', { text: J.pulos === 1 ? 'pulo' : 'pulos' })]),
      ]),
      !recorde && J.recorde > 0 ? el('div', { class: 'pulo-recorde' }, [UI.iconeLinha('trofeu'), el('span', { text: 'Seu recorde: ' + numero(J.recorde) })]) : null,
      cartaoFome(),
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: function () { comecar(); } }, [UI.iconeLinha('tocar'), 'Jogar de novo']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, 'Voltar ao pedido'),
    ]));
  }

  /* recado rapido por cima do jogo (altura, recorde, o pedido andou) */
  function aviso(texto) {
    if (!J) return;
    clearTimeout(J.tempoAviso);
    J.elAviso.textContent = texto;
    J.elAviso.hidden = false;
    J.elAviso.classList.remove('sai');
    J.tempoAviso = setTimeout(function () { if (J) { J.elAviso.classList.add('sai'); J.tempoAviso = setTimeout(function () { if (J) J.elAviso.hidden = true; }, 400); } }, 2400);
  }

  /* o pedido andou: a etiqueta muda; se for a hora de buscar ou receber, o jogo pausa e pergunta */
  function pedidoMudou(pedido, rotulo, importante) {
    if (!J) return;
    if (J.elPedido) J.elPedido.textContent = rotulo;
    som('aviso');
    if (importante && (J.fase === 'jogando' || J.fase === 'contagem')) pausar(rotulo, 'Seu pedido andou. Quer ver agora ou terminar o jogo?');
    else aviso('Seu pedido: ' + rotulo);
  }

  /* ---- toques e teclas: segurar na metade esquerda anda para a esquerda; na direita, para a direita. Com dois dedos,
     vale o ultimo que encostou ---- */
  function ladoDoToque(clientX) { var r = J.canvas.getBoundingClientRect(); return clientX - r.left < r.width / 2 ? -1 : 1; }
  function acertarLado() {
    var ultimo = J.ordemToques[J.ordemToques.length - 1];
    var toque = ultimo != null ? J.toques[ultimo] : 0;
    var tecla = (J.teclas.dir ? 1 : 0) - (J.teclas.esq ? 1 : 0);
    J.dir = tecla || toque || 0;
  }
  function soltarTudo() { if (!J) return; J.toques = {}; J.ordemToques = []; J.teclas = { esq: false, dir: false }; J.dir = 0; }
  function aoApertar(e) {
    if (!J || e.target !== J.canvas) return;
    J.toques[e.pointerId] = ladoDoToque(e.clientX);
    J.ordemToques = J.ordemToques.filter(function (id) { return id !== e.pointerId; }).concat([e.pointerId]);
    acertarLado();
  }
  function aoMover(e) {
    if (!J || !(e.pointerId in J.toques)) return;
    J.toques[e.pointerId] = ladoDoToque(e.clientX);
    acertarLado();
  }
  function aoSoltar(e) {
    if (!J || !(e.pointerId in J.toques)) return;
    delete J.toques[e.pointerId];
    J.ordemToques = J.ordemToques.filter(function (id) { return id !== e.pointerId; });
    acertarLado();
  }
  function aoTeclar(e) {
    if (!J) return;
    var k = e.key;
    if (J.fase === 'jogando' || J.fase === 'contagem') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') J.teclas.esq = true;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') J.teclas.dir = true;
      else if (k === 'Escape' || k === 'p' || k === 'P') pausar();
      else return;
      acertarLado();
      e.preventDefault();
    } else if (k === 'Escape') { if (J.fase === 'pausa') continuar(); else fechar(); e.preventDefault(); }
  }
  function aoSoltarTecla(e) {
    if (!J) return;
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') J.teclas.esq = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') J.teclas.dir = false;
    else return;
    acertarLado();
  }
  function aoEsconder() {
    if (!J) return;
    if (document.hidden) { pausar(); soltarTudo(); if (J && J.raf) { cancelAnimationFrame(J.raf); J.raf = 0; } }
    else { J.ult = 0; desenhar(); pedirQuadro(); }
  }
  function aoPerderFoco() { soltarTudo(); }
  function aoVoltarNavegador() { if (J) fechar(true); }
  function semRolar(e) { if (J && e.target === J.canvas) e.preventDefault(); }

  /* ================================================================ abrir e fechar =========================== */

  function abrir(op) {
    if (J) return;
    op = op || {};
    estilos();
    J = {
      vivo: true, fase: 'inicio', som: ler(CHAVE_SOM, '1') !== '0', comMusica: ler(CHAVE_MUSICA, '1') !== '0', recorde: Number(ler(CHAVE_RECORDE, 0)) || 0, musica: null,
      aoFechar: op.aoFechar, aoVerProduto: typeof op.aoVerProduto === 'function' ? op.aoVerProduto : null, podePedir: typeof op.podePedir === 'function' ? op.podePedir : null, nomeLoja: String(op.nomeLoja || '').slice(0, 40),
      raf: 0, ult: 0, pontosVistos: -1, moedasVistas: -1, jaJogou: Number(ler(CHAVE_RECORDE, 0)) > 0, baixoSeguro: 0,
      toques: {}, ordemToques: [], teclas: { esq: false, dir: false }, visH: 0,
    };
    J.canvas = el('canvas', { class: 'pulo-tela', 'aria-label': 'Pulo do Ligeiro' });
    J.ctx = J.canvas.getContext('2d');
    J.elPontos = el('b', { text: '0' });
    J.elMoedas = el('b', { text: '0' });
    var botaoSom = el('button', { class: 'pulo-botao', type: 'button', 'aria-label': J.som ? 'Desligar o som' : 'Ligar o som' }, [icone(J.som ? 'som' : 'semSom')]);
    botaoSom.onclick = function () {
      J.som = !J.som; guardar(CHAVE_SOM, J.som ? '1' : '0');
      if (!J.som) musicaParar(); else if (J.fase === 'jogando' || J.fase === 'contagem') musicaLigar();
      UI.limpar(botaoSom); botaoSom.appendChild(icone(J.som ? 'som' : 'semSom'));
      botaoSom.setAttribute('aria-label', J.som ? 'Desligar o som' : 'Ligar o som');
    };
    J.elTopo = el('div', { class: 'pulo-topo', hidden: true }, [
      el('div', { class: 'pulo-moedas' }, [el('span', { class: 'pulo-moeda-ico', 'aria-hidden': 'true' }), J.elMoedas]),
      el('div', { class: 'pulo-pontos', 'aria-live': 'off' }, [J.elPontos]),
      el('div', { class: 'pulo-botoes' }, [
        botaoSom,
        el('button', { class: 'pulo-botao', type: 'button', 'aria-label': 'Pausar', onclick: function () { pausar(); } }, [icone('pausa')]),
      ]),
    ]);
    J.elPedido = op.rotulo ? el('div', { class: 'pulo-pedido', text: op.rotulo }) : null;
    J.elAviso = el('div', { class: 'pulo-aviso', role: 'status', hidden: true });
    J.painel = el('div', { class: 'pulo-painel', hidden: true });
    J.raiz = el('div', { class: 'pulo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pulo do Ligeiro' }, [
      J.canvas, J.elTopo, J.elPedido, J.elAviso, J.painel,
    ]);
    document.body.appendChild(J.raiz);
    document.documentElement.classList.add('pulo-aberto');

    J.canvas.addEventListener('pointerdown', aoApertar);
    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
    J.raiz.addEventListener('touchmove', semRolar, { passive: false });
    J.raiz.addEventListener('contextmenu', semRolar);
    window.addEventListener('keydown', aoTeclar);
    window.addEventListener('keyup', aoSoltarTecla);
    window.addEventListener('blur', aoPerderFoco);
    window.addEventListener('resize', medir);
    document.addEventListener('visibilitychange', aoEsconder);
    /* o voltar do celular fecha o jogo (e nao sai da tela do pedido) */
    try { history.pushState({ ligeiroPulo: true }, ''); J.empurrou = true; } catch (_) { J.empurrou = false; }
    window.addEventListener('popstate', aoVoltarNavegador);

    /* os desenhos dependem da loja (a logo no peito e a cidade na placa): refeitos so quando a loja muda */
    var novos = (Array.isArray(op.produtos) ? op.produtos : []).slice(0, 3).map(function (p) { return { id: String(p.id), nome: String(p.nome || ''), preco: Number(p.preco) || 0, emoji: p.emoji || '', foto: p.foto || '' }; });
    var chave = (op.cidade || '') + '|' + (op.logo || '') + '|' + novos.map(function (p) { return p.id + ':' + (p.foto ? 1 : 0); }).join(',');
    var comeco = function () {
      if (!J) return;
      if (!SP || SP.chave !== chave) { montarDesenhos(op.cidade); poderesDaLoja(); SP.chave = chave; }
      novaSubida();
      medir();
      telaInicio();
    };
    if (SP && SP.chave === chave) { comeco(); return; }
    PRODUTOS = novos;
    /* as fotos dos lanches: ja estao no celular (cache da loja); a que nao abrir em 1,5 s fica com o emoji */
    var faltam = PRODUTOS.filter(function (p) { return p.foto; }).length, seguiu = false;
    var seguir = function () { if (seguiu) return; seguiu = true; carregarMarca(); };
    PRODUTOS.forEach(function (p) {
      if (!p.foto) return;
      var im = new Image();
      im.onload = function () { p.img = im; if (--faltam <= 0) seguir(); };
      im.onerror = function () { p.img = null; if (--faltam <= 0) seguir(); };
      im.src = p.foto;
    });
    if (faltam <= 0) seguir(); else setTimeout(seguir, 1500);
    function carregarMarca() {
      if (!op.logo) { marca = null; comeco(); return; }
      var img = new Image();
      img.onload = function () { marca = { img: img, logo: true }; comeco(); };
      /* logo que nao carrega: fica o "L" do Ligeiro */
      img.onerror = function () { marca = null; comeco(); };
      img.src = op.logo;
    }
  }

  /* Sai do jogo e so depois faz o que foi pedido. O fechar volta uma casa no historico (e o que faz o voltar do celular
     fechar o jogo), e esse voltar chega um instante depois: abrir o lanche antes dele faria o voltar trazer a tela da
     senha de volta, por cima do cardapio. Espera o voltar chegar (ou 600 ms, se o navegador nao avisar) */
  function fecharEDepois(fn) {
    var vaiVoltar = !!(J && J.empurrou && history.state && history.state.ligeiroPulo);
    if (!vaiVoltar) { fechar(); fn(); return; }
    var feito = false, tempo = null;
    var seguir = function () {
      if (feito) return;
      feito = true;
      window.removeEventListener('popstate', seguir);
      clearTimeout(tempo);
      fn();
    };
    tempo = setTimeout(seguir, 600);
    window.addEventListener('popstate', seguir);
    fechar();
  }

  function fechar(peloVoltar) {
    if (!J) return;
    var aoFechar = J.aoFechar;
    musicaParar();
    J.vivo = false;
    if (J.raf) cancelAnimationFrame(J.raf);
    clearTimeout(J.tempoAviso);
    window.removeEventListener('pointermove', aoMover);
    window.removeEventListener('pointerup', aoSoltar);
    window.removeEventListener('pointercancel', aoSoltar);
    window.removeEventListener('keydown', aoTeclar);
    window.removeEventListener('keyup', aoSoltarTecla);
    window.removeEventListener('blur', aoPerderFoco);
    window.removeEventListener('resize', medir);
    window.removeEventListener('popstate', aoVoltarNavegador);
    document.removeEventListener('visibilitychange', aoEsconder);
    if (J.raiz.parentNode) J.raiz.parentNode.removeChild(J.raiz);
    document.documentElement.classList.remove('pulo-aberto');
    var empurrou = J.empurrou;
    J = null;
    if (!peloVoltar && empurrou && history.state && history.state.ligeiroPulo) { try { history.back(); } catch (_) { /* segue */ } }
    if (typeof aoFechar === 'function') aoFechar();
  }

  /* ================================================================ estilo (vem junto, so para quem joga) ==== */

  function estilos() {
    if (document.getElementById('estiloPulo')) return;
    var css =
      'html.pulo-aberto,html.pulo-aberto body{overflow:hidden;overscroll-behavior:none}' +
      '.pulo{--seguro-baixo:env(safe-area-inset-bottom,0px);position:fixed;inset:0;z-index:150;background:#D4F0FF;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overflow:hidden}' +
      '.pulo-tela{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.pulo-topo{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 0;pointer-events:none}' +
      '.pulo-topo[hidden],.pulo-painel[hidden],.pulo-aviso[hidden]{display:none}' +
      '.pulo-moedas{justify-self:start;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 8px;border-radius:999px;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(14,31,20,.15);font-family:var(--display);font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '.pulo-moeda-ico{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 50%,#FFD84A 0 55%,#F7C325 56% 78%,#D9A109 79%)}' +
      '.pulo-pontos{font-family:var(--display);font-size:32px;line-height:1;font-weight:700;color:#fff;text-shadow:0 2px 0 rgba(14,31,20,.55),0 0 12px rgba(14,31,20,.25);font-variant-numeric:tabular-nums}' +
      '.pulo-botoes{justify-self:end;display:flex;gap:8px;pointer-events:auto}' +
      '.pulo-botao{width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.92);color:var(--deep);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(14,31,20,.15);cursor:pointer;padding:0}' +
      '.pulo-botao .ico-traco svg{width:22px;height:22px}' +
      '.pulo-pedido{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 64px);max-width:calc(100% - 32px);padding:6px 14px;border-radius:999px;background:rgba(15,61,46,.82);color:#fff;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}' +
      '.pulo-aviso{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 104px);transform:translateX(-50%);max-width:calc(100% - 32px);padding:12px 18px;border-radius:16px;background:var(--lime);color:var(--ink);font-family:var(--display);font-size:17px;font-weight:700;text-align:center;white-space:nowrap;box-shadow:0 6px 20px rgba(14,31,20,.25);animation:pulo-desce .3s ease-out both!important;pointer-events:none}' +
      '.pulo-aviso.sai{animation:pulo-sobe .35s ease-in both!important}' +
      '.pulo-painel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,61,46,.28)}' +
      '.pulo-cartao{width:100%;max-width:360px;max-height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;border-radius:24px;background:#fff;box-shadow:0 18px 50px rgba(14,31,20,.3);text-align:center;animation:pulo-pop .35s cubic-bezier(.2,1.3,.4,1) both!important}' +
      '.pulo-cartao h2{margin:0;font-family:var(--display);font-size:26px;line-height:1.15;color:var(--ink)}' +
      '.pulo-mascote{width:80px;height:80px;object-fit:contain;margin:-8px 0 -4px;animation:pulo-pula .9s cubic-bezier(.3,0,.7,1) infinite alternate!important}' +
      '.pulo-texto{margin:0;font-size:15px;line-height:1.4;color:var(--body)}' +
      '.pulo-nota{margin:0;font-size:13px;line-height:1.35;color:var(--muted)}' +
      '.pulo-dicas{width:100%;display:flex;flex-direction:column;gap:8px}' +
      '.pulo-dica{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;background:var(--lime-suave);font-size:14px;line-height:1.3;color:var(--deep);text-align:left}' +
      '.pulo-dica .ico-traco{flex:none}' +
      '.pulo-dica .ico-traco svg{width:22px;height:22px}' +
      '.pulo-poderes{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.pulo-poder{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:#F4F7F2;line-height:1.2;min-width:0}' +
      '.pulo-poder b{font-size:13.5px;color:var(--ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pulo-poder span{font-size:12px;color:var(--muted);white-space:nowrap}' +
      '.pulo-poder-ico{width:44px;height:44px;margin-bottom:4px}' +
      '.pulo-opcao{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 4px 12px;font-size:15px;font-weight:600;color:var(--ink)}' +
      '.pulo-recorde{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:700;color:var(--deep2)}' +
      '.pulo-recorde .ico-traco svg{width:20px;height:20px}' +
      '.pulo-final{display:flex;flex-direction:column;align-items:center;line-height:1}' +
      '.pulo-final b{font-family:var(--display);font-size:48px;color:var(--deep);font-variant-numeric:tabular-nums}' +
      '.pulo-final span{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}' +
      '.pulo-numeros{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.pulo-numeros div{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:#F4F7F2}' +
      '.pulo-numeros b{font-family:var(--display);font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '.pulo-numeros span{font-size:12px;color:var(--muted)}' +
      '.pulo-cartao .btn{width:100%;margin:0}' +
      '.pulo-fome{width:100%;display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:8px 12px;padding:12px;border-radius:14px;background:var(--lime-suave,#EEF9DC);text-align:left}' +
      '.pulo-fome-foto{width:56px;height:56px;border-radius:12px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;line-height:1}' +
      '.pulo-fome-foto img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.pulo-fome-texto{display:flex;flex-direction:column;gap:2px;min-width:0;line-height:1.3}' +
      '.pulo-fome-texto b{font-size:15px;color:var(--ink)}' +
      '.pulo-fome-texto span{font-size:13.5px;color:var(--body,#3B4A3F);overflow-wrap:anywhere}' +
      '.pulo-fome .btn{grid-column:1/-1}' +
      '.pulo-cartao .btn .ico-traco{margin-right:8px}' +
      '.pulo-dica-rapida{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:rgba(15,61,46,.85);color:#fff;font-size:15px;font-weight:600;white-space:nowrap;pointer-events:none;animation:pulo-aparece .3s ease-out both!important}' +
      '.pulo-dica-rapida.sai{animation:pulo-some .5s ease-in both!important}' +
      '@keyframes pulo-pop{0%{opacity:0;transform:scale(.86) translateY(12px)}100%{opacity:1;transform:none}}' +
      '@keyframes pulo-pula{0%{transform:translateY(0) scale(1.06,.94)}30%{transform:translateY(-4px) scale(1,1)}100%{transform:translateY(-14px)}}' +
      '@keyframes pulo-desce{0%{opacity:0;transform:translate(-50%,-16px)}100%{opacity:1;transform:translate(-50%,0)}}' +
      '@keyframes pulo-sobe{0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-16px)}}' +
      '@keyframes pulo-aparece{0%{opacity:0}100%{opacity:1}}' +
      '@keyframes pulo-some{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(el('style', { id: 'estiloPulo', text: css }));
  }

  window.LigeiroPulo = {
    abrir: abrir,
    fechar: function () { fechar(); },
    aberto: function () { return !!J; },
    pedidoMudou: pedidoMudou,
    /* so para o teste automatico (testes/pulo.test.mjs): o estado e um passo do jogo sem desenhar */
    _teste: {
      estado: function () { return J; }, passo: function (dt) { if (J.fase === 'contagem') contar(dt); else atualizar(dt); }, comecar: function () { comecar(); },
      lado: function (d) { J.dir = d; }, desenhar: function () { desenhar(); }, gerarAte: function (y) { gerarAte(y); },
      constantes: { LARG: LARG, G: G, PULO: PULO, MOLA: MOLA, VAO_TETO: VAO_TETO, VEL_LADO: VEL_LADO, ACEL_LADO: ACEL_LADO, PLAT_L: PLAT_L, PE: PE, ALTURA_PULO: ALTURA_PULO },
    },
  };
})();
