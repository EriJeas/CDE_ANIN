// Complemento de Revit "Publicar al CDE" (CDE ANIN).
// La pestana de Revit y sus tres botones: Publicar al CDE, Incidencias del CDE (abrir en Revit el elemento y la camara
// de una incidencia, y crear una desde la seleccion) y Configurar. La logica pesada esta en Extractor.cs (sin interfaz).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using WForm = System.Windows.Forms.Form;
using WComboBox = System.Windows.Forms.ComboBox;
using WTextBox = System.Windows.Forms.TextBox;
using TaskDialog = Autodesk.Revit.UI.TaskDialog;   // .NET 8+ tambien trae System.Windows.Forms.TaskDialog
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace CdeAnin
{
    public class App : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication a)
        {
            const string PESTANA = "CDE ANIN";
            try { a.CreateRibbonTab(PESTANA); } catch (Exception) { }
            var panel = a.CreateRibbonPanel(PESTANA, "Entorno Comun de Datos");
            string dll = Assembly.GetExecutingAssembly().Location;
            panel.AddItem(new PushButtonData("CdePublicar", "Publicar\nal CDE", dll, "CdeAnin.CmdPublicar") { ToolTip = "Publica este modelo al CDE: valida la nomenclatura, sube el archivo y envia el indice de parametros y la geometria liviana." });
            panel.AddItem(new PushButtonData("CdeIncidencias", "Incidencias\ndel CDE", dll, "CdeAnin.CmdIncidencias") { ToolTip = "Abre en Revit el elemento y la camara de una incidencia del CDE, o crea una desde la seleccion actual." });
            panel.AddItem(new PushButtonData("CdeConfigurar", "Configurar", dll, "CdeAnin.CmdConfigurar") { ToolTip = "Direccion del CDE y llave del complemento (la crea el administrador del proyecto en la web del CDE)." });
            return Result.Succeeded;
        }
        public Result OnShutdown(UIControlledApplication a) => Result.Succeeded;
    }

    [Transaction(TransactionMode.ReadOnly)]
    public class CmdConfigurar : IExternalCommand
    {
        public Result Execute(ExternalCommandData d, ref string msg, ElementSet els)
        {
            Config.CreaPlantilla();
            TaskDialog.Show("CDE ANIN", "Se abre el archivo de configuracion. Escribe la direccion del CDE (https://...) y pega la llave del complemento que te dio el administrador. Guarda y cierra.\n\n" + Config.Archivo);
            try { System.Diagnostics.Process.Start("notepad.exe", Config.Archivo); } catch (Exception) { }
            return Result.Succeeded;
        }
    }

    [Transaction(TransactionMode.ReadOnly)]
    public class CmdPublicar : IExternalCommand
    {
        public Result Execute(ExternalCommandData d, ref string msg, ElementSet els)
        {
            var doc = d.Application.ActiveUIDocument?.Document;
            if (doc == null) { TaskDialog.Show("CDE ANIN", "Abre un modelo primero."); return Result.Cancelled; }
            var cfg = Config.Lee();
            if (!Config.Valida(cfg)) { TaskDialog.Show("CDE ANIN", "Falta configurar el complemento (CDE ANIN → Configurar)."); return Result.Cancelled; }
            var cli = new ClienteCde(cfg);
            RespuestaProyectos rp;
            try { rp = cli.Proyectos(); } catch (Exception ex) { TaskDialog.Show("CDE ANIN", "No se pudo conectar con el CDE:\n" + ex.Message); return Result.Failed; }
            if (rp.Proyectos == null || rp.Proyectos.Count == 0) { TaskDialog.Show("CDE ANIN", "La llave no tiene proyectos asignados."); return Result.Cancelled; }

            using (var f = new FormPublicar(rp.Proyectos, cfg.UltimoProyecto, Extractor.NombreModelo(doc), cli))
            {
                if (f.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                cfg.UltimoProyecto = f.Proyecto.Id; try { Config.Guarda(cfg); } catch (Exception) { }
                var detalle = cfg.Detalle == "alto" ? ViewDetailLevel.Fine : cfg.Detalle == "bajo" ? ViewDetailLevel.Coarse : ViewDetailLevel.Medium;
                var reloj = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    // 1) el archivo: el RVT si esta en disco; si es un modelo en la nube (no hay archivo), un manifiesto .cde
                    string nombreArchivo = f.Nombre; Stream contenido; string extAviso = "";
                    bool enDisco = !doc.IsModelInCloud && !string.IsNullOrEmpty(doc.PathName) && File.Exists(doc.PathName);
                    if (enDisco) contenido = new FileStream(doc.PathName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    else { nombreArchivo = Path.ChangeExtension(nombreArchivo, ".cde"); contenido = new MemoryStream(Encoding.UTF8.GetBytes("{\"tipo\":\"manifiesto\",\"modelo\":" + ClienteCde.Cadena(doc.Title) + ",\"nube\":true,\"ruta\":" + ClienteCde.Cadena(doc.PathName) + "}")); extAviso = "\n(Modelo en la nube: se subio un manifiesto .cde en lugar del RVT; el indice y la geometria van completos.)"; }
                    string meta = "{\"revit\":" + ClienteCde.Cadena(doc.Application.VersionNumber) + ",\"titulo\":" + ClienteCde.Cadena(doc.Title) + ",\"compartido\":" + (doc.IsWorkshared ? "true" : "false") + ",\"nube\":" + (doc.IsModelInCloud ? "true" : "false") + ",\"equipo\":" + ClienteCde.Cadena(Environment.MachineName) + ",\"usuario\":" + ClienteCde.Cadena(doc.Application.Username) + "}";
                    RespuestaSubida sub; using (contenido) sub = cli.Subir(f.Proyecto.Id, nombreArchivo, contenido, f.Carpeta, meta);

                    // 2) el paquete: indice (formato del visor) + geometria liviana
                    var paq = Extractor.Extrae(doc, detalle, f.ConGeometria, t => Config.Anota(t));
                    string sid = cli.IndiceInicio(f.Proyecto.Id, sub.Version, "{\"modelos\":[" + ClienteCde.Cadena(paq.Modelo) + "],\"elementos\":" + paq.Elementos + ",\"parametros\":" + paq.Parametros + ",\"pares\":" + paq.Pares + ",\"origen\":\"complemento-revit\",\"herramienta\":\"CdeAnin Revit " + doc.Application.VersionNumber + "\"}");
                    int k = 0; foreach (var tz in paq.Trozos) { cli.IndiceTrozo(f.Proyecto.Id, sub.Version, sid, tz); k++; }
                    if (paq.RutaGeometria != null) { using (var g = File.OpenRead(paq.RutaGeometria)) cli.Geometria(f.Proyecto.Id, sub.Version, sid, g); try { File.Delete(paq.RutaGeometria); } catch (Exception) { } }
                    cli.IndiceFin(f.Proyecto.Id, sub.Version, sid);
                    reloj.Stop();
                    string r = "Publicado en " + f.Proyecto.Codigo + " como " + sub.Revision + " (version " + sub.N + ", estado " + sub.Estado + ").\n\n" +
                        paq.Elementos.ToString("N0") + " elementos, " + paq.Parametros.ToString("N0") + " parametros, " + paq.Pares.ToString("N0") + " valores en " + k + " trozos" +
                        (paq.RutaGeometria != null || paq.ConGeometria > 0 ? "; geometria: " + paq.ConGeometria.ToString("N0") + " elementos, " + paq.Triangulos.ToString("N0") + " triangulos" : "; sin geometria") +
                        ".\nTiempo: " + reloj.Elapsed.ToString(@"mm\:ss") + "." + extAviso + (paq.Avisos.Count > 0 ? "\n\nAvisos (" + paq.Avisos.Count + "): " + string.Join("; ", paq.Avisos.Take(5)) : "");
                    Config.Anota(r.Replace("\n", " "));
                    TaskDialog.Show("CDE ANIN", r);
                    return Result.Succeeded;
                }
                catch (Exception ex) { Config.Anota("ERROR publicar: " + ex); TaskDialog.Show("CDE ANIN", "No se pudo publicar:\n" + ex.Message); return Result.Failed; }
            }
        }
    }

    [Transaction(TransactionMode.ReadOnly)]
    public class CmdIncidencias : IExternalCommand
    {
        public Result Execute(ExternalCommandData d, ref string msg, ElementSet els)
        {
            var uidoc = d.Application.ActiveUIDocument; var doc = uidoc?.Document;
            if (doc == null) { TaskDialog.Show("CDE ANIN", "Abre un modelo primero."); return Result.Cancelled; }
            var cfg = Config.Lee();
            if (!Config.Valida(cfg) || string.IsNullOrEmpty(cfg.UltimoProyecto)) { TaskDialog.Show("CDE ANIN", "Configura el complemento y publica el modelo una vez (asi se sabe a que proyecto pertenece)."); return Result.Cancelled; }
            var cli = new ClienteCde(cfg);
            try
            {
                var lista = cli.Incidencias(cfg.UltimoProyecto).Incidencias ?? new List<Incidencia>();
                using (var f = new FormIncidencias(lista, uidoc.Selection.GetElementIds().Count))
                {
                    if (f.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                    if (f.Crear)
                    {
                        var sel = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).Where(e => e != null).ToList();
                        var n = new NuevaIncidencia { Titulo = f.Titulo, Descripcion = f.Descripcion, Prioridad = f.Prioridad, Elementos = sel.Select(e => new ElementoIncidencia { Modelo = Extractor.NombreModelo(doc), Uid = e.UniqueId, E = Id(e.Id) }).ToList(), Camara = CamaraActual(uidoc) };
                        cli.CreaIncidencia(cfg.UltimoProyecto, n);
                        TaskDialog.Show("CDE ANIN", "Incidencia creada en el CDE con " + sel.Count + " elemento(s).");
                        return Result.Succeeded;
                    }
                    var inc = f.Elegida; if (inc == null) return Result.Cancelled;
                    // switchback: seleccionar y mostrar los elementos; si hay camara, orientar la vista 3D activa
                    var ids = new List<ElementId>();
                    foreach (var el in inc.Elementos ?? new List<ElementoIncidencia>()) { Element e = null; if (!string.IsNullOrEmpty(el.Uid)) e = doc.GetElement(el.Uid); if (e == null && el.E > 0) e = doc.GetElement(IdDe(el.E)); if (e != null) ids.Add(e.Id); }
                    if (ids.Count > 0) { uidoc.Selection.SetElementIds(ids); uidoc.ShowElements(ids); }
                    var v3 = doc.ActiveView as View3D;
                    if (v3 != null && inc.Camara != null && inc.Camara.Pos != null && !v3.IsLocked)
                    {
                        Transform aInternas = Transform.Identity; try { aInternas = doc.ActiveProjectLocation.GetTotalTransform(); } catch (Exception) { }
                        XYZ ojo = aInternas.OfPoint(new XYZ(inc.Camara.Pos[0] / 0.3048, inc.Camara.Pos[1] / 0.3048, inc.Camara.Pos[2] / 0.3048));
                        XYZ dir = aInternas.OfVector(new XYZ(inc.Camara.Dir[0], inc.Camara.Dir[1], inc.Camara.Dir[2])).Normalize();
                        XYZ arriba = (inc.Camara.Up != null ? aInternas.OfVector(new XYZ(inc.Camara.Up[0], inc.Camara.Up[1], inc.Camara.Up[2])) : XYZ.BasisZ).Normalize();
                        arriba = (arriba - dir.Multiply(arriba.DotProduct(dir))).Normalize();   // up perpendicular a la direccion (lo exige Revit)
                        using (var t = new Transaction(doc, "CDE: camara de la incidencia")) { t.Start(); v3.SetOrientation(new ViewOrientation3D(ojo, arriba, dir)); t.Commit(); }
                        uidoc.RefreshActiveView();
                    }
                    if (ids.Count == 0) TaskDialog.Show("CDE ANIN", "La incidencia #" + inc.Numero + " no tiene elementos de este modelo (o ya no existen).");
                    return Result.Succeeded;
                }
            }
            catch (Exception ex) { TaskDialog.Show("CDE ANIN", "No se pudo con las incidencias:\n" + ex.Message); return Result.Failed; }
        }
        static Camara CamaraActual(UIDocument uidoc)
        {
            var v3 = uidoc.Document.ActiveView as View3D; if (v3 == null) return null;
            var o = v3.GetOrientation(); Transform aComp = Transform.Identity; try { aComp = uidoc.Document.ActiveProjectLocation.GetTotalTransform().Inverse; } catch (Exception) { }
            XYZ p = aComp.OfPoint(o.EyePosition), f = aComp.OfVector(o.ForwardDirection), u = aComp.OfVector(o.UpDirection);
            return new Camara { Pos = new[] { p.X * 0.3048, p.Y * 0.3048, p.Z * 0.3048 }, Dir = new[] { f.X, f.Y, f.Z }, Up = new[] { u.X, u.Y, u.Z }, Fov = 60 };
        }
        static long Id(ElementId id)
        {
#if REVIT_2024
            return id.Value;
#else
            return id.IntegerValue;
#endif
        }
        static ElementId IdDe(long n)
        {
#if REVIT_2024
            return new ElementId(n);
#else
            return new ElementId((int)n);
#endif
        }
    }

    /// <summary>Ventana de publicacion: proyecto, nombre ISO 19650 (se valida contra el CDE al escribir), carpeta, geometria.</summary>
    class FormPublicar : WForm
    {
        readonly WComboBox cbProy = new WComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
        readonly WTextBox tbNombre = new WTextBox { Width = 420 }, tbCarpeta = new WTextBox { Width = 420 };
        readonly CheckBox chkGeo = new CheckBox { Text = "Enviar geometria liviana (para verlo en el navegador sin Autodesk)", Checked = true, AutoSize = true };
        readonly Label lblVal = new Label { AutoSize = true, MaximumSize = new System.Drawing.Size(420, 0), ForeColor = System.Drawing.Color.DarkOrange };
        readonly Button ok = new Button { Text = "Publicar", DialogResult = DialogResult.OK, Enabled = false }, cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel };
        readonly ClienteCde cli;
        public Proyecto Proyecto => (Proyecto)cbProy.SelectedItem; public string Nombre => tbNombre.Text.Trim(); public string Carpeta => tbCarpeta.Text.Trim(); public bool ConGeometria => chkGeo.Checked;

        public FormPublicar(List<Proyecto> proyectos, string ultimo, string nombreSugerido, ClienteCde cliente)
        {
            cli = cliente; Text = "Publicar al CDE ANIN"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen; ClientSize = new System.Drawing.Size(460, 300); Font = new System.Drawing.Font("Segoe UI", 9f);
            foreach (var p in proyectos) cbProy.Items.Add(p);
            cbProy.SelectedIndex = Math.Max(0, proyectos.FindIndex(p => p.Id == ultimo));
            tbNombre.Text = nombreSugerido;
            var y = 12; Func<string, System.Windows.Forms.Control, int> fila = (t, c) => { Controls.Add(new Label { Text = t, Left = 16, Top = y, AutoSize = true }); c.Left = 16; c.Top = y + 18; Controls.Add(c); y += 50; return y; };
            fila("Proyecto del CDE", cbProy); fila("Nombre del contenedor (nomenclatura ISO 19650 del proyecto, con revision y extension)", tbNombre); fila("Carpeta (opcional)", tbCarpeta);
            chkGeo.Left = 16; chkGeo.Top = y; Controls.Add(chkGeo); y += 26;
            lblVal.Left = 16; lblVal.Top = y; Controls.Add(lblVal); y += 44;
            ok.Left = 280; ok.Top = 262; cancel.Left = 365; cancel.Top = 262; Controls.Add(ok); Controls.Add(cancel); AcceptButton = ok; CancelButton = cancel;
            tbNombre.TextChanged += (s, e) => Valida(); cbProy.SelectedIndexChanged += (s, e) => Valida();
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

    /// <summary>Lista de incidencias abiertas del proyecto (abrir una en Revit) o crear una desde la seleccion.</summary>
    class FormIncidencias : WForm
    {
        readonly ListBox lb = new ListBox { Width = 560, Height = 260 };
        readonly WTextBox tbT = new WTextBox { Width = 560 }, tbD = new WTextBox { Width = 560, Height = 60, Multiline = true };
        readonly WComboBox cbP = new WComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 120 };
        readonly Button bAbrir = new Button { Text = "Abrir en Revit", DialogResult = DialogResult.OK, Width = 110 }, bCrear = new Button { Text = "Crear desde la seleccion", DialogResult = DialogResult.OK, Width = 170 }, bCerrar = new Button { Text = "Cerrar", DialogResult = DialogResult.Cancel };
        public bool Crear { get; private set; } public Incidencia Elegida => lb.SelectedItem as Incidencia;
        public string Titulo => tbT.Text.Trim(); public string Descripcion => tbD.Text.Trim(); public string Prioridad => (string)cbP.SelectedItem;
        public FormIncidencias(List<Incidencia> lista, int seleccionados)
        {
            Text = "Incidencias del CDE ANIN"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen; ClientSize = new System.Drawing.Size(600, 500); Font = new System.Drawing.Font("Segoe UI", 9f);
            Controls.Add(new Label { Text = "Abiertas (" + lista.Count + "): elige una y pulsa \"Abrir en Revit\" para ir al elemento y a la camara.", Left = 16, Top = 10, AutoSize = true });
            lb.Left = 16; lb.Top = 30; foreach (var i in lista) lb.Items.Add(i); Controls.Add(lb);
            bAbrir.Left = 16; bAbrir.Top = 296; bAbrir.Enabled = false; Controls.Add(bAbrir); lb.SelectedIndexChanged += (s, e) => bAbrir.Enabled = lb.SelectedItem != null;
            Controls.Add(new Label { Text = "Nueva incidencia con los " + seleccionados + " elemento(s) seleccionados y la camara actual:", Left = 16, Top = 334, AutoSize = true });
            tbT.Left = 16; tbT.Top = 354; Controls.Add(tbT); tbD.Left = 16; tbD.Top = 382; Controls.Add(tbD);
            cbP.Left = 16; cbP.Top = 452; cbP.Items.AddRange(new object[] { "baja", "media", "alta", "critica" }); cbP.SelectedIndex = 1; Controls.Add(cbP);
            bCrear.Left = 150; bCrear.Top = 451; bCrear.Enabled = seleccionados > 0; Controls.Add(bCrear); bCrear.Click += (s, e) => { if (Titulo.Length == 0) { MessageBox.Show("Escribe el titulo."); DialogResult = DialogResult.None; return; } Crear = true; };
            bCerrar.Left = 500; bCerrar.Top = 451; Controls.Add(bCerrar); CancelButton = bCerrar;
        }
    }
}
