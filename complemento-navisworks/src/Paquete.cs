// Complemento de Navisworks "Publicar al CDE" (CDE ANIN).
// El PAQUETE del CDE (docs/FORMATO-PAQUETE.md), sin nada de Navisworks: el indice de parametros en el formato del Visor BIM
// (elem / attrs / vals / eavd, trozos JSON gzip) y la geometria .cdeg formato 2 (color por vertice, vidrio al final de cada
// elemento, desplazamiento de origen para modelos georreferenciados). Lo llena ExtractorNavis.cs; se puede probar sin Navisworks.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

namespace CdeAnin
{
    public class PaqueteCde
    {
        public List<byte[]> Trozos = new List<byte[]>();
        public string RutaGeometria;
        public int Elementos, Parametros, ConGeometria, ConLineas; public long Pares, Vertices, Triangulos, Segmentos, Aristas;
        public List<string> Modelos = new List<string>(); public List<string> Avisos = new List<string>();
    }

    /// <summary>Arma el indice: elementos con su clasificacion y los pares (parametro, valor) -> elementos.</summary>
    public class IndiceCde
    {
        const int PASO_ELEM = 50000; const long PASO_PARES = 1000000;
        readonly PaqueteCde P;
        readonly Dictionary<string, int> attrs = new Dictionary<string, int>(), vals = new Dictionary<string, int>();
        readonly Dictionary<int, Dictionary<int, List<long>>> eav = new Dictionary<int, Dictionary<int, List<long>>>();
        readonly StringBuilder sbElem = new StringBuilder("{\"elem\":["); int enTrozo = 0;
        public IndiceCde(PaqueteCde p) { P = p; }

        public void Elemento(long e, string nombre, string modelo, string cat, string fam, string tip, string niv)
        {
            sbElem.Append(enTrozo > 0 ? "," : "").Append('[').Append(e).Append(',').Append(ClienteCde.Cadena(nombre)).Append(',').Append(ClienteCde.Cadena(modelo)).Append(',')
                  .Append(ClienteCde.Cadena(cat)).Append(',').Append(ClienteCde.Cadena(fam)).Append(',').Append(ClienteCde.Cadena(tip)).Append(',').Append(ClienteCde.Cadena(niv)).Append(",1]");
            if (++enTrozo >= PASO_ELEM) CierraElem();
            Pon(e, "● Modelo", modelo); Pon(e, "● Categoria", cat); Pon(e, "● Familia", fam); Pon(e, "● Tipo", tip); Pon(e, "● Nivel", niv);
            P.Elementos++;
        }
        void CierraElem() { if (enTrozo == 0) return; sbElem.Append("]}"); P.Trozos.Add(Gzip(sbElem.ToString())); sbElem.Clear().Append("{\"elem\":["); enTrozo = 0; }

        public void Pon(long e, string k, string t)
        {
            if (string.IsNullOrWhiteSpace(t) || string.IsNullOrWhiteSpace(k)) return;
            t = t.Trim(); if (t.Length > 2000) t = t.Substring(0, 2000);
            int a; if (!attrs.TryGetValue(k, out a)) { a = attrs.Count + 1; attrs[k] = a; eav[a] = new Dictionary<int, List<long>>(); }
            int v; if (!vals.TryGetValue(t, out v)) { v = vals.Count + 1; vals[t] = v; }
            List<long> l; if (!eav[a].TryGetValue(v, out l)) { l = new List<long>(); eav[a][v] = l; }
            if (l.Count == 0 || l[l.Count - 1] != e) l.Add(e);
        }

        /// <summary>Cierra los trozos: elementos pendientes y luego attrs + vals + eavd (elementos ordenados y en diferencias).</summary>
        public void Termina()
        {
            CierraElem();
            var sb = new StringBuilder(); long paresTrozo = 0; var attrsTrozo = new StringBuilder(); var eavdTrozo = new StringBuilder(); int attrsEnTrozo = 0;
            var valsTrozo = new List<KeyValuePair<int, string>>(); var emitido = new HashSet<int>(); var texto = vals.ToDictionary(x => x.Value, x => x.Key);
            Action cierra = () =>
            {
                if (attrsEnTrozo == 0) return;
                sb.Clear().Append("{\"attrs\":[").Append(attrsTrozo).Append("],\"vals\":[");
                bool prim = true; foreach (var kv in valsTrozo) { if (!prim) sb.Append(','); prim = false; sb.Append('[').Append(kv.Key).Append(',').Append(ClienteCde.Cadena(kv.Value)).Append(']'); }
                sb.Append("],\"eavd\":[").Append(eavdTrozo).Append("]}");
                P.Trozos.Add(Gzip(sb.ToString()));
                attrsTrozo.Clear(); eavdTrozo.Clear(); valsTrozo.Clear(); attrsEnTrozo = 0; paresTrozo = 0;
            };
            foreach (var kv in attrs.OrderBy(x => x.Value))
            {
                int a = kv.Value;
                attrsTrozo.Append(attrsEnTrozo > 0 ? "," : "").Append('[').Append(a).Append(',').Append(ClienteCde.Cadena(kv.Key)).Append(']'); attrsEnTrozo++;
                foreach (var ve in eav[a])
                {
                    var lista = ve.Value; lista.Sort();
                    if (emitido.Add(ve.Key)) valsTrozo.Add(new KeyValuePair<int, string>(ve.Key, texto[ve.Key]));
                    if (eavdTrozo.Length > 0) eavdTrozo.Append(',');
                    eavdTrozo.Append('[').Append(a).Append(',').Append(ve.Key);
                    long prev = 0; foreach (long e in lista) { eavdTrozo.Append(',').Append(e - prev); prev = e; }
                    eavdTrozo.Append(']');
                    paresTrozo += lista.Count; P.Pares += lista.Count;
                }
                if (paresTrozo >= PASO_PARES) cierra();
            }
            cierra();
            P.Parametros = attrs.Count;
        }

        public static byte[] Gzip(string texto)
        {
            using (var ms = new MemoryStream()) { using (var gz = new GZipStream(ms, CompressionLevel.Optimal, true)) { var b = Encoding.UTF8.GetBytes(texto); gz.Write(b, 0, b.Length); } return ms.ToArray(); }
        }
    }

    /// <summary>Cuanto detalle viaja al navegador (de "detalle" en complemento.json). Medio (por defecto): el modelo igual al de
    /// Navisworks, con una diferencia de 1 cm como mucho y todos los elementos con su forma (sin cajas por tiempo): lo que se vea
    /// o se mida en el CDE (interferencias incluidas) no debe dar falsos positivos por el aligerado.</summary>
    public class OpcionesGeometria
    {
        public int TopePorElemento = 20000; public double DivisorCelda = 20000; public long TopeTotal = 4000000; public bool Normales;
        /// <summary>Diferencia maxima (m) entre la superficie de Navisworks y la del CDE que admite el aligerado (colapso de
        /// aristas). Medio 1 cm; bajo 5 cm (mas liviano, para revisar rapido); alto 5 mm.</summary>
        public double Tolerancia = 0.01;
        /// <summary>Rejilla comun maxima (m). Los vertices se juntan en ella al leer: una rejilla gruesa (antes llegaba a 1,3 cm o
        /// mas) rompia letras, perfiles de ventana, mastiles y hojas de arboles. El aligerado fino lo hace despues el colapso de
        /// aristas con tolerancia, que respeta la forma.</summary>
        public double CeldaMax = 0.002;
        /// <summary>Tope de segmentos de linea por elemento (arboles CAD 3D de Revit, escudos y dibujos en lineas).</summary>
        public int TopeLineas = 20000;
        /// <summary>Minutos como maximo para toda la publicacion: lo que no alcanza a leerse de geometria va como la caja del
        /// elemento (primero se lee lo que da forma al edificio). 0 = sin limite (por defecto en medio: una caja es un falso
        /// positivo seguro en interferencias).</summary>
        public int MinutosTotal = 0;
        /// <summary>El acero de refuerzo va solo con propiedades (no se dibuja: son millones de barras redondas).</summary>
        public bool OmitirAcero = true;
        public static OpcionesGeometria De(string detalle, int minutos = 0, string acero = null)
        {
            OpcionesGeometria o;
            switch ((detalle ?? "").ToLowerInvariant())
            {
                case "alto": o = new OpcionesGeometria { TopePorElemento = 40000, DivisorCelda = 0, CeldaMax = 0, TopeTotal = 10000000, TopeLineas = 40000, Tolerancia = 0.005, Normales = true, MinutosTotal = 0 }; break;
                case "bajo": o = new OpcionesGeometria { TopePorElemento = 6000, DivisorCelda = 8000, CeldaMax = 0.012, TopeTotal = 2000000, TopeLineas = 1500, Tolerancia = 0.05, MinutosTotal = 12 }; break;
                default: o = new OpcionesGeometria(); break;
            }
            if (minutos > 0) o.MinutosTotal = minutos;
            if (string.Equals(acero, "incluir", StringComparison.OrdinalIgnoreCase)) o.OmitirAcero = false;
            return o;
        }
    }

    /// <summary>Escribe el .cdeg formato 2 por elementos: lo opaco primero y el vidrio al final de cada uno (icTr), color RGB por
    /// vertice, posiciones en metros ya sin el desplazamiento de origen. Vertices e indices van a temporales en disco.</summary>
    public class GeometriaCde : IDisposable
    {
        class Fila { public long E, VertOff, IdxOff, AOff; public uint VertCount, IdxCount, IcTr, VertOp, ACount; public byte[] Color; public bool TodoVidrio; }
        class Parte
        {
            public List<float> P = new List<float>(); public List<uint> I = new List<uint>(); public List<byte> C = new List<byte>(); public uint Nv; public byte[] Primero;
            public Dictionary<VerticeClave, uint> Unicos = new Dictionary<VerticeClave, uint>();
        }
        public struct VerticeClave : IEquatable<VerticeClave>
        {
            public int X, Y, Z, NX, NY, NZ; public byte R, G, B;
            public bool Equals(VerticeClave o) => X == o.X && Y == o.Y && Z == o.Z && NX == o.NX && NY == o.NY && NZ == o.NZ && R == o.R && G == o.G && B == o.B;
            public override bool Equals(object o) => o is VerticeClave && Equals((VerticeClave)o);
            public override int GetHashCode() { unchecked { int h = X; h = h * 397 ^ Y; h = h * 397 ^ Z; h = h * 31 ^ NX; h = h * 31 ^ NY; h = h * 31 ^ NZ; return h * 31 ^ (R << 16 | G << 8 | B); } }
        }

        /// <summary>Hash de claves long que mezcla todos los bits. El de .NET (parte alta XOR parte baja) da casi el mismo valor
        /// para las aristas (a,b) de vertices vecinos (indices seguidos): con decenas de miles de aristas el diccionario se volvia
        /// cuadratico (un arbol de 60.000 triangulos tardaba 25 s en prepararse; con esto, decimas de segundo).</summary>
        sealed class MezclaLong : IEqualityComparer<long>
        {
            public static readonly MezclaLong Uno = new MezclaLong();
            public bool Equals(long a, long b) => a == b;
            public int GetHashCode(long k) { unchecked { ulong x = (ulong)k; x ^= x >> 33; x *= 0xff51afd7ed558ccdUL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53UL; x ^= x >> 33; return (int)x; } }
        }

        readonly string tmp; readonly FileStream fv, fi, fc; readonly BinaryWriter wv, wi;
        readonly List<Fila> tabla = new List<Fila>(); long nVert, nIdx;
        Parte op, tr; long eActual = -1;
        // lineas (vegetacion dibujada con lineas): por elemento, posiciones (6 por segmento, ya sin el origen) y color (3 por segmento)
        class FilaL { public long E, Off; public uint N; public byte[] Color; }
        readonly List<FilaL> tablaL = new List<FilaL>(); long nSeg; List<float> lP; List<byte> lC; FileStream flv, flc;
        /// <summary>Tope de segmentos de linea por elemento: si se pasa, se juntan los extremos cercanos (rejilla creciente).</summary>
        public int TopeLineas = 4000;
        public long Segmentos => nSeg; public long SegmentosLeidos;
        /// <summary>Diferencia maxima (m) que admite el aligerado (ver OpcionesGeometria.Tolerancia).</summary>
        public double Tolerancia = 0.01;
        /// <summary>Aristas precalculadas (pares de vertices) que viajan en el .cdeg: el visor las muestra de entrada, sin calcularlas.</summary>
        public long Aristas => nAris;
        long nAris;
        public readonly double[] Origen;
        long triangulos; public long Triangulos => triangulos;   // los ya recibidos (para el avance)
        public long Guardados => nIdx / 3 + (op != null ? (op.I.Count + tr.I.Count) / 3 : 0);   // los que van quedando
        /// <summary>Tope de triangulos por elemento: los mas densos (equipos y mobiliario de fabricante, mallas importadas) se
        /// simplifican agrupando vertices cercanos. 0 = sin tope.</summary>
        public int TopePorElemento = 25000;
        /// <summary>Celda (m) de la rejilla comun a todo el modelo: los vertices mas cercanos que esto se juntan y los triangulos
        /// menores desaparecen (tornillos, rotulos, detalles de fabricante). 0 = sin rejilla.</summary>
        public double Celda;
        /// <summary>Tope de triangulos de todo el modelo: si se pasa, al final se simplifican los elementos mas pesados hasta
        /// entrar (es lo que el navegador puede dibujar con soltura). 0 = sin tope.</summary>
        public long TopeTotal;
        public int Simplificados; public long TriangulosAntes, TriangulosSinTope;
        public Action<string> Avance;
        /// <summary>Se consulta de vez en cuando en las pasadas largas: false = cancelar.</summary>
        public Func<bool> Sigue;
        double tolPasada;   // tolerancia (m) de la pasada del tope total
        const int Liviano = 24;   // los elementos de hasta 24 triangulos (cajas, placas) no se tocan en el tope total

        public GeometriaCde(double[] origen)
        {
            Origen = origen ?? new double[3];
            tmp = Path.Combine(Path.GetTempPath(), "CdeAnin", "navis-" + DateTime.Now.ToString("yyyyMMdd-HHmmss")); Directory.CreateDirectory(tmp);
            fv = File.Create(Path.Combine(tmp, "v.bin")); fi = File.Create(Path.Combine(tmp, "i.bin")); fc = File.Create(Path.Combine(tmp, "c.bin"));
            wv = new BinaryWriter(fv); wi = new BinaryWriter(fi);
        }

        public void Empieza(long e) { Cierra(); eActual = e; op = new Parte(); tr = new Parte(); lP = null; lC = null; }

        /// <summary>Un segmento de linea en metros (coordenadas del mundo). Solo para la vegetacion dibujada con lineas: los
        /// arboles "CAD 3D" de Revit llegan a Navisworks como miles de lineas y ningun triangulo.</summary>
        public void Linea(double[] a, double[] b, byte[] rgba)
        {
            if (eActual < 0) return;
            SegmentosLeidos++;
            if (Celda > 0 && Celda3(a) == Celda3(b)) return;   // menor que la celda
            if (lP == null) { lP = new List<float>(); lC = new List<byte>(); }
            lP.Add((float)(a[0] - Origen[0])); lP.Add((float)(a[1] - Origen[1])); lP.Add((float)(a[2] - Origen[2]));
            lP.Add((float)(b[0] - Origen[0])); lP.Add((float)(b[1] - Origen[1])); lP.Add((float)(b[2] - Origen[2]));
            lC.Add(rgba[0]); lC.Add(rgba[1]); lC.Add(rgba[2]);
        }

        /// <summary>Un triangulo en metros (coordenadas del mundo, sin restar aun el origen), con normales y el color rgba de su parte.</summary>
        public void Triangulo(double[] a, double[] b, double[] c, double[] na, double[] nb, double[] nc, byte[] rgba)
        {
            bool vidrio = rgba[3] < 230;
            var d = vidrio ? tr : op; if (d.Primero == null) d.Primero = rgba;
            byte r = rgba[0], g = rgba[1], bl = rgba[2];   // el vidrio con su color de Navisworks (antes el claro se pintaba azul oscuro: las ventanas se veian negras)
            triangulos++;
            if (Celda > 0)
            {
                long ka = Celda3(a), kb = Celda3(b), kc = Celda3(c);
                if (ka == kb || kb == kc || ka == kc) return;   // menor que la celda: no se veria en el navegador
            }
            d.I.Add(Vertice(d, a, na, r, g, bl)); d.I.Add(Vertice(d, b, nb, r, g, bl)); d.I.Add(Vertice(d, c, nc, r, g, bl));
        }
        readonly HashSet<long> tocados = new HashSet<long>();   // elementos ya contados como simplificados
        long Celda3(double[] p)
        {
            long x = (long)Math.Floor((p[0] - Origen[0]) / Celda), y = (long)Math.Floor((p[1] - Origen[1]) / Celda), z = (long)Math.Floor((p[2] - Origen[2]) / Celda);
            return (x & 0x1FFFFF) << 42 | (y & 0x1FFFFF) << 21 | (z & 0x1FFFFF);
        }
        uint Vertice(Parte d, double[] p, double[] n, byte r, byte g, byte b)
        {
            float x = (float)(p[0] - Origen[0]), y = (float)(p[1] - Origen[1]), z = (float)(p[2] - Origen[2]);
            // se comparten los vertices iguales (posicion a 0,1 mm, o a la celda comun si la hay; normal y color): la malla pesa menos
            // y las aristas vivas siguen vivas. Con celda, el vertice que queda es el primero que cayo en ella.
            double q = Celda > 0 ? 1 / Celda : 10000;
            var k = new VerticeClave { X = (int)Math.Floor(x * q), Y = (int)Math.Floor(y * q), Z = (int)Math.Floor(z * q), R = r, G = g, B = b };
            // la normal solo separa vertices en aristas vivas: se agrupa en pasos de ~30 grados, asi una superficie curva (tubo,
            // esfera) comparte sus vertices y se ve lisa (antes cada triangulo curvo llevaba 3 vertices propios: el triple de peso)
            if (n != null) { k.NX = (int)Math.Round(n[0] * 2); k.NY = (int)Math.Round(n[1] * 2); k.NZ = (int)Math.Round(n[2] * 2); }
            uint i; if (d.Unicos.TryGetValue(k, out i)) return i;
            i = d.Nv++; d.Unicos[k] = i; d.P.Add(x); d.P.Add(y); d.P.Add(z); d.C.Add(r); d.C.Add(g); d.C.Add(b);
            return i;
        }

        // ---------- simplificacion en paralelo ----------
        /// <summary>Hilos que simplifican y guardan cada elemento mientras Navisworks sigue entregando triangulos (0 = todo en el
        /// hilo que llama). Navisworks solo se usa desde su hilo; estos hilos solo trabajan con listas propias.</summary>
        public int Hilos;
        /// <summary>Colapso de aristas de hasta 1 cm a cada elemento (de mas de 24 triangulos) al cerrarlo: en un modelo grande el
        /// aligerado del final casi no tiene trabajo (antes era una pasada de 6 min despues de leer todo).</summary>
        public bool AligeraAlLeer;
        class Trabajo { public long E; public Parte Op, Tr; public List<float> LP; public List<byte> LC; }
        System.Collections.Concurrent.BlockingCollection<Trabajo> cola; System.Threading.Thread[] obreros; volatile Exception errorObrero;
        readonly object cerrojo = new object();

        void Cierra()
        {
            if (eActual < 0 || op == null || (op.Nv + tr.Nv == 0 && (lP == null || lP.Count == 0))) { eActual = -1; return; }
            var t = new Trabajo { E = eActual, Op = op, Tr = tr, LP = lP, LC = lC }; op.Unicos = null; tr.Unicos = null; eActual = -1; op = null; tr = null; lP = null; lC = null;
            if (Hilos <= 0) { Procesa(t); return; }
            if (errorObrero != null) throw new InvalidOperationException("Error al simplificar la geometria: " + errorObrero.Message, errorObrero);
            if (cola == null) Arranca();
            cola.Add(t);
        }
        void Arranca()
        {
            cola = new System.Collections.Concurrent.BlockingCollection<Trabajo>(256); obreros = new System.Threading.Thread[Hilos];
            for (int k = 0; k < Hilos; k++)
            {
                obreros[k] = new System.Threading.Thread(() =>
                {
                    foreach (var t in cola.GetConsumingEnumerable())
                    {
                        if (errorObrero != null) continue;
                        try { Procesa(t); } catch (Exception ex) { if (errorObrero == null) errorObrero = ex; }
                    }
                }) { IsBackground = true, Name = "CdeAnin geometria " + k, Priority = System.Threading.ThreadPriority.BelowNormal };
                obreros[k].Start();
            }
        }
        /// <summary>Espera a que los hilos terminen los elementos pendientes.</summary>
        void Termina()
        {
            if (cola == null) return;
            cola.CompleteAdding(); foreach (var o in obreros) o.Join(); cola.Dispose(); cola = null; obreros = null;
            if (errorObrero != null) throw new InvalidOperationException("Error al simplificar la geometria: " + errorObrero.Message, errorObrero);
        }
        /// <summary>Simplifica un elemento (si pasa su tope o si se aligera al leer) y lo agrega a los temporales.</summary>
        void Procesa(Trabajo t)
        {
            if (t.LP != null && t.LP.Count > 0)
            {
                var P = t.LP; var C = t.LC; if (TopeLineas > 0 && P.Count / 6 > TopeLineas) AligeraLineas(t.LP, t.LC, TopeLineas, out P, out C);
                if (P.Count > 0)
                {
                    var lbp = new byte[P.Count * 4]; Buffer.BlockCopy(P.ToArray(), 0, lbp, 0, lbp.Length); var lbc = C.ToArray();
                    lock (cerrojo)
                    {
                        if (flv == null) { flv = File.Create(Path.Combine(tmp, "lv.bin")); flc = File.Create(Path.Combine(tmp, "lc.bin")); }
                        tablaL.Add(new FilaL { E = t.E, Off = nSeg, N = (uint)(P.Count / 6), Color = new byte[] { lbc[0], lbc[1], lbc[2], 255 } });
                        flv.Write(lbp, 0, lbp.Length); flc.Write(lbc, 0, lbc.Length); nSeg += P.Count / 6;
                    }
                }
            }
            if (t.Op.Nv + t.Tr.Nv == 0) return;   // solo lineas
            Parte op = t.Op, tr = t.Tr; int antes = (op.I.Count + tr.I.Count) / 3; bool tope = false;
            if (TopePorElemento > 0 && antes > TopePorElemento)
            {
                tope = true; int[] rp = Reparte(TopePorElemento, op.I.Count / 3, tr.I.Count / 3);
                // colapso de aristas hasta la tolerancia (medio 1 cm): si aun queda por encima del tope, se deja asi (la forma manda).
                // Solo en "bajo" (5 cm) se sigue a 10 cm y, si hace falta, agrupado por rejilla.
                foreach (var pt in new[] { op, tr })
                {
                    int tp = pt == op ? rp[0] : rp[1];
                    Decima(pt, tp, Tolerancia);
                    if (Tolerancia >= 0.05) { if (pt.I.Count / 3 > 2 * tp) Decima(pt, tp, 0.10); if (pt.I.Count / 3 > 4 * tp) Simplifica(pt, tp); }
                }
            }
            if (AligeraAlLeer && (op.I.Count + tr.I.Count) / 3 > Liviano) { double tl = Math.Min(0.01, Tolerancia); Decima(op, 12, tl); Decima(tr, 12, tl); }
            bool reducido = (op.I.Count + tr.I.Count) / 3 < antes;
            bool todoVidrio = op.Nv == 0; var c0 = op.Primero ?? tr.Primero;
            var f = new Fila { E = t.E, VertOp = op.Nv, TodoVidrio = todoVidrio, Color = new byte[] { c0[0], c0[1], c0[2], todoVidrio ? (byte)Math.Min((int)c0[3], 160) : (byte)255 } };
            f.VertCount = op.Nv + tr.Nv; f.IdxCount = (uint)(op.I.Count + tr.I.Count); f.IcTr = todoVidrio ? 0u : (uint)tr.I.Count;
            byte[] bv = new byte[f.VertCount * 12], bi = new byte[f.IdxCount * 4], bc = new byte[f.VertCount * 3];
            Buffer.BlockCopy(op.P.ToArray(), 0, bv, 0, op.P.Count * 4); Buffer.BlockCopy(tr.P.ToArray(), 0, bv, op.P.Count * 4, tr.P.Count * 4);
            var io = op.I.ToArray(); var it = tr.I.ToArray(); for (int i = 0; i < it.Length; i++) it[i] += op.Nv;
            Buffer.BlockCopy(io, 0, bi, 0, io.Length * 4); Buffer.BlockCopy(it, 0, bi, io.Length * 4, it.Length * 4);
            op.C.CopyTo(bc, 0); tr.C.CopyTo(bc, op.C.Count);
            lock (cerrojo)
            {
                if (tope) TriangulosAntes += antes;
                if ((tope || reducido) && tocados.Add(t.E)) Simplificados++;
                f.VertOff = nVert; f.IdxOff = nIdx;
                fv.Write(bv, 0, bv.Length); fi.Write(bi, 0, bi.Length); fc.Write(bc, 0, bc.Length);
                nVert += f.VertCount; nIdx += f.IdxCount; tabla.Add(f);
            }
        }

        /// <summary>Junta los extremos de los segmentos en una rejilla que crece (x1,2) hasta quedar en 'tope' segmentos o menos:
        /// los segmentos que se aplastan o se repiten se descartan; cada uno conserva su color. La silueta del arbol se mantiene.</summary>
        static void AligeraLineas(List<float> P, List<byte> C, int tope, out List<float> rP, out List<byte> rC)
        {
            rP = P; rC = C; int n = P.Count / 6; if (n <= tope) return;
            float x0 = float.MaxValue, y0 = float.MaxValue, z0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue, z1 = float.MinValue;
            for (int i = 0; i < P.Count; i += 3) { x0 = Math.Min(x0, P[i]); y0 = Math.Min(y0, P[i + 1]); z0 = Math.Min(z0, P[i + 2]); x1 = Math.Max(x1, P[i]); y1 = Math.Max(y1, P[i + 1]); z1 = Math.Max(z1, P[i + 2]); }
            double diag = Math.Sqrt((x1 - x0) * (double)(x1 - x0) + (y1 - y0) * (double)(y1 - y0) + (z1 - z0) * (double)(z1 - z0)); if (diag <= 0) return;
            double celda = diag / (4.0 * Math.Sqrt(tope));
            for (int intento = 0; intento < 40; intento++, celda *= 1.2)
            {
                var grupo = new Dictionary<VerticeClave, int>(); var suma = new List<double>(); var cuenta = new List<int>(); var vistos = new HashSet<long>(MezclaLong.Uno);
                var nP = new List<float>(); var nC = new List<byte>(); var seg = new List<int>();
                Func<int, int> id = (i) =>
                {
                    var k = new VerticeClave { X = (int)Math.Floor((P[i] - x0) / celda), Y = (int)Math.Floor((P[i + 1] - y0) / celda), Z = (int)Math.Floor((P[i + 2] - z0) / celda) };
                    int g; if (!grupo.TryGetValue(k, out g)) { g = cuenta.Count; grupo[k] = g; suma.Add(0); suma.Add(0); suma.Add(0); cuenta.Add(0); }
                    suma[g * 3] += P[i]; suma[g * 3 + 1] += P[i + 1]; suma[g * 3 + 2] += P[i + 2]; cuenta[g]++; return g;
                };
                for (int s2 = 0; s2 < n; s2++)
                {
                    int a = id(s2 * 6), b = id(s2 * 6 + 3); if (a == b) continue;
                    long k = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a; if (!vistos.Add(k)) continue;
                    seg.Add(a); seg.Add(b); nC.Add(C[s2 * 3]); nC.Add(C[s2 * 3 + 1]); nC.Add(C[s2 * 3 + 2]);
                }
                if (seg.Count / 2 > tope && intento < 39) continue;
                for (int q = 0; q < seg.Count; q++) { int g = seg[q]; nP.Add((float)(suma[g * 3] / cuenta[g])); nP.Add((float)(suma[g * 3 + 1] / cuenta[g])); nP.Add((float)(suma[g * 3 + 2] / cuenta[g])); }
                if (nP.Count == 0) return;   // nunca se borra el elemento entero
                rP = nP; rC = nC; return;
            }
        }

        /// <summary>Reparte un tope entre la parte opaca y el vidrio: la parte chica (hasta un cuarto del tope) no se toca y el
        /// resto va a la grande; si las dos son grandes, en proporcion. Asi un marco liviano no desaparece por un vidrio denso.</summary>
        static int[] Reparte(int tope, int nOp, int nTr)
        {
            if (nOp + nTr <= tope) return new[] { nOp, nTr };
            if (nOp <= tope / 4) return new[] { nOp, tope - nOp };
            if (nTr <= tope / 4) return new[] { tope - nTr, nTr };
            return new[] { (int)((long)tope * nOp / (nOp + nTr)), (int)((long)tope * nTr / (nOp + nTr)) };
        }

        /// <summary>Simplifica una parte agrupando sus vertices en una rejilla (vertex clustering): empieza fina (1/2000 de la
        /// diagonal de la parte) y la agranda (x1,4) hasta que quedan como mucho 'tope' triangulos; los triangulos que se aplastan se
        /// descartan. El color se respeta (vertices de distinto color no se juntan). Pensado para piezas muy densas: un equipo de
        /// 120.000 triangulos queda en unos pocos miles sin cambiar su silueta.</summary>
        static void Simplifica(Parte d, int tope)
        {
            if (d.Nv == 0 || tope <= 0 || d.I.Count / 3 <= tope) return;
            float[] P = d.P.ToArray(); byte[] C = d.C.ToArray(); uint[] I0 = d.I.ToArray(); int nv = (int)d.Nv;
            float x0, y0, z0; double diag = Caja(P, nv, out x0, out y0, out z0);
            if (diag <= 0) return;
            // primera celda estimada: una superficie de N triangulos tiene aristas de ~diag/raiz(N); se empieza un poco mas fina
            // que la que daria el tope y se agranda x1,41 (antes se empezaba en diag/2000: hasta 10 vueltas por elemento)
            double celda = diag / (2.0 * Math.Sqrt(Math.Max(1, tope)));
            List<float> nP = null; List<byte> nC = null; List<uint> nI = null; List<float> aP = null; List<byte> aC = null; List<uint> aI = null;
            for (int intento = 0; intento < 24; intento++, celda *= 1.41)
            {
                aP = nP; aC = nC; aI = nI;
                Agrupa(P, C, I0, nv, x0, y0, z0, celda, out nP, out nC, out nI);
                if (nI.Count / 3 <= tope) break;
            }
            if (nI.Count == 0 && aI != null && aI.Count > 0) { nP = aP; nC = aC; nI = aI; }   // nunca se borra la pieza entera
            if (nI.Count == 0) return;
            d.P = nP; d.C = nC; d.I = nI; d.Nv = (uint)(nP.Count / 3); d.Unicos = null;
        }
        static double Caja(float[] P, int nv, out float x0, out float y0, out float z0)
        {
            x0 = float.MaxValue; y0 = float.MaxValue; z0 = float.MaxValue; float x1 = float.MinValue, y1 = float.MinValue, z1 = float.MinValue;
            for (int v = 0; v < nv; v++) { float x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
            return nv == 0 ? 0 : Math.Sqrt((x1 - x0) * (double)(x1 - x0) + (y1 - y0) * (double)(y1 - y0) + (z1 - z0) * (double)(z1 - z0));
        }
        /// <summary>Una vuelta de agrupado de vertices en una rejilla de 'celda' (vertex clustering): los vertices de una misma
        /// celda y color se juntan en su promedio; los triangulos que se aplastan o se repiten se descartan.</summary>
        static void Agrupa(float[] P, byte[] C, uint[] I0, int nv, float x0, float y0, float z0, double celda, out List<float> nP, out List<byte> nC, out List<uint> nI)
        {
            var grupo = new Dictionary<VerticeClave, uint>(); var mapa = new uint[nv]; var suma = new List<double>(); var cuenta = new List<int>(); nC = new List<byte>();
            for (int v = 0; v < nv; v++)
            {
                var k = new VerticeClave { X = (int)Math.Floor((P[v * 3] - x0) / celda), Y = (int)Math.Floor((P[v * 3 + 1] - y0) / celda), Z = (int)Math.Floor((P[v * 3 + 2] - z0) / celda), R = C[v * 3], G = C[v * 3 + 1], B = C[v * 3 + 2] };
                uint g; if (!grupo.TryGetValue(k, out g)) { g = (uint)cuenta.Count; grupo[k] = g; suma.Add(0); suma.Add(0); suma.Add(0); cuenta.Add(0); nC.Add(k.R); nC.Add(k.G); nC.Add(k.B); }
                mapa[v] = g; suma[(int)g * 3] += P[v * 3]; suma[(int)g * 3 + 1] += P[v * 3 + 1]; suma[(int)g * 3 + 2] += P[v * 3 + 2]; cuenta[(int)g]++;
            }
            nI = new List<uint>(I0.Length / 2); var vistos = new HashSet<long>(MezclaLong.Uno);
            for (int t = 0; t + 2 < I0.Length; t += 3)
            {
                uint a = mapa[I0[t]], b = mapa[I0[t + 1]], c = mapa[I0[t + 2]];
                if (a == b || b == c || a == c) continue;
                // un mismo triangulo (en cualquier orden de giro conservado) solo una vez
                uint m0 = Math.Min(a, Math.Min(b, c)); long clave = m0 == a ? ((long)a << 42 | (long)b << 21 | c) : m0 == b ? ((long)b << 42 | (long)c << 21 | a) : ((long)c << 42 | (long)a << 21 | b);
                if (!vistos.Add(clave)) continue;
                nI.Add(a); nI.Add(b); nI.Add(c);
            }
            nP = new List<float>(cuenta.Count * 3);
            for (int g = 0; g < cuenta.Count; g++) { nP.Add((float)(suma[g * 3] / cuenta[g])); nP.Add((float)(suma[g * 3 + 1] / cuenta[g])); nP.Add((float)(suma[g * 3 + 2] / cuenta[g])); }
        }
        /// <summary>Una sola vuelta de agrupado, con la celda estimada para quedar cerca de 'objetivo' triangulos (por k): rapido
        /// para cientos de miles de elementos (Simplifica da varias vueltas por elemento).</summary>
        static void AgrupaObjetivo(Parte d, int objetivo, double k)
        {
            if (d.Nv == 0 || d.I.Count / 3 <= objetivo) return;
            float[] P = d.P.ToArray(); byte[] C = d.C.ToArray(); uint[] I0 = d.I.ToArray(); int nv = (int)d.Nv;
            float x0, y0, z0; double diag = Caja(P, nv, out x0, out y0, out z0); if (diag <= 0) return;
            double celda = k * diag / Math.Sqrt(Math.Max(1, objetivo));
            List<float> nP; List<byte> nC; List<uint> nI; Agrupa(P, C, I0, nv, x0, y0, z0, celda, out nP, out nC, out nI);
            if (nI.Count == 0) return;   // nunca se borra la pieza entera
            d.P = nP; d.C = nC; d.I = nI; d.Nv = (uint)(nP.Count / 3); d.Unicos = null;
        }

        // ------------------------------------------------------------------------------------------------------------------
        /// <summary>Simplificacion por colapso de aristas con error cuadratico (QEM, Garland-Heckbert): quita primero las aristas
        /// cuyo colapso casi no cambia la forma, asi un tubo delgado pierde lados pero no desaparece, una losa con muchos triangulos
        /// queda en pocos y las aristas vivas se conservan. Los bordes abiertos y los cambios de color se protegen. Al final se
        /// vuelven a separar los vertices en las aristas vivas (normales a mas de ~30 grados), como los escribe Vertice.</summary>
        static bool Decima(Parte d, int objetivo, double tol)
        {
            int nv0 = (int)d.Nv, ni0 = d.I.Count; if (nv0 == 0 || ni0 / 3 <= objetivo || objetivo < 4) return false;
            // tol (m): no se colapsa nada que mueva la superficie mas que eso (asi un marco de ventana, una letra o un poste delgado
            // no se deforman aunque falte llegar al objetivo). El error de QEM es la suma de distancias al cuadrado a los planos de
            // las caras vecinas (unas 4 a 8): se compara con 4 tol^2.
            double umbral = tol > 0 ? 4 * tol * tol : double.MaxValue;
            // 1) soldar vertices por posicion y color (los separados por la normal vuelven a ser uno)
            var mapa = new int[nv0]; var sold = new Dictionary<VerticeClave, int>(); var px = new List<double>(); var col = new List<byte>();
            for (int v = 0; v < nv0; v++)
            {
                var k = new VerticeClave { X = (int)Math.Floor(d.P[v * 3] * 10000), Y = (int)Math.Floor(d.P[v * 3 + 1] * 10000), Z = (int)Math.Floor(d.P[v * 3 + 2] * 10000), R = d.C[v * 3], G = d.C[v * 3 + 1], B = d.C[v * 3 + 2] };
                int w; if (!sold.TryGetValue(k, out w)) { w = px.Count / 3; sold[k] = w; px.Add(d.P[v * 3]); px.Add(d.P[v * 3 + 1]); px.Add(d.P[v * 3 + 2]); col.Add(k.R); col.Add(k.G); col.Add(k.B); }
                mapa[v] = w;
            }
            int nv = px.Count / 3; var cara = new List<int>(ni0);
            for (int t = 0; t + 2 < ni0; t += 3) { int a = mapa[d.I[t]], b = mapa[d.I[t + 1]], c = mapa[d.I[t + 2]]; if (a != b && b != c && a != c) { cara.Add(a); cara.Add(b); cara.Add(c); } }
            int nf = cara.Count / 3; if (nf <= objetivo) return false;
            var P = px.ToArray(); var Q = new double[nv * 10]; var viva = new bool[nf]; for (int f = 0; f < nf; f++) viva[f] = true;
            var vc = new List<int>[nv]; for (int v = 0; v < nv; v++) vc[v] = new List<int>(6);
            Action<int, double, double, double, double, double> suma = (v, a, b, c, dd, w) =>
            {
                int o = v * 10; Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * dd; Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * dd; Q[o + 7] += w * c * c; Q[o + 8] += w * c * dd; Q[o + 9] += w * dd * dd;
            };
            var aristas = new Dictionary<long, int>(MezclaLong.Uno);   // (min,max) -> caras que la usan
            for (int f = 0; f < nf; f++)
            {
                int a = cara[f * 3], b = cara[f * 3 + 1], c = cara[f * 3 + 2]; vc[a].Add(f); vc[b].Add(f); vc[c].Add(f);
                double nx, ny, nz, ar; Normal(P, a, b, c, out nx, out ny, out nz, out ar); if (ar <= 0) continue;
                double dd = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
                suma(a, nx, ny, nz, dd, 1); suma(b, nx, ny, nz, dd, 1); suma(c, nx, ny, nz, dd, 1);   // peso 1: el error queda en m^2
                Cuenta(aristas, Clave(a, b)); Cuenta(aristas, Clave(b, c)); Cuenta(aristas, Clave(c, a));
            }
            // bordes abiertos y cambios de color: un plano perpendicular al borde, con mucho peso, los mantiene en su sitio. Tambien
            // el borde de una lamina de dos caras (vidrios, placas y letreros modelados como dos caras opuestas con los mismos
            // vertices: la arista la comparten dos caras de normales contrarias y parece cerrada) y las aristas de 3 o mas caras. Sin
            // esto, en un vidrio de dos caras mover una esquina sobre la otra tenia error 0 (todo en el mismo plano) y medio vidrio
            // desaparecia: las ventanas "rotas" en triangulos.
            var deArista = new int[3];
            foreach (var kv in aristas)
            {
                int a = (int)(kv.Key >> 32), b = (int)(kv.Key & 0xFFFFFFFF), nCaras = 0;
                foreach (int f in vc[a]) { int x = cara[f * 3], y = cara[f * 3 + 1], z = cara[f * 3 + 2]; if (x == b || y == b || z == b) { if (nCaras < 3) deArista[nCaras] = f; nCaras++; } }
                if (nCaras == 0) continue;
                if (nCaras == 2)
                {
                    double n0x, n0y, n0z, a0, n1x, n1y, n1z, a1; int f0 = deArista[0], f1 = deArista[1];
                    Normal(P, cara[f0 * 3], cara[f0 * 3 + 1], cara[f0 * 3 + 2], out n0x, out n0y, out n0z, out a0);
                    Normal(P, cara[f1 * 3], cara[f1 * 3 + 1], cara[f1 * 3 + 2], out n1x, out n1y, out n1z, out a1);
                    if (a0 > 0 && a1 > 0 && n0x * n1x + n0y * n1y + n0z * n1z > -0.5) continue;   // arista interior comun: sin plano extra
                }
                {
                    int f = deArista[0]; int x = cara[f * 3], y = cara[f * 3 + 1], z = cara[f * 3 + 2];
                    double nx, ny, nz, ar; Normal(P, x, y, z, out nx, out ny, out nz, out ar); if (ar <= 0) continue;
                    double ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
                    double qx = ey * nz - ez * ny, qy = ez * nx - ex * nz, qz = ex * ny - ey * nx, l = Math.Sqrt(qx * qx + qy * qy + qz * qz); if (l <= 0) continue;
                    qx /= l; qy /= l; qz /= l; double dd = -(qx * P[a * 3] + qy * P[a * 3 + 1] + qz * P[a * 3 + 2]), w = 10;
                    suma(a, qx, qy, qz, dd, w); suma(b, qx, qy, qz, dd, w);
                }
            }
            // 2) colapsos, de menor a mayor error (monticulo binario con marcas de version)
            var ver = new int[nv]; var muerto = new bool[nv];
            var hC = new List<double>(); var hI = new List<int>();   // monticulo: costo, indice de la arista pendiente
            var eA = new List<int>(); var eB = new List<int>(); var eVa = new List<int>(); var eVb = new List<int>(); var eO = new List<byte>();
            Action<double, int> subeH = (c, id) =>
            {
                hC.Add(c); hI.Add(id); int i = hC.Count - 1;
                while (i > 0) { int p = (i - 1) / 2; if (hC[p] <= hC[i]) break; double tc = hC[p]; hC[p] = hC[i]; hC[i] = tc; int ti = hI[p]; hI[p] = hI[i]; hI[i] = ti; i = p; }
            };
            Func<int> sacaH = () =>
            {
                int id = hI[0]; int u = hC.Count - 1; hC[0] = hC[u]; hI[0] = hI[u]; hC.RemoveAt(u); hI.RemoveAt(u); int i = 0, n = hC.Count;
                while (true) { int l = 2 * i + 1, r = l + 1, m = i; if (l < n && hC[l] < hC[m]) m = l; if (r < n && hC[r] < hC[m]) m = r; if (m == i) break; double tc = hC[m]; hC[m] = hC[i]; hC[i] = tc; int ti = hI[m]; hI[m] = hI[i]; hI[i] = ti; i = m; }
                return id;
            };
            Action<int, int> mete = (a, b) =>
            {
                if (a == b || muerto[a] || muerto[b]) return;
                // se prueba dejar el vertice en a, en b o en el medio; el de menor error
                double best = double.MaxValue; byte donde = 0;
                for (byte opc = 0; opc < 3; opc++)
                {
                    double x = opc == 0 ? P[a * 3] : opc == 1 ? P[b * 3] : (P[a * 3] + P[b * 3]) / 2, y = opc == 0 ? P[a * 3 + 1] : opc == 1 ? P[b * 3 + 1] : (P[a * 3 + 1] + P[b * 3 + 1]) / 2, z = opc == 0 ? P[a * 3 + 2] : opc == 1 ? P[b * 3 + 2] : (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
                    double e = Err(Q, a, b, x, y, z); if (e < best) { best = e; donde = opc; }
                }
                int id = eA.Count; eA.Add(a); eB.Add(b); eVa.Add(ver[a]); eVb.Add(ver[b]); eO.Add(donde); subeH(best, id);
            };
            foreach (var kv in aristas) mete((int)(kv.Key >> 32), (int)(kv.Key & 0xFFFFFFFF));
            int vivas = nf; var vecinos = new HashSet<int>(); var lado = new int[2];
            while (vivas > objetivo && hC.Count > 0)
            {
                if (hC[0] > umbral) break;   // lo que queda cambiaria la forma mas que la tolerancia
                int id = sacaH(); int a = eA[id], b = eB[id]; if (muerto[a] || muerto[b] || ver[a] != eVa[id] || ver[b] != eVb[id]) continue;
                int opc = eO[id]; double x = opc == 0 ? P[a * 3] : opc == 1 ? P[b * 3] : (P[a * 3] + P[b * 3]) / 2, y = opc == 0 ? P[a * 3 + 1] : opc == 1 ? P[b * 3 + 1] : (P[a * 3 + 1] + P[b * 3 + 1]) / 2, z = opc == 0 ? P[a * 3 + 2] : opc == 1 ? P[b * 3 + 2] : (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
                // no se colapsa si alguna cara se da vuelta
                bool vuelta = false; lado[0] = a; lado[1] = b;
                for (int s2 = 0; s2 < 2 && !vuelta; s2++)
                {
                    int vv = lado[s2];
                    foreach (int f in vc[vv])
                    {
                        if (!viva[f]) continue; int i0 = cara[f * 3], i1 = cara[f * 3 + 1], i2 = cara[f * 3 + 2];
                        bool conA = i0 == a || i1 == a || i2 == a, conB = i0 == b || i1 == b || i2 == b; if (conA && conB) continue;
                        double n0x, n0y, n0z, ar0; Normal(P, i0, i1, i2, out n0x, out n0y, out n0z, out ar0); if (ar0 <= 0) continue;
                        double sx = P[vv * 3], sy = P[vv * 3 + 1], sz = P[vv * 3 + 2]; P[vv * 3] = x; P[vv * 3 + 1] = y; P[vv * 3 + 2] = z;
                        double n1x, n1y, n1z, ar1; Normal(P, i0, i1, i2, out n1x, out n1y, out n1z, out ar1);
                        P[vv * 3] = sx; P[vv * 3 + 1] = sy; P[vv * 3 + 2] = sz;
                        if (ar1 <= 0 || n0x * n1x + n0y * n1y + n0z * n1z < 0.3) { vuelta = true; break; }
                    }
                }
                if (vuelta) continue;
                // b se junta en a
                P[a * 3] = x; P[a * 3 + 1] = y; P[a * 3 + 2] = z; for (int q = 0; q < 10; q++) Q[a * 10 + q] += Q[b * 10 + q];
                muerto[b] = true; ver[a]++;
                foreach (int f in vc[b])
                {
                    if (!viva[f]) continue; int o = f * 3;
                    if (cara[o] == a || cara[o + 1] == a || cara[o + 2] == a) { viva[f] = false; vivas--; continue; }
                    for (int q = 0; q < 3; q++) if (cara[o + q] == b) cara[o + q] = a;
                    vc[a].Add(f);
                }
                vc[b] = null;
                // caras vivas de a (sin repetir) y sus vecinos: se recalculan sus aristas
                vecinos.Clear(); var la = vc[a]; int w = 0;
                for (int r = 0; r < la.Count; r++) { int f = la[r]; if (!viva[f]) continue; bool rep = false; for (int r2 = 0; r2 < w; r2++) if (la[r2] == f) { rep = true; break; } if (rep) continue; la[w++] = f; for (int q = 0; q < 3; q++) { int u = cara[f * 3 + q]; if (u != a) vecinos.Add(u); } }
                la.RemoveRange(w, la.Count - w);
                foreach (int u in vecinos) mete(Math.Min(a, u), Math.Max(a, u));
            }
            if (vivas >= nf) return false;
            // 3) se reescribe la parte: un vertice se comparte entre las caras cuya normal difiere menos de 40 grados (superficie lisa)
            //    y se separa en las aristas vivas (las esquinas de una caja siguen nitidas)
            var nP = new List<float>(); var nC = new List<byte>(); var nI = new List<uint>(); var grupos = new Dictionary<int, List<double[]>>();
            const double COS40 = 0.766;
            for (int f = 0; f < nf; f++)
            {
                if (!viva[f]) continue; int i0 = cara[f * 3], i1 = cara[f * 3 + 1], i2 = cara[f * 3 + 2];
                double nx, ny, nz, ar; Normal(P, i0, i1, i2, out nx, out ny, out nz, out ar); if (ar <= 0) continue;
                for (int q = 0; q < 3; q++)
                {
                    int v = q == 0 ? i0 : q == 1 ? i1 : i2; List<double[]> gl; if (!grupos.TryGetValue(v, out gl)) grupos[v] = gl = new List<double[]>(2);
                    double[] g = null; foreach (var x in gl) if (x[0] * nx + x[1] * ny + x[2] * nz > COS40) { g = x; break; }
                    if (g == null) { g = new double[] { nx, ny, nz, nP.Count / 3 }; gl.Add(g); nP.Add((float)P[v * 3]); nP.Add((float)P[v * 3 + 1]); nP.Add((float)P[v * 3 + 2]); nC.Add(col[v * 3]); nC.Add(col[v * 3 + 1]); nC.Add(col[v * 3 + 2]); }
                    nI.Add((uint)g[3]);
                }
            }
            if (nI.Count == 0) return false;   // nunca se borra la pieza entera
            d.P = nP; d.C = nC; d.I = nI; d.Nv = (uint)(nP.Count / 3); d.Unicos = null;
            return true;
        }
        static void Cuenta(Dictionary<long, int> d, long k) { int n; d.TryGetValue(k, out n); d[k] = n + 1; }
        static long Clave(int a, int b) => a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
        static void Normal(double[] P, int a, int b, int c, out double nx, out double ny, out double nz, out double area)
        {
            double ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
            nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; double l = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            area = l / 2; if (l > 1e-20) { nx /= l; ny /= l; nz /= l; } else { nx = ny = nz = 0; area = 0; }
        }
        static double Err(double[] Q, int a, int b, double x, double y, double z)
        {
            int oa = a * 10, ob = b * 10;
            double q0 = Q[oa] + Q[ob], q1 = Q[oa + 1] + Q[ob + 1], q2 = Q[oa + 2] + Q[ob + 2], q3 = Q[oa + 3] + Q[ob + 3], q4 = Q[oa + 4] + Q[ob + 4], q5 = Q[oa + 5] + Q[ob + 5], q6 = Q[oa + 6] + Q[ob + 6], q7 = Q[oa + 7] + Q[ob + 7], q8 = Q[oa + 8] + Q[ob + 8], q9 = Q[oa + 9] + Q[ob + 9];
            return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
        }

        /// <summary>Si el modelo pasa del tope total, vuelve a leer los temporales elemento por elemento y simplifica los pesados
        /// (los de mas de 300 triangulos) en la proporcion que falta; los livianos quedan igual. Reescribe los temporales.</summary>
        void AplicaTopeTotal()
        {
            TriangulosSinTope = nIdx / 3;
            // hasta dos pasadas
            // se aligera solo si se pasa por mas de un 25 % (el visor dibuja bien unos millones mas o menos)
            // cada pasada admite mas error (1 cm y 2,5 cm): se quitan primero los triangulos que no se notan; si con 2,5 cm aun se
            // pasa del tope, se deja asi (mejor un millon de triangulos de mas que letras y perfiles deformados: con 5 cm se notaba
            // en los bordes de las letras del letrero)
            // si las pasadas ya llevan 6 min, no se empieza otra (la publicacion completa no debe pasar de unos 30 min)
            // nunca mas que la tolerancia del detalle (medio: una sola pasada de 1 cm)
            double[] tolerancias = Tolerancia < 0.01 ? new[] { Tolerancia } : new[] { 0.01, 0.025, 0.05 }.Where(x => x <= Tolerancia + 1e-9).ToArray(); var reloj = System.Diagnostics.Stopwatch.StartNew();
            for (int pasada = 0; pasada < tolerancias.Length && TopeTotal > 0 && nIdx / 3 > TopeTotal * 1.25; pasada++)
            {
                if (pasada > 0 && reloj.Elapsed.TotalMinutes > 6) { Avance?.Invoke("Aligerado detenido por tiempo (" + reloj.Elapsed.TotalMinutes.ToString("0.#", CultureInfo.InvariantCulture) + " min): quedan " + (nIdx / 3).ToString("N0", CultureInfo.InvariantCulture) + " triangulos"); break; }
                Avance?.Invoke("Aligerando la geometria (pasada " + (pasada + 1) + ", hasta " + (tolerancias[pasada] * 100).ToString("0.#", CultureInfo.InvariantCulture) + " cm de diferencia): " + (nIdx / 3).ToString("N0", CultureInfo.InvariantCulture) + " triangulos, tope " + TopeTotal.ToString("N0", CultureInfo.InvariantCulture));
                tolPasada = tolerancias[pasada]; PasadaTopeTotal();
                Avance?.Invoke("Aligerada: " + (nIdx / 3).ToString("N0", CultureInfo.InvariantCulture) + " triangulos");
            }
        }
        void PasadaTopeTotal()
        {
            string nv = Path.Combine(tmp, "v2.bin"), ni = Path.Combine(tmp, "i2.bin"), nc = Path.Combine(tmp, "c2.bin");
            long vOff = 0, iOff = 0;
            // se leen con los mismos flujos ya abiertos (los temporales se crearon sin compartir); por bloques de 2.048 elementos: se
            // leen en orden, se simplifican en paralelo (todos los nucleos: Navisworks ya entrego todo) y se escriben en orden
            fv.Position = 0; fi.Position = 0; fc.Position = 0;
            int nucleos = Hilos > 0 ? Math.Max(1, Environment.ProcessorCount - 1) : 1;
            using (var w2v = File.Create(nv)) using (var w2i = File.Create(ni)) using (var w2c = File.Create(nc))
            {
                var reloj = System.Diagnostics.Stopwatch.StartNew(); long ult = 0; int hechos = 0;
                for (int ini = 0; ini < tabla.Count; ini += 2048)
                {
                    int n = Math.Min(2048, tabla.Count - ini);
                    var bv = new byte[n][]; var bi = new byte[n][]; var bc = new byte[n][];
                    for (int k = 0; k < n; k++)
                    {
                        var f = tabla[ini + k];
                        bv[k] = Lee(fv, f.VertCount * 12); bi[k] = Lee(fi, f.IdxCount * 4); bc[k] = Lee(fc, f.VertCount * 3);
                    }
                    var reducidos = new bool[n];
                    System.Threading.Tasks.Parallel.For(0, n, new System.Threading.Tasks.ParallelOptions { MaxDegreeOfParallelism = nucleos }, k =>
                    {
                        var f = tabla[ini + k]; if (f.IdxCount / 3 <= Liviano) return;
                        var pos = new float[f.VertCount * 3]; Buffer.BlockCopy(bv[k], 0, pos, 0, bv[k].Length);
                        var idx = new uint[f.IdxCount]; Buffer.BlockCopy(bi[k], 0, idx, 0, bi[k].Length);
                        var op = new Parte(); var tr = new Parte(); int nOpIdx = (int)(f.IdxCount - f.IcTr);   // en uno todo vidrio, todo va en 'op'
                        // la parte opaca usa los vertices del principio y el vidrio los del final (asi los escribio Procesa)
                        uint vOp = f.TodoVidrio ? f.VertCount : f.VertOp;
                        Llena(op, pos, bc[k], idx, 0, nOpIdx, 0, vOp); Llena(tr, pos, bc[k], idx, nOpIdx, (int)f.IdxCount, vOp, f.VertCount);
                        uint antes = f.IdxCount / 3;
                        Decima(op, 12, tolPasada); Decima(tr, 12, tolPasada);
                        uint vc = op.Nv + tr.Nv, ic = (uint)(op.I.Count + tr.I.Count);
                        var nbv = new byte[vc * 12]; Buffer.BlockCopy(op.P.ToArray(), 0, nbv, 0, op.P.Count * 4); Buffer.BlockCopy(tr.P.ToArray(), 0, nbv, op.P.Count * 4, tr.P.Count * 4);
                        var io = op.I.ToArray(); var it = tr.I.ToArray(); for (int i = 0; i < it.Length; i++) it[i] += op.Nv;
                        var nbi = new byte[ic * 4]; Buffer.BlockCopy(io, 0, nbi, 0, io.Length * 4); Buffer.BlockCopy(it, 0, nbi, io.Length * 4, it.Length * 4);
                        var nbc = new byte[vc * 3]; op.C.CopyTo(nbc, 0); tr.C.CopyTo(nbc, op.C.Count);
                        bv[k] = nbv; bi[k] = nbi; bc[k] = nbc;
                        f.VertCount = vc; f.VertOp = op.Nv; f.IcTr = f.TodoVidrio ? 0u : (uint)tr.I.Count; f.IdxCount = ic;
                        reducidos[k] = ic / 3 < antes;
                    });
                    for (int k = 0; k < n; k++)
                    {
                        var f = tabla[ini + k];
                        w2v.Write(bv[k], 0, bv[k].Length); w2i.Write(bi[k], 0, bi[k].Length); w2c.Write(bc[k], 0, bc[k].Length);
                        if (reducidos[k] && tocados.Add(f.E)) Simplificados++;
                        f.VertOff = vOff; f.IdxOff = iOff; vOff += f.VertCount; iOff += f.IdxCount;
                    }
                    hechos += n;
                    if (reloj.ElapsedMilliseconds - ult > 10000)
                    {
                        ult = reloj.ElapsedMilliseconds; Avance?.Invoke("Aligerando... " + hechos.ToString("N0", CultureInfo.InvariantCulture) + " de " + tabla.Count.ToString("N0", CultureInfo.InvariantCulture) + " elementos");
                        if (Sigue != null && !Sigue()) throw new OperationCanceledException("Publicacion cancelada en Navisworks (el archivo ya subido queda como version sin indice).");
                    }
                }
            }
            nVert = vOff; nIdx = iOff;
            fv.SetLength(0); fi.SetLength(0); fc.SetLength(0); fv.Position = 0; fi.Position = 0; fc.Position = 0;
            using (var s1 = File.OpenRead(nv)) s1.CopyTo(fv); using (var s2 = File.OpenRead(ni)) s2.CopyTo(fi); using (var s3 = File.OpenRead(nc)) s3.CopyTo(fc);
            try { File.Delete(nv); File.Delete(ni); File.Delete(nc); } catch (Exception) { }
        }
        /// <summary>Aristas de cada elemento, como las dibuja el visor (EdgesGeometry de three.js a 28 grados): los bordes abiertos,
        /// las aristas entre caras que forman mas de 28 grados (tambien las de laminas de dos caras) y las de 3 o mas caras. Se
        /// calculan aqui, en paralelo, para que el visor las muestre de entrada sin calcular nada (con millones de triangulos el
        /// navegador tardaba o no podia). Devuelve la ruta del temporal con los pares.</summary>
        string CalculaAristas()
        {
            string ruta = Path.Combine(tmp, "a.bin"); nAris = 0;
            fv.Position = 0; fi.Position = 0;
            int nucleos = Hilos > 0 ? Math.Max(1, Environment.ProcessorCount - 1) : 1;
            Avance?.Invoke("Calculando aristas de " + tabla.Count.ToString("N0", CultureInfo.InvariantCulture) + " elementos...");
            using (var wa = File.Create(ruta))
                for (int ini = 0; ini < tabla.Count; ini += 2048)
                {
                    int n = Math.Min(2048, tabla.Count - ini); var bv = new byte[n][]; var bi = new byte[n][]; var res = new byte[n][];
                    for (int k = 0; k < n; k++) { var f = tabla[ini + k]; bv[k] = Lee(fv, f.VertCount * 12); bi[k] = Lee(fi, f.IdxCount * 4); }
                    System.Threading.Tasks.Parallel.For(0, n, new System.Threading.Tasks.ParallelOptions { MaxDegreeOfParallelism = nucleos }, k =>
                    {
                        var f = tabla[ini + k]; var pos = new float[f.VertCount * 3]; Buffer.BlockCopy(bv[k], 0, pos, 0, bv[k].Length);
                        var idx = new uint[f.IdxCount]; Buffer.BlockCopy(bi[k], 0, idx, 0, bi[k].Length);
                        var pares = AristasDe(pos, idx, (int)f.VertCount); var b = new byte[pares.Length * 4]; Buffer.BlockCopy(pares, 0, b, 0, b.Length); res[k] = b;
                    });
                    for (int k = 0; k < n; k++) { var f = tabla[ini + k]; f.AOff = nAris; f.ACount = (uint)(res[k].Length / 8); wa.Write(res[k], 0, res[k].Length); nAris += f.ACount; }
                }
            fv.Position = 0; fi.Position = 0;
            return ruta;
        }
        static uint[] AristasDe(float[] pos, uint[] idx, int nv)
        {
            const double COS28 = 0.88294759;
            var canon = new int[nv]; var rep = new List<uint>(); var mapa = new Dictionary<VerticeClave, int>();
            for (int v = 0; v < nv; v++)
            {
                var k = new VerticeClave { X = (int)Math.Floor(pos[v * 3] * 10000), Y = (int)Math.Floor(pos[v * 3 + 1] * 10000), Z = (int)Math.Floor(pos[v * 3 + 2] * 10000) };
                int c; if (!mapa.TryGetValue(k, out c)) { c = rep.Count; mapa[k] = c; rep.Add((uint)v); }
                canon[v] = c;
            }
            // cada arista con sus caras (hasta 4 guardadas)
            int nf = idx.Length / 3; var nrm = new double[nf * 3]; var id = new Dictionary<long, int>(MezclaLong.Uno);
            var claves = new List<long>(); var cuenta = new List<int>(); var caras = new List<int>();
            for (int f = 0; f < nf; f++)
            {
                uint i0 = idx[f * 3], i1 = idx[f * 3 + 1], i2 = idx[f * 3 + 2]; if (i0 >= nv || i1 >= nv || i2 >= nv) continue;
                int a = canon[i0], b = canon[i1], c = canon[i2]; if (a == b || b == c || a == c) continue;
                double ux = pos[i1 * 3] - pos[i0 * 3], uy = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], uz = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
                double vx = pos[i2 * 3] - pos[i0 * 3], vy = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], vz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
                double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.Sqrt(nx * nx + ny * ny + nz * nz); if (l <= 1e-12) continue;
                nrm[f * 3] = nx / l; nrm[f * 3 + 1] = ny / l; nrm[f * 3 + 2] = nz / l;
                for (int e = 0; e < 3; e++)
                {
                    int p = e == 0 ? a : e == 1 ? b : c, q = e == 0 ? b : e == 1 ? c : a;
                    long key = p < q ? ((long)p << 32) | (uint)q : ((long)q << 32) | (uint)p; int k;
                    if (!id.TryGetValue(key, out k)) { k = cuenta.Count; id[key] = k; claves.Add(key); cuenta.Add(0); caras.Add(-1); caras.Add(-1); caras.Add(-1); caras.Add(-1); }
                    int n = cuenta[k]; if (n < 4) caras[k * 4 + n] = f; cuenta[k] = n + 1;
                }
            }
            // se dibuja la arista si alguna "orientacion" de caras (normales a menos de 28 grados entre si) la usa una sola vez (borde
            // abierto, arista viva, borde de una lamina de dos caras) o si se juntan planos distintos que no son las dos caras de una
            // misma lamina. No se dibujan las de dentro de una cara plana aunque la cara venga dos veces (anverso y reverso
            // coincidentes, como quedan las letras delgadas): antes esas salian como lineas cruzando las letras.
            var sal = new List<uint>(); var gx = new double[4]; var gy = new double[4]; var gz = new double[4]; var gn = new int[4];
            for (int k = 0; k < cuenta.Count; k++)
            {
                int n = cuenta[k]; bool dibuja;
                if (n == 1 || n > 4) dibuja = true;
                else
                {
                    int ng = 0;
                    for (int t = 0; t < n; t++)
                    {
                        int f = caras[k * 4 + t]; double x = nrm[f * 3], y = nrm[f * 3 + 1], z = nrm[f * 3 + 2]; int g = -1;
                        for (int h = 0; h < ng; h++) if (gx[h] * x + gy[h] * y + gz[h] * z > COS28) { g = h; break; }
                        if (g < 0) { g = ng++; gx[g] = x; gy[g] = y; gz[g] = z; gn[g] = 0; }
                        gn[g]++;
                    }
                    dibuja = false;
                    for (int h = 0; h < ng && !dibuja; h++) if (gn[h] == 1) dibuja = true;
                    for (int h = 0; h < ng && !dibuja; h++) for (int h2 = h + 1; h2 < ng; h2++) if (gx[h] * gx[h2] + gy[h] * gy[h2] + gz[h] * gz[h2] > -0.95) { dibuja = true; break; }
                }
                if (dibuja) { long key = claves[k]; sal.Add(rep[(int)(key >> 32)]); sal.Add(rep[(int)(key & 0xFFFFFFFF)]); }
            }
            return sal.ToArray();
        }
        static byte[] Lee(Stream s, long n)
        {
            var b = new byte[n]; int leidos = 0; while (leidos < n) { int k = s.Read(b, leidos, (int)(n - leidos)); if (k <= 0) throw new EndOfStreamException("Temporal de geometria incompleto"); leidos += k; }
            return b;
        }
        static void Llena(Parte d, float[] pos, byte[] col, uint[] idx, int i0, int i1, uint v0, uint v1)
        {
            for (uint v = v0; v < v1; v++) { d.P.Add(pos[v * 3]); d.P.Add(pos[v * 3 + 1]); d.P.Add(pos[v * 3 + 2]); d.C.Add(col[v * 3]); d.C.Add(col[v * 3 + 1]); d.C.Add(col[v * 3 + 2]); }
            d.Nv = v1 - v0; for (int i = i0; i < i1; i++) d.I.Add(idx[i] - v0);
        }

        /// <summary>Escribe el .cdeg final y devuelve su ruta.</summary>
        public string Escribe(string metaJson, PaqueteCde P)
        {
            Cierra(); Termina();
            wv.Flush(); wi.Flush(); fv.Flush(); fi.Flush(); fc.Flush();
            AplicaTopeTotal();
            string rutaA = CalculaAristas();
            string ruta = Path.Combine(tmp, "geometria.cdeg");
            byte[] mb = Encoding.UTF8.GetBytes(metaJson);
            using (var fs = File.Create(ruta)) using (var w = new BinaryWriter(fs))
            {
                w.Write(Encoding.ASCII.GetBytes("CDEG")); w.Write((uint)2); w.Write((uint)tabla.Count); w.Write((uint)nVert); w.Write((uint)nIdx);
                w.Write((float)Origen[0]); w.Write((float)Origen[1]); w.Write((float)Origen[2]); w.Write((uint)mb.Length); w.Write(mb);
                long pos = 36 + mb.Length; while (pos % 4 != 0) { w.Write((byte)0); pos++; }
                foreach (var f in tabla) { w.Write((uint)f.E); w.Write((uint)f.VertOff); w.Write(f.VertCount); w.Write((uint)f.IdxOff); w.Write(f.IdxCount); w.Write(f.Color); }
                w.Flush(); fv.Position = 0; fv.CopyTo(fs); fi.Position = 0; fi.CopyTo(fs);
                foreach (var f in tabla) w.Write(f.IcTr);
                w.Flush(); fc.Position = 0; fc.CopyTo(fs);
                long rel = nVert * 3; while (rel % 4 != 0) { fs.WriteByte(0); rel++; }
                // seccion opcional de lineas (la ignora un visor que no la conoce): "LINS", filas, segmentos; por fila: elemento,
                // primer segmento, cuantos, rgba; luego 6 float por segmento (en metros, sin el origen) y 3 bytes de color por segmento
                if (nSeg > 0)
                {
                    flv.Flush(); flc.Flush();
                    w.Write(Encoding.ASCII.GetBytes("LINS")); w.Write((uint)tablaL.Count); w.Write((uint)nSeg);
                    foreach (var f in tablaL) { w.Write((uint)f.E); w.Write((uint)f.Off); w.Write(f.N); w.Write(f.Color); }
                    w.Flush(); flv.Position = 0; flv.CopyTo(fs); flc.Position = 0; flc.CopyTo(fs);
                    long r2 = nSeg * 3; while (r2 % 4 != 0) { fs.WriteByte(0); r2++; }
                }
                // seccion opcional de aristas precalculadas: "ARIS", pares; por elemento (en el orden de la tabla) primer par y
                // cuantos; luego los pares de vertices, relativos al primer vertice de su elemento
                if (nAris > 0)
                {
                    w.Write(Encoding.ASCII.GetBytes("ARIS")); w.Write((uint)nAris);
                    foreach (var f in tabla) { w.Write((uint)f.AOff); w.Write(f.ACount); }
                    w.Flush(); using (var fa = File.OpenRead(rutaA)) fa.CopyTo(fs);
                }
            }
            try { File.Delete(rutaA); } catch (Exception) { }
            P.ConGeometria = tabla.Count; P.Vertices = nVert; P.Triangulos = nIdx / 3; P.Segmentos = nSeg; P.ConLineas = tablaL.Count; P.Aristas = nAris;
            return ruta;
        }

        public void Dispose()
        {
            try { if (cola != null) { cola.CompleteAdding(); errorObrero = errorObrero ?? new OperationCanceledException(); foreach (var o in obreros) o.Join(); cola.Dispose(); cola = null; } } catch (Exception) { }
            try { wv.Dispose(); wi.Dispose(); fc.Dispose(); } catch (Exception) { }
            try { if (flv != null) { flv.Dispose(); flc.Dispose(); } } catch (Exception) { }
            try { foreach (var n in new[] { "v.bin", "i.bin", "c.bin", "lv.bin", "lc.bin" }) File.Delete(Path.Combine(tmp, n)); } catch (Exception) { }
        }

        public static string NumeroJson(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);
    }
}
