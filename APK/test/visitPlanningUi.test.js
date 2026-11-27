import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COLORS } from '../src/theme/colors.js';
import * as modeloVisitas from '../src/planejamento/modeloVisitas.js';
import { parseXlsxBuffer } from '../src/planejamento/xlsxCodec.js';
import { strToU8, zipSync } from '../../planejamento/vendor/fflate.mjs';
import { bytesParaBase64 } from '../src/utils/zip.js';
import {
  base64ParaBytes,
  carregarEstadoPlanejamentoMobile,
  exportarModeloPlanilhaMobileCore,
  limparEstadoPlanejamentoMobile,
  salvarEstadoPlanejamentoMobile,
  selecionarELerPlanilhaMobileCore,
} from '../src/services/planejamentoMobileServiceCore.js';

const require = createRequire(new URL('../package.json', import.meta.url));
function loadComponent(relPath, deps) {
  const code = require('@babel/core').transformSync(
    readFileSync(new URL(relPath, import.meta.url), 'utf8'),
    {
      babelrc: false,
      configFile: false,
      plugins: [
        require.resolve('@babel/plugin-transform-react-jsx'),
        require.resolve('@babel/plugin-transform-modules-commonjs'),
      ],
    },
  ).code;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((n) => deps[n], mod, mod.exports);
  return mod.exports;
}

function makeFakeReact() {
  const slots = [];
  let idx = 0;
  return {
    reset() { idx = 0; },
    React: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: (init) => {
        const i = idx++;
        if (!(i in slots)) slots[i] = init;
        return [slots[i], (fn) => { slots[i] = typeof fn === 'function' ? fn(slots[i]) : fn; }];
      },
    },
  };
}

function collectText(node) {
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? collectText(node.props?.children) : String(node);
}
function criarPlanilhaTesteXlsx(linhas) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i) => String.fromCharCode(65 + i);
  const rows = linhas
    .map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => (v == null ? '' : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).filter(Boolean).join('')}</row>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cronograma" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`),
  });
}
function collectNodes(node, out = []) {
  if (Array.isArray(node)) node.forEach((c) => collectNodes(c, out));
  else if (node && typeof node === 'object') { out.push(node); collectNodes(node.props?.children, out); }
  return out;
}

test('base64ParaBytes, exportarModeloPlanilhaMobileCore e selecionarELerPlanilhaMobileCore fazem roundtrip .xlsx', async () => {
  const amostraXlsx = criarPlanilhaTesteXlsx([
    ['id_paciente', 'nome_paciente', 'latitude', 'longitude', 'prioridade', 'planejada'],
    ['P01', 'Maria Teste', '-23.6639', '-46.5318', 'alta', 'SIM'],
    ['P02', 'José Teste', '-23.6645', '-46.5322', 'media', 'NAO'],
  ]);
  const b64 = bytesParaBase64(amostraXlsx);
  assert.deepEqual(base64ParaBytes(b64), amostraXlsx);

  let escrito = null;
  const fs = {
    EncodingType: { Base64: 'base64' },
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: async () => ({ granted: true, directoryUri: 'content://tree/primary:Download' }),
      createFileAsync: async (_dir, nome) => `content://file/${nome}`,
    },
    writeAsStringAsync: async (uri, data) => { escrito = { uri, data }; },
    readAsStringAsync: async () => b64,
  };
  const exp = await exportarModeloPlanilhaMobileCore({ fileSystem: fs });
  assert.equal(exp.ok, true);
  assert.equal(exp.arquivo, 'modelo-visitas-siga.xlsx');
  const parsedModelo = parseXlsxBuffer(base64ParaBytes(escrito.data));
  assert.equal(parsedModelo.ok, true);
  assert.ok(parsedModelo.sheets[0].headers.includes('nome_paciente'));

  const imp = await selecionarELerPlanilhaMobileCore({
    fileSystem: fs,
    documentPicker: {
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [{ uri: 'content://file/visitas.xlsx', name: 'visitas.xlsx' }],
      }),
    },
  });
  assert.equal(imp.ok, true);
  assert.equal(imp.preview.registros.length, 2);

  const formatoRuim = await selecionarELerPlanilhaMobileCore({
    fileSystem: fs,
    documentPicker: {
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [{ uri: 'file://a.txt', name: 'lista.txt' }],
      }),
    },
  });
  assert.equal(formatoRuim.ok, false);
  assert.equal(formatoRuim.motivo, 'FORMATO_INVALIDO');
});

test('planejamentoMobileServiceCore persiste e limpa no SQLite com fallback em AsyncStorage', async () => {
  let storedSqlite = null;
  const sqlite = {
    savePlanoVisitas: async (p) => { storedSqlite = p; return { ok: true }; },
    getPlanoVisitas: async () => storedSqlite,
    clearPlanoVisitas: async () => { storedSqlite = null; },
  };
  const map = new Map();
  const asyncStorage = {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => map.set(k, v),
    removeItem: async (k) => map.delete(k),
  };

  await salvarEstadoPlanejamentoMobile({
    pacientes: [{ id: 'pac-1', nome: 'Dona Clara' }],
    plano: { periodo: 'mensal', visitas: [{ id: 'vis-1', nome: 'Dona Clara', status: 'planejada' }] },
    periodo: 'mensal',
    sqlite,
    asyncStorage,
  });

  const lido = await carregarEstadoPlanejamentoMobile({ sqlite, asyncStorage });
  assert.equal(lido.pacientes.length, 1);
  assert.equal(lido.periodo, 'mensal');

  await limparEstadoPlanejamentoMobile({ sqlite, asyncStorage });
  const apos = await carregarEstadoPlanejamentoMobile({ sqlite, asyncStorage });
  assert.equal(apos.pacientes.length, 0);
});

test('VisitPlanningSection e ImportScheduleModal renderizam período, sugestões oportunísticas e pré-visualização', () => {
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'Modal', 'ScrollView'].map((n) => [n, n]));
  native.StyleSheet = { create: (s) => s };

  const fr = makeFakeReact();
  const { VisitPlanningSection } = loadComponent('../src/components/VisitPlanningSection.js', {
    react: fr.React,
    'react-native': native,
    '../theme/colors': { COLORS },
    '../planejamento/modeloVisitas.js': modeloVisitas,
  });

  const props = {
    pacientes: [{ id: 'p1', nome: 'Maria', latitude: -23.66, longitude: -46.53 }],
    periodo: 'semanal',
    plano: {
      visitas: [
        {
          id: 'v1',
          pacienteId: 'p1',
          nome: 'Maria',
          latitude: -23.66,
          longitude: -46.53,
          status: 'planejada',
          pontuacaoPrioridade: 88,
          motivosPrioridade: ['Prioridade alta'],
        },
      ],
    },
    sugestoesProximas: [
      {
        id: 'sug-1',
        pacienteId: 'p2',
        nome: 'José',
        latitude: -23.661,
        longitude: -46.531,
        status: 'oportunistica_sugerida',
        distanciaTrajetoMetros: 85,
        pontuacaoPrioridade: 70,
      },
    ],
    onAddVisitToRoute: () => {},
  };

  let tree = VisitPlanningSection(props);
  let nodes = collectNodes(tree);
  nodes.find((n) => n.type === 'TouchableOpacity' && collectText(n).includes('Planejamento')).props.onPress();
  fr.reset();
  tree = VisitPlanningSection(props);
  const txt = collectText(tree);
  assert.match(txt, /Diário/);
  assert.match(txt, /Semanal/);
  assert.match(txt, /Mensal/);
  assert.match(txt, /Importar planilha/);
  assert.match(txt, /Sugestão oportunística/);
  assert.match(txt, /José/);
  assert.match(txt, /✓ Realizada/);
  assert.match(txt, /priorização clínica configurável|critérios clínicos oficiais/i);

  const frModal = makeFakeReact();
  const { ImportScheduleModal } = loadComponent('../src/components/ImportScheduleModal.js', {
    react: frModal.React,
    'react-native': native,
    '../theme/colors': { COLORS },
  });
  const confirmados = [];
  const modalTree = ImportScheduleModal({
    visible: true,
    arquivo: 'area04.xlsx',
    preview: {
      registros: [{ id: 'p1', nome: 'Maria', latitude: -23.66, longitude: -46.53, prioridadeLabel: 'Alta', enderecoDigital: '3H28+8R', frequenciaAlvo: 'No cronograma' }],
      duplicadosIgnorados: [{ linha: 3 }],
      erros: [],
      avisos: [],
    },
    onConfirm: (payload) => confirmados.push(payload),
  });
  assert.match(collectText(modalTree), /Pré-visualização da importação/);
  assert.match(collectText(modalTree), /area04\.xlsx/);
  const btnConfirmar = collectNodes(modalTree).find((n) => n.type === 'TouchableOpacity' && collectText(n).includes('Confirmar (1)'));
  btnConfirmar.props.onPress();
  assert.equal(confirmados[0].registros.length, 1);
  assert.equal(confirmados[0].substituir, false);
});
