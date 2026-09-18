# Gera os icones do app (PNG) so com a biblioteca padrao do Python.
# Fundo verde escuro, um "L" verde limao. Roda: python ferramentas/gerar-icones.py
import struct, zlib, os

FUNDO = (15, 61, 46)
LIMAO = (132, 204, 22)

def png(largura, altura, pixels):
    linhas = b''.join(b'\x00' + bytes(v for px in linha for v in px) for linha in pixels)
    def bloco(tipo, dados):
        return struct.pack('>I', len(dados)) + tipo + dados + struct.pack('>I', zlib.crc32(tipo + dados) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', largura, altura, 8, 2, 0, 0, 0))
            + bloco(b'IDAT', zlib.compress(linhas, 9)) + bloco(b'IEND', b''))

def icone(tam):
    r = tam * 0.22
    px = []
    for y in range(tam):
        linha = []
        for x in range(tam):
            # cantos arredondados
            dx = max(r - x, x - (tam - 1 - r), 0)
            dy = max(r - y, y - (tam - 1 - r), 0)
            if dx * dx + dy * dy > r * r:
                linha.append((250, 253, 246))
                continue
            # "L": haste vertical e pe
            haste = tam * 0.30 <= x < tam * 0.46 and tam * 0.22 <= y < tam * 0.78
            pe = tam * 0.30 <= x < tam * 0.72 and tam * 0.64 <= y < tam * 0.78
            linha.append(LIMAO if (haste or pe) else FUNDO)
        px.append(linha)
    return png(tam, tam, px)

pasta = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
for tam in (192, 512):
    with open(os.path.join(pasta, f'icone-{tam}.png'), 'wb') as f:
        f.write(icone(tam))
    print('ok icone-%d.png' % tam)
