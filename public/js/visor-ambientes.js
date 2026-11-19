/*
 * NIVELES / AMBIENTES y FLUJOS HOSPITALARIOS del visor del CDE (v0.5), como en el Visor BIM Federado.
 *
 * NIVELES / AMBIENTES: los ambientes del modelo (Habitaciones, Rooms, Spaces del indice: /ambientes) agrupados por nivel
 * con su numero, nombre, area, UPS/UPSS (CGM_Subdepartamento) y codigo; buscador; "Ver ambientes" (vidrio: vienen opacos
 * de Revit y el visor los oculta por defecto); clic en uno lo ABRE: se aisla el ambiente (vidrio) con lo que contiene,
 * con la regla del visor (focusRoom / elementsInRoom: nucleo encogido 5 cm, envolvente ampliada, 15 % de solape) y se
 * cuenta lo de adentro por categoria (barras que filtran); entorno oculto o atenuado; Excel/CSV de los ambientes.
 *
 * FLUJOS HOSPITALARIOS: la red ambientes-puertas con el nucleo LITERAL del visor (flujos-nucleo.js) sobre la geometria del
 * CDE: Ruta entre ambientes o UPSS (peaton / camilla), Relaciones entre UPSS (matriz y relaciones exigidas), Flujos
 * limpio / sucio, Distancia a la salida (salidas por cielo abierto con el rayo del visor), Planta 2D (huellas de los
 * ambientes por nivel con el recorrido, puertas y salidas; PNG), Configuracion (gestor: relaciones, reglas, maximos,
 * salidas a mano; se guarda en el proyecto para todo el equipo) y Excel de 5 hojas.
 * Convencion: el nucleo trabaja con z vertical (Revit); la escena del CDE tiene y vertical: aRev / aEsc convierten.
 */
import * as N from './flujos-nucleo.js';

export function monta(V) {
  const { THREE, esc, api, num, ventana, barras, panel, PID, hexLin, f3 } = V;
  const $ = (id) => document.getElementById(id);
  const descarga = (nombre, contenido, tipo) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], { type: tipo || 'text/csv;charset=utf-8' })); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const csvDe = (filas) => '﻿' + filas.map(f => f.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const excel = (hojas, nombre) => { if (!window.XLSX) { alert('La librería de Excel no cargó; usa CSV.'); return; } const wb = XLSX.utils.book_new(); for (const [n, filas] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n.slice(0, 31)); XLSX.writeFile(wb, nombre); };
  const actual = () => V.LISTA.find(l => l.vid === V.VID);
  const nombreProy = () => ($('proyectoNombre').textContent || 'proyecto').replace(/[^\w.-]+/g, '_').slice(0, 50);
  // caja de la escena [minx,miny,minz,maxx,maxy,maxz] (y arriba) -> caja de Revit { x1,y1,z1,x2,y2,z2 } (z arriba)
  const aRev = (c) => c ? { x1: c[0], y1: -c[5], z1: c[1], x2: c[3], y2: -c[2], z2: c[4] } : null;
  const pEsc = (p) => new THREE.Vector3(p.x, p.z, -p.y);   // punto Revit -> escena
  const areaNum = (s) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(s || '').replace(/\s/g, '')); return m ? parseFloat(m[0].replace(',', '.')) : 0; };

  // =====================================================================================================================
  // NIVELES / AMBIENTES
  // =====================================================================================================================
  const AM = { lista: null, q: '', abierto: null, entorno: 'oculto', ambPorE: new Map() };
  async function cargaAmbientes() { if (AM.lista) return AM.lista; const r = await api('/api/modelos/' + PID + '/' + V.VID + '/ambientes'); AM.lista = r.ambientes; AM.ambPorE = new Map(AM.lista.map(a => [a.e, a])); const c = $('cntAmb'); if (c) c.textContent = AM.lista.length ? num(AM.lista.length) : ''; return AM.lista; }
  V.alCargarModelo.push(() => { AM.lista = null; AM.abierto = null; cargaAmbientes().catch(() => {}); });
  V.MODULOS.ambientes = async () => {
    const c = panel('Niveles / Ambientes', '<div class="filab"><input id="amQ" placeholder="Buscar ambiente, nivel, UPSS…" value="' + esc(AM.q) + '"><label style="margin:0;display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" id="amVer"' + (V.MOSTRAR_AMB ? ' checked' : '') + ' style="width:auto"> ver ambientes</label></div>' +
      '<div class="filab"><select id="amEnt" style="width:auto"><option value="oculto"' + (AM.entorno === 'oculto' ? ' selected' : '') + '>Al abrir: ocultar el resto</option><option value="atenuado"' + (AM.entorno === 'atenuado' ? ' selected' : '') + '>Al abrir: atenuar el resto</option></select><button id="amCerrar" title="Volver a ver todo">Cerrar ambiente</button><button id="amXls">Excel</button><button id="amCsv">CSV</button></div>' +
      '<div id="amInfo"></div><div id="amLista" class="pista">Cargando…</div>');
    c.querySelector('#amQ').oninput = (e) => { AM.q = e.target.value; pintaAmb(); };
    c.querySelector('#amVer').onchange = (e) => { V.MOSTRAR_AMB = e.target.checked; };
    c.querySelector('#amEnt').onchange = (e) => { AM.entorno = e.target.value; if (AM.abierto) abreAmbiente(AM.abierto); };
    c.querySelector('#amCerrar').onclick = cierraAmbiente;
    c.querySelector('#amXls').onclick = () => excel([['Ambientes', tablaAmb()]], 'ambientes-' + nombreProy() + '.xlsx');
    c.querySelector('#amCsv').onclick = () => descarga('ambientes-' + nombreProy() + '.csv', csvDe(tablaAmb()));
    if (!V.G) { c.querySelector('#amLista').textContent = 'Carga un modelo.'; return; }
    try { await cargaAmbientes(); } catch (e) { c.querySelector('#amLista').textContent = e.message; return; }
    pintaAmb();
  };
  const etAmb = (a) => (a.num ? a.num + ' · ' : '') + a.nombre;
  function tablaAmb() { const G = V.G, C = V.cajasDe(G); return [['Nivel', 'Número', 'Nombre', 'Área', 'CGM_Area Inicial', 'CGM_Area Normativa', 'UPS/UPSS', 'Código', 'Id', 'Con geometría']].concat((AM.lista || []).map(a => [a.nivel, a.num, a.nombre, a.area, a.areaIni, a.areaNorma, a.subdep, a.cod, a.e, C.get(a.e) ? 'sí' : 'no'])); }
  function pintaAmb() {
    const l = $('amLista'); if (!l || !AM.lista) return;
    const q = AM.q.toLowerCase(), L = AM.lista.filter(a => !q || (a.nombre + ' ' + a.num + ' ' + a.nivel + ' ' + a.subdep + ' ' + a.cod).toLowerCase().includes(q));
    if (!AM.lista.length) { l.innerHTML = '<div class="aviso ambar">El modelo no trae ambientes (Habitaciones, Rooms, Spaces). Publica el modelo de arquitectura con sus habitaciones.</div>'; return; }
    let h = '', niv = null; const C = V.cajasDe(V.G);
    for (const a of L) {
      if (a.nivel !== niv) { niv = a.nivel; h += '<div class="grupo-fila" style="margin:8px 0 2px;color:var(--er-or);font-family:var(--er-f);font-variant:small-caps;letter-spacing:.1em">' + esc(niv || '(sin nivel)') + ' <span class="pista">' + L.filter(x => x.nivel === a.nivel).length + '</span></div>'; }
      h += '<div class="val' + (AM.abierto && AM.abierto.e === a.e ? ' on' : '') + '" data-e="' + a.e + '" style="' + (C.get(a.e) ? '' : 'opacity:.55') + (AM.abierto && AM.abierto.e === a.e ? ';background:rgba(200,162,74,.18)' : '') + '" title="' + esc(a.nombre + (a.subdep ? ' · ' + a.subdep : '') + (a.cod ? ' · ' + a.cod : '')) + '"><span>' + esc(etAmb(a)) + (a.subdep ? ' <span class="pista">' + esc(a.subdep) + '</span>' : '') + '</span><i>' + esc(a.area) + '</i></div>';
    }
    l.innerHTML = '<div class="pista" style="margin:2px 0">' + num(L.length) + ' de ' + num(AM.lista.length) + ' ambientes · clic abre el ambiente con lo que contiene</div>' + h;
    l.querySelectorAll('.val[data-e]').forEach(d => d.onclick = () => abreAmbiente(AM.ambPorE.get(+d.dataset.e)));
  }
  /** La regla del visor (elementsInRoom): nucleo (5 cm hacia dentro) basta con tocarlo; envolvente ampliada exige 15 % de solape del elemento. */
  function elementosEn(caja, skip, frac) {
    const C = V.cajasDe(V.G), need = frac || 0.15, w = caja[3] - caja[0], d = caja[5] - caja[2], hh = caja[4] - caja[1];
    const sh = (dim) => Math.min(0.05, dim * 0.2), mxy = Math.min(Math.max(Math.min(w, d) * 0.10, 0.05), 0.60), mz = Math.min(Math.max(hh * 0.15, 0.05), 0.80);
    const core = [caja[0] + sh(w), caja[1] + sh(hh), caja[2] + sh(d), caja[3] - sh(w), caja[4] - sh(hh), caja[5] - sh(d)], outer = [caja[0] - mxy, caja[1] - mz, caja[2] - mxy, caja[3] + mxy, caja[4] + mz, caja[5] + mxy];
    const out = [];
    for (const [e, b] of C) {
      if (!b || (skip && skip.has(e))) continue;
      if (Math.min(b[3], core[3]) > Math.max(b[0], core[0]) && Math.min(b[4], core[4]) > Math.max(b[1], core[1]) && Math.min(b[5], core[5]) > Math.max(b[2], core[2])) { out.push(e); continue; }
      const ox = Math.min(b[3], outer[3]) - Math.max(b[0], outer[0]); if (ox <= 0) continue;
      const oy = Math.min(b[4], outer[4]) - Math.max(b[1], outer[1]); if (oy <= 0) continue;
      const oz = Math.min(b[5], outer[5]) - Math.max(b[2], outer[2]); if (oz <= 0) continue;
      const ex = b[3] - b[0], ey = b[4] - b[1], ez = b[5] - b[2], rx = ex > 1e-6 ? ox / ex : 1, ry = ey > 1e-6 ? oy / ey : 1, rz = ez > 1e-6 ? oz / ez : 1;
      if (rx * ry * rz >= need) out.push(e);
    }
    return out;
  }
  function abreAmbiente(a) {
    const G = V.G, C = V.cajasDe(G), caja = C.get(a.e);
    if (!caja) { alert('Este ambiente no tiene geometría (volumen) en el modelo.'); return; }
    AM.abierto = a;
    const dentro = elementosEn(caja, G.ambientes, 0.15), set = new Set(dentro); set.add(a.e);
    if (AM.entorno === 'atenuado') { const T = new Map(), gris = hexLin('#8a8578'); for (const x of G.elem) if (!set.has(x.e) && !G.ambientes.has(x.e)) T.set(x.e, gris); T.set(a.e, hexLin('#5aa9e6')); V.TINTES = T; V.aplicaTintes(); V.muestraSolo(new Set([...G.elem.map(x => x.e).filter(e => !G.ambientes.has(e)), a.e]), false); V.encuadra(V.cajaDe(set)); }
    else { const T = new Map(); T.set(a.e, hexLin('#5aa9e6')); V.TINTES = T; V.aplicaTintes(); V.muestraSolo(set, true); }
    // lo que contiene, por categoria
    const cu = new Map(); for (const e of dentro) { const i = V.info(e); const k = i ? i.cat : '?'; cu.set(k, (cu.get(k) || 0) + 1); }
    const info = $('amInfo'); if (info) {
      info.innerHTML = '<div class="grupo"><h4>' + esc(etAmb(a)) + '<span class="hint">' + esc([a.nivel, a.subdep, a.area && 'área ' + a.area, a.cod].filter(Boolean).join(' · ')) + '</span></h4><div class="pista">' + num(dentro.length) + ' elementos dentro · clic en una barra los aísla</div><div id="amBarras"></div><div class="filab"><button id="amSel" title="Selecciona el ambiente para ver sus propiedades">Propiedades</button><button id="amInc">Incidencia</button></div></div>';
      const items = [...cu.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30);
      info.querySelector('#amBarras').innerHTML = barras(items, '', null);
      info.querySelectorAll('.barra[data-k]').forEach(b => b.onclick = () => { const s = new Set(dentro.filter(e => (V.info(e) || {}).cat === b.dataset.k)); s.add(a.e); V.muestraSolo(s, true); });
      info.querySelector('#amSel').onclick = () => { const k = G.porE.get(a.e); if (k != null) { V.selecciona(G.elem[k], false); } };
      info.querySelector('#amInc').onclick = () => V.nuevaIncidencia([a.e], { titulo: 'Ambiente ' + etAmb(a) + ': ' });
    }
    pintaAmb();
  }
  function cierraAmbiente() { AM.abierto = null; V.TINTES = new Map(); V.aplicaTintes(); V.muestraSolo(null, false); V.encuadra(); const i = $('amInfo'); if (i) i.innerHTML = ''; pintaAmb(); }
  V.alMostrarTodo.push(() => { AM.abierto = null; const i = $('amInfo'); if (i) i.innerHTML = ''; });

  // =====================================================================================================================
  // FLUJOS HOSPITALARIOS
  // =====================================================================================================================
  const BANDAS = [['Hasta la mitad del máximo', '#3fb950'], ['Hasta el máximo', '#e3a008'], ['Más que el máximo', '#f85149'], ['Sin camino a una salida', '#8b98a5']];
  const RELACIONES_PROPUESTAS = [['Emergencia', 'Diagnóstico por imágenes'], ['Emergencia', 'Centro quirúrgico'], ['Centro quirúrgico', 'Cuidados intensivos'], ['Centro obstétrico', 'Neonatología'], ['Centro quirúrgico', 'Central de esterilización'], ['Emergencia', 'Patología clínica']];
  const FL = { estado: 'nada', error: '', aviso: '', red: null, amb: [], pue: [], modo: 'peaton', ancho: 1.1, vanos: false, tab: 'ruta', A: '', B: '', ruta: null, rutaM: null, rutaF: null, cfg: null, puedeGuardar: false, matriz: null, gruposM: null, salida: null, fSal: -1, flujos: null, ventana: null, selM: '', pts: null, p2: { k: -1, esc: 1, tx: 0, ty: 0, color: 'upss' } };
  const etA = (i) => { const a = FL.amb[i]; return a ? (a.num ? a.num + ' · ' : '') + a.nombre + (a.nivel ? ' (' + a.nivel + ')' : '') : '?'; };
  const nombreSel = (sel) => sel.startsWith('u:') ? sel.slice(2) : sel.startsWith('a:') ? etA(+sel.slice(2)) : '';
  V.MODULOS.flujos = () => {
    panel('Flujos hospitalarios', '<p class="pista">El modelo del hospital como una red de ambientes y puertas: rutas (peatón / camilla), relaciones entre UPSS, flujos limpio / sucio, distancia a la salida y la planta 2D del recorrido. Se abre en una ventana grande.</p><div class="filab"><button class="primario" id="flAbrir">Abrir Flujos hospitalarios</button></div>');
    $('flAbrir').onclick = abreFlujos; if (V.G) abreFlujos();
  };
  function abreFlujos() {
    if (FL.ventana && document.body.contains(FL.ventana)) { FL.ventana.closest('.ventana').style.zIndex = 90; return; }
    FL.ventana = ventana('Flujos hospitalarios', '<div class="flcab filab" style="margin:0 0 6px"><button class="primario" data-fl="arma">Analizar el modelo</button><button data-fl="limpia" title="Quita el dibujo y el corte en planta">Limpiar</button><button data-fl="excel" disabled>Excel</button><span class="pista" id="flProg" style="flex:1"></span></div><div class="flcuerpo" style="overflow:auto;height:calc(100% - 40px)"></div>', { x: 220, y: 70, ancho: Math.min(1100, innerWidth - 240), alto: Math.min(700, innerHeight - 90), alCerrar: () => { FL.ventana = null; } });
    FL.ventana.querySelector('[data-fl="arma"]').onclick = () => armaRed().catch(e => { FL.error = e.message; pinta(); });
    FL.ventana.querySelector('[data-fl="limpia"]').onclick = () => { V.limpiaCapa(); V.quitaCortePlanta(); V.TINTES = new Map(); V.aplicaTintes(); FL.pts = null; };
    FL.ventana.querySelector('[data-fl="excel"]').onclick = excelFl;
    pinta();
    if (!FL.red && V.G) armaRed().catch(e => { FL.error = e.message; pinta(); });
  }
  const prog = (t) => { const p = $('flProg'); if (p) p.textContent = t; };
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  function reglasActuales() { const C = Object.assign({}, N.CLASES_DEF, (FL.cfg && FL.cfg.clases) || {}); const R = {}; for (const k in C) R[k] = N.flRegla(C[k]); return R; }
  /** ¿En qué ambiente cae un punto (Revit)? Por caja y, si el ambiente tiene huella (caras horizontales), por la huella; si varios, el más pequeño. */
  function huellaDe(i) {
    const a = FL.amb[i]; if (a.huella !== undefined) return a.huella;
    const G = V.G, k = G.porE.get(a.e); if (k == null) { a.huella = null; return null; }
    const T = V.triangulosDe(G.elem[k]), out = [];
    for (let q = 0; q + 8 < T.length; q += 9) {
      // escena (x, y arriba, z) -> Revit (x, -z): cara horizontal si su normal es casi vertical (eje y de la escena)
      const ax = T[q], ay = T[q + 1], az = T[q + 2], bx = T[q + 3], by = T[q + 4], bz = T[q + 5], cx = T[q + 6], cy = T[q + 7], cz = T[q + 8];
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const l = Math.hypot(nx, ny, nz); if (!l || Math.abs(ny) / l < 0.95) continue;
      out.push(ax, -az, bx, -bz, cx, -cz);
    }
    a.huella = out.length ? new Float64Array(out) : null; return a.huella;
  }
  function enTriangulos(T, x, y) {
    for (let i = 0; i + 5 < T.length; i += 6) { const ax = T[i], ay = T[i + 1], bx = T[i + 2], by = T[i + 3], cx = T[i + 4], cy = T[i + 5]; const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by), d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy), d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay); const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0; if (!(neg && pos)) return true; }
    return false;
  }
  function enAmbiente(p) {
    const t = 0.05; let mejor = -1, vol = Infinity, porHuella = false;
    for (let i = 0; i < FL.amb.length; i++) {
      const c = FL.amb[i].caja;
      if (p.x < c.x1 - t || p.x > c.x2 + t || p.y < c.y1 - t || p.y > c.y2 + t || p.z < c.z1 - t || p.z > c.z2 + t) continue;
      const H = huellaDe(i), dentro = H ? enTriangulos(H, p.x, p.y) : null;
      if (dentro === false) continue;
      const v = (c.x2 - c.x1) * (c.y2 - c.y1) * Math.max(1e-3, c.z2 - c.z1);
      if ((dentro && !porHuella) || ((!!dentro === porHuella) && v < vol)) { vol = v; mejor = i; porHuella = !!dentro; }
    }
    return mejor;
  }
  async function cargaCfg() { try { const d = await api('/api/proyectos/' + PID + '/flujos-hospitalarios'); FL.cfg = d.config || null; FL.puedeGuardar = !!d.puedeGuardar; if (FL.cfg && FL.cfg.anchoCamillaM > 0) FL.ancho = FL.cfg.anchoCamillaM; } catch (e) { FL.cfg = null; FL.puedeGuardar = false; } }
  async function guardaCfg(cambios) {
    const cfg = Object.assign({ relaciones: [], clases: {}, maxSalidaM: 0, anchoCamillaM: FL.ancho, salidasExcluidas: [], salidasExtra: [] }, FL.cfg || {}, cambios || {});
    try { const d = await api('/api/proyectos/' + PID + '/flujos-hospitalarios', { method: 'PUT', json: { config: cfg } }); FL.cfg = d.config; FL.aviso = 'Configuración guardada para todo el equipo.'; FL.error = ''; }
    catch (e) { FL.error = 'No se pudo guardar: ' + e.message; }
    pinta();
  }
  async function armaRed() {
    if (FL.estado === 'armando') return;
    if (!V.G) { FL.error = 'Carga un modelo primero.'; return pinta(); }
    FL.estado = 'armando'; FL.error = ''; FL.aviso = ''; FL.red = null; FL.ruta = null; FL.rutaM = null; FL.rutaF = null; FL.matriz = null; FL.salida = null; FL.flujos = null; FL.pts = null; pinta();
    try {
      await cargaCfg();
      const reglas = reglasActuales(), G = V.G, C = V.cajasDe(G);
      prog('Leyendo los ambientes…'); await espera(10);
      const lista = await cargaAmbientes();
      FL.amb = [];
      for (const r of lista.slice(0, 6000)) { const caja = aRev(C.get(r.e)); if (!caja) continue; const upss = String(r.subdep || '').trim(); FL.amb.push({ e: r.e, nombre: r.nombre, num: r.num, nivel: r.nivel, caja, upss: upss || N.flUpssPorNombre(r.nombre), upssInferida: !upss && !!N.flUpssPorNombre(r.nombre), clases: N.flClases(r.nombre, reglas), huella: undefined }); }
      if (!FL.amb.length) { FL.estado = 'listo'; FL.error = 'El modelo no tiene ambientes con geometría (habitaciones): publica el modelo de arquitectura con sus habitaciones.'; return pinta(); }
      prog('Buscando las puertas…'); await espera(10);
      const pu = await api('/api/modelos/' + PID + '/' + V.VID + '/puertas');
      FL.pue = [];
      for (const p of pu.puertas) { const caja = aRev(C.get(p.e)); if (!caja) continue; FL.pue.push({ e: p.e, caja, ancho: p.ancho || 0, anchoDe: p.anchoDe || '', nombre: p.nombre }); }
      if (!FL.pue.length) { FL.estado = 'listo'; FL.error = 'No encontré puertas con geometría en el índice (● Categoría = Puertas).'; return pinta(); }
      for (const p of FL.pue) if (!p.ancho) { p.ancho = N.flAnchoCaja(p.caja); p.anchoDe = 'su caja (incluye el marco)'; }
      prog('Uniendo ' + FL.amb.length + ' ambientes y ' + FL.pue.length + ' puertas…'); await espera(10);
      const red = N.flRed(FL.amb, FL.pue.map(p => ({ caja: p.caja, ancho: p.ancho, nombre: p.nombre })), enAmbiente, 1, { vanos: FL.vanos });
      red.centros = FL.amb.map(a => ({ x: (a.caja.x1 + a.caja.x2) / 2, y: (a.caja.y1 + a.caja.y2) / 2, z: a.caja.z1 + 1.0 }));
      FL.red = red;
      prog('Buscando las salidas…'); await espera(10);
      marcaSalidas();
      FL.estado = 'listo'; prog('');
    } catch (e) { FL.estado = 'listo'; FL.error = 'No se pudo armar la red: ' + e.message; console.warn('[flujos]', e); }
    pinta();
  }
  function marcaSalidas() {
    const R = FL.red, C = FL.cfg || {}, excl = new Set(C.salidasExcluidas || []), extra = new Set(C.salidasExtra || []);
    const exteriorAmb = (i) => i >= 0 && FL.amb[i].clases.indexOf('exterior') >= 0;
    for (const n of R.nodos) {
      if (n.tipo !== 'puerta') continue;
      const p = FL.pue[n.k]; let es = false, por = '';
      if (extra.has(p.e)) { es = true; por = 'marcada a mano'; }
      else if ((n.a < 0) !== (n.b < 0)) { const c = V.cieloAbierto(pEsc(n.fuera), 40); if (c) { es = true; por = 'da afuera (cielo abierto)'; } }
      else if (exteriorAmb(n.a) !== exteriorAmb(n.b)) { es = true; por = 'da a un ambiente exterior'; }
      if (es && excl.has(p.e)) { es = false; por = 'excluida a mano'; }
      n.salida = es; n.porSalida = por;
    }
  }
  const bloqueos = () => { if (FL.modo !== 'camilla') return [null, null]; const ancho = +FL.ancho || 0; return [(i) => { const n = FL.red.nodos[i]; return n.tipo === 'puerta' && ancho > 0 && n.ancho > 0 && n.ancho + 1e-6 < ancho; }, (e) => e.tipo === 'escalera']; };
  function grupos() { const m = new Map(); FL.amb.forEach((a, i) => { if (!a.upss) return; if (!m.has(a.upss)) m.set(a.upss, []); m.get(a.upss).push(i); }); return [...m].sort((a, b) => a[0].localeCompare(b[0], 'es')); }
  function ambientesDe(sel) { if (!sel) return []; if (sel.startsWith('a:')) return [+sel.slice(2)]; if (sel.startsWith('u:')) { const u = sel.slice(2); return FL.amb.map((a, i) => (a.upss === u ? i : -1)).filter(i => i >= 0); } return []; }
  function calculaRuta() {
    const A = ambientesDe(FL.A), B = ambientesDe(FL.B); if (!A.length || !B.length) { FL.error = 'Elige el origen y el destino.'; return pinta(); }
    const [bq, ba] = bloqueos(), r = N.flRuta(FL.red, A, B, FL.red.centros, bq, ba);
    FL.error = ''; FL.ruta = r ? Object.assign(r, { dM: r.d, de: FL.A, a: FL.B, modo: FL.modo }) : { nada: true, de: FL.A, a: FL.B, modo: FL.modo };
    pinta(); if (r) dibujaRutaFl(r, 0xc8a24a);
  }
  /** Los puntos (Revit) de una ruta: centro del origen, pasos, centro del destino. */
  function puntosDe(r) { const R = FL.red, pts = [R.centros[r.desde]].concat(r.nodos.map(n => R.nodos[n].p)); if (!r.aSalida && !r.aSalidaFlujo && r.hasta >= 0 && r.hasta !== r.desde) pts.push(R.centros[r.hasta]); return pts; }
  function dibujaRutaFl(r, color, salida) {
    const pts = puntosDe(r); FL.pts = { pts, r, color, salida };
    V.limpiaCapa(); V.dibujaRuta(pts.map(pEsc), color, { radio: 0.1, inicio: 0x5aa9e6, fin: salida ? 0x3fb950 : 0xe07a6a });
    // la seccion en planta del nivel del origen (1,50 m sobre el piso), mirando desde arriba y encuadrando el recorrido
    const niveles = N.flNivelesRuta(pts.map(p => p.z), 1, 1.5), k = N.flNivelDe(niveles, pts[0].z), nv = niveles[k];
    const b = new THREE.Box3(); for (const p of pts) b.expandByPoint(pEsc(p)); b.expandByScalar(3);
    if (nv) V.cortaPlanta(nv.corte, b); else V.vistaPlanta(b);
    FL.niveles = niveles; FL.nivelK = k;
    // el origen y el destino de color en el modelo
    const T = new Map(V.TINTES); for (const i of r.ambientes) { const a = FL.amb[i]; if (a) T.set(a.e, hexLin('#f0c66a')); }
    const a0 = FL.amb[r.desde], a1 = FL.amb[r.hasta]; if (a0) T.set(a0.e, hexLin('#5aa9e6')); if (a1 && !salida) T.set(a1.e, hexLin('#e07a6a'));
    V.TINTES = T; V.aplicaTintes();
    if (V.MOSTRAR_AMB !== true) { V.MOSTRAR_AMB = true; const ch = $('amVer'); if (ch) ch.checked = true; }
    pintaPlantaSlot();
  }
  function calculaSalida() {
    const R = FL.red; if (!R) return;
    const [bq, ba] = bloqueos(), fuentes = R.nodos.map((n, i) => (n.salida ? [i, 0] : null)).filter(Boolean), S = N.flDijkstra(R, fuentes, bq, ba);
    const maxM = +((FL.cfg && FL.cfg.maxSalidaM) || 0), dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const dM = FL.amb.map((a, i) => { let m = Infinity; for (const n of R.deAmb[i]) { const d = S.D[n] + dist(R.nodos[n].p, R.centros[i]); if (d < m) m = d; } return m; });
    FL.salida = { dM, banda: dM.map(d => N.flBanda(d, maxM)), n: fuentes.length, maxM, S };
  }
  function rutaASalida(i) {
    const R = FL.red, S = FL.salida && FL.salida.S; if (!R || !S) return null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); let mejor = Infinity, fin = -1;
    for (const n of R.deAmb[i]) { const d = S.D[n] + dist(R.nodos[n].p, R.centros[i]); if (d < mejor) { mejor = d; fin = n; } }
    if (fin < 0 || !isFinite(mejor)) return null;
    const cadena = []; for (let x = fin; x >= 0; x = S.prev[x]) cadena.push(x);
    return { d: mejor, dM: mejor, nodos: cadena, desde: i, hasta: i, ambientes: [i], vertical: { ascensor: 0, escalera: 0 }, aSalida: true };
  }
  function calculaMatriz() { const G = grupos(); if (G.length < 2) { FL.matriz = null; FL.gruposM = G; return; } const [bq, ba] = bloqueos(); FL.gruposM = G; FL.matriz = N.flMatriz(FL.red, G, FL.red.centros, bq, ba); }
  function relaciones() { const C = FL.cfg || {}; return (C.relaciones && C.relaciones.length) ? C.relaciones : RELACIONES_PROPUESTAS.map(([a, b]) => ({ a, b, tipo: 'cercana', maxM: 0, nota: 'Propuesta: valídala con la NTS del proyecto', propuesta: true })); }
  function evaluaRelaciones() {
    const G = new Map(grupos()), [bq, ba] = bloqueos(), out = [], upssDe = (i) => FL.amb[i].upss, esCirc = (i) => FL.amb[i].clases.indexOf('circulacion') >= 0;
    for (const rel of relaciones()) {
      const busca = (n) => [...G.keys()].find(x => N.flNorm(x) === N.flNorm(n)) || [...G.keys()].find(x => N.flNorm(x).indexOf(N.flNorm(n)) >= 0 || N.flNorm(n).indexOf(N.flNorm(x)) >= 0) || '';
      const ka = busca(rel.a), kb = busca(rel.b);
      if (!ka || !kb) { out.push({ rel, ka, kb, falta: !ka ? rel.a : rel.b }); continue; }
      const r = N.flRuta(FL.red, G.get(ka), G.get(kb), FL.red.centros, bq, ba), dM = r ? r.d : Infinity;
      out.push({ rel, ka, kb, ruta: r, dM, ev: N.flEvaluaRelacion(Object.assign({}, rel, { a: ka, b: kb }), r, dM, upssDe, esCirc) });
    }
    return out;
  }
  function calculaFlujos() {
    const [bq, ba] = bloqueos(), cls = (k) => FL.amb.map((a, i) => (a.clases.indexOf(k) >= 0 ? i : -1)).filter(i => i >= 0), deUpss = (rx) => FL.amb.map((a, i) => (rx.test(N.flNorm(a.upss || '')) ? i : -1)).filter(i => i >= 0), clasesDe = (i) => FL.amb[i].clases;
    const salidas = FL.red.nodos.map((n, i) => (n.salida ? i : -1)).filter(i => i >= 0), dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), out = [];
    const uno = (nombre, A, B, prohibidas, sinB) => {
      if (!A.length) { out.push({ nombre, falta: 'no hay ambientes de origen' }); return; }
      let r = null;
      if (B && B.length) r = N.flRuta(FL.red, A, B, FL.red.centros, bq, ba);
      else if (sinB && salidas.length) {
        const fuentes = []; for (const a of A) for (const n of FL.red.deAmb[a]) fuentes.push([n, dist(FL.red.centros[a], FL.red.nodos[n].p)]);
        const S = N.flDijkstra(FL.red, fuentes, bq, ba); let mejor = Infinity, fin = -1; for (const s of salidas) if (S.D[s] < mejor) { mejor = S.D[s]; fin = s; }
        if (fin >= 0) { const cad = []; for (let x = fin; x >= 0; x = S.prev[x]) cad.push(x); cad.reverse(); const amb = []; for (let i = 1; i < cad.length; i++) { const v = S.via[cad[i]]; if (v >= 0 && amb[amb.length - 1] !== v) amb.push(v); } let desde = A[0]; for (const a of A) if (FL.red.deAmb[a].indexOf(cad[0]) >= 0) { desde = a; break; } r = { d: mejor, nodos: cad, ambientes: [desde].concat(amb), vertical: { ascensor: 0, escalera: 0 }, desde, hasta: desde, aSalidaFlujo: true }; }
      }
      if (!r) { out.push({ nombre, falta: B && !B.length ? 'no hay ambientes de destino' : 'no hay camino' }); return; }
      out.push({ nombre, ruta: r, dM: r.d, cruces: N.flCruces(r, clasesDe, prohibidas), prohibidas });
    };
    const centralRes = cls('residuosCentral');
    uno('Residuos: de cada cuarto sucio al almacén central (o a la salida)', cls('sucio').filter(i => centralRes.indexOf(i) < 0), centralRes, ['publico', 'esteril'], !centralRes.length);
    uno('Cadáveres: de Emergencia, UCI, Centro quirúrgico y Hospitalización al mortuorio', deUpss(/emergenc|cuidados intensivos|\buci\b|quirurg|hospitaliz/), cls('cadaver'), ['publico']);
    uno('Material estéril: de la Central de esterilización al Centro quirúrgico', FL.amb.map((a, i) => ((/esteriliz|\bcye\b/.test(N.flNorm(a.upss)) || a.clases.indexOf('esteril') >= 0) && !/quirurg/.test(N.flNorm(a.upss)) ? i : -1)).filter(i => i >= 0), deUpss(/quirurg/), ['publico', 'sucio']);
    uno('Ropa sucia: de Hospitalización a la lavandería', deUpss(/hospitaliz/), deUpss(/lavanderi/), ['publico', 'esteril']);
    FL.flujos = out;
  }

  // --- la ventana ---
  const r1 = (x) => (isFinite(x) ? (Math.round(x * 10) / 10).toLocaleString('es-PE') : 'sin camino');
  function opcionesSel(sel) {
    const G = grupos(); let h = '<option value="">— elige —</option>';
    if (G.length) h += '<optgroup label="UPS / UPSS">' + G.map(([u, L]) => '<option value="u:' + esc(u) + '"' + (sel === 'u:' + u ? ' selected' : '') + '>' + esc(u) + ' (' + L.length + ')</option>').join('') + '</optgroup>';
    const orden = FL.amb.map((a, i) => i).sort((x, y) => (FL.amb[x].nivel + FL.amb[x].nombre).localeCompare(FL.amb[y].nivel + FL.amb[y].nombre, 'es'));
    return h + '<optgroup label="Ambientes">' + orden.slice(0, 4000).map(i => '<option value="a:' + i + '"' + (sel === 'a:' + i ? ' selected' : '') + '>' + esc(etA(i)) + '</option>').join('') + '</optgroup>';
  }
  function rutaHtml(r, titulo, clave) {
    if (!r) return '';
    if (r.nada) return '<div class="aviso rojo">No hay camino entre «' + esc(nombreSel(r.de)) + '» y «' + esc(nombreSel(r.a)) + '»' + (r.modo === 'camilla' ? ' para una camilla (sin escaleras y con puertas de ' + esc(FL.ancho) + ' m o más)' : '') + '. Revisa sus puertas y las conexiones entre niveles.</div>';
    const cru = N.flCruces(r, (i) => FL.amb[i].clases, ['publico', 'sucio', 'esteril', 'cadaver']), puertas = r.nodos.filter(n => FL.red.nodos[n].tipo === 'puerta'), angostas = puertas.map(n => FL.pue[FL.red.nodos[n].k]).filter(p => p.ancho > 0).sort((a, b) => a.ancho - b.ancho);
    let h = '<div class="grupo">' + (titulo ? '<h4>' + esc(titulo) + '</h4>' : '') + '<div class="filab"><b style="font-size:20px;color:var(--er-orc)">' + r1(r.dM) + ' m</b><span class="pista">' + puertas.length + ' puerta(s) · ' + (r.vertical.ascensor ? r.vertical.ascensor + ' tramo(s) en ascensor · ' : '') + (r.vertical.escalera ? r.vertical.escalera + ' tramo(s) por escalera · ' : '') + r.ambientes.length + ' ambiente(s)' + (angostas.length ? ' · puerta más angosta ' + (Math.round(angostas[0].ancho * 100) / 100) + ' m' : '') + '</span><span style="flex:1"></span><button data-fl-dibuja="' + clave + '">Ver en el modelo</button><button data-fl-p2="' + clave + '">Planta 2D</button></div>';
    if (cru.length) h += '<div class="aviso ambar">Atraviesa ' + cru.map(c => esc(etA(c.i)) + ' <span class="pista">(' + c.clases.map(k => esc(N.CLASES_NOMBRE[k] || k)).join(', ') + ')</span>').join('; ') + '.</div>';
    return h + '<div class="pista">Recorrido: ' + r.ambientes.map(i => '<a href="#" data-fl-ir="' + i + '">' + esc(etA(i)) + '</a>').join(' → ') + '</div></div>';
  }
  function matrizHtml() {
    if (!FL.matriz) calculaMatriz();
    const G = FL.gruposM || []; if (G.length < 2) return '<div class="aviso ambar">Hacen falta al menos dos UPS/UPSS: los ambientes no traen CGM_Subdepartamento ni un nombre que la diga.</div>';
    const M = FL.matriz, todos = [].concat(...M).filter(x => x > 0 && isFinite(x)), mx = Math.max(1, ...todos);
    const col = (d) => { if (!isFinite(d)) return 'background:rgba(139,152,165,.25)'; if (!d) return ''; const t = Math.min(1, d / mx); return 'background:rgba(' + Math.round(63 + 185 * t) + ',' + Math.round(185 - 104 * t) + ',' + Math.round(80 - 7 * t) + ',.45)'; };
    const corta = (s) => (s.length <= 16 ? s : s.slice(0, 15) + '…');
    let h = '<div style="overflow:auto"><table style="font-size:12px"><tr><th></th>' + G.map(g => '<th title="' + esc(g[0]) + '">' + esc(corta(g[0])) + '</th>').join('') + '</tr>';
    G.forEach((g, i) => { h += '<tr><th style="text-align:right" title="' + esc(g[0]) + '">' + esc(corta(g[0])) + '</th>' + M[i].map((d, j) => i === j ? '<td>—</td>' : '<td data-fl-m="' + i + ',' + j + '" class="clic" style="cursor:pointer;text-align:right;' + col(d) + (FL.selM === i + ',' + j ? ';outline:2px solid var(--er-or)' : '') + '" title="' + esc(g[0]) + ' → ' + esc(G[j][0]) + '">' + (isFinite(d) ? Math.round(d) : '∞') + '</td>').join('') + '</tr>'; });
    return h + '</table></div><div class="pista">Metros por el camino más corto entre las dos UPSS (de puerta a puerta). Clic en una celda: la ruta y su dibujo.</div>';
  }
  function grafSalida() {
    if (!FL.salida) calculaSalida();
    const S = FL.salida, n = [0, 0, 0, 0]; for (const b of S.banda) n[b]++;
    const tit = (i) => S.maxM > 0 ? (i === 0 ? 'Hasta ' + S.maxM / 2 + ' m' : i === 1 ? 'De ' + S.maxM / 2 + ' a ' + S.maxM + ' m' : i === 2 ? 'Más de ' + S.maxM + ' m' : BANDAS[i][0]) : (i === 0 ? 'Hasta 30 m' : i === 1 ? 'De 30 a 60 m' : i === 2 ? 'Más de 60 m' : BANDAS[i][0]);
    const tope = Math.max(1, ...n);
    return BANDAS.map((b, i) => '<div class="barra' + (FL.fSal === i ? ' activa' : '') + '" data-fl-b="' + i + '" style="cursor:pointer"><span class="k" style="width:170px">' + esc(tit(i)) + '</span><span class="b"><i style="width:' + (100 * n[i] / tope) + '%;background:' + b[1] + '"></i></span><span class="n">' + n[i] + '</span></div>').join('');
  }
  function pinta() {
    const w = FL.ventana; if (!w) return;
    const c = w.querySelector('.flcuerpo'); w.querySelector('[data-fl="excel"]').disabled = !FL.red; w.querySelector('[data-fl="arma"]').disabled = FL.estado === 'armando';
    let h = '';
    if (FL.error) h += '<div class="aviso rojo">' + esc(FL.error) + '</div>';
    if (FL.aviso) h += '<div class="aviso verde">' + esc(FL.aviso) + '</div>';
    if (!FL.red) { c.innerHTML = h + (FL.estado === 'armando' ? '<p class="pista">Armando la red…</p>' : '<p class="pista">Carga el modelo de arquitectura del hospital (con sus ambientes) y pulsa «Analizar el modelo»: el visor une cada ambiente con sus puertas y calcula rutas, relaciones entre UPSS, flujos limpio / sucio y la distancia a la salida.</p>'); return; }
    const R = FL.red, nP = R.nodos.filter(n => n.tipo === 'puerta'), unLado = nP.filter(n => (n.a < 0) !== (n.b < 0)).length, sinNada = nP.filter(n => n.a < 0 && n.b < 0).length, sal = nP.filter(n => n.salida).length, conUpss = FL.amb.filter(a => a.upss).length, inferidas = FL.amb.filter(a => a.upssInferida).length;
    h += '<div class="pista">' + num(FL.amb.length) + ' ambientes · ' + num(nP.length) + ' puertas (' + unLado + ' con ambiente a un solo lado, ' + sinNada + ' sin ambiente a ningún lado) · ' + R.vert + ' conexión(es) entre niveles · ' + sal + ' salida(s) · ' + conUpss + ' ambientes con UPS/UPSS' + (inferidas ? ' (' + inferidas + ' inferida(s) por el nombre)' : '') + '.</div>';
    h += '<div class="filab">Modo <select data-fl="modo" style="width:auto"><option value="peaton"' + (FL.modo === 'peaton' ? ' selected' : '') + '>Peatón</option><option value="camilla"' + (FL.modo === 'camilla' ? ' selected' : '') + '>Camilla (sin escaleras)</option></select>' + (FL.modo === 'camilla' ? ' ancho mínimo de puerta <input type="number" data-fl="ancho" min="0.6" step="0.05" style="width:70px" value="' + esc(FL.ancho) + '"> m' : '') + ' <label style="margin:0;display:flex;gap:4px;align-items:center" title="Une también los ambientes contiguos a una circulación aunque no haya puerta (vanos). Puede unir a través de un muro: úsalo con criterio."><input type="checkbox" data-fl="vanos"' + (FL.vanos ? ' checked' : '') + ' style="width:auto"> unir vanos sin puerta</label></div>';
    h += '<div class="flplanta"></div>';
    const tab = (k, t) => '<button data-fl-tab="' + k + '" class="' + (FL.tab === k ? 'activa' : '') + '">' + t + '</button>';
    h += '<div class="lienzo-pestanas">' + tab('ruta', 'Ruta') + tab('rel', 'Relaciones entre UPSS') + tab('flu', 'Flujos limpio / sucio') + tab('sal', 'Distancia a la salida') + tab('p2', 'Planta 2D') + tab('cfg', 'Configuración') + '</div>';
    h += FL.tab === 'ruta' ? tabRuta() : FL.tab === 'rel' ? tabRel() : FL.tab === 'flu' ? tabFlu() : FL.tab === 'sal' ? tabSal() : FL.tab === 'p2' ? tabP2() : tabCfg();
    h += '<div class="pista" style="margin-top:10px;border-top:1px solid var(--borde);padding-top:6px">Aproximaciones, dichas: dentro de cada ambiente la distancia es en línea recta entre sus puertas; un ascensor cuenta como 8 m más lo que sube, y una escalera el doble de lo que sube. Un ambiente se une a otro solo por una puerta (o por un vano, si lo pides). Los ambientes y sus UPS/UPSS son los del modelo (CGM_Subdepartamento).</div>';
    c.innerHTML = h;
    ata(c); pintaPlantaSlot(); if (FL.tab === 'p2') p2Pinta();
  }
  function pintaPlantaSlot() {
    const z = FL.ventana && FL.ventana.querySelector('.flplanta'); if (!z) return;
    if (!FL.pts || !FL.niveles) { z.innerHTML = ''; return; }
    z.innerHTML = '<div class="pista" style="margin:4px 0">Sección en planta a 1,50 m sobre el piso del recorrido' + (FL.niveles.length > 1 ? ' · nivel: ' + FL.niveles.map((n, i) => '<a href="#" data-fl-niv="' + i + '"' + (i === FL.nivelK ? ' style="color:var(--er-orc);font-weight:600"' : '') + '>' + (i + 1) + ' (Z ' + f3(n.piso) + ')</a>').join(' · ') : '') + ' · <a href="#" data-fl="sincorte">Quitar sección</a></div>';
    z.querySelectorAll('[data-fl-niv]').forEach(a => a.onclick = (e) => { e.preventDefault(); FL.nivelK = +a.dataset.flNiv; const nv = FL.niveles[FL.nivelK]; const b = new THREE.Box3(); for (const p of FL.pts.pts) b.expandByPoint(pEsc(p)); b.expandByScalar(3); V.cortaPlanta(nv.corte, b); pintaPlantaSlot(); });
    const q = z.querySelector('[data-fl="sincorte"]'); if (q) q.onclick = (e) => { e.preventDefault(); V.quitaCortePlanta(); };
  }
  function tabRuta() { let h = '<div class="filab">De <select data-fl="A" style="max-width:320px">' + opcionesSel(FL.A) + '</select> a <select data-fl="B" style="max-width:320px">' + opcionesSel(FL.B) + '</select><button class="primario" data-fl="ruta">Calcular</button></div>'; if (FL.ruta) h += rutaHtml(FL.ruta, nombreSel(FL.ruta.de) + ' → ' + nombreSel(FL.ruta.a) + (FL.ruta.modo === 'camilla' ? ' (camilla)' : ''), 'ruta'); return h; }
  function tabRel() {
    let h = '<div class="grupo"><h4>Distancias entre UPSS (m)<span class="hint">clic en una celda: su ruta</span></h4>' + matrizHtml() + '</div>';
    if (FL.rutaM) h += rutaHtml(FL.rutaM, FL.rutaM.titulo, 'rutaM');
    const E = evaluaRelaciones(), propuestas = !(FL.cfg && FL.cfg.relaciones && FL.cfg.relaciones.length); FL.relE = E;
    h += '<div class="grupo"><h4>Relaciones exigidas<span class="hint">' + (propuestas ? 'PROPUESTA: el gestor las valida con la NTS del proyecto en «Configuración»' : 'las del proyecto (guardadas por ' + esc(FL.cfg.por || 'el gestor') + ')') + '</span></h4><table style="font-size:12px"><tr><th>UPSS A</th><th>UPSS B</th><th>Tipo</th><th>Máx. (m)</th><th>Distancia</th><th>¿Cumple?</th><th>Por qué</th></tr>' +
      E.map((x, i) => '<tr class="clic" data-fl-rel="' + i + '"><td>' + esc(x.ka || x.rel.a) + '</td><td>' + esc(x.kb || x.rel.b) + '</td><td>' + esc(x.rel.tipo) + '</td><td>' + (x.rel.maxM || '—') + '</td><td>' + (x.falta ? '' : isFinite(x.dM) ? Math.round(x.dM) + ' m' : 'sin camino') + '</td><td>' + (x.falta ? '<span class="pista">no está «' + esc(x.falta) + '»</span>' : x.ev.cumple ? '<span class="estado PUBLICADO">sí</span>' : '<span class="estado" style="background:var(--rojo2);color:var(--rojo)">no</span>') + '</td><td class="pista">' + esc(x.ev ? x.ev.motivo : '') + '</td></tr>').join('') + '</table><div class="pista">«Directa»: el camino no atraviesa ambientes de otra UPSS (salvo circulaciones). «Cercana»: solo la distancia máxima, si se fija. Clic en una fila: su ruta.</div></div>';
    return h;
  }
  function tabFlu() {
    if (!FL.flujos) calculaFlujos();
    const n = (k) => FL.amb.filter(a => a.clases.indexOf(k) >= 0).length;
    let h = '<div class="pista">Ambientes reconocidos por su nombre: ' + ['sucio', 'residuosCentral', 'cadaver', 'esteril', 'publico'].map(k => esc(N.CLASES_NOMBRE[k]) + ' ' + n(k)).join(' · ') + '. Las reglas se ajustan en «Configuración».</div>';
    h += '<table style="font-size:12px"><tr><th>Flujo</th><th>Distancia</th><th>Cruces</th></tr>' + FL.flujos.map((f, i) => '<tr class="clic" data-fl-flu="' + i + '"><td>' + esc(f.nombre) + '</td><td>' + (f.ruta ? Math.round(f.dM) + ' m' + (f.ruta.aSalidaFlujo ? ' <span class="pista">(a la salida más cercana: no hay almacén central reconocido)</span>' : '') : '<span class="pista">' + esc(f.falta) + '</span>') + '</td><td>' + (f.ruta ? (f.cruces.length ? '<span class="estado" style="background:var(--rojo2);color:var(--rojo)">' + f.cruces.length + '</span> ' + f.cruces.slice(0, 4).map(c => esc(etA(c.i))).join('; ') + (f.cruces.length > 4 ? '…' : '') : '<span class="estado PUBLICADO">ninguno</span>') : '') + '</td></tr>').join('') + '</table>';
    h += '<div class="pista">Clic en un flujo: su ruta y su dibujo. Un cruce es un ambiente de público / espera (o de material estéril, en el flujo de residuos) por el que pasa el camino más corto.</div>';
    if (FL.rutaF) h += rutaHtml(FL.rutaF, FL.rutaF.titulo, 'rutaF');
    return h;
  }
  function tabSal() {
    if (!FL.salida) calculaSalida();
    const S = FL.salida, maxM = S.maxM;
    let h = '<div class="filab">Distancia máxima a una salida <input type="number" data-fl="maxsal" min="0" step="5" style="width:80px" value="' + esc(maxM || '') + '" placeholder="m"' + (FL.puedeGuardar ? '' : ' disabled title="La fija el gestor"') + '> m' + (FL.puedeGuardar ? ' <button data-fl="guardamax">Guardar para el equipo</button>' : '') + '<span class="pista">' + (maxM ? '' : 'Sin máximo fijado: las bandas son 30 / 60 m. Fíjalo con lo que pide la norma (RNE A.130) para este proyecto.') + '</span></div>';
    h += '<div class="pista">' + S.n + ' salida(s) · ' + S.banda.filter(b => b === 3).length + ' ambiente(s) sin camino a una salida.</div>';
    h += '<div class="grupo"><h4>Ambientes por distancia a la salida<span class="hint">clic: filtra la lista y el modelo</span></h4>' + grafSalida() + '<div class="filab"><button data-fl="colorea">Colorear en el modelo</button></div></div>';
    const orden = FL.amb.map((a, i) => i).filter(i => FL.fSal < 0 || S.banda[i] === FL.fSal).sort((x, y) => (isFinite(S.dM[y]) ? S.dM[y] : 1e9) - (isFinite(S.dM[x]) ? S.dM[x] : 1e9));
    h += '<table style="font-size:12px"><tr><th>Ambiente</th><th>UPS/UPSS</th><th>Nivel</th><th>A la salida</th></tr>' + orden.slice(0, 300).map(i => '<tr class="clic" data-fl-amb="' + i + '"><td><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + BANDAS[S.banda[i]][1] + '"></i> ' + esc(etA(i)) + '</td><td>' + esc(FL.amb[i].upss) + '</td><td>' + esc(FL.amb[i].nivel) + '</td><td>' + (isFinite(S.dM[i]) ? Math.round(S.dM[i]) + ' m' : 'sin camino') + '</td></tr>').join('') + '</table>' + (orden.length > 300 ? '<div class="pista">Se listan 300 de ' + orden.length + ' (el Excel trae todos).</div>' : '');
    const sal = FL.red.nodos.filter(n => n.tipo === 'puerta' && (n.salida || n.porSalida));
    h += '<div class="grupo"><h4>Salidas<span class="hint">puertas con un lado sin ambiente y cielo abierto, o que dan a un ambiente exterior</span></h4><table style="font-size:12px">' + sal.slice(0, 200).map(n => { const p = FL.pue[n.k]; return '<tr><td class="clic" data-fl-pu="' + p.e + '" style="cursor:pointer">' + esc(p.nombre) + '</td><td class="pista">' + esc(n.porSalida) + '</td><td>' + (FL.puedeGuardar ? '<button data-fl-sx="' + p.e + '">' + (n.salida ? 'No es salida' : 'Sí es salida') + '</button>' : '') + '</td></tr>'; }).join('') + '</table>' + (FL.puedeGuardar ? '<div class="filab"><button data-fl="salsel" title="Selecciona una puerta en el modelo y pulsa aquí">Marcar como salida la puerta seleccionada</button></div>' : '') + '</div>';
    return h;
  }
  function tabCfg() {
    const C = FL.cfg || {}, rel = (C.relaciones && C.relaciones.length) ? C.relaciones : relaciones(), clases = Object.assign({}, N.CLASES_DEF, C.clases || {});
    let h = '<div class="pista">' + (FL.puedeGuardar ? 'Lo que guardes aquí vale para todo el equipo del proyecto.' : 'Solo el gestor del proyecto puede cambiar la configuración; se muestra la vigente.') + '</div>';
    h += '<div class="grupo"><h4>Relaciones exigidas entre UPSS<span class="hint">las que pide la NTS / el programa del proyecto</span></h4><table style="font-size:12px" id="flRelTabla"><tr><th>UPSS A</th><th>UPSS B</th><th>Tipo</th><th>Máx. (m)</th><th>Mismo nivel</th><th>Nota</th><th></th></tr>' +
      rel.map((r, i) => '<tr><td><input data-rel="a" data-i="' + i + '" value="' + esc(r.a) + '"></td><td><input data-rel="b" data-i="' + i + '" value="' + esc(r.b) + '"></td><td><select data-rel="tipo" data-i="' + i + '">' + ['directa', 'cercana', 'indirecta'].map(t => '<option' + (r.tipo === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td><input type="number" data-rel="maxM" data-i="' + i + '" value="' + (r.maxM || '') + '" style="width:70px"></td><td><input type="checkbox" data-rel="mismoNivel" data-i="' + i + '"' + (r.mismoNivel ? ' checked' : '') + ' style="width:auto"></td><td><input data-rel="nota" data-i="' + i + '" value="' + esc(r.nota || '') + '"></td><td><button data-fl-quitarel="' + i + '">✕</button></td></tr>').join('') + '</table><div class="filab"><button data-fl="addrel">+ Relación</button></div></div>';
    h += '<div class="grupo"><h4>Reglas de clases de ambiente<span class="hint">expresiones regulares sobre el nombre, sin tildes y en minúsculas</span></h4>' + Object.keys(clases).map(k => '<div class="filab"><label style="margin:0;width:200px">' + esc(N.CLASES_NOMBRE[k] || k) + '</label><input data-cls="' + k + '" value="' + esc(clases[k]) + '" style="flex:1;font-family:var(--mono);font-size:11px"></div>').join('') + '</div>';
    h += '<div class="grupo"><h4>Máximos</h4><div class="filab"><label style="margin:0">Distancia máxima a una salida (m)<input type="number" data-cfg="maxSalidaM" value="' + (C.maxSalidaM || '') + '" style="width:90px"></label><label style="margin:0">Ancho de camilla (m)<input type="number" step="0.05" data-cfg="anchoCamillaM" value="' + (C.anchoCamillaM || FL.ancho) + '" style="width:90px"></label></div></div>';
    if (FL.puedeGuardar) h += '<div class="filab"><button class="primario" data-fl="guardacfg">Guardar configuración</button><button data-fl="reglasdef">Reglas por defecto</button></div>';
    return h;
  }
  function leeCfg(c) {
    const rel = []; c.querySelectorAll('#flRelTabla tr').forEach(tr => { const a = tr.querySelector('[data-rel="a"]'); if (!a) return; rel.push({ a: a.value, b: tr.querySelector('[data-rel="b"]').value, tipo: tr.querySelector('[data-rel="tipo"]').value, maxM: +tr.querySelector('[data-rel="maxM"]').value || 0, mismoNivel: tr.querySelector('[data-rel="mismoNivel"]').checked, nota: tr.querySelector('[data-rel="nota"]').value }); });
    const clases = {}; c.querySelectorAll('[data-cls]').forEach(i => { if (i.value !== N.CLASES_DEF[i.dataset.cls]) clases[i.dataset.cls] = i.value; });
    return { relaciones: rel.filter(r => r.a && r.b), clases, maxSalidaM: +c.querySelector('[data-cfg="maxSalidaM"]').value || 0, anchoCamillaM: +c.querySelector('[data-cfg="anchoCamillaM"]').value || 0 };
  }
  function ata(c) {
    c.querySelectorAll('[data-fl-tab]').forEach(b => b.onclick = () => { FL.tab = b.dataset.flTab; pinta(); });
    const on = (sel, ev, f) => c.querySelectorAll(sel).forEach(el => el[ev] = f.bind(null, el));
    on('[data-fl="modo"]', 'onchange', (el) => { FL.modo = el.value; FL.matriz = null; FL.salida = null; FL.flujos = null; pinta(); });
    on('[data-fl="ancho"]', 'onchange', (el) => { FL.ancho = +el.value || 1.1; FL.matriz = null; FL.salida = null; FL.flujos = null; pinta(); });
    on('[data-fl="vanos"]', 'onchange', (el) => { FL.vanos = el.checked; armaRed(); });
    on('[data-fl="A"]', 'onchange', (el) => { FL.A = el.value; }); on('[data-fl="B"]', 'onchange', (el) => { FL.B = el.value; });
    on('[data-fl="ruta"]', 'onclick', () => calculaRuta());
    on('[data-fl-dibuja]', 'onclick', (el) => { const r = FL[el.dataset.flDibuja]; if (r && !r.nada) dibujaRutaFl(r, 0xc8a24a, !!r.aSalida); });
    on('[data-fl-p2]', 'onclick', (el) => { const r = FL[el.dataset.flP2]; if (r && !r.nada) { FL.pts = { pts: puntosDe(r), r }; FL.tab = 'p2'; pinta(); } });
    on('[data-fl-ir]', 'onclick', (el) => { const a = FL.amb[+el.dataset.flIr]; if (a) { const k = V.G.porE.get(a.e); if (k != null) { V.selecciona(V.G.elem[k], true); V.encuadra(V.cajaDe(new Set([a.e]))); } } return false; });
    on('[data-fl-m]', 'onclick', (el) => { const [i, j] = el.dataset.flM.split(',').map(Number), G = FL.gruposM, [bq, ba] = bloqueos(); const r = N.flRuta(FL.red, G[i][1], G[j][1], FL.red.centros, bq, ba); FL.selM = el.dataset.flM; FL.rutaM = r ? Object.assign(r, { dM: r.d, titulo: G[i][0] + ' → ' + G[j][0] }) : { nada: true, de: 'u:' + G[i][0], a: 'u:' + G[j][0], modo: FL.modo }; pinta(); if (r) dibujaRutaFl(r, 0xc8a24a); });
    on('[data-fl-rel]', 'onclick', (el) => { const x = FL.relE[+el.dataset.flRel]; if (!x || !x.ruta) return; FL.rutaM = Object.assign(x.ruta, { dM: x.dM, titulo: x.ka + ' → ' + x.kb }); FL.selM = ''; pinta(); dibujaRutaFl(x.ruta, 0xc8a24a); });
    on('[data-fl-flu]', 'onclick', (el) => { const f = FL.flujos[+el.dataset.flFlu]; if (!f || !f.ruta) return; FL.rutaF = Object.assign(f.ruta, { dM: f.dM, titulo: f.nombre }); pinta(); dibujaRutaFl(f.ruta, 0xe07a6a, !!f.ruta.aSalidaFlujo); });
    on('[data-fl-amb]', 'onclick', (el) => { const i = +el.dataset.flAmb, r = rutaASalida(i); if (r) { FL.rutaS = r; dibujaRutaFl(r, 0xe3a008, true); } else { const a = FL.amb[i], k = V.G.porE.get(a.e); if (k != null) V.encuadra(V.cajaDe(new Set([a.e]))); } });
    on('[data-fl-b]', 'onclick', (el) => { const b = +el.dataset.flB; FL.fSal = FL.fSal === b ? -1 : b; pinta(); coloreaSalida(); });
    on('[data-fl="colorea"]', 'onclick', () => coloreaSalida());
    on('[data-fl="guardamax"]', 'onclick', () => { const v = +c.querySelector('[data-fl="maxsal"]').value || 0; guardaCfg({ maxSalidaM: v }).then(() => { FL.salida = null; pinta(); }); });
    on('[data-fl-sx]', 'onclick', (el) => { const e = +el.dataset.flSx, C = FL.cfg || {}, ex = new Set(C.salidasExcluidas || []), xt = new Set(C.salidasExtra || []), n = FL.red.nodos.find(n => n.tipo === 'puerta' && FL.pue[n.k].e === e); if (n.salida) { ex.add(e); xt.delete(e); } else { xt.add(e); ex.delete(e); } guardaCfg({ salidasExcluidas: [...ex], salidasExtra: [...xt] }).then(() => { marcaSalidas(); FL.salida = null; pinta(); }); });
    on('[data-fl="salsel"]', 'onclick', () => { const S = V.SEL; if (!S || !FL.pue.some(p => p.e === S.e)) { FL.error = 'Selecciona primero una puerta en el modelo.'; return pinta(); } const C = FL.cfg || {}, xt = new Set(C.salidasExtra || []); xt.add(S.e); guardaCfg({ salidasExtra: [...xt] }).then(() => { marcaSalidas(); FL.salida = null; pinta(); }); });
    on('[data-fl-pu]', 'onclick', (el) => { const e = +el.dataset.flPu, k = V.G.porE.get(e); if (k != null) { V.selecciona(V.G.elem[k], true); V.encuadra(V.cajaDe(new Set([e]))); } });
    on('[data-fl="addrel"]', 'onclick', () => { const cfg = leeCfg(c); cfg.relaciones.push({ a: '', b: '', tipo: 'cercana', maxM: 0, nota: '' }); FL.cfg = Object.assign({}, FL.cfg || {}, cfg); pinta(); });
    on('[data-fl-quitarel]', 'onclick', (el) => { const cfg = leeCfg(c); cfg.relaciones.splice(+el.dataset.flQuitarel, 1); FL.cfg = Object.assign({}, FL.cfg || {}, cfg); pinta(); });
    on('[data-fl="guardacfg"]', 'onclick', () => guardaCfg(leeCfg(c)).then(() => armaRed()));
    on('[data-fl="reglasdef"]', 'onclick', () => { c.querySelectorAll('[data-cls]').forEach(i => { i.value = N.CLASES_DEF[i.dataset.cls] || ''; }); });
  }
  function coloreaSalida() {
    if (!FL.salida) calculaSalida();
    const T = new Map(); FL.amb.forEach((a, i) => { if (FL.fSal < 0 || FL.salida.banda[i] === FL.fSal) T.set(a.e, hexLin(BANDAS[FL.salida.banda[i]][1])); });
    V.TINTES = T; V.aplicaTintes(); V.MOSTRAR_AMB = true; const ch = $('amVer'); if (ch) ch.checked = true;
    if (FL.fSal >= 0) V.muestraSolo(new Set(FL.amb.filter((a, i) => FL.salida.banda[i] === FL.fSal).map(a => a.e)), true); else { V.muestraSolo(null, false); }
  }

  // --- la planta 2D (lienzo): huellas por nivel, puertas, salidas y el recorrido ---
  function nivelesP2() {
    if (FL.nivelesP2) return FL.nivelesP2;
    // los niveles: por cota del piso de los ambientes (agrupando a menos de 1,5 m), con el nombre de nivel mas frecuente
    const zs = FL.amb.map(a => a.caja.z1).sort((a, b) => a - b), grupos = [];
    for (const z of zs) { const g = grupos[grupos.length - 1]; if (g && z - g.z1 <= 1.5) { g.z2 = z; } else grupos.push({ z1: z, z2: z }); }
    for (const g of grupos) { const n = new Map(); g.amb = []; FL.amb.forEach((a, i) => { if (a.caja.z1 >= g.z1 - 1e-6 && a.caja.z1 <= g.z2 + 1e-6) { g.amb.push(i); n.set(a.nivel, (n.get(a.nivel) || 0) + 1); } }); g.nombre = [...n.entries()].sort((x, y) => y[1] - x[1])[0][0] || ('Z ' + f3(g.z1)); g.pue = FL.pue.map((p, k) => k).filter(k => FL.pue[k].caja.z1 >= g.z1 - 1.5 && FL.pue[k].caja.z1 <= g.z2 + 1.5); }
    FL.nivelesP2 = grupos; return grupos;
  }
  function contornoDe(i) { const a = FL.amb[i]; if (a.borde !== undefined) return a.borde; const H = huellaDe(i); a.borde = H ? N.flBordes(H, 0.01) : null; return a.borde; }
  function tabP2() {
    const NV = nivelesP2(); if (FL.p2.k < 0) FL.p2.k = FL.pts ? Math.max(0, NV.findIndex(g => FL.pts.pts[0].z >= g.z1 - 0.5 && FL.pts.pts[0].z <= g.z2 + 2)) : 0;
    return '<div class="filab">Nivel <select data-p2="k" style="width:auto">' + NV.map((g, i) => '<option value="' + i + '"' + (i === FL.p2.k ? ' selected' : '') + '>' + esc(g.nombre) + ' (' + g.amb.length + ' ambientes)</option>').join('') + '</select> Color <select data-p2="color" style="width:auto"><option value="upss"' + (FL.p2.color === 'upss' ? ' selected' : '') + '>por UPS/UPSS</option><option value="salida"' + (FL.p2.color === 'salida' ? ' selected' : '') + '>por distancia a la salida</option><option value="clase"' + (FL.p2.color === 'clase' ? ' selected' : '') + '>por clase (sucio / estéril / público…)</option></select><button data-p2="ajusta">Ajustar</button><button data-p2="corta" title="Corta el 3D en este nivel y lo mira desde arriba">Cortar el 3D aquí</button><button data-p2="png">PNG</button><span class="pista" id="p2Tip" style="flex:1"></span></div>' +
      '<div class="pista">Rueda: zoom · arrastrar: mover · clic en un ambiente: lo selecciona en el 3D. ' + (FL.pts ? 'El recorrido dibujado va encima; los cambios de nivel se marcan con ▲ / ▼.' : 'Calcula una ruta (Ruta, una celda de la matriz, un flujo o un ambiente en Distancia a la salida) y aparecerá aquí.') + '</div>' +
      '<div style="position:relative;border:1px solid var(--borde);background:#1a1611;height:520px;overflow:hidden;cursor:grab"><canvas id="p2Cv" style="position:absolute;left:0;top:0"></canvas><div id="p2Ley" class="leyenda" style="position:absolute;left:8px;bottom:6px;background:rgba(21,17,11,.85);padding:4px 8px;border-radius:3px"></div></div>';
  }
  const PAL = ['#c8a24a', '#5aa9e6', '#7fc47f', '#e07a6a', '#b58bd8', '#f0b640', '#4fd1c5', '#e68ac0', '#9ab0c0', '#d4a373', '#8ecae6', '#ffafcc', '#a7c957', '#f4a261', '#90be6d', '#577590'];
  const CLASE_COLOR = { sucio: '#e07a6a', residuosCentral: '#b33a2a', cadaver: '#6b4c9a', esteril: '#5aa9e6', publico: '#f0b640', circulacion: '#9a9a9a', ascensor: '#4fd1c5', escalera: '#4fd1c5', exterior: '#7fc47f' };
  function p2ColorAmb(i) {
    const a = FL.amb[i];
    if (FL.p2.color === 'salida') { if (!FL.salida) calculaSalida(); return BANDAS[FL.salida.banda[i]][1]; }
    if (FL.p2.color === 'clase') { for (const k of ['residuosCentral', 'sucio', 'cadaver', 'esteril', 'publico', 'ascensor', 'escalera', 'exterior', 'circulacion']) if (a.clases.indexOf(k) >= 0) return CLASE_COLOR[k]; return '#5c564a'; }
    if (!a.upss) return '#5c564a'; const G = grupos().map(g => g[0]); return PAL[Math.max(0, G.indexOf(a.upss)) % PAL.length];
  }
  function p2Pinta() {
    const cv = $('p2Cv'); if (!cv || !FL.red) return;
    const cont = cv.parentElement, W = cont.clientWidth, H = cont.clientHeight; cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), g = nivelesP2()[FL.p2.k]; if (!g) return;
    // caja del nivel (Revit x, y)
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const i of g.amb) { const c = FL.amb[i].caja; x1 = Math.min(x1, c.x1); y1 = Math.min(y1, c.y1); x2 = Math.max(x2, c.x2); y2 = Math.max(y2, c.y2); }
    if (!FL.p2.lista || FL.p2.listaK !== FL.p2.k) { const s = Math.min((W - 40) / Math.max(1, x2 - x1), (H - 40) / Math.max(1, y2 - y1)); FL.p2.esc = s; FL.p2.tx = (W - (x2 - x1) * s) / 2 - x1 * s; FL.p2.ty = (H + (y2 + y1) * s) / 2; FL.p2.lista = true; FL.p2.listaK = FL.p2.k; }
    const S = FL.p2.esc, X = (x) => FL.p2.tx + x * S, Y = (y) => FL.p2.ty - y * S;
    ctx.clearRect(0, 0, W, H);
    const enRuta = new Set(FL.pts && FL.pts.r ? FL.pts.r.ambientes : []);
    for (const i of g.amb) {
      const a = FL.amb[i], col = p2ColorAmb(i), B = contornoDe(i);
      ctx.fillStyle = col + (enRuta.has(i) ? 'cc' : '66'); ctx.strokeStyle = col; ctx.lineWidth = enRuta.has(i) ? 2 : 1;
      if (B && B.length) { ctx.beginPath(); for (let q = 0; q + 3 < B.length; q += 4) { ctx.moveTo(X(B[q]), Y(B[q + 1])); ctx.lineTo(X(B[q + 2]), Y(B[q + 3])); } ctx.stroke(); const c = a.caja; ctx.globalAlpha = 0.35; ctx.fillRect(X(c.x1), Y(c.y2), (c.x2 - c.x1) * S, (c.y2 - c.y1) * S); ctx.globalAlpha = 1; }
      else { const c = a.caja; ctx.fillRect(X(c.x1), Y(c.y2), (c.x2 - c.x1) * S, (c.y2 - c.y1) * S); ctx.strokeRect(X(c.x1), Y(c.y2), (c.x2 - c.x1) * S, (c.y2 - c.y1) * S); }
      const c = a.caja, w = (c.x2 - c.x1) * S; if (w > 46) { ctx.fillStyle = '#ece2cc'; ctx.font = (w > 120 ? 11 : 9) + 'px IN Inter, sans-serif'; ctx.textAlign = 'center'; const t = (a.num ? a.num + ' ' : '') + a.nombre; ctx.fillText(t.length > w / 6 ? t.slice(0, Math.max(3, w / 6)) + '…' : t, X((c.x1 + c.x2) / 2), Y((c.y1 + c.y2) / 2) + 4); }
    }
    // puertas y salidas
    for (const k of g.pue) { const p = FL.pue[k], c = p.caja, n = FL.red.nodos.find(n => n.tipo === 'puerta' && n.k === k); ctx.fillStyle = n && n.salida ? '#3fb950' : '#ece2cc'; const eje = N.flEjePuerta(c); if (eje === 'x') ctx.fillRect(X(c.x1) - 1, Y(c.y2), (c.x2 - c.x1) * S + 2, (c.y2 - c.y1) * S); else ctx.fillRect(X(c.x1), Y(c.y2) - 1, (c.x2 - c.x1) * S, (c.y2 - c.y1) * S + 2); if (n && n.salida) { ctx.beginPath(); ctx.arc(X((c.x1 + c.x2) / 2), Y((c.y1 + c.y2) / 2), 5, 0, Math.PI * 2); ctx.fill(); } }
    // el recorrido
    if (FL.pts) {
      const pts = FL.pts.pts, niv = N.flNivelesRuta(pts.map(p => p.z), 1, 1.5), kk = N.flNivelDe(niv, g.z1 + 1), T = N.flTramosNivel(pts, niv, kk);
      ctx.strokeStyle = '#' + ((FL.pts.color || 0xc8a24a) >>> 0).toString(16).padStart(6, '0'); ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.setLineDash([10, 6]); ctx.beginPath();
      for (const i of T.segs) { ctx.moveTo(X(pts[i].x), Y(pts[i].y)); ctx.lineTo(X(pts[i + 1].x), Y(pts[i + 1].y)); } ctx.stroke(); ctx.setLineDash([]);
      for (const c of T.cambios) { ctx.fillStyle = '#e9d29a'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(c.sube ? '▲' : '▼', X(pts[c.i].x), Y(pts[c.i].y) + 6); }
      if (T.en[0]) { ctx.fillStyle = '#5aa9e6'; ctx.beginPath(); ctx.arc(X(pts[0].x), Y(pts[0].y), 7, 0, Math.PI * 2); ctx.fill(); }
      if (T.en[pts.length - 1]) { ctx.fillStyle = FL.pts.salida ? '#3fb950' : '#e07a6a'; ctx.beginPath(); ctx.arc(X(pts[pts.length - 1].x), Y(pts[pts.length - 1].y), 7, 0, Math.PI * 2); ctx.fill(); }
    }
    const ley = $('p2Ley'); if (ley) { if (FL.p2.color === 'salida') ley.innerHTML = BANDAS.map(b => '<span><i style="background:' + b[1] + '"></i>' + esc(b[0]) + '</span>').join(''); else if (FL.p2.color === 'clase') ley.innerHTML = Object.keys(CLASE_COLOR).map(k => '<span><i style="background:' + CLASE_COLOR[k] + '"></i>' + esc(N.CLASES_NOMBRE[k] || k) + '</span>').join(''); else ley.innerHTML = grupos().slice(0, 16).map((g, i) => '<span><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc(g[0]) + '</span>').join('') + '<span><i style="background:#3fb950"></i>salida</span>'; }
    // interaccion (una sola vez por lienzo)
    if (!cv._atado) {
      cv._atado = true; let arr = null;
      cont.onwheel = (e) => { e.preventDefault(); const r = cont.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = e.deltaY < 0 ? 1.15 : 1 / 1.15; FL.p2.tx = mx - (mx - FL.p2.tx) * k; FL.p2.ty = my - (my - FL.p2.ty) * k; FL.p2.esc *= k; p2Pinta(); };
      cont.onmousedown = (e) => { arr = { x: e.clientX - FL.p2.tx, y: e.clientY - FL.p2.ty, m: false, x0: e.clientX, y0: e.clientY }; e.preventDefault(); };
      cont.onmousemove = (e) => { if (arr) { if (Math.hypot(e.clientX - arr.x0, e.clientY - arr.y0) > 3) arr.m = true; FL.p2.tx = e.clientX - arr.x; FL.p2.ty = e.clientY - arr.y; p2Pinta(); return; } const i = p2AmbEn(e); const t = $('p2Tip'); if (t) t.textContent = i >= 0 ? etA(i) + (FL.amb[i].upss ? ' · ' + FL.amb[i].upss : '') + (FL.salida && isFinite(FL.salida.dM[i]) ? ' · a la salida ' + Math.round(FL.salida.dM[i]) + ' m' : '') : ''; };
      cont.onmouseup = (e) => { if (arr && !arr.m) { const i = p2AmbEn(e); if (i >= 0) { const a = FL.amb[i], k = V.G.porE.get(a.e); if (k != null) { V.selecciona(V.G.elem[k], true); V.encuadra(V.cajaDe(new Set([a.e]))); } } } arr = null; };
      cont.onmouseleave = () => { arr = null; };
      const c0 = FL.ventana.querySelector('.flcuerpo');
      c0.querySelector('[data-p2="k"]').onchange = (e) => { FL.p2.k = +e.target.value; FL.p2.lista = false; p2Pinta(); };
      c0.querySelector('[data-p2="color"]').onchange = (e) => { FL.p2.color = e.target.value; p2Pinta(); };
      c0.querySelector('[data-p2="ajusta"]').onclick = () => { FL.p2.lista = false; p2Pinta(); };
      c0.querySelector('[data-p2="corta"]').onclick = () => { const gg = nivelesP2()[FL.p2.k]; const b = new THREE.Box3(); for (const i of gg.amb) { const c = FL.amb[i].caja; b.expandByPoint(pEsc({ x: c.x1, y: c.y1, z: c.z1 })); b.expandByPoint(pEsc({ x: c.x2, y: c.y2, z: c.z2 })); } V.cortaPlanta(gg.z1 + 1.5, b); };
      c0.querySelector('[data-p2="png"]').onclick = () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'planta-flujos-' + nombreProy() + '.png'; a.click(); };
    }
  }
  function p2AmbEn(e) {
    const cv = $('p2Cv'); if (!cv) return -1; const r = cv.getBoundingClientRect(), S = FL.p2.esc, x = (e.clientX - r.left - FL.p2.tx) / S, y = (FL.p2.ty - (e.clientY - r.top)) / S, g = nivelesP2()[FL.p2.k];
    let mejor = -1, area = Infinity; for (const i of g.amb) { const c = FL.amb[i].caja; if (x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2) { const ar = (c.x2 - c.x1) * (c.y2 - c.y1); if (ar < area) { area = ar; mejor = i; } } }
    return mejor;
  }

  function excelFl() {
    if (!FL.red) return;
    const amb = [['Ambiente', 'Número', 'Nivel', 'UPS/UPSS', 'UPSS inferida por el nombre', 'Clases', 'Puertas', 'Distancia a la salida (m)', 'Banda']];
    if (!FL.salida) calculaSalida();
    FL.amb.forEach((a, i) => amb.push([a.nombre, a.num, a.nivel, a.upss, a.upssInferida ? 'sí' : '', a.clases.map(k => N.CLASES_NOMBRE[k] || k).join(', '), FL.red.deAmb[i].length, r1(FL.salida.dM[i]), BANDAS[FL.salida.banda[i]][0]]));
    const hojas = [['Ambientes', amb]];
    if (!FL.matriz) calculaMatriz();
    if (FL.matriz && FL.gruposM) { const M = [['De \\ A'].concat(FL.gruposM.map(g => g[0]))]; FL.gruposM.forEach((g, i) => M.push([g[0]].concat(FL.matriz[i].map(r1)))); hojas.push(['Distancias entre UPSS', M]); }
    const rel = [['UPSS A', 'UPSS B', 'Tipo', 'Máximo (m)', 'Distancia (m)', 'Cumple', 'Por qué', 'Nota']]; for (const x of evaluaRelaciones()) rel.push([x.rel.a, x.rel.b, x.rel.tipo, x.rel.maxM || '', x.falta ? '' : r1(x.dM), x.falta ? 'no se encontró «' + x.falta + '»' : x.ev.cumple ? 'sí' : 'NO', x.ev ? x.ev.motivo : '', x.rel.nota || '']); hojas.push(['Relaciones exigidas', rel]);
    if (!FL.flujos) calculaFlujos();
    const fl = [['Flujo', 'Distancia (m)', 'Cruza', 'Ambientes atravesados']]; for (const f of FL.flujos) fl.push([f.nombre, f.ruta ? r1(f.dM) : f.falta, f.cruces ? f.cruces.map(c => etA(c.i) + ' [' + c.clases.map(k => N.CLASES_NOMBRE[k]).join(', ') + ']').join('; ') : '', f.ruta ? f.ruta.ambientes.map(etA).join(' → ') : '']); hojas.push(['Flujos', fl]);
    const pu = [['Puerta', 'Id', 'Ancho (m)', 'De dónde sale el ancho', 'Ambiente A', 'Ambiente B', 'Salida', 'Por qué']]; for (const n of FL.red.nodos) if (n.tipo === 'puerta') { const p = FL.pue[n.k]; pu.push([p.nombre, p.e, Math.round(p.ancho * 100) / 100, p.anchoDe, n.a >= 0 ? etA(n.a) : '(sin ambiente)', n.b >= 0 ? etA(n.b) : '(sin ambiente)', n.salida ? 'sí' : '', n.porSalida || '']); } hojas.push(['Puertas', pu]);
    excel(hojas, 'flujos-hospitalarios-' + nombreProy() + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  V.alCambiarModelo.push(() => { FL.red = null; FL.amb = []; FL.pue = []; FL.pts = null; FL.nivelesP2 = null; FL.estado = 'nada'; if (FL.ventana) pinta(); });
  V.alMostrarTodo.push(() => { V.limpiaCapa(); V.quitaCortePlanta(); });
  V.flujos = { FL, elementosEn, enAmbiente, huellaDe };
}
