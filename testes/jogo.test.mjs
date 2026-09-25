/*
 * Teste da Corrida do Ligeiro (js/jogo.js), sem navegador: a tela e o desenho sao de mentira.
 * Confere que a rua nunca fecha as 3 faixas, que da tempo de trocar de faixa, que bater, pular e pegar moeda
 * funcionam, que a memoria nao cresce numa corrida longa e quanto desenho cada quadro faz.
 * Rodar com:  node testes/jogo.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const codigo = fs.readFileSync(path.join(aqui, '..', 'js', 'jogo.js'), 'utf8');

/* ---- navegador de mentira ---- */
let chamadasDesenho = 0;
const ctx2d = new Proxy({}, {
  get(alvo, nome) {
    if (nome in alvo) return alvo[nome];
    if (nome === 'createLinearGradient' || nome === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => { chamadasDesenho++; };
  },
  set(alvo, nome, valor) { alvo[nome] = valor; return true; },
});
function elemento(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], hidden: false, textContent: '', parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    appendChild(f) { if (f) { f.parentNode = e; e.children.push(f); } return f; },
    removeChild(f) { e.children = e.children.filter((x) => x !== f); return f; },
    getBoundingClientRect() { return { width: 375, height: 812, left: 0, top: 0 }; },
    getContext() { return ctx2d; },
    width: 0, height: 0,
  };
  return e;
}
const documento = {
  hidden: false,
  body: elemento('body'), head: elemento('head'), documentElement: elemento('html'),
  createElement: elemento, getElementById() { return null; },
  addEventListener() {}, removeEventListener() {},
};
let quadros = [];
const janela = {
  document: documento,
  devicePixelRatio: 2,
  matchMedia() { return { matches: false }; },
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame(f) { quadros.push(f); return quadros.length; },
  cancelAnimationFrame() {},
  history: { pushState() {}, back() {}, state: null },
  navigator: { maxTouchPoints: 5 },
  Image: function () { const img = { complete: true, naturalWidth: 192 }; setTimeout(() => img.onload && img.onload(), 0); return img; },
  setTimeout, clearTimeout,
};
janela.window = janela;
const guardado = {};
janela.LigeiroUI = {
  el(tag, atr, filhos) {
    const e = elemento(tag); Object.assign(e, atr || {}); if (atr && atr.text) e.textContent = atr.text;
    [].concat(filhos == null ? [] : filhos).forEach((f) => { if (f == null) return; if (typeof f === 'string') { const t = elemento('#text'); t.textContent = f; e.appendChild(t); } else e.appendChild(f); });
    return e;
  },
  iconeLinha() { return elemento('span'); },
  limpar(e) { e.children = []; },
  lerLocal(k) { return k in guardado ? guardado[k] : null; },
  guardarLocal(k, v) { guardado[k] = v; },
};
const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error }));
vm.runInContext(codigo, contexto);
const LJ = janela.LigeiroJogo;
const T = LJ._teste;

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }

LJ.abrir({ cidade: 'Juquiá', rotulo: 'Senha 12 · Preparando' });
await new Promise((r) => setTimeout(r, 10));
const J = () => T.estado();
ok(J() && J().fase === 'inicio', 'abre na tela de inicio');

/* ---- 1. a rua gerada: nunca fecha as 3 faixas e da tempo de trocar ---- */
console.log('Rua gerada');
T.comecar();
const vistos = new Set();
const bloqueios = []; /* {faixa, de, ate, pula} em metros desde a largada */
const dt = 1 / 60;
let seguro = 0;
/* a moto fica fora da rua (faixa 9): nada bate, e da para ver tudo o que o jogo gera */
while (J().dist < 12000 && seguro++ < 200000) {
  J().x = 9; J().alvo = 9; J().tPulo = -1; J().alt = 3; /* fora da rua e sempre no alto: nada bate (nem a lombada) */
  T.passo(dt);
  for (const o of J().obj) {
    if (vistos.has(o)) continue;
    vistos.add(o);
    const tipo = { cone: [true, 0.5], buraco: [true, 1.4], lombada: [true, 0.9], cachorro: [true, 1.0], carro: [false, 3.8], caminhao: [false, 6.5] }[o.tipo];
    if (!tipo) continue;
    const de = o.z + J().dist;
    /* o vira-lata nasce na beira da rua e chega na moto quando esta no meio dela */
    const faixas = o.tipo === 'lombada' ? [-1, 0, 1] : o.tipo === 'cachorro' ? [0] : [o.faixa];
    faixas.forEach((f) => bloqueios.push({ faixa: f, de, ate: de + tipo[1], pula: tipo[0] }));
  }
}
ok(J().fase === 'jogando' && J().dist >= 12000, 'corrida de 12 km simulada (' + Math.round(J().dist) + ' m, ' + bloqueios.length + ' obstaculos)');
const velEm = (d) => 12 + 19 * (1 - Math.exp(-d / 1500));
let fechou = 0;
for (let z = 50; z < 11800; z += 0.25) {
  const presos = new Set(bloqueios.filter((b) => !b.pula && z >= b.de - 0.6 && z <= b.ate + 0.2).map((b) => b.faixa));
  if (presos.size >= 3) fechou++;
}
ok(fechou === 0, 'nenhum ponto da rua com as 3 faixas fechadas por carro ou caminhao');
/* planejamento: de faixa em faixa, cada troca leva 0,22 s (a moto passa pelas duas faixas nesse tempo) */
const passo = 0.5;
let alcanca = new Set([-1, 0, 1]);
let travou = -1;
const livre = (f, z) => !bloqueios.some((b) => b.faixa === f && z >= b.de - 0.6 && z <= b.ate + 0.2 && !b.pula);
for (let z = 40; z < 11800 && travou < 0; z += passo) {
  const troca = Math.ceil((velEm(z) * 0.22) / passo);
  const prox = new Set();
  alcanca.forEach((f) => {
    if (livre(f, z + passo)) prox.add(f);
    [-1, 1].forEach((d) => {
      const g = f + d;
      if (g < -1 || g > 1) return;
      let cabe = true;
      for (let i = 1; i <= troca && cabe; i++) cabe = livre(f, z + i * passo) && livre(g, z + i * passo);
      if (cabe) prox.add(g);
    });
  });
  /* quem ainda nao trocou continua podendo seguir na faixa dele enquanto ela esta livre */
  alcanca = prox;
  if (!alcanca.size) travou = z;
}
ok(travou < 0, 'sempre existe um caminho possivel com trocas de faixa de 0,22 s' + (travou >= 0 ? ' (travou em ' + travou + ' m)' : ''));
const pulosSeguidos = bloqueios.filter((b) => b.pula).sort((a, b) => a.de - b.de);
let pertoDemais = 0;
for (let i = 1; i < pulosSeguidos.length; i++) {
  const a = pulosSeguidos[i - 1], b = pulosSeguidos[i];
  if (a.faixa === b.faixa && b.de - a.ate < velEm(a.de) * 0.8 && b.de - a.ate > 0.1) pertoDemais++;
}
ok(pertoDemais === 0, 'nada para pular colado no pouso de outro pulo na mesma faixa (' + pertoDemais + ')');

/* ---- 2. memoria e desenho ---- */
console.log('Memoria e desenho');
ok(J().obj.length < 150 && J().cena.length < 120 && J().part.length < 60, 'depois de 12 km, poucas coisas na memoria (' + J().obj.length + ' objetos, ' + J().cena.length + ' de cenario)');
chamadasDesenho = 0;
T.desenhar();
ok(chamadasDesenho < 2500, 'um quadro inteiro faz ' + chamadasDesenho + ' chamadas de desenho (limite 2.500)');

/* ---- 3. bater, pular e pegar moeda ---- */
console.log('Bater, pular e moeda');
function corridaLimpa() {
  T.comecar();
  const j = J();
  j.obj.length = 0; j.proxPadrao = 1e9; j.x = 0; j.alvo = 0;
  return j;
}
let j = corridaLimpa();
j.obj.push({ tipo: 'cone', faixa: 0, z: 4, alt: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'batendo', 'cone na faixa, sem pular: bate');
j = corridaLimpa();
j.obj.push({ tipo: 'cone', faixa: 0, z: j.vel * 0.3, alt: 0 });
T.pular();
for (let i = 0; i < 90 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando', 'pulando na hora: passa por cima do cone');
j = corridaLimpa();
j.obj.push({ tipo: 'carro', faixa: 0, z: j.vel * 0.3, alt: 0, cor: 0 });
T.pular();
for (let i = 0; i < 90 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'batendo', 'carro nao da para pular');
j = corridaLimpa();
j.obj.push({ tipo: 'carro', faixa: 0, z: 8, alt: 0, cor: 0 });
T.faixa(1);
for (let i = 0; i < 90 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando' && j.alvo === 1, 'trocando de faixa: desvia do carro');
j = corridaLimpa();
j.obj.push({ tipo: 'lombada', faixa: 0, z: 5, alt: 0 });
T.faixa(-1);
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'batendo', 'lombada pega a rua inteira: trocar de faixa nao adianta');
j = corridaLimpa();
j.obj.push({ tipo: 'moeda', faixa: 0, z: 3, alt: 0.7 }, { tipo: 'moeda', faixa: 1, z: 3, alt: 0.7 });
for (let i = 0; i < 40; i++) T.passo(dt);
ok(j.moedas === 1, 'pega a moeda da faixa, nao a da faixa do lado');
j = corridaLimpa();
j.ima = 8;
j.obj.push({ tipo: 'moeda', faixa: 1, z: 10, alt: 0.7 }, { tipo: 'moeda', faixa: -1, z: 12, alt: 0.7 });
for (let i = 0; i < 90; i++) T.passo(dt);
ok(j.moedas === 2, 'com o ima, as moedas das outras faixas vem sozinhas');
T.faixa(1); T.faixa(1); T.faixa(1);
ok(j.alvo === 1, 'nao sai da rua (para na ultima faixa)');

/* ---- 3b. poderes, vira-lata, combo e a noite ---- */
console.log('Poderes, vira-lata, combo e noite');
j = corridaLimpa();
j.turbo = 5;
j.obj.push({ tipo: 'carro', faixa: 0, z: 6, alt: 0, cor: 1 }, { tipo: 'caminhao', faixa: 0, z: 30, alt: 0 });
for (let i = 0; i < 120 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando' && j.bonus >= 30, 'turbo: passa por carro e caminhao e ganha bonus (' + j.bonus + ')');
j = corridaLimpa();
j.escudo = true;
j.obj.push({ tipo: 'carro', faixa: 0, z: 5, alt: 0, cor: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando' && j.escudo === false, 'capacete: aguenta uma batida e acaba');
j.imune = 0;
j.obj.push({ tipo: 'carro', faixa: 0, z: 5, alt: 0, cor: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'batendo', 'sem capacete, a segunda batida acaba a corrida');
j = corridaLimpa();
j.obj.push({ tipo: 'cachorro', faixa: -1.9, z: j.vel * 2.3 + 3, alt: 0, vx: 1.55 });
let cruzou = false;
for (let i = 0; i < 400 && j.fase === 'jogando'; i++) { T.passo(dt); const c = j.obj.find((o) => o.tipo === 'cachorro'); if (c && Math.abs(c.faixa) < 0.5 && c.z > 0) cruzou = true; }
ok(cruzou, 'o vira-lata atravessa a rua na frente da moto');
j = corridaLimpa();
j.obj.push({ tipo: 'cachorro', faixa: 0, z: j.vel * 0.3, alt: 0, vx: 0, anda: true });
T.pular();
for (let i = 0; i < 90 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando', 'da para pular o vira-lata');
/* o vira-lata como a rua gera (na beira da rua, la no fundo): antes ele comecava a atravessar 2,3 s antes e ja tinha
   saido da rua do outro lado quando chegava na moto (nunca batia). Agora chega no meio da rua junto com a moto */
{
  let bateu = 0, desviou = 0, casos = 0;
  for (const dist of [250, 3000, 12000]) {
    for (const lado of [-1, 1]) {
      for (const troca of [0, -1, 1]) {
        j = corridaLimpa();
        j.dist = dist;
        T.passo(dt); /* acerta a velocidade */
        j.obj.push({ tipo: 'cachorro', faixa: lado * 1.9, z: 100, alt: 0, vx: -lado * 1.55 });
        let latiu = -1;
        for (let i = 0; i < 60 * 12 && j.fase === 'jogando'; i++) {
          const c = j.obj.find((o) => o.tipo === 'cachorro');
          if (c && c.anda && latiu < 0) latiu = i;
          /* quem ouve o latido troca de faixa 0,3 s depois */
          if (troca && latiu >= 0 && i === latiu + 18) T.faixa(troca);
          T.passo(dt);
        }
        casos++;
        if (!troca && j.fase !== 'jogando') bateu++;
        if (troca && j.fase === 'jogando') desviou++;
      }
    }
  }
  ok(bateu === 6, 'o vira-lata bate em quem fica parado no meio da rua (' + bateu + ' de 6)');
  ok(desviou === 12, 'quem ouve o latido e troca de faixa desvia, para qualquer lado (' + desviou + ' de 12)');
}
j = corridaLimpa();
for (let k = 0; k < 17; k++) j.obj.push({ tipo: 'moeda', faixa: 0, z: 2 + k * 1.5, alt: 0.7 });
for (let i = 0; i < 200; i++) T.passo(dt);
ok(j.moedas === 17 && j.mult === 3 && j.bonus === 7 * 10 + 8 * 20 + 2 * 30, 'combo: a 8a moeda seguida ja vale x2 e a 16a ja vale x3 (' + j.bonus + ' de bonus)');
for (let i = 0; i < 200; i++) T.passo(dt);
ok(j.mult === 1, 'sem pegar moeda por 3 segundos, o combo volta a x1');
j = corridaLimpa();
j.obj.push({ tipo: 'carro', faixa: 0, z: 4, alt: 0, cor: 0 });
for (let i = 0; i < 8; i++) T.passo(dt);
T.faixa(1);
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
ok(j.fase === 'jogando' && j.bonus === 25, 'desviou em cima da hora: "Por um triz" +25');
j = corridaLimpa();
j.dist = 2800; /* noite */
for (let i = 0; i < 30; i++) T.passo(dt);
chamadasDesenho = 0;
T.desenhar();
ok(j.noite > 0.9 && j.luzes.length > 0 && chamadasDesenho < 2500, 'de noite: postes e lanternas acesos, ' + (j.luzes.length / 4) + ' luzes e ' + chamadasDesenho + ' chamadas de desenho');

/* ---- 4. recorde no aparelho, nada no banco ---- */
console.log('Recorde');
j = corridaLimpa();
j.dist = 500; j.moedas = 7; j.bonus = 70;
j.obj.push({ tipo: 'cone', faixa: 0, z: 2, alt: 0 });
for (let i = 0; i < 30 && j.fase === 'jogando'; i++) T.passo(dt);
await new Promise((r) => setTimeout(r, 900));
ok(J().fase === 'fim' && Number(guardado['ligeiro:jogo:recorde']) >= 570, 'fim da corrida: recorde guardado no aparelho (' + guardado['ligeiro:jogo:recorde'] + ')');
ok(!/firestore|fetch\(|firebase|XMLHttpRequest/i.test(codigo.replace(/\/\*[\s\S]*?\*\//g, '')), 'o jogo nao chama banco nem internet');

LJ.fechar();
ok(!LJ.aberto(), 'fecha e solta tudo');

/* ---- 5. os lanches da loja viram os poderes; no fim, "Bateu fome?" leva ao lanche (nada do banco) ---- */
console.log('Lanches da loja');
let visto = null;
LJ.abrir({
  cidade: 'Registro', nomeLoja: 'Lanchonete do Zé', aoVerProduto: (id) => { visto = id; },
  produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400, emoji: '🍔', foto: '' }, { id: 'batata', nome: 'Batata frita', preco: 1200, emoji: '🍟', foto: '' }, { id: 'x-tudo', nome: 'X-Tudo', preco: 2800, foto: 'img/x-tudo.jpg' }],
});
await new Promise((r) => setTimeout(r, 20));
ok(J() && J().fase === 'inicio', 'abre com os lanches da loja (a foto vem do celular, sem esperar o banco)');
j = corridaLimpa();
j.obj.push({ tipo: 'turbo', faixa: 0, z: 0.5, alt: 0.9 });
T.passo(dt);
ok(j.pegos['x-bacon'] === 1 && j.textos.some((t) => t.t === 'X-Bacon: turbo!'), 'pegou o poder do X-Bacon: o recado diz "X-Bacon: turbo!"');
j.turbo = 0; j.imune = 0;
j.obj.push({ tipo: 'cone', faixa: 0, z: 3, alt: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
await new Promise((r) => setTimeout(r, 900));
const acha = (e, cls) => { if (!e) return null; if (String(e.class || e.className || '').split(' ').indexOf(cls) >= 0) return e; for (const f of e.children || []) { const r = acha(f, cls); if (r) return r; } return null; };
const fome = acha(J() && J().painel, 'jogo-fome');
const textoFome = fome ? JSON.stringify(fome.children.map((c) => (c.children || []).map((x) => x.textContent))) : '';
ok(J().fase === 'fim' && fome && /Bateu fome\?/.test(textoFome) && /X-Bacon por R\$ 24,00/.test(textoFome), 'fim: "Bateu fome?" com o lanche que mais pegou e o preço');
const botaoFome = fome && fome.children.find((c) => c.tagName === 'BUTTON');
botaoFome.onclick();
ok(visto === 'x-bacon' && !LJ.aberto(), '"Ver no cardápio" fecha o jogo e leva ao X-Bacon');
LJ.abrir({ cidade: 'Registro', nomeLoja: 'Lanchonete do Zé', aoVerProduto: () => {}, podePedir: () => false, produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400, emoji: '🍔', foto: '' }] });
await new Promise((r) => setTimeout(r, 20));
j = corridaLimpa();
j.obj.push({ tipo: 'cone', faixa: 0, z: 3, alt: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
await new Promise((r) => setTimeout(r, 900));
ok(J().fase === 'fim' && !acha(J().painel, 'jogo-fome'), 'loja fechou durante a corrida: sem "Bateu fome?"');
LJ.fechar();

/* ---- 6. outra loja da mesma cidade com um lanche de mesmo id: o jogo mostra o lanche dela, nao o da anterior ---- */
console.log('Troca de loja, foto carregando e som');
const textoDe = (no) => (no.textContent || '') + ' ' + (no.children || []).map(textoDe).join(' ');
LJ.abrir({ cidade: 'Registro', nomeLoja: 'Lanche do Zé', aoVerProduto() {}, podePedir: () => true, produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400, emoji: '🍔' }] });
await new Promise((r) => setTimeout(r, 20));
LJ.fechar();
LJ.abrir({ cidade: 'Registro', nomeLoja: 'Burguer da Praça', aoVerProduto() {}, podePedir: () => true, produtos: [{ id: 'x-bacon', nome: 'X-Bacon Duplo', preco: 3900, emoji: '🌭' }] });
await new Promise((r) => setTimeout(r, 20));
ok(/X-Bacon Duplo\s+dá turbo/.test(textoDe(J().painel)), 'tela de inicio da outra loja: o lanche dela');
j = corridaLimpa();
j.obj.push({ tipo: 'turbo', faixa: 0, z: 0.5, alt: 0.9 });
T.passo(dt);
j.turbo = 0; j.imune = 0;
j.obj.push({ tipo: 'cone', faixa: 0, z: 3, alt: 0 });
for (let i = 0; i < 60 && j.fase === 'jogando'; i++) T.passo(dt);
await new Promise((r) => setTimeout(r, 900));
const fomeB = acha(J().painel, 'jogo-fome');
ok(j.textos.some((t) => t.t === 'X-Bacon Duplo: turbo!') && fomeB && /🌭/.test(textoDe(fomeB)) && /X-Bacon Duplo por R\$ 39,00/.test(textoDe(fomeB)), 'fim na outra loja: "Bateu fome?" com o nome, o emoji e o preco dela');
LJ.fechar();

/* um jogo novo (sem desenhos ainda, como na primeira vez), com a foto que demora a carregar, o som de mentira e os
   eventos da janela guardados para disparar na hora que o teste quiser */
function jogoNovo(atrasoFoto) {
  const ouvintes = {};
  const por = (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); };
  const tirar = (tipo, fn) => { ouvintes[tipo] = (ouvintes[tipo] || []).filter((f) => f !== fn); };
  const audios = [];
  const no = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, buffer: null });
  const jan = Object.assign({}, janela, {
    document: Object.assign({}, documento, { addEventListener: por, removeEventListener: tirar }),
    addEventListener: por, removeEventListener: tirar,
    Image: function () {
      const img = { complete: false, naturalWidth: 0, naturalHeight: 0, dataset: {} };
      let src = '';
      Object.defineProperty(img, 'src', { get() { return src; }, set(v) { src = v; setTimeout(() => { img.complete = true; img.naturalWidth = img.naturalHeight = 192; if (img.onload) img.onload(); }, atrasoFoto); } });
      return img;
    },
    AudioContext: function () {
      const a = { state: 'running', currentTime: 0, sampleRate: 44100, destination: {}, createOscillator: no, createGain: no, createBufferSource: no, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
      a.resume = () => { a.state = 'running'; return Promise.resolve(); };
      a.suspend = () => { a.state = 'suspended'; return Promise.resolve(); };
      audios.push(a);
      return a;
    },
  });
  jan.window = jan;
  vm.createContext(jan);
  vm.runInContext(codigo, jan);
  return { M: jan.LigeiroJogo, audios, disparar: (tipo) => (ouvintes[tipo] || []).slice().forEach((f) => f({})) };
}

/* girar o celular ou voltar para a aba enquanto a foto do lanche carrega (a primeira vez): antes dava TypeError */
{
  const n = jogoNovo(300);
  n.M.abrir({ cidade: 'Juquiá', produtos: [{ id: 'a', nome: 'A', preco: 100, foto: 'data:image/png;base64,AAAA' }] });
  let erro = null;
  try { n.disparar('resize'); n.disparar('visibilitychange'); } catch (e) { erro = e; }
  await new Promise((r) => setTimeout(r, 800));
  ok(!erro && n.M._teste.estado() && n.M._teste.estado().fase === 'inicio', 'girar o celular ou voltar para a aba com a foto carregando: sem erro, e o jogo abre depois' + (erro ? ' (' + erro.message + ')' : ''));
  n.M.fechar();
}

/* o som dorme quando fecha e acorda de qualquer parada (inclusive a "interrupted" do iPhone) */
{
  const n = jogoNovo(0);
  n.M.abrir({ cidade: 'Juquiá' });
  await new Promise((r) => setTimeout(r, 20));
  n.M._teste.comecar();
  const a = n.audios[0];
  n.M.fechar();
  await new Promise((r) => setTimeout(r, 600));
  ok(a && a.state === 'suspended', 'fechou o jogo: o som dorme');
  n.M.abrir({ cidade: 'Juquiá' });
  await new Promise((r) => setTimeout(r, 20));
  n.M._teste.comecar();
  ok(a.state === 'running' && n.audios.length === 1, 'abriu de novo e jogou: o mesmo som acorda');
  a.state = 'interrupted';
  n.M._teste.pular();
  ok(a.state === 'running', 'depois de uma ligacao no iPhone (interrupted): o proximo som acorda');
  n.M.fechar();
  n.M.abrir({ cidade: 'Juquiá' });
  await new Promise((r) => setTimeout(r, 600));
  ok(a.state === 'running', 'fechou e abriu logo em seguida: o som nao dorme por cima do jogo aberto');
  n.M.fechar();
}

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
