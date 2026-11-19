// Complemento de Revit "Publicar al CDE" (CDE ANIN).
// Conversacion con el servidor del CDE. Deriva de ClienteVisor.cs del Visor BIM: llave en cabecera (x-cde-llave),
// TLS 1.2 en .NET 4.8, todo en Task.Run para no bloquear el hilo de Revit, JSON con DataContractJsonSerializer.
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading.Tasks;

namespace CdeAnin
{
    public class ClienteCde
    {
        readonly string servidor, llave;
        static readonly HttpClient Http = CreaHttp();

        static HttpClient CreaHttp()
        {
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch (Exception) { }
            return new HttpClient { Timeout = TimeSpan.FromMinutes(30) };   // un federado grande tarda en subir
        }

        public ClienteCde(Configuracion c) { servidor = (c.Servidor ?? "").Trim().TrimEnd('/'); llave = (c.Llave ?? "").Trim(); }

        public static T Lee<T>(string json) where T : class
        {
            var ser = new DataContractJsonSerializer(typeof(T));
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json))) return ser.ReadObject(ms) as T;
        }
        public static string Escribe<T>(T obj)
        {
            var ser = new DataContractJsonSerializer(typeof(T));
            using (var ms = new MemoryStream()) { ser.WriteObject(ms, obj); return Encoding.UTF8.GetString(ms.ToArray()); }
        }

        string Pide(HttpMethod metodo, string ruta, HttpContent cuerpo, Action<HttpRequestMessage> cabeceras = null)
        {
            return Task.Run(async () =>
            {
                using (var req = new HttpRequestMessage(metodo, servidor + ruta))
                {
                    req.Headers.Add("x-cde-llave", llave);
                    if (cuerpo != null) req.Content = cuerpo;
                    cabeceras?.Invoke(req);
                    using (var r = await Http.SendAsync(req).ConfigureAwait(false))
                    {
                        string txt = await r.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if ((int)r.StatusCode == 401) throw new InvalidOperationException("La llave del complemento no es valida (pidele una nueva al administrador del CDE).");
                        if (!r.IsSuccessStatusCode)
                        {
                            string msg = txt;
                            try { var e = Lee<Error>(txt); if (e != null && !string.IsNullOrEmpty(e.Mensaje)) { msg = e.Mensaje; if (e.Errores != null && e.Errores.Count > 0) msg += "\n- " + string.Join("\n- ", e.Errores); } } catch (Exception) { }
                            throw new InvalidOperationException("El CDE respondio " + (int)r.StatusCode + ": " + msg);
                        }
                        return txt;
                    }
                }
            }).GetAwaiter().GetResult();
        }
        static StringContent Json(string s) => new StringContent(s, Encoding.UTF8, "application/json");
        static ByteArrayContent CuerpoBinario(byte[] b) { var c = new ByteArrayContent(b); c.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/gzip"); return c; }

        public RespuestaProyectos Proyectos() => Lee<RespuestaProyectos>(Pide(HttpMethod.Get, "/api/complemento/proyectos", null));

        public Validacion ValidaNombre(string pid, string nombreArchivo) =>
            Lee<Validacion>(Pide(HttpMethod.Post, "/api/proyectos/" + pid + "/valida-nombre", Json("{\"nombre\":" + Cadena(nombreArchivo) + "}")));

        /// <summary>Sube el archivo (nativo o manifiesto) como version nueva del contenedor. Devuelve la version creada.</summary>
        public RespuestaSubida Subir(string pid, string nombreArchivo, Stream contenido, string carpeta, string metaJson, string origen = "complemento-revit")
        {
            var sc = new StreamContent(contenido);
            sc.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            return Lee<RespuestaSubida>(Pide(HttpMethod.Post, "/api/proyectos/" + pid + "/subir?origen=" + Uri.EscapeDataString(origen ?? "complemento-revit") + "&carpeta=" + Uri.EscapeDataString(carpeta ?? ""), sc,
                req => { req.Headers.Add("x-nombre", Uri.EscapeDataString(nombreArchivo)); if (!string.IsNullOrEmpty(metaJson)) req.Headers.Add("x-meta", Uri.EscapeDataString(metaJson)); }));
        }

        public string IndiceInicio(string pid, string vid, string jsonInicio) =>
            Lee<RespuestaInicio>(Pide(HttpMethod.Post, "/api/modelos/" + pid + "/" + vid + "/indice/inicio", Json(jsonInicio))).Subida;
        public void IndiceTrozo(string pid, string vid, string sid, byte[] gzip) =>
            Pide(HttpMethod.Post, "/api/modelos/" + pid + "/" + vid + "/indice/trozo/" + sid, CuerpoBinario(gzip));
        public void Geometria(string pid, string vid, string sid, Stream cdeg) =>
            Pide(HttpMethod.Post, "/api/modelos/" + pid + "/" + vid + "/geometria/" + sid, new StreamContent(cdeg));
        public void IndiceFin(string pid, string vid, string sid) =>
            Pide(HttpMethod.Post, "/api/modelos/" + pid + "/" + vid + "/indice/fin/" + sid, Json("{}"));
        public RespuestaEstado Estado(string pid, string vid) => Lee<RespuestaEstado>(Pide(HttpMethod.Get, "/api/modelos/" + pid + "/" + vid + "/estado", null));

        public RespuestaIncidencias Incidencias(string pid) => Lee<RespuestaIncidencias>(Pide(HttpMethod.Get, "/api/complemento/" + pid + "/incidencias", null));
        public void CreaIncidencia(string pid, NuevaIncidencia n) => Pide(HttpMethod.Post, "/api/proyectos/" + pid + "/incidencias", Json(Escribe(n)));

        /// <summary>Texto JSON con comillas y escapes.</summary>
        public static string Cadena(string s)
        {
            if (s == null) return "\"\"";
            var sb = new StringBuilder(s.Length + 2); sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break; case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break; case '\r': sb.Append("\\r"); break; case '\t': sb.Append("\\t"); break;
                    default: if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); break;
                }
            }
            return sb.Append('"').ToString();
        }

        [System.Runtime.Serialization.DataContract] public class Error
        {
            [System.Runtime.Serialization.DataMember(Name = "mensaje")] public string Mensaje { get; set; }
            [System.Runtime.Serialization.DataMember(Name = "errores")] public System.Collections.Generic.List<string> Errores { get; set; }
        }
    }

    public static class Config
    {
        public static string Carpeta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CdeAnin");
        public static string Archivo => Path.Combine(Carpeta, "complemento.json");
        public static Configuracion Lee() { try { return File.Exists(Archivo) ? ClienteCde.Lee<Configuracion>(File.ReadAllText(Archivo, Encoding.UTF8)) : null; } catch (Exception) { return null; } }
        public static void Guarda(Configuracion c) { Directory.CreateDirectory(Carpeta); File.WriteAllText(Archivo, ClienteCde.Escribe(c), new UTF8Encoding(false)); }
        public static bool Valida(Configuracion c) => c != null && !string.IsNullOrWhiteSpace(c.Servidor) && (c.Servidor.Trim().StartsWith("https://", StringComparison.OrdinalIgnoreCase) || HttpLocal(c.Servidor.Trim())) && (c.Llave ?? "").Trim().Length >= 32;
        /// <summary>http sin cifrar solo dentro de la PC o de la red local (pruebas: el CDE en otra PC de la oficina, p. ej. http://192.168.1.20:8090).</summary>
        static bool HttpLocal(string url)
        {
            Uri u; if (!Uri.TryCreate(url, UriKind.Absolute, out u) || u.Scheme != "http") return false;
            string h = u.Host.ToLowerInvariant(); if (h == "localhost" || h == "127.0.0.1" || h.EndsWith(".local")) return true;
            var p = h.Split('.'); int a, b; if (p.Length != 4 || !int.TryParse(p[0], out a) || !int.TryParse(p[1], out b)) return false;
            return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
        }
        public static void CreaPlantilla()
        {
            Directory.CreateDirectory(Carpeta);
            if (!File.Exists(Archivo)) File.WriteAllText(Archivo, "{\r\n  \"servidor\": \"https://cde.anin.gob.pe\",\r\n  \"llave\": \"PEGA-AQUI-LA-LLAVE-DEL-CDE\",\r\n  \"detalle\": \"medio\"\r\n}\r\n", new UTF8Encoding(false));
        }
        public static void Anota(string texto) { try { Directory.CreateDirectory(Carpeta); File.AppendAllText(Path.Combine(Carpeta, "registro.txt"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + texto + "\r\n"); } catch (Exception) { } }
    }
}
