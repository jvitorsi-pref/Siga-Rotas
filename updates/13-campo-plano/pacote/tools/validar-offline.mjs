/* ==========================================================================
   tools/validar-offline.mjs
   --------------------------------------------------------------------------
   Validador de navegador da **coleta de campo** (rodada 13).

   Verifica, no navegador de verdade:
     1. a rota planejada é salva no aparelho e **sobrevive ao recarregamento**;
     2. a sessão de GPS acumula pontos **sem depender do servidor** (a
        navegação é testada com a rede do servidor desligada);
     3. a localização de residência é capturada com coordenadas, precisão e
        Plus Code, e fica gravada no aparelho;
     4. a interface distingue rota planejada, trajeto real e dados pendentes.

   Uso:  node tools/validar-offline.mjs
   ========================================================================== */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const ORIGEM = { lat: -23.704214, lon: -46.514975 };
const DESTINO = { lat: -23.701514, lon: -46.516961 };

let falhas = 0;
function conferir(condicao, descricao, detalhe = '') {
  if (condicao) {
    console.log('  ok   ' + descricao);
  } else {
    falhas += 1;
    console.log('  FALHA ' + descricao + (detalhe ? ' — ' + detalhe : ''));
  }
}

const navegador = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexto = await navegador.newContext({
  viewport: { width: 1400, height: 1000 },
  permissions: ['geolocation'],
  geolocation: { latitude: ORIGEM.lat, longitude: ORIGEM.lon, accuracy: 8 },
  locale: 'pt-BR',
});
const pagina = await contexto.newPage();

const erros = [];
const esperados = [];
// durante a fase offline, as requisições que falham (tiles do mapa-base,
// etc.) são ESPERADAS — é justamente isso que prova que o aplicativo
// funciona sem rede. Elas não contam como falha.
let faseOffline = false;
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (faseOffline && /ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/i.test(m.text())) {
    esperados.push(m.text());
    return;
  }
  erros.push('console: ' + m.text());
});

async function preencher(pontos) {
  const cartoes = await pagina.locator('.point').all();
  for (let i = 0; i < cartoes.length && i < pontos.length; i++) {
    const campo = cartoes[i].locator('.point__coord');
    await campo.fill(pontos[i].lon + ', ' + pontos[i].lat);
    await pagina.waitForTimeout(250);
  }
}

console.log('\n== 1. abertura e painel de coleta ==');
await pagina.goto(BASE + '/', { waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);

conferir(await pagina.locator('#bloco-campo').count() === 1, 'o painel de coleta existe');
await pagina.locator('#bloco-campo > summary').click();
await pagina.waitForTimeout(400);
conferir(await pagina.locator('#campo-iniciar').isVisible(), 'o painel de coleta abre');

console.log('\n== 2. rota planejada: salvar no aparelho ==');
await preencher([
  { lat: ORIGEM.lat, lon: ORIGEM.lon },
  { lat: DESTINO.lat, lon: DESTINO.lon },
]);
await pagina.click('#calc');
await pagina.waitForFunction(
  () => {
    const t = document.querySelector('#distance-value')?.textContent || '';
    return t && t !== '—';
  },
  null,
  { timeout: 120000 },
);
await pagina.waitForTimeout(800);
const distanciaRota = await pagina.locator('#distance-value').textContent();
console.log('  (rota calculada: ' + distanciaRota.trim() + ')');

await pagina.click('#campo-salvar-rota');
await pagina.waitForTimeout(900);
const itensRota = await pagina.locator('#campo-rotas .campo__item').count();
conferir(itensRota === 1, 'a rota planejada foi salva no dispositivo', 'itens: ' + itensRota);

console.log('\n== 3. recarregar: a rota e os dados continuam no aparelho ==');
await pagina.reload({ waitUntil: 'networkidle' });
await pagina.waitForTimeout(2500);
await pagina.locator('#bloco-campo > summary').click();
await pagina.waitForTimeout(500);

const itensDepois = await pagina.locator('#campo-rotas .campo__item').count();
conferir(itensDepois === 1, 'a rota salva é recuperada após recarregar', 'itens: ' + itensDepois);

const textoRota = await pagina.locator('#campo-rotas .campo__item').first().innerText();
conferir(/A\s*→\s*B/.test(textoRota.replace(/\n/g, ' ')), 'a rota recuperada mantém a sequência', textoRota.replace(/\n/g, ' '));

await pagina.locator('#campo-rotas .campo__item button[data-acao="abrir"]').first().click();
await pagina.waitForTimeout(1200);
const pontosRestaurados = await pagina.locator('.point .point__coord').evaluateAll((els) =>
  els.map((e) => e.value).filter(Boolean),
);
conferir(
  pontosRestaurados.length >= 2,
  'os pontos do trajeto são repostos no painel',
  'pontos: ' + pontosRestaurados.length,
);

console.log('\n== 4. coleta do trajeto real (com o servidor desligado) ==');
// a partir daqui o servidor deixa de responder: a coleta tem de funcionar
// apenas com o armazenamento do aparelho
await contexto.setOffline(true);
faseOffline = true;

await pagina.click('#campo-iniciar');
await pagina.waitForTimeout(1200);
conferir(
  (await pagina.locator('#campo-estado').innerText()).includes('andamento'),
  'a coleta foi iniciada',
);

await contexto.setGeolocation({ latitude: DESTINO.lat, longitude: DESTINO.lon, accuracy: 10 });
await pagina.waitForTimeout(2500);
await contexto.setGeolocation({ latitude: -23.7005, longitude: -46.5185, accuracy: 12 });
await pagina.waitForTimeout(2500);

const pontosColetados = await pagina.locator('#campo-pontos').innerText();
conferir(Number(pontosColetados) >= 1, 'pontos GPS foram acumulados', 'pontos: ' + pontosColetados);

const pontosAntes = await pagina.evaluate(() => window.__app.coleta.estado.pontos);
conferir(Number(pontosAntes) >= 1, 'os pontos ficaram gravados antes da queda', 'pontos: ' + pontosAntes);

console.log('\n== 5. recuperação da coleta interrompida (recarregar durante a coleta) ==');
// a coleta continua aberta: recarregar a página simula a queda do aplicativo
await contexto.setOffline(false);
faseOffline = false;
await pagina.reload({ waitUntil: 'domcontentloaded' });
await pagina.waitForTimeout(2500);
await pagina.locator('#bloco-campo > summary').click();
await pagina.waitForTimeout(700);

const avisoRecuperado = await pagina.locator('#campo-aviso').innerText();
conferir(
  /interrompida|recuperad/i.test(avisoRecuperado),
  'o aparelho informa a coleta interrompida',
  avisoRecuperado,
);
const estadoRecuperado = await pagina.locator('#campo-estado').innerText();
conferir(
  /pausada|interrompida|retomar/i.test(estadoRecuperado + avisoRecuperado),
  'a coleta recuperada aparece no painel',
  estadoRecuperado,
);
const retomarVisivel = await pagina.locator('#campo-retomar').isVisible();
conferir(retomarVisivel, 'o botão de retomar fica disponível');

// retoma e continua a mesma sessão
await pagina.click('#campo-retomar');
await pagina.waitForTimeout(800);
const sessaoAntes = await pagina.evaluate(() => window.__app.coleta.estado.sessaoId);
await contexto.setGeolocation({ latitude: -23.6998, longitude: -46.5195, accuracy: 9 });
await pagina.waitForTimeout(2500);
const sessaoDepois = await pagina.evaluate(() => window.__app.coleta.estado.sessaoId);
conferir(sessaoAntes === sessaoDepois, 'retomar continua a MESMA sessão', sessaoAntes + ' → ' + sessaoDepois);
const pontosDepois = await pagina.evaluate(() => window.__app.coleta.estado.pontos);
conferir(Number(pontosDepois) > Number(pontosAntes), 'os pontos continuam sendo gravados', pontosDepois);

await pagina.click('#campo-encerrar');
await pagina.waitForTimeout(1200);
const avisoEncerramento = await pagina.locator('#campo-aviso').innerText();
conferir(/encerrada/i.test(avisoEncerramento), 'a coleta foi encerrada', avisoEncerramento);

console.log('\n== 6. localização de residência ==');
await pagina.click('#campo-capturar');
await pagina.waitForTimeout(2000);
const formVisivel = await pagina.locator('#campo-form').isVisible();
conferir(formVisivel, 'o formulário de localização aparece');
if (formVisivel) {
  const lat = await pagina.locator('#campo-lat').inputValue();
  const lon = await pagina.locator('#campo-lon').inputValue();
  const plus = await pagina.locator('#campo-plus').inputValue();
  const precisao = await pagina.locator('#campo-precisao').inputValue();
  console.log('  (capturado: ' + lat + ', ' + lon + ' · ' + plus + ' · ±' + precisao + ' m)');
  conferir(/^-?\d+(\.\d+)?$/.test(lat) && /^-?\d+(\.\d+)?$/.test(lon), 'as coordenadas foram capturadas');
  conferir(
    /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}$/.test(plus),
    'o Plus Code foi calculado localmente',
    plus,
  );
  await pagina.click('#campo-form button[type="submit"]');
  await pagina.waitForTimeout(900);
  const itensRes = await pagina.locator('#campo-residencias .campo__item').count();
  conferir(itensRes === 1, 'a localização ficou gravada no aparelho', 'itens: ' + itensRes);
}

console.log('\n== 7. dados pendentes no aparelho ==');
const pendentes = await pagina.locator('#campo-pendentes').innerText();
console.log('  ' + pendentes);
conferir(/aguardando sincroniza/i.test(pendentes), 'os registros pendentes são contabilizados');

console.log('\n== 8. manifesto e Service Worker ==');
const manifesto = await pagina.evaluate(async () => {
  const r = await fetch('/manifest.webmanifest');
  return { status: r.status, tipo: r.headers.get('content-type'), corpo: await r.json() };
});
conferir(manifesto.status === 200, 'o manifesto PWA é servido');
conferir(
  (manifesto.tipo || '').includes('manifest+json'),
  'o manifesto tem o MIME correto',
  manifesto.tipo,
);
conferir(
  !!manifesto.corpo.name && manifesto.corpo.display === 'standalone',
  'o manifesto declara nome e modo standalone',
);
const sw = await pagina.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => (r.active ? r.active.scriptURL : r.installing?.scriptURL)).join(',');
});
conferir(/sw\.js/.test(sw), 'o Service Worker foi registrado', sw || 'nenhum');

await pagina.screenshot({
  path: 'updates/13-campo-plano/imagens/app-coleta.png',
  fullPage: false,
});
await pagina.locator('#bloco-campo').screenshot({
  path: 'updates/13-campo-plano/imagens/painel-coleta.png',
}).catch(() => null);

console.log('\n== 9. modo de teste: coleta simulada ==');
await pagina.click('input[name="campomodo"][value="simulacao"]');
await pagina.waitForTimeout(500);
conferir(
  await pagina.locator('#campo-banner-sim').isVisible(),
  'o aviso de MODO DE TESTE aparece na coleta',
);
conferir(
  await pagina.locator('#campo-sim').isVisible(),
  'os controles de simulação aparecem',
);

// a simulação precisa de uma rota: recupera a que foi salva no aparelho
await pagina.click('#campo-iniciar');
await pagina.waitForTimeout(1500);
const estadoSim = await pagina.locator('#campo-estado').innerText();
conferir(/andamento/i.test(estadoSim), 'a coleta simulada iniciou', estadoSim);
const avisoSim = await pagina.locator('#campo-aviso').innerText();
conferir(/MODO DE TESTE/i.test(avisoSim), 'o painel avisa que a posição é simulada', avisoSim);

// percorre a rota simulada
await pagina.click('#campo-sim-avancar');
await pagina.waitForTimeout(700);
await pagina.click('#campo-sim-avancar');
await pagina.waitForTimeout(700);
const pontosSim = await pagina.evaluate(() => window.__app.coleta.estado.pontos);
conferir(Number(pontosSim) >= 1, 'a simulação gravou pontos no aparelho', 'pontos: ' + pontosSim);

const fonteSessao = await pagina.evaluate(async () => {
  const repo = window.__app.coleta.armazenamento;
  const sessoes = await repo.listarSessoes();
  return sessoes.length ? sessoes[sessoes.length - 1].fonte : null;
});
conferir(fonteSessao === 'simulacao', 'a sessão registra a origem simulada', String(fonteSessao));

const pontosMarcados = await pagina.evaluate(async () => {
  const repo = window.__app.coleta.armazenamento;
  const sessoes = await repo.listarSessoes();
  const pontos = await repo.listarPontos(sessoes[sessoes.length - 1].id);
  return pontos.map((p) => p.fonte);
});
conferir(
  pontosMarcados.length > 0 && pontosMarcados.every((f) => f === 'simulacao'),
  'nenhum ponto simulado se confunde com uma medição de campo',
  JSON.stringify(pontosMarcados),
);

// marcar a residência durante o trajeto simulado
await pagina.click('#campo-marcar-residencia');
await pagina.waitForTimeout(900);
const avisoResidencia = await pagina.locator('#campo-aviso').innerText();
conferir(/residência marcada/i.test(avisoResidencia), 'a residência foi marcada', avisoResidencia);

const vinculo = await pagina.evaluate(async () => {
  const repo = window.__app.coleta.armazenamento;
  const sessoes = await repo.listarSessoes();
  const res = await repo.listarResidencias();
  const ultima = res[res.length - 1];
  return { sessaoId: ultima?.sessaoId, sessaoAtual: sessoes[sessoes.length - 1].id };
});
conferir(
  vinculo.sessaoId === vinculo.sessaoAtual,
  'a residência marcada fica ligada à sessão de coleta',
  JSON.stringify(vinculo),
);

await pagina.click('#campo-encerrar');
await pagina.waitForTimeout(800);

console.log('\n== erros de console ==');
if (esperados.length) {
  console.log('  (' + esperados.length + ' falha(s) de rede durante a fase offline — esperadas)');
}
if (erros.length) {
  erros.forEach((e) => console.log('  ! ' + e));
  falhas += erros.length;
} else {
  console.log('  nenhum');
}

await navegador.close();

console.log('\n============================================');
if (falhas === 0) {
  console.log('  VALIDACAO OFFLINE APROVADA');
} else {
  console.log('  VALIDACAO OFFLINE COM ' + falhas + ' FALHA(S)');
}
console.log('============================================');
process.exit(falhas === 0 ? 0 : 1);
