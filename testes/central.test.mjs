/*
 * Teste da Central do Ligeiro (js/dados.js), sem navegador e sem banco de verdade.
 * Confere as contas do Pagou, do Desfazer, do Pausar/Reativar e do Tornar fundador (D.contas), a demonstracao, e o
 * FirebaseStore sobre um Firestore de mentira com transacao de verdade (le, alguem grava no meio, a transacao refaz):
 * a ficha velha nao grava por cima de um pagamento novo, nao passa das vagas de fundador, o salvarConta nao apaga o que
 * outro gravou no meio, e a busca e o apagar da LGPD leem so o necessario e nao travam com pedido que sumiu.
 * Rodar com:  node testes/central.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const aqui = path.dirname(url.fileURLToPath(import.meta.url));
const codRegras = fs.readFileSync(path.join(aqui, '..', 'js', 'regras.js'), 'utf8');
const codDados = fs.readFileSync(path.join(aqui, '..', 'js', 'dados.js'), 'utf8');

let total = 0, falhas = 0;
function ok(cond, nome, extra) {
  total++;
  if (!cond) falhas++;
  console.log((cond ? 'ok  ' : 'XX  ') + nome + (!cond && extra !== undefined ? '  :: ' + JSON.stringify(extra) : ''));
}
function erroCom(p, trecho) { return p.then(() => null, (e) => e).then((e) => !!e && e.publico === true && String(e.message).indexOf(trecho) >= 0); }

const DIA = 864e5;
const ADMIN = 'ligeiro.pedidos@gmail.com';
const iso = (t) => new Date(t).toISOString();

/* ---- Firestore de mentira: documentos por caminho, versao por documento e transacao otimista (igual ao de verdade:
   se um documento lido mudou antes do commit, refaz a funcao inteira com os dados novos) ---- */
function bancoFalso() {
  const docs = new Map();
  const versoes = new Map();
  const banco = { leituras: 0, antesDoCommit: null, docs };
  const APAGAR = { __apagar: true };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  function gravar(p, d) { docs.set(p, clone(d)); versoes.set(p, (versoes.get(p) || 0) + 1); }
  function juntar(a, b) {
    const r = Object.assign({}, a);
    Object.keys(b).forEach((k) => {
      if (b[k] === APAGAR) delete r[k];
      else if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && r[k] && typeof r[k] === 'object' && !Array.isArray(r[k])) r[k] = juntar(r[k], b[k]);
      else r[k] = b[k];
    });
    return r;
  }
  function escrever(p, d, o) { gravar(p, o && o.merge && docs.has(p) ? juntar(docs.get(p), d) : juntar({}, d)); }
  function atualizar(p, d) {
    if (!docs.has(p)) { const e = new Error('No document to update: ' + p); e.code = 'not-found'; throw e; }
    const atual = clone(docs.get(p));
    Object.keys(d).forEach((k) => { if (d[k] === APAGAR) delete atual[k]; else atual[k] = clone(d[k]); });
    gravar(p, atual);
  }
  function foto(p) { const d = docs.get(p); return { id: p.split('/').pop(), exists: d !== undefined, data: () => clone(d), ref: ref(p) }; }
  function ref(p) {
    return {
      path: p, id: p.split('/').pop(),
      collection: (n) => colecao(p + '/' + n),
      get: async () => { banco.leituras++; return foto(p); },
      set: async (d, o) => escrever(p, d, o),
      update: async (d) => atualizar(p, d),
      delete: async () => { docs.delete(p); },
    };
  }
  function campo(obj, caminho) { return caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function colecao(c, filtros) {
    const fs2 = filtros || [];
    return {
      doc: (id) => ref(c + '/' + id),
      where: (cp, op, v) => colecao(c, fs2.concat([[cp, op, v]])),
      orderBy: () => colecao(c, fs2),
      limit: () => colecao(c, fs2),
      get: async () => {
        const lista = [];
        for (const [p, d] of docs) {
          if (p.indexOf(c + '/') !== 0 || p.slice(c.length + 1).indexOf('/') >= 0) continue;
          const passa = fs2.every(([cp, op, v]) => (op === '==' ? campo(d, cp) === v : op === 'in' ? v.indexOf(campo(d, cp)) >= 0 : op === '>=' ? campo(d, cp) >= v : true));
          if (passa) lista.push(foto(p));
        }
        banco.leituras += Math.max(1, lista.length);
        return { size: lista.length, empty: !lista.length, docs: lista, forEach: (f) => lista.forEach(f) };
      },
    };
  }
  banco.db = {
    collection: (n) => colecao(n),
    batch: () => {
      const ops = [];
      const lote = {
        update: (r, d) => { ops.push(() => atualizar(r.path, d)); return lote; },
        set: (r, d, o) => { ops.push(() => escrever(r.path, d, o)); return lote; },
        delete: (r) => { ops.push(() => docs.delete(r.path)); return lote; },
        commit: async () => {
          /* tudo ou nada, como o lote de verdade */
          const copia = new Map(docs), copiaV = new Map(versoes);
          try { ops.forEach((f) => f()); } catch (e) { docs.clear(); copia.forEach((v, k) => docs.set(k, v)); versoes.clear(); copiaV.forEach((v, k) => versoes.set(k, v)); throw e; }
        },
      };
      return lote;
    },
    runTransaction: async (fn) => {
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const lidos = new Map();
        const escritas = [];
        const tx = {
          get: async (r) => { banco.leituras++; lidos.set(r.path, versoes.get(r.path) || 0); return foto(r.path); },
          set: (r, d, o) => { escritas.push(() => escrever(r.path, d, o)); return tx; },
          update: (r, d) => { escritas.push(() => atualizar(r.path, d)); return tx; },
        };
        const res = await fn(tx);
        if (banco.antesDoCommit) { const h = banco.antesDoCommit; banco.antesDoCommit = null; await h(); }
        let mudou = false;
        for (const [p, v] of lidos) if ((versoes.get(p) || 0) !== v) mudou = true;
        if (mudou) continue;
        escritas.forEach((f) => f());
        return res;
      }
      const e = new Error('too much contention'); e.code = 'aborted'; throw e;
    },
  };
  banco.ler = (p) => clone(docs.get(p));
  banco.por = (p, d) => gravar(p, d);
  banco.APAGAR = APAGAR;
  return banco;
}

/* ---- carrega regras.js e dados.js num navegador de mentira ---- */
function carregar(nuvem) {
  const guardado = {};
  const janela = {
    localStorage: { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = String(v); }, removeItem: (k) => { delete guardado[k]; } },
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, console,
    location: { hash: '#/admin' },
    LIGEIRO_CONFIG: {
      adminEmail: ADMIN, proxyMercadoPago: '', senhaAdmin: 'ligeiro',
      precos: { mensal: 8900, anual: 89000, diasGratis: 7 }, fundador: { vagas: 5, jaOcupadas: 0 },
      planos: [{ id: 'uma', nome: 'Ligeiro', lojas: 1, mensal: 8900, anual: 89000, fundador: { mensal: 7900, anual: 79000 } }],
      firebase: nuvem ? { projectId: 'teste' } : null,
    },
    LigeiroFundadores: { usados: 0 },
  };
  janela.window = janela;
  vm.createContext(janela);
  vm.runInContext(codRegras, janela);
  vm.runInContext(codDados, janela);
  const D = janela.LigeiroDados, R = janela.LigeiroRegras;
  let banco = null;
  if (nuvem) {
    banco = bancoFalso();
    janela.firebase = { firestore: { FieldValue: { delete: () => banco.APAGAR } } };
    D.store._iniciar = function () { this.db = banco.db; this.auth = { currentUser: null }; return Promise.resolve(); };
  }
  return { janela, D, R, store: D.store, banco };
}

const { D, R } = carregar(false);
const C = D.contas;
const agora = Date.UTC(2026, 8, 25, 15);
const conta = (plano, extra) => Object.assign({ email: 'x@x.com', criadoEm: iso(agora - 60 * DIA), plano: Object.assign({ planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(agora - 60 * DIA) }, plano) }, extra || {});
const aplicar = (c, r) => Object.assign({}, c, { plano: Object.assign({}, c.plano, JSON.parse(JSON.stringify(r.plano))) });
const estado = (c, t) => R.assinatura(c, new Date(t || agora));

console.log('--- contas puras (D.contas) ---');
{
  /* 1) primeiro pagamento depois que o gratis acabou, e o Desfazer (achado M2) */
  const desde = Date.UTC(2026, 8, 1, 12), hoje = desde + 20 * DIA;
  const c0 = { email: 'x@x.com', criadoEm: iso(desde), plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(desde) } };
  const k = C.pagou(c0, 30, { usados: 0 }, { agora: hoje });
  const c1 = aplicar(c0, k);
  ok(k.viraFundador && k.usados === 1 && estado(c1, hoje).estado === 'ativa' && c1.plano.pagoAte === iso(hoje + 30 * DIA), 'Pagou depois do gratis: conta de hoje, ativa e vira fundador (vaga 1 de 5)');
  const d = C.desfez(c1, { usados: 1 }, { agora: hoje + 60e3, esperado: { pagoAte: c1.plano.pagoAte, ultimoPagamentoEm: c1.plano.ultimoPagamentoEm } });
  const c2 = aplicar(c1, d);
  ok(c2.plano.status === 'teste' && c2.plano.pagoAte === '' && c2.plano.planoPago === '' && c2.plano.ultimoPagamentoEm === '' && c2.plano.fundador === false, 'Desfazer volta exatamente ao de antes (teste, sem pagoAte, sem planoPago, sem fundador)', c2.plano);
  ok(d.liberouVaga && d.usados === 0, 'Desfazer devolve a vaga de fundador que o Pagou pegou');
  ok(estado(c2, hoje + 60e3).estado === estado(c0, hoje).estado && estado(c2, hoje + 5 * DIA).estado === 'bloqueada', 'depois do Desfazer a conta fica bloqueada como antes (e nao "vencendo" com a data do pagamento)');
  ok(c2.plano.antesDoPagamento === null, 'Desfazer apaga a foto: nao da para desfazer duas vezes');
  let segunda = null; try { C.desfez(c2, { usados: 0 }, {}); } catch (e) { segunda = e; }
  ok(segunda && segunda.publico, 'segundo Desfazer seguido e recusado');
}
{
  /* 2) Pagou numa conta PAUSADA que ainda tinha dias pagos (achado M1) */
  const c = conta({ tipo: 'anual', status: 'pausado', pagoAte: iso(agora + 200 * DIA), planoPago: 'uma', ultimoPagamentoEm: iso(agora - 165 * DIA) });
  ok(C.pagou(c, 30, { usados: 5 }, { agora }).pagoAte === iso(agora + 230 * DIA), 'pausada com 200 dias pagos: Pagou 30 conta do pagoAte (230 dias), como o mensageiro do Asaas');
  ok(C.baseDoPagamento(conta({ status: 'pausado', pagoAte: iso(agora - 3 * DIA) }), agora) === agora, 'pausada vencida ha 3 dias: conta de hoje (a tolerancia nao vale para pausada)');
}
{
  /* 3) de onde contam os dias: a mesma conta do mensageiro do Asaas */
  const asaas = (p, t) => { /* copia da formula de ferramentas/worker-asaas.js */
    const inicio = p.desde ? new Date(p.desde).getTime() : NaN, fimGratis = isFinite(inicio) ? inicio + 7 * DIA : 0;
    const pa = p.pagoAte ? Date.parse(p.pagoAte) || 0 : 0;
    const noPrazo = pa > 0 && p.status !== 'cancelado' && p.status !== 'pausado' && t - pa <= 10 * DIA;
    return noPrazo ? Math.max(pa, fimGratis) : Math.max(t, pa, fimGratis);
  };
  const casos = [
    ['ativa, vence em 5 dias', { status: 'ativo', pagoAte: iso(agora + 5 * DIA) }],
    ['ativa, venceu ha 5 dias (tolerancia)', { status: 'ativo', pagoAte: iso(agora - 5 * DIA) }],
    ['ativa, venceu ha 20 dias', { status: 'ativo', pagoAte: iso(agora - 20 * DIA) }],
    ['encerrada ainda paga', { status: 'cancelado', pagoAte: iso(agora + 9 * DIA) }],
    ['encerrada vencida ha 5 dias', { status: 'cancelado', pagoAte: iso(agora - 5 * DIA) }],
    ['pausada com dias pagos', { status: 'pausado', pagoAte: iso(agora + 40 * DIA) }],
    ['no gratis (2 dias de conta)', { status: 'teste', desde: iso(agora - 2 * DIA) }],
    ['gratis acabou', { status: 'teste', desde: iso(agora - 30 * DIA) }],
    ['cortesia', { status: 'ativo', pagoAte: '' }],
  ];
  const errados = casos.filter(([, p]) => { const c = conta(p); return C.baseDoPagamento(c, agora) !== asaas(c.plano, agora); }).map((x) => x[0]);
  ok(!errados.length, 'base do Pagou igual a do mensageiro do Asaas em ' + casos.length + ' situacoes', errados);
  ok(C.pagou(conta({ status: 'ativo', pagoAte: iso(agora - 5 * DIA), ultimoPagamentoEm: iso(agora - 35 * DIA) }), 30, { usados: 0 }, { agora }).pagoAte === iso(agora + 25 * DIA), 'pagou dentro da tolerancia: os dias contam do vencimento (atraso nao vem de graca)');
}
{
  /* 4) vaga de fundador so enquanto houver, lida agora */
  const nova = conta({});
  ok(C.pagou(nova, 30, { usados: 4 }, { agora }).viraFundador === true, 'com 4 de 5 ocupadas: o primeiro pagamento vira fundador');
  const cheio = C.pagou(nova, 30, { usados: 5 }, { agora });
  ok(cheio.viraFundador === false && cheio.usados === 5 && cheio.plano.fundador === false, 'com 5 de 5: nao vira fundador e o contador nao passa de 5');
  ok(C.pagou(conta({ status: 'ativo', pagoAte: iso(agora + DIA), ultimoPagamentoEm: iso(agora - 29 * DIA) }), 30, { usados: 0 }, { agora }).viraFundador === false, 'quem ja pagou sem ser fundador nao vira fundador');
  ok(C.pagou(nova, 30, null, { agora }).viraFundador === false, 'loja sem conta (sem contador): nao mexe em fundador');
  let semVaga = null; try { C.virouFundador(nova, { usados: 5 }); } catch (e) { semVaga = e; }
  ok(semVaga && semVaga.publico && /acabaram/.test(semVaga.message), 'Tornar fundador sem vaga e recusado');
  const tf = C.virouFundador(nova, { usados: 2 });
  ok(tf.plano.fundador === true && tf.usados === 3, 'Tornar fundador com vaga: fundador e contador + 1');
  ok(JSON.stringify(C.virouFundador(conta({ fundador: true }), { usados: 5 })) === JSON.stringify({ plano: {}, usados: 5 }), 'Tornar fundador de quem ja e: nao muda nada');
}
{
  /* 5) ficha velha: o banco tem outro pagamento */
  const c = conta({ status: 'ativo', pagoAte: iso(agora + 368 * DIA), ultimoPagamentoEm: iso(agora), tipo: 'anual', fundador: true });
  let e = null; try { C.pagou(c, 30, { usados: 5 }, { agora, esperado: { pagoAte: iso(agora + 3 * DIA), ultimoPagamentoEm: '' } }); } catch (x) { e = x; }
  ok(e && e.publico && /mudou/.test(e.message) && /Atualizar/.test(e.message), 'Pagou com a ficha velha: recusa e pede para atualizar a Central');
  let e2 = null; try { C.desfez(c, { usados: 5 }, {}); } catch (x) { e2 = x; }
  ok(e2 && e2.publico, 'pagamento sem foto da Central (Asaas): o Desfazer e recusado');
}
{
  /* 6) Desfazer: +1 ano volta para mensal, o aviso volta, e o que mudou depois fica */
  const c0 = conta({ status: 'ativo', pagoAte: iso(agora + 3 * DIA), ultimoPagamentoEm: iso(agora - 27 * DIA), planoPago: 'uma', avisoPagamentoEm: iso(agora - DIA), avisoValor: 89000 });
  const c1 = aplicar(c0, C.pagou(c0, 365, { usados: 5 }, { agora }));
  ok(c1.plano.tipo === 'anual' && c1.plano.avisoPagamentoEm === '', 'Pagou +1 ano: anual e tira o aviso de pagamento');
  const c2 = aplicar(c1, C.desfez(c1, { usados: 5 }, { agora: agora + 60e3 }));
  ok(c2.plano.tipo === 'mensal' && c2.plano.pagoAte === c0.plano.pagoAte && c2.plano.ultimoPagamentoEm === c0.plano.ultimoPagamentoEm && c2.plano.avisoPagamentoEm === c0.plano.avisoPagamentoEm && c2.plano.avisoValor === 89000, 'Desfazer volta o mensal, o pagoAte, o ultimo pagamento e o aviso de antes', c2.plano);
  const encerrada = aplicar(c1, { plano: { status: 'cancelado' } });
  ok(aplicar(encerrada, C.desfez(encerrada, { usados: 5 }, { agora })).plano.status === 'cancelado', 'conta encerrada depois do Pagou continua encerrada no Desfazer');
}
{
  /* 7) Cortesia, Pausar e Reativar (achado M3) */
  const cort = conta({ status: 'ativo', pagoAte: '', planoPago: 'uma' }, { criadoEm: iso(agora - 55 * DIA) });
  const p1 = aplicar(cort, C.pausou(cort, { agora }));
  ok(estado(p1).estado === 'pausada' && R.lojaBloqueada(p1, new Date(agora)), 'cortesia pausada: loja bloqueada');
  const r1 = aplicar(p1, C.reativou(p1, { agora: agora + DIA }));
  ok(estado(r1, agora + DIA).estado === 'ativa' && estado(r1, agora + DIA).cortesia === true && !R.lojaBloqueada(r1, new Date(agora + DIA)), 'Reativar volta a cortesia (antes voltava como teste e a loja ficava bloqueada)', r1.plano);
  ok(r1.plano.antesDaPausa === null, 'Reativar apaga a lembranca da pausa');
  /* pausa do mensageiro (estorno) depois de uma pausa antiga da Central: nao usa a lembranca velha */
  const velha = aplicar(r1, { plano: { status: 'pausado', pausadoEm: iso(agora + 2 * DIA), antesDaPausa: { status: 'ativo', em: iso(agora - 9 * DIA) } } });
  ok(aplicar(velha, C.reativou(velha, { agora: agora + 3 * DIA })).plano.status === 'teste', 'pausa do mensageiro: Reativar nao usa a lembranca de outra pausa (sem dias pagos, teste)');
  const paga = conta({ status: 'pausado', pagoAte: iso(agora + 20 * DIA), pausadoEm: iso(agora - DIA) });
  ok(aplicar(paga, C.reativou(paga, { agora })).plano.status === 'ativo', 'pausa sem lembranca e com dias pagos: Reativar deixa ativa');
  ok(JSON.stringify(C.pausou(p1, { agora }).plano) === '{}', 'Pausar de novo uma conta pausada nao muda nada');
  /* Pagou, Pausar, Desfazer e Reativar: nao vira cortesia de graca */
  const t0 = conta({}, { criadoEm: iso(agora - 20 * DIA) });
  t0.plano.desde = iso(agora - 20 * DIA);
  const t1 = aplicar(t0, C.pagou(t0, 30, { usados: 5 }, { agora }));
  const t2 = aplicar(t1, C.pausou(t1, { agora: agora + 60e3 }));
  const t3 = aplicar(t2, C.desfez(t2, { usados: 5 }, { agora: agora + 120e3 }));
  const t4 = aplicar(t3, C.reativou(t3, { agora: agora + 180e3 }));
  ok(t3.plano.status === 'pausado' && t4.plano.status === 'teste' && estado(t4, agora + 180e3).cortesia !== true && estado(t4, agora + 180e3).estado === 'bloqueada', 'Pagou, Pausar, Desfazer e Reativar: volta ao teste que tinha acabado (e nao cortesia)', t4.plano);
}

console.log('\n--- demonstracao (DemoStore) ---');
{
  const { D: Dd, store, janela } = carregar(false);
  const db = { lojas: {
    'loja-x': { slug: 'loja-x', nome: 'Loja X', donoEmail: 'x@x.com', ativa: true, plano: { status: 'teste' } },
    'do-ligeiro': { slug: 'do-ligeiro', nome: 'Do Ligeiro', donoEmail: ADMIN, ativa: true, plano: { status: 'teste' } },
  }, pedidos: {}, contadores: {}, contas: {
    'x@x.com': conta({}, { criadoEm: iso(Date.now() - 20 * DIA) }),
    [ADMIN]: { email: ADMIN, criadoEm: iso(Date.now() - 90 * DIA), plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(Date.now() - 90 * DIA) } },
  }, publico: { fundadores: { usados: 4 } } };
  db.contas['x@x.com'].plano.desde = iso(Date.now() - 20 * DIA);
  janela.localStorage.setItem('ligeiro.demo.v3', JSON.stringify(db));
  const r = await store.mudarConta('x@x.com', (atual, vagas) => Dd.contas.pagou(atual, 30, vagas, { esperado: { pagoAte: '', ultimoPagamentoEm: '' } }));
  const lido = JSON.parse(janela.localStorage.getItem('ligeiro.demo.v3'));
  ok(r.usados === 5 && lido.publico.fundadores.usados === 5 && lido.contas['x@x.com'].plano.fundador === true, 'demonstracao: Pagou grava a conta e a vaga de fundador juntas');
  await store.espelharPlanoNasLojas('x@x.com');
  await store.espelharPlanoNasLojas(ADMIN);
  const depois = JSON.parse(janela.localStorage.getItem('ligeiro.demo.v3'));
  ok(depois.lojas['loja-x'].plano.status === 'ativo' && depois.lojas['loja-x'].plano.pagoAte === lido.contas['x@x.com'].plano.pagoAte, 'demonstracao: a copia nas lojas acompanha o Pagou');
  const pl = depois.lojas['do-ligeiro'].plano;
  const publica = { plano: pl }; /* a copia publica, sem o e-mail do dono */
  ok(pl.status === 'ativo' && pl.pagoAte === '' && !R.lojaBloqueada(publica), 'loja da conta do Ligeiro: a copia vai como cortesia e a copia publica nao fica bloqueada', pl);
  ok(await erroCom(store.ocuparVagaFundador(), 'acabaram'), 'demonstracao: ocuparVagaFundador com 5 de 5 e recusado');
  ok(await erroCom(store.mudarConta('x@x.com', (atual, vagas) => Dd.contas.pagou(atual, 30, vagas, { esperado: { pagoAte: '', ultimoPagamentoEm: '' } })), 'mudou'), 'demonstracao: segundo Pagou com a ficha velha e recusado (nao soma os dias duas vezes)');
  const semLoja = await store.mudarPlanoDaLoja('loja-x', (l) => ({ plano: Object.assign({}, l.plano, { status: 'pausado' }), ativa: l.ativa !== false }));
  ok(semLoja && JSON.parse(janela.localStorage.getItem('ligeiro.demo.v3')).lojas['loja-x'].plano.status === 'pausado', 'demonstracao: mudarPlanoDaLoja grava o plano da loja');
}

console.log('\n--- nuvem (FirebaseStore sobre um Firestore de mentira) ---');
{
  const { D: Dn, store, banco } = carregar(true);
  const esp = (c) => ({ pagoAte: c.plano.pagoAte || '', ultimoPagamentoEm: c.plano.ultimoPagamentoEm || '' });
  /* a ficha abriu com a conta assim: ativa, 3 dias pagos, sem pagamento pela Central, 4 de 5 vagas usadas */
  const naTela = { email: 'y@x.com', criadoEm: iso(Date.now() - 60 * DIA), plano: { planoId: 'uma', tipo: 'mensal', status: 'ativo', desde: iso(Date.now() - 60 * DIA), pagoAte: iso(Date.now() + 3 * DIA), planoPago: 'uma', ultimoPagamentoEm: '', fundador: false } };
  banco.por('contas/y@x.com', naTela);
  banco.por('publico/fundadores', { usados: 4 });
  banco.por('lojas/loja-y', { slug: 'loja-y', nome: 'Loja Y', donoEmail: 'y@x.com', ativa: true, plano: { status: 'ativo', pagoAte: naTela.plano.pagoAte } });
  /* achado 3 da revisao: o Asaas grava o anual (e pega a ultima vaga) enquanto a ficha esta aberta */
  banco.por('contas/y@x.com', Object.assign({}, naTela, { plano: Object.assign({}, naTela.plano, { tipo: 'anual', pagoAte: iso(Date.now() + 368 * DIA), ultimoPagamentoEm: iso(Date.now()), fundador: true }) }));
  banco.por('publico/fundadores', { usados: 5 });
  const pagou = (e) => (atual, vagas) => Dn.contas.pagou(atual, 30, vagas, { esperado: e });
  ok(await erroCom(store.mudarConta('y@x.com', pagou(esp(naTela))), 'mudou'), 'Pagou com a ficha aberta antes do pagamento do Asaas: recusa (antes gravava 30 dias por cima do anual)');
  ok(banco.ler('contas/y@x.com').plano.tipo === 'anual' && banco.ler('publico/fundadores').usados === 5, 'o anual do Asaas ficou e o contador continua em 5 de 5 (antes ia para 6)');

  /* alguem grava no meio da transacao: ela refaz com a conta nova e recusa */
  const z = { email: 'z@x.com', criadoEm: iso(Date.now() - 40 * DIA), plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(Date.now() - 40 * DIA) } };
  banco.por('contas/z@x.com', z);
  banco.por('publico/fundadores', { usados: 3 });
  banco.antesDoCommit = () => banco.por('contas/z@x.com', Object.assign({}, z, { plano: Object.assign({}, z.plano, { status: 'ativo', pagoAte: iso(Date.now() + 30 * DIA), ultimoPagamentoEm: iso(Date.now()) }) }));
  ok(await erroCom(store.mudarConta('z@x.com', pagou(esp(z))), 'mudou'), 'pagamento gravado no meio da transacao: ela refaz e recusa, sem somar os dias duas vezes');
  ok(banco.ler('publico/fundadores').usados === 3, 'e nao pega vaga de fundador');

  /* caminho normal: conta e vaga na mesma gravacao */
  const w = { email: 'w@x.com', criadoEm: iso(Date.now() - 40 * DIA), plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(Date.now() - 40 * DIA) } };
  banco.por('contas/w@x.com', w);
  const r = await store.mudarConta('w@x.com', pagou(esp(w)));
  const cw = banco.ler('contas/w@x.com');
  ok(r.feito.viraFundador && r.usados === 4 && banco.ler('publico/fundadores').usados === 4 && cw.plano.fundador === true && cw.plano.antesDoPagamento.status === 'teste', 'Pagou normal: conta, foto do antes e vaga de fundador gravadas juntas');
  const d = await store.mudarConta('w@x.com', (atual, vagas) => Dn.contas.desfez(atual, vagas, { esperado: esp(cw) }));
  const cw2 = banco.ler('contas/w@x.com');
  ok(d.usados === 3 && banco.ler('publico/fundadores').usados === 3 && cw2.plano.status === 'teste' && cw2.plano.pagoAte === '' && cw2.plano.fundador === false, 'Desfazer na nuvem: volta a conta e devolve a vaga na mesma gravacao', cw2.plano);

  /* ocuparVagaFundador com teto */
  banco.por('publico/fundadores', { usados: 5 });
  ok(await erroCom(store.ocuparVagaFundador(), 'acabaram'), 'ocuparVagaFundador com 5 de 5 e recusado (antes somava 6)');

  /* salvarConta em transacao: o que outro gravou no meio nao se perde */
  const noMeio = iso(Date.now() + 99 * DIA);
  banco.antesDoCommit = () => banco.por('contas/w@x.com', Object.assign({}, cw2, { plano: Object.assign({}, cw2.plano, { pagoAte: noMeio, ultimoPagamentoEm: iso(Date.now()) }) }));
  await store.salvarConta('w@x.com', { plano: { avisoPagamentoEm: iso(Date.now()), avisoValor: 8900 } });
  const cw3 = banco.ler('contas/w@x.com');
  ok(cw3.plano.pagoAte === noMeio && cw3.plano.avisoValor === 8900, 'salvarConta refaz com a conta nova: o pagamento gravado no meio fica, e o aviso entra', cw3.plano);

  /* conta do Ligeiro: a copia nas lojas vai como cortesia */
  banco.por('contas/' + ADMIN, { email: ADMIN, criadoEm: iso(Date.now() - 90 * DIA), plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: iso(Date.now() - 90 * DIA) } });
  banco.por('lojas/dom-teste', { slug: 'dom-teste', nome: 'Dom Teste', donoEmail: ADMIN, ativa: true, plano: { status: 'teste', desde: iso(Date.now() - 90 * DIA) } });
  await store.espelharPlanoNasLojas(ADMIN);
  const pl = banco.ler('lojas/dom-teste').plano, pv = banco.ler('vitrine/dom-teste').plano;
  ok(pl.status === 'ativo' && pl.pagoAte === '' && pv.status === 'ativo' && !R.lojaBloqueada({ plano: pv }), 'loja da conta do Ligeiro na nuvem: loja e vitrine em cortesia (a vitrine sem e-mail nao fica bloqueada)');
  ok(JSON.stringify(Dn.planoDaLoja('y@x.com', { status: 'teste', desde: 'x' })).indexOf('"status":"teste"') >= 0, 'conta comum: a copia continua igual a da conta');

  /* loja sem conta: o Pagou pela ficha da loja tambem confere o que a ficha viu */
  banco.por('lojas/sem-dono', { slug: 'sem-dono', nome: 'Sem Dono', ativa: false, criadoEm: iso(Date.now() - 50 * DIA), plano: { status: 'ativo', pagoAte: iso(Date.now() + 5 * DIA), ultimoPagamentoEm: iso(Date.now() - DIA) } });
  const fazLoja = (e) => (l) => { const k = Dn.contas.pagou(l, 30, null, { esperado: e, oQue: 'loja' }); return { pagoAte: k.pagoAte, plano: Object.assign({}, l.plano, { status: 'ativo', pagoAte: k.pagoAte, ultimoPagamentoEm: k.plano.ultimoPagamentoEm }), ativa: true }; };
  ok(await erroCom(store.mudarPlanoDaLoja('sem-dono', fazLoja({ pagoAte: iso(Date.now() - 25 * DIA), ultimoPagamentoEm: '' })), 'loja mudou'), 'loja sem conta: Pagou com a ficha velha e recusado');
  const sl = banco.ler('lojas/sem-dono');
  const rl = await store.mudarPlanoDaLoja('sem-dono', fazLoja({ pagoAte: sl.plano.pagoAte, ultimoPagamentoEm: sl.plano.ultimoPagamentoEm }));
  ok(banco.ler('lojas/sem-dono').plano.pagoAte === rl.pagoAte && rl.pagoAte === iso(Date.parse(sl.plano.pagoAte) + 30 * DIA) && banco.ler('lojas/sem-dono').ativa === true && banco.ler('vitrine/sem-dono').plano.pagoAte === rl.pagoAte, 'loja sem conta: Pagou soma do vencimento e a vitrine acompanha');
  await store.mudarPlanoDaLoja('sem-dono', (l) => ({ plano: Object.assign({}, l.plano, { status: 'pausado' }) }));
  ok(banco.ler('lojas/sem-dono').plano.status === 'pausado' && banco.ler('lojas/sem-dono').ativa === true, 'loja sem conta: sem "ativa" na resposta, o mudarPlanoDaLoja nao mexe em ativa');
}
{
  /* LGPD: busca so os pedidos da pessoa e o apagar nao trava com pedido que sumiu */
  const { store, banco } = carregar(true);
  const tel = '13996447414';
  for (let l = 0; l < 3; l++) {
    const slug = 'loja' + l;
    banco.por('lojas/' + slug, { slug, nome: 'Loja ' + l, ativa: true });
    for (let i = 0; i < 200; i++) banco.por('lojas/' + slug + '/pedidos/p' + i, { id: 'p' + i, criadoEm: iso(Date.now() - i * 36e5), cliente: { nome: 'Outro ' + i, telefone: '1398888' + String(1000 + i) }, itens: [], total: 1000 });
    banco.por('lojas/' + slug + '/resumos/2026-09-2' + l, { clientes: [{ t: '1396447414', n: 'Ana' }, { t: '13977776666', n: 'Bia' }] });
  }
  banco.por('lojas/loja0/pedidos/ana1', { id: 'ana1', criadoEm: iso(Date.now()), cliente: { nome: 'Ana', telefone: tel }, endereco: { rua: 'Rua A' }, observacao: 'portao azul', itens: [{ produtoId: 'x', quantidade: 1, observacao: 'sem cebola, casa da esquina', tamanho: 'g' }], total: 3000, aviso: { x: 1 } });
  banco.por('lojas/loja2/pedidos/ana2', { id: 'ana2', criadoEm: iso(Date.now()), cliente: { nome: 'Ana', telefone: '1396447414' }, itens: [], total: 2000 });
  banco.por('leads/l1', { id: 'l1', nome: 'Ana', whatsapp: tel });
  banco.leituras = 0;
  const a = await store.dadosDoTitular('(13) 99644-7414');
  ok(a.pedidos.length === 2 && a.resumos.length === 3 && a.leads.length === 1, 'LGPD: acha os pedidos com e sem o 9, os relatorios e o contato', { p: a.pedidos.length, r: a.resumos.length, l: a.leads.length });
  ok(banco.leituras < 30, 'LGPD: leu ' + banco.leituras + ' registros (antes leria os 600 pedidos das 3 lojas)');
  /* entre a busca e o apagar, um pedido some e um cliente novo entra no relatorio */
  banco.docs.delete('lojas/loja2/pedidos/ana2');
  const r0 = banco.ler('lojas/loja0/resumos/2026-09-20');
  r0.clientes.push({ t: '13955554444', n: 'Caio' });
  banco.por('lojas/loja0/resumos/2026-09-20', r0);
  const feito = await store.anonimizarTitular(a);
  const p = banco.ler('lojas/loja0/pedidos/ana1');
  ok(feito.pedidos === 1 && feito.resumos === 3 && feito.leads === 1, 'LGPD: o pedido que sumiu fica de fora e o resto e apagado (antes o lote inteiro falhava para sempre)', feito);
  ok(p.cliente.telefone === '' && p.observacao === '' && p.itens[0].observacao === '' && p.itens[0].tamanho === 'g' && p.total === 3000 && !('aviso' in p), 'LGPD: apaga a observacao de cada item e mantem o resto do item e o valor', p);
  ok(banco.ler('lojas/loja0/resumos/2026-09-20').clientes.map((c) => c.n).join(',') === 'Bia,Caio', 'LGPD: o relatorio sai da versao de agora (o cliente que entrou depois da busca fica)');
  ok(!banco.ler('leads/l1'), 'LGPD: o contato e apagado');
  ok(await erroCom(store.dadosDoTitular('1234'), 'DDD'), 'LGPD: telefone sem DDD e recusado antes de ler qualquer coisa');
}

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
if (falhas) process.exit(1);
