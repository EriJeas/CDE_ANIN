/*
 * TABLAS DE PLANIFICACIÓN: la receta y su cálculo sobre el índice de un modelo (v0.32.1: aparte, para correr en el hilo de consultas).
 * Receta: { pestanas: [campo…] (hasta 3, opcional), grupos: [campo…] (1 a 8), cantidades: [{ campo, etiqueta }] (hasta 6) }.
 * Campo: { tipo: 'dim', dim: modelo|cat|fam|tip|niv } o { tipo: 'param', nombre } (por nombre: los ids cambian de un índice a otro).
 */
const { recorre } = require('../compartido-visor/recorre');
const DIMS = ['modelo', 'cat', 'fam', 'tip', 'niv'];
const campo = (c) => { if (!c || typeof c !== 'object') return null; if (c.tipo === 'dim' && DIMS.includes(c.dim)) return { tipo: 'dim', dim: c.dim }; const n = String(c.nombre || '').trim().slice(0, 300); return c.tipo === 'param' && n ? { tipo: 'param', nombre: n } : null; };
function receta(t) {
  t = t || {};
  const pestanas = (Array.isArray(t.pestanas) ? t.pestanas : (t.pestanas ? [t.pestanas] : [])).map(campo).filter(Boolean).slice(0, 3);   /* antes era un solo campo */
  const grupos = (Array.isArray(t.grupos) ? t.grupos : []).map(campo).filter(Boolean).slice(0, 8);
  const cantidades = (Array.isArray(t.cantidades) ? t.cantidades : []).map(c => { const k = campo(c && c.campo); return k && k.tipo === 'param' ? { campo: k, etiqueta: String((c.etiqueta || '')).trim().slice(0, 60) } : null; }).filter(Boolean).slice(0, 6);
  return { pestanas, grupos, cantidades };
}
/** El número de un valor de cantidad («12,50 m²», «1,234.5 m3», «3») y su unidad. «1,234» es mil doscientos treinta y cuatro. Pura. */
function numero(v) {
  const s = String(v == null ? '' : v).trim(), m = /^(-?[\d.,\s]*\d)\s*(.*)$/.exec(s); if (!m) return null;
  let t = m[1].replace(/\s/g, ''); const pc = t.lastIndexOf(','), pp = t.lastIndexOf('.');
  if (pc >= 0 && pp >= 0) t = pc > pp ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (pc >= 0) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  const n = Number(t); return Number.isFinite(n) ? { n, u: m[2].trim().slice(0, 12) } : null;
}
/** Calcula la tabla. Los textos van por diccionario (un entero por elemento y columna): un federado de cientos de miles de elementos cabe. */
function calcula(db, t) {
  const R = receta(t), campos = R.pestanas.concat(R.grupos); if (!R.grupos.length) { const e = new Error('La tabla necesita al menos un nivel de agrupación.'); e.datos = true; throw e; }
  const N = Number(db.prepare('SELECT COUNT(*) AS n FROM elem WHERE clase = 1').get().n) || 0, ids = new Int32Array(N), pos = new Map();
  const dic = [''], dicI = new Map([['', 0]]), iv = (s) => { let k = dicI.get(s); if (k == null) { k = dic.length; dic.push(s); dicI.set(s, k); } return k; };
  const dims = {}; for (const c of campos) if (c.tipo === 'dim' && !dims[c.dim]) dims[c.dim] = new Int32Array(N);
  let k = 0; for (const r of recorre(db, 'SELECT e, modelo, cat, fam, tip, niv FROM elem WHERE clase = 1 ORDER BY e')) { if (k >= N) break; ids[k] = Number(r.e); pos.set(ids[k], k); for (const d of Object.keys(dims)) dims[d][k] = iv(String(r[d] || '')); k++; }
  const idsDe = db.prepare('SELECT id FROM attr WHERE nombre = ?'), faltan = [];
  const columna = (nombre, comoTexto) => {
    const as = idsDe.all(nombre).map(r => Number(r.id)); if (!as.length) { faltan.push(nombre); return null; }
    const col = comoTexto ? new Array(N).fill('') : new Int32Array(N);
    for (const a of as) for (const r of recorre(db, 'SELECT eav.e AS e, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ?', a)) { const p = pos.get(Number(r.e)); if (p == null || col[p] || r.v == null || String(r.v) === '') continue; col[p] = comoTexto ? String(r.v) : iv(String(r.v)); }
    return col;
  };
  const cols = campos.map(c => c.tipo === 'dim' ? dims[c.dim] : (columna(c.nombre, false) || new Int32Array(N)));
  const cant = R.cantidades.map(c => columna(c.campo.nombre, true)), unidades = R.cantidades.map(() => new Map());
  const hojas = new Map(); let sinValor = 0;
  for (let p = 0; p < N; p++) {
    let clave = '', vacio = false; for (const c of cols) { const x = c[p]; if (!x) vacio = true; clave += x + ','; } if (vacio) sinValor++;
    let h = hojas.get(clave); if (!h) { h = { k: cols.map(c => dic[c[p]]), n: 0, q: R.cantidades.map(() => 0), sinQ: R.cantidades.map(() => 0), es: [] }; hojas.set(clave, h); }
    h.n++; h.es.push(ids[p]);
    for (let j = 0; j < cant.length; j++) { const x = cant[j] ? numero(cant[j][p]) : null; if (x) { h.q[j] += x.n; if (x.u) unidades[j].set(x.u, (unidades[j].get(x.u) || 0) + 1); } else h.sinQ[j]++; }
  }
  return { total: N, sinValor, faltan: [...new Set(faltan)], nPestanas: R.pestanas.length, conPestanas: R.pestanas.length > 0, niveles: campos.length, unidades: unidades.map(m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0])), hojas: [...hojas.values()] };
}
module.exports = { receta, campo, numero, calcula };
