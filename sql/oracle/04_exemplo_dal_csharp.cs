// ============================================================================
// EXEMPLO DE IMPLEMENTAÇÃO DA CLASSE DAL (PortalSiga.OracleDAL.AreaRestrita)
// ----------------------------------------------------------------------------
// Conforme combinado, a implementação definitiva da DAL e das procedures Oracle
// fica no seu projeto WebForms corporativo. Este arquivo mostra exatamente
// como implementar a interface `SigaRotas.ISigaRotasCampoDal` (definida em
// `webforms/SigaRotasCampo.ashx`) chamando `PKG_SIGA_ROTAS` no Oracle 11g.
//
// ONDE CHAMAR A SUA DAL:
//   Em `webforms/SigaRotasCampo.ashx`, localize o método:
//       private static ISigaRotasCampoDal CriarDal()
//   e troque o retorno de placeholder por:
//       return new PortalSiga.OracleDAL.AreaRestrita.SigaRotasCampoDal();
// ============================================================================

using System;
using System.Collections.Generic;
using System.Data;
using Oracle.ManagedDataAccess.Client; // ou Oracle.DataAccess.Client conforme o portal
using SigaRotas;

namespace PortalSiga.OracleDAL.AreaRestrita
{
    public class SigaRotasCampoDal : ISigaRotasCampoDal
    {
        private readonly string _connectionString;

        public SigaRotasCampoDal(string connectionString)
        {
            _connectionString = connectionString;
        }

        public ResultadoPersistenciaDto SalvarRota(RotaSincronizacaoDto rota, string idUsuarioAutenticado)
        {
            using (var conn = new OracleConnection(_connectionString))
            using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_SALVAR_ROTA", conn))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.BindByName = true;

                cmd.Parameters.Add("P_ID_CLIENTE", OracleDbType.Varchar2, 36).Value = rota.idCliente;
                cmd.Parameters.Add("P_TIPO_ROTA", OracleDbType.Varchar2, 20).Value = rota.tipoRota;
                cmd.Parameters.Add("P_ID_ROTA_ORIGEM", OracleDbType.Decimal).Value =
                    rota.idRotaOrigemServidor.HasValue ? (object)rota.idRotaOrigemServidor.Value : DBNull.Value;
                cmd.Parameters.Add("P_ID_ROTA_ORIGEM_CLIENTE", OracleDbType.Varchar2, 36).Value =
                    (object)rota.idRotaOrigemCliente ?? DBNull.Value;
                cmd.Parameters.Add("P_WKT_GEOMETRIA", OracleDbType.Clob).Value = rota.wktGeometria;
                cmd.Parameters.Add("P_DISTANCIA_METROS", OracleDbType.Decimal).Value = rota.distanciaMetros;
                cmd.Parameters.Add("P_DURACAO_SEGUNDOS", OracleDbType.Decimal).Value = rota.duracaoSegundos;
                cmd.Parameters.Add("P_TITULO", OracleDbType.Varchar2, 160).Value = (object)rota.titulo ?? DBNull.Value;
                cmd.Parameters.Add("P_MODO_CALCULO", OracleDbType.Varchar2, 30).Value = (object)rota.modoCalculo ?? DBNull.Value;
                cmd.Parameters.Add("P_CIRCULAR", OracleDbType.Int32).Value = rota.circular ? 1 : 0;
                cmd.Parameters.Add("P_PONTOS_JSON", OracleDbType.Clob).Value = (object)rota.pontosJson ?? DBNull.Value;
                cmd.Parameters.Add("P_LEGS_JSON", OracleDbType.Clob).Value = (object)rota.legsJson ?? DBNull.Value;
                cmd.Parameters.Add("P_DATA_CRIACAO", OracleDbType.TimeStampTZ).Value =
                    ParseData(rota.dataCriacao) ?? DateTimeOffset.UtcNow;
                cmd.Parameters.Add("P_DATA_INICIO", OracleDbType.TimeStampTZ).Value =
                    (object)ParseData(rota.dataInicio) ?? DBNull.Value;
                cmd.Parameters.Add("P_DATA_FIM", OracleDbType.TimeStampTZ).Value =
                    (object)ParseData(rota.dataFim) ?? DBNull.Value;
                cmd.Parameters.Add("P_STATUS", OracleDbType.Varchar2, 25).Value = rota.status;
                cmd.Parameters.Add("P_VERSAO", OracleDbType.Int32).Value = rota.versao;
                cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;

                var pOutId = cmd.Parameters.Add("O_ID_ROTA", OracleDbType.Decimal, ParameterDirection.Output);
                var pOutRes = cmd.Parameters.Add("O_RESULTADO", OracleDbType.Varchar2, 40, null, ParameterDirection.Output);
                var pOutVer = cmd.Parameters.Add("O_VERSAO_SERVIDOR", OracleDbType.Int32, ParameterDirection.Output);
                var pOutMsg = cmd.Parameters.Add("O_MENSAGEM", OracleDbType.Varchar2, 500, null, ParameterDirection.Output);

                conn.Open();
                cmd.ExecuteNonQuery();

                return new ResultadoPersistenciaDto
                {
                    idCliente = rota.idCliente,
                    idServidor = LerLongNullable(pOutId.Value),
                    resultado = Convert.ToString(pOutRes.Value),
                    versaoServidor = LerInt(pOutVer.Value, rota.versao),
                    mensagem = Convert.ToString(pOutMsg.Value)
                };
            }
        }

        public ResultadoPersistenciaDto SalvarObservacao(ObservacaoSincronizacaoDto obs, string idUsuarioAutenticado)
        {
            // Se já tem versão > 1 ou operação explícita de atualização, chama PR_ATUALIZAR_OBSERVACAO;
            // caso contrário, PR_SALVAR_OBSERVACAO (idempotente por P_ID_CLIENTE).
            using (var conn = new OracleConnection(_connectionString))
            {
                conn.Open();
                if (string.Equals(obs.operacao, "ATUALIZAR", StringComparison.OrdinalIgnoreCase) || obs.versao > 1)
                {
                    using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_ATUALIZAR_OBSERVACAO", conn))
                    {
                        cmd.CommandType = CommandType.StoredProcedure;
                        cmd.BindByName = true;
                        cmd.Parameters.Add("P_ID_CLIENTE", OracleDbType.Varchar2, 36).Value = obs.idCliente;
                        cmd.Parameters.Add("P_DESCRICAO", OracleDbType.Varchar2, 1000).Value = obs.descricao;
                        cmd.Parameters.Add("P_TIPO_OBSERVACAO", OracleDbType.Varchar2, 40).Value = obs.tipoObservacao;
                        cmd.Parameters.Add("P_STATUS", OracleDbType.Varchar2, 20).Value = obs.status;
                        cmd.Parameters.Add("P_VERSAO_ESPERADA", OracleDbType.Int32).Value = Math.Max(1, obs.versao - 1);
                        cmd.Parameters.Add("P_DATA_ATUALIZACAO", OracleDbType.TimeStampTZ).Value =
                            ParseData(obs.dataAtualizacao) ?? DateTimeOffset.UtcNow;
                        cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;

                        var pOutId = cmd.Parameters.Add("O_ID_OBSERVACAO", OracleDbType.Decimal, ParameterDirection.Output);
                        var pOutRes = cmd.Parameters.Add("O_RESULTADO", OracleDbType.Varchar2, 40, null, ParameterDirection.Output);
                        var pOutVer = cmd.Parameters.Add("O_VERSAO_SERVIDOR", OracleDbType.Int32, ParameterDirection.Output);
                        var pOutDt = cmd.Parameters.Add("O_DATA_ATUALIZACAO_SERVIDOR", OracleDbType.TimeStampTZ, ParameterDirection.Output);
                        var pOutMsg = cmd.Parameters.Add("O_MENSAGEM", OracleDbType.Varchar2, 500, null, ParameterDirection.Output);

                        cmd.ExecuteNonQuery();

                        return new ResultadoPersistenciaDto
                        {
                            idCliente = obs.idCliente,
                            idServidor = LerLongNullable(pOutId.Value),
                            resultado = Convert.ToString(pOutRes.Value),
                            versaoServidor = LerInt(pOutVer.Value, obs.versao),
                            dataAtualizacaoServidor = pOutDt.Value == DBNull.Value ? null : Convert.ToString(pOutDt.Value),
                            mensagem = Convert.ToString(pOutMsg.Value)
                        };
                    }
                }

                using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_SALVAR_OBSERVACAO", conn))
                {
                    cmd.CommandType = CommandType.StoredProcedure;
                    cmd.BindByName = true;
                    cmd.Parameters.Add("P_ID_CLIENTE", OracleDbType.Varchar2, 36).Value = obs.idCliente;
                    cmd.Parameters.Add("P_ID_ROTA", OracleDbType.Decimal).Value =
                        obs.idRotaServidor.HasValue ? (object)obs.idRotaServidor.Value : DBNull.Value;
                    cmd.Parameters.Add("P_ID_ROTA_CLIENTE", OracleDbType.Varchar2, 36).Value =
                        (object)obs.idRotaCliente ?? DBNull.Value;
                    cmd.Parameters.Add("P_LONGITUDE", OracleDbType.Decimal).Value = obs.longitude;
                    cmd.Parameters.Add("P_LATITUDE", OracleDbType.Decimal).Value = obs.latitude;
                    cmd.Parameters.Add("P_DESCRICAO", OracleDbType.Varchar2, 1000).Value = obs.descricao;
                    cmd.Parameters.Add("P_TIPO_OBSERVACAO", OracleDbType.Varchar2, 40).Value = obs.tipoObservacao;
                    cmd.Parameters.Add("P_DATA_CRIACAO", OracleDbType.TimeStampTZ).Value =
                        ParseData(obs.dataCriacao) ?? DateTimeOffset.UtcNow;
                    cmd.Parameters.Add("P_STATUS", OracleDbType.Varchar2, 20).Value = obs.status;
                    cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;

                    var pOutId = cmd.Parameters.Add("O_ID_OBSERVACAO", OracleDbType.Decimal, ParameterDirection.Output);
                    var pOutRota = cmd.Parameters.Add("O_ID_ROTA", OracleDbType.Decimal, ParameterDirection.Output);
                    var pOutRes = cmd.Parameters.Add("O_RESULTADO", OracleDbType.Varchar2, 40, null, ParameterDirection.Output);
                    var pOutVer = cmd.Parameters.Add("O_VERSAO_SERVIDOR", OracleDbType.Int32, ParameterDirection.Output);
                    var pOutMsg = cmd.Parameters.Add("O_MENSAGEM", OracleDbType.Varchar2, 500, null, ParameterDirection.Output);

                    cmd.ExecuteNonQuery();

                    return new ResultadoPersistenciaDto
                    {
                        idCliente = obs.idCliente,
                        idServidor = LerLongNullable(pOutId.Value),
                        idPaiServidor = LerLongNullable(pOutRota.Value),
                        resultado = Convert.ToString(pOutRes.Value),
                        versaoServidor = LerInt(pOutVer.Value, 1),
                        mensagem = Convert.ToString(pOutMsg.Value)
                    };
                }
            }
        }

        public ResultadoPersistenciaDto RegistrarEvento(EventoObservacaoDto evt, string idUsuarioAutenticado)
        {
            using (var conn = new OracleConnection(_connectionString))
            using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_REGISTRAR_EVENTO", conn))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.BindByName = true;
                cmd.Parameters.Add("P_ID_CLIENTE", OracleDbType.Varchar2, 36).Value = evt.idCliente;
                cmd.Parameters.Add("P_ID_OBSERVACAO", OracleDbType.Decimal).Value =
                    evt.idObservacaoServidor.HasValue ? (object)evt.idObservacaoServidor.Value : DBNull.Value;
                cmd.Parameters.Add("P_ID_OBSERVACAO_CLIENTE", OracleDbType.Varchar2, 36).Value =
                    (object)evt.idObservacaoCliente ?? DBNull.Value;
                cmd.Parameters.Add("P_TIPO_EVENTO", OracleDbType.Varchar2, 30).Value = evt.tipoEvento;
                cmd.Parameters.Add("P_DADOS_EVENTO", OracleDbType.Clob).Value = (object)evt.dadosEventoJson ?? DBNull.Value;
                cmd.Parameters.Add("P_DATA_EVENTO", OracleDbType.TimeStampTZ).Value =
                    ParseData(evt.dataEvento) ?? DateTimeOffset.UtcNow;
                cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;

                var pOutId = cmd.Parameters.Add("O_ID_EVENTO", OracleDbType.Decimal, ParameterDirection.Output);
                var pOutRes = cmd.Parameters.Add("O_RESULTADO", OracleDbType.Varchar2, 40, null, ParameterDirection.Output);
                var pOutMsg = cmd.Parameters.Add("O_MENSAGEM", OracleDbType.Varchar2, 500, null, ParameterDirection.Output);

                conn.Open();
                cmd.ExecuteNonQuery();

                return new ResultadoPersistenciaDto
                {
                    idCliente = evt.idCliente,
                    idServidor = LerLongNullable(pOutId.Value),
                    resultado = Convert.ToString(pOutRes.Value),
                    mensagem = Convert.ToString(pOutMsg.Value)
                };
            }
        }

        public List<RotaConsultaDto> ListarRotas(string idUsuarioAutenticado, string tipoRota, int limite)
        {
            var lista = new List<RotaConsultaDto>();
            using (var conn = new OracleConnection(_connectionString))
            using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_LISTAR_ROTAS", conn))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.BindByName = true;
                cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;
                cmd.Parameters.Add("P_TIPO_ROTA", OracleDbType.Varchar2, 20).Value = (object)tipoRota ?? DBNull.Value;
                cmd.Parameters.Add("P_LIMITE", OracleDbType.Int32).Value = limite;
                cmd.Parameters.Add("O_CURSOR", OracleDbType.RefCursor, ParameterDirection.Output);

                conn.Open();
                using (var dr = cmd.ExecuteReader())
                {
                    while (dr.Read())
                    {
                        lista.Add(new RotaConsultaDto
                        {
                            idServidor = Convert.ToInt64(dr["ID_ROTA"]),
                            idCliente = Convert.ToString(dr["ID_CLIENTE"]),
                            idRotaOrigemServidor = dr["ID_ROTA_ORIGEM"] == DBNull.Value ? (long?)null : Convert.ToInt64(dr["ID_ROTA_ORIGEM"]),
                            idRotaOrigemCliente = dr["ID_ROTA_ORIGEM_CLIENTE"] == DBNull.Value ? null : Convert.ToString(dr["ID_ROTA_ORIGEM_CLIENTE"]),
                            tipoRota = Convert.ToString(dr["TIPO_ROTA"]),
                            wktGeometria = Convert.ToString(dr["WKT_GEOMETRIA"]),
                            distanciaMetros = Convert.ToDouble(dr["DISTANCIA_METROS"]),
                            duracaoSegundos = Convert.ToInt32(dr["DURACAO_SEGUNDOS"]),
                            titulo = dr["TITULO"] == DBNull.Value ? null : Convert.ToString(dr["TITULO"]),
                            modoCalculo = dr["MODO_CALCULO"] == DBNull.Value ? null : Convert.ToString(dr["MODO_CALCULO"]),
                            circular = Convert.ToInt32(dr["CIRCULAR"]) == 1,
                            pontosJson = dr["PONTOS_JSON"] == DBNull.Value ? null : Convert.ToString(dr["PONTOS_JSON"]),
                            dataCriacao = FormatDate(dr["DATA_CRIACAO"]),
                            dataInicio = FormatDate(dr["DATA_INICIO"]),
                            dataFim = FormatDate(dr["DATA_FIM"]),
                            dataAtualizacao = FormatDate(dr["DATA_ATUALIZACAO"]),
                            versao = Convert.ToInt32(dr["VERSAO"]),
                            status = Convert.ToString(dr["STATUS"]),
                            idUsuario = Convert.ToString(dr["ID_USUARIO"])
                        });
                    }
                }
            }
            return lista;
        }

        public List<ObservacaoConsultaDto> ListarObservacoes(string idUsuarioAutenticado, long? idRotaServidor, string idRotaCliente)
        {
            var lista = new List<ObservacaoConsultaDto>();
            using (var conn = new OracleConnection(_connectionString))
            using (var cmd = new OracleCommand("PKG_SIGA_ROTAS.PR_LISTAR_OBSERVACOES", conn))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.BindByName = true;
                cmd.Parameters.Add("P_ID_USUARIO", OracleDbType.Varchar2, 80).Value = idUsuarioAutenticado;
                cmd.Parameters.Add("P_ID_ROTA", OracleDbType.Decimal).Value =
                    idRotaServidor.HasValue ? (object)idRotaServidor.Value : DBNull.Value;
                cmd.Parameters.Add("P_ID_ROTA_CLIENTE", OracleDbType.Varchar2, 36).Value = (object)idRotaCliente ?? DBNull.Value;
                cmd.Parameters.Add("O_CURSOR", OracleDbType.RefCursor, ParameterDirection.Output);

                conn.Open();
                using (var dr = cmd.ExecuteReader())
                {
                    while (dr.Read())
                    {
                        lista.Add(new ObservacaoConsultaDto
                        {
                            idServidor = Convert.ToInt64(dr["ID_OBSERVACAO"]),
                            idCliente = Convert.ToString(dr["ID_CLIENTE"]),
                            idRotaServidor = Convert.ToInt64(dr["ID_ROTA"]),
                            idRotaCliente = Convert.ToString(dr["ID_ROTA_CLIENTE"]),
                            longitude = Convert.ToDouble(dr["LONGITUDE"]),
                            latitude = Convert.ToDouble(dr["LATITUDE"]),
                            descricao = Convert.ToString(dr["DESCRICAO"]),
                            tipoObservacao = Convert.ToString(dr["TIPO_OBSERVACAO"]),
                            dataCriacao = FormatDate(dr["DATA_CRIACAO"]),
                            dataAtualizacao = FormatDate(dr["DATA_ATUALIZACAO"]),
                            versao = Convert.ToInt32(dr["VERSAO"]),
                            idUsuario = Convert.ToString(dr["ID_USUARIO"]),
                            status = Convert.ToString(dr["STATUS"])
                        });
                    }
                }
            }
            return lista;
        }

        private static DateTimeOffset? ParseData(string iso)
        {
            DateTimeOffset dt;
            return DateTimeOffset.TryParse(iso, out dt) ? dt : (DateTimeOffset?)null;
        }

        private static string FormatDate(object val)
        {
            if (val == null || val == DBNull.Value) return null;
            if (val is DateTimeOffset dto) return dto.ToUniversalTime().ToString("o");
            if (val is DateTime dt) return dt.ToUniversalTime().ToString("o");
            return Convert.ToString(val);
        }

        private static long? LerLongNullable(object val)
        {
            if (val == null || val == DBNull.Value) return null;
            return Convert.ToInt64(val);
        }

        private static int LerInt(object val, int fallback)
        {
            if (val == null || val == DBNull.Value) return fallback;
            return Convert.ToInt32(val);
        }
    }
}
