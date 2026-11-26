/*
 * v1.359 — "MODELOS DEO - ESTUDIOS": EXTRAER LOS PARAMETROS DE UN MODELO SIN ABRIRLO.
 *
 * El servidor le pide a Autodesk (Model Derivative) la traduccion que ya existe del modelo (RVT, NWD o
 * IFC): su arbol de objetos y sus propiedades, por paginas, y las RESUME mientras las lee (un modelo de
 * 2,7 millones de elementos no cabe entero en memoria). La clasificacion (archivo, categoria, familia,
 * tipo) usa las MISMAS funciones puras del visor (app.js: esNombreDeArchivo, normValue,
 * posCategoriaDeclarada, capasHastaCategoria, clasificaAnclado), para que las cifras coincidan con
 * lo que muestra el visor. Lo guardado es un resumen para analizar: por parametro (llenado, vacios,
 * valores mas frecuentes, numeros), por categoria, familia, tipo y nivel, y una muestra de elementos.
 */
'use strict';
const { recorre, recorreSt } = require('./recorre');   // v0.25.6: recorrido sin «statement has been finalized» (Node 22.13)
const vm = require('vm');

const MAX_VALORES = 60;        // valores distintos que se cuentan por parametro (el resto: "otros")
const MAX_CATS_COBERTURA = 40; // categorias en la matriz parametro x categoria
const MAX_MUESTRA = 1500;      // elementos guardados enteros (para la tabla)
const MAX_TOP = 300;           // familias / tipos / niveles

/** Las funciones del visor, en un contexto propio. */
function clasificadores() {
  const txt = require('./reporte-forma').fuentesComunes(['RX_ARCHIVO', 'esNombreDeArchivo', 'CATEGORIA_BASURA', 'TIPO_GENERICO', 'sinTildes', 'esTipoGenerico', 'normValue',
    'posCategoriaDeclarada', 'capasHastaCategoria', 'clasificaAnclado']);
  const C = { String, Set, Map, Math, RegExp, Array, Object, Number };
  vm.createContext(C); vm.runInContext(txt, C);
  return { esArchivo: C.esNombreDeArchivo, norm: C.normValue, posCat: C.posCategoriaDeclarada, capas: C.capasHastaCategoria, anclado: C.clasificaAnclado };
}

/** La vista 3D a leer: la "maestra" si la hay, si no la primera 3D. Pura. */
function eligeVista(meta) {
  const l = (((meta || {}).data || {}).metadata || []).filter(v => String(v.role || '').toLowerCase() === '3d');
  return l.find(v => v.isMasterView) || l[0] || null;
}

/** El arbol de objetos -> padre y nombre por objectid. Pura. */
function indexaArbol(arbol) {
  const padre = new Map(), nombre = new Map(), hijos = new Map();
  const raiz = (((arbol || {}).data || {}).objects || []);
  const pila = raiz.map(o => [o, 0]);
  while (pila.length) {
    const [o, p] = pila.pop();
    nombre.set(o.objectid, String(o.name || ''));
    if (p) padre.set(o.objectid, p);
    const hs = o.objects || [];
    hijos.set(o.objectid, hs.length);
    for (const h of hs) pila.push([h, o.objectid]);
  }
  const raizId = raiz.length === 1 ? raiz[0].objectid : 0;
  return { padre, nombre, hijos, raizId };
}

/** Los nombres de los antecesores (sin la raiz), de arriba abajo. Pura. */
function cadena(ix, id) {
  const out = []; let p = ix.padre.get(id), tope = 0;
  while (p && p !== ix.raizId && tope++ < 40) { out.push(ix.nombre.get(p) || ''); p = ix.padre.get(p); }
  return out.reverse();
}

/** Un objeto de propiedades -> [["Grupo / Parametro", valor], ...] (sin los internos del visor). Pura. */
function aplana(obj) {
  if (obj && Array.isArray(obj.pares)) return obj.pares;   // v1.374: ya vienen como pares
  const out = [], pr = (obj && obj.properties) || {};
  for (const g of Object.keys(pr)) {
    if (/^__.*__$/.test(g) && !/^__category__$/i.test(g)) continue;   // v1.373: la pestana interna __category__ si (es la categoria real)
    const grupo = pr[g];
    if (!grupo || typeof grupo !== 'object') continue;
    for (const n of Object.keys(grupo)) {
      let v = grupo[n];
      if (Array.isArray(v)) v = v.join(', ');
      out.push([g + ' / ' + n, v == null ? '' : String(v)]);
    }
  }
  return out;
}
/*
 * v1.366 — LAS CLAVES SE COMPARAN SIN TILDES NI MAYUSCULAS. En un Revit en espanol los grupos y parametros
 * llegan como "Elemento / Categoría", "Elemento / Familia", "Elemento / Tipo", "Elemento / Nivel": con la tilde,
 * ningun elemento "declaraba" categoria, se tomaban por contenedores y solo contaban sus PIEZAS de geometria
 * (13.723 piezas, 40 parametros, "(sin tipo)", el nivel como categoria). Ahora: clave normalizada (claveN).
 * "Item / Type" e "Item / Name" son del nodo de Navisworks (Solido, Geometry): no son el tipo ni la familia.
 */
const claveN = (k) => String(k || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
/*
 * v1.373 — LA MISMA REGLA QUE EL VISOR (CANON de app.js, buildCanonical): la CATEGORIA sale de la pestana interna
 * del traductor "__category__" (ahi vive la categoria real de Revit; antes se descartaba por "interna" y la
 * categoria se tomaba del arbol: salian los NIVELES como categorias, las categorias como familias...), o de una
 * propiedad llamada Category/Categoria/IFC entity; Familia y Tipo por su nombre (sin la pestana "Item" de
 * Navisworks, cuyo "Type" es "Solido"/"Geometry"); Nivel por UNION de todos los nombres que el visor reconoce
 * (Nivel, Restriccion de base, Nivel de referencia, Planta, Capa...). Los regex son los de app.js, no una copia.
 */
let CANON_VISOR = null;
function canonVisor() {
  if (CANON_VISOR) return CANON_VISOR;
  const C = { RegExp, Array, Object }; vm.createContext(C);
  const lista = vm.runInContext(require('./reporte-forma').fuentesComunes(['CANON']) + '\n;CANON;', C);
  const de = (l) => (lista.find(f => f.label === l) || {});
  CANON_VISOR = { cat: de('Categoria'), fam: de('Familia'), tip: de('Tipo'), niv: de('Nivel') };
  return CANON_VISOR;
}
const RX_ARCH = /\/ ?(source file|archivo de origen)$/;
const RX_INTERNA = /^__.*__$/;
/** Grupo y nombre de una clave "Grupo / Nombre". Pura. */
const parteClave = (k) => { const s = String(k || ''), i = s.indexOf(' / '); return i >= 0 ? [s.slice(0, i), s.slice(i + 3)] : ['', s]; };
/** Que clasifica cada propiedad (grupo, nombre), como el visor. Puras. */
const esCat = (g, n) => /^__category__$/i.test(g) || (!RX_INTERNA.test(g) && canonVisor().cat.name.test(String(n).trim()));
const esFam = (g, n) => !RX_INTERNA.test(g) && !/^item$/i.test(String(g).trim()) && canonVisor().fam.name.test(String(n).trim());
const esTip = (g, n) => !RX_INTERNA.test(g) && !/^item$/i.test(String(g).trim()) && canonVisor().tip.name.test(String(n).trim());
const esNiv = (g, n) => !RX_INTERNA.test(g) && canonVisor().niv.name.test(String(n).trim());
const esArch = (g, n) => !RX_INTERNA.test(g) && RX_ARCH.test(claveN(g + ' / ' + n));
const CLAS_CACHE = new Map();
/** La clase de una clave "Grupo / Nombre": 'cat' | 'fam' | 'tip' | 'niv' | 'arch' | ''. Con cache. Pura. */
function claseDe(k) {
  let c = CLAS_CACHE.get(k);
  if (c === undefined) { const [g, n] = parteClave(k); c = esCat(g, n) ? 'cat' : esFam(g, n) ? 'fam' : esTip(g, n) ? 'tip' : esNiv(g, n) ? 'niv' : esArch(g, n) ? 'arch' : ''; if (CLAS_CACHE.size < 200000) CLAS_CACHE.set(k, c); }
  return c;
}
// (los RX_* de antes se conservan para quien los importe; la clasificacion usa claseDe)
const RX_CAT = /^(element|elemento|item|elemento de navisworks|ifc|identity data|datos de identidad|other|otros|__category__)? ?\/ ?(category|categoria|ifc ?class|entity|clase ifc)$/;
const RX_FAM = /^(?!item ?\/)(.*\/ ?(family|familia|family name|nombre de familia))$/, RX_TIP = /^(?!item ?\/)(.*\/ ?(type|tipo|type name|nombre de tipo))$/;
const RX_NIV = /\/ ?(level|nivel|base constraint|restriccion de base|reference level|nivel de referencia|ifcbuildingstorey|building storey)$/;
// v1.372: la clave normalizada se recuerda (hay pocos miles de claves distintas y millones de pares): 10 veces mas rapido
const CLAVE_N = new Map();
const claveNC = (k) => { let v = CLAVE_N.get(k); if (v === undefined) { v = claveN(k); if (CLAVE_N.size < 200000) CLAVE_N.set(k, v); } return v; };
const tiene = (rx, k) => rx.test(claveNC(k));
/** Numero de un valor "3.500 m" / "12,5 m²" / 7 (o null). Pura. */
function numero(v) {
  const t = String(v == null ? '' : v).trim();
  const m = /^-?[\d.,]+(?:e-?\d+)?/i.exec(t);
  if (!m) return null;
  let s = m[0];
  const ip = s.lastIndexOf('.'), ic = s.lastIndexOf(',');
  if (ip >= 0 && ic >= 0) s = ic > ip ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');   // el ultimo separador es el decimal
  else if (ic >= 0) s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');      // "12,5" o "1,234,567"
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');                                    // "1.234.567"
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** El resumen que se va armando mientras llegan las paginas. */
class Resumen {
  constructor(cl, ix, formato) {
    this.cl = cl; this.ix = ix; this.formato = formato;
    this.objetos = 0; this.elementos = 0; this.partes = 0;
    this.param = new Map();        // clave -> { llenos, vacios, valores Map, otros, num: {n, min, max, suma}, porCat Map }
    this.cat = new Map(); this.fam = new Map(); this.tip = new Map(); this.niv = new Map(); this.arch = new Map();
    this.muestra = []; this.indice = []; this.posParam = new Map();
    this.esElem = new Set();
    this.off = 0;                  // capas entre el archivo y la categoria (NWD de Revit), aprendidas
    this.muestrasCapa = [];
  }
  /** Primera pasada ligera por el arbol: aprende si hay una capa de niveles (como el visor). */
  aprende(declaradas) {
    if (!this.ix) return;
    const hojas = this.ix.hojas ? this.ix.hojas() : (() => { const h = []; for (const [id, n] of this.ix.hijos) if (!n) h.push(id); return h; })();   // v1.372: arbol en arreglos
    const paso = Math.max(1, Math.ceil(hojas.length / 3000));
    for (let i = 0; i < hojas.length; i += paso) {
      const nombres = cadena(this.ix, hojas[i]); let i0 = 0;
      while (i0 < nombres.length && this.cl.esArchivo(nombres[i0])) i0++;
      this.muestrasCapa.push({ i0, j: this.cl.posCat(nombres, i0, declaradas) });
    }
    this.off = this.cl.capas(this.muestrasCapa);
    this.declaradas = declaradas;
  }
  clasifica(id, pares, contenedor) {   // v1.373: contenedor = nodo de agrupacion (no toma la categoria del arbol)
    const busca = (cl) => { const p = pares.find(([k, v]) => claseDe(k) === cl && String(v).trim()); return p ? String(p[1]).trim() : ''; };   // v1.373: como el visor
    let cat = busca('cat'), fam = busca('fam'), tip = busca('tip'), archivo = busca('arch');
    const niv = busca('niv');
    if (this.ix) {
      const nombres = cadena(this.ix, id);
      if (!archivo) { const a = nombres.find(n => this.cl.esArchivo(n)); if (a) archivo = a; }
      if (this.off > 0) {
        const r = this.cl.anclado(nombres, this.ix.nombre.get(id), this.off, this.declaradas || new Set(), (this.ix.hijos.get(id) || 0) > 0, !!cat);
        if (r && !r.fuera) { cat = cat || r.cat; fam = fam || r.fam; tip = tip || r.tip; }
      } else if (!cat && !contenedor) {
        let i0 = 0; while (i0 < nombres.length && this.cl.esArchivo(nombres[i0])) i0++;
        cat = nombres[i0] || ''; fam = fam || nombres[i0 + 1] || ''; tip = tip || nombres[i0 + 2] || '';
      }
    }
    return { cat: this.cl.norm('Categoria', cat) || '(sin categoria)', fam: this.cl.norm('Familia', fam) || '(sin familia)', tip: this.cl.norm('Tipo', tip) || '(sin tipo)', niv: niv || '(sin nivel)', archivo: archivo || '' };
  }
  /** Un objeto de la pagina de propiedades. */
  agrega(obj) {
    this.objetos++;
    const pares = aplana(obj);
    if (!pares.length && !obj.conProps) return null;   // v1.372: conProps = tiene propiedades (visibles) aunque aqui no vengan
    const id = obj.objectid;
    // elemento = objeto con categoria declarada, u hoja con propiedades; si un antecesor ya es elemento, es una PARTE
    // v1.371: devuelve { clase, c } (1 elemento, 2 parte, 0 contenedor con propiedades) con su clasificacion, para el indice
    if (this.ix) {
      let p = this.ix.padre.get(id), parte = false, tope = 0;
      while (p && tope++ < 40) { if (this.esElem.has(p)) { parte = true; break; } p = this.ix.padre.get(p); }
      // v1.373: una PARTE hereda la clasificacion de su elemento (anc: el indice la copia al cerrar); un contenedor sin categoria declarada queda "(sin categoria)"
      if (parte) { this.partes++; return { clase: 2, c: this.clasifica(id, pares, true), anc: p }; }
      const declara = pares.some(([k, v]) => claseDe(k) === 'cat' && String(v).trim());
      if (!declara && (this.ix.hijos.get(id) || 0) > 0) return { clase: 0, c: this.clasifica(id, pares, true) };   // contenedor (archivo, nivel, categoria, familia, tipo)
    }
    this.esElem.add(id);
    this.elementos++;
    const c = this.clasifica(id, pares);
    for (const [m, k] of [[this.cat, c.cat], [this.fam, c.fam], [this.tip, c.tip], [this.niv, c.niv], [this.arch, c.archivo || '(un solo archivo)']]) m.set(k, (m.get(k) || 0) + 1);
    const fila = (this.muestra.length < MAX_MUESTRA && (this.elementos % (this.pasoMuestra || 1)) === 0) ? { n: String(obj.name || ''), id, c: c.cat, f: c.fam, t: c.tip, v: c.niv, a: c.archivo, p: {} } : null;   // v1.366: repartida
    for (const [k, v] of pares) {
      let s = this.param.get(k);
      if (!s) { s = { llenos: 0, vacios: 0, valores: new Map(), otros: 0, num: { n: 0, min: Infinity, max: -Infinity, suma: 0 }, porCat: new Map() }; this.param.set(k, s); }
      const t = String(v).trim();
      if (!t) { s.vacios++; continue; }
      s.llenos++;
      if (s.valores.has(t)) s.valores.set(t, s.valores.get(t) + 1); else if (s.valores.size < MAX_VALORES) s.valores.set(t, 1); else s.otros++;
      const n = numero(t); if (n != null) { s.num.n++; s.num.suma += n; if (n < s.num.min) s.num.min = n; if (n > s.num.max) s.num.max = n; }
      s.porCat.set(c.cat, (s.porCat.get(c.cat) || 0) + 1);
      if (fila) { let j = this.posParam.get(k); if (j == null) { j = this.indice.length; this.indice.push(k); this.posParam.set(k, j); } fila.p[j] = t.slice(0, 200); }
    }
    if (fila) this.muestra.push(fila);
    return { clase: 1, c };
  }
  /** El resumen final (lo que se guarda). Pura respecto de lo acumulado. */
  final(extra) {
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
    const cats = top(this.cat, MAX_CATS_COBERTURA).map(x => x[0]);
    const params = [...this.param].map(([k, s]) => ({
      k, llenos: s.llenos, vacios: s.vacios, distintos: s.valores.size + (s.otros ? 1 : 0), otros: s.otros,
      valores: top(s.valores, MAX_VALORES), num: s.num.n ? { n: s.num.n, min: s.num.min, max: s.num.max, suma: Math.round(s.num.suma * 1000) / 1000 } : null,
      porCat: cats.map(c => s.porCat.get(c) || 0),
    })).sort((a, b) => b.llenos - a.llenos);
    return Object.assign({ formato: this.formato, objetos: this.objetos, elementos: this.elementos, partes: this.partes, capasNiveles: this.off,
      categorias: top(this.cat, 500), familias: top(this.fam, MAX_TOP), tipos: top(this.tip, MAX_TOP), niveles: top(this.niv, MAX_TOP), archivos: top(this.arch, 200),
      catsCobertura: cats, params, indiceMuestra: this.indice, muestra: this.muestra }, extra || {});
  }
}

/*
 * v1.370 — ESPERAR A AUTODESK, DECIR QUE CONTESTO Y, SI NO ENTREGA, LEER LA BASE DE PROPIEDADES DEL MODELO.
 * La primera vez que se piden el arbol o las propiedades de un modelo, Autodesk los PREPARA y mientras tanto
 * contesta 202 ({"result":"success"}, sin datos). En un NWD grande eso tarda MINUTOS: antes se esperaba 1 min
 * al arbol y NADA a las propiedades (una sola consulta), y salia "sin arbol y sin propiedades". Ahora:
 * - se lee el MANIFIESTO de la traduccion (estado, progreso, formato) para el diagnostico;
 * - el arbol y las propiedades se esperan con pausas crecientes (hasta 8 y 4 min), mostrando la espera;
 * - si Autodesk igual no las entrega, se lee la BASE DE PROPIEDADES del modelo (model.sdb: la misma que
 *   usa el visor de Autodesk para mostrar las propiedades), descargada del manifiesto y leida con SQLite;
 * - si tampoco, el error dice paso a paso que contesto Autodesk.
 */
const RAPIDO = process.env.EXTRACTOR_RAPIDO === '1';   // solo para las pruebas: esperas cortas
const ESPERA = RAPIDO ? { arbol: 2500, props: 2000, consulta: 2500, pausaMin: 150, pausaMax: 300 }
                      : { arbol: 8 * 60000, props: 4 * 60000, consulta: 8 * 60000, pausaMin: 3000, pausaMax: 15000 };
const duermeX = (ms) => new Promise(r => setTimeout(r, ms));
const fmtEspera = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };
/** Autodesk lo esta preparando: 202 con {"result":"success"} y sin datos. Pura. */
const preparando = (j) => !!j && typeof j === 'object' && !j.data && (j.result === 'success' || j.result === 'accepted' || !Object.keys(j).length);
/**
 * Pide hasta que llegue lo esperado (listo(j)) o pase maxMs. Devuelve { j, esperas, ms } o { j: null, ... }.
 * Un error de Autodesk (4xx/5xx) sube tal cual.
 */
async function esperaDatos(pedir, listo, maxMs, alEsperar) {
  const t0 = Date.now(); let n = 0, ultimo = null;
  for (;;) {
    const j = await pedir(); n++;
    if (listo(j)) return { j, esperas: n - 1, ms: Date.now() - t0 };
    ultimo = j;
    const pasado = Date.now() - t0;
    if (pasado >= maxMs) return { j: null, esperas: n, ms: pasado, ultimo, preparando: preparando(j) };
    alEsperar && alEsperar(pasado);
    await duermeX(Math.min(ESPERA.pausaMax, ESPERA.pausaMin + n * Math.round(ESPERA.pausaMin / 3)));
  }
}
/** El manifiesto en pocas palabras, y la base de propiedades que trae. Pura. */
function leeManifiesto(man) {
  const out = { estado: String((man && man.status) || ''), progreso: String((man && man.progress) || ''), formatos: [], base: null };
  const pila = [].concat((man && man.derivatives) || []);
  for (const d of pila) if (d && d.outputType) out.formatos.push(String(d.outputType) + (d.status && d.status !== 'success' ? ' (' + d.status + ')' : ''));
  while (pila.length) {
    const n = pila.pop(); if (!n || typeof n !== 'object') continue;
    const u = String(n.urn || '');
    if (!out.base && u && (n.role === 'Autodesk.CloudPlatform.PropertyDatabase' || /\/(model\.sdb|properties\.db)$/i.test(u))) out.base = { urn: u, estado: String(n.status || '') };
    for (const h of (n.children || [])) pila.push(h);
  }
  return out;
}
const msgE = (e) => String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 160);

/*
 * v1.371 — EL INDICE DEL MODELO (un SQLite por modelo, en el servidor). Es el mismo indice que arma el visor en el
 * navegador (parametro -> valor -> elementos), para calcular el LLENADO DE PARAMETROS y el INVENTARIO con las mismas
 * funciones del visor, sin abrir el modelo. Los parametros se nombran como en el visor: "nombre" si es unico y
 * "nombre [pestana]" si el mismo nombre esta en varias pestanas; fuera las pestanas internas del traductor (__x__)
 * y los atributos ocultos. Tablas: attr, val, valh (valores que son hueco: "-", "N/A", "0"...), eav, elem (cada
 * nodo con propiedades: nombre, modelo de origen, categoria, familia, tipo, nivel y clase: 1 elemento, 2 parte,
 * 0 contenedor), meta.
 */
let LLEN_HUECO_FN = null;
/** llenHueco del visor (llenado.js), en el servidor. */
function llenHuecoVisor() {
  if (LLEN_HUECO_FN) return LLEN_HUECO_FN;
  const txt = require('./reporte-forma').fuentesDeArchivo('llenado.js', ['LLEN_HUECOS', 'llenHueco']);
  const C = { String }; vm.createContext(C); vm.runInContext(txt, C);
  return (LLEN_HUECO_FN = C.llenHueco);
}
/** Los nombres de parametro como el visor: "nombre" o "nombre [pestana]" si el nombre se repite en varias pestanas. Pura. */
function nombresComoVisor(lista) {   // lista: [{ id, g, n }] visibles
  const vistos = new Map();
  for (const a of lista) { const k = a.n + '\u0000' + a.g; if (!vistos.has(k)) vistos.set(k, []); vistos.get(k).push(a.id); }
  const tabsPorNombre = new Map();
  for (const k of vistos.keys()) { const [n, g] = k.split('\u0000'); if (!tabsPorNombre.has(n)) tabsPorNombre.set(n, new Set()); tabsPorNombre.get(n).add(g); }
  const out = new Map();   // id -> nombre visible
  for (const a of lista) out.set(a.id, (tabsPorNombre.get(a.n).size > 1 && a.g) ? a.n + ' [' + a.g + ']' : a.n);
  return out;
}
class Indice {
  constructor(ruta) {
    const { DatabaseSync } = require('node:sqlite');
    const fs = require('fs');
    try { fs.mkdirSync(require('path').dirname(ruta), { recursive: true }); } catch (e) {}
    try { fs.unlinkSync(ruta); } catch (e) {}
    this.ruta = ruta;
    this.db = new DatabaseSync(ruta);
    this.db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-16384;' +   // v1.377: 16 MB de cache al armarlo (las inserciones van ordenadas en la clave)
      'CREATE TABLE attr (id INTEGER PRIMARY KEY, nombre TEXT, grupo TEXT, n TEXT);' +
      'CREATE TABLE val (id INTEGER PRIMARY KEY, v TEXT);' +
      'CREATE TABLE valh (id INTEGER PRIMARY KEY, cero INTEGER);' +
      'CREATE TABLE eav (a INTEGER, e INTEGER, v INTEGER, PRIMARY KEY (a, e, v)) WITHOUT ROWID;' +   // la propia tabla es el indice por parametro (la mitad de disco que tabla + indices)
      'CREATE TABLE elem (e INTEGER PRIMARY KEY, nombre TEXT, modelo TEXT, cat TEXT, fam TEXT, tip TEXT, niv TEXT, clase INTEGER, anc INTEGER);' +
      'CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);');
    this.attrs = new Map(); this.vals = new Map();   // solo para el camino de la API (en JS)
    this.insElem = this.db.prepare('INSERT OR REPLACE INTO elem VALUES (?,?,?,?,?,?,?,?,?)');
    this.insEav = this.db.prepare('INSERT OR IGNORE INTO eav VALUES (?,?,?)');
    this.db.exec('BEGIN');
    this.nElem = 0;
  }
  /** Un nodo con su clasificacion (del Resumen). */
  elem(e, nombre, c, clase, anc) {
    this.insElem.run(e, String(nombre || '').slice(0, 300), c.archivo || '(un solo archivo)', c.cat, c.fam, c.tip, c.niv, clase, anc || 0);
    this.nElem++;
  }
  /** Camino de la API: las propiedades de un objeto, en JS ("Grupo / Nombre" -> grupo y nombre). */
  propiedades(e, pares) {
    for (const [k, v] of pares) {
      const t = String(v == null ? '' : v); if (!t) continue;
      const i = k.indexOf(' / '), g = i >= 0 ? k.slice(0, i) : '', n = i >= 0 ? k.slice(i + 3) : k;
      if (/^__.*__$/.test(g)) continue;
      let a = this.attrs.get(k); if (a == null) { a = this.attrs.size + 1; this.attrs.set(k, a); this.db.prepare('INSERT INTO attr VALUES (?,?,?,?)').run(a, '', g, n); }
      let vi = this.vals.get(t); if (vi == null) { vi = this.vals.size + 1; this.vals.set(t, vi); this.db.prepare('INSERT INTO val VALUES (?,?)').run(vi, t); }
      this.insEav.run(a, e, vi);
    }
  }
  /** Camino de la API: cierra los nombres como el visor. */
  nombraDesdeJs() {
    const lista = this.db.prepare('SELECT id, grupo AS g, n FROM attr').all().map(r => ({ id: Number(r.id), g: String(r.g), n: String(r.n) }));
    const nombres = nombresComoVisor(lista), up = this.db.prepare('UPDATE attr SET nombre = ? WHERE id = ?');
    for (const [id, nombre] of nombres) up.run(nombre, id);
  }
  /** Camino de la base: copia atributos visibles, valores y eav desde la base del modelo (ATTACH), sin pasar por JS. */
  desdeSdb(rutaSdb, atributos) {   // atributos: [{ id, g, n, oculto }]
    this.db.exec('COMMIT');
    const vis = atributos.filter(a => !/^__.*__$/.test(a.g) && !a.oculto);
    const nombres = nombresComoVisor(vis);
    this.db.exec('BEGIN');
    const ins = this.db.prepare('INSERT INTO attr VALUES (?,?,?,?)');
    for (const a of vis) ins.run(a.id, nombres.get(a.id), a.g, a.n);
    this.db.exec('COMMIT');
    this.db.exec("ATTACH DATABASE '" + String(rutaSdb).replace(/'/g, "''") + "' AS src");
    this.db.exec('INSERT INTO val SELECT id, CAST(value AS TEXT) FROM src._objects_val');
    this.db.exec('INSERT OR IGNORE INTO eav SELECT attribute_id, entity_id, value_id FROM src._objects_eav NOT INDEXED WHERE attribute_id IN (SELECT id FROM attr) AND entity_id IN (SELECT e FROM elem) AND value_id IN (SELECT id FROM val WHERE v IS NOT NULL AND v <> \'\') ORDER BY attribute_id, entity_id, value_id');   // v1.372: ordenado = inserciones seguidas en la clave
    this.db.exec('DETACH DATABASE src');
    this.db.exec('BEGIN');
  }
  /** v1.376 — Camino del VISOR: lo que sube exporta-indice.js (ids ya asignados en el navegador). */
  trozoVisor(t) {
    if (!this.insAttrV) { this.insAttrV = this.db.prepare('INSERT OR IGNORE INTO attr VALUES (?,?,?,?)'); this.insValV = this.db.prepare('INSERT OR IGNORE INTO val VALUES (?,?)'); }
    let pares = 0;
    for (const [id, nombre] of (t.attrs || [])) { const i = String(nombre).indexOf(' / '); this.insAttrV.run(Number(id), String(nombre).slice(0, 300), '', String(nombre).slice(0, 300)); }
    for (const [id, v] of (t.vals || [])) this.insValV.run(Number(id), String(v == null ? '' : v));
    for (const f of (t.eav || [])) { const a = Number(f[0]); for (let i = 1; i + 1 < f.length; i += 2) { this.insEav.run(a, Number(f[i]), Number(f[i + 1])); pares++; } }
    /*
     * v1.377 — el formato liviano: [a, v, e1, e2-e1, e3-e2, ...] (los elementos de cada valor, ordenados y en
     * diferencias). Se juntan los pares de cada parametro y se insertan ORDENADOS por elemento: la tabla es la propia
     * clave (a, e, v), asi cada insercion cae al lado de la anterior (mucho mas rapido en un indice de millones).
     */
    if (t.eavd) {
      let cur = null, E = [], V = [];
      const vuelca = () => {
        const nn = E.length; if (!nn) return;
        const ix = new Uint32Array(nn); for (let i = 0; i < nn; i++) ix[i] = i;
        ix.sort((x, y) => (E[x] - E[y]) || (V[x] - V[y]));
        for (let i = 0; i < nn; i++) { const j = ix[i]; this.insEav.run(cur, E[j], V[j]); }
        pares += nn; E = []; V = [];
      };
      for (const f of t.eavd) {
        const a = Number(f[0]), v = Number(f[1]);
        if (a !== cur) { vuelca(); cur = a; }
        let e = 0; for (let i = 2; i < f.length; i++) { e += Number(f[i]); E.push(e); V.push(v); }
      }
      vuelca();
    }
    for (const r of (t.elem || [])) { this.insElem.run(Number(r[0]), String(r[1] || '').slice(0, 300), String(r[2] || ''), String(r[3] || ''), String(r[4] || ''), String(r[5] || ''), String(r[6] || ''), Number(r[7]) || 0, 0); this.nElem++; }
    return { pares, elem: (t.elem || []).length, attrs: (t.attrs || []).length, vals: (t.vals || []).length };
  }
  /** Cierra: huecos (llenHueco del visor), indices y metadatos. */
  cierra(meta) {
    this.db.exec('COMMIT');
    const hueco = llenHuecoVisor();
    this.db.exec('BEGIN');
    const ins = this.db.prepare('INSERT OR REPLACE INTO valh VALUES (?,?)');
    for (const r of recorre(this.db, 'SELECT id, v FROM val')) {
      const v = r.v == null ? '' : String(r.v);
      if (hueco(v, false)) ins.run(Number(r.id), 0); else if (hueco(v, true)) ins.run(Number(r.id), 1);
    }
    const im = this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)');
    for (const k of Object.keys(meta || {})) im.run(k, String(meta[k]));
    im.run('nodos', String(this.nElem)); im.run('version', '1');
    this.db.exec('COMMIT');
    // v1.373: las partes (geometria) heredan la clasificacion de su elemento (como las hojas del visor, que llevan su __category__)
    this.db.exec('UPDATE elem SET cat = p.cat, fam = p.fam, tip = p.tip, niv = p.niv, modelo = p.modelo FROM (SELECT e, cat, fam, tip, niv, modelo FROM elem WHERE clase = 1) AS p WHERE elem.clase = 2 AND elem.anc = p.e');
    this.db.exec('CREATE INDEX ix_elem_cat ON elem(cat); PRAGMA analysis_limit=2000; ANALYZE;');   // v1.377: ANALYZE por muestra (en un indice de decenas de millones recorria todo)
    const n = Number((this.db.prepare('SELECT COUNT(*) AS n FROM eav').get() || {}).n) || 0;
    this.db.close();
    return { nodos: this.nElem, pares: n };
  }
  abandona() { try { this.db.close(); } catch (e) {} try { require('fs').unlinkSync(this.ruta); } catch (e) {} }
}

/**
 * v1.370 — LA BASE DE PROPIEDADES DEL MODELO (model.sdb), leida con SQLite (node:sqlite).
 * Es la base que Autodesk arma al traducir y que usa su visor: entidades (los dbId), atributos (grupo y nombre)
 * y valores (tablas _objects_eav, _objects_attr, _objects_val). De ahi salen el arbol (__parent__, __name__),
 * la herencia de tipo (__instanceof__, como la resuelve el visor) y TODAS las propiedades, que pasan por el
 * MISMO resumen y los MISMOS clasificadores que la lectura por la API. Las internas (__x__) y las ocultas no.
 *
 * v1.372 — PREPARADA PARA 3 MILLONES DE OBJETOS. (1) El arbol vive en ARREGLOS por id de entidad (padre, hijos,
 * instanceof, profundidad: 4 bytes por nodo), no en Maps de millones de entradas; solo los nombres de los nodos
 * con hijos se guardan (los antecesores de cada elemento). (2) En JavaScript solo pasan las propiedades que
 * CLASIFICAN (categoria, familia, tipo, nivel, archivo, nombre): unas 5 por nodo, no las 40 o 60 de cada uno;
 * las estadisticas de TODOS los parametros (llenado, valores, muestra) las calcula SQLite sobre el indice
 * (indice-modelos.js, resumenDesdeIndice). (3) Todo por rangos y con iteradores: la memoria no crece con el modelo.
 */
function leeBaseSdb(archivo, cl, formato, avance, indice) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { throw new Error('este servidor (Node ' + process.version + ') no trae SQLite para leer la base de propiedades'); }
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    const tablas = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    for (const t of ['_objects_eav', '_objects_attr', '_objects_val']) if (!tablas.has(t)) throw new Error('la base de propiedades no tiene la tabla ' + t);
    const colA = new Set(db.prepare('PRAGMA table_info(_objects_attr)').all().map(r => r.name));
    const col = (c, alias) => colA.has(c) ? c : ("'' AS " + (alias || c));
    const attrs = new Map();
    for (const a of db.prepare('SELECT id, ' + col('name') + ', ' + col('category') + ', ' + col('display_name') + ', ' + (colA.has('flags') ? 'flags' : '0 AS flags') + ' FROM _objects_attr').all())
      attrs.set(Number(a.id), { g: String(a.category == null ? '' : a.category), n: String(a.display_name || a.name || ''), oculto: (Number(a.flags) & 1) === 1 });
    const ids = (pred) => [...attrs].filter(([, a]) => pred(a)).map(([id]) => id);
    const interno = (a) => /^__.*__$/.test(a.g);
    const visible = (a) => !interno(a) && !a.oculto;
    const aPadre = ids(a => a.g === '__parent__'), aNombre = ids(a => a.g === '__name__'), aHijo = ids(a => a.g === '__child__'), aInst = ids(a => a.g === '__instanceof__');
    // v1.373: lo que clasifica, como el visor (tambien la pestana interna __category__ y los atributos ocultos)
    const claseAttr = new Map(); for (const [id, a] of attrs) { const c = claseDe(a.g + ' / ' + a.n); if (c) claseAttr.set(id, c); }
    const aClas = [...claseAttr.keys()], aVis = ids(visible);
    /*
     * v1.374 — SIN INDICE AUXILIAR NI /tmp. En Render (512 MB, /tmp de 2 GB) crear un indice sobre la base del modelo
     * duplicaba su tamano en /tmp y la instancia caia. Ahora la base se lee SOLO con barridos lineales (SQLite recorre
     * la tabla seguida, sin ordenar nada), y lo que hace falta por nodo queda en arreglos por id: valor elegido de
     * categoria/familia/tipo/nivel/archivo y nombre (ids de valor, 4 bytes cada uno). Nada se escribe fuera del indice.
     */
    const sel = 'SELECT entity_id AS e, attribute_id AS a, value_id AS v FROM _objects_eav NOT INDEXED';
    const maxId = Number((db.prepare('SELECT MAX(entity_id) AS m FROM _objects_eav NOT INDEXED').get() || {}).m) || 0;
    const N = maxId + 1;
    const valDe = (() => { const st = db.prepare('SELECT value AS v FROM _objects_val WHERE id = ?'), cache = new Map();
      return (id) => { if (!id) return ''; let v = cache.get(id); if (v === undefined) { const r = st.get(id); v = r && r.v != null ? String(r.v) : ''; if (cache.size < 300000) cache.set(id, v); } return v; }; })();
    const enTexto = (lista) => lista.length ? ' WHERE attribute_id IN (' + lista.join(',') + ')' : ' WHERE 0';
    // 1) un barrido: arbol, herencia, categoria declarada, nombre y valores que clasifican (ids), presencia de propiedades
    const padre = new Int32Array(N), nHijos = new Uint32Array(N), inst = new Int32Array(N), decl = new Uint8Array(N), conProps = new Uint8Array(N), existe = new Uint8Array(N);
    const vCat = new Int32Array(N), vFam = new Int32Array(N), vTip = new Int32Array(N), vNiv = new Int32Array(N), vArch = new Int32Array(N), vNom = new Int32Array(N);
    const porClase = { cat: vCat, fam: vFam, tip: vTip, niv: vNiv, arch: vArch };
    const sPadre = new Set(aPadre), sHijo = new Set(aHijo), sInst = new Set(aInst), sNombre = new Set(aNombre), sVis = new Set(aVis);
    const declIds = new Set();
    /*
     * v1.375 — DIAGNOSTICO DEL MODELO (para comparar con el visor con datos REALES): de una muestra fija de entidades
     * repartidas por todo el modelo se guardan TODAS sus propiedades crudas (tambien las pestanas internas) y su
     * cadena de antecesores. Se baja desde la pagina ("Diagnostico del modelo") y permite ajustar la clasificacion
     * con el modelo de verdad delante, no a ciegas.
     */
    const DIAG_N = 400, diagIds = new Set(); for (let q = 1; q <= DIAG_N; q++) diagIds.add(Math.max(1, Math.floor(q * (N - 1) / DIAG_N)));
    const diagFilas = new Map();   // e -> [[attrId, valId]]
    let leidas = 0;
    avance && avance('Leyendo la base de propiedades del modelo (un barrido)...', 0);
    for (const r of recorre(db, sel)) {
      const e = Number(r.e), a = Number(r.a); if (e <= 0 || e >= N) continue;
      if (diagIds.has(e)) { let l = diagFilas.get(e); if (!l) { l = []; diagFilas.set(e, l); } if (l.length < 400) l.push([a, Number(r.v)]); }
      existe[e] = 1;
      if (sPadre.has(a)) { const p = Number(valDe(Number(r.v))); if (p > 0 && p < N && p !== e) padre[e] = p; continue; }
      if (sHijo.has(a)) { const h = Number(valDe(Number(r.v))); if (h > 0 && h < N && h !== e && !padre[h]) padre[h] = e; continue; }
      if (sInst.has(a)) { const t = Number(valDe(Number(r.v))); if (t > 0 && t < N) inst[e] = t; continue; }
      if (sNombre.has(a)) { if (!vNom[e]) vNom[e] = Number(r.v); continue; }
      if (sVis.has(a)) conProps[e] = 1;
      const c = claseAttr.get(a);
      if (c) { const arr = porClase[c]; if (!arr[e]) arr[e] = Number(r.v); if (c === 'cat') { decl[e] = 1; declIds.add(Number(r.v)); } }
      if ((++leidas & 0xfffff) === 0) avance && avance('Leyendo la base de propiedades del modelo: ' + leidas.toLocaleString('es-PE') + ' valores...', 0);
    }
    const declNombres = new Set(); for (const id of declIds) { const v = valDe(id).trim(); if (v) declNombres.add(cl.norm('Categoria', v)); }
    let nPadres = 0; for (let e = 1; e < N; e++) if (padre[e]) nHijos[padre[e]]++;
    for (let e = 1; e < N; e++) if (nHijos[e]) nPadres++;
    // 2) los nombres de los nodos con hijos (los antecesores que clasifican) se guardan como texto
    const nombres = new Map();
    for (let e = 1; e < N; e++) if (nHijos[e] && vNom[e]) nombres.set(e, valDe(vNom[e]));
    let ix = null, raices = [];
    if (nPadres > 0) {
      for (let e = 1; e < N; e++) if (existe[e] && !padre[e] && nHijos[e]) raices.push(e);
      ix = { padre: { get: (id) => padre[id] || undefined, has: (id) => !!padre[id] }, nombre: { get: (id) => nombres.get(id) || (ix.nombreActual && ix.nombreActual.id === id ? ix.nombreActual.n : '') },
             hijos: { get: (id) => nHijos[id] || 0, has: (id) => id > 0 && id < N && existe[id] === 1 }, raizId: raices.length === 1 ? raices[0] : 0, raices,
             hojas: () => { const h = []; for (let e = 1; e < N; e++) if (existe[e] && !nHijos[e] && conProps[e]) h.push(e); return h; }, size: N };
    }
    const R = new Resumen(cl, ix, formato);
    if (ix) {
      // 3) de arriba abajo (por profundidad), quien es ELEMENTO: la misma regla que Resumen.agrega (declara
      //    categoria, el o su tipo; u hoja); lo que cuelga de un elemento es PARTE. Asi el orden de lectura no cambia nada.
      R.aprende(declNombres);
      const prof = new Uint16Array(N);   // 0 = sin calcular; raiz = 1
      for (let e = 1; e < N; e++) {
        if (!existe[e] || prof[e]) continue;
        let cad = [], n = e, tope = 0;
        while (n && !prof[n] && tope++ < 200) { cad.push(n); n = padre[n]; }
        let d = n ? prof[n] : 0;
        for (let k = cad.length - 1; k >= 0; k--) prof[cad[k]] = ++d;
      }
      let maxProf = 0; for (let e = 1; e < N; e++) if (prof[e] > maxProf) maxProf = prof[e];
      const cuenta = new Uint32Array(maxProf + 2); for (let e = 1; e < N; e++) if (prof[e]) cuenta[prof[e]]++;
      const inicio = new Uint32Array(maxProf + 2); for (let d = 1; d <= maxProf; d++) inicio[d + 1] = inicio[d] + cuenta[d];
      const orden = new Int32Array(inicio[maxProf + 1]); const pos = inicio.slice(); for (let e = 1; e < N; e++) if (prof[e]) orden[pos[prof[e]]++] = e;
      const flag = new Uint8Array(N);   // 1 = elemento, 2 = bajo un elemento (parte)
      const declara = (e) => decl[e] === 1 || (inst[e] && decl[inst[e]] === 1);
      for (let k = 0; k < orden.length; k++) {
        const e = orden[k], p = padre[e];
        if (p && flag[p]) { flag[e] = 2; continue; }
        if (conProps[e] && (declara(e) || !nHijos[e])) flag[e] = 1;
      }
      R.esElem = { has: (id) => flag[id] === 1, add: (id) => { flag[id] = 1; } };
    }
    R.pasoMuestra = Math.max(1, Math.floor(N / (MAX_MUESTRA * 2)));
    // 4) cada nodo con propiedades: sus valores que clasifican (los suyos o, si no, los de su tipo) como pares, al resumen y al indice
    let vistos = 0;
    const par = (k, id, e) => { const v = porClase[k][e] || (inst[e] ? porClase[k][inst[e]] : 0); return v ? [[k === 'cat' ? '__category__ / Category' : k === 'fam' ? 'Elemento / Familia' : k === 'tip' ? 'Elemento / Tipo' : k === 'niv' ? 'Elemento / Nivel' : 'Item / Source File', valDe(v)]] : []; };
    for (let e = 1; e < N; e++) {
      if (!conProps[e]) continue;
      const pares = [].concat(par('cat', 0, e), par('fam', 0, e), par('tip', 0, e), par('niv', 0, e), par('arch', 0, e));
      const nombre = nombres.get(e) || valDe(vNom[e]);
      if (ix) ix.nombreActual = { id: e, n: nombre };
      const rr = R.agrega({ objectid: e, name: nombre, pares, conProps: true });
      if (rr && indice) indice.elem(e, nombre, rr.c, rr.clase, rr.anc);   // v1.371: al indice
      vistos++;
      if ((vistos & 0x3ffff) === 0) avance && avance('Clasificando los objetos del modelo: ' + e.toLocaleString('es-PE') + ' de ' + maxId.toLocaleString('es-PE') + ' entidades', vistos);
    }
    R.sinParams = true;   // v1.372: las estadisticas de parametros salen del indice (resumenDesdeIndice)
    // el diagnostico: atributos y la muestra con sus propiedades crudas, su cadena y como quedo clasificada
    const diag = { atributos: [...attrs].map(([id, a]) => ({ id, grupo: a.g, nombre: a.n, oculto: a.oculto, clase: claseAttr.get(id) || '' })), nodos: [] };
    for (const [e, filas] of diagFilas) {
      if (!existe[e]) continue;
      const cad = ix ? cadena(ix, e) : [];
      const c = R.clasifica(e, [].concat(par('cat', 0, e), par('fam', 0, e), par('tip', 0, e), par('niv', 0, e), par('arch', 0, e)), !R.esElem.has(e));
      diag.nodos.push({ e, nombre: nombres.get(e) || valDe(vNom[e]), padre: padre[e] || 0, hijos: nHijos[e] || 0, tipo: inst[e] || 0, cadena: cad, clase: R.esElem.has(e) ? 1 : (padre[e] && (() => { let p = padre[e], t = 0; while (p && t++ < 40) { if (R.esElem.has(p)) return true; p = padre[p]; } return false; })() ? 2 : 0),
        clasificado: c, propiedades: filas.map(([a, v]) => { const at = attrs.get(a) || { g: '?', n: '?' }; return [at.g, at.n, valDe(v).slice(0, 120)]; }) });
    }
    R.diagnosticoNodos = diag;
    if (indice) { avance && avance('Armando el indice del modelo (parametro -> valor -> elemento)...', vistos); db.close(); indice.desdeSdb(archivo, [...attrs].map(([id, a]) => ({ id, g: a.g, n: a.n, oculto: a.oculto }))); }
    return { R, vistos, conArbol: !!ix };
  } finally { try { db.close(); } catch (e) {} }
}
/** Descarga un archivo del manifiesto (cookies firmadas; si no, la descarga directa) a "destino". */
async function descargaDerivado(api, md, derivUrn, destino, maxBytes) {
  const fs = require('fs'), { Readable } = require('stream'), { pipeline } = require('stream/promises');
  const base = md + '/manifest/' + encodeURIComponent(derivUrn);
  const guarda = async (r) => {
    const n = Number(r.headers.get('content-length') || 0);
    if (maxBytes && n > maxBytes) throw new Error('la base de propiedades pesa ' + Math.round(n / 1048576) + ' MB (maximo ' + Math.round(maxBytes / 1048576) + ' MB)');
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destino));
    return fs.statSync(destino).size;
  };
  let motivo = '';
  try {
    const r = await api.crudo(base + '/signedcookies');
    if (r.ok) {
      const j = await r.json();
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : String(r.headers.get('set-cookie') || '').split(/,(?=\s*[\w-]+=)/);
      const cookies = sc.map(c => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
      if (maxBytes && Number(j.size) > maxBytes) throw new Error('la base de propiedades pesa ' + Math.round(Number(j.size) / 1048576) + ' MB (maximo ' + Math.round(maxBytes / 1048576) + ' MB)');
      const f = await fetch(j.url, { headers: cookies ? { Cookie: cookies } : {} });   // al CDN de Autodesk, sin el token
      if (f.ok) return await guarda(f);
      motivo = 'CDN ' + f.status;
    } else motivo = 'cookies firmadas ' + r.status;
  } catch (e) { if (/pesa \d+ MB/.test(String(e.message))) throw e; motivo = msgE(e); }
  const r2 = await api.crudo(base);
  if (!r2.ok) throw new Error('no se pudo descargar (' + motivo + '; directa ' + r2.status + ')');
  return await guarda(r2);
}

/**
 * Extrae un modelo. api: { get(url) -> json, post(url, cuerpo) -> json, crudo(url) -> Response } (con el token
 * y los reintentos del servidor). avance(texto, n) informa el progreso. Devuelve el resumen (con completitud).
 */
/** v1.377: el modelo es grande para el servidor (512 MB): se dice que usar. */
function modeloGrande(motivo) {
  const e = new Error('Este modelo es grande para extraerlo en el servidor (' + motivo + '). Usa "Extraer los parametros (en el visor)": lo abre en el visor, que lo indexa en tu navegador, y da las mismas cifras que el visor.');
  e.grande = true; return e;
}
async function extraeModelo(api, base, urn, nombreArchivo, avance, opciones) {
  const cl = clasificadores();
  const op = opciones || {};
  const formato = (/\.(rvt|nwd|nwc|ifc)$/i.exec(String(nombreArchivo || '')) || [])[1] || '';
  const avisos = [], rastro = [];   // v1.370: rastro = lo que contesto Autodesk, paso a paso (para el error)
  const md = base + '/modelderivative/v2/designdata/' + encodeURIComponent(urn);
  let man = null;
  try { man = leeManifiesto(await api.get(md + '/manifest'));
    rastro.push('traduccion en Autodesk: ' + (man.estado || '?') + (man.progreso ? ' (' + man.progreso + ')' : '') + (man.formatos.length ? ', ' + man.formatos.join(' + ') : '') + (man.base ? ', con base de propiedades' : ', sin base de propiedades'));
  } catch (e) { rastro.push('manifiesto: ' + msgE(e)); }
  const falla = (texto, pista) => { const e = new Error(texto + ' — lo que contesto Autodesk: ' + rastro.join(' · ') + (pista ? '. ' + pista : '')); e.rastro = rastro; return e; };
  let meta;
  try { meta = await api.get(md + '/metadata'); } catch (e) { rastro.push('vistas: ' + msgE(e)); throw falla('Autodesk no entrego las vistas del modelo'); }
  const vista = eligeVista(meta);
  if (!vista) throw falla('el modelo no tiene una vista 3D traducida en Autodesk', 'Abrelo una vez en el visor o en Forma para que se traduzca.');
  rastro.push('vista 3D "' + String(vista.name || '').slice(0, 40) + '"');
  // v1.371: el indice del modelo (SQLite), si se pide
  let indice = null;
  const nuevoIndice = () => { if (indice) indice.abandona(); indice = null; if (op.rutaIndice) { try { indice = new Indice(op.rutaIndice); } catch (e) { rastro.push('indice: ' + msgE(e)); } } return indice; };
  const cierraIndice = (extra) => { if (!indice) return null; try { const r = indice.cierra(extra); indice = null; return r; } catch (e) { rastro.push('indice: ' + msgE(e)); indice.abandona(); indice = null; return null; } };
  /*
   * v1.371 — PRIMERO LA BASE DE PROPIEDADES DEL MODELO (model.sdb). Es la que usa el visor de Autodesk, y trae
   * TODOS los parametros (de ejemplar y de tipo): la API "properties" de un NWD entrego 57 parametros donde el
   * visor ve 5.938. Si el manifiesto no la trae o falla, se sigue por la API como antes.
   */
  let R = null, recibidos = 0, total = null, faltaron = 0, origen = 'api', ix = null, sigue202 = false;
  if (man && man.base && typeof api.crudo === 'function' && !op.soloApi) {
    const os = require('os'), path = require('path'), fs = require('fs');
    // v1.374: la descarga va al disco de datos (op.dirTemporal), no a /tmp (en Render /tmp tiene 2 GB y la instancia caia); SQLite tambien
    const dirTmp = op.dirTemporal || os.tmpdir();
    try { fs.mkdirSync(dirTmp, { recursive: true }); } catch (e) {}
    process.env.SQLITE_TMPDIR = dirTmp;
    const tmp = path.join(dirTmp, 'mdb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.sdb');
    try {
      avance && avance('Descargando la base de propiedades del modelo (la que usa el visor de Autodesk)...', 0);
      const maxMb = Number(op.maxMb) || Number(process.env.EXTRACTOR_MAX_MB) || 4000;   // v1.372: modelos de 3 millones de objetos (la base pesa ~2 GB); v1.377: en el servidor, solo modelos chicos (op.maxMb)
      const bytes = await descargaDerivado(api, md, man.base.urn, tmp, maxMb * 1048576);
      nuevoIndice();
      const r = leeBaseSdb(tmp, cl, formato, avance, indice);
      if (!r.vistos) throw new Error('la base no trae entidades');
      R = r.R; recibidos = total = r.vistos; origen = 'base';
      rastro.push('base de propiedades: ' + Math.round(bytes / 1048576 * 10) / 10 + ' MB, ' + r.vistos.toLocaleString('es-PE') + ' objetos');
      if (!r.conArbol) avisos.push('la base de propiedades no trae el arbol: la categoria sale solo de las propiedades');
    } catch (e) {
      // v1.377: con un tope (la extraccion EN EL SERVIDOR es solo para modelos chicos), un modelo grande se para aqui y se dice que hacer
      if (op.maxMb && /pesa \d+ MB/.test(String(e && e.message))) { if (indice) { indice.abandona(); indice = null; } try { fs.unlinkSync(tmp); } catch (x) {} throw modeloGrande('su base de propiedades ' + String(e.message).replace(/^la base de propiedades /, '')); }
      rastro.push('base de propiedades: ' + msgE(e)); R = null; if (indice) { indice.abandona(); indice = null; }
      avance && avance('La base de propiedades no se pudo leer (' + msgE(e) + '): se sigue por la API de Autodesk, que es MUCHO mas lenta y trae menos parametros...', 0); }   // v1.372: se dice en el momento
    finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  } else if (!man || !man.base) rastro.push('base de propiedades: el manifiesto no la trae');
  if (!R) {
  avance && avance('Leyendo el arbol del modelo...', 0);
  try {
    const r = await esperaDatos(() => api.get(md + '/metadata/' + vista.guid + '?forceget=true'), (j) => !!(j && j.data && j.data.objects), ESPERA.arbol,
      (ms) => avance && avance('Autodesk esta preparando el arbol del modelo (la primera vez puede tardar varios minutos): ' + fmtEspera(ms) + '...', 0));
    if (r.j) { ix = indexaArbol(r.j); rastro.push('arbol: ' + ix.nombre.size.toLocaleString('es-PE') + ' objetos' + (r.esperas ? ' (tras ' + fmtEspera(r.ms) + ' de preparacion)' : ''));
      if (op.maxObjetos && ix.nombre.size > op.maxObjetos) throw modeloGrande('tiene ' + ix.nombre.size.toLocaleString('es-PE') + ' objetos; el maximo en el servidor es ' + Number(op.maxObjetos).toLocaleString('es-PE')); }   // v1.377
    else { if (r.preparando) sigue202 = true; rastro.push('arbol: ' + (r.preparando ? 'Autodesk siguio preparandolo ' + fmtEspera(r.ms) : 'llego vacio') + ' (' + r.esperas + ' consultas)');
      avisos.push('Autodesk no entrego el arbol del modelo: la categoria sale solo de las propiedades'); }
  } catch (e) { if (e && e.grande) throw e; rastro.push('arbol: ' + msgE(e)); avisos.push('sin arbol (' + String(e.message || e).slice(0, 120) + '): la categoria sale solo de las propiedades'); }
  R = new Resumen(cl, ix, formato);
  nuevoIndice();
  const agregaConIndice = (o) => { const rr = R.agrega(o); if (rr && indice) { indice.elem(o.objectid, o.name, rr.c, rr.clase, rr.anc); indice.propiedades(o.objectid, aplana(o)); } };
  /*
   * v1.364 — LAS PROPIEDADES, COMO LAS PIDE AUTODESK. "properties:query" EXIGE una consulta ("query"); sin
   * ella responde 400 "Invalid `query` format". Se piden POR OBJETO con "$in" ["objectid", ...] (los ids salen
   * del arbol), en tandas, cada tanda paginada. Primero una muestra (los padres de algunas hojas: los
   * ejemplares) para aprender las categorias declaradas, como el visor; luego todos.
   * Sin arbol: "properties" de una vez (GET ...?forceget=true).
   * v1.370: el 202 ("lo estoy preparando") se espera de verdad (minutos, con aviso), no 1 minuto.
   */
  const sinProps = (txt, r) => { const e = new Error(txt); e.sinPropiedades = true; if (r && r.preparando) sigue202 = true; return e; };
  const consulta = async (ids) => {
    const out = [];
    let off = 0, tot = null;
    for (let vuelta = 0; vuelta < 1000; vuelta++) {
      const cuerpo = { query: { '$in': ['objectid'].concat(ids) }, pagination: { offset: off, limit: 1000 } };
      const r = await esperaDatos(() => api.post(md + '/metadata/' + vista.guid + '/properties:query', cuerpo), (x) => !!(x && x.data && Array.isArray(x.data.collection)), ESPERA.consulta,
        (ms) => avance && avance('Autodesk esta preparando las propiedades del modelo (la primera vez puede tardar varios minutos): ' + fmtEspera(ms) + '...', recibidos));
      if (!r.j) { rastro.push('propiedades (consulta): ' + (r.preparando ? 'Autodesk siguio preparandolas ' + fmtEspera(r.ms) : 'llegaron vacias')); throw sinProps('Autodesk no entrego las propiedades (siguio preparandolas)', r); }
      const j = r.j;
      const col = j.data.collection || [];
      out.push(...col);
      const pg = j.pagination || {};
      if (pg.totalResults != null) tot = pg.totalResults;
      if (!col.length || (tot != null && out.length >= tot) || col.length < (pg.limit || 1000)) break;
      off += col.length;
    }
    if (tot != null && out.length < tot) faltaron += tot - out.length;   // Autodesk corto las paginas: se dice
    return out;
  };
  // en tandas; si Autodesk rechaza una tanda por larga (400), se parte a la mitad y sigue
  let tanda = 400;
  // v1.372: 4 tandas en vuelo a la vez (la API tardaba ~2 s por tanda: 2.500 tandas eran 80 minutos); se consumen EN ORDEN
  const EN_VUELO = Number(process.env.EXTRACTOR_EN_VUELO) || 4;
  const pideTanda = async (parte) => { for (;;) { try { return await consulta(parte); } catch (e) { if (e && e.status === 400 && parte.length > 25) { const m = Math.ceil(parte.length / 2); return (await pideTanda(parte.slice(0, m))).concat(await pideTanda(parte.slice(m))); } throw e; } } };
  const porTandas = async (ids, cada) => {
    const partes = []; for (let i = 0; i < ids.length; i += tanda) partes.push(ids.slice(i, i + tanda));
    const vuelo = [];
    for (let i = 0; i < partes.length || vuelo.length; ) {
      while (vuelo.length < EN_VUELO && i < partes.length) { const parte = partes[i++]; vuelo.push({ parte, p: pideTanda(parte) }); }
      const x = vuelo.shift();
      const col = await x.p;
      await cada(col, x.parte);
    }
  };
  try {
    if (ix) {
      const ids = [...ix.nombre.keys()].sort((a, b) => cadena(ix, a).length - cadena(ix, b).length);   // v1.366: padres antes que hijos, en TODAS las tandas
      total = ids.length;
      // 1) aprender las categorias declaradas de una muestra de ejemplares
      const hojas = ids.filter(id => !(ix.hijos.get(id) || 0)), paso = Math.max(1, Math.ceil(hojas.length / 300)), muestra = new Set();
      for (let i = 0; i < hojas.length; i += paso) { muestra.add(hojas[i]); const pa = ix.padre.get(hojas[i]); if (pa) muestra.add(pa); }
      const decl = new Set();
      await porTandas([...muestra], async (col) => { for (const o of col) for (const [k, v] of aplana(o)) if (claseDe(k) === 'cat' && String(v).trim()) decl.add(cl.norm('Categoria', String(v).trim())); });
      R.aprende(decl);
      R.pasoMuestra = Math.max(1, Math.floor(ids.length / (MAX_MUESTRA * 2)));   // v1.366: la muestra, repartida por todo el modelo
      // 2) todos los objetos, en tandas
      const t0 = Date.now();
      await porTandas(ids, async (col, parte) => {
        // orden de padres antes que hijos (asi una pieza sabe que su ejemplar ya es elemento)
        col.sort((a, b) => (cadena(ix, a.objectid).length - cadena(ix, b.objectid).length));
        for (const o of col) agregaConIndice(o);
        recibidos += parte.length;
        const falta = recibidos > 0 ? Math.round((Date.now() - t0) / recibidos * (total - recibidos) / 60000) : 0;   // v1.372: cuanto falta
        avance && avance('Leyendo propiedades por la API de Autodesk: ' + Math.min(recibidos, total).toLocaleString('es-PE') + ' de ' + total.toLocaleString('es-PE') + ' objetos' + (falta >= 1 ? ' (faltan ~' + falta + ' min)' : ''), recibidos);
      });
      rastro.push('propiedades: ' + recibidos.toLocaleString('es-PE') + ' objetos');
    } else {
      const r = await esperaDatos(() => api.get(md + '/metadata/' + vista.guid + '/properties?forceget=true'), (x) => !!(x && x.data && Array.isArray(x.data.collection) && x.data.collection.length), ESPERA.props,
        (ms) => avance && avance('Autodesk esta preparando las propiedades del modelo (la primera vez puede tardar varios minutos): ' + fmtEspera(ms) + '...', 0));
      if (!r.j) { rastro.push('propiedades: ' + (r.preparando ? 'Autodesk siguio preparandolas ' + fmtEspera(r.ms) : 'llegaron vacias') + ' (' + r.esperas + ' consultas)'); throw sinProps('Autodesk no entrego las propiedades del modelo (sin arbol y sin propiedades)', r); }
      const col = r.j.data.collection;
      for (const o of col) agregaConIndice(o);
      recibidos = total = col.length;
      rastro.push('propiedades: ' + recibidos.toLocaleString('es-PE') + ' objetos');
      avance && avance('Leyendo propiedades: ' + recibidos + ' objetos', recibidos);
    }
    if (indice) indice.nombraDesdeJs();
  } catch (e) {
    if (!e.sinPropiedades) rastro.push('propiedades: ' + msgE(e));
    if (indice) { indice.abandona(); indice = null; }
    throw falla(e.sinPropiedades ? 'Autodesk no entrego las propiedades del modelo' : 'No se pudieron leer las propiedades del modelo (' + msgE(e) + ')',
      sigue202 ? 'Autodesk sigue PREPARANDO el arbol y las propiedades de este modelo (pasa la primera vez que se piden, y en modelos grandes tarda): vuelve a pulsar "Extraer" en unos minutos.' : '');
  }
  if (origen === 'api' && man && man.base) avisos.push('la base de propiedades del modelo no se pudo leer; los parametros salen de la API de Autodesk (puede traer MENOS que el visor)');
  }
  const completo = (total == null || recibidos >= total) && !faltaron;
  if (!completo) avisos.push(faltaron ? 'Autodesk no entrego ' + faltaron + ' objeto(s) de las tandas pedidas' : 'se leyeron ' + recibidos + ' de ' + total + ' objetos');
  const idx = cierraIndice({ origen, modelo: nombreArchivo });
  if (idx) rastro.push('indice: ' + idx.nodos.toLocaleString('es-PE') + ' nodos, ' + idx.pares.toLocaleString('es-PE') + ' valores');
  let extra = {};
  if (R.sinParams && idx && op.rutaIndice) {   // v1.372: las estadisticas de parametros, desde el indice (SQLite), no de JavaScript
    avance && avance('Resumiendo los parametros desde el indice...', recibidos);
    try { extra = require('./indice-modelos').resumenDesdeIndice(op.rutaIndice, [...R.cat].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATS_COBERTURA).map(x => x[0])); }
    catch (e) { rastro.push('resumen de parametros: ' + msgE(e)); }
  }
  return R.final(Object.assign({ vista: { nombre: vista.name || '', guid: vista.guid }, origen, diagnostico: rastro.slice(0, 20), indice: idx, completitud: { completo, recibidos, total, avisos }, diagnosticoNodos: R.diagnosticoNodos || null }, extra));
}

module.exports = { claseDe, canonVisor, extraeModelo, eligeVista, indexaArbol, aplana, numero, Resumen, clasificadores, cadena, leeManifiesto, leeBaseSdb, preparando, descargaDerivado, Indice, nombresComoVisor, llenHuecoVisor };
