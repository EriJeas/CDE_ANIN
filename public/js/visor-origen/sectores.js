/* ORIGEN: Visor BIM Federado (visor-bim-anin v3.1.0, public/js/app.js). Copia TAL CUAL de las lineas indicadas; no se edita aqui.
 * Lo que este codigo espera del visor (props, filters, viewer, models, $...) lo da visor-puente.js. */
// --- app.js 302-308: paleta ---
const PALETTE = [
  [0xd9,0xd4,0xc7],[0x4a,0x8f,0xc0],[0xd8,0xb2,0x3a],[0x9e,0x2f,0x26],[0x3f,0xa0,0x8a],
  [0x8a,0x6a,0x4a],[0x7a,0x6f,0xb8],[0x9f,0xb3,0xc0],[0x6f,0x76,0x83],[0xc7,0xc1,0x9a],
  [0x38,0xb2,0x4d],[0xe0,0x7a,0x3f],[0x5b,0x8d,0x6a],[0xb0,0x6a,0x9e],[0x8a,0x94,0xa8],
];
const colorFor = i => PALETTE[i % PALETTE.length];
const cssColor = c => `rgb(${c[0]},${c[1]},${c[2]})`;
// --- app.js 5446-5469: orden de valores / fecha ---
const cmpAlfabetico = (a, b) =>
  String(a.value).localeCompare(String(b.value), 'es', { numeric: true, sensitivity: 'base' });
const cmpCantidad = (a, b) => b.ids.length - a.ids.length;

function ordenaValoresFiltro(f) {
  /*
   * Las FECHAS van siempre en orden cronologico, se haya montado ya la barra o
   * no. Ordenarlas alfabeticamente parece inofensivo con fechas ISO
   * (2026-03-16), pero con formato dia/mes (16/7/2026) el orden alfabetico no
   * es el cronologico, y de ahi salen colores y tramos que no cuadran.
   */
  if (f.tl || pareceFiltroDeFecha(f)) return ordenaValoresFecha(f);
  f.values.sort(f.ordenPorCantidad ? cmpCantidad : cmpAlfabetico);
}

/** Un filtro de fecha se reconoce porque la mayoria de sus valores parsea. */
function pareceFiltroDeFecha(f) {
  if (!f.values || f.values.length < 3) return false;
  let ok = 0;
  const n = Math.min(12, f.values.length);
  for (let i = 0; i < n; i++) if (parseaFechaValor(f.values[i].value, null) !== null) ok++;
  return ok >= n * 0.7;
}

// --- app.js 5470-5631: parametros agrupados (Sector, Zona, Partida, Bloque) ---
/* ----------------------------------------------------------------------------
 * Parametros AGRUPADOS: Sector y Zona (modulo "Filtro Sectores")
 *
 * En un federado el mismo concepto llega con nombres distintos segun quien
 * modelo: "Sector", "SECTOR", "CGM_Sector", "Sector de trabajo [Datos de
 * identidad]"... Filtrar sector por sector obligaba a añadir un filtro por cada
 * nombre y a cruzarlos a mano, que es justo lo contrario de lo que se quiere.
 *
 * Un grupo virtual se comporta como UN parametro mas: tiene su clave, aparece
 * en el desplegable y se carga con loadFilterValues como cualquier otro. Lo que
 * cambia es de donde salen sus valores: se juntan los de TODOS los parametros
 * cuyo nombre contenga la palabra, sin distinguir mayusculas ni tildes.
 *
 * Los valores iguales se funden (SECTOR 1 y Sector 1 son el mismo sector) y los
 * elementos se deduplican: si un elemento trae la misma sectorizacion en dos
 * parametros distintos, cuenta una vez.
 */
const VIRT_PREFIX = '\u25a0 ';        // "■ " marca los parametros agrupados

/** Minusculas y sin tildes, para comparar nombres de parametro y valores. */
const sinTildes = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * "02.03.01.01" es un codigo de partida; "CONCRETO Fc=100 KG/CM2" no.
 *
 * La regla: empieza por cifra y solo lleva cifras con puntos, guiones o
 * subguiones. Los mismos parametros "...partida..." traen unas veces codigos y
 * otras textos, asi que el reparto entre los dos botones se hace por el
 * CONTENIDO del valor, no por el nombre del parametro.
 */
/*
 * Lo que NO es ni codigo ni nombre, aunque viva en un parametro "...partida...":
 *
 *   - UNIDADES: "m2", "m3", "ml", "und", "kg"... Erick las vio colarse como
 *     nombres porque tienen letras. Un parametro "Unidad Partida" es de la
 *     partida, pero su contenido no es su nombre.
 *   - SIN DATO: "N.A.", "NA", "N/A", "-", "—". Es el relleno de los elementos
 *     que no tienen partida asignada; tomarlo por nombre daba filas con
 *     "N.A." en la tabla donde tenia que ir un guion.
 */
const UNIDAD_PARTIDA = /^(m|m2|m3|ml|m²|m³|und|u|kg|kgf|gl|glb|glo|pza|pto|jgo|dia|día|d|hh|hm|est|km|l|lt|t|tn|ton|cm|mm|%|bls|par|kit|rll|mes|sem|vje|p2|pie|pie2|pulg|ha|kw|hp|cj|doc|mll|mill|bol|sac|gal|pza\.|und\.|u\.|m\.|ml\.)$/i;
const SIN_DATO_PARTIDA = /^(n\.?\s*a\.?|n\/a|s\/n|s\.n\.|-+|—+|_+|\.+|sin\s*dato|sin\s*partida|ninguno|none|null|0)$/i;

/**
 * "02.03.01.01" es un codigo; "CONCRETO Fc=100 KG/CM2" no; "N.A." tampoco.
 *
 * La regla: tramos separados por puntos, guiones o subguiones, cortos, y al
 * menos la mitad de ellos solo cifras — asi entran tambien "OE.02.03" o
 * "1.A.03", que en algunos presupuestos llevan una letra. Un tramo solo
 * ("01") vale si es todo cifras. "m2" no tiene tramos ni es cifra: fuera.
 */
const esCodigoPartida = (t) => {
  const s = String(t).trim();
  if (!s || SIN_DATO_PARTIDA.test(s)) return false;
  if (/^\d{1,6}$/.test(s)) return true;
  if (!/^[0-9A-Za-z]{1,5}([.\-_][0-9A-Za-z]{1,5})+$/.test(s)) return false;
  const tramos = s.split(/[.\-_]/);
  const numericos = tramos.filter(x => /^\d+$/.test(x)).length;
  return numericos * 2 >= tramos.length;
};

/** Nombre de partida de verdad: texto con letras, ni unidad ni relleno. */
const esNombrePartida = (t) => {
  const s = String(t).trim();
  if (!s || SIN_DATO_PARTIDA.test(s) || UNIDAD_PARTIDA.test(s) || esCodigoPartida(s)) return false;
  return (sinTildes(s).match(/[a-z]/g) || []).length >= 3;
};

/** Parametros de UNIDAD o de medida no son ni codigo ni nombre. */
const esParamUnidad = (n) => /unidad|\bund\b|\bunit\b|medida|metrado/.test(n);

const GRUPOS_VIRT = [
  { id: 'sector', etiqueta: 'Sector',
    clave: VIRT_PREFIX + 'Sector (todos los parametros)',
    // "Sector", "SECTOR", "S03-SECTOR", "XX.SECTOR", "CGM_Sector"...
    prueba: (n) => n.includes('sector') },
  { id: 'zona', etiqueta: 'Zona',
    clave: VIRT_PREFIX + 'Zona (todos los parametros)',
    // "Zona", "ZONA", "Zone", "HVAC Zone", "Zona de trabajo"...
    prueba: (n) => n.includes('zona') || n.includes('zone') },
  { id: 'codpartida', etiqueta: 'C\u00f3digo de partida',
    clave: VIRT_PREFIX + 'Codigo de partida (todos los parametros)',
    prueba: (n) => n.includes('partida') && !esParamUnidad(n),
    filtraValor: (t) => esCodigoPartida(t) },
  { id: 'nompartida', etiqueta: 'Nombre de partida',
    clave: VIRT_PREFIX + 'Nombre de partida (todos los parametros)',
    prueba: (n) => n.includes('partida') && !esParamUnidad(n),
    filtraValor: (t) => esNombrePartida(t) },
  // v1.132: "Bloque", "BLOQUE", "S03-BLOQUE", "CGM_Bloque", "Block A"...
  { id: 'bloque', etiqueta: 'Bloque',
    clave: VIRT_PREFIX + 'Bloque (todos los parametros)',
    prueba: (n) => n.includes('bloque') || n.includes('block') },
];

const grupoVirt = (clave) => GRUPOS_VIRT.find(g => g.clave === clave) || null;

/*
 * v1.205 — EL DESPLEGABLE, SIN PEAJE. buildCard repinta el selector de
 * parametros en CADA repintado de filtros, y esto recorria los 5.069
 * parametros del indice por cada grupo, normalizando el texto de todos cada
 * vez. Medido con el indice de IREN SUR y diez familias de fecha: 173 ms
 * CADA repintado. Dos remedios, sin cambiar lo que devuelve:
 *   - el texto normalizado de cada parametro se calcula UNA vez por indice;
 *   - el resultado de cada grupo se guarda y se reutiliza mientras el indice
 *     sea el mismo (se rehace solo al reindexar, que es cuando cambia).
 */
let _normCache = { arr: null, map: null };
function paramsNormalizados() {
  if (_normCache.arr === props.params && _normCache.map) return _normCache.map;
  const m = new Map();
  for (const p of (props.params || [])) m.set(p, sinTildes(p));
  _normCache = { arr: props.params, map: m };
  return m;
}

/** Los parametros reales del indice que caen dentro del grupo. */
function paramsDeGrupo(g) {
  if (!g) return [];
  const lista = props.params || [];
  if (g._cacheArr === lista && g._cacheLen === lista.length && g._cache) return g._cache;
  const norm = paramsNormalizados();
  const out = lista.filter(p =>
    props.byParam.has(p) && g.prueba(norm.get(p) || sinTildes(p)));
  g._cache = out; g._cacheArr = lista; g._cacheLen = lista.length;
  return out;
}

/**
 * Valores del grupo: union de los de todos sus parametros.
 *
 * La clave de fusion es el texto normalizado; la etiqueta que se ensena es la
 * del parametro que mas elementos aporta, para que no salga "SECTOR 1" cuando
 * el 90 % del modelo lo escribe "Sector 1".
 */
function valoresDeGrupo(g) {
  const bolsa = new Map();          // normalizado -> { etiquetas:Map, ids:Set }
  for (const p of paramsDeGrupo(g)) {
    const vals = props.byParam.get(p);
    if (!vals) continue;
    for (const [v, ids] of vals) {
      const txt = String(v).trim();
      if (!txt) continue;
      // El reparto codigo/nombre de partida se decide aqui, valor a valor.
      if (g.filtraValor && !g.filtraValor(txt)) continue;
      const k = sinTildes(txt).replace(/\s+/g, ' ');
      let e = bolsa.get(k);
      if (!e) { e = { etiquetas: new Map(), ids: new Set() }; bolsa.set(k, e); }
      e.etiquetas.set(txt, (e.etiquetas.get(txt) || 0) + ids.length);
      for (const id of ids) e.ids.add(id);
    }
  }
  const out = [];
  let i = 0;
  for (const e of bolsa.values()) {
    let mejor = '', n = -1;
    for (const [txt, c] of e.etiquetas) if (c > n) { mejor = txt; n = c; }
    out.push({ value: mejor, ids: [...e.ids], color: colorFor(i++) });
  }
  return out;
}

// --- app.js 6137-6160: la barra Sector / Zona / Partida / Bloque (estado de cada boton) ---
function pintaBarraSectores() {
  const bar = $('secBar');
  if (!bar) return;
  const partes = [];
  for (const g of GRUPOS_VIRT) {
    const b = $('btnSec' + g.id.charAt(0).toUpperCase() + g.id.slice(1));
    if (!b) continue;
    const params = paramsDeGrupo(g);
    const puesto = filters.some(f => f.param === g.clave);
    b.classList.toggle('on', puesto);
    b.disabled = !params.length;
    b.title = params.length
      ? params.length + ' parametro(s): ' + params.join(', ')
      : 'Ningun parametro de este modelo contiene "' + g.etiqueta + '"';
    const f = filters.find(x => x.param === g.clave);
    partes.push(params.length
      ? `${g.etiqueta}: ${params.length} par\u00e1metro(s)` +
        (f ? ` \u00b7 ${f.values.length} valores` : '')
      : `${g.etiqueta}: sin parametros`);
  }
  const info = $('secInfo');
  if (info) info.textContent = partes.join('  \u00b7  ');
}

// --- app.js 17780-19338: linea de tiempo por fechas, motor de barras, tabla Sectores por fecha, ventana aparte ---

/* ----------------------------------------------------------------------------
 * Linea de tiempo por FECHAS, en cualquier filtro
 *
 * Si los valores de un parametro son fechas —da igual como se llame el
 * parametro—, aparece sola una barra de tiempo: al arrastrarla, los elementos
 * van "cargando" conforme su fecha queda dentro (fecha <= barra: normal;
 * despues: atenuado claro). Formatos entendidos solos: aaaa-mm-dd y
 * dd/mm/aaaa (con - / o .). Si el contenido es TEXTO y el formato es ambiguo
 * (dos digitos en todo), el enlace "Linea de tiempo..." deja elegir entre
 * aa/mm/dd y dd/mm/aa y con eso arma la barra.
 */
function parseaFechaValor(v, modo, mascara) {
  const t = String(v).trim();
  if (!t || /^n\/?a$/i.test(t)) return null;
  let t0, t1, t2;
  const m = t.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (m) {
    t0 = m[1]; t1 = m[2]; t2 = m[3];
  } else if (mascara && /^\d+$/.test(t) &&
             t.length === mascara[0] + mascara[1] + mascara[2]) {
    /*
     * FECHAS SIN SEPARADORES, el caso de La Caleta: "260406" es 26/04/06 pero
     * no trae ningun simbolo que lo diga. La mascara son los largos de cada
     * tramo —[2,2,2] u [4,2,2]— y sale de UNA cifra de ejemplo que el usuario
     * escribe con sus separadores puestos; aqui se replica a todos los valores
     * del parametro que midan lo mismo. Los que no midan lo mismo (el "0" de
     * los sin fecha) quedan como N/A, igual que siempre.
     */
    t0 = t.slice(0, mascara[0]);
    t1 = t.slice(mascara[0], mascara[0] + mascara[1]);
    t2 = t.slice(mascara[0] + mascara[1]);
  } else return null;
  let a, mes, d;
  if (modo === 'ymd' || (!modo && t0.length === 4)) { a = +t0; mes = +t1; d = +t2; }
  else if (modo === 'dmy' || (!modo && t2.length === 4)) { d = +t0; mes = +t1; a = +t2; }
  else return null;                       // ambiguo sin modo: que el usuario elija
  if (a < 100) a += 2000;
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  const f = new Date(a, mes - 1, d);
  return isFinite(f.getTime()) ? f.getTime() : null;
}

/**
 * La mascara que dibujan los separadores de una cifra de ejemplo.
 * "26/04/06" -> [2,2,2] · "2026-04-06" -> [4,2,2] · "06.04.2026" -> [2,2,4].
 * Vale cualquier simbolo como separador; lo que importa es DONDE esta.
 */
function mascaraDeEjemplo(txt) {
  const tramos = String(txt || '').trim().split(/[^\d]+/).filter(Boolean);
  if (tramos.length !== 3) return null;
  const m = tramos.map(x => x.length);
  const total = m[0] + m[1] + m[2];
  if (total < 5 || total > 8 || m[1] > 2) return null;   // el mes va en medio
  return m;
}

function armaLineaTiempo(f, modo, mascara) {
  const lista = [];
  for (const v of f.values) {
    const ts = parseaFechaValor(v.value, modo, mascara);
    if (ts === null) continue;
    for (const k of v.ids) lista.push([ts, k]);
  }
  if (!lista.length) return null;
  lista.sort((u, w) => u[0] - w[0]);
  return { modo, mascara: mascara || null, lista,
           min: lista[0][0], max: lista[lista.length - 1][0] };
}

/** Orden ascendente de una lista de valores de fecha (sin fecha al final). */
function ordenaValoresFecha(f) {
  const modo = f.tl ? f.tl.modo : null;
  const mascara = f.tl ? f.tl.mascara : null;
  f.values.sort((a, b) => {
    const ta = parseaFechaValor(a.value, modo, mascara);
    const tb = parseaFechaValor(b.value, modo, mascara);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });
}

function showModelPar(m) {
  try {
    const tree = m.getInstanceTree();
    if (tree) viewer.show(tree.getRootId(), m);
  } catch (e) {}
}

/*
 * v1.20 — MOTOR de las barras de tiempo (pedido de Erick):
 *   - VARIAS barras a la vez: con "Filtro O" encendido se juntan por UNION
 *     (elementos de cualquiera de ellas); sin el, se cruzan (Y).
 *   - Lo que queda FUERA de las barras se OCULTA de verdad (no fantasma).
 *   - Cada barra puede COLOREAR lo suyo con el color que elijas a su lado.
 * Los wrappers de abajo conservan el nombre historico para la cadena de
 * verificadores.
 */
// La barra que el usuario esta manejando: su color manda sobre las demas.
let barraViva = null;

/*
 * Lo que dejan ver las barras de fecha, o null si no hay ninguna viva.
 *
 * El inventario se alimentaba solo de computeResult(), que no sabe nada de las
 * barras: al mover una fecha el modelo cambiaba y la tabla de abajo seguia con
 * las filas de antes. Ahora las barras dejan aqui su resultado y el inventario
 * lo prefiere cuando existe.
 */
let visTiempos = null;

function aplicaTiempos() {
  const act = filters.filter(f => f.tl && f.tActivo != null && f.tOn !== false);
  if (typeof TS !== 'undefined') TS.aislado = false;   // al mover una barra, la vista vuelve a ser la suya
  if (!act.length) {
    visTiempos = null;
    try { refrescaDock(); } catch (e) {}
    // Sin barras no hay tabla de sectores por fecha que ensenar.
    try { const w = $('tsWin'); if (w) w.classList.add('hidden'); } catch (e) {}
    try {
      viewer.setGhosting(true);
      models.forEach(m => {
        viewer.clearThemingColors(m);
        showModelPar(m);
        viewer.isolate([], m);
      });
    } catch (e) {}
    applyView();                        // el estado normal de filtros vuelve a mandar
    return;
  }
  const setsB = act.map(f => {
    const s = new Set();
    for (const par of f.tl.lista) {
      if (par[0] > f.tActivo) break;    // ordenada: lo posterior corta aqui
      s.add(par[1]);
    }
    return s;
  });
  /*
   * CRUCE CON LOS SECTORES (solo en el modulo "Filtro Sectores").
   *
   * Fuera de ese modulo, las barras mandan solas y el panel se comporta como
   * siempre. Dentro, la pregunta que se hace en obra es otra: "de LOS SECTORES
   * QUE HE MARCADO, que hay hasta esta fecha". Eso son dos operaciones
   * distintas y en este orden:
   *
   *   1. Las barras de fecha se UNEN entre si —como el boton "Filtro O"— para
   *      que anadir una segunda barra sume, no reste: la seleccion de las
   *      fechas anteriores se mantiene.
   *   2. Esa union se CRUZA con lo marcado en Sector, Zona y cualquier otro
   *      filtro de texto.
   *
   * Antes esto no se podia: aplicaTiempos aislaba SOLO por fechas e ignoraba
   * los sectores marcados, asi que al mover la barra la seleccion no era la
   * que se pedia.
   */
  const modoSect = modoSectores();
  let vis;
  if (filtroO || act.length === 1) {
    vis = new Set();
    for (const s of setsB) for (const k of s) vis.add(k);
  } else if (modoSect) {
    // En Filtro Sectores las barras SUMAN entre si, aunque "Filtro O" este
    // apagado: anadir una segunda fecha no puede borrar la primera.
    vis = new Set();
    for (const s of setsB) for (const k of s) vis.add(k);
  } else {
    vis = setsB[0];
    for (let i = 1; i < setsB.length; i++) {
      const n = new Set();
      for (const k of vis) if (setsB[i].has(k)) n.add(k);
      vis = n;
    }
  }
  if (modoSect) {
    const base = resultadoSinFechas();
    if (base) {
      const n = new Set();
      for (const k of vis) if (base.has(k)) n.add(k);
      vis = n;
    }
  }
  const per = models.map(() => []);
  for (const k of vis) {
    const mi = decMi(k);
    if (per[mi]) per[mi].push(decId(k));
  }
  viewer.setGhosting(false);            // fuera de la barra = OCULTO, no fantasma
  models.forEach((m, mi) => {
    if (per[mi].length) { showModelPar(m); viewer.isolate(per[mi], m); }
    else hideModel(m);
  });
  models.forEach(m => { try { viewer.clearThemingColors(m); } catch (e) {} });
  /*
   * PRIORIDAD DE COLOR. Un elemento puede caer dentro de dos barras a la vez.
   * Antes ganaba la ULTIMA del recorrido, asi que al mover la primera barra se
   * veia el color de la segunda. Ahora manda la barra que acabas de tocar: se
   * pintan las demas primero y esa al final, que es lo que uno espera cuando
   * arrastra un cursor y mira el resultado.
   */
  const orden = act.slice().sort((x, y) =>
    (x === barraViva ? 1 : 0) - (y === barraViva ? 1 : 0));
  for (const f of orden) {
    if (!f.colorBarra) continue;
    const bi = act.indexOf(f);
    const vec = new THREE.Vector4(f.colorBarra[0] / 255, f.colorBarra[1] / 255,
                                  f.colorBarra[2] / 255, 1);
    for (const k of setsB[bi]) {
      if (!vis.has(k)) continue;
      const m = models[decMi(k)];
      if (m) viewer.setThemingColor(decId(k), vec, m, true);
    }
  }
  visTiempos = vis;
  try { refrescaDock(); } catch (e) {}
  try { pintaTablaSectores(act, setsB, vis); } catch (e) {}
}

/** ¿Esta encendido el modulo "Filtro Sectores"? */
function modoSectores() {
  try { return typeof modulosOn !== 'undefined' && modulosOn.has('sectores'); }
  catch (e) { return false; }
}

/**
 * Lo marcado en los filtros que NO llevan barra de fecha, cruzado entre si.
 *
 * Es el conjunto "sectores y zonas elegidos" con el que se cruza la union de
 * las barras. Los filtros de fecha con barra viva se saltan: ya participan por
 * su barra, y contarlos dos veces vaciaria el resultado.
 */
function resultadoSinFechas() {
  let result = null;
  for (const f of filters) {
    if (!f.param || f.selected.size === 0) continue;
    if (f.tl && f.tActivo != null && f.tOn !== false) continue;
    const ids = new Set();
    for (const v of f.values) if (f.selected.has(v.value)) for (const id of v.ids) ids.add(id);
    if (result === null) { result = ids; continue; }
    const inter = new Set();
    for (const k of result) if (ids.has(k)) inter.add(k);
    result = inter;
  }
  return result;
}

function aplicaLineaTiempo(f, t) { barraViva = f; f.tActivo = t; aplicaTiempos(); }

function quitaLineaTiempo(f) {
  if (barraViva === f) barraViva = null;
  f.tl = null;
  f.tActivo = null;
  aplicaTiempos();
  renderFilters();
}

function montaTimeline(f, card) {
  if (!card || card.querySelector('.tlBox')) return;
  const box = document.createElement('div');
  box.className = 'tlBox';
  card.appendChild(box);

  const pinta = () => {
    box.innerHTML = '';
    if (!f.tl) {
      // Detectar solo: si la mayoria de los valores parsea, la barra sale sola.
      const auto = armaLineaTiempo(f, null);
      const nAuto = auto ? auto.lista.length : 0;
      const totalIds = f.values.reduce((sum, v) => sum + v.ids.length, 0);
      if (auto && nAuto >= totalIds * 0.6) {
        f.tl = auto;
        f.esFecha = true;
        /*
         * Orden pedido: de la fecha MAS ANTIGUA (arriba) a la mas actual
         * (abajo), sea aa/mm/dd o dd/mm/aa. Los sin fecha (N/A) van al final.
         */
        if (!f.__ordFecha) {
          f.__ordFecha = true;
          ordenaValoresFecha(f);
          renderFilters();
          return;
        }
      } else {
        const enlace = document.createElement('span');
        enlace.className = 'tlEnlace';
        enlace.textContent = 'Linea de tiempo...';
        enlace.title = 'Si los valores son fechas en texto, elige el formato y se arma la barra';
        enlace.onclick = () => {
          box.innerHTML = '';

          /*
           * FECHAS SIN SEPARADORES (caso La Caleta: "260406").
           *
           * Si el parametro trae cifras corridas, no hay forma honesta de
           * adivinar donde parten el ano, el mes y el dia: 260406 puede ser
           * 26/04/06 o 2/60/406 para una maquina. La salida que pidio Erick:
           * se ensena UNA cifra del propio parametro y el usuario la reescribe
           * con sus separadores puestos —26/04/06—; de ahi sale la mascara
           * [2,2,2] y se replica a todos los valores que midan lo mismo. Los
           * botones de abajo siguen decidiendo si es aa/mm/dd o dd/mm/aa.
           */
          const cifras = f.values.map(v => String(v.value).trim())
            .filter(t => /^\d{5,8}$/.test(t));
          let entrada = null;
          if (cifras.length) {
            const porLargo = new Map();
            for (const t of cifras) porLargo.set(t.length, (porLargo.get(t.length) || 0) + 1);
            const largo = [...porLargo.entries()].sort((a, b) => b[1] - a[1])[0][0];
            const muestra = cifras.find(t => t.length === largo);
            // Propuesta inicial: 6 cifras se parten 2/2/2; 8, segun empiecen.
            let propuesta = muestra;
            if (largo === 6) {
              propuesta = muestra.slice(0, 2) + '/' + muestra.slice(2, 4) + '/' + muestra.slice(4);
            } else if (largo === 8) {
              propuesta = /^(19|20)/.test(muestra)
                ? muestra.slice(0, 4) + '/' + muestra.slice(4, 6) + '/' + muestra.slice(6)
                : muestra.slice(0, 2) + '/' + muestra.slice(2, 4) + '/' + muestra.slice(4);
            }
            const pista = document.createElement('div');
            pista.className = 'hint';
            pista.textContent = 'Estas fechas vienen sin separadores. Escribe esta misma ' +
              'cifra con sus separadores (/, - o .) donde van:';
            entrada = document.createElement('input');
            entrada.type = 'text';
            entrada.className = 'tlmask';
            entrada.value = propuesta;
            entrada.title = 'Ejemplo: 26/04/06 o 2026-04-06. Se aplicara a todas las ' +
              'fechas del parametro que midan lo mismo.';
            box.append(pista, entrada);
          }

          const aviso = document.createElement('span');
          aviso.className = 'hint';
          aviso.textContent = 'Formato de las fechas: ';
          const b1 = document.createElement('button');
          b1.className = 'sm'; b1.textContent = 'aa/mm/dd';
          const b2 = document.createElement('button');
          b2.className = 'sm'; b2.textContent = 'dd/mm/aa';
          const intenta = modo => {
            let mascara = null;
            if (entrada) {
              mascara = mascaraDeEjemplo(entrada.value);
              if (!mascara) {
                return alert('No entendi los separadores. Escribe la cifra en tres ' +
                  'tramos, por ejemplo 26/04/06 o 2026-04-06.');
              }
            }
            const r = armaLineaTiempo(f, modo, mascara);
            if (!r || r.lista.length < 2)
              return alert('Con ese formato casi nada parsea como fecha: revisa el otro' +
                (entrada ? ', o los separadores que pusiste' : '') + '.');
            f.tl = r;
            f.esFecha = true;
            if (!f.__ordFecha) { f.__ordFecha = true; ordenaValoresFecha(f); }
            aplicaLineaTiempo(f, f.tl.max);
            renderFilters();
          };
          b1.onclick = () => intenta('ymd');
          b2.onclick = () => intenta('dmy');
          box.append(aviso, b1, b2);
        };
        box.appendChild(enlace);
        return;
      }
    }
    const { min, max } = f.tl;
    const fila = document.createElement('div');
    fila.className = 'tlFila';
    /*
     * FECHA INICIAL a la izquierda de la barra. Sin ella el cursor daba una
     * fecha suelta sin escala: no se sabia si el recorrido empezaba en enero o
     * en agosto. Ahora se lee el tramo completo: inicio ---- cursor.
     */
    const desde = document.createElement('span');
    desde.className = 'tlFecha tlIni';
    desde.textContent = new Date(min).toLocaleDateString('es-PE');
    desde.title = 'Fecha inicial del parametro (la mas antigua). El cursor marca hasta donde se ve.';
    const rango = document.createElement('input');
    rango.type = 'range'; rango.min = 0; rango.max = 1000; rango.value = 1000;
    const fecha = document.createElement('span');
    fecha.className = 'tlFecha';
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.className = 'colorUno';
    colorIn.title = 'Colorea los elementos DENTRO de esta barra (hasta la fecha del cursor)';
    colorIn.value = f.colorBarra ? cssHex(f.colorBarra) : '#3aa5b8';
    colorIn.oninput = () => {
      f.colorBarra = hexRgb(colorIn.value);
      /*
       * El color de la barra manda en TODO su filtro (pedido de Erick):
       * uniforme en los cuadritos de la lista y en el 3D.
       */
      f.modoColor = 'uniforme';
      f.colorUno = f.colorBarra;
      aplicaTiempos();
      renderFilters();
    };
    const quitar = document.createElement('button');
    quitar.className = 'sm'; quitar.textContent = 'Quitar';
    quitar.title = 'Apaga la linea de tiempo y devuelve la vista';
    const rotula = t => {
      fecha.textContent = new Date(t).toLocaleDateString('es-PE');
    };
    /*
     * La barra cuenta desde que nace: eso es de la v1.20 y NO se toca aqui.
     * (la barra cuenta desde que nace)
     * Se mantiene porque lo pediste asi ("varias barras a la vez"), y cambiarlo
     * por mi cuenta seria deshacer una decision tuya sin avisar.
     *
     * Lo que si se anade es un interruptor por barra: con dos filtros de fecha,
     * sus conjuntos se CRUZAN (o se unen con "Filtro O") y puede que solo
     * quieras que mande uno. Ahora se decide desde la propia barra en vez de
     * tener que quitar el filtro entero.
     */
    if (f.tActivo == null) {
      f.tActivo = max;
      setTimeout(() => { try { aplicaTiempos(); } catch (e) {} }, 0);
    }
    if (f.tOn === undefined) f.tOn = true;
    // El cursor REFLEJA la posicion guardada (sobrevive a repintados).
    rango.value = Math.round(1000 * (f.tActivo - min) / ((max - min) || 1));
    rotula(f.tActivo);
    fila.classList.toggle('tlApagada', !f.tOn);
    let marco = null;
    rango.oninput = () => {
      const t = min + (max - min) * (rango.value / 1000);
      rotula(t);
      if (marco) return;
      marco = requestAnimationFrame(() => { marco = null; aplicaLineaTiempo(f, t); });
    };
    quitar.onclick = () => quitaLineaTiempo(f);
    const enciende = document.createElement('input');
    enciende.type = 'checkbox';
    enciende.checked = f.tOn;
    enciende.title = 'Que esta barra participe en el filtro. Apagala si quieres que ' +
                     'mande solo la otra: con dos barras encendidas sus conjuntos se cruzan ' +
                     '(o se unen con "Filtro O").';
    enciende.onchange = () => {
      f.tOn = enciende.checked;
      barraViva = f;
      aplicaTiempos();
      fila.classList.toggle('tlApagada', !f.tOn);
    };
    fila.append(enciende, desde, rango, colorIn, fecha, quitar);
    box.appendChild(fila);
  };
  pinta();
}


/* ============================================================================
 * TABLA DE SECTORES POR FECHA  (v1.61)
 *
 * Se abre sola al mover una barra de fecha con el modulo "Filtro Sectores"
 * encendido, y responde a la pregunta que se hace en obra mirando el modelo:
 * de los sectores que tengo marcados, que hay hasta cada fecha y cuanto es.
 *
 *   filas     un sector (y su zona, si tambien la estas filtrando)
 *   columnas  una por cada barra de fecha viva, con la fecha del cursor
 *             y despues una por familia, con su total y sus cantidades
 *
 * Las cantidades (area, longitud, volumen) NO se calculan: se leen de los
 * parametros del propio modelo, que es de donde tienen que salir para que
 * cuadren con la valorizacion. Si un modelo no los trae, la columna sale con el
 * recuento y ya esta: preferible a inventar una cifra.
 *
 * Pulsar cualquier celda lleva a esos elementos en el 3D.
 */
let TS = { abierta: false, filas: [], cols: [], sel: null,
           modo: 'acum', mes: '', q: '' };
const TS_AVISO_FILAS = 20000; // sin tope (peticion expresa); por encima se AVISA
const TS_FAMILIAS = 15;     // tope de columnas de familia: mas no se lee

/*
 * Indices por elemento, construidos una sola vez por modelo.
 *
 * props.byParam va de valor -> elementos, y aqui hace falta lo contrario. Se
 * arma al vuelo la primera vez y se rehace solo si cambia el indice, que es lo
 * que pasa al abrir o quitar modelos.
 */
let tsIdx = null;

/* ----------------------------------------------------------------------------
 * CANTIDADES: por que hay que PREGUNTARLE AL MODELO
 *
 * La longitud no salia para tubos y tuberias, y no era un fallo de la tabla: el
 * indice de filtros DESCARTA a proposito las propiedades cuyo valor es casi
 * distinto en cada elemento —"Longitud", "Area", "Volumen" lo son— porque un
 * desplegable con 40.000 longitudes no sirve para filtrar y ademas se come la
 * memoria. Asi que esos parametros nunca llegaban a props.byParam.
 *
 * La salida no es meterlos en el indice (volveria el problema de memoria que ya
 * costo arreglar), sino pedirlos al modelo SOLO para los elementos que la tabla
 * va a mostrar, que son unos pocos miles. Se piden con getBulkProperties2, el
 * mismo camino que usa el inventario, y se guardan en cache: cada elemento se
 * pregunta una sola vez por sesion.
 */
const CANT_NOMBRES = {
  area: /^(area|superficie)$/,
  vol: /^(volumen|volume)$/,
  largo: /^(longitud|length|largo)$/,
};
const cacheCant = new Map();        // clave -> { area, largo, vol }
let pidiendoCant = false;

/** Reparte una propiedad en su casilla de cantidad, si es una de las tres. */
function casillaCantidad(nombre) {
  const n = sinTildes(nombre).replace(/\s*\[.*$/, '').trim();
  for (const [k, rx] of Object.entries(CANT_NOMBRES)) if (rx.test(n)) return k;
  return null;
}

/**
 * Pide al modelo las cantidades de las claves que aun no se conocen.
 *
 * Devuelve promesa; cuando termina, avisa para que la tabla se rehaga con las
 * cifras ya puestas. Se limita el numero de elementos por vuelta: con la
 * seleccion entera de un hospital, pedirlo todo de golpe congela la pestana.
 */
const CANT_TOPE = 40000;

function pideCantidades(claves, cuandoAcabe) {
  if (pidiendoCant) return;
  const faltan = [];
  for (const k of claves) {
    if (!cacheCant.has(k)) { faltan.push(k); if (faltan.length >= CANT_TOPE) break; }
  }
  if (!faltan.length) return;
  pidiendoCant = true;

  const per = models.map(() => []);
  for (const k of faltan) { const mi = decMi(k); if (per[mi]) per[mi].push(decId(k)); }

  let pendientes = 0;
  let alguno = false;
  const listo = () => {
    if (--pendientes > 0) return;
    // Lo que el modelo no sepa se marca igualmente, para no volver a pedirlo.
    for (const k of faltan) if (!cacheCant.has(k)) cacheCant.set(k, null);
    pidiendoCant = false;
    if (alguno && cuandoAcabe) { try { cuandoAcabe(); } catch (e) {} }
  };

  models.forEach((m, mi) => {
    if (!per[mi].length) return;
    pendientes++;
    try {
      m.getBulkProperties2(per[mi], { needsExternalId: false }, (res) => {
        for (const r of res) {
          const c = { area: 0, largo: 0, vol: 0 };
          let hay = false;
          for (const p of (r.properties || [])) {
            const casilla = casillaCantidad(p.displayName || p.attributeName || '');
            if (!casilla) continue;
            const x = aNumero(p.displayValue);
            if (x == null) continue;
            c[casilla] = x; hay = true;
          }
          cacheCant.set(encId(mi, r.dbId), hay ? c : null);
          if (hay) alguno = true;
        }
        listo();
      }, listo);
    } catch (e) { listo(); }
  });
  if (!pendientes) { pidiendoCant = false; }
}

function indiceTabla() {
  const sello = props.total + ':' + props.params.length;
  if (tsIdx && tsIdx.sello === sello) return tsIdx;

  const fam = new Map();                       // clave -> familia
  const mFam = props.byParam.get(CANON_PREFIX + 'Familia') ||
               props.byParam.get(CANON_PREFIX + 'Tipo') ||
               props.byParam.get(CANON_PREFIX + 'Categoria');
  if (mFam) for (const [v, ids] of mFam) for (const k of ids) if (!fam.has(k)) fam.set(k, v);

  // Parametros de cantidad, reconocidos por su nombre en cualquier idioma.
  const cant = { area: new Map(), largo: new Map(), vol: new Map() };
  for (const p of props.params) {
    const n = sinTildes(p);
    const donde = /(^|[^a-z])(area|superficie)/.test(n) ? 'area'
                : /(^|[^a-z])(volumen|volume)/.test(n) ? 'vol'
                : /(^|[^a-z])(longitud|length|largo)/.test(n) ? 'largo' : null;
    if (!donde) continue;
    const m = props.byParam.get(p);
    if (!m) continue;
    for (const [v, ids] of m) {
      const x = aNumero(v);
      if (x == null) continue;
      for (const k of ids) if (!cant[donde].has(k)) cant[donde].set(k, x);
    }
  }
  /*
   * Codigo y nombre de partida POR ELEMENTO, con las mismas reglas que los
   * botones: parametros con "partida" en el nombre y reparto por el contenido
   * del valor. La tabla de sectores los usa para partir sus filas.
   */
  const cod = new Map(), nom = new Map();
  const llena = (gid, destino) => {
    const g = GRUPOS_VIRT.find(x => x.id === gid);
    if (!g) return;
    for (const p of paramsDeGrupo(g)) {
      const m = props.byParam.get(p);
      if (!m) continue;
      for (const [v, ids] of m) {
        const t = String(v).trim();
        if (!t || (g.filtraValor && !g.filtraValor(t))) continue;
        for (const k of ids) if (!destino.has(k)) destino.set(k, t);
      }
    }
  };
  llena('codpartida', cod);
  llena('nompartida', nom);

  tsIdx = { sello, fam, cant, cod, nom };
  return tsIdx;
}

/**
 * Numero dentro de un texto de propiedad: "1,234.56 m2", "12,50 m³", "8.5".
 *
 * El separador decimal se decide por el ULTIMO signo que aparece, que es la
 * unica regla que funciona con archivos de varios origenes: en un federado
 * conviven modelos guardados con configuracion regional distinta.
 */
function aNumero(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const bruto = String(v == null ? '' : v).trim();
  if (!bruto) return null;
  /*
   * Se toma el numero del PRINCIPIO, no "todo lo que parezca cifra".
   *
   * Quitar las letras a "12.5 m2" dejaba "12.52", que se sumaba como doce con
   * cincuenta y dos: un area inflada en la tabla y en cualquier informe que
   * saliera de ella. Y exigir que empiece por cifra evita el caso contrario,
   * que "m2" en una columna de unidades se lea como un 2.
   */
  const m = bruto.match(/^-?\d[\d.,]*/);
  if (!m) return null;
  let t = m[0].replace(/[.,]+$/, '');
  if (!/\d/.test(t)) return null;
  const ic = t.lastIndexOf(','), ip = t.lastIndexOf('.');
  if (ic >= 0 && ip >= 0) {
    t = ic > ip ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (ic >= 0) {
    // Una sola coma: decimal si deja 1 o 2 cifras detras, millares si son 3.
    t = (t.length - ic - 1) === 3 ? t.replace(',', '') : t.replace(',', '.');
  }
  const x = parseFloat(t);
  return isFinite(x) ? x : null;
}

const tsNum = (x, d) => x.toLocaleString('es-PE', { maximumFractionDigits: d == null ? 2 : d });

/**
 * Parte cada fila (sector x zona) en una por CODIGO de partida.
 *
 * El nombre que acompana al codigo es el mas frecuente entre los elementos de
 * esa celda: en la practica codigo y nombre van a pares, y si algun elemento
 * trae el codigo sin el nombre, gana el que diga la mayoria. La busqueda (TS.q)
 * filtra aqui, por codigo o por nombre, sin tildes ni mayusculas. Y hay tope de
 * filas: 19 sectores x 100 partidas se escriben rapido, pero no se leen.
 */
function parteEnPartidas(filas, idx) {
  const hayPartidas = (idx.cod && idx.cod.size) || (idx.nom && idx.nom.size);
  const q = sinTildes(String(TS.q || '').trim());
  const out = [];

  for (const fila of filas) {
    if (!hayPartidas) {
      if (!q) out.push({ etiquetas: fila.etiquetas, claves: fila.claves, cod: '', nom: '' });
      continue;
    }
    const por = new Map();                       // codigo -> { claves, noms }
    for (const k of fila.claves) {
      const c = idx.cod.get(k) || '';
      let e = por.get(c);
      if (!e) { e = { claves: new Set(), noms: new Map() }; por.set(c, e); }
      e.claves.add(k);
      const nm = idx.nom.get(k);
      if (nm) e.noms.set(nm, (e.noms.get(nm) || 0) + 1);
    }
    for (const [c, e] of por) {
      let nom = '', n = -1;
      for (const [t, veces] of e.noms) if (veces > n) { nom = t; n = veces; }
      if (q && !sinTildes(c).includes(q) && !sinTildes(nom).includes(q)) continue;
      out.push({ etiquetas: fila.etiquetas, claves: e.claves, cod: c, nom });
    }
  }

  /*
   * ORDEN: partida primero, sector despues. Erick lo pidio al reves de como
   * estaba, y tiene razon en el porque — con la partida delante, las filas de
   * una misma partida quedan juntas y sus celdas repetidas SE FUSIONAN
   * (rowspan): la tabla no tiene menos filas, pero se lee como si las tuviera.
   * Lo sin partida va al final, no en medio del presupuesto.
   */
  out.sort((a, b) =>
    ((a.cod === '') - (b.cod === '')) ||
    a.cod.localeCompare(b.cod, 'es', { numeric: true }) ||
    a.nom.localeCompare(b.nom, 'es') ||
    a.etiquetas.join('|').localeCompare(b.etiquetas.join('|'), 'es', { numeric: true }));
  return out;
}

/**
 * Cuantas filas seguidas comparten partida, y cuantas comparten ademas el
 * sector. Con eso la primera fila de cada grupo pinta la celda con rowspan y
 * las demas no la repiten. Sin tope de filas: fue peticion expresa, y la
 * fusion es justo lo que mantiene legible una tabla larga.
 */
function tramosPartida(datos) {
  const kP = (d) => d.fila.cod + '\u0001' + d.fila.nom;
  const kS = (d) => kP(d) + '\u0001' + d.fila.etiquetas.join('|');
  const sp1 = new Array(datos.length).fill(0);
  const sp2 = new Array(datos.length).fill(0);
  for (let i = 0; i < datos.length;) {
    let j = i + 1;
    while (j < datos.length && kP(datos[j]) === kP(datos[i])) j++;
    sp1[i] = j - i;
    for (let a = i; a < j;) {
      let b = a + 1;
      while (b < j && kS(datos[b]) === kS(datos[a])) b++;
      sp2[a] = b - a;
      a = b;
    }
    i = j;
  }
  return { sp1, sp2 };
}

/**
 * Las dos celdas de partida de una fila, con el guion cuando no hay.
 * Con `span` > 1 la celda abarca todas las filas de su partida, y su clic
 * lleva a los elementos de TODAS ellas (data-span), no solo a la primera.
 */
function celdasPartida(fila, i, span) {
  if (span === 0) return '';                     // la tapa la fila de arriba
  const rs = span > 1 ? ` rowspan="${span}" data-span="${span}"` : '';
  return `<td class="tsnom tscod" data-f="${i}"${rs} title="${escAttr(fila.cod || '')}">` +
         `${fila.cod ? esc(fila.cod) : '\u2014'}</td>` +
         `<td class="tsnom tspart" data-f="${i}"${rs} title="${escAttr(fila.nom || '')}">` +
         `${fila.nom ? esc(fila.nom) : '\u2014'}</td>`;
}

/** Las celdas de sector/zona, fusionadas cuando la fila de arriba las cubre. */
function celdasSector(fila, i, span) {
  if (span === 0) return '';
  const rs = span > 1 ? ` rowspan="${span}" data-span="${span}"` : '';
  return fila.etiquetas.map(t =>
    `<td class="tsnom" data-f="${i}"${rs} title="${escAttr(t)}">${esc(t)}</td>`).join('');
}

/** Los elementos de un tramo de filas fusionadas, para el clic en su celda. */
function clavesTramo(i, span) {
  const claves = [];
  for (let j = i; j < i + (span || 1) && j < TS.filas.length; j++) {
    const d = TS.filas[j];
    if (d) for (const k of d.fila.claves) claves.push(k);
  }
  return claves;
}

/**
 * ELEMENTOS REPETIDOS: el mismo muro contado en dos sectores.
 *
 * El boton Sector junta TODOS los parametros con esa palabra, y en obra es
 * frecuente que un mismo elemento traiga "Sector 1" en un parametro y "Sector
 * 01" en otro: cae en las dos filas y se suma dos veces. Ni la fila ni el total
 * mienten por si solos —cada sector tiene de verdad ese elemento—, pero la suma
 * de filas si. Esta columna dice cuantos elementos de la fila estan ADEMAS en
 * otra fila de sector distinto, y su celda los selecciona para corregirlos en
 * el modelo. Semana o partida distintas no cuentan: un elemento tiene una
 * fecha y un codigo.
 */
function marcaRepetidos(datos, mesDe) {
  const donde = new Map();                      // clave -> Map(sector -> mes)
  for (const d of datos) {
    const sec = d.fila.etiquetas.join(' / ');
    for (const k of d.fila.claves) {
      let m = donde.get(k);
      if (!m) { m = new Map(); donde.set(k, m); }
      m.set(sec, (mesDe && mesDe.get(k)) || '');
    }
  }
  let distintos = 0;
  for (const m of donde.values()) if (m.size > 1) distintos++;
  for (const d of datos) {
    const sec = d.fila.etiquetas.join(' / ');
    d.repetidos = [];
    /*
     * A QUE OTRO SECTOR (y en que mes) esta cada repetido. Se agrupa por
     * destino: "Sector 01 · junio 2026 (2)" dice mas que dos filas sueltas, y
     * es lo que hay que buscar en Revit para quitar el parametro que sobra.
     */
    d.repOtros = new Map();
    for (const k of d.fila.claves) {
      const m = donde.get(k);
      if (!m || m.size < 2) continue;
      d.repetidos.push(k);
      for (const [otro, mes] of m) {
        if (otro === sec) continue;
        const et = otro + (mes ? ' \u00b7 ' + nombreMes(mes) : '');
        d.repOtros.set(et, (d.repOtros.get(et) || 0) + 1);
      }
    }
  }
  return distintos;
}

/** Elemento -> mes de su fecha, segun las barras vivas (la primera que lo tenga). */
function mesPorClaveDe(act) {
  const m = new Map();
  for (const f of (act || [])) {
    for (const par of ((f.tl && f.tl.lista) || [])) if (!m.has(par[1])) m.set(par[1], claveMes(par[0]));
  }
  return m;
}

/**
 * Las filas que se muestran en la tabla, con su indice ORIGINAL.
 *
 * v1.101: el embudo de "Elementos repetidos" (como el filtro de una columna
 * de Excel) deja solo las filas que tienen repetidos. Se conserva el indice
 * original de cada fila porque las celdas lo llevan en data-f y TS.filas no
 * cambia. Pura: la bateria la ejecuta en seco.
 */
function filasSectores(datos, soloRep) {
  const out = [];
  for (let i = 0; i < datos.length; i++) {
    const d = datos[i];
    if (soloRep && !((d.repetidos || []).length)) continue;
    out.push({ d: d, i: i });
  }
  return out;
}

/** La celda de repetidos: cuantos, y a que otro sector y mes van. */
function celdaRepetidos(d, i) {
  const n = (d.repetidos || []).length;
  if (!n) {
    return `<td class="tsrep" data-f="${i}" data-rep="1" ` +
           'title="Ninguno de esta fila esta en otro sector">\u2014</td>';
  }
  const otros = [...(d.repOtros || new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const lineas = otros.slice(0, 3).map(([et, c]) =>
    `<span>\u2192 ${esc(et)} (${tsNum(c, 0)})</span>`).join('') +
    (otros.length > 3 ? `<span>+${otros.length - 3} m\u00e1s</span>` : '');
  return `<td class="tsrep tsrepon" data-f="${i}" data-rep="1" ` +
         `title="${escAttr('Tambien en: ' + otros.map(([et, c]) => et + ' (' + c + ')').join('; ') +
                  '. Pulsa para seleccionar solo estos elementos.')}">` +
         `<b>${tsNum(n, 0)}</b>${lineas}</td>`;
}

/** Los grupos (Sector / Zona) que ahora mismo tienen valores marcados. */
function gruposActivos() {
  const out = [];
  for (const g of GRUPOS_VIRT) {
    /*
     * Los grupos de partida NO generan filas: la tabla ya parte TODAS sus filas
     * por codigo de partida, y combinarlos aqui duplicaria la dimension. Su
     * seleccion sigue contando igual — restringe lo visible como cualquier
     * filtro — pero las etiquetas de fila son Sector y Zona.
     */
    if (g.id === 'codpartida' || g.id === 'nompartida') continue;
    const f = filters.find(x => x.param === g.clave && x.selected.size);
    if (f) out.push({ g, f });
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * SEMANAS (lunes a domingo)
 *
 * El acumulado responde "cuanto llevo hasta esta fecha". La semana responde
 * "cuanto hice esta semana", que es lo que se reporta en obra y lo que no se
 * podia sacar de aqui. Son dos preguntas distintas y por eso son dos modos.
 *
 * La semana empieza en LUNES. Se mapean todas las del rango, tenga o no
 * movimiento: una semana en blanco es informacion —"Semana sin avance"— y
 * saltarsela falsea la lectura del mes.
 */
function lunesDe(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dia = (d.getDay() + 6) % 7;          // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d.getTime();
}
const DIA_MS = 86400000;
const claveMes = (t) => {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (k) => {
  const [a, m] = k.split('-');
  return MESES[Number(m) - 1] + ' ' + a;
};

/** Etiqueta de una semana: "4 - 10 ago" y su mes de referencia. */
function etiquetaSemana(ini) {
  const a = new Date(ini), b = new Date(ini + 6 * DIA_MS);
  const dm = (d) => d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3);
  return dm(a) + ' \u2013 ' + dm(b);
}

/**
 * Todas las semanas que cubre la barra de fecha, vacias incluidas.
 *
 * El rango sale de los valores del propio parametro, no de donde este el
 * cursor: en este modo interesa el mes entero, y cortar por el cursor dejaria
 * las semanas siguientes en cero sin que se entienda por que.
 */
function semanasDe(f) {
  const lista = (f.tl && f.tl.lista) || [];
  if (!lista.length) return [];
  const ini = lunesDe(lista[0][0]);
  const fin = lunesDe(lista[lista.length - 1][0]);
  const out = [];
  for (let t = ini; t <= fin; t += 7 * DIA_MS) out.push(t);
  return out;
}

/** Elemento -> semana a la que pertenece su fecha. */
function semanaPorClave(f) {
  const m = new Map();
  for (const par of ((f.tl && f.tl.lista) || [])) m.set(par[1], lunesDe(par[0]));
  return m;
}

function pintaTablaSectores(act, setsB, vis) {
  const win = $('tsWin');
  if (!win) return;
  if (!modoSectores() || !act || !act.length) { win.classList.add('hidden'); return; }

  TS.ultimo = { act, setsB, vis };
  const grupos = gruposActivos();
  const idx = indiceTabla();
  pintaMandoTabla(act);
  if (TS.modo === 'semanas') return pintaPorSemanas(act, grupos, idx);

  /*
   * Filas. Con Sector y Zona marcados a la vez salen las COMBINACIONES que
   * existen de verdad: un sector que no toca esa zona no genera fila vacia.
   */
  let filas = [{ etiquetas: [], claves: vis }];
  for (const { g, f } of grupos) {
    const nuevas = [];
    for (const fila of filas) {
      for (const v of f.values) {
        if (!f.selected.has(v.value)) continue;
        const dentro = new Set();
        for (const k of v.ids) if (fila.claves.has(k)) dentro.add(k);
        if (!dentro.size) continue;
        nuevas.push({ etiquetas: fila.etiquetas.concat(v.value), claves: dentro });
      }
    }
    filas = nuevas;
  }
  if (!grupos.length) filas = [{ etiquetas: ['(todo lo visible)'], claves: vis }];

  /*
   * CADA FILA SE PARTE POR PARTIDA: sector x codigo, con su nombre al lado. Es
   * la vista de valorizacion que pedia Erick — y la tabla puede crecer a lo
   * largo y a lo ancho porque la ventana ya se redimensiona. La busqueda de
   * arriba filtra por codigo o por nombre, y si el modelo no trae partidas la
   * fila queda una sola con un guion.
   */
  const filasP = parteEnPartidas(filas, idx);

  // Familias presentes, ordenadas por peso: las que mandan salen primero.
  const peso = new Map();
  for (const fila of filasP)
    for (const k of fila.claves) {
      const fm = idx.fam.get(k) || '(sin familia)';
      peso.set(fm, (peso.get(fm) || 0) + 1);
    }
  const familias = [...peso.entries()].sort((a, b) => b[1] - a[1])
    .slice(0, TS_FAMILIAS).map(x => x[0]);

  // Celdas: por fila, un recorrido y de ahi salen fechas, familias y totales.
  const datos = filasP.map(fila => {
    const fechas = act.map((f, i) => {
      let n = 0;
      for (const k of fila.claves) if (setsB[i].has(k)) n++;
      return n;
    });
    const porFam = new Map();
    let tot = { n: 0, area: 0, largo: 0, vol: 0 };
    for (const k of fila.claves) {
      const fm = idx.fam.get(k) || '(sin familia)';
      let c = porFam.get(fm);
      if (!c) { c = { n: 0, area: 0, largo: 0, vol: 0, claves: [] }; porFam.set(fm, c); }
      c.n++; c.claves.push(k); tot.n++;
      /*
       * Manda lo que dice el MODELO (cache de getBulkProperties2) y, si de ahi
       * no hay nada, lo que quedara en el indice de filtros. Las longitudes de
       * tuberia solo llegan por el primer camino: el indice las descarta por
       * ser casi todas distintas.
       */
      const q = cacheCant.get(k);
      const a = q ? q.area : idx.cant.area.get(k);
      const l = q ? q.largo : idx.cant.largo.get(k);
      const v = q ? q.vol : idx.cant.vol.get(k);
      if (a) { c.area += a; tot.area += a; }
      if (l) { c.largo += l; tot.largo += l; }
      if (v) { c.vol += v; tot.vol += v; }
    }
    return { fila, fechas, porFam, tot };
  });

  TS.filas = datos;
  TS.cols = { act, familias };

  const cab = (grupos.length ? grupos.map(x => x.g.etiqueta) : ['Seleccion'])
    .map(t => `<th>${esc(t)}</th>`).join('');
  const cabPart = '<th>C\u00f3digo de partida</th><th>Nombre de partida</th>';
  const cabFechas = act.map(f => {
    const d = new Date(f.tActivo);
    return `<th title="${escAttr(nombreCorto(f.param))}">${esc(nombreCorto(f.param))}` +
           `<div class="tsfec">${d.toLocaleDateString('es-PE')}</div></th>`;
  }).join('');
  const cabFam = familias.map(fm =>
    `<th title="${escAttr(fm)}">${esc(recorta(fm, 22))}</th>`).join('');

  const repetidosDistintos = marcaRepetidos(datos, mesPorClaveDe(act));
  const filasVis = filasSectores(datos, !!TS.soloRep);

  // Partida primero, sector despues: es el orden que agrupa.
  let html = '<thead><tr>' + cabPart + cab + cabFechas +
    '<th class="tstot">Total</th>' +
    '<th class="tsrep" title="Elementos de la fila que estan ADEMAS en otro sector">' +
    'Elementos<br>repetidos <span id="tsFiltroRep" title="Como en Excel: dejar ' +
    'solo las filas CON repetidos" style="cursor:pointer;' +
    (TS.soloRep ? 'color:#31c3d2;' : 'opacity:.55;') +
    '">&#9660;</span></th>' + cabFam + '</tr></thead><tbody>';

  const celdaCant = (c) =>
    `<b>${tsNum(c.n, 0)}</b>` +
    (c.area ? `<span>${tsNum(c.area)} m²</span>` : '') +
    (c.largo ? `<span>${tsNum(c.largo)} m</span>` : '') +
    (c.vol ? `<span>${tsNum(c.vol)} m³</span>` : '');

  // v1.101: los tramos fusionados se calculan sobre las filas VISIBLES, para
  // que los rowspan cuadren tambien con el embudo puesto.
  const tramos = tramosPartida(filasVis.map(x => x.d));
  filasVis.forEach((x, j) => {
    const d = x.d, i = x.i;
    html += `<tr data-f="${i}">` +
      celdasPartida(d.fila, i, tramos.sp1[j]) +
      celdasSector(d.fila, i, tramos.sp2[j]) +
      d.fechas.map((n, j) => `<td class="tsn" data-f="${i}" data-d="${j}">${tsNum(n, 0)}</td>`).join('') +
      `<td class="tstot" data-f="${i}">${celdaCant(d.tot)}</td>` +
      celdaRepetidos(d, i) +
      familias.map(fm => {
        const c = d.porFam.get(fm);
        return c ? `<td class="tsn" data-f="${i}" data-fam="${escAttr(fm)}">${celdaCant(c)}</td>`
                 : '<td class="tsvacio">—</td>';
      }).join('') + '</tr>';
  });
  html += '</tbody>';

  $('tsTabla').innerHTML = html;
  $('tsInfo').textContent =
    `${datos.length} fila(s) · ${act.length} fecha(s) · ${familias.length} familia(s)` +
    (datos.length > TS_AVISO_FILAS
      ? ' · la tabla es MUY grande: la busqueda o el mes la aligeran' : '') +
    (repetidosDistintos
      ? ` · ${tsNum(repetidosDistintos, 0)} elemento(s) contados en mas de un sector` : '') +
    (TS.soloRep
      ? ` · embudo: solo repetidos (${filasVis.length} de ${datos.length} filas)` : '') +
    (TS.q ? ` · buscando "${TS.q}"` : '') +
    (peso.size > familias.length
      ? ` · de ${peso.size} familias se muestran las ${familias.length} con mas elementos` : '');

  // Cada celda lleva a sus elementos en el modelo.
  /*
   * v1.206 — UN OYENTE, NO UNO POR CELDA. Con 46.368 filas y 15 familias la
   * tabla tiene mas de un millon de celdas: enganchar un onclick a cada una
   * creaba cientos de miles de funciones vivas —memoria y tiempo— cada vez
   * que se repinta. El navegador ya sabe de que celda viene un clic, asi que
   * basta UN oyente en la tabla. Las filas NO se recortan: eso se pidio
   * expresamente (TS_AVISO_FILAS: sin tope, solo aviso).
   */
  $('tsTabla').onclick = (ev) => {
    const td = ev.target && ev.target.closest && ev.target.closest('td[data-f]');
    if (!td) return;
    (() => {
      const i = +td.getAttribute('data-f');
      const d = TS.filas[i];
      if (!d) return;
      let claves;
      if (td.hasAttribute('data-rep')) {
        claves = d.repetidos || [];              // solo los que estan en dos sectores
      } else if (td.hasAttribute('data-fam')) {
        const c = d.porFam.get(td.getAttribute('data-fam'));
        claves = c ? c.claves : [];
      } else if (td.hasAttribute('data-d')) {
        const j = +td.getAttribute('data-d');
        claves = [...d.fila.claves].filter(k => TS.cols.act[j] && setsB[j].has(k));
      } else {
        // Una celda fusionada abarca varias filas VISIBLES: se seleccionan
        // esas (con el embudo puesto, el tramo vive sobre filasVis).
        const span = +td.getAttribute('data-span') || 1;
        const j0 = filasVis.findIndex(y => y.i === i);
        claves = [];
        for (let t = 0; t < span && j0 >= 0 && filasVis[j0 + t]; t++) {
          const dd = filasVis[j0 + t].d;
          if (dd && dd.fila) claves = claves.concat([...dd.fila.claves]);
        }
      }
      llevaA(claves, td);
    })();
  };
  const fRep = $('tsFiltroRep');
  if (fRep) fRep.onclick = (ev) => {
    ev.stopPropagation();
    TS.soloRep = !TS.soloRep;
    if (TS.ultimo) pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
  };
  win.classList.remove('hidden');
  TS.abierta = true;
  try { sincronizaTsAparte(); } catch (e) {}

  /*
   * Las cantidades que aun no se conocen se piden al modelo y, cuando llegan,
   * la tabla se rehace UNA vez con las cifras puestas. Se hace despues de
   * pintar para que la tabla salga ya —con los recuentos— en vez de esperar.
   */
  const faltan = [];
  for (const d of datos) for (const k of d.fila.claves) if (!cacheCant.has(k)) faltan.push(k);
  if (faltan.length) {
    pideCantidades(faltan, () => {
      try { if (TS.abierta) pintaTablaSectores(act, setsB, vis); } catch (e) {}
    });
  }
}

/** Los dos botones de modo y, en semanas, el selector de mes. */
function pintaMandoTabla(act) {
  const host = $('tsMando');
  if (!host) return;
  const f = act[0];
  let meses = [];
  if (f) {
    const vistos = new Set();
    for (const t of semanasDe(f)) vistos.add(claveMes(t));
    meses = [...vistos].sort();
  }
  host.innerHTML =
    `<button class="sm${TS.modo === 'acum' ? ' on' : ''}" data-modo="acum">Acumulado</button>` +
    `<button class="sm${TS.modo === 'semanas' ? ' on' : ''}" data-modo="semanas">Por semanas</button>` +
    (TS.modo === 'semanas'
      ? `<select id="tsMes"><option value="">Toda la informacion</option>` +
        meses.map(m => `<option value="${escAttr(m)}"${m === TS.mes ? ' selected' : ''}>` +
                       `${esc(nombreMes(m))}</option>`).join('') + '</select>'
      : '') +
    `<input id="tsBuscar" type="text" value="${escAttr(TS.q || '')}"` +
    ' placeholder="Buscar codigo o nombre de partida...">' +
    /*
     * AISLAR: esconde todo lo que no sea lo ultimo pulsado en la tabla. La
     * seleccion resalta pero deja ver el resto; para revisar una partida en un
     * sector hace falta quedarse solo con ella. "Ver todo" devuelve la vista a
     * lo que digan barras y filtros.
     */
    `<button class="sm${TS.aislado ? ' on' : ''}" id="tsAislar" title="${TS.aislado
      ? 'Volver a ver lo que dicen las barras y los filtros'
      : 'Ocultar todo lo que no sea lo ultimo pulsado en la tabla'}">` +
    `${TS.aislado ? 'Ver todo' : 'Aislar'}</button>`;
  host.querySelectorAll('[data-modo]').forEach(b => {
    b.onclick = () => {
      TS.modo = b.getAttribute('data-modo');
      if (TS.modo === 'acum') TS.mes = '';
      if (TS.ultimo) pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
    };
  });
  const sel = $('tsMes');
  if (sel) sel.onchange = () => {
    TS.mes = sel.value;
    if (TS.ultimo) pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
  };
  const ais = $('tsAislar');
  if (ais) ais.onclick = tsAislar;

  /*
   * La busqueda repinta la tabla entera, y el repintado rehace tambien esta
   * caja: sin devolverle el foco y el cursor, escribir "0203" seria teclear
   * una cifra y perder la caja tres veces. Con el respiro de 250 ms ademas no
   * se repinta en cada tecla de una escritura rapida.
   */
  const bus = $('tsBuscar');
  if (bus) bus.oninput = () => {
    const v = bus.value;
    if (TS._qEspera) clearTimeout(TS._qEspera);
    TS._qEspera = setTimeout(() => {
      TS.q = v;
      if (!TS.ultimo) return;
      pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
      const nb = $('tsBuscar');
      if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }
    }, 250);
  };
  try { if (typeof guardaSesion === 'function') guardaSesion(); } catch (e) {}
}

/**
 * Tabla por SEMANAS: una fila por sector y semana, con lo de ESA semana.
 *
 * No es el acumulado recortado: aqui cada fila cuenta solo lo que entro en su
 * semana. Por eso se toma la fecha de cada elemento del parametro, y no el
 * conjunto que deja ver el cursor —que es acumulado por naturaleza—.
 */
function pintaPorSemanas(act, grupos, idx) {
  const f = act[0];
  const semanas = semanasDe(f).filter(t => !TS.mes || claveMes(t) === TS.mes);
  const deClave = semanaPorClave(f);

  // Universo: todo lo que tiene fecha en ese parametro, cruzado con los sectores.
  const conFecha = new Set(deClave.keys());
  let base = [{ etiquetas: [], claves: conFecha }];
  for (const { g, fil } of grupos.map(x => ({ g: x.g, fil: x.f }))) {
    const nuevas = [];
    for (const fila of base) {
      for (const v of fil.values) {
        if (!fil.selected.has(v.value)) continue;
        const dentro = new Set();
        for (const k of v.ids) if (fila.claves.has(k)) dentro.add(k);
        if (!dentro.size) continue;
        nuevas.push({ etiquetas: fila.etiquetas.concat(v.value), claves: dentro });
      }
    }
    base = nuevas;
  }
  if (!grupos.length) base = [{ etiquetas: ['(todo lo visible)'], claves: conFecha }];

  // Cada fila se parte por partida, igual que en el acumulado, y la busqueda
  // filtra aqui tambien: por semanas sin acotar, sector x partida x semana se
  // dispara, y para eso esta el tope y la barra de busqueda.
  const baseP = parteEnPartidas(base, idx);

  // Familias presentes en todo el conjunto, para que las columnas no bailen
  // de una semana a otra.
  const peso = new Map();
  for (const b of baseP)
    for (const k of b.claves) {
      const fm = idx.fam.get(k) || '(sin familia)';
      peso.set(fm, (peso.get(fm) || 0) + 1);
    }
  const familias = [...peso.entries()].sort((a, b) => b[1] - a[1])
    .slice(0, TS_FAMILIAS).map(x => x[0]);

  const datos = [];
  for (const b of baseP) {
    // Un solo recorrido por sector: cada elemento cae en su semana.
    const porSem = new Map();
    for (const k of b.claves) {
      const sem = deClave.get(k);
      if (sem == null) continue;
      let c = porSem.get(sem);
      if (!c) { c = new Set(); porSem.set(sem, c); }
      c.add(k);
    }
    for (const sem of semanas) {
      const claves = porSem.get(sem) || new Set();
      const porFam = new Map();
      const tot = { n: 0, area: 0, largo: 0, vol: 0 };
      for (const k of claves) {
        const fm = idx.fam.get(k) || '(sin familia)';
        let c = porFam.get(fm);
        if (!c) { c = { n: 0, area: 0, largo: 0, vol: 0, claves: [] }; porFam.set(fm, c); }
        c.n++; c.claves.push(k); tot.n++;
        const q = cacheCant.get(k);
        const a = q ? q.area : idx.cant.area.get(k);
        const l = q ? q.largo : idx.cant.largo.get(k);
        const v = q ? q.vol : idx.cant.vol.get(k);
        if (a) { c.area += a; tot.area += a; }
        if (l) { c.largo += l; tot.largo += l; }
        if (v) { c.vol += v; tot.vol += v; }
      }
      datos.push({ fila: { etiquetas: b.etiquetas, claves, cod: b.cod, nom: b.nom },
                   sem, porFam, tot, vacia: claves.size === 0 });
    }
  }
  TS.filas = datos;
  TS.cols = { act, familias };

  const cab = (grupos.length ? grupos.map(x => x.g.etiqueta) : ['Seleccion'])
    .map(t => `<th>${esc(t)}</th>`).join('');
  const repetidosDistintos = marcaRepetidos(datos, mesPorClaveDe(act));
  // v1.109: el mismo embudo del acumulado, aqui (pedido expreso).
  const filasVis = filasSectores(datos, !!TS.soloRep);
  let html = '<thead><tr>' +
    '<th>C\u00f3digo de partida</th><th>Nombre de partida</th>' + cab +
    `<th>Semana<div class="tsfec">${esc(nombreCorto(f.param))}</div></th>` +
    '<th class="tstot">Total</th>' +
    '<th class="tsrep" title="Elementos de la fila que estan ADEMAS en otro sector">' +
    'Elementos<br>repetidos <span id="tsFiltroRep" title="Como en Excel: dejar ' +
    'solo las filas CON repetidos" style="cursor:pointer;' +
    (TS.soloRep ? 'color:#31c3d2;' : 'opacity:.55;') + '">&#9660;</span></th>' +
    familias.map(fm => `<th title="${escAttr(fm)}">${esc(recorta(fm, 22))}</th>`).join('') +
    '</tr></thead><tbody>';

  const celdaCant = (c) =>
    `<b>${tsNum(c.n, 0)}</b>` +
    (c.area ? `<span>${tsNum(c.area)} m²</span>` : '') +
    (c.largo ? `<span>${tsNum(c.largo)} m</span>` : '') +
    (c.vol ? `<span>${tsNum(c.vol)} m³</span>` : '');

  const tramos = tramosPartida(filasVis.map(x => x.d));
  filasVis.forEach((x, j) => {
    const d = x.d, i = x.i;
    html += `<tr${d.vacia ? ' class="tsvacia"' : ''} data-f="${i}">` +
      celdasPartida(d.fila, i, tramos.sp1[j]) +
      celdasSector(d.fila, i, tramos.sp2[j]) +
      `<td class="tssem">${esc(etiquetaSemana(d.sem))}` +
      (d.vacia ? '<span class="tsnada">Semana sin avance</span>' : '') + '</td>' +
      `<td class="tstot" data-f="${i}">${d.vacia ? '0' : celdaCant(d.tot)}</td>` +
      celdaRepetidos(d, i) +
      familias.map(fm => {
        const c = d.porFam.get(fm);
        return c ? `<td class="tsn" data-f="${i}" data-fam="${escAttr(fm)}">${celdaCant(c)}</td>`
                 : '<td class="tscero">0</td>';
      }).join('') + '</tr>';
  });
  html += '</tbody>';

  $('tsTabla').innerHTML = html;
  $('tsInfo').textContent =
    `${datos.length} fila(s) \u00b7 ${semanas.length} semana(s)` +
    (datos.length > TS_AVISO_FILAS
      ? ' \u00b7 la tabla es MUY grande: la busqueda o el mes la aligeran' : '') +
    (repetidosDistintos
      ? ` \u00b7 ${tsNum(repetidosDistintos, 0)} elemento(s) contados en mas de un sector` : '') +
    (TS.soloRep
      ? ` \u00b7 embudo: solo repetidos (${filasVis.length} de ${datos.length} filas)` : '') +
    (TS.q ? ` \u00b7 buscando "${TS.q}"` : '') +
    (TS.mes ? ' de ' + nombreMes(TS.mes) : ' (todo el rango)') +
    ` \u00b7 ${familias.length} familia(s) \u00b7 cada fila cuenta SOLO su semana`;

  /*
   * v1.206 — UN OYENTE, NO UNO POR CELDA. Con 46.368 filas y 15 familias la
   * tabla tiene mas de un millon de celdas: enganchar un onclick a cada una
   * creaba cientos de miles de funciones vivas —memoria y tiempo— cada vez
   * que se repinta. El navegador ya sabe de que celda viene un clic, asi que
   * basta UN oyente en la tabla. Las filas NO se recortan: eso se pidio
   * expresamente (TS_AVISO_FILAS: sin tope, solo aviso).
   */
  $('tsTabla').onclick = (ev) => {
    const td = ev.target && ev.target.closest && ev.target.closest('td[data-f]');
    if (!td) return;
    (() => {
      const i2 = +td.getAttribute('data-f');
      const d = TS.filas[i2];
      if (!d) return;
      let claves;
      if (td.hasAttribute('data-rep')) claves = d.repetidos || [];
      else if (td.hasAttribute('data-fam'))
        claves = (d.porFam.get(td.getAttribute('data-fam')) || {}).claves || [];
      else {
        // Con el embudo puesto, el tramo fusionado vive sobre lo VISIBLE.
        const span = +td.getAttribute('data-span') || 1;
        const j0 = filasVis.findIndex(y => y.i === i2);
        claves = [];
        for (let t2 = 0; t2 < span && j0 >= 0 && filasVis[j0 + t2]; t2++) {
          const dd = filasVis[j0 + t2].d;
          if (dd && dd.fila) claves = claves.concat([...dd.fila.claves]);
        }
      }
      llevaA(claves, td);
    })();
  };
  const fRep2 = $('tsFiltroRep');
  if (fRep2) fRep2.onclick = (ev) => {
    ev.stopPropagation();
    TS.soloRep = !TS.soloRep;
    if (TS.ultimo) pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
  };
  $('tsWin').classList.remove('hidden');
  TS.abierta = true;
  try { sincronizaTsAparte(); } catch (e) {}

  const faltan = [];
  for (const d of datos) for (const k of d.fila.claves) if (!cacheCant.has(k)) faltan.push(k);
  if (faltan.length) {
    pideCantidades(faltan, () => {
      try { if (TS.abierta && TS.ultimo) {
        pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
      } } catch (e) {}
    });
  }
}

/** Aislar / Ver todo desde la ventana de sectores. */
function tsAislar() {
  if (TS.aislado) {
    TS.aislado = false;
    TS.ultSel = null;
    try { aplicaTiempos(); } catch (e) {}       // barras y filtros vuelven a mandar
    return;
  }
  const claves = (TS.ultSel && TS.ultSel.length) ? TS.ultSel : [...(leeSeleccionInv() || [])];
  if (!claves.length) {
    return alert('Primero pulsa una celda de la tabla: se aisla lo que quede seleccionado.');
  }
  const per = models.map(() => []);
  for (const k of claves) { const mi = decMi(k); if (per[mi]) per[mi].push(decId(k)); }
  try { viewer.setGhosting(false); } catch (e) {}
  models.forEach((m, mi) => {
    try {
      if (per[mi].length) viewer.isolate(per[mi], m);
      else { const t = m.getInstanceTree(); if (t) viewer.hide(t.getRootId(), m); }
    } catch (e) {}
  });
  TS.aislado = true;
  if (TS.ultimo) pintaMandoTabla(TS.ultimo.act);
  try { sincronizaTsAparte(); } catch (e) {}
}

/** Selecciona en el visor y encuadra, sin tocar lo que muestran los filtros. */
function llevaA(claves, td) {
  if (!claves || !claves.length) return;
  TS.ultSel = claves;                             // lo que "Aislar" va a dejar solo
  const host = $('tsTabla');
  if (host) host.querySelectorAll('td.on').forEach(x => x.classList.remove('on'));
  if (td) td.classList.add('on');
  const per = models.map(() => []);
  for (const k of claves) { const mi = decMi(k); if (per[mi]) per[mi].push(decId(k)); }
  models.forEach((m, mi) => { try { viewer.select(per[mi], m); } catch (e) {} });
  const primero = per.findIndex(a => a.length);
  if (primero >= 0) { try { viewer.fitToView(per[primero], models[primero]); } catch (e) {} }
}

/* ----------------------------------------------------------------------------
 * "SECTORES POR FECHA" EN UNA VENTANA APARTE (segunda pantalla)
 *
 * Una ventana flotante es un <div>: por mucho que se arrastre, no puede salir
 * de la pestana del navegador. Para ponerla en otro monitor hay que abrir una
 * ventana del NAVEGADOR de verdad, con window.open. Esa ventana no calcula
 * nada: cada vez que la tabla de aqui se repinta, se le copia el resultado; y
 * cada pulsacion alli (celda, modo, mes, busqueda) vuelve aqui por
 * window.opener y se ejecuta con la misma funcion que el clic normal. Una
 * sola logica, dos pantallas.
 */
function abreTsAparte() {
  if (TS.pop && !TS.pop.closed) { TS.pop.focus(); return; }
  const w = window.open('', 'visorSectoresPorFecha',
                        'popup=yes,width=1280,height=720,resizable=yes,scrollbars=yes');
  if (!w) return alert('El navegador bloqueo la ventana. Permite las ventanas emergentes para este sitio.');
  /*
   * La hoja de estilos va con URL ABSOLUTA: la ventana nace como about:blank y
   * desde ahi una ruta relativa no resuelve a nada; saldria una tabla en
   * blanco y negro sin explicacion.
   */
  const link = document.querySelector('link[href^="main.css"]');
  const cssRef = new URL(link ? link.getAttribute('href') : 'main.css', location.href).href;
  w.document.open();
  w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<title>Sectores por fecha \u2014 Visor BIM ANIN</title>' +
    `<link rel="stylesheet" href="${cssRef}">` +
    '<style>body{margin:0;background:var(--fondo);color:var(--texto);font:12px system-ui,sans-serif}' +
    '#pTop{position:sticky;top:0;background:var(--panel);padding:8px 10px;border-bottom:1px solid var(--linea);z-index:5}' +
    '#pTop .hint{display:block;margin-bottom:6px}#pTabla{padding:0 10px 10px}' +
    '.tsmando{margin-top:6px}</style></head><body>' +
    '<div id="pTop"><span id="pInfo" class="hint"></span><div id="pMando" class="tsmando"></div>' +
    '<div class="hint">Pulsa una celda para ir a esos elementos en el modelo (en la otra pantalla).</div></div>' +
    '<div id="pTabla"><table id="pTsTabla" class="tstabla"></table></div></body></html>');
  w.document.close();
  TS.pop = w;
  sincronizaTsAparte();
}

/** Copia la tabla a la ventana aparte y le engancha los clics hacia aqui. */
function sincronizaTsAparte() {
  const w = TS.pop;
  if (!w || w.closed) { TS.pop = null; return; }
  const doc = w.document;
  const tabla = doc.getElementById('pTsTabla');
  if (!tabla) return;
  tabla.innerHTML = $('tsTabla').innerHTML;
  const info = doc.getElementById('pInfo');
  if (info) info.textContent = $('tsInfo').textContent;
  const mando = doc.getElementById('pMando');
  if (mando) {
    mando.innerHTML = $('tsMando').innerHTML;
    mando.querySelectorAll('[data-modo]').forEach(b => {
      b.onclick = () => tsAccionExterna('modo', b.getAttribute('data-modo'));
    });
    const sel = mando.querySelector('#tsMes');
    if (sel) { sel.id = 'pMes'; sel.onchange = () => tsAccionExterna('mes', sel.value); }
    const ais = mando.querySelector('#tsAislar');
    if (ais) { ais.id = 'pAislar'; ais.onclick = () => tsAccionExterna('aislar', null); }
    const bus = mando.querySelector('#tsBuscar');
    if (bus) {
      bus.id = 'pBuscar';
      bus.oninput = () => {
        const v = bus.value;
        if (TS._pqEspera) clearTimeout(TS._pqEspera);
        TS._pqEspera = setTimeout(() => {
          tsAccionExterna('buscar', v);
          const nb = doc.getElementById('pBuscar');
          if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); }
        }, 250);
      };
    }
  }
  // v1.101: el embudo viaja copiado con la tabla; aqui se le engancha el clic.
  const fr = doc.getElementById('tsFiltroRep');
  if (fr) fr.onclick = (ev) => { ev.stopPropagation(); tsAccionExterna('embudo', null); };
  // v1.206: igual en la ventana aparte: un oyente para toda la tabla.
  tabla.onclick = (ev) => {
    const td = ev.target && ev.target.closest && ev.target.closest('td[data-f]');
    if (!td) return;
    tsAccionExterna('celda', {
      f: +td.getAttribute('data-f'),
      fam: td.getAttribute('data-fam'), d: td.getAttribute('data-d'),
      rep: td.hasAttribute('data-rep'), span: +td.getAttribute('data-span') || 1,
    });
  };
}

/** Lo que llega de la ventana aparte se ejecuta aqui, con la logica de siempre. */
function tsAccionExterna(accion, valor) {
  const repinta = () => {
    if (TS.ultimo) pintaTablaSectores(TS.ultimo.act, TS.ultimo.setsB, TS.ultimo.vis);
  };
  if (accion === 'embudo') { TS.soloRep = !TS.soloRep; return repinta(); }
  if (accion === 'modo') { TS.modo = valor; if (valor === 'acum') TS.mes = ''; return repinta(); }
  if (accion === 'mes') { TS.mes = valor; return repinta(); }
  if (accion === 'buscar') { TS.q = valor; return repinta(); }
  if (accion === 'aislar') return tsAislar();
  if (accion === 'celda') {
    const d = TS.filas[valor.f];
    if (!d) return;
    let claves;
    if (valor.rep) claves = d.repetidos || [];
    else if (valor.fam) claves = ((d.porFam.get(valor.fam) || {}).claves || []);
    else if (valor.d != null && valor.d !== '' && TS.ultimo) {
      const j = +valor.d;
      claves = [...d.fila.claves].filter(k => TS.ultimo.setsB[j] && TS.ultimo.setsB[j].has(k));
    } else {
      // v1.101: con el embudo puesto, el tramo fusionado vive sobre las filas
      // VISIBLES: se seleccionan esas, igual que en la tabla de dentro.
      const vis = filasSectores(TS.filas, !!TS.soloRep);
      const j0 = vis.findIndex(y => y.i === valor.f);
      claves = [];
      for (let t = 0; t < (valor.span || 1) && j0 >= 0 && vis[j0 + t]; t++) {
        const dd = vis[j0 + t].d;
        if (dd && dd.fila) claves = claves.concat([...dd.fila.claves]);
      }
    }
    llevaA(claves, null);
  }
}
// --- app.js 25753-25810: cerrar y CSV de la tabla ---

if ($('tsAparte')) $('tsAparte').onclick = abreTsAparte;

if ($('tsClose')) $('tsClose').onclick = () => {
  $('tsWin').classList.add('hidden');
  TS.abierta = false;
};
if ($('tsCsv')) $('tsCsv').onclick = () => {
  /*
   * El CSV se arma desde los DATOS y no leyendo la tabla pintada: con las
   * celdas fusionadas (rowspan), las filas de abajo ya no llevan su codigo ni
   * su sector en el DOM y las columnas se descuadraban. De paso mejora: en el
   * archivo cada fila repite su partida y su sector, que es lo que Excel
   * necesita para tablas dinamicas.
   */
  if (!TS.filas.length || !TS.cols) return;
  const col = (t) => '"' + String(t == null ? '' : t).replace(/\s+/g, ' ').trim()
    .replace(/"/g, '""') + '"';
  const cant = (c) => !c || !c.n ? '0'
    : c.n + (c.area ? ` | ${tsNum(c.area)} m2` : '') +
      (c.largo ? ` | ${tsNum(c.largo)} m` : '') +
      (c.vol ? ` | ${tsNum(c.vol)} m3` : '');
  const cabS = (gruposActivos().map(x => x.g.etiqueta));
  if (!cabS.length) cabS.push('Seleccion');
  const fam = (TS.cols && TS.cols.familias) || [];
  const filas = [];
  if (TS.modo === 'semanas') {
    filas.push(['Codigo de partida', 'Nombre de partida', ...cabS, 'Semana', 'Total',
                'Elementos repetidos', ...fam].map(col).join(';'));
    for (const d of TS.filas) {
      filas.push([d.fila.cod || '', d.fila.nom || '', ...d.fila.etiquetas,
        etiquetaSemana(d.sem) + (d.vacia ? ' (semana sin avance)' : ''),
        cant(d.tot), String((d.repetidos || []).length),
        ...fam.map(f2 => cant(d.porFam.get(f2)))].map(col).join(';'));
    }
  } else {
    const fechas = ((TS.cols && TS.cols.act) || []).map(f2 =>
      nombreCorto(f2.param) + ' ' + new Date(f2.tActivo).toLocaleDateString('es-PE'));
    filas.push(['Codigo de partida', 'Nombre de partida', ...cabS, ...fechas, 'Total',
                'Elementos repetidos', ...fam].map(col).join(';'));
    for (const d of TS.filas) {
      filas.push([d.fila.cod || '', d.fila.nom || '', ...d.fila.etiquetas,
        ...d.fechas.map(String), cant(d.tot), String((d.repetidos || []).length),
        ...fam.map(f2 => cant(d.porFam.get(f2)))].map(col).join(';'));
    }
  }
  const b = new Blob(['\ufeff' + filas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'sectores-por-fecha.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
