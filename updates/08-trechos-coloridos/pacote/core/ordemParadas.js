/**
 * core/ordemParadas.js
 * ---------------------------------------------------------------------------
 * OTIMIZAÇÃO DA ORDEM DE VISITA DAS PARADAS.
 *
 * RELAÇÃO COM O CAXEIRO VIAJANTE (TSP):
 *
 *   • o motor de rota (A* / Dijkstra) resolve o **caminho mínimo entre dois
 *     pontos** do grafo — é o "caminho" do TSP;
 *   • o TSP resolve a **ordem de visita** de N paradas — é outro problema,
 *     construído SOBRE o primeiro: para avaliar uma ordem é preciso saber
 *     quanto custa ir de cada parada a cada outra, e esse custo é exatamente
 *     o comprimento do caminho mínimo no grafo.
 *
 *   Fecho métrico: D(i,j) = comprimento do caminho mínimo entre i e j.
 *   Como o grafo tem pesos métricos (≥ distância euclidiana), D satisfaz a
 *   desigualdade triangular — logo é um TSP **métrico**, e os algoritmos
 *   abaixo são válidos.
 *
 * O que NÃO é otimizado aqui: o caminho dentro de cada trecho (já é o
 * mínimo), a escolha do eixo (é a malha real) e a conexão de acesso do
 * endereço à rede (é a mais próxima, e é declarada).
 *
 *estratégia:
 *   • até 16 paradas intermediárias → **Held-Karp** (programação dinâmica sobre
 *     subconjuntos): resposta **exaata**;
 *   • acima disso → **vizinho mais próximo + 2-opt** (heurística), com
 *     aviso explícito no resultado — **nunca** se promete o ótimo global
 *     quando a heurística foi usada.
 *
 * A **quantidade de paradas é dinâmica**: nada no trajeto ou na interface
 * fixa um número de pontos. O único limite é `LIMITE_TOTAL`, que protege o
 * servidor de requisições enormes (cada par de pontos custa um caminho
 * mínimo na rede) e é declarado na resposta quando é atingido.
 *
 * A ordem do usuário **sempre** é respeitada por padrão: a otimização é um
 * modo alternativo, nunca uma surpresa.
 */

import { routeOnGraph } from './router.js';

/** Limite de paradas intermediárias para a solução exata (Held-Karp). */
export const LIMITE_EXATO = 16;
/**
 * Limite absoluto de pontos por requisição — **proteção do servidor**, não
 * limite da interface: a lista de paradas do trajeto é dinâmica e o usuário
 * pode acrescentar quantas quiser (a otimização é exata até 16 paradas
 * intermediárias e heurística acima disso, sempre declarada).
 * Cada par de pontos exige um caminho mínimo na rede, então o tempo cresce
 * com o quadrado do número de pontos.
 */
export const LIMITE_TOTAL = 80;

/**
 * Matriz de distâncias entre todos os pares de pontos (o fecho métrico).
 * Cada célula é o comprimento do **caminho mínimo** na rede viária.
 *
 * @param {object} graph
 * @param {Array<{latitude:number, longitude:number}>} pontos
 * @param {object} [options] repassado a `routeOnGraph`
 * @returns {{D: number[][], semCaminho: Array<[number,number]>, rotas: number, ms: number}}
 */
export function matrizDistancias(graph, pontos, options = {}) {
  const n = pontos.length;
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  const semCaminho = [];
  const inicio = Date.now();
  let rotas = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = routeOnGraph(
        graph,
        { lon: Number(pontos[i].longitude), lat: Number(pontos[i].latitude) },
        { lon: Number(pontos[j].longitude), lat: Number(pontos[j].latitude) },
        options,
      );
      if (!r.ok) {
        D[i][j] = D[j][i] = Infinity;
        semCaminho.push([i, j]);
        continue;
      }
      D[i][j] = D[j][i] = r.distance;
      rotas++;
    }
  }

  return { D, semCaminho, rotas, ms: Date.now() - inicio };
}

/**
 * Custo de uma ordem (origem fixa na posição 0, destino fixo no fim).
 * @param {number[][]} D matriz de distâncias
 * @param {number[]} ordem índices dos pontos na ordem visitada
 */
export function custoDaOrdem(D, ordem, inicio = 0, fim = null) {
  if (!ordem.length) return fim != null ? D[inicio][fim] : 0;
  let c = D[inicio][ordem[0]];
  for (let k = 0; k < ordem.length - 1; k++) c += D[ordem[k]][ordem[k + 1]];
  const ultimo = ordem[ordem.length - 1];
  return c + (fim != null ? D[ultimo][fim] : 0);
}

/**
 * Vizinho mais próximo: heurística clássica de construção.
 * @param {number[][]} D
 * @param {number[]} indices índices dos pontos a ordenar (intermediários)
 * @param {number} inicio índice do ponto inicial
 */
export function vizinhoMaisProximo(D, indices, inicio = 0) {
  const restantes = new Set(indices);
  const ordem = [];
  let atual = inicio;
  while (restantes.size) {
    let melhor = null;
    let melhorDist = Infinity;
    for (const c of restantes) {
      if (D[atual][c] < melhorDist) {
        melhorDist = D[atual][c];
        melhor = c;
      }
    }
    if (melhor === null) break;
    ordem.push(melhor);
    restantes.delete(melhor);
    atual = melhor;
  }
  return ordem;
}

/**
 * 2-opt: melhora a ordem trocando/reversando segmentos (delta de 2 pontos).
 * @param {number[][]} D
 * @param {number[]} ordem
 * @param {number} inicio
 * @param {number} fim
 */
export function doisOpt(D, ordem, inicio = 0, fim = -1) {
  const ultimo = fim < 0 ? ordem.length - 1 : fim;
  const base = (o) => {
    let c = D[inicio][o[0]];
    for (let k = 0; k < o.length - 1; k++) c += D[o[k]][o[k + 1]];
    return c + D[o[o.length - 1]][ultimo];
  };

  const atual = [...ordem];
  let melhor = base(atual);
  let mudou = true;
  let passadas = 0;
  while (mudou && passadas < 200) {
    mudou = false;
    passadas++;
    for (let i = 0; i < atual.length - 1; i++) {
      for (let j = i + 1; j < atual.length; j++) {
        const cand = [
          ...atual.slice(0, i),
          ...atual.slice(i, j + 1).reverse(),
          ...atual.slice(j + 1),
        ];
        const c = base(cand);
        if (c < melhor - 1e-6) {
          melhor = c;
          atual.splice(0, atual.length, ...cand);
          mudou = true;
        }
      }
    }
  }
  return { ordem: atual, custo: melhor };
}

/**
 * Held-Karp: solução **exaata** do caminho hamiltoniano aberto
 * (origem e destino fixos) — Held, Karp, "A dynamic programming approach to
 * sequencing problems", 1957.
 *
 * @param {number[][]} D
 * @param {number[]} indices pontos intermediários a ordenar
 * @param {number} inicio
 * @param {number} fim
 */
export function heldKarp(D, indices, inicio, fim) {
  const m = indices.length;
  if (m === 0) return { ordem: [], custo: D[inicio][fim] };
  const total = 1 << m;
  const dp = new Float64Array(total * m).fill(Infinity);
  const pai = new Int32Array(total * m).fill(-1);

  for (let j = 0; j < m; j++) {
    dp[(1 << j) * m + j] = D[inicio][indices[j]];
  }

  for (let mask = 1; mask < total; mask++) {
    for (let j = 0; j < m; j++) {
      if ((mask & (1 << j)) === 0) continue;
      const base = dp[mask * m + j];
      if (!Number.isFinite(base)) continue;
      for (let k = 0; k < m; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const custo = base + D[indices[j]][indices[k]];
        if (custo < dp[nm * m + k]) {
          dp[nm * m + k] = custo;
          pai[nm * m + k] = j;
        }
      }
    }
  }

  const full = total - 1;
  let melhor = Infinity;
  let ultimo = -1;
  for (let j = 0; j < m; j++) {
    const c = dp[full * m + j] + D[indices[j]][fim];
    if (c < melhor) {
      melhor = c;
      ultimo = j;
    }
  }
  if (ultimo < 0) return { ordem: [], custo: Infinity };

  const ordem = [];
  let mask = full;
  let j = ultimo;
  while (j >= 0) {
    ordem.unshift(indices[j]);
    const p = pai[mask * m + j];
    mask = mask & ~(1 << j);
    j = p;
  }
  return { ordem, custo: melhor };
}

/**
 * Otimiza a ordem de visita das paradas.
 *
 * @param {object} graph
 * @param {Array} pontos pontos com {latitude, longitude} (o primeiro é a
 *                        origem, o último é o destino)
 * @param {object} [options]
 *   - `circular`: true quando o trajeto é um **ciclo** (origem → paradas →
 *     origem). Nesse caso todas as posições depois da origem são paradas
 *     reordenáveis e o custo inclui o **fechamento** (última parada → origem).
 * @returns {object} { ok, ordem, indices, custo, metodo, matriz, semCaminho, ms }
 */
export function otimizarOrdem(graph, pontos, options = {}) {
  const n = pontos.length;
  const circular = options.circular === true;
  if (n < (circular ? 2 : 3)) {
    return {
      ok: true,
      ordem: pontos.map((_, i) => i),
      indices: [],
      custo: circular && n >= 1 ? 0 : 0,
      metodo: 'trivial',
      matriz: null,
      semCaminho: [],
      ms: 0,
      circular,
    };
  }
  if (n > LIMITE_TOTAL) {
    return {
      ok: false,
      reason: 'LIMITE_DE_PONTOS',
      message:
        `A otimização da ordem está limitada a ${LIMITE_TOTAL} pontos por ` +
        `requisição (foram informados ${n}) — é uma proteção de tempo do ` +
        `servidor, não um limite da interface. Use a ordem do usuário, que ` +
        `aceita qualquer quantidade de paradas.`,
    };
  }

  const { D, semCaminho, ms } = matrizDistancias(graph, pontos, options);
  if (semCaminho.length) {
    return {
      ok: false,
      reason: 'PONTOS_SEM_CONEXAO',
      message:
        'Não há caminho viário entre todos os pares de pontos: ' +
        `${semCaminho.length} pares estão desconectados na rede. ` +
        'A otimização da ordem exige que todos os pontos se alcancem.',
      semCaminho,
      matriz: D,
      ms,
    };
  }

  const inicio = 0;
  // No circuito, o ponto final é a MESMA origem: o custo inclui o
  // fechamento (última parada → origem) — é o TSP **em ciclo**.
  const fim = circular ? 0 : n - 1;
  const intermediarios = [];
  for (let i = 1; i < (circular ? n : n - 1); i++) intermediarios.push(i);

  let resultado;
  let metodo;
  if (intermediarios.length <= LIMITE_EXATO) {
    resultado = heldKarp(D, intermediarios, inicio, fim);
    metodo = 'exato';
  } else {
    const inicial = vizinhoMaisProximo(D, intermediarios, inicio);
    const melhorado = doisOpt(D, inicial, inicio, fim);
    resultado = { ordem: melhorado.ordem, custo: melhorado.custo };
    metodo = 'heuristico';
  }

  return {
    ok: true,
    // no circuito a origem não é repetida no fim da lista de visita: o
    // fechamento é implícito e calculado como um trecho próprio
    ordem: circular ? [inicio, ...resultado.ordem] : [inicio, ...resultado.ordem, fim],
    indices: resultado.ordem,
    custo: resultado.custo,
    metodo,
    matriz: D,
    semCaminho,
    ms,
    circular,
  };
}
