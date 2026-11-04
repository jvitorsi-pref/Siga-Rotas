/**
 * Utilitários compartilhados pelos testes.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/**
 * Carrega o snapshot real da rede (4119 eixos) baixado do GeoServer.
 * Os testes de integração usam a rede verdadeira; os testes unitários usam
 * redes sintéticas, para serem determinísticos.
 */
export function loadRealFeatures() {
  const p = path.join(ROOT, 'data', 'network.snapshot.json');
  if (!existsSync(p)) {
    throw new Error(
      `Snapshot da rede ausente em ${p}. ` +
      'Execute "npm run fetch" para baixá-lo do GeoServer.'
    );
  }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(raw) ? raw : raw.features;
}

/**
 * Cria uma feature GeoJSON a partir de atributos e coordenadas.
 *
 * @param {object} props atributos (ID é obrigatório)
 * @param {Array<Array<number>>} coords [[lon,lat], ...]
 * @param {string} [geometryType] 'LineString' (padrão) ou 'MultiLineString'
 */
export function feature(props, coords, geometryType = 'LineString') {
  return {
    type: 'Feature',
    id: String(props.ID),
    properties: props,
    geometry: {
      type: geometryType,
      // LineString: coords = [[lon,lat], ...]
      // MultiLineString: coords = [[[lon,lat], ...], ...]
      coordinates: coords,
    },
  };
}

/** Atributos mínimos de um logradouro oficial. */
export function official(id, name = 'RUA DE TESTE') {
  return {
    ID: id,
    COD_LOG: 1000 + id,
    TPO_LOGRADOURO: 'RUA',
    COD_TITULO_LOGRADOURO: null,
    NOM_LOGRADOURO: name,
    DSC_LOGRADOURO: name,
  };
}

/** Atributos de um logradouro não oficializado. */
export function unofficial(id, name = 'RUA NÃO OFICIALIZADA') {
  return {
    ID: id,
    COD_LOG: 0,
    TPO_LOGRADOURO: 'RUA',
    COD_TITULO_LOGRADOURO: null,
    NOM_LOGRADOURO: 'NÃO OFICIALIZADA',
    DSC_LOGRADOURO: name,
  };
}

/** Atributos de uma rodovia (usada para testar recusa de cruzamento). */
export function road(id, name = 'RODOVIA DE TESTE') {
  return {
    ID: id,
    COD_LOG: 3000 + id,
    TPO_LOGRADOURO: 'ROD',
    COD_TITULO_LOGRADOURO: null,
    NOM_LOGRADOURO: name,
    DSC_LOGRADOURO: name,
  };
}

/** Converte lon/lat "somados" (deslocados de uma origem) em coordenadas. */
export function offset(baseLon, baseLat, dLon, dLat) {
  return [baseLon + dLon, baseLat + dLat];
}
