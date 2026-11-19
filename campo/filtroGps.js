/**
 * campo/filtroGps.js — Filtragem, segmentação e consolidação de trilha GPS real
 * -----------------------------------------------------------------------------
 * Regras aplicadas antes de persistir pontos GPS em SQLite/IndexedDB e ao
 * consolidar a geometria final da rota percorrida:
 *   • rejeita coordenadas inválidas ou fora da faixa geográfica;
 *   • ignora leituras duplicadas (timestamp <= anterior) e ruído estacionário;
 *   • filtra imprecisão extrema (> 120 m) e saltos anômalos irreais;
 *   • quebra em novo segmento (`MultiLineString`) após pausa/retomada ou
 *     lacuna de tempo/distância, mantendo `LineString` quando contínuo.
 */

import { haversine } from '../core/geo.js';
import { coordenadaValida } from './modeloCampo.js';

export const CONFIG_FILTRO_GPS = Object.freeze({
  MAX_PRECISAO_METROS: 120,
  MIN_DESLOCAMENTO_METROS: 2.5,
  JANELA_MICRO_JITTER_MS: 5000,
  VELOCIDADE_MAXIMA_MPS: 28,
  MAX_GAP_CONTINUO_MS: 120000,
  SALTO_SEGMENTO_METROS: 150,
});

export function distanciaMetrosEntre(lon1, lat1, lon2, lat2) {
  return haversine(lat1, lon1, lat2, lon2);
}

/**
 * Avalia um ponto recebido da fonte GPS frente ao último ponto aceito e ao
 * estado de pausa da execução.
 *
 * @returns {{ aceitar: boolean, motivo?: string, ponto?: object, novoSegmento?: boolean, distanciaSegmentoM?: number }}
 */
export function filtrarPontoGps(
  bruto,
  {
    ultimoPonto = null,
    forcarNovoSegmento = false,
    segmentoAtual = 0,
    config = CONFIG_FILTRO_GPS,
    agora = Date.now,
  } = {},
) {
  if (!bruto || typeof bruto !== 'object') {
    return { aceitar: false, motivo: 'ENTRADA_VAZIA' };
  }
  const lat = Number(bruto.latitude);
  const lon = Number(bruto.longitude);
  if (!coordenadaValida(lon, lat)) {
    return { aceitar: false, motivo: 'COORDENADA_INVALIDA' };
  }

  const tsRaw = bruto.timestamp ?? bruto.timestampMs;
  const timestampMs = Number.isFinite(Number(tsRaw)) ? Number(tsRaw) : agora();
  const precisao =
    bruto.precisao == null || !Number.isFinite(Number(bruto.precisao))
      ? null
      : Math.max(0, Number(bruto.precisao));
  const rumo =
    bruto.rumo == null || !Number.isFinite(Number(bruto.rumo))
      ? null
      : Number(bruto.rumo);
  const velocidade =
    bruto.velocidade == null || !Number.isFinite(Number(bruto.velocidade))
      ? null
      : Math.max(0, Number(bruto.velocidade));
  const simulado = bruto.simulado === true;

  const maxPrecisao = config.MAX_PRECISAO_METROS ?? CONFIG_FILTRO_GPS.MAX_PRECISAO_METROS;
  if (precisao != null && precisao > maxPrecisao) {
    return { aceitar: false, motivo: 'BAIXA_PRECISAO' };
  }

  if (ultimoPonto) {
    if (timestampMs <= Number(ultimoPonto.timestampMs)) {
      return { aceitar: false, motivo: 'TIMESTAMP_REPETIDO' };
    }

    const dtMs = timestampMs - Number(ultimoPonto.timestampMs);
    const dist = distanciaMetrosEntre(
      Number(ultimoPonto.longitude),
      Number(ultimoPonto.latitude),
      lon,
      lat,
    );

    const dtSeg = dtMs / 1000;
    const velMax = config.VELOCIDADE_MAXIMA_MPS ?? CONFIG_FILTRO_GPS.VELOCIDADE_MAXIMA_MPS;
    if (!simulado && !forcarNovoSegmento && dtSeg > 0 && dtSeg <= 15 && dist / dtSeg > velMax) {
      return { aceitar: false, motivo: 'SALTO_ABSURDO' };
    }

    const minDesl = config.MIN_DESLOCAMENTO_METROS ?? CONFIG_FILTRO_GPS.MIN_DESLOCAMENTO_METROS;
    const janelaJitter = config.JANELA_MICRO_JITTER_MS ?? CONFIG_FILTRO_GPS.JANELA_MICRO_JITTER_MS;
    if (!forcarNovoSegmento && dist < minDesl && dtMs < janelaJitter) {
      return { aceitar: false, motivo: 'MICRO_JITTER' };
    }

    const maxGap = config.MAX_GAP_CONTINUO_MS ?? CONFIG_FILTRO_GPS.MAX_GAP_CONTINUO_MS;
    const saltoSeg = config.SALTO_SEGMENTO_METROS ?? CONFIG_FILTRO_GPS.SALTO_SEGMENTO_METROS;
    const quebraDescontinuidade =
      forcarNovoSegmento || (dtMs > maxGap && dist > 35) || dist > saltoSeg;

    const novoSegmento = quebraDescontinuidade;
    const segmentoIndice = novoSegmento ? segmentoAtual + 1 : segmentoAtual;

    return {
      aceitar: true,
      novoSegmento,
      distanciaSegmentoM: novoSegmento ? 0 : dist,
      ponto: {
        latitude: Number(lat.toFixed(7)),
        longitude: Number(lon.toFixed(7)),
        precisao,
        rumo,
        velocidade,
        timestampMs,
        simulado,
        segmentoIndice,
      },
    };
  }

  return {
    aceitar: true,
    novoSegmento: false,
    distanciaSegmentoM: 0,
    ponto: {
      latitude: Number(lat.toFixed(7)),
      longitude: Number(lon.toFixed(7)),
      precisao,
      rumo,
      velocidade,
      timestampMs,
      simulado,
      segmentoIndice: Math.max(0, Number(segmentoAtual || 0)),
    },
  };
}

/**
 * Consolida a sequência ordenada de pontos GPS em `LineString` (trilha contínua)
 * ou `MultiLineString` (quando houve pausa/descontinuidade com múltiplos trechos),
 * calculando distância total e duração efetiva.
 */
export function consolidarPontosEmGeometria(pontos = []) {
  const ordenados = [...(Array.isArray(pontos) ? pontos : [])]
    .filter((p) => p && coordenadaValida(Number(p.longitude), Number(p.latitude)))
    .sort((a, b) => Number(a.ordem ?? a.timestampMs ?? 0) - Number(b.ordem ?? b.timestampMs ?? 0));

  if (!ordenados.length) {
    return {
      geometry: null,
      distanciaMetros: 0,
      duracaoSegundos: 0,
      totalPontosValidos: 0,
      quantidadeSegmentos: 0,
    };
  }

  const segmentosMap = new Map();
  for (const pt of ordenados) {
    const seg = Number.isFinite(Number(pt.segmentoIndice)) ? Number(pt.segmentoIndice) : 0;
    if (!segmentosMap.has(seg)) segmentosMap.set(seg, []);
    const lista = segmentosMap.get(seg);
    const coord = [Number(Number(pt.longitude).toFixed(7)), Number(Number(pt.latitude).toFixed(7))];
    const prev = lista[lista.length - 1];
    if (!prev || Math.abs(prev[0] - coord[0]) > 1e-8 || Math.abs(prev[1] - coord[1]) > 1e-8) {
      lista.push(coord);
    }
  }

  const linhasValidas = Array.from(segmentosMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, coords]) => coords)
    .filter((coords) => coords.length >= 2);

  let distanciaMetros = 0;
  for (const linha of linhasValidas) {
    for (let i = 1; i < linha.length; i += 1) {
      distanciaMetros += distanciaMetrosEntre(
        linha[i - 1][0],
        linha[i - 1][1],
        linha[i][0],
        linha[i][1],
      );
    }
  }

  const inicioMs = Number(ordenados[0].timestampMs || 0);
  const fimMs = Number(ordenados[ordenados.length - 1].timestampMs || 0);
  const duracaoSegundos =
    inicioMs > 0 && fimMs >= inicioMs ? Math.round((fimMs - inicioMs) / 1000) : 0;

  let geometry = null;
  if (linhasValidas.length === 1) {
    geometry = { type: 'LineString', coordinates: linhasValidas[0] };
  } else if (linhasValidas.length > 1) {
    geometry = { type: 'MultiLineString', coordinates: linhasValidas };
  }

  return {
    geometry,
    distanciaMetros: Math.round(distanciaMetros * 100) / 100,
    duracaoSegundos,
    totalPontosValidos: ordenados.length,
    quantidadeSegmentos: linhasValidas.length,
  };
}
