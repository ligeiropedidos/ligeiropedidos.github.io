/*
 * Ligeiro - deixa um video leve no proprio navegador, antes de subir (so a Central usa; nada pesa no servidor).
 * O video toca escondido e cada quadro vai para um quadro de 720 x 1280 (cabe inteiro, faixa preta onde sobrar);
 * o codificador do navegador (WebCodecs) grava em H.264 com qualidade constante (como o CRF do ffmpeg) e o som em
 * AAC; o MP4 e montado aqui, com o indice no comeco (toca na hora em qualquer celular, iPhone incluso).
 * Uso: LigeiroVideoLeve.comprimir(arquivo, { max: 20, aoAndar: fn(0..1) }) -> Promise<{ arquivo, dur, capa }>
 *      LigeiroVideoLeve.suportado() -> true/false
 */
(function () {
  'use strict';
  var W = 720, H = 1280, FPS = 30;
  var QP = 28;             /* qualidade constante (medido em 26/09/2026: 27 = 3,0 MB, 29 = 2,5 MB por 20 s de telas; sem diferenca a olho) */
  var BITRATE = 2200000;   /* so para o modo por taxa (navegador sem qualidade constante) */
  var AAC_KBPS = 96000;
  var VIDEO_CFG = { codec: 'avc1.640028', width: W, height: H, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } };

  function suportado() { return typeof window.VideoEncoder === 'function' && typeof window.AudioEncoder === 'function' && typeof window.VideoFrame === 'function' && !!HTMLVideoElement.prototype.requestVideoFrameCallback; }

  /* ---------- configuracao que o navegador aceita (qualidade constante primeiro) ---------- */
  function escolherCfg() {
    var tentativas = [
      Object.assign({}, VIDEO_CFG, { bitrateMode: 'quantizer', hardwareAcceleration: 'prefer-hardware' }),
      Object.assign({}, VIDEO_CFG, { bitrateMode: 'quantizer' }),
      Object.assign({}, VIDEO_CFG, { bitrate: BITRATE, bitrateMode: 'variable' }),
      Object.assign({}, VIDEO_CFG, { codec: 'avc1.4d0028', bitrate: BITRATE }),
      Object.assign({}, VIDEO_CFG, { codec: 'avc1.42e028', bitrate: BITRATE }),
    ];
    var i = 0;
    function proxima() {
      if (i >= tentativas.length) return Promise.reject(new Error('Este navegador não comprime vídeo.'));
      var c = tentativas[i++];
      return VideoEncoder.isConfigSupported(c).then(function (r) { return r.supported ? c : proxima(); }, proxima);
    }
    return proxima();
  }

  /* ---------- MP4 (ISO BMFF) sem fragmentos, indice (moov) antes dos dados (mdat) ---------- */
  function Bytes() { this.partes = []; this.n = 0; }
  Bytes.prototype.u8 = function (v) { this.partes.push(new Uint8Array([v & 255])); this.n += 1; return this; };
  Bytes.prototype.u16 = function (v) { this.partes.push(new Uint8Array([(v >>> 8) & 255, v & 255])); this.n += 2; return this; };
  Bytes.prototype.u24 = function (v) { this.partes.push(new Uint8Array([(v >>> 16) & 255, (v >>> 8) & 255, v & 255])); this.n += 3; return this; };
  Bytes.prototype.u32 = function (v) { this.partes.push(new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])); this.n += 4; return this; };
  Bytes.prototype.i32 = function (v) { return this.u32(v >>> 0); };
  Bytes.prototype.txt = function (s) { for (var i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; };
  Bytes.prototype.raw = function (a) { a = a instanceof Uint8Array ? a : new Uint8Array(a); this.partes.push(a); this.n += a.length; return this; };
  Bytes.prototype.zeros = function (k) { this.partes.push(new Uint8Array(k)); this.n += k; return this; };
  Bytes.prototype.junto = function () { var out = new Uint8Array(this.n), o = 0; this.partes.forEach(function (p) { out.set(p, o); o += p.length; }); return out; };
  function caixa(tipo, filhos) {
    var corpo = new Bytes();
    (filhos || []).forEach(function (f) { corpo.raw(f); });
    var b = new Bytes(); b.u32(8 + corpo.n).txt(tipo).raw(corpo.junto());
    return b.junto();
  }
  function cheia(tipo, versao, flags, fn) { var b = new Bytes(); b.u8(versao).u24(flags); fn(b); return caixa(tipo, [b.junto()]); }
  var MATRIZ = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  function matriz(b) { MATRIZ.forEach(function (v) { b.u32(v); }); }
  /* descritores do esds: tamanho em 4 bytes (0x80 0x80 0x80 n), aceito por todos os leitores */
  function descritor(tag, conteudo) { var b = new Bytes(); var n = conteudo.length; b.u8(tag).u8(0x80 | ((n >>> 21) & 127)).u8(0x80 | ((n >>> 14) & 127)).u8(0x80 | ((n >>> 7) & 127)).u8(n & 127).raw(conteudo); return b.junto(); }

  /* amostras: [{ dados: Uint8Array, pts (unidade da trilha), dur, chave }] em ordem de decodificacao */
  function tabelas(t) {
    var a = t.amostras, n = a.length;
    var ordenado = a.map(function (x) { return x.pts; }).sort(function (x, y) { return x - y; });
    var atraso = 0;
    a.forEach(function (x, i) { atraso = Math.max(atraso, ordenado[i] - x.pts); });
    a.forEach(function (x, i) { x.dts = ordenado[i] - atraso; x.cto = x.pts - x.dts; });
    /* duracao de cada amostra na ordem de decodificacao */
    for (var i = 0; i < n; i++) a[i].dd = i + 1 < n ? a[i + 1].dts - a[i].dts : (a[i].dur || (n > 1 ? a[n - 2].dd : t.escala / FPS));
    t.atraso = atraso;
    t.duracao = a.length ? (a[n - 1].dts + a[n - 1].dd) - a[0].dts : 0;
  }
  function stbl(t, pedacos) {
    var a = t.amostras;
    var stts = [];
    a.forEach(function (x) { if (stts.length && stts[stts.length - 1][1] === x.dd) stts[stts.length - 1][0]++; else stts.push([1, x.dd]); });
    var filhos = [];
    filhos.push(cheia('stsd', 0, 0, function (b) { b.u32(1).raw(t.entrada); }));
    filhos.push(cheia('stts', 0, 0, function (b) { b.u32(stts.length); stts.forEach(function (e) { b.u32(e[0]).u32(e[1]); }); }));
    if (a.some(function (x) { return x.cto !== 0; })) {
      var ct = [];
      a.forEach(function (x) { if (ct.length && ct[ct.length - 1][1] === x.cto) ct[ct.length - 1][0]++; else ct.push([1, x.cto]); });
      filhos.push(cheia('ctts', 0, 0, function (b) { b.u32(ct.length); ct.forEach(function (e) { b.u32(e[0]).u32(e[1]); }); }));
    }
    if (t.video && !a.every(function (x) { return x.chave; })) {
      var ks = []; a.forEach(function (x, i) { if (x.chave) ks.push(i + 1); });
      filhos.push(cheia('stss', 0, 0, function (b) { b.u32(ks.length); ks.forEach(function (k) { b.u32(k); }); }));
    }
    /* amostras por pedaco (pedacos intercalados de ~0,5 s) */
    var stsc = [];
    pedacos.forEach(function (p, i) { if (!stsc.length || stsc[stsc.length - 1][1] !== p.qtd) stsc.push([i + 1, p.qtd]); });
    filhos.push(cheia('stsc', 0, 0, function (b) { b.u32(stsc.length); stsc.forEach(function (e) { b.u32(e[0]).u32(e[1]).u32(1); }); }));
    filhos.push(cheia('stsz', 0, 0, function (b) { b.u32(0).u32(a.length); a.forEach(function (x) { b.u32(x.dados.length); }); }));
    filhos.push(cheia('stco', 0, 0, function (b) { b.u32(pedacos.length); pedacos.forEach(function (p) { b.u32(p.onde); }); }));
    return caixa('stbl', filhos);
  }
  function trak(t, id, pedacos, durFilme) {
    var tkhd = cheia('tkhd', 0, 3, function (b) {
      b.u32(0).u32(0).u32(id).u32(0).u32(durFilme).zeros(8).u16(0).u16(0).u16(t.video ? 0 : 0x0100).u16(0);
      matriz(b); b.u32(t.video ? W << 16 : 0).u32(t.video ? H << 16 : 0);
    });
    var filhos = [tkhd];
    if (t.atraso) {
      /* edit list: a apresentacao comeca no primeiro quadro (sem o atraso da reordenacao) */
      filhos.push(caixa('edts', [cheia('elst', 0, 0, function (b) { b.u32(1).u32(durFilme).u32(t.atraso).u32(0x00010000); })]));
    }
    var mdhd = cheia('mdhd', 0, 0, function (b) { b.u32(0).u32(0).u32(t.escala).u32(t.duracao).u16(0x55c4).u16(0); });
    var hdlr = cheia('hdlr', 0, 0, function (b) { b.u32(0).txt(t.video ? 'vide' : 'soun').zeros(12).txt(t.video ? 'Video' : 'Som').u8(0); });
    var mhd = t.video ? cheia('vmhd', 0, 1, function (b) { b.zeros(8); }) : cheia('smhd', 0, 0, function (b) { b.zeros(4); });
    var dinf = caixa('dinf', [cheia('dref', 0, 0, function (b) { b.u32(1).raw(cheia('url ', 0, 1, function () {})); })]);
    filhos.push(caixa('mdia', [mdhd, hdlr, caixa('minf', [mhd, dinf, stbl(t, pedacos)])]));
    return caixa('trak', filhos);
  }
  function entradaVideo(avcC) {
    var b = new Bytes();
    b.zeros(6).u16(1).zeros(16).u16(W).u16(H).u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff);
    return caixa('avc1', [b.junto(), caixa('avcC', [avcC])]);
  }
  function entradaAudio(asc, taxa, canais) {
    var b = new Bytes();
    b.zeros(6).u16(1).zeros(8).u16(canais).u16(16).u16(0).u16(0).u32(taxa << 16);
    var dsi = descritor(5, asc);
    var dcd = new Bytes(); dcd.u8(0x40).u8(0x15).u24(0).u32(AAC_KBPS).u32(AAC_KBPS).raw(dsi);
    var es = new Bytes(); es.u16(1).u8(0).raw(descritor(4, dcd.junto())).raw(descritor(6, new Uint8Array([2])));
    var esds = cheia('esds', 0, 0, function (x) { x.raw(descritor(3, es.junto())); });
    return caixa('mp4a', [b.junto(), esds]);
  }
  function montarMp4(vid, aud) {
    var trilhas = [vid].concat(aud ? [aud] : []);
    trilhas.forEach(tabelas);
    /* pedacos intercalados: janelas de 0,5 s, video e som alternados */
    var ordem = [];
    trilhas.forEach(function (t, ti) {
      var janela = t.escala / 2, atual = null;
      t.pedacos = [];
      t.amostras.forEach(function (x) {
        var j = Math.floor((x.dts - t.amostras[0].dts) / janela);
        if (!atual || atual.j !== j) { atual = { j: j, t: ti, qtd: 0, bytes: 0, amostras: [] }; t.pedacos.push(atual); ordem.push(atual); }
        atual.qtd++; atual.bytes += x.dados.length; atual.amostras.push(x);
      });
    });
    ordem.sort(function (p, q) { return p.j - q.j || p.t - q.t; });
    var durFilme = Math.round(Math.max.apply(null, trilhas.map(function (t) { return t.duracao / t.escala; })) * 1000);
    var ftyp = caixa('ftyp', [new Bytes().txt('isom').u32(512).txt('isom').txt('iso2').txt('avc1').txt('mp41').junto()]);
    function moov() {
      var mvhd = cheia('mvhd', 0, 0, function (b) { b.u32(0).u32(0).u32(1000).u32(durFilme).u32(0x00010000).u16(0x0100).zeros(10); matriz(b); b.zeros(24).u32(trilhas.length + 1); });
      return caixa('moov', [mvhd].concat(trilhas.map(function (t, i) { return trak(t, i + 1, t.pedacos, durFilme); })));
    }
    /* primeiro mede o moov (os enderecos tem tamanho fixo), depois grava com os enderecos certos */
    ordem.forEach(function (p) { p.onde = 0; });
    var tamMoov = moov().length;
    var inicioDados = ftyp.length + tamMoov + 8;
    var o = inicioDados;
    ordem.forEach(function (p) { p.onde = o; o += p.bytes; });
    var mv = moov();
    var total = o;
    var out = new Uint8Array(total), pos = 0;
    out.set(ftyp, pos); pos += ftyp.length;
    out.set(mv, pos); pos += mv.length;
    var tamMdat = total - pos;
    out.set([(tamMdat >>> 24) & 255, (tamMdat >>> 16) & 255, (tamMdat >>> 8) & 255, tamMdat & 255, 0x6d, 0x64, 0x61, 0x74], pos); pos += 8;
    ordem.forEach(function (p) { p.amostras.forEach(function (x) { out.set(x.dados, pos); pos += x.dados.length; }); });
    return new Blob([out], { type: 'video/mp4' });
  }

  /* ---------- o som: decodifica o arquivo inteiro e codifica em AAC ---------- */
  function codificarSom(buffer, maxSeg) {
    var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return Promise.resolve(null);
    var TAXA = 48000;
    return new Ctx(2, TAXA, TAXA).decodeAudioData(buffer.slice(0)).then(function (ab) {
      var total = Math.min(ab.length, Math.round(maxSeg * ab.sampleRate));
      if (total < ab.sampleRate * 0.05) return null;
      var canais = Math.min(2, ab.numberOfChannels), taxa = ab.sampleRate;
      var amostras = [], cfgSaida = null, erro = null;
      var enc = new AudioEncoder({
        output: function (chunk, meta) {
          var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !cfgSaida) cfgSaida = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset || 0, (meta.decoderConfig.description.byteOffset || 0) + meta.decoderConfig.description.byteLength) : meta.decoderConfig.description);
          amostras.push({ dados: d, pts: Math.round(chunk.timestamp * taxa / 1e6), dur: chunk.duration ? Math.round(chunk.duration * taxa / 1e6) : 1024, chave: true });
        },
        error: function (e) { erro = e; },
      });
      enc.configure({ codec: 'mp4a.40.2', sampleRate: taxa, numberOfChannels: canais, bitrate: AAC_KBPS, aac: { format: 'aac' } });
      var BLOCO = 4096;
      for (var ini = 0; ini < total; ini += BLOCO) {
        var n = Math.min(BLOCO, total - ini), plano = new Float32Array(n * canais);
        for (var c = 0; c < canais; c++) plano.set(ab.getChannelData(c).subarray(ini, ini + n), c * n);
        /* cortado nos 20 s: os ultimos 20 ms descem ate o silencio (o corte nao estala) */
        if (ini + n >= total && total < ab.length) {
          var suave = Math.min(n, Math.round(taxa * 0.02));
          for (var cc = 0; cc < canais; cc++) for (var k = 0; k < suave; k++) plano[cc * n + n - 1 - k] *= k / suave;
        }
        var dado = new AudioData({ format: 'f32-planar', sampleRate: taxa, numberOfFrames: n, numberOfChannels: canais, timestamp: Math.round(ini / taxa * 1e6), data: plano });
        enc.encode(dado); dado.close();
      }
      return enc.flush().then(function () {
        enc.close();
        if (erro || !amostras.length) return null;
        if (!cfgSaida) cfgSaida = ascPadrao(taxa, canais);
        return { video: false, escala: taxa, amostras: amostras, entrada: entradaAudio(cfgSaida, taxa, canais) };
      });
    }).catch(function () { return null; }); /* sem som ou formato que o navegador nao le: vai sem som */
  }
  function ascPadrao(taxa, canais) {
    var idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(taxa);
    if (idx < 0) idx = 3;
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (canais << 3)]);
  }

  /* ---------- calibragem da cor ----------
     Alguns codificadores (o da placa de video, por exemplo) gravam o brilho na faixa cheia (0 a 255) e marcam o video
     como faixa de TV (16 a 235): no iPhone e no ffmpeg a imagem sai lavada (o branco estoura). O proprio Chrome nao
     mostra o problema, entao a conta e feita no valor cru: dois quadros cinza (40 e 200) passam pelo codificador e
     voltam pelo decodificador por programa (copyTo, sem conversao de cor); com a marcacao lida do SPS, sai um filtro
     que leva a imagem para a faixa que o arquivo diz ter. */
  function Bits(a) { this.a = a; this.p = 0; }
  Bits.prototype.u = function (n) { var v = 0; for (var i = 0; i < n; i++) { v = v * 2 + ((this.a[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; };
  Bits.prototype.ue = function () { var z = 0; while (this.u(1) === 0 && z < 32) z++; return Math.pow(2, z) - 1 + this.u(z); };
  Bits.prototype.se = function () { var k = this.ue(); return k & 1 ? (k + 1) / 2 : -k / 2; };
  /* video_full_range_flag do SPS (dentro do avcC); sem a informacao, vale a faixa de TV */
  function faixaCheia(avcC) {
    try {
      var n = (avcC[6] << 8) | avcC[7], cru = avcC.subarray(8, 8 + n), sps = [];
      for (var i = 0; i < cru.length; i++) { if (i >= 2 && cru[i] === 3 && cru[i - 1] === 0 && cru[i - 2] === 0) continue; sps.push(cru[i]); }
      var b = new Bits(sps); b.u(8);
      var perfil = b.u(8); b.u(8); b.u(8); b.ue();
      if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].indexOf(perfil) >= 0) {
        var cf = b.ue(); if (cf === 3) b.u(1);
        b.ue(); b.ue(); b.u(1);
        if (b.u(1)) for (var l = 0; l < (cf === 3 ? 12 : 8); l++) if (b.u(1)) { var ult = 8, prox = 8, tam = l < 6 ? 16 : 64; for (var j = 0; j < tam; j++) { if (prox !== 0) prox = (ult + b.se() + 256) % 256; ult = prox === 0 ? ult : prox; } }
      }
      b.ue();
      var poc = b.ue();
      if (poc === 0) b.ue(); else if (poc === 1) { b.u(1); b.se(); b.se(); var q = b.ue(); for (var k = 0; k < q; k++) b.se(); }
      b.ue(); b.u(1); b.ue(); b.ue();
      if (!b.u(1)) b.u(1);
      b.u(1);
      if (b.u(1)) { b.ue(); b.ue(); b.ue(); b.ue(); }
      if (!b.u(1)) return false;
      if (b.u(1)) { if (b.u(8) === 255) { b.u(16); b.u(16); } }
      if (b.u(1)) b.u(1);
      if (!b.u(1)) return false;
      b.u(3);
      return b.u(1) === 1;
    } catch (_) { return false; }
  }
  /* video de entrada gravado na faixa cheia (alguns Android e webcams): o Chrome desenha como se fosse faixa de TV e o
     branco estoura; o filtro devolve a imagem para os niveis certos antes de codificar */
  var FILTRO_FAIXA_CHEIA = 'contrast(' + (219 / 255 / (2 * 16 / 255 + 219 / 255)).toFixed(4) + ') brightness(' + (2 * 16 / 255 + 219 / 255).toFixed(4) + ')';
  function entradaFaixaCheia(buffer) {
    var a = new Uint8Array(buffer), n = a.length;
    for (var i = 4; i < n - 12; i++) {
      if (a[i] === 0x61 && a[i + 1] === 0x76 && a[i + 2] === 0x63 && a[i + 3] === 0x43) { /* avcC */
        var tam = ((a[i - 4] << 24) | (a[i - 3] << 16) | (a[i - 2] << 8) | a[i - 1]) >>> 0;
        if (tam > 12 && tam < 4096 && i + tam - 4 <= n) return faixaCheia(a.subarray(i + 4, i + tam - 4));
      }
    }
    return false;
  }
  function calibrar(cfg) {
    var NIVEIS = [40, 200];
    return new Promise(function (ok) {
      var chunks = [], avcC = null, pronto = false;
      var info = { etapa: 'inicio' };
      function sair(filtro, porque) { if (pronto) return; pronto = true; info.filtro = filtro; info.porque = porque || info.porque; ok(filtro); }
      setTimeout(function () { sair('', 'tempo esgotado na etapa ' + info.etapa); }, 5000);
      try {
        var enc = new VideoEncoder({
          output: function (c, meta) {
            var d = new Uint8Array(c.byteLength); c.copyTo(d); chunks.push({ d: d, t: c.timestamp });
            if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) { var x = meta.decoderConfig.description; avcC = x instanceof ArrayBuffer ? new Uint8Array(x.slice(0)) : new Uint8Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); }
          },
          error: function (e) { sair('', 'codificador: ' + (e && e.message)); },
        });
        /* no tamanho de verdade: em tamanho pequeno o navegador pode usar outro codificador (e a resposta seria outra) */
        enc.configure(cfg);
        var tela = document.createElement('canvas'); tela.width = cfg.width; tela.height = cfg.height;
        var g = tela.getContext('2d');
        NIVEIS.forEach(function (n, i) {
          g.fillStyle = 'rgb(' + n + ',' + n + ',' + n + ')'; g.fillRect(0, 0, cfg.width, cfg.height);
          var vf = new VideoFrame(tela, { timestamp: i * 33333 });
          var opc = { keyFrame: true }; if (cfg.bitrateMode === 'quantizer') opc.avc = { quantizer: 18 };
          enc.encode(vf, opc); vf.close();
        });
        enc.flush().then(function () {
          enc.close();
          info.etapa = 'decodificar'; info.chunks = chunks.length; info.avcC = !!avcC;
          if (chunks.length < 2 || !avcC) return sair('', 'sem quadros');
          var ys = [], leituras = [];
          var dec = new VideoDecoder({
            output: function (f) {
              var buf = new Uint8Array(f.allocationSize());
              leituras.push(f.copyTo(buf).then(function (lay) { var y = lay[0], meio = y.offset + (f.codedHeight >> 1) * y.stride + (f.codedWidth >> 1); ys.push(buf[meio]); f.close(); }, function () { f.close(); }));
            },
            error: function (e) { sair('', 'decodificador: ' + (e && e.message)); },
          });
          dec.configure({ codec: cfg.codec, description: avcC, hardwareAcceleration: 'prefer-software' });
          chunks.forEach(function (c) { dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: c.t, data: c.d })); });
          return dec.flush().then(function () { return Promise.all(leituras); }).then(function () {
            dec.close();
            info.ys = ys.slice();
            if (ys.length < 2) return sair('', 'sem leitura');
            var cheia = faixaCheia(avcC);
            info.cheia = cheia;
            /* o que o arquivo diz: faixa cheia (0..255) ou de TV (16..235); o que foi gravado: y = a*x + b */
            var a = (ys[1] - ys[0]) / (NIVEIS[1] - NIVEIS[0]), b = ys[0] - a * NIVEIS[0];
            var alvoA = cheia ? 1 : 219 / 255, alvoB = cheia ? 0 : 16;
            if (Math.abs(a - alvoA) < 0.03 && Math.abs(b - alvoB) < 3) return sair('');
            /* x' = ga*x + gb (0..1), para que a*x' + b caia no alvo; em CSS: contraste e depois brilho */
            var ga = alvoA / a, gb = (alvoB - b) / 255 / a;
            var br = 2 * gb + ga, ct = ga / br;
            if (!(br > 0.5 && br < 1.5 && ct > 0.5 && ct < 1.5)) return sair('');
            sair('contrast(' + ct.toFixed(4) + ') brightness(' + br.toFixed(4) + ')');
          });
        }).catch(function (e) { sair('', 'erro: ' + (e && e.message)); });
      } catch (e) { sair('', 'erro: ' + (e && e.message)); }
    });
  }

  /* ---------- a imagem: toca o video e codifica cada quadro que aparece ---------- */
  function comprimir(arquivo, o) {
    o = o || {};
    var maxSeg = o.max || 20, aoAndar = o.aoAndar || function () {}, qp = o.qp || QP;
    if (!suportado()) return Promise.reject(new Error('Este navegador não comprime vídeo.'));
    return (o.cfg ? Promise.resolve(o.cfg) : escolherCfg()).then(function (cfg) {
      return Promise.all([cfg, calibrar(cfg), arquivo.arrayBuffer()]);
    }).then(function (r) {
      var cfg = r[0], buffer = r[2];
      var filtroCor = [entradaFaixaCheia(buffer) ? FILTRO_FAIXA_CHEIA : '', r[1]].filter(Boolean).join(' ');
      var somPronto = codificarSom(buffer, maxSeg);
      return new Promise(function (ok, falhou) {
        var url = URL.createObjectURL(arquivo);
        var v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        var tela = document.createElement('canvas'); tela.width = W; tela.height = H;
        var g = tela.getContext('2d', { alpha: false });
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; /* reduz de 1080 para 720 sem serrilhar */
        if (filtroCor) g.filter = filtroCor;
        var amostras = [], avcC = null, erro = null, acabou = false, capa = null, ultimaChave = -1e9, dur = 0, ultimoT = -1;
        var enc = new VideoEncoder({
          output: function (chunk, meta) {
            var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
            if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) {
              var desc = meta.decoderConfig.description;
              avcC = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
            }
            amostras.push({ dados: d, pts: Math.round(chunk.timestamp * 90 / 1000), dur: chunk.duration ? Math.round(chunk.duration * 90 / 1000) : 3000, chave: chunk.type === 'key' });
          },
          error: function (e) { erro = e; },
        });
        enc.configure(cfg);
        var quantizer = cfg.bitrateMode === 'quantizer';
        function limpar() {
          document.removeEventListener('visibilitychange', escondeu);
          try { v.pause(); } catch (_) { /* ja parou */ }
          v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url);
        }
        function falhar(msg) { if (acabou) return; acabou = true; limpar(); try { enc.close(); } catch (_) { /* ja fechou */ } falhou(new Error(msg)); }
        /* aba escondida: o navegador para de entregar quadros e o video sairia com buracos */
        function escondeu() { if (document.hidden) falhar('A compressão parou porque a aba saiu da tela. Tente de novo e deixe esta aba aberta até terminar.'); }
        var esc = 1, dx = 0, dy = 0, dw = W, dh = H;
        function quadro(agora, meta) {
          if (acabou) return;
          var t = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : v.currentTime;
          if (t > ultimoT + 0.001 && t < dur + 0.001) {
            ultimoT = t;
            g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
            g.drawImage(v, dx, dy, dw, dh);
            var vf = new VideoFrame(tela, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
            var chave = t - ultimaChave >= 2;
            if (chave) ultimaChave = t;
            var opc = { keyFrame: chave };
            if (quantizer) opc.avc = { quantizer: qp };
            enc.encode(vf, opc); vf.close();
            if (!capa && t >= Math.min(1, dur / 2)) { capa = 'pedida'; tela.toBlob(function (b) { capa = b; }, 'image/jpeg', 0.82); }
            aoAndar(Math.min(0.99, t / dur));
          }
          if (t >= dur - 0.5 / FPS || v.ended) return terminar();
          v.requestVideoFrameCallback(quadro);
        }
        function terminar() {
          if (acabou) return;
          acabou = true; limpar();
          enc.flush().then(function () {
            enc.close();
            if (erro || !amostras.length || !avcC) throw new Error('A compressão falhou. Tente de novo.');
            return somPronto;
          }).then(function (som) {
            var vid = { video: true, escala: 90000, amostras: amostras, entrada: entradaVideo(avcC) };
            var mp4 = montarMp4(vid, som);
            aoAndar(1);
            ok({ arquivo: mp4, dur: dur, capa: capa instanceof Blob ? capa : null, som: !!som, modo: o.nome || (quantizer ? 'qp' + qp : 'vbr'), cor: filtroCor || 'direta' });
          }).catch(function (e) { falhou(e); });
        }
        v.addEventListener('error', function () { falhar('Esse arquivo não abre como vídeo. Use MP4 ou MOV.'); });
        v.addEventListener('ended', function () { if (!acabou) terminar(); });
        v.addEventListener('loadedmetadata', function () {
          var d = v.duration;
          if (!(d > 0) || !isFinite(d)) return falhar('Não deu para ler a duração do vídeo.');
          if (d > maxSeg + 1) return falhar('O vídeo tem ' + Math.round(d) + ' segundos. O limite é ' + maxSeg + '.');
          dur = Math.min(d, maxSeg);
          esc = Math.min(W / v.videoWidth, H / v.videoHeight); dw = Math.round(v.videoWidth * esc); dh = Math.round(v.videoHeight * esc); dx = Math.round((W - dw) / 2); dy = Math.round((H - dh) / 2);
          document.addEventListener('visibilitychange', escondeu);
          v.requestVideoFrameCallback(quadro);
          v.play().catch(function (e) { falhar('O navegador não deixou tocar o vídeo para comprimir (' + (e && e.name || 'erro') + '). Tente de novo.'); });
        });
      });
    });
  }

  window.LigeiroVideoLeve = { comprimir: comprimir, suportado: suportado, _mp4: montarMp4 };
})();
