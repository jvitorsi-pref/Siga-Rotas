import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  obterOuCriarUsuarioIdWeb,
  lerPreferenciasWeb,
  salvarPreferenciasWeb,
  estiloClassificacao,
  simboloCategoria,
  rotuloStatusOcorrencia,
  rotuloTemporalidade,
  gerarHtmlOpcoesCategoriasEvitar,
} from '../public/ocorrenciasUI.js';
import { criarClienteRede } from '../public/clienteRede.js';
import { buildGraph } from '../core/graph.js';
import { createServer } from '../server/index.js';
import { CATEGORIAS_OCORRENCIA, CLASSIFICACOES } from '../ocorrencias/catalogo.js';
import { MODOS_PREFERENCIA } from '../ocorrencias/preferencias.js';
import { project, unproject } from '../core/geo.js';
import { ROOT, feature, official } from './helpers.js';

function criarMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
}

function criarRedeWebTeste() {
  const [x, y] = project(-46.535, -23.663);
  const coord = (dx, dy) => unproject(x + dx, y + dy);
  return {
    coord,
    collection: {
      type: 'FeatureCollection',
      features: [
        feature(official(101, 'DIRETA SUL'), [coord(0, 0), coord(200, 0)]),
        feature(official(102, 'OESTE'), [coord(0, 0), coord(0, 140)]),
        feature(official(103, 'PARALELA NORTE'), [coord(0, 140), coord(200, 140)]),
        feature(official(104, 'LESTE'), [coord(200, 0), coord(200, 140)]),
      ],
    },
  };
}

test('Web UI helpers persistem usuarioId e preferências e geram opções de categorias válidas', () => {
  const storage = criarMemoryStorage();
  const id1 = obterOuCriarUsuarioIdWeb(storage);
  const id2 = obterOuCriarUsuarioIdWeb(storage);
  assert.ok(id1.startsWith('web_'));
  assert.equal(id1, id2);

  const salvas = salvarPreferenciasWeb(
    {
      modo: MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES,
      evitarCategorias: ['escadaria', 'invalida_ignorada'],
    },
    storage,
  );
  assert.equal(salvas.modo, MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES);
  assert.deepEqual(salvas.evitarCategorias, ['escadaria']);
  assert.deepEqual(lerPreferenciasWeb(storage), salvas);

  const html = gerarHtmlOpcoesCategoriasEvitar(salvas);
  assert.match(html, /value="escadaria"\s+checked/);
  for (const cat of CATEGORIAS_OCORRENCIA) {
    assert.ok(html.includes(cat.rotulo), `HTML deve conter ${cat.rotulo}`);
    assert.ok(simboloCategoria(cat.id));
  }
  assert.equal(estiloClassificacao(CLASSIFICACOES.EVITA).cor, '#dc2626');
  assert.equal(rotuloStatusOcorrencia('em_analise'), 'Em análise');
  assert.equal(rotuloTemporalidade('permanente'), 'Permanente');
});

test('Web/PWA/WebForms markup, sw.js e app.js integram preferências, ocorrências e proxy sem dependências externas', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const sw = readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

  for (const id of ['prefs-box', 'route-alternatives', 'route-occurrences', 'occ-menu-btn', 'occ-popover', 'occ-map-add', 'occ-map-toggle', 'fit-network-btn', 'legend-toggle-btn', 'legend-box', 'occ-modal', 'occ-detail-modal']) {
    assert.ok(html.includes(`id="${id}"`), `index.html deve conter #${id}`);
  }
  assert.match(html, /Nova Ocorrência/);
  assert.match(html, /Visualizar/);
  assert.match(html, /id="legend-box"[^>]*hidden/);
  assert.match(app, /abrirLegenda/);
  assert.match(app, /fecharLegenda/);
  assert.match(sw, /\/ocorrenciasUI\.js/);
  assert.match(sw, /\/ocorrencias\/catalogo\.js/);
  assert.match(sw, /\/ocorrencias\/preferencias\.js/);
  assert.match(sw, /\/ocorrencias\/regras\.js/);
  assert.match(sw, /\/ocorrencias\/roteamentoAlternativo\.js/);
  assert.match(app, /featureIdPreferido/);
  assert.doesNotMatch(app, /graphhopper|mapbox|osrm|openrouteservice/i);
});

test('clienteRede em modo fallback cliente suporta todo o ciclo de ocorrências e rota alternativa sem servidor', async () => {
  const { coord, collection } = criarRedeWebTeste();
  const snapshotUrl = 'https://local.test/network.snapshot.json';

  const cliente = criarClienteRede({
    href: 'http://localhost/public/index.html?modo=cliente',
    snapshotUrl,
    allowWfs: false,
    fetchImpl: async (url) => {
      if (String(url) === snapshotUrl) {
        return new Response(JSON.stringify(collection), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    },
  });

  const midSul = coord(100, 0);
  const segRes = await cliente.fetchApi('/api/ocorrencias/segmento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: midSul[1], longitude: midSul[0] }),
  });
  assert.equal(segRes.status, 200);
  const seg = await segRes.json();
  assert.equal(seg.principal.logradouro, 'DIRETA SUL');

  const regRes = await cliente.fetchApi('/api/ocorrencias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      categoria: 'escadaria',
      classificacao: CLASSIFICACOES.PENALIZA,
      temporalidade: 'permanente',
      latitude: midSul[1],
      longitude: midSul[0],
      featureIdPreferido: seg.principal.featureId,
      usuarioId: 'u-web-1',
    }),
  });
  assert.equal(regRes.status, 201);
  const criado = (await regRes.json()).ocorrencia;

  // Voto duplicado do mesmo usuário deve retornar 409
  const dupRes = await cliente.fetchApi('/api/ocorrencias/interagir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: criado.id, tipo: 'confirmar', usuarioId: 'u-web-1' }),
  });
  assert.equal(dupRes.status, 409);

  // Calcula rota com preferências: deve retornar alternativa desviando da escadaria
  const orig = coord(0, 0);
  const dest = coord(200, 0);
  const rotaRes = await cliente.fetchApi('/api/rota-paradas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pontos: [
        { rotulo: 'A', latitude: orig[1], longitude: orig[0] },
        { rotulo: 'B', latitude: dest[1], longitude: dest[0] },
      ],
      modo: 'usuario',
      circular: true,
      preferencias: { modo: MODOS_PREFERENCIA.CONSIDERAR, evitarCategorias: ['escadaria'] },
    }),
  });
  assert.equal(rotaRes.status, 200);
  const rota = await rotaRes.json();
  assert.ok(Array.isArray(rota.rotas) && rota.rotas.length >= 1);
  assert.ok(rota.rotas[0].rota.legs[0].streets.some((s) => /PARALELA NORTE/i.test(s)));
});

test('clienteRede em iframe WebForms encaminha ocorrências via ApiProxy.ashx ao servidor Node.js', async (t) => {
  const { coord, collection } = criarRedeWebTeste();
  const occFile = path.join(ROOT, 'data', `test-ocorrencias-web-${Date.now()}.json`);
  const graph = buildGraph(collection.features);
  const server = createServer({
    service: {
      options: { autoUpdate: { enabled: false }, layerName: 'teste' },
      update: {},
      status: () => ({ ready: true, source: 'snapshot' }),
      ensureReady: async () => ({
        graph,
        features: collection.features,
        diagnostics: graph.diagnostics,
        source: 'snapshot',
        strategy: 'mock',
        builtAt: Date.now(),
        elapsedMs: 1,
        serverTotal: collection.features.length,
        attributes: ['ID', 'COD_LOG', 'DSC_LOGRADOURO'],
        warnings: [],
      }),
    },
    ocorrenciasOptions: {
      filePath: occFile,
    },
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(occFile);
    } catch {
      /* ok */
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const nodeBase = `http://127.0.0.1:${port}`;

  // Emula o ApiProxy.ashx traduzindo ?endpoint=/api/... para o Node.js loopback
  const proxyFetch = async (rawUrl, init) => {
    const u = new URL(rawUrl);
    if (u.pathname.endsWith('/ApiProxy.ashx')) {
      const endpoint = u.searchParams.get('endpoint');
      const rest = new URLSearchParams(u.searchParams);
      rest.delete('endpoint');
      const qs = rest.toString() ? `?${rest.toString()}` : '';
      return fetch(`${nodeBase}${endpoint}${qs}`, init);
    }
    return fetch(rawUrl, init);
  };

  const cliente = criarClienteRede({
    href: 'https://iis.santoandre.sp.gov.br/SigaApp/SigaRotas/public/index.html',
    apiBase: '',
    proxyPath: '../ApiProxy.ashx',
    allowLocalFallback: false,
    fetchImpl: proxyFetch,
  });

  const p = coord(100, 0);
  const reg = await cliente.fetchApi('/api/ocorrencias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      categoria: 'obra_bloqueio',
      classificacao: CLASSIFICACOES.EVITA,
      temporalidade: 'temporaria',
      latitude: p[1],
      longitude: p[0],
      usuarioId: 'u-iis-1',
    }),
  });
  assert.equal(reg.status, 201);

  const list = await cliente.fetchApi('/api/ocorrencias');
  assert.equal(list.status, 200);
  const listJson = await list.json();
  assert.equal(listJson.ocorrencias.length, 1);
  assert.equal(listJson.ocorrencias[0].localizacao.logradouro, 'DIRETA SUL');
});
