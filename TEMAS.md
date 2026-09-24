# Temas exclusivos: as regras

Loja que pede um visual próprio (como a Dom Conizza) ganha um tema em `css/temas/<nome>.css`.
O tema muda a cara da loja sem quebrar nenhuma peça do sistema. Para isso, estas regras valem sempre.

## 1. Tudo dentro da classe do tema

- Toda regra começa com `.tema-<nome>` (ou `body:has(.tema-<nome>)` para o fundo da página).
- O teste `node --test testes/temas.test.js` falha se aparecer regra fora do escopo.
- Motivo: o tema da Conizza tinha `.tema-conizza .abertura` (a capa da loja). O tutorial usava
  a mesma palavra e foi parar no rodapé. Hoje o tutorial usa `tour-abertura`, e o teste pega o próximo caso.

## 2. Primeiro as variáveis, depois as peças

- O caminho certo é trocar as variáveis: cor (`--lime`, `--deep`, `--ink`, `--card`...),
  letra (`--display`) e cantos (`--raio`). Toda peça do sistema já usa essas variáveis e acompanha sozinha.
- Estilo de peça (borda grossa, sombra de desenho) só nas peças com nome próprio, uma regra por peça.
- O tema **nunca** mexe em `position`, `top`, `bottom`, `inset` ou `z-index` das peças que ficam por cima da
  tela (tutorial `.tour*`, janelas `.modal*`, avisos, pausa). O teste também confere isso.

## 3. Toda peça nova tem nome com prefixo

- Nada de classe com palavra solta (`abertura`, `topo`, `cartao`, `lista`) para peça nova.
- Prefixos em uso: `tour-` (tutorial), `passos-` / `passo-` (primeiros passos), `mp-` (Mercado Pago nos Ajustes),
  `pix-` / `cartao-` (telas de pagamento), `forma-` (formas de pagamento), `garantias`, `faixa-`.
- Estado de peça é classe junto do prefixo (`tour-abertura`), não uma palavra que outro lugar já usa.

## 4. Antes de publicar um tema

1. `node --test testes/temas.test.js testes/regras.test.js testes/pix.test.js`
2. Abrir a loja do tema e uma loja comum, em 320, 375 e 390 px, e rodar `ferramentas/auditoria-visual.js`
   (`ligeiroAuditar()` em cada tela do pedido e `ligeiroBotoes()` no painel). Tudo tem que voltar `ok` / vazio.
3. Passar o tutorial do painel inteiro nas duas lojas: o lugar aceso sempre acima do balão.
