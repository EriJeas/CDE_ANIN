/* Copia TAL CUAL de app.js del Visor BIM Federado (lineas 11507-11527): UTM inversa. No se edita aqui. */
/** UTM inversa a latitud/longitud (WGS84). */
function utmALatLon(E, N, zona, sur) {
  const a = 6378137, f = 1 / 298.257223563;
  const k0 = 0.9996, e2 = f * (2 - f), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000, y = sur ? N - 10000000 : N;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
                + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
                + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const C1 = (e2 / (1 - e2)) * Math.cos(p1) ** 2;
  const T1 = Math.tan(p1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) ** 2, 1.5);
  const D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) *
    (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D ** 4 / 24
     + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6
     + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return { lat: lat * 180 / Math.PI, lon: (zona * 6 - 183) + lon * 180 / Math.PI };
}
