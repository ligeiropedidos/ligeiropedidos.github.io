/* Fuzz da mensalidade pelo Pix/cartao (17/11/2026): milhares de sequencias aleatorias do que o dono e o Asaas podem fazer,
   com o mensageiro de verdade (ferramentas/worker-asaas.js) e um Asaas de mentira que se comporta como o de verdade:
   cobranca nova perto do vencimento, vencida depois do dia, cartao que cobra sozinho, aviso atrasado / repetido / fora de
   ordem / perdido, a conferencia de todo dia, estorno. Depois de cada passo confere as regras que nunca podem quebrar.
   Uso: node testes/mensalidade.fuzz.mjs [sequencias, 400 se nao disser] [semente]. Sai com erro se alguma regra quebrar (o AVISO da proxima mensalidade adiantada nao conta) */
const RealDate = Date;
let deslocado = 0;
class Relogio extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + deslocado); else super(...a); }
  static now() { return RealDate.now() + deslocado; }
}
globalThis.Date = Relogio;

const H = await import('./apoio-asaas.mjs');
const { worker, env, db, mudou, clientes, assinaturas, cobrancas, tokenDe, kv, webhook, pedir, emails } = H;
const N = Number(process.argv[2] || 400);
let semente = Number(process.argv[3] || 12345);
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const escolher = (l) => l[Math.floor(rnd() * l.length)];
const DIA = 864e5;
const PAGOS = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const diaBR = (ms) => new RealDate(ms - 3 * 36e5).toISOString().slice(0, 10);
const msDoDia = (d) => RealDate.parse(d + 'T03:00:00Z');
const somarCiclo = (dia, ciclo) => { const d = new RealDate(dia + 'T12:00:00Z'); if (ciclo === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };

/* silencio: o mensageiro escreve no console; guardo as ultimas linhas para mostrar junto de uma falha */
const log = [];
console.log = (...a) => { log.push(a.join(' ')); if (log.length > 60) log.shift(); };
console.error = console.log;
const escrever = (t) => process.stdout.write(t + '\n');

const falhas = {};
let passos = 0, seqs = 0, pagamentosFeitos = 0, creditos = 0, recuperadosTarde = 0;
function falha(tipo, detalhe, hist) {
  if (!falhas[tipo]) falhas[tipo] = { n: 0, exemplo: null };
  falhas[tipo].n++;
  if (!falhas[tipo].exemplo) falhas[tipo].exemplo = { detalhe, hist: hist.slice(-25), log: log.slice(-15) };
}

for (let s = 0; s < N; s++) {
  seqs++;
  /* mundo limpo a cada sequencia */
  db.clear(); clientes.clear(); assinaturas.clear(); cobrancas.clear(); kv.m.clear(); emails.length = 0;
  deslocado += 40 * DIA; /* o tempo so anda para a frente (a memoria do mensageiro e por e-mail) */
  const email = 'loja' + s + '@x.com';
  const desde = Date.now() - Math.floor(rnd() * 9) * DIA;
  const fimGratis = desde + 7 * DIA;
  db.set('contas/' + email, { email, nome: 'Loja ' + s, lojaCriadaEm: new RealDate(desde).toISOString(), plano: { status: 'teste', tipo: 'mensal', planoId: 'uma', desde: new RealDate(desde).toISOString() } });
  mudou('contas/' + email);
  db.set('lojas/loja-' + s, { donoEmail: email, plano: {} });
  const tk = tokenDe(email);
  const hist = [];
  const fila = [];           /* avisos esperando para chegar ao mensageiro */
  const entregues = [];      /* para repetir */
  let tela = null;           /* a cobranca que a janela de Pagar mostra */
  const mostradas = [];      /* cobrancas que ja apareceram (Pix velho guardado) */
  let cartaoGuardado = false;
  let oraculo = { pagoAte: 0, valido: true };
  let creditadosAntes = [];
  let teveEstorno = false;
  const conta = () => db.get('contas/' + email) || {};
  const doCliente = (c) => { const cl = clientes.get(c.customer); return !!cl && cl.email === email; };
  const avisar = (evento, c) => fila.push({ evento, pag: { id: c.id, customer: c.customer, subscription: c.subscription, value: c.value, status: c.status } });

  /* o Asaas andando no tempo: cobranca do proximo ciclo 10 dias antes, vencida depois do dia, cartao que cobra sozinho,
     cartao que vira "recebido" 30 dias depois */
  function asaasAnda() {
    const hoje = diaBR(Date.now());
    for (const a of assinaturas.values()) {
      if (a.deleted || a.status !== 'ACTIVE') continue;
      if (!a._ultimo) a._ultimo = a.nextDueDate;
      for (let volta = 0; volta < 3; volta++) {
        const prox = somarCiclo(a._ultimo, a.cycle);
        if (msDoDia(prox) - Date.now() > 10 * DIA) break;
        a._ultimo = prox; a.nextDueDate = prox;
        const c = H.novaCobrancaDa(a);
        avisar('PAYMENT_CREATED', c);
      }
    }
    for (const c of cobrancas.values()) {
      if (c.deleted) continue;
      const a = assinaturas.get(c.subscription);
      if ((c.status === 'PENDING' || c.status === 'OVERDUE') && a && a.deleted) { c.deleted = true; continue; }
      if (c.status === 'PENDING' && a && a.billingType === 'CREDIT_CARD' && cartaoGuardado && c.dueDate <= hoje) {
        c.status = 'CONFIRMED'; c._pagoEm = Date.now(); pagamentosFeitos++; avisar('PAYMENT_CONFIRMED', c); continue;
      }
      if (c.status === 'PENDING' && c.dueDate < hoje) { c.status = 'OVERDUE'; avisar('PAYMENT_OVERDUE', c); }
      if (c.status === 'CONFIRMED' && c._pagoEm && Date.now() - c._pagoEm > 30 * DIA) { c.status = 'RECEIVED'; avisar('PAYMENT_RECEIVED', c); }
    }
  }
  async function entregar(item) {
    const r = await webhook(item.evento, item.pag);
    if (r.status !== 200) falha('aviso respondeu ' + r.status + ' (a fila do Asaas para para todo mundo)', item.evento + ' ' + JSON.stringify(await r.json().catch(() => ({}))), hist);
    entregues.push(item);
  }
  async function cron() {
    const tarefas = [];
    await worker.scheduled({}, Object.assign({}, env, { CARDAPIO: kv }), { waitUntil: (x) => tarefas.push(x) });
    await Promise.all(tarefas);
  }
  /* depois de cada passo: os creditos novos passam pelo oraculo (a mesma regra, escrita de novo, sem olhar o mensageiro) */
  function conferirCreditos(rotulo) {
    const c = conta();
    const pag = Array.isArray(c.pagamentos) ? c.pagamentos.map(String) : [];
    if (new Set(pag).size !== pag.length) falha('o mesmo pagamento contado duas vezes', JSON.stringify(pag), hist);
    for (const id of pag) {
      const cb = cobrancas.get(id);
      if (!cb) { falha('credito de cobranca que nao existe', id, hist); continue; }
      if (!doCliente(cb)) falha('credito de pagamento de OUTRA pessoa', id, hist);
      if (!PAGOS.includes(cb.status) && cb.status !== 'REFUNDED') falha('dias liberados sem pagamento (status ' + cb.status + ')', id, hist);
    }
    const novos = pag.filter((x) => creditadosAntes.indexOf(x) < 0);
    if (novos.length) {
      creditos += novos.length;
      if (novos.length > 1 || teveEstorno) oraculo.valido = false;
      else if (oraculo.valido) {
        const cb = cobrancas.get(novos[0]);
        const p = c.plano || {};
        const anual = Number(cb.value) >= 300;
        const agora = Date.now();
        const anterior = oraculo.pagoAte;
        const noPrazo = anterior > 0 && (msDoDia(diaBR(agora)) - msDoDia(diaBR(anterior))) / DIA <= 10;
        const base = noPrazo ? Math.max(anterior, fimGratis) : Math.max(agora, anterior, fimGratis);
        const real = RealDate.parse(p.pagoAte || '') || 0;
        const dias = (real - base) / DIA;
        const [min, max] = anual ? [364.5, 366.6] : [27.5, 31.6];
        if (!(dias >= min && dias <= max)) falha('dias do pagamento errados (' + (anual ? 'anual' : 'mensal') + ')', 'esperado de ' + new RealDate(base).toISOString() + ' + periodo; ficou ' + p.pagoAte + ' (' + dias.toFixed(2) + ' dias)', hist);
        if (p.status !== 'ativo') falha('pagou e a conta nao ficou ativa', p.status, hist);
        oraculo.pagoAte = real;
      }
      const loja = db.get('lojas/loja-' + s) || {};
      if ((loja.plano || {}).pagoAte !== (c.plano || {}).pagoAte) falha('a copia na loja ficou diferente da conta', (loja.plano || {}).pagoAte + ' x ' + (c.plano || {}).pagoAte, hist);
    }
    creditadosAntes = pag;
    /* nunca duas assinaturas vivas do mesmo dono (cobraria em dobro todo mes) */
    const vivas = [...assinaturas.values()].filter((a) => !a.deleted && a.status === 'ACTIVE' && clientes.get(a.customer) && clientes.get(a.customer).email === email);
    if (vivas.length > 1) falha('duas assinaturas vivas (cobranca em dobro)', vivas.map((a) => a.id + ' ' + a.billingType + ' ' + a.cycle).join(', ') + ' depois de ' + rotulo, hist);
  }

  const passosDaSeq = 12 + Math.floor(rnd() * 30);
  for (let k = 0; k < passosDaSeq; k++) {
    passos++;
    deslocado += 60 * 1000; /* um minuto entre um toque e outro */
    const acao = escolher(['pagar', 'pagar', 'pagar', 'pix', 'pix', 'pix', 'pixVelho', 'jaPaguei', 'aviso', 'aviso', 'aviso', 'avisoForaDeOrdem', 'avisoRepetido', 'avisoPerdido', 'cron', 'tempo', 'tempo', 'tempoLongo', 'estorno']);
    hist.push(diaBR(Date.now()) + ' ' + acao);
    try {
      if (acao === 'pagar') {
        const forma = rnd() < 0.75 ? 'pix' : 'cartao';
        const tipo = rnd() < 0.8 ? 'mensal' : 'anual';
        let r = await pedir('pagar', tk, { forma, tipo });
        if (r.j && r.j.precisaDocumento) r = await pedir('pagar', tk, { forma, tipo, documento: '52998224725' });
        hist[hist.length - 1] += ' ' + forma + '/' + tipo + ' -> ' + r.status + ' ' + JSON.stringify(r.j).slice(0, 120);
        if (r.status >= 500) falha('Pagar deu erro ' + r.status, JSON.stringify(r.j), hist);
        if (r.j && r.j.cobranca) {
          const cb = cobrancas.get(r.j.cobranca);
          if (!cb || cb.deleted || !(cb.status === 'PENDING' || cb.status === 'OVERDUE')) falha('Pagar mostrou cobranca que nao da para pagar', JSON.stringify(cb), hist);
          else if (!doCliente(cb)) falha('Pagar mostrou cobranca de OUTRA pessoa', r.j.cobranca, hist);
          /* pediu para pagar um periodo que ja esta pago (o dono pagaria duas vezes) */
          const pagaNaoEntrou = [...cobrancas.values()].filter((x) => doCliente(x) && PAGOS.includes(x.status) && (conta().pagamentos || []).indexOf(x.id) < 0);
          if (cb && pagaNaoEntrou.some((x) => Math.abs(msDoDia(x.dueDate) - msDoDia(cb.dueDate)) < 20 * DIA)) falha('Pagar pediu de novo um mes que ja foi pago (aviso atrasado)', 'pago ' + pagaNaoEntrou.map((x) => x.id + ' vence ' + x.dueDate).join(',') + ' | mostrou ' + cb.id + ' vence ' + cb.dueDate, hist);
          const pa = RealDate.parse((conta().plano || {}).pagoAte || '') || 0;
          if (cb && pa > Date.now() && msDoDia(cb.dueDate) < pa - 3 * DIA) falha('AVISO (sem perda de dinheiro): Pagar mostra a proxima mensalidade antes de acabar o que ja esta pago', 'pagoAte ' + new RealDate(pa).toISOString() + ' | cobranca vence ' + cb.dueDate, hist);
          if (cb) { tela = cb; mostradas.push(cb.id); }
          if (forma === 'pix' && !(r.j.pix && r.j.pix.codigo) && cb && cb.billingType !== 'CREDIT_CARD') falha('Pagar pelo Pix sem o codigo do Pix', JSON.stringify(r.j), hist);
        } else if (r.j && (r.j.emDia || r.j.pago)) tela = null;
      } else if (acao === 'pix' || acao === 'pixVelho') {
        const id = acao === 'pix' ? (tela && tela.id) : escolher(mostradas.length ? mostradas : ['-']);
        const cb = cobrancas.get(id);
        /* o banco so aceita pagar o que esta em aberto (Pix de cobranca apagada e recusado) */
        if (cb && !cb.deleted && (cb.status === 'PENDING' || cb.status === 'OVERDUE')) {
          const cartao = cb.billingType === 'CREDIT_CARD';
          cb.status = cartao ? 'CONFIRMED' : 'RECEIVED'; cb._pagoEm = Date.now(); pagamentosFeitos++;
          if (cartao) cartaoGuardado = true;
          avisar(cartao ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECEIVED', cb);
          hist[hist.length - 1] += ' pagou ' + cb.id + ' (' + cb.value + ', vence ' + cb.dueDate + ')';
        } else hist[hist.length - 1] += ' (nada para pagar)';
      } else if (acao === 'jaPaguei') {
        if (tela) { const r = await pedir('conferir', tk, { cobranca: tela.id }); hist[hist.length - 1] += ' -> ' + JSON.stringify(r.j).slice(0, 90); if (r.status >= 500) falha('Ja paguei deu erro ' + r.status, JSON.stringify(r.j), hist); }
      } else if (acao === 'aviso') { if (fila.length) await entregar(fila.shift()); }
      else if (acao === 'avisoForaDeOrdem') { if (fila.length) await entregar(fila.splice(Math.floor(rnd() * fila.length), 1)[0]); }
      else if (acao === 'avisoRepetido') { if (entregues.length) await entregar(escolher(entregues)); }
      else if (acao === 'avisoPerdido') { if (fila.length && rnd() < 0.5) hist[hist.length - 1] += ' perdeu ' + JSON.stringify(fila.splice(Math.floor(rnd() * fila.length), 1)[0].evento); }
      else if (acao === 'cron') await cron();
      else if (acao === 'tempo') { deslocado += Math.floor(1 + rnd() * 6) * DIA; asaasAnda(); }
      else if (acao === 'tempoLongo') { deslocado += Math.floor(10 + rnd() * 25) * DIA; asaasAnda(); }
      else if (acao === 'estorno' && rnd() < 0.15) {
        const pagas = [...cobrancas.values()].filter((x) => doCliente(x) && PAGOS.includes(x.status));
        if (pagas.length) { const cb = escolher(pagas); cb.status = 'REFUNDED'; teveEstorno = true; avisar('PAYMENT_REFUNDED', cb); hist[hist.length - 1] += ' devolveu ' + cb.id; }
      }
    } catch (e) {
      falha('excecao no passo ' + acao, String(e && e.stack || e).slice(0, 300), hist);
    }
    conferirCreditos(acao);
  }

  /* fim: tudo o que estava pendente chega, a conferencia roda, e o dono toca "Ja paguei". Pagamento que ainda nao entrou
     vai sendo procurado com o tempo andando ate perto do fim dos dias (e o que a loja sente) */
  try {
    while (fila.length) await entregar(fila.shift());
    conferirCreditos('fim: avisos');
    if (tela) await pedir('conferir', tk, { cobranca: tela.id });
    await cron();
    conferirCreditos('fim: cron');
    let faltam = () => [...cobrancas.values()].filter((x) => doCliente(x) && PAGOS.includes(x.status) && (conta().pagamentos || []).indexOf(x.id) < 0);
    if (faltam().length) {
      /* a loja ainda esta no ar? (pago e bloqueado e o pior caso) */
      const p = conta().plano || {};
      const pa = RealDate.parse(p.pagoAte || '') || 0;
      const bloqueada = Math.max(pa, fimGratis) + 10 * DIA < Date.now();
      if (bloqueada) falha('PAGOU E A LOJA FICOU BLOQUEADA (pagamento nao entrou nem com aviso, Ja paguei e conferencia)', faltam().map((x) => x.id + ' ' + x.status + ' vence ' + x.dueDate + ' assinatura ' + x.subscription + (assinaturas.get(x.subscription) && assinaturas.get(x.subscription).deleted ? ' (APAGADA)' : '')).join('; ') + ' | conta: assinatura ' + conta().assinaturaAsaas + ' pendente ' + conta().assinaturaPendente + ' antigas ' + JSON.stringify(conta().assinaturasAntigas || []), hist);
      for (let v = 0; v < 6 && faltam().length; v++) { deslocado += 5 * DIA; asaasAnda(); while (fila.length) await entregar(fila.shift()); await cron(); }
      conferirCreditos('fim: dias depois');
      if (faltam().length) falha('pagamento perdido para sempre (nem a conferencia de todo dia achou)', faltam().map((x) => x.id + ' ' + x.status + ' vence ' + x.dueDate + ' assinatura ' + x.subscription + (assinaturas.get(x.subscription) && assinaturas.get(x.subscription).deleted ? ' (APAGADA)' : '')).join('; ') + ' | conta: assinatura ' + conta().assinaturaAsaas + ' pendente ' + conta().assinaturaPendente, hist);
      else recuperadosTarde++;
    }
  } catch (e) { falha('excecao no fim', String(e && e.stack || e).slice(0, 300), hist); }
  if (s % 250 === 249) escrever('  ... ' + (s + 1) + ' sequencias, ' + passos + ' passos, ' + pagamentosFeitos + ' pagamentos, ' + Object.keys(falhas).length + ' tipos de falha');
}

escrever('\nSEQUENCIAS: ' + seqs + ' | PASSOS: ' + passos + ' | PAGAMENTOS FEITOS: ' + pagamentosFeitos + ' | CREDITOS: ' + creditos + ' | achados so dias depois (aviso perdido, loja ainda no ar): ' + recuperadosTarde);
const tipos = Object.keys(falhas);
if (!tipos.length) escrever('NENHUMA REGRA QUEBRADA');
for (const t of tipos) {
  escrever('\nFALHA (' + falhas[t].n + 'x): ' + t + '\n  ' + falhas[t].exemplo.detalhe);
  escrever('  passos: \n    ' + falhas[t].exemplo.hist.join('\n    '));
  escrever('  log: ' + falhas[t].exemplo.log.slice(-6).join(' | ').slice(0, 900));
}
if (tipos.some((t) => t.indexOf('AVISO') !== 0)) process.exit(1);
