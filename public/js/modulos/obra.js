/* MODULO SEGUIMIENTO DE OBRA: planos del CDE con tareas encima, tablero de tareas, fotos, partes diarios y presupuesto.
 * Rutas: #/p/<pid>/obra[/planos | /plano/<cid> | /especs | /espec/<cid> | /tareas[/<tid>] | /planificacion[/<id>] | /fotos | /recorrido | /partes[/<id>] | /rfi[/<rid>] | /cambios[/<rid>] | /presupuesto | /enlaces]
 * Especificaciones, consultas, órdenes de cambio, recorrido 360, dibujo y medición, calendario, Gantt, QR y nube están en obra-extra.js. */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, num, R, dia, aviso, app } = N;
  const ESTADOS = [['p1', 'Prioridad 1', '#d92d20'], ['p2', 'Prioridad 2', '#f79009'], ['p3', 'Prioridad 3', '#ca8a04'], ['completado', 'Completado', '#16a34a'], ['comprobado', 'Comprobado', '#2563eb']];
  const EST = Object.fromEntries(ESTADOS.map(e => [e[0], { txt: e[1], color: e[2] }]));
  const O = (pid) => '/api/proyectos/' + pid + '/obra';
  const OB = N.OB = N.OB || { vista: 'tablero', filtro: 'todas', cat: '', q: '', fotos: 'todas', soloAbiertas: false };
  const corto = (e) => String(e || '').split('@')[0];
  const punto = (est, n) => '<span class="obpt" style="background:' + (EST[est] || EST.p2).color + '">' + (n == null ? '' : n) + '</span>';
  const chipE = (est) => '<span class="obchip" style="--c:' + (EST[est] || EST.p2).color + '">' + esc((EST[est] || { txt: est }).txt) + '</span>';
  const urlFoto = (pid, fid) => O(pid) + '/fotos/' + fid + '/archivo';
  const hoy = () => new Date().toISOString().slice(0, 10);
  const plata = (v, m) => (m || 'S/') + ' ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ICO_OBRA();
  function ICO_OBRA() { N.ICO.obra = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6"/><path d="M9 10h6"/></svg>'; }

  // ---------- PDF: una sola carga por version y miniaturas en memoria ----------
  const DOCS = new Map(), MINI = new Map();
  async function pdfDe(pid, vid) {
    if (!DOCS.has(vid)) DOCS.set(vid, (async () => { await N.carga('vendor/pdf.min.js', 'pdfjsLib'); pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; const r = await fetch(O(pid) + '/pdf/' + vid); if (!r.ok) throw new Error('No se pudo abrir el PDF (' + r.status + ')'); return pdfjsLib.getDocument({ data: await r.arrayBuffer() }).promise; })().catch(e => { DOCS.delete(vid); throw e; }));
    return DOCS.get(vid);
  }
  async function miniatura(pid, vid, ancho) {
    if (MINI.has(vid)) return MINI.get(vid);
    const doc = await pdfDe(pid, vid), pg = await doc.getPage(1), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: (ancho || 260) / v0.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const u = c.toDataURL('image/jpeg', 0.8); MINI.set(vid, u); if (DOCS.size > 6) DOCS.delete(DOCS.keys().next().value); return u;
  }
  /** Una foto equirectangular (2:1 y ancha) es una toma 360. */
  const es360 = (archivo) => new Promise((ok) => { if (!/^image\//.test(archivo.type || '')) return ok(false); const u = URL.createObjectURL(archivo), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i.naturalWidth >= 2000 && Math.abs(i.naturalWidth / i.naturalHeight - 2) < 0.02); }; i.onerror = () => { URL.revokeObjectURL(u); ok(false); }; i.src = u; });
  async function subeFoto(url, archivo) {
    if (!/es360=/.test(url) && await es360(archivo)) url += (url.includes('?') ? '&' : '?') + 'es360=1';
    const r = await fetch(url, { method: 'POST', headers: { 'x-nombre': encodeURIComponent(archivo.name) }, body: archivo }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || j.error || 'No se pudo subir ' + archivo.name); return j;
  }

  // ---------- marco del modulo: pestañas ----------
  const TABS = [['planos', 'Planos'], ['especs', 'Especificaciones'], ['tareas', 'Tareas'], ['planificacion', 'Planificación'], ['fotos', 'Fotos'], ['recorrido', 'Recorrido 360'], ['partes', 'Partes diarios'], ['rfi', 'Consultas (RFI)'], ['cambios', 'Órdenes de cambio'], ['presupuesto', 'Presupuesto'], ['enlaces', 'Más del CDE']];
  function cabecera(p, sec, res, acciones) {
    const n = { planos: res.planos, especs: res.especs, tareas: res.abiertas, planificacion: res.planes, fotos: res.fotos, recorrido: res.tomas, partes: res.partes, rfi: res.rfis, cambios: res.cambios };
    return N.marco(p, '/obra', '', acciones || '') + '<div class="obtabs">' + TABS.map(t => '<a href="#/p/' + p.id + '/obra/' + t[0] + '" class="' + (t[0] === sec ? 'activa' : '') + '">' + t[1] + (n[t[0]] ? ' <span>' + n[t[0]] + '</span>' : '') + '</a>').join('') + '</div>';
  }
  async function vistaObra(pid, sec, ide) {
    sec = sec || 'planos'; const X = N.OBX; X.limpia();
    const [p, res] = await Promise.all([api('/api/proyectos/' + pid), api(O(pid) + '/resumen')]);
    if (sec === 'plano' || sec === 'espec') return vistaPlano(p, res, ide, sec);
    if (sec === 'especs') return X.vistaEspecs(p, res);
    if (sec === 'recorrido') return X.vistaRecorrido(p, res);
    if (sec === 'rfi') return X.vistaRegistros(p, res, 'rfi', ide);
    if (sec === 'cambios') return X.vistaRegistros(p, res, 'cambio', ide);
    if (sec === 'planificacion') return X.vistaPlanificacion(p, res, ide);
    if (sec === 'tareas') return vistaTareas(p, res, ide);
    if (sec === 'fotos') return vistaFotos(p, res);
    if (sec === 'partes') return vistaPartes(p, res, ide);
    if (sec === 'presupuesto') return vistaPresupuesto(p, res);
    if (sec === 'enlaces') return vistaEnlaces(p, res);
    return vistaPlanos(p, res);
  }

  // ---------- PLANOS: los PDF del CDE organizados por coleccion y carpeta de obra ----------
  async function vistaPlanos(p, res) {
    const pid = p.id, d = await api(O(pid) + '/planos');
    const cols = {}; d.planos.forEach(x => { ((cols[x.coleccion || 'General'] = cols[x.coleccion || 'General'] || {})[x.carpeta || 'Sin carpeta'] = cols[x.coleccion || 'General'][x.carpeta || 'Sin carpeta'] || []).push(x); });
    const tarj = (x) => '<div class="obplano" data-plano="' + esc(x.id) + '" title="Abrir el plano"><div class="obmini" data-mini="' + esc(x.version_id) + '"><span class="pista">…</span></div>' + (x.abiertas ? '<span class="obcuenta" title="Tareas abiertas en este plano">' + x.abiertas + '</span>' : '') + '<div class="obpnom mono">' + esc(x.nombre) + '</div><div class="pista">V' + x.n + (x.revision ? ' · ' + esc(x.revision) : '') + ' · ' + x.tareas + ' tarea(s)</div>' + (res.puedoEditar ? '<button class="mini obquita" data-quita="' + esc(x.id) + '" title="Quitar de Seguimiento de obra (el documento sigue en el CDE)">✕</button>' : '') + '</div>';
    app.innerHTML = cabecera(p, 'planos', res, res.puedoEditar ? '<button id="obNube" title="Traer planos desde un enlace compartido de Dropbox, OneDrive o Box">☁ Desde la nube</button> <button class="primario" id="obAdd">+ Añadir planos</button>' : '') +
      (d.planos.length ? Object.keys(cols).map(c => '<div class="tarjeta obcol"><h2>' + esc(c) + ' <span class="pista">' + Object.values(cols[c]).reduce((s, l) => s + l.length, 0) + ' plano(s)</span></h2>' + Object.keys(cols[c]).map(k => '<details open><summary><b>' + esc(k) + '</b> <span class="pista">(' + cols[c][k].length + ' planos)</span></summary><div class="obgrid">' + cols[c][k].map(tarj).join('') + '</div></details>').join('') + '</div>').join('')
        : '<div class="tarjeta"><div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay planos en Seguimiento de obra.</b><br>Los planos no se suben aparte: se eligen entre los PDF que ya están en Documentos de proyecto, y siempre se abre su versión vigente.' + (res.puedoEditar ? '<br><br><button class="primario" id="obAdd2">+ Añadir planos</button>' : '') + '</div></div></div>') + N.cierra();
    app.querySelectorAll('[data-plano]').forEach(c => c.onclick = (e) => { if (e.target.closest('.obquita')) return; location.hash = '#/p/' + pid + '/obra/plano/' + c.dataset.plano; });
    app.querySelectorAll('[data-quita]').forEach(b => b.onclick = async () => { if (!confirm('¿Quitar este plano de Seguimiento de obra? El documento sigue en el CDE y sus tareas se conservan.')) return; try { await api(O(pid) + '/planos/' + b.dataset.quita, { method: 'DELETE' }); vistaPlanos(p, await api(O(pid) + '/resumen')); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    ['obAdd', 'obAdd2'].forEach(i => { const b = document.getElementById(i); if (b) b.onclick = () => ventanaAgregaPlanos(p, d.planos, async () => vistaPlanos(p, await api(O(pid) + '/resumen'))); });
    const bn = document.getElementById('obNube'); if (bn) bn.onclick = () => N.OBX.ventanaNube(p, d.planos, async () => vistaPlanos(p, await api(O(pid) + '/resumen')));
    for (const el of app.querySelectorAll('[data-mini]')) { if (!document.body.contains(el)) return; try { const u = await miniatura(pid, el.dataset.mini); el.innerHTML = '<img src="' + u + '" alt="">'; } catch (e) { el.innerHTML = '<span class="pista">sin vista previa</span>'; } }
  }
  async function ventanaAgregaPlanos(p, actuales, luego, tipo) {
    const esp = tipo === 'espec';
    const pid = p.id, d = await api(O(pid) + '/planos?disponibles=1'), L = d.disponibles || [];
    const colecciones = [...new Set(actuales.map(x => x.coleccion).filter(Boolean))], carpetas = [...new Set(actuales.map(x => x.carpeta).filter(Boolean))];
    const v = N.ventana(esp ? 'Añadir especificaciones' : 'Añadir planos', '<p class="pista" style="margin-top:0">Elige los PDF del CDE que se usarán ' + (esp ? 'como especificaciones técnicas' : 'en obra') + '. No se duplica el archivo: cuando el documento tenga una versión nueva, el plano se actualiza solo.</p>' +
      '<div class="fila" style="gap:8px"><div style="flex:1"><label>' + (esp ? 'Libro de especificaciones' : 'Colección') + '</label><input id="apCol" list="apColL" value="' + esc(colecciones[0] || (esp ? 'Especificaciones técnicas' : p.nombre)) + '"><datalist id="apColL">' + colecciones.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div><div style="flex:1"><label>' + (esp ? 'División / especialidad' : 'Carpeta de obra') + '</label><input id="apCar" list="apCarL" placeholder="Arquitectura, Estructuras…"><datalist id="apCarL">' + carpetas.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div></div>' +
      '<div class="fila" style="gap:8px;align-items:center;margin-top:10px"><input id="apQ" placeholder="Filtrar los PDF de la carpeta elegida" style="flex:1"><label class="rvchk" style="margin:0"><input type="checkbox" id="apTodos"> todos los de la lista</label></div>' +
      '<div class="obdos"><div class="obarbol" id="apArbol"></div><div class="obdisp" id="apLista"></div></div><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><span class="pista" id="apN" style="flex:1"></span><button class="primario" id="apOk">Añadir</button></div><div id="apMsg"></div>', { ancho: 1040, alto: 680 });
    const sel = new Set(), lista = v.querySelector('#apLista'), arbol = v.querySelector('#apArbol');
    // árbol con las carpetas del CDE que tienen PDF: al elegir una carpeta se listan sus planos (y los de sus subcarpetas)
    const partes = (c) => String(c || '').split('/').filter(Boolean), RUTAS = new Set(); L.forEach(x => { const t = partes(x.carpeta_cde); for (let i = 1; i <= t.length; i++) RUTAS.add(t.slice(0, i).join('/')); });
    const dentro = (x, r) => !r || x.carpeta_cde === r || String(x.carpeta_cde || '').startsWith(r + '/');
    let carpeta = ''; const abiertas = new Set([...RUTAS].filter(r => !r.includes('/')));
    const pintaArbol = () => { const rutas = [...RUTAS].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })), visibles = rutas.filter(r => { const t = partes(r); for (let i = 1; i < t.length; i++) if (!abiertas.has(t.slice(0, i).join('/'))) return false; return true; });
      const nodo = (r, nombre, nivel, hijos) => { const tot = L.filter(x => dentro(x, r)), ns = tot.filter(x => sel.has(x.id)).length;
        return '<div class="obnodo' + (carpeta === r ? ' activa' : '') + '" data-r="' + esc(r) + '" style="padding-left:' + (6 + nivel * 16) + 'px">' + (hijos ? '<button class="obflecha" data-ab="' + esc(r) + '" title="Abrir o cerrar">' + (abiertas.has(r) ? '▾' : '▸') + '</button>' : '<span class="obflecha"></span>') + '<input type="checkbox" data-cr="' + esc(r) + '" title="Marcar todos los PDF de esta carpeta"' + (tot.length && ns === tot.length ? ' checked' : '') + '><span class="n" title="' + esc(r || 'Todo el proyecto') + '">' + esc(nombre) + '</span><b>' + (ns ? ns + ' / ' : '') + tot.length + '</b></div>'; };
      arbol.innerHTML = nodo('', 'Todas las carpetas', 0, false) + visibles.map(r => { const t = partes(r); return nodo(r, t[t.length - 1], t.length, rutas.some(x => x.startsWith(r + '/'))); }).join('');
      arbol.querySelectorAll('[data-ab]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const r = b.dataset.ab; abiertas.has(r) ? abiertas.delete(r) : abiertas.add(r); pintaArbol(); });
      arbol.querySelectorAll('[data-cr]').forEach(c => { const tot = L.filter(x => dentro(x, c.dataset.cr)), ns = tot.filter(x => sel.has(x.id)).length; c.indeterminate = ns > 0 && ns < tot.length; c.onclick = (e) => e.stopPropagation(); c.onchange = () => { tot.forEach(x => c.checked ? sel.add(x.id) : sel.delete(x.id)); pinta(); }; });
      arbol.querySelectorAll('.obnodo').forEach(n => n.onclick = () => { carpeta = n.dataset.r; if (carpeta) abiertas.add(carpeta); pinta(); }); };
    const pinta = () => { const q = v.querySelector('#apQ').value.toLowerCase(), F = L.filter(x => dentro(x, carpeta) && (!q || (x.nombre + ' ' + x.carpeta_cde).toLowerCase().includes(q)));
      lista.innerHTML = F.length ? F.map(x => '<label class="obdfila"><input type="checkbox" data-c="' + esc(x.id) + '"' + (sel.has(x.id) ? ' checked' : '') + '><span class="mono">' + esc(x.nombre) + '</span><span class="pista">' + esc(x.carpeta_cde) + ' · V' + x.n + (x.revision ? ' · ' + esc(x.revision) : '') + ' · ' + tam(x.tamano) + '</span></label>').join('') : '<div class="pista" style="padding:16px">' + (L.length ? 'Ningún PDF coincide en esta carpeta.' : 'No hay más PDF en el proyecto. Cárgalos primero en Documentos de proyecto.') + '</div>';
      lista.querySelectorAll('[data-c]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.c) : sel.delete(c.dataset.c); v.querySelector('#apN').textContent = sel.size + ' seleccionado(s)'; pintaArbol(); });
      v.querySelector('#apTodos').checked = F.length > 0 && F.every(x => sel.has(x.id)); pintaArbol();
      v.querySelector('#apN').textContent = sel.size + ' seleccionado(s)'; return F; };
    pinta(); v.querySelector('#apQ').oninput = pinta;
    v.querySelector('#apTodos').onchange = (e) => { pinta().forEach(x => e.target.checked ? sel.add(x.id) : sel.delete(x.id)); pinta(); };
    v.querySelector('#apOk').onclick = async () => { if (!sel.size) return N.toast('Marca al menos un plano.', 'mal'); try { const r = await api(O(pid) + '/planos', { json: { contenedores: [...sel], tipo: esp ? 'espec' : 'plano', coleccion: v.querySelector('#apCol').value, carpeta: v.querySelector('#apCar').value } }); v.closest('.ventana').remove(); N.toast(r.agregados + (esp ? ' especificación(es) añadidas.' : ' plano(s) añadidos.'), 'bien'); luego(); } catch (e) { aviso(v.querySelector('#apMsg'), e); } };
  }

  // ---------- UN PLANO: la hoja con las tareas encima ----------
  async function vistaPlano(p, res, cid, sec) {
    const esp = sec === 'espec', pid = p.id, [dp, dt] = await Promise.all([api(O(pid) + '/planos' + (esp ? '?tipo=espec' : '')), api(O(pid) + '/tareas?plano=' + encodeURIComponent(cid))]);
    const pl = dp.planos.find(x => x.id === cid); if (!pl) { location.hash = '#/p/' + pid + '/obra/' + (esp ? 'especs' : 'planos'); return; }
    const S = { pag: 1, zoom: 1, agregar: false, doc: null, tareas: dt.tareas };
    app.innerHTML = cabecera(p, esp ? 'especs' : 'planos', res) + '<div class="obvisor"><div class="obhoja"><div class="obbarra"><a class="boton mini" href="#/p/' + pid + '/obra/' + (esp ? 'especs' : 'planos') + '">← ' + esc(pl.coleccion || 'Planos') + '</a><b class="mono">' + esc(pl.nombre) + '</b><span class="pista">V' + pl.n + (pl.revision ? ' · ' + esc(pl.revision) : '') + '</span><span class="crece"></span>' +
      '<button class="mini" id="pvMenos" title="Alejar">−</button><span class="pista" id="pvZoom">100 %</span><button class="mini" id="pvMas" title="Acercar">+</button><button class="mini" id="pvAjusta" title="Ajustar al ancho">Ajustar</button><button class="mini" id="pvAnt" title="Hoja anterior">‹</button><span class="pista" id="pvPag">1 / 1</span><button class="mini" id="pvSig" title="Hoja siguiente">›</button>' +
      (res.puedoEditar ? '<button class="primario mini" id="pvAdd" title="Marca un punto del plano para crear la tarea ahí">+ Añadir tarea</button>' : '') + '<a class="boton mini" href="#/p/' + pid + '/c/' + cid + '" title="Ficha del documento en el CDE">Ficha</a></div><div class="obherr" id="pvHerr"></div>' +
      '<div class="oblienzo" id="pvLienzo"><div class="obpapel" id="pvPapel"><canvas id="pvCanvas"></canvas><svg class="obsvg" id="pvSvg"></svg><div class="obpins" id="pvPins"></div></div><div class="pista obcarga" id="pvCarga">Cargando el plano…</div></div></div>' +
      '<aside class="oblado"><div id="pvIndice"></div><div class="fila" style="align-items:center"><h2 style="margin:0;flex:1">Tareas</h2><label class="rvchk" style="margin:0"><input type="checkbox" id="pvAb"' + (OB.soloAbiertas ? ' checked' : '') + '> solo abiertas</label></div><div id="pvLista"></div></aside></div>' + N.cierra();
    const lienzo = document.getElementById('pvLienzo'), papel = document.getElementById('pvPapel'), canvas = document.getElementById('pvCanvas'), pins = document.getElementById('pvPins');
    const visibles = () => S.tareas.filter(t => !OB.soloAbiertas || /^p\d$/.test(t.estado));
    const pintaTareas = () => {
      const L = visibles();
      pins.innerHTML = L.filter(t => (t.pagina || 1) === S.pag && t.x != null && t.y != null).map(t => '<button class="obpin" data-t="' + t.id + '" style="left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;--c:' + (EST[t.estado] || EST.p2).color + '" title="#' + t.numero + ' ' + esc(t.titulo || 'Sin título') + '">' + t.numero + '</button>').join('');
      document.getElementById('pvLista').innerHTML = L.length ? L.map(t => '<div class="obtfila" data-t="' + t.id + '">' + punto(t.estado, t.numero) + '<div><div class="obttit">' + esc(t.titulo || 'Sin título') + '</div><div class="pista">' + esc((EST[t.estado] || {}).txt || '') + (t.categoria ? ' · ' + esc(t.categoria) : '') + ((t.pagina || 1) !== S.pag ? ' · hoja ' + t.pagina : '') + '</div></div></div>').join('') : '<div class="pista" style="padding:14px 0">' + (S.tareas.length ? 'No hay tareas abiertas en este plano.' : 'Este plano aún no tiene tareas.' + (res.puedoEditar ? ' Pulsa «+ Añadir tarea» y marca el punto.' : '')) + '</div>';
      app.querySelectorAll('[data-t]').forEach(b => b.onclick = (e) => { e.stopPropagation(); abreTarea(pid, b.dataset.t, recarga); });
    };
    const recarga = async () => { try { S.tareas = (await api(O(pid) + '/tareas?plano=' + encodeURIComponent(cid))).tareas; pintaTareas(); } catch (e) {} };
    let turno = 0;
    const H = N.OBX.herramientas({ pid, cid, papel, S, plano: pl, puedo: res.puedoEditar, barra: document.getElementById('pvHerr'), svg: document.getElementById('pvSvg') });
    const pinta = async () => {
      const mio = ++turno, pg = await S.doc.getPage(S.pag), v0 = pg.getViewport({ scale: 1 }), base = Math.max(0.2, (lienzo.clientWidth - 24) / v0.width), dpr = Math.min(2, window.devicePixelRatio || 1), vp = pg.getViewport({ scale: base * S.zoom * dpr });
      const c2 = document.createElement('canvas'); c2.width = Math.round(vp.width); c2.height = Math.round(vp.height); await pg.render({ canvasContext: c2.getContext('2d'), viewport: vp }).promise; if (mio !== turno) return;
      canvas.width = c2.width; canvas.height = c2.height; canvas.getContext('2d').drawImage(c2, 0, 0); papel.style.width = Math.round(vp.width / dpr) + 'px'; papel.style.height = Math.round(vp.height / dpr) + 'px';
      document.getElementById('pvZoom').textContent = Math.round(S.zoom * 100) + ' %'; document.getElementById('pvPag').textContent = S.pag + ' / ' + S.doc.numPages; pintaTareas(); H.pinta(v0.width, v0.height);
    };
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    on('pvMas', () => { S.zoom = Math.min(6, S.zoom * 1.35); pinta(); }); on('pvMenos', () => { S.zoom = Math.max(0.4, S.zoom / 1.35); pinta(); }); on('pvAjusta', () => { S.zoom = 1; pinta(); });
    on('pvAnt', () => { if (S.pag > 1) { S.pag--; pinta(); } }); on('pvSig', () => { if (S.doc && S.pag < S.doc.numPages) { S.pag++; pinta(); } });
    on('pvAdd', () => { S.agregar = !S.agregar; if (S.agregar) H.herramienta('mano'); papel.classList.toggle('agregando', S.agregar); document.getElementById('pvAdd').textContent = S.agregar ? 'Marca el punto en el plano… (Esc cancela)' : '+ Añadir tarea'; });
    document.getElementById('pvAb').onchange = (e) => { OB.soloAbiertas = e.target.checked; pintaTareas(); };
    lienzo.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); S.zoom = Math.min(6, Math.max(0.4, S.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); pinta(); }, { passive: false });
    const esc_ = (e) => { if (!document.body.contains(papel)) return document.removeEventListener('keydown', esc_); if (e.key === 'Escape' && S.agregar) document.getElementById('pvAdd').click(); }; document.addEventListener('keydown', esc_);
    papel.onclick = async (e) => {
      if (!S.agregar) return; const r = papel.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; document.getElementById('pvAdd').click();
      try { const t = await api(O(pid) + '/tareas', { json: { titulo: '', estado: 'p2', plano_id: cid, pagina: S.pag, x, y } }); await recarga(); abreTarea(pid, t.id, recarga, true); } catch (err) { N.toast(esc(err.message), 'mal'); }
    };
    try { S.doc = await pdfDe(pid, pl.version_id); document.getElementById('pvCarga').remove(); await pinta(); N.OBX.indice(S.doc, document.getElementById('pvIndice'), (n) => { S.pag = n; pinta(); }, esp); } catch (e) { document.getElementById('pvCarga').textContent = e.message; pintaTareas(); }
  }

  // ---------- LA TAREA: ventana con atributos, checklist, relacionadas, actividad y fotos ----------
  async function abreTarea(pid, tid, luego, nueva) {
    let t, mm = [], cfg, todas = [];
    try { [t, mm, cfg, todas] = await Promise.all([api(O(pid) + '/tareas/' + tid), api('/api/proyectos/' + pid + '/miembros').then(r => r.miembros || []).catch(() => []), api(O(pid) + '/config').then(r => r.config), api(O(pid) + '/tareas').then(r => r.tareas)]); } catch (e) { return N.toast(esc(e.message), 'mal'); }
    document.querySelectorAll('.ventana[data-obt]').forEach(x => x.remove());
    const v = N.ventana('Tarea #' + t.numero, '', { ancho: 980, alto: 700 }); v.closest('.ventana').dataset.obt = tid;
    const ed = () => t.puedoEditar;
    const guarda = async (cambio, callar) => { try { await api(O(pid) + '/tareas/' + tid, { method: 'PUT', json: cambio }); t = await api(O(pid) + '/tareas/' + tid); pinta(); if (luego) luego(); } catch (e) { if (!callar) N.toast(esc(e.message), 'mal'); } };
    const quien = (e) => { const m = mm.find(x => x.email === e); return m && m.nombre ? m.nombre : corto(e); };
    function pinta() {
      const dis = ed() ? '' : ' disabled', sel = (id, ops, val, vacio) => '<select id="' + id + '"' + dis + '>' + (vacio ? '<option value="">' + vacio + '</option>' : '') + ops.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
      const cats = [...new Set(cfg.categorias.concat(t.categoria ? [t.categoria] : []))], hechos = t.checklist.filter(c => c.hecho).length;
      const act = t.actividad.map(a => a.tipo === 'cambio' ? '<div class="obact cambio"><span>' + esc(a.texto) + '</span><i>' + esc(corto(a.autor)) + ' · ' + fecha(a.fecha) + '</i></div>'
        : '<div class="obact">' + N.avatarMini(a.autor) + '<div><b>' + esc(quien(a.autor)) + '</b> <i>' + fecha(a.fecha) + '</i>' + (a.tipo === 'foto' ? '<a href="#" class="obactf" data-foto="' + esc(a.foto_id) + '"><img src="' + urlFoto(pid, a.foto_id) + '" alt="' + esc(a.texto) + '" loading="lazy"></a>' : '<div class="obmsg">' + esc(a.texto) + '</div>') + '</div></div>').join('');
      v.innerHTML = '<div class="obtarea"><div class="obtizq"><div class="obtcab">' + punto(t.estado, t.numero) + '<input id="otTit" class="obtinput" value="' + esc(t.titulo) + '" placeholder="Introduce el título de la tarea"' + dis + '></div>' +
        '<h3>Tareas relacionadas</h3><div class="obchips">' + (t.relacionadasDet.map(x => '<span class="obrel">' + punto(x.estado) + '<a href="#" data-ir="' + x.id + '">#' + x.numero + ' ' + esc(x.titulo || 'Sin título') + '</a>' + (ed() ? '<a href="#" data-qrel="' + x.id + '" title="Quitar">×</a>' : '') + '</span>').join('') || '<span class="pista">Ninguna.</span>') + '</div>' +
        (ed() ? '<div class="fila" style="gap:6px;margin-top:4px"><select id="otRel"><option value="">+ Tarea existente…</option>' + todas.filter(x => x.id !== tid && !t.relacionadas.includes(x.id)).map(x => '<option value="' + x.id + '">#' + x.numero + ' ' + esc(x.titulo || 'Sin título') + '</option>').join('') + '</select><button class="mini" id="otRelN">+ Nueva tarea</button></div>' : '') +
        '<h3>Checklist' + (t.checklist.length ? ' <span class="pista">' + hechos + ' de ' + t.checklist.length + '</span>' : '') + '</h3>' + t.checklist.map((c, i) => '<label class="obchk"><input type="checkbox" data-chk="' + i + '"' + (c.hecho ? ' checked' : '') + dis + '><span class="' + (c.hecho ? 'hecho' : '') + '">' + esc(c.texto) + '</span>' + (ed() ? '<a href="#" data-qchk="' + i + '" title="Quitar">×</a>' : '') + '</label>').join('') +
        (ed() ? '<input id="otChk" placeholder="+ Nuevo elemento (Enter)" style="margin-top:4px">' : '') +
        '<h3>Actividad</h3><div class="obactiv" id="otAct">' + (act || '<div class="pista">Sin actividad.</div>') + '</div>' +
        '<div class="obenvia"><textarea id="otMsg" placeholder="Introduce el mensaje aquí…" rows="2"></textarea><div class="fila" style="gap:6px;align-items:center">' + (ed() ? '<input type="file" id="otFile" accept="image/*,video/mp4,video/quicktime" multiple style="display:none"><button class="mini" id="otFoto" title="Adjuntar fotos a la tarea">📷 Foto</button>' : '') + '<span class="crece"></span><button class="mini" id="otComp">Compartir ▾</button><button class="primario mini" id="otEnv">Enviar</button></div></div></div>' +
        '<div class="obtder"><h3 style="margin-top:0">Atributos de tarea</h3>' +
        '<div class="obattr"><label>Estado</label>' + sel('otEst', ESTADOS, t.estado) + '</div>' +
        '<div class="obattr"><label>Categoría</label>' + sel('otCat', cats.map(c => [c, c]).concat(ed() ? [['__nueva', '+ Nueva categoría…']] : []), t.categoria, '—') + '</div>' +
        '<div class="obattr"><label>Responsable</label>' + sel('otResp', (mm.some(m => m.email === t.responsable) || !t.responsable ? mm : mm.concat([{ email: t.responsable }])).map(m => [m.email, (m.nombre || corto(m.email)) + (m.organizacion ? ' · ' + m.organizacion : '')]), t.responsable, '—') + '</div>' +
        '<div class="obattr col"><label>Plano</label>' + (t.planoDoc ? '<a class="obplanolink" href="#/p/' + pid + '/obra/plano/' + t.plano_id + '" data-cierra><div class="obmini chica" id="otMini"></div><span class="mono">' + esc(t.planoDoc.nombre) + '</span><span class="pista">hoja ' + t.pagina + ' · ver en el plano</span></a>' : '<span class="pista">Sin plano. Para ubicarla, créala desde un plano con «+ Añadir tarea».</span>') + '</div>' +
        '<div class="obattr"><label>Ubicación</label><input id="otUbi" list="otUbiL" value="' + esc(t.ubicacion) + '" placeholder="Nivel, sector, ambiente"' + dis + '><datalist id="otUbiL">' + cfg.ubicaciones.map(u => '<option value="' + esc(u) + '">').join('') + '</datalist></div>' +
        '<div class="obattr"><label>Fecha de inicio</label><input type="date" id="otIni" value="' + esc(t.inicio) + '"' + dis + '></div>' +
        '<div class="obattr"><label>Fecha de finalización</label><input type="date" id="otFin" value="' + esc(t.fin) + '"' + dis + '></div>' +
        '<div class="obattr"><label>Mano de obra (horas)</label><input type="number" min="0" step="0.5" id="otHor" value="' + (t.horas || '') + '"' + dis + '></div>' +
        '<div class="obattr"><label>Coste (' + esc(cfg.moneda) + ')</label><input type="number" min="0" step="0.01" id="otCos" value="' + (t.costo || '') + '"' + dis + '></div>' +
        '<div class="obattr"><label>Etiquetas</label><input id="otEtq" value="' + esc(t.etiquetas.join(', ')) + '" placeholder="separadas por comas"' + dis + '></div>' +
        '<div class="obattr col"><label>Observadores</label><div class="obchips">' + (t.observadores.map(o => '<span class="obrel">' + N.avatarMini(o) + esc(quien(o)) + (ed() ? '<a href="#" data-qobs="' + esc(o) + '" title="Quitar">×</a>' : '') + '</span>').join('') || '<span class="pista">Nadie.</span>') + '</div>' + (ed() ? '<select id="otObs"><option value="">+ Añadir observador…</option>' + mm.filter(m => !t.observadores.includes(m.email)).map(m => '<option value="' + esc(m.email) + '">' + esc(m.nombre || corto(m.email)) + '</option>').join('') + '</select>' : '') + '</div>' +
        '<div class="pista" style="margin-top:10px">Creada por ' + esc(quien(t.creada_por)) + ' · ' + fecha(t.creada) + '</div>' + (t.puedoBorrar ? '<button class="mini" id="otDel" style="margin-top:8px">Suprimir tarea</button>' : '') + '</div></div>';
      const $ = (i) => v.querySelector('#' + i), al = (i, ev, fn) => { const el = $(i); if (el) el[ev] = fn; };
      const caja = $('otAct'); caja.scrollTop = caja.scrollHeight;
      if (t.planoDoc) miniatura(pid, t.planoDoc.version_id).then(u => { const m = $('otMini'); if (m) m.innerHTML = '<img src="' + u + '" alt="">'; }).catch(() => {});
      v.querySelectorAll('[data-cierra]').forEach(a => a.onclick = () => v.closest('.ventana').remove());
      al('otTit', 'onchange', (e) => guarda({ titulo: e.target.value })); al('otEst', 'onchange', (e) => guarda({ estado: e.target.value }));
      al('otCat', 'onchange', async (e) => { let c = e.target.value; if (c === '__nueva') { c = await N.pide('Nueva categoría', 'Nombre', '', 'Crear'); if (!c) return pinta(); cfg.categorias.push(c.trim()); } guarda({ categoria: c }); });
      al('otResp', 'onchange', (e) => guarda({ responsable: e.target.value })); al('otUbi', 'onchange', (e) => guarda({ ubicacion: e.target.value }));
      al('otIni', 'onchange', (e) => guarda({ inicio: e.target.value })); al('otFin', 'onchange', (e) => guarda({ fin: e.target.value }));
      al('otHor', 'onchange', (e) => guarda({ horas: e.target.value })); al('otCos', 'onchange', (e) => guarda({ costo: e.target.value })); al('otEtq', 'onchange', (e) => guarda({ etiquetas: e.target.value }));
      al('otObs', 'onchange', (e) => e.target.value && guarda({ observadores: t.observadores.concat([e.target.value]) }));
      v.querySelectorAll('[data-qobs]').forEach(a => a.onclick = (e) => { e.preventDefault(); guarda({ observadores: t.observadores.filter(o => o !== a.dataset.qobs) }); });
      al('otRel', 'onchange', (e) => e.target.value && guarda({ relacionadas: t.relacionadas.concat([e.target.value]) }));
      al('otRelN', 'onclick', async () => { const tt = await N.pide('Nueva tarea relacionada', 'Título', '', 'Crear'); if (!tt) return; try { const n = await api(O(pid) + '/tareas', { json: { titulo: tt, categoria: t.categoria, relacionadas: [tid] } }); todas = (await api(O(pid) + '/tareas')).tareas; guarda({ relacionadas: t.relacionadas.concat([n.id]) }); } catch (e) { N.toast(esc(e.message), 'mal'); } });
      v.querySelectorAll('[data-qrel]').forEach(a => a.onclick = (e) => { e.preventDefault(); guarda({ relacionadas: t.relacionadas.filter(x => x !== a.dataset.qrel) }); });
      v.querySelectorAll('[data-ir]').forEach(a => a.onclick = (e) => { e.preventDefault(); abreTarea(pid, a.dataset.ir, luego); });
      v.querySelectorAll('[data-chk]').forEach(c => c.onchange = () => guarda({ checklist: t.checklist.map((x, i) => i === +c.dataset.chk ? { texto: x.texto, hecho: c.checked } : x) }));
      v.querySelectorAll('[data-qchk]').forEach(a => a.onclick = (e) => { e.preventDefault(); guarda({ checklist: t.checklist.filter((x, i) => i !== +a.dataset.qchk) }); });
      al('otChk', 'onkeydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) guarda({ checklist: t.checklist.concat([{ texto: e.target.value.trim(), hecho: false }]) }); });
      const envia = async () => { const m = $('otMsg').value.trim(); if (!m) return; try { await api(O(pid) + '/tareas/' + tid + '/mensaje', { json: { texto: m } }); t = await api(O(pid) + '/tareas/' + tid); pinta(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
      al('otEnv', 'onclick', envia); al('otMsg', 'onkeydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) envia(); });
      al('otFoto', 'onclick', (e) => { e.stopPropagation(); document.querySelectorAll('.obfmenu').forEach(x => x.remove()); const r = $('otFoto').getBoundingClientRect(), m = document.createElement('div'); m.className = 'obfmenu';
        m.innerHTML = '<button data-o="cde"><b>Fotos cargadas en CDE</b><span>Elegir entre las fotos que ya están en Seguimiento de obra</span></button><button data-o="ext"><b>Fotos externas</b><span>Subir fotos guardadas en este equipo</span></button>';
        m.style.left = r.left + 'px'; m.style.bottom = (innerHeight - r.top + 6) + 'px'; m.style.zIndex = CDE.sube ? CDE.sube() : 5000; document.body.appendChild(m);
        const fuera = () => { m.remove(); document.removeEventListener('click', fuera); }; setTimeout(() => document.addEventListener('click', fuera), 0);
        m.querySelector('[data-o=ext]').onclick = () => $('otFile').click();
        m.querySelector('[data-o=cde]').onclick = () => eligeFotosCde(pid, t, async () => { t = await api(O(pid) + '/tareas/' + tid); pinta(); if (luego) luego(); }); });
      al('otFile', 'onchange', async (e) => { const fs = [...e.target.files]; if (!fs.length) return; let okN = 0; for (const f of fs) { try { await subeFoto(O(pid) + '/tareas/' + tid + '/foto', f); okN++; } catch (err) { N.toast(esc(err.message), 'mal'); } } if (okN) { N.toast(okN + ' foto(s) añadidas a la tarea.', 'bien'); t = await api(O(pid) + '/tareas/' + tid); pinta(); if (luego) luego(); } });
      v.querySelectorAll('[data-foto]').forEach(a => a.onclick = (e) => { e.preventDefault(); const f = t.fotos.find(x => x.id === a.dataset.foto); abreFoto(pid, Object.assign({ tarea_id: tid, tarea_numero: t.numero, tarea_titulo: t.titulo }, f || { id: a.dataset.foto, nombre: 'Foto' })); });
      al('otComp', 'onclick', (e) => { const url = location.origin + location.pathname + '#/p/' + pid + '/obra/tareas/' + tid;
        N.menuFlotante(e.currentTarget, [{ texto: 'Copiar enlace', accion: async () => { try { await navigator.clipboard.writeText(url); N.toast('Enlace copiado.', 'bien'); } catch (x) { prompt('Copia el enlace', url); } } },
          { texto: 'Enviar por correo', accion: () => { location.href = 'mailto:' + encodeURIComponent(t.responsable && t.responsable.includes('@') ? t.responsable : '') + '?subject=' + encodeURIComponent('Tarea #' + t.numero + ' · ' + (t.titulo || 'Sin título')) + '&body=' + encodeURIComponent((t.titulo || '') + '\nEstado: ' + EST[t.estado].txt + '\n' + url); } },
          { sep: true }, { texto: 'Exportar como PDF', accion: () => imprimeTarea(pid, t, quien, cfg) }, { texto: 'Exportar código QR', accion: () => N.OBX.qr(url, 'Tarea #' + t.numero + ' · ' + (t.titulo || 'Sin título'), (N.PROY_ACTUAL || {}).codigo + ' · Seguimiento de obra') }]); });
      al('otDel', 'onclick', async () => { if (!confirm('¿Suprimir la tarea #' + t.numero + '?')) return; try { await api(O(pid) + '/tareas/' + tid, { method: 'DELETE' }); v.closest('.ventana').remove(); N.toast('Tarea suprimida.', 'bien'); if (luego) luego(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    }
    pinta(); if (nueva) { const i = v.querySelector('#otTit'); if (i) i.focus(); }
  }
  /** Hoja imprimible de la tarea (Imprimir → Guardar como PDF). */
  function imprimeTarea(pid, t, quien, cfg) {
    const w = window.open('', '_blank'); if (!w) return N.toast('El navegador bloqueó la ventana de impresión.', 'mal');
    const fila = (a, b) => '<tr><th>' + a + '</th><td>' + (b || '—') + '</td></tr>', base = location.origin;
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tarea #' + t.numero + '</title><style>body{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#1f2328;margin:28px}h1{font-size:19px;margin:0 0 2px}h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #d0d4da;padding-bottom:3px}table{border-collapse:collapse;width:100%}th{text-align:left;width:190px;color:#59636e;font-weight:500;padding:3px 0;vertical-align:top}td{padding:3px 0}.f{display:flex;flex-wrap:wrap;gap:8px}.f img{width:230px;height:160px;object-fit:cover;border:1px solid #d0d4da}.a{color:#59636e;font-size:12px}</style></head><body>' +
      '<div class="a">' + esc((N.PROY_ACTUAL || {}).codigo || '') + ' · ' + esc((N.PROY_ACTUAL || {}).nombre || '') + ' · Seguimiento de obra</div><h1>Tarea #' + t.numero + ' · ' + esc(t.titulo || 'Sin título') + '</h1>' +
      '<table>' + fila('Estado', esc(EST[t.estado].txt)) + fila('Categoría', esc(t.categoria)) + fila('Responsable', esc(quien(t.responsable))) + fila('Plano', t.planoDoc ? esc(t.planoDoc.nombre) + ' (hoja ' + t.pagina + ')' : '') + fila('Ubicación', esc(t.ubicacion)) + fila('Fecha de inicio', esc(t.inicio)) + fila('Fecha de finalización', esc(t.fin)) + fila('Mano de obra', t.horas ? t.horas + ' horas' : '') + fila('Coste', t.costo ? plata(t.costo, cfg.moneda) : '') + fila('Etiquetas', esc(t.etiquetas.join(', '))) + '</table>' +
      (t.checklist.length ? '<h2>Checklist</h2>' + t.checklist.map(c => '<div>' + (c.hecho ? '☑' : '☐') + ' ' + esc(c.texto) + '</div>').join('') : '') +
      (t.fotos.length ? '<h2>Fotos (' + t.fotos.length + ')</h2><div class="f">' + t.fotos.filter(f => /^image\//.test(f.mime || 'image/')).map(f => '<img src="' + base + urlFoto(pid, f.id) + '">').join('') + '</div>' : '') +
      '<h2>Actividad</h2>' + t.actividad.map(a => '<div><span class="a">' + fecha(a.fecha) + ' · ' + esc(quien(a.autor)) + ':</span> ' + esc(a.tipo === 'foto' ? 'Foto: ' + a.texto : a.texto) + '</div>').join('') + '</body></html>');
    w.document.close(); const lanza = () => { w.focus(); w.print(); }; const im = [...w.document.images]; if (!im.length) return setTimeout(lanza, 200);
    let n = im.length; im.forEach(i => { const f = () => { if (--n <= 0) lanza(); }; i.complete ? f() : (i.onload = i.onerror = f); });
  }

  // ---------- TAREAS: tablero por estado o lista ----------
  async function vistaTareas(p, res, tidAbrir) {
    const pid = p.id, d = await api(O(pid) + '/tareas' + (OB.filtro !== 'todas' ? '?vista=' + OB.filtro : '')), q = OB.q.toLowerCase();
    const L = d.tareas.filter(t => (!OB.cat || t.categoria === OB.cat) && (!q || ('#' + t.numero + ' ' + t.titulo + ' ' + t.categoria + ' ' + t.responsable + ' ' + t.ubicacion + ' ' + t.etiquetas.join(' ')).toLowerCase().includes(q)));
    const recarga = () => vistaObra(pid, 'tareas');
    const tarj = (t) => '<div class="obcard" draggable="' + (res.puedoEditar ? 'true' : 'false') + '" data-t="' + t.id + '">' + punto(t.estado, t.numero) + '<div class="obcinfo"><div class="obttit">' + esc(t.titulo || 'Sin título') + '</div><div class="pista">' + [t.categoria, t.ubicacion, t.fin ? 'hasta ' + dia(t.fin) : ''].filter(Boolean).map(esc).join(' · ') + '</div><div class="obcpie">' + (t.responsable ? N.avatarMini(t.responsable) : '') + (t.plano ? '<span class="pista" title="' + esc(t.plano) + '">📐</span>' : '') + (t.fotos ? '<span class="pista">📷 ' + t.fotos + '</span>' : '') + (t.checklist.length ? '<span class="pista">☑ ' + t.checklist.filter(c => c.hecho).length + '/' + t.checklist.length + '</span>' : '') + (t.fin && /^p\d$/.test(t.estado) && t.fin < hoy() ? '<span class="etq rojo">vencida</span>' : '') + '</div></div></div>';
    const cuerpo = OB.vista === 'calendario' ? N.OBX.calendario(L, OB) : OB.vista === 'gantt' ? N.OBX.gantt(L, OB) : OB.vista === 'lista'
      ? '<div class="acctabla"><table><thead><tr><th>N.º</th><th>Título</th><th>Estado</th><th>Categoría</th><th>Responsable</th><th>Plano</th><th>Ubicación</th><th>Inicio</th><th>Fin</th><th>Horas</th><th>Coste</th></tr></thead><tbody>' + L.map(t => '<tr class="clic" data-t="' + t.id + '"><td class="num">#' + t.numero + '</td><td><b>' + esc(t.titulo || 'Sin título') + '</b></td><td>' + chipE(t.estado) + '</td><td>' + esc(t.categoria) + '</td><td>' + (t.responsable ? N.avatarMini(t.responsable) + ' ' + esc(corto(t.responsable)) : '') + '</td><td class="mono pista">' + esc(t.plano) + '</td><td>' + esc(t.ubicacion) + '</td><td>' + esc(t.inicio) + '</td><td>' + esc(t.fin) + '</td><td class="num">' + (t.horas || '') + '</td><td class="num">' + (t.costo ? plata(t.costo, d.config.moneda) : '') + '</td></tr>').join('') + '</tbody></table>' + (L.length ? '' : '<div class="intro-vacio"><div>No hay tareas con ese filtro.</div></div>') + '</div>'
      : '<div class="obtablero">' + ESTADOS.map(e => { const C = L.filter(t => t.estado === e[0]); return '<div class="obcolu" data-est="' + e[0] + '"><div class="obcolcab" style="--c:' + e[2] + '"><b>' + e[1] + '</b><span>' + C.length + '</span>' + (res.puedoEditar ? '<button class="mini" data-nueva="' + e[0] + '" title="Nueva tarea en ' + e[1] + '">+</button>' : '') + '</div><div class="obcolcu">' + (C.map(tarj).join('') || '<div class="pista obvacia">No hay tareas</div>') + '</div></div>'; }).join('') + '</div>';
    app.innerHTML = cabecera(p, 'tareas', res, res.puedoEditar ? '<button class="primario" id="otNueva">+ Nueva tarea</button> <button id="otImp">Importar tareas</button> <button id="otInf">Generar informe</button> <button id="otCfg">Categorías y ubicaciones</button>' : '<button id="otInf">Generar informe</button>') +
      '<div class="obfiltros"><div class="tabs chicas" style="margin:0;border:0">' + [['todas', 'Todas las tareas'], ['mias', 'Mis tareas'], ['observadas', 'Tareas observadas']].map(f => '<button data-f="' + f[0] + '" class="' + (OB.filtro === f[0] ? 'activa' : '') + '">' + f[1] + '</button>').join('') + '</div><select id="otCatF"><option value="">Todas las categorías</option>' + d.config.categorias.map(c => '<option' + (c === OB.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select><span class="crece"></span><input id="otQ" placeholder="Buscar tareas" value="' + esc(OB.q) + '" style="width:220px"><div class="obvistas"><button data-v="tablero" class="' + (OB.vista === 'tablero' ? 'activa' : '') + '" title="Tablero por estado">Tablero</button><button data-v="lista" class="' + (OB.vista === 'lista' ? 'activa' : '') + '" title="Lista">Lista</button><button data-v="calendario" class="' + (OB.vista === 'calendario' ? 'activa' : '') + '" title="Calendario por fecha de inicio y de finalización">Calendario</button><button data-v="gantt" class="' + (OB.vista === 'gantt' ? 'activa' : '') + '" title="Diagrama de Gantt">Gantt</button></div></div>' + cuerpo + N.cierra();
    app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { OB.filtro = b.dataset.f; recarga(); });
    app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { OB.vista = b.dataset.v; recarga(); });
    app.querySelectorAll('[data-mes]').forEach(b => b.onclick = () => { OB.mes = b.dataset.mes; recarga(); });
    document.getElementById('otCatF').onchange = (e) => { OB.cat = e.target.value; recarga(); };
    document.getElementById('otQ').onkeydown = (e) => { if (e.key === 'Enter') { OB.q = e.target.value; recarga(); } };
    app.querySelectorAll('[data-t]').forEach(c => c.onclick = () => abreTarea(pid, c.dataset.t, recarga));
    const crea = async (est) => { try { const t = await api(O(pid) + '/tareas', { json: { titulo: '', estado: est || 'p2', categoria: OB.cat } }); await recarga(); abreTarea(pid, t.id, recarga, true); } catch (e) { N.toast(esc(e.message), 'mal'); } };
    app.querySelectorAll('[data-nueva]').forEach(b => b.onclick = (e) => { e.stopPropagation(); crea(b.dataset.nueva); });
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    on('otNueva', () => crea('p2')); on('otImp', () => ventanaImportar(pid, recarga)); on('otCfg', () => ventanaConfig(pid, d.config, recarga));
    on('otInf', async () => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'); const cab = ['N.º', 'Título', 'Estado', 'Categoría', 'Responsable', 'Plano', 'Hoja', 'Ubicación', 'Fecha de inicio', 'Fecha de finalización', 'Mano de obra (h)', 'Coste', 'Etiquetas', 'Checklist', 'Fotos', 'Creada', 'Creada por'];
      const filas = L.slice().reverse().map(t => [t.numero, t.titulo, EST[t.estado].txt, t.categoria, t.responsable, t.plano, t.plano ? t.pagina : '', t.ubicacion, t.inicio, t.fin, t.horas, t.costo, t.etiquetas.join(', '), t.checklist.length ? t.checklist.filter(c => c.hecho).length + '/' + t.checklist.length : '', t.fotos, (t.creada || '').slice(0, 10), t.creada_por]);
      const res2 = ESTADOS.map(e => [e[1], L.filter(t => t.estado === e[0]).length]); const wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([cab].concat(filas)), 'Tareas'); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Estado', 'Tareas']].concat(res2).concat([['Total', L.length]])), 'Resumen'); XL.writeFile(wb, 'tareas-obra-' + p.codigo + '-' + hoy() + '.xlsx'); });
    // arrastrar una tarjeta a otra columna cambia su estado
    let arrastre = null;
    app.querySelectorAll('.obcard[draggable="true"]').forEach(c => { c.ondragstart = (e) => { arrastre = c.dataset.t; e.dataTransfer.effectAllowed = 'move'; c.classList.add('yendo'); }; c.ondragend = () => c.classList.remove('yendo'); });
    app.querySelectorAll('.obcolu').forEach(col => { col.ondragover = (e) => { if (arrastre) { e.preventDefault(); col.classList.add('sobre'); } }; col.ondragleave = () => col.classList.remove('sobre');
      col.ondrop = async (e) => { e.preventDefault(); col.classList.remove('sobre'); const id = arrastre; arrastre = null; if (!id) return; const t = L.find(x => x.id === id); if (!t || t.estado === col.dataset.est) return; try { await api(O(pid) + '/tareas/' + id, { method: 'PUT', json: { estado: col.dataset.est } }); recarga(); } catch (err) { N.toast(esc(err.message), 'mal'); } }; });
    if (tidAbrir) abreTarea(pid, tidAbrir, recarga);
  }
  function ventanaImportar(pid, luego) {
    const COLS = [['titulo', /t[ií]tulo|tarea|descrip/i], ['estado', /estado|prioridad/i], ['categoria', /categor/i], ['responsable', /respons|correo/i], ['inicio', /inicio/i], ['fin', /fin/i], ['ubicacion', /ubica/i], ['horas', /hora|mano/i], ['costo', /cost/i], ['etiquetas', /etiq/i]];
    const v = N.ventana('Importar tareas', '<p class="pista" style="margin-top:0">Pega las filas desde Excel (o un CSV). La primera fila son los encabezados; se reconocen: <b>Título</b>, Estado (Prioridad 1, 2, 3, Completado, Comprobado), Categoría, Responsable (correo), Fecha de inicio, Fecha de fin (aaaa-mm-dd o dd/mm/aaaa), Ubicación, Mano de obra (horas), Coste y Etiquetas. Sin encabezados, la primera columna es el título.</p>' +
      '<textarea id="imTxt" style="min-height:230px;font-family:var(--mono);white-space:pre" placeholder="Título&#9;Estado&#9;Categoría&#9;Responsable&#10;Resanar junta de muro&#9;Prioridad 1&#9;Arquitectura&#9;residente@empresa.pe"></textarea><div id="imPrev" class="pista" style="margin-top:6px"></div><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="primario" id="imOk">Importar tareas</button></div><div id="imMsg"></div>', { ancho: 760, alto: 560 });
    const lee = () => { const lin = v.querySelector('#imTxt').value.split(/\r?\n/).filter(l => l.trim()); if (!lin.length) return [];
      const sep = lin[0].includes('\t') ? '\t' : lin[0].includes(';') ? ';' : ',', F = lin.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
      const cab = F[0].map(h => (COLS.find(c => c[1].test(h)) || [])[0]), conCab = cab.some(Boolean) && cab.includes('titulo'), mapa = conCab ? cab : ['titulo', 'estado', 'categoria', 'responsable', 'inicio', 'fin', 'ubicacion', 'horas', 'costo', 'etiquetas'];
      return F.slice(conCab ? 1 : 0).map(f => { const o = {}; mapa.forEach((k, i) => { if (k && f[i] !== undefined && f[i] !== '') o[k] = f[i]; }); return o; }).filter(o => o.titulo); };
    v.querySelector('#imTxt').oninput = () => { const n = lee().length; v.querySelector('#imPrev').textContent = n ? n + ' tarea(s) listas para importar.' : ''; };
    v.querySelector('#imOk').onclick = async () => { const filas = lee(); if (!filas.length) return N.toast('No hay filas con título.', 'mal'); try { const r = await api(O(pid) + '/tareas/importar', { json: { filas } }); v.closest('.ventana').remove(); N.toast(r.creadas + ' tarea(s) importadas.', 'bien'); luego(); } catch (e) { aviso(v.querySelector('#imMsg'), e); } };
  }
  function ventanaConfig(pid, cfg, luego) {
    const v = N.ventana('Categorías y ubicaciones', '<label>Categorías de tarea (una por línea)</label><textarea id="cfCat" style="min-height:150px">' + esc(cfg.categorias.join('\n')) + '</textarea><label>Ubicaciones de la obra (una por línea: niveles, sectores, ambientes)</label><textarea id="cfUbi" style="min-height:120px">' + esc(cfg.ubicaciones.join('\n')) + '</textarea><label>Moneda</label><input id="cfMon" value="' + esc(cfg.moneda) + '" style="width:90px"><div class="fila" style="justify-content:flex-end;margin-top:10px"><button class="primario" id="cfOk">Guardar</button></div><div id="cfMsg"></div>', { ancho: 520, alto: 560 });
    v.querySelector('#cfOk').onclick = async () => { try { await api(O(pid) + '/config', { method: 'PUT', json: { categorias: v.querySelector('#cfCat').value.split('\n'), ubicaciones: v.querySelector('#cfUbi').value.split('\n'), moneda: v.querySelector('#cfMon').value } }); v.closest('.ventana').remove(); luego(); } catch (e) { aviso(v.querySelector('#cfMsg'), e); } };
  }

  // ---------- FOTOS ----------
  const SINAMB = 'Sin ambiente', ambDe = (f) => f.ambiente || SINAMB;
  const carpetasDe = (fotos) => { const m = new Map(); fotos.forEach(f => m.set(ambDe(f), (m.get(ambDe(f)) || 0) + 1)); return [...m.entries()].sort((a, b) => (a[0] === SINAMB) - (b[0] === SINAMB) || a[0].localeCompare(b[0], 'es', { numeric: true })); };
  const miniFoto = (pid, f, extra) => '<a href="#" class="obthumb" data-foto="' + f.id + '" title="' + esc(f.nombre) + ' · ' + (f.fecha || '').slice(0, 10) + '">' + (/^video\//.test(f.mime || '') ? '<div class="obvid">▶ video</div>' : '<img src="' + urlFoto(pid, f.id) + '" loading="lazy" alt="">') + (f.tarea_id ? '<span class="obfpin">' + punto(f.tarea_estado, f.tarea_numero) + '</span>' : '') + (f.es360 ? '<span class="ob360">360°</span>' : '') + (extra || '') + '</a>';
  /** «Fotos cargadas en CDE»: se eligen de la galería (por ambiente) y se adjuntan a la tarea. */
  async function eligeFotosCde(pid, t, luego) {
    const d = await api(O(pid) + '/fotos'), F = d.fotos.filter(f => f.tarea_id !== t.id && !/^video\//.test(f.mime || '')), C = carpetasDe(F), sel = new Set(); let amb = C.some(c => c[0] === t.ubicacion) ? t.ubicacion : '';
    const v = N.ventana('Fotos cargadas en CDE', '<div class="obfdos"><aside class="obfcarp" id="efC"></aside><div class="obfder2"><div class="obgal" id="efG"></div></div></div><div class="fila" style="gap:8px;margin-top:10px;align-items:center"><span class="pista" id="efN" style="flex:1"></span><button class="primario" id="efOk">Adjuntar a la tarea</button></div>', { ancho: 980, alto: 660 });
    const pinta = () => { v.querySelector('#efC').innerHTML = '<button data-a="" class="' + (amb === '' ? 'activa' : '') + '"><span>Todas las fotos</span><b>' + F.length + '</b></button>' + C.map(([k, n]) => '<button data-a="' + esc(k) + '" class="' + (amb === k ? 'activa' : '') + '"><span>' + esc(k) + '</span><b>' + n + '</b></button>').join('');
      const L = F.filter(f => !amb || ambDe(f) === amb); v.querySelector('#efG').innerHTML = L.map(f => miniFoto(pid, f, '<span class="obfchk' + (sel.has(f.id) ? ' si' : '') + '">✓</span>')).join('') || '<div class="pista" style="padding:20px">No hay fotos en el CDE todavía. Usa «Fotos externas» para subirlas desde este equipo.</div>';
      v.querySelector('#efN').textContent = sel.size + ' foto(s) elegidas' + (t.ubicacion ? ' · quedarán en el ambiente de la tarea si aún no tienen uno' : '');
      v.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { amb = b.dataset.a; pinta(); });
      v.querySelectorAll('[data-foto]').forEach(a => a.onclick = (e) => { e.preventDefault(); const k = a.dataset.foto; sel.has(k) ? sel.delete(k) : sel.add(k); pinta(); }); };
    pinta(); v.querySelector('#efOk').onclick = async () => { if (!sel.size) return N.toast('Elige al menos una foto.', 'mal'); try { const r = await api(O(pid) + '/tareas/' + t.id + '/foto-cde', { json: { fotos: [...sel] } }); v.closest('.ventana').remove(); N.toast(r.adjuntadas + ' foto(s) adjuntadas a la tarea.', 'bien'); luego(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
  }
  /** Dos fotos del mismo ambiente lado a lado (por defecto, la más antigua y la más reciente) para ver el avance. */
  function comparaFotos(pid, amb, fotos) {
    const L = fotos.filter(f => !/^video\//.test(f.mime || '') && !f.es360).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))); if (L.length < 2) return N.toast('Hacen falta al menos dos fotos en este ambiente para comparar.', 'mal');
    const op = (s) => L.map((f, i) => '<option value="' + i + '"' + (i === s ? ' selected' : '') + '>' + fecha(f.fecha) + ' · ' + esc(f.nombre) + '</option>').join('');
    const v = N.ventana('Comparar fotos · ' + amb, '<div class="obrcmp"><div class="obrcdos"><div class="obrclado"><div class="obrctit"><b>Antes</b><select id="cfA">' + op(0) + '</select></div><div class="obfimg" id="cfIa"></div></div><div class="obrclado"><div class="obrctit"><b>Después</b><select id="cfB">' + op(L.length - 1) + '</select></div><div class="obfimg" id="cfIb"></div></div></div><div class="pista" style="text-align:center">' + L.length + ' foto(s) de este ambiente, de la más antigua a la más reciente.</div></div>', { ancho: Math.min(1400, innerWidth - 60), alto: Math.min(760, innerHeight - 60) });
    const pon = (s, c) => { const f = L[+v.querySelector(s).value]; v.querySelector(c).innerHTML = '<img src="' + urlFoto(pid, f.id) + '" alt="">'; };
    v.querySelector('#cfA').onchange = () => pon('#cfA', '#cfIa'); v.querySelector('#cfB').onchange = () => pon('#cfB', '#cfIb'); pon('#cfA', '#cfIa'); pon('#cfB', '#cfIb');
  }
  function abreFoto(pid, f, luego) {
    const esVideo = /^video\//.test(f.mime || ''), u = urlFoto(pid, f.id);
    const v = N.ventana(f.es360 ? 'Foto 360' : 'Foto', '<div class="obfoto"><div class="obfimg" id="ofImg">' + (esVideo ? '<video src="' + u + '" controls></video>' : '<img src="' + u + '" alt="' + esc(f.nombre) + '">') + '</div><div class="obfdet"><h3 style="margin-top:0">Detalles</h3><div class="pista">' + esc(f.nombre || '') + '</div>' + (f.autor ? '<div>Subido por ' + esc(corto(f.autor)) + '</div><div class="pista">' + fecha(f.fecha) + '</div>' : '') +
      (f.tarea_id ? '<h3>Tarea</h3><a href="#" id="ofTarea">' + punto(f.tarea_estado || 'p2') + ' #' + f.tarea_numero + ' ' + esc(f.tarea_titulo || 'Sin título') + '</a>' : f.parte_id ? '<h3>Parte diario</h3><a href="#/p/' + pid + '/obra/partes/' + f.parte_id + '" data-cierra>Abrir el parte</a>' : '<h3>Enlaces</h3><span class="pista">Foto suelta, sin tarea.</span>') +
      (luego ? '<h3>Ambiente</h3><div class="fila" style="gap:6px"><input id="ofAmb" list="ofAmbL" value="' + esc(f.ambiente || '') + '" placeholder="Sin ambiente" style="flex:1"><datalist id="ofAmbL">' + (OB.ambientes || []).map(a => '<option value="' + esc(a) + '">').join('') + '</datalist><button class="mini" id="ofAmbOk">Mover</button></div>' : '') +
      '<div class="fila" style="gap:6px;margin-top:14px"><a class="boton mini" href="' + u + '?descargar=1">Descargar</a>' + (luego ? '<button class="mini" id="ofDel">Suprimir</button>' : '') + '</div></div></div>', { ancho: 960, alto: 640 });
    if (f.es360 && !esVideo) N.OBX.visor360(v.querySelector('#ofImg'), u, {}).then(vis => { N.OBX.registra(vis, v); }).catch(() => {});
    const am = v.querySelector('#ofAmbOk'); if (am) am.onclick = async () => { try { await api(O(pid) + '/fotos/' + f.id, { method: 'PUT', json: { ambiente: v.querySelector('#ofAmb').value.trim() } }); v.closest('.ventana').remove(); N.toast('Foto movida de ambiente.', 'bien'); luego(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
    const a = v.querySelector('#ofTarea'); if (a) a.onclick = (e) => { e.preventDefault(); v.closest('.ventana').remove(); abreTarea(pid, f.tarea_id, luego); };
    v.querySelectorAll('[data-cierra]').forEach(x => x.onclick = () => v.closest('.ventana').remove());
    const d = v.querySelector('#ofDel'); if (d) d.onclick = async () => { if (!confirm('¿Suprimir esta foto?')) return; try { await api(O(pid) + '/fotos/' + f.id, { method: 'DELETE' }); v.closest('.ventana').remove(); luego(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
  }
  async function vistaFotos(p, res) {
    const pid = p.id, d = await api(O(pid) + '/fotos' + (OB.fotos === 'mias' ? '?vista=mias' : '')), recarga = () => vistaObra(pid, 'fotos');
    const C = carpetasDe(d.fotos); OB.ambientes = [...new Set(C.map(c => c[0]).filter(c => c !== SINAMB).concat((res.config || {}).ubicaciones || []))];
    if (OB.amb && !C.some(c => c[0] === OB.amb)) OB.amb = ''; const L = d.fotos.filter(f => !OB.amb || ambDe(f) === OB.amb);
    const dias = {}; L.forEach(f => (dias[(f.fecha || '').slice(0, 10)] = dias[(f.fecha || '').slice(0, 10)] || []).push(f));
    app.innerHTML = cabecera(p, 'fotos', res, (OB.amb ? '<button id="ofCmp" title="Dos fotos de este ambiente lado a lado, para ver el avance">◫ Comparar fotos</button> ' : '') + (res.puedoEditar ? '<input type="file" id="ofFile" accept="image/*,video/mp4,video/quicktime" multiple style="display:none"><button class="primario" id="ofNueva">+ Nueva foto' + (OB.amb && OB.amb !== SINAMB ? ' en este ambiente' : '') + '</button>' : '')) +
      '<div class="obfiltros"><div class="tabs chicas" style="margin:0;border:0"><button data-ff="todas" class="' + (OB.fotos === 'todas' ? 'activa' : '') + '">Todas las fotos</button><button data-ff="mias" class="' + (OB.fotos === 'mias' ? 'activa' : '') + '">Mis fotos</button></div><span class="crece"></span><span class="pista">' + L.length + ' foto(s)' + (OB.amb ? ' en «' + esc(OB.amb) + '»' : '') + '</span></div>' +
      (d.fotos.length ? '<div class="obfdos"><aside class="obfcarp"><h3>Ambientes</h3><button data-amb="" class="' + (!OB.amb ? 'activa' : '') + '"><span>Todas las fotos</span><b>' + d.fotos.length + '</b></button>' + C.map(([k, n]) => '<button data-amb="' + esc(k) + '" class="' + (OB.amb === k ? 'activa' : '') + '"><span>' + esc(k) + '</span><b>' + n + '</b></button>').join('') + '<div class="pista" style="margin-top:10px">Las fotos de una tarea van solas a la carpeta de su ubicación. Abre una foto para moverla a otro ambiente.</div></aside><div class="obfder2">' +
        Object.keys(dias).map(k => '<h3 class="obdia">' + new Date(k + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</h3><div class="obgal">' + dias[k].map(f => miniFoto(pid, f)).join('') + '</div>').join('') + '</div></div>'
        : '<div class="tarjeta"><div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay fotos.</b><br>Súbelas aquí o adjúntalas a una tarea; se ordenan solas por ambiente y por día.</div></div></div>') + N.cierra();
    app.querySelectorAll('[data-amb]').forEach(b => b.onclick = () => { OB.amb = b.dataset.amb; recarga(); });
    const cmp = document.getElementById('ofCmp'); if (cmp) cmp.onclick = () => comparaFotos(pid, OB.amb, L);
    app.querySelectorAll('[data-ff]').forEach(b => b.onclick = () => { OB.fotos = b.dataset.ff; recarga(); });
    app.querySelectorAll('[data-foto]').forEach(a => a.onclick = (e) => { e.preventDefault(); abreFoto(pid, d.fotos.find(f => f.id === a.dataset.foto), recarga); });
    const b = document.getElementById('ofNueva'), fi = document.getElementById('ofFile'); if (b) { b.onclick = () => fi.click(); fi.onchange = async () => { const fs = [...fi.files]; if (!fs.length) return; b.disabled = true; let n = 0; for (const f of fs) { b.textContent = 'Subiendo ' + (n + 1) + ' de ' + fs.length + '…'; try { await subeFoto(O(pid) + '/fotos' + (OB.amb && OB.amb !== SINAMB ? '?ambiente=' + encodeURIComponent(OB.amb) : ''), f); n++; } catch (e) { N.toast(esc(e.message), 'mal'); } } if (n) N.toast(n + ' foto(s) subidas.', 'bien'); recarga(); }; }
  }

  // ---------- PARTES DIARIOS ----------
  async function vistaPartes(p, res, ide) {
    const pid = p.id, d = await api(O(pid) + '/partes'), recarga = () => vistaObra(pid, 'partes');
    app.innerHTML = cabecera(p, 'partes', res, res.puedoEditar ? '<button class="primario" id="opNuevo">+ Nuevo parte diario</button>' : '') +
      '<div class="tarjeta"><div class="acctabla"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Título</th><th>Actividades</th><th>Avance medio</th><th>Estado</th><th>Elaborado por</th><th>Firmado por</th></tr></thead><tbody>' + d.partes.map(x => '<tr class="clic" data-p="' + x.id + '"><td class="num">' + x.numero + '</td><td>' + esc(x.fecha) + '</td><td><b>' + esc(x.titulo) + '</b></td><td class="num">' + x.nActividades + '</td><td><div class="obbar"><i style="width:' + x.avance + '%"></i></div> ' + x.avance + ' %</td><td>' + (x.estado === 'enviado' ? '<span class="estado cerrada">ENVIADO</span>' : '<span class="estado abierta">BORRADOR</span>') + '</td><td>' + N.avatarMini(x.autor) + ' ' + esc(corto(x.autor)) + '</td><td>' + esc(x.firmante || '') + '</td></tr>').join('') + '</tbody></table>' + (d.partes.length ? '' : '<div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay partes diarios.</b><br>El parte reúne las actividades del día con su avance, las notas, las fotos y la firma de quien lo emite.</div></div>') + '</div></div>' + N.cierra();
    app.querySelectorAll('[data-p]').forEach(tr => tr.onclick = () => abreParte(pid, tr.dataset.p, recarga));
    const b = document.getElementById('opNuevo'); if (b) b.onclick = async () => { try { const x = await api(O(pid) + '/partes', { json: { fecha: hoy(), titulo: 'Parte diario ' + hoy() } }); await recarga(); abreParte(pid, x.id, recarga); } catch (e) { N.toast(esc(e.message), 'mal'); } };
    if (ide) abreParte(pid, ide, recarga);
  }
  async function abreParte(pid, ide, luego) {
    let x; try { x = await api(O(pid) + '/partes/' + ide); } catch (e) { return N.toast(esc(e.message), 'mal'); }
    document.querySelectorAll('.ventana[data-obp]').forEach(w => w.remove());
    const v = N.ventana('Parte diario N.º ' + x.numero, '', { ancho: 900, alto: 720 }); v.closest('.ventana').dataset.obp = ide;
    const col = (a) => a >= 100 ? '#16a34a' : a >= 50 ? '#f79009' : '#d92d20';
    function pinta() {
      const ed = x.puedoEditar, dis = ed ? '' : ' disabled';
      v.innerHTML = '<div class="obparte"><div class="fila" style="gap:10px;align-items:flex-end;flex-wrap:wrap"><div><label>Fecha</label><input type="date" id="ppFecha" value="' + esc(x.fecha) + '"' + dis + '></div><div style="flex:2;min-width:220px"><label>Título</label><input id="ppTit" value="' + esc(x.titulo) + '"' + dis + '></div><div style="flex:1;min-width:140px"><label>Clima</label><input id="ppClima" value="' + esc(x.clima) + '" placeholder="Despejado, 27 °C"' + dis + '></div><div style="flex:1;min-width:160px"><label>Personal en obra</label><input id="ppPers" value="' + esc(x.personal) + '" placeholder="12 operarios, 2 capataces"' + dis + '></div>' + (x.estado === 'enviado' ? '<span class="estado cerrada">ENVIADO</span>' : '<span class="estado abierta">BORRADOR</span>') + '</div>' +
        '<h3>Actividades</h3><table class="chica obpact"><thead><tr><th>Actividad</th><th style="width:110px">Avance %</th><th>Notas</th>' + (ed ? '<th style="width:30px"></th>' : '') + '</tr></thead><tbody id="ppAct">' + x.actividades.map(a => filaAct(a, ed)).join('') + '</tbody></table>' + (ed ? '<button class="mini" id="ppMas" style="margin-top:6px">+ Añadir actividad</button>' : '') +
        '<h3>Notas del día</h3><textarea id="ppNotas" style="min-height:70px" placeholder="Incidentes, restricciones, visitas, equipos…"' + dis + '>' + esc(x.notas) + '</textarea>' +
        '<h3>Fotos (' + x.fotos.length + ')</h3><div class="obgal chica">' + x.fotos.map(f => '<a href="#" class="obthumb" data-foto="' + f.id + '"><img src="' + urlFoto(pid, f.id) + '" loading="lazy" alt=""></a>').join('') + (ed ? '<input type="file" id="ppFile" accept="image/*" multiple style="display:none"><button class="obmasfoto" id="ppFoto">+ Añadir fotos</button>' : '') + '</div>' +
        '<h3>Firma</h3>' + (x.estado === 'enviado' ? '<div class="obfirmada"><img src="' + esc(x.firma) + '" alt="Firma"><div class="pista">Enviado por ' + esc(x.firmante) + ' · ' + fecha(x.enviado) + '</div></div>'
          : ed ? '<div class="fila" style="gap:10px;align-items:flex-end;flex-wrap:wrap"><div><canvas id="ppFirma" class="obfirma" width="440" height="130"></canvas><div class="pista">Firma con el mouse o el dedo. <a href="#" id="ppLimpia">Limpiar</a></div></div><div style="flex:1;min-width:200px"><label>Nombre y cargo de quien firma</label><input id="ppFirmante" value="' + esc((N.YO || {}).nombre || '') + '" placeholder="Nombre · Residente de obra"></div></div>' : '<span class="pista">Sin firma.</span>') +
        (ed ? '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:14px"><button id="ppDel">Suprimir borrador</button><button id="ppGuarda">Guardar borrador</button><button class="primario" id="ppEnvia">Firmar y enviar</button></div><div class="pista" style="text-align:right">Una vez enviado, el parte ya no se puede modificar.</div>' : '') + '<div id="ppMsg"></div></div>';
      const $ = (i) => v.querySelector('#' + i);
      v.querySelectorAll('[data-foto]').forEach(a => a.onclick = (e) => { e.preventDefault(); const f = x.fotos.find(k => k.id === a.dataset.foto); abreFoto(pid, Object.assign({ parte_id: '' }, f)); });
      if (!ed) return;
      const enlazaFilas = () => v.querySelectorAll('#ppAct tr').forEach(tr => { const q = tr.querySelector('[data-q]'); if (q) q.onclick = (e) => { e.preventDefault(); tr.remove(); }; const av = tr.querySelector('.ppAv'); av.oninput = () => { av.style.color = col(+av.value || 0); }; });
      enlazaFilas(); $('ppMas').onclick = () => { $('ppAct').insertAdjacentHTML('beforeend', filaAct({ actividad: '', avance: 0, notas: '' }, true)); enlazaFilas(); const u = v.querySelectorAll('#ppAct .ppA'); u[u.length - 1].focus(); };
      const datos = () => ({ fecha: $('ppFecha').value, titulo: $('ppTit').value, clima: $('ppClima').value, personal: $('ppPers').value, notas: $('ppNotas').value, actividades: [...v.querySelectorAll('#ppAct tr')].map(tr => ({ actividad: tr.querySelector('.ppA').value, avance: tr.querySelector('.ppAv').value, notas: tr.querySelector('.ppN').value })) });
      const guarda = async () => { await api(O(pid) + '/partes/' + ide, { method: 'PUT', json: datos() }); };
      // firma dibujada
      const cv = $('ppFirma'), cx = cv.getContext('2d'); let traza = false, hay = false; cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.strokeStyle = '#111827';
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
      cv.onpointerdown = (e) => { traza = true; hay = true; cv.setPointerCapture(e.pointerId); const [a, b] = pos(e); cx.beginPath(); cx.moveTo(a, b); }; cv.onpointermove = (e) => { if (!traza) return; const [a, b] = pos(e); cx.lineTo(a, b); cx.stroke(); }; cv.onpointerup = cv.onpointercancel = () => { traza = false; };
      $('ppLimpia').onclick = (e) => { e.preventDefault(); cx.clearRect(0, 0, cv.width, cv.height); hay = false; };
      $('ppGuarda').onclick = async () => { try { await guarda(); N.toast('Borrador guardado.', 'bien'); x = await api(O(pid) + '/partes/' + ide); pinta(); luego(); } catch (e) { aviso($('ppMsg'), e); } };
      $('ppFoto').onclick = () => $('ppFile').click();
      $('ppFile').onchange = async (e) => { try { await guarda(); for (const f of [...e.target.files]) await subeFoto(O(pid) + '/fotos?parte=' + ide, f); x = await api(O(pid) + '/partes/' + ide); pinta(); } catch (err) { aviso($('ppMsg'), err); } };
      $('ppEnvia').onclick = async () => { if (!hay) return N.toast('Falta la firma.', 'mal'); if (!$('ppFirmante').value.trim()) { N.toast('Escribe el nombre de quien firma.', 'mal'); return $('ppFirmante').focus(); } if (!confirm('¿Firmar y enviar el parte? Ya no se podrá modificar.')) return; try { await guarda(); await api(O(pid) + '/partes/' + ide + '/enviar', { json: { firma: cv.toDataURL('image/png'), firmante: $('ppFirmante').value } }); N.toast('Parte diario enviado.', 'bien'); x = await api(O(pid) + '/partes/' + ide); pinta(); luego(); } catch (e) { aviso($('ppMsg'), e); } };
      $('ppDel').onclick = async () => { if (!confirm('¿Suprimir este borrador?')) return; try { await api(O(pid) + '/partes/' + ide, { method: 'DELETE' }); v.closest('.ventana').remove(); luego(); } catch (e) { aviso($('ppMsg'), e); } };
    }
    function filaAct(a, ed) { const dis = ed ? '' : ' disabled'; return '<tr><td><input class="ppA" value="' + esc(a.actividad) + '" placeholder="Actividad"' + dis + '></td><td><input class="ppAv" type="number" min="0" max="100" step="5" value="' + (a.avance || 0) + '" style="color:' + col(a.avance || 0) + ';font-weight:600"' + dis + '></td><td><input class="ppN" value="' + esc(a.notas) + '" placeholder="Añadir notas"' + dis + '></td>' + (ed ? '<td><a href="#" data-q title="Quitar">×</a></td>' : '') + '</tr>'; }
    pinta();
  }

  // ---------- PRESUPUESTO ----------
  async function vistaPresupuesto(p, res) {
    const pid = p.id, d = await api(O(pid) + '/presupuesto'), ed = d.puedoEditar, m = d.moneda;
    const fila = (f) => '<tr><td><input class="pc" value="' + esc(f.codigo || '') + '"' + (ed ? '' : ' disabled') + '></td><td><input class="pd" value="' + esc(f.descripcion || '') + '"' + (ed ? '' : ' disabled') + '></td><td><input class="pg" value="' + esc(f.grupo || '') + '"' + (ed ? '' : ' disabled') + '></td><td><input class="pp num" type="number" min="0" step="0.01" value="' + (f.presupuesto || '') + '"' + (ed ? '' : ' disabled') + '></td><td><input class="pe num" type="number" min="0" step="0.01" value="' + (f.ejecutado || '') + '"' + (ed ? '' : ' disabled') + '></td><td class="num psal"></td><td class="pav"></td>' + (ed ? '<td><a href="#" data-q title="Quitar">×</a></td>' : '') + '</tr>';
    const tT = d.tareas.reduce((s, x) => ({ n: s.n + x.tareas, c: s.c + (x.costo || 0), h: s.h + (x.horas || 0) }), { n: 0, c: 0, h: 0 });
    app.innerHTML = cabecera(p, 'presupuesto', res, ed ? '<button id="prMas">+ Añadir partida</button> <button class="primario" id="prOk">Guardar presupuesto</button>' : '') +
      '<div class="fila" style="gap:12px;align-items:flex-start;flex-wrap:wrap"><div class="tarjeta" style="flex:3;min-width:520px"><h2>Presupuesto por partida <span class="pista">(' + esc(m) + ')</span></h2><table class="chica obpres"><thead><tr><th style="width:110px">Código</th><th>Descripción</th><th style="width:150px">Grupo</th><th style="width:130px">Presupuesto</th><th style="width:130px">Ejecutado</th><th style="width:120px">Saldo</th><th style="width:130px">Avance</th>' + (ed ? '<th style="width:26px"></th>' : '') + '</tr></thead><tbody id="prCuerpo">' + d.partidas.map(fila).join('') + '</tbody><tfoot><tr><th colspan="3">Total</th><th class="num" id="prTp"></th><th class="num" id="prTe"></th><th class="num" id="prTs"></th><th id="prTa"></th>' + (ed ? '<th></th>' : '') + '</tr></tfoot></table>' + (d.partidas.length || ed ? '' : '<div class="pista" style="padding:14px 0">Aún no hay partidas. Las registra un gestor del proyecto.</div>') + (ed ? '<div class="pista" style="margin-top:8px">«Ejecutado» lo actualiza el gestor con cada valorización. Los cambios de alcance se tramitan en Alertas tempranas y Eventos compensables.</div>' : '') + '</div>' +
      '<div class="tarjeta" style="flex:1;min-width:300px"><h2>Registrado en las tareas</h2><table class="chica"><thead><tr><th>Categoría</th><th class="num">Tareas</th><th class="num">Horas</th><th class="num">Coste</th></tr></thead><tbody>' + (d.tareas.map(x => '<tr><td>' + esc(x.categoria || '(sin categoría)') + '</td><td class="num">' + x.tareas + '</td><td class="num">' + num(x.horas || 0) + '</td><td class="num">' + plata(x.costo, m) + '</td></tr>').join('') || '<tr><td colspan="4" class="pista">Sin tareas.</td></tr>') + '</tbody><tfoot><tr><th>Total</th><th class="num">' + tT.n + '</th><th class="num">' + num(tT.h) + '</th><th class="num">' + plata(tT.c, m) + '</th></tr></tfoot></table><div class="pista" style="margin-top:8px">Suma de «Mano de obra» y «Coste» de cada tarea de obra.</div><h2 style="margin-top:18px">Órdenes de cambio</h2><table class="chica"><thead><tr><th>N.º</th><th>Nombre</th><th>Estado</th><th class="num">Monto</th></tr></thead><tbody>' + ((d.cambios || []).map(c => '<tr><td>' + c.numero + '</td><td>' + esc(c.titulo) + '</td><td>' + esc(c.estado.charAt(0).toUpperCase() + c.estado.slice(1)) + '</td><td class="num">' + plata(c.monto, m) + '</td></tr>').join('') || '<tr><td colspan="4" class="pista">Sin órdenes solicitadas ni aprobadas.</td></tr>') + '</tbody><tfoot><tr><th colspan="3">Aprobadas</th><th class="num">' + plata((d.cambios || []).filter(c => c.estado === 'aprobada').reduce((s2, c) => s2 + c.monto, 0), m) + '</th></tr></tfoot></table><a href="#/p/' + pid + '/obra/cambios">Ver órdenes de cambio →</a></div></div>' + N.cierra();
    const cuerpo = document.getElementById('prCuerpo');
    const calcula = () => { let tp = 0, te = 0; cuerpo.querySelectorAll('tr').forEach(tr => { const a = +tr.querySelector('.pp').value || 0, b = +tr.querySelector('.pe').value || 0, pc = a ? Math.round(b / a * 100) : 0; tp += a; te += b; tr.querySelector('.psal').textContent = plata(a - b, ''); tr.querySelector('.psal').classList.toggle('rojo', b > a); tr.querySelector('.pav').innerHTML = '<div class="obbar"><i style="width:' + Math.min(100, pc) + '%;' + (b > a ? 'background:#d92d20' : '') + '"></i></div> ' + pc + ' %'; const q = tr.querySelector('[data-q]'); if (q) q.onclick = (e) => { e.preventDefault(); tr.remove(); calcula(); }; });
      document.getElementById('prTp').textContent = plata(tp, m); document.getElementById('prTe').textContent = plata(te, m); document.getElementById('prTs').textContent = plata(tp - te, m); document.getElementById('prTa').textContent = (tp ? Math.round(te / tp * 100) : 0) + ' %'; };
    calcula(); cuerpo.oninput = calcula;
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    on('prMas', () => { cuerpo.insertAdjacentHTML('beforeend', fila({})); calcula(); const u = cuerpo.querySelectorAll('.pc'); u[u.length - 1].focus(); });
    on('prOk', async () => { try { const r = await api(O(pid) + '/presupuesto', { method: 'PUT', json: { partidas: [...cuerpo.querySelectorAll('tr')].map(tr => ({ codigo: tr.querySelector('.pc').value, descripcion: tr.querySelector('.pd').value, grupo: tr.querySelector('.pg').value, presupuesto: tr.querySelector('.pp').value, ejecutado: tr.querySelector('.pe').value })) } }); N.toast('Presupuesto guardado (' + r.partidas + ' partidas).', 'bien'); vistaObra(pid, 'presupuesto'); } catch (e) { N.toast(esc(e.message), 'mal'); } });
  }

  // ---------- lo que ya resuelven otros modulos del CDE ----------
  function vistaEnlaces(p, res) {
    const pid = p.id, t = (href, tit, txt, ext) => '<a class="obenlace" href="' + href + '"' + (ext ? ' target="_blank"' : '') + '><b>' + tit + '</b><span>' + txt + '</span><i>Abrir →</i></a>';
    app.innerHTML = cabecera(p, 'enlaces', res) + '<p class="pista" style="margin:0 0 12px">Estas partes de la gestión de obra ya existen en el CDE, con sus flujos y su trazabilidad. Desde aquí se abren directamente, sin duplicarlas.</p><div class="obenlaces">' +
      t('#/p/' + pid, 'Archivos', 'Todos los archivos de la obra viven en Documentos de proyecto, con versiones, permisos por carpeta y estados WIP · COM · PUB.') +
      t('#/p/' + pid + '/revisiones', 'Entregas para aprobación', 'Los entregables se envían a Revisión contractual y siguen el flujo en paralelo: Document Control, especialistas y Gerente de Proyecto.') +
      t('#/p/' + pid + '/correspondencia', 'Comunicaciones contractuales', 'Cuando una consulta de obra deba quedar como comunicación formal entre las partes, se emite desde Comunicaciones contractuales.') +
      t('#/p/' + pid + '/registros', 'Alertas tempranas y Eventos compensables', 'Una orden de cambio que afecte el contrato se formaliza como alerta temprana o evento compensable.') +
      t('#/p/' + pid + '/incidencias', 'Observaciones', 'Las observaciones sobre documentos y modelos se gestionan en Observaciones contractuales.') +
      t('visor.html?pid=' + pid, 'Modelos 3D', 'Los modelos RVT, IFC y NWD publicados se abren en el Visor GIS/BIM, sin licencias.', true) + '</div>' + N.cierra();
  }

  // lo que comparten los submodulos de obra-extra.js
  N.OBX = Object.assign(N.OBX || {}, { O, EST, ESTADOS, OB, corto, punto, chipE, urlFoto, hoy, plata, cabecera, vistaObra, abreTarea, abreFoto, subeFoto, pdfDe, miniatura, ventanaAgregaPlanos });
  N.vistas.obra = vistaObra;
})();
