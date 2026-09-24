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
| Escolher plano | `#/assinar` | — |
| Entrar na conta (só Google) | `#/entrar` | — |
| Minha conta: lojas do dono e assinatura | `#/conta` | — |
| Termos de uso e privacidade | `#/termos`, `#/privacidade` | — |

No site de verdade, a Central entra só com o Google do `adminEmail`, e cozinha e
entregador usam a senha da equipe (seção abaixo).

## Preço de fundador

- `config.fundador.vagas` (5) e o campo `fundador` de cada plano em `config.planos`.
  Visitante e conta que nunca pagou veem o preço de fundador **enquanto houver vaga**
  (`R.vagasFundador`, `R.ehPrecoFundador`, `R.precoDoPlano(plano, tipo, conta)`).
- A vaga é ocupada no **primeiro pagamento confirmado**: o admin grava
  `contas/{email}.plano.fundador = true` (só o admin muda, pelas regras) e soma 1 em
  `publico/fundadores.usados` (público pra ler). Daí em diante a conta paga o preço
  de fundador enquanto não cancelar (`fundador.jaOcupadas` fica 0: a Dom Conizza não conta); o site mostra "Restam X de 5", número de verdade.
- Acabando as vagas, tudo passa a mostrar o preço normal (R$ 89), sempre abaixo do Anota AI.
- Links do Asaas: `cobranca.linksFundador` (preço de fundador) e `cobranca.links` (normal).
  No `worker-asaas.js`, o segredo `PLANOS` precisa listar os dois preços de cada plano.

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

## Assinatura e cobrança

- **Teste grátis de 7 dias** (`config.precos.diasGratis`), sem cartão. No período
  grátis o estado é `gratis` até o último dia (nunca "vencendo") e, acabou, vira
  `bloqueada` no mesmo dia: sem tolerância. Quem já pagou tem 7 dias de aviso e
  10 de tolerância depois do vencimento.
- **Três jeitos de pagar** (`js/cobranca.js`, usado pelo painel e por `#/conta`):
  cartão de crédito com cobrança automática e boleto, pelos **links de
  assinatura do Asaas** em `config.cobranca.links` (um por plano e tipo), e Pix
  na hora pra `config.pixLigeiro` com "Já paguei" (o admin confirma).
- **Confirmação automática:** `ferramentas/worker-asaas.js` recebe o webhook do
  Asaas (pagamento confirmado), acha a conta pelo e-mail do cliente e grava
  `status: 'ativo'`, `pagoAte` (+30 ou +365 dias), `planoPago` e o espelho nas
  lojas e na vitrine, pela REST do Firestore com a conta de serviço. Segredos:
  `ASAAS_KEY`, `ASAAS_WEBHOOK`, `FIREBASE_SA`, `PLANOS`. Regra de ouro: o e-mail
  do cliente no Asaas é o mesmo do login no Ligeiro.
- Sem link cadastrado, tudo continua funcionando só com o Pix manual.

### Como era (Pix manual)

- **A assinatura é da conta, não da loja.** `config.planos` define os planos por
  quantidade de lojas (1, até 2, até 5 e até 8), com preço mensal e anual.
  `contas/{email}.plano` é a verdade (`planoId`, `tipo`, `status`, `desde`,
  `pagoAte`, `avisoPagamentoEm`); `lojas/{slug}.plano` é um espelho que o admin
  atualiza ao confirmar (`store.espelharPlanoNasLojas`). O site da loja e o
  painel leem o espelho; `#/conta` e o admin leem a conta.
- Limite de lojas: `#/comecar` conta as lojas do e-mail e recusa acima do plano
  **que vale** (`R.planoQueVale`): enquanto a conta está paga, vale o
  `plano.planoPago` (gravado pelo admin ao confirmar o Pix); no período grátis
  vale o `planoId` escolhido. Assim ninguém sobe pro plano de 8 lojas de graça
  no meio de um mês pago: o plano novo libera lojas quando o Pix dele cai.
- Conta vencida, bloqueada, pausada ou encerrada não cria loja nova.
- Trocar pra um plano menor só com lojas dentro do novo limite.
- O dono pode encerrar (`cancelado`) e reativar (`teste`) pela regra; o app
  espelha isso nas lojas dele (`salvarConta` chama `espelharPlanoNasLojas`,
  primeiro nas lojas, depois na vitrine).
- Cidades homônimas em estados diferentes ainda dividem o mesmo endereço
  (`#/bom-jesus`). Hoje o Ligeiro é regional (Vale do Ribeira); se um dia
  precisar, o `cidadeSlug` passa a levar a UF.
- Limitação conhecida sem servidor: o total do pedido é calculado no
  navegador. A regra impede pedido "já pago" no Pix e lixo grande, mas um
  pedido com preço adulterado ainda pode entrar; o painel mostra o total e o
  dono confere no Pix (o Pix leva o valor certo do cardápio). Pra fechar isso de
  vez, ligue o **App Check** (reCAPTCHA v3, grátis) no projeto Firebase.

- Preços em `config.precos` (mensal, anual, diasGratis). `#/assinar` escolhe o
  plano e manda pro `#/comecar/<tipo>`; a loja nasce com
  `plano: { status: 'teste', tipo, desde }`.
- `R.assinatura(loja)` diz o estado: **gratis** (dias grátis), **ativa** (paga,
  ou cortesia = status `ativo` sem `pagoAte`), **vencendo** (7 dias),
  **vencida** (10 dias de tolerância, loja no ar) e **bloqueada** (o site
  para de aceitar pedidos e `montarPedido` recusa).
- Pagar: o painel mostra em "Assinatura" um Pix copia e cola pra chave de
  `config.pixLigeiro` (vazia = manda chamar no WhatsApp). "Já paguei" grava
  `plano.avisoPagamentoEm`; no `#/admin` o cartão da loja fica em destaque com
  "✓ Pagou (+30 dias)" ou "(+1 ano)", que grava `pagoAte`, `planoPago` e `status: 'ativo'`.
- Nas regras do Firestore (bloco completo mais abaixo), o dono pode gravar
  `plano.avisoPagamentoEm`, mas só o admin muda `plano.pagoAte`, `plano.status`
  e `ativa` (função `planoIntacto`).

- `#/entrar` acha o painel pelo link da loja; `#/termos` e `#/privacidade`
  usam `config.empresa` (nome, CNPJ, e-mail) quando preenchido.

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

## Testes

```bash
node --test testes/regras.test.js testes/pix.test.js testes/temas.test.js
```

```bash
node testes/worker.test.mjs
```

Tema exclusivo de loja: as regras e o passo a passo antes de publicar estão em `TEMAS.md`.

## Publicar de graça (GitHub Pages)

1. Crie um repositório no GitHub e suba a pasta `app` inteira.
2. Em *Settings > Pages*, escolha a branch e a pasta. O endereço fica
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
3. Domínio próprio (opcional): `ligeiro.app.br` no Registro.br apontando para o
   GitHub Pages.

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
- **Cupom com limite de usos** é contado em `lojas/<slug>/contadores/cupom-CODIGO`
  dentro da mesma transação que cria o pedido; quem tenta usar além do limite
  recebe a mensagem na hora de confirmar.
- Salvar a loja usa `update()` (troca o campo inteiro), então grupo e cupom
  apagados somem de verdade.
- Em `#/admin` no modo nuvem, o cadastro pede o e-mail do dono no lugar da
  senha; crie o usuário com esse e-mail em *Authentication*. Preencha
  `adminEmail` em `js/config.js` com o seu e-mail pra abrir o admin.

### Quanto o plano grátis aguenta

Com o cardápio, a loja e as fotos vindo pela borda (Cloudflare KV), o Firebase
grátis fica só com os pedidos e aguenta cerca de 2.100 pedidos por dia no total,
uns 190 por loja, com folga para o pico de sexta. Por isso o sistema trava em 11
lojas de clientes (12 com a Dom Conizza): o limite fica em `capacidade.maxLojas`
no `js/config.js` e pode ser mudado pela Central sem publicar o site. A partir
daí, cliente novo cai na lista de espera. O quadro "Pedidos hoje no banco" da
Central mostra o uso do dia; passando de 70%, é hora do plano Blaze (centavos
por 100 mil leituras, com alerta de gasto). Fotos: uns 20 KB cada; 12 lojas com
40 fotos dão cerca de 10 MB do 1 GB grátis.

## O que ainda não tem (de propósito)

- Robô de WhatsApp (a Meta cobra cada mensagem; os robôs não oficiais fazem o número ser banido),
  nota fiscal, integração com iFood, PDV completo.
- Aplicativo nas lojas: o site já se instala na tela do celular pelo navegador;
  a Google Play vem depois da entrega do projeto.
