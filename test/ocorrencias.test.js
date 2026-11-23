import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../core/graph.js';
import {
  ACOES_COLABORATIVAS,
  CATEGORIAS_OCORRENCIA,
  CLASSIFICACOES,
  STATUS_OCORRENCIA,
  TEMPORALIDADES,
  obterCategoria,
} from '../ocorrencias/catalogo.js';
import {
  ESCALAS_PENALIDADE,
  MODOS_PREFERENCIA,
  preferenciasPadrao,
  normalizarPreferencias,
} from '../ocorrencias/preferencias.js';
import {
  aplicarInteracao,
  associarSegmentoDaRede,
  atualizarExpiracoes,
  criarOcorrencia,
  localizarArestasDaOcorrencia,
  ocorrenciaInfluenciaCalculo,
} from '../ocorrencias/regras.js';
import { feature, official } from './helpers.js';

function criarRedeRuasParalelas() {
  // Duas ruas paralelas horizontais separadas por ~18 m em latitude,
  // e duas transversais verticais dividindo a Rua Sul em 2 quarteirões.
  const baseLon = -46.42;
  const latSul = -23.68;
  const latNorte = -23.67984; // ~17.7 m ao norte
  return buildGraph([
    feature(official(101, 'RUA SUL'), [
      [baseLon, latSul],
      [baseLon + 0.002, latSul],
    ]),
    feature(official(102, 'RUA NORTE'), [
      [baseLon, latNorte],
      [baseLon + 0.002, latNorte],
    ]),
    feature(official(103, 'TRAVESSA CENTRO'), [
      [baseLon + 0.001, latSul - 0.0004],
      [baseLon + 0.001, latNorte + 0.0004],
    ]),
  ]);
}

describe('ocorrencias — catálogo e preferências', () => {
  it('catálogo expõe todas as 10 categorias solicitadas', () => {
    assert.equal(CATEGORIAS_OCORRENCIA.length, 10);
    const ids = CATEGORIAS_OCORRENCIA.map((c) => c.id);
    for (const esperado of [
      'escadaria',
      'terreno_irregular',
      'rua_ingreme',
      'passagem_estreita',
      'buracos',
      'alagamento',
      'obra_bloqueio',
      'calcada_inexistente',
      'obstaculo',
      'outras',
    ]) {
      assert.ok(ids.includes(esperado), `categoria ausente: ${esperado}`);
      assert.ok(obterCategoria(esperado));
    }
  });

  it('normalizarPreferencias aplica defaults seguros e deduplica categorias válidas', () => {
    const p = normalizarPreferencias({
      modo: 'priorizar_sem_dificuldades',
      penalidadePadrao: 'alta',
      evitarCategorias: ['escadaria', 'escadaria', 'inexistente', 'alagamento'],
    });
    assert.equal(p.modo, MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES);
    assert.equal(p.penalidadePadrao, 'alta');
    assert.deepEqual(p.evitarCategorias, ['escadaria', 'alagamento']);
    assert.equal(ESCALAS_PENALIDADE.media, 1);
    assert.equal(preferenciasPadrao().modo, MODOS_PREFERENCIA.CONSIDERAR);
  });
});

describe('ocorrencias — associação precisa ao segmento da rede', () => {
  it('associa ponto ao trecho correto sem confundir ruas paralelas', () => {
    const graph = criarRedeRuasParalelas();
    // Ponto a ~2 m ao norte da RUA SUL (latSul + 0.00002), longe da RUA NORTE (~15 m)
    const res = associarSegmentoDaRede(graph, {
      latitude: -23.67998,
      longitude: -46.4195,
    });
    assert.equal(res.ok, true);
    assert.equal(res.principal.featureId, 101);
    assert.equal(res.principal.logradouro, 'RUA SUL');
    assert.ok(res.candidatos.length >= 2);
    assert.equal(res.temRuasProximas, false); // ~2 m vs ~15 m => delta ~13 m

    // Ponto no meio entre as duas ruas paralelas => sinaliza ruas próximas
    const meio = associarSegmentoDaRede(graph, {
      latitude: -23.67992,
      longitude: -46.4195,
    });
    assert.equal(meio.ok, true);
    assert.equal(meio.temRuasProximas, true);

    // Escolha explícita do usuário pela rua paralela
    const forcada = associarSegmentoDaRede(graph, {
      latitude: -23.67992,
      longitude: -46.4195,
      featureIdPreferido: 102,
    });
    assert.equal(forcada.principal.featureId, 102);
    assert.equal(forcada.principal.logradouro, 'RUA NORTE');
  });

  it('localiza apenas o quarteirão específico de uma feição dividida por cruzamento', () => {
    const graph = criarRedeRuasParalelas();
    const criado = criarOcorrencia(
      {
        categoria: 'buracos',
        classificacao: CLASSIFICACOES.PENALIZA,
        latitude: -23.68,
        longitude: -46.4195, // quarteirão oeste da RUA SUL (featureId 101)
      },
      { graph, usuarioId: 'user-1', agora: 1700000000000 },
    );
    assert.equal(criado.ok, true);

    const edgesFeicao101 = graph.edges.filter((e) => e.featureId === 101);
    assert.equal(edgesFeicao101.length, 2, 'RUA SUL deve estar dividida em 2 arestas pela travessa');

    const afetadas = localizarArestasDaOcorrencia(graph, criado.ocorrencia);
    assert.equal(afetadas.length, 1, 'somente a sub-aresta exata do quarteirão deve ser afetada');
    assert.equal(afetadas[0].featureId, 101);
  });

  it('fallback espacial encontra o trecho correto mesmo se featureId mudar', () => {
    const graph = criarRedeRuasParalelas();
    const criado = criarOcorrencia(
      {
        categoria: 'escadaria',
        latitude: -23.68,
        longitude: -46.4195,
      },
      { graph, usuarioId: 'user-1', agora: 1700000000000 },
    );
    const alterada = {
      ...criado.ocorrencia,
      localizacao: {
        ...criado.ocorrencia.localizacao,
        featureId: 999999,
      },
    };
    const afetadas = localizarArestasDaOcorrencia(graph, alterada);
    assert.equal(afetadas.length, 1);
    assert.equal(afetadas[0].featureId, 101);
  });
});

describe('ocorrencias — colaboração, validação e expiração', () => {
  it('impede confirmação duplicada pelo mesmo usuário e permite troca para resolvida', () => {
    const graph = criarRedeRuasParalelas();
    const baseTime = Date.UTC(2026, 10, 1, 12, 0, 0);
    const { ocorrencia } = criarOcorrencia(
      {
        categoria: 'alagamento',
        temporalidade: TEMPORALIDADES.TEMPORARIA,
        latitude: -23.68,
        longitude: -46.4195,
      },
      { graph, usuarioId: 'u1', agora: baseTime },
    );

    // Mesmo usuário tentando confirmar de novo -> bloqueado
    const dup = aplicarInteracao(ocorrencia, {
      tipo: ACOES_COLABORATIVAS.CONFIRMAR,
      usuarioId: 'u1',
      agora: baseTime + 60000,
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.duplicada, true);

    // Outro usuário confirma -> incrementa contador e estende expiração
    const conf2 = aplicarInteracao(ocorrencia, {
      tipo: ACOES_COLABORATIVAS.CONFIRMAR,
      usuarioId: 'u2',
      agora: baseTime + 3600 * 1000,
    });
    assert.equal(conf2.ok, true);
    assert.equal(conf2.ocorrencia.contadores.confirmacoes, 2);
    assert.ok(Date.parse(conf2.ocorrencia.expiraEm) > Date.parse(ocorrencia.expiraEm));

    // Regra de resolução exige consenso (>= 3 resolvida ou >= 2 e > confirmacoes)
    const r1 = aplicarInteracao(conf2.ocorrencia, {
      tipo: ACOES_COLABORATIVAS.RESOLVER,
      usuarioId: 'u3',
      agora: baseTime + 7200 * 1000,
    });
    assert.equal(r1.ocorrencia.status, STATUS_OCORRENCIA.ATIVA);
    const r2 = aplicarInteracao(r1.ocorrencia, {
      tipo: ACOES_COLABORATIVAS.RESOLVER,
      usuarioId: 'u4',
      agora: baseTime + 7300 * 1000,
    });
    assert.equal(r2.ocorrencia.status, STATUS_OCORRENCIA.ATIVA); // 2 vs 2 ainda não supera
    const r3 = aplicarInteracao(r2.ocorrencia, {
      tipo: ACOES_COLABORATIVAS.RESOLVER,
      usuarioId: 'u5',
      agora: baseTime + 7400 * 1000,
    });
    assert.equal(r3.ocorrencia.status, STATUS_OCORRENCIA.RESOLVIDA);
  });

  it('temporária expira após TTL, mas permanente NUNCA expira pelo tempo', () => {
    const graph = criarRedeRuasParalelas();
    const t0 = Date.UTC(2026, 0, 1, 10, 0, 0);

    const temp = criarOcorrencia(
      {
        categoria: 'obra_bloqueio',
        temporalidade: TEMPORALIDADES.TEMPORARIA,
        ttlHoras: 48,
        latitude: -23.68,
        longitude: -46.4195,
      },
      { graph, usuarioId: 'u1', agora: t0 },
    ).ocorrencia;

    const perm = criarOcorrencia(
      {
        categoria: 'escadaria',
        temporalidade: TEMPORALIDADES.PERMANENTE,
        latitude: -23.67984,
        longitude: -46.4195,
      },
      { graph, usuarioId: 'u1', agora: t0 },
    ).ocorrencia;

    assert.equal(perm.expiraEm, null);

    // 5 anos depois: temporária expira, permanente continua ATIVA
    const cincoAnosDepois = t0 + 5 * 365 * 24 * 3600 * 1000;
    const { ocorrencias } = atualizarExpiracoes([temp, perm], cincoAnosDepois);
    assert.equal(ocorrencias[0].status, STATUS_OCORRENCIA.EXPIRADA);
    assert.equal(ocorrencias[1].status, STATUS_OCORRENCIA.ATIVA);
  });

  it('avalia impacto de classificação x preferência do usuário', () => {
    const graph = criarRedeRuasParalelas();
    const { ocorrencia: escada } = criarOcorrencia(
      {
        categoria: 'escadaria',
        classificacao: CLASSIFICACOES.PENALIZA,
        penalidadeMetros: 200,
        latitude: -23.68,
        longitude: -46.4195,
      },
      { graph, usuarioId: 'u1' },
    );

    const ign = ocorrenciaInfluenciaCalculo(escada, { modo: MODOS_PREFERENCIA.IGNORAR });
    assert.equal(ign.aplica, false);

    const cons = ocorrenciaInfluenciaCalculo(escada, { modo: MODOS_PREFERENCIA.CONSIDERAR });
    assert.equal(cons.aplica, true);
    assert.equal(cons.penalidadeMetros, 200);

    const prio = ocorrenciaInfluenciaCalculo(escada, {
      modo: MODOS_PREFERENCIA.PRIORIZAR_SEM_DIFICULDADES,
      penalidadePadrao: 'alta',
    });
    assert.equal(prio.aplica, true);
    assert.ok(prio.penalidadeMetros > 200);

    const evita = ocorrenciaInfluenciaCalculo(escada, {
      modo: MODOS_PREFERENCIA.CONSIDERAR,
      evitarCategorias: ['escadaria'],
    });
    assert.equal(evita.modoEfeito, CLASSIFICACOES.EVITA);
  });
});
