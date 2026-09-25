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
 *        PLANOS           JSON com os precos em centavos, igual ao config.js (um plano so, 1 loja por conta):
 *                         {"uma":{"mensal":8900,"anual":89000,"fm":7900,"fa":79000}}
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
 *
 * Um plano so (25/09/2026): 1 loja por conta, mensal ou anual. Outra loja = outra conta (outro e-mail), com a propria
 * assinatura. O dono logado chama, pelo site (nada novo para configurar):
 *   POST /plano/simular  {tipo}  diz o que vai acontecer (valor novo e a partir de quando), sem mexer em nada
 *   POST /plano/trocar   {tipo}  mensal <-> anual: a MESMA assinatura do Asaas muda de valor e ciclo, e vale na proxima fatura
 *   POST /plano/encerrar         cancela a assinatura no Asaas (nenhuma cobranca nova) e encerra a conta
 * Rede de seguranca: uma assinatura so por conta (a nova paga cancela a velha, mas nunca toma o lugar de uma viva com dias
 * pagos pela frente: ai o admin recebe e-mail); cobranca de assinatura de conta encerrada e devolvida sozinha; pagamento
 * com e-mail sem conta no Ligeiro nao cria conta e avisa o admin; cobranca avulsa fora do preco do plano nao vira dias;
 * pago dentro da tolerancia conta do vencimento (nao de hoje); estorno ou contestacao tira os dias daquele pagamento e
 * pausa a conta (e so a Central tira a pausa); encerrar tira o preco de fundador e para tambem a assinatura extra; link de
 * fundador sem vaga passa a assinatura para o preco normal; multa e juros nao mudam o plano (vale o valor original).
 */
export default {
  async fetch(request, env) {
    const caminhoPedido = new URL(request.url).pathname.replace(/\/+$/, '');
    if (caminhoPedido.indexOf('/plano/') === 0) return rotaDoDono(request, env, caminhoPedido);
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
      /* a conta mudou entre a leitura e a gravacao (o dono encerrou ou trocou, outro aviso, a vaga de fundador foi pega):
         nada foi gravado; le tudo de novo e refaz (no maximo 3 vezes; depois, o Asaas tenta de novo) */
      for (let vez = 0; ; vez++) {
        try { return await processarPagamento(env, pag); } catch (e) { if (e && e.conflito && vez < 3) continue; throw e; }
      }
    } catch (e) {
      /* o detalhe fica no log do Cloudflare; a resposta nao conta nada de dentro */
      console.error('asaas', e && e.message || e);
      return json({ ok: false, erro: 'falhou, o Asaas tenta de novo' }, 500);
    }
  },
  /* todo dia (Cron trigger): os lembretes por e-mail da fatura do mes */
  async scheduled(evento, env, ctx) {
    const tarefa = Promise.all([
      lembrarFaturas(env).then((r) => console.log('lembretes', JSON.stringify(r))).catch((e) => console.error('lembretes', e && e.message || e)),
      sincronizarEncerradas(env).then((r) => console.log('encerradas', JSON.stringify(r))).catch((e) => console.error('encerradas', e && e.message || e)),
    ]);
    if (ctx && ctx.waitUntil) ctx.waitUntil(tarefa); else await tarefa;
  },
};

/* Um pagamento confirmado: quantos dias ele vale e a gravacao na conta e nas lojas */
async function processarPagamento(env, pag) {
      /* o aviso diz o que foi pago, mas quem manda e o Asaas: le a cobranca de novo pela chave da API (valor, cliente e
         situacao de verdade). Um aviso inventado, mesmo com o token vazado, nao libera dia nenhum */
      /* cobranca que o Asaas nao conhece: responde ok (erro repetido faz o Asaas pausar a fila de avisos inteira) */
      const real = await asaas(env, '/payments/' + encodeURIComponent(pag.id)).catch((e) => { if (e && e.status === 404) return null; throw e; });
      if (!real) return json({ ok: true, ignorado: 'cobranca desconhecida' });
      if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].indexOf(String(real.status || '')) < 0) return json({ ok: true, ignorado: 'status ' + String(real.status || '') });
      Object.assign(pag, { value: real.value, originalValue: real.originalValue, customer: real.customer, description: real.description, externalReference: real.externalReference, subscription: real.subscription, billingType: real.billingType });
      if (!pag.customer) return json({ ok: false, erro: 'sem pagamento' }, 400);
      const cliente = await asaas(env, '/customers/' + encodeURIComponent(pag.customer));
      const email = String(cliente.email || '').trim().toLowerCase();
      if (!email) return json({ ok: false, erro: 'cliente sem e-mail' }, 200);

      /* multa e juros de atraso nao mudam o plano: vale o valor original da cobranca (o que entrou vai para o e-mail) */
      const centavos = Math.round(Number(pag.originalValue || pag.value || 0) * 100);
      const entrou = Math.round(Number(pag.value || 0) * 100);
      const plano = descobrirPlano(env, centavos);
      const fb = await firebase(env);
      const caminhoConta = 'contas/' + encodeURIComponent(email);
      const conta = await fb.get(caminhoConta, true);
      const p = (conta && conta.plano) || {};
      const jaFeito = Array.isArray(conta && conta.pagamentos) && conta.pagamentos.indexOf(pag.id) >= 0;
      /* aviso repetido: os dias ja entraram. Se da outra vez a copia nas lojas falhou no meio, grava de novo (e o plano
         de agora; repetir nao estraga nada) */
      if (jaFeito) { await espelharPlano(env, fb, email, p); return json({ ok: true, repetido: pag.id }); }
      /* e-mail que nao tem conta no Ligeiro (digitou outro no Asaas): antes nascia uma conta fantasma paga e a de verdade
         ficava travada. Agora nao cria nada e o admin recebe um e-mail para acertar na Central */
      if (!conta) {
        await avisarAdmin(env, 'Pagamento sem conta no Ligeiro', 'Entrou ' + reais(entrou) + ' do e-mail ' + email + ', que nao tem conta no Ligeiro. Ache o dono (Asaas > Clientes), corrija o e-mail do cliente no Asaas e confirme o pagamento na conta certa, na Central. Cobranca ' + pag.id + '.');
        return json({ ok: true, ignorado: 'sem conta no Ligeiro' });
      }
      const sub = pag.subscription && /^[A-Za-z0-9_-]{1,80}$/.test(String(pag.subscription)) ? String(pag.subscription) : '';
      /* cobranca avulsa (sem assinatura): so vale se for exatamente o preco do plano. Outra (a loja personalizada, por
         exemplo) nao vira dias de plano: o admin recebe e-mail e, se era mensalidade, confirma na Central */
      if (!sub && !plano.preco) {
        await avisarAdmin(env, 'Cobrança avulsa', 'Entrou ' + reais(entrou) + ' da conta ' + email + ' numa cobrança avulsa (' + pag.id + '), fora de uma assinatura. Ela não liberou dias de plano. Se era a mensalidade, confirme na Central.');
        return json({ ok: true, ignorado: 'cobranca avulsa' });
      }
      const antigas = Array.isArray(conta.assinaturasAntigas) ? conta.assinaturasAntigas : [];
      const extras = Array.isArray(conta.assinaturasExtras) ? conta.assinaturasExtras.map(String) : [];
      let subCancelada = '', subCanceladaApagada = false;
      /* conta encerrada e uma assinatura dela cobrou mesmo assim (a da conta, uma velha ou uma extra, que tambem e
         cancelada ao encerrar): devolve e cancela. Uma assinatura nova e reativacao, vale */
      if (p.status === 'cancelado' && sub && (sub === conta.assinaturaAsaas || antigas.indexOf(sub) >= 0 || extras.indexOf(sub) >= 0)) {
        const devolveu = await estornar(env, pag.id, 'Assinatura encerrada no Ligeiro');
        const apagou = await apagarAssinatura(env, sub);
        if (devolveu) {
          const volta = { pagamentos: (conta.pagamentos || []).concat([pag.id]).slice(-50), estornosAutomaticos: (conta.estornosAutomaticos || []).concat([{ id: pag.id, motivo: 'conta encerrada', em: new Date().toISOString() }]).slice(-20), atualizadoEm: new Date().toISOString() };
          /* so esquece a assinatura se o Asaas cancelou mesmo; senao o Cron de todo dia tenta de novo */
          if (apagou) {
            if (sub === conta.assinaturaAsaas) volta.assinaturaAsaas = '';
            volta.assinaturasAntigas = juntar(antigas, sub);
            if (extras.indexOf(sub) >= 0) volta.assinaturasExtras = extras.filter((x) => x !== sub);
          }
          await fb.merge(caminhoConta, volta);
          return json({ ok: true, devolvido: pag.id });
        }
        /* boleto nao tem estorno pela API: o dinheiro entrou, entao vale (a conta volta a ativa) e o admin fica sabendo */
        subCancelada = sub; subCanceladaApagada = apagou;
        await avisarAdmin(env, 'Pagamento depois de encerrar', 'A conta ' + email + ' estava encerrada e pagou ' + reais(entrou) + ' (cobranca ' + pag.id + '). Nao deu para devolver sozinho: a assinatura foi cancelada e os dias entraram. Veja com o cliente se ele quer continuar ou a devolucao.');
      }

      /* quem assina no periodo gratis nao perde os dias que faltam: os dias pagos contam depois do gratis (igual a Central
         ao confirmar um pagamento e igual ao R.assinatura do site, que usa o maior entre o pago e o fim do gratis) */
      const agoraMs = Date.now();
      const agoraIso = new Date(agoraMs).toISOString();
      const inicio = p.desde ? new Date(p.desde).getTime() : NaN;
      const fimGratis = isFinite(inicio) ? inicio + DIAS_GRATIS * 864e5 : 0;
      const pagoAteMs = p.pagoAte ? Date.parse(p.pagoAte) || 0 : 0;
      /* pagou dentro da tolerancia (a loja seguiu no ar depois de vencer): os dias contam do vencimento, e nao de hoje.
         Antes, cada atraso de 9 dias virava 9 dias de graca, todo mes. Conta encerrada, ou que ja passou da tolerancia
         (loja parada), conta de hoje */
      const noPrazo = pagoAteMs > 0 && p.status !== 'cancelado' && agoraMs - pagoAteMs <= DIAS_TOLERANCIA * 864e5;
      const base = noPrazo ? Math.max(pagoAteMs, fimGratis) : Math.max(agoraMs, pagoAteMs, fimGratis);
      /* Quantos dias o pagamento vale. Preco cheio: o periodo inteiro. Preco de fundador: so para quem ja e fundador ou
         enquanto houver vaga (conferida aqui, no servidor, na hora do pagamento; o site nao decide). Sem vaga, ou valor
         que nao bate com nenhum plano: dias proporcionais ao que entrou, e o painel mostra a diferenca */
      const planosPreco = lerPlanos(env)[plano.id] || {};
      const cheio = Number(planosPreco[plano.tipo]) || 0;
      let dias = plano.tipo === 'anual' ? 365 : 30;
      let fundador = p.fundador === true;
      let parcial = null;
      const escritas = [];
      if (plano.preco === 'fundador' && !fundador) {
        const pubDoc = await fb.get('publico/fundadores', true);
        const usados = Number((pubDoc || {}).usados) || 0;
        const total = Number(env.FUNDADOR_VAGAS || 5), ja = Number(env.FUNDADOR_JA || 0);
        /* so perde a chance quem ja pagou alguma vez sem ser fundador (a mesma regra do site) */
        if (!p.ultimoPagamentoEm && usados + ja < total) {
          fundador = true;
          /* dois pagamentos disputando a ultima vaga: so um grava (a trava e a hora da leitura do contador) */
          escritas.push({ caminho: 'publico/fundadores', campos: { usados: usados + 1, atualizadoEm: agoraIso }, versao: pubDoc ? pubDoc._versao : '', novo: !pubDoc });
        } else if (cheio > 0) {
          parcial = { cobrado: centavos, cheio: cheio, motivo: 'fundador-sem-vaga' };
        }
      } else if (!plano.preco && cheio > 0 && centavos < cheio) {
        parcial = { cobrado: centavos, cheio: cheio, motivo: 'valor-diferente' };
      }
      if (parcial) dias = Math.max(0, Math.floor((dias * parcial.cobrado) / parcial.cheio));
      const pagoAte = new Date(base + dias * 864e5).toISOString();
      /* Uma assinatura so por conta. Uma NOVA (o primeiro pagamento dela, pelo link) vira a da conta e a velha e cancelada.
         So nao toma o lugar de uma viva com dias pagos pela frente: alguem pode ter assinado com o e-mail do dono, e a do
         dono seria apagada. Ai os dias entram (o dinheiro entrou), a da conta fica e o admin confere qual cancelar */
      const atual = String(conta.assinaturaAsaas || '');
      const novaAssinatura = !!sub && !subCancelada && antigas.indexOf(sub) < 0 && sub !== atual;
      let adota = false;
      if (novaAssinatura) {
        let atualViva = false;
        if (atual && (Date.parse(p.pagoAte || '') || 0) > agoraMs + 864e5) {
          const a = await asaas(env, '/subscriptions/' + encodeURIComponent(atual)).catch((e) => { if (e && e.status === 404) return null; throw e; });
          atualViva = !!a && a.deleted !== true && String(a.status || 'ACTIVE') === 'ACTIVE';
        }
        adota = !atualViva;
      }
      /* conta pausada por estorno ou contestacao: o pagamento entra (os dias somam), mas a pausa so sai pela Central. Antes,
         qualquer pagamento (ate a proxima mensalidade do proprio cartao) tirava a pausa e a conta ficava com os dias do
         pagamento devolvido */
      const pausada = p.status === 'pausado';
      /* so os campos deste pagamento (uma troca mensal/anual no mesmo instante nao se perde) */
      const campos = {
        email: email, pagamentos: ((conta && conta.pagamentos) || []).concat([pag.id]).slice(-50), atualizadoEm: agoraIso,
        /* quantos dias cada pagamento deu: se ele for devolvido ou contestado, esses dias saem */
        creditos: (Array.isArray(conta.creditos) ? conta.creditos : []).concat([{ id: pag.id, dias: dias, assinatura: sub }]).slice(-24),
        'plano.status': pausada ? 'pausado' : 'ativo', 'plano.pagoAte': pagoAte, 'plano.planoId': PLANO, 'plano.planoPago': PLANO,
        'plano.avisoPagamentoEm': '', 'plano.avisoValor': 0, 'plano.ultimoPagamentoEm': agoraIso, 'plano.cobrancaAsaas': pag.id, 'plano.fundador': fundador,
        /* pago a menos: guarda o que entrou, o que faltava e quantos dias valeu (Minha conta mostra; ninguem ganha o periodo inteiro) */
        'plano.pagamentoParcial': parcial ? Object.assign({ em: agoraIso, dias: dias }, parcial) : null,
      };
      /* a assinatura nova traz a escolha de quem pagou pelo link (mensal ou anual) */
      if (!p.tipo || adota) campos['plano.tipo'] = plano.tipo;
      /* a fatura que estava em aberto e esta: sai do painel */
      if (conta.faturaAsaas && conta.faturaAsaas.id === pag.id) campos.faturaAsaas = null;
      if (subCancelada) {
        if (subCanceladaApagada) { campos.assinaturaAsaas = ''; campos.assinaturasAntigas = juntar(antigas, subCancelada); }
      } else if (adota) {
        let antigasNovas = antigas;
        if (atual) { await apagarAssinatura(env, atual); antigasNovas = juntar(antigasNovas, atual); }
        /* outra assinatura que so tinha fatura (nunca pagou): tambem sai, para nao virar cobranca em dobro depois */
        const pendente = conta.assinaturaPendente && conta.assinaturaPendente !== sub ? String(conta.assinaturaPendente) : '';
        if (pendente) { await apagarAssinatura(env, pendente); antigasNovas = juntar(antigasNovas, pendente); }
        if (antigasNovas !== antigas) campos.assinaturasAntigas = antigasNovas;
        campos.assinaturaAsaas = sub;
        if (conta.assinaturaPendente) campos.assinaturaPendente = '';
      } else if (novaAssinatura) {
        /* duas cobrando na mesma conta: o admin confere no Asaas (Assinaturas) e cancela uma */
        campos.assinaturasExtras = juntar(conta.assinaturasExtras, sub);
        if (conta.assinaturaPendente === sub) campos.assinaturaPendente = '';
        await avisarAdmin(env, 'Duas assinaturas na mesma conta', 'A conta ' + email + ' já tem a assinatura ' + atual + ' ativa e com dias pagos, e entrou ' + reais(centavos) + ' de outra (' + sub + ', cobrança ' + pag.id + '). Os dias entraram e a assinatura da conta continua a mesma. Veja no Asaas, em Assinaturas, qual cancelar: pode ter sido alguém usando o e-mail do dono no link.');
      }
      /* a conta so e gravada se ninguem mexeu nela desde a leitura (o dono encerrando agora, outro aviso): senao, conflito
         e tudo e refeito com a conta nova. A vaga de fundador vai junto, na mesma gravacao */
      escritas.unshift({ caminho: caminhoConta, campos: campos, versao: conta._versao });
      await fb.gravarJuntos(escritas);

      /* link de fundador sem vaga (ou de quem ja tinha pago sem ser fundador): a assinatura passa para o preco normal (a
         proxima fatura ja vem certa) e o admin fica sabendo. Antes, R$ 79 com 26 dias e a tolerancia seguravam a loja no
         ar para sempre pelo preco de fundador */
      if (parcial && parcial.motivo === 'fundador-sem-vaga' && sub) {
        await asaas(env, '/subscriptions/' + encodeURIComponent(sub), 'PUT', { value: cheio / 100, updatePendingPayments: true })
          .catch((e) => console.error('assinatura sem vaga de fundador', e && e.message || e));
        await avisarAdmin(env, 'Preço de fundador sem vaga', 'A conta ' + email + ' pagou ' + reais(centavos) + ' pelo link de fundador, mas não tinha vaga. Valeu ' + dias + ' dias, e a assinatura ' + sub + ' passou para ' + reais(cheio) + ' (confira no Asaas).');
      }
      if (pausada) await avisarAdmin(env, 'Pagamento de conta pausada', 'A conta ' + email + ' está pausada (estorno ou contestação) e pagou ' + reais(entrou) + ' (cobrança ' + pag.id + '). Os dias entraram, mas ela continua pausada até você liberar na Central.');

      const lojas = await espelharPlano(env, fb, email, Object.assign({}, p, {
        status: pausada ? 'pausado' : 'ativo', pagoAte: pagoAte, planoId: PLANO, planoPago: PLANO, tipo: campos['plano.tipo'] || p.tipo, avisoPagamentoEm: '', avisoValor: 0, desde: p.desde || agoraIso, fundador: fundador,
      }));
      return json({ ok: true, email: email, plano: PLANO, tipo: plano.tipo, pagoAte: pagoAte, lojas: lojas.length });
}

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
    const ok = await mandarEmail(env, email, mensagemDoLembrete(qual, f, cartao, c.nome));
    if (!ok) { falhas++; continue; }
    await fb.merge('contas/' + encodeURIComponent(email), { faturaAsaas: Object.assign({}, f, { lembretes: ja.concat([qual]) }) });
    enviados++;
  }
  return { ok: true, contas: contas.length, enviados: enviados, falhas: falhas };
}
/* O e-mail: logo em cima; cartao branco com a faixa colorida (selo, titulo e o ratinho nas cores do aviso: verde antes de
   vencer, laranja vencida, vermelho com 7 dias); "Ola, nome"; o quadro da fatura (valor grande e quando vence); o botao;
   e o rodape com o logo. Feito de tabelas e estilo na linha, que e o que o Gmail, o Outlook e o app do celular mostram
   igual; no celular a faixa encolhe pelo @media. As imagens sao PNG do site (img/email, feitas por
   comercial/scripts/selos_email.mjs), porque e-mail nao mostra SVG */
const SITE = 'https://ligeiropedidos.com.br';
/* dias gratis do teste: o mesmo numero de precos.diasGratis em js/config.js (mudou la, muda aqui) */
const DIAS_GRATIS = 7;
/* dias que a loja segue no ar depois de vencer (o mesmo diasTolerancia de js/regras.js) */
const DIAS_TOLERANCIA = 10;
/* quem pode chamar as rotas do dono (o site) */
const ORIGENS = ['https://ligeiropedidos.com.br', 'https://www.ligeiropedidos.com.br', 'https://ligeiropedidos.github.io', 'http://localhost:8765'];
const EMAIL_EQUIPE = /^equipe-[a-z0-9-]+@equipe\.(ligeiropedidos\.com\.br|ligeiro\.app\.br)$/i;
const ADMIN = 'ligeiro.pedidos@gmail.com';
/* o plano: um so, 1 loja por conta (outra loja = outra conta) */
const PLANO = 'uma';
const MEM = { quem: {}, vez: {} };
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function mensagemDoLembrete(qual, f, cartao, nome) {
  const valor = 'R$ ' + (Math.round(Number(f.valor) || 0) / 100).toFixed(2).replace('.', ',');
  const p = f.vencimento.split('-');
  const dia = p[2] + '/' + p[1];
  const naoPassou = cartao ? 'A cobrança no seu cartão não passou. ' : '';
  const m = {
    d3: { assunto: 'Sua mensalidade do Ligeiro vence em 3 dias', quando: 'Vence em 3 dias · ' + dia, tom: 'vence',
      titulo: 'Fatura em aberto', sub: ['É só um lembrete:', 'está tudo em dia.'],
      texto: 'Sua mensalidade do Ligeiro vence em 3 dias. Pague pela fatura e sua loja segue recebendo pedidos sem parar.' },
    d0: { assunto: 'Sua mensalidade do Ligeiro vence hoje', quando: 'Vence hoje · ' + dia, tom: 'vence',
      titulo: 'Último dia', sub: ['Ainda dá tempo', 'de pagar sem atraso.'],
      texto: 'Sua mensalidade do Ligeiro vence hoje. É só pagar pela fatura: leva menos de um minuto.' },
    vencida: { assunto: 'Sua mensalidade do Ligeiro venceu', quando: 'Venceu em ' + dia, tom: 'venceu',
      titulo: 'Fatura vencida', sub: ['Calma, ainda dá', 'tempo de resolver.'],
      texto: naoPassou + 'Sua mensalidade do Ligeiro venceu. Sua loja segue no ar por mais alguns dias: pague pela fatura para não parar.' },
    vencida7: { assunto: 'Sua loja pode parar de receber pedidos', quando: 'Venceu em ' + dia, tom: 'parar',
      titulo: 'Fatura atrasada', sub: ['Este é o último', 'lembrete que mandamos.'],
      texto: naoPassou + 'Sua mensalidade do Ligeiro venceu há uma semana e ainda não foi paga. Pague pela fatura para sua loja não parar de receber pedidos.' },
  }[qual];
  /* faixa: cor lisa (Outlook) e o degrade por cima; titulo, subtitulo, borda do quadro e a cor do "quando" */
  const tons = {
    vence: { faixa: '#D9F99D', degrade: 'linear-gradient(120deg,#EDFBD2 0%,#C2EC72 100%)', titulo: '#0F3D2E', sub: '#365314', borda: '#BEF264', cor: '#4D7C0F' },
    venceu: { faixa: '#FED7AA', degrade: 'linear-gradient(120deg,#FFF3E4 0%,#FDC895 100%)', titulo: '#7C2D12', sub: '#9A3412', borda: '#FDBA74', cor: '#C2410C' },
    parar: { faixa: '#FECACA', degrade: 'linear-gradient(120deg,#FFEDED 0%,#FCB8B8 100%)', titulo: '#7F1D1D', sub: '#991B1B', borda: '#FCA5A5', cor: '#B91C1C' },
  };
  const t = tons[m.tom];
  const primeiro = String(nome || '').trim().split(/\s+/)[0].slice(0, 30);
  const ola = primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!';
  const fecho = 'Pagou? Tudo segue sozinho. Dúvida? É só responder este e-mail.';
  const texto = ola + '\n\n' + m.texto + '\n\nMensalidade: ' + valor + ' (' + m.quando + ')\nPagar a fatura: ' + f.url + '\n\n' + fecho + '\n\nLigeiro\n' + SITE.replace('https://', '');
  const fonte = 'font-family:Arial,Helvetica,sans-serif;';
  const img = SITE + '/img/email/';
  const tabela = '<table role="presentation" cellpadding="0" cellspacing="0" border="0"';
  const logo = (tam, letra) => '<a href="' + SITE + '" style="text-decoration:none;">'
    + '<img src="' + SITE + '/img/favicon-96.png" width="' + tam + '" height="' + tam + '" alt="" style="border:0;vertical-align:middle;">'
    + '<span style="' + fonte + 'font-size:' + letra + 'px;font-weight:bold;color:#0F3D2E;vertical-align:middle;padding-left:8px;">Ligei<span style="color:#65A30D;">ro</span></span></a>';
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(m.assunto) + '</title>'
    + '<style>@media (max-width:480px){'
    + '.h-esq{padding:16px 12px 16px 24px !important}.h-tit{font-size:22px !important}.h-selo{width:40px !important;height:40px !important}'
    + '.h-sub{font-size:13px !important}.h-dir{width:136px !important}.h-masc{width:136px !important}.pad{padding-left:24px !important;padding-right:24px !important}}</style></head>'
    + '<body style="margin:0;padding:0;background:#EEF6E4;">'
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + esc(m.texto) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF6E4" style="background-color:#EEF6E4;background-image:linear-gradient(180deg,#E2F1CF 0%,#F4F9EE 360px);"><tr><td align="center" style="padding:32px 16px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">'
    /* logo */
    + '<tr><td align="center" style="padding:0 0 24px;">' + logo(44, 26) + '</td></tr>'
    /* cartao */
    + '<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E3EBD9;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,61,46,0.08);">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    /* faixa: selo e titulo, o subtitulo embaixo (em dois pedacos que nao se partem: nada de palavra sozinha na linha) e o ratinho no canto */
    + '<tr><td bgcolor="' + t.faixa + '" style="background-color:' + t.faixa + ';background-image:' + t.degrade + ';border-radius:16px 16px 0 0;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="h-esq" valign="middle" style="padding:24px 16px 24px 32px;">'
    + tabela + '><tr><td valign="middle" style="padding-right:12px;"><img class="h-selo" src="' + img + 'selo-' + m.tom + '.png" width="52" height="52" alt="" style="border:0;display:block;"></td>'
    + '<td class="h-tit" valign="middle" style="' + fonte + 'font-size:30px;line-height:1.1;font-weight:bold;color:' + t.titulo + ';">' + esc(m.titulo) + '</td></tr></table>'
    + '<div class="h-sub" style="padding-top:12px;' + fonte + 'font-size:14px;line-height:1.5;color:' + t.sub + ';">' + m.sub.map((x) => '<span style="white-space:nowrap;">' + esc(x) + '</span>').join(' ') + '</div></td>'
    + '<td class="h-dir" valign="bottom" align="right" width="216" style="width:216px;padding:16px 0 0;">'
    + '<img class="h-masc" src="' + img + 'mascote-' + m.tom + '.png" width="216" height="175" alt="" style="border:0;display:block;width:216px;max-width:100%;height:auto;"></td>'
    + '</tr></table></td></tr>'
    + '<tr><td class="pad" style="padding:32px 32px 0;' + fonte + 'font-size:16px;line-height:1.6;color:#1F2937;">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:bold;color:#0F3D2E;">' + esc(ola) + '</p>'
    + '<p style="margin:0 0 24px;">' + esc(m.texto) + '</p></td></tr>'
    /* quadro da fatura */
    + '<tr><td class="pad" style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F7FAF3" style="background:#F7FAF3;border:1px solid ' + t.borda + ';border-radius:12px;">'
    + '<tr><td align="center" style="padding:24px 16px;' + fonte + '">'
    + '<div style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">Mensalidade do Ligeiro</div>'
    + '<div style="font-size:34px;font-weight:bold;color:#0F3D2E;line-height:1.2;padding:8px 0 4px;">' + esc(valor) + '</div>'
    + '<div style="font-size:15px;font-weight:bold;color:' + t.cor + ';">' + esc(m.quando) + '</div>'
    + '</td></tr></table></td></tr>'
    /* botao com o cartao (tabela: funciona ate no Outlook) */
    + '<tr><td class="pad" align="center" style="padding:24px 32px 0;">' + tabela + '><tr>'
    + '<td align="center" bgcolor="#84CC16" style="background-color:#84CC16;background-image:linear-gradient(180deg,#93D62B 0%,#7AC211 100%);border-radius:12px;">'
    + '<a href="' + esc(f.url) + '" style="display:inline-block;padding:14px 32px;' + fonte + 'font-size:17px;line-height:20px;font-weight:bold;color:#0E1F14;text-decoration:none;border-radius:12px;">'
    + '<img src="' + img + 'icone-cartao.png" width="20" height="20" alt="" style="border:0;vertical-align:middle;margin-right:12px;"><span style="vertical-align:middle;">Pagar a fatura</span></a>'
    + '</td></tr></table>'
    + '<p style="margin:12px 0 0;' + fonte + 'font-size:14px;color:#6B7280;">Pix, boleto ou cartão</p></td></tr>'
    /* fecho */
    + '<tr><td class="pad" style="padding:24px 32px 32px;"><div style="border-top:1px solid #EEF2E8;padding-top:24px;' + fonte + 'font-size:14px;line-height:1.6;color:#6B7280;">' + esc(fecho).replace('e-mail', '<span style="white-space:nowrap;">e-mail</span>') + '</div></td></tr>'
    + '</table></td></tr>'
    /* rodape: o logo e a frase */
    + '<tr><td align="center" style="padding:32px 16px 0;">' + logo(32, 20)
    + '<div style="padding-top:12px;' + fonte + 'font-size:11px;letter-spacing:2px;color:#4B5563;text-transform:uppercase;">Simples · rápido · sem comissão</div></td></tr>'
    + '</table></td></tr></table></body></html>';
  return { assunto: m.assunto, texto: texto, html: html };
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
  const caminho = 'contas/' + encodeURIComponent(email);
  const conta = await fb.get(caminho);
  /* so cobranca que liberou dias (esta nos pagamentos da conta) pausa alguma coisa */
  if (!conta || !Array.isArray(conta.pagamentos) || conta.pagamentos.indexOf(pag.id) < 0) return json({ ok: true, ignorado: 'cobranca que nao liberou dias' });
  const estornos = Array.isArray(conta.estornos) ? conta.estornos : [];
  const p = conta.plano || {};
  /* aviso repetido: se da outra vez a copia nas lojas falhou no meio, grava de novo o plano de agora */
  if (estornos.some((x) => x && x.id === pag.id)) { await espelharPlano(env, fb, email, p); return json({ ok: true, repetido: pag.id }); }
  /* devolucao que o proprio Ligeiro fez (cobranca de assinatura depois de encerrar): nao e golpe, nao pausa */
  if ((conta.estornosAutomaticos || []).some((x) => x && x.id === pag.id)) return json({ ok: true, ignorado: 'devolvido pelo Ligeiro' });
  const agora = new Date().toISOString();
  /* os dias que esse pagamento deu saem (o dinheiro voltou): senao a conta pausada ainda tinha o ano pago, e bastava um
     pagamento qualquer para voltar com ele */
  const credito = (Array.isArray(conta.creditos) ? conta.creditos : []).filter((x) => x && x.id === pag.id)[0];
  const tirar = credito ? Math.max(0, Number(credito.dias) || 0) : 0;
  const pagoAteMs = Date.parse(p.pagoAte || '') || 0;
  const pagoAte = tirar && pagoAteMs ? new Date(pagoAteMs - tirar * 864e5).toISOString() : (p.pagoAte || '');
  const listaEstornos = estornos.concat([{ id: pag.id, status: st, em: agora, dias: tirar }]).slice(-20);
  /* pagamento de uma assinatura extra (alguem assinou com o e-mail do dono, e a do dono seguiu a da conta): os dias dela
     saem, mas a conta do dono nao pausa. O admin confere */
  const subDoPagamento = String(real.subscription || '');
  if (subDoPagamento && (conta.assinaturasExtras || []).map(String).indexOf(subDoPagamento) >= 0) {
    await fb.mergeCampos(caminho, { 'plano.pagoAte': pagoAte, estornos: listaEstornos, atualizadoEm: agora });
    await espelharPlano(env, fb, email, Object.assign({}, p, { pagoAte: pagoAte }));
    await avisarAdmin(env, 'Estorno de assinatura extra', 'A cobrança ' + pag.id + ' (assinatura ' + subDoPagamento + ', que não é a da conta ' + email + ') foi estornada ou contestada. Os ' + tirar + ' dias dela saíram e a conta não foi pausada. Confira no Asaas quem assinou.');
    return json({ ok: true, descontado: email, dias: tirar });
  }
  await fb.mergeCampos(caminho, { 'plano.status': 'pausado', 'plano.pausadoEm': agora, 'plano.motivoPausa': 'estorno', 'plano.pagoAte': pagoAte, estornos: listaEstornos, atualizadoEm: agora });
  const lojas = await espelharPlano(env, fb, email, Object.assign({}, p, { status: 'pausado', pagoAte: pagoAte, avisoPagamentoEm: '', avisoValor: 0, desde: p.desde || agora }));
  return json({ ok: true, pausada: email, lojas: lojas.length, dias: tirar });
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
  const velhas = Array.isArray(conta.assinaturasAntigas) ? conta.assinaturasAntigas : [];
  const daVelha = velhas.indexOf(String(real.subscription)) >= 0;
  /* fatura de OUTRA assinatura numa conta que ja tem a sua: nao aparece no painel. Alguem pode ter assinado com o e-mail do
     dono, e pagar essa fatura por engano dava a assinatura da conta para o outro */
  const deOutra = !!conta.assinaturaAsaas && String(real.subscription) !== String(conta.assinaturaAsaas);
  const aberta = (st === 'PENDING' || st === 'OVERDUE') && real.deleted !== true && evento !== 'PAYMENT_DELETED' && !daVelha && !deOutra;
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
  /* a assinatura da conta so muda quando uma PAGA (no aviso de pagamento): fatura nova nao amarra nada. Quem digitasse o
     e-mail de outro no link amarraria a assinatura dele na conta alheia; e conta encerrada que assina de novo teria a
     assinatura nova tratada como a velha (devolvida) */
  const anota = { faturaAsaas: fatura, atualizadoEm: agora };
  /* assinatura que so tem fatura (ainda nao pagou): fica como pendente. Trocar de plano e encerrar passam pelo mensageiro,
     que muda ou cancela ela junto (senao a fatura aberta seguia no valor velho, ou seguia cobrando depois de encerrar) */
  if (fatura.assinatura !== String(conta.assinaturaAsaas || '')) anota.assinaturaPendente = fatura.assinatura;
  await fb.merge(caminho, anota);
  return json({ ok: true, fatura: fatura.status, vencimento: vencimento });
}

/* ---------------- troca mensal/anual e encerramento (o dono logado pede, pelo site) ----------------
   A conta tem uma assinatura so no Asaas. Trocar entre mensal e anual muda o valor DESSA assinatura (nunca cria outra, que
   cobraria em dobro no cartao); encerrar cancela a assinatura no Asaas */
async function rotaDoDono(request, env, caminho) {
  const origem = request.headers.get('Origin') || '';
  const cors = { 'Access-Control-Allow-Origin': ORIGENS.indexOf(origem) >= 0 ? origem : 'null', Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' };
  const resp = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' }, cors) });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return resp({ ok: false, erro: 'Use POST.' }, 405);
  if (['/plano/simular', '/plano/trocar', '/plano/encerrar'].indexOf(caminho) < 0) return resp({ ok: false, erro: 'Rota que não existe.' }, 404);
  let corpo = {};
  try { corpo = await request.json(); } catch (_) { corpo = {}; }
  if (!corpo || typeof corpo !== 'object') corpo = {};
  try {
    const fb = await firebase(env);
    const email = await quemChamou(fb, request);
    if (!email) return resp({ ok: false, erro: 'Entre de novo na sua conta e tente outra vez.' }, 401);
    /* login da equipe (cozinha, entregador) nao mexe na assinatura */
    if (EMAIL_EQUIPE.test(email)) return resp({ ok: false, erro: 'Só o dono da conta mexe na assinatura.' }, 403);
    if (!umPorVez(email)) return resp({ ok: false, erro: 'Um instante: o pedido anterior ainda está terminando.' }, 429);
    try {
      const conta = await fb.get('contas/' + encodeURIComponent(email));
      if (!conta || !conta.plano) return resp({ ok: false, erro: 'Não achamos a sua conta. Entre de novo.' }, 404);
      if (caminho === '/plano/encerrar') { const r = await encerrarAssinatura(env, fb, email, conta); return resp(r.corpo, r.status); }
      /* um plano so: quem pede outro (2 ou 3 lojas) ouve o caminho, outra conta */
      if (corpo.planoId && corpo.planoId !== PLANO) return resp({ ok: false, erro: 'Cada conta tem uma loja. Para outra loja, entre com outro e-mail e crie a loja por lá.' }, 400);
      const d = await decidirTroca(env, email, conta, String(corpo.tipo || ''));
      if (d.erro) return resp({ ok: false, erro: d.erro }, d.status || 400);
      if (caminho === '/plano/simular') return resp(Object.assign({ ok: true }, resumoDaTroca(d)));
      const r = await executarTroca(env, fb, email, conta, d);
      return resp(r.corpo, r.status);
    } finally { delete MEM.vez[email]; }
  } catch (e) {
    console.error('plano', e && e.message || e);
    return resp({ ok: false, erro: 'Não deu agora. Tente de novo em instantes.' }, 500);
  }
}

/* um pedido por conta de cada vez (clique duplo ou duas abas nao criam duas cobrancas) */
function umPorVez(email) {
  const t = MEM.vez[email];
  if (t && Date.now() - t < 20000) return false;
  MEM.vez[email] = Date.now();
  return true;
}

/* quem esta logado: o token do Google conferido no Identity Toolkit. So e-mail conferido e login ativo (quem criou conta
   de e-mail e senha com o e-mail de outro, sem confirmar, nao passa) */
async function quemChamou(fb, request) {
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken || idToken.length > 4000) return '';
  const m = MEM.quem[idToken];
  if (m && Date.now() < m.ate) return m.email;
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', { method: 'POST', headers: fb.cab, body: JSON.stringify({ idToken: idToken }) });
  if (!r.ok) return '';
  const u = ((await r.json().catch(() => ({}))).users || [])[0];
  if (!u || !u.email || u.emailVerified !== true || u.disabled === true) return '';
  const email = String(u.email).toLowerCase();
  if (Object.keys(MEM.quem).length > 200) MEM.quem = {};
  MEM.quem[idToken] = { email: email, ate: Math.min(Date.now() + 10 * 60 * 1000, venceDoToken(idToken)) };
  return email;
}
function venceDoToken(idToken) {
  try {
    const meio = String(idToken).split('.')[1] || '';
    const j = JSON.parse(atob(meio.replace(/-/g, '+').replace(/_/g, '/')));
    if (j && j.exp) return Number(j.exp) * 1000;
  } catch (_) { /* segue */ }
  return Date.now() + 10 * 60 * 1000;
}

/* preco do plano no tipo (mensal/anual), com o de fundador para quem e fundador */
function precoDe(planos, tipo, fundador) {
  const p = planos[PLANO] || {};
  return Math.round(Number(fundador ? p[tipo === 'anual' ? 'fa' : 'fm'] : p[tipo === 'anual' ? 'anual' : 'mensal']) || 0);
}

/* O que a troca faz, sem mexer em nada. acao:
   'marcar'  sem assinatura viva no Asaas (teste gratis, encerrada): so marca a escolha; o proximo pagamento ja e dela
   'proxima' com assinatura: a mesma assinatura muda de valor e ciclo agora, e a cobranca nova vem na proxima fatura
   'igual'   nada muda */
async function decidirTroca(env, email, conta, tipo) {
  if (tipo !== 'mensal' && tipo !== 'anual') return { erro: 'Escolha mensal ou anual.', status: 400 };
  const planos = lerPlanos(env);
  const p = conta.plano || {};
  if (p.status === 'pausado') return { erro: 'Sua conta está pausada. Fale com o Ligeiro.', status: 409 };
  const subId = String(conta.assinaturaAsaas || conta.assinaturaPendente || '');
  const assinatura = subId ? await asaas(env, '/subscriptions/' + encodeURIComponent(subId)).catch((e) => { if (e && e.status === 404) return null; throw e; }) : null;
  const viva = !!assinatura && assinatura.deleted !== true && String(assinatura.status || 'ACTIVE') === 'ACTIVE';
  if (!viva) {
    const valor = precoDe(planos, tipo, p.fundador === true);
    if (!(valor > 0)) return { erro: 'Esse plano não está à venda.', status: 400 };
    return { acao: 'marcar', tipo: tipo, valorNovo: valor, fundador: p.fundador === true, assinaturaMorta: subId };
  }
  if (p.status === 'cancelado') return { erro: 'Sua assinatura está encerrada. Reative em Minha conta antes de trocar.', status: 409 };
  const valorAtual = Math.round(Number(assinatura.value || 0) * 100);
  /* fundador: o de sempre, ou quem assinou pelo link de fundador e ainda nao pagou a primeira (o preco trava no pagamento) */
  const fundador = p.fundador === true || (!p.ultimoPagamentoEm && descobrirPlano(env, valorAtual).preco === 'fundador');
  const valorNovo = precoDe(planos, tipo, fundador);
  if (!(valorNovo > 0)) return { erro: 'Esse plano não está à venda.', status: 400 };
  const cicloAssinatura = assinatura.cycle === 'YEARLY' ? 'anual' : 'mensal';
  const nada = cicloAssinatura === tipo && valorAtual === valorNovo && String(p.tipo || cicloAssinatura) === tipo;
  return {
    acao: nada ? 'igual' : 'proxima', tipo: tipo, valorNovo: valorNovo, fundador: fundador, sub: subId, valorAtual: valorAtual, cicloAssinatura: cicloAssinatura,
    proxima: /^\d{4}-\d{2}-\d{2}$/.test(String(assinatura.nextDueDate || '')) ? String(assinatura.nextDueDate) : '',
  };
}
/* o que o site mostra (sem ids do Asaas) */
function resumoDaTroca(d) {
  return { acao: d.acao, tipo: d.tipo, valorNovo: d.valorNovo, proxima: d.proxima || '' };
}

async function executarTroca(env, fb, email, conta, d) {
  const agora = new Date().toISOString();
  const caminho = 'contas/' + encodeURIComponent(email);
  if (d.acao === 'igual') return { status: 200, corpo: Object.assign({ ok: true }, resumoDaTroca(d)) };
  /* a mesma assinatura no valor e no ciclo novos (as faturas pendentes mudam junto). Se o Asaas recusar, nada foi gravado */
  if (d.sub && (d.valorAtual !== d.valorNovo || d.cicloAssinatura !== d.tipo)) {
    await asaas(env, '/subscriptions/' + encodeURIComponent(d.sub), 'PUT', { value: d.valorNovo / 100, cycle: d.tipo === 'anual' ? 'YEARLY' : 'MONTHLY', updatePendingPayments: true });
  }
  const campos = { 'plano.planoId': PLANO, 'plano.tipo': d.tipo, atualizadoEm: agora };
  if (d.acao === 'marcar' && d.assinaturaMorta) {
    if (d.assinaturaMorta === String(conta.assinaturaPendente || '')) campos.assinaturaPendente = '';
    else campos.assinaturaAsaas = '';
    campos.assinaturasAntigas = juntar(conta.assinaturasAntigas, d.assinaturaMorta);
  }
  /* outra troca no mesmo instante (outra aba): se a escolha mudou no meio, a assinatura volta para a escolha que ficou e o
     dono confere (nunca fica cobrando um valor que ninguem escolheu) */
  const agoraConta = (await fb.get(caminho)) || {};
  const pa = conta.plano || {}, pb = agoraConta.plano || {};
  if (String(pa.tipo || '') !== String(pb.tipo || '')) {
    const valorFica = precoDe(lerPlanos(env), pb.tipo === 'anual' ? 'anual' : 'mensal', !!d.fundador);
    if (d.sub && valorFica > 0 && valorFica !== d.valorNovo) {
      await asaas(env, '/subscriptions/' + encodeURIComponent(d.sub), 'PUT', { value: valorFica / 100, cycle: pb.tipo === 'anual' ? 'YEARLY' : 'MONTHLY', updatePendingPayments: true }).catch((e) => console.error('volta da assinatura', e && e.message || e));
    }
    return { status: 409, corpo: { ok: false, erro: 'Outra troca foi feita agora mesmo. Confira em Minha conta.' } };
  }
  await fb.mergeCampos(caminho, campos);
  /* a copia nas lojas sai do que esta gravado agora (um pagamento no meio ja pode ter mudado o pagoAte) */
  const depois = (await fb.get(caminho)) || {};
  await espelharPlano(env, fb, email, Object.assign({}, depois.plano || pb, { planoId: PLANO, tipo: d.tipo }));
  return { status: 200, corpo: Object.assign({ ok: true }, resumoDaTroca(d)) };
}

/* Encerrar: cancela a assinatura no Asaas (nenhuma cobranca nova, nem a fatura pendente) e a conta fica no ar ate o fim
   do que ja pagou. Se o Asaas falhar agora, o Cron de todo dia tenta de novo, e cobranca que cair antes e devolvida */
async function encerrarAssinatura(env, fb, email, conta) {
  const p = conta.plano || {};
  if (p.status === 'pausado') return { status: 409, corpo: { ok: false, erro: 'Sua conta está pausada. Fale com o Ligeiro.' } };
  const agora = new Date().toISOString();
  const sub = String(conta.assinaturaAsaas || '');
  const cancelou = sub ? await apagarAssinatura(env, sub) : true;
  const pendente = String(conta.assinaturaPendente || '');
  const cancelouPendente = pendente ? await apagarAssinatura(env, pendente) : true;
  const canceladoEm = p.status === 'cancelado' && p.canceladoEm ? p.canceladoEm : agora;
  /* encerrou, perdeu o preco de fundador (os termos: "travado enquanto voce nao cancelar"). Quem volta, volta no normal */
  const campos = { 'plano.status': 'cancelado', 'plano.canceladoEm': canceladoEm, 'plano.fundador': false, atualizadoEm: agora };
  let antigas = conta.assinaturasAntigas;
  if (sub && cancelou) { campos.assinaturaAsaas = ''; antigas = juntar(antigas, sub); campos.faturaAsaas = null; }
  if (pendente && cancelouPendente) { campos.assinaturaPendente = ''; antigas = juntar(antigas, pendente); campos.faturaAsaas = null; }
  /* a assinatura extra (a de quem assinou com o mesmo e-mail) tambem para: senao ela cobrava e reativava a conta */
  const extras = Array.isArray(conta.assinaturasExtras) ? conta.assinaturasExtras.map(String) : [];
  const ficam = [];
  for (const x of extras) { if (await apagarAssinatura(env, x)) antigas = juntar(antigas, x); else ficam.push(x); }
  if (extras.length) campos.assinaturasExtras = ficam;
  if (antigas !== conta.assinaturasAntigas) campos.assinaturasAntigas = antigas;
  const caminho = 'contas/' + encodeURIComponent(email);
  await fb.mergeCampos(caminho, campos);
  const depois = (await fb.get(caminho)) || {};
  await espelharPlano(env, fb, email, Object.assign({}, depois.plano || p, { status: 'cancelado', canceladoEm: canceladoEm, fundador: false }));
  return { status: 200, corpo: { ok: true, cancelada: !!sub && cancelou } };
}

/* O plano da conta copiado em cada loja e na vitrine; a copia da loja na borda sai (a proxima visita ja le a nova) */
async function espelharPlano(env, fb, email, p) {
  const agora = new Date().toISOString();
  /* os mesmos campos da copia do site (js/dados.js, espelhoDoPlano): a regra do banco compara as duas */
  const espelho = { status: p.status || 'teste', tipo: p.tipo || 'mensal', planoId: p.planoId || 'uma', planoPago: p.planoPago || '', fundador: p.fundador === true, desde: p.desde || agora, pagoAte: p.pagoAte || '', avisoPagamentoEm: p.avisoPagamentoEm || '', avisoValor: Number(p.avisoValor) || 0 };
  const lojas = await fb.query('lojas', 'donoEmail', email);
  for (const slug of lojas) {
    await fb.merge('lojas/' + slug, { plano: espelho, atualizadoEm: agora });
    await fb.merge('vitrine/' + slug, { plano: espelho, atualizadoEm: agora });
    if (env.CARDAPIO) await env.CARDAPIO.delete('loja:' + slug).catch(() => {});
  }
  if (env.CARDAPIO && lojas.length) await env.CARDAPIO.delete('vitrine').catch(() => {});
  return lojas;
}

/* conta encerrada por fora (Central ou site antigo) com a assinatura ainda viva no Asaas: o Cron cancela */
async function sincronizarEncerradas(env) {
  const fb = await firebase(env);
  const contas = await fb.consultarEm('contas', 'plano.status', ['cancelado']);
  let canceladas = 0;
  for (const c of contas) {
    const campos = {};
    let antigas = c.assinaturasAntigas;
    const sub = String(c.assinaturaAsaas || '');
    if (sub && (await apagarAssinatura(env, sub))) { campos.assinaturaAsaas = ''; antigas = juntar(antigas, sub); campos.faturaAsaas = null; canceladas++; }
    /* as extras (alguem assinou com o mesmo e-mail) tambem param */
    const extras = Array.isArray(c.assinaturasExtras) ? c.assinaturasExtras.map(String) : [];
    if (extras.length) {
      const ficam = [];
      for (const x of extras) { if (await apagarAssinatura(env, x)) { antigas = juntar(antigas, x); canceladas++; } else ficam.push(x); }
      campos.assinaturasExtras = ficam;
    }
    if (antigas !== c.assinaturasAntigas) campos.assinaturasAntigas = antigas;
    /* encerrada pela Central ou pelo site: o preco de fundador acaba (igual ao encerrar pelo mensageiro) */
    if (c.plano && c.plano.fundador === true) campos['plano.fundador'] = false;
    if (!Object.keys(campos).length) continue;
    campos.atualizadoEm = new Date().toISOString();
    await fb.mergeCampos('contas/' + encodeURIComponent(String(c._id)), campos);
  }
  /* a pendente de conta encerrada fica: pode ser a de quem esta voltando (assinou de novo e ainda nao pagou) */
  return { ok: true, encerradas: contas.length, canceladas: canceladas };
}

/* no Asaas: cancelar assinatura e devolver. Ja apagada (404) conta como feito; outro erro vai pro log */
async function apagarAssinatura(env, id) {
  try { await asaas(env, '/subscriptions/' + encodeURIComponent(id), 'DELETE'); return true; } catch (e) { if (e && e.status === 404) return true; console.error('apagar assinatura', e && e.message || e); return false; }
}
/* cartao e Pix devolvem pela API; boleto nao (volta false e o admin e avisado) */
async function estornar(env, id, motivo) {
  try { await asaas(env, '/payments/' + encodeURIComponent(id) + '/refund', 'POST', { description: motivo }); return true; } catch (e) { console.error('estorno', e && e.message || e); return false; }
}

/* e-mail para o admin (pelo mesmo Apps Script dos lembretes); sem ele configurado, fica so no registro */
async function avisarAdmin(env, assunto, texto) {
  console.error('admin: ' + assunto);
  if (!env.EMAIL_URL || !env.EMAIL_TOKEN) return false;
  return mandarEmail(env, ADMIN, { assunto: 'Ligeiro: ' + assunto, texto: texto, html: '<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1F2937;">' + esc(texto) + '</p>' }).catch(() => false);
}

function juntar(lista, item) {
  const l = Array.isArray(lista) ? lista.map(String) : [];
  if (item && l.indexOf(String(item)) < 0) l.push(String(item));
  return l.slice(-10);
}
function reais(centavos) {
  const v = Math.round(Number(centavos) || 0);
  return 'R$ ' + String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + String(v % 100).padStart(2, '0');
}

/* compara o token sem parar na primeira letra diferente (ninguem descobre o token pelo tempo da resposta) */
function igual(a, b) {
  a = String(a); b = String(b);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return dif === 0;
}

function lerPlanos(env) { try { return JSON.parse(env.PLANOS || '{}') || {}; } catch (_) { return {}; } }
/* Qual foi pago: pelo valor (bate com PLANOS). preco: 'cheio', 'fundador' ou '' (valor que nao bate: vale proporcional, no
   mensal; acima de dois meses, no anual) */
function descobrirPlano(env, centavos) {
  const p = lerPlanos(env)[PLANO] || {};
  const precos = [['mensal', 'mensal', 'cheio'], ['anual', 'anual', 'cheio'], ['fm', 'mensal', 'fundador'], ['fa', 'anual', 'fundador']];
  for (const [campo, tipo, preco] of precos) {
    if (Number(p[campo]) === centavos) return { id: PLANO, tipo: tipo, preco: preco };
  }
  /* pago com multa e juros de atraso (ate 10% acima de um preco do plano): e aquele preco. O originalValue do Asaas ja
     resolve; isto e a rede, se ele nao vier. As faixas nao se encostam (79 a 86,90; 89 a 97,90; 790 a 869; 890 a 979) */
  for (const [campo, tipo, preco] of precos) {
    const v = Number(p[campo]) || 0;
    if (v > 0 && centavos > v && centavos <= Math.floor(v * 1.1)) return { id: PLANO, tipo: tipo, preco: preco };
  }
  return { id: PLANO, tipo: centavos > Number(p.mensal || 0) * 2 ? 'anual' : 'mensal', preco: '' };
}

/* o Asaas exige o User-Agent nas contas novas (sem ele, responde 400 a tudo; o fetch da Cloudflare nao manda nenhum).
   O motivo que o Asaas der vai para o registro do Cloudflare (nunca para a resposta): o proximo erro se le de primeira */
async function asaas(env, caminho, metodo, corpo) {
  const cab = { access_token: String(env.ASAAS_KEY || '').trim(), accept: 'application/json', 'User-Agent': 'Ligeiro/1.0 (ligeiropedidos.com.br)' };
  if (corpo) cab['Content-Type'] = 'application/json';
  const r = await fetch('https://api.asaas.com/v3' + caminho, { method: metodo || 'GET', headers: cab, body: corpo ? JSON.stringify(corpo) : undefined });
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
    /* comVersao: guarda em _versao a hora da ultima mudanca do documento (a trava da gravacao em lote) */
    async get(caminho, comVersao) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Firestore get ' + r.status);
      const doc = await r.json();
      const dados = deFirestore(doc.fields || {});
      if (comVersao) Object.defineProperty(dados, '_versao', { value: doc.updateTime || '', enumerable: false });
      return dados;
    },
    /* varias gravacoes de uma vez, tudo ou nada. Cada uma: caminho, campos (com ponto mexe dentro do mapa, como no
       mergeCampos), versao (so grava se o documento nao mudou desde a leitura) ou novo (so se ainda nao existe).
       Trava que nao bate: erro com conflito = true, e nada foi gravado */
    async gravarJuntos(escritas) {
      const nome = 'projects/' + sa.project_id + '/databases/(default)/documents/';
      const writes = escritas.map((w) => {
        const x = { update: { name: nome + w.caminho.split('/').map(decodeURIComponent).join('/'), fields: camposFirestore(aninhar(w.campos)) }, updateMask: { fieldPaths: Object.keys(w.campos) } };
        if (w.versao) x.currentDocument = { updateTime: w.versao };
        else if (w.novo) x.currentDocument = { exists: false };
        return x;
      });
      const r = await fetch(base.replace(/\/$/, '') + ':commit', { method: 'POST', headers: cab, body: JSON.stringify({ writes: writes }) });
      if (!r.ok) {
        const t = (await r.text()).slice(0, 300);
        const e = new Error('Firestore commit ' + r.status + ' ' + t);
        if (r.status === 409 || r.status === 412 || /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS/.test(t)) e.conflito = true;
        throw e;
      }
    },
    cab: cab,
    async merge(caminho, dados) {
      const campos = Object.keys(dados);
      const mask = campos.map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(dados) }) });
      if (!r.ok) throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200));
    },
    /* grava so os campos dados, e caminho com ponto mexe dentro do mapa ('plano.pagoAte'), sem apagar o resto dele:
       o pagamento nao desfaz a escolha de plano que o dono fez no mesmo instante */
    async mergeCampos(caminho, campos) {
      const aninhado = aninhar(campos);
      const mask = Object.keys(campos).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(aninhado) }) });
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

/* { 'plano.pagoAte': x, email: y } -> { plano: { pagoAte: x }, email: y } (o corpo da gravacao com mascara) */
function aninhar(campos) {
  const aninhado = {};
  Object.keys(campos).forEach((k) => {
    const partes = k.split('.');
    let o = aninhado;
    partes.slice(0, -1).forEach((x) => { if (!o[x] || typeof o[x] !== 'object') o[x] = {}; o = o[x]; });
    o[partes[partes.length - 1]] = campos[k];
  });
  return aninhado;
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
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
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
