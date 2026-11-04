/**
 * core/enderecoDigital.js
 * ---------------------------------------------------------------------------
 * PORTA FIDEL da parte de "CEP Digital / Endereço Digital" da classe C#
 * `CalculoGeometriaDAL` (namespace `PortalSiga.OracleDAL.AreaRestrita`),
 * fornecida pela equipe do SIGA.
 *
 * POR QUE UM PORTA (e não a classe): o protótipo roda em Node.js (módulos ESM)
 * e no navegador; não há runtime C# nem Oracle disponível aqui. A lógica do
 * Plus Code da classe, porém, é **autocontida** — depende apenas de aritmética
 * e de duas constantes do município. Portá-la é, portanto, a forma de
 * **reutilizar** o algoritmo existente sem duplicá-lo e sem executar C# no
 * navegador.
 *
 * ⚠ FIDELIDADE: os nomes públicos e os valores foram mantidos **idênticos**
 * aos da classe C# (`CoordenadaNaRegiao`, `CodificarCompleto`, `CodificarCurto`,
 * `Completar`, `NormalizarCepDigitalParaBanco`, `NormalizarCoordenadaParaBanco`),
 * e a aritmética foi transcrita linha a linha — inclusive as peculiaridades:
 *
 *   • o código curto é o código completo **sem os 4 primeiros caracteres**
 *     (o '+' fica na posição 4, que é par — exigido pela validação);
 *   • a recuperação do prefixo usa o ponto de referência do município
 *     (−23,6635 / −46,5320);
 *   • códigos com menos de 10 dígitos são completados com '0' — que **não**
 *     pertence ao alfabeto OLC; na classe C# isso desloca o centro decodificado
 *     em uma resolução (o índice de '0' no alfabeto é −1). Esse
 *     comportamento foi **mantido** para não divergir do sistema corporativo.
 *
 * O que NÃO foi portado (e depende de Oracle, logo fica isolado atrás de
 * `core/enderecoDigitalService.js`): `ObterCepDigital`, `ObterEnderecoProximo`,
 * `ObterEnderecoProximoTexto`, `ObterEnderecoPorPonto`, `RetornaSetorFiscal`,
 * `CriarParametroCepDigital`.
 *
 * @see updates/05-endereco-digital-e-paradas/README.md
 */

/* ------------------------------------------------------------------ */
/* Constantes (idênticas à classe C#)                                 */
/* ------------------------------------------------------------------ */

/** Alfabeto do Open Location Code usado pelo CEP Digital. */
export const ALFABETO_CEP_DIGITAL = '23456789CFGHJMPQRVWX';

/** Ponto de referência do município (centro aproximado de Santo André). */
export const LATITUDE_REFERENCIA_CEP_DIGITAL = -23.6635;
export const LONGITUDE_REFERENCIA_CEP_DIGITAL = -46.5320;

/** Resoluções em graus, da mais grossa (20°) para a mais fina (0,000125°). */
export const RESOLUCAO_CEP_DIGITAL = [20, 1, 0.05, 0.0025, 0.000125];

/**
 * Recorte geográfico usado pelo CEP Digital / geocodificação reversa
 * (mantido do `BancoAlimentosDALAS`).
 */
export const REGIAO = { latMin: -24.1, latMax: -23.3, lonMin: -46.9, lonMax: -46.2 };

/* ------------------------------------------------------------------ */
/* Auxiliares privados (porta literal dos private do C#)              */
/* ------------------------------------------------------------------ */

/**
 * Converte um texto em número aceitando vírgula ou ponto decimal.
 * Devolve `null` quando o texto não é numérico (equivalente ao `false` do
 * `TryParseCoordenada` do C#, que usa `out`).
 */
function TryParseCoordenada(valor) {
  if (valor === null || valor === undefined) return null;
  const normalizado = String(valor).trim().replace(',', '.');
  if (normalizado === '') return null;
  if (normalizado.endsWith('.')) return null;
  // `double.TryParse(NumberStyles.Float)` não aceita hexadecimal, "Infinity"
  // nem "NaN" — o `Number()` do JavaScript aceitaria, então filtramos aqui.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(normalizado)) return null;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/** `SomenteCaracteresCepDigital` do C#. */
function SomenteCaracteresCepDigital(valor) {
  for (const c of String(valor)) {
    if (ALFABETO_CEP_DIGITAL.indexOf(c) < 0) return false;
  }
  return true;
}

/** `ValorCaracterCepDigital` do C# (−1 para caracteres fora do alfabeto). */
function ValorCaracterCepDigital(c) {
  return ALFABETO_CEP_DIGITAL.indexOf(String(c));
}

/** `DiferencaLongitude` do C# (diferença normalizada em −180..180). */
function DiferencaLongitude(longitude, referencia) {
  let diferenca = longitude - referencia;
  while (diferenca < -180) diferenca += 360;
  while (diferenca >= 180) diferenca -= 360;
  return diferenca;
}

/** `NormalizarLongitude` do C#. */
function NormalizarLongitude(longitude) {
  let lon = longitude;
  while (lon < -180) lon += 360;
  while (lon >= 180) lon -= 360;
  return lon;
}

/**
 * `NormalizarCoordenada` (privado no C#): prepara a coordenada para o
 * parâmetros Oracle (vírgula decimal, 8 casas). Mantido aqui porque o
 * adaptador corporativo do SIGA precisa dele.
 */
function NormalizarCoordenada(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = String(valor).trim();
  if (texto === '') return null;
  texto = texto.replace(/ /g, '');
  texto = texto.replace(/\./g, ',');
  const numero = Number(texto.replace(',', '.'));
  if (Number.isFinite(numero)) {
    return numero.toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  }
  return texto;
}

/* ------------------------------------------------------------------ */
/* Métodos públicos (mesmos nomes e contrato da classe C#)            */
/* ------------------------------------------------------------------ */

/**
 * `CoordenadaNaRegiao(string latitude, string longitude) : bool`
 *
 * Verifica se as coordenadas caem no recorte geográfico do CEP Digital.
 * Aceita vírgula ou ponto decimal, como na classe C#.
 */
export function CoordenadaNaRegiao(latitude, longitude) {
  const lat = TryParseCoordenada(latitude);
  const lon = TryParseCoordenada(longitude);
  if (lat === null || lon === null) return false;
  return (
    lat >= REGIAO.latMin &&
    lat <= REGIAO.latMax &&
    lon >= REGIAO.lonMin &&
    lon <= REGIAO.lonMax
  );
}

/**
 * `NormalizarCoordenadaParaBanco(string valor) : object`
 *
 * Normaliza ("23.5" → "23,5"); devolve `null` (equivalente a DBNull.Value)
 * quando o texto está vazio ou não é numérico.
 */
export function NormalizarCoordenadaParaBanco(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  const comPonto = texto.replace(',', '.');
  if (comPonto.endsWith('.')) return null;
  if (TryParseCoordenada(comPonto) === null) return null;
  return comPonto.replace('.', ',');
}

/**
 * `NormalizarCepDigitalParaBanco(string valor) : object`
 *
 * Padroniza o CEP Digital antes de gravá-lo: espaços removidos, maiúsculas.
 */
export function NormalizarCepDigitalParaBanco(valor) {
  if (valor === null || valor === undefined) return null;
  const normalizado = String(valor).trim().toUpperCase();
  return normalizado.length === 0 ? null : normalizado;
}

/**
 * `CodificarCompleto(string latitude, string longitude) : string`
 *
 * Codifica coordenadas no CEP Digital **completo** (11 caracteres, '+' na
 * posição 8). Devolve string vazia quando as coordenadas são inválidas ou
 * estão fora do recorte do município.
 */
export function CodificarCompleto(latitude, longitude) {
  const lat = TryParseCoordenada(latitude);
  const lon = TryParseCoordenada(longitude);
  if (lat === null || lon === null) return '';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return '';
  if (!CoordenadaNaRegiao(latitude, longitude)) return '';
  return codificarCompletoNumero(lat, lon);
}

/**
 * `CodificarCurto(string latitude, string longitude) : string`
 *
 * Codifica coordenadas no CEP Digital **curto** (formato local, sem os 4
 * primeiros caracteres do prefixo da região).
 */
export function CodificarCurto(latitude, longitude) {
  const lat = TryParseCoordenada(latitude);
  const lon = TryParseCoordenada(longitude);
  if (lat === null || lon === null) return '';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return '';
  if (!CoordenadaNaRegiao(latitude, longitude)) return '';

  const codigoCompleto = codificarCompletoNumero(lat, lon);
  if (!codigoCompleto) return '';
  return EncurtarCodigo(codigoCompleto, lat, lon);
}

/**
 * `Completar(string codigoCurtoOuCompleto) : string`
 *
 * Normaliza, expande e **valida** um CEP Digital digitado pelo usuário,
 * devolvendo o código **completo** (11 caracteres). Devolve string vazia
 * quando o código é malformado ou quando o ponto resultante está fora do
 * recorte do município.
 *
 * Regras (idênticas às da classe C#):
 *   • espaços removidos, maiúsculas;
 *   • o '+' tem de estar numa posição **par** entre 2 e 8;
 *   • só caracteres do alfabeto OLC;
 *   • código completo (>= 8 dígitos) → é decodificado e conferido;
 *   • código curto → o prefixo é recuperado a partir do ponto de referência
 *     do município e o centro é ajustado na direção da referência.
 */
export function Completar(codigoCurtoOuCompleto) {
  if (codigoCurtoOuCompleto === null || codigoCurtoOuCompleto === undefined) return '';
  const texto = String(codigoCurtoOuCompleto).trim();
  if (texto === '') return '';

  const codigo = texto.toUpperCase().replace(/ /g, '');
  const separador = codigo.indexOf('+');
  if (separador < 2 || separador % 2 !== 0 || separador > 8) return '';

  const digitos = codigo.replace(/\+/g, '');
  if (!SomenteCaracteresCepDigital(digitos)) return '';

  if (separador >= 8) {
    let d = digitos.length < 10 ? digitos.padEnd(10, '0') : digitos.slice(0, 10);
    const centro = DecodificarCentro(d);
    if (!CoordenadaNaRegiao(centro.latitude, centro.longitude)) return '';
    return d.slice(0, 8) + '+' + d.slice(8);
  }

  const prefixoAusente = 8 - separador;
  const latRef = LATITUDE_REFERENCIA_CEP_DIGITAL;
  const lonRef = LONGITUDE_REFERENCIA_CEP_DIGITAL;
  const prefixo = codificarCompletoNumero(latRef, lonRef).replace(/\+/g, '').slice(0, prefixoAusente);
  let candidato = prefixo + digitos;
  if (candidato.length < 10) candidato = candidato.padEnd(10, '0');
  if (candidato.length > 10) candidato = candidato.slice(0, 10);

  let centro = DecodificarCentro(candidato);
  const indiceResolucao = Math.max(
    0,
    Math.min(RESOLUCAO_CEP_DIGITAL.length - 1, Math.floor(prefixoAusente / 2) - 1),
  );
  const resolucao = RESOLUCAO_CEP_DIGITAL[indiceResolucao];
  const meiaResolucao = resolucao / 2;

  if (latRef - centro.latitude > meiaResolucao) centro.latitude += resolucao;
  else if (centro.latitude - latRef > meiaResolucao) centro.latitude -= resolucao;

  const deltaLon = DiferencaLongitude(lonRef, centro.longitude);
  if (deltaLon > meiaResolucao) centro.longitude = NormalizarLongitude(centro.longitude + resolucao);
  else if (deltaLon < -meiaResolucao) centro.longitude = NormalizarLongitude(centro.longitude - resolucao);

  centro.latitude = Math.max(-90, Math.min(90, centro.latitude));
  if (!CoordenadaNaRegiao(centro.latitude, centro.longitude)) return '';
  return codificarCompletoNumero(centro.latitude, centro.longitude);
}

/**
 * `DecodificarCentro(string digitos) : {latitude, longitude}`
 *
 * Decodifica os 10 dígitos do CEP Digital e devolve o **centro** da célula.
 * É `private` na classe C#; aqui é público porque é exatamente a etapa
 * "código → coordenadas" que a aplicação precisa expor.
 */
export function DecodificarCentro(digitos) {
  let latSul = -90;
  let lonOeste = -180;
  for (let i = 0; i < 10; i += 2) {
    const resolucao = RESOLUCAO_CEP_DIGITAL[i / 2];
    latSul += ValorCaracterCepDigital(digitos[i]) * resolucao;
    lonOeste += ValorCaracterCepDigital(digitos[i + 1]) * resolucao;
  }
  return {
    latitude: latSul + RESOLUCAO_CEP_DIGITAL[4] / 2,
    longitude: lonOeste + RESOLUCAO_CEP_DIGITAL[4] / 2,
  };
}

/* ------------------------------------------------------------------ */
/* Etapas internas expostas para a aplicação                          */
/* ------------------------------------------------------------------ */

/** `CodificarCompleto(double, double)` privado na classe C#. */
function codificarCompletoNumero(latitude, longitude) {
  // OLC define a borda norte/leste como inclusiva usando o menor valor interno.
  let lat = latitude;
  let lon = longitude;
  if (lat === 90) lat -= 1e-12;
  if (lon === 180) lon -= 1e-12;
  lat += 90;
  lon += 180;
  let codigo = '';
  for (let i = 0; i < RESOLUCAO_CEP_DIGITAL.length; i++) {
    const resolucao = RESOLUCAO_CEP_DIGITAL[i];
    const latDigit = Math.max(0, Math.min(19, Math.floor(lat / resolucao)));
    const lonDigit = Math.max(0, Math.min(19, Math.floor(lon / resolucao)));
    lat -= latDigit * resolucao;
    lon -= lonDigit * resolucao;
    codigo += ALFABETO_CEP_DIGITAL[latDigit] + ALFABETO_CEP_DIGITAL[lonDigit];
  }
  return codigo.slice(0, 8) + '+' + codigo.slice(8);
}

/** `EncurtarCodigo` privado na classe C#. */
function EncurtarCodigo(codigoCompleto, latitude, longitude) {
  const refLat = LATITUDE_REFERENCIA_CEP_DIGITAL;
  const refLon = LONGITUDE_REFERENCIA_CEP_DIGITAL;
  const distancia =
    Math.abs(latitude - refLat) + Math.abs(DiferencaLongitude(longitude, refLon));
  // Usa o formato curto local (remove o prefixo de 4 caracteres) apenas
  // quando ele pode ser recuperado sem ambiguidade perto de Santo André.
  return distancia < RESOLUCAO_CEP_DIGITAL[1] * 0.3
    ? codigoCompleto.slice(4)
    : codigoCompleto;
}

/**
 * Normaliza o texto digitado pelo usuário (trim, maiúsculas, sem espaços).
 * É a "normalização" pura: **não** valida e **não** converte.
 */
export function NormalizarCepDigital(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().toUpperCase().replace(/ /g, '');
}

/**
 * Verifica apenas a **forma** do código (sem consultar a região), usando as
 * mesmas regras estruturais da classe C# dentro de `Completar`.
 * Serve para distinguir "malformado" de "válido, porém fora da área".
 */
export function ValidarSintaxeCepDigital(valor) {
  const codigo = NormalizarCepDigital(valor);
  if (codigo === '') return { ok: false, motivo: 'VAZIO', codigo: '' };

  const separador = codigo.indexOf('+');
  if (separador < 2 || separador % 2 !== 0 || separador > 8) {
    return { ok: false, motivo: 'MALFORMADO', codigo };
  }
  const digitos = codigo.replace(/\+/g, '');
  if (!SomenteCaracteresCepDigital(digitos)) {
    return { ok: false, motivo: 'MALFORMADO', codigo };
  }
  return { ok: true, motivo: 'SINTAXE_OK', codigo, separador, digitos };
}

/**
 * Converte um CEP Digital **completo** em coordenadas (centro da célula).
 * Aceita o código com ou sem o '+'.
 */
export function DecodificarCepDigital(codigoCompleto) {
  if (!codigoCompleto) return null;
  let digitos = String(codigoCompleto).replace(/\+/g, '');
  if (digitos.length < 10) digitos = digitos.padEnd(10, '0');
  if (digitos.length > 10) digitos = digitos.slice(0, 10);
  const centro = DecodificarCentro(digitos);
  return { latitude: centro.latitude, longitude: centro.longitude };
}

/**
 * Operação de alto nível usada pela aplicação: normaliza → valida → expande →
 * converte. Devolve sempre um objeto com `status`, para que a interface possa
 * distinguir os estados pedidos:
 *
 *   VAZIO          — nada foi digitado;
 *   MALFORMADO     — a forma do código não é válida;
 *   FORA_DA_AREA   — código válido, mas o ponto está fora do recorte;
 *   CONVERTIDO     — código válido e coordenadas obtidas.
 */
export function ResolverEnderecoDigital(valor) {
  const sintaxe = ValidarSintaxeCepDigital(valor);
  if (!sintaxe.ok) {
    return {
      status: sintaxe.motivo === 'VAZIO' ? 'VAZIO' : 'MALFORMADO',
      ok: false,
      codigoNormalizado: sintaxe.codigo,
      codigoCompleto: null,
      latitude: null,
      longitude: null,
      naRegiao: null,
      mensagem:
        sintaxe.motivo === 'VAZIO'
          ? 'Informe o Endereço Digital (CEP Digital).'
          : 'Endereço Digital malformado. O formato é o do CEP Digital (ex.: 58889FP9+J6 ou 9FP9+J6).',
    };
  }

  const completo = Completar(sintaxe.codigo);
  if (!completo) {
    return {
      status: 'FORA_DA_AREA',
      ok: false,
      codigoNormalizado: sintaxe.codigo,
      codigoCompleto: null,
      latitude: null,
      longitude: null,
      naRegiao: false,
      mensagem:
        'Endereço Digital válido, mas o ponto fica fora do recorte do município ' +
        `(lat ${REGIAO.latMin}…${REGIAO.latMax}, lon ${REGIAO.lonMin}…${REGIAO.lonMax}).`,
    };
  }

  const ponto = DecodificarCepDigital(completo);
  const naRegiao = CoordenadaNaRegiao(ponto.latitude, ponto.longitude);
  return {
    status: 'CONVERTIDO',
    ok: true,
    codigoNormalizado: sintaxe.codigo,
    codigoCompleto: completo,
    latitude: ponto.latitude,
    longitude: ponto.longitude,
    naRegiao,
    mensagem: naRegiao
      ? 'Endereço Digital convertido em coordenadas.'
      : 'Endereço Digital convertido, porém fora do recorte do município.',
  };
}
