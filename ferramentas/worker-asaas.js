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
 *
 * Troca de plano e encerramento (o dono logado chama, pelo site; nada novo para configurar):
 *   POST /plano/simular  {planoId, tipo}  diz o que vai acontecer, sem mexer em nada
 *   POST /plano/trocar   {planoId, tipo}  faz a troca
 *   POST /plano/encerrar                  cancela a assinatura no Asaas (nenhuma cobranca nova) e encerra a conta
 * Regras da troca, com assinatura em dia (uma assinatura so por conta, sempre):
 *   - mais lojas: paga agora so a diferenca dos dias que faltam (cobranca avulsa do Asaas); as lojas a mais liberam
 *     quando ela cai. Diferenca menor que R$ 5 (a menor cobranca do Asaas) libera na hora, sem cobrar.
 *   - menos lojas: o limite desce na hora (as lojas abertas tem que caber) e o valor menor vem na proxima fatura, sem
 *     devolucao; voltar a subir no mesmo ciclo, ate o plano ja pago, nao cobra de novo.
 *   - mensal/anual: vale na proxima fatura.
 *   - a assinatura do Asaas passa para o valor novo na hora (as proximas faturas e as pendentes ja vem certas).
 *   - a diferenca e pelo que foi PAGO no ciclo (cicloPago), e um plano maior pago adiantado so vale quando o periodo
 *     dele comeca (planoProximo; o Cron de todo dia vira).
 * Rede de seguranca: pagamento de uma assinatura nova cancela a velha (nunca duas cobrando); cobranca de assinatura
 * de conta encerrada e devolvida sozinha; pagamento com e-mail sem conta no Ligeiro nao cria conta e avisa o admin.
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
      /* a diferenca de uma troca de plano: libera o plano maior, sem somar dias */
      if (/^troca\|/.test(String(real.externalReference || ''))) return await pagouDiferenca(env, fb, real, email, conta);
      /* e-mail que nao tem conta no Ligeiro (digitou outro no Asaas): antes nascia uma conta fantasma paga e a de verdade
         ficava travada. Agora nao cria nada e o admin recebe um e-mail para acertar na Central */
      if (!conta) {
        await avisarAdmin(env, 'Pagamento sem conta no Ligeiro', 'Entrou ' + reais(centavos) + ' do e-mail ' + email + ', que nao tem conta no Ligeiro. Ache o dono (Asaas > Clientes), corrija o e-mail do cliente no Asaas e confirme o pagamento na conta certa, na Central. Cobranca ' + pag.id + '.');
        return json({ ok: true, ignorado: 'sem conta no Ligeiro' });
      }
      const sub = pag.subscription && /^[A-Za-z0-9_-]{1,80}$/.test(String(pag.subscription)) ? String(pag.subscription) : '';
      const antigas = Array.isArray(conta.assinaturasAntigas) ? conta.assinaturasAntigas : [];
      let subCancelada = '', subCanceladaApagada = false;
      /* conta encerrada e a assinatura dela cobrou mesmo assim: devolve e cancela (uma assinatura nova e reativacao, vale) */
      if (p.status === 'cancelado' && sub && (sub === conta.assinaturaAsaas || antigas.indexOf(sub) >= 0)) {
        const devolveu = await estornar(env, pag.id, 'Assinatura encerrada no Ligeiro');
        const apagou = await apagarAssinatura(env, sub);
        if (devolveu) {
          const volta = { pagamentos: (conta.pagamentos || []).concat([pag.id]).slice(-50), estornosAutomaticos: (conta.estornosAutomaticos || []).concat([{ id: pag.id, motivo: 'conta encerrada', em: new Date().toISOString() }]).slice(-20), atualizadoEm: new Date().toISOString() };
          /* so esquece a assinatura se o Asaas cancelou mesmo; senao o Cron de todo dia tenta de novo */
          if (apagou) { volta.assinaturaAsaas = ''; volta.assinaturasAntigas = juntar(antigas, sub); }
          await fb.merge('contas/' + encodeURIComponent(email), volta);
          return json({ ok: true, devolvido: pag.id });
        }
        /* boleto nao tem estorno pela API: o dinheiro entrou, entao vale (a conta volta a ativa) e o admin fica sabendo */
        subCancelada = sub; subCanceladaApagada = apagou;
        await avisarAdmin(env, 'Pagamento depois de encerrar', 'A conta ' + email + ' estava encerrada e pagou ' + reais(centavos) + ' (cobranca ' + pag.id + '). Nao deu para devolver sozinho: a assinatura foi cancelada e os dias entraram. Veja com o cliente se ele quer continuar ou a devolucao.');
      }

      /* quem assina no periodo gratis nao perde os dias que faltam: os dias pagos contam depois do gratis (igual a Central
         ao confirmar um pagamento e igual ao R.assinatura do site, que usa o maior entre o pago e o fim do gratis) */
      const agoraMs = Date.now();
      const agoraIso = new Date(agoraMs).toISOString();
      const inicio = p.desde ? new Date(p.desde).getTime() : NaN;
      const fimGratis = isFinite(inicio) ? inicio + DIAS_GRATIS * 864e5 : 0;
      const base = Math.max(agoraMs, p.pagoAte ? new Date(p.pagoAte).getTime() || 0 : 0, fimGratis);
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
          await fb.merge('publico/fundadores', { usados: usados + 1, atualizadoEm: agoraIso });
        } else if (cheio > 0) {
          parcial = { cobrado: centavos, cheio: cheio, motivo: 'fundador-sem-vaga' };
        }
      } else if (!plano.preco && cheio > 0 && centavos < cheio) {
        parcial = { cobrado: centavos, cheio: cheio, motivo: 'valor-diferente' };
      }
      if (parcial) dias = Math.max(0, Math.floor((dias * parcial.cobrado) / parcial.cheio));
      const pagoAte = new Date(base + dias * 864e5).toISOString();
      /* uma assinatura NOVA (o primeiro pagamento dela, pelo link) traz a escolha de quem pagou: o plano e o tipo dela */
      const novaAssinatura = !!sub && !subCancelada && antigas.indexOf(sub) < 0 && sub !== String(conta.assinaturaAsaas || '');
      /* Pagamento de um periodo que ainda vai comecar (renovou adiantado, ou pagou um link com dias sobrando): o plano pago
         so vale quando esse periodo comecar (o Cron de todo dia vira). Antes, um plano maior pago adiantado liberava as
         lojas na hora, e dava para pular a diferenca da troca */
      const cicloAtual = conta.cicloPago && conta.cicloPago.plano ? conta.cicloPago : { plano: String(p.planoPago || ''), tipo: String(p.tipoPago || p.tipo || plano.tipo) };
      const futuro = base > agoraMs + 864e5 && !!p.planoPago;
      /* ja tinha um plano pago adiantado esperando: este periodo vem depois dele, entao compara com ele */
      const agendado = conta.planoProximo && conta.planoProximo.id ? conta.planoProximo : null;
      const referencia = agendado ? { plano: agendado.id, tipo: agendado.tipo } : cicloAtual;
      const vira = futuro && (plano.id !== referencia.plano || plano.tipo !== referencia.tipo);
      /* so os campos deste pagamento (a escolha do dono, planoId e tipo, fica: uma troca no mesmo instante nao se perde) */
      const campos = {
        email: email, pagamentos: ((conta && conta.pagamentos) || []).concat([pag.id]).slice(-50), clienteAsaas: String(pag.customer), atualizadoEm: agoraIso,
        'plano.status': 'ativo', 'plano.pagoAte': pagoAte, 'plano.avisoPagamentoEm': '', 'plano.avisoValor': 0,
        'plano.ultimoPagamentoEm': agoraIso, 'plano.cobrancaAsaas': pag.id, 'plano.fundador': fundador,
        /* pago a menos: guarda o que entrou e o que faltava (a Central e o painel mostram; ninguem ganha o mes inteiro) */
        'plano.pagamentoParcial': parcial ? Object.assign({ em: agoraIso, dias: dias }, parcial) : null,
      };
      if (!p.planoId || novaAssinatura) campos['plano.planoId'] = plano.id;
      if (!p.tipo || novaAssinatura) campos['plano.tipo'] = plano.tipo;
      if (vira && agendado) {
        /* dois planos diferentes pagos adiantado: um lugar so. Fica o MENOR (ninguem ganha loja sem pagar) e o admin confere */
        const menor = (LOJAS_DO_PLANO[plano.id] || 1) < (LOJAS_DO_PLANO[agendado.id] || 1) ? { id: plano.id, tipo: plano.tipo } : { id: agendado.id, tipo: agendado.tipo };
        campos.planoProximo = Object.assign({}, agendado, menor);
        await avisarAdmin(env, 'Dois planos pagos adiantado', 'A conta ' + email + ' pagou adiantado o plano de ' + (LOJAS_DO_PLANO[agendado.id] || 1) + ' e depois o de ' + (LOJAS_DO_PLANO[plano.id] || 1) + ' lojas (cobrança ' + pag.id + '). Ficou o menor a partir de ' + String(agendado.desde).slice(0, 10) + '. Confira na Central.');
      } else if (vira) campos.planoProximo = { id: plano.id, tipo: plano.tipo, desde: new Date(base).toISOString(), pagamento: pag.id };
      else if (!futuro) {
        campos['plano.planoPago'] = plano.id; campos['plano.tipoPago'] = plano.tipo; campos.cicloPago = { plano: plano.id, tipo: plano.tipo };
        if (conta.planoProximo) campos.planoProximo = null;
      }
      /* a fatura que estava em aberto e esta: sai do painel */
      if (conta.faturaAsaas && conta.faturaAsaas.id === pag.id) campos.faturaAsaas = null;
      /* uma assinatura so por conta: pagou por uma nova (link aberto de novo, por exemplo), a velha e cancelada no Asaas
         e nunca mais cobra. Pagamento atrasado de uma velha ja cancelada vale os dias, sem mexer na atual */
      if (subCancelada) {
        if (subCanceladaApagada) { campos.assinaturaAsaas = ''; campos.assinaturasAntigas = juntar(antigas, subCancelada); }
      } else if (sub && antigas.indexOf(sub) < 0) {
        const velha = conta.assinaturaAsaas && conta.assinaturaAsaas !== sub ? String(conta.assinaturaAsaas) : '';
        let antigasNovas = antigas;
        if (velha) { await apagarAssinatura(env, velha); antigasNovas = juntar(antigasNovas, velha); }
        /* outra assinatura que so tinha fatura (nunca pagou): tambem sai, para nao virar cobranca em dobro depois */
        const pendente = conta.assinaturaPendente && conta.assinaturaPendente !== sub ? String(conta.assinaturaPendente) : '';
        if (pendente) { await apagarAssinatura(env, pendente); antigasNovas = juntar(antigasNovas, pendente); }
        if (antigasNovas !== antigas) campos.assinaturasAntigas = antigasNovas;
        campos.assinaturaAsaas = sub;
      }
      if (conta.assinaturaPendente && (conta.assinaturaPendente === sub || campos.assinaturaAsaas)) campos.assinaturaPendente = '';
      /* a fatura do plano novo foi paga (para o periodo de agora) antes da diferenca: a diferenca nao e mais devida e sai */
      const troca = conta.trocaPlano && conta.trocaPlano.id ? conta.trocaPlano : null;
      if (troca && !futuro && (LOJAS_DO_PLANO[plano.id] || 1) >= (LOJAS_DO_PLANO[troca.para] || 1)) { await apagarCobranca(env, troca.id); campos.trocaPlano = null; }
      await fb.mergeCampos('contas/' + encodeURIComponent(email), campos);

      const efetivo = Object.assign({}, p, {
        status: 'ativo', pagoAte: pagoAte, avisoPagamentoEm: '', avisoValor: 0, desde: p.desde || agoraIso,
        planoId: campos['plano.planoId'] || p.planoId, tipo: campos['plano.tipo'] || p.tipo, planoPago: campos['plano.planoPago'] || p.planoPago || '',
      });
      const lojas = await espelharPlano(env, fb, email, efetivo);
      /* lojas abertas alem do plano pago (desceu e reabriu, por exemplo): o admin fica sabendo */
      const abertas = (await fb.lojasDoDono(email)).filter((l) => l.ativa !== false).length;
      if (!vira && abertas > (LOJAS_DO_PLANO[efetivo.planoPago] || 1)) await avisarAdmin(env, 'Lojas além do plano', 'A conta ' + email + ' tem ' + abertas + ' lojas abertas e pagou o plano de ' + (LOJAS_DO_PLANO[efetivo.planoPago] || 1) + '. Veja na Central.');
      return json({ ok: true, email: email, plano: plano.id, tipo: plano.tipo, pagoAte: pagoAte, lojas: lojas.length, vira: vira ? plano.id : '' });
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
      virarPlanos(env).then((r) => console.log('planos', JSON.stringify(r))).catch((e) => console.error('planos', e && e.message || e)),
    ]);
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
/* quem pode chamar as rotas do dono (o site) e quantas lojas cabem em cada plano (igual ao config.js) */
const ORIGENS = ['https://ligeiropedidos.com.br', 'https://www.ligeiropedidos.com.br', 'https://ligeiropedidos.github.io', 'http://localhost:8765'];
const LOJAS_DO_PLANO = { uma: 1, duas: 2, tres: 3, cinco: 5, oito: 8 };
const EMAIL_EQUIPE = /^equipe-[a-z0-9-]+@equipe\.(ligeiropedidos\.com\.br|ligeiro\.app\.br)$/i;
const ADMIN = 'ligeiro.pedidos@gmail.com';
/* a menor cobranca que o Asaas aceita (R$ 5): diferenca menor que isso libera na hora, sem cobrar */
const MINIMO_ASAAS = 500;
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
      texto: 'Sua mensalidade do Ligeiro vence em 3 dias. Pague pela fatura e suas lojas seguem recebendo pedidos sem parar.' },
    d0: { assunto: 'Sua mensalidade do Ligeiro vence hoje', quando: 'Vence hoje · ' + dia, tom: 'vence',
      titulo: 'Último dia', sub: ['Ainda dá tempo', 'de pagar sem atraso.'],
      texto: 'Sua mensalidade do Ligeiro vence hoje. É só pagar pela fatura: leva menos de um minuto.' },
    vencida: { assunto: 'Sua mensalidade do Ligeiro venceu', quando: 'Venceu em ' + dia, tom: 'venceu',
      titulo: 'Fatura vencida', sub: ['Calma, ainda dá', 'tempo de resolver.'],
      texto: naoPassou + 'Sua mensalidade do Ligeiro venceu. Suas lojas seguem no ar por mais alguns dias: pague pela fatura para não parar.' },
    vencida7: { assunto: 'Suas lojas podem parar de receber pedidos', quando: 'Venceu em ' + dia, tom: 'parar',
      titulo: 'Fatura atrasada', sub: ['Este é o último', 'lembrete que mandamos.'],
      texto: naoPassou + 'Sua mensalidade do Ligeiro venceu há uma semana e ainda não foi paga. Pague pela fatura para suas lojas não pararem de receber pedidos.' },
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
  const conta = await fb.get('contas/' + encodeURIComponent(email));
  /* so cobranca que liberou dias (esta nos pagamentos da conta) pausa alguma coisa */
  if (!conta || !Array.isArray(conta.pagamentos) || conta.pagamentos.indexOf(pag.id) < 0) return json({ ok: true, ignorado: 'cobranca que nao liberou dias' });
  const estornos = Array.isArray(conta.estornos) ? conta.estornos : [];
  if (estornos.some((x) => x && x.id === pag.id)) return json({ ok: true, repetido: pag.id });
  /* devolucao que o proprio Ligeiro fez (cobranca depois de encerrar, diferenca que nao era mais devida): nao e golpe, nao pausa */
  if ((conta.estornosAutomaticos || []).some((x) => x && x.id === pag.id)) return json({ ok: true, ignorado: 'devolvido pelo Ligeiro' });
  const agora = new Date().toISOString();
  const p = conta.plano || {};
  const pausa = {
    plano: Object.assign({}, p, { status: 'pausado', pausadoEm: agora, motivoPausa: 'estorno' }),
    estornos: estornos.concat([{ id: pag.id, status: st, em: agora }]).slice(-20), atualizadoEm: agora,
  };
  /* o pagamento adiantado foi estornado: o plano que ele agendou nao vale mais */
  if (conta.planoProximo && conta.planoProximo.pagamento === pag.id) pausa.planoProximo = null;
  await fb.merge('contas/' + encodeURIComponent(email), pausa);
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
  const velhas = Array.isArray(conta.assinaturasAntigas) ? conta.assinaturasAntigas : [];
  const daVelha = velhas.indexOf(String(real.subscription)) >= 0;
  const aberta = (st === 'PENDING' || st === 'OVERDUE') && real.deleted !== true && evento !== 'PAYMENT_DELETED' && !daVelha;
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

/* ---------------- troca de plano e encerramento (o dono logado pede, pelo site) ----------------
   A conta tem uma assinatura so no Asaas. Trocar de plano muda o valor DESSA assinatura (nunca cria outra, que cobraria
   em dobro no cartao); subir de plano cobra so a diferenca dos dias que faltam; encerrar cancela a assinatura no Asaas */
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
      const d = await decidirTroca(env, fb, email, conta, String(corpo.planoId || ''), String(corpo.tipo || ''), Date.now());
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
function precoDe(planos, id, tipo, fundador) {
  const p = planos[id] || {};
  return Math.round(Number(fundador ? p[tipo === 'anual' ? 'fa' : 'fm'] : p[tipo === 'anual' ? 'anual' : 'mensal']) || 0);
}

/* O que a troca faz, sem mexer em nada. acao:
   'marcar'    sem assinatura viva no Asaas (teste gratis, encerrada): so marca a escolha; o proximo pagamento ja e dela
   'proxima'   mensal/anual, ou assinatura ainda sem a primeira paga: o valor novo vem na proxima fatura
               (desce: menos lojas, o limite de lojas desce na hora e o valor menor vem na proxima fatura, sem devolucao)
   'agora'     mais lojas ja pagas neste ciclo, ou diferenca menor que R$ 5: libera na hora, sem cobrar
   'diferenca' mais lojas: cobra so a diferenca dos dias que faltam e libera quando ela cai
   'igual'     nada muda
   A diferenca e pelo que foi PAGO neste ciclo (cicloPago: plano e tipo que o Asaas cobrou), nunca pelo que a assinatura
   vai cobrar depois: trocar anual por mensal e depois subir nao faz a diferenca sair pelo preco do mes */
async function decidirTroca(env, fb, email, conta, planoId, tipo, agora) {
  const planos = lerPlanos(env);
  if (!Object.prototype.hasOwnProperty.call(planos, planoId) || !LOJAS_DO_PLANO[planoId]) return { erro: 'Esse plano não existe.', status: 400 };
  if (tipo !== 'mensal' && tipo !== 'anual') return { erro: 'Escolha mensal ou anual.', status: 400 };
  const p = conta.plano || {};
  if (p.status === 'pausado') return { erro: 'Sua conta está pausada. Fale com o Ligeiro.', status: 409 };
  /* as lojas abertas tem que caber no plano novo (contadas aqui, no servidor; loja fechada nao conta) */
  const abertas = (await fb.lojasDoDono(email)).filter((l) => l.ativa !== false).length;
  if (abertas > LOJAS_DO_PLANO[planoId]) return { erro: 'Você tem ' + abertas + ' lojas abertas e esse plano permite ' + LOJAS_DO_PLANO[planoId] + '. Para descer de plano, fale com o Ligeiro e diga qual loja fechar.', status: 409 };
  const subId = String(conta.assinaturaAsaas || conta.assinaturaPendente || '');
  const assinatura = subId ? await asaas(env, '/subscriptions/' + encodeURIComponent(subId)).catch((e) => { if (e && e.status === 404) return null; throw e; }) : null;
  const viva = !!assinatura && assinatura.deleted !== true && String(assinatura.status || 'ACTIVE') === 'ACTIVE';
  if (!viva) {
    const valor = precoDe(planos, planoId, tipo, p.fundador === true);
    if (!(valor > 0)) return { erro: 'Esse plano não está à venda.', status: 400 };
    return { acao: 'marcar', planoId: planoId, tipo: tipo, valorNovo: valor, assinaturaMorta: subId };
  }
  if (p.status === 'cancelado') return { erro: 'Sua assinatura está encerrada. Reative em Minha conta antes de trocar de plano.', status: 409 };
  const valorAtual = Math.round(Number(assinatura.value || 0) * 100);
  /* fundador: o de sempre, ou quem assinou pelo link de fundador e ainda nao pagou a primeira (o preco trava no pagamento) */
  const fundador = p.fundador === true || (!p.ultimoPagamentoEm && descobrirPlano(env, valorAtual, {}).preco === 'fundador');
  const valorNovo = precoDe(planos, planoId, tipo, fundador);
  if (!(valorNovo > 0)) return { erro: 'Esse plano não está à venda.', status: 400 };
  const d = {
    planoId: planoId, tipo: tipo, valorNovo: valorNovo, sub: subId, cliente: String(assinatura.customer || conta.clienteAsaas || ''),
    valorAtual: valorAtual, cicloAssinatura: assinatura.cycle === 'YEARLY' ? 'anual' : 'mensal',
    proxima: /^\d{4}-\d{2}-\d{2}$/.test(String(assinatura.nextDueDate || '')) ? String(assinatura.nextDueDate) : '',
  };
  const limite = String(p.planoPago || '');
  const pagoAte = Date.parse(p.pagoAte || '') || 0;
  /* assinou e a primeira fatura ainda nao caiu: a fatura pendente ja muda para o valor novo */
  if (!limite) return Object.assign(d, { acao: 'proxima' });
  /* atrasada: primeiro paga o que deve (a fatura vencida e do plano de antes) */
  if (!(pagoAte > agora)) return { erro: 'Pague a fatura em aberto antes de trocar de plano.', status: 409 };
  /* conta paga antes do cicloPago existir: o ciclo e o de agora, lido ANTES de qualquer troca (o executar grava junto) */
  const ciclo = conta.cicloPago && conta.cicloPago.plano ? conta.cicloPago : { plano: limite, tipo: String(p.tipoPago || d.cicloAssinatura) };
  if (!(conta.cicloPago && conta.cicloPago.plano)) d.cicloNovo = { plano: ciclo.plano, tipo: ciclo.tipo === 'anual' ? 'anual' : 'mensal' };
  d.fundador = fundador;
  const lojasNovo = LOJAS_DO_PLANO[planoId], lojasLimite = LOJAS_DO_PLANO[limite] || 1, lojasCiclo = Math.max(lojasLimite, LOJAS_DO_PLANO[ciclo.plano] || 1);
  const pendente = !!(conta.trocaPlano && conta.trocaPlano.id);
  if (lojasNovo < lojasLimite) return Object.assign(d, { acao: 'proxima', desce: true });
  if (lojasNovo === lojasLimite) {
    const nada = planoId === String(p.planoId || limite) && tipo === String(p.tipo || d.cicloAssinatura) && valorAtual === valorNovo && d.cicloAssinatura === tipo && !pendente;
    return Object.assign(d, { acao: nada ? 'igual' : 'proxima' });
  }
  /* mais lojas, mas ja pagas neste ciclo (desceu e voltou): libera, sem cobrar de novo */
  if (lojasNovo <= lojasCiclo) return Object.assign(d, { acao: 'agora', diferenca: 0 });
  /* mais lojas: a diferenca entre o plano novo e o pago, no preco do ciclo pago, pelos dias que faltam dele */
  const cicloTipo = ciclo.tipo === 'anual' ? 'anual' : 'mensal';
  const cicloDias = cicloTipo === 'anual' ? 365 : 30;
  /* so os dias do periodo de agora: um periodo pago adiantado (planoProximo) ja tem o plano dele */
  const fimAgora = conta.planoProximo && conta.planoProximo.desde ? Math.min(pagoAte, Date.parse(conta.planoProximo.desde) || pagoAte) : pagoAte;
  const dias = Math.max(1, Math.min(400, Math.ceil((fimAgora - agora) / 864e5)));
  const diferenca = Math.max(0, Math.round((precoDe(planos, planoId, cicloTipo, fundador) - precoDe(planos, ciclo.plano, cicloTipo, fundador)) * dias / cicloDias));
  return Object.assign(d, { dias: dias, diferenca: diferenca, acao: diferenca < MINIMO_ASAAS ? 'agora' : 'diferenca' });
}
/* o que o site mostra (sem ids do Asaas) */
function resumoDaTroca(d) {
  return { acao: d.acao, planoId: d.planoId, tipo: d.tipo, valorNovo: d.valorNovo, diferenca: d.acao === 'diferenca' ? d.diferenca : 0, dias: d.dias || 0, proxima: d.proxima || '', desce: !!d.desce };
}

async function executarTroca(env, fb, email, conta, d) {
  const agora = new Date().toISOString();
  const caminho = 'contas/' + encodeURIComponent(email);
  if (d.acao === 'igual') return { status: 200, corpo: Object.assign({ ok: true }, resumoDaTroca(d)) };
  /* 1: a mesma assinatura no valor e no ciclo novos (as faturas pendentes mudam junto). Se o Asaas recusar, nada foi gravado */
  if (d.sub && (d.valorAtual !== d.valorNovo || d.cicloAssinatura !== d.tipo)) {
    await asaas(env, '/subscriptions/' + encodeURIComponent(d.sub), 'PUT', { value: d.valorNovo / 100, cycle: d.tipo === 'anual' ? 'YEARLY' : 'MONTHLY', updatePendingPayments: true });
  }
  const antiga = conta.trocaPlano && conta.trocaPlano.id ? conta.trocaPlano : null;
  /* a mesma troca pedida de novo (clique duplo, outra aba) e a cobranca dela ainda aberta no Asaas: a mesma, sem criar outra */
  if (antiga && d.acao === 'diferenca' && antiga.para === d.planoId && antiga.valor === d.diferenca && antiga.url) {
    const c = await asaas(env, '/payments/' + encodeURIComponent(antiga.id)).catch(() => null);
    if (c && c.deleted !== true && (c.status === 'PENDING' || c.status === 'OVERDUE')) {
      await fb.mergeCampos(caminho, { 'plano.planoId': d.planoId, 'plano.tipo': d.tipo, atualizadoEm: agora });
      return { status: 200, corpo: Object.assign({ ok: true, url: antiga.url }, resumoDaTroca(d)) };
    }
  }
  const campos = { 'plano.planoId': d.planoId, 'plano.tipo': d.tipo, atualizadoEm: agora };
  if (d.cicloNovo) campos.cicloPago = d.cicloNovo;
  if (d.acao === 'marcar' && d.assinaturaMorta) {
    if (d.assinaturaMorta === String(conta.assinaturaPendente || '')) campos.assinaturaPendente = '';
    else campos.assinaturaAsaas = '';
    campos.assinaturasAntigas = juntar(conta.assinaturasAntigas, d.assinaturaMorta);
  }
  /* 2: a diferenca de uma troca anterior sai do Asaas (ninguem paga duas) */
  if (antiga) { await apagarCobranca(env, antiga.id); campos.trocaPlano = null; }
  /* 3: o limite de lojas: sobe na hora (ja pago ou diferenca pequena) ou desce na hora (menos lojas) */
  if (d.acao === 'agora' || d.desce) campos['plano.planoPago'] = d.planoId;
  let nova = null;
  if (d.acao === 'diferenca') {
    if (!d.cliente) throw new Error('assinatura sem cliente');
    /* o Ligeiro avisa sozinho: o cliente no Asaas fica sem os avisos pagos (R$ 0,99 cada) */
    await asaas(env, '/customers/' + encodeURIComponent(d.cliente), 'PUT', { notificationDisabled: true }).catch((e) => console.error('avisos do cliente', e && e.message || e));
    nova = await asaas(env, '/payments', 'POST', {
      customer: d.cliente, billingType: 'UNDEFINED', value: d.diferenca / 100, dueDate: diaDeBrasiliaMais(3),
      description: 'Ligeiro: troca para o plano de ' + LOJAS_DO_PLANO[d.planoId] + (LOJAS_DO_PLANO[d.planoId] === 1 ? ' loja' : ' lojas') + ' (diferença de ' + d.dias + (d.dias === 1 ? ' dia' : ' dias') + ')',
      externalReference: 'troca|' + email + '|' + d.planoId,
    });
    campos.trocaPlano = { id: String(nova.id), para: d.planoId, tipo: d.tipo, valor: d.diferenca, dias: d.dias, url: urlDoAsaas(nova.invoiceUrl), criadaEm: agora };
  }
  /* outra troca no mesmo instante (outra aba): se ela ja mudou a diferenca ou a escolha, a nossa sai (a cobranca nova e o
     valor da assinatura voltam para a escolha que ficou) e o dono confere */
  const agoraConta = (await fb.get(caminho)) || {};
  const pa = conta.plano || {}, pb = agoraConta.plano || {};
  const idAntes = antiga ? String(antiga.id) : '';
  const idAgora = agoraConta.trocaPlano && agoraConta.trocaPlano.id ? String(agoraConta.trocaPlano.id) : '';
  if (idAgora !== idAntes || String(pa.planoId || '') !== String(pb.planoId || '') || String(pa.tipo || '') !== String(pb.tipo || '')) {
    if (nova) await apagarCobranca(env, nova.id);
    const valorFica = precoDe(lerPlanos(env), String(pb.planoId || ''), String(pb.tipo || 'mensal'), !!d.fundador);
    if (d.sub && valorFica > 0 && valorFica !== d.valorNovo) {
      await asaas(env, '/subscriptions/' + encodeURIComponent(d.sub), 'PUT', { value: valorFica / 100, cycle: pb.tipo === 'anual' ? 'YEARLY' : 'MONTHLY', updatePendingPayments: true }).catch((e) => console.error('volta da assinatura', e && e.message || e));
    }
    return { status: 409, corpo: { ok: false, erro: 'Outra troca foi feita agora mesmo. Confira em Minha conta.' } };
  }
  await fb.mergeCampos(caminho, campos);
  const p = agoraConta.plano || conta.plano || {};
  await espelharPlano(env, fb, email, Object.assign({}, p, { planoId: d.planoId, tipo: d.tipo, planoPago: campos['plano.planoPago'] || p.planoPago || '' }));
  return { status: 200, corpo: Object.assign({ ok: true, url: campos.trocaPlano ? campos.trocaPlano.url : '' }, resumoDaTroca(d)) };
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
  if (conta.trocaPlano && conta.trocaPlano.id) await apagarCobranca(env, conta.trocaPlano.id);
  const canceladoEm = p.status === 'cancelado' && p.canceladoEm ? p.canceladoEm : agora;
  const campos = { 'plano.status': 'cancelado', 'plano.canceladoEm': canceladoEm, trocaPlano: null, atualizadoEm: agora };
  let antigas = conta.assinaturasAntigas;
  if (sub && cancelou) { campos.assinaturaAsaas = ''; antigas = juntar(antigas, sub); campos.faturaAsaas = null; }
  if (pendente && cancelouPendente) { campos.assinaturaPendente = ''; antigas = juntar(antigas, pendente); campos.faturaAsaas = null; }
  if (antigas !== conta.assinaturasAntigas) campos.assinaturasAntigas = antigas;
  await fb.mergeCampos('contas/' + encodeURIComponent(email), campos);
  await espelharPlano(env, fb, email, Object.assign({}, p, { status: 'cancelado', canceladoEm: canceladoEm }));
  return { status: 200, corpo: { ok: true, cancelada: !!sub && cancelou } };
}

/* Caiu a diferenca de uma troca: o plano maior vale agora (os dias continuam os mesmos) */
async function pagouDiferenca(env, fb, real, email, conta) {
  const partes = String(real.externalReference || '').split('|');
  const para = partes[2] || '';
  const centavos = Math.round(Number(real.value || 0) * 100);
  if (!conta || partes[1] !== email || !LOJAS_DO_PLANO[para]) {
    await avisarAdmin(env, 'Diferença de plano sem dono', 'Entrou ' + reais(centavos) + ' (cobrança ' + real.id + ', cliente ' + email + ') de uma troca de plano que não bate com nenhuma conta. Confira no Asaas.');
    return json({ ok: true, ignorado: 'troca sem conta' });
  }
  const caminho = 'contas/' + encodeURIComponent(email);
  const p = conta.plano || {};
  const t = conta.trocaPlano && conta.trocaPlano.id ? conta.trocaPlano : null;
  const eAtual = !!t && t.id === String(real.id);
  const agora = new Date().toISOString();
  const campos = { pagamentos: (conta.pagamentos || []).concat([String(real.id)]).slice(-50), atualizadoEm: agora };
  /* diferenca que nao e mais a pedida (encerrou, trocou de novo ou a fatura do plano novo ja pagou): nao muda o plano, devolve.
     Subir por ela passaria por cima da escolha mais nova do dono */
  if (p.status === 'cancelado' || !eAtual) {
    const devolveu = await estornar(env, real.id, 'Diferença de plano que não era mais devida');
    if (!devolveu) await avisarAdmin(env, 'Diferença paga a mais', 'A conta ' + email + ' pagou ' + reais(centavos) + ' de uma diferença de plano que não era mais devida (cobrança ' + real.id + ') e não deu para devolver sozinho. Devolva pelo Asaas.');
    campos.estornosAutomaticos = (conta.estornosAutomaticos || []).concat([{ id: String(real.id), motivo: 'diferença não devida', devolvido: devolveu, em: agora }]).slice(-20);
    await fb.mergeCampos(caminho, campos);
    return json({ ok: true, devolvido: devolveu ? real.id : '' });
  }
  const tipoCiclo = conta.cicloPago && conta.cicloPago.tipo ? conta.cicloPago.tipo : String(p.tipoPago || p.tipo || 'mensal');
  Object.assign(campos, { 'plano.planoPago': para, 'plano.planoId': t.para, trocaPlano: null, cicloPago: { plano: para, tipo: tipoCiclo } });
  await fb.mergeCampos(caminho, campos);
  await espelharPlano(env, fb, email, Object.assign({}, p, { planoPago: para, planoId: t.para }));
  return json({ ok: true, troca: para });
}

/* Chegou a hora de um plano pago adiantado (planoProximo): vira o plano que vale. Todo dia, pelo Cron */
async function virarPlanos(env) {
  const fb = await firebase(env);
  const agora = new Date().toISOString();
  const contas = await fb.consultarAte('contas', 'planoProximo.desde', agora);
  let viradas = 0;
  let falhas = 0;
  for (const c of contas) {
    const prox = c.planoProximo;
    const email = String(c._id || '');
    if (!prox || !LOJAS_DO_PLANO[prox.id] || email.indexOf('@') < 1) continue;
    /* pausada (estorno, contestacao): espera o admin */
    if ((c.plano || {}).status === 'pausado') continue;
    try {
      const campos = { 'plano.planoPago': prox.id, 'plano.tipoPago': prox.tipo === 'anual' ? 'anual' : 'mensal', cicloPago: { plano: prox.id, tipo: prox.tipo === 'anual' ? 'anual' : 'mensal' }, planoProximo: null, atualizadoEm: agora };
      /* a diferenca que ainda estava aberta para esse plano (ou menor) nao e mais devida: o periodo novo ja foi pago */
      const t = c.trocaPlano;
      if (t && t.id && LOJAS_DO_PLANO[prox.id] >= (LOJAS_DO_PLANO[t.para] || 1)) { await apagarCobranca(env, t.id); campos.trocaPlano = null; }
      await fb.mergeCampos('contas/' + encodeURIComponent(email), campos);
      await espelharPlano(env, fb, email, Object.assign({}, c.plano || {}, { planoPago: prox.id }));
      /* desceu pelo link com mais lojas abertas do que o plano novo deixa: o admin fica sabendo */
      const abertas = (await fb.lojasDoDono(email)).filter((l) => l.ativa !== false).length;
      if (abertas > LOJAS_DO_PLANO[prox.id]) await avisarAdmin(env, 'Lojas além do plano', 'A conta ' + email + ' tem ' + abertas + ' lojas abertas e o plano pago agora é de ' + LOJAS_DO_PLANO[prox.id] + '. Veja na Central.');
      viradas++;
    } catch (e) { falhas++; console.error('virar plano', e && e.message || e); }
  }
  return { ok: true, viradas: viradas, falhas: falhas };
}

/* O plano da conta copiado em cada loja e na vitrine; a copia da loja na borda sai (a proxima visita ja le a nova) */
async function espelharPlano(env, fb, email, p) {
  const agora = new Date().toISOString();
  const espelho = { status: p.status || 'teste', tipo: p.tipo || 'mensal', planoId: p.planoId || 'uma', planoPago: p.planoPago || '', desde: p.desde || agora, pagoAte: p.pagoAte || '', avisoPagamentoEm: p.avisoPagamentoEm || '', avisoValor: Number(p.avisoValor) || 0 };
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
    const sub = String(c.assinaturaAsaas || '');
    if (!sub || !(await apagarAssinatura(env, sub))) continue;
    await fb.merge('contas/' + encodeURIComponent(String(c._id)), { assinaturaAsaas: '', assinaturasAntigas: juntar(c.assinaturasAntigas, sub), faturaAsaas: null, atualizadoEm: new Date().toISOString() });
    canceladas++;
  }
  /* a pendente de conta encerrada fica: pode ser a de quem esta voltando (assinou de novo e ainda nao pagou) */
  return { ok: true, encerradas: contas.length, canceladas: canceladas };
}

/* no Asaas: cancelar assinatura, apagar cobranca e devolver. Ja apagada (404) conta como feito; outro erro vai pro log */
async function apagarAssinatura(env, id) {
  try { await asaas(env, '/subscriptions/' + encodeURIComponent(id), 'DELETE'); return true; } catch (e) { if (e && e.status === 404) return true; console.error('apagar assinatura', e && e.message || e); return false; }
}
async function apagarCobranca(env, id) {
  try { await asaas(env, '/payments/' + encodeURIComponent(id), 'DELETE'); return true; } catch (e) { if (e && e.status === 404) return true; console.error('apagar cobranca', e && e.message || e); return false; }
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
function diaDeBrasiliaMais(dias) { return new Date(Date.now() - 3 * 36e5 + dias * 864e5).toISOString().slice(0, 10); }
function urlDoAsaas(u) { return /^https:\/\/(www\.)?asaas\.com\/[A-Za-z0-9/_-]{1,200}$/.test(String(u || '')) ? String(u) : ''; }
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
    async get(caminho) {
      const r = await fetch(base + caminho, { headers: cab });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Firestore get ' + r.status);
      return deFirestore((await r.json()).fields || {});
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
      const aninhado = {};
      Object.keys(campos).forEach((k) => {
        const partes = k.split('.');
        let o = aninhado;
        partes.slice(0, -1).forEach((x) => { if (!o[x] || typeof o[x] !== 'object') o[x] = {}; o = o[x]; });
        o[partes[partes.length - 1]] = campos[k];
      });
      const mask = Object.keys(campos).map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
      const r = await fetch(base + caminho + '?' + mask, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields: camposFirestore(aninhado) }) });
      if (!r.ok) throw new Error('Firestore patch ' + r.status + ' ' + (await r.text()).slice(0, 200));
    },
    /* as lojas do dono com o "ativa" (loja fechada pelo dono nao conta no plano) */
    async lojasDoDono(email) {
      const q = { structuredQuery: { from: [{ collectionId: 'lojas' }], where: { fieldFilter: { field: { fieldPath: 'donoEmail' }, op: 'EQUAL', value: { stringValue: email } } }, select: { fields: [{ fieldPath: 'slug' }, { fieldPath: 'ativa' }] } } };
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: cab, body: JSON.stringify(q) });
      if (!r.ok) throw new Error('Firestore query ' + r.status);
      const linhas = await r.json();
      return linhas.filter((l) => l.document).map((l) => ({ slug: l.document.name.split('/').pop(), ativa: deFirestore(l.document.fields || {}).ativa }));
    },
    /* documentos inteiros (com _id) em que o campo (texto) e ate o valor dado */
    async consultarAte(colecao, campo, valor) {
      const q = { structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: valor } } }, limit: 500 } };
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: cab, body: JSON.stringify(q) });
      if (!r.ok) throw new Error('Firestore query ' + r.status);
      const linhas = await r.json();
      return linhas.filter((l) => l.document).map((l) => Object.assign(deFirestore(l.document.fields || {}), { _id: decodeURIComponent(l.document.name.split('/').pop()) }));
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
