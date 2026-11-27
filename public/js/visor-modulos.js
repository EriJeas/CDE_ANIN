/*
 * MODULOS DEL VISOR (v0.4) que replican los del Visor BIM Federado sobre el visor liviano del CDE:
 *  - INVENTARIO: tabla de elementos del ambito (filtros del visor) con facetas (Niveles, Categorias, Familias, Modelos),
 *    columnas de cualquier parametro del indice, agrupar, buscar, exportar CSV/Excel, aislar las filas en el 3D.
 *  - CONJUNTOS E INTERFERENCIAS: conjuntos guardados (lo visible, la seleccion), interferencias entre dos conjuntos por
 *    cajas con tolerancia en cm y confirmacion por geometria (triangulo contra triangulo), y lectura del XML de
 *    interferencias de Navisworks (clashresult / Element ID) para verlas sobre el modelo y crear incidencias.
 *  - COMPARAR VERSIONES: dos versiones del mismo modelo (servidor: parametros por UniqueId, lib/comparar.js; aqui:
 *    geometria por cajas con desplazamiento comun descontado, como cvDesplazamientoComun/cvCambioGeo del visor);
 *    colores en el 3D (nuevo verde, eliminado rojo como fantasma de la version antigua, modificado ambar), KPIs y barras
 *    que filtran la lista, Excel con 3 hojas y CSV.
 *  - PLANOS (PDF): dos revisiones de un plano superpuestas (A en rojo, B en cian: lo comun queda oscuro), cortina,
 *    lado a lado; zoom con la rueda y arrastre; desplazamiento fino de B si las hojas no coinciden.
 * Recibe V (estado y funciones del visor) en monta(V). Las funciones puras llevan "Pura." para poder probarse solas.
 */
export function monta(V) {
  const { THREE, esc, api, num, ventana, barras, panel, PID, DIMS, PALETA, hexLin, f3 } = V;
  const $ = (id) => document.getElementById(id);
  const descarga = (nombre, contenido, tipo) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], { type: tipo || 'text/csv;charset=utf-8' })); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const csvDe = (filas) => '﻿' + filas.map(f => f.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const excel = (hojas, nombre) => { if (!window.XLSX) { alert('La librería de Excel no cargó; usa CSV.'); return; } const wb = XLSX.utils.book_new(); for (const [n, filas] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n.slice(0, 31)); XLSX.writeFile(wb, nombre); };
  const actual = () => V.LISTA.find(l => l.vid === V.VID);

  // =====================================================================================================================
  // INVENTARIO
  // =====================================================================================================================
  const INV = { cols: [], facetas: {}, agrupar: '', q: '', soloVisible: true, filas: [], params: null, ventana: null };
  try { INV.cols = JSON.parse(localStorage.getItem('cde.inv.cols.' + PID) || '[]'); } catch (e) {}
  V.MODULOS.inventario = () => {
    const c = panel('Inventario', '<p class="pista">La tabla de elementos del ámbito (los filtros del visor), con facetas, columnas de cualquier parámetro, agrupación, buscador y exportación. Clic en una fila selecciona el elemento; doble clic lo acerca.</p><div class="filab"><button class="primario" id="invAbrir">Abrir inventario</button></div>');
    c.querySelector('#invAbrir').onclick = abreInventario;
    if (V.EL) abreInventario();
  };
  async function abreInventario() {
    if (!V.G || !V.EL) return;
    if (INV.ventana && document.body.contains(INV.ventana)) { INV.ventana.closest('.ventana').style.zIndex = 90; return; }
    const w = ventana('Inventario', '<div class="inv"><div class="facetas" id="invFac"></div><div class="tabla"><div class="filab" style="margin:0 0 6px">' +
      '<input id="invQ" placeholder="Buscar en la tabla…" style="max-width:220px"><select id="invAgr" style="width:150px"><option value="">Sin agrupar</option>' + Object.entries(DIMS).map(([k, n]) => '<option value="' + k + '">Agrupar por ' + n.toLowerCase() + '</option>').join('') + '</select>' +
      '<button id="invCols">Columnas</button><label style="margin:0;display:flex;gap:4px;align-items:center"><input type="checkbox" id="invVis" checked style="width:auto"> solo lo visible en 3D</label><span class="crece" style="flex:1"></span><button id="invAislar" title="Deja visibles en el 3D solo las filas de la tabla">Aislar filas</button><button id="invCsv">CSV</button><button id="invXls">Excel</button></div>' +
      '<div class="cuerpo"><table id="invTabla"></table></div><div class="pista" id="invPie" style="margin-top:4px"></div></div></div>', { x: 220, y: 70, ancho: Math.min(1100, innerWidth - 240), alto: Math.min(620, innerHeight - 90), alCerrar: () => { INV.ventana = null; } });
    INV.ventana = w;
    w.querySelector('#invQ').oninput = (e) => { INV.q = e.target.value; pintaInv(); };
    w.querySelector('#invAgr').onchange = (e) => { INV.agrupar = e.target.value; pintaInv(); };
    w.querySelector('#invVis').onchange = (e) => { INV.soloVisible = e.target.checked; pintaInv(); };
    w.querySelector('#invCols').onclick = (e) => selectorColumnas(e.currentTarget);
    w.querySelector('#invAislar').onclick = () => { const L = filasInv(); V.muestraSolo(new Set(L.map(x => x.e)), true); };
    w.querySelector('#invCsv').onclick = () => descarga('inventario-' + (actual() ? actual().contenedor : 'modelo') + '.csv', csvDe(tablaInv()));
    w.querySelector('#invXls').onclick = () => excel([['Inventario', tablaInv()]], 'inventario-' + (actual() ? actual().contenedor : 'modelo') + '.xlsx');
    // v0.29.3: mientras llega la tabla se dice, y si el servidor falla se muestra por qué (antes la ventana quedaba vacía sin explicación)
    const pie = w.querySelector('#invPie'); pie.textContent = '⏳ Cargando la tabla de elementos…';
    try { await cargaInv(); pintaInv(); } catch (e) { pie.innerHTML = '<span style="color:#e07a6a">No se pudo cargar el inventario: ' + esc(e.message) + '</span>'; }
  }
  async function cargaInv() {
    const qs = new URLSearchParams({ cols: INV.cols.join(',') });
    for (const f of V.FILTROS) if (f.tipo === 'dim' && f.valores.size) qs.set(f.dim, [...f.valores].join('\u0001'));
    const r = await api('/api/modelos/' + PID + '/' + V.VID + '/inventario?' + qs);
    INV.datos = r; INV.filas = r.filas;
    if (!INV.params) { const P = await api('/api/modelos/' + PID + '/' + V.VID + '/parametros'); INV.params = Array.isArray(P) ? P : (P.parametros || []); }
  }
  /** Las filas que pasan facetas, buscador y (si se pide) lo visible en 3D. */
  function filasInv() {
    const q = INV.q.toLowerCase(), F = INV.facetas, vis = INV.soloVisible ? V.VIS : null;
    return INV.filas.filter(x => (!vis || vis.has(x.e)) && Object.entries(F).every(([k, s]) => !s.size || s.has(x[k])) && (!q || (x.nombre + ' ' + x.modelo + ' ' + x.cat + ' ' + x.fam + ' ' + x.tip + ' ' + x.niv + ' ' + Object.values(x.c).join(' ')).toLowerCase().includes(q)));
  }
  const COLS_FIJAS = [['nombre', 'Nombre'], ['modelo', 'Modelo'], ['cat', 'Categoría'], ['fam', 'Familia'], ['tip', 'Tipo'], ['niv', 'Nivel']];
  function tablaInv() { const L = filasInv(), cols = INV.datos.cols; return [['Id'].concat(COLS_FIJAS.map(c => c[1]), cols.map(c => c.nombre))].concat(L.map(x => [x.e].concat(COLS_FIJAS.map(c => x[c[0]]), cols.map(c => x.c[c.id] || '')))); }
  function pintaInv() {
    const w = INV.ventana; if (!w) return;
    const L = filasInv(), cols = INV.datos.cols;
    // facetas (cuentan sobre lo que pasa el resto de facetas)
    const fac = w.querySelector('#invFac'); let h = '';
    for (const [k, titulo] of [['niv', 'Niveles'], ['cat', 'Categorías'], ['fam', 'Familias'], ['modelo', 'Modelos']]) {
      const base = INV.filas.filter(x => (!INV.soloVisible || !V.VIS || V.VIS.has(x.e)) && Object.entries(INV.facetas).every(([kk, s]) => kk === k || !s.size || s.has(x[kk])));
      const cu = new Map(); for (const x of base) cu.set(x[k], (cu.get(x[k]) || 0) + 1);
      const sel = INV.facetas[k] || new Set();
      h += '<h4>' + titulo + ' <span class="pista">' + cu.size + '</span></h4>' + [...cu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([v, n]) => '<div class="f' + (sel.has(v) ? ' on' : '') + '" data-k="' + k + '" data-v="' + esc(v) + '"><span title="' + esc(v) + '">' + esc(v || '(vacío)') + '</span><i>' + num(n) + '</i></div>').join('');
    }
    fac.innerHTML = h;
    fac.querySelectorAll('.f').forEach(f => f.onclick = () => { const s = INV.facetas[f.dataset.k] || (INV.facetas[f.dataset.k] = new Set()); if (s.has(f.dataset.v)) s.delete(f.dataset.v); else s.add(f.dataset.v); pintaInv(); });
    // tabla
    const cab = '<tr><th>Id</th>' + COLS_FIJAS.map(c => '<th>' + c[1] + '</th>').join('') + cols.map(c => '<th title="' + esc(c.nombre) + '">' + esc(c.nombre.replace(/^.*\/\s*/, '')) + '</th>').join('') + '</tr>';
    const fila = (x) => '<tr class="clic' + (V.SEL && V.SEL.e === x.e ? ' sel' : '') + '" data-e="' + x.e + '"><td class="num">' + x.e + '</td>' + COLS_FIJAS.map(c => '<td title="' + esc(x[c[0]]) + '">' + esc(x[c[0]]) + '</td>').join('') + cols.map(c => '<td title="' + esc(x.c[c.id] || '') + '">' + esc(x.c[c.id] || '') + '</td>').join('') + '</tr>';
    let cuerpo = '';
    if (INV.agrupar) { const g = new Map(); for (const x of L) { const k = x[INV.agrupar]; if (!g.has(k)) g.set(k, []); g.get(k).push(x); } for (const [k, xs] of [...g.entries()].sort((a, b) => b[1].length - a[1].length)) cuerpo += '<tr class="grupo-fila"><td colspan="' + (7 + cols.length) + '">' + esc(k || '(vacío)') + ' · ' + num(xs.length) + '</td></tr>' + xs.slice(0, 500).map(fila).join(''); }
    else cuerpo = L.slice(0, 1500).map(fila).join('');
    w.querySelector('#invTabla').innerHTML = cab + cuerpo;
    w.querySelector('#invPie').textContent = num(L.length) + ' filas' + (L.length > 1500 && !INV.agrupar ? ' (se muestran 1 500; exporta para verlas todas)' : '') + ' · ' + num(INV.datos.total) + ' en el ámbito' + (INV.datos.total > INV.datos.tope ? ' · tope del servidor ' + num(INV.datos.tope) + ': acota con filtros' : '');
    w.querySelectorAll('tr[data-e]').forEach(tr => { tr.onclick = () => { const G = V.G, i = G.porE.get(+tr.dataset.e); if (i != null) V.selecciona(G.elem[i], true); w.querySelectorAll('tr.sel').forEach(t => t.classList.remove('sel')); tr.classList.add('sel'); }; tr.ondblclick = () => V.encuadra(V.cajaDe(new Set([+tr.dataset.e]))); });
  }
  function selectorColumnas(ancla) {
    const d = document.createElement('div'); d.className = 'colsel'; const r = ancla.getBoundingClientRect(); d.style.left = Math.min(r.left, innerWidth - 330) + 'px'; d.style.top = (r.bottom + 4) + 'px';
    const pinta = (q) => { q = (q || '').toLowerCase(); d.querySelector('.l').innerHTML = INV.params.filter(p => !/^●/.test(p.nombre) && (!q || p.nombre.toLowerCase().includes(q))).slice(0, 300).map(p => '<label><input type="checkbox" value="' + p.id + '"' + (INV.cols.includes(p.id) ? ' checked' : '') + '> ' + esc(p.nombre) + '</label>').join(''); d.querySelectorAll('input[type=checkbox]').forEach(ch => ch.onchange = async () => { const id = +ch.value; if (ch.checked) { if (INV.cols.length >= 40) { ch.checked = false; return; } INV.cols.push(id); } else INV.cols = INV.cols.filter(x => x !== id); localStorage.setItem('cde.inv.cols.' + PID, JSON.stringify(INV.cols)); await cargaInv(); pintaInv(); }); };
    d.innerHTML = '<input placeholder="Buscar parámetro…" style="margin-bottom:6px"><div class="l"></div>'; document.body.appendChild(d); pinta('');
    d.querySelector('input').oninput = (e) => pinta(e.target.value); d.querySelector('input').focus();
    const fuera = (e) => { if (!d.contains(e.target)) { d.remove(); document.removeEventListener('mousedown', fuera); } }; setTimeout(() => document.addEventListener('mousedown', fuera), 0);
  }
  V.alCargarModelo.push(() => { INV.params = null; INV.facetas = {}; if (INV.ventana) cargaInv().then(pintaInv); });
  V.alSeleccionar.push(() => { if (INV.ventana) INV.ventana.querySelectorAll('tr[data-e]').forEach(tr => tr.classList.toggle('sel', !!(V.SEL && +tr.dataset.e === V.SEL.e))); });

  // =====================================================================================================================
  // CONJUNTOS E INTERFERENCIAS
  // =====================================================================================================================
  const CJ = { lista: [], coloreados: new Set() };
  const claveCj = () => 'cde.conjuntos.' + PID + '.' + ((actual() || {}).cid || V.VID);
  function cargaCj() { try { CJ.lista = JSON.parse(localStorage.getItem(claveCj()) || '[]'); } catch (e) { CJ.lista = []; } }
  function guardaCj() { localStorage.setItem(claveCj(), JSON.stringify(CJ.lista)); }
  V.MODULOS.conjuntos = () => {
    cargaCj();
    const c = panel('Conjuntos', '<div class="filab"><button class="primario" id="cjVisible" title="Guarda como conjunto los elementos visibles ahora (filtros, aislados)">Guardar lo visible</button><button id="cjSel" title="Guarda la selección como conjunto">Guardar selección</button></div><div id="cjLista"></div>' +
      '<div class="grupo"><h4>Interferencias<span class="hint">entre dos conjuntos, por geometría</span></h4><div class="filab"><label style="margin:0;flex:1">Conjunto A<select id="cjA"></select></label><label style="margin:0;flex:1">Conjunto B<select id="cjB"></select></label></div>' +
      '<div class="filab"><label style="margin:0">Tolerancia (cm)<input id="cjTol" type="number" value="1" min="0" step="0.5" style="width:90px"></label><label style="margin:0 0 0 8px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="cjGeo" checked style="width:auto"> Solo confirmadas por geometría</label></div>' +
      '<div class="filab"><button class="primario" id="cjCalc">Calcular interferencias</button></div><p class="pista">Primero por cajas (solape mayor que la tolerancia); con la casilla marcada, cada pareja se confirma triángulo contra triángulo.</p></div>' +
      '<div class="grupo"><h4>Navisworks<span class="hint">informe de interferencias en XML</span></h4><input type="file" id="cjXml" accept=".xml"><p class="pista">Exporta el informe de Clash Detective como XML; aquí se leen los Element ID de Revit y se ven sobre el modelo.</p></div>');
    c.querySelector('#cjVisible').onclick = () => { const G = V.G; if (!G) return; const es = V.VIS ? [...V.VIS] : G.elem.map(x => x.e); nuevoCj(es); };
    c.querySelector('#cjSel').onclick = () => { if (V.SEL) nuevoCj([V.SEL.e]); };
    c.querySelector('#cjCalc').onclick = () => { const A = CJ.lista.find(x => x.id === c.querySelector('#cjA').value), B = CJ.lista.find(x => x.id === c.querySelector('#cjB').value); if (!A || !B) return alert('Elige los dos conjuntos.'); interferencias(A, B, +c.querySelector('#cjTol').value || 0, c.querySelector('#cjGeo').checked); };
    c.querySelector('#cjXml').onchange = (e) => { const f = e.target.files[0]; if (!f) return; f.text().then(t => navisworks(t, f.name)).catch(err => alert(err.message)); };
    pintaCj();
  };
  function nuevoCj(es) { const nombre = prompt('Nombre del conjunto (' + es.length + ' elementos):', 'Conjunto ' + (CJ.lista.length + 1)); if (!nombre) return; CJ.lista.push({ id: 'c' + Date.now().toString(36), nombre, color: PALETA[CJ.lista.length % PALETA.length], es }); guardaCj(); pintaCj(); }
  function pintaCj() {
    const l = $('cjLista'); if (!l) return;
    l.innerHTML = CJ.lista.map(x => '<div class="filtro"><div class="ft"><i class="pt" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + x.color + '"></i><b>' + esc(x.nombre) + '</b><span class="pista">' + num(x.es.length) + '</span><button data-ver="' + x.id + '" title="Aislar en el 3D">Ver</button><button data-col="' + x.id + '" class="' + (CJ.coloreados.has(x.id) ? 'activo' : '') + '" title="Pintar del color del conjunto">Color</button><button data-ren="' + x.id + '" title="Renombrar">✎</button><button data-bor="' + x.id + '" title="Borrar">✕</button></div></div>').join('') || '<p class="pista">Sin conjuntos. Filtra o aísla lo que te interese y pulsa <b>Guardar lo visible</b>.</p>';
    l.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => V.muestraSolo(new Set(CJ.lista.find(x => x.id === b.dataset.ver).es), true));
    l.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { const id = b.dataset.col; if (CJ.coloreados.has(id)) CJ.coloreados.delete(id); else CJ.coloreados.add(id); aplicaColoresCj(); pintaCj(); });
    l.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { const x = CJ.lista.find(y => y.id === b.dataset.ren), n = prompt('Nuevo nombre:', x.nombre); if (n) { x.nombre = n; guardaCj(); pintaCj(); } });
    l.querySelectorAll('[data-bor]').forEach(b => b.onclick = () => { if (!confirm('¿Borrar el conjunto?')) return; CJ.lista = CJ.lista.filter(x => x.id !== b.dataset.bor); CJ.coloreados.delete(b.dataset.bor); guardaCj(); aplicaColoresCj(); pintaCj(); });
    for (const s of ['cjA', 'cjB']) { const el = $(s); if (el) { const v = el.value; el.innerHTML = '<option value="">—</option>' + CJ.lista.map(x => '<option value="' + x.id + '">' + esc(x.nombre) + ' (' + x.es.length + ')</option>').join(''); el.value = v; } }
  }
  function aplicaColoresCj() { const T = new Map(); for (const x of CJ.lista) if (CJ.coloreados.has(x.id)) { const rgb = hexLin(x.color); for (const e of x.es) T.set(e, rgb); } V.TINTES = T; V.aplicaTintes(); }

  // --- geometria: cajas, solape y triangulo contra triangulo ---
  /** Solape de dos cajas [x1,y1,z1,x2,y2,z2]: el menor de los tres ejes (negativo = separadas). Pura. */
  function solape(a, b) { return Math.min(Math.min(a[3], b[3]) - Math.max(a[0], b[0]), Math.min(a[4], b[4]) - Math.max(a[1], b[1]), Math.min(a[5], b[5]) - Math.max(a[2], b[2])); }
  const EPS = 1e-9;
  /** ¿El segmento p->q cruza el triangulo (a,b,c)? Möller–Trumbore con t en [0,1]. Pura. */
  function segmentoTri(p, q, a, b, c) {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz; if (Math.abs(det) < EPS) return false;
    const f = 1 / det, sx = p[0] - a[0], sy = p[1] - a[1], sz = p[2] - a[2];
    const u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) return false;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz); if (v < 0 || u + v > 1) return false;
    const t = f * (e2x * qx + e2y * qy + e2z * qz); return t >= 0 && t <= 1;
  }
  /** ¿Se cruzan dos triangulos? (alguna arista de uno atraviesa al otro). Pura. */
  function triTri(A, B) { return segmentoTri(A[0], A[1], B[0], B[1], B[2]) || segmentoTri(A[1], A[2], B[0], B[1], B[2]) || segmentoTri(A[2], A[0], B[0], B[1], B[2]) || segmentoTri(B[0], B[1], A[0], A[1], A[2]) || segmentoTri(B[1], B[2], A[0], A[1], A[2]) || segmentoTri(B[2], B[0], A[0], A[1], A[2]); }
  /** Los triangulos de un elemento que tocan una caja (region de solape). */
  function triangulosEn(D, x, caja) {
    const P = D.posiciones, out = [];
    for (const [src, ini, n] of V.trozosDe(x, D)) for (let k = ini; k < ini + n; k += 3) {
      const t = [0, 1, 2].map(j => { const i = src[k + j]; return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; });
      const mn = [Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1]), Math.min(t[0][2], t[1][2], t[2][2])], mx = [Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1]), Math.max(t[0][2], t[1][2], t[2][2])];
      if (mn[0] <= caja[3] && mx[0] >= caja[0] && mn[1] <= caja[4] && mx[1] >= caja[1] && mn[2] <= caja[5] && mx[2] >= caja[2]) out.push(t);
    }
    return out;
  }
  const TOPE_TRI = 400000;
  /** ¿Dos elementos se cruzan de verdad? true / false / null (demasiados triangulos para verificar). */
  function confirmaGeo(D, xa, xb, caja) {
    const TA = triangulosEn(D, xa, caja), TB = triangulosEn(D, xb, caja);
    if (!TA.length || !TB.length) return false;
    if (TA.length * TB.length > TOPE_TRI) return null;
    for (const a of TA) for (const b of TB) if (triTri(a, b)) return true;
    return false;
  }
  function interferencias(A, B, tolCm, confirmar) {
    const G = V.G; if (!G) return;
    const C = V.cajasDe(G), tol = tolCm / 100, res = [], t0 = performance.now();
    const ea = A.es.filter(e => C.get(e)), eb = B.es.filter(e => C.get(e));
    for (const a of ea) { const ca = C.get(a); for (const b of eb) { if (a === b) continue; const cb = C.get(b); const s = solape(ca, cb); if (s > tol) res.push({ a, b, s, caja: [Math.max(ca[0], cb[0]), Math.max(ca[1], cb[1]), Math.max(ca[2], cb[2]), Math.min(ca[3], cb[3]), Math.min(ca[4], cb[4]), Math.min(ca[5], cb[5])] }); } }
    let noVerif = 0;
    if (confirmar) for (const r of res) { const xa = G.elem[G.porE.get(r.a)], xb = G.elem[G.porE.get(r.b)]; r.geo = confirmaGeo(G, xa, xb, r.caja); if (r.geo == null) noVerif++; }
    const L = confirmar ? res.filter(r => r.geo !== false) : res;
    L.sort((x, y) => y.s - x.s);
    muestraInterferencias(L, { titulo: 'Interferencias · ' + A.nombre + ' × ' + B.nombre, nota: num(L.length) + ' interferencia(s) de ' + num(ea.length) + ' × ' + num(eb.length) + ' elementos, tolerancia ' + tolCm + ' cm' + (confirmar ? ' · confirmadas por geometría' + (noVerif ? ' (' + noVerif + ' sin verificar: demasiados triángulos)' : '') : ' · solo cajas') + ' · ' + Math.round(performance.now() - t0) + ' ms' });
  }
  function muestraInterferencias(L, o) {
    const info = (e) => V.info(e) || { nombre: 'id ' + e, cat: '', niv: '' };
    const w = ventana(o.titulo, '<div class="pista">' + esc(o.nota) + '</div><div class="filab" style="margin:6px 0"><input id="itQ" placeholder="Buscar…" style="max-width:220px"><span style="flex:1"></span><button id="itTodas" title="Aislar en el 3D todos los elementos con interferencia">Aislar todas</button><button id="itCsv">CSV</button></div><div style="overflow:auto;max-height:calc(100% - 70px)"><table id="itTabla"></table></div>', { x: 220, y: 70, ancho: Math.min(1000, innerWidth - 240), alto: Math.min(560, innerHeight - 90) });
    const filas = () => { const q = (w.querySelector('#itQ').value || '').toLowerCase(); return L.filter(r => !q || (info(r.a).nombre + ' ' + info(r.b).nombre + ' ' + info(r.a).cat + ' ' + info(r.b).cat + ' ' + (r.nombre || '')).toLowerCase().includes(q)); };
    const pinta = () => {
      const F = filas();
      w.querySelector('#itTabla').innerHTML = '<tr><th>#</th>' + (o.navis ? '<th>Nombre</th><th>Estado</th><th>Distancia</th>' : '<th>Solape (cm)</th><th>Geometría</th>') + '<th>Elemento A</th><th>Elemento B</th><th></th></tr>' +
        F.slice(0, 2000).map((r, i) => { const ia = info(r.a), ib = info(r.b); return '<tr class="clic" data-i="' + L.indexOf(r) + '"><td class="num">' + (i + 1) + '</td>' + (o.navis ? '<td>' + esc(r.nombre) + '</td><td>' + esc(r.estado) + '</td><td class="num">' + esc(r.dist) + '</td>' : '<td class="num">' + (r.s * 100).toFixed(1) + '</td><td>' + (r.geo === true ? '✓ cruzan' : r.geo == null ? (r.geo === undefined ? 'cajas' : 'sin verificar') : '—') + '</td>') + '<td title="' + esc(ia.nombre) + '">' + esc(ia.nombre) + ' <span class="pista">' + esc(ia.cat) + (ia.niv ? ' · ' + esc(ia.niv) : '') + '</span>' + (r.aFalta ? ' <span class="pista">(no está en esta versión)</span>' : '') + '</td><td title="' + esc(ib.nombre) + '">' + esc(ib.nombre) + ' <span class="pista">' + esc(ib.cat) + (ib.niv ? ' · ' + esc(ib.niv) : '') + '</span>' + (r.bFalta ? ' <span class="pista">(no está en esta versión)</span>' : '') + '</td><td><button data-inc="' + L.indexOf(r) + '" title="Crear incidencia de interferencia con estos dos elementos">⚑</button></td></tr>'; }).join('');
      w.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; const r = L[+tr.dataset.i], es = [r.a, r.b].filter(e => V.G.porE.has(e)); if (!es.length) return; const T = new Map(); T.set(r.a, hexLin('#e07a6a')); T.set(r.b, hexLin('#5aa9e6')); V.TINTES = T; V.aplicaTintes(); V.muestraSolo(new Set(es), true); w.querySelectorAll('tr.sel').forEach(t => t.classList.remove('sel')); tr.classList.add('sel'); });
      w.querySelectorAll('button[data-inc]').forEach(b => b.onclick = () => { const r = L[+b.dataset.inc], ia = info(r.a), ib = info(r.b); V.nuevaIncidencia([r.a, r.b].filter(e => V.G.porE.has(e)), { tipo: 'interferencia', titulo: 'Interferencia: ' + ia.nombre + ' × ' + ib.nombre, descripcion: (o.navis ? 'Navisworks ' + r.nombre + ' (' + r.estado + ', distancia ' + r.dist + ')' : 'Solape de cajas ' + (r.s * 100).toFixed(1) + ' cm' + (r.geo === true ? ', confirmada por geometría' : '')) + '.\nA: ' + ia.nombre + ' (' + ia.cat + ')\nB: ' + ib.nombre + ' (' + ib.cat + ')' }); });
    };
    w.querySelector('#itQ').oninput = pinta;
    w.querySelector('#itTodas').onclick = () => { const s = new Set(); for (const r of filas()) { if (V.G.porE.has(r.a)) s.add(r.a); if (V.G.porE.has(r.b)) s.add(r.b); } if (s.size) V.muestraSolo(s, true); };
    w.querySelector('#itCsv').onclick = () => descarga('interferencias.csv', csvDe([['#', o.navis ? 'Nombre' : 'Solape (cm)', o.navis ? 'Estado' : 'Geometría', 'Id A', 'Elemento A', 'Categoría A', 'Id B', 'Elemento B', 'Categoría B']].concat(filas().map((r, i) => { const ia = info(r.a), ib = info(r.b); return [i + 1, o.navis ? r.nombre : (r.s * 100).toFixed(1), o.navis ? r.estado : (r.geo === true ? 'cruzan' : r.geo == null ? 'sin verificar' : 'cajas'), r.a, ia.nombre, ia.cat, r.b, ib.nombre, ib.cat]; }))));
    pinta();
  }
  /** Lee el XML de Clash Detective: [{ nombre, estado, dist, a, b }] por Element ID. Pura. */
  function parseaNavisworks(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml'), out = [];
    const idDe = (obj) => {
      let id = null;
      for (const t of obj.querySelectorAll('smarttag, objectattribute')) { const n = (t.querySelector('name') || {}).textContent || '', v = (t.querySelector('value') || {}).textContent || ''; if (/^(element\s*id|id|elementid)$/i.test(n.trim()) && /^\d+$/.test(v.trim())) { id = +v.trim(); break; } }
      if (id == null) { const pl = obj.querySelector('pathlink'); if (pl) { const m = /\[(\d{3,12})\]/.exec(pl.textContent || ''); if (m) id = +m[1]; } }
      return id;
    };
    for (const r of doc.querySelectorAll('clashresult')) {
      const objs = [...r.querySelectorAll('clashobject')]; if (objs.length < 2) continue;
      out.push({ nombre: r.getAttribute('name') || '', estado: r.getAttribute('status') || '', dist: r.getAttribute('distance') || '', a: idDe(objs[0]), b: idDe(objs[1]) });
    }
    return out;
  }
  function navisworks(xml, nombre) {
    const L = parseaNavisworks(xml); if (!L.length) return alert('No se encontraron <clashresult> en el XML.');
    const G = V.G; let sin = 0;
    for (const r of L) { if (r.a == null || !G.porE.has(r.a)) { r.aFalta = true; sin++; } if (r.b == null || !G.porE.has(r.b)) { r.bFalta = true; } }
    muestraInterferencias(L, { navis: true, titulo: 'Navisworks · ' + nombre, nota: num(L.length) + ' interferencia(s) del informe' + (sin ? ' · ' + sin + ' con elementos que no están en esta versión' : '') });
  }
  V.alMostrarTodo.push(() => { CJ.coloreados.clear(); V.TINTES = new Map(); V.aplicaTintes(); });

  // =====================================================================================================================
  // COMPARAR VERSIONES
  // =====================================================================================================================
  const CV = { res: null, fantasma: null, filtro: { e: '', cat: '', q: '' }, atenuar: true, A: null };
  const centro = (c) => [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2], tamano = (c) => [c[3] - c[0], c[4] - c[1], c[5] - c[2]];
  const mediana = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  /** El desplazamiento que comparte la mayoria de las parejas (otro punto base), o null (cvDesplazamientoComun). Pura. */
  function desplazamientoComun(pares, tol) {
    const L = pares.filter(p => p && p[0] && p[1]); if (L.length < 20) return null;
    const paso = Math.max(1, Math.floor(L.length / 5000)), M = []; for (let i = 0; i < L.length; i += paso) M.push(L[i]);
    const d = M.map(([a, b]) => { const ca = centro(a), cb = centro(b); return [ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]]; });
    const m = [0, 1, 2].map(k => mediana(d.map(x => x[k])));
    if (Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2])) <= tol) return null;
    const cerca = d.filter(x => Math.abs(x[0] - m[0]) <= tol && Math.abs(x[1] - m[1]) <= tol && Math.abs(x[2] - m[2]) <= tol).length;
    if (cerca / d.length < 0.5) return null;
    return { x: m[0], y: m[1], z: m[2], parte: cerca / d.length };
  }
  /** Que cambio en la geometria (caja nueva cn, caja vieja cv), o null (cvCambioGeo). Pura. */
  function cambioGeo(cn, cv, tol, off) {
    if (!cn || !cv) return null;
    const a = centro(cn), b = centro(cv), o = off || { x: 0, y: 0, z: 0 }, d = [a[0] - b[0] - o.x, a[1] - b[1] - o.y, a[2] - b[2] - o.z];
    const sn = tamano(cn), sv = tamano(cv), ds = [sn[0] - sv[0], sn[1] - sv[1], sn[2] - sv[2]];
    const mov = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])) > tol, tam = Math.max(Math.abs(ds[0]), Math.abs(ds[1]), Math.abs(ds[2])) > tol;
    if (!mov && !tam) return null;
    return { mov, tam, dist: Math.hypot(d[0], d[1], d[2]) };
  }
  const resumenElem = (x) => x.e === 'nuevo' ? 'nuevo' : x.e === 'eliminado' ? 'eliminado' : x.e === 'igual' ? 'sin cambios' : [x.g && (x.g.mov ? 'se movió ' + x.g.dist.toFixed(2) + ' m' + (x.g.tam ? ' y cambió de tamaño' : '') : 'cambió de tamaño'), x.c.length && (x.c.length + (x.c.length === 1 ? ' parámetro: ' : ' parámetros: ') + x.c.slice(0, 2).map(c => c.p.replace(/^.*\/\s*/, '')).join(', ') + (x.c.length > 2 ? '…' : ''))].filter(Boolean).join(' · ') || 'modificado';
  V.MODULOS.comparar = () => {
    const act = actual(), otras = act ? V.LISTA.filter(l => l.cid === act.cid && l.vid !== act.vid) : [];
    const c = panel('Comparar versiones', !V.G ? '<p class="pista">Carga un modelo.</p>' : '<div class="grupo"><h4>Versiones<span class="hint">la nueva es la que está cargada</span></h4>' +
      '<label>Versión nueva (B)</label><div class="pista">' + (act ? 'v' + act.n + ' ' + esc(act.revision) + ' · ' + esc(act.archivo) : '') + '</div>' +
      '<label>Versión antigua (A)</label><select id="cvA">' + (otras.length ? otras.map(l => '<option value="' + l.vid + '"' + (CV.A === l.vid ? ' selected' : '') + '>v' + l.n + ' ' + esc(l.revision) + ' · ' + esc(l.archivo) + (l.geometria ? '' : ' (sin geometría)') + '</option>').join('') : '<option value="">Este contenedor no tiene otra versión con índice</option>') + '</select>' +
      '<div class="filab"><label style="margin:0">Tolerancia geometría (cm)<input id="cvTol" type="number" value="2" min="0" step="0.5" style="width:90px"></label><label style="margin:0 0 0 8px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="cvAten"' + (CV.atenuar ? ' checked' : '') + ' style="width:auto"> Atenuar lo que no cambió</label></div>' +
      '<div class="filab"><button class="primario" id="cvGo"' + (otras.length ? '' : ' disabled') + '>Comparar</button><button id="cvSalir">Salir</button></div></div><div id="cvRes"></div>');
    if (!V.G) return;
    c.querySelector('#cvGo').onclick = () => comparar(c.querySelector('#cvA').value, +c.querySelector('#cvTol').value || 0).catch(e => { c.querySelector('#cvRes').innerHTML = '<div class="aviso rojo">' + esc(e.message) + '</div>'; });
    c.querySelector('#cvSalir').onclick = salirComparacion;
    c.querySelector('#cvAten').onchange = (e) => { CV.atenuar = e.target.checked; if (CV.res) pintaColoresCv(); };
    if (CV.res) pintaCv();
  };
  async function comparar(vidA, tolCm) {
    if (!vidA) return; CV.A = vidA;
    const out = $('cvRes'); out.innerHTML = '<p class="pista">Comparando parámetros en el servidor…</p>';
    const r = await api('/api/modelos/' + PID + '/comparar?a=' + vidA + '&b=' + V.VID);
    out.innerHTML = '<p class="pista">Bajando la geometría de la versión antigua…</p>';
    let DA = null; try { const g = await fetch('/api/modelos/' + PID + '/' + vidA + '/geometria'); if (g.ok) DA = V.parseaCdeg(await g.arrayBuffer()); } catch (e) {}
    // geometria: cajas de A y B, desplazamiento comun, cambio por elemento
    const tol = tolCm / 100, CB = V.cajasDe(V.G), CA = DA ? V.cajasDe(DA) : null;
    if (CA) {
      const pares = r.elementos.filter(x => x.eA != null && x.eB != null).map(x => [CB.get(x.eB), CA.get(x.eA)]);
      const off = desplazamientoComun(pares, tol); r.desplazamiento = off && off.parte >= 0.9 ? off : null; r.desplazamientoDetectado = off;
      for (const x of r.elementos) if (x.eA != null && x.eB != null) { const g = cambioGeo(CB.get(x.eB), CA.get(x.eA), tol, r.desplazamiento); if (g) { x.g = g; x.e = 'modificado'; } }
      // el resumen con la geometria
      const R = r.resumen; R.tot = { nuevo: 0, eliminado: 0, modificado: 0, igual: 0, geo: 0, par: 0 }; const pc = new Map();
      for (const x of r.elementos) { R.tot[x.e]++; if (x.g) R.tot.geo++; if (x.e === 'modificado' && x.c.length) R.tot.par++; const k = x.cat || '(sin categoría)'; if (!pc.has(k)) pc.set(k, { cat: k, nuevo: 0, eliminado: 0, modificado: 0, igual: 0 }); pc.get(k)[x.e]++; }
      R.porCat = [...pc.values()].sort((a, b) => (b.nuevo + b.eliminado + b.modificado) - (a.nuevo + a.eliminado + a.modificado));
    }
    r.tolCm = tolCm; r.conGeo = !!CA; CV.res = r; CV.DA = DA; CV.filtro = { e: '', cat: '', q: '' };
    fantasmaEliminados(); pintaColoresCv(); pintaCv();
  }
  /** La version antigua, solo sus elementos eliminados, en rojo translucido sobre el modelo. */
  function fantasmaEliminados() {
    quitaFantasma();
    const DA = CV.DA, r = CV.res; if (!DA) return;
    const elim = r.elementos.filter(x => x.e === 'eliminado' && DA.porE.has(x.eA)); if (!elim.length) return;
    const idx = []; const rojo = hexLin('#e0584a'), col = DA.colores;
    for (const x of elim) { const el = DA.elem[DA.porE.get(x.eA)]; for (const [src, ini, n] of V.trozosDe(el, DA)) for (let k = ini; k < ini + n; k++) idx.push(src[k]); for (let v = el.vo; v < el.vo + el.vc; v++) { col[v * 3] = rojo[0]; col[v * 3 + 1] = rojo[1]; col[v * 3 + 2] = rojo[2]; } }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(DA.posiciones, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); geo.computeVertexNormals();
    if (r.desplazamiento) geo.translate(r.desplazamiento.x, r.desplazamiento.y, r.desplazamiento.z);
    const m = new THREE.Mesh(geo, V.MAT.fantasma); m.renderOrder = 4; m.userData.fantasma = true; V.escena.add(m); CV.fantasma = m; V.extraRaycast.push(m); V.dibuja();
  }
  function quitaFantasma() { if (CV.fantasma) { V.escena.remove(CV.fantasma); CV.fantasma.geometry.dispose(); const i = V.extraRaycast.indexOf(CV.fantasma); if (i >= 0) V.extraRaycast.splice(i, 1); CV.fantasma = null; } }
  V.alClicFantasma.push((h) => { if (!CV.res || !CV.DA) return; const x = V.elementoDe(h, CV.DA); if (!x) return; const fila = CV.res.elementos.find(y => y.eA === x.e); if (fila) { CV.sel = fila; pintaCv(); const li = document.querySelector('.listacmp .it.sel'); if (li) li.scrollIntoView({ block: 'nearest' }); } });
  const COLOR_CV = { nuevo: hexLin('#4fbf4f'), modificado: hexLin('#f0b640'), igual: hexLin('#4a443a') };
  function pintaColoresCv() { const T = new Map(); for (const x of CV.res.elementos) { if (x.eB == null) continue; if (x.e === 'igual') { if (CV.atenuar) T.set(x.eB, COLOR_CV.igual); } else T.set(x.eB, COLOR_CV[x.e]); } V.TINTES = T; V.aplicaTintes(); }
  function filasCv() { const F = CV.filtro, q = (F.q || '').toLowerCase(); return CV.res.elementos.filter(x => (F.e ? x.e === F.e : x.e !== 'igual') && (!F.cat || (x.cat || '(sin categoría)') === F.cat) && (!q || (x.nom + ' ' + x.cat + ' ' + x.fam + ' ' + x.tip + ' ' + x.niv + ' ' + x.uid).toLowerCase().includes(q))); }
  function pintaCv() {
    const out = $('cvRes'); if (!out || !CV.res) return;
    const r = CV.res, T = r.resumen.tot, F = CV.filtro;
    const kpi = (k, t) => '<div class="kpi ' + k + (F.e === k ? ' activo' : '') + '" data-e="' + k + '"><div class="n">' + num(T[k] || 0) + '</div><div class="t">' + t + '</div></div>';
    let h = '<div class="pista" style="margin:6px 0">v' + r.a.n + ' ' + esc(r.a.revision) + ' → v' + r.b.n + ' ' + esc(r.b.revision) + ' · ' + num(r.elementos.length) + ' elementos reconocidos por UniqueId' + (r.conGeo ? ' · geometría ±' + r.tolCm + ' cm' : ' · la versión antigua no tiene geometría: solo parámetros') + '</div>';
    h += '<div class="kpis cmp">' + kpi('nuevo', 'nuevos') + kpi('eliminado', 'eliminados') + kpi('modificado', 'modificados') + kpi('igual', 'sin cambios') + '</div>';
    if (T.modificado) h += '<div class="pista" style="margin:4px 0">modificados: ' + num(T.geo || 0) + ' por geometría · ' + num(T.par || 0) + ' por parámetros</div>';
    if (r.desplazamiento) h += '<div class="aviso ambar">La versión antigua estaba desplazada en conjunto (' + f3(r.desplazamiento.x) + ', ' + f3(-r.desplazamiento.z) + ', ' + f3(r.desplazamiento.y) + ' m, el ' + Math.round(r.desplazamiento.parte * 100) + '% de los elementos): se descontó.</div>';
    else if (r.desplazamientoDetectado) h += '<div class="aviso ambar">Parte del modelo (' + Math.round(r.desplazamientoDetectado.parte * 100) + '%) comparte un desplazamiento: se cuenta como cambio.</div>';
    if (r.globales && r.globales.length) h += '<div class="aviso ambar"><b>Cambios globales</b> (en casi todos los elementos; no se cuentan por elemento): ' + r.globales.map(g => esc(g.p.replace(/^.*\/\s*/, '')) + ' <span class="pista">' + esc(g.ejemplo.antes) + ' → ' + esc(g.ejemplo.ahora) + '</span>').join(' · ') + '</div>';
    h += '<div class="filab"><button id="cvAislar" title="Deja visibles solo los elementos con cambios (y los eliminados en rojo)">Aislar cambios</button><button id="cvXls">Excel</button><a class="boton" href="/api/modelos/' + PID + '/comparar?a=' + r.a.id + '&b=' + r.b.id + '&formato=csv">CSV</a></div>';
    h += '<div class="grupo"><h4>Por categoría<span class="hint">clic filtra la lista</span></h4><div id="cvCat"></div></div>';
    if (r.resumen.porPar && r.resumen.porPar.length) h += '<div class="grupo"><h4>Parámetros más cambiados</h4>' + r.resumen.porPar.slice(0, 8).map(p => '<div class="filab" style="margin:2px 0;font-size:12px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.p) + '">' + esc(p.p) + '</span><i class="mono">' + num(p.n) + '</i></div>').join('') + '</div>';
    h += '<div class="leyenda"><span><i class="pt nuevo"></i>nuevo</span><span><i class="pt eliminado"></i>eliminado (fantasma de A)</span><span><i class="pt modificado"></i>modificado</span><span><i class="pt igual"></i>sin cambios</span></div>';
    h += '<input id="cvQ" placeholder="Buscar elemento…" value="' + esc(F.q || '') + '" style="margin:6px 0"><div class="listacmp" id="cvLista"></div>';
    out.innerHTML = h;
    out.querySelectorAll('.kpi').forEach(k => k.onclick = () => { F.e = F.e === k.dataset.e ? '' : k.dataset.e; pintaCv(); });
    const cats = r.resumen.porCat.map(c => [c.cat, c.nuevo + c.eliminado + c.modificado]).filter(c => c[1]).slice(0, 40);
    out.querySelector('#cvCat').innerHTML = barras(cats, F.cat, null); out.querySelectorAll('#cvCat .barra[data-k]').forEach(b => b.onclick = () => { F.cat = F.cat === b.dataset.k ? '' : b.dataset.k; pintaCv(); });
    out.querySelector('#cvAislar').onclick = () => { const s = new Set(r.elementos.filter(x => x.e !== 'igual' && x.eB != null).map(x => x.eB)); V.muestraSolo(s, true); };
    out.querySelector('#cvXls').onclick = () => excelCv();
    out.querySelector('#cvQ').oninput = (e) => { F.q = e.target.value; pintaListaCv(); };
    pintaListaCv();
  }
  function pintaListaCv() {
    const l = $('cvLista'); if (!l) return; const L = filasCv();
    l.innerHTML = L.slice(0, 800).map(x => '<div class="it' + (CV.sel === x ? ' sel' : '') + '" data-u="' + esc(x.uid) + '"><i class="pt ' + x.e + '"></i><div><div>' + esc(x.nom || ('id ' + (x.eB != null ? x.eB : x.eA))) + ' <span class="pista">' + esc(x.cat) + (x.niv ? ' · ' + esc(x.niv) : '') + '</span></div><div class="d">' + esc(resumenElem(x)) + '</div>' + (CV.sel === x && x.c.length ? '<table style="margin-top:4px">' + x.c.map(c => '<tr><td class="pista">' + esc(c.p) + '</td><td>' + esc(c.antes || '—') + ' → <b>' + esc(c.ahora || '—') + '</b></td></tr>').join('') + '</table>' : '') + '</div></div>').join('') + (L.length > 800 ? '<div class="pista">… ' + num(L.length - 800) + ' más: filtra o exporta</div>' : '') + (L.length ? '' : '<p class="pista">Nada con ese filtro.</p>');
    l.querySelectorAll('.it').forEach(it => it.onclick = () => { const x = CV.res.elementos.find(y => y.uid === it.dataset.u); CV.sel = x; pintaListaCv(); if (x.eB != null && V.G.porE.has(x.eB)) { V.selecciona(V.G.elem[V.G.porE.get(x.eB)], true); V.encuadra(V.cajaDe(new Set([x.eB]))); } else if (CV.DA && x.eA != null) { const c = V.cajasDe(CV.DA).get(x.eA); if (c) { const o = CV.res.desplazamiento || { x: 0, y: 0, z: 0 }; V.encuadra(new THREE.Box3(new THREE.Vector3(c[0] + o.x, c[1] + o.y, c[2] + o.z), new THREE.Vector3(c[3] + o.x, c[4] + o.y, c[5] + o.z))); } } });
  }
  function excelCv() {
    const r = CV.res, T = r.resumen.tot, act = actual();
    const resumen = [['Comparación de versiones del modelo', ''], ['Proyecto', $('proyectoNombre').textContent], ['Modelo', act ? act.contenedor : ''], ['Versión más nueva', 'v' + r.b.n + ' ' + r.b.revision + ' · ' + r.b.archivo], ['Versión más antigua', 'v' + r.a.n + ' ' + r.a.revision + ' · ' + r.a.archivo], ['Elementos reconocidos', 'por UniqueId de Revit (' + r.elementos.length + ')'], ['Tolerancia de geometría (cm)', r.conGeo ? r.tolCm : 'sin geometría de A'], ['Desplazamiento descontado a la versión más antigua', r.desplazamiento ? f3(r.desplazamiento.x) + ', ' + f3(-r.desplazamiento.z) + ', ' + f3(r.desplazamiento.y) + ' m' : 'ninguno'], ['Generado', new Date().toLocaleString('es-PE')], [],
      ['Estado', 'Elementos'], ['Nuevos', T.nuevo], ['Eliminados', T.eliminado], ['Modificados', T.modificado], ['   por geometría (se movió o cambió de tamaño)', T.geo || 0], ['   por parámetros', T.par || 0], ['Sin cambios', T.igual], [], ['Cambios globales (no contados por elemento)', '']].concat((r.globales || []).map(g => [g.p, g.ejemplo.antes + ' → ' + g.ejemplo.ahora]));
    const elems = [['Estado', 'Categoría', 'Nombre', 'Familia', 'Tipo', 'Nivel', 'Qué cambió', 'UniqueId', 'Id nueva', 'Id antigua']].concat(r.elementos.filter(x => x.e !== 'igual').map(x => [x.e, x.cat, x.nom, x.fam, x.tip, x.niv, resumenElem(x), x.uid, x.eB == null ? '' : x.eB, x.eA == null ? '' : x.eA]));
    const pars = [['Categoría', 'Nombre', 'UniqueId', 'Parámetro', 'Antes', 'Ahora']]; for (const x of r.elementos) for (const c of x.c) pars.push([x.cat, x.nom, x.uid, c.p, c.antes, c.ahora]);
    excel([['Resumen', resumen], ['Elementos', elems], ['Parámetros', pars]], 'comparacion-' + (act ? act.contenedor : 'modelo') + '-v' + r.a.n + '-v' + r.b.n + '.xlsx');
  }
  function salirComparacion() { CV.res = null; CV.DA = null; CV.sel = null; quitaFantasma(); V.TINTES = new Map(); V.aplicaTintes(); const o = $('cvRes'); if (o) o.innerHTML = ''; }
  V.alCambiarModelo.push(() => { CV.res = null; CV.DA = null; quitaFantasma(); });
  V.alMostrarTodo.push(() => { if (CV.res) pintaColoresCv(); });

  // =====================================================================================================================
  // PLANOS (PDF): comparar dos revisiones
  // =====================================================================================================================
  const PL = { contenedores: null, A: null, B: null, modo: 'superponer', pag: 1, escala: 1, tx: 0, ty: 0, dx: 0, dy: 0, cortina: 0.5, ventana: null, docs: {} };
  V.MODULOS.planos = async () => {
    const c = panel('Planos (PDF)', '<p class="pista">Compara dos revisiones de un plano en PDF: superpuestas (A en rojo, B en cian; lo que no cambió queda oscuro), con cortina o lado a lado.</p><div id="plSel" class="pista">Buscando planos…</div>');
    if (!PL.contenedores) {
      const [p1, p2] = await Promise.all([api('/api/proyectos/' + PID + '/contenedores?tipo=plano'), api('/api/proyectos/' + PID + '/contenedores?tipo=documento')]);
      PL.contenedores = p1.contenedores.concat(p2.contenedores).filter(x => x.ultima && /\.pdf$/i.test(x.ultima.archivo || ''));
    }
    if (!PL.contenedores.length) { c.querySelector('#plSel').innerHTML = '<div class="aviso ambar">No hay contenedores con PDF en este proyecto. Sube los planos (PDF) al CDE y vuelve aquí.</div>'; return; }
    c.querySelector('#plSel').innerHTML = '<label>Plano</label><select id="plC">' + PL.contenedores.map(x => '<option value="' + x.id + '">' + esc(x.nombre) + ' <span class="pista">(' + esc(x.estado) + ')</span></option>').join('') + '</select>' +
      '<div class="filab"><label style="margin:0;flex:1">Revisión A (antigua)<select id="plA"></select></label><label style="margin:0;flex:1">Revisión B (nueva)<select id="plB"></select></label></div>' +
      '<div class="filab"><label style="margin:0">Página<input id="plPag" type="number" value="1" min="1" style="width:70px"></label><label style="margin:0;flex:1">Modo<select id="plModo"><option value="superponer">Superponer (diferencias en color)</option><option value="deslizar">Cortina</option><option value="lado">Lado a lado</option><option value="a">Solo A</option><option value="b">Solo B</option></select></label></div>' +
      '<div class="filab"><button class="primario" id="plGo">Comparar planos</button></div><p class="pista">Rueda: zoom · arrastrar: mover · con cortina, arrastra la línea dorada. Si las hojas no coinciden, ajusta el desplazamiento de B en la ventana.</p>';
    const vers = async () => { const det = await api('/api/proyectos/' + PID + '/contenedores/' + c.querySelector('#plC').value); const pdfs = det.versiones.filter(v => /\.pdf$/i.test(v.archivo || '')); const op = pdfs.map(v => '<option value="' + v.id + '">v' + v.n + ' ' + esc(v.revision) + ' · ' + esc(v.archivo) + '</option>').join(''); c.querySelector('#plA').innerHTML = op; c.querySelector('#plB').innerHTML = op; if (pdfs.length > 1) c.querySelector('#plA').value = pdfs[1].id; };
    c.querySelector('#plC').onchange = vers; await vers();
    c.querySelector('#plGo').onclick = () => { PL.modo = c.querySelector('#plModo').value; PL.pag = +c.querySelector('#plPag').value || 1; abrePlanos(c.querySelector('#plA').value, c.querySelector('#plB').value, PL.contenedores.find(x => x.id === c.querySelector('#plC').value)).catch(e => alert(e.message)); };
  };
  async function pdfDe(vid) {
    if (PL.docs[vid]) return PL.docs[vid];
    if (!window.pdfjsLib) throw new Error('pdf.js no cargó.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const r = await fetch('/api/proyectos/' + PID + '/versiones/' + vid + '/descargar'); if (!r.ok) throw new Error('No se pudo bajar el PDF (' + r.status + ').');
    const doc = await pdfjsLib.getDocument({ data: await r.arrayBuffer() }).promise; PL.docs[vid] = doc; return doc;
  }
  async function renderPagina(doc, n, escala) { const pag = await doc.getPage(Math.min(Math.max(1, n), doc.numPages)); const vp = pag.getViewport({ scale: escala }); const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; return cv; }
  /** Superposicion: tinta de A en rojo, tinta de B en cian, lo comun oscuro. Pura sobre ImageData. */
  function superpone(ia, ib, dx, dy) {
    const w = ia.width, h = ia.height, out = new ImageData(w, h), A = ia.data, B = ib.data, O = out.data, wb = ib.width, hb = ib.height;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, ga = (A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114), xb = x - dx, yb = y - dy;
      let gb = 255; if (xb >= 0 && yb >= 0 && xb < wb && yb < hb) { const j = (yb * wb + xb) * 4; gb = B[j] * 0.299 + B[j + 1] * 0.587 + B[j + 2] * 0.114; }
      const ta = 255 - ga, tb = 255 - gb;
      O[i] = 255 - tb; O[i + 1] = 255 - ta; O[i + 2] = 255 - ta; O[i + 3] = 255;
    }
    return out;
  }
  async function abrePlanos(vidA, vidB, cont) {
    if (!vidA || !vidB) return; if (vidA === vidB && PL.modo !== 'a' && PL.modo !== 'b') return alert('Elige dos revisiones distintas.');
    if (PL.ventana && document.body.contains(PL.ventana)) PL.ventana.closest('.ventana').remove();
    const w = ventana('Planos · ' + (cont ? cont.nombre : ''), '<div class="planos"><div class="filab" style="margin:0"><span class="pista" id="plInfo">Cargando PDF…</span><span style="flex:1"></span><label style="margin:0">Desplazar B (px) X<input id="plDx" type="number" value="0" style="width:64px"></label><label style="margin:0">Y<input id="plDy" type="number" value="0" style="width:64px"></label><button id="plAjustar">Ajustar a la ventana</button><button id="plPng">PNG</button></div><div class="area" id="plArea"><canvas id="plCv"></canvas><div class="corte oculto" id="plCorte"></div></div></div>', { x: 220, y: 70, ancho: Math.min(1200, innerWidth - 240), alto: Math.min(760, innerHeight - 90), alCerrar: () => { PL.ventana = null; } });
    PL.ventana = w;
    const [da, db] = await Promise.all([pdfDe(vidA), pdfDe(vidB)]);
    const [ca, cb] = await Promise.all([renderPagina(da, PL.pag, 2), renderPagina(db, PL.pag, 2)]);
    PL.ca = ca; PL.cb = cb; PL.dx = 0; PL.dy = 0; PL.cortina = 0.5;
    w.querySelector('#plInfo').textContent = 'A: ' + ca.width / 2 + '×' + ca.height / 2 + ' pt · B: ' + cb.width / 2 + '×' + cb.height / 2 + ' pt · página ' + PL.pag + ' de ' + Math.max(da.numPages, db.numPages) + (ca.width !== cb.width || ca.height !== cb.height ? ' · las hojas tienen distinto tamaño' : '');
    const cv = w.querySelector('#plCv'), area = w.querySelector('#plArea'), corte = w.querySelector('#plCorte');
    const compone = () => {
      const ctx = cv.getContext('2d'), m = PL.modo;
      if (m === 'lado') { cv.width = ca.width + cb.width + 20; cv.height = Math.max(ca.height, cb.height); ctx.fillStyle = '#1a1611'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(ca, 0, 0); ctx.drawImage(cb, ca.width + 20, 0); corte.classList.add('oculto'); return; }
      cv.width = Math.max(ca.width, cb.width + PL.dx); cv.height = Math.max(ca.height, cb.height + PL.dy); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (m === 'a') { ctx.drawImage(ca, 0, 0); corte.classList.add('oculto'); return; }
      if (m === 'b') { ctx.drawImage(cb, PL.dx, PL.dy); corte.classList.add('oculto'); return; }
      if (m === 'superponer') { const ta = document.createElement('canvas'); ta.width = cv.width; ta.height = cv.height; const ta2 = ta.getContext('2d'); ta2.fillStyle = '#fff'; ta2.fillRect(0, 0, ta.width, ta.height); ta2.drawImage(ca, 0, 0); const ia = ta2.getImageData(0, 0, ta.width, ta.height), ib = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height); ctx.putImageData(superpone(ia, ib, PL.dx, PL.dy), 0, 0); corte.classList.add('oculto'); return; }
      // cortina: A a la izquierda de la linea, B a la derecha
      const xc = Math.round(cv.width * PL.cortina); ctx.drawImage(ca, 0, 0); ctx.save(); ctx.beginPath(); ctx.rect(xc, 0, cv.width - xc, cv.height); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(xc, 0, cv.width - xc, cv.height); ctx.drawImage(cb, PL.dx, PL.dy); ctx.restore(); corte.classList.remove('oculto'); posCorte();
    };
    const aplicaVista = () => { cv.style.transform = 'translate(' + PL.tx + 'px,' + PL.ty + 'px) scale(' + PL.escala + ')'; posCorte(); };
    const posCorte = () => { corte.style.left = (PL.tx + cv.width * PL.cortina * PL.escala) + 'px'; };
    const ajusta = () => { const r = area.getBoundingClientRect(); PL.escala = Math.min((r.width - 20) / cv.width, (r.height - 20) / cv.height); PL.tx = (r.width - cv.width * PL.escala) / 2; PL.ty = (r.height - cv.height * PL.escala) / 2; aplicaVista(); };
    area.onwheel = (e) => { e.preventDefault(); const r = area.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = e.deltaY < 0 ? 1.15 : 1 / 1.15; PL.tx = mx - (mx - PL.tx) * k; PL.ty = my - (my - PL.ty) * k; PL.escala *= k; aplicaVista(); };
    let arr = null; area.onmousedown = (e) => { if (e.target === corte) { arr = { corte: true }; } else arr = { x: e.clientX - PL.tx, y: e.clientY - PL.ty }; e.preventDefault(); };
    window.addEventListener('mousemove', (e) => { if (!arr || !document.body.contains(area)) return; if (arr.corte) { const r = area.getBoundingClientRect(); PL.cortina = Math.min(1, Math.max(0, ((e.clientX - r.left) - PL.tx) / (cv.width * PL.escala))); compone(); } else { PL.tx = e.clientX - arr.x; PL.ty = e.clientY - arr.y; aplicaVista(); } });
    window.addEventListener('mouseup', () => { arr = null; });
    w.querySelector('#plDx').onchange = (e) => { PL.dx = +e.target.value || 0; compone(); }; w.querySelector('#plDy').onchange = (e) => { PL.dy = +e.target.value || 0; compone(); };
    w.querySelector('#plAjustar').onclick = ajusta;
    w.querySelector('#plPng').onclick = () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'planos-' + (cont ? cont.nombre : 'comparacion') + '-' + PL.modo + '.png'; a.click(); };
    compone(); ajusta();
  }
  V.alCambiarModelo.push(() => { PL.docs = {}; });

  // funciones puras expuestas para pruebas
  V.puras = { solape, triTri, segmentoTri, desplazamientoComun, cambioGeo, parseaNavisworks, superpone };
}
