import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const { default: worker } = await import(url.pathToFileURL(path.join(aqui, '..', 'ferramentas', 'worker-asaas.js')).href);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'proj', client_email: 'sa@proj.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
/* sem PRECOS: valem os precos de dentro do arquivo (R$ 39,90 e R$ 399) */
const env = { ASAAS_KEY: 'chave', ASAAS_WEBHOOK: 'tokenDoWebhook123', FIREBASE_SA: JSON.stringify(SA), SEM_ESPERA: '1', EMAIL_URL: 'https://script.google.com/macros/s/abc123/exec', EMAIL_TOKEN: 'senhaDoEmail12345678901234567890' };

let total = 0, falhas = 0;
function ok(cond, nome) { total++; if (!cond) falhas++; console.log((cond ? '  ok  ' : '  FALHOU  ') + nome); }

/* ---- banco de mentira (Firestore pela REST) ---- */
const db = new Map();
const versoes = new Map();
const versaoDe = (cam) => '2026-11-15T12:00:00.' + String(versoes.get(cam) || 0).padStart(6, '0') + 'Z';
const mudou = (cam) => versoes.set(cam, (versoes.get(cam) || 0) + 1);
const BASE = 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/';
function aplicarMascara(atual, corpo, mascara) {
  mascara.forEach((m) => {
    const partes = m.split('.');
    let a = atual, c = corpo;
    for (let i = 0; i < partes.length - 1; i++) {
      if (!a[partes[i]] || typeof a[partes[i]] !== 'object') a[partes[i]] = {};
      a = a[partes[i]]; c = c && typeof c === 'object' ? c[partes[i]] : undefined;
    }
    const k = partes[partes.length - 1];
    a[k] = c && typeof c === 'object' && k in c ? c[k] : null;
  });
  return atual;
}
function paraFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFs) } };
  const f = {}; Object.keys(v).forEach((k) => { f[k] = paraFs(v[k]); }); return { mapValue: { fields: f } };
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

/* ---- Asaas de mentira ---- */
const clientes = new Map();      /* id -> cliente */
const assinaturas = new Map();   /* id -> assinatura */
const cobrancas = new Map();     /* id -> cobranca */
const chamadas = [];             /* tudo o que o worker pediu ao Asaas (menos GET) */
const perguntas = [];            /* os GET */
let seq = 0;
let pixFalha = false, semCobranca = false, chavesPix = 1, putFalha = false;
/* o aviso (webhook) cadastrado no Asaas, a situacao da conta e os links de pagamento ligados */
const avisos = [{ id: 'wh-1', url: 'https://ligeiro-asaas.exemplo.workers.dev', enabled: true, interrupted: false, events: ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'] }, { id: 'wh-2', url: 'https://outro.sistema.com/aviso', enabled: true, interrupted: true, events: ['PAYMENT_RECEIVED'] }];
const contaAsaas = { id: 'acc', commercialInfo: 'APPROVED', bankAccountInfo: 'APPROVED', documentation: 'APPROVED', general: 'APPROVED' };
const linksAsaas = [
  { id: 'l1', name: 'Mensal antigo', value: 89, active: true, deleted: false, chargeType: 'RECURRENT' },
  { id: 'l2', name: 'Fundador antigo', value: 69.9, active: true, deleted: false, chargeType: 'RECURRENT' },
  { id: 'l3', name: 'Mensal de agora', value: 39.9, active: true, deleted: false, chargeType: 'RECURRENT' },
  { id: 'l4', name: 'Loja personalizada', value: 149, active: true, deleted: false, chargeType: 'DETACHED' },
  { id: 'l5', name: 'Anual antigo desligado', value: 890, active: false, deleted: false, chargeType: 'RECURRENT' },
];
/* o KV de mentira (so para guardar o resultado da conferencia de todo dia) */
const kv = { m: new Map(), async get(k, tipo) { const v = this.m.get(k); return v === undefined ? null : (tipo === 'json' ? JSON.parse(v) : v); }, async put(k, v) { this.m.set(k, String(v)); }, async delete(k) { this.m.delete(k); } };
const PIX = '00020126580014br.gov.bcb.pix0136aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee5204000053039865405';
function novaCobrancaDa(a) {
  const id = 'pay_' + (++seq);
  const c = { id: id, status: 'PENDING', value: a.value, dueDate: a.nextDueDate, customer: a.customer, subscription: a.id, billingType: a.billingType, invoiceUrl: 'https://www.asaas.com/i/' + id };
  cobrancas.set(id, c);
  return c;
}
const resposta = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
const emails = [];
const logins = new Map();
function tokenDe(email, verificado) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({ aud: 'proj', iss: 'https://securetoken.google.com/proj', sub: email }) + '.assinatura';
  logins.set(t, { email: email, emailVerified: verificado !== false });
  return t;
}

globalThis.fetch = async (u, o) => {
  o = o || {};
  const endereco = String(u);
  if (endereco === 'https://oauth2.googleapis.com/token') return resposta({ access_token: 'tok' });
  if (endereco === 'https://identitytoolkit.googleapis.com/v1/accounts:lookup') {
    const q = logins.get(JSON.parse(o.body).idToken);
    return q ? resposta({ users: [q] }) : resposta({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
  }
  if (endereco.indexOf('https://api.asaas.com/v3/') === 0) {
    if (!((o.headers || {})['User-Agent'])) return resposta({ errors: [{ code: 'invalid_user_agent' }] }, 400);
    const metodo = o.method || 'GET';
    const inteiro = endereco.slice('https://api.asaas.com/v3'.length);
    const corpo = o.body ? JSON.parse(o.body) : null;
    if (metodo !== 'GET') chamadas.push({ metodo, cam: inteiro, corpo }); else perguntas.push(inteiro);
    const [cam, busca] = inteiro.split('?');
    const q = new URLSearchParams(busca || '');
    const partes = cam.split('/').map(decodeURIComponent);
    if (partes[1] === 'pix' && partes[2] === 'addressKeys') return resposta({ totalCount: chavesPix, data: chavesPix ? [{ id: 'k1', status: 'ACTIVE' }] : [] });
    if (partes[1] === 'customers' && partes.length === 2) {
      if (metodo === 'POST') {
        if (!corpo.name || !corpo.cpfCnpj) return resposta({ errors: [{ code: 'invalid_cpfCnpj' }] }, 400);
        if ('mobilePhone' in corpo && !corpo.mobilePhone) return resposta({ errors: [{ code: 'invalid_mobilePhone' }] }, 400);
        const id = 'cus_' + (++seq);
        clientes.set(id, Object.assign({ id: id }, corpo));
        return resposta(clientes.get(id));
      }
      const email = q.get('email');
      return resposta({ data: [...clientes.values()].filter((c) => !email || c.email === email) });
    }
    if (partes[1] === 'customers') {
      const c = clientes.get(partes[2]);
      if (!c) return resposta({ errors: [] }, 404);
      if (metodo === 'POST' || metodo === 'PUT') Object.assign(c, corpo);
      return resposta(c);
    }
    if (partes[1] === 'subscriptions' && partes.length === 2) {
      if (metodo === 'POST') {
        for (const k of ['customer', 'billingType', 'value', 'nextDueDate', 'cycle']) if (corpo[k] == null || corpo[k] === '') return resposta({ errors: [{ code: 'invalid_' + k }] }, 400);
        if (!clientes.has(corpo.customer)) return resposta({ errors: [{ code: 'invalid_customer' }] }, 400);
        const id = 'sub_' + (++seq);
        const a = Object.assign({ id: id, status: 'ACTIVE', deleted: false, dateCreated: '2026-11-15' }, corpo);
        assinaturas.set(id, a);
        if (!semCobranca) novaCobrancaDa(a);
        return resposta(a);
      }
      const cli = q.get('customer');
      return resposta({ data: [...assinaturas.values()].filter((a) => !cli || a.customer === cli) });
    }
    if (partes[1] === 'subscriptions') {
      const a = assinaturas.get(partes[2]);
      if (!a || (a.deleted && metodo !== 'GET')) return resposta({ errors: [] }, 404);
      if (partes[3] === 'payments') return resposta({ data: [...cobrancas.values()].filter((c) => c.subscription === a.id) });
      if (a.deleted) return resposta({ errors: [] }, 404);
      if (metodo === 'PUT') {
        if (putFalha) return resposta({ errors: [{ code: 'invalid_action' }] }, 400);
        ['value', 'cycle', 'billingType'].forEach((k) => { if (corpo[k] !== undefined) a[k] = corpo[k]; });
        /* como o Asaas: com updatePendingPayments, as cobrancas pendentes mudam junto */
        if (corpo.updatePendingPayments) [...cobrancas.values()].filter((c) => c.subscription === a.id && (c.status === 'PENDING' || c.status === 'OVERDUE')).forEach((c) => { c.value = a.value; c.billingType = a.billingType; });
        return resposta(a);
      }
      if (metodo === 'DELETE') { a.deleted = true; [...cobrancas.values()].filter((c) => c.subscription === a.id && c.status === 'PENDING').forEach((c) => { c.deleted = true; }); return resposta({ deleted: true, id: a.id }); }
      return resposta(a);
    }
    if (partes[1] === 'webhooks' && partes.length === 2) return resposta({ data: avisos });
    if (partes[1] === 'webhooks') {
      const w = avisos.find((x) => x.id === partes[2]);
      if (!w) return resposta({ errors: [] }, 404);
      if (metodo === 'PUT') Object.assign(w, corpo);
      return resposta(w);
    }
    if (partes[1] === 'myAccount') return resposta(contaAsaas);
    if (partes[1] === 'paymentLinks') return resposta({ data: linksAsaas.filter((l) => q.get('active') !== 'true' || l.active) });
    /* a lista de cobrancas, com os filtros que o mensageiro usa (cliente, assinatura e vencimento a partir de) */
    if (partes[1] === 'payments' && partes.length === 2 && metodo === 'GET') {
      const cli = q.get('customer'), sub = q.get('subscription'), de = q.get('dueDate[ge]');
      return resposta({ data: [...cobrancas.values()].filter((c) => (!cli || c.customer === cli) && (!sub || c.subscription === sub) && (!de || !c.dueDate || c.dueDate >= de)) });
    }
    if (partes[1] === 'payments') {
      const c = cobrancas.get(partes[2]);
      if (!c) return resposta({ errors: [] }, 404);
      if (partes[3] === 'pixQrCode') {
        if (pixFalha || c.billingType === 'CREDIT_CARD') return resposta({ errors: [{ code: 'invalid_action' }] }, 400);
        return resposta({ encodedImage: 'iVBOR', payload: PIX + c.id, expirationDate: '2027-11-15 23:59:59' });
      }
      return resposta(c);
    }
    return resposta({ errors: [] }, 404);
  }
  if (endereco.indexOf('https://script.google.com/macros/s/') === 0) {
    const c = JSON.parse(o.body);
    if (c.token !== env.EMAIL_TOKEN) return resposta({ ok: false, erro: 'token' });
    emails.push(c);
    return resposta({ ok: true });
  }
  if (endereco === BASE.replace(/\/$/, '') + ':runQuery') {
    const q = JSON.parse(o.body).structuredQuery;
    if (q.from[0].collectionId === 'contas') {
      /* faixa (plano.pagoAte entre dois dias): a conferencia de todo dia */
      if (q.where.compositeFilter) {
        const fs2 = q.where.compositeFilter.filters.map((x) => x.fieldFilter);
        const ler = (d) => fs2[0].field.fieldPath.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), d);
        const dentro = [...db.entries()].filter(([k, d]) => k.indexOf('contas/') === 0 && typeof ler(d) === 'string' && fs2.every((f) => (f.op === 'GREATER_THAN_OR_EQUAL' ? ler(d) >= f.value.stringValue : ler(d) <= f.value.stringValue)))
          .map(([k, d]) => ({ document: { name: BASE + 'contas/' + encodeURIComponent(k.slice(7)), fields: paraFs(d).mapValue.fields } }));
        return resposta(dentro.length ? dentro : [{}]);
      }
      const f = q.where.fieldFilter;
      const pegar = (d) => f.field.fieldPath.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), d);
      const valores = f.value.arrayValue.values.map((v) => v.stringValue);
      const achadas = [...db.entries()].filter(([k, d]) => k.indexOf('contas/') === 0 && valores.indexOf(pegar(d)) >= 0)
        .map(([k, d]) => ({ document: { name: BASE + 'contas/' + encodeURIComponent(k.slice(7)), fields: paraFs(d).mapValue.fields } }));
      return resposta(achadas.length ? achadas : [{}]);
    }
    const valor = q.where.fieldFilter.value.stringValue;
    const linhas = [...db.entries()].filter(([k, d]) => k.indexOf('lojas/') === 0 && d.donoEmail === valor).map(([k]) => ({ document: { name: BASE + k, fields: {} } }));
    return resposta(linhas.length ? linhas : [{}]);
  }
  if (endereco === BASE.replace(/\/$/, '') + ':commit') {
    const writes = JSON.parse(o.body).writes || [];
    const prefixo = 'projects/proj/databases/(default)/documents/';
    for (const wr of writes) {
      const cam = wr.update.name.slice(prefixo.length);
      const cd = wr.currentDocument || {};
      if (cd.exists === false && db.has(cam)) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
      if (cd.updateTime && (!db.has(cam) || cd.updateTime !== versaoDe(cam))) return resposta({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
    }
    for (const wr of writes) {
      const cam = wr.update.name.slice(prefixo.length);
      const corpo = deFs({ mapValue: { fields: wr.update.fields || {} } });
      db.set(cam, wr.updateMask ? aplicarMascara(db.get(cam) || {}, corpo, wr.updateMask.fieldPaths || []) : corpo);
      mudou(cam);
    }
    return resposta({ writeResults: writes.map(() => ({})) });
  }
  if (endereco.indexOf(BASE) === 0) {
    const cam = decodeURIComponent(endereco.slice(BASE.length).split('?')[0]);
    if (o.method === 'DELETE') { db.delete(cam); mudou(cam); return resposta({}); }
    if ((o.method || 'GET') === 'GET') {
      const d = db.get(cam);
      return d ? resposta({ fields: paraFs(d).mapValue.fields, updateTime: versaoDe(cam) }) : resposta({}, 404);
    }
    if (o.method === 'PATCH') {
      const mascara = new URL(endereco).searchParams.getAll('updateMask.fieldPaths');
      const corpo = deFs({ mapValue: { fields: JSON.parse(o.body).fields } });
      db.set(cam, aplicarMascara(db.get(cam) || {}, corpo, mascara));
      mudou(cam);
      return resposta({});
    }
  }
  throw new Error('endereco que o teste nao conhece: ' + endereco);
};

/* ---- contador de subrequests (cada fetch do worker) ---- */
const fetchReal = globalThis.fetch;
export const cont = { n: 0, porHost: {} , limite: Infinity };
globalThis.fetch = async (u, o) => { cont.n++; const h = new URL(String(u)).host; cont.porHost[h] = (cont.porHost[h]||0)+1; if (cont.n > cont.limite) throw new Error("Too many subrequests"); return fetchReal(u, o); };
export const webhook = (evento, pag, e) => worker.fetch(new Request("https://w/", { method: "POST", headers: { "Content-Type": "application/json", "asaas-access-token": (e||env).ASAAS_WEBHOOK }, body: JSON.stringify({ event: evento, payment: pag }) }), e || env);
export const pedir = async (rota, token, corpo, e) => { const r = await worker.fetch(new Request("https://w/plano/" + rota, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, Origin: "https://ligeiropedidos.com.br" }, body: JSON.stringify(corpo || {}) }), e || env); return { status: r.status, j: await r.json() }; };
export { worker, env, db, versoes, mudou, clientes, assinaturas, cobrancas, chamadas, perguntas, emails, logins, tokenDe, kv, avisos, novaCobrancaDa, linksAsaas };
