/*
 * Teste do pagamento pelo painel (ferramentas/worker-asaas.js: /plano/pagar, /plano/conferir, lembrete do teste gratis e
 * os precos dentro do arquivo), sem internet: o Asaas, o Google e o banco sao de mentira.
 * Rodar com:  node testes/pagar.test.mjs
 */
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

/* ---- ajudas ---- */
const DIA = 864e5;
const hojeBrasilia = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const diaBrasilia = (ms) => new Date(ms - 3 * 36e5).toISOString().slice(0, 10);
function conta(email, plano, extra) {
  db.set('contas/' + email, Object.assign({ email: email, nome: 'Dona Jaci', lojaCriadaEm: '2026-11-01T00:00:00.000Z', plano: Object.assign({ status: 'teste', tipo: 'mensal', planoId: 'uma' }, plano) }, extra || {}));
  mudou('contas/' + email);
  db.set('lojas/loja-' + email.split('@')[0], { donoEmail: email, plano: {} });
  return tokenDe(email);
}
const contaDe = (email) => db.get('contas/' + email);
async function pedir(rota, token, corpo, envUsado) {
  const r = await worker.fetch(new Request('https://w/plano/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, Origin: 'https://ligeiropedidos.com.br' }, body: JSON.stringify(corpo || {}) }), envUsado || env);
  return { status: r.status, j: await r.json() };
}
const criadas = () => chamadas.filter((c) => c.metodo === 'POST' && c.cam === '/subscriptions');
const vivasDe = (email) => [...assinaturas.values()].filter((a) => !a.deleted && clientes.get(a.customer) && clientes.get(a.customer).email === email);
const CPF = '52998224725';

/* ================= os precos moram no arquivo ================= */
let r = await worker.fetch(new Request('https://w/saude'), env);
let j = await r.json();
ok(j.precos.mensal === 3990 && j.precos.anual === 39900 && j.planosCertos === true, 'precos de dentro do arquivo: R$ 39,90 por mes e R$ 399 por ano, sem segredo nenhum');
ok(/^\d{4}-\d{2}-\d{2}$/.test(j.versao) && j.recursos.indexOf('pagar') >= 0 && j.chavePix === true, '/saude diz a versao, que sabe gerar o pagamento e que a conta tem chave Pix');
ok(JSON.stringify(j).indexOf('chave') < 0 || JSON.stringify(j).indexOf(env.ASAAS_KEY + '"') < 0, '/saude nao mostra a chave do Asaas');
ok(j.avisoDoAsaas === 'ok' && j.contaAprovada === true && j.recursos.indexOf('historico') >= 0, '/saude: o aviso do Asaas esta ligado (o de outro sistema, parado, nao conta), a conta esta aprovada e o mensageiro sabe mostrar os pagamentos');
ok(j.linksForaDoPreco === 2 && JSON.stringify(j).indexOf('Mensal antigo') < 0 && JSON.stringify(j).indexOf('workers.dev') < 0, '/saude: conta 2 links de assinatura ligados com preco antigo (o de R$ 39,90, o avulso e o desligado nao contam), sem mostrar nome nem endereco');
/* os precos do site e os do mensageiro sao os mesmos (mudou um, muda o outro) */
const cfgTxt = fs.readFileSync(path.join(aqui, '..', 'js', 'config.js'), 'utf8');
const mPrecos = /precos:\s*\{\s*mensal:\s*(\d+),\s*anual:\s*(\d+)/.exec(cfgTxt);
ok(!!mPrecos && Number(mPrecos[1]) === j.precos.mensal && Number(mPrecos[2]) === j.precos.anual, 'js/config.js e o mensageiro cobram o mesmo preco');
r = await worker.fetch(new Request('https://w/saude'), Object.assign({}, env, { PLANOS: '{"uma":{"mensal":8900,"anual":89000,"fm":6990,"fa":69900}}' }));
j = await r.json();
ok(j.precos.mensal === 3990, 'o segredo PLANOS antigo (R$ 89) nao e mais lido: fica o preco novo');

/* ================= primeira vez: so o CPF, e o Pix aparece ================= */
const agora = Date.now();
const tA = conta('a@x.com', { desde: new Date(agora - 2 * DIA).toISOString() });
let p = await pedir('pagar', tA, { forma: 'pix' });
ok(p.status === 200 && p.j.ok === false && p.j.precisaDocumento === true && clientes.size === 0 && assinaturas.size === 0, 'sem CPF: pede o CPF ou CNPJ e nao cria nada no Asaas');
p = await pedir('pagar', tA, { forma: 'pix', documento: '11111111111' });
ok(p.status === 400 && /inválido/.test(p.j.erro) && clientes.size === 0, 'CPF inventado: recusa e nao cria nada');
p = await pedir('pagar', tA, { forma: 'pix', documento: '529.982.247-25' });
const cliA = [...clientes.values()][0];
const subA = [...assinaturas.values()][0];
ok(p.status === 200 && p.j.ok === true && p.j.valor === 3990 && p.j.tipo === 'mensal' && p.j.pix && p.j.pix.codigo.indexOf(PIX) === 0 && /^https:\/\/www\.asaas\.com\/i\//.test(p.j.fatura), 'com o CPF: devolve o Pix copia e cola de R$ 39,90 e o endereco da fatura');
ok(cliA.email === 'a@x.com' && cliA.cpfCnpj === CPF && cliA.notificationDisabled === true && !('mobilePhone' in cliA) && cliA.name === 'Dona Jaci', 'o cliente nasce no Asaas com o e-mail da conta (ninguem digita e-mail), o CPF e sem os avisos pagos do Asaas');
ok(subA.billingType === 'UNDEFINED' && subA.value === 39.9 && subA.cycle === 'MONTHLY' && subA.customer === cliA.id, 'a assinatura nasce mensal, de R$ 39,90, aceitando Pix, boleto e cartao');
ok(subA.nextDueDate === diaBrasilia(agora + 5 * DIA), 'no meio do teste gratis, a primeira cobranca vence no dia em que o gratis acaba (nao vira "venceu" amanha)');
let cA = contaDe('a@x.com');
ok(cA.assinaturaPendente === subA.id && cA.faturaAsaas.id === p.j.cobranca && cA.faturaAsaas.valor === 3990 && cA.faturaAsaas.status === 'PENDING' && cA.faturaAsaas.assinatura === subA.id && cA.plano.status === 'teste', 'a conta guarda a assinatura (pendente) e a fatura; nenhum dia e liberado so por pedir');
const cobA = p.j.cobranca;

/* de novo (fechou e abriu a janela): a mesma assinatura e a mesma cobranca */
p = await pedir('pagar', tA, { forma: 'pix' });
ok(p.j.ok && p.j.cobranca === cobA && criadas().length === 1 && clientes.size === 1, 'abrir a janela de novo: a mesma cobranca, nenhuma assinatura a mais e sem pedir o CPF outra vez');

/* trocou para o anual antes de pagar: a assinatura que nunca pagou sai e nasce a anual (uma viva so, sempre) */
p = await pedir('pagar', tA, { forma: 'pix', tipo: 'anual' });
let vivaA = vivasDe('a@x.com');
ok(p.j.ok && p.j.valor === 39900 && p.j.tipo === 'anual' && subA.deleted === true && vivaA.length === 1 && vivaA[0].value === 399 && vivaA[0].cycle === 'YEARLY' && contaDe('a@x.com').plano.tipo === 'anual' && contaDe('a@x.com').assinaturaPendente === vivaA[0].id, 'escolheu o anual antes de pagar: a mensal sai e fica uma assinatura so, de R$ 399 por ano');
ok(contaDe('a@x.com').assinaturasAntigas.indexOf(subA.id) >= 0 && vivaA[0].nextDueDate === diaBrasilia(agora + 5 * DIA), 'a que saiu fica anotada como antiga, e a nova vence no mesmo dia (o fim do gratis)');
p = await pedir('pagar', tA, { forma: 'pix', tipo: 'mensal' });
vivaA = vivasDe('a@x.com');
ok(p.j.valor === 3990 && vivaA.length === 1 && vivaA[0].cycle === 'MONTHLY' && contaDe('a@x.com').plano.tipo === 'mensal', 'voltou para o mensal: R$ 39,90 de novo, uma assinatura so');

/* cartao: nasce a assinatura de cartao e o dono vai para a fatura */
p = await pedir('pagar', tA, { forma: 'cartao' });
vivaA = vivasDe('a@x.com');
ok(p.j.ok && p.j.pix === null && /^https:\/\/www\.asaas\.com\/i\//.test(p.j.fatura) && vivaA.length === 1 && vivaA[0].billingType === 'CREDIT_CARD' && contaDe('a@x.com').faturaAsaas.forma === 'CREDIT_CARD', 'cartao: a assinatura passa a ser de cartao (as proximas caem sozinhas) e vem o endereco da fatura');
p = await pedir('pagar', tA, { forma: 'pix' });
vivaA = vivasDe('a@x.com');
ok(p.j.ok && p.j.pix && vivaA.length === 1 && vivaA[0].billingType === 'UNDEFINED', 'desistiu do cartao e quis o Pix: a assinatura volta a aceitar Pix e o codigo aparece');
const subA2 = vivaA[0];
const cobA2 = p.j.cobranca;

/* "Ja paguei" antes de pagar: nada muda */
let c = await pedir('conferir', tA, { cobranca: cobA2 });
ok(c.status === 200 && c.j.pago === false && contaDe('a@x.com').plano.status === 'teste', '"Ja paguei" sem ter pago: continua esperando, nenhum dia entra');
/* pagou: "Ja paguei" libera na hora, sem esperar o aviso do Asaas */
cobrancas.get(cobA2).status = 'RECEIVED';
c = await pedir('conferir', tA, { cobranca: cobA2 });
cA = contaDe('a@x.com');
const fimGratisA = agora - 2 * DIA + 7 * DIA;
ok(c.j.pago === true && cA.plano.status === 'ativo' && cA.assinaturaAsaas === subA2.id && !cA.assinaturaPendente && cA.faturaAsaas === null, 'pagou e tocou em "Ja paguei": a conta fica ativa na hora, a assinatura vira a da conta e a fatura some');
ok(Math.abs(Date.parse(cA.plano.pagoAte) - new Date(fimGratisA).setUTCMonth(new Date(fimGratisA).getUTCMonth() + 1)) < 5000, 'os dias gratis que faltavam nao se perdem: o mes pago conta depois deles');
ok(db.get('lojas/loja-a').plano.status === 'ativo', 'a loja destrava junto (o plano vai para a copia da loja)');
ok(emails.filter((m) => m.para === 'a@x.com' && /Pagamento confirmado/.test(m.assunto)).length === 1, 'o dono recebe o e-mail de pagamento confirmado');
/* o aviso do Asaas chega depois: nao soma de novo */
const pagoAteA = cA.plano.pagoAte;
r = await worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': env.ASAAS_WEBHOOK }, body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: cobA2, customer: cliA.id } }) }), env);
ok(r.status === 200 && contaDe('a@x.com').plano.pagoAte === pagoAteA && emails.filter((m) => m.para === 'a@x.com').length === 1, 'o aviso do Asaas chega depois: os dias nao somam duas vezes e nao vai outro e-mail');
const perguntasAntes = perguntas.length;
c = await pedir('conferir', tA, { cobranca: cobA2 });
ok(c.j.pago === true && perguntas.length === perguntasAntes, '"Ja paguei" de novo: responde que sim sem perguntar nada ao Asaas');
/* em dia e sem nada em aberto: nao ha o que pagar */
const criadasAntesEmDia = criadas().length;
p = await pedir('pagar', tA, { forma: 'pix' });
ok(p.status === 200 && p.j.ok === true && p.j.emDia === true && criadas().length === criadasAntesEmDia && vivasDe('a@x.com').length === 1, 'em dia e sem fatura aberta: "nada a pagar", e nenhuma assinatura nova');
/* a mensalidade do mes seguinte abriu: o Pix dela sai pelo mesmo botao */
const mes2 = novaCobrancaDa(subA2);
p = await pedir('pagar', tA, { forma: 'pix', tipo: 'anual' });
ok(p.j.ok && p.j.cobranca === mes2.id && p.j.valor === 3990 && p.j.tipo === 'mensal' && subA2.cycle === 'MONTHLY' && contaDe('a@x.com').assinaturaAsaas === subA2.id, 'mensalidade seguinte: o Pix da fatura aberta, e o ciclo de quem ja paga nao muda por aqui (so pelo Mudar de plano)');

/* ================= teste que ja acabou (a loja parada): vence hoje ================= */
const tB = conta('b@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
p = await pedir('pagar', tB, { forma: 'pix', documento: CPF, tipo: 'mensal' });
const subB = [...assinaturas.values()].find((a) => clientes.get(a.customer).email === 'b@x.com');
ok(p.j.ok && subB.nextDueDate === hojeBrasilia() && p.j.vencimento === hojeBrasilia(), 'teste gratis ja acabou: a cobranca vence hoje');
cobrancas.get(p.j.cobranca).status = 'CONFIRMED';
c = await pedir('conferir', tB, {});
ok(c.j.pago === true && contaDe('b@x.com').plano.status === 'ativo' && Date.parse(contaDe('b@x.com').plano.pagoAte) > agora + 27 * DIA, 'pagou depois do teste: "Ja paguei" sem dizer a cobranca acha a fatura da conta e libera um mes a partir de hoje');

/* ================= assinatura antiga, do preco velho, que nunca pagou ================= */
const tC = conta('c@x.com', { desde: new Date(agora - 40 * DIA).toISOString() });
clientes.set('cus_velho', { id: 'cus_velho', email: 'c@x.com', cpfCnpj: CPF, name: 'C' });
assinaturas.set('sub_velha', { id: 'sub_velha', status: 'ACTIVE', deleted: false, customer: 'cus_velho', billingType: 'UNDEFINED', value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-10-16', dateCreated: '2026-10-10' });
const cobVelha = novaCobrancaDa(assinaturas.get('sub_velha')); cobVelha.status = 'OVERDUE';
db.get('contas/c@x.com').assinaturaPendente = 'sub_velha';
const antesC = criadas().length;
p = await pedir('pagar', tC, { forma: 'pix' });
ok(p.j.ok && p.j.valor === 3990 && assinaturas.get('sub_velha').deleted === true && criadas().length === antesC + 1 && vivasDe('c@x.com').length === 1 && vivasDe('c@x.com')[0].value === 39.9 && contaDe('c@x.com').assinaturasAntigas.indexOf('sub_velha') >= 0, 'assinatura do preco antigo (R$ 69,90) que nunca pagou: sai, e nasce a de R$ 39,90, sem pedir CPF de novo');

/* ================= assinatura solta (o pedido anterior caiu no meio) ================= */
const tD = conta('d@x.com', { desde: new Date(agora - 40 * DIA).toISOString() });
clientes.set('cus_d', { id: 'cus_d', email: 'd@x.com', cpfCnpj: CPF, name: 'D', notificationDisabled: true });
assinaturas.set('sub_solta', { id: 'sub_solta', status: 'ACTIVE', deleted: false, customer: 'cus_d', billingType: 'UNDEFINED', value: 39.9, cycle: 'MONTHLY', nextDueDate: hojeBrasilia(), dateCreated: '2026-11-14' });
const cobSolta = novaCobrancaDa(assinaturas.get('sub_solta'));
const antesD = criadas().length;
p = await pedir('pagar', tD, { forma: 'pix' });
ok(p.j.ok && p.j.cobranca === cobSolta.id && criadas().length === antesD && contaDe('d@x.com').assinaturaPendente === 'sub_solta', 'assinatura viva do mesmo cliente que a conta nao conhecia: e usada, nao nasce outra');

/* ================= a assinatura da conta sumiu no Asaas ================= */
const tE = conta('e@x.com', { desde: new Date(agora - 60 * DIA).toISOString(), pagoAte: new Date(agora - 20 * DIA).toISOString(), status: 'ativo', ultimoPagamentoEm: new Date(agora - 50 * DIA).toISOString() }, { assinaturaAsaas: 'sub_sumiu' });
clientes.set('cus_e', { id: 'cus_e', email: 'e@x.com', cpfCnpj: CPF, name: 'E' });
const antesE = criadas().length;
p = await pedir('pagar', tE, { forma: 'pix' });
const cE = contaDe('e@x.com');
ok(p.j.ok && criadas().length === antesE + 1 && cE.assinaturaAsaas === '' && cE.assinaturasAntigas.indexOf('sub_sumiu') >= 0 && cE.assinaturaPendente && cE.assinaturaPendente !== 'sub_sumiu', 'a assinatura da conta nao existe mais no Asaas: vai para as antigas e nasce uma nova');
ok(criadas()[criadas().length - 1].corpo.nextDueDate === hojeBrasilia(), 'conta vencida: a cobranca nova vence hoje');

/* ================= quem ja paga no cartao e o cartao nao passou: paga a mesma fatura no Pix ================= */
const tK = conta('k@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora - 3 * DIA).toISOString(), ultimoPagamentoEm: new Date(agora - 33 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_k', pagamentos: ['pay_k_antiga'] });
clientes.set('cus_k', { id: 'cus_k', email: 'k@x.com', cpfCnpj: CPF, name: 'K' });
assinaturas.set('sub_k', { id: 'sub_k', status: 'ACTIVE', deleted: false, customer: 'cus_k', billingType: 'CREDIT_CARD', value: 39.9, cycle: 'MONTHLY', nextDueDate: '2026-12-12' });
const cobK = novaCobrancaDa(assinaturas.get('sub_k')); cobK.status = 'OVERDUE'; cobK.dueDate = diaBrasilia(agora - 3 * DIA);
const antesK = criadas().length;
p = await pedir('pagar', tK, { forma: 'pix', tipo: 'anual' });
ok(p.j.ok && p.j.cobranca === cobK.id && p.j.pix && p.j.tipo === 'mensal' && assinaturas.get('sub_k').billingType === 'UNDEFINED' && assinaturas.get('sub_k').deleted === false && criadas().length === antesK && contaDe('k@x.com').assinaturaAsaas === 'sub_k', 'o cartao nao passou e a mensalidade venceu: a MESMA assinatura passa a aceitar Pix e o codigo da fatura vencida aparece (nenhuma assinatura nova, o plano nao muda)');
cobK.status = 'RECEIVED';
c = await pedir('conferir', tK, { cobranca: cobK.id });
ok(c.j.pago === true && contaDe('k@x.com').plano.status === 'ativo' && Date.parse(contaDe('k@x.com').plano.pagoAte) > agora + 20 * DIA && contaDe('k@x.com').assinaturaAsaas === 'sub_k', 'pagou a vencida no Pix: o mes conta do vencimento e a assinatura continua a mesma');
/* o Asaas recusou a mudanca da assinatura paga: o pagamento segue pela fatura (nada trava) */
const tL = conta('l@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora - 3 * DIA).toISOString(), ultimoPagamentoEm: new Date(agora - 33 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_l' });
clientes.set('cus_l', { id: 'cus_l', email: 'l@x.com', cpfCnpj: CPF, name: 'L' });
assinaturas.set('sub_l', { id: 'sub_l', status: 'ACTIVE', deleted: false, customer: 'cus_l', billingType: 'CREDIT_CARD', value: 39.9, cycle: 'MONTHLY' });
const cobL = novaCobrancaDa(assinaturas.get('sub_l')); cobL.status = 'OVERDUE';
putFalha = true;
p = await pedir('pagar', tL, { forma: 'pix' });
putFalha = false;
ok(p.status === 200 && p.j.ok && p.j.cobranca === cobL.id && p.j.pix === null && /^https:\/\/www\.asaas\.com\/i\//.test(p.j.fatura) && assinaturas.get('sub_l').deleted === false, 'o Asaas recusou mudar a assinatura paga: a resposta vem com a fatura dela (da para pagar), e a assinatura nao e apagada');

/* ================= o Asaas nao deu o codigo do Pix ================= */
const tF = conta('f@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
pixFalha = true;
p = await pedir('pagar', tF, { forma: 'pix', documento: CPF });
pixFalha = false;
ok(p.status === 200 && p.j.ok === true && p.j.pix === null && /^https:\/\/www\.asaas\.com\/i\//.test(p.j.fatura), 'o Asaas nao devolveu o codigo do Pix: a resposta vem com a fatura (o painel mostra o botao dela), e nao com erro');

/* ================= o Asaas demorou a gerar a cobranca ================= */
const tG = conta('g@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
semCobranca = true;
p = await pedir('pagar', tG, { forma: 'pix', documento: CPF });
semCobranca = false;
const subG = contaDe('g@x.com').assinaturaPendente;
ok(p.status === 503 && !!subG, 'a cobranca ainda nao apareceu: pede para tocar de novo, e a assinatura ja fica guardada na conta');
novaCobrancaDa(assinaturas.get(subG));
const antesG = criadas().length;
p = await pedir('pagar', tG, { forma: 'pix' });
ok(p.j.ok && p.j.pix && criadas().length === antesG, 'tocou de novo: a mesma assinatura, agora com o Pix (nenhuma criada em dobro)');

/* ================= quem nao pode ================= */
c = await pedir('conferir', tG, { cobranca: cobA2 });
ok(c.status === 200 && c.j.pago === false && contaDe('g@x.com').plano.status === 'teste', '"Ja paguei" com a cobranca de outra conta: responde "ainda nao", igual a cobranca que nao existe, e nada muda');
c = await pedir('conferir', tG, { cobranca: 'pay_nao_existe' });
ok(c.status === 200 && c.j.pago === false, '"Ja paguei" com cobranca que nao existe: so "ainda nao"');
const tAdmin = tokenDe('ligeiro.pedidos@gmail.com');
db.set('contas/ligeiro.pedidos@gmail.com', { plano: { status: 'ativo' } });
p = await pedir('pagar', tAdmin, { forma: 'pix', documento: CPF });
ok(p.status === 400 && criadas().filter((x) => clientes.get(x.corpo.customer).email === 'ligeiro.pedidos@gmail.com').length === 0, 'a conta do Ligeiro nao gera cobranca');
const tEquipe = tokenDe('equipe-loja-a@equipe.ligeiropedidos.com.br');
p = await pedir('pagar', tEquipe, { forma: 'pix' });
ok(p.status === 403, 'login da equipe (cozinha, entregador) nao mexe na assinatura');
p = await pedir('pagar', 'token.que.naoexiste', { forma: 'pix' });
ok(p.status === 401, 'sem login: recusado');
const tPausada = conta('pausada@x.com', { status: 'pausado' });
p = await pedir('pagar', tPausada, { forma: 'pix', documento: CPF });
ok(p.status === 409 && /pausada/.test(p.j.erro), 'conta pausada: fala com o Ligeiro');
const tEncerrada = conta('encerrada@x.com', { status: 'cancelado' });
p = await pedir('pagar', tEncerrada, { forma: 'pix', documento: CPF });
ok(p.status === 409 && /Reativar/.test(p.j.erro), 'conta encerrada: reativa antes de pagar');
/* precos tortos no segredo opcional: nada e gerado */
const tH = conta('h@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
const antesH = criadas().length;
p = await pedir('pagar', tH, { forma: 'pix', documento: CPF }, Object.assign({}, env, { PRECOS: '{"uma":{"mensal":39}}' }));
ok(p.status === 500 && criadas().length === antesH, 'segredo PRECOS digitado errado: nenhuma cobranca nasce com valor errado');
/* muitas tentativas seguidas */
const tI = conta('i@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
let ultimo = null;
for (let i = 0; i < 13; i++) ultimo = await pedir('pagar', tI, { forma: 'pix' });
ok(ultimo.status === 429, 'mais de 12 pedidos em 10 minutos da mesma conta: espera um pouco');

/* ================= o aviso do Asaas (caminho de sempre) com o preco novo ================= */
conta('w@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });
clientes.set('cus_w', { id: 'cus_w', email: 'w@x.com', cpfCnpj: CPF, name: 'W' });
assinaturas.set('sub_w', { id: 'sub_w', status: 'ACTIVE', deleted: false, customer: 'cus_w', billingType: 'PIX', value: 399, cycle: 'YEARLY' });
cobrancas.set('pay_w', { id: 'pay_w', status: 'RECEIVED', value: 399, customer: 'cus_w', subscription: 'sub_w', billingType: 'PIX' });
r = await worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': env.ASAAS_WEBHOOK }, body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_w', customer: 'cus_w' } }) }), env);
const cW = contaDe('w@x.com');
ok(r.status === 200 && cW.plano.status === 'ativo' && cW.plano.tipo === 'anual' && Date.parse(cW.plano.pagoAte) > agora + 360 * DIA && !cW.plano.pagamentoParcial, 'aviso do Asaas de R$ 399: um ano inteiro, sem "pagamento abaixo do plano"');

/* ================= lembrete do teste gratis ================= */
emails.length = 0;
conta('t2@x.com', { desde: new Date(agora - 5.5 * DIA).toISOString() });                       /* faltam 1,5 dia */
conta('tfim@x.com', { desde: new Date(agora - 7.5 * DIA).toISOString() });                     /* acabou ha meio dia */
conta('tnovo@x.com', { desde: new Date(agora - 1 * DIA).toISOString() });                      /* faltam 6 dias */
conta('tvelho@x.com', { desde: new Date(agora - 30 * DIA).toISOString() });                    /* acabou faz tempo */
conta('tfatura@x.com', { desde: new Date(agora - 5.5 * DIA).toISOString() }, { faturaAsaas: { id: 'pay_x', status: 'PENDING', url: 'https://www.asaas.com/i/x', vencimento: '2099-01-01' } });
conta('tsemloja@x.com', { desde: new Date(agora - 5.5 * DIA).toISOString() }, { lojaCriadaEm: '' });
conta('tontem@x.com', { desde: new Date(agora - 20 * 36e5).toISOString() }, { lojaCriadaEm: new Date(agora - 20 * 36e5).toISOString() }); /* criou a loja ontem */
await worker.scheduled({}, env, null);
const passos = emails.filter((m) => /3 passos/.test(m.assunto));
ok(passos.length === 1 && passos[0].para === 'tontem@x.com' && /\/painel\/loja-tontem/.test(passos[0].html) && /Ligue os avisos/.test(passos[0].html) && /ligeiropedidos\.com\.br\/loja-tontem/.test(passos[0].html) && /R\$ 39,90/.test(passos[0].html), 'no dia seguinte a criacao da loja: o e-mail dos 3 passos, com o link da loja e o botao do painel, so para quem criou ontem');
const deTeste = () => emails.filter((m) => /teste grátis/.test(m.assunto));
ok(deTeste().length === 2 && deTeste().some((m) => m.para === 't2@x.com' && /acaba em 2 dias/.test(m.assunto)) && deTeste().some((m) => m.para === 'tfim@x.com' && /acabou/.test(m.assunto)), 'lembrete do teste: "acaba em 2 dias" e "acabou", so para quem esta nessas datas');
ok(deTeste().every((m) => /R\$ 39,90/.test(m.html) && /\/conta/.test(m.html) && /Olá, Dona!/.test(m.html)), 'o lembrete traz o preco, o botao para Minha conta e o nome');
ok(!deTeste().some((m) => ['tnovo@x.com', 'tvelho@x.com', 'tfatura@x.com', 'tsemloja@x.com'].indexOf(m.para) >= 0), 'quem acabou de entrar, quem saiu faz tempo, quem ja tem fatura e quem nao tem loja nao recebem');
await worker.scheduled({}, env, null);
ok(deTeste().length === 2 && contaDe('t2@x.com').lembretesTeste.join() === 'd2' && emails.filter((m) => /3 passos/.test(m.assunto)).length === 1, 'no dia seguinte, o mesmo lembrete nao vai de novo');
/* ================= os pagamentos da conta (Minha conta) ================= */
const tHist = conta('h@x.com', { desde: new Date(agora - 200 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora + 20 * DIA).toISOString(), ultimoPagamentoEm: new Date(agora - 10 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_h' });
clientes.set('cus_h', { id: 'cus_h', email: 'h@x.com', cpfCnpj: CPF, name: 'H' });
clientes.set('cus_h2', { id: 'cus_h2', email: 'h@x.com', cpfCnpj: CPF, name: 'H de novo' });
clientes.set('cus_outro', { id: 'cus_outro', email: 'outro@x.com', cpfCnpj: CPF, name: 'Outro' });
const cob = (id, o) => cobrancas.set(id, Object.assign({ id: id, customer: 'cus_h', subscription: 'sub_h', value: 39.9, billingType: 'PIX', invoiceUrl: 'https://www.asaas.com/i/' + id }, o));
cob('pay_h1', { status: 'RECEIVED', paymentDate: '2026-09-10', clientPaymentDate: '2026-09-09', transactionReceiptUrl: 'https://www.asaas.com/comprovantes/111' });
cob('pay_h2', { status: 'CONFIRMED', billingType: 'CREDIT_CARD', dueDate: '2026-10-10' });
cob('pay_h3', { status: 'REFUNDED', paymentDate: '2026-08-10', transactionReceiptUrl: 'https://golpe.exemplo.com/recibo' });
cob('pay_h4', { status: 'PENDING', dueDate: '2026-12-10' });
cob('pay_h5', { status: 'RECEIVED', paymentDate: '2026-11-01', externalReference: 'srv:video1', value: 149 });
cob('pay_h6', { status: 'RECEIVED', paymentDate: '2026-11-05', deleted: true });
cob('pay_h7', { status: 'RECEIVED', paymentDate: '2026-11-06', customer: 'cus_outro', value: 399 });
cob('pay_h8', { status: 'RECEIVED_IN_CASH', paymentDate: '2026-07-10', customer: 'cus_h2', billingType: 'BOLETO', value: 89, invoiceUrl: 'javascript:alert(1)' });
const antesHist = perguntas.length;
let h = await pedir('historico', tHist);
const hp = h.j.pagamentos || [];
ok(h.status === 200 && h.j.ok === true && hp.map((x) => x.id).join() === 'pay_h2,pay_h1,pay_h3,pay_h8', 'pagamentos: os pagos e o devolvido, do mais novo para o mais velho, dos clientes do Asaas com o e-mail da conta; a fatura em aberto, a compra da Loja do Ligeiro, a apagada e a de outro cliente ficam de fora');
ok(hp[1].dia === '2026-09-09' && hp[1].valor === 3990 && hp[1].forma === 'pix' && hp[1].situacao === 'pago' && hp[1].recibo === 'https://www.asaas.com/comprovantes/111', 'cada pagamento traz o dia em que o cliente pagou, o valor, a forma e o comprovante do Asaas');
ok(hp[0].forma === 'cartao' && hp[0].dia === '2026-10-10' && hp[0].recibo === 'https://www.asaas.com/i/pay_h2', 'cartao confirmado, ainda sem comprovante: vale o dia do vencimento e o endereco da fatura');
ok(hp[2].situacao === 'devolvido' && hp[2].recibo === 'https://www.asaas.com/i/pay_h3' && hp[3].recibo === '' && hp[3].forma === 'boleto' && hp[3].valor === 8900, 'devolvido aparece como devolvido; endereco que nao e do Asaas nunca vai para a tela');
h = await pedir('historico', tHist);
ok(h.j.pagamentos.length === 4 && perguntas.length - antesHist === 3, 'abrir a janela de novo dentro de 1 minuto nao pergunta nada ao Asaas (1 lista de clientes e 2 de cobrancas na primeira vez)');
h = await pedir('historico', tokenDe('novo@x.com'));
ok(h.status === 200 && h.j.ok === true && h.j.pagamentos.length === 0, 'quem nunca pagou: lista vazia, sem erro');
h = await pedir('historico', 'tokeninventado');
ok(h.status === 401 && !h.j.pagamentos, 'sem login: nada');
h = await pedir('historico', tokenDe('equipe-loja@equipe.ligeiropedidos.com.br'));
ok(h.status === 403 && !h.j.pagamentos, 'login da equipe (cozinha, entregador) nao ve os pagamentos do dono');
h = await pedir('historico', tokenDe('ligeiro.pedidos@gmail.com'));
ok(h.status === 200 && h.j.pagamentos.length === 0, 'a conta do Ligeiro nao assina: lista vazia');
/* olhar os pagamentos nao segura o Assinar (fica fora da fila do "um por vez") */
const tHist2 = conta('h2@x.com', { desde: new Date(agora - 2 * DIA).toISOString() });
const [rHist, rPagar] = await Promise.all([pedir('historico', tHist2), pedir('pagar', tHist2, { forma: 'pix', documento: CPF })]);
ok(rHist.status === 200 && rPagar.status === 200 && rPagar.j.ok === true && !!rPagar.j.pix, 'abrir os pagamentos e tocar em Assinar ao mesmo tempo: os dois respondem (nenhum "um instante")');

/* ================= a conferencia de todo dia ================= */
/* as contas dos testes de cima saem: a conferencia olha so as daqui (com mais de 8 na fila, quais entram muda com o dia) */
for (const k of [...db.keys()]) if (k.indexOf('contas/') === 0) db.delete(k);
const emailsDeAntes = emails.slice();
const envKv = Object.assign({}, env, { CARDAPIO: kv });
const doAdmin = (re) => emails.filter((m) => m.para === 'ligeiro.pedidos@gmail.com' && re.test(m.assunto));
/* r1: a mensalidade caiu no cartao e o aviso do Asaas nunca chegou (a loja ia aparecer "vencida") */
conta('r1@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora - 1 * DIA).toISOString(), ultimoPagamentoEm: new Date(agora - 31 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_r1', pagamentos: ['pay_r1_antiga'] });
clientes.set('cus_r1', { id: 'cus_r1', email: 'r1@x.com', cpfCnpj: CPF, name: 'R1' });
assinaturas.set('sub_r1', { id: 'sub_r1', status: 'ACTIVE', deleted: false, customer: 'cus_r1', billingType: 'CREDIT_CARD', value: 39.9, cycle: 'MONTHLY' });
cobrancas.set('pay_r1_antiga', { id: 'pay_r1_antiga', status: 'RECEIVED', value: 39.9, customer: 'cus_r1', subscription: 'sub_r1', billingType: 'CREDIT_CARD', dueDate: diaBrasilia(agora - 31 * DIA) });
cobrancas.set('pay_r1', { id: 'pay_r1', status: 'CONFIRMED', value: 39.9, customer: 'cus_r1', subscription: 'sub_r1', billingType: 'CREDIT_CARD', dueDate: diaBrasilia(agora - 1 * DIA), invoiceUrl: 'https://www.asaas.com/i/pay_r1' });
/* r2: a fatura do mes nasceu no Asaas e o aviso dela nao chegou (o painel nao mostrava "vence dia X") */
conta('r2@x.com', { desde: new Date(agora - 60 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora + 1 * DIA).toISOString(), ultimoPagamentoEm: new Date(agora - 29 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_r2', pagamentos: ['pay_r2_antiga'] });
clientes.set('cus_r2', { id: 'cus_r2', email: 'r2@x.com', cpfCnpj: CPF, name: 'R2' });
assinaturas.set('sub_r2', { id: 'sub_r2', status: 'ACTIVE', deleted: false, customer: 'cus_r2', billingType: 'UNDEFINED', value: 39.9, cycle: 'MONTHLY' });
cobrancas.set('pay_r2', { id: 'pay_r2', status: 'PENDING', value: 39.9, customer: 'cus_r2', subscription: 'sub_r2', billingType: 'UNDEFINED', dueDate: diaBrasilia(agora + 1 * DIA), invoiceUrl: 'https://www.asaas.com/i/pay_r2' });
/* r3: no teste gratis, gerou a cobranca, pagou no cartao pela fatura e fechou a aba (nunca tocou em "Ja paguei") */
const tR3 = conta('r3@x.com', { desde: new Date(agora - 3 * DIA).toISOString() });
p = await pedir('pagar', tR3, { forma: 'cartao', documento: CPF });
cobrancas.get(p.j.cobranca).status = 'CONFIRMED';
const cobR3 = p.j.cobranca;
/* r4: conta encerrada nao entra na conferencia; r5: em dia e longe de vencer, tambem nao */
conta('r4@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'cancelado', pagoAte: new Date(agora - 1 * DIA).toISOString() }, { assinaturaAsaas: '' });
conta('r5@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora + 20 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_r5' });
emails.length = 0;
const antesConf = perguntas.length;
await worker.scheduled({}, envKv, null);
const r1 = contaDe('r1@x.com');
ok(r1.plano.status === 'ativo' && Date.parse(r1.plano.pagoAte) > agora + 25 * DIA && r1.pagamentos.indexOf('pay_r1') >= 0 && db.get('lojas/loja-r1').plano.pagoAte === r1.plano.pagoAte, 'conferencia: a mensalidade que caiu no cartao sem o aviso do Asaas entra sozinha (mais um mes, e a loja recebe a copia)');
ok(emails.some((m) => m.para === 'r1@x.com' && /confirmado/i.test(m.assunto)) && doAdmin(/recuperado/).length === 1 && /r1@x\.com/.test(doAdmin(/recuperado/)[0].texto) && /r3@x\.com/.test(doAdmin(/recuperado/)[0].texto), 'o dono recebe o "Pagamento confirmado" de sempre e o admin fica sabendo quais contas a conferencia recuperou');
const r2 = contaDe('r2@x.com');
ok(r2.faturaAsaas && r2.faturaAsaas.id === 'pay_r2' && r2.faturaAsaas.valor === 3990 && r2.faturaAsaas.status === 'PENDING' && r2.plano.pagoAte === new Date(agora + 1 * DIA).toISOString(), 'conferencia: a fatura do mes que o aviso nao anotou passa a aparecer no painel (nenhum dia muda)');
const r3 = contaDe('r3@x.com');
ok(r3.plano.status === 'ativo' && r3.pagamentos.indexOf(cobR3) >= 0 && r3.assinaturaAsaas && !r3.faturaAsaas, 'conferencia: quem pagou pela fatura e fechou a aba e liberado sem tocar em "Ja paguei"');
ok(contaDe('r4@x.com').plano.status === 'cancelado' && !perguntas.slice(antesConf).some((x) => /sub_r5/.test(x)), 'conta encerrada e conta em dia longe de vencer nao sao lidas no Asaas');
const guardada = JSON.parse(kv.m.get('asaas:conferencia'));
ok(guardada.aviso === 'ok' && guardada.achados === 2 && guardada.faturas === 1 && guardada.falhou === false && /^\d{4}-\d{2}-\d{2}T/.test(guardada.em), 'o resultado da conferencia fica guardado (quando rodou, 2 pagamentos achados, 1 fatura anotada)');
r = await worker.fetch(new Request('https://w/saude'), envKv);
j = await r.json();
ok(j.conferencia && j.conferencia.achados === 2 && j.conferencia.faturas === 1 && j.conferencia.aviso === 'ok' && typeof j.conferencia.olhadas === 'number', '/saude mostra a ultima conferencia');
/* no dia seguinte: nada entra de novo */
const pagoAteR1 = r1.plano.pagoAte;
emails.length = 0;
await worker.scheduled({}, envKv, null);
ok(contaDe('r1@x.com').plano.pagoAte === pagoAteR1 && contaDe('r1@x.com').pagamentos.filter((x) => x === 'pay_r1').length === 1 && doAdmin(/recuperado/).length === 0 && JSON.parse(kv.m.get('asaas:conferencia')).achados === 0, 'rodar de novo nao soma os dias outra vez nem manda e-mail repetido');

/* ================= a vigia do aviso do Asaas ================= */
ok(doAdmin(/Aviso do Asaas/).length === 0 && !chamadas.some((c) => /^\/webhooks\//.test(c.cam)), 'aviso ligado: nenhum e-mail e nada e mexido no Asaas');
avisos[0].interrupted = true;
emails.length = 0;
await worker.scheduled({}, envKv, null);
const religar = chamadas.filter((c) => c.metodo === 'PUT' && c.cam === '/webhooks/wh-1');
ok(religar.length === 1 && religar[0].corpo.interrupted === false && Object.keys(religar[0].corpo).length === 1 && avisos[0].interrupted === false && doAdmin(/religado/).length === 1, 'a fila de avisos parou: e religada sozinha (so o campo "interrompida" muda) e o admin recebe o e-mail');
ok(avisos[1].interrupted === true && !chamadas.some((c) => c.cam === '/webhooks/wh-2') && JSON.parse(kv.m.get('asaas:conferencia')).aviso === 'religado', 'o aviso de outro sistema na mesma conta do Asaas nao e mexido');
avisos[0].enabled = false;
emails.length = 0;
await worker.scheduled({}, envKv, null);
ok(doAdmin(/com problema/).length === 1 && /desligado/.test(doAdmin(/com problema/)[0].texto) && chamadas.filter((c) => /^\/webhooks\//.test(c.cam)).length === 1 && JSON.parse(kv.m.get('asaas:conferencia')).aviso === 'desligado', 'aviso desligado no Asaas: nao da para ligar daqui, o admin recebe o e-mail com o que fazer');
avisos[0].enabled = true;

/* ================= a fila da conferencia (no maximo 8 contas por dia) ================= */
for (let i = 0; i < 11; i++) {
  conta('fila' + i + '@x.com', { desde: new Date(agora - 90 * DIA).toISOString(), status: 'ativo', pagoAte: new Date(agora + 1 * DIA).toISOString(), planoPago: 'uma' }, { assinaturaAsaas: 'sub_fila' + i, faturaAsaas: { id: 'pay_fila' + i, status: 'PENDING', vencimento: diaBrasilia(agora + 1 * DIA), url: 'https://www.asaas.com/i/f' + i, lembretes: ['d3', 'd0'] } });
}
const antesFila = perguntas.length;
await worker.scheduled({}, envKv, null);
const fila = JSON.parse(kv.m.get('asaas:conferencia'));
ok(fila.olhadas === 8 && fila.cortadas >= 3 && fila.falhou === false, 'muitas contas na fila: 8 por dia, e o resto aparece como "cortadas" (' + fila.cortadas + ') para o dia seguinte');
ok(perguntas.slice(antesFila).filter((x) => /^\/payments/.test(x)).length <= 16, 'cada conta custa no maximo 2 perguntas ao Asaas quando nao ha nada a recuperar');
emails.unshift(...emailsDeAntes);

/* SALVAR_EMAILS=pasta: grava a previa de cada e-mail (para olhar o desenho) */
if (process.env.SALVAR_EMAILS) {
  fs.mkdirSync(process.env.SALVAR_EMAILS, { recursive: true });
  const vistos = {};
  emails.forEach((m) => { const nome = m.assunto.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').slice(0, 40); if (vistos[nome]) return; vistos[nome] = 1; fs.writeFileSync(path.join(process.env.SALVAR_EMAILS, nome + '.html'), m.html); });
  console.log('previas dos e-mails em ' + process.env.SALVAR_EMAILS + ': ' + Object.keys(vistos).join(', '));
}

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
