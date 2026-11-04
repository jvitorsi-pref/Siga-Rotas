/**
 * core/rotaParadas.js
 * ---------------------------------------------------------------------------
 * CÁLCULO DA ROTA COM MÚLTIPLAS PARADAS (A → B → C → D) E DA **ROTA
 * CIRCULAR** (A → B → C → D → A).
 *
 * Este módulo NÃO reimplementa o roteamento: ele **orquestra** o motor já
 * existente (`routeOnGraph`, em `core/router.js`), calculando um trecho por
 * par consecutivo de pontos e concatenando os resultados na ordem escolhida.
 *
 * Dois modos de ordem (definidos pelo chamador):
 *
 *   • `usuario`   — a sequência dos pontos como o usuário informou
 *                   (padrão: nunca se mexe na ordem do usuário sem pedir);
 *   • `otimizada` — a ordem que produz o **menor caminho total**, obtida
 *                   sobre o fecho métrico da rede (ver `core/ordemParadas.js`).
 *
 * E dois tipos de trajeto:
 *
 *   • **ida e volta** (padrão) — A → B → C → D (destino livre);
 *   • **circular** (`circular: true`) — A → B → C → D → **A**: o retorno à
 *     origem é calculado automaticamente, como um trecho da rede entre
 *     quaisquer outros. O problema de otimização passa a ser o TSP **em
 *     ciclo** (a origem é fixa no início e no fim).
 *
 * Regras (iguais em todos os modos):
 *   • cada trecho é calculado pela rede viária real (grafo vindo do WFS);
 *   • quando um trecho não tem caminho, o erro é **explícito** (diz qual
 *     conexão falhou) e **nenhuma linha reta** é desenhada para tapar a
 *     falha;
 *   • a geometria concatenada mantém os vértices originais dos eixos;
 *   • um resultado parcial **nunca** é apresentado como rota completa.
 */

import { routeOnGraph } from './router.js';
import { otimizarOrdem } from './ordemParadas.js';

/** Modos de ordem aceitos. */
export const MODOS_ORDEM = { USUARIO: 'usuario', OTIMIZADA: 'otimizada' };

/**
 * Calcula a rota completa de uma sequência de pontos.
 *
 * @param {object} graph grafo devolvido por `buildGraph`
 * @param {Array<{rotulo?:string, latitude:number, longitude:number}>} pontos
 * @param {object} [options]
 *   - `modo`: 'usuario' (padrão) | 'otimizada'
 *   - `circular`: true para o circuito fechado (retorno automático à origem)
 *   - `maxSnapDistance`, `algorithm`: repassados a `routeOnGraph`
 */
export function calcularRotaComParadas(graph, pontos, options = {}) {
  const lista = Array.isArray(pontos) ? pontos : [];
  const modo = options.modo === MODOS_ORDEM.OTIMIZADA ? MODOS_ORDEM.OTIMIZADA : MODOS_ORDEM.USUARIO;
  const circular = options.circular === true;

  if (lista.length < (circular ? 2 : 2)) {
    return {
      ok: false,
      reason: 'PONTOS_INSUFICIENTES',
      message: circular
        ? 'Um circuito precisa de ao menos a origem e uma parada.'
        : 'Informe ao menos origem e destino para calcular a rota.',
      legs: [],
      distance: 0,
      circular,
    };
  }

  // validação das coordenadas de cada ponto
  for (const p of lista) {
    // `null`/`undefined`/`''` viram 0 em Number(): precisam ser checados
    // antes, senão um ponto sem resolver viraria a coordenada (0, 0).
    if (p.latitude == null || p.longitude == null || p.latitude === '' || p.longitude === '') {
      return {
        ok: false,
        reason: 'COORDENADA_INVALIDA',
        message: `O ponto ${p.rotulo || '?'} não tem coordenadas resolvidas.`,
        legs: [],
        distance: 0,
        circular,
      };
    }
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return {
        ok: false,
        reason: 'COORDENADA_INVALIDA',
        message: `O ponto ${p.rotulo || '?'} não tem coordenadas válidas.`,
        legs: [],
        distance: 0,
        circular,
      };
    }
  }

  // ── modo otimizada: escolhe a ordem de menor caminho total ──
  let ordem = lista.map((_, i) => i);
  let otimizacao = null;
  if (modo === MODOS_ORDEM.OTIMIZADA && lista.length > (circular ? 2 : 2)) {
    otimizacao = otimizarOrdem(graph, lista, { ...options, circular });
    if (!otimizacao.ok) {
      return {
        ok: false,
        reason: otimizacao.reason,
        message: otimizacao.message,
        legs: [],
        distance: 0,
        modo,
        circular,
        semCaminho: otimizacao.semCaminho || [],
      };
    }
    ordem = otimizacao.ordem;
  }

  const naOrdem = ordem.map((i) => lista[i]);

  // Pares consecutivos a rotear. No circuito, o último par é o **fechamento**
  // (última parada → origem), que também é um trecho da rede.
  const pares = [];
  for (let i = 0; i < naOrdem.length - 1; i++) pares.push({ de: i, para: i + 1, retorno: false });
  if (circular) pares.push({ de: naOrdem.length - 1, para: 0, retorno: true });

  const legs = [];
  const coordenadas = [];
  let total = 0;
  let falhou = null;

  for (const par of pares) {
    const de = naOrdem[par.de];
    const para = naOrdem[par.para];
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
        de: de.rotulo || `Ponto ${par.de + 1}`,
        para: para.rotulo || `Ponto ${par.para + 1}`,
        retorno: par.retorno,
        reason: resultado.reason,
        message: resultado.message,
        distanceToNetwork: resultado.distanceToNetwork ?? null,
        side: resultado.side ?? null,
      };
      break;
    }

    legs.push({
      indice: legs.length,
      de: de.rotulo || `Ponto ${par.de + 1}`,
      para: para.rotulo || `Ponto ${par.para + 1}`,
      retorno: par.retorno,
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

  // distância da MESMA combinação de pontos na ordem do usuário, para
  // quantificar a economia da otimização (no circuito, inclui o fechamento)
  let comparacao = null;
  if (modo === MODOS_ORDEM.OTIMIZADA && otimizacao?.ok) {
    const ordemUsuario = lista.map((_, i) => i);
    const paresUsuario = [];
    for (let i = 0; i < ordemUsuario.length - 1; i++) paresUsuario.push([i, i + 1]);
    if (circular) paresUsuario.push([ordemUsuario.length - 1, 0]);
    let custoUsuario = 0;
    let usuarioOk = true;
    for (const [i, j] of paresUsuario) {
      const r = routeOnGraph(
        graph,
        { lon: Number(lista[i].longitude), lat: Number(lista[i].latitude) },
        { lon: Number(lista[j].longitude), lat: Number(lista[j].latitude) },
        options,
      );
      if (!r.ok) {
        usuarioOk = false;
        break;
      }
      custoUsuario += r.distance;
    }
    if (usuarioOk) {
      comparacao = {
        distanciaUsuario: custoUsuario,
        distanciaOtimizada: total,
        economia: custoUsuario - total,
        economiaPercentual: custoUsuario > 0 ? (1 - total / custoUsuario) * 100 : 0,
      };
    }
  }

  if (falhou) {
    const trechoFalhou = falhou.retorno
      ? `${falhou.de} → ${falhou.para} (retorno à origem)`
      : `${falhou.de} → ${falhou.para}`;
    return {
      ok: false,
      reason: 'TRECHO_SEM_CAMINHO',
      message:
        `Não foi possível calcular o trecho ${trechoFalhou}. ` +
        falhou.message,
      falha: falhou,
      legs,
      distance: total,
      distanceMeters: Math.round(total),
      distanceKm: total / 1000,
      geometry,
      parcial: true,
      modo,
      circular,
      ordemAplicada: naOrdem.map((p) => p.rotulo),
      pontos: lista.map((p) => ({ rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
    };
  }

  const sequencia = naOrdem.map((p) => p.rotulo);
  const sequenciaCompleta = circular ? [...sequencia, sequencia[0]] : sequencia;
  const warnings = legs.flatMap((l) => l.warnings || []);
  const streets = legs.flatMap((l) => l.streets || []);
  const retorno = circular ? legs[legs.length - 1] : null;

  return {
    ok: true,
    reason: null,
    distance: total,
    distanceMeters: Math.round(total),
    distanceKm: total / 1000,
    geometry,
    legs,
    parcial: false,
    modo,
    circular,
    paradas: Math.max(0, circular ? lista.length - 1 : lista.length - 2),
    sequencia,
    sequenciaCompleta,
    sequenciaUsuario: circular
      ? [...lista.map((p) => p.rotulo), lista[0].rotulo]
      : lista.map((p) => p.rotulo),
    ordemAplicada: sequencia,
    retorno: retorno
      ? {
          de: retorno.de,
          para: retorno.para,
          distance: retorno.distance,
          distanceMeters: retorno.distanceMeters,
          distanceKm: retorno.distanceKm,
          geometry: retorno.geometry,
        }
      : null,
    otimizacao: otimizacao
      ? {
          metodo: otimizacao.metodo,
          ms: otimizacao.ms,
          custo: otimizacao.custo,
          semCaminho: otimizacao.semCaminho?.length || 0,
        }
      : null,
    comparacao,
    streets,
    warnings,
    pontos: lista.map((p, i) => ({
      rotulo: p.rotulo,
      latitude: p.latitude,
      longitude: p.longitude,
      enderecoDigital: p.enderecoDigital ?? null,
      ordem: ordem.indexOf(i) + 1,
    })),
  };
}
