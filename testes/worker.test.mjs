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
const versoes = new Map();
function horaDe(caminho) { return '2026-09-23T20:00:00.' + String(versoes.get(caminho) || 0).padStart(6, '0') + 'Z'; }
function docRest(caminho, obj) { return { name: 'projects/proj/databases/(default)/documents/' + caminho, fields: paraFs(obj).mapValue.fields, createTime: (obj && typeof obj.criadoEm === 'string' && obj.criadoEm) || '2026-09-23T20:00:00Z', updateTime: horaDe(caminho) }; } /* o pedido nasce no banco na hora do criadoEm */
/* token de login de mentira no formato do Firebase (aud e iss do projeto): o mensageiro confere isso antes de perguntar ao Google */
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtDoProjeto = (nome, projeto) => b64u({ alg: 'RS256', typ: 'JWT' }) + '.' + b64u({ aud: projeto, iss: 'https://securetoken.google.com/' + projeto, sub: nome }) + '.assinatura';
const resposta = (obj, status) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

/* ---------- Mercado Pago e usuarios de mentira ---------- */
const ordens = new Map();
const repeticoes = new Map();
const cartoes = [];
const devolucoes = [];
const usuarios = { 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura': 'dono@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura': 'outro@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura': 'ligeiro.pedidos@gmail.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura': 'equipe-dom-conizza@equipe.ligeiropedidos.com.br', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtdmVsaGEifQ.assinatura': 'equipe-dom-conizza@equipe.ligeiro.app.br', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtdmVsaGEyIn0.assinatura': 'equipe-dom-conizza@equipe.ligeiro.app.br', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtb3V0cmEifQ.assinatura': 'equipe-outra-loja@equipe.ligeiropedidos.com.br', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura': 'novo@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJzZW1jb250YSJ9.assinatura': 'semconta@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJjb3JyaWRhIn0.assinatura': 'corrida@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJ2ZWxobyJ9.assinatura': 'velho@x.com', 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJwYWdvdSJ9.assinatura': 'pagou@x.com' };
/* servicos de aviso de mentira (Google e Apple): guarda o que chegou; codigoAviso[endpoint] simula aparelho que saiu */
const avisos = [];
const codigoAviso = {};
/* marca de cada login (customAttributes), por e-mail */
const marcas = {};
/* o que o mensageiro gravou em cada login (accounts:update) */
const contasAtualizadas = [];

globalThis.fetch = async (url, op) => {
  const o = op || {};
  const metodo = o.method || 'GET';
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') { conta.google += 1; return resposta({ access_token: 'google-' + conta.google }); }
  if (url.indexOf('accounts:lookup') >= 0) {
    conta.lookup += 1;
    const corpo = JSON.parse(o.body || '{}');
    const email = corpo.idToken ? usuarios[corpo.idToken] : (corpo.email || [])[0];
    return resposta(email ? { users: [{ email, emailVerified: true, localId: 'id-' + email, customAttributes: marcas[email] }] } : {}, email ? 200 : 400);
  }
  if (url.indexOf('accounts:update') >= 0) {
    const corpo = JSON.parse(o.body || '{}');
    contasAtualizadas.push(corpo);
    if (corpo.customAttributes != null) marcas[String(corpo.localId).replace(/^id-/, '')] = corpo.customAttributes;
    return resposta({ localId: corpo.localId });
  }
  if (url.indexOf('https://fcm.googleapis.com/') === 0 || url.indexOf('https://web.push.apple.com/') === 0) {
    avisos.push({ url, headers: o.headers || {}, corpo: new Uint8Array(o.body) });
    return new Response('', { status: codigoAviso[url] || 201 });
  }
  if (url.indexOf('https://api.mercadopago.com') === 0) {
    conta.mp += 1;
    const dv = /\/v1\/orders\/([^/?]+)\/refund$/.exec(url);
    if (dv && metodo === 'POST') {
      const idDv = decodeURIComponent(dv[1]);
      if (ordens.get(idDv) && ordens.get(idDv).status === 'refunded') return resposta({ errors: [{ code: 'order_already_refunded' }] }, 409);
      devolucoes.push({ id: idDv, chave: (o.headers || {})['X-Idempotency-Key'] });
      return resposta({ id: idDv, status: 'refunded' }, 201);
    }
    const m = /\/v1\/orders\/([^/?]+)$/.exec(url);
    if (m && metodo === 'GET') { const ord = ordens.get(decodeURIComponent(m[1])); return ord ? resposta(ord) : resposta({ message: 'not found' }, 404); }
    if (/\/v1\/orders$/.test(url) && metodo === 'POST') {
      const corpo = JSON.parse(o.body);
      /* como o de verdade: a mesma chave de repeticao devolve a mesma order (nada de cobrar ou criar duas vezes) */
      const chaveRep = (o.headers || {})['X-Idempotency-Key'];
      if (chaveRep && repeticoes.has(chaveRep)) return resposta(repeticoes.get(chaveRep));
      const guardar = (r) => { if (chaveRep) repeticoes.set(chaveRep, r); return resposta(r); };
      const pm = corpo.transactions.payments[0].payment_method;
      if (pm.type === 'credit_card') {
        cartoes.push({ corpo, chave: (o.headers || {})['X-Idempotency-Key'] });
        if (/^RECUSA/.test(pm.token)) {
          const motivo = ((/^RECUSA-([a-z-]+)/.exec(pm.token) || [])[1] || 'insufficient-amount').replace(/-/g, '_');
          return resposta({ errors: [{ code: 'failed' }], transactions: { payments: [{ status: 'failed', status_detail: motivo }] } }, 402);
        }
        if (/^ANALISE/.test(pm.token)) {
          const ida = 'ORD' + String(ordens.size + 1).padStart(6, '0');
          const orda = { id: ida, status: 'processing', status_detail: 'in_process', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + ida, status: 'processing', status_detail: 'in_process' }] } };
          ordens.set(ida, orda);
          return guardar(orda);
        }
        if (/^CONFIRMA/.test(pm.token)) {
          const idq = 'ORD' + String(ordens.size + 1).padStart(6, '0');
          const ordq = { id: idq, status: 'action_required', status_detail: 'pending_challenge', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + idq, status: 'action_required', status_detail: 'pending_challenge' }] } };
          ordens.set(idq, ordq);
          return guardar(ordq);
        }
        const idc = 'ORD' + String(ordens.size + 1).padStart(6, '0');
        const ordc = { id: idc, status: 'processed', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + idc, status: 'processed', status_detail: 'accredited' }] } };
        ordens.set(idc, ordc);
        return guardar(ordc);
      }
      const id = 'ORD' + String(ordens.size + 1).padStart(6, '0');
      const ord = { id, status: 'action_required', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + id, payment_method: { qr_code: 'PIXCOPIAECOLA' + id } }] } };
      ordens.set(id, ord);
      /* como a doc avisa: a order pode nascer "processing", sem o codigo, que aparece na consulta seguinte */
      if (globalThis.__pixDemora > 0) { globalThis.__pixDemora--; if (chaveRep) repeticoes.set(chaveRep, ord); return resposta({ id, status: 'processing', external_reference: corpo.external_reference, total_amount: corpo.total_amount, transactions: { payments: [{ id: 'PAY' + id, payment_method: { id: 'pix' } }] } }); }
      return guardar(ord);
    }
    return resposta({ message: 'rota mp' }, 404);
  }
  if (url === BASE.slice(0, -1) + ':runQuery' && metodo === 'POST') {
    conta.leituras += 1;
    const q = JSON.parse(o.body).structuredQuery;
    const valor = q.where.fieldFilter.value.stringValue;
    const achadas = [...db.entries()].filter(([k, d]) => /^lojas\/[^/]+$/.test(k) && d.donoEmail === valor);
    /* o banco demorando para responder a contagem (o retrato e da hora do pedido): os pedidos que chegam juntos contam
       todos zero antes de alguem gravar */
    if (globalThis.__consultaLenta) await new Promise((ok) => setTimeout(ok, 30));
    return resposta(achadas.length ? achadas.map(([k]) => ({ document: { name: 'projects/proj/databases/(default)/documents/' + k } })) : [{ readTime: 'x' }]);
  }
  if (url === BASE.slice(0, -1) + ':commit' && metodo === 'POST') {
    if (globalThis.__limite) return resposta({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429);
    /* gancho do teste: outra gravacao que chega bem antes deste lote (roda uma vez) */
    if (globalThis.__antesDoLote) { const f = globalThis.__antesDoLote; globalThis.__antesDoLote = null; f(); }
    const writes = JSON.parse(o.body).writes || [];
    const prefixo = 'projects/proj/databases/(default)/documents/';
    for (const wr of writes) {
      const cam = wr.update.name.slice(prefixo.length);
      const cd = wr.currentDocument || {};
      if (cd.exists === false && db.has(cam)) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
      if (cd.updateTime && cd.updateTime !== horaDe(cam)) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
    }
    if (globalThis.__falharLote && globalThis.__falharLote-- > 0) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
    for (const wr of writes) {
      const cam = wr.update.name.slice(prefixo.length);
      const obj = {};
      Object.keys(wr.update.fields || {}).forEach((k) => { obj[k] = deFs(wr.update.fields[k]); });
      /* com mascara, so esses campos mudam (o resto do documento fica) */
      if (wr.updateMask) { const atual = db.get(cam) || {}; (wr.updateMask.fieldPaths || []).forEach((f) => { const ps = f.split('.'); let a = atual, o = obj; for (let i = 0; i < ps.length - 1; i++) { a = a[ps[i]] = (a[ps[i]] && typeof a[ps[i]] === 'object') ? a[ps[i]] : {}; o = (o || {})[ps[i]]; } a[ps[ps.length - 1]] = (o || {})[ps[ps.length - 1]]; }); db.set(cam, atual); } else db.set(cam, obj);
      versoes.set(cam, (versoes.get(cam) || 0) + 1);
      conta.gravacoes += 1;
    }
    return resposta({ writeResults: writes.map(() => ({})) });
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
      /* "so se nao mudou": a hora da ultima mudanca tem que ser a mesma da leitura */
      const pre = new URLSearchParams(busca || '').get('currentDocument.updateTime');
      if (pre && pre !== horaDe(caminho)) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
      versoes.set(caminho, (versoes.get(caminho) || 0) + 1);
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
    async get(chave, op) { kv.leituras += 1; const item = mapa.get(chave); if (!item) return null; const tipo = typeof op === 'string' ? op : (op && op.type) || 'text'; return tipo === 'json' ? JSON.parse(item.valor) : item.valor; },
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
    async delete(chave) { kv.gravacoes += 1; kv.apagadas = (kv.apagadas || 0) + 1; mapa.delete(chave); },
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
db.set('lojas/dom-conizza', { slug: 'dom-conizza', nome: 'Dom Conizza', donoEmail: 'dono@x.com', senhaEquipeEm: 'x', aberta: true, fotosVersao: 'v1', fotosPacote: 1, capa: 'capa-aa', produtos: [{ id: 'p1', nome: 'Pizza', foto: 'f1', preco: 4590 }], mpAtivo: true, horarios: { seg: ['18:00-23:00'] } });
/* pedido como o site monta: itens do cardapio e o total batendo com o preco de agora */
const precoP1 = () => db.get('lojas/dom-conizza').produtos[0].preco;
const pedidoDe = (qtd, extra) => Object.assign({ itens: [{ produtoId: 'p1', quantidade: qtd }], tipoEntrega: 'retirada', total: precoP1() * qtd, criadoEm: new Date().toISOString() }, extra);
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
db.set('lojas/dom-conizza/pedidos/' + PED, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 7, cliente: { nome: 'Ana' } }));

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
kv.mapa.get('loja:dom-conizza').metadata.em = Date.now() - 7 * 3600 * 1000;
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
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura' } });
ok(r.status === 403 && conta.leituras === 0, 'quem nao e dono nao publica (e nao gasta leitura)');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
ok(r.status === 200 && conta.leituras === 1, 'dono publica com 1 leitura');
await new Promise((ok2) => setTimeout(ok2, 20));
kv.mapa.set('vitrine', { valor: '{"borda":1,"lista":[]}', metadata: { em: Date.now() } });
db.get('lojas/dom-conizza').aberta = false;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
ok(r.status === 200 && !kv.mapa.has('vitrine'), 'fechar a loja apaga a vitrine da borda (a pagina da cidade nao fica dizendo "Aberta agora")');
kv.mapa.set('vitrine', { valor: '{"borda":1,"lista":[]}', metadata: { em: Date.now() } });
const produtos = db.get('lojas/dom-conizza').produtos || [];
if (produtos[0]) produtos[0].preco = (produtos[0].preco || 0) + 100;
db.get('lojas/dom-conizza').atualizadoEm = new Date().toISOString();
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
ok(r.status === 200 && kv.mapa.has('vitrine'), 'mudar so preco de item nao apaga a vitrine (nao gasta gravacao do KV)');
/* volta ao que os proximos testes esperam: loja aberta publicada e sem a vitrine de mentira */
db.get('lojas/dom-conizza').aberta = true;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
kv.mapa.delete('vitrine');
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(j.loja.aberta === true, 'a mudanca aparece na hora para o cliente');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
ok(r.status === 200, 'admin tambem publica');
/* loja excluida de vez pelo admin: o banco passa a dizer que ela nao existe e a copia que a borda guardava sai (antes a loja
   continuava abrindo para sempre, porque so o banco dizia 404) */
db.set('lojas/loja-apagada', { slug: 'loja-apagada', nome: 'Loja apagada', donoEmail: 'dono@exemplo.com', ativa: false, categorias: [], produtos: [], aberta: true });
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'loja-apagada' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
ok(r.status === 200 && kv.mapa.has('loja:loja-apagada'), 'loja desativada ainda tem copia na borda');
kv.mapa.set('fotos:loja-apagada', { valor: '{}', metadata: { versao: '1' } });
kv.mapa.set('vitrine', { valor: '{"borda":1,"lista":[]}', metadata: { em: Date.now() } });
db.delete('lojas/loja-apagada');
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'loja-apagada' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
ok(r.status === 200 && (await r.json()).removida === true && !kv.mapa.has('loja:loja-apagada') && !kv.mapa.has('fotos:loja-apagada') && !kv.mapa.has('vitrine'), 'loja excluida: a copia, as fotos e a vitrine da borda saem, e o admin recebe 200 (nada de erro vermelho no console)');
r = await chamar(w, '/loja/loja-apagada');
ok(r.status === 404, 'loja excluida: o cliente ve "nao existe", nao a copia velha');
zerar();
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'endereco-inventado' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
ok(r.status === 200 && kv.gravacoes === 0, 'endereco inventado nao gasta apagamento no KV');
zerar();
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
ok(r.status === 200 && kv.gravacoes === 1, 'publicar sem mudar nada grava a copia de novo (a versao nova e o que faz o token do Mercado Pago ser relido)');
db.get('lojas/dom-conizza').aberta = false;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
ok(kv.gravacoes >= 1 && j.loja.aberta === false, 'mudou algo: grava e aparece na hora');
db.get('lojas/dom-conizza').aberta = true;
r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } });
await new Promise((ok2) => setTimeout(ok2, 20));
kv.mapa.delete('vitrine');
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
/* o preco mudou no teste do publicar: o pedido e montado de novo com o preco de agora, como o site faria */
db.set('lojas/dom-conizza/pedidos/' + PED, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 7, cliente: { nome: 'Ana' } }));
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

console.log('Cartao de credito');
{
  const PC = 'cartao00000000000001';
  const fim = () => new Promise((ok2) => setTimeout(ok2, 20));
  db.set('lojas/dom-conizza/pedidos/' + PC, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'cartao_online', pagamentoStatus: 'pendente', senha: 9, cliente: { nome: 'Bia Souza' } }));
  /* a loja nao ligou o cartao: a copia da borda diz */
  const copia = kv.mapa.get('loja:dom-conizza');
  const lojaCopia = JSON.parse(copia.valor);
  lojaCopia.loja.aceitaCartaoOnline = false;
  copia.valor = JSON.stringify(lojaCopia);
  w = await workerNovo();
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC, token: 'APROVA1234567890', metodo: 'master' } });
  ok(r.status === 409 && cartoes.length === 0, 'loja que nao ligou o cartao: nao cobra');
  lojaCopia.loja.aceitaCartaoOnline = true;
  copia.valor = JSON.stringify(lojaCopia);
  /* sem token do cartao: nem chama o Mercado Pago */
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC, metodo: 'master' } });
  ok(r.status === 400 && cartoes.length === 0, 'sem o token do cartao: 400, nada cobrado');
  /* recusado: motivo em palavras de cliente, pedido continua esperando */
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC, token: 'RECUSA1234567890', metodo: 'master', documento: '123.456.789-09' } });
  j = await r.json();
  ok(j.status === 'recusado' && /limite/.test(j.motivo), 'cartao sem limite: recusado com o motivo certo');
  ok(cartoes[0].corpo.payer.identification.number === '12345678909' && cartoes[0].corpo.transactions.payments[0].payment_method.installments === 1, 'manda o CPF limpo e cobra a vista');
  ok(db.get('lojas/dom-conizza/pedidos/' + PC).status === 'aguardando_pagamento', 'recusado: o pedido continua esperando o pagamento');
  /* aprovado: marca pago na hora (o mesmo conferir do Pix: valor e referencia) */
  zerar();
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC, token: 'APROVA1234567890', metodo: 'master' } });
  j = await r.json(); await fim();
  const pc = db.get('lojas/dom-conizza/pedidos/' + PC);
  ok(j.status === 'aprovado' && pc.status === 'pago' && pc.pagamentoStatus === 'pago' && pc.confirmadoPor === 'mercadopago', 'cartao aprovado: pedido pago na hora');
  const gastoCartao = { leituras: conta.leituras, gravacoes: conta.gravacoes };
  ok(pc.mp && /^ORD/.test(pc.mp.id) && pc.cobrandoEm === '' && gastoCartao.gravacoes === 2 && gastoCartao.leituras <= 2, 'aprovado na hora: a trava e o "pago" com o id (2 gravacoes, ' + gastoCartao.leituras + ' leituras)');
  ok(cartoes[1].corpo.total_amount === (precoP1() / 100).toFixed(2) && cartoes[1].corpo.payer.email === 'cliente9@dom-conizza.ligeiropedidos.com.br', 'cobra o valor do pedido (nao o que o site mandou)');
  /* toque duplo depois de pago: nao cobra de novo */
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC, token: 'APROVA0000000000', metodo: 'master' } });
  ok((await r.json()).status === 'aprovado' && cartoes.length === 2, 'pedido ja pago: responde aprovado sem cobrar de novo');
  /* pedido de Pix nao vira cobranca de cartao */
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PED, token: 'APROVA1111111111', metodo: 'master' } });
  ok(r.status === 400 && cartoes.length === 2, 'pedido de Pix: /cartao recusa');
  /* tentativas demais no mesmo pedido: para antes de chamar o Mercado Pago */
  const PC2 = 'cartao00000000000002';
  db.set('lojas/dom-conizza/pedidos/' + PC2, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'cartao_online', senha: 10, cliente: { nome: 'Caio' } }));
  for (let i = 0; i < 4; i++) await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC2, token: 'RECUSA000000000' + i, metodo: 'visa' } });
  const antes = cartoes.length;
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC2, token: 'RECUSA0000000009', metodo: 'visa' } });
  ok(/Tentativas demais/.test((await r.json()).motivo) && cartoes.length === antes, '5a tentativa no mesmo pedido: barrada sem chamar o Mercado Pago');

  /* a loja cancelou o pedido pago no cartao: o dinheiro volta sozinho, so pelo dono */
  const devolver = (tok) => chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC }, headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  r = await devolver('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura');
  ok(r.status === 409 && devolucoes.length === 0, 'devolver pedido que nao foi cancelado: recusa');
  db.get('lojas/dom-conizza/pedidos/' + PC).status = 'cancelado';
  r = await devolver('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura');
  ok(r.status === 403 && devolucoes.length === 0, 'devolver: quem nao e o dono nao devolve');
  r = await devolver('');
  ok(r.status === 400 && devolucoes.length === 0, 'devolver sem login: 400');
  r = await devolver('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura');
  j = await r.json();
  ok(j.ok === true && devolucoes.length === 1 && devolucoes[0].id === db.get('lojas/dom-conizza/pedidos/' + PC).mp.id, 'dono cancela: devolve a order inteira no Mercado Pago');
  ok(!!db.get('lojas/dom-conizza/pedidos/' + PC).devolvidoEm && devolucoes[0].chave === 'devolver-' + PC, 'marca devolvido no pedido, com chave que nao repete');
  r = await devolver('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura');
  ok((await r.json()).ja === true && devolucoes.length === 1, 'devolver de novo: nao chama o Mercado Pago outra vez');
  db.set('lojas/dom-conizza/pedidos/cartao00000000000003', { status: 'cancelado', formaPagamento: 'dinheiro_entrega', pagamentoStatus: 'na_entrega', total: 1000, senha: 11 });
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'cartao00000000000003' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok(r.status === 409 && devolucoes.length === 1, 'pedido pago na porta: nao ha o que devolver pelo site');
}

console.log('Pentest: ataques que tem que falhar');
{
  w = await workerNovo();
  /* a loja de teste com o cartao ligado no banco (o worker rele a loja quando o valor nao bate com a copia) */
  Object.assign(db.get('lojas/dom-conizza'), { aceitaCartaoOnline: true, mpChavePublica: 'APP_USR-teste' });
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const aqui = path.dirname(url.fileURLToPath(import.meta.url));
  const fonteWorker = fs.readFileSync(path.join(aqui, '..', 'ferramentas', 'worker-mercadopago.js'), 'utf8');
  const fonteRegras = fs.readFileSync(path.join(aqui, '..', 'js', 'regras.js'), 'utf8');
  ok(fonteWorker.indexOf(fonteRegras.trimEnd()) >= 0, 'as regras dentro do worker sao iguais ao js/regras.js (rode ferramentas/embutir-regras.py se mudar)');

  /* total forjado: itens de verdade e total de R$ 1 gravado direto no banco */
  const FORJADO = 'forjadoforjadoforj01';
  db.set('lojas/dom-conizza/pedidos/' + FORJADO, pedidoDe(2, { total: 100, status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 40, cliente: { nome: 'Esperto' } }));
  const ordensAntes = ordens.size;
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: FORJADO } });
  ok(r.status === 409 && ordens.size === ordensAntes, 'Pix de pedido com total forjado: recusado, nada criado no Mercado Pago');
  const FORJADO2 = 'forjadoforjadoforj02';
  db.set('lojas/dom-conizza/pedidos/' + FORJADO2, pedidoDe(3, { total: 100, status: 'aguardando_pagamento', formaPagamento: 'cartao_online', senha: 41, cliente: { nome: 'Esperto' } }));
  const cartoesAntes = cartoes.length;
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: FORJADO2, token: 'APROVA5555555555', metodo: 'visa' } });
  ok(r.status === 409 && cartoes.length === cartoesAntes, 'cartao de pedido com total forjado: recusado, nada cobrado');
  /* item que nao existe no cardapio */
  const FANTASMA = 'fantasmafantasmafa01';
  db.set('lojas/dom-conizza/pedidos/' + FANTASMA, { itens: [{ produtoId: 'naoexiste', quantidade: 1 }], total: 500, tipoEntrega: 'retirada', status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 42, criadoEm: new Date().toISOString() });
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: FANTASMA } });
  ok(r.status === 409, 'pedido com item que nao existe no cardapio: recusado');
  /* nomes com caminho escondido nao chegam no banco */
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza/pedidos', pedido: PED } });
  ok(r.status === 400, '/criar com loja "dom-conizza/pedidos": 400');
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + encodeURIComponent('../privado/mercadopago'));
  ok(r.status === 400, '/status com pedido "../privado/mercadopago": 400');
  r = await chamar(w, '/equipe', { metodo: 'POST', corpo: { loja: '../../contas/x', pin: '48291375' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok(r.status === 400, '/equipe com loja inventada: 400');
  r = await chamar(w, '/equipe', { metodo: 'POST', corpo: { loja: 'dom-conizza', pin: '12345678' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok(r.status === 400, 'senha da equipe 12345678 (sequencia): recusada');
  const contasAntes = contasAtualizadas.length;
  r = await chamar(w, '/equipe', { metodo: 'POST', corpo: { loja: 'dom-conizza', pin: '48291375' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  const contaEquipe = contasAtualizadas.slice(contasAntes).filter((c) => c.password)[0] || {};
  ok(r.status === 200 && contaEquipe.email === 'equipe-dom-conizza@equipe.ligeiropedidos.com.br' && contaEquipe.password === 'LIG-48291375' && JSON.parse(contaEquipe.customAttributes || '{}').equipe === 'dom-conizza', 'senha da equipe salva: o login fica no dominio do Ligeiro (nao no ligeiro.app.br), com a marca da loja');
  /* duas cobrancas do mesmo pedido: a segunda espera */
  const DUPLO = 'duploduploduplodup01';
  db.set('lojas/dom-conizza/pedidos/' + DUPLO, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'cartao_online', senha: 43, cliente: { nome: 'Dani' }, cobrandoEm: new Date().toISOString() }));
  const antesDuplo = cartoes.length;
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: DUPLO, token: 'APROVA6666666666', metodo: 'visa' } });
  j = await r.json();
  ok(j.status === 'recusado' && /andamento/.test(j.motivo) && cartoes.length === antesDuplo, 'cobranca em andamento: a segunda nao cobra');
  /* a trava do banco: se o pedido mudou entre a leitura e a trava, nao cobra */
  db.get('lojas/dom-conizza/pedidos/' + DUPLO).cobrandoEm = '';
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).indexOf('currentDocument.updateTime') >= 0) versoes.set('lojas/dom-conizza/pedidos/' + DUPLO, 999); /* outra aba mexeu antes */
    return fetchOriginal(u, o);
  };
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: DUPLO, token: 'APROVA7777777777', metodo: 'visa' } });
  globalThis.fetch = fetchOriginal;
  j = await r.json();
  ok(j.status === 'recusado' && cartoes.length === antesDuplo, 'duas abas ao mesmo tempo: so uma cobra (trava pela hora da ultima mudanca)');
  /* tentativas contadas no pedido: vale em qualquer copia do worker */
  db.get('lojas/dom-conizza/pedidos/' + DUPLO).tentativasCartao = 5;
  w = await workerNovo();
  r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: DUPLO, token: 'APROVA8888888888', metodo: 'visa' } });
  j = await r.json();
  ok(j.status === 'recusado' && /Tentativas demais/.test(j.motivo) && cartoes.length === antesDuplo, '5 tentativas no pedido: barrado ate num worker novo');
  /* a loja cancelou e o Pix caiu depois: fica marcado para devolver */
  const TARDE = 'tardetardetardetar01';
  db.set('lojas/dom-conizza/pedidos/' + TARDE, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 44, cliente: { nome: 'Gabi' } }));
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: TARDE } }); j = await r.json();
  db.get('lojas/dom-conizza/pedidos/' + TARDE).status = 'cancelado';
  db.get('lojas/dom-conizza/pedidos/' + TARDE).canceladoPor = 'loja';
  ordens.get(j.mp).status = 'processed';
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: j.mp, external_reference: 'dom-conizza__' + TARDE } }, headers: { Origin: '' } });
  const tarde = db.get('lojas/dom-conizza/pedidos/' + TARDE);
  ok(tarde.status === 'cancelado' && tarde.pagamentoStatus === 'pago' && tarde.pagoAposCancelar === true, 'pago depois que a loja cancelou: continua cancelado e fica marcado para devolver');
  const devAntes = devolucoes.length;
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: TARDE }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok((await r.json()).ok === true && devolucoes.length === devAntes + 1, 'e o dono devolve com um toque');
  /* aviso do Mercado Pago sem assinatura, com o segredo configurado: recusado */
  const envAssinado = Object.assign({}, env, { MP_WEBHOOK_SECRET: 'segredo-do-webhook' });
  r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: j.mp } }, headers: { Origin: '' }, env: envAssinado });
  ok(r.status === 401, 'webhook sem a assinatura do Mercado Pago (com o segredo ligado): 401');
  const ts = String(Math.floor(Date.now() / 1000));
  const molde = 'id:' + String(j.mp).toLowerCase() + ';request-id:req-1;ts:' + ts + ';';
  const cripto = await import('node:crypto');
  const v1 = cripto.createHmac('sha256', 'segredo-do-webhook').update(molde).digest('hex');
  r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: j.mp } }, headers: { Origin: '', 'x-signature': 'ts=' + ts + ',v1=' + v1, 'x-request-id': 'req-1' }, env: envAssinado });
  ok(r.status === 200, 'webhook assinado certo: aceito');
  /* o erro nunca devolve detalhe tecnico */
  globalThis.__limite = true;
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PED } });
  globalThis.__limite = false;
  j = await r.json();
  ok(!/Firestore|429|RESOURCE/.test(JSON.stringify(j)), 'erro interno sem detalhe do banco na resposta');
  /* o 429 de mentira deixou o aviso de "banco no limite" no KV: tira, para os proximos testes */
  for (const k of [...kv.mapa.keys()]) if (/pausa/i.test(k)) kv.mapa.delete(k);
}

console.log('Pedido criado pelo servidor');
{
  const loja = db.get('lojas/dom-conizza');
  Object.assign(loja, { aberta: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true, aceitaDinheiroEntrega: true, cupons: [{ codigo: 'PROMO', percentual: 10, limite: 1, ativo: true }] });
  const recarregar = async () => { kv.mapa.delete('loja:dom-conizza'); kv.mapa.delete('cupons:dom-conizza'); w = await workerNovo(); };
  await recarregar();
  const dados = (extra) => Object.assign({ nome: 'Ana Souza', telefone: '13999990000', tipoEntrega: 'retirada', itens: [{ produtoId: 'p1', quantidade: 2 }], formaPagamento: 'pix' }, extra);
  const pedir = (d, op) => chamar(w, '/pedido', Object.assign({ metodo: 'POST', corpo: { loja: 'dom-conizza', dados: d } }, op || {}));
  db.delete('lojas/dom-conizza/contadores/senha');

  r = await pedir(dados()); j = await r.json();
  const criado = j.pedido && db.get('lojas/dom-conizza/pedidos/' + j.pedido.id);
  ok(r.status === 200 && criado && criado.total === precoP1() * 2 && criado.status === 'aguardando_pagamento', 'pedido nasce no servidor com o total do cardapio');
  ok(criado && criado.senha === 1 && db.get('lojas/dom-conizza/contadores/senha').ultima === 1, 'com a senha do dia (1) e o contador no mesmo lote');
  ok(criado && criado.itens[0].nome === 'Pizza' && /^[A-Za-z0-9]{20}$/.test(criado.id), 'nome do item vem do cardapio e o id e sorteado aqui');
  /* o celular manda preco, nome e total inventados: nada disso vale */
  r = await pedir(dados({ itens: [{ produtoId: 'p1', quantidade: 1, preco: 1, nome: 'Pizza Gigante com Bacon' }], total: 1, desconto: 999999, cupom: 'QUALQUER' }));
  j = await r.json();
  ok(r.status === 422 && /código não existe/.test(j.erro || ''), 'cupom inventado: o pedido nem nasce');
  r = await pedir(dados({ itens: [{ produtoId: 'p1', quantidade: 1, preco: 1, nome: 'Pizza Gigante com Bacon' }], total: 1 }));
  j = await r.json();
  const troca = j.pedido && db.get('lojas/dom-conizza/pedidos/' + j.pedido.id);
  ok(troca && troca.total === precoP1() && troca.itens[0].nome === 'Pizza' && troca.senha === 2, 'preco e nome inventados ignorados: vale o cardapio');
  /* cupom com limite de 1 uso: o segundo nao passa */
  r = await pedir(dados({ cupom: 'PROMO' })); j = await r.json();
  ok(r.status === 200 && j.pedido.desconto > 0 && db.get('lojas/dom-conizza/contadores/cupom-PROMO').usos === 1, 'cupom de verdade: aplica e conta o uso');
  r = await pedir(dados({ cupom: 'PROMO', telefone: '13988887777' })); j = await r.json();
  ok(r.status === 422 && /todo usado/.test(j.erro || ''), 'cupom com limite 1 no segundo uso: recusado no servidor');
  /* o pedido que gastou o cupom foi cancelado: o uso volta e o proximo cliente consegue usar */
  {
    const gastou = db.get('lojas/dom-conizza/contadores/cupom-PROMO').pedidos[0];
    const pd = db.get('lojas/dom-conizza/pedidos/' + gastou); db.set('lojas/dom-conizza/pedidos/' + gastou, Object.assign(pd, { status: 'cancelado' }));
    r = await pedir(dados({ cupom: 'PROMO', telefone: '13988886666' })); j = await r.json();
    ok(r.status === 200 && j.pedido.desconto > 0 && db.get('lojas/dom-conizza/contadores/cupom-PROMO').usos === 1, 'pedido com cupom cancelado: o uso volta e o proximo cliente usa (limite 1 continua 1)');
    r = await pedir(dados({ cupom: 'PROMO', telefone: '13988885555' })); j = await r.json();
    ok(r.status === 422 && /todo usado/.test(j.erro || ''), 'e o limite segue valendo para o pedido seguinte');
  }
  /* forma de pagamento que a loja nao aceita e recusada (antes virava outra calada: "Pix" chegava como maquininha); loja fechada nao recebe */
  r = await pedir(dados({ formaPagamento: 'cartao_entrega', telefone: '13977776666' })); j = await r.json();
  ok(r.status === 422 && /forma de pagamento não está disponível/.test(j.erro || ''), 'maquininha desligada: o pedido na maquininha e recusado, nao vira outra forma');
  /* Pix combinado com a loja no WhatsApp: desligado e recusado; ligado (com o WhatsApp da loja) nasce esperando, 'a_combinar' */
  r = await pedir(dados({ formaPagamento: 'pix_combinado', telefone: '13955554444' })); j = await r.json();
  ok(r.status === 422 && /forma de pagamento não está disponível/.test(j.erro || ''), 'Pix combinado desligado: recusado');
  Object.assign(loja, { aceitaPixCombinado: true, whatsapp: '13996447414' }); await recarregar();
  r = await pedir(dados({ formaPagamento: 'pix_combinado', telefone: '13955554444' })); j = await r.json();
  const comb = j.pedido && db.get('lojas/dom-conizza/pedidos/' + j.pedido.id);
  ok(r.status === 200 && comb && comb.formaPagamento === 'pix_combinado' && comb.status === 'aguardando_pagamento' && comb.pagamentoStatus === 'a_combinar' && !comb.pagoEm, 'Pix combinado ligado: nasce esperando a loja confirmar');
  r = await chamar(w, '/recursos'); j = await r.json();
  ok(r.status === 200 && j.borda === 1 && (j.recursos || []).indexOf('pix-combinado') >= 0, '/recursos diz que este mensageiro aceita o Pix combinado (o painel so oferece com ele)');
  ok(['ofertas', 'preco-tamanho'].every((x) => (j.recursos || []).indexOf(x) >= 0), '/recursos diz que este mensageiro cobra a oferta e o preco por tamanho (o painel so oferece com ele)');
  ok(j.email === false && JSON.stringify(j).indexOf('script.google.com') < 0, '/recursos mostra so se o aviso por e-mail esta ligado (sim ou nao), nunca o endereco nem a senha');
  delete loja.aceitaPixCombinado; await recarregar();
  loja.aberta = false; await recarregar();
  r = await pedir(dados({ telefone: '13966665555' })); j = await r.json();
  ok(r.status === 422 && /fechada/.test(j.erro || ''), 'loja fechada: o pedido nao nasce');
  loja.aberta = true; await recarregar();
  /* fuso da loja pelo estado: faixa de 1 h em volta da hora de Cuiaba (4 h atras de Londres), que em Brasilia ja passou */
  {
    const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    const mt = new Date(Date.now() - 4 * 3600e3), m = mt.getHours() * 60 + mt.getMinutes();
    const faixa = hm(m - 30) + '-' + hm(m + 30), horarios = {};
    ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].forEach((d) => { horarios[d] = [faixa]; });
    const ufAntes = loja.uf;
    Object.assign(loja, { usarHorarios: true, horarios, uf: 'MT' }); await recarregar();
    r = await pedir(dados({ telefone: '13944443333' })); j = await r.json();
    ok(r.status === 200, 'loja de Cuiaba (MT) aberta na hora de la: o pedido nasce (antes contava a hora de Brasilia e recusava)');
    loja.uf = 'SP'; await recarregar();
    r = await pedir(dados({ telefone: '13944442222' })); j = await r.json();
    ok(r.status === 422 && /fechada/.test(j.erro || ''), 'a mesma faixa numa loja de SP: em Brasilia ja fechou');
    Object.assign(loja, { usarHorarios: false, uf: ufAntes }); delete loja.horarios; await recarregar();
  }
  /* "Abrir agora" fora do horario (Dom Conizza, 07/10/2026: a chave ligada as 17:00 nao abria a loja das 18:00 as 23:00) */
  {
    const DONO = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura';
    const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    const sp = new Date(Date.now() - 3 * 3600e3), m = sp.getHours() * 60 + sp.getMinutes();
    const horarios = {};
    ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].forEach((d) => { horarios[d] = [hm(m + 120) + '-' + hm(m + 180)]; }); /* a faixa comeca daqui a 2 h */
    const ufAntes = loja.uf;
    Object.assign(loja, { usarHorarios: true, horarios, uf: 'SP' }); await recarregar();
    r = await pedir(dados({ telefone: '13944440001' })); j = await r.json();
    ok(r.status === 422 && /fechada/.test(j.erro || ''), 'fora do horario, sem "Abrir agora": fechada');
    loja.abertaAte = new Date(Date.now() + 3600e3).toISOString(); await recarregar();
    r = await pedir(dados({ telefone: '13944440002' })); j = await r.json();
    ok(r.status === 200, '"Abrir agora" fora do horario: o pedido nasce');
    loja.abertaAte = new Date(Date.now() - 60e3).toISOString(); await recarregar();
    r = await pedir(dados({ telefone: '13944440003' })); j = await r.json();
    ok(r.status === 422 && /fechada/.test(j.erro || ''), 'passou da hora do "Abrir agora": fechada de novo pelo horario');
    /* esta copia do worker guardou na memoria a loja fechada; o dono abre e publica por outra copia (so o KV muda) */
    loja.abertaAte = ''; await recarregar();
    r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
    ok(j.loja.abertaAte === '', 'memoria desta copia: a loja fechada');
    loja.abertaAte = new Date(Date.now() + 3600e3).toISOString();
    r = await chamar(await workerNovo(), '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: DONO } }); const pub = await r.json();
    await esperarFundo();
    ok(r.status === 200 && pub.versao > 0, 'o dono publica e recebe a versao da copia nova');
    zerar(); kv.leituras = 0;
    r = await pedir(dados({ telefone: '13944440004' })); j = await r.json();
    ok(r.status === 200 && kv.leituras > 0, 'a memoria dizia fechada: o mensageiro confere o KV e o pedido nasce (antes recusava por ate 1 min)');
    /* o site do aparelho que publicou pede a versao nova: a memoria velha nao responde */
    const w2 = await workerNovo();
    loja.abertaAte = ''; kv.mapa.delete('loja:dom-conizza');
    r = await chamar(w2, '/loja/dom-conizza'); j = await r.json();
    ok(j.loja.abertaAte === '', 'outra copia guarda na memoria a loja fechada');
    loja.abertaAte = new Date(Date.now() + 3600e3).toISOString();
    r = await chamar(await workerNovo(), '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: DONO } }); const pub2 = await r.json();
    await esperarFundo();
    r = await chamar(w2, '/loja/dom-conizza'); j = await r.json();
    ok(j.loja.abertaAte === '', 'sem pedir versao, a memoria (15 s) ainda responde');
    await new Promise((ok2) => setTimeout(ok2, 2100));
    r = await chamar(w2, '/loja/dom-conizza?v=' + pub2.versao); j = await r.json();
    ok(j.loja.abertaAte === loja.abertaAte, 'pedindo a versao que acabou de publicar: vem a copia nova');
    kv.leituras = 0;
    for (let i = 0; i < 5; i++) await chamar(w2, '/loja/dom-conizza?v=' + (Date.now() + 9e9));
    ok(kv.leituras <= 1, 'versao do futuro em sequencia nao gasta o KV a cada chamada');
    r = await chamar(w, '/recursos'); j = await r.json();
    ok((j.recursos || []).indexOf('abrir-agora') >= 0, '/recursos diz que este mensageiro aceita o "Abrir agora" (o painel so oferece com ele)');
    Object.assign(loja, { usarHorarios: false, uf: ufAntes }); delete loja.horarios; delete loja.abertaAte; await recarregar();
  }
  /* loja AMOSTRA: nem chamando direto */
  loja.amostra = true; await recarregar();
  r = await pedir(dados({ telefone: '13944441111' })); j = await r.json();
  ok(r.status === 409 && /amostra/.test(j.erro || ''), 'loja amostra: o pedido nao nasce nem chamando o mensageiro direto');
  delete loja.amostra; await recarregar();
  /* dois pedidos disputando a mesma senha: o segundo tenta de novo e pega a proxima */
  const senhaAntes = db.get('lojas/dom-conizza/contadores/senha').ultima;
  globalThis.__falharLote = 1;
  r = await pedir(dados({ telefone: '13955554444' })); j = await r.json();
  ok(r.status === 200 && j.pedido.senha === senhaAntes + 1, 'lote que perdeu a corrida tenta de novo: senha certa, sem repetir');
  /* balcao sem o login da equipe */
  r = await pedir(dados({ origem: 'balcao', telefone: '' }));
  ok(r.status === 401, 'pedido "do balcao" sem o login da equipe: 401');
  r = await pedir(dados({ origem: 'balcao', telefone: '', nome: '' }), { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura' } }); j = await r.json();
  ok(r.status === 200 && j.pedido.origem === 'balcao', 'com o login da equipe, o balcao pede sem WhatsApp');
  r = await pedir(dados({ origem: 'balcao', telefone: '', nome: '' }), { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtdmVsaGEifQ.assinatura' } });
  ok(r.status === 401, 'conta criada por fora com cara de equipe (equipe-<loja>@..., sem a marca do mensageiro): barrada');
  marcas['equipe-dom-conizza@equipe.ligeiro.app.br'] = JSON.stringify({ equipe: 'dom-conizza' });
  r = await pedir(dados({ origem: 'balcao', telefone: '', nome: '' }), { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtdmVsaGEyIn0.assinatura' } });
  ok(r.status === 401, 'login velho da equipe (ligeiro.app.br), mesmo com a marca: barrado ate o dono salvar a senha de novo');
  r = await pedir(dados({ origem: 'balcao', telefone: '', nome: '' }), { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUtb3V0cmEifQ.assinatura' } });
  ok(r.status === 401 || r.status === 403, 'equipe de outra loja nao pede pelo balcao desta');
  /* o aviso no celular so com endereco de servico de aviso de verdade */
  r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: dados({ telefone: '13944443333' }), aviso: { e: 'https://site-do-golpe.example/x', k: 'a'.repeat(87), a: 'b'.repeat(22), u: '#/juquia/dom-conizza/pedido/' } } }); j = await r.json();
  ok(r.status === 200 && !db.get('lojas/dom-conizza/pedidos/' + j.pedido.id).aviso, 'aviso para endereco qualquer: ignorado');
  /* spam: muitos pedidos do mesmo aparelho */
  w = await workerNovo();
  let barrado = false;
  for (let i = 0; i < 20 && !barrado; i++) { r = await pedir(dados({ telefone: '1393333' + String(1000 + i) })); if (r.status === 429) barrado = true; }
  ok(barrado, 'muitos pedidos seguidos do mesmo aparelho: barrado');
  w = await workerNovo();
  let barradoFone = false;
  for (let i = 0; i < 10 && !barradoFone; i++) { r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: dados({ telefone: '13922221111' }) }, headers: { 'CF-Connecting-IP': '10.0.0.' + i } }); if (r.status === 429) barradoFone = true; }
  ok(barradoFone, 'muitos pedidos do mesmo telefone (trocando de aparelho): barrado');
  /* a lista de cupons nao sai na copia publica: so "tem cupom" */
  r = await chamar(w, '/loja/dom-conizza'); j = await r.json();
  ok(!('cupons' in j.loja) && j.loja.temCupom === true, 'copia publica da loja: sem a lista de cupons, so "temCupom"');
  /* o site pergunta se o codigo vale */
  const cupom = (codigo, ip) => chamar(w, '/cupom', { metodo: 'POST', corpo: { loja: 'dom-conizza', codigo }, headers: { 'CF-Connecting-IP': ip || '10.9.9.9' } });
  db.set('lojas/dom-conizza/privado/cupons', { lista: [{ codigo: 'SEGREDO', percentual: 100, minimo: 0, limite: 0, ativo: true }, { codigo: 'VELHO', percentual: 5, ativo: false }] });
  await recarregar();
  r = await cupom('segredo'); j = await r.json();
  ok(j.cupom && j.cupom.codigo === 'SEGREDO' && j.cupom.percentual === 100 && !('limite' in j.cupom), 'cupom da parte privada: o mensageiro confirma (sem contar o limite)');
  r = await cupom('PROMO'); j = await r.json();
  ok(!j.cupom && /não existe/.test(j.erro || ''), 'com a lista privada, o cupom velho do documento nao vale mais');
  r = await cupom('VELHO'); j = await r.json();
  ok(/não está mais valendo/.test(j.erro || ''), 'cupom desligado: avisa');
  r = await pedir(dados({ cupom: 'SEGREDO', telefone: '13911112222' })); j = await r.json();
  ok(r.status === 200 && j.pedido.total === 0 && j.pedido.desconto > 0, 'pedido com o cupom privado: desconto aplicado no servidor');
  let chutes = 0, barradoCupom = false;
  for (let i = 0; i < 20 && !barradoCupom; i++) { r = await cupom('CHUTE' + i, '10.8.8.8'); chutes++; if (r.status === 429) barradoCupom = true; }
  ok(barradoCupom && chutes <= 13, 'chute de codigo: barrado depois de 12 tentativas');
  db.delete('lojas/dom-conizza/privado/cupons');
  loja.cupons = [];
  await recarregar();
}

console.log('Mercado Pago: quando algo da errado');
{
  w = await workerNovo();
  const fetchBom = globalThis.fetch;
  /* faz o proximo pedido (ou os proximos n) que casar com o teste falhar com 500 */
  const comFalha = (teste, n) => { let vezes = n || 1; globalThis.fetch = async (u, o) => { if (vezes > 0 && teste(String(u), o || {})) { vezes--; return new Response(JSON.stringify({ message: 'falha de mentira' }), { status: 500 }); } return fetchBom(u, o); }; };
  const semFalha = () => { globalThis.fetch = fetchBom; };
  const caminhoDe = (id) => 'lojas/dom-conizza/pedidos/' + id;
  const novo = (id, forma, senha) => db.set(caminhoDe(id), pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: forma, senha, cliente: { nome: 'Rui Teste' } }));
  const criarPix = (id) => chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: id } });
  const cobrar = (id, token) => chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: id, token, metodo: 'master' }, headers: { 'CF-Connecting-IP': '10.7.' + Math.floor(Math.random() * 250) + '.1' } });
  const aviso = (idMp, pedido) => chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: idMp, external_reference: 'dom-conizza__' + pedido } }, headers: { Origin: '' } });
  const orderPaga = (idMp, pedido, status) => ordens.set(idMp, { id: idMp, status: status || 'processed', external_reference: 'dom-conizza__' + pedido, total_amount: (precoP1() / 100).toFixed(2), transactions: { payments: [{ id: 'PAY' + idMp, status: status || 'processed', status_detail: status ? 'waiting_transfer' : 'accredited' }] } });

  /* 1. Mercado Pago fora do ar na hora de gerar o Pix */
  const P1 = 'mpfalhapix0000000001'; novo(P1, 'pix', 70);
  comFalha((u, o) => u.indexOf('api.mercadopago.com/v1/orders') >= 0 && o.method === 'POST', 2);
  r = await criarPix(P1); semFalha();
  ok(r.status >= 500 && !db.get(caminhoDe(P1)).pixCodigo, 'Pix: Mercado Pago fora do ar, erro claro e nada pela metade no pedido');
  const P1b = 'mpfalhapix000000001b'; novo(P1b, 'pix', 69);
  comFalha((u, o) => u.indexOf('api.mercadopago.com/v1/orders') >= 0 && o.method === 'POST', 1);
  r = await criarPix(P1b); j = await r.json(); semFalha();
  ok(r.status === 200 && j.codigo, 'Pix: um tropeco so do Mercado Pago, o worker repete sozinho e o codigo sai');
  r = await criarPix(P1); j = await r.json();
  ok(r.status === 200 && j.codigo && db.get(caminhoDe(P1)).pixCodigo === j.codigo, 'Pix: tentando de novo, o codigo sai normal');

  /* 2. dois toques ao mesmo tempo em gerar o Pix */
  const P2 = 'mpfalhapix0000000002'; novo(P2, 'pix', 71);
  let antes = ordens.size;
  const [ra, rb] = await Promise.all([criarPix(P2), criarPix(P2)]);
  const ja = await ra.json(), jb = await rb.json();
  ok(ja.codigo && ja.codigo === jb.codigo && ordens.size === antes + 1, 'Pix: dois toques juntos, um Pix so e o mesmo codigo');

  /* 3. o Mercado Pago criou o Pix, mas o banco falhou ao guardar o codigo */
  const P3 = 'mpfalhapix0000000003'; novo(P3, 'pix', 72);
  antes = ordens.size;
  comFalha((u, o) => u.indexOf(BASE + caminhoDe(P3)) === 0 && o.method === 'PATCH');
  r = await criarPix(P3); semFalha();
  ok(r.status >= 500, 'Pix: banco falhou depois do Mercado Pago, o cliente ve o erro');
  r = await criarPix(P3); j = await r.json();
  ok(r.status === 200 && ordens.size === antes + 1 && db.get(caminhoDe(P3)).pixCodigo === j.codigo, 'Pix: na nova tentativa, o mesmo Pix de antes (o Mercado Pago nao cria outro)');

  /* 3b. cobranca aprovada a mais para o mesmo pedido (Pix pago duas vezes, cartao repetido): volta sozinha */
  const PDup = 'mpduplicada000000001'; novo(PDup, 'pix', 74);
  orderPaga('ORD990101', PDup); orderPaga('ORD990102', PDup);
  await aviso('ORD990101', PDup);
  const devAntesD = devolucoes.length;
  await aviso('ORD990102', PDup);
  const pd = db.get(caminhoDe(PDup));
  const ultimaDev = devolucoes[devolucoes.length - 1] || {};
  ok(pd.status === 'pago' && pd.pagoPor === 'ORD990101' && devolucoes.length === devAntesD + 1 && ultimaDev.id === 'ORD990102' && ultimaDev.chave === 'duplicada-ORD990102', 'segunda cobranca aprovada do mesmo pedido: devolvida sozinha (a que pagou fica)');
  ok(pd.cobrancas.indexOf('ORD990101') >= 0 && pd.cobrancas.indexOf('ORD990102') >= 0, 'as duas cobrancas ficam anotadas no pedido');
  await aviso('ORD990102', PDup);
  ok(devolucoes.length === devAntesD + 1, 'o Mercado Pago avisando de novo: nao devolve duas vezes');
  await aviso('ORD990101', PDup);
  ok(devolucoes.length === devAntesD + 1 && db.get(caminhoDe(PDup)).status === 'pago', 'o aviso repetido da cobranca que pagou: nada muda');
  const PL = 'mpantigo000000000001'; db.set(caminhoDe(PL), pedidoDe(1, { status: 'pago', pagamentoStatus: 'pago', formaPagamento: 'pix', senha: 75, mp: { id: 'ORD990103' } }));
  orderPaga('ORD990104', PL);
  const devAntesL = devolucoes.length;
  await aviso('ORD990104', PL);
  ok(devolucoes.length === devAntesL, 'pedido pago antes desta anotacao: a cobranca a mais so e anotada, nunca devolvida sozinha');

  /* 4. o aviso de pago chega antes do codigo ser gravado (corrida) */
  const P4 = 'mpfalhapix0000000004'; novo(P4, 'pix', 73);
  orderPaga('ORD990004', P4);
  r = await aviso('ORD990004', P4);
  ok(r.status === 200 && db.get(caminhoDe(P4)).status === 'pago', 'Pix: aviso de pago antes do codigo gravado, o pedido vira pago do mesmo jeito');

  /* 5. aviso de uma order que nao existe no Mercado Pago */
  r = await aviso('ORD990404', P1);
  ok(r.status === 200 && db.get(caminhoDe(P1)).status === 'aguardando_pagamento', 'aviso de order que o Mercado Pago nao conhece: responde ok (sem repetir para sempre) e nada muda');

  /* 6. aviso com o Pix ainda esperando */
  const P6 = 'mpfalhapix0000000006'; novo(P6, 'pix', 75);
  orderPaga('ORD990006', P6, 'action_required');
  r = await aviso('ORD990006', P6);
  ok(r.status === 200 && db.get(caminhoDe(P6)).status === 'aguardando_pagamento', 'aviso com o Pix ainda esperando: o pedido continua esperando');

  /* 7. o mesmo aviso tres vezes */
  zerar();
  await aviso('ORD990004', P4); await aviso('ORD990004', P4); await aviso('ORD990004', P4);
  ok(conta.gravacoes === 0 && db.get(caminhoDe(P4)).status === 'pago', 'aviso repetido 3 vezes com o pedido ja pago: nenhuma gravacao a mais');

  /* 8. aviso com valor diferente do pedido (Pix de outro valor) */
  const P8 = 'mpfalhapix0000000008'; novo(P8, 'pix', 76);
  ordens.set('ORD990008', { id: 'ORD990008', status: 'processed', external_reference: 'dom-conizza__' + P8, total_amount: '0.50', transactions: { payments: [{ id: 'PAYx', status: 'processed', status_detail: 'accredited' }] } });
  r = await aviso('ORD990008', P8);
  ok(db.get(caminhoDe(P8)).status === 'aguardando_pagamento', 'aviso de um pagamento de valor diferente: nao libera o pedido');

  /* 9. aviso de uma order de outra loja apontando para este pedido */
  const P9 = 'mpfalhapix0000000009'; novo(P9, 'pix', 77);
  ordens.set('ORD990009', { id: 'ORD990009', status: 'processed', external_reference: 'outra-loja__' + P9, total_amount: (precoP1() / 100).toFixed(2), transactions: { payments: [{ id: 'PAYy', status: 'processed' }] } });
  r = await aviso('ORD990009', P9);
  ok(db.get(caminhoDe(P9)).status === 'aguardando_pagamento', 'aviso com a referencia de outra loja: nao libera este pedido');

  /* 10. cartao com o Mercado Pago fora do ar */
  const C1 = 'mpfalhacartao0000001'; novo(C1, 'cartao_online', 78);
  let cobradas = cartoes.length;
  comFalha((u, o) => u.indexOf('api.mercadopago.com/v1/orders') >= 0 && o.method === 'POST', 2);
  r = await cobrar(C1, 'APROVA9000000001'); j = await r.json(); semFalha();
  let pc = db.get(caminhoDe(C1));
  ok(j.status === 'conferindo' && pc.status === 'aguardando_pagamento' && pc.cobrandoEm && pc.cobrancaIncerta, 'cartao sem resposta do Mercado Pago: "conferindo", nao marca pago e a trava fica');
  r = await cobrar(C1, 'APROVA9000000002'); j = await r.json();
  ok(j.status === 'recusado' && /confirmando/.test(j.motivo || '') && cartoes.length === cobradas, 'e um novo toque logo em seguida nao cobra (pode ter passado)');
  pc.cobrandoEm = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  r = await cobrar(C1, 'APROVA9000000003'); j = await r.json();
  ok(j.status === 'aprovado' && db.get(caminhoDe(C1)).status === 'pago' && !db.get(caminhoDe(C1)).cobrancaIncerta, 'passados 5 minutos sem nada cobrado: a nova tentativa aprova');
  const C1b = 'mpfalhacartao000001b'; novo(C1b, 'cartao_online', 68);
  cobradas = cartoes.length;
  comFalha((u, o) => u.indexOf('api.mercadopago.com/v1/orders') >= 0 && o.method === 'POST', 1);
  r = await cobrar(C1b, 'APROVA9000000011'); j = await r.json(); semFalha();
  ok(j.status === 'aprovado' && db.get(caminhoDe(C1b)).status === 'pago' && cartoes.length === cobradas + 1 && cartoes[cartoes.length - 1].chave === C1b + '-cAPROVA9000000011', 'um tropeco so: repete com a mesma chave, aprova e cobra uma vez');

  /* 11. cartao aprovado, mas o banco falhou ao marcar pago: o cliente nao ouve "recusado" e o aviso do Mercado Pago conserta */
  const C2 = 'mpfalhacartao0000002'; novo(C2, 'cartao_online', 79);
  const cobradosAntes = cartoes.length;
  comFalha((u, o) => u.indexOf(BASE + caminhoDe(C2)) === 0 && o.method === 'PATCH' && /pagamentoStatus/.test(String(o.body || '')));
  r = await cobrar(C2, 'APROVA9000000003'); j = await r.json().catch(() => ({})); semFalha();
  ok(j.status === 'aprovado', 'cartao aprovado com o banco falhando: o cliente ve "aprovado" (o dinheiro foi cobrado)');
  r = await cobrar(C2, 'APROVA9000000004'); j = await r.json();
  ok(cartoes.length === cobradosAntes + 1, 'e um novo toque logo depois nao cobra de novo');
  const ordC2 = [...ordens.values()].filter((o) => o.external_reference === 'dom-conizza__' + C2)[0];
  r = await aviso(ordC2.id, C2);
  ok(db.get(caminhoDe(C2)).status === 'pago', 'o aviso do Mercado Pago marca o pedido pago');

  /* 12. cada motivo de recusa vira uma frase de cliente */
  const frases = {
    insufficient_amount: /sem limite/, bad_filled_security_code: /código de segurança/, bad_filled_date: /validade/,
    call_for_authorize: /autorizar/, card_disabled: /bloqueado/, max_attempts: /Tentativas demais/, duplicated_payment: /repetido/,
    high_risk: /análise de segurança/, bad_filled_other: /não confere/, rejected_by_issuer: /banco recusou/,
  };
  let certas = 0, total = 0;
  for (const motivo of Object.keys(frases)) {
    total++;
    const id = ('mpfrase' + motivo.replace(/_/g, '')).slice(0, 20).padEnd(20, '0');
    novo(id, 'cartao_online', 80);
    r = await cobrar(id, 'RECUSA-' + motivo.replace(/_/g, '-')); j = await r.json();
    if (j.status === 'recusado' && frases[motivo].test(j.motivo || '') && db.get(caminhoDe(id)).status === 'aguardando_pagamento' && !db.get(caminhoDe(id)).cobrandoEm) certas++;
    else console.log('    motivo ' + motivo + ': ' + JSON.stringify(j));
  }
  ok(certas === total, 'cartao recusado: ' + certas + ' de ' + total + ' motivos com a frase certa, pedido esperando e trava solta');

  /* 13. o banco pede confirmacao (3D Secure): nao cobra, avisa e deixa tentar de novo */
  const C3 = 'mpfalhacartao0000003'; novo(C3, 'cartao_online', 81);
  r = await cobrar(C3, 'CONFIRMA90000001'); j = await r.json();
  pc = db.get(caminhoDe(C3));
  ok(j.status === 'recusado' && /confirmação/.test(j.motivo || '') && pc.status === 'aguardando_pagamento' && !pc.cobrandoEm, 'cartao que pede confirmacao do banco: nao marca pago, explica e solta a trava');

  /* 14. devolucao com o Mercado Pago fora do ar, e de novo */
  const D1 = 'mpfalhadevolve000001';
  db.set(caminhoDe(D1), pedidoDe(1, { status: 'cancelado', canceladoPor: 'loja', formaPagamento: 'pix', pagamentoStatus: 'pago', senha: 82, mp: { id: 'ORD990014' }, cliente: { nome: 'Rui' } }));
  const devAntes = devolucoes.length;
  comFalha((u, o) => /\/refund$/.test(u) && o.method === 'POST');
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: D1 }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json(); semFalha();
  ok(!j.ok && !db.get(caminhoDe(D1)).devolvidoEm, 'devolucao com o Mercado Pago fora do ar: avisa e nao marca devolvido');
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: D1 }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  ok(j.ok && db.get(caminhoDe(D1)).devolvidoEm && devolucoes.length === devAntes + 1 && devolucoes[devolucoes.length - 1].chave === 'devolver-' + D1, 'de novo: devolve uma vez, com a mesma chave (o Mercado Pago nunca devolve em dobro)');

  /* 15. cartao em analise pelo banco: "em analise", trava firme, e nada de cobrar de novo */
  const C5 = 'mpfalhacartao0000005'; novo(C5, 'cartao_online', 83);
  r = await cobrar(C5, 'ANALISE900000001'); j = await r.json();
  pc = db.get(caminhoDe(C5));
  ok(j.status === 'analise' && pc.status === 'aguardando_pagamento' && pc.cobrandoEm && pc.mp && pc.mp.id, 'cartao em analise: responde "analise" (nao "recusado") e guarda a cobranca');
  cobradas = cartoes.length;
  pc.cobrandoEm = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  r = await cobrar(C5, 'APROVA9000000005'); j = await r.json();
  ok(j.status === 'analise' && cartoes.length === cobradas, 'outro cartao com a primeira ainda em analise: confere no Mercado Pago e nao cobra de novo');
  const ordC5 = ordens.get(String(pc.mp.id));
  ordC5.status = 'processed'; ordC5.transactions.payments[0].status = 'processed';
  r = await aviso(ordC5.id, C5);
  ok(db.get(caminhoDe(C5)).status === 'pago', 'o banco aprovou depois: o aviso do Mercado Pago marca pago');

  /* 16. em analise e depois recusado: a trava solta e outro cartao passa */
  const C6 = 'mpfalhacartao0000006'; novo(C6, 'cartao_online', 84);
  r = await cobrar(C6, 'ANALISE900000002'); j = await r.json();
  const ordC6 = ordens.get(String(db.get(caminhoDe(C6)).mp.id));
  ordC6.status = 'failed'; ordC6.transactions.payments[0].status = 'failed';
  r = await aviso(ordC6.id, C6);
  ok(!db.get(caminhoDe(C6)).cobrandoEm, 'analise recusada pelo banco: o aviso solta a trava');
  r = await cobrar(C6, 'APROVA9000000006'); j = await r.json();
  ok(j.status === 'aprovado' && db.get(caminhoDe(C6)).status === 'pago', 'e outro cartao aprova na hora');

  /* 17. a cobranca anterior passou, mas o pedido nao ficou pago (o banco falhou): a nova tentativa acha e nao cobra */
  const C7 = 'mpfalhacartao0000007'; novo(C7, 'cartao_online', 85);
  orderPaga('ORD990017', C7);
  Object.assign(db.get(caminhoDe(C7)), { mp: { id: 'ORD990017', cartao: true } });
  cobradas = cartoes.length;
  r = await cobrar(C7, 'APROVA9000000007'); j = await r.json();
  ok(j.status === 'aprovado' && db.get(caminhoDe(C7)).status === 'pago' && cartoes.length === cobradas, 'cobranca anterior aprovada: marca pago sem cobrar o cartao de novo');

  /* 18. devolucao alcanca toda cobranca aprovada do pedido, e "ja devolvido" nao e erro */
  const D2 = 'mpfalhadevolve000002';
  orderPaga('ORD990181', D2); orderPaga('ORD990182', D2);
  db.set(caminhoDe(D2), pedidoDe(1, { status: 'cancelado', canceladoPor: 'loja', formaPagamento: 'cartao_online', pagamentoStatus: 'pago', senha: 86, mp: { id: 'ORD990182', cartao: true }, cobrancas: ['ORD990181', 'ORD990182'], cliente: { nome: 'Rui' } }));
  let dv0 = devolucoes.length;
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: D2 }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  const idsDevolvidos = devolucoes.slice(dv0).map((d) => d.id).sort().join(',');
  ok(j.ok && idsDevolvidos === 'ORD990181,ORD990182', 'duas cobrancas aprovadas no mesmo pedido: as duas voltam (' + idsDevolvidos + ')');
  const D3 = 'mpfalhadevolve000003';
  ordens.set('ORD990183', { id: 'ORD990183', status: 'refunded', status_detail: 'refunded', external_reference: 'dom-conizza__' + D3 });
  db.set(caminhoDe(D3), pedidoDe(1, { status: 'cancelado', canceladoPor: 'loja', formaPagamento: 'pix', pagamentoStatus: 'pago', senha: 87, mp: { id: 'ORD990183' }, cliente: { nome: 'Rui' } }));
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: D3 }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  ok(j.ok && db.get(caminhoDe(D3)).devolvidoEm, 'o Mercado Pago diz que ja devolveu (toque anterior sem resposta): marca devolvido, sem erro');

  /* 19. o numero do pedido tem maiusculas (como os de verdade): o aviso acha a loja pela referencia */
  const PM = 'PedidoComMaiusc12345'; novo(PM, 'pix', 88);
  orderPaga('ORD990019', PM);
  r = await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD990019', external_reference: 'dom-conizza__' + PM } }, headers: { Origin: '' } });
  ok(db.get(caminhoDe(PM)).status === 'pago', 'aviso de um pedido com maiusculas no numero: marca pago');

  /* 20. Pix que nasce sem o codigo (order "processing"): o worker pergunta de novo e entrega */
  const PD = 'mpfalhapix0000000020'; novo(PD, 'pix', 89);
  globalThis.__pixDemora = 1;
  r = await criarPix(PD); j = await r.json();
  ok(r.status === 200 && j.codigo && db.get(caminhoDe(PD)).pixCodigo === j.codigo, 'Pix que demora a trazer o codigo: o worker pergunta de novo e o codigo sai');
}

console.log('Token do Mercado Pago guardado na borda');
{
  kv.mapa.delete('mptoken:dom-conizza');
  w = await workerNovo();
  const PTK = 'tokenborda0000000001';
  db.set('lojas/dom-conizza/pedidos/' + PTK, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 60, cliente: { nome: 'Gil' } }));
  await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PTK } });
  ok(kv.mapa.has('mptoken:dom-conizza'), 'leu o token no banco uma vez e guardou na borda');
  w = await workerNovo();
  const PTK2 = 'tokenborda0000000002';
  db.set('lojas/dom-conizza/pedidos/' + PTK2, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 61, cliente: { nome: 'Gil' } }));
  zerar();
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PTK2 } });
  ok(r.status === 200 && conta.leituras === 1, 'outra copia do worker: token da borda, so o pedido lido no banco (' + conta.leituras + ')');
  const deletesAntes = kv.apagadas || 0;
  await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  w = await workerNovo();
  const PTK2b = 'tokenborda000000002b';
  db.set('lojas/dom-conizza/pedidos/' + PTK2b, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 63, cliente: { nome: 'Gil' } }));
  zerar();
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PTK2b } });
  ok(r.status === 200 && conta.leituras === 2 && (kv.apagadas || 0) === deletesAntes, 'o dono salvou (pode ter trocado de conta): o token volta a ser lido no banco, sem apagar chave do KV');
  const privado = db.get('lojas/dom-conizza/privado/mercadopago');
  const tokenAntes = privado.token;
  privado.token = '';
  /* o painel publica depois de guardar o token (guardarSegredo): a copia da loja muda de versao */
  await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  w = await workerNovo();
  const PTK3 = 'tokenborda0000000003';
  db.set('lojas/dom-conizza/pedidos/' + PTK3, pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', senha: 62, cliente: { nome: 'Gil' } }));
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PTK3 } });
  ok(r.status !== 200 && (kv.mapa.get('mptoken:dom-conizza') || {}).valor !== '', 'loja desconectada: nao cria Pix e nao guarda token vazio');
  privado.token = tokenAntes;
  w = await workerNovo();
}

console.log('Contato da pagina de vendas');
{
  w = await workerNovo();
  const ipL = { 'CF-Connecting-IP': '10.99.1.1' };
  const lead = (corpo, h) => chamar(w, '/lead', { metodo: 'POST', corpo, headers: h || ipL });
  zerar();
  r = await lead({ nome: 'Ana Souza', whatsapp: '(13) 99999-1234', loja: 'Lanches da Ana', cidade: 'Juquiá', uf: 'SP', origem: 'botao-flutuante', pagina: '#/' }); j = await r.json();
  const salvo = db.get('leads/' + j.id);
  ok(r.status === 200 && j.ok && salvo && salvo.whatsapp === '13999991234' && salvo.atendidoEm === '' && conta.gravacoes === 1, 'contato gravado pelo mensageiro (1 gravacao, numero so com digitos)');
  r = await lead({ nome: 'A', whatsapp: '123' });
  ok(r.status === 400, 'contato sem nome ou WhatsApp de verdade: 400');
  r = await lead({ nome: 'Ana\u202eX\nY', whatsapp: '13999991235' }); j = await r.json();
  ok(j.ok && db.get('leads/' + j.id).nome === 'Ana X Y', 'texto com quebra de linha e inversor de direcao vira espaco');
  for (let i = 3; i <= 8; i++) { r = await lead({ nome: 'Ana Souza', whatsapp: '139999912' + (40 + i) }); if (r.status !== 200) break; }
  ok(r.status === 200, 'ate 8 contatos do mesmo endereco em 10 min passam (rede de celular divide o IP)');
  r = await lead({ nome: 'Ana Souza', whatsapp: '13999991299' }); j = await r.json();
  ok(r.status === 429 && !/Recebemos/.test(j.erro) && /WhatsApp/.test(j.erro), 'o 9o espera, e a resposta nunca diz "recebemos" sem ter gravado (manda para o WhatsApp)');
  r = await lead({ nome: 'Bia Lima', whatsapp: '13999991238' }, { 'CF-Connecting-IP': '2804:14c:65a1:4001:aaaa::1' });
  ok(r.status === 200, 'outro aparelho passa normal');
}

/* aviso na hora do contato novo (e-mail para o admin, com o botao do WhatsApp): so com EMAIL_URL e EMAIL_TOKEN no mensageiro */
{
  const emailsContato = [];
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    if (String(url).indexOf('https://script.google.com/macros/s/') === 0) { emailsContato.push(JSON.parse((op || {}).body || '{}')); return resposta({ ok: true }); }
    return fetchAntes(url, op);
  };
  const ipE = { 'CF-Connecting-IP': '10.99.2.1' };
  const envEmail = Object.assign({}, env, { EMAIL_URL: 'https://script.google.com/macros/s/AKfycbxTESTE/exec', EMAIL_TOKEN: 'segredo-do-script' });
  const wE = await workerNovo();
  let rr = await chamar(wE, '/lead', { metodo: 'POST', corpo: { nome: 'Joana Silva', whatsapp: '(13) 98888-7777', loja: 'Lanches da Joana', cidade: 'Registro', uf: 'SP', origem: 'cadastro-instagram', pagina: '#/comecar [cardapio]' }, headers: ipE, env: envEmail });
  await esperarFundo();
  ok(rr.status === 200 && emailsContato.length === 1 && emailsContato[0].para === 'ligeiro.pedidos@gmail.com' && /Joana Silva/.test(emailsContato[0].assunto) && /wa\.me\/5513988887777/.test(emailsContato[0].html) && /cadastro-instagram/.test(emailsContato[0].texto), 'contato novo: e-mail ao admin na hora, com o botao do WhatsApp e de onde veio');
  ok(emailsContato[0].token === 'segredo-do-script' && !/segredo/.test(emailsContato[0].html + emailsContato[0].texto), 'o token vai so no pedido ao script, nunca no texto do e-mail');
  rr = await chamar(wE, '/lead', { metodo: 'POST', corpo: { nome: 'Sem Email', whatsapp: '13977776666' }, headers: { 'CF-Connecting-IP': '10.99.2.2' } });
  await esperarFundo();
  ok(rr.status === 200 && emailsContato.length === 1, 'mensageiro sem EMAIL_URL e EMAIL_TOKEN: o contato grava e nenhum e-mail sai');
  rr = await chamar(wE, '/lead', { metodo: 'POST', corpo: { nome: 'Html <b>Mau</b>', whatsapp: '13966665555' }, headers: { 'CF-Connecting-IP': '10.99.2.3' }, env: envEmail });
  await esperarFundo();
  ok(emailsContato.length === 2 && !/<b>Mau/.test(emailsContato[1].html) && /&lt;b&gt;/.test(emailsContato[1].html), 'nome com HTML no contato: escapado no e-mail');
  globalThis.fetch = fetchAntes;
}

console.log('Marca do dono no login');
{
  w = await workerNovo();
  const dono = db.get('lojas/dom-conizza').donoEmail;
  const marcaDe = (email) => { try { return JSON.parse(marcas[email] || '{}'); } catch (_) { return {}; } };
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' } });
  ok(r.status === 401, '/dono sem login: 401');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura' } });
  ok(r.status === 403 && !marcaDe('outro@x.com').lojas, 'quem nao e dono nao ganha a marca');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura' } });
  ok(r.status === 403, 'login da equipe nao vira dono');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  ok(dono === 'dono@x.com' && r.status === 200 && j.marca === true && JSON.stringify(marcaDe('dono@x.com').lojas.slice().sort()) === '["dom-conizza","poucas"]', 'dono de verdade: marca "lojas" gravada no login (todas as lojas dele hoje)');
  const ate = marcaDe('dono@x.com').lojasAte;
  ok(ate > Date.now() / 1000 + 2.9 * 86400 && ate < Date.now() / 1000 + 3.1 * 86400, 'a marca vale 3 dias');
  const leiturasAntes = conta.leituras;
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  ok(j.ok === true && j.marca === false && conta.leituras === leiturasAntes, 'ja tem a marca: nao le o banco nem grava de novo');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { email: 'outro@x.com' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok(r.status === 400, 'so o admin refaz a marca de outro e-mail');
  /* troca de dono feita na mao: o admin refaz a marca do antigo pelas lojas de hoje (nenhuma) */
  marcas['outro@x.com'] = JSON.stringify({ lojas: ['dom-conizza'], outra: 1 });
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { email: 'outro@x.com' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } }); j = await r.json();
  ok(j.ok === true && !marcaDe('outro@x.com').lojas && marcaDe('outro@x.com').outra === 1, 'admin tira a marca de quem nao e mais dono (e guarda o resto da marca)');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { email: 'dono@x.com' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura' } }); j = await r.json();
  ok(JSON.stringify((marcaDe('dono@x.com').lojas || []).sort()) === '["dom-conizza","poucas"]' && JSON.stringify(j.lojas.sort()) === '["dom-conizza","poucas"]', 'e refaz a de quem e dono de verdade (todas as lojas dele)');
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: '../contas/x' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok(r.status === 400, '/dono com loja inventada: 400');
  /* marca perto de vencer: o painel pede de novo e ela renova conferindo no banco */
  marcas['dono@x.com'] = JSON.stringify({ lojas: ['dom-conizza', 'poucas'], lojasAte: Math.floor(Date.now() / 1000) + 3600 });
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } }); j = await r.json();
  ok(j.marca === true && marcaDe('dono@x.com').lojasAte > Date.now() / 1000 + 2 * 86400, 'marca perto de vencer: renova por mais 3 dias');
  /* dono trocado na mao e ninguem refez a marca: na renovacao ela perde a loja sozinha */
  marcas['outro@x.com'] = JSON.stringify({ lojas: ['dom-conizza'], lojasAte: Math.floor(Date.now() / 1000) + 3600 });
  r = await chamar(w, '/dono', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura' } });
  ok(r.status === 403 && !marcaDe('outro@x.com').lojas, 'dono antigo pedindo a marca de novo: 403 e a loja sai da marca dele');
}

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
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura') });
ok(r.status === 403, 'ligar avisos de loja que nao e sua: recusado');
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: { endpoint: 'https://site-do-mal.com/x', keys: doPainel.inscricao.keys } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
ok(r.status === 400, 'endereco que nao e servico de aviso: recusado (o worker nunca manda nada para site qualquer)');
zerar(); avisos.length = 0;
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao, testar: true }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') }); j = await r.json();
ok(r.status === 200 && j.ok && j.teste === 201, 'dono liga os avisos do painel e o teste chega');
ok(conta.leituras === 0 && conta.gravacoes === 0 && kv.gravacoes === 1, 'ligar aparelho: 0 leituras e 0 gravacoes no banco (1 gravacao no KV)');
ok(avisos.length === 1 && abrirAviso(avisos[0], doPainel).titulo === 'Avisos ligados', 'o celular consegue abrir o aviso de teste');
ok(await assinaturaOk(avisos[0], VAPID), 'aviso assinado com a chave do Ligeiro (o Google aceita)');
zerar();
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
ok(r.status === 200 && kv.gravacoes === 0, 'abrir o painel de novo no mesmo aparelho: nao grava nada');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'cozinha', inscricao: daCozinha.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') });
r = await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', inscricao: doEntregador.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') });
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
ok(conta.leituras === 1 && conta.gravacoes === 0, 'pedido novo avisado: 1 leitura (confere o pedido) e 0 gravacoes no banco');
zerar(); avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, resumo: RESUMO_NOVO } });
ok(avisos.length === 0, 'o mesmo pedido avisado de novo: a loja apita uma vez so');
zerar();
db.set('lojas/poucas/pedidos/' + NOVO, { status: 'pago', total: 100, senha: 1, cliente: { nome: 'Caio' } });
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'poucas', pedido: NOVO, resumo: RESUMO_NOVO } }); j = await r.json();
ok(j.enviados === 0 && conta.leituras === 0, 'loja sem aviso ligado: nada a fazer, nenhuma leitura');
zerar(); avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'pixpixpixpix01234567', resumo: { senha: 999999, total: 10000000 } } });
ok(r.status === 404 && avisos.length === 0, 'pedido que nao existe, com senha e valor inventados: a loja nao apita');
db.set('lojas/dom-conizza/pedidos/mentiramentira012345', { status: 'pago', total: 1200, senha: 26, tipoEntrega: 'retirada', cliente: { nome: 'Lia' } });
avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'mentiramentira012345', resumo: { senha: 999999, total: 10000000, tipoEntrega: 'entrega' } } });
ok(avisos.length === 2 && abrirAviso(avisos.filter((a) => a.url === doPainel.inscricao.endpoint)[0], doPainel).titulo === 'Pedido novo! Senha 26', 'o aviso usa a senha e o valor gravados, nunca os que vieram junto');
db.set('lojas/dom-conizza/pedidos/naopagonaopago012345', { status: 'aguardando_pagamento', total: 1200, senha: 27, cliente: { nome: 'Rui' } });
avisos.length = 0;
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'naopagonaopago012345', resumo: RESUMO_NOVO } });
ok(avisos.length === 0, 'pedido que ainda nao foi pago: nao apita');
r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'inventado', resumo: RESUMO_NOVO } });
ok(r.status === 400, 'pedido com id inventado: recusado');
let devagar = false;
for (let i = 0; i < 22; i++) { r = await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'poucas', pedido: 'rajada' + String(i).padStart(14, '0'), resumo: RESUMO_NOVO } }); if ((await r.json()).devagar) devagar = true; }
ok(devagar, 'rajada de pedidos inventados: no maximo 20 apitos por minuto por loja');

zerar();
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, cidade: 'juquia', inscricao: doCliente.inscricao } });
const comAviso = db.get('lojas/dom-conizza/pedidos/' + NOVO);
ok(r.status === 200 && comAviso.aviso && comAviso.aviso.u === '#/juquia/dom-conizza/pedido/', 'cliente liga o aviso: fica guardado no proprio pedido');
ok(conta.leituras === 1 && conta.gravacoes === 1, 'cliente ligar o aviso: 1 leitura e 1 gravacao no banco');
const ladrao = aparelho('https://fcm.googleapis.com/fcm/send/ladrao-do-aviso');
w = await workerNovo();
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, cidade: 'juquia', inscricao: ladrao.inscricao } });
ok(r.status === 409 && db.get('lojas/dom-conizza/pedidos/' + NOVO).aviso.e === doCliente.inscricao.endpoint, 'outro celular com o link do pedido nao desvia os avisos do cliente');
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, remover: true } });
ok(r.status === 409 && db.get('lojas/dom-conizza/pedidos/' + NOVO).aviso, 'nem desliga os avisos do cliente');
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, cidade: 'juquia', inscricao: doCliente.inscricao } });
ok(r.status === 200, 'o proprio celular do cliente liga de novo sem problema');
zerar();
r = await chamar(w, '/inscrever', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'naoexistenaoexiste12', cidade: 'juquia', inscricao: doCliente.inscricao } });
ok(r.status === 404 && !db.has('lojas/dom-conizza/pedidos/naoexistenaoexiste12'), 'pedido que nao existe: recusado, sem criar pedido fantasma');

zerar(); avisos.length = 0;
const resumo = { senha: 21, total: 3500, tipoEntrega: 'entrega', nome: 'Bia', bairro: 'Centro' };
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') }); j = await r.json();
ok(j.cliente === 201 && j.equipe === 1, 'saiu para entrega: avisa o cliente e o entregador');
const vCliente = abrirAviso(avisos.filter((a) => a.url === doCliente.inscricao.endpoint)[0], doCliente);
ok(vCliente.titulo === 'Dom Conizza' && vCliente.texto === 'Seu pedido saiu para entrega! Já está a caminho. Senha 21.' && vCliente.url === '#/juquia/dom-conizza/pedido/' + NOVO, 'o cliente le o nome da loja, o que aconteceu e abre o pedido dele');
ok(avisos.filter((a) => a.url === doCliente.inscricao.endpoint)[0].headers.Topic === 'p' + NOVO, 'celular desligado recebe so o ultimo aviso do pedido');
const vEntrega = abrirAviso(avisos.filter((a) => a.url === doEntregador.inscricao.endpoint)[0], doEntregador);
ok(vEntrega.titulo === 'Entrega pronta! Senha 21' && vEntrega.texto.indexOf('Centro') === 0 && vEntrega.url === '#/entrega/dom-conizza', 'o entregador sabe a senha e o bairro');
ok(conta.leituras === 0 && conta.gravacoes === 0, 'pedido andou e avisou: 0 leituras e 0 gravacoes no banco');
/* loja de comercio: o resumo leva o segmento e os avisos dizem "Pedido nº" e "separando" */
zerar(); avisos.length = 0;
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'producao', resumo: Object.assign({}, resumo, { segmento: 'comercio' }), aviso: comAviso.aviso }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') }); j = await r.json();
const vComercio = abrirAviso(avisos.filter((a) => a.url === doCliente.inscricao.endpoint)[0], doCliente);
ok(vComercio.texto === 'A loja está separando o seu pedido. Logo sai para entrega. Pedido nº 21.', 'comercio: o cliente le "separando" e "Pedido nº", sem cozinha');
zerar(); avisos.length = 0;
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo: Object.assign({}, resumo, { segmento: 'comercio' }), aviso: null }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') });
ok(abrirAviso(avisos.filter((a) => a.url === doEntregador.inscricao.endpoint)[0], doEntregador).titulo === 'Entrega pronta! Pedido nº 21', 'comercio: o entregador le "Pedido nº 21"');
zerar(); avisos.length = 0;
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo: Object.assign({}, resumo, { segmento: '<b>x</b>' }), aviso: null }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura') });
ok(abrirAviso(avisos.filter((a) => a.url === doEntregador.inscricao.endpoint)[0], doEntregador).titulo === 'Entrega pronta! Senha 21', 'segmento torto no resumo: vale o texto de sempre');
zerar(); avisos.length = 0;
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso } });
ok(r.status === 401, 'avisar o cliente sem login: recusado');
r = await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pronto', resumo, aviso: comAviso.aviso }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura') });
ok(r.status === 403, 'outra loja nao manda aviso para o cliente desta');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'finalizado', resumo, aviso: comAviso.aviso }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
ok(avisos.length === 0, 'entregue: nao incomoda o cliente com mais um aviso');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: NOVO, status: 'pago', resumo: { senha: 23, total: 1000, tipoEntrega: 'retirada', nome: 'Edu' } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
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
ok(conta.leituras <= 2 && conta.gravacoes === 1, 'o aviso do Pix nao gasta nada a mais no banco (so o pedido e, no maximo, o token da loja; 1 gravacao, igual sem aviso)');
avisos.length = 0;
await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD777', external_reference: 'dom-conizza__' + PIXA } }, headers: { Origin: '' } });
ok(avisos.length === 0, 'o Mercado Pago avisando duas vezes: a loja apita uma vez so');

/* o mesmo celular como painel e entregador (loja pequena: o dono entrega) */
const doDono = aparelho('https://fcm.googleapis.com/fcm/send/dono-entrega');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doDono.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', inscricao: doDono.inscricao }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
const entradaDono = JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).filter((a) => a.e === doDono.inscricao.endpoint);
ok(entradaDono.length === 1 && entradaDono[0].p.join(',') === 'painel,entregas', 'o mesmo celular fica com os dois papeis (painel e entregas), numa entrada so');
avisos.length = 0;
db.set('lojas/dom-conizza/pedidos/donoentregadono01234', { status: 'pago', total: 2000, senha: 30, tipoEntrega: 'entrega', cliente: { nome: 'Nina' } });
await chamar(w, '/novo', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'donoentregadono01234', resumo: { senha: 30, total: 2000, tipoEntrega: 'entrega' } } });
const doDonoNovo = avisos.filter((a) => a.url === doDono.inscricao.endpoint);
ok(doDonoNovo.length === 1 && abrirAviso(doDonoNovo[0], doDono).url === '#/painel/dom-conizza', 'pedido novo chega nele como painel');
avisos.length = 0;
await chamar(w, '/avisar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: 'donoentregadono01234', status: 'pronto', resumo: { senha: 30, total: 2000, tipoEntrega: 'entrega', bairro: 'Centro' } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
const doDonoEntrega = avisos.filter((a) => a.url === doDono.inscricao.endpoint);
ok(doDonoEntrega.length === 1 && abrirAviso(doDonoEntrega[0], doDono).titulo === 'Entrega pronta! Senha 30', 'e a entrega pronta chega nele como entregador');
await chamar(w, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'entregas', remover: doDono.inscricao.endpoint }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
const depoisDeTirar = JSON.parse(kv.mapa.get('aparelhos:dom-conizza').valor).filter((a) => a.e === doDono.inscricao.endpoint);
ok(depoisDeTirar.length === 1 && depoisDeTirar[0].p.join(',') === 'painel', 'desligar no entregador tira so esse papel (o painel continua avisando)');

/* KV com falha de leitura: nao troca a chave dos avisos nem apaga a lista de aparelhos */
const listaAntes = kv.mapa.get('aparelhos:dom-conizza').valor;
const getOriginal = kv.get;
kv.get = async () => { throw new Error('KV fora do ar'); };
const wFalha = await workerNovo();
r = await chamar(wFalha, '/aparelho', { metodo: 'POST', corpo: { loja: 'dom-conizza', papel: 'painel', inscricao: doPainel.inscricao, testar: true }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura') });
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

console.log('Loja nova (so pelo mensageiro)');
{
  w = await workerNovo();
  const hoje = new Date().toISOString();
  db.set('contas/novo@x.com', { email: 'novo@x.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: hoje } });
  const lojaNova = (extra) => Object.assign({ nome: 'Pastel da Vila', cidade: 'Juquiá', tipo: 'Lanchonete', categorias: [{ id: 'c1', nome: 'Pastéis' }], produtos: [], horarios: { seg: ['18:00-23:00'] } }, extra || {});
  const criarLoja = (tok, loja, vit) => chamar(w, '/loja-nova', { metodo: 'POST', corpo: { loja: loja || lojaNova(), vitrine: vit || { nome: 'Pastel da Vila', horarios: {} } }, headers: bearer(tok) });
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura', lojaNova({ verificada: true, email: 'ligeiro.pedidos@gmail.com', ativa: true, plano: { status: 'ativo', pagoAte: '2099-01-01T00:00:00.000Z', planoPago: 'oito' }, donoEmail: 'outro@x.com', amostra: true }), { nome: 'x', verificada: true, email: 'y', donoEmail: 'z', amostra: true }); j = await r.json();
  const nasceu = db.get('lojas/pastel-da-vila'), vitNova = db.get('vitrine/pastel-da-vila');
  ok(r.status === 200 && j.slug === 'pastel-da-vila' && nasceu && vitNova, 'conta nova cria a primeira loja pelo mensageiro (loja e vitrine juntas)');
  ok(nasceu.donoEmail === 'novo@x.com' && nasceu.verificada !== true && !('email' in nasceu) && nasceu.plano.status === 'teste' && nasceu.plano.planoPago === '' && nasceu.plano.pagoAte === '', 'o que o dono nao decide (dono, selo, plano pago, e-mail do Ligeiro) sai do documento');
  ok(!('amostra' in nasceu) && !('amostra' in vitNova), 'conta comum nao marca a propria loja como amostra (amostra tira a loja da conta das vagas: so a conta do Ligeiro decide)');
  ok(JSON.stringify(vitNova.plano) === JSON.stringify(nasceu.plano) && !('email' in vitNova) && !('donoEmail' in vitNova) && vitNova.verificada !== true, 'a vitrine nasce com o mesmo plano da loja e sem e-mail');
  /* conta criada ha 20 dias que nunca teve loja (caiu na lista de espera ou desistiu no meio): o teste recomeca agora */
  {
    /* num worker novo: nao gasta o limite de lojas por hora do endereco dos testes de baixo */
    const wv = await workerNovo();
    const criarV = (tok, nome) => chamar(wv, '/loja-nova', { metodo: 'POST', corpo: { loja: lojaNova({ nome: nome }), vitrine: { nome: nome, horarios: {} } }, headers: bearer(tok) });
    const vinte = new Date(Date.now() - 20 * 864e5).toISOString();
    db.set('contas/velho@x.com', { email: 'velho@x.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: vinte } });
    r = await criarV('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJ2ZWxobyJ9.assinatura', 'Pastel do Velho'); j = await r.json();
    const cv = db.get('contas/velho@x.com'), lv = db.get('lojas/pastel-do-velho');
    ok(r.status === 200 && Date.now() - Date.parse(cv.plano.desde) < 60e3 && cv.plano.status === 'teste' && cv.plano.planoId === 'uma' && cv.lojaCriadaEm, 'conta sem loja ha 20 dias: a loja nasce e os 7 dias gratis comecam agora (antes vinha vencida)');
    ok(lv && lv.plano.desde === cv.plano.desde, 'a loja leva o teste novo no plano');
    /* quem ja pagou alguma vez nao ganha teste de novo */
    db.set('contas/pagou@x.com', { email: 'pagou@x.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: vinte, ultimoPagamentoEm: vinte } });
    r = await criarV('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJwYWdvdSJ9.assinatura', 'Pastel Pago');
    ok(db.get('contas/pagou@x.com').plano.desde === vinte, 'conta que ja pagou: o teste nao recomeca');
  }
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura');
  ok(r.status === 409 && /já tem a sua loja/.test((await r.json()).erro), '1 loja por conta: a segunda e recusada, com o caminho (outra conta)');
  db.set('contas/novo@x.com', { email: 'novo@x.com', plano: { planoId: 'duas', planoPago: 'duas', pagoAte: '2099-01-01T00:00:00.000Z', tipo: 'mensal', status: 'ativo', desde: hoje } });
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura');
  ok(r.status === 409, 'conta com plano antigo de 2 lojas: tambem 1 loja por conta');
  /* o endereco seguinte: as lojas de mesmo nome sao de outros donos, e a -3 foi apagada mas deixou o token do Mercado Pago */
  db.set('lojas/pastel-da-vila', Object.assign(db.get('lojas/pastel-da-vila'), { donoEmail: 'outro@x.com' }));
  db.set('lojas/pastel-da-vila-2', { slug: 'pastel-da-vila-2', nome: 'Pastel da Vila', donoEmail: 'outro2@x.com' });
  db.set('lojas/pastel-da-vila-3/privado/mercadopago', { token: 'token-da-loja-apagada' });
  /* nome repetido na mesma cidade: recusado (o cliente confundiria; uma loja falsa se passaria pela verdadeira). Num
     worker novo: estas tentativas nao gastam o limite de lojas por hora do endereco dos testes de baixo */
  {
    const wn = await workerNovo();
    const criarNome = (loja) => chamar(wn, '/loja-nova', { metodo: 'POST', corpo: { loja: loja, vitrine: { nome: loja.nome, horarios: {} } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura') });
    r = await criarNome(lojaNova()); j = await r.json();
    ok(r.status === 409 && j.nomeRepetido === true && /Já existe a loja "Pastel da Vila" em Juquiá/.test(j.erro), 'mesmo nome na mesma cidade: recusado, com o caminho (outro nome, com o bairro)');
    r = await criarNome(lojaNova({ nome: 'pastel da VILA!' })); j = await r.json();
    ok(r.status === 409 && j.nomeRepetido === true, 'mesmo nome com outra grafia (maiuscula, pontuacao): recusado');
    r = await criarNome(lojaNova({ nome: 'Pastel da Villa' })); j = await r.json();
    ok(r.status === 409 && j.nomeRepetido === true, 'nome comprido com uma letra de diferenca (loja falsa): recusado');
    r = await criarNome(lojaNova({ nome: 'Pastel do Vilela' })); j = await r.json();
    ok(r.status === 200 && j.slug === 'pastel-do-vilela', 'nome parecido mas diferente de verdade (Pastel do Vilela): cria normal');
    /* desfaz, para a conta seguir sem loja nos testes de baixo */
    [...db.keys()].filter((k) => /^(lojas|vitrine)\/pastel-do-vilela/.test(k)).forEach((k) => db.delete(k));
  }
  /* o endereco e do Brasil todo: mesmo nome em outra cidade passa e ganha o proximo endereco livre */
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura', lojaNova({ cidade: 'Registro' })); j = await r.json();
  ok(r.status === 200 && j.slug === 'pastel-da-vila-4' && !db.has('lojas/pastel-da-vila-3'), 'mesmo nome em outra cidade passa; endereco com sobra de loja apagada (token do Mercado Pago) pulado, ninguem herda');
  db.set('publico/fundadores', { capacidade: { fechado: true } });
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura');
  ok(r.status === 409 && (await r.json()).vagas === false, 'vagas fechadas: ninguem cria loja');
  db.set('publico/fundadores', { capacidade: { max: 3 } });
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura');
  ok(r.status === 409, 'teto de lojas do Ligeiro batido (conta pelas lojas no ar da vitrine): recusado');
  db.delete('publico/fundadores');
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura');
  ok(r.status === 403, 'login da equipe nao cria loja');
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJzZW1jb250YSJ9.assinatura');
  ok(r.status === 409, 'sem conta: pede para criar a conta antes');
  r = await chamar(w, '/loja-nova', { metodo: 'POST', corpo: { loja: lojaNova(), vitrine: {} } });
  ok(r.status === 401, 'sem login: recusado');
  db.set('lojas/pastel-da-vila-4', Object.assign(db.get('lojas/pastel-da-vila-4'), { donoEmail: 'outro3@x.com' }));
  r = await criarLoja('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJub3ZvIn0.assinatura', lojaNova({ categorias: Array.from({ length: 21 }, (_, i) => ({ id: 'c' + i, nome: 'C' + i })) }));
  ok(r.status === 400, 'cardapio acima do limite (21 categorias): recusado');
  /* corrida: a mesma conta pede 6 lojas ao mesmo tempo, em workers diferentes (a contagem em memoria nao ajuda):
     todas contam zero lojas, mas so a primeira grava; as outras veem a trava da conta e ouvem "ja tem a sua loja" */
  db.set('contas/corrida@x.com', { email: 'corrida@x.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: hoje } });
  const workers = await Promise.all([1, 2, 3].map(() => workerNovo()));
  const pedidos = Array.from({ length: 6 }, (_, i) => chamar(workers[i % 3], '/loja-nova', { metodo: 'POST', corpo: { loja: lojaNova({ nome: 'Corrida ' + i }), vitrine: { nome: 'Corrida ' + i, horarios: {} } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJjb3JyaWRhIn0.assinatura') }));
  globalThis.__consultaLenta = true;
  const respostas = await Promise.all(pedidos);
  globalThis.__consultaLenta = false;
  const criadas = [...db.entries()].filter(([k, d]) => /^lojas\/[^/]+$/.test(k) && d.donoEmail === 'corrida@x.com').length;
  ok(criadas === 1 && respostas.filter((x) => x.status === 200).length === 1 && respostas.filter((x) => x.status === 409).length === 5, '6 pedidos de loja nova ao mesmo tempo da mesma conta: 1 loja criada, 5 recusados (' + criadas + ' criadas)');
  ok(typeof db.get('contas/corrida@x.com').lojaCriadaEm === 'string' && db.get('contas/corrida@x.com').plano.status === 'teste', 'a marca na conta so mexe no lojaCriadaEm (o plano fica como estava)');
  /* um pagamento grava na conta bem na hora de criar a loja: a loja nasce no mesmo endereco, com o plano de agora */
  db.set('contas/corrida@x.com', { email: 'corrida@x.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: hoje } });
  [...db.keys()].filter((k) => /^(lojas|vitrine)\/corrida/.test(k)).forEach((k) => db.delete(k));
  const pagoDepois = new Date(Date.now() + 30 * 864e5).toISOString();
  globalThis.__antesDoLote = () => { const x = db.get('contas/corrida@x.com'); x.plano = Object.assign({}, x.plano, { status: 'ativo', pagoAte: pagoDepois }); versoes.set('contas/corrida@x.com', (versoes.get('contas/corrida@x.com') || 0) + 1); };
  r = await chamar(w, '/loja-nova', { metodo: 'POST', corpo: { loja: lojaNova({ nome: 'Pastel Livre' }), vitrine: { nome: 'Pastel Livre', horarios: {} } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJjb3JyaWRhIn0.assinatura') }); j = await r.json();
  ok(r.status === 200 && j.slug === 'pastel-livre' && db.get('lojas/pastel-livre').plano.status === 'ativo' && db.get('lojas/pastel-livre').plano.pagoAte === pagoDepois && db.get('vitrine/pastel-livre').plano.status === 'ativo', 'pagamento no meio da criacao: a loja nasce no endereco dela (nao no -2) e com o plano pago');

  /* loja da propria conta do Ligeiro: cortesia de verdade (a copia publica nao leva o e-mail do dono) */
  db.set('contas/ligeiro.pedidos@gmail.com', { email: 'ligeiro.pedidos@gmail.com', plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: '2026-01-01T00:00:00.000Z' } });
  r = await chamar(await workerNovo(), '/loja-nova', { metodo: 'POST', corpo: { loja: lojaNova({ nome: 'Loja do Ligeiro Teste' }), vitrine: { nome: 'Loja do Ligeiro Teste', horarios: {} } }, headers: bearer('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJhZG1pbiJ9.assinatura') }); j = await r.json();
  const lojaAdm = db.get('lojas/' + j.slug) || {};
  const { createRequire } = await import('node:module');
  const regrasDoSite = createRequire(import.meta.url)('../js/regras.js');
  const copiaAdm = kv.mapa.get('loja:' + j.slug) ? JSON.parse(kv.mapa.get('loja:' + j.slug).valor).loja : {};
  const daquiUmMes = new Date(Date.now() + 30 * 864e5);
  ok(r.status === 200 && lojaAdm.plano && lojaAdm.plano.status === 'ativo' && lojaAdm.plano.pagoAte === '' && db.get('vitrine/' + j.slug).plano.status === 'ativo', 'loja criada pela conta do Ligeiro: nasce com cortesia de verdade (ativo, sem pagoAte), na loja e na vitrine');
  ok(!('donoEmail' in copiaAdm) && regrasDoSite.assinatura(copiaAdm, daquiUmMes).estado === 'ativa' && regrasDoSite.assinatura(db.get('vitrine/' + j.slug), daquiUmMes).estado === 'ativa', 'e o cliente (copia sem o e-mail do dono) ve a loja ativa depois dos dias gratis');
}

console.log('Pente fino de set/2026: pedido, limites, publicar e dinheiro');
{
  const lojaD = db.get('lojas/dom-conizza');
  Object.assign(lojaD, { aberta: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true, aceitaEntrega: true, aceitaDinheiroEntrega: true, aceitaCartaoEntrega: true, aceitaCartaoOnline: true, cupons: [] });
  kv.mapa.delete('loja:dom-conizza'); kv.mapa.delete('cupons:dom-conizza');
  const caminhoDe = (id) => 'lojas/dom-conizza/pedidos/' + id;
  const dadosD = (extra) => Object.assign({ nome: 'Ana Souza', telefone: '13999990000', tipoEntrega: 'entrega', endereco: { rua: 'Rua A', numero: '1', bairro: 'Centro' }, itens: [{ produtoId: 'p1', quantidade: 1 }], formaPagamento: 'dinheiro_entrega' }, extra);
  let nIp = 0;
  const ipNovo = () => { nIp += 1; return '10.60.' + Math.floor(nIp / 250) + '.' + (nIp % 250); };
  const pedirD = (wx, d, h) => chamar(wx, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: d }, headers: Object.assign({ 'CF-Connecting-IP': ipNovo() }, h || {}) });
  const senhaAgora = () => (db.get('lojas/dom-conizza/contadores/senha') || {}).ultima || 0;
  const contarPedidos = () => [...db.keys()].filter((k) => k.indexOf('lojas/dom-conizza/pedidos/') === 0).length;
  const valorP1 = () => (precoP1() / 100).toFixed(2);
  const expiraLonge = encodeURIComponent(new Date(Date.now() + 3600e3).toISOString());

  /* 1. chave do pedido: a resposta que se perdeu nao vira dois pedidos na cozinha */
  w = await workerNovo();
  const CH1 = 'ChaveDoPedido0000001';
  let senha0 = senhaAgora(), antesP = contarPedidos();
  r = await pedirD(w, dadosD({ chave: CH1 })); const jc1 = await r.json();
  const rc2 = await pedirD(w, dadosD({ chave: CH1 })); const jc2 = await rc2.json();
  ok(r.status === 200 && rc2.status === 200 && jc1.pedido.id === CH1 && jc2.pedido.id === CH1 && jc1.pedido.status === 'pago' && contarPedidos() === antesP + 1 && senhaAgora() === senha0 + 1, 'dinheiro na entrega enviado duas vezes com a mesma chave: 1 pedido so na cozinha e 1 senha gasta');
  /* campo sem valor (undefined) nasce como null no banco: na comparacao, null e "sem o campo" */
  const semNulo = (x) => JSON.stringify(x, (k, v) => (v === null ? undefined : v));
  ok(semNulo(jc1) === semNulo(jc2), 'a segunda resposta e igual a primeira (mesmo numero, mesma senha, mesmo pedido)');
  const CH2 = 'ChaveDoPedido0000002';
  senha0 = senhaAgora(); antesP = contarPedidos();
  const fetchDaChave = globalThis.fetch;
  let presos = [];
  const soltar = () => { if (presos) { const p = presos; presos = null; p.forEach((f) => f()); } };
  globalThis.fetch = async (u, o) => {
    if (presos && String(u) === BASE.slice(0, -1) + ':commit' && String((o && o.body) || '').indexOf('/pedidos/' + CH2) >= 0) {
      await new Promise((solta) => { presos.push(solta); if (presos.length === 2) soltar(); else setTimeout(soltar, 3000); });
    }
    return fetchDaChave(u, o);
  };
  const [wA, wB] = [await workerNovo(), await workerNovo()];
  const [rA, rB] = await Promise.all([pedirD(wA, dadosD({ chave: CH2 })), pedirD(wB, dadosD({ chave: CH2 }))]);
  globalThis.fetch = fetchDaChave;
  const [jA, jB] = [await rA.json(), await rB.json()];
  ok(rA.status === 200 && rB.status === 200 && jA.pedido.id === CH2 && jB.pedido.id === CH2 && jA.pedido.senha === jB.pedido.senha && contarPedidos() === antesP + 1 && senhaAgora() === senha0 + 1, 'dois envios juntos com a mesma chave (dois workers): 1 pedido, a mesma senha, nenhuma senha a mais');
  antesP = contarPedidos();
  const rn1 = await pedirD(w, dadosD({ telefone: '13988880001' })); const jn1 = await rn1.json();
  const rn2 = await pedirD(w, dadosD({ telefone: '13988880001' })); const jn2 = await rn2.json();
  ok(rn1.status === 200 && rn2.status === 200 && jn1.pedido.id !== jn2.pedido.id && contarPedidos() === antesP + 2, 'sem chave (site antigo): cada envio e um pedido, como antes');
  r = await pedirD(w, dadosD({ chave: CH1, telefone: '13977770002' })); j = await r.json();
  ok(r.status === 200 && j.pedido.id !== CH1 && /^[A-Za-z0-9]{20}$/.test(j.pedido.id) && ((db.get(caminhoDe(CH1)) || {}).cliente || {}).telefone === '13999990000','chave de um pedido de outro telefone: nasce outro pedido com numero sorteado (o de la nao aparece nem muda)');
  r = await pedirD(w, dadosD({ chave: 'curta', telefone: '13977770003' })); j = await r.json();
  ok(r.status === 200 && j.pedido.id !== 'curta' && /^[A-Za-z0-9]{20}$/.test(j.pedido.id), 'chave fora do formato (20 letras e numeros): ignorada');

  /* 2. no IPv6 o limite vale para a casa (/64), nao para o endereco que o celular troca a toda hora */
  w = await workerNovo();
  const v6 = (bloco, i) => '2804:14c:65a1:' + bloco + ':' + (i + 1).toString(16) + '::1';
  let aceitos = 0, barrado = false;
  for (let i = 0; i < 16; i++) { r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: dadosD({ telefone: '1395555' + String(1000 + i) }) }, headers: { 'CF-Connecting-IP': v6('4001', i) } }); if (r.status === 200) aceitos++; if (r.status === 429) barrado = true; }
  ok(aceitos === 15 && barrado, '/pedido pelo IPv6 trocando o fim do endereco: a casa (/64) para em 15');
  const cartoesAntes = cartoes.length;
  const pcs = [0, 1, 2].map((i) => { const id = 'ipv6cartao0000000' + String(i).padStart(3, '0'); db.set(caminhoDe(id), pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'cartao_online', senha: 90 + i, cliente: { nome: 'Rui' } })); return id; });
  barrado = false;
  for (let i = 0; i < 9; i++) { r = await chamar(w, '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: pcs[i % 3], token: 'RECUSA000000000' + i, metodo: 'visa' }, headers: { 'CF-Connecting-IP': v6('4002', i) } }); j = await r.json(); if (/Tentativas demais/.test(j.motivo || '')) barrado = true; }
  ok(cartoes.length - cartoesAntes === 8 && barrado, '/cartao pelo IPv6 trocando o fim: 8 tentativas por casa (/64), a 9a nem chega ao Mercado Pago');
  barrado = false;
  for (let i = 0; i < 61; i++) { r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PED, { headers: { 'CF-Connecting-IP': v6('4003', i) } }); if (r.status === 429) barrado = true; }
  ok(barrado, '/status pelo IPv6 trocando o fim: 60 por minuto por casa (/64)');
  zerar();
  for (let i = 0; i < 40; i++) await chamar(w, '/loja/inventada-v6-' + i, { headers: { 'CF-Connecting-IP': v6('4004', i) } });
  ok(conta.leituras === 30, 'GET /loja de loja inventada pelo IPv6 trocando o fim: para de ler o banco em 30 por casa (/64)');
  barrado = false;
  for (let i = 0; i < 121 && !barrado; i++) { r = await chamar(w, '/webhook?loja=dom-conizza', { metodo: 'POST', corpo: { data: { id: 'ORDV6' + i } }, headers: { Origin: '', 'CF-Connecting-IP': v6('4005', i) } }); if (r.status === 429) barrado = true; }
  ok(barrado, 'aviso sem assinatura pelo IPv6 trocando o fim: 120 por minuto por casa (/64)');

  /* 3. balcao: o tablet da loja (e o wifi dela) nao cai no limite de um aparelho qualquer */
  w = await workerNovo();
  const ipLoja = '177.10.20.30';
  let balcaoOk = 0;
  for (let i = 0; i < 20; i++) {
    r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: { nome: '', telefone: '', tipoEntrega: 'retirada', formaPagamento: 'cartao_entrega', itens: [{ produtoId: 'p1', quantidade: 1 }], origem: 'balcao' } }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJlcXVpcGUifQ.assinatura', 'CF-Connecting-IP': ipLoja } });
    if (r.status === 200) balcaoOk++;
  }
  r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: dadosD({ telefone: '13966660003' }) }, headers: { 'CF-Connecting-IP': ipLoja } });
  ok(balcaoOk === 20 && r.status === 200, 'balcao com a senha da equipe: 20 pedidos seguidos passam, e o cliente no wifi da loja continua pedindo');
  const lookupsAntes = conta.lookup;
  let recusas = 0;
  for (let i = 0; i < 20; i++) { r = await chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: { origem: 'balcao', tipoEntrega: 'retirada', itens: [{ produtoId: 'p1', quantidade: 1 }] } }, headers: { Authorization: 'Bearer ' + jwtDoProjeto('lixo-' + i, 'proj'), 'CF-Connecting-IP': '177.10.20.99' } }); if (r.status === 401) recusas++; }
  ok(recusas === 20 && conta.lookup - lookupsAntes === 15, 'login de balcao inventado: 401, e depois de 15 do mesmo endereco nem confere mais o login');

  /* 4. publicar: token inventado nao trava o dono, e o dono que salva depressa sempre chega na borda */
  w = await workerNovo();
  await chamar(w, '/loja/dom-conizza');
  for (let i = 0; i < 8; i++) await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer lixo-' + i } });
  lojaD.aberta = false;
  r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  await esperarFundo();
  let jl = await (await chamar(await workerNovo(), '/loja/dom-conizza')).json();
  ok(r.status === 200 && jl.loja.aberta === false, '8 chamadas com token inventado: o dono publica na hora e a loja fechada ja aparece para o cliente');
  lojaD.aberta = true;
  w = await workerNovo();
  const envRapido = Object.assign({}, env, { PUBLICAR_ESPERA_MS: 200 });
  const estados = [];
  let gravacoesKv = 0;
  for (let i = 1; i <= 8; i++) {
    if (i === 7) { await esperarFundo(); gravacoesKv = kv.gravacoes; }
    lojaD.produtos[0].preco = 5000 + i;
    r = await chamar(w, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' }, env: envRapido });
    j = await r.json();
    estados.push(r.status + (j.depois ? 'd' : ''));
  }
  const naBordaAntes = JSON.parse(kv.mapa.get('loja:dom-conizza').valor).loja.produtos[0].preco;
  await esperarFundo();
  const naBorda = JSON.parse(kv.mapa.get('loja:dom-conizza').valor).loja.produtos[0].preco;
  ok(estados.join(',') === '200,200,200,200,200,200,202d,202d' && naBordaAntes === 5006 && naBorda === 5008, 'dono salvando 8 vezes no minuto: nada de 429 (202 "depois") e a ultima mudanca chega na borda (' + estados.join(',') + ')');
  ok(kv.gravacoes - gravacoesKv === 1, 'as duas publicacoes a mais viram uma atualizacao so (1 gravacao no KV)');

  /* 5. loja e pedido inventados nao gastam o banco sem fim (30 "nao existe" por endereco em 10 min) */
  const IPX = { 'CF-Connecting-IP': '203.0.113.50' };
  const idx = (n) => ('x' + String(n)).padEnd(20, '0');
  const leiturasDe = async (n, fazer) => { const wx = await workerNovo(); zerar(); for (let i = 0; i < n; i++) await (await fazer(wx, i)).text(); return conta.leituras; };
  const envMp = Object.assign({}, env, { MP_CLIENT_ID: 'cli', MP_CLIENT_SECRET: 'seg' });
  const medidas = {
    criar: await leiturasDe(60, (wx, i) => chamar(wx, '/criar', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: idx(i) }, headers: IPX })),
    criarLoja: await leiturasDe(60, (wx, i) => chamar(wx, '/criar', { metodo: 'POST', corpo: { loja: 'inventada-c' + i, pedido: idx(i) }, headers: IPX })),
    fotos: await leiturasDe(60, (wx, i) => chamar(wx, '/fotos/inventada-f' + i + '?v=1', { headers: IPX })),
    foto: await leiturasDe(60, (wx, i) => chamar(wx, '/foto/inventada-g' + i + '/x', { headers: IPX })),
    status: await leiturasDe(60, (wx, i) => chamar(wx, '/status?loja=inventada-s' + i + '&pedido=' + idx(i) + '&mp=ORD1&expira=' + expiraLonge, { headers: IPX })),
    statusAntigo: await leiturasDe(60, (wx, i) => chamar(wx, '/status?loja=dom-conizza&pedido=' + idx(i), { headers: IPX })),
    aviso: await leiturasDe(60, (wx, i) => chamar(wx, '/webhook?loja=inventada-w' + i, { metodo: 'POST', corpo: { data: { id: 'ORD' + i } }, headers: Object.assign({ Origin: '' }, IPX) })),
    avisoSemLoja: await leiturasDe(60, (wx, i) => chamar(wx, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORDSEMREF' + i } }, headers: Object.assign({ Origin: '' }, IPX) })),
    concluir: await leiturasDe(60, (wx, i) => chamar(wx, '/mp/concluir', { metodo: 'POST', corpo: { code: 'abc', state: 'inventada-v' + i + '.nonce12345678', verificador: 'verificador0123456789' }, headers: IPX, env: envMp })),
  };
  ok(Object.keys(medidas).every((k) => medidas[k] === 30), '60 chamadas com loja ou pedido inventado: no maximo 30 leituras em cada rota (' + JSON.stringify(medidas) + ')');
  const wReal = await workerNovo();
  for (let i = 0; i < 31; i++) await (await chamar(wReal, '/status?loja=inventada-t' + i + '&pedido=' + idx(i) + '&mp=ORD1&expira=' + expiraLonge, { headers: IPX })).text();
  r = await chamar(wReal, '/status?loja=dom-conizza&pedido=' + PED + '&mp=ORDNAOTEM&expira=' + expiraLonge, { headers: IPX });
  ok(r.status === 200, 'o mesmo endereco continua perguntando de uma loja de verdade (a borda conhece)');

  /* 6. /status com outra grafia do id: vale o id do Mercado Pago, e o "caiu?" nunca devolve sozinho */
  w = await workerNovo();
  const PA = 'aliasaliasaliasalia1';
  const ORDA = 'ORD01JS2V6CM8KJ0EC4H502TGK1WP';
  const ORDa = 'ORD' + ORDA.slice(3).toLowerCase();
  db.set(caminhoDe(PA), pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', pagamentoStatus: 'pendente', senha: 95, cliente: { nome: 'Ana' }, mp: { id: ORDA }, pixCodigo: 'X' }));
  ordens.set(ORDA, { id: ORDA, status: 'processed', external_reference: 'dom-conizza__' + PA, total_amount: valorP1() });
  ordens.set(ORDa, ordens.get(ORDA)); /* o Mercado Pago acha a mesma order por outra grafia */
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: ORDA, external_reference: 'dom-conizza__' + PA } }, headers: { Origin: '' } });
  const devA = devolucoes.length;
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PA + '&mp=' + ORDa + '&expira=' + expiraLonge);
  let pa = db.get(caminhoDe(PA));
  ok((await r.json()).status === 'pago' && devolucoes.length === devA && !pa.duplicadasDevolvidas && pa.pagoPor === ORDA && pa.cobrancas.join(',') === ORDA, '"caiu?" com outra grafia do id da cobranca que pagou: vale o id do Mercado Pago e nada e devolvido');
  ordens.set('ORD990601', { id: 'ORD990601', status: 'processed', external_reference: 'dom-conizza__' + PA, total_amount: valorP1() });
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PA + '&mp=ORD990601&expira=' + expiraLonge);
  pa = db.get(caminhoDe(PA));
  ok(devolucoes.length === devA && pa.cobrancas.indexOf('ORD990601') >= 0 && !pa.duplicadasDevolvidas, '"caiu?" de uma segunda cobranca aprovada: so anota no pedido (quem devolve e o aviso do Mercado Pago)');
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD990601', external_reference: 'dom-conizza__' + PA } }, headers: { Origin: '' } });
  ok(devolucoes.length === devA + 1 && devolucoes[devolucoes.length - 1].id === 'ORD990601' && db.get(caminhoDe(PA)).pagoPor === ORDA, 'e o aviso do Mercado Pago devolve a segunda');

  /* 7. confirmacoes ao mesmo tempo nao perdem cobranca nem devolucao */
  const PR = 'corridacorridacorri1';
  db.set(caminhoDe(PR), pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'pix', pagamentoStatus: 'pendente', senha: 96, cliente: { nome: 'Ana' }, mp: { id: 'ORD990701' }, pixCodigo: 'X' }));
  for (const idR of ['ORD990701', 'ORD990702']) ordens.set(idR, { id: idR, status: 'processed', external_reference: 'dom-conizza__' + PR, total_amount: valorP1() });
  const fetchDaCorrida = globalThis.fetch;
  let esperando = [], lidas = 0;
  globalThis.fetch = async (u, o) => {
    /* as duas copias do worker leem o pedido antes de qualquer uma gravar */
    if (String(u) === BASE + caminhoDe(PR) && (!o || !o.method || o.method === 'GET') && ++lidas <= 2) {
      await new Promise((solta) => { esperando.push(solta); if (esperando.length === 2) esperando.forEach((f) => f()); });
    }
    return fetchDaCorrida(u, o);
  };
  const devR = devolucoes.length;
  await Promise.all(['ORD990701', 'ORD990702'].map(async (idR) => (await chamar(await workerNovo(), '/webhook', { metodo: 'POST', corpo: { data: { id: idR, external_reference: 'dom-conizza__' + PR } }, headers: { Origin: '' } })).text()));
  globalThis.fetch = fetchDaCorrida;
  const pr = db.get(caminhoDe(PR));
  const voltaram = devolucoes.slice(devR).map((d) => d.id);
  ok(voltaram.length === 1 && pr.status === 'pago' && pr.cobrancas.length === 2 && (pr.duplicadasDevolvidas || [])[0] === voltaram[0] && pr.pagoPor !== voltaram[0], 'duas cobrancas aprovadas confirmadas juntas (dois workers): uma paga, a outra volta sozinha e as duas ficam anotadas');
  Object.assign(pr, { status: 'cancelado', canceladoPor: 'loja' });
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PR }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok((await r.json()).ok === true && devolucoes.slice(devR).map((d) => d.id).sort().join(',') === 'ORD990701,ORD990702', 'cancelar e devolver: volta a que pagou, e a que ja tinha voltado nao volta de novo');
  ok(db.get(caminhoDe(PR)).pagamentoStatus === 'devolvido' && !!db.get(caminhoDe(PR)).devolvidoEm, 'devolvido: pagamentoStatus "devolvido" (sai do "Falta devolver" do painel)');
  ordens.set('ORD990703', { id: 'ORD990703', status: 'processed', external_reference: 'dom-conizza__' + PR, total_amount: valorP1() });
  const devR2 = devolucoes.length;
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD990703', external_reference: 'dom-conizza__' + PR } }, headers: { Origin: '' } });
  ok(devolucoes.length === devR2 + 1 && db.get(caminhoDe(PR)).status === 'cancelado' && db.get(caminhoDe(PR)).pagamentoStatus === 'devolvido', 'cobranca nova num pedido ja devolvido: volta sozinha e o pedido nao reabre');
  const PV = 'devolvidovelho000001';
  db.set(caminhoDe(PV), pedidoDe(1, { status: 'cancelado', canceladoPor: 'loja', formaPagamento: 'pix', pagamentoStatus: 'pago', senha: 97, mp: { id: 'ORD990704' }, devolvidoEm: '2026-09-20T10:00:00.000Z', cliente: { nome: 'Rui' } }));
  const devV = devolucoes.length;
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PV }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok((await r.json()).ja === true && devolucoes.length === devV && db.get(caminhoDe(PV)).pagamentoStatus === 'devolvido', 'pedido devolvido antes desta marca: o toque de novo so acerta o pagamentoStatus (nada volta duas vezes)');
  /* /cartao com o aviso atrasado da cobranca anterior chegando no meio */
  const PC3 = 'cartaocorridacartao1';
  const seisMin = new Date(Date.now() - 6 * 60e3).toISOString();
  db.set(caminhoDe(PC3), pedidoDe(1, { status: 'aguardando_pagamento', formaPagamento: 'cartao_online', pagamentoStatus: 'pendente', senha: 98, cliente: { nome: 'Rui' }, cobrandoEm: seisMin, cobrancaIncerta: seisMin, tentativasCartao: 1 }));
  ordens.set('ORD990801', { id: 'ORD990801', status: 'processed', external_reference: 'dom-conizza__' + PC3, total_amount: valorP1() });
  const wAviso = await workerNovo();
  let disparou = false;
  const fetchDoCartao = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (!disparou && /api\.mercadopago\.com\/v1\/orders$/.test(String(u)) && o && o.method === 'POST') {
      disparou = true;
      await (await chamar(wAviso, '/webhook', { metodo: 'POST', corpo: { data: { id: 'ORD990801', external_reference: 'dom-conizza__' + PC3 } }, headers: { Origin: '' } })).text();
    }
    return fetchDoCartao(u, o);
  };
  r = await chamar(await workerNovo(), '/cartao', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC3, token: 'APROVA2NOVO00000001', metodo: 'visa' }, headers: { 'CF-Connecting-IP': ipNovo() } });
  globalThis.fetch = fetchDoCartao;
  const pc3 = db.get(caminhoDe(PC3));
  ok(disparou && (await r.json()).status === 'aprovado' && pc3.pagoPor === 'ORD990801' && pc3.cobrancas.indexOf('ORD990801') >= 0 && pc3.cobrancas.indexOf(pc3.mp.id) >= 0, 'aviso atrasado de outra cobranca no meio do cartao: as duas cobrancas continuam anotadas no pedido');
  Object.assign(pc3, { status: 'cancelado', canceladoPor: 'loja' });
  const devC = devolucoes.length;
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PC3 }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok((await r.json()).ok === true && devolucoes.slice(devC).some((d) => d.id === 'ORD990801') && !devolucoes.slice(devC).some((d) => d.id === pc3.mp.id), 'cancelar e devolver alcanca a cobranca que pagou (e nao repete a que ja voltou)');
  const PP = 'devolverpagopor00001';
  for (const idP of ['ORD990901', 'ORD990902']) ordens.set(idP, { id: idP, status: 'processed', external_reference: 'dom-conizza__' + PP, total_amount: valorP1() });
  db.set(caminhoDe(PP), pedidoDe(1, { status: 'cancelado', canceladoPor: 'loja', formaPagamento: 'pix', pagamentoStatus: 'pago', senha: 99, mp: { id: 'ORD990901' }, cobrancas: ['ORD990901'], pagoPor: 'ORD990902', cliente: { nome: 'Rui' } }));
  const devP = devolucoes.length;
  r = await chamar(w, '/devolver', { metodo: 'POST', corpo: { loja: 'dom-conizza', pedido: PP }, headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura' } });
  ok((await r.json()).ok === true && devolucoes.slice(devP).map((d) => d.id).sort().join(',') === 'ORD990901,ORD990902', 'devolver alcanca tambem a cobranca que pagou (pagoPor) mesmo fora da lista');

  /* 9. renovacao do token que ficou esperando na borda so vale para a mesma conexao */
  const privadoMp = 'lojas/loja-mp/privado/mercadopago';
  const longe = new Date(Date.now() + 90 * 864e5).toISOString();
  db.set('lojas/loja-mp', { slug: 'loja-mp', nome: 'Loja MP', donoEmail: 'dono@x.com' });
  const statusMp = async () => (await chamar(await workerNovo(), '/status?loja=loja-mp&pedido=' + idx(1) + '&mp=ORDNAOTEM&expira=' + expiraLonge, { headers: { 'CF-Connecting-IP': ipNovo() } })).text();
  const guardarPendente = (x) => kv.mapa.set('mpnovo:loja-mp', { valor: JSON.stringify(x), metadata: { em: Date.now() } });
  db.set(privadoMp, { token: '', desconectadoEm: new Date().toISOString() });
  guardarPendente({ token: 'TOKEN-VELHO', refresh: 'R2', de: 'R1', tokenExpiraEm: longe });
  await statusMp();
  ok(db.get(privadoMp).token === '' && !kv.mapa.has('mpnovo:loja-mp'), 'loja desconectada: a renovacao velha guardada na borda sai sem religar o token');
  db.set(privadoMp, { token: 'T1', refresh: 'R1', tokenExpiraEm: longe });
  guardarPendente({ token: 'T2', refresh: 'R2', de: 'R1', tokenExpiraEm: longe });
  await statusMp();
  ok(db.get(privadoMp).token === 'T2' && db.get(privadoMp).refresh === 'R2' && !('de' in db.get(privadoMp)) && !kv.mapa.has('mpnovo:loja-mp'), 'renovacao da mesma conexao: grava no banco como antes');
  db.set(privadoMp, { token: 'T3', refresh: 'R3', tokenExpiraEm: longe });
  guardarPendente({ token: 'T-VELHO', refresh: 'R-VELHO', de: 'R2', tokenExpiraEm: longe });
  await statusMp();
  ok(db.get(privadoMp).token === 'T3' && !kv.mapa.has('mpnovo:loja-mp'), 'conectou de novo antes: a renovacao da conexao antiga nao passa por cima');
  db.set(privadoMp, { token: 'T3', refresh: 'R3', tokenExpiraEm: longe, oauthNonce: 'nonce12345678', oauthEm: new Date().toISOString(), oauthVerificador: 'verificadordodono0123' });
  guardarPendente({ token: 'T-VELHO', refresh: 'R-VELHO', de: 'R3', tokenExpiraEm: longe });
  const fetchDaVolta = globalThis.fetch;
  let trocas = 0;
  globalThis.fetch = async (u, o) => { if (String(u) === 'https://api.mercadopago.com/oauth/token') { trocas++; return resposta({ access_token: 'T-NOVO', refresh_token: 'R-NOVO', user_id: 7, public_key: 'PUB-NOVO', expires_in: 15552000 }); } return fetchDaVolta(u, o); };
  /* a volta do Mercado Pago nao troca nada: leva o codigo para o painel */
  r = await chamar(await workerNovo(), '/mp/volta?code=TG-abc&state=loja-mp.nonce12345678', { env: envMp, headers: { 'CF-Connecting-IP': ipNovo() } });
  const destino = r.headers.get('Location') || '';
  ok(r.status === 302 && /#\/painel\/loja-mp\/mp-concluir\?code=TG-abc&state=loja-mp\.nonce12345678$/.test(destino) && trocas === 0 && db.get(privadoMp).token === 'T3', 'a volta do Mercado Pago leva o codigo para o painel e nao troca nada sozinha');
  /* golpe: o link de conectar foi repassado para outra pessoa; o painel dela nao tem o verificador */
  r = await chamar(await workerNovo(), '/mp/concluir', { metodo: 'POST', corpo: { code: 'TG-abc', state: 'loja-mp.nonce12345678' }, env: envMp, headers: { 'CF-Connecting-IP': ipNovo() } });
  j = await r.json();
  ok(j.ok === false && trocas === 0 && db.get(privadoMp).token === 'T3', 'link de conectar repassado: sem o verificador do celular do dono, nada e trocado');
  r = await chamar(await workerNovo(), '/mp/concluir', { metodo: 'POST', corpo: { code: 'TG-abc', state: 'loja-mp.nonce12345678', verificador: 'verificadorerrado01234' }, env: envMp, headers: { 'CF-Connecting-IP': ipNovo() } });
  j = await r.json();
  ok(j.ok === false && trocas === 0 && db.get(privadoMp).token === 'T3', 'verificador errado: nada e trocado');
  /* o celular do dono termina */
  r = await chamar(await workerNovo(), '/mp/concluir', { metodo: 'POST', corpo: { code: 'TG-abc', state: 'loja-mp.nonce12345678', verificador: 'verificadordodono0123' }, env: envMp, headers: { 'CF-Connecting-IP': ipNovo() } });
  j = await r.json();
  globalThis.fetch = fetchDaVolta;
  ok(j.ok === true && j.cartao === true && trocas === 1 && db.get(privadoMp).token === 'T-NOVO' && db.get(privadoMp).oauthVerificador === '' && !kv.mapa.has('mpnovo:loja-mp'), 'o painel do dono termina: token novo, verificador gasto e a renovacao que esperava na borda sai');

  /* 11. cartao em analise no banco nao "vence" como Pix */
  const quarentaMin = new Date(Date.now() - 40 * 60e3).toISOString();
  const PAN = 'analiseanaliseanali1';
  ordens.set('ORD991101', { id: 'ORD991101', status: 'processing', status_detail: 'in_process', external_reference: 'dom-conizza__' + PAN, total_amount: valorP1(), transactions: { payments: [{ id: 'PAYORD991101', status: 'processing', status_detail: 'in_process' }] } });
  db.set(caminhoDe(PAN), pedidoDe(1, { criadoEm: quarentaMin, status: 'aguardando_pagamento', formaPagamento: 'cartao_online', pagamentoStatus: 'pendente', senha: 100, cliente: { nome: 'Rui' }, mp: { id: 'ORD991101', cartao: true }, cobrandoEm: quarentaMin, cobrancaIncerta: quarentaMin }));
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PAN, { headers: { 'CF-Connecting-IP': ipNovo() } }); j = await r.json();
  ok(j.status === 'aguardando_pagamento' && j.vencido === false, 'cartao em analise no banco ha 40 min: nao vence (o painel nao cancela como "Pix venceu")');
  const PSA = 'semanalisesemanalis1';
  db.set(caminhoDe(PSA), pedidoDe(1, { criadoEm: quarentaMin, status: 'aguardando_pagamento', formaPagamento: 'cartao_online', pagamentoStatus: 'pendente', senha: 101, cliente: { nome: 'Rui' } }));
  r = await chamar(w, '/status?loja=dom-conizza&pedido=' + PSA, { headers: { 'CF-Connecting-IP': ipNovo() } }); j = await r.json();
  ok(j.vencido === true, 'cartao sem cobranca nenhuma ha 40 min: vence como antes');
}

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
/* o primeiro pedido que bate no limite (ninguem tinha visto a pausa ainda): ja volta a pausa, nao um erro */
globalThis.__limite = true;
const w4 = await workerNovo();
r = await chamar(w4, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: { nome: 'Ana Souza', telefone: '13999990077', tipoEntrega: 'retirada', itens: [{ produtoId: 'p1', quantidade: 1 }], formaPagamento: 'pix' } }, headers: { 'CF-Connecting-IP': '10.77.0.1' } }); j = await r.json();
globalThis.__limite = false;
kv.mapa.delete('sistema:pausa');
ok(r.status === 503 && j.pausa === true, 'o primeiro pedido que bate no limite do banco ja volta com a pausa (o site manda pelo WhatsApp da loja na hora)');
const w5 = await workerNovo();
r = await chamar(w5, '/pedido', { metodo: 'POST', corpo: { loja: 'dom-conizza', dados: { nome: 'Ana Souza', telefone: '13999990078', tipoEntrega: 'retirada', itens: [{ produtoId: 'p1', quantidade: 1 }], formaPagamento: 'pix' } }, headers: { 'CF-Connecting-IP': '10.77.0.2' } });
ok(r.status === 200, 'e com o banco normal o pedido passa (a pausa nao gruda)');

console.log('Vagas de fundador pela borda');
{
  db.set('publico/fundadores', { usados: 2, capacidade: { max: 12, lojas: 3, fechado: false } });
  const wf = await workerNovo();
  zerar();
  r = await chamar(wf, '/fundadores'); j = await r.json();
  const r2 = await chamar(wf, '/fundadores'); const j2 = await r2.json();
  ok(r.status === 200 && j.borda === 1 && j.usados === 2 && j.capacidade.max === 12 && j2.usados === 2 && conta.leituras === 1, 'o numero de vagas sai da borda: duas visitas, uma leitura no banco (um pico de visitas nao gasta a cota)');
  ok(/max-age=60/.test(r.headers.get('Cache-Control') || ''), 'e fica guardado 1 minuto');
}

console.log('Sem KV ligado');
w = await workerNovo();
r = await chamar(w, '/loja/dom-conizza', { env: { FIREBASE_SA: env.FIREBASE_SA } });
ok(r.status === 501, 'sem o KV: responde 501 e o site volta a ler do Firestore');
r = await chamar(w, '/loja/dom-conizza', { headers: { Origin: 'https://site-estranho.com' } });
ok(r.status === 403, 'outro site nao usa o cardapio');

console.log('Video da Loja do Ligeiro na copia da loja');
{
  db.set('lojas/videoteste', { slug: 'videoteste', nome: 'Video Teste', donoEmail: 'dono@x.com', video: { id: 'x'.repeat(20), titulo: '<b>falso</b>' } });
  let w2 = await workerNovo();
  let r2 = await chamar(w2, '/loja/videoteste'); let j2 = await r2.json();
  ok(r2.status === 200 && !j2.loja.video, 'video gravado por fora no documento da loja nao vale');
  await kv.put('srv:video:videoteste', JSON.stringify({ id: 'a1b2c3d4e5f6g7h8i9j0', titulo: 'Combo', dur: 18, capa: true }));
  kv.mapa.delete('loja:videoteste'); w2 = await workerNovo();
  r2 = await chamar(w2, '/loja/videoteste'); j2 = await r2.json();
  ok(j2.loja.video && j2.loja.video.id === 'a1b2c3d4e5f6g7h8i9j0' && j2.loja.video.dur === 18 && j2.loja.video.capa === true, 'o video escolhido (srv:video) vem junto da loja, sem leitura a mais por visita');
  await kv.put('srv:video:videoteste', JSON.stringify({ id: '../../x', titulo: 'x' }));
  kv.mapa.delete('loja:videoteste'); w2 = await workerNovo();
  r2 = await chamar(w2, '/loja/videoteste'); j2 = await r2.json();
  ok(!j2.loja.video, 'id de video torto: fica de fora');
}

console.log('Pentest de 03/10/2026');
{
  /* 1. login de OUTRO projeto do Firebase: mesmo que o Google o aceitasse, aqui nao vale */
  const w3 = await workerNovo();
  const tokAdminDeOutro = jwtDoProjeto('admin-de-outro-projeto', 'projeto-do-atacante');
  usuarios[tokAdminDeOutro] = 'ligeiro.pedidos@gmail.com';
  const lookupsAntes = conta.lookup;
  let rr = await chamar(w3, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer ' + tokAdminDeOutro } });
  ok(rr.status === 401 && conta.lookup === lookupsAntes, 'login de OUTRO projeto do Firebase (mesmo com o e-mail do admin): 401, e nem pergunta ao Google');
  const tokBomAdmin = jwtDoProjeto('admin', 'proj');
  usuarios[tokBomAdmin] = 'ligeiro.pedidos@gmail.com';
  rr = await chamar(w3, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer ' + tokBomAdmin } });
  ok(rr.status === 200 || rr.status === 202, 'o mesmo e-mail com o token do projeto certo continua valendo');
  const tokSemIss = b64u({ alg: 'RS256' }) + '.' + b64u({ aud: 'proj', iss: 'https://evil.example/proj' }) + '.x';
  usuarios[tokSemIss] = 'ligeiro.pedidos@gmail.com';
  rr = await chamar(w3, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer ' + tokSemIss } });
  ok(rr.status === 401, 'token com aud certo e emissor (iss) errado: 401');
  rr = await chamar(w3, '/publicar', { metodo: 'POST', corpo: { loja: 'dom-conizza' }, headers: { Authorization: 'Bearer isto.nao.e-um-token' } });
  ok(rr.status === 401, 'texto que nao e token: 401');

  /* 2. senha da equipe: 8 a 10 numeros */
  const equipe = (pin) => chamar(w3, '/equipe', { metodo: 'POST', corpo: { loja: 'dom-conizza', pin: pin }, headers: { Authorization: 'Bearer ' + jwtDoProjeto('dono', 'proj') } });
  for (const [pin, texto] of [['482913', '6 numeros (era permitido, so 1 milhao de combinacoes)'], ['4829137', '7 numeros'], ['48291375601', '11 numeros'], ['12121212', 'bloco repetido (12 12 12 12)'], ['12341234', 'bloco repetido (1234 1234)'], ['87654321', 'sequencia'], ['00000000', 'tudo igual']]) {
    rr = await equipe(pin);
    ok(rr.status === 400, 'senha da equipe com ' + texto + ': recusada');
  }
  rr = await equipe('4829137560');
  ok(rr.status === 200, 'senha da equipe com 10 numeros: aceita');

  /* 3. IPv6 comprimido (2001:db8::1 e 2001:db8::2 sao a mesma casa) */
  const w4 = await workerNovo();
  let barrado = false;
  for (let i = 0; i < 61; i++) { rr = await chamar(w4, '/status?loja=dom-conizza&pedido=' + PED, { headers: { 'CF-Connecting-IP': '2001:db8::' + (i + 1).toString(16) } }); if (rr.status === 429) barrado = true; }
  ok(barrado, '/status pelo IPv6 comprimido (2001:db8::N): a mesma casa, para em 60 por minuto');

  /* 4. teto diario de e-mails de contato (KV): a cota do script e uma so, dividida com os recibos */
  const emailsC = [];
  const fetchAntesC = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    if (String(url).indexOf('https://script.google.com/macros/s/') === 0) { emailsC.push(1); return resposta({ ok: true }); }
    return fetchAntesC(url, op);
  };
  const envC = Object.assign({}, env, { EMAIL_URL: 'https://script.google.com/macros/s/AKfycbxTESTE/exec', EMAIL_TOKEN: 'segredo-do-script', CARDAPIO: kvNovo() });
  const wC = await workerNovo();
  let gravados = 0;
  for (let i = 0; i < 30; i++) {
    rr = await chamar(wC, '/lead', { metodo: 'POST', corpo: { nome: 'Contato ' + i, whatsapp: '1398888' + String(1000 + i) }, headers: { 'CF-Connecting-IP': '10.77.' + Math.floor(i / 8) + '.' + (i % 8) }, env: envC });
    await esperarFundo();
    if (rr.status === 200) gravados++;
  }
  ok(gravados >= 25 && emailsC.length === 25, 'contatos em massa: so 25 e-mails por dia (os recibos de pagamento ficam com o resto da cota), o contato continua gravado');
  globalThis.fetch = fetchAntesC;

  /* 5. /publicar de loja inventada: poucas por pessoa */
  const w5 = await workerNovo();
  const tokNovato = jwtDoProjeto('novato', 'proj'); usuarios[tokNovato] = 'novato@x.com';
  let r429 = 0;
  for (let i = 0; i < 12; i++) { rr = await chamar(w5, '/publicar', { metodo: 'POST', corpo: { loja: 'loja-que-nao-existe-' + i }, headers: { Authorization: 'Bearer ' + tokNovato } }); if (rr.status === 429) r429++; }
  ok(r429 >= 3, '/publicar de loja que nao existe: a partir da 9a, 429 (nao le mais o banco)');

  /* 6. vitrine inflada de proposito nao entra na lista que todo visitante baixa */
  db.set('vitrine/inflada-teste', { slug: 'inflada-teste', nome: 'Inflada', cidadeSlug: 'juquia', ativa: true, lixo: 'x'.repeat(70000) });
  kv.mapa.delete('vitrine');
  const wV = await workerNovo();
  rr = await chamar(wV, '/vitrine'); const jV = await rr.json();
  ok(Array.isArray(jV.lista) && !jV.lista.some((l) => l.slug === 'inflada-teste'), 'vitrine: documento de mais de 60 mil caracteres fica de fora da lista');
  db.delete && db.delete('vitrine/inflada-teste');
}


console.log('Estoque das lojas de comercio');
{
  const DONO = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura';
  const OUTRO = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJvdXRybyJ9.assinatura';
  db.set('lojas/roupas-teste', {
    slug: 'roupas-teste', nome: 'Roupas Teste', tipo: 'Roupas', donoEmail: 'dono@x.com', aberta: true, ativa: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true,
    categorias: [{ id: 'cam', nome: 'Camisetas' }, { id: 'ace', nome: 'Acessórios' }],
    produtos: [
      { id: 'camiseta', categoria: 'cam', nome: 'Camiseta preta', preco: 5990, controlaEstoque: true },
      { id: 'meia', categoria: 'ace', nome: 'Meia', preco: 1500, controlaEstoque: true },
      { id: 'bone', categoria: 'ace', nome: 'Boné', preco: 3990 },
    ],
    grupos: { tam: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0 }, { id: 'm', nome: 'M', preco: 0 }, { id: 'g', nome: 'G', preco: 0 }] } },
    gruposPorCategoria: { cam: ['tam'], ace: [] },
  });
  db.set('lojas/roupas-teste/privado/mercadopago', { token: 'TOKEN-LOJA' });
  let w = await workerNovo();
  const EST = 'lojas/roupas-teste/contadores/estoque';
  let nIpE = 0;
  const ipNovo = () => { nIpE += 1; return '10.91.' + Math.floor(nIpE / 250) + '.' + (nIpE % 250); };
  const pedirR = (itens, extra) => chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'roupas-teste', dados: Object.assign({ nome: 'Bia Lima', telefone: '13988887777', tipoEntrega: 'retirada', itens: itens, formaPagamento: 'pix' }, extra) }, headers: { 'CF-Connecting-IP': ipNovo() } });
  let r, j;

  /* o dono acerta as quantidades; chave de produto sem controle, tamanho que nao existe e numero torto ficam de fora */
  r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-teste', q: { 'camiseta|m': 2, 'camiseta|g': 1, meia: 1, bone: 5, 'camiseta|xx': 3, 'camiseta|p': -1, meia2: 4 } }, headers: { Authorization: DONO } }); j = await r.json();
  ok(r.status === 200 && j.ok && JSON.stringify(db.get(EST).q) === JSON.stringify({ 'camiseta|m': 2, 'camiseta|g': 1, meia: 1 }), 'dono acerta o estoque: so as chaves de produto com controle (e do tamanho da categoria)');
  r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-teste', q: { meia: 99 } }, headers: { Authorization: OUTRO } });
  ok(r.status === 403 && db.get(EST).q.meia === 1, 'outra pessoa nao mexe no estoque da loja: 403');
  r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-teste', q: { meia: 99 } } });
  ok(r.status === 401 && db.get(EST).q.meia === 1, 'sem login: 401');
  /* o site le as quantidades (sem as reservas) */
  r = await chamar(w, '/estoque/roupas-teste'); j = await r.json();
  ok(r.status === 200 && j.q['camiseta|m'] === 2 && !('baixas' in j), 'site le o estoque (so as quantidades)');
  r = await chamar(w, '/estoque/dom-conizza'); j = await r.json();
  ok(r.status === 200 && JSON.stringify(j.q) === '{}', 'loja sem produto com estoque: nem le o banco, volta vazio');

  /* roupa sem tamanho escolhido nao passa */
  r = await pedirR([{ produtoId: 'camiseta', quantidade: 1 }]); j = await r.json();
  ok(r.status === 422 && /Escolha o tamanho de "Camiseta preta"/.test(j.erro), 'comercio: sem escolher o tamanho, o pedido nao nasce');
  /* o pedido reserva o estoque no mesmo lote */
  r = await pedirR([{ produtoId: 'camiseta', quantidade: 2, tamanho: 'm' }, { produtoId: 'bone', quantidade: 3 }]); j = await r.json();
  const P1 = j.pedido && j.pedido.id;
  ok(r.status === 200 && db.get(EST).q['camiseta|m'] === 0 && db.get(EST).baixas[P1] && db.get(EST).baixas[P1].i['camiseta|m'] === 2, 'pedido reserva 2 camisetas M (e o bone, sem controle, nao mexe em nada)');
  ok(JSON.stringify(db.get('lojas/roupas-teste/pedidos/' + P1).estoque) === JSON.stringify({ 'camiseta|m': 2 }), 'o pedido guarda o que reservou');
  /* acabou: 409 com o que falta, e nada e gravado */
  const pedidosAntes = [...db.keys()].filter((k) => k.indexOf('lojas/roupas-teste/pedidos/') === 0).length;
  r = await pedirR([{ produtoId: 'camiseta', quantidade: 1, tamanho: 'm' }, { produtoId: 'meia', quantidade: 2 }]); j = await r.json();
  ok(r.status === 409 && /Camiseta preta \(M\) esgotou\./.test(j.erro) && /Só tem 1 de Meia\./.test(j.erro), 'sem estoque: 409 dizendo o que acabou e quanto sobrou');
  ok([...db.keys()].filter((k) => k.indexOf('lojas/roupas-teste/pedidos/') === 0).length === pedidosAntes && db.get(EST).q.meia === 1, 'e nada foi gravado (nem pedido, nem senha, nem estoque)');
  /* dois clientes atras da ultima peca: o outro pedido grava antes deste lote; a trava faz reler e este recusa */
  globalThis.__antesDoLote = () => { const d = db.get(EST); d.q['camiseta|g'] = 0; versoes.set(EST, (versoes.get(EST) || 0) + 1); };
  r = await pedirR([{ produtoId: 'camiseta', quantidade: 1, tamanho: 'g' }]); j = await r.json();
  globalThis.__antesDoLote = null;
  ok(r.status === 409 && /Camiseta preta \(G\) esgotou/.test(j.erro), 'a ultima peca disputada por dois: so um leva (o outro recebe "esgotou")');
  db.get(EST).q['camiseta|g'] = 1;

  /* cancelado: a reserva volta, uma vez so */
  r = await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P1 } }); j = await r.json();
  ok(j.ok === false && db.get(EST).q['camiseta|m'] === 0, 'pedido que nao foi cancelado: nada volta');
  Object.assign(db.get('lojas/roupas-teste/pedidos/' + P1), { status: 'cancelado', canceladoPor: 'cliente' });
  r = await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P1 } }); j = await r.json();
  ok(j.ok && db.get(EST).q['camiseta|m'] === 2 && !db.get(EST).baixas[P1] && db.get('lojas/roupas-teste/pedidos/' + P1).estoqueDevolvido === true, 'cancelou: as 2 camisetas voltam e o pedido fica marcado');
  r = await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P1 } }); j = await r.json();
  ok(j.ok && j.ja && db.get(EST).q['camiseta|m'] === 2, 'devolver de novo nao soma duas vezes');

  /* pagou depois de cancelar: volta para a fila e reserva de novo */
  /* (o Pix e gerado com o pedido ainda esperando; depois ele cancela, as pecas voltam e o pagamento cai) */
  db.get('lojas/roupas-teste/pedidos/' + P1).status = 'aguardando_pagamento';
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P1 } }); j = await r.json();
  const ordemP1 = j.mp;
  Object.assign(db.get('lojas/roupas-teste/pedidos/' + P1), { status: 'cancelado', canceladoPor: 'cliente' });
  if (ordemP1 && ordens.get(ordemP1)) ordens.get(ordemP1).status = 'processed';
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: ordemP1, external_reference: 'roupas-teste__' + P1 } }, headers: { Origin: '' } });
  const p1 = db.get('lojas/roupas-teste/pedidos/' + P1);
  ok(!!ordemP1 && p1.status === 'pago' && p1.pagoAposCancelar === true && db.get(EST).q['camiseta|m'] === 0 && db.get(EST).baixas[P1] && p1.estoqueDevolvido === false, 'pagou depois de cancelar: o pedido volta e as 2 camisetas sao reservadas de novo');

  /* pagou depois de cancelar e a peca ja tinha sido vendida: o pedido entra, marcado para a loja resolver */
  r = await pedirR([{ produtoId: 'meia', quantidade: 1 }]); j = await r.json();
  const P2 = j.pedido && j.pedido.id;
  r = await chamar(w, '/criar', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P2 } }); j = await r.json();
  const ordemP2 = j.mp;
  Object.assign(db.get('lojas/roupas-teste/pedidos/' + P2), { status: 'cancelado', canceladoPor: 'pix-vencido' });
  await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: P2 } });
  const ok2 = db.get(EST).q.meia === 1;
  r = await pedirR([{ produtoId: 'meia', quantidade: 1 }], { telefone: '13977776666' });
  if (ordemP2 && ordens.get(ordemP2)) ordens.get(ordemP2).status = 'processed';
  await chamar(w, '/webhook', { metodo: 'POST', corpo: { data: { id: ordemP2, external_reference: 'roupas-teste__' + P2 } }, headers: { Origin: '' } });
  const p2 = db.get('lojas/roupas-teste/pedidos/' + P2);
  ok(ok2 && r.status === 200 && p2.status === 'pago' && p2.estoqueFaltou === true && db.get(EST).q.meia === 0, 'pagou depois e a meia ja foi vendida para outro: o pedido entra com o aviso "estoque faltou" e o estoque nao fica negativo');
}

console.log('Tamanhos do item e fotos extras');
{
  const DONO = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura';
  db.set('lojas/roupas-dois', {
    slug: 'roupas-dois', nome: 'Roupas Dois', tipo: 'Roupas', donoEmail: 'dono@x.com', aberta: true, ativa: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true, fotosVersao: 'g1',
    categorias: [{ id: 'cam', nome: 'Camisetas' }],
    produtos: [
      /* a camiseta lisa nao tem GG; o lenco esta na categoria com tamanho, mas e tamanho unico (tirou todos) */
      { id: 'lisa', categoria: 'cam', nome: 'Camiseta lisa', preco: 4000, tamanhosFora: ['gg'], foto: 'fa1', fotosExtras: ['fx2', 'fx3'] },
      { id: 'lenco', categoria: 'cam', nome: 'Lenço', preco: 2500, tamanhosFora: ['p', 'gg'], controlaEstoque: true },
    ],
    grupos: { tam: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0 }, { id: 'gg', nome: 'GG', preco: 500 }] } },
    gruposPorCategoria: { cam: ['tam'] },
  });
  db.set('lojas/roupas-dois/privado/mercadopago', { token: 'TOKEN-LOJA' });
  db.set('lojas/roupas-dois/fotos/fa1', { dados: FOTO });
  db.set('lojas/roupas-dois/fotos/fx2', { dados: FOTO });
  db.set('lojas/roupas-dois/fotos/fx3', { dados: FOTO });
  db.set('vitrine/roupas-dois', { slug: 'roupas-dois', nome: 'Roupas Dois', cidadeSlug: 'juquia' });
  let w = await workerNovo();
  const pedir2 = (itens) => chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'roupas-dois', dados: { nome: 'Bia Lima', telefone: '13988887777', tipoEntrega: 'retirada', itens: itens, formaPagamento: 'pix' } }, headers: { 'CF-Connecting-IP': '203.0.113.' + (60 + Math.floor(Math.random() * 120)) } });
  let r = await pedir2([{ produtoId: 'lisa', quantidade: 1, tamanho: 'gg' }]); let j = await r.json();
  ok(r.status === 422 && /Não tem mais "GG" em "Camiseta lisa"/.test(j.erro), 'tamanho que o item nao tem: o pedido nao nasce e o cliente le qual');
  r = await pedir2([{ produtoId: 'lisa', quantidade: 1, tamanho: 'p' }, { produtoId: 'lenco', quantidade: 1 }]); j = await r.json();
  ok(r.status === 409 && /Lenço esgotou/.test(j.erro), 'item de tamanho unico com estoque: uma quantidade so, sem tamanho (e sem quantidade, esgotado)');
  r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-dois', q: { lenco: 3, 'lenco|p': 9 } }, headers: { Authorization: DONO } }); j = await r.json();
  ok(r.status === 200 && JSON.stringify(j.q) === JSON.stringify({ lenco: 3 }), 'o dono acerta o lenco sem tamanho (a chave do tamanho que ele nao tem fica de fora)');
  r = await pedir2([{ produtoId: 'lisa', quantidade: 1, tamanho: 'p' }, { produtoId: 'lenco', quantidade: 1 }]); j = await r.json();
  ok(r.status === 200 && db.get('lojas/roupas-dois/contadores/estoque').q.lenco === 2, 'com quantidade, o pedido nasce e o lenco baixa para 2');
  /* fotos: o pacote da loja sem pacote nao leva a 2a e a 3a foto; a /foto entrega as tres */
  r = await chamar(w, '/fotos/roupas-dois?v=g1'); j = await r.json();
  const ids = [];
  j.docs.forEach((pag) => (pag.documents || []).forEach((d) => ids.push(d.name.split('/').pop())));
  ok(j.pacote === false && ids.join(',') === 'fa1', 'as fotos extras ficam fora do que todo visitante baixa');
  r = await chamar(w, '/foto/roupas-dois/fx2');
  ok(r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg', 'a 2a foto vem pela borda quando o cliente abre o item');
  r = await chamar(w, '/foto/roupas-dois/fx3');
  ok(r.status === 200, 'a 3a tambem');
  zerar();
  r = await chamar(w, '/foto/roupas-dois/fx9');
  ok(r.status === 404 && conta.leituras === 0, 'foto que nenhum item usa: 404 sem ler o banco');
}
console.log('Preco por tamanho e por tempo limitado');
{
  const agora = Date.now();
  db.set('lojas/promo-tres', {
    slug: 'promo-tres', nome: 'Promo Tres', tipo: 'Lanchonete', donoEmail: 'dono@x.com', aberta: true, ativa: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true,
    categorias: [{ id: 'lan', nome: 'Lanches' }],
    produtos: [
      /* o G deste item custa 29,90 (o da categoria seria +7,00); o combo esta por 24,90 ate daqui a 2 h; o de Natal acabou */
      { id: 'x', categoria: 'lan', nome: 'X-Burguer', preco: 1800, precosTamanho: { p: 1800, g: 2990 } },
      { id: 'combo', categoria: 'lan', nome: 'Combo', preco: 3000, tamanhosFora: ['p', 'g'], oferta: { ate: new Date(agora + 2 * 3600 * 1000).toISOString(), preco: 2490, some: false } },
      { id: 'natal', categoria: 'lan', nome: 'Lanche de Natal', preco: 2000, tamanhosFora: ['p', 'g'], oferta: { ate: new Date(agora - 60 * 1000).toISOString(), some: true } },
    ],
    grupos: { tam: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0, padrao: true }, { id: 'g', nome: 'G', preco: 700 }] } },
    gruposPorCategoria: { lan: ['tam'] },
  });
  db.set('lojas/promo-tres/privado/mercadopago', { token: 'TOKEN-LOJA' });
  db.set('vitrine/promo-tres', { slug: 'promo-tres', nome: 'Promo Tres', cidadeSlug: 'juquia' });
  const w = await workerNovo();
  const pedir3 = (itens) => chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'promo-tres', dados: { nome: 'Caio Prado', telefone: '13977776666', tipoEntrega: 'retirada', itens: itens, formaPagamento: 'pix' } }, headers: { 'CF-Connecting-IP': '198.51.100.' + (10 + Math.floor(Math.random() * 200)) } });
  let r = await pedir3([{ produtoId: 'x', quantidade: 1, tamanho: 'g' }]); let j = await r.json();
  ok(r.status === 200 && j.pedido && j.pedido.total === 2990 && j.pedido.itens[0].tamanho.preco === 1190, 'preco por tamanho: o G sai pelo preco do item (29,90), nao pelo acrescimo da categoria');
  r = await pedir3([{ produtoId: 'x', quantidade: 2, tamanho: 'p' }]); j = await r.json();
  ok(r.status === 200 && j.pedido.total === 3600, 'o P sai pelo menor (18,00)');
  r = await pedir3([{ produtoId: 'combo', quantidade: 2 }]); j = await r.json();
  ok(r.status === 200 && j.pedido.total === 4980, 'na oferta: o mensageiro cobra o preco da oferta (24,90), pela hora dele');
  r = await pedir3([{ produtoId: 'natal', quantidade: 1 }]); j = await r.json();
  ok(r.status === 422 && /era por tempo limitado e acabou/.test(j.erro), 'oferta que acabou e era "so ate la": o pedido nao nasce e o cliente le o motivo');
  r = await pedir3([{ produtoId: 'combo', quantidade: 1, preco: 1 }]); j = await r.json();
  ok(r.status === 200 && j.pedido.total === 2490, 'preco inventado pelo aparelho nao vale: so o da oferta do cardapio');
}
console.log('Pentest 06/10: oferta e preco por tamanho pelo lado do cliente');
{
  const agora = Date.now();
  db.set('lojas/promo-quatro', {
    slug: 'promo-quatro', nome: 'Promo Quatro', tipo: 'Lanchonete', donoEmail: 'dono@x.com', aberta: true, ativa: true, aceitaPix: true, mpAtivo: true, aceitaRetirada: true,
    categorias: [{ id: 'lan', nome: 'Lanches' }],
    produtos: [
      { id: 'x', categoria: 'lan', nome: 'X-Burguer', preco: 1800, precosTamanho: { p: 1800, g: 2990 } },
      { id: 'velha', categoria: 'lan', nome: 'Oferta velha', preco: 3000, tamanhosFora: ['p', 'g'], oferta: { ate: new Date(agora - 3600 * 1000).toISOString(), preco: 100, some: false } },
      { id: 'natal', categoria: 'lan', nome: 'Lanche de Natal', preco: 2000, tamanhosFora: ['p', 'g'], oferta: { ate: new Date(agora - 60 * 1000).toISOString(), some: true } },
    ],
    grupos: { tam: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0, padrao: true }, { id: 'g', nome: 'G', preco: 700 }] } },
    gruposPorCategoria: { lan: ['tam'] },
  });
  db.set('lojas/promo-quatro/privado/mercadopago', { token: 'TOKEN-LOJA' });
  db.set('vitrine/promo-quatro', { slug: 'promo-quatro', nome: 'Promo Quatro', cidadeSlug: 'juquia' });
  const w = await workerNovo();
  const pedir4 = (itens, extra) => chamar(w, '/pedido', { metodo: 'POST', corpo: { loja: 'promo-quatro', dados: Object.assign({ nome: 'Eva Souza', telefone: '1396666' + String(1000 + Math.floor(Math.random() * 8999)), tipoEntrega: 'retirada', itens: itens, formaPagamento: 'pix' }, extra || {}) }, headers: { 'CF-Connecting-IP': '192.0.2.' + (10 + Math.floor(Math.random() * 200)) } });
  /* a hora do aparelho nao vale: a oferta que ja acabou nao volta com "agora" de ontem */
  let r = await pedir4([{ produtoId: 'velha', quantidade: 1 }], { agora: new Date(agora - 24 * 3600 * 1000).toISOString(), instante: '2000-01-01T00:00:00Z' }); let j = await r.json();
  ok(r.status === 200 && j.pedido.total === 3000 && !j.pedido.itens[0].precoOferta, 'pentest: "agora" de ontem no pedido nao traz a oferta que acabou (vale a hora do mensageiro)');
  /* "tolerante" e "precoOferta" mandados pelo aparelho nao passam */
  r = await pedir4([{ produtoId: 'natal', quantidade: 1, precoOferta: 1 }], { tolerante: true }); j = await r.json();
  ok(r.status === 422 && /era por tempo limitado e acabou/.test(j.erro), 'pentest: "tolerante" do aparelho nao deixa pedir o item que saiu por tempo');
  r = await pedir4([{ produtoId: 'x', quantidade: 1, tamanho: 'g', precoOferta: 1, precoUnitario: 1, totalItem: 1, tamanhoPreco: -2990 }]); j = await r.json();
  ok(r.status === 200 && j.pedido.total === 2990 && !j.pedido.itens[0].precoOferta, 'pentest: preco, oferta e total inventados no item nao valem (G pelo preco do item)');
  /* tamanho e item com nome de coisa do sistema */
  r = await pedir4([{ produtoId: 'x', quantidade: 1, tamanho: '__proto__' }]); j = await r.json();
  ok(r.status === 422, 'pentest: tamanho "__proto__" nao existe (o pedido nao nasce)');
  r = await pedir4([{ produtoId: '__proto__', quantidade: 1 }]); j = await r.json();
  ok(r.status === 422, 'pentest: item "__proto__" nao existe');
  r = await pedir4([{ produtoId: 'constructor', quantidade: 1 }]); j = await r.json();
  ok(r.status === 422, 'pentest: item "constructor" nao existe');
  /* quantidade fora do normal */
  r = await pedir4([{ produtoId: 'x', quantidade: 1e9, tamanho: 'p' }]); j = await r.json();
  ok(r.status === 422, 'pentest: quantidade absurda nao vira pedido');
  r = await pedir4([{ produtoId: 'x', quantidade: -3, tamanho: 'p' }]); j = await r.json();
  ok(r.status === 422 || (r.status === 200 && j.pedido.total > 0), 'pentest: quantidade negativa nao vira desconto');
}
console.log('Pentest 08/10: o banco gratis nao se gasta com chamada repetida ou inventada');
{
  const DONO = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJwcm9qIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Byb2oiLCJzdWIiOiJkb25vIn0.assinatura';
  /* 1. estoque: 100 visitas juntas e 50 seguidas fazem uma leitura so (antes, uma por chamada) */
  let w = await workerNovo();
  zerar();
  let rs = await Promise.all(Array.from({ length: 100 }, () => chamar(w, '/estoque/roupas-teste')));
  const leituras100 = conta.leituras;
  for (let i = 0; i < 50; i++) rs.push(await chamar(w, '/estoque/roupas-teste'));
  ok(rs.every((x) => x.status === 200) && leituras100 <= 2 && conta.leituras === leituras100, 'estoque: 100 visitas juntas + 50 seguidas = so a primeira leitura (' + conta.leituras + ')');
  /* o dono muda a quantidade: a copia guardada sai na hora (o site nao fica com o numero velho) */
  let r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-teste', q: { meia: 7 } }, headers: { Authorization: DONO } });
  let j = await (await chamar(w, '/estoque/roupas-teste')).json();
  ok(r.status === 200 && j.q.meia === 7, 'estoque: depois que o dono salva, o site ja le a quantidade nova');
  /* nomes que todo objeto tem (constructor, toString) nao viram chave de estoque */
  r = await chamar(w, '/estoque', { metodo: 'POST', corpo: { loja: 'roupas-teste', q: { constructor: 5, toString: 3, hasOwnProperty: 1 } }, headers: { Authorization: DONO } });
  j = await (await chamar(w, '/estoque/roupas-teste')).json();
  ok(r.status === 422 && !Object.prototype.hasOwnProperty.call(j.q, 'constructor') && !Object.prototype.hasOwnProperty.call(j.q, 'toString'), 'estoque: "constructor" e "toString" nao viram quantidade');

  /* 2. devolver estoque de loja inventada: nem le o banco */
  w = await workerNovo();
  zerar();
  r = await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'loja-que-nao-existe', pedido: 'AAAAAAAAAAAAAAAAAAAA' }, headers: { 'CF-Connecting-IP': '198.51.100.7' } });
  j = await r.json();
  ok(r.status === 200 && j.ok === false && conta.leituras === 0, 'devolver estoque de loja que a borda nao conhece: 0 leituras');
  /* pedido inventado de loja de verdade: depois de 30 "nao existe", para de ler */
  zerar();
  let barrados = 0;
  for (let i = 0; i < 40; i++) {
    const pid = 'Z' + String(i).padStart(19, '0');
    r = await chamar(w, '/estoque/devolver', { metodo: 'POST', corpo: { loja: 'roupas-teste', pedido: pid }, headers: { 'CF-Connecting-IP': '198.51.100.8' } });
    if (r.status === 429) barrados++;
  }
  ok(barrados >= 9 && conta.leituras <= 32, 'devolver estoque com pedido inventado: depois de 30, 429 sem ler (' + conta.leituras + ' leituras em 40)');

  /* 3. loja inventada que ja esta na memoria tambem passa pelo limite (antes, depois de 15 s, lia o banco de novo) */
  w = await workerNovo();
  const ipX = '198.51.100.9';
  for (let i = 0; i < 30; i++) await chamar(w, '/loja/inventada-' + i, { headers: { 'CF-Connecting-IP': ipX } });
  const relogio = Date.now;
  Date.now = () => relogio() + 20 * 1000;
  try {
    zerar();
    for (let volta = 0; volta < 3; volta++) for (let i = 0; i < 30; i++) await chamar(w, '/loja/inventada-' + i, { headers: { 'CF-Connecting-IP': ipX } });
    ok(conta.leituras === 0, 'loja inventada repetida depois de 15 s: o mesmo endereco nao le mais o banco (' + conta.leituras + ' leituras em 90)');
    zerar();
    r = await chamar(w, '/loja/inventada-0', { headers: { 'CF-Connecting-IP': '198.51.100.10' } });
    ok(r.status === 404 && conta.leituras <= 1, 'outro endereco ainda pode conferir a loja (no maximo 1 leitura)');
    zerar();
    r = await chamar(w, '/loja/roupas-teste', { headers: { 'CF-Connecting-IP': ipX } });
    ok(r.status === 200, 'loja de verdade continua abrindo para quem ja errou muito');
  } finally { Date.now = relogio; }
}
console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
