/**
 * Adaptador de localização real (primeiro plano + serviço em segundo plano via expo-location / expo-task-manager).
 * Os módulos nativos são injetados por `nativeLocation.js` para permitir testes unitários isolados.
 */
export const TAREFA_GPS_SEGUNDO_PLANO = 'siga-rotas-gps-segundo-plano';

const SERVICO_NOTIFICACAO_PADRAO = {
  notificationTitle: 'SIGA APP · Navegação GPS ativa',
  notificationBody: 'Registrando sua rota em segundo plano. Só para quando você pausar ou encerrar.',
  notificationColor: '#045127',
  killServiceOnDestroy: true,
};

export function criarFonteGPSNativa({
  location,
  taskManager = null,
  registrarListenerBackground = null,
  solicitarPermissaoNotificacao = null,
  appState,
  aoAtualizar = () => {},
  aoErro = () => {},
  aoInterromper = () => {},
  agora = Date.now,
  agendar = setInterval,
  cancelar = clearInterval,
  timeout = 30000,
  taskName = TAREFA_GPS_SEGUNDO_PLANO,
  foregroundService = SERVICO_NOTIFICACAO_PADRAO,
} = {}) {
  let geracao = 0;
  let assinatura = null;
  let removerListenerBg = null;
  let timer = null;
  let pendente = null;
  let paradaPendente = null;
  let ativo = false;
  let segundoPlanoAtivo = false;
  let backgroundRegistrado = false;
  let iniciadoEm = null;
  let ultimoEm = null;
  let ultimoTimestamp = null;
  let avisouSilencio = false;

  const numero = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const avisar = (codigo, mensagem) => {
    aoErro({ codigo, mensagem });
    return { ok: false, codigo, message: mensagem };
  };

  function encerrarTarefaBackground() {
    if (!backgroundRegistrado || typeof location?.stopLocationUpdatesAsync !== 'function') {
      return Promise.resolve();
    }
    backgroundRegistrado = false;
    const op = Promise.resolve()
      .then(() => location.stopLocationUpdatesAsync(taskName))
      .catch(() => {});
    paradaPendente = op.finally(() => {
      if (paradaPendente === op) paradaPendente = null;
    });
    return paradaPendente;
  }

  function parar() {
    geracao++;
    ativo = false;
    segundoPlanoAtivo = false;
    pendente = null;
    assinatura?.remove();
    assinatura = null;
    removerListenerBg?.();
    removerListenerBg = null;
    if (timer != null) cancelar(timer);
    timer = null;
    void encerrarTarefaBackground();
  }

  function falhar(codigo, mensagem) {
    parar();
    return avisar(codigo, mensagem);
  }

  function processarAmostra(gps) {
    const c = gps?.coords;
    if (
      !c ||
      !Number.isFinite(c.latitude) ||
      !Number.isFinite(c.longitude) ||
      Math.abs(c.latitude) > 90 ||
      Math.abs(c.longitude) > 180
    ) {
      avisar('POSITION_UNAVAILABLE', 'Leitura GPS inválida. Aguardando nova posição.');
      return;
    }
    if (gps.mocked === true) {
      avisar('MOCK_LOCATION', 'Posição de teste do Android detectada. Use o modo Simulação; esta leitura não será tratada como GPS real.');
      return;
    }
    const tAgora = agora();
    const limiteInferior = (iniciadoEm ?? tAgora) - 10000;
    // Rejeita amostras em cache anteriores ao início da sessão e timestamps inválidos no futuro,
    // mas preserva pontos coletados durante a execução em segundo plano entregues em lote.
    if (!Number.isFinite(gps.timestamp) || gps.timestamp < limiteInferior || gps.timestamp > tAgora + 5000) return;
    if (ultimoTimestamp != null && gps.timestamp <= ultimoTimestamp) return;
    ultimoTimestamp = gps.timestamp;
    ultimoEm = tAgora;
    avisouSilencio = false;
    aoAtualizar({
      latitude: c.latitude,
      longitude: c.longitude,
      precisao: numero(c.accuracy),
      rumo: numero(c.heading),
      velocidade: numero(c.speed),
      timestamp: gps.timestamp,
      simulado: false,
      fonte: 'gps',
      mockado: gps.mocked === true,
    });
  }

  async function abrir(token) {
    const atual = () => token === geracao;
    try {
      if (!location) return falhar('UNSUPPORTED', 'Localização nativa indisponível. Recompile o APK com expo-location.');
      if (paradaPendente) {
        await paradaPendente;
        if (!atual()) return { ok: false, cancelado: true };
      }
      let permissao = await location.getForegroundPermissionsAsync();
      if (!atual()) return { ok: false, cancelado: true };
      if (permissao.status !== 'granted' && permissao.canAskAgain !== false) {
        permissao = await location.requestForegroundPermissionsAsync();
      }
      if (!atual()) return { ok: false, cancelado: true };
      if (permissao.status !== 'granted') {
        return falhar('PERMISSION_DENIED', 'Permissão de localização negada. Libere a localização nas configurações do aplicativo para usar GPS real.');
      }
      const habilitado = await location.hasServicesEnabledAsync();
      if (!atual()) return { ok: false, cancelado: true };
      if (!habilitado) {
        return falhar('LOCATION_DISABLED', 'Localização do aparelho desativada. Ative o GPS e tente novamente.');
      }

      if (typeof solicitarPermissaoNotificacao === 'function') {
        try {
          await solicitarPermissaoNotificacao();
        } catch {
          // A notificação melhora a visibilidade, mas não deve impedir o rastreio se recusada.
        }
        if (!atual()) return { ok: false, cancelado: true };
      }

      iniciadoEm = agora();
      ultimoEm = iniciadoEm;
      ultimoTimestamp = null;
      avisouSilencio = false;

      let bgAtivo = false;
      const temApiBg =
        typeof location.startLocationUpdatesAsync === 'function' &&
        typeof location.stopLocationUpdatesAsync === 'function' &&
        typeof registrarListenerBackground === 'function';

      if (temApiBg) {
        let disponivelBg = true;
        if (typeof taskManager?.isAvailableAsync === 'function') {
          try {
            disponivelBg = await taskManager.isAvailableAsync();
          } catch {
            disponivelBg = false;
          }
          if (!atual()) return { ok: false, cancelado: true };
        }
        if (disponivelBg) {
          removerListenerBg = registrarListenerBackground(({ data, error }) => {
            if (!atual()) return;
            if (error) {
              avisar('POSITION_UNAVAILABLE', 'Sinal GPS indisponível: ' + String(error?.message || error));
              return;
            }
            const lista = Array.isArray(data?.locations) ? data.locations : [];
            if (!lista.length) return;
            const ordenadas = lista.length > 1
              ? [...lista].sort((a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0))
              : lista;
            for (const amostra of ordenadas) {
              if (!atual()) return;
              processarAmostra(amostra);
            }
          });
          try {
            await location.startLocationUpdatesAsync(taskName, {
              accuracy: location.Accuracy.High,
              timeInterval: 1000,
              distanceInterval: 0,
              deferredUpdatesDistance: 0,
              deferredUpdatesInterval: 0,
              foregroundService,
            });
            backgroundRegistrado = true;
            if (!atual()) {
              removerListenerBg?.();
              removerListenerBg = null;
              void encerrarTarefaBackground();
              return { ok: false, cancelado: true };
            }
            bgAtivo = true;
          } catch (erroBg) {
            removerListenerBg?.();
            removerListenerBg = null;
            if (typeof location.watchPositionAsync !== 'function') {
              return falhar('GPS_ERROR', 'Falha ao iniciar GPS em segundo plano: ' + erroBg.message);
            }
          }
        }
      }

      let sub = null;
      if (typeof location.watchPositionAsync === 'function') {
        try {
          sub = await location.watchPositionAsync(
            { accuracy: location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
            gps => {
              if (atual()) processarAmostra(gps);
            },
            erro => {
              if (atual()) avisar('POSITION_UNAVAILABLE', 'Sinal GPS indisponível: ' + String(erro));
            }
          );
          if (!atual()) {
            sub?.remove?.();
            removerListenerBg?.();
            removerListenerBg = null;
            void encerrarTarefaBackground();
            return { ok: false, cancelado: true };
          }
        } catch (erroWatch) {
          if (!bgAtivo) throw erroWatch;
        }
      } else if (!bgAtivo) {
        return falhar('UNSUPPORTED', 'Monitoramento de localização indisponível.');
      }

      assinatura = sub;
      ativo = true;
      segundoPlanoAtivo = bgAtivo;
      timer = agendar(() => {
        if (atual() && !avisouSilencio && agora() - ultimoEm >= timeout) {
          avisouSilencio = true;
          avisar('TIMEOUT', 'Sem nova posição GPS há mais de ' + Math.round(timeout / 1000) + ' segundos. A última posição é mantida.');
        }
      }, 2000);
      timer?.unref?.();
      return { ok: true, segundoPlano: bgAtivo };
    } catch (erro) {
      if (!atual()) return { ok: false, cancelado: true };
      return falhar('GPS_ERROR', 'Falha ao iniciar GPS real: ' + erro.message);
    }
  }

  function iniciar() {
    if (ativo) return Promise.resolve({ ok: true, segundoPlano: segundoPlanoAtivo });
    if (pendente) return pendente;
    if (appState?.currentState && appState.currentState !== 'active') {
      return Promise.resolve(avisar('APP_BACKGROUND', 'Abra o aplicativo para iniciar o GPS real.'));
    }
    const token = ++geracao;
    const tarefa = abrir(token);
    pendente = tarefa;
    tarefa.finally(() => {
      if (pendente === tarefa) pendente = null;
    });
    return tarefa;
  }

  return {
    iniciar,
    retomar: iniciar,
    pausar: parar,
    parar,
    get ativo() {
      return ativo;
    },
    get segundoPlanoAtivo() {
      return segundoPlanoAtivo;
    },
    // Mantido por compatibilidade caso algum consumidor precise interromper explicitamente.
    interromper: mensagem => {
      parar();
      aoInterromper(mensagem);
    },
  };
}
