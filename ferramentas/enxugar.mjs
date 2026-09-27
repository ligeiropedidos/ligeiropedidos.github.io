// Gera a copia enxuta do site (sem comentarios nem espacos) em js/m/ e css/m/: e o que o site publicado baixa.
// Os arquivos de trabalho continuam em js/ e css/ (e deles que se edita); js/m e css/m sao so a saida, refeita a cada
// publicacao. Ficam dentro de js/ e css/ porque essas pastas passam direto pela Cloudflare (nao gastam o limite do worker).
// Uso: node ferramentas/enxugar.mjs            (gera js/m, css/m e js/m/fontes.json)
//      node ferramentas/enxugar.mjs --conferir (so confere se a copia esta em dia com js/ e css/; sai com erro se nao)
// O esbuild vem do Hypit ja instalado no PC (nada novo para baixar); outro caminho: variavel ESBUILD.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESBUILD = process.env.ESBUILD || 'C:/Users/Mateus/AppData/Roaming/npm/node_modules/@hypit/hypit/node_modules/esbuild/bin/esbuild';
const conferir = process.argv.includes('--conferir');
/* js/cliente.js -> js/m/cliente.js; css/temas/conizza.css -> css/m/temas/conizza.css */
const destinoDe = (a) => path.join(RAIZ, a.replace(/^(js|css)\//, '$1/m/'));
const LISTA = path.join(RAIZ, 'js/m/fontes.json');

/* o que vira copia enxuta: todo js do site e todo css */
function listar() {
  const js = fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);
  const css = ['css/ligeiro.css'].concat(fs.readdirSync(path.join(RAIZ, 'css/temas')).filter((f) => f.endsWith('.css')).map((f) => 'css/temas/' + f));
  return js.concat(css).sort();
}
const hash = (arq) => crypto.createHash('sha1').update(fs.readFileSync(path.join(RAIZ, arq))).digest('hex').slice(0, 16);
const arquivos = listar();

if (conferir) {
  let lista = {};
  try { lista = JSON.parse(fs.readFileSync(LISTA, 'utf8')); } catch (_) { /* sem lista: tudo velho */ }
  const velhos = arquivos.filter((a) => lista[a] !== hash(a) || !fs.existsSync(destinoDe(a)));
  const sobrando = Object.keys(lista).filter((a) => !arquivos.includes(a));
  if (velhos.length || sobrando.length) {
    console.log('copia enxuta velha: ' + velhos.concat(sobrando).join(', ') + '. Rode: node ferramentas/enxugar.mjs');
    process.exit(1);
  }
  console.log('copia enxuta em dia (' + arquivos.length + ' arquivos)');
  process.exit(0);
}

fs.rmSync(path.join(RAIZ, 'js/m'), { recursive: true, force: true });
fs.rmSync(path.join(RAIZ, 'css/m'), { recursive: true, force: true });
const lista = {};
let antes = 0, depois = 0;
for (const a of arquivos) {
  const destino = destinoDe(a);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const args = [ESBUILD, path.join(RAIZ, a), '--minify', '--charset=utf8', '--legal-comments=none', '--log-level=error', '--outfile=' + destino];
  if (a.endsWith('.js')) args.push('--target=es5');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  /* o CSS enxuto mora uma pasta mais fundo (css/m/temas): endereco relativo dentro dele (fontes, imagens) apontaria para
     uma pasta que nao existe. Vira endereco a partir da raiz do site, calculado de onde o arquivo de trabalho esta */
  if (a.endsWith('.css')) {
    const css = fs.readFileSync(destino, 'utf8').replace(/url\((['"]?)([^'")]+)\1\)/g, (tudo, aspas, u) => {
      if (/^(data:|https?:|\/|#)/i.test(u)) return tudo;
      return 'url(' + aspas + '/' + path.posix.normalize(path.posix.join(path.posix.dirname(a), u)) + aspas + ')';
    });
    fs.writeFileSync(destino, css);
  }
  lista[a] = hash(a);
  antes += fs.statSync(path.join(RAIZ, a)).size; depois += fs.statSync(destino).size;
}
fs.writeFileSync(LISTA, JSON.stringify(lista, null, 1) + '\n');
for (const d of ['js/m', 'css/m']) fs.writeFileSync(path.join(RAIZ, d, 'LEIA-ME.txt'), 'Copia enxuta gerada por ferramentas/enxugar.mjs. Nao edite aqui: edite js/ e css/ e rode a ferramenta de novo.\n');
console.log('copia enxuta gerada: ' + arquivos.length + ' arquivos, ' + Math.round(antes / 1024) + ' KB -> ' + Math.round(depois / 1024) + ' KB (antes de comprimir)');
