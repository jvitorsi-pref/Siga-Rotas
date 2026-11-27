/**
 * APK/src/services/currentLocationCore.js
 * ---------------------------------------------------------------------------
 * Serviço testável de obtenção da localização GPS atual do dispositivo (sob demanda).
 * Reutiliza as mesmas regras de validação e tratamento de erro da camada GPS
 * nativa, sem nunca simular coordenadas nem centralizar em pontos arbitrários.
 */

export async function obterLocalizacaoAtualCore({
  location,
  locationApi,
  timeoutMs = 12000,
  agoraMs = Date.now(),
} = {}) {
  const api = location || locationApi;
  if (!api) {
    const msg = 'Serviço de geolocalização indisponível neste dispositivo.';
    return {
      ok: false,
      codigo: 'LOCATION_UNSUPPORTED',
      message: msg,
      mensagem: msg,
    };
  }

  try {
    if (typeof api.hasServicesEnabledAsync === 'function') {
      const enabled = await api.hasServicesEnabledAsync();
      if (!enabled) {
        const msg = 'O GPS do aparelho está desativado. Ative a localização do Android e tente novamente.';
        return {
          ok: false,
          codigo: 'LOCATION_DISABLED',
          message: msg,
          mensagem: msg,
        };
      }
    }

    let permStatus = 'undetermined';
    if (typeof api.getForegroundPermissionsAsync === 'function') {
      const atual = await api.getForegroundPermissionsAsync();
      permStatus = atual?.status || 'undetermined';
    }
    if (permStatus !== 'granted') {
      if (typeof api.requestForegroundPermissionsAsync === 'function') {
        const pedido = await api.requestForegroundPermissionsAsync();
        permStatus = pedido?.status || 'denied';
      } else {
        permStatus = 'denied';
      }
    }
    if (permStatus !== 'granted') {
      const msg = 'Permissão de localização negada. Autorize o acesso ao GPS nas configurações para centralizar sua posição.';
      return {
        ok: false,
        codigo: 'PERMISSION_DENIED',
        message: msg,
        mensagem: msg,
      };
    }

    if (typeof api.getCurrentPositionAsync !== 'function') {
      const msg = 'Leitura pontual de GPS não suportada nesta versão.';
      return {
        ok: false,
        codigo: 'LOCATION_UNSUPPORTED',
        message: msg,
        mensagem: msg,
      };
    }

    let timer = null;
    const leituraPromise = api.getCurrentPositionAsync({
      accuracy: api.Accuracy?.High ?? 4,
    });
    let gps = null;
    let cache = false;
    try {
      gps = await Promise.race([
        leituraPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(Object.assign(new Error('Tempo limite ao obter sinal GPS.'), { code: 'TIMEOUT' }));
          }, Math.max(20, Number(timeoutMs) || 12000));
        }),
      ]).finally(() => {
        if (timer != null) clearTimeout(timer);
      });
    } catch (raceErr) {
      if (raceErr?.code === 'TIMEOUT' && typeof api.getLastKnownPositionAsync === 'function') {
        const recente = await api.getLastKnownPositionAsync({ maxAge: 30000 }).catch(() => null);
        const tsRecente = Number(recente?.timestamp);
        if (recente?.coords && (!Number.isFinite(tsRecente) || agoraMs - tsRecente <= 30000)) {
          gps = recente;
          cache = true;
        } else {
          throw raceErr;
        }
      } else {
        throw raceErr;
      }
    }

    if (gps?.mocked === true) {
      const msg = 'Localização simulada do sistema detectada. A centralização GPS requer sinal real do aparelho.';
      return {
        ok: false,
        codigo: 'MOCK_LOCATION',
        message: msg,
        mensagem: msg,
      };
    }

    const c = gps?.coords;
    if (
      !c ||
      !Number.isFinite(c.latitude) ||
      !Number.isFinite(c.longitude) ||
      Math.abs(c.latitude) > 90 ||
      Math.abs(c.longitude) > 180
    ) {
      const msg = 'Não foi possível obter sua localização GPS atual. Verifique o sinal em área aberta e tente novamente.';
      return {
        ok: false,
        codigo: 'POSITION_UNAVAILABLE',
        message: msg,
        mensagem: msg,
      };
    }

    const position = {
      latitude: c.latitude,
      longitude: c.longitude,
      precisao:
        typeof c.accuracy === 'number' && Number.isFinite(c.accuracy) && c.accuracy >= 0
          ? c.accuracy
          : null,
      rumo:
        typeof c.heading === 'number' && Number.isFinite(c.heading) && c.heading >= 0
          ? c.heading
          : null,
      velocidade:
        typeof c.speed === 'number' && Number.isFinite(c.speed) && c.speed >= 0
          ? c.speed
          : null,
      timestamp: Number.isFinite(gps.timestamp) ? gps.timestamp : Date.now(),
      simulado: false,
      fonte: 'gps',
    };
    return {
      ok: true,
      cache,
      position,
      posicao: position,
    };
  } catch (err) {
    const isTimeout = err?.code === 'TIMEOUT';
    const msg = isTimeout
      ? 'Demorou para obter o sinal GPS atual. Tente novamente em área com melhor visibilidade.'
      : 'Localização indisponível no momento. Verifique o GPS do dispositivo e tente novamente.';
    return {
      ok: false,
      codigo: isTimeout ? 'TIMEOUT' : 'POSITION_UNAVAILABLE',
      message: msg,
      mensagem: msg,
    };
  }
}
