/* SEGUIMIENTO DE OBRA · PLANIFICACIÓN: tablas de planificación importadas de Primavera P6 y Microsoft Project (largo plazo)
 * y planes propios de corto plazo, con su Gantt. Rutas: #/p/<pid>/obra/planificacion[/<id>].
 * Los archivos se leen en el navegador con los lectores del visor (obra-plan-lectores.js); al servidor solo llegan las actividades. */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, aviso, app } = N, X = N.OBX = N.OBX || {};
  const O = (pid) => '/api/proyectos/' + pid + '/obra';
  const corto = (e) => String(e || '').split('@')[0], hoy = () => new Date().toISOString().slice(0, 10);
  const cierraV = (v) => { const w = v.closest('.ventana'); if (w) w.remove(); };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const aD = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dTxt = (s) => { const d = aD(s); return d ? d.getDate() + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear() : '—'; };
  const dias = (a, b) => Math.round((b - a) / 864e5);
  const PL = N.OBPL = N.OBPL || { filtro: 'todo', agrupar: false, orden: 'creado', vista: 'tarjetas', critica: true, zoom: 'semana', q: '' };
  const ICO_T = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7M9 12v4M12.5 12v4"/></svg>';
  const ICO_P = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M5 6h8v4H5zM9 12h9v4H9z"/></svg>';

  // ═════════ leer un archivo de cronograma ═════════
  /** Completa lo que el lector del visor no saca del XML: vínculos, holgura y actividades críticas. */
  function completaXml(tareas, txt) {
    const doc = new DOMParser().parseFromString(txt, 'application/xml'), dame = (n, t) => { const e = n.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
    const por = new Map(tareas.map(t => [String(t.id), t])); tareas.forEach(t => { t.tid = String(t.id); t.pred = t.pred || []; t.suc = t.suc || []; });
    const une = (pre, suc, tipo, horas) => { if (!pre || !suc || pre === suc) return; const lag = horas ? (horas > 0 ? '+' : '') + (Math.round(horas / 8 * 10) / 10) + 'd' : ''; suc.pred.push({ id: pre.id, tid: pre.tid, nombre: pre.nombre, tipo, lag, horas }); pre.suc.push({ id: suc.id, tid: suc.tid, nombre: suc.nombre, tipo, lag, horas }); };
    const act = doc.getElementsByTagName('Activity');
    if (act.length) {   // Primavera P6
      const obj = new Map([...act].map(a => [dame(a, 'ObjectId'), por.get(dame(a, 'Id'))]));
      [...act].forEach(a => { const t = por.get(dame(a, 'Id')), f = dame(a, 'TotalFloat'); if (t && f !== '' && isFinite(parseFloat(f))) { t.holgura = parseFloat(f); t.critica = t.holgura <= 0; } });
      const TIPOS = { 'Finish to Start': 'FS', 'Start to Start': 'SS', 'Finish to Finish': 'FF', 'Start to Finish': 'SF' };
      [...doc.getElementsByTagName('Relationship')].forEach(r => une(obj.get(dame(r, 'PredecessorActivityObjectId')), obj.get(dame(r, 'SuccessorActivityObjectId')), TIPOS[dame(r, 'Type')] || 'FS', parseFloat(dame(r, 'Lag')) || 0));
      return 'p6xml';
    }
    const TIPOS = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };   // Microsoft Project
    [...doc.getElementsByTagName('Task')].forEach(n => { const t = por.get(dame(n, 'UID')); if (!t) return;
      const hijos = [...n.children];
      const cr = hijos.find(x => x.tagName === 'Critical'), sl = hijos.find(x => x.tagName === 'TotalSlack');
      if (sl && isFinite(parseFloat(sl.textContent))) t.holgura = Math.round(parseFloat(sl.textContent) / 600 * 10) / 10;
      if (cr) t.critica = cr.textContent.trim() === '1' && !t.resumen; else if (t.holgura != null) t.critica = t.holgura <= 0 && !t.resumen;
      hijos.filter(x => x.tagName === 'PredecessorLink').forEach(l => une(por.get(dame(l, 'PredecessorUID')), t, TIPOS[dame(l, 'Type')] || 'FS', (parseFloat(dame(l, 'LinkLag')) || 0) / 600)); });
    return 'mspxml';
  }
  /** De un archivo (nombre + bytes) a { formato, tareas listas para guardar, resumen }. */
  async function leeCronograma(nombre, buf) {
    const L = X.lectores, ext = (/\.([a-z0-9]+)$/i.exec(nombre) || [, ''])[1].toLowerCase();
    if (ext === 'mpp') throw new Error('Un .mpp es el formato interno de Microsoft Project y no se puede leer fuera del programa. En Project: Archivo → Guardar como → «Formato XML (*.xml)», e importa ese XML. Conserva tareas, fechas, avance, vínculos y ruta crítica.');
    let T, formato;
    if (/^(xlsx|xlsm|xls|csv|ods)$/.test(ext)) { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.read(buf, { cellDates: true }); let filas = []; for (const h of wb.SheetNames) { filas = XL.utils.sheet_to_json(wb.Sheets[h], { defval: '' }); try { T = L.leeExcel(filas); if (T.length) break; } catch (e) { T = null; } } if (!T || !T.length) throw new Error('El Excel necesita una hoja con columnas de nombre (o actividad), inicio y fin.'); formato = 'excel'; }
    else {
      let txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
      if (ext === 'xer' || /^ERMHDR/.test(txt)) { T = L.leeXer(txt); formato = 'xer'; }
      else if (ext === 'mpx' || /^MPX,/.test(txt)) { T = L.leeMpx(txt); formato = 'mpx'; }
      else if (ext === 'xml' || /^\s*<\?xml|^\s*</.test(txt)) { T = L.leeXml(txt); formato = completaXml(T, txt);
        // el XML de Primavera guarda el avance como fracción (0,6 = 60 %)
        if (formato === 'p6xml' && T.every(t => (t.pct || 0) <= 1) && T.some(t => t.pct > 0)) T.forEach(t => { t.pct = Math.round((t.pct || 0) * 1000) / 10; }); }
      else throw new Error('Formato no reconocido. Se admiten .xer y .xml de Primavera P6, .xml y .mpx de Microsoft Project, y Excel.');
    }
    if (!T.length) throw new Error('El archivo no trae actividades con fecha de inicio y de fin.');
    // si el archivo trae vínculos pero no holgura, la ruta crítica se calcula con ellos
    const H = T.filter(t => !t.resumen), conVinc = H.some(t => (t.pred || []).length);
    if (conVinc && H.some(t => t.holgura == null)) { H.forEach(t => { t.tid = t.tid || String(t.id); }); L.crRutaCriticaDe(T); }
    const tareas = T.map(t => ({ id: String(t.id || ''), nombre: t.nombre, ini: t.ini ? iso(t.ini) : '', fin: t.fin ? iso(t.fin) : '', pct: Math.round((t.pct || 0) * 10) / 10, nivel: t.nivel || 1, resumen: !!t.resumen, wbs: String(t.wbs || ''), critica: !!t.critica && !t.resumen, holgura: t.holgura == null ? null : t.holgura, pred: (t.pred || []).map(v => ({ id: String(v.id), tipo: v.tipo, lag: v.lag || '' })) }));
    const A = tareas.filter(t => !t.resumen);
    return { formato, tareas, n: A.length, bandas: tareas.length - A.length, ini: A.reduce((m, t) => !m || t.ini < m ? t.ini : m, ''), fin: A.reduce((m, t) => t.fin > m ? t.fin : m, ''), criticas: A.filter(t => t.critica).length, vinculos: A.reduce((s, t) => s + t.pred.length, 0), conHolgura: A.some(t => t.holgura != null) };
  }
  const FORM = { xer: 'Primavera P6 (XER)', p6xml: 'Primavera P6 (XML)', mspxml: 'Microsoft Project (XML)', mpx: 'Microsoft Project (MPX)', excel: 'Excel' };

  function ejemplo() {
    const T = [[1, 'Hospital · planificación de ejemplo', 1, 1, '2026-01-05', '2026-03-13', 35, []], [2, 'Obras preliminares', 2, 1, '2026-01-05', '2026-01-23', 100, []], [3, 'Movilización e instalaciones provisionales', 3, 0, '2026-01-05', '2026-01-16', 100, []], [4, 'Trazo y replanteo', 3, 0, '2026-01-19', '2026-01-23', 100, [3]],
      [5, 'Estructuras', 2, 1, '2026-01-26', '2026-03-13', 15, []], [6, 'Excavación de cimentación', 3, 0, '2026-01-26', '2026-02-06', 60, [4]], [7, 'Acero y encofrado de zapatas', 3, 0, '2026-02-09', '2026-02-20', 0, [6]], [8, 'Vaciado de concreto de zapatas', 3, 0, '2026-02-23', '2026-02-27', 0, [7]], [9, 'Columnas y placas del primer nivel', 3, 0, '2026-03-02', '2026-03-13', 0, [8]], [10, 'Instalaciones sanitarias enterradas', 3, 0, '2026-02-09', '2026-02-18', 0, [6]]];
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n<Name>Planificación de ejemplo</Name>\n<Tasks>\n' + T.map(t => '<Task><UID>' + t[0] + '</UID><ID>' + t[0] + '</ID><Name>' + t[1] + '</Name><OutlineLevel>' + t[2] + '</OutlineLevel><WBS>' + t[0] + '</WBS><Summary>' + t[3] + '</Summary><Start>' + t[4] + 'T08:00:00</Start><Finish>' + t[5] + 'T17:00:00</Finish><PercentComplete>' + t[6] + '</PercentComplete><Critical>' + (t[0] === 10 || t[3] ? 0 : 1) + '</Critical><TotalSlack>' + (t[0] === 10 ? 86400 : 0) + '</TotalSlack>' + t[7].map(p => '<PredecessorLink><PredecessorUID>' + p + '</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>').join('') + '</Task>').join('\n') + '\n</Tasks>\n</Project>\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' })); a.download = 'planificacion-de-ejemplo.xml'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ═════════ lista de planificaciones ═════════
  X.vistaPlanificacion = async function (p, res, ide) {
    if (ide) return vistaPlan(p, res, ide);
    const pid = p.id, d = await api(O(pid) + '/planes'), recarga = async () => { if (/\/obra\/planificacion$/.test(location.hash)) X.vistaPlanificacion(p, await api(O(pid) + '/resumen')); };
    const T = d.planes, tablas = T.filter(x => x.tipo === 'tabla'), planes = T.filter(x => x.tipo === 'plan');
    const ord = { creado: (a, b) => b.creado.localeCompare(a.creado), nombre: (a, b) => a.nombre.localeCompare(b.nombre), inicio: (a, b) => (a.inicio || '9').localeCompare(b.inicio || '9'), avance: (a, b) => b.avance - a.avance }[PL.orden];
    let L = (PL.filtro === 'tablas' ? tablas : PL.filtro === 'planes' ? planes : T).slice().sort(ord);
    if (PL.agrupar && PL.filtro === 'todo') { const sueltos = L.filter(x => x.tipo === 'plan' && !tablas.some(t => t.id === x.tabla_id)), out = []; L.filter(x => x.tipo === 'tabla').forEach(t => { out.push(t); L.filter(x => x.tipo === 'plan' && x.tabla_id === t.id).forEach(x => out.push(Object.assign({}, x, { hijo: true }))); }); L = out.concat(sueltos); }
    const min = T.reduce((m, x) => x.inicio && (!m || x.inicio < m) ? x.inicio : m, ''), max = T.reduce((m, x) => x.fin > m ? x.fin : m, ''), span = min && max ? Math.max(1, dias(aD(min), aD(max))) : 1;
    const linea = (x) => x.inicio && x.fin ? '<div class="oplinea" title="' + dTxt(x.inicio) + ' → ' + dTxt(x.fin) + '"><i style="left:' + (dias(aD(min), aD(x.inicio)) / span * 100) + '%;width:' + Math.max(1.5, dias(aD(x.inicio), aD(x.fin)) / span * 100) + '%"><u style="width:' + x.avance + '%"></u></i>' + (hoy() >= min && hoy() <= max ? '<s style="left:' + (dias(aD(min), aD(hoy())) / span * 100) + '%"></s>' : '') + '</div>' : '';
    const tipoTxt = (x) => x.tipo === 'tabla' ? 'Tabla de planificación' : 'Plan';
    const carta = (x) => '<div class="opcard' + (x.hijo ? ' hijo' : '') + '" data-pl="' + x.id + '"><div class="opctop"><span class="opico ' + x.tipo + '">' + (x.tipo === 'tabla' ? ICO_T : ICO_P) + '</span><div class="crece"><b>' + esc(x.nombre) + '</b><div class="pista">' + tipoTxt(x) + (x.formatoTxt ? ' · ' + esc(x.formatoTxt) : '') + (x.tipo === 'plan' && x.tabla_id && tablas.find(t => t.id === x.tabla_id) ? ' · conectado a ' + esc(tablas.find(t => t.id === x.tabla_id).nombre) : '') + '</div></div></div>' +
      '<div class="opcdat"><div><span>Inicio</span><b>' + dTxt(x.inicio) + '</b></div><div><span>Fin</span><b>' + dTxt(x.fin) + '</b></div><div><span>Actividades</span><b>' + x.actividades + '</b></div><div><span>Avance</span><b>' + x.avance + ' %</b></div>' + (x.criticas ? '<div><span>Críticas</span><b style="color:var(--rojo)">' + x.criticas + '</b></div>' : '') + '</div>' + linea(x) + '<div class="pista opcpie">' + N.avatarMini(x.por) + ' ' + esc(corto(x.por)) + ' · ' + fecha(x.creado) + '</div></div>';
    const fila = (x) => '<tr class="clic" data-pl="' + x.id + '"><td>' + (x.hijo ? '<span class="pista">└ </span>' : '') + '<b>' + esc(x.nombre) + '</b></td><td>' + tipoTxt(x) + '</td><td>' + esc(x.formatoTxt || '') + '</td><td>' + dTxt(x.inicio) + '</td><td>' + dTxt(x.fin) + '</td><td class="num">' + x.actividades + '</td><td class="num">' + x.avance + ' %</td><td class="num">' + (x.criticas || '') + '</td><td style="min-width:160px">' + linea(x) + '</td><td>' + esc(corto(x.por)) + '</td><td class="pista">' + fecha(x.creado) + '</td></tr>';
    app.innerHTML = X.cabecera(p, 'planificacion', res) + '<div class="oppl"><div class="fila" style="gap:16px;align-items:flex-start;flex-wrap:wrap">' +
      (d.puedoEditar ? '<button class="opacc" id="opImp"><span class="opico tabla">' + ICO_T + '</span><span><b>Importar tabla de planificación</b><i>Importar planificaciones de proyectos a largo plazo (Primavera P6 o Microsoft Project)</i></span></button><button class="opacc" id="opNuevo"><span class="opico plan">' + ICO_P + '</span><span><b>Crear nuevo plan</b><i>Crear y administrar planes a corto plazo</i></span><em>+</em></button>' : '') + '<span class="crece"></span><button class="enlace" id="opCfg">☰ Configuración ▾</button></div>' +
      '<div class="opbarra"><div class="opchips">' + [['todo', 'Todo'], ['tablas', 'Tablas de planificación'], ['planes', 'Planes']].map(f => '<button data-f="' + f[0] + '" class="' + (PL.filtro === f[0] ? 'activa' : '') + '">' + f[1] + '</button>').join('') + '</div><label class="opsw"><input type="checkbox" id="opAgr"' + (PL.agrupar ? ' checked' : '') + '><i></i> Agrupar líneas de tiempo conectadas</label><span class="crece"></span>' +
      '<select id="opOrd" title="Ordenar">' + [['creado', 'Fecha de creación'], ['nombre', 'Nombre'], ['inicio', 'Fecha de inicio'], ['avance', 'Avance']].map(o => '<option value="' + o[0] + '"' + (PL.orden === o[0] ? ' selected' : '') + '>⇅ ' + o[1] + '</option>').join('') + '</select><div class="obvistas"><button data-v="tarjetas" class="' + (PL.vista === 'tarjetas' ? 'activa' : '') + '" title="Tarjetas">▦</button><button data-v="lista" class="' + (PL.vista === 'lista' ? 'activa' : '') + '" title="Lista">☰</button></div></div>' +
      '<h2 class="optit">Planificaciones (' + L.length + ')</h2>' +
      (L.length ? (PL.vista === 'lista' ? '<div class="acctabla"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Origen</th><th>Inicio</th><th>Fin</th><th class="num">Actividades</th><th class="num">Avance</th><th class="num">Críticas</th><th>Línea de tiempo</th><th>Creado por</th><th>Creación</th></tr></thead><tbody>' + L.map(fila).join('') + '</tbody></table></div>' : '<div class="opgrid">' + L.map(carta).join('') + '</div>')
        : '<div class="opvacio">' + ICO_T + '<b>No hay líneas de tiempo para mostrar</b><span>' + (T.length ? 'Ninguna planificación coincide con el filtro.' : 'Aún no tiene ninguna tabla de planificación o ningún plan visible') + '</span>' + (d.puedoEditar && !T.length ? '<div><a href="#" id="opImp2">Importar tabla de planificación</a> o <a href="#" id="opNuevo2">Crear nuevo plan</a></div>' : '') + '<button id="opEj">⭳ Descargar archivo de ejemplo</button></div>') + '</div>' + N.cierra();
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = (e) => { e.preventDefault(); fn(e); }; };
    on('opImp', () => ventanaImportar(p, recarga)); on('opImp2', () => ventanaImportar(p, recarga));
    const nuevo = async () => { const n = await N.pide('Crear nuevo plan', 'Nombre del plan (por ejemplo «Plan de 3 semanas · estructuras»)', '', 'Crear'); if (!n || !n.trim()) return; try { const r = await api(O(pid) + '/planes', { json: { tipo: 'plan', nombre: n.trim(), tareas: [] } }); location.hash = '#/p/' + pid + '/obra/planificacion/' + r.id; } catch (e) { N.toast(esc(e.message), 'mal'); } };
    on('opNuevo', nuevo); on('opNuevo2', nuevo); on('opEj', ejemplo);
    on('opCfg', (e) => N.menuFlotante(document.getElementById('opCfg'), [{ texto: (PL.critica ? '✓ ' : '') + 'Resaltar la ruta crítica en el Gantt', accion: () => { PL.critica = !PL.critica; } }, { sep: true }, { texto: 'Descargar archivo de ejemplo (XML de Project)', accion: ejemplo }, { texto: 'Formatos que se importan: .xer y .xml de Primavera P6; .xml y .mpx de Microsoft Project; Excel' }]));
    app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { PL.filtro = b.dataset.f; recarga(); });
    app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { PL.vista = b.dataset.v; recarga(); });
    document.getElementById('opAgr').onchange = (e) => { PL.agrupar = e.target.checked; recarga(); };
    document.getElementById('opOrd').onchange = (e) => { PL.orden = e.target.value; recarga(); };
    app.querySelectorAll('[data-pl]').forEach(c => c.onclick = () => { location.hash = '#/p/' + pid + '/obra/planificacion/' + c.dataset.pl; });
  };

  function ventanaImportar(p, luego) {
    const pid = p.id, v = N.ventana('Importar tabla de planificación', '<div class="opzona" id="oiZona"><b>Arrastra aquí el archivo de planificación</b><span>o</span><button class="primario" id="oiEl">Elegir archivo…</button><input type="file" id="oiF" accept=".xer,.xml,.mpx,.mpp,.xlsx,.xlsm,.xls,.csv" style="display:none"><div class="pista">Primavera P6: <b>.xer</b> o <b>.xml</b> · Microsoft Project: <b>.xml</b> o <b>.mpx</b> · Excel con columnas de actividad, inicio y fin</div></div>' +
      '<details class="opcde" id="oiCde"><summary>O elegir un cronograma que ya está en Documentos de proyecto</summary><div id="oiLista" class="obdisp" style="max-height:170px"><div class="pista" style="padding:12px">Cargando…</div></div></details><div id="oiPrev"></div><div id="oiMsg"></div>', { ancho: 680, alto: 600 });
    const g = (i) => v.querySelector('#' + i); let leido = null, archivo = '';
    const procesa = async (nombre, buf) => { g('oiMsg').innerHTML = ''; g('oiPrev').innerHTML = '<div class="pista" style="padding:12px">Leyendo ' + esc(nombre) + '…</div>'; leido = null;
      try { const r = await leeCronograma(nombre, buf); leido = r; archivo = nombre;
        g('oiPrev').innerHTML = '<div class="opprev"><div class="opcdat"><div><span>Origen</span><b>' + FORM[r.formato] + '</b></div><div><span>Actividades</span><b>' + r.n + '</b></div><div><span>Bandas (EDT / WBS)</span><b>' + r.bandas + '</b></div><div><span>Inicio</span><b>' + dTxt(r.ini) + '</b></div><div><span>Fin</span><b>' + dTxt(r.fin) + '</b></div><div><span>Vínculos</span><b>' + r.vinculos + '</b></div><div><span>Críticas</span><b>' + (r.conHolgura ? r.criticas : '—') + '</b></div></div>' + (r.conHolgura ? '' : '<div class="pista">El archivo no trae holgura ni vínculos: se verá el Gantt, sin ruta crítica.</div>') +
          '<label style="margin-top:10px">Nombre de la tabla de planificación</label><input id="oiNom" value="' + esc(nombre.replace(/\.[^.]+$/, '')) + '"><div class="fila" style="justify-content:flex-end;margin-top:12px"><button class="primario" id="oiOk">Importar</button></div></div>';
        g('oiOk').onclick = async () => { const b = g('oiOk'); b.disabled = true; b.textContent = 'Importando…'; try { const x = await api(O(pid) + '/planes', { json: { tipo: 'tabla', nombre: g('oiNom').value.trim() || nombre, formato: leido.formato, archivo, tareas: leido.tareas } }); cierraV(v); N.toast('Tabla de planificación importada: ' + x.actividades + ' actividades.', 'bien'); location.hash = '#/p/' + pid + '/obra/planificacion/' + x.id; } catch (e) { b.disabled = false; b.textContent = 'Importar'; aviso(g('oiMsg'), e); } };
      } catch (e) { g('oiPrev').innerHTML = ''; aviso(g('oiMsg'), e); } };
    g('oiEl').onclick = () => g('oiF').click();
    g('oiF').onchange = async (e) => { const f = e.target.files[0]; if (f) procesa(f.name, await f.arrayBuffer()); e.target.value = ''; };
    const z = g('oiZona'); z.ondragover = (e) => { e.preventDefault(); z.classList.add('sobre'); }; z.ondragleave = () => z.classList.remove('sobre');
    z.ondrop = async (e) => { e.preventDefault(); z.classList.remove('sobre'); const f = e.dataTransfer.files[0]; if (f) procesa(f.name, await f.arrayBuffer()); };
    g('oiCde').ontoggle = async () => { if (!g('oiCde').open || g('oiCde').dataset.ok) return; g('oiCde').dataset.ok = 1;
      try { const d = await api(O(pid) + '/planes?disponibles=1'), Lc = d.disponibles || [];
        g('oiLista').innerHTML = Lc.length ? Lc.map((x, i) => '<a href="#" class="obdfila opdoc" data-i="' + i + '"><span class="mono">' + esc(x.archivo) + '</span><span class="pista">' + esc(x.carpeta) + ' · V' + x.n + ' · ' + tam(x.tamano) + '</span></a>').join('') : '<div class="pista" style="padding:12px">No hay archivos .xer, .xml ni .mpx en Documentos de proyecto.</div>';
        g('oiLista').querySelectorAll('[data-i]').forEach(a => a.onclick = async (e) => { e.preventDefault(); const x = Lc[+a.dataset.i]; try { const r = await fetch('/api/proyectos/' + pid + '/versiones/' + x.version_id + '/descargar'); if (!r.ok) throw new Error('No se pudo abrir el archivo (' + r.status + ').'); procesa(x.archivo, await r.arrayBuffer()); } catch (er) { aviso(g('oiMsg'), er); } });
      } catch (e) { aviso(g('oiLista'), e); } };
  }

  // ═════════ una planificación: su Gantt ═════════
  async function vistaPlan(p, res, plid) {
    const pid = p.id; let d; try { d = await api(O(pid) + '/planes/' + plid); } catch (e) { location.hash = '#/p/' + pid + '/obra/planificacion'; return; }
    const esPlan = d.tipo === 'plan', ed = d.puedoEditar, T = d.tareas, cerr = new Set(), S = { sel: -1 };
    if (T.length > 600) T.forEach((t, i) => { if (t.resumen && t.nivel >= 2) cerr.add(i); });
    const guarda = async () => { try { await api(O(pid) + '/planes/' + plid, { method: 'PUT', json: { tareas: T } }); } catch (e) { N.toast(esc(e.message), 'mal'); } };
    const recarga = () => vistaPlan(p, res, plid);
    app.innerHTML = X.cabecera(p, 'planificacion', res) + '<div class="opg"><div class="opgbarra"><a class="boton mini" href="#/p/' + pid + '/obra/planificacion">← Planificación</a><span class="opico ' + d.tipo + '">' + (esPlan ? ICO_P : ICO_T) + '</span><b class="opgnom">' + esc(d.nombre) + '</b><span class="pista">' + (esPlan ? 'Plan' + (d.tabla ? ' · conectado a <a href="#/p/' + pid + '/obra/planificacion/' + d.tabla.id + '">' + esc(d.tabla.nombre) + '</a>' : '') : 'Tabla de planificación · ' + esc(d.formatoTxt || '') + (d.archivo ? ' · ' + esc(d.archivo) : '')) + '</span><span class="crece"></span>' +
      '<input id="pgQ" placeholder="Buscar actividad" value="' + esc(PL.q) + '" style="width:190px"><div class="obvistas">' + [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(z => '<button data-z="' + z[0] + '" class="' + (PL.zoom === z[0] ? 'activa' : '') + '">' + z[1] + '</button>').join('') + '</div><label class="rvchk" style="margin:0"><input type="checkbox" id="pgCr"' + (PL.critica ? ' checked' : '') + '> ruta crítica</label><button class="mini" id="pgHoy">Hoy</button><button class="mini" id="pgCol" title="Contraer o expandir todas las bandas">± Bandas</button>' + (esPlan && ed ? '<button class="primario mini" id="pgAdd">+ Actividad</button>' : '') + '<button class="mini" id="pgMas">⋯</button></div>' +
      '<div class="opgres" id="pgRes"></div><div class="opgantt" id="pgG"></div>' + (d.planes && d.planes.length ? '<div class="pista" style="margin-top:8px">Planes conectados: ' + d.planes.map(x => '<a href="#/p/' + pid + '/obra/planificacion/' + x.id + '">' + esc(x.nombre) + '</a>').join(' · ') + '</div>' : '') + '</div>' + N.cierra();
    const G = document.getElementById('pgG');
    function pinta() {
      const q = PL.q.toLowerCase(), H = T.filter(t => !t.resumen && t.ini && t.fin);
      // los contadores son filtros: al pulsar uno se listan sus actividades (sin bandas); otra vez, se quita
      const en30 = (() => { const x = new Date(); x.setDate(x.getDate() + 30); return x.toISOString().slice(0, 10); })();
      const FE = { act: ['Actividades', () => true], term: ['Terminadas', t => t.pct >= 100], curso: ['En curso', t => t.pct > 0 && t.pct < 100], sin: ['Sin iniciar', t => !(t.pct > 0)], atras: ['Atrasadas', t => t.pct < 100 && t.fin < hoy(), 1], prox: ['Empiezan en 30 días', t => !(t.pct > 0) && t.ini >= hoy() && t.ini <= en30], crit: ['Críticas', t => t.critica, 1] };
      if (PL.estado && !FE[PL.estado]) PL.estado = ''; const fe = PL.estado ? FE[PL.estado][1] : null;
      document.getElementById('pgRes').innerHTML = H.length ? '<span><i>Inicio</i> ' + dTxt(H.reduce((m, t) => !m || t.ini < m ? t.ini : m, '')) + '</span><span><i>Fin</i> ' + dTxt(H.reduce((m, t) => t.fin > m ? t.fin : m, '')) + '</span>' + Object.keys(FE).filter(k => k !== 'crit' || H.some(t => t.critica)).map(k => { const n = H.filter(FE[k][1]).length; return '<button class="opgfe' + (PL.estado === k ? ' activa' : '') + '" data-pf="' + k + '" title="Ver solo estas actividades"><i>' + FE[k][0] + '</i> <b' + (FE[k][2] && n ? ' style="color:var(--rojo)"' : '') + '>' + n + '</b></button>'; }).join('') + (PL.estado ? '<button class="mini" id="pgFx">Descargar esta lista</button><button class="mini" id="pgFq">Quitar filtro</button>' : '') : '';
      document.querySelectorAll('#pgRes [data-pf]').forEach(b => b.onclick = () => { PL.estado = PL.estado === b.dataset.pf ? '' : b.dataset.pf; pinta(); G.scrollTop = 0; });
      const fq = document.getElementById('pgFq'); if (fq) fq.onclick = () => { PL.estado = ''; pinta(); };
      const fx = document.getElementById('pgFx'); if (fx) fx.onclick = async () => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new(), LL = H.filter(fe); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['ID', 'Actividad', 'Inicio', 'Fin', '% avance', 'Holgura (días)', 'Crítica', 'Atrasada', 'Responsable']].concat(LL.map(t => [t.id || '', t.nombre, t.ini, t.fin, Math.round(t.pct), t.holgura != null ? Math.round(t.holgura) : '', t.critica ? 'sí' : '', t.pct < 100 && t.fin < hoy() ? 'sí' : '', t.responsable || '']))), FE[PL.estado][0].slice(0, 30)); XL.writeFile(wb, 'cronograma-' + FE[PL.estado][0].toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '-') + '-' + hoy() + '.xlsx'); };
      if (!T.length) { G.innerHTML = '<div class="opvacio">' + ICO_P + '<b>Este plan aún no tiene actividades</b><span>Añade las actividades de las próximas semanas con su fecha de inicio y de fin.</span>' + (ed ? '<button class="primario" id="pgAdd2">+ Actividad</button>' : '') + '</div>'; const b = document.getElementById('pgAdd2'); if (b) b.onclick = () => edita(-1); return; }
      // filas visibles: se saltan las que cuelgan de una banda contraída; al buscar se muestran solo las coincidencias
      const vis = []; let salta = 0;
      T.forEach((t, i) => { if (q || fe) { if (!t.resumen && (!fe || (t.ini && t.fin && fe(t))) && (!q || (t.id + ' ' + t.nombre + ' ' + (t.responsable || '')).toLowerCase().includes(q))) vis.push(i); return; } if (salta && t.nivel > salta) return; salta = 0; vis.push(i); if (t.resumen && cerr.has(i)) salta = t.nivel; });
      const TOPE = 3000, V = vis.slice(0, TOPE), conF = T.filter(t => t.ini && t.fin);
      let a = aD(conF.reduce((m, t) => !m || t.ini < m ? t.ini : m, '') || hoy()), b = aD(conF.reduce((m, t) => t.fin > m ? t.fin : m, '') || hoy());
      a = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 7); b = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 14);
      const nd = dias(a, b) + 1, W = PL.zoom === 'dia' ? 26 : PL.zoom === 'semana' ? 9 : 3, ancho = nd * W;
      let meses = '', sub = '', fondo = '';
      for (let i = 0; i < nd;) { const x = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), n = Math.min(nd - i, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate() - x.getDate() + 1); meses += '<div style="left:' + (i * W) + 'px;width:' + (n * W) + 'px">' + (n * W > 90 ? MESL[x.getMonth()] + ' ' + x.getFullYear() : n * W > 34 ? MES[x.getMonth()] + ' ' + String(x.getFullYear()).slice(2) : '') + '</div>'; i += n; }
      for (let i = 0; i < nd; i++) { const x = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), dw = x.getDay(); if (W >= 20) sub += '<div style="left:' + (i * W) + 'px;width:' + W + 'px">' + x.getDate() + '</div>'; else if (W >= 8 && dw === 1) sub += '<div style="left:' + (i * W) + 'px;width:' + (7 * W) + 'px">' + x.getDate() + '</div>'; if (W >= 8 && (dw === 0 || dw === 6)) fondo += '<i style="left:' + (i * W) + 'px;width:' + W + 'px"></i>'; else if (W < 8 && x.getDate() === 1) fondo += '<i class="lm" style="left:' + (i * W) + 'px"></i>'; }
      const xh = dias(a, aD(hoy())) * W + W / 2, hoyDentro = xh >= 0 && xh <= ancho;
      const fila = (i) => { const t = T[i], x0 = t.ini ? dias(a, aD(t.ini)) * W : 0, w = t.ini && t.fin ? (dias(aD(t.ini), aD(t.fin)) + 1) * W : 0, cr = PL.critica && t.critica, atras = !t.resumen && t.pct < 100 && t.fin && t.fin < hoy();
        return '<div class="opgf' + (t.resumen ? ' res' : '') + (i === S.sel ? ' sel' : '') + '" data-i="' + i + '"><div class="opgn" style="padding-left:' + (8 + (t.nivel - 1) * 14) + 'px">' + (t.resumen ? '<a class="opgcar" data-c="' + i + '">' + (cerr.has(i) ? '▸' : '▾') + '</a>' : '<span class="opgcar"></span>') + '<span title="' + esc(t.nombre) + '">' + (t.id && !t.resumen ? '<em>' + esc(t.id) + '</em> ' : '') + esc(t.nombre) + '</span></div><div class="opgc">' + (t.ini ? dTxt(t.ini) : '') + '</div><div class="opgc">' + (t.fin ? dTxt(t.fin) : '') + '</div><div class="opgc n">' + (t.ini ? Math.round(t.pct) + ' %' : '') + '</div>' +
          '<div class="opgb" style="width:' + ancho + 'px">' + (w ? (t.resumen ? '<b class="opgr" style="left:' + x0 + 'px;width:' + w + 'px"><u style="width:' + t.pct + '%"></u></b>' : t.ini === t.fin && esHito(t) ? '<b class="opgh' + (cr ? ' cr' : '') + '" style="left:' + (x0 + W / 2) + 'px"></b>' : '<b class="opga' + (cr ? ' cr' : '') + (atras ? ' at' : '') + (t.pct >= 100 ? ' ok' : '') + '" style="left:' + x0 + 'px;width:' + Math.max(3, w) + 'px" title="' + esc(t.nombre + ' · ' + dTxt(t.ini) + ' → ' + dTxt(t.fin) + ' · ' + Math.round(t.pct) + ' %' + (t.holgura != null ? ' · holgura ' + Math.round(t.holgura / 8 * 10) / 10 + ' d' : '')) + '"><u style="width:' + t.pct + '%"></u></b>' + (W >= 8 && t.responsable ? '<span class="opgt" style="left:' + (x0 + w + 6) + 'px">' + esc(corto(t.responsable)) + '</span>' : '')) : '') + '</div></div>'; };
      const esHito = (t) => /hito|milestone/i.test(t.nombre) || t.dur0;
      G.innerHTML = '<div class="opgcab"><div class="opgn"><b>Actividad</b></div><div class="opgc"><b>Inicio</b></div><div class="opgc"><b>Fin</b></div><div class="opgc n"><b>%</b></div><div class="opgb opgesc" style="width:' + ancho + 'px"><div class="obgmes">' + meses + '</div><div class="obgdia">' + sub + '</div></div></div>' +
        '<div class="opgcu"><div class="opgfondo" style="width:' + ancho + 'px">' + fondo + (hoyDentro ? '<s style="left:' + xh + 'px" title="Hoy"></s>' : '') + '</div>' + (V.map(fila).join('') || '<div class="pista" style="padding:16px">Ninguna actividad coincide.</div>') + '</div>' + (vis.length > TOPE ? '<div class="pista" style="padding:8px 12px">Se muestran ' + TOPE + ' de ' + vis.length + ' filas. Contrae bandas o busca para ver el resto.</div>' : '');
      G.querySelectorAll('[data-c]').forEach(c => c.onclick = (e) => { e.stopPropagation(); const i = +c.dataset.c, y = G.scrollTop, x = G.scrollLeft; cerr.has(i) ? cerr.delete(i) : cerr.add(i); pinta(); G.scrollTop = y; G.scrollLeft = x; });
      G.querySelectorAll('.opgf').forEach(f => f.onclick = () => { S.sel = +f.dataset.i; G.querySelectorAll('.opgf.sel').forEach(z => z.classList.remove('sel')); f.classList.add('sel'); detalle(+f.dataset.i); });
      // «Hoy» centra la fecha actual; si la planificación es de otra época, va a su inicio o a su final
      G._irHoy = () => { G.scrollLeft = hoyDentro ? Math.max(0, xh - (G.clientWidth - 620) / 2) : (xh < 0 ? 0 : G.scrollWidth); };
    }
    /** Ficha de una actividad: fechas, avance, holgura, vínculos y paso a tarea de obra. */
    function detalle(i) {
      const t = T[i]; if (t.resumen && !esPlan) return;
      const suc = T.filter(x => (x.pred || []).some(v => v.id === t.id) && t.id), nomDe = (id) => (T.find(x => x.id === id && !x.resumen) || {}).nombre || id;
      document.querySelectorAll('.ventana[data-opa]').forEach(x => x.remove());
      const v = N.ventana('Actividad' + (t.id ? ' ' + t.id : ''), '<div class="opdet"><b style="font-size:15px">' + esc(t.nombre) + '</b>' + (PL.critica && t.critica ? ' <span class="obchip" style="--c:#d92d20">Ruta crítica</span>' : '') +
        '<div class="opcdat" style="margin:12px 0"><div><span>Inicio</span><b>' + dTxt(t.ini) + '</b></div><div><span>Fin</span><b>' + dTxt(t.fin) + '</b></div><div><span>Duración</span><b>' + (t.ini && t.fin ? dias(aD(t.ini), aD(t.fin)) + 1 + ' d' : '—') + '</b></div><div><span>Holgura total</span><b>' + (t.holgura == null ? '—' : Math.round(t.holgura / 8 * 10) / 10 + ' d') + '</b></div></div>' +
        '<div class="obattr"><label>Avance (%)</label><input type="number" min="0" max="100" step="1" id="odPct" value="' + Math.round(t.pct) + '"' + (ed ? '' : ' disabled') + '></div><div class="obattr"><label>Responsable</label><input id="odResp" value="' + esc(t.responsable || '') + '"' + (ed ? '' : ' disabled') + '></div>' +
        '<h3>Predecesoras</h3>' + ((t.pred || []).map(x => '<div class="opvin"><em>' + x.tipo + (x.lag ? ' ' + esc(x.lag) : '') + '</em> ' + esc(x.id) + ' · ' + esc(nomDe(x.id)) + '</div>').join('') || '<span class="pista">Ninguna.</span>') + '<h3>Sucesoras</h3>' + (suc.map(x => '<div class="opvin">' + esc(x.id) + ' · ' + esc(x.nombre) + '</div>').join('') || '<span class="pista">Ninguna.</span>') +
        '<div class="fila" style="gap:8px;margin-top:16px;flex-wrap:wrap">' + (t.tarea_id ? '<button id="odVer">Abrir su tarea de obra</button>' : (ed && !t.resumen ? '<button class="primario" id="odTar" title="Crea una tarea de obra con estas fechas, para asignarla, ponerla en un plano y seguirla con fotos">Crear tarea de obra</button>' : '')) + (esPlan && ed ? '<button id="odEd">Editar</button><button id="odDel">Suprimir</button>' : '') + '</div></div>', { ancho: 520, alto: 560 });
      v.closest('.ventana').dataset.opa = 1; const g = (k) => v.querySelector('#' + k);
      if (ed) { g('odPct').onchange = async () => { t.pct = Math.min(100, Math.max(0, Number(g('odPct').value) || 0)); await guarda(); const y = G.scrollTop, x = G.scrollLeft; pinta(); G.scrollTop = y; G.scrollLeft = x; }; g('odResp').onchange = async () => { t.responsable = g('odResp').value.trim(); await guarda(); pinta(); }; }
      if (g('odTar')) g('odTar').onclick = async () => { try { const n = await api(O(pid) + '/tareas', { json: { titulo: t.nombre, estado: 'p2', inicio: t.ini, fin: t.fin, etiquetas: [d.nombre] } }); t.tarea_id = n.id; await guarda(); cierraV(v); N.toast('Tarea de obra creada con las fechas de la actividad.', 'bien'); X.abreTarea(pid, n.id, null, true); } catch (e) { N.toast(esc(e.message), 'mal'); } };
      if (g('odVer')) g('odVer').onclick = () => { cierraV(v); X.abreTarea(pid, t.tarea_id, null); };
      if (g('odEd')) g('odEd').onclick = () => { cierraV(v); edita(i); };
      if (g('odDel')) g('odDel').onclick = async () => { if (!confirm('¿Suprimir la actividad «' + t.nombre + '»?')) return; T.splice(i, 1); T.forEach(x => { x.pred = (x.pred || []).filter(z => z.id !== t.id); }); ruta(); await guarda(); cierraV(v); S.sel = -1; pinta(); };
    }
    /** Alta o edición de una actividad de un plan de corto plazo. */
    function edita(i) {
      const t = i >= 0 ? T[i] : { id: '', nombre: '', ini: hoy(), fin: hoy(), pct: 0, nivel: 1, resumen: false, pred: [], responsable: '' };
      const v = N.ventana(i >= 0 ? 'Editar actividad' : 'Nueva actividad', '<label>Actividad</label><input id="eaN" value="' + esc(t.nombre) + '" placeholder="Vaciado de losa del sector B"><div class="fila" style="gap:8px;margin-top:8px"><div style="flex:1"><label>Inicio</label><input type="date" id="eaI" value="' + esc(t.ini) + '"></div><div style="flex:1"><label>Fin</label><input type="date" id="eaF" value="' + esc(t.fin) + '"></div><div style="width:90px"><label>Avance %</label><input type="number" min="0" max="100" id="eaP" value="' + Math.round(t.pct) + '"></div></div>' +
        '<label style="margin-top:8px">Responsable</label><input id="eaR" value="' + esc(t.responsable || '') + '" placeholder="Cuadrilla, subcontratista o persona"><label style="margin-top:8px">Va después de (predecesora)</label><select id="eaPr"><option value="">(ninguna)</option>' + T.filter((x, k) => k !== i && !x.resumen).map(x => '<option value="' + esc(x.id) + '"' + ((t.pred || []).some(z => z.id === x.id) ? ' selected' : '') + '>' + esc(x.id + ' · ' + x.nombre) + '</option>').join('') + '</select>' +
        '<label class="rvchk" style="margin-top:10px"><input type="checkbox" id="eaG"' + (t.resumen ? ' checked' : '') + '> Es un título de grupo (las actividades siguientes cuelgan de él)</label><div id="eaM"></div><div class="fila" style="justify-content:flex-end;margin-top:12px"><button class="primario" id="eaOk">' + (i >= 0 ? 'Guardar' : 'Añadir') + '</button></div>', { ancho: 520, alto: 470 });
      const g = (k) => v.querySelector('#' + k); g('eaN').focus();
      g('eaOk').onclick = async () => { const nom = g('eaN').value.trim(), grupo = g('eaG').checked; if (!nom) return aviso(g('eaM'), new Error('Escribe el nombre de la actividad.')); if (!grupo && (!g('eaI').value || !g('eaF').value || g('eaF').value < g('eaI').value)) return aviso(g('eaM'), new Error('Revisa las fechas: el fin no puede ser anterior al inicio.'));
        Object.assign(t, { nombre: nom, ini: grupo ? '' : g('eaI').value, fin: grupo ? '' : g('eaF').value, pct: Math.min(100, Math.max(0, Number(g('eaP').value) || 0)), responsable: g('eaR').value.trim(), resumen: grupo, nivel: grupo ? 1 : (T.some(x => x.resumen) ? 2 : 1), pred: g('eaPr').value ? [{ id: g('eaPr').value, tipo: 'FS', lag: '' }] : [] });
        if (i < 0) { t.id = 'A' + String((T.reduce((m, x) => Math.max(m, parseInt(String(x.id).replace(/\D/g, ''), 10) || 0), 0) + 10)).padStart(3, '0'); T.push(t); }
        ruta(); await guarda(); cierraV(v); pinta(); };
    }
    /** En un plan propio: grupos con el rango de lo suyo y ruta crítica por vínculos. */
    function ruta() {
      if (!esPlan) return;
      T.forEach((t, i) => { if (!t.resumen) return; let a = '', b = '', dur = 0, av = 0; for (let k = i + 1; k < T.length && !T[k].resumen; k++) { const x = T[k]; if (!x.ini) continue; if (!a || x.ini < a) a = x.ini; if (x.fin > b) b = x.fin; const dd = dias(aD(x.ini), aD(x.fin)) + 1; dur += dd; av += dd * x.pct; } t.ini = a; t.fin = b; t.pct = dur ? Math.round(av / dur) : 0; });
      const A = T.filter(t => !t.resumen && t.ini && t.fin); if (!A.some(t => (t.pred || []).length)) { A.forEach(t => { t.critica = false; t.holgura = null; }); return; }
      // ruta critica en dias habiles (lunes a viernes): un fin de semana entre dos actividades no es holgura
      const BASE = new Date(2024, 0, 1), habil = (s, esFin) => { const d = Math.round((aD(s) - BASE) / 864e5), sem = Math.floor(d / 7), r = ((d % 7) + 7) % 7; return sem * 5 + (r < 5 ? r : (esFin ? 4 : 5)); };
      const H = new Map(A.map(t => [t.id, { t, es: habil(t.ini, false), ef: habil(t.fin, true), suc: [] }]));
      H.forEach(x => (x.t.pred || []).forEach(v => { const pr = H.get(v.id); if (pr) pr.suc.push(x); }));
      const fin = Math.max(...[...H.values()].map(x => x.ef)), memo = new Map();
      const lf = (x) => { if (memo.has(x)) return memo.get(x); memo.set(x, fin); let v = fin; x.suc.forEach(s => { v = Math.min(v, lf(s) - (s.ef - s.es) - 1); }); memo.set(x, v); return v; };
      H.forEach(x => { const h = Math.max(0, lf(x) - x.ef); x.t.holgura = h * 8; x.t.critica = h <= 0; });
    }
    const on = (k, fn) => { const el = document.getElementById(k); if (el) el.onclick = fn; };
    app.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { PL.zoom = b.dataset.z; app.querySelectorAll('[data-z]').forEach(z => z.classList.toggle('activa', z === b)); pinta(); G._irHoy && G._irHoy(); });
    document.getElementById('pgCr').onchange = (e) => { PL.critica = e.target.checked; pinta(); };
    document.getElementById('pgQ').oninput = (e) => { PL.q = e.target.value; pinta(); };
    on('pgHoy', () => G._irHoy && G._irHoy()); on('pgAdd', () => edita(-1));
    on('pgCol', () => { const B = T.map((t, i) => t.resumen ? i : -1).filter(i => i >= 0); if (B.some(i => !cerr.has(i) && T[i].nivel >= 2) || (!cerr.size && B.length)) B.forEach(i => { if (T[i].nivel >= 2 || T.every(t => t.nivel <= 1 || !t.resumen)) cerr.add(i); }); else cerr.clear(); pinta(); });
    on('pgMas', () => N.menuFlotante(document.getElementById('pgMas'), [{ texto: 'Exportar a Excel', accion: async () => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Id', 'Actividad', 'Nivel', 'Grupo', 'Inicio', 'Fin', 'Avance %', 'Holgura (días)', 'Crítica', 'Predecesoras', 'Responsable']].concat(T.map(t => [t.id, t.nombre, t.nivel, t.resumen ? 'Sí' : '', t.ini, t.fin, t.pct, t.holgura == null ? '' : Math.round(t.holgura / 8 * 10) / 10, t.critica ? 'Sí' : '', (t.pred || []).map(v => v.id + ' ' + v.tipo + (v.lag || '')).join('; '), t.responsable || '']))), 'Planificación'); XL.writeFile(wb, 'planificacion-' + d.nombre.replace(/[^\w áéíóúñÁÉÍÓÚÑ-]+/g, ' ').trim().replace(/\s+/g, '-') + '.xlsx'); } },
      { texto: 'Cambiar nombre', off: ed ? false : 'Sin permiso', accion: async () => { const n = await N.pide('Cambiar nombre', 'Nombre', d.nombre, 'Guardar'); if (!n || !n.trim()) return; try { await api(O(pid) + '/planes/' + plid, { method: 'PUT', json: { nombre: n.trim() } }); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } } }]
      .concat(esPlan && ed ? [{ texto: d.tabla ? 'Cambiar la tabla de planificación conectada' : 'Conectar con una tabla de planificación', accion: async () => { const Lt = (await api(O(pid) + '/planes')).planes.filter(x => x.tipo === 'tabla'); if (!Lt.length) return N.toast('Aún no hay tablas de planificación importadas.', 'mal');
        const w = N.ventana('Conectar con una tabla de planificación', '<p class="pista" style="margin-top:0">El plan de corto plazo queda agrupado bajo la planificación de largo plazo a la que responde.</p><select id="ctS"><option value="">(sin conectar)</option>' + Lt.map(x => '<option value="' + x.id + '"' + (d.tabla_id === x.id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('') + '</select><div class="fila" style="justify-content:flex-end;margin-top:12px"><button class="primario" id="ctOk">Guardar</button></div>', { ancho: 460, alto: 230 });
        w.querySelector('#ctOk').onclick = async () => { try { await api(O(pid) + '/planes/' + plid, { method: 'PUT', json: { tabla_id: w.querySelector('#ctS').value } }); cierraV(w); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } }; } }] : [])
      .concat(d.puedoBorrar ? [{ sep: true }, { texto: 'Suprimir', peligro: true, accion: async () => { if (!confirm('¿Suprimir «' + d.nombre + '»? Las tareas de obra creadas desde ella se conservan.')) return; try { await api(O(pid) + '/planes/' + plid, { method: 'DELETE' }); location.hash = '#/p/' + pid + '/obra/planificacion'; } catch (e) { N.toast(esc(e.message), 'mal'); } } }] : [])));
    pinta(); if (G._irHoy) G._irHoy();
  }
})();
