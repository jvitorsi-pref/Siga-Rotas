/**
 * Configuração e controle de camadas base (mapa padrão OpenStreetMap e Satélite)
 * compartilhados entre a versão Web e a versão Android (APK).
 */

export const CAMADA_PADRAO = 'osm';
export const CAMADA_SATELITE = 'satelite';
export const CHAVE_CAMADA_BASE = 'siga_rotas:camada_base_v1';

export const CAMADAS_BASE = Object.freeze({
  [CAMADA_PADRAO]: Object.freeze({
    id: CAMADA_PADRAO,
    rotulo: 'Mapa padrão',
    provedor: 'OpenStreetMap',
    maxZoom: 19,
    interpolate: true,
    offlineTiles: false,
  }),
  [CAMADA_SATELITE]: Object.freeze({
    id: CAMADA_SATELITE,
    rotulo: 'Satélite',
    provedor: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    interpolate: true,
    atribuicaoHtml:
      'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    atribuicaoTexto:
      'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    offlineTiles: false,
  }),
});

export function normalizarCamadaBase(valor) {
  return valor === CAMADA_SATELITE ? CAMADA_SATELITE : CAMADA_PADRAO;
}

export function opcoesCamadasBase() {
  return [CAMADAS_BASE[CAMADA_PADRAO], CAMADAS_BASE[CAMADA_SATELITE]];
}

export function lerPreferenciaCamadaSync(storage, chave = CHAVE_CAMADA_BASE) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return CAMADA_PADRAO;
    return normalizarCamadaBase(storage.getItem(chave));
  } catch {
    return CAMADA_PADRAO;
  }
}

export function salvarPreferenciaCamadaSync(modo, storage, chave = CHAVE_CAMADA_BASE) {
  const normalizada = normalizarCamadaBase(modo);
  try {
    if (!storage || typeof storage.setItem !== 'function') {
      return { ok: false, modo: normalizada };
    }
    storage.setItem(chave, normalizada);
    return { ok: true, modo: normalizada };
  } catch {
    return { ok: false, modo: normalizada };
  }
}

export async function lerPreferenciaCamadaAsync(storage, chave = CHAVE_CAMADA_BASE) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return CAMADA_PADRAO;
    const valor = await storage.getItem(chave);
    return normalizarCamadaBase(valor);
  } catch {
    return CAMADA_PADRAO;
  }
}

export async function salvarPreferenciaCamadaAsync(modo, storage, chave = CHAVE_CAMADA_BASE) {
  const normalizada = normalizarCamadaBase(modo);
  try {
    if (!storage || typeof storage.setItem !== 'function') {
      return { ok: false, modo: normalizada };
    }
    await storage.setItem(chave, normalizada);
    return { ok: true, modo: normalizada };
  } catch {
    return { ok: false, modo: normalizada };
  }
}

/**
 * Monitora disponibilidade das imagens de satélite sem interromper rotas,
 * marcadores ou retorno imediato para o mapa padrão.
 */
export function criarMonitorSatelite({
  aoMudarEstado,
  limiteErrosInicial = 3,
  limiteErrosAtiva = 5,
} = {}) {
  let ativa = false;
  let online = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine !== false : true;
  let errosConsecutivos = 0;
  let carregouAlgumTile = false;
  let status = 'oculta';
  let mensagem = '';

  function emitir() {
    if (typeof aoMudarEstado === 'function') {
      aoMudarEstado({ ativa, online, status, mensagem });
    }
    return { ativa, online, status, mensagem };
  }

  function atualizarEstado(novoStatus, novaMensagem) {
    if (status === novoStatus && mensagem === novaMensagem) {
      return { ativa, online, status, mensagem };
    }
    status = novoStatus;
    mensagem = novaMensagem;
    return emitir();
  }

  function definirAtiva(proximaAtiva, opcoes = {}) {
    if (typeof opcoes.online === 'boolean') online = opcoes.online;
    ativa = !!proximaAtiva;
    errosConsecutivos = 0;
    if (!ativa) {
      carregouAlgumTile = false;
      return atualizarEstado('oculta', '');
    }
    if (!online) {
      return atualizarEstado(
        'offline',
        'Sem conexão com a internet: imagens de satélite exigem rede ativa. Você pode usar o Mapa padrão.',
      );
    }
    carregouAlgumTile = false;
    return atualizarEstado('carregando', '');
  }

  function aoIniciarTile(opcoes = {}) {
    if (typeof opcoes.online === 'boolean') online = opcoes.online;
    if (!ativa) return estado();
    if (!online) {
      return atualizarEstado(
        'offline',
        'Sem conexão com a internet: imagens de satélite exigem rede ativa. Você pode usar o Mapa padrão.',
      );
    }
    return estado();
  }

  function aoCarregarTile() {
    if (!ativa) return estado();
    errosConsecutivos = 0;
    carregouAlgumTile = true;
    online = true;
    return atualizarEstado('pronta', '');
  }

  function aoErroTile(opcoes = {}) {
    if (typeof opcoes.online === 'boolean') online = opcoes.online;
    if (!ativa) return estado();
    errosConsecutivos += 1;
    if (!online) {
      return atualizarEstado(
        'offline',
        'Sem conexão com a internet: imagens de satélite indisponíveis. O mapa padrão continua disponível.',
      );
    }
    const limite = carregouAlgumTile ? limiteErrosAtiva : limiteErrosInicial;
    if (errosConsecutivos >= limite) {
      return atualizarEstado(
        'indisponivel',
        'Não foi possível carregar as imagens de satélite no momento. Você pode voltar para o Mapa padrão.',
      );
    }
    return estado();
  }

  function aoMudarConexao(proximoOnline) {
    online = !!proximoOnline;
    if (!ativa) return estado();
    if (!online) {
      return atualizarEstado(
        'offline',
        'Conexão perdida: novas imagens de satélite não podem ser baixadas offline.',
      );
    }
    errosConsecutivos = 0;
    return atualizarEstado('carregando', '');
  }

  function estado() {
    return { ativa, online, status, mensagem, carregouAlgumTile, errosConsecutivos };
  }

  return {
    definirAtiva,
    aoIniciarTile,
    aoCarregarTile,
    aoErroTile,
    aoMudarConexao,
    estado,
  };
}
