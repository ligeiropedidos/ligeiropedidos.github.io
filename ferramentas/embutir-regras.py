# -*- coding: utf-8 -*-
"""
Copia js/regras.js para dentro do ferramentas/worker-mercadopago.js, entre as marcas REGRAS DO PEDIDO.

O mensageiro refaz a conta de cada pedido com as MESMAS regras do site e do painel antes de cobrar (um pedido gravado
direto no banco com total de R$ 1 e R$ 200 em itens nao passa). O Cloudflare nao deixa o worker importar arquivo de fora,
entao a copia fica dentro dele. Rode sempre que mudar js/regras.js, antes de colar o worker:

    python ferramentas/embutir-regras.py

O teste testes/worker.test.mjs falha se a copia estiver diferente do js/regras.js.
"""
import io
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
WORKER = os.path.join(AQUI, 'worker-mercadopago.js')
REGRAS = os.path.join(RAIZ, 'js', 'regras.js')
INICIO = '/* ===== REGRAS DO PEDIDO: copia de js/regras.js (gerada por ferramentas/embutir-regras.py; nao editar aqui) ===== */'
FIM = '/* ===== FIM DAS REGRAS DO PEDIDO ===== */'


def bloco(regras):
    return (INICIO + '\n'
            + 'const REGRAS = (function () {\n'
            + '  const module = { exports: {} };\n'
            + regras.rstrip() + '\n'
            + '  return module.exports;\n'
            + '})();\n'
            + FIM)


def main():
    w = io.open(WORKER, encoding='utf-8').read()
    r = io.open(REGRAS, encoding='utf-8').read()
    novo = bloco(r)
    if INICIO in w:
        a = w.index(INICIO)
        b = w.index(FIM) + len(FIM)
        w = w[:a] + novo + w[b:]
    else:
        marca = 'export default {'
        i = w.index(marca)
        w = w[:i] + novo + '\n\n' + w[i:]
    io.open(WORKER, 'w', encoding='utf-8', newline='\n').write(w)
    print('regras embutidas no worker (' + str(len(r)) + ' caracteres)')


if __name__ == '__main__':
    main()
