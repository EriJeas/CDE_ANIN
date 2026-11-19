// Complemento de Navisworks "Publicar al CDE" (CDE ANIN).
//
// EL NUCLEO: recorre el modelo abierto en Navisworks (NWD, NWF o NWC, con todos sus archivos anexados) y llena el paquete del
// CDE (Paquete.cs). Elemento = el "primer objeto" de cada geometria (lo que Navisworks selecciona con la resolucion "Primer
// objeto": en un NWC de Revit, el muro, la puerta...). Clasificacion como la del visor: ● Modelo (el archivo de origen),
// ● Categoria, ● Familia, ● Tipo, ● Nivel (de las propiedades de Revit/IFC si las hay; si no, de la clase y la capa de
// Navisworks). Todas las propiedades como "Pestana / Propiedad". Geometria con la API COM (fragmentos -> triangulos en el
// mundo), en metros, con el color y la transparencia de cada geometria.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Navisworks.Api;
using ComApi = Autodesk.Navisworks.Api.Interop.ComApi;
using ComBridge = Autodesk.Navisworks.Api.ComApi.ComApiBridge;

namespace CdeAnin
{
    public static class ExtractorNavis
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>Metros por unidad del documento (las coordenadas de la API vienen en las unidades del documento).</summary>
        public static double MetrosPor(Units u)
        {
            switch (u.ToString())
            {
                case "Meters": return 1; case "Centimeters": return 0.01; case "Millimeters": return 0.001; case "Kilometers": return 1000;
                case "Feet": return 0.3048; case "Inches": return 0.0254; case "Yards": return 0.9144; case "Miles": return 1609.344;
                case "Micrometers": return 1e-6; case "Mils": return 0.0000254; case "Microinches": return 0.0000000254;
                default: return 1;
            }
        }

        public static string NombreModelo(Document doc)
        {
            string f = doc.FileName;
            if (string.IsNullOrEmpty(f)) { var m = doc.Models.FirstOrDefault(); f = m != null ? (m.SourceFileName ?? m.FileName) : "federado.nwd"; }
            return Path.GetFileName(f);
        }

        public static PaqueteCde Extrae(Document doc, bool conGeometria, OpcionesGeometria og, Action<string> avance)
        {
            var P = new PaqueteCde(); var I = new IndiceCde(P);
            double esc = MetrosPor(doc.Units);
            AnotaVista(doc, esc, avance);

            // archivos anexados: la raiz de cada uno -> nombre del archivo de origen (es el "● Modelo" de sus elementos)
            var raices = new Dictionary<ModelItem, string>();
            foreach (Model m in doc.Models)
            {
                string n = Path.GetFileName(!string.IsNullOrEmpty(m.SourceFileName) ? m.SourceFileName : m.FileName);
                // a veces el origen llega sin extension (p. ej. un IFC convertido): se usa el del archivo anexado
                if (string.IsNullOrEmpty(Path.GetExtension(n ?? "")) && !string.IsNullOrEmpty(m.FileName) && !string.IsNullOrEmpty(Path.GetExtension(m.FileName))) n = Path.GetFileName(m.FileName);
                if (string.IsNullOrEmpty(n)) n = NombreModelo(doc);
                if (m.RootItem != null && !raices.ContainsKey(m.RootItem)) raices[m.RootItem] = n;
                if (!P.Modelos.Contains(n)) P.Modelos.Add(n);
            }

            // georreferenciado lejos (UTM): se resta el centro redondeado para no perder precision en float32
            var origen = new double[3]; double diagModelo = 0; og = og ?? new OpcionesGeometria();
            try
            {
                var bb = doc.GetBoundingBox(false);
                if (bb != null && !bb.IsEmpty)
                {
                    try { var mn = bb.Min; var mx = bb.Max; diagModelo = Math.Sqrt(Math.Pow((mx.X - mn.X) * esc, 2) + Math.Pow((mx.Y - mn.Y) * esc, 2) + Math.Pow((mx.Z - mn.Z) * esc, 2)); } catch (Exception) { }
                    var c = bb.Center; double cx = c.X * esc, cy = c.Y * esc, cz = c.Z * esc;
                    if (Math.Abs(cx) > 20000 || Math.Abs(cy) > 20000 || Math.Abs(cz) > 20000)
                    {
                        origen = new[] { Math.Round(cx), Math.Round(cy), Math.Round(cz) };
                        P.Avisos.Add("Modelo georreferenciado: se acerco al origen para conservar la precision (desplazamiento " + string.Join(", ", origen.Select(v => v.ToString("0.00", Inv))) + " m, guardado en el paquete)");
                    }
                }
            }
            catch (Exception) { }

            // 1) Recorrido del arbol en profundidad: el primer objeto COMPUESTO desde arriba es el elemento (en un NWC de Revit, la
            //    instancia: muro, puerta...) y todas las geometrias debajo de el son suyas; una geometria sin objeto compuesto encima
            //    es un elemento por si misma. Aqui se leen las PROPIEDADES de cada elemento y se anotan sus geometrias (sin pedir
            //    triangulos). El acero de refuerzo (barras, mallas, acopladores: millones de barras redondas) va solo con propiedades
            //    y sus barras se saltan.
            // 2) Geometria, de los elementos mas grandes a los mas chicos, con un tiempo maximo: lo que no alcanza a leerse va como
            //    cajas (la caja de cada pieza), asi la publicacion de un federado enorme no se va a horas.
            avance?.Invoke("Leyendo el modelo...");
            var reloj = System.Diagnostics.Stopwatch.StartNew(); long ultimo = 0, nodos = 0, nGeo = 0, id = 0, menores = 0, nAcero = 0;
            // rejilla comun: 1/20.000 de la diagonal del modelo, entre 1 mm y CeldaMax (medio 5 mm, bajo 12 mm): fina, para no romper
            // letras, perfiles ni mastiles; lo que sobra lo quita despues el colapso de aristas con tolerancia
            double celda = og.DivisorCelda > 0 && diagModelo > 0 && og.CeldaMax > 0 ? Math.Max(0.001, Math.Min(og.CeldaMax, diagModelo / og.DivisorCelda)) : 0;
            // los elementos se simplifican y se guardan en otros hilos mientras Navisworks sigue entregando triangulos (se dejan dos
            // nucleos para Navisworks y Windows)
            GeometriaCde G = conGeometria ? new GeometriaCde(origen) { TopePorElemento = og.TopePorElemento, Celda = celda, TopeTotal = og.TopeTotal, Avance = avance, Hilos = Math.Max(1, Math.Min(6, Environment.ProcessorCount - 2)), TopeLineas = og.TopeLineas, Tolerancia = og.Tolerancia } : null;
            if (G != null) avance?.Invoke("Geometria: modelo de " + diagModelo.ToString("N0", Inv) + " m, rejilla " + (celda * 1000).ToString("0.#", Inv) + " mm, diferencia maxima " + (og.Tolerancia * 100).ToString("0.#", Inv) + " cm, tope " + og.TopePorElemento.ToString("N0", Inv) + " por elemento y " + og.TopeTotal.ToString("N0", Inv) + " en total, " + (og.MinutosTotal > 0 ? og.MinutosTotal + " min como maximo para todo" : "sin limite de tiempo (todo con su forma)") + ", " + G.Hilos + " hilos para aligerar" + (og.OmitirAcero ? ", acero de refuerzo solo con propiedades" : "") + (og.Normales ? ", normales de Navisworks" : ""));
            var lector = G != null ? new LectorMallas(esc, G, og.Normales) : null; long tProp = 0, tCls = 0, tNodo = 0, tComp = 0, tHijos = 0, tHojas = 0, tBarra = 0, tCaja = 0, ultBarra = 0;
            Progress barra = null; try { barra = Autodesk.Navisworks.Api.Application.BeginProgress("CDE ANIN", "Publicando al CDE: propiedades y geometria"); } catch (Exception) { }
            int nModelos = Math.Max(1, doc.Models.Count), iModelo = 0; string modeloActual = null;
            var pendientes = new List<Pendiente>();
            var cache = new Dictionary<string, string>();   // nombres ya normalizados (se repiten en todos los elementos)
            var pestanas = new Dictionary<string, long[]>(); long ultPest = 0;

            Func<string> Tiempos = () => " | tiempos: propiedades " + LectorMallas.Seg(tProp).ToString("0", Inv) + " s, clasificacion " + LectorMallas.Seg(tCls).ToString("0", Inv) + " s, arbol " + LectorMallas.Seg(tNodo).ToString("0", Inv) + " s (recorrido " + LectorMallas.Seg(tHijos).ToString("0", Inv) + " s, tipo de nodo " + LectorMallas.Seg(tComp).ToString("0", Inv) + " s)" + (tHojas > 0 ? ", geometrias del elemento " + LectorMallas.Seg(tHojas).ToString("0", Inv) + " s" : "") + ", barra de avance " + LectorMallas.Seg(tBarra).ToString("0", Inv) + " s" + (tCaja > 0 ? ", cajas " + LectorMallas.Seg(tCaja).ToString("0", Inv) + " s" : "") +
                (lector == null ? "" : ", rutas y fragmentos " + LectorMallas.Seg(lector.TFrag).ToString("0", Inv) + " s, triangulos de Navisworks " + LectorMallas.Seg(lector.TGen).ToString("0", Inv) + " s, proceso " + LectorMallas.Seg(lector.TProc).ToString("0", Inv) + " s");
            Action Cancela = () => { throw new OperationCanceledException("Publicacion cancelada en Navisworks (el archivo ya subido queda como version sin indice)."); };
            // la barra de avance de Navisworks se actualiza como mucho una vez por segundo (cada actualizacion deja a Navisworks
            // atender la ventana, y eso tiene su costo)
            Action<double> Barra = (f) =>
            {
                if (barra == null || reloj.ElapsedMilliseconds - ultBarra < 1000) return;
                ultBarra = reloj.ElapsedMilliseconds; long t = System.Diagnostics.Stopwatch.GetTimestamp();
                bool sigue = barra.Update(f); tBarra += System.Diagnostics.Stopwatch.GetTimestamp() - t;
                if (!sigue) Cancela();
            };
            // propiedades e indice de un elemento; devuelve su categoria
            Func<ModelItem, string> registra = (e) =>
            {
                id++; long tp0 = System.Diagnostics.Stopwatch.GetTimestamp();
                var props = Propiedades(e, esc, pestanas);
                long tp1 = System.Diagnostics.Stopwatch.GetTimestamp(); tProp += tp1 - tp0;
                var cl = Clasifica(e, modeloActual, props, cache);
                string nombre = cl.Tipo + " [" + (cl.IdOrigen ?? id.ToString(Inv)) + "]";
                I.Elemento(id, nombre, cl.Modelo, cl.Categoria, cl.Familia, cl.Tipo, cl.Nivel);
                I.Pon(id, "Identidad / Navisworks", id.ToString(Inv));
                if (cl.IdOrigen != null) I.Pon(id, "Identidad / ElementId", cl.IdOrigen);
                try { if (e.InstanceGuid != Guid.Empty) I.Pon(id, "Identidad / GUID", e.InstanceGuid.ToString()); } catch (Exception) { }
                foreach (var pr in props) I.Pon(id, pr.Grupo + " / " + pr.Nombre, pr.Valor);
                tCls += System.Diagnostics.Stopwatch.GetTimestamp() - tp1;
                Barra(Math.Min(0.49, 0.5 * (iModelo + Math.Min(0.95, id / (id + 2000.0))) / nModelos));
                if (reloj.ElapsedMilliseconds - ultPest > 60000) { ultPest = reloj.ElapsedMilliseconds; avance?.Invoke("Pestanas: " + string.Join("; ", pestanas.OrderByDescending(x => x.Value[2]).Take(12).Select(x => x.Key + " " + x.Value[0].ToString("N0", Inv) + " elem, " + x.Value[1].ToString("N0", Inv) + " valores, " + LectorMallas.Seg(x.Value[2]).ToString("0", Inv) + " s"))); }
                if (reloj.ElapsedMilliseconds - ultimo > 10000) { ultimo = reloj.ElapsedMilliseconds; avance?.Invoke("Propiedades... " + nodos.ToString("N0", Inv) + " nodos, " + id.ToString("N0", Inv) + " elementos (" + nAcero.ToString("N0", Inv) + " de acero de refuerzo, sin geometria) (" + reloj.Elapsed.ToString(@"h\:mm\:ss") + ")" + Tiempos()); }
                return cl.Categoria;
            };
            // Recorrido en UNA pasada por DescendantsAndSelf (preorden). Pedir los hijos de cada nodo (Children) o su padre (Parent)
            // cuesta milisegundos por nodo en un federado grande; avanzar el recorrido, microsegundos. Un compuesto es un elemento y
            // sus descendientes se cuentan y se saltan de una vez; una geometria sin compuesto encima es un elemento por si misma;
            // lo demas son grupos (archivo, nivel, categoria, familia, tipo). El acero de refuerzo se reconoce por su categoria.
            // No se guarda ningun ModelItem entre una pasada y otra (cada uno retiene memoria nativa y, por miles, vuelve lenta a
            // la recoleccion de memoria): se anota la POSICION del elemento en el recorrido y en la geometria se vuelve a recorrer.
            long orden = 0;
            Action<ModelItem, int> recorre = (raiz, im) =>
            {
                var it = raiz.DescendantsAndSelf.GetEnumerator(); long pos = 0;
                while (true)
                {
                    long t0 = System.Diagnostics.Stopwatch.GetTimestamp(); bool hay = it.MoveNext();
                    long t1 = System.Diagnostics.Stopwatch.GetTimestamp(); tHijos += t1 - t0; tNodo += t1 - t0;
                    if (!hay) break;
                    pos++; var n = it.Current; nodos++;
                    bool compuesto = false; try { compuesto = n.IsComposite; } catch (Exception) { }
                    bool geo = false; if (!compuesto) try { geo = n.HasGeometry; } catch (Exception) { }
                    long t2 = System.Diagnostics.Stopwatch.GetTimestamp(); tComp += t2 - t1; tNodo += t2 - t1;
                    if (!compuesto && !geo) { Suelta(n); continue; }   // grupo
                    string cat = registra(n);
                    if (og.OmitirAcero && EsAcero(cat)) nAcero++;
                    else if (G != null) pendientes.Add(new Pendiente { Id = id, Modelo = im, Pos = pos, Compuesto = compuesto, Rango = Rango(cat), Lineas = !LineaAuxiliar(cat), ColorLineas = EsVegetacion(cat), Orden = orden++ });
                    if (compuesto)
                    {
                        // lo de abajo de un compuesto es suyo: se cuentan sus descendientes y se saltan sin preguntar nada por cada uno
                        long t4 = System.Diagnostics.Stopwatch.GetTimestamp(); long saltar = 0;
                        try { var e2 = n.Descendants.GetEnumerator(); while (e2.MoveNext()) saltar++; } catch (Exception) { }
                        for (long q = 0; q < saltar && it.MoveNext(); q++) { nodos++; pos++; }
                        long d4 = System.Diagnostics.Stopwatch.GetTimestamp() - t4; tHijos += d4; tNodo += d4;
                    }
                    Suelta(n);
                }
            };
            // las geometrias de un elemento compuesto (el y todo lo de abajo)
            Action<ModelItem, List<ModelItem>> hojasDe = (n, l) =>
            {
                long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                try { foreach (ModelItem x in n.DescendantsAndSelf) { bool g = false; try { g = x.HasGeometry; } catch (Exception) { } if (g) l.Add(x); else Suelta(x); } } catch (Exception) { }
                tHojas += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
            };
            try
            {
                var modelos = new List<Model>(); foreach (Model m in doc.Models) modelos.Add(m);
                for (int im = 0; im < modelos.Count; im++)
                {
                    var m = modelos[im];
                    if (m.RootItem != null) { string mn; modeloActual = raices.TryGetValue(m.RootItem, out mn) ? mn : null; recorre(m.RootItem, im); }
                    iModelo++;
                }
                avance?.Invoke("Arbol leido: " + nodos.ToString("N0", Inv) + " nodos, " + id.ToString("N0", Inv) + " elementos, " + nAcero.ToString("N0", Inv) + " de acero de refuerzo sin geometria (" + reloj.Elapsed.ToString(@"h\:mm\:ss") + ")" + Tiempos());
                avance?.Invoke("Empaquetando parametros...");
                I.Termina();
                if (G != null)
                {
                    // 2) geometria: primero lo que da forma al edificio (muros, losas, techos, columnas, vigas), luego puertas y ventanas,
                    //    equipos y mobiliario, tuberias y ductos, y al final accesorios y piezas chicas. Con el tiempo que queda del total;
                    //    lo que no alcanza va como la caja del elemento.
                    long tope = og.MinutosTotal > 0 ? Math.Max(3 * 60000L, og.MinutosTotal * 60000L - reloj.ElapsedMilliseconds) : 0; int k = 0, nCajas = 0; ultimo = 0;
                    // con muchos elementos, la rejilla comun se agranda (raiz de elementos / 40.000) pero nunca pasa de CeldaMax: antes
                    // llegaba a 6 cm y deformaba lo delgado. Las piezas que se omiten por chicas siguen midiendose con la rejilla original.
                    // en un modelo grande cada elemento se aligera al cerrarlo (colapso de aristas de hasta 1 cm, en los otros hilos):
                    // el aligerado del final casi no tiene trabajo
                    if (og.CeldaMax > 0 && og.TopeTotal > 0 && pendientes.Count > 40000) G.AligeraAlLeer = true;
                    if (G.Celda > 0 && G.Celda < og.CeldaMax && pendientes.Count > 40000)
                    {
                        G.Celda = Math.Min(og.CeldaMax, Math.Max(G.Celda, celda * Math.Sqrt(pendientes.Count / 40000.0)));
                        avance?.Invoke("Rejilla comun para " + pendientes.Count.ToString("N0", Inv) + " elementos: " + (G.Celda * 1000).ToString("0.#", Inv) + " mm");
                    }
                    G.Sigue = () => barra == null || barra.Update(0.995);
                    var rg = System.Diagnostics.Stopwatch.StartNew();
                    avance?.Invoke("Geometria de " + pendientes.Count.ToString("N0", Inv) + " elementos" + (tope > 0 ? ", " + (tope / 60000.0).ToString("0.#", Inv) + " min como maximo" : "") + " (" + reloj.Elapsed.ToString(@"h\:mm\:ss") + ")");
                    int nDistintos = 0, nGrandes = 0; long msGrandes = 0;
                    Action<ModelItem, Pendiente> geometria = (e, pe) =>
                    {
                        k++; G.Empieza(pe.Id);
                        bool cajas = tope > 0 && rg.ElapsedMilliseconds > tope;
                        // fuera de tiempo, un elemento voluminoso (las dos medidas mayores de su caja pasan de 1 m: una torre de
                        // comunicaciones, un equipo grande) se lee igual: como caja se veia un bloque de 15 x 16 x 21 m. Los alargados
                        // (tuberias, bandejas) y los chicos si van como caja. Como mucho 3 min de mas.
                        if (cajas && msGrandes < 180000)
                            try
                            {
                                var bb = e.BoundingBox();
                                if (bb != null && !bb.IsEmpty)
                                {
                                    double[] dm = { (bb.Max.X - bb.Min.X) * esc, (bb.Max.Y - bb.Min.Y) * esc, (bb.Max.Z - bb.Min.Z) * esc }; Array.Sort(dm);
                                    if (dm[1] > 1.0) { cajas = false; nGrandes++; }
                                }
                            }
                            catch (Exception) { }
                        long tGr = cajas || rg.ElapsedMilliseconds <= tope || tope <= 0 ? -1 : rg.ElapsedMilliseconds;
                        try
                        {
                            bool comp = false; try { comp = e.IsComposite; } catch (Exception) { }
                            if (comp != pe.Compuesto) { nDistintos++; return; }   // el recorrido no coincidio (no deberia pasar)
                            if (cajas) { long tc = System.Diagnostics.Stopwatch.GetTimestamp(); Caja(e, esc, G); tCaja += System.Diagnostics.Stopwatch.GetTimestamp() - tc; nCajas++; }
                            else
                            {
                                var hojas = new List<ModelItem>(); if (pe.Compuesto) hojasDe(e, hojas); else hojas.Add(e);
                                nGeo += hojas.Count;
                                lector.Lineas = pe.Lineas; lector.ColorLineas = pe.ColorLineas;
                                foreach (var g in hojas) { if (!lector.Malla(g, celda * 2)) menores++; if (g != e) Suelta(g); }
                                lector.Lineas = false; lector.ColorLineas = false;
                            }
                        }
                        catch (Exception ex) { if (P.Avisos.Count < 50) P.Avisos.Add("Sin geometria del elemento " + pe.Id.ToString(Inv) + ": " + ex.Message); }
                        if (tGr >= 0) msGrandes += rg.ElapsedMilliseconds - tGr;
                        Barra(0.5 + 0.49 * k / pendientes.Count);
                        if (rg.ElapsedMilliseconds - ultimo > 10000) { ultimo = rg.ElapsedMilliseconds; avance?.Invoke("Geometria... " + k.ToString("N0", Inv) + " de " + pendientes.Count.ToString("N0", Inv) + " elementos, " + nGeo.ToString("N0", Inv) + " geometrias, " + G.Triangulos.ToString("N0", Inv) + " triangulos leidos, " + G.Guardados.ToString("N0", Inv) + " quedan, " + menores.ToString("N0", Inv) + " piezas menores omitidas, " + (G.SegmentosLeidos > 0 ? G.SegmentosLeidos.ToString("N0", Inv) + " segmentos de lineas, " : "") + lector.Reutilizadas.ToString("N0", Inv) + " instancias reutilizadas (" + lector.TriReutilizados.ToString("N0", Inv) + " triangulos sin pedir)" + (nCajas > 0 ? ", " + nCajas.ToString("N0", Inv) + " como cajas" : "") + " (" + reloj.Elapsed.ToString(@"h\:mm\:ss") + ")" + Tiempos()); }
                    };
                    // por rango (0 primero) y, dentro, modelo por modelo: se recorre el modelo avanzando sin preguntar nada y solo se
                    // toma el nodo en la posicion de cada elemento pendiente
                    for (int r = 0; r <= 4; r++)
                        for (int im = 0; im < modelos.Count; im++)
                        {
                            var lista = pendientes.Where(x => x.Rango == r && x.Modelo == im).OrderBy(x => x.Pos).ToList();
                            if (lista.Count == 0 || modelos[im].RootItem == null) continue;
                            var it = modelos[im].RootItem.DescendantsAndSelf.GetEnumerator(); long pos = 0; int j = 0;
                            long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                            while (j < lista.Count && it.MoveNext())
                            {
                                pos++; if (pos != lista[j].Pos) continue;
                                tHijos += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
                                var e = it.Current; geometria(e, lista[j]); Suelta(e); j++;
                                t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                            }
                        }
                    if (nDistintos > 0) P.Avisos.Add(nDistintos.ToString("N0", Inv) + " elementos sin geometria: el recorrido del modelo no coincidio");
                    avance?.Invoke("Geometria leida: " + G.Triangulos.ToString("N0", Inv) + " triangulos, " + nCajas.ToString("N0", Inv) + " elementos como cajas (" + reloj.Elapsed.ToString(@"h\:mm\:ss") + ")" + Tiempos());
                    avance?.Invoke("Escribiendo geometria...");
                    string org = "[" + string.Join(",", origen.Select(GeometriaCde.NumeroJson)) + "]";
                    string meta = "{\"modelo\":" + ClienteCde.Cadena(NombreModelo(doc)) + ",\"modelos\":[" + string.Join(",", P.Modelos.Select(ClienteCde.Cadena)) + "],\"unidades\":\"m\",\"ejeArriba\":\"Z\",\"coordenadas\":\"navisworks\",\"origen\":" + org +
                                  ",\"herramienta\":\"CdeAnin Navisworks\",\"fecha\":" + ClienteCde.Cadena(DateTime.UtcNow.ToString("o")) + "}";
                    P.RutaGeometria = G.Escribe(meta, P);
                    if (P.Segmentos > 0) P.Avisos.Insert(0, "Dibujos en lineas (arboles, escudos): " + P.ConLineas.ToString("N0", Inv) + " elementos, " + G.SegmentosLeidos.ToString("N0", Inv) + " segmentos leidos → " + P.Segmentos.ToString("N0", Inv));
                    if (P.Aristas > 0) P.Avisos.Insert(0, "Aristas precalculadas para el visor: " + P.Aristas.ToString("N0", Inv) + " (se ven al abrir el modelo)");
                    if (G.Simplificados > 0 || G.Triangulos > P.Triangulos || menores > 0) P.Avisos.Insert(0, "Geometria aligerada para el navegador: " + G.Triangulos.ToString("N0", Inv) + " triangulos leidos de Navisworks → " + P.Triangulos.ToString("N0", Inv) + " (" + G.Simplificados.ToString("N0", Inv) + " elementos simplificados; " + menores.ToString("N0", Inv) + " piezas menores de " + (celda * 2000).ToString("0.#", Inv) + " mm omitidas; rejilla " + (celda * 1000).ToString("0.#", Inv) + " mm)");
                    if (nCajas > 0) P.Avisos.Insert(0, nCajas.ToString("N0", Inv) + " elementos (accesorios y piezas chicas, al final de la cola) van como cajas: se cumplio el tiempo maximo de la publicacion (" + og.MinutosTotal + " min; \"minutos\" en complemento.json)" + (nGrandes > 0 ? "; los " + nGrandes.ToString("N0", Inv) + " voluminosos de esa cola (torres, equipos grandes) se leyeron igual" : ""));
                }
                if (nAcero > 0) P.Avisos.Insert(0, nAcero.ToString("N0", Inv) + " elementos de acero de refuerzo van solo con propiedades, sin geometria (\"acero\": \"incluir\" en complemento.json para dibujarlos)");
            }
            finally { if (G != null) G.Dispose(); if (barra != null) try { Autodesk.Navisworks.Api.Application.EndProgress(); } catch (Exception) { } }
            return P;
        }

        static byte A255(double v) => (byte)Math.Max(0, Math.Min(255, Math.Round(v * 255)));

        /// <summary>Lee las mallas de Navisworks. Lo que tarda es la API COM: cada triangulo llega en una llamada. Por eso:
        /// - una geometria compartida por instancias (el mismo accesorio, perno, colgador o mueble repetido) se le pide a
        ///   Navisworks UNA sola vez, se guarda en coordenadas locales y se reutiliza para las demas instancias con su matriz
        ///   (antes, cada instancia volvia a recorrer los fragmentos de todas: miles de instancias = millones de llamadas);
        /// - en la llamada solo se copian las coordenadas (sin conversiones); el paso al mundo, la rejilla y la simplificacion
        ///   se hacen despues, con el fragmento completo.
        /// Lleva la cuenta del tiempo de cada parte para el registro.</summary>
        internal class LectorMallas : ComApi.InwSimplePrimitivesCB
        {
            readonly double esc; readonly GeometriaCde G; readonly bool normales; readonly int paso;
            double[] buf = new double[1 << 16]; int n;
            /// <summary>true mientras se lee un elemento cuyas lineas tambien se copian (todos salvo ejes y lineas auxiliares).</summary>
            public bool Lineas;
            /// <summary>true en la vegetacion: se pide el color de cada linea.</summary>
            public bool ColorLineas;
            double[] bufL = new double[1 << 12]; int nL;   // por segmento: 6 coordenadas + color r, g, b (0..1; -1 = sin color)
            // el color por vertice se pide solo para las lineas de la vegetacion (en los arboles CAD 3D cada linea trae el suyo; el
            // color de la geometria sale blanco). Se busca por nombre: si esta version de la API no lo tiene, sin color propio.
            static readonly ComApi.nwEVertexProperty PropColor = Enum.IsDefined(typeof(ComApi.nwEVertexProperty), "eCOLOR") ? (ComApi.nwEVertexProperty)Enum.Parse(typeof(ComApi.nwEVertexProperty), "eCOLOR") : (ComApi.nwEVertexProperty)0;
            class Geo { public double[] D, L; public int Refs; public long Largo => D.Length + (L != null ? L.Length : 0); }
            class Pendiente { public Geo[] Geos; public double[][] M; }
            readonly Dictionary<string, Pendiente> instancias = new Dictionary<string, Pendiente>();
            long enCache; const long TopeCache = 64L * 1024 * 1024;   // dobles guardados para instancias (512 MB como mucho)
            public long Reutilizadas, TriReutilizados, TFrag, TGen, TProc;

            public LectorMallas(double esc, GeometriaCde g, bool normales) { this.esc = esc; G = g; this.normales = normales; paso = normales ? 18 : 9; }
            public static double Seg(long ticks) => ticks / (double)System.Diagnostics.Stopwatch.Frequency;

            /// <summary>false si la pieza es menor que 'minimo' (m) y no se leyo.</summary>
            public bool Malla(ModelItem g, double minimo)
            {
                // una pieza menor que dos celdas de la rejilla (tornillos, arandelas) desapareceria igual: ni se le piden los triangulos
                if (minimo > 0)
                    try
                    {
                        var bb = g.BoundingBox();
                        if (bb != null && !bb.IsEmpty)
                        {
                            double dx = (bb.Max.X - bb.Min.X) * esc, dy = (bb.Max.Y - bb.Min.Y) * esc, dz = (bb.Max.Z - bb.Min.Z) * esc;
                            if (Math.Sqrt(dx * dx + dy * dy + dz * dz) < minimo) return false;
                        }
                    }
                    catch (Exception) { }
                byte[] rgba = new byte[] { 180, 180, 180, 255 };
                try
                {
                    var mg = g.Geometry;
                    if (mg != null)
                    {
                        var c = mg.OriginalColor; double t = mg.OriginalTransparency;
                        if (c != null) rgba = new byte[] { A255(c.R), A255(c.G), A255(c.B), (byte)Math.Max(40, Math.Round(255 * (1 - t))) };
                    }
                }
                catch (Exception) { }
                long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                ComApi.InwOaPath ruta = ComBridge.ToInwOaPath(g);
                string clave = Clave((Array)(object)ruta.ArrayData);
                Pendiente p;
                if (instancias.TryGetValue(clave, out p))
                {
                    // otra instancia de una geometria ya leida: sin pedirle nada mas a Navisworks
                    instancias.Remove(clave); TFrag += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
                    long t1 = System.Diagnostics.Stopwatch.GetTimestamp();
                    for (int i = 0; i < p.Geos.Length; i++)
                    {
                        var geo = p.Geos[i]; Emite(geo.D, geo.D.Length, p.M[i], rgba); TriReutilizados += geo.D.Length / paso;
                        if (geo.L != null) EmiteLineas(geo.L, geo.L.Length, p.M[i], rgba);
                        if (--geo.Refs == 0) enCache -= geo.Largo;
                    }
                    Reutilizadas++; TProc += System.Diagnostics.Stopwatch.GetTimestamp() - t1;
                    return true;
                }
                // fragmentos de la geometria, agrupados por ruta: los de esta ruta y, si es compartida, los de cada instancia
                var grupos = new Dictionary<string, List<ComApi.InwOaFragment3>>(); var orden = new List<string>();
                foreach (ComApi.InwOaFragment3 f in ruta.Fragments())
                {
                    string k = Clave((Array)(object)f.path.ArrayData); List<ComApi.InwOaFragment3> l;
                    if (!grupos.TryGetValue(k, out l)) { grupos[k] = l = new List<ComApi.InwOaFragment3>(); orden.Add(k); }
                    l.Add(f);
                }
                List<ComApi.InwOaFragment3> mios;
                if (!grupos.TryGetValue(clave, out mios)) { TFrag += System.Diagnostics.Stopwatch.GetTimestamp() - t0; return true; }
                bool compartida = grupos.Count > 1 && enCache < TopeCache;
                var geos = compartida ? new Geo[mios.Count] : null;
                var prop = normales ? ComApi.nwEVertexProperty.eNORMAL : (ComApi.nwEVertexProperty)0;   // 0: solo posiciones
                if (ColorLineas) prop |= PropColor;
                for (int i = 0; i < mios.Count; i++)
                {
                    double[] M = Matriz(mios[i]);
                    long t1 = System.Diagnostics.Stopwatch.GetTimestamp(); TFrag += t1 - t0;
                    n = 0; nL = 0; mios[i].GenerateSimplePrimitives(prop, this);
                    long t2 = System.Diagnostics.Stopwatch.GetTimestamp(); TGen += t2 - t1;
                    Emite(buf, n, M, rgba); if (nL > 0) EmiteLineas(bufL, nL, M, rgba);
                    if (compartida)
                    {
                        var d = new double[n]; Array.Copy(buf, d, n); double[] dl = null; if (nL > 0) { dl = new double[nL]; Array.Copy(bufL, dl, nL); }
                        geos[i] = new Geo { D = d, L = dl };
                    }
                    t0 = System.Diagnostics.Stopwatch.GetTimestamp(); TProc += t0 - t2;
                }
                if (compartida)
                {
                    foreach (string k in orden)
                    {
                        if (k == clave) continue; var l = grupos[k]; if (l.Count != mios.Count) continue;
                        var pm = new double[l.Count][]; for (int j = 0; j < l.Count; j++) pm[j] = Matriz(l[j]);
                        instancias[k] = new Pendiente { Geos = geos, M = pm };
                        foreach (var geo in geos) { if (geo.Refs++ == 0) enCache += geo.Largo; }
                    }
                }
                TFrag += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
                return true;
            }

            static string Clave(Array a)
            {
                if (a == null) return "";
                var sb = new StringBuilder(a.Length * 4); int lb = a.GetLowerBound(0);
                for (int i = 0; i < a.Length; i++) { if (i > 0) sb.Append(','); sb.Append(Convert.ToString(a.GetValue(lb + i), Inv)); }
                return sb.ToString();
            }

            static double[] Matriz(ComApi.InwOaFragment3 f)
            {
                var m = (ComApi.InwLTransform3f3)(object)f.GetLocalToWorldMatrix();
                var a = (Array)(object)m.Matrix; var M = new double[16];
                int lb = a.GetLowerBound(0); for (int i = 0; i < 16; i++) M[i] = Convert.ToDouble(a.GetValue(lb + i), Inv);
                // Navisworks entrega la matriz por columnas (traslacion en 12-14); si llegara por filas (traslacion en 3, 7, 11), se traspone
                if (Math.Abs(M[12]) + Math.Abs(M[13]) + Math.Abs(M[14]) == 0 && Math.Abs(M[3]) + Math.Abs(M[7]) + Math.Abs(M[11]) > 0)
                    for (int r = 0; r < 4; r++) for (int c = r + 1; c < 4; c++) { double t = M[r * 4 + c]; M[r * 4 + c] = M[c * 4 + r]; M[c * 4 + r] = t; }
                return M;
            }

            /// <summary>Pasa al mundo (en metros) los triangulos locales de un fragmento y se los da a la geometria del CDE.</summary>
            void Emite(double[] D, int N, double[] M, byte[] rgba)
            {
                for (int q = 0; q + paso <= N; q += paso)
                {
                    double[] a = Mundo(D, q, M), b = Mundo(D, q + 3, M), c = Mundo(D, q + 6, M);
                    if (normales) { G.Triangulo(a, b, c, Normal(D, q + 9, M), Normal(D, q + 12, M), Normal(D, q + 15, M), rgba); continue; }
                    // la normal de la cara, calculada aqui (no se le pide a Navisworks)
                    double ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
                    double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    double[] nn = l > 1e-18 ? new[] { nx / l, ny / l, nz / l } : null;
                    G.Triangulo(a, b, c, nn, nn, nn, rgba);
                }
            }
            /// <summary>Pasa al mundo los segmentos de linea locales de un fragmento (vegetacion).</summary>
            void EmiteLineas(double[] D, int N, double[] M, byte[] rgba)
            {
                byte[] c = null;
                for (int q = 0; q + 9 <= N; q += 9)
                {
                    if (D[q + 6] >= 0) { c = c ?? new byte[4]; c[0] = A255(D[q + 6]); c[1] = A255(D[q + 7]); c[2] = A255(D[q + 8]); c[3] = 255; }
                    G.Linea(Mundo(D, q, M), Mundo(D, q + 3, M), D[q + 6] >= 0 ? c : rgba);
                }
            }
            double[] Mundo(double[] D, int i, double[] M)
            {
                double x = D[i], y = D[i + 1], z = D[i + 2];
                // matriz de Navisworks por columnas: la traslacion va en 12, 13, 14
                return new[] { (M[0] * x + M[4] * y + M[8] * z + M[12]) * esc, (M[1] * x + M[5] * y + M[9] * z + M[13]) * esc, (M[2] * x + M[6] * y + M[10] * z + M[14]) * esc };
            }
            static double[] Normal(double[] D, int i, double[] M)
            {
                double x = D[i], y = D[i + 1], z = D[i + 2];
                double nx = M[0] * x + M[4] * y + M[8] * z, ny = M[1] * x + M[5] * y + M[9] * z, nz = M[2] * x + M[6] * y + M[10] * z, l = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                return l > 1e-12 ? new[] { nx / l, ny / l, nz / l } : null;
            }

            // ---- llamadas de Navisworks: solo se copian las coordenadas ----
            void Copia(object o)
            {
                if (n + 3 > buf.Length) Array.Resize(ref buf, buf.Length * 2);
                var a = o as Array;
                if (a == null || a.Length < 3) { buf[n] = buf[n + 1] = buf[n + 2] = 0; n += 3; return; }
                int lb = a.GetLowerBound(0); var t = a.GetType().GetElementType();
                if (t == typeof(float) || t == typeof(double)) Array.Copy(a, lb, buf, n, 3);   // sin cajas ni conversiones
                else { buf[n] = Convert.ToDouble(a.GetValue(lb), Inv); buf[n + 1] = Convert.ToDouble(a.GetValue(lb + 1), Inv); buf[n + 2] = Convert.ToDouble(a.GetValue(lb + 2), Inv); }
                n += 3;
            }
            public void Triangle(ComApi.InwSimpleVertex v1, ComApi.InwSimpleVertex v2, ComApi.InwSimpleVertex v3)
            {
                Copia(v1.coord); Copia(v2.coord); Copia(v3.coord);
                if (normales) { CopiaNormal(v1); CopiaNormal(v2); CopiaNormal(v3); }
            }
            void CopiaNormal(ComApi.InwSimpleVertex v) { object o = null; try { o = v.normal; } catch (Exception) { } Copia(o); }
            public void Line(ComApi.InwSimpleVertex v1, ComApi.InwSimpleVertex v2)
            {
                if (!Lineas) return;
                // se copian con el mismo Copia (que escribe en buf/n) y se pasan a bufL, con el color del primer extremo
                int n0 = n; Copia(v1.coord); Copia(v2.coord);
                if (nL + 9 > bufL.Length) Array.Resize(ref bufL, bufL.Length * 2);
                Array.Copy(buf, n0, bufL, nL, 6); n = n0;
                double r = -1, g = -1, b = -1;
                if (ColorLineas && PropColor != 0)
                    try { var a = v1.color as Array; if (a != null && a.Length >= 3) { int lb = a.GetLowerBound(0); r = Convert.ToDouble(a.GetValue(lb), Inv); g = Convert.ToDouble(a.GetValue(lb + 1), Inv); b = Convert.ToDouble(a.GetValue(lb + 2), Inv); } } catch (Exception) { r = g = b = -1; }
                bufL[nL + 6] = r; bufL[nL + 7] = g; bufL[nL + 8] = b; nL += 9;
            }
            public void Point(ComApi.InwSimpleVertex v1) { }
            public void SnapPoint(ComApi.InwSimpleVertex v1) { }
        }

        class Clase { public string Modelo, Categoria, Familia, Tipo, Nivel, IdOrigen; }
        class Prop { public string Grupo, Nombre, Valor; public bool DeNavis; }

        /// <summary>Las propiedades de un elemento, leidas UNA vez (leerlas es lo que mas tarda en un federado grande).</summary>
        static List<Prop> Propiedades(ModelItem e, double esc, Dictionary<string, long[]> pestanas)
        {
            var l = new List<Prop>();
            foreach (PropertyCategory pc in e.PropertyCategories)
            {
                long t0 = System.Diagnostics.Stopwatch.GetTimestamp(); int n0 = l.Count;
                string interno = pc.Name; if (Omitida(interno)) continue;
                bool deNavis = interno == "LcOaNode"; string grupo = pc.DisplayName;
                foreach (DataProperty dp in pc.Properties)
                {
                    string v = null; try { v = Texto(dp.Value, esc); } catch (Exception) { }
                    if (!string.IsNullOrWhiteSpace(v)) l.Add(new Prop { Grupo = grupo, Nombre = dp.DisplayName, Valor = v, DeNavis = deNavis });
                }
                // para el registro: cuanto pesa cada pestana (nombre interno y visible)
                string k = interno + " (" + grupo + ")"; long[] a; if (!pestanas.TryGetValue(k, out a)) pestanas[k] = a = new long[3];
                a[0]++; a[1] += l.Count - n0; a[2] += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
            }
            return l;
        }

        /// <summary>Pestanas que no se leen: la apariencia de los materiales (decenas de valores por elemento que nadie filtra:
        /// colores, texturas, reflejos) y los datos del archivo, iguales en todos los elementos. Era casi la mitad del tiempo.</summary>
        static bool Omitida(string interno) =>
            interno != null && (interno.IndexOf("Material", StringComparison.OrdinalIgnoreCase) >= 0 || interno == "Document" || interno == "StackedWallOwnerId");

        /// <summary>El valor como texto. Los numeros se escriben aqui (en metros, m², m³ y grados): pedirle a Navisworks el texto
        /// formateado de cada valor es lo mas lento de leer propiedades.</summary>
        static string Texto(VariantData v, double esc)
        {
            if (v == null) return null;
            switch (v.DataType)
            {
                case VariantDataType.None: return null;
                case VariantDataType.DisplayString: return v.ToDisplayString();
                case VariantDataType.IdentifierString: return v.ToIdentifierString();
                case VariantDataType.Int32: return v.ToInt32().ToString(Inv);
                case VariantDataType.Boolean: return v.ToBoolean() ? "Si" : "No";
                case VariantDataType.Double: return Num(v.ToDouble());
                case VariantDataType.DoubleLength: return Num(v.ToDoubleLength() * esc) + " m";
                case VariantDataType.DoubleArea: return Num(v.ToDoubleArea() * esc * esc) + " m²";
                case VariantDataType.DoubleVolume: return Num(v.ToDoubleVolume() * esc * esc * esc) + " m³";
                case VariantDataType.DoubleAngle: return Num(v.ToDoubleAngle() * 180 / Math.PI) + "°";
                default: return v.ToDisplayString();
            }
        }
        static string Num(double d) => Math.Abs(d) >= 1e15 || double.IsNaN(d) ? d.ToString("G6", Inv) : Math.Round(d, 3).ToString("0.###", Inv);

        /// <summary>Acero de refuerzo (Revit en espanol o ingles, IFC): barras, mallas, refuerzo de area o de camino, acopladores.</summary>
        static bool EsAcero(string s)
        {
            if (string.IsNullOrEmpty(s)) return false; s = s.ToLowerInvariant();
            return s.Contains("armadura") || s.Contains("refuerzo") || s.Contains("rebar") || s.Contains("reinforc") || s.Contains("acoplador") || s.Contains("coupler");
        }

        class Pendiente { public long Id, Orden, Pos; public int Modelo, Rango; public bool Compuesto, Lineas, ColorLineas; }
        /// <summary>Suelta ya la memoria nativa de un ModelItem (si no, se acumulan miles a la espera de la recoleccion).</summary>
        static void Suelta(ModelItem m) { try { if (m != null) m.Dispose(); } catch (Exception) { } }
        /// <summary>Orden de la geometria por categoria (Revit en espanol o ingles, IFC): 0 lo que da forma al edificio ... 4 accesorios.</summary>
        /// <summary>Anota en el registro la vista actual de Navisworks (posicion en metros y rotacion), para poner la misma camara en
        /// el visor del CDE y comparar. Por reflexion: si esta version de la API no la expone asi, no se anota nada.</summary>
        static void AnotaVista(Document doc, double esc, Action<string> avance)
        {
            try
            {
                Func<object, string, object> prop = (o, n) => o?.GetType().GetProperty(n)?.GetValue(o, null);
                Func<object, string, double> num = (o, n) => { var v = prop(o, n); return v == null ? double.NaN : Convert.ToDouble(v, Inv); };
                object vp = prop(prop(doc, "CurrentViewpoint"), "Value"); if (vp == null) return;
                object pos = prop(vp, "Position"), rot = prop(vp, "Rotation");
                avance?.Invoke("Vista de Navisworks: posicion (m) " + (num(pos, "X") * esc).ToString("0.###", Inv) + ", " + (num(pos, "Y") * esc).ToString("0.###", Inv) + ", " + (num(pos, "Z") * esc).ToString("0.###", Inv)
                    + "; rotacion (A, B, C, D) " + num(rot, "A").ToString("0.######", Inv) + ", " + num(rot, "B").ToString("0.######", Inv) + ", " + num(rot, "C").ToString("0.######", Inv) + ", " + num(rot, "D").ToString("0.######", Inv)
                    + "; campo vertical " + num(vp, "HeightField").ToString("0.####", Inv) + " | " + rot);
            }
            catch (Exception) { }
        }

        /// <summary>Categorias cuyas lineas no se leen: ejes, lineas de centro de tuberias y ductos, lineas de modelo y del modelo
        /// analitico (en Navisworks son ayudas de dibujo; en el CDE solo ensuciarian la vista). Las demas lineas si: los arboles
        /// "CAD 3D" de Revit y los escudos o dibujos importados en familias llegan a Navisworks solo como lineas.</summary>
        static bool LineaAuxiliar(string cat)
        {
            string c = (cat ?? "").ToLowerInvariant();
            return c.Length == 0 || c.Contains("eje") || c.Contains("grid") || c.Contains("center line") || c.Contains("centerline") || c.Contains("linea de centro") || c.Contains("línea de centro")
                || c.Contains("analit") || c.Contains("analyt") || c == "lines" || c == "lineas" || c == "líneas" || c.Contains("separa") || c.Contains("boundary") || c.Contains("contorno");
        }
        /// <summary>Vegetacion (Planting / Plantas / Entourage): a sus lineas tambien se les pide el color propio (en los arboles
        /// CAD 3D cada linea trae el suyo y el de la geometria sale blanco).</summary>
        static bool EsVegetacion(string cat)
        {
            string c = (cat ?? "").ToLowerInvariant();
            return c.Contains("plant") || c.Contains("vegeta") || c.Contains("entourage") || c.Contains("arbol") || c.Contains("árbol");
        }
        static int Rango(string cat)
        {
            string c = (cat ?? "").ToLowerInvariant();
            Func<string[], bool> hay = (ps) => ps.Any(x => c.Contains(x));
            if (hay(new[] { "accesorio", "fitting", "union", "dispositivo", "device", "terminal", "rociador", "sprinkler", "colgador", "hanger", "soporte", "support", "aislamiento", "insulation", "revestimiento", "lining", "etiqueta", "tag" })) return 4;
            if (hay(new[] { "tuberia", "tubería", "pipe", "conducto", "duct", "bandeja", "cable tray", "tubo", "conduit", "flex" })) return 3;
            if (hay(new[] { "equipo", "equipment", "aparato", "fixture", "luminaria", "lighting", "mobiliario", "furniture", "casework", "modelo generico", "modelo genérico", "generic", "especial", "specialty", "plant", "entourage", "ambiente", "habitacion", "habitación", "room", "space", "espacio" })) return 2;
            if (hay(new[] { "puerta", "door", "ventana", "window", "rampa", "ramp" })) return 1;
            return 0;   // muros, suelos, losas, cubiertas, techos, pilares, armazon, cimentacion, escaleras, barandillas, muro cortina, topografia...
        }
        /// <summary>La caja de un elemento (12 triangulos, con el color de su primera geometria), para lo que no alcanzo el tiempo.</summary>
        static void Caja(ModelItem e, double esc, GeometriaCde G)
        {
            var b = e.BoundingBox(); if (b == null || b.IsEmpty) return;
            byte[] c = { 180, 180, 180, 255 };
            try { var mg = e.FindFirstGeometry(); if (mg != null && mg.OriginalColor != null) c = new byte[] { A255(mg.OriginalColor.R), A255(mg.OriginalColor.G), A255(mg.OriginalColor.B), (byte)Math.Max(40, Math.Round(255 * (1 - mg.OriginalTransparency))) }; } catch (Exception) { }
            double x0 = b.Min.X * esc, y0 = b.Min.Y * esc, z0 = b.Min.Z * esc, x1 = b.Max.X * esc, y1 = b.Max.Y * esc, z1 = b.Max.Z * esc;
            double[][] v = { new[] { x0, y0, z0 }, new[] { x1, y0, z0 }, new[] { x1, y1, z0 }, new[] { x0, y1, z0 }, new[] { x0, y0, z1 }, new[] { x1, y0, z1 }, new[] { x1, y1, z1 }, new[] { x0, y1, z1 } };
            int[][] caras = { new[] { 0, 3, 2, 1 }, new[] { 4, 5, 6, 7 }, new[] { 0, 1, 5, 4 }, new[] { 2, 3, 7, 6 }, new[] { 1, 2, 6, 5 }, new[] { 3, 0, 4, 7 } };
            double[][] nn = { new[] { 0.0, 0, -1 }, new[] { 0.0, 0, 1 }, new[] { 0.0, -1, 0 }, new[] { 0.0, 1, 0 }, new[] { 1.0, 0, 0 }, new[] { -1.0, 0, 0 } };
            for (int k = 0; k < 6; k++) { var f = caras[k]; G.Triangulo(v[f[0]], v[f[1]], v[f[2]], nn[k], nn[k], nn[k], c); G.Triangulo(v[f[0]], v[f[2]], v[f[3]], nn[k], nn[k], nn[k], c); }
        }

        // nombres de pestanas y propiedades como los muestra Navisworks en espanol o en ingles (se comparan sin tildes)
        static readonly string[] P_CATEGORIA = { "categoria", "category" }, P_FAMILIA = { "familia", "family", "nombre de familia", "family name" },
            P_TIPO = { "tipo", "type", "nombre de tipo", "type name" }, P_NIVEL = { "nivel", "level", "nivel de referencia", "reference level", "restriccion de base", "base constraint" },
            P_CAPA = { "capa", "layer" }, T_ID = { "id. de elemento", "id de elemento", "element id" }, P_VALOR = { "valor", "value" };

        /// <summary>Clasificacion como la del visor. Primero las propiedades de la aplicacion de origen (Revit, IFC); la pestana
        /// "Elemento"/"Item" de Navisworks (LcOaNode) solo da la capa, que en un NWC de Revit es el nivel.</summary>
        static Clase Clasifica(ModelItem e, string modelo, List<Prop> props, Dictionary<string, string> cache)
        {
            var c = new Clase { Modelo = modelo };
            string capa = null;
            foreach (var p in props)
            {
                string n = LlanoC(p.Nombre, cache), v = p.Valor;
                if (p.DeNavis) { if (capa == null && P_CAPA.Contains(n)) capa = v; continue; }
                if (T_ID.Contains(LlanoC(p.Grupo, cache)) && P_VALOR.Contains(n)) { if (c.IdOrigen == null) c.IdOrigen = v; continue; }
                if (c.Categoria == null && P_CATEGORIA.Contains(n)) c.Categoria = v;
                else if (c.Familia == null && P_FAMILIA.Contains(n)) c.Familia = v;
                else if (c.Tipo == null && P_TIPO.Contains(n)) c.Tipo = v;
                else if (c.Nivel == null && P_NIVEL.Contains(n)) c.Nivel = v;
            }
            string clase = null; try { clase = e.ClassDisplayName; } catch (Exception) { }
            if (c.Categoria == null) c.Categoria = !string.IsNullOrEmpty(clase) ? clase : "(sin categoria)";
            if (c.Familia == null) c.Familia = !string.IsNullOrEmpty(clase) ? clase : c.Categoria;
            if (c.Tipo == null) c.Tipo = !string.IsNullOrEmpty(e.DisplayName) ? e.DisplayName : c.Familia;
            if (c.Nivel == null) c.Nivel = capa ?? "(sin nivel)";
            if (c.Modelo == null) c.Modelo = "(modelo)";
            return c;
        }
        static string LlanoC(string s, Dictionary<string, string> cache) { string r; if (s == null) return ""; if (!cache.TryGetValue(s, out r)) cache[s] = r = Llano(s); return r; }
        static string Llano(string s) => new string((s ?? "").Normalize(NormalizationForm.FormD).Where(ch => CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark).ToArray()).Trim().ToLowerInvariant();
    }
}
