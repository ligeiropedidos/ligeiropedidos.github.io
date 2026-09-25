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
 *        FUNDADOR_VAGAS   (opcional, padrao 5) quantas vagas de fundador existem; FUNDADOR_JA (opcional, padrao 0)
 *                         quantas ja estavam ocupadas fora da contagem publica (igual ao config.js: fundador.vagas e jaOcupadas)
 *   2b. Settings > Bindings > Add binding > KV namespace: Variable name CARDAPIO, namespace ligeiro-cardapio
 *      (o mesmo do ligeiro-mp). Com ele, a loja destrava para o cliente na hora em que o pagamento cai.
 *   3. No Asaas: Integracoes > Webhooks > Adicionar: URL do worker, token = ASAAS_WEBHOOK,
 *      eventos PAYMENT_CONFIRMED e PAYMENT_RECEIVED, e tambem os de estorno e contestacao: PAYMENT_REFUNDED,
 *      PAYMENT_REFUND_IN_PROGRESS, PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_CHARGEBACK_DISPUTE e
 *      PAYMENT_AWAITING_CHARGEBACK_REVERSAL (a conta fica pausada ate o admin olhar). Fila sincrona, versao 3.
 *      E os da fatura do mes: PAYMENT_CREATED, PAYMENT_UPDATED, PAYMENT_OVERDUE, PAYMENT_DELETED e PAYMENT_RESTORED
 *      (o painel da loja mostra "sua mensalidade vence dia X" com o botao da fatura: sem os avisos pagos do Asaas).
 *   3b. Lembrete por e-mail (gratis, pelo Gmail do Ligeiro, ate 100 por dia): cole ferramentas/lembrete-email.gs num
 *      projeto novo do Google Apps Script na conta do Ligeiro (instrucoes no proprio arquivo) e ponha aqui, como Secret,
 *      EMAIL_URL (o endereco do app da Web, .../exec) e EMAIL_TOKEN (a mesma senha das Propriedades do script).
 *      Em Settings > Trigger events > Cron triggers: "0 12 * * *" (todo dia as 9 h de Brasilia).
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
    if (!env.ASAAS_WEBHOOK || !igual(token, env.ASAAS_WEBHOOK)) return json({ ok: false, erro: 'token' }, 401);

    let corpo;
    try { corpo = await request.json(); } catch (_) { return json({ ok: false, erro: 'json' }, 400); }
    const evento = corpo.event || '';
    const pag = corpo.payment || {};
    /* so pagamento confirmado, estorno, contestacao e a fatura do mes interessam; o resto responde 200 pra fila do Asaas nao travar */
    if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].concat(EVENTOS_DE_ESTORNO, EVENTOS_DE_FATURA).indexOf(evento) < 0) return json({ ok: true, ignorado: evento });
    if (!pag.id || !pag.customer) return json({ ok: false, erro: 'sem pagamento' }, 400);

    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(pag.id)) || !/^[A-Za-z0-9_-]{1,80}$/.test(String(pag.customer))) return json({ ok: false, erro: 'sem pagamento' }, 400);
    if (EVENTOS_DE_ESTORNO.indexOf(evento) >= 0) {
      try { return await pausarPorEstorno(env, pag); } catch (e) { console.error('asaas estorno', e && e.message || e); return json({ ok: false, erro: 'falhou, o Asaas tenta de novo' }, 500); }
    }
    if (EVENTOS_DE_FATURA.indexOf(evento) >= 0) {
      try { return await anotarFatura(env, pag, evento); } catch (e) { console.error('asaas fatura', e && e.message || e); return json({ ok: false, erro: 'falhou, o Asaas tenta de novo' }, 500); }
    }

    try {
      /* o aviso diz o que foi pago, mas quem manda e o Asaas: le a cobranca de novo pela chave da API (valor, cliente e
         situacao de verdade). Um aviso inventado, mesmo com o token vazado, nao libera dia nenhum */
      /* cobranca que o Asaas nao conhece: responde ok (erro repetido faz o Asaas pausar a fila de avisos inteira) */
      const real = await asaas(env, '/payments/' + encodeURIComponent(pag.id)).catch((e) => { if (e && e.status === 404) return null; throw e; });
      if (!real) return json({ ok: true, ignorado: 'cobranca desconhecida' });
      if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].indexOf(String(real.status || '')) < 0) return json({ ok: true, ignorado: 'status ' + String(real.status || '') });
      Object.assign(pag, { value: real.value, customer: real.customer, description: real.description, externalReference: real.externalReference, subscription: real.subscription, billingType: real.billingType });
      if (!pag.customer) return json({ ok: false, erro: 'sem pagamento' }, 400);
      const cliente = await asaas(env, '/customers/' + encodeURIComponent(pag.customer));
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
      /* Quantos dias o pagamento vale. Preco cheio: o periodo inteiro. Preco de fundador: so para quem ja e fundador ou
         enquanto houver vaga (conferida aqui, no servidor, na hora do pagamento; o site nao decide). Sem vaga, ou valor
         que nao bate com nenhum plano: dias proporcionais ao que entrou, e o painel mostra a diferenca */
      const planosPreco = lerPlanos(env)[plano.id] || {};
      const cheio = Number(planosPreco[plano.tipo]) || 0;
      let dias = plano.tipo === 'anual' ? 365 : 30;
      let fundador = p.fundador === true;
      let parcial = null;
      if (plano.preco === 'fundador' && !fundador) {
        const pub = (await fb.get('publico/fundadores')) || {};
        const usados = Number(pub.usados) || 0;
        const total = Number(env.FUNDADOR_VAGAS || 5), ja = Number(env.FUNDADOR_JA || 0);
        /* so perde a chance quem ja pagou alguma vez sem ser fundador (a mesma regra do site) */
        if (!p.ultimoPagamentoEm && usados + ja < total) {
          fundador = true;
          await fb.merge('publico/fundadores', { usados: usados + 1, atualizadoEm: new Date().toISOString() });
        } else if (cheio > 0) {
          parcial = { cobrado: centavos, cheio: cheio, motivo: 'fundador-sem-vaga' };
        }
      } else if (!plano.preco && cheio > 0 && centavos < cheio) {
        parcial = { cobrado: centavos, cheio: cheio, motivo: 'valor-diferente' };
      }
      if (parcial) dias = Math.max(0, Math.floor((dias * parcial.cobrado) / parcial.cheio));
      const pagoAte = new Date(base + dias * 864e5).toISOString();
      const novoPlano = Object.assign({}, p, {
        status: 'ativo', tipo: plano.tipo, planoId: p.planoId || plano.id, planoPago: plano.id, pagoAte: pagoAte,
        avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString(), cobrancaAsaas: pag.id,
        fundador: fundador,
        /* pago a menos: guarda o que entrou e o que faltava (a Central e o painel mostram; ninguem ganha o mes inteiro) */
        pagamentoParcial: parcial ? Object.assign({ em: new Date().toISOString(), dias: dias }, parcial) : null,
      });
      const pagamentos = ((conta && conta.pagamentos) || []).concat([pag.id]).slice(-50);
      const gravar = { email: email, plano: novoPlano, pagamentos: pagamentos, atualizadoEm: new Date().toISOString() };
      /* a fatura que estava em aberto e esta: sai do painel */
      if (conta && conta.faturaAsaas && conta.faturaAsaas.id === pag.id) gravar.faturaAsaas = null;
      if (pag.subscription && /^[A-Za-z0-9_-]{1,80}$/.test(String(pag.subscription))) gravar.assinaturaAsaas = String(pag.subscription);
      await fb.merge('contas/' + encodeURIComponent(email), gravar);

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
      /* o detalhe fica no log do Cloudflare; a resposta nao conta nada de dentro */
      console.error('asaas', e && e.message || e);
      return json({ ok: false, erro: 'falhou, o Asaas tenta de novo' }, 500);
    }
  },
  /* todo dia (Cron trigger): os lembretes por e-mail da fatura do mes */
  async scheduled(evento, env, ctx) {
    const tarefa = lembrarFaturas(env).then((r) => console.log('lembretes', JSON.stringify(r))).catch((e) => console.error('lembretes', e && e.message || e));
    if (ctx && ctx.waitUntil) ctx.waitUntil(tarefa); else await tarefa;
  },
};

/* ---------------- lembrete por e-mail da fatura do mes (gratis, pelo Gmail do Ligeiro) ----------------
   Uma vez por dia, olha as contas com fatura em aberto e manda, uma vez cada: "vence em 3 dias" e "vence hoje" (Pix e
   boleto; o cartao e cobrado sozinho), "venceu" e, 7 dias depois, "pode parar" (qualquer forma: no cartao, e porque nao
   passou). O que ja foi mandado fica em faturaAsaas.lembretes (fatura nova, lista nova) */
function diaDeBrasilia(agora) { return new Date((agora || new Date()).getTime() - 3 * 36e5).toISOString().slice(0, 10); }
function diasAte(hoje, dia) { return Math.round((Date.parse(dia + 'T00:00:00Z') - Date.parse(hoje + 'T00:00:00Z')) / 864e5); }
async function lembrarFaturas(env, agora) {
  if (!env.EMAIL_URL || !env.EMAIL_TOKEN || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(env.EMAIL_URL).trim())) return { ok: false, motivo: 'sem EMAIL_URL ou EMAIL_TOKEN' };
  const fb = await firebase(env);
  const contas = await fb.consultarEm('contas', 'faturaAsaas.status', ['PENDING', 'OVERDUE']);
  const hoje = diaDeBrasilia(agora);
  let enviados = 0, falhas = 0;
  for (const c of contas) {
    const f = c.faturaAsaas;
    const email = String(c._id || '').toLowerCase();
    if (!f || !f.url || !/^\d{4}-\d{2}-\d{2}$/.test(String(f.vencimento || '')) || email.indexOf('@') < 1) continue;
    const pl = c.plano || {};
    if (pl.status === 'cancelado' || pl.status === 'pausado') continue;
    const dias = diasAte(hoje, f.vencimento);
    const vencida = f.status === 'OVERDUE' || dias < 0;
    const cartao = f.forma === 'CREDIT_CARD';
    let qual = '';
    if (vencida) qual = dias <= -7 ? 'vencida7' : 'vencida';
    else if (!cartao && dias === 3) qual = 'd3';
    else if (!cartao && dias === 0) qual = 'd0';
    if (!qual) continue;
    const ja = Array.isArray(f.lembretes) ? f.lembretes : [];
    if (ja.indexOf(qual) >= 0 || (qual === 'vencida' && ja.indexOf('vencida7') >= 0)) continue;
    const ok = await mandarEmail(env, email, mensagemDoLembrete(qual, f, cartao));
    if (!ok) { falhas++; continue; }
    await fb.merge('contas/' + encodeURIComponent(email), { faturaAsaas: Object.assign({}, f, { lembretes: ja.concat([qual]) }) });
    enviados++;
  }
  return { ok: true, contas: contas.length, enviados: enviados, falhas: falhas };
}
function mensagemDoLembrete(qual, f, cartao) {
  const valor = 'R$ ' + (Math.round(Number(f.valor) || 0) / 100).toFixed(2).replace('.', ',');
  const p = f.vencimento.split('-');
  const dia = p[2] + '/' + p[1];
  const m = {
    d3: ['Sua mensalidade do Ligeiro vence em 3 dias', 'A mensalidade do Ligeiro, de ' + valor + ', vence em 3 dias (' + dia + '). Pague pela fatura, no Pix, no boleto ou no cartão.'],
    d0: ['Sua mensalidade do Ligeiro vence hoje', 'A mensalidade do Ligeiro, de ' + valor + ', vence hoje (' + dia + '). Pague pela fatura, no Pix, no boleto ou no cartão.'],
    vencida: ['Sua mensalidade do Ligeiro venceu', (cartao ? 'A cobrança no cartão não passou. ' : '') + 'A mensalidade do Ligeiro, de ' + valor + ', venceu em ' + dia + '. Suas lojas seguem no ar por mais alguns dias: pague pela fatura para não parar.'],
    vencida7: ['Suas lojas podem parar de receber pedidos', (cartao ? 'A cobrança no cartão não passou. ' : '') + 'A mensalidade do Ligeiro, de ' + valor + ', venceu em ' + dia + ' e ainda não foi paga. Pague pela fatura para suas lojas não pararem de receber pedidos.'],
  }[qual];
  const fecho = 'Assim que o pagamento cai, tudo segue sozinho. Qualquer dúvida, é só responder este e-mail.';
  const texto = 'Olá!\n\n' + m[1] + '\n\nPagar a fatura: ' + f.url + '\n\n' + fecho + '\n\nLigeiro\nligeiropedidos.com.br';
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1F2937">'
    + '<div style="background:#0F3D2E;padding:16px 24px;border-radius:12px 12px 0 0"><b style="color:#fff;font-size:22px">Ligei<span style="color:#A3E635">ro</span></b></div>'
    + '<div style="border:1px solid #E5E7EB;border-top:0;border-radius:0 0 12px 12px;padding:24px">'
    + '<p style="margin:0 0 16px;font-size:16px;line-height:1.5">Olá!</p>'
    + '<p style="margin:0 0 24px;font-size:16px;line-height:1.5">' + m[1] + '</p>'
    + '<p style="margin:0 0 24px;text-align:center"><a href="' + f.url + '" style="display:inline-block;background:#84CC16;color:#0F3D2E;font-weight:bold;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:12px">Pagar a fatura</a></p>'
    + '<p style="margin:0;font-size:14px;line-height:1.5;color:#6B7280">' + fecho + '</p>'
    + '</div><p style="text-align:center;font-size:12px;color:#9CA3AF;margin:16px 0 0">Ligeiro · ligeiropedidos.com.br</p></div>';
  return { assunto: m[0], texto: texto, html: html };
}
async function mandarEmail(env, para, m) {
  const r = await fetch(String(env.EMAIL_URL).trim(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: String(env.EMAIL_TOKEN).trim(), para: para, assunto: m.assunto, texto: m.texto, html: m.html }) });
  const j = await r.json().catch(() => ({}));
  /* no registro, o e-mail sai escondido (so a primeira letra) */
  if (!j.ok) console.error('email', String(para).replace(/^(.).*@/, '$1***@'), j.erro || r.status);
  return !!j.ok;
}

/* Estorno ou contestacao (chargeback) de uma cobranca que ja liberou dias: a conta fica pausada ate o admin olhar na
   Central (o dono nao tira a pausa sozinho; as regras do banco nao deixam). Antes, o plano seguia pago o ano inteiro
   com o dinheiro devolvido. Quem manda e o Asaas: a cobranca e lida de novo pela chave da API */
const EVENTOS_DE_ESTORNO = ['PAYMENT_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'];
async function pausarPorEstorno(env, pag) {
  const real = await asaas(env, '/payments/' + encodeURIComponent(pag.id)).catch((e) => { if (e && e.status === 404) return null; throw e; });
  if (!real) return json({ ok: true, ignorado: 'cobranca desconhecida' });
  const st = String(real.status || '');
  if (['REFUNDED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'].indexOf(st) < 0) return json({ ok: true, ignorado: 'status ' + st });
  const cliente = await asaas(env, '/customers/' + encodeURIComponent(real.customer || pag.customer));
  const email = String(cliente.email || '').trim().toLowerCase();
  if (!email) return json({ ok: false, erro: 'cliente sem e-mail' }, 200);
  const fb = await firebase(env);
  const conta = await fb.get('contas/' + encodeURIComponent(email));
  /* so cobranca que liberou dias (esta nos pagamentos da conta) pausa alguma coisa */
  if (!conta || !Array.isArray(conta.pagamentos) || conta.pagamentos.indexOf(pag.id) < 0) return json({ ok: true, ignorado: 'cobranca que nao liberou dias' });
  const estornos = Array.isArray(conta.estornos) ? conta.estornos : [];
  if (estornos.some((x) => x && x.id === pag.id)) return json({ ok: true, repetido: pag.id });
  const agora = new Date().toISOString();
  const p = conta.plano || {};
  await fb.merge('contas/' + encodeURIComponent(email), {
    plano: Object.assign({}, p, { status: 'pausado', pausadoEm: agora, motivoPausa: 'estorno' }),
    estornos: estornos.concat([{ id: pag.id, status: st, em: agora }]).slice(-20), atualizadoEm: agora,
  });
  const espelho = { status: 'pausado', tipo: p.tipo || 'mensal', planoId: p.planoId || 'uma', planoPago: p.planoPago || '', desde: p.desde || agora, pagoAte: p.pagoAte || '', avisoPagamentoEm: '', avisoValor: 0 };
  const lojas = await fb.query('lojas', 'donoEmail', email);
  for (const slug of lojas) {
    await fb.merge('lojas/' + slug, { plano: espelho, atualizadoEm: agora });
    await fb.merge('vitrine/' + slug, { plano: espelho, atualizadoEm: agora });
    if (env.CARDAPIO) await env.CARDAPIO.delete('loja:' + slug).catch(() => {});
  }
  if (env.CARDAPIO && lojas.length) await env.CARDAPIO.delete('vitrine').catch(() => {});
  return json({ ok: true, pausada: email, lojas: lojas.length });
}

/* Fatura do mes da assinatura (Pix ou boleto): o painel da loja avisa "vence dia X" com o botao da fatura, entao os
   avisos do Asaas (R$ 0,99 por cobranca) podem ficar desligados. Guarda so a fatura em aberto que vence primeiro;
   paga, removida ou cancelada, sai. Quem manda e o Asaas: a cobranca e lida de novo pela chave da API */
const EVENTOS_DE_FATURA = ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_RESTORED'];
async function anotarFatura(env, pag, evento) {
  const real = await asaas(env, '/payments/' + encodeURIComponent(pag.id)).catch((e) => { if (e && e.status === 404) return null; throw e; });
  if (!real) return json({ ok: true, ignorado: 'cobranca desconhecida' });
  /* so a cobranca de assinatura (a dos links do Ligeiro); cobranca avulsa nao e mensalidade */
  if (!real.subscription) return json({ ok: true, ignorado: 'cobranca avulsa' });
  const cliente = await asaas(env, '/customers/' + encodeURIComponent(real.customer || pag.customer));
  const email = String(cliente.email || '').trim().toLowerCase();
  if (!email) return json({ ok: true, ignorado: 'cliente sem e-mail' });
  const fb = await firebase(env);
  const caminho = 'contas/' + encodeURIComponent(email);
  const conta = await fb.get(caminho);
  if (!conta) return json({ ok: true, ignorado: 'sem conta no Ligeiro' });
  const st = String(real.status || '');
  const aberta = (st === 'PENDING' || st === 'OVERDUE') && real.deleted !== true && evento !== 'PAYMENT_DELETED';
  const atual = conta.faturaAsaas && conta.faturaAsaas.id ? conta.faturaAsaas : null;
  const agora = new Date().toISOString();
  if (!aberta) {
    if (atual && atual.id === real.id) await fb.merge(caminho, { faturaAsaas: null, atualizadoEm: agora });
    return json({ ok: true, fatura: 'fechada' });
  }
  const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(String(real.dueDate || '')) ? String(real.dueDate) : '';
  /* outra fatura ainda aberta que vence antes (ou ja venceu) continua sendo a do painel */
  if (atual && atual.id !== real.id && atual.vencimento && vencimento && atual.vencimento <= vencimento) return json({ ok: true, fatura: 'mantida' });
  /* endereco da fatura so do Asaas (o painel abre este link) */
  const url = /^https:\/\/(www\.)?asaas\.com\/[A-Za-z0-9/_-]{1,200}$/.test(String(real.invoiceUrl || '')) ? String(real.invoiceUrl) : '';
  const fatura = {
    id: String(real.id), valor: Math.round(Number(real.value || 0) * 100), vencimento: vencimento, url: url,
    status: st, forma: String(real.billingType || '').slice(0, 20), assinatura: String(real.subscription).slice(0, 80), em: agora,
  };
  await fb.merge(caminho, { faturaAsaas: fatura, assinaturaAsaas: fatura.assinatura, atualizadoEm: agora });
  return json({ ok: true, fatura: fatura.status, vencimento: vencimento });
}

/* compara o token sem parar na primeira letra diferente (ninguem descobre o token pelo tempo da resposta) */
function igual(a, b) {
  a = String(a); b = String(b);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return dif === 0;
}

function lerPlanos(env) { try { return JSON.parse(env.PLANOS || '{}') || {}; } catch (_) { return {}; } }
/* Qual plano foi pago: pelo valor (bate com PLANOS) ou, se nao bater, pelo texto da cobranca (e ai vale proporcional).
   preco: 'cheio', 'fundador' ou '' (valor que nao bate com nenhum plano) */
function descobrirPlano(env, centavos, pag) {
  const planos = lerPlanos(env);
  /* fm e fa: o preco de fundador (mensal e anual) do mesmo plano */
  for (const id of Object.keys(planos)) {
    for (const [campo, tipo, preco] of [['mensal', 'mensal', 'cheio'], ['anual', 'anual', 'cheio'], ['fm', 'mensal', 'fundador'], ['fa', 'anual', 'fundador']]) {
      if (Number(planos[id][campo]) === centavos) return { id: id, tipo: tipo, preco: preco };
    }
  }
  const texto = String((pag.description || '') + ' ' + (pag.externalReference || '')).toLowerCase();
  const id = Object.keys(planos).filter((k) => texto.indexOf(k) >= 0)[0] || 'uma';
  const tipo = texto.indexOf('anual') >= 0 || (pag.subscription && String(pag.billingType || '').length && centavos >= Number((planos[id] || {}).anual || 1e12)) ? 'anual' : 'mensal';
  return { id: id, tipo: tipo, preco: '' };
}

/* o Asaas exige o User-Agent nas contas novas (sem ele, responde 400 a tudo; o fetch da Cloudflare nao manda nenhum).
   O motivo que o Asaas der vai para o registro do Cloudflare (nunca para a resposta): o proximo erro se le de primeira */
async function asaas(env, caminho) {
  const r = await fetch('https://api.asaas.com/v3' + caminho, { headers: { access_token: String(env.ASAAS_KEY || '').trim(), accept: 'application/json', 'User-Agent': 'Ligeiro/1.0 (ligeiropedidos.com.br)' } });
  if (!r.ok) {
    const motivo = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const e = new Error('Asaas ' + r.status + ' em ' + caminho + (motivo ? ': ' + motivo : '')); e.status = r.status; throw e;
  }
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
    /* documentos inteiros (com _id) em que o campo e um dos valores: 1 leitura por documento achado */
    async consultarEm(colecao, campo, valores) {
      const q = { structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'IN', value: { arrayValue: { values: valores.map((v) => ({ stringValue: v })) } } } }, limit: 500 } };
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: cab, body: JSON.stringify(q) });
      if (!r.ok) throw new Error('Firestore query ' + r.status);
      const linhas = await r.json();
      return linhas.filter((l) => l.document).map((l) => Object.assign(deFirestore(l.document.fields || {}), { _id: decodeURIComponent(l.document.name.split('/').pop()) }));
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
