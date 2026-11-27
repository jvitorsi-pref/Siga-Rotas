/** Binding nativo para planejamento de visitas domiciliares ACS (DocumentPicker + FileSystem + SQLite). */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  exportarModeloPlanilhaMobileCore,
  selecionarELerPlanilhaMobileCore,
  carregarEstadoPlanejamentoMobile,
  salvarEstadoPlanejamentoMobile,
  limparEstadoPlanejamentoMobile,
  planejarVisitasPeriodo,
  sugerirVisitasProximasAoTrajeto,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
  PERIODOS_PLANEJAMENTO,
  STATUS_VISITA,
} from './planejamentoMobileServiceCore.js';

export {
  planejarVisitasPeriodo,
  sugerirVisitasProximasAoTrajeto,
  normalizarPeriodoPlanejamento,
  normalizarStatusVisita,
  PERIODOS_PLANEJAMENTO,
  STATUS_VISITA,
};

export function exportarModeloPlanilhaMobile(opcoes = {}) {
  return exportarModeloPlanilhaMobileCore({
    ...opcoes,
    fileSystem: opcoes.fileSystem ?? FileSystem,
  });
}

export function selecionarELerPlanilhaMobile(opcoes = {}) {
  return selecionarELerPlanilhaMobileCore({
    ...opcoes,
    documentPicker: opcoes.documentPicker ?? DocumentPicker,
    fileSystem: opcoes.fileSystem ?? FileSystem,
  });
}

export async function carregarPlanejamentoMobile(sqlite) {
  return carregarEstadoPlanejamentoMobile({
    sqlite,
    asyncStorage: AsyncStorage,
  });
}

export async function salvarPlanejamentoMobile({ pacientes, plano, periodo, sqlite }) {
  return salvarEstadoPlanejamentoMobile({
    pacientes,
    plano,
    periodo,
    sqlite,
    asyncStorage: AsyncStorage,
  });
}

export async function limparPlanejamentoMobile(sqlite) {
  return limparEstadoPlanejamentoMobile({
    sqlite,
    asyncStorage: AsyncStorage,
  });
}
