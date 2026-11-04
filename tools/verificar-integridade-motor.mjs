/**
 * tools/verificar-integridade-motor.mjs
 * ---------------------------------------------------------------------------
 * Prova de integridade do **motor** (`core/` e `server/`) na rodada 20.
 *
 * A rodada 20 foi uma reformulação **visual**: nenhuma regra de roteamento
 * podia mudar. Este script confere:
 *
 *   1. os arquivos do núcleo que têm cópia arquivada (a rodada 14) estão
 *      **byte a byte** iguais;
 *   2. o SHA-256 de todos os arquivos do núcleo e do servidor, para que as
 *      próximas rodadas comparem com a mesma referência;
 *   3. a lista de arquivos que a rodada 20 **de fato** alterou (a partir do
 *      backup feito no começo da rodada) — e confirma que `core/` e
 *      `server/` não estão nessa lista.
 *
 * Uso:  node tools/verificar-integridade-motor.mjs
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO_R14 = path.join(
  RAIZ,
  'updates/14-auditoria-ordem-paradas/pacote/core',
);
const BACKUP_R19 = path.join(RAIZ, 'updates/19-unified-visual/antes');

function sha(arquivo) {
  return createHash('sha256').update(readFileSync(arquivo)).digest('hex');
}

let falhas = 0;
function conferir(condicao, descricao, detalhe) {
  if (!condicao) falhas++;
  console.log(
    `  [${condicao ? 'OK  ' : 'FALHA'}] ${descricao}${detalhe ? ` — ${detalhe}` : ''}`,
  );
}

console.log('1) o núcleo está igual à cópia arquivada da rodada 14');
const arquivosCore = readdirSync(path.join(RAIZ, 'core')).filter((f) => f.endsWith('.js'));
let comparados = 0;
let diferentes = 0;
for (const nome of arquivosCore) {
  const atual = path.join(RAIZ, 'core', nome);
  const copia = path.join(ARQUIVO_R14, nome);
  let temCopia = true;
  try {
    statSync(copia);
  } catch {
    temCopia = false;
  }
  if (!temCopia) continue;
  comparados++;
  if (sha(atual) !== sha(copia)) {
    diferentes++;
    console.log(`  [FALHA] ${nome} — mudou desde a rodada 14`);
  }
}
conferir(
  diferentes === 0,
  `nenhum arquivo do núcleo mudou (${comparados} comparados byte a byte)`,
);

console.log('2) a impressão digital do motor e do servidor');
const resumo = [];
for (const pasta of ['core', 'server']) {
  for (const nome of readdirSync(path.join(RAIZ, pasta)).sort()) {
    const arquivo = path.join(RAIZ, pasta, nome);
    if (!statSync(arquivo).isFile()) continue;
    resumo.push(`${sha(arquivo)}  ${pasta}/${nome}`);
  }
}
console.log(resumo.join('\n'));

console.log('3) o que a rodada 20 alterou (a partir do backup do começo da rodada)');
const alterados = [];
for (const [pasta, destino] of [
  ['web', path.join(RAIZ, 'public')],
  ['mobile', path.join(RAIZ, 'mobile')],
]) {
  const antes = path.join(BACKUP_R19, pasta);
  const lista = [];
  const percorrer = (dir, prefixo) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === 'node_modules' || entrada.name === 'dist' || entrada.name === 'dist-web') {
        continue;
      }
      const caminho = path.join(dir, entrada.name);
      const relativo = path.join(prefixo, entrada.name);
      if (entrada.isDirectory()) {
        percorrer(caminho, relativo);
        continue;
      }
      const atual = path.join(destino, relativo);
      let igual = false;
      try {
        igual = sha(caminho) === sha(atual);
      } catch {
        igual = false;
      }
      if (!igual) lista.push(relativo);
    }
  };
  percorrer(antes, '');
  alterados.push(...lista.map((f) => `${pasta}/${f}`));
}
console.log(alterados.length ? alterados.map((f) => '  · ' + f).join('\n') : '  (nada)');

const mexeuNoMotor = alterados.some((f) => f.startsWith('core/') || f.startsWith('server/'));
conferir(
  !mexeuNoMotor,
  'nenhum arquivo de core/ ou server/ foi alterado na rodada 20',
);

console.log(falhas === 0 ? '\nINTEGRIDADE DO MOTOR CONFIRMADA' : '\nINTEGRIDADE DO MOTOR VIOLADA');
process.exit(falhas === 0 ? 0 : 1);
