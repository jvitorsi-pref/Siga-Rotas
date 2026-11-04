/**
 * core/armazenamentoLocal.js
 * ---------------------------------------------------------------------------
 * ARMAZENAMENTO LOCAL (OFFLINE) — IndexedDB, com adaptador em memória.
 *
 * É a camada que sustenta a **coleta de campo**: rota planejada, sessão de
 * rastreamento GPS, pontos coletados e localizações de residências ficam
 * **no dispositivo**, sem depender de rede, e são recuperados depois de
 * recarregar a página, fechar o aplicativo ou perder a conexão.
 *
 * ── Princípios (LGPD/minimização) ────────────────────────────────────────
 *   • o módulo **não conhece** paciente, prontuário nem servidor: guarda
 *     apenas o que é necessário para o trajeto e para a geografia;
 *   • **nenhuma credencial** (senha, token) é gravada aqui — o storage do
 *     navegador é legível por qualquer script da mesma origem;
 *   • a **chave de idempotência** (id local) é gerada **no dispositivo** e
 *     viaja com o registro, para que o reenvio não duplique nada;
 *   • **nada é apagado** antes de a API confirmar a persistência.
 *
 * ── O que é reaproveitado ────────────────────────────────────────────────
 *   Nada foi reescrito do zero: o modelo de dados reaproveita os formatos
 *   que a API já devolve (`/api/rota-paradas`: `legs`, `sequenciaCompleta`,
 *   `geometry`, `distance`, `modo`, `circular`) e o código de Plus Code já
 *   existente em `core/enderecoDigital.js` (que roda **localmente**, sem
 *   rede). Este módulo cuida só da persistência.
 *
 * ── Adaptadores ──────────────────────────────────────────────────────────
 *   A persistência real é o IndexedDB (`criarAdaptadorIndexedDB`). Para os
 *   testes (Node não tem IndexedDB) e para navegadores em modo privado
 *   (onde o IndexedDB pode não existir), há `criarAdaptadorMemoria`, que
 *   implementa **a mesma interface** — inclusive aatomicidade das
 *   transações.
 *
 *   Interface do adaptador:
 *     abrir()                                  → Promise<void>
 *     transacao(stores, modo, fn(ctx))         → Promise<qualquer>
 *       ctx.obter(store, id)                   → Promise<registro|null>
 *       ctx.listar(store, {indice, valor})     → Promise<registro[]>
 *       ctx.salvar(store, registro)            → Promise<void>
 *       ctx.remover(store, id)                 → Promise<void>
 */

/* ─────────────── Estados e tipos ─────────────── */

/** Estados de sincronização de um registro (o mesmo para a fila). */
export const ESTADO = {
  PENDENTE: 'pendente',
  SINCRONIZANDO: 'sincronizando',
  SINCRONIZADO: 'sincronizado',
  ERRO: 'erro',
};

/** Lojas (object stores) do banco local. */
export const STORE = {
  ROTAS: 'rotasPlanejadas',
  SESSOES: 'sessoes',
  PONTOS: 'pontos',
  RESIDENCIAS: 'residencias',
  OPERACOES: 'operacoes',
};

/** Tipos de operação na fila de sincronização. */
export const TIPO_OPERACAO = {
  ROTA: 'rota',
  SESSAO: 'sessao',
  PONTOS: 'pontos',
  RESIDENCIA: 'residencias',
};

/** Nomes das lojas, na ordem em que são criadas. */
export const STORES = [
  STORE.ROTAS,
  STORE.SESSOES,
  STORE.PONTOS,
  STORE.RESIDENCIAS,
  STORE.OPERACOES,
];

/** Versão do esquema — subir quando a forma dos registros mudar. */
export const VERSAO_ESQUEMA = 1;

/**
 * Traduz um erro do armazenamento para uma mensagem útil — em especial a
 * **falta de espaço** (`QuotaExceededError`), que é o erro mais comum em
 * celular com pouco armazenamento disponível.
 *
 * @param {any} erro
 * @returns {string}
 */
export function descreverErroArmazenamento(erro) {
  if (!erro) return 'Erro desconhecido no armazenamento local.';
  const nome = erro.name || '';
  if (nome === 'QuotaExceededError') {
    return (
      'Espaço de armazenamento insuficiente no aparelho. ' +
      'Libere espaço ou sincronize os dados pendentes antes de continuar.'
    );
  }
  if (nome === 'SecurityError' || /not allowed|permiss/i.test(erro.message || '')) {
    return (
      'O navegador bloqueou o armazenamento local (modo privado ou permissão negada). ' +
      'Os dados desta sessão não sobreviverão ao fechamento do aplicativo.'
    );
  }
  if (nome === 'InvalidStateError' || nome === 'AbortError') {
    return 'A transação local foi interrompida (a aplicação pode ter sido fechada).';
  }
  return erro.message || 'Falha ao gravar no armazenamento local.';
}

const NOME_BANCO = 'santo-andre-campo';

/* ─────────────── Identificadores ─────────────── */

/**
 * Gera um identificador único **no dispositivo**.
 * Usa `crypto.randomUUID()` quando disponível (contexto seguro) e um
 * gerador alternativo — também aleatório — quando não há.
 *
 * @param {string} prefixo ex.: 'rta', 'ses', 'pto', 'res', 'op'
 * @returns {string}
 */
export function novoId(prefixo = 'id') {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  let bruto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    bruto = cryptoObj.randomUUID();
  } else if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bruto = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    bruto =
      Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }
  return `${prefixo}_${bruto}`;
}

/* ─────────────── Adaptador: memória ─────────────── */

/**
 * Adaptador em memória — mesma interface do IndexedDB, com transações
 * atômicas (snapshot/rollback). Usado nos testes e como reserva quando o
 * IndexedDB não está disponível (modo privado em alguns navegadores).
 */
export function criarAdaptadorMemoria() {
  const dados = new Map();
  for (const s of STORES) dados.set(s, new Map());
  let aberto = false;

  function loja(store) {
    if (!dados.has(store)) dados.set(store, new Map());
    return dados.get(store);
  }

  function clonar(valor) {
    return valor === undefined || valor === null ? valor : JSON.parse(JSON.stringify(valor));
  }

  return {
    nome: 'memoria',
    async abrir() {
      aberto = true;
    },
    get aberto() {
      return aberto;
    },
    async transacao(stores, modo, fn) {
      const afetadas = (stores && stores.length ? stores : STORES).map(loja);
      const backup = new Map();
      if (modo === 'readwrite') {
        for (const l of afetadas) backup.set(l, new Map(l));
      }
      const ctx = {
        async obter(store, id) {
          const v = loja(store).get(id);
          return v ? clonar(v) : null;
        },
        async listar(store, filtro) {
          let itens = Array.from(loja(store).values()).map(clonar);
          if (filtro && filtro.indice) {
            itens = itens.filter((r) => r[filtro.indice] === filtro.valor);
          }
          if (filtro && filtro.ordenarPor) {
            const chave = filtro.ordenarPor;
            itens.sort((a, b) => (a[chave] || '').localeCompare(b[chave] || ''));
          }
          return itens;
        },
        async salvar(store, registro) {
          if (modo !== 'readwrite') throw new Error('Transação somente leitura.');
          loja(store).set(registro.id, clonar(registro));
        },
        async remover(store, id) {
          if (modo !== 'readwrite') throw new Error('Transação somente leitura.');
          loja(store).delete(id);
        },
      };
      try {
        const out = await fn(ctx);
        return out;
      } catch (e) {
        if (modo === 'readwrite') {
          for (const [l, snap] of backup) l.clear();
          for (const [l, snap] of backup) for (const [k, v] of snap) l.set(k, v);
        }
        throw e;
      }
    },
    /** Só para inspeção/testes. */
    _dump() {
      const out = {};
      for (const [s, m] of dados) out[s] = Array.from(m.values());
      return out;
    },
  };
}

/* ─────────────── Adaptador: IndexedDB ─────────────── */

/**
 * Adaptador IndexedDB (persistência real no dispositivo).
 * @param {object} [opcoes]
 *   - `factory`: `indexedDB` (injetável para testes)
 *   - `nome`: nome do banco
 */
export function criarAdaptadorIndexedDB(opcoes = {}) {
  const factory =
    opcoes.factory ||
    (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const nome = opcoes.nome || NOME_BANCO;
  let db = null;

  function pedido(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Falha na operação IndexedDB.'));
    });
  }

  function transacaoConcluida(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Transação IndexedDB falhou.'));
      tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB abortada.'));
    });
  }

  return {
    nome: 'indexeddb',
    get aberto() {
      return !!db;
    },
    async abrir() {
      if (db) return;
      if (!factory) throw new Error('IndexedDB indisponível neste ambiente.');
      const req = factory.open(nome, VERSAO_ESQUEMA);
      req.onupgradeneeded = () => {
        const bd = req.result;
        if (!bd.objectStoreNames.contains(STORE.ROTAS)) {
          const s = bd.createObjectStore(STORE.ROTAS, { keyPath: 'id' });
          s.createIndex('criadoEm', 'criadoEm');
          s.createIndex('estado', 'estado');
        }
        if (!bd.objectStoreNames.contains(STORE.SESSOES)) {
          const s = bd.createObjectStore(STORE.SESSOES, { keyPath: 'id' });
          s.createIndex('criadoEm', 'criadoEm');
          s.createIndex('estado', 'estado');
        }
        if (!bd.objectStoreNames.contains(STORE.PONTOS)) {
          const s = bd.createObjectStore(STORE.PONTOS, { keyPath: 'id' });
          s.createIndex('sessaoId', 'sessaoId');
          s.createIndex('ordem', 'ordem');
        }
        if (!bd.objectStoreNames.contains(STORE.RESIDENCIAS)) {
          const s = bd.createObjectStore(STORE.RESIDENCIAS, { keyPath: 'id' });
          s.createIndex('criadoEm', 'criadoEm');
          s.createIndex('estado', 'estado');
        }
        if (!bd.objectStoreNames.contains(STORE.OPERACOES)) {
          const s = bd.createObjectStore(STORE.OPERACOES, { keyPath: 'id' });
          s.createIndex('estado', 'estado');
          s.createIndex('tipo', 'tipo');
          s.createIndex('criadoEm', 'criadoEm');
        }
      };
      db = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Não foi possível abrir o banco local.'));
        req.onblocked = () =>
          reject(new Error('Banco local bloqueado por outra aba aberta do aplicativo.'));
      });
    },
    async transacao(stores, modo, fn) {
      if (!db) await this.abrir();
      const nomes = (stores && stores.length ? stores : STORES).filter((s) =>
        db.objectStoreNames.contains(s),
      );
      const tx = db.transaction(nomes, modo);
      const storesMap = new Map(nomes.map((n) => [n, tx.objectStore(n)]));
      const ctx = {
        async obter(store, id) {
          const os = storesMap.get(store);
          if (!os) return null;
          return (await pedido(os.get(id))) || null;
        },
        async listar(store, filtro) {
          const os = storesMap.get(store);
          if (!os) return [];
          let itens = await pedido(os.getAll());
          if (filtro && filtro.indice) {
            itens = itens.filter((r) => r[filtro.indice] === filtro.valor);
          }
          if (filtro && filtro.ordenarPor) {
            const chave = filtro.ordenarPor;
            itens.sort((a, b) => (a[chave] || '').localeCompare(b[chave] || ''));
          }
          return itens;
        },
        async salvar(store, registro) {
          const os = storesMap.get(store);
          if (!os) throw new Error(`Loja desconhecida: ${store}`);
          os.put(registro);
        },
        async remover(store, id) {
          const os = storesMap.get(store);
          if (!os) throw new Error(`Loja desconhecida: ${store}`);
          os.delete(id);
        },
      };
      const resultado = await fn(ctx);
      await transacaoConcluida(tx);
      return resultado;
    },
  };
}

/* ─────────────── Repositório ─────────────── */

/**
 * Cria o repositório local (a API que a interface e a coleta usam).
 *
 * @param {object} [opcoes]
 *   - `adaptador`: implementa a interface de adaptador (padrão: IndexedDB)
 *   - `agora`: função de tempo (injetável nos testes)
 */
export function criarArmazenamento(opcoes = {}) {
  const cfg = {
    adaptador: null,
    agora: () => Date.now(),
    ...opcoes,
  };
  const adaptador = cfg.adaptador || criarAdaptadorIndexedDB();
  let aberto = false;

  function carimbo() {
    return new Date(cfg.agora()).toISOString();
  }

  /** Cria (ou atualiza) a entrada de fila de um registro. */
  async function enfileirar(ctx, { tipo, registroId, descricao }) {
    const existente = (await ctx.listar(STORE.OPERACOES)).find(
      (o) => o.tipo === tipo && o.registroId === registroId && o.estado !== ESTADO.SINCRONIZADO,
    );
    if (existente) {
      await ctx.salvar(STORE.OPERACOES, {
        ...existente,
        atualizadoEm: carimbo(),
        tentativas: (existente.tentativas || 0) + 1,
        descricao: descricao || existente.descricao,
      });
      return;
    }
    await ctx.salvar(STORE.OPERACOES, {
      id: novoId('op'),
      tipo,
      registroId,
      descricao: descricao || null,
      estado: ESTADO.PENDENTE,
      tentativas: 1,
      criadoEm: carimbo(),
      atualizadoEm: carimbo(),
      ultimoErro: null,
    });
  }

  const repo = {
    get adaptador() {
      return adaptador;
    },

    async abrir() {
      if (aberto) return repo;
      await adaptador.abrir();
      aberto = true;
      return repo;
    },

    /* ── rotas planejadas ─────────────────────────────────────────── */

    /**
     * Salva a rota planejada (com pontos, sequência, pernas e geometria).
     * @param {object} rota
     * @param {object} [opcoes]
     *   - `enfileirar`: cria/atualiza a entrada de fila (padrão true)
     */
    async salvarRota(rota, opcoes = {}) {
      await repo.abrir();
      const agora = carimbo();
      const id = rota.id || novoId('rta');
      const registro = {
        id,
        tipo: 'rota',
        versao: rota.versao || 1,
        modo: rota.modo || 'usuario',
        circular: rota.circular === true,
        pontos: Array.isArray(rota.pontos) ? rota.pontos : [],
        sequencia: rota.sequencia || [],
        sequenciaCompleta: rota.sequenciaCompleta || [],
        legs: Array.isArray(rota.legs) ? rota.legs : [],
        // Esquema v1 guarda coordenadas; aceita também o GeoJSON da API.
        geometry: Array.isArray(rota.geometry)
          ? rota.geometry
          : rota.geometry?.type === 'LineString' && Array.isArray(rota.geometry.coordinates)
            ? rota.geometry.coordinates
            : [],
        streets: Array.isArray(rota.streets) ? rota.streets : [],
        distance: Number.isFinite(rota.distance) ? rota.distance : 0,
        agenteId: rota.agenteId || null,
        dispositivoId: rota.dispositivoId || null,
        observacoes: rota.observacoes || null,
        estado: rota.estado || ESTADO.PENDENTE,
        criadoEm: rota.criadoEm || agora,
        atualizadoEm: agora,
      };
      await adaptador.transacao([STORE.ROTAS, STORE.OPERACOES], 'readwrite', async (ctx) => {
        await ctx.salvar(STORE.ROTAS, registro);
        if (opcoes.enfileirar !== false) {
          await enfileirar(ctx, {
            tipo: TIPO_OPERACAO.ROTA,
            registroId: id,
            descricao: `Rota ${registro.sequenciaCompleta.join(' → ')}`,
          });
        }
      });
      return registro;
    },

    async obterRota(id) {
      await repo.abrir();
      return adaptador.transacao([STORE.ROTAS], 'readonly', (ctx) => ctx.obter(STORE.ROTAS, id));
    },

    async listarRotas() {
      await repo.abrir();
      return adaptador.transacao([STORE.ROTAS], 'readonly', (ctx) =>
        ctx.listar(STORE.ROTAS, { ordenarPor: 'criadoEm' }),
      );
    },

    async removerRota(id) {
      await repo.abrir();
      const rota = await repo.obterRota(id);
      if (!rota) return { ok: false, motivo: 'NAO_ENCONTRADA' };
      if (rota.estado !== ESTADO.SINCRONIZADO) {
        return {
          ok: false,
          motivo: 'NAO_SINCRONIZADO',
          message: 'A rota ainda não foi confirmada pelo servidor; ela não pode ser apagada.',
        };
      }
      await adaptador.transacao([STORE.ROTAS, STORE.OPERACOES], 'readwrite', async (ctx) => {
        await ctx.remover(STORE.ROTAS, id);
        for (const op of await ctx.listar(STORE.OPERACOES)) {
          if (op.tipo === TIPO_OPERACAO.ROTA && op.registroId === id) {
            await ctx.remover(STORE.OPERACOES, op.id);
          }
        }
      });
      return { ok: true };
    },

    /* ── sessões de coleta ────────────────────────────────────────── */

    async salvarSessao(sessao, opcoes = {}) {
      await repo.abrir();
      const agora = carimbo();
      const id = sessao.id || novoId('ses');
      const registro = {
        id,
        tipo: 'sessao',
        estado: sessao.estado || 'ativa',
        agenteId: sessao.agenteId || null,
        dispositivoId: sessao.dispositivoId || null,
        rotaId: sessao.rotaId || null,
        versaoRota: sessao.versaoRota || null,
        modo: sessao.modo || null,
        // origem da posição registrada: 'gps' (real) ou 'simulacao' (teste)
        fonte: sessao.fonte || 'gps',
        circular: sessao.circular === true,
        sequencia: sessao.sequencia || [],
        iniciadaEm: sessao.iniciadaEm || null,
        encerradaEm: sessao.encerradaEm || null,
        pontos: Number.isFinite(sessao.pontos) ? sessao.pontos : 0,
        distancia: Number.isFinite(sessao.distancia) ? sessao.distancia : 0,
        estimada: Boolean(sessao.estimada),
        observacoes: sessao.observacoes || null,
        estadoSync: sessao.estadoSync || ESTADO.PENDENTE,
        criadoEm: sessao.criadoEm || agora,
        atualizadoEm: agora,
      };
      await adaptador.transacao([STORE.SESSOES, STORE.OPERACOES], 'readwrite', async (ctx) => {
        await ctx.salvar(STORE.SESSOES, registro);
        if (opcoes.enfileirar !== false) {
          await enfileirar(ctx, {
            tipo: TIPO_OPERACAO.SESSAO,
            registroId: id,
            descricao: `Sessão de coleta ${id}`,
          });
        }
      });
      return registro;
    },

    async obterSessao(id) {
      await repo.abrir();
      return adaptador.transacao([STORE.SESSOES], 'readonly', (ctx) => ctx.obter(STORE.SESSOES, id));
    },

    async listarSessoes() {
      await repo.abrir();
      return adaptador.transacao([STORE.SESSOES], 'readonly', (ctx) =>
        ctx.listar(STORE.SESSOES, { ordenarPor: 'criadoEm' }),
      );
    },

    /** Sessões que ficaram abertas (interrompidas) — recuperáveis. */
    async listarSessoesAbertas() {
      const sessoes = await repo.listarSessoes();
      return sessoes.filter((s) => s.estado === 'ativa' || s.estado === 'pausada');
    },

    /**
     * Acrescenta pontos a uma sessão (uma transação só).
     * @param {string} sessaoId
     * @param {Array<object>} pontos
     */
    async adicionarPontos(sessaoId, pontos) {
      await repo.abrir();
      const lista = Array.isArray(pontos) ? pontos : [];
      if (!lista.length) return 0;
      const agora = carimbo();
      const gravados = await adaptador.transacao(
        [STORE.PONTOS, STORE.SESSOES, STORE.OPERACOES],
        'readwrite',
        async (ctx) => {
          const sessao = await ctx.obter(STORE.SESSOES, sessaoId);
          if (!sessao) throw new Error(`Sessão desconhecida: ${sessaoId}`);
          for (const p of lista) {
            await ctx.salvar(STORE.PONTOS, {
              ...p,
              id: p.id || novoId('pto'),
              sessaoId,
              estadoSync: ESTADO.PENDENTE,
              criadoEm: p.criadoEm || agora,
            });
          }
          await ctx.salvar(STORE.SESSOES, {
            ...sessao,
            pontos: (sessao.pontos || 0) + lista.length,
            atualizadoEm: agora,
          });
          await enfileirar(ctx, {
            tipo: TIPO_OPERACAO.PONTOS,
            registroId: sessaoId,
            descricao: `${lista.length} ponto(s) da sessão ${sessaoId}`,
          });
          return lista.length;
        },
      );
      return gravados;
    },

    async listarPontos(sessaoId) {
      await repo.abrir();
      return adaptador.transacao([STORE.PONTOS], 'readonly', async (ctx) => {
        const itens = await ctx.listar(STORE.PONTOS, { indice: 'sessaoId', valor: sessaoId });
        return itens.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      });
    },

    async contarPontos(sessaoId) {
      await repo.abrir();
      return adaptador.transacao([STORE.PONTOS], 'readonly', async (ctx) => {
        const itens = await ctx.listar(STORE.PONTOS, { indice: 'sessaoId', valor: sessaoId });
        return itens.length;
      });
    },

    /* ── localizações de residências ──────────────────────────────── */

    async salvarResidencia(residencia, opcoes = {}) {
      await repo.abrir();
      const agora = carimbo();
      const id = residencia.id || novoId('res');
      const historico = Array.isArray(residencia.historico) ? residencia.historico : [];
      const registro = {
        id,
        tipo: 'localizacao',
        estado: residencia.estado || ESTADO.PENDENTE,
        latitude: Number(residencia.latitude),
        longitude: Number(residencia.longitude),
        precisao: Number.isFinite(residencia.precisao) ? residencia.precisao : null,
        enderecoDigital: residencia.enderecoDigital || null,
        classificacao: residencia.classificacao || 'nova',
        sessaoId: residencia.sessaoId || null,
        pontoId: residencyPontoId(residencia),
        // 'gps' (real) ou 'simulacao' (modo de teste)
        fonte: residencia.fonte || 'gps',
        agenteId: residencia.agenteId || null,
        dispositivoId: residencia.dispositivoId || null,
        observacoes: residencia.observacoes || null,
        historico,
        criadoEm: residencia.criadoEm || agora,
        atualizadoEm: agora,
      };
      await adaptador.transacao([STORE.RESIDENCIAS, STORE.OPERACOES], 'readwrite', async (ctx) => {
        await ctx.salvar(STORE.RESIDENCIAS, registro);
        if (opcoes.enfileirar !== false) {
          await enfileirar(ctx, {
            tipo: TIPO_OPERACAO.RESIDENCIA,
            registroId: id,
            descricao: `Localização ${registro.enderecoDigital || id}`,
          });
        }
      });
      return registro;
    },

    async obterResidencia(id) {
      await repo.abrir();
      return adaptador.transacao([STORE.RESIDENCIAS], 'readonly', (ctx) =>
        ctx.obter(STORE.RESIDENCIAS, id),
      );
    },

    async listarResidencias() {
      await repo.abrir();
      return adaptador.transacao([STORE.RESIDENCIAS], 'readonly', (ctx) =>
        ctx.listar(STORE.RESIDENCIAS, { ordenarPor: 'criadoEm' }),
      );
    },

    /** Histórico de alterações de uma residência (append-only). */
    async registrarHistoricoResidencia(id, evento) {
      await repo.abrir();
      return adaptador.transacao([STORE.RESIDENCIAS], 'readwrite', async (ctx) => {
        const atual = await ctx.obter(STORE.RESIDENCIAS, id);
        if (!atual) throw new Error(`Localização desconhecida: ${id}`);
        const atualizado = {
          ...atual,
          historico: [...(atual.historico || []), { em: carimbo(), ...evento }],
          atualizadoEm: carimbo(),
        };
        await ctx.salvar(STORE.RESIDENCIAS, atualizado);
        return atualizado;
      });
    },

    /* ── fila de sincronização ────────────────────────────────────── */

    async listarOperacoes() {
      await repo.abrir();
      return adaptador.transacao([STORE.OPERACOES], 'readonly', (ctx) =>
        ctx.listar(STORE.OPERACOES, { ordenarPor: 'criadoEm' }),
      );
    },

    async listarOperacoesPendentes() {
      const ops = await repo.listarOperacoes();
      return ops.filter((o) => o.estado === ESTADO.PENDENTE || o.estado === ESTADO.ERRO);
    },

    /** Muda o estado de uma operação da fila. */
    async atualizarOperacao(id, mudanca) {
      await repo.abrir();
      return adaptador.transacao([STORE.OPERACOES], 'readwrite', async (ctx) => {
        const op = await ctx.obter(STORE.OPERACOES, id);
        if (!op) throw new Error(`Operação desconhecida: ${id}`);
        const atualizada = {
          ...op,
          ...mudanca,
          atualizadoEm: carimbo(),
        };
        await ctx.salvar(STORE.OPERACOES, atualizada);
        return atualizada;
      });
    },

    /** Marca o estado de sincronização de um registro (e da sua operação). */
    async marcarEstadoRegistro(store, id, estado, erro = null) {
      await repo.abrir();
      return adaptador.transacao([store, STORE.OPERACOES], 'readwrite', async (ctx) => {
        const registro = await ctx.obter(store, id);
        if (!registro) throw new Error(`Registro desconhecido: ${id}`);
        await ctx.salvar(store, { ...registro, estado, estadoSync: estado, atualizadoEm: carimbo() });
        const tipoPorStore = {
          [STORE.ROTAS]: TIPO_OPERACAO.ROTA,
          [STORE.SESSOES]: TIPO_OPERACAO.SESSAO,
          [STORE.RESIDENCIAS]: TIPO_OPERACAO.RESIDENCIA,
        };
        const tipo = tipoPorStore[store];
        if (tipo) {
          for (const op of await ctx.listar(STORE.OPERACOES)) {
            if (op.tipo === tipo && op.registroId === id) {
              await ctx.salvar(STORE.OPERACOES, {
                ...op,
                estado,
                ultimoErro: erro,
                atualizadoEm: carimbo(),
              });
            }
          }
        }
        return true;
      });
    },

    /* ── diagnóstico ───────────────────────────────────────────────── */

    async estatisticas() {
      await repo.abrir();
      const [rotas, sessoes, pontos, residencias, operacoes] = await Promise.all([
        repo.listarRotas(),
        repo.listarSessoes(),
        adaptador.transacao([STORE.PONTOS], 'readonly', (ctx) => ctx.listar(STORE.PONTOS)),
        repo.listarResidencias(),
        repo.listarOperacoes(),
      ]);
      return {
        rotas: rotas.length,
        sessoes: sessoes.length,
        pontos: pontos.length,
        residencias: residencias.length,
        pendentes: operacoes.filter(
          (o) => o.estado === ESTADO.PENDENTE || o.estado === ESTADO.ERRO,
        ).length,
        porEstado: operacoes.reduce((acc, o) => {
          acc[o.estado] = (acc[o.estado] || 0) + 1;
          return acc;
        }, {}),
      };
    },

    /**
     * Apaga dados locais. Por segurança, só remove o que o servidor já
     * confirmou (`sincronizado`); o resto é preservado.
     */
    async limpar({ somenteSincronizados = true } = {}) {
      await repo.abrir();
      const removidos = { rotas: 0, sessoes: 0, pontos: 0, residencias: 0, operacoes: 0 };
      await adaptador.transacao(STORES, 'readwrite', async (ctx) => {
        const pode = (r) => !somenteSincronizados || r.estado === ESTADO.SINCRONIZADO;
        for (const [store, chave] of [
          [STORE.ROTAS, 'rotas'],
          [STORE.SESSOES, 'sessoes'],
          [STORE.RESIDENCIAS, 'residencias'],
        ]) {
          for (const r of await ctx.listar(store)) {
            if (pode(r)) {
              await ctx.remover(store, r.id);
              removidos[chave] += 1;
            }
          }
        }
        for (const p of await ctx.listar(STORE.PONTOS)) {
          if (!somenteSincronizados) {
            await ctx.remover(STORE.PONTOS, p.id);
            removidos.pontos += 1;
          }
        }
        for (const o of await ctx.listar(STORE.OPERACOES)) {
          if (o.estado === ESTADO.SINCRONIZADO) {
            await ctx.remover(STORE.OPERACOES, o.id);
            removidos.operacoes += 1;
          }
        }
      });
      return removidos;
    },
  };

  return repo;
}

function residencyPontoId(residencia) {
  return residencia.pontoId || null;
}
