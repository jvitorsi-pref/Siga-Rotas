/**
 * Qual trecho da rota está sob um toque no mapa?
 * ==============================================
 *
 * O Web usa `forEachFeatureAtPixel(..., { hitTolerance: 5 })` do OpenLayers
 * para ocultar/mostrar o trecho clicado. O APK não pode usar o mesmo mecanismo:
 * o mapa é uma WebView (OpenLayers ou Canvas) e o toque chega aqui apenas como
 * coordenada (`MAP_CLICK` com `lon`, `lat` e `zoom`). Esta função reproduz a
 * mesma intenção — **o trecho VISÍVEL mais próximo dentro de uma tolerância** —
 * sem tocar na geometria, na ordem, nas distâncias ou nas cores da rota.
 *
 * Regras:
 *  • só trechos visíveis são candidatos (um trecho oculto não está no mapa;
 *    para mostrá-lo de novo existe a legenda e o cartão do trecho);
 *  • a tolerância vem do zoom do mapa: 8 px convertidos em metros, limitada a
 *    3–60 m. Sem zoom (mensagem antiga), usa 12 m;
 *  • empate é resolvido pelo menor índice, para o resultado ser determinístico;
 *  • nada aqui altera a rota: a decisão de ocultar continua em `toggleSegment`.
 */

const RAIO_MEDIO_TERRA_M = 6371008.8;
const GRAUS_POR_METRO = 180 / (Math.PI * RAIO_MEDIO_TERRA_M);
const PX_TOLERANCIA = 8;
const TOLERANCIA_MIN_M = 3;
const TOLERANCIA_MAX_M = 60;
const TOLERANCIA_PADRAO_M = 12;

/** Resolução do OpenLayers (EPSG:3857) em metros por pixel para um zoom. */
export function metrosPorPixel(latitude, zoom) {
  const z = Number(zoom);
  const lat = Number(latitude);
  if (!Number.isFinite(z) || !Number.isFinite(lat)) return null;
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

/** Tolerância do toque em metros: proporcional ao zoom, com limites. */
export function toleranciaDoClique(latitude, zoom, px = PX_TOLERANCIA) {
  const resolucao = metrosPorPixel(latitude, zoom);
  if (resolucao == null) return TOLERANCIA_PADRAO_M;
  const metros = resolucao * Math.max(1, Number(px) || PX_TOLERANCIA);
  return Math.min(TOLERANCIA_MAX_M, Math.max(TOLERANCIA_MIN_M, metros));
}

function linhas(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/** Projeta graus em metros locais (equiretangular) em torno da latitude do toque. */
function paraMetros(lon, lat, lon0, lat0) {
  return [
    (lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * GRAUS_POR_METRO ** -1,
    (lat - lat0) * GRAUS_POR_METRO ** -1,
  ];
}

/** Distância (m) de um ponto a um segmento, no plano local dos metros. */
export function distanciaPontoSegmentoMetros(lon, lat, a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return Infinity;
  const [px, py] = paraMetros(lon, lat, lon, lat);
  const [ax, ay] = paraMetros(a[0], a[1], lon, lat);
  const [bx, by] = paraMetros(b[0], b[1], lon, lat);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Trecho visível mais próximo do toque, dentro da tolerância.
 * Devolve `{ indice, distancia, tolerancia }` ou `null`.
 */
export function trechoSobClique(trechos, lon, lat, opcoes = {}) {
  if (!Array.isArray(trechos) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const tolerancia = toleranciaDoClique(lat, opcoes.zoom, opcoes.toleranciaPx);
  let escolhido = null;
  for (let indice = 0; indice < trechos.length; indice++) {
    const trecho = trechos[indice];
    if (!trecho || trecho.visivel === false) continue;
    for (const linha of linhas(trecho.geometry)) {
      if (!Array.isArray(linha) || linha.length < 2) continue;
      for (let i = 1; i < linha.length; i++) {
        const distancia = distanciaPontoSegmentoMetros(lon, lat, linha[i - 1], linha[i]);
        if (!Number.isFinite(distancia) || distancia > tolerancia) continue;
        const anterior = escolhido;
        if (!anterior || distancia < anterior.distancia - 1e-9 ||
          (Math.abs(distancia - anterior.distancia) <= 1e-9 && indice < anterior.indice)) {
          escolhido = { indice, distancia, tolerancia };
        }
      }
    }
  }
  return escolhido;
}
