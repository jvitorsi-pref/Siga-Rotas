/**
 * tools/validar-saida-curta.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL do modo "MENOR ROTA TOTAL (SAÍDA CURTA)" e da convivência
 * dos três modos de ordem de visita.
 *
 * Abre a aplicação real (OpenLayers) no Chromium headless do Playwright e
 * monta o **caso do print** (A→D 673 m · D→C 214 m · C→B 291 m · B→A 542 m),
 * em circuito fechado:
 *
 *   1. modo "Menor rota total"          → A→D→C→B→A (1,72 km)
 *   2. modo "Menor rota total (saída curta)" → A→B→C→D→A, **mesmo total**
 *   3. modo "Ordem do usuário"           → A→B→C→D (nada reordenado)
 *   4. a legenda mostra as 4 pernas, cada uma com a sua cor
 *
 * Grava as capturas em `updates/14-auditoria-ordem-paradas/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 * npx playwright install chromium
 *
 * Uso:  node tools/validar-saida-curta.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/14-auditoria-ordem-paradas/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

// caso real medido na rede (o mesmo do print do usuário)
const PONTOS = {
  A: [-46.49536480000956, -23.654198499548553],
  B: [-46.49391065097863, -23.650668369845917],
  C: [-46.49405717000947, -23.649230239548583],
  D: [-46.4930041000094, -23.650059399548574],
};

let falhas = 0;
function conferir(condicao, descricao, detalhe) {
  const marca = condicao ? 'OK  ' : 'FALHA';
  if (!condicao) falhas++;
  console.log(`  [${marca}] ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const erros = [];
pagina.on('pageerror', (e) => erros.push(e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

async function preencherCoordenadas(rotulo, lon, lat) {
  const linha = pagina.locator('.point', {
    has: pagina.locator('.point__badge', { hasText: new RegExp(`^${rotulo}$`) }),
  });
  await linha.locator('.point__coord').fill(`${lon}, ${lat}`);
  await pagina.waitForTimeout(250);
}

const estado = async () =>
  pagina.evaluate(() => ({
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
    unidade: document.querySelector('#distance-unit')?.textContent?.trim(),
    status: document.querySelector('#status')?.textContent?.trim(),
    nota: document.querySelector('#route-note')?.innerText?.trim(),
    sequenciaCompleta: window.__app?.state?.rotaAtual?.sequenciaCompleta || null,
    legs: window.__app?.state?.rotaAtual?.legs || [],
    distanciaMeters: window.__app?.state?.rotaAtual?.distance ?? null,
    otimizacao: window.__app?.state?.rotaAtual?.otimizacao || null,
  }));

async function calcularNoModo(modo) {
  await pagina.check(`input[name="modo"][value="${modo}"]`);
  await pagina.waitForTimeout(300);
  await pagina.click('#calc');
  await pagina.waitForFunction(
    () => {
      const t = document.querySelector('#distance-value')?.textContent || '';
      return t && t !== '—';
    },
    { timeout: 120000 },
  );
  await pagina.waitForTimeout(1200);
  return estado();
}

console.log('1) monta o circuito do caso do print (A, B, C, D)');
await pagina.check('input[name="tipo"][value="circuito"]');
await pagina.waitForTimeout(700);
// no modo circuito não há card de DESTINO: o card que sobrou (B) é uma
// parada e basta acrescentar mais duas (C e D)
await preencherCoordenadas('A', ...PONTOS.A);
await preencherCoordenadas('B', ...PONTOS.B);
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('C', ...PONTOS.C);
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('D', ...PONTOS.D);

console.log('2) modo "Menor rota total" (otimizada)');
const otimizada = await calcularNoModo('otimizada');
console.log(`  distância: ${otimizada.distancia} ${otimizada.unidade}`);
console.log(`  nota: ${otimizada.nota}`);
console.log(`  sequência: ${(otimizada.sequenciaCompleta || []).join(' → ')}`);
conferir(
  (otimizada.sequenciaCompleta || []).join('→') === 'A→D→C→B→A',
  'a sequência é A→D→C→B→A (a do print)',
  (otimizada.sequenciaCompleta || []).join('→'),
);
conferir(otimizada.otimizacao?.metodo === 'exato', 'método exato (Held-Karp)', otimizada.otimizacao?.metodo);
console.log(`  total exato: ${otimizada.distanciaMeters} m`);

console.log('3) modo "Menor rota total (saída curta)"');
const saidaCurta = await calcularNoModo('saida_curta');
console.log(`  distância: ${saidaCurta.distancia} ${saidaCurta.unidade}`);
console.log(`  nota: ${saidaCurta.nota}`);
console.log(`  sequência: ${(saidaCurta.sequenciaCompleta || []).join(' → ')}`);
conferir(
  (saidaCurta.sequenciaCompleta || []).join('→') === 'A→B→C→D→A',
  'a sequência é A→B→C→D→A (primeira perna mais curta)',
  (saidaCurta.sequenciaCompleta || []).join('→'),
);
conferir(
  Math.abs(saidaCurta.distanciaMeters - otimizada.distanciaMeters) < 1e-6,
  'o total é IDÊNTICO ao da rota ótima (o objetivo não mudou)',
  `${saidaCurta.distanciaMeters} m × ${otimizada.distanciaMeters} m`,
);
conferir(
  String(saidaCurta.nota || '').includes('saída curta'),
  'a nota da tela informa o desempate',
  saidaCurta.nota,
);
conferir(
  (saidaCurta.legs || []).length === 4,
  'o circuito tem 4 pernas (incluindo o retorno à origem)',
  `${(saidaCurta.legs || []).length}`,
);
const cores = (saidaCurta.legs || []).map((l) => l.cor);
conferir(
  new Set(cores).size === cores.length,
  'cada perna tem uma cor própria',
  cores.join(', '),
);
await pagina.screenshot({ path: `${saida}/app-saida-curta.png` });
const painel = pagina.locator('#painel-lateral, aside, .panel').first();
if (await painel.count()) {
  await painel.screenshot({ path: `${saida}/painel-saida-curta.png` }).catch(() => {});
} else {
  await pagina.screenshot({ path: `${saida}/painel-saida-curta.png` });
}

console.log('4) modo "Ordem do usuário"');
const usuario = await calcularNoModo('usuario');
console.log(`  distância: ${usuario.distancia} ${usuario.unidade}`);
console.log(`  nota: ${usuario.nota}`);
console.log(`  sequência: ${(usuario.sequenciaCompleta || []).join(' → ')}`);
conferir(
  (usuario.sequenciaCompleta || []).join('→') === 'A→B→C→D→A',
  'a sequência informada é respeitada (nada reordenado)',
  (usuario.sequenciaCompleta || []).join('→'),
);

console.log('5) erros de console');
conferir(erros.length === 0, 'nenhum erro de JavaScript', erros.slice(0, 3).join(' | '));

await navegador.close();
console.log('');
if (falhas === 0) {
  console.log('VALIDAÇÃO VISUAL APROVADA');
  process.exit(0);
}
console.log(`VALIDAÇÃO VISUAL REPROVADA — ${falhas} verificação(ões) falharam`);
process.exit(1);
