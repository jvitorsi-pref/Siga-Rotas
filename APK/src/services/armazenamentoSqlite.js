import * as SQLite from 'expo-sqlite';
import { criarDriverSqliteCore, NOME_BANCO_SQLITE } from './armazenamentoSqliteCore.js';

export { NOME_BANCO_SQLITE };

export function criarDriverSqlite(options = {}) {
  return criarDriverSqliteCore({
    sqlite: options.sqlite ?? SQLite,
    nomeBanco: options.nomeBanco ?? NOME_BANCO_SQLITE,
  });
}
