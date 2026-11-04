/**
 * tools/validar-otimizacao.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL da OTIMIZAÇÃO e do ARRASTE dos pontos no mapa.
 *
 * Abre a aplicação real (OpenLayers) no Chromium headless do Playwright:
 *   1. monta um trajeto A → B → C → D (origem, 2 paradas, destino);
 *   2. calcula no modo "Menor rota" (otimizada) e confere a sequência
 *      percorrida e a economia sobre a ordem informada;
 *   3. calcula no modo "Ordem do usuário" e confere que a sequência
 *      informada é respeitada;
 *   4. ARRASTA um ponto no mapa e confere que a rota é recalculada.
 *
 * Grava as capturas em `updates/06-otimizacao-e-arrastar/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-otimizacao.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/06-otimizacao-e-arrastar/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pagina.on('pageerror', (e) => console.log('[erro js]', e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

/** Preenche e valida o Endereço Digital de um ponto pelo rótulo. */
async function validarPorCodigo(rotulo, codigo) {
  const linha = pagina.locator('.point', {
    has: pagina.locator('.point__badge', { hasText: new RegExp(`^${rotulo}$`) }),
  });
  await linha.locator('.point__codigo').fill(codigo);
  await linha.locator('[data-acao="validar"]').click();
  await pagina.waitForTimeout(1200);
  const estado = (await linha.locator('.point__estado').innerText()).trim();
  console.log(`  ${rotulo}: "${codigo}" → ${estado}`);
  return estado;
}

/** Preenche as coordenadas (lon, lat) de um ponto pelo rótulo. */
async function preencherCoordenadas(rotulo, lon, lat) {
  const linha = pagina.locator('.point', {
    has: pagina.locator('.point__badge', { hasText: new RegExp(`^${rotulo}$`) }),
  });
  await linha.locator('.point__coord').fill(`${lon}, ${lat}`);
  await pagina.waitForTimeout(300);
}

const estado = async () =>
  pagina.evaluate(() => ({
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
    unidade: document.querySelector('#distance-unit')?.textContent?.trim(),
    status: document.querySelector('#status')?.textContent?.trim(),
    stats: document.querySelector('#stats')?.innerText?.split('\n').filter(Boolean),
    sequencia: document.querySelector('#legs')?.innerText?.split('\n').filter(Boolean),
  }));

// Pontos reais, todos dentro do mesmo componente conexo da rede de Santo
// André (verificado com a API): sem isso a rota não existe e o erro seria
// "sem caminho" — não é um defeito do cálculo, é da cobertura da camada.
console.log('1) monta o trajeto A → B → C → D');
await validarPorCodigo('A', '8FWR+WP');
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('B', -46.53486123001242, -23.6966276995482);
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('C', -46.504765997199364, -23.645215919445203);
await preencherCoordenadas('D', -46.4999365600099, -23.685173179548343);

console.log('2) modo padrão (menor rota / otimizada)');
const modoPadrao = await pagina.evaluate(
  () => document.querySelector('input[name="modo"]:checked')?.value,
);
console.log('  modo marcado no painel:', modoPadrao);

await pagina.click('#calc');
await pagina.waitForFunction(
  () => {
    const t = document.querySelector('#distance-value')?.textContent || '';
    return t && t !== '—';
  },
  { timeout: 120000 },
);
await pagina.waitForTimeout(2500);
const otim = await estado();
console.log('  distância:', otim.distancia, otim.unidade);
console.log('  estatísticas:');
for (const l of otim.stats || []) console.log('    ·', l);
await pagina.screenshot({ path: `${saida}/app-otimizada.png` });

console.log('3) modo "ordem do usuário"');
await pagina.check('input[name="modo"][value="usuario"]');
await pagina.waitForTimeout(300);
await pagina.click('#calc');
await pagina.waitForTimeout(6000);
const usuario = await estado();
console.log('  distância:', usuario.distancia, usuario.unidade);
for (const l of usuario.stats || []) console.log('    ·', l);
await pagina.screenshot({ path: `${saida}/app-usuario.png` });

console.log('4) arrasta o ponto B no mapa');
// centraliza a visão no marcador B para que ele fique livre do painel
const pixelAntes = await pagina.evaluate(() => {
  const feats = window.__app.markerSource.getFeatures();
  const b = feats.find((f) => f.get('rotulo') === 'B');
  if (!b) return null;
  const c = b.getGeometry().getCoordinates();
  window.__app.map.getView().setCenter(c);
  window.__app.map.getView().setZoom(16);
  return null;
});
await pagina.waitForTimeout(1800);

const info = await pagina.evaluate(() => {
  const feats = window.__app.markerSource.getFeatures();
  const b = feats.find((f) => f.get('rotulo') === 'B');
  const c = b.getGeometry().getCoordinates();
  const p = window.__app.map.getPixelFromCoordinate(c);
  // posição NA TELA (o pixel do mapa é relativo ao container do mapa)
  const rect = window.__app.map.getTargetElement().getBoundingClientRect();
  return {
    x: rect.left + p[0],
    y: rect.top + p[1],
    lon: ol.proj.toLonLat(c)[0],
    lat: ol.proj.toLonLat(c)[1],
  };
});
console.log('  marcador B na tela:', Math.round(info.x), Math.round(info.y));

const distanciaAntes = await pagina.evaluate(
  () => document.querySelector('#distance-value')?.textContent?.trim(),
);

await pagina.mouse.move(info.x, info.y);
await pagina.mouse.down();
await pagina.mouse.move(info.x + 90, info.y + 70, { steps: 25 });
await pagina.mouse.up();
await pagina.waitForTimeout(6000);

const depois = await pagina.evaluate(() => {
  const feats = window.__app.markerSource.getFeatures();
  const b = feats.find((f) => f.get('rotulo') === 'B');
  const c = b.getGeometry().getCoordinates();
  return {
    lon: ol.proj.toLonLat(c)[0],
    lat: ol.proj.toLonLat(c)[1],
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
    status: document.querySelector('#status')?.textContent?.trim(),
    stats: document.querySelector('#stats')?.innerText?.split('\n').filter(Boolean),
  };
});
console.log('  B antes :', info.lon.toFixed(6), info.lat.toFixed(6));
console.log('  B depois:', depois.lon.toFixed(6), depois.lat.toFixed(6));
console.log('  distância antes:', distanciaAntes, '→ depois:', depois.distancia);
console.log('  status:', depois.status);
for (const l of depois.stats || []) console.log('    ·', l);
await pagina.screenshot({ path: `${saida}/app-arrastar.png` });

console.log('5) arrasta a ORDEM dos pontos no painel lateral');
// No modo "ordem do usuário" a rota segue exatamente a lista do painel.
await pagina.check('input[name="modo"][value="usuario"]');
await pagina.waitForTimeout(300);
await pagina.click('#calc');
await pagina.waitForTimeout(5000);

const antesArrastar = await pagina.evaluate(() => {
  const linhas = [...document.querySelectorAll('.point')];
  const coord = (rotulo) => {
    const l = linhas.find((x) => x.querySelector('.point__badge')?.textContent.trim() === rotulo);
    return l?.querySelector('.point__coord')?.value;
  };
  return {
    B: coord('B'),
    C: coord('C'),
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
  };
});
console.log('  antes  → B:', antesArrastar.B, '| C:', antesArrastar.C, '| distância:', antesArrastar.distancia);

const linhaB = pagina.locator('.point', {
  has: pagina.locator('.point__badge', { hasText: /^B$/ }),
});
const linhaC = pagina.locator('.point', {
  has: pagina.locator('.point__badge', { hasText: /^C$/ }),
});
// captura o estado de arraste (a linha alvo é realçada) antes de soltar
await pagina.evaluate(() => {
  const linhas = [...document.querySelectorAll('.point')];
  const dt = new DataTransfer();
  linhas[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  linhas[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await pagina.waitForTimeout(600);
await pagina.screenshot({ path: `${saida}/app-ordem-indicador.png` });

await linhaB.dragTo(linhaC);
await pagina.waitForTimeout(6000);

const depoisArrastar = await pagina.evaluate(() => {
  const linhas = [...document.querySelectorAll('.point')];
  const coord = (rotulo) => {
    const l = linhas.find((x) => x.querySelector('.point__badge')?.textContent.trim() === rotulo);
    return l?.querySelector('.point__coord')?.value;
  };
  return {
    B: coord('B'),
    C: coord('C'),
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
    status: document.querySelector('#status')?.textContent?.trim(),
  };
});
console.log('  depois → B:', depoisArrastar.B, '| C:', depoisArrastar.C, '| distância:', depoisArrastar.distancia);
console.log('  status:', depoisArrastar.status);
await pagina.screenshot({ path: `${saida}/app-ordem-arrastada.png` });

// ── veredito ───────────────────────────────────────────────────────────────
const num = (t) => Number(String(t).replace(/[^\d,.-]/g, '').replace(',', '.'));
const mudou = Math.abs(num(depois.distancia) - num(distanciaAntes)) > 0.001;
const moveu = Math.abs(depois.lon - info.lon) > 1e-6 || Math.abs(depois.lat - info.lat) > 1e-6;

console.log('');
console.log(`arraste no mapa: o marcador mudou de lugar? ${moveu ? 'SIM' : 'NÃO'}`);
console.log(`arraste no mapa: a rota foi recalculada?     ${mudou ? 'SIM' : 'NÃO'}`);

// arraste da ordem no painel
const ordemTrocou =
  depoisArrastar.B === antesArrastar.C && depoisArrastar.C === antesArrastar.B;
const ordemRecalculou =
  Math.abs(num(depoisArrastar.distancia) - num(antesArrastar.distancia)) > 0.001;
console.log(`arraste no painel: a ordem foi trocada?    ${ordemTrocou ? 'SIM' : 'NÃO'}`);
console.log(
  `arraste no painel: a rota foi recalculada?    ${ordemRecalculou ? 'SIM' : 'NÃO'} ` +
    `(${antesArrastar.distancia} → ${depoisArrastar.distancia})`,
);
console.log(
  `modos: otimizada ${otim.distancia} ${otim.unidade} | usuário ${usuario.distancia} ${usuario.unidade}`,
);

await navegador.close();

const ok = moveu && mudou && ordemTrocou && ordemRecalculou;
console.log(ok ? '\nVALIDAÇÃO VISUAL APROVADA' : '\nVALIDAÇÃO VISUAL REPROVADA');
process.exit(ok ? 0 : 1);
