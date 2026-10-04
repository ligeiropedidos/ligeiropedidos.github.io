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
    /* o login do Google pelo nosso dominio: a tela do Google mostra ligeiropedidos.com.br (o worker do site repassa /__/auth/
       ao Firebase; o endereco esta autorizado no Google Cloud, cliente OAuth "Web client", desde 29/09/2026) */
    authDomain: "ligeiropedidos.com.br",
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
  fundador: { vagas: 10, jaOcupadas: 0 }, /* 10 vagas so para clientes (era 20, depois 10, depois 5; voltou a 10 em 29/09/2026 para o comercial do Luciano). A Dom Conizza nao conta (jaOcupadas 0) */
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

  /* Visitas: Cloudflare Web Analytics (gratis, sem cookie). Ligado desde 25/09/2026 pela configuracao automatica do
     Cloudflare (ele poe o contador sozinho em toda pagina, ja no modo de site de uma pagina so). Por isso o token fica
     vazio aqui: com os dois, cada visita contaria em dobro. automatico: so para a Central mostrar que esta ligado */
  analytics: { cloudflareToken: '', automatico: true,
    /* Pixel do Meta (anuncios no Instagram e no Facebook): o numero do pixel (so digitos) do Gerenciador de Anuncios. Vazio = desligado,
       nada do Meta e carregado. Manda PageView, Lead (contato ou "terminar pelo WhatsApp") e CompleteRegistration (loja criada) */
    metaPixel: '' },

  /* App Check: chave do site do reCAPTCHA v3 (Firebase > App Check > Apps > Web > reCAPTCHA v3).
     Com ela, so o site do Ligeiro consegue falar com o banco (robo que tenta gastar as leituras gratis fica de fora).
     Vazia = desligado. Depois de ligar aqui e publicar, espere 1 dia e so entao ative a "aplicacao" (Enforce) no Firebase. */
  appCheck: '',

  /* Loja que a pagina de vendas mostra como exemplo ("Ver uma loja de verdade"). */
  lojaDemo: 'juquia/dom-conizza',
  /* Servico extra: loja com design exclusivo (igual ao da Dom Conizza). Preco "a partir de", em centavos, pago uma vez. */
  lojaCustomizada: { aPartirDe: 39900 }, /* o mesmo preco da Loja do Ligeiro (lojaLigeiro.servicos, design) */

  /* Loja do Ligeiro: servicos que o Ligeiro vende para as lojas (no painel, aba Minha loja). Quem cobra e confere o preco
     e o mensageiro do Asaas (SERVICOS e TERMOS_SERVICOS no worker-asaas.js): mudar la e aqui juntos (um teste confere).
     ligada: false = so o admin ve (para testar depois de colar o mensageiro); true = todos os donos veem.
     videoExplicativo: o video que explica a loja, em pe (arquivo do site: midia/...mp4, a capa e o mesmo nome em .jpg; ou o id de
     um video entregue pela Central); vazio = o mascote no lugar. */
  lojaLigeiro: {
    ligada: true,
    termos: '2026-09-26',
    videoExplicativo: 'midia/loja-ligeiro.mp4?v=2', /* v2: capa nova (o mascote no balcao, sem repetir o titulo do lado) */ /* tutorial de 40 s (comercial/loja, 26/09/2026) */
    atendimento: 'Atendimento de segunda a sexta, das 9h às 18h',
    servicos: [
      { id: 'fotos', nome: 'Fotos do cardápio', icone: 'camera', valor: 6900, dias: 3, ajustes: 1, sub: 'até 10 fotos',
        resumo: 'A gente melhora as fotos que você já tem: fundo limpo, luz boa e cor que dá vontade de pedir.',
        inclui: ['Até 10 fotos do seu cardápio melhoradas', 'Fundo limpo e padronizado, luz e cor corrigidas', 'No tamanho certo para o cardápio do Ligeiro', 'Um ajuste depois da entrega'],
        precisa: ['As fotos que você já tem, tiradas no celular mesmo', 'O nome do item de cada foto'] },
      { id: 'logo', nome: 'Logo', icone: 'pena', valor: 11900, dias: 5, ajustes: 2, sub: 'até 2 propostas',
        resumo: 'Uma logo que fica bonita no site, na sacola e na prévia do link no WhatsApp.',
        inclui: ['Até 2 propostas para você escolher', 'Dois ajustes na proposta escolhida', 'Arquivos para o site, o Instagram e a impressão', 'Já aplicada no site da sua loja'],
        precisa: ['O nome da loja do jeito que quer escrito', 'Cores e estilos de que você gosta (ou não gosta)', 'A logo antiga, se tiver'] },
      { id: 'video', nome: 'Vídeo promocional', icone: 'video', valor: 14900, dias: 5, ajustes: 0, sub: 'até 20 segundos',
        resumo: 'Vídeo vertical para o Status, o Instagram e o site da sua loja, com botão de play.',
        inclui: ['Vídeo vertical de até 20 segundos, no tamanho do Status, do Reels e do TikTok', 'Texto na tela com os produtos e os preços que você escolher', 'Música liberada para postar', 'O vídeo entra no site da sua loja, com botão de play', 'Você aprova o roteiro antes da produção'],
        precisa: ['Fotos dos produtos, ou usamos as do seu cardápio', 'Sua logo, se tiver', 'O que destacar: uma promoção, um combo ou o horário'] },
      { id: 'design', nome: 'Design exclusivo', icone: 'paleta', valor: 39900, dias: 10, ajustes: 2, sub: 'logo inclusa', premium: true,
        resumo: 'O site e o painel da sua loja com as suas cores, letras e desenhos.',
        inclui: ['Tema próprio: cores, letras e botões da sua marca', 'Abertura do site com a sua logo grande', 'Vale para o site e para o painel', 'Logo inclusa, se ainda não tiver uma', 'Dois ajustes'],
        precisa: ['Sua logo, ou o que imagina para ela', 'Cores e sites de que você gosta'] },
    ],
  },

  /* Lojas com tema exclusivo (css/temas/<tema>.css). So o Ligeiro mexe aqui; nenhuma loja ganha isso pelo painel.
     oficial: true = loja do proprio Ligeiro (ganha o selo "Loja oficial"). Cliente que contratou o design exclusivo
     entra aqui com oficial: false: tem o tema, a logo grande e a tela de carregamento, mas nao o selo. */
  lojasOficiais: {
    'dom-conizza': { oficial: true, tema: 'conizza', fontes: ['700 1em "Baloo 2"', '800 1em "Baloo 2"', '400 1em Nunito', '700 1em Nunito', '800 1em Nunito'], logo: 'img/oficial/dom-conizza-logo.webp', enfeites: ['🍕', '🧀', '🌶️', '🥓', '🍅', '🍄'] },
    /* cliente com design exclusivo (27/09/2026): palco escuro com fogo e grelha na abertura; desenhos no lugar das fotos que faltam */
    'burger-house': { oficial: false, tema: 'burgerhouse', logo: 'img/oficial/burger-house-logo.webp', enfeites: ['', '', '', '', '', '', '', '', '', ''], corFundo: '#120A06',
      desenhos: { lanches: 'img/oficial/bh-burger.svg', porcoes: 'img/oficial/bh-batata.svg', refrigerantes: 'img/oficial/bh-bebida.svg', sucos: 'img/oficial/bh-bebida.svg', bebidas: 'img/oficial/bh-bebida.svg' } },
    /* cliente com design exclusivo (03/10/2026): palco laranja com raios de sol e o selo da marca; fotos PARECIDAS de banco de imagem (Pexels) nos lanches
       enquanto as fotos de verdade nao chegam (img/oficial/mak/CREDITOS.txt) */
    'mak-burguer': { oficial: false, tema: 'makburguer', logo: 'img/oficial/mak-burguer-logo.webp', frase: 'Acendendo a chapa', fogo: true, enfeites: ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], corFundo: '#0C0907',
      desenhos: {
        /* cardapio de exemplo da amostra (antes de colar o do Mak): as mesmas fotos, para a loja nunca aparecer com ilustracao */
        'produto:x-burguer': 'img/oficial/mak/mak-burguer.webp', 'produto:x-salada': 'img/oficial/mak/mak-salada.webp', 'produto:x-bacon': 'img/oficial/mak/mak-bacon.webp',
        'produto:x-tudo': 'img/oficial/mak/mak-monster.webp', 'produto:batata': 'img/oficial/mak/batata-trionda.webp', 'produto:batata-cheddar': 'img/oficial/mak/batata-trionda.webp', 'produto:refri-lata': 'img/oficial/mak/refri-lata.webp', 'produto:suco': 'img/oficial/mak/suco.webp',
        'produto:mak-burguer': 'img/oficial/mak/mak-burguer.webp',
        'produto:mak-salada': 'img/oficial/mak/mak-salada.webp',
        'produto:mak-doritos': 'img/oficial/mak/mak-doritos.webp',
        'produto:mak-picles': 'img/oficial/mak/mak-picles.webp',
        'produto:mak-palha': 'img/oficial/mak/mak-palha.webp',
        'produto:mak-bacon': 'img/oficial/mak/mak-bacon.webp',
        'produto:mak-cheddar': 'img/oficial/mak/mak-cheddar.webp',
        'produto:mak-onion': 'img/oficial/mak/mak-onion.webp',
        'produto:mak-ring': 'img/oficial/mak/mak-ring.webp',
        'produto:mak-chilli': 'img/oficial/mak/mak-chilli.webp',
        'produto:mak-egg': 'img/oficial/mak/mak-egg.webp',
        'produto:mak-toscana': 'img/oficial/mak/mak-toscana.webp',
        'produto:mak-chicken': 'img/oficial/mak/mak-chicken.webp',
        'produto:mak-vegetariano-1': 'img/oficial/mak/mak-vegetariano-1.webp',
        'produto:mak-vegetariano-2': 'img/oficial/mak/mak-vegetariano-2.webp',
        'produto:mak-duplo-burguer': 'img/oficial/mak/mak-duplo-burguer.webp',
        'produto:mak-duplo-salada': 'img/oficial/mak/mak-duplo-salada.webp',
        'produto:mak-duplo-cheddar': 'img/oficial/mak/mak-duplo-cheddar.webp',
        'produto:mak-duplo-bacon': 'img/oficial/mak/mak-duplo-bacon.webp',
        'produto:mak-duplo': 'img/oficial/mak/mak-duplo.webp',
        'produto:mak-fabuloso': 'img/oficial/mak/mak-fabuloso.webp',
        'produto:mak-churrasco': 'img/oficial/mak/mak-churrasco.webp',
        'produto:mak-ousadia': 'img/oficial/mak/mak-ousadia.webp',
        'produto:mak-mix': 'img/oficial/mak/mak-mix.webp',
        'produto:mak-costela': 'img/oficial/mak/mak-costela.webp',
        'produto:mak-monster': 'img/oficial/mak/mak-monster.webp',
        'produto:batata-trionda': 'img/oficial/mak/batata-trionda.webp' } },
  },
};
