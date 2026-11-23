import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';

import { buildGraph } from '../core/graph.js';
import { createServer } from '../server/index.js';
import { OcorrenciasService } from '../server/ocorrenciasService.js';
import { feature, official, ROOT } from './helpers.js';

function criarRedeTesteServidor() {
  const bLon = -46.42;
  const bLat = -23.68;
  return [
    feature(official(10, 'RUA PRINCIPAL SUL'), [
      [bLon, bLat],
      [bLon + 0.0022, bLat],
    ]),
    feature(official(11, 'RUA OESTE'), [
      [bLon, bLat],
      [bLon, bLat + 0.0005],
    ]),
    feature(official(12, 'RUA ALTERNATIVA NORTE'), [
      [bLon, bLat + 0.0005],
      [bLon + 0.0022, bLat + 0.0005],
    ]),
    feature(official(13, 'RUA LESTE'), [
      [bLon + 0.0022, bLat + 0.0005],
      [bLon + 0.0022, bLat],
    ]),
  ];
}

async function iniciarServidorMock(dir) {
  const features = criarRedeTesteServidor();
  const graph = buildGraph(features);
  const serviceMock = {
    options: { autoUpdate: { enabled: false }, layerName: 'teste' },
    update: { lastWfsError: null, lastWfsSuccessAt: null },
    status() {
      return { ready: true, source: 'snapshot' };
    },
    async ensureReady() {
      return {
        graph,
        features,
        diagnostics: graph.diagnostics,
        source: 'snapshot',
        strategy: 'mock',
        builtAt: Date.now(),
        elapsedMs: 1,
        serverTotal: features.length,
        attributes: ['ID', 'COD_LOG', 'DSC_LOGRADOURO'],
        warnings: [],
      };
    },
  };

  const filePath = path.join(dir, 'ocorrencias.json');
  const server = createServer({
    service: serviceMock,
    ocorrenciasOptions: { filePath },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    filePath,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('OcorrenciasService — persistência atômica e concorrência', () => {
  it('persiste em JSON atômico e preserva dados ao recarregar nova instância', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'siga-occ-svc-'));
    try {
      const filePath = path.join(dir, 'ocorrencias.json');
      const graph = buildGraph(criarRedeTesteServidor());
      const svc1 = new OcorrenciasService({ filePath });

      assert.deepEqual(await svc1.listar(), []);
      assert.equal(existsSync(filePath), false, 'leitura vazia não deve sujar o disco');

      const reg = await svc1.registrar(
        {
          categoria: 'buracos',
          classificacao: 'penaliza',
          descricao: 'Cratera próxima ao meio-fio',
          latitude: -23.68,
          longitude: -46.4189,
        },
        { graph, usuarioId: 'cidadao-1' },
      );
      assert.equal(reg.ok, true);
      assert.equal(existsSync(filePath), true);

      // Gravações concorrentes preservam ambas as ocorrências
      await Promise.all([
        svc1.registrar(
          { categoria: 'escadaria', latitude: -23.6795, longitude: -46.4189 },
          { graph, usuarioId: 'cidadao-2' },
        ),
        svc1.registrar(
          { categoria: 'alagamento', latitude: -23.6798, longitude: -46.42 },
          { graph, usuarioId: 'cidadao-3' },
        ),
      ]);

      const svc2 = new OcorrenciasService({ filePath });
      const recarregadas = await svc2.listar();
      assert.equal(recarregadas.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('API HTTP de ocorrências e rota com alternativas', () => {
  it('serve os módulos isomórficos em /ocorrencias/*.js e o proxy WebForms libera os novos endpoints', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'siga-occ-static-'));
    const srv = await iniciarServidorMock(dir);
    t.after(async () => {
      await srv.close();
      rmSync(dir, { recursive: true, force: true });
    });

    for (const mod of ['catalogo.js', 'preferencias.js', 'regras.js', 'roteamentoAlternativo.js']) {
      const r = await fetch(`${srv.base}/ocorrencias/${mod}`);
      assert.equal(r.status, 200, `módulo /ocorrencias/${mod} deve ser servido`);
      assert.match(r.headers.get('content-type') || '', /javascript/);
    }

    const ashx = readFileSync(path.join(ROOT, 'webforms', 'ApiProxy.ashx'), 'utf8');
    assert.match(ashx, /"\/api\/ocorrencias"/);
    assert.match(ashx, /"\/api\/ocorrencias\/interagir"/);
    assert.match(ashx, /"\/api\/ocorrencias\/segmento"/);
  });

  it('fluxo completo: preview de segmento, criação, confirmação, rota alternativa e resolução', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'siga-occ-api-'));
    const srv = await iniciarServidorMock(dir);
    t.after(async () => {
      await srv.close();
      rmSync(dir, { recursive: true, force: true });
    });

    // 1. Preview de segmento
    const segRes = await fetch(`${srv.base}/api/ocorrencias/segmento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: -23.68, longitude: -46.4189 }),
    });
    assert.equal(segRes.status, 200);
    const segJson = await segRes.json();
    assert.equal(segJson.ok, true);
    assert.equal(segJson.principal.logradouro, 'RUA PRINCIPAL SUL');

    // 2. Registro de ocorrência penalizadora na RUA PRINCIPAL SUL
    const postRes = await fetch(`${srv.base}/api/ocorrencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria: 'buracos',
        classificacao: 'penaliza',
        penalidadeMetros: 300,
        temporalidade: 'temporaria',
        descricao: 'Asfalto cedendo no passeio',
        latitude: -23.68,
        longitude: -46.4189,
        usuarioId: 'user-a',
      }),
    });
    assert.equal(postRes.status, 201);
    const postJson = await postRes.json();
    assert.equal(postJson.ok, true);
    const occId = postJson.ocorrencia.id;

    // 3. Rota com paradas calcula alternativa recomendada + mais curta
    const rotaRes = await fetch(`${srv.base}/api/rota-paradas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pontos: [
          { rotulo: 'Origem', latitude: -23.68, longitude: -46.42 },
          { rotulo: 'Destino', latitude: -23.68, longitude: -46.4178 },
        ],
        preferencias: { modo: 'considerar' },
      }),
    });
    assert.equal(rotaRes.status, 200);
    const rotaJson = await rotaRes.json();
    assert.equal(rotaJson.ok, true);
    assert.equal(rotaJson.rotas.length, 2);
    assert.equal(rotaJson.rotaSelecionadaId, 'recomendada');

    // 4. Confirmação duplicada bloqueada (409) e segunda confirmação aceita (200)
    const dupRes = await fetch(`${srv.base}/api/ocorrencias/interagir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: occId, tipo: 'confirmar', usuarioId: 'user-a' }),
    });
    assert.equal(dupRes.status, 409);

    const confRes = await fetch(`${srv.base}/api/ocorrencias/interagir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: occId, tipo: 'confirmar', usuarioId: 'user-b' }),
    });
    assert.equal(confRes.status, 200);
    const confJson = await confRes.json();
    assert.equal(confJson.ocorrencia.contadores.confirmacoes, 2);

    // 5. Consenso de resolução remove das ativas
    for (const uid of ['user-c', 'user-d', 'user-e']) {
      const r = await fetch(`${srv.base}/api/ocorrencias/interagir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: occId, tipo: 'resolver', usuarioId: uid }),
      });
      assert.equal(r.status, 200);
    }

    const listAtivas = await (await fetch(`${srv.base}/api/ocorrencias`)).json();
    assert.equal(listAtivas.ocorrencias.length, 0);
    const listTodas = await (await fetch(`${srv.base}/api/ocorrencias?incluirInativas=true`)).json();
    assert.equal(listTodas.ocorrencias.length, 1);
    assert.equal(listTodas.ocorrencias[0].status, 'resolvida');
  });
});
