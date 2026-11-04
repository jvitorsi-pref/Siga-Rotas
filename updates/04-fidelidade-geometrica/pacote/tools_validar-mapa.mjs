/**
 * tools/validar-mapa.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL da fidelidade geométrica (rodada 4).
 *
 * Abre a aplicação real (OpenLayers) no navegador headless, calcula duas
 * rotas e grava as capturas de tela em `updates/04-fidelidade-geometrica/imagens/`:
 *
 *   1. a "rotatória" — o caso em que a rota antiga cortava o canteiro da praça;
 *   2. a "Avenida Valentim" — a área da imagem reportada pelo usuário.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-mapa.mjs [url]
 * ---------------------------------------------------------------------------
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/04-fidelidade-geometrica/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

/** Casos de teste: [origem, destino, arquivo, [lon, lat, zoom] do detalhe]. */
const CASOS = [
  {
    nome: 'rotatoria',
    origem: '-46.49958422, -23.64624582',
    destino: '-46.52738150, -23.67234326',
    zoom: [-46.527389, -23.672280, 19],
  },
  {
    nome: 'avenida-valentim',
    origem: '-46.498706, -23.677631',
    destino: '-46.494853, -23.689875',
    zoom: [-46.4948, -23.6895, 17],
  },
];

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pagina.on('pageerror', (e) => console.log('[erro js]', e.message));

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

for (const caso of CASOS) {
  await pagina.fill('#origin', caso.origem);
  await pagina.fill('#destination', caso.destino);
  await pagina.click('#calc');
  await pagina.waitForFunction(
    () => {
      const t = document.querySelector('#distance-value')?.textContent || '';
      return t && t !== '—' && !(document.querySelector('#status')?.textContent || '').includes('Calculando');
    },
    { timeout: 60000 },
  );
  await pagina.waitForTimeout(2500);

  const resumo = await pagina.evaluate(() => ({
    distancia: `${document.querySelector('#distance-value')?.textContent} ${document.querySelector('#distance-unit')?.textContent}`,
    status: document.querySelector('#status')?.textContent,
    stats: document.querySelector('#stats')?.innerText?.replace(/\n/g, ' | '),
  }));
  console.log(`\n[${caso.nome}] ${JSON.stringify(resumo)}`);

  await pagina.screenshot({ path: `${saida}/app-${caso.nome}.png` });
  await pagina.evaluate(([lon, lat, z]) => {
    window.__app.map.getView().setCenter(ol.proj.fromLonLat([lon, lat]));
    window.__app.map.getView().setZoom(z);
  }, caso.zoom);
  await pagina.waitForTimeout(2500);
  await pagina.screenshot({ path: `${saida}/app-${caso.nome}-zoom.png` });
  console.log(`  capturas: app-${caso.nome}.png e app-${caso.nome}-zoom.png`);
}

await navegador.close();
console.log('\nValidação visual concluída.');
