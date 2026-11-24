/* CDE ANIN · Tableros de control: indicadores y gráficos de las incidencias de uno o varios proyectos (por disciplina, carpeta,
 * documento, estado…). Cada barra filtra el resto del tablero y cada gráfico se puede agrandar. Aquí vive también la exportación
 * del registro de revisiones (uno o más proyectos, con sus incidencias y la descripción de cada una). */
(function () {
  const N = CDE.N, { esc, api, num, app } = N;
  const corto = (e) => String(e || '').split('@')[0], hoy = () => new Date().toISOString().slice(0, 10), dia = (s) => String(s || '').slice(0, 10);
  const CERRADAS = ['cerrada', 'rechazada'], MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mesTxt = (k) => { const m = /^(\d{4})-(\d{2})/.exec(k || ''); return m ? MES[+m[2] - 1] + ' ' + m[1].slice(2) : k; };
  const T = N.TB = N.TB || { proyectos: null, filtros: {}, q: '', datos: [], lista: [] };

  /** Las incidencias (con documento, carpeta y revisión) de los proyectos elegidos. */
  async function trae(proyectos) {
    const partes = await Promise.all(proyectos.map(p => api('/api/proyectos/' + p.id + '/incidencias?detalle=1').then(d => d.incidencias.map(i => Object.assign(i, { pid: p.id, proyecto: p.codigo || p.nombre }))).catch(() => [])));
    return [].concat(...partes);
  }

  // ───────── dimensiones por las que se agrupa y se filtra
  const DIM = {
    proyecto: { t: 'Proyecto', de: (i) => i.proyecto },
    estado: { t: 'Estado', de: (i) => i.estado },
    disciplina: { t: 'Disciplina', de: (i) => i.disciplina },
    carpeta: { t: 'Carpeta', de: (i) => i.carpeta },
    documento: { t: 'Documento', de: (i) => i.documento },
    tipo: { t: 'Tipo', de: (i) => i.tipo },
    prioridad: { t: 'Prioridad', de: (i) => i.prioridad },
    etapa: { t: 'Etapa / RIBA', de: (i) => i.etapa },
    asignado: { t: 'Asignado a', de: (i) => corto(i.asignado) },
    origen: { t: 'Origen', de: (i) => i.origen === 'autodesk-forma' ? 'Autodesk Forma' : (i.origen || 'CDE') },
    mes: { t: 'Mes de creación', de: (i) => dia(i.creado).slice(0, 7) },
    situacion: { t: 'Situación', de: (i) => i.vencida ? 'Vencidas' : CERRADAS.includes(i.estado) ? 'Cerradas' : 'Abiertas' }
  };
  const SIN = '(sin dato)';
  const valor = (k, i) => { const v = DIM[k].de(i); return v == null || v === '' ? SIN : String(v); };
  const pasa = (i, salvo) => { for (const k of Object.keys(T.filtros)) { if (k === salvo) continue; const f = T.filtros[k];
      if (k === 'situacion') { if (f === 'Abiertas' ? CERRADAS.includes(i.estado) : f === 'Cerradas' ? !CERRADAS.includes(i.estado) : f === 'Vencidas' ? !i.vencida : f === 'Contractuales' ? !i.contractual : false) return false; }
      else if (valor(k, i) !== f) return false; }
    if (T.q) { const q = T.q.toLowerCase(); if (!((i.titulo || '') + ' ' + (i.descripcion || '') + ' ' + (i.codigo || '') + ' ' + (i.documento || '')).toLowerCase().includes(q)) return false; }
    return true; };
  /** Cuenta por dimensión; el filtro de la propia dimensión no se aplica, para poder cambiar de barra sin quitarlo antes. */
  const cuenta = (k) => { const m = new Map(); for (const i of T.datos) { if (!pasa(i, k)) continue; const v = valor(k, i); m.set(v, (m.get(v) || 0) + 1); }
    const L = [...m.entries()]; return k === 'mes' ? L.sort((a, b) => a[0].localeCompare(b[0])) : L.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };

  // ───────── gráficos
  /** Rótulo de la barra: el mes en letras y, de una carpeta, sus dos últimos tramos (el principio se repite en todas). */
  const rot = (k, v) => { if (k === 'mes') return mesTxt(v); if (k === 'carpeta') { const t = v.split('/'); return t.length > 2 ? '…/' + t.slice(-2).join('/') : v; } return v; };
  const barras = (k, tope) => { const L = cuenta(k), max = Math.max(1, ...L.map(x => x[1])), ver = tope ? L.slice(0, tope) : L, act = T.filtros[k];
    return (ver.map(([v, n]) => '<button class="tbf' + (act === v ? ' activa' : '') + (act && act !== v ? ' apagada' : '') + '" data-dim="' + k + '" data-val="' + esc(v) + '" title="' + esc(v) + ' · ' + n + '"><span class="k">' + esc(rot(k, v)) + '</span><span class="b"><i style="width:' + Math.max(2, Math.round(100 * n / max)) + '%"></i></span><span class="v">' + num(n) + '</span></button>').join('') || '<div class="pista">Sin incidencias con estos filtros.</div>') +
      (tope && L.length > tope ? '<div class="pista tbmas">y ' + (L.length - tope) + ' más · pulsa «Agrandar» para verlas todas</div>' : ''); };
  /** Creadas y cerradas por mes, en columnas. */
  const columnas = (alto) => { const m = new Map(); const pon = (k, c) => { if (!k) return; if (!m.has(k)) m.set(k, [0, 0]); m.get(k)[c]++; };
    for (const i of T.datos) { if (!pasa(i, 'mes')) continue; pon(dia(i.creado).slice(0, 7), 0); if (i.cerrado) pon(dia(i.cerrado).slice(0, 7), 1); }
    const L = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-18), max = Math.max(1, ...L.map(x => Math.max(x[1][0], x[1][1]))), act = T.filtros.mes;
    if (!L.length) return '<div class="pista">Sin incidencias con estos filtros.</div>';
    return '<div class="tbcols" style="height:' + (alto || 190) + 'px">' + L.map(([k, [a, c]]) => '<button class="tbcol' + (act === k ? ' activa' : '') + (act && act !== k ? ' apagada' : '') + '" data-dim="mes" data-val="' + k + '" title="' + mesTxt(k) + ': ' + a + ' creadas, ' + c + ' cerradas"><span class="cs"><i class="a" style="height:' + Math.round(100 * a / max) + '%"><em>' + (a || '') + '</em></i><i class="c" style="height:' + Math.round(100 * c / max) + '%"><em>' + (c || '') + '</em></i></span><span class="k">' + mesTxt(k) + '</span></button>').join('') + '</div><div class="tbley"><span><i class="a"></i>Creadas</span><span><i class="c"></i>Cerradas</span></div>'; };
  const GRAF = [['estado', 'Por estado', 8], ['disciplina', 'Por disciplina', 10], ['mes', 'Creadas y cerradas por mes', 0], ['carpeta', 'Por carpeta', 10], ['documento', 'Por documento', 10], ['asignado', 'Por responsable asignado', 10], ['tipo', 'Por tipo', 8], ['prioridad', 'Por prioridad', 6], ['etapa', 'Por etapa / RIBA', 8], ['origen', 'Por origen', 6]];
  const cuerpo = (k, tope, grande) => k === 'mes' ? columnas(grande ? 380 : 190) : barras(k, tope);

  function pinta(p, todos) {
    const sel = todos.filter(x => T.proyectos.has(x.id)), L = T.lista = T.datos.filter(i => pasa(i)), ab = L.filter(i => !CERRADAS.includes(i.estado));
    const ant = ab.length ? Math.round(ab.reduce((s, i) => s + (i.antiguedad_dias || 0), 0) / ab.length) : 0, sit = T.filtros.situacion;
    const kpi = (v, n, t, cls) => '<button class="tbk' + (v && sit === v ? ' activa' : '') + (cls ? ' ' + cls : '') + '"' + (v ? ' data-dim="situacion" data-val="' + v + '"' : ' disabled') + '><b>' + n + '</b><span>' + t + '</span></button>';
    const graf = GRAF.filter(g => g[0] !== 'proyecto').slice(); if (sel.length > 1) graf.unshift(['proyecto', 'Por proyecto', 10]);
    const chips = Object.keys(T.filtros).map(k => '<button class="dact" data-quita="' + k + '" title="Quitar este filtro"><span>' + esc(DIM[k].t) + ':</span> ' + esc(k === 'mes' ? mesTxt(T.filtros[k]) : T.filtros[k]) + ' ✕</button>').join('');
    const fila = (i) => '<tr class="clic" data-h="#/p/' + i.pid + '/incidencias/' + i.id + '">' + (sel.length > 1 ? '<td>' + esc(i.proyecto) + '</td>' : '') + '<td class="mono">#' + i.numero + '</td><td class="tbtit"><b>' + esc(i.titulo) + '</b>' + (i.descripcion ? '<div class="pista">' + esc(String(i.descripcion).slice(0, 220)) + (i.descripcion.length > 220 ? '…' : '') + '</div>' : '') + '</td><td><span class="tbest e-' + esc(i.estado) + '">' + esc(i.estado) + '</span>' + (i.vencida ? ' <span class="tbest e-vencida">vencida</span>' : '') + '</td><td>' + esc(i.disciplina) + '</td><td class="mono">' + esc(i.documento) + '</td><td class="pista">' + esc(i.carpeta) + '</td><td>' + esc(corto(i.asignado)) + '</td><td class="pista">' + dia(i.creado) + '</td><td class="pista">' + esc(i.vencimiento || '') + '</td></tr>';
    app.innerHTML = N.marco(p, '/tableros', '', '<button id="tbExp">Descargar en Excel</button>') +
      '<div class="tbbarra"><div class="tbpsel"><button id="tbProy">Proyectos <b>' + sel.length + '</b> <span class="pista">' + esc(sel.length === 1 ? (sel[0].codigo || sel[0].nombre) : 'de ' + todos.length) + '</span> ▾</button><div class="tbplista oculto" id="tbPL">' + todos.map(x => '<label class="rvchk"><input type="checkbox" value="' + x.id + '"' + (T.proyectos.has(x.id) ? ' checked' : '') + '> <b>' + esc(x.codigo || '') + '</b> ' + esc(x.nombre) + '</label>').join('') + '<div class="fila" style="justify-content:space-between;margin-top:8px"><button class="mini" id="tbPT">Todos</button><button class="primario mini" id="tbPOk">Aplicar</button></div></div></div>' +
      '<input id="tbQ" placeholder="Buscar en título, descripción o documento" value="' + esc(T.q) + '">' + (chips || T.q ? '<div class="dactivos">' + chips + '<button class="mini" id="tbLimpia">Quitar filtros</button></div>' : '<span class="pista">Pulsa una barra o un indicador para filtrar todo el tablero.</span>') + '</div>' +
      '<div class="tbkpis">' + kpi('', num(L.length), 'Incidencias') + kpi('Abiertas', num(ab.length), 'Abiertas') + kpi('Cerradas', num(L.length - ab.length), 'Cerradas', 'bien') + kpi('Vencidas', num(L.filter(i => i.vencida).length), 'Vencidas', 'mal') + kpi('Contractuales', num(L.filter(i => i.contractual).length), 'Contractuales') + kpi('', L.length ? Math.round(100 * (L.length - ab.length) / L.length) + ' %' : '—', 'Atendidas') + kpi('', ant + ' d', 'Antigüedad media de las abiertas') + kpi('', num(new Set(L.map(i => i.documento).filter(Boolean)).size), 'Documentos con incidencias') + '</div>' +
      '<div class="tbgrid">' + graf.map(([k, t, tope]) => '<section class="tarjeta tbg' + (k === 'mes' ? ' ancha' : '') + '"><header><h2>' + t + '</h2><button class="mini" data-grande="' + k + '" title="Ver este gráfico en grande, con todos sus valores">⤢ Agrandar</button></header><div class="tbc">' + cuerpo(k, tope) + '</div></section>').join('') + '</div>' +
      '<div class="tarjeta" style="margin-top:14px"><div class="fila" style="align-items:center"><h2 style="margin:0;flex:1">Detalle <span class="pista">' + num(L.length) + ' incidencia(s)</span></h2></div><div class="acctabla" style="margin-top:10px"><table><thead><tr>' + (sel.length > 1 ? '<th>Proyecto</th>' : '') + '<th>ID</th><th>Incidencia</th><th>Estado</th><th>Disciplina</th><th>Documento</th><th>Carpeta</th><th>Asignado a</th><th>Creada</th><th>Vence</th></tr></thead><tbody>' + (L.slice(0, 300).map(fila).join('') || '<tr><td colspan="10" class="pista">No hay incidencias con estos filtros.</td></tr>') + '</tbody></table></div>' + (L.length > 300 ? '<div class="pista" style="margin-top:6px">Se muestran las 300 primeras; el Excel las lleva todas.</div>' : '') + '</div>' + N.cierra();
    const otra = () => pinta(p, todos);
    const filtra = (el) => { const k = el.dataset.dim, v = el.dataset.val; if (T.filtros[k] === v) delete T.filtros[k]; else T.filtros[k] = v; otra(); refresca(); };
    app.querySelectorAll('[data-dim]').forEach(b => b.onclick = () => filtra(b));
    app.querySelectorAll('[data-quita]').forEach(b => b.onclick = () => { delete T.filtros[b.dataset.quita]; otra(); refresca(); });
    app.querySelectorAll('tr.clic').forEach(tr => tr.onclick = () => location.hash = tr.dataset.h);
    const lim = document.getElementById('tbLimpia'); if (lim) lim.onclick = () => { T.filtros = {}; T.q = ''; otra(); refresca(); };
    const q = document.getElementById('tbQ'); q.onchange = () => { T.q = q.value.trim(); otra(); refresca(); };
    document.getElementById('tbProy').onclick = () => document.getElementById('tbPL').classList.toggle('oculto');
    document.getElementById('tbPT').onclick = () => app.querySelectorAll('#tbPL input').forEach(c => c.checked = true);
    document.getElementById('tbPOk').onclick = async () => { const ids = [...app.querySelectorAll('#tbPL input:checked')].map(c => c.value); if (!ids.length) return N.toast('Elige al menos un proyecto.', 'mal'); T.proyectos = new Set(ids); T.filtros = {}; T.datos = await trae(todos.filter(x => T.proyectos.has(x.id))); otra(); refresca(); };
    document.getElementById('tbExp').onclick = () => excel(sel);
    // un gráfico en grande: la misma cuenta con todos sus valores; sigue filtrando el tablero
    app.querySelectorAll('[data-grande]').forEach(b => b.onclick = () => { const k = b.dataset.grande, g = GRAF.find(x => x[0] === k) || ['proyecto', 'Por proyecto'];
      const v = N.ventana(g[1], '<div class="tbc tbgrande" data-graf="' + k + '"></div>', { ancho: 980, alto: 640 }); refresca(); v.addEventListener('click', (e) => { const el = e.target.closest('[data-dim]'); if (el) filtra(el); }); });
    function refresca() { document.querySelectorAll('#ventanas [data-graf]').forEach(c => { c.innerHTML = cuerpo(c.dataset.graf, 0, true); }); }
  }

  async function excel(sel) {
    const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new(), L = T.lista;
    const cab = ['Proyecto', 'ID', 'Código', 'Título', 'Descripción', 'Estado', 'Vencida', 'Tipo', 'Prioridad', 'Disciplina', 'Etapa / RIBA', 'Documento', 'Carpeta', 'Revisión', 'Asignado a', 'Creado por', 'Creada', 'Vence', 'Cerrada', 'Días abierta', 'Contractual', 'Origen', 'Referencia'];
    XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([cab].concat(L.map(i => [i.proyecto, i.numero, i.codigo || '', i.titulo, i.descripcion || '', i.estado, i.vencida ? 'sí' : '', i.tipo, i.prioridad, i.disciplina, i.etapa, i.documento, i.carpeta, i.revision_numero ? '#' + i.revision_numero : '', i.asignado, i.autor, dia(i.creado), i.vencimiento || '', dia(i.cerrado), i.antiguedad_dias, i.contractual ? 'sí' : '', i.origen || '', i.referencia || '']))), 'Incidencias');
    for (const [k, t] of [['proyecto', 'Por proyecto'], ['estado', 'Por estado'], ['disciplina', 'Por disciplina'], ['carpeta', 'Por carpeta'], ['documento', 'Por documento'], ['asignado', 'Por responsable']]) { if (k === 'proyecto' && sel.length < 2) continue; const m = new Map(); L.forEach(i => { const v = valor(k, i); if (!m.has(v)) m.set(v, [0, 0, 0]); const c = m.get(v); c[0]++; if (!CERRADAS.includes(i.estado)) c[1]++; if (i.vencida) c[2]++; });
      XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([[DIM[k].t, 'Incidencias', 'Abiertas', 'Cerradas', 'Vencidas']].concat([...m.entries()].sort((a, b) => b[1][0] - a[1][0]).map(([v, c]) => [v, c[0], c[1], c[0] - c[1], c[2]]))), t); }
    XL.writeFile(wb, 'tablero-incidencias-' + (sel.length === 1 ? (sel[0].codigo || 'proyecto') : sel.length + '-proyectos') + '-' + hoy() + '.xlsx');
  }

  async function vista(pid) {
    const [p, todos] = await Promise.all([api('/api/proyectos/' + pid), api('/api/proyectos').then(d => d.proyectos || d)]);
    if (!T.proyectos || !T.proyectos.has(pid)) { T.proyectos = new Set([pid]); T.filtros = {}; T.q = ''; }
    T.proyectos = new Set([...T.proyectos].filter(x => todos.some(y => y.id === x)));
    T.datos = await trae(todos.filter(x => T.proyectos.has(x.id)));
    pinta(p, todos);
  }
  N.vistas.tableros = vista;

  /** Registro de revisiones a Excel: uno o más proyectos, con las incidencias de cada documento revisado y su descripción. */
  N.exportaRevisiones = async function (p) {
    const todos = await api('/api/proyectos').then(d => d.proyectos || d);
    const v = N.ventana('Exportar el registro de revisiones', '<label>Proyectos</label><div class="tbexpl">' + todos.map(x => '<label class="rvchk"><input type="checkbox" name="exP" value="' + x.id + '"' + (x.id === p.id ? ' checked' : '') + '> <b>' + esc(x.codigo || '') + '</b> ' + esc(x.nombre) + '</label>').join('') + '</div>' +
      '<label style="margin-top:12px">Incidencias</label><label class="rvchk"><input type="radio" name="exI" value="rev" checked> Las de los documentos revisados, con su descripción</label><label class="rvchk"><input type="radio" name="exI" value="todas"> Todas las del proyecto, con su descripción</label><label class="rvchk"><input type="radio" name="exI" value="no"> No incluir incidencias</label>' +
      '<div id="exMsg" class="pista" style="margin-top:8px"></div><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:12px"><button id="exTodos">Marcar todos</button><button class="primario" id="exOk">Descargar en Excel</button></div>', { ancho: 540, alto: 430 });
    v.querySelector('#exTodos').onclick = () => v.querySelectorAll('[name=exP]').forEach(c => c.checked = true);
    v.querySelector('#exOk').onclick = async () => {
      const ids = [...v.querySelectorAll('[name=exP]:checked')].map(c => c.value), modo = v.querySelector('[name=exI]:checked').value, b = v.querySelector('#exOk'); if (!ids.length) return N.toast('Elige al menos un proyecto.', 'mal');
      b.disabled = true; const msg = v.querySelector('#exMsg');
      try {
        const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), FR = [], FI = [], sinAcceso = [];
        for (const pr of todos.filter(x => ids.includes(x.id))) {
          msg.textContent = 'Leyendo ' + (pr.codigo || pr.nombre) + '…'; let R, I;
          try { [R, I] = await Promise.all([api('/api/proyectos/' + pr.id + '/revisiones'), modo === 'no' ? { incidencias: [] } : api('/api/proyectos/' + pr.id + '/incidencias?detalle=1')]); } catch (e) { sinAcceso.push(pr.codigo || pr.nombre); continue; }
          const cod = pr.codigo || pr.nombre, usadas = new Set();
          const filaI = (i, r) => [cod, r ? '#' + r.numero : '', r ? r.ronda : '', i.documento || (r ? r.contenedor : ''), i.carpeta || (r ? r.carpeta : ''), i.numero, i.codigo || '', i.titulo, i.descripcion || '', i.estado, i.tipo, i.prioridad, i.disciplina, i.etapa, i.asignado, i.autor, dia(i.creado), i.vencimiento || '', dia(i.cerrado), i.origen || '', i.referencia || ''];
          for (const r of R.revisiones) {
            const suyas = I.incidencias.filter(i => i.revision_id ? i.revision_id === r.id : (i.contenedor_id === r.contenedor_id && (!i.version_id || i.version_id === r.version_id)));
            FR.push([cod, r.estado, r.numero || '', r.ronda, r.nombre || '', r.contenedor, r.carpeta || '', r.flujoNombre, r.solicitada_por, r.estado === 'abierta' ? r.siguienteAccionDe.map(x => x.paso + ': ' + x.pendientes.join(', ')).join(' | ') : '', r.aprobadoPor || '', dia(r.vence), r.fechaEnvio || dia(r.abierta), r.qaRechazada ? 'QA Rejected: se reinicia' : (r.fechaRespuesta || ''), dia(r.cerrada), r.notas || '', modo === 'no' ? '' : suyas.length, modo === 'no' ? '' : suyas.filter(i => !CERRADAS.includes(i.estado)).length]);
            suyas.forEach(i => { usadas.add(i.id + ':' + r.id); FI.push(filaI(i, r)); });
          }
          if (modo === 'todas') { const conRev = new Set([...usadas].map(x => x.split(':')[0])); I.incidencias.filter(i => !conRev.has(i.id)).forEach(i => FI.push(filaI(i, null))); }
        }
        const wb = XL.utils.book_new();
        XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Proyecto', 'Estado', 'ID', 'Ronda', 'Nombre', 'Archivo', 'Carpeta', 'Flujo', 'Iniciado por', 'Siguiente acción de', 'Aprobado por', 'Límite del paso', 'Fecha de envío', 'Fecha de respuesta', 'Finalizada', 'Notas', 'Incidencias', 'Incidencias abiertas']].concat(FR)), 'Revisiones');
        if (modo !== 'no') XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Proyecto', 'Revisión', 'Ronda', 'Archivo', 'Carpeta', 'Incidencia', 'Código', 'Título', 'Descripción', 'Estado', 'Tipo', 'Prioridad', 'Disciplina', 'Etapa / RIBA', 'Asignado a', 'Creada por', 'Creada', 'Vence', 'Cerrada', 'Origen', 'Referencia']].concat(FI)), 'Incidencias');
        XL.writeFile(wb, 'revisiones-' + (ids.length === 1 ? (todos.find(x => x.id === ids[0]).codigo || 'proyecto') : ids.length + '-proyectos') + '-' + hoy() + '.xlsx');
        N.toast(FR.length + ' revisión(es)' + (modo !== 'no' ? ' y ' + FI.length + ' incidencia(s)' : '') + ' exportadas.' + (sinAcceso.length ? ' Sin acceso a: ' + esc(sinAcceso.join(', ')) + '.' : ''), 'bien'); const w = v.closest('.ventana'); if (w) w.remove();
      } catch (e) { b.disabled = false; msg.textContent = e.message; }
    };
  };
})();
