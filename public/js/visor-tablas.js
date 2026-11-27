/*
 * TABLAS DE PLANIFICACIÓN del Visor de Autodesk Forma (v0.32.0).
 *
 * Una tabla agrupa los elementos del modelo por parámetros (en niveles, como un árbol: WBS › partida › …), con pestañas por un parámetro
 * (p. ej. el módulo o el nivel) y cantidades sumadas (volumen, área, longitud…). La RECETA de cada tabla se guarda en el proyecto para todo
 * el equipo (/api/proyectos/:pid/tablas-planificacion): no hay que armarla cada vez; al abrirla se calcula sobre el modelo cargado
 * (/api/modelos/:pid/:vid/tabla-planificacion). Clic en una fila aísla sus elementos en el modelo.
 * Los parámetros se guardan POR NOMBRE (los ids cambian de un modelo a otro), así la misma tabla sirve en cualquier modelo del proyecto.
 */
export function monta(V) {
  const { esc, api, num, ventana, panel, PID, DIMS } = V;
  const $ = (id) => document.getElementById(id);
  const T = { tablas: null, puede: false, params: null, vidParams: '' };
  const descarga = (nombre, contenido, tipo) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], { type: tipo || 'text/csv;charset=utf-8' })); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const csvDe = (filas) => '﻿' + filas.map(f => f.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const excel = (hojas, nombre) => { if (!window.XLSX) { alert('La librería de Excel no cargó; usa CSV.'); return; } const wb = XLSX.utils.book_new(); for (const [n, filas] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja'); XLSX.writeFile(wb, nombre); };
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nombreCampo = (c) => !c ? '' : c.tipo === 'dim' ? '● ' + DIMS[c.dim] : c.nombre;
  const corto = (c) => !c ? '' : c.tipo === 'dim' ? DIMS[c.dim] : c.nombre.replace(/^.*\/\s*/, '');
  const mismo = (a, b) => !!a && !!b && a.tipo === b.tipo && (a.tipo === 'dim' ? a.dim === b.dim : a.nombre === b.nombre);

  const pesDe = (t) => Array.isArray(t.pestanas) ? t.pestanas : (t.pestanas ? [t.pestanas] : []);   /* las tablas guardadas antes traían un solo campo */
  async function cargaTablas() { const d = await api('/api/proyectos/' + PID + '/tablas-planificacion'); T.tablas = (d.tablas || []).map(t => Object.assign(t, { pestanas: pesDe(t) })); T.puede = !!d.puedeGuardar; return T.tablas; }
  async function guardaTablas() { const d = await api('/api/proyectos/' + PID + '/tablas-planificacion', { method: 'PUT', json: { tablas: T.tablas } }); T.tablas = d.tablas.map(t => Object.assign(t, { pestanas: pesDe(t) })); }
  async function parametros() { if (T.params && T.vidParams === V.VID) return T.params; const P = await api('/api/modelos/' + PID + '/' + V.VID + '/parametros'); T.params = (Array.isArray(P) ? P : (P.parametros || [])).filter(p => !/^●/.test(p.nombre)); T.vidParams = V.VID; return T.params; }

  // ---------- el panel: las tablas guardadas ----------
  V.MODULOS.tablas = async () => {
    const c = panel('Tablas de planificación', '<p class="pista">Agrupa los elementos por parámetros para armar tablas de metrados. Cada tabla queda <b>guardada en el proyecto</b>, para todo el equipo y para cualquier modelo.</p><div class="filab"><button class="primario" id="tpNueva">+ Nueva tabla</button></div><div id="tpLista" class="pista">Cargando…</div>');
    try { await cargaTablas(); } catch (e) { c.querySelector('#tpLista').textContent = e.message; return; }
    c.querySelector('#tpNueva').disabled = !T.puede; if (!T.puede) c.querySelector('#tpNueva').title = 'Tu nivel de acceso permite abrir las tablas, no crearlas';
    c.querySelector('#tpNueva').onclick = () => edita(null);
    pintaLista();
  };
  function pintaLista() {
    const l = $('tpLista'); if (!l) return;
    l.innerHTML = T.tablas.map(t => '<div class="filtro"><div class="ft"><b title="' + esc(t.nombre) + '" style="cursor:pointer" data-abre="' + t.id + '">' + esc(t.nombre) + '</b>' + (T.puede ? '<button data-ed="' + t.id + '" title="Editar la tabla">✎</button><button data-dup="' + t.id + '" title="Duplicar">⧉</button><button data-bor="' + t.id + '" title="Borrar">✕</button>' : '') + '</div>' +
      '<div class="pista">' + (t.pestanas.length ? 'Pestañas: ' + esc(t.pestanas.map(corto).join(' + ')) + ' · ' : '') + esc(t.grupos.map(corto).join(' › ')) + (t.cantidades.length ? ' · suma ' + esc(t.cantidades.map(q => q.etiqueta || corto(q.campo)).join(', ')) : '') + '</div><div class="filab" style="margin-top:4px"><button class="primario" data-abre="' + t.id + '">Abrir</button></div></div>').join('') ||
      '<p class="pista">Aún no hay tablas. Pulsa <b>+ Nueva tabla</b>: eliges los parámetros que agrupan (por ejemplo WBS › partida), las cantidades que se suman y, si quieres, un parámetro para las pestañas (módulo, nivel…).</p>';
    const de = (id) => T.tablas.find(x => x.id === id);
    l.querySelectorAll('[data-abre]').forEach(b => b.onclick = () => abre(de(b.dataset.abre)));
    l.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => edita(de(b.dataset.ed)));
    l.querySelectorAll('[data-dup]').forEach(b => b.onclick = async () => { const t = de(b.dataset.dup); T.tablas.push(Object.assign(JSON.parse(JSON.stringify(t)), { id: '', nombre: t.nombre + ' (copia)' })); try { await guardaTablas(); } catch (e) { alert(e.message); } pintaLista(); });
    l.querySelectorAll('[data-bor]').forEach(b => b.onclick = async () => { const t = de(b.dataset.bor); if (!confirm('¿Borrar la tabla «' + t.nombre + '»? Se borra para todo el equipo.')) return; T.tablas = T.tablas.filter(x => x !== t); try { await guardaTablas(); } catch (e) { alert(e.message); } pintaLista(); });
  }

  // ---------- el editor de una tabla ----------
  async function edita(t0) {
    if (!V.EL) { alert('Abre un modelo: los parámetros se eligen de su índice.'); return; }
    let P; try { P = await parametros(); } catch (e) { alert(e.message); return; }
    const t = t0 ? JSON.parse(JSON.stringify(t0)) : { id: '', nombre: '', nota: '', pestanas: [], grupos: [], cantidades: [] }; t.pestanas = pesDe(t);
    const w = ventana(t0 ? 'Editar tabla' : 'Nueva tabla de planificación', '<div class="tped"><label>Nombre de la tabla</label><input id="teNom" value="' + esc(t.nombre) + '" placeholder="Metrado por módulo y partida">' +
      '<label>Pestañas por <span class="pista">(opcional, hasta 3 parámetros: cada uno es una fila de pestañas, p. ej. módulo y especialidad)</span></label><div id="tePes"></div><div class="filab"><button id="teMasP">+ Añadir parámetro de pestañas</button></div>' +
      '<label>Niveles de agrupación <span class="pista">(en orden: el primero es el más general)</span></label><div id="teGru"></div><div class="filab"><button id="teMasG">+ Añadir nivel</button></div>' +
      '<label>Cantidades a sumar <span class="pista">(parámetros numéricos: volumen, área, longitud…; el recuento de elementos sale siempre)</span></label><div id="teCan"></div><div class="filab"><button id="teMasC">+ Añadir cantidad</button></div>' +
      '<div class="filab" style="margin-top:12px"><button class="primario" id="teOk">Guardar tabla</button><button id="teProbar">Probar sin guardar</button><span class="pista" id="teMsg"></span></div></div>', { x: 240, y: 80, ancho: 620, alto: 560 });
    const elige = (ancla, alElegir, soloParam) => {
      const d = document.createElement('div'); d.className = 'selparam'; const r = ancla.getBoundingClientRect(); d.style.left = Math.min(r.left, innerWidth - 340) + 'px'; d.style.top = Math.min(r.bottom + 4, innerHeight - 390) + 'px'; d.style.zIndex = 200;
      d.innerHTML = '<input placeholder="Buscar parámetro…"><div class="lista"></div>'; document.body.appendChild(d);
      const cierra = () => { d.remove(); document.removeEventListener('mousedown', fuera); }, fuera = (e) => { if (!d.contains(e.target)) cierra(); };
      const pinta = (q) => {
        q = (q || '').toLowerCase(); let h = '';
        if (!soloParam) { const norm = Object.entries(DIMS).filter(([k, n]) => !q || n.toLowerCase().includes(q)); if (norm.length) h += '<div class="g">Normalizado</div>' + norm.map(([k, n]) => '<div class="o" data-dim="' + k + '">● ' + n + '</div>').join(''); }
        const grupos = new Map(); for (const p of P) { if (q && !p.nombre.toLowerCase().includes(q)) continue; const i = p.nombre.indexOf(' / '), g = i > 0 ? p.nombre.slice(0, i) : 'Otros'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); }
        let n = 0; for (const [g, ps] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) { if (n > 600) break; h += '<div class="g">' + esc(g) + '</div>' + ps.slice(0, 200).map(p => '<div class="o" data-p="' + esc(p.nombre) + '" title="' + esc(p.nombre) + '">' + esc(p.nombre.slice(p.nombre.indexOf(' / ') > 0 ? p.nombre.indexOf(' / ') + 3 : 0)) + '</div>').join(''); n += ps.length; }
        d.querySelector('.lista').innerHTML = h || '<div class="o pista">Nada coincide.</div>';
        d.querySelectorAll('.o[data-dim]').forEach(o => o.onclick = () => { cierra(); alElegir({ tipo: 'dim', dim: o.dataset.dim }); });
        d.querySelectorAll('.o[data-p]').forEach(o => o.onclick = () => { cierra(); alElegir({ tipo: 'param', nombre: o.dataset.p }); });
      };
      setTimeout(() => document.addEventListener('mousedown', fuera), 0); d.querySelector('input').oninput = (e) => pinta(e.target.value); pinta(''); d.querySelector('input').focus();
    };
    const ficha = (c) => '<span class="tpcampo" title="' + esc(nombreCampo(c)) + '">' + esc(nombreCampo(c)) + '</span>';
    const pinta = () => {
      w.querySelector('#tePes').innerHTML = t.pestanas.map((c, i) => '<div class="tpfila"><i>' + (i + 1) + '</i>' + ficha(c) + '<button data-psube="' + i + '" title="Subir"' + (i ? '' : ' disabled') + '>↑</button><button data-qp="' + i + '" title="Quitar">✕</button></div>').join('') || '<div class="pista">Sin pestañas: la tabla sale en una sola hoja.</div>';
      w.querySelector('#teGru').innerHTML = t.grupos.map((c, i) => '<div class="tpfila"><i>' + (i + 1) + '</i>' + ficha(c) + '<button data-sube="' + i + '" title="Subir"' + (i ? '' : ' disabled') + '>↑</button><button data-baja="' + i + '" title="Bajar"' + (i < t.grupos.length - 1 ? '' : ' disabled') + '>↓</button><button data-qg="' + i + '" title="Quitar">✕</button></div>').join('') || '<div class="pista">Añade al menos un nivel.</div>';
      w.querySelector('#teCan').innerHTML = t.cantidades.map((c, i) => '<div class="tpfila">' + ficha(c.campo) + '<input data-et="' + i + '" value="' + esc(c.etiqueta || '') + '" placeholder="Título de la columna" style="max-width:170px"><button data-qc="' + i + '" title="Quitar">✕</button></div>').join('') || '<div class="pista">Sin cantidades: la tabla solo contará elementos.</div>';
      w.querySelectorAll('[data-qp]').forEach(b => b.onclick = () => { t.pestanas.splice(+b.dataset.qp, 1); pinta(); });
      w.querySelectorAll('[data-psube]').forEach(b => b.onclick = () => { const i = +b.dataset.psube; [t.pestanas[i - 1], t.pestanas[i]] = [t.pestanas[i], t.pestanas[i - 1]]; pinta(); });
      w.querySelectorAll('[data-sube]').forEach(b => b.onclick = () => { const i = +b.dataset.sube; [t.grupos[i - 1], t.grupos[i]] = [t.grupos[i], t.grupos[i - 1]]; pinta(); });
      w.querySelectorAll('[data-baja]').forEach(b => b.onclick = () => { const i = +b.dataset.baja; [t.grupos[i + 1], t.grupos[i]] = [t.grupos[i], t.grupos[i + 1]]; pinta(); });
      w.querySelectorAll('[data-qg]').forEach(b => b.onclick = () => { t.grupos.splice(+b.dataset.qg, 1); pinta(); });
      w.querySelectorAll('[data-qc]').forEach(b => b.onclick = () => { t.cantidades.splice(+b.dataset.qc, 1); pinta(); });
      w.querySelectorAll('[data-et]').forEach(i => i.oninput = () => { t.cantidades[+i.dataset.et].etiqueta = i.value; });
    };
    w.querySelector('#teMasP').onclick = (e) => { if (t.pestanas.length >= 3) return alert('Hasta 3 parámetros de pestañas.'); elige(e.currentTarget, (c) => { if (!t.pestanas.some(g => mismo(g, c))) t.pestanas.push(c); pinta(); }); };
    w.querySelector('#teMasG').onclick = (e) => { if (t.grupos.length >= 8) return alert('Hasta 8 niveles.'); elige(e.currentTarget, (c) => { if (!t.grupos.some(g => mismo(g, c))) t.grupos.push(c); pinta(); }); };
    w.querySelector('#teMasC').onclick = (e) => { if (t.cantidades.length >= 6) return alert('Hasta 6 cantidades.'); elige(e.currentTarget, (c) => { t.cantidades.push({ campo: c, etiqueta: corto(c) }); pinta(); }, true); };
    const lee = () => { t.nombre = w.querySelector('#teNom').value.trim(); if (!t.grupos.length) { w.querySelector('#teMsg').textContent = 'Añade al menos un nivel de agrupación.'; return false; } return true; };
    w.querySelector('#teProbar').onclick = () => { if (lee()) abre(Object.assign({}, t, { nombre: t.nombre || 'Tabla sin guardar' })); };
    w.querySelector('#teOk').onclick = async () => {
      if (!lee()) return; if (!t.nombre) { w.querySelector('#teMsg').textContent = 'Ponle un nombre a la tabla.'; return; }
      const i = T.tablas.findIndex(x => x.id && x.id === t.id); if (i >= 0) T.tablas[i] = t; else T.tablas.push(t);
      try { await guardaTablas(); w.querySelector('#teMsg').textContent = 'Guardada para todo el equipo.'; pintaLista(); const g = T.tablas.find(x => x.nombre === t.nombre) || t; const cerrar = w.closest('.ventana') && w.closest('.ventana').querySelector('.vcerrar, .cerrar'); if (cerrar) cerrar.click(); abre(g); }
      catch (e) { w.querySelector('#teMsg').textContent = e.message; }
    };
    pinta();
  }

  // ---------- la tabla ----------
  async function abre(t) {
    if (!t) return; if (!V.EL) { alert('Abre un modelo primero.'); return; }
    const w = ventana(t.nombre, '<div class="tpv"><div class="filab" style="margin:0 0 6px"><input id="tvQ" placeholder="Buscar partida, código…" style="max-width:240px"><button id="tvExp">Expandir todo</button><button id="tvCon">Contraer</button><button id="tvIds" title="Muestra los identificadores de los elementos de la fila elegida">IDs</button><button id="tvSin" title="Aísla los elementos que no tienen valor en alguno de los parámetros de la tabla">Sin valor</button><button id="tvTodo">Ver todo el modelo</button><span style="flex:1"></span><button id="tvCsv">CSV</button><button id="tvXls">Excel</button></div>' +
      '<div id="tvPes"></div><div class="tpcuerpo"><table id="tvTabla" class="tptabla"></table></div><div class="pista" id="tvPie" style="margin-top:4px">⏳ Calculando la tabla sobre el modelo…</div><div id="tvIdsCaja" class="tpids oculto"></div></div>', { x: Math.max(220, innerWidth - 900), y: 70, ancho: Math.min(860, innerWidth - 240), alto: Math.min(640, innerHeight - 90) });
    let R; try { R = await api('/api/modelos/' + PID + '/' + V.VID + '/tabla-planificacion', { json: { pestanas: pesDe(t), grupos: t.grupos, cantidades: t.cantidades } }); }
    catch (e) { w.querySelector('#tvPie').innerHTML = '<span style="color:#e07a6a">No se pudo calcular: ' + esc(e.message) + '</span>'; return; }
    const nq = t.cantidades.length, PES = pesDe(t), nP = Math.min(PES.length, R.nPestanas != null ? R.nPestanas : (R.conPestanas ? 1 : 0)), conP = nP > 0;
    const ordenTxt = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
    // cada parámetro de pestañas es una fila; los valores de una fila dependen de lo elegido en las anteriores. TODOS = sin elegir en esa fila.
    const TODOS = '\u0002todos', S = { pes: new Array(nP).fill(TODOS), abiertos: new Set(), q: '', sel: null, ids: false };
    const pasa = (h, hasta) => { for (let j = 0; j < hasta; j++) if (S.pes[j] !== TODOS && h.k[j] !== S.pes[j]) return false; return true; };
    const valoresFila = (j) => [...new Set(R.hojas.filter(h => pasa(h, j)).map(h => h.k[j]))].sort(ordenTxt);
    if (conP) S.pes[0] = valoresFila(0)[0];
    // el árbol de una pestaña: nodos { k: etiqueta, ruta, n, q[], es[], hijos: Map }
    const arbolDe = (pes) => {
      const raiz = { hijos: new Map(), n: 0, q: new Array(nq).fill(0), es: [] };
      for (const h of R.hojas) {
        if (!pasa(h, nP)) continue; const ks = h.k.slice(nP); let nodo = raiz; nodo.n += h.n; for (let j = 0; j < nq; j++) nodo.q[j] += h.q[j];
        ks.forEach((k, i) => { let x = nodo.hijos.get(k); if (!x) { x = { k, nivel: i, ruta: ks.slice(0, i + 1).join('\u0001'), hijos: new Map(), n: 0, q: new Array(nq).fill(0), hojas: [] }; nodo.hijos.set(k, x); } x.n += h.n; for (let j = 0; j < nq; j++) x.q[j] += h.q[j]; x.hojas.push(h); nodo = x; });
      }
      return raiz;
    };
    const orden = (m) => [...m.values()].sort((a, b) => String(a.k).localeCompare(String(b.k), 'es', { numeric: true }));
    const esDe = (x) => { const s = new Set(); for (const h of x.hojas) for (const e of h.es) s.add(e); return s; };
    let A = arbolDe(), porRuta = new Map();
    const etPes = () => S.pes.map((p) => p === TODOS ? '' : (p || '(sin valor)')).filter(Boolean).join(' · ');
    const pinta = () => {
      const q = S.q.toLowerCase(); porRuta = new Map(); let filas = '';
      const coincide = (x) => !q || String(x.k).toLowerCase().includes(q) || [...x.hijos.values()].some(coincide);
      const baja = (x) => {
        if (!coincide(x)) return; porRuta.set(x.ruta, x);
        const hoja = !x.hijos.size, ab = S.abiertos.has(x.ruta) || !!q;
        filas += '<tr class="clic n' + Math.min(x.nivel, 5) + (S.sel === x.ruta ? ' sel' : '') + '" data-r="' + esc(x.ruta) + '"><td style="padding-left:' + (6 + x.nivel * 16) + 'px"><span class="tpmas" data-t="' + esc(x.ruta) + '">' + (hoja ? '·' : ab ? '−' : '+') + '</span> ' + (x.k ? esc(x.k) : '<span class="pista">(sin valor)</span>') + '</td><td class="pista">' + esc(corto(t.grupos[x.nivel])) + '</td><td class="num">' + num(x.n) + '</td>' + x.q.map((v, j) => '<td class="num">' + f2(v) + '</td><td class="pista">' + esc((R.unidades[j] || [])[0] || '') + '</td>').join('') + '</tr>';
        if (!hoja && ab) for (const h of orden(x.hijos)) baja(h);
      };
      for (const x of orden(A.hijos)) baja(x);
      w.querySelector('#tvTabla').innerHTML = '<tr><th>' + esc(t.grupos.map(corto).join(' › ')) + '</th><th>Nivel de la tabla</th><th>Elementos</th>' + t.cantidades.map(c => '<th>' + esc(c.etiqueta || corto(c.campo)) + '</th><th>Unidad</th>').join('') + '</tr>' + filas +
        '<tr class="tptotal"><td>Total' + (conP && etPes() ? ' · ' + esc(etPes()) : '') + '</td><td></td><td class="num">' + num(A.n) + '</td>' + A.q.map((v, j) => '<td class="num">' + f2(v) + '</td><td class="pista">' + esc((R.unidades[j] || [])[0] || '') + '</td>').join('') + '</tr>';
      let hp = ''; const filasPes = [];
      for (let j = 0; j < nP; j++) { const vs = valoresFila(j); if (S.pes[j] !== TODOS && !vs.includes(S.pes[j])) S.pes[j] = TODOS; filasPes.push(vs); hp += '<div class="tppes"><span class="pista tppest">' + esc(corto(PES[j])) + '</span><button data-f="' + j + '" data-p="-1"' + (S.pes[j] === TODOS ? ' class="activa"' : '') + '>Todos</button>' + vs.map((p, i) => '<button data-f="' + j + '" data-p="' + i + '"' + (p === S.pes[j] ? ' class="activa"' : '') + ' title="' + esc(corto(PES[j]) + ': ' + (p || '(sin valor)')) + '">' + esc(p || '(sin valor)') + '</button>').join('') + '</div>'; }
      w.querySelector('#tvPes').innerHTML = hp;
      w.querySelectorAll('#tvPes button').forEach(b => b.onclick = () => { const j = +b.dataset.f, i = +b.dataset.p; S.pes[j] = i < 0 ? TODOS : filasPes[j][i]; S.sel = null; A = arbolDe(); pinta(); });
      w.querySelectorAll('tr[data-r]').forEach(tr => tr.onclick = (ev) => {
        const x = porRuta.get(tr.dataset.r); if (!x) return;
        if (ev.target.classList.contains('tpmas') && x.hijos.size) { if (S.abiertos.has(x.ruta)) S.abiertos.delete(x.ruta); else S.abiertos.add(x.ruta); pinta(); return; }
        S.sel = x.ruta; if (x.hijos.size && !S.abiertos.has(x.ruta)) S.abiertos.add(x.ruta);
        V.muestraSolo(esDe(x), true); pinta(); pintaIds();
      });
      const mal = R.unidades.map((u, j) => u.length > 1 ? (t.cantidades[j].etiqueta || corto(t.cantidades[j].campo)) + ' mezcla unidades (' + u.join(', ') + ')' : '').filter(Boolean);
      w.querySelector('#tvPie').innerHTML = num(R.total) + ' elementos del modelo' + (conP ? ' · ' + num(A.n) + ' en lo elegido' : '') + (R.sinValor ? ' · <b>' + num(R.sinValor) + '</b> sin valor en algún parámetro (botón «Sin valor»)' : '') + (R.faltan.length ? ' · <span style="color:#f0b640">este modelo no tiene: ' + esc(R.faltan.map(n => n.replace(/^.*\/\s*/, '')).join(', ')) + '</span>' : '') + (mal.length ? ' · <span style="color:#f0b640">' + esc(mal.join('; ')) + '</span>' : '') + ' · clic en una fila aísla sus elementos';
    };
    const pintaIds = () => { const c = w.querySelector('#tvIdsCaja'); c.classList.toggle('oculto', !S.ids); if (!S.ids) return; const x = S.sel && porRuta.get(S.sel); if (!x) { c.textContent = 'Elige una fila para ver los identificadores de sus elementos.'; return; } const es = [...esDe(x)]; c.innerHTML = '<b>' + esc(x.k || '(sin valor)') + '</b> · ' + num(es.length) + ' elemento(s): <span class="mono">' + es.slice(0, 400).join('; ') + (es.length > 400 ? ' …' : '') + '</span>'; };
    const todas = (x, out) => { for (const h of orden(x.hijos)) { out.push(h); todas(h, out); } return out; };
    /* la exportación lleva TODO el modelo (todas las pestañas), una fila por hoja, con sus parámetros de pestaña como columnas */
    const filasExp = () => { const out = [[].concat(PES.slice(0, nP).map(corto), t.grupos.map(corto), ['Elementos'], t.cantidades.flatMap(c => [c.etiqueta || corto(c.campo), 'Unidad']))]; for (const h of R.hojas.slice().sort((a, b) => ordenTxt(a.k.join('\u0001'), b.k.join('\u0001')))) out.push([].concat(h.k, [h.n], h.q.flatMap((v, k2) => [Math.round(v * 1000) / 1000, (R.unidades[k2] || [])[0] || '']))); return out; };
    w.querySelector('#tvQ').oninput = (e) => { S.q = e.target.value; pinta(); };
    w.querySelector('#tvExp').onclick = () => { for (const x of todas(A, [])) if (x.hijos.size) S.abiertos.add(x.ruta); pinta(); };
    w.querySelector('#tvCon').onclick = () => { S.abiertos.clear(); pinta(); };
    w.querySelector('#tvIds').onclick = (e) => { S.ids = !S.ids; e.currentTarget.classList.toggle('activo', S.ids); pintaIds(); };
    w.querySelector('#tvSin').onclick = () => { const s = new Set(); for (const h of R.hojas) if (h.k.some(k => !k)) for (const e of h.es) s.add(e); if (!s.size) return alert('Todos los elementos tienen valor en los parámetros de esta tabla.'); V.muestraSolo(s, true); };
    w.querySelector('#tvTodo').onclick = () => { S.sel = null; V.muestraSolo(null, false); V.encuadra(); pinta(); pintaIds(); };
    const base = (t.nombre || 'tabla').replace(/[^\w.-]+/g, '_').slice(0, 50);
    w.querySelector('#tvCsv').onclick = () => descarga(base + '.csv', csvDe(filasExp()));
    w.querySelector('#tvXls').onclick = () => excel([[t.nombre || 'Tabla', filasExp()]], base + '.xlsx');
    pinta();
  }
  V.alCargarModelo.push(() => { T.params = null; });
  V.tablas = { abre, edita, T };
}
