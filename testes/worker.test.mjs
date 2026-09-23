/*
 * Teste do mensageiro (ferramentas/worker-mercadopago.js) sem internet: Firebase, Google, Mercado Pago e o KV
 * do Cloudflare sao de mentira, e cada leitura e gravacao no banco e contada.
 * Rodar: node testes/worker.test.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ARQUIVO = pathToFileURL(path.resolve('ferramentas/worker-mercadopago.js')).href;
let vez = 0;
/* cada import com ?n= diferente e um worker "novo" (memoria vazia), como o Cloudflare ligando outro */
async function workerNovo() { vez += 1; return (await import(ARQUIVO + '?n=' + vez)).default; }

let falhas = 0, total = 0;
function ok(cond, nome) { total += 1; if (cond) console.log('  ok  ' + nome); else { falhas += 1; console.log('  FALHOU  ' + nome); } }

/* ---------- banco de mentira (documentos como objetos comuns) ---------- */
const BASE = 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/';
const db = new Map();
const conta = { leituras: 0, gravacoes: 0, google: 0, mp: 0, lookup: 0 };
function paraFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFs) } };
  const fields = {}; Object.keys(v).forEach((k) => { fields[k] = paraFs(v[k]); }); return { mapValue: { fields } };
}
function deFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deFs);
  const o = {}; Object.keys(v.mapValue.fields || {}).forEach((k) => { o[k] = deFs(v.mapValue.fields[k]); }); return o;
}
function docRest(caminho, obj) { return { name: 'projects/proj/databases/(default)/documents/' + caminho, fields: paraFs(obj).mapValue.fields, createTime: '2026-09-23T20:00:00Z' }; }
const resposta = (obj, status) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

/* ---------- Mercado Pago e usuarios de mentira ---------- */
const ordens = new Map();
const usuarios = { 'tok-dono': 'dono@x.com', 'tok-outro': 'outro@x.com', 'tok-admin': 'ligeiro.pedidos@gmail.com' };

globalThis.fetch = async (url, op) => {
  const o = op || {};
  const metodo = o.method || 'GET';
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') { conta.google += 1; return resposta({ access_token: 'google-' + conta.google }); }
  if (url.indexOf('accounts:lookup') >= 0) {
    conta.lookup += 1;
    const corpo = JSON.parse(o.body || '{}');
    const email = usuarios[corpo.idToken];
    return resposta(email ? { users: [{ email, emailVerified: true }] } : {}, email ? 200 : 400);
  }
  if (url.indexOf('https://api.mercadopago.com') === 0) {
    conta.mp += 1;
    const m = /\/v1\/orders\/([^/?]+)$/.exec(url);
    if (m && metodo === 'GET') { const ord = ordens.get(decodeURIComponent(m[1])); return ord ? resposta(ord) : resposta({ message: 'not found' }, 404); }
    if (/\/v1\/orders$/.test(url) && metodo === 'POST') {
      const corpo = JSON.parse(o.body);
      const id = 'ORD' + String(ordens.size + 1).padStart(6, '0');
      const ord = { id, status: 'action_required', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + id, payment_method: { qr_code: 'PIXCOPIAECOLA' + id } }] } };
      ordens.set(id, ord);
      return resposta(ord);
    }
    return resposta({ message: 'rota mp' }, 404);
  }
  if (url.indexOf(BASE) === 0) {
    const semBase = url.slice(BASE.length);
    const [caminhoCru, busca] = semBase.split('?');
    const caminho = decodeURIComponent(caminhoCru);
    const partes = caminho.split('/');
    if (metodo === 'PATCH') {
      conta.gravacoes += 1;
      const campos = JSON.parse(o.body).fields;
      const atual = db.get(caminho) || {};
      Object.keys(campos).forEach((k) => { atual[k] = deFs(campos[k]); });
      db.set(caminho, atual);
      return resposta(docRest(caminho, atual));
    }
    if (partes.length % 2 === 1) {
      /* colecao: lista os documentos diretos dela */
      const docs = [];
      for (const [k, v] of db) { const p = k.split('/'); if (p.length === partes.length + 1 && k.indexOf(caminho + '/') === 0) docs.push(docRest(k, v)); }
      conta.leituras += Math.max(1, docs.length);
      const params = new URLSearchParams(busca || '');
      const tam = Number(params.get('pageSize') || 100);
      const ini = Number(params.get('pageToken') || 0);
      const pagina = docs.slice(ini, ini + tam);
      const saida = { documents: pagina };
      if (ini + tam < docs.length) saida.nextPageToken = String(ini + tam);
      return resposta(saida);
    }
    conta.leituras += 1;
    if (!db.has(caminho)) return resposta({ error: { code: 404 } }, 404);
    return resposta(docRest(caminho, db.get(caminho)));
  }
  throw new Error('fetch inesperado: ' + url);
};

/* ---------- KV de mentira ---------- */
function kvNovo() {
  const mapa = new Map();
  const kv = {
    gravacoes: 0, leituras: 0, mapa,
    async getWithMetadata(chave, op) {
      kv.leituras += 1;
      const item = mapa.get(chave);
      if (!item) return { value: null, metadata: null };
      const tipo = (op && op.type) || 'text';
      let valor = item.valor;
      if (tipo === 'stream') valor = new Response(item.valor).body;
      else if (tipo === 'arrayBuffer') valor = item.valor instanceof ArrayBuffer ? item.valor : new TextEncoder().encode(item.valor).buffer;
      return { value: valor, metadata: item.metadata };
    },
    async put(chave, valor, op) {
      kv.gravacoes += 1;
      mapa.set(chave, { valor: valor instanceof ReadableStream ? await new Response(valor).text() : valor, metadata: (op && op.metadata) || null });
    },
  };
  return kv;
}

/* ---------- ambiente ---------- */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const kv = kvNovo();
const env = { FIREBASE_SA: JSON.stringify({ client_email: 'sa@proj.iam', private_key: privateKey, project_id: 'proj' }), CARDAPIO: kv };
let pendentes = [];
const ctx = { waitUntil(p) { pendentes.push(p); } };
async function esperarFundo() { const p = pendentes; pendentes = []; await Promise.all(p); }
const SITE = 'https://ligeiropedidos.github.io';
async function chamar(w, caminho, op) {
  const o = op || {};
  const headers = Object.assign({ Origin: SITE }, o.headers || {});
  if (o.corpo) headers['Content-Type'] = 'application/json';
  const req = new Request('https://ligeiro-mp.x.workers.dev' + caminho, { method: o.metodo || 'GET', headers, body: o.corpo ? JSON.stringify(o.corpo) : undefined });
  const r = await w.fetch(req, o.env || env, ctx);
  return r;
}
function zerar() { conta.leituras = 0; conta.gravacoes = 0; kv.gravacoes = 0; }

/* ---------- dados ---------- */
const FOTO = 'data:image/jpeg;base64,' + Buffer.from('JPEG-DE-MENTIRA-123').toString('base64');
db.set('lojas/dom-conizza', { slug: 'dom-conizza', nome: 'Dom Conizza', donoEmail: 'dono@x.com', senhaEquipeEm: 'x', aberta: true, fotosVersao: 'v1', fotosPacote: 1, capa: 'capa-aa', produtos: [{ id: 'p1', nome: 'Pizza', foto: 'f1' }], mpAtivo: true, horarios: { seg: ['18:00-23:00'] } });
db.set('lojas/dom-conizza/fotos/_pacote0', { fotos: { f1: 'data:image/jpeg;base64,MINI' } });
db.set('lojas/dom-conizza/fotos/_pacote2', { fotos: {} });
db.set('lojas/dom-conizza/fotos/capa-aa', { dados: FOTO });
db.set('lojas/dom-conizza/fotos/f1', { dados: FOTO });
db.set('lojas/dom-conizza/privado/mercadopago', { token: 'TOKEN-LOJA' });
db.set('lojas/poucas', { slug: 'poucas', nome: 'Poucas Fotos', donoEmail: 'dono@x.com', fotosVersao: 'w1' });
db.set('lojas/poucas/fotos/fa', { dados: FOTO });
db.set('lojas/poucas/fotos/fb', { dados: FOTO });
db.set('vitrine/dom-conizza', { slug: 'dom-conizza', nome: 'Dom Conizza', cidadeSlug: 'juquia' });
db.set('vitrine/poucas', { slug: 'poucas', nome: 'Poucas Fotos', cidadeSlug: 'juquia' });
const PED = 'abcdefghij0123456789';
db.set('lojas/dom-conizza/pedidos/' + PED, { status: 'aguardando_pagamento', formaPagamento: 'pix', total: 4590, senha: 7, cliente: { nome: 'Ana' } });

console.log('Cardapio na borda');
let w = await workerNovo();
zerar();
let r = await chamar(w, '/loja/dom-conizza');
let j = await r.json();
ok(r.status === 200 && j.borda === 1 && j.loja.nome === 'Dom Conizza', 'primeira visita devolve a loja');
ok(!('donoEmail' in j.loja) && !('senhaEquipeEm' in j.loja), 'e-mail do dono nao sai na copia publica');
ok(conta.leituras === 1 && kv.gravacoes === 1, 'primeira visita: 1 leitura no banco e 1 gravacao no KV');
zerar();
for (let i = 0; i < 50; i++) await chamar(w, '/loja/dom-conizza');
ok(conta.leituras === 0, '50 visitas seguidas: 0 leituras no banco');
w = await workerNovo();
zerar();
r = await chamar(w, '/loja/dom-conizza');
ok(r.status === 200 && conta.leituras === 0, 'outro worker (memoria vazia) serve do KV: 0 leituras');
/* copia velha: serve na hora e confere o banco por tras */
kv.mapa.get('loja:dom-conizza').metadata.em = Date.now() - 25 * 60 * 1000;
db.get('lojas/dom-conizza').aberta = false;
w = await workerNovo();
zerar();
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(j.loja.aberta === true, 'copia velha responde na hora (sem esperar o banco)');
await esperarFundo();
ok(conta.leituras === 1 && kv.gravacoes === 1, 'e se atualiza por tras com 1 leitura');
w = await workerNovo();
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(j.loja.aberta === false, 'a proxima visita ja ve a loja fechada');
zerar();
r = await chamar(w, '/loja/nao-existe');
ok(r.status === 404 && (await r.json()).erro === 'nao-existe', 'loja que nao existe: 404 da borda');
r = await chamar(w, '/loja/nao-existe');
ok(conta.leituras === 1, 'loja que nao existe nao le o banco de novo no mesmo minuto');

console.log('Publicar (painel salvou)');
db.get('lojas/dom-conizza').aberta = true;
zerar();
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-outro' } });
ok(r.status === 403 && conta.leituras === 0, 'quem nao e dono nao publica (e nao gasta leitura)');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-dono' } });
ok(r.status === 200 && conta.leituras === 1, 'dono publica com 1 leitura');
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(j.loja.aberta === true, 'a mudanca aparece na hora para o cliente');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-admin' } });
ok(r.status === 200, 'admin tambem publica');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' } });
ok(r.status === 400, 'sem login nao publica');

console.log('Fotos');
w = await workerNovo();
zerar();
r = await chamar(w, '/fotos/dom-conizza?v=v1'); j = await r.json();
ok(r.headers.get('Cache-Control').indexOf('immutable') >= 0, 'versao certa: o celular guarda para sempre');
ok(j.pacote === true && j.versao === 'v1' && j.docs.length === 3, 'pacote: 2 pacotes que existem + a capa');
ok(conta.leituras === 5, 'montar as fotos: 4 pacotes + capa = 5 leituras, uma vez so');
zerar();
for (let i = 0; i < 20; i++) await (await chamar(w, '/fotos/dom-conizza?v=v1')).text();
ok(conta.leituras === 0, '20 clientes novos: 0 leituras');
r = await chamar(w, '/fotos/dom-conizza?v=inventada');
ok(r.headers.get('Cache-Control').indexOf('immutable') < 0 && conta.leituras === 0, 'versao inventada nao remonta nem gasta leitura');
r = await chamar(w, '/fotos/poucas?v=w1'); j = await r.json();
const idsPoucas = [];
j.docs.forEach((pag) => (pag.documents || []).forEach((d) => idsPoucas.push(d.name.split('/').pop())));
ok(j.pacote === false && idsPoucas.join(',') === 'fa,fb', 'loja sem pacote: a pasta inteira');
zerar();
r = await chamar(w, '/foto/dom-conizza/f1');
const bytes = Buffer.from(await r.arrayBuffer()).toString();
ok(r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg' && bytes === 'JPEG-DE-MENTIRA-123', 'foto grande sai como imagem de verdade');
await esperarFundo();
w = await workerNovo();
zerar();
r = await chamar(w, '/foto/dom-conizza/f1');
ok(r.status === 200 && conta.leituras === 0, 'foto grande vem do KV depois da primeira vez');
zerar();
r = await chamar(w, '/foto/dom-conizza/nao-tem');
ok(r.status === 404 && conta.leituras === 0, 'foto inventada: 404 sem gastar leitura no banco');
r = await chamar(w, '/foto/dom-conizza/capa-aa');
ok(r.status === 200 && conta.leituras === 1, 'capa da loja passa (1 leitura, so na primeira vez)');

console.log('Vitrine');
w = await workerNovo();
zerar();
r = await chamar(w, '/vitrine'); j = await r.json();
ok(j.borda === 1 && j.lista.length === 2 && !('_id' in j.lista[0]), 'vitrine com as 2 lojas');
zerar();
for (let i = 0; i < 30; i++) await chamar(w, '/vitrine');
ok(conta.leituras === 0, '30 visitas na pagina das cidades: 0 leituras');

console.log('Pix');
w = await workerNovo();
zerar();
const googleAntes = conta.google;
r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PED } }); j = await r.json();
ok(r.status === 200 && j.codigo && j.mp, 'cria o Pix e devolve o codigo e o id do Mercado Pago');
ok(conta.leituras === 2, '/criar: 2 leituras (pedido + token), sem ler a loja inteira');
ok(conta.gravacoes === 1, '/criar: 1 gravacao (sem o indice, a referencia cabe inteira)');
const pedido = db.get('lojas/dom-conizza/pedidos/' + PED);
const expira = pedido.pixExpiraEm;
zerar();
for (let i = 0; i < 10; i++) {
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PED + '&mp=' + encodeURIComponent(j.mp) + '&expira=' + encodeURIComponent(expira));
}
const st = await r.json();
ok(st.status === 'aguardando_pagamento' && st.vencido === false, '"caiu?" ainda nao caiu');
ok(conta.leituras === 0, '10 perguntas "caiu?" com o Pix pendente: 0 leituras no banco');
ok(conta.google - googleAntes === 1, 'a chave do Google foi pedida 1 vez so (antes era 1 por chamada)');
r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PED + '&mp=' + encodeURIComponent(j.mp) + '&expira=' + encodeURIComponent(new Date(Date.now() - 1000).toISOString()));
ok((await r.json()).vencido === true, 'prazo passado: vencido pelo relogio do servidor');
/* pagou: o aviso do Mercado Pago traz a referencia */
ordens.get(j.mp).status = 'processed';
zerar();
r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { type: 'order', action: 'order.processed', data: { id: j.mp, external_reference: 'dom-conizza__' + PED, status: 'processed' } }, headers: { Origin: '' } });
ok(r.status === 200 && db.get('lojas/dom-conizza/pedidos/' + PED).status === 'pago', 'webhook libera o pedido');
ok(conta.leituras === 1 && conta.gravacoes === 1, 'webhook: 1 leitura (o pedido) e 1 gravacao, sem indice');
zerar();
r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PED + '&mp=' + encodeURIComponent(j.mp) + '&expira=' + encodeURIComponent(expira));
ok((await r.json()).status === 'pago' && conta.gravacoes === 0, '"caiu?" depois do webhook: pago, sem gravar de novo');
/* valor errado nao libera */
const PED2 = 'zzzzzzzzzz0123456789';
db.set('lojas/dom-conizza/pedidos/' + PED2, { status: 'aguardando_pagamento', formaPagamento: 'pix', total: 9990, senha: 8, cliente: { nome: 'Bia' } });
ordens.set('ORD999', { id: 'ORD999', status: 'processed', external_reference: 'dom-conizza__' + PED2, total_amount: '1.00' });
r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD999', external_reference: 'dom-conizza__' + PED2 } }, headers: { Origin: '' } });
ok(db.get('lojas/dom-conizza/pedidos/' + PED2).status === 'aguardando_pagamento', 'Pix de R$ 1 nao libera pedido de R$ 99,90');
/* site antigo (sem mp/expira) continua funcionando */
r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PED2);
ok((await r.json()).status === 'aguardando_pagamento', 'site antigo ainda pergunta do jeito velho');

console.log('Sem KV ligado');
w = await workerNovo();
r = await chamar(w, '/loja/dom-conizza', { env: { FIREBASE_SA: env.FIREBASE_SA } });
ok(r.status === 501, 'sem o KV: responde 501 e o site volta a ler do Firestore');
r = await chamar(w, '/loja/dom-conizza', { headers: { Origin: 'https://site-estranho.com' } });
ok(r.status === 403, 'outro site nao usa o cardapio');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
