import { TIPOS, rotularPontos } from '../core/pontoTrajeto.js';

export function podeDescerParada(ponto, total, circuito = false) {
  return ponto.tipo === TIPOS.PARADA && ponto.indice < total - (circuito ? 1 : 2);
}

/** A origem de um circuito é fixa, conforme a interface Web. */
export function inverterTrajeto(lista) {
  if (lista.circuito || lista.pontos.length < 2) return lista;
  const copia = { ...lista, pontos: lista.pontos.map((p) => ({ ...p })).reverse() };
  return rotularPontos(copia);
}
