/*
 * Ligeiro - mensageiro do Pix (Cloudflare Workers, plano gratis).
 *
 * O Pix do cliente e SEMPRE automatico, pela conta Mercado Pago de cada loja:
 *   POST /criar    { loja, pedido }  -> cria o pagamento Pix no Mercado Pago com o token da loja
 *                                       (lojas/{slug}/privado/mercadopago) e grava o "copia e cola" no pedido.
 *                                       O site do cliente mostra o QR na hora, mesmo com o painel fechado.
 *   POST /webhook?loja=slug          -> o Mercado Pago avisa que pagou; o pedido vira "pago" e cai na cozinha.
 *   GET  /status?loja=slug&pedido=id -> reforco: o site do cliente pergunta a cada 8 s enquanto espera.
 *   POST /                           -> repasse antigo (o painel manda o POST com o proprio token).
 *   POST /equipe   { loja, pin } + Authorization: Bearer <idToken do dono> -> define a senha da equipe da loja.
 *   Pagamentos usam a API Orders (POST /v1/orders); o webhook do Mercado Pago pode vir sem a loja na URL:
 *   o mensageiro acha pelo indice mp_indice/{orderId}. Configure o webhook na aplicacao "Ligeiro plataforma":
 *   URL https://SEU-WORKER/webhook, eventos Orders e Pagamentos.
 *
 * Como publicar (15 minutos, sem cartao):
 *   1. Cloudflare > Workers & Pages > Create Worker > nome "ligeiro-mp" > cole este arquivo > Deploy.
 *   2. Settings > Variables and Secrets (Secret):
 *        FIREBASE_SA       o JSON inteiro da conta de servico do Firebase
 *                          (Configuracoes do projeto > Contas de servico > Gerar nova chave privada)
 *        MP_CLIENT_ID      Client ID da aplicacao "Ligeiro plataforma" no Mercado Pago
 *        MP_CLIENT_SECRET  Client Secret da mesma aplicacao (o botao "Conectar com Mercado Pago")
 *      Na aplicacao do Mercado Pago, URL de redirecionamento: https://SEU-WORKER/mp/volta
 *   3. Copie o endereco (https://ligeiro-mp.SEU-USUARIO.workers.dev) e cole em js/config.js, proxyMercadoPago.
 *   4. Nada a fazer no Mercado Pago: o worker manda o endereco do webhook em cada pagamento (notification_url).
 *
 * Limite do plano gratis: 100 mil chamadas por dia. Um pedido usa umas 3 a 30.
 */
const ORIGENS = ['https://ligeiropedidos.github.io', 'https://ligeiro.app.br', 'http://localhost:8765'];
const MP = 'https://api.mercadopago.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origem = request.headers.get('Origin') || '';
    const conferir = !ORIGENS.some((o) => o.indexOf('SEU-USUARIO') >= 0);
    const cors = {
      'Access-Control-Allow-Origin': conferir ? (ORIGENS.indexOf(origem) >= 0 ? origem : 'null') : '*',
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Idempotency-Key',
      'Access-Control-Max-Age': '86400',
    };
    const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const caminho = url.pathname.replace(/\/+$/, '') || '/';

    try {
      /* ---- volta do "Conectar com Mercado Pago" (OAuth): troca o codigo pelo token da loja ---- */
      if (caminho === '/mp/volta' && request.method === 'GET') {
        const site = ORIGENS[0];
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const ponto = state.indexOf('.');
        const slug = ponto > 0 ? state.slice(0, ponto) : '';
        const nonce = ponto > 0 ? state.slice(ponto + 1) : '';
        const voltar = (ok) => Response.redirect(site + '/#/painel/' + encodeURIComponent(slug || '') + '/mp-' + (ok ? 'ok' : 'erro'), 302);
        if (!code || !slug || !nonce || !env.MP_CLIENT_ID || !env.MP_CLIENT_SECRET) return voltar(false);
        const fb = await firebase(env);
        const seg = (await fb.get('lojas/' + slug + '/privado/mercadopago')) || {};
        const recente = seg.oauthEm && (Date.now() - new Date(seg.oauthEm).getTime()) < 30 * 60 * 1000;
        if (!seg.oauthNonce || seg.oauthNonce !== nonce || !recente) return voltar(false);
        const r = await fetch(MP + '/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: 'authorization_code', code: code, redirect_uri: url.origin + '/mp/volta' }),
        });
        const t = await r.json().catch(() => ({}));
        if (!r.ok || !t.access_token) return voltar(false);
        const agora = new Date().toISOString();
        await fb.merge('lojas/' + slug + '/privado/mercadopago', {
          token: t.access_token, refresh: t.refresh_token || '', mpUserId: String(t.user_id || ''),
          tokenExpiraEm: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(),
          conectadoEm: agora, atualizadoEm: agora, oauthNonce: '', oauthEm: '',
        });
        await fb.merge('lojas/' + slug, { mpAtivo: true, aceitaPix: true, atualizadoEm: agora });
        await fb.merge('vitrine/' + slug, { aceitaPix: true, atualizadoEm: agora }).catch(() => {});
        return voltar(true);
      }

      /* ---- webhook do Mercado Pago (vem do servidor deles, sem Origin) ---- */
      if (caminho === '/webhook' && request.method === 'POST') {
        let slug = url.searchParams.get('loja') || '';
        let corpo = {};
        try { corpo = await request.json(); } catch (_) { corpo = {}; }
        const id = String((corpo.data && corpo.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
        if (!id) return json({ ok: true, ignorado: true });
        const fb = await firebase(env);
        let pedidoId = null;
        if (!slug) {
          /* order: acha a loja pelo indice gravado na criacao */
          const idx = await fb.get('mp_indice/' + id);
          if (idx && idx.loja) { slug = idx.loja; pedidoId = idx.pedido || null; }
        }
        if (!slug) return json({ ok: true, ignorado: 'sem loja' });
        await conferirPagamento(fb, slug, id, pedidoId, env);
        return json({ ok: true });
      }

      if (conferir && origem && ORIGENS.indexOf(origem) < 0) return json({ erro: 'origem não permitida' }, 403);

      /* ---- senha da equipe: o dono (logado) define; criamos/trocamos o usuario de equipe da loja ---- */
      if (caminho === '/equipe' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja, pin } = await request.json();
        const senha = String(pin || '').replace(/\D/g, '');
        if (!idToken || !loja || senha.length < 4 || senha.length > 8) return json({ ok: false, erro: 'senha de 4 a 8 números' }, 400);
        const fb = await firebase(env);
        const quem = await usuarioDoToken(fb, idToken);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        const l = await fb.get('lojas/' + loja);
        if (!l || String(l.donoEmail || '').toLowerCase() !== quem.toLowerCase()) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        await definirUsuarioEquipe(fb, 'equipe-' + loja + '@equipe.ligeiro.app.br', 'LIG-' + senha);
        await fb.merge('lojas/' + loja, { senhaEquipeEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
        return json({ ok: true });
      }

      /* ---- cria o Pix do pedido ---- */
      if (caminho === '/criar' && request.method === 'POST') {
        const { loja, pedido } = await request.json();
        if (!loja || !pedido) return json({ erro: 'faltou loja ou pedido' }, 400);
        const fb = await firebase(env);
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.pixCodigo) return json({ codigo: p.pixCodigo, expiraEm: p.pixExpiraEm || '' });
        if (p.status !== 'aguardando_pagamento' || p.formaPagamento !== 'pix' || !(p.total > 0)) return json({ erro: 'esse pedido não está esperando Pix' }, 400);
        const token = await tokenDaLoja(fb, loja, env);
        if (!token) return json({ erro: 'a loja não ligou o Pix automático' }, 409);
        const l = await fb.get('lojas/' + loja);
        const nome = separarNome(p.cliente && p.cliente.nome, l && l.nome);
        /* API Orders do Mercado Pago (a de Payments vai ser descontinuada) */
        const valor = (p.total / 100).toFixed(2);
        const corpo = {
          type: 'online',
          total_amount: valor,
          /* a API Orders so aceita letras, numeros, hifen e sublinhado (ate 64): nada de "|" */
          external_reference: (loja + '__' + pedido).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64),
          processing_mode: 'automatic',
          transactions: { payments: [{ amount: valor, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT30M' }] },
          payer: { email: 'cliente' + (p.senha || '0') + '@' + loja + '.ligeiro.app.br', first_name: nome.primeiro, last_name: nome.sobrenome },
        };
        const ord = await mp(token, '/v1/orders', { method: 'POST', body: JSON.stringify(corpo), headers: { 'X-Idempotency-Key': pedido + '-o2' } });
        const pagto = (ord.transactions && ord.transactions.payments && ord.transactions.payments[0]) || {};
        const qr = (pagto.payment_method && pagto.payment_method.qr_code) || '';
        if (!qr) return json({ erro: 'o Mercado Pago não devolveu o Pix (a conta tem chave Pix cadastrada?)' }, 502);
        const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const agora2 = new Date().toISOString();
        await fb.merge('lojas/' + loja + '/pedidos/' + pedido, { mp: { id: String(ord.id), pagamentoId: String(pagto.id || ''), criadoEm: agora2 }, pixCodigo: qr, pixExpiraEm: expira, atualizadoEm: agora2 });
        /* indice pro webhook (que chega sem saber a loja) */
        await fb.merge('mp_indice/' + String(ord.id), { loja: loja, pedido: pedido, criadoEm: agora2 }).catch(() => {});
        return json({ codigo: qr, expiraEm: expira });
      }

      /* ---- o site pergunta se caiu ---- */
      if (caminho === '/status' && request.method === 'GET') {
        const loja = url.searchParams.get('loja') || '';
        const pedido = url.searchParams.get('pedido') || '';
        if (!loja || !pedido) return json({ erro: 'faltou loja ou pedido' }, 400);
        const fb = await firebase(env);
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.status !== 'aguardando_pagamento' || !p.mp || !p.mp.id) return json({ status: p.status });
        const novo = await conferirPagamento(fb, loja, String(p.mp.id), pedido, env);
        return json({ status: novo || p.status });
      }

      /* ---- repasse antigo: o painel manda o POST com o proprio token ---- */
      if (caminho === '/' && request.method === 'POST') {
        const token = request.headers.get('Authorization') || '';
        if (!token.startsWith('Bearer ')) return json({ message: 'Sem token' }, 401);
        const resposta = await fetch(MP + '/v1/payments', {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json', 'X-Idempotency-Key': request.headers.get('X-Idempotency-Key') || crypto.randomUUID() },
          body: await request.text(),
        });
        return new Response(await resposta.text(), { status: resposta.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (request.method === 'GET') return new Response('Ligeiro + Mercado Pago: ok', { status: 200, headers: cors });
      return json({ erro: 'rota' }, 404);
    } catch (e) {
      return json({ erro: String((e && e.message) || e) }, 500);
    }
  },
};

/* Consulta o pagamento no Mercado Pago com o token da loja e, se aprovado, libera o pedido. Devolve o status novo. */
async function conferirPagamento(fb, slug, idPagamento, pedidoId, env) {
  const token = await tokenDaLoja(fb, slug, env);
  if (!token) return null;
  const ehOrder = String(idPagamento).indexOf('ORD') === 0;
  const pg = await mp(token, (ehOrder ? '/v1/orders/' : '/v1/payments/') + encodeURIComponent(idPagamento), {});
  let ref = String(pg.external_reference || '');
  if (ref.indexOf('|') > 0) ref = ref.split('|')[1];
  else if (ref.indexOf('__') > 0) ref = ref.split('__')[1];
  const id = pedidoId || ref;
  if (!id) return null;
  if (pg.status === 'approved' || pg.status === 'processed') {
    const p = await fb.get('lojas/' + slug + '/pedidos/' + id);
    if (!p) return null;
    /* o pagamento tem que ser DESTE pedido e do MESMO valor: ninguem reaproveita um Pix de R$ 1 pra liberar outro pedido */
    const limpo = (t) => String(t || '').replace(/[^A-Za-z0-9_-]/g, '');
    const refDoMp = String(pg.external_reference || '');
    const refCerta = refDoMp === limpo(slug + '__' + id).slice(0, 64) || refDoMp === slug + '|' + id || refDoMp === id;
    const valorMp = Math.round(Number(pg.total_amount != null ? pg.total_amount : pg.transaction_amount) * 100);
    if (!refCerta || valorMp !== p.total) return 'aguardando_pagamento';
    const agora3 = new Date().toISOString();
    if (p.status === 'aguardando_pagamento') {
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && (p.canceladoPor === 'cliente' || p.canceladoPor === 'pix-vencido') && !p.pagoEm) {
      /* pagou e o pedido ja tinha sido cancelado (desistiu depois de copiar o codigo, ou o Pix "venceu" pelo relogio do aparelho):
         o dinheiro entrou, entao o pedido volta pra fila, marcado pra loja ver */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
    }
    return 'pago';
  }
  if (pg.status === 'cancelled' || pg.status === 'expired') return 'aguardando_pagamento';
  return 'aguardando_pagamento';
}

/* Token da loja. Se veio pelo "Conectar" e esta perto de vencer, renova sozinho com o refresh_token. */
async function tokenDaLoja(fb, slug, env) {
  const seg = await fb.get('lojas/' + slug + '/privado/mercadopago');
  if (!seg || !seg.token) return '';
  const vence = seg.tokenExpiraEm ? new Date(seg.tokenExpiraEm).getTime() : 0;
  if (seg.refresh && env && env.MP_CLIENT_ID && env.MP_CLIENT_SECRET && vence && vence - Date.now() < 7 * 864e5) {
    try {
      const r = await fetch(MP + '/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: seg.refresh }),
      });
      const t = await r.json().catch(() => ({}));
      if (r.ok && t.access_token) {
        await fb.merge('lojas/' + slug + '/privado/mercadopago', { token: t.access_token, refresh: t.refresh_token || seg.refresh, tokenExpiraEm: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(), atualizadoEm: new Date().toISOString() });
        return t.access_token;
      }
    } catch (_) { /* segue com o token atual */ }
  }
  return String(seg.token).trim();
}

async function mp(token, caminho, opcoes) {
  const r = await fetch(MP + caminho, Object.assign({}, opcoes, { headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, (opcoes && opcoes.headers) || {}) }));
  const texto = await r.text();
  let dados = {};
  try { dados = JSON.parse(texto); } catch (_) { dados = { message: texto }; }
  if (!r.ok) throw new Error('Mercado Pago ' + r.status + ': ' + (dados.message || texto.slice(0, 120)));
  return dados;
}

function expiracaoBrasilia(minutos) {
  const alvo = new Date(Date.now() + minutos * 60 * 1000);
  const emBrasilia = new Date(alvo.getTime() - 3 * 60 * 60 * 1000);
  return emBrasilia.toISOString().replace('Z', '-03:00');
}
function separarNome(nomeCompleto, lojaNome) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  const primeiro = partes.shift() || 'Cliente';
  return { primeiro, sobrenome: partes.join(' ') || lojaNome || 'Ligeiro' };
}

/* ---------------- usuarios (Identity Toolkit) com a mesma conta de servico ---------------- */
async function usuarioDoToken(fb, idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ idToken }) });
  if (!r.ok) return '';
  const j = await r.json().catch(() => ({}));
  const u = (j.users || [])[0];
  return u && u.email ? String(u.email) : '';
}
async function definirUsuarioEquipe(fb, email, senha) {
  const base = 'https://identitytoolkit.googleapis.com/v1/projects/' + fb.projeto;
  const r = await fetch(base + '/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email: [email] }) });
  const j = r.ok ? await r.json().catch(() => ({})) : {};
  const u = (j.users || [])[0];
  if (u && u.localId) {
    const r2 = await fetch(base + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: u.localId, password: senha }) });
    if (!r2.ok) throw new Error('não deu pra trocar a senha (' + r2.status + ')');
    return;
  }
  const r3 = await fetch(base + '/accounts', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email, password: senha, emailVerified: true, displayName: 'Equipe' }) });
  if (!r3.ok) throw new Error('não deu pra criar o usuário de equipe (' + r3.status + ' ' + (await r3.text()).slice(0, 120) + ')');
}

/* ---------------- Firestore pela REST, autenticado com a conta de servico (JWT RS256) ---------------- */
async function firebase(env) {
  if (!env.FIREBASE_SA) throw new Error('falta o segredo FIREBASE_SA no worker');
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await tokenDaContaDeServico(sa);
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents/';
  const cab = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    cab: cab, projeto: sa.project_id,
    async get(caminho) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Firestore get ' + r.status);
      return deFirestore((await r.json()).fields || {});
    },
    async merge(caminho, dados) {
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (!r.ok) throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200));
    },
  };
}
/* documento = mapa de campos tipados (sem o envelope mapValue no topo) */
function camposFirestore(obj) { const f = {}; Object.keys(obj || {}).forEach((k) => { f[k] = paraFirestore(obj[k]); }); return f; }
function paraFirestore(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFirestore) } };
  if (typeof v === 'object') { const fields = {}; Object.keys(v).forEach((k) => { fields[k] = paraFirestore(v[k]); }); return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}
function deFirestore(fields) { const o = {}; Object.keys(fields || {}).forEach((k) => { o[k] = valorDe(fields[k]); }); return o; }
function valorDe(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorDe);
  if ('mapValue' in v) return deFirestore(v.mapValue.fields || {});
  return null;
}
async function tokenDaContaDeServico(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey('pkcs8', pemParaDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(cabecalho + '.' + corpo)));
  const jwt = cabecalho + '.' + corpo + '.' + b64url(assinatura);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('token Google ' + r.status);
  return (await r.json()).access_token;
}
function pemParaDer(pem) {
  const bin = atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function b64url(dados) {
  let bin = '';
  if (typeof dados === 'string') bin = unescape(encodeURIComponent(dados));
  else { for (let i = 0; i < dados.length; i++) bin += String.fromCharCode(dados[i]); }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
