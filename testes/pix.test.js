'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Pix = require('../js/pix.js');

/* Segunda implementacao do CRC, por tabela, para conferir a primeira. */
function crcPorTabela(texto) {
  const tabela = [];
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    tabela[i] = c;
  }
  let crc = 0xFFFF;
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc = ((crc << 8) & 0xFFFF) ^ tabela[((crc >> 8) ^ byte) & 0xFF];
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

test('CRC16 bate com a implementacao por tabela e com o exemplo do Banco Central', () => {
  const exemplo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(Pix.crc16(exemplo), crcPorTabela(exemplo));
  assert.equal(Pix.crc16(exemplo), '1D3D');
  for (const s of ['', 'a', '123456789', 'Ligeiro pedido ligeiro', 'çãõ acento']) {
    assert.equal(Pix.crc16(s), crcPorTabela(s));
  }
  assert.equal(Pix.crc16('123456789'), '29B1');
});

test('gera o copia e cola com valor, nome, cidade e txid, e o proprio leitor confere', () => {
  const codigo = Pix.gerar({ chave: 'domconizza@exemplo.com', nome: 'Dom Conizza Pizzaria', cidade: 'Juquiá', valor: 3250, txid: 'LIG42abc' });
  assert.match(codigo, /^000201/);
  assert.match(codigo, /5204000053039865/);
  assert.match(codigo, /540532\.50/);
  const lido = Pix.ler(codigo);
  assert.equal(lido.crcOk, true);
  assert.equal(lido.chave, 'domconizza@exemplo.com');
  assert.equal(lido.valor, 3250);
  assert.equal(lido.nome, 'DOM CONIZZA PIZZARIA');
  assert.equal(lido.cidade, 'JUQUIA');
  assert.equal(lido.txid, 'LIG42abc');
});

test('nome e cidade sao cortados no limite e sem acento', () => {
  const codigo = Pix.gerar({ chave: '11122233344', nome: 'Aparecida de Souza Restaurante e Marmitaria', cidade: 'São José dos Campos', valor: 100, txid: 'X' });
  const lido = Pix.ler(codigo);
  assert.equal(lido.nome.length <= 25, true);
  assert.equal(lido.cidade.length <= 15, true);
  assert.equal(lido.cidade, 'SAO JOSE DOS CA');
  assert.equal(lido.crcOk, true);
});

test('chave e normalizada: telefone com +55, e-mail minusculo, CPF so numeros', () => {
  assert.equal(Pix.normalizarChave('(13) 99999-0002'), '+5513999990002');
  assert.equal(Pix.normalizarChave('+55 13 99999-0002'), '+5513999990002');
  assert.equal(Pix.normalizarChave('Lu.Sorvetes@Exemplo.com'), 'lu.sorvetes@exemplo.com');
  assert.equal(Pix.normalizarChave('111.222.333-44'), '11122233344');
  assert.equal(Pix.normalizarChave('12.345.678/0001-90'), '12345678000190');
  assert.equal(Pix.normalizarChave('123e4567-e12b-12d1-a456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
  assert.equal(Pix.tipoDaChave('+5513999990002'), 'telefone');
  assert.equal(Pix.tipoDaChave('11122233344'), 'CPF');
  assert.equal(Pix.tipoDaChave('lu@x.com'), 'e-mail');
});

test('sem chave nao gera; valor zero sai sem o campo 54', () => {
  assert.throws(() => Pix.gerar({ chave: '', nome: 'X', cidade: 'Y', valor: 100 }), /chave Pix/);
  const codigo = Pix.gerar({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 0 });
  assert.equal(Pix.ler(codigo).valor, 0);
  assert.equal(codigo.indexOf('5403') < 0 && codigo.indexOf('5405') < 0, true);
});

test('descricao entra so quando cabe no campo 26', () => {
  const curta = Pix.gerar({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 100, descricao: 'Pedido 42' });
  assert.equal(Pix.ler(curta).descricao, 'PEDIDO 42');
  const chaveLonga = '123e4567-e12b-12d1-a456-426655440000';
  const longa = Pix.gerar({ chave: chaveLonga, nome: 'X', cidade: 'Y', valor: 100, descricao: 'Uma descricao bem comprida mesmo para estourar' });
  assert.equal(Pix.ler(longa).crcOk, true);
});
