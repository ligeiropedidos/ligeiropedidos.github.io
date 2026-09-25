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

  /* Precos, em centavos. anual: 0 esconde o plano anual. diasGratis: periodo de teste sem cartao (7 dias, e acabou parou).
     So o texto das telas le daqui: quem decide e ASSINATURA.diasGratis em js/regras.js (o mensageiro usa a mesma) e o
     DIAS_GRATIS do worker-asaas. Mudar um, mudar os tres (um teste confere). */
  precos: { mensal: 8900, anual: 89000, diasGratis: 7 },
  /* Preco de fundador: as primeiras lojas que PAGAREM travam o preco antigo enquanto nao cancelarem (campo "fundador" de cada plano).
     A contagem publica fica em publico/fundadores e sobe quando o admin (ou o Asaas) confirma o primeiro pagamento. */
  fundador: { vagas: 5, jaOcupadas: 0 }, /* 5 vagas so para clientes (era 20, depois 10): a meta de 5 lojas pagando. A Dom Conizza nao conta (jaOcupadas 0) */
  /* Limite de lojas no sistema (0 = sem limite). Passou disso, cliente novo cai na lista de espera ate subirmos a estrutura.
     A Central muda o limite e abre/fecha as vagas sem publicar o site (fica em publico/fundadores.capacidade). */
  /* tamanho do cardapio de cada loja: tudo fica num documento so (limite do banco) e baixa inteiro no celular do cliente.
     As regras do banco (ferramentas/firestore.rules, cardapioNoLimite) usam os mesmos numeros */
  limites: { categorias: 20, itens: 300, grupos: 30, opcoes: 30 },
  capacidade: { maxLojas: 11 }, /* 11 lojas no gratis: com o cardapio na borda o Firebase gratis aguenta ~2.100 pedidos/dia; da ~190 por loja, e o pico de sexta cabe. Sobe no Blaze */
  /* Um plano so, tudo incluso (centavos): 1 loja por conta, mensal ou anual. Outra loja = outra conta (outro e-mail), com a
     propria assinatura (decidido em 25/09/2026: trocar entre 1, 2 e 3 lojas era o que mais dava dor de cabeca com dinheiro).
     anual: 0 esconde o anual */
  planos: [
    { id: 'uma', nome: 'Ligeiro', lojas: 1, mensal: 8900, anual: 89000, fundador: { mensal: 7900, anual: 79000 }, frase: 'Tudo incluso para a sua loja' },
  ],

  /*
   * Cobranca automatica (cartao de credito e boleto) por link de assinatura.
   * Crie no Asaas (Cobrancas > Links de pagamento > tipo Assinatura, mensal ou anual)
   * um link por plano e cole aqui. Vazio = so Pix manual. O mesmo link aceita cartao e boleto.
   * O aviso "pagou" chega pelo webhook do Asaas no ferramentas/worker-asaas.js.
   */
  cobranca: {
    provedor: 'Asaas',
    /* o mensageiro do Asaas: mensal/anual (muda a mesma assinatura, vale na proxima fatura) e encerrar (cancela a assinatura) passam por ele */
    mensageiro: 'https://ligeiro-asaas.ligeiro-pedidos.workers.dev',
    /* linksFundador: os mesmos links, com o preco de fundador (so quem tem a vaga ve esses). Os de 2 e 3 lojas sairam
       (plano unico); no Asaas eles podem ser desativados */
    linksFundador: {
      uma: { mensal: 'https://www.asaas.com/c/0ecl013dsndt48ta', anual: 'https://www.asaas.com/c/ijf1apwcx3f7q5e3' },
    },
    /* conferidos na pagina publica de cada link em 25/09/2026: nome, valor e frequencia batem com os planos acima */
    links: {
      uma: { mensal: 'https://www.asaas.com/c/7fqf0ii8xsgy70el', anual: 'https://www.asaas.com/c/xlpz69ezcezhvn0q' },
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

  /* App Check: chave do site do reCAPTCHA v3 (Firebase > App Check > Apps > Web > reCAPTCHA v3).
     Com ela, so o site do Ligeiro consegue falar com o banco (robo que tenta gastar as leituras gratis fica de fora).
     Vazia = desligado. Depois de ligar aqui e publicar, espere 1 dia e so entao ative a "aplicacao" (Enforce) no Firebase. */
  appCheck: '',

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
