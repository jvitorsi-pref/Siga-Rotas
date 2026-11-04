/**
 * core/rotaParadas.js
 * ---------------------------------------------------------------------------
 * CÁLCULO DA ROTA COM MÚLTIPLAS PARADAS (A → B → C → D).
 *
 * Este módulo NÃO reimplementa o roteamento: ele **orquestra** o motor já
 * existente (`routeOnGraph`, em `core/router.js`), calculando um trecho por
 * par consecutivo de pontos e concatenando os resultados na ordem pedida
 * pelo usuário.
 *
 * Regras:
 *   • a ordem é a **ordem do usuário** — não há otimização de ordem de
 *     visita (funcionalidade futura, separada);
 *   • cada trecho é calculado pela rede viária real (grafo vindo do WFS);
 *   • quando um trecho não tem caminho, o erro é **explícito** (diz qual
 *     conexão falhou) e **nenhuma linha reta** é desenhada para tapar a
 *     falha;
 *   • a geometria concatenada mantém os vértices originais dos eixos.
 */

import { routeOnGraph } from './router.js';

/**
 * Calcula a rota completa de uma sequência de pontos.
 *
 * @param {object} graph grafo devolvido por `buildGraph`
 * @param {Array<{rotulo?:string, latitude:number, longitude:number}>} pontos
 * @param {object} [options] repassado a `routeOnGraph` (ex.: `maxSnapDistance`)
 */
export function calcularRotaComParadas(graph, pontos, options = {}) {
  const lista = Array.isArray(pontos) ? pontos : [];

  if (lista.length < 2) {
    return {
      ok: false,
      reason: 'PONTOS_INSUFICIENTES',
      message: 'Informe ao menos origem e destino para calcular a rota.',
      legs: [],
      distance: 0,
    };
  }

  // validação das coordenadas de cada ponto
  for (const p of lista) {
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return {
        ok: false,
        reason: 'COORDENADA_INVALIDA',
        message: `O ponto ${p.rotulo || '?'} não tem coordenadas válidas.`,
        legs: [],
        distance: 0,
      };
    }
  }

  const legs = [];
  const coordenadas = [];
  let total = 0;
  let falhou = null;

  for (let i = 0; i < lista.length - 1; i++) {
    const de = lista[i];
    const para = lista[i + 1];
    const resultado = routeOnGraph(
      graph,
      { lon: Number(de.longitude), lat: Number(de.latitude) },
      { lon: Number(para.longitude), lat: Number(para.latitude) },
      options,
    );

    if (!resultado.ok) {
      // trecho sem caminho viável: o erro é registrado COM a identificação
      // da conexão que falhou. Nenhuma linha reta é criada.
      falhou = {
        de: de.rotulo || `Ponto ${i + 1}`,
        para: para.rotulo || `Ponto ${i + 2}`,
        reason: resultado.reason,
        message: resultado.message,
        distanceToNetwork: resultado.distanceToNetwork ?? null,
        side: resultado.side ?? null,
      };
      break;
    }

    legs.push({
      indice: i,
      de: de.rotulo || `Ponto ${i + 1}`,
      para: para.rotulo || `Ponto ${i + 2}`,
      distance: resultado.distance,
      distanceMeters: resultado.distanceMeters,
      distanceKm: resultado.distanceKm,
      geometry: resultado.geometry,
      legs: resultado.legs,
      streets: resultado.streets,
      warnings: resultado.warnings,
      origem: resultado.origin,
      destino: resultado.destination,
      nodeCount: resultado.nodeCount,
    });
    total += resultado.distance;

    // concatenação: remove apenas coordenadas consecutivas repetidas
    for (const c of resultado.geometry.coordinates) {
      const ultimo = coordenadas[coordenadas.length - 1];
      if (ultimo && ultimo[0] === c[0] && ultimo[1] === c[1]) continue;
      coordenadas.push(c);
    }
  }

  const geometry = { type: 'LineString', coordinates: coordenadas };

  if (falhou) {
    return {
      ok: false,
      reason: 'TRECHO_SEM_CAMINHO',
      message:
        `Não foi possível calcular o trecho ${falhou.de} → ${falhou.para}. ` +
        falhou.message,
      falha: falhou,
      legs,
      distance: total,
      distanceMeters: Math.round(total),
      distanceKm: total / 1000,
      geometry,
      parcial: true,
      pontos: lista.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    };
  }

  const sequencia = lista.map((p) => p.rotulo);
  const warnings = legs.flatMap((l) => l.warnings || []);
  const streets = legs.flatMap((l) => l.streets || []);

  return {
    ok: true,
    reason: null,
    distance: total,
    distanceMeters: Math.round(total),
    distanceKm: total / 1000,
    geometry,
    legs,
    parcial: false,
    paradas: Math.max(0, lista.length - 2),
    sequencia,
    streets,
    warnings,
    pontos: lista.map((p) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital ?? null,
    })),
  };
}
