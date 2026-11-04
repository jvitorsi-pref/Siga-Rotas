/**
 * core/coleta.js
 * ---------------------------------------------------------------------------
 * COLETA DE CAMPO — sessão de rastreamento GPS do agente.
 *
 * Este módulo é a **lógica** da coleta (sem DOM, sem rede): ele decide o que
 * é uma leitura aproveitável, o que é repetição, o que é salto de GPS, o
 * que é perda de sinal e o que é lacuna; grava tudo no armazenamento local
 * e mantém o estado da sessão (ativa / pausada / encerrada).
 *
 * ── Regras de qualidade (todas explícitas, nada é inventado) ────────────
 *   • **repetição**: mesma posição (≈ < 3 m) em pouco tempo ⇒ descartada;
 *   • **baixa precisão**: leitura com `accuracy` pior que o limite ⇒
 *     descartada do trajeto (contada e informada);
 *   • **salto de GPS**: deslocamento grande com velocidade implícita
 *     impossível para alguém a pé ⇒ descartado (contado e informado);
 *   • **perda de sinal**: silêncio do GPS ⇒ a sessão entra em "sinal
 *     perdido" e o trajeto fica marcado com a lacuna;
 *   • **lacuna**: ao recuperar o sinal, o ponto intermediário é gravado
 *     como **estimado** (`tipo: 'estimado'`), nunca como medido — o trajeto
 *     distingue o que o GPS viu do que foi reconstruído.
 *
 * ── Reuso ────────────────────────────────────────────────────────────────
 *   • GPS: `core/fonteGPS.js` (mesma fonte da navegação ativa);
 *   • distâncias: `haversine` de `core/geo.js` (metros);
 *   • Plus Code: `CodificarCompleto` de `core/enderecoDigital.js` — cálculo
 *     **local**, sem rede e sem serviço externo de geocodificação;
 *   • persistência: `core/armazenamentoLocal.js`.
 */

import { haversine } from './geo.js';
import { CodificarCompleto } from './enderecoDigital.js';
import { criarFonteGPS } from './fonteGPS.js';
import { descreverErroArmazenamento, novoId } from './armazenamentoLocal.js';

/** Estados possíveis de uma sessão de coleta. */
export const ESTADO_COLETA = {
  INATIVA: 'inativa',
  ATIVA: 'ativa',
  PAUSADA: 'pausada',
  ENCERRADA: 'encerrada',
};

/** Natureza de um ponto do trajeto. */
export const TIPO_PONTO = {
  MEDIDO: 'medido',
  ESTIMADO: 'estimado',
};

/** Motivo da recusa ou do caráter especial de um ponto. */
export const MOTIVO = {
  REPETIDO: 'repetido',
  BAIXA_PRECISAO: 'baixa_precisao',
  SALTO: 'salto',
  LACUNA: 'lacuna',
  INVALIDO: 'invalido',
  MANUAL: 'manual',
};

/**
 * Origem da posição registrada.
 *
 * `gps` é a posição real do aparelho; `simulacao` é a posição **fictícia**
 * do modo de teste (o simulador percorre a geometria da rota). Os dois
 * nunca são misturados: a sessão carrega a origem, cada ponto carrega a
 * sua, e a interface mostra um aviso permanente enquanto a simulação está
 * ativa.
 */
export const FONTE = {
  GPS: 'gps',
  SIMULACAO: 'simulacao',
};

/** Classificação de uma localização de residência. */
export const CLASSIFICACAO = {
  NOVA: 'nova',
  CORRIGIDA: 'corrigida',
  CONFIRMADA: 'confirmada',
};

/** Limites usados para limpar as leituras do GPS. */
export const CONFIG_PADRAO = {
  /** precisão máxima (m) aceita para entrar no trajeto */
  precisaoMaxima: 50,
  /** abaixo desta distância (m), com pouco tempo, é repetição */
  distanciaRepeticao: 3,
  /** janela de tempo (ms) da checagem de repetição */
  intervaloRepeticao: 5000,
  /** salto de GPS: deslocamento (m) grande demais para ser caminhada */
  saltoMaximo: 120,
  /** velocidade implícita máxima (m/s) — ≈ 43 km/h */
  velocidadeMaxima: 12,
  /** silêncio do GPS (ms) que caracteriza perda de sinal */
  tempoSemSinal: 30000,
  /** deslocamento mínimo (m) para gravar um novo ponto */
  distanciaMinima: 1.5,
  /** insere ponto estimado quando há lacuna de sinal */
  estimarLacunas: true,
  /** quantos pontos acumular antes de gravar (1 = grava na hora) */
  lote: 1,
};

/** Cria uma sessão de coleta. */
export function criarColeta(opcoes = {}) {
  const cfg = { ...CONFIG_PADRAO, ...(opcoes.config || {}) };
  const {
    armazenamento,
    agenteId = null,
    dispositivoId = null,
    aoMudar,
    aoPonto,
    aoAviso,
    criarFonte,
  } = opcoes;

  /** Origem da posição: GPS real (padrão) ou simulação (modo de teste). */
  let fontePosicao = FONTE.GPS;

  if (!armazenamento) throw new Error('A coleta precisa de um armazenamento local.');

  const agora = () => Date.now();

  const estado = {
    sessaoId: null,
    estado: ESTADO_COLETA.INATIVA,
    pontos: 0,
    descartados: 0,
    repetidos: 0,
    baixaPrecisao: 0,
    saltos: 0,
    estimados: 0,
    distancia: 0,
    sinalPerdido: false,
    inicio: null,
    ultimoEm: null,
    ultimaPosicao: null,
    rotaId: null,
    versaoRota: null,
    fonte: FONTE.GPS,
    avisos: [],
  };

  let fonte = null;
  let ultimoAceito = null; // { lat, lon, t }
  let contadorOrdem = 0;
  let buffer = [];
  let ultimoAvisoSinal = 0;

  function avisar(texto, nivel = 'info') {
    estado.avisos.push({ em: new Date(agora()).toISOString(), texto, nivel });
    if (aoAviso) aoAviso({ texto, nivel, em: new Date(agora()).toISOString() });
  }

  function emitir() {
    if (aoMudar) aoMudar({ ...estado });
  }

  function posicaoValida(p) {
    return (
      p &&
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180
    );
  }

  function distance(a, b) {
    return haversine(a.longitude, a.latitude, b.longitude, b.latitude);
  }

  /** Soma das distâncias entre pontos consecutivos (em metros). */
  function distanciaAcumulada(pontos) {
    let total = 0;
    for (let i = 1; i < pontos.length; i++) {
      total += distance(pontos[i - 1], pontos[i]);
    }
    return total;
  }

  /** Monta o registro de um ponto do trajeto. */
  function montarPonto(posicao, tipo, motivo, ordem, timestamp) {
    const ts = Number.isFinite(timestamp)
      ? timestamp
      : Number.isFinite(posicao.timestamp)
        ? posicao.timestamp
        : agora();
    return {
      id: novoId('pto'),
      ordem,
      tipo,
      motivo: motivo || null,
      // a origem da posição fica em CADA ponto: um ponto simulado nunca
      // pode ser confundido com uma medição de campo
      fonte: posicao.simulado === true ? FONTE.SIMULACAO : FONTE.GPS,
      simulado: posicao.simulado === true,
      latitude: Number(posicao.latitude),
      longitude: Number(posicao.longitude),
      precisao: Number.isFinite(posicao.precisao) ? posicao.precisao : null,
      rumo: Number.isFinite(posicao.rumo) ? posicao.rumo : null,
      velocidade: Number.isFinite(posicao.velocidade) ? posicao.velocidade : null,
      timestamp: ts,
      horario: new Date(ts).toISOString(),
    };
  }

  /**
   * Processa uma leitura do GPS: decide se entra no trajeto, se é repetição,
   * se é salto e se indica perda de sinal.
   */
  function processarLeitura(posicao) {
    if (!estado.sessaoId || estado.estado !== ESTADO_COLETA.ATIVA) return null;
    if (!posicaoValida(posicao)) {
      estado.descartados += 1;
      estado.sinalPerdido = true;
      emitir();
      return null;
    }

    const t = Number.isFinite(posicao.timestamp) ? posicao.timestamp : agora();

    // ── baixa precisão: fora do trajeto (contada e informada) ──
    if (
      Number.isFinite(posicao.precisao) &&
      posicao.precisao > cfg.precisaoMaxima
    ) {
      estado.baixaPrecisao += 1;
      estado.descartados += 1;
      emitir();
      return null;
    }

    const anterior = ultimoAceito;
    const dt = anterior ? t - anterior.t : 0;

    // ── perda de sinal: silêncio longo desde o último ponto ──
    if (anterior && dt > cfg.tempoSemSinal) {
      if (!estado.sinalPerdido) {
        estado.sinalPerdido = true;
        avisar(
          `Sinal do GPS perdido por ${Math.round(dt / 1000)} s.`,
          'alerta',
        );
      }
      // ponto intermediário **estimado** — identificado como tal, nunca
      // apresentado como medido
      if (cfg.estimarLacunas) {
        const meio = {
          latitude: (anterior.lat + posicao.latitude) / 2,
          longitude: (anterior.lon + posicao.longitude) / 2,
        };
        const tsMeio = anterior.t + (t - anterior.t) / 2;
        const p = montarPonto(meio, TIPO_PONTO.ESTIMADO, MOTIVO.LACUNA, ++contadorOrdem, tsMeio);
        buffer.push(p);
        estado.estimados += 1;
        estado.pontos += 1;
        ultimoAceito = { lat: meio.latitude, lon: meio.longitude, t: tsMeio };
        if (aoPonto) aoPonto(p, 'estimado');
        if (buffer.length >= cfg.lote) enfileirarGravacao();
      }
    }

    // ── qualidade da leitura em relação ao último ponto aceito ──
    if (ultimoAceito) {
      const ref = ultimoAceito;
      const dt2 = t - ref.t;
      const d2 = distance({ latitude: ref.lat, longitude: ref.lon }, posicao);
      // repetição: mesma posição em pouco tempo
      if (d2 < cfg.distanciaRepeticao && dt2 < cfg.intervaloRepeticao) {
        estado.repetidos += 1;
        estado.descartados += 1;
        emitir();
        return null;
      }
      // salto de GPS: longe demais para o tempo decorrido.
      // NÃO se aplica à posição **simulada**: no modo de teste as posições
      // são sintéticas e contínuas por construção, e o botão "avançar 100 m"
      // do simulador é um salto intencional (rejeitá-lo deixaria o trajeto
      // de teste sem registro).
      const salto = posicao.simulado !== true;
      if (salto && d2 > cfg.saltoMaximo && dt2 > 0 && d2 / (dt2 / 1000) > cfg.velocidadeMaxima) {
        estado.saltos += 1;
        estado.descartados += 1;
        avisar(
          `Leitura descartada: salto de ${Math.round(d2)} m em ${Math.round(dt2 / 1000)} s.`,
          'alerta',
        );
        emitir();
        return null;
      }
      // deslocamento mínimo: o agente não andou
      if (d2 < cfg.distanciaMinima) {
        estado.repetidos += 1;
        estado.descartados += 1;
        emitir();
        return null;
      }
      estado.distancia += d2;
    }

    const ponto = montarPonto(posicao, TIPO_PONTO.MEDIDO, null, ++contadorOrdem);
    buffer.push(ponto);
    estado.pontos += 1;
    estado.sinalPerdido = false;
    estado.ultimaPosicao = {
      latitude: ponto.latitude,
      longitude: ponto.longitude,
      precisao: ponto.precisao,
      timestamp: ponto.timestamp,
    };
    estado.ultimoEm = ponto.timestamp;
    ultimoAceito = { lat: ponto.latitude, lon: ponto.longitude, t: ponto.timestamp };
    if (aoPonto) aoPonto(ponto, 'medido');
    // grava localmente assim que o ponto é aceito: uma queda do aplicativo
    // não pode custar o trajeto já percorrido
    if (buffer.length >= cfg.lote) enfileirarGravacao();
    emitir();
    return ponto;
  }

  async function gravarBuffer() {
    if (!estado.sessaoId || !buffer.length) return 0;
    const lote = buffer;
    buffer = [];
    const n = await armazenamento.adicionarPontos(estado.sessaoId, lote);
    return n;
  }

  /**
   * Grava o que está no buffer sem travar a leitura do GPS: as gravações
   * ficam em fila (uma por vez) para que dois pontos nunca disputem a mesma
   * transação do IndexedDB. Uma falha de gravação vira aviso — o ponto
   * **não** é descartado silenciosamente.
   */
  let filaGravacao = Promise.resolve();
  function enfileirarGravacao() {
    filaGravacao = filaGravacao
      .then(() => gravarBuffer())
      .catch((e) => {
        avisar(descreverErroArmazenamento(e), 'alerta');
      });
    return filaGravacao;
  }

  function criarFonteInterna(handlers) {
    if (criarFonte) return criarFonte(handlers);
    return criarFonteGPS(handlers);
  }

  const api = {
    get estado() {
      return { ...estado };
    },

    /**
     * Inicia uma sessão de coleta.
     * @param {object} [opcoes]
     *   - `rota`: { id, versao, modo, circular, sequencia } — o plano em uso
     */
    async iniciar(opcoes = {}) {
      if (estado.estado === ESTADO_COLETA.ATIVA) {
        return { ok: false, motivo: 'JA_ATIVA', message: 'Já existe uma coleta em andamento.' };
      }
      const rota = opcoes.rota || null;
      // a origem da posição é gravada na sessão e em cada ponto
      fontePosicao = opcoes.fonte === FONTE.SIMULACAO ? FONTE.SIMULACAO : FONTE.GPS;
      const sessao = await armazenamento.salvarSessao({
        id: novoId('ses'),
        estado: 'ativa',
        agenteId,
        dispositivoId,
        fonte: fontePosicao,
        rotaId: rota ? rota.id : null,
        versaoRota: rota ? rota.versao || 1 : null,
        modo: rota ? rota.modo : null,
        circular: rota ? rota.circular === true : false,
        sequencia: rota ? rota.sequencia || [] : [],
        iniciadaEm: new Date(agora()).toISOString(),
        pontos: 0,
        distancia: 0,
      });

      estado.sessaoId = sessao.id;
      estado.estado = ESTADO_COLETA.ATIVA;
      estado.inicio = agora();
      estado.ultimoEm = agora();
      estado.pontos = 0;
      estado.descartados = 0;
      estado.repetidos = 0;
      estado.baixaPrecisao = 0;
      estado.saltos = 0;
      estado.estimados = 0;
      estado.distancia = 0;
      estado.sinalPerdido = false;
      estado.rotaId = rota ? rota.id : null;
      estado.versaoRota = rota ? rota.versao || 1 : null;
      estado.fonte = fontePosicao;
      estado.avisos = [];
      contadorOrdem = 0;
      buffer = [];
      ultimoAceito = null;

      fonte = criarFonteInterna({
        aoAtualizar: (p) => processarLeitura(p),
        aoErro: ({ codigo, mensagem }) => {
          if (codigo === 'POSITION_UNAVAILABLE' || codigo === 'TIMEOUT') {
            estado.sinalPerdido = true;
          }
          avisar(mensagem, 'alerta');
          emitir();
        },
        aoEstado: () => emitir(),
      });
      fonte.iniciar();
      emitir();
      return { ok: true, sessaoId: sessao.id };
    },

    /** Pausa a coleta (libera o GPS; os pontos já gravados permanecem). */
    async pausar() {
      if (estado.estado !== ESTADO_COLETA.ATIVA) {
        return { ok: false, motivo: 'NAO_ATIVA' };
      }
      await filaGravacao;
      await gravarBuffer();
      if (fonte && typeof fonte.parar === 'function') fonte.parar();
      estado.estado = ESTADO_COLETA.PAUSADA;
      await api._persistirEstado();
      emitir();
      return { ok: true };
    },

    /** Retoma uma coleta pausada. */
    async retomar() {
      if (estado.estado !== ESTADO_COLETA.PAUSADA) {
        return { ok: false, motivo: 'NAO_PAUSADA' };
      }
      estado.estado = ESTADO_COLETA.ATIVA;
      await api._persistirEstado();
      if (!fonte) {
        fonte = criarFonteInterna({
          aoAtualizar: (p) => processarLeitura(p),
          aoErro: ({ codigo, mensagem }) => {
            if (codigo === 'POSITION_UNAVAILABLE' || codigo === 'TIMEOUT') {
              estado.sinalPerdido = true;
            }
            avisar(mensagem, 'alerta');
            emitir();
          },
          aoEstado: () => emitir(),
        });
      }
      fonte.iniciar();
      emitir();
      return { ok: true };
    },

    /** Encerra a coleta e grava o que ficou. */
    async encerrar() {
      if (estado.estado === ESTADO_COLETA.INATIVA || estado.estado === ESTADO_COLETA.ENCERRADA) {
        return { ok: false, motivo: 'NAO_ATIVA' };
      }
      await filaGravacao;
      await gravarBuffer();
      if (fonte && typeof fonte.parar === 'function') fonte.parar();
      estado.estado = ESTADO_COLETA.ENCERRADA;
      await api._persistirEstado();
      emitir();
      return { ok: true, pontos: estado.pontos, distancia: estado.distancia };
    },

    /** Grava um ponto manualmente (quando o agente marca uma parada). */
    async registrarManual(posicao) {
      if (!estado.sessaoId) return { ok: false, motivo: 'SEM_SESSAO' };
      const ponto = montarPonto(posicao, TIPO_PONTO.MEDIDO, MOTIVO.MANUAL, ++contadorOrdem);
      buffer.push(ponto);
      estado.pontos += 1;
      await gravarBuffer();
      emitir();
      return { ok: true, ponto };
    },

    /**
     * **Adota** uma sessão já gravada no dispositivo — é o que permite
     * recuperar uma coleta interrompida (o aplicativo caiu, a tela foi
     * recarregada). A sessão continua a mesma: os pontos já gravados
     * permanecem e a numeração segue de onde parou.
     *
     * @param {string} sessaoId
     */
    async adota(sessaoId) {
      const sessao = await armazenamento.obterSessao(sessaoId);
      if (!sessao) return { ok: false, motivo: 'NAO_ENCONTRADA' };
      estado.sessaoId = sessao.id;
      estado.estado = ESTADO_COLETA.PAUSADA;
      estado.rotaId = sessao.rotaId || null;
      estado.versaoRota = sessao.versaoRota || null;
      estado.pontos = sessao.pontos || 0;
      estado.inicio = sessao.iniciadaEm ? Date.parse(sessao.iniciadaEm) : null;
      contadorOrdem = sessao.pontos || 0;
      ultimoAceito = null;
      buffer = [];
      // a distância é **recalculada** a partir dos pontos já gravados: o
      // valor guardado na sessão pode estar defasado (a sessão só é
      // gravada ao pausar/encerrar) e a medida do trajeto não pode depender
      // do momento em que o aplicativo caiu
      const pontos = await armazenamento.listarPontos(sessao.id);
      estado.distancia = distanciaAcumulada(pontos);
      emitir();
      return { ok: true, sessao, pontos: pontos.length };
    },

    /**
     * **Marca a posição atual como a residência** — o agente, ao chegar no
     * local, informa que é a casa e a localização é gravada no aparelho
     * (coordenadas, precisão e Plus Code), ligada a esta sessão.
     *
     * @param {object} [opcoes]
     *   - `classificacao`: 'nova' | 'corrigida' | 'confirmada'
     *   - `observacoes`
     */
    async marcarResidencia(opcoes = {}) {
      if (!estado.sessaoId) {
        return { ok: false, motivo: 'SEM_SESSAO', message: 'Inicie uma coleta antes de marcar a residência.' };
      }
      const posicao = estado.ultimaPosicao;
      if (!posicao) {
        return {
          ok: false,
          motivo: 'SEM_POSICAO',
          message: 'Ainda não há posição do GPS para marcar como residência.',
        };
      }
      const montagem = montarLocalizacaoResidencia({
        posicao,
        classificacao: opcoes.classificacao || CLASSIFICACAO.NOVA,
        sessaoId: estado.sessaoId,
        agenteId,
        dispositivoId,
        observacoes: opcoes.observacoes || null,
        // a origem da posição fica no registro da residência: uma
        // localização marcada em modo de teste não pode se passar por uma
        // medição de campo
        fonte: estado.fonte,
      });
      if (!montagem.ok) return montagem;
      const registro = await armazenamento.salvarResidencia(montagem.localizacao);
      // a localização marcada entra no histórico da sessão (rastro do trajeto)
      return {
        ok: true,
        localizacao: registro,
        ponto: {
          id: registro.id,
          latitude: registro.latitude,
          longitude: registro.longitude,
          precisao: registro.precisao,
          enderecoDigital: registro.enderecoDigital,
        },
      };
    },

    /** Grava o estado da sessão no armazenamento local. */
    async _persistirEstado() {
      if (!estado.sessaoId) return;
      const sessao = await armazenamento.obterSessao(estado.sessaoId);
      if (!sessao) return;
      await armazenamento.salvarSessao({
        ...sessao,
        estado: estado.estado,
        distancia: estado.distancia,
        encerradaEm:
          estado.estado === ESTADO_COLETA.ENCERRADA
            ? new Date(agora()).toISOString()
            : sessao.encerradaEm,
      });
    },
  };

  return api;
}

/**
 * Captura **uma** posição do GPS (para registrar a localização de uma
 * residência). Não fica assistindo: pede e devolve.
 *
 * @param {object} opcoes
 *   - `geolocation`: injetável (padrão `navigator.geolocation`)
 *   - `timeout`, `enableHighAccuracy`
 * @returns {Promise<{ok:boolean, posicao?:object, motivo?:string, message?:string}>}
 */
export function capturarPosicao(opcoes = {}) {
  const geo =
    opcoes.geolocation ||
    (typeof navigator !== 'undefined' ? navigator.geolocation : null);
  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return Promise.resolve({
      ok: false,
      motivo: 'INDISPONIVEL',
      message: 'Este navegador não oferece a API de geolocalização.',
    });
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return Promise.resolve({
      ok: false,
      motivo: 'INSEGURO',
      message:
        'A geolocalização exige contexto seguro (HTTPS ou localhost). Abra a aplicação por um desses endereços.',
    });
  }
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (gps) => {
        resolve({
          ok: true,
          posicao: {
            latitude: gps.coords.latitude,
            longitude: gps.coords.longitude,
            precisao:
              typeof gps.coords.accuracy === 'number' && Number.isFinite(gps.coords.accuracy)
                ? gps.coords.accuracy
                : null,
            rumo:
              typeof gps.coords.heading === 'number' && Number.isFinite(gps.coords.heading)
                ? gps.coords.heading
                : null,
            velocidade:
              typeof gps.coords.speed === 'number' && Number.isFinite(gps.coords.speed)
                ? gps.coords.speed
                : null,
            timestamp: gps.timestamp || Date.now(),
          },
        });
      },
      (err) => {
        const nome =
          err.code === 1 ? 'PERMISSION_DENIED' : err.code === 2 ? 'POSITION_UNAVAILABLE' : 'TIMEOUT';
        resolve({
          ok: false,
          motivo: nome,
          message:
            nome === 'PERMISSION_DENIED'
              ? 'Permissão de localização negada.'
              : nome === 'POSITION_UNAVAILABLE'
                ? 'Sinal de localização indisponível. Tente em outro lugar ou ative o GPS.'
                : 'Tempo esgotado para obter a posição. Tente de novo.',
        });
      },
      {
        enableHighAccuracy: opcoes.enableHighAccuracy !== false,
        timeout: opcoes.timeout || 15000,
        maximumAge: opcoes.maximumAge || 0,
      },
    );
  });
}

/**
 * Monta o registro de localização de uma residência.
 * O **Plus Code é calculado localmente** (`core/enderecoDigital.js`) — ele
 * identifica o lugar, mas **não** comprova que o endereço oficial foi
 * validado.
 *
 * @param {object} opcoes
 *   - `posicao`: { latitude, longitude, precisao, timestamp }
 *   - `classificacao`: 'nova' | 'corrigida' | 'confirmada'
 *   - `sessaoId`, `pontoId`, `agenteId`, `dispositivoId`
 *   - `observacoes`
 */
export function montarLocalizacaoResidencia(opcoes = {}) {
  const pos = opcoes.posicao || {};
  if (!posicaoValidaLocal(pos)) {
    return {
      ok: false,
      motivo: 'COORDENADA_INVALIDA',
      message: 'A posição capturada não tem coordenadas válidas.',
    };
  }
  let codigo = null;
  try {
    codigo = CodificarCompleto(pos.latitude, pos.longitude);
  } catch {
    codigo = null;
  }
  return {
    ok: true,
    localizacao: {
      id: novoId('res'),
      latitude: Number(pos.latitude),
      longitude: Number(pos.longitude),
      precisao: Number.isFinite(pos.precisao) ? pos.precisao : null,
      enderecoDigital: codigo,
      classificacao: opcoes.classificacao || CLASSIFICACAO.NOVA,
      sessaoId: opcoes.sessaoId || null,
      pontoId: opcoes.pontoId || null,
      fonte: opcoes.fonte || FONTE.GPS,
      agenteId: opcoes.agenteId || null,
      dispositivoId: opcoes.dispositivoId || null,
      observacoes: opcoes.observacoes || null,
      capturadoEm: new Date().toISOString(),
    },
  };
}

function posicaoValidaLocal(p) {
  return (
    p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

/**
 * Procura uma localização já registrada **perto** do ponto capturado —
 * evita cadastro duplicado. A comparação é local (mesma base do dispositivo)
 * e **não** envia nada para fora.
 *
 * @param {Array<object>} lista localizações já salvas
 * @param {{latitude:number, longitude:number}} posicao
 * @param {number} [raio] raio de busca (m)
 */
export function detectarDuplicado(lista, posicao, raio = 30) {
  if (!Array.isArray(lista) || !posicaoValidaLocal(posicao)) return null;
  for (const item of lista) {
    const d = haversine(
      posicao.longitude,
      posicao.latitude,
      Number(item.longitude),
      Number(item.latitude),
    );
    if (d <= raio) {
      return {
        id: item.id,
        distancia: d,
        enderecoDigital: item.enderecoDigital || null,
        classificacao: item.classificacao || null,
        raio,
      };
    }
  }
  return null;
}
