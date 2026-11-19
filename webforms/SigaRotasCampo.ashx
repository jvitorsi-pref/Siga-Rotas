<%@ WebHandler Language="C#" Class="SigaRotas.SigaRotasCampo" %>
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Configuration;
using System.Web.Script.Serialization;
using System.Web.SessionState;

namespace SigaRotas
{
    // =========================================================================
    // DTOs E CONTRATO DA CLASSE DAL (compartilhados entre Web e APK)
    // -------------------------------------------------------------------------
    // Este handler WebForms (.ashx) centraliza:
    //   • Recebimento das requisições de sincronização e consulta (Web + APK);
    //   • Resolução e validação de identidade do usuário (Session / Token);
    //   • Validação rigorosa de UUIDs, coordenadas, geometria WKT e vínculos;
    //   • Orquestração na ordem: CALCULADA → GPS → OBSERVACAO → EVENTO;
    //   • Chamada direta à sua Classe DAL (Oracle 11g / PKG_SIGA_ROTAS).
    // =========================================================================

    public interface ISigaRotasCampoDal
    {
        bool EstaConfigurada { get; }
        ResultadoPersistenciaDto SalvarRota(RotaSincronizacaoDto rota, string idUsuarioAutenticado);
        ResultadoPersistenciaDto SalvarObservacao(ObservacaoSincronizacaoDto observacao, string idUsuarioAutenticado);
        ResultadoPersistenciaDto RegistrarEvento(EventoObservacaoDto evento, string idUsuarioAutenticado);
        List<RotaConsultaDto> ListarRotas(string idUsuarioAutenticado, string tipoRota, int limite);
        List<ObservacaoConsultaDto> ListarObservacoes(string idUsuarioAutenticado, long? idRotaServidor, string idRotaCliente);
    }

    public class RotaSincronizacaoDto
    {
        public string idCliente { get; set; }
        public long? idServidor { get; set; }
        public string tipoRota { get; set; }
        public long? idRotaOrigemServidor { get; set; }
        public string idRotaOrigemCliente { get; set; }
        public string wktGeometria { get; set; }
        public double distanciaMetros { get; set; }
        public int duracaoSegundos { get; set; }
        public string titulo { get; set; }
        public string modoCalculo { get; set; }
        public bool circular { get; set; }
        public string pontosJson { get; set; }
        public string legsJson { get; set; }
        public string dataCriacao { get; set; }
        public string dataInicio { get; set; }
        public string dataFim { get; set; }
        public string dataAtualizacao { get; set; }
        public int versao { get; set; }
        public string status { get; set; }
    }

    public class ObservacaoSincronizacaoDto
    {
        public string idCliente { get; set; }
        public long? idServidor { get; set; }
        public string operacao { get; set; }
        public long? idRotaServidor { get; set; }
        public string idRotaCliente { get; set; }
        public double longitude { get; set; }
        public double latitude { get; set; }
        public string descricao { get; set; }
        public string tipoObservacao { get; set; }
        public string dataCriacao { get; set; }
        public string dataAtualizacao { get; set; }
        public int versao { get; set; }
        public string status { get; set; }
    }

    public class EventoObservacaoDto
    {
        public string idCliente { get; set; }
        public long? idObservacaoServidor { get; set; }
        public string idObservacaoCliente { get; set; }
        public string tipoEvento { get; set; }
        public string dadosEventoJson { get; set; }
        public string dataEvento { get; set; }
    }

    public class LoteSincronizacaoRequest
    {
        public string dispositivoId { get; set; }
        public List<RotaSincronizacaoDto> rotas { get; set; }
        public List<ObservacaoSincronizacaoDto> observacoes { get; set; }
        public List<EventoObservacaoDto> eventos { get; set; }
    }

    public class ResultadoPersistenciaDto
    {
        public string idCliente { get; set; }
        public long? idServidor { get; set; }
        public long? idPaiServidor { get; set; }
        public string resultado { get; set; }
        public int versaoServidor { get; set; }
        public string dataAtualizacaoServidor { get; set; }
        public string mensagem { get; set; }
    }

    public class RotaConsultaDto
    {
        public long idServidor { get; set; }
        public string idCliente { get; set; }
        public long? idRotaOrigemServidor { get; set; }
        public string idRotaOrigemCliente { get; set; }
        public string tipoRota { get; set; }
        public string wktGeometria { get; set; }
        public double distanciaMetros { get; set; }
        public int duracaoSegundos { get; set; }
        public string titulo { get; set; }
        public string modoCalculo { get; set; }
        public bool circular { get; set; }
        public string pontosJson { get; set; }
        public string dataCriacao { get; set; }
        public string dataInicio { get; set; }
        public string dataFim { get; set; }
        public string dataAtualizacao { get; set; }
        public int versao { get; set; }
        public string status { get; set; }
        public string idUsuario { get; set; }
    }

    public class ObservacaoConsultaDto
    {
        public long idServidor { get; set; }
        public string idCliente { get; set; }
        public long idRotaServidor { get; set; }
        public string idRotaCliente { get; set; }
        public double longitude { get; set; }
        public double latitude { get; set; }
        public string descricao { get; set; }
        public string tipoObservacao { get; set; }
        public string dataCriacao { get; set; }
        public string dataAtualizacao { get; set; }
        public int versao { get; set; }
        public string idUsuario { get; set; }
        public string status { get; set; }
    }

    public class SigaRotasCampo : IHttpHandler, IReadOnlySessionState
    {
        private const int MaxBodyBytes = 4194304; // 4 MB por lote

        private static readonly Regex UuidRegex = new Regex(
            @"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
            RegexOptions.Compiled);

        private static readonly HashSet<string> TiposRotaPermitidos = new HashSet<string>(StringComparer.Ordinal)
        {
            "CALCULADA",
            "GPS"
        };

        private static readonly HashSet<string> StatusRotaPermitidos = new HashSet<string>(StringComparer.Ordinal)
        {
            "PLANEJADA",
            "SALVA",
            "EM_EXECUCAO",
            "CONCLUIDA",
            "INTERROMPIDA",
            "CANCELADA"
        };

        private static readonly HashSet<string> TiposObsPermitidos = new HashSet<string>(StringComparer.Ordinal)
        {
            "VISITA_REALIZADA",
            "IMOVEL_FECHADO",
            "RECUSA_ATENDIMENTO",
            "ACESSO_DIFICIL",
            "ENDERECO_DIVERGENTE",
            "PENDENCIA_CAMPO",
            "OUTRO"
        };

        private static readonly HashSet<string> StatusObsPermitidos = new HashSet<string>(StringComparer.Ordinal)
        {
            "ABERTA",
            "CONCLUIDA",
            "REABERTA"
        };

        private static readonly HashSet<string> TiposEventoPermitidos = new HashSet<string>(StringComparer.Ordinal)
        {
            "CRIACAO",
            "EDICAO",
            "CONCLUSAO",
            "REABERTURA",
            "ALTERACAO_STATUS"
        };

        public bool IsReusable { get { return true; } }

        // =====================================================================
        // [PONTO DE INTEGRACAO DA SUA CLASSE DAL — CHAME SUA DAL AQUI]
        // ---------------------------------------------------------------------
        // Depois de implementar sua classe DAL seguindo ISigaRotasCampoDal
        // (modelo pronto em `sql/oracle/04_exemplo_dal_csharp.cs`), substitua
        // o retorno deste método para instanciar sua DAL com a ConnectionString
        // corporativa do portal.
        // =====================================================================
        private static ISigaRotasCampoDal CriarDal()
        {
            // DESCOMENTE E APONTE PARA A SUA DAL QUANDO ESTIVER PRONTA:
            // var cs = WebConfigurationManager.ConnectionStrings["OracleSiga"];
            // if (cs != null && !string.IsNullOrWhiteSpace(cs.ConnectionString))
            // {
            //     return new PortalSiga.OracleDAL.AreaRestrita.SigaRotasCampoDal(cs.ConnectionString);
            // }
            return new DalNaoConfiguradaStub();
        }

        // =====================================================================
        // [PONTO DE INTEGRACAO DE AUTENTICACAO DO USUARIO]
        // ---------------------------------------------------------------------
        // Segurança obrigatória: NUNCA aceitar ID_USUARIO vindo livremente do
        // corpo JSON do cliente. Resolva sempre via Session/Identity do portal
        // (Web) ou token validado no servidor (APK).
        // =====================================================================
        private static string ResolverUsuarioAutenticado(HttpContext context)
        {
            if (context.User != null && context.User.Identity != null && context.User.Identity.IsAuthenticated)
            {
                string nome = (context.User.Identity.Name ?? string.Empty).Trim();
                if (!string.IsNullOrEmpty(nome)) return nome;
            }

            if (context.Session != null)
            {
                object sessaoUser = context.Session["ID_USUARIO"] ?? context.Session["UsuarioId"] ?? context.Session["Login"];
                if (sessaoUser != null)
                {
                    string s = Convert.ToString(sessaoUser, CultureInfo.InvariantCulture).Trim();
                    if (!string.IsNullOrEmpty(s)) return s;
                }
            }

            // Para chamadas do APK: valide o cabeçalho de token corporativo
            string bearer = context.Request.Headers["Authorization"] ?? string.Empty;
            string tokenApk = context.Request.Headers["X-Siga-Campo-Token"] ?? string.Empty;
            // TODO: validar assinatura/sessão do token na sua infraestrutura de autenticação do portal
            // e retornar a matrícula/ID_USUARIO oficial do agente.
            if (!string.IsNullOrWhiteSpace(tokenApk) || !string.IsNullOrWhiteSpace(bearer))
            {
                // Exemplo de chave de homologação opcional em Web.config (desabilitada por padrão):
                bool permitirCabecalhoHomolog = string.Equals(
                    WebConfigurationManager.AppSettings["SigaRotas.CampoPermitirTokenHomolog"],
                    "true",
                    StringComparison.OrdinalIgnoreCase);
                string usuarioHeader = (context.Request.Headers["X-Siga-Usuario"] ?? string.Empty).Trim();
                if (permitirCabecalhoHomolog && !string.IsNullOrEmpty(usuarioHeader))
                {
                    return usuarioHeader;
                }
            }

            return null;
        }

        public void ProcessRequest(HttpContext context)
        {
            AplicarCors(context);

            string method = (context.Request.HttpMethod ?? "GET").ToUpperInvariant();
            if (method == "OPTIONS")
            {
                context.Response.StatusCode = 204;
                return;
            }

            var jsonSerializer = new JavaScriptSerializer { MaxJsonLength = 16777216 };
            string acao = (context.Request.QueryString["acao"] ?? "health").Trim().ToLowerInvariant();
            ISigaRotasCampoDal dal = CriarDal();

            if (acao == "health" && method == "GET")
            {
                EscreverJson(context, 200, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", true },
                    { "servico", "SigaRotasCampo" },
                    { "oracleVersao", "11g" },
                    { "sridPadrao", null },
                    { "dalConfigurada", dal != null && dal.EstaConfigurada }
                });
                return;
            }

            string idUsuario = ResolverUsuarioAutenticado(context);
            if (string.IsNullOrEmpty(idUsuario))
            {
                EscreverJson(context, 401, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", false },
                    { "reason", "NAO_AUTENTICADO" },
                    { "message", "Usuário não autenticado no portal SIGA para persistência em campo." }
                });
                return;
            }

            if (dal == null || !dal.EstaConfigurada)
            {
                EscreverJson(context, 501, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", false },
                    { "reason", "DAL_NAO_CONFIGURADA" },
                    { "message", "Classe DAL Oracle ainda não plugada em SigaRotasCampo.CriarDal()." }
                });
                return;
            }

            if (acao == "sincronizar" && method == "POST")
            {
                ProcessarSincronizacao(context, dal, idUsuario, jsonSerializer);
                return;
            }

            if (acao == "rotas" && method == "GET")
            {
                string tipoRota = (context.Request.QueryString["tipoRota"] ?? string.Empty).Trim().ToUpperInvariant();
                if (!string.IsNullOrEmpty(tipoRota) && !TiposRotaPermitidos.Contains(tipoRota))
                {
                    EscreverJson(context, 400, jsonSerializer, new Dictionary<string, object>
                    {
                        { "ok", false },
                        { "reason", "TIPO_ROTA_INVALIDO" },
                        { "message", "Parâmetro tipoRota inválido." }
                    });
                    return;
                }
                int limite = 50;
                int.TryParse(context.Request.QueryString["limite"], out limite);
                if (limite <= 0 || limite > 200) limite = 50;

                List<RotaConsultaDto> rotas = dal.ListarRotas(idUsuario, string.IsNullOrEmpty(tipoRota) ? null : tipoRota, limite);
                EscreverJson(context, 200, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", true },
                    { "rotas", rotas }
                });
                return;
            }

            if (acao == "observacoes" && method == "GET")
            {
                long? idRota = null;
                long parsed;
                if (long.TryParse(context.Request.QueryString["idRota"], out parsed)) idRota = parsed;
                string idRotaCliente = (context.Request.QueryString["idRotaCliente"] ?? string.Empty).Trim();
                if (string.IsNullOrEmpty(idRotaCliente)) idRotaCliente = null;

                List<ObservacaoConsultaDto> obs = dal.ListarObservacoes(idUsuario, idRota, idRotaCliente);
                EscreverJson(context, 200, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", true },
                    { "observacoes", obs }
                });
                return;
            }

            EscreverJson(context, 400, jsonSerializer, new Dictionary<string, object>
            {
                { "ok", false },
                { "reason", "ACAO_INVALIDA" },
                { "message", "Ação WebForms desconhecida ou método HTTP incompatível." }
            });
        }

        private static void ProcessarSincronizacao(
            HttpContext context,
            ISigaRotasCampoDal dal,
            string idUsuario,
            JavaScriptSerializer jsonSerializer)
        {
            if (context.Request.ContentLength > MaxBodyBytes)
            {
                EscreverJson(context, 413, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", false },
                    { "reason", "PAYLOAD_MUITO_GRANDE" },
                    { "message", "Lote excede 4 MB." }
                });
                return;
            }

            string bodyText;
            using (var sr = new StreamReader(context.Request.InputStream, Encoding.UTF8))
            {
                bodyText = sr.ReadToEnd();
            }

            LoteSincronizacaoRequest lote;
            try
            {
                lote = jsonSerializer.Deserialize<LoteSincronizacaoRequest>(bodyText);
            }
            catch
            {
                EscreverJson(context, 400, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", false },
                    { "reason", "JSON_INVALIDO" },
                    { "message", "Corpo JSON inválido." }
                });
                return;
            }

            if (lote == null)
            {
                EscreverJson(context, 400, jsonSerializer, new Dictionary<string, object>
                {
                    { "ok", false },
                    { "reason", "LOTE_VAZIO" },
                    { "message", "Nenhum dado recebido para sincronização." }
                });
                return;
            }

            var resultadosRotas = new List<ResultadoPersistenciaDto>();
            var resultadosObservacoes = new List<ResultadoPersistenciaDto>();
            var resultadosEventos = new List<ResultadoPersistenciaDto>();
            var mapaRotaIds = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            var mapaObsIds = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

            // 1. Rotas: processa CALCULADA antes de GPS para preservar ID_ROTA_ORIGEM no mesmo lote
            var rotasOrdenadas = new List<RotaSincronizacaoDto>();
            if (lote.rotas != null)
            {
                foreach (var r in lote.rotas)
                {
                    if (string.Equals(r != null ? r.tipoRota : null, "CALCULADA", StringComparison.OrdinalIgnoreCase))
                        rotasOrdenadas.Add(r);
                }
                foreach (var r in lote.rotas)
                {
                    if (!string.Equals(r != null ? r.tipoRota : null, "CALCULADA", StringComparison.OrdinalIgnoreCase))
                        rotasOrdenadas.Add(r);
                }
            }

            foreach (var rota in rotasOrdenadas)
            {
                string erroValidacao = ValidarRota(rota);
                if (erroValidacao != null)
                {
                    resultadosRotas.Add(new ResultadoPersistenciaDto
                    {
                        idCliente = rota != null ? rota.idCliente : null,
                        resultado = "REJEITADO",
                        mensagem = erroValidacao
                    });
                    continue;
                }

                if (!rota.idRotaOrigemServidor.HasValue && !string.IsNullOrEmpty(rota.idRotaOrigemCliente))
                {
                    long idResolvido;
                    if (mapaRotaIds.TryGetValue(rota.idRotaOrigemCliente, out idResolvido))
                    {
                        rota.idRotaOrigemServidor = idResolvido;
                    }
                }

                ResultadoPersistenciaDto resRota = dal.SalvarRota(rota, idUsuario);
                resultadosRotas.Add(resRota);
                if (resRota != null && resRota.idServidor.HasValue && !string.IsNullOrEmpty(rota.idCliente))
                {
                    mapaRotaIds[rota.idCliente] = resRota.idServidor.Value;
                }
            }

            // 2. Observações georreferenciadas (sempre vinculadas a uma rota)
            if (lote.observacoes != null)
            {
                foreach (var obs in lote.observacoes)
                {
                    string erroObs = ValidarObservacao(obs);
                    if (erroObs != null)
                    {
                        resultadosObservacoes.Add(new ResultadoPersistenciaDto
                        {
                            idCliente = obs != null ? obs.idCliente : null,
                            resultado = "REJEITADO",
                            mensagem = erroObs
                        });
                        continue;
                    }

                    if (!obs.idRotaServidor.HasValue && !string.IsNullOrEmpty(obs.idRotaCliente))
                    {
                        long idResolvido;
                        if (mapaRotaIds.TryGetValue(obs.idRotaCliente, out idResolvido))
                        {
                            obs.idRotaServidor = idResolvido;
                        }
                    }

                    ResultadoPersistenciaDto resObs = dal.SalvarObservacao(obs, idUsuario);
                    resultadosObservacoes.Add(resObs);
                    if (resObs != null && resObs.idServidor.HasValue && !string.IsNullOrEmpty(obs.idCliente))
                    {
                        mapaObsIds[obs.idCliente] = resObs.idServidor.Value;
                    }
                }
            }

            // 3. Eventos históricos (SIGA_ROTA_EVENTO)
            if (lote.eventos != null)
            {
                foreach (var evt in lote.eventos)
                {
                    string erroEvt = ValidarEvento(evt);
                    if (erroEvt != null)
                    {
                        resultadosEventos.Add(new ResultadoPersistenciaDto
                        {
                            idCliente = evt != null ? evt.idCliente : null,
                            resultado = "REJEITADO",
                            mensagem = erroEvt
                        });
                        continue;
                    }

                    if (!evt.idObservacaoServidor.HasValue && !string.IsNullOrEmpty(evt.idObservacaoCliente))
                    {
                        long idResolvido;
                        if (mapaObsIds.TryGetValue(evt.idObservacaoCliente, out idResolvido))
                        {
                            evt.idObservacaoServidor = idResolvido;
                        }
                    }

                    ResultadoPersistenciaDto resEvt = dal.RegistrarEvento(evt, idUsuario);
                    resultadosEventos.Add(resEvt);
                }
            }

            EscreverJson(context, 200, jsonSerializer, new Dictionary<string, object>
            {
                { "ok", true },
                { "resultadosRotas", resultadosRotas },
                { "resultadosObservacoes", resultadosObservacoes },
                { "resultadosEventos", resultadosEventos }
            });
        }

        private static string ValidarRota(RotaSincronizacaoDto r)
        {
            if (r == null) return "Rota nula.";
            if (string.IsNullOrEmpty(r.idCliente) || !UuidRegex.IsMatch(r.idCliente)) return "ID_CLIENTE inválido para rota.";
            string tipo = (r.tipoRota ?? string.Empty).Trim().ToUpperInvariant();
            if (!TiposRotaPermitidos.Contains(tipo)) return "TIPO_ROTA inválido.";
            r.tipoRota = tipo;
            string status = (r.status ?? string.Empty).Trim().ToUpperInvariant();
            if (!StatusRotaPermitidos.Contains(status)) return "STATUS da rota inválido.";
            r.status = status;
            if (string.IsNullOrWhiteSpace(r.wktGeometria) ||
                (!r.wktGeometria.TrimStart().StartsWith("LINESTRING", StringComparison.OrdinalIgnoreCase) &&
                 !r.wktGeometria.TrimStart().StartsWith("MULTILINESTRING", StringComparison.OrdinalIgnoreCase)))
            {
                return "WKT da geometria da rota deve ser LINESTRING ou MULTILINESTRING.";
            }
            if (r.distanciaMetros < 0 || double.IsNaN(r.distanciaMetros) || double.IsInfinity(r.distanciaMetros))
            {
                return "DISTANCIA_METROS inválida.";
            }
            return null;
        }

        private static string ValidarObservacao(ObservacaoSincronizacaoDto o)
        {
            if (o == null) return "Observação nula.";
            if (string.IsNullOrEmpty(o.idCliente) || !UuidRegex.IsMatch(o.idCliente)) return "ID_CLIENTE inválido para observação.";
            if (!o.idRotaServidor.HasValue && (string.IsNullOrEmpty(o.idRotaCliente) || !UuidRegex.IsMatch(o.idRotaCliente)))
            {
                return "Observação sem vínculo obrigatório com uma rota.";
            }
            if (double.IsNaN(o.longitude) || double.IsNaN(o.latitude) ||
                o.longitude < -180 || o.longitude > 180 || o.latitude < -90 || o.latitude > 90)
            {
                return "Coordenadas geográficas inválidas para observação.";
            }
            string desc = (o.descricao ?? string.Empty).Trim();
            if (desc.Length < 3 || desc.Length > 1000) return "Descrição deve ter entre 3 e 1000 caracteres.";
            o.descricao = desc;
            string tipo = (o.tipoObservacao ?? string.Empty).Trim().ToUpperInvariant();
            if (!TiposObsPermitidos.Contains(tipo)) return "TIPO_OBSERVACAO inválido.";
            o.tipoObservacao = tipo;
            string status = (o.status ?? "ABERTA").Trim().ToUpperInvariant();
            if (!StatusObsPermitidos.Contains(status)) return "STATUS da observação inválido.";
            o.status = status;
            return null;
        }

        private static string ValidarEvento(EventoObservacaoDto e)
        {
            if (e == null) return "Evento nulo.";
            if (string.IsNullOrEmpty(e.idCliente) || !UuidRegex.IsMatch(e.idCliente)) return "ID_CLIENTE inválido para evento.";
            if (!e.idObservacaoServidor.HasValue && (string.IsNullOrEmpty(e.idObservacaoCliente) || !UuidRegex.IsMatch(e.idObservacaoCliente)))
            {
                return "Evento sem vínculo obrigatório com observação.";
            }
            string tipo = (e.tipoEvento ?? string.Empty).Trim().ToUpperInvariant();
            if (!TiposEventoPermitidos.Contains(tipo)) return "TIPO_EVENTO inválido.";
            e.tipoEvento = tipo;
            return null;
        }

        private static void AplicarCors(HttpContext context)
        {
            string origin = context.Request.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin))
            {
                context.Response.Headers["Access-Control-Allow-Origin"] = origin;
                context.Response.Headers["Vary"] = "Origin";
                context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Siga-Campo-Token, X-Siga-Usuario";
            }
        }

        private static void EscreverJson(
            HttpContext context,
            int statusCode,
            JavaScriptSerializer serializer,
            object payload)
        {
            context.Response.StatusCode = statusCode;
            context.Response.TrySkipIisCustomErrors = true;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Cache.SetCacheability(HttpCacheability.NoCache);
            context.Response.Cache.SetNoStore();
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Write(serializer.Serialize(payload));
        }

        private class DalNaoConfiguradaStub : ISigaRotasCampoDal
        {
            public bool EstaConfigurada { get { return false; } }
            public ResultadoPersistenciaDto SalvarRota(RotaSincronizacaoDto r, string u) { throw new NotImplementedException(); }
            public ResultadoPersistenciaDto SalvarObservacao(ObservacaoSincronizacaoDto o, string u) { throw new NotImplementedException(); }
            public ResultadoPersistenciaDto RegistrarEvento(EventoObservacaoDto e, string u) { throw new NotImplementedException(); }
            public List<RotaConsultaDto> ListarRotas(string u, string t, int l) { throw new NotImplementedException(); }
            public List<ObservacaoConsultaDto> ListarObservacoes(string u, long? idR, string idRc) { throw new NotImplementedException(); }
        }
    }
}
