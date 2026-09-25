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
const cobrancas = new Map();
const clientes = new Map([['cus_1', { email: 'dono@loja.com' }]]);
const BASE = 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/';
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
  /* como o Asaas de verdade nas contas novas: sem User-Agent, 400 */
  if (endereco.indexOf('https://api.asaas.com/') === 0 && !((o.headers || {})['User-Agent'])) return resposta({ errors: [{ code: 'invalid_user_agent' }] }, 400);
  if (endereco.indexOf('https://api.asaas.com/v3/payments/') === 0) {
    const c = cobrancas.get(decodeURIComponent(endereco.split('/').pop()));
    return c ? resposta(c) : resposta({ errors: [] }, 404);
  }
  if (endereco.indexOf('https://api.asaas.com/v3/customers/') === 0) {
    const c = clientes.get(decodeURIComponent(endereco.split('/').pop()));
    return c ? resposta(c) : resposta({ errors: [] }, 404);
  }
  if (endereco === BASE + ':runQuery') {
    const q = JSON.parse(o.body).structuredQuery;
    const valor = q.where.fieldFilter.value.stringValue;
    const linhas = [...db.entries()].filter(([k, d]) => k.indexOf('lojas/') === 0 && k.split('/').length === 2 && d.donoEmail === valor)
      .map(([k]) => ({ document: { name: BASE + k } }));
    return resposta(linhas.length ? linhas : [{}]);
  }
  if (endereco.indexOf(BASE) === 0) {
    const cam = decodeURIComponent(endereco.slice(BASE.length).split('?')[0]);
    if ((o.method || 'GET') === 'GET') { const d = db.get(cam); return d ? resposta({ fields: fs(d).mapValue.fields }) : resposta({}, 404); }
    if (o.method === 'PATCH') {
      const campos = JSON.parse(o.body).fields;
      const atual = db.get(cam) || {};
      Object.keys(campos).forEach((k) => { atual[k] = deFs(campos[k]); });
      db.set(cam, atual);
      return resposta({});
    }
  }
  return resposta({ erro: 'rota de mentira nao existe: ' + endereco }, 500);
};

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }
const avisar = (pag, token, evento) => worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'asaas-access-token': token === undefined ? env.ASAAS_WEBHOOK : token, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: evento || 'PAYMENT_RECEIVED', payment: pag }) }), env);

db.set('lojas/loja-do-ze', { slug: 'loja-do-ze', donoEmail: 'dono@loja.com' });
db.set('publico/fundadores', { usados: 0 });

console.log('Mensageiro do Asaas');
let r = await avisar({ id: 'pay_1', customer: 'cus_1', value: 89 }, 'errado');
ok(r.status === 401, 'token errado: 401');

/* aviso inventado: o Asaas nao conhece essa cobranca */
r = await avisar({ id: 'pay_falso', customer: 'cus_1', value: 890 });
ok(r.status === 200 && !db.get('contas/dono@loja.com'), 'cobranca que o Asaas nao conhece: nenhum dia liberado (e a fila do Asaas nao trava)');
/* Asaas fora do ar: erro (o Asaas tenta de novo), sem detalhe de dentro */
const fetchBom = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).indexOf('api.asaas.com') >= 0 ? new Response('{}', { status: 503 }) : fetchBom(u, o);
r = await avisar({ id: 'pay_x', customer: 'cus_1', value: 89 });
globalThis.fetch = fetchBom;
ok(r.status === 500 && !/Asaas 503|api\.asaas/.test(JSON.stringify(await r.json())), 'Asaas fora do ar: 500 sem detalhe de dentro');

/* aviso diz "pago", o Asaas diz "pendente" */
cobrancas.set('pay_2', { id: 'pay_2', customer: 'cus_1', value: 89, status: 'PENDING' });
r = await avisar({ id: 'pay_2', customer: 'cus_1', value: 89 });
ok(r.status === 200 && !db.get('contas/dono@loja.com'), 'cobranca ainda pendente no Asaas: nenhum dia liberado');

/* aviso com valor inflado: vale o valor do Asaas */
cobrancas.set('pay_3', { id: 'pay_3', customer: 'cus_1', value: 44.5, status: 'RECEIVED', description: 'Ligeiro uma loja' });
r = await avisar({ id: 'pay_3', customer: 'cus_1', value: 890 });
let conta = db.get('contas/dono@loja.com');
ok(r.status === 200 && conta && conta.plano.pagamentoParcial && conta.plano.pagamentoParcial.cobrado === 4450, 'valor inflado no aviso: vale o que o Asaas diz (meio mes, proporcional)');
const dias = Math.round((new Date(conta.plano.pagoAte).getTime() - Date.now()) / 864e5);
ok(dias === 15, 'metade do preco: 15 dias (' + dias + ')');

/* mesmo pagamento duas vezes: nao soma */
const antes = conta.plano.pagoAte;
r = await avisar({ id: 'pay_3', customer: 'cus_1', value: 44.5 });
ok(db.get('contas/dono@loja.com').plano.pagoAte === antes, 'o mesmo pagamento avisado de novo nao soma dias');

/* preco cheio: o mes inteiro, e a loja destrava */
cobrancas.set('pay_4', { id: 'pay_4', customer: 'cus_1', value: 89, status: 'CONFIRMED' });
r = await avisar({ id: 'pay_4', customer: 'cus_1', value: 89 });
conta = db.get('contas/dono@loja.com');
ok(!conta.plano.pagamentoParcial && db.get('lojas/loja-do-ze').plano.status === 'ativo', 'preco cheio: mes inteiro e a loja espelhada ativa');

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

/* id com caminho escondido */
r = await avisar({ id: '../contas/x', customer: 'cus_1', value: 89 });
ok(r.status === 400, 'id de cobranca com caminho: 400');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
