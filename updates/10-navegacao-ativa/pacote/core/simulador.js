/**
 * core/simulador.js
 * ---------------------------------------------------------------------------
 * FONTE DE POSIÇÃO — SIMULADOR (modo de teste do desenvolvedor).
 *
 * Implementa a **mesma interface** da fonte GPS (`iniciar()`, `parar()` e a
 * entrega de `{latitude, longitude, precisao, rumo, velocidade, timestamp}`),
 * de modo que o controlador de navegação, o cálculo de progresso, a detecção
 * de chegada e a lógica de desvio são **exatamente os mesmos** nos dois
 * modos. A única diferença é a origem das posições.
 *
 * Regras do simulador:
 *
 *   • o deslocamento é calculado pelo **tempo real decorrido** (`dt`), e
 *     nunca pelo número de atualizações — a simulação não depende da taxa de
 *     atualização da interface;
 *   • a posição é **interpolada sobre a geometria viária** da rota
 *     (entre dois vértices, em coordenadas métricas) — o simulador nunca
 *     inventa um caminho;
 *   • a chegada a todas as paradas, **inclusive o retorno final à origem**,
 *     acontece naturalmente, porque a simulação percorre a geometria inteira;
 *   • os cenários de teste (desvio, perda de sinal, recuperação, GPS
 *     impreciso e coordenadas manuais) são declarados aqui — é o único lugar
 *     onde a simulação "mente" sobre a posição.
 *
 * NUNCA há mistura: o simulador não consulta o GPS real, e a fonte GPS real
 * não conhece o simulador. Quem escolhe é a interface, e ela mostra sempre
 * de que modo a navegação está rodando.
 */

import { unproject } from './geo.js';
import { projetarNoPlano } from './navegacao.js';

/** Velocidade de caminhada de referência (m/s). */
export const VELOCIDADE_BASE = 1.4;

/** Multiplicadores de velocidade oferecidos na interface. */
export const VELOCIDADES = [1, 2, 5, 10, 25, 50];

/**
 * Cria o simulador.
 *
 * @param {object} opcoes
 *   - `plano`: plano de navegação (geometria da rota) — obrigatório
 *   - `aoAtualizar(posicao)`
 *   - `velocidadeBase` (m/s), padrão 1,4
 *   - `intervalo` (ms) do tique, padrão 100
 *   - `precisao` (m) informada, padrão 8
 *   - `agora()`: relógio injetável (testes)
 */
export function criarSimulador(opcoes = {}) {
  const cfg = {
    velocidadeBase: VELOCIDADE_BASE,
    intervalo: 100,
    precisao: 8,
    ruido: 0,
    velocidadeMultiplicador: 1,
    ...opcoes,
  };
  let plano = opcoes.plano || null;
  let distancia = 0; // metros percorridos sobre a geometria
  let multiplicador = Math.max(0.1, Number(cfg.velocidadeMultiplicador) || 1);
  let rodando = false;
  let timer = null;
  let ultimoTique = null;
  let sinal = true; // cenário de perda de sinal
  let desvioMetros = 0; // desvio lateral aplicado (cenário)
  let desvioAtivo = false;
  let desvioAngulo = 0; // ajuste do ângulo do desvio (cenário)
  let posicaoManual = null;
  let agora = cfg.agora || (() => Date.now());
  let ultimaPosicao = null;

  function posicaoNaDistancia(d) {
    if (!plano || !plano.xy || plano.xy.length < 4) return null;
    const { xy, cum } = plano;
    const n = xy.length / 2;
    const total = plano.total;
    const alvo = Math.max(0, Math.min(total, d));
    let i = 0;
    while (i < n - 2 && cum[i + 1] < alvo) i++;
    const ax = xy[i * 2];
    const ay = xy[i * 2 + 1];
    const bx = xy[(i + 1) * 2];
    const by = xy[(i + 1) * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const t = len > 0 ? Math.max(0, Math.min(1, (alvo - cum[i]) / len)) : 0;
    let x = ax + t * dx;
    let y = ay + t * dy;
    // rumo: direção do segmento (0 = norte, sentido horário)
    let rumo = (Math.atan2(dx, dy) * 180) / Math.PI;
    if (rumo < 0) rumo += 360;
    return { x, y, rumo, indice: i, t };
  }

  function emitirPosicao(forcar) {
    if (!plano) return null;
    // sem sinal, NENHUMA posição é entregue (é o cenário de perda de sinal)
    if (!sinal) return null;

    let lat;
    let lon;
    let rumo = null;
    let velocidade = null;

    if (posicaoManual) {
      lat = posicaoManual.latitude;
      lon = posicaoManual.longitude;
    } else {
      const p = posicaoNaDistancia(distancia);
      if (!p) return null;
      let x = p.x;
      let y = p.y;
      if (desvioAtivo && desvioMetros > 0) {
        // desvio lateral: desloca a posição na perpendicular ao segmento
        // (com um ajuste de ângulo, para que o cenário fique realmente
        // longe da rota mesmo em ruas curvas)
        const ax = plano.xy[p.indice * 2];
        const ay = plano.xy[p.indice * 2 + 1];
        const bx = plano.xy[(p.indice + 1) * 2];
        const by = plano.xy[(p.indice + 1) * 2 + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ang = Math.atan2(dy, dx) + Math.PI / 2 + desvioAngulo;
        x += Math.cos(ang) * desvioMetros;
        y += Math.sin(ang) * desvioMetros;
      }
      const ll = unproject(x, y);
      lat = ll[1];
      lon = ll[0];
      rumo = p.rumo;
      velocidade = cfg.velocidadeBase * multiplicador;
    }

    const posicao = {
      latitude: lat,
      longitude: lon,
      precisao: cfg.precisao,
      rumo,
      velocidade,
      timestamp: agora(),
      simulado: true,
    };
    ultimaPosicao = posicao;
    if (opcoes.aoAtualizar) opcoes.aoAtualizar(posicao);
    return posicao;
  }

  function iniciar() {
    if (rodando) return;
    rodando = true;
    ultimoTique = agora();
    timer = setInterval(tique, cfg.intervalo);
    if (timer && typeof timer.unref === 'function') timer.unref();
    emitirPosicao(true);
  }

  function tique() {
    const t = agora();
    // dt = tempo REAL decorrido: a velocidade não depende da taxa de
    // atualização da interface
    const dt = Math.max(0, (t - (ultimoTique ?? t)) / 1000);
    ultimoTique = t;
    if (!rodando || !sinal) return;
    if (plano) {
      distancia += cfg.velocidadeBase * multiplicador * dt;
      if (distancia > plano.total) distancia = plano.total;
    }
    emitirPosicao(false);
  }

  return {
    get distancia() {
      return distancia;
    },
    get multiplicador() {
      return multiplicador;
    },
    get rodando() {
      return rodando;
    },
    get sinal() {
      return sinal;
    },
    get desvioAtivo() {
      return desvioAtivo;
    },
    /** Define o plano (rota) da simulação. */
    definirPlano(novo) {
      plano = novo;
      distancia = 0;
      ultimoTique = agora();
      return plano;
    },
    /** Liga a simulação. */
    iniciar,
    /** Pausa a simulação (mantém a posição). */
    pausar() {
      rodando = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      ultimoTique = agora();
      return distancia;
    },
    /** Continua a simulação. */
    retomar() {
      if (rodando) return distancia;
      rodando = true;
      ultimoTique = agora();
      timer = setInterval(tique, cfg.intervalo);
      if (timer && typeof timer.unref === 'function') timer.unref();
      emitirPosicao(true);
      return distancia;
    },
    /** Encerra e libera o temporizador. */
    parar() {
      rodando = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return distancia;
    },
    /** Volta ao início da rota. */
    reiniciar() {
      distancia = 0;
      posicaoManual = null;
      desvioAtivo = false;
      ultimoTique = agora();
      emitirPosicao(true);
      return distancia;
    },
    /** Avança (ou retrocede) X metros na rota. */
    avancar(metros) {
      distancia = Math.max(0, Math.min(plano ? plano.total : 0, distancia + metros));
      ultimoTique = agora();
      emitirPosicao(true);
      return distancia;
    },
    /** Retrocede X metros (atalho de `avancar(-X)`). */
    retroceder(metros) {
      return this.avancar(-metros);
    },
    /** Escolhe o ponto de início (metros sobre a geometria). */
    iniciarEm(metros) {
      distancia = Math.max(0, Math.min(plano ? plano.total : 0, metros));
      ultimoTique = agora();
      emitirPosicao(true);
      return distancia;
    },
    /** Multiplicador de velocidade (1x, 2x, 5x…). */
    definirVelocidade(valor) {
      // ATENÇÃO: o parâmetro não pode se chamar `multiplicador` — seria uma
      // atribuição local e o valor real nunca mudaria.
      multiplicador = Math.max(0.1, Number(valor) || 1);
      return multiplicador;
    },
    /**
     * Cenário: desvio lateral de X metros.
     *
     * O deslocamento é perpendicular ao trecho percorrido — mas, em ruas
     * curvas, um deslocamento perpendicular pode cair perto de **outro**
     * trecho da própria rota (e o desvio "sumiria"). Por isso o simulador
     * procura o ângulo que realmente afasta a posição da rota e, se ainda
     * assim não bastar, aumenta a magnitude — sem passar de um limite que
     * tiraria a posição da cobertura da rede.
     */
    aplicarDesvio(metros = 150) {
      desvioAtivo = true;
      let melhor = null;
      let escolhido = null;
      // ângulos testados (a partir da perpendicular ao trecho)
      const angulos = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2];
      let offset = metros;
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        for (const ang of angulos) {
          desvioMetros = offset;
          desvioAngulo = ang;
          emitirPosicao(true);
          const p = ultimaPosicao;
          if (!p || !plano) break;
          const proj = projetarNoPlano(plano, p.longitude, p.latitude);
          if (!melhor || proj.distancia > melhor.distancia) {
            melhor = { distancia: proj.distancia, angulo: ang, offset };
          }
          // o PRIMEIRO ângulo que afasta o bastante é o escolhido: um
          // deslocamento menor deixa a posição mais perto da rede (e,
          // portanto, mais fácil de reencontrar no recálculo)
          if (proj.distancia >= offset) {
            escolhido = { angulo: ang, offset };
            break;
          }
        }
        if (escolhido) break;
        offset = Math.min(offset * 1.6, 400); // limite: 400 m
      }
      const final = escolhido || melhor || { angulo: 0, offset: metros };
      desvioMetros = final.offset;
      desvioAngulo = final.angulo;
      emitirPosicao(true);
      return desvioMetros;
    },
    /** Cenário: volta para a rota. */
    limparDesvio() {
      desvioAtivo = false;
      desvioMetros = 0;
      desvioAngulo = 0;
      emitirPosicao(true);
    },
    /** Cenário: perda temporária de sinal. */
    perderSinal() {
      sinal = false;
      return sinal;
    },
    /** Cenário: recuperação do sinal. */
    recuperarSinal() {
      sinal = true;
      ultimoTique = agora();
      emitirPosicao(true);
      return sinal;
    },
    /** Cenário: coordenadas manuais. */
    definirPosicaoManual(latitude, longitude) {
      posicaoManual = { latitude, longitude };
      emitirPosicao(true);
      return posicaoManual;
    },
    /** Cenário: GPS impreciso (aumenta a precisão informada). */
    definirPrecisao(metros) {
      cfg.precisao = metros;
      return cfg.precisao;
    },
    /** Emite a posição atual uma vez (sem mover). */
    emitir() {
      return emitirPosicao(true);
    },
  };
}
