<%@ WebHandler Language="C#" Class="SigaRotas.WfsProxy" %>
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web;

namespace SigaRotas
{
    /// <summary>
    /// Proxy opcional para consultar o WFS do GeoServer de Santo André a partir
    /// do iframe em ASP.NET WebForms (contornando a ausência de cabeçalhos CORS
    /// no GeoServer sem depender de Node.js).
    /// Uso no iframe: ../../SigaApp/SigaRotas/public/index.html?wfsProxy=../WfsProxy.ashx
    /// </summary>
    public class WfsProxy : IHttpHandler
    {
        private const string WfsEndpoint = "https://sigamapa.santoandre.sp.gov.br/geoserver/siga/wfs";
        private static readonly HashSet<string> AllowedParams = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "service",
            "version",
            "request",
            "typeName",
            "typeNames",
            "outputFormat",
            "maxFeatures",
            "count",
            "startIndex",
            "sortBy",
            "CQL_FILTER",
            "srsName",
            "exceptions",
            "propertyName"
        };

        public bool IsReusable
        {
            get { return true; }
        }

        public void ProcessRequest(HttpContext context)
        {
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = 405;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.Write("{\"ok\":false,\"error\":\"Método não permitido.\"}");
                return;
            }

            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

                var qs = new StringBuilder();
                foreach (string key in context.Request.QueryString.AllKeys)
                {
                    if (string.IsNullOrEmpty(key) || !AllowedParams.Contains(key)) continue;
                    string value = context.Request.QueryString[key] ?? string.Empty;
                    if (qs.Length > 0) qs.Append('&');
                    qs.Append(Uri.EscapeDataString(key));
                    qs.Append('=');
                    qs.Append(Uri.EscapeDataString(value));
                }

                string targetUrl = qs.Length > 0 ? (WfsEndpoint + "?" + qs.ToString()) : WfsEndpoint;
                var req = (HttpWebRequest)WebRequest.Create(targetUrl);
                req.Method = "GET";
                req.Timeout = 20000;
                req.Accept = "application/json, text/xml;q=0.9, */*;q=0.8";

                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    context.Response.StatusCode = (int)resp.StatusCode;
                    context.Response.ContentType = !string.IsNullOrEmpty(resp.ContentType)
                        ? resp.ContentType
                        : "application/json; charset=utf-8";
                    context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

                    using (var stream = resp.GetResponseStream())
                    {
                        if (stream != null)
                        {
                            stream.CopyTo(context.Response.OutputStream);
                        }
                    }
                }
            }
            catch (WebException ex)
            {
                var httpResp = ex.Response as HttpWebResponse;
                context.Response.StatusCode = httpResp != null ? (int)httpResp.StatusCode : 502;
                context.Response.ContentType = "application/json; charset=utf-8";
                if (httpResp != null)
                {
                    using (var reader = new StreamReader(httpResp.GetResponseStream(), Encoding.UTF8))
                    {
                        context.Response.Write(reader.ReadToEnd());
                    }
                }
                else
                {
                    context.Response.Write("{\"ok\":false,\"error\":\"Falha ao consultar o WFS remoto.\"}");
                }
            }
        }
    }
}
