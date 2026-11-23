import { criarDriverSqlite } from './armazenamentoSqlite.js';
import { criarServicoCampoMobileCore } from './campoMobileServiceCore.js';

export function criarServicoCampoMobile(options = {}) {
  const driver = options.driver ?? criarDriverSqlite();
  return criarServicoCampoMobileCore({
    ...options,
    driver,
  });
}
