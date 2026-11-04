/**
 * Utilidades geodésicas e de geometria planar.
 *
 * O motor trabalha internamente em coordenadas métricas (UTM 23S, EPSG:32723)
 * para que distâncias, interseções e projeções sejam calculadas com a
 * geometria real (plana) e não com aproximações sobre lon/lat.
 *
 * A projeção Transversal de Mercator (UTM) é implementada aqui a partir das
 * séries de Snyder (USGS Professional Paper 1395), o que evita qualquer
 * dependência externa e mantém erro posicional < 1 cm dentro da zona.
 */

import { METRIC_CRS } from './config.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// Elipsoide WGS84
const WGS84_A = 6378137.0; // semi-eixo maior (m)
const WGS84_F = 1 / 298.257223563; // achatamento
const WGS84_E2 = WGS84_F * (2 - WGS84_F); // primeira achatamento ao quadrado
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2); // segunda achatamento ao quadrado

/**
 * Converte longitude/latitude (graus, EPSG:4326) para coordenadas métricas
 * UTM 23S (EPSG:32723).
 *
 * @param {number} lon longitude em graus
 * @param {number} lat latitude em graus
 * @returns {[number, number]} [easting, northing] em metros
 */
export function project(lon, lat) {
  const phi = lat * D2R;
  const lam = lon * D2R;
  const lambda0 = METRIC_CRS.centralMeridian * D2R;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = WGS84_EP2 * cosPhi * cosPhi;
  const A = Math.cos(phi) * (lam - lambda0);

  // Meridiano de arco
  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * WGS84_E2 ** 3) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32 + (45 * WGS84_E2 ** 3) / 1024) *
        Math.sin(2 * phi) +
      ((15 * WGS84_E2 * WGS84_E2) / 256 + (45 * WGS84_E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * WGS84_E2 ** 3) / 3072) * Math.sin(6 * phi));

  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A3 * A;
  const A5 = A4 * A;
  const A6 = A5 * A;

  const x =
    METRIC_CRS.scaleFactor *
      N *
      (A +
        ((1 - T + C) * A3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * A5) / 120) +
    METRIC_CRS.falseEasting;

  let y =
    METRIC_CRS.scaleFactor *
      (M +
        N *
          tanPhi *
          (A2 / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * A6) / 720));

  // Hemisfério sul: deslocamento e sinal invertido
  if (lat < 0) {
    y += METRIC_CRS.falseNorthing;
  } else {
    y = METRIC_CRS.falseNorthing - y;
  }

  return [x, y];
}

/**
 * Converte coordenadas UTM 23S (metros) de volta para lon/lat (graus).
 *
 * @param {number} x easting (m)
 * @param {number} y northing (m)
 * @returns {[number, number]} [longitude, latitude]
 */
export function unproject(x, y) {
  const k0 = METRIC_CRS.scaleFactor;
  const lambda0 = METRIC_CRS.centralMeridian * D2R;

  const isSouth = METRIC_CRS.hemisphere === 'S';
  const yTmp = isSouth ? y - METRIC_CRS.falseNorthing : METRIC_CRS.falseNorthing - y;

  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
  const M = yTmp / k0;
  const mu = M / (WGS84_A * (1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * WGS84_E2 ** 3) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = WGS84_EP2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const N1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi1 * sinPhi1);
  const R1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi1 * sinPhi1, 1.5);
  const D = (x - METRIC_CRS.falseEasting) / (N1 * k0);

  const D2 = D * D;
  const D3 = D2 * D;
  const D4 = D3 * D;
  const D5 = D4 * D;
  const D6 = D5 * D;

  const phi =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * WGS84_EP2) * D4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * WGS84_EP2 - 3 * C1 * C1) * D6) / 720);

  const lambda =
    lambda0 +
    (D -
      ((1 + 2 * T1 + C1) * D3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * WGS84_EP2 + 24 * T1 * T1) * D5) / 120) /
      cosPhi1;

  return [lambda * R2D, phi * R2D];
}

/**
 * Distância euclidiana entre dois pontos métricos.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 */
export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distância entre dois pontos em lon/lat usando a fórmula de Haversine.
 * Usada apenas para textos/logs (a distância de rota usa a projeção métrica).
 */
export function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Projeta um ponto P sobre o segmento AB.
 *
 * @param {number} px @param {number} py
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 * @returns {{x:number, y:number, t:number, dist:number, clamped:boolean}}
 *   `t` é o parâmetro 0..1 ao longo de AB; `clamped` indica que a projeção
 *   ficou fora do segmento (foi usada a extremidade mais próxima).
 */
export function projectPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  }
  const clamped = t < 0 || t > 1;
  if (clamped) t = t < 0 ? 0 : 1;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { x, y, t, dist: dist(px, py, x, y), clamped };
}

/**
 * Distância de um ponto ao segmento AB (sem ponto projetado).
 */
export function distancePointToSegment(px, py, ax, ay, bx, by) {
  return projectPointOnSegment(px, py, ax, ay, bx, by).dist;
}

/**
 * Testa se o ponto C está sobre o segmento AB, dentro de `eps` (metros).
 * Usado para classificar interseções do tipo "extremidade sobre o eixo".
 */
export function pointOnSegment(px, py, ax, ay, bx, by, eps) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, ax, ay) <= eps;
  const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < -1e-12 || t > 1 + 1e-12) return false;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return dist(px, py, projX, projY) <= eps;
}

/**
 * Teste de orientação (produto vetorial) com sinal.
 * @returns {number} >0 esquerda, <0 direita, 0 colinear
 */
export function cross(ox, oy, ax, ay, bx, by) {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/**
 * Calcula o ponto de interseção entre os segmentos AB e CD.
 * Assume cruzamento proper (não colinear).
 * @returns {[number, number]} ponto de interseção
 */
export function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax;
  const r2 = by - ay;
  const s1 = dx - cx;
  const s2 = dy - cy;
  const denom = r1 * s2 - r2 * s1;
  if (denom === 0) return null;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / denom;
  return [ax + t * r1, ay + t * r2];
}

/**
 * Comprimento métrico de uma polilinha.
 * @param {ArrayLike<number>} xy coordenadas (x,y) intercaladas
 */
export function polylineLength(xy) {
  let total = 0;
  for (let i = 2; i < xy.length; i += 2) {
    total += dist(xy[i - 2], xy[i - 1], xy[i], xy[i + 1]);
  }
  return total;
}

/**
 * Formata metros em texto legível.
 */
export function formatDistance(meters) {
  if (meters < 1000) return `${meters.toFixed(0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
