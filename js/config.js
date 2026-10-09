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
  /* Capacidade do banco gratis (Spark: 50 mil leituras por dia), medida no codigo em 07/10/2026 depois da otimizacao: um
     pedido no Pix com painel, cozinha e entregador abertos gasta ~24 leituras (eram ~32; so com o painel, ~14), e cada loja
     ~80 por dia so de telas abertas. A Central mostra quantos pedidos cabem hoje com as lojas que existem (~1.800 com 11).
     maxLojas 40: cabe com folga (40 lojas de 30 pedidos/dia) no Firebase e na Cloudflare gratis, mesmo antes das regras
     novas. Vale para quem ainda nao gravou um limite: depois, e o "Mudar limite" da Central. Com o Blaze e o Workers Paid,
     sobe ou fica sem limite */
  capacidade: { maxLojas: 40, leiturasDia: 50000, leiturasPorPedido: 24, leiturasPorLoja: 80 },
  /* Um plano so, tudo incluso (centavos): 1 loja por conta, mensal ou anual. Outra loja = outra conta (outro e-mail), com a
     propria assinatura (decidido em 25/09/2026: trocar entre 1, 2 e 3 lojas era o que mais dava dor de cabeca com dinheiro).
     anual: 0 esconde o anual */
  planos: [
    { id: 'uma', nome: 'Ligeiro', lojas: 1, mensal: 8900, anual: 89000, fundador: { mensal: 6990, anual: 69900 }, frase: 'Tudo incluso para a sua loja' }, /* fundador R$ 69,90 desde 09/10/2026 (era R$ 79) */
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
    metaPixel: '1802219744433800' },

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

  /* Horario em que a equipe responde no WhatsApp (hora de Brasilia, todos os dias): no cartao "Quer a sua loja pronta?" aparece
     "Atendendo agora" com a bolinha verde piscando dentro dele e "Respondemos a partir das <inicio>h" fora (09/10/2026) */
  atendimento: { inicio: 7, fim: 19 }, /* das 7h as 19h (09/10/2026, dito por ele) */

  /* Clientes do Ligeiro na pagina de vendas (09/10/2026): as lojas modelo, uma de cada vez no celular da secao, com o print do
     topo da loja (390 x 620, em 2x). soNaVitrine: so entra quando a loja esta na vitrine publica (amostra nao: quem abrisse veria
     a faixa AMOSTRA). Os termos de uso dizem que a loja pode aparecer como exemplo (e sair quando pedir) */
  clientesModelo: [
    { caminho: 'juquia/dom-conizza', nome: 'Dom Conizza', ramo: 'Pizzaria', logo: 'img/oficial/dom-conizza-logo.webp', tela: 'img/loja-ligeiro/exclusivo.webp' },
    { caminho: 'juquia/jaci-lanches', nome: 'Jaci Lanches', ramo: 'Lanchonete', logo: 'img/oficial/jaci-lanches-logo.webp', tela: 'img/loja-ligeiro/jaci.webp', escura: true, soNaVitrine: true },
  ],

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
    'mak-burguer': { oficial: false, tema: 'makburguer', logo: 'img/oficial/mak-burguer-logo.webp', frase: 'Acendendo a chapa', fogo: true, enfeites: ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], corFundo: '#0C0907',
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
    /* cliente com design exclusivo (06/10/2026): casa japonesa, preto sumi e o vermelho do pincel da logo (o enso com a carpa).
       As fotos sao as da propria Kazoku (as grandes, 600x600, do cardapio deles no Anota AI); o item sem foto propria usa a da
       mesma peca na porcao maior, e os dois molhos uma molheira desenhada (clientes/kazoku-sushi/montar.mjs) */
    'kazoku-sushi': { oficial: false, tema: 'kazoku', logo: 'img/oficial/kazoku-sushi-logo.webp', frase: 'Afiando as facas', fogo: true, enfeites: ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], corFundo: '#0B0A0C',
      desenhos: {
        'produto:hot-roll-tradicional': 'img/oficial/kazoku/hot-roll-tradicional.webp',
        'produto:hot-roll-couve-crispy': 'img/oficial/kazoku/hot-roll-couve-crispy.webp',
        'produto:hot-roll-banana-com-doce-de-leite': 'img/oficial/kazoku/hot-roll-banana-com-doce-de-leite.webp',
        'produto:hot-roll-doritos': 'img/oficial/kazoku/hot-roll-doritos.webp',
        'produto:hot-roll-camarao': 'img/oficial/kazoku/hot-roll-camarao.webp',
        'produto:big-hot-roll': 'img/oficial/kazoku/big-hot-roll.webp',
        'produto:hot-roll-nutella': 'img/oficial/kazoku/hot-roll-nutella.webp',
        'produto:uramaki-filadelfia': 'img/oficial/kazoku/uramaki-filadelfia.webp',
        'produto:uramaki-grelhado': 'img/oficial/kazoku/uramaki-grelhado.webp',
        'produto:uramaki-camarao': 'img/oficial/kazoku/uramaki-camarao.webp',
        'produto:uramaki-lemon-camarao': 'img/oficial/kazoku/uramaki-lemon-camarao.webp',
        'produto:uramaki-crispy': 'img/oficial/kazoku/uramaki-crispy.webp',
        'produto:uramaki-california': 'img/oficial/kazoku/uramaki-california.webp',
        'produto:uramaki-lemon-salmao': 'img/oficial/kazoku/uramaki-lemon-salmao.webp',
        'produto:ura-bacon': 'img/oficial/kazoku/ura-bacon.webp',
        'produto:hossomaki-salmao': 'img/oficial/kazoku/hossomaki-salmao.webp',
        'produto:hossomaki-kani': 'img/oficial/kazoku/hossomaki-kani.webp',
        'produto:hossomaki-pepino': 'img/oficial/kazoku/hossomaki-pepino.webp',
        'produto:djo-tradicional': 'img/oficial/kazoku/djo-tradicional.webp',
        'produto:djo-selado': 'img/oficial/kazoku/djo-selado.webp',
        'produto:djo-chico': 'img/oficial/kazoku/djo-chico.webp',
        'produto:djo-doritos': 'img/oficial/kazoku/djo-doritos.webp',
        'produto:djo-camarao': 'img/oficial/kazoku/djo-camarao.webp',
        'produto:djo-sweet': 'img/oficial/kazoku/djo-sweet.webp',
        'produto:niguiri-salmao': 'img/oficial/kazoku/niguiri-salmao.webp',
        'produto:niguiri-peixe-branco': 'img/oficial/kazoku/niguiri-peixe-branco.webp',
        'produto:niguiri-salmao-selado': 'img/oficial/kazoku/niguiri-salmao-selado.webp',
        'produto:temaki-filadelfia': 'img/oficial/kazoku/temaki-filadelfia.webp',
        'produto:temaki-grelhado': 'img/oficial/kazoku/temaki-grelhado.webp',
        'produto:temaki-camarao': 'img/oficial/kazoku/temaki-camarao.webp',
        'produto:hot-temaki': 'img/oficial/kazoku/hot-temaki.webp',
        'produto:temaki-crispy': 'img/oficial/kazoku/temaki-crispy.webp',
        'produto:temaki-spicy': 'img/oficial/kazoku/temaki-filadelfia.webp',
        'produto:temaki-mexicano': 'img/oficial/kazoku/temaki-mexicano.webp',
        'produto:temaki-california': 'img/oficial/kazoku/temaki-california.webp',
        'produto:hot-temaki-camarao': 'img/oficial/kazoku/hot-temaki-camarao.webp',
        'produto:poke-filadelfia': 'img/oficial/kazoku/poke-filadelfia.webp',
        'produto:poke-camarao': 'img/oficial/kazoku/poke-camarao.webp',
        'produto:sashimi-salmao': 'img/oficial/kazoku/sashimi-salmao.webp',
        'produto:sashimi-peixe-branco': 'img/oficial/kazoku/sashimi-peixe-branco.webp',
        'produto:sashimi-salmao-selado': 'img/oficial/kazoku/sashimi-salmao-selado.webp',
        'produto:carpaccio-de-salmao': 'img/oficial/kazoku/carpaccio-de-salmao.webp',
        'produto:carpaccio-de-peixe-branco': 'img/oficial/kazoku/carpaccio-de-peixe-branco.webp',
        'produto:salmao-especial': 'img/oficial/kazoku/carpaccio-de-salmao.webp',
        'produto:carpaccio-misto': 'img/oficial/kazoku/carpaccio-de-salmao.webp',
        'produto:ceviche-de-salmao': 'img/oficial/kazoku/ceviche-de-salmao.webp',
        'produto:ceviche-especial': 'img/oficial/kazoku/ceviche-especial.webp',
        'produto:combo-hot-tradicional-4-pc': 'img/oficial/kazoku/hot-roll-tradicional.webp',
        'produto:combo-hot-couve-4-pc': 'img/oficial/kazoku/hot-roll-couve-crispy.webp',
        'produto:combo-hot-doritos-4-pc': 'img/oficial/kazoku/hot-roll-doritos.webp',
        'produto:combo-hot-camarao-4-pc': 'img/oficial/kazoku/hot-roll-camarao.webp',
        'produto:combo-hot-doce-de-leite-4-pc': 'img/oficial/kazoku/hot-roll-banana-com-doce-de-leite.webp',
        'produto:combo-hot-nutella-4-pc': 'img/oficial/kazoku/hot-roll-nutella.webp',
        'produto:combo-ura-filadelfia-4-pc': 'img/oficial/kazoku/uramaki-filadelfia.webp',
        'produto:combo-ura-grelhado-4-pc': 'img/oficial/kazoku/uramaki-grelhado.webp',
        'produto:combo-ura-crispy-4-pc': 'img/oficial/kazoku/uramaki-crispy.webp',
        'produto:combo-ura-camarao-4-pc': 'img/oficial/kazoku/uramaki-camarao.webp',
        'produto:combo-ura-lemon-salmao-4-pc': 'img/oficial/kazoku/uramaki-lemon-salmao.webp',
        'produto:combo-ura-lemon-camarao-4-pc': 'img/oficial/kazoku/uramaki-lemon-camarao.webp',
        'produto:combo-ura-california-4-pc': 'img/oficial/kazoku/uramaki-california.webp',
        'produto:combo-djo-tradicional-4-pc': 'img/oficial/kazoku/djo-tradicional.webp',
        'produto:combo-djo-selado-4-pc': 'img/oficial/kazoku/djo-selado.webp',
        'produto:combo-djo-chico-cesar-4-pc': 'img/oficial/kazoku/djo-chico.webp',
        'produto:combo-djo-doritos-4-pc': 'img/oficial/kazoku/djo-doritos.webp',
        'produto:combo-djo-camarao-4-pc': 'img/oficial/kazoku/djo-camarao.webp',
        'produto:combo-djo-sweet-4-pc': 'img/oficial/kazoku/djo-sweet.webp',
        'produto:combo-hosso-salmao-4-pc': 'img/oficial/kazoku/hossomaki-salmao.webp',
        'produto:combo-hosso-pepino-4-pc': 'img/oficial/kazoku/hossomaki-pepino.webp',
        'produto:combo-hosso-kani-4-pc': 'img/oficial/kazoku/hossomaki-kani.webp',
        'produto:combo-niguiri-salmao-3-pc': 'img/oficial/kazoku/niguiri-salmao.webp',
        'produto:combo-niguiri-tilapia-3-pc': 'img/oficial/kazoku/niguiri-peixe-branco.webp',
        'produto:combo-niguiri-salmao-selado-4-pc': 'img/oficial/kazoku/niguiri-salmao-selado.webp',
        'produto:combo-sashimi-de-salmao-5-pc': 'img/oficial/kazoku/sashimi-salmao.webp',
        'produto:combo-sashimi-de-tilapia-5-pc': 'img/oficial/kazoku/sashimi-peixe-branco.webp',
        'produto:combo-sashimi-de-salmao-selado-5-pc': 'img/oficial/kazoku/sashimi-salmao-selado.webp',
        'produto:combinado-ichi': 'img/oficial/kazoku/combinado-ichi.webp',
        'produto:combinado-ni': 'img/oficial/kazoku/combinado-ni.webp',
        'produto:combinado-hot-roll': 'img/oficial/kazoku/combinado-hot-roll.webp',
        'produto:combinado-grelhado-1': 'img/oficial/kazoku/combinado-grelhado-1.webp',
        'produto:combinado-grelhado-2': 'img/oficial/kazoku/combinado-grelhado-2.webp',
        'produto:combinado-individual-filadelfia': 'img/oficial/kazoku/combinado-individual-filadelfia.webp',
        'produto:combinado-individual-grelhado': 'img/oficial/kazoku/combinado-individual-grelhado.webp',
        'produto:combinado-individual-especial': 'img/oficial/kazoku/combinado-individual-especial.webp',
        'produto:ebi': 'img/oficial/kazoku/uramaki-camarao.webp',
        'produto:monte-seu-poke': 'img/oficial/kazoku/poke-filadelfia.webp',
        'produto:porcao-de-tilapia': 'img/oficial/kazoku/porcao-de-tilapia.webp',
        'produto:porcao-de-salmao': 'img/oficial/kazoku/porcao-de-salmao.webp',
        'produto:porcao-de-frango': 'img/oficial/kazoku/porcao-de-frango.webp',
        'produto:porcao-de-camarao': 'img/oficial/kazoku/porcao-de-camarao.webp',
        'produto:porcao-de-batata-simples': 'img/oficial/kazoku/porcao-de-batata-simples.webp',
        'produto:porcao-de-batata-com-cheddar-e-bacon': 'img/oficial/kazoku/porcao-de-batata-com-cheddar-e-bacon.webp',
        'produto:1-2-tilapia': 'img/oficial/kazoku/porcao-de-tilapia.webp',
        'produto:1-2-frango': 'img/oficial/kazoku/porcao-de-frango.webp',
        'produto:1-2-camarao': 'img/oficial/kazoku/porcao-de-camarao.webp',
        'produto:croquete-de-salmao': 'img/oficial/kazoku/croquete-de-salmao.webp',
        'produto:1-2-salmao': 'img/oficial/kazoku/porcao-de-salmao.webp',
        'produto:yakissoba-misto': 'img/oficial/kazoku/yakissoba-misto.webp',
        'produto:yakissoba-especial': 'img/oficial/kazoku/yakissoba-especial.webp',
        'produto:yakissoba-de-carne': 'img/oficial/kazoku/yakissoba-de-carne.webp',
        'produto:yakissoba-de-legumes': 'img/oficial/kazoku/yakissoba-de-legumes.webp',
        'produto:guioza-suino': 'img/oficial/kazoku/guioza-suino.webp',
        'produto:guioza-bovino': 'img/oficial/kazoku/guioza-bovino.webp',
        'produto:guioza-de-legumes': 'img/oficial/kazoku/guioza-de-legumes.webp',
        'produto:yakissoba-de-frango': 'img/oficial/kazoku/yakissoba-misto.webp',
        'produto:combo-esquenta': 'img/oficial/kazoku/combo-esquenta.webp',
        'produto:original-lata': 'img/oficial/kazoku/original-lata.webp',
        'produto:cervejas-long-neck': 'img/oficial/kazoku/cervejas-long-neck.webp',
        'produto:taca-de-vinho-seco': 'img/oficial/kazoku/taca-de-vinho-seco.webp',
        'produto:taca-de-vinho-suave': 'img/oficial/kazoku/taca-de-vinho-suave.webp',
        'produto:caipirinha-de-vodka': 'img/oficial/kazoku/caipirinha-de-vodka.webp',
        'produto:caipirinha-de-saque': 'img/oficial/kazoku/caipirinha-de-saque.webp',
        'produto:caipirinha-de-pinga': 'img/oficial/kazoku/caipirinha-de-pinga.webp',
        'produto:agua-500ml': 'img/oficial/kazoku/agua-500ml.webp',
        'produto:agua-com-gas-500ml': 'img/oficial/kazoku/agua-com-gas-500ml.webp',
        'produto:refrigerante-lata': 'img/oficial/kazoku/refrigerante-lata.webp',
        'produto:refrigerante-600ml': 'img/oficial/kazoku/refrigerante-600ml.webp',
        'produto:energetico-monster': 'img/oficial/kazoku/energetico-monster.webp',
        'produto:energetico-red-bull': 'img/oficial/kazoku/energetico-red-bull.webp',
        'produto:soda-italiana': 'img/oficial/kazoku/soda-italiana.webp',
        'produto:suco-de-polpa-com-agua': 'img/oficial/kazoku/suco-de-polpa-com-agua.webp',
        'produto:suco-de-polpa-com-leite': 'img/oficial/kazoku/suco-de-polpa-com-leite.webp',
        'produto:suco-natural': 'img/oficial/kazoku/suco-natural.webp',
        'produto:jarra-de-suco-1-litro': 'img/oficial/kazoku/suco-de-polpa-com-agua.webp',
        'produto:heineken-0-alcool': 'img/oficial/kazoku/heineken-0-alcool.webp',
        'produto:h2oh-limoneto': 'img/oficial/kazoku/h2oh-limoneto.webp',
        'produto:hot-tradicional-yaki-misto': 'img/oficial/kazoku/hot-tradicional-yaki-misto.webp',
        'produto:kit-kat': 'img/oficial/kazoku/kit-kat.webp',
        'produto:trident': 'img/oficial/kazoku/trident.webp',
        'produto:molho-tare': 'img/oficial/kazoku/molho.svg',
        'produto:geleia-de-pimenta': 'img/oficial/kazoku/molho.svg' } },
    /* cliente com design exclusivo (09/10/2026): a lanchonete da Dona Jaci a noite, com cor de hamburguer (chapa, pao tostado e
       queijo) e o rosa e o roxo da logo de detalhe: neon rosa na logo, raios de placa, estampa de lanches andando e gergelim caindo. Fotos de banco de imagem (Pexels,
       as mesmas da amostra do Mak, img/oficial/mak/CREDITOS.txt) ate chegarem as dela; logo recortada em clientes/jaci-lanches */
    'jaci-lanches': { oficial: false, tema: 'jaci', logo: 'img/oficial/jaci-lanches-logo.webp', frase: 'Caprichando no lanche', fogo: true, enfeites: ['', '', '', '', '', '', '', '', '', ''], corFundo: '#1E100A',
      fontes: ['800 1em "Baloo 2"', '500 1em Oswald', '600 1em Oswald'],
      desenhos: {
        /* cardapio de exemplo da amostra (antes de colar o dela): fotos tambem, para a loja nunca aparecer com ilustracao */
        'produto:batata': 'img/oficial/mak/batata-trionda.webp', 'produto:batata-cheddar': 'img/oficial/mak/batata-trionda.webp', 'produto:refri-lata': 'img/oficial/mak/refri-lata.webp',
        'produto:x-burguer': 'img/oficial/mak/mak-burguer.webp',
        'produto:x-salada': 'img/oficial/mak/mak-salada.webp',
        'produto:x-tudo': 'img/oficial/mak/mak-monster.webp',
        'produto:x-calabresa': 'img/oficial/mak/mak-toscana.webp',
        'produto:x-calabacon': 'img/oficial/mak/mak-chilli.webp',
        'produto:x-costela': 'img/oficial/mak/mak-costela.webp',
        'produto:x-bacon': 'img/oficial/mak/mak-bacon.webp',
        'produto:x-egg': 'img/oficial/mak/mak-egg.webp',
        'produto:x-bomba': 'img/oficial/mak/mak-duplo.webp',
        'produto:batata-frita': 'img/oficial/mak/batata-trionda.webp',
        'produto:batata-cheddar-bacon': 'img/oficial/mak/batata-trionda.webp',
        'produto:suco': 'img/oficial/mak/suco.webp',
        'produto:suco-de-fruta': 'img/oficial/mak/suco.webp',
        'produto:refrigerante-2l': 'img/oficial/mak/refri-lata.webp' } },
  },
};
