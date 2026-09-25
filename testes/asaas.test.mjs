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
  PLANOS: JSON.stringify({ uma: { mensal: 8900, anual: 89000, fm: 7900, fa: 79000 }, duas: { mensal: 15800, anual: 158000, fm: 14800, fa: 148000 }, tres: { mensal: 22700, anual: 227000, fm: 21700, fa: 217000 } }),
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
      if (!a || a.deleted) return resposta({ errors: [] }, 404);
      if (metodo === 'PUT') { Object.assign(a, { value: corpo.value, cycle: corpo.cycle }); return resposta(a); }
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
  if (endereco === BASE + ':runQuery') {
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
  if (endereco.indexOf(BASE) === 0) {
    const cam = decodeURIComponent(endereco.slice(BASE.length).split('?')[0]);
    if ((o.method || 'GET') === 'GET') {
      if (aoLerConta && cam.indexOf('contas/') === 0) aoLerConta(cam);
      const d = db.get(cam);
      return d ? resposta({ fields: fs(d).mapValue.fields }) : resposta({}, 404);
    }
    if (o.method === 'PATCH') {
      /* como o Firestore: so os caminhos da mascara mudam, e "plano.pagoAte" mexe so dentro do mapa */
      const mascara = new URL(endereco).searchParams.getAll('updateMask.fieldPaths');
      const corpo = deFs({ mapValue: { fields: JSON.parse(o.body).fields } });
      const atual = db.get(cam) || {};
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
ok(para('parando@x.com').length === 1 && /podem parar/.test(para('parando@x.com')[0].assunto), '7 dias vencida: e-mail de que as lojas podem parar');
ok(para('cancelou@x.com').length === 0 && para('longe@x.com').length === 0, 'conta encerrada e fatura longe de vencer: sem e-mail');
ok(db.get('contas/tres@x.com').faturaAsaas.lembretes.indexOf('d3') >= 0, 'o aviso mandado fica anotado na fatura');
const antesDeRepetir = emails.length;
await rodarCron(envEmail);
ok(emails.length === antesDeRepetir, 'o Cron de novo no mesmo dia: ninguem recebe duas vezes');
ok(!/ pra /.test(emails.map((m) => m.texto).join(' ')) && !/—/.test(emails.map((m) => m.texto + m.html).join(' ')), 'texto sem "pra" e sem travessao');

/* ================= troca de plano, encerrar e a rede de seguranca dos pagamentos ================= */
console.log('Troca de plano e encerramento');
const envE = envEmail;
const DIA = 864e5;
const pedir = (rota, corpo, token, origem, metodo) => worker.fetch(new Request('https://w/plano/' + rota, { method: metodo || 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: origem || 'https://ligeiropedidos.com.br' }, token ? { Authorization: 'Bearer ' + token } : {}), body: metodo === 'OPTIONS' ? undefined : JSON.stringify(corpo || {}) }), envE);
const avisarCom = (e, pag, evento) => worker.fetch(new Request('https://w/', { method: 'POST', headers: { 'asaas-access-token': e.ASAAS_WEBHOOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: evento || 'PAYMENT_RECEIVED', payment: pag }) }), e);
const doAdmin = () => emails.filter((m) => m.para === 'ligeiro.pedidos@gmail.com');
const contaTroca = (plano, extra) => db.set('contas/troca@x.com', Object.assign({ email: 'troca@x.com', assinaturaAsaas: 'sub_t', clienteAsaas: 'cus_troca', plano: Object.assign({ status: 'ativo', tipo: 'mensal', planoId: 'uma', planoPago: 'uma', desde: '2026-01-01T00:00:00.000Z', pagoAte: new Date(Date.now() + 15 * DIA - 60e3).toISOString() }, plano) }, extra));
const assinaturaT = (o) => assinaturas.set('sub_t', Object.assign({ id: 'sub_t', customer: 'cus_troca', value: 89, cycle: 'MONTHLY', nextDueDate: '2026-10-10', status: 'ACTIVE' }, o));
clientes.set('cus_troca', { email: 'troca@x.com' });
db.set('lojas/loja-troca', { slug: 'loja-troca', donoEmail: 'troca@x.com' });
contaTroca(); assinaturaT();
const conta2 = () => db.get('contas/troca@x.com');
const feitas = (metodo, parte) => chamadas.filter((c) => c.metodo === metodo && c.cam.indexOf(parte) >= 0);

/* quem pode chamar */
r = await pedir('simular', { planoId: 'duas', tipo: 'mensal' });
ok(r.status === 401, 'sem login: 401');
r = await pedir('simular', { planoId: 'duas', tipo: 'mensal' }, 'tok-inventado');
ok(r.status === 401, 'token inventado: 401');
r = await pedir('simular', { planoId: 'duas', tipo: 'mensal' }, 'tok-naoconferido');
ok(r.status === 401, 'e-mail nao conferido (conta criada com o e-mail de outro): 401');
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-equipe');
ok(r.status === 403, 'login da equipe nao mexe na assinatura: 403');
r = await pedir('simular', {}, null, 'https://ligeiropedidos.com.br', 'OPTIONS');
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://ligeiropedidos.com.br', 'o site pergunta antes (CORS): liberado so para o site');
r = await pedir('simular', {}, null, 'https://golpe.com', 'OPTIONS');
ok(r.headers.get('Access-Control-Allow-Origin') === 'null', 'outro site: o navegador nao deixa chamar');
r = await pedir('apagar-tudo', {}, 'tok-dono');
ok(r.status === 404, 'rota que nao existe: 404');
for (const [corpo, nome] of [[{ planoId: 'mil', tipo: 'mensal' }, 'plano inventado'], [{ planoId: '__proto__', tipo: 'mensal' }, 'plano "__proto__"'], [{ planoId: 'duas', tipo: 'semanal' }, 'tipo inventado'], [{ planoId: 'cinco', tipo: 'mensal' }, 'plano escondido que nao esta a venda']]) {
  r = await pedir('trocar', corpo, 'tok-dono');
  ok(r.status === 400, nome + ': 400 e nada muda');
}
ok(chamadas.length === 0 && conta2().plano.planoId === 'uma', 'nenhuma das chamadas erradas mexeu no Asaas ou na conta');

/* simular nao mexe em nada */
let j = await (await pedir('simular', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.ok && j.acao === 'diferenca' && j.diferenca === 3450 && j.dias === 15 && j.valorNovo === 15800, 'simular 1 -> 2 lojas com 15 dias: diferenca de R$ 34,50 e R$ 158 depois (' + JSON.stringify(j) + ')');
ok(chamadas.length === 0 && !conta2().trocaPlano && assinaturas.get('sub_t').value === 89, 'simular nao cria cobranca nem muda a assinatura');

/* trocar: cobra a diferenca, a assinatura passa para o valor novo, as lojas a mais ainda nao */
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
const dif = conta2().trocaPlano;
const criada = cobrancas.get(dif && dif.id);
ok(j.ok && j.acao === 'diferenca' && j.url === 'https://www.asaas.com/i/' + dif.id, 'trocar: devolve o link da diferenca');
ok(criada && criada.value === 34.5 && criada.customer === 'cus_troca' && criada.billingType === 'UNDEFINED' && criada.externalReference === 'troca|troca@x.com|duas', 'a diferenca e uma cobranca avulsa do cliente certo, com o valor certo');
ok(assinaturas.get('sub_t').value === 158 && feitas('PUT', '/subscriptions/sub_t')[0].corpo.updatePendingPayments === true, 'a MESMA assinatura passa para R$ 158 (e a fatura pendente junto)');
ok(feitas('POST', '/subscriptions').length === 0, 'nenhuma assinatura nova criada (nada de cobrar em dobro)');
ok(clientes.get('cus_troca').notificationDisabled === true, 'o cliente fica sem os avisos pagos do Asaas');
ok(conta2().plano.planoId === 'duas' && conta2().plano.planoPago === 'uma', 'a escolha vira 2 lojas, mas o pago continua 1 ate a diferenca cair');
const antesDeRepetirTroca = chamadas.length;
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.url === 'https://www.asaas.com/i/' + dif.id && chamadas.length === antesDeRepetirTroca, 'pedir a mesma troca de novo (clique duplo): a mesma cobranca, nenhuma nova');

/* a diferenca cai: 2 lojas valem, os dias nao mudam */
const pagoAteAntes = conta2().plano.pagoAte;
criada.status = 'RECEIVED';
r = await avisarCom(envE, { id: dif.id, customer: 'cus_troca' });
ok(conta2().plano.planoPago === 'duas' && conta2().plano.pagoAte === pagoAteAntes && !conta2().trocaPlano, 'diferenca paga: 2 lojas liberadas, sem somar dias');
ok(db.get('lojas/loja-troca').plano.planoPago === 'duas' && db.get('vitrine/loja-troca').plano.planoPago === 'duas', 'a loja e a vitrine ficam sabendo');
r = await avisarCom(envE, { id: dif.id, customer: 'cus_troca' });
ok((await r.json()).repetido === dif.id, 'o mesmo aviso de novo: nada muda');

/* sobe para 3, desiste e desce para 1: a diferenca de 3 sai do Asaas; descer vale na proxima fatura */
j = await (await pedir('trocar', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
const dif3 = conta2().trocaPlano;
ok(j.acao === 'diferenca' && j.diferenca === 3450 && dif3.para === 'tres', '2 -> 3 lojas: diferenca so do que falta (R$ 34,50)');
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && cobrancas.get(dif3.id).deleted === true && !conta2().trocaPlano, 'desceu antes de pagar: a diferenca de 3 lojas e apagada no Asaas');
ok(j.desce && assinaturas.get('sub_t').value === 89 && conta2().plano.planoPago === 'uma' && conta2().plano.planoId === 'uma' && conta2().cicloPago.plano === 'duas', 'descer: o limite desce na hora (ninguem reabre loja e paga menos) e R$ 89 so na proxima fatura');
j = await (await pedir('simular', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'agora' && j.diferenca === 0, 'desceu e quer voltar no mesmo ciclo: 2 lojas ja estavam pagas, volta sem cobrar');
/* a diferenca apagada era paga mesmo assim (corrida): devolve e nao sobe */
cobrancas.set(dif3.id, Object.assign(cobrancas.get(dif3.id), { deleted: false, status: 'RECEIVED', billingType: 'PIX' }));
r = await avisarCom(envE, { id: dif3.id, customer: 'cus_troca' });
ok(cobrancas.get(dif3.id).status === 'REFUNDED' && conta2().plano.planoPago === 'uma' && conta2().plano.planoId === 'uma', 'diferenca velha paga depois: devolvida sozinha, a escolha do dono fica');
/* o Asaas avisa a devolucao que o proprio Ligeiro fez: nao pausa a conta */
r = await avisarCom(envE, { id: dif3.id, customer: 'cus_troca' }, 'PAYMENT_REFUNDED');
ok(conta2().plano.status === 'ativo', 'devolucao feita pelo Ligeiro chega como estorno: a conta nao e pausada');

/* lojas que nao cabem, conta atrasada, pausada */
db.set('lojas/loja-troca-2', { slug: 'loja-troca-2', donoEmail: 'troca@x.com' });
db.set('lojas/loja-troca-3', { slug: 'loja-troca-3', donoEmail: 'troca@x.com' });
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
ok(r.status === 409 && /3 lojas/.test((await r.json()).erro), 'com 3 lojas nao desce para 2: 409 (contado no servidor)');
db.delete('lojas/loja-troca-2'); db.delete('lojas/loja-troca-3');
contaTroca({ pagoAte: new Date(Date.now() - 2 * DIA).toISOString() }); assinaturaT();
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
ok(r.status === 409 && /fatura em aberto/.test((await r.json()).erro), 'atrasada: primeiro paga a fatura (409)');
contaTroca({ status: 'pausado' });
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
ok(r.status === 409, 'pausada pelo admin: nao troca');

/* poucos dias: diferenca menor que R$ 5 libera na hora, sem cobrar */
contaTroca({ pagoAte: new Date(Date.now() + DIA - 60e3).toISOString() }); assinaturaT();
let criadasAntes = feitas('POST', '/payments').length;
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'agora' && conta2().plano.planoPago === 'duas' && feitas('POST', '/payments').length === criadasAntes && assinaturas.get('sub_t').value === 158, 'falta 1 dia: diferenca de R$ 2,30 nao e cobrada, 2 lojas na hora e R$ 158 na proxima');

/* anual e fundador */
contaTroca({ tipo: 'anual', pagoAte: new Date(Date.now() + 300 * DIA - 60e3).toISOString() }); assinaturaT({ value: 890, cycle: 'YEARLY' });
j = await (await pedir('simular', { planoId: 'duas', tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'diferenca' && j.diferenca === Math.round(69000 * 300 / 365), 'anual com 300 dias: diferenca proporcional ao ano (' + j.diferenca + ')');
contaTroca({ fundador: true }); assinaturaT({ value: 79 });
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.valorNovo === 14800 && assinaturas.get('sub_t').value === 148 && j.diferenca === 3450, 'fundador sobe com preco de fundador (R$ 148 depois)');
/* mensal para anual, mesmo plano: so na proxima fatura */
contaTroca(); assinaturaT();
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'anual' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && assinaturas.get('sub_t').cycle === 'YEARLY' && assinaturas.get('sub_t').value === 890, 'mensal -> anual: a proxima fatura ja vem anual (R$ 890)');

/* sem assinatura (teste gratis) ou assinatura sumida no Asaas: so marca a escolha */
db.set('contas/troca@x.com', { email: 'troca@x.com', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date().toISOString() } });
const chamadasAntes = chamadas.length;
j = await (await pedir('trocar', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'marcar' && conta2().plano.planoId === 'tres' && chamadas.length === chamadasAntes, 'no teste gratis: so marca a escolha, sem mexer no Asaas');
contaTroca(); assinaturas.delete('sub_t');
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'marcar' && conta2().assinaturaAsaas === '' && conta2().assinaturasAntigas.indexOf('sub_t') >= 0, 'assinatura apagada no Asaas: a conta esquece ela e o proximo pagamento abre outra');

/* o Asaas grava na conta logo depois do PUT (fatura atualizada): a troca nao pode falhar por isso */
contaTroca({ planoId: 'uma' }, { trocaPlano: null }); assinaturaT();
let leituras = 0;
aoLerConta = (cam) => { if (cam === 'contas/troca@x.com' && ++leituras === 2) db.set(cam, Object.assign(db.get(cam), { faturaAsaas: { id: 'pay_x', status: 'PENDING' } })); };
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
aoLerConta = null;
ok(j.ok && j.acao === 'diferenca' && conta2().trocaPlano && conta2().faturaAsaas, 'o Asaas mexeu na conta no meio (fatura): a troca vai, e nada do Asaas se perde');
/* outra aba fez outra troca no meio: a nossa diferenca sai e o dono confere */
contaTroca({ planoId: 'uma' }, { trocaPlano: null }); assinaturaT();
criadasAntes = feitas('POST', '/payments').length;
leituras = 0;
aoLerConta = (cam) => { if (cam === 'contas/troca@x.com' && ++leituras === 2) db.set(cam, Object.assign(db.get(cam), { trocaPlano: { id: 'pay_outra_aba', para: 'tres', url: 'https://www.asaas.com/i/outra' } })); };
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
aoLerConta = null;
const orfa = feitas('POST', '/payments').slice(criadasAntes)[0];
ok(r.status === 409 && conta2().trocaPlano.id === 'pay_outra_aba', 'outra aba trocou no meio: 409, a troca dela fica');
ok(orfa && cobrancas.get([...cobrancas.keys()].filter((k) => cobrancas.get(k).externalReference === 'troca|troca@x.com|duas').pop()).deleted === true, 'a diferenca criada nessa hora foi apagada (ninguem fica com cobranca solta)');
/* pedir a mesma troca de novo quando a cobranca dela sumiu no Asaas: cria outra, nao devolve link morto */
contaTroca({}, { trocaPlano: null }); assinaturaT();
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
const sumiu = conta2().trocaPlano.id;
cobrancas.get(sumiu).deleted = true;
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.url && conta2().trocaPlano.id !== sumiu && !cobrancas.get(conta2().trocaPlano.id).deleted, 'a diferenca guardada sumiu no Asaas: a mesma troca cria uma nova (nunca link morto)');

/* encerrar: cancela a assinatura no Asaas; cobranca depois disso e devolvida */
contaTroca({}, { faturaAsaas: { id: 'pay_fat', status: 'PENDING' } }); assinaturaT();
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
const difEnc = conta2().trocaPlano;
j = await (await pedir('encerrar', {}, 'tok-dono')).json();
ok(j.ok && j.cancelada && assinaturas.get('sub_t').deleted === true, 'encerrar: a assinatura e cancelada no Asaas (o cartao nao cobra mais)');
ok(conta2().plano.status === 'cancelado' && conta2().assinaturaAsaas === '' && conta2().faturaAsaas === null && !conta2().trocaPlano && cobrancas.get(difEnc.id).deleted === true, 'conta encerrada, sem fatura nem diferenca pendurada');
ok(db.get('lojas/loja-troca').plano.status === 'cancelado', 'a loja fica sabendo (no ar ate o fim do pago)');
cobrancas.set('pay_depois', { id: 'pay_depois', customer: 'cus_troca', value: 158, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
const pagoAteEnc = conta2().plano.pagoAte;
r = await avisarCom(envE, { id: 'pay_depois', customer: 'cus_troca' });
ok(cobrancas.get('pay_depois').status === 'REFUNDED' && conta2().plano.status === 'cancelado' && conta2().plano.pagoAte === pagoAteEnc, 'cartao cobrou depois de encerrar: devolvido sozinho, sem dias');
cobrancas.set('pay_boleto', { id: 'pay_boleto', customer: 'cus_troca', value: 158, status: 'RECEIVED', subscription: 'sub_t', billingType: 'BOLETO' });
const adminAntes = doAdmin().length;
r = await avisarCom(envE, { id: 'pay_boleto', customer: 'cus_troca' });
ok(conta2().plano.status === 'ativo' && conta2().assinaturaAsaas === '' && doAdmin().length === adminAntes + 1, 'boleto pago depois de encerrar (sem estorno pela API): os dias entram e o admin recebe e-mail');
cobrancas.set('pay_dif_enc', { id: 'pay_dif_enc', customer: 'cus_troca', value: 34.5, status: 'RECEIVED', billingType: 'PIX', externalReference: 'troca|troca@x.com|duas' });
contaTroca({ status: 'cancelado' }, { assinaturaAsaas: '' });
r = await avisarCom(envE, { id: 'pay_dif_enc', customer: 'cus_troca' });
ok(cobrancas.get('pay_dif_enc').status === 'REFUNDED' && conta2().plano.planoPago === 'uma', 'diferenca paga com a conta encerrada: devolvida');

/* uma assinatura so: pagou por uma nova, a velha e cancelada */
contaTroca({}, { assinaturaAsaas: 'sub_velha', assinaturasAntigas: [] });
assinaturas.set('sub_velha', { id: 'sub_velha', customer: 'cus_troca', value: 89, cycle: 'MONTHLY', status: 'ACTIVE' });
cobrancas.set('pay_novasub', { id: 'pay_novasub', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_nova', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_novasub', customer: 'cus_troca' });
ok(assinaturas.get('sub_velha').deleted === true && conta2().assinaturaAsaas === 'sub_nova' && conta2().assinaturasAntigas.indexOf('sub_velha') >= 0, 'pagou uma assinatura nova: a velha e cancelada no Asaas (nunca duas cobrando)');
cobrancas.set('pay_atrasado', { id: 'pay_atrasado', customer: 'cus_troca', value: 89, status: 'RECEIVED', subscription: 'sub_velha', billingType: 'BOLETO' });
const pagoAteNova = conta2().plano.pagoAte;
r = await avisarCom(envE, { id: 'pay_atrasado', customer: 'cus_troca' });
ok(conta2().assinaturaAsaas === 'sub_nova' && conta2().plano.pagoAte > pagoAteNova, 'boleto atrasado da velha pago depois: os dias entram e a atual continua a nova');
cobrancas.set('pay_fat_velha', { id: 'pay_fat_velha', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-01', subscription: 'sub_velha', invoiceUrl: 'https://www.asaas.com/i/velha' });
await avisarCom(envE, { id: 'pay_fat_velha', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(!conta2().faturaAsaas || conta2().faturaAsaas.id !== 'pay_fat_velha', 'fatura da assinatura velha nao aparece no painel');
cobrancas.set('pay_fat_outra', { id: 'pay_fat_outra', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-02', subscription: 'sub_terceira', invoiceUrl: 'https://www.asaas.com/i/outra' });
await avisarCom(envE, { id: 'pay_fat_outra', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(conta2().assinaturaAsaas === 'sub_nova', 'fatura de outra assinatura (ainda nao paga) nao troca a assinatura da conta');

/* pagamento de quem nao tem conta: nao nasce conta fantasma, o admin fica sabendo */
clientes.set('cus_fantasma', { email: 'digitou.errado@x.com' });
cobrancas.set('pay_fantasma', { id: 'pay_fantasma', customer: 'cus_fantasma', value: 89, status: 'RECEIVED' });
const adminAntes2 = doAdmin().length;
r = await avisarCom(envE, { id: 'pay_fantasma', customer: 'cus_fantasma' });
ok(r.status === 200 && !db.get('contas/digitou.errado@x.com') && doAdmin().length === adminAntes2 + 1 && /digitou\.errado@x\.com/.test(doAdmin().pop().texto), 'pagou com e-mail sem conta: nenhuma conta criada e o admin recebe o e-mail');
/* diferenca com e-mail de outra conta na referencia: nao sobe ninguem */
db.set('contas/outro@x.com', { email: 'outro@x.com', plano: { status: 'ativo', planoId: 'uma', planoPago: 'uma' } });
cobrancas.set('pay_dif_troca', { id: 'pay_dif_troca', customer: 'cus_troca', value: 34.5, status: 'RECEIVED', externalReference: 'troca|outro@x.com|tres' });
r = await avisarCom(envE, { id: 'pay_dif_troca', customer: 'cus_troca' });
ok(db.get('contas/outro@x.com').plano.planoPago === 'uma' && conta2().plano.planoPago === 'uma', 'referencia da diferenca com o e-mail de outra conta: ninguem sobe');

/* Cron: conta encerrada por fora (Central) com a assinatura viva: cancela no Asaas */
db.set('contas/porfora@x.com', { email: 'porfora@x.com', assinaturaAsaas: 'sub_fora', plano: { status: 'cancelado' } });
assinaturas.set('sub_fora', { id: 'sub_fora', customer: 'cus_x', status: 'ACTIVE' });
await rodarCron(envE);
ok(assinaturas.get('sub_fora').deleted === true && db.get('contas/porfora@x.com').assinaturaAsaas === '', 'Cron: encerrada pela Central com assinatura viva, cancelada no Asaas');
ok(!/ pra /.test(emails.map((m) => m.texto).join(' ')) && !/—/.test(emails.map((m) => m.texto).join(' ')), 'e-mails do admin sem "pra" e sem travessao');

/* ============ os buracos da revisao independente (cada um provado antes, agora fechado) ============ */
console.log('Revisao: cenarios provados');
/* 1: anual pago, troca para mensal (proxima fatura) e depois sobe: a diferenca e pelo preco do ANO pago */
contaTroca({ tipo: 'anual', tipoPago: 'anual', pagoAte: new Date(Date.now() + 360 * DIA - 60e3).toISOString() }, { cicloPago: { plano: 'uma', tipo: 'anual' }, trocaPlano: null });
assinaturaT({ value: 890, cycle: 'YEARLY' });
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && assinaturas.get('sub_t').cycle === 'MONTHLY', 'anual -> mensal: a assinatura ja cobra mensal na proxima (fim do ano)');
j = await (await pedir('simular', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'diferenca' && j.diferenca === Math.round((227000 - 89000) * 360 / 365), 'e depois sobe para 3: diferenca pelo ano pago, 360 dias (R$ ' + (j.diferenca / 100) + '), e nao R$ 138 do mes');

/* 2C: sobe com diferenca aberta e paga a proxima fatura adiantado (ja no valor maior): nao libera antes, a diferenca fica */
contaTroca({ pagoAte: new Date(Date.now() + 29 * DIA - 60e3).toISOString() }, { cicloPago: { plano: 'uma', tipo: 'mensal' }, trocaPlano: null, planoProximo: null });
assinaturaT();
j = await (await pedir('trocar', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
const difC = conta2().trocaPlano;
cobrancas.set('pay_adiantado', { id: 'pay_adiantado', customer: 'cus_troca', value: 227, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_adiantado', customer: 'cus_troca' });
ok(conta2().plano.planoPago === 'uma' && conta2().planoProximo && conta2().planoProximo.id === 'tres' && conta2().trocaPlano && conta2().trocaPlano.id === difC.id && !cobrancas.get(difC.id).deleted, 'pagou adiantado o mes seguinte de 3 lojas: 3 lojas so no mes seguinte, e a diferenca de agora continua');
/* o Cron vira quando chega a hora, e a diferenca que sobrou sai */
db.set('contas/troca@x.com', Object.assign(conta2(), { planoProximo: Object.assign(conta2().planoProximo, { desde: new Date(Date.now() - 60e3).toISOString() }) }));
await rodarCron(envE);
ok(conta2().plano.planoPago === 'tres' && !conta2().planoProximo && !conta2().trocaPlano && cobrancas.get(difC.id).deleted === true && db.get('lojas/loja-troca').plano.planoPago === 'tres', 'Cron: chegou o mes pago, 3 lojas valem; a diferenca que ninguem pagou sai do Asaas');

/* 2E: anual de 1 loja pago e paga um link de 3 lojas mensal: 3 lojas so quando o ano acabar */
contaTroca({ tipo: 'anual', tipoPago: 'anual', pagoAte: new Date(Date.now() + 360 * DIA).toISOString() }, { cicloPago: { plano: 'uma', tipo: 'anual' }, trocaPlano: null, planoProximo: null, assinaturaAsaas: 'sub_t' });
assinaturaT({ value: 890, cycle: 'YEARLY' });
cobrancas.set('pay_link3', { id: 'pay_link3', customer: 'cus_troca', value: 227, status: 'CONFIRMED', subscription: 'sub_link3', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_link3', customer: 'cus_troca' });
ok(conta2().plano.planoPago === 'uma' && conta2().planoProximo.id === 'tres' && conta2().plano.planoId === 'tres' && assinaturas.get('sub_t').deleted === true, 'anual de 1 loja paga link de 3 lojas: 3 lojas so no fim do ano (a escolha e a assinatura nova ficam)');

/* 5: encerrada assina de novo pelo link: a fatura nao amarra, o pagamento reativa (nada de devolver) */
contaTroca({ status: 'cancelado' }, { assinaturaAsaas: '', assinaturasAntigas: ['sub_t'], trocaPlano: null, planoProximo: null, faturaAsaas: null });
cobrancas.set('pay_volta_fat', { id: 'pay_volta_fat', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-05', subscription: 'sub_volta', invoiceUrl: 'https://www.asaas.com/i/volta' });
await avisarCom(envE, { id: 'pay_volta_fat', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(conta2().assinaturaAsaas === '' && conta2().faturaAsaas.id === 'pay_volta_fat', 'encerrada assina de novo: a fatura aparece, mas a assinatura so amarra quando pagar');
await rodarCron(envE);
ok(!assinaturas.has('sub_volta') || !assinaturas.get('sub_volta').deleted, 'o Cron nao cancela a assinatura nova de quem esta voltando');
cobrancas.set('pay_volta', { id: 'pay_volta', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_volta', billingType: 'CREDIT_CARD' });
r = await avisarCom(envE, { id: 'pay_volta', customer: 'cus_troca' });
ok(cobrancas.get('pay_volta').status === 'CONFIRMED' && conta2().plano.status === 'ativo' && conta2().assinaturaAsaas === 'sub_volta', 'encerrada que pagou de novo: reativada (nao devolvida)');

/* 7: loja fechada nao conta para descer */
contaTroca({ planoId: 'duas', planoPago: 'duas' }, { cicloPago: { plano: 'duas', tipo: 'mensal' }, trocaPlano: null, planoProximo: null, assinaturaAsaas: 'sub_t' });
assinaturaT({ value: 158 });
db.set('lojas/loja-troca-fechada', { slug: 'loja-troca-fechada', donoEmail: 'troca@x.com', ativa: false });
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.ok && j.acao === 'proxima', 'loja fechada nao conta: com 1 aberta e 1 fechada, desce para 1 loja');
db.delete('lojas/loja-troca-fechada');

/* 8: fundador pelo link, ainda sem a primeira paga, troca de plano: continua com o preco de fundador */
db.set('contas/troca@x.com', { email: 'troca@x.com', assinaturaAsaas: 'sub_t', clienteAsaas: 'cus_troca', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date().toISOString() } });
assinaturaT({ value: 79 });
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && j.valorNovo === 14800 && assinaturas.get('sub_t').value === 148, 'fundador pelo link, antes da primeira: troca para 2 lojas por R$ 148 (preco de fundador)');

/* pagamento nao desfaz a escolha feita no mesmo instante (grava so os campos dele) */
contaTroca({ planoId: 'tres' }, { cicloPago: { plano: 'uma', tipo: 'mensal' }, trocaPlano: null, planoProximo: null, assinaturaAsaas: 'sub_t' });
assinaturaT();
cobrancas.set('pay_renova', { id: 'pay_renova', customer: 'cus_troca', value: 89, status: 'RECEIVED', subscription: 'sub_t', billingType: 'PIX' });
r = await avisarCom(envE, { id: 'pay_renova', customer: 'cus_troca' });
ok(conta2().plano.planoId === 'tres', 'renovacao cai: a escolha do dono (planoId) nao volta atras');

/* ============ segunda rodada da revisao ============ */
console.log('Revisao 2');
const limpaTroca = { trocaPlano: null, planoProximo: null, cicloPago: null, assinaturaAsaas: 'sub_t', assinaturaPendente: '' };
/* 1: conta paga antes do cicloPago existir: anual -> mensal e depois sobe, a diferenca e pelo ano */
contaTroca({ tipo: 'anual', pagoAte: new Date(Date.now() + 360 * DIA - 60e3).toISOString() }, limpaTroca);
assinaturaT({ value: 890, cycle: 'YEARLY' });
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'mensal' }, 'tok-dono')).json();
ok(conta2().cicloPago && conta2().cicloPago.tipo === 'anual' && conta2().cicloPago.plano === 'uma', 'conta antiga: a primeira troca grava o ciclo pago (anual), lido antes de mudar a assinatura');
j = await (await pedir('simular', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.diferenca === Math.round((227000 - 89000) * 360 / 365), 'e depois sobe: diferenca pelo ano pago (R$ ' + (j.diferenca / 100) + ')');
/* conta antiga desce e volta: o que ja estava pago no ciclo nao se cobra de novo */
contaTroca({ planoId: 'duas', planoPago: 'duas' }, limpaTroca); assinaturaT({ value: 158 });
j = await (await pedir('trocar', { planoId: 'uma', tipo: 'mensal' }, 'tok-dono')).json();
j = await (await pedir('simular', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'agora' && j.diferenca === 0, 'conta antiga desce e volta no mesmo ciclo: sem cobrar de novo');

/* 3: com o proximo mes ja pago (3 lojas) e 15 dias sobrando, a diferenca e so dos 15 dias */
contaTroca({ pagoAte: new Date(Date.now() + 45 * DIA - 60e3).toISOString() }, Object.assign({}, limpaTroca, { cicloPago: { plano: 'uma', tipo: 'mensal' }, planoProximo: { id: 'tres', tipo: 'mensal', desde: new Date(Date.now() + 15 * DIA - 60e3).toISOString(), pagamento: 'pay_prox' } }));
assinaturaT({ value: 227 });
j = await (await pedir('simular', { planoId: 'tres', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'diferenca' && j.dias === 15 && j.diferenca === 6900, 'mes seguinte ja pago em 3 lojas: a diferenca e so dos 15 dias de agora (R$ 69), nao dos 45');

/* 4: dois planos diferentes pagos adiantado: fica o menor e o admin recebe e-mail */
contaTroca({ pagoAte: new Date(Date.now() + 15 * DIA).toISOString() }, Object.assign({}, limpaTroca, { cicloPago: { plano: 'uma', tipo: 'mensal' } }));
assinaturaT();
cobrancas.set('pay_ad3', { id: 'pay_ad3', customer: 'cus_troca', value: 227, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_ad3', customer: 'cus_troca' });
const adminAntes3 = doAdmin().length;
cobrancas.set('pay_ad1', { id: 'pay_ad1', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_ad1', customer: 'cus_troca' });
ok(conta2().planoProximo.id === 'uma' && doAdmin().length === adminAntes3 + 1, 'pagou adiantado 3 lojas e depois 1: fica o menor e o admin confere (ninguem ganha loja sem pagar)');

/* 5: o pagamento adiantado foi contestado: o plano agendado sai, e conta pausada nao vira */
contaTroca({ pagoAte: new Date(Date.now() + 15 * DIA).toISOString() }, Object.assign({}, limpaTroca, { cicloPago: { plano: 'uma', tipo: 'mensal' } }));
cobrancas.set('pay_ad3b', { id: 'pay_ad3b', customer: 'cus_troca', value: 227, status: 'CONFIRMED', subscription: 'sub_t', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_ad3b', customer: 'cus_troca' });
ok(conta2().planoProximo && conta2().planoProximo.pagamento === 'pay_ad3b', 'pagou adiantado: o plano agendado guarda qual pagamento foi');
cobrancas.get('pay_ad3b').status = 'CHARGEBACK_REQUESTED';
await avisarCom(envE, { id: 'pay_ad3b', customer: 'cus_troca' }, 'PAYMENT_CHARGEBACK_REQUESTED');
ok(conta2().plano.status === 'pausado' && !conta2().planoProximo, 'contestou o pagamento adiantado: conta pausada e o plano agendado sai');
db.set('contas/troca@x.com', Object.assign(conta2(), { planoProximo: { id: 'tres', tipo: 'mensal', desde: new Date(Date.now() - 60e3).toISOString(), pagamento: 'x' } }));
await rodarCron(envE);
ok(conta2().plano.planoPago === 'uma' && conta2().planoProximo, 'Cron nao vira plano de conta pausada (espera o admin)');

/* 2: desceu pelo link (pagou adiantado o de 1 loja) com 3 lojas abertas: vira, e o admin fica sabendo */
contaTroca({ planoId: 'tres', planoPago: 'tres', pagoAte: new Date(Date.now() + 10 * DIA).toISOString() }, Object.assign({}, limpaTroca, { cicloPago: { plano: 'tres', tipo: 'mensal' } }));
db.set('lojas/loja-troca-2', { slug: 'loja-troca-2', donoEmail: 'troca@x.com' });
db.set('lojas/loja-troca-3', { slug: 'loja-troca-3', donoEmail: 'troca@x.com' });
cobrancas.set('pay_desce', { id: 'pay_desce', customer: 'cus_troca', value: 89, status: 'CONFIRMED', subscription: 'sub_desce', billingType: 'CREDIT_CARD' });
await avisarCom(envE, { id: 'pay_desce', customer: 'cus_troca' });
ok(conta2().planoProximo.id === 'uma' && conta2().plano.planoPago === 'tres', 'pagou o link de 1 loja adiantado: 3 lojas valem ate o fim do que ja pagou');
db.set('contas/troca@x.com', Object.assign(conta2(), { planoProximo: Object.assign(conta2().planoProximo, { desde: new Date(Date.now() - 60e3).toISOString() }) }));
const adminAntes4 = doAdmin().length;
await rodarCron(envE);
ok(conta2().plano.planoPago === 'uma' && doAdmin().some((m, i) => i >= adminAntes4 && /além do plano/.test(m.assunto)), 'chegou a hora: vira 1 loja e o admin recebe e-mail das 3 lojas abertas');
db.delete('lojas/loja-troca-2'); db.delete('lojas/loja-troca-3');

/* 6: assinatura so com fatura (boleto ainda nao pago): fica pendente, e trocar ou encerrar mudam ela junto */
db.set('contas/troca@x.com', { email: 'troca@x.com', clienteAsaas: 'cus_troca', plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new Date().toISOString() } });
assinaturas.set('sub_pend', { id: 'sub_pend', customer: 'cus_troca', value: 89, cycle: 'MONTHLY', status: 'ACTIVE' });
cobrancas.set('pay_pend', { id: 'pay_pend', customer: 'cus_troca', value: 89, status: 'PENDING', dueDate: '2026-10-08', subscription: 'sub_pend', invoiceUrl: 'https://www.asaas.com/i/pend' });
await avisarCom(envE, { id: 'pay_pend', customer: 'cus_troca' }, 'PAYMENT_CREATED');
ok(conta2().assinaturaPendente === 'sub_pend' && !conta2().assinaturaAsaas, 'boleto da assinatura ainda nao pago: a assinatura fica como pendente');
j = await (await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono')).json();
ok(j.acao === 'proxima' && assinaturas.get('sub_pend').value === 158, 'troca antes de pagar: a fatura pendente ja muda para R$ 158');
j = await (await pedir('encerrar', {}, 'tok-dono')).json();
ok(assinaturas.get('sub_pend').deleted === true && !conta2().assinaturaPendente && conta2().plano.status === 'cancelado', 'encerrar antes de pagar: a assinatura pendente e cancelada no Asaas');

/* corrida: outra aba mudou a escolha no meio: 409 e a assinatura volta para o valor da escolha que ficou */
contaTroca({ planoId: 'uma' }, Object.assign({}, limpaTroca, { cicloPago: { plano: 'uma', tipo: 'mensal' } })); assinaturaT();
leituras = 0;
aoLerConta = (cam) => { if (cam === 'contas/troca@x.com' && ++leituras === 2) { const c = db.get(cam); c.plano.planoId = 'uma'; c.plano.tipo = 'anual'; db.set(cam, c); } };
r = await pedir('trocar', { planoId: 'duas', tipo: 'mensal' }, 'tok-dono');
aoLerConta = null;
ok(r.status === 409 && assinaturas.get('sub_t').value === 890 && assinaturas.get('sub_t').cycle === 'YEARLY', 'outra aba escolheu anual no meio: 409 e a assinatura fica no valor da escolha que ficou (R$ 890 por ano)');

/* id com caminho escondido */
r = await avisar({ id: '../contas/x', customer: 'cus_1', value: 89 });
ok(r.status === 400, 'id de cobranca com caminho: 400');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
