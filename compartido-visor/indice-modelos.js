/*
 * v1.371 — CONSULTAS SOBRE EL INDICE DE UN MODELO (el SQLite que deja la extraccion: extractor-modelos.js, Indice).
 * Lo que el visor calcula en el navegador con su indice (llenado de parametros, inventario, filtros), aqui se
 * calcula en el servidor con SQL, sin abrir el modelo. Las reglas son las del visor:
 *  - el AMBITO se cruza con Y (modelo y familia y tipo y categoria y nivel), como llenAmbito;
 *  - un valor que es hueco ("-", "N/A"...; y "0" si se pide) no cuenta como lleno, como llenHueco (valh lo
 *    marca con la propia funcion del visor al armar el indice);
 *  - un elemento cuenta UNA vez por parametro aunque tenga varios valores (NWD), como llenCuenta;
 *  - la columna del inventario lleva todos los valores del elemento unidos con " · " y calla el relleno
 *    ("NO CORRESPONDE") si hay valor real al lado, como invColumn (INV_RELLENO del visor).
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');

const ABIERTOS = new Map();   // ruta -> { db, t }
const MAX_ABIERTOS = 6;
function abre(ruta) {
  const a = ABIERTOS.get(ruta);
  if (a) { a.t = Date.now(); return a.db; }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  try { db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-8192;'); } catch (e) {}   // v1.377: memoria acotada (Render: 512 MB); lo que no cabe va a disco (SQLITE_TMPDIR)
  if (ABIERTOS.size >= MAX_ABIERTOS) { const vieja = [...ABIERTOS.entries()].sort((x, y) => x[1].t - y[1].t)[0]; try { vieja[1].db.close(); } catch (e) {} ABIERTOS.delete(vieja[0]); }
  ABIERTOS.set(ruta, { db, t: Date.now() });
  return db;
}
function cierra(ruta) { const a = ABIERTOS.get(ruta); if (a) { try { a.db.close(); } catch (e) {} ABIERTOS.delete(ruta); } }

const CAMPOS = { modelo: 'modelo', cat: 'cat', fam: 'fam', tip: 'tip', niv: 'niv' };
/** Los filtros limpios: { modelo: [..], cat: [..], ... } (solo los campos conocidos, textos no vacios). Pura. */
function filtrosLimpios(q) {
  const out = {};
  for (const k of Object.keys(CAMPOS)) {
    let v = (q || {})[k]; if (v == null || v === '') continue;
    if (!Array.isArray(v)) v = String(v).split('\u0001');
    v = v.map(x => String(x)).filter(x => x !== '').slice(0, 50);
    if (v.length) out[k] = v;
  }
  out.ambito = (q || {}).ambito === 'todos' ? 'todos' : 'elem';
  return out;
}
/** El WHERE sobre elem (alias el) para unos filtros; `sin` deja fuera un campo (para el grafico de ese campo). Pura. */
function donde(f, sin) {
  const partes = [], args = [];
  // v1.373: 'todos' = el universo del visor (sus nodos con categoria: elementos, sus partes y los contenedores que la declaran); 'elem' = solo elementos
  if (f.ambito !== 'todos') partes.push('el.clase = 1'); else partes.push("(el.clase IN (1, 2) OR el.cat <> '(sin categoria)')");
  for (const k of Object.keys(CAMPOS)) {
    if (k === sin || !f[k]) continue;
    partes.push('el.' + CAMPOS[k] + ' IN (' + f[k].map(() => '?').join(',') + ')'); args.push(...f[k]);
  }
  return { sql: partes.length ? ' WHERE ' + partes.join(' AND ') : '', args };
}
const huella = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);

/*
 * v1.377 — EL INDICE QUE SUBE EL VISOR SE CONSULTA COMO LO HACE EL VISOR (con SUS reglas, sobre SUS datos):
 *  - los graficos cuentan, por cada valor de ● Categoria / ● Familia / ● Tipo / ● Nivel / ● Modelo, los elementos que
 *    tienen ESE valor (como el tablero del visor: no hay barra "sin categoria"; un elemento con dos niveles cuenta en
 *    los dos, como en el visor);
 *  - los filtros se cruzan con Y entre campos y con O entre valores de un campo (llenAmbito);
 *  - sin filtros, el universo del llenado (y el "en el ambito") son los elementos con ● Categoria (llenUniverso, v1.332:
 *    nunca mas de 100%); con filtros, los que pasan los filtros.
 * Todo sale de la tabla eav con los parametros canonicos que el visor subio tal cual ("● Categoria"...). Los indices
 * armados en el servidor (base de propiedades / API) siguen con sus reglas de siempre (columnas de elem).
 */
const CANON_N = { modelo: '● Modelo', cat: '● Categoria', fam: '● Familia', tip: '● Tipo', niv: '● Nivel' };
const INFO = new WeakMap();   // db -> { visor, canon }
function info(db) {
  let x = INFO.get(db); if (x) return x;
  const m = {}; try { for (const r of db.prepare('SELECT k, v FROM meta').all()) m[r.k] = r.v; } catch (e) {}
  const canon = {};
  if (m.origen === 'visor') {
    const nombres = Object.values(CANON_N);
    for (const r of db.prepare('SELECT id, nombre FROM attr WHERE nombre IN (' + nombres.map(() => '?').join(',') + ')').all(...nombres))
      for (const k of Object.keys(CANON_N)) if (CANON_N[k] === String(r.nombre)) canon[k] = Number(r.id);
  }
  x = { visor: m.origen === 'visor', canon };
  INFO.set(db, x); return x;
}
/** llenAmbito, en SQL: los elementos que pasan los filtros (sin el campo `sin`); null si no hay filtros. Pura. */
function ambitoV(x, f, sin) {
  const partes = [], args = [];
  for (const k of Object.keys(CANON_N)) {
    if (k === sin || !f[k] || !x.canon[k]) continue;   // como llenAmbito: un campo que el modelo no tiene no filtra
    partes.push('SELECT e FROM eav WHERE a = ? AND v IN (SELECT id FROM val WHERE v IN (' + f[k].map(() => '?').join(',') + '))');
    args.push(x.canon[k], ...f[k]);
  }
  return partes.length ? { sql: partes.join(' INTERSECT '), args } : null;
}
/** "solo elementos": ademas, en ● Modelo. Pura. */
function soloElemV(x, f, u) {
  if (f.ambito !== 'elem' || !x.canon.modelo) return u;
  return u ? { sql: u.sql + ' INTERSECT SELECT e FROM eav WHERE a = ?', args: u.args.concat([x.canon.modelo]) } : { sql: 'SELECT e FROM eav WHERE a = ?', args: [x.canon.modelo] };
}
/** El universo del llenado, del inventario y del "en el ambito": llenAmbito || llenUniverso (● Categoria). Pura. */
function universoV(x, f) {
  let u = ambitoV(x, f);
  if (!u) u = x.canon.cat ? { sql: 'SELECT e FROM eav WHERE a = ?', args: [x.canon.cat] } : { sql: 'SELECT e FROM elem', args: [] };
  return soloElemV(x, f, u);
}
function tableroV(db, x, f) {
  const out = { filtros: f, total: 0, dims: {}, comoVisor: true };
  const U = universoV(x, f);
  out.total = Number(db.prepare('SELECT COUNT(DISTINCT e) AS n FROM (' + U.sql + ')').get(...U.args).n) || 0;
  for (const k of Object.keys(CAMPOS)) {
    const a = x.canon[k]; if (!a) { out.dims[k] = []; continue; }
    const Uk = soloElemV(x, f, ambitoV(x, f, k));
    out.dims[k] = db.prepare('SELECT val.v AS k, COUNT(DISTINCT eav.e) AS n FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ?' + (Uk ? ' AND eav.e IN (' + Uk.sql + ')' : '') + ' GROUP BY eav.v ORDER BY n DESC, val.v LIMIT 300')
      .all(a, ...(Uk ? Uk.args : [])).map(r => [String(r.k == null ? '' : r.k), Number(r.n)]);
  }
  return out;
}

/** Los conteos de cada dimension (cada grafico sin su propio filtro, con los demas) y el total del ambito. */
function tablero(ruta, filtros) {
  const db = abre(ruta), f = filtrosLimpios(filtros), x = info(db);
  if (x.visor) { const o = tableroV(db, x, f); const mm = {}; for (const r of db.prepare('SELECT k, v FROM meta').all()) mm[r.k] = r.v; o.meta = mm; return o; }   // v1.377
  const out = { filtros: f, total: 0, dims: {} };
  const w = donde(f);
  out.total = Number(db.prepare('SELECT COUNT(*) AS n FROM elem el' + w.sql).get(...w.args).n) || 0;
  for (const k of Object.keys(CAMPOS)) {
    const wk = donde(f, k);
    out.dims[k] = db.prepare('SELECT el.' + CAMPOS[k] + ' AS k, COUNT(*) AS n FROM elem el' + wk.sql + ' GROUP BY 1 ORDER BY 2 DESC LIMIT 300').all(...wk.args).map(r => [String(r.k == null ? '' : r.k), Number(r.n)]);
  }
  const m = {}; for (const r of db.prepare('SELECT k, v FROM meta').all()) m[r.k] = r.v;
  out.meta = m;
  return out;
}
/** Todos los parametros del indice (id y nombre como el visor). */
function parametros(ruta) {
  return abre(ruta).prepare('SELECT id, nombre FROM attr ORDER BY nombre COLLATE NOCASE').all().map(r => ({ id: Number(r.id), nombre: String(r.nombre) }));
}
const MUESTRA = 12, HUECOS_MUESTRA = 6;
/**
 * El llenado de parametros del ambito: una fila por parametro { param, llenos, valores, total, muestra, masValores,
 * huecos, pct }, como llenFila del visor. Se guarda en cache (junto al indice) por filtros.
 */
function llenado(ruta, filtros, conCero) {
  const f = filtrosLimpios(filtros), cero = !!conCero;
  const db = abre(ruta), x = info(db), VER = x.visor ? 2 : 1;   // v1.377: el del visor, con sus reglas (version 2 de la cache)
  const cache = ruta + '.c-' + huella({ f, cero }) + '.json';
  try { const c = JSON.parse(fs.readFileSync(cache, 'utf8')); if (c && c.version === VER) return c; } catch (e) {}
  let total, base, bargs;
  if (x.visor) {
    const U = universoV(x, f);
    total = Number(db.prepare('SELECT COUNT(DISTINCT e) AS n FROM (' + U.sql + ')').get(...U.args).n) || 0;
    base = 'FROM eav LEFT JOIN valh h ON h.id = eav.v WHERE eav.e IN (' + U.sql + ')'; bargs = U.args;
  } else {
    const w = donde(f);
    total = Number(db.prepare('SELECT COUNT(*) AS n FROM elem el' + w.sql).get(...w.args).n) || 0;
    base = 'FROM eav JOIN elem el ON el.e = eav.e LEFT JOIN valh h ON h.id = eav.v' + w.sql; bargs = w.args;
  }
  const t0 = Date.now();
  // hueco = esta en valh y (no es "cero", o se piden los ceros como vacio)
  const esHueco = '(h.id IS NOT NULL AND (h.cero = 0 OR ' + (cero ? '1' : '0') + '))';
  const porAttr = db.prepare('SELECT eav.a AS a, COUNT(DISTINCT CASE WHEN NOT ' + esHueco + ' THEN eav.e END) AS llenos, COUNT(DISTINCT CASE WHEN NOT ' + esHueco + ' THEN eav.v END) AS valores ' + base + ' GROUP BY eav.a').all(...bargs);
  const tops = db.prepare('SELECT a, v, n, hu FROM (SELECT eav.a AS a, eav.v AS v, COUNT(DISTINCT eav.e) AS n, ' + esHueco + ' AS hu, ' +
    'ROW_NUMBER() OVER (PARTITION BY eav.a, ' + esHueco + ' ORDER BY COUNT(DISTINCT eav.e) DESC, eav.v) AS rn ' + base + ' GROUP BY eav.a, eav.v) WHERE (hu = 0 AND rn <= ' + MUESTRA + ') OR (hu = 1 AND rn <= ' + HUECOS_MUESTRA + ')').all(...bargs);
  const vals = new Map(); for (const r of db.prepare('SELECT id, v FROM val WHERE id IN (' + [...new Set(tops.map(t => Number(t.v)))].join(',') + ')').all()) vals.set(Number(r.id), String(r.v == null ? '' : r.v));
  const nombres = new Map(); for (const r of db.prepare('SELECT id, nombre FROM attr').all()) nombres.set(Number(r.id), String(r.nombre));
  const porA = new Map();
  for (const t of tops) { const a = Number(t.a); if (!porA.has(a)) porA.set(a, { muestra: [], huecos: [] }); (Number(t.hu) ? porA.get(a).huecos : porA.get(a).muestra).push({ v: vals.get(Number(t.v)) || '', n: Number(t.n) }); }
  const filas = [];
  for (const r of porAttr) {
    const a = Number(r.a), llenos = Math.min(total, Number(r.llenos) || 0), valores = Number(r.valores) || 0, x = porA.get(a) || { muestra: [], huecos: [] };
    filas.push({ id: a, param: nombres.get(a) || ('#' + a), llenos, valores, total, muestra: x.muestra, masValores: Math.max(0, valores - x.muestra.length), huecos: x.huecos, pct: total ? +(100 * llenos / total).toFixed(1) : 0 });
  }
  // los parametros del indice que no tienen ni un valor en el ambito tambien van (llenos 0), como en el visor
  for (const [a, nombre] of nombres) if (!porA.has(a) && !porAttr.find(r => Number(r.a) === a)) filas.push({ id: a, param: nombre, llenos: 0, valores: 0, total, muestra: [], masValores: 0, huecos: [], pct: 0 });
  const out = { version: VER, filtros: f, conCero: cero, total, filas, ms: Date.now() - t0, cuando: new Date().toISOString(), comoVisor: x.visor };
  try { fs.writeFileSync(cache, JSON.stringify(out)); } catch (e) {}
  return out;
}
/** Los valores de UN parametro en el ambito, de mas a menos elementos ({ v, n, hueco }). */
function valores(ruta, filtros, idParam, conCero, limite) {
  const db = abre(ruta), f = filtrosLimpios(filtros), cero = !!conCero, x = info(db);
  const hu = '(h.id IS NOT NULL AND (h.cero = 0 OR ' + (cero ? '1' : '0') + '))';
  let rows;
  if (x.visor) {   // v1.377: el universo del visor
    const U = universoV(x, f);
    rows = db.prepare('SELECT val.v AS v, COUNT(DISTINCT eav.e) AS n, ' + hu + ' AS hu FROM eav JOIN val ON val.id = eav.v LEFT JOIN valh h ON h.id = eav.v WHERE eav.a = ? AND eav.e IN (' + U.sql + ') GROUP BY eav.v ORDER BY n DESC, val.v LIMIT ' + (Number(limite) || 3000)).all(Number(idParam), ...U.args);
  } else {
    const w = donde(f);
    rows = db.prepare('SELECT val.v AS v, COUNT(DISTINCT eav.e) AS n, ' + hu + ' AS hu FROM eav JOIN elem el ON el.e = eav.e JOIN val ON val.id = eav.v LEFT JOIN valh h ON h.id = eav.v' +
      (w.sql ? w.sql + ' AND' : ' WHERE') + ' eav.a = ? GROUP BY eav.v ORDER BY n DESC, val.v LIMIT ' + (Number(limite) || 3000)).all(...w.args, Number(idParam));
  }
  const nombre = (db.prepare('SELECT nombre FROM attr WHERE id = ?').get(Number(idParam)) || {}).nombre || '';
  return { param: String(nombre), valores: rows.map(r => ({ v: String(r.v == null ? '' : r.v), n: Number(r.n), hueco: !!Number(r.hu) })) };
}
let INV_RELLENO = null;
function relleno() {
  if (INV_RELLENO) return INV_RELLENO;
  try { const C = { RegExp }; vm.createContext(C); INV_RELLENO = vm.runInContext(require('./reporte-forma').fuentesComunes(['INV_RELLENO']) + '\n;INV_RELLENO;', C); if (!(INV_RELLENO instanceof RegExp) && !(INV_RELLENO && INV_RELLENO.test)) throw new Error('sin INV_RELLENO'); }
  catch (e) { INV_RELLENO = /^(no corresponde|n\/?a|s\/?n|sin\s+(dato|informacion|información|partida|valor)|ninguno|nulo|null|-+|—+|\.+)$/i; }
  return INV_RELLENO;
}
/** La celda de una columna: todos los valores distintos del elemento, sin el relleno si hay valor real (invColumn del visor). Pura. */
function celda(lista) {
  const reales = lista.length > 1 ? lista.filter(v => !relleno().test(String(v).trim())) : lista;
  const arr = reales.length ? reales : lista;
  return arr.slice().sort((a, b) => a.localeCompare(b)).join(' · ');
}
const INV_TOPE = 3000;
/** El inventario: filas del ambito (y de las categorias marcadas), con las columnas pedidas (ids de attr), buscador y tope. */
function inventario(ruta, filtros, opciones) {
  const db = abre(ruta), f = filtrosLimpios(filtros), op = opciones || {};
  const cats = (Array.isArray(op.cats) ? op.cats : String(op.cats || '').split('\u0001')).filter(Boolean).slice(0, 200);
  const cols = (Array.isArray(op.cols) ? op.cols : String(op.cols || '').split(',')).map(Number).filter(x => x > 0).slice(0, 40);
  const x = info(db);
  let w = donde(f);
  if (x.visor) { const U = universoV(x, f); w = { sql: ' WHERE el.e IN (' + U.sql + ')', args: U.args }; }   // v1.377: el universo del visor
  let cond = w.sql;   // v1.377: el conteo se arma aparte (con el universo del visor hay otro FROM dentro y el reemplazo por texto rompia la consulta)
  const args = w.args.slice();
  if (cats.length) { cond += (w.sql ? ' AND' : ' WHERE') + ' el.cat IN (' + cats.map(() => '?').join(',') + ')'; args.push(...cats); }
  const sql = 'SELECT el.e AS e, el.nombre AS nombre, el.modelo AS modelo, el.cat AS cat, el.fam AS fam, el.tip AS tip, el.niv AS niv FROM elem el' + cond;
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM elem el' + cond).get(...args).n) || 0;
  const filas = db.prepare(sql + ' ORDER BY el.e LIMIT ' + INV_TOPE).all(...args).map(r => ({ e: Number(r.e), nombre: String(r.nombre || ''), modelo: String(r.modelo || ''), cat: String(r.cat || ''), fam: String(r.fam || ''), tip: String(r.tip || ''), niv: String(r.niv || ''), c: {} }));
  const porE = new Map(filas.map(x => [x.e, x]));
  const ids = filas.map(x => x.e);
  const nombres = new Map(); for (const r of db.prepare('SELECT id, nombre FROM attr').all()) nombres.set(Number(r.id), String(r.nombre));
  for (const a of cols) {
    if (!nombres.has(a)) continue;
    const junta = new Map();
    for (let i = 0; i < ids.length; i += 900) {
      const parte = ids.slice(i, i + 900);
      for (const r of db.prepare('SELECT DISTINCT eav.e AS e, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ? AND eav.e IN (' + parte.map(() => '?').join(',') + ')').all(a, ...parte)) {
        const e = Number(r.e); if (!junta.has(e)) junta.set(e, []); junta.get(e).push(String(r.v == null ? '' : r.v));
      }
    }
    for (const [e, lista] of junta) { const x = porE.get(e); if (x) x.c[a] = celda(lista); }
  }
  const q = String(op.q || '').toLowerCase().trim();
  const vis = q ? filas.filter(x => (x.nombre + ' ' + x.modelo + ' ' + x.cat + ' ' + x.niv + ' ' + Object.values(x.c).join(' ')).toLowerCase().includes(q)) : filas;
  const catsTodas = db.prepare('SELECT el.cat AS k, COUNT(*) AS n FROM elem el' + w.sql + ' GROUP BY 1 ORDER BY 2 DESC').all(...w.args).map(r => [String(r.k == null ? '' : r.k), Number(r.n)]);
  return { total, mostradas: vis.length, tope: INV_TOPE, filas: vis, cols: cols.filter(a => nombres.has(a)).map(a => ({ id: a, nombre: nombres.get(a) })), cats: catsTodas };
}

/*
 * v1.372 — EL RESUMEN DE PARAMETROS (lo que antes contaba JavaScript nodo a nodo), calculado por SQLite sobre el indice
 * recien armado: por parametro, cuantos elementos lo tienen, valores distintos, los 60 mas frecuentes y su reparto por
 * categoria; y una muestra de 1.500 elementos repartida por todo el modelo. Es lo que guarda el resumen (params,
 * catsCobertura, indiceMuestra, muestra) para la vista sin indice y para el CSV de parametros.
 */
function resumenDesdeIndice(ruta, cats) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  try { db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-8192;'); } catch (e) {}   // v1.377: memoria acotada
  try {
    const nombres = new Map(); for (const r of db.prepare('SELECT id, nombre FROM attr').all()) nombres.set(Number(r.id), String(r.nombre));
    const catsL = (cats || []).slice(0, 40), posCat = new Map(catsL.map((c, i) => [c, i]));
    const P = new Map();
    const fila = (a) => { let p = P.get(a); if (!p) { p = { k: nombres.get(a) || ('#' + a), llenos: 0, vacios: 0, distintos: 0, otros: 0, valores: [], num: null, porCat: catsL.map(() => 0) }; P.set(a, p); } return p; };
    for (const r of db.prepare('SELECT eav.a AS a, el.cat AS cat, COUNT(DISTINCT eav.e) AS n FROM eav JOIN elem el ON el.e = eav.e WHERE el.clase = 1 GROUP BY eav.a, el.cat').iterate()) {
      const p = fila(Number(r.a)), n = Number(r.n); p.llenos += n; const i = posCat.get(String(r.cat)); if (i != null) p.porCat[i] = n;
    }
    for (const r of db.prepare('SELECT eav.a AS a, COUNT(DISTINCT eav.v) AS n FROM eav JOIN elem el ON el.e = eav.e WHERE el.clase = 1 GROUP BY eav.a').iterate()) fila(Number(r.a)).distintos = Number(r.n);
    const tops = db.prepare('SELECT a, v, n FROM (SELECT eav.a AS a, eav.v AS v, COUNT(DISTINCT eav.e) AS n, ROW_NUMBER() OVER (PARTITION BY eav.a ORDER BY COUNT(DISTINCT eav.e) DESC, eav.v) AS rn FROM eav JOIN elem el ON el.e = eav.e WHERE el.clase = 1 GROUP BY eav.a, eav.v) WHERE rn <= 60').all();
    const vids = [...new Set(tops.map(t => Number(t.v)))], vals = new Map();
    for (let i = 0; i < vids.length; i += 900) for (const r of db.prepare('SELECT id, v FROM val WHERE id IN (' + vids.slice(i, i + 900).join(',') + ')').all()) vals.set(Number(r.id), String(r.v == null ? '' : r.v));
    for (const t of tops) fila(Number(t.a)).valores.push([vals.get(Number(t.v)) || '', Number(t.n)]);
    for (const p of P.values()) p.otros = Math.max(0, p.distintos - p.valores.length);
    const params = [...P.values()].sort((a, b) => b.llenos - a.llenos);
    // la muestra: 1.500 elementos repartidos por todo el modelo, con todos sus valores
    const nElem = Number((db.prepare('SELECT COUNT(*) AS n FROM elem WHERE clase = 1').get() || {}).n) || 0;
    const paso = Math.max(1, Math.floor(nElem / 1500));
    const filas = db.prepare('SELECT e, nombre, cat, fam, tip, niv, modelo FROM (SELECT e, nombre, cat, fam, tip, niv, modelo, ROW_NUMBER() OVER (ORDER BY e) AS rn FROM elem WHERE clase = 1) WHERE (rn - 1) % ? = 0 LIMIT 1500').all(paso)
      .map(r => ({ n: String(r.nombre || ''), id: Number(r.e), c: String(r.cat || ''), f: String(r.fam || ''), t: String(r.tip || ''), v: String(r.niv || ''), a: String(r.modelo || ''), p: {} }));
    const porE = new Map(filas.map(f => [f.id, f])), indice = [], posParam = new Map(), ids = filas.map(f => f.id);
    for (let i = 0; i < ids.length; i += 900) for (const r of db.prepare('SELECT eav.e AS e, eav.a AS a, val.v AS v FROM eav JOIN val ON val.id = eav.v WHERE eav.e IN (' + ids.slice(i, i + 900).join(',') + ')').iterate()) {
      const f = porE.get(Number(r.e)); if (!f) continue; const a = Number(r.a), k = nombres.get(a) || ('#' + a);
      let j = posParam.get(k); if (j == null) { j = indice.length; indice.push(k); posParam.set(k, j); }
      if (!(j in f.p)) f.p[j] = String(r.v == null ? '' : r.v).slice(0, 200);
    }
    return { params, catsCobertura: catsL, indiceMuestra: indice, muestra: filas };
  } finally { try { db.close(); } catch (e) {} }
}

/** v1.377: las cifras del resumen de un indice del visor, como las cuenta el visor (graficos sin filtros; elementos = ● Modelo). */
function resumenVisor(ruta) {
  const db = abre(ruta), x = info(db);
  if (!x.visor) return null;
  const t = tableroV(db, x, filtrosLimpios({ ambito: 'todos' }));
  const elementos = x.canon.modelo ? Number(db.prepare('SELECT COUNT(DISTINCT e) AS n FROM eav WHERE a = ?').get(x.canon.modelo).n) || 0 : Number(db.prepare('SELECT COUNT(*) AS n FROM elem WHERE clase = 1').get().n) || 0;
  const objetos = Number(db.prepare('SELECT COUNT(*) AS n FROM elem').get().n) || 0;
  return { elementos, objetos, categorias: t.dims.cat, familias: t.dims.fam, tipos: t.dims.tip, niveles: t.dims.niv, archivos: t.dims.modelo };
}
module.exports = { abre, cierra, tablero, parametros, llenado, valores, inventario, filtrosLimpios, donde, celda, resumenDesdeIndice, resumenVisor, info, universoV, ambitoV };
