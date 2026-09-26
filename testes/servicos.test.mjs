/*
 * Loja do Ligeiro (rotas /servicos/* e o aviso "srv:" do ferramentas/worker-asaas.js), sem internet: o Asaas, o Google,
 * o banco e o KV sao de mentira. Cada ataque que a gente conhece vira uma conferencia (pentest).
 * Rodar com:  node testes/servicos.test.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const { default: worker } = await import(url.pathToFileURL(path.join(aqui, '..', 'ferramentas', 'worker-asaas.js')).href);

let total = 0, falhas = 0;
function ok(cond, nome) { total += 1; if (cond) console.log('  ok  ' + nome); else { falhas += 1; console.log('  FALHOU  ' + nome); } }

/* ---- KV de mentira (valor + metadata; tipos text, json, stream, arrayBuffer) ---- */
const kv = new Map();
let kvEscritas = 0;
const CARDAPIO = {
  async get(k, t) { const v = kv.get(k); if (!v) return null; const tipo = typeof t === 'string' ? t : (t && t.type) || 'text'; return conv(v.valor, tipo); },
  async getWithMetadata(k, o) { const v = kv.get(k); if (!v) return { value: null, metadata: null }; return { value: conv(v.valor, (o && o.type) || 'text'), metadata: v.meta || null }; },
  async put(k, valor, o) { kvEscritas++; kv.set(k, { valor: valor instanceof Uint8Array ? new Uint8Array(valor) : valor, meta: (o && o.metadata) || null }); },
  async delete(k) { kv.delete(k); },
};
function conv(v, tipo) {
  if (tipo === 'json') return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v));
  if (tipo === 'arrayBuffer') return v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : new TextEncoder().encode(v).buffer;
  if (tipo === 'stream') return { cancel: async () => {} };
  return typeof v === 'string' ? v : new TextDecoder().decode(v);
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'proj', client_email: 'sa@proj.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const env = { ASAAS_KEY: 'chave', ASAAS_WEBHOOK: 'tokenDoWebhook123', FIREBASE_SA: JSON.stringify(SA), PLANOS: JSON.stringify({ uma: { mensal: 8900, anual: 89000, fm: 7900, fa: 79000 } }), CARDAPIO, EMAIL_URL: 'https://email.teste/exec', EMAIL_TOKEN: 'x' };
const ADMIN = 'ligeiro.pedidos@gmail.com';
const logins = new Map([
  ['tok-ze', { email: 'ze@x.com', emailVerified: true }], ['tok-outro', { email: 'outro@x.com', emailVerified: true }],
  ['tok-admin', { email: ADMIN, emailVerified: true }], ['tok-equipe', { email: 'equipe-zeloja@equipe.ligeiropedidos.com.br', emailVerified: true }],
  ['tok-nao', { email: 'ze@x.com', emailVerified: false }],
]);
/* Asaas de mentira */
const clientes = new Map([['cus_ze', { id: 'cus_ze', email: 'ze@x.com', cpfCnpj: '' }]]);
const cobrancas = new Map();
const chamadas = [];
const emails = [];
const bancoLidas = [];
let reembolsoFalha = false, nCob = 0, nCli = 0;
const resposta = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u, o) => {
  o = o || {};
  const e = String(u);
  if (e === 'https://oauth2.googleapis.com/token') return resposta({ access_token: 'tok' });
  if (e === 'https://identitytoolkit.googleapis.com/v1/accounts:lookup') { const x = logins.get(JSON.parse(o.body).idToken); return x ? resposta({ users: [x] }) : resposta({ error: {} }, 400); }
  if (e === env.EMAIL_URL) { emails.push(JSON.parse(o.body)); return resposta({ ok: true }); }
  if (e.indexOf('https://firestore.googleapis.com/') === 0) { bancoLidas.push((o.method || 'GET') + ' ' + e.split('/documents/')[1]); return resposta({ error: {} }, 404); }
  if (e.indexOf('https://api.asaas.com/v3') === 0) {
    const cam = e.slice('https://api.asaas.com/v3'.length);
    const metodo = o.method || 'GET';
    const corpo = o.body ? JSON.parse(o.body) : null;
    chamadas.push({ metodo, cam, corpo });
    let m;
    if ((m = /^\/customers\?email=([^&]+)/.exec(cam))) { const em = decodeURIComponent(m[1]); return resposta({ data: [...clientes.values()].filter((c) => c.email === em) }); }
    if (cam === '/customers' && metodo === 'POST') { const id = 'cus_n' + (++nCli); clientes.set(id, Object.assign({ id }, corpo)); return resposta(clientes.get(id)); }
    if ((m = /^\/customers\/([^/]+)$/.exec(cam)) && metodo === 'POST') { const c = clientes.get(decodeURIComponent(m[1])); Object.assign(c, corpo); return resposta(c); }
    if (cam === '/payments' && metodo === 'POST') { const id = 'pay_' + (++nCob); const c = Object.assign({ id, status: 'PENDING', invoiceUrl: 'https://www.asaas.com/i/' + id, dateCreated: new Date().toISOString() }, corpo); cobrancas.set(id, c); return resposta(c); }
    if ((m = /^\/payments\/([^/]+)\/refund$/.exec(cam))) { if (reembolsoFalha) return resposta({ errors: [{ code: 'invalid_action' }] }, 400); const c = cobrancas.get(m[1]); c.refunded = (c.refunded || 0) + corpo.value; return resposta(c); }
    if ((m = /^\/payments\/([^/]+)$/.exec(cam))) { const c = cobrancas.get(decodeURIComponent(m[1])); return c ? resposta(c) : resposta({ errors: [] }, 404); }
    return resposta({ errors: [] }, 404);
  }
  return resposta({}, 404);
};

const ORIGEM = 'https://ligeiropedidos.com.br';
async function chamar(rota, corpo, token, extra) {
  const cab = { 'Content-Type': 'application/json', Origin: (extra && extra.origem) || ORIGEM };
  if (token) cab.Authorization = 'Bearer ' + token;
  const r = await worker.fetch(new Request('https://ligeiro-asaas.x.workers.dev/servicos/' + rota, { method: 'POST', headers: cab, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {}) }), env);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, r };
}
async function subir(q, dados, token) {
  const r = await worker.fetch(new Request('https://ligeiro-asaas.x.workers.dev/servicos/subir?' + q, { method: 'POST', headers: { Authorization: 'Bearer ' + (token || 'tok-admin'), 'Content-Type': 'video/mp4', 'Content-Length': String(dados.length) }, body: dados }), env);
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function aviso(evento, pag, token) {
  const r = await worker.fetch(new Request('https://ligeiro-asaas.x.workers.dev/', { method: 'POST', headers: { 'asaas-access-token': token || env.ASAAS_WEBHOOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: evento, payment: pag }) }), env);
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const lojaKv = (slug, dono, nome) => kv.set('loja:' + slug, { valor: JSON.stringify({ borda: 1, loja: { slug, nome } }), meta: { em: Date.now(), dono, nome } });
lojaKv('zeloja', 'ze@x.com', 'Lanchonete do Zé');
lojaKv('outra', 'outro@x.com', 'Outra Loja');
const CPF = '52998224725'; /* valido */
const MP4 = () => { const b = new Uint8Array(2000); b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0); for (let i = 8; i < b.length; i++) b[i] = i % 251; return b; };
const JPG = () => { const b = new Uint8Array(500); b.set([0xff, 0xd8, 0xff, 0xe0], 0); return b; };
const TERMOS = '2026-09-26';

console.log('== quem entra ==');
{
  let r = await chamar('meus', { loja: 'zeloja' });
  ok(r.status === 401, 'sem login: 401');
  r = await chamar('meus', { loja: 'zeloja' }, 'tok-nao');
  ok(r.status === 401, 'e-mail nao confirmado: 401');
  r = await chamar('meus', { loja: 'zeloja' }, 'tok-equipe');
  ok(r.status === 403, 'login da equipe (cozinha/entregador): 403');
  r = await chamar('meus', { loja: 'zeloja' }, 'tok-outro');
  ok(r.status === 403, 'dono de outra loja nao ve a Loja do Ligeiro desta: 403');
  r = await chamar('meus', { loja: '../zeloja' }, 'tok-ze');
  ok(r.status === 404, 'nome de loja torto: 404');
  r = await chamar('meus', { loja: 'zeloja' }, 'tok-ze');
  ok(r.status === 200 && r.j.ok && r.j.pedidos.length === 0 && r.j.maxVideos === 10, 'dono: a lista vazia');
  ok(r.r.headers.get('Access-Control-Allow-Origin') === ORIGEM, 'CORS: o site do Ligeiro');
  r = await chamar('meus', { loja: 'zeloja' }, 'tok-ze', { origem: 'https://golpe.com' });
  ok(r.r.headers.get('Access-Control-Allow-Origin') === 'null', 'CORS: outro site nao le a resposta');
  ok(bancoLidas.length === 0, 'nada lido do banco (o dono vem da etiqueta do KV)');
  for (const rota of ['central', 'criar', 'etapa', 'entregar', 'reembolsar']) {
    const x = await chamar(rota, { id: 'a'.repeat(20), loja: 'zeloja', servico: 'logo', whatsapp: '13999990000' }, 'tok-ze');
    ok(x.status === 403, 'rota da Central com login de dono: 403 (' + rota + ')');
  }
  const s = await subir('pedido=' + 'a'.repeat(20) + '&tipo=video&dur=10', MP4(), 'tok-ze');
  ok(s.status === 403, 'subir arquivo com login de dono: 403');
  r = await chamar('meus', 'x'.repeat(9000), 'tok-ze');
  ok(r.status === 413, 'pedido grande demais: 413');
  r = await chamar('nao-existe', {}, 'tok-ze');
  ok(r.status === 404, 'rota que nao existe: 404');
}

console.log('== comprar ==');
let pedidoId = '', cobId = '';
{
  let r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '13999990000' }, 'tok-ze');
  ok(r.status === 400 && /termos/i.test(r.j.erro), 'sem aceitar os termos: recusa');
  r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '13999990000', termos: '2020-01-01' }, 'tok-ze');
  ok(r.status === 400, 'termos de outra versao: recusa');
  for (const s of ['__proto__', 'constructor', 'toString', 'nada']) {
    const x = await chamar('comprar', { loja: 'zeloja', servico: s, whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
    ok(x.status === 400, 'servico inventado "' + s + '": recusa');
  }
  r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '999', termos: TERMOS }, 'tok-ze');
  ok(r.status === 400 && /WhatsApp/.test(r.j.erro), 'WhatsApp torto: recusa');
  r = await chamar('comprar', { loja: 'outra', servico: 'video', whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
  ok(r.status === 403, 'comprar para a loja de outro: 403');
  r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
  ok(r.status === 200 && r.j.ok === false && r.j.precisaDocumento === true, 'cliente do Asaas sem CPF: pede o documento');
  r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '13999990000', termos: TERMOS, documento: '11111111111' }, 'tok-ze');
  ok(r.status === 400 && /inválido/.test(r.j.erro), 'CPF invalido: recusa');
  const antes = chamadas.length;
  r = await chamar('comprar', { loja: 'zeloja', servico: 'video', whatsapp: '(13) 99999-0000', termos: TERMOS, documento: CPF, valor: 1, value: 0.01, preco: 1 }, 'tok-ze');
  ok(r.status === 200 && r.j.ok && /^https:\/\/www\.asaas\.com\//.test(r.j.link), 'compra: link do Asaas');
  const cob = chamadas.slice(antes).find((c) => c.cam === '/payments' && c.metodo === 'POST');
  ok(cob && cob.corpo.value === 149 && cob.corpo.billingType === 'UNDEFINED', 'o preco vem do servidor (R$ 149), nunca do celular');
  ok(cob && /^srv:[a-z0-9]{20}$/.test(cob.corpo.externalReference) && cob.corpo.customer === 'cus_ze', 'cobranca com a referencia srv: e o cliente da conta');
  ok(clientes.get('cus_ze').cpfCnpj === CPF, 'o CPF entrou no cliente do Asaas (uma vez so)');
  pedidoId = r.j.pedido.id; cobId = cob && (await (async () => [...cobrancas.values()].find((c) => c.externalReference === 'srv:' + pedidoId).id)());
  const guardado = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(guardado.status === 'aguardando_pagamento' && guardado.valor === 14900 && guardado.email === 'ze@x.com' && guardado.termos.versao === TERMOS && !!guardado.termos.em, 'pedido guardado com o aceite dos termos');
  const lista = JSON.parse(kv.get('srv:loja:zeloja').valor);
  const idx = JSON.parse(kv.get('srv:idx').valor);
  ok(lista.pedidos[0].id === pedidoId && idx[0].id === pedidoId && lista.pedidos[0].link, 'entrou na lista da loja e na da Central');
  ok(bancoLidas.length === 0, 'compra sem ler nem gravar no banco');
  await chamar('comprar', { loja: 'zeloja', servico: 'logo', whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
  await chamar('comprar', { loja: 'zeloja', servico: 'fotos', whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
  r = await chamar('comprar', { loja: 'zeloja', servico: 'design', whatsapp: '13999990000', termos: TERMOS }, 'tok-ze');
  ok(r.status === 429, 'quarto pedido esperando pagamento: recusa (no maximo 3)');
}

console.log('== aviso do Asaas ==');
{
  let r = await aviso('PAYMENT_CONFIRMED', { id: cobId, customer: 'cus_ze', externalReference: 'srv:' + pedidoId }, 'errado');
  ok(r.status === 401, 'aviso sem o token do webhook: 401');
  r = await aviso('PAYMENT_CONFIRMED', { id: cobId, customer: 'cus_ze', externalReference: 'srv:' + pedidoId });
  ok(r.j.ignorado && /status/.test(r.j.ignorado), 'aviso de pagamento com a cobranca ainda pendente no Asaas: nada muda');
  cobrancas.get(cobId).status = 'CONFIRMED'; cobrancas.get(cobId).billingType = 'PIX';
  const falso = [...cobrancas.values()].find((c) => c.id !== cobId);
  r = await aviso('PAYMENT_CONFIRMED', { id: falso.id, customer: 'cus_ze', externalReference: 'srv:' + pedidoId });
  ok(r.j.ignorado === 'cobranca desconhecida', 'aviso inventado (cobranca de outro pedido com a referencia deste): ignorado');
  const emailsAntes = emails.length;
  r = await aviso('PAYMENT_CONFIRMED', { id: cobId, customer: 'cus_ze', externalReference: 'srv:' + pedidoId });
  const p = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(r.status === 200 && p.status === 'material' && p.forma === 'PIX' && p.valorPago === 14900, 'pagou: pedido vai para "falta o material"');
  ok(emails.length - emailsAntes === 2 && emails.some((m) => m.para === ADMIN) && emails.some((m) => m.para === 'ze@x.com'), 'e-mail para o admin e para a loja');
  ok(!bancoLidas.some((x) => /contas/.test(x)), 'pagamento de servico nao mexe na conta (nenhum dia de plano)');
  r = await aviso('PAYMENT_RECEIVED', { id: cobId, customer: 'cus_ze', externalReference: 'srv:' + pedidoId });
  ok(r.j.repetido === true && emails.length - emailsAntes === 2, 'aviso repetido: nada de novo');
  /* rede: o aviso chega sem a referencia, mas a cobranca e de servico */
  const c2 = [...cobrancas.values()].find((c) => c.id !== cobId && c.status === 'PENDING');
  c2.status = 'RECEIVED';
  r = await aviso('PAYMENT_RECEIVED', { id: c2.id, customer: 'cus_ze' });
  ok(r.status === 200 && r.j.servico === 'pago' && !bancoLidas.some((x) => /contas/.test(x)), 'aviso sem a referencia: a rede acha o servico e nao da dias de plano');
  const c3 = [...cobrancas.values()].find((c) => c.status === 'PENDING');
  const id3 = c3.externalReference.slice(4);
  c3.status = 'OVERDUE';
  r = await aviso('PAYMENT_OVERDUE', { id: c3.id, customer: 'cus_ze', externalReference: c3.externalReference });
  ok(JSON.parse(kv.get('srv:p:' + id3).valor).status === 'cancelado', 'link vencido sem pagar: pedido cancelado');
}

console.log('== Central: etapa, arquivo e entrega ==');
let videoId = '';
{
  let r = await chamar('central', {}, 'tok-admin');
  ok(r.status === 200 && r.j.pedidos.length === 3, 'a Central ve todos os pedidos');
  r = await chamar('entregar', { id: pedidoId, titulo: 'x' }, 'tok-admin');
  ok(r.status === 400 && /vídeo/.test(r.j.erro), 'entregar video sem o arquivo: recusa');
  r = await chamar('etapa', { id: pedidoId }, 'tok-admin');
  const p = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(r.status === 200 && p.status === 'producao' && /^\d{4}-\d{2}-\d{2}$/.test(p.prazoAte) && ![0, 6].includes(new Date(p.prazoAte + 'T12:00:00Z').getUTCDay()), 'material chegou: producao, prazo em dia util');
  r = await chamar('etapa', { id: pedidoId }, 'tok-admin');
  ok(r.status === 409, 'etapa repetida: recusa');
  let s = await subir('pedido=' + pedidoId + '&tipo=video&dur=15', new TextEncoder().encode('<html><script>alert(1)</script></html>'));
  ok(s.status === 415, 'arquivo que nao e MP4 (HTML disfarcado): recusa');
  s = await subir('pedido=' + pedidoId + '&tipo=video&dur=45', MP4());
  ok(s.status === 400, 'video de 45 s: recusa');
  const grande = await worker.fetch(new Request('https://x/servicos/subir?pedido=' + pedidoId + '&tipo=video&dur=10', { method: 'POST', headers: { Authorization: 'Bearer tok-admin', 'Content-Length': String(16 * 1024 * 1024) }, body: MP4() }), env);
  ok(grande.status === 413, 'video acima de 15 MB (pelo tamanho anunciado): recusa');
  s = await subir('pedido=' + pedidoId + '&tipo=video&dur=18', MP4());
  ok(s.status === 200 && /^[a-z0-9]{20}$/.test(s.j.id), 'video MP4 de 18 s: guardado');
  videoId = s.j.id;
  let c = await subir('pedido=' + pedidoId + '&tipo=capa&id=' + 'b'.repeat(20), JPG());
  ok(c.status === 404, 'capa de um video que nao e deste pedido: recusa');
  c = await subir('pedido=' + pedidoId + '&tipo=capa&id=' + videoId, MP4());
  ok(c.status === 415, 'capa que nao e JPG: recusa');
  c = await subir('pedido=' + pedidoId + '&tipo=capa&id=' + videoId, JPG());
  ok(c.status === 200, 'capa JPG: guardada');
  const outro = Object.keys(Object.fromEntries(kv)).find((k) => /^srv:p:/.test(k) && k !== 'srv:p:' + pedidoId);
  r = await chamar('entregar', { id: outro.slice(6), titulo: 'x', video: videoId }, 'tok-admin');
  ok(r.status === 200 && !JSON.parse(kv.get('srv:p:' + outro.slice(6)).valor).video && !(JSON.parse(kv.get('srv:loja:zeloja').valor).videos || []).length, 'entrega de logo com um video no pedido: o video nao entra na loja por esse caminho');
  const emailsAntes = emails.length;
  r = await chamar('entregar', { id: pedidoId, titulo: 'Promoção <script>alert(1)</script> de sexta', video: videoId, noSite: true, avisar: true }, 'tok-admin');
  const p2 = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(r.status === 200 && p2.status === 'entregue' && !/[<>]/.test(p2.titulo), 'entregue; nome do video sem < > (nunca vira codigo)');
  const l = JSON.parse(kv.get('srv:loja:zeloja').valor);
  ok(l.videos[0].id === videoId && l.noSite === videoId && l.videos[0].capa === true, 'o video entrou em Videos da loja, no site');
  const copia = JSON.parse(kv.get('loja:zeloja').valor);
  ok(copia.loja.video && copia.loja.video.id === videoId && kv.get('loja:zeloja').meta.dono === 'ze@x.com', 'a copia da loja na borda ja leva o video (e a etiqueta continua)');
  ok(JSON.parse(kv.get('srv:video:zeloja').valor).id === videoId, 'a chave que o ligeiro-mp junta ao refazer a copia');
  ok(emails.length - emailsAntes === 1 && emails[emails.length - 1].para === 'ze@x.com', 'e-mail de pronto para a loja (o interruptor ligado)');
}

console.log('== o video no site ==');
{
  let r = await worker.fetch(new Request('https://x/servicos/v/' + videoId), env);
  const b = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get('Content-Type') === 'video/mp4' && b.length === 2000 && r.headers.get('Accept-Ranges') === 'bytes', 'video inteiro');
  r = await worker.fetch(new Request('https://x/servicos/v/' + videoId, { headers: { Range: 'bytes=0-7' } }), env);
  const p = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 206 && r.headers.get('Content-Range') === 'bytes 0-7/2000' && p.length === 8 && p[4] === 0x66, 'pedaco (o iPhone toca assim)');
  r = await worker.fetch(new Request('https://x/servicos/v/' + videoId, { headers: { Range: 'bytes=5000-6000' } }), env);
  ok(r.status === 416, 'pedaco fora do video: 416');
  r = await worker.fetch(new Request('https://x/servicos/c/' + videoId), env);
  ok(r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg', 'a capa');
  r = await worker.fetch(new Request('https://x/servicos/v/..%2F..%2Fsrv%3Aidx'), env);
  ok(r.status === 404, 'nome torto nao le outra chave do KV');
  r = await worker.fetch(new Request('https://x/servicos/v/' + 'z'.repeat(20)), env);
  ok(r.status === 404, 'video que nao existe: 404');
}

console.log('== o dono escolhe e apaga ==');
{
  let r = await chamar('video', { loja: 'zeloja', video: 'y'.repeat(20) }, 'tok-ze');
  ok(r.status === 404, 'escolher video que nao e da loja: recusa');
  r = await chamar('video', { loja: 'outra', video: null }, 'tok-ze');
  ok(r.status === 403, 'mexer no video da loja de outro: 403');
  r = await chamar('video', { loja: 'zeloja', video: null }, 'tok-ze');
  ok(r.status === 200 && !JSON.parse(kv.get('loja:zeloja').valor).loja.video && !kv.get('srv:video:zeloja'), 'tirar do site: sai da copia da loja');
  r = await chamar('video', { loja: 'zeloja', video: videoId }, 'tok-ze');
  ok(r.status === 200 && JSON.parse(kv.get('loja:zeloja').valor).loja.video.id === videoId, 'por no site de novo');
  r = await chamar('apagar-video', { loja: 'zeloja', video: videoId }, 'tok-outro');
  ok(r.status === 403, 'apagar video da loja de outro: 403');
}

console.log('== reembolso ==');
{
  let r = await chamar('reembolsar', { id: pedidoId, motivo: 'ok' }, 'tok-admin');
  ok(r.status === 400, 'sem motivo: recusa');
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'Loja desistiu', valor: 99999 }, 'tok-admin');
  ok(r.status === 400, 'mais do que foi pago: recusa');
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'Loja desistiu', valor: -100 }, 'tok-admin');
  ok(r.status === 400, 'valor negativo: recusa');
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'Parte do servico', valor: 4900 }, 'tok-admin');
  let p = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(r.status === 200 && p.status === 'entregue' && p.reembolso.valor === 4900 && cobrancas.get(cobId).refunded === 49, 'parte: R$ 49 devolvidos pelo Asaas, o pedido segue entregue');
  reembolsoFalha = true;
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'O resto' }, 'tok-admin');
  ok(r.status === 409 && r.j.manual === true, 'Asaas recusou (boleto): pede o registro manual');
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'O resto', manual: true }, 'tok-admin');
  p = JSON.parse(kv.get('srv:p:' + pedidoId).valor);
  ok(r.status === 200 && p.status === 'reembolsado' && p.reembolso.valor === 14900, 'registro manual do resto: reembolsado');
  reembolsoFalha = false;
  r = await chamar('reembolsar', { id: pedidoId, motivo: 'De novo' }, 'tok-admin');
  ok(r.status === 409, 'reembolsar de novo o que ja foi devolvido: recusa');
}

console.log('== pedido que chegou pelo WhatsApp ==');
{
  const r = await chamar('criar', { loja: 'outra', servico: 'logo', whatsapp: '13988887777', documento: '11444777000161' }, 'tok-admin');
  ok(r.status === 200 && r.j.ok && r.j.link, 'a Central gera o link para a loja de outro dono');
  const p = JSON.parse(kv.get('srv:p:' + r.j.pedido.id).valor);
  const cli = [...clientes.values()].find((c) => c.email === 'outro@x.com');
  ok(p.origem === 'whatsapp' && p.email === 'outro@x.com' && cli && cli.cpfCnpj === '11444777000161', 'no nome do dono da loja (cliente do Asaas dele, com o CNPJ)');
}

console.log('== o preco do site e o do mensageiro ==');
{
  const texto = fs.readFileSync(path.join(aqui, '..', 'js', 'config.js'), 'utf8');
  const caixa = { window: {} };
  vm.runInNewContext(texto, caixa);
  const cfg = caixa.window.LIGEIRO_CONFIG.lojaLigeiro;
  const w = fs.readFileSync(path.join(aqui, '..', 'ferramentas', 'worker-asaas.js'), 'utf8');
  const bloco = /const SERVICOS = (\{[\s\S]*?\n\});/.exec(w)[1];
  const servidor = vm.runInNewContext('(' + bloco + ')');
  ok(cfg.servicos.length === Object.keys(servidor).length && cfg.servicos.every((s) => servidor[s.id] && servidor[s.id].valor === s.valor && servidor[s.id].dias === s.dias && servidor[s.id].nome === s.nome), 'precos, prazos e nomes iguais no site e no mensageiro');
  ok(cfg.termos === /const TERMOS_SERVICOS = '([^']+)'/.exec(w)[1], 'a versao dos termos e a mesma');
  ok(cfg.ligada === false || cfg.ligada === true, 'a chave ligada existe');
}

console.log('== video combinado por fora (Enviar video, na Central) ==');
{
  const cobrancasAntes = chamadas.filter((c) => c.cam === '/payments' && c.metodo === 'POST').length;
  const cen = await chamar('central', {}, 'tok-admin');
  ok(Array.isArray(cen.j.recursos) && cen.j.recursos.indexOf('fora') >= 0, 'fora: a Central sabe que este mensageiro ja faz o Enviar video');
  let r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true, valor: 14900 }, 'tok-outro');
  ok(r.status === 403, 'fora: dono nao cria pedido combinado por fora (so a Central)');
  r = await chamar('comprar', { loja: 'outra', servico: 'video', fora: true, termos: TERMOS, whatsapp: '13999990000' }, 'tok-outro');
  ok(!(r.j.pedido && r.j.pedido.status === 'producao'), 'fora: na compra do dono o "fora" e ignorado (nada nasce pago)');
  r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true, valor: -5 }, 'tok-admin');
  ok(r.status === 400, 'fora: valor negativo recusado');
  r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true, valor: 99999999 }, 'tok-admin');
  ok(r.status === 400, 'fora: valor acima de R$ 10.000 recusado');
  r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true, valor: '<b>' }, 'tok-admin');
  ok(r.status === 400, 'fora: valor que nao e numero recusado');
  r = await chamar('criar', { loja: 'naoexiste', servico: 'video', fora: true }, 'tok-admin');
  ok(r.status === 404, 'fora: loja que nao existe: 404');
  r = await chamar('criar', { loja: 'outra', servico: 'foguete', fora: true }, 'tok-admin');
  ok(r.status === 400, 'fora: servico que nao existe: 400');
  const cobrancasFora = chamadas.filter((c) => c.cam === '/payments' && c.metodo === 'POST').length;
  r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true, valor: 14900 }, 'tok-admin');
  const pf = r.j.pedido || {};
  ok(r.status === 200 && pf.status === 'producao' && pf.forma === 'FORA' && pf.origem === 'fora' && pf.valor === 14900 && !pf.link, 'fora: o pedido nasce pago, em producao e sem link de pagamento');
  ok(chamadas.filter((c) => c.cam === '/payments' && c.metodo === 'POST').length === cobrancasFora, 'fora: nenhuma cobranca criada no Asaas');
  const v = await subir('pedido=' + pf.id + '&tipo=video&dur=18', MP4());
  ok(v.status === 200 && v.j.id, 'fora: o video sobe no pedido');
  const c = await subir('pedido=' + pf.id + '&tipo=capa&id=' + v.j.id, JPG());
  ok(c.status === 200, 'fora: a capa sobe junto');
  r = await chamar('entregar', { id: pf.id, titulo: 'Combinado no balcão', video: v.j.id, noSite: true, avisar: false }, 'tok-admin');
  ok(r.status === 200 && r.j.pedido.status === 'entregue', 'fora: entregue pelo caminho de sempre');
  r = await chamar('meus', { loja: 'outra' }, 'tok-outro');
  ok(r.j.videos.some((x) => x.id === v.j.id) && r.j.noSite === v.j.id, 'fora: o video aparece em Videos da loja e no site dela');
  ok(r.j.pedidos.some((x) => x.id === pf.id && x.forma === 'FORA'), 'fora: a loja ve o pedido como combinado por fora');
  r = await chamar('reembolsar', { id: pf.id, motivo: 'devolver pelo Asaas' }, 'tok-admin');
  ok(r.status === 409 && r.j.manual === true, 'fora: reembolso pelo Asaas recusado (o dinheiro nao passou por ele)');
  r = await chamar('reembolsar', { id: pf.id, motivo: 'devolvi em dinheiro', manual: true }, 'tok-admin');
  ok(r.status === 200, 'fora: reembolso feito por fora so e registrado');
  r = await chamar('criar', { loja: 'outra', servico: 'video', fora: true }, 'tok-admin');
  ok(r.status === 200 && r.j.pedido.valor === 0, 'fora: sem valor (cortesia) fica R$ 0');
  r = await chamar('reembolsar', { id: r.j.pedido.id, motivo: 'nada a devolver', manual: true }, 'tok-admin');
  ok(r.status === 400, 'fora: cortesia nao tem o que devolver');
  ok(chamadas.filter((x) => x.cam === '/payments' && x.metodo === 'POST').length === cobrancasFora, 'fora: no fim, nenhuma cobranca nova alem das normais');
  ok(cobrancasAntes <= cobrancasFora, 'fora: contagem de cobrancas coerente');
}

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
