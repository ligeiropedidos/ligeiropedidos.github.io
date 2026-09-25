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
