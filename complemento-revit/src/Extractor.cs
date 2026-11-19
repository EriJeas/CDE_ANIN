// Complemento de Revit "Publicar al CDE" (CDE ANIN).
//
// EL NUCLEO, SIN INTERFAZ: recorre el modelo abierto y produce el paquete del CDE (docs/FORMATO-PAQUETE.md):
//  1. el INDICE de parametros con el MISMO formato que exporta-indice.js del Visor BIM (elem / attrs / vals / eavd),
//     con los parametros canonicos del visor (● Modelo, ● Categoria, ● Familia, ● Tipo, ● Nivel) y todos los demas
//     parametros de ejemplar y de tipo como "Grupo / Nombre" con el valor tal como lo muestra Revit;
//  2. la GEOMETRIA liviana (.cdeg, formato 2): triangulos por elemento en metros y coordenadas COMPARTIDAS, con el color del
//     material de CADA cara (marco oscuro, vidrio, muro) y el vidrio al final de cada elemento para que el visor lo dibuje
//     translucido. Si el modelo esta georreferenciado lejos (UTM), se acerca al origen y el desplazamiento va en la cabecera.
// No muestra ventanas: lo usa el comando de Revit y, mas adelante, Design Automation (Revit en la nube, sin pantalla).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;

namespace CdeAnin
{
    public class Paquete
    {
        public List<byte[]> Trozos = new List<byte[]>();   // JSON gzip, en orden
        public string RutaGeometria;                       // archivo temporal .cdeg (null si no se pidio geometria)
        public int Elementos, Parametros, ConGeometria; public long Pares, Vertices, Triangulos;
        public string Modelo; public List<string> Avisos = new List<string>();
    }

    public static class Extractor
    {
        const int PASO_ELEM = 50000; const long PASO_PARES = 1000000;
        const double PIES_A_M = 0.3048;
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>Extrae el paquete del documento. detalle: nivel de detalle de la geometria; conGeometria=false salta la malla.</summary>
        public static Paquete Extrae(Document doc, ViewDetailLevel detalle, bool conGeometria, Action<string> avance)
        {
            var P = new Paquete { Modelo = NombreModelo(doc) };
            avance?.Invoke("Reuniendo elementos...");
            var elems = new FilteredElementCollector(doc).WhereElementIsNotElementType().WhereElementIsViewIndependent()
                .Where(e => EsElementoDeModelo(e)).ToList();
            P.Elementos = elems.Count;

            // --- indice en memoria: attr -> val -> elementos (ids de parametro y de valor unicos en todo el paquete) ---
            var attrs = new Dictionary<string, int>(); var vals = new Dictionary<string, int>();
            var eav = new Dictionary<int, Dictionary<int, List<long>>>();
            var valsNuevosPorTrozo = new List<KeyValuePair<int, string>>();   // se emiten en el trozo donde aparecen por primera vez
            int IdAttr(string k) { int a; if (!attrs.TryGetValue(k, out a)) { a = attrs.Count + 1; attrs[k] = a; eav[a] = new Dictionary<int, List<long>>(); } return a; }
            int IdVal(string t) { int v; if (!vals.TryGetValue(t, out v)) { v = vals.Count + 1; vals[t] = v; valsNuevosPorTrozo.Add(new KeyValuePair<int, string>(v, t)); } return v; }
            void Pon(long e, string k, string t)
            {
                if (string.IsNullOrEmpty(t)) return;
                int a = IdAttr(k), v = IdVal(t); List<long> l;
                if (!eav[a].TryGetValue(v, out l)) { l = new List<long>(); eav[a][v] = l; }
                if (l.Count == 0 || l[l.Count - 1] != e) l.Add(e);
            }

            // --- geometria: dos temporales (vertices e indices) y la tabla en memoria ---
            FileStream fv = null, fi = null, fc = null; BinaryWriter wv = null, wi = null;
            var tabla = new List<FilaGeo>(); long nVert = 0, nIdx = 0;
            Transform aCompartidas = Transform.Identity;
            try { aCompartidas = doc.ActiveProjectLocation.GetTotalTransform().Inverse; } catch (Exception) { }
            // georreferenciado lejos del origen (coordenadas UTM): en float32 se perderia la precision de la malla (a 9.000 km el
            // paso es de 1 m). Se resta el desplazamiento del origen interno y se guarda en la cabecera y en los metadatos.
            var origen = new double[3];
            try
            {
                XYZ o0 = aCompartidas.OfPoint(XYZ.Zero);
                double ox = o0.X * PIES_A_M, oy = o0.Y * PIES_A_M, oz = o0.Z * PIES_A_M;
                if (Math.Abs(ox) > 20000 || Math.Abs(oy) > 20000 || Math.Abs(oz) > 20000) { origen = new[] { Math.Round(ox, 3), Math.Round(oy, 3), Math.Round(oz, 3) }; P.Avisos.Add("Modelo georreferenciado: se acerco al origen para conservar la precision (desplazamiento " + string.Join(", ", origen.Select(v => v.ToString("0.00", Inv))) + " m, guardado en el paquete)"); }
            }
            catch (Exception) { }
            var opciones = new Options { DetailLevel = detalle, ComputeReferences = false, IncludeNonVisibleObjects = false };
            string tmp = Path.Combine(Path.GetTempPath(), "CdeAnin"); Directory.CreateDirectory(tmp);
            if (conGeometria) { fv = File.Create(Path.Combine(tmp, "v.bin")); fi = File.Create(Path.Combine(tmp, "i.bin")); fc = File.Create(Path.Combine(tmp, "c.bin")); wv = new BinaryWriter(fv); wi = new BinaryWriter(fi); }
            var colores = new Dictionary<string, byte[]>();   // material (o estilo de la categoria) -> rgba

            // --- el trozo de elementos (se van soltando cada 50.000) ---
            var sbElem = new StringBuilder("{\"elem\":["); int enTrozo = 0;
            void CierraElem() { if (enTrozo == 0) return; sbElem.Append("]}"); P.Trozos.Add(Gzip(sbElem.ToString())); sbElem.Clear().Append("{\"elem\":["); enTrozo = 0; }

            var niveles = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).ToList();
            var cacheTipo = new Dictionary<long, Tuple<string, string, List<string[]>>>();   // typeId -> (familia, tipo, params de tipo)
            int n = 0;
            foreach (var e in elems)
            {
                n++; if (n % 2000 == 0) avance?.Invoke("Leyendo elementos... " + n.ToString("N0", Inv) + " de " + elems.Count.ToString("N0", Inv));
                long id = Valor(e.Id);
                string cat = e.Category.Name, fam, tip; List<string[]> paramsTipo;
                Clasifica(doc, e, cacheTipo, out fam, out tip, out paramsTipo);
                string niv = NivelDe(doc, e, niveles);
                string nombre = tip + " [" + id.ToString(Inv) + "]";
                sbElem.Append(enTrozo > 0 ? "," : "").Append('[').Append(id).Append(',').Append(ClienteCde.Cadena(nombre)).Append(',').Append(ClienteCde.Cadena(P.Modelo)).Append(',')
                      .Append(ClienteCde.Cadena(cat)).Append(',').Append(ClienteCde.Cadena(fam)).Append(',').Append(ClienteCde.Cadena(tip)).Append(',').Append(ClienteCde.Cadena(niv)).Append(",1]");
                if (++enTrozo >= PASO_ELEM) CierraElem();

                Pon(id, "● Modelo", P.Modelo); Pon(id, "● Categoria", cat); Pon(id, "● Familia", fam); Pon(id, "● Tipo", tip); Pon(id, "● Nivel", niv);
                Pon(id, "Identidad / UniqueId", e.UniqueId); Pon(id, "Identidad / ElementId", id.ToString(Inv));
                try { var g = e.get_Parameter(BuiltInParameter.IFC_GUID); if (g != null && g.HasValue) Pon(id, "Identidad / IfcGUID", g.AsString()); } catch (Exception) { }
                var vistos = new HashSet<string>();
                foreach (Parameter p in e.Parameters) { var kv = Lee(doc, p); if (kv != null && vistos.Add(kv[0])) Pon(id, kv[0], kv[1]); }
                if (paramsTipo != null) foreach (var kv in paramsTipo) if (vistos.Add(kv[0])) Pon(id, kv[0], kv[1]);

                if (conGeometria)
                {
                    var fila = new FilaGeo { E = id, VertOff = nVert, IdxOff = nIdx, Color = new byte[] { 180, 180, 180, 255 } };
                    var buf = new Mallas();
                    try
                    {
                        var ge = e.get_Geometry(opciones);
                        if (ge != null) Recorre(doc, ge, Transform.Identity, aCompartidas, origen, e.Category, ElementId.InvalidElementId, colores, buf);
                    }
                    catch (Exception ex) { if (P.Avisos.Count < 50) P.Avisos.Add("Sin geometria " + nombre + ": " + ex.Message); }
                    if (buf.Op.Nv + buf.Tr.Nv > 0)
                    {
                        buf.Escribe(wv, wi, fc, fila);
                        nVert += fila.VertCount; nIdx += fila.IdxCount; tabla.Add(fila);
                    }
                }
            }
            CierraElem();

            // --- trozos de parametros: attrs + vals nuevos + eavd (elementos ordenados y en diferencias), 1 millon de pares por trozo ---
            avance?.Invoke("Empaquetando parametros...");
            var sb = new StringBuilder(); long paresTrozo = 0; var attrsTrozo = new StringBuilder(); var eavdTrozo = new StringBuilder(); int attrsEnTrozo = 0;
            var valsPorTrozo = new List<KeyValuePair<int, string>>(); var valEmitido = new HashSet<int>();
            void CierraParams()
            {
                if (attrsEnTrozo == 0) return;
                sb.Clear().Append("{\"attrs\":[").Append(attrsTrozo).Append("],\"vals\":[");
                bool prim = true; foreach (var kv in valsPorTrozo) { if (!prim) sb.Append(','); prim = false; sb.Append('[').Append(kv.Key).Append(',').Append(ClienteCde.Cadena(kv.Value)).Append(']'); }
                sb.Append("],\"eavd\":[").Append(eavdTrozo).Append("]}");
                P.Trozos.Add(Gzip(sb.ToString()));
                attrsTrozo.Clear(); eavdTrozo.Clear(); valsPorTrozo.Clear(); attrsEnTrozo = 0; paresTrozo = 0;
            }
            var textoVal = vals.ToDictionary(x => x.Value, x => x.Key);
            foreach (var kv in attrs.OrderBy(x => x.Value))
            {
                int a = kv.Value;
                attrsTrozo.Append(attrsEnTrozo > 0 ? "," : "").Append('[').Append(a).Append(',').Append(ClienteCde.Cadena(kv.Key)).Append(']'); attrsEnTrozo++;
                foreach (var ve in eav[a])
                {
                    var lista = ve.Value; lista.Sort();
                    if (valEmitido.Add(ve.Key)) valsPorTrozo.Add(new KeyValuePair<int, string>(ve.Key, textoVal[ve.Key]));
                    if (eavdTrozo.Length > 0) eavdTrozo.Append(',');
                    eavdTrozo.Append('[').Append(a).Append(',').Append(ve.Key);
                    long prev = 0; foreach (long e in lista) { eavdTrozo.Append(',').Append(e - prev); prev = e; }
                    eavdTrozo.Append(']');
                    paresTrozo += lista.Count; P.Pares += lista.Count;
                }
                if (paresTrozo >= PASO_PARES) CierraParams();
            }
            CierraParams();
            P.Parametros = attrs.Count;

            // --- el .cdeg final: cabecera + meta + tabla + vertices + indices ---
            if (conGeometria)
            {
                wv.Flush(); wi.Flush(); fv.Flush(); fi.Flush(); fc.Flush();
                avance?.Invoke("Escribiendo geometria...");
                P.RutaGeometria = Path.Combine(tmp, "geometria-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".cdeg");
                string org = "[" + string.Join(",", origen.Select(v => v.ToString("0.###", Inv))) + "]";
                string meta = "{\"modelo\":" + ClienteCde.Cadena(P.Modelo) + ",\"unidades\":\"m\",\"ejeArriba\":\"Z\",\"coordenadas\":\"compartidas\",\"origen\":" + org + ",\"herramienta\":\"CdeAnin Revit\",\"revit\":{\"version\":" + ClienteCde.Cadena(doc.Application.VersionNumber) + ",\"archivo\":" + ClienteCde.Cadena(doc.Title) + "},\"fecha\":" + ClienteCde.Cadena(DateTime.UtcNow.ToString("o")) + "}";
                byte[] mb = Encoding.UTF8.GetBytes(meta);
                using (var fs = File.Create(P.RutaGeometria)) using (var w = new BinaryWriter(fs))
                {
                    // formato 2 (docs/FORMATO-PAQUETE.md): tras los indices, icTr por elemento y el color RGB de cada vertice
                    w.Write(Encoding.ASCII.GetBytes("CDEG")); w.Write((uint)2); w.Write((uint)tabla.Count); w.Write((uint)nVert); w.Write((uint)nIdx);
                    w.Write((float)origen[0]); w.Write((float)origen[1]); w.Write((float)origen[2]); w.Write((uint)mb.Length); w.Write(mb);
                    long pos = 36 + mb.Length; while (pos % 4 != 0) { w.Write((byte)0); pos++; }
                    foreach (var f in tabla) { w.Write((uint)f.E); w.Write((uint)f.VertOff); w.Write((uint)f.VertCount); w.Write((uint)f.IdxOff); w.Write((uint)f.IdxCount); w.Write(f.Color); }
                    w.Flush(); fv.Position = 0; fv.CopyTo(fs); fi.Position = 0; fi.CopyTo(fs);
                    foreach (var f in tabla) w.Write(f.IcTr);
                    w.Flush(); fc.Position = 0; fc.CopyTo(fs);
                    long rel = nVert * 3; while (rel % 4 != 0) { fs.WriteByte(0); rel++; }
                }
                wv.Dispose(); wi.Dispose(); fc.Dispose(); try { foreach (var nom in new[] { "v.bin", "i.bin", "c.bin" }) File.Delete(Path.Combine(tmp, nom)); } catch (Exception) { }
                P.ConGeometria = tabla.Count; P.Vertices = nVert; P.Triangulos = nIdx / 3;
            }
            return P;
        }

        class FilaGeo { public long E, VertOff, IdxOff; public uint VertCount, IdxCount, IcTr; public byte[] Color; }

        /// <summary>Triangulos de una parte (opaca o vidrio) de un elemento: posiciones (m, ya sin el desplazamiento), indices relativos y color RGB por vertice.</summary>
        class Parte { public List<float> P = new List<float>(); public List<uint> I = new List<uint>(); public List<byte> C = new List<byte>(); public uint Nv; public byte[] Primero; }

        /// <summary>La malla de un elemento mientras se recorre: lo opaco primero y el vidrio al final (asi el visor sabe cuantos
        /// indices del final son translucidos, icTr). Si todo es vidrio, el elemento entero va translucido (alfa en la tabla).</summary>
        class Mallas
        {
            public Parte Op = new Parte(), Tr = new Parte();
            public void Agrega(Mesh m, Transform t, Transform aCompartidas, double[] org, byte[] rgba)
            {
                bool vidrio = rgba[3] < 230;
                var d = vidrio ? Tr : Op; if (d.Primero == null) d.Primero = rgba;
                byte r = rgba[0], g = rgba[1], b = rgba[2];
                if (vidrio && (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.78 * 255 || rgba[3] < 13)) { r = 58; g = 72; b = 88; }   // vidrio claro o invisible: azul grisaceo, como se ve una ventana desde fuera (igual que el lector IFC)
                uint baseV = d.Nv;
                foreach (XYZ p0 in m.Vertices)
                {
                    XYZ p = aCompartidas.OfPoint(t.OfPoint(p0));
                    d.P.Add((float)(p.X * PIES_A_M - org[0])); d.P.Add((float)(p.Y * PIES_A_M - org[1])); d.P.Add((float)(p.Z * PIES_A_M - org[2]));
                    d.C.Add(r); d.C.Add(g); d.C.Add(b); d.Nv++;
                }
                for (int i = 0; i < m.NumTriangles; i++)
                {
                    var tr = m.get_Triangle(i);
                    d.I.Add(baseV + tr.get_Index(0)); d.I.Add(baseV + tr.get_Index(1)); d.I.Add(baseV + tr.get_Index(2));
                }
            }
            public void Escribe(BinaryWriter wv, BinaryWriter wi, Stream wc, FilaGeo fila)
            {
                bool todoVidrio = Op.Nv == 0;
                var c0 = Op.Primero ?? Tr.Primero; fila.Color = new byte[] { c0[0], c0[1], c0[2], todoVidrio ? (byte)Math.Min((int)c0[3], 160) : (byte)255 };
                foreach (float f in Op.P) wv.Write(f); foreach (float f in Tr.P) wv.Write(f);
                foreach (uint i in Op.I) wi.Write(i); foreach (uint i in Tr.I) wi.Write(i + Op.Nv);
                var cc = Op.C.ToArray(); wc.Write(cc, 0, cc.Length); cc = Tr.C.ToArray(); wc.Write(cc, 0, cc.Length);
                fila.VertCount = Op.Nv + Tr.Nv; fila.IdxCount = (uint)(Op.I.Count + Tr.I.Count); fila.IcTr = todoVidrio ? 0u : (uint)Tr.I.Count;
            }
        }

        /// <summary>Recorre la geometria (solidos, mallas e instancias anidadas) cara por cara, cada una con el color de SU material.</summary>
        static void Recorre(Document doc, GeometryElement ge, Transform t, Transform aCompartidas, double[] org, Category cat, ElementId estiloPadre, Dictionary<string, byte[]> colores, Mallas buf)
        {
            foreach (GeometryObject o in ge)
            {
                ElementId estilo = o.GraphicsStyleId != null && o.GraphicsStyleId != ElementId.InvalidElementId ? o.GraphicsStyleId : estiloPadre;
                var inst = o as GeometryInstance;
                if (inst != null) { var sub = inst.GetSymbolGeometry(); if (sub != null) Recorre(doc, sub, t.Multiply(inst.Transform), aCompartidas, org, cat, estilo, colores, buf); continue; }
                var solido = o as Solid;
                if (solido != null && solido.Faces.Size > 0 && solido.Volume > 1e-9)
                {
                    foreach (Face cara in solido.Faces)
                    {
                        Mesh m = null; try { m = cara.Triangulate(0.3); } catch (Exception) { }
                        if (m == null || m.NumTriangles == 0) continue;
                        buf.Agrega(m, t, aCompartidas, org, ColorDe(doc, cara.MaterialElementId, estilo, cat, colores));
                    }
                    continue;
                }
                var malla = o as Mesh;
                if (malla != null && malla.NumTriangles > 0) buf.Agrega(malla, t, aCompartidas, org, ColorDe(doc, malla.MaterialElementId, estilo, cat, colores));
            }
        }

        /// <summary>Color (sombreado) y transparencia del material de una cara; sin material: el de la subcategoria (estilo grafico) o
        /// el de la categoria, como lo pinta Revit en una vista sombreada; si no hay nada, gris.</summary>
        static byte[] ColorDe(Document doc, ElementId idMat, ElementId estilo, Category cat, Dictionary<string, byte[]> cache)
        {
            string k = idMat != null && idMat != ElementId.InvalidElementId ? "m" + Valor(idMat) : "e" + (estilo != null ? Valor(estilo) : 0) + "c" + (cat != null ? Valor(cat.Id) : 0);
            byte[] c; if (cache.TryGetValue(k, out c)) return c;
            c = null;
            if (k[0] == 'm') c = DeMaterial(doc.GetElement(idMat) as Material);
            if (c == null && estilo != null && estilo != ElementId.InvalidElementId) { try { var gs = doc.GetElement(estilo) as GraphicsStyle; if (gs != null && gs.GraphicsStyleCategory != null) c = DeMaterial(gs.GraphicsStyleCategory.Material); } catch (Exception) { } }
            if (c == null && cat != null) { try { c = DeMaterial(cat.Material); } catch (Exception) { } }
            if (c == null) c = new byte[] { 180, 180, 180, 255 };
            cache[k] = c; return c;
        }
        static byte[] DeMaterial(Material mat)
        {
            if (mat == null) return null;
            var c = mat.Color; if (c == null || !c.IsValid) return null;
            return new byte[] { c.Red, c.Green, c.Blue, (byte)Math.Max(40, 255 - mat.Transparency * 255 / 100) };
        }

        static void Clasifica(Document doc, Element e, Dictionary<long, Tuple<string, string, List<string[]>>> cache, out string fam, out string tip, out List<string[]> paramsTipo)
        {
            fam = e.Category.Name; tip = "(sin tipo)"; paramsTipo = null;
            var tid = e.GetTypeId(); if (tid == null || tid == ElementId.InvalidElementId) { var fi = e as FamilyInstance; if (fi != null && fi.Symbol != null) { fam = fi.Symbol.Family.Name; tip = fi.Symbol.Name; } return; }
            long k = Valor(tid); Tuple<string, string, List<string[]>> c;
            if (!cache.TryGetValue(k, out c))
            {
                var et = doc.GetElement(tid) as ElementType; string f = e.Category.Name, tn = "(sin tipo)"; var lista = new List<string[]>();
                if (et != null)
                {
                    tn = et.Name; f = string.IsNullOrEmpty(et.FamilyName) ? e.Category.Name : et.FamilyName;
                    foreach (Parameter p in et.Parameters) { var kv = Lee(doc, p); if (kv != null) lista.Add(kv); }
                }
                c = Tuple.Create(f, tn, lista); cache[k] = c;
            }
            fam = c.Item1; tip = c.Item2; paramsTipo = c.Item3;
        }

        /// <summary>"Grupo / Nombre" y el valor tal como lo muestra Revit (con unidades); null si no hay valor.</summary>
        static string[] Lee(Document doc, Parameter p)
        {
            try
            {
                if (p == null || !p.HasValue || p.Definition == null) return null;
                string grupo;
#if REVIT_2022
                try { grupo = LabelUtils.GetLabelForGroup(p.Definition.GetGroupTypeId()); } catch (Exception) { grupo = "Otros"; }
#else
                try { grupo = LabelUtils.GetLabelFor(p.Definition.ParameterGroup); } catch (Exception) { grupo = "Otros"; }
#endif
                string v = null;
                switch (p.StorageType)
                {
                    case StorageType.String: v = p.AsString(); break;
                    case StorageType.ElementId: { var id = p.AsElementId(); if (id != null && Valor(id) > 0) { var el = doc.GetElement(id); v = el != null ? el.Name : null; } else v = p.AsValueString(); break; }
                    case StorageType.Integer: v = p.AsValueString(); if (string.IsNullOrEmpty(v)) v = p.AsInteger().ToString(Inv); break;
                    case StorageType.Double: v = p.AsValueString(); if (string.IsNullOrEmpty(v)) v = p.AsDouble().ToString("0.###", Inv); break;
                }
                if (string.IsNullOrWhiteSpace(v)) return null;
                return new[] { (string.IsNullOrEmpty(grupo) ? "Otros" : grupo) + " / " + p.Definition.Name, v.Trim() };
            }
            catch (Exception) { return null; }
        }

        static string NivelDe(Document doc, Element e, List<Level> niveles)
        {
            try { if (e.LevelId != null && Valor(e.LevelId) > 0) { var l = doc.GetElement(e.LevelId); if (l != null) return l.Name; } } catch (Exception) { }
            foreach (var bip in new[] { BuiltInParameter.FAMILY_LEVEL_PARAM, BuiltInParameter.SCHEDULE_LEVEL_PARAM, BuiltInParameter.WALL_BASE_CONSTRAINT, BuiltInParameter.RBS_START_LEVEL_PARAM, BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM, BuiltInParameter.STAIRS_BASE_LEVEL_PARAM, BuiltInParameter.ROOF_BASE_LEVEL_PARAM, BuiltInParameter.LEVEL_PARAM })
            {
                try { var p = e.get_Parameter(bip); if (p != null && p.HasValue && p.StorageType == StorageType.ElementId) { var l = doc.GetElement(p.AsElementId()); if (l is Level) return l.Name; } } catch (Exception) { }
            }
            var lv = e as Level; if (lv != null) return lv.Name;
            return "(sin nivel)";
        }

        /// <summary>Lo que el visor (traduccion de Autodesk) cuenta como ELEMENTO: categoria de modelo con geometria en 3D (o un
        /// espacio: habitacion, area), sin lineas de boceto ni contornos (categorias entre "<>"), materiales, leyendas, camaras ni vinculos.</summary>
        static bool EsElementoDeModelo(Element e)
        {
            try
            {
                var cat = e.Category;
                if (cat == null || cat.CategoryType != CategoryType.Model || e is ElementType) return false;
                string nombre = cat.Name ?? "";
                if (nombre.StartsWith("<")) return false;
                if (e is SpatialElement) return true;                          // habitaciones, areas, espacios
                if (e is RevitLinkInstance || e is Material || e is Level || e is Grid) return false;
                if (e is CurveElement && cat.Id != new ElementId(BuiltInCategory.OST_Lines)) return false;   // bocetos y lineas auxiliares
                return e.get_BoundingBox(null) != null;                         // tiene geometria en 3D
            }
            catch (Exception) { return false; }
        }

        public static string NombreModelo(Document doc) { string t = doc.Title ?? "modelo"; return t.EndsWith(".rvt", StringComparison.OrdinalIgnoreCase) ? t : t + ".rvt"; }
        static long Valor(ElementId id)
        {
#if REVIT_2024
            return id.Value;
#else
            return id.IntegerValue;
#endif
        }
        public static byte[] Gzip(string texto)
        {
            using (var ms = new MemoryStream()) { using (var gz = new GZipStream(ms, CompressionLevel.Optimal, true)) { var b = Encoding.UTF8.GetBytes(texto); gz.Write(b, 0, b.Length); } return ms.ToArray(); }
        }
    }
}
