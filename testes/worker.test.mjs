/*
 * Teste do mensageiro (ferramentas/worker-mercadopago.js) sem internet: Firebase, Google, Mercado Pago e o KV
 * do Cloudflare sao de mentira, e cada leitura e gravacao no banco e contada.
 * Rodar: node testes/worker.test.mjs
 */
import { generateKeyPairSync, createECDH, hkdfSync, createDecipheriv, randomBytes, webcrypto } from 'node:crypto';
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
const usuarios = { 'tok-dono': 'dono@x.com', 'tok-outro': 'outro@x.com', 'tok-admin': 'ligeiro.pedidos@gmail.com', 'tok-equipe': 'equipe-dom-conizza@equipe.ligeiro.app.br' };
/* servicos de aviso de mentira (Google e Apple): guarda o que chegou; codigoAviso[endpoint] simula aparelho que saiu */
const avisos = [];
const codigoAviso = {};

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
  if (url.indexOf('https://fcm.googleapis.com/') === 0 || url.indexOf('https://web.push.apple.com/') === 0) {
    avisos.push({ url, headers: o.headers || {}, corpo: new Uint8Array(o.body) });
    return new Response('', { status: codigoAviso[url] || 201 });
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
    /* banco gratis no limite do dia: tudo volta 429 */
    if (globalThis.__limite) return resposta({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429);
    const semBase = url.slice(BASE.length);
    const [caminhoCru, busca] = semBase.split('?');
    const caminho = decodeURIComponent(caminhoCru);
    const partes = caminho.split('/');
    if (metodo === 'PATCH') {
      conta.gravacoes += 1;
      /* "so se existe": o Firestore responde 404 e nao cria nada */
      if ((busca || '').indexOf('currentDocument.exists=true') >= 0 && !db.has(caminho)) return resposta({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
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
    async get(chave) { kv.leituras += 1; const item = mapa.get(chave); return item ? item.valor : null; },
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
    async delete(chave) { kv.gravacoes += 1; mapa.delete(chave); },
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
await new Promise((ok2) => setTimeout(ok2, 20));
kv.mapa.set('vitrine', { valor: '{"borda":1,"lista":[]}', metadata: { em: Date.now() } });
db.get('lojas/dom-conizza').aberta = false;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-dono' } });
await new Promise((ok2) => setTimeout(ok2, 20));
ok(r.status === 200 && !kv.mapa.has('vitrine'), 'fechar a loja apaga a vitrine da borda (a pagina da cidade nao fica dizendo "Aberta agora")');
kv.mapa.set('vitrine', { valor: '{"borda":1,"lista":[]}', metadata: { em: Date.now() } });
const produtos = db.get('lojas/dom-conizza').produtos || [];
if (produtos[0]) produtos[0].preco = (produtos[0].preco || 0) + 100;
db.get('lojas/dom-conizza').atualizadoEm = new Date().toISOString();
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-dono' } });
await new Promise((ok2) => setTimeout(ok2, 20));
ok(r.status === 200 && kv.mapa.has('vitrine'), 'mudar so preco de item nao apaga a vitrine (nao gasta gravacao do KV)');
/* volta ao que os proximos testes esperam: loja aberta publicada e sem a vitrine de mentira */
db.get('lojas/dom-conizza').aberta = true;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer tok-dono' } });
await new Promise((ok2) => setTimeout(ok2, 20));
kv.mapa.delete('vitrine');
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

console.log('Avisos no celular');
/* um celular de mentira: chaves de verdade, do mesmo jeito que o navegador cria */
function aparelho(endpoint) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  const b64 = (b) => Buffer.from(b).toString('base64url');
  return { ecdh, auth, inscricao: { endpoint, keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(auth) } } };
}
/* abre o aviso como o celular abre (RFC 8291 feito aqui de novo, sem o codigo do worker) */
function abrirAviso(av, cel) {
  const buf = Buffer.from(av.corpo);
  const sal = buf.subarray(0, 16), idlen = buf[20], chaveServidor = buf.subarray(21, 21 + idlen), cifrado = buf.subarray(21 + idlen);
  const hk = (salt, ikm, info, n) => Buffer.from(hkdfSync('sha256', ikm, salt, info, n));
  const ikm = hk(cel.auth, cel.ecdh.computeSecret(chaveServidor), Buffer.concat([Buffer.from('WebPush: info\0'), cel.ecdh.getPublicKey(), chaveServidor]), 32);
  const d = createDecipheriv('aes-128-gcm', hk(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  if (claro[claro.length - 1] !== 2) throw new Error('sem o delimitador do ultimo pedaco');
  return JSON.parse(claro.subarray(0, claro.length - 1).toString('utf8'));
}
/* confere a assinatura do Ligeiro (VAPID) como o Google confere */
async function assinaturaOk(av, chavePublica) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(av.headers.Authorization || '');
  if (!m || m[2] !== chavePublica) return false;
  const [cab, corpo, ass] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  if (claims.aud !== new URL(av.url).origin || !(claims.exp > Date.now() / 1000) || claims.sub.indexOf('mailto:') !== 0) return false;
  const chave = await webcrypto.subtle.importKey('raw', Buffer.from(m[2], 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, chave, Buffer.from(ass, 'base64url'), Buffer.from(cab + '.' + corpo));
}
const doPainel = aparelho('https://fcm.googleapis.com/fcm/send/painel-1');
const daCozinha = aparelho('https://web.push.apple.com/cozinha-1');
const doEntregador = aparelho('https://fcm.googleapis.com/fcm/send/entregas-1');
const doCliente = aparelho('https://fcm.googleapis.com/fcm/send/cliente-1');
const bearer = (t) => ({ Authorization: 'Bearer ' + t });

w = await workerNovo();
zerar();
r = await chamar(w, '/vapid'); j = await r.json();
const VAPID = j.chave;
ok(r.status === 200 && /^[A-Za-z0-9_-]{87}$/.test(VAPID) && kv.gravacoes === 1, 'chave dos avisos nasce sozinha no KV (1 gravacao, nenhum segredo para criar)');
w = await workerNovo();
zerar();
r = await chamar(w, '/vapid'); j = await r.json();
ok(j.chave === VAPID && kv.gravacoes === 0, 'outro worker usa a mesma chave, sem gravar de novo');

r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao } });
ok(r.status === 401, 'ligar avisos sem login: recusado');
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao }, headers: bearer('tok-outro') });
ok(r.status === 403, 'ligar avisos de loja que nao e sua: recusado');
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: { endpoint: 'https://site-do-mal.com/x', keys: doPainel.inscricao.keys } }, headers: bearer('tok-dono') });
ok(r.status === 400, 'endereco que nao e servico de aviso: recusado (o worker nunca manda nada para site qualquer)');
zerar(); avisos.length = 0;
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao, testar: true }, headers: bearer('tok-dono') }); j = await r.json();
ok(r.status === 200 && j.ok && j.teste === 201, 'dono liga os avisos do painel e o teste chega');
ok(conta.leituras === 0 && conta.gravacoes === 0 && kv.gravacoes === 1, 'ligar aparelho: 0 leituras e 0 gravacoes no banco (1 gravacao no KV)');
ok(avisos.length === 1 && abrirAviso(avisos[0], doPainel).titulo === 'Avisos ligados', 'o celular consegue abrir o aviso de teste');
ok(await assinaturaOk(avisos[0], VAPID), 'aviso assinado com a chave do Ligeiro (o Google aceita)');
zerar();
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao }, headers: bearer('tok-dono') });
ok(r.status === 200 && kv.gravacoes === 0, 'abrir o painel de novo no mesmo aparelho: nao grava nada');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'cozinha', inscricao: daCozinha.inscricao }, headers: bearer('tok-equipe') });
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', inscricao: doEntregador.inscricao }, headers: bearer('tok-equipe') });
ok(r.status === 200 && JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).length === 3, 'a equipe (senha da loja) liga a cozinha e o entregador');

const NOVO = 'novonovonovo01234567';
db.set('lojas/dom-conizza/pedidos/' + NOVO, { status: 'pago', formaPagamento: 'dinheiro_entrega', pagamentoStatus: 'na_entrega', total: 3500, senha: 21, tipoEntrega: 'entrega', cliente: { nome: 'Bia Souza' }, endereco: { bairro: 'Centro' } });
w = await workerNovo();
zerar(); avisos.length = 0;
const RESUMO_NOVO = { senha: 21, total: 3500, tipoEntrega: 'entrega' };
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, resumo: RESUMO_NOVO } }); j = await r.json();
ok(j.enviados === 2 && avisos.length === 2, 'pedido novo: o painel e a cozinha recebem (o entregador nao)');
const vPainel = abrirAviso(avisos.filter((a) => a.url === doPainel.inscricao.endpoint)[0], doPainel);
const vCozinha = abrirAviso(avisos.filter((a) => a.url === daCozinha.inscricao.endpoint)[0], daCozinha);
ok(vPainel.titulo === 'Pedido novo! Senha 21' && vPainel.texto === 'R$ 35,00 · Entrega · Toque para abrir' && vPainel.fixo === true, 'o aviso diz a senha, o valor e se e entrega');
ok(vPainel.url === '#/painel/dom-conizza' && vCozinha.url === '#/cozinha/dom-conizza', 'tocar no aviso abre a tela certa de cada aparelho');
ok(conta.leituras === 0 && conta.gravacoes === 0, 'pedido novo avisado: 0 leituras e 0 gravacoes no banco');
zerar(); avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, resumo: RESUMO_NOVO } });
ok(avisos.length === 0, 'o mesmo pedido avisado de novo: a loja apita uma vez so');
zerar();
db.set('lojas/poucas/pedidos/' + NOVO, { status: 'pago', total: 100, senha: 1, cliente: { nome: 'Caio' } });
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'poucas', pedido: NOVO, resumo: RESUMO_NOVO } }); j = await r.json();
ok(j.enviados === 0 && conta.leituras === 0, 'loja sem aviso ligado: nada a fazer, nenhuma leitura');
zerar(); avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'pixpixpixpix01234567', resumo: { senha: 'xingamento', total: 2000 } } });
ok(r.status === 400 && avisos.length === 0, 'resumo com texto no lugar da senha: recusado (o aviso so leva numeros)');
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'inventado', resumo: RESUMO_NOVO } });
ok(r.status === 400, 'pedido com id inventado: recusado');
let devagar = false;
for (let i = 0; i < 22; i++) { r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'poucas', pedido: 'rajada' + String(i).padStart(14, '0'), resumo: RESUMO_NOVO } }); if ((await r.json()).devagar) devagar = true; }
ok(devagar, 'rajada de pedidos inventados: no maximo 20 apitos por minuto por loja');

zerar();
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, cidade: 'juquia', inscricao: doCliente.inscricao } });
const comAviso = db.get('lojas/dom-conizza/pedidos/' + NOVO);
ok(r.status === 200 && comAviso.aviso && comAviso.aviso.u === '#/juquia/dom-conizza/pedido/', 'cliente liga o aviso: fica guardado no proprio pedido');
ok(conta.leituras === 0 && conta.gravacoes === 1, 'cliente ligar o aviso: 0 leituras e 1 gravacao no banco');
zerar();
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'naoexistenaoexiste12', cidade: 'juquia', inscricao: doCliente.inscricao } });
ok(r.status === 404 && !db.has('lojas/dom-conizza/pedidos/naoexistenaoexiste12'), 'pedido que nao existe: recusado, sem criar pedido fantasma');

zerar(); avisos.length = 0;
const resumo = { senha: 21, total: 3500, tipoEntrega: 'entrega', nome: 'Bia', bairro: 'Centro' };
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso }, headers: bearer('tok-equipe') }); j = await r.json();
ok(j.cliente === 201 && j.equipe === 1, 'saiu para entrega: avisa o cliente e o entregador');
const vCliente = abrirAviso(avisos.filter((a) => a.url === doCliente.inscricao.endpoint)[0], doCliente);
ok(vCliente.titulo === 'Dom Conizza' && vCliente.texto === 'Seu pedido saiu para entrega! Já está a caminho. Senha 21.' && vCliente.url === '#/juquia/dom-conizza/pedido/' + NOVO, 'o cliente le o nome da loja, o que aconteceu e abre o pedido dele');
ok(avisos.filter((a) => a.url === doCliente.inscricao.endpoint)[0].headers.Topic === 'p' + NOVO, 'celular desligado recebe so o ultimo aviso do pedido');
const vEntrega = abrirAviso(avisos.filter((a) => a.url === doEntregador.inscricao.endpoint)[0], doEntregador);
ok(vEntrega.titulo === 'Entrega pronta! Senha 21' && vEntrega.texto.indexOf('Centro') === 0 && vEntrega.url === '#/entrega/dom-conizza', 'o entregador sabe a senha e o bairro');
ok(conta.leituras === 0 && conta.gravacoes === 0, 'pedido andou e avisou: 0 leituras e 0 gravacoes no banco');
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso } });
ok(r.status === 401, 'avisar o cliente sem login: recusado');
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso }, headers: bearer('tok-outro') });
ok(r.status === 403, 'outra loja nao manda aviso para o cliente desta');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'finalizado', resumo, aviso: comAviso.aviso }, headers: bearer('tok-dono') });
ok(avisos.length === 0, 'entregue: nao incomoda o cliente com mais um aviso');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pago', resumo: { senha: 23, total: 1000, tipoEntrega: 'retirada', nome: 'Edu' } }, headers: bearer('tok-dono') });
ok(avisos.length === 1 && abrirAviso(avisos[0], daCozinha).titulo === 'Pix pago! Senha 23', 'Pix conferido a mao no painel: a cozinha fica sabendo');

/* Pix que cai pelo Mercado Pago: loja e cliente avisados sozinhos */
const PIXA = 'pixavisopixaviso0123';
db.set('lojas/dom-conizza/pedidos/' + PIXA, { status: 'aguardando_pagamento', formaPagamento: 'pix', total: 4000, senha: 24, tipoEntrega: 'retirada', cliente: { nome: 'Fabi Lima' }, aviso: { e: doCliente.inscricao.endpoint, k: doCliente.inscricao.keys.p256dh, a: doCliente.inscricao.keys.auth, u: '#/juquia/dom-conizza/pedido/' } });
ordens.set('ORD777', { id: 'ORD777', status: 'processed', external_reference: 'dom-conizza__' + PIXA, total_amount: '40.00' });
zerar(); avisos.length = 0;
r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD777', external_reference: 'dom-conizza__' + PIXA } }, headers: { Origin: '' } });
const abertos = avisos.map((a) => a.url === doPainel.inscricao.endpoint ? abrirAviso(a, doPainel) : a.url === daCozinha.inscricao.endpoint ? abrirAviso(a, daCozinha) : a.url === doCliente.inscricao.endpoint ? abrirAviso(a, doCliente) : { titulo: 'entregador?' });
ok(db.get('lojas/dom-conizza/pedidos/' + PIXA).status === 'pago' && avisos.length === 3, 'Pix caiu: painel, cozinha e cliente avisados (o entregador nao)');
ok(abertos.filter((t) => t.titulo === 'Pix pago! Senha 24').length === 2 && abertos.some((t) => t.texto === 'Pagamento confirmado! Seu pedido entrou na fila. Senha 24.' && t.url === '#/juquia/dom-conizza/pedido/' + PIXA), 'a loja le "Pix pago" e o cliente "Pagamento confirmado" (e abre o pedido dele)');
console.log('    (webhook com aviso: ' + conta.leituras + ' leituras, ' + conta.gravacoes + ' gravacoes)');
ok(conta.leituras === 2 && conta.gravacoes === 1, 'o aviso do Pix nao gasta nada a mais no banco (worker recem-ligado: token da loja + pedido, 1 gravacao, igual sem aviso)');
avisos.length = 0;
await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD777', external_reference: 'dom-conizza__' + PIXA } }, headers: { Origin: '' } });
ok(avisos.length === 0, 'o Mercado Pago avisando duas vezes: a loja apita uma vez so');

/* o mesmo celular como painel e entregador (loja pequena: o dono entrega) */
const doDono = aparelho('https://fcm.googleapis.com/fcm/send/dono-entrega');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doDono.inscricao }, headers: bearer('tok-dono') });
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', inscricao: doDono.inscricao }, headers: bearer('tok-dono') });
const entradaDono = JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).filter((a) => a.e === doDono.inscricao.endpoint);
ok(entradaDono.length === 1 && entradaDono[0].p.join(',') === 'painel,entregas', 'o mesmo celular fica com os dois papeis (painel e entregas), numa entrada so');
avisos.length = 0;
await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'donoentregadono01234', resumo: { senha: 30, total: 2000, tipoEntrega: 'entrega' } } });
const doDonoNovo = avisos.filter((a) => a.url === doDono.inscricao.endpoint);
ok(doDonoNovo.length === 1 && abrirAviso(doDonoNovo[0], doDono).url === '#/painel/dom-conizza', 'pedido novo chega nele como painel');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'donoentregadono01234', status: 'pronto', resumo: { senha: 30, total: 2000, tipoEntrega: 'entrega', bairro: 'Centro' } }, headers: bearer('tok-dono') });
const doDonoEntrega = avisos.filter((a) => a.url === doDono.inscricao.endpoint);
ok(doDonoEntrega.length === 1 && abrirAviso(doDonoEntrega[0], doDono).titulo === 'Entrega pronta! Senha 30', 'e a entrega pronta chega nele como entregador');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', remover: doDono.inscricao.endpoint }, headers: bearer('tok-dono') });
const depoisDeTirar = JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).filter((a) => a.e === doDono.inscricao.endpoint);
ok(depoisDeTirar.length === 1 && depoisDeTirar[0].p.join(',') === 'painel', 'desligar no entregador tira so esse papel (o painel continua avisando)');

/* KV com falha de leitura: nao troca a chave dos avisos nem apaga a lista de aparelhos */
const listaAntes = kv.mapa.get('aparelhos:dom-conizza').valor;
const getOriginal = kv.get;
kv.get = async () => { throw new Error('KV fora do ar'); };
const wFalha = await workerNovo();
r = await chamar(wFalha, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao, testar: true }, headers: bearer('tok-dono') });
ok(r.status === 503 && kv.mapa.get('aparelhos:dom-conizza').valor === listaAntes, 'KV sem responder: /aparelho diz tente de novo e nao mexe na lista');
r = await chamar(wFalha, '/vapid');
ok(r.status >= 500 && JSON.parse(kv.mapa.get('sistema:vapid').valor).publica === VAPID, 'KV sem responder: a chave dos avisos nao e trocada (os inscritos continuam valendo)');
kv.get = getOriginal;

/* aparelho que desinstalou: sai da lista sozinho */
codigoAviso[daCozinha.inscricao.endpoint] = 410;
db.set('lojas/dom-conizza/pedidos/outronovooutronovo01', { status: 'pago', total: 1500, senha: 25, cliente: { nome: 'Gil' } });
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'outronovooutronovo01', resumo: { senha: 25, total: 1500 } } });
ok(JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).every((a) => a.e !== daCozinha.inscricao.endpoint), 'aparelho que saiu (410) e tirado da lista');
delete codigoAviso[daCozinha.inscricao.endpoint];

console.log('Banco no limite do dia');
w = await workerNovo();
await chamar(w, '/loja/dom-conizza');
r = await chamar(w, '/pausa', { metodo: 'POST' });
ok((await r.json()).pausa === false, 'banco normal: /pausa diz que nao ha pausa');
globalThis.__limite = true;
w = await workerNovo();
r = await chamar(w, '/pausa', { metodo: 'POST' });
ok((await r.json()).pausa === true, 'banco respondeu 429: /pausa confirma o limite');
ok(kv.mapa.has('sistema:pausa'), 'o aviso fica guardado no KV (vale para todos os workers)');
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(j.pausa === true && j.loja && j.loja.nome === 'Dom Conizza', 'a loja continua abrindo, com o aviso de pausa');
const w2 = await workerNovo();
r = await chamar(w2, '/loja/dom-conizza'); j = await r.json();
ok(j.pausa === true, 'outro worker tambem ve a pausa (pelo KV)');
globalThis.__limite = false;
kv.mapa.delete('sistema:pausa');
const w3 = await workerNovo();
r = await chamar(w3, '/loja/dom-conizza'); j = await r.json();
ok(!j.pausa, 'depois que zera (o aviso vence), a loja volta ao normal');

console.log('Sem KV ligado');
w = await workerNovo();
r = await chamar(w, '/loja/dom-conizza', { env: { FIREBASE_SA: env.FIREBASE_SA } });
ok(r.status === 501, 'sem o KV: responde 501 e o site volta a ler do Firestore');
r = await chamar(w, '/loja/dom-conizza', { headers: { Origin: 'https://site-estranho.com' } });
ok(r.status === 403, 'outro site nao usa o cardapio');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
