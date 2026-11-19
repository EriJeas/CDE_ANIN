/* PUENTE DEL VISUALIZADOR DE ARCHIVOS (ver.html).
 * El codigo del Visor BIM Federado (js/visor-origen/cronograma.js, gis.js, buscador.js) se carga TAL CUAL. En el visor, app.js le daba
 * `$`, `esc`, `busy`, el visor 3D y el indice del modelo; aqui no hay modelo: este archivo le da lo mismo (sin 3D) y decide que ventana
 * del visor abre cada archivo del CDE:
 *   Excel (.xlsx .xlsm .xls .csv .ods)  -> abreHoja()            (Hoja de calculo, con pestañas, imagenes y «Ver como Gantt»)
 *   Project (.xml .mpx) / Primavera (.xer .xml) -> leeXml / leeMpx / leeXer + pintaCronograma()   (Gantt, vinculos, ruta critica)
 *   Word (.docx), PowerPoint (.pptx), texto     -> fichaZip / fichaTextoPptx / fichaDecodifica + ver-doc.js
 *   GIS (.shp .kml .kmz .gpx .geojson .gpkg .zip con shapefile) -> leeShp / leeDbf / leeKml / ... + ver-gis.js (mapa)
 * Nada de esto vuelve a implementar un lector: solo se enchufa. */
'use strict';
/* ---- lo que app.js daba ---- */
const FANTASMAS = new Map();
/** Como el `$` del visor; si el elemento no existe en esta pagina (controles del 3D), devuelve uno suelto para que el codigo original no se caiga. */
const $ = (id) => document.getElementById(id) || (FANTASMAS.has(id) ? FANTASMAS.get(id) : (FANTASMAS.set(id, Object.assign(document.createElement('div'), { id: 'fantasma-' + id, value: '' })), FANTASMAS.get(id)));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escAttr = s => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
const recorta = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const sinTildes = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function busy(on, text) { const b = document.getElementById('busy'); if (!b) return; b.classList.toggle('hidden', !on); document.getElementById('busyText').textContent = text || ''; }
/* sin modelo: el enlace 4D y el dibujo sobre el 3D no aplican aqui (eso es del Visor 3D) */
const models = [], props = { total: 0, params: [], byParam: new Map() }, filters = [], session = {};
const viewer = new Proxy({}, { get: () => () => null });
let utmZona = 17, utmSur = true;
const uScale = () => 1;
function hazVentana() {} function toast(m) { verAvisa(m); }
let navMod = { tipo: 'planos' }, nav = { project: '' }, planos = [], gisFiles = [], cronoFiles = [];
let sqlJsListo = null;
function cargaSqlJs() { if (sqlJsListo) return sqlJsListo; sqlJsListo = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/sql-wasm.js'; sc.onload = () => { initSqlJs({ locateFile: (f) => 'vendor/' + f }).then(res).catch(rej); }; sc.onerror = () => rej(new Error('no se pudo cargar vendor/sql-wasm.js')); document.head.appendChild(sc); }); return sqlJsListo; }

/* ---- la pagina ---- */
const VER = { pid: '', cid: '', vid: '', cont: null, version: null, buf: null };
function verAvisa(html, mal) { const a = document.getElementById('verAviso'); a.className = mal ? 'mal' : ''; a.innerHTML = html; a.classList.remove('hidden'); }
const verExt = (n) => (String(n || '').split('.').pop() || '').toLowerCase();
const verTexto = (buf) => fichaDecodifica(new Uint8Array(buf));
function verMuestra(id) { for (const w of ['crWin', 'xlWin', 'docWin', 'mapWin']) document.getElementById(w).classList.toggle('hidden', w !== id); }
async function verBaja(vid) { const r = await fetch('/api/proyectos/' + VER.pid + '/versiones/' + vid + '/descargar'); if (r.status === 401) throw new Error('Inicia sesión en el CDE y vuelve a abrir el archivo.'); if (!r.ok) throw new Error('No se pudo bajar el archivo (' + r.status + ').'); return r.arrayBuffer(); }

async function verArranca() {
  const q = new URLSearchParams(location.search); VER.pid = q.get('pid') || ''; VER.cid = q.get('cid') || ''; VER.vid = q.get('vid') || '';
  try {
    const r = await fetch('/api/proyectos/' + VER.pid + '/contenedores/' + VER.cid); if (r.status === 401) throw new Error('Inicia sesión en el CDE y vuelve a abrir el archivo.'); if (!r.ok) throw new Error('No se encontró el archivo (' + r.status + ').');
    VER.cont = await r.json();
    const vs = (VER.cont.versiones || []).slice().sort((a, b) => b.n - a.n); VER.version = vs.find(v => v.id === VER.vid) || vs[0]; if (!VER.version) throw new Error('El archivo no tiene versiones.');
    // Un shapefile son varios archivos con el mismo nombre (en el CDE, versiones del mismo contenedor): si se abre un acompañante (.dbf, .prj, .cpg, .shx) y existe el .shp, se abre la capa
    if (!q.get('tal') && /^(dbf|prj|cpg|shx)$/.test(verExt(VER.version.archivo))) { const shp = vs.find(v => verExt(v.archivo) === 'shp'); if (shp) VER.version = shp; }
    VER.vid = VER.version.id;
    const sel = document.getElementById('verVersion'); sel.innerHTML = vs.map(v => '<option value="' + esc(v.id) + '"' + (v.id === VER.vid ? ' selected' : '') + '>V' + v.n + ' | ' + esc(v.revision || '—') + (verExt(v.archivo) !== verExt(VER.version.archivo) ? ' · .' + esc(verExt(v.archivo)) : '') + '</option>').join('');
    sel.onchange = () => { const u = new URL(location.href); u.searchParams.set('vid', sel.value); u.searchParams.set('tal', '1'); location.href = u.toString(); };
    document.getElementById('verNombre').textContent = VER.version.archivo; document.title = VER.version.archivo + ' · CDE ANIN';
    const bj = document.getElementById('verBajar'); bj.href = '/api/proyectos/' + VER.pid + '/versiones/' + VER.vid + '/descargar'; bj.setAttribute('download', VER.version.archivo);
    await verAbre();
  } catch (e) { busy(false); verAvisa(esc(e.message), true); }
}

/** Cada formato a su ventana, con los lectores del visor. */
async function verAbre() {
  const v = VER.version, nombre = v.archivo, ext = verExt(nombre), carpeta = VER.cont.carpeta || '';
  const info = (t) => { document.getElementById('verInfo').textContent = t; };
  if (ext === 'mpp') return verAvisa('<b>No se puede leer el .mpp</b>: es un formato binario cerrado de Microsoft. En Project: Archivo › Guardar como › <b>XML de Project (*.xml)</b>, y carga ese XML al CDE: se abrirá aquí como Gantt. Mientras tanto puedes descargarlo.', true);
  if (/^(doc|ppt)$/.test(ext)) return verAvisa('Formato antiguo de Office (.' + ext + '): guárdalo como .' + ext + 'x y se podrá ver aquí. Mientras tanto puedes descargarlo.', true);
  busy(true, 'Abriendo ' + nombre + '...');
  const buf = VER.buf = await verBaja(v.id);
  try {
    if (/^(xlsx|xlsm|xlsb|xls|csv|ods)$/.test(ext)) {
      await abreHoja(buf, nombre, carpeta, true); verMuestra('xlWin'); info('Hoja de cálculo');
      document.getElementById('xlBaja').onclick = () => document.getElementById('verBajar').click();
      document.getElementById('xlGantt').addEventListener('click', () => { verMuestra('crWin'); document.getElementById('crHoja').onclick = () => verMuestra('xlWin'); });
    } else if (/^(xer|mpx)$/.test(ext) || (ext === 'xml' && /<Project[\s>]|<APIBusinessObjects|<Tasks>/.test(verTexto(buf).slice(0, 4000)))) {
      const txt = verTexto(buf), t = ext === 'xer' ? leeXer(txt) : ext === 'mpx' ? leeMpx(txt) : leeXml(txt);
      if (!t.length) throw new Error('no se encontraron actividades en el cronograma');
      CR.tareas = t; CR.nombre = nombre; CR.hoy = null; verMuestra('crWin'); pintaCronograma(); try { pintaParamsCr(); } catch (e) {}
      info(ext === 'xer' ? 'Cronograma de Primavera P6' : ext === 'mpx' ? 'Cronograma de Project (MPX)' : 'Cronograma (XML de Project / Primavera)');
    } else if (ext === 'docx') { verMuestra('docWin'); await docAbreWord(buf, nombre); info('Documento de Word'); }
    else if (ext === 'pptx') { verMuestra('docWin'); docAbrePartes(fichaTextoPptx(buf), nombre, 'diapositiva'); info('Presentación de PowerPoint'); }
    else if (/^(txt|md|json|xml|html|htm|log|prj|cpg)$/.test(ext)) { verMuestra('docWin'); docAbreTexto(verTexto(buf), nombre); info('Texto'); }
    else if (/^(shp|kml|kmz|gpx|geojson|gpkg|sqlite|zip|dbf)$/.test(ext)) { verMuestra('mapWin'); await gisAbreArchivo(buf, nombre, ext); info('Capa GIS'); }
    else verAvisa('Este formato (.' + esc(ext || 'sin extensión') + ') todavía no tiene visualizador en el CDE. Puedes descargarlo.', true);
  } catch (e) { verAvisa('No se pudo abrir <b>' + esc(nombre) + '</b>: ' + esc(e.message), true); }
  busy(false);
}
