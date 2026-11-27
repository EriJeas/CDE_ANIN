/*
 * NWD / NWC TRAIDOS DE FORMA: QUE ES ELEMENTO, COMO EN NAVISWORKS (y como el complemento de Navisworks del CDE).
 *
 * El indice se arma con el extractor del visor (compartido-visor, sin cambios) a partir de la base de propiedades de la
 * traduccion de Autodesk. Su regla toma por elemento al primer nodo que "declara" categoria. En un NWD de Revit los nodos de
 * TIPO (en Navisworks, icono "Collection") traen la pestana "Tipo" con su "Categoria": quedaban como elementos y todas sus
 * instancias (cada muro, cada losa) como partes del tipo. En el BM de 100020 eran 4.666 "elementos" con geometria.
 *
 * Navisworks escribe en cada nodo que es (Item / Icon): File, Layer y Collection son AGRUPACION; el primer objeto debajo
 * (Composite Object, Insert Group o Geometry) es el ELEMENTO: lo que Navisworks selecciona con la resolucion "Primer objeto"
 * y lo que el complemento de Navisworks publica como elemento (ExtractorNavis.cs). Lo de abajo de un elemento es PARTE y
 * hereda su clasificacion (como hace el extractor al cerrar el indice).
 *
 * La clasificacion de cada elemento nuevo (categoria, familia, tipo, nivel, modelo) sale con el MISMO Resumen.clasifica del
 * extractor: sus propiedades (en el orden de la base) y, si faltan, el arbol anclado del visor. Los elementos que ya lo eran
 * quedan como estaban.
 *
 * v0.13.8: solo cuenta como elemento el objeto que tiene GEOMETRIA en el o debajo: la regla del Visor BIM ("solo cuentan los
 * nodos con geometria"). v0.13.10: como en el complemento de Navisworks (LineaAuxiliar), una malla siempre cuenta y unas lineas
 * cuentan salvo que sean auxiliares: los "Eje" de los modelos MEP (lineas de centro de tuberias, tubos y ductos que Revit
 * exporta como objetos aparte: 63.280 en el BM de 100020), rejillas, lineas analiticas, de separacion o de contorno. La
 * vegetacion dibujada con lineas (arboles CAD 3D) y los escudos si son elementos. Que nodos tienen malla o lineas lo dice el
 * navegador.
 *
 * El arbol (el padre de cada nodo, con los ids de la base de propiedades) lo entrega el navegador: el visor de Autodesk lo
 * tiene entero y la base de propiedades ya no esta en el servidor. Antes de tocar nada se comprueba que ese arbol
 * corresponde al indice (las partes deben colgar de su elemento de antes).
 */
'use strict';
const { recorre, recorreSt } = require('../compartido-visor/recorre');   // v0.25.6: recorrido sin «statement has been finalized» (Node 22.13)
const X = require('../compartido-visor/extractor-modelos');

/* v0.29.0 (navisworks-4): las líneas auxiliares (ejes, líneas de centro) TAMBIÉN son elementos, como en Autodesk Forma, donde se ven y se
 * seleccionan: quedan en su categoría («Center line», «Eje»…) y entran en filtros e inventario. `lineaAuxiliar` sigue diciendo cuáles son
 * (el visor propio las usa para no dibujarlas en el nivel de detalle normal). */
const MARCA = 'navisworks-4';
/** Categorias cuyas lineas son auxiliares (no se dibujan ni hacen elemento): las del complemento de Navisworks (LineaAuxiliar). */
function lineaAuxiliar(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return !c || c === '(sin categoria)' || c.includes('eje') || c.includes('grid') || c.includes('center line') || c.includes('centerline') || c.includes('linea de centro') || c.includes('línea de centro')
    || c.includes('analit') || c.includes('analyt') || c === 'lines' || c === 'lineas' || c === 'líneas' || c.includes('separa') || c.includes('boundary') || c.includes('contorno');
}
const RX_GRUPO = /^(file|layer|collection|group|archivo|capa|colecci[oó]n|grupo)$/i;

/**
 * db: DatabaseSync (lectura y escritura) del indice. padre: Int32Array (padre[id] = id del padre; 0 = raiz o sin dato).
 * avance(texto). malla: Uint8Array opcional (malla[id]: 1 si el nodo tiene geometria solida propia, 2 si solo lineas, 3 ambas).
 * Devuelve { aplicado, ya, motivo, elementos, antes, grupos, promovidos, degradados, sinMalla, comprobacion }.
 */
function reclasifica(db, padre, avance, malla) {
  const av = (t) => { try { avance && avance(t); } catch (e) {} };
  const meta = (k) => { try { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? String(r.v) : ''; } catch (e) { return ''; } };
  const cuenta = () => Number((db.prepare('SELECT COUNT(*) AS n FROM elem WHERE clase = 1').get() || {}).n) || 0;
  if (meta('arbol') === MARCA) return { aplicado: true, ya: true, elementos: cuenta() };
  // 1) ¿es de Navisworks? (Item / Icon con nodos de agrupacion)
  const aIcono = db.prepare("SELECT id FROM attr WHERE lower(grupo) IN ('item', 'elemento') AND lower(n) IN ('icon', 'icono')").all().map(r => Number(r.id));
  if (!aIcono.length) return { aplicado: false, motivo: 'sin-iconos', elementos: cuenta() };
  const vGrupo = [];
  for (const a of aIcono) for (const r of db.prepare('SELECT DISTINCT eav.v AS v, val.v AS t FROM eav JOIN val ON val.id = eav.v WHERE eav.a = ?').all(a)) if (RX_GRUPO.test(String(r.t || '').trim())) vGrupo.push(Number(r.v));
  if (!vGrupo.length) return { aplicado: false, motivo: 'sin-grupos', elementos: cuenta() };
  // 2) lo que el indice ya tiene
  av('Leyendo el índice…');
  let maxE = 0; for (const r of recorre(db, 'SELECT MAX(e) AS m FROM elem')) maxE = Number(r.m) || 0;
  const N = Math.max(maxE + 1, padre.length);
  const existe = new Uint8Array(N), clase0 = new Uint8Array(N), anc0 = new Int32Array(N);
  let filas = 0;
  for (const r of recorre(db, 'SELECT e, clase, anc FROM elem')) { const e = Number(r.e); if (e <= 0 || e >= N) continue; existe[e] = 1; clase0[e] = Number(r.clase) || 0; anc0[e] = Number(r.anc) || 0; filas++; }
  const P = (id) => (id > 0 && id < padre.length ? padre[id] : 0);
  // 3) el arbol corresponde al indice: casi todos los nodos tienen padre y las partes cuelgan de su elemento de antes
  let conPadre = 0, raices = 0; for (let e = 1; e < N; e++) if (existe[e]) { if (P(e) > 0) conPadre++; else raices++; }
  let mPartes = 0, enCadena = 0;
  for (let e = 1, paso = Math.max(1, Math.floor(N / 20000)); e < N; e += paso) {
    if (!existe[e] || clase0[e] !== 2 || !anc0[e]) continue; mPartes++;
    let p = P(e), k = 0; while (p > 0 && k++ < 60) { if (p === anc0[e]) { enCadena++; break; } p = P(p); }
  }
  const comprobacion = { filas, conPadre, raices, partesMuestra: mPartes, partesEnCadena: enCadena };
  if (filas && (filas - conPadre > Math.max(5, filas * 0.1) || (mPartes >= 3 && enCadena < mPartes * 0.95))) {
    const e = new Error('El árbol que entregó el visor de Autodesk no corresponde al índice (' + conPadre + ' de ' + filas + ' nodos con padre; ' + enCadena + ' de ' + mPartes + ' partes bajo su elemento): no se reordena el índice.');
    e.comprobacion = comprobacion; throw e;
  }
  // 4) agrupacion de Navisworks (Archivo, Capa, Coleccion)
  const esGrupo = new Uint8Array(N); let nGrupos = 0;
  for (const a of aIcono) { const st = db.prepare('SELECT e FROM eav WHERE a = ? AND v = ?'); for (const v of vGrupo) for (const r of recorreSt(st, a, v)) { const e = Number(r.e); if (e > 0 && e < N && !esGrupo[e]) { esGrupo[e] = 1; nGrupos++; } } }
  // 5) de arriba abajo: el primer nodo con propiedades que no es agrupacion es el elemento; lo de abajo, parte
  av('Ordenando los elementos como Navisworks…');
  const prof = new Uint16Array(N);
  for (let e = 1; e < N; e++) {
    if (prof[e] || (!existe[e] && !P(e))) continue;
    const cad = []; let n = e, t = 0;
    while (n > 0 && !prof[n] && t++ < 200) { cad.push(n); n = P(n); }
    let d = n > 0 ? prof[n] : 0; for (let k = cad.length - 1; k >= 0; k--) prof[cad[k]] = ++d;
  }
  let maxP = 0; for (let e = 1; e < N; e++) if (prof[e] > maxP) maxP = prof[e];
  const cuantos = new Uint32Array(maxP + 2); for (let e = 1; e < N; e++) if (prof[e]) cuantos[prof[e]]++;
  const ini = new Uint32Array(maxP + 2); for (let d = 1; d <= maxP; d++) ini[d + 1] = ini[d] + cuantos[d];
  const orden = new Int32Array(ini[maxP + 1]); { const pos = ini.slice(); for (let e = 1; e < N; e++) if (prof[e]) orden[pos[prof[e]]++] = e; }
  // geometria en el nodo o debajo (de abajo arriba): bit 1 malla, bit 2 lineas. Si el navegador no la mando, no se usa.
  let sub = null, nMalla = 0;
  if (malla && malla.length) { for (let e = 1; e < Math.min(N, malla.length); e++) if (malla[e]) nMalla++; }
  if (nMalla > 0) {
    sub = new Uint8Array(N); for (let e = 1; e < Math.min(N, malla.length); e++) sub[e] = malla[e] & 3;
    for (let k = orden.length - 1; k >= 0; k--) { const e = orden[k], p = P(e); if (sub[e] && p > 0 && p < N) sub[p] |= sub[e]; }
  }
  const stCat = db.prepare('SELECT cat FROM elem WHERE e = ?');
  const flag = new Uint8Array(N), anc = new Int32Array(N); let sinMalla = 0, deLineas = 0, auxiliares = 0;
  for (let k = 0; k < orden.length; k++) {
    const e = orden[k], p = P(e);
    if (p > 0 && flag[p]) { flag[e] = 2; anc[e] = flag[p] === 1 ? p : anc[p]; continue; }
    if (!existe[e] || esGrupo[e] || !(p > 0)) continue;
    if (!sub || (sub[e] & 1)) { flag[e] = 1; continue; }
    // sin malla pero con líneas: es elemento (v0.29.0: también las auxiliares, como en Forma); sin ninguna geometría, no lo es (ni lo de abajo)
    if (sub[e] & 2) { flag[e] = 1; deLineas++; if (lineaAuxiliar((stCat.get(e) || {}).cat)) auxiliares++; continue; }
    if (esGrupo[p]) sinMalla++;
  }
  let nuevos = 0, promovidos = 0, degradados = 0;
  const promovido = new Uint8Array(N);
  for (let e = 1; e < N; e++) { if (flag[e] === 1) { nuevos++; if (clase0[e] !== 1) { promovido[e] = 1; promovidos++; } } else if (existe[e] && clase0[e] === 1) degradados++; }
  // 6) la clasificacion de los elementos nuevos: como el extractor (sus propiedades, en el orden de la base; si faltan, el arbol)
  av('Clasificando ' + promovidos.toLocaleString('es-PE') + ' elementos…');
  const cl = X.clasificadores();
  const porClase = { cat: [], fam: [], tip: [], niv: [], arch: [] };
  for (const r of db.prepare('SELECT id, grupo, n FROM attr ORDER BY id').all()) { const c = X.claseDe(String(r.grupo || '') + ' / ' + String(r.n || '')); if (porClase[c]) porClase[c].push(Number(r.id)); }
  const propio = {}; for (const c of Object.keys(porClase)) propio[c] = new Int32Array(promovidos ? N : 1);
  if (promovidos) for (const c of Object.keys(porClase)) { const st = db.prepare('SELECT e, v FROM eav WHERE a = ?'), arr = propio[c]; for (const a of porClase[c]) for (const r of recorreSt(st, a)) { const e = Number(r.e); if (e > 0 && e < N && promovido[e] && !arr[e]) arr[e] = Number(r.v); } }
  const stVal = db.prepare('SELECT v FROM val WHERE id = ?'), cacheV = new Map();
  const valDe = (id) => { if (!id) return ''; let v = cacheV.get(id); if (v === undefined) { const r = stVal.get(id); v = r && r.v != null ? String(r.v) : ''; if (cacheV.size < 200000) cacheV.set(id, v); } return v; };
  const declaradas = new Set();
  for (const a of porClase.cat) for (const r of recorre(db, 'SELECT DISTINCT v FROM eav WHERE a = ?', a)) { const t = valDe(Number(r.v)).trim(); if (t) declaradas.add(cl.norm('Categoria', t)); }
  // el arbol para el Resumen del extractor: padres del navegador, nombres del indice
  const nHijos = new Uint32Array(N); for (let e = 1; e < N; e++) { const p = P(e); if (p > 0 && p < N) nHijos[p]++; }
  const raicesL = []; for (let e = 1; e < N; e++) if (!P(e) && nHijos[e]) raicesL.push(e);
  const stNom = db.prepare('SELECT nombre FROM elem WHERE e = ?'), cacheN = new Map();
  const nombre = (id) => { let v = cacheN.get(id); if (v === undefined) { const r = stNom.get(id); v = r && r.nombre != null ? String(r.nombre) : ''; if (cacheN.size < 300000) cacheN.set(id, v); } return v; };
  const ix = { padre: { get: (id) => P(id) || undefined, has: (id) => P(id) > 0 }, nombre: { get: nombre }, hijos: { get: (id) => (id > 0 && id < N ? nHijos[id] : 0), has: (id) => id > 0 && id < N && existe[id] === 1 },
    raizId: raicesL.length === 1 ? raicesL[0] : 0, raices: raicesL, hojas: () => { const h = []; for (let e = 1; e < N; e++) if (existe[e] && !nHijos[e]) h.push(e); return h; }, size: N };
  const R = new X.Resumen(cl, ix, 'nwd');
  if (promovidos) R.aprende(declaradas);
  const CLAVE = { cat: '__category__ / Category', fam: 'Elemento / Familia', tip: 'Elemento / Tipo', niv: 'Elemento / Nivel', arch: 'Item / Source File' };
  // 7) se escribe todo en una transaccion (si algo falla, el indice queda como estaba)
  av('Guardando el índice…');
  const stModelo = db.prepare('SELECT modelo FROM elem WHERE e = ?');
  db.exec('BEGIN');
  try {
    const upC = db.prepare('UPDATE elem SET clase = ?, anc = ? WHERE e = ?'), upK = db.prepare('UPDATE elem SET cat = ?, fam = ?, tip = ?, niv = ?, modelo = ? WHERE e = ?');
    for (let e = 1; e < N; e++) {
      if (!existe[e]) continue;
      const c = flag[e], a = c === 2 ? anc[e] : 0;
      if (c !== clase0[e] || a !== anc0[e]) upC.run(c, a, e);
      if (promovido[e]) {
        const pares = []; for (const k of Object.keys(CLAVE)) { const v = valDe(propio[k][e]); if (String(v).trim()) pares.push([CLAVE[k], v]); }
        const r = R.clasifica(e, pares, false), m = stModelo.get(e);
        upK.run(r.cat, r.fam, r.tip, r.niv, r.archivo || (m && m.modelo) || '(un solo archivo)', e);
      }
    }
    // las partes heredan la clasificacion de su elemento (la misma sentencia del extractor al cerrar el indice)
    db.exec('UPDATE elem SET cat = p.cat, fam = p.fam, tip = p.tip, niv = p.niv, modelo = p.modelo FROM (SELECT e, cat, fam, tip, niv, modelo FROM elem WHERE clase = 1) AS p WHERE elem.clase = 2 AND elem.anc = p.e');
    const im = db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
    im.run('arbol', MARCA); im.run('arbol_elementos_antes', String(cuentaAntes(clase0))); im.run('arbol_grupos', String(nGrupos)); im.run('arbol_sin_malla', String(sinMalla)); im.run('arbol_de_lineas', String(deLineas));
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (x) {} throw e; }
  return { aplicado: true, ya: false, elementos: nuevos, antes: cuentaAntes(clase0), grupos: nGrupos, promovidos, degradados, sinMalla, deLineas, auxiliares, conMalla: nMalla, comprobacion };
}
function cuentaAntes(clase0) { let n = 0; for (let e = 0; e < clase0.length; e++) if (clase0[e] === 1) n++; return n; }

/** El arbol que llega del navegador. Pura. Formato CDA2: 'CDA2', n (uint32), padre (Int32 x n), malla (Uint8 x n). Sin cabecera
 *  (v0.13.7): solo el padre (Int32 x n). Devuelve { padre, malla } o lanza un error si no llego completo. */
function leeArbol(buf) {
  if (buf.length >= 8 && buf.toString('latin1', 0, 4) === 'CDA2') {
    const n = buf.readUInt32LE(4); if (buf.length < 8 + n * 5) throw new Error('El árbol del modelo no llegó completo.');
    const padre = new Int32Array(n); for (let i = 0; i < n; i++) padre[i] = buf.readInt32LE(8 + i * 4);
    const malla = new Uint8Array(buf.buffer.slice(buf.byteOffset + 8 + n * 4, buf.byteOffset + 8 + n * 5));
    return { padre, malla };
  }
  if (!buf.length || buf.length % 4) throw new Error('El árbol del modelo no llegó completo.');
  const n = buf.length / 4, padre = new Int32Array(n);
  for (let i = 0; i < n; i++) padre[i] = buf.readInt32LE(i * 4);
  return { padre, malla: null };
}

module.exports = { reclasifica, leeArbol, lineaAuxiliar, MARCA, RX_GRUPO };
