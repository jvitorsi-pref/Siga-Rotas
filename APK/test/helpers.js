/**
 * UtilitÃ¡rios compartilhados pelos testes.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/**
 * Carrega o snapshot real da rede (4119 eixos) baixado do GeoServer.
 * Os testes de integraÃ§Ã£o usam a rede verdadeira; os testes unitÃ¡rios usam
 * redes sintÃ©ticas, para serem determinÃ­sticos.
 */
export function loadRealFeatures() {
  const p = path.join(ROOT, 'src', 'data', 'network.snapshot.json');
  if (!existsSync(p)) {
    throw new Error(
      `Snapshot da rede ausente em ${p}. ` +
      'Execute "npm run fetch" para baixÃ¡-lo do GeoServer.'
    );
  }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(raw) ? raw : raw.features;
}

/**
 * Cria uma feature GeoJSON a partir de atributos e coordenadas.
 *
 * @param {object} props atributos (ID Ã© obrigatÃ³rio)
 * @param {Array<Array<number>>} coords [[lon,lat], ...]
 * @param {string} [geometryType] 'LineString' (padrÃ£o) ou 'MultiLineString'
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

/** Atributos mÃ­nimos de um logradouro oficial. */
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

/** Atributos de um logradouro nÃ£o oficializado. */
export function unofficial(id, name = 'RUA NÃƒO OFICIALIZADA') {
  return {
    ID: id,
    COD_LOG: 0,
    TPO_LOGRADOURO: 'RUA',
    COD_TITULO_LOGRADOURO: null,
    NOM_LOGRADOURO: 'NÃƒO OFICIALIZADA',
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

