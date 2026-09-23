/*
 * Ligeiro - mensageiro (Cloudflare Workers, plano gratis).
 *
 * Duas funcoes no mesmo worker:
 *
 * 1) CARDAPIO NA BORDA (o que tira o peso do banco gratis)
 *   GET  /loja/{slug}        -> a loja (cardapio, horarios, precos) guardada no KV do Cloudflare.
 *                               O cliente le daqui, e nao do Firestore: o banco nao gasta leitura nem download por visita.
 *                               A copia confere o banco de novo so quando alguem pede e ela tem mais de 20 min
 *                               (e na hora, quando o dono salva algo no painel: rota /publicar).
 *   GET  /fotos/{slug}?v=... -> as miniaturas do cardapio, num pacote so. Guardado pela versao das fotos:
 *                               o celular do cliente guarda para sempre e so baixa de novo quando a loja troca alguma.
 *   GET  /foto/{slug}/{id}   -> uma foto grande (item aberto, capa). Cada foto tem nome unico: fica guardada para sempre.
 *   GET  /vitrine            -> o resumo das lojas (pagina das cidades e pagina de vendas), conferido a cada 15 min.
 *   POST /publicar { loja } + Authorization: Bearer <idToken do dono> -> o painel avisa que salvou; a copia se atualiza.
 *
 * 2) PIX AUTOMATICO pela conta Mercado Pago de cada loja
 *   POST /criar    { loja, pedido }  -> cria o Pix no Mercado Pago com o token da loja e grava o "copia e cola" no pedido.
 *   POST /webhook                    -> o Mercado Pago avisa que pagou; o pedido vira "pago" e cai na cozinha.
 *                                       O aviso ja traz a loja e o pedido (external_reference): nao precisa de indice.
 *   GET  /status?loja&pedido&mp&expira -> reforco: o site do cliente pergunta enquanto espera. Com mp e expira,
 *                                       pergunta direto ao Mercado Pago e so le o banco quando o Pix caiu.
 *   POST /equipe   { loja, pin } + Authorization: Bearer <idToken do dono> -> senha da equipe da loja.
 *   GET  /mp/volta                   -> volta do "Conectar com Mercado Pago" (OAuth).
 *   POST /                           -> repasse antigo (o painel manda o POST com o proprio token).
 *
 * 3) AVISOS NO CELULAR (Web Push, gratis: o Google e a Apple entregam de graca, mesmo com a tela apagada)
 *   GET  /vapid                      -> a chave publica dos avisos. O par de chaves nasce sozinho no KV na primeira vez.
 *   POST /aparelho { loja, papel, inscricao, testar, remover } + Bearer (dono ou equipe)
 *                                    -> guarda este aparelho da loja (painel, cozinha ou entregas) no KV.
 *   POST /novo     { loja, pedido }  -> o site do cliente avisa que fez um pedido (pago ou para cobrar na entrega):
 *                                       o painel e a cozinha apitam. So le o banco se a loja tiver aparelho ligado.
 *   POST /inscrever { loja, pedido, cidade, inscricao, remover } -> o cliente quer saber do pedido no celular.
 *   POST /avisar   { loja, pedido, status, resumo, aviso } + Bearer (dono ou equipe)
 *                                    -> o pedido andou: avisa o cliente (se ele quis) e o entregador (saiu para entrega).
 *   Pix que cai pelo Mercado Pago avisa a loja e o cliente sozinho, sem ninguem chamar nada.
 *
 * Como publicar (Cloudflare, sem cartao):
 *   1. Storage & Databases > KV > Create a namespace > nome "ligeiro-cardapio".
 *   2. Workers & Pages > ligeiro-mp > Edit code > apague tudo, cole este arquivo > Deploy.
 *   3. ligeiro-mp > Settings > Bindings > Add binding > KV namespace:
 *        Variable name: CARDAPIO      KV namespace: ligeiro-cardapio      > Save (ele publica sozinho).
 *   4. Os segredos continuam os mesmos (Settings > Variables and Secrets):
 *        FIREBASE_SA       o JSON inteiro da conta de servico do Firebase
 *        MP_CLIENT_ID      Client ID da aplicacao "Ligeiro plataforma" no Mercado Pago
 *        MP_CLIENT_SECRET  Client Secret da mesma aplicacao
 *   Sem o KV ligado, o site percebe e continua lendo do Firestore como antes (nada quebra).
 *
 * Limites do plano gratis: Workers 100 mil chamadas por dia; KV 100 mil leituras e 1 mil gravacoes por dia, 1 GB.
 * Uma visita ao cardapio usa 1 a 2 chamadas; um pedido com Pix, umas 5 a 15.
 */
const ORIGENS = ['https://ligeiropedidos.github.io', 'https://ligeiro.app.br', 'http://localhost:8765'];
const MP = 'https://api.mercadopago.com';
const ADMIN = 'ligeiro.pedidos@gmail.com';
/* a copia da loja confere o banco de novo depois disso (so se alguem pedir); o painel atualiza na hora ao salvar */
const LOJA_VALE = 20 * 60 * 1000;
const VITRINE_VALE = 15 * 60 * 1000;
const SLUG = /^[a-z0-9-]{1,60}$/;
/* memoria do worker: dura enquanto o Cloudflare deixa ele ligado (minutos). Nunca e a unica copia de nada. */
const MEM = { google: null, mp: {}, lojas: {}, vitrine: null, atualizando: {}, montando: {}, pausa: null, pausaGravadaEm: 0, pausaConferidaEm: 0, vapid: null, jwt: {}, quem: {}, avisados: {}, inscritos: {} };
const PEDIDO_ID = /^[A-Za-z0-9]{20}$/;
/* avisos so vao para os servicos de aviso dos navegadores (Google, Apple, Mozilla, Microsoft), nunca para endereco qualquer */
const SERVICO_AVISO = /^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\//i;
const PAPEIS = ['painel', 'cozinha', 'entregas'];

export default {
  async fetch(request, env, ctx) {
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
    const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json', ...(extra || {}) } });
    /* corpo ja pronto (texto ou fluxo do KV), sem montar de novo */
    const pronto = (corpo, guardar) => new Response(corpo, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': guardar } });
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
        delete MEM.mp[slug];
        await fb.merge('lojas/' + slug, { mpAtivo: true, aceitaPix: true, atualizadoEm: agora });
        await fb.merge('vitrine/' + slug, { aceitaPix: true, atualizadoEm: agora }).catch(() => {});
        /* o Pix aparece na loja na hora, sem esperar a copia da borda vencer */
        await atualizarLoja(env, slug).catch(() => {});
        return voltar(true);
      }

      /* ---- webhook do Mercado Pago (vem do servidor deles, sem Origin) ---- */
      if (caminho === '/webhook' && request.method === 'POST') {
        let slug = url.searchParams.get('loja') || '';
        let corpo = {};
        try { corpo = await request.json(); } catch (_) { corpo = {}; }
        const dados = corpo.data || {};
        const id = String(dados.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
        if (!id) return json({ ok: true, ignorado: true });
        let pedidoId = null;
        if (!slug) {
          /* o aviso de order traz o external_reference (loja__pedido): acha a loja sem ler o banco.
             Ninguem ganha nada inventando: o pagamento e conferido no Mercado Pago com o token da loja, pela referencia e pelo valor */
          const ref = String(dados.external_reference || '');
          const i = ref.indexOf('__');
          if (i > 0 && SLUG.test(ref.slice(0, i)) && /^[a-z0-9]{20}$/.test(ref.slice(i + 2))) { slug = ref.slice(0, i); pedidoId = ref.slice(i + 2); }
        }
        const fb = await firebase(env);
        if (!slug) {
          /* aviso sem referencia (ou cortada em 64 letras): acha pelo indice gravado na criacao */
          const idx = await fb.get('mp_indice/' + id);
          if (idx && idx.loja) { slug = idx.loja; pedidoId = idx.pedido || null; }
        }
        if (!slug) return json({ ok: true, ignorado: 'sem loja' });
        await conferirPagamento(fb, slug, id, pedidoId, env);
        return json({ ok: true });
      }

      if (conferir && origem && ORIGENS.indexOf(origem) < 0) return json({ erro: 'origem não permitida' }, 403);

      /* ---- cardapio na borda (publico, so leitura) ---- */
      if (request.method === 'GET') {
        let m = /^\/loja\/([a-z0-9-]{1,60})$/.exec(caminho);
        if (m) {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          const item = await lerLoja(env, ctx, m[1]);
          if (!item.existe) return json({ borda: 1, erro: 'nao-existe' }, 404, { 'Cache-Control': 'public, max-age=30' });
          /* banco no limite de hoje: a loja manda o pedido pelo WhatsApp ate zerar */
          const emPausa = await pausaAtiva(env);
          return pronto(emPausa ? item.corpo.replace('{"borda":1,', '{"borda":1,"pausa":true,') : item.corpo, 'public, max-age=15');
        }
        m = /^\/fotos\/([a-z0-9-]{1,60})$/.exec(caminho);
        if (m) {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return await servirFotos(env, ctx, m[1], url.searchParams.get('v') || '', pronto, json);
        }
        m = /^\/foto\/([a-z0-9-]{1,60})\/([A-Za-z0-9_-]{1,60})$/.exec(caminho);
        if (m) return await servirFoto(env, ctx, m[1], m[2]);
        if (caminho === '/vitrine') {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return pronto(await lerVitrine(env, ctx), 'public, max-age=60');
        }
        if (caminho === '/vapid') {
          if (!env.CARDAPIO) return json({ erro: 'sem KV' }, 501);
          return json({ borda: 1, chave: (await chavesVapid(env)).publica }, 200, { 'Cache-Control': 'public, max-age=600' });
        }
      }

      /* ---- avisos no celular ---- */
      if (caminho === '/aparelho' && request.method === 'POST') {
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '')) return json({ ok: false, erro: 'faltou a loja' }, 400);
        const quem = await quemChamou(env, request);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        if (!(await ehDaLoja(env, c.loja, quem))) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const lista = await aparelhosDaLoja(env, c.loja).catch(() => null);
        if (!lista) return json({ ok: false, erro: 'não deu para ligar agora. Tente de novo daqui a pouco.' }, 503);
        const papel = PAPEIS.indexOf(c.papel) >= 0 ? c.papel : 'painel';
        if (c.remover) {
          /* tira so este papel do aparelho (o mesmo celular pode ser painel e entregas) */
          const nova = [];
          lista.forEach((a) => { if (a.e !== String(c.remover)) { nova.push(a); return; } const ps = papeisDe(a).filter((x) => x !== papel); if (ps.length) nova.push(Object.assign({}, a, { p: ps })); });
          if (JSON.stringify(nova) !== JSON.stringify(lista)) await gravarAparelhos(env, c.loja, nova);
          return json({ ok: true });
        }
        const insc = limparInscricao(c.inscricao);
        if (!insc) return json({ ok: false, erro: 'este navegador mandou um aviso que não dá para usar' }, 400);
        const vapid = await chavesVapid(env);
        const atual = lista.filter((a) => a.e === insc.endpoint)[0];
        const papeis = atual ? papeisDe(atual) : [];
        /* mesmo aparelho, mesmas chaves e o papel ja la: nao grava de novo (o KV gratis tem 1 mil gravacoes por dia) */
        if (!atual || atual.k !== insc.p256dh || atual.a !== insc.auth || papeis.indexOf(papel) < 0 || atual.v !== vapid.publica.slice(0, 12)) {
          const nova = lista.filter((a) => a.e !== insc.endpoint).concat([{ e: insc.endpoint, k: insc.p256dh, a: insc.auth, p: papeis.concat(papeis.indexOf(papel) < 0 ? [papel] : []), v: vapid.publica.slice(0, 12), em: Date.now() }]);
          if (!(await gravarAparelhos(env, c.loja, nova))) return json({ ok: false, erro: 'não deu para guardar agora. Tente de novo daqui a pouco.' }, 503);
        }
        let teste = 0;
        if (c.testar) teste = await mandarAviso(env, insc, { titulo: 'Avisos ligados', texto: 'Pedido novo vai chegar assim, mesmo com a tela apagada.', url: urlDoPapel(c.loja, papel), tag: 'teste-' + papel });
        return json({ ok: true, teste: teste });
      }

      if (caminho === '/novo' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        /* zero leitura no banco: o aviso so leva numeros (senha, valor) e o tipo, nunca texto de quem pediu.
           Quem inventar um pedido so faz o painel apitar a toa (e no maximo 20 vezes por minuto) */
        const r = c.resumo && typeof c.resumo === 'object' ? c.resumo : {};
        const senha = String(r.senha == null ? '' : r.senha);
        const total = Number(r.total);
        if (!/^\d{1,6}$/.test(senha) || !Number.isInteger(total) || total < 0 || total > 10000000) return json({ ok: false, erro: 'faltou o resumo do pedido' }, 400);
        const marca = c.loja + '/' + c.pedido;
        if (MEM.avisados[marca]) return json({ ok: true, repetido: true });
        lembrar(MEM.avisados, marca);
        const minuto = Math.floor(Date.now() / 60000);
        const ritmo = MEM.avisados['ritmo/' + c.loja] = MEM.avisados['ritmo/' + c.loja] && MEM.avisados['ritmo/' + c.loja].m === minuto ? MEM.avisados['ritmo/' + c.loja] : { m: minuto, n: 0 };
        if (++ritmo.n > 20) return json({ ok: true, enviados: 0, devagar: true });
        const aparelhos = ((await aparelhosDaLoja(env, c.loja).catch(() => null)) || []).filter((a) => temPapel(a, 'painel') || temPapel(a, 'cozinha'));
        if (!aparelhos.length) return json({ ok: true, enviados: 0 });
        const p = { id: c.pedido, senha: senha, total: total, tipoEntrega: r.tipoEntrega === 'entrega' ? 'entrega' : 'retirada', origem: r.origem === 'balcao' ? 'balcao' : '' };
        const enviados = await avisarAparelhos(env, c.loja, aparelhos, (a) => avisoDaLoja(p, c.loja, temPapel(a, 'painel') ? 'painel' : 'cozinha', false));
        return json({ ok: true, enviados: enviados });
      }

      if (caminho === '/inscrever' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        const marca = c.loja + '/' + c.pedido + (c.remover ? '/sai' : '');
        if (MEM.inscritos[marca] && Date.now() - MEM.inscritos[marca] < 10 * 1000) return json({ ok: true, repetido: true });
        let aviso = null;
        if (!c.remover) {
          const insc = limparInscricao(c.inscricao);
          if (!insc || !SLUG.test(c.cidade || '')) return json({ ok: false, erro: 'este navegador mandou um aviso que não dá para usar' }, 400);
          aviso = { e: insc.endpoint, k: insc.p256dh, a: insc.auth, u: '#/' + c.cidade + '/' + c.loja + '/pedido/' };
        }
        const fb = await firebase(env);
        /* grava no proprio pedido (1 gravacao, sem ler): o painel ja recebe junto e sabe que o cliente e avisado sozinho */
        const existe = await fb.mergeSeExiste('lojas/' + c.loja + '/pedidos/' + c.pedido, { aviso: aviso });
        if (!existe) return json({ ok: false, erro: 'pedido não existe' }, 404);
        lembrar(MEM.inscritos, marca);
        return json({ ok: true });
      }

      if (caminho === '/avisar' && request.method === 'POST') {
        const c = await request.json().catch(() => ({}));
        if (!SLUG.test(c.loja || '') || !PEDIDO_ID.test(c.pedido || '')) return json({ ok: false, erro: 'faltou a loja ou o pedido' }, 400);
        const quem = await quemChamou(env, request);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        if (!(await ehDaLoja(env, c.loja, quem))) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const r = resumoLimpo(c.resumo, c.pedido);
        const tarefas = [];
        let cliente = 0, equipe = 0;
        const insc = limparInscricao(c.aviso);
        const texto = insc ? avisoDoCliente(c.status, r, await nomeDaLoja(env, c.loja)) : null;
        if (texto) tarefas.push(mandarAviso(env, insc, Object.assign(texto, { url: urlDoCliente(c.aviso, c.pedido), tag: 'p' + c.pedido, topico: 'p' + c.pedido })).then((s) => { cliente = s; }));
        /* saiu para entrega: o entregador fica sabendo. Pix conferido a mao no painel: a cozinha fica sabendo */
        const papel = c.status === 'pronto' && r.tipoEntrega === 'entrega' ? 'entregas' : (c.status === 'pago' ? 'cozinha' : '');
        if (papel && env.CARDAPIO) {
          tarefas.push(aparelhosDaLoja(env, c.loja).then((lista) => {
            const deles = lista.filter((a) => temPapel(a, papel));
            return deles.length ? avisarAparelhos(env, c.loja, deles, () => (papel === 'entregas' ? avisoDeEntrega(r, c.loja) : avisoDaLoja(r, c.loja, 'cozinha', true))) : 0;
          }).then((n) => { equipe = n; }, () => { equipe = 0; }));
        }
        await Promise.all(tarefas);
        return json({ ok: true, cliente: cliente, equipe: equipe });
      }

      /* ---- um cliente bateu no limite do banco: confere (uma gravacao e uma leitura, no maximo 1 vez por minuto) ---- */
      if (caminho === '/pausa' && request.method === 'POST') {
        if (Date.now() - MEM.pausaConferidaEm < 60 * 1000) return json({ pausa: !!(MEM.pausa && MEM.pausa.valor) });
        MEM.pausaConferidaEm = Date.now();
        const fb = await firebase(env);
        try {
          await fb.merge('publico/saude', { conferidoEm: new Date().toISOString() });
          await fb.get('publico/fundadores');
          return json({ pausa: false });
        } catch (_) {
          return json({ pausa: !!(MEM.pausa && MEM.pausa.valor) });
        }
      }

      /* ---- o painel salvou: a copia da borda se atualiza agora (so o dono da loja ou o admin) ---- */
      if (caminho === '/publicar' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja } = await request.json().catch(() => ({}));
        if (!idToken || !SLUG.test(loja || '')) return json({ ok: false, erro: 'faltou a loja ou o login' }, 400);
        if (!env.CARDAPIO) return json({ ok: false, erro: 'sem KV' }, 501);
        const fb = await firebase(env);
        const quem = (await usuarioDoToken(fb, idToken)).toLowerCase();
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        /* confere o dono pela copia que ja existe (sem ler o banco); loja sem copia ainda: le uma vez */
        const antes = await lerKv(env, 'loja:' + loja, 'text');
        const donoAntes = antes && antes.metadata ? String(antes.metadata.dono || '') : '';
        if (donoAntes && donoAntes !== quem && quem !== ADMIN) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        const item = await atualizarLoja(env, loja);
        if (!item.existe) return json({ ok: false, erro: 'loja não existe' }, 404);
        if (item.meta.dono !== quem && quem !== ADMIN) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        /* mudou algo que a pagina da cidade mostra (aberta, nome, logo, frete, tempo): a vitrine da borda sai e e refeita
           na proxima visita. Antes ficava ate ~20 min dizendo "Aberta agora" de loja que ja tinha fechado. Preco e foto
           de item nao mexem nela (nao gasta gravacao do KV a cada edicao) */
        if (!antes || !antes.value || camposDaVitrine(antes.value) !== camposDaVitrine(item.corpo)) {
          MEM.vitrine = null;
          if (ctx && ctx.waitUntil) ctx.waitUntil(env.CARDAPIO.delete('vitrine').catch(() => {}));
        }
        return json({ ok: true, versao: item.meta.em });
      }

      /* ---- senha da equipe: o dono (logado) define; criamos/trocamos o usuario de equipe da loja ---- */
      if (caminho === '/equipe' && request.method === 'POST') {
        const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { loja, pin } = await request.json();
        const senha = String(pin || '').replace(/\D/g, '');
        if (!idToken || !loja || senha.length < 6 || senha.length > 8) return json({ ok: false, erro: 'senha de 6 a 8 números' }, 400);
        const fb = await firebase(env);
        const quem = await usuarioDoToken(fb, idToken);
        if (!quem) return json({ ok: false, erro: 'entre na sua conta de novo' }, 401);
        const l = await fb.get('lojas/' + loja);
        if (!l || String(l.donoEmail || '').toLowerCase() !== quem.toLowerCase()) return json({ ok: false, erro: 'essa loja não é sua' }, 403);
        await definirUsuarioEquipe(fb, 'equipe-' + loja + '@equipe.ligeiro.app.br', 'LIG-' + senha, loja);
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
        /* pedido antigo que nunca ganhou codigo: nada de Pix novo horas depois (a loja so ve a fila do dia e nao veria o pago) */
        if (p.criadoEm && Date.now() - Date.parse(p.criadoEm) > 40 * 60 * 1000) return json({ erro: 'esse pedido passou do prazo do Pix' }, 409);
        const token = await tokenDaLoja(fb, loja, env);
        if (!token) return json({ erro: 'a loja não ligou o Pix automático' }, 409);
        /* nome da loja (sobrenome de quem pediu com um nome so): da copia da borda, sem ler o banco */
        const nome = separarNome(p.cliente && p.cliente.nome, await nomeDaLoja(env, loja));
        /* API Orders do Mercado Pago (a de Payments vai ser descontinuada) */
        const valor = (p.total / 100).toFixed(2);
        const inteira = loja + '__' + pedido;
        /* a API Orders so aceita letras, numeros, hifen e sublinhado (ate 64): nada de "|" */
        const referencia = inteira.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const corpo = {
          type: 'online',
          total_amount: valor,
          external_reference: referencia,
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
        /* indice pro webhook so quando a referencia foi cortada (loja de nome muito comprido): o aviso normal ja traz loja e pedido */
        if (referencia !== inteira) await fb.merge('mp_indice/' + String(ord.id), { loja: loja, pedido: pedido, criadoEm: agora2 }).catch(() => {});
        return json({ codigo: qr, expiraEm: expira, mp: String(ord.id) });
      }

      /* ---- o site pergunta se caiu ---- */
      if (caminho === '/status' && request.method === 'GET') {
        const loja = url.searchParams.get('loja') || '';
        const pedido = url.searchParams.get('pedido') || '';
        if (!loja || !pedido) return json({ erro: 'faltou loja ou pedido' }, 400);
        const mpId = url.searchParams.get('mp') || '';
        const expira = Date.parse(url.searchParams.get('expira') || '');
        const fb = await firebase(env);
        if (/^[A-Za-z0-9_-]{1,64}$/.test(mpId) && !isNaN(expira)) {
          /* caminho leve (site novo): pergunta direto ao Mercado Pago; o banco so e lido se o Pix caiu.
             O prazo vem do proprio pedido (pixExpiraEm) e vale pelo relogio do servidor, nunca o do aparelho */
          let novo = null;
          try { novo = await conferirPagamento(fb, loja, mpId, pedido, env); } catch (_) { novo = null; }
          const status = novo || 'aguardando_pagamento';
          return json({ status: status, vencido: status === 'aguardando_pagamento' && Date.now() > expira });
        }
        const p = await fb.get('lojas/' + loja + '/pedidos/' + pedido, true);
        if (!p) return json({ erro: 'pedido não existe' }, 404);
        if (p.status !== 'aguardando_pagamento' || !p.mp || !p.mp.id) return json({ status: p.status, vencido: pixVencidoNoServidor(p, Date.now()) });
        let novo = null;
        try { novo = await conferirPagamento(fb, loja, String(p.mp.id), pedido, env); } catch (_) { novo = null; /* Mercado Pago fora do ar: responde pelo que o banco tem */ }
        const status = novo || p.status;
        return json({ status: status, vencido: status === 'aguardando_pagamento' && pixVencidoNoServidor(p, Date.now()) });
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

/* ================= banco no limite do dia ================= */

/* o limite do Firebase gratis zera a meia-noite do Pacifico (4 h ou 5 h em Brasilia): o aviso vale ate la */
function segundosAteZerar() {
  const agora = new Date();
  const pacifico = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const fim = new Date(pacifico); fim.setHours(24, 5, 0, 0);
  return Math.max(120, Math.round((fim - pacifico) / 1000));
}
/* o banco respondeu 429 (limite): guarda o aviso no KV ate zerar (uma gravacao a cada 5 min no maximo) */
function marcarPausa(env) {
  MEM.pausa = { valor: true, lida: Date.now() };
  if (!env || !env.CARDAPIO || Date.now() - MEM.pausaGravadaEm < 5 * 60 * 1000) return;
  MEM.pausaGravadaEm = Date.now();
  env.CARDAPIO.put('sistema:pausa', '1', { expirationTtl: segundosAteZerar() }).catch(() => {});
}
async function pausaAtiva(env) {
  if (MEM.pausa && Date.now() - MEM.pausa.lida < 60 * 1000) return MEM.pausa.valor;
  let valor = false;
  if (env.CARDAPIO) { try { valor = (await env.CARDAPIO.get('sistema:pausa')) === '1'; } catch (_) { valor = false; } }
  MEM.pausa = { valor: valor, lida: Date.now() };
  return valor;
}

/* ================= cardapio na borda ================= */

async function lerKv(env, chave, tipo) {
  if (!env.CARDAPIO) return null;
  try { return await env.CARDAPIO.getWithMetadata(chave, { type: tipo || 'text' }); } catch (_) { return null; }
}
async function gravarKv(env, chave, valor, metadata) {
  if (!env.CARDAPIO) return false;
  /* passou do limite de gravacoes do dia (1 mil no gratis): segue servindo o que leu do banco, sem guardar */
  try { await env.CARDAPIO.put(chave, valor, { metadata: metadata }); return true; } catch (_) { return false; }
}

/* A loja pronta para o site: da memoria (1 min), do KV (e confere o banco por tras se passou de 20 min) ou do banco. */
async function lerLoja(env, ctx, slug) {
  const mem = MEM.lojas[slug];
  if (mem && Date.now() - mem.lida < 60 * 1000) return mem;
  const g = await lerKv(env, 'loja:' + slug, 'text');
  if (g && g.value && g.metadata && g.metadata.em) {
    const item = { existe: true, corpo: g.value, meta: g.metadata, lida: Date.now() };
    MEM.lojas[slug] = item;
    if (Date.now() - g.metadata.em > LOJA_VALE) atualizarDepois(ctx, 'loja:' + slug, () => atualizarLoja(env, slug));
    return item;
  }
  return atualizarLoja(env, slug);
}

/* Le a loja no banco (1 leitura), tira o que nao e publico e guarda a resposta pronta no KV. */
async function atualizarLoja(env, slug) {
  const fb = await firebase(env);
  const doc = await fb.get('lojas/' + slug);
  if (!doc) {
    const nada = { existe: false, lida: Date.now(), meta: { em: Date.now(), dono: '' } };
    MEM.lojas[slug] = nada;
    return nada;
  }
  const publica = Object.assign({}, doc);
  delete publica.donoEmail; delete publica.senhaEquipeEm; delete publica.email;
  const meta = {
    em: Date.now(),
    dono: String(doc.donoEmail || '').toLowerCase().slice(0, 200),
    fotosVersao: String(doc.fotosVersao || '').slice(0, 60),
    pacote: doc.fotosPacote === 1 && !doc.fotosAvulsas ? 1 : 0,
    capa: String(doc.capa || '').slice(0, 60),
    nome: String(doc.nome || '').slice(0, 80),
  };
  const corpo = '{"borda":1,"loja":' + JSON.stringify(publica) + '}';
  await gravarKv(env, 'loja:' + slug, corpo, meta);
  const item = { existe: true, corpo: corpo, meta: meta, lida: Date.now() };
  MEM.lojas[slug] = item;
  return item;
}

/* atualiza depois de responder (quem pediu nao espera); uma vez so por vez neste worker */
function atualizarDepois(ctx, chave, fazer) {
  if (MEM.atualizando[chave]) return;
  MEM.atualizando[chave] = true;
  const p = Promise.resolve().then(fazer).catch(() => {}).then(() => { delete MEM.atualizando[chave]; });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

async function nomeDaLoja(env, slug) {
  const meta = await etiquetaDaLoja(env, slug);
  return (meta && meta.nome) || '';
}
/* a etiqueta da copia da loja (dono, nome, versao das fotos): da memoria ou do KV, sem ler o corpo (o cardapio inteiro) */
async function etiquetaDaLoja(env, slug) {
  const mem = MEM.lojas[slug];
  if (mem && mem.meta && mem.existe) return mem.meta;
  const g = await lerKv(env, 'loja:' + slug, 'stream');
  if (g && g.value && g.value.cancel) g.value.cancel().catch(() => {});
  return g && g.metadata ? g.metadata : null;
}

/* Miniaturas: guardadas pela versao das fotos da loja. Os documentos do banco vao como vieram (texto), sem o worker
   abrir e remontar megas de foto (o plano gratis tem 10 ms de processamento por chamada); o site junta no aparelho. */
async function servirFotos(env, ctx, slug, versaoPedida, pronto, json) {
  const loja = await lerLoja(env, ctx, slug);
  if (!loja.existe) return json({ borda: 1, erro: 'nao-existe' }, 404, { 'Cache-Control': 'public, max-age=30' });
  const atual = String(loja.meta.fotosVersao || '');
  const guardar = versaoPedida && versaoPedida === atual ? 'public, max-age=31536000, immutable' : 'public, max-age=30';
  const g = await lerKv(env, 'fotos:' + slug, 'stream');
  if (g && g.value && g.metadata && g.metadata.versao === atual) return pronto(g.value, guardar);
  if (g && g.value && g.value.cancel) g.value.cancel().catch(() => {});
  /* versao nova: monta uma vez so (varios clientes ao mesmo tempo esperam a mesma montagem) */
  const chave = 'fotos:' + slug + ':' + atual;
  if (!MEM.montando[chave]) {
    MEM.montando[chave] = montarFotos(env, slug, loja.meta).then(async (corpo) => {
      await gravarKv(env, 'fotos:' + slug, corpo, { versao: atual });
      return corpo;
    }).finally(() => { delete MEM.montando[chave]; });
  }
  return pronto(await MEM.montando[chave], guardar);
}

async function montarFotos(env, slug, meta) {
  const fb = await firebase(env);
  const pasta = 'lojas/' + slug + '/fotos';
  const docs = [];
  let pacote = false;
  if (meta.pacote) {
    /* 4 pacotes de miniaturas + a capa inteira */
    const partes = await Promise.all([0, 1, 2, 3].map((i) => fb.getTexto(pasta + '/_pacote' + i)));
    partes.forEach((t) => { if (t) docs.push(t); });
    if (meta.capa) { const c = await fb.getTexto(pasta + '/' + meta.capa); if (c) docs.push(c); }
    pacote = true;
  } else {
    /* loja sem pacote (poucas fotos): a pasta inteira, de 50 em 50 */
    let pagina = '';
    for (let i = 0; i < 20; i++) {
      const t = await fb.listarTexto(pasta, 50, pagina);
      if (!t) break;
      docs.push(t);
      const prox = /"nextPageToken"\s*:\s*"([^"]+)"/.exec(t.slice(-400));
      if (!prox) break;
      pagina = prox[1];
    }
  }
  return '{"borda":1,"versao":' + JSON.stringify(String(meta.fotosVersao || '')) + ',"pacote":' + pacote + ',"docs":[' + docs.join(',') + ']}';
}

/* Uma foto grande: nome unico por foto, entao fica guardada para sempre (no KV e no celular do cliente). */
async function servirFoto(env, ctx, slug, id) {
  const imagem = (bytes, tipo) => new Response(bytes, { status: 200, headers: { 'Content-Type': tipo || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
  const chave = 'foto:' + slug + ':' + id;
  const g = await lerKv(env, chave, 'arrayBuffer');
  if (g && g.value) return imagem(g.value, g.metadata && g.metadata.tipo);
  /* so busca no banco foto que a loja usa de verdade (item ou capa): endereco inventado nao gasta leitura */
  const naoTem = () => new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
  if (env.CARDAPIO) {
    const loja = await lerLoja(env, ctx, slug);
    if (!loja.existe) return naoTem();
    let usadas = loja.fotos;
    if (!usadas) {
      try {
        const l = JSON.parse(loja.corpo).loja || {};
        usadas = [l.capa].concat((l.produtos || []).map((p) => p && p.foto)).filter(Boolean);
      } catch (_) { usadas = []; }
      loja.fotos = usadas;
    }
    if (usadas.indexOf(id) < 0) return naoTem();
  }
  const fb = await firebase(env);
  const d = await fb.get('lojas/' + slug + '/fotos/' + id);
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(d && typeof d.dados === 'string' ? d.dados : '');
  if (!m) return new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } });
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const gravar = gravarKv(env, chave, bytes.buffer, { tipo: m[1] });
  if (ctx && ctx.waitUntil) ctx.waitUntil(gravar);
  return imagem(bytes, m[1]);
}

/* o que a vitrine (pagina da cidade) mostra de cada loja: se nada disso mudou, a vitrine da borda continua valendo */
function camposDaVitrine(texto) {
  try {
    const x = JSON.parse(texto).loja || {};
    return JSON.stringify([x.aberta, x.usarHorarios, x.horarios, x.nome, x.tipo, x.emoji, x.descricao, x.logoDados, x.logoUrl, x.capa, x.capaUrl, x.cor,
      x.tempoEntrega, x.tempoPreparo, x.aceitaEntrega, x.aceitaRetirada, x.freteGratis, x.taxaEntrega, x.entregaGratisAcima, x.ativa, x.cidadeSlug, x.plano]);
  } catch (_) { return ''; }
}

/* Vitrine: o resumo de todas as lojas (N leituras) no maximo a cada 15 min, e so quando alguem pede. */
async function lerVitrine(env, ctx) {
  if (MEM.vitrine && Date.now() - MEM.vitrine.lida < 60 * 1000) return MEM.vitrine.corpo;
  const g = await lerKv(env, 'vitrine', 'text');
  if (g && g.value && g.metadata && g.metadata.em) {
    MEM.vitrine = { corpo: g.value, lida: Date.now() };
    if (Date.now() - g.metadata.em > VITRINE_VALE) atualizarDepois(ctx, 'vitrine', () => atualizarVitrine(env));
    return g.value;
  }
  return atualizarVitrine(env);
}
async function atualizarVitrine(env) {
  const fb = await firebase(env);
  const lista = await fb.listar('vitrine');
  const corpo = '{"borda":1,"lista":' + JSON.stringify(lista.map((d) => { const x = Object.assign({}, d); delete x._id; return x; })) + '}';
  await gravarKv(env, 'vitrine', corpo, { em: Date.now() });
  MEM.vitrine = { corpo: corpo, lida: Date.now() };
  return corpo;
}

/* ================= avisos no celular (Web Push) ================= */
/* Nada aqui le o banco: os aparelhos da loja ficam no KV e o aviso do cliente vai dentro do proprio pedido.
   O aviso sai criptografado (RFC 8291): so o celular de destino consegue ler; o Google e a Apple so entregam. */

/* guarda a marca por uma hora (a memoria nao cresce sem fim) */
function lembrar(mapa, chave) {
  const agora = Date.now();
  const chaves = Object.keys(mapa);
  if (chaves.length > 500) chaves.forEach((k) => { if (agora - mapa[k] > 60 * 60 * 1000) delete mapa[k]; });
  mapa[chave] = agora;
}

/* O par de chaves dos avisos (VAPID) nasce na primeira vez e fica no KV: ninguem precisa criar segredo no Cloudflare. */
async function chavesVapid(env) {
  if (MEM.vapid) return MEM.vapid;
  /* erro de leitura sobe (quem chamou responde erro): trocar a chave derrubaria todos os aparelhos e clientes inscritos */
  const t = await env.CARDAPIO.get('sistema:vapid');
  let guardada = null;
  try { guardada = t ? JSON.parse(t) : null; } catch (_) { guardada = null; }
  if (!t) {
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
    guardada = { privada: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, publica: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))) };
    await env.CARDAPIO.put('sistema:vapid', JSON.stringify(guardada));
  } else if (!guardada || !guardada.privada || !guardada.publica) {
    throw new Error('chave dos avisos estragada no KV');
  }
  const chave = await crypto.subtle.importKey('jwk', guardada.privada, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  MEM.vapid = { publica: guardada.publica, chave: chave };
  return MEM.vapid;
}

/* assinatura do Ligeiro para o servico de avisos (uma por servico, guardada 1 hora) */
async function jwtVapid(vapid, aud) {
  const m = MEM.jwt[aud];
  if (m && Date.now() < m.vale) return m.jwt;
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64url(JSON.stringify({ aud: aud, exp: agora + 12 * 3600, sub: 'mailto:' + ADMIN }));
  const ass = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.chave, new TextEncoder().encode(cab + '.' + corpo)));
  const jwt = cab + '.' + corpo + '.' + b64url(ass);
  MEM.jwt[aud] = { jwt: jwt, vale: Date.now() + 60 * 60 * 1000 };
  return jwt;
}

function deB64url(s) {
  const t = String(s || '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function juntar() {
  const partes = Array.prototype.slice.call(arguments);
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  partes.forEach((p) => { out.set(p, i); i += p.length; });
  return out;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, k, bytes * 8));
}
/* chave de uso unico desta chamada (vale para todos os aparelhos avisados nela: o sal de cada aviso e novo) */
async function efemeraNova() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privada: par.privateKey, publica: new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)) };
}
async function cifrarAviso(insc, texto, efemera) {
  const enc = new TextEncoder();
  const doAparelho = deB64url(insc.p256dh);
  const auth = deB64url(insc.auth);
  const chaveAparelho = await crypto.subtle.importKey('raw', doAparelho, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveAparelho }, efemera.privada, 256));
  const ikm = await hkdf(auth, segredo, juntar(enc.encode('WebPush: info\0'), doAparelho, efemera.publica), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, juntar(enc.encode(texto), new Uint8Array([2]))));
  return juntar(sal, new Uint8Array([0, 0, 16, 0]), new Uint8Array([efemera.publica.length]), efemera.publica, cifrado);
}

/* inscricao que o navegador mandou, conferida: so servico de aviso conhecido e chaves do tamanho certo */
function limparInscricao(x) {
  if (!x || typeof x !== 'object') return null;
  const e = String(x.endpoint || x.e || '');
  const k = String((x.keys && x.keys.p256dh) || x.k || '').replace(/=+$/, '');
  const a = String((x.keys && x.keys.auth) || x.a || '').replace(/=+$/, '');
  if (e.length > 1000 || !SERVICO_AVISO.test(e) || !/^[A-Za-z0-9_-]{86,88}$/.test(k) || !/^[A-Za-z0-9_-]{20,24}$/.test(a)) return null;
  return { endpoint: e, p256dh: k, auth: a };
}

/* Manda um aviso. Devolve o codigo do servico: 201 entregue; 404/410 o aparelho saiu; 403 chave antiga. */
async function mandarAviso(env, insc, aviso, efemera) {
  if (!insc || !env.CARDAPIO) return 0;
  const vapid = await chavesVapid(env);
  const jwt = await jwtVapid(vapid, new URL(insc.endpoint).origin);
  const carga = JSON.stringify({ titulo: aviso.titulo, texto: aviso.texto, url: aviso.url || '#/', tag: aviso.tag || '', fixo: !!aviso.fixo });
  const cab = { Authorization: 'vapid t=' + jwt + ', k=' + vapid.publica, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(aviso.validade || 3600), Urgency: 'high' };
  /* aviso do mesmo pedido com o celular desligado: chega so o ultimo (saiu para entrega, e nao preparando + saiu) */
  if (aviso.topico) cab.Topic = aviso.topico;
  try {
    const r = await fetch(insc.endpoint, { method: 'POST', headers: cab, body: await cifrarAviso(insc, carga, efemera || await efemeraNova()) });
    return r.status;
  } catch (_) { return 0; }
}

/* Avisa varios aparelhos da loja de uma vez; aparelho que saiu (desinstalou, trocou de chave) sai da lista. */
async function avisarAparelhos(env, slug, lista, montar) {
  const efemera = await efemeraNova();
  const mortos = [];
  let enviados = 0;
  await Promise.all(lista.map(async (a) => {
    const s = await mandarAviso(env, { endpoint: a.e, p256dh: a.k, auth: a.a }, montar(a), efemera);
    if (s >= 200 && s < 300) enviados += 1;
    else if (s === 403 || s === 404 || s === 410) mortos.push(a.e);
  }));
  if (mortos.length) {
    /* leitura que falhou nao pode virar lista vazia gravada por cima */
    const atual = await aparelhosDaLoja(env, slug).catch(() => null);
    if (atual) await gravarAparelhos(env, slug, atual.filter((a) => mortos.indexOf(a.e) < 0));
  }
  return enviados;
}

async function aparelhosDaLoja(env, slug) {
  if (!env.CARDAPIO) return [];
  const t = await env.CARDAPIO.get('aparelhos:' + slug); /* erro de leitura sobe: quem chama nao grava nada */
  if (!t) return [];
  try { const l = JSON.parse(t); return Array.isArray(l) ? l : []; } catch (_) { return []; }
}
/* papeis do aparelho: painel, cozinha e/ou entregas (o mesmo celular pode ter mais de um) */
function papeisDe(a) { return Array.isArray(a.p) ? a.p.filter((x) => PAPEIS.indexOf(x) >= 0) : (PAPEIS.indexOf(a.p) >= 0 ? [a.p] : ['painel']); }
function temPapel(a, papel) { return papeisDe(a).indexOf(papel) >= 0; }
/* no maximo 8 aparelhos por loja (os mais novos ficam): cada aviso cifrado gasta um pouco dos 10 ms do plano gratis */
function gravarAparelhos(env, slug, lista) { return gravarKv(env, 'aparelhos:' + slug, JSON.stringify(lista.slice(-8)), { em: Date.now() }); }

/* quem chamou (login do Firebase), guardado 20 min: o painel nao confere o login a cada pedido que anda */
async function quemChamou(env, request) {
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken || idToken.length > 4000) return '';
  const m = MEM.quem[idToken];
  if (m && Date.now() - m.em < 20 * 60 * 1000) return m.email;
  const email = (await usuarioDoToken(await firebase(env), idToken)).toLowerCase();
  if (email) {
    const chaves = Object.keys(MEM.quem);
    if (chaves.length > 200) chaves.forEach((k) => { if (Date.now() - MEM.quem[k].em > 20 * 60 * 1000) delete MEM.quem[k]; });
    MEM.quem[idToken] = { email: email, em: Date.now() };
  }
  return email;
}
/* dono (pela copia da borda, sem ler o banco), equipe da loja ou o admin */
async function ehDaLoja(env, slug, email) {
  if (!email) return false;
  if (email === ADMIN || email === 'equipe-' + slug + '@equipe.ligeiro.app.br') return true;
  const meta = await etiquetaDaLoja(env, slug);
  let dono = meta ? String(meta.dono || '') : '';
  if (!dono) { const item = await atualizarLoja(env, slug); dono = item.existe ? item.meta.dono : ''; }
  return !!dono && dono === email;
}

function reais(centavos) {
  const v = Math.round(Number(centavos) || 0);
  const inteiro = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + inteiro + ',' + String(v % 100).padStart(2, '0');
}
function urlDoPapel(slug, papel) { return '#/' + (papel === 'cozinha' ? 'cozinha' : papel === 'entregas' ? 'entrega' : 'painel') + '/' + slug; }
/* a tela do pedido do cliente: o aviso guarda "#/cidade/loja/pedido/" (nasce junto com o pedido, antes do numero) */
function urlDoCliente(aviso, id) {
  const u = String((aviso && aviso.u) || '');
  if (/^#\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}\/pedido\/$/.test(u) && PEDIDO_ID.test(id || '')) return u + id;
  return /^#\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}\/pedido\/[A-Za-z0-9]{20}$/.test(u) ? u : '#/';
}
/* o que o painel manda sobre o pedido, conferido e cortado (vira texto de aviso, nunca mais que isso) */
function resumoLimpo(r, id) {
  const x = r && typeof r === 'object' ? r : {};
  const curto = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  return {
    id: id, senha: curto(x.senha, 8), total: Math.max(0, Math.round(Number(x.total) || 0)),
    tipoEntrega: x.tipoEntrega === 'entrega' ? 'entrega' : 'retirada', origem: x.origem === 'balcao' ? 'balcao' : '',
    cliente: { nome: curto(x.nome, 40) }, bairro: curto(x.bairro, 40),
  };
}

/* pedido novo (ou Pix que caiu) para o painel e a cozinha: senha, valor e o tipo (o resto a equipe ve no painel) */
function avisoDaLoja(p, slug, papel, pix) {
  const onde = p.tipoEntrega === 'entrega' ? 'Entrega' : (p.origem === 'balcao' ? 'Balcão' : 'Retirada');
  return { titulo: (pix ? 'Pix pago! Senha ' : 'Pedido novo! Senha ') + p.senha, texto: reais(p.total) + ' · ' + onde + ' · Toque para abrir', url: urlDoPapel(slug, papel), tag: 'pedido-' + p.id, fixo: true, validade: 1800 };
}
/* saiu da cozinha para entrega: para o entregador */
function avisoDeEntrega(r, slug) {
  return { titulo: 'Entrega pronta! Senha ' + r.senha, texto: (r.bairro ? r.bairro + ' · ' : '') + 'Toque para ver o endereço.', url: urlDoPapel(slug, 'entregas'), tag: 'entrega-' + r.id, fixo: true, validade: 1800 };
}
/* o pedido andou: o que o cliente le no celular (titulo com o nome da loja, que ele reconhece) */
function avisoDoCliente(status, r, nomeLoja) {
  const loja = nomeLoja || 'Seu pedido';
  const senha = ' Senha ' + r.senha + '.';
  const entrega = r.tipoEntrega === 'entrega';
  if (status === 'pago') return { titulo: loja, texto: 'Pagamento confirmado! Seu pedido entrou na fila.' + senha };
  if (status === 'producao') return { titulo: loja, texto: 'Estão preparando o seu pedido. ' + (entrega ? 'Logo sai para entrega.' : 'Logo fica pronto para retirar.') + senha };
  if (status === 'pronto') return { titulo: loja, texto: entrega ? 'Seu pedido saiu para entrega! Já está a caminho.' + senha : 'Seu pedido está pronto! Pode vir buscar.' + senha };
  if (status === 'cancelado') return { titulo: loja, texto: 'Seu pedido foi cancelado pela loja. Toque para ver.' + senha };
  return null;
}

/* Pix que caiu pelo Mercado Pago: avisa o painel e a cozinha e, se o cliente quis, o celular dele. Uma vez por pedido. */
async function avisarPixPago(env, slug, p) {
  if (!env || !env.CARDAPIO) return;
  const marca = 'pix/' + slug + '/' + p.id;
  if (MEM.avisados[marca]) return;
  lembrar(MEM.avisados, marca);
  const tarefas = [];
  const lista = ((await aparelhosDaLoja(env, slug).catch(() => null)) || []).filter((a) => temPapel(a, 'painel') || temPapel(a, 'cozinha'));
  if (lista.length) tarefas.push(avisarAparelhos(env, slug, lista, (a) => avisoDaLoja(p, slug, temPapel(a, 'painel') ? 'painel' : 'cozinha', true)));
  const insc = limparInscricao(p.aviso);
  if (insc) {
    const texto = avisoDoCliente('pago', { senha: p.senha, tipoEntrega: p.tipoEntrega }, await nomeDaLoja(env, slug));
    tarefas.push(mandarAviso(env, insc, Object.assign(texto, { url: urlDoCliente(p.aviso, p.id), tag: 'p' + p.id, topico: 'p' + p.id })));
  }
  await Promise.all(tarefas);
}

/* ================= Pix ================= */

/* Consulta o pagamento no Mercado Pago com o token da loja e, se aprovado, libera o pedido. Devolve o status novo. */
async function conferirPagamento(fb, slug, idPagamento, pedidoId, env) {
  const token = await tokenDaLoja(fb, slug, env);
  if (!token) return null;
  const ehOrder = String(idPagamento).indexOf('ORD') === 0;
  let pg;
  try {
    pg = await mp(token, (ehOrder ? '/v1/orders/' : '/v1/payments/') + encodeURIComponent(idPagamento), {});
  } catch (e) {
    if (e && e.status === 401) delete MEM.mp[slug]; /* token trocado ou desconectado: le de novo na proxima */
    throw e;
  }
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
    let entrou = true;
    if (p.status === 'aguardando_pagamento') {
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && (p.canceladoPor === 'cliente' || p.canceladoPor === 'pix-vencido') && !p.pagoEm) {
      /* pagou e o pedido ja tinha sido cancelado (desistiu depois de copiar o codigo, ou o Pix "venceu" pelo relogio do aparelho):
         o dinheiro entrou, entao o pedido volta pra fila, marcado pra loja ver */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', pagoEm: agora3, confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
    } else if (p.status === 'cancelado' && p.canceladoPor === 'pix-vencido' && p.pagoEm && !p.pagoAposCancelar) {
      /* o painel cancelou por vencimento em cima do "pago" que o mensageiro tinha acabado de gravar:
         o dinheiro entrou, entao volta pra fila do mesmo jeito (mantem o pagoEm de quando caiu) */
      await fb.merge('lojas/' + slug + '/pedidos/' + id, { status: 'pago', pagamentoStatus: 'pago', confirmadoPor: 'mercadopago', pagoAposCancelar: true, atualizadoEm: agora3 });
    } else entrou = false;
    /* o pedido acabou de entrar na fila: avisa a loja e o cliente (aviso que falha nunca derruba o pagamento) */
    if (entrou) await avisarPixPago(env, slug, Object.assign({}, p, { id: id })).catch(() => {});
    return 'pago';
  }
  if (pg.status === 'cancelled' || pg.status === 'expired') return 'aguardando_pagamento';
  return 'aguardando_pagamento';
}

/* Token da loja (guardado 10 min na memoria do worker: o "caiu?" de cada cliente nao le o banco).
   Se veio pelo "Conectar" e esta perto de vencer, renova sozinho com o refresh_token. */
async function tokenDaLoja(fb, slug, env) {
  const m = MEM.mp[slug];
  if (m && Date.now() - m.em < 10 * 60 * 1000) return m.token;
  const seg = await fb.get('lojas/' + slug + '/privado/mercadopago');
  let token = seg && seg.token ? String(seg.token).trim() : '';
  const vence = seg && seg.tokenExpiraEm ? new Date(seg.tokenExpiraEm).getTime() : 0;
  if (token && seg.refresh && env && env.MP_CLIENT_ID && env.MP_CLIENT_SECRET && vence && vence - Date.now() < 7 * 864e5) {
    try {
      const r = await fetch(MP + '/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: seg.refresh }),
      });
      const t = await r.json().catch(() => ({}));
      if (r.ok && t.access_token) {
        await fb.merge('lojas/' + slug + '/privado/mercadopago', { token: t.access_token, refresh: t.refresh_token || seg.refresh, tokenExpiraEm: new Date(Date.now() + (Number(t.expires_in) || 15552000) * 1000).toISOString(), atualizadoEm: new Date().toISOString() });
        token = t.access_token;
      }
    } catch (_) { /* segue com o token atual */ }
  }
  MEM.mp[slug] = { token: token, em: Date.now() };
  return token;
}

async function mp(token, caminho, opcoes) {
  const r = await fetch(MP + caminho, Object.assign({}, opcoes, { headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, (opcoes && opcoes.headers) || {}) }));
  const texto = await r.text();
  let dados = {};
  try { dados = JSON.parse(texto); } catch (_) { dados = { message: texto }; }
  if (!r.ok) { const e = new Error('Mercado Pago ' + r.status + ': ' + (dados.message || texto.slice(0, 120))); e.status = r.status; throw e; }
  return dados;
}

/* Pix vencido pelo relogio do SERVIDOR (o do aparelho pode estar errado): prazo do codigo no passado ou,
   sem codigo, pedido que nasceu no banco ha mais de 35 min (hora do proprio Firestore, nao o criadoEm do celular) */
function pixVencidoNoServidor(p, agora) {
  if (!p || p.status !== 'aguardando_pagamento' || p.formaPagamento !== 'pix') return false;
  if (p.pixExpiraEm) { const fim = Date.parse(p.pixExpiraEm); return !isNaN(fim) && agora > fim; }
  const nasceu = Date.parse(p._criadoNoBanco || '');
  return !isNaN(nasceu) && agora > nasceu + 35 * 60 * 1000;
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
  /* so e-mail conferido: quem criou conta de e-mail e senha com o e-mail do dono, sem confirmar, nao passa */
  return u && u.email && u.emailVerified === true ? String(u.email) : '';
}
async function definirUsuarioEquipe(fb, email, senha, slug) {
  const base = 'https://identitytoolkit.googleapis.com/v1/projects/' + fb.projeto;
  /* marca da equipe no login: as regras do banco reconhecem a equipe por ela (quem se cadastra sozinho nao consegue) */
  const marca = JSON.stringify({ equipe: slug });
  const r = await fetch(base + '/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email: [email] }) });
  const j = r.ok ? await r.json().catch(() => ({})) : {};
  const u = (j.users || [])[0];
  if (u && u.localId) {
    const r2 = await fetch(base + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: u.localId, password: senha, emailVerified: true, customAttributes: marca }) }); /* conferido: as regras do banco exigem */
    if (!r2.ok) throw new Error('não deu pra trocar a senha (' + r2.status + ')');
    return;
  }
  const r3 = await fetch(base + '/accounts', { method: 'POST', headers: fb.cab, body: JSON.stringify({ email, password: senha, emailVerified: true, displayName: 'Equipe' }) });
  if (!r3.ok) throw new Error('não deu pra criar o usuário de equipe (' + r3.status + ' ' + (await r3.text()).slice(0, 120) + ')');
  /* a criacao nao aceita a marca: grava logo depois. Se falhar, o dono salva a senha de novo e cai no caminho de cima */
  const criado = await r3.json().catch(() => ({}));
  const r4 = criado.localId ? await fetch(base + '/accounts:update', { method: 'POST', headers: fb.cab, body: JSON.stringify({ localId: criado.localId, customAttributes: marca }) }) : null;
  if (!r4 || !r4.ok) throw new Error('não deu pra liberar o usuário de equipe, salve a senha de novo (' + (r4 ? r4.status : 'sem id') + ')');
}

/* ---------------- Firestore pela REST, autenticado com a conta de servico (JWT RS256) ---------------- */
/* A chave do Google vale 1 hora: guardada 50 min na memoria (antes era assinada de novo a cada chamada). */
async function firebase(env) {
  if (!env.FIREBASE_SA) throw new Error('falta o segredo FIREBASE_SA no worker');
  const sa = JSON.parse(env.FIREBASE_SA);
  let g = MEM.google;
  if (!g || g.email !== sa.client_email || Date.now() > g.vence) {
    g = MEM.google = { email: sa.client_email, token: await tokenDaContaDeServico(sa), vence: Date.now() + 50 * 60 * 1000 };
  }
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents/';
  const cab = { Authorization: 'Bearer ' + g.token, 'Content-Type': 'application/json' };
  /* chave recusada: assina outra na proxima. 429: o banco gratis chegou no limite de hoje */
  const recusou = (r) => { if (r.status === 401) MEM.google = null; if (r.status === 429) marcarPausa(env); };
  return {
    cab: cab, projeto: sa.project_id,
    async get(caminho, comHora) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) { recusou(r); throw new Error('Firestore get ' + r.status); }
      const doc = await r.json();
      const dados = deFirestore(doc.fields || {});
      /* comHora: junta a hora em que o documento nasceu no banco (relogio do Google, nao o do aparelho) */
      if (comHora) dados._criadoNoBanco = doc.createTime || '';
      return dados;
    },
    /* o documento como o banco manda (texto), sem abrir: fotos grandes passam direto */
    async getTexto(caminho) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return '';
      if (!r.ok) { recusou(r); throw new Error('Firestore get ' + r.status); }
      return r.text();
    },
    async listarTexto(colecao, tamanho, pagina) {
      const r = await fetch(base + colecao + '?pageSize=' + (tamanho || 50) + (pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''), { headers: cab });
      if (r.status === 404) return '';
      if (!r.ok) { recusou(r); throw new Error('Firestore list ' + r.status); }
      return r.text();
    },
    async listar(colecao) {
      const lista = [];
      let pagina = '';
      for (let i = 0; i < 20; i++) {
        const r = await fetch(base + colecao + '?pageSize=100' + (pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''), { headers: cab });
        if (!r.ok) { recusou(r); throw new Error('Firestore list ' + r.status); }
        const j = await r.json();
        (j.documents || []).forEach((d) => { const x = deFirestore(d.fields || {}); x._id = String(d.name || '').split('/').pop(); lista.push(x); });
        if (!j.nextPageToken) break;
        pagina = j.nextPageToken;
      }
      return lista;
    },
    async merge(caminho, dados) {
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (!r.ok) { recusou(r); throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
    },
    /* grava so se o documento ja existe (nunca cria pedido fantasma); devolve false se nao existe */
    async mergeSeExiste(caminho, dados) {
      const mask = Object.keys(dados).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask + '&currentDocument.exists=true', { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (r.status === 404) return false;
      if (!r.ok) { recusou(r); throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
      return true;
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
  if ('timestampValue' in v) return v.timestampValue;
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

