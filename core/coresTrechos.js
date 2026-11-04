/**
 * core/coresTrechos.js
 * ---------------------------------------------------------------------------
 * PALETA DE CORES POR TRECHO DE ROTA.
 *
 * Cada trecho consecutivo da rota (A → B, B → C, C → D … e, no circuito, o
 * retorno D → A) recebe uma **cor própria**, para que o trajeto seja lido
 * como uma sequência de trechos e não como uma linha única.
 *
 * REGRAS (todas testadas em `test/coresTrechos.test.js`):
 *
 *   • a cor representa o **trecho entre duas paradas** — nunca a "posição"
 *     de uma parada e nunca o "modo de roteamento" (a rota inteira não é
 *     azul no modo otimizado e verde no modo do usuário);
 *   • **trechos adjacentes têm cores diferentes** sempre que possível;
 *   • quando a paleta se esgota, as cores são **reutilizadas de forma
 *     organizada** (percorrendo a paleta em ciclo), sem repetir a cor do
 *     trecho imediatamente anterior;
 *   • a atribuição é **determinística**: a mesma sequência de trechos produz
 *     sempre as mesmas cores — o servidor e o navegador, usando este mesmo
 *     módulo, concordam.
 *
 * O módulo é isomórfico (roda no servidor e no navegador) e não depende de
 * nada: só devolve cores.
 */

/**
 * Paleta base. As cores são saturadas e escuras o bastante para contrastar
 * com o mapa-base claro (OpenStreetMap esmaecido) e, ao mesmo tempo, easy de
 * distinguir entre si — inclusive as duas families de verde e as duas de
 * azul, que ficam longe na sequência.
 */
export const PALETA_TRECHOS = [
  '#1d4ed8', // azul
  '#15803d', // verde
  '#ea580c', // laranja
  '#7c3aed', // roxo
  '#be123c', // vermelho-carmim
  '#0e7490', // ciano-petróleo
  '#a16207', // mostarda
  '#4d7c0f', // verde-oliva
  '#c026d3', // fúcsia
  '#1e40af', // azul-índigo
  '#047857', // esmeralda
  '#b45309', // sépia
];

/** Quantidade de cores distintas da paleta. */
export const TOTAL_CORES = PALETA_TRECHOS.length;

/**
 * Cor do trecho de índice `indice` (contagem circular na paleta).
 * @param {number} indice
 * @returns {string} cor em hexadecimal
 */
export function corPorIndice(indice) {
  const n = PALETA_TRECHOS.length;
  const i = Number.isFinite(indice) ? Math.trunc(indice) : 0;
  return PALETA_TRECHOS[((i % n) + n) % n];
}

/**
 * Cores dos trechos, na ordem em que aparecem na rota.
 *
 * @param {Array<{de?:string, para?:string}>} [trechos]
 * @returns {string[]} uma cor por trecho, na mesma ordem
 */
export function coresDosTrechos(trechos) {
  const n = Array.isArray(trechos) ? trechos.length : 0;
  const cores = [];
  for (let i = 0; i < n; i++) {
    let cor = corPorIndice(i);
    if (i > 0 && cor === cores[i - 1]) {
      // a paleta se esgotou (ou o índice caiu no mesmo tom): procura a
      // próxima cor do ciclo que não repita o trecho anterior.
      for (let k = 1; k < PALETA_TRECHOS.length; k++) {
        const alternativa = corPorIndice(i + k);
        if (alternativa !== cores[i - 1]) {
          cor = alternativa;
          break;
        }
      }
    }
    cores.push(cor);
  }
  return cores;
}

/**
 * Trechos com a cor atribuída — é o formato consumido pela interface (o
 * mapa e a legenda) e pela resposta da API.
 *
 * @param {Array<{de?:string, para?:string, retorno?:boolean}>} [trechos]
 * @returns {Array<object>} cópia dos trechos com `cor` (e `indice`)
 */
export function colorirTrechos(trechos) {
  const lista = Array.isArray(trechos) ? trechos : [];
  const cores = coresDosTrechos(lista);
  return lista.map((t, i) => ({
    ...t,
    indice: i,
    cor: cores[i],
  }));
}
