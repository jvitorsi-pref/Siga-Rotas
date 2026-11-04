/**
 * core/navegacao.js
 * ---------------------------------------------------------------------------
 * CONTROLADOR DE NAVEGAÇÃO ATIVA.
 *
 * Este módulo é o **cérebro** da navegação: ele não sabe de onde vêm as
 * posições (GPS real ou simulador) e não toca no DOM. Recebe atualizações de
 * posição e responde com o estado da navegação:
 *
 *   • em que **trecho** (A → B, B → C…) o usuário está;
 *   • qual é a **próxima parada** e quanto falta;
 *   • quanto **progresso** já foi feito — medido sobre a **geometria viária**
 *     da rota, e não em linha reta até o destino;
 *   • quando chegou a uma parada (proximidade + estabilidade + precisão);
 *   • quando saiu da rota (desvio), com tolerância e persistência.
 *
 * O mesmo controlador serve à navegação **real** e à **simulada**: a única
 * diferença é a fonte das atualizações de posição.
 *
 * PRINCÍPIOS (cumpridos por `test/navegacao.test.js`):
 *
 *   • nenhuma chegada é declarada com uma única leitura imprecisa;
 *   • nenhum desvio é confirmado por oscilação momentânea;
 *   • a precisão do GPS entra nas tolerâncias (um GPS ruim não pode
 *     provocar recálculos nem chegadas falso);
 *   • nada é inventado: as instruções vêm da geometria e dos nomes de
 *     logradouro que já existem na resposta da API.
 */

import { project, unproject, dist, cross } from './geo.js';

/** Estados de execução da navegação. */
export const EXECUCAO = {
  PARADO: 'parado',
  ATIVO: 'ativo',
  PAUSADO: 'pausado',
  ENCERRADO: 'encerrado',
};

/** Tolerâncias e parâmetros (todos configuráveis). */
export const PADRAO_OPCOES = {
  /** raio (m) para considerar que o usuário chegou à parada */
  toleranciaChegada: 25,
  /** precisão (m) máxima para aceitar uma chegada */
  precisaoMaximaChegada: 20,
  /** leituras consecutivas dentro do raio para confirmar a chegada */
  leiturasParaChegada: 3,
  /** distância (m) da rota que já conta como desvio */
  toleranciaDesvio: 35,
  /** multiplicador da precisão do GPS na tolerância de desvio */
  fatorPrecisaoDesvio: 2,
  /** leituras consecutivas fora da rota para confirmar o desvio */
  leiturasParaDesvio: 3,
  /** ângulo (graus) a partir do qual o vértice conta como manobra */
  anguloManobra: 25,
};

/* ====================================================================== */
/* PLANO DE NAVEGAÇÃO                                                      */
/* ====================================================================== */

/**
 * Monta o plano de navegação a partir da resposta da API
 * (`POST /api/rota-paradas`).
 *
 * @param {object} resposta resposta da API
 * @param {object} [opcoes]
 *   - `rotulos`: rótulos das paradas, na ordem (usado no recálculo, em que
 *     a origem passa a ser a posição atual)
 * @returns {object} plano
 */
export function planoDeNavegacao(resposta, opcoes = {}) {
  const pernas = (resposta.legs || []).map((leg, i) => ({
    indice: i,
    de: leg.de,
    para: leg.para,
    distance: leg.distance,
    distanceMeters: leg.distanceMeters,
    retorno: !!leg.retorno,
    cor: leg.cor || null,
    geometry: leg.geometry,
    edges: leg.legs || [],
  }));

  // geometria concatenada, em coordenadas métricas (x = leste, y = norte)
  const xy = [];
  const ll = [];
  const cum = []; // comprimento acumulado até cada vértice
  const limites = [];
  let total = 0;

  for (const perna of pernas) {
    limites.push(xy.length / 2);
    const coords = (perna.geometry && perna.geometry.coordinates) || [];
    for (const c of coords) {
      const [x, y] = project(c[0], c[1]);
      const n = xy.length / 2;
      if (n > 0) {
        const dx = x - xy[(n - 1) * 2];
        const dy = y - xy[(n - 1) * 2 + 1];
        total += Math.sqrt(dx * dx + dy * dy);
      }
      xy.push(x, y);
      ll.push([c[0], c[1]]);
      cum.push(total);
    }
  }

  // paradas: a origem, as intermediárias e (no circuito) a origem de novo.
  //
  // `distanciaNaRota` é a distância **sobre a geometria da rota** até a
  // parada: a parada i fica no fim da perna i-1. Importa porque o ponto
  // informado pelo usuário pode estar a dezenas de metros da rede viária
  // (o "acesso à rede") — a chegada é reconhecida quando o percurso
  // *chega ao fim da perna*, e não quando a distância em linha reta até o
  // clique fica pequena.
  const porRotulo = new Map((resposta.pontos || []).map((p) => [p.rotulo, p]));
  const sequencia =
    resposta.sequenciaCompleta || resposta.sequencia || [];
  const rotulos = opcoes.rotulos || sequencia;
  const paradas = rotulos.map((rotulo, i) => {
    const p = porRotulo.get(rotulo) || {};
    let distanciaNaRota = null;
    if (i >= 1) {
      distanciaNaRota =
        i < pernas.length ? cum[limites[i]] ?? null : total || null;
    }
    return {
      rotulo,
      indice: i,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      distanciaNaRota,
    };
  });

  return {
    pernas,
    paradas,
    xy,
    ll,
    cum,
    limites,
    total: total || resposta.distance || 0,
    circular: !!resposta.circular,
  };
}

/**
 * Projeta um ponto sobre a geometria do plano.
 *
 * @param {object} plano
 * @param {number} lon
 * @param {number} lat
 * @param {number} [referencia] progresso esperado (m). Serve para
 *   desfazer a ambiguidade das rotas que **terminam onde começam** (o
 *   circuito A → … → A): sem ela, a posição na origem poderia ser
 *   projetada no início da rota em vez do fim.
 * @returns {{indice:number, t:number, x:number, y:number, distancia:number,
 *            percorrido:number, dentro:boolean}}
 */
export function projetarNoPlano(plano, lon, lat, referencia = null) {
  const [px, py] = project(lon, lat);
  const { xy, cum } = plano;
  const n = xy.length / 2;
  let melhor = null;
  const candidatos = [];
  for (let i = 0; i < n - 1; i++) {
    const ax = xy[i * 2];
    const ay = xy[i * 2 + 1];
    const bx = xy[(i + 1) * 2];
    const by = xy[(i + 1) * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    const clamped = t < 0 || t > 1;
    if (clamped) t = t < 0 ? 0 : 1;
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d = dist(px, py, x, y);
    const cand = {
      indice: i,
      t,
      x,
      y,
      distancia: d,
      percorrido: cum[i] + t * Math.sqrt(lenSq),
      dentro: !clamped,
    };
    candidatos.push(cand);
    if (!melhor || d < melhor.distancia) melhor = cand;
  }
  // desempate pela referência: quando a rota fecha no mesmo ponto, a
  // projeção coerente com o progresso é a que está mais perto dele
  if (referencia != null && candidatos.length > 1) {
    const janela = candidatos.filter((c) => c.distancia <= melhor.distancia + 0.5);
    if (janela.length > 1) {
      let escolhido = melhor;
      let menor = Infinity;
      for (const c of janela) {
        const dif = Math.abs(c.percorrido - referencia);
        if (dif < menor) {
          menor = dif;
          escolhido = c;
        }
      }
      melhor = escolhido;
    }
  }
  if (!melhor) {
    return {
      indice: 0,
      t: 0,
      x: px,
      y: py,
      distancia: Infinity,
      percorrido: 0,
      dentro: false,
    };
  }
  return melhor;
}

/** Índice da perna (trecho) que contém a posição projetada. */
export function pernaDoPlano(plano, percorrido) {
  const { cum, limites, pernas } = plano;
  let indice = 0;
  for (let i = 0; i < pernas.length; i++) {
    const inicio = limites[i];
    const fim = i + 1 < pernas.length ? limites[i + 1] : cum.length - 1;
    if (percorrido >= cum[inicio] - 1e-6 && percorrido <= cum[fim] + 1e-6) {
      indice = i;
      break;
    }
    indice = i;
  }
  return indice;
}

/* ====================================================================== */
/* CONTROLADOR                                                             */
/* ====================================================================== */

/**
 * Cria o controlador de navegação.
 *
 * @param {object} plano plano de navegação (ver `planoDeNavegacao`)
 * @param {object} [opcoes]
 *   - `aoMudar(estado)`: chamado a cada mudança de estado
 *   - `aoChegarParada(parada, estado)`: chegada confirmada
 *   - `aoDesvioConfirmado(info, estado)`: desvio confirmado (pede recálculo)
 *   - `aoConcluir(estado)`: todas as paradas concluídas
 *   - tolerâncias (ver `PADRAO_OPCOES`)
 */
export function criarNavegacao(plano, opcoes = {}) {
  const cfg = { ...PADRAO_OPCOES, ...opcoes };
  const emissoes = {
    aoMudar: opcoes.aoMudar || (() => {}),
    aoChegarParada: opcoes.aoChegarParada || (() => {}),
    aoDesvioConfirmado: opcoes.aoDesvioConfirmado || (() => {}),
    aoConcluir: opcoes.aoConcluir || (() => {}),
  };

  let planoAtual = plano;
  let deslocamento = 0; // metros já percorridos antes do último replanejamento
  let indiceParada = 1; // a próxima parada a alcançar

  const estado = {
    execucao: EXECUCAO.PARADO,
    posicao: null,
    precisao: null,
    rumbo: null,
    velocidade: null,
    atualizadoEm: null,
    sinalPerdido: false,
    percorrido: 0,
    total: planoAtual.total,
    progresso: 0,
    trechoAtual: 0,
    proximaParada: planoAtual.paradas[1] || null,
    distanciaRestante: planoAtual.total,
    distanciaAteParada: planoAtual.total,
    distanciaAoTrecho: 0,
    desvio: { confirmado: false, distancia: 0, leituras: 0, tolerancia: 0 },
    chegada: { leituras: 0, confirmada: false },
    paradasConcluidas: [],
    ultimoErro: null,
    instrucao: null,
    recalculando: false,
    projecao: null,
  };

  function emitirMudar() {
    emissoes.aoMudar(estado);
  }

  function reiniciarContadores() {
    estado.chegada = { leituras: 0, confirmada: false };
    estado.desvio = { confirmado: false, distancia: 0, leituras: 0, tolerancia: 0 };
  }

  /** Recalcula os campos derivados do estado. */
  function derivar() {
    const p = estado.posicao;
    if (!p || !planoAtual || planoAtual.xy.length < 4) return;
    const proj = projetarNoPlano(
      planoAtual,
      p.longitude,
      p.latitude,
      estado.projecao ? estado.projecao.percorrido : null,
    );
    estado.projecao = proj;
    const percorrido = deslocamento + proj.percorrido;
    estado.percorrido = percorrido;
    estado.total = deslocamento + planoAtual.total;
    estado.progresso = estado.total > 0 ? Math.min(1, percorrido / estado.total) : 0;
    estado.distanciaRestante = Math.max(0, estado.total - percorrido);
    estado.distanciaAoTrecho = proj.distancia;
    estado.trechoAtual = pernaDoPlano(planoAtual, proj.percorrido);
    estado.proximaParada = planoAtual.paradas[indiceParada] || null;
    // distância até a próxima parada, medida sobre a geometria da rota
    estado.distanciaAteParada = estado.proximaParada
      ? Math.max(
          0,
          (estado.proximaParada.distanciaNaRota ?? planoAtual.total) - proj.percorrido,
        )
      : 0;
  }

  /**
   * Processa uma atualização de posição.
   * @param {{latitude:number, longitude:number, precisao?:number,
   *          rumo?:number, velocidade?:number, timestamp?:number}} pos
   */
  function atualizarPosicao(pos) {
    if (!pos) return estado;
    estado.posicao = pos;
    estado.precisao = pos.precisao ?? null;
    estado.rumo = pos.rumo ?? null;
    estado.velocidade = pos.velocidade ?? null;
    estado.atualizadoEm = pos.timestamp ?? Date.now();
    estado.sinalPerdido = false;

    if (estado.execucao !== EXECUCAO.ATIVO) {
      emitirMudar();
      return estado;
    }

    derivar();

    // ── chegada ────────────────────────────────────────────────────────
    const parada = estado.proximaParada;
    if (parada) {
      // distância até a parada: medida SOBRE A ROTA (preferido) ou, na
      // falta de referência na rota, em linha reta até o ponto informado
      let d;
      if (parada.distanciaNaRota != null) {
        d = Math.abs((estado.projecao?.percorrido ?? 0) - parada.distanciaNaRota);
      } else if (parada.latitude != null && parada.longitude != null) {
        const [px, py] = project(pos.longitude, pos.latitude);
        const [sx, sy] = project(parada.longitude, parada.latitude);
        d = dist(px, py, sx, sy);
      } else {
        d = Infinity;
      }
      const precisaoOk =
        estado.precisao == null || estado.precisao <= cfg.precisaoMaximaChegada;
      // é preciso estar SOBRE a rota (dentro da tolerância) para que a
      // chegada seja confirmada
      const naRota =
        estado.distanciaAoTrecho <=
        Math.max(cfg.toleranciaChegada, estado.precisao ?? 0);
      if (d <= cfg.toleranciaChegada && precisaoOk && naRota) {
        estado.chegada.leituras += 1;
        if (estado.chegada.leituras >= cfg.leiturasParaChegada) {
          estado.chegada.confirmada = true;
          estado.paradasConcluidas.push(parada.rotulo);
          indiceParada += 1;
          const seguinte = planoAtual.paradas[indiceParada] || null;
          estado.proximaParada = seguinte;
          estado.chegada = { leituras: 0, confirmada: false };
          derivar();
          emitirMudar();
          if (!seguinte) {
            estado.execucao = EXECUCAO.ENCERRADO;
            emitirMudar();
            emissoes.aoConcluir(estado);
            return estado;
          }
          emissoes.aoChegarParada(parada, estado);
          return estado;
        }
      } else {
        estado.chegada.leituras = 0;
      }
    }

    // ── desvio ─────────────────────────────────────────────────────────
    const tolerancia = Math.max(
      cfg.toleranciaDesvio,
      (estado.precisao ?? 0) * cfg.fatorPrecisaoDesvio,
    );
    if (estado.distanciaAoTrecho > tolerancia) {
      estado.desvio.leituras += 1;
      estado.desvio.distancia = estado.distanciaAoTrecho;
      estado.desvio.tolerancia = tolerancia;
      if (estado.desvio.leituras >= cfg.leiturasParaDesvio && !estado.desvio.confirmado) {
        estado.desvio.confirmado = true;
        emitirMudar();
        emissoes.aoDesvioConfirmado(
          {
            distancia: estado.distanciaAoTrecho,
            tolerancia,
            posicao: { latitude: pos.latitude, longitude: pos.longitude },
            precisao: estado.precisao,
          },
          estado,
        );
        return estado;
      }
    } else {
      estado.desvio.leituras = 0;
      estado.desvio.distancia = estado.distanciaAoTrecho;
      estado.desvio.tolerancia = tolerancia;
      estado.desvio.confirmado = false;
    }

    emitirMudar();
    return estado;
  }

  /** Marca a navegação como encerrada (sem emitir chegada). */
  function encerrar(motivo) {
    estado.execucao = EXECUCAO.ENCERRADO;
    estado.ultimoErro = motivo || null;
    emitirMudar();
    return estado;
  }

  /**
   * Substitui o plano (usado quando o caminho é recalculado após um desvio).
   * @param {object} novoPlano
   * @param {object} [opcoes]
   *   - `deslocamento`: metros já percorridos antes do novo plano
   *   - `manterParada`: rótulo da parada que continua valendo
   */
  function replanejar(novoPlano, opcoes = {}) {
    if (!novoPlano) return estado;
    planoAtual = novoPlano;
    estado.projecao = null; // a projeção é refeita no plano novo
    deslocamento = opcoes.deslocamento ?? deslocamento;
    // a parada que continua valendo é a primeira depois da origem
    indiceParada = 1;
    if (opcoes.manterParada) {
      const i = novoPlano.paradas.findIndex((p) => p.rotulo === opcoes.manterParada);
      if (i > 0) indiceParada = i;
    }
    estado.recalculando = false;
    derivar();
    emitirMudar();
    return estado;
  }

  return {
    /** Estado atual (leitura). */
    get estado() {
      return estado;
    },
    /** Plano vigente. */
    get plano() {
      return planoAtual;
    },
    /** Configuração em uso (tolerâncias). */
    get config() {
      return cfg;
    },
    /** Índice da próxima parada na lista de paradas do plano. */
    get indiceParada() {
      return indiceParada;
    },
    iniciar() {
      estado.execucao = EXECUCAO.ATIVO;
      estado.ultimoErro = null;
      derivar();
      emitirMudar();
      return estado;
    },
    pausar() {
      if (estado.execucao === EXECUCAO.ATIVO) estado.execucao = EXECUCAO.PAUSADO;
      emitirMudar();
      return estado;
    },
    retomar() {
      if (estado.execucao === EXECUCAO.PAUSADO) estado.execucao = EXECUCAO.ATIVO;
      emitirMudar();
      return estado;
    },
    encerrar,
    atualizarPosicao,
    replanejar,
    reiniciarContadores,
    /** Marca a posição como "perdida" (sem sinal). */
    marcarSinalPerdido(perdido) {
      estado.sinalPerdido = !!perdido;
      emitirMudar();
      return estado;
    },
  };
}
