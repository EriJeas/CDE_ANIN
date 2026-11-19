// Prueba del paquete del complemento de Navisworks SIN Navisworks: arma con Paquete.cs un modelo de dos elementos (un muro
// opaco con un vano de vidrio y un panel solo de vidrio, en coordenadas UTM) y lo publica con ClienteCde.cs, igual que el
// boton "Publicar al CDE". Uso: PruebaPaquete.exe <servidor> <llave> <pid> <nombre>
using System; using System.IO; using System.Linq; using System.Text;
namespace CdeAnin
{
    public static class PruebaPaquete
    {
        public static int Main(string[] a)
        {
            if (a.Length > 0 && a[0] == "tope") return Tope(a.Length > 1 ? int.Parse(a[1]) : 0, a.Length > 2 && a[2] == "aligera");
            var cli = new ClienteCde(new Configuracion { Servidor = a[0], Llave = a[1] });
            var P = new PaqueteCde(); P.Modelos.Add("SECHURA-ARQ.nwc"); P.Modelos.Add("SECHURA-EST.nwc");
            var I = new IndiceCde(P);
            var org = new[] { 520116.0, 9384802.0, 11.0 };   // como el del modelo de Sechura
            var G = new GeometriaCde(org);
            I.Elemento(1, "Muro basico [5001]", "SECHURA-ARQ.nwc", "Muros", "Muro basico", "TAB_E=0.13", "Primer Nivel"); I.Pon(1, "Elemento / Area", "12.60 m²");
            G.Empieza(1);
            Caja(G, 520116 + 0.0, 9384802 + 0.0, 11, 4, 0.15, 3, new byte[] { 245, 245, 245, 255 });
            Caja(G, 520116 + 1.0, 9384802 - 0.01, 12, 1, 0.02, 1, new byte[] { 0, 128, 192, 64 });   // vidrio con color propio
            I.Elemento(2, "Panel [5002]", "SECHURA-EST.nwc", "Paneles de muro cortina", "Panel de sistema", "Vidrio", "Primer Nivel");
            G.Empieza(2);
            Caja(G, 520116 + 5, 9384802, 11, 1, 0.02, 2, new byte[] { 250, 250, 250, 77 });   // vidrio claro: azul grisaceo
            // 3) una pieza muy densa (esfera de 80.000 triangulos, como un equipo de fabricante): se simplifica al tope por elemento
            I.Elemento(3, "Equipo [5003]", "SECHURA-EST.nwc", "Equipos especializados", "Equipo", "Denso", "Primer Nivel");
            G.Empieza(3); Esfera(G, 520116 + 8, 9384802 + 1, 12, 0.5, 200, 200, new byte[] { 200, 60, 60, 255 });
            I.Termina();
            P.RutaGeometria = G.Escribe("{\"modelo\":\"FEDERADO.nwd\",\"unidades\":\"m\",\"ejeArriba\":\"Z\",\"origen\":[520116,9384802,11],\"herramienta\":\"PruebaPaquete\"}", P);
            G.Dispose();
            RespuestaSubida sub; using (var s = new MemoryStream(Encoding.UTF8.GetBytes("NWD de prueba"))) sub = cli.Subir(a[2], a[3], s, "", "{\"navisworks\":\"prueba\"}");
            string sid = cli.IndiceInicio(a[2], sub.Version, "{\"modelos\":[" + string.Join(",", P.Modelos.Select(ClienteCde.Cadena)) + "],\"elementos\":" + P.Elementos + ",\"parametros\":" + P.Parametros + ",\"pares\":" + P.Pares + ",\"origen\":\"complemento-navisworks\"}");
            foreach (var t in P.Trozos) cli.IndiceTrozo(a[2], sub.Version, sid, t);
            using (var g = File.OpenRead(P.RutaGeometria)) cli.Geometria(a[2], sub.Version, sid, g);
            cli.IndiceFin(a[2], sub.Version, sid);
            Console.WriteLine("{\"version\":\"" + sub.Version + "\",\"elementos\":" + P.Elementos + ",\"conGeometria\":" + P.ConGeometria + ",\"triangulos\":" + P.Triangulos + ",\"vertices\":" + P.Vertices + ",\"simplificados\":" + G.Simplificados + ",\"antes\":" + G.TriangulosAntes + "}");
            return 0;
        }
        /// <summary>Sin servidor: rejilla comun de 1 cm y tope total de 20.000 triangulos sobre un modelo de unos 60.000. Con
        /// 'hilos' los elementos se simplifican en otros hilos (como en Navisworks); con 'aligera', con 1 cm al cerrarlos.</summary>
        static int Tope(int hilos, bool aligera)
        {
            var org = new[] { 520116.0, 9384802.0, 11.0 };
            var G = new GeometriaCde(org) { TopePorElemento = 6000, Celda = 0.01, TopeTotal = 20000, Hilos = hilos, AligeraAlLeer = aligera };
            var P = new PaqueteCde();
            G.Empieza(1); Caja(G, 520116, 9384802, 11, 4, 0.15, 3, new byte[] { 245, 245, 245, 255 });          // muro: 12 triangulos, intacto
            G.Empieza(2); Caja(G, 520116, 9384805, 11, 1, 1, 1, new byte[] { 120, 120, 120, 255 });              // caja con 500 tornillos de 2 mm
            for (int k = 0; k < 500; k++) { double x = 520116.2035 + (k % 25) * 0.03, z = 11.2035 + (k / 25) * 0.03; G.Triangulo(new[] { x, 9384804.99, z }, new[] { x + 0.002, 9384804.99, z }, new[] { x, 9384804.99, z + 0.002 }, null, null, null, new byte[] { 90, 90, 90, 255 }); }
            for (int e = 3; e <= 10; e++) { G.Empieza(e); Esfera(G, 520116 + 3 * e, 9384802 + 10, 12, 0.5, 60, 60, new byte[] { 200, 60, 60, 255 }); }   // 7.200 cada una
            G.Empieza(11); Caja(G, 520150, 9384802, 11, 1, 1, 1, new byte[] { 245, 245, 245, 255 }); Esfera(G, 520152, 9384802, 12, 0.5, 60, 60, new byte[] { 0, 128, 192, 64 });   // opaco + vidrio
            G.Empieza(12); Esfera(G, 520156, 9384802, 12, 0.5, 60, 60, new byte[] { 250, 250, 250, 77 });   // todo vidrio
            // 13) marco de ventana de 1 x 1 m con vano de 0,8 m, muy teselado (cada barra en 10 x 10 caras): al aligerar no debe
            //     aparecer ningun triangulo cruzando el vano (antes se veian "vidrios rotos")
            G.Empieza(13); byte[] gris = { 200, 200, 200, 255 };
            Barra(G, 520160.0, 9384802, 11.0, 1.0, 0.05, 0.1, gris); Barra(G, 520160.0, 9384802, 11.9, 1.0, 0.05, 0.1, gris);
            Barra(G, 520160.0, 9384802, 11.1, 0.1, 0.05, 0.8, gris); Barra(G, 520160.9, 9384802, 11.1, 0.1, 0.05, 0.8, gris);
            // 14) con 'aligera': un arbol dibujado solo con lineas (como los arboles CAD 3D de Revit): 12.000 segmentos en una copa
            //     de 3 m sobre un tronco; el tope de lineas (2.000) los junta sin perder la silueta
            if (aligera)
            {
                G.TopeLineas = 2000; G.Empieza(14); var rnd = new Random(7); byte[] verde = { 60, 140, 60, 255 }, cafe = { 110, 80, 50, 255 };
                for (int k = 0; k < 40; k++) G.Linea(new[] { 520170.0, 9384802, 11 + k * 0.05 }, new[] { 520170.0, 9384802, 11 + (k + 1) * 0.05 }, cafe);
                for (int k = 0; k < 12000; k++)
                {
                    double th = rnd.NextDouble() * Math.PI * 2, ph = Math.Acos(2 * rnd.NextDouble() - 1), r = 1.5 * Math.Pow(rnd.NextDouble(), 0.3);
                    double x = 520170 + r * Math.Sin(ph) * Math.Cos(th), y = 9384802 + r * Math.Sin(ph) * Math.Sin(th), z = 14.5 + r * Math.Cos(ph);
                    G.Linea(new[] { x, y, z }, new[] { x + 0.06 * Math.Cos(th), y + 0.06 * Math.Sin(th), z + 0.04 }, verde);
                }
                // 15) ventana con 4 vidrios de DOS caras (la de atras con los mismos vertices, como los exporta Revit): el marco muy
                //     teselado obliga a aligerar; ningun vidrio debe perder la mitad (antes quedaban triangulos sueltos)
                G.Empieza(15); byte[] marco = { 200, 200, 200, 255 }, vid = { 0, 128, 192, 64 };
                Barra(G, 520180.0, 9384802, 11.0, 1.0, 0.05, 0.1, marco); Barra(G, 520180.0, 9384802, 11.9, 1.0, 0.05, 0.1, marco);
                Barra(G, 520180.0, 9384802, 11.1, 0.1, 0.05, 0.8, marco); Barra(G, 520180.9, 9384802, 11.1, 0.1, 0.05, 0.8, marco);
                for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++)
                {
                    double x0 = 520180.1 + i * 0.4, z0 = 11.1 + j * 0.4, yv = 9384802.025;
                    double[] a = { x0, yv, z0 }, b = { x0 + 0.4, yv, z0 }, c = { x0 + 0.4, yv, z0 + 0.4 }, d = { x0, yv, z0 + 0.4 }, nf = { 0, -1.0, 0 }, nb = { 0, 1.0, 0 };
                    G.Triangulo(a, b, c, nf, nf, nf, vid); G.Triangulo(a, c, d, nf, nf, nf, vid); G.Triangulo(a, c, b, nb, nb, nb, vid); G.Triangulo(a, d, c, nb, nb, nb, vid);
                }
            }
            string ruta = G.Escribe("{\"modelo\":\"TOPE.nwd\",\"unidades\":\"m\",\"ejeArriba\":\"Z\",\"origen\":[520116,9384802,11]}", P);
            G.Dispose();
            Console.WriteLine("{\"ruta\":" + ClienteCde.Cadena(ruta) + ",\"leidos\":" + G.Triangulos + ",\"sinTope\":" + G.TriangulosSinTope + ",\"triangulos\":" + P.Triangulos + ",\"vertices\":" + P.Vertices + ",\"elementos\":" + P.ConGeometria + ",\"simplificados\":" + G.Simplificados + ",\"segmentos\":" + P.Segmentos + ",\"segmentosLeidos\":" + G.SegmentosLeidos + ",\"conLineas\":" + P.ConLineas + "}");
            return 0;
        }
        /// <summary>Una caja con cada cara partida en 10 x 10 (muchos triangulos coplanares, como una malla importada).</summary>
        static void Barra(GeometriaCde G, double x, double y, double z, double dx, double dy, double dz, byte[] c)
        {
            const int N = 10;
            Action<double[], double[], double[], double[]> cara = (o0, u, v, n) =>
            {
                for (int i = 0; i < N; i++) for (int j = 0; j < N; j++)
                {
                    Func<int, int, double[]> p = (a, b) => new[] { o0[0] + u[0] * a / N + v[0] * b / N, o0[1] + u[1] * a / N + v[1] * b / N, o0[2] + u[2] * a / N + v[2] * b / N };
                    G.Triangulo(p(i, j), p(i + 1, j), p(i + 1, j + 1), n, n, n, c); G.Triangulo(p(i, j), p(i + 1, j + 1), p(i, j + 1), n, n, n, c);
                }
            };
            cara(new[] { x, y, z }, new[] { 0, 0, dz }, new[] { dx, 0, 0 }, new[] { 0.0, -1, 0 }); cara(new[] { x, y + dy, z }, new[] { dx, 0, 0 }, new[] { 0, 0, dz }, new[] { 0.0, 1, 0 });
            cara(new[] { x, y, z }, new[] { dx, 0, 0 }, new[] { 0, dy, 0 }, new[] { 0.0, 0, -1 }); cara(new[] { x, y, z + dz }, new[] { 0, dy, 0 }, new[] { dx, 0, 0 }, new[] { 0.0, 0, 1 });
            cara(new[] { x, y, z }, new[] { 0, dy, 0 }, new[] { 0, 0, dz }, new[] { -1.0, 0, 0 }); cara(new[] { x + dx, y, z }, new[] { 0, 0, dz }, new[] { 0, dy, 0 }, new[] { 1.0, 0, 0 });
        }
        static void Esfera(GeometriaCde G, double cx, double cy, double cz, double r, int nLat, int nLon, byte[] c)
        {
            Func<int, int, double[]> pt = (i, j) => { double th = Math.PI * i / nLat, ph = 2 * Math.PI * j / nLon; return new[] { cx + r * Math.Sin(th) * Math.Cos(ph), cy + r * Math.Sin(th) * Math.Sin(ph), cz + r * Math.Cos(th) }; };
            Func<double[], double[]> nr = (p) => new[] { (p[0] - cx) / r, (p[1] - cy) / r, (p[2] - cz) / r };
            for (int i = 0; i < nLat; i++) for (int j = 0; j < nLon; j++)
            {
                double[] a = pt(i, j), b = pt(i + 1, j), d = pt(i + 1, j + 1), e = pt(i, j + 1);
                G.Triangulo(a, b, d, nr(a), nr(b), nr(d), c); G.Triangulo(a, d, e, nr(a), nr(d), nr(e), c);
            }
        }
        /// <summary>Una caja de 12 triangulos con normales por cara (coordenadas del mundo, en metros).</summary>
        static void Caja(GeometriaCde G, double x, double y, double z, double dx, double dy, double dz, byte[] c)
        {
            double[][] v = { new[] { x, y, z }, new[] { x + dx, y, z }, new[] { x + dx, y + dy, z }, new[] { x, y + dy, z }, new[] { x, y, z + dz }, new[] { x + dx, y, z + dz }, new[] { x + dx, y + dy, z + dz }, new[] { x, y + dy, z + dz } };
            int[][] caras = { new[] { 0, 3, 2, 1 }, new[] { 4, 5, 6, 7 }, new[] { 0, 1, 5, 4 }, new[] { 2, 3, 7, 6 }, new[] { 1, 2, 6, 5 }, new[] { 3, 0, 4, 7 } };
            double[][] n = { new[] { 0.0, 0, -1 }, new[] { 0.0, 0, 1 }, new[] { 0.0, -1, 0 }, new[] { 0.0, 1, 0 }, new[] { 1.0, 0, 0 }, new[] { -1.0, 0, 0 } };
            for (int k = 0; k < 6; k++) { var f = caras[k]; G.Triangulo(v[f[0]], v[f[1]], v[f[2]], n[k], n[k], n[k], c); G.Triangulo(v[f[0]], v[f[2]], v[f[3]], n[k], n[k], n[k], c); }
        }
    }
}
