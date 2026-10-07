/*
 * Teste da camada de dados do site (js/dados.js) e do Mercado Pago do painel (js/mp.js), sem navegador e sem internet:
 * a tela, o relogio e o mensageiro sao de mentira.
 * Confere que a loja do cliente muda na hora quando o dono fecha a loja (publicarLoja), que nada fica preso num relogio
 * quando a tela some, que o aviso recusado tenta de novo, que as mensagens de erro certas chegam ao dono, que o
 * "Falta devolver" da demonstracao nao mostra o que ja foi devolvido e que a conexao do Mercado Pago nunca e apagada
 * por uma leitura que falhou.
 * Rodar com:  node testes/dados.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = require(path.join(aqui, '..', 'js', 'regras.js'));
const codigoDados = fs.readFileSync(path.join(aqui, '..', 'js', 'dados.js'), 'utf8');
const codigoMp = fs.readFileSync(path.join(aqui, '..', 'js', 'mp.js'), 'utf8');

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (cond) console.log('  ok  ' + nome); else { falhas++; console.log('  FALHOU  ' + nome); } }
const esperar = () => new Promise((r) => setImmediate(r));
async function assentar() { for (let i = 0; i < 12; i++) await esperar(); }

/* ---- relogio de mentira: so anda quando o teste manda ---- */
function relogio() {
  let agora = 0, id = 0;
  const fila = [];
  return {
    setTimeout(f, ms) { id += 1; fila.push({ id, quando: agora + (ms || 0), f }); return id; },
    clearTimeout(i) { const k = fila.findIndex((t) => t.id === i); if (k >= 0) fila.splice(k, 1); },
    setInterval() { return 0; }, clearInterval() {},
    pendentes() { return fila.map((t) => t.quando - agora); },
    async andar(ms) {
      const fim = agora + ms;
      for (;;) {
        fila.sort((a, b) => a.quando - b.quando);
        const t = fila[0];
        if (!t || t.quando > fim) break;
        fila.shift();
        agora = t.quando;
        t.f();
        await assentar();
      }
      agora = fim;
      await assentar();
    },
  };
}

/* ---- navegador de mentira ---- */
function memoria() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, key: () => null, get length() { return 0; } }; }
function navegador(config, rel) {
  const ouvintesDoc = {}, ouvintesJanela = {};
  const documento = {
    hidden: false, visibilityState: 'visible',
    addEventListener(n, f) { (ouvintesDoc[n] = ouvintesDoc[n] || []).push(f); }, removeEventListener() {},
    createElement() { return { setAttribute() {} }; }, head: { appendChild() {} },
  };
  const chamadas = [];
  const respostas = [];
  const janela = {
    document: documento, LIGEIRO_CONFIG: config, LigeiroRegras: R, location: { hash: '#/painel/loja' }, navigator: { userAgent: 'teste' },
    sessionStorage: memoria(), localStorage: memoria(),
    addEventListener(n, f) { (ouvintesJanela[n] = ouvintesJanela[n] || []).push(f); }, removeEventListener() {},
    fetch(endereco, opcoes) {
      chamadas.push({ endereco, opcoes: opcoes || {} });
      const r = respostas.length ? respostas.shift() : { status: 200 };
      if (r.falhar) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.corpo || { ok: r.status === 200 }) });
    },
    setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, setInterval: rel.setInterval, clearInterval: rel.clearInterval,
    Uint8Array, crypto: { getRandomValues: (b) => b },
  };
  janela.window = janela;
  const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, TypeError, RegExp, Symbol }));
  vm.runInContext(codigoDados, contexto);
  return {
    janela, chamadas, respostas,
    esconder() { documento.hidden = true; documento.visibilityState = 'hidden'; (ouvintesDoc.visibilitychange || []).forEach((f) => f()); },
    sair() { (ouvintesJanela.pagehide || []).forEach((f) => f()); },
    disparar(nome, ev) { (ouvintesJanela[nome] || []).forEach((f) => f(ev)); },
  };
}

const NUVEM = { firebase: { projectId: 'teste' }, proxyMercadoPago: 'https://borda.teste/' };
function lojaNaNuvem() {
  const rel = relogio();
  const n = navegador(NUVEM, rel);
  const store = n.janela.LigeiroDados.store;
  store.obterIdToken = () => Promise.resolve('tok-dono');
  const publicacoes = () => n.chamadas.filter((c) => c.endereco === 'https://borda.teste/publicar');
  return { rel, n, store, publicacoes };
}

console.log('publicarLoja: a loja do cliente muda na hora');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  ok(store.tipo === 'firebase', 'com o Firebase configurado, o store e o da nuvem');
  store.publicarLoja('loja', { agora: true });
  await assentar();
  ok(publicacoes().length === 1, 'fechar a loja (agora) chama /publicar sem esperar relogio nenhum');
  const c = publicacoes()[0];
  ok(c && c.opcoes.method === 'POST' && JSON.parse(c.opcoes.body).loja === 'loja', 'manda a loja certa, por POST');
  ok(c && c.opcoes.headers.Authorization === 'Bearer tok-dono', 'com o login do dono');
  ok(c && c.opcoes.keepalive === true, 'com keepalive (sai mesmo se a pagina for embora)');
  ok(rel.pendentes().length === 0, 'deu certo: nada fica esperando');
}

console.log('publicarLoja: o site aberto neste aparelho pede a copia nova (o dono abriu a loja e o site seguia "Fechada")');
{
  const { n, store } = lojaNaNuvem();
  n.respostas.push({ status: 200, corpo: { ok: true, versao: 1760000000123 } });
  store.publicarLoja('loja', { agora: true });
  await assentar();
  const marca = JSON.parse(n.janela.localStorage.getItem('ligeiro:publicou:loja') || 'null');
  ok(marca && marca.v === 1760000000123, 'publicou: guarda neste aparelho a versao da copia nova');
  n.respostas.push({ status: 200, corpo: { borda: 1, loja: { nome: 'Loja', aberta: false } } });
  const pub = store.lojaPublica('loja');
  const l = await pub.primeira;
  const lojaPedidas = () => n.chamadas.filter((c) => c.endereco.indexOf('https://borda.teste/loja/loja') === 0);
  const pedido = lojaPedidas().pop();
  ok(l && l.nome === 'Loja' && pedido && /\?v=1760000000123$/.test(pedido.endereco) && pedido.opcoes.cache === 'no-store', 'o site pede a versao nova, sem o cache do navegador');
  let viu = null;
  pub.assistir((x) => { viu = x; });
  n.respostas.push({ status: 200, corpo: { borda: 1, loja: { nome: 'Loja', aberta: true } } });
  n.disparar('storage', { key: 'ligeiro:publicou:loja' });
  await assentar();
  ok(lojaPedidas().length === 2 && viu && viu.aberta === true, 'o painel publicou em outra aba: o site confere na hora (sem esperar o minuto)');
  n.disparar('storage', { key: 'ligeiro:publicou:outra-loja' });
  await assentar();
  ok(lojaPedidas().length === 2, 'publicacao de outra loja nao faz esta conferir');
  pub.parar();
}

console.log('publicarLoja: preco e texto esperam a folga de 1,5 s e saem uma vez so');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja'); store.publicarLoja('loja'); store.publicarLoja('loja');
  await assentar();
  ok(publicacoes().length === 0, 'tres gravacoes seguidas: ainda nao publicou');
  await rel.andar(1499);
  ok(publicacoes().length === 0, 'antes de 1,5 s, nada');
  await rel.andar(2);
  ok(publicacoes().length === 1, 'depois da folga, um aviso so pelas tres');
}

console.log('publicarLoja: urgente passa na frente da folga');
{
  const { rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja');
  await assentar();
  store.publicarLoja('loja', { agora: true });
  await assentar();
  ok(publicacoes().length === 1, 'a urgente sai na hora');
  await rel.andar(5000);
  ok(publicacoes().length === 1, 'e leva junto a que esperava (sem aviso repetido)');
}

console.log('publicarLoja: a tela sumiu (celular bloqueado) com aviso esperando');
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  store.publicarLoja('loja');
  await assentar();
  ok(publicacoes().length === 0, 'esperando a folga');
  n.esconder();
  await assentar();
  ok(publicacoes().length === 1, 'a tela apagou: o aviso sai na hora (o relogio pararia com a tela apagada)');
  ok(publicacoes()[0] && publicacoes()[0].opcoes.keepalive === true, 'com keepalive');
  await rel.andar(5000);
  ok(publicacoes().length === 1, 'e o relogio velho nao manda de novo');
  store.publicarLoja('loja');
  await assentar();
  n.sair();
  await assentar();
  ok(publicacoes().length === 2, 'fechar a aba (pagehide) tambem manda o que esperava');
  n.esconder();
  await assentar();
  ok(publicacoes().length === 2, 'sem nada esperando, esconder a tela nao chama ninguem');
}

console.log('publicarLoja: mensageiro recusou por pressa (429, o antigo conta 6 por minuto) ou caiu (5xx)');
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 429 }, { status: 429 }, { status: 200 });
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await assentar();
  ok(publicacoes().length === 1 && resultado === false, '429: responde que nao deu');
  await rel.andar(19999);
  ok(publicacoes().length === 1, 'nao insiste antes de 20 s');
  await rel.andar(1);
  ok(publicacoes().length === 2, 'tenta de novo aos 20 s');
  await rel.andar(61000);
  ok(publicacoes().length === 3, 'e mais uma vez 61 s depois (a janela do mensageiro antigo ja passou)');
  await rel.andar(600000);
  ok(publicacoes().length === 3, 'deu certo: para de tentar');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ falhar: true }, { status: 503 }, { status: 500 }, { status: 500 });
  store.publicarLoja('loja', { agora: true });
  await assentar();
  const logo = publicacoes().length;
  ok(logo === 2 && publicacoes()[1].opcoes.keepalive === undefined, 'o keepalive foi recusado: vai de novo sem ele, na hora (e o mensageiro respondeu 503)');
  await rel.andar(3000);
  ok(publicacoes().length === 3, 'falha: tenta de novo em 3 s');
  await rel.andar(15000);
  ok(publicacoes().length === 4, 'e em mais 15 s');
  await rel.andar(600000);
  ok(publicacoes().length === 4, 'depois de duas tentativas, para (a copia vence sozinha)');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 202, corpo: { ok: true, depois: true } });
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await rel.andar(600000);
  ok(resultado === true && publicacoes().length === 1, '202 (mensageiro novo no limite: ele mesmo refaz a copia em 10 s): vale como feito, sem repetir');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 403 });
  store.publicarLoja('loja', { agora: true });
  await rel.andar(600000);
  ok(publicacoes().length === 1, '403 (loja de outro): nao insiste');
}
{
  const { n, rel, store, publicacoes } = lojaNaNuvem();
  n.respostas.push({ status: 429 });
  store.publicarLoja('loja', { agora: true });
  await assentar();
  store.publicarLoja('loja');
  await rel.andar(1500);
  ok(publicacoes().length === 2, 'mudanca nova durante a espera da nova tentativa: sai na folga normal');
  await rel.andar(600000);
  ok(publicacoes().length === 2, 'e a tentativa velha nao vai de novo');
}
{
  const rel = relogio();
  const n = navegador(NUVEM, rel);
  const store = n.janela.LigeiroDados.store;
  store.obterIdToken = () => Promise.reject(new Error('Entre na sua conta primeiro.'));
  let resultado = null;
  store.publicarLoja('loja', { agora: true }).then((x) => { resultado = x; });
  await rel.andar(600000);
  ok(resultado === false && n.chamadas.length === 0, 'sem login: nao chama o mensageiro e responde que nao deu');
}

console.log('erroAmigavel: a mensagem certa chega ao dono');
{
  const rel = relogio();
  const D = navegador(NUVEM, rel).janela.LigeiroDados;
  const padrao = 'Não deu para salvar agora.';
  ok(D.erroAmigavel(new Error('Senha fácil demais: evite números repetidos ou em sequência.'), padrao).indexOf('Senha fácil demais') === 0, 'portugues com "demais" (tem "is" dentro) passa');
  ok(D.erroAmigavel(new Error('Cannot read properties of undefined (reading \'x\')'), padrao) === padrao, 'mensagem tecnica em ingles vira a padrao');
  ok(D.erroAmigavel(new Error('Unexpected token < in JSON at position 0'), padrao) === padrao, 'erro de JSON vira a padrao');
  ok(D.erroAmigavel(new Error('This is not valid'), padrao) === padrao, '"is" e "not" como palavras inteiras sao ingles');
  const email = new Error('Falta confirmar o seu e-mail. Mandamos um link para is.of@get.com.');
  email.publico = true;
  ok(D.erroAmigavel(email, padrao) === email.message, 'mensagem nossa (publico) passa inteira, mesmo com e-mail que parece ingles');
  ok(D.erroAmigavel({ code: 'permission-denied', message: 'x' }, padrao) === 'Sua sessão caiu. Entre de novo.', 'permissao negada continua dizendo que a sessao caiu');
}

console.log('Falta devolver na demonstracao');
{
  const rel = relogio();
  const n = navegador({}, rel);
  const store = n.janela.LigeiroDados.store;
  ok(store.tipo === 'demo', 'sem o Firebase: demonstracao');
  const agora = new Date().toISOString();
  const base = { status: 'cancelado', formaPagamento: 'pix', total: 1000, criadoEm: agora, mp: { id: 'SIM-1' } };
  n.janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify({ lojas: {}, pedidos: { loja: {
    a: Object.assign({ id: 'a', pagamentoStatus: 'pago' }, base),
    b: Object.assign({ id: 'b', pagamentoStatus: 'pago', devolvidoEm: agora }, base),
    c: Object.assign({ id: 'c', pagamentoStatus: 'devolvido', devolvidoEm: agora }, base),
  } } }));
  const lista = await store.listarPedidos('loja', { devolver: true });
  ok(lista.length === 1 && lista[0].id === 'a', 'so o cancelado pago que ainda nao foi devolvido');
}

console.log('Estoque na demonstracao e pelo mensageiro');
{
  const rel = relogio();
  const n = navegador({}, rel);
  const store = n.janela.LigeiroDados.store;
  const loja = {
    slug: 'moda', nome: 'Moda', tipo: 'Roupas', aberta: true, aceitaRetirada: true, aceitaPix: true, mpAtivo: true,
    categorias: [{ id: 'cam', nome: 'Camisetas' }, { id: 'ace', nome: 'Acessórios' }],
    produtos: [{ id: 'camiseta', categoria: 'cam', nome: 'Camiseta', preco: 4000, controlaEstoque: true, ativo: true }, { id: 'bone', categoria: 'ace', nome: 'Boné', preco: 3000, ativo: true }],
    grupos: { tam: { titulo: 'Tamanho', tipo: 'unico', opcoes: [{ id: 'p', nome: 'P', preco: 0 }, { id: 'm', nome: 'M', preco: 0 }] } },
    gruposPorCategoria: { cam: ['tam'], ace: [] },
  };
  n.janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify({ lojas: { moda: loja }, pedidos: {}, contadores: {} }));
  let erro = null;
  await store.salvarEstoque('moda', { bone: 3 }).catch((e) => { erro = e; });
  ok(erro && /Controlar estoque/.test(erro.message), 'demonstracao: item sem controle de estoque nao ganha quantidade');
  const q = await store.salvarEstoque('moda', { 'camiseta|m': 1, 'camiseta|xx': 9 });
  ok(q['camiseta|m'] === 1 && !('camiseta|xx' in q), 'demonstracao: o dono acerta so o tamanho que existe');
  const pedido = R.montarPedido(loja, { nome: 'Bia', telefone: '13999990001', tipoEntrega: 'retirada', formaPagamento: 'pix', itens: [{ produtoId: 'camiseta', quantidade: 1, tamanho: 'm' }] });
  const feito = await store.criarPedido('moda', pedido);
  ok(feito.estoque && feito.estoque['camiseta|m'] === 1 && (await store.lerEstoque('moda'))['camiseta|m'] === 0, 'demonstracao: o pedido reserva a camiseta M');
  erro = null;
  await store.criarPedido('moda', pedido).catch((e) => { erro = e; });
  ok(erro && erro.status === 409 && /Camiseta \(M\) esgotou/.test(erro.message), 'demonstracao: acabou, o segundo pedido e recusado com o que falta (409)');
  await store.atualizarPedido('moda', feito.id, { status: 'cancelado', canceladoPor: 'cliente' });
  const volta = await store.devolverEstoque('moda', feito.id);
  const volta2 = await store.devolverEstoque('moda', feito.id);
  ok(volta.ok && volta2.ja && (await store.lerEstoque('moda'))['camiseta|m'] === 1, 'demonstracao: cancelou, a camiseta volta uma vez so');
}
{
  /* pelo mensageiro: a leitura do estoque nao derruba a visita para o banco quando o mensageiro e antigo */
  const rel = relogio();
  const n = navegador(NUVEM, rel);
  const store = n.janela.LigeiroDados.store;
  n.respostas.push({ status: 404, corpo: { erro: 'rota' } });
  let falhou = false;
  await store.lerEstoque('moda').catch(() => { falhou = true; });
  ok(falhou && n.janela.sessionStorage.getItem('ligeiro:borda-fora') === null, 'mensageiro antigo sem estoque: so sem selos, a borda continua valendo');
  n.respostas.push({ status: 200, corpo: { borda: 1, q: { 'camiseta|m': 2 } } });
  const q = await store.lerEstoque('moda', true);
  const ultima = n.chamadas[n.chamadas.length - 1];
  ok(q['camiseta|m'] === 2 && ultima.endereco === 'https://borda.teste/estoque/moda' && ultima.opcoes.cache === 'no-store', 'le o estoque na borda (fresco: sem o guardado do navegador)');
  store.obterIdToken = () => Promise.resolve('tok-dono');
  n.respostas.push({ status: 200, corpo: { ok: true, q: { 'camiseta|m': 5 } } });
  const salvo = await store.salvarEstoque('moda', { 'camiseta|m': 5 });
  const post = n.chamadas[n.chamadas.length - 1];
  ok(salvo['camiseta|m'] === 5 && post.endereco === 'https://borda.teste/estoque' && post.opcoes.headers.Authorization === 'Bearer tok-dono', 'salva pelo mensageiro, com o login do dono');
  n.respostas.push({ status: 403, corpo: { ok: false, erro: 'Essa loja não é sua.' } });
  let e403 = null;
  await store.salvarEstoque('moda', { 'camiseta|m': 5 }).catch((e) => { e403 = e; });
  ok(e403 && e403.message === 'Essa loja não é sua.', 'recusado: o motivo do mensageiro chega a tela');
}

console.log('Fotos extras do item na demonstracao');
{
  const rel = relogio();
  const n = navegador({}, rel);
  const store = n.janela.LigeiroDados.store;
  const loja = { slug: 'galeria', nome: 'Galeria', tipo: 'Roupas', fotosVersao: 'v1', categorias: [{ id: 'c', nome: 'C' }],
    produtos: [{ id: 'a', categoria: 'c', nome: 'A', preco: 100, foto: 'fa', fotosExtras: ['fx1', 'fx2'] }] };
  n.janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify({ lojas: { galeria: loja }, pedidos: {}, contadores: {}, fotos: { galeria: { fa: 'data:image/jpeg;base64,AA', fx1: 'data:image/jpeg;base64,BB' } } }));
  await store.salvarFoto('galeria', 'fx2', 'data:image/jpeg;base64,CC', { extra: true });
  const depois = await store.obterLoja('galeria');
  ok(depois.fotosVersao === 'v1', 'foto extra salva nao muda a versao das fotos (o cliente nao baixa o pacote de novo)');
  const mapa = await store.listarFotos('galeria', 'v1', depois);
  ok(Object.keys(mapa).join(',') === 'fa', 'o mapa da loja so leva a foto principal; as extras vem quando o item abre');
  ok((await store.fotoPublica('galeria', 'fx2')) === 'data:image/jpeg;base64,CC', 'a extra abre pela fotoPublica, como a foto grande');
  await store.excluirFoto('galeria', 'fx1', { extra: true });
  ok((await store.obterLoja('galeria')).fotosVersao === 'v1' && (await store.fotoPublica('galeria', 'fx1')) === null, 'apagar a extra tambem nao mexe na versao');
  await store.salvarFoto('galeria', 'fb', 'data:image/jpeg;base64,DD');
  ok((await store.obterLoja('galeria')).fotosVersao !== 'v1', 'a foto principal continua mudando a versao (o pacote se refaz)');
}

console.log('Mercado Pago: leitura que falhou nunca apaga a conexao');
{
  const gravados = [];
  const segredo = { token: 'APP_USR-123', conectadoEm: '2026-09-01' };
  let lerFalha = true;
  const janela = {
    LIGEIRO_CONFIG: { mercadoPagoClientId: '123', proxyMercadoPago: 'https://borda.teste' }, LigeiroRegras: R,
    location: { href: '' },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  janela.LigeiroDados = { modoDemo: false, store: {
    lerSegredo(slug, nome, falhar) { if (lerFalha) return falhar ? Promise.reject(new Error('unavailable')) : Promise.resolve(null); return Promise.resolve(segredo); },
    guardarSegredo(slug, nome, dados) { gravados.push(dados); return Promise.resolve(true); },
  } };
  janela.window = janela;
  const contexto = vm.createContext(Object.assign(janela, { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, encodeURIComponent }));
  vm.runInContext(codigoMp, contexto);
  const MP = janela.LigeiroMP;
  let erro = null;
  await MP.conectar('loja').catch((e) => { erro = e; });
  ok(!!erro && gravados.length === 0, 'Conectar com a leitura falhando: para, sem gravar nada por cima do token');
  ok(janela.location.href === '', 'e nao sai para o Mercado Pago');
  let erroConexao = null;
  await MP.lerConexao('loja').catch((e) => { erroConexao = e; });
  ok(!!erroConexao, 'conferir a conexao com a leitura falhando da erro (a tela mostra Tentar de novo), nao "desconectado"');
  lerFalha = false;
  await MP.conectar('loja');
  ok(gravados.length === 1 && gravados[0].token === 'APP_USR-123' && !!gravados[0].oauthNonce, 'com a leitura boa, o codigo entra junto do token que ja existia');
  const c = await MP.lerConexao('loja');
  ok(c && c.token === 'APP_USR-123', 'e a conexao aparece como conectada');
}

console.log('Amostra: fora da lista da cidade e entrega para o dono');
{
  const rel = relogio();
  const n = navegador({ adminEmail: 'ligeiro.pedidos@gmail.com' }, rel);
  const store = n.janela.LigeiroDados.store;
  const base = { cidade: 'Juquiá', cidadeSlug: 'juquia', uf: 'SP', ativa: true, categorias: [], produtos: [], plano: { status: 'ativo' } };
  n.janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify({ lojas: {
    'amostra-teste': Object.assign({ slug: 'amostra-teste', nome: 'Amostra Teste', amostra: true }, base),
    'amostra-mp': Object.assign({ slug: 'amostra-mp', nome: 'Amostra Com MP', amostra: true, mpAtivo: true }, base),
    'loja-normal': Object.assign({ slug: 'loja-normal', nome: 'Loja Normal' }, base),
  }, pedidos: {}, contas: {} }));
  const lojas = await store.listarLojas('juquia');
  ok(lojas.length === 1 && lojas[0].slug === 'loja-normal', 'a lista da cidade nao mostra a amostra');
  const cidades = await store.listarCidades();
  ok(cidades.length === 1 && cidades[0].lojas === 1, 'a cidade conta so a loja de verdade');
  const vitrine = await store.listarVitrine();
  ok(vitrine.some((l) => l.slug === 'amostra-teste' && l.amostra === true), 'o resumo da loja leva a marca de amostra (a borda repassa)');
  const erro = async (slug, email) => { try { await store.entregarAmostra(slug, email); return ''; } catch (e) { return e.message; } };
  ok(/não é uma amostra/.test(await erro('loja-normal', 'dono@gmail.com')), 'loja de verdade nao se entrega');
  ok(/Mercado Pago/.test(await erro('amostra-mp', 'dono@gmail.com')), 'amostra com o Mercado Pago ligado nao se entrega (o dinheiro cairia na conta errada)');
  ok(/não o do Ligeiro/.test(await erro('amostra-teste', 'ligeiro.pedidos@gmail.com')), 'o e-mail do Ligeiro nao recebe a amostra');
  ok(/e-mail/.test(await erro('amostra-teste', 'sem-arroba')), 'e-mail torto e recusado');
  const antes = Date.now();
  await store.entregarAmostra('amostra-teste', ' Dono@Gmail.com ');
  const db = JSON.parse(n.janela.localStorage.getItem('ligeiro.demo.v3'));
  const l = db.lojas['amostra-teste'];
  ok(l.amostra === false, 'entregue: deixa de ser amostra (a faixa some e o pedido sai)');
  ok(l.plano && l.plano.status === 'teste' && new Date(l.plano.desde).getTime() >= antes - 1000, 'os dias gratis comecam no dia da entrega');
  ok(db.contas && db.contas['dono@gmail.com'] && db.contas['dono@gmail.com'].plano.status === 'teste', 'a conta do dono nasce no teste, com o e-mail em minusculas');
  const depois = await store.listarLojas('juquia');
  ok(depois.some((x) => x.slug === 'amostra-teste'), 'e a loja entra na lista da cidade');
}

console.log('apagarLojaDeVez: exclui a loja inteira (so desativada), por lotes, e limpa a borda');
{
  /* banco de mentira: os documentos por caminho, listagem por colecao e lotes de apagar */
  const docs = new Map();
  const filhos = (caminho) => [...docs.keys()].filter((k) => k.startsWith(caminho + '/') && k.slice(caminho.length + 1).indexOf('/') < 0);
  const ref = (caminho) => ({ path: caminho, get: () => Promise.resolve({ exists: docs.has(caminho), data: () => docs.get(caminho) }), collection: (n) => colecao(caminho + '/' + n) });
  const colecao = (caminho) => ({
    doc: (id) => ref(caminho + '/' + id),
    limit: (n) => ({ get: () => { const ids = filhos(caminho).slice(0, n); return Promise.resolve({ empty: !ids.length, size: ids.length, docs: ids.map((k) => ({ ref: { path: k } })) }); } }),
    where: (campo, _op, valor) => ({ limit: (n) => ({ get: () => { const ids = filhos(caminho).filter((k) => docs.get(k)[campo] === valor).slice(0, n); return Promise.resolve({ empty: !ids.length, size: ids.length, docs: ids.map((k) => ({ ref: { path: k } })) }); } }) }),
  });
  const lotes = [];
  const bancoFalso = { collection: colecao, batch: () => { const lista = []; lotes.push(lista); return { delete: (r) => lista.push(r.path), commit: () => { lista.forEach((c) => docs.delete(c)); return Promise.resolve(); } }; } };
  const { n, store, publicacoes } = lojaNaNuvem();
  store._iniciar = () => Promise.resolve();
  store.db = bancoFalso;
  docs.set('lojas/ativa', { ativa: true });
  let erro = null;
  await store.apagarLojaDeVez('ativa').catch((e) => { erro = e; });
  ok(erro && /desativada/.test(erro.message) && docs.has('lojas/ativa'), 'loja no ar: recusa, e nada e apagado');
  docs.set('lojas/morta', { ativa: false, donoEmail: 'Dono@Exemplo.com' });
  docs.set('vitrine/morta', { nome: 'x' });
  /* o indice de pagamentos do Mercado Pago (so nasce quando o nome da loja e comprido): o da loja morta sai, o das outras fica */
  docs.set('mp_indice/111', { loja: 'morta', pedido: 'a' }); docs.set('mp_indice/222', { loja: 'morta', pedido: 'b' }); docs.set('mp_indice/333', { loja: 'outra', pedido: 'c' });
  docs.set('contas/dono@exemplo.com', { plano: { status: 'teste' } });
  for (let i = 0; i < 650; i++) docs.set('lojas/morta/pedidos/p' + i, {});
  docs.set('lojas/morta/fotos/_pacote1', {}); docs.set('lojas/morta/contadores/senha', {}); docs.set('lojas/morta/resumos/2026-10-01', {}); docs.set('lojas/morta/privado/mp', {});
  docs.set('lojas/outra', { ativa: false }); docs.set('lojas/outra/pedidos/a', {});
  const antes = publicacoes().length;
  const r = await store.apagarLojaDeVez('morta');
  ok(r === true, 'loja desativada: exclui');
  ok(![...docs.keys()].some((k) => k.startsWith('lojas/morta') || k === 'vitrine/morta'), 'sem sobra: pedidos, fotos, contadores, resumos, privado, o documento e a vitrine');
  ok(docs.has('lojas/outra') && docs.has('lojas/outra/pedidos/a'), 'a loja do lado nao e tocada');
  ok(!docs.has('mp_indice/111') && !docs.has('mp_indice/222') && docs.has('mp_indice/333'), 'o indice de pagamentos da loja sai e o das outras fica');
  ok(docs.has('contas/dono@exemplo.com'), 'a conta do dono (plano e historico) nao e apagada: e dele, nao da loja');
  const marca = n.chamadas.filter((c) => c.endereco === 'https://borda.teste/dono');
  ok(marca.length === 1 && JSON.parse(marca[0].opcoes.body).email === 'dono@exemplo.com' && marca[0].opcoes.headers.Authorization === 'Bearer tok-dono', 'pede a marca de dono nova (sem a loja apagada) para o antigo dono, com o login do admin');
  ok(lotes.every((l) => l.length <= 300 + 2), 'apaga em lotes (nunca passa do limite do banco)');
  ok(publicacoes().length === antes + 1 && JSON.parse(publicacoes()[publicacoes().length - 1].opcoes.body).loja === 'morta', 'avisa a borda (/publicar) para ela limpar a copia');
}

console.log('contarPedidosHoje: a Central soma o dia pela contagem do banco (07/10/2026)');
{
  const { n, store } = lojaNaNuvem();
  n.respostas.push({ status: 200, corpo: [{ result: { aggregateFields: { qtd: { integerValue: '12' } } } }] });
  n.respostas.push({ status: 200, corpo: [{ result: { aggregateFields: { qtd: { integerValue: '9' }, total: { integerValue: '45600' } } } }] });
  const c = await store.contarPedidosHoje('loja', '2026-10-07T03:00:00.000Z');
  ok(c.todos === 12 && c.qtd === 9 && c.total === 45600, 'todos os de hoje, os que valem e o total em centavos');
  const contas = n.chamadas.filter((x) => /documents\/lojas\/loja:runAggregationQuery$/.test(x.endereco));
  ok(contas.length === 2 && contas.every((x) => x.opcoes.method === 'POST' && x.opcoes.headers.Authorization === 'Bearer tok-dono'), 'duas contas no endereco do banco, com o login');
  const filtros = JSON.parse(contas[1].opcoes.body).structuredAggregationQuery.structuredQuery.where.compositeFilter.filters;
  ok(filtros[0].fieldFilter.op === 'IN' && filtros[0].fieldFilter.value.arrayValue.values.map((v) => v.stringValue).join() === 'pago,producao,pronto,finalizado', 'os que valem: sem cancelados e sem Pix esperando');
  ok(filtros[1].fieldFilter.field.fieldPath === 'criadoEm' && filtros[1].fieldFilter.value.stringValue === '2026-10-07T03:00:00.000Z', 'so os de hoje');
}

console.log('contarPedidosHoje: sem o indice composto, volta o link para criar');
{
  const { n, store } = lojaNaNuvem();
  const link = 'https://console.firebase.google.com/v1/r/project/teste/firestore/indexes?create_composite=Abc123';
  n.respostas.push({ status: 200, corpo: [{ result: { aggregateFields: { qtd: { integerValue: '3' } } } }] });
  n.respostas.push({ status: 400, corpo: [{ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'The query requires an index. You can create it here: ' + link } }] });
  const c = await store.contarPedidosHoje('loja', '2026-10-07T03:00:00.000Z');
  ok(c.todos === 3 && c.qtd == null && c.indice === link, 'conta todos e devolve o link (a Central soma os que valem lendo os pedidos, como antes)');
}

console.log('\n' + (total - falhas) + ' de ' + total + ' ok' + (falhas ? ', ' + falhas + ' falharam' : ''));
if (falhas) process.exit(1);
