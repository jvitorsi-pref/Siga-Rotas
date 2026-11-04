import { coresDosTrechos } from '../../../core/coresTrechos.js';

/** Adapta apenas apresentação. Geometria, distância e ordem não são recalculadas. */
export function trechosParaMapa(legs = [], ocultos = []) {
  const cores = coresDosTrechos(legs);
  const hidden = new Set(ocultos);
  return legs.map((leg, indice) => ({
    indice, de: leg.de, para: leg.para, retorno: !!leg.retorno,
    cor: leg.cor || cores[indice], geometry: leg.geometry,
    visivel: !hidden.has(indice), situacao: leg.situacao || null,
  }));
}
