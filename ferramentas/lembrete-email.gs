/*
 * Ligeiro - envio dos lembretes por e-mail (Google Apps Script, gratis, ate 100 e-mails por dia).
 *
 * Os e-mails saem da conta do Google em que este script estiver (use a ligeiro.pedidos@gmail.com).
 * Quem chama e o mensageiro do Asaas (ferramentas/worker-asaas.js), uma vez por dia, com a senha combinada.
 *
 * Como ligar (10 minutos, uma vez so):
 *   1. Entre em script.google.com com a conta do Ligeiro > Novo projeto. Apague o que tiver e cole este arquivo inteiro.
 *      De o nome "Ligeiro e-mails" ao projeto (la em cima).
 *   2. Engrenagem (Configuracoes do projeto) > Propriedades do script > Adicionar propriedade:
 *        Propriedade: TOKEN    Valor: uma senha que voce inventa, com 32 letras e numeros ou mais.
 *      Guarde: a mesma senha vai no Cloudflare como EMAIL_TOKEN.
 *   3. Volte ao Editor, escolha a funcao "testar" la em cima e clique em Executar. O Google pede permissao para
 *      "enviar e-mail como voce": e o proprio script da sua conta, pode permitir. Chega um e-mail de teste na caixa.
 *   4. Implantar > Nova implantacao > engrenagem > App da Web:
 *        Executar como: Eu     Quem pode acessar: Qualquer pessoa
 *      Implantar e copie o "URL do app da Web" (termina em /exec). Ele vai no Cloudflare como EMAIL_URL.
 *   Mudou este arquivo depois? Implantar > Gerenciar implantacoes > lapis > Versao: Nova versao > Implantar (o URL fica o mesmo).
 */

function doPost(e) {
  function saida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
  try {
    var c = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    /* sem a senha certa, nada sai (ninguem usa este endereco para mandar e-mail em nome do Ligeiro) */
    if (!token || token.length < 32 || c.token !== token) return saida({ ok: false, erro: 'token' });
    var para = String(c.para || '').trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(para)) return saida({ ok: false, erro: 'para' });
    if (MailApp.getRemainingDailyQuota() < 1) return saida({ ok: false, erro: 'cota do dia acabou' });
    MailApp.sendEmail({
      to: para,
      subject: String(c.assunto || 'Ligeiro').slice(0, 150),
      body: String(c.texto || '').slice(0, 5000),
      htmlBody: String(c.html || '').slice(0, 20000),
      name: 'Ligeiro',
    });
    return saida({ ok: true, restam: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return saida({ ok: false, erro: String(err).slice(0, 200) });
  }
}

/* para o passo 3: manda um e-mail de teste para a propria conta (e faz o Google pedir a permissao uma vez) */
function testar() {
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Ligeiro: teste do lembrete por e-mail',
    body: 'Se este e-mail chegou, o envio de lembretes do Ligeiro esta funcionando. Restam ' + MailApp.getRemainingDailyQuota() + ' envios hoje.',
    name: 'Ligeiro',
  });
}
