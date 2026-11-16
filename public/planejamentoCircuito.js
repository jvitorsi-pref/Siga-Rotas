/** Contrato de interface compartilhado entre Web e APK; motor preservado. */
import { criarListaPontos, adicionarPonto, STATUS } from '../core/pontoTrajeto.js';
import {
  CoordenadaNaRegiao,
  CodificarCurto,
  CodificarCompleto,
  ResolverEnderecoDigital,
} from '../core/enderecoDigital.js';

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

export function assinaturaPlanejador(state) {
  const pontos = (state?.lista?.pontos || []).map((p) => ({
    rotulo: p.rotulo,
    latitude: p.latitude,
    longitude: p.longitude,
    enderecoDigital: p.enderecoDigital || null,
  }));
  return JSON.stringify({
    modo: state?.modo || 'usuario',
    circular: state?.circuito === true,
    pontos,
  });
}

/**
 * Gera os dados de um ponto selecionado/movido no mapa usando a lógica oficial
 * do Endereço Digital (`core/enderecoDigital.js`). Garante que o código gerado
 * é aceito pelo mesmo validador do app e trata pontos fora da região sem falhar.
 */
export function resolverPontoNoMapa(latitude, longitude, opcoes = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Coordenadas selecionadas no mapa são inválidas.');
  }

  const acao = opcoes.acao === 'movido' ? 'Movido no mapa' : 'Selecionado no mapa';

  if (!CoordenadaNaRegiao(lat, lon)) {
    return {
      latitude: lat,
      longitude: lon,
      origem: 'mapa',
      enderecoDigital: '',
      codigoNormalizado: null,
      codigoCompleto: null,
      status: STATUS.FORA_DA_AREA,
      naRegiao: false,
      mensagem: `${acao}: fora da área do Endereço Digital (coordenadas capturadas sem Plus Code).`,
    };
  }

  const curto = CodificarCurto(lat, lon);
  const completo = CodificarCompleto(lat, lon);
  const validadoCurto = curto ? ResolverEnderecoDigital(curto) : null;
  const validadoCompleto =
    !validadoCurto?.ok && completo ? ResolverEnderecoDigital(completo) : null;
  const validado = validadoCurto?.ok ? validadoCurto : validadoCompleto?.ok ? validadoCompleto : null;

  if (!validado) {
    return {
      latitude: lat,
      longitude: lon,
      origem: 'mapa',
      enderecoDigital: '',
      codigoNormalizado: null,
      codigoCompleto: null,
      status: STATUS.FORA_DA_AREA,
      naRegiao: false,
      mensagem: `${acao}: fora da área do Endereço Digital (coordenadas capturadas sem Plus Code).`,
    };
  }

  const codigoCampo = validado === validadoCurto ? curto : validado.codigoCompleto;
  const detalheCompleto =
    validado.codigoCompleto && validado.codigoCompleto !== codigoCampo
      ? ` (${validado.codigoCompleto})`
      : '';

  return {
    latitude: lat,
    longitude: lon,
    origem: 'mapa',
    enderecoDigital: codigoCampo,
    codigoNormalizado: codigoCampo,
    codigoCompleto: validado.codigoCompleto,
    status: STATUS.CONVERTIDO,
    naRegiao: true,
    mensagem: `${acao}: Plus Code ${codigoCampo}${detalheCompleto}.`,
  };
}
