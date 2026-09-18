# Ligeiro — pedido ligeiro, sem comissão

Sistema de pedidos para lanchonete, pizzaria, marmitaria e afins de cidade
pequena. Cada estabelecimento ganha um **link próprio** (o cliente pede em modo
totem e paga no Pix), um **painel** (o pedido cai apitando), um **modo balcão**
(tablet no caixa), uma **tela da cozinha** e uma **tela do entregador**. Tudo
roda no navegador, sem servidor próprio.

## Como abrir agora (modo demonstração)

Dois cliques em `index.html`. Pronto. Tudo fica guardado só neste navegador.

Ou, pelo Claude Code, o servidor `ligeiro` do `.claude/launch.json` abre em
<http://localhost:8765>.

| O que | Endereço | Senha |
|---|---|---|
| Hub das cidades | `#/` | — |
| Lojas de Juquiá | `#/juquia` | — |
| Loja (cliente pede aqui) | `#/juquia/dom-conizza` | — |
| Painel do dono | `#/painel/dom-conizza` | `1234` |
| Modo balcão (tablet) | `#/balcao/dom-conizza` | — |
| Tela da cozinha | `#/cozinha/dom-conizza` | `1234` |
| Tela do entregador | `#/entrega/dom-conizza` | `1234` |
| Cadastro de estabelecimentos (Ligeiro) | `#/admin` | `ligeiro` |
| Página de vendas pro lojista (calculadora, plano, dúvidas) | `#/lojas` | — |
| O dono cria a própria loja (nome, WhatsApp, frete) | `#/comecar` ou `#/comecar/anual` | — |
| Escolher plano (mensal ou anual) | `#/assinar` | — |
| Entrar na conta (Google ou e-mail e senha) | `#/entrar` | — |
| Minha conta: as lojas do dono, painel sem senha, criar outra loja | `#/conta` | — |
| Termos de uso e privacidade | `#/termos`, `#/privacidade` | — |

## Senha da equipe (cozinha, entregador, balcão)

- O dono define em Minha loja ou Minha conta. O mensageiro (`POST /equipe`,
  com o idToken do dono) cria ou troca o usuário `equipe-<slug>@equipe.ligeiro.app.br`
  no Firebase Auth com senha `LIG-<pin>`. As regras dão a esse usuário só
  `list`/`update` nos pedidos da própria loja (`isEquipe`).
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

## Como funciona o dinheiro

- **Pix copia e cola** é gerado no próprio navegador (`js/pix.js`), no padrão
  BR Code do Banco Central, com a chave da loja e o valor exato. O dinheiro vai
  do cliente **direto** para a conta do dono. O Ligeiro nunca encosta nele e
  não paga taxa a ninguém.
- O cliente toca em "Já paguei"; o dono confere no app do banco e toca em
  "Confirmar Pix recebido". Confirmação automática (Mercado Pago, ~1% por Pix,
  pago pela loja) fica para uma etapa seguinte.
- Maquininha e dinheiro na entrega ou no balcão entram na fila na hora, com o
  troco já calculado. A tela do entregador mostra o que cobrar.

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

## Pastas

```
index.html            página única (todas as telas)
css/ligeiro.css       estilo totem: botão grande, uma decisão por tela
js/config.js          liga o Firebase (vazio = modo demonstração) e senha do admin
js/regras.js          regras do pedido (conta, validação, status, WhatsApp, cardápio em texto) — roda no Node também
js/pix.js             gerador do Pix copia e cola + CRC16
js/dados.js           camada de dados: DemoStore (localStorage) e FirebaseStore (Firestore), fotos, cor e logo
js/seed.js            lojas de exemplo (inclui a logo da Dom Conizza em base64)
js/ui.js              pecinhas de tela: botões, modal, sons, toast, campo de foto, tema de cor
js/cliente.js         hub, vitrine da cidade, loja e pedido em modo totem
js/painel.js          painel do dono: pedidos, cardápio, vendas, ajustes, links, impressão automática
js/equipe.js          tela da cozinha e tela do entregador
js/admin.js           cadastro de estabelecimentos
js/app.js             roteador (#/...)
vendor/qrcode.js      desenha o QR (biblioteca MIT de Kazuhiko Arase)
testes/               testes automáticos (regras e Pix)
ferramentas/          gera os ícones do app
```

Os `<script>` do `index.html` levam `?v=data`. Quando mudar um arquivo, troque
o número pra ninguém ficar com versão velha no cache.

## Testes

```bash
node --test testes/regras.test.js testes/pix.test.js
```

## Publicar de graça (GitHub Pages)

1. Crie um repositório no GitHub e suba a pasta `app` inteira.
2. Em *Settings > Pages*, escolha a branch e a pasta. O endereço fica
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
3. Domínio próprio (opcional): `ligeiro.app.br` no Registro.br apontando para o
   GitHub Pages.

Enquanto `js/config.js` estiver com `firebase: null`, o site publicado continua
em modo demonstração (cada aparelho vê só os próprios dados). Para valer de
verdade, ligue o Firebase:

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
5. Regras do Firestore (ponto de partida):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    /* ---- quem e quem ---- */
    function logado() { return request.auth != null; }
    function isAdmin() { return logado() && request.auth.token.email == 'SEU-EMAIL-ADMIN'; }
    function donoDaLoja(loja) { return get(/databases/$(db)/documents/lojas/$(loja)).data.donoEmail; }
    function isDonoDaLoja(loja) { return logado() && request.auth.token.email == donoDaLoja(loja); }
    /* usuario de equipe da loja (cozinha, entregador, balcao): criado pelo mensageiro quando o dono define a senha da equipe */
    function isEquipe(loja) { return logado() && request.auth.token.email == 'equipe-' + loja + '@equipe.ligeiro.app.br'; }
    function planoDe(d) { return d.get('plano', {}); }
    /* pagoAte vazio: campo ausente, '' ou null valem a mesma coisa */
    function semPago(p) { return p.get('pagoAte', '') == '' || p.get('pagoAte', '') == null; }
    function pagoIgual(a, b) { return a.get('pagoAte', '') == b.get('pagoAte', '') || (semPago(a) && semPago(b)); }
    /* o que so o admin muda no plano: pagoAte, planoPago (o plano que foi pago de fato) e desde (inicio do periodo gratis) */
    function planoDoAdminIntacto(novo, velho) {
      return pagoIgual(novo, velho)
          && novo.get('planoPago', '') == velho.get('planoPago', '')
          && novo.get('desde', '') == velho.get('desde', '');
    }
    /* status: o dono so pode manter, encerrar (cancelado) ou reativar (teste); 'ativo' e 'pausado' so o admin */
    function statusPermitido(novo, velho) {
      return novo.get('status', '') == velho.get('status', '') || novo.get('status', '') in ['cancelado', 'teste'];
    }
    function planoIntacto() {
      return planoDoAdminIntacto(planoDe(request.resource.data), planoDe(resource.data))
          && statusPermitido(planoDe(request.resource.data), planoDe(resource.data))
          && request.resource.data.get('ativa', true) == resource.data.get('ativa', true)
          && request.resource.data.donoEmail == resource.data.donoEmail;
    }
    function minhaConta() { return get(/databases/$(db)/documents/contas/$(request.auth.token.email)).data; }
    /* o plano da loja e copia fiel do plano da conta do dono (status, pagoAte, planoPago, desde) */
    function planoCopiaDaConta(p) {
      return exists(/databases/$(db)/documents/contas/$(request.auth.token.email))
          && pagoIgual(p, planoDe(minhaConta()))
          && p.get('status', 'teste') == planoDe(minhaConta()).get('status', 'teste')
          && p.get('planoPago', '') == planoDe(minhaConta()).get('planoPago', '')
          && p.get('desde', '') == planoDe(minhaConta()).get('desde', '');
    }

    /* conta do dono: a assinatura e daqui. Dono le, escolhe plano, avisa pagamento, encerra e reativa; pagoAte, planoPago, desde e 'ativo' so o admin */
    match /contas/{email} {
      allow read: if isAdmin() || (logado() && request.auth.token.email == email);
      allow create: if isAdmin() || (logado() && request.auth.token.email == email
        && planoDe(request.resource.data).get('status', 'teste') == 'teste'
        && semPago(planoDe(request.resource.data))
        && planoDe(request.resource.data).get('planoPago', '') == '');
      allow update: if isAdmin() || (logado() && request.auth.token.email == email
        && planoDoAdminIntacto(planoDe(request.resource.data), planoDe(resource.data))
        && statusPermitido(planoDe(request.resource.data), planoDe(resource.data)));
      allow delete: if isAdmin();
    }

    /* vitrine: resumo leve de cada loja pro hub e pra pagina das cidades (publico).
       O dono grava DEPOIS da loja (nunca no mesmo lote) e o plano/ativa tem que ser copia do que esta na loja. */
    match /vitrine/{loja} {
      allow read: if true;
      allow create, update: if isAdmin() || (isDonoDaLoja(loja)
        && planoDe(request.resource.data) == planoDe(get(/databases/$(db)/documents/lojas/$(loja)).data)
        && request.resource.data.get('ativa', true) == get(/databases/$(db)/documents/lojas/$(loja)).data.get('ativa', true));
      allow delete: if isAdmin();
    }

    /* indice order -> loja/pedido, gravado pelo mensageiro (conta de servico); ninguem do site precisa ler */
    match /mp_indice/{id} {
      allow read, write: if isAdmin();
    }

    /* contatos da pagina de vendas: visitante cria (so os campos do formulario, com tamanho), so o admin le e marca como atendido */
    match /leads/{id} {
      allow create: if request.resource.data.keys().hasOnly(['id', 'nome', 'whatsapp', 'loja', 'cidade', 'uf', 'origem', 'pagina', 'criadoEm', 'atendidoEm'])
                    && request.resource.data.keys().hasAll(['nome', 'whatsapp', 'criadoEm'])
                    && request.resource.data.nome is string && request.resource.data.nome.size() <= 60
                    && request.resource.data.whatsapp is string && request.resource.data.whatsapp.size() <= 16
                    && request.resource.data.get('loja', '').size() <= 80
                    && request.resource.data.get('cidade', '').size() <= 80
                    && request.resource.data.get('pagina', '').size() <= 200;
      allow read, update, delete: if isAdmin();
    }

    match /lojas/{loja} {
      allow read: if true;
      /* o dono cria a propria loja em #/comecar, sempre depois de ter conta; o plano nasce copiado da conta */
      allow create: if isAdmin()
        || (logado() && request.resource.data.donoEmail == request.auth.token.email
            && planoCopiaDaConta(planoDe(request.resource.data)));
      allow update: if isAdmin() || (logado() && request.auth.token.email == resource.data.donoEmail && planoIntacto());
      allow delete: if isAdmin();

      /* senha do dia (dia, ultima) e usos de cupom: o cliente escreve sem login, dentro da transacao do pedido.
         So os dois nomes de documento, e o contador so anda um passo por vez. */
      match /contadores/{c} {
        allow read: if true;
        allow write: if (c == 'senha' || c.matches('cupom-[A-Z0-9]{1,20}'))
          && request.resource.data.keys().hasOnly(['dia', 'ultima', 'usos', 'atualizadoEm'])
          && request.resource.data.get('usos', 0) is int && request.resource.data.get('ultima', 0) is int
          && (resource == null
              || (request.resource.data.get('usos', 0) >= resource.data.get('usos', 0)
                  && request.resource.data.get('usos', 0) <= resource.data.get('usos', 0) + 1
                  && request.resource.data.get('ultima', 0) <= resource.data.get('ultima', 0) + 1));
      }
      match /fotos/{foto} {
        allow read: if true;
        allow write: if isDonoDaLoja(loja) || isAdmin();
      }
      /* token do Mercado Pago e outros segredos: so o dono (e o admin, pra suporte) */
      match /privado/{doc} {
        allow read, write: if isDonoDaLoja(loja) || isAdmin();
      }
      match /pedidos/{pedido} {
        /* o cliente cria sem login, mas o pedido tem que ter a cara de um pedido do app:
           total inteiro, no maximo 60 itens, nunca nasce "pago" no Pix e nunca nasce com "ja paguei" */
        allow create: if request.resource.data.keys().hasAll(['lojaSlug', 'status', 'total', 'itens', 'criadoEm', 'formaPagamento', 'pagamentoStatus'])
          && request.resource.data.lojaSlug == loja
          && request.resource.data.total is int && request.resource.data.total >= 0
          && request.resource.data.itens is list && request.resource.data.itens.size() <= 60
          && request.resource.data.size() <= 40
          && request.resource.data.get('clientePagou', false) == false
          && request.resource.data.status in ['aguardando_pagamento', 'pago']
          && (request.resource.data.formaPagamento != 'pix' || request.resource.data.total == 0
              || (request.resource.data.status == 'aguardando_pagamento' && request.resource.data.pagamentoStatus == 'pendente'));
        allow get: if true;                               /* o cliente acompanha pelo id, que ninguem adivinha */
        allow list: if isDonoDaLoja(loja) || isEquipe(loja) || isAdmin();   /* a loja e a equipe dela listam a fila */
        allow update: if isDonoDaLoja(loja) || isEquipe(loja) || isAdmin()
          /* cliente: "ja paguei" (so marca, nunca muda status) */
          || (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['clientePagou', 'clientePagouEm', 'atualizadoEm'])
              && request.resource.data.clientePagou == true)
          /* cliente: cancelar o proprio pedido enquanto ainda esta aguardando o Pix */
          || (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'canceladoPor', 'atualizadoEm'])
              && request.resource.data.status == 'cancelado' && request.resource.data.canceladoPor == 'cliente'
              && resource.data.status == 'aguardando_pagamento');
        allow delete: if isAdmin();
      }
    }
  }
}
```

Troque `SEU-EMAIL-ADMIN` pelo mesmo e-mail de `config.adminEmail` (minúsculas). Site publicado em https://ligeiropedidos.github.io (repositório ligeiropedidos/ligeiropedidos.github.io); projeto Firebase ligeiro-18df1.
O que as regras garantem: dono só mexe na própria loja e não se dá plano pago;
cliente só cria pedido, avisa "já paguei" e cancela enquanto aguarda; contadores
só sobem; fotos, segredos e fila de pedidos só da própria loja.

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

Conta de padaria: um pedido gasta uns 6 registros (criar, contador da senha,
mudanças de status) e umas 12 leituras (a loja, o painel acompanhando, o
cliente acompanhando). O Spark dá 20 mil registros e 50 mil leituras por dia,
ou seja, cerca de 3 mil pedidos por dia no total. Dez lojas com 30 pedidos por
dia usam 10% disso. Fotos: uns 20 KB cada, 50 lojas com 40 fotos dão 40 MB do
1 GB grátis. Se um dia estourar, o plano Blaze cobra centavos por 100 mil
leituras e dá pra colocar alerta de gasto.

## O que ainda não tem (de propósito)

- Confirmação automática do Pix (Mercado Pago) — etapa seguinte, opcional.
- Robô de WhatsApp, nota fiscal, integração com iFood, PDV completo.
- Aplicativo nas lojas: o site já se instala na tela do celular pelo navegador;
  a Google Play vem depois da entrega do projeto.
