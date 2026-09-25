/*
 * Teste do worker do site (ferramentas/worker-site.js) sem internet: o GitHub e o mensageiro sao de mentira.
 * Rode com: node testes/site.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INDEX = fs.readFileSync(path.resolve('index.html'), 'utf8');
const { default: worker, _teste } = await import(pathToFileURL(path.resolve('ferramentas/worker-site.js')).href);

let total = 0, falhas = 0;
function ok(cond, nome) { total += 1; if (cond) console.log('  ok  ' + nome); else { falhas += 1; console.log('  FALHOU  ' + nome); } }

const LOGO = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');
let lojas = {};
let chamadas = [];
globalThis.fetch = async (alvo, op) => {
  const u = typeof alvo === 'string' ? alvo : alvo.url;
  chamadas.push(u);
  if (u === 'https://ligeiropedidos.com.br/index.html') return new Response(INDEX, { headers: { 'Content-Type': 'text/html' } });
  const m = /^https:\/\/ligeiro-mp\.ligeiro-pedidos\.workers\.dev\/loja\/(.+)$/.exec(u);
  if (m) return lojas[m[1]] ? new Response(JSON.stringify({ borda: 1, loja: lojas[m[1]] })) : new Response('{"borda":1,"erro":"nao-existe"}', { status: 404 });
  return new Response('arquivo ' + u, { headers: { 'X-De': 'github' } });
};
const WHATS = 'WhatsApp/2.23.20.0 A';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const pedir = (caminho, ua, metodo) => { chamadas = []; return worker.fetch(new Request('https://ligeiropedidos.com.br' + caminho, { method: metodo || 'GET', headers: { 'User-Agent': ua || IPHONE } })); };
const meta = (html, a, n) => { const m = new RegExp('<meta ' + a + '="' + n + '" content="([^"]*)">').exec(html); return m && m[1]; };

lojas['dom-conizza'] = { nome: 'Dom Conizza', tipo: 'Pizzaria', cidade: 'Juquiá', uf: 'SP', cidadeSlug: 'juquia', slug: 'dom-conizza', descricao: '', logoDados: LOGO, atualizadoEm: '2026-09-25T04:09:57.774Z', ativa: true };
lojas['sem-logo'] = { nome: 'Lanche do Zé', tipo: 'Lanchonete', cidade: 'Juquiá', uf: 'SP', descricao: 'O melhor X-Bacon da praça', logoDados: '', ativa: true };
lojas['desligada'] = { nome: 'Fechou', ativa: false };
lojas['maldosa'] = { nome: '"><script>alert(1)</script>', tipo: 'Bar', cidade: 'X', uf: 'SP', logoDados: '', ativa: true };

console.log('== pessoa abrindo o link limpo ==');
{
  const r = await pedir('/juquia/dom-conizza');
  const h = await r.text();
  ok(r.status === 200 && /text\/html/.test(r.headers.get('Content-Type')), 'loja: 200 com o index');
  ok(h.includes('<meta name="ligeiro-links" content="limpos">'), 'loja: index marcado com o endereco limpo');
  ok(h.indexOf('ligeiro-links') < h.indexOf('<script'), 'marca vem antes de qualquer script do site');
  ok(!chamadas.some((c) => c.includes('ligeiro-mp')), 'pessoa: nao consulta a loja (so o robo custa)');
  ok(meta(h, 'property', 'og:title') === 'Ligeiro: faça seu pedido pelo celular', 'pessoa: previa de sempre (o site desenha a loja)');
}
for (const c of ['/', '/painel/dom-conizza', '/cozinha/dom-conizza', '/admin', '/juquia', '/comecar']) {
  const r = await pedir(c);
  ok(r.status === 200 && (await r.text()).includes('content="limpos"'), 'tela ' + c + ': 200 com o index marcado');
}

console.log('== robo de previa (WhatsApp) ==');
{
  const r = await pedir('/juquia/dom-conizza', WHATS);
  const h = await r.text();
  ok(meta(h, 'property', 'og:title') === 'Dom Conizza · Juquiá/SP', 'titulo da previa com a cidade');
  ok(/^Pizzaria em Juquiá\/SP\. Veja o cardápio/.test(meta(h, 'property', 'og:description')), 'descricao pelo tipo e cidade quando a loja nao escreveu uma');
  ok(meta(h, 'property', 'og:image') === 'https://ligeiropedidos.com.br/_logo/dom-conizza?v=2026-09-25T04%3A09%3A57.774Z', 'imagem: a logo da loja (versao muda quando a loja muda)');
  ok(meta(h, 'property', 'og:url') === 'https://ligeiropedidos.com.br/juquia/dom-conizza', 'og:url no endereco limpo');
  ok(h.includes('<link rel="canonical" href="https://ligeiropedidos.com.br/juquia/dom-conizza">'), 'canonical da loja');
  ok(/<title>Dom Conizza · Ligeiro<\/title>/.test(h), 'title da loja');
  ok(!/og:image:width/.test(h) && meta(h, 'name', 'twitter:card') === 'summary', 'logo quadrada: sem o tamanho do banner');
  ok(h.includes('content="limpos"'), 'robo tambem recebe a marca');
}
{
  const h = await (await pedir('/juquia/dom-conizza/pedido/abcDEF1234567890abcd', WHATS)).text();
  ok(meta(h, 'property', 'og:title') === 'Dom Conizza · Juquiá/SP', 'link do pedido: previa da loja');
}
{
  const h = await (await pedir('/juquia/sem-logo', 'facebookexternalhit/1.1')).text();
  ok(meta(h, 'property', 'og:description') === 'O melhor X-Bacon da praça', 'descricao escrita pela loja');
  ok(meta(h, 'property', 'og:image') === 'https://ligeiropedidos.com.br/img/previa-link.jpg' && /og:image:width/.test(h), 'sem logo: a imagem do Ligeiro com o tamanho dela');
}
{
  const h = await (await pedir('/juquia/nao-existe', WHATS)).text();
  ok(meta(h, 'property', 'og:title') === 'Ligeiro: faça seu pedido pelo celular' && h.includes('content="limpos"'), 'loja que nao existe: previa de sempre, sem erro');
}
{
  const h = await (await pedir('/juquia/desligada', WHATS)).text();
  ok(meta(h, 'property', 'og:title') === 'Ligeiro: faça seu pedido pelo celular', 'loja desligada: sem a previa dela');
}
{
  const h = await (await pedir('/juquia/maldosa', WHATS)).text();
  ok(!h.includes('<script>alert(1)</script>') && h.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'), 'nome da loja nunca vira codigo na pagina');
}
{
  await pedir('/painel/dom-conizza', WHATS);
  ok(!chamadas.some((c) => c.includes('ligeiro-mp')), 'tela do painel: robo nao consulta loja');
}

console.log('== arquivos e o resto passam direto ==');
{
  const h = await (await pedir('/index.html')).text();
  ok(h === INDEX, '/index.html: o arquivo do GitHub sem mexer (a checagem de versao do site le ele)');
}
for (const c of ['/css/ligeiro.css?v=1', '/js/app.js', '/img/previa-link.jpg', '/sw.js', '/manifest.webmanifest', '/.well-known/x']) {
  const r = await pedir(c);
  ok(r.headers.get('X-De') === 'github', 'arquivo ' + c + ': direto do GitHub');
}
{
  chamadas = [];
  const r = await worker.fetch(new Request('https://ligeiropedidos.com.br/juquia/dom-conizza', { method: 'POST', body: 'x' }));
  ok(r.headers.get('X-De') === 'github', 'POST passa direto');
  const w = await worker.fetch(new Request('https://www.ligeiropedidos.com.br/juquia/dom-conizza'));
  ok(w.headers.get('X-De') === 'github', 'www passa direto (o GitHub leva para o endereco sem www)');
  const hd = await pedir('/juquia/dom-conizza', IPHONE, 'HEAD');
  ok(hd.status === 200 && (await hd.text()) === '', 'HEAD: 200 sem corpo');
}

console.log('== logo da loja ==');
{
  const r = await pedir('/_logo/dom-conizza', WHATS);
  const b = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get('Content-Type') === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b.length === 9, 'JPG da logo, os bytes certos');
  const s = await pedir('/_logo/sem-logo', WHATS);
  ok(s.status === 302 && /previa-link\.jpg$/.test(s.headers.get('Location')), 'sem logo: a imagem do Ligeiro');
  const x = await pedir('/_logo/..%2F..%2Fadmin', WHATS);
  ok(x.status === 302 && !chamadas.some((c) => c.includes('ligeiro-mp')), 'nome torto: nem consulta');
}

console.log('== o que e loja no endereco ==');
const L = _teste.lojaDoCaminho;
ok(L('/juquia/dom-conizza') && L('/juquia/dom-conizza').slug === 'dom-conizza', '/cidade/loja');
ok(!L('/painel/dom-conizza') && !L('/entrega/x') && !L('/assinar/uma'), 'telas do site nao sao loja');
ok(!L('/juquia') && !L('/'), 'so a cidade nao e loja');
ok(!L('/juquia/dom-conizza/qualquer') && L('/juquia/dom-conizza/pedido/abc'), 'so o pedido depois da loja');
ok(!L('/Juquia/Dom') && !L('/juquia/dom%20conizza'), 'pedaco fora do formato: nao e loja');
ok(_teste.ROBO.test(WHATS) && _teste.ROBO.test('facebookexternalhit/1.1') && _teste.ROBO.test('Mozilla/5.0 (compatible; Googlebot/2.1)') && !_teste.ROBO.test(IPHONE), 'reconhece os robos e nao confunde com gente');

console.log('== o index do site tem o que o worker procura ==');
ok(INDEX.includes('<base href="/">'), 'index tem o <base href="/">');
for (const [a, n] of [['name', 'description'], ['property', 'og:url'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:image'], ['property', 'og:image:alt'], ['name', 'twitter:card']]) {
  ok(meta(INDEX, a, n) != null, 'index tem ' + n);
}
ok(/<link rel="canonical" href="[^"]*">/.test(INDEX) && /<title>[^<]*<\/title>/.test(INDEX), 'index tem canonical e title');

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
