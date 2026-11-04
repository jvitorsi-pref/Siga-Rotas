/** Contrato de interface compartilhado entre Web e APK; motor preservado. */
import { criarListaPontos, adicionarPonto } from '../core/pontoTrajeto.js';
export function criarListaCircuito() {
  const lista = criarListaPontos();
  lista.circuito = true;
  adicionarPonto(lista, {});
  return lista;
}
export function opcoesCalculoCircuito(modo = 'usuario') {
  if (!['usuario', 'otimizada'].includes(modo)) throw new Error('Ação de cálculo inválida');
  return { modo, circular: true };
}
export function papelPontoCircuito(ponto) {
  return ponto.tipo === 'origem' ? 'Origem e destino' : `Parada ${ponto.rotulo}`;
}
