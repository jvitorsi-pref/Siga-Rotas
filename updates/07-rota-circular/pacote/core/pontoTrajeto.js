/**
 * core/pontoTrajeto.js
 * ---------------------------------------------------------------------------
 * GERENCIAMENTO DA LISTA DE PONTOS DO TRAJETO (origem, paradas, destino).
 *
 * Isomórfico (roda no servidor e no navegador) e **sem DOM**: a interface
 * apenas desenha o que este módulo decide. Assim as regras de rótulo
 * (A, B, C, D…), de inserção, remoção e reordenação são testáveis sem
 * navegador.
 *
 * MODELO: a lista é uma sequência ordenada de pontos. O **rótulo** e o
 * **tipo** são derivados da posição:
 *
 *   índice 0        → A  (origem)
 *   índices 1..n-2  → B, C, … (paradas intermediárias)
 *   índice n-1      → destino
 *
 * Consequência: remover ou reordenar pontos rotula tudo de novo
 * automaticamente, como o pedido exige.
 *
 * ── MODO CIRCUITO ────────────────────────────────────────────────────────
 *
 * Numa rota **circular** (A → B → C → … → A) não existe um destino
 * diferente da origem: o último card é uma **parada** como qualquer outra e
 * o **retorno à origem é automático**. Isso é exatamente o que o pedido
 * exige: "o retorno a A deve ser calculado automaticamente, sem criar uma
 * segunda parada editável para o mesmo ponto".
 *
 * Com `lista.circuito = true`:
 *
 *   índice 0        → A  (origem, também o fim do circuito)
 *   índices 1..n-1  → B, C, … (paradas)
 *
 * A origem continua fixa nas duas modalidades.
 */

/** Tipos de ponto no trajeto. */
export const TIPOS = { ORIGEM: 'origem', PARADA: 'parada', DESTINO: 'destino' };

/** Status possíveis do Endereço Digital de um ponto. */
export const STATUS = {
  VAZIO: 'VAZIO',
  MALFORMADO: 'MALFORMADO',
  VALIDADO: 'VALIDADO',
  CONVERTIDO: 'CONVERTIDO',
  FORA_DA_AREA: 'FORA_DA_AREA',
  FALHA: 'FALHA',
  INDISPONIVEL: 'INDISPONIVEL',
  SEM_CAMPO: 'SEM_CAMPO',
};

/** Cria uma lista de pontos vazia (só a origem e o destino). */
export function criarListaPontos() {
  // `circuito`: quando true, a lista descreve um circuito fechado (A → … → A)
  // e não há card de destino — o retorno à origem é automático.
  return { pontos: [], sequencia: 1, circuito: false };
}

/** Cria um ponto novo (sem Endereço Digital e sem coordenadas). */
export function criarPonto(extra = {}) {
  return {
    id: extra.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    rotulo: '?',
    tipo: TIPOS.PARADA,
    enderecoDigital: '',
    codigoNormalizado: null,
    codigoCompleto: null,
    status: STATUS.VAZIO,
    mensagem: '',
    latitude: null,
    longitude: null,
    origem: null,
    ...extra,
  };
}

/**
 * Aplica rótulos e tipos conforme a posição da lista.
 * A origem fica sempre na primeira posição e o destino sempre na última —
 * exceto no **modo circuito**, em que todas as demais posições são paradas
 * (o retorno à origem é automático).
 */
export function rotularPontos(lista) {
  const pontos = lista.pontos;
  const n = pontos.length;
  const circuito = lista.circuito === true;
  pontos.forEach((p, i) => {
    p.rotulo = String.fromCharCode(65 + i); // A, B, C, …
    p.tipo =
      i === 0
        ? TIPOS.ORIGEM
        : !circuito && i === n - 1
          ? TIPOS.DESTINO
          : TIPOS.PARADA;
    p.indice = i;
  });
  return lista;
}

/**
 * Acrescenta um ponto ao trajeto.
 * `posicao` = 'fim' (default) coloca como parada antes do destino;
 * `posicao` = 'inicio' coloca como parada logo depois da origem.
 */
export function adicionarPonto(lista, extra = {}) {
  const pontos = lista.pontos;
  const novo = criarPonto(extra);
  if (pontos.length === 0) {
    pontos.push(novo);
  } else if (extra.posicao === 'inicio') {
    pontos.splice(1, 0, novo);
  } else if (lista.circuito) {
    // no circuito não há destino: a parada entra no fim da lista
    pontos.push(novo);
  } else {
    // a parada entra **antes do destino** (e depois da origem)
    const i = Math.max(1, pontos.length - 1);
    pontos.splice(i, 0, novo);
  }
  return rotularPontos(lista);
}

/**
 * Remove um ponto pelo id.
 * A origem (e o destino, no modo ida-e-volta) não podem ser removidos;
 * no modo circuito todas as paradas podem.
 */
export function removerPonto(lista, id) {
  const pontos = lista.pontos;
  const i = pontos.findIndex((p) => p.id === id);
  if (i < 0) return lista;
  const fixo = i === 0 || (!lista.circuito && i === pontos.length - 1);
  if (fixo) return lista; // origem/destino ficam
  pontos.splice(i, 1);
  return rotularPontos(lista);
}

/** Atualiza os dados de um ponto (Endereço Digital, coordenadas, status…). */
export function atualizarPonto(lista, id, dados) {
  const ponto = lista.pontos.find((p) => p.id === id);
  if (!ponto) return null;
  Object.assign(ponto, dados);
  return ponto;
}

/**
 * Move um ponto uma posição para cima (`delta = -1`) ou para baixo
 * (`delta = +1`). A origem e o destino permanecem nas extremidades: só as
 * paradas intermediárias trocam de lugar entre si.
 */
export function moverPonto(lista, id, delta) {
  const pontos = lista.pontos;
  const i = pontos.findIndex((p) => p.id === id);
  if (i < 0) return lista;
  if (i === 0) return lista; // a origem é fixa
  if (!lista.circuito && i === pontos.length - 1) return lista; // destino fixo
  // no circuito a última posição é uma parada (o retorno é automático);
  // no modo comum a última posição é o destino e fica fixa
  const ultimo = lista.circuito ? pontos.length - 1 : pontos.length - 2;
  const j = i + (delta < 0 ? -1 : 1);
  if (j <= 0 || j > ultimo) return lista;
  const [ponto] = pontos.splice(i, 1);
  pontos.splice(j, 0, ponto);
  return rotularPontos(lista);
}

/**
 * Move um ponto (parada intermediária) para outra posição da lista —
 * é o que o **arrastar no painel** faz.
 *
 * `indiceFinal` é a posição desejada **na lista final** (a mesma em que o
 * ponto alvo estava). A origem (índice 0) e o destino (último) permanecem
 * nas extremidades: o índice é limitado à faixa das paradas
 * intermediárias, de modo que uma parada nunca vira origem nem destino.
 *
 * Retorna a lista re-rotulada, ou `null` se o movimento não for possível
 * (ponto fixo, índice inválido ou movimento nulo).
 */
export function moverPontoPara(lista, id, indiceFinal) {
  const pontos = lista.pontos;
  const i = pontos.findIndex((p) => p.id === id);
  if (i < 0) return null;
  if (i === 0) return null; // a origem é fixa
  if (!lista.circuito && i === pontos.length - 1) return null; // destino fixo
  const [ponto] = pontos.splice(i, 1);
  // depois da remoção, a parada pode ser inserida de 1 (logo depois da
  // origem) até o último índice livre:
  //   • no circuito, a última posição é uma PARADA → pode ser ocupada;
  //   • no modo comum, a última posição é o DESTINO (fixo) → a parada para
  //     uma posição antes.
  const maximo = lista.circuito ? pontos.length : pontos.length - 1;
  const alvo = Math.max(1, Math.min(maximo, Math.trunc(indiceFinal)));
  if (alvo === i) {
    pontos.splice(i, 0, ponto); // sem mudança
    return null;
  }
  pontos.splice(alvo, 0, ponto);
  return rotularPontos(lista);
}

/**
 * Verifica se a lista pode ser transformada em rota.
 * Exige: pelo menos dois pontos, todos com coordenadas resolvidas.
 */
export function podeCalcular(lista) {
  const pontos = lista.pontos;
  if (lista.circuito) {
    // um circuito precisa de pelo menos uma parada além da origem
    if (pontos.length < 2) {
      return {
        ok: false,
        motivo: 'PONTOS_INSUFICIENTES',
        mensagem:
          'Adicione ao menos uma parada para formar o circuito (origem → paradas → origem).',
      };
    }
  } else if (pontos.length < 2) {
    return { ok: false, motivo: 'PONTOS_INSUFICIENTES', mensagem: 'Informe ao menos origem e destino.' };
  }
  const semCoordenada = pontos.filter((p) => p.latitude == null || p.longitude == null);
  if (semCoordenada.length > 0) {
    const rotulos = semCoordenada.map((p) => p.rotulo).join(', ');
    return {
      ok: false,
      motivo: 'PONTO_SEM_COORDENADA',
      mensagem: `Resolva o Endereço Digital do ponto ${rotulos} antes de calcular a rota.`,
    };
  }
  return { ok: true, motivo: null, mensagem: '' };
}

/** Número de paradas intermediárias (no circuito, todas menos a origem). */
export function contarParadas(lista) {
  const total = lista.pontos.length;
  return Math.max(0, lista.circuito ? total - 1 : total - 2);
}

/** Sequência de rótulos (A → B → C → D). */
export function sequenciaRotulos(lista) {
  return lista.pontos.map((p) => p.rotulo);
}
