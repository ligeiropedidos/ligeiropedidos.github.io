/*
 * Ligeiro - Corrida do Ligeiro: o joguinho para o cliente passar o tempo enquanto o pedido fica pronto.
 *
 * Tudo no aparelho: nenhuma leitura nem gravacao no banco, nenhum anuncio, nenhuma imagem nova (o desenho e feito em
 * codigo, num canvas). O recorde fica no proprio celular. Este arquivo so baixa quando o cliente toca em "Jogar".
 *
 * Falso 3D, como os corredores de fliperama: a rua sai do horizonte e cada coisa cresce conforme chega perto
 * (escala = D0 / (distancia + D0)). Tres faixas; arrastar para o lado muda de faixa, arrastar para cima pula.
 * O ratinho do Ligeiro vai de moto, visto de costas, com a caixa de entrega na garupa. A cidade vai do dia para o
 * por do sol e para a noite (os postes acendem). Poderes: ima (puxa as moedas), turbo (voa e derruba o que tiver na
 * frente) e capacete (aguenta uma batida). Moedas seguidas sobem o multiplicador ate x5.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var el = UI.el;

  var CHAVE_RECORDE = 'ligeiro:jogo:recorde';
  var CHAVE_SOM = 'ligeiro:jogo:som';
  var CHAVE_MUSICA = 'ligeiro:jogo:musica';

  /* ---- o mundo, em metros ---- */
  var FAIXA = 2.4;          /* largura de cada faixa */
  var D0 = 5;               /* distancia da camera atras da moto: quanto maior, menos "fundo" a rua tem */
  var LONGE = 115;          /* ate onde a rua aparece */
  var SEG = 3;              /* tamanho de cada pedaco da faixa pintada (da a sensacao de velocidade) */
  var PULO_TEMPO = 0.72;    /* segundos no ar */
  var PULO_ALTURA = 1.35;
  var CICLO = 3600;         /* metros de um dia inteiro na cidade (dia, por do sol, noite e o dia de novo) */

  /* o que bate: quem da para pular por cima e quem so desviando */
  var OBSTACULOS = {
    cone: { pula: true, comp: 0.5 },
    buraco: { pula: true, comp: 1.4 },
    lombada: { pula: true, comp: 0.9, todas: true },
    cachorro: { pula: true, comp: 1.0 },
    carro: { pula: false, comp: 3.8 },
    caminhao: { pula: false, comp: 6.5 },
  };
  var PODERES = { ima: 8, turbo: 5, escudo: 0 };
  var CORES_CARRO = ['#E74C3C', '#3498DB', '#F1C40F', '#9B59B6', '#ECEFF1', '#2ECC71'];
  var COR_PEDACO = { cone: '#FF7A1A', buraco: '#555B63', lombada: '#F9D71C', cachorro: '#D9A066', caminhao: '#F7D046' };

  /* icones de traco que so o jogo usa (o resto vem do site) */
  var ICO = {
    pausa: '<path d="M9 5.5v13"/><path d="M15 5.5v13"/>',
    som: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    semSom: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>',
    lados: '<path d="M8 7 3 12l5 5"/><path d="M16 7l5 5-5 5"/><path d="M3 12h18"/>',
    cima: '<path d="M7 9l5-5 5 5"/><path d="M12 4v16"/>',
  };
  function icone(nome) {
    if (!ICO[nome]) return UI.iconeLinha(nome);
    return el('span', { class: 'ico-traco', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + ICO[nome] + '</svg>' });
  }
  function numero(n) { return Math.floor(n).toLocaleString('pt-BR'); }
  function ler(chave, padrao) { var v = UI.lerLocal ? UI.lerLocal(chave) : null; return v == null ? padrao : v; }
  function guardar(chave, valor) { if (UI.guardarLocal) UI.guardarLocal(chave, valor); }
  var menosMovimento = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  var SP = null;
  var mascote = null; /* o ratinho de frente, para o adesivo da caixa e para as telas do jogo */

  /* poder na rua: uma bolha colorida com o desenho branco dentro (ima vermelho, turbo amarelo, capacete azul) */
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

  function montarDesenhos(cidade) {
    SP = {};
    SP.cone = sprite(60, 80, function (x) {
      x.fillStyle = '#2B2B2B'; retangulo(x, 4, 70, 52, 9, 3); x.fill();
      x.beginPath(); x.moveTo(26, 4); x.lineTo(34, 4); x.lineTo(50, 71); x.lineTo(10, 71); x.closePath();
      x.fillStyle = '#FF7A1A'; x.fill();
      x.save(); x.clip();
      x.fillStyle = '#E2600B'; x.fillRect(30, 0, 30, 80);
      x.fillStyle = '#FFFFFF'; x.fillRect(0, 26, 60, 9); x.fillRect(0, 47, 60, 9);
      x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(30, 26, 30, 9); x.fillRect(30, 47, 30, 9);
      x.restore();
    });
    SP.carros = CORES_CARRO.map(function (cor) {
      return sprite(180, 150, function (x) {
        x.fillStyle = '#1B1B1B'; retangulo(x, 16, 116, 30, 30, 6); x.fill(); retangulo(x, 134, 116, 30, 30, 6); x.fill();
        x.fillStyle = cor; retangulo(x, 8, 44, 164, 80, 16); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.16)'; retangulo(x, 8, 96, 164, 28, 12); x.fill();
        x.beginPath(); x.moveTo(38, 10); x.lineTo(142, 10); x.lineTo(160, 50); x.lineTo(20, 50); x.closePath();
        x.fillStyle = cor; x.fill(); x.fillStyle = 'rgba(0,0,0,0.12)'; x.fill();
        x.beginPath(); x.moveTo(46, 16); x.lineTo(134, 16); x.lineTo(148, 44); x.lineTo(32, 44); x.closePath();
        x.fillStyle = '#26323D'; x.fill();
        x.beginPath(); x.moveTo(52, 20); x.lineTo(78, 20); x.lineTo(64, 40); x.lineTo(40, 40); x.closePath();
        x.fillStyle = 'rgba(255,255,255,0.14)'; x.fill();
        x.fillStyle = '#D0021B'; retangulo(x, 14, 60, 32, 14, 4); x.fill(); retangulo(x, 134, 60, 32, 14, 4); x.fill();
        x.fillStyle = '#FF6B6B'; retangulo(x, 18, 62, 12, 6, 2); x.fill(); retangulo(x, 150, 62, 12, 6, 2); x.fill();
        x.fillStyle = '#F5F5F5'; retangulo(x, 70, 80, 40, 16, 3); x.fill();
        x.fillStyle = '#2A6FB5'; x.fillRect(70, 80, 40, 4);
        x.fillStyle = '#2B2B2B'; retangulo(x, 6, 108, 168, 14, 6); x.fill();
      });
    });
    /* caminhao de banana (Juquia e a capital da banana) */
    SP.caminhao = sprite(210, 262, function (x) {
      x.fillStyle = '#1B1B1B'; retangulo(x, 16, 226, 36, 34, 7); x.fill(); retangulo(x, 158, 226, 36, 34, 7); x.fill();
      x.fillStyle = '#9C6B3C'; retangulo(x, 8, 86, 194, 130, 8); x.fill();
      x.strokeStyle = '#7A5230'; x.lineWidth = 3;
      for (var i = 0; i < 5; i++) { x.beginPath(); x.moveTo(12, 108 + i * 22); x.lineTo(198, 108 + i * 22); x.stroke(); }
      x.fillStyle = 'rgba(0,0,0,0.14)'; x.fillRect(8, 190, 194, 26);
      var pencas = [[30, 80], [62, 70], [96, 64], [130, 70], [164, 80], [46, 56], [80, 46], [114, 46], [148, 56], [98, 30]];
      pencas.forEach(function (p) {
        x.save(); x.translate(p[0], p[1]);
        for (var b = -2; b <= 2; b++) {
          x.beginPath(); x.ellipse(b * 6, 0, 5, 16, b * 0.18, 0, Math.PI * 2);
          x.fillStyle = '#F7D046'; x.fill(); x.strokeStyle = '#C99A12'; x.lineWidth = 1.5; x.stroke();
        }
        x.fillStyle = '#4E7A2A'; x.fillRect(-3, -18, 6, 6);
        x.restore();
      });
      x.fillStyle = '#D0021B'; retangulo(x, 14, 194, 26, 14, 4); x.fill(); retangulo(x, 170, 194, 26, 14, 4); x.fill();
      x.fillStyle = '#2B2B2B'; retangulo(x, 4, 214, 202, 16, 6); x.fill();
      x.fillStyle = '#F5F5F5'; retangulo(x, 84, 192, 42, 16, 3); x.fill();
    });
    /* vira-lata caramelo, de lado, em dois passos (as patas alternam enquanto ele atravessa) */
    SP.cachorro = [0, 1].map(function (passo) {
      return sprite(110, 80, function (x) {
        x.strokeStyle = '#C08850'; x.lineWidth = 7;
        x.beginPath(); x.moveTo(20, 34); x.quadraticCurveTo(6, 22, 12, 8); x.stroke(); /* rabo pra cima */
        x.fillStyle = '#B97E45';
        var patas = passo ? [[28, 0], [40, 0], [70, 0], [82, 0]] : [[24, 0], [44, 0], [66, 0], [86, 0]];
        patas.forEach(function (p, i) { retangulo(x, p[0] + (passo && i % 2 ? 3 : 0), 48, 9, 28, 4); x.fill(); });
        x.fillStyle = '#D9A066'; x.beginPath(); x.ellipse(54, 42, 36, 17, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#F1D2A6'; x.beginPath(); x.ellipse(72, 50, 14, 8, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#D9A066'; bola(x, 88, 26, 15); x.fill();
        x.beginPath(); x.ellipse(101, 31, 10, 7, 0.2, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#2B1D12'; bola(x, 108, 29, 3.5); x.fill(); bola(x, 92, 22, 2.6); x.fill();
        x.fillStyle = '#A8703D'; x.beginPath(); x.ellipse(80, 18, 6, 11, -0.5, 0, Math.PI * 2); x.fill();
        x.strokeStyle = '#2B1D12'; x.lineWidth = 2; x.beginPath(); x.moveTo(98, 37); x.quadraticCurveTo(103, 40, 107, 36); x.stroke();
        x.fillStyle = '#E8505B'; x.beginPath(); x.ellipse(104, 41, 3, 4, 0, 0, Math.PI * 2); x.fill(); /* lingua de fora */
        x.fillStyle = '#2E9D4F'; retangulo(x, 76, 34, 5, 16, 2); x.fill(); /* coleira verde */
      });
    });
    /* moeda do Ligeiro */
    SP.moeda = sprite(64, 64, function (x) {
      bola(x, 32, 32, 30); x.fillStyle = '#D9A109'; x.fill();
      bola(x, 32, 32, 25); x.fillStyle = '#F7C325'; x.fill();
      bola(x, 32, 32, 19); x.fillStyle = '#FFD84A'; x.fill();
      x.fillStyle = '#0F3D2E'; x.font = '900 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('L', 32, 34);
      x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 4; x.beginPath(); x.arc(32, 32, 22, 3.6, 4.6); x.stroke();
    });
    /* os tres poderes */
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
    SP.bananeira = sprite(170, 230, function (x) {
      x.fillStyle = '#8A7B3A';
      x.beginPath(); x.moveTo(76, 230); x.lineTo(80, 96); x.lineTo(90, 96); x.lineTo(96, 230); x.closePath(); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(88, 100, 8, 130);
      var folhas = [[-2.5, 70, '#2E8B3E'], [-1.9, 78, '#3FA34D'], [-1.1, 70, '#349848'], [-0.3, 64, '#3FA34D'], [0.4, 72, '#2E8B3E'], [1.1, 76, '#3FA34D']];
      folhas.forEach(function (f) {
        x.save(); x.translate(85, 96); x.rotate(f[0]);
        x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(f[1] * 0.5, -24, f[1], -6); x.quadraticCurveTo(f[1] * 0.55, 14, 0, 0); x.closePath();
        x.fillStyle = f[2]; x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(f[1] * 0.5, -10, f[1], -6); x.stroke();
        x.restore();
      });
      for (var i = 0; i < 4; i++) { x.beginPath(); x.ellipse(98 + (i % 2) * 8, 112 + i * 9, 5, 9, 0.5, 0, Math.PI * 2); x.fillStyle = '#E9C23B'; x.fill(); }
      x.beginPath(); x.ellipse(104, 156, 7, 11, 0.2, 0, Math.PI * 2); x.fillStyle = '#7B2D5B'; x.fill();
    });
    SP.casas = ['#F6C9A8', '#BFE3F2', '#F7E1A1', '#D7C5F0', '#C9E8C1'].map(function (cor) {
      return sprite(240, 200, function (x) {
        x.fillStyle = cor; x.fillRect(20, 72, 200, 128);
        x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(20, 72, 200, 12);
        x.beginPath(); x.moveTo(4, 76); x.lineTo(120, 12); x.lineTo(236, 76); x.closePath(); x.fillStyle = '#C8553D'; x.fill();
        x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 2;
        for (var i = 1; i < 4; i++) { x.beginPath(); x.moveTo(4 + i * 29, 76 - i * 16); x.lineTo(236 - i * 29, 76 - i * 16); x.stroke(); }
        x.fillStyle = '#7A4A2A'; retangulo(x, 100, 128, 40, 72, 4); x.fill();
        x.fillStyle = '#F2D06B'; bola(x, 132, 166, 3); x.fill();
        [[38, 104], [162, 104]].forEach(function (j) {
          x.fillStyle = '#FFFFFF'; x.fillRect(j[0] - 3, j[1] - 3, 46, 40);
          x.fillStyle = '#9FD3F0'; x.fillRect(j[0], j[1], 40, 34);
          x.fillStyle = '#FFFFFF'; x.fillRect(j[0] + 19, j[1], 2, 34); x.fillRect(j[0], j[1] + 16, 40, 2);
        });
      });
    });
    SP.poste = sprite(80, 260, function (x) {
      x.fillStyle = '#7F8C8D'; x.fillRect(12, 30, 7, 230);
      x.fillStyle = '#6C7A7B'; x.fillRect(12, 30, 60, 6);
      x.fillStyle = '#56626A'; retangulo(x, 56, 34, 22, 10, 4); x.fill();
      x.fillStyle = '#FFF3B0'; retangulo(x, 58, 42, 18, 5, 2); x.fill();
    });
    var nome = String(cidade || 'Juquiá').toUpperCase();
    var banana = /^juqui/i.test(String(cidade || 'Juquiá'));
    SP.placa = sprite(240, 170, function (x) {
      x.fillStyle = '#8E9A9E'; x.fillRect(40, 90, 8, 80); x.fillRect(192, 90, 8, 80);
      x.fillStyle = '#1E7B4A'; retangulo(x, 6, 6, 228, 104, 10); x.fill();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 4; retangulo(x, 14, 14, 212, 88, 6); x.stroke();
      x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.textBaseline = 'middle';
      var tam = nome.length > 12 ? 24 : 32;
      x.font = '900 ' + tam + 'px system-ui, sans-serif';
      x.fillText(nome, 120, banana ? 50 : 58, 196);
      if (banana) { x.font = '700 16px system-ui, sans-serif'; x.fillText('Capital da Banana', 120, 82); }
    });
    /* brilhos para a noite (somados por cima: postes, janelas e as lanternas dos carros) */
    function brilhoDe(cor) {
      return sprite(64, 64, function (x) {
        var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, cor.replace('A', '0.95')); g.addColorStop(0.35, cor.replace('A', '0.45')); g.addColorStop(1, cor.replace('A', '0'));
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      });
    }
    SP.luz = brilhoDe('rgba(255,214,120,A)');
    SP.luzVermelha = brilhoDe('rgba(255,60,50,A)');
    /* o ratinho do Ligeiro na moto, de costas */
    SP.jogador = sprite(110, 172, function (x) {
      x.strokeStyle = '#F4A7B9'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(74, 118); x.bezierCurveTo(96, 116, 100, 96, 90, 92); x.stroke();
      x.fillStyle = '#1D1F22'; retangulo(x, 43, 132, 24, 40, 10); x.fill();
      x.fillStyle = '#3A3D42'; x.fillRect(47, 140, 16, 3); x.fillRect(47, 150, 16, 3); x.fillRect(47, 160, 16, 3);
      x.fillStyle = '#2C3E50'; retangulo(x, 22, 102, 14, 38, 6); x.fill(); retangulo(x, 74, 102, 14, 38, 6); x.fill();
      x.fillStyle = '#F5F5F5'; retangulo(x, 18, 134, 20, 10, 4); x.fill(); retangulo(x, 72, 134, 20, 10, 4); x.fill();
      x.fillStyle = '#84CC16'; retangulo(x, 32, 112, 46, 28, 12); x.fill();
      x.fillStyle = '#5E9A0C'; retangulo(x, 32, 128, 46, 12, 6); x.fill();
      x.fillStyle = '#FF3B30'; retangulo(x, 44, 115, 22, 8, 3); x.fill();
      x.fillStyle = '#FFFFFF'; retangulo(x, 47, 126, 16, 7, 2); x.fill();
      x.fillStyle = '#FFFFFF'; retangulo(x, 28, 44, 54, 30, 14); x.fill();
      x.strokeStyle = '#D5DAD8'; x.lineWidth = 2; retangulo(x, 28, 44, 54, 30, 14); x.stroke();
      x.fillStyle = '#2E9D4F'; retangulo(x, 40, 40, 30, 8, 4); x.fill();
      x.fillStyle = '#E6E1E8'; bola(x, 34, 22, 12); x.fill(); bola(x, 76, 22, 12); x.fill();
      x.fillStyle = '#D3CCD7'; bola(x, 34, 22, 7); x.fill(); bola(x, 76, 22, 7); x.fill();
      x.fillStyle = '#ECE8EE'; bola(x, 55, 32, 14); x.fill();
      x.strokeStyle = '#C9C1CE'; x.lineWidth = 2; bola(x, 55, 32, 14); x.stroke();
      x.fillStyle = '#FFFFFF'; retangulo(x, 42, 12, 26, 9, 3); x.fill();
      bola(x, 46, 8, 8); x.fill(); bola(x, 55, 4, 9); x.fill(); bola(x, 64, 8, 8); x.fill();
      x.strokeStyle = '#DADFDD'; x.lineWidth = 1.5; retangulo(x, 42, 12, 26, 9, 3); x.stroke();
      x.fillStyle = '#1B6B4A'; x.beginPath(); x.moveTo(20, 66); x.lineTo(90, 66); x.lineTo(86, 58); x.lineTo(24, 58); x.closePath(); x.fill();
      x.fillStyle = '#0F3D2E'; retangulo(x, 18, 64, 74, 52, 8); x.fill();
      x.fillStyle = '#84CC16'; x.fillRect(18, 104, 74, 5);
      x.fillStyle = '#FFFFFF'; bola(x, 55, 84, 15); x.fill();
      if (mascote && mascote.complete && mascote.naturalWidth) { x.save(); bola(x, 55, 84, 14); x.clip(); x.drawImage(mascote, 38, 67, 34, 34); x.restore(); }
      else { x.fillStyle = '#0F3D2E'; x.font = '900 18px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('L', 55, 85); }
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
      /* [onda, freq inicial, freq final, duracao, volume]; as notas tocam uma depois da outra (menos na batida) */
      var notas = {
        moeda: [['square', 988, 1319, 0.1, 0.035]],
        pulo: [['triangle', 330, 700, 0.18, 0.06]],
        bateu: [['sawtooth', 220, 55, 0.4, 0.07], ['square', 110, 40, 0.3, 0.04]],
        ima: [['sine', 660, 660, 0.08, 0.06], ['sine', 880, 880, 0.08, 0.06], ['sine', 1175, 1175, 0.12, 0.06]],
        turbo: [['sawtooth', 180, 900, 0.45, 0.05]],
        escudo: [['triangle', 523, 523, 0.09, 0.07], ['triangle', 659, 659, 0.09, 0.07], ['triangle', 784, 784, 0.16, 0.07]],
        quebra: [['square', 200, 70, 0.14, 0.05]],
        latido: [['square', 560, 380, 0.07, 0.05], ['square', 560, 360, 0.09, 0.05]],
        mult: [['square', 1319, 1760, 0.14, 0.04]],
        triz: [['sine', 1400, 500, 0.18, 0.05]],
        marco: [['square', 659, 659, 0.08, 0.04], ['square', 784, 784, 0.08, 0.04], ['square', 988, 988, 0.08, 0.04], ['square', 1319, 1319, 0.2, 0.04]],
        conta: [['sine', 660, 660, 0.14, 0.07]],
        vai: [['square', 988, 1319, 0.28, 0.06]],
        recorde: [['square', 784, 784, 0.1, 0.04], ['square', 988, 988, 0.1, 0.04], ['square', 1319, 1319, 0.2, 0.04]],
        aviso: [['sine', 880, 880, 0.12, 0.07], ['sine', 1320, 1320, 0.18, 0.07]],
      }[tipo] || [];
      var inicio = t;
      notas.forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        var comeca = tipo === 'bateu' ? t : inicio;
        o.type = n[0]; o.frequency.setValueAtTime(n[1], comeca); o.frequency.exponentialRampToValueAtTime(Math.max(20, n[2]), comeca + n[3]);
        g.gain.setValueAtTime(n[4], comeca); g.gain.exponentialRampToValueAtTime(0.0001, comeca + n[3]);
        o.connect(g); g.connect(audio.destination); o.start(comeca); o.stop(comeca + n[3] + 0.02);
        if (tipo !== 'bateu') inicio += n[3] * (tipo === 'latido' ? 1.6 : 0.85);
      });
    } catch (_) { /* sem som neste aparelho: o jogo segue */ }
  }

  /* ---- musiquinha: 8 compassos alegres em do maior (do, la menor, fa, sol), feita na hora pelo celular (nenhum
     arquivo baixado). Melodia quadrada, baixo triangular e um chiado leve no contratempo. Acelera com a moto ---- */
  var MELODIA = [
    72, 0, 76, 79, 76, 0, 72, 74, 76, 0, 74, 72, 74, 76, 0, 0,
    69, 0, 72, 76, 72, 0, 69, 71, 72, 0, 71, 69, 71, 72, 0, 0,
    65, 0, 69, 72, 69, 0, 65, 67, 69, 72, 74, 72, 69, 67, 0, 0,
    67, 71, 74, 79, 77, 76, 74, 71, 74, 0, 72, 71, 67, 0, 0, 0,
  ];
  var BAIXO = [48, 45, 41, 43];
  var chiado = null;
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
    var bpm = 132 + Math.min(30, Math.max(0, (J.vel - 12) * 1.5));
    var passo = 60 / bpm / 2; /* colcheia */
    while (m.proximo < audio.currentTime + 0.25) {
      var i = m.passo % 64;
      var nota = MELODIA[i];
      if (nota) notaMusica('square', nota, m.proximo, passo * 0.9, 0.022);
      /* baixo pulando: tonica, oitava e quinta */
      var raiz = BAIXO[Math.floor(i / 16)];
      var b = [raiz, 0, raiz + 12, 0, raiz, 0, raiz + 7, 0][i % 8];
      if (b) notaMusica('triangle', b, m.proximo, passo * 1.6, 0.05);
      if (i % 2 === 1 && chiado) {
        var f = audio.createBufferSource(), g = audio.createGain();
        f.buffer = chiado; g.gain.setValueAtTime(0.012, m.proximo); g.gain.exponentialRampToValueAtTime(0.0001, m.proximo + 0.05);
        f.connect(g); g.connect(m.saida); f.start(m.proximo); f.stop(m.proximo + 0.06);
      }
      m.proximo += passo;
      m.passo += 1;
    }
  }
  function musicaLigar() {
    if (!J || !J.som || !J.comMusica || J.musica) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      if (!chiado) {
        chiado = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.06), audio.sampleRate);
        var d = chiado.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
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
    return el('div', { class: 'jogo-opcao' }, [el('span', { text: 'Música' }), chave]);
  }

  function novaCorrida() {
    J.dist = 0; J.vel = 12; J.moedas = 0; J.bonus = 0; J.x = 0; J.alvo = 0; J.alt = 0; J.tPulo = -1; J.puloGuardado = 0;
    J.ima = 0; J.turbo = 0; J.escudo = false; J.imune = 0;
    J.combo = 0; J.mult = 1; J.maiorMult = 1; J.ultimaMoeda = 0; J.ultimaTroca = -9;
    J.tempo = 0; J.tremor = 0; J.clarao = 0; J.bateuEm = 0; J.inclina = 0; J.vaiAte = 0; J.conta = 0;
    J.obj = []; J.cena = []; J.part = []; J.textos = []; J.luzes = [];
    J.proxPadrao = 42; J.proxPlaca = 60; J.proxPoder = 320; J.proxKm = 1000;
    J.novoRecorde = false;
    for (var z = 4; z < LONGE; z += 8) { cenario(-1, z); cenario(1, z + 4); }
    J.proxCena = [LONGE + 4, LONGE + 8]; /* posicoes na rua (metros desde a largada), como proxPadrao */
  }

  /* ---- o que aparece na rua ---- */
  function sorteio(n) { return Math.floor(Math.random() * n); }
  function outraFaixa(evitar) { var l = [-1, 0, 1].filter(function (f) { return evitar.indexOf(f) < 0; }); return l[sorteio(l.length)]; }
  function poe(tipo, faixa, z, extra) { var o = { tipo: tipo, faixa: faixa, z: z, alt: 0 }; if (extra) for (var k in extra) o[k] = extra[k]; J.obj.push(o); return o; }
  function fileira(faixa, z, n, passo) { for (var i = 0; i < n; i++) poe('moeda', faixa, z + i * passo, { alt: 0.7 }); }

  /* um trecho da rua (z = distancia ate a moto); devolve onde o proximo pode comecar */
  function padrao(z) {
    var d = Math.min(1, J.dist / 2600);
    var r = Math.random();
    var a = [-1, 0, 1][sorteio(3)];
    var baixo = Math.random() < 0.5 ? 'cone' : 'buraco';
    var fim = z;
    if (r < 0.26 - d * 0.1) {
      /* um obstaculo e uma fileira de moedas em outra faixa */
      poe(Math.random() < 0.45 ? 'carro' : baixo, a, z, { cor: sorteio(6) });
      fileira(outraFaixa([a]), z - 4, 5, 2.6);
      fim = z + 6;
    } else if (r < 0.44) {
      /* dois obstaculos: a faixa livre tem as moedas */
      var b = outraFaixa([a]);
      poe(Math.random() < 0.6 ? 'carro' : baixo, a, z, { cor: sorteio(6) });
      poe(Math.random() < 0.5 ? 'carro' : baixo, b, z + (Math.random() < 0.5 ? 0 : 3), { cor: sorteio(6) });
      fileira(outraFaixa([a, b]), z - 3, 4, 2.6);
      fim = z + 8;
    } else if (r < 0.55) {
      /* lombada na rua inteira: pula, e as moedas fazem o arco do pulo */
      poe('lombada', 0, z);
      var f = [-1, 0, 1][sorteio(3)];
      for (var i = 0; i < 5; i++) poe('moeda', f, z - 4 + i * 2.2, { alt: 0.7 + Math.sin((i / 4) * Math.PI) * 1.3 });
      fim = z + 4;
    } else if (r < 0.66) {
      /* caminhao de banana e, mais adiante, um cone na faixa do lado */
      poe('caminhao', a, z);
      var livre = outraFaixa([a]);
      if (d > 0.25) { var c = outraFaixa([a, livre]); poe(baixo, c, z + 3); }
      fileira(livre, z, 6, 2.4);
      fim = z + 10;
    } else if (r < 0.75 && d > 0.08) {
      /* vira-lata caramelo atravessando a rua: desvia ou pula (ele late quando comeca a atravessar) */
      var lado = Math.random() < 0.5 ? -1 : 1;
      poe('cachorro', lado * 1.9, z, { vx: -lado * 1.55 });
      fileira(outraFaixa([]), z - 7, 5, 2.4);
      fim = z + 8;
    } else if (r < 0.87 || d < 0.35) {
      /* moedas que trocam de faixa */
      var p = outraFaixa([]);
      var q = p === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      fileira(p, z, 4, 2.6); fileira(q, z + 12, 4, 2.6);
      if (d > 0.15) poe(baixo, p, z + 14);
      fim = z + 22;
    } else {
      /* fila: dois carros alternados e um cone, para trocar de faixa duas vezes */
      var um = outraFaixa([]);
      var dois = outraFaixa([um]);
      var espaco = 11 + J.vel * 0.28;
      poe('carro', um, z, { cor: sorteio(6) });
      poe('carro', dois, z + espaco, { cor: sorteio(6) });
      poe(baixo, outraFaixa([um, dois]), z + espaco);
      fileira(um, z + espaco - 1, 3, 2.4);
      fim = z + espaco + 4;
    }
    /* um poder de vez em quando, numa faixa sem nada: ima, capacete ou turbo */
    if (J.dist > J.proxPoder) {
      var sorte = Math.random();
      poe(sorte < 0.4 ? 'ima' : sorte < 0.75 ? 'escudo' : 'turbo', outraFaixa([a]), z - 8, { alt: 0.9 });
      J.proxPoder = J.dist + 380 + sorteio(320);
    }
    /* o espaco ate o proximo diminui com o tempo, sem ficar impossivel */
    return fim + 12 + (1 - d) * 12 + J.vel * 0.4;
  }

  function cenario(lado, z) {
    var r = Math.random();
    var borda = 1.5 * FAIXA + 1.8;
    if (r < 0.5) J.cena.push({ tipo: 'bananeira', x: lado * (borda + 1.4 + Math.random() * 2.8), z: z });
    else if (r < 0.78) J.cena.push({ tipo: 'casa', x: lado * (borda + 5 + Math.random() * 2), z: z, cor: sorteio(5) });
    else J.cena.push({ tipo: 'poste', x: lado * (borda - 0.5), z: z, lado: lado });
  }

  /* ---- controles ---- */
  function mudarFaixa(dir) {
    if (J.fase !== 'jogando') return;
    var nova = Math.max(-1, Math.min(1, J.alvo + dir));
    if (nova === J.alvo) { J.tremor = Math.max(J.tremor, 0.08); return; }
    J.alvo = nova;
    J.ultimaTroca = J.tempo;
  }
  function pular() {
    if (J.fase !== 'jogando') return;
    if (J.tPulo >= 0) { if (PULO_TEMPO - J.tPulo < 0.14) J.puloGuardado = 0.14; return; }
    J.tPulo = 0; som('pulo');
  }

  /* ---- um passo do jogo ---- */
  function atualizar(dt) {
    J.tempo += dt;
    J.vel = (12 + 19 * (1 - Math.exp(-J.dist / 1500))) * (J.turbo > 0 ? 1.5 : 1);
    var anda = J.vel * dt;
    J.dist += anda;

    /* faixa: vai ate a nova rapido, inclinando a moto */
    var dif = J.alvo - J.x;
    J.x += dif * Math.min(1, dt * 15);
    if (Math.abs(J.alvo - J.x) < 0.01) J.x = J.alvo;
    J.inclina += ((-dif * 0.35) - J.inclina) * Math.min(1, dt * 12);

    /* pulo */
    if (J.tPulo >= 0) {
      J.tPulo += dt;
      var p = J.tPulo / PULO_TEMPO;
      if (p >= 1) { J.tPulo = -1; J.alt = 0; if (J.puloGuardado > 0) { J.puloGuardado = 0; J.tPulo = 0; som('pulo'); } }
      else J.alt = 4 * PULO_ALTURA * p * (1 - p);
    }
    if (J.puloGuardado > 0) J.puloGuardado -= dt;

    /* poderes e combo */
    if (J.ima > 0) J.ima -= dt;
    if (J.imune > 0) J.imune -= dt;
    if (J.turbo > 0) { J.turbo -= dt; if (J.turbo <= 0) J.imune = Math.max(J.imune, 1); /* um respiro depois do turbo */ }
    if (J.combo > 0 && J.tempo - J.ultimaMoeda > 3) { J.combo = 0; J.mult = 1; }
    if (J.dist >= J.proxKm) { aviso(numero(J.proxKm / 1000) + ' km!'); som('marco'); J.proxKm += 1000; }

    /* o que vem pela frente */
    while (J.proxPadrao < J.dist + LONGE) J.proxPadrao = J.dist + padrao(J.proxPadrao - J.dist);
    for (var s = 0; s < 2; s++) {
      while (J.proxCena[s] < J.dist + LONGE) { cenario(s === 0 ? -1 : 1, J.proxCena[s] - J.dist); J.proxCena[s] += 6 + Math.random() * 7; }
    }
    if (J.dist + LONGE > J.proxPlaca) { J.cena.push({ tipo: 'placa', x: (Math.random() < 0.5 ? -1 : 1) * (1.5 * FAIXA + 3.2), z: J.proxPlaca - J.dist }); J.proxPlaca += 900 + sorteio(500); }

    var i, o, t;
    for (i = J.cena.length - 1; i >= 0; i--) { J.cena[i].z -= anda; if (J.cena[i].z < -D0) J.cena.splice(i, 1); }

    for (i = J.obj.length - 1; i >= 0; i--) {
      o = J.obj[i];
      o.z -= anda;
      t = OBSTACULOS[o.tipo];
      if (t) {
        if (o.z < -t.comp - 3) { J.obj.splice(i, 1); continue; }
        /* o cachorro comeca a atravessar uns 2 segundos antes de chegar na moto */
        if (o.tipo === 'cachorro') {
          if (!o.anda && o.z < J.vel * 2.3 + 4) { o.anda = true; som('latido'); }
          if (o.anda) o.faixa += o.vx * dt;
        }
        var naRua = t.todas || Math.abs(o.faixa) <= 1.4;
        var mesmaFaixa = t.todas || Math.abs(o.faixa - J.x) < 0.55;
        if (!o.passou && naRua && mesmaFaixa && o.z < 0.6 && o.z + t.comp > -0.2) {
          if (t.pula && J.alt > 0.45) continue;
          /* turbo (ou o respiro depois dele): derruba. Capacete: gasta ele e segue */
          if (J.turbo > 0 || J.imune > 0) { derrubar(o, J.turbo > 0); J.obj.splice(i, 1); continue; }
          if (J.escudo) { J.escudo = false; J.imune = 1.2; derrubar(o, false); som('escudo'); texto('O capacete aguentou!', '#90CAF9'); J.obj.splice(i, 1); continue; }
          bater(); return;
        }
        if (!o.passou && o.z + t.comp < -0.2) {
          o.passou = true;
          /* desviou em cima da hora de um carro ou caminhao: bonus */
          if (!t.pula && Math.abs(o.faixa - J.x) < 1.35 && J.tempo - J.ultimaTroca < 0.6 && J.turbo <= 0) { J.bonus += 25; texto('Por um triz! +25', '#FFFFFF'); som('triz'); }
        }
        continue;
      }
      if (o.z < -2) { J.obj.splice(i, 1); continue; }
      /* ima: as moedas perto vem para a moto */
      if (o.tipo === 'moeda' && J.ima > 0 && o.z < 16) {
        var puxa = Math.min(1, dt * 7);
        o.faixa += (J.x - o.faixa) * puxa;
        o.alt += (J.alt + 0.7 - o.alt) * puxa;
        o.z -= Math.max(0, o.z) * puxa * 0.5;
      }
      if (Math.abs(o.faixa - J.x) < 0.6 && o.z < 0.8 && o.z > -0.8 && Math.abs(J.alt + 0.7 - o.alt) < 1.05) {
        J.obj.splice(i, 1);
        if (o.tipo === 'moeda') pegarMoeda();
        else pegarPoder(o.tipo);
      }
    }

    /* fogo do turbo saindo do escapamento */
    if (J.turbo > 0 && !menosMovimento) {
      var cx = xDe(J.x * FAIXA, 1), cy = J.base - J.alt * J.ppm - 0.2 * J.ppm;
      J.part.push({ x: cx + (Math.random() - 0.5) * 10, y: cy, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 80, vida: 0.3, cor: Math.random() < 0.5 ? '#FFB300' : '#FF6F00', leve: true });
    }
    for (i = J.part.length - 1; i >= 0; i--) {
      var pa = J.part[i];
      pa.vida -= dt; if (pa.vida <= 0) { J.part.splice(i, 1); continue; }
      pa.x += pa.vx * dt; pa.y += pa.vy * dt; if (!pa.leve) pa.vy += 900 * dt;
    }
    for (i = J.textos.length - 1; i >= 0; i--) {
      var tx = J.textos[i];
      tx.vida -= dt; tx.y -= 60 * dt;
      if (tx.vida <= 0) J.textos.splice(i, 1);
    }
    if (J.tremor > 0) J.tremor -= dt;
    atualizarPlacar();
  }

  function pegarMoeda() {
    J.moedas += 1;
    J.combo += 1;
    J.ultimaMoeda = J.tempo;
    /* a cada 8 moedas seguidas (sem ficar 3 segundos sem pegar), o multiplicador sobe: ate x5 */
    var mult = Math.min(5, 1 + Math.floor(J.combo / 8));
    if (mult > J.mult) { texto('x' + mult + '!', '#C6FF7A'); som('mult'); }
    J.mult = mult;
    J.maiorMult = Math.max(J.maiorMult, mult);
    J.bonus += 10 * J.mult;
    som('moeda');
    brilho('#FFD84A');
  }
  function pegarPoder(tipo) {
    if (tipo === 'ima') { J.ima = PODERES.ima; som('ima'); texto('Ímã!', '#FF8A80'); brilho('#FF8A80'); }
    else if (tipo === 'turbo') { J.turbo = PODERES.turbo; som('turbo'); texto('Turbo!', '#FFD54F'); brilho('#FFD54F'); }
    else { J.escudo = true; som('escudo'); texto('Capacete!', '#90CAF9'); brilho('#90CAF9'); }
  }

  function brilho(cor) {
    var x = xDe(J.x * FAIXA, 1);
    var y = J.base - (J.alt + 0.9) * J.ppm;
    for (var i = 0; i < 7; i++) J.part.push({ x: x, y: y, vx: (Math.random() - 0.5) * 360, vy: -220 - Math.random() * 260, vida: 0.45, cor: cor });
  }
  /* obstaculo derrubado (turbo ou capacete): os pedacos voam para os lados */
  function derrubar(o, turbo) {
    var x = xDe(o.faixa * FAIXA, 1), y = J.base - 0.6 * J.ppm;
    var cor = o.tipo === 'carro' ? CORES_CARRO[o.cor || 0] : (COR_PEDACO[o.tipo] || '#FFFFFF');
    for (var i = 0; i < 12; i++) J.part.push({ x: x, y: y, vx: (Math.random() - 0.5) * 700, vy: -260 - Math.random() * 380, vida: 0.6, cor: i % 3 ? cor : '#FFFFFF' });
    som('quebra');
    if (turbo) { J.bonus += 15; texto('+15', '#FFD54F'); }
    J.tremor = Math.max(J.tremor, menosMovimento ? 0 : 0.12);
  }
  function texto(t, cor) {
    var y = J.base - (J.alt + 2.7) * J.ppm;
    for (var i = 0; i < J.textos.length; i++) if (J.textos[i].vida > 0.55) y = Math.min(y, J.textos[i].y - 30);
    J.textos.push({ t: t, x: xDe(J.x * FAIXA, 1), y: y, vida: 1, cor: cor || '#FFFFFF' });
  }

  function bater() {
    J.fase = 'batendo'; J.bateuEm = J.tempo;
    musicaParar();
    J.tremor = menosMovimento ? 0 : 0.4; J.clarao = 0.18;
    som('bateu');
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (_) { /* sem vibrar */ } }
    setTimeout(function () { if (J && J.fase === 'batendo') fimDeJogo(); }, 850);
  }

  function pontos() { return Math.floor(J.dist) + J.bonus; }

  /* ================================================================ desenho de cada quadro ================ */

  /* a projecao: quanto mais longe (z), menor e mais perto do horizonte. Sem criar objeto a cada chamada */
  function kDe(z) { return D0 / (z + D0); }
  function xDe(xm, k) { return J.cx + (xm - J.camX) * J.ppm * k; }
  function yDe(k) { return J.hor + (J.base - J.hor) * k; }
  /* faixa no chao entre as distancias de k1 e k2, de xa ate xb (metros) */
  function tira(ctx, xa, xb, k1, k2, cor) {
    var y1 = yDe(k1), y2 = yDe(k2);
    ctx.beginPath();
    ctx.moveTo(xDe(xa, k1), y1); ctx.lineTo(xDe(xb, k1), y1); ctx.lineTo(xDe(xb, k2), y2); ctx.lineTo(xDe(xa, k2), y2);
    ctx.closePath(); ctx.fillStyle = cor; ctx.fill();
  }

  /* ---- ceu: dia, por do sol e noite (tres fundos guardados; na passagem, um aparece por cima do outro) ---- */
  var CEUS = {
    dia: { ceu: ['#6CC6F5', '#D9F2FF'], astro: ['#FFE27A', 0.78, 0.32, 24, 'rgba(255,240,170,'], morros: ['#A9D98C', '#7CC35A'], nevoa: 'rgba(217,242,255,' },
    tarde: { ceu: ['#6E5BA8', '#F2706B', '#FFC98B'], astro: ['#FF8C42', 0.7, 0.78, 34, 'rgba(255,170,90,'], morros: ['#C58B6B', '#9E6B52'], nevoa: 'rgba(255,201,139,' },
    noite: { ceu: ['#0B1437', '#27366B'], astro: ['#F4F1DE', 0.2, 0.3, 18, 'rgba(244,241,222,'], morros: ['#26345E', '#1A2546'], nevoa: 'rgba(39,54,107,', estrelas: true },
  };
  function montarFundo(nome) {
    var d = CEUS[nome];
    var c = document.createElement('canvas');
    c.width = Math.ceil(J.w * J.dpr); c.height = Math.ceil((J.hor + 2) * J.dpr);
    var x = c.getContext('2d');
    x.scale(J.dpr, J.dpr);
    var ceu = x.createLinearGradient(0, 0, 0, J.hor);
    d.ceu.forEach(function (cor, i) { ceu.addColorStop(i / (d.ceu.length - 1), cor); });
    x.fillStyle = ceu; x.fillRect(0, 0, J.w, J.hor + 2);
    if (d.estrelas) {
      x.fillStyle = '#FFFFFF';
      for (var e = 0; e < 60; e++) { x.globalAlpha = 0.3 + ((e * 37) % 10) / 14; x.fillRect((e * 97) % J.w, ((e * 53) % 100) / 100 * J.hor * 0.85, e % 7 ? 1.5 : 2.5, e % 7 ? 1.5 : 2.5); }
      x.globalAlpha = 1;
    }
    var sx = J.w * d.astro[1], sy = J.hor * d.astro[2], sr = d.astro[3];
    var halo = x.createRadialGradient(sx, sy, 4, sx, sy, sr * 3);
    halo.addColorStop(0, d.astro[4] + '0.85)'); halo.addColorStop(1, d.astro[4] + '0)');
    x.fillStyle = halo; x.fillRect(sx - sr * 3, sy - sr * 3, sr * 6, sr * 6);
    bola(x, sx, sy, sr); x.fillStyle = d.astro[0]; x.fill();
    if (nome === 'noite') { x.fillStyle = 'rgba(0,0,0,0.08)'; bola(x, sx - 5, sy - 4, 4); x.fill(); bola(x, sx + 6, sy + 5, 3); x.fill(); }
    /* morros (a Serra, la no fundo) */
    [[0.55, d.morros[0], 44, 0.011], [0.8, d.morros[1], 26, 0.019]].forEach(function (m) {
      x.beginPath(); x.moveTo(0, J.hor + 2);
      for (var px = 0; px <= J.w + 10; px += 10) {
        var yy = J.hor - m[2] * m[0] - Math.sin(px * m[3] + m[0] * 7) * m[2] * 0.5 - Math.sin(px * m[3] * 2.3) * m[2] * 0.25;
        x.lineTo(px, yy);
      }
      x.lineTo(J.w, J.hor + 2); x.closePath(); x.fillStyle = m[1]; x.fill();
    });
    var nevoa = J.ctx.createLinearGradient(0, J.hor, 0, J.hor + (J.base - J.hor) * 0.2);
    nevoa.addColorStop(0, d.nevoa + '0.95)'); nevoa.addColorStop(1, d.nevoa + '0)');
    return { fundo: c, nevoa: nevoa };
  }
  /* em que parte do dia a corrida esta: o ceu de agora, o proximo e quanto ja passou para ele */
  var FASES_DIA = [[0, 'dia'], [1300, 'dia', 'tarde', 200], [1500, 'tarde'], [2100, 'tarde', 'noite', 200], [2300, 'noite'], [3300, 'noite', 'dia', 300]];
  function momento() {
    var m = J.dist % CICLO;
    var f = FASES_DIA[0];
    for (var i = FASES_DIA.length - 1; i >= 0; i--) if (m >= FASES_DIA[i][0]) { f = FASES_DIA[i]; break; }
    var t = f[2] ? Math.min(1, (m - f[0]) / f[3]) : 0;
    J.ceuA = f[1]; J.ceuB = f[2] || f[1]; J.ceuT = t;
    J.noite = (J.ceuA === 'noite' ? 1 - t : 0) + (J.ceuB === 'noite' ? t : 0);
    J.tarde = (J.ceuA === 'tarde' ? 1 - t : 0) + (J.ceuB === 'tarde' ? t : 0);
    if (J.ceuA === J.ceuB) { J.noite = J.ceuA === 'noite' ? 1 : 0; J.tarde = J.ceuA === 'tarde' ? 1 : 0; }
  }

  function nuvens(ctx) {
    var a = 1 - 0.92 * J.noite;
    ctx.fillStyle = J.tarde > 0.5 ? 'rgba(255,225,210,' + (0.9 * a) + ')' : 'rgba(255,255,255,' + (0.9 * a) + ')';
    for (var i = 0; i < 4; i++) {
      var w = J.w + 240;
      var x = ((i * 173 + J.tempo * (8 + i * 3) + (J.dist * 0.02)) % w) - 120;
      var y = J.hor * (0.16 + (i % 3) * 0.14);
      var e = 0.7 + (i % 2) * 0.4;
      bola(ctx, x, y, 16 * e); ctx.fill(); bola(ctx, x + 18 * e, y - 8 * e, 20 * e); ctx.fill(); bola(ctx, x + 40 * e, y, 15 * e); ctx.fill();
      ctx.fillRect(x, y, 40 * e, 15 * e);
    }
  }

  function rua(ctx) {
    var borda = 1.5 * FAIXA;
    var calcada = borda + 1.8;
    var perto = J.zPerto;
    ctx.fillStyle = '#8CCB55'; ctx.fillRect(0, J.hor, J.w, J.h - J.hor);
    var kPerto = kDe(perto), kLonge = kDe(LONGE);
    tira(ctx, -calcada, calcada, kPerto, kLonge, '#E3DCCB');
    tira(ctx, -borda, borda, kPerto, kLonge, '#4B5058');
    /* pedacos: meio-fio pintado, faixas tracejadas e o tom do asfalto (andam com a moto: e o que da a velocidade) */
    var primeiro = Math.floor((J.dist + perto) / SEG);
    for (var n = primeiro; ; n++) {
      var z1 = n * SEG - J.dist, z2 = z1 + SEG;
      if (z1 > LONGE) break;
      if (z2 < perto) continue;
      var par = n % 2 === 0;
      var k1 = kDe(Math.max(z1, perto)), k2 = kDe(Math.min(z2, LONGE));
      if (par) tira(ctx, -borda, borda, k1, k2, '#484D55');
      tira(ctx, -borda - 0.35, -borda, k1, k2, par ? '#F2F2F2' : '#D64541');
      tira(ctx, borda, borda + 0.35, k1, k2, par ? '#F2F2F2' : '#D64541');
      if (par && z1 < 70) {
        tira(ctx, -FAIXA * 0.5 - 0.07, -FAIXA * 0.5 + 0.07, k1, k2, 'rgba(255,255,255,0.85)');
        tira(ctx, FAIXA * 0.5 - 0.07, FAIXA * 0.5 + 0.07, k1, k2, 'rgba(255,255,255,0.85)');
      }
    }
  }
  /* nevoa leve no horizonte: da profundidade e esconde o que aparece la no fundo */
  function nevoa(ctx) {
    var hN = (J.base - J.hor) * 0.2;
    ctx.fillStyle = J.ceus[J.ceuA].nevoa; ctx.fillRect(0, J.hor, J.w, hN);
    if (J.ceuT > 0) { ctx.globalAlpha = J.ceuT; ctx.fillStyle = J.ceus[J.ceuB].nevoa; ctx.fillRect(0, J.hor, J.w, hN); ctx.globalAlpha = 1; }
  }

  function chato(ctx, o) {
    var t = OBSTACULOS[o.tipo];
    if (o.z > LONGE || o.z + t.comp < J.zPerto) return;
    var borda = 1.5 * FAIXA;
    if (o.tipo === 'buraco') {
      var xm = o.faixa * FAIXA;
      var ka = kDe(o.z), kb = kDe(o.z + t.comp);
      var ya = yDe(ka), yb = yDe(kb), xa = xDe(xm, ka);
      var rx = 0.95 * J.ppm * (ka + kb) / 2;
      var cy = (ya + yb) / 2, ry = Math.max(1.5, (ya - yb) / 2);
      ctx.beginPath(); ctx.ellipse(xa, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = '#2B2F35'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(xa, cy + ry * 0.15, rx * 0.8, ry * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = '#1E2126'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(xa - rx * 0.25, cy + ry * 0.1, rx * 0.35, ry * 0.25, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(120,180,230,0.45)'; ctx.fill();
    } else if (o.tipo === 'lombada') {
      var partes = 8;
      var k1 = kDe(Math.max(o.z, J.zPerto)), k2 = kDe(Math.min(o.z + t.comp, LONGE));
      for (var i = 0; i < partes; i++) tira(ctx, -borda + (2 * borda) * i / partes, -borda + (2 * borda) * (i + 1) / partes, k1, k2, i % 2 ? '#222222' : '#F9D71C');
      /* a frente da lombada, levantada um pouco */
      var alto = 0.16 * J.ppm * k1;
      var xe = xDe(-borda, k1);
      ctx.fillStyle = '#C9A800'; ctx.fillRect(xe, yDe(k1) - alto, xDe(borda, k1) - xe, alto);
    }
  }

  function desenharEmPe(ctx, spr, xm, z, largura, altura, ergue, espelhar) {
    if (z > LONGE || z < J.zPerto) return;
    var k = kDe(z), px = xDe(xm, k);
    var w = largura * J.ppm * k, h = altura * J.ppm * k;
    if (px + w < 0 || px - w > J.w) return;
    var y = yDe(k) - (ergue || 0) * J.ppm * k;
    var some = z > LONGE - 25 ? Math.max(0, (LONGE - z) / 25) : 1;
    if (some < 1) ctx.globalAlpha = some;
    if (espelhar) { ctx.save(); ctx.translate(px, 0); ctx.scale(-1, 1); ctx.drawImage(spr, -w / 2, y - h, w, h); ctx.restore(); }
    else ctx.drawImage(spr, px - w / 2, y - h, w, h);
    if (some < 1) ctx.globalAlpha = 1;
  }

  function sombra(ctx, xm, z, raio) {
    if (z > LONGE || z < J.zPerto) return;
    var k = kDe(z);
    ctx.beginPath(); ctx.ellipse(xDe(xm, k), yDe(k), raio * J.ppm * k, raio * J.ppm * k * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill();
  }

  /* luz da noite (guardada para somar depois do escurecer): posicao em metros, altura e tamanho; 0 = amarela, 1 = vermelha */
  function luz(xm, z, altura, tamanho, tipo) {
    if (J.noite < 0.05 || z > LONGE - 10 || z < J.zPerto) return;
    var k = kDe(z);
    J.luzes.push(xDe(xm, k), yDe(k) - altura * J.ppm * k, tamanho * J.ppm * k, tipo);
  }

  function desenharJogador(ctx) {
    var xm = J.x * FAIXA;
    var px = xDe(xm, 1), py = J.base;
    var larg = 1.5 * J.ppm, alt = 2.35 * J.ppm; /* a moto maior que o carro visto de longe: o jogador se acha na hora */
    var sobe = J.alt * J.ppm;
    var treme = J.fase === 'jogando' ? Math.sin(J.tempo * 38) * 0.6 : 0;
    ctx.beginPath(); ctx.ellipse(px, py, 0.72 * J.ppm * (1 - J.alt * 0.2), 0.15 * J.ppm, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.26 - J.alt * 0.08) + ')'; ctx.fill();
    /* piscando: o respiro depois do turbo ou do capacete */
    var pisca = J.imune > 0 && J.turbo <= 0 && Math.floor(J.tempo * 12) % 2 === 0;
    if (pisca) ctx.globalAlpha = 0.45;
    ctx.save();
    ctx.translate(px, py - sobe + treme);
    var gira = J.inclina;
    if (J.fase === 'batendo' || J.fase === 'fim') gira = Math.min(0.55, (J.tempo - J.bateuEm) * 2.4) * (J.x >= 0 ? 1 : -1);
    ctx.rotate(gira);
    ctx.drawImage(SP.jogador, -larg / 2, -alt, larg, alt);
    ctx.restore();
    ctx.globalAlpha = 1;
    var meio = py - sobe - alt * 0.5;
    if (J.escudo) {
      ctx.beginPath(); ctx.ellipse(px, meio, larg * 0.78, alt * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100,181,246,0.14)'; ctx.fill();
      ctx.strokeStyle = 'rgba(100,181,246,0.75)'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (J.ima > 0 && (J.ima > 2 || Math.floor(J.ima * 8) % 2 === 0)) {
      ctx.beginPath(); ctx.ellipse(px, meio, larg * 0.88, alt * 0.66, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(229,57,53,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([8, 7]); ctx.lineDashOffset = -J.tempo * 30; ctx.stroke(); ctx.setLineDash([]);
    }
    if (J.turbo > 0 && (J.turbo > 1.2 || Math.floor(J.turbo * 8) % 2 === 0)) {
      ctx.beginPath(); ctx.ellipse(px, meio, larg * 0.95, alt * 0.7, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,179,0,0.8)'; ctx.lineWidth = 4; ctx.stroke();
    }
    luz(xm, 0.02, 0.72 + J.alt, 1.0, 1);
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

  function textoGrande(ctx, t, x, y, tam, cor, escala) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(escala, escala);
    ctx.font = '900 ' + tam + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(4, tam * 0.12); ctx.strokeStyle = 'rgba(15,61,46,0.85)'; ctx.lineJoin = 'round';
    ctx.strokeText(t, 0, 0); ctx.fillStyle = cor; ctx.fillText(t, 0, 0);
    ctx.restore();
  }

  var ordem = [];
  function desenhar() {
    var ctx = J.ctx;
    ctx.setTransform(J.dpr, 0, 0, J.dpr, 0, 0);
    momento();
    var alvoCam = J.x * FAIXA * 0.5;
    J.camX += (alvoCam - J.camX) * 0.2;
    if (J.tremor > 0) ctx.translate((Math.random() - 0.5) * 10 * J.tremor * 2, (Math.random() - 0.5) * 8 * J.tremor * 2);
    ctx.drawImage(J.ceus[J.ceuA].fundo, 0, 0, J.w, J.hor + 2);
    if (J.ceuT > 0) { ctx.globalAlpha = J.ceuT; ctx.drawImage(J.ceus[J.ceuB].fundo, 0, 0, J.w, J.hor + 2); ctx.globalAlpha = 1; }
    nuvens(ctx);
    rua(ctx);
    nevoa(ctx);
    J.luzes.length = 0;

    /* no chao primeiro (buraco e lombada), depois o que fica em pe, do mais longe para o mais perto */
    var i, o;
    for (i = 0; i < J.obj.length; i++) { o = J.obj[i]; if (o.tipo === 'buraco' || o.tipo === 'lombada') chato(ctx, o); }
    ordem.length = 0;
    for (i = 0; i < J.cena.length; i++) ordem.push(J.cena[i]);
    for (i = 0; i < J.obj.length; i++) { o = J.obj[i]; if (o.tipo !== 'buraco' && o.tipo !== 'lombada') ordem.push(o); }
    ordem.push(JOGADOR);
    ordem.sort(function (a, b) { return b.z - a.z; });
    for (i = 0; i < ordem.length; i++) {
      o = ordem[i];
      var fx = o.faixa * FAIXA;
      switch (o.tipo) {
        case 'jogador': desenharJogador(ctx); break;
        case 'bananeira': desenharEmPe(ctx, SP.bananeira, o.x, o.z, 3.4, 4.6); break;
        case 'casa':
          desenharEmPe(ctx, SP.casas[o.cor], o.x, o.z, 6.4, 5.3);
          luz(o.x - 1.65, o.z, 2.55, 2.2, 0); luz(o.x + 1.65, o.z, 2.55, 2.2, 0);
          break;
        case 'poste':
          var px = o.x + (o.lado < 0 ? 0.9 : -0.9);
          desenharEmPe(ctx, SP.poste, px, o.z, 1.6, 5.2, 0, o.lado > 0);
          luz(px + (o.lado < 0 ? 0.54 : -0.54), o.z, 4.3, 4.2, 0);
          break;
        case 'placa': desenharEmPe(ctx, SP.placa, o.x, o.z, 3.6, 2.55); break;
        case 'cone': sombra(ctx, fx, o.z, 0.5); desenharEmPe(ctx, SP.cone, fx, o.z, 0.75, 1.0); break;
        case 'cachorro':
          sombra(ctx, fx, o.z, 0.6);
          desenharEmPe(ctx, SP.cachorro[o.anda && Math.floor(J.tempo * 9) % 2 ? 1 : 0], fx, o.z, 1.25, 0.9, 0, o.vx < 0);
          break;
        case 'carro':
          sombra(ctx, fx, o.z, 1.1); desenharEmPe(ctx, SP.carros[o.cor || 0], fx, o.z, 1.95, 1.62);
          luz(fx - 0.66, o.z, 0.72, 1.1, 1); luz(fx + 0.66, o.z, 0.72, 1.1, 1);
          break;
        case 'caminhao':
          sombra(ctx, fx, o.z, 1.2); desenharEmPe(ctx, SP.caminhao, fx, o.z, 2.2, 2.75);
          luz(fx - 0.8, o.z, 0.55, 1.2, 1); luz(fx + 0.8, o.z, 0.55, 1.2, 1);
          break;
        case 'moeda':
          if (o.z <= LONGE && o.z >= J.zPerto) {
            var gira = Math.abs(Math.cos(J.tempo * 5 + o.z * 0.4));
            var km = kDe(o.z);
            var r = 0.36 * J.ppm * km;
            var y = yDe(km) - o.alt * J.ppm * km;
            var w = Math.max(r * 0.25, r * 2 * gira);
            ctx.drawImage(SP.moeda, xDe(fx, km) - w / 2, y - r, w, r * 2);
          }
          break;
        case 'ima': case 'turbo': case 'escudo':
          desenharEmPe(ctx, SP[o.tipo], fx, o.z, 0.95, 0.95, o.alt + Math.sin(J.tempo * 4) * 0.12);
          break;
      }
    }

    /* por do sol e noite: a cidade escurece (o ceu ja vem pintado) e as luzes acendem por cima */
    if (J.tarde > 0.01) { ctx.fillStyle = 'rgba(255,120,50,' + (0.1 * J.tarde) + ')'; ctx.fillRect(-20, J.hor, J.w + 40, J.h - J.hor + 20); }
    if (J.noite > 0.01) {
      ctx.fillStyle = 'rgba(12,20,56,' + (0.46 * J.noite) + ')'; ctx.fillRect(-20, J.hor, J.w + 40, J.h - J.hor + 20);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = J.noite;
      for (i = 0; i < J.luzes.length; i += 4) {
        var tam = J.luzes[i + 2];
        ctx.drawImage(J.luzes[i + 3] ? SP.luzVermelha : SP.luz, J.luzes[i] - tam / 2, J.luzes[i + 1] - tam / 2, tam, tam);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* brilhos, pedacos e o fogo do turbo */
    for (i = 0; i < J.part.length; i++) {
      var pa = J.part[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, pa.vida / 0.45));
      ctx.fillStyle = pa.cor; ctx.fillRect(pa.x - 3, pa.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    /* linhas de velocidade: mais fortes no turbo */
    if (J.fase === 'jogando' && (J.vel > 21 || J.turbo > 0) && !menosMovimento) {
      var forca = J.turbo > 0 ? 1 : Math.min(1, (J.vel - 21) / 9);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.38 * forca) + ')'; ctx.lineWidth = J.turbo > 0 ? 3 : 2;
      var nLinhas = J.turbo > 0 ? 10 : 6;
      for (i = 0; i < nLinhas; i++) {
        var lado = i % 2 ? 1 : -1;
        var fase = (J.tempo * (J.turbo > 0 ? 3.2 : 2.2) + i * 0.37) % 1;
        var lx = J.w / 2 + lado * J.w * (0.26 + (i % 5) * 0.05);
        var ly = J.hor + (J.h - J.hor) * fase;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + lado * 14 * fase, ly + 40 + 60 * fase); ctx.stroke();
      }
    }
    /* textos que sobem (+25, x2!, Turbo!) */
    for (i = 0; i < J.textos.length; i++) {
      var tx = J.textos[i];
      ctx.globalAlpha = Math.min(1, tx.vida * 2);
      textoGrande(ctx, tx.t, tx.x, tx.y, 22, tx.cor, 1 + (1 - tx.vida) * 0.15);
    }
    ctx.globalAlpha = 1;
    if (J.fase === 'jogando' || J.fase === 'contagem') poderesNaTela(ctx);
    /* contagem: 3, 2, 1 e o "Vai!" */
    var meioY = J.hor + (J.base - J.hor) * 0.3;
    if (J.fase === 'contagem') {
      var n = Math.ceil(J.conta);
      var pop = 1 + (J.conta - Math.floor(J.conta)) * 0.5;
      textoGrande(ctx, String(n), J.w / 2, meioY, 96, '#FFFFFF', pop);
    } else if (J.vaiAte > J.tempo && J.fase === 'jogando') {
      ctx.globalAlpha = Math.min(1, (J.vaiAte - J.tempo) * 2.5);
      textoGrande(ctx, 'Vai!', J.w / 2, meioY, 84, '#C6FF7A', 1 + (0.7 - (J.vaiAte - J.tempo)) * 0.4);
      ctx.globalAlpha = 1;
    }
    if (J.clarao > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (J.clarao * 3) + ')'; ctx.fillRect(-20, -20, J.w + 40, J.h + 40); J.clarao -= 1 / 60; }
  }
  var JOGADOR = { tipo: 'jogador', z: 0 };

  /* ================================================================ laco ===================================== */

  function quadro(t) {
    if (!J || !J.vivo) return;
    J.raf = 0;
    var dt = J.ult ? Math.min(0.034, (t - J.ult) / 1000) : 0.016;
    J.ult = t;
    if (J.fase === 'jogando') atualizar(dt);
    else if (J.fase === 'inicio') { J.tempo += dt; J.dist += 7 * dt; rolarCenario(7 * dt); }
    else if (J.fase === 'contagem') contar(dt);
    else if (J.fase === 'batendo') { J.tempo += dt; if (J.tremor > 0) J.tremor -= dt; }
    desenhar();
    /* parado (pausa, fim) ou escondido: nao gasta bateria redesenhando a mesma coisa */
    if (J && (J.fase === 'jogando' || J.fase === 'inicio' || J.fase === 'batendo' || J.fase === 'contagem')) pedirQuadro();
  }
  function contar(dt) {
    J.tempo += dt;
    var antes = Math.ceil(J.conta);
    J.conta -= dt;
    if (J.conta <= 0) {
      J.fase = 'jogando'; J.vaiAte = J.tempo + 0.7; som('vai');
      if (!J.jaJogou) { J.jaJogou = true; mostrarDicaRapida(); }
    } else if (Math.ceil(J.conta) < antes) som('conta');
  }
  function rolarCenario(anda) {
    for (var s = 0; s < 2; s++) { while (J.proxCena[s] < J.dist + LONGE) { cenario(s === 0 ? -1 : 1, J.proxCena[s] - J.dist); J.proxCena[s] += 6 + Math.random() * 7; } }
    for (var i = J.cena.length - 1; i >= 0; i--) { J.cena[i].z -= anda; if (J.cena[i].z < -D0) J.cena.splice(i, 1); }
  }
  function pedirQuadro() { if (J && J.vivo && !J.raf && !document.hidden) J.raf = requestAnimationFrame(quadro); }

  function medir() {
    var r = J.raiz.getBoundingClientRect();
    J.w = Math.max(200, r.width); J.h = Math.max(300, r.height);
    J.dpr = Math.min(window.devicePixelRatio || 1, 2);
    J.canvas.width = Math.round(J.w * J.dpr); J.canvas.height = Math.round(J.h * J.dpr);
    J.hor = J.h * 0.36;
    J.base = J.h * 0.86;
    J.cx = J.w / 2;
    var faixaPx = Math.min(J.w * 0.29, J.h * 0.2, 170);
    J.ppm = faixaPx / FAIXA;
    var kBaixo = (J.h - J.hor) / (J.base - J.hor);
    J.zPerto = D0 / kBaixo - D0;
    /* a barra do iPhone embaixo: os indicadores dos poderes ficam acima dela */
    var sb = 0;
    try { sb = parseFloat(getComputedStyle(J.raiz).getPropertyValue('--seguro-baixo')) || 0; } catch (_) { sb = 0; }
    J.baixoSeguro = sb;
    J.ceus = { dia: montarFundo('dia'), tarde: montarFundo('tarde'), noite: montarFundo('noite') };
    J.ult = 0;
    if (!J.raf) { desenhar(); pedirQuadro(); }
  }

  /* ================================================================ telas (DOM) ============================= */

  function atualizarPlacar() {
    var p = pontos();
    if (p !== J.pontosVistos) { J.pontosVistos = p; J.elPontos.textContent = numero(p); }
    if (J.moedas !== J.moedasVistas) { J.moedasVistas = J.moedas; J.elMoedas.textContent = numero(J.moedas); }
    if (J.mult !== J.multVisto) {
      J.multVisto = J.mult;
      J.elMult.textContent = 'x' + J.mult;
      J.elMult.hidden = J.mult <= 1;
      J.elMult.classList.remove('pula'); void J.elMult.offsetWidth; J.elMult.classList.add('pula');
    }
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
    var c = el('canvas', { class: 'jogo-poder-ico', width: 64, height: 64, 'aria-hidden': 'true' });
    try { c.getContext('2d').drawImage(spr, 0, 0, 64, 64); } catch (_) { /* sem desenho */ }
    return c;
  }

  function telaInicio() {
    J.fase = 'inicio';
    J.elTopo.hidden = true;
    var toque = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    var dicas = el('div', { class: 'jogo-dicas' }, [
      el('div', { class: 'jogo-dica' }, [icone('lados'), el('span', { text: toque ? 'Arraste para o lado: troca de faixa' : 'Setas para o lado: troca de faixa' })]),
      el('div', { class: 'jogo-dica' }, [icone('cima'), el('span', { text: toque ? 'Arraste para cima: pula' : 'Seta para cima ou espaço: pula' })]),
    ]);
    var poderes = el('div', { class: 'jogo-poderes' }, [
      el('div', { class: 'jogo-poder' }, [miniatura(SP.ima), el('b', { text: 'Ímã' }), el('span', { text: 'puxa moedas' })]),
      el('div', { class: 'jogo-poder' }, [miniatura(SP.turbo), el('b', { text: 'Turbo' }), el('span', { text: 'passa por tudo' })]),
      el('div', { class: 'jogo-poder' }, [miniatura(SP.escudo), el('b', { text: 'Capacete' }), el('span', { text: 'salva 1 vez' })]),
    ]);
    painel(el('div', { class: 'jogo-cartao' }, [
      el('img', { class: 'jogo-mascote', src: 'img/mascote-192.webp', alt: '', width: 192, height: 192 }),
      el('h2', { text: 'Corrida do Ligeiro' }),
      el('p', { class: 'jogo-texto', text: 'Desvie, pule e pegue as moedas. Moedas seguidas multiplicam os pontos.' }),
      dicas,
      poderes,
      chaveMusica(),
      J.recorde > 0 ? el('div', { class: 'jogo-recorde' }, [UI.iconeLinha('trofeu'), el('span', { text: 'Seu recorde: ' + numero(J.recorde) })]) : null,
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: function () { comecar(false); } }, [UI.iconeLinha('tocar'), 'Jogar']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, 'Voltar ao pedido'),
      el('p', { class: 'jogo-nota', text: 'Seu pedido continua andando. Se ele mudar, avisamos aqui.' }),
    ]));
    pedirQuadro();
  }

  function comecar(semContagem) {
    /* o som so pode nascer num toque (regra do iPhone) */
    if (J.som) { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) { /* sem som */ } }
    novaCorrida();
    J.elTopo.hidden = false;
    J.pontosVistos = -1; J.moedasVistas = -1; J.multVisto = -1;
    atualizarPlacar();
    painel(null);
    J.ult = 0;
    if (semContagem) J.fase = 'jogando';
    else { J.fase = 'contagem'; J.conta = 3; som('conta'); }
    musicaParar(); musicaLigar();
    pedirQuadro();
  }

  function mostrarDicaRapida() {
    var d = el('div', { class: 'jogo-dica-rapida' }, [icone('lados'), el('span', { text: 'Arraste para desviar' })]);
    J.raiz.appendChild(d);
    setTimeout(function () { d.classList.add('sai'); }, 2400);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3000);
  }

  function pausar(titulo, texto) {
    if (!J || (J.fase !== 'jogando' && J.fase !== 'contagem')) return;
    J.fase = 'pausa';
    musicaParar();
    painel(el('div', { class: 'jogo-cartao' }, [
      el('h2', { text: typeof titulo === 'string' ? titulo : 'Pausado' }),
      el('p', { class: 'jogo-texto', text: typeof texto === 'string' ? texto : numero(pontos()) + ' pontos até aqui.' }),
      chaveMusica(),
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: continuar }, [UI.iconeLinha('tocar'), 'Continuar']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, typeof titulo === 'string' ? 'Ver meu pedido' : 'Voltar ao pedido'),
    ]));
  }
  function continuar() {
    if (!J || J.fase !== 'pausa') return;
    painel(null);
    /* volta com uma contagem curta: ninguem bate no carro que estava na frente quando pausou */
    J.fase = 'contagem'; J.conta = 2; J.ult = 0;
    som('conta');
    musicaLigar();
    pedirQuadro();
  }

  function fimDeJogo() {
    J.fase = 'fim';
    var p = pontos();
    var recorde = p > J.recorde;
    if (recorde) { J.recorde = p; guardar(CHAVE_RECORDE, p); }
    painel(el('div', { class: 'jogo-cartao' }, [
      el('h2', { text: recorde && p > 0 ? 'Novo recorde!' : 'Bateu!' }),
      el('div', { class: 'jogo-final' }, [el('b', { text: numero(p) }), el('span', { text: 'pontos' })]),
      el('div', { class: 'jogo-numeros' }, [
        el('div', {}, [el('b', { text: numero(J.dist) }), el('span', { text: 'metros' })]),
        el('div', {}, [el('b', { text: numero(J.moedas) }), el('span', { text: J.moedas === 1 ? 'moeda' : 'moedas' })]),
        el('div', {}, [el('b', { text: 'x' + J.maiorMult }), el('span', { text: 'maior combo' })]),
      ]),
      !recorde && J.recorde > 0 ? el('div', { class: 'jogo-recorde' }, [UI.iconeLinha('trofeu'), el('span', { text: 'Seu recorde: ' + numero(J.recorde) })]) : null,
      el('button', { class: 'btn btn-principal btn-largo', type: 'button', onclick: function () { comecar(false); } }, [UI.iconeLinha('tocar'), 'Jogar de novo']),
      el('button', { class: 'btn btn-fantasma btn-largo', type: 'button', onclick: function () { fechar(); } }, 'Voltar ao pedido'),
    ]));
  }

  /* recado rapido por cima do jogo (km, recorde, o pedido andou) */
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
    if (importante && (J.fase === 'jogando' || J.fase === 'contagem')) pausar(rotulo, 'Seu pedido andou. Quer ver agora ou terminar a corrida?');
    else aviso('Seu pedido: ' + rotulo);
  }

  /* ---- toques e teclas ---- */
  function aoApertar(e) {
    if (!J || e.target !== J.canvas) return;
    J.toque = { x: e.clientX, y: e.clientY, t: Date.now(), usado: false };
  }
  function aoMover(e) {
    if (!J || !J.toque || J.toque.usado) return;
    var dx = e.clientX - J.toque.x, dy = e.clientY - J.toque.y;
    /* o gesto vale assim que passa de 24 px: nao espera soltar o dedo (mais rapido de reagir) */
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) { J.toque.usado = true; mudarFaixa(dx > 0 ? 1 : -1); }
    else if (dy < -24 && Math.abs(dy) > Math.abs(dx)) { J.toque.usado = true; pular(); }
  }
  function aoSoltar(e) {
    if (!J || !J.toque) return;
    var t = J.toque; J.toque = null;
    if (t.usado) return;
    var dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    /* toque rapido: nos lados troca de faixa, no meio pula (para quem nao gosta de arrastar) */
    if (t.x < J.w / 3) mudarFaixa(-1);
    else if (t.x > J.w * 2 / 3) mudarFaixa(1);
    else pular();
  }
  function aoTeclar(e) {
    if (!J) return;
    var k = e.key;
    if (J.fase === 'jogando') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') mudarFaixa(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') mudarFaixa(1);
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') pular();
      else if (k === 'Escape' || k === 'p' || k === 'P') pausar();
      else return;
      e.preventDefault();
    } else if (k === 'Escape') { if (J.fase === 'pausa') continuar(); else fechar(); e.preventDefault(); }
  }
  function aoEsconder() {
    if (!J) return;
    if (document.hidden) { pausar(); if (J && J.raf) { cancelAnimationFrame(J.raf); J.raf = 0; } }
    else { J.ult = 0; desenhar(); pedirQuadro(); }
  }
  function aoVoltarNavegador() { if (J) fechar(true); }
  function semRolar(e) { if (J && e.target === J.canvas) e.preventDefault(); }

  /* ================================================================ abrir e fechar =========================== */

  function abrir(op) {
    if (J) return;
    op = op || {};
    estilos();
    J = {
      vivo: true, fase: 'inicio', som: ler(CHAVE_SOM, '1') !== '0', comMusica: ler(CHAVE_MUSICA, '1') !== '0', recorde: Number(ler(CHAVE_RECORDE, 0)) || 0, musica: null,
      aoFechar: op.aoFechar,
      raf: 0, ult: 0, camX: 0, pontosVistos: -1, moedasVistas: -1, multVisto: -1, jaJogou: Number(ler(CHAVE_RECORDE, 0)) > 0,
      noite: 0, tarde: 0, ceuA: 'dia', ceuB: 'dia', ceuT: 0, baixoSeguro: 0,
    };
    novaCorrida();
    J.canvas = el('canvas', { class: 'jogo-tela', 'aria-label': 'Corrida do Ligeiro' });
    J.ctx = J.canvas.getContext('2d');
    J.elPontos = el('b', { text: '0' });
    J.elMoedas = el('b', { text: '0' });
    J.elMult = el('span', { class: 'jogo-mult', hidden: true, text: 'x1' });
    var botaoSom = el('button', { class: 'jogo-botao', type: 'button', 'aria-label': J.som ? 'Desligar o som' : 'Ligar o som' }, [icone(J.som ? 'som' : 'semSom')]);
    botaoSom.onclick = function () {
      J.som = !J.som; guardar(CHAVE_SOM, J.som ? '1' : '0');
      if (!J.som) musicaParar(); else if (J.fase === 'jogando' || J.fase === 'contagem') musicaLigar();
      UI.limpar(botaoSom); botaoSom.appendChild(icone(J.som ? 'som' : 'semSom'));
      botaoSom.setAttribute('aria-label', J.som ? 'Desligar o som' : 'Ligar o som');
    };
    J.elTopo = el('div', { class: 'jogo-topo', hidden: true }, [
      el('div', { class: 'jogo-moedas' }, [el('span', { class: 'jogo-moeda-ico', 'aria-hidden': 'true' }), J.elMoedas, J.elMult]),
      el('div', { class: 'jogo-pontos', 'aria-live': 'off' }, [J.elPontos]),
      el('div', { class: 'jogo-botoes' }, [
        botaoSom,
        el('button', { class: 'jogo-botao', type: 'button', 'aria-label': 'Pausar', onclick: function () { pausar(); } }, [icone('pausa')]),
      ]),
    ]);
    J.elPedido = op.rotulo ? el('div', { class: 'jogo-pedido', text: op.rotulo }) : null;
    J.elAviso = el('div', { class: 'jogo-aviso', role: 'status', hidden: true });
    J.painel = el('div', { class: 'jogo-painel', hidden: true });
    J.raiz = el('div', { class: 'jogo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Corrida do Ligeiro' }, [
      J.canvas, J.elTopo, J.elPedido, J.elAviso, J.painel,
    ]);
    document.body.appendChild(J.raiz);
    document.documentElement.classList.add('jogo-aberto');

    J.canvas.addEventListener('pointerdown', aoApertar);
    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
    J.raiz.addEventListener('touchmove', semRolar, { passive: false });
    window.addEventListener('keydown', aoTeclar);
    window.addEventListener('resize', medir);
    document.addEventListener('visibilitychange', aoEsconder);
    /* o voltar do celular fecha o jogo (e nao sai da tela do pedido) */
    try { history.pushState({ ligeiroJogo: true }, ''); J.empurrou = true; } catch (_) { J.empurrou = false; }
    window.addEventListener('popstate', aoVoltarNavegador);

    var comeco = function () {
      if (!J) return;
      if (!SP) montarDesenhos(op.cidade);
      medir();
      telaInicio();
    };
    if (!mascote) {
      mascote = new Image();
      mascote.onload = mascote.onerror = comeco;
      mascote.src = 'img/mascote-192.webp';
    } else comeco();
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
    window.removeEventListener('resize', medir);
    window.removeEventListener('popstate', aoVoltarNavegador);
    document.removeEventListener('visibilitychange', aoEsconder);
    if (J.raiz.parentNode) J.raiz.parentNode.removeChild(J.raiz);
    document.documentElement.classList.remove('jogo-aberto');
    var empurrou = J.empurrou;
    J = null;
    if (!peloVoltar && empurrou && history.state && history.state.ligeiroJogo) { try { history.back(); } catch (_) { /* segue */ } }
    if (typeof aoFechar === 'function') aoFechar();
  }

  /* ================================================================ estilo (vem junto, so para quem joga) ==== */

  function estilos() {
    if (document.getElementById('estiloJogo')) return;
    var css =
      'html.jogo-aberto,html.jogo-aberto body{overflow:hidden;overscroll-behavior:none}' +
      '.jogo{--seguro-baixo:env(safe-area-inset-bottom,0px);position:fixed;inset:0;z-index:150;background:#D9F2FF;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden}' +
      '.jogo-tela{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.jogo-topo{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 0;pointer-events:none}' +
      '.jogo-topo[hidden],.jogo-painel[hidden],.jogo-aviso[hidden],.jogo-mult[hidden]{display:none}' +
      '.jogo-moedas{justify-self:start;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 8px;border-radius:999px;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(14,31,20,.15);font-family:var(--display);font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '.jogo-moedas>b{padding-right:6px}' +
      '.jogo-moeda-ico{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 50%,#FFD84A 0 55%,#F7C325 56% 78%,#D9A109 79%)}' +
      '.jogo-mult{margin-left:-4px;padding:2px 8px;border-radius:999px;background:var(--deep);color:#C6FF7A;font-size:14px;font-weight:800;line-height:1.3}' +
      '.jogo-mult.pula{animation:jogo-pop-mult .35s cubic-bezier(.2,1.6,.4,1) both!important}' +
      '.jogo-pontos{font-family:var(--display);font-size:32px;line-height:1;font-weight:700;color:#fff;text-shadow:0 2px 0 rgba(14,31,20,.55),0 0 12px rgba(14,31,20,.25);font-variant-numeric:tabular-nums}' +
      '.jogo-botoes{justify-self:end;display:flex;gap:8px;pointer-events:auto}' +
      '.jogo-botao{width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.92);color:var(--deep);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(14,31,20,.15);cursor:pointer;padding:0}' +
      '.jogo-botao .ico-traco svg{width:22px;height:22px}' +
      '.jogo-pedido{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 64px);max-width:calc(100% - 32px);padding:6px 14px;border-radius:999px;background:rgba(15,61,46,.82);color:#fff;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}' +
      '.jogo-aviso{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 104px);transform:translateX(-50%);max-width:calc(100% - 32px);padding:12px 18px;border-radius:16px;background:var(--lime);color:var(--ink);font-family:var(--display);font-size:17px;font-weight:700;text-align:center;box-shadow:0 6px 20px rgba(14,31,20,.25);animation:jogo-desce .3s ease-out both!important;pointer-events:none}' +
      '.jogo-aviso.sai{animation:jogo-sobe .35s ease-in both!important}' +
      '.jogo-painel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,61,46,.28)}' +
      '.jogo-cartao{width:100%;max-width:360px;max-height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;border-radius:24px;background:#fff;box-shadow:0 18px 50px rgba(14,31,20,.3);text-align:center;animation:jogo-pop .35s cubic-bezier(.2,1.3,.4,1) both!important}' +
      '.jogo-cartao h2{margin:0;font-family:var(--display);font-size:26px;line-height:1.15;color:var(--ink)}' +
      '.jogo-mascote{width:80px;height:80px;object-fit:contain;margin:-8px 0 -4px;animation:jogo-pula 1.6s ease-in-out infinite!important}' +
      '.jogo-texto{margin:0;font-size:15px;line-height:1.4;color:var(--body)}' +
      '.jogo-nota{margin:0;font-size:13px;line-height:1.35;color:var(--muted)}' +
      '.jogo-dicas{width:100%;display:flex;flex-direction:column;gap:8px}' +
      '.jogo-dica{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;background:var(--lime-suave);font-size:14px;line-height:1.3;color:var(--deep);text-align:left}' +
      '.jogo-dica .ico-traco svg{width:22px;height:22px}' +
      '.jogo-poderes{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.jogo-poder{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:#F4F7F2;line-height:1.2}' +
      '.jogo-poder b{font-size:13.5px;color:var(--ink)}' +
      '.jogo-poder span{font-size:12px;color:var(--muted);white-space:nowrap}' +
      '.jogo-poder-ico{width:32px;height:32px;margin-bottom:2px}' +
      '.jogo-opcao{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 4px 12px;font-size:15px;font-weight:600;color:var(--ink)}' +
      '.jogo-recorde{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:700;color:var(--deep2)}' +
      '.jogo-recorde .ico-traco svg{width:20px;height:20px}' +
      '.jogo-final{display:flex;flex-direction:column;align-items:center;line-height:1}' +
      '.jogo-final b{font-family:var(--display);font-size:48px;color:var(--deep);font-variant-numeric:tabular-nums}' +
      '.jogo-final span{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}' +
      '.jogo-numeros{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.jogo-numeros div{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:#F4F7F2}' +
      '.jogo-numeros b{font-family:var(--display);font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '.jogo-numeros span{font-size:12px;color:var(--muted)}' +
      '.jogo-cartao .btn{width:100%;margin:0}' +
      '.jogo-cartao .btn .ico-traco{margin-right:8px}' +
      '.jogo-dica-rapida{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:rgba(15,61,46,.85);color:#fff;font-size:15px;font-weight:600;white-space:nowrap;pointer-events:none;animation:jogo-aparece .3s ease-out both!important}' +
      '.jogo-dica-rapida.sai{animation:jogo-some .5s ease-in both!important}' +
      '@keyframes jogo-pop{0%{opacity:0;transform:scale(.86) translateY(12px)}100%{opacity:1;transform:none}}' +
      '@keyframes jogo-pop-mult{0%{transform:scale(.4)}100%{transform:scale(1)}}' +
      '@keyframes jogo-pula{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
      '@keyframes jogo-desce{0%{opacity:0;transform:translate(-50%,-16px)}100%{opacity:1;transform:translate(-50%,0)}}' +
      '@keyframes jogo-sobe{0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-16px)}}' +
      '@keyframes jogo-aparece{0%{opacity:0}100%{opacity:1}}' +
      '@keyframes jogo-some{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(el('style', { id: 'estiloJogo', text: css }));
  }

  window.LigeiroJogo = {
    abrir: abrir,
    fechar: function () { fechar(); },
    aberto: function () { return !!J; },
    pedidoMudou: pedidoMudou,
    /* so para o teste automatico (testes/jogo.test.mjs): o estado e um passo do jogo sem desenhar */
    _teste: { estado: function () { return J; }, passo: function (dt) { atualizar(dt); }, comecar: function () { comecar(true); }, pular: function () { pular(); }, faixa: function (d) { mudarFaixa(d); }, desenhar: function () { desenhar(); } },
  };
})();
