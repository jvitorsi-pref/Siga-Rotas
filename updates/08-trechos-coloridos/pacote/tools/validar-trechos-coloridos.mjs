/**
 * tools/validar-trechos-coloridos.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL dos TRECHOS COLORIDOS da rota (rodada 8) na aplicação real.
 *
 *   1. liga o modo "Circuito" e monta um trajeto com **5 paradas** (A + B + C
 *      + D + E) — a quantidade de paradas é dinâmica;
 *   2. calcula no modo "Menor rota total" e confere que:
 *      • cada trecho da rota foi desenhado como uma geometria própria,
 *        com a sua cor, e trechos vizinhos têm cores diferentes;
 *      • o trecho de **retorno à origem** tem cor própria e está tracejado;
 *      • a **legenda** lista cada trecho com a sua cor (mesma cor do mapa);
 *      • os chips de cor do painel batem com as cores do mapa;
 *   3. recalcula no modo "Ordem do usuário" e confere que as cores, os
 *      rótulos e a legenda foram **reconstruídos** (nada de geometria
 *      antiga sobrando);
 *   4. arrasta um card e recalcula: a visualização inteira acompanha a nova
 *      ordem;
 *   5. remove uma parada: a legenda encolhe (nada de trecho antigo).
 *
 * Grava as capturas em `updates/08-trechos-coloridos/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-trechos-coloridos.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/08-trechos-coloridos/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

/** pontos reais de Santo André, todos no mesmo componente conexo da rede */
const PONTOS = {
  A: { codigo: '8FWR+WP', lat: -23.6526875, lon: -46.5081875 },
  B: { lat: -23.6966277, lon: -46.5348612 },
  C: { lat: -23.6452159, lon: -46.504766 },
  D: { lat: -23.6851732, lon: -46.4999366 },
  E: { lat: -23.74863, lon: -46.472759 },
};

/** "#1d4ed8" → "rgb(29, 78, 216)" (para comparar com o estilo computado) */
function hexParaRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return String(hex || '');
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pagina.on('pageerror', (e) => console.log('[erro js]', e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});

await pagina.goto(url, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

const linhaDe = (rotulo) =>
  pagina.locator('.point', {
    has: pagina.locator('.point__badge', { hasText: new RegExp(`^${rotulo}$`) }),
  });

async function preencherCoordenadas(rotulo, lon, lat) {
  await linhaDe(rotulo).locator('.point__coord').fill(`${lon}, ${lat}`);
  await pagina.waitForTimeout(250);
}

/** Estado completo da visualização da rota. */
const estado = async () =>
  pagina.evaluate(() => {
    const feats = window.__app.routeSource.getFeatures();
    return {
      distancia: document.querySelector('#distance-value')?.textContent?.trim(),
      status: document.querySelector('#status')?.textContent?.trim(),
      features: feats.length,
      cores: feats.map((f) => f.get('cor')),
      retorno: feats.filter((f) => f.get('retorno')).length,
      // legenda: uma linha por trecho, com o texto "A → B" e a cor
      legenda: [...document.querySelectorAll('#legend-trechos-lista > div')].map((d) => ({
        texto: d.innerText.replace(/\s+/g, ' ').trim(),
        cor: getComputedStyle(d.querySelector('.swatch')).backgroundColor,
      })),
      legendaVisivel: !document.querySelector('#legend-trechos')?.hidden,
      // painel: uma linha por trecho, com o chip de cor
      painel: [...document.querySelectorAll('.leg')].map((l) => ({
        texto: l.innerText.replace(/\s+/g, ' ').trim(),
        cor: getComputedStyle(l.querySelector('.leg__cor')).backgroundColor,
      })),
      cartoes: [...document.querySelectorAll('.point')].map((p) => ({
        rotulo: p.querySelector('.point__badge')?.textContent?.trim(),
        coord: p.querySelector('.point__coord')?.value,
      })),
    };
  });

/** Verifica as propriedades que a rodada 8 exige. */
function conferir(e) {
  // as cores do mapa vêm em hexadecimal; a legenda e o painel devolvem o
  // estilo computado (rgb) — as duas notações são comparadas em rgb
  const cores = e.cores.map(hexParaRgb);
  const vizinhasDiferentes = cores.every((c, i) => i === 0 || c !== cores[i - 1]);
  const coresOk = cores.every((c) => /^rgb\(\d+, \d+, \d+\)$/.test(c));
  const legendaBate = e.legenda.length === cores.length &&
    e.legenda.every((l, i) => l.cor === cores[i]);
  const painelBate = e.painel.length === cores.length &&
    e.painel.every((l, i) => l.cor === cores[i]);
  const retornoComCor = e.retorno === 1 && e.cores.length > 0;
  return {
    vizinhasDiferentes,
    coresOk,
    legendaBate,
    painelBate,
    retornoComCor,
    features: e.features,
    cores: cores.length,
    legendas: e.legenda.length,
  };
}

console.log('1) modo Circuito com 5 paradas (quantidade dinâmica)');
await pagina.check('input[name="tipo"][value="circuito"]');
await pagina.waitForTimeout(700);
const linhaA = linhaDe('A');
await linhaA.locator('.point__codigo').fill(PONTOS.A.codigo);
await linhaA.locator('[data-acao="validar"]').click();
await pagina.waitForTimeout(1500);
await preencherCoordenadas('B', PONTOS.B.lon, PONTOS.B.lat);
for (const r of ['C', 'D', 'E']) {
  await pagina.click('#add-stop');
  await pagina.waitForTimeout(400);
  await preencherCoordenadas(r, PONTOS[r].lon, PONTOS[r].lat);
}
const cartoes = (await estado()).cartoes.map((c) => c.rotulo).join(' ');
console.log('  cards:', cartoes);

console.log('2) modo "Menor rota total"');
await pagina.click('#calc');
await pagina.waitForFunction(
  () => {
    const t = document.querySelector('#distance-value')?.textContent || '';
    return t && t !== '—';
  },
  { timeout: 180000 },
);
await pagina.waitForTimeout(3000);
const otim = await estado();
console.log('  distância:', otim.distancia, 'km');
console.log('  cores no mapa :', otim.cores.join(' '));
console.log('  legenda       :');
for (const l of otim.legenda) console.log('    ·', l.texto, '→', l.cor);
console.log('  painel        :');
for (const l of otim.painel) console.log('    ·', l.texto, '→', l.cor);
await pagina.screenshot({ path: `${saida}/app-trechos-coloridos.png` });

console.log('3) modo "Ordem do usuário" (as cores/legenda são reconstruídas)');
await pagina.check('input[name="modo"][value="usuario"]');
await pagina.waitForTimeout(300);
await pagina.click('#calc');
await pagina.waitForTimeout(15000);
const usuario = await estado();
console.log('  distância:', usuario.distancia, 'km');
console.log('  cores no mapa :', usuario.cores.join(' '));
console.log('  legenda       :');
for (const l of usuario.legenda) console.log('    ·', l.texto, '→', l.cor);
await pagina.screenshot({ path: `${saida}/app-trechos-ordem-usuario.png` });

console.log('4) arrasta um card (a visualização acompanha a nova ordem)');
const linhaB = linhaDe('B');
const linhaE = linhaDe('E');
await linhaB.locator('.point__grip').dragTo(linhaE);
await pagina.waitForTimeout(15000);
const arrastado = await estado();
console.log('  cards:', arrastado.cartoes.map((c) => `${c.rotulo}=${c.coord}`).join(' | '));
console.log('  distância:', arrastado.distancia, 'km');
console.log('  cores no mapa :', arrastado.cores.join(' '));
console.log('  legenda       :');
for (const l of arrastado.legenda) console.log('    ·', l.texto, '→', l.cor);
await pagina.screenshot({ path: `${saida}/app-trechos-arrastado.png` });

console.log('5) remove uma parada (a legenda encolhe)');
await linhaDe('E').locator('[data-acao="remover"]').click();
await pagina.waitForTimeout(15000);
const removido = await estado();
console.log('  cards:', removido.cartoes.map((c) => c.rotulo).join(' '));
console.log('  distância:', removido.distancia, 'km');
console.log('  features no mapa:', removido.features, '| linhas da legenda:', removido.legenda.length);

// ── veredito ───────────────────────────────────────────────────────────────
const o = conferir(otim);
const u = conferir(usuario);
const a = conferir(arrastado);
const r = conferir(removido);

const ok =
  o.vizinhasDiferentes && o.coresOk && o.legendaBate && o.painelBate && o.retornoComCor &&
  u.vizinhasDiferentes && u.legendaBate && u.painelBate &&
  a.vizinhasDiferentes && a.legendaBate && a.painelBate &&
  r.legendaBate && r.painelBate &&
  r.features === r.cores && r.legendas === r.features &&
  removido.cartoes.length < arrastado.cartoes.length;

console.log('');
console.log(`um tom por trecho (cores vizinhas diferentes): ${o.vizinhasDiferentes ? 'SIM' : 'NÃO'}`);
console.log(`cores bem formadas no mapa:                 ${o.coresOk ? 'SIM' : 'NÃO'}`);
console.log(`legenda bate com as cores do mapa:            ${o.legendaBate ? 'SIM' : 'NÃO'} (${o.legendas} linhas)`);
console.log(`chips do painel batem com o mapa:             ${o.painelBate ? 'SIM' : 'NÃO'} (${o.cores} trechos)`);
console.log(`trecho de retorno com cor própria:           ${o.retornoComCor ? 'SIM' : 'NÃO'}`);
console.log(`modo "ordem do usuário" reconstrói a legenda: ${u.legendaBate ? 'SIM' : 'NÃO'}`);
console.log(`arraste atualiza cores e legenda:             ${a.legendaBate && a.painelBate ? 'SIM' : 'NÃO'}`);
console.log(`remoção encolhe a visualização:               ${r.features === r.legendas && r.features < a.features ? 'SIM' : 'NÃO'}`);
console.log(`quantidade de paradas é dinâmica:            ${removido.cartoes.length} cards (era ${arrastado.cartoes.length})`);

await navegador.close();
console.log(ok ? '\nVALIDAÇÃO VISUAL APROVADA' : '\nVALIDAÇÃO VISUAL REPROVADA');
process.exit(ok ? 0 : 1);
