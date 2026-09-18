/*
 * Ligeiro - painel do Ligeiro (o Mateus): cadastrar estabelecimentos,
 * ver quem esta ativo e entregar os links pro dono.
 */
(function () {
  'use strict';

  var UI = window.LigeiroUI;
  var R = window.LigeiroRegras;
  var D = window.LigeiroDados;
  var store = D.store;
  var el = UI.el;
  var $ = UI.$;

  var TIPOS = [['Lanchonete', '🍔'], ['Pizzaria', '🍕'], ['Marmitaria', '🍱'], ['Restaurante', '🍽️'], ['Sorveteria', '🍨'], ['Açaí', '🫐'], ['Padaria', '🥐'], ['Espetinho', '🍢'], ['Sushi', '🍣'], ['Outro', '🛵']];
  var MODELOS = [['vazio', 'Cardápio vazio (monto na loja)'], ['lanchonete-do-ze', 'Modelo de lanchonete'], ['dom-conizza', 'Modelo de pizzaria'], ['marmitaria-da-cida', 'Modelo de marmitaria'], ['sorveteria-da-lu', 'Modelo de sorveteria / açaí']];

  function abrir(raiz) {
    var chave = 'ligeiro:admin';
    function logado() { try { return sessionStorage.getItem(chave) === '1'; } catch (_) { return false; } }

    var parar = null;
    var vivo = true; /* saiu da tela antes do banco responder: nao desenha o admin por cima da outra pagina */
    var cfgA = window.LIGEIRO_CONFIG || {};
    function ehAdmin(u) { return !!(u && cfgA.adminEmail && String(u.email || '').toLowerCase() === String(cfgA.adminEmail).toLowerCase()); }
    /* demonstracao: vale a marca da sessao. Na nuvem a marca nao basta: sempre confere se o Google logado e o do Ligeiro. */
    if (D.modoDemo && logado()) { parar = montar(); return function () { if (parar) parar(); }; }
    if (!D.modoDemo && store.usuarioAtual) {
      raiz.appendChild(el('p', { class: 'centro muted', style: { padding: '40px 16px' }, text: 'Só um instante…' }));
      store.usuarioAtual().then(function (u) {
        if (!vivo) return;
        if (ehAdmin(u)) { try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ } parar = montar(); }
        else telaLogin();
      }).catch(function () { if (vivo) telaLogin(); });
      return function () { vivo = false; if (parar) parar(); };
    }
    telaLogin();
    return function () { if (parar) parar(); };

    function telaLogin() {
      UI.limpar(raiz);
      var erro = el('div', { class: 'msg-erro', hidden: true });
      var marca = el('div', { class: 'marca centro' }, [el('img', { class: 'mascote', src: 'img/mascote-192.png', alt: '' }), el('span', { html: 'Ligei<span>ro</span>' })]);
      /* na nuvem nao existe senha: so entra o Google do Ligeiro (adminEmail), e as regras do banco conferem de novo */
      if (!D.modoDemo) {
        raiz.appendChild(el('div', { class: 'login' }, [
          marca,
          el('h2', { class: 'centro', text: 'Painel do Ligeiro' }),
          el('p', { class: 'centro muted', text: 'Entre com a conta Google do Ligeiro.' }),
          erro,
          el('button', { class: 'btn btn-google btn-largo', type: 'button', text: 'Entrar com o Google', onclick: function () {
            store.entrarComGoogle().then(function (u) {
              if (!ehAdmin(u)) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Essa conta Google não é a do Ligeiro. Saia dela em "Minha conta" e entre com a certa.'; return; }
              try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ }
              parar = montar();
            }).catch(function (e) { erro.hidden = false; erro.textContent = e.message || 'Não deu pra entrar.'; });
          } }),
        ]));
        return;
      }
      var campo = el('input', { type: 'password', placeholder: '••••••', 'aria-label': 'Senha da demonstração' });
      function entrar() {
        store.entrarAdmin(campo.value).then(function (ok) {
          if (!ok) { UI.soar('erro'); erro.hidden = false; erro.textContent = 'Senha errada.'; campo.value = ''; return; }
          try { sessionStorage.setItem(chave, '1'); } catch (_) { /* ignora */ }
          parar = montar();
        });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
      raiz.appendChild(el('div', { class: 'login' }, [
        marca,
        el('h2', { class: 'centro', text: 'Painel do Ligeiro' }),
        el('p', { class: 'centro muted', text: 'Senha da demonstração: ligeiro' }),
        el('div', { class: 'campo' }, campo),
        erro,
        el('button', { class: 'btn btn-principal btn-largo', text: 'Entrar', onclick: entrar }),
      ]));
      setTimeout(function () { campo.focus(); }, 50);
    }

    function montar() {
      UI.limpar(raiz);
      raiz.appendChild(el('header', { class: 'painel-topo' }, [
        el('div', { class: 'nome', text: 'Ligeiro · estabelecimentos' }),
        el('button', { class: 'btn btn-pequeno', text: 'Ver as lojas', onclick: function () { window.LigeiroApp.ir('cidades'); } }),
        el('button', { class: 'btn btn-pequeno', text: 'Sair', onclick: function () { try { sessionStorage.removeItem(chave); } catch (_) { /* ignora */ } if (store.sair) store.sair(); telaLogin(); } }),
      ]));
      var secao = el('section', { class: 'secao', id: 'secaoAdmin' });
      raiz.appendChild(secao);
      desenhar();
      return store.assistir ? store.assistir(desenhar) : null;
    }

    function desenhar() {
      var s = $('secaoAdmin');
      if (!s) return;
      store.listarTodasLojas().catch(function () {
        UI.limpar(s); s.appendChild(UI.erroCarregar('Não deu pra carregar as lojas.', desenhar)); return null;
      }).then(function (lojas) {
        if (!lojas) return;
        UI.limpar(s);
        var ativas = lojas.filter(function (l) { return l.ativa !== false; });
        var cidades = {};
        ativas.forEach(function (l) { cidades[l.cidadeSlug] = true; });
        /* visao geral: contas pagando (pelo espelho do plano nas lojas), receita mensal, cidades */
        var contasVistas = {};
        var receita = 0, pagantes = 0, gratis = 0;
        ativas.forEach(function (l) {
          var chave = String(l.donoEmail || ('loja:' + l.slug)).toLowerCase();
          if (contasVistas[chave]) return;
          contasVistas[chave] = true;
          var a = R.assinatura(l);
          if ((a.estado === 'ativa' || a.estado === 'vencendo') && !a.cortesia && !a.gratis) {
            pagantes += 1;
            var p = l.plano || {};
            var contaDoPlano = { plano: p }; /* o espelho do plano na loja traz o "fundador" */
            receita += p.tipo === 'anual' ? Math.round(R.precoDoPlano(p.planoPago || p.planoId || 'uma', 'anual', contaDoPlano) / 12) : R.precoDoPlano(p.planoPago || p.planoId || 'uma', 'mensal', contaDoPlano);
          } else if (a.estado === 'gratis') gratis += 1;
        });
        s.appendChild(el('div', { class: 'metricas' }, [
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: String(ativas.length) }), el('div', { class: 'l', text: 'lojas em ' + Object.keys(cidades).length + (Object.keys(cidades).length === 1 ? ' cidade' : ' cidades') })]),
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: String(pagantes) }), el('div', { class: 'l', text: 'contas pagando · ' + R.dinheiro(receita) + '/mês' })]),
          el('div', { class: 'metrica' }, [el('div', { class: 'v', text: String(gratis) }), el('div', { class: 'l', text: 'no período grátis' })]),
        ]));
        var an = (window.LIGEIRO_CONFIG || {}).analytics || {};
        s.appendChild(el('p', { class: 'muted pequeno', text: an.cloudflareToken ? 'Visitas: painel do Cloudflare Web Analytics (grátis, sem cookie), na sua conta Cloudflare › Analytics.' : 'Visitas: cole o token do Cloudflare Web Analytics em config.js (analytics.cloudflareToken) e as visitas de cada página aparecem no painel do Cloudflare, de graça e sem cookie.' }));
        s.appendChild(el('div', { class: 'linha-botoes' }, [
          el('button', { class: 'btn btn-principal', text: '+ Cadastrar estabelecimento', onclick: novaLoja }),
          !D.modoDemo && store.reconstruirVitrine ? el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Reconstruir vitrine', title: 'Refaz o resumo leve de todas as lojas (hub e cidades)', onclick: function () { store.reconstruirVitrine().then(function (n) { UI.avisar('Vitrine refeita: ' + n + ' lojas.'); }).catch(function (e) { UI.avisar(e.message || 'Não deu.'); }); } }) : null,
          D.modoDemo ? el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Zerar demonstração', onclick: function () {
            UI.perguntar('Apagar tudo e voltar aos dados de exemplo? Só vale neste navegador.', { sim: 'Zerar', perigo: true }).then(function (sim) { if (sim) store.zerarDemo().then(function () { UI.avisar('Demonstração zerada'); }); });
          } }) : null,
        ]));
        /* assinaturas: uma por conta (e-mail do dono); confirmar aqui espelha nas lojas dela */
        var caixaContas = el('div', { class: 'pilha' });
        s.appendChild(caixaContas);
        if (store.listarContas) store.listarContas().then(function (contas) {
          if (!contas.length) return;
          caixaContas.appendChild(el('h2', { text: '💳 Assinaturas · ' + contas.length }));
          contas.forEach(function (c) { caixaContas.appendChild(cartaoConta(c, lojas)); });
        }).catch(function () { /* sem permissao: segue */ });

        /* contatos da pagina de vendas que ainda nao foram chamados */
        var caixaContatos = el('div', { class: 'pilha' });
        s.appendChild(caixaContatos);
        if (store.listarLeads) store.listarLeads().then(function (leads) {
          var pendentes = leads.filter(function (c) { return !c.atendidoEm; });
          if (!pendentes.length) return;
          caixaContatos.appendChild(el('h2', { text: '📞 Contatos pra chamar · ' + pendentes.length }));
          pendentes.forEach(function (c) {
            var quando = new Date(c.criadoEm);
            var msg = 'Oi' + (c.nome ? ', ' + c.nome.split(' ')[0] : '') + '! Aqui é do Ligeiro. Você deixou seu contato no nosso site' + (c.loja ? ' pra ' + c.loja : '') + '. Posso te mostrar como funciona?';
            caixaContatos.appendChild(el('div', { class: 'pedido-card novo' }, [
              el('div', { class: 'cabeca' }, [
                el('span', { class: 'senha', style: { fontSize: '20px' }, text: c.nome || 'Sem nome' }),
                el('span', { class: 'quando', text: quando.toLocaleDateString('pt-BR') + ' ' + quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }),
              ]),
              el('div', { class: 'endereco', text: (c.loja ? c.loja + ' · ' : '') + (c.cidade ? c.cidade + (c.uf ? '/' + c.uf : '') + ' · ' : '') + R.formatarTelefone(c.whatsapp) + (c.origem ? ' · veio de: ' + c.origem : '') }),
              el('div', { class: 'acoes' }, [
                el('a', { class: 'btn btn-whats btn-pequeno', href: R.linkWhatsapp(c.whatsapp, msg), target: '_blank', rel: 'noopener', text: '💬 Chamar no WhatsApp' }),
                el('button', { class: 'btn btn-fantasma btn-pequeno', text: '✓ Já chamei', onclick: function () { store.atualizarLead(c.id, { atendidoEm: new Date().toISOString() }).then(function () { UI.avisar('Contato marcado como atendido'); desenhar(); }); } }),
              ]),
            ]));
          });
        }).catch(function () { /* sem permissao ou sem colecao: segue */ });

        s.appendChild(el('h2', { text: 'Estabelecimentos' }));
        var lista = el('div', { class: 'pilha' });
        lojas.forEach(function (l) { lista.appendChild(cartaoLoja(l)); });
        if (lojas.length === 0) lista.appendChild(el('p', { class: 'muted', text: 'Nenhum ainda. Cadastre o primeiro.' }));
        s.appendChild(lista);
      }).catch(function (e) {
        /* erro ao montar: nunca deixar a tela em branco */
        UI.limpar(s); s.appendChild(UI.erroCarregar('Deu erro ao montar esta tela' + (e && e.message ? ': ' + e.message : '.'), desenhar));
      });
    }

    function cartaoConta(c, lojas) {
      var p = c.plano || {};
      var a = R.assinatura(c);
      var plano = R.planoPorId(p.planoId || 'uma');
      var minhas = lojas.filter(function (l) { return String(l.donoEmail || '').toLowerCase() === String(c.email || '').toLowerCase(); });
      function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }
      var textoA = {
        gratis: 'grátis até ' + (a.limite ? dataBR(a.limite) : ''), ativa: a.cortesia ? 'cortesia' : 'paga até ' + dataBR(a.limite),
        vencendo: 'vence ' + dataBR(a.limite), vencida: 'VENCIDA em ' + dataBR(a.limite), bloqueada: 'BLOQUEADA desde ' + dataBR(a.limite),
        pausada: 'pausada', cancelada: 'cancelada',
      }[a.estado] || a.estado;
      var primeiroPagamento = !p.ultimoPagamentoEm && !p.planoPago;
      var viraFundador = p.fundador !== true && primeiroPagamento && R.vagasFundador() > 0;
      var ocupado = false; /* um clique por vez: clique duplo contaria a vaga de fundador duas vezes */
      function confirmar(dias) {
        if (ocupado) return; ocupado = true;
        var base = Math.max(Date.now(), a.limite ? new Date(a.limite).getTime() : 0);
        var novo = new Date(base + dias * 864e5).toISOString();
        store.salvarConta(c.email, { plano: { status: 'ativo', tipo: dias > 31 ? 'anual' : (p.tipo || 'mensal'), pagoAte: novo, planoPago: plano.id, fundador: p.fundador === true || viraFundador, avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString() } })
          .then(function () { return viraFundador && store.ocuparVagaFundador ? store.ocuparVagaFundador().then(function (f) { window.LigeiroFundadores = { usados: f.usados }; }) : null; })
          .then(function () { return store.espelharPlanoNasLojas(c.email); })
          .then(function () { UI.avisar(c.email + ' liberada até ' + dataBR(novo) + ' (' + minhas.length + (minhas.length === 1 ? ' loja' : ' lojas') + ')'); desenhar(); })
          .catch(function (e) { ocupado = false; UI.avisar(e && e.message ? e.message : 'Não deu pra confirmar.'); });
      }
      var valorMensal = R.precoDoPlano(plano.id, 'mensal', c);
      var valorAnual = R.precoDoPlano(plano.id, 'anual', c);
      return el('div', { class: 'pedido-card' + (p.avisoPagamentoEm ? ' novo' : '') }, [
        el('div', { class: 'cabeca' }, [
          el('span', { class: 'senha', style: { fontSize: '18px' }, text: c.email }),
          el('span', { class: 'selo ' + (a.estado === 'ativa' || a.estado === 'gratis' ? '' : a.estado === 'vencendo' ? 'laranja' : 'cinza'), text: plano.nome + ' · ' + (p.tipo === 'anual' ? 'anual' : 'mensal') + ' · ' + textoA }),
          el('span', { class: 'quando', text: minhas.length + ' de ' + plano.lojas + (plano.lojas === 1 ? ' loja' : ' lojas') }),
          p.fundador === true ? el('span', { class: 'selo selo-fundador', text: '★ Fundador' }) : (viraFundador ? el('span', { class: 'selo laranja', text: 'vira fundador ao confirmar' }) : null),
        ]),
        el('div', { class: 'endereco', text: (minhas.length ? 'Lojas: ' + minhas.map(function (l) { return l.nome; }).join(', ') : 'Nenhuma loja criada ainda') }),
        p.avisoPagamentoEm ? el('div', { class: 'aviso', text: '💸 Avisou pagamento de ' + R.dinheiro(p.avisoValor || 0) + ' em ' + dataBR(p.avisoPagamentoEm) + '. Confira no banco e confirme.' }) : null,
        el('div', { class: 'acoes' }, [
          el('button', { class: 'btn btn-principal btn-pequeno', text: '✓ Pagou ' + R.dinheiro(valorMensal) + ' (+30 dias)', onclick: function () { confirmar(30); } }),
          valorAnual > 0 ? el('button', { class: 'btn btn-escuro btn-pequeno', text: '✓ Pagou ' + R.dinheiro(valorAnual) + ' (+1 ano)', onclick: function () { confirmar(365); } }) : null,
          el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Cortesia', onclick: function () { store.salvarConta(c.email, { plano: { status: 'ativo', pagoAte: '', planoPago: plano.id } }).then(function () { return store.espelharPlanoNasLojas(c.email); }).then(desenhar); } }),
          p.fundador === true
            ? el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Tirar fundador', title: 'Use quando a conta cancelar: ela perde o preço travado', onclick: function () { UI.perguntar('Tirar o preço de fundador de ' + c.email + '? A vaga não volta pro contador sozinha.', { sim: 'Tirar', perigo: true }).then(function (sim) { if (sim) store.salvarConta(c.email, { plano: { fundador: false } }).then(function () { return store.espelharPlanoNasLojas(c.email); }).then(desenhar); }); } })
            : (R.vagasFundador() > 0 ? el('button', { class: 'btn btn-fantasma btn-pequeno', text: '★ Tornar fundador', title: 'Trava o preço de fundador nesta conta e ocupa uma vaga', onclick: function () { if (ocupado) return; ocupado = true; store.salvarConta(c.email, { plano: { fundador: true } }).then(function () { return store.ocuparVagaFundador ? store.ocuparVagaFundador().then(function (f) { window.LigeiroFundadores = { usados: f.usados }; }) : null; }).then(function () { return store.espelharPlanoNasLojas(c.email); }).then(function () { UI.avisar(c.email + ' agora é fundador'); desenhar(); }).catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu agora.'); }); } }) : null),
          el('button', { class: 'btn btn-fantasma btn-pequeno', text: 'Pausar', onclick: function () { store.salvarConta(c.email, { plano: { status: 'pausado' } }).then(function () { return store.espelharPlanoNasLojas(c.email); }).then(desenhar); } }),
        ]),
      ]);
    }

    function cartaoLoja(l) {
      var plano = l.plano || { status: 'teste' };
      var rotulos = { teste: 'Teste grátis', ativo: 'Pagando', pausado: 'Pausado', cancelado: 'Cancelado' };
      var sel = el('select', {}, ['teste', 'ativo', 'pausado', 'cancelado'].map(function (v) { var o = el('option', { value: v, text: rotulos[v] }); if (plano.status === v) o.selected = true; return o; }));
      sel.addEventListener('change', function () {
        /* so os campos que mudam: a loja pode ter sido editada no painel enquanto isso */
        store.salvarLoja({ slug: l.slug, plano: Object.assign({}, plano, { status: sel.value, desde: sel.value === plano.status ? plano.desde : new Date().toISOString() }), ativa: sel.value !== 'cancelado' }).then(function () { UI.avisar('Plano de ' + l.nome + ': ' + rotulos[sel.value]); if (!store.assistir) desenhar(); });
      });
      /* loja com dono: o plano e da conta dele (cartao "Assinaturas"), aqui e so leitura */
      if (l.donoEmail) { sel.disabled = true; sel.title = 'O plano é da conta do dono: use o cartão de assinaturas.'; }
      var linkLoja = UI.linkDaLoja(l);
      var a = R.assinatura(l);
      function dataBR(d) { return new Date(d).toLocaleDateString('pt-BR'); }
      var textoA = {
        gratis: 'grátis até ' + (a.limite ? dataBR(a.limite) : ''), ativa: a.cortesia ? 'cortesia' : 'paga até ' + dataBR(a.limite),
        vencendo: 'vence ' + dataBR(a.limite), vencida: 'VENCIDA em ' + dataBR(a.limite), bloqueada: 'BLOQUEADA desde ' + dataBR(a.limite),
        pausada: 'pausada', cancelada: 'cancelada',
      }[a.estado] || a.estado;
      var precos = (window.LIGEIRO_CONFIG || {}).precos || {};
      /* Confirmar pagamento: soma os dias a partir do fim atual (ou de hoje, se ja venceu). */
      function confirmar(dias) {
        var base = Math.max(Date.now(), a.limite ? new Date(a.limite).getTime() : 0);
        var novo = new Date(base + dias * 864e5).toISOString();
        store.salvarLoja({ slug: l.slug, plano: Object.assign({}, plano, { status: 'ativo', tipo: dias > 31 ? 'anual' : (plano.tipo || 'mensal'), pagoAte: novo, avisoPagamentoEm: '', avisoValor: 0, ultimoPagamentoEm: new Date().toISOString() }), ativa: true })
          .then(function () { UI.avisar(l.nome + ' liberada até ' + dataBR(novo)); if (!store.assistir) desenhar(); });
      }
      var avisoPag = plano.avisoPagamentoEm ? el('div', { class: 'aviso', text: '💸 Avisou pagamento de ' + R.dinheiro(plano.avisoValor || 0) + ' em ' + dataBR(plano.avisoPagamentoEm) + '. Confira no banco e confirme.' }) : null;
      return el('div', { class: 'pedido-card' + (l.ativa === false ? ' desligado' : '') + (plano.avisoPagamentoEm ? ' novo' : ''), style: l.ativa === false ? { opacity: '0.55' } : null }, [
        el('div', { class: 'cabeca' }, [
          D.logoSrc(l) ? el('img', { class: 'miniatura-produto', src: D.logoSrc(l), alt: '' }) : null,
          el('span', { class: 'senha', text: (D.logoSrc(l) ? '' : (l.emoji || '🍽️') + ' ') + l.nome }),
          el('span', { class: 'selo ' + (a.estado === 'ativa' || a.estado === 'gratis' ? '' : a.estado === 'vencendo' ? 'laranja' : 'cinza'), text: (rotulos[plano.status] || plano.status) + ' · ' + textoA + (plano.tipo === 'anual' ? ' · anual' : '') }),
          el('span', { class: 'quando', text: l.cidade + (l.uf ? '/' + l.uf : '') + ' · ' + (l.tipo || '') }),
        ]),
        el('div', { class: 'endereco', text: (l.whatsapp ? 'WhatsApp ' + R.formatarTelefone(l.whatsapp) + ' · ' : '') + 'Pix: ' + (l.pix && l.pix.chave ? l.pix.chave : 'não cadastrado') + (D.modoDemo ? ' · senha do painel: ' + (l.senhaPainel || '—') : ' · login: ' + (l.donoEmail || 'sem e-mail')) }),
        avisoPag,
        el('div', { class: 'caixa-link', text: linkLoja }),
        el('div', { class: 'acoes' }, [
          !l.donoEmail ? el('button', { class: 'btn btn-principal btn-pequeno', title: 'Loja sem conta: libera direto nela', text: '✓ Pagou ' + R.dinheiro(precos.mensal || 7900) + ' (+30 dias)', onclick: function () { confirmar(30); } }) : null,
          el('button', { class: 'btn btn-fantasma btn-pequeno', text: '📋 Copiar link', onclick: function () { UI.copiar(linkLoja).then(function () { UI.avisar('Link copiado'); }); } }),
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/' + l.cidadeSlug + '/' + l.slug, text: 'Ver loja' }),
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/painel/' + l.slug, text: 'Painel' }),
          el('a', { class: 'btn btn-fantasma btn-pequeno', href: '#/balcao/' + l.slug, text: 'Balcão' }),
          el('div', { class: 'campo', style: { flex: '1', minWidth: '160px' } }, sel),
        ]),
      ]);
    }

    function campo(rotulo, valor, opcoes) {
      var o = opcoes || {};
      var input = el('input', { type: o.tipo || 'text', maxlength: o.max || 80, placeholder: o.placeholder || '', inputmode: o.inputmode || null });
      input.value = valor || '';
      var b = el('div', { class: 'campo' + (o.largo ? ' largo' : '') }, [el('label', { text: rotulo }), o.ajuda ? el('p', { class: 'ajuda', text: o.ajuda }) : null, input]);
      b.input = input;
      return b;
    }

    function novaLoja() {
      var f = {};
      f.nome = campo('Nome do estabelecimento', '', { max: 60, placeholder: 'Ex: Lanchonete do Zé' });
      var tipoSel = el('select', {}, TIPOS.map(function (t) { return el('option', { value: t[0], text: t[1] + ' ' + t[0] }); }));
      f.tipo = el('div', { class: 'campo' }, [el('label', { text: 'Tipo' }), tipoSel]);
      f.cidade = window.LigeiroCidades.campo('Juquiá', 'SP', { rotulo: 'Cidade', largo: true });
      f.whatsapp = campo('WhatsApp da loja', '', { max: 16, inputmode: 'numeric', placeholder: '(13) 99999-9999' });
      UI.mascaraTelefone(f.whatsapp.input);
      f.senha = D.modoDemo
        ? campo('Senha do painel', String(1000 + Math.floor(Math.random() * 9000)), { max: 20, ajuda: 'Anote e entregue pro dono.' })
        : campo('E-mail do dono (login do painel)', '', { max: 80, tipo: 'email', ajuda: 'Crie esse usuário em Authentication no Firebase, com a senha combinada com o dono.' });
      var modeloSel = el('select', {}, MODELOS.map(function (m) { return el('option', { value: m[0], text: m[1] }); }));
      f.modelo = el('div', { class: 'campo largo' }, [el('label', { text: 'Começar com que cardápio?' }), el('p', { class: 'ajuda', text: 'O modelo vem com categorias, itens e adicionais típicos. Depois é só ajustar nome e preço no painel.' }), modeloSel]);
      var corpo = el('div', { class: 'grade-form', style: { paddingTop: '8px' } }, [f.nome, f.tipo, f.cidade, f.whatsapp, f.senha, f.modelo]);

      UI.abrirModal({ titulo: 'Cadastrar estabelecimento', corpo: corpo, rodape: [el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Cadastrar', onclick: function () {
        var nome = f.nome.input.value.trim();
        if (nome.length < 2) return UI.avisar('Digite o nome.');
        var tipo = tipoSel.value;
        var emoji = (TIPOS.filter(function (t) { return t[0] === tipo; })[0] || ['', '🍽️'])[1];
        var dados = {
          nome: nome, tipo: tipo, emoji: emoji,
          cidade: (f.cidade.valor() || { nome: 'Juquiá', uf: 'SP' }).nome, uf: (f.cidade.valor() || { nome: 'Juquiá', uf: 'SP' }).uf,
          whatsapp: f.whatsapp.input.value.replace(/\D/g, ''),
          senhaPainel: D.modoDemo ? (f.senha.input.value.trim() || '1234') : undefined,
          donoEmail: D.modoDemo ? undefined : f.senha.input.value.trim().toLowerCase(),
          aceitaPix: false, mpAtivo: false,
          categorias: [], produtos: [], grupos: {}, gruposPorCategoria: {},
        };
        var modelo = modeloSel.value;
        if (modelo !== 'vazio' && window.LigeiroSeed) {
          var base = window.LigeiroSeed().lojas[modelo];
          if (base) {
            dados.categorias = D.clonar(base.categorias);
            dados.produtos = D.clonar(base.produtos);
            dados.grupos = D.clonar(base.grupos);
            dados.gruposPorCategoria = D.clonar(base.gruposPorCategoria);
          }
        } else if (modelo === 'vazio') {
          dados.categorias = [{ id: 'cardapio', nome: 'Cardápio', emoji: emoji }];
        }
        /* loja com e-mail do dono: garante a conta dele (a assinatura mora la) */
        var conta = dados.donoEmail && store.obterConta
          ? store.obterConta(dados.donoEmail).then(function (c) { return c || store.salvarConta(dados.donoEmail, { plano: { planoId: 'uma', tipo: 'mensal', status: 'teste', desde: new Date().toISOString() } }); })
          : Promise.resolve(null);
        conta.then(function (c) {
          if (c && c.plano) dados.plano = { status: c.plano.status || 'teste', tipo: c.plano.tipo || 'mensal', planoId: c.plano.planoId || 'uma', planoPago: c.plano.planoPago || '', desde: c.plano.desde || new Date().toISOString(), pagoAte: c.plano.pagoAte || '' };
          return store.criarLoja(dados);
        }).then(function (loja) {
          UI.fecharModal();
          UI.soar('sucesso');
          mostrarLinks(loja);
        }).catch(function (e) { UI.avisar(e && e.message ? e.message : 'Não deu pra cadastrar.'); });
      } })] });
      setTimeout(function () { f.nome.input.focus(); }, 60);
    }

    function mostrarLinks(loja) {
      var corpo = el('div', { class: 'pilha', style: { paddingTop: '8px' } }, [
        el('p', { text: 'Pronto! Entregue estes dois links pro dono:' }),
        el('div', {}, [el('b', { text: 'Cardápio (pro cliente)' }), el('div', { class: 'caixa-link', text: UI.linkDaLoja(loja) })]),
        el('div', {}, [el('b', { text: 'Painel (só o dono)' }), el('div', { class: 'caixa-link', text: UI.linkDoPainel(loja) }), el('p', { class: 'muted pequeno', text: D.modoDemo ? 'Senha do painel: ' + loja.senhaPainel : 'Login: ' + (loja.donoEmail || '') + ', com a senha combinada' })]),
        el('div', {}, [el('b', { text: 'Balcão (tablet)' }), el('div', { class: 'caixa-link', text: UI.linkDoBalcao(loja) })]),
      ]);
      UI.abrirModal({ titulo: loja.nome + ' cadastrado', corpo: corpo, rodape: [
        el('button', { class: 'btn btn-fantasma', style: { flex: '1' }, text: 'Copiar tudo', onclick: function () {
          var texto = loja.nome + '\nCardápio: ' + UI.linkDaLoja(loja) + '\nPainel: ' + UI.linkDoPainel(loja) + (D.modoDemo ? ' (senha ' + loja.senhaPainel + ')' : ' (login ' + (loja.donoEmail || '') + ')') + '\nBalcão: ' + UI.linkDoBalcao(loja);
          UI.copiar(texto).then(function () { UI.avisar('Copiado'); });
        } }),
        el('button', { class: 'btn btn-principal', style: { flex: '1' }, text: 'Abrir o painel', onclick: function () { UI.fecharModal(); window.LigeiroApp.ir('painel/' + loja.slug); } }),
      ] });
    }
  }

  window.LigeiroAdmin = { abrir: abrir, TIPOS: TIPOS, MODELOS: MODELOS };
})();
