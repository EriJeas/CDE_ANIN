/*
 * BUSCADOR DE ARCHIVOS DEL PROYECTO (v1.213).
 *
 * Hasta aqui, para abrir un documento habia que SABERSE la ruta de Forma y
 * bajar carpeta por carpeta. Autodesk Forma tiene su panel de busqueda; este
 * hace lo mismo dentro del visor: busca en TODO el proyecto (o desde la
 * carpeta donde estes) por nombre, formato, version y fecha de ultima
 * actualizacion, y cada resultado dice LA CARPETA de la que viene, que es lo
 * que permite ubicarlo luego en Forma.
 *
 * Reutiliza lo que ya existe: el mismo recorrido de carpetas del listado de
 * entregables (leContenidos) y las mismas ventanas de siempre para abrir lo
 * encontrado (Planos para el PDF, el visor de medios para foto y video).
 */

const BUS = { filas: [], corriendo: false, cancelar: false, raiz: '' };

/** Normaliza para comparar: sin mayusculas y sin tildes. Pura. */
const busNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** El grupo de formato al que pertenece una extension. Pura. */
function busFormato(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return 'pdf';
  if (/^(jpe?g|png|gif|webp|bmp|tif|tiff)$/.test(e)) return 'imagen';
  if (/^(mp4|webm|mov|m4v|avi|wmv|mkv|mpg|mpeg|flv|3gp|ogv|mts|m2ts)$/.test(e)) return 'video';
  if (/^(rvt|nwd|nwc|nwf|ifc|dwg|dxf|dgn|fbx|skp|obj|3dm|iwm)$/.test(e)) return 'modelo';
  if (/^(xls[xm]?|csv)$/.test(e)) return 'hoja';
  if (/^(docx?|txt|md)$/.test(e)) return 'texto';
  if (/^(pptx?)$/.test(e)) return 'presentacion';
  if (/^(shp|dbf|shx|prj|cpg|idx|kml|kmz|geojson|gpx)$/.test(e)) return 'gis';
  if (/^(xer|xml|mpp)$/.test(e)) return 'cronograma';
  return 'otro';
}

/** Decide si una fila pasa los filtros pedidos. Pura. */
function busPasa(f, c) {
  if (c.texto) {
    const t = busNorm(f.name) + ' ' + busNorm(f.desc) + ' ' + busNorm(f.ruta);
    for (const palabra of c.texto.split(/\s+/).filter(Boolean))
      if (!t.includes(palabra)) return false;
  }
  if (c.formato && busFormato(f.ext) !== c.formato) return false;
  if (c.version && Number(f.vers || 0) < Number(c.version)) return false;
  if (c.desde && (!f.mod || new Date(f.mod) < new Date(c.desde))) return false;
  if (c.hasta && (!f.mod || new Date(f.mod) > new Date(c.hasta + 'T23:59:59'))) return false;
  return true;
}

/** Recorre las carpetas y va soltando lo que encuentra. */
async function busRecorre(desdeId, desdeRuta, criterios, avisa, estado) {
  // v1.216: el ESTADO puede ser otro. El buscador de "Elegir modelo" busca sin
  // pisar la lista de Documentos Forma, cuyos "Abrir" van por indice. Sin el, BUS.
  const E = estado || BUS;
  const cola = [{ id: desdeId || null, ruta: desdeRuta || '/' }];
  let carpetas = 0, archivos = 0;
  E.filas = [];
  while (cola.length && !E.cancelar) {
    if (carpetas++ > 600) { avisa('Me detengo en 600 carpetas: acota la busqueda.', true); break; }
    const c = cola.shift();
    avisa('Buscando en ' + c.ruta + '  (' + E.filas.length + ' encontrados, ' +
          cola.length + ' carpetas por mirar)...');
    let items = [];
    try { items = await leContenidos(c.id); } catch (e) { continue; }
    for (const it of items) {
      if (it.type === 'folder') {
        cola.push({ id: it.id, ruta: c.ruta === '/' ? it.name : c.ruta + ' / ' + it.name });
        continue;
      }
      archivos++;
      const fila = { id: it.id, name: it.name, desc: it.desc || '', ext: it.ext || '',
                     mod: it.mod || '', modPor: it.modPor || '', vers: it.vers || 0,
                     ruta: c.ruta };
      fila.carpetaId = c.id;             // v1.216: su carpeta (los hermanos de un .shp)
      if (busPasa(fila, criterios)) E.filas.push(fila);
    }
  }
  return { carpetas, archivos };
}

function busCriterios(pre) {
  // v1.216: el prefijo de los campos; sin el, los de Documentos Forma (bus...).
  const p = (typeof pre === 'string' && pre) ? pre : 'bus';
  const v = (id) => ($(p + id) ? $(p + id).value : '');
  return {
    texto: busNorm(v('Q').trim()),
    formato: v('Formato'),
    version: v('Version'),
    desde: v('Desde'),
    hasta: v('Hasta'),
  };
}

function busPinta() {
  const z = $('busLista');
  if (!z) return;
  const fecha = (t) => { try { return new Date(t).toLocaleString('es-PE'); } catch (e) { return ''; } };
  if (!BUS.filas.length) {
    z.innerHTML = '<div class="hint">Sin resultados con esos criterios.</div>';
    return;
  }
  z.innerHTML = BUS.filas.slice(0, 500).map((f, i) => {
    const a = busAccion(f);   // v1.219: el boton dice lo que hara en ESTA ventana
    return '<div class="nitem' + (a.puesto ? ' puesto' : '') + '"><i>' + a.icono +
    '</i><div class="ncuerpo">' +
    '<div class="nn">' + esc(f.name) + '</div>' +
    (f.desc ? '<div class="nd">' + esc(f.desc) + '</div>' : '') +
    '<div class="nd">Carpeta: ' + esc(f.ruta) + '</div>' +
    '<div class="nd">' + esc(busFormato(f.ext)) + ' \u00b7 v' + (f.vers || '?') +
    ' \u00b7 ' + fecha(f.mod) + (f.modPor ? ' \u00b7 ' + esc(f.modPor) : '') + '</div>' +
    '<button class="sm" data-busabrir="' + i + '"' + (a.puesto ? ' disabled' : '') + '>' +
    esc(a.etiqueta) + '</button>' +
    '<button class="sm" data-busficha="' + i + '" title="Lo que Forma sabe de este archivo, sin abrirlo">Ficha</button>' +
    '</div></div>'; }).join('') +
    (BUS.filas.length > 500
      ? '<div class="hint">Se muestran 500 de ' + BUS.filas.length + ': afina la busqueda.</div>'
      : '');
  z.querySelectorAll('[data-busabrir]').forEach(b => b.onclick = () =>
    busAbre(BUS.filas[parseInt(b.getAttribute('data-busabrir'), 10)]));
  z.querySelectorAll('[data-busficha]').forEach(b => b.onclick = () =>
    busFicha(BUS.filas[parseInt(b.getAttribute('data-busficha'), 10)]));
}

/*
 * v1.219 — EL BUSCADOR ABRE COMO ABRE LA VENTANA EN LA QUE ESTA.
 *
 * El buscador vive DENTRO del navegador de carpetas, que es el mismo para
 * Documentos Forma, Archivos GIS y Cronograma. Desde la v1.213 sus resultados
 * se abrian siempre como documento, asi que estando en Cronograma un .xer
 * respondia "los cronogramas se abren desde Cronograma". Ahora el resultado
 * hace lo MISMO que haria ese archivo en la lista de la ventana abierta
 * (anadeCrono, anadeGis, medAbre o anadePlano): una sola decision, la de
 * pintaNavegador, no dos.
 */
function busAccion(f) {
  const tipo = (typeof navMod !== 'undefined' && navMod.tipo) || 'planos';
  const t = (typeof TIPOS_NAV !== 'undefined' && TIPOS_NAV[tipo]) || null;
  const ext = String((f && f.ext) || '').toLowerCase();
  const suyo = !!t && t.exts.indexOf(ext) >= 0;
  const yaEsta = {
    planos: (typeof planos !== 'undefined' ? planos : []),
    gis: (typeof gisFiles !== 'undefined' ? gisFiles : []),
    crono: (typeof cronoFiles !== 'undefined' ? cronoFiles : []),
  }[tipo] || [];
  const medio = (typeof esMedio === 'function') && esMedio((f && f.name) || '');
  const mpp = tipo === 'crono' && ext === 'mpp';
  const puesto = !!f && yaEsta.some(x => x.item === f.id);
  const etiqueta = puesto ? 'Ya esta en la ventana'
    : mpp ? 'No se puede leer el .mpp'
    : (tipo === 'planos' && medio) ? 'Ver'
    : (suyo && t && t.boton) ? t.boton
    : 'Abrir';
  return { tipo, suyo, puesto, mpp, medio, etiqueta, icono: (suyo && t) ? t.icono : '&#128196;' };
}

/** Cada cosa a su ventana, con las funciones de siempre. */
function busAbre(f) {
  if (!f) return;
  const a = busAccion(f);
  if (a.puesto) return;
  // El .mpp es binario cerrado: se explica igual que en la lista de la ventana.
  if (a.mpp) {
    return alert('No se puede leer el .mpp. En Project: Archivo \u203a Guardar como \u203a ' +
                 'XML de Project (*.xml), y sube ese XML.');
  }
  if (a.suyo && a.tipo === 'crono' && typeof anadeCrono === 'function') {
    anadeCrono(f, f.ruta); return busTrasAbrir();
  }
  if (a.suyo && a.tipo === 'gis' && typeof anadeGis === 'function') {
    anadeGis(f, f.ruta); return busTrasAbrir();
  }
  if (!f) return;
  if (typeof esMedio === 'function' && esMedio(f.name))
    return medAbre({ id: f.id, name: f.name, type: 'file' }, nav.project,
                   BUS.filas.map(x => ({ id: x.id, name: x.name, type: 'file' })));
  if (/\.pdf$/i.test(f.name)) {
    if (typeof anadePlano === 'function') anadePlano(f, f.ruta);
    return busTrasAbrir();
  }
  alert('"' + f.name + '" es un archivo de tipo ' + busFormato(f.ext) + '.\n\n' +
        'Desde aqui se abren PDF, imagenes y video. Los modelos se federan desde ' +
        '"Elegir modelo", las capas desde "Archivos GIS" y los cronogramas desde ' +
        '"Cronograma".\n\nCarpeta: ' + f.ruta);
}

/** Tras abrir: la lista de la ventana y la del buscador reflejan lo cargado. */
function busTrasAbrir() {
  try { if (typeof pintaNavegador === 'function') pintaNavegador(); } catch (e) {}
  try { busPinta(); } catch (e) {}
}

/* ----------------------------------------------------------------------------
 * v1.220 — EL INDICE DEL PROYECTO Y LA FICHA (metadatos sin abrir nada)
 *
 * Recorrer 600 carpetas para cada busqueda es caro y se repetia en cada equipo.
 * "Rehacer indice" lo recorre UNA vez, con el mismo busRecorre de siempre, y lo
 * guarda en el servidor: desde entonces buscar es instantaneo para todos, con
 * los mismos filtros (busPasa). "Ficha" pregunta a Forma por ese archivo y por
 * los atributos personalizados de su carpeta, sin descargarlo ni abrirlo.
 */
const IDX = { filas: null, cuando: 0, carpetas: 0, project: '', est: null };
// v1.221: lo que dicen los documentos ya leidos (para buscar por contenido).
const CONTENIDO = { project: '', fichas: {} };

const busFechaCorta = (t) => {
  try { return new Date(t).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
};

function busIndicePinta() {
  const z = $('busIndiceInfo');
  if (!z) return;
  z.textContent = (IDX.filas && IDX.project === nav.project)
    ? 'Indice del ' + busFechaCorta(IDX.cuando) + ': ' + IDX.filas.length + ' archivo(s) de ' +
      IDX.carpetas + ' carpeta(s). Las busquedas salen al instante.'
    : 'Sin indice guardado: cada busqueda recorre las carpetas. Pulsa "Rehacer indice" una vez.';
}

async function busIndiceCarga() {
  if (!nav.project) return;
  if (CONTENIDO.project !== nav.project) {   // v1.221: las fichas ya leidas del proyecto
    try {
      const cm = await api('/api/contenido/' + encodeURIComponent(nav.project));
      CONTENIDO.project = nav.project; CONTENIDO.fichas = (cm && cm.fichas) || {};
    } catch (e) {}
  }
  if (IDX.filas && IDX.project === nav.project) return busIndicePinta();
  try {
    const d = await api('/api/indice/' + encodeURIComponent(nav.project));
    if (d && d.hay) {
      IDX.filas = d.filas || []; IDX.cuando = d.cuando; IDX.carpetas = d.carpetas || 0;
      IDX.project = nav.project;
      // v1.380: como se armo (el servidor recorre TODO; el recorrido antiguo del navegador se detenia en 600 carpetas)
      IDX.motor = d.motor || ''; IDX.completo = d.completo === true; IDX.noLeidas = d.noLeidas || 0;
    } else { IDX.filas = null; IDX.project = nav.project; }
  } catch (e) { IDX.filas = null; }
  busIndicePinta();
}

/*
 * v1.380 — EL INDICE LO RECORRE EL SERVIDOR, ENTERO. El recorrido de abajo (busRehaceIndiceNavegador, el de siempre)
 * leia carpeta a carpeta desde el navegador, se detenia en 600 carpetas y saltaba en silencio las que fallaban: en un
 * proyecto ISO 19650 las carpetas de planos (02_SHARED/02.04_RIBA 4/02.04.02_AR/02.04.02.02_DR) quedaban fuera, y
 * "Modelos / Planos" reconocia 2 planos del primer nivel donde Documentos mostraba decenas. Ahora el servidor lo recorre
 * con el motor del censo de Documentacion en Forma (sin techo de 600, con reintentos) y aqui solo se sigue su avance.
 * Si el servidor no lo ofrece (version anterior), se usa el recorrido de siempre.
 */
async function busRehaceIndice() {
  if (!nav.project) return alert('Entra primero a un proyecto (Proyectos).');
  if (IDX.est) {
    IDX.est.cancelar = true;
    if (IDX.est.trabajo) { try { await api('/api/indice-trabajo/' + encodeURIComponent(IDX.est.trabajo) + '/detener', { method: 'POST' }); } catch (e) {} }
    return;
  }
  let trabajo = '';
  try {
    const r = await api('/api/indice/' + encodeURIComponent(nav.project) + '/rehacer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub: nav.hub }) });
    trabajo = (r && r.trabajo) || '';
  } catch (e) { trabajo = ''; }
  if (!trabajo) return busRehaceIndiceNavegador();
  const z = $('busEstado'), b = $('busIndice');
  const avisa = (t) => { if (z) z.textContent = t; };
  const proyecto = nav.project;
  const est = { filas: [], cancelar: false, trabajo, servidor: true, archivos: 0, carpetas: 0, pendientes: 0, noLeidas: 0 };
  IDX.est = est;
  if (b) b.textContent = 'Detener';
  let fin = null, fallosSeguidos = 0;
  while (!fin) {
    await new Promise(r => setTimeout(r, 1500));
    let s = null;
    try { s = await api('/api/indice-trabajo/' + encodeURIComponent(trabajo)); fallosSeguidos = 0; }
    catch (e) {
      if (e && e.status === 404) { fin = { estado: 'perdido' }; break; }   // el servidor se reinicio a mitad
      if (++fallosSeguidos >= 8) { fin = { estado: 'error', error: (e && e.message) || String(e) }; break; }
      continue;
    }
    Object.assign(est, { archivos: s.archivos || 0, carpetas: s.carpetas || 0, pendientes: s.pendientes || 0, noLeidas: s.noLeidas || 0 });
    avisa('El servidor recorre las carpetas de Forma: ' + est.carpetas.toLocaleString('es-PE') + ' carpeta(s), ' +
          est.archivos.toLocaleString('es-PE') + ' archivo(s)' + (est.pendientes ? ', ' + est.pendientes.toLocaleString('es-PE') + ' carpeta(s) por leer' : '') +
          '... (sigue aunque cierres el visor)');
    if (s.estado === 'listo' || s.estado === 'error') fin = s;
  }
  if (fin.estado === 'listo' && nav.project === proyecto) {
    IDX.filas = null; IDX.project = '';
    try { await busIndiceCarga(); } catch (e) {}
    avisa('Indice guardado: ' + (fin.archivos || 0).toLocaleString('es-PE') + ' archivo(s) de ' + (fin.carpetas || 0).toLocaleString('es-PE') + ' carpeta(s)' +
          (fin.detenido ? ' (se detuvo antes de terminar)' : fin.completo ? ', todas las carpetas del proyecto.' : ' (' + (fin.noLeidas || 0) + ' carpeta(s) no se pudieron leer).'));
  } else if (fin.estado === 'perdido') avisa('El servidor se reinicio y el recorrido se perdio: vuelve a pulsar "Rehacer indice".');
  else if (fin.estado !== 'listo') avisa('No se pudo armar el indice: ' + (fin.error || 'error'));
  IDX.est = null;
  if (b) b.textContent = 'Rehacer indice';
  busIndicePinta();
}

/** El recorrido de siempre, desde el navegador (respaldo si el servidor no ofrece el suyo). */
async function busRehaceIndiceNavegador() {
  if (!nav.project) return alert('Entra primero a un proyecto (Proyectos).');
  if (IDX.est) { IDX.est.cancelar = true; return; }
  const z = $('busEstado'), b = $('busIndice');
  const avisa = (t) => { if (z) z.textContent = t; };
  const est = { filas: [], cancelar: false };
  IDX.est = est;
  if (b) b.textContent = 'Detener';
  try {
    // Sin criterios: entra TODO lo que hay, que es justo lo que es un indice.
    const r = await busRecorre(null, '/', { texto: '', formato: '', version: '', desde: '', hasta: '' },
                               avisa, est);
    IDX.filas = est.filas; IDX.carpetas = r.carpetas; IDX.cuando = Date.now(); IDX.project = nav.project;
    await api('/api/indice/' + encodeURIComponent(nav.project), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carpetas: r.carpetas, filas: est.filas }),
    });
    avisa('Indice guardado: ' + est.filas.length + ' archivo(s) de ' + r.carpetas + ' carpeta(s)' +
          (est.cancelar ? ' (se detuvo antes de terminar)' : '') + '.');
  } catch (e) { avisa('No se pudo guardar el indice: ' + ((e && e.message) || e)); }
  IDX.est = null;
  if (b) b.textContent = 'Rehacer indice';
  busIndicePinta();
}

/** La ficha de un archivo: lo que Forma sabe de el, sin abrirlo. */
async function busFicha(f) {
  if (!f) return;
  const capa = document.createElement('div');
  capa.id = 'fichaCapa';
  const fila = (k, v) => v ? '<div class="ffila"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>' : '';
  capa.innerHTML = '<div id="fichaCaja"><div class="pbar ptitle"><span>Ficha del documento</span>' +
    '<span id="fichaX" title="Cerrar">&times;</span></div><div id="fichaCuerpo">' +
    '<div class="fnom">' + esc(f.name) + '</div>' +
    fila('Carpeta', f.ruta) + fila('Descripcion en Forma', f.desc) +
    fila('Version', f.vers ? 'v' + f.vers : '') +
    fila('Actualizado', f.mod ? busFechaCorta(f.mod) : '') + fila('Por', f.modPor) +
    '<div class="hint">Consultando Forma...</div></div></div>';
  document.body.appendChild(capa);
  if ($('fichaX')) $('fichaX').onclick = () => capa.remove();
  let d = {};
  try { d = await api('/api/ficha/' + encodeURIComponent(nav.project) + '/' + encodeURIComponent(f.id)); }
  catch (e) { d = { nota: 'No se pudo consultar: ' + ((e && e.message) || e) }; }
  const attrs = (d.atributos || []).map(a => fila(a.nombre, a.valor)).join('');
  const cuerpo = $('fichaCuerpo');
  if (cuerpo) cuerpo.innerHTML =
    '<div class="fnom">' + esc(f.name) + '</div>' +
    fila('Carpeta', f.ruta) + fila('Descripcion en Forma', f.desc || d.nombre) +
    fila('Version', f.vers ? 'v' + f.vers : '') +
    fila('Actualizado', d.actualizado ? busFechaCorta(d.actualizado) : (f.mod ? busFechaCorta(f.mod) : '')) +
    fila('Por', d.por || f.modPor) + fila('Creado', d.creado ? busFechaCorta(d.creado) : '') +
    (attrs ? '<div class="fsec">Atributos de la carpeta en Forma</div>' + attrs : '') +
    (d.nota ? '<div class="hint">' + esc(d.nota) + '</div>' : '') +
    '<div class="fsec">Contenido del documento</div><div id="fichaCont" class="fcont"></div>';
  // v1.221: y lo que el documento DICE, sin abrirlo.
  fichaContenido(f, d.version || '', $('fichaCont'));
}

/*
 * v1.221 — EL CONTENIDO, SIN ABRIR EL DOCUMENTO. La primera vez que alguien pide
 * la ficha, el visor baja el archivo por la puerta de siempre (/api/archivo),
 * saca su texto con el lector de "Informacion de documento" (idTextoPdf o
 * idTextoExcel) y lo resume con su modo "ficha". El resultado se guarda en el
 * servidor por version: los demas lo ven al instante y el buscador ya lo
 * encuentra por lo que dice. Si el documento cambia de version, se relee.
 */
/**
 * v1.222 — LO JUSTO PARA LA FICHA. Para saber de que trata un documento no hace
 * falta mandarlo entero: las primeras paginas (caratula, indice, introduccion)
 * hasta un tope, y las dos ultimas (conclusiones, firmas), con su NUMERO REAL.
 * Asi una ficha cuesta centimos con Claude y cabe en la capa gratuita. Pura.
 */
function fichaSeleccion(paginas, tope) {
  const T = tope || 50000;
  const out = [];
  let largo = 0;
  for (const p of paginas || []) {
    const n = String(p.texto || '').length;
    if (out.length && largo + n > T) break;
    out.push(p); largo += n;
  }
  for (const p of (paginas || []).slice(-2)) if (out.indexOf(p) < 0) out.push(p);
  return out;
}

/* ----------------------------------------------------------------------------
 * v1.223 — LA FICHA LEE (CASI) TODO. Un lector por formato, reutilizando lo que
 * el visor ya tiene: PDF con idTextoPdf, Excel con idTextoExcel, y Word y
 * PowerPoint abriendo su ZIP con el lector que YA trae SheetJS (XLSX.CFB): sin
 * librerias nuevas. El cronograma de Primavera (.xer) es texto por tablas; se
 * lee tabla por tabla. Lo que no trae texto se dice, sin bajar nada.
 */
function fichaDecodifica(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let t = new TextDecoder('utf-8').decode(u8);
  // Un solo caracter invalido basta: un UTF-8 de verdad no produce ninguno, y los
  // .xer de Primavera suelen venir en Windows-1252 ("senalizacion" salia roto).
  if (t.indexOf('\uFFFD') >= 0) t = new TextDecoder('windows-1252').decode(u8);
  return t;
}
function fichaXmlTexto(x, parrafo) {
  return String(x || '').replace(new RegExp('</' + parrafo + '>', 'g'), '\n').replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Parte un texto largo en trozos con rotulo ("parte 1", "parte 2"...). Pura. */
function fichaTrozos(texto, rot, largo) {
  const L = largo || 3500, out = [];
  for (let i = 0; i < texto.length; i += L) out.push({ rotulo: rot + ' ' + (out.length + 1), texto: texto.slice(i, i + L) });
  return out;
}
function fichaZip(buf) {
  if (typeof XLSX === 'undefined' || !XLSX.CFB) throw new Error('el lector de ZIP no cargo; recarga la pagina');
  const z = XLSX.CFB.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array' });
  const archivos = [];
  z.FullPaths.forEach((p, i) => {
    const e = z.FileIndex[i];
    if (e && e.content && e.content.length) archivos.push({ ruta: p.replace(/^[^/]*\//, ''), datos: e.content });
  });
  return archivos;
}
/** Word (.docx): el cuerpo del documento, por partes. */
function fichaTextoDocx(buf) {
  const doc = fichaZip(buf).find(a => a.ruta === 'word/document.xml');
  if (!doc) throw new Error('no parece un .docx valido');
  return fichaTrozos(fichaXmlTexto(fichaDecodifica(doc.datos), 'w:p'), 'parte');
}
/** PowerPoint (.pptx): una "hoja" por diapositiva, en su orden. */
function fichaTextoPptx(buf) {
  const num = (r) => +((/slide(\d+)\.xml$/.exec(r) || [0, 0])[1]);
  return fichaZip(buf).filter(a => /^ppt\/slides\/slide\d+\.xml$/.test(a.ruta))
    .sort((a, b) => num(a.ruta) - num(b.ruta))
    .map(a => ({ rotulo: 'diapositiva ' + num(a.ruta), texto: fichaXmlTexto(fichaDecodifica(a.datos), 'a:p') }));
}
/** Primavera (.xer): una "hoja" por tabla (%T PROJECT, TASK, PROJWBS...). */
function fichaTextoXer(buf) {
  const out = [];
  let actual = null;
  for (const l of fichaDecodifica(buf).split(/\r?\n/)) {
    if (l.startsWith('%T\t')) { actual = { rotulo: l.slice(3).trim(), texto: '' }; out.push(actual); continue; }
    if (actual && actual.texto.length < 30000) actual.texto += l + '\n';
  }
  return out.length ? out : fichaTrozos(fichaDecodifica(buf), 'parte');
}
/** El lector que corresponde a cada formato, o la nota de por que no hay. Pura. */
function fichaLector(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return { tipo: 'pdf', unidad: 'pagina', rotulo: 'pagina(s)', leer: (b, avisa) => idTextoPdf(b, avisa) };
  if (/^(xlsx|xlsm|xls|csv|ods)$/.test(e)) return { tipo: 'excel', unidad: 'hoja', rotulo: 'hoja(s)', leer: (b) => idTextoExcel(b) };
  if (e === 'docx') return { tipo: 'word', unidad: 'pagina', rotulo: 'parte(s)', leer: (b) => fichaTextoDocx(b) };
  if (e === 'pptx') return { tipo: 'pptx', unidad: 'hoja', rotulo: 'diapositiva(s)', leer: (b) => fichaTextoPptx(b) };
  if (e === 'xer') return { tipo: 'xer', unidad: 'hoja', rotulo: 'tabla(s) del cronograma', leer: (b) => fichaTextoXer(b) };
  if (/^(txt|md|json|xml|html|htm|log)$/.test(e))
    return { tipo: 'texto', unidad: 'pagina', rotulo: 'parte(s)', leer: (b) => fichaTrozos(fichaDecodifica(b), 'parte') };
  if (/^(doc|ppt)$/.test(e)) return { nota: 'Formato antiguo de Office (.' + e + '): guardalo como .' + e + 'x y la ficha lo lee.' };
  if (e === 'mpp') return { nota: 'El .mpp es binario cerrado de Microsoft. En Project: Archivo > Guardar como > XML (*.xml), sube ese XML y la ficha lo lee.' };
  if (/^(jpe?g|png|gif|webp|bmp|tiff?|heic)$/.test(e)) return { nota: 'Es una imagen: no trae texto que leer. Se ve con "Ver" o "Abrir".' };
  if (/^(mp4|webm|mov|m4v|avi|wmv|mkv|mpg|mpeg|flv|3gp|ogv|mts|m2ts|mp3|wav|m4a)$/.test(e))
    return { nota: 'Es un video o un audio: no trae texto que leer. Se abre con "Ver".' };
  if (/^(rvt|rfa|nwd|nwc|nwf|ifc|dwg|dxf|dgn|fbx|skp|3dm|rcp|rcs|obj|stp|step|sat|iam|ipt)$/.test(e))
    return { nota: 'Es un modelo o un plano CAD: su contenido se analiza al cargarlo en el visor ("Elegir modelo"). Arriba van sus datos de Forma.' };
  return { nota: 'Este formato (.' + (e || 'sin extension') + ') no tiene lector de texto en el visor. Arriba van sus datos de Forma.' };
}

async function fichaContenido(f, version, caja, forzar) {
  const pinta = (h) => { if (caja) caja.innerHTML = h; };
  try {
    if (!forzar) {
      let c = null;
      try { c = await api('/api/contenido/' + encodeURIComponent(nav.project) + '/' + encodeURIComponent(f.id)); }
      catch (e) {}
      if (c && c.hay && c.texto && (!version || !c.version || c.version === version))
        return fichaContenidoPinta(caja, c, f, version);
    }
    const ext = String(f.ext || (/\.([^.]+)$/.exec(f.name || '') || [0, ''])[1]).toLowerCase();
    // v1.223: un lector por formato (PDF, Excel, Word, PowerPoint, XER y texto);
    // lo que no tiene texto (modelos, imagenes, videos) se explica, sin bajar nada.
    const lector = fichaLector(ext);
    if (!lector.leer) return pinta('<div class="hint">' + esc(lector.nota) + '</div>');
    const esPdf = lector.tipo === 'pdf';
    pinta('<div class="hint">Leyendo el documento para contarte de que trata. Solo la primera vez: ' +
          'despues queda guardado para todos.</div>');
    const r = await fetch('/api/archivo?project=' + encodeURIComponent(nav.project) +
                          '&item=' + encodeURIComponent(f.id));
    if (!r.ok) throw new Error('no se pudo bajar el archivo (HTTP ' + r.status + ')');
    const buf = new Uint8Array(await r.arrayBuffer());
    const paginas = await lector.leer(buf, (m) => pinta('<div class="hint">' + esc(m) + '</div>'));
    const letras = paginas.reduce((s, p) => s + String(p.texto || '').trim().length, 0);
    if (letras < 80) {
      return pinta('<div class="hint">Este documento no trae texto que leer: parece un escaneo ' +
                   '(imagen). Para esos haria falta reconocimiento de texto (OCR).</div>');
    }
    pinta('<div class="hint">Resumiendo ' + paginas.length + ' ' + lector.rotulo + '...</div>');
    const rr = await fetch('/api/ia/documento', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: f.name, unidad: lector.unidad,
                             paginas: fichaSeleccion(paginas, 50000),   // v1.222: lo justo
                             total: paginas.length, modo: 'ficha', pregunta: '', historial: [] }) });
    const j = await rr.json().catch(() => ({}));
    if (!rr.ok || !j.texto) throw new Error(j.error || ('HTTP ' + rr.status));
    const reg = { hay: true, version, texto: j.texto, paginas: paginas.length,
                  unidad: lector.unidad, proveedor: j.proveedor || '',
                  modelo: j.modelo || '', cuando: Date.now() };
    try {
      await api('/api/contenido/' + encodeURIComponent(nav.project) + '/' + encodeURIComponent(f.id),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reg) });
    } catch (e) {}
    if (CONTENIDO.project === nav.project) CONTENIDO.fichas[f.id] = { version, texto: reg.texto };
    fichaContenidoPinta(caja, reg, f, version);
  } catch (e) {
    pinta('<div class="hint">No se pudo leer el contenido: ' + esc((e && e.message) || e) + '</div>');
  }
}

function fichaContenidoPinta(caja, c, f, version) {
  if (!caja) return;
  const md = (typeof iaMarkdown === 'function') ? iaMarkdown(c.texto) : '<p>' + esc(c.texto) + '</p>';
  caja.innerHTML = '<div class="fmd">' + md + '</div><div class="hint">Leido' +
    (c.cuando ? ' el ' + busFechaCorta(c.cuando) : '') + (c.por ? ' por ' + esc(c.por) : '') +
    ' \u00b7 ' + (c.paginas || '?') + ' ' + (c.unidad === 'hoja' ? 'hoja(s)' : 'pagina(s)') +
    ((typeof ES_ADMIN !== 'undefined' && ES_ADMIN && c.proveedor) ? ' \u00b7 ' + esc(c.proveedor) : '') +   // v1.268: solo admin
    ' \u00b7 <a href="#" id="fichaRelee">volver a leer</a></div>';
  const a = $('fichaRelee');
  if (a) a.onclick = (ev) => { ev.preventDefault(); fichaContenido(f, version, caja, true); };
}

async function busBusca() {
  if (!nav.project) return alert('Entra primero a un proyecto (Proyectos).');
  if (BUS.corriendo) { BUS.cancelar = true; return; }
  const c = busCriterios();
  if (!c.texto && !c.formato && !c.version && !c.desde && !c.hasta)
    return alert('Pon al menos un criterio: nombre, formato, version o fecha.');
  // v1.220: con indice guardado, la busqueda sale al instante y no recorre nada.
  if (IDX.filas && IDX.project === nav.project) {
    // v1.221: tambien por lo que el documento DICE, si su ficha ya se leyo.
    const cont = (CONTENIDO.project === nav.project) ? CONTENIDO.fichas : {};
    BUS.filas = IDX.filas.filter(f => busPasa(cont[f.id]
      ? Object.assign({}, f, { desc: (f.desc || '') + ' ' + cont[f.id].texto }) : f, c));
    if ($('busEstado')) $('busEstado').textContent = BUS.filas.length + ' resultado(s) en el indice del ' +
      busFechaCorta(IDX.cuando) + ' (' + IDX.filas.length + ' archivos). Si falta algo nuevo, rehaz el indice.';
    busPinta();
    return;
  }
  const z = $('busEstado'), b = $('busBuscar');
  BUS.corriendo = true; BUS.cancelar = false;
  if (b) b.textContent = 'Detener';
  const avisa = (t) => { if (z) z.textContent = t; };
  // Desde la carpeta donde estes; si no has entrado a ninguna, todo el proyecto.
  const pila = (typeof navMod !== 'undefined' && navMod.pila) || [];
  const desde = pila.length ? pila[pila.length - 1] : null;
  try {
    const r = await busRecorre(desde ? desde.id : null,
                               pila.map(x => x.name).join(' / ') || '/', c, avisa);
    avisa(BUS.filas.length + ' resultado(s) entre ' + r.archivos + ' archivo(s) de ' +
          r.carpetas + ' carpeta(s)' + (BUS.cancelar ? ' (detenida)' : '') + '.');
  } catch (e) { avisa('No se pudo buscar: ' + e.message); }
  BUS.corriendo = false;
  if (b) b.textContent = 'Buscar';
  busPinta();
}

(function busEngancha() {
  if ($('busBuscar')) $('busBuscar').onclick = busBusca;
  if ($('busIndice')) $('busIndice').onclick = busRehaceIndice;   // v1.220
  if ($('busQ')) $('busQ').onkeydown = (e) => { if (e.key === 'Enter') busBusca(); };
  if ($('busLimpia')) $('busLimpia').onclick = () => {
    for (const id of ['busQ', 'busVersion', 'busDesde', 'busHasta'])
      if ($(id)) $(id).value = '';
    if ($('busFormato')) $('busFormato').value = '';
    BUS.filas = [];
    if ($('busLista')) $('busLista').innerHTML = '';
    if ($('busEstado')) $('busEstado').textContent = '';
  };
})();
