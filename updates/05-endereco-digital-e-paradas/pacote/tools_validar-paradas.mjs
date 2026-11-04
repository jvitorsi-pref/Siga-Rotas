/**
 * tools/validar-paradas.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL da rota com múltiplas paradas e do Endereço Digital.
 *
 * Abre a aplicação real (OpenLayers) no Chromium headless do Playwright:
 *   1. digita um Endereço Digital (CEP Digital) no ponto A e valida;
 *   2. adiciona uma parada intermediária e valida o código dela;
 *   3. preenche o destino por coordenadas;
 *   4. calcula a rota A → B → C e confere o resultado no painel.
 *
 * Grava as capturas em `updates/05-endereco-digital-e-paradas/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-paradas.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/05-endereco-digital-e-paradas/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pagina.on('pageerror', (e) => console.log('[erro js]', e.message));
pagina.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

const linhas = () => pagina.locator('.point');

/** Preenche e valida o Endereço Digital de um ponto pelo rótulo. */
async function validarPorCodigo(rotulo, codigo) {
  const linha = pagina.locator('.point', { has: pagina.locator('.point__badge', { hasText: new RegExp(`^${rotulo}$`) }) });
  await linha.locator('.point__codigo').fill(codigo);
  await linha.locator('[data-acao="validar"]').click();
  await pagina.waitForTimeout(1200);
  const estado = await linha.locator('.point__estado').innerText();
  const coord = await linha.locator('.point__coord').inputValue();
  console.log(`  ${rotulo}: "${codigo}" → ${estado.trim()} | ${coord}`);
  return { estado: estado.trim(), coord };
}

console.log('1) Endereço Digital no ponto A');
const a = await validarPorCodigo('A', '8FP9+J6');

console.log('2) adiciona a parada intermediária B');
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
const b = await validarPorCodigo('B', '8FQV+9X');

console.log('3) destino por coordenadas');
const linhaDestino = pagina.locator('.point--destino');
await linhaDestino.locator('.point__coord').fill('-46.494853, -23.689875');
await pagina.waitForTimeout(400);

console.log('4) calcula a rota');
await pagina.click('#calc');
await pagina.waitForFunction(
  () => {
    const t = document.querySelector('#distance-value')?.textContent || '';
    return t && t !== '—';
  },
  { timeout: 90000 },
);
await pagina.waitForTimeout(2500);

const resumo = await pagina.evaluate(() => ({
  distancia: `${document.querySelector('#distance-value')?.textContent} ${document.querySelector('#distance-unit')?.textContent}`,
  status: document.querySelector('#status')?.textContent,
  stats: document.querySelector('#stats')?.innerText?.replace(/\n/g, ' | '),
  trechos: document.querySelector('#legs')?.innerText?.split('\n').filter(Boolean),
  marcadores: window.__app.markerSource.getFeatures().map((f) => f.get('rotulo')),
  verticesRota: window.__app.routeSource.getFeatures()[0]?.getGeometry()?.getCoordinates()?.length,
}));
console.log(JSON.stringify(resumo, null, 1));

await pagina.screenshot({ path: `${saida}/app-paradas.png` });

// detalhe: zoom na praça da primeira parada
await pagina.evaluate(() => {
  const feats = window.__app.markerSource.getFeatures();
  const f = feats[1];
  if (!f) return;
  const c = f.getGeometry().getCoordinates();
  window.__app.map.getView().setCenter(c);
  window.__app.map.getView().setZoom(17);
});
await pagina.waitForTimeout(2000);
await pagina.screenshot({ path: `${saida}/app-paradas-zoom.png` });

await navegador.close();
console.log('\nValidação visual concluída.');
