/*
 * HILO APARTE: arma el indice de parametros de un modelo traido de Autodesk Forma a partir de la traduccion que Autodesk ya
 * tiene del archivo (su base de propiedades), con el MISMO extractor del visor (compartido-visor/extractor-modelos.js, sin
 * cambios): las cifras (categorias, familias, tipos, niveles, llenado) salen como en el visor. Va en un hilo porque la base
 * de propiedades de un NWD federado pesa cientos de MB y SQLite en Node es sincrono: el servidor no se congela.
 *
 * workerData: { token, base, urn, archivo, rutaIndice, dirTemporal, region, maxMb }
 * mensajes al servidor: { avance: { texto, n } } · { pideToken: true } · { ok, resumen } · { ok: false, error }
 * del servidor: { token }
 */
'use strict';
const { parentPort, workerData: W } = require('worker_threads');
const X = require('../compartido-visor/extractor-modelos');

let token = W.token, esperaToken = null;
parentPort.on('message', (m) => { if (m && m.token) { token = m.token; if (esperaToken) { esperaToken(); esperaToken = null; } } });
const renueva = () => new Promise((ok) => { esperaToken = ok; parentPort.postMessage({ pideToken: true }); setTimeout(ok, 30000); });
const duerme = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** En la region EMEA, Model Derivative va por /regions/eu/. */
const regional = (u) => W.region === 'EMEA' ? String(u).replace('/modelderivative/v2/designdata/', '/modelderivative/v2/regions/eu/designdata/') : String(u);

async function pide(url, opciones) {
  for (let intento = 0; ; intento++) {
    const o = Object.assign({}, opciones || {}); o.headers = Object.assign({ Authorization: 'Bearer ' + token }, (opciones && opciones.headers) || {});
    const r = await fetch(regional(url), o);
    if (r.status === 401 && intento < 2) { await renueva(); continue; }
    if ((r.status === 429 || r.status === 503) && intento < 6) { await duerme(Math.min(30, Number(r.headers.get('retry-after')) || 2 * (intento + 1)) * 1000); continue; }
    return r;
  }
}
const json = async (r) => {
  if (r.status === 202 || r.ok) return r.json().catch(() => ({}));
  const t = await r.text().catch(() => ''); const e = new Error('Autodesk respondio ' + r.status + (t ? ': ' + t.slice(0, 200) : '')); e.status = r.status; throw e;
};
const api = {
  get: async (u) => json(await pide(u)),
  post: async (u, cuerpo) => json(await pide(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })),
  crudo: (u) => pide(u),
};

(async () => {
  try {
    const R = await X.extraeModelo(api, W.base, W.urn, W.archivo, (texto, n) => parentPort.postMessage({ avance: { texto: String(texto || '').slice(0, 300), n: Number(n) || 0 } }),
      { rutaIndice: W.rutaIndice, dirTemporal: W.dirTemporal, maxMb: W.maxMb || undefined });
    try { require('../compartido-visor/indice-modelos').cierra(W.rutaIndice); } catch (e) {}   // suelta el indice (en Windows no se mueve un archivo abierto)
    const c = (R && R.completitud) || {};
    parentPort.postMessage({ ok: true, resumen: { nodos: (R.indice || {}).nodos || 0, pares: (R.indice || {}).pares || 0, elementos: Number(R.elementos || (R.totales || {}).elementos) || 0, origen: R.origen || '', vista: (R.vista || {}).nombre || '', completo: c.completo !== false, avisos: (c.avisos || []).slice(0, 5) } });
  } catch (e) { parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 1500) }); }
})();
