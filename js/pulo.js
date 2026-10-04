/*
 * Ligeiro - Pulo do Ligeiro: o segundo joguinho da espera do pedido (o convite fica embaixo do da Corrida).
 *
 * O ratinho do Ligeiro pula sozinho de plataforma em plataforma e sobe o mais alto que der; quem joga so escolhe o
 * lado (segurando o dedo na metade da tela, ou as setas). Saiu por um lado da tela, volta pelo outro. Caiu la embaixo,
 * acabou. A cidade e de noite (neon, vitrines e postes acesos) e o ceu muda com a altura: brasa no chao, roxo, noite funda e o espaco.
 *
 * Plataformas: toldo laranja (normal), toldo vermelho (anda de lado), caixa de papelao (quebra: nao segura ninguem) e a mola
 * (pulo grande). O gato e o pombo derrubam o ratinho, menos se ele cair por cima deles. Os lanches da loja viram os poderes,
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
  var CAM0 = -70;           /* onde a camera comeca (a cidade do fundo anda mais devagar que o chao a partir daqui) */

  /* o ceu por altura: [altura, cor de cima, cor de baixo]; entre dois pontos a cor vai mudando aos poucos. Sempre noite:
     no chao o fundo e brasa (o brilho da cidade) e vai escurecendo ate o espaco */
  var CEU = [
    [0, '#1B0B33', '#C4472E'], [5000, '#160A2B', '#8E2F3A'],
    [12000, '#0F0722', '#4B1B45'], [22000, '#080419', '#1F1038'],
    [33000, '#03030C', '#120C2A'],
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
  var NEON = { rosa: ['#FF4D6D', '#FFD0D8'], laranja: ['#FF9A3C', '#FFE0BC'], amarelo: ['#FFD23F', '#FFF4C2'], vermelho: ['#FF5545', '#FFD5CF'], magenta: ['#FF5BC8', '#FFD3F0'] };
  /* letreiro de neon: o brilho fica gravado no desenho (feito uma vez), nada de sombra a cada quadro */
  function neon(x, texto, cx, cy, tam, par, largMax) {
    x.save();
    x.font = '900 ' + tam + 'px system-ui, -apple-system, "Segoe UI", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = par[0]; x.shadowBlur = tam * 0.5; x.fillStyle = par[0];
    x.fillText(texto, cx, cy, largMax); x.fillText(texto, cx, cy, largMax);
    x.shadowBlur = 0; x.fillStyle = par[1]; x.fillText(texto, cx, cy, largMax);
    x.restore();
  }
  /* janelas de um predio: area (x, y, largura, altura), colunas e linhas, quanto da fachada esta acesa */
  var LUZ_JANELA = ['#FFD27A', '#FFB347', '#FFE9B0', '#FF8A3D'];
  function janelas(x, ax, ay, aw, ah, cols, linhas, sem, acesas, apagada) {
    var cw = aw / cols, ch = ah / linhas;
    for (var r = 0; r < linhas; r++) for (var c = 0; c < cols; c++) {
      var v = fixo(sem + c * 7.3 + r * 13.1);
      var jx = ax + c * cw + cw * 0.2, jy = ay + r * ch + ch * 0.22, jw = cw * 0.6, jh = ch * 0.56;
      if (v < acesas) { x.fillStyle = LUZ_JANELA[Math.floor(fixo(sem + r * 3.7 + c) * LUZ_JANELA.length)]; x.globalAlpha = 0.72 + fixo(sem + c * 5 + r * 11) * 0.28; }
      else { x.fillStyle = apagada; x.globalAlpha = 1; }
      x.fillRect(jx, jy, jw, jh);
    }
    x.globalAlpha = 1;
  }

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

  /* o ratinho do Ligeiro de frente, pulando de bracos para cima, com a cara do mascote: contorno preto de desenho
     animado, pelo creme, miolo da orelha vermelho, nariz preto, olhos brancos grandes, lingua de fora, dolma branca de
     cozinheiro com o lenco verde-limao, luvas brancas e o chapeu. A caixa de entrega nas costas aparece dos lados.
     tonto: os olhos viram X (quando o gato pega) */
  var CONTORNO = '#1B1B1F', PELO = '#F6F0E4', PELO_SOMBRA = '#E6DCCB', ORELHA = '#E5312A', LENCO = '#A6D83B';
  function ratinho(tonto) {
    return sprite(64, 84, function (x) {
      x.lineJoin = 'round'; x.lineCap = 'round';
      function tinta(cor, largura) { x.fillStyle = cor; x.fill(); x.strokeStyle = CONTORNO; x.lineWidth = largura || 1.7; x.stroke(); }
      /* rabo, atras de tudo: o contorno por baixo e o pelo por cima */
      x.beginPath(); x.moveTo(42, 72); x.bezierCurveTo(58, 70, 62, 56, 55, 50);
      x.strokeStyle = CONTORNO; x.lineWidth = 4.4; x.stroke(); x.strokeStyle = PELO_SOMBRA; x.lineWidth = 2.2; x.stroke();
      /* caixa de entrega nas costas */
      retangulo(x, 13, 46, 38, 22, 5); tinta('#E8431A');
      x.fillStyle = '#FFC21A'; x.fillRect(14, 61, 36, 3);
      /* pernas e pes */
      retangulo(x, 24, 65, 6, 11, 3); tinta(PELO_SOMBRA, 1.4); retangulo(x, 34, 65, 6, 11, 3); tinta(PELO_SOMBRA, 1.4);
      oval(x, 26, 79, 6.5, 4); tinta('#FFFFFF', 1.5); oval(x, 38, 79, 6.5, 4); tinta('#FFFFFF', 1.5);
      /* bracos para cima, com as luvas brancas */
      oval(x, 17, 46, 4, 9, 0.55); tinta(PELO, 1.5); oval(x, 47, 46, 4, 9, -0.55); tinta(PELO, 1.5);
      bola(x, 12.5, 38.5, 4.3); tinta('#FFFFFF', 1.5); bola(x, 51.5, 38.5, 4.3); tinta('#FFFFFF', 1.5);
      /* dolma branca de cozinheiro, com os botoes pretos */
      retangulo(x, 19, 45, 26, 25, 10); tinta('#FFFFFF');
      /* o adesivo no peito: a logo da loja; sem logo, o "L" do Ligeiro */
      bola(x, 32, 60.5, 5.4); tinta('#FFFFFF', 1.3);
      if (marca && marca.img && marca.img.complete && marca.img.naturalWidth) {
        x.save(); bola(x, 32, 60.5, 4.8); x.clip();
        var iw = marca.img.naturalWidth, ih = marca.img.naturalHeight || iw;
        var esc = (marca.logo ? 9 : 10.5) / Math.max(iw, ih);
        try { x.drawImage(marca.img, 32 - (iw * esc) / 2, 60.5 - (ih * esc) / 2, iw * esc, ih * esc); } catch (_) { /* sem logo */ }
        x.restore();
      } else { x.fillStyle = '#0F3D2E'; x.font = '900 7px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('L', 32, 61); }
      /* lenco verde-limao no pescoco, como o do mascote */
      x.beginPath(); x.moveTo(20.5, 45); x.lineTo(43.5, 45); x.lineTo(32, 55); x.closePath(); tinta(LENCO, 1.5);
      x.strokeStyle = '#6E9A1E'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(26, 47.5); x.lineTo(32, 52.6); x.lineTo(38, 47.5); x.stroke();
      /* orelhas: pelo creme com o miolo vermelho */
      bola(x, 15, 22, 9.5); tinta(PELO); bola(x, 49, 22, 9.5); tinta(PELO);
      x.fillStyle = ORELHA; bola(x, 15.6, 22.6, 5.6); x.fill(); bola(x, 48.4, 22.6, 5.6); x.fill();
      /* cabeca */
      bola(x, 32, 32, 15); tinta(PELO, 1.9);
      /* bigode */
      x.strokeStyle = CONTORNO; x.lineWidth = 0.9;
      x.beginPath(); x.moveTo(25.5, 36.5); x.lineTo(15, 34.8); x.moveTo(25.5, 38.2); x.lineTo(15, 39.8); x.moveTo(38.5, 36.5); x.lineTo(49, 34.8); x.moveTo(38.5, 38.2); x.lineTo(49, 39.8); x.stroke();
      /* olhos brancos grandes */
      oval(x, 27, 30, 3.5, 4.3); tinta('#FFFFFF', 1.3); oval(x, 37, 30, 3.5, 4.3); tinta('#FFFFFF', 1.3);
      if (tonto) {
        x.strokeStyle = CONTORNO; x.lineWidth = 1.6;
        [27, 37].forEach(function (ox) { x.beginPath(); x.moveTo(ox - 1.9, 28.1); x.lineTo(ox + 1.9, 31.9); x.moveTo(ox + 1.9, 28.1); x.lineTo(ox - 1.9, 31.9); x.stroke(); });
      } else {
        x.fillStyle = CONTORNO; bola(x, 27.7, 30.9, 1.9); x.fill(); bola(x, 37.7, 30.9, 1.9); x.fill();
        x.fillStyle = '#FFFFFF'; bola(x, 28.3, 30.2, 0.6); x.fill(); bola(x, 38.3, 30.2, 0.6); x.fill();
      }
      /* boca: sorriso aberto com a lingua (tonto: boca torta) */
      if (tonto) {
        x.strokeStyle = CONTORNO; x.lineWidth = 1.3; x.beginPath(); x.arc(32, 42.5, 2.6, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
      } else {
        x.beginPath(); x.moveTo(28.2, 38.6); x.quadraticCurveTo(32, 44.2, 35.8, 38.6); x.closePath(); tinta('#7A1616', 1.2);
        x.fillStyle = '#EF5350'; oval(x, 32.3, 41.3, 2, 1.3); x.fill();
      }
      /* nariz preto com o brilho */
      oval(x, 32, 36.2, 2.7, 2); x.fillStyle = CONTORNO; x.fill();
      x.fillStyle = 'rgba(255,255,255,0.8)'; oval(x, 31.2, 35.6, 0.9, 0.55); x.fill();
      /* chapeu de cozinheiro: o contorno de todas as partes por baixo, o branco por cima (so a borda de fora aparece) */
      x.strokeStyle = CONTORNO; x.lineWidth = 3.4;
      bola(x, 25, 12, 6.5); x.stroke(); bola(x, 32, 8.5, 7.5); x.stroke(); bola(x, 39, 12, 6.5); x.stroke(); retangulo(x, 23, 12, 18, 8, 2.5); x.stroke();
      x.fillStyle = '#FFFFFF';
      bola(x, 25, 12, 6.5); x.fill(); bola(x, 32, 8.5, 7.5); x.fill(); bola(x, 39, 12, 6.5); x.fill(); retangulo(x, 23, 12, 18, 8, 2.5); x.fill();
      x.strokeStyle = CONTORNO; x.lineWidth = 1.1; x.beginPath(); x.moveTo(23.8, 15.2); x.lineTo(40.2, 15.2); x.stroke();
    });
  }

  /* tabua da plataforma: [cor, cor de cima, cor de baixo, contorno] */
  function tabua(cores, extra) {
    return sprite(68, 20, function (x) {
      x.fillStyle = 'rgba(0,0,0,0.3)'; retangulo(x, 4, 6, 62, 13, 6.5); x.fill(); /* sombrinha */
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
    SP.normal = tabua(['#FF9A1F', '#FFD27A', '#D9560B', '#8F3A06']);
    SP.movel = tabua(['#E8433A', '#FF9A8F', '#B3261E', '#7A1612'], function (x) {
      x.fillStyle = '#FFFFFF';
      x.beginPath(); x.moveTo(9, 9); x.lineTo(14, 5.5); x.lineTo(14, 12.5); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(59, 9); x.lineTo(54, 5.5); x.lineTo(54, 12.5); x.closePath(); x.fill();
    });
    /* caixa de papelao: parece plataforma, mas rasga quando pisam */
    SP.quebra = sprite(68, 20, function (x) {
      x.fillStyle = 'rgba(0,0,0,0.28)'; retangulo(x, 4, 6, 62, 13, 3); x.fill();
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
        x.strokeStyle = '#D8C6B2'; x.lineWidth = 2.4;
        var voltas = 4, passo = (alt - 5) / voltas;
        x.beginPath(); x.moveTo(5, alt);
        for (var i = 0; i < voltas; i++) { x.lineTo(19, alt - passo * (i + 0.5)); x.lineTo(5, alt - passo * (i + 1)); }
        x.stroke();
        x.fillStyle = '#FFB81C'; retangulo(x, 1, 0, 22, 5, 2.5); x.fill();
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
    /* fumaca da cidade: roxa, com o fundo iluminado de laranja pelas luzes de baixo */
    SP.nuvem = sprite(160, 64, function (x) {
      x.fillStyle = 'rgba(112,64,128,0.9)';
      bola(x, 42, 40, 22); x.fill(); bola(x, 76, 30, 28); x.fill(); bola(x, 112, 38, 22); x.fill();
      retangulo(x, 20, 38, 120, 24, 12); x.fill();
      x.fillStyle = 'rgba(255,140,70,0.4)'; retangulo(x, 22, 50, 116, 12, 6); x.fill();
    });
    /* a lua: halo, disco e as crateras (pronta, so copiada) */
    SP.lua = sprite(120, 120, function (x) {
      var g = x.createRadialGradient(60, 60, 10, 60, 60, 60);
      g.addColorStop(0, 'rgba(255,230,190,0.75)'); g.addColorStop(1, 'rgba(255,230,190,0)');
      x.fillStyle = g; x.fillRect(0, 0, 120, 120);
      bola(x, 60, 60, 26); x.fillStyle = '#FFF1D0'; x.fill();
      x.fillStyle = 'rgba(160,120,90,0.2)'; bola(x, 52, 54, 5); x.fill(); bola(x, 68, 68, 4); x.fill(); bola(x, 64, 49, 2.8); x.fill();
    });
    /* brilhos somados por cima (postes, vitrines e letreiros): amarelo e rosa */
    function brilhoDe(cor) {
      return sprite(64, 64, function (x) {
        var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, cor.replace('A', '0.95')); g.addColorStop(0.35, cor.replace('A', '0.45')); g.addColorStop(1, cor.replace('A', '0'));
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      });
    }
    SP.luzes = [brilhoDe('rgba(255,190,90,A)'), brilhoDe('rgba(255,70,140,A)')];
    /* a cidade la longe: uma fileira de predios que fecha certinho com a proxima copia (largura exata de 360) */
    SP.horizonte = sprite(360, 150, function (x) {
      var larguras = [], soma = 0, i;
      for (i = 0; soma < 340; i++) { var l = 20 + fixo(i * 1.7 + 4) * 30; larguras.push(l); soma += l; }
      var escala = 360 / soma, px = 0;
      for (i = 0; i < larguras.length; i++) {
        var w = larguras[i] * escala, alt = 52 + fixo(i * 2.3 + 9) * 86;
        x.fillStyle = i % 2 ? '#2A1243' : '#33174F'; x.fillRect(px, 150 - alt, w + 0.5, alt);
        if (fixo(i * 3.1 + 2) > 0.7) x.fillRect(px + w / 2 - 1, 150 - alt - 10, 2, 11);
        for (var wy = 150 - alt + 7; wy < 144; wy += 10) for (var wx = px + 4; wx < px + w - 5; wx += 8) {
          if (fixo(wx * 0.91 + wy * 1.7) >= 0.42) continue;
          x.fillStyle = LUZ_JANELA[Math.floor(fixo(wx + wy * 0.5) * LUZ_JANELA.length)]; x.globalAlpha = 0.55 + fixo(wx * 2.1 + wy) * 0.4;
          x.fillRect(wx, wy, 3, 4);
        }
        x.globalAlpha = 1;
        px += w;
      }
    });
    /* predios da largada: fachada escura com as janelas acesas e, em alguns, letreiro de neon no topo */
    var PREDIOS = [
      { alt: 300, corpo: ['#35194F', '#1F0F33'], cols: 4, linhas: 13, sem: 3, acesas: 0.55, neon: ['PIZZA', NEON.rosa] },
      { alt: 244, corpo: ['#2D1648', '#1B0D2E'], cols: 4, linhas: 10, sem: 11, acesas: 0.45 },
      { alt: 276, corpo: ['#3A1B3F', '#22102A'], cols: 3, linhas: 11, sem: 23, acesas: 0.6, neon: ['LANCHE', NEON.laranja] },
      { alt: 212, corpo: ['#2A1A4F', '#180E33'], cols: 4, linhas: 8, sem: 37, acesas: 0.5 },
    ];
    SP.predios = PREDIOS.map(function (d) {
      return sprite(150, 372, function (x) {
        var topo = 372 - d.alt;
        var g = x.createLinearGradient(0, topo, 0, 372);
        g.addColorStop(0, d.corpo[0]); g.addColorStop(1, d.corpo[1]);
        x.fillStyle = g; x.fillRect(12, topo, 126, d.alt);
        x.fillStyle = 'rgba(255,160,80,0.16)'; x.fillRect(12, topo, 4, d.alt);
        x.fillStyle = '#150A25'; x.fillRect(8, topo - 8, 134, 10);
        janelas(x, 22, topo + 16, 106, d.alt - 34, d.cols, d.linhas, d.sem, d.acesas, '#1C0E30');
        if (d.neon) {
          x.fillStyle = '#150A25'; x.fillRect(42, topo - 40, 3, 34); x.fillRect(105, topo - 40, 3, 34);
          retangulo(x, 30, topo - 66, 90, 30, 6); x.fillStyle = '#1B0C2B'; x.fill();
          x.strokeStyle = d.neon[1][0]; x.lineWidth = 2; x.stroke();
          neon(x, d.neon[0], 75, topo - 51, 19, d.neon[1], 80);
        } else {
          x.fillStyle = '#150A25'; x.fillRect(72, topo - 36, 3, 30);
          bola(x, 73.5, topo - 38, 3.4); x.fillStyle = '#FF3D3D'; x.fill();
        }
      });
    });
    /* lojinha de comida: vitrine acesa, toldo listrado e letreiro de neon */
    var LOJAS = [
      { nome: 'PIZZA', par: NEON.rosa, toldo: ['#E53935', '#FFF1DC'] },
      { nome: 'LANCHES', par: NEON.laranja, toldo: ['#FF8F1F', '#FFF1DC'] },
    ];
    SP.casas = LOJAS.map(function (d) {
      return sprite(240, 200, function (x) {
        x.fillStyle = '#2B1642'; x.fillRect(20, 36, 200, 164);
        x.fillStyle = '#1A0C2C'; x.fillRect(14, 30, 212, 10);
        var v = x.createLinearGradient(0, 112, 0, 196);
        v.addColorStop(0, '#FFE2A0'); v.addColorStop(1, '#FF9A3C');
        x.fillStyle = v; x.fillRect(34, 116, 172, 80);
        x.fillStyle = '#3A1D12'; x.fillRect(34, 170, 172, 26);
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(34, 120, 172, 3);
        x.fillStyle = '#FFF4D6'; [60, 120, 180].forEach(function (px) { bola(x, px, 140, 6); x.fill(); x.fillRect(px - 0.8, 116, 1.6, 18); });
        x.fillStyle = '#7A3B1E'; retangulo(x, 104, 136, 32, 60, 3); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(108, 140, 24, 20);
        for (var i = 0; i < 12; i++) {
          x.fillStyle = d.toldo[i % 2]; x.beginPath();
          x.moveTo(14 + i * 17.7, 94); x.lineTo(14 + (i + 1) * 17.7, 94); x.lineTo(14 + (i + 1) * 17.7 + 2, 110); x.lineTo(14 + i * 17.7 - 2, 110); x.closePath(); x.fill();
          bola(x, 14 + i * 17.7 + 8.85, 110, 8.85); x.fill();
        }
        x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(12, 94, 216, 5);
        retangulo(x, 52, 44, 136, 38, 8); x.fillStyle = '#17092A'; x.fill();
        x.strokeStyle = d.par[0]; x.lineWidth = 2.4; x.stroke();
        neon(x, d.nome, 120, 64, 25, d.par, 118);
      });
    });
    SP.poste = sprite(80, 260, function (x) {
      x.fillStyle = '#3B2A52'; x.fillRect(12, 30, 7, 230);
      x.fillStyle = '#2E2044'; x.fillRect(12, 30, 60, 6);
      x.fillStyle = '#241838'; retangulo(x, 56, 34, 22, 10, 4); x.fill();
      x.fillStyle = '#FFE2A8'; retangulo(x, 58, 42, 18, 5, 2); x.fill();
    });
    /* painel de neon: ENTREGA e o quentinho na hora */
    SP.placa = sprite(240, 170, function (x) {
      x.fillStyle = '#3B2A52'; x.fillRect(40, 96, 8, 74); x.fillRect(192, 96, 8, 74);
      retangulo(x, 6, 6, 228, 104, 12); x.fillStyle = '#17092A'; x.fill();
      x.strokeStyle = '#FF9A3C'; x.lineWidth = 3; retangulo(x, 14, 14, 212, 88, 8); x.stroke();
      neon(x, 'ENTREGA', 120, 48, 35, NEON.amarelo, 190);
      x.fillStyle = '#FFE9C9'; x.font = '700 15px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('quentinho na hora', 120, 82, 180);
    });
  }

  /* ================================================================ o jogo ================================ */

  var J = null;   /* o jogo aberto (so um por vez) */
  var audio = null;
  /* o som volta sempre que nao esta tocando: 'suspended' (o jogo foi fechado) e tambem 'interrupted' (iPhone depois de
     uma ligacao ou do alarme), que antes ficava mudo ate recarregar a pagina */
  function acordarSom() {
    if (!audio || audio.state === 'running' || audio.state === 'closed') return;
    try { var p = audio.resume(); if (p && p.catch) p.catch(function () { /* o proximo toque tenta de novo */ }); } catch (_) { /* sem som */ }
  }
  /* fechou o jogo: o som dorme depois que a musica some (nao fica segurando o audio do celular na tela do pedido) */
  function dormirSom() {
    setTimeout(function () {
      if (J || !audio || audio.state !== 'running') return; /* abriu de novo: segue tocando */
      try { var p = audio.suspend(); if (p && p.catch) p.catch(function () { /* segue */ }); } catch (_) { /* segue */ }
    }, 450);
  }

  function som(tipo) {
    if (!J || !J.som) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      acordarSom();
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

  /* ---- musica do pulo: um ska proprio do Ligeiro, em do maior, feito na hora pelo celular (nenhum arquivo baixado).
     Baixo andando de semínima em semínima, acordes curtinhos no contratempo (o "ska"), caixa na 2 e na 4 e uma melodia
     de metais (serra suave). Oito compassos que se repetem ---- */
  var MELODIA = [
    79, 0, 79, 76, 72, 0, 76, 0,   76, 0, 76, 72, 69, 0, 72, 0,
    77, 0, 77, 74, 69, 0, 74, 0,   74, 76, 79, 0, 83, 0, 79, 0,
    84, 0, 84, 81, 79, 0, 76, 0,   81, 0, 79, 76, 72, 0, 76, 0,
    77, 0, 74, 72, 74, 0, 79, 0,   76, 72, 67, 0, 72, 0, 0, 0,
  ];
  /* baixo andando: quatro notas por compasso (do, la menor, fa, sol, do, la menor, re menor, do) */
  var BAIXO = [
    [48, 52, 55, 57], [45, 48, 52, 55], [41, 45, 48, 50], [43, 47, 50, 47],
    [48, 52, 55, 57], [45, 48, 52, 55], [50, 53, 57, 55], [48, 52, 55, 52],
  ];
  /* os acordes do contratempo, um por compasso */
  var ACORDES = [[60, 64, 67], [57, 60, 64], [57, 60, 65], [59, 62, 67], [60, 64, 67], [57, 60, 64], [57, 62, 65], [60, 64, 67]];
  var chiado = null;
  function freq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function notaMusica(tipo, n, quando, dur, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = tipo; o.frequency.setValueAtTime(freq(n), quando);
    g.gain.setValueAtTime(vol, quando); g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
    o.connect(g); g.connect(J.musica.saida); o.start(quando); o.stop(quando + dur + 0.02);
  }
  function bumbo(quando) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, quando); o.frequency.exponentialRampToValueAtTime(48, quando + 0.1);
    g.gain.setValueAtTime(0.11, quando); g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.13);
    o.connect(g); g.connect(J.musica.saida); o.start(quando); o.stop(quando + 0.15);
  }
  function chiar(quando, vol, dur) {
    var f = audio.createBufferSource(), g = audio.createGain();
    f.buffer = chiado; g.gain.setValueAtTime(vol, quando); g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
    f.connect(g); g.connect(J.musica.saida); f.start(quando); f.stop(quando + 0.06);
  }
  function agendarMusica() {
    if (!J || !J.musica || !audio) return;
    var m = J.musica;
    var passo = 60 / 138 / 2; /* colcheia a 138 */
    while (m.proximo < audio.currentTime + 0.25) {
      var i = m.passo % 64, c = Math.floor(i / 8), k = i % 8;
      if (MELODIA[i]) notaMusica('sawtooth', MELODIA[i], m.proximo, passo * 0.85, 0.011);
      /* baixo andando: nas semínimas (colcheias 0, 2, 4 e 6) */
      if (k % 2 === 0) notaMusica('triangle', BAIXO[c][k / 2], m.proximo, passo * 1.7, 0.068);
      /* o ska: acorde curtinho no contratempo (colcheias 1, 3, 5 e 7) */
      if (k % 2 === 1) ACORDES[c].forEach(function (n) { notaMusica('square', n, m.proximo, passo * 0.5, 0.012); });
      if (k === 0 || k === 4) bumbo(m.proximo);
      if (chiado && i >= 62) chiar(m.proximo, 0.03, 0.05); /* virada de caixa no fim da volta */
      else if (chiado && (k === 2 || k === 6)) chiar(m.proximo, 0.026, 0.08);
      m.proximo += passo;
      m.passo += 1;
    }
  }
  function musicaLigar() {
    if (!J || !J.som || !J.comMusica || J.musica) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      acordarSom();
      if (!chiado) {
        chiado = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.06), audio.sampleRate);
        var d = chiado.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      var saida = audio.createGain();
      saida.gain.setValueAtTime(0.0001, audio.currentTime); saida.gain.exponentialRampToValueAtTime(1, audio.currentTime + 0.4);
      /* corta os agudos ardidos das ondas quadradas: da para ouvir por varios minutos sem cansar */
      var filtro = audio.createBiquadFilter(); filtro.type = 'lowpass'; filtro.frequency.value = 3600;
      saida.connect(filtro); filtro.connect(audio.destination);
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
    J.ultimaY = 0; J.evitar = null; J.caminho = []; J.proxPoder = 1400; J.proxBicho = 3200; J.proxMarco = MARCO;
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
  /* as ultimas tabuas firmes paradas do caminho (a que anda nao tem coluna fixa): o gato foge da coluna delas */
  function lembrarCaminho(p) { if (p.tipo === 'movel') return; J.caminho.push({ x: p.x, y: p.y }); if (J.caminho.length > 6) J.caminho.shift(); }
  /* o lugar do gato: longe da tabua logo abaixo dele (110, como sempre) e das outras tabuas do caminho que ainda
     alcancam ele num pulo. Antes so a de baixo contava: 16% dos gatos ficavam na coluna da tabua de dois degraus abaixo,
     e quem pulava dela reto batia no gato. 80 de folga = meia tabua com o pe (42) + o gato (36): de qualquer ponto dessa
     tabua, o pulo reto passa do lado. Olha a largura toda de 2 em 2: sorteia entre os lugares com folga; se nenhum tem
     (tabuas espalhadas demais), fica o de mais folga, a pelo menos 100 da tabua logo abaixo */
  function lugarDoGato(xAbaixo, gy) {
    var m = PLAT_L / 2 + 4, bons = [], melhor = null, folga = -1;
    for (var x = m; x <= LARG - m; x += 2) {
      var dAbaixo = Math.abs(distX(x, xAbaixo));
      if (dAbaixo < 100) continue;
      var f = LARG;
      for (var k = 0; k < J.caminho.length; k++) {
        var c = J.caminho[k];
        if (c.y + 30 + ALTURA_PULO > gy + 22 - 36) f = Math.min(f, Math.abs(distX(x, c.x)));
      }
      if (f >= 80 && dAbaixo >= 110) bons.push(x);
      if (f > folga) { folga = f; melhor = x; }
    }
    if (bons.length) return bons[Math.floor(Math.random() * bons.length)];
    return melhor === null ? sorteioX(xAbaixo) : melhor;
  }
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
    if (y < 3000 && vao > 60 && Math.random() < 0.35) lembrarCaminho(plataforma('normal', sorteioX(p.x), y0 + vao * 0.5));
    lembrarCaminho(p);
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
        var gy = y + 70 + Math.random() * 30, gx = lugarDoGato(p.x, gy);
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
        som('pisou'); texto('+25', '#FFC857');
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
    var espaco = Math.min(1, Math.max(0, (alt - 28000) / 5000));
    /* estrelas: uma tela so, repetida, andando devagar; a lua desce devagarinho enquanto o ratinho sobe */
    if (J.estrelas) {
      var oy = (alt * J.s * 0.1) % J.h;
      ctx.globalAlpha = Math.min(1, 0.5 + alt / 9000);
      ctx.drawImage(J.estrelas, 0, oy - J.h, J.w, J.h); ctx.drawImage(J.estrelas, 0, oy, J.w, J.h);
      ctx.globalAlpha = 1;
      var lt = 120 * J.s, ly = J.h * 0.17 + alt * J.s * 0.012;
      if (ly < J.h + lt) ctx.drawImage(SP.lua, J.ox + J.campo * 0.78 - lt / 2, ly - lt / 2, lt, lt);
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
    /* fumaca da cidade: anda mais devagar que as tabuas (parece longe); some no espaco */
    if (espaco < 1) {
      var fator = 0.55, faixa = 230;
      var base = J.cam * fator;
      var de = Math.floor((base - 80) / faixa), ate = Math.ceil((base + J.visH + 80) / faixa);
      ctx.globalAlpha = (1 - espaco) * 0.5;
      for (var k = de; k <= ate; k++) {
        if (fixo(k + 3) < 0.4) continue;
        var w = (90 + fixo(k + 7) * 70) * J.s, h = w * 0.4;
        var x = fixo(k) * (J.w + w) - w;
        var y = J.h - (k * faixa - base) * J.s;
        ctx.drawImage(SP.nuvem, x, y - h, w, h);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* brilho somado por cima: centro no mundo (x, y), raio em unidades */
  function brilhoEm(ctx, spr, x, y, r) {
    var px = sx(x), py = sy(y), d = r * 2 * J.s;
    ctx.drawImage(spr, px - d / 2, py - d / 2, d, d);
  }

  /* a largada: a rua da cidade a noite, com os predios, a lojinha, o poste e o painel de neon */
  function chao(ctx) {
    var topo = sy(0);
    if (topo > J.h + 260 * J.s) return;
    /* a cidade la longe: anda um pouco mais devagar que o chao e some quando a subida passa dela */
    var sobe = J.cam - CAM0, fundo = Math.max(0, 1 - sobe / 420), i;
    if (fundo > 0) {
      var hz = 150 * J.s, base = topo + 6 * J.s - sobe * 0.2 * J.s;
      ctx.globalAlpha = fundo;
      for (var kx = J.ox - J.campo; kx < J.w; kx += J.campo) if (kx + J.campo > 0) ctx.drawImage(SP.horizonte, kx, base - hz, J.campo + 1, hz);
      ctx.globalAlpha = 1;
    }
    porBase(ctx, SP.predios[0], 52, 0, 84, 208, false);
    porBase(ctx, SP.casas[1], 150, 0, 100, 83, false);
    porBase(ctx, SP.poste, 214, 0, 36, 117, false);
    porBase(ctx, SP.placa, 272, 0, 84, 60, false);
    porBase(ctx, SP.predios[3], 340, 0, 70, 174, false);
    /* a calcada e a rua */
    ctx.fillStyle = '#251634'; ctx.fillRect(0, topo, J.w, J.h - topo + 20);
    ctx.fillStyle = '#5A4670'; ctx.fillRect(0, topo, J.w, 9 * J.s);
    ctx.fillStyle = '#FFD27A'; ctx.fillRect(0, topo, J.w, Math.max(2, 1.6 * J.s));
    ctx.fillStyle = 'rgba(255,214,140,0.55)';
    for (i = 0; i < J.w; i += 36 * J.s) ctx.fillRect(i, topo + 44 * J.s, 20 * J.s, Math.max(2, 2 * J.s));
    /* as luzes da noite, somadas por cima */
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8;
    brilhoEm(ctx, SP.luzes[0], 226, 94, 50);
    brilhoEm(ctx, SP.luzes[0], 150, 26, 66);
    brilhoEm(ctx, SP.luzes[0], 272, 40, 46);
    brilhoEm(ctx, SP.luzes[1], 52, 192, 40);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
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
      bola(ctx, x, y, 24); ctx.fillStyle = 'rgba(26,11,42,0.8)'; ctx.fill();
      ctx.drawImage(lista[i][0], x - 17, y - 17, 34, 34);
      ctx.beginPath(); ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, lista[i][1])); ctx.strokeStyle = '#FFC857'; ctx.lineWidth = 4; ctx.stroke();
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
    ctx.lineWidth = Math.max(4, tam * 0.12); ctx.strokeStyle = 'rgba(26,8,36,0.9)'; ctx.lineJoin = 'round';
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
      ctx.fillStyle = 'rgba(255,190,110,0.14)'; ctx.fillRect(J.ox - 1, 0, 1, J.h); ctx.fillRect(J.ox + J.campo, 0, 1, J.h);
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
    /* girar o celular enquanto a foto do lanche ainda carrega (os desenhos e as tabuas nao existem): o comeco mede depois */
    if (!J || !J.pronto) return;
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
    if (J.som) { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); acordarSom(); } catch (_) { /* sem som */ } }
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
    if (!J || !J.pronto) return; /* ainda carregando: nada para pausar nem desenhar */
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

    /* os desenhos dependem da loja (a logo no peito e a cidade na placa): refeitos so quando a loja muda.
       Na chave vai tudo o que aparece do lanche (nome, preco, emoji e a foto): so o id e "tem foto" deixava o lanche,
       o preco e a foto da loja anterior quando duas lojas da mesma cidade tinham o mesmo id */
    var novos = (Array.isArray(op.produtos) ? op.produtos : []).slice(0, 3).map(function (p) { return { id: String(p.id), nome: String(p.nome || ''), preco: Number(p.preco) || 0, emoji: p.emoji || '', foto: p.foto || '' }; });
    var chave = (op.cidade || '') + '|' + (op.logo || '') + '|' + JSON.stringify(novos.map(function (p) { return [p.id, p.nome, p.preco, p.emoji, p.foto]; }));
    var este = J;
    var comeco = function () {
      if (!J || J !== este) return; /* fechou (ou ja abriu em outra loja) enquanto a foto carregava */
      if (!SP || SP.chave !== chave) { montarDesenhos(op.cidade); poderesDaLoja(); SP.chave = chave; }
      J.pronto = true;
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
    dormirSom();
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
      '.pulo{--seguro-baixo:env(safe-area-inset-bottom,0px);--ink:#FFF3E3;--body:#E9D5C2;--muted:#BBA692;--deep:#FFB454;--deep2:#FFD08A;--lime:#FF8A1F;--lime-escuro:#D96A06;--lime-suave:rgba(255,138,31,.15);--lime2:#FFB454;--card:#2B1740;--line:rgba(255,226,190,.14);--line-forte:rgba(255,226,190,.32);--texto-no-destaque:#2A1000;--anel:rgba(255,160,60,.5);position:fixed;inset:0;z-index:150;background:#1A0B2A;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overflow:hidden}' +
      '.pulo-tela{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.pulo-topo{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 0;pointer-events:none}' +
      '.pulo-topo[hidden],.pulo-painel[hidden],.pulo-aviso[hidden]{display:none}' +
      '.pulo-moedas{justify-self:start;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 10px;border-radius:999px;background:rgba(26,11,42,.78);box-shadow:0 0 0 1px rgba(255,190,110,.32),0 4px 14px rgba(0,0,0,.4);font-family:var(--display);font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}' +
      '@supports (text-box:trim-both cap alphabetic){.pulo-moedas>b{text-box:trim-both cap alphabetic}}' +
      '.pulo-moeda-ico{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 50%,#FFD84A 0 55%,#F7C325 56% 78%,#D9A109 79%)}' +
      '.pulo-pontos{font-family:var(--display);font-size:32px;line-height:1;font-weight:700;color:#FFF3E3;text-shadow:0 2px 0 rgba(26,8,36,.8),0 0 14px rgba(255,138,31,.45);font-variant-numeric:tabular-nums}' +
      '.pulo-botoes{justify-self:end;display:flex;gap:8px;pointer-events:auto}' +
      '.pulo-botao{width:44px;height:44px;border-radius:50%;border:0;background:rgba(26,11,42,.78);color:var(--deep);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 0 1px rgba(255,190,110,.32),0 4px 14px rgba(0,0,0,.4);cursor:pointer;padding:0}' +
      '.pulo-botao .ico-traco svg{width:22px;height:22px}' +
      '.pulo-pedido{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 64px);max-width:calc(100% - 32px);padding:6px 14px;line-height:20px;height:32px;border-radius:999px;background:rgba(26,11,42,.78);box-shadow:0 0 0 1px rgba(255,190,110,.28);color:#FFF3E3;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}' +
      '.pulo-aviso{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 104px);transform:translateX(-50%);max-width:calc(100% - 32px);padding:12px 18px;border-radius:16px;background:var(--lime);color:#2A1000;font-family:var(--display);font-size:17px;font-weight:700;text-align:center;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.4);animation:pulo-desce .3s ease-out both!important;pointer-events:none}' +
      '.pulo-aviso.sai{animation:pulo-sobe .35s ease-in both!important}' +
      '.pulo-painel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(14,5,26,.55)}' +
      '.pulo-cartao{width:100%;max-width:360px;max-height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;border-radius:24px;background:linear-gradient(180deg,#34194C 0%,#22102F 100%);box-shadow:0 0 0 1px rgba(255,190,110,.28),0 18px 50px rgba(0,0,0,.55),0 0 40px rgba(255,120,40,.12);text-align:center;animation:pulo-pop .35s cubic-bezier(.2,1.3,.4,1) both!important}' +
      '.pulo-cartao h2{margin:0;font-family:var(--display);font-size:26px;line-height:1.15;color:var(--ink)}' +
      '.pulo-mascote{width:80px;height:80px;object-fit:contain;margin:-8px 0 -4px;animation:pulo-pula .9s cubic-bezier(.3,0,.7,1) infinite alternate!important}' +
      '.pulo-texto{margin:0;font-size:15px;line-height:1.4;color:var(--body)}' +
      '.pulo-nota{margin:0;font-size:13px;line-height:1.35;color:var(--muted)}' +
      '.pulo-dicas{width:100%;display:flex;flex-direction:column;gap:8px}' +
      '.pulo-dica{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;background:var(--lime-suave);font-size:14px;line-height:1.3;color:var(--deep);text-align:left}' +
      '.pulo-dica .ico-traco{flex:none}' +
      '.pulo-dica .ico-traco svg{width:22px;height:22px}' +
      '.pulo-poderes{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.pulo-poder{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:rgba(255,226,190,.08);line-height:1.2;min-width:0}' +
      '.pulo-poder b{font-size:13.5px;color:var(--ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pulo-poder span{font-size:12px;color:var(--muted);white-space:nowrap}' +
      '.pulo-poder-ico{width:44px;height:44px;margin-bottom:4px}' +
      '.pulo-opcao{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 4px 12px;font-size:15px;font-weight:600;color:var(--ink)}' +
      '.pulo-recorde{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:700;color:var(--deep2)}' +
      '.pulo-recorde .ico-traco svg{width:20px;height:20px}' +
      '.pulo-final{display:flex;flex-direction:column;align-items:center;line-height:1}' +
      '.pulo-final b{font-family:var(--display);font-size:48px;color:var(--deep);font-variant-numeric:tabular-nums}' +
      '.pulo-final span{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}' +
      '.pulo-numeros{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
      '.pulo-numeros div{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;background:rgba(255,226,190,.08)}' +
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
      '.pulo-cartao .btn .ico-traco{margin:0 -5px 0 -5.25px}' +
      '.pulo-dica-rapida{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:rgba(26,11,42,.85);box-shadow:0 0 0 1px rgba(255,190,110,.28);color:#FFF3E3;font-size:15px;font-weight:600;white-space:nowrap;pointer-events:none;animation:pulo-aparece .3s ease-out both!important}' +
      '.pulo-dica-rapida.sai{animation:pulo-some .5s ease-in both!important}' +
      '.pulo .chave:not(.on){background:rgba(255,226,190,.24)}' +
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
