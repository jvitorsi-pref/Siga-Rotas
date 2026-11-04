/**
 * Índice espacial de grade uniforme (uniform grid) sobre coordenadas métricas.
 *
 * Usado para:
 *  - encontrar pares de eixos candidatos a se cruzarem (bbox overlap);
 *  - localizar a aresta mais próxima de um ponto (origem/destino);
 *  - localizar extremidades próximas entre eixos (snap).
 *
 * A grade é escolhida a partir da densidade real dos dados para que a
 * quantidade média de itens por célula seja pequena, o que mantém as
 * consultas em tempo quase constante mesmo com dezenas de milhares de
 * segmentos.
 *
 * A API é genérica: `insert` recebe qualquer payload (objeto) e as consultas
 * devolvem os payloads inseridos.
 */

export class GridIndex {
  /**
   * @param {number[]} bbox [minX, minY, maxX, maxY] da área indexada
   * @param {number} cellSize tamanho da célula em metros
   */
  constructor(bbox, cellSize) {
    this.minX = bbox[0];
    this.minY = bbox[1];
    this.maxX = bbox[2];
    this.maxY = bbox[3];
    this.cellSize = Math.max(cellSize, 1);
    this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / this.cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((this.maxY - this.minY) / this.cellSize) + 1);
    /** @type {Map<number, any[]>} */
    this.cells = new Map();
    this.count = 0;
  }

  /** Converte (x, y) em índice de célula. */
  cellIndex(x, y) {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    return row * this.cols + col;
  }

  /**
   * Insere um payload com uma bounding box [minX, minY, maxX, maxY].
   * @param {any} item payload devuelto nas consultas
   */
  insert(item, minX, minY, maxX, maxY) {
    const c0 = Math.min(this.cols - 1, Math.max(0, Math.floor((minX - this.minX) / this.cellSize)));
    const c1 = Math.min(this.cols - 1, Math.max(0, Math.floor((maxX - this.minX) / this.cellSize)));
    const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor((minY - this.minY) / this.cellSize)));
    const r1 = Math.min(this.rows - 1, Math.max(0, Math.floor((maxY - this.minY) / this.cellSize)));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * this.cols + c;
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(item);
      }
    }
    this.count++;
  }

  /**
   * Retorna os payloads cuja célula cobre o ponto (x, y).
   */
  queryPoint(x, y) {
    const bucket = this.cells.get(this.cellIndex(x, y));
    return bucket ? bucket.slice() : [];
  }

  /**
   * Retorna os payloads cuja bounding box intersecta a caixa informada.
   */
  queryBBox(minX, minY, maxX, maxY) {
    const c0 = Math.min(this.cols - 1, Math.max(0, Math.floor((minX - this.minX) / this.cellSize)));
    const c1 = Math.min(this.cols - 1, Math.max(0, Math.floor((maxX - this.minX) / this.cellSize)));
    const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor((minY - this.minY) / this.cellSize)));
    const r1 = Math.min(this.rows - 1, Math.max(0, Math.floor((maxY - this.minY) / this.cellSize)));
    const seen = new Set();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bucket = this.cells.get(r * this.cols + c);
        if (!bucket) continue;
        for (const item of bucket) seen.add(item);
      }
    }
    return Array.from(seen);
  }

  /**
   * Busca incremental: expande anéis de células ao redor do ponto até
   * encontrar candidatos ou esgotar a área indexada.
   *
   * @param {number} x @param {number} y
   * @param {number} maxRadius número máximo de anéis
   * @param {(items:any[], radius:number)=>boolean} evaluate
   *   recebe os candidatos do anel atual; devolver `true` encerra a busca.
   */
  queryExpanding(x, y, maxRadius, evaluate) {
    const colCenter = Math.floor((x - this.minX) / this.cellSize);
    const rowCenter = Math.floor((y - this.minY) / this.cellSize);
    for (let r = 0; r <= maxRadius; r++) {
      const items = [];
      for (let rr = rowCenter - r; rr <= rowCenter + r; rr++) {
        if (rr < 0 || rr >= this.rows) continue;
        for (let cc = colCenter - r; cc <= colCenter + r; cc++) {
          if (cc < 0 || cc >= this.cols) continue;
          // apenas a borda do anel (o miolo foi tratado nos anéis anteriores)
          if (r > 0 && Math.abs(rr - rowCenter) !== r && Math.abs(cc - colCenter) !== r) continue;
          const bucket = this.cells.get(rr * this.cols + cc);
          if (!bucket) continue;
          for (const item of bucket) items.push(item);
        }
      }
      if (items.length) {
        if (evaluate(items, r) === true) return true;
      }
    }
    return false;
  }
}

/**
 * Calcula a bounding box de um conjunto de polilinhas métricas.
 * @param {Array<{xy: Float64Array}>} parts
 */
export function computeBBox(parts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const xy = part.xy;
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < minX) minX = xy[i];
      if (xy[i] > maxX) maxX = xy[i];
      if (xy[i + 1] < minY) minY = xy[i + 1];
      if (xy[i + 1] > maxY) maxY = xy[i + 1];
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}
