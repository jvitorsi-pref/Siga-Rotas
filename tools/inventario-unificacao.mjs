/** Inventário reproduzível da auditoria estática; não substitui testes de UI. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preferredBaseline = '449746b985e23ba2517df55ae67d98751c4e168c';
let baseline = preferredBaseline;
try {
  execFileSync('git', ['cat-file', '-e', `${preferredBaseline}^{commit}`], { cwd: root, stdio: 'ignore' });
} catch {
  baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
const hash = (s) => createHash('sha256').update(s).digest('hex');
function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const p = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(p) : [p];
  });
}
const files = ['core', 'ocorrencias', 'server', 'public', 'APK/src', 'test', 'APK/test', 'tools'].flatMap(walk)
  .filter((p) => /\.(js|mjs|html|css|webmanifest)$/.test(p) && !p.startsWith('public/vendor/'));
files.push('APK/App.js', 'APK/metro.config.js', 'APK/app.json', 'APK/eas.json', 'APK/package.json', 'package.json', 'APK/android/app/src/main/AndroidManifest.xml');
const rows = files.sort().map((file) => {
  const content = readFileSync(path.join(root, file));
  let before;
  try { before = execFileSync('git', ['show', `${baseline}:${file}`], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}); } catch { /* novo */ }
  const state = !before ? 'Novo' : content.equals(before) ? 'Igual à base' : 'Alterado';
  const text = content.toString();
  const exports = [...text.matchAll(/^export\s+(?:(?:async\s+)?(?:function|class|const)\s+(\w+)|\*\s+from\s+['"]([^'"]+))/gm)].map((m) => m[1] || `→ ${m[2]}`);
  return `| \`${file}\` | ${text.split('\n').length} | ${state} | ${exports.join(', ') || '—'} |`;
});
// Hashes aprovados exclusivamente para a camada de serviço HTTP/persistência (o núcleo `core/` permanece inalterado).
const approvedChanges = {
  'server/index.js': 'c36934696684df9116ae1dfa460ba0816748c6ad5c6a666366397746fbddc111',
  'server/networkService.js': 'c82e6d1af9a71f38d2382277cf5408370d24a088659b5f3e087dbd2fb5306728',
  'server/ocorrenciasService.js': '0cd123e4e20c1c1c7aa957af8ffe882fca0f41dd3a8624c5375ef62ae1d4cd90',
};
const protectedFiles = ['core', 'server'].flatMap(walk).filter((p) => p.endsWith('.js'));
const differs = (p) => {
  try { return !readFileSync(path.join(root, p)).equals(execFileSync('git', ['show', `${baseline}:${p}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { return true; }
};
const changed = protectedFiles.filter(differs);
const unapproved = changed.filter(p => hash(readFileSync(path.join(root, p))) !== approvedChanges[p]);

const evidence = protectedFiles.map((p) => `${hash(readFileSync(path.join(root, p)))}  ${p}`).join('\n');
const output = `# Inventário técnico — unificação\n\nGerado por \`node tools/inventario-unificacao.mjs\`. Base: \`${baseline}\`.\n\nInventário mecânico de arquivos próprios ativos, testes e ferramentas; não afirma validação visual nem execução Android. Vendor OpenLayers, snapshots e arquivos Android gerados são dependências/recursos, não incluídos na tabela de exports. Pacotes em \`updates/\` são históricos e não entram no grafo de imports ativo.\n\n## Proteção do motor\n\n${protectedFiles.length} arquivos de core/server comparados à base; alterados: ${changed.length ? changed.join(', ') : '**nenhum**'}. Mudanças fora dos hashes aprovados: ${unapproved.length ? unapproved.join(', ') : '**nenhuma**'}.\n\n## Arquivos\n\n| Arquivo | Linhas | Situação | Exports / reexports |\n|---|---:|---|---|\n${rows.join('\n')}\n\n## SHA-256 do núcleo e servidor\n\n\`\`\`text\n${evidence}\n\`\`\`\n`;
writeFileSync(path.join(root, 'docs/INVENTARIO-UNIFICACAO.md'), output);
console.log(`${files.length} arquivos inventariados; ${protectedFiles.length} protegidos; ${changed.length} alterações; ${unapproved.length} alterações fora dos hashes aprovados.`);
if (unapproved.length) process.exitCode = 1;
