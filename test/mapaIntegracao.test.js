import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolverPontoNoMapa } from '../public/planejamentoCircuito.js';
import { ResolverEnderecoDigital } from '../core/enderecoDigital.js';
import { STATUS } from '../core/pontoTrajeto.js';

const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const swJs = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Req 1: mapa-base usa filtro equilibrado, marca OSM removida e CSS não mantém sobras escuras', () => {
  const basemapBlock = css.match(/\.basemap\s*\{[^}]*\}/)?.[0] || '';
  assert.match(basemapBlock, /grayscale/);
  assert.match(basemapBlock, /contrast/);
  assert.doesNotMatch(basemapBlock, /brightness\(1\.19\)/);

  const attrBlock = css.match(/\.ol-attribution\s*\{[^}]*\}/)?.[0] || '';
  assert.match(attrBlock, /display:\s*none/);
  assert.match(appJs, /controls:[\s\S]*?attribution:\s*false/);

  assert.doesNotMatch(css, /#1b222b|#b7c0ca|#c4b5fd|#d8c7ff|rgba\(47,\s*129,\s*247/);
  const distanceBlock = css.match(/\.distance__value\s*\{[^}]*\}/)?.[0] || '';
  assert.match(distanceBlock, /color:\s*var\(--accent\)/);
  assert.match(appJs, /kind === TIPOS\.ORIGEM \|\| kind === 'origin'/);
});

test('Req 2: Web configura View até zoom 22 mantendo tiles OSM em zoom 19 com interpolação', () => {
  assert.match(appJs, /new ol\.source\.OSM\(\{\s*maxZoom:\s*19,\s*interpolate:\s*true/s);
  assert.match(appJs, /new ol\.View\(\{[^}]*minZoom:\s*5,\s*maxZoom:\s*22/s);
});

test('Req 3: coleta de campo foi removida completamente do Web, core, testes e SW', () => {
  for (const rel of [
    '../core/coleta.js',
    '../core/armazenamentoLocal.js',
    '../core/recuperacaoColeta.js',
    '../public/coletaUI.js',
    '../public/planoPersistido.js',
    '../tools/validar-offline.mjs',
  ]) {
    assert.equal(existsSync(new URL(rel, import.meta.url)), false, `não deveria existir: ${rel}`);
  }
  assert.doesNotMatch(html, /bloco-campo|campo-iniciar|Coleta de campo/i);
  assert.doesNotMatch(css, /\.block--campo|\.campo__/);
  assert.doesNotMatch(appJs, /coletaUI|planoPersistido|abrirPlanoSalvo|\.coleta\b/);
  assert.doesNotMatch(swJs, /coletaUI|planoPersistido|core\/coleta|recuperacaoColeta|armazenamentoLocal/);
  assert.match(swJs, /'\/gpx\.js'/);
  assert.match(swJs, /'\/exportarGpxWeb\.js'/);
  assert.equal('validar:offline' in pkg.scripts, false);
});

test('Req 4: resolverPontoNoMapa preenche Plus Code válido dentro da região e recusa ponto fora', () => {
  // Centro de Santo André
  const dentro = resolverPontoNoMapa(-23.6635, -46.5320, { acao: 'selecionado' });
  assert.equal(dentro.naRegiao, true);
  assert.equal(dentro.status, STATUS.CONVERTIDO);
  assert.ok(dentro.enderecoDigital.length >= 6);
  const check = ResolverEnderecoDigital(dentro.enderecoDigital);
  assert.equal(check.ok, true);
  assert.equal(dentro.codigoCompleto, check.codigoCompleto);

  // Ponto de borda onde célula pode sair da área ou ser recusada pelo validador
  const borda = resolverPontoNoMapa(-23.6635, -46.9, { acao: 'selecionado' });
  if (borda.naRegiao) {
    assert.equal(ResolverEnderecoDigital(borda.enderecoDigital).ok, true);
  } else {
    assert.equal(borda.enderecoDigital, '');
    assert.equal(borda.status, STATUS.FORA_DA_AREA);
  }

  // Coordenada fora do recorte geográfico REGIAO
  const fora = resolverPontoNoMapa(-22.9068, -43.1729, { acao: 'movido' });
  assert.equal(fora.naRegiao, false);
  assert.equal(fora.status, STATUS.FORA_DA_AREA);
  assert.equal(fora.enderecoDigital, '');
  assert.match(fora.mensagem, /fora da área do Endereço Digital/);

  assert.throws(() => resolverPontoNoMapa(NaN, -46.5), /inválidas/);

  // Integração real no app.js (clique e arraste do marcador)
  assert.match(appJs, /map\.on\('click'[\s\S]*?resolverPontoNoMapa\(pt\.lat,\s*pt\.lon/);
  assert.match(appJs, /translate\.on\('translateend'[\s\S]*?resolverPontoNoMapa\(lonLat\[1\],\s*lonLat\[0\]/);
});

test('Req 5: UI Web inclui botão Exportar GPX e conecta exportarRotaGpxWeb', () => {
  assert.match(html, /id="export-gpx"[^>]*>[\s\S]*Exportar GPX/);
  assert.match(html, /id="export-gpx-feedback"/);
  assert.match(appJs, /exportarRotaGpxWeb\(state\.rotaAtual/);
  assert.match(appJs, /exportarGpx,\s*\n\s*\};/);
});

test('Req 6: Web alterna entre Mapa padrão (OSM) e Satélite (Esri) preservando estilo OSM, atribuição, camada vetorial acima e persistência', () => {
  // Controles na interface Web seguindo identidade visual
  assert.match(html, /id="basemap-control"/);
  assert.match(html, /id="basemap-switch"[^>]*role="group"[^>]*aria-label="Mapa de fundo"/);
  assert.match(html, /data-basemap="osm"[^>]*>Mapa padrão</);
  assert.match(html, /data-basemap="satelite"[^>]*>Satélite</);
  assert.match(html, /id="basemap-notice"/);
  assert.match(html, /id="basemap-fallback-btn"[^>]*>Usar mapa padrão</);

  // CSS preserva filtro .basemap apenas para OSM, mantém satélite natural e evita sobreposições
  assert.match(css, /\.basemap-switch button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent-strong\)/);
  assert.match(css, /\.basemap-satellite\s*\{\s*opacity:\s*1;\s*\}/);
  const simBannerCss = css.match(/\.sim-banner\s*\{[^}]*\}/)?.[0] || '';
  assert.match(simBannerCss, /top:\s*54px/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.pick-banner\s*\{[^}]*top:\s*52px/);

  // app.js preserva OSM e adiciona XYZ Esri com zIndex 0 abaixo da rede/rotas/marcadores
  assert.match(appJs, /const osmLayer = new ol\.layer\.Tile\(\{[\s\S]*?className:\s*'basemap'[\s\S]*?zIndex:\s*0[\s\S]*?new ol\.source\.OSM\(\{\s*maxZoom:\s*19,\s*interpolate:\s*true/);
  assert.match(appJs, /const satSource = new ol\.source\.XYZ\(\{[\s\S]*?attributionsCollapsible:\s*false/);
  assert.match(appJs, /const satLayer = new ol\.layer\.Tile\(\{[\s\S]*?className:\s*'basemap-satellite'[\s\S]*?zIndex:\s*0/);
  assert.match(appJs, /layers:\s*\[osmLayer,\s*satLayer\]/);
  assert.match(appJs, /axisCasingLayer[\s\S]*?zIndex:\s*10/);
  assert.match(appJs, /axisLayer[\s\S]*?zIndex:\s*11/);
  assert.match(appJs, /routeLayer[\s\S]*?zIndex:\s*20/);
  assert.match(appJs, /markerLayer[\s\S]*?zIndex:\s*25/);

  // Troca mútua sem recriar mapa e com persistência localStorage
  assert.match(appJs, /lerPreferenciaCamadaSync\(window\.localStorage\)/);
  assert.match(appJs, /salvarPreferenciaCamadaSync\(proximo,\s*window\.localStorage\)/);
  assert.match(appJs, /osmLayer\.setVisible\(proximo === CAMADA_PADRAO\);\s*\n\s*satLayer\.setVisible\(proximo === CAMADA_SATELITE\);/);
  assert.match(appJs, /tileloaderror/);
  assert.match(appJs, /window\.addEventListener\('offline'/);

  // SW cacheia camadaBase.js sem cachear tiles de terceiros
  assert.match(swJs, /'\/camadaBase\.js'/);
  assert.match(swJs, /url\.origin !== self\.location\.origin\) return;/);
});
