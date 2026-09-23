/*
 * Ligeiro - mensageiro do Asaas (Cloudflare Workers, plano gratis).
 *
 * O Asaas avisa aqui quando uma cobranca e paga (webhook). Este worker descobre
 * o e-mail do cliente, calcula ate quando a conta fica paga e grava no Firestore:
 * contas/{email}.plano (status ativo, pagoAte, planoPago) e o espelho em cada
 * lojas/{slug}.plano e vitrine/{slug}.plano. Ninguem precisa apertar nada.
 *
 * Como publicar (15 minutos):
 *   1. Cloudflare > Workers & Pages > Create Worker > nome "ligeiro-asaas" > cole este arquivo > Deploy.
 *   2. Settings > Variables and Secrets (todos como Secret):
 *        ASAAS_KEY        chave da API do Asaas (Integracoes > Chave de API)
 *        ASAAS_WEBHOOK    um token inventado por voce (letras e numeros); o mesmo vai no webhook do Asaas
 *        FIREBASE_SA      o JSON inteiro da conta de servico do Firebase
 *                         (Firebase > Configuracoes do projeto > Contas de servico > Gerar nova chave privada)
 *        PLANOS           JSON com os precos em centavos, igual ao config.js. Exemplo:
 *                         {"uma":{"mensal":8900,"anual":89000,"fm":7900,"fa":79000},"duas":{"mensal":15800,"anual":158000,"fm":14800,"fa":148000},"tres":{"mensal":22700,"anual":227000,"fm":21700,"fa":217000}}
 *   2b. Settings > Bindings > Add binding > KV namespace: Variable name CARDAPIO, namespace ligeiro-cardapio
 *      (o mesmo do ligeiro-mp). Com ele, a loja destrava para o cliente na hora em que o pagamento cai.
 *   3. No Asaas: Integracoes > Webhooks > Adicionar: URL do worker, token = ASAAS_WEBHOOK,
 *      eventos PAYMENT_CONFIRMED e PAYMENT_RECEIVED. Fila sincrona, versao 3.
 *   4. O e-mail do cliente no Asaas tem que ser o MESMO e-mail com que o dono entra no Ligeiro
 *      (o link de assinatura ja pede o e-mail; confira em Clientes).
 *
 * O worker e idempotente: o mesmo pagamento avisado duas vezes nao soma dias duas vezes
 * (guarda o id da cobranca em contas/{email}.pagamentos).
 */
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Ligeiro + Asaas: ok', { status: 200 });
    const token = request.headers.get('asaas-access-token') || '';
    if (!env.ASAAS_WEBHOOK || token !== env.ASAAS_WEBHOOK) return json({ ok: false, erro: 'token' }, 401);

    let corpo;
    try { corpo = await request.json(); } catch (_) { return json({ ok: false, erro: 'json' }, 400); }
    const evento = corpo.event || '';
    const pag = corpo.payment || {};
    /* so pagamento confirmado interessa; o resto responde 200 pra fila do Asaas nao travar */
    if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].indexOf(evento) < 0) return json({ ok: true, ignorado: evento });
    if (!pag.id || !pag.customer) return json({ ok: false, erro: 'sem pagamento' }, 400);

    try {
      const cliente = await asaas(env, '/customers/' + pag.customer);
      const email = String(cliente.email || '').trim().toLowerCase();
      if (!email) return json({ ok: false, erro: 'cliente sem e-mail' }, 200);

      const centavos = Math.round(Number(pag.value || 0) * 100);
      const plano = descobrirPlano(env, centavos, pag);
      const fb = await firebase(env);
      const conta = await fb.get('contas/' + encodeURIComponent(email));
      const p = (conta && conta.plano) || {};
      const jaFeito = Array.isArray(conta && conta.pagamentos) && conta.pagamentos.indexOf(pag.id) >= 0;
      if (jaFeito) return json({ ok: true, repetido: pag.id });

      const base = Math.max(Date.now(), p.pagoAte ? new Date(p.pagoAte).getTime() : 0);
      const dias = plano.tipo === 'anual' ? 365 : 30;
      const pagoAte = new Date(base + dias * 864e5).toISOString();
      const novoPlano = Object.assign({}, p, {
        status: 'ativo', tipo: plano.tipo, planoId: p.planoId || plano.id, planoPago: plano.id, pagoAte: pagoAte,
        avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString(), cobrancaAsaas: pag.id,
      });
      const pagamentos = ((conta && conta.pagamentos) || []).concat([pag.id]).slice(-50);
      await fb.merge('contas/' + encodeURIComponent(email), { email: email, plano: novoPlano, pagamentos: pagamentos, atualizadoEm: new Date().toISOString() });

      /* espelho nas lojas e na vitrine */
      const espelho = { status: 'ativo', tipo: novoPlano.tipo, planoId: novoPlano.planoId, planoPago: novoPlano.planoPago, desde: p.desde || new Date().toISOString(), pagoAte: pagoAte, avisoPagamentoEm: '', avisoValor: 0 };
      const lojas = await fb.query('lojas', 'donoEmail', email);
      for (const slug of lojas) {
        await fb.merge('lojas/' + slug, { plano: espelho, atualizadoEm: new Date().toISOString() });
        await fb.merge('vitrine/' + slug, { plano: espelho, atualizadoEm: new Date().toISOString() });
        /* a copia da loja na borda (o que o cliente ve) cai fora: a proxima visita ja le a loja paga, destravada */
        if (env.CARDAPIO) await env.CARDAPIO.delete('loja:' + slug).catch(() => {});
      }
      if (env.CARDAPIO && lojas.length) await env.CARDAPIO.delete('vitrine').catch(() => {});
      return json({ ok: true, email: email, plano: plano.id, tipo: plano.tipo, pagoAte: pagoAte, lojas: lojas.length });
    } catch (e) {
      return json({ ok: false, erro: String(e && e.message || e) }, 500);
    }
  },
};

/* Qual plano foi pago: pelo valor (bate com PLANOS) ou, se nao bater, pelo texto da cobranca. */
function descobrirPlano(env, centavos, pag) {
  let planos = {};
  try { planos = JSON.parse(env.PLANOS || '{}'); } catch (_) { planos = {}; }
  /* fm e fa: o preco de fundador (mensal e anual) do mesmo plano */
  for (const id of Object.keys(planos)) {
    for (const [campo, tipo] of [['mensal', 'mensal'], ['anual', 'anual'], ['fm', 'mensal'], ['fa', 'anual']]) {
      if (Number(planos[id][campo]) === centavos) return { id: id, tipo: tipo };
    }
  }
  const texto = String((pag.description || '') + ' ' + (pag.externalReference || '')).toLowerCase();
  const id = Object.keys(planos).filter((k) => texto.indexOf(k) >= 0)[0] || 'uma';
  const tipo = texto.indexOf('anual') >= 0 || (pag.subscription && String(pag.billingType || '').length && centavos >= Number((planos[id] || {}).anual || 1e12)) ? 'anual' : 'mensal';
  return { id: id, tipo: tipo };
}

async function asaas(env, caminho) {
  const r = await fetch('https://api.asaas.com/v3' + caminho, { headers: { access_token: env.ASAAS_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error('Asaas ' + r.status + ' em ' + caminho);
  return r.json();
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

/* ---------------- Firestore pela REST, autenticado com a conta de servico (JWT RS256) ---------------- */
async function firebase(env) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await tokenDaContaDeServico(sa);
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents/';
  const cab = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    async get(caminho) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Firestore get ' + r.status);
      return deFirestore((await r.json()).fields || {});
    },
    async merge(caminho, dados) {
      const campos = Object.keys(dados);
      const mask = campos.map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (!r.ok) throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200));
    },
    async query(colecao, campo, valor) {
      const q = { structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } } }, select: { fields: [{ fieldPath: 'slug' }] } } };
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: cab, body: JSON.stringify(q) });
      if (!r.ok) throw new Error('Firestore query ' + r.status);
      const linhas = await r.json();
      return linhas.filter((l) => l.document).map((l) => l.document.name.split('/').pop());
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
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach((k) => { fields[k] = paraFirestore(v[k]); });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}
/* no topo (um documento) recebe o mapa "fields"; dentro, cada valor tipado */
function deFirestore(fields) {
  const o = {};
  Object.keys(fields || {}).forEach((k) => { o[k] = valorDe(fields[k]); });
  return o;
}
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
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey('pkcs8', pemParaDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(cabecalho + '.' + corpo)));
  const jwt = cabecalho + '.' + corpo + '.' + b64url(assinatura);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('token Google ' + r.status);
  return (await r.json()).access_token;
}
function pemParaDer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
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
