<%@ WebHandler Language="C#" Class="SigaRotas.ApiProxy" %>
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web;
using System.Web.Configuration;

namespace SigaRotas
{
    /// <summary>
    /// Handler HTTP de mesma origem para integrar o iframe do Siga-Rotas
    /// (../../SigaApp/SigaRotas/public/index.html) ao servidor Node.js em
    /// loopback (padrao http://127.0.0.1:8094), sem exigir ARR, URL Rewrite,
    /// HttpPlatformHandler nem abertura de porta publica adicional.
    ///
    /// Configuracoes opcionais em <appSettings> do Web.config do portal:
    ///   SigaRotas.NodeApiBase  (padrao: http://127.0.0.1:8094)
    ///   SigaRotas.NodeApiToken (opcional: enviado via X-Siga-Token)
    /// </summary>
    public class ApiProxy : IHttpHandler
    {
        private const string DefaultNodeApiBase = "http://127.0.0.1:8094";
        private const int MaxBodyBytes = 1048576;

        private static readonly HashSet<string> AllowedEndpoints = new HashSet<string>(StringComparer.Ordinal)
        {
            "/api/health",
            "/api/network",
            "/api/route",
            "/api/rota-paradas",
            "/api/endereco-digital",
            "/api/diagnostics",
            "/api/updates",
            "/api/layer-schema",
            "/api/refresh"
        };

        public bool IsReusable
        {
            get { return true; }
        }

        public void ProcessRequest(HttpContext context)
        {
            string method = (context.Request.HttpMethod ?? "GET").ToUpperInvariant();
            if (method != "GET" && method != "POST")
            {
                WriteJson(context, 405, "{\"ok\":false,\"reason\":\"METODO_NAO_PERMITIDO\",\"message\":\"Metodo HTTP nao permitido.\"}");
                return;
            }

            string endpoint = context.Request.QueryString["endpoint"];
            if (string.IsNullOrWhiteSpace(endpoint))
            {
                string pathInfo = context.Request.PathInfo;
                if (!string.IsNullOrWhiteSpace(pathInfo))
                {
                    endpoint = pathInfo.Trim();
                }
            }
            if (string.IsNullOrWhiteSpace(endpoint) || !AllowedEndpoints.Contains(endpoint))
            {
                WriteJson(context, 403, "{\"ok\":false,\"reason\":\"ENDPOINT_NAO_PERMITIDO\",\"message\":\"Endpoint nao autorizado pelo proxy.\"}");
                return;
            }

            if (endpoint == "/api/refresh" && method != "POST")
            {
                WriteJson(context, 405, "{\"ok\":false,\"reason\":\"METODO_NAO_PERMITIDO\",\"message\":\"Use POST para /api/refresh.\"}");
                return;
            }

            string baseNode = (WebConfigurationManager.AppSettings["SigaRotas.NodeApiBase"] ?? DefaultNodeApiBase).Trim().TrimEnd('/');
            string apiToken = (WebConfigurationManager.AppSettings["SigaRotas.NodeApiToken"] ?? string.Empty).Trim();

            var qs = new StringBuilder();
            foreach (string key in context.Request.QueryString.AllKeys)
            {
                if (string.IsNullOrEmpty(key) || string.Equals(key, "endpoint", StringComparison.OrdinalIgnoreCase))
                    continue;
                string value = context.Request.QueryString[key] ?? string.Empty;
                if (qs.Length > 0) qs.Append('&');
                qs.Append(Uri.EscapeDataString(key));
                qs.Append('=');
                qs.Append(Uri.EscapeDataString(value));
            }

            string targetUrl = baseNode + endpoint + (qs.Length > 0 ? ("?" + qs.ToString()) : string.Empty);

            try
            {
                var req = (HttpWebRequest)WebRequest.Create(targetUrl);
                req.Method = method;
                req.Timeout = endpoint == "/api/health" ? 5000 : 120000;
                req.ReadWriteTimeout = req.Timeout;
                req.Accept = "application/json";

                if (!string.IsNullOrEmpty(apiToken))
                {
                    req.Headers["X-Siga-Token"] = apiToken;
                }

                if (method == "POST")
                {
                    if (context.Request.ContentLength > MaxBodyBytes)
                    {
                        WriteJson(context, 413, "{\"ok\":false,\"reason\":\"PAYLOAD_MUITO_GRANDE\",\"message\":\"Corpo da requisicao excede 1 MB.\"}");
                        return;
                    }

                    byte[] bodyBytes;
                    using (var ms = new MemoryStream())
                    {
                        context.Request.InputStream.CopyTo(ms);
                        bodyBytes = ms.ToArray();
                    }
                    if (bodyBytes.Length > MaxBodyBytes)
                    {
                        WriteJson(context, 413, "{\"ok\":false,\"reason\":\"PAYLOAD_MUITO_GRANDE\",\"message\":\"Corpo da requisicao excede 1 MB.\"}");
                        return;
                    }

                    req.ContentType = !string.IsNullOrEmpty(context.Request.ContentType)
                        ? context.Request.ContentType
                        : "application/json; charset=utf-8";
                    req.ContentLength = bodyBytes.Length;

                    using (var reqStream = req.GetRequestStream())
                    {
                        if (bodyBytes.Length > 0)
                        {
                            reqStream.Write(bodyBytes, 0, bodyBytes.Length);
                        }
                    }
                }

                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    ForwardResponse(context, resp);
                }
            }
            catch (WebException ex)
            {
                var httpResp = ex.Response as HttpWebResponse;
                if (httpResp != null)
                {
                    using (httpResp)
                    {
                        ForwardResponse(context, httpResp);
                    }
                    return;
                }

                WriteJson(
                    context,
                    503,
                    "{\"ok\":false,\"reason\":\"API_INDISPONIVEL\",\"message\":\"Servidor Node.js do Siga-Rotas indisponivel em " + EscapeJson(baseNode) + ".\"}");
            }
        }

        private static void ForwardResponse(HttpContext context, HttpWebResponse resp)
        {
            context.Response.StatusCode = (int)resp.StatusCode;
            context.Response.ContentType = !string.IsNullOrEmpty(resp.ContentType)
                ? resp.ContentType
                : "application/json; charset=utf-8";
            context.Response.Cache.SetCacheability(HttpCacheability.NoCache);
            context.Response.AppendHeader("Cache-Control", "no-store");
            context.Response.AppendHeader("X-Content-Type-Options", "nosniff");

            using (var stream = resp.GetResponseStream())
            {
                if (stream != null)
                {
                    stream.CopyTo(context.Response.OutputStream);
                }
            }
        }

        private static void WriteJson(HttpContext context, int status, string json)
        {
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Cache.SetCacheability(HttpCacheability.NoCache);
            context.Response.AppendHeader("Cache-Control", "no-store");
            context.Response.AppendHeader("X-Content-Type-Options", "nosniff");
            context.Response.Write(json);
        }

        private static string EscapeJson(string text)
        {
            return (text ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
