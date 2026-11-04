/**
 * tools/validar-navegacao.mjs
 * ---------------------------------------------------------------------------
 * Validação VISUAL da NAVEGAÇÃO ATIVA (rodada 10) na aplicação real.
 *
 *   1. calcula uma rota curta (4 pontos, ~1,7 km) e confere que o botão
 *      "Começar trajeto" aparece;
 *   2. inicia a navegação no **modo de teste (simulação)** e confere que:
 *      • o painel de navegação abre;
 *      • a faixa "MODO DE TESTE" aparece (a posição é fictícia e o usuário
 *        precisa saber);
 *      • o progresso avança **sobre a geometria da rota**;
 *      • a posição do usuário é desenhada no mapa;
 *   3. espera o trajeto ser concluído (chegada à última parada) e confere
 *      que a navegação se encerra;
 *   4. repete e usa o **cenário de desvio**: o desvio é detectado e o
 *      trajeto é **recalculado pela API** (com a ordem das paradas
 *      restantes preservada);
 *   5. testa o **GPS real**: em contexto sem permissão, o erro de
 *      geolocalização é tratado e mostrado (nada de tela quebrada).
 *
 * Grava as capturas em `updates/10-navegacao-ativa/imagens/`.
 *
 * Requer o servidor no ar (`npm start`) e o Chromium do Playwright:
 *   npx playwright install chromium
 *
 * Uso:  node tools/validar-navegacao.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartao, preencherCoordenadas as preencherCoordenadasUI, abrirMenu, acaoDoMenu, removerLocal } from './lib-interface.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'updates/10-navegacao-ativa/imagens');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
mkdirSync(saida, { recursive: true });

/** pontos reais de Santo André (rota curta: 402 m + 608 m + 719 m) */
const PONTOS = [
  { rotulo: 'A', lat: -23.66, lon: -46.53 },
  { rotulo: 'B', lat: -23.6595, lon: -46.5292 },
  { rotulo: 'C', lat: -23.6575, lon: -46.5255 },
  { rotulo: 'D', lat: -23.662, lon: -46.527 },
];

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

/** Estado da navegação (lido da interface real). */
const estado = async () =>
  pagina.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const nav = window.__app?.nav;
    return {
      status: t('#status'),
      botaoIniciarVisivel: !!document.querySelector('#start-nav')?.offsetParent,
      painelVisivel: !!document.querySelector('#nav-panel')?.offsetParent,
      bannerVisivel: !!document.querySelector('#sim-banner')?.offsetParent,
      simPainelVisivel: !!document.querySelector('#sim-panel')?.offsetParent,
      badge: t('#nav-badge'),
      instrucao: t('#nav-instr'),
      secundario: t('#nav-secundario'),
      progresso: t('#nav-progresso'),
      restante: t('#nav-restante'),
      posicao: t('#nav-posicao'),
      precisao: t('#nav-precisao'),
      proximaParada: t('#nav-parada'),
      trecho: t('#nav-trecho'),
      alerta: t('#nav-alerta'),
      alertaVisivel: !!document.querySelector('#nav-alerta')?.offsetParent,
      velocidade: document.querySelector('#sim-velocidade')?.value,
      // o controlador de navegação (fonte única de verdade)
      execucao: nav?.estado?.controlador?.execucao ?? null,
      modo: nav?.estado?.modo ?? null,
      eventos: nav?.estado?.eventos ?? null,
      percorrido: nav?.estado?.controlador?.percorrido ?? null,
      total: nav?.estado?.controlador?.total ?? null,
      desvio: nav?.estado?.controlador?.desvio ?? null,
      distanciaAteParada: nav?.estado?.controlador?.distanciaAteParada ?? null,
      paradas: (nav?.estado?.plano?.paradas ?? []).map(
        (p) => p.rotulo + '@' + Math.round(p.distanciaNaRota ?? -1),
      ),
      pernas: (nav?.estado?.plano?.pernas ?? []).map(
        (p) => p.de + '->' + p.para + ' ' + Math.round(p.distance),
      ),
      // features desenhadas no mapa
      trechos: window.__app.routeSource.getFeatures().length,
      posicaoMarcada: document.querySelectorAll('.ol-overlaycontainer canvas').length,
    };
  });

const conferir = (e) => ({
  painelAberto: e.painelVisivel,
  bannerTeste: e.bannerVisivel,
  badgeTeste: e.badge === 'MODO DE TESTE',
  progressoAvancou: (e.percorrido ?? 0) > 5,
  instrucaoPreenchida: !!e.instrucao && e.instrucao !== '—',
  posicaoPreenchida: !!e.posicao && e.posicao !== '—',
  simuladorVisivel: e.simPainelVisivel,
});

console.log('1) monta um trajeto curto e calcula a rota');
// as coordenadas ficam nas "opções avançadas" do cartão (rodada 16)
// a lista já começa com o ponto de partida (A) e o primeiro local (B)
await preencherCoordenadasUI(pagina, 'A', PONTOS[0].lon, PONTOS[0].lat);
await pagina.waitForTimeout(400);
for (const p of PONTOS.slice(1, 3)) {
  if (p.rotulo !== 'B') {
    await pagina.click('#add-stop');
    await pagina.waitForTimeout(400);
  }
  await preencherCoordenadasUI(pagina, p.rotulo, p.lon, p.lat);
  await pagina.waitForTimeout(400);
}
// o último local da lista
await pagina.click('#add-stop');
await pagina.waitForTimeout(400);
await preencherCoordenadasUI(pagina, 'D', PONTOS[3].lon, PONTOS[3].lat);
await pagina.waitForTimeout(600);
await pagina.click('#calc');
await pagina.waitForFunction(
  () => {
    const t = document.querySelector('#distance-value')?.textContent || '';
    return t && t !== '—';
  },
  null,
  { timeout: 180000 },
);
await pagina.waitForTimeout(1500);
const comRota = await estado();
console.log('  distância:', comRota.status);
console.log('  botão "Começar trajeto" visível:', comRota.botaoIniciarVisivel);

console.log('2) modo de teste (simulação): inicia a navegação');
await pagina.check('input[name="navmodo"][value="simulacao"]');
await pagina.waitForTimeout(200);
await pagina.click('#start-nav');
await pagina.waitForTimeout(800);
await pagina.selectOption('#sim-velocidade', '25');
await pagina.waitForTimeout(4000);
const simulando = await estado();
console.log('  painel:', simulando.painelVisivel, '| faixa MODO DE TESTE:', simulando.bannerVisivel);
console.log('  selo:', simulando.badge);
console.log('  instrução:', simulando.instrucao);
console.log('  secundário:', simulando.secundario);
console.log('  progresso:', simulando.progresso, '| restante:', simulando.restante);
console.log('  posição:', simulando.posicao, '| precisão:', simulando.precisao);
console.log('  próxima parada:', simulando.proximaParada, '| trecho:', simulando.trecho);
console.log('  percorrido:', simulando.percorrido, 'de', simulando.total);
await pagina.screenshot({ path: `${saida}/app-navegacao-simulacao.png` });

console.log('3) espera a conclusão do trajeto (chegada à última parada)');
const concluiu = await pagina
  .waitForFunction(
    () => {
      const nav = window.__app?.nav;
      return (nav?.estado?.eventos?.conclusoes ?? 0) > 0;
    },
    null,
    { timeout: 180000 },
  )
  .then(() => true)
  .catch(() => false);
const fim = await estado();
console.log('  navegação concluída:', concluiu, '| execução:', fim.execucao);
console.log('  status:', fim.status);
console.log('  painel ainda aberto:', fim.painelVisivel);
await pagina.screenshot({ path: `${saida}/app-navegacao-concluida.png` });

console.log('4) cenário de desvio: desvio detectado e trajeto recalculado');
await pagina.click('#start-nav');
await pagina.waitForTimeout(1500);
const antesDesvio = await estado();
console.log('  trechos desenhados antes:', antesDesvio.trechos);
await pagina.click('#sim-desvio');
await pagina.waitForTimeout(6000);
const depoisDesvio = await estado();
console.log('  desvio:', JSON.stringify(depoisDesvio.desvio));
console.log('  alerta:', depoisDesvio.alerta);
console.log('  status:', depoisDesvio.status);
console.log('  trechos desenhados depois:', depoisDesvio.trechos);
console.log('  pernas do plano:', depoisDesvio.pernas.join(' | '));
console.log('  paradas do plano:', depoisDesvio.paradas.join(' '));
console.log('  distância até a próxima parada:', depoisDesvio.distanciaAteParada);
console.log('  instrução:', depoisDesvio.instrucao);
await pagina.screenshot({ path: `${saida}/app-navegacao-desvio.png` });

console.log('5) GPS real: erro de geolocalização tratado (sem permissão)');
await pagina.click('#nav-encerrar');
await pagina.waitForTimeout(500);
await pagina.check('input[name="navmodo"][value="gps"]');
await pagina.waitForTimeout(200);
await pagina.click('#start-nav');
await pagina.waitForTimeout(4000);
const gps = await estado();
console.log('  painel:', gps.painelVisivel, '| faixa de teste visível (não deve):', gps.bannerVisivel);
console.log('  selo:', gps.badge);
console.log('  alerta:', gps.alerta);
console.log('  status:', gps.status);
await pagina.screenshot({ path: `${saida}/app-navegacao-gps.png` });

// ── veredito ───────────────────────────────────────────────────────────────
const s = conferir(simulando);
const checks = [
  ['botão "Começar trajeto" aparece depois da rota', comRota.botaoIniciarVisivel],
  ['painel de navegação abre', s.painelAberto],
  ['faixa "MODO DE TESTE" visível na simulação', s.bannerTeste],
  ['selo "MODO DE TESTE" no painel', s.badgeTeste],
  ['progresso avança sobre a geometria', s.progressoAvancou],
  ['instrução preenchida', s.instrucaoPreenchida],
  ['posição preenchida', s.posicaoPreenchida],
  ['painel do simulador visível', s.simuladorVisivel],
  ['trajeto concluído (volta ao início encerra a navegação)', concluiu],
  ['desvio detectado (persistência + tolerância)', (depoisDesvio.eventos?.desvios ?? 0) > 0],
  ['trajeto recalculado pela API', (depoisDesvio.eventos?.recalculos ?? 0) > 0],
  ['nenhuma linha reta: os trechos continuam desenhados', depoisDesvio.trechos > 0],
  ['GPS real: painel abre', gps.painelVisivel],
  ['GPS real: sem faixa de modo de teste', !gps.bannerVisivel],
  ['GPS real: erro de permissão tratado', !!gps.alerta],
];
let tudoOk = true;
console.log('\n─── conferências ───');
for (const [nome, ok] of checks) {
  console.log((ok ? '  OK  ' : ' FALHA') + ' · ' + nome);
  if (!ok) tudoOk = false;
}
console.log(
  tudoOk ? '\nVALIDAÇÃO VISUAL APROVADA' : '\nVALIDAÇÃO VISUAL REPROVADA — ver as conferências acima',
);
await navegador.close();
process.exit(tudoOk ? 0 : 1);
