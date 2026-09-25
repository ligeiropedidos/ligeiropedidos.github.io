/*
 * Teste do mensageiro do Asaas (ferramentas/worker-asaas.js), sem internet: o Asaas, o Google e o banco sao de mentira.
 * Rodar com:  node testes/asaas.test.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import url from 'node:url';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const { default: worker } = await import(url.pathToFileURL(path.join(aqui, '..', 'ferramentas', 'worker-asaas.js')).href);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'proj', client_email: 'sa@proj.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const env = {
  ASAAS_KEY: 'chave', ASAAS_WEBHOOK: 'tokenDoWebhook123', FIREBASE_SA: JSON.stringify(SA),
  PLANOS: JSON.stringify({ uma: { mensal: 8900, anual: 89000, fm: 7900, fa: 79000 } }),
};

/* ---- banco e Asaas de mentira ---- */
const db = new Map();
const emails = [];
const cobrancas = new Map();
const clientes = new Map([['cus_1', { email: 'dono@loja.com' }], ['cus_t', { email: 'teste@loja.com' }]]);
const BASE = 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/';
/* Asaas que tambem muda: assinaturas, cobrancas criadas, apagadas e devolvidas (o que o worker pediu fica em chamadas) */
const assinaturas = new Map();
const chamadas = [];
let novaCobranca = 0;
/* login do Google de mentira: token -> usuario */
const logins = new Map([
  ['tok-dono', { email: 'troca@x.com', emailVerified: true }],
  ['tok-naoconferido', { email: 'troca@x.com', emailVerified: false }],
  ['tok-equipe', { email: 'equipe-loja-troca@equipe.ligeiropedidos.com.br', emailVerified: true }],
  ['tok-outro', { email: 'outro@x.com', emailVerified: true }],
]);
/* gancho para o teste: roda a cada leitura de uma conta (simula outra aba mexendo no meio) */
let aoLerConta = null;
/* a versao de cada documento (a hora da ultima mudanca, como o updateTime do Firestore): muda a cada gravacao */
const versoes = new Map();
const versaoDe = (cam) => '2026-09-25T12:00:00.' + String(versoes.get(cam) || 0).padStart(6, '0') + 'Z';
const mudou = (cam) => versoes.set(cam, (versoes.get(cam) || 0) + 1);
/* aplica a mascara no documento: so os caminhos dela mudam, e "plano.pagoAte" mexe so dentro do mapa */
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
function fs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fs) } };
  const f = {}; Object.keys(v).forEach((k) => { f[k] = fs(v[k]); }); return { mapValue: { fields: f } };
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
const resposta = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, o) => {
  o = o || {};
  const endereco = String(u);
  if (endereco === 'https://oauth2.googleapis.com/token') return resposta({ access_token: 'tok' });
  if (endereco === 'https://identitytoolkit.googleapis.com/v1/accounts:lookup') {
    const u = logins.get(JSON.parse(o.body).idToken);
    return u ? resposta({ users: [u] }) : resposta({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
  }
  /* como o Asaas de verdade nas contas novas: sem User-Agent, 400 */
  if (endereco.indexOf('https://api.asaas.com/') === 0 && !((o.headers || {})['User-Agent'])) return resposta({ errors: [{ code: 'invalid_user_agent' }] }, 400);
  if (endereco.indexOf('https://api.asaas.com/v3/') === 0) {
    const metodo = o.method || 'GET';
    const cam = endereco.slice('https://api.asaas.com/v3'.length);
    const corpo = o.body ? JSON.parse(o.body) : null;
    if (metodo !== 'GET') chamadas.push({ metodo, cam, corpo });
    const partes = cam.split('/').map(decodeURIComponent);
    if (partes[1] === 'subscriptions') {
      const a = assinaturas.get(partes[2]);
      if (a && a.jaCancelada) return metodo === 'DELETE' ? resposta({ errors: [{ code: 'invalid_action' }] }, 400) : resposta(Object.assign({}, a, { deleted: true }));
      if (a && a.naoCancela && metodo === 'DELETE') return resposta({ errors: [] }, 500);
      if (!a || a.deleted) return resposta({ errors: [] }, 404);
      if (metodo === 'PUT') { if (corpo.value !== undefined) a.value = corpo.value; if (corpo.cycle) a.cycle = corpo.cycle; return resposta(a); }
      if (metodo === 'DELETE') { a.deleted = true; return resposta({ deleted: true, id: a.id }); }
      return resposta(a);
    }
    if (partes[1] === 'payments' && metodo === 'POST' && partes.length === 2) {
      const id = 'pay_nova' + (++novaCobranca);
      const c = Object.assign({ id, status: 'PENDING', invoiceUrl: 'https://www.asaas.com/i/' + id }, corpo);
      cobrancas.set(id, c);
      return resposta(c);
    }
    if (partes[1] === 'payments') {
      const c = cobrancas.get(partes[2]);
      if (!c || (c.deleted && metodo !== 'GET')) return resposta({ errors: [] }, 404);
      if (partes[3] === 'refund') {
        if (c.billingType === 'BOLETO') return resposta({ errors: [{ code: 'invalid_action' }] }, 400);
        c.status = 'REFUNDED'; return resposta(c);
      }
      if (metodo === 'DELETE') {
        if (['RECEIVED', 'CONFIRMED'].indexOf(c.status) >= 0) return resposta({ errors: [{ code: 'invalid_action' }] }, 400);
        c.deleted = true; return resposta({ deleted: true });
      }
      return resposta(c);
    }
    if (partes[1] === 'customers') {
      const c = clientes.get(partes[2]);
      if (!c) return resposta({ errors: [] }, 404);
      if (metodo === 'PUT') Object.assign(c, corpo);
      return resposta(c);
    }
    return resposta({ errors: [] }, 404);
  }
  /* o Apps Script (e-mail) de mentira: guarda o que mandaria */
  if (endereco.indexOf('https://script.google.com/macros/s/') === 0) {
    const c = JSON.parse(o.body);
    if (c.token !== 'senhaDoEmail12345678901234567890') return resposta({ ok: false, erro: 'token' });
    emails.push(c);
    return resposta({ ok: true });
  }
  /* como o Firestore de verdade: a consulta e em documents:runQuery (sem a barra); o endereco com a barra nao existe */
  if (endereco === BASE + ':runQuery') return resposta({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
  if (endereco === BASE.replace(/\/$/, '') + ':runQuery') {
    const q = JSON.parse(o.body).structuredQuery;
    /* contas com o campo (faturaAsaas.status, plano.status) num dos valores (IN) */
    if (q.from[0].collectionId === 'contas') {
      const f = q.where.fieldFilter;
      const campo = f.field.fieldPath;
      const pegar = (d) => campo.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), d);
      const passa = f.op === 'IN'
        ? ((d) => f.value.arrayValue.values.map((v) => v.stringValue).indexOf(pegar(d)) >= 0)
        : ((d) => typeof pegar(d) === 'string' && pegar(d) <= f.value.stringValue);
      const achadas = [...db.entries()].filter(([k, d]) => k.indexOf('contas/') === 0 && passa(d))
        .map(([k, d]) => ({ document: { name: BASE + 'contas/' + encodeURIComponent(k.slice(7)), fields: fs(d).mapValue.fields } }));
      return resposta(achadas.length ? achadas : [{}]);
    }
    const valor = q.where.fieldFilter.value.stringValue;
    const comAtiva = ((q.select && q.select.fields) || []).some((x) => x.fieldPath === 'ativa');
    const linhas = [...db.entries()].filter(([k, d]) => k.indexOf('lojas/') === 0 && k.split('/').length === 2 && d.donoEmail === valor)
      .map(([k, d]) => ({ document: { name: BASE + k, fields: comAtiva && d.ativa !== undefined ? { ativa: { booleanValue: d.ativa } } : {} } }));
    return resposta(linhas.length ? linhas : [{}]);
  }
  /* gravacao em lote (tudo ou nada), com a trava de cada documento: versao igual a da leitura, ou "ainda nao existe" */
  if (endereco === BASE.replace(/\/$/, '') + ':commit') {
    if (globalThis.__antesDoLote) { const f = globalThis.__antesDoLote; globalThis.__antesDoLote = null; f(); }
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
    if ((o.method || 'GET') === 'GET') {
      if (aoLerConta && cam.indexOf('contas/') === 0) aoLerConta(cam);
      const d = db.get(cam);
      return d ? resposta({ fields: fs(d).mapValue.fields, updateTime: versaoDe(cam) }) : resposta({}, 404);
    }
    if (o.method === 'PATCH') {
      /* como o Firestore: so os caminhos da mascara mudam, e "plano.pagoAte" mexe so dentro do mapa */
      const mascara = new URL(endereco).searchParams.getAll('updateMask.fieldPaths');
      const corpo = deFs({ mapValue: { fields: JSON.parse(o.body).fields } });
      db.set(cam, aplicarMascara(db.get(cam) || {}, corpo, mascara));
      mudou(cam);
      return resposta({});
    }
  }
  return resposta({ erro: 'rota de mentira nao existe: ' + endereco }, 500);
};

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }
const avisar = (pag, token, evento) => worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'asaas-access-token': token === undefined ? env.ASAAS_WEBHOOK : token, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: evento || 'PAYMENT_RECEIVED', payment: pag }) }), env);

db.set('lojas/loja-do-ze', { slug: 'loja-do-ze', donoEmail: 'dono@loja.com' });
/* conta de quem ja passou do teste gratis (os dias pagos contam de hoje) */
db.set('contas/dono@loja.com', { email: 'dono@loja.com', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date(Date.now() - 10 * 864e5).toISOString() } });
db.set('publico/fundadores', { usados: 0 });

console.log('Mensageiro do Asaas');
let r = await avisar({ id: 'pay_1', customer: 'cus_1', value: 89 }, 'errado');
ok(r.status === 401, 'token errado: 401');

/* aviso inventado: o Asaas nao conhece essa cobranca */
r = await avisar({ id: 'pay_falso', customer: 'cus_1', value: 890 });
ok(r.status === 200 && !db.get('contas/dono@loja.com').plano.pagoAte, 'cobranca que o Asaas nao conhece: nenhum dia liberado (e a fila do Asaas nao trava)');
/* Asaas fora do ar: erro (o Asaas tenta de novo), sem detalhe de dentro */
const fetchBom = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).indexOf('api.asaas.com') >= 0 ? new Response('{}', { status: 503 }) : fetchBom(u, o);
r = await avisar({ id: 'pay_x', customer: 'cus_1', value: 89 });
globalThis.fetch = fetchBom;
ok(r.status === 500 && !/Asaas 503|api\.asaas/.test(JSON.stringify(await r.json())), 'Asaas fora do ar: 500 sem detalhe de dentro');

/* aviso diz "pago", o Asaas diz "pendente" */
cobrancas.set('pay_2', { id: 'pay_2', customer: 'cus_1', value: 89, status: 'PENDING' });
r = await avisar({ id: 'pay_2', customer: 'cus_1', value: 89 });
ok(r.status === 200 && !db.get('contas/dono@loja.com').plano.pagoAte, 'cobranca ainda pendente no Asaas: nenhum dia liberado');

/* aviso com valor inflado: vale o valor do Asaas */
cobrancas.set('pay_3', { id: 'pay_3', customer: 'cus_1', value: 44.5, status: 'RECEIVED', description: 'Ligeiro uma loja', subscription: 'sub_meio' });
r = await avisar({ id: 'pay_3', customer: 'cus_1', value: 890 });
let conta = db.get('contas/dono@loja.com');
ok(r.status === 200 && conta && conta.plano.pagamentoParcial && conta.plano.pagamentoParcial.cobrado === 4450, 'valor inflado no aviso: vale o que o Asaas diz (meio mes, proporcional)');
const dias = Math.round((new Date(conta.plano.pagoAte).getTime() - Date.now()) / 864e5);
ok(dias === 15, 'metade do preco: 15 dias (' + dias + ')');

/* mesmo pagamento duas vezes: nao soma */
const antes = conta.plano.pagoAte;
r = await avisar({ id: 'pay_3', customer: 'cus_1', value: 44.5 });
ok(db.get('contas/dono@loja.com').plano.pagoAte === antes, 'o mesmo pagamento avisado de novo nao soma dias');
/* os testes seguintes (fatura do mes) sao de uma conta ainda sem assinatura amarrada */
db.get('contas/dono@loja.com').assinaturaAsaas = '';

/* preco cheio: o mes inteiro, e a loja destrava */
cobrancas.set('pay_4', { id: 'pay_4', customer: 'cus_1', value: 89, status: 'CONFIRMED' });
r = await avisar({ id: 'pay_4', customer: 'cus_1', value: 89 });
conta = db.get('contas/dono@loja.com');
ok(!conta.plano.pagamentoParcial && db.get('lojas/loja-do-ze').plano.status === 'ativo', 'preco cheio: mes inteiro e a loja espelhada ativa');

/* assinou no periodo gratis (2 dias de 7 usados): os 5 que faltam continuam e os 30 pagos contam depois deles */
db.set('contas/teste@loja.com', { email: 'teste@loja.com', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date(Date.now() - 2 * 864e5).toISOString() } });
cobrancas.set('pay_t', { id: 'pay_t', customer: 'cus_t', value: 89, status: 'CONFIRMED' });
r = await avisar({ id: 'pay_t', customer: 'cus_t', value: 89 });
const diasTeste = Math.round((new Date(db.get('contas/teste@loja.com').plano.pagoAte).getTime() - Date.now()) / 864e5);
ok(r.status === 200 && diasTeste === 35, 'assinou no gratis: nao perde os 5 dias que faltavam (' + diasTeste + ' dias, 5 + 30)');

/* estorno e contestacao: a conta pausa (loja trava) ate o admin olhar */
cobrancas.set('pay_9', { id: 'pay_9', customer: 'cus_1', value: 89, status: 'RECEIVED' });
r = await avisar({ id: 'pay_9', customer: 'cus_1', value: 89 }, undefined, 'PAYMENT_CHARGEBACK_REQUESTED');
ok(r.status === 200 && db.get('contas/dono@loja.com').plano.status === 'ativo', 'aviso de contestacao, mas o Asaas diz recebido: nada muda');
r = await avisar({ id: 'pay_nunca', customer: 'cus_1', value: 89 }, undefined, 'PAYMENT_REFUNDED');
ok(r.status === 200 && db.get('contas/dono@loja.com').plano.status === 'ativo', 'estorno de cobranca que nunca liberou dias: nada muda');
cobrancas.set('pay_4', { id: 'pay_4', customer: 'cus_1', value: 89, status: 'CHARGEBACK_REQUESTED' });
r = await avisar({ id: 'pay_4', customer: 'cus_1', value: 89 }, undefined, 'PAYMENT_CHARGEBACK_REQUESTED');
conta = db.get('contas/dono@loja.com');
ok(r.status === 200 && conta.plano.status === 'pausado' && conta.estornos.length === 1 && db.get('lojas/loja-do-ze').plano.status === 'pausado' && db.get('vitrine/loja-do-ze').plano.status === 'pausado', 'contestacao da cobranca que pagou o mes: conta pausada e a loja espelhada pausada');
r = await avisar({ id: 'pay_4', customer: 'cus_1', value: 89 }, undefined, 'PAYMENT_CHARGEBACK_DISPUTE');
ok(db.get('contas/dono@loja.com').estornos.length === 1, 'o mesmo estorno avisado de novo: anota uma vez so');

/* fatura do mes (assinatura por Pix ou boleto): o painel mostra, e sai quando paga */
const avisarEvento = (pag, evento) => avisar(pag, undefined, evento);
cobrancas.set('pay_5', { id: 'pay_5', customer: 'cus_1', value: 89, status: 'PENDING', dueDate: '2026-10-20', billingType: 'UNDEFINED', subscription: 'sub_1', invoiceUrl: 'https://www.asaas.com/i/abc123' });
r = await avisarEvento({ id: 'pay_5', customer: 'cus_1' }, 'PAYMENT_CREATED');
conta = db.get('contas/dono@loja.com');
ok(r.status === 200 && conta.faturaAsaas && conta.faturaAsaas.id === 'pay_5' && conta.faturaAsaas.valor === 8900 && conta.faturaAsaas.vencimento === '2026-10-20' && conta.faturaAsaas.url === 'https://www.asaas.com/i/abc123' && !conta.assinaturaAsaas, 'fatura nova da assinatura: fica guardada na conta (valor, vencimento, link), sem amarrar a assinatura antes de pagar');
cobrancas.set('pay_6', { id: 'pay_6', customer: 'cus_1', value: 89, status: 'PENDING', dueDate: '2026-11-20', billingType: 'UNDEFINED', subscription: 'sub_1', invoiceUrl: 'https://www.asaas.com/i/def456' });
await avisarEvento({ id: 'pay_6', customer: 'cus_1' }, 'PAYMENT_CREATED');
ok(db.get('contas/dono@loja.com').faturaAsaas.id === 'pay_5', 'fatura do mes seguinte nao passa por cima da que vence antes');
cobrancas.set('pay_7', { id: 'pay_7', customer: 'cus_1', value: 5, status: 'PENDING', dueDate: '2026-10-01', invoiceUrl: 'https://www.asaas.com/i/x' });
await avisarEvento({ id: 'pay_7', customer: 'cus_1' }, 'PAYMENT_CREATED');
ok(db.get('contas/dono@loja.com').faturaAsaas.id === 'pay_5', 'cobranca avulsa (sem assinatura) nao vira mensalidade');
cobrancas.set('pay_8', { id: 'pay_8', customer: 'cus_1', value: 89, status: 'PENDING', dueDate: '2026-10-10', subscription: 'sub_1', invoiceUrl: 'javascript:alert(1)' });
await avisarEvento({ id: 'pay_8', customer: 'cus_1' }, 'PAYMENT_CREATED');
ok(db.get('contas/dono@loja.com').faturaAsaas.url === '', 'link da fatura que nao e do Asaas: nao vai para o painel');
cobrancas.set('pay_8', { id: 'pay_8', customer: 'cus_1', value: 89, status: 'RECEIVED', dueDate: '2026-10-10', subscription: 'sub_1', invoiceUrl: 'https://www.asaas.com/i/ghi' });
await avisar({ id: 'pay_8', customer: 'cus_1', value: 89 });
ok(db.get('contas/dono@loja.com').faturaAsaas === null, 'fatura paga: sai do painel');
cobrancas.set('pay_9b', { id: 'pay_9b', customer: 'cus_1', value: 89, status: 'PENDING', dueDate: '2026-12-10', subscription: 'sub_1', invoiceUrl: 'https://www.asaas.com/i/jkl' });
await avisarEvento({ id: 'pay_9b', customer: 'cus_1' }, 'PAYMENT_CREATED');
cobrancas.set('pay_9b', { id: 'pay_9b', customer: 'cus_1', value: 89, status: 'PENDING', deleted: true, dueDate: '2026-12-10', subscription: 'sub_1' });
await avisarEvento({ id: 'pay_9b', customer: 'cus_1' }, 'PAYMENT_DELETED');
ok(db.get('contas/dono@loja.com').faturaAsaas === null, 'fatura removida no Asaas: sai do painel');
clientes.set('cus_2', { email: 'semconta@x.com' });
cobrancas.set('pay_10', { id: 'pay_10', customer: 'cus_2', value: 89, status: 'PENDING', dueDate: '2026-10-10', subscription: 'sub_2', invoiceUrl: 'https://www.asaas.com/i/mno' });
r = await avisarEvento({ id: 'pay_10', customer: 'cus_2' }, 'PAYMENT_CREATED');
ok(r.status === 200 && !db.get('contas/semconta@x.com'), 'fatura de quem nao tem conta no Ligeiro: ignorada, sem criar conta');

/* lembrete por e-mail (Cron): cada aviso uma vez, cartao em dia nao recebe, conta cancelada nao recebe */
const diaMais = (n) => new Date(Date.now() - 3 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const fatura = (o) => Object.assign({ id: 'pay_l', valor: 8900, vencimento: diaMais(3), url: 'https://www.asaas.com/i/lembrete', status: 'PENDING', forma: 'UNDEFINED', assinatura: 'sub_9' }, o);
db.set('contas/tres@x.com', { email: 'tres@x.com', nome: '<b>Zé</b> da Silva', plano: { status: 'ativo' }, faturaAsaas: fatura() });
db.set('contas/hoje@x.com', { email: 'hoje@x.com', plano: { status: 'ativo' }, faturaAsaas: fatura({ vencimento: diaMais(0) }) });
db.set('contas/cartao@x.com', { email: 'cartao@x.com', plano: { status: 'ativo' }, faturaAsaas: fatura({ forma: 'CREDIT_CARD' }) });
db.set('contas/venceu@x.com', { email: 'venceu@x.com', plano: { status: 'ativo' }, faturaAsaas: fatura({ vencimento: diaMais(-2), status: 'OVERDUE', forma: 'CREDIT_CARD' }) });
db.set('contas/parando@x.com', { email: 'parando@x.com', plano: { status: 'ativo' }, faturaAsaas: fatura({ vencimento: diaMais(-8), status: 'OVERDUE' }) });
db.set('contas/cancelou@x.com', { email: 'cancelou@x.com', plano: { status: 'cancelado' }, faturaAsaas: fatura() });
db.set('contas/longe@x.com', { email: 'longe@x.com', plano: { status: 'ativo' }, faturaAsaas: fatura({ vencimento: diaMais(20) }) });
const rodarCron = async (e) => { const tarefas = []; await worker.scheduled({}, e, { waitUntil: (p) => tarefas.push(p) }); await Promise.all(tarefas); };
await rodarCron(env);
ok(emails.length === 0, 'sem EMAIL_URL e EMAIL_TOKEN: nenhum e-mail (e nada quebra)');
const envEmail = Object.assign({}, env, { EMAIL_URL: 'https://script.google.com/macros/s/AKfyTESTE123/exec', EMAIL_TOKEN: 'senhaDoEmail12345678901234567890' });
await rodarCron(envEmail);
const para = (quem) => emails.filter((m) => m.para === quem);
ok(para('tres@x.com').length === 1 && /vence em 3 dias/.test(para('tres@x.com')[0].assunto) && para('tres@x.com')[0].html.indexOf('https://www.asaas.com/i/lembrete') > 0, 'vence em 3 dias: e-mail com o botao da fatura');
ok(para('tres@x.com')[0].html.indexOf('<b>Zé') < 0 && para('tres@x.com')[0].html.indexOf('Olá, &lt;b&gt;Zé&lt;/b&gt;!') > 0, 'o nome do dono entra no e-mail sem virar codigo (escapado)');
ok(para('tres@x.com')[0].html.indexOf('/img/email/selo-vence.png') > 0 && para('parando@x.com')[0].html.indexOf('/img/email/selo-parar.png') > 0 && para('parando@x.com')[0].html.indexOf('/img/email/mascote-parar.png') > 0, 'selo e ratinho certos em cada aviso (verde vence, vermelho pode parar)');
ok(para('hoje@x.com').length === 1 && /vence hoje/.test(para('hoje@x.com')[0].assunto), 'vence hoje: e-mail');
ok(para('cartao@x.com').length === 0, 'cartao em dia: sem e-mail (e cobrado sozinho)');
ok(para('venceu@x.com').length === 1 && /cartão não passou/.test(para('venceu@x.com')[0].texto), 'cartao que nao passou: e-mail de vencida explicando');
ok(para('parando@x.com').length === 1 && /pode parar/.test(para('parando@x.com')[0].assunto), '7 dias vencida: e-mail de que a loja pode parar');
ok(para('cancelou@x.com').length === 0 && para('longe@x.com').length === 0, 'conta encerrada e fatura longe de vencer: sem e-mail');
ok(db.get('contas/tres@x.com').faturaAsaas.lembretes.indexOf('d3') >= 0, 'o aviso mandado fica anotado na fatura');
const antesDeRepetir = emails.length;
await rodarCron(envEmail);
ok(emails.length === antesDeRepetir, 'o Cron de novo no mesmo dia: ninguem recebe duas vezes');
ok(!/ pra /.test(emails.map((m) => m.texto).join(' ')) && !/—/.test(emails.map((m) => m.texto + m.html).join(' ')), 'texto sem "pra" e sem travessao');

/* ================= plano unico: mensal <-> anual, encerrar e a rede de seguranca dos pagamentos ================= */
console.log('Plano unico: troca mensal/anual e encerramento');
const envE = envEmail;
const DIA = 864e5;
const pedir = (rota, corpo, token, origem, metodo) => worker.fetch(new Request('https://w/plano/' + rota, { method: metodo || 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: origem || 'https://ligeiropedidos.com.br' }, token ? { Authorization: 'Bearer ' + token } : {}), body: metodo === 'OPTIONS' ? undefined : JSON.stringify(corpo || {}) }), envE);
const avisarCom = (e, pag, evento) => worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'asaas-access-token': e.ASAAS_WEBHOOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: evento || 'PAYMENT_RECEIVED', payment: pag }) }), e);
const doAdmin = () => emails.filter((m) => m.para === 'ligeiro.pedidos@gmail.com');
const contaTroca = (plano, extra) => db.set('contas/troca@x.com', Object.assign({ email: 'troca@x.com', assinaturaAsaas: 'sub_t', plano: Object.assign({ status: 'ativo', tipo: 'mensal', planoId: 'uma', planoPago: 'uma', desde: '2026-01-01T00:00:00.000Z', pagoAte: new Date(Date.now() + 15 * DIA).toISOString(), ultimoPagamentoEm: '2026-09-10T00:00:00.000Z' }, plano) }, extra));
const assinaturaT = (o) => assinaturas.set('sub_t', Object.assign({ id: 'sub_t', customer: 'cus_troca', value: 89, cycle: 'MONTHLY', nextDueDate: '2026-10-10', status: 'ACTIVE' }, o));
clientes.set('cus_troca', { email: 'troca@x.com' });
db.set('lojas/loja-troca', { slug: 'loja-troca', donoEmail: 'troca@x.com' });
contaTroca(); assinaturaT();
const conta2 = () => db.get('contas/troca@x.com');
const feitas = (metodo, parte) => chamadas.filter((c) => c.metodo === metodo && c.cam.indexOf(parte) >= 0);
let j;

/* quem pode chamar */
r = await pedir('simular', { tipo: 'anual' });
ok(r.status === 401, 'sem login: 401');
r = await pedir('simular', { tipo: 'anual' }, 'tok-inventado');
ok(r.status === 401, 'token inventado: 401');
r = await pedir('simular', { tipo: 'anual' }, 'tok-naoconferido');
ok(r.status === 401, 'e-mail nao conferido (conta criada com o e-mail de outro): 401');
r = await pedir('trocar', { tipo: 'anual' }, 'tok-equipe');
ok(r.status === 403, 'login da equipe nao mexe na assinatura: 403');
r = await pedir('simular', {}, null, 'https://ligeiropedidos.com.br', 'OPTIONS');
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://ligeiropedidos.com.br', 'o site pergunta antes (CORS): liberado so para o site');
r = await pedir('simular', {}, null, 'https://golpe.com', 'OPTIONS');
ok(r.headers.get('Access-Control-Allow-Origin') === 'null', 'outro site: o navegador nao deixa chamar');
r = await pedir('apagar-tudo', {}, 'tok-dono');
ok(r.status === 404, 'rota que nao existe: 404');
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
ok(r.status === 400 && /uma loja/.test((await r.json()).erro), 'pedir plano de 2 lojas: 400, com o caminho (outra conta)');
for (const [corpo, nome] of [[{ planoId: '__proto__', tipo: 'mensal' }, 'plano "__proto__"'], [{ tipo: 'semanal' }, 'tipo inventado'], [{}, 'sem tipo']]) {
  r = await pedir('trocar', corpo, 'tok-dono');
  ok(r.status === 400, nome + ': 400');
}
ok(chamadas.length === 0 && conta2().plano.tipo === 'mensal', 'nenhuma chamada errada mexeu no Asaas ou na conta');

/* mensal -> anual: simular nao mexe; trocar muda a MESMA assinatura, e vale na proxima fatura */
j = await (await pedir('simular', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.ok && j.acao === 'proxima' && j.valorNovo === 89000 && j.proxima === '2026-10-10', 'simular mensal -> anual: R$ 890 a partir de 10/10');
ok(chamadas.length === 0 && assinaturas.get('sub_t').value === 89, 'simular nao muda a assinatura');
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'anual' }, 'tok-dono')).json();
ok(j.ok && assinaturas.get('sub_t').value === 890 && assinaturas.get('sub_t').cycle === 'YEARLY' && feitas('PUT', '/subscriptions/sub_t')[0].corpo.updatePendingPayments === true, 'trocar: a MESMA assinatura vira R$ 890 por ano (e a fatura pendente junto)');
ok(feitas('POST', '/subscriptions').length === 0 && feitas('POST', '/payments').length === 0, 'nenhuma assinatura nova e nenhuma cobranca avulsa (nada de cobrar em dobro)');
ok(conta2().plano.tipo === 'anual' && conta2().plano.planoPago === 'uma' && conta2().plano.pagoAte === db.get('contas/troca@x.com').plano.pagoAte, 'a conta fica anual; os dias pagos nao mudam');
ok(db.get('lojas/loja-troca').plano.tipo === 'anual', 'a loja fica sabendo');
const antesIgual = chamadas.length;
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'igual' && chamadas.length === antesIgual, 'pedir anual de novo: nada muda, nada no Asaas');
/* fundador troca com o preco de fundador */
contaTroca({ fundador: true }); assinaturaT({ value: 79 });
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.valorNovo === 79000 && assinaturas.get('sub_t').value === 790, 'fundador: anual por R$ 790');
/* renovacao cai: a escolha do dono (anual) nao volta atras */
contaTroca({ tipo: 'anual' }); assinaturaT({ value: 890, cycle: 'YEARLY' });
cobrancas.set('pay_renova', { id: 'pay_renova', customer: 'cus_troca', value: 89, status: 'RECEIVED', subscription: 'sub_t', billingType: 'PIX' });
r = await avisarCom(envE, { id: 'pay_renova', customer: 'cus_troca' });
ok(conta2().plano.tipo === 'anual', 'renovacao da mesma assinatura cai: a escolha do dono nao volta atras');

/* sem assinatura, assinatura sumida, pausada, encerrada */
db.set('contas/troca@x.com', { email: 'troca@x.com', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date().toISOString() } });
let chamadasAntes = chamadas.length;
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'marcar' && conta2().plano.tipo === 'anual' && chamadas.length === chamadasAntes, 'no teste gratis: so marca a escolha, sem mexer no Asaas');
contaTroca(); assinaturas.delete('sub_t');
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'marcar' && conta2().assinaturaAsaas === '' && conta2().assinaturasAntigas.indexOf('sub_t') >= 0, 'assinatura apagada no Asaas: a conta esquece ela e o proximo pagamento abre outra');
contaTroca({ status: 'pausado' }); assinaturaT();
r = await pedir('trocar', { tipo: 'anual' }, 'tok-dono');
ok(r.status === 409, 'pausada pelo admin: nao troca');
contaTroca({ status: 'cancelado' }); assinaturaT();
r = await pedir('trocar', { tipo: 'anual' }, 'tok-dono');
ok(r.status === 409 && /Reative/.test((await r.json()).erro), 'encerrada com a assinatura ainda viva: primeiro reativa');

/* corrida: outra aba mudou a escolha no meio: 409 e a assinatura volta para o valor da escolha que ficou */
contaTroca(); assinaturaT();
let leituras = 0;
aoLerConta = (cam) => { if (cam === 'contas/troca@x.com' && ++leituras === 2) { const c = db.get(cam); c.plano.tipo = 'mensal2'; db.set(cam, c); } };
r = await pedir('trocar', { tipo: 'anual' }, 'tok-dono');
aoLerConta = null;
ok(r.status === 409 && assinaturas.get('sub_t').value === 89 && assinaturas.get('sub_t').cycle === 'MONTHLY', 'outra aba mudou a escolha no meio: 409 e a assinatura volta para a escolha que ficou (R$ 89 por mes)');
/* o Asaas grava na conta logo depois do PUT (fatura atualizada): a troca nao falha por isso */
contaTroca(); assinaturaT();
leituras = 0;
aoLerConta = (cam) => { if (cam === 'contas/troca@x.com' && ++leituras === 2) db.set(cam, Object.assign(db.get(cam), { faturaAsaas: { id: 'pay_x', status: 'PENDING' } })); };
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
aoLerConta = null;
ok(j.ok && conta2().plano.tipo === 'anual' && conta2().faturaAsaas, 'o Asaas mexeu na conta no meio (fatura): a troca vai, e nada do Asaas se perde');

/* assinatura so com fatura (boleto ainda nao pago): fica pendente; trocar e encerrar mudam ela junto */
db.set('contas/troca@x.com', { email: 'troca@x.com', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date().toISOString() } });
assinaturas.set('sub_pend', { id: 'sub_pend', customer: 'cus_troca', value: 79, cycle: 'MONTHLY', status: 'ACTIVE' });
cobrancas.set('pay_pend', { id: 'pay_pend', customer: 'cus_troca', value: 79, status: 'PENDING', dueDate: '2026-10-08', subscription: 'sub_pend', invoiceUrl: 'https://www.asaas.com/i/pend' });
await avisarCom(envE, { id: 'pay_pend', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(conta2().assinaturaPendente === 'sub_pend' && !conta2().assinaturaAsaas && conta2().faturaAsaas.id === 'pay_pend', 'boleto da assinatura ainda nao pago: a fatura aparece e a assinatura fica pendente');
j = await (await pedir('trocar', { tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && assinaturas.get('sub_pend').value === 790, 'fundador pelo link, antes da primeira: anual por R$ 790 (a fatura pendente muda junto)');
j = await (await pedir('encerrar', {}, 'tok-dono')).json();
ok(assinaturas.get('sub_pend').deleted === true && !conta2().assinaturaPendente && conta2().plano.status === 'cancelado', 'encerrar antes de pagar: a assinatura pendente e cancelada no Asaas');

/* encerrar: cancela no Asaas; cobranca depois disso e devolvida */
contaTroca({}, { faturaAsaas: { id: 'pay_fat', status: 'PENDING' } }); assinaturaT();
j = await (await pedir('encerrar', {}, 'tok-dono')).json();
ok(j.ok && j.cancelada && assinaturas.get('sub_t').deleted === true, 'encerrar: a assinatura e cancelada no Asaas (o cartao nao cobra mais)');
ok(conta2().plano.status === 'cancelado' && conta2().assinaturaAsaas === '' && conta2().faturaAsaas === null, 'conta encerrada, sem fatura pendurada');
ok(db.get('lojas/loja-troca').plano.status === 'cancelado', 'a loja fica sabendo (no ar ate o fim do pago)');
cobrancas.set('pay_depois', { id: 'pay_depois', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
const pagoAteEnc = conta2().plano.pagoAte;
r = await avisarCom(envE, { id: 'pay_depois', customer: 'cus_troca' });
ok(cobrancas.get('pay_depois').status === 'REFUNDED' && conta2().plano.status === 'cancelado' && conta2().plano.pagoAte === pagoAteEnc, 'cartao cobrou depois de encerrar: devolvido sozinho, sem dias');
r = await avisarCom(envE, { id: 'pay_depois', customer: 'cus_troca' }, 'PAYMENT_REFUNDED');
ok(conta2().plano.status === 'cancelado', 'a devolucao que o proprio Ligeiro fez chega como estorno: nao pausa a conta');
cobrancas.set('pay_boleto', { id: 'pay_boleto', customer: 'cus_troca', value: 89, status: 'RECEIVED', subscription: 'sub_t', billingType: 'BOLETO' });
let adminAntes = doAdmin().length;
r = await avisarCom(envE, { id: 'pay_boleto', customer: 'cus_troca' });
ok(conta2().plano.status === 'ativo' && conta2().assinaturaAsaas === '' && doAdmin().length === adminAntes + 1, 'boleto pago depois de encerrar (sem estorno pela API): os dias entram e o admin recebe e-mail');

/* encerrada que assina de novo pelo link: a fatura nao amarra, o pagamento reativa (nada de devolver) */
contaTroca({ status: 'cancelado' }, { assinaturaAsaas: '', assinaturasAntigas: ['sub_t'], faturaAsaas: null });
cobrancas.set('pay_volta_fat', { id: 'pay_volta_fat', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-05', subscription: 'sub_volta', invoiceUrl: 'https://www.asaas.com/i/volta' });
await avisarCom(envE, { id: 'pay_volta_fat', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(conta2().assinaturaAsaas === '' && conta2().assinaturaPendente === 'sub_volta', 'encerrada assina de novo: a fatura aparece e a assinatura fica pendente');
await rodarCron(envE);
ok(!assinaturas.has('sub_volta') || !assinaturas.get('sub_volta').deleted, 'o Cron nao cancela a assinatura nova de quem esta voltando');
cobrancas.set('pay_volta', { id: 'pay_volta', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_volta', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_volta', customer: 'cus_troca' });
ok(cobrancas.get('pay_volta').status === 'CONFIRMED' && conta2().plano.status === 'ativo' && conta2().assinaturaAsaas === 'sub_volta' && !conta2().assinaturaPendente, 'encerrada que pagou de novo: reativada (nao devolvida)');

/* uma assinatura so: a da conta ja nao vale (sem dias pela frente): a nova toma o lugar e a velha e cancelada */
contaTroca({ pagoAte: new Date(Date.now() - DIA).toISOString() }, { assinaturaAsaas: 'sub_velha', assinaturasAntigas: [] });
assinaturas.set('sub_velha', { id: 'sub_velha', customer: 'cus_troca', value: 89, cycle: 'MONTHLY', status: 'ACTIVE' });
cobrancas.set('pay_novasub', { id: 'pay_novasub', customer: 'cus_troca', value: 890, status: 'CONFIRMED', subscription: 'sub_nova', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_novasub', customer: 'cus_troca' });
ok(assinaturas.get('sub_velha').deleted === true && conta2().assinaturaAsaas === 'sub_nova' && conta2().assinaturasAntigas.indexOf('sub_velha') >= 0 && conta2().plano.tipo === 'anual', 'vencida paga uma assinatura nova (anual): a velha e cancelada, a nova vira a da conta, com a escolha dela');
cobrancas.set('pay_atrasado', { id: 'pay_atrasado', customer: 'cus_troca', value: 89, status: 'RECEIVED', subscription: 'sub_velha', billingType: 'BOLETO' });
const pagoAteNova = conta2().plano.pagoAte;
r = await avisarCom(envE, { id: 'pay_atrasado', customer: 'cus_troca' });
ok(conta2().assinaturaAsaas === 'sub_nova' && conta2().plano.pagoAte > pagoAteNova, 'boleto atrasado da velha pago depois: os dias entram e a da conta continua a nova');
cobrancas.set('pay_fat_velha', { id: 'pay_fat_velha', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-01', subscription: 'sub_velha', invoiceUrl: 'https://www.asaas.com/i/velha' });
await avisarCom(envE, { id: 'pay_fat_velha', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(!conta2().faturaAsaas || conta2().faturaAsaas.id !== 'pay_fat_velha', 'fatura da assinatura velha nao aparece no painel');

/* alguem assina com o e-mail do dono: a fatura nao aparece, e pagar nao toma a assinatura viva do dono */
contaTroca({ tipo: 'anual', pagoAte: new Date(Date.now() + 200 * DIA).toISOString() }, { assinaturaAsaas: 'sub_dono', assinaturasAntigas: [], faturaAsaas: null });
assinaturas.set('sub_dono', { id: 'sub_dono', customer: 'cus_troca', value: 890, cycle: 'YEARLY', status: 'ACTIVE' });
clientes.set('cus_estranho', { email: 'troca@x.com' });
cobrancas.set('pay_estranho_fat', { id: 'pay_estranho_fat', customer: 'cus_estranho', value: 89, status: 'PENDING', dueDate: '2026-10-03', subscription: 'sub_estranho', invoiceUrl: 'https://www.asaas.com/i/estranho' });
await avisarCom(envE, { id: 'pay_estranho_fat', customer: 'cus_estranho' }, 'PAYMENT_CREATED');
ok(!conta2().faturaAsaas && !conta2().assinaturaPendente, 'fatura de outra assinatura com o e-mail do dono: nao aparece no painel dele');
adminAntes = doAdmin().length;
const pagoAteDono = conta2().plano.pagoAte;
cobrancas.set('pay_estranho', { id: 'pay_estranho', customer: 'cus_estranho', value: 89, status: 'CONFIRMED', subscription: 'sub_estranho', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_estranho', customer: 'cus_estranho' });
ok(!assinaturas.get('sub_dono').deleted && conta2().assinaturaAsaas === 'sub_dono' && conta2().plano.tipo === 'anual' && conta2().plano.pagoAte > pagoAteDono, 'e se pagarem: a assinatura anual do dono fica (os dias entram)');
ok(doAdmin().length === adminAntes + 1 && /Duas assinaturas/.test(doAdmin().pop().assunto), 'e o admin recebe e-mail para cancelar uma');

/* pagamento de quem nao tem conta: nao nasce conta fantasma, o admin fica sabendo */
clientes.set('cus_fantasma', { email: 'digitou.errado@x.com' });
cobrancas.set('pay_fantasma', { id: 'pay_fantasma', customer: 'cus_fantasma', value: 89, status: 'RECEIVED' });
adminAntes = doAdmin().length;
r = await avisarCom(envE, { id: 'pay_fantasma', customer: 'cus_fantasma' });
ok(r.status === 200 && !db.get('contas/digitou.errado@x.com') && doAdmin().length === adminAntes + 1 && /digitou\.errado@x\.com/.test(doAdmin().pop().texto), 'pagou com e-mail sem conta: nenhuma conta criada e o admin recebe o e-mail');

/* Cron: conta encerrada por fora (Central) com a assinatura viva: cancela no Asaas */
db.set('contas/porfora@x.com', { email: 'porfora@x.com', assinaturaAsaas: 'sub_fora', plano: { status: 'cancelado' } });
assinaturas.set('sub_fora', { id: 'sub_fora', customer: 'cus_x', status: 'ACTIVE' });
await rodarCron(envE);
ok(assinaturas.get('sub_fora').deleted === true && db.get('contas/porfora@x.com').assinaturaAsaas === '', 'Cron: encerrada pela Central com assinatura viva, cancelada no Asaas');
ok(!/ pra /.test(emails.map((m) => m.texto).join(' ')) && !/—/.test(emails.map((m) => m.texto).join(' ')), 'e-mails do admin sem "pra" e sem travessao');


/* ================= pentest do plano unico (25/09/2026): cada furo achado, fechado ================= */
console.log('Pentest do plano unico');
const novaConta = (email, cus, plano, extra) => { clientes.set(cus, { email: email }); db.set('contas/' + email, Object.assign({ email: email, plano: Object.assign({ status: 'ativo', tipo: 'mensal', planoId: 'uma', planoPago: 'uma', desde: '2026-01-01T00:00:00.000Z' }, plano) }, extra)); db.set('lojas/loja-' + cus, { slug: 'loja-' + cus, donoEmail: email }); };
const contaDe = (email) => db.get('contas/' + email);
const diasDe = (iso) => Math.round((Date.parse(iso) - Date.now()) / DIA);
let c;

/* 1. estorno do anual: a pausa fica mesmo pagando outra coisa, e os dias do anual saem */
novaConta('estorno@x.com', 'cus_est', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_ano', { id: 'pay_ano', customer: 'cus_est', value: 890, status: 'CONFIRMED', subscription: 'sub_ano', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_ano', customer: 'cus_est' });
c = contaDe('estorno@x.com');
ok(diasDe(c.plano.pagoAte) === 365 && c.creditos.length === 1 && c.creditos[0].dias === 365, 'anual pago: 365 dias, anotados no credito daquele pagamento');
cobrancas.get('pay_ano').status = 'CHARGEBACK_REQUESTED';
await avisarCom(envE, { id: 'pay_ano', customer: 'cus_est' }, 'PAYMENT_CHARGEBACK_REQUESTED');
c = contaDe('estorno@x.com');
ok(c.plano.status === 'pausado' && diasDe(c.plano.pagoAte) <= 0 && db.get('lojas/loja-cus_est').plano.status === 'pausado', 'contestou o anual: conta e loja pausadas, e os 365 dias saem');
adminAntes = doAdmin().length;
cobrancas.set('pay_mes_pix', { id: 'pay_mes_pix', customer: 'cus_est', value: 89, status: 'RECEIVED', subscription: 'sub_mes', billingType: 'PIX' });
await avisarCom(envE, { id: 'pay_mes_pix', customer: 'cus_est' });
c = contaDe('estorno@x.com');
ok(c.plano.status === 'pausado' && db.get('lojas/loja-cus_est').plano.status === 'pausado' && diasDe(c.plano.pagoAte) === 30, 'depois pagou o mensal: continua pausada (so a Central tira) e fica so com os 30 dias pagos (' + diasDe(c.plano.pagoAte) + ')');
ok(doAdmin().length === adminAntes + 1 && /pausada/.test(doAdmin()[doAdmin().length - 1].assunto), 'e o admin recebe e-mail do pagamento da conta pausada');

/* 2. pagar atrasado dentro da tolerancia conta do vencimento (antes, os dias do atraso vinham de graca todo mes) */
novaConta('atraso@x.com', 'cus_atr', { pagoAte: new Date(Date.now() - 9 * DIA).toISOString(), ultimoPagamentoEm: '2026-08-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_atr' });
cobrancas.set('pay_atr', { id: 'pay_atr', customer: 'cus_atr', value: 89, status: 'RECEIVED', subscription: 'sub_atr', billingType: 'BOLETO' });
await avisarCom(envE, { id: 'pay_atr', customer: 'cus_atr' });
ok(diasDe(contaDe('atraso@x.com').plano.pagoAte) === 21, 'pagou 9 dias atrasado, com a loja ainda no ar: conta do vencimento (21 dias pela frente, e nao 30)');
novaConta('parado@x.com', 'cus_par', { pagoAte: new Date(Date.now() - 15 * DIA).toISOString(), ultimoPagamentoEm: '2026-08-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_par' });
cobrancas.set('pay_par', { id: 'pay_par', customer: 'cus_par', value: 89, status: 'RECEIVED', subscription: 'sub_par', billingType: 'BOLETO' });
await avisarCom(envE, { id: 'pay_par', customer: 'cus_par' });
ok(diasDe(contaDe('parado@x.com').plano.pagoAte) === 30, 'pagou depois da tolerancia (a loja ja tinha parado): 30 dias a partir de hoje');

/* 3. link de fundador sem vaga: dias proporcionais e a assinatura passa para o preco normal */
db.set('publico/fundadores', { usados: 5 });
novaConta('semvaga@x.com', 'cus_sv', { status: 'teste', desde: new Date(Date.now() - 8 * DIA).toISOString() });
assinaturas.set('sub_sv', { id: 'sub_sv', customer: 'cus_sv', value: 79, cycle: 'MONTHLY', status: 'ACTIVE' });
cobrancas.set('pay_sv', { id: 'pay_sv', customer: 'cus_sv', value: 79, status: 'RECEIVED', subscription: 'sub_sv', billingType: 'PIX' });
adminAntes = doAdmin().length;
await avisarCom(envE, { id: 'pay_sv', customer: 'cus_sv' });
c = contaDe('semvaga@x.com');
ok(c.plano.fundador === false && c.plano.pagamentoParcial && c.plano.pagamentoParcial.motivo === 'fundador-sem-vaga' && diasDe(c.plano.pagoAte) === 26, 'link de fundador sem vaga: 26 dias pelos R$ 79');
ok(assinaturas.get('sub_sv').value === 89 && assinaturas.get('sub_sv').cycle === 'MONTHLY' && doAdmin().length === adminAntes + 1, 'e a assinatura passa para R$ 89 (a proxima fatura ja vem certa), com e-mail ao admin');

/* 4. encerrar: perde o fundador, a assinatura extra tambem para, e a loja recebe o fundador na copia (igual ao site) */
contaTroca({ fundador: true }, { assinaturaAsaas: 'sub_t', assinaturasExtras: ['sub_extra'], assinaturasAntigas: [], assinaturaPendente: '' }); assinaturaT();
assinaturas.set('sub_extra', { id: 'sub_extra', customer: 'cus_estranho', value: 89, cycle: 'MONTHLY', status: 'ACTIVE' });
r = await pedir('encerrar', {}, 'tok-dono');
c = conta2();
ok(r.status === 200 && c.plano.status === 'cancelado' && c.plano.fundador === false && assinaturas.get('sub_extra').deleted === true && c.assinaturasExtras.length === 0 && c.assinaturasAntigas.indexOf('sub_extra') >= 0, 'encerrar: perde o preco de fundador e a assinatura extra tambem e cancelada');
ok(db.get('lojas/loja-troca').plano.fundador === false && db.get('lojas/loja-troca').plano.status === 'cancelado', 'a copia do plano na loja leva o fundador (a mesma da copia do site)');
cobrancas.set('pay_extra_dep', { id: 'pay_extra_dep', customer: 'cus_estranho', value: 89, status: 'CONFIRMED', subscription: 'sub_extra', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_extra_dep', customer: 'cus_estranho' });
ok(cobrancas.get('pay_extra_dep').status === 'REFUNDED' && conta2().plano.status === 'cancelado', 'cobranca da assinatura extra depois de encerrar: devolvida, e a conta continua encerrada');

/* 5. Cron: encerrada pela Central perde o fundador e a extra e cancelada */
db.set('contas/central@x.com', { email: 'central@x.com', assinaturasExtras: ['sub_cx'], plano: { status: 'cancelado', fundador: true } });
assinaturas.set('sub_cx', { id: 'sub_cx', status: 'ACTIVE' });
await rodarCron(envE);
ok(db.get('contas/central@x.com').plano.fundador === false && assinaturas.get('sub_cx').deleted === true && db.get('contas/central@x.com').assinaturasExtras.length === 0, 'Cron: encerrada pela Central perde o fundador e a assinatura extra e cancelada');

/* 6. alguem assina com o e-mail do dono e contesta: os dias dela saem, a loja do dono nao pausa */
novaConta('dono2@x.com', 'cus_d2', { tipo: 'anual', pagoAte: new Date(Date.now() + 200 * DIA).toISOString(), ultimoPagamentoEm: '2026-09-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_d2' });
assinaturas.set('sub_d2', { id: 'sub_d2', customer: 'cus_d2', value: 890, cycle: 'YEARLY', status: 'ACTIVE' });
clientes.set('cus_golpe', { email: 'dono2@x.com' });
cobrancas.set('pay_golpe', { id: 'pay_golpe', customer: 'cus_golpe', value: 89, status: 'CONFIRMED', subscription: 'sub_golpe', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_golpe', customer: 'cus_golpe' });
const comGolpe = contaDe('dono2@x.com').plano.pagoAte;
ok((contaDe('dono2@x.com').assinaturasExtras || []).indexOf('sub_golpe') >= 0, 'assinatura com o e-mail do dono, com a dele viva: vira extra');
cobrancas.get('pay_golpe').status = 'CHARGEBACK_REQUESTED';
await avisarCom(envE, { id: 'pay_golpe', customer: 'cus_golpe' }, 'PAYMENT_CHARGEBACK_REQUESTED');
c = contaDe('dono2@x.com');
ok(c.plano.status === 'ativo' && db.get('lojas/loja-cus_d2').plano.status === 'ativo' && Math.round((Date.parse(comGolpe) - Date.parse(c.plano.pagoAte)) / DIA) === 30, 'e contestou: os 30 dias dela saem, mas a conta e a loja do dono nao pausam');

/* 7. a copia na loja falhou no meio: o Asaas repete e a loja recebe o plano (sem somar dias de novo) */
novaConta('meio@x.com', 'cus_meio', { pagoAte: new Date(Date.now() - 20 * DIA).toISOString(), ultimoPagamentoEm: '2026-08-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_meio2' });
db.set('lojas/loja-cus_meio', { slug: 'loja-cus_meio', donoEmail: 'meio@x.com', plano: { status: 'ativo', pagoAte: new Date(Date.now() - 20 * DIA).toISOString() } });
cobrancas.set('pay_meio', { id: 'pay_meio', customer: 'cus_meio', value: 89, status: 'RECEIVED', subscription: 'sub_meio2', billingType: 'PIX' });
let falharLoja = true;
const fetchAntesDaFalha = globalThis.fetch;
globalThis.fetch = async (u, o) => { if (falharLoja && o && o.method === 'PATCH' && String(u).indexOf('lojas/loja-cus_meio') >= 0) { falharLoja = false; return new Response('{}', { status: 503 }); } return fetchAntesDaFalha(u, o); };
r = await avisarCom(envE, { id: 'pay_meio', customer: 'cus_meio' });
globalThis.fetch = fetchAntesDaFalha;
ok(r.status === 500 && diasDe(db.get('lojas/loja-cus_meio').plano.pagoAte) < 0, 'a copia na loja falhou no meio: 500 (o Asaas tenta de novo)');
const pagoMeio = contaDe('meio@x.com').plano.pagoAte;
r = await avisarCom(envE, { id: 'pay_meio', customer: 'cus_meio' });
ok(r.status === 200 && contaDe('meio@x.com').plano.pagoAte === pagoMeio && db.get('lojas/loja-cus_meio').plano.pagoAte === pagoMeio, 'o Asaas repete: os dias nao somam de novo e a loja recebe o plano pago');

/* 8. cobranca avulsa fora do preco (a loja personalizada) nao vira dias de plano */
novaConta('avulsa@x.com', 'cus_av', { pagoAte: new Date(Date.now() + 5 * DIA).toISOString() });
const pagoAv = contaDe('avulsa@x.com').plano.pagoAte;
cobrancas.set('pay_av', { id: 'pay_av', customer: 'cus_av', value: 390, status: 'RECEIVED', billingType: 'PIX' });
adminAntes = doAdmin().length;
r = await avisarCom(envE, { id: 'pay_av', customer: 'cus_av' });
ok(r.status === 200 && contaDe('avulsa@x.com').plano.pagoAte === pagoAv && doAdmin().length === adminAntes + 1, 'cobranca avulsa de R$ 390: nenhum dia de plano, e o admin fica sabendo');

/* 9. multa e juros de atraso nao mudam o plano: vale o valor original */
db.set('publico/fundadores', { usados: 0 });
novaConta('multa@x.com', 'cus_mu', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_mu', { id: 'pay_mu', customer: 'cus_mu', value: 80.9, originalValue: 79, status: 'RECEIVED', subscription: 'sub_mu', billingType: 'BOLETO' });
await avisarCom(envE, { id: 'pay_mu', customer: 'cus_mu' });
c = contaDe('multa@x.com');
ok(c.plano.fundador === true && !c.plano.pagamentoParcial && diasDe(c.plano.pagoAte) === 30 && db.get('publico/fundadores').usados === 1, 'fundador pagando com multa (R$ 80,90 de R$ 79): 30 dias e a vaga, pelo valor original');

novaConta('multa2@x.com', 'cus_mu2', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_mu2', { id: 'pay_mu2', customer: 'cus_mu2', value: 80.9, status: 'RECEIVED', subscription: 'sub_mu2', billingType: 'BOLETO' });
await avisarCom(envE, { id: 'pay_mu2', customer: 'cus_mu2' });
c = contaDe('multa2@x.com');
ok(c.plano.fundador === true && !c.plano.pagamentoParcial && diasDe(c.plano.pagoAte) === 30, 'e mesmo sem o originalValue (so o valor com multa, ate 10% acima do preco): e o preco de fundador, 30 dias');
novaConta('multa3@x.com', 'cus_mu3', { pagoAte: new Date(Date.now() - 12 * DIA).toISOString(), ultimoPagamentoEm: '2026-08-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_mu3' });
cobrancas.set('pay_mu3', { id: 'pay_mu3', customer: 'cus_mu3', value: 91.67, status: 'RECEIVED', subscription: 'sub_mu3', billingType: 'BOLETO' });
await avisarCom(envE, { id: 'pay_mu3', customer: 'cus_mu3' });
c = contaDe('multa3@x.com');
ok(!c.plano.pagamentoParcial && diasDe(c.plano.pagoAte) === 30 && c.plano.tipo === 'mensal', 'mensal normal pago com multa (R$ 91,67): 30 dias, mensal');

/* 10. o dono encerra bem na hora em que o pagamento grava: o pagamento e refeito com a conta encerrada (e devolvido) */
contaTroca({}, { assinaturaAsaas: 'sub_t', assinaturasAntigas: [], assinaturasExtras: [] }); assinaturaT();
cobrancas.set('pay_corrida', { id: 'pay_corrida', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
globalThis.__antesDoLote = () => { const x = db.get('contas/troca@x.com'); x.plano.status = 'cancelado'; mudou('contas/troca@x.com'); };
r = await avisarCom(envE, { id: 'pay_corrida', customer: 'cus_troca' });
ok(r.status === 200 && conta2().plano.status === 'cancelado' && cobrancas.get('pay_corrida').status === 'REFUNDED', 'encerrou bem na hora do pagamento: a gravacao para, e refeita com a conta encerrada, e devolve');

/* 11. dois pagamentos disputando a ultima vaga de fundador: so um fica com ela */
db.set('publico/fundadores', { usados: 4 });
novaConta('ultimaa@x.com', 'cus_ua', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_ua', { id: 'pay_ua', customer: 'cus_ua', value: 79, status: 'RECEIVED', subscription: 'sub_ua', billingType: 'PIX' });
globalThis.__antesDoLote = () => { db.set('publico/fundadores', { usados: 5 }); mudou('publico/fundadores'); };
await avisarCom(envE, { id: 'pay_ua', customer: 'cus_ua' });
ok(contaDe('ultimaa@x.com').plano.fundador === false && db.get('publico/fundadores').usados === 5, 'a ultima vaga foi pega no meio: este paga o normal e o contador nao passa de 5');


/* ================= revisao antes de publicar (25/09/2026): o que as correcoes podiam quebrar ================= */
console.log('Revisao antes de publicar');

/* PLANOS digitado errado: nada e gravado, 500 (o Asaas tenta de novo) e o admin recebe e-mail */
for (const [nome, errado] of [['sem a chave do fim', '{"uma":{"mensal":8900,"anual":89000,"fm":7900,"fa":79000}'], ['"Uma" maiusculo', '{"Uma":{"mensal":8900,"anual":89000,"fm":7900,"fa":79000}}'], ['preco em reais', '{"uma":{"mensal":89,"anual":890,"fm":79,"fa":790}}']]) {
  const envErrado = Object.assign({}, envE, { PLANOS: errado });
  novaConta('planos@x.com', 'cus_pl', { pagoAte: new Date(Date.now() + 2 * DIA).toISOString() });
  const antesPl = contaDe('planos@x.com').plano.pagoAte;
  cobrancas.set('pay_pl', { id: 'pay_pl', customer: 'cus_pl', value: 5, status: 'RECEIVED', subscription: 'sub_pl', billingType: 'PIX' });
  adminAntes = doAdmin().length;
  r = await avisarCom(envErrado, { id: 'pay_pl', customer: 'cus_pl' });
  ok(r.status === 500 && contaDe('planos@x.com').plano.pagoAte === antesPl && doAdmin().length === adminAntes + 1 && /PLANOS/.test(doAdmin()[doAdmin().length - 1].assunto), 'PLANOS errado (' + nome + '): nenhum dia, 500 para o Asaas tentar de novo e e-mail ao admin');
}

/* a folga da multa nao vale para cobranca avulsa */
novaConta('avulsa2@x.com', 'cus_av2', { pagoAte: new Date(Date.now() + 5 * DIA).toISOString() });
const pagoAv2 = contaDe('avulsa2@x.com').plano.pagoAte;
cobrancas.set('pay_av2', { id: 'pay_av2', customer: 'cus_av2', value: 95, status: 'RECEIVED', billingType: 'PIX' });
r = await avisarCom(envE, { id: 'pay_av2', customer: 'cus_av2' });
ok(r.status === 200 && contaDe('avulsa2@x.com').plano.pagoAte === pagoAv2, 'cobranca avulsa de R$ 95 (dentro da folga de multa do mensal): nenhum dia (a folga e so de assinatura)');

/* valor que nao bate com preco nenhum (link velho de 2 lojas): proporcional ao mensal */
novaConta('duaslojas@x.com', 'cus_dl', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_dl', { id: 'pay_dl', customer: 'cus_dl', value: 217, status: 'RECEIVED', subscription: 'sub_dl', billingType: 'PIX' });
await avisarCom(envE, { id: 'pay_dl', customer: 'cus_dl' });
c = contaDe('duaslojas@x.com');
ok(diasDe(c.plano.pagoAte) === 73 && c.plano.tipo === 'mensal' && c.plano.pagamentoParcial && c.plano.pagamentoParcial.cheio === 8900, 'R$ 217 de um link velho: 73 dias pelo preco do mensal (antes, 89 dias pelo anual)');

/* assinatura extra: a renovacao nao repete o aviso; e quando a do dono morre, a extra que paga vira a da conta e sai das extras */
novaConta('extra@x.com', 'cus_ex', { tipo: 'anual', pagoAte: new Date(Date.now() + 200 * DIA).toISOString(), ultimoPagamentoEm: '2026-09-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_exdono', assinaturasExtras: ['sub_exoutra'] });
assinaturas.set('sub_exdono', { id: 'sub_exdono', value: 890, cycle: 'YEARLY', status: 'ACTIVE' });
cobrancas.set('pay_ex1', { id: 'pay_ex1', customer: 'cus_ex', value: 89, status: 'CONFIRMED', subscription: 'sub_exoutra', billingType: 'CREDIT_CARD' });
adminAntes = doAdmin().length;
await avisarCom(envE, { id: 'pay_ex1', customer: 'cus_ex' });
ok(doAdmin().length === adminAntes && contaDe('extra@x.com').assinaturaAsaas === 'sub_exdono', 'a extra cobrou de novo: os dias entram, sem repetir o aviso de duas assinaturas');
assinaturas.get('sub_exdono').deleted = true;
db.get('contas/extra@x.com').plano.pagoAte = new Date(Date.now() - DIA).toISOString();
cobrancas.set('pay_ex2', { id: 'pay_ex2', customer: 'cus_ex', value: 89, status: 'CONFIRMED', subscription: 'sub_exoutra', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_ex2', customer: 'cus_ex' });
c = contaDe('extra@x.com');
ok(c.assinaturaAsaas === 'sub_exoutra' && c.assinaturasExtras.indexOf('sub_exoutra') < 0, 'a do dono morreu: a extra que paga vira a da conta e sai da lista de extras');

/* adotou a nova, mas o Asaas nao cancelou a velha: ela fica nas extras (o encerrar e o Cron alcancam) e o admin sabe */
novaConta('naocancela@x.com', 'cus_nc', { pagoAte: new Date(Date.now() - DIA).toISOString(), ultimoPagamentoEm: '2026-08-01T00:00:00.000Z' }, { assinaturaAsaas: 'sub_ncvelha' });
assinaturas.set('sub_ncvelha', { id: 'sub_ncvelha', value: 89, cycle: 'MONTHLY', status: 'ACTIVE', naoCancela: true });
cobrancas.set('pay_nc', { id: 'pay_nc', customer: 'cus_nc', value: 89, status: 'CONFIRMED', subscription: 'sub_ncnova', billingType: 'CREDIT_CARD' });
adminAntes = doAdmin().length;
await avisarCom(envE, { id: 'pay_nc', customer: 'cus_nc' });
c = contaDe('naocancela@x.com');
ok(c.assinaturaAsaas === 'sub_ncnova' && c.assinaturasExtras.indexOf('sub_ncvelha') >= 0 && (c.assinaturasAntigas || []).indexOf('sub_ncvelha') < 0 && doAdmin().length === adminAntes + 1, 'a velha nao cancelou no Asaas: fica nas extras (nao nas antigas) e o admin recebe e-mail');

/* assinatura que o Asaas ja tinha cancelado (DELETE responde 400): conta como cancelada */
contaTroca({}, { assinaturaAsaas: 'sub_jacanc', assinaturasAntigas: [], assinaturasExtras: [], assinaturaPendente: '' });
assinaturas.set('sub_jacanc', { id: 'sub_jacanc', value: 89, cycle: 'MONTHLY', status: 'ACTIVE', jaCancelada: true });
r = await pedir('encerrar', {}, 'tok-dono'); j = await r.json();
ok(r.status === 200 && j.cancelada === true && conta2().assinaturaAsaas === '', 'assinatura ja cancelada no Asaas (DELETE 400): o encerrar conta como feito, e o Cron nao tenta todo dia');

/* encerrou bem na hora em que um pagamento adotou uma assinatura nova: essa tambem e cancelada (nao fica cobrando solta) */
contaTroca({}, { assinaturaAsaas: 'sub_t', assinaturasAntigas: [], assinaturasExtras: [], assinaturaPendente: '' }); assinaturaT();
assinaturas.set('sub_corrida2', { id: 'sub_corrida2', value: 89, cycle: 'MONTHLY', status: 'ACTIVE' });
globalThis.__antesDoLote = () => { const x = db.get('contas/troca@x.com'); x.assinaturaAsaas = 'sub_corrida2'; x.assinaturasAntigas = ['sub_t']; mudou('contas/troca@x.com'); };
r = await pedir('encerrar', {}, 'tok-dono');
c = conta2();
ok(r.status === 200 && c.plano.status === 'cancelado' && c.assinaturaAsaas === '' && assinaturas.get('sub_corrida2').deleted === true, 'encerrar no meio de um pagamento: a assinatura nova tambem e cancelada');

/* estorno bem na hora em que um pagamento grava: os dias do pagamento novo nao se perdem */
novaConta('estorno2@x.com', 'cus_e2', { status: 'teste', desde: new Date(Date.now() - 20 * DIA).toISOString() });
cobrancas.set('pay_e2a', { id: 'pay_e2a', customer: 'cus_e2', value: 89, status: 'CONFIRMED', subscription: 'sub_e2', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_e2a', customer: 'cus_e2' });
const pagoE2 = Date.parse(contaDe('estorno2@x.com').plano.pagoAte);
cobrancas.get('pay_e2a').status = 'CHARGEBACK_REQUESTED';
globalThis.__antesDoLote = () => { const x = db.get('contas/estorno2@x.com'); x.plano.pagoAte = new Date(pagoE2 + 30 * DIA).toISOString(); mudou('contas/estorno2@x.com'); };
await avisarCom(envE, { id: 'pay_e2a', customer: 'cus_e2' }, 'PAYMENT_CHARGEBACK_REQUESTED');
c = contaDe('estorno2@x.com');
ok(c.plano.status === 'pausado' && Math.round((Date.parse(c.plano.pagoAte) - pagoE2) / DIA) === 0, 'estorno no meio de um pagamento: refeito com a conta nova (sai so o que o estornado deu)');

/* troca mensal/anual e alguem grava na conta no meio: 409, e a assinatura volta ao valor de antes */
contaTroca({}, { assinaturaAsaas: 'sub_t', assinaturasAntigas: [], assinaturasExtras: [], assinaturaPendente: '' }); assinaturaT();
globalThis.__antesDoLote = () => { mudou('contas/troca@x.com'); };
r = await pedir('trocar', { tipo: 'anual' }, 'tok-dono');
ok(r.status === 409 && assinaturas.get('sub_t').value === 89 && assinaturas.get('sub_t').cycle === 'MONTHLY' && conta2().plano.tipo === 'mensal', 'troca no meio de outra gravacao: 409, e a assinatura volta para o mensal de R$ 89');
contaTroca({}, { assinaturaAsaas: 'sub_t', assinaturasAntigas: [], assinaturasExtras: [], assinaturaPendente: '' }); assinaturaT();
r = await pedir('trocar', { tipo: 'anual' }, 'tok-dono');
ok(r.status === 200 && assinaturas.get('sub_t').value === 890 && assinaturas.get('sub_t').cycle === 'YEARLY' && conta2().plano.tipo === 'anual', 'e sem ninguem no meio, a troca passa normal');

/* Cron: a conta que ja nao precisa de nada nem e lida de novo */
db.set('contas/nada@x.com', { email: 'nada@x.com', plano: { status: 'cancelado', fundador: false }, assinaturaAsaas: '' });
const gravacoesAntes = versoes.get('contas/nada@x.com') || 0;
await rodarCron(envE);
ok((versoes.get('contas/nada@x.com') || 0) === gravacoesAntes, 'Cron: conta encerrada sem nada para fazer nao e gravada');

/* id com caminho escondido */
r = await avisar({ id: '../contas/x', customer: 'cus_1', value: 89 });
ok(r.status === 400, 'id de cobranca com caminho: 400');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
