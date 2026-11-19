/*
 * COMPARAR DOS VERSIONES DE UN MODELO (lo que hace "Comparar versiones" del Visor BIM Federado, aqui sobre los indices
 * SQLite del CDE, sin abrir el modelo en Autodesk).
 *
 * Reglas (las de comparar-versiones.js del visor):
 *  - los elementos se reconocen por su UniqueId de Revit ("Identidad / UniqueId" en el indice): el que esta en la nueva
 *    y no en la vieja es NUEVO; al reves, ELIMINADO; en las dos, IGUAL o MODIFICADO segun cambien sus parametros;
 *  - los parametros volatiles no cuentan ("Editado por": cambia con solo abrir el modelo);
 *  - dos numeros iguales con distinto texto (3.5 y 3.50) son el mismo valor;
 *  - un parametro que cambia en (casi) TODOS los elementos emparejados (el nombre del archivo, la fecha de exportacion)
 *    no es un cambio de los elementos: se aparta y se informa como "cambio global" para no pintar todo el modelo.
 * La geometria (se movio / cambio de tamano) la decide el visor con las cajas de la geometria liviana de cada version
 * (cvCambioGeo) porque ahi ya tiene los triangulos; aqui solo parametros.
 *
 * Resultado: { elementos: [{ uid, eA, eB, nom, cat, fam, tip, niv, e, c: [{ p, antes, ahora }] }], resumen, globales, ... }
 * Se guarda en cache junto al indice nuevo (<indiceB>.cmp-<vidA>.json) y se reutiliza mientras no cambien los indices.
 */
'use strict';
const fs = require('fs');
const I = require('../compartido-visor/indice-modelos');

const VOLATIL = /(^|\/\s*)(editado por|edited by)\s*$/i;
const GLOBAL_MIN_PARES = 20, GLOBAL_PARTE = 0.95;

const norma = (s) => String(s == null ? '' : s).trim();
const numDe = (s) => { const t = norma(s).replace(/\s*(m³|m²|m|mm|cm|°|%)\s*$/i, '').replace(/,/g, '.'); return /^[-+]?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; };
/** ¿Mismo valor? Numeros con tolerancia relativa (3.5 = 3.50 = 3.5000001); textos exactos tras recortar espacios. Pura. */
function mismoValor(a, b) {
  const A = norma(a), B = norma(b);
  if (A === B) return true;
  const x = numDe(A), y = numDe(B);
  if (x != null && y != null) return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  return false;
}

/** uid -> e y e -> uid de los elementos (clase 1) de un indice; null si el indice no trae UniqueId. */
function mapaUid(db) {
  const a = db.prepare("SELECT id FROM attr WHERE nombre LIKE '%UniqueId' ORDER BY id LIMIT 1").get();
  if (!a) return null;
  const porUid = new Map(), uidDe = new Map();
  for (const r of db.prepare('SELECT eav.e AS e, val.v AS v FROM eav JOIN val ON val.id = eav.v JOIN elem el ON el.e = eav.e WHERE eav.a = ? AND el.clase = 1').iterate(Number(a.id))) {
    const e = Number(r.e), uid = norma(r.v); if (!uid) continue;
    if (porUid.has(uid)) continue;   // un uid repetido no empareja (no se sabe cual es cual)
    porUid.set(uid, e); uidDe.set(e, uid);
  }
  return { attr: Number(a.id), porUid, uidDe };
}
/** e -> valores del parametro (distintos, ordenados, unidos con " · "), como la celda del inventario. */
function valoresDe(db, idAttr) {
  const m = new Map();
  for (const r of db.prepare('SELECT eav.e AS e, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ?').iterate(idAttr)) {
    const e = Number(r.e), v = norma(r.v); if (!v) continue;
    const l = m.get(e); if (!l) m.set(e, [v]); else if (!l.includes(v)) l.push(v);
  }
  for (const [e, l] of m) m.set(e, l.length === 1 ? l[0] : l.sort().join(' · '));
  return m;
}

/** El resumen (cvResumen del visor, sin geometria): totales, por categoria y por parametro. Pura. */
function resumen(elems) {
  const tot = { nuevo: 0, eliminado: 0, modificado: 0, igual: 0, par: 0 }, porCat = new Map(), porPar = new Map();
  for (const x of elems) {
    tot[x.e] = (tot[x.e] || 0) + 1;
    const cat = x.cat || '(sin categoría)';
    let o = porCat.get(cat); if (!o) { o = { cat, nuevo: 0, eliminado: 0, modificado: 0, igual: 0 }; porCat.set(cat, o); }
    o[x.e]++;
    if (x.e === 'modificado' && x.c.length) { tot.par++; for (const c of x.c) porPar.set(c.p, (porPar.get(c.p) || 0) + 1); }
  }
  const cambios = (o) => o.nuevo + o.eliminado + o.modificado;
  return { tot, porCat: [...porCat.values()].sort((a, b) => cambios(b) - cambios(a) || b.igual - a.igual || a.cat.localeCompare(b.cat, 'es')), porPar: [...porPar].map(([p, n]) => ({ p, n })).sort((a, b) => b.n - a.n || a.p.localeCompare(b.p, 'es')) };
}

/** Compara el indice viejo (rutaA) con el nuevo (rutaB). Lanza si falta el UniqueId. */
function compara(rutaA, rutaB) {
  const t0 = Date.now(), A = I.abre(rutaA), B = I.abre(rutaB);
  const ua = mapaUid(A), ub = mapaUid(B);
  if (!ua || !ub) throw new Error('Una de las versiones no trae "Identidad / UniqueId" en su indice: publicala otra vez desde Revit con el complemento actual.');
  const infoDe = (db) => { const m = new Map(); for (const r of db.prepare('SELECT e, nombre, cat, fam, tip, niv, modelo FROM elem WHERE clase = 1').iterate()) m.set(Number(r.e), r); return m; };
  const ia = infoDe(A), ib = infoDe(B);
  const out = new Map();   // uid -> fila
  const fila = (uid, eA, eB, r, e) => ({ uid, eA, eB, nom: String((r && r.nombre) || ''), cat: String((r && r.cat) || ''), fam: String((r && r.fam) || ''), tip: String((r && r.tip) || ''), niv: String((r && r.niv) || ''), e, c: [] });
  for (const [uid, eB] of ub.porUid) { const eA = ua.porUid.get(uid); out.set(uid, fila(uid, eA == null ? null : eA, eB, ib.get(eB), eA == null ? 'nuevo' : 'igual')); }
  for (const [uid, eA] of ua.porUid) if (!ub.porUid.has(uid)) out.set(uid, fila(uid, eA, null, ia.get(eA), 'eliminado'));
  const pares = [...out.values()].filter(x => x.eA != null && x.eB != null);
  // parametros: la union por nombre, uno a la vez (memoria acotada)
  const attrs = (db) => { const m = new Map(); for (const r of db.prepare('SELECT id, nombre FROM attr').all()) if (!m.has(String(r.nombre))) m.set(String(r.nombre), Number(r.id)); return m; };
  const aa = attrs(A), ab = attrs(B), nombres = [...new Set([...aa.keys(), ...ab.keys()])].sort((x, y) => x.localeCompare(y, 'es'));
  const globales = [];
  for (const nombre of nombres) {
    if (VOLATIL.test(nombre) || /UniqueId$/i.test(nombre)) continue;
    const va = aa.has(nombre) ? valoresDe(A, aa.get(nombre)) : new Map(), vb = ab.has(nombre) ? valoresDe(B, ab.get(nombre)) : new Map();
    const cambios = [];
    for (const x of pares) {
      const sa = va.get(x.eA) || '', sb = vb.get(x.eB) || '';
      if (!mismoValor(sa, sb)) cambios.push([x, sa, sb]);
    }
    if (!cambios.length) continue;
    if (pares.length >= GLOBAL_MIN_PARES && cambios.length / pares.length >= GLOBAL_PARTE) { globales.push({ p: nombre, n: cambios.length, ejemplo: { antes: cambios[0][1], ahora: cambios[0][2] } }); continue; }
    for (const [x, sa, sb] of cambios) { x.c.push({ p: nombre, antes: sa, ahora: sb }); x.e = 'modificado'; }
  }
  const ORDEN = { nuevo: 0, eliminado: 1, modificado: 2, igual: 3 };
  const elementos = [...out.values()].sort((a, b) => ORDEN[a.e] - ORDEN[b.e] || a.cat.localeCompare(b.cat, 'es') || a.nom.localeCompare(b.nom, 'es'));
  return { elementos, resumen: resumen(elementos), globales, sinUid: { a: ia.size - ua.porUid.size, b: ib.size - ub.porUid.size }, ms: Date.now() - t0, cuando: new Date().toISOString() };
}

/** Con cache: la comparacion de dos indices, guardada junto al nuevo mientras no cambie ninguno de los dos. */
function comparaConCache(rutaA, rutaB, claveA) {
  const cache = rutaB + '.cmp-' + String(claveA).replace(/[^\w.-]/g, '_') + '.json';
  const marca = () => { try { return fs.statSync(rutaA).mtimeMs + ':' + fs.statSync(rutaB).mtimeMs; } catch (e) { return ''; } };
  try { const c = JSON.parse(fs.readFileSync(cache, 'utf8')); if (c && c.marca === marca()) return c; } catch (e) {}
  const r = compara(rutaA, rutaB); r.marca = marca();
  try { fs.writeFileSync(cache, JSON.stringify(r)); } catch (e) {}
  return r;
}

/** Las filas del CSV/Excel: una por elemento (y una por parametro cambiado si se pide detalle). Pura. */
function filas(res, meta, detalle) {
  const M = meta || {}, cab = ['Estado', 'Categoría', 'Nombre', 'Familia', 'Tipo', 'Nivel', 'UniqueId', 'Id nueva', 'Id antigua', 'Cambios'];
  const out = [cab];
  for (const x of res.elementos) {
    if (x.e === 'igual' && !M.conIguales) continue;
    out.push([x.e, x.cat, x.nom, x.fam, x.tip, x.niv, x.uid, x.eB == null ? '' : x.eB, x.eA == null ? '' : x.eA, x.c.map(c => c.p + ': ' + c.antes + ' → ' + c.ahora).join(' | ')]);
  }
  if (!detalle) return out;
  const det = [['Categoría', 'Nombre', 'UniqueId', 'Parámetro', 'Antes', 'Ahora']];
  for (const x of res.elementos) for (const c of x.c) det.push([x.cat, x.nom, x.uid, c.p, c.antes, c.ahora]);
  return { elementos: out, parametros: det };
}

module.exports = { compara, comparaConCache, mismoValor, resumen, filas, VOLATIL };
