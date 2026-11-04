/**
 * Configuração central do motor de roteamento viário de Santo André.
 *
 * Todos os valores aqui foram justificados por medição real sobre a camada
 * `siga:SIGA_EIXO_LOG_OFICIAL_E_NAO` (ver `tools/inspect-layer.js` e README,
 * seção "Justificativa das tolerâncias").
 */

/** Endpoint do WFS do GeoServer da Prefeitura de Santo André. */
export const WFS_BASE_URL = 'https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs';

/** Nome qualificado da camada dentro do workspace `siga`. */
export const LAYER_NAME = 'siga:SIGA_EIXO_LOG_OFICIAL_E_NAO';

/**
 * Atributos publicados pela camada (confirmados via DescribeFeatureType).
 * Usados apenas para validação/diagnóstico — a geometria vem do campo
 * `geometry` do GeoJSON.
 */
export const KNOWN_ATTRIBUTES = Object.freeze([
  'ID',
  'COD_LOG',
  'TPO_LOGRADOURO',
  'COD_TITULO_LOGRADOURO',
  'NOM_LOGRADOURO',
  'DSC_LOGRADOURO',
]);

/**
 * Projeção métrica usada para medir distâncias.
 *
 * Santo André está em ~46,4°W / ~23,7°S, ou seja, na zona UTM 23 Sul.
 * EPSG:32723 (WGS 84 / UTM zone 23S) mantém o erro posicional abaixo de 1 cm
 * dentro da zona, contra dezenas de metros de uma aproximação equirretangular.
 */
export const METRIC_CRS = Object.freeze({
  epsg: 32723,
  zone: 23,
  hemisphere: 'S',
  centralMeridian: -45, // zona 23 => λ0 = 6*23 - 183 = -45°
  falseEasting: 500000,
  falseNorthing: 10000000,
  scaleFactor: 0.9996,
});

/** Tolerâncias e parâmetros de construção do grafo (metros, salvo indicação). */
export const GRAPH_DEFAULTS = Object.freeze({
  /**
   * Tolerância de "snap" (junção) entre extremidades de eixos e a rede.
   *
   * Justificativa (medida em 11.702 extremidades de eixo da camada):
   *   9.241 extremidades encostam exatamente em outra geometria (0 cm);
   *   2.457 ficam a até 1 cm;
   *   apenas    4 ficam entre 1 cm e 5 cm.
   * 5 cm ~ 1,25 mm em papel 1:25.000, muito abaixo de qualquer distância
   * real entre ruas paralelas. Aqui a geometria pode ser corrigida: a
   * extremidade é movida para o ponto de contato.
   */
  snapTolerance: 0.05,

  /**
   * Tolerância de JUNCÃO entre uma extremidade de eixo e outro eixo, para
   * casos em que a lacuna é grande demais para ser corrigida movendo a
   * geometria, mas pequena demais para ser uma rua de verdade.
   *
   * Justificativa (medida nas 11.698 extremidades da camada, considerando a
   * distância até o eixo mais próximo — e não só até outra extremidade):
   *     0 cm .......... 9.774
   *     até 5 cm .......    28
   *     5-10 cm ........    16
   *    10-25 cm ........    42
   *    25-50 cm ........    13
   *    50 cm-1 m .......    32
   *      1-2 m .........    30
   *      2-5 m .........   128   <-- a partir daqui já há ruas de verdade
   *      5-10 m ........   375
   *
   * Nenhuma rua real termina a 1 m de outra rua: uma lacuna de até 1 m é
   * ruído de digitalização, não uma separação. Acima de 2 m o volume cresce
   * muito (a partir de 5 m são 375 e 512 casos), o que indica ruas
   * realmente distintas — por isso o limite é 1 m.
   *
   * Medido no grafo real: subir de 5 cm para 1 m encurta 77 de 293 rotas
   * (8,6 km no total), libera 12 rotas que antes não existiam e NÃO
   * prolonga nenhuma rota.
   *
   * Nestes casos a geometria original NÃO é alterada: as duas pontas ficam
   * onde estão e a ligação é feita por um trecho curto (o "conector"), com o
   * comprimento real da lacuna.
   */
  junctionTolerance: 1.0,

  /**
   * Tolerância para considerar dois pontos de junção como o mesmo nó.
   * Menor que snapTolerance: só unifica nós que já são o mesmo ponto.
   */
  nodeMergeTolerance: 0.005,

  /**
   * Tolerância numérica (distância perpendicular) para classificar
   * interseções exatas vs. quase-tangências. 1 micra é muito menor que a
   * precisão dos dados (~1 cm) e evita aceitar cruzamentos errados.
   */
  intersectEpsilon: 1e-6,

  /**
   * Duas arestas são consideradas duplicata geometrical quando ligam o mesmo
   * par de nós, têm praticamente o mesmo comprimento e o mesmo ponto médio
   * (deslocamento < duplicateMidpointTolerance). Ruas paralelas legítimas
   * (combinam-se em cruzamentos diferentes) NÃO são descartadas.
   */
  duplicateMidpointTolerance: 0.5,
  duplicateLengthTolerance: 0.5,

  /**
   * Distância máxima para considerar que a origem/destino "pertence" à rede.
   * Acima disso a resposta é "ponto distante da rede viária".
   */
  maxSnapDistance: 100,

  /** Tolerância para casar um ponto projetado com um nó já existente. */
  endpointEpsilon: 1e-3,

  /**
   * Quando true, cruces em que uma das vias é classificada como RODOVIA
   * (TPO = 'ROD' ou nome contendo "RODOVIA") são considerados prováveis
   * passagem em nível diferente e a conexão é recusada.
   *
   * A camada NÃO publica atributo de nível/gabarito, então o padrão é false
   * (conectar) e o cruzamento é reportado no diagnóstico. Ver README.
   */
  excludeRoadCrossings: false,

  /** Tipos de logradouro bloqueados para pedestres (vazio = nenhum). */
  pedestrianBlockedTypes: [],

  /** Ignora features cujo COD_LOG == 0 (eixos "não oficializados"). */
  includeUnofficialAxes: true,
});

/** Parâmetros de carregamento do WFS. */
export const WFS_DEFAULTS = Object.freeze({
  /** Timeout de cada requisição HTTP (ms). */
  requestTimeout: 120000,
  /** Número de tentativas por requisição em caso de erro transitório. */
  maxRetries: 3,
  /** Backoff base entre tentativas (ms). */
  retryBackoff: 800,
  /**
   * Tamanho-alvo de cada página (features). A camada tem 4.119 feições;
   * com pageSize 1000 são ~5 requisições.
   */
  pageSize: 1000,
  /** Duração do cache do snapshot em disco (ms). 6 horas. */
  snapshotTtl: 6 * 60 * 60 * 1000,
  /** Fração de features por página que, se excedida, dispara paginação por ID. */
  maxFeaturesPerRequest: 5000,
});

/**
 * Política de atualização automática da rede.
 *
 * A camada é uma view do banco da Prefeitura: pode mudar a qualquer momento
 * (eixos novos, ruas renomeadas, traçados corrigidos). O servidor precisa
 * perceber isso sem depender de intervenção manual.
 *
 * Duas verificações, com custos muito diferentes:
 *
 *  • LEVE  — um GetFeature com maxFeatures=1 devolve o total declarado pelo
 *    servidor. Detecta eixos ADICIONADOS ou REMOVIDOS. Custa ~1 requisição
 *    de poucos bytes.
 *
 *  • COMPLETA — baixa a rede inteira e compara a impressão digital
 *    (SHA-256) do conteúdo. Detecta também a CORREÇÃO de um eixo já
 *    existente (uma rua renomeada ou redrawn), que a verificação leve não
 *    enxerga. Custa ~2,6 MB e ~2 s.
 */
export const UPDATE_DEFAULTS = Object.freeze({
  /** Intervalo da verificação leve (ms). Padrão: 5 minutos. */
  checkIntervalMs: 5 * 60 * 1000,
  /** Intervalo da verificação completa (ms). Padrão: 6 horas. */
  deepCheckIntervalMs: 6 * 60 * 60 * 1000,
  /** Verificação completa logo no arranque. */
  deepCheckOnStart: false,
  /**
   * Timeout da verificação LEVE (ms). É bem menor que o da carga completa
   * porque ela é uma tarefa de fundo: se o WFS estiver lento ou fora do ar,
   * é melhor falhar rápido e tentar de novo no próximo ciclo do que
   * bloquear a fila de verificações por vários minutos.
   */
  checkTimeoutMs: 20 * 1000,
  /** Retentativas da verificação leve (0 = uma única tentativa). */
  checkMaxRetries: 1,
});

/** Recorte do mapa inicial (bbox da camada). */
export const MAP_VIEW = Object.freeze({
  center: [-46.4255, -23.7031],
  zoom: 13,
  extent: [-46.5673, -23.8001, -46.2839, -23.6061],
});
