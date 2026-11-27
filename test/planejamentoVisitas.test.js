import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { zipSync, strToU8 } from '../planejamento/vendor/fflate.mjs';

import {
  STATUS_VISITA,
  criarPeriodoPlanejamento,
  parseDataFlexivel,
} from '../planejamento/modeloVisitas.js';
import {
  gerarModeloXlsxBuffer,
  parseXlsxBuffer,
} from '../planejamento/xlsxCodec.js';
import {
  confirmarImportacaoPlanilha,
  prepararImportacaoPlanilha,
} from '../planejamento/importadorExcel.js';
import {
  atualizarStatusVisita,
  converterVisitaParaPontoTrajeto,
  criarMotorPrioridadeVisitas,
  organizarCronogramaVisitas,
  precomputarProximidades,
  sugerirVisitasOportunisticas,
} from '../planejamento/planejamentoVisitas.js';

import * as modeloApk from '../APK/src/planejamento/modeloVisitas.js';
import * as xlsxApk from '../APK/src/planejamento/xlsxCodec.js';
import * as impApk from '../APK/src/planejamento/importadorExcel.js';
import * as planApk from '../APK/src/planejamento/planejamentoVisitas.js';

import { buildGraph } from '../core/graph.js';
import { CodificarCurto, ResolverEnderecoDigital } from '../core/enderecoDigital.js';
import { createServer } from '../server/index.js';
import { criarDriverSqliteCore } from '../APK/src/services/armazenamentoSqliteCore.js';
import { loadRealFeatures } from './helpers.js';

function criarXlsxSimplesTeste(linhas, { sheetName = 'Visitas' } = {}) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const col = (i) => {
    let n = i + 1;
    let out = '';
    while (n > 0) {
      out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const shared = [];
  const sharedIdx = new Map();
  const intern = (txt) => {
    const k = String(txt);
    if (!sharedIdx.has(k)) {
      sharedIdx.set(k, shared.length);
      shared.push(k);
    }
    return sharedIdx.get(k);
  };

  const rowsXml = linhas
    .map((cells, r) => {
      const rNum = r + 1;
      const cs = cells
        .map((val, c) => {
          if (val === undefined || val === null || val === '') return '';
          const ref = `${col(c)}${rNum}`;
          if (typeof val === 'object' && val.excelDateSerial != null) {
            return `<c r="${ref}" s="1"><v>${val.excelDateSerial}</v></c>`;
          }
          if (typeof val === 'number') {
            return `<c r="${ref}"><v>${val}</v></c>`;
          }
          return `<c r="${ref}" t="s"><v>${intern(val)}</v></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rNum}">${cs}</row>`;
    })
    .join('');

  const sharedXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('') +
    '</sst>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>' +
    '</styleSheet>';

  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(sharedXml),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
    ),
  });
}

test('APK compartilha exatamente os módulos de planejamento da raiz', () => {
  assert.equal(modeloApk.STATUS_VISITA, STATUS_VISITA);
  assert.equal(xlsxApk.parseXlsxBuffer, parseXlsxBuffer);
  assert.equal(impApk.prepararImportacaoPlanilha, prepararImportacaoPlanilha);
  assert.equal(planApk.sugerirVisitasOportunisticas, sugerirVisitasOportunisticas);
});

test('xlsxCodec gera modelo válido sem dados reais de pacientes e lê sharedStrings + datas Excel', () => {
  const modeloBytes = gerarModeloXlsxBuffer();
  const parsedModelo = parseXlsxBuffer(modeloBytes);
  assert.equal(parsedModelo.ok, true);
  assert.equal(parsedModelo.sheets[0].name, 'Cronograma');
  assert.equal(parsedModelo.sheets[0].rows.length, 0);
  assert.ok(parsedModelo.sheets[0].headers.includes('endereco_digital'));

  // Rejeita arquivo corrompido ou formato legado .xls com erro claro
  const invalido = parseXlsxBuffer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, ...new Array(40).fill(0)]));
  assert.equal(invalido.ok, false);
  assert.equal(invalido.reason, 'FORMATO_XLS_LEGADO');

  const corrompido = parseXlsxBuffer(new Uint8Array([1, 2, 3, 4]));
  assert.equal(corrompido.ok, false);

  // Leitura com sharedStrings + data serial Excel (46346 -> 2026-11-20)
  assert.equal(parseDataFlexivel(46346), '2026-11-20');
  assert.equal(parseDataFlexivel('25/11/2026'), '2026-11-25');
});

test('Importador .xlsx valida erros por linha, integra CEP Digital, deduplica e preserva visitas concluídas', () => {
  const plusA = CodificarCurto(-23.6639, -46.5318);
  const plusB = CodificarCurto(-23.6645, -46.5311);
  const plusC = CodificarCurto(-23.6652, -46.5303);

  const bytes = criarXlsxSimplesTeste([
    [
      'ID Paciente',
      'Nome Completo',
      'CEP Digital',
      'Latitude',
      'Longitude',
      'Data Prevista',
      'Última Visita',
      'Prioridade',
      'Planejada',
      'Observações',
    ],
    ['EXEMPLO-SUBSTITUIR', 'Paciente Exemplo', plusA, '', '', '2026-11-20', '', 'alta', 'SIM', ''],
    ['P-01', 'Cadastro Teste 01', plusA, '', '', { excelDateSerial: 46346 }, '01/10/2026', 'alta', 'SIM', 'Manhã'],
    ['P-01', 'Cadastro Teste 01', plusA, '', '', '2026-11-20', '', 'alta', 'SIM', 'Duplicado na planilha'],
    ['P-02', 'Cadastro Teste 02', '', -23.6645, -46.5311, '22/11/2026', '', 'media', 'NAO', 'Base territorial próxima'],
    ['P-03', 'Cadastro Inválido', 'CODIGO-RUIM', '', '', '22/11/2026', '', 'baixa', 'SIM', ''],
    ['P-04', 'Cadastro Teste 04', plusC, '', '', '15/12/2026', '2026-09-10', 'baixa', 'SIM', 'Fora da janela de 14 dias'],
  ]);

  const agora = Date.UTC(2026, 10, 16, 12, 0, 0);
  const preview = prepararImportacaoPlanilha({
    bytes,
    periodo: { tipo: 'dias', quantidadeDias: 14, dataInicio: '2026-11-16' },
    agora,
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.resumo.validas, 3); // P-01, P-02, P-04 (EXEMPLO ignorado, P-01 dup mesclado, P-03 erro)
  assert.equal(preview.resumo.comErro, 1);
  assert.equal(preview.resumo.duplicadasNaPlanilha, 1);
  assert.equal(preview.resumo.visitasPlanejadas, 2);
  assert.equal(preview.resumo.baseTerritorial, 1);
  assert.match(preview.erros[0].mensagem, /P-03|Cadastro Inválido/);

  // P-02 veio por coordenadas e gerou Endereço Digital pelo algoritmo oficial
  const p2 = preview.itensValidados.find((i) => i.idPaciente === 'P-02');
  assert.ok(p2.enderecoDigital);
  assert.equal(ResolverEnderecoDigital(plusB).ok, true);

  const conf = confirmarImportacaoPlanilha(preview, { agora });
  assert.equal(conf.ok, true);
  assert.equal(conf.totalVisitas, 3);

  // Marca P-01 como realizada e reimporta a mesma planilha: P-01 não duplica e mantém status realizada
  const vis1 = conf.plano.visitas.find((v) => v.idPaciente === 'P-01');
  const planoAposVisita = atualizarStatusVisita(conf.plano, vis1.id, STATUS_VISITA.REALIZADA, { agora });
  const previewReimport = prepararImportacaoPlanilha({
    bytes,
    pacientesExistentes: planoAposVisita.pacientes,
    visitasExistentes: planoAposVisita.visitas,
    agora,
  });
  assert.equal(previewReimport.resumo.atualizacoesExistentes, 3);
  const reimport = confirmarImportacaoPlanilha(previewReimport, {
    planoExistente: planoAposVisita,
    agora,
  });
  assert.equal(reimport.totalVisitas, 3);
  assert.equal(
    reimport.plano.visitas.find((v) => v.idPaciente === 'P-01').status,
    STATUS_VISITA.REALIZADA,
  );
});

test('Planejamento Inteligente: período configurável, pre-batching, sugestões oportunísticas (nunca auto-inseridas) e gancho clínico futuro', () => {
  const features = loadRealFeatures();
  const realGraph = buildGraph(features);

  const bytes = criarXlsxSimplesTeste([
    ['id_paciente', 'nome_paciente', 'latitude', 'longitude', 'data_prevista', 'ultima_visita', 'prioridade', 'planejada'],
    ['PAC-1', 'Domicílio A', -23.6639, -46.5318, '2026-11-16', '2026-09-01', 'alta', 'SIM'],
    ['PAC-2', 'Domicílio B (próximo)', -23.6644, -46.5312, '2026-11-28', '2026-08-15', 'media', 'NAO'],
    ['PAC-3', 'Domicílio C (sem última visita)', -23.6648, -46.5308, '2026-11-18', '', 'baixa', 'NAO'],
    ['PAC-4', 'Domicílio D (distante)', -23.7050, -46.4950, '2026-12-20', '2026-10-20', 'media', 'SIM'],
  ]);

  const agora = Date.UTC(2026, 10, 16, 10, 0, 0);
  const periodo14 = criarPeriodoPlanejamento({ tipo: 'dias', quantidadeDias: 14, dataInicio: '2026-11-16' }, agora);
  const preview = prepararImportacaoPlanilha({ bytes, periodo: periodo14, agora });
  const { plano } = confirmarImportacaoPlanilha(preview, { agora });

  const org = organizarCronogramaVisitas(plano, { periodo: periodo14, agora });
  assert.equal(org.criteriosClinicosAtivos, false);
  assert.equal(org.planejadasNoPeriodo.length, 1); // PAC-1
  assert.equal(org.planejadasForaPeriodo.length, 1); // PAC-4 (2026-12-20)
  assert.equal(org.baseTerritorial.length, 2); // PAC-2 e PAC-3

  // Quando muda período para 45 dias, PAC-4 entra no período configurável
  const periodo45 = criarPeriodoPlanejamento({ tipo: 'dias', quantidadeDias: 45, dataInicio: '2026-11-16' }, agora);
  const org45 = organizarCronogramaVisitas(plano, { periodo: periodo45, agora });
  assert.equal(org45.planejadasNoPeriodo.length, 2);

  // Marca PAC-1 como NÃO REALIZADA (ausente) e verifica sugestões oportunísticas na malha real
  const vis1 = plano.visitas.find((v) => v.idPaciente === 'PAC-1');
  const planoAusente = atualizarStatusVisita(plano, vis1.id, STATUS_VISITA.NAO_REALIZADA, { agora });

  const preBatch = precomputarProximidades(plano, { raioMetros: 400, graph: realGraph, agora });
  assert.ok(Array.isArray(preBatch[vis1.id]));

  const rotaOriginal = [converterVisitaParaPontoTrajeto(vis1, 'B')];
  const sugestoes = sugerirVisitasOportunisticas(planoAusente, {
    visitaNaoRealizada: vis1,
    rotaAtiva: rotaOriginal,
    raioMetros: 500,
    graph: realGraph,
    agora,
  });

  // PAC-2 e PAC-3 são sugeridos, PAC-4 (longe) não entra, e rotaOriginal NÃO foi mutada!
  assert.equal(rotaOriginal.length, 1);
  assert.ok(sugestoes.some((s) => s.visita.idPaciente === 'PAC-2'));
  assert.ok(sugestoes.some((s) => s.visita.idPaciente === 'PAC-3'));
  assert.equal(sugestoes.some((s) => s.visita.idPaciente === 'PAC-4'), false);

  const sugSemData = sugestoes.find((s) => s.visita.idPaciente === 'PAC-3');
  assert.ok(sugSemData.lacunasDados.some((m) => /última visita não informada/i.test(m)));

  // Gancho de extensão clínica futura funciona sem inventar pesos por padrão
  const motorDefault = createMotor();
  assert.equal(motorDefault.criteriosClinicosAtivos, false);
  const motorComPlugin = criarMotorPrioridadeVisitas({
    avaliadorClinico: {
      id: 'plugin_teste',
      rotulo: 'Regra oficial simulada em teste',
      avaliar: (v) =>
        v.idPaciente === 'PAC-3'
          ? { ajustePontuacao: 50, etiquetas: ['Prioridade plugin'], motivo: 'Etiqueta externa' }
          : { ajustePontuacao: 0 },
    },
  });
  assert.equal(motorComPlugin.criteriosClinicosAtivos, true);
  const avalPlugin = motorComPlugin.avaliar(sugSemData.visita, { agora });
  assert.ok(avalPlugin.etiquetasClinicas.includes('Prioridade plugin'));
});

function createMotor() {
  return criarMotorPrioridadeVisitas();
}

test('SQLite real persiste plano de visitas + pacientes e servidor serve /planejamento/*.js', async (t) => {
  const driver = criarDriverSqliteCore({
    sqlite: {
      async openDatabaseAsync(filename) {
        const db = new DatabaseSync(filename);
        const api = {
          execAsync: async (sql) => db.exec(sql),
          runAsync: async (sql, params = []) => {
            const info = db.prepare(sql).run(...params);
            return { changes: Number(info?.changes ?? 0) };
          },
          getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
          getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
          withExclusiveTransactionAsync: async (fn) => {
            db.exec('BEGIN IMMEDIATE');
            try {
              const r = await fn(api);
              db.exec('COMMIT');
              return r;
            } catch (e) {
              db.exec('ROLLBACK');
              throw e;
            }
          },
          closeAsync: async () => db.close(),
        };
        return api;
      },
    },
    nomeBanco: ':memory:',
  });
  await driver.init();

  const bytes = criarXlsxSimplesTeste([
    ['id_paciente', 'nome_paciente', 'endereco_digital'],
    ['SQL-1', 'Paciente SQLite', CodificarCurto(-23.6639, -46.5318)],
  ]);
  const preview = prepararImportacaoPlanilha({ bytes });
  const { plano } = confirmarImportacaoPlanilha(preview);
  await driver.savePlanoVisitas(plano);
  const lido = await driver.getPlanoVisitas();
  assert.equal(lido.visitas.length, 1);
  assert.equal(lido.pacientes[0].nome, 'Paciente SQLite');
  await driver.clearPlanoVisitas();
  assert.equal(await driver.getPlanoVisitas(), null);
  await driver.close();

  const srv = createServer({
    service: {
      options: { autoUpdate: { enabled: false }, layerName: 'teste' },
      update: {},
      status: () => ({ ready: true, source: 'snapshot' }),
      ensureReady: async () => ({ graph: { diagnostics: {} }, features: [], diagnostics: {} }),
    },
  });
  t.after(() => new Promise((r) => srv.close(r)));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  for (const mod of ['modeloVisitas.js', 'xlsxCodec.js', 'importadorExcel.js', 'planejamentoVisitas.js', 'vendor/fflate.mjs']) {
    const resp = await fetch(`http://127.0.0.1:${port}/planejamento/${mod}`);
    assert.equal(resp.status, 200, `/planejamento/${mod} deve estar acessível`);
  }
});
