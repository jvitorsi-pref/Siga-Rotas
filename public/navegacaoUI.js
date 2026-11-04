/**
 * public/navegacaoUI.js
 * ---------------------------------------------------------------------------
 * INTERFACE DE NAVEGAÇÃO ATIVA (GPS real + modo de simulação).
 *
 * Este arquivo é só a **interface**: ele liga o controlador de navegação
 * (`core/navegacao.js`), a fonte de posição escolhida (GPS real —
 * `core/fonteGPS.js` — ou simulador — `core/simulador.js`), o mapa e os
 * botões. Nenhuma regra de navegação mora aqui: o mesmo controlador, o mesmo
 * cálculo de progresso, a mesma detecção de chegada e a mesma lógica de
 * desvio servem aos dois modos — **a única diferença é a fonte das
 * posições**.
 *
 * Regras da interface:
 *
 *   • a localização só é pedida **após o clique** em "Começar trajeto";
 *   • o modo **simulado** é sempre sinalizado (faixa na tela e selo no
 *     painel) e **nunca** mistura coordenadas com o GPS real: escolher um
 *     modo para o outro para a fonte anterior;
 *   • um desvio confirmado pede o recálculo **pela mesma API** do
 *     planejamento, preservando a ordem das paradas restantes; se o cálculo
 *     falhar, o erro aparece e **nenhuma linha reta** é desenhada;
 *   • encerrar a navegação libera o watcher do GPS, o temporizador da
 *     simulação e os listeners do mapa.
 */

import {
  criarNavegacao,
  planoDeNavegacao,
  EXECUCAO,
} from '../core/navegacao.js';
import { instrucaoAtual } from '../core/instrucoes.js';
import { criarFonteGPS } from '../core/fonteGPS.js';
import { criarSimulador, VELOCIDADES } from '../core/simulador.js';

const SEGUNDOS_SEM_SINAL = 12; // aviso de "sinal perdido"

/** Converte um hexadecimal em rgba com alfa. */
function comAlfa(hex, alfa) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

/** Formata metros (m / km). */
function metros(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v < 1000) return `${Math.round(v)} m`;
  return `${(v / 1000).toFixed(1)} km`;
}

/**
 * Cria a interface de navegação.
 * @param {object} app  o objeto `window.__app` (mapa, fontes e ganchos)
 */
export function criarInterfaceNavegacao(app) {
  const ol = window.ol;
  const $ = (sel) => document.querySelector(sel);

  const els = {
    start: $('#start-nav'),
    painel: $('#nav-panel'),
    badge: $('#nav-badge'),
    estado: $('#nav-estado'),
    instr: $('#nav-instr'),
    secundario: $('#nav-secundario'),
    progresso: $('#nav-progresso'),
    progressoBarra: $('#nav-progress'),
    restante: $('#nav-restante'),
    posicao: $('#nav-posicao'),
    precisao: $('#nav-precisao'),
    parada: $('#nav-parada'),
    trecho: $('#nav-trecho'),
    alerta: $('#nav-alerta'),
    pausar: $('#nav-pausar'),
    centralizar: $('#nav-centralizar'),
    encerrar: $('#nav-encerrar'),
    fechar: $('#nav-fechar'),
    modoReal: $('input[name="navmodo"][value="gps"]'),
    modoSim: $('input[name="navmodo"][value="simulacao"]'),
    banner: $('#sim-banner'),
    simPainel: $('#sim-panel'),
    simEstado: $('#sim-estado'),
    simIniciar: $('#sim-iniciar'),
    simPausar: $('#sim-pausar'),
    simReiniciar: $('#sim-reiniciar'),
    simVoltar: $('#sim-voltar'),
    simAvancar: $('#sim-avancar'),
    simVelocidade: $('#sim-velocidade'),
    simInicio: $('#sim-inicio'),
    simDesvio: $('#sim-desvio'),
    simPerder: $('#sim-perder'),
    simRecuperar: $('#sim-recuperar'),
    simLat: $('#sim-lat'),
    simLon: $('#sim-lon'),
    simManual: $('#sim-manual'),
  };

  /* ── estado da navegação (único) ─────────────────────────────────── */
  const nav = {
    controlador: null,
    plano: null,
    fonte: null, // GPS real
    simulador: null, // modo de teste
    modo: 'gps', // 'gps' | 'simulacao'
    ativo: false,
    seguindo: true,
    ultimaAtualizacao: 0,
    timerSinal: null,
    centralizando: false,
    // velocidade escolhida no simulador (preservada entre navegações)
    velocidadeSim: 5,
    // contadores de eventos (usados também pela automação/validação)
    eventos: { chegadas: 0, desvios: 0, recalculos: 0, conclusoes: 0 },
  };

  /* ── camada da posição do usuário ─────────────────────────────────── */
  const posSource = new ol.source.Vector({ features: [] });
  const posLayer = new ol.layer.Vector({
    source: posSource,
    zIndex: 30,
    style: (feature) => {
      const rumo = feature.get('rumo');
      const simulado = feature.get('simulado');
      const estilos = [];
      // cone de rumo: um triângulo real, desenhado em coordenadas do mapa
      if (rumo != null) {
        const centro = feature.getGeometry().getCoordinates();
        const raio = 34; // metros
        const ang = (rumo * Math.PI) / 180;
        const meia = 0.42;
        const p1 = [
          centro[0] + raio * Math.sin(ang - meia),
          centro[1] + raio * Math.cos(ang - meia),
        ];
        const p2 = [
          centro[0] + raio * Math.sin(ang + meia),
          centro[1] + raio * Math.cos(ang + meia),
        ];
        estilos.push(
          new ol.style.Style({
            geometry: new ol.geom.Polygon([[centro, p1, p2, centro]]),
            fill: new ol.style.Fill({
              color: simulado ? 'rgba(124,58,237,0.28)' : 'rgba(31,111,235,0.28)',
            }),
          }),
        );
      }
      estilos.push(
        new ol.style.Style({
          image: new ol.style.Circle({
            radius: 9,
            fill: new ol.style.Fill({ color: simulado ? '#7c3aed' : '#1f6feb' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
          }),
        }),
      );
      return estilos;
    },
  });
  app.map.addLayer(posLayer);

  /* ── utilidades ──────────────────────────────────────────────────── */
  function modoAtual() {
    return els.modoSim && els.modoSim.checked ? 'simulacao' : 'gps';
  }

  function definirAlerta(texto, tipo) {
    if (!els.alerta) return;
    if (!texto) {
      els.alerta.hidden = true;
      els.alerta.textContent = '';
      return;
    }
    els.alerta.hidden = false;
    els.alerta.textContent = texto;
    els.alerta.className = 'nav-panel__alerta nav-panel__alerta--' + (tipo || 'aviso');
  }

  function formatarPosicao(p) {
    if (!p) return '—';
    return `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
  }

  function marcarPosicao(p) {
    posSource.clear();
    if (!p) return;
    posSource.addFeature(
      new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([p.longitude, p.latitude])),
        rumo: p.rumo ?? null,
        simulado: !!p.simulado,
      }),
    );
  }

  function centralizar(p) {
    if (!p) return;
    nav.seguindo = true;
    nav.centralizando = true;
    app.map.getView().setCenter(ol.proj.fromLonLat([p.longitude, p.latitude]));
  }

  /* ── desenho da rota durante a navegação ─────────────────────────── */
  function destacarTrechos(indiceAtual) {
    if (typeof app.definirEstadoTrechos !== 'function') return;
    const percorridos = [];
    for (let i = 0; i < indiceAtual; i++) percorridos.push(i);
    app.definirEstadoTrechos({ atual: indiceAtual, percorridos });
  }

  /* ── recálculo após desvio ───────────────────────────────────────── */
  async function recalcularAposDesvio(info) {
    const ctrl = nav.controlador;
    if (!ctrl) return;
    const restantes = ctrl.plano.paradas.slice(ctrl.indiceParada).filter(
      (p) => p.latitude != null && p.longitude != null,
    );
    if (!restantes.length) {
      definirAlerta('Não há paradas restantes para recalcular.', 'erro');
      return;
    }
    const rotulos = ['A', ...restantes.map((p) => p.rotulo)];
    const pontos = [
      {
        rotulo: 'A',
        latitude: info.posicao.latitude,
        longitude: info.posicao.longitude,
      },
      ...restantes.map((p) => ({
        rotulo: p.rotulo,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    ];
    ctrl.estado.recalculando = true;
    definirAlerta(
      'Você saiu da rota (' +
        metros(info.distancia) +
        '). Recalculando a partir da posição atual…',
      'aviso',
    );
    try {
      const res = await fetch('/api/rota-paradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // modo "usuario": a ordem das paradas restantes é preservada
        body: JSON.stringify({ pontos, modo: 'usuario', circular: false }),
      });
      const data = await res.json();
      if (!data.ok) {
        // falha do recálculo: o erro é mostrado e NADA é desenhado
        ctrl.estado.recalculando = false;
        definirAlerta(
          'Não foi possível recalcular o trecho: ' +
            (data.message || 'erro desconhecido'),
          'erro',
        );
        return;
      }
      nav.eventos.recalculos += 1;
      const novoPlano = planoDeNavegacao(data, { rotulos });
      ctrl.replanejar(novoPlano, { deslocamento: ctrl.estado.percorrido });
      nav.plano = novoPlano;
      // a rota recalculada passa a ser a rota atual: o mapa E o painel
      // são redesenhados com a nova geometria, mas a navegação continua
      if (typeof app.showRoute === 'function') {
        app.showRoute(data, { manterNavegacao: true, semEnquadrar: true });
      } else {
        app.state.rotaAtual = data;
        if (typeof app.desenharRota === 'function') app.desenharRota(data);
        if (typeof app.atualizarLegenda === 'function') app.atualizarLegenda(data.legs);
      }
      if (nav.simulador) nav.simulador.definirPlano(novoPlano);
      definirAlerta('Rota recalculada a partir da posição atual.', 'ok');
    } catch (e) {
      ctrl.estado.recalculando = false;
      definirAlerta('Falha ao recalcular a rota: ' + e.message, 'erro');
    }
  }

  /* ── atualização do painel ───────────────────────────────────────── */
  function aoMudar(estado) {
    if (!estado) return;
    if (els.estado) {
      const nomes = {
        [EXECUCAO.PARADO]: 'Parada',
        [EXECUCAO.ATIVO]: 'Em navegação',
        [EXECUCAO.PAUSADO]: 'Pausada',
        [EXECUCAO.ENCERRADO]: 'Encerrada',
      };
      els.estado.textContent = nomes[estado.execucao] || estado.execucao;
    }
    if (els.posicao) els.posicao.textContent = formatarPosicao(estado.posicao);
    if (els.precisao) {
      els.precisao.textContent =
        estado.precisao == null
          ? '—'
          : estado.precisao <= 20
            ? `${Math.round(estado.precisao)} m (boa)`
            : `${Math.round(estado.precisao)} m (fraca)`;
    }
    if (els.parada) {
      els.parada.textContent = estado.proximaParada
        ? estado.proximaParada.rotulo
        : '—';
    }
    if (els.trecho) {
      const perna = nav.plano ? nav.plano.pernas[estado.trechoAtual] : null;
      els.trecho.textContent = perna ? `${perna.de} → ${perna.para}` : '—';
    }
    if (els.progresso) {
      els.progresso.textContent = `${Math.round(estado.progresso * 100)}%`;
    }
    if (els.progressoBarra) {
      els.progressoBarra.style.width = `${Math.round(estado.progresso * 100)}%`;
    }
    if (els.restante) els.restante.textContent = metros(estado.distanciaRestante);

    const ins = nav.plano ? instrucaoAtual(nav.plano, estado) : null;
    if (els.instr) els.instr.textContent = ins ? ins.principal : '—';
    if (els.secundario) els.secundario.textContent = ins ? ins.secundario : '';

    if (estado.posicao) {
      marcarPosicao(estado.posicao);
      if (nav.seguindo) centralizar(estado.posicao);
    }
    destacarTrechos(estado.trechoAtual);
  }

  /* ── início/ fim ─────────────────────────────────────────────────── */
  function pararFonte() {
    if (nav.fonte) {
      nav.fonte.parar();
      nav.fonte = null;
    }
    if (nav.simulador) {
      nav.simulador.parar();
      nav.simulador = null;
    }
  }

  function encerrar(silencioso) {
    pararFonte();
    if (nav.timerSinal) {
      clearInterval(nav.timerSinal);
      nav.timerSinal = null;
    }
    nav.ativo = false;
    nav.controlador = null;
    nav.plano = null;
    nav.seguindo = true;
    posSource.clear();
    if (typeof app.definirEstadoTrechos === 'function') {
      app.definirEstadoTrechos({ atual: null, percorridos: [] });
    }
    if (els.painel) els.painel.hidden = true;
    if (els.start) els.start.textContent = '▶ Começar trajeto';
    if (els.banner) els.banner.hidden = true;
    if (els.simPainel) els.simPainel.hidden = true;
    if (els.start) els.start.hidden = !app.rotaAtual;
    if (!silencioso && typeof app.setStatus === 'function') {
      app.setStatus('Navegação encerrada.', 'idle');
    }
  }

  function iniciar() {
    if (!app.rotaAtual) {
      if (typeof app.setStatus === 'function') {
        app.setStatus('Calcule uma rota antes de iniciar a navegação.', 'err');
      }
      return;
    }
    encerrar(true);
    nav.modo = modoAtual();
    nav.plano = planoDeNavegacao(app.rotaAtual);
    nav.ativo = true;
    nav.seguindo = true;
    nav.ultimaAtualizacao = Date.now();

    nav.controlador = criarNavegacao(nav.plano, {
      aoMudar,
      aoDesvioConfirmado: (info) => {
        nav.eventos.desvios += 1;
        recalcularAposDesvio(info);
      },
      aoChegarParada: (parada) => {
        nav.eventos.chegadas += 1;
        definirAlerta(`Você chegou à parada ${parada.rotulo}.`, 'ok');
        if (typeof app.setStatus === 'function') {
          app.setStatus(`Chegou à parada ${parada.rotulo}.`, 'ok');
        }
      },
      aoConcluir: () => {
        nav.eventos.conclusoes += 1;
        definirAlerta('Trajeto concluído.', 'ok');
        if (typeof app.setStatus === 'function') {
          app.setStatus('Trajeto concluído. Navegação encerrada.', 'ok');
        }
        encerrar(true);
      },
    });
    nav.controlador.iniciar();

    if (els.painel) els.painel.hidden = false;
    if (els.start) els.start.textContent = '↻ Reiniciar trajeto';
    if (els.badge) {
      els.badge.textContent = nav.modo === 'simulacao' ? 'MODO DE TESTE' : 'GPS real';
      els.badge.className =
        'nav-badge' + (nav.modo === 'simulacao' ? ' nav-badge--sim' : '');
    }
    if (els.banner) els.banner.hidden = nav.modo !== 'simulacao';
    if (els.simPainel) els.simPainel.hidden = nav.modo !== 'simulacao';
    if (els.pausar) els.pausar.textContent = 'Pausar';
    definirAlerta('', null);

    if (nav.modo === 'simulacao') {
      nav.simulador = criarSimulador({
        plano: nav.plano,
        velocidadeMultiplicador: nav.velocidadeSim,
        aoAtualizar: (p) => {
          nav.ultimaAtualizacao = Date.now();
          nav.controlador.atualizarPosicao(p);
          atualizarSimulador();
        },
      });
      nav.simulador.iniciar();
      preencherInicioSimulacao();
      if (typeof app.setStatus === 'function') {
        app.setStatus('Navegação em MODO DE TESTE (posição simulada).', 'busy');
      }
    } else {
      nav.fonte = criarFonteGPS({
        aoAtualizar: (p) => {
          nav.ultimaAtualizacao = Date.now();
          nav.controlador.atualizarPosicao(p);
        },
        aoErro: (e) => {
          definirAlerta(e.mensagem, 'erro');
          if (typeof app.setStatus === 'function') app.setStatus(e.mensagem, 'err');
        },
      });
      nav.fonte.iniciar();
      if (typeof app.setStatus === 'function') {
        app.setStatus('Navegação iniciada — aguardando a posição do GPS.', 'busy');
      }
    }

    // vigia de sinal perdido (só faz sentido no GPS real)
    if (nav.timerSinal) clearInterval(nav.timerSinal);
    nav.timerSinal = setInterval(() => {
      if (!nav.ativo || nav.modo !== 'gps') return;
      const parado = (Date.now() - nav.ultimaAtualizacao) / 1000;
      if (parado > SEGUNDOS_SEM_SINAL) {
        definirAlerta(
          `Sem posição do GPS há ${Math.round(parado)} s — a última posição é mantida.`,
          'aviso',
        );
        if (nav.controlador) nav.controlador.marcarSinalPerdido(true);
      }
    }, 2000);
  }

  /* ── simulador (controles) ───────────────────────────────────────── */
  function atualizarSimulador() {
    if (!els.simEstado || !nav.simulador) return;
    const s = nav.simulador;
    els.simEstado.textContent =
      `distância: ${metros(s.distancia)} · velocidade: ${s.multiplicador}x` +
      (s.sinal ? '' : ' · SEM SINAL') +
      (s.desvioAtivo ? ' · DESVIO' : '');
  }

  function preencherInicioSimulacao() {
    if (!els.simInicio || !nav.plano) return;
    const plano = nav.plano;
    const opcoes = ['<option value="0">Início (A)</option>'];
    plano.pernas.forEach((p, i) => {
      const inicio = plano.cum[plano.limites[i]] ?? 0;
      opcoes.push(
        `<option value="${Math.round(inicio)}">${p.de} → ${p.para}</option>`,
      );
    });
    opcoes.push(
      `<option value="${Math.round(plano.total)}">Fim do circuito</option>`,
    );
    els.simInicio.innerHTML = opcoes.join('');
  }

  function preencherVelocidades() {
    if (!els.simVelocidade) return;
    els.simVelocidade.innerHTML = VELOCIDADES.map(
      (v) => `<option value="${v}">${v}x</option>`,
    ).join('');
    els.simVelocidade.value = '5';
  }

  /* ── eventos ─────────────────────────────────────────────────────── */
  if (els.start) {
    els.start.addEventListener('click', () => {
      // o botão SEMPRE inicia (ou reinicia) a navegação; para parar, use
      // "Encerrar" no painel
      iniciar();
    });
  }
  if (els.pausar) {
    els.pausar.addEventListener('click', () => {
      const ctrl = nav.controlador;
      if (!ctrl) return;
      if (ctrl.estado.execucao === EXECUCAO.ATIVO) {
        ctrl.pausar();
        if (nav.simulador) nav.simulador.pausar();
        if (els.pausar) els.pausar.textContent = 'Continuar';
      } else {
        ctrl.retomar();
        if (nav.simulador) nav.simulador.retomar();
        if (els.pausar) els.pausar.textContent = 'Pausar';
      }
    });
  }
  if (els.centralizar) {
    els.centralizar.addEventListener('click', () => {
      if (nav.controlador) centralizar(nav.controlador.estado.posicao);
      if (els.centralizar) els.centralizar.classList.remove('is-off');
    });
  }
  if (els.encerrar) els.encerrar.addEventListener('click', () => encerrar());
  if (els.fechar) els.fechar.addEventListener('click', () => encerrar());

  // mapa: arrastar com o mouse tira o acompanhamento automático
  // (no `pointerdrag`, para o mapa não "puxar de volta" durante o arrasto)
  app.map.on('pointerdrag', () => {
    if (!nav.ativo) return;
    nav.seguindo = false;
    if (els.centralizar) els.centralizar.classList.add('is-off');
  });
  app.map.on('moveend', () => {
    if (nav.centralizando) {
      nav.centralizando = false;
      return;
    }
    if (nav.ativo && nav.seguindo) {
      nav.seguindo = false;
      if (els.centralizar) els.centralizar.classList.add('is-off');
    }
  });

  /* controles do simulador */
  if (els.simIniciar) {
    els.simIniciar.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.retomar();
      nav.controlador.retomar();
      if (els.pausar) els.pausar.textContent = 'Pausar';
    });
  }
  if (els.simPausar) {
    els.simPausar.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.pausar();
      nav.controlador.pausar();
      if (els.pausar) els.pausar.textContent = 'Continuar';
    });
  }
  if (els.simReiniciar) {
    els.simReiniciar.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.reiniciar();
      nav.controlador.reiniciarContadores();
    });
  }
  if (els.simVoltar) {
    els.simVoltar.addEventListener('click', () => {
      if (nav.simulador) nav.simulador.retroceder(100);
    });
  }
  if (els.simAvancar) {
    els.simAvancar.addEventListener('click', () => {
      if (nav.simulador) nav.simulador.avancar(100);
    });
  }
  if (els.simVelocidade) {
    els.simVelocidade.addEventListener('change', () => {
      nav.velocidadeSim = Number(els.simVelocidade.value) || 1;
      if (nav.simulador) nav.simulador.definirVelocidade(nav.velocidadeSim);
      atualizarSimulador();
    });
  }
  if (els.simInicio) {
    els.simInicio.addEventListener('change', () => {
      if (nav.simulador) nav.simulador.iniciarEm(Number(els.simInicio.value) || 0);
    });
  }
  if (els.simDesvio) {
    els.simDesvio.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.aplicarDesvio(120);
      definirAlerta(
        'Cenário de teste: a posição foi deslocada da rota (desvio).',
        'aviso',
      );
      atualizarSimulador();
    });
  }
  if (els.simPerder) {
    els.simPerder.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.perderSinal();
      definirAlerta('Cenário de teste: sinal perdido.', 'aviso');
      atualizarSimulador();
    });
  }
  if (els.simRecuperar) {
    els.simRecuperar.addEventListener('click', () => {
      if (!nav.simulador) return;
      nav.simulador.recuperarSinal();
      definirAlerta('Cenário de teste: sinal recuperado.', 'ok');
      atualizarSimulador();
    });
  }
  if (els.simManual) {
    els.simManual.addEventListener('click', () => {
      if (!nav.simulador) return;
      const lat = Number(String(els.simLat.value).replace(',', '.'));
      const lon = Number(String(els.simLon.value).replace(',', '.'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        definirAlerta('Coordenadas manuais inválidas.', 'erro');
        return;
      }
      nav.simulador.definirPosicaoManual(lat, lon);
      definirAlerta(`Posição manual: ${lat}, ${lon}.`, 'aviso');
    });
  }

  preencherVelocidades();

  return {
    /** Começa a navegação (chamado pelo botão "Começar trajeto"). */
    iniciar,
    /** Encerra a navegação. */
    encerrar,
    /** Estado atual (para automação e testes). */
    get estado() {
      return {
        ativo: nav.ativo,
        modo: nav.modo,
        controlador: nav.controlador ? nav.controlador.estado : null,
        plano: nav.plano,
        eventos: { ...nav.eventos },
      };
    },
    /** Chamado quando uma nova rota é calculada durante a navegação. */
    aoCalcularRota() {
      if (nav.ativo) {
        encerrar(true);
        if (typeof app.setStatus === 'function') {
          app.setStatus(
            'A rota foi recalculada — a navegação foi encerrada. Inicie de novo para seguir o novo trajeto.',
            'idle',
          );
        }
      }
      if (els.start) els.start.hidden = !app.rotaAtual;
    },
  };
}
