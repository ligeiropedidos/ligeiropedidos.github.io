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
  /* o Apps Script (e-mail) de mentira: guarda o que mandaria */
  if (endereco.indexOf('https://script.google.com/macros/s/') === 0) {
    const c = JSON.parse(o.body);
    if (c.token !== 'senhaDoEmail12345678901234567890') return resposta({ ok: false, erro: 'token' });
    emails.push(c);
    return resposta({ ok: true });
  }
  if (endereco === BASE + ':runQuery') {
    const q = JSON.parse(o.body).structuredQuery;
    /* contas com fatura em aberto (IN no faturaAsaas.status) */
    if (q.from[0].collectionId === 'contas') {
      const vals = q.where.fieldFilter.value.arrayValue.values.map((v) => v.stringValue);
      const achadas = [...db.entries()].filter(([k, d]) => k.indexOf('contas/') === 0 && d.faturaAsaas && vals.indexOf(d.faturaAsaas.status) >= 0)
        .map(([k, d]) => ({ document: { name: BASE + 'contas/' + encodeURIComponent(k.slice(7)), fields: fs(d).mapValue.fields } }));
      return resposta(achadas.length ? achadas : [{}]);
    }
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

/* fatura do mes (assinatura por Pix ou boleto): o painel mostra, e sai quando paga */
const avisarEvento = (pag, evento) => avisar(pag, undefined, evento);
cobrancas.set('pay_5', { id: 'pay_5', customer: 'cus_1', value: 89, status: 'PENDING', dueDate: '2026-10-20', billingType: 'UNDEFINED', subscription: 'sub_1', invoiceUrl: 'https://www.asaas.com/i/abc123' });
r = await avisarEvento({ id: 'pay_5', customer: 'cus_1' }, 'PAYMENT_CREATED');
conta = db.get('contas/dono@loja.com');
ok(r.status === 200 && conta.faturaAsaas && conta.faturaAsaas.id === 'pay_5' && conta.faturaAsaas.valor === 8900 && conta.faturaAsaas.vencimento === '2026-10-20' && conta.faturaAsaas.url === 'https://www.asaas.com/i/abc123' && conta.assinaturaAsaas === 'sub_1', 'fatura nova da assinatura: fica guardada na conta (valor, vencimento, link)');
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
ok(para('tres@x.com')[0].html.indexOf('/img/email/selo-vence.png') > 0 && para('parando@x.com')[0].html.indexOf('/img/email/selo-parar.png') > 0, 'selo certo em cada aviso (verde vence, vermelho pode parar)');
ok(para('hoje@x.com').length === 1 && /vence hoje/.test(para('hoje@x.com')[0].assunto), 'vence hoje: e-mail');
ok(para('cartao@x.com').length === 0, 'cartao em dia: sem e-mail (e cobrado sozinho)');
ok(para('venceu@x.com').length === 1 && /cartão não passou/.test(para('venceu@x.com')[0].texto), 'cartao que nao passou: e-mail de vencida explicando');
ok(para('parando@x.com').length === 1 && /podem parar/.test(para('parando@x.com')[0].assunto), '7 dias vencida: e-mail de que as lojas podem parar');
ok(para('cancelou@x.com').length === 0 && para('longe@x.com').length === 0, 'conta encerrada e fatura longe de vencer: sem e-mail');
ok(db.get('contas/tres@x.com').faturaAsaas.lembretes.indexOf('d3') >= 0, 'o aviso mandado fica anotado na fatura');
const antesDeRepetir = emails.length;
await rodarCron(envEmail);
ok(emails.length === antesDeRepetir, 'o Cron de novo no mesmo dia: ninguem recebe duas vezes');
ok(!/ pra /.test(emails.map((m) => m.texto).join(' ')) && !/—/.test(emails.map((m) => m.texto + m.html).join(' ')), 'texto sem "pra" e sem travessao');

/* id com caminho escondido */
r = await avisar({ id: '../contas/x', customer: 'cus_1', value: 89 });
ok(r.status === 400, 'id de cobranca com caminho: 400');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
