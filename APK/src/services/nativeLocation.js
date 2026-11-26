import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { criarFonteGPSNativa, TAREFA_GPS_SEGUNDO_PLANO } from './nativeGPS.js';

let receptorBackgroundAtivo = null;

// Deve ser definida no escopo global do módulo conforme exigência do expo-task-manager.
if (typeof TaskManager?.defineTask === 'function') {
  TaskManager.defineTask(TAREFA_GPS_SEGUNDO_PLANO, ({ data, error }) => {
    receptorBackgroundAtivo?.({ data, error });
  });
}

function registrarListenerBackground(fn) {
  receptorBackgroundAtivo = fn;
  return () => {
    if (receptorBackgroundAtivo === fn) receptorBackgroundAtivo = null;
  };
}

async function solicitarPermissaoNotificacao() {
  if (Platform?.OS !== 'android' || Number(Platform?.Version) < 33) return true;
  const permissao = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
  if (!permissao || typeof PermissionsAndroid?.check !== 'function') return true;
  try {
    const jaPermitida = await PermissionsAndroid.check(permissao);
    if (jaPermitida) return true;
    const resultado = await PermissionsAndroid.request(permissao);
    return resultado === PermissionsAndroid.RESULTS?.GRANTED;
  } catch {
    return false;
  }
}

// Nenhum acesso à localização acontece ao importar ou criar esta fábrica.
export const criarFonteGPSReal = handlers =>
  criarFonteGPSNativa({
    ...handlers,
    location: Location,
    taskManager: TaskManager,
    registrarListenerBackground,
    solicitarPermissaoNotificacao,
    appState: AppState,
  });
