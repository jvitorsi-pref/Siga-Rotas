/**
 * Serviço de persistência atômica e ciclo de vida das ocorrências colaborativas.
 *
 * Mantém um arquivo JSON (`data/ocorrencias.json` por padrão) com gravação atômica
 * (arquivo temporário + rename) e fila serializada de escrita para evitar corrida
 * entre requisições simultâneas de clientes Web, WebForms e APK.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aplicarInteracao,
  atualizarExpiracoes,
  criarOcorrencia,
} from '../ocorrencias/regras.js';
import { STATUS_OCORRENCIA } from '../ocorrencias/catalogo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const OCORRENCIAS_PATH = path.join(ROOT, 'data', 'ocorrencias.json');

export class OcorrenciasService {
  constructor(options = {}) {
    this.filePath = options.filePath || OCORRENCIAS_PATH;
    this.loaded = false;
    this.ocorrencias = [];
    this._writeQueue = Promise.resolve();
  }

  _enqueue(fn) {
    const next = this._writeQueue.then(fn, fn);
    this._writeQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  async _carregarSeNecessario(agora = Date.now()) {
    if (!this.loaded) {
      if (existsSync(this.filePath)) {
        try {
          const bruto = await readFile(this.filePath, 'utf8');
          const parsed = JSON.parse(bruto);
          const lista = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.ocorrencias)
              ? parsed.ocorrencias
              : [];
          const { ocorrencias, mudou } = atualizarExpiracoes(lista, agora);
          this.ocorrencias = ocorrencias;
          this.loaded = true;
          if (mudou) await this._persistir();
        } catch {
          this.ocorrencias = [];
          this.loaded = true;
        }
      } else {
        this.ocorrencias = [];
        this.loaded = true;
      }
      return;
    }

    const { ocorrencias, mudou } = atualizarExpiracoes(this.ocorrencias, agora);
    if (mudou) {
      this.ocorrencias = ocorrencias;
      await this._persistir();
    }
  }

  async _persistir() {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(
      {
        version: 1,
        savedAt: new Date().toISOString(),
        ocorrencias: this.ocorrencias,
      },
      null,
      2,
    );
    try {
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.filePath);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        // ignora falha ao limpar temporário
      }
      throw err;
    }
  }

  async listar({ incluirInativas = false, categoria = null, agora = Date.now() } = {}) {
    await this._carregarSeNecessario(agora);
    let lista = this.ocorrencias;
    if (!incluirInativas) {
      lista = lista.filter(
        (o) =>
          o.status !== STATUS_OCORRENCIA.RESOLVIDA &&
          o.status !== STATUS_OCORRENCIA.EXPIRADA,
      );
    }
    if (categoria) {
      lista = lista.filter((o) => o.categoria === categoria);
    }
    return lista
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.ultimaConfirmacaoEm || a.criadoEm || 0) || 0;
        const tb = Date.parse(b.ultimaConfirmacaoEm || b.criadoEm || 0) || 0;
        return tb - ta;
      });
  }

  async registrar(payload, { graph, usuarioId, agora = Date.now() } = {}) {
    return this._enqueue(async () => {
      await this._carregarSeNecessario(agora);
      const res = criarOcorrencia(payload, { graph, usuarioId, agora });
      if (!res.ok) return res;
      this.ocorrencias = [res.ocorrencia, ...this.ocorrencias];
      await this._persistir();
      return res;
    });
  }

  async interagir({ id, tipo, usuarioId, agora = Date.now() } = {}) {
    return this._enqueue(async () => {
      await this._carregarSeNecessario(agora);
      const idx = this.ocorrencias.findIndex((o) => o.id === id);
      if (idx < 0) {
        return {
          ok: false,
          reason: 'OCORRENCIA_NAO_ENCONTRADA',
          message: 'Ocorrência não encontrada.',
        };
      }
      const res = aplicarInteracao(this.ocorrencias[idx], { tipo, usuarioId, agora });
      if (!res.ok) return res;
      const copia = this.ocorrencias.slice();
      copia[idx] = res.ocorrencia;
      this.ocorrencias = copia;
      await this._persistir();
      return res;
    });
  }
}
