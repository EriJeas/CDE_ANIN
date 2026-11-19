/*
 * v1.379 — "MODELOS / PLANOS" (componente del visor): como Fieldwire, pero con el modelo.
 *
 * Eliges un nivel del modelo en "Visor con filtros" (el filtro ● Nivel, o los botones de nivel de este panel, que
 * marcan ese mismo filtro) y a la DERECHA salen los planos de ese nivel —los generales y los de sectores—,
 * agrupados por especialidad: eliges la especialidad, eliges el plano y se abre junto al modelo, en la ventana de
 * planos de siempre (abrirPlano: el PDF partido con el 3D y su enlace plano-modelo).
 *
 * De donde salen los planos (nada nuevo): los PDF del proyecto en Documentos Forma, con el indice del proyecto que
 * arma "Buscar en todo el proyecto" > "Rehacer indice" (IDX: nombre, descripcion, carpeta, version). Si el proyecto
 * aun no tiene indice, este panel lo arma una vez (busRehaceIndice) y queda para todos.
 *  - El NIVEL de un plano se lee de su DESCRIPCION en Forma ("275. Planta General Del Primer Nivel - Sechura",
 *    "276. Planta del Primer Nivel - Sector 2"): primer/segundo/... nivel, 1er nivel, nivel 2, pisos 2 al 5, sotano,
 *    semisotano, azotea/techos/coberturas, cimentacion, mezzanine. El nivel del modelo se lee igual
 *    ('Level "Primer Nivel", #933' -> Primer Nivel), asi "Primer Nivel Senaletica" tambien es el primer nivel.
 *  - La ESPECIALIDAD, del codigo del nombre (100017-CNSG001-131-01-DR-AR-000001: AR = Arquitectura; DR = plano)
 *    o, si el nombre no lo trae, de su carpeta (02.04.02_AR).
 *  - SECTORES: la descripcion dice "Sector 2", "Zona A", "Bloque B"...; si no, es un plano general del nivel.
 * La ventana se mueve por su cabecera y se agranda por la esquina (hazFlotante, como todas las del visor).
 *
 * v1.382 (a pedido): elegir un nivel con los botones de este panel NO toca el modelo (ni filtro ni colores: se queda normal);
 * si se elige el nivel en Visor con filtros, el panel le sigue como antes. La especialidad es el PENULTIMO campo del codigo
 * (...-01-DR-MD-000001: "MD"), tambien cuando sus letras coinciden con un tipo de documento: en Sechura, Mancora y Talara
 * "MD" es Equipamiento (su nombre sale de lo que dicen sus planos: "Plano General de Equipamiento").
 *
 * v1.384: el MODO INMERSIVO usa este mismo componente (los planos del nivel donde estas): lo abre sin "Visor con filtros"
 * (mpAlterna(true, { sinFiltros: true })) y toma el plano elegido para su minimapa (MP.alAbrir), sin abrir la ventana de
 * planos (que partiria la pantalla y romperia la inmersion). Fuera del modo inmersivo todo sigue igual.
 */
const MP = { abierto: false, esp: '', firma: '', abiertoId: '', prep: null, prepClave: '', min: false, t: null, cargado: '', cargaFin: '', propio: null, alAbrir: null };   // v1.384: + alAbrir
const MP_ORD = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7, setimo: 7, setima: 7, octavo: 8, octava: 8, noveno: 9, novena: 9,
  decimo: 10, decima: 10, undecimo: 11, duodecimo: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const MP_CLAVE_NIVEL = /^(nivel|niveles|piso|pisos|planta|plantas|level|levels|floor|floors|niv|nv)$/;
const MP_CONECTOR = /^(y|e|,|al|a|hasta|and|to)$/;
const MP_RANGO = /^(al|a|hasta|to)$/;
// La especialidad por su codigo (rol del nombre o carpeta). Lo que no este aqui sale como "Especialidad XX".
const MP_ESP = { AR: 'Arquitectura', ES: 'Estructuras', EE: 'Estructuras', EST: 'Estructuras', IS: 'Instalaciones sanitarias', SA: 'Instalaciones sanitarias',
  SN: 'Instalaciones sanitarias', IE: 'Instalaciones eléctricas', EL: 'Instalaciones eléctricas', IM: 'Instalaciones mecánicas', ME: 'Instalaciones mecánicas',
  HV: 'Climatización', CL: 'Climatización', AC: 'Aire acondicionado', CO: 'Comunicaciones', TC: 'Telecomunicaciones', TL: 'Telecomunicaciones',
  IC: 'Comunicaciones', CD: 'Comunicaciones y datos', EQ: 'Equipamiento', EM: 'Equipamiento médico', EB: 'Equipamiento biomédico',
  GM: 'Gases medicinales', GA: 'Gases medicinales', SE: 'Seguridad y evacuación', SG: 'Seguridad', SI: 'Seguridad integral', EV: 'Evacuación',
  SL: 'Señalética', SD: 'Señalización', ACI: 'Agua contra incendio', CI: 'Contra incendio', DI: 'Detección de incendios', PA: 'Paisajismo',
  UR: 'Urbanismo', TO: 'Topografía', TP: 'Topografía', GE: 'Geotecnia', VI: 'Vías', DM: 'Demolición', IN: 'Interiorismo',
  MO: 'Mobiliario', DO: 'Domótica', AU: 'Automatización', CV: 'Civil', HI: 'Hidráulica', RS: 'Residuos sólidos' };
// v1.382: lo que se sabe de los proyectos de Erick cuando las descripciones no lo deciden (Sechura, Mancora, Talara: MD = Equipamiento)
const MP_ESP_RESPALDO = { MD: 'Equipamiento' };
const MP_ORDEN_ESP = ['AR', 'ES', 'EE', 'EST', 'IS', 'SA', 'SN', 'IE', 'EL', 'IM', 'ME', 'HV', 'CL', 'AC', 'CO', 'TC', 'TL', 'IC', 'CD', 'EQ', 'EM', 'EB', 'GM', 'GA', 'SE', 'SG', 'SI', 'EV', 'SL', 'SD', 'ACI', 'CI', 'DI'];
// Tipos de documento del codigo (no son especialidad); los de PLANO, aparte
const MP_TIPOS_PLANO = new Set(['DR', 'DW', 'PL', 'PLN', 'LAM', 'PLA', 'PLO']);
const MP_TIPOS_DOC = new Set(['DR', 'DW', 'PL', 'PLN', 'LAM', 'PLA', 'PLO', 'ET', 'EETT', 'MD', 'MC', 'RP', 'IF', 'INF', 'CA', 'SH', 'SP', 'CR', 'MM', 'PR', 'PT', 'TB', 'LS', 'CT', 'BM', 'MT', 'PP', 'CRO']);

/** Sin mayusculas ni tildes (la ene, como n). Pura. */
function mpNorm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
/** Las palabras de un texto, con los ordinales con numero marcados ("1er" -> "o1") y los decimales fuera ("+3.50"). Pura. */
function mpTokens(texto) {
  return mpNorm(texto)
    .replace(/[+\-±]?\s?\d+[.,]\d+/g, ' dec ')
    .replace(/(\d{1,2})\s*(?:er|ero|era|ro|ra|do|da|to|ta|vo|va|no|na|mo|ma|[°º])\.?(?=[^a-z0-9]|$)/g, ' o$1 ')
    .replace(/,/g, ' , ').replace(/[^a-z0-9,]+/g, ' ').trim().split(' ').filter(Boolean);
}
/**
 * Los niveles que nombra un texto, como claves: n1, n2... (pisos), s1, s2 (sotanos), ss (semisotano), mez, techo,
 * cim. "Planta del Primer Nivel - Sector 2" -> [n1]; "Segundo y Tercer Nivel" -> [n2, n3]; "Pisos 2 al 5" -> n2..n5;
 * "Plano de Ubicacion" -> []. Pura.
 */
function mpClavesNivel(texto) {
  const t = mpTokens(texto), out = new Set();
  const rango = (a, b) => { if (a > b) [a, b] = [b, a]; if (b - a > 40) return; for (let k = a; k <= b; k++) out.add('n' + k); };
  const numDespues = (w) => /^\d{1,2}$/.test(w) ? +w : /^o\d{1,2}$/.test(w) ? +w.slice(1) : 0;
  const ordAntes = (w) => MP_ORD[w] || (/^o\d{1,2}$/.test(w) ? +w.slice(1) : 0);
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    let m;
    if (/^(azotea|azoteas|techo|techos|cubierta|cubiertas|cobertura|coberturas|roof)$/.test(w)) { out.add('techo'); continue; }
    if (/^(cimentacion|cimentaciones|cimientos|cimiento|fundacion|fundaciones)$/.test(w)) { out.add('cim'); continue; }
    if (/^(mezzanine|mezanine|mezzanina|mezanina|entrepiso|entrepisos)$/.test(w)) { out.add('mez'); continue; }
    if (/^semisotanos?$/.test(w)) { out.add('ss'); continue; }
    if (/^(sotano|sotanos|basement)$/.test(w)) { const d = numDespues(t[i + 1] || ''), o = ordAntes(t[i - 1] || ''); out.add('s' + (d || o || 1)); continue; }
    if ((m = /^(?:n|nv|niv)0*([1-9]\d?)$/.exec(w))) { out.add('n' + (+m[1])); continue; }
    if (!MP_CLAVE_NIVEL.test(w)) continue;
    if (/^sotanos?$/.test(t[i + 1] || '') || /^semisotanos?$/.test(t[i + 1] || '')) continue;   // "planta sotano": es el sotano
    // numeros DESPUES: "nivel 1", "pisos 2 al 5", "niveles 1, 2 y 3"
    let j = i + 1, previo = 0, con = '';
    while (j < t.length) {
      const o = numDespues(t[j]);
      if (o > 0 && o < 60 && (!previo || con)) { if (previo && MP_RANGO.test(con)) rango(previo, o); else out.add('n' + o); previo = o; con = ''; j++; continue; }
      if (previo && !con && MP_CONECTOR.test(t[j])) { con = t[j]; j++; continue; }
      break;
    }
    // ordinales ANTES: "primer nivel", "segundo y tercer nivel", "1er, 2do y 3er nivel", "2do al 5to nivel"
    j = i - 1; previo = 0; con = '';
    while (j >= 0) {
      const o = ordAntes(t[j]);
      if (o) { if (previo && MP_RANGO.test(con)) rango(o, previo); else out.add('n' + o); previo = o; con = ''; j--; continue; }
      if (previo && !con && MP_CONECTOR.test(t[j])) { con = t[j]; j--; continue; }
      break;
    }
  }
  return [...out];
}
/** El nombre de un nivel del modelo: 'Level "Primer Nivel", #933' (NWD) -> 'Primer Nivel'. Pura. */
function mpNivelDeValor(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^level\s*"(.*)"\s*(?:,\s*#\d+)?$/i.exec(s) || /^"(.*)"\s*,\s*#\d+$/.exec(s);
  return (m ? m[1] : s).trim();
}
const MP_ORD_NOMBRE = ['', 'Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo'];
/** El nombre para leer de una clave de nivel. Pura. */
function mpNombreNivel(k) {
  if (k === 'techo') return 'Techo / azotea'; if (k === 'cim') return 'Cimentación'; if (k === 'mez') return 'Mezzanine'; if (k === 'ss') return 'Semisótano';
  let m = /^s(\d+)$/.exec(k); if (m) return +m[1] === 1 ? 'Sótano' : 'Sótano ' + m[1];
  m = /^n(\d+)$/.exec(k); if (m) return MP_ORD_NOMBRE[+m[1]] ? MP_ORD_NOMBRE[+m[1]] + ' nivel' : 'Nivel ' + m[1];
  return k;
}
/** El orden de abajo hacia arriba: cimentacion, sotanos, semisotano, pisos (mezzanine tras el 1.o), techo. Pura. */
function mpPeso(k) {
  if (k === 'cim') return -100; if (k === 'ss') return -1; if (k === 'mez') return 1.5; if (k === 'techo') return 1000;
  let m = /^s(\d+)$/.exec(k); if (m) return -1 - +m[1];
  m = /^n(\d+)$/.exec(k); if (m) return +m[1];
  return 500;
}
/** Los campos del codigo del nombre (ISO 19650): ...-<tipo>-<rol>-<numero>. Pura. */
function mpCodigo(nombre) {
  const base = String(nombre || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const p = base.split(/[-_\s]+/).filter(Boolean);
  let iNum = -1;
  for (let i = p.length - 1; i >= 0; i--) if (/^\d{2,}$/.test(p[i])) { iNum = i; break; }
  if (iNum < 2) return { rol: '', tipo: '' };
  const rol = p[iNum - 1].toUpperCase(), tipo = p[iNum - 2].toUpperCase();
  return { rol: /^[A-Z]{2,4}$/.test(rol) ? rol : '', tipo: /^[A-Z]{2,4}$/.test(tipo) ? tipo : '' };
}
/**
 * La especialidad de un plano: por el codigo del nombre o, si no, por su carpeta (02.04.02_AR). Pura.
 * v1.382: el PENULTIMO campo (ISO 19650: ...-tipo-ROL-numero) es la especialidad cuando va tras un tipo de PLANO (DR...) o
 * cuando el nombre no trae tipo, aunque sus letras coincidan con un tipo de documento (MD: en Sechura, Mancora y Talara es
 * Equipamiento, ...-01-DR-MD-000001); antes se descartaba y esos planos caian en "Sin especialidad".
 */
function mpEspecialidad(nombre, ruta) {
  const c = mpCodigo(nombre);
  let cod = c.rol && (MP_TIPOS_PLANO.has(c.tipo) || !c.tipo || !MP_TIPOS_DOC.has(c.rol)) ? c.rol : '';
  if (!cod) {
    for (const x of String(ruta || '').split('/').map(s => s.trim()).filter(Boolean).reverse()) {
      const m = /(?:^|[._\s-])([A-Z]{2,4})$/.exec(x);
      if (m && !MP_TIPOS_DOC.has(m[1])) { cod = m[1]; break; }
    }
  }
  return cod ? { cod, nombre: MP_ESP[cod] || MP_ESP_RESPALDO[cod] || ('Especialidad ' + cod) } : { cod: '?', nombre: 'Sin especialidad' };
}
/** Si un PDF es un plano: por el tipo del codigo (DR...) o, si el nombre no lo trae, por su descripcion. Pura. */
function mpEsPlano(nombre, desc) {
  const c = mpCodigo(nombre);
  if (c.tipo && MP_TIPOS_PLANO.has(c.tipo)) return true;
  if (c.tipo && MP_TIPOS_DOC.has(c.tipo)) return false;   // memoria, especificaciones, informe...
  return /^(?:\d+[.)]?\s*)?(plano|planos|planta|plantas|lamina|laminas|corte|cortes|elevacion|elevaciones|detalle|detalles|esquema|diagrama|isometrico|vista)\b/.test(mpNorm(desc).trim());
}
/**
 * El sector que dice la descripcion ("Sector 2", "Zona A", "Bloque B"...), o '' si es un plano general. Pura.
 * v1.380: con varios ("Sector B, C, D y E, I5 - Sechura" -> "Sector B, C, D y E, I5"; "Sector F Y G" -> "Sector F y G").
 */
function mpSector(desc) {
  const m = /\b(sector|sect|zona|bloque|modulo|ala|cuadrante|pabellon|torre|tramo)\b\.?\s*(?:n[°ºo.]?\s*)?([a-z0-9]+(?:\s*(?:,|\by\b|\be\b|\/|&)\s*[a-z0-9]{1,3}\b)*)/.exec(mpNorm(desc));
  if (!m || /^(de|del|la|el|los|las|y|e|en|con)$/.test(m[2].split(/[\s,\/&]+/)[0])) return '';
  const tipo = m[1] === 'sect' ? 'sector' : m[1];
  const fmt = (t) => /^\d+$/.test(t) ? String(+t) : t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
  // palabra, enlace, palabra...: "d y e" es D y E (la "e" tras un enlace es un sector, no otro enlace)
  let txt = '', espera = true;
  for (const t of m[2].replace(/,/g, ' , ').split(/\s+/).filter(Boolean)) {
    if (espera) { txt += fmt(t); espera = false; }
    else if (t === ',') { txt += ', '; espera = true; }
    else if (/^(y|e|\/|&)$/.test(t)) { txt += ' ' + t + ' '; espera = true; }
    else txt += ' ' + fmt(t);
  }
  return tipo.charAt(0).toUpperCase() + tipo.slice(1) + ' ' + txt.trim();
}
/** La etapa de una carpeta (RIBA 4, Etapa 2, Fase 3...): la copia de la etapa mas avanzada es la vigente. Pura. */
function mpEtapa(ruta) { let e = 0; const rx = /(?:^|[^a-z])(?:riba|etapa|fase|stage)[\s_.-]*0?(\d{1,2})(?!\d)/g; let m; while ((m = rx.exec(mpNorm(ruta)))) e = Math.max(e, +m[1]); return e; }
/**
 * v1.380 — UN PLANO, UNA VEZ. Con el indice completo, el mismo codigo aparece en varias carpetas (01_WIP, 02_SHARED de
 * la RIBA 3 y de la RIBA 4, 03_PUBLISHED...), cada una con su descripcion de entonces ("89. Planta General..." frente a
 * "275. Planta General..."). Por codigo (el nombre del archivo, ISO 19650) queda la copia de la ETAPA mas avanzada y, a
 * igual etapa, la mas reciente; las demas viajan en "copias" (se ven en la ficha del plano). Pura.
 */
function mpUnicos(prep) {
  const g = new Map();
  for (const p of prep || []) {
    const k = String((p && p.f && p.f.name) || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim().toUpperCase();
    if (!k) continue;
    let a = g.get(k); if (!a) { a = []; g.set(k, a); } a.push(p);
  }
  const out = [];
  for (const a of g.values()) {
    a.sort((x, y) => mpEtapa(y.f.ruta) - mpEtapa(x.f.ruta) || String(y.f.mod || '').localeCompare(String(x.f.mod || '')) || (+y.f.vers || 0) - (+x.f.vers || 0));
    out.push(a.length > 1 ? Object.assign({}, a[0], { copias: a.slice(1) }) : a[0]);
  }
  return out;
}
/*
 * v1.380 — EL NOMBRE DE UNA ESPECIALIDAD QUE NO ESTA EN LA LISTA (FS, IT, MG, SC, ST... en Sechura salian como
 * "Especialidad FS"): se deduce de lo que dicen SUS planos. Si la mayoria de las descripciones de ese codigo hablan de
 * "gases medicinales", es Gases medicinales; si no hay mayoria clara, se queda "Especialidad XX" (no se inventa).
 */
const MP_ESP_PALABRAS = [
  [/gases?\s+medicinal|oxigeno|vacio\s+clinico|aire\s+medicinal/, 'Gases medicinales'],
  [/contra\s*incendio|agua\s+contra|rociador|sprinkler|gabinete/, 'Protección contra incendios'],
  [/deteccion|alarma/, 'Detección y alarma de incendios'],
  [/seguridad\s+y\s+evacuacion|evacuacion|senaletica|senalizacion/, 'Seguridad y evacuación'],
  [/comunicacion|telecomunicacion|cableado|voz\s+y\s+data|\bdata\b|\bdatos\b|\btic\b|cctv|videovigilancia|llamada\s+de\s+enfermera/, 'Comunicaciones / TIC'],
  [/aire\s+acondicionado|climatizacion|\bhvac\b|chiller/, 'Aire acondicionado / climatización'],
  [/ventilacion|extraccion|mecanic/, 'Instalaciones mecánicas'],
  [/electric|alumbrado|tomacorriente|tableros?\b/, 'Instalaciones eléctricas'],
  [/sanitari|agua\s+fria|agua\s+caliente|desague|drenaje/, 'Instalaciones sanitarias'],
  [/estructur|encofrado|cimentacion|aligerad|losa|columna|viga/, 'Estructuras'],
  [/equipamiento|equipos?\s+medic|mobiliario/, 'Equipamiento'],
  [/arquitectura|distribucion|acabados/, 'Arquitectura'],
];
/** El nombre que dicen las descripciones de un grupo de planos ('' si no hay mayoria clara). Pura. */
function mpNombrePorDescripciones(descs) {
  const ds = (descs || []).map(mpNorm).filter(Boolean);
  if (ds.length < 2) return '';
  let mejor = '', n = 0;
  for (const [rx, nombre] of MP_ESP_PALABRAS) { const c = ds.filter(d => rx.test(d)).length; if (c > n) { n = c; mejor = nombre; } }
  return n >= Math.max(2, Math.ceil(ds.length * 0.4)) ? mejor : '';
}
/** Los PDF del indice, con su nivel, especialidad, sector y si son plano. Pura. */
function mpPrepara(filas) {
  const out = [];
  for (const f of filas || []) {
    if (!f || (String(f.ext || '').toLowerCase() !== 'pdf' && !/\.pdf$/i.test(String(f.name || '')))) continue;
    out.push({ f, plano: mpEsPlano(f.name, f.desc), claves: f.desc ? mpClavesNivel(f.desc) : [], esp: mpEspecialidad(f.name, f.ruta), sector: mpSector(f.desc), sinDesc: !String(f.desc || '').trim() });
  }
  return out;
}
/** Los planos de unos niveles (claves; y, para los niveles sin clave, su nombre dentro de la descripcion). Pura. */
function mpDelNivel(prep, claves, textos) {
  const cs = claves instanceof Set ? claves : new Set(claves || []);
  const tx = (textos || []).filter(x => x && x.length >= 3);
  return (prep || []).filter(p => p.plano && !p.sinDesc && (p.claves.some(k => cs.has(k)) || tx.some(x => mpNorm(p.f.desc).includes(x))));
}
/** Por especialidad (en el orden de siempre: AR, ES, IS, IE, IM...), con sus generales y sus sectores. Pura. */
function mpAgrupa(lista) {
  const g = new Map();
  for (const p of lista || []) {
    let e = g.get(p.esp.cod);
    if (!e) { e = { cod: p.esp.cod, nombre: p.esp.nombre, deducido: !!p.esp.deducido, generales: [], sectores: [] }; g.set(p.esp.cod, e); }
    (p.sector ? e.sectores : e.generales).push(p);
  }
  const porNombre = (a, b) => String(a.f.name).localeCompare(String(b.f.name), 'es', { numeric: true });
  for (const e of g.values()) { e.generales.sort(porNombre); e.sectores.sort((a, b) => a.sector.localeCompare(b.sector, 'es', { numeric: true }) || porNombre(a, b)); }
  const pos = (c) => { const i = MP_ORDEN_ESP.indexOf(c); return i < 0 ? (c === '?' ? 999 : 500) : i; };
  return [...g.values()].sort((a, b) => pos(a.cod) - pos(b.cod) || a.cod.localeCompare(b.cod));
}

/* ------------------------------- el visor ------------------------------- */
const mp$ = (id) => document.getElementById(id);
const mpEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mpCP = () => (typeof CANON_PREFIX === 'string' ? CANON_PREFIX : '● ');
/** Los valores de ● Nivel marcados en "Visor con filtros" (en todos sus filtros de nivel). */
function mpNivelesDelFiltro() {
  const P = mpCP() + 'Nivel', out = [];
  try { for (const f of (typeof filters !== 'undefined' ? filters : [])) if (f && f.param === P && f.selected && f.selected.size) for (const v of f.selected) out.push(String(v)); } catch (e) {}
  return out;
}
/**
 * Los valores del nivel cuyos planos se muestran. v1.382: el que se eligio con los botones de este panel (MP.propio, que no
 * toca el modelo) o, si despues se cambio ● Nivel en Visor con filtros, lo que diga el filtro (como antes).
 */
function mpNivelesSeleccionados() {
  const delFiltro = mpNivelesDelFiltro();
  if (MP.propio) {
    if (delFiltro.join('\u0001') === MP.propio.firma) {
      if (!MP.propio.clave) return [];
      const g = mpNivelesDelModelo().find(x => x.clave === MP.propio.clave);
      return g ? g.valores.slice() : [];
    }
    MP.propio = null;   // el filtro cambio despues del boton: manda el filtro
  }
  return delFiltro;
}
/** Los niveles del modelo (de ● Nivel del indice del visor), agrupados por clave: [{ clave, valores, n }]. */
function mpNivelesDelModelo() {
  const m = (typeof props !== 'undefined' && props && props.byParam) ? props.byParam.get(mpCP() + 'Nivel') : null;
  const porClave = new Map();
  if (m) for (const [v, ids] of m) {
    for (const k of mpClavesNivel(mpNivelDeValor(v))) {
      let g = porClave.get(k); if (!g) { g = { clave: k, valores: [], n: 0 }; porClave.set(k, g); }
      g.valores.push(String(v)); g.n += (ids && ids.length) || 0;
    }
  }
  return [...porClave.values()].sort((a, b) => mpPeso(a.clave) - mpPeso(b.clave));
}
/**
 * Muestra los planos de ese nivel; otra vez, ninguno. v1.382 (a pedido): NO toca el modelo — ni crea ni cambia el filtro
 * ● Nivel, ni colorea, ni aisla: el modelo se queda normal. (Antes marcaba el filtro de Visor con filtros y lo coloreaba.)
 */
function mpEligeNivel(clave) {
  const g = mpNivelesDelModelo().find(x => x.clave === clave);
  if (!g) return;
  const visto = new Set(mpNivelesSeleccionados().map(v => mpClavesNivel(mpNivelDeValor(v))).flat());
  MP.propio = { clave: visto.has(clave) && visto.size === 1 ? '' : clave, firma: mpNivelesDelFiltro().join('\u0001') };
  MP.firma = '';
  mpPinta();
}
function mpPreparados() {
  const I = (typeof IDX !== 'undefined') ? IDX : null;
  if (!I || !I.filas) return null;
  const clave = I.project + '|' + I.cuando + '|' + I.filas.length;
  if (MP.prepClave !== clave) {
    const todos = mpPrepara(I.filas);
    MP.prep = mpUnicos(todos);   // v1.380: cada codigo una vez (la copia vigente)
    MP.copiasN = todos.length - MP.prep.length;
    // v1.380: el nombre de las especialidades que no estan en la lista, por lo que dicen sus planos
    const porCod = new Map();
    for (const p of MP.prep) if (p.plano && p.f.desc && !MP_ESP[p.esp.cod] && p.esp.cod !== '?') { let a = porCod.get(p.esp.cod); if (!a) { a = []; porCod.set(p.esp.cod, a); } a.push(p.f.desc); }
    for (const [cod, descs] of porCod) {
      const nom = mpNombrePorDescripciones(descs);
      if (nom) for (const p of MP.prep) if (p.esp.cod === cod) p.esp = { cod, nombre: nom, deducido: true };
    }
    MP.prepClave = clave;
  }
  return MP.prep;
}
/** v1.380: si el indice del proyecto puede estar INCOMPLETO (el recorrido antiguo del navegador se detenia en 600 carpetas). */
function mpIndiceIncompleto(I) {
  if (!I || !I.filas) return '';
  if (I.motor === 'servidor') return I.completo ? '' : 'parcial';
  return (I.carpetas || 0) > 600 ? 'antiguo600' : 'antiguo';
}

function mpEstilos() {
  if (mp$('mpEstilos')) return;
  const s = document.createElement('style'); s.id = 'mpEstilos';
  s.textContent =
    '#mpVentana{position:fixed;top:54px;right:12px;width:min(440px,34vw);height:calc(100vh - 150px);min-width:300px;min-height:120px;z-index:60;display:flex;flex-direction:column;overflow:hidden;' +
      'background:#0f151b;color:#dfe8ef;border:1px solid #2d6f82;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.45);font-size:12.5px}' +
    '#mpVentana.hidden{display:none}#mpVentana.mp-min{height:auto!important;min-height:0}#mpVentana.mp-min .mp-cuerpo{display:none}' +
    '#mpVentana .mp-cab{display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid rgba(44,196,214,.3)}' +
    '#mpVentana .mp-cab b{letter-spacing:.06em;text-transform:uppercase;font-size:12.5px}#mpVentana .mp-cab .mp-sub{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8fb3c2;font-size:11.5px}' +
    '#mpVentana .mp-cuerpo{flex:1;overflow:auto;padding:10px 12px}' +
    '#mpVentana .mp-tit{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#2cc4d6;margin:4px 0 6px}' +
    '#mpVentana .mp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}' +
    '#mpVentana .mp-chip{border:1px solid rgba(44,196,214,.45);background:rgba(44,196,214,.06);color:inherit;border-radius:16px;padding:4px 10px;cursor:pointer;font-size:12px}' +
    '#mpVentana .mp-chip.on{background:#2cc4d6;color:#06131b;border-color:#2cc4d6;font-weight:600}#mpVentana .mp-chip span{opacity:.7;font-size:10.5px}' +
    '#mpVentana .mp-esps{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0 12px}' +
    '#mpVentana .mp-esp{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;cursor:pointer;background:rgba(255,255,255,.03);text-align:left;color:inherit}' +
    '#mpVentana .mp-esp:hover{border-color:rgba(44,196,214,.7)}#mpVentana .mp-esp.on{border-color:#2cc4d6;background:rgba(44,196,214,.16);box-shadow:0 0 12px rgba(44,196,214,.25)}' +
    '#mpVentana .mp-esp .mp-cod{font:700 18px/1 monospace;color:#2cc4d6}#mpVentana .mp-esp .mp-nom{display:block;margin-top:4px;font-weight:600}#mpVentana .mp-esp .mp-n{display:block;margin-top:3px;font-size:11px;color:#8fb3c2}' +
    '#mpVentana .mp-grupo{margin:6px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8fb3c2}' +
    '#mpVentana .mp-plano{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 9px;margin:4px 0;cursor:pointer;background:rgba(255,255,255,.02);color:inherit}' +
    '#mpVentana .mp-plano:hover{border-color:rgba(44,196,214,.6)}#mpVentana .mp-plano.on{border-color:#e8b04a;background:rgba(232,176,74,.12)}' +
    '#mpVentana .mp-plano .mp-pc{font:600 11.5px monospace;word-break:break-all}#mpVentana .mp-plano .mp-pd{display:block;margin-top:2px}#mpVentana .mp-plano .mp-pv{float:right;font-size:10.5px;color:#8fb3c2;margin-left:6px}' +
    '#mpVentana .mp-sector{display:inline-block;font-size:10.5px;border:1px solid rgba(232,176,74,.6);color:#e8b04a;border-radius:10px;padding:0 6px;margin-left:4px}' +
    '#mpVentana .mp-hint{color:#8fb3c2;font-size:12px;margin:6px 0}#mpVentana .mp-pie{margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:#8fb3c2}' +
    '#mpVentana button.sm{padding:2px 8px;font-size:12px}#mpVentana a{color:#2cc4d6}' +
    '#mpVentana .mp-aviso{margin:4px 0 10px;padding:8px 10px;border:1px solid rgba(232,176,74,.55);border-left:3px solid #e8b04a;border-radius:8px;background:rgba(232,176,74,.08);font-size:12px;line-height:1.45}' +
    '#mpVentana .mp-aviso button{margin:6px 6px 0 0}#mpVentana .mp-aviso span{color:#8fb3c2;font-size:11px}#mpVentana .mp-progreso{border-left:3px solid #2cc4d6;padding-left:8px}' +
    '#mpVentana .mp-copias{display:block;margin-top:3px;font-size:10.5px;color:#8fb3c2;font-style:italic}';   // v1.380
  document.head.appendChild(s);
}
function mpVentana() {
  let w = mp$('mpVentana');
  if (w) return w;
  mpEstilos();
  w = document.createElement('div');   // un div (no aside, ni ...Panel): la interfaz nueva no lo ancla, asi se mueve y se agranda
  w.id = 'mpVentana'; w.className = 'hidden' + (document.documentElement.classList.contains('in-nueva') ? ' in-vidrio-panel' : '');
  w.innerHTML = '<div class="mp-cab" data-arrastre><b>Modelos / Planos</b><span class="mp-sub"></span>' +
    '<button class="sm" data-mp="prev" title="Plano anterior de esta especialidad">‹</button><button class="sm" data-mp="sig" title="Plano siguiente de esta especialidad">›</button>' +
    '<button class="sm" data-mp="min" title="Minimizar / mostrar la lista">–</button><button class="sm" data-mp="cerrar" title="Cerrar">×</button></div><div class="mp-cuerpo"></div>';
  document.body.appendChild(w);
  w.querySelector('[data-mp="cerrar"]').onclick = () => mpAlterna(false);
  w.querySelector('[data-mp="min"]').onclick = () => { MP.min = !MP.min; w.classList.toggle('mp-min', MP.min); };
  w.querySelector('[data-mp="prev"]').onclick = () => mpVecino(-1);
  w.querySelector('[data-mp="sig"]').onclick = () => mpVecino(1);
  try { if (typeof hazFlotante === 'function') hazFlotante(w); } catch (e) {}   // se mueve por la cabecera y se agranda por la esquina
  w.addEventListener('click', mpClic);
  return w;
}
/**
 * Abre o cierra el componente; al abrir, con "Visor con filtros" a la vista (ahi se elige el nivel).
 * v1.384: op.sinFiltros (el modo inmersivo): sin abrir Visor con filtros detras del recorrido.
 */
function mpAlterna(abrir, op) {
  const w = mpVentana();
  const ver = abrir === undefined ? w.classList.contains('hidden') : !!abrir;
  w.classList.toggle('hidden', !ver);
  MP.abierto = ver;
  clearInterval(MP.t); MP.t = null;
  if (!ver) return;
  try { if (!(op && op.sinFiltros) && typeof modulosOn !== 'undefined' && !modulosOn.has('filtros') && typeof activaModulo === 'function') activaModulo('filtros'); } catch (e) {}
  MP.firma = ''; mpVigila();
  MP.t = setInterval(mpVigila, 700);
}
/** Lo que cambia por fuera (el nivel marcado en los filtros, el indice, el proyecto): se repinta solo si cambio. */
function mpVigila() {
  if (!MP.abierto) return;
  const proj = (typeof nav !== 'undefined' && nav && nav.project) || '';
  if (proj && MP.cargado !== proj && typeof busIndiceCarga === 'function') {
    MP.cargado = proj;
    const fin = () => { MP.cargaFin = proj; MP.firma = ''; mpVigila(); };
    try { busIndiceCarga().then(fin, fin); } catch (e) { fin(); }
  }
  const I = (typeof IDX !== 'undefined') ? IDX : null;
  const nb = (typeof props !== 'undefined' && props && props.byParam) ? props.byParam.size : 0;
  const firma = [proj, mpNivelesSeleccionados().join('\u0001'), I && I.project, I && I.cuando, I && I.filas ? I.filas.length : -1, I && I.est ? 'e' + I.est.filas.length + '.' + (I.est.archivos || 0) + '.' + (I.est.carpetas || 0) : '', I && I.motor, I && I.completo, nb, MP.cargaFin].join('|');   // v1.380: + el avance del recorrido del servidor
  if (firma === MP.firma) return;
  MP.firma = firma;
  mpPinta();
}
function mpPinta() {
  const w = mp$('mpVentana'); if (!w) return;
  const cuerpo = w.querySelector('.mp-cuerpo'), sub = w.querySelector('.mp-sub');
  const proj = (typeof nav !== 'undefined' && nav && nav.project) || '';
  const sel = mpNivelesSeleccionados(), claves = new Set(), textos = [];
  for (const v of sel) { const nom = mpNivelDeValor(v), ks = mpClavesNivel(nom); if (ks.length) ks.forEach(k => claves.add(k)); else textos.push(mpNorm(nom)); }
  const niveles = mpNivelesDelModelo();
  let h = '<div class="mp-tit">Nivel del modelo</div>';
  h += niveles.length
    ? '<div class="mp-chips">' + niveles.map(g => '<button class="mp-chip' + (claves.has(g.clave) ? ' on' : '') + '" data-mpnivel="' + mpEsc(g.clave) + '" title="Ver los planos de este nivel (el modelo no cambia: ni filtro ni colores)">' +
        mpEsc(mpNombreNivel(g.clave)) + ' <span>' + g.n.toLocaleString('es-PE') + '</span></button>').join('') + '</div>'
    : '<div class="mp-hint">' + ((typeof props !== 'undefined' && props && props.byParam && props.byParam.size) ? 'El modelo no trae ● Nivel reconocible: elige el nivel en Visor con filtros.' : 'Carga un modelo: sus niveles salen aqui (y en Visor con filtros, filtro ● Nivel).') + '</div>';
  const nombresSel = [...claves].sort((a, b) => mpPeso(a) - mpPeso(b)).map(mpNombreNivel).concat(textos.length ? sel.filter(v => !mpClavesNivel(mpNivelDeValor(v)).length).map(mpNivelDeValor) : []);
  let subTxt = nombresSel.join(', ');
  const I = (typeof IDX !== 'undefined') ? IDX : null;
  const nf = (x) => (+x || 0).toLocaleString('es-PE');
  // v1.380: el avance del recorrido (lo hace el servidor, entero); mientras, se sigue viendo lo del indice anterior
  const progreso = (I && I.est) ? '<div class="mp-hint mp-progreso">' + (I.est.servidor
      ? 'El servidor recorre <b>todas</b> las carpetas de Forma del proyecto (queda para todos; sigue aunque cierres el visor): <b>' + nf(I.est.carpetas) + '</b> carpeta(s) y <b>' + nf(I.est.archivos) + '</b> archivo(s)' + (I.est.pendientes ? ', ' + nf(I.est.pendientes) + ' carpeta(s) por leer' : '') + '...'
      : 'Leyendo los documentos del proyecto en Forma (una sola vez; queda para todos): <b>' + nf((I.est.filas || []).length) + '</b> archivo(s) hasta ahora...') + '</div>' : '';
  const incompleto = (I && I.project === proj) ? mpIndiceIncompleto(I) : '';
  if (!proj) h += '<div class="mp-hint">Entra a un proyecto (Proyectos) y carga su modelo.</div>';
  else if (progreso && (!I || I.project !== proj || !I.filas)) h += progreso;
  else if (!I || I.project !== proj || !I.filas) {
    const leido = MP.cargaFin === proj || (I && I.project === proj);
    h += '<div class="mp-hint">' + (leido ? 'Este proyecto aun no tiene su <b>indice de documentos</b> (el de "Documentos Forma" &gt; Buscar en todo el proyecto). Se arma una vez, recorriendo sus carpetas de Forma, y queda para todos.' : 'Leyendo el indice de documentos del proyecto...') + '</div>' +
      (leido ? '<button class="sm" data-mp="indice">Leer los documentos del proyecto</button>' : '');
  } else {
    const prep = mpPreparados() || [];
    const pdfs = prep.length, planosN = prep.filter(p => p.plano).length, sinDesc = prep.filter(p => p.plano && p.sinDesc).length;
    h += progreso;
    // v1.380: un indice armado con el recorrido antiguo (se detenia en 600 carpetas) deja fuera las carpetas hondas de planos
    if (!progreso && incompleto === 'antiguo600') h += '<div class="mp-aviso">El indice de documentos de este proyecto se armo con el recorrido antiguo, que se <b>detenia en 600 carpetas</b>: faltan planos (los de las carpetas mas hondas, como 02_SHARED › 02.04_RIBA 4 › 02.04.02_AR › 02.04.02.02_DR). ' +
      '<button class="sm" data-mp="indice">Completar el indice</button> <span>Ahora lo recorre entero el servidor (unos minutos; queda para todos).</span></div>';
    if (!claves.size && !textos.length) h += '<div class="mp-hint">Elige un nivel con los botones de arriba (el modelo no se colorea ni se filtra) o en <b>Visor con filtros</b> (filtro ● Nivel). Aqui saldran sus planos, por especialidad.</div>';
    else {
      const grupos = mpAgrupa(mpDelNivel(prep, claves, textos));
      const total = grupos.reduce((t, e) => t + e.generales.length + e.sectores.length, 0);
      if (MP.esp && !grupos.some(e => e.cod === MP.esp)) MP.esp = '';
      h += '<div class="mp-tit">' + mpEsc(nombresSel.join(', ')) + ' · ' + total + ' plano(s) en ' + grupos.length + ' especialidad(es)</div>';
      if (!grupos.length) h += '<div class="mp-hint">Ningun plano de Documentos Forma dice en su descripcion este nivel.</div>';
      else {
        h += '<div class="mp-esps">' + grupos.map(e => '<button class="mp-esp' + (e.cod === MP.esp ? ' on' : '') + '" data-mpesp="' + mpEsc(e.cod) + '"' + (e.deducido ? ' title="Nombre deducido de lo que dicen las descripciones de sus planos"' : '') + '><span class="mp-cod">' + mpEsc(e.cod) + '</span><span class="mp-nom">' + mpEsc(e.nombre) + '</span>' +
          '<span class="mp-n">' + (e.generales.length + e.sectores.length) + ' plano(s): ' + e.generales.length + ' general(es), ' + e.sectores.length + ' de sectores</span></button>').join('') + '</div>';
        const e = grupos.find(x => x.cod === MP.esp);
        if (!e) h += '<div class="mp-hint">Elige una especialidad.</div>';
        else {
          // v1.380: la carpeta de la copia que se abre y, si el codigo esta en otras carpetas, cuantas (con su detalle al pasar el raton)
          const copias = (p) => (p.copias && p.copias.length) ? '<span class="mp-copias" title="' + mpEsc('Este codigo tambien esta en:\n' + p.copias.map(c => '· ' + (c.f.ruta || '?') + ' (v' + (c.f.vers || '?') + '): ' + (c.f.desc || 'sin descripcion')).join('\n') + '\nSe abre la de la etapa mas avanzada (o la mas reciente).') + '">+' + p.copias.length + ' en otras carpetas</span>' : '';
          const fila = (p) => '<button class="mp-plano' + (p.f.id === MP.abiertoId ? ' on' : '') + '" data-mpplano="' + mpEsc(p.f.id) + '" title="' + mpEsc('Abrir junto al modelo\nCarpeta: ' + (p.f.ruta || '?')) + '">' +
            '<span class="mp-pv">v' + mpEsc(p.f.vers || '?') + '</span><span class="mp-pc">' + mpEsc(String(p.f.name).replace(/\.pdf$/i, '')) + '</span>' + (p.sector ? '<span class="mp-sector">' + mpEsc(p.sector) + '</span>' : '') +
            '<span class="mp-pd">' + mpEsc(p.f.desc) + '</span>' + copias(p) + '</button>';
          h += '<div class="mp-grupo">Generales (' + e.generales.length + ')</div>' + (e.generales.map(fila).join('') || '<div class="mp-hint">Sin planos generales de este nivel.</div>') +
            '<div class="mp-grupo">Sectores (' + e.sectores.length + ')</div>' + (e.sectores.map(fila).join('') || '<div class="mp-hint">Sin planos de sectores de este nivel.</div>');
          subTxt += ' · ' + e.cod;
        }
      }
    }
    const fecha = (() => { try { return new Date(I.cuando).toLocaleDateString('es-PE'); } catch (x) { return ''; } })();
    const estado = incompleto === 'parcial' ? ' · <b>' + nf(I.noLeidas) + ' carpeta(s) no se pudieron leer</b> (Actualizar lo reintenta)'
      : incompleto === 'antiguo600' || incompleto === 'antiguo' ? ' · armado con el recorrido antiguo del navegador' + (incompleto === 'antiguo600' ? ' (se detuvo en 600 carpetas)' : '')
      : ' · todas las carpetas (' + nf(I.carpetas) + ')';
    h += '<div class="mp-pie">Planos de Documentos Forma: ' + planosN.toLocaleString('es-PE') + ' plano(s) entre ' + pdfs.toLocaleString('es-PE') + ' PDF del indice del proyecto del ' + mpEsc(fecha) + estado +
      (MP.copiasN ? ' · ' + nf(MP.copiasN) + ' copia(s) del mismo codigo en otras carpetas (se muestra la de la etapa mas avanzada)' : '') +
      (sinDesc ? ' · ' + sinDesc + ' plano(s) sin descripcion en Forma (no se pueden ubicar por nivel)' : '') + ' · <a href="#" data-mp="indice">Actualizar el indice</a></div>';
  }
  const ab = (MP.prep || []).find(p => p.f.id === MP.abiertoId);
  if (ab) subTxt += ' · ' + String(ab.f.name).replace(/\.pdf$/i, '');
  sub.textContent = subTxt;
  cuerpo.innerHTML = h;
}
function mpClic(ev) {
  const t = ev.target;
  const nivel = t.closest && t.closest('[data-mpnivel]'); if (nivel) { mpEligeNivel(nivel.getAttribute('data-mpnivel')); return; }
  const esp = t.closest && t.closest('[data-mpesp]'); if (esp) { const c = esp.getAttribute('data-mpesp'); MP.esp = MP.esp === c ? '' : c; mpPinta(); return; }
  const pl = t.closest && t.closest('[data-mpplano]'); if (pl) { mpAbre(pl.getAttribute('data-mpplano')); return; }
  const ind = t.closest && t.closest('[data-mp="indice"]');
  if (ind) {
    ev.preventDefault();
    if (typeof IDX !== 'undefined' && IDX.est) return;   // v1.380: ya se esta recorriendo (pulsar de nuevo lo detendria)
    if (typeof busRehaceIndice === 'function') { busRehaceIndice().then(() => { MP.firma = ''; mpVigila(); }); MP.firma = ''; setTimeout(mpVigila, 300); }
  }
}
/** Los planos de la especialidad elegida, en el orden de la lista (generales y luego sectores). */
function mpListaActual() {
  const prep = mpPreparados() || [], claves = new Set(), textos = [];
  for (const v of mpNivelesSeleccionados()) { const ks = mpClavesNivel(mpNivelDeValor(v)); if (ks.length) ks.forEach(k => claves.add(k)); else textos.push(mpNorm(mpNivelDeValor(v))); }
  const e = mpAgrupa(mpDelNivel(prep, claves, textos)).find(x => x.cod === MP.esp);
  return e ? e.generales.concat(e.sectores) : [];
}
function mpVecino(d) {
  const l = mpListaActual(); if (!l.length) return;
  const i = l.findIndex(p => p.f.id === MP.abiertoId);
  const j = i < 0 ? 0 : (i + d + l.length) % l.length;
  mpAbre(l[j].f.id);
}
/**
 * El plano se abre junto al modelo, con la ventana de planos de siempre (anadePlano + abrirPlano).
 * v1.384: si alguien lo pide (MP.alAbrir: el modo inmersivo, que lo muestra como su minimapa sin abrir la ventana de
 * planos), se le entrega el plano y, si lo toma (devuelve true), aqui solo se marca en la lista.
 */
async function mpAbre(id) {
  const p0 = (MP.prep || []).find(x => x.f.id === id); if (!p0) return;
  if (typeof MP.alAbrir === 'function') {
    let tomado = false;
    try { tomado = MP.alAbrir(p0) === true; } catch (e) {}
    if (tomado) { MP.abiertoId = id; mpPinta(); return; }
  }
  const f = p0.f, pl = mp$('plans'), oculto = pl ? pl.classList.contains('hidden') : true;
  try { if (typeof anadePlano === 'function') anadePlano({ id: f.id, name: f.name, desc: f.desc || '' }, f.ruta || ''); } catch (e) {}
  if (oculto && pl) pl.classList.add('hidden');   // la lista de planos de siempre no hace falta: esta es la lista
  MP.abiertoId = id; mpPinta();
  const p = (typeof planos !== 'undefined' ? planos : []).find(x => x.item === f.id);
  if (p && typeof abrirPlano === 'function') { try { await abrirPlano(p); } catch (e) {} }
}

if (typeof window !== 'undefined') window.__modelosPlanos = { mpClavesNivel, mpNivelDeValor, mpNombreNivel, mpPeso, mpCodigo, mpEspecialidad, mpEsPlano, mpSector, mpPrepara, mpDelNivel, mpAgrupa, mpTokens, mpAlterna, mpPinta, mpEligeNivel, mpNivelesDelModelo, mpNivelesSeleccionados, mpNivelesDelFiltro, mpUnicos, mpEtapa, mpNombrePorDescripciones, mpIndiceIncompleto, MP };
if (typeof module !== 'undefined' && module.exports) module.exports = { mpClavesNivel, mpNivelDeValor, mpNombreNivel, mpPeso, mpCodigo, mpEspecialidad, mpEsPlano, mpSector, mpPrepara, mpDelNivel, mpAgrupa, mpTokens, mpUnicos, mpEtapa, mpNombrePorDescripciones, mpIndiceIncompleto };
