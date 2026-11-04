/**
 * TESTES DA ATUALIZAÇÃO AUTOMÁTICA DA REDE
 * =========================================
 *
 * A camada da Prefeitura é uma view do banco e pode mudar a qualquer
 * momento. O servidor precisa perceber isso sozinho.
 *
 * São testados os dois níveis de verificação:
 *
 *  • LEVE    — compara o total de feições declarado pelo servidor. Detecta
 *              eixos adicionados ou removidos. Custa uma requisição mínima.
 *  • COMPLETA — baixa a rede inteira e compara a impressão digital
 *              (SHA-256) do conteúdo. Detecta também a CORREÇÃO de um eixo
 *              já existente (rua renomeada, traçado redrawn).
 *
 * O GeoServer é SIMULADO, com o mesmo comportamento do real: suporta
 * `propertyName=ID` e `CQL_FILTER` por faixa de ID, e devolve o
 * `totalFeatures` na resposta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';

import { rm } from 'node:fs/promises';

import { NetworkService } from '../server/networkService.js';
import { ROOT } from './helpers.js';

/** Remove os snapshots temporários usados pelos testes. */
async function limparSnapshots() {
  const { readdir } = await import('node:fs/promises');
  const dir = path.join(ROOT, 'data');
  for (const f of await readdir(dir)) {
    if (f.startsWith('test-auto-update-')) {
      await rm(path.join(dir, f), { force: true });
    }
  }
}

/* ------------------------------------------------------------------ */
/* GeoServer simulado, com estado mutável                              */
/* ------------------------------------------------------------------ */

function criarWfsSimulado(inicial) {
  const estado = { features: inicial.slice(), requisicoes: 0 };

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.searchParams;
    estado.requisicoes++;

    if (p.get('request') === 'DescribeFeatureType') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<xsd:schema/>');
      return;
    }

    if (estado.falhar) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('serviço indisponível');
      return;
    }

    const max = Number(p.get('maxFeatures') || 1000);
    const cql = p.get('CQL_FILTER');
    let fatia;
    if (cql) {
      const m = cql.match(/ID\s*>=\s*(-?\d+)\s+AND\s+ID\s*<\s*(-?\d+)/);
      fatia = estado.features.filter(
        (f) => f.properties.ID >= Number(m[1]) && f.properties.ID < Number(m[2])
      );
    } else if (p.get('propertyName')) {
      fatia = estado.features.map((f) => ({
        type: 'Feature',
        properties: { ID: f.properties.ID },
        geometry: null,
      }));
    } else {
      fatia = estado.features.slice(0, max);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'FeatureCollection',
        features: fatia,
        totalFeatures: estado.features.length,
        numberMatched: estado.features.length,
        numberReturned: fatia.length,
      })
    );
  });

  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      resolve({
        estado,
        baseUrl: `http://127.0.0.1:${port}/wfs`,
        close: () => new Promise((r) => servidor.close(r)),
      });
    });
  });
}

function eixo(id, lon = -46.5, lat = -23.66) {
  return {
    type: 'Feature',
    properties: {
      ID: id,
      COD_LOG: 1000 + id,
      TPO_LOGRADOURO: 'RUA',
      COD_TITULO_LOGRADOURO: null,
      NOM_LOGRADOURO: `RUA ${id}`,
      DSC_LOGRADOURO: `RUA ${id}`,
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [lon, lat],
        [lon + 0.001, lat],
      ],
    },
  };
}

let contador = 0;

async function servico(mock, extra = {}) {
  // snapshot com nome único por teste: um arquivo deixado por uma execução
  // anterior não pode contaminar o teste seguinte
  const snapshotPath = path.join(
    ROOT,
    'data',
    `test-auto-update-${process.pid}-${contador++}.snapshot.json`
  );
  return new NetworkService({
    allowWfs: true,
    // aponta o cliente WFS para o servidor simulado
    baseUrl: mock.baseUrl,
    snapshotPath,
    // sem auto-update por temporizador: os testes chamam a verificação na mão
    autoUpdate: { enabled: false },
    ...extra,
  });
}

/* ------------------------------------------------------------------ */

// remove os snapshots temporários ao final da execução
test.after(limparSnapshots);

/* ------------------------------------------------------------------ */

test('a verificação leve não recarrega quando a camada não mudou', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2), eixo(3)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const antes = s.state;
  assert.equal(antes.features.length, 3);

  const r = await s._checkForChanges();
  assert.equal(r.changed, false);
  assert.equal(r.serverTotal, 3);
  assert.equal(s.state, antes, 'o estado não deve ser substituído');
});

test('a verificação leve detecta eixos adicionados e recarrega a rede', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2), eixo(3)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  assert.equal(s.state.features.length, 3);
  const antes = s.state;

  // a Prefeitura acrescenta duas ruas
  mock.estado.features.push(eixo(4), eixo(5));

  const r = await s._checkForChanges();
  assert.equal(r.changed, true);
  assert.match(r.reason, /total de fe/i);
  assert.equal(s.state.features.length, 5, 'a rede deve ter sido recarregada');
  assert.notEqual(s.state, antes, 'o estado deve ter sido substituído');
  assert.ok(s.update.lastChangeAt, 'a data da última mudança deve ser registrada');
});

test('a verificação leve detecta eixos removidos', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2), eixo(3)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  mock.estado.features.pop();

  const r = await s._checkForChanges();
  assert.equal(r.changed, true);
  assert.equal(s.state.features.length, 2);
});

test('a verificação completa detecta a CORREÇÃO de um eixo já existente', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2), eixo(3)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  assert.equal(s.state.features.length, 3);

  // a mesma quantidade de eixos, mas um deles foi corrigido (traçado e nome)
  const corrigido = mock.estado.features[1];
  corrigido.properties.DSC_LOGRADOURO = 'RUA RENOMEADA';
  corrigido.geometry.coordinates = [
      [-46.5, -23.66],
      [-46.4995, -23.6605],
  ];

  const r = await s._checkForChanges({ deep: true });
  assert.equal(r.changed, true, 'a impressão digital do conteúdo deve ter mudado');
  assert.equal(s.state.features.length, 3);
  const nomes = s.state.features.map((f) => f.properties.DSC_LOGRADOURO);
  assert.ok(nomes.includes('RUA RENOMEADA'), 'a rede recarregada deve ter a correção');
});

test('a verificação completa não recarrega quando nada mudou', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2), eixo(3)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const antes = s.state;

  const r = await s._checkForChanges({ deep: true });
  assert.equal(r.changed, false);
  assert.equal(s.state, antes, 'o estado não deve ser substituído');
});

test('a impressão digital é estável e muda com qualquer alteração', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const a = s.update.fingerprint;
  assert.ok(a && a.length === 64, 'deve ser um SHA-256 hexadecimal');

  // mesma rede, ordem diferente -> a impressão digital não pode mudar
  const invertida = mock.estado.features.slice().reverse();
  mock.estado.features = invertida;
  const r1 = await s._checkForChanges({ deep: true });
  assert.equal(r1.changed, false, 'a ordem das feições não deve alterar a impressão');

  // uma coordenada alterada -> a impressão digital muda
  mock.estado.features[0].geometry.coordinates[0][0] += 0.000001;
  const r2 = await s._checkForChanges({ deep: true });
  assert.equal(r2.changed, true);
});

test('a recarga substitui o grafo de forma atômica (estado novo completo)', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const grafoAntigo = s.state.graph;
  mock.estado.features.push(eixo(3));

  await s._checkForChanges();
  assert.notEqual(s.state.graph, grafoAntigo, 'o grafo deve ter sido reconstruído');
  assert.ok(s.state.graph.edges.length > 0);
  assert.equal(s.state.graph.diagnostics.nodes, s.state.graph.nodes.length);
});

test('a falha do WFS na verificação não derruba o servidor nem o estado', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const antes = s.state;

  // o servidor do WFS começa a falhar
  await new Promise((r) => mock.close().then(r));

  await assert.rejects(() => s._checkForChanges());
  assert.equal(s.state, antes, 'o estado anterior deve continuar em uso');
  assert.ok(s.update.errors.length > 0, 'a falha deve ser registrada');
});

test('as verificações concorrentes compartilham a mesma execução', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  await s.ensureReady();
  const reqAntes = mock.estado.requisicoes;
  await Promise.all([
    s._checkForChanges(),
    s._checkForChanges(),
    s._checkForChanges(),
  ]);
  // apenas uma verificação leve deve ter batido no servidor
  assert.equal(mock.estado.requisicoes - reqAntes, 1);
});

test('o temporizador de verificação periódica é ligado e desligado corretamente', async (t) => {
  const mock = await criarWfsSimulado([eixo(1)]);
  t.after(mock.close);
  const s = await servico(mock, {
    autoUpdate: { enabled: true, checkIntervalMs: 50, deepCheckIntervalMs: 100000 },
  });

  await s.ensureReady();
  s.startAutoUpdate();
  assert.equal(s.timers.length, 2, 'deve haver um timer leve e um completo');

  await new Promise((r) => setTimeout(r, 220));
  assert.ok(s.update.lastCheckedAt, 'a verificação periódica deve ter rodado');

  s.stopAutoUpdate();
  assert.equal(s.timers.length, 0);
});

test('sem rede em uso, a verificação leve carrega a rede e vira a linha de base', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock);
  t.after(() => s.stopAutoUpdate());

  assert.equal(s.state, null, 'a rede ainda não foi carregada');
  const r = await s._checkForChanges();
  assert.ok(s.state, 'a verificação deve carregar a rede');
  assert.equal(s.state.features.length, 2);
  assert.equal(r.changed, false, 'não há mudança: a rede acabou de ser carregada');
  assert.equal(r.knownTotal, 2);
  assert.equal(r.serverTotal, 2);
});

test('com o WFS fora do ar, o snapshot antigo ainda permite servir rotas', async (t) => {
  const mock = await criarWfsSimulado([eixo(1), eixo(2)]);
  t.after(mock.close);
  const s = await servico(mock, { snapshotTtl: 0 }); // snapshot considered fora do TTL
  t.after(() => s.stopAutoUpdate());

  // 1) carrega do WFS e grava o snapshot
  await s.ensureReady();
  assert.equal(s.state.source, 'wfs');
  assert.ok(s.state.features.length === 2);

  // 2) o WFS cai
  mock.estado.falhar = true;
  await mock.close();

  // 3) um novo serviço, sem acesso ao WFS, usa o snapshot gravado
  const s2 = new NetworkService({
    allowWfs: true,
    baseUrl: 'http://127.0.0.1:1/wfs', // porta inexistente
    snapshotPath: s.options.snapshotPath,
    snapshotTtl: 0, // snapshot vencido: só serve como reserva
    autoUpdate: { enabled: false },
  });
  const estado = await s2.ensureReady();
  assert.equal(estado.source, 'snapshot');
  assert.equal(estado.features.length, 2);
  assert.ok(
    estado.warnings.some((w) => /indispon/i.test(w)),
    'deve avisar que o WFS está indisponível'
  );
});

test('o status expõe a situação da atualização automática', async (t) => {
  const mock = await criarWfsSimulado([eixo(1)]);
  t.after(mock.close);
  const s = await servico(mock, {
    autoUpdate: { enabled: true, checkIntervalMs: 60000, deepCheckIntervalMs: 3600000 },
  });

  await s.ensureReady();
  const st = s.status();
  assert.equal(st.update.enabled, true);
  assert.equal(st.update.checkIntervalMs, 60000);
  assert.ok('lastCheckedAt' in st.update);
  assert.ok('lastChangeAt' in st.update);
});
