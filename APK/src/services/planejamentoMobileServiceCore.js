import {
  PERIODOS_PLANEJAMENTO,
  STATUS_VISITA,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
} from '../planejamento/modeloVisitas.js';
import { gerarModeloPlanilhaVisitasXlsx } from '../planejamento/xlsxCodec.js';
import { importarPlanilhaVisitas } from '../planejamento/importadorExcel.js';
import {
  planejarVisitasPeriodo,
  sugerirVisitasProximasAoTrajeto,
} from '../planejamento/planejamentoVisitas.js';
import { bytesParaBase64 } from '../utils/zip.js';
import { descreverPastaSaf } from './mobileGpxExportCore.js';

export const CHAVE_ASYNC_PLANEJAMENTO = '@siga_rotas_planejamento_visitas_v1';

const BASE64_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ParaBytes(base64) {
  const limpo = String(base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!limpo) return new Uint8Array(0);
  const pad = limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0;
  const totalBytes = Math.floor((limpo.length * 3) / 4) - pad;
  const out = new Uint8Array(Math.max(0, totalBytes));
  const rev = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALFABETO.length; i += 1) {
    rev[BASE64_ALFABETO.charCodeAt(i)] = i;
  }
  let o = 0;
  for (let i = 0; i < limpo.length; i += 4) {
    const a = rev[limpo.charCodeAt(i)] ?? 0;
    const b = rev[limpo.charCodeAt(i + 1)] ?? 0;
    const c = rev[limpo.charCodeAt(i + 2)];
    const d = rev[limpo.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | ((c >= 0 ? c : 0) << 6) | (d >= 0 ? d : 0);
    if (o < totalBytes) out[o++] = (n >> 16) & 0xff;
    if (c >= 0 && o < totalBytes) out[o++] = (n >> 8) & 0xff;
    if (d >= 0 && o < totalBytes) out[o++] = n & 0xff;
  }
  return out;
}

export async function exportarModeloPlanilhaMobileCore(opcoes = {}) {
  const fs = opcoes.fileSystem;
  const saf = fs?.StorageAccessFramework;
  const nomeArquivo = 'modelo-visitas-siga.xlsx';
  const bytes = gerarModeloPlanilhaVisitasXlsx();

  if (!saf?.requestDirectoryPermissionsAsync || !saf?.createFileAsync || !fs?.writeAsStringAsync) {
    return {
      ok: false,
      motivo: 'INDISPONIVEL',
      mensagem: 'Seletor nativo de pastas (SAF) indisponível neste dispositivo.',
    };
  }

  let perm;
  try {
    perm = await saf.requestDirectoryPermissionsAsync(opcoes.initialFileUrl ?? null);
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_PERMISSAO',
      mensagem: `Não foi possível abrir o seletor de pastas: ${err?.message || err}`,
    };
  }
  if (!perm?.granted || !perm?.directoryUri) {
    return {
      ok: false,
      cancelado: true,
      motivo: 'CANCELADO',
      mensagem: 'Download do modelo cancelado.',
    };
  }

  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let fileUri = null;
  try {
    try {
      fileUri = await saf.createFileAsync(perm.directoryUri, nomeArquivo, mime);
    } catch {
      fileUri = await saf.createFileAsync(perm.directoryUri, nomeArquivo, 'application/octet-stream');
    }
    const encoding = fs.EncodingType?.Base64 ?? 'base64';
    await fs.writeAsStringAsync(fileUri, bytesParaBase64(bytes), { encoding });
    const pasta = descreverPastaSaf(perm.directoryUri);
    return {
      ok: true,
      arquivo: nomeArquivo,
      pasta,
      fileUri,
      mensagem: `Modelo ${nomeArquivo} salvo em "${pasta}".`,
    };
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_GRAVACAO',
      mensagem: `Não foi possível salvar a planilha modelo: ${err?.message || err}`,
    };
  }
}

export async function selecionarELerPlanilhaMobileCore(opcoes = {}) {
  const picker = opcoes.documentPicker;
  const fs = opcoes.fileSystem;
  if (!picker?.getDocumentAsync || !fs?.readAsStringAsync) {
    return {
      ok: false,
      motivo: 'INDISPONIVEL',
      mensagem: 'Seletor de arquivos indisponível neste dispositivo.',
    };
  }

  let resultado;
  try {
    resultado = await picker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        '*/*',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_SELECAO',
      mensagem: `Não foi possível abrir o seletor de arquivos: ${err?.message || err}`,
    };
  }

  if (resultado?.canceled || !resultado?.assets?.length) {
    return {
      ok: false,
      cancelado: true,
      motivo: 'CANCELADO',
      mensagem: 'Importação cancelada.',
    };
  }

  const asset = resultado.assets[0];
  const nomeArquivo = String(asset?.name || 'planilha.xlsx');
  if (!/\.xlsx?$/i.test(nomeArquivo)) {
    return {
      ok: false,
      motivo: 'FORMATO_INVALIDO',
      mensagem: `Selecione uma planilha Excel (.xlsx). Arquivo escolhido: ${nomeArquivo}.`,
    };
  }

  try {
    const encoding = fs.EncodingType?.Base64 ?? 'base64';
    const b64 = await fs.readAsStringAsync(asset.uri, { encoding });
    const bytes = base64ParaBytes(b64);
    const preview = importarPlanilhaVisitas(bytes, { origemArquivo: nomeArquivo });
    return {
      ok: true,
      arquivo: nomeArquivo,
      preview,
    };
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERRO_LEITURA',
      mensagem: `Não foi possível ler o arquivo ${nomeArquivo}: ${err?.message || err}`,
    };
  }
}

export async function carregarEstadoPlanejamentoMobile({ sqlite, asyncStorage } = {}) {
  try {
    if (sqlite?.getPlanoVisitas) {
      const registro = await sqlite.getPlanoVisitas();
      if (registro && Array.isArray(registro.pacientes)) {
        return {
          pacientes: registro.pacientes,
          plano: registro.plano || null,
          periodo: normalizarPeriodoPlanejamento(registro.plano?.periodo || 'semanal'),
        };
      }
    }
  } catch {
    /* fallback abaixo */
  }
  try {
    if (asyncStorage?.getItem) {
      const bruto = await asyncStorage.getItem(CHAVE_ASYNC_PLANEJAMENTO);
      if (bruto) {
        const parsed = JSON.parse(bruto);
        if (parsed && Array.isArray(parsed.pacientes)) {
          return {
            pacientes: parsed.pacientes,
            plano: parsed.plano || null,
            periodo: normalizarPeriodoPlanejamento(parsed.periodo || parsed.plano?.periodo || 'semanal'),
          };
        }
      }
    }
  } catch {
    /* ignora JSON corrompido */
  }
  return {
    pacientes: [],
    plano: null,
    periodo: PERIODOS_PLANEJAMENTO.SEMANAL,
  };
}

export async function salvarEstadoPlanejamentoMobile({
  pacientes = [],
  plano = null,
  periodo = PERIODOS_PLANEJAMENTO.SEMANAL,
  sqlite,
  asyncStorage,
} = {}) {
  const payload = {
    pacientes: Array.isArray(pacientes) ? pacientes : [],
    plano: plano || null,
    periodo: normalizarPeriodoPlanejamento(periodo),
    atualizadoEm: new Date().toISOString(),
  };
  let persistidoSqlite = false;
  if (sqlite?.savePlanoVisitas) {
    try {
      await sqlite.savePlanoVisitas({
        plano: payload.plano,
        pacientes: payload.pacientes,
        visitas: Array.isArray(payload.plano?.visitas) ? payload.plano.visitas : [],
      });
      persistidoSqlite = true;
    } catch {
      persistidoSqlite = false;
    }
  }
  if (asyncStorage?.setItem) {
    try {
      await asyncStorage.setItem(CHAVE_ASYNC_PLANEJAMENTO, JSON.stringify(payload));
    } catch {
      /* mantém resultado */
    }
  }
  return { ok: true, persistidoSqlite, payload };
}

export async function limparEstadoPlanejamentoMobile({ sqlite, asyncStorage } = {}) {
  if (sqlite?.clearPlanoVisitas) {
    try {
      await sqlite.clearPlanoVisitas();
    } catch {
      /* ignora falha se SQLite não inicializado */
    }
  }
  if (asyncStorage?.removeItem) {
    try {
      await asyncStorage.removeItem(CHAVE_ASYNC_PLANEJAMENTO);
    } catch {
      /* ignora */
    }
  }
  return { ok: true };
}

export {
  planejarVisitasPeriodo,
  sugerirVisitasProximasAoTrajeto,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
  PERIODOS_PLANEJAMENTO,
  STATUS_VISITA,
};
