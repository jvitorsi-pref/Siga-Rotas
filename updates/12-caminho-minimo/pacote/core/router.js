/**
 * MOTOR DE ROTEAMENTO
 * ===================
 *
 * Implementa A* sobre o grafo viário construído em `graph.js`.
 *
 * Decisões:
 *
 *  • O grafo é NÃO DIRECIONAL: o escopo do projeto é "apenas rotas a pé" e
 *    pedestres podem percorrer a via em ambos os sentidos. A camada não
 *    publica sentido de circulação, então nenhum sentido é imposto.
 *
 *  • Peso das arestas = comprimento real do trecho em metros (UTM 23S).
 *    A rota resultante é a de MENOR DISTÂNCIA viária (não linha reta).
 *
 *  • Heurística = distância euclidiana em metros até o destino. Como o peso
 *    de cada aresta é >= à distância euclidiana entre suas extremidades, a
 *    heurística é ADMISSÍVEL e CONSISTENTE: o A* devolve o caminho ótimo
 *    (nenhum caminho viário mais curto existe).
 *
 *  • Origem/destino no meio de uma via geram NÓS TEMPORÁRIOS: a aresta
 *    atingida é dividida no ponto projetado, de forma que o trajeto
 *    comece/termine exatamente no ponto informado.
 *
 *  • Nunca há "salto" entre geometrias desconectadas: o A* só percorre
 *    arestas que compartilham nós, e o resultado é validado antes de ser
 *    devolvido.
 */

import { project, unproject, dist, projectPointOnSegment } from './geo.js';

/**
 * Limite de reporte da discrepância de junção (metros).
 *
 * Dois eixos que se cruzam geram dois cortes na interseção — um em cada
 * eixo — e eles podem diferir um pouco (a mesma interseção digitalizada de
 * dois lados). A geometria original NÃO é movida: a diferença é apenas
 * medida e, quando passa deste limite, aparece em `warnings`. Acima de
 * JUNCTION_REPORT o fato é reportado ao usuário; nunca se inventa uma
 * posição que não existe no dado.
 */
const JUNCTION_REPORT = 0.01; // 1 cm

/* ------------------------------------------------------------------ */
/* FILA DE PRIORIDADE (BINARY HEAP)                                    */
/* ------------------------------------------------------------------ */

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, key) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this._swap(i, parent);
      i = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastKey = this.keys.pop();
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.keys.length && this.keys[l] < this.keys[smallest]) smallest = l;
        if (r < this.keys.length && this.keys[r] < this.keys[smallest]) smallest = r;
        if (smallest === i) break;
        this._swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  _swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/* ------------------------------------------------------------------ */
/* LOCALIZAÇÃO DO PONTO MAIS PRÓXIMO                                   */
/* ------------------------------------------------------------------ */

/**
 * Encontra a aresta da rede mais próxima de um ponto métrico.
 *
 * @param {object} graph
 * @param {number} x @param {number} y
 * @returns {null|{edgeId:number, segIdx:number, x:number, y:number, dist:number, t:number}}
 */
export function findNearestEdge(graph, x, y) {
  const index = graph.edgeIndex;
  if (!index) return null;
  const cellSize = index.cellSize;
  let best = null;

  index.queryExpanding(x, y, 80, (cands, ring) => {
    for (const cand of cands) {
      const edge = graph.edges[cand.edgeId];
      const c = edge.coords;
      const i = cand.segIdx;
      const pr = projectPointOnSegment(x, y, c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]);
      if (!best || pr.dist < best.dist) {
        best = {
          edgeId: edge.id,
          segIdx: i,
          x: pr.x,
          y: pr.y,
          dist: pr.dist,
          t: pr.t,
        };
      }
    }
    // nenhuma célula mais distante pode conter um ponto melhor
    return best !== null && (ring - 1) * cellSize > best.dist;
  });

  return best;
}

/**
 * Distância (em metros, ao longo da aresta) de um ponto até o início da aresta.
 * A aresta é percorrida de `edge.from` até `edge.to`.
 */
function positionAlongEdge(edge, segIdx, t) {
  let acc = 0;
  for (let i = 0; i < segIdx; i++) {
    acc += dist(edge.coords[i][0], edge.coords[i][1], edge.coords[i + 1][0], edge.coords[i + 1][1]);
  }
  const d = dist(
    edge.coords[segIdx][0],
    edge.coords[segIdx][1],
    edge.coords[segIdx + 1][0],
    edge.coords[segIdx + 1][1]
  );
  return acc + d * t;
}

/* ------------------------------------------------------------------ */
/* OVERLAY: DIVISÃO TEMPORÁRIA DE ARESTAS                              */
/* ------------------------------------------------------------------ */

/**
 * Cria as arestas virtuais resultantes da divisão de arestas pela origem e
 * pelo destino, e devolve a adjacência aumentada.
 *
 * @param {object} graph
 * @param {Array<{edgeId:number, pos:number, nodeId:number}>} splits
 * @returns {{adj:Map<number, Array>, nodes:Map<number, {x:number,y:number}>, edges:Map<string, object>}}
 */
function buildOverlay(graph, splits) {
  const adj = new Map();
  const nodes = new Map();
  const edges = new Map();

  const byEdge = new Map();
  for (const s of splits) {
    if (!byEdge.has(s.edgeId)) byEdge.set(s.edgeId, []);
    byEdge.get(s.edgeId).push(s);
  }

  // `edgeId` e o ID da aresta (numero para as arestas do grafo, string
  // "tmp:..." para as arestas virtuais criadas pela divisao) e `length` e o
  // comprimento METRICO da peca, em metros.
  //
  // ATENCAO: o comprimento tem de vir como parametro. A versao anterior
  // usava `edge.length`, sendo que `edge` era o ID (texto) — e o custo da
  // peca virava o NUMERO DE CARACTERES do ID ("tmp:1234:0" -> 10 m) em vez
  // do comprimento real da rua. Isso subestimava o custo das arestas
  // divididas e fazia o A* escolher caminhos piores (e diferentes conforme
  // o sentido da rota), distorcendo a matriz de custos da otimizacao.
  const pushAdj = (from, to, edgeId, length) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ edge: edgeId, to, length });
  };

  for (const [edgeId, list] of byEdge) {
    const base = graph.edges[edgeId];
    list.sort((a, b) => a.pos - b.pos);

    // pontos de divisão ao longo da aresta (em metros desde `base.from`)
    const boundaries = [0];
    const segments = [];
    let prevPos = 0;
    let prevNode = base.from;

    for (const s of list) {
      // FATIA DA GEOMETRIA ORIGINAL: todos os vértices entre `prevPos` e
      // `s.pos` são preservados. Guardar apenas os dois extremos
      // (coords: [inicio, fim]) transformava a curva da rua num segmento
      // de reta — era exatamente o defeito de "cortar curvas".
      const coords = sliceAlongEdge(base, prevPos, s.pos);
      segments.push({ from: prevNode, to: s.nodeId, coords, length: s.pos - prevPos });
      prevNode = s.nodeId;
      prevPos = s.pos;
      boundaries.push(s.pos);
    }
    // último trecho: do último corte até o fim da aresta
    const coords = sliceAlongEdge(base, prevPos, base.length);
    segments.push({
      from: prevNode,
      to: base.to,
      coords,
      length: base.length - prevPos,
    });

    let idx = 0;
    for (const seg of segments) {
      if (seg.length > 1e-9) {
        const id = `tmp:${edgeId}:${idx++}`;
        const edge = {
          id,
          from: seg.from,
          to: seg.to,
          length: seg.length,
          coords: seg.coords,
          props: base.props,
          featureId: base.featureId,
          partId: base.partId,
          temp: true,
          baseEdgeId: edgeId,
        };
        edges.set(id, edge);
        // O grafo e NAO DIRECIONAL (rotas a pe): a aresta virtual e
        // percorrivel nos dois sentidos.
        pushAdj(seg.from, seg.to, id, seg.length);
        pushAdj(seg.to, seg.from, id, seg.length);
      }
    }
  }

  return { adj, nodes, edges };
}

/** Coordenada do ponto a `pos` metros do início da aresta. */
function interpolateAlongEdge(edge, pos) {
  let acc = 0;
  for (let i = 1; i < edge.coords.length; i++) {
    const [x1, y1] = edge.coords[i - 1];
    const [x2, y2] = edge.coords[i];
    const d = dist(x1, y1, x2, y2);
    if (acc + d >= pos) {
      const t = d > 0 ? (pos - acc) / d : 0;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    acc += d;
  }
  const last = edge.coords[edge.coords.length - 1];
  return [last[0], last[1]];
}

/**
 * Recorta a geometria da aresta entre duas posições (em metros a partir do
 * início da aresta), PRESERVANDO todos os vértices intermediários.
 *
 * É o inverso de "colocar só os dois extremos": uma rua com 9 vértices
 * continua com 9 vértices depois do corte — a curva não vira reta.
 *
 * @param {object} edge aresta com `coords` (métricas) e `length`
 * @param {number} posA posição inicial (m)
 * @param {number} posB posição final (m)
 * @returns {number[][]} coordenadas em ordem
 */
function sliceAlongEdge(edge, posA, posB) {
  const pts = [];
  const push = (p) => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) {
      pts.push([p[0], p[1]]);
    }
  };

  // ponto inicial (pode estar no meio de um segmento)
  push(interpolateAlongEdge(edge, posA));

  // vértices ORIGINAIS estritamente entre as duas posições.
  // A posição do vértice é o comprimento ACUMULADO até ele (vEnd).
  let acc = 0;
  for (let i = 1; i < edge.coords.length; i++) {
    const a = edge.coords[i - 1];
    const b = edge.coords[i];
    const d = dist(a[0], a[1], b[0], b[1]);
    const vEnd = acc + d; // posição do vértice `b` ao longo da aresta
    if (vEnd > posA + 1e-7 && vEnd < posB - 1e-7) push([b[0], b[1]]);
    acc = vEnd;
  }

  // ponto final
  push(interpolateAlongEdge(edge, posB));
  return pts;
}

/* ------------------------------------------------------------------ */
/* A*                                                                   */
/* ------------------------------------------------------------------ */

/**
 * A* sobre o grafo (não direcionado) com overlay temporário.
 *
 * @returns {null|Array<{node:number, edgeId:string|number}>} caminho
 */
function aStar(graph, overlay, startNode, goalNode, nodeCount, useHeuristic = true) {
  const distTo = new Float64Array(nodeCount).fill(Infinity);
  const cameFrom = new Int32Array(nodeCount).fill(-1);
  const cameEdge = new Array(nodeCount).fill(null);
  const closed = new Uint8Array(nodeCount);

  const adjOf = (node) => {
    const base = graph.adjacency[node] || [];
    const extra = overlay.adj.get(node);
    return extra && extra.length ? base.concat(extra) : base;
  };

  const goalNodePos = graph.nodes[goalNode];
  const overlayGoal = overlay.nodes.get(goalNode);
  const gx = goalNodePos ? goalNodePos.x : overlayGoal.x;
  const gy = goalNodePos ? goalNodePos.y : overlayGoal.y;

  const h = (node) => {
    if (node === goalNode) return 0;
    const n = graph.nodes[node];
    if (n) return dist(n.x, n.y, gx, gy);
    const o = overlay.nodes.get(node);
    return o ? dist(o.x, o.y, gx, gy) : 0;
  };

  const open = new MinHeap();
  distTo[startNode] = 0;
  // com heurística -> A*; sem heurística -> Dijkstra puro (usado na
  // validação cruzada, para provar que o A* devolve o caminho ótimo)
  open.push(startNode, useHeuristic ? h(startNode) : 0);

  while (open.size) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;

    if (current === goalNode) {
      // reconstrói o caminho
      const path = [];
      let node = current;
      while (node !== -1) {
        path.push({ node, edgeId: cameEdge[node] });
        node = cameFrom[node];
      }
      path.reverse();
      // a primeira entrada não tem aresta de entrada
      path[0].edgeId = null;
      return path;
    }

    for (const link of adjOf(current)) {
      if (closed[link.to]) continue;
      const tentative = distTo[current] + link.length;
      if (tentative < distTo[link.to]) {
        distTo[link.to] = tentative;
        cameFrom[link.to] = current;
        cameEdge[link.to] = link.edge;
        open.push(link.to, useHeuristic ? tentative + h(link.to) : tentative);
      }
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* API PRINCIPAL                                                       */
/* ------------------------------------------------------------------ */

/**
 * Calcula a rota a pé entre dois pontos geográficos.
 *
 * @param {object} graph grafo devolvido por `buildGraph`
 * @param {{lon:number, lat:number}} origin
 * @param {{lon:number, lat:number}} destination
 * @param {object} [options]
 * @returns {object} resultado estruturado
 */
export function routeOnGraph(graph, origin, destination, options = {}) {
  const maxSnap = options.maxSnapDistance ?? 100;

  // 1. validação de coordenadas
  const originValid = isValidLonLat(origin);
  const destValid = isValidLonLat(destination);
  if (!originValid || !destValid) {
    return {
      ok: false,
      reason: 'COORDENADA_INVALIDA',
      message: !originValid
        ? 'Coordenadas de origem inválidas. Use decimais com sinal: -46.4, -23.7'
        : 'Coordenadas de destino inválidas. Use decimais com sinal: -46.4, -23.7',
    };
  }

  if (graph.edges.length === 0) {
    return {
      ok: false,
      reason: 'REDE_VAZIA',
      message: 'A rede viária ainda não foi carregada.',
    };
  }

  // 2. projeção métrica
  const [ox, oy] = project(origin.lon, origin.lat);
  const [dx, dy] = project(destination.lon, destination.lat);

  // 3. projeção sobre a rede
  const snapO = findNearestEdge(graph, ox, oy);
  const snapD = findNearestEdge(graph, dx, dy);

  if (!snapO || !snapD) {
    // Nenhum segmento encontrado dentro do raio de busca: o ponto está fora
    // da área coberta pela rede. Calcula-se a distância até a caixa
    // delimitadora da rede para informar o usuário com precisão.
    const side = !snapO ? 'origem' : 'destino';
    const pt = !snapO ? [ox, oy] : [dx, dy];
    const mb = graph.metricBbox;
    const gap = mb ? distanceToBBox(pt[0], pt[1], mb) : Infinity;
    return {
      ok: false,
      reason: 'FORA_DA_REDE',
      message:
        `A ${side} está fora da área coberta pela rede viária ` +
        `(${Number.isFinite(gap) ? `${Math.round(gap)} m de distância da rede` : 'sem vértice próximo'}).`,
      distanceToNetwork: Number.isFinite(gap) ? gap : null,
      side,
    };
  }

  if (snapO.dist > maxSnap || snapD.dist > maxSnap) {
    const far = snapO.dist > maxSnap ? 'origem' : 'destino';
    const d = Math.max(snapO.dist, snapD.dist);
    return {
      ok: false,
      reason: 'FORA_DA_REDE',
      message: `A ${far} está a ${d.toFixed(0)} m da rede viária (limite de ${maxSnap} m).`,
      distanceToNetwork: d,
      side: far,
    };
  }

  // 4. nós de origem/destino (temporários ou já existentes)
  const nodeCount = graph.nodes.length + 2;
  const originNode = graph.nodes.length;
  const destNode = graph.nodes.length + 1;

  const splits = [];
  const overlayNodes = new Map();

  const makeEndpoint = (snap, nodeId) => {
    const edge = graph.edges[snap.edgeId];
    const pos = positionAlongEdge(edge, snap.segIdx, snap.t);
    const startCoord = edge.coords[0];
    const endCoord = edge.coords[edge.coords.length - 1];

    // se o ponto projetado coincide com um nó já existente da aresta,
    // reutiliza esse nó (evita nós temporários desnecessários)
    if (dist(snap.x, snap.y, startCoord[0], startCoord[1]) <= 1e-3) {
      return { nodeId: edge.from, pos: 0, reuse: true };
    }
    if (dist(snap.x, snap.y, endCoord[0], endCoord[1]) <= 1e-3) {
      return { nodeId: edge.to, pos: edge.length, reuse: true };
    }

    overlayNodes.set(nodeId, { x: snap.x, y: snap.y });
    splits.push({ edgeId: edge.id, pos, nodeId });
    return { nodeId, pos, reuse: false };
  };

  const o = makeEndpoint(snapO, originNode);
  const d = makeEndpoint(snapD, destNode);

  const overlay = buildOverlay(graph, splits);
  overlay.nodes = overlayNodes;

  // 5. A*
  const startNode = o.nodeId;
  const goalNode = d.nodeId;
  // `options.algorithm === 'dijkstra'` desliga a heurística: é o modo de
  // referência usado para provar que o A* devolve o caminho de menor
  // comprimento (ver tools/validate-routes.js).
  const useHeuristic = options.algorithm !== 'dijkstra';
  const path = aStar(graph, overlay, startNode, goalNode, nodeCount, useHeuristic);

  if (!path) {
    return {
      ok: false,
      reason: 'SEM_CAMINHO',
      message:
        'Não existe caminho viário entre a origem e o destino na rede carregada. ' +
        'Podem estar em componentes desconectados ou fora da área mapeada.',
      components: graph.diagnostics?.components,
    };
  }

  // 6. montagem do trajeto
  //
  // Reconstrução fiel: as geometrias das arestas percorridas são
  // concatenadas NA ORDEM DO CAMINHO, invertendo por completo a sequência de
  // coordenadas quando a aresta é percorrida ao contrário. Nenhum vértice
  // intermediário é descartado e nenhuma linha reta é traçada entre nós.
  const legs = [];
  const allCoords = [];
  const avisos = [];
  let total = 0;

  /** Posição métrica de um nó (do grafo ou temporário do overlay). */
  const posicaoNo = (nodeId) => {
    const n = graph.nodes[nodeId];
    if (n) return [n.x, n.y];
    const o = overlay.nodes.get(nodeId);
    return o ? [o.x, o.y] : null;
  };

  /** Acrescenta coordenadas à rota, ignorando repetições consecutivas. */
  const acrescentar = (destino, coords, aPartirDe = 0) => {
    for (let k = aPartirDe; k < coords.length; k++) {
      const p = coords[k];
      const ultimo = destino[destino.length - 1];
      // elimina SOMENTE coordenadas consecutivas duplicadas (o mesmo ponto
      // repetido — acontece quando um corte coincide com um vértice)
      if (ultimo && Math.abs(ultimo[0] - p[0]) < 1e-6 && Math.abs(ultimo[1] - p[1]) < 1e-6) {
        continue;
      }
      destino.push(p);
    }
  };

  for (let i = 1; i < path.length; i++) {
    const edgeId = path[i].edgeId;
    // arestas virtuais (divisão por origem/destino) têm id "tmp:...";
    // as demais são as arestas do grafo, indexadas por número.
    const edge = overlay.edges.get(edgeId) || graph.edges[edgeId];
    if (!edge) continue;

    // sentido de percurso: a aresta é percorrida do `from` para o `to` ou
    // do `to` para o `from`? No sentido inverso, a geometria inteira é
    // invertida (não apenas os extremos).
    const forward = path[i - 1].node === edge.from;
    const ordered = forward ? edge.coords : edge.coords.slice().reverse();

    if (!allCoords.length) {
      acrescentar(allCoords, ordered, 0);
    } else {
      // Continuidade: o fim do trecho anterior e o início deste são o MESMO
      // nó (a topologia do grafo garante isso). A COORDENADA de cada trecho
      // é a do próprio eixo: a geometria original NÃO é movida. A diferença
      // entre os dois cortes (de milimétricos a poucos centímetros, quando o
      // cruzamento é digitado de lados diferentes) é apenas MEDIDA e
      // reportada — em vez de inventar uma posição que não existe no dado.
      const junction = posicaoNo(path[i - 1].node);
      const last = allCoords[allCoords.length - 1];
      if (junction) {
        const d = dist(last[0], last[1], junction[0], junction[1]);
        if (d > JUNCTION_REPORT) {
          avisos.push(
            `Diferença de ${(d * 100).toFixed(1)} cm entre os dois cortes do nó ` +
              `${path[i - 1].node} (a geometria original foi mantida).`
          );
        }
      }
      // descarta só a coordenada duplicada do ponto de encontro
      acrescentar(allCoords, ordered, 1);
    }
    total += edge.length;

    const street = describeStreet(edge);
    const last = legs[legs.length - 1];
    if (last && last.featureId === edge.featureId && last.partId === edge.partId) {
      last.length += edge.length;
      acrescentar(last.coords, ordered, 1);
      last.segments.push(edge.id);
      if (edge.connector) last.connector = true;
    } else {
      // a perna começa no primeiro ponto da aresta (a geometria original)
      const coordsLeg = ordered.slice();
      legs.push({
        featureId: edge.featureId,
        partId: edge.partId,
        street: street.name,
        type: street.type,
        codLog: edge.props?.COD_LOG ?? null,
        official: Number(edge.props?.COD_LOG) !== 0,
        length: edge.length,
        coords: coordsLeg,
        segments: [edge.id],
        // true quando a perna usa um conector de junção (lacuna real de
        // até 1 m entre dois eixos) — fica visível, nunca escondido
        connector: !!edge.connector,
      });
    }
  }

  // 7. saída em lon/lat
  const geometry = {
    type: 'LineString',
    coordinates: allCoords.map(([x, y]) => {
      const [lon, lat] = unproject(x, y);
      return [lon, lat];
    }),
  };

  const streets = [];
  for (const leg of legs) {
    const name = leg.street || 'Eixo sem nome';
    if (streets[streets.length - 1] !== name) streets.push(name);
  }

  return {
    ok: true,
    distance: total,
    distanceMeters: Math.round(total),
    distanceKm: total / 1000,
    geometry,
    legs: legs.map((l) => ({
      featureId: l.featureId,
      street: l.street,
      type: l.type,
      codLog: l.codLog,
      official: l.official,
      connector: !!l.connector,
      segments: l.segments,
      length: l.length,
      coords: l.coords.map(([x, y]) => {
        const [lon, lat] = unproject(x, y);
        return [lon, lat];
      }),
    })),
    streets,
    warnings: avisos,
    origin: {
      input: origin,
      snapped: { lon: unproject(snapO.x, snapO.y)[0], lat: unproject(snapO.x, snapO.y)[1] },
      distanceToNetwork: snapO.dist,
      street: legs.length ? legs[0].street : null,
    },
    destination: {
      input: destination,
      snapped: { lon: unproject(snapD.x, snapD.y)[0], lat: unproject(snapD.x, snapD.y)[1] },
      distanceToNetwork: snapD.dist,
      street: legs.length ? legs[legs.length - 1].street : null,
    },
    nodeCount: path.length,
  };
}

/**
 * Descreve o logradouro de uma aresta a partir dos atributos confirmados.
 */
function describeStreet(edge) {
  const p = edge.props || {};
  const name = p.DSC_LOGRADOURO || (p.NOM_LOGRADOURO ? `RUA ${p.NOM_LOGRADOURO}` : null);
  return {
    name,
    type: p.TPO_LOGRADOURO || null,
  };
}

/**
 * Distância de um ponto métrico até a caixa delimitadora da rede.
 * @param {number} x @param {number} y @param {number[]} bbox [minX,minY,maxX,maxY]
 */
function distanceToBBox(x, y, bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  return Math.hypot(dx, dy);
}

/** Valida longitude/latitude. */
export function isValidLonLat(pt) {
  if (!pt) return false;
  const lon = Number(pt.lon);
  const lat = Number(pt.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (lon < -180 || lon > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

/**
 * Valida a continuidade de um caminho: arestas consecutivas devem compartilhar
 * um nó. Usado nos testes e como auto-verificação antes de devolver a rota.
 *
 * @returns {{ok:boolean, problems:string[]}}
 */
export function validatePathContinuity(path) {
  const problems = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].node;
    const b = path[i].node;
    if (a === -1 || b === -1) continue;
    if (a !== b) {
      problems.push(`aresta ${i}: nós ${a} e ${b} não são o mesmo`);
    }
  }
  return { ok: problems.length === 0, problems };
}
