# Ligeiro — pedido ligeiro, sem comissão

Sistema de pedidos para lanchonete, pizzaria, marmitaria e afins de cidade
pequena. Cada estabelecimento ganha um **link próprio** (o cliente pede em modo
totem e paga no Pix), um **painel** (o pedido cai apitando), um **modo balcão**
(tablet no caixa), uma **tela da cozinha** e uma **tela do entregador**. Tudo
roda no navegador, sem servidor próprio.

## Como abrir (e a demonstração)

Esta pasta é o site **de verdade**: o `index.html` (dois cliques) e o servidor
`ligeiro` do `.claude/launch.json` (<http://localhost:8765>) abrem ligados ao
banco `ligeiro-18df1`. Pedido feito ali cai numa loja real.

Para testar sem risco, use a **cópia de demonstração**: copie a pasta `app` para
fora da pasta publicada, troque em `js/config.js` o objeto `firebase: {...}` por
`firebase: null` e acrescente `<script src="js/seed.js"></script>` no
`index.html` antes de `js/dados.js`. Aparece a faixa MODO DEMONSTRAÇÃO no topo e
tudo fica só naquele navegador.

| O que | Endereço | Senha (só na demonstração) |
|---|---|---|
| Página de vendas (calculadora, plano, dúvidas) | `#/` ou `#/lojas` | — |
| Cidades | `#/cidades` | — |
| Lojas de Juquiá | `#/juquia` | — |
| Loja (cliente pede aqui) | `#/juquia/dom-conizza` | — |
| Painel do dono | `#/painel/dom-conizza` | `1234` |
| Modo balcão (tablet) | `#/balcao/dom-conizza` | — |
| Tela da cozinha | `#/cozinha/dom-conizza` | `1234` |
| Tela do entregador | `#/entrega/dom-conizza` | `1234` |
| Central do Ligeiro | `#/admin` | `ligeiro` |
| O dono cria a própria loja | `#/comecar` | — |
| Mensal ou anual | `#/assinar` | — |
| Entrar na conta (só Google) | `#/entrar` | — |
| Minha conta: a loja do dono e a assinatura | `#/conta` | — |
| Termos de uso e privacidade | `#/termos`, `#/privacidade` | — |

No site de verdade, a Central entra só com o Google do `adminEmail`, e cozinha e
entregador usam a senha da equipe (seção abaixo).

## Preço de fundador

- `config.fundador.vagas` (5) e o campo `fundador` do plano em `config.planos` (um plano só).
  Visitante e conta que nunca pagou veem o preço de fundador **enquanto houver vaga**
  (`R.vagasFundador`, `R.ehPrecoFundador`, `R.precoDoPlano(plano, tipo, conta)`).
- A vaga é ocupada no **primeiro pagamento confirmado**: o mensageiro do Asaas (ou o admin, na Central) grava
  `contas/{email}.plano.fundador = true` e soma 1 em `publico/fundadores.usados` na mesma gravação, com trava (dois
  pagamentos disputando a última vaga: só um fica com ela). Daí em diante a conta paga o preço de fundador enquanto não
  cancelar: encerrar tira o preço (mensageiro, site e o Cron de todo dia). `fundador.jaOcupadas` fica 0 (a Dom Conizza
  não conta); o site mostra "Restam X de 5", número de verdade.
- Acabando as vagas, tudo passa a mostrar o preço normal (R$ 89), sempre abaixo do Anota AI. Quem já é fundador vê
  "Fundador, travado" nos cartões.
- Links do Asaas: `cobranca.linksFundador` (preço de fundador) e `cobranca.links` (normal). Pagar pelo link de fundador
  sem vaga vale dias proporcionais, e o mensageiro passa a assinatura para o preço normal.
- No `worker-asaas.js`, o segredo `PLANOS` lista os dois preços do plano:
  `{"uma":{"mensal":8900,"anual":89000,"fm":7900,"fa":79000}}`.

## Senha da equipe (cozinha, entregador, balcão)

- O dono define em Minha loja ou Minha conta. O mensageiro (`POST /equipe`,
  com o idToken do dono) cria ou troca o usuário `equipe-<slug>@equipe.ligeiro.app.br`
  no Firebase Auth com senha `LIG-<pin>` e grava nele a marca `{equipe: <slug>}`.
  As regras dão a quem tem essa marca só `list`/`update` nos pedidos da própria
  loja (`isEquipe`); o e-mail sozinho não vale mais.
- Ao publicar esta versão: primeiro o mensageiro novo, depois as regras. Em
  seguida cada dono salva a senha da equipe de novo (6 números), fora do
  horário de movimento; até lá a equipe daquela loja fica sem ver os pedidos.
- `FirebaseStore.entrarPainel` tenta a equipe e, se falhar, o dono por e-mail e senha.
  Dono logado com Google abre cozinha/entrega/balcão sem senha (`donoLogado`).
- Esqueceu? Define outra: a antiga para de valer na hora.

## Como o Pix funciona: sempre automático (Mercado Pago)

Decisão de 18/09/2026: não existe mais Pix "manual" com chave e conferência
no banco. O objetivo é pagar e o pedido cair pronto.

1. A loja liga o **Pix automático** em Ajustes › Pagamento colando o **Access
   Token** da própria conta Mercado Pago (`lojas/{slug}/privado/mercadopago`).
   Sem isso, o site só oferece maquininha e dinheiro na entrega ou no balcão
   (`R.montarPedido`: `formas.pix = aceitaPix && mpAtivo`).
2. O cliente fecha o pedido no Pix. O site chama o **mensageiro**
   (`ferramentas/worker-mercadopago.js`, rota `POST /criar`), que cria o
   pagamento no Mercado Pago com o token da loja e grava `pixCodigo` no
   pedido. O QR aparece na hora, com o painel aberto ou não.
3. O Mercado Pago avisa o mensageiro (`/webhook?loja=slug`) quando cai; o
   pedido vira `pago` e entra na cozinha. Reforços: o site pergunta
   `GET /status` a cada 8 s, e o painel aberto (`js/mp.js`) também confere.
4. Na demonstração tudo é simulado: o Pix "cai" em 20 segundos.

O mensageiro precisa do segredo `FIREBASE_SA` (conta de serviço) pra gravar
no Firestore, e o endereço dele vai em `config.proxyMercadoPago`. O Mercado
Pago cobra cerca de 1% por Pix recebido; o dinheiro fica na conta Mercado
Pago da loja.

## Cartão de crédito pelo site (Mercado Pago, 27/09/2026)

1. **Ligar:** Ajustes › Pagamento › "Cartão de crédito pelo site". Vem da mesma
   conexão do Pix: o `/mp/volta` guarda a **chave pública** (`public_key` do
   OAuth) em `lojas/{slug}.mpChavePublica`. Conexão antiga, sem a chave: o botão
   "Liberar o cartão" reconecta e volta com o cartão ligado
   (`ligeiro:ligar-cartao:{slug}` no aparelho). Taxa do Mercado Pago: cerca de
   5% com o dinheiro na hora.
2. **Cliente:** escolhe "Cartão de crédito" em "Pague agora pelo site"
   (`formaPagamento: 'cartao_online'`, nasce `aguardando_pagamento` como o Pix).
   A tela `tela-cartao` abre o **Card Payment Brick** do Mercado Pago (SDK
   `sdk.mercadopago.com/js/v2`, baixado só quando a pessoa escolhe o cartão),
   à vista, só crédito, nas cores da loja. Os números do cartão vão direto
   para o Mercado Pago; o site recebe um código de uso único.
3. **Cobrança:** `POST /cartao` no mensageiro confere tudo pelo servidor
   (loja com o cartão ligado, pedido de cartão, aguardando, valor do banco,
   até 40 min), cobra pela Orders API e marca pago na hora. Recusa volta com
   o motivo em português e o formulário abre limpo para outra tentativa.
   Limite: 4 tentativas por pedido e 8 por aparelho a cada 10 min.
4. **Cancelou um pedido pago pelo site** (Pix ou cartão): o painel pergunta
   "Cancelar e devolver" e o `POST /devolver` (só o dono) devolve o valor
   inteiro pelo Mercado Pago e grava `devolvidoEm`. Se falhar, o painel
   explica como devolver pelo app.
5. **Taxa do cartão:** a loja escolhe pagar (padrão) ou repassar ao cliente
   (`lojas/{slug}.taxaCartao`, de 1 a 6%; Lei 13.455/2017). A conta mora em
   `R.orcar` (campo `acrescimoCartao` no pedido, só quando existe): o site mostra
   "+ R$ X de taxa do cartão" na opção e no total, o Pix vira "Sem taxa", e a
   conferência do painel aceita a taxa que veio no pedido até o teto.
6. Fora do tablet do balcão (lá tem a maquininha). Sem 3DS por enquanto: o
   banco que pede confirmação extra recusa com o recado de usar outro cartão
   ou o Pix.
7. **Nunca duas cobranças (24/09/2026):** sem resposta do Mercado Pago, o
   mensageiro repete uma vez com a **mesma chave** (a mesma cobrança volta,
   nunca outra). Sem resposta de novo: responde `conferindo` e a trava
   (`cobrandoEm` + `cobrancaIncerta`) fica 5 min. Banco analisando
   (`processing`): responde `analise`, a trava fica e o aviso do Mercado Pago
   marca pago ou solta. Antes de cobrar de novo, o mensageiro pergunta ao
   Mercado Pago como ficou a cobrança anterior (`p.mp.id`). Toda cobrança fica
   em `cobrancas` e o `/devolver` devolve todas as aprovadas.
8. **Aviso do Mercado Pago (webhook):** no app do Ligeiro no Mercado Pago
   (Suas integrações › Webhooks), a URL de produção é
   `https://ligeiro-mp.ligeiro-pedidos.workers.dev/webhook` com o evento
   **Order**. Sem isso o pedido só vira pago com a tela do cliente ou o
   painel abertos (as consultas de 8 s).

## Limites (para nada virar bagunça)

| O quê | Limite | Onde trava |
|---|---|---|
| Categorias | 20 por loja | painel avisa, regra do banco |
| Itens | 300 por loja | painel avisa, regra do banco |
| Grupos de opções | 30 por loja | painel avisa, regra do banco |
| Opções por grupo | 30 | painel avisa |
| Cupons | 20 por loja | painel avisa, regra do banco (`privado/cupons`) |
| Itens num pedido | 40 | `R.montarPedido` (mensageiro) |
| Pedidos | 15 por aparelho em 10 min (o tablet do balcão, com a senha da equipe: 200 por loja) | mensageiro `/pedido` |
| Código de cupom | 12 tentativas por aparelho em 10 min, 300 por loja | mensageiro `/cupom` e `/pedido` |
| Cartão | 4 tentativas por pedido, 8 por aparelho em 10 min | mensageiro `/cartao` |
| Contato ("Fale com a gente") | 3 por aparelho em 10 min, 300 por dia | mensageiro `/lead` (a regra não deixa gravar direto) |
| Aparelhos com aviso | 8 por loja | mensageiro (`aparelhos:`) |

No IPv6 o limite vale para a casa inteira (`/64`), porque o celular troca o
fim do endereço a toda hora.

## Como funciona o dinheiro

- **Pix**: sempre automático, pela conta Mercado Pago da própria loja (seção
  acima). O dinheiro do cliente cai direto na conta da loja; o Ligeiro nunca
  encosta nele. O Mercado Pago cobra cerca de 1% por Pix, pago pela loja.
- **Cartão de crédito pelo site**: pela mesma conta Mercado Pago (seção
  acima), à vista, cerca de 5% por venda.
- **Maquininha e dinheiro** na entrega ou no balcão entram na fila na hora, com
  o troco já calculado. A tela do entregador mostra o que cobrar.
- Loja sem Mercado Pago conectado recebe só maquininha e dinheiro; o bloco
  Pagamento dos Ajustes mostra o que vale hoje.

## Conta do dono (login)

- O dono entra com **Google** ou **e-mail e senha** (Firebase Authentication).
  No Firebase: Authentication › Sign-in method › ativar **Google** e
  **E-mail/senha**. Em Google, preencha o e-mail de suporte do projeto.
- `#/conta` lista as lojas cujo `donoEmail` é o e-mail logado
  (`store.listarMinhasLojas`), com status da assinatura e atalhos. O painel
  abre sem senha quando `store.donoLogado(loja)` é verdadeiro (dono ou admin).
- A senha do painel continua existindo só pra equipe (cozinha e entregador)
  em aparelho compartilhado. Na demonstração a conta é de mentira
  (`localStorage` `ligeiro:conta`) e todas as lojas de exemplo são suas.

## Vitrine: o hub não baixa o cardápio inteiro

- `vitrine/{slug}` guarda um resumo de 5 a 20 KB da loja (nome, logo, cidade,
  horários, frete, plano, nomes dos itens ativos). `salvarLoja` e `criarLoja`
  gravam a loja e a vitrine juntas; o hub e a página das cidades leem só a
  vitrine (`store.listarVitrine`), com cache de 5 minutos no aparelho.
- Ao ligar a nuvem pela primeira vez (ou se algo desencontrar), toque em
  **Reconstruir vitrine** no `#/admin`.

## LGPD (dados pessoais)

- **Papéis:** com os dados de quem pede, a loja é a controladora e o Ligeiro é o operador (termos, cláusula "Dados
  pessoais (LGPD)"; novo aceite pedido pela versão `2026-09-24.2` em `R.TERMOS_VERSAO`). Pelos dados das lojas, donos e
  contatos do "Fale com a gente", o responsável é o Ligeiro. Política completa em `#/privacidade` (serviços, países, base
  legal, prazos, direitos, incidente).
- **Pedido de uma pessoa (ver ou apagar):** Central, aba Mais, "Dados de uma pessoa (LGPD)". Busca pelo WhatsApp em todos
  os pedidos, nos resumos diários (lista de clientes) e nos contatos. "Baixar os dados" gera o arquivo só com o que é dela;
  "Apagar os dados" deixa o pedido só com os valores (nome vira "Apagado a pedido (LGPD)", sem telefone, endereço,
  observação e aviso), tira a pessoa dos resumos e apaga os contatos. Custa uma leitura por pedido guardado: só usar
  quando alguém pedir. Prazo da lei: 15 dias. Antes, confirmar que é a pessoa (mensagem do mesmo número).
- **No celular do cliente:** Meus pedidos, "Apagar meus dados deste aparelho" (nome, telefone, endereço, e-mail do
  cartão e lista de pedidos).
- **Fontes da Dom Conizza** servidas pelo site (`fontes/`), sem o Google Fonts.

## Assinatura e cobrança (plano único, 25/09/2026)

- **Um plano só: 1 loja por conta**, mensal (R$ 89) ou anual (R$ 890, 2 meses grátis). Outra loja é outra conta (outro
  e-mail do Google), com a própria assinatura e os próprios 7 dias grátis. `config.planos` tem só o `uma`; conta antiga
  com `duas` ou `tres` cai no de 1 loja (`R.planoPorId`). O mensageiro do Mercado Pago (`/loja-nova`) recusa a segunda.
- **Teste grátis de 7 dias** (`config.precos.diasGratis`), sem cartão. No período grátis o estado é `gratis` até o
  último dia (nunca "vencendo") e, acabou, vira `bloqueada` no mesmo dia: sem tolerância. Quem já pagou tem 7 dias de
  aviso e 10 de tolerância depois do vencimento.
- **Como paga:** pelos links de assinatura do Asaas (`config.cobranca.links`; `linksFundador` para quem tem a vaga), no
  cartão (cobra sozinho todo mês ou ano), boleto ou Pix. A fatura do mês aparece no painel e em Minha conta, e os
  lembretes vão por e-mail (Apps Script, `ferramentas/lembrete-email.gs`).
- **A verdade é a conta:** `contas/{email}.plano` (`planoId` `uma`, `tipo`, `status`, `desde`, `pagoAte`, `fundador`...).
  `lojas/{slug}.plano` e `vitrine/{slug}.plano` são espelho, com os mesmos campos no mensageiro e no site (a regra do banco
  compara os dois). `R.assinatura(...)` diz o estado: **gratis**, **ativa** (paga, ou cortesia = `ativo` sem `pagoAte`),
  **vencendo** (7 dias), **vencida** (10 dias de tolerância, loja no ar) e **bloqueada** (o site para de aceitar pedidos).
- **Confirmação automática** (`ferramentas/worker-asaas.js`): o webhook do Asaas avisa, o mensageiro lê a cobrança de
  novo pela chave da API, acha a conta pelo e-mail do cliente e grava `status`, `pagoAte` (+30 ou +365 dias) e o espelho.
  Segredos: `ASAAS_KEY`, `ASAAS_WEBHOOK`, `FIREBASE_SA`, `PLANOS` (e `EMAIL_URL`/`EMAIL_TOKEN` dos lembretes). Regra de
  ouro: o e-mail do cliente no Asaas é o mesmo do login no Ligeiro.
- **Mensal ou anual:** com assinatura viva, passa pelo mensageiro (`POST /plano/simular` e `/plano/trocar`, com o login
  do dono), que muda a MESMA assinatura no Asaas (valor e ciclo) e vale na próxima fatura: sem diferença para pagar, sem
  cobrança avulsa. Sem assinatura (teste grátis), só marca a escolha. Com assinatura viva, as regras do banco não deixam
  mudar direto (`escolhaPeloMensageiro`).
- **Encerrar** (`POST /plano/encerrar`): cancela a assinatura no Asaas (e a pendente e a extra), a loja fica no ar até o
  fim do que foi pago e o preço de fundador acaba. Cobrança que cair depois é devolvida sozinha (cartão e Pix; boleto
  avisa o admin por e-mail). O Cron de todo dia cancela o que sobrou de conta encerrada pela Central.
- **Rede de segurança do dinheiro** (pentest do plano único, 25/09/2026):
  - Uma assinatura só por conta: a nova paga cancela a velha, mas nunca toma o lugar de uma viva com dias pela frente (ela
    vira `assinaturasExtras` e o admin recebe e-mail).
  - Pagamento com e-mail sem conta no Ligeiro não cria conta; cobrança avulsa fora do preço do plano (a loja
    personalizada, por exemplo) não vira dias. Nos dois casos o admin recebe e-mail.
  - Pagou dentro da tolerância (a loja ainda no ar): os dias contam do vencimento, e não de hoje (no mensageiro e na
    Central). Antes, cada atraso de 9 dias virava 9 dias de graça.
  - Estorno ou contestação: os dias daquele pagamento saem (`creditos`) e a conta pausa; pagar outra coisa não tira a
    pausa (só a Central). Estorno de uma assinatura extra só tira os dias dela, sem pausar o dono.
  - Link de fundador sem vaga: dias proporcionais, e a assinatura passa para o preço normal.
  - Multa e juros de atraso não mudam o plano (vale o `originalValue` da cobrança).
  - Gravação com trava (`gravarJuntos`, pela hora da última mudança do documento): o dono encerrando bem na hora de um
    pagamento, ou dois pagamentos disputando a última vaga de fundador, refazem a conta com os dados novos.
  - Loja nova com trava na conta (`lojaCriadaEm`): pedidos juntos (duas abas, vários workers) não criam duas lojas.
  - Aviso repetido do Asaas regrava o espelho nas lojas (se da outra vez a cópia falhou no meio).
  - Revisão antes de publicar: o segredo `PLANOS` torto (JSON quebrado, "Uma", preço em reais) não libera nada (500 e
    e-mail ao admin); a consulta ao banco usa `documents:runQuery`; aviso repetido nunca responde erro; encerrar, o Cron,
    a troca e o estorno gravam com trava (um pagamento no meio não deixa assinatura cobrando solta nem perde dias); a
    folga da multa só vale para assinatura; valor sem preço conta pelo mensal; assinatura antiga que o Asaas não cancelou
    fica nas extras e o admin sabe.
- **Regras do banco:** o dono só mexe em `planoId` (só `uma`), `tipo`, `status` (encerrar e reativar), no aviso de
  pagamento, nas datas de encerrar e reativar (texto curto) e pode desligar o próprio `fundador` junto com encerrar (nunca
  ligar). `pagoAte`, `planoPago`, `pagamentos`, as assinaturas e o resto são do admin e dos mensageiros.
- Pix manual (`config.pixLigeiro` com "Já paguei", o admin confirma na Central) fica de reserva.
- Limitação conhecida sem servidor: o total do pedido é calculado no navegador. A regra impede pedido "já pago" no Pix
  e lixo grande, mas um pedido com preço adulterado ainda pode entrar; o painel mostra o total e o dono confere no Pix.
  Para fechar isso de vez, ligue o **App Check** (reCAPTCHA v3, grátis) no projeto Firebase.
- `#/entrar` acha o painel pelo link da loja; `#/termos` e `#/privacidade` usam `config.empresa` (nome, CNPJ, e-mail)
  quando preenchido.
- Testes: `node testes/asaas.test.mjs` (117, com um cenário para cada furo do pentest e da revisão), `node testes/worker.test.mjs`
  (230, com a corrida da loja nova) e as regras no emulador local do Firestore (inclusive os fluxos legítimos do site).

## Cardápio: controle total do dono

- Categoria: criar, renomear, trocar de ordem, **desligar** (`ativa: false`, some do
  site com os itens e `R.produtosAtivos` já ignora) e **excluir** movendo os itens
  pra outra categoria ou excluindo junto; grupos de opções só dela vão embora.
- Item: preço direto na lista, interruptor, subir/descer, duplicar (nasce
  desligado, sem foto) e busca pelo nome quando passa de 8 itens.
- Listas grandes não estouram a página: clientes em Vendas vêm 15 por vez com
  filtro e "Mostrar mais"; a busca do cardápio mostra 40.

## Frete: a loja manda

- Em **Ajustes › Entrega e retirada** (e já no `#/comecar`) o dono escolhe
  **Entrega grátis** ou **Cobro taxa**, com a opção "grátis a partir de R$ X".
  `loja.freteGratis = true` vale acima da taxa guardada (`R.calcularTaxaEntrega`),
  e `R.descreverFrete(loja)` é o texto único usado no site, na vitrine, no
  cardápio em texto e no cartão "Primeiros passos". Entrega grátis vira selo
  na página da loja e na lista de lojas da cidade.

## A cara da loja: logo, capa, cor e fotos

- No painel, em **Ajustes**, a loja manda a **logo** (quadrada, 200 px) e a
  **capa** (deitada, 1080 px) direto do celular. Em **Cardápio**, cada item tem
  **foto** (640 px). O navegador diminui tudo antes de guardar (`UI.lerImagem`
  em `js/ui.js`): uma foto de 4 MB vira um JPEG de 15 a 40 KB.
- A **cor** da loja (`loja.cor`, uma das dez da paleta ou qualquer outra) pinta
  botões, destaques e títulos do site dela (`UI.aplicarTema`). O texto em cima
  da cor vira preto ou branco pelo contraste. O painel continua verde.
- Onde fica guardado: a logo vai dentro do documento da loja (`logoDados`,
  pequena, aparece na vitrine da cidade). Fotos de produto e capa vão em
  documentos separados (`lojas/<slug>/fotos/<id>`, campo `dados`), porque o
  documento da loja tem limite de 1 MB. Cada produto guarda só o id
  (`produto.foto`); a loja guarda `capa` e `fotosVersao`. O site do cliente
  baixa as fotos uma vez e guarda no aparelho; só baixa de novo quando
  `fotosVersao` muda.

## Impressão automática

No topo do painel, o botão **🖨️ Impressão manual / Imprime sozinho** faz cada
pedido novo (Pix confirmado ou pra cobrar na entrega) sair na impressora do
aparelho. Pra não aparecer a janela de imprimir no computador do caixa, abra o
Chrome com o parâmetro `--kiosk-printing` (atalho: botão direito › Propriedades
› Destino, acrescente no fim) e deixe a impressora térmica como padrão do
Windows. A ficha usa 72 mm de largura.

## Avisos com a tela apagada (Web Push, grátis)

O celular apita como mensagem de aplicativo, mesmo com a tela apagada e o site fechado.
Quem manda é o mensageiro (`ferramentas/worker-mercadopago.js`), pelo serviço de avisos do
Google e da Apple (grátis). **O banco não gasta nada**: os aparelhos da loja ficam no KV
(`aparelhos:{slug}`, no máximo 8) e o aviso do cliente vai no campo `aviso` do próprio pedido.

- **Loja:** cartão "Receba os pedidos com a tela apagada" no painel (e Testar/Desligar em
  Minha loja); botão "Tela apagada" na cozinha e no entregador. Pedido novo e Pix pago apitam
  no painel e na cozinha; "saiu para entrega" apita no entregador.
- **Cliente:** chave "Me avise no celular" no fechamento do pedido (vai junto com o pedido)
  ou botão "Avisar" na tela da senha. Recebe "preparando", "saiu" ou "pronto" e "cancelado".
- **WhatsApp:** o botão do pedido no painel muda com o status ("Avisar: Saiu para entrega")
  e abre o WhatsApp da loja com a mensagem pronta; alguém aperta enviar. WhatsApp automático
  ficou de fora: a Meta cobra cada mensagem desde 01/10/2026.
- **iPhone:** só com o site na tela de início (regra da Apple); o site mostra os 3 passos.
- A chave dos avisos (VAPID) nasce sozinha no KV (`sistema:vapid`). Enquanto o mensageiro no
  ar não tiver a rota `/vapid`, nenhum botão de aviso aparece.
- Rotas: `GET /vapid`, `POST /aparelho`, `/novo`, `/inscrever`, `/avisar`. Testes em
  `testes/worker.test.mjs` (o aviso é aberto com uma implementação independente da RFC 8291).

## Pastas

```
index.html            página única (todas as telas)
css/ligeiro.css       estilo totem: botão grande, uma decisão por tela
css/temas/conizza.css tema exclusivo da Dom Conizza
js/config.js          Firebase, preços, planos, vagas, limites do cardápio, lojas oficiais
js/regras.js          regras do pedido (conta, validação, status, WhatsApp, cardápio em texto), roda no Node também
js/pix.js             Pix copia e cola + QR (o QR baixa só quando aparece)
js/dados.js           camada de dados: DemoStore (localStorage) e FirebaseStore (Firestore e borda)
js/ui.js              pecinhas de tela: botões, modal, sons, avisos, campo de foto, ícones de traço, tema
js/avisos.js          avisos com a tela apagada (Web Push)
js/cliente.js         cidades, loja e pedido em modo totem
js/cidades.js         lista de cidades do Brasil (campo de cidade)
js/parceiro.js        página de vendas, assinar, entrar, termos e privacidade
js/app.js             roteador (#/...) e o código de cada tela, baixado só quando ela abre
js/painel.js          painel do dono: pedidos, cardápio, vendas, ajustes, minha loja
js/equipe.js          cozinha, entregador e balcão
js/mp.js              conexão com o Mercado Pago
js/cobranca.js        pagar a assinatura
js/conta.js           minha conta (lojas e assinatura)
js/comecar.js         cadastro da loja em passos
js/admin.js           Central do Ligeiro
js/seed.js            modelos de cardápio (e as lojas de exemplo da demonstração)
vendor/qrcode.js      desenha o QR (biblioteca MIT de Kazuhiko Arase)
testes/               testes automáticos (regras, Pix e mensageiro)
ferramentas/          mensageiros (worker-mercadopago.js, worker-asaas.js) e regras do banco (firestore.rules)
```

Os `<script>` do `index.html` levam `?v=data`, igual ao `VERSAO` do `sw.js`.
Quando mudar um arquivo, troque os dois para ninguém ficar com versão velha.

## Corrida do Ligeiro (o joguinho enquanto espera)

Depois de pago, a tela do pedido convida o cliente para a **Corrida do Ligeiro** (`js/jogo.js`): o ratinho de moto
(com a logo da loja na caixa de entrega; sem logo, o mascote) numa rua de três faixas, em falso 3D desenhado em código (sem imagem nova). Tem moedas com combo até x5, ímã, turbo e
capacete, vira-lata caramelo atravessando, o dia virando noite com os postes acendendo, musiquinha e efeitos feitos
na hora pelo celular. **Zero banco**: o recorde fica no
aparelho, e o arquivo só baixa quando o cliente toca em Jogar. Se o pedido anda, o jogo avisa (e pausa quando sai ou
fica pronto). O lojista desliga em Ajustes, "No seu site" (campo `jogoDesligado`); de fábrica vem ligado.
O teste (`testes/jogo.test.mjs`) roda 12 km de rua e confere que sempre existe um caminho.

## Pulo do Ligeiro (o segundo joguinho, embaixo da Corrida)

`js/pulo.js`, no mesmo esquema da Corrida: só baixa quando o cliente toca em "Jogar", roda no aparelho, zero banco, e o
recorde fica no celular (`ligeiro:pulo:recorde`). O ratinho pula sozinho de tábua em tábua; o cliente segura o dedo do
lado para onde quer ir (ou as setas). Tábua verde, azul (anda de lado), caixa de papelão (rasga) e mola; gato e pombo
derrubam, menos se ele cair por cima. Os 3 primeiros lanches da loja viram turbo, ímã e capacete, e o fim mostra o
"Bateu fome?" com o lanche. O céu vai do dia ao espaço. O mesmo interruptor `jogoDesligado` desliga os dois jogos.
O teste (`testes/pulo.test.mjs`) confere que o maior vão entre tábuas firmes é menor que o pulo, e um robô sobe 3 km sem
cair em 8 partidas seguidas.

## Pentest de 25/09/2026 (5 revisores: mensageiro, dinheiro, regras do banco, navegador, lógica)

- **Loja nova nasce no mensageiro** (`POST /loja-nova`): ele confere a conta, a assinatura, o limite do plano (lojas no ar
  da conta), as vagas do Ligeiro (vitrine + `publico/fundadores`) e um endereço livre, sem sobra de loja apagada (token do
  Mercado Pago, senhas). As regras do banco só deixam o admin criar loja direto. Antes, qualquer conta conferida criava
  lojas sem fim.
- **Equipe só pela marca e pelo e-mail do nosso domínio** (`equipe-<loja>@equipe.ligeiropedidos.com.br`), no mensageiro
  e nas regras. Login antigo (`ligeiro.app.br`) ouve "o dono precisa salvar a senha da equipe de novo" e, quando o dono
  salva, o mensageiro troca o e-mail do mesmo usuário. A equipe vê a fila e os pedidos dos últimos 2 dias, não o histórico.
- **Cobrança a mais do mesmo pedido volta sozinha**: o pedido guarda `pagoPor` (a cobrança que pagou); outra aprovada
  para ele é devolvida pelo mensageiro (`duplicadasDevolvidas`). Pedido de antes disso só anota.
- **Asaas**: estorno e contestação pausam a conta até o admin olhar (eventos novos no webhook, ver o worker-asaas.js).
- `/novo` só apita pedido gravado e pago (senha e valor do banco); `/inscrever` fica com o primeiro celular do cliente;
  `/devolver` confere o dono no banco; aviso do Mercado Pago sem assinatura sempre com limite.
- Site: foto e logo só do próprio site; página não abre dentro de outro site; cache do banco no aparelho só nas telas
  da loja (no celular do cliente o antigo é apagado); vendas por dia de trabalho (5 h às 5 h); link do pedido abre com a
  loja parada; cidade com nome repetido no Brasil ganha o estado no endereço (`rio-branco-ac`).
- **Ordem de publicar:** site (git push), depois `worker-mercadopago.js`, depois `firestore.rules`, depois salvar a senha
  da equipe de novo em cada loja. O `worker-asaas.js` vai quando o Asaas for ligado.
- Ficaram para depois (baixo): uso de cupom com limite contado já no pedido não pago; lojas fora do horário de Brasília;
  e-mail do dono no documento público da loja (precisa separar a parte pública); App Check (conta do Firebase).

## Testes

```bash
node --test testes/regras.test.js testes/pix.test.js testes/temas.test.js
```

```bash
node testes/worker.test.mjs
```

```bash
node testes/asaas.test.mjs
```

```bash
node testes/jogo.test.mjs
```

```bash
node testes/pulo.test.mjs
```

Tema exclusivo de loja: as regras e o passo a passo antes de publicar estão em `TEMAS.md`.

## Publicar de graça (GitHub Pages)

1. Crie um repositório no GitHub e suba a pasta `app` inteira.
2. Em *Settings > Pages*, escolha a branch e a pasta. O endereço fica
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
3. Domínio próprio (desde 24/09/2026): **ligeiropedidos.com.br**, comprado no Registro.br (no CPF, vence em
   24/09/2027). Zona DNS no modo avançado: 4 registros A (185.199.108.153 a 185.199.111.153) e o CNAME
   `www` para `ligeiropedidos.github.io`. O arquivo `CNAME` do repositório liga o domínio no GitHub Pages; o
   certificado é da Let's Encrypt (o GitHub renova). O endereço antigo manda para o novo sozinho, e o `sw.js` segue
   essa mudança e se desliga do endereço velho. Também foram atualizados: `ORIGENS` do mensageiro, "Domínios
   autorizados" do Firebase Authentication e o final dos comerciais.
   Os e-mails de mentira também foram para o domínio nosso (25/09/2026): login da equipe
   `equipe-<loja>@equipe.ligeiropedidos.com.br` e pagador do Mercado Pago `cliente<senha>@<loja>.ligeiropedidos.com.br`.
   Antes eram no `ligeiro.app.br`, que não é nosso: quem o registrasse receberia o "esqueci a senha" da equipe. O login
   velho continua entrando (o site tenta o novo e depois o velho) até o dono salvar a senha da equipe de novo, quando o
   mensageiro troca o e-mail do mesmo usuário.
4. Ícones e prévia do link (24/09/2026): o mascote sem fundo nos ícones da aba (`img/favicon-48/96/192.png`) e
   no ícone `any` do manifesto; com fundo branco no iPhone (`apple-touch-icon.png`, 180) e no `maskable` do
   Android (`icone-maskable-*.png`, mascote em 70% do quadro, que o sistema recorta em círculo). A prévia do
   WhatsApp e das redes é `img/previa-link.jpg` (1200x630) e fala com quem vai pedir, porque o link de toda loja
   tem `#` e o WhatsApp não lê o que vem depois dele: todas as lojas mostram esta mesma prévia. O título e a
   descrição do Google (`<title>` e `description`) continuam falando com o lojista. Para refazer, em `../comercial`:
   `hypit capture run scripts/icones.mjs --channel chrome -- out/icones`, depois
   `node scripts/png_paleta.mjs <entrada> <saida>` em cada PNG (paleta de 256 cores, até 10 vezes menor, igual a
   olho) e `hypit capture run scripts/previa_link.mjs --channel chrome -- out/icones/previa-link.jpg`.

O Firebase está ligado desde 18/09/2026 (projeto `ligeiro-18df1`). Os passos
abaixo ficam como referência.

## Ligar o Firebase (dados na nuvem, painel em tempo real)

1. Em <https://console.firebase.google.com> crie um projeto (plano Spark, grátis,
   sem cartão).
2. Ative **Firestore Database** (modo produção) e **Authentication** com
   *E-mail/senha*.
3. Em *Configurações do projeto > Seus apps > Web*, copie o objeto de
   configuração e cole em `js/config.js`, no lugar do `firebase: null`.
4. Para cada loja, crie um usuário (e-mail e senha) em *Authentication* e
   grave o e-mail no campo `donoEmail` do documento da loja. O painel, a
   cozinha e o entregador passam a entrar com essa senha.
5. Regras do Firestore: abra `ferramentas/firestore.rules`, copie o arquivo
   inteiro e cole na aba Regras do console (apague o que estiver lá antes).
   Publique o mensageiro novo ANTES das regras. Se trocar o e-mail do admin,
   mude em `js/config.js` (`adminEmail`) e na função `isAdmin` das regras.

Site publicado em https://ligeiropedidos.github.io (repositório ligeiropedidos/ligeiropedidos.github.io); projeto Firebase ligeiro-18df1.
O que as regras garantem: dono só mexe na própria loja e não se dá plano pago;
cliente só cria pedido e cancela enquanto aguarda o Pix; contadores andam um
passo por vez (a senha volta para 1 no dia novo); fotos, segredos e fila de
pedidos só da própria loja; relatório de vendas guardado por dia (resumos);
loja nova recusada com as vagas fechadas; login da equipe não cria conta nem
loja; cardápio com até 20 categorias e 300 itens. Ainda falta: os códigos de cupom ficam à vista no
documento da loja (achado 17, depende do site e do painel).

Detalhes do modo nuvem que valem saber:

- A **senha do painel nunca vai pro Firestore** (o documento da loja é
  público). Login é por e-mail e senha do Firebase Authentication; o campo
  "Nova senha" do painel só existe na demonstração.
- **Horários** ficam gravados como texto (`"18:00-23:00"`) porque o Firestore
  não aceita lista dentro de lista. `js/dados.js` converte nos dois sentidos.
- **O pedido nasce no mensageiro** (rota `/pedido`): ele monta o pedido com as
  regras e o cardápio, dá a senha do dia e conta o uso do cupom num lote só. O
  banco não aceita pedido gravado direto pelo celular (só o dono e o admin).
- **Cupons ficam na parte privada** (`lojas/<slug>/privado/cupons`): a loja
  pública só diz `temCupom`. O site pergunta ao mensageiro se o código vale
  (`/cupom`, 12 tentativas a cada 10 min por aparelho). O painel muda a lista
  antiga de lugar sozinho quando o dono abre os Ajustes (só com o mensageiro novo
  no ar). Os usos contam em `lojas/<slug>/contadores/cupom-CODIGO`.
- Salvar a loja usa `update()` (troca o campo inteiro), então grupo e cupom
  apagados somem de verdade.
- Em `#/admin` no modo nuvem, o cadastro pede o e-mail do dono no lugar da
  senha; crie o usuário com esse e-mail em *Authentication*. Preencha
  `adminEmail` em `js/config.js` com o seu e-mail pra abrir o admin.

### Quanto o plano grátis aguenta

Com o cardápio, a loja e as fotos vindo pela borda (Cloudflare KV), o Firebase
grátis fica só com os pedidos. Pela conta feita depois da otimização, cada
pedido gasta perto de 18 leituras (eram 27,6) e o fixo do dia caiu para uns 5 mil.
Dá cerca de 2.400 pedidos por dia no total; 11 lojas com 150 pedidos cada usam
uns 70% da cota, e com 80 pedidos cada, menos de 40%. O que mais pesou:
- **Marca de dono no login** (`/dono`): as regras reconhecem o dono sem ler a
  loja. Antes cada pedido que andava custava 2 leituras no painel do dono.
- **Painel ouve só o que está andando**: o celular que volta do bloqueio relê só
  esses, não o dia inteiro. Concluídos e cancelados carregam num toque.
- **Entregador filtra no banco** (só entrega), **cozinha e entregador abrem pela
  borda**, **token do Mercado Pago guardado na borda** (6 h) e **cartão aprovado
  numa gravação só**. A cópia da loja confere o banco a cada 6 h (a vitrine a
  cada 3 h): toda mudança de verdade já chega na hora pelo `/publicar`.
- **Dica sem código**: no PC do balcão, entre com a senha da equipe.

Por isso o sistema trava em 11
lojas de clientes (12 com a Dom Conizza): o limite fica em `capacidade.maxLojas`
no `js/config.js` e pode ser mudado pela Central sem publicar o site. A partir
daí, cliente novo cai na lista de espera. O quadro "Pedidos hoje no banco" da
Central mostra o uso do dia; passando de 70%, é hora do plano Blaze (centavos
por 100 mil leituras, com alerta de gasto). Fotos: uns 20 KB cada; 12 lojas com
40 fotos dão cerca de 10 MB do 1 GB grátis.

**Espaço (1 GB):** o que mais ocupa são os índices automáticos dos pedidos (um
pedido de 2 KB leva uns 14 KB de índice). Isenções de índice no console tiram
quase tudo: Firestore > Índices > Campo único > Adicionar isenção, coleção
`pedidos` (grupo de coleções), campos `itens`, `cliente`, `endereco`, `aviso` e
`mp`, desmarcando todas as opções. Nenhuma consulta do site usa esses campos.
Com isso cada pedido cai para uns 3 a 4 KB no total.

## O que ainda não tem (de propósito)

- Robô de WhatsApp (a Meta cobra cada mensagem; os robôs não oficiais fazem o número ser banido),
  nota fiscal, integração com iFood, PDV completo.
- Aplicativo nas lojas: o site já se instala na tela do celular pelo navegador;
  a Google Play vem depois da entrega do projeto.
