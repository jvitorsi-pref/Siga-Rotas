import * as Location from 'expo-location';
import { obterLocalizacaoAtualCore } from './currentLocationCore.js';

export async function obterLocalizacaoAtual(options = {}) {
  return obterLocalizacaoAtualCore({
    location: options.location ?? Location,
    timeoutMs: options.timeoutMs,
  });
}
