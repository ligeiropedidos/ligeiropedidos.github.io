/*
 * Teste da camada de dados do site (js/dados.js) e do Mercado Pago do painel (js/mp.js), sem navegador e sem internet:
 * a tela, o relogio e o mensageiro sao de mentira.
 * Confere que a loja do cliente muda na hora quando o dono fecha a loja (publicarLoja), que nada fica preso num relogio
 * quando a tela some, que o aviso recusado tenta de novo, que as mensagens de erro certas chegam ao dono, que o
 * "Falta devolver" da demonstracao nao mostra o que ja foi devolvido e que a conexao do Mercado Pago nunca e apagada
 * por uma leitura que falhou.
 * Rodar com:  node testes/dados.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = require(path.join(aqui, '..', 'js', 'regras.js'));
const codigoDados = fs.readFileSync(path.join(aqui, '..', 'js', 'dados.js'), 'utf8');
const codigoMp = fs.readFileSync(path.join(aqui, '..', 'js', 'mp.js'), 'utf8');

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }
const esperar = () => new Promise((r) => setImmediate(r));
async function assentar() { for (let i = 0; i < 12; i++) await esperar(); }

/* ---- relogio de mentira: so anda quando o teste manda ---- */
function relogio() {
  let agora = 0, id = 0;
  const fila = [];
  return {
    setTimeout(f, ms) { id += 1; fila.push({ id, quando: agora + (ms || 0), f }); return id; },
    clearTimeout(i) { const k = fila.findIndex((t) => t.id === i); if (k >= 0) fila.splice(k, 1); },
    setInterval() { return 0; }, clearInterval() {},
    pendentes() { return fila.map((t) => t.quando - agora); },
    async andar(ms) {
      const fim = agora + ms;
      for (;;) {
        fila.sort((a, b) => a.quando - b.quando);
        const t = fila[0];
        if (!t || t.quando > fim) break;
        fila.shift();
        agora = t.quando;
        t.f();
        await assentar();
      }
      agora = fim;
      await assentar();
    },
  };
}

/* ---- navegador de mentira ---- */
function memoria() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, key: () => null, get length() { return 0; } }; }
function navegador(config, rel) {
  const ouvintesDoc = {}, ouvintesJanela = {};
  const documento = {
    hidden: false, visibilityState: 'visible',
    addEventListener(n, f) { (ouvintesDoc[n] = ouvintesDoc[n] || []).push(f); }, removeEventListener() {},
    createElement() { return { setAttribute() {} }; }, head: { appendChild() {} },
  };
  const chamadas = [];
  const respostas = [];
  const janela = {
    document: documento, LIGEIRO_CONFIG: config, LigeiroRegras: R, location: { hash: '#/painel/loja' }, navigator: { userAgent: 'teste' },
    sessionStorage: memoria(), localStorage: memoria(),
    addEventListener(n, f) { (ouvintesJanela[n] = ouvintesJanela[n] || []).push(f); }, removeEventListener() {},
    fetch(endereco, opcoes) {
      chamadas.push({ endereco, opcoes: opcoes || {} });
      const r = respostas.length ? respostas.shift() : { status: 200 };
      if (r.falhar) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.corpo || { ok: r.status === 200 }) });
    },
    setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, setInterval: rel.setInterval, clearInterval: rel.clearInterval,
    Uint8Array, crypto: { getRandomValues: (b) => b },
  };
  janela.window = janela;
  const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, TypeError, RegExp, Symbol }));
  vm.runInContext(codigoDados, contexto);
  return {
    janela, chamadas, respostas,
    esconder() { documento.hidden = true; documento.visibilityState = 'hidden'; (ouvintesDoc.visibilitychange || []).forEach((f) => f()); },
    sair() { (ouvintesJanela.pagehide || []).forEach((f) => f()); },
  };
}

const NUVEM = { firebase: { projectId: 'teste' }, proxyMercadoPago: 'https://borda.teste/' };
function lojaNaNuvem() {
  const rel = relogio();
  const n = navegador(NUVEM, rel);
  const store = n.janela.LigeiroDados.store;
  store.obterIdToken = () => Promise.resolve('tok-dono');
  const publicacoes = () => n.chamadas.filter((c) => c.endereco === 'https://borda.teste/publicar');
  return { rel, n, store, publicacoes };
}

console.log('publicarLoja: a loja do cliente muda na hora');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  ok(store.tipo === 'firebase', 'com o Firebase configurado, o store e o da nuvem');
  store.publicarLoja('loja', { agora: true });
  await assentar();
  ok(publicacoes().length === 1, 'fechar a loja (agora) chama /publicar sem esperar relogio nenhum');
  const c = publicacoes()[0];
  ok(c && c.opcoes.method === 'POST' && JSON.parse(c.opcoes.body).loja === 'loja', 'manda a loja certa, por POST');
  ok(c && c.opcoes.headers.Authorization === 'Bearer tok-dono', 'com o login do dono');
  ok(c && c.opcoes.keepalive === true, 'com keepalive (sai mesmo se a pagina for embora)');
  ok(rel.pendentes().length === 0, 'deu certo: nada fica esperando');
}

console.log('publicarLoja: preco e texto esperam a folga de 1,5 s e saem uma vez so');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja'); store.publicarLoja('loja'); store.publicarLoja('loja');
  await assentar();
  ok(publicacoes().length === 0, 'tres gravacoes seguidas: ainda nao publicou');
  await rel.andar(1499);
  ok(publicacoes().length === 0, 'antes de 1,5 s, nada');
  await rel.andar(2);
  ok(publicacoes().length === 1, 'depois da folga, um aviso so pelas tres');
}

console.log('publicarLoja: urgente passa na frente da folga');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja');
  await assentar();
  store.publicarLoja('loja', { agora: true });
  await assentar();
  ok(publicacoes().length === 1, 'a urgente sai na hora');
  await rel.andar(5000);
  ok(publicacoes().length === 1, 'e leva junto a que esperava (sem aviso repetido)');
}

console.log('publicarLoja: a tela sumiu (celular bloqueado) com aviso esperando');
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja');
  await assentar();
  ok(publicacoes().length === 0, 'esperando a folga');
  n.esconder();
  await assentar();
  ok(publicacoes().length === 1, 'a tela apagou: o aviso sai na hora (o relogio pararia com a tela apagada)');
  ok(publicacoes()[0] && publicacoes()[0].opcoes.keepalive === true, 'com keepalive');
  await rel.andar(5000);
  ok(publicacoes().length === 1, 'e o relogio velho nao manda de novo');
  store.publicarLoja('loja');
  await assentar();
  n.sair();
  await assentar();
  ok(publicacoes().length === 2, 'fechar a aba (pagehide) tambem manda o que esperava');
  n.esconder();
  await assentar();
  ok(publicacoes().length === 2, 'sem nada esperando, esconder a tela nao chama ninguem');
}

console.log('publicarLoja: mensageiro recusou por pressa (429, o antigo conta 6 por minuto) ou caiu (5xx)');
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 429 }, { status: 429 }, { status: 200 });
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await assentar();
  ok(publicacoes().length === 1 && resultado === false, '429: responde que nao deu');
  await rel.andar(19999);
  ok(publicacoes().length === 1, 'nao insiste antes de 20 s');
  await rel.andar(1);
  ok(publicacoes().length === 2, 'tenta de novo aos 20 s');
  await rel.andar(61000);
  ok(publicacoes().length === 3, 'e mais uma vez 61 s depois (a janela do mensageiro antigo ja passou)');
  await rel.andar(600000);
  ok(publicacoes().length === 3, 'deu certo: para de tentar');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ falhar: true }, { status: 503 }, { status: 500 }, { status: 500 });
  store.publicarLoja('loja', { agora: true });
  await assentar();
  const logo = publicacoes().length;
  ok(logo === 2 && publicacoes()[1].opcoes.keepalive === undefined, 'o keepalive foi recusado: vai de novo sem ele, na hora (e o mensageiro respondeu 503)');
  await rel.andar(3000);
  ok(publicacoes().length === 3, 'falha: tenta de novo em 3 s');
  await rel.andar(15000);
  ok(publicacoes().length === 4, 'e em mais 15 s');
  await rel.andar(600000);
  ok(publicacoes().length === 4, 'depois de duas tentativas, para (a copia vence sozinha)');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 202, corpo: { ok: true, depois: true } });
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await rel.andar(600000);
  ok(resultado === true && publicacoes().length === 1, '202 (mensageiro novo no limite: ele mesmo refaz a copia em 10 s): vale como feito, sem repetir');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 403 });
  store.publicarLoja('loja', { agora: true });
  await rel.andar(600000);
  ok(publicacoes().length === 1, '403 (loja de outro): nao insiste');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 429 });
  store.publicarLoja('loja', { agora: true });
  await assentar();
  store.publicarLoja('loja');
  await rel.andar(1500);
  ok(publicacoes().length === 2, 'mudanca nova durante a espera da nova tentativa: sai na folga normal');
  await rel.andar(600000);
  ok(publicacoes().length === 2, 'e a tentativa velha nao vai de novo');
}
{
  const rel = relogio();
  const n = navegador(NUVEM, rel);
  const store = n.janela.LigeiroDados.store;
  store.obterIdToken = () => Promise.reject(new Error('Entre na sua conta primeiro.'));
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await rel.andar(600000);
  ok(resultado === false && n.chamadas.length === 0, 'sem login: nao chama o mensageiro e responde que nao deu');
}

console.log('erroAmigavel: a mensagem certa chega ao dono');
{
  const rel = relogio();
  const D = navegador(NUVEM, rel).janela.LigeiroDados;
  const padrao = 'Não deu para salvar agora.';
  ok(D.erroAmigavel(new Error('Senha fácil demais: evite números repetidos ou em sequência.'), padrao).indexOf('Senha fácil demais') === 0, 'portugues com "demais" (tem "is" dentro) passa');
  ok(D.erroAmigavel(new Error('Cannot read properties of undefined (reading \'x\')'), padrao) === padrao, 'mensagem tecnica em ingles vira a padrao');
  ok(D.erroAmigavel(new Error('Unexpected token < in JSON at position 0'), padrao) === padrao, 'erro de JSON vira a padrao');
  ok(D.erroAmigavel(new Error('This is not valid'), padrao) === padrao, '"is" e "not" como palavras inteiras sao ingles');
  const email = new Error('Falta confirmar o seu e-mail. Mandamos um link para is.of@get.com.');
  email.publico = true;
  ok(D.erroAmigavel(email, padrao) === email.message, 'mensagem nossa (publico) passa inteira, mesmo com e-mail que parece ingles');
  ok(D.erroAmigavel({ code: 'permission-denied', message: 'x' }, padrao) === 'Sua sessão caiu. Entre de novo.', 'permissao negada continua dizendo que a sessao caiu');
}

console.log('Falta devolver na demonstracao');
{
  const rel = relogio();
  const n = navegador({}, rel);
  const store = n.janela.LigeiroDados.store;
  ok(store.tipo === 'demo', 'sem o Firebase: demonstracao');
  const agora = new Date().toISOString();
  const base = { status: 'cancelado', formaPagamento: 'pix', total: 1000, criadoEm: agora, mp: { id: 'SIM-1' } };
  n.janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify({ lojas: {}, pedidos: { loja: {
    a: Object.assign({ id: 'a', pagamentoStatus: 'pago' }, base),
    b: Object.assign({ id: 'b', pagamentoStatus: 'pago', devolvidoEm: agora }, base),
    c: Object.assign({ id: 'c', pagamentoStatus: 'devolvido', devolvidoEm: agora }, base),
  } } }));
  const lista = await store.listarPedidos('loja', { devolver: true });
  ok(lista.length === 1 && lista[0].id === 'a', 'so o cancelado pago que ainda nao foi devolvido');
}

console.log('Mercado Pago: leitura que falhou nunca apaga a conexao');
{
  const gravados = [];
  const segredo = { token: 'APP_USR-123', conectadoEm: '2026-09-01' };
  let lerFalha = true;
  const janela = {
    LIGEIRO_CONFIG: { mercadoPagoClientId: '123', proxyMercadoPago: 'https://borda.teste' }, LigeiroRegras: R,
    location: { href: '' },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  janela.LigeiroDados = { modoDemo: false, store: {
    lerSegredo(slug, nome, falhar) { if (lerFalha) return falhar ? Promise.reject(new Error('unavailable')) : Promise.resolve(null); return Promise.resolve(segredo); },
    guardarSegredo(slug, nome, dados) { gravados.push(dados); return Promise.resolve(true); },
  } };
  janela.window = janela;
  const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, encodeURIComponent }));
  vm.runInContext(codigoMp, contexto);
  const MP = janela.LigeiroMP;
  let erro = null;
  await MP.conectar('loja').catch((e) => { erro = e; });
  ok(!!erro && gravados.length === 0, 'Conectar com a leitura falhando: para, sem gravar nada por cima do token');
  ok(janela.location.href === '', 'e nao sai para o Mercado Pago');
  let erroConexao = null;
  await MP.lerConexao('loja').catch((e) => { erroConexao = e; });
  ok(!!erroConexao, 'conferir a conexao com a leitura falhando da erro (a tela mostra Tentar de novo), nao "desconectado"');
  lerFalha = false;
  await MP.conectar('loja');
  ok(gravados.length === 1 && gravados[0].token === 'APP_USR-123' && !!gravados[0].oauthNonce, 'com a leitura boa, o codigo entra junto do token que ja existia');
  const c = await MP.lerConexao('loja');
  ok(c && c.token === 'APP_USR-123', 'e a conexao aparece como conectada');
}

console.log('\n' + (total - falhas) + ' de ' + total + ' ok' + (falhas ? ', ' + falhas + ' falharam' : ''));
if (falhas) process.exit(1);
