/**
 * core/instrucoes.js
 * ---------------------------------------------------------------------------
 * ORIENTAÇÕES DE NAVEGAÇÃO — SOMENTE O QUE OS DADOS PERMITEM DEDUZIR.
 *
 * A camada `siga:SIGA_EIXO_LOG_OFICIAL_E_NAO` traz a **geometria** dos eixos
 * e o **nome do logradouro**, mas **não traz** dados de manobra (tipo de
 * cruzamento, sentido de via, dados de trânsito ou tempo). Por isso este
 * módulo não inventa nomes de rua nem manobras:
 *
 *   • a **rua** vem do nome do logradouro que a rota realmente percorre
 *     (vem na resposta da API, em `legs[].legs[].street`);
 *   • a **manobra** é deduzida do **ângulo da própria geometria** (a curva
 *     que o traçado faz no vértice) — é uma leitura do trajeto, não uma
 *     suposição;
 *   • a **distância** vem da geometria métrica;
 *   • a **chegada** vem da confirmação do controlador de navegação.
 *
 * NÃO existem (e não são prometidas) aqui: instruções de voz, tráfego em
 * tempo real, nomes de esquina, sinalização, nem navegação curva a curva com
 * lanes.
 */

import { cross } from './geo.js';

/**
 * Ângulo de manobra em um vértice da geometria.
 * @returns {{tipo:'esquerda'|'direita'|'retorno'|'reta', angulo:number}|null}
 *   `null` quando o trecho é praticamente reto.
 */
export function anguloNoVertice(plano, i, anguloMinimo = 25) {
  const { xy } = plano;
  const n = xy.length / 2;
  if (i < 1 || i > n - 2) return null;
  // vértices duplicados (o fim de uma perna e o começo da seguinte) não
  // definem direção: pula-se para o vértice útil mais próximo
  const comprimento = (a, b) => {
    const dx = xy[b * 2] - xy[a * 2];
    const dy = xy[b * 2 + 1] - xy[a * 2 + 1];
    return Math.sqrt(dx * dx + dy * dy);
  };
  let ini = i - 1;
  while (ini > 0 && comprimento(ini, i) < 1e-6) ini--;
  let fim = i + 1;
  while (fim < n - 1 && comprimento(i, fim) < 1e-6) fim++;
  if (comprimento(ini, i) < 1e-6 || comprimento(i, fim) < 1e-6) return null;
  const ax = xy[ini * 2];
  const ay = xy[ini * 2 + 1];
  const bx = xy[i * 2];
  const by = xy[i * 2 + 1];
  const cx = xy[fim * 2];
  const cy = xy[fim * 2 + 1];
  const b1 = Math.atan2(by - ay, bx - ax);
  const b2 = Math.atan2(cy - by, cx - bx);
  let diff = ((b2 - b1) * 180) / Math.PI;
  while (diff > 180) diff -= 360;
  while (diff <= -180) diff += 360;
  if (Math.abs(diff) < anguloMinimo) {
    return { tipo: 'reta', angulo: diff };
  }
  const lado = cross(ax, ay, bx, by, cx, cy) > 0 ? 'esquerda' : 'direita';
  if (Math.abs(diff) > 150) return { tipo: 'retorno', angulo: diff, lado };
  return { tipo: lado, angulo: diff, lado };
}

/**
 * Nome do logradouro no trecho atual (vem dos logradouros realmente
 * percorridos pela rota).
 * @returns {string|null}
 */
export function ruaDoTrecho(plano, estado) {
  const perna = plano.pernas[estado.trechoAtual];
  if (!perna) return null;
  const edges = perna.edges || [];
  if (!edges.length) return null;
  const inicio = plano.limites[estado.trechoAtual] ?? 0;
  const percorrido = estado.projecao ? estado.projecao.percorrido : 0;
  const dNaPerna = Math.max(0, percorrido - (plano.cum[inicio] ?? 0));
  let acc = 0;
  for (const e of edges) {
    acc += e.length || 0;
    if (dNaPerna <= acc) return e.street || null;
  }
  return edges[edges.length - 1].street || null;
}

/** Formata metros em texto curto (m / km). */
export function metros(valor) {
  if (valor == null || !Number.isFinite(valor)) return '—';
  if (valor < 1000) return `${Math.round(valor)} m`;
  return `${(valor / 1000).toFixed(1)} km`;
}

/**
 * Monta a orientação do momento.
 *
 * @param {object} plano plano de navegação
 * @param {object} estado estado do controlador
 * @param {object} [opcoes] `{ anguloManobra }`
 * @returns {{principal:string, secundario:string, rua:string|null,
 *            manobra:object|null, chegada:boolean}}
 */
export function instrucaoAtual(plano, estado, opcoes = {}) {
  const anguloMinimo = opcoes.anguloManobra ?? 25;
  const parada = estado.proximaParada;
  const rua = ruaDoTrecho(plano, estado);
  const distanciaParada =
    parada && estado.distanciaAteParada != null ? estado.distanciaAteParada : null;

  // próxima manobra à frente (a partir do vértice atual)
  let manobra = null;
  const xy = plano.xy || [];
  const n = xy.length / 2;
  const atual = estado.projecao ? estado.projecao.indice : 0;
  for (let i = atual + 1; i < n - 1; i++) {
    const ang = anguloNoVertice(plano, i, anguloMinimo);
    if (ang && ang.tipo !== 'reta') {
      const dist = Math.max(0, (plano.cum[i + 1] ?? 0) - (estado.projecao?.percorrido ?? 0));
      manobra = { ...ang, indice: i, distancia: dist };
      break;
    }
  }

  let principal;
  let chegada = false;

  if (!estado.posicao) {
    // sem posição ainda, não há instrução honesta a dar
    return {
      principal: 'Aguardando a posição…',
      secundario: parada ? `Próxima parada: ${parada.rotulo}` : '',
      rua: null,
      manobra: null,
      chegada: false,
    };
  }

  if (!parada) {
    principal = 'Trajeto concluído.';
  } else if (distanciaParada != null && distanciaParada <= 60) {
    principal = `A ${metros(distanciaParada)}, chegue à parada ${parada.rotulo}.`;
    chegada = true;
  } else if (manobra && manobra.distancia <= 150) {
    const texto =
      manobra.tipo === 'retorno'
        ? 'Faça o retorno'
        : `Vire à ${manobra.tipo}`;
    principal = `${texto} em ${metros(manobra.distancia)}${rua ? ' — ' + rua : ''}.`;
  } else if (rua) {
    const ate = manobra ? manobra.distancia : distanciaParada;
    principal = `Siga pela ${rua}${ate != null ? ' por ' + metros(ate) : ''}.`;
  } else {
    principal = `Siga até a parada ${parada.rotulo}.`;
  }

  const secundario = parada
    ? `Próxima parada: ${parada.rotulo} · ${metros(estado.distanciaAteParada)}`
    : '';

  return { principal, secundario, rua, manobra, chegada };
}

/**
 * Distância até a próxima parada, medida **sobre a geometria** da rota
 * (não em linha reta).
 */
export function distanciaRestanteParaParada(estado) {
  if (!estado || estado.distanciaAteParada == null) return null;
  return estado.distanciaAteParada;
}
