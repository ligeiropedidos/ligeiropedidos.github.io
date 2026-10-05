/*
 * Ligeiro - worker do site (na Cloudflare: "ligeiro-site"). Fica na frente do GitHub Pages, no dominio
 * ligeiropedidos.com.br, e faz tres coisas:
 *
 *   1. Endereco limpo: /juquia/dom-conizza, /painel/dom-conizza (sem o #) respondem com o index.html do site, marcado
 *      com <meta name="ligeiro-links" content="limpos">. O site so troca o # pelo caminho quando ve essa marca (sem o
 *      worker, tudo segue com o # de sempre, e link antigo com # continua abrindo nos dois casos).
 *   2. Previa de cada loja: quando quem pede o link e um robo de previa (WhatsApp, Instagram/Facebook, Telegram, Google),
 *      o index vai com o nome, a descricao e a logo da loja. Gente de verdade recebe o index de sempre (o site desenha a
 *      loja sozinho): so o robo custa uma consulta a mais.
 *   3. /_logo/<loja>: a logo da loja em JPG, para a previa (a logo mora dentro da loja, em base64).
 *
 * O resto (css, js, imagens, fontes, o proprio index.html) passa direto para o GitHub.
 *
 * Na Cloudflare (Workers Routes do dominio):
 *   ligeiropedidos.com.br/*          -> ligeiro-site
 *   ligeiropedidos.com.br/js/*       -> None     (e o mesmo para css, img, fontes, midia, vendor e dados)
 * As rotas "None" deixam os arquivos fora do worker: nao gastam as 100 mil chamadas gratis do dia.
 * Sem segredo e sem KV: a loja vem do mensageiro (ligeiro-mp), que ja guarda a copia dela na borda.
 */

const SITE = 'https://ligeiropedidos.com.br';
const MP = 'https://ligeiro-mp.ligeiro-pedidos.workers.dev';
/* primeiro pedaco do endereco que e tela do site (nao cidade) */
const TELAS = ['painel', 'cozinha', 'entrega', 'balcao', 'admin', 'conta', 'comecar', 'assinar', 'lojas', 'entrar', 'termos', 'privacidade', 'cidades', 'servicos'];
/* robos que montam previa de link ou indexam a pagina (eles nao rodam o site: leem so o html) */
const ROBO = /facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|Google-InspectionTool|bingbot|Pinterest|Applebot|SkypeUriPreview|redditbot|Embedly|vkShare|Iframely|DuckDuckBot|YandexBot/i;
const PEDACO = /^[a-z0-9-]{1,60}$/;

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* o endereco e de uma loja? /cidade/loja ou /cidade/loja/pedido/<id> (a previa e a da loja) */
function lojaDoCaminho(caminho) {
  const p = caminho.split('/').filter(Boolean);
  if (p.length < 2 || TELAS.indexOf(p[0]) >= 0 || !PEDACO.test(p[0]) || !PEDACO.test(p[1])) return null;
  if (p.length > 2 && !(p[2] === 'pedido' && p.length === 4)) return null;
  return { cidade: p[0], slug: p[1] };
}

/* so o nome da loja (/dom-conizza, o jeito que a gente digita): pode ser loja ou cidade; quem decide e a loja existir */
function curtoDoCaminho(caminho) {
  const p = caminho.split('/').filter(Boolean);
  return p.length === 1 && TELAS.indexOf(p[0]) < 0 && PEDACO.test(p[0]) ? p[0] : null;
}

/* a loja publica, pelo mensageiro (que responde da copia da borda, sem ler o banco) */
async function lerLoja(slug) {
  try {
    const r = await fetch(MP + '/loja/' + slug, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return null;
    const j = await r.json();
    const l = j && j.loja;
    return l && l.nome && l.ativa !== false ? l : null;
  } catch (_) {
    return null;
  }
}

function trocarMeta(html, atributo, nome, valor) {
  const re = new RegExp('<meta ' + atributo + '="' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" content="[^"]*">');
  /* troca por funcao: nome de loja com "$'" ou "$&" (o dono digita o que quiser) nao vira pedaco do HTML */
  const novo = '<meta ' + atributo + '="' + nome + '" content="' + esc(valor) + '">';
  return re.test(html) ? html.replace(re, () => novo) : html;
}

/* o index com a cara da loja: titulo, descricao, imagem e endereco da previa */
function comPreviaDaLoja(html, loja, onde) {
  const lugar = [loja.cidade, loja.uf].filter(Boolean).join('/');
  const titulo = loja.nome + (lugar ? ' · ' + lugar : '');
  const descricao = String(loja.descricao || '').trim()
    || (loja.tipo ? loja.tipo + (lugar ? ' em ' + lugar : '') + '. ' : '') + 'Veja o cardápio e peça pelo celular: Pix, cartão ou na entrega.';
  const url = SITE + '/' + onde.cidade + '/' + onde.slug;
  const temLogo = /^data:image\/jpeg;base64,/.test(String(loja.logoDados || ''));
  const imagem = temLogo ? SITE + '/_logo/' + onde.slug + '?v=' + encodeURIComponent(loja.atualizadoEm || '') : SITE + '/img/previa-link.jpg';
  const tagTitulo = '<title>' + esc(loja.nome) + ' · Ligeiro</title>';
  html = html.replace(/<title>[^<]*<\/title>/, () => tagTitulo);
  html = trocarMeta(html, 'name', 'description', descricao);
  const canonico = '<link rel="canonical" href="' + esc(url) + '">';
  html = html.replace(/<link rel="canonical" href="[^"]*">/, () => canonico);
  html = trocarMeta(html, 'property', 'og:url', url);
  html = trocarMeta(html, 'property', 'og:title', titulo);
  html = trocarMeta(html, 'property', 'og:description', descricao);
  html = trocarMeta(html, 'property', 'og:image', imagem);
  html = trocarMeta(html, 'property', 'og:image:alt', temLogo ? 'Logo da ' + loja.nome : 'O mascote do Ligeiro');
  if (temLogo) {
    /* a logo e quadrada: sem o tamanho do banner (1200x630) e com o cartao pequeno do lado do texto */
    html = html.replace(/\s*<meta property="og:image:width" content="[^"]*">/, '').replace(/\s*<meta property="og:image:height" content="[^"]*">/, '');
    html = trocarMeta(html, 'name', 'twitter:card', 'summary');
  }
  return html;
}

/* Cabecalhos de seguranca das paginas do site (HTML): outro site nao pode embutir o Ligeiro numa moldura (clique roubado), so HTTPS
   por 1 ano, o endereco completo nao vai para outros sites, e nada de camera, microfone ou localizacao (o Ligeiro nunca usa).
   Nunca nas respostas de /__/auth/: o Firebase embute essa tela de login. A politica completa de scripts (CSP) fica para depois,
   com teste em modo so-relatorio nos fluxos de login e de cartao. */
const SEGURANCA = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), bluetooth=(), serial=()',
};
function comSeguranca(resposta) {
  const r = new Response(resposta.body, resposta);
  Object.keys(SEGURANCA).forEach((k) => r.headers.set(k, SEGURANCA[k]));
  return r;
}
/* o repositorio do site e publico no GitHub, mas o endereco do Ligeiro nao entrega codigo do servidor, testes nem anotacoes internas */
const INTERNO = /^\/(ferramentas|testes)(\/|$)|\.md$/i;
/* o caminho como o GitHub entende: %66 vira f e // vira / (senao /%66erramentas/ ou //testes/ passavam pela trava) */
function caminhoReal(p) { let c = String(p || ''); try { c = decodeURIComponent(c); } catch (_) { /* fica como veio */ } return c.replace(/\/{2,}/g, '/'); }

async function pagina(request, url) {
  const origem = await fetch(SITE + '/index.html', { headers: { 'User-Agent': request.headers.get('User-Agent') || '' } });
  if (!origem.ok) return origem;
  let html = await origem.text();
  /* a marca do endereco limpo, logo depois do <base> (antes de qualquer script do site ler) */
  html = html.replace('<base href="/">', '<base href="/">\n  <meta name="ligeiro-links" content="limpos">');
  const onde = lojaDoCaminho(url.pathname);
  const curto = onde ? null : curtoDoCaminho(url.pathname);
  if ((onde || curto) && ROBO.test(request.headers.get('User-Agent') || '')) {
    const loja = await lerLoja(onde ? onde.slug : curto);
    /* link curto: a previa da loja com o endereco completo (o site leva a pessoa para /cidade/loja) */
    if (loja && onde) html = comPreviaDaLoja(html, loja, onde);
    else if (loja && PEDACO.test(String(loja.cidadeSlug || ''))) html = comPreviaDaLoja(html, loja, { cidade: loja.cidadeSlug, slug: curto });
  }
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Vary': 'User-Agent' }, SEGURANCA),
  });
}

/* a logo da loja em JPG (a previa precisa de um endereco de imagem de verdade) */
async function logo(slug) {
  const loja = PEDACO.test(slug) ? await lerLoja(slug) : null;
  const m = loja && /^data:image\/jpeg;base64,(.+)$/.exec(String(loja.logoDados || ''));
  if (!m) return Response.redirect(SITE + '/img/previa-link.jpg', 302);
  let bytes;
  try {
    const bin = atob(m[1]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (_) {
    return Response.redirect(SITE + '/img/previa-link.jpg', 302);
  }
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

const FIREBASE_AUTH = 'https://ligeiro-18df1.firebaseapp.com';
const CAMINHO_FIREBASE = /^\/__\/(auth|firebase)\/[A-Za-z0-9._\/-]+$/;
async function loginFirebase(request, url) {
  /* so os caminhos do Firebase, sem ".." (o repasse aceitava qualquer coisa depois de /__/auth/) */
  if (!CAMINHO_FIREBASE.test(url.pathname) || url.pathname.indexOf('..') >= 0) return new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
  const cab = new Headers(request.headers);
  cab.delete('host');
  /* os cookies do nosso dominio nao vao para o Firebase */
  cab.delete('cookie');
  const corpo = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  return fetch(FIREBASE_AUTH + url.pathname + url.search, { method: request.method, headers: cab, body: corpo, redirect: 'manual' });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    /* login do Google no nosso dominio: o Firebase atende em /__/auth/ e /__/firebase/ (a tela de permissao do Google
       mostra ligeiropedidos.com.br em vez de ligeiro-18df1.firebaseapp.com); tudo repassado como veio */
    if (url.hostname === 'ligeiropedidos.com.br' && /^\/__\/(auth|firebase)\//.test(url.pathname)) return loginFirebase(request, url);
    /* www, outro metodo e arquivo (tem extensao: .js, .css, .webp, index.html...): direto para o GitHub */
    if (INTERNO.test(caminhoReal(url.pathname))) return new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
    if (url.hostname !== 'ligeiropedidos.com.br' || (request.method !== 'GET' && request.method !== 'HEAD')) return fetch(request);
    if (INTERNO.test(url.pathname)) return new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
    /* a pagina inicial e a de erro tambem levam os cabecalhos (vinham direto do GitHub, sem nada) */
    if (url.pathname === '/index.html' || url.pathname === '/404.html') return comSeguranca(await fetch(request));
    if (/\.[A-Za-z0-9]{1,12}$/.test(url.pathname) || url.pathname.indexOf('/.well-known/') === 0) return fetch(request);
    const l = /^\/_logo\/([^/]+)$/.exec(url.pathname);
    if (l) return logo(l[1]);
    try {
      return await pagina(request, url);
    } catch (_) {
      /* qualquer tropeco aqui: o site de sempre (com o #) em vez de erro */
      return Response.redirect(SITE + '/#' + url.pathname + url.search, 302);
    }
  },
};

export const _teste = { lojaDoCaminho, comPreviaDaLoja, ROBO, SEGURANCA, INTERNO, caminhoReal };
