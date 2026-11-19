// Complemento de Navisworks "Publicar al CDE" (CDE ANIN).
// Los botones (pestana "Complementos" de Navisworks): Publicar al CDE y Configurar. Usa la MISMA configuracion y la MISMA llave
// que el complemento de Revit (%AppData%\CdeAnin\complemento.json) y el mismo cliente del servidor (ClienteCde.cs).
// Solo funciona en Navisworks Manage o Simulate: Navisworks Freedom no carga complementos.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Autodesk.Navisworks.Api;
using Autodesk.Navisworks.Api.Plugins;
using NwApp = Autodesk.Navisworks.Api.Application;

namespace CdeAnin
{
    [Plugin("CdeAnin.Publicar", "ANIN", DisplayName = "Publicar al CDE", ToolTip = "Publica el modelo abierto (NWD, NWF o NWC) al CDE ANIN: sube el archivo y envia el indice de propiedades y la geometria para verlo en el navegador.")]
    [AddInPlugin(AddInLocation.AddIn)]
    public class CmdPublicar : AddInPlugin
    {
        public override int Execute(params string[] parameters)
        {
            var doc = NwApp.ActiveDocument;
            if (doc == null || doc.IsClear) { MessageBox.Show("Abre un modelo primero.", "CDE ANIN"); return 0; }
            var cfg = Config.Lee();
            if (!Config.Valida(cfg)) { MessageBox.Show("Falta configurar el complemento (Complementos → Configurar CDE).", "CDE ANIN"); return 0; }
            var cli = new ClienteCde(cfg);
            RespuestaProyectos rp;
            try { rp = cli.Proyectos(); } catch (Exception ex) { MessageBox.Show("No se pudo conectar con el CDE:\n" + ex.Message, "CDE ANIN"); return 0; }
            if (rp.Proyectos == null || rp.Proyectos.Count == 0) { MessageBox.Show("La llave no tiene proyectos asignados.", "CDE ANIN"); return 0; }

            string archivo = doc.FileName, ext = Path.GetExtension(archivo ?? "").ToLowerInvariant();
            bool sinArchivo = string.IsNullOrEmpty(archivo) || !File.Exists(archivo);
            // un NWF solo trae los vinculos, y un RVT / IFC / DWG abierto directo en Navisworks no es un archivo de Navisworks:
            // se suben como NWD con todo dentro. El NWD y el NWC van tal cual.
            bool propio = ext == ".nwd" || ext == ".nwc", obligado = sinArchivo || !(propio || ext == ".nwf");
            bool empaquetar = sinArchivo || !propio;
            string sugerido = Path.GetFileNameWithoutExtension(ExtractorNavis.NombreModelo(doc)) + (empaquetar ? ".nwd" : ext);

            using (var f = new FormPublicar(rp.Proyectos, cfg.UltimoProyecto, sugerido, cli, empaquetar, obligado))
            {
                if (f.ShowDialog() != DialogResult.OK) return 0;
                cfg.UltimoProyecto = f.Proyecto.Id; try { Config.Guarda(cfg); } catch (Exception) { }
                var reloj = System.Diagnostics.Stopwatch.StartNew();
                string temporal = null;
                try
                {
                    // 1) el archivo: el NWD / NWC tal cual; un NWF o un modelo sin guardar, empaquetado como NWD temporal
                    string subir = archivo, nombre = f.Nombre, aviso = "";
                    if (f.Empaquetar)
                    {
                        temporal = Path.Combine(Path.GetTempPath(), "CdeAnin", Path.GetFileNameWithoutExtension(nombre) + ".nwd"); Directory.CreateDirectory(Path.GetDirectoryName(temporal));
                        if (!ExportaNwd(doc, temporal)) throw new InvalidOperationException("Navisworks no pudo empaquetar el modelo como NWD.");
                        subir = temporal; if (!nombre.EndsWith(".nwd", StringComparison.OrdinalIgnoreCase)) nombre = Path.ChangeExtension(nombre, ".nwd");
                        aviso = "\n(Se subio empaquetado como NWD.)";
                    }
                    string meta = "{\"navisworks\":" + ClienteCde.Cadena(VersionNavis()) + ",\"titulo\":" + ClienteCde.Cadena(ExtractorNavis.NombreModelo(doc)) + ",\"modelos\":" + doc.Models.Count + ",\"equipo\":" + ClienteCde.Cadena(Environment.MachineName) + ",\"usuario\":" + ClienteCde.Cadena(Environment.UserName) + "}";
                    RespuestaSubida sub;
                    using (var s = new FileStream(subir, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) sub = cli.Subir(f.Proyecto.Id, nombre, s, f.Carpeta, meta, "complemento-navisworks");

                    // 2) el paquete: indice (formato del visor) + geometria
                    // detalle de complemento.json (bajo / medio / alto): cuanto se aligera la geometria para el navegador
                    var paq = ExtractorNavis.Extrae(doc, f.ConGeometria, OpcionesGeometria.De(cfg.Detalle, cfg.Minutos ?? 0, cfg.Acero), t => Config.Anota(t));
                    string sid = cli.IndiceInicio(f.Proyecto.Id, sub.Version, "{\"modelos\":[" + string.Join(",", paq.Modelos.Select(ClienteCde.Cadena)) + "],\"elementos\":" + paq.Elementos + ",\"parametros\":" + paq.Parametros + ",\"pares\":" + paq.Pares + ",\"origen\":\"complemento-navisworks\",\"herramienta\":\"CdeAnin Navisworks " + VersionNavis() + "\"}");
                    int k = 0; foreach (var tz in paq.Trozos) { cli.IndiceTrozo(f.Proyecto.Id, sub.Version, sid, tz); k++; }
                    if (paq.RutaGeometria != null) { using (var g = File.OpenRead(paq.RutaGeometria)) cli.Geometria(f.Proyecto.Id, sub.Version, sid, g); try { File.Delete(paq.RutaGeometria); } catch (Exception) { } }
                    cli.IndiceFin(f.Proyecto.Id, sub.Version, sid);
                    reloj.Stop();
                    string r = "Publicado en " + f.Proyecto.Codigo + " como " + sub.Revision + " (version " + sub.N + ", estado " + sub.Estado + ").\n\n" +
                        paq.Modelos.Count + " archivo(s) de origen, " + paq.Elementos.ToString("N0") + " elementos, " + paq.Parametros.ToString("N0") + " propiedades, " + paq.Pares.ToString("N0") + " valores en " + k + " trozos" +
                        (paq.RutaGeometria != null || paq.ConGeometria > 0 ? "; geometria: " + paq.ConGeometria.ToString("N0") + " elementos, " + paq.Triangulos.ToString("N0") + " triangulos" : "; sin geometria") +
                        ".\nTiempo: " + reloj.Elapsed.ToString(@"h\:mm\:ss") + "." + aviso + (paq.Avisos.Count > 0 ? "\n\nAvisos (" + paq.Avisos.Count + "): " + string.Join("; ", paq.Avisos.Take(5)) : "");
                    Config.Anota("Navisworks: " + r.Replace("\n", " "));
                    MessageBox.Show(r, "CDE ANIN");
                }
                catch (Exception ex) { Config.Anota("ERROR publicar (Navisworks): " + ex); MessageBox.Show("No se pudo publicar:\n" + ex.Message, "CDE ANIN"); }
                finally { if (temporal != null) try { File.Delete(temporal); } catch (Exception) { } }
            }
            return 0;
        }

        /// <summary>Empaqueta el modelo abierto como NWD sin cambiar el archivo abierto. Navisworks 2026 trae TryExportToNwd; las
        /// versiones anteriores, PublishFile. Se llaman por reflexion para que la misma fuente compile con 2024, 2025, 2026 y 2027.</summary>
        static bool ExportaNwd(Document doc, string ruta)
        {
            var t = doc.GetType();
            try
            {
                var tOpc = t.Assembly.GetType("Autodesk.Navisworks.Api.NwdExportOptions");
                var m = tOpc != null ? t.GetMethod("TryExportToNwd", new[] { typeof(string), tOpc }) : null;
                if (m != null) { var o = Activator.CreateInstance(tOpc); var p = tOpc.GetProperty("EmbedXrefs"); if (p != null) p.SetValue(o, true); if ((bool)m.Invoke(doc, new object[] { ruta, o })) return true; }
            }
            catch (Exception ex) { Config.Anota("TryExportToNwd: " + ex.Message); }
            try
            {
                var tPub = t.Assembly.GetType("Autodesk.Navisworks.Api.PublishProperties");
                var m = tPub != null ? t.GetMethod("TryPublishFile", new[] { typeof(string), tPub }) : null;
                if (m != null) { var o = Activator.CreateInstance(tPub); var p = tPub.GetProperty("AllowResave"); if (p != null) p.SetValue(o, true); return (bool)m.Invoke(doc, new object[] { ruta, o }); }
            }
            catch (Exception ex) { Config.Anota("TryPublishFile: " + ex.Message); }
            return false;
        }
        static string VersionNavis() { try { return typeof(Document).Assembly.GetName().Version.ToString(); } catch (Exception) { return "?"; } }
    }

    [Plugin("CdeAnin.Configurar", "ANIN", DisplayName = "Configurar CDE", ToolTip = "Direccion del CDE y llave del complemento (la misma que usa el complemento de Revit).")]
    [AddInPlugin(AddInLocation.AddIn)]
    public class CmdConfigurar : AddInPlugin
    {
        public override int Execute(params string[] parameters)
        {
            Config.CreaPlantilla();
            MessageBox.Show("Se abre el archivo de configuracion (es el mismo del complemento de Revit). Escribe la direccion del CDE (https://...) y pega la llave del complemento que te dio el administrador. Guarda y cierra.\n\n" + Config.Archivo, "CDE ANIN");
            try { System.Diagnostics.Process.Start("notepad.exe", Config.Archivo); } catch (Exception) { }
            return 0;
        }
    }

    /// <summary>Ventana de publicacion: proyecto, nombre (se valida contra el CDE al escribir), carpeta, empaquetar como NWD, geometria.</summary>
    class FormPublicar : Form
    {
        readonly ComboBox cbProy = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
        readonly TextBox tbNombre = new TextBox { Width = 420 }, tbCarpeta = new TextBox { Width = 420 };
        readonly CheckBox chkGeo = new CheckBox { Text = "Enviar geometria (para verlo en el navegador sin Autodesk)", Checked = true, AutoSize = true };
        readonly CheckBox chkNwd = new CheckBox { Text = "Subir empaquetado como NWD (recomendado para NWF)", AutoSize = true };
        readonly Label lblVal = new Label { AutoSize = true, MaximumSize = new System.Drawing.Size(420, 0), ForeColor = System.Drawing.Color.DarkOrange };
        readonly Button ok = new Button { Text = "Publicar", DialogResult = DialogResult.OK, Enabled = false }, cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel };
        readonly ClienteCde cli; readonly string extOriginal;
        public Proyecto Proyecto => (Proyecto)cbProy.SelectedItem; public string Nombre => tbNombre.Text.Trim(); public string Carpeta => tbCarpeta.Text.Trim();
        public bool ConGeometria => chkGeo.Checked; public bool Empaquetar => chkNwd.Checked;

        public FormPublicar(List<Proyecto> proyectos, string ultimo, string nombreSugerido, ClienteCde cliente, bool empaquetar, bool obligado)
        {
            cli = cliente; extOriginal = Path.GetExtension(nombreSugerido);
            Text = "Publicar al CDE ANIN (Navisworks)"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen; ClientSize = new System.Drawing.Size(460, 330); Font = new System.Drawing.Font("Segoe UI", 9f);
            foreach (var p in proyectos) cbProy.Items.Add(p);
            cbProy.SelectedIndex = Math.Max(0, proyectos.FindIndex(p => p.Id == ultimo));
            tbNombre.Text = nombreSugerido; chkNwd.Checked = empaquetar; chkNwd.Enabled = !obligado;
            var y = 12; Action<string, Control> fila = (t, c) => { Controls.Add(new Label { Text = t, Left = 16, Top = y, AutoSize = true }); c.Left = 16; c.Top = y + 18; Controls.Add(c); y += 50; };
            fila("Proyecto del CDE", cbProy); fila("Nombre del contenedor (con extension)", tbNombre); fila("Carpeta (opcional)", tbCarpeta);
            chkNwd.Left = 16; chkNwd.Top = y; Controls.Add(chkNwd); y += 24;
            chkGeo.Left = 16; chkGeo.Top = y; Controls.Add(chkGeo); y += 26;
            lblVal.Left = 16; lblVal.Top = y; Controls.Add(lblVal);
            ok.Left = 280; ok.Top = 292; cancel.Left = 365; cancel.Top = 292; Controls.Add(ok); Controls.Add(cancel); AcceptButton = ok; CancelButton = cancel;
            tbNombre.TextChanged += (s, e) => Valida(); cbProy.SelectedIndexChanged += (s, e) => Valida();
            chkNwd.CheckedChanged += (s, e) => { string n = Nombre; if (n.Length > 0) tbNombre.Text = Path.ChangeExtension(n, chkNwd.Checked ? ".nwd" : extOriginal); };
            Shown += (s, e) => Valida();
        }
        void Valida()
        {
            ok.Enabled = false; var p = Proyecto; if (p == null || Nombre.Length == 0) { lblVal.Text = "Escribe el nombre."; return; }
            try
            {
                var v = cli.ValidaNombre(p.Id, Nombre);
                if (v.Ok) { lblVal.ForeColor = System.Drawing.Color.ForestGreen; lblVal.Text = "Nombre valido" + (string.IsNullOrEmpty(v.Revision) ? "" : " · revision " + v.Revision) + " · " + v.Tipo; ok.Enabled = true; }
                else { lblVal.ForeColor = System.Drawing.Color.DarkOrange; lblVal.Text = string.Join("\n", v.Errores ?? new List<string> { "Nombre no valido." }); }
            }
            catch (Exception ex) { lblVal.ForeColor = System.Drawing.Color.Firebrick; lblVal.Text = ex.Message; }
        }
    }
}
