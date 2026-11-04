/**
 * core/fonteGPS.js
 * ---------------------------------------------------------------------------
 * FONTE DE POSIÇÃO — GPS REAL (Geolocation API do navegador).
 *
 * É uma das duas implementações da **interface de fonte de posição** (a outra
 * é o simulador, em `core/simulador.js`). Ambas entregam o mesmo formato:
 *
 *   { latitude, longitude, precisao, rumo, velocidade, timestamp }
 *
 * Regras desta fonte:
 *
 *   • a localização **só é pedida após ação do usuário** (a interface só
 *     chama `iniciar()` a partir do botão "Começar trajeto");
 *   • o navegador **não garante atualizações em intervalos exatos** — por
 *     isso esta fonte apenas entrega o que chega, e o controlador de
 *     navegação é que decide o que fazer com cada leitura;
 *   • `enableHighAccuracy` ligado (o GPS de celular é melhor que a
 *     triangulação por rede) e `maximumAge` curto (posição velha vale pouco
 *     para navegar);
 *   • permissões negadas, sinal indisponível e tempo esgotado são
 *     **traduzidos** em mensagens claras — nada de erro silencioso;
 *   • a Geolocation API só funciona em **contexto seguro** (HTTPS ou
 *     localhost): fora disso, o erro é informado antes de qualquer chamada.
 *
 * O watcher é SEMPRE liberado em `parar()` (e no `descartar()`), para não
 * deixar o GPS ligado depois de encerrar a navegação.
 */

/** Códigos de erro da Geolocation API → mensagens em português. */
export const ERROS_GPS = {
  PERMISSION_DENIED:
    'Permissão de localização negada. Libere o acesso à localização nas permissões do navegador para navegar.',
  POSITION_UNAVAILABLE:
    'Sinal de localização indisponível. Tente em outro lugar ou ative o GPS do aparelho.',
  TIMEOUT:
    'Tempo esgotado para obter a posição. Tente de novo.',
  insecure:
    'A geolocalização exige contexto seguro (HTTPS ou localhost). Abra a aplicação por um desses endereços.',
  unsupported:
    'Este navegador não oferece a API de geolocalização.',
};

/**
 * Cria a fonte GPS.
 *
 * @param {object} [opcoes]
 *   - `aoAtualizar(posicao)`: posição nova
 *   - `aoErro({codigo, mensagem})`: erro (permissão, sinal, timeout)
 *   - `aoEstado(estado)`: mudança de estado da fonte
 *   - `geolocation`: injetável (testes) — padrão `navigator.geolocation`
 *   - `timeout`, `maximumAge`, `enableHighAccuracy`
 */
export function criarFonteGPS(opcoes = {}) {
  const cfg = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 2000,
    ...opcoes,
  };
  const geo =
    cfg.geolocation ||
    (typeof navigator !== 'undefined' ? navigator.geolocation : null);

  let watchId = null;
  let ativo = false;

  const estado = {
    ativo: false,
    seguro: true,
    ultimoErro: null,
    leituras: 0,
  };

  function avisarErro(codigo, mensagem) {
    estado.ultimoErro = { codigo, mensagem };
    if (opcoes.aoErro) opcoes.aoErro({ codigo, mensagem });
    if (opcoes.aoEstado) opcoes.aoEstado(estado);
  }

  function sucesso(gps) {
    estado.ultimoErro = null;
    estado.leituras += 1;
    const posicao = {
      latitude: gps.coords.latitude,
      longitude: gps.coords.longitude,
      // precisão em metros (pode vir indefinida)
      precisao:
        typeof gps.coords.accuracy === 'number' && Number.isFinite(gps.coords.accuracy)
          ? gps.coords.accuracy
          : null,
      // rumo em graus (0 = norte); pode vir indisponível
      rumo:
        typeof gps.coords.heading === 'number' && Number.isFinite(gps.coords.heading)
          ? gps.coords.heading
          : null,
      // velocidade em m/s; pode vir indisponível
      velocidade:
        typeof gps.coords.speed === 'number' && Number.isFinite(gps.coords.speed)
          ? gps.coords.speed
          : null,
      timestamp: gps.timestamp || Date.now(),
    };
    if (opcoes.aoAtualizar) opcoes.aoAtualizar(posicao);
  }

  function erro(gps) {
    // a Geolocation API usa códigos numéricos; eles são traduzidos para
    // nomes legíveis antes de virar mensagem
    const nome =
      gps && gps.code === 1
        ? 'PERMISSION_DENIED'
        : gps && gps.code === 2
          ? 'POSITION_UNAVAILABLE'
          : gps && gps.code === 3
            ? 'TIMEOUT'
            : 'DESCONHECIDO';
    const mensagem =
      ERROS_GPS[nome] ||
      (gps && gps.message) ||
      'Não foi possível obter a localização do dispositivo.';
    avisarErro(nome, mensagem);
  }

  return {
    get estado() {
      return estado;
    },
    /** Começa a acompanhar a posição (chamar só após ação do usuário). */
    iniciar() {
      if (ativo) return estado;
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        estado.seguro = false;
        avisarErro('insecure', ERROS_GPS.insecure);
        return estado;
      }
      if (!geo || typeof geo.watchPosition !== 'function') {
        avisarErro('unsupported', ERROS_GPS.unsupported);
        return estado;
      }
      try {
        watchId = geo.watchPosition(sucesso, erro, {
          enableHighAccuracy: cfg.enableHighAccuracy,
          timeout: cfg.timeout,
          maximumAge: cfg.maximumAge,
        });
        ativo = true;
        estado.ativo = true;
      } catch (e) {
        ativo = false;
        estado.ativo = false;
        avisarErro('excecao', 'Falha ao iniciar o acompanhamento GPS: ' + e.message);
        return estado;
      }
      if (opcoes.aoEstado) opcoes.aoEstado(estado);
      return estado;
    },
    /** Libera o watcher (obrigatório ao encerrar a navegação). */
    parar() {
      if (watchId != null && geo && typeof geo.clearWatch === 'function') {
        try {
          geo.clearWatch(watchId);
        } catch {
          /* ignora: o watcher pode já ter sido liberado */
        }
      }
      watchId = null;
      ativo = false;
      estado.ativo = false;
      if (opcoes.aoEstado) opcoes.aoEstado(estado);
      return estado;
    },
    get ativo() {
      return ativo;
    },
  };
}
