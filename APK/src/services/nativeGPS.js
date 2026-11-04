/** Adaptador de localização foreground. O módulo Expo é injetado para testes. */
export function criarFonteGPSNativa({ location, appState, aoAtualizar = () => {}, aoErro = () => {}, aoInterromper = () => {}, agora = Date.now, agendar = setInterval, cancelar = clearInterval, timeout = 30000 } = {}) {
  let geracao = 0, assinatura = null, listener = null, timer = null, pendente = null;
  let ativo = false, ultimoEm = null, ultimoTimestamp = null, avisouSilencio = false;
  const numero = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const avisar = (codigo, mensagem) => { aoErro({ codigo, mensagem }); return { ok: false, codigo, message: mensagem }; };
  function parar() {
    geracao++; ativo = false; pendente = null;
    assinatura?.remove(); assinatura = null;
    listener?.remove(); listener = null;
    if (timer != null) cancelar(timer); timer = null;
  }
  function falhar(codigo, mensagem) { parar(); return avisar(codigo, mensagem); }
  async function abrir(token) {
    const atual = () => token === geracao;
    try {
      if (!location) return falhar('UNSUPPORTED', 'Localização nativa indisponível. Recompile o APK com expo-location.');
      let permissao = await location.getForegroundPermissionsAsync();
      if (!atual()) return { ok: false, cancelado: true };
      if (permissao.status !== 'granted' && permissao.canAskAgain !== false) permissao = await location.requestForegroundPermissionsAsync();
      if (!atual()) return { ok: false, cancelado: true };
      if (permissao.status !== 'granted') return falhar('PERMISSION_DENIED', 'Permissão de localização negada. Libere a localização nas configurações do aplicativo para usar GPS real.');
      const habilitado = await location.hasServicesEnabledAsync();
      if (!atual()) return { ok: false, cancelado: true };
      if (!habilitado) return falhar('LOCATION_DISABLED', 'Localização do aparelho desativada. Ative o GPS e tente novamente.');
      ultimoEm = agora(); ultimoTimestamp = null; avisouSilencio = false;
      const sub = await location.watchPositionAsync({ accuracy: location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 }, gps => {
        if (!atual()) return;
        const c = gps?.coords;
        if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) {
          avisar('POSITION_UNAVAILABLE', 'Leitura GPS inválida. Aguardando nova posição.'); return;
        }
        if (gps.mocked === true) { avisar('MOCK_LOCATION', 'Posição de teste do Android detectada. Use o modo Simulação; esta leitura não será tratada como GPS real.'); return; }
        // Amostras em cache anteriores à abertura não devem confirmar chegada.
        if (!Number.isFinite(gps.timestamp) || agora() - gps.timestamp > 10000 || gps.timestamp > agora() + 5000) return;
        if (ultimoTimestamp != null && gps.timestamp <= ultimoTimestamp) return;
        ultimoTimestamp = gps.timestamp;
        ultimoEm = agora(); avisouSilencio = false;
        aoAtualizar({ latitude: c.latitude, longitude: c.longitude, precisao: numero(c.accuracy),
          rumo: numero(c.heading), velocidade: numero(c.speed), timestamp: gps.timestamp,
          simulado: false, fonte: 'gps', mockado: gps.mocked === true });
      }, erro => { if (atual()) avisar('POSITION_UNAVAILABLE', 'Sinal GPS indisponível: ' + String(erro)); });
      if (!atual()) { sub.remove(); return { ok: false, cancelado: true }; }
      assinatura = sub; ativo = true;
      timer = agendar(() => {
        if (atual() && !avisouSilencio && agora() - ultimoEm >= timeout) {
          avisouSilencio = true;
          avisar('TIMEOUT', 'Sem nova posição GPS há mais de ' + Math.round(timeout / 1000) + ' segundos. A última posição é mantida.');
        }
      }, 2000);
      timer?.unref?.();
      return { ok: true };
    } catch (erro) {
      if (!atual()) return { ok: false, cancelado: true };
      return falhar('GPS_ERROR', 'Falha ao iniciar GPS real: ' + erro.message);
    }
  }
  function iniciar() {
    if (ativo) return Promise.resolve({ ok: true });
    if (pendente) return pendente;
    if (appState?.currentState && appState.currentState !== 'active') return Promise.resolve(avisar('APP_BACKGROUND', 'Abra o aplicativo para iniciar o GPS real.'));
    const token = ++geracao;
    listener = appState?.addEventListener('change', estado => {
      if (estado === 'active' || token !== geracao) return;
      parar();
      aoInterromper('GPS pausado porque o aplicativo saiu do primeiro plano. Use Retomar ao voltar.');
    });
    const tarefa = abrir(token);
    pendente = tarefa;
    tarefa.finally(() => { if (pendente === tarefa) pendente = null; });
    return tarefa;
  }
  return { iniciar, retomar: iniciar, pausar: parar, parar, get ativo() { return ativo; } };
}
