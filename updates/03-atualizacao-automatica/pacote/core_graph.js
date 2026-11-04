/**
 * CONSTRUÇÃO DO GRAFO VIÁRIO
 * ===========================
 *
 * Pipeline (executado uma única vez por versão da rede; o resultado é cacheado):
 *
 *   1. NORMALIZAÇÃO   FeatureCollection GeoJSON -> partes (polilinhas) em UTM 23S
 *   2. ÍNDICE         grade uniforme sobre os segmentos, para candidatos a cruzamento
 *   3. INTerseções    cruzamentos reais (interior x interior) e toques (extremidade x eixo)
 *   4. SNAP/MERGE     extremidades que não encostam, mas estão a poucos centímetros
 *   5. CORTE          cada eixo é partido nos pontos de interseção/snapping
 *   6. NÓS            union-find agrupa as pontas que representam o mesmo cruzamento
 *   7. ARESTAS        cada trecho partido vira uma aresta com peso = comprimento real
 *   8. HIGIENE        remoção de duplicidades geométricas comprovadas e componentes isolados
 *
 * Decisões importantes (justificadas com medições reais sobre a camada):
 *
 *  • A camada NÃO publica atributo de nível/gabarito. Portanto é impossível,
 *    a partir dos dados, distinguir "cruzamento em nível" de "viaduto".
 *    O motor conecta TODOS os cruzamentos geométricos (o eixo do dado é a
 *    evidência disponível) e classifica separadamente os 27 cruzamentos em
 *    que uma das vias é RODOVIA, permitindo recusá-los via opção
 *    `excludeRoadCrossings`. Essa limitação é reportada no diagnóstico.
 *
 *  • Ruas NÃO são conectadas por proximidade arbitrária: só há junção quando
 *    existe interseção geométrica real ou quando a distância entre a
 *    extremidade e a rede é <= snapTolerance (5 cm, validado pela distribuição
 *    real das 11.702 extremidades da camada).
 *
 *  • O grafo é NÃO DIRECIONAL: o pedido é "apenas rotas a pé" e pedestres
 *    podem caminhar em ambos os sentidos das ruas.
 */

import { GRAPH_DEFAULTS } from './config.js';
import {
  project,
  unproject,
  dist,
  cross,
  segmentIntersection,
  pointOnSegment,
  projectPointOnSegment,
  polylineLength,
} from './geo.js';
import { GridIndex, computeBBox } from './spatialIndex.js';

const EPS = 1e-9;

/* ------------------------------------------------------------------ */
/* 1. NORMALIZAÇÃO                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extrai as polilinhas de uma feature, aceitando LineString e MultiLineString.
 * @returns {number[][]} lista de anéis [[lon,lat], ...]
 */
function extractRings(geometry) {
  if (!geometry) return [];
  const type = geometry.type;
  if (type === 'LineString') return [geometry.coordinates];
  if (type === 'MultiLineString') return geometry.coordinates;
  if (type === 'GeometryCollection') {
    const rings = [];
    for (const g of geometry.geometries || []) rings.push(...extractRings(g));
    return rings;
  }
  return [];
}

/** Remove vértices consecutivos duplicados. */
function dedupeConsecutive(coords) {
  const out = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push([c[0], c[1]]);
  }
  return out;
}

/**
 * Converte as features em "partes": polilinhas limpas, já projetadas para UTM.
 *
 * @param {Array} features
 * @param {object} options
 */
function normalizeParts(features, options) {
  const parts = [];
  const diagnostics = {
    featuresRead: features.length,
    partsKept: 0,
    degenerateParts: 0,
    zeroLengthParts: 0,
    skippedByFilter: 0,
    invalidGeometry: 0,
  };

  for (const feature of features) {
    const props = feature.properties || {};
    const featureId = props.ID ?? null;

    if (options.includeUnofficialAxes === false && Number(props.COD_LOG) === 0) {
      diagnostics.skippedByFilter++;
      continue;
    }
    if (
      options.pedestrianBlockedTypes &&
      options.pedestrianBlockedTypes.length > 0 &&
      options.pedestrianBlockedTypes.includes(props.TPO_LOGRADOURO)
    ) {
      diagnostics.skippedByFilter++;
      continue;
    }

    const rings = extractRings(feature.geometry);
    if (rings.length === 0) {
      diagnostics.invalidGeometry++;
      continue;
    }

    for (const rawRing of rings) {
      const coords = dedupeConsecutive(rawRing || []);
      if (coords.length < 2) {
        diagnostics.degenerateParts++;
        continue;
      }

      // projeção para UTM 23S
      const xy = new Float64Array(coords.length * 2);
      for (let i = 0; i < coords.length; i++) {
        const [x, y] = project(coords[i][0], coords[i][1]);
        xy[i * 2] = x;
        xy[i * 2 + 1] = y;
      }

      const length = polylineLength(xy);
      if (length < 1e-6) {
        diagnostics.zeroLengthParts++;
        continue;
      }

      parts.push({
        pid: parts.length,
        featureId,
        props,
        coords,
        xy,
        length,
        nVerts: coords.length,
        bbox: partBBox(xy),
        /** pontos de corte da parte: preenchido na fase 5 */
        cuts: [],
        /** portas (nós potenciais) da parte: preenchido na fase 5 */
        portBase: 0,
        portCount: 0,
      });
    }
  }

  diagnostics.partsKept = parts.length;
  return { parts, diagnostics };
}

function partBBox(xy) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < minX) minX = xy[i];
    if (xy[i] > maxX) maxX = xy[i];
    if (xy[i + 1] < minY) minY = xy[i + 1];
    if (xy[i + 1] > maxY) maxY = xy[i + 1];
  }
  return [minX, minY, maxX, maxY];
}

/* ------------------------------------------------------------------ */
/* 2. ÍNDICE DE SEGMENTOS                                              */
/* ------------------------------------------------------------------ */

/**
 * Cria um índice de grade sobre todos os segmentos das partes.
 * Cada segmento referencia (pid, segIdx).
 */
function buildSegmentIndex(parts, bbox, cellSize) {
  const index = new GridIndex(bbox, cellSize);
  for (const part of parts) {
    const xy = part.xy;
    for (let s = 0; s < part.nVerts - 1; s++) {
      const ax = xy[s * 2];
      const ay = xy[s * 2 + 1];
      const bx = xy[s * 2 + 2];
      const by = xy[s * 2 + 3];
      index.insert(
        { pid: part.pid, segIdx: s },
        Math.min(ax, bx),
        Math.min(ay, by),
        Math.max(ax, bx),
        Math.max(ay, by)
      );
    }
  }
  return index;
}

/* ------------------------------------------------------------------ */
/* 3. INTerseções REAIS                                                 */
/* ------------------------------------------------------------------ */

/**
 * Parâmetro (sem clamp) da projeção de P sobre o segmento AB.
 * Pode assumir valores fora de [0,1]; usado para testar sobreposição real.
 */
function rawParam(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return ((px - ax) * dx + (py - ay) * dy) / lenSq;
}

/**
 * Classifica a relação entre os segmentos AB e CD.
 *
 * @returns {null|{type:'cross'|'touch'|'overlap', ...}}
 */
function classifySegmentPair(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y, eps) {
  const d1 = cross(b1x, b1y, a1x, a1y, b2x, b2y);
  const d2 = cross(b1x, b1y, a2x, a2y, b2x, b2y);
  const d3 = cross(a1x, a1y, b1x, b1y, a2x, a2y);
  const d4 = cross(a1x, a1y, b2x, b2y, a2x, a2y);

  const lenB = Math.hypot(b2x - b1x, b2y - b1y);
  const lenA = Math.hypot(a2x - a1x, a2y - a1y);

  // distâncias perpendiculares normalizadas (metros)
  const n1 = lenB > 0 ? d1 / lenB : 0;
  const n2 = lenB > 0 ? d2 / lenB : 0;
  const n3 = lenA > 0 ? d3 / lenA : 0;
  const n4 = lenA > 0 ? d4 / lenA : 0;

  const collinearA = Math.abs(n1) <= eps && Math.abs(n2) <= eps;
  const collinearB = Math.abs(n3) <= eps && Math.abs(n4) <= eps;

  if (collinearA && collinearB) {
    // Sobreposição colinear. IMPORTANTE: os parâmetros são calculados SEM
    // clamp — com clamp, dois trechos colineares e disjuntos (ex.: a mesma
    // rua desenhada em dois trechos separados) seriam reportados como
    // sobreposição. Só há sobreposição real se os intervalos [0,1] e
    // [t0,t1] se intersectarem com comprimento > 0.
    const t0 = rawParam(b1x, b1y, a1x, a1y, a2x, a2y);
    const t1 = rawParam(b2x, b2y, a1x, a1y, a2x, a2y);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (hi - lo <= EPS) return null; // apenas um ponto em comum
    return {
      type: 'overlap',
      ax: a1x + (a2x - a1x) * lo,
      ay: a1y + (a2y - a1y) * lo,
      bx: a1x + (a2x - a1x) * hi,
      by: a1y + (a2y - a1y) * hi,
    };
  }

  // cruzamento proper
  const proper =
    (n1 > eps && n2 < -eps) || (n1 < -eps && n2 > eps);
  const proper2 =
    (n3 > eps && n4 < -eps) || (n3 < -eps && n4 > eps);
  if (proper && proper2) {
    const p = segmentIntersection(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y);
    if (p) return { type: 'cross', x: p[0], y: p[1] };
  }

  // toques: extremidade de um segmento sobre o outro
  const touch = (px, py, otherX1, otherY1, otherX2, otherY2, which) => {
    if (!pointOnSegment(px, py, otherX1, otherY1, otherX2, otherY2, eps)) return null;
    const pr = projectPointOnSegment(px, py, otherX1, otherY1, otherX2, otherY2);
    return { type: 'touch', x: pr.x, y: pr.y, on: which };
  };

  return (
    touch(a1x, a1y, b1x, b1y, b2x, b2y, 'a1') ||
    touch(a2x, a2y, b1x, b1y, b2x, b2y, 'a2') ||
    touch(b1x, b1y, a1x, a1y, a2x, a2y, 'b1') ||
    touch(b2x, b2y, a1x, a1y, a2x, a2y, 'b2') ||
    null
  );
}

/**
 * Encontra todos os pontos de interseção entre as partes.
 *
 * @returns {Array} eventos {kind:'cross'|'touch'|'overlap', pidA, pidB, ...}
 */
function detectIntersections(parts, index, eps) {
  const events = [];
  const seen = new Set();

  for (const part of parts) {
    const xy = part.xy;
    for (let s = 0; s < part.nVerts - 1; s++) {
      const ax = xy[s * 2];
      const ay = xy[s * 2 + 1];
      const bx = xy[s * 2 + 2];
      const by = xy[s * 2 + 3];

      const cands = index.queryBBox(
        Math.min(ax, bx),
        Math.min(ay, by),
        Math.max(ax, bx),
        Math.max(ay, by)
      );

      for (const cand of cands) {
        const other = parts[cand.pid];
        const t = cand.segIdx;
        const cx = other.xy[t * 2];
        const cy = other.xy[t * 2 + 1];
        const dx = other.xy[t * 2 + 2];
        const dy = other.xy[t * 2 + 3];

        // Chave canônica do par de segmentos: ordena as DUAS tuplas
        // (pid, segIdx) entre si — comparar apenas os pids não basta, pois
        // (A,3)x(B,7) e (B,7)x(A,3) precisam gerar a mesma chave.
        const a0 = part.pid;
        const a1 = s;
        const b0 = cand.pid;
        const b1 = t;
        if (cand.pid === part.pid && cand.segIdx === s) continue;
        const key =
          a0 < b0 || (a0 === b0 && a1 < b1)
            ? `${a0}:${a1}:${b0}:${b1}`
            : `${b0}:${b1}:${a0}:${a1}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // descarte rápido por bounding box
        if (Math.max(ax, bx) < Math.min(cx, dx) - eps) continue;
        if (Math.max(cx, dx) < Math.min(ax, bx) - eps) continue;
        if (Math.max(ay, by) < Math.min(cy, dy) - eps) continue;
        if (Math.max(cy, dy) < Math.min(ay, by) - eps) continue;

        const rel = classifySegmentPair(ax, ay, bx, by, cx, cy, dx, dy, eps);
        if (!rel) continue;

        // Segmentos adjacentes da MESMA parte são apenas continuidade da
        // polilinha: geram "toque" mas não um cruzamento. Só a sobreposição
        // colinear é relevante (ex.: trecho que vai e volta na mesma linha).
        // Segmentos adjacentes da MESMA parte são continuidade da polilinha:
        // o vértice compartilhado não é um cruzamento. A única exceção é a
        // sobreposição real (trecho que "vai e volta" na mesma linha), que
        // já é detectada corretamente pelo intervalo sem clamp.
        const samePart = cand.pid === part.pid;
        if (samePart && Math.abs(cand.segIdx - s) === 1 && rel.type !== 'overlap') continue;

        if (rel.type === 'cross') {
          events.push({
            kind: 'cross', pidA: part.pid, pidB: cand.pid,
            segA: s, segB: t, x: rel.x, y: rel.y,
          });
        } else if (rel.type === 'touch') {
          events.push({
            kind: 'touch', pidA: part.pid, pidB: cand.pid,
            segA: s, segB: t, x: rel.x, y: rel.y, on: rel.on,
          });
        } else if (rel.type === 'overlap') {
          events.push({
            kind: 'overlap', pidA: part.pid, pidB: cand.pid,
            segA: s, segB: t, ax: rel.ax, ay: rel.ay, bx: rel.bx, by: rel.by,
          });
        }
      }
    }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* 4. SNAP / MERGE DE EXTREMIDADES                                     */
/* ------------------------------------------------------------------ */

/**
 * Para um ponto P, encontra o ponto mais próximo na polilinha da parte.
 * @returns {null|{dist, x, y, segIdx, t, atVertex, vertexIdx}}
 */
function closestPointOnPart(part, px, py) {
  const xy = part.xy;
  let best = null;
  for (let s = 0; s < part.nVerts - 1; s++) {
    const pr = projectPointOnSegment(
      px,
      py,
      xy[s * 2],
      xy[s * 2 + 1],
      xy[s * 2 + 2],
      xy[s * 2 + 3]
    );
    if (!best || pr.dist < best.dist) {
      const atVertex = pr.t <= 1e-12 || pr.t >= 1 - 1e-12;
      best = {
        dist: pr.dist,
        x: pr.x,
        y: pr.y,
        segIdx: s,
        t: pr.t,
        atVertex,
        vertexIdx: pr.t <= 1e-12 ? s : s + 1,
      };
    }
  }
  return best;
}

/**
 * Detecta extremidades que não tocam a rede, mas estão dentro da tolerância.
 *
 * Três casos, em ordem de fidelidade geométrica:
 *
 *  • SNAP      — a extremidade cai sobre o INTERIOR de outro eixo a menos de
 *                `tolerance` (5 cm): movemos a extremidade para o ponto de
 *                projeção e partimos o outro eixo ali. É uma correção
 *                geométrica de ruído de digitalização.
 *
 *  • MERGE     — a extremidade está próxima da EXTREMIDADE de outro eixo
 *                (≤ `tolerance`): aproximamos as duas no ponto médio.
 *
 *  • CONNECTOR — a extremidade está a mais de `tolerance` mas a menos de
 *                `junctionTolerance` (1 m) de outro eixo. Aqui a geometria
 *                original NÃO é tocada: as duas pontas ficam exatamente onde
 *                estão e a ligação é feita por um trecho curto (o
 *                "conector"), com o comprimento real da lacuna. É o que
 *                resolve as rotas que antes davam uma volta desnecessária
 *                porque a ponta da rua terminava a poucos centímetros de
 *                outra rua sem tocá-la.
 */
function detectSnapEvents(parts, index, tolerance, junctionTolerance) {
  const events = [];
  const cellSize = index.cellSize;

  for (const part of parts) {
    const endpoints = [
      { vertexIdx: 0, x: part.xy[0], y: part.xy[1] },
      {
        vertexIdx: part.nVerts - 1,
        x: part.xy[(part.nVerts - 1) * 2],
        y: part.xy[(part.nVerts - 1) * 2 + 1],
      },
    ];

    for (const ep of endpoints) {
      // busca do segmento mais próximo com corte antecipado (branch & bound):
      // quando o raio do anel atual já supera a melhor distância encontrada,
      // nenhum segmento mais distante pode melhorar o resultado.
      let bestSeg = null;
      let bestDist = Infinity;
      index.queryExpanding(ep.x, ep.y, 60, (cands, ring) => {
        for (const cand of cands) {
          if (cand.pid === part.pid) continue;
          const other = parts[cand.pid];
          const ox = other.xy;
          const pr = projectPointOnSegment(
            ep.x, ep.y,
            ox[cand.segIdx * 2], ox[cand.segIdx * 2 + 1],
            ox[cand.segIdx * 2 + 2], ox[cand.segIdx * 2 + 3]
          );
          if (pr.dist < bestDist) {
            bestDist = pr.dist;
            bestSeg = { other, segIdx: cand.segIdx };
          }
        }
        return bestSeg !== null && (ring - 1) * cellSize > bestDist;
      });

      if (!bestSeg || bestDist > junctionTolerance) continue;
      if (bestDist <= 1e-7) continue; // já é um toque exato (tratado nas interseções)

      // acima de `tolerance` a geometria original é preservada: a ligação
      // passa a ser feita por um conector (ver comentário da função).
      const isConnector = bestDist > tolerance;

      // ponto mais próximo autoritativo sobre a polilinha inteira da parte
      const cp = closestPointOnPart(bestSeg.other, ep.x, ep.y);

      if (cp.atVertex) {
        events.push({
          kind: isConnector ? 'connector' : 'merge',
          pidA: part.pid,
          vertexA: ep.vertexIdx,
          pidB: bestSeg.other.pid,
          vertexB: cp.vertexIdx,
          // segmento e parâmetro do ponto de contato: necessários para
          // criar o corte exatamente no lugar certo (inclusive quando o
          // contato é num vértice e ainda não existe corte nele).
          segB: cp.segIdx,
          tB: cp.t,
          x: isConnector ? ep.x : (ep.x + cp.x) / 2,
          y: isConnector ? ep.y : (ep.y + cp.y) / 2,
          // ponto de contato com o outro eixo (para o conector)
          bx: cp.x,
          by: cp.y,
          gap: cp.dist,
        });
      } else {
        events.push({
          kind: isConnector ? 'connector' : 'snap',
          pidA: part.pid,
          vertexA: ep.vertexIdx,
          pidB: bestSeg.other.pid,
          segB: cp.segIdx,
          tB: cp.t,
          x: isConnector ? ep.x : cp.x,
          y: isConnector ? ep.y : cp.y,
          bx: cp.x,
          by: cp.y,
          gap: cp.dist,
        });
      }
    }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* 5/6. CORTE E NÓS                                                   */
/* ------------------------------------------------------------------ */

/** Union-Find com compressão de caminho. */
class UnionFind {
  constructor(size) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
    this.rank = new Uint8Array(size);
  }

  find(a) {
    let root = a;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[a] !== root) {
      const next = this.parent[a];
      this.parent[a] = root;
      a = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return this.find(ra);
  }
}

/**
 * Calcula a posição (distância ao longo da parte) de um ponto sobre um segmento.
 */
function positionOnPart(part, segIdx, t) {
  let cum = 0;
  const xy = part.xy;
  for (let s = 0; s < segIdx; s++) {
    cum += dist(xy[s * 2], xy[s * 2 + 1], xy[s * 2 + 2], xy[s * 2 + 3]);
  }
  const segLen = dist(
    xy[segIdx * 2],
    xy[segIdx * 2 + 1],
    xy[segIdx * 2 + 2],
    xy[segIdx * 2 + 3]
  );
  return { dist: cum + t * segLen, segIdx, t };
}

/**
 * Calcula a distância acumulada de um vértice ao longo da parte.
 */
function vertexDistance(part, vertexIdx) {
  let cum = 0;
  const xy = part.xy;
  for (let s = 0; s < vertexIdx; s++) {
    cum += dist(xy[s * 2], xy[s * 2 + 1], xy[s * 2 + 2], xy[s * 2 + 3]);
  }
  return cum;
}

/**
 * Executa as fases 3 a 8: interseções, snap, cortes, nós e arestas.
 */
function assembleGraph(parts, events, options) {
  /* --- aplicação das movimentações de vértice (snap/merge) --- */
  // Os conectores NÃO aparecem aqui: eles preservam a geometria original.
  for (const ev of events) {
    if (ev.kind === 'snap') {
      const part = parts[ev.pidA];
      part.xy[ev.vertexA * 2] = ev.x;
      part.xy[ev.vertexA * 2 + 1] = ev.y;
    } else if (ev.kind === 'merge') {
      const a = parts[ev.pidA];
      const b = parts[ev.pidB];
      a.xy[ev.vertexA * 2] = ev.x;
      a.xy[ev.vertexA * 2 + 1] = ev.y;
      b.xy[ev.vertexB * 2] = ev.x;
      b.xy[ev.vertexB * 2 + 1] = ev.y;
    }
  }

  // recalcula comprimentos após movimentação
  for (const part of parts) {
    part.length = polylineLength(part.xy);
  }

  /* --- 5. COLETA DE PONTOS DE CORTE --- */
  // Cada corte: {segIdx, t, x, y, dist, vertexCut:boolean, vertexIdx}
  for (const part of parts) {
    part.cuts = [];
    // extremidades originais
    part.cuts.push({
      segIdx: 0,
      t: 0,
      vertexCut: true,
      vertexIdx: 0,
      x: part.xy[0],
      y: part.xy[1],
      dist: 0,
    });
    part.cuts.push({
      segIdx: part.nVerts - 1,
      t: 1,
      vertexCut: true,
      vertexIdx: part.nVerts - 1,
      x: part.xy[(part.nVerts - 1) * 2],
      y: part.xy[(part.nVerts - 1) * 2 + 1],
      dist: part.length,
    });
  }

  /** mapa (pid, segIdx, t aproximado) -> corte, para casar eventos com cortes */
  const cutKey = (pid, segIdx, t) => `${pid}:${segIdx}:${Math.round(t * 1e6)}`;

  const findOrCreateCut = (part, segIdx, t, x, y) => {
    const key = cutKey(part.pid, segIdx, t);
    let cut = part.cutByKey.get(key);
    if (cut) return cut;
    const pos = positionOnPart(part, segIdx, t);
    cut = {
      segIdx,
      t,
      vertexCut: false,
      x,
      y,
      dist: pos.dist,
    };
    part.cuts.push(cut);
    part.cutByKey.set(key, cut);
    return cut;
  };

  for (const part of parts) part.cutByKey = new Map();

  /** pares de portas que devem ser unidas (union-find) */
  const unionPairs = [];
  /** ligações por "conector" (lacuna preenchida sem mexer na geometria) */
  const connectorEvents = [];
  /** registro de cruzamentos recusados por regra de nível */
  const rejectedCrossings = [];

  const isRoad = (part) => {
    const t = part.props?.TPO_LOGRADOURO;
    const d = (part.props?.DSC_LOGRADOURO || '').toUpperCase();
    return t === 'ROD' || d.includes('RODOVIA') || d.includes('ROD ANEL') || d.includes('RODOVEL');
  };

  for (const ev of events) {
    if (ev.kind === 'cross') {
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      // ponto de corte em cada parte
      const tA = paramOnSegment(A, ev.segA, ev.x, ev.y);
      const tB = paramOnSegment(B, ev.segB, ev.x, ev.y);
      const cutA = findOrCreateCut(A, ev.segA, tA, ev.x, ev.y);
      const cutB = findOrCreateCut(B, ev.segB, tB, ev.x, ev.y);
      ev.cutA = cutA;
      ev.cutB = cutB;

      if (options.excludeRoadCrossings && (isRoad(A) || isRoad(B))) {
        rejectedCrossings.push({
          x: ev.x,
          y: ev.y,
          a: A.props?.DSC_LOGRADOURO,
          b: B.props?.DSC_LOGRADOURO,
        });
      } else {
        unionPairs.push([cutA, cutB]);
      }
    } else if (ev.kind === 'touch') {
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      // identifica qual extremidade tocou
      const endpointCut = (part, segIdx, isFirst, x, y) => {
        // o toque está no extremo "isFirst" do segmento segIdx da parte
        const vertexIdx = isFirst ? segIdx : segIdx + 1;
        const vDist = vertexDistance(part, vertexIdx);
        const cut = part.cuts.find(
          (c) => c.vertexCut && c.vertexIdx === vertexIdx
        );
        if (cut) return cut;
        const created = {
          segIdx,
          t: isFirst ? 0 : 1,
          vertexCut: true,
          vertexIdx,
          x,
          y,
          dist: vDist,
        };
        part.cuts.push(created);
        return created;
      };

      let cutA;
      let cutB;
      if (ev.on === 'a1' || ev.on === 'a2') {
        const isFirst = ev.on === 'a1';
        cutA = endpointCut(A, ev.segA, isFirst, ev.x, ev.y);
        const tB = paramOnSegment(B, ev.segB, ev.x, ev.y);
        cutB = findOrCreateCut(B, ev.segB, tB, ev.x, ev.y);
      } else {
        const isFirst = ev.on === 'b1';
        cutB = endpointCut(B, ev.segB, isFirst, ev.x, ev.y);
        const tA = paramOnSegment(A, ev.segA, ev.x, ev.y);
        cutA = findOrCreateCut(A, ev.segA, tA, ev.x, ev.y);
      }
      ev.cutA = cutA;
      ev.cutB = cutB;
      unionPairs.push([cutA, cutB]);
    } else if (ev.kind === 'overlap') {
      // Trechos colineares e sobrepostos. As duas partes representam o MESMO
      // corredor viário (o mesmo eixo desenhado duas vezes, ou uma rua e o
      // trecho compartilhado com outra). Recorta-se as duas nos extremos do
      // trecho sobreposto e uni-se os nós correspondentes: assim o corredor
      // compartilhado vira UMA aresta (a cópia redundante é eliminada na
      // etapa de higiene) e as duas partes continuam conectadas.
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      const cutsA = [];
      const cutsB = [];
      for (const [px, py] of [
        [ev.ax, ev.ay],
        [ev.bx, ev.by],
      ]) {
        const tA = paramOnSegment(A, ev.segA, px, py);
        const tB = paramOnSegment(B, ev.segB, px, py);
        cutsA.push(findOrCreateCut(A, ev.segA, tA, px, py));
        cutsB.push(findOrCreateCut(B, ev.segB, tB, px, py));
      }
      unionPairs.push([cutsA[0], cutsB[0]]);
      unionPairs.push([cutsA[1], cutsB[1]]);
    } else if (ev.kind === 'snap') {
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      const cutB = findOrCreateCut(B, ev.segB, ev.tB, ev.x, ev.y);
      const vertexCut = A.cuts.find(
        (c) => c.vertexCut && c.vertexIdx === ev.vertexA
      );
      ev.cutA = vertexCut;
      ev.cutB = cutB;
      if (vertexCut) unionPairs.push([vertexCut, cutB]);
    } else if (ev.kind === 'connector') {
      // CONECTOR: as duas pontas ficam exatamente onde estão (a geometria
      // original não é tocada) e a ligação é feita por um trecho curto, com
      // o comprimento real da lacuna. Os dois nós NÃO são fundidos: são
      // dois nós distintos ligados por uma aresta.
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      const vertexCut = A.cuts.find(
        (c) => c.vertexCut && c.vertexIdx === ev.vertexA
      );
      let cutB;
      if (ev.vertexB !== undefined) {
        // contato com a EXTREMIDADE de B
        cutB = B.cuts.find((c) => c.vertexCut && c.vertexIdx === ev.vertexB);
        if (!cutB) {
          // ainda não há corte nesse vértice: cria no ponto exato do
          // contato (o parâmetro t precisa ser o do ponto de contato, e
          // não 0 — o corte nasceria na posição errada).
          cutB = findOrCreateCut(B, ev.segB, ev.tB, ev.bx, ev.by);
        }
      } else {
        // contato com o INTERIOR de B: B é partido no ponto de projeção
        cutB = findOrCreateCut(B, ev.segB, ev.tB, ev.bx, ev.by);
      }
      ev.cutA = vertexCut;
      ev.cutB = cutB;
      if (vertexCut && cutB) {
        connectorEvents.push({
          cutA: vertexCut,
          cutB,
          // ponta do conector: o ponto de contato com o outro eixo
          bx: ev.bx,
          by: ev.by,
          gap: ev.gap,
          // a extremidade de A é a última (vertexA = nVerts-1) ou a primeira
          atStart: ev.vertexA === 0,
          vertexA: ev.vertexA,
          partId: A.pid,
          props: A.props,
          featureId: A.featureId,
        });
      }
    } else if (ev.kind === 'merge') {
      const A = parts[ev.pidA];
      const B = parts[ev.pidB];
      const cutA = A.cuts.find((c) => c.vertexCut && c.vertexIdx === ev.vertexA);
      const cutB = B.cuts.find((c) => c.vertexCut && c.vertexIdx === ev.vertexB);
      ev.cutA = cutA;
      ev.cutB = cutB;
      if (cutA && cutB) unionPairs.push([cutA, cutB]);
    }
  }

  /* --- ordena e normaliza os cortes --- */
  //
  // IMPORTANTE: quando dois cortes coincidem (mesma posicao ao longo do
  // eixo), apenas um sobrevive. Os cortes descartados precisam ser
  // "canonizados" para o representante: caso contrario, qualquer unionPair
  // que referencie o corte descartado perderia a juncao silenciosamente --
  // foi exatamente o que fraturou a rede em componentes separados.
  let totalPorts = 0;
  const canonicalOf = new Map();
  for (const part of parts) {
    part.cuts.sort((a, b) => a.dist - b.dist);
    const unique = [];
    for (const cut of part.cuts) {
      const last = unique[unique.length - 1];
      if (last && Math.abs(last.dist - cut.dist) < 1e-6) {
        // mantem o corte com porta mais confiavel (vertexCut tem prioridade)
        let survivor = last;
        let discarded = cut;
        if (cut.vertexCut && !last.vertexCut) {
          survivor = cut;
          discarded = last;
          unique[unique.length - 1] = cut;
        }
        canonicalOf.set(discarded, survivor);
        continue;
      }
      unique.push(cut);
    }
    part.cuts = unique;
    part.portBase = totalPorts;
    part.portCount = unique.length;
    totalPorts += unique.length;

    // associa a porta a cada corte sobrevivente
    part.cuts.forEach((cut, i) => {
      cut.port = part.portBase + i;
    });
  }

  /** resolve um corte para o corte canonico (representante) */
  const resolveCut = (cut) => {
    if (!cut) return null;
    let c = cut;
    const seen = new Set();
    while (canonicalOf.has(c) && !seen.has(c)) {
      seen.add(c);
      c = canonicalOf.get(c);
    }
    return c;
  };
  /* --- union-find --- */
  const uf = new UnionFind(totalPorts);
  let unionsApplied = 0;
  let unionsLost = 0;
  for (const [a0, b0] of unionPairs) {
    const a = resolveCut(a0);
    const b = resolveCut(b0);
    if (a && b && a.port !== undefined && b.port !== undefined) {
      uf.union(a.port, b.port);
      unionsApplied++;
    } else {
      unionsLost++;
    }
  }

  /* --- 6. CRIAÇÃO DOS NÓS --- */
  const nodeIndexByRoot = new Map();
  const nodes = [];
  const nodeOfPort = new Int32Array(totalPorts);

  for (const part of parts) {
    for (const cut of part.cuts) {
      const root = uf.find(cut.port);
      let nodeIdx = nodeIndexByRoot.get(root);
      if (nodeIdx === undefined) {
        nodeIdx = nodes.length;
        nodeIndexByRoot.set(root, nodeIdx);
        nodes.push({ id: nodeIdx, x: cut.x, y: cut.y, lon: 0, lat: 0, memberCount: 0 });
      }
      nodeOfPort[cut.port] = nodeIdx;
      nodes[nodeIdx].memberCount++;
    }
  }

  // recalibra a posição dos nós pela média das portas membros
  const acc = nodes.map(() => ({ x: 0, y: 0, n: 0 }));
  for (const part of parts) {
    for (const cut of part.cuts) {
      const ni = nodeOfPort[cut.port];
      acc[ni].x += cut.x;
      acc[ni].y += cut.y;
      acc[ni].n++;
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (acc[i].n > 0) {
      nodes[i].x = acc[i].x / acc[i].n;
      nodes[i].y = acc[i].y / acc[i].n;
    }
    const [lon, lat] = unproject(nodes[i].x, nodes[i].y);
    nodes[i].lon = lon;
    nodes[i].lat = lat;
  }

  /* --- 7. CORTE DAS PARTES E CRIAÇÃO DAS ARESTAS --- */
  const edges = [];
  for (const part of parts) {
    const expanded = [];
    // constrói a lista de vértices com os cortes inseridos
    let cutIdx = 0;
    for (let k = 0; k < part.nVerts - 1; k++) {
      const ax = part.xy[k * 2];
      const ay = part.xy[k * 2 + 1];
      const bx = part.xy[k * 2 + 2];
      const by = part.xy[k * 2 + 3];
      const segLen = dist(ax, ay, bx, by);

      // vértice original k (é nó se for o primeiro ou um corte em vértice)
      const vertexCut = part.cuts.find(
        (c) => c.vertexCut && c.vertexIdx === k
      );
      expanded.push({
        x: ax,
        y: ay,
        node: vertexCut ? nodeOfPort[vertexCut.port] : null,
      });

      // cortes internos do segmento k
      const internal = [];
      while (cutIdx < part.cuts.length) {
        const c = part.cuts[cutIdx];
        if (c.vertexCut) {
          cutIdx++;
          continue;
        }
        if (c.segIdx < k) {
          cutIdx++;
          continue;
        }
        if (c.segIdx > k) break;
        internal.push(c);
        cutIdx++;
      }
      internal.sort((p, q) => p.t - q.t);
      for (const c of internal) {
        expanded.push({
          x: ax + (bx - ax) * c.t,
          y: ay + (by - ay) * c.t,
          node: nodeOfPort[c.port],
        });
      }
    }
    // último vértice
    const lastCut = part.cuts[part.cuts.length - 1];
    expanded.push({
      x: part.xy[(part.nVerts - 1) * 2],
      y: part.xy[(part.nVerts - 1) * 2 + 1],
      node: nodeOfPort[lastCut.port],
    });

    // arestas entre nós consecutivos
    let prevNode = null;
    let prevIdx = -1;
    for (let i = 0; i < expanded.length; i++) {
      const entry = expanded[i];
      if (entry.node === null) continue;
      if (prevNode !== null && prevNode !== entry.node) {
        const seg = expanded.slice(prevIdx, i + 1);
        const length = polylineLengthOf(seg);
        if (length > 1e-6) {
          edges.push({
            id: edges.length,
            from: prevNode,
            to: entry.node,
            length,
            featureId: part.featureId,
            props: part.props,
            partId: part.pid,
            coords: seg.map((p) => [p.x, p.y]),
          });
        }
      }
      prevNode = entry.node;
      prevIdx = i;
    }
  }

  /* --- 7b. ARESTAS DE CONEXÃO (lacunas preenchidas) --- */
  //
  // Um conector liga a ponta de um eixo ao ponto de contato com outro eixo.
  // A geometria dos dois eixos permanece INTACTA: o conector é um trecho
  // próprio, com o comprimento real da lacuna, de modo que a distância
  // calculada corresponde ao que se percorre a pé.
  for (const conn of connectorEvents) {
    const cutA = resolveCut(conn.cutA);
    const cutB = resolveCut(conn.cutB);
    if (!cutA || !cutB) continue;
    const nodeA = nodeOfPort[cutA.port];
    const nodeB = nodeOfPort[cutB.port];
    if (nodeA === undefined || nodeB === undefined) continue;
    if (nodeA === nodeB) continue; // já estão fundidos: nada a fazer

    // As posições dos CORTES são a fonte da verdade: garantem que o
    // conector é geometricamente coerente com os nós aos quais se liga.
    const ax = cutA.x;
    const ay = cutA.y;
    const bx = cutB.x;
    const by = cutB.y;

    const length = dist(ax, ay, bx, by);
    if (length < 1e-6) continue;

    const coords = conn.atStart
      ? [[bx, by], [ax, ay]]
      : [[ax, ay], [bx, by]];
    const from = conn.atStart ? nodeB : nodeA;
    const to = conn.atStart ? nodeA : nodeB;

    edges.push({
      id: edges.length,
      from,
      to,
      length,
      featureId: conn.featureId,
      props: conn.props,
      partId: -1,
      coords,
      connector: true,
    });
  }

  return {
    nodes,
    edges,
    uf,
    nodeOfPort,
    rejectedCrossings,
    unionsApplied,
    unionsLost,
    connectors: connectorEvents.length,
  };
}

function polylineLengthOf(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return total;
}

/**
 * Parâmetro t do ponto (x,y) sobre o segmento segIdx da parte.
 */
function paramOnSegment(part, segIdx, x, y) {
  const xy = part.xy;
  const ax = xy[segIdx * 2];
  const ay = xy[segIdx * 2 + 1];
  const bx = xy[segIdx * 2 + 2];
  const by = xy[segIdx * 2 + 3];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
  return Math.min(1, Math.max(0, t));
}

/* ------------------------------------------------------------------ */
/* 8. HIGIENE: DUPLICIDADES E COMPONENTES                              */
/* ------------------------------------------------------------------ */

/** Ponto médio (em comprimento) de uma aresta. */
function edgeMidpoint(edge) {
  const target = edge.length / 2;
  let acc = 0;
  for (let i = 1; i < edge.coords.length; i++) {
    const [x1, y1] = edge.coords[i - 1];
    const [x2, y2] = edge.coords[i];
    const d = dist(x1, y1, x2, y2);
    if (acc + d >= target) {
      const t = d > 0 ? (target - acc) / d : 0;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    acc += d;
  }
  const last = edge.coords[edge.coords.length - 1];
  return [last[0], last[1]];
}

/**
 * Remove arestas comprovadamente duplicadas.
 *
 * Duplicata = mesmo par de nós + mesmo comprimento + mesmo ponto médio.
 * Ruas paralelas legítimas têm pontos médios diferentes e são preservadas.
 */
function removeDuplicateEdges(edges, options) {
  const groups = new Map();
  for (const e of edges) {
    const key = e.from <= e.to ? `${e.from}_${e.to}` : `${e.to}_${e.from}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(e);
  }

  const removed = [];
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const survivors = [];
    for (const e of group) {
      const mid = edgeMidpoint(e);
      let dup = null;
      for (const s of survivors) {
        const sMid = edgeMidpoint(s);
        if (
          Math.abs(s.length - e.length) <= options.duplicateLengthTolerance &&
          dist(mid[0], mid[1], sMid[0], sMid[1]) <= options.duplicateMidpointTolerance
        ) {
          dup = s;
          break;
        }
      }
      if (dup) {
        removed.push({
          keptFeatureId: dup.featureId,
          removedFeatureId: e.featureId,
          keptStreet: dup.props?.DSC_LOGRADOURO,
          removedStreet: e.props?.DSC_LOGRADOURO,
          length: e.length,
        });
      } else {
        survivors.push(e);
      }
    }
    kept.push(...survivors);
  }

  // reindexa os ids das arestas mantidas
  kept.forEach((e, i) => {
    e.id = i;
  });
  return { edges: kept, removed };
}

/** Calcula componentes conexas do grafo (não direcionado). */
function computeComponents(nodes, edges) {
  const adj = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) {
    adj[e.from].push(e.to);
    adj[e.to].push(e.from);
  }
  const comp = new Int32Array(nodes.length).fill(-1);
  const sizes = [];
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const v = stack.pop();
      size++;
      for (const w of adj[v]) {
        if (comp[w] === -1) {
          comp[w] = id;
          stack.push(w);
        }
      }
    }
    sizes.push(size);
  }
  return { comp, sizes, adj };
}

/* ------------------------------------------------------------------ */
/* API PRINCIPAL                                                       */
/* ------------------------------------------------------------------ */

/**
 * Constrói o grafo viário a partir de uma FeatureCollection GeoJSON.
 *
 * @param {Array} features array de features GeoJSON
 * @param {object} [options]
 * @returns {object} grafo pronto para roteamento
 */
export function buildGraph(features, options = {}) {
  const opts = { ...GRAPH_DEFAULTS, ...options };

  const { parts, diagnostics: normDiag } = normalizeParts(features, opts);

  if (parts.length === 0) {
    return {
      nodes: [],
      edges: [],
      adjacency: [],
      edgeIndex: null,
      diagnostics: { ...normDiag, crossings: 0, snaps: 0, merges: 0, rejectedCrossings: [] },
      options: opts,
    };
  }

  const bbox = computeBBox(parts);
  // célula ~ 60 m: média de poucos segmentos por célula, boa seletividade
  const cellSize = 60;
  const index = buildSegmentIndex(parts, bbox, cellSize);

  const intersections = detectIntersections(parts, index, opts.intersectEpsilon);
  const snaps = detectSnapEvents(parts, index, opts.snapTolerance, opts.junctionTolerance);
  const events = [...intersections, ...snaps];

  const {
    nodes,
    edges,
    rejectedCrossings,
    unionsApplied,
    unionsLost,
  } = assembleGraph(parts, events, opts);

  const { edges: cleanEdges, removed } = removeDuplicateEdges(edges, opts);

  // adjacência não direcionada (rotas a pé)
  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (const e of cleanEdges) {
    adjacency[e.from].push({ edge: e.id, to: e.to, length: e.length });
    adjacency[e.to].push({ edge: e.id, to: e.from, length: e.length });
  }

  const { comp, sizes } = computeComponents(nodes, cleanEdges);

  // índice espacial das arestas (para localizar origem/destino)
  const edgeIndex = buildEdgeIndex(nodes, cleanEdges);

  const diagnostics = {
    ...normDiag,
    nodes: nodes.length,
    edges: cleanEdges.length,
    crossings: events.filter((e) => e.kind === 'cross').length,
    touches: events.filter((e) => e.kind === 'touch').length,
    overlaps: events.filter((e) => e.kind === 'overlap').length,
    snaps: events.filter((e) => e.kind === 'snap').length,
    merges: events.filter((e) => e.kind === 'merge').length,
    connectors: events.filter((e) => e.kind === 'connector').length,
    junctionsUnified: unionsApplied,
    junctionsLost: unionsLost,
    duplicatesRemoved: removed.length,
    duplicateDetails: removed.slice(0, 50),
    rejectedCrossings: rejectedCrossings.slice(0, 50),
    rejectedCrossingsCount: rejectedCrossings.length,
    components: sizes.length,
    largestComponent: sizes.length ? Math.max(...sizes) : 0,
    isolatedNodes: sizes.filter((s) => s === 1).length,
    componentSizes: sizes.slice().sort((a, b) => b - a).slice(0, 10),
    bbox: [unproject(bbox[0], bbox[3]), unproject(bbox[2], bbox[1])].flat(),
  };

  return {
    nodes,
    edges: cleanEdges,
    metricBbox: bbox,
    adjacency,
    componentOf: comp,
    edgeIndex,
    parts,
    diagnostics,
    options: opts,
  };
}

/**
 * Índice espacial sobre os segmentos das arestas.
 * Usado para encontrar a aresta mais próxima de um ponto.
 */
export function buildEdgeIndex(nodes, edges) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  if (!Number.isFinite(minX)) return null;

  const index = new GridIndex([minX, minY, maxX, maxY], 60);
  for (const e of edges) {
    for (let i = 1; i < e.coords.length; i++) {
      const [x1, y1] = e.coords[i - 1];
      const [x2, y2] = e.coords[i];
      index.insert(
        { edgeId: e.id, segIdx: i - 1 },
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2)
      );
    }
  }
  return index;
}

export { closestPointOnPart, classifySegmentPair, detectIntersections, detectSnapEvents };
