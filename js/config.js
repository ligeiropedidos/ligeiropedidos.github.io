/*
 * Ligeiro - configuracao do sistema.
 *
 * MODO DEMONSTRACAO: enquanto "firebase" estiver vazio (null), tudo roda dentro
 * do proprio navegador (localStorage). Serve para testar, apresentar e vender.
 * Os dados ficam so neste aparelho.
 *
 * MODO DE VERDADE: cole aqui a configuracao do projeto Firebase (Console do
 * Firebase > Configuracoes do projeto > Seus apps > Web). Com isso, lojas e
 * pedidos passam a viver na nuvem e o painel do dono recebe o pedido em tempo
 * real em qualquer aparelho.
 */
window.LIGEIRO_CONFIG = {
  /* Projeto "Ligeiro" no Firebase (ligeiro.pedidos@gmail.com), criado em 18/09/2026. Estas chaves sao publicas. */
  firebase: {
    apiKey: "AIzaSyBO5tk0CUgUK6llez_y88G9sei5oP9B4SY",
    authDomain: "ligeiro-18df1.firebaseapp.com",
    projectId: "ligeiro-18df1",
    storageBucket: "ligeiro-18df1.firebasestorage.app",
    messagingSenderId: "402578950250",
    appId: "1:402578950250:web:6347449308ecf007012213",
  },

  /* So existe no modo demonstracao (sem Firebase). No site de verdade o #/admin nao tem senha:
     entra apenas o Google do adminEmail, e as regras do banco conferem de novo. */
  senhaAdmin: 'ligeiro',

  /* No modo de verdade: e-mail do usuario (Firebase Authentication) que abre o #/admin. */
  adminEmail: 'ligeiro.pedidos@gmail.com',

  /* Nome da cidade que abre primeiro no hub quando o celular ainda nao lembra. */
  cidadePadrao: 'juquia',

  /* WhatsApp de quem vende o Ligeiro (com DDD, so numeros). Aparece no botao
     "Quero na minha loja" da pagina #/lojas e no rodape das lojas. Vazio = esconde. */
  whatsappLigeiro: '5513996447414',

  /* Mensageiro do Pix (Cloudflare Worker, ferramentas/worker-mercadopago.js): cria o Pix do pedido
     na hora com o token Mercado Pago da loja e confirma sozinho. Vazio = ninguem consegue pagar no Pix
     (o cliente paga na entrega ou no balcao). */
  proxyMercadoPago: 'https://ligeiro-mp.ligeiro-pedidos.workers.dev',
  /* Client ID (publico) da aplicacao "Ligeiro plataforma" no Mercado Pago: liga o botao
     "Conectar com Mercado Pago" no painel. O Client Secret vai so no worker (MP_CLIENT_SECRET). */
  mercadoPagoClientId: '4386028316883153',

  /* Precos, em centavos. anual: 0 esconde o plano anual. diasGratis: periodo de teste sem cartao (7 dias, e acabou parou). */
  precos: { mensal: 8900, anual: 89000, diasGratis: 7 },
  /* Preco de fundador: as primeiras lojas que PAGAREM travam o preco antigo enquanto nao cancelarem (campo "fundador" de cada plano).
     A contagem publica fica em publico/fundadores e sobe quando o admin (ou o Asaas) confirma o primeiro pagamento. */
  fundador: { vagas: 20, jaOcupadas: 1 }, /* jaOcupadas: a Dom Conizza ja conta como loja fundadora */
  /* Planos por quantidade de lojas na mesma conta (centavos). A assinatura e da conta:
     um Pix por mes libera todas as lojas dela. anual: 0 esconde o anual. */
  planos: [
    { id: 'uma', nome: 'Uma loja', lojas: 1, mensal: 8900, anual: 89000, fundador: { mensal: 7900, anual: 79000 }, frase: 'Para quem tem um ponto' },
    { id: 'duas', nome: 'Até 2 lojas', lojas: 2, mensal: 15900, anual: 159000, fundador: { mensal: 13900, anual: 139000 }, frase: 'Matriz e filial' },
    { id: 'cinco', nome: 'Até 5 lojas', lojas: 5, mensal: 33900, anual: 339000, fundador: { mensal: 29900, anual: 299000 }, frase: 'Para quem está crescendo' },
    { id: 'oito', nome: 'Até 8 lojas', lojas: 8, mensal: 47900, anual: 479000, fundador: { mensal: 42900, anual: 429000 }, frase: 'Rede da região' },
  ],

  /*
   * Cobranca automatica (cartao de credito e boleto) por link de assinatura.
   * Crie no Asaas (Cobrancas > Links de pagamento > tipo Assinatura, mensal ou anual)
   * um link por plano e cole aqui. Vazio = so Pix manual. O mesmo link aceita cartao e boleto.
   * O aviso "pagou" chega pelo webhook do Asaas no ferramentas/worker-asaas.js.
   */
  cobranca: {
    provedor: 'Asaas',
    /* linksFundador: os mesmos oito links, com o preco de fundador (so quem tem a vaga ve esses) */
    linksFundador: { uma: { mensal: '', anual: '' }, duas: { mensal: '', anual: '' }, cinco: { mensal: '', anual: '' }, oito: { mensal: '', anual: '' } },
    links: {
      uma: { mensal: '', anual: '' },
      duas: { mensal: '', anual: '' },
      cinco: { mensal: '', anual: '' },
      oito: { mensal: '', anual: '' },
    },
  },

  /* Chave Pix do Ligeiro pra receber a mensalidade. Aparece no painel da loja
     em "Assinatura" como Pix copia e cola. Vazia = a loja combina no WhatsApp. */
  pixLigeiro: { chave: '', nome: 'Ligeiro', cidade: 'Juquia' },

  /* Dados da empresa pro rodape, termos de uso e privacidade. Preencha quando tiver CNPJ. */
  empresa: { nome: '', cnpj: '', cidade: 'Juquiá, SP', email: 'ligeiro.pedidos@gmail.com' },

  /* Visitas: Cloudflare Web Analytics (gratis, sem cookie). No painel do Cloudflare:
     Analytics & Logs > Web Analytics > Add a site > copie o token. Vazio = sem medicao. */
  analytics: { cloudflareToken: '' },

  /* Loja que a pagina de vendas mostra como exemplo ("Ver uma loja de verdade"). */
  lojaDemo: 'juquia/dom-conizza',
  /* Servico extra: loja com design exclusivo (igual ao da Dom Conizza). Preco "a partir de", em centavos, pago uma vez. */
  lojaCustomizada: { aPartirDe: 39000 },

  /* Lojas com tema exclusivo (css/temas/<tema>.css). So o Ligeiro mexe aqui; nenhuma loja ganha isso pelo painel.
     oficial: true = loja do proprio Ligeiro (ganha o selo "Loja oficial"). Cliente que contratou o design exclusivo
     entra aqui com oficial: false: tem o tema, a logo grande e a tela de carregamento, mas nao o selo. */
  lojasOficiais: {
    'dom-conizza': { oficial: true, tema: 'conizza', fontes: ['700 1em "Baloo 2"', '800 1em "Baloo 2"', '400 1em Nunito', '700 1em Nunito', '800 1em Nunito'], logo: 'img/oficial/dom-conizza-logo.webp', ilustracao: 'img/oficial/dom-conizza-cozinhando.webp', frase: 'Sai do forno direto para sua porta', subfrase: 'Feito na hora, quentinho e caprichado do começo ao fim.', enfeites: ['🍕', '🧀', '🌶️', '🥓', '🍅', '🍄'] },
  },
};
