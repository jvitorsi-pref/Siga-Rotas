/**
 * tools/validar-circular.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL da ROTA CIRCULAR (A → B → C → D → A) na aplicação real.
 *
 *   1. liga o modo "Circuito" (o retorno à origem passa a ser automático);
 *   2. monta o trajeto A → B → C → D (A por Endereço Digital, o resto por
 *      coordenadas);
 *   3. calcula no modo "Menor rota" (TSP em ciclo) e confere que o
 *      circuito **termina em A**;
 *   4. calcula no modo "Ordem do usuário" e confere que a sequência dos
 *      cards é respeitada;
 *   5. arrasta um card e confere que a ordem usada no cálculo muda;
 *   6. confere que o "Inverter" fica indisponível no circuito (a origem é
 *      fixa) e que a legenda mostra o retorno à origem.
 *
 * Grava as capturas em `updates/07-rota-circular/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-circular.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/07-rota-circular/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

// pontos reais de Santo André, todos no mesmo componente conexo da rede
const PONTOS = {
  A: { codigo: '8FWR+WP', lat: -23.6526875, lon: -46.5081875 },
  B: { lat: -23.6966277, lon: -46.5348612 },
  C: { lat: -23.6452159, lon: -46.504766 },
  D: { lat: -23.6851732, lon: -46.4999366 },
};

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
  const linha = linhaDe(rotulo);
  await linha.locator('.point__coord').fill(`${lon}, ${lat}`);
  await pagina.waitForTimeout(250);
}

const estado = async () =>
  pagina.evaluate(() => ({
    distancia: document.querySelector('#distance-value')?.textContent?.trim(),
    unidade: document.querySelector('#distance-unit')?.textContent?.trim(),
    status: document.querySelector('#status')?.textContent?.trim(),
    stats: document.querySelector('#stats')?.innerText?.split('\n').filter(Boolean),
    trechos: [...document.querySelectorAll('.leg')].map((l) => l.innerText.replace(/\n/g, ' ')),
    featuresRota: window.__app.routeSource.getFeatures().length,
    retornoDesenhado: window.__app.routeSource
      .getFeatures()
      .filter((f) => f.get('retorno')).length,
    cartoes: [...document.querySelectorAll('.point')].map((p) => ({
      rotulo: p.querySelector('.point__badge')?.textContent?.trim(),
      papel: p.querySelector('.point__role')?.textContent?.trim(),
      coord: p.querySelector('.point__coord')?.value,
    })),
  }));

console.log('1) liga o modo Circuito');
await pagina.check('input[name="tipo"][value="circuito"]');
await pagina.waitForTimeout(700);
console.log('  inverter desabilitado:', await pagina.locator('#swap').isDisabled());
console.log(
  '  legenda do retorno visível:',
  await pagina.locator('#legend-return').isVisible(),
);
console.log('  cards:', JSON.stringify((await estado()).cartoes.map((c) => c.rotulo + ':' + c.papel)));

console.log('2) monta o trajeto A → B → C → D');
// ao ligar o circuito, a lista passa a ter origem + paradas (sem card de
// destino): sobram A e B; completamos B, C e D.
const linhaA = linhaDe('A');
await linhaA.locator('.point__codigo').fill(PONTOS.A.codigo);
await linhaA.locator('[data-acao="validar"]').click();
await pagina.waitForTimeout(1500);
console.log('  A:', (await linhaA.locator('.point__estado').innerText()).trim());

await preencherCoordenadas('B', PONTOS.B.lon, PONTOS.B.lat);
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('C', PONTOS.C.lon, PONTOS.C.lat);
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadas('D', PONTOS.D.lon, PONTOS.D.lat);
console.log('  cards:', (await estado()).cartoes.map((c) => c.rotulo).join(' '));

console.log('3) modo "Menor rota" (TSP em ciclo)');
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
console.log('  distância:', otim.distancia, otim.unidade);
for (const l of otim.stats || []) console.log('    ·', l);
console.log('  trechos:');
for (const l of otim.trechos) console.log('    ·', l);
console.log('  features no mapa:', otim.featuresRota, '| de retorno:', otim.retornoDesenhado);
await pagina.screenshot({ path: `${saida}/app-circuito-otimizado.png` });

console.log('4) modo "Ordem do usuário"');
await pagina.check('input[name="modo"][value="usuario"]');
await pagina.waitForTimeout(300);
await pagina.click('#calc');
await pagina.waitForTimeout(12000);
const usuario = await estado();
console.log('  distância:', usuario.distancia, usuario.unidade);
for (const l of usuario.stats || []) console.log('    ·', l);
console.log('  trechos:');
for (const l of usuario.trechos) console.log('    ·', l);
await pagina.screenshot({ path: `${saida}/app-circuito-usuario.png` });

console.log('5) arrasta o card B para depois do card D');
const antes = await estado();
const linhaB = linhaDe('B');
const linhaD = linhaDe('D');
await linhaB.locator('.point__grip').dragTo(linhaD);
await pagina.waitForTimeout(12000);
const depois = await estado();
console.log('  cards antes :', antes.cartoes.map((c) => `${c.rotulo}=${c.coord}`).join(' | '));
console.log('  cards depois:', depois.cartoes.map((c) => `${c.rotulo}=${c.coord}`).join(' | '));
console.log('  distância:', antes.distancia, '→', depois.distancia);
console.log('  trechos:');
for (const l of depois.trechos) console.log('    ·', l);
await pagina.screenshot({ path: `${saida}/app-circuito-arrastado.png` });

// ── veredito ───────────────────────────────────────────────────────────────
const num = (t) => Number(String(t).replace(/[^\d,.-]/g, '').replace(',', '.'));
// as estatísticas são pares (rótulo, valor) em linhas consecutivas
const terminaEmA = (e) => {
  const st = e.stats || [];
  for (let i = 0; i < st.length - 1; i++) {
    if (st[i].trim() === 'Sequência percorrida') return /→\s*A\s*$/.test(st[i + 1].trim());
  }
  return false;
};
const temRetorno = (e) => e.retornoDesenhado === 1 && e.trechos.some((t) => /retorno à origem/.test(t));

const ok =
  otim.retornoDesenhado === 1 &&
  usuario.retornoDesenhado === 1 &&
  terminaEmA(otim) &&
  terminaEmA(usuario) &&
  temRetorno(otim) &&
  temRetorno(usuario) &&
  num(otim.distancia) < num(usuario.distancia) &&
  num(antes.distancia) !== num(depois.distancia);

console.log('');
console.log(`circuito fecha em A (menor rota):   ${terminaEmA(otim) ? 'SIM' : 'NÃO'}`);
console.log(`circuito fecha em A (ordem do usuário): ${terminaEmA(usuario) ? 'SIM' : 'NÃO'}`);
console.log(`trecho de retorno desenhado:        ${otim.retornoDesenhado === 1 ? 'SIM' : 'NÃO'}`);
console.log(
  `menor rota é mais curta:              ${num(otim.distancia) < num(usuario.distancia) ? 'SIM' : 'NÃO'} ` +
    `(${otim.distancia} km × ${usuario.distancia} km)`,
);
console.log(
  `arraste mudou a rota:                 ${num(antes.distancia) !== num(depois.distancia) ? 'SIM' : 'NÃO'} ` +
    `(${antes.distancia} km → ${depois.distancia} km)`,
);
console.log(`inverter indisponível no circuito:   ${await pagina.locator('#swap').isDisabled() ? 'SIM' : 'NÃO'}`);

await navegador.close();
console.log(ok ? '\nVALIDAÇÃO VISUAL APROVADA' : '\nVALIDAÇÃO VISUAL REPROVADA');
process.exit(ok ? 0 : 1);
