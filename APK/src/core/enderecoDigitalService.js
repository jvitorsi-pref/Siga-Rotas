/**
 * core/enderecoDigitalService.js
 * ---------------------------------------------------------------------------
 * INTERFACE DE SERVIÇO para o Endereço Digital (CEP Digital).
 *
 * Por que existe: a classe C# `CalculoGeometriaDAL` tem duas naturezas:
 *
 *   1. a parte de **CEP Digital (Plus Code)** — autocontida, sem Oracle;
 *      é ela que o protótipo usa (porta fiel em `core/enderecoDigital.js`);
 *   2. a parte de **geocodificação reversa / endereço oficial mais próximo**
 *      (`ObterEnderecoProximo`, `ObterEnderecoProximoTexto`,
 *      `ObterEnderecoPorPonto`, `RetornaSetorFiscal`, `ObterCepDigital`) —
 *      depende de Oracle (`GEOSIGA.PKG_GEOCODIFICACAO_REVERSA.*`) e do
 *      banco corporativo do SIGA.
 *
 * A parte 2 **não pode** rodar no navegador e **não** deve vazar credenciais
 * para o front-end. Por isso ela fica atrás desta interface, com duas
 * implementações:
 *
 *   • `local` — a porta fiel da parte 1 (modo do protótipo, sem Oracle);
 *   • `siga`  — adaptador para o serviço corporativo. No protótipo **não há
 *     conexão Oracle, nem credenciais, nem rede para o banco do SIGA** — o
 *     adaptador, portanto, responde `INDISPONIVEL` com a explicação do que
 *     falta. Ele **nunca inventa** coordenadas nem endereços.
 *
 * Contrato do serviço (independente da implementação):
 *
 *   validar(codigo)  → { status, ok, codigoNormalizado, codigoCompleto, mensagem }
 *   resolver(codigo) → { status, ok, codigoNormalizado, codigoCompleto,
 *                        latitude, longitude, naRegiao, mensagem }
 *
 * Status possíveis: VAZIO | MALFORMADO | VALIDADO | FORA_DA_AREA | CONVERTIDO |
 * INDISPONIVEL | FALHA.
 *
 * @see core/enderecoDigital.js  (porta fiel da classe C#)
 */

import * as servicoLocalDependencias from './enderecoDigital.js';

/** Modos de implementação do serviço. */
export const MODOS = { LOCAL: 'local', SIGA: 'siga' };

/**
 * Serviço local: usa a porta fiel da lógica de CEP Digital.
 * Não conhece Oracle, nem rede, nem credenciais.
 */
function criarServicoLocal() {
  const {
    NormalizarCepDigital,
    ValidarSintaxeCepDigital,
    Completar,
    DecodificarCepDigital,
    CoordenadaNaRegiao,
  } = servicoLocalDependencias;

  return {
    id: MODOS.LOCAL,
    descricao:
      'Implementação local: porta fiel da lógica de CEP Digital de ' +
      'CalculoGeometriaDAL (sem Oracle, sem rede externa).',
    disponivel: true,

    /** Normaliza e valida a FORMA do código (sem converter em coordenadas). */
    validar(codigo) {
      const sintaxe = ValidarSintaxeCepDigital(codigo);
      if (!sintaxe.ok) {
        return {
          status: sintaxe.motivo === 'VAZIO' ? 'VAZIO' : 'MALFORMADO',
          ok: false,
          codigoNormalizado: sintaxe.codigo,
          codigoCompleto: null,
          mensagem:
            sintaxe.motivo === 'VAZIO'
              ? 'Informe o Endereço Digital (CEP Digital).'
              : 'Endereço Digital malformado. Use o formato do CEP Digital ' +
                '(ex.: 588M8FP9+J6 ou 8FP9+J6).',
        };
      }
      const completo = Completar(sintaxe.codigo);
      if (!completo) {
        return {
          status: 'FORA_DA_AREA',
          ok: false,
          codigoNormalizado: sintaxe.codigo,
          codigoCompleto: null,
          mensagem:
            'Endereço Digital válido, mas o ponto fica fora do recorte do município.',
        };
      }
      return {
        status: 'VALIDADO',
        ok: true,
        codigoNormalizado: sintaxe.codigo,
        codigoCompleto: completo,
        mensagem: 'Endereço Digital válido (ainda não convertido em coordenadas).',
      };
    },

    /** Normaliza, valida e converte o código em coordenadas. */
    resolver(codigo) {
      const sintaxe = ValidarSintaxeCepDigital(codigo);
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
              : 'Endereço Digital malformado. Use o formato do CEP Digital ' +
                '(ex.: 588M8FP9+J6 ou 8FP9+J6).',
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
            'Endereço Digital válido, mas o ponto fica fora do recorte do município.',
        };
      }
      const ponto = DecodificarCepDigital(completo);
      return {
        status: 'CONVERTIDO',
        ok: true,
        codigoNormalizado: sintaxe.codigo,
        codigoCompleto: completo,
        latitude: ponto.latitude,
        longitude: ponto.longitude,
        naRegiao: CoordenadaNaRegiao(ponto.latitude, ponto.longitude),
        mensagem: 'Endereço Digital convertido em coordenadas.',
      };
    },
  };
}

/**
 * Adaptador do SIGA corporativo.
 *
 * O protótipo **não** tem: servidor Oracle do SIGA, credenciais, nem rede
 * até o banco corporativo. Sem um `conector` injetado, o adaptador responde
 * `INDISPONIVEL` — nunca Coordinates inventadas.
 *
 * Para a integração futura basta injetar um `conector` com a mesma forma do
 * Oracle usado pela classe C#:
 *
 *   conector({
 *     latitude, longitude,           // já normalizados ("-23,663500")
 *   }) → { latitude, longitude, enderecoFormatado?, nomeLogradouro?, ... }
 *
 * O conector roda **no servidor**; o navegador nunca recebe credenciais.
 */
function criarAdaptadorSiga(opcoes = {}) {
  const conector = opcoes.conector || null;
  return {
    id: MODOS.SIGA,
    descricao:
      'Adaptador para o serviço corporativo do SIGA ' +
      '(GEOSIGA.PKG_GEOCODIFICACAO_REVERSA).',
    disponivel: Boolean(conector),

    async validar(codigo) {
      if (!conector) return this.resolver(codigo);
      return this.resolver(codigo);
    },

    async resolver(codigo) {
      if (!conector) {
        return {
          status: 'INDISPONIVEL',
          ok: false,
          codigoNormalizado: String(codigo || '').trim().toUpperCase(),
          codigoCompleto: null,
          latitude: null,
          longitude: null,
          naRegiao: null,
          mensagem:
            'O serviço corporativo do SIGA não está disponível neste ambiente ' +
            '(sem conexão Oracle e sem credenciais). Use a implementação local ' +
            'do CEP Digital ou configure o conector do adaptador.',
        };
      }
      try {
        const resultado = await conector({ codigo });
        return {
          status: 'CONVERTIDO',
          ok: true,
          codigoNormalizado: String(codigo || '').trim().toUpperCase(),
          codigoCompleto: resultado?.codigoCompleto ?? null,
          latitude: resultado?.latitude ?? null,
          longitude: resultado?.longitude ?? null,
          naRegiao: resultado?.naRegiao ?? null,
          endereco: resultado?.endereco ?? null,
          mensagem: 'Endereço resolvido pelo serviço corporativo do SIGA.',
        };
      } catch (erro) {
        return {
          status: 'FALHA',
          ok: false,
          codigoNormalizado: String(codigo || '').trim().toUpperCase(),
          codigoCompleto: null,
          latitude: null,
          longitude: null,
          naRegiao: null,
          mensagem: `Falha na resolução pelo serviço do SIGA: ${erro.message}`,
        };
      }
    },
  };
}

/**
 * Cria o serviço de Endereço Digital.
 * @param {{modo?: string, conector?: Function}} [opcoes]
 */
export function criarServicoEnderecoDigital(opcoes = {}) {
  const modo = opcoes.modo || MODOS.LOCAL;
  if (modo === MODOS.SIGA) return criarAdaptadorSiga(opcoes);
  return criarServicoLocal();
}
