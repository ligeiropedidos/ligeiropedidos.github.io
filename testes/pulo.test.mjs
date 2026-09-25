/*
 * Teste do Pulo do Ligeiro (js/pulo.js), sem navegador: a tela e o desenho sao de mentira.
 * Confere que sempre existe uma plataforma firme ao alcance do pulo, que pular, pousar, rasgar a caixa, a mola e a
 * volta pela beirada funcionam, que os poderes e os bichos fazem o que prometem, que um robo consegue subir 3 km sem
 * cair, que a memoria nao cresce e quanto desenho cada quadro faz.
 * Rodar com:  node testes/pulo.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const codigo = fs.readFileSync(path.join(aqui, '..', 'js', 'pulo.js'), 'utf8');

/* ---- navegador de mentira ---- */
let chamadasDesenho = 0;
const ctx2d = new Proxy({}, {
  get(alvo, nome) {
    if (nome in alvo) return alvo[nome];
    if (nome === 'createLinearGradient' || nome === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (nome === 'measureText') return (t) => ({ width: String(t).length * 12 });
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
  Image: function () { const img = { complete: true, naturalWidth: 192, naturalHeight: 192 }; setTimeout(() => img.onload && img.onload(), 0); return img; },
  setTimeout, clearTimeout, setInterval, clearInterval,
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
janela.LigeiroRegras = { dinheiro: (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',') };
const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error }));
vm.runInContext(codigo, contexto);
const LP = janela.LigeiroPulo;
const T = LP._teste;
const K = T.constantes;

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }
function textoDe(no) { return (no.textContent || '') + ' ' + (no.children || []).map(textoDe).join(' '); }
function acha(no, classe) { if (!no) return null; if (String(no.class || '').split(' ').indexOf(classe) >= 0) return no; for (const f of no.children || []) { const r = acha(f, classe); if (r) return r; } return null; }
function botao(no, texto) { if (!no) return null; if (no.tagName === 'BUTTON' && textoDe(no).indexOf(texto) >= 0) return no; for (const f of no.children || []) { const r = botao(f, texto); if (r) return r; } return null; }
const distX = (a, b) => { let d = ((a - b) % K.LARG + K.LARG) % K.LARG; return d > K.LARG / 2 ? d - K.LARG : d; };
const dt = 1 / 60;
/* roda seg segundos (ou ate o jogo parar: pausa, fim ou fechado); a queda final ('caindo') continua rodando */
function rodar(seg, cada) { for (let i = 0; i < Math.round(seg / dt); i++) { if (cada) cada(); T.passo(dt); const f = T.estado() && T.estado().fase; if (f !== 'jogando' && f !== 'caindo') break; } }
/* um cenario limpo: so o que o teste poe */
function limparCena(j) { j.plats = []; j.moe = []; j.pod = []; j.bic = []; j.ped = []; j.part = []; j.textos = []; j.ultimaY = 1e9; }

LP.abrir({ cidade: 'Juquiá', rotulo: 'Senha 12 · Preparando' });
await new Promise((r) => setTimeout(r, 10));
const J = () => T.estado();
ok(J() && J().fase === 'inicio', 'abre na tela de inicio');
ok(K.VAO_TETO < K.ALTURA_PULO * 0.85, 'o maior vao (' + K.VAO_TETO + ') e menor que o pulo (' + Math.round(K.ALTURA_PULO) + ') com folga');

/* ---- 1. as plataformas geradas ---- */
console.log('Plataformas geradas');
T.comecar();
T.gerarAte(60000);
{
  const j = J();
  const deGato = new Set(j.bic.filter((e) => e.tipo === 'gato').map((e) => e.plat));
  const firmes = j.plats.filter((p) => p.tipo !== 'quebra' && !deGato.has(p)).sort((a, b) => a.y - b.y);
  let maior = 0, onde = 0;
  for (let i = 1; i < firmes.length; i++) { const v = firmes[i].y - firmes[i - 1].y; if (v > maior) { maior = v; onde = firmes[i].y; } }
  ok(firmes.length > 300 && maior <= K.VAO_TETO + 0.01, 'ate 6 km, o maior vao entre tabuas firmes (sem contar as do gato) e ' + Math.round(maior) + ' (limite ' + K.VAO_TETO + ', em ' + Math.round(onde) + ')');
  ok(firmes[0].y <= 80, 'a primeira tabua sai perto do chao (' + Math.round(firmes[0].y) + ')');
  ok(j.plats.every((p) => p.x >= K.PLAT_L / 2 && p.x <= K.LARG - K.PLAT_L / 2), 'nenhuma tabua sai da tela');
  ok(j.plats.every((p) => !p.mola || p.tipo === 'normal'), 'mola so em tabua verde (nunca na caixa que rasga)');
  const gatos = j.bic.filter((e) => e.tipo === 'gato');
  let colado = 0;
  gatos.forEach((g) => {
    const perto = firmes.filter((p) => Math.abs(p.y - g.y) < K.ALTURA_PULO && p !== g.plat);
    const logoAbaixo = perto.filter((p) => p.y < g.y).pop(), logoAcima = perto.filter((p) => p.y > g.y)[0];
    [logoAbaixo, logoAcima].forEach((p) => { if (p && Math.abs(distX(p.x, g.x)) < 100) colado++; });
  });
  ok(gatos.length > 10 && colado === 0, 'o gato fica longe das tabuas do caminho logo abaixo e acima dele (' + gatos.length + ' gatos, ' + colado + ' colados)');
  /* ...e das outras tabuas paradas do caminho que ainda alcancam o gato num pulo (dois ou tres degraus abaixo): antes,
     16% dos gatos ficavam na coluna de uma delas e o pulo reto batia no gato. A tabua que anda nao tem coluna fixa.
     Sorteio com semente (30 subidas de 6 km): o resultado nao muda de uma rodada para outra */
  const sorteioDeVerdade = Math.random;
  let semente = 20260925;
  Math.random = () => { semente = (semente + 0x6D2B79F5) | 0; let t = Math.imul(semente ^ (semente >>> 15), 1 | semente); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let nGatos = 0, pares = 0, naColuna = 0, emCima = 0;
  try {
    for (let r = 0; r < 30; r++) {
      T.comecar(); T.gerarAte(60000);
      const s = J();
      const casas = new Set(s.bic.filter((e) => e.tipo === 'gato').map((e) => e.plat));
      const paradas = s.plats.filter((p) => p.tipo !== 'quebra' && p.tipo !== 'movel' && !casas.has(p));
      s.bic.filter((e) => e.tipo === 'gato').forEach((g) => {
        nGatos++;
        paradas.filter((p) => p.y < g.y && p.y + 30 + K.ALTURA_PULO > g.y + 22 - 36).forEach((p) => {
          pares++;
          const d = Math.abs(distX(p.x, g.x));
          if (d < 20) naColuna++;
          if (d < K.PLAT_L / 2 + K.PE) emCima++;
        });
      });
    }
  } finally { Math.random = sorteioDeVerdade; }
  ok(nGatos > 300 && naColuna === 0 && emCima <= pares * 0.02, 'nenhum gato na coluna de uma tabua parada do caminho a um pulo abaixo (' + nGatos + ' gatos, ' + pares + ' tabuas a um pulo, ' + naColuna + ' na coluna, ' + emCima + ' com o gato em cima da tabua)');
  const tipos = {};
  j.plats.forEach((p) => { tipos[p.tipo] = (tipos[p.tipo] || 0) + 1; });
  ok(tipos.normal > 0 && tipos.movel > 0 && tipos.quebra > 0 && j.plats.some((p) => p.mola) && j.pod.length > 10 && j.moe.length > 50, 'tem de tudo: ' + JSON.stringify(tipos) + ', ' + j.pod.length + ' poderes, ' + j.moe.length + ' moedas');
  const pombos = j.bic.filter((e) => e.tipo === 'pombo');
  ok(pombos.length > 3 && pombos.every((e) => e.y > 7000), 'pombo so aparece la no alto (' + pombos.length + ')');
  ok(!j.bic.some((e) => e.y < 3000), 'nenhum bicho na largada');
}

/* ---- 2. o pulo, a tabua, a caixa, a mola e a beirada ---- */
console.log('Fisica');
T.comecar();
{
  const j = J(); limparCena(j);
  let topo = 0;
  rodar(0.9, () => { topo = Math.max(topo, j.y); });
  ok(Math.abs(topo - K.ALTURA_PULO) < 8, 'do chao, o pulo sobe ' + Math.round(topo) + ' (esperado ' + Math.round(K.ALTURA_PULO) + ')');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.plats.push({ tipo: 'normal', x: 180, y: 120, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false });
  j.x = 180; j.y = 200; j.vy = -10;
  let menor = 1e9;
  rodar(0.6, () => { menor = Math.min(menor, j.y); });
  ok(j.pulos === 1 && menor > 110 && menor < 130, 'caindo em cima da tabua: pula de novo (o pe desceu ate ' + Math.round(menor) + ', a tabua esta em 120)');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.plats.push({ tipo: 'quebra', x: 180, y: 120, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false });
  j.x = 180; j.y = 200; j.vy = -10;
  rodar(0.4);
  ok(j.plats[0].quebrou && j.vy < 0 && j.y < 120 && j.ped.length === 2, 'caixa de papelao: rasga e o ratinho continua caindo');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.plats.push({ tipo: 'normal', x: 180, y: 120, vx: 0, mola: true, molaX: 0, molaT: 0, quebrou: false });
  j.x = 180; j.y = 150; j.vy = -10;
  let topo = 0;
  rodar(1.3, () => { topo = Math.max(topo, j.y); });
  const esperado = 120 + K.MOLA * K.MOLA / (2 * K.G);
  ok(Math.abs(topo - esperado) < 12, 'na mola, o pulo e bem maior (' + Math.round(topo - 120) + ' contra ' + Math.round(K.ALTURA_PULO) + ')');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.plats.push({ tipo: 'normal', x: 340, y: 120, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false });
  j.x = 8; j.y = 200; j.vy = -10;
  rodar(0.6);
  ok(j.pulos === 1, 'a tabua passando da beirada direita segura o ratinho que esta na beirada esquerda');
  j.x = 355; j.vx = K.VEL_LADO; T.lado(1);
  T.passo(0.05);
  ok(j.x < 30, 'saiu pela direita, entra pela esquerda (x = ' + Math.round(j.x) + ')');
  T.lado(0);
}
T.comecar();
{
  /* alcance de lado: no tempo de subir o maior vao e voltar a ele, anda mais que meia tela (o pior caso com a volta) */
  const j = J(); limparCena(j);
  j.plats.push({ tipo: 'normal', x: 180, y: 100, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false });
  j.x = 180; j.y = 100; j.vy = K.PULO; j.vx = 0;
  let andou = 0, xAntes = j.x, passou = false;
  rodar(1.2, () => {
    T.lado(1);
    andou += ((j.x - xAntes) % K.LARG + K.LARG) % K.LARG; xAntes = j.x;
    if (j.y > 100 + K.VAO_TETO) passou = true;
    if (passou && j.vy < 0 && j.y <= 100 + K.VAO_TETO) { j.fase = 'parar'; }
  });
  j.fase = 'jogando'; T.lado(0);
  ok(andou > K.LARG / 2 + K.PLAT_L / 2, 'no pulo do maior vao, da para andar ' + Math.round(andou) + ' de lado (precisa de ' + (K.LARG / 2 + K.PLAT_L / 2) + ' no pior caso)');
}

/* ---- 3. um robo joga sozinho: sobe 3 km sem cair (sem bichos, para testar so o caminho), varias vezes ---- */
console.log('Robo');
/* escolhe a tabua firme mais alta que da para alcancar de lado no tempo que o pulo (ou a queda) da */
function alcancavel(j, p) {
  const dy = p.y - j.y;
  if (!(j.vy > 0 || dy < 0)) return false;
  /* subindo: so mira no que fica ate 80% do que ainda falta subir (no limite do pulo, o robo erra e tenta de novo para sempre) */
  if (dy > 0 && dy > (j.vy * j.vy) / (2 * K.G) * 0.8) return false;
  const disc = j.vy * j.vy - 2 * K.G * dy;
  if (disc < 0) return false;
  return Math.abs(distX(p.x, j.x)) <= K.VEL_LADO * ((j.vy + Math.sqrt(disc)) / K.G) - 40;
}
function escolher(j) {
  const ops = j.plats.filter((p) => p.tipo !== 'quebra' && !p.quebrou && p.y > j.cam - 20 && (j.vy > 0 ? p.y > j.y + 5 : p.y <= j.y) && alcancavel(j, p));
  ops.sort((a, b) => b.y - a.y || Math.abs(distX(a.x, j.x)) - Math.abs(distX(b.x, j.x)));
  return ops[0] || null;
}
function robo(j, ate) {
  let alvo = null, vyAntes = 0, turboAntes = 0, seguro = 0, maiorCena = 0;
  while (j.fase === 'jogando' && j.topo < ate && seguro++ < 60 * 60 * 8) {
    j.bic = [];
    const pulou = j.vy > 0 && vyAntes <= 0, fimTurbo = turboAntes > 0 && j.turbo === 0;
    if (j.turbo > 0) alvo = null;
    else if (pulou || fimTurbo || !alvo || alvo.quebrou || (j.vy < 0 && alvo.y > j.y + 1)) alvo = escolher(j);
    vyAntes = j.vy; turboAntes = j.turbo;
    if (alvo) {
      const dx = distX(alvo.x, j.x), freio = (j.vx * j.vx) / (2 * K.ACEL_LADO);
      T.lado(Math.abs(dx) < 4 ? 0 : (Math.abs(dx) <= freio && Math.sign(dx) === Math.sign(j.vx) ? 0 : Math.sign(dx)));
    } else T.lado(0);
    T.passo(dt);
    maiorCena = Math.max(maiorCena, j.plats.length + j.moe.length + j.pod.length);
  }
  T.lado(0);
  return maiorCena;
}
{
  let subiram = 0, maiorCena = 0, j = null;
  for (let r = 0; r < 8; r++) { T.comecar(); j = J(); maiorCena = Math.max(maiorCena, robo(j, 30000)); if (j.topo >= 30000 && j.fase === 'jogando') subiram++; else if (process.env.DIARIO) console.log('   caiu', Math.round(j.topo), j.fase, j.motivo, 'tonto', j.tonto, 'cam', Math.round(j.cam), 'y', Math.round(j.y), 'x', Math.round(j.x), 'bic', j.bic.length, JSON.stringify(j.plats.filter((p) => p.y > j.cam - 60 && p.y < j.cam + 300).map((p) => [p.tipo, Math.round(p.x), Math.round(p.y), p.quebrou ? 'Q' : '']))); }
  ok(subiram === 8, 'em 8 partidas, o robo subiu 3 km sem cair em ' + subiram);
  ok(j.plats.length < 60 && j.moe.length < 60 && j.part.length < 80 && maiorCena < 140, 'la no alto, pouca coisa na memoria (' + j.plats.length + ' tabuas, ' + j.moe.length + ' moedas, maximo ' + maiorCena + ')');
  chamadasDesenho = 0;
  T.desenhar();
  ok(chamadasDesenho < 1500, 'um quadro inteiro faz ' + chamadasDesenho + ' chamadas de desenho (limite 1.500)');
}

/* ---- 4. moedas e poderes ---- */
console.log('Moedas e poderes');
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 0; j.y = 300; j.vy = 0; j.x = 180;
  j.moe.push({ x: 180, y: 330, pego: false }, { x: 330, y: 330, pego: false });
  T.passo(dt);
  ok(j.moedas === 1 && j.bonus === 5, 'pega a moeda que encosta, nao a do outro lado');
  j.ima = 8;
  rodar(0.4, () => { j.vy = 0; j.y = 300; });
  ok(j.moedas === 2, 'com o ima, a moeda longe vem sozinha');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 0; j.y = 300; j.vy = 0; j.x = 180;
  const caixa = { tipo: 'quebra', x: 180, y: 500, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false };
  const pombo = { tipo: 'pombo', x: 180, y: 900, vx: 0, caindo: false, rot: 0 };
  j.pod.push({ tipo: 'turbo', x: 180, y: 330 });
  j.plats.push(caixa); j.bic.push(pombo);
  const antes = j.y;
  rodar(1.0);
  ok(j.turbo > 0 && j.y - antes > 1100 && !caixa.quebrou, 'turbo: sobe voando e passa pelas tabuas (' + Math.round(j.y - antes) + ' em 1 s)');
  ok(pombo.caindo && j.bonus >= 15 && !j.tonto, 'turbo: derruba o pombo e ganha +15');
  rodar(1.4);
  ok(j.turbo === 0 && j.fase === 'jogando', 'o turbo acaba e o ratinho segue pulando');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 1000; j.y = 1100; j.vy = -900; j.x = 180; j.escudo = true;
  rodar(0.5);
  ok(j.fase === 'jogando' && !j.escudo && j.vy > 0, 'capacete: salva da queda uma vez');
  rodar(3);
  ok(j.fase === 'caindo' || j.fase === 'fim', 'sem capacete, a proxima queda acaba o jogo');
}

T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 120; j.y = 60; j.vy = -600;
  rodar(2);
  ok(j.fase === 'fim' && j.y >= 0 && j.cam >= -70.01, 'caiu perto da largada: fica no chao e a tela nao desce abaixo dele (y ' + Math.round(j.y) + ', tela ' + Math.round(j.cam) + ')');
}

/* ---- 5. o gato e o pombo ---- */
console.log('Bichos');
T.comecar();
{
  const j = J(); limparCena(j);
  const casa = { tipo: 'normal', x: 180, y: 400, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false };
  j.plats.push(casa); j.bic.push({ tipo: 'gato', x: 180, y: 400, plat: casa, caindo: false, rot: 0 });
  j.cam = 300; j.x = 180; j.y = 520; j.vy = -300;
  rodar(0.3);
  ok(j.bic[0].caindo && j.bonus === 25 && j.bichos === 1 && !j.tonto && j.vy > 0, 'caindo por cima do gato: pisa, ganha +25 e pula');
}
T.comecar();
{
  const j = J(); limparCena(j);
  const casa = { tipo: 'normal', x: 180, y: 400, vx: 0, mola: false, molaX: 0, molaT: 0, quebrou: false };
  j.plats.push(casa); j.bic.push({ tipo: 'gato', x: 180, y: 400, plat: casa, caindo: false, rot: 0 });
  j.cam = 300; j.x = 180; j.y = 330; j.vy = 700;
  rodar(0.3);
  ok(j.tonto && j.motivo === 'gato', 'subindo por baixo do gato: ele pega');
  rodar(4);
  const fim = j.fase === 'fim' ? textoDe(j.painel) : '';
  ok(/O gato pegou!/.test(fim), 'fim de jogo: "O gato pegou!"');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.bic.push({ tipo: 'gato', x: 180, y: 400, plat: null, caindo: false, rot: 0 });
  j.cam = 300; j.x = 180; j.y = 330; j.vy = 700; j.escudo = true;
  rodar(0.3);
  ok(!j.tonto && !j.escudo && j.bic[0].caindo, 'com capacete, o gato nao pega (e o capacete acaba)');
}
T.comecar();
{
  const j = J(); limparCena(j);
  j.bic.push({ tipo: 'pombo', x: 100, y: 440, vx: 80, caindo: false, rot: 0 });
  j.cam = 300; j.x = 180; j.y = 420; j.vy = 200;
  rodar(1.2, () => { if (!j.tonto) { j.vy = 0; j.y = 420; } }); /* parado no ar, esperando o pombo chegar */
  ok(j.tonto && j.motivo === 'pombo', 'o pombo voando de lado derruba quem estiver no caminho');
}

/* ---- 6. recorde, pausa, pedido andando e fechar ---- */
console.log('Recorde, pausa e fechar');
T.comecar();
{
  const j = J(); limparCena(j);
  j.topo = 4200; j.bonus = 30; j.cam = 4000; j.y = 3900; j.vy = -800;
  rodar(2.5);
  ok(j.fase === 'fim' && Number(guardado['ligeiro:pulo:recorde']) === 450, 'fim: recorde guardado no aparelho (' + guardado['ligeiro:pulo:recorde'] + ')');
  ok(/Novo recorde!/.test(textoDe(j.painel)) && /450/.test(textoDe(j.painel)), 'a tela do fim mostra o recorde novo e os pontos');
  ok(guardado['ligeiro:jogo:recorde'] === undefined, 'nao mexe no recorde da Corrida');
}
T.comecar();
{
  const j = J();
  LP.pedidoMudou({}, 'Senha 12 · Pronto', true);
  ok(j.fase === 'pausa' && /Senha 12 · Pronto/.test(textoDe(j.painel)), 'pedido pronto: o jogo pausa e pergunta');
  botao(j.painel, 'Continuar').onclick();
  ok(j.fase === 'contagem', 'continuar: volta com a contagem');
  T.passo(1); T.passo(1.1);
  ok(j.fase === 'jogando', 'depois da contagem, segue o jogo');
  LP.pedidoMudou({}, 'Senha 12 · Saiu para entrega', false);
  ok(j.fase === 'jogando' && j.elAviso.textContent === 'Seu pedido: Senha 12 · Saiu para entrega', 'mudanca pequena: so o recado, sem pausar');
}
ok(!/firestore|fetch\(|firebase|XMLHttpRequest|localStorage/i.test(codigo.replace(/\/\*[\s\S]*?\*\//g, '')), 'o jogo nao chama banco nem internet (e guarda so pelo site)');
LP.fechar();
ok(!LP.aberto(), 'fecha e solta tudo');

/* ---- 7. os lanches da loja viram os poderes e o "Bateu fome?" ---- */
console.log('Lanches da loja');
let visto = null, aberta = true;
LP.abrir({ cidade: 'Registro', nomeLoja: 'Dom Conizza', produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400, emoji: '🍔', foto: 'x.webp' }, { id: 'cone', nome: 'Pizza Cone', preco: 1800, emoji: '🍕' }], podePedir: () => aberta, aoVerProduto: (id) => { visto = id; } });
await new Promise((r) => setTimeout(r, 20));
ok(J() && J().fase === 'inicio' && /Dom Conizza viram poderes/.test(textoDe(J().painel)), 'abre com os lanches da loja no texto da tela de inicio');
ok(/X-Bacon/.test(textoDe(J().painel)) && /dá turbo/.test(textoDe(J().painel)), 'o primeiro lanche e o turbo');
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 0; j.y = 300; j.vy = 0; j.x = 180;
  j.pod.push({ tipo: 'turbo', x: 180, y: 330 });
  T.passo(dt);
  ok(j.pegos['x-bacon'] === 1 && j.textos.some((t) => t.t === 'X-Bacon: turbo!'), 'pegou o poder do X-Bacon: o recado diz "X-Bacon: turbo!"');
  j.turbo = 0; j.cam = 3000; j.y = 2900; j.vy = -800; j.topo = 20;
  rodar(2.5);
  const fome = acha(j.painel, 'pulo-fome');
  ok(j.fase === 'fim' && fome && /Bateu fome\?/.test(textoDe(fome)) && /X-Bacon por R\$ 24,00/.test(textoDe(fome)), 'fim: "Bateu fome?" com o lanche que mais pegou e o preco');
  botao(fome, 'Ver no cardápio').onclick();
  ok(visto === 'x-bacon' && !LP.aberto(), '"Ver no cardápio" fecha o jogo e leva ao X-Bacon');
}
LP.abrir({ cidade: 'Registro', nomeLoja: 'Dom Conizza', produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400 }], podePedir: () => aberta, aoVerProduto: () => {} });
await new Promise((r) => setTimeout(r, 20));
aberta = false;
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 3000; j.y = 2900; j.vy = -800;
  rodar(2.5);
  ok(j.fase === 'fim' && !acha(j.painel, 'pulo-fome'), 'loja fechou durante o jogo: sem "Bateu fome?"');
}
LP.fechar();

/* ---- 8. outra loja da mesma cidade com um lanche de mesmo id: o jogo mostra o lanche dela, nao o da anterior ---- */
console.log('Troca de loja, foto carregando e som');
LP.abrir({ cidade: 'Registro', nomeLoja: 'Lanche do Zé', produtos: [{ id: 'x-bacon', nome: 'X-Bacon', preco: 2400, emoji: '🍔' }], podePedir: () => true, aoVerProduto: () => {} });
await new Promise((r) => setTimeout(r, 20));
LP.fechar();
LP.abrir({ cidade: 'Registro', nomeLoja: 'Burguer da Praça', produtos: [{ id: 'x-bacon', nome: 'X-Bacon Duplo', preco: 3900, emoji: '🌭' }], podePedir: () => true, aoVerProduto: () => {} });
await new Promise((r) => setTimeout(r, 20));
ok(/X-Bacon Duplo/.test(textoDe(J().painel)), 'tela de inicio da outra loja: o lanche dela');
T.comecar();
{
  const j = J(); limparCena(j);
  j.cam = 0; j.y = 300; j.vy = 0; j.x = 180;
  j.pod.push({ tipo: 'turbo', x: 180, y: 330 });
  T.passo(dt);
  const recado = j.textos.some((t) => t.t === 'X-Bacon Duplo: turbo!');
  j.turbo = 0; j.cam = 3000; j.y = 2900; j.vy = -800; j.topo = 20;
  rodar(2.5);
  const fome = acha(j.painel, 'pulo-fome');
  ok(recado && fome && /🌭/.test(textoDe(fome)) && /X-Bacon Duplo por R\$ 39,00/.test(textoDe(fome)), 'fim na outra loja: "Bateu fome?" com o nome, o emoji e o preco dela');
}
LP.fechar();

/* um jogo novo (sem desenhos ainda, como na primeira vez), com a foto que demora a carregar, o som de mentira e os
   eventos da janela guardados para disparar na hora que o teste quiser */
function puloNovo(atrasoFoto) {
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
  return { M: jan.LigeiroPulo, audios, disparar: (tipo) => (ouvintes[tipo] || []).slice().forEach((f) => f({})) };
}

/* girar o celular ou voltar para a aba enquanto a foto do lanche carrega (a primeira vez): antes dava TypeError */
{
  const n = puloNovo(300);
  n.M.abrir({ cidade: 'Juquiá', produtos: [{ id: 'a', nome: 'A', preco: 100, foto: 'data:image/png;base64,AAAA' }] });
  let erro = null;
  try { n.disparar('resize'); n.disparar('visibilitychange'); } catch (e) { erro = e; }
  await new Promise((r) => setTimeout(r, 500));
  ok(!erro && n.M._teste.estado() && n.M._teste.estado().fase === 'inicio', 'girar o celular ou voltar para a aba com a foto carregando: sem erro, e o jogo abre depois' + (erro ? ' (' + erro.message + ')' : ''));
  n.M.fechar();
}

/* o som dorme quando fecha e acorda de qualquer parada (inclusive a "interrupted" do iPhone) */
{
  const n = puloNovo(0);
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
  n.M._teste.comecar();
  ok(a.state === 'running', 'depois de uma ligacao no iPhone (interrupted): o proximo toque acorda o som');
  n.M.fechar();
  n.M.abrir({ cidade: 'Juquiá' });
  await new Promise((r) => setTimeout(r, 600));
  ok(a.state === 'running', 'fechou e abriu logo em seguida: o som nao dorme por cima do jogo aberto');
  n.M.fechar();
}

console.log('\n' + (total - falhas) + ' de ' + total + ' conferencias passaram');
if (falhas) process.exit(1);
