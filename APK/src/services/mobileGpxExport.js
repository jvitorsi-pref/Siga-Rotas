/** Binding nativo do Android SAF (expo-file-system) para a exportação GPX. */
import * as FileSystem from 'expo-file-system';
import { exportarRotaGpxMobileCore, descreverPastaSaf } from './mobileGpxExportCore.js';

export { descreverPastaSaf };

export function exportarRotaGpxMobile(route, opcoes = {}) {
  return exportarRotaGpxMobileCore(route, {
    ...opcoes,
    fileSystem: opcoes.fileSystem ?? FileSystem,
  });
}
