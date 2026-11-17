/** Persistência nativa da camada base no AsyncStorage do Android APK. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  lerPreferenciaCamadaAsync,
  salvarPreferenciaCamadaAsync,
} from '../map/camadaBase.js';

export function carregarCamadaBaseMobile(storage = AsyncStorage) {
  return lerPreferenciaCamadaAsync(storage);
}

export function salvarCamadaBaseMobile(modo, storage = AsyncStorage) {
  return salvarPreferenciaCamadaAsync(modo, storage);
}
