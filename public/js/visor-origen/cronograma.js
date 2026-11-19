/*
 * Cronogramas: Microsoft Project y Primavera P6
 * ---------------------------------------------
 * Lee el archivo en el navegador, sin subirlo a ningun sitio, y lo pinta como
 * Gantt en una ventana flotante.
 *
 * Formatos que entiende:
 *   .xml   XML de Microsoft Project (Archivo > Guardar como > XML)
 *   .xml   XML de Primavera P6 (el mismo lector distingue cual es)
 *   .xer   intercambio de Primavera P6, que es texto separado por tabuladores
 *   .mpx   formato antiguo de Project, tambien texto
 *
 * El .mpp NO se lee, y conviene decirlo claro en vez de fallar a medias: es un
 * contenedor binario propietario cuyo formato Microsoft no publica, y lo poco
 * que se sabe de el cambia entre versiones. Desde Project se exporta a XML en
 * dos clics y el resultado es fiel; intentar adivinarlo aqui daria fechas mal
 * puestas, que es peor que no leerlo.
 *
 * Ademas del Gantt hay un enlace 4D: si eliges una propiedad del modelo cuyos
 * valores coincidan con los codigos de actividad, la barra de tiempo va
 * mostrando lo construido a cada fecha.
 */

let CR = { tareas: [], nombre: '', param: '', hoy: null, mapa: null, sel: null, vinculos: false,
           colapsadas: new Set(), critica: false };

// ---------- Lectura ----------

function abreCronograma() {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = '.xml,.xer,.mpx,.mpp,.xlsx,.xlsm,.xlsb,.xls,.csv,.ods';
  i.onchange = async () => {
    const f = i.files && i.files[0];
    if (!f) return;
    if (/\.mpp$/i.test(f.name)) {
      return alert(
        'Los archivos .mpp no se pueden leer directamente: es un formato binario ' +
        'cerrado de Microsoft.\n\n' +
        'En Project: Archivo > Guardar como > tipo "XML de Project (*.xml)".\n' +
        'Ese XML si se lee, y con todas las fechas y vinculos.');
    }
    if (/\.(sp|spx|presto|prestoobra)$/i.test(f.name)) {
      /*
       * Formato cerrado y sin el programa a mano: lo que si se puede hacer es
       * mirar por dentro. El inspector dice que es (ZIP, SQLite, binario) y
       * saca lo que lleve: XML de Project, tablas, o los textos en claro.
       */
      if (typeof inspeccionaArchivo === 'function' &&
          confirm('"' + f.name + '" es un formato cerrado (Synchro/Presto) y no se puede abrir ' +
                  'como lo haria su programa.\n\n¿Lo inspecciono por dentro? Sacare lo que ' +
                  'lleve: archivos internos, tablas o los textos legibles (actividades, ' +
                  'fechas, codigos, partidas).')) {
        inspeccionaArchivo(await f.arrayBuffer(), f.name);
      }
      return;
    }
    busy(true, 'Leyendo el cronograma...');
    try {
      if (/\.bc3$/i.test(f.name)) {
        await abreBc3(await f.arrayBuffer(), f.name, 'Tu equipo');
      } else if (/\.(xlsx|xlsm|xlsb|xls|csv|ods)$/i.test(f.name)) {
        /*
         * Excel de tu equipo. Se lee el libro entero y manda lo que sea:
         * si alguna hoja es un cronograma se abre el Gantt —como siempre—, y
         * si no lo es (un reporte semanal, una valorizacion) se abre la hoja
         * en vez de fallar con "necesita columnas de nombre, inicio y fin".
         */
        const tareas = await abreHoja(await f.arrayBuffer(), f.name, 'Tu equipo', false);
        if (tareas && tareas.length) abreGanttDeHoja();
        else {
          $('xlWin').classList.remove('hidden');
          pintaPestanasHoja();
          pintaHoja();
        }
        busy(false);
        return;
      }
      const txt = await f.text();
      const t = /\.xer$/i.test(f.name) ? leeXer(txt)
        : /\.mpx$/i.test(f.name) ? leeMpx(txt)
        : leeXml(txt);
      if (!t.length) throw new Error('no se encontraron actividades');
      CR.tareas = t;
      CR.nombre = f.name;
      CR.hoy = null;
      $('crWin').classList.remove('hidden');
      pintaCronograma();
      pintaParamsCr();
    } catch (e) {
      alert('No se pudo leer el cronograma: ' + e.message);
    }
    busy(false);
  };
  i.click();
}

/** Un XML de Project/Primavera que ya esta en memoria (p. ej. sacado de un ZIP). */
function abreCronoDesdeTexto(txt, nombre) {
  const t = leeXml(txt);
  if (!t.length) throw new Error('el XML no trae actividades');
  CR.tareas = t;
  CR.nombre = nombre;
  CR.hoy = null;
  $('crWin').classList.remove('hidden');
  pintaCronograma();
  pintaParamsCr();
}

/*
 * v1.272 — el arreglo de tareas lleva, OCULTO (no enumerable), el texto del
 * archivo del que salio. El Gantt no lo usa ni cambia; lo usa la evaluacion
 * de clase (AACE 27R-03), que necesita la logica y los recursos tal como los
 * trae el archivo (el Gantt, cuando faltan, infiere vinculos solo para dibujar).
 */
function conFuente(arr, txt, tipo) {
  try { Object.defineProperty(arr, '__fuente', { value: { txt: String(txt || ''), tipo }, configurable: true }); } catch (e) {}
  return arr;
}

const fecha = (s) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isFinite(d.getTime()) ? d : null;
};

/** XML de Microsoft Project o de Primavera P6: se distinguen por sus etiquetas. */
function leeXml(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('el XML esta danado');

  const dame = (n, t) => {
    const e = n.getElementsByTagName(t)[0];
    return e ? e.textContent.trim() : '';
  };

  // Primavera exporta <Activity>; Project exporta <Task>.
  const act = doc.getElementsByTagName('Activity');
  if (act.length) {
    return conFuente([...act].map((a, i) => ({
      id: dame(a, 'Id') || String(i + 1),
      nombre: dame(a, 'Name'),
      ini: fecha(dame(a, 'StartDate') || dame(a, 'PlannedStartDate')),
      fin: fecha(dame(a, 'FinishDate') || dame(a, 'PlannedFinishDate')),
      pct: parseFloat(dame(a, 'PercentComplete')) || 0,
      nivel: 1,
      wbs: dame(a, 'WBSCode') || '',
    })).filter(t => t.nombre), txt, 'p6xml');
  }

  const tar = doc.getElementsByTagName('Task');
  return conFuente([...tar].map((t) => ({
    id: dame(t, 'UID'),
    nombre: dame(t, 'Name'),
    ini: fecha(dame(t, 'Start')),
    fin: fecha(dame(t, 'Finish')),
    pct: parseFloat(dame(t, 'PercentComplete')) || 0,
    nivel: parseInt(dame(t, 'OutlineLevel'), 10) || 1,
    resumen: dame(t, 'Summary') === '1',
    wbs: dame(t, 'WBS') || '',
  })).filter(t => t.nombre && t.ini && t.fin), txt, 'mspxml');
}

/**
 * XER de Primavera: bloques que empiezan por %T (tabla), %F (campos) y %R
 * (filas), separados por tabuladores.
 */
/*
 * v1.178 — EL XER ENTERO, COMO LO ENSENA PRIMAVERA (a pedido).
 * Antes solo se leia la tabla TASK: ni jerarquia ni vinculos. Ahora:
 *   PROJWBS  la jerarquia (WBS): cada banda con su nivel, y las actividades
 *            colgando de la suya. El Gantt ya sabia pintar esto (resumen y
 *            nivel, lo que produce el lector XML): solo faltaba producirlo.
 *   TASKPRED las dependencias: predecesoras y sucesoras de cada actividad,
 *            con su tipo (FS, SS, FF, SF) y su desfase. El desfase viene en
 *            HORAS (lag_hr_cnt); se ensena en dias a 8 h/dia, que es la
 *            jornada por defecto de P6 — si el calendario del proyecto usa
 *            otra, el numero exacto esta en el titulo (horas).
 */
/** Trocea un XER en sus tablas: nombre -> filas (objetos campo->valor). Pura. */
function xerTablas(txt) {
  const out = new Map();
  let tabla = '', campos = [];
  for (const l of String(txt || '').split(/\r?\n/)) {
    if (l.startsWith('%T')) { tabla = l.split('\t')[1]; campos = []; if (!out.has(tabla)) out.set(tabla, []); continue; }
    if (l.startsWith('%F')) { campos = l.split('\t').slice(1); continue; }
    if (!l.startsWith('%R') || !tabla) continue;
    const v = l.split('\t').slice(1);
    const fila = {};
    for (let i = 0; i < campos.length; i++) fila[campos[i]] = v[i] !== undefined ? v[i] : '';
    out.get(tabla).push(fila);
  }
  return out;
}

/** El tipo de vinculo de P6, en la letra de siempre. Pura. */
function xerTipoVinculo(t) {
  return ({ PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' })[t] || (t || 'FS').replace(/^PR_/, '');
}

/** El desfase de P6 (horas) como texto en dias a 8 h/dia. Pura. */
function xerLag(horas) {
  const h = parseFloat(horas) || 0;
  if (!h) return '';
  const d = h / 8;
  return (h > 0 ? '+' : '') + (Number.isInteger(d) ? d : d.toFixed(1)) + 'd';
}

function leeXer(txt) {
  const T = xerTablas(txt);
  const fila = (r) => {
    const g = (n) => r[n] !== undefined ? r[n] : '';
    const ini = fecha(g('act_start_date') || g('early_start_date') || g('target_start_date'));
    const fin = fecha(g('act_end_date') || g('early_end_date') || g('target_end_date'));
    if (!ini || !fin) return null;
    return {
      id: g('task_code') || g('task_id'),
      tid: g('task_id'),
      nombre: g('task_name'),
      ini, fin,
      pct: parseFloat(g('phys_complete_pct')) || 0,
      nivel: 1,
      wbs: g('wbs_id') || '',
      pred: [], suc: [],
      // v1.180: la holgura total de P6 (horas). Critica = holgura <= 0, que es
      // exactamente como la pinta Primavera. Si el XER no la trae, queda null
      // y la ruta critica dice que no hay dato, en vez de inventarla.
      holgura: g('total_float_hr_cnt') === '' ? null : (parseFloat(g('total_float_hr_cnt')) || 0),
      critica: g('total_float_hr_cnt') === '' ? false : (parseFloat(g('total_float_hr_cnt')) || 0) <= 0,
    };
  };
  const tareas = (T.get('TASK') || []).map(fila).filter(Boolean);

  // --- Los vinculos (TASKPRED): predecesoras y sucesoras, por task_id. ---
  const porTid = new Map(tareas.map(t => [t.tid, t]));
  for (const r of T.get('TASKPRED') || []) {
    const suc = porTid.get(r.task_id), pre = porTid.get(r.pred_task_id);
    if (!suc || !pre) continue;                      // vinculo con otra obra del XER: fuera
    const v = { tipo: xerTipoVinculo(r.pred_type), lag: xerLag(r.lag_hr_cnt), horas: parseFloat(r.lag_hr_cnt) || 0 };
    suc.pred.push({ id: pre.id, tid: pre.tid, nombre: pre.nombre, ...v });
    pre.suc.push({ id: suc.id, tid: suc.tid, nombre: suc.nombre, ...v });
  }

  // --- La jerarquia (PROJWBS): bandas con su nivel, actividades colgando. ---
  const wbs = new Map();
  for (const r of T.get('PROJWBS') || [])
    wbs.set(r.wbs_id, { id: r.wbs_id, nombre: r.wbs_name || r.wbs_short_name || '',
                        padre: r.parent_wbs_id || '', seq: parseFloat(r.seq_num) || 0 });
  if (!wbs.size) return conFuente(tareas, txt, 'xer');   // XER sin WBS: como antes

  const nivelDe = (id) => {                          // profundidad, con guarda de ciclos
    let n = 0, w = wbs.get(id), vistos = new Set();
    while (w && wbs.has(w.padre) && !vistos.has(w.id)) { vistos.add(w.id); n++; w = wbs.get(w.padre); }
    return n + 1;
  };
  const hijos = new Map();
  const raices = [];
  for (const w of wbs.values()) {
    if (wbs.has(w.padre)) { if (!hijos.has(w.padre)) hijos.set(w.padre, []); hijos.get(w.padre).push(w); }
    else raices.push(w);
  }
  const porSeq = (a, b) => (a.seq - b.seq) || String(a.nombre).localeCompare(String(b.nombre));
  const tareasDe = new Map();
  for (const t of tareas) { if (!tareasDe.has(t.wbs)) tareasDe.set(t.wbs, []); tareasDe.get(t.wbs).push(t); }

  const out = [];
  const mete = (w) => {
    const banda = { id: '', nombre: w.nombre, resumen: true, nivel: nivelDe(w.id),
                    ini: null, fin: null, pct: 0, wbs: w.id, pred: [], suc: [] };
    out.push(banda);
    const mias = (tareasDe.get(w.id) || []).sort((a, b) => a.ini - b.ini);
    for (const t of mias) { t.nivel = banda.nivel + 1; out.push(t); }
    for (const h of (hijos.get(w.id) || []).sort(porSeq)) mete(h);
    // La banda abarca lo suyo y lo de sus descendientes (lo ya metido tras ella).
    let dur = 0, avance = 0;
    for (let i = out.indexOf(banda) + 1; i < out.length; i++) {
      const x = out[i];
      if (x.resumen && x.nivel <= banda.nivel) break;
      if (x.resumen || !x.ini) continue;
      if (!banda.ini || x.ini < banda.ini) banda.ini = x.ini;
      if (!banda.fin || x.fin > banda.fin) banda.fin = x.fin;
      const d = Math.max(1, (x.fin - x.ini) / 86400000);
      dur += d; avance += d * (x.pct || 0);
    }
    if (dur) banda.pct = Math.round(avance / dur);
    if (!banda.ini) out.splice(out.indexOf(banda), 1);   // banda sin actividades: fuera
  };
  for (const r of raices.sort(porSeq)) mete(r);
  // Alguna actividad con wbs_id que no vino en PROJWBS: al final, que no se pierda.
  for (const t of tareas) if (!wbs.has(t.wbs)) out.push(t);
  return conFuente(out, txt, 'xer');
}

/** MPX: formato de texto antiguo de Project. El registro 70 son las tareas. */
function leeMpx(txt) {
  const out = [];
  for (const l of txt.split(/\r?\n/)) {
    const c = l.split(',');
    if (c[0] !== '70') continue;
    const ini = fecha(c[13]), fin = fecha(c[14]);
    if (!ini || !fin) continue;
    out.push({ id: c[1] || '', nombre: (c[2] || '').replace(/^"|"$/g, ''),
               ini, fin, pct: parseFloat(c[9]) || 0, nivel: 1, wbs: '' });
  }
  return out;
}

/*
 * v1.180 — COLAPSO POR BANDAS, COMO PRIMAVERA. Clic en un titulo WBS y todo
 * lo que contiene (actividades y sub-bandas) se oculta o se despliega. Pura:
 * recorre la lista en su orden y, al topar una banda colapsada, salta todo lo
 * de nivel mayor hasta la siguiente banda de su nivel o menos.
 */
function crVisibles(tareas, colapsadas) {
  const out = [];
  let tapa = null;                       // nivel de la banda colapsada que tapa
  for (const t of tareas || []) {
    if (tapa != null) {
      if (t.resumen && t.nivel <= tapa) tapa = null;
      else continue;
    }
    out.push(t);
    if (t.resumen && colapsadas && colapsadas.has(t.wbs)) tapa = t.nivel;
  }
  return out;
}

/** El rotulo compacto de las relaciones de una actividad (columna P6). Pura. */
function crRelRotulo(t) {
  const j = (arr) => arr.map(p => p.id + (p.tipo !== 'FS' || p.lag ? ':' + p.tipo + (p.lag || '') : '')).join(', ');
  const p = (t.pred || []), s = (t.suc || []);
  if (!p.length && !s.length) return '';
  return (p.length ? '\u25c0 ' + j(p) : '') + (p.length && s.length ? '  ' : '') +
         (s.length ? '\u25b6 ' + j(s) : '');
}

/*
 * v1.182 — EL CRONOGRAMA DESDE MODELO TAMBIEN SABE SUS VINCULOS Y SU RUTA
 * CRITICA (a pedido, imagen 1). El modelo no trae TASKPRED: aqui los vinculos
 * se INFIEREN por fechas —A termina y B empieza (FS), con hasta 2 dias entre
 * medio, contra el fin mas cercano— y la ruta critica se CALCULA con un CPM
 * clasico sobre esa red (paso atras anclado al fin del proyecto; holgura =
 * tardio - real). Todo queda rotulado como INFERIDO: no es el contractual,
 * es la secuencia que las fechas del modelo dibujan.
 */
/** Vinculos FS inferidos por fechas. No toca los que ya existan. Pura. */
function crInfiereVinculos(tareas, tolDias) {
  const tol = (Number(tolDias) > 0 ? Number(tolDias) : 2) * 86400000;
  const acts = (tareas || []).filter(t => !t.resumen && t.ini && t.fin && t.tid);
  for (const t of acts) { t.pred = t.pred || []; t.suc = t.suc || []; }
  for (const b of acts) {
    if (b.pred.length) continue;                    // vinculos reales: no se tocan
    let mejor = -Infinity;
    for (const a of acts)
      if (a !== b && a.fin.getTime() <= b.ini.getTime() && a.fin.getTime() > mejor)
        mejor = a.fin.getTime();
    if (mejor === -Infinity || b.ini.getTime() - mejor > tol) continue;
    for (const a of acts) {
      if (a === b || a.fin.getTime() !== mejor) continue;
      const lagD = Math.round((b.ini.getTime() - mejor) / 86400000);
      const v = { tipo: 'FS', lag: lagD ? '+' + lagD + 'd' : '', horas: lagD * 8, inf: true };
      b.pred.push({ id: a.id, tid: a.tid, nombre: a.nombre, tipo: v.tipo, lag: v.lag, horas: v.horas, inf: true });
      a.suc.push({ id: b.id, tid: b.tid, nombre: b.nombre, tipo: v.tipo, lag: v.lag, horas: v.horas, inf: true });
    }
  }
  return tareas;
}

/** CPM (paso atras) sobre vinculos FS: holgura en horas a 8 h/dia. Pura. */
function crRutaCriticaDe(tareas) {
  const acts = (tareas || []).filter(t => !t.resumen && t.ini && t.fin && t.tid);
  if (!acts.length) return tareas;
  const por = new Map(acts.map(t => [t.tid, t]));
  const finPro = Math.max(...acts.map(t => t.fin.getTime()));
  const memo = new Map();
  const tardioFin = (t) => {
    if (memo.has(t.tid)) return memo.get(t.tid);
    memo.set(t.tid, finPro);                        // guarda de ciclos
    let v = finPro;
    for (const s of t.suc || []) {
      const st = por.get(s.tid);
      if (!st) continue;
      const dur = st.fin.getTime() - st.ini.getTime();
      const lag = ((s.horas || 0) / 8) * 86400000;
      v = Math.min(v, tardioFin(st) - dur - lag);
    }
    memo.set(t.tid, v);
    return v;
  };
  for (const t of acts) {
    if (t.holgura != null) continue;                // la holgura del XER manda
    const hd = (tardioFin(t) - t.fin.getTime()) / 86400000;
    t.holgura = Math.round(hd * 8);
    t.critica = t.holgura <= 0;
  }
  return tareas;
}

// ---------- Gantt ----------

function pintaCronograma() {
  const t = CR.tareas;
  // v1.181: declarado ANTES del titulo que lo usa. En la v1.180 quedo debajo
  // y la zona muerta de const reventaba el pintado entero en silencio: panel
  // vacio. De ahi el arnes de pintado en pruebas-primavera: el Gantt ahora se
  // EJECUTA en las pruebas, no solo se lee.
  const nCrit = t.filter(x => x.critica).length;
  const ini = new Date(Math.min(...t.map(x => x.ini.getTime())));
  const fin = new Date(Math.max(...t.map(x => x.fin.getTime())));
  const dias = Math.max(1, (fin - ini) / 86400000);
  CR.ini = ini; CR.fin = fin;

  $('crTitulo').textContent = CR.nombre + ' \u00b7 ' + t.length + ' actividades \u00b7 ' +
    ini.toLocaleDateString('es-PE') + ' a ' + fin.toLocaleDateString('es-PE') +
    (nCrit ? ' \u00b7 ' + nCrit + ' en ruta critica' : '');

  const q = ($('crBuscar').value || '').toLowerCase();
  // v1.180: primero el colapso por bandas (como Primavera); el buscador
  // trabaja sobre lo desplegado.
  const base = crVisibles(t, CR.colapsadas);
  const lista = q ? base.filter(x => (x.nombre || '').toLowerCase().includes(q) ||
                                     (x.id || '').toLowerCase().includes(q)) : base;
  // La columna de relaciones (predecesoras/sucesoras), si el cronograma trae vinculos.
  const hayRel = t.some(x => (x.pred || []).length || (x.suc || []).length);
  const relW = hayRel ? 150 : 0;

  /*
   * LA COLUMNA DE NOMBRES SE MIDE, NO SE RECORTA. Antes eran 250 px y 34
   * caracteres: "100021.00.010.1.3 SC3 Puesta en ..." se quedaba a medias en
   * todas las filas. Ahora el ancho sale del nombre mas largo de la lista
   * (con tope, o una actividad de dos lineas se lleva toda la ventana) y el
   * texto va entero; la ventana ademas ya se ensancha y se desplaza.
   */
  const alto = 22;
  const rotulo = (x) => (x.id ? x.id + '  ' : '') + x.nombre;
  const masLargo = lista.reduce((m, x) => Math.max(m, rotulo(x).length), 0);
  const mi = Math.max(250, Math.min(760, 16 + Math.round(masLargo * 6.1)));
  /*
   * ESCALA. Con el eje ajustado al ancho, un cronograma de 19 anos (el .sp de
   * Synchro, con sus fechas basura en los extremos) aplasta 743 barras en un
   * dedo. CR.escala son pixeles por dia: en Auto se ajusta al ancho como
   * siempre; con escala fija el lienzo crece y se desplaza en horizontal.
   */
  const escala = Number(CR.escala) || 0;
  const mi2 = mi + relW;                     // v1.180: nombres + relaciones
  const an = escala ? mi2 + Math.max(750, Math.round(dias * escala) + 40) : mi2 + 750;
  const h = lista.length * alto + 42;
  let s = '';

  // Rejilla por meses.
  const pos = new Map();                    // tid -> puntos de anclaje de su barra (v1.178)
  const meses = [];
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1);
  while (d <= fin) { meses.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  for (const m of meses) {
    const x = mi2 + (an - mi2 - 20) * ((m - ini) / 86400000) / dias;
    if (x < mi2) continue;
    s += `<line x1="${x}" y1="26" x2="${x}" y2="${h - 8}" stroke="#1e2735"/>` +
         `<text x="${x + 3}" y="20" fill="#7f8ca0" font-size="9">` +
         m.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }) + '</text>';
  }

  lista.forEach((x, i) => {
    const y = 30 + i * alto;
    const x1 = mi2 + (an - mi2 - 20) * ((x.ini - ini) / 86400000) / dias;
    const x2 = mi2 + (an - mi2 - 20) * ((x.fin - ini) / 86400000) / dias;
    const w = Math.max(2, x2 - x1);
    const res = x.resumen;
    const sel = CR.sel && x.tid === CR.sel;
    // v1.180: banda -> flecha de colapso y clic en el titulo; actividad
    // critica -> barra roja (y con "Ruta critica" el resto se atenua).
    const plegada = res && CR.colapsadas.has(x.wbs);
    const marca = res ? (plegada ? '\u25b8 ' : '\u25be ') : '';
    const dimm = CR.critica && !res && !x.critica;
    const colorBarra = res ? '#5b6a80' : (x.critica ? '#c0392b' : '#4d7fbf');
    s += `<g data-tid="${escAttr(x.tid || '')}" data-wbs="${res ? escAttr(x.wbs || '') : ''}" ` +
         `style="cursor:pointer"${dimm ? ' opacity="0.3"' : ''}>` +
         (sel ? `<rect x="0" y="${y}" width="${an}" height="${alto - 2}" fill="#1b2530"/>` : '') +
         `<text x="${8 + (x.nivel - 1) * 8}" y="${y + 12}" fill="${res ? '#e8ecf2' : '#cfd8e6'}" ` +
         `font-size="10"${res ? ' font-weight="600"' : ''}>` +
         esc(marca + recorta(rotulo(x), 118)) + `<title>${esc(rotulo(x))}</title></text>` +
         (relW && !res ? `<text x="${mi + 4}" y="${y + 12}" fill="#8fa0b8" font-size="9">` +
           esc(recorta(crRelRotulo(x), 26)) + `<title>Predecesoras: ${esc((x.pred || []).map(p =>
             p.id + ' ' + p.tipo + (p.lag || '')).join(', ') || 'ninguna')}\n` +
           `Sucesoras: ${esc((x.suc || []).map(p => p.id + ' ' + p.tipo + (p.lag || '')).join(', ') ||
             'ninguna')}</title></text>` : '') +
         `<rect x="${x1}" y="${y + 4}" width="${w}" height="${alto - 10}" rx="2" ` +
         `fill="${colorBarra}"><title>${esc(x.nombre)}\n` +
         `${x.ini.toLocaleDateString('es-PE')} - ${x.fin.toLocaleDateString('es-PE')}\n` +
         `${x.pct}%` +
         (x.holgura != null ? `\nholgura: ${Number.isInteger(x.holgura / 8) ? x.holgura / 8 : (x.holgura / 8).toFixed(1)}d` +
           (x.critica ? ' (RUTA CRITICA)' : '') : '') +
         ((x.pred || []).length || (x.suc || []).length
           ? `\n${(x.pred || []).length} predecesora(s) \u00b7 ${(x.suc || []).length} sucesora(s)` : '') +
         `</title></rect>` +
         (x.pct > 0 ? `<rect x="${x1}" y="${y + 4}" width="${w * Math.min(1, x.pct / 100)}" ` +
                      `height="${alto - 10}" rx="2" fill="#4f9d69"/>` : '') + '</g>';
    if (x.tid) pos.set(x.tid, { x1, x2, y: y + alto / 2 - 1 });
  });

  /*
   * v1.178 — LOS VINCULOS, COMO LOS DIBUJA PRIMAVERA. Con "Vinculos" marcado
   * se dibujan todos los visibles; sin marcar, solo los de la actividad
   * elegida (con 700 actividades, todos a la vez son espagueti). El codo sale
   * del extremo que dicta el tipo: FS del fin de la predecesora al inicio de
   * la sucesora, SS de inicio a inicio, FF de fin a fin, SF de fin a inicio.
   */
  const vinculos = [];
  for (const x of lista) {
    if (!x.tid || !(x.pred || []).length) continue;
    for (const p of x.pred) {
      if (!CR.vinculos && !(CR.sel && (x.tid === CR.sel || p.tid === CR.sel))) continue;
      const a = pos.get(p.tid), b = pos.get(x.tid);
      if (!a || !b) continue;                        // la otra punta no esta a la vista
      const xa = (p.tipo === 'SS') ? a.x1 : a.x2;    // FS, FF y SF salen del fin
      const xb = (p.tipo === 'FF') ? b.x2 : b.x1;    // FS, SS y SF llegan al inicio
      const marcado = CR.sel && (x.tid === CR.sel || p.tid === CR.sel);
      const col = marcado ? '#e0a54a' : '#8a6a35';
      // v1.180: la flecha es clicable: se sombrea y sale el aviso temporal
      // con antecedente y consecuente (crToast).
      const rot = `${p.id} ${p.nombre || ''} \u2192 ${p.tipo}${p.lag} \u2192 ${x.id} ${x.nombre || ''}`;
      vinculos.push(`<path d="M${xa},${a.y} L${xa + 6},${a.y} L${xa + 6},${b.y} L${xb},${b.y}" ` +
        `fill="none" stroke="${col}" stroke-width="1" data-link="${escAttr(rot)}" ` +
        `style="cursor:pointer;pointer-events:stroke"><title>${esc(p.id)} ${p.tipo}${p.lag} \u2192 ` +
        `${esc(x.id)}</title></path>` +
        `<path d="M${xb},${b.y} l-5,-3 l0,6 z" fill="${col}"/>`);
    }
  }
  s += vinculos.join('');

  // Linea de la fecha elegida en el reproductor 4D.
  if (CR.hoy) {
    const x = mi2 + (an - mi2 - 20) * ((CR.hoy - ini) / 86400000) / dias;
    s += `<line x1="${x}" y1="26" x2="${x}" y2="${h - 8}" stroke="#c0763a" stroke-width="2"/>`;
  }

  $('crLienzo').innerHTML =
    `<svg viewBox="0 0 ${an} ${h}" width="${escala ? an + 'px' : '100%'}" font-family="system-ui,sans-serif">${s}</svg>`;
  // v1.178: clic en una actividad -> se elige, se resaltan sus vinculos y se
  // pinta su detalle (predecesoras y sucesoras). Otro clic en ella, la suelta.
  $('crLienzo').querySelectorAll('[data-tid]').forEach(g => g.onclick = () => {
    const tid = g.getAttribute('data-tid');
    // v1.180: clic en un titulo o subtitulo (banda WBS): se pliega o
    // despliega todo lo que contiene, como en Primavera.
    const wbs = g.getAttribute('data-wbs');
    if (!tid && wbs) {
      if (CR.colapsadas.has(wbs)) CR.colapsadas.delete(wbs); else CR.colapsadas.add(wbs);
      pintaCronograma();
      return;
    }
    if (!tid) return;
    CR.sel = (CR.sel === tid) ? null : tid;
    pintaCronograma();
    pintaDetalleCr();
  });
  // v1.180: clic en una flecha de vinculo: se sombrea y sale el aviso.
  $('crLienzo').querySelectorAll('[data-link]').forEach(p => p.onclick = (e) => {
    e.stopPropagation();
    p.setAttribute('stroke', '#e0a54a');
    p.setAttribute('stroke-width', '2.5');
    crToast('Vinculo: ' + p.getAttribute('data-link') +
            ' \u00b7 antecedente \u2192 tipo y desfase \u2192 consecuente');
  });
}

/** El aviso temporal del cronograma: aparece abajo y se va solo. */
function crToast(msg) {
  let z = $('crToast');
  if (!z) {
    z = document.createElement('div');
    z.id = 'crToast';
    z.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'z-index:90;background:#1b2530;color:#e8ecf2;border:1px solid #3aa5b8;border-radius:8px;' +
      'padding:8px 14px;font-size:12px;max-width:70vw;transition:opacity .4s';
    document.body.appendChild(z);
  }
  z.textContent = msg;
  z.style.opacity = '1';
  z.style.display = 'block';
  clearTimeout(crToast.t);
  crToast.t = setTimeout(() => { z.style.opacity = '0';
    setTimeout(() => { z.style.display = 'none'; }, 450); }, 4500);
}

/** El detalle de la actividad elegida: sus vinculos, como los lista Primavera. */
function pintaDetalleCr() {
  const z = $('crDetalle');
  if (!z) return;
  const t = CR.sel && CR.tareas.find(x => x.tid === CR.sel);
  if (!t) { z.innerHTML = ''; return; }
  const lado = (rot, arr) => '<b>' + rot + ':</b> ' + (arr && arr.length
    ? arr.map(p => esc(p.id) + ' <span class="hint">' + p.tipo + (p.lag || '') + '</span>' +
        '<span class="hint" title="' + escAttr(p.nombre) + '">*</span>').join(', ')
    : '<span class="hint">ninguna</span>');
  z.innerHTML = '<b>' + esc(t.id) + '</b> ' + esc(t.nombre) + ' &middot; ' +
    lado('Predecesoras', t.pred) + ' &middot; ' + lado('Sucesoras', t.suc) +
    ' <span class="hint">(desfases a 8 h/dia; pasa el raton por * para el nombre)</span>';
}

// ---------- Enlace 4D con el modelo ----------

function pintaParamsCr() {
  const sel = $('crParam');
  // Sin opcion "(sin enlace)": con seleccion multiple, no marcar nada ya es eso.
  sel.innerHTML = (props.params || []).map(p =>
    `<option value="${escAttr(p)}">${esc(nombreCorto(p))}</option>`).join('');
}

/** Las propiedades marcadas para el enlace 4D (varias a la vez). */
function paramsEnlace() {
  const sel = $('crParam');
  if (!sel) return [];
  return [...(sel.selectedOptions || [])].map(o => o.value).filter(Boolean);
}

/**
 * Cruza las actividades con el modelo. Se considera que un elemento pertenece a
 * una actividad cuando el valor de la propiedad elegida coincide con el codigo
 * de la actividad, o cuando uno contiene al otro: en obra los codigos casi nunca
 * estan escritos igual en los dos sitios.
 */
function enlaza4D() {
  /*
   * VARIAS PROPIEDADES A LA VEZ. Antes solo una: si el codigo de la actividad
   * estaba en "Fecha Fin Real" para estructuras y en "ID Partida" para
   * instalaciones, habia que elegir y perder la mitad. Ahora se cruza con la
   * UNION de las marcadas, y un elemento que case por cualquiera entra una
   * sola vez.
   */
  CR.params = paramsEnlace();
  CR.param = CR.params[0] || '';                 // compatibilidad con lo que lea CR.param
  if (!CR.params.length) { CR.mapa = null; $('crEnlace').textContent = ''; return; }
  const listas = CR.params.map(p => props.byParam.get(p)).filter(Boolean);
  if (!listas.length) return;

  const mapa = new Map();     // id de tarea -> [claves]
  let casan = 0;
  for (const t of CR.tareas) {
    const cod = String(t.id || '').trim().toLowerCase();
    if (!cod) continue;
    const claves = new Set();
    for (const vals of listas) {
      for (const [v, ids] of vals) {
        const s = String(v).trim().toLowerCase();
        if (s === cod || (cod.length > 2 && s.includes(cod))) {
          for (const k of ids) claves.add(k);
        }
      }
    }
    if (claves.size) { mapa.set(t.id, [...claves]); casan++; }
  }
  CR.mapa = mapa;
  $('crEnlace').textContent = casan
    ? `${casan} de ${CR.tareas.length} actividades encontraron elementos en el modelo` +
      (CR.params.length > 1 ? ` (cruzando ${CR.params.length} propiedades).` : '.')
    : 'Ninguna actividad coincide con los valores de ' +
      (CR.params.length > 1 ? 'esas propiedades.' : 'esa propiedad.');

  const r = $('crFecha');
  r.min = 0; r.max = 100; r.value = 100;
  $('crFechaTxt').textContent = CR.fin.toLocaleDateString('es-PE');
}

/** Mueve la fecha: se muestra lo terminado y se atenua lo que aun no toca. */
function mueve4D() {
  if (!CR.mapa || !CR.tareas.length) return;
  const p = parseInt($('crFecha').value, 10) / 100;
  const t = new Date(CR.ini.getTime() + p * (CR.fin - CR.ini));
  CR.hoy = t;
  $('crFechaTxt').textContent = t.toLocaleDateString('es-PE');

  const hechos = [], enCurso = [];
  for (const x of CR.tareas) {
    const k = CR.mapa.get(x.id);
    if (!k) continue;
    // Copiado con bucle: la propagacion revienta la pila con arreglos grandes.
    const destino = x.fin <= t ? hechos : (x.ini <= t ? enCurso : null);
    if (destino) for (const c of k) destino.push(c);
  }

  const per = models.map(() => []);
  for (const k of hechos.concat(enCurso)) {
    const mi = decMi(k);
    if (per[mi]) per[mi].push(decId(k));
  }
  models.forEach((m, mi) => { if (per[mi].length) viewer.isolate(per[mi], m); else hideModel(m); });

  // Lo que esta en ejecucion se pinta de naranja para distinguirlo.
  models.forEach(m => { try { viewer.clearThemingColors(m); } catch (e) {} });
  const naranja = new THREE.Vector4(0.75, 0.46, 0.23, 1);
  for (const k of enCurso) {
    try { viewer.setThemingColor(decId(k), naranja, models[decMi(k)]); } catch (e) {}
  }
  pintaCronograma();
}

// ---------- Conexiones ----------

$('btnCrono').onclick = abreCronograma;
$('crClose').onclick = () => {
  $('crWin').classList.add('hidden');
  models.forEach(m => { try { viewer.clearThemingColors(m); } catch (e) {} });
};
$('crBuscar').oninput = pintaCronograma;
$('crParam').onchange = enlaza4D;
if ($('crEscala')) $('crEscala').onchange = () => { CR.escala = Number($('crEscala').value) || 0; pintaCronograma(); };
// v1.178: dibujar los vinculos (todos los visibles, o solo los del elegido con clic).
if ($('crVinculos')) $('crVinculos').onchange = () => {
  CR.vinculos = $('crVinculos').checked; try { pintaCronograma(); } catch (e) {} };
// v1.180: los controles de siempre de Primavera.
if ($('crCritica')) $('crCritica').onchange = () => {
  CR.critica = $('crCritica').checked; try { pintaCronograma(); } catch (e) {} };
if ($('crExpandir')) $('crExpandir').onclick = () => {
  CR.colapsadas = new Set(); try { pintaCronograma(); } catch (e) {} };
if ($('crContraer')) $('crContraer').onclick = () => {
  CR.colapsadas = new Set(CR.tareas.filter(t => t.resumen).map(t => t.wbs));
  try { pintaCronograma(); } catch (e) {} };
$('crFecha').oninput = mueve4D;
$('crReset').onclick = () => {
  CR.hoy = null;
  models.forEach(m => { try { viewer.clearThemingColors(m); viewer.isolate([], m); } catch (e) {} });
  try { viewer.showAll(); } catch (e) {}
  pintaCronograma();
};


/* ----------------------------------------------------------------------------
 * Cronogramas en Excel (.xlsx, .xlsm, .xls)
 *
 * El lector (SheetJS) vive en el propio visor —vendor/xlsx.full.min.js, sin
 * CDN ni internet— y se carga solo la primera vez que hace falta. Las
 * columnas se reconocen por nombre, con tolerancia: "Nombre de tarea",
 * "Actividad", "Task Name"... todas valen. Hace falta como minimo nombre,
 * inicio y fin; el resto (id, % avance, WBS/EDT) se toma si existe.
 */
let sheetJsListo = null;
function cargaSheetJS() {
  if (window.XLSX) return Promise.resolve();
  if (sheetJsListo) return sheetJsListo;
  sheetJsListo = new Promise((ok, mal) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/xlsx.full.min.js';
    sc.onload = ok;
    sc.onerror = () => { sheetJsListo = null; mal(new Error('no se pudo cargar el lector de Excel')); };
    document.head.appendChild(sc);
  });
  return sheetJsListo;
}

/** Serial de Excel, Date de SheetJS o texto: todo acaba en Date o null. */
function fechaExcel(v) {
  if (v instanceof Date) return isFinite(v.getTime()) ? v : null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isFinite(d.getTime()) ? d : null;
  }
  return fecha(v);
}

function leeExcel(filas) {
  if (!filas.length) throw new Error('la primera hoja esta vacia');
  const claves = Object.keys(filas[0]);
  /*
   * Las cabeceras reales llevan tildes ("Descripcion" se escribe
   * "Descripción", "Termino" se escribe "Término"). Comparando en crudo no
   * casaban y el Excel se rechazaba diciendo que le faltaban columnas que si
   * estaban. Se comparan sin tildes y sin mayusculas.
   */
  const llano = (t) => String(t || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const busca = (...cand) =>
    claves.find(k => cand.some(cc => llano(k).includes(cc))) || null;
  const kNom = busca('nombre', 'tarea', 'actividad', 'descripcion', 'name');
  const kIni = busca('inicio', 'comienzo', 'start');
  const kFin = busca('fin', 'termino', 'finish', 'end');
  const kId  = busca('id', 'codigo', 'code');
  const kPct = busca('%', 'avance', 'complet', 'pct');
  const kWbs = busca('wbs', 'edt');
  if (!kNom || !kIni || !kFin)
    throw new Error('el Excel necesita columnas de nombre, inicio y fin. ' +
                    'Encontre: ' + claves.join(', '));
  const out = [];
  for (const r of filas) {
    const ini = fechaExcel(r[kIni]);
    const fin = fechaExcel(r[kFin]);
    if (!r[kNom] || !ini || !fin) continue;
    out.push({ id: String(kId && r[kId] !== '' ? r[kId] : out.length + 1),
               nombre: String(r[kNom]),
               ini, fin,
               pct: parseFloat(kPct ? r[kPct] : 0) || 0,
               nivel: 1,
               wbs: String(kWbs ? r[kWbs] : '') });
  }
  return out;
}


/* ============================================================================
 * VISOR DE HOJAS DE CALCULO  (v1.59)
 *
 * Por que existe
 * --------------
 * El modulo Cronograma listaba solo XML, XER, MPX y MPP: un .xlsx del proyecto
 * caia en "archivos de otro tipo (no se muestran)" y no habia forma de abrirlo.
 * Pero el tiempo del proyecto no llega solo en Project o Primavera: el reporte
 * semanal, la valorizacion y el lookahead llegan en Excel, y son justo los que
 * uno quiere mirar con el modelo delante.
 *
 * Que hace
 * --------
 * Abre la hoja tal cual, como el modulo de Planos abre un PDF: pestanas por
 * hoja, celdas combinadas respetadas, anchos de columna del propio archivo,
 * numeros a la derecha y busqueda sobre todo el contenido. Y si alguna hoja
 * tiene columnas de nombre, inicio y fin, se ofrece verla como Gantt con el
 * enlace 4D de siempre.
 *
 * Todo ocurre en el navegador con el SheetJS que ya vive en vendor/: el archivo
 * no sale del equipo ni pasa por el servidor del visor.
 */

let HJ = { wb: null, buf: null, nombre: '', carpeta: '', hoja: '',
           tareas: null, hojaGantt: '', tope: 0, q: '',
           ocultas: new Set(), verOcultas: false, dib: null, urls: new Map() };

const HJ_FILAS = 300;      // filas que se pintan de entrada
const HJ_COLS = 80;        // columnas maximas (mas no cabe ni se lee)
const HJ_MAX = 5000;       // tope duro: por encima el DOM se arrastra
const ANCHO_COL = 64;      // ancho de Excel por defecto (8,43 caracteres)
const ANCHO_NUM = 46;      // columna de numeros de fila

/** Texto visible de una celda: el formateado si lo hay, el crudo si no. */
function textoCelda(c) {
  if (!c) return '';
  if (c.w != null) return String(c.w);
  if (c.v == null) return '';
  if (c.v instanceof Date) return c.v.toLocaleDateString('es-PE');
  return String(c.v);
}

/**
 * Fila de cabecera de un cronograma en Excel.
 *
 * En los cronogramas reales la tabla no empieza en A1: encima hay logo, titulo,
 * codigo de obra y a veces dos filas de firmas. Se buscan las primeras 12 filas
 * hasta encontrar una que traiga a la vez algo de nombre, algo de inicio y algo
 * de fin; esa es la cabecera y desde ahi se lee.
 */
function filaCabecera(sh) {
  if (!sh || !sh['!ref']) return -1;
  const R = XLSX.utils.decode_range(sh['!ref']);
  const hastaF = Math.min(R.e.r, R.s.r + 12);
  const hastaC = Math.min(R.e.c, R.s.c + 60);
  for (let r = R.s.r; r <= hastaF; r++) {
    let nom = false, ini = false, fin = false;
    for (let c = R.s.c; c <= hastaC; c++) {
      const t = sinTildes(textoCelda(sh[XLSX.utils.encode_cell({ r, c })]));
      if (!t) continue;
      if (/nombre|tarea|actividad|descripcion|partida|name/.test(t)) nom = true;
      if (/inicio|comienzo|start/.test(t)) ini = true;
      if (/\bfin\b|termino|finaliza|finish|\bend\b/.test(t)) fin = true;
    }
    if (nom && ini && fin) return r;
  }
  return -1;
}

/** Devuelve las actividades de la hoja, o null si esa hoja no es un cronograma. */
function buscaTareasEnHoja(sh) {
  const r = filaCabecera(sh);
  if (r < 0) return null;
  try {
    const filas = XLSX.utils.sheet_to_json(sh, { defval: '', range: r });
    const t = leeExcel(filas);
    return t.length >= 2 ? t : null;
  } catch (e) {
    return null;      // esa fila parecia cabecera pero no cuajo: no pasa nada
  }
}

/**
 * Lee el libro y lo deja listo.
 *
 * `mostrar` decide que ventana se abre, y no es un capricho:
 *   - desde las CARPETAS del proyecto se abre la HOJA, porque lo que hay ahi
 *     casi siempre es un reporte, y el Gantt queda a un boton;
 *   - desde el boton del calendario (un archivo de tu equipo) se conserva el
 *     comportamiento de siempre: si es un cronograma, se abre el Gantt.
 * En los dos casos el libro queda cargado y se salta de una vista a la otra.
 */
async function abreHoja(buf, nombre, carpeta, mostrar) {
  await cargaSheetJS();
  /*
   * Uint8Array explicito: llega un ArrayBuffer desde las carpetas y un
   * ArrayBuffer desde el disco, pero un CSV puede llegar como texto. Asi el
   * lector recibe siempre lo mismo.
   */
  /*
   * `cellStyles` NO es cosmetico aqui: sin el, SheetJS devuelve `!cols` y
   * `!rows` VACIOS. Ese era el motivo de que todas las columnas salieran del
   * mismo ancho por defecto y "DESCRIPCION TAREA" se leyera partida en cuatro
   * lineas. Con el, llega `wpx` —el ancho en pixeles que Excel calculo— y
   * llegan tambien las filas y columnas OCULTAS, que hay que saltarse para
   * ensenar lo mismo que Forma.
   */
  const wb = XLSX.read(new Uint8Array(buf),
                       { type: 'array', cellDates: true, cellStyles: true });
  if (!wb.SheetNames || !wb.SheetNames.length)
    throw new Error('el archivo no tiene ninguna hoja');

  soltaUrls();
  HJ = { wb, buf, nombre, carpeta: carpeta || '', hoja: wb.SheetNames[0],
         tareas: null, hojaGantt: '', tope: HJ_FILAS, q: '',
         ocultas: hojasOcultas(wb), verOcultas: false, dib: null, urls: new Map() };

  /*
   * HOJAS OCULTAS.
   *
   * Erick vio en el visor mas pestanas que en Autodesk Forma. No sobraban: el
   * libro las trae ocultas (0.LEYENDA, Hoja3, Hoja4, borradores de PPC...) y
   * Excel no las ensena. Aqui pasaba lo contrario porque SheetJS devuelve
   * TODAS en SheetNames. Ahora se ocultan igual, con un boton para verlas
   * cuando haga falta: estar ocultas no es lo mismo que no existir.
   */
  const visibles = wb.SheetNames.filter(n => !HJ.ocultas.has(n));
  HJ.hoja = visibles[0] || wb.SheetNames[0];

  for (const n of wb.SheetNames) {
    const t = buscaTareasEnHoja(wb.Sheets[n]);
    if (t) { HJ.tareas = t; HJ.hojaGantt = n; if (!HJ.ocultas.has(n)) HJ.hoja = n; break; }
  }

  // Las imagenes van por su cuenta: SheetJS no las lee y el ZIP si.
  try { HJ.dib = await leeDibujos(buf); } catch (e) { HJ.dib = null; }

  if (mostrar !== false) {
    $('xlWin').classList.remove('hidden');
    pintaPestanasHoja();
    pintaHoja();
  }
  pintaBotonHoja();
  return HJ.tareas;
}

/**
 * Hojas que Excel no ensena.
 *
 * `Hidden` vale 0 visible, 1 oculta y 2 "muy oculta" (solo desde VBA). Las dos
 * ultimas se apartan.
 */
function hojasOcultas(wb) {
  const s = new Set();
  const hojas = (wb.Workbook && wb.Workbook.Sheets) || [];
  hojas.forEach((h, i) => {
    if (h && h.Hidden) s.add(h.name || wb.SheetNames[i]);
  });
  return s;
}

/** Las direcciones de blob de las imagenes de un libro que ya no se ve. */
function soltaUrls() {
  try {
    if (HJ && HJ.urls) for (const u of HJ.urls.values()) URL.revokeObjectURL(u);
  } catch (e) {}
}

function pintaPestanasHoja() {
  const host = $('xlHojas');
  if (!host || !HJ.wb) return;
  const lista = HJ.wb.SheetNames.filter(n => HJ.verOcultas || !HJ.ocultas.has(n));
  host.innerHTML = lista.map(n =>
    `<button class="xltab${n === HJ.hoja ? ' on' : ''}` +
    (HJ.ocultas.has(n) ? ' oculta' : '') + `" data-h="${escAttr(n)}"` +
    (HJ.ocultas.has(n) ? ' title="Hoja oculta en el libro de Excel"' : '') + '>' +
    esc(n) + (n === HJ.hojaGantt ? ' \u00b7 Gantt' : '') + '</button>').join('') +
    (HJ.ocultas.size
      ? `<button class="xltab xlocultas" id="xlVerOcultas">` +
        (HJ.verOcultas ? 'Ocultar las ' : 'Ver ') + HJ.ocultas.size +
        ' hoja(s) oculta(s)</button>'
      : '');
  host.querySelectorAll('.xltab[data-h]').forEach(b => {
    b.onclick = () => {
      HJ.hoja = b.getAttribute('data-h');
      HJ.tope = HJ_FILAS;
      pintaPestanasHoja();
      pintaHoja();
    };
  });
  const bo = $('xlVerOcultas');
  if (bo) bo.onclick = () => {
    HJ.verOcultas = !HJ.verOcultas;
    if (!HJ.verOcultas && HJ.ocultas.has(HJ.hoja)) {
      HJ.hoja = HJ.wb.SheetNames.find(n => !HJ.ocultas.has(n)) || HJ.hoja;
      HJ.tope = HJ_FILAS;
      pintaHoja();
    }
    pintaPestanasHoja();
  };
}

function pintaHoja() {
  const host = $('xlLienzo');
  if (!host || !HJ.wb) return;
  const sh = HJ.wb.Sheets[HJ.hoja];

  $('xlTitulo').textContent = HJ.nombre + (HJ.carpeta ? '  \u00b7  ' + HJ.carpeta : '');
  const bG = $('xlGantt');
  if (bG) {
    bG.style.display = HJ.tareas ? '' : 'none';
    if (HJ.tareas) bG.textContent = 'Ver como Gantt (' + HJ.tareas.length + ' actividades)';
  }

  if (!sh || !sh['!ref']) {
    host.innerHTML = '<div class="hint">Esta hoja esta vacia.</div>';
    $('xlInfo').textContent = '';
    return;
  }

  const R = XLSX.utils.decode_range(sh['!ref']);
  const q = sinTildes(HJ.q || '').trim();

  /*
   * Con busqueda, la vista se AMPLIA sola hasta la ultima coincidencia. Si no,
   * buscar en un reporte de 900 filas encontraba 12 aciertos y no se veia
   * ninguno, porque estaban por debajo del corte.
   */
  let aciertos = 0, ultima = -1;
  const finReal = Math.min(R.e.r, R.s.r + HJ_MAX - 1);
  const finCol = Math.min(R.e.c, R.s.c + HJ_COLS - 1);
  if (q) {
    for (let r = R.s.r; r <= finReal; r++) {
      for (let c = R.s.c; c <= finCol; c++) {
        const t = sinTildes(textoCelda(sh[XLSX.utils.encode_cell({ r, c })]));
        if (t && t.includes(q)) { aciertos++; ultima = r; }
      }
    }
    if (ultima >= 0) HJ.tope = Math.max(HJ.tope, ultima - R.s.r + 3);
  }

  /*
   * Si la hoja trae imagenes, la vista se amplia hasta la ultima: la pestana
   * LAYOUT es UNA imagen sobre celdas vacias, y cortarla a 300 filas dejaria
   * media fuera sin que se entienda por que.
   */
  const anclas = (HJ.dib && HJ.dib.porHoja.get(HJ.hoja)) || [];
  const imgs = anclas.length;
  if (imgs) {
    let ultimaImg = 0;
    for (const a of anclas) ultimaImg = Math.max(ultimaImg, a.aFila >= 0 ? a.aFila : a.fila);
    HJ.tope = Math.max(HJ.tope, Math.min(HJ_MAX, ultimaImg - R.s.r + 4));
  }
  const finFila = Math.min(finReal, R.s.r + Math.min(HJ.tope, HJ_MAX) - 1);

  // Celdas combinadas: la de arriba a la izquierda manda, las tapadas no salen.
  const colsOcultas = sh['!cols'] || [];
  const filasOcultas = sh['!rows'] || [];
  const tapada = new Set(), ancla = new Map();
  for (const m of (sh['!merges'] || [])) {
    /*
     * El colspan se RECORTA a lo que se dibuja. Una caratula combinada de A a
     * BZ con solo 80 columnas en pantalla generaria una fila mas ancha que la
     * cabecera: la tabla se descuadra y, con ella, la posicion de las imagenes.
     */
    /*
     * El colspan se cuenta en columnas VISIBLES: si en medio de una celda
     * combinada hay columnas ocultas, contarlas correria la tabla a la derecha.
     */
    let cs = 0;
    for (let c = m.s.c; c <= Math.min(m.e.c, finCol); c++)
      if (!(colsOcultas[c] && colsOcultas[c].hidden)) cs++;
    let rs = 0;
    for (let r = m.s.r; r <= Math.min(m.e.r, finFila); r++)
      if (!(filasOcultas[r] && filasOcultas[r].hidden)) rs++;
    ancla.set(m.s.r + ':' + m.s.c, { cs: Math.max(1, cs), rs: Math.max(1, rs) });
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (r !== m.s.r || c !== m.s.c) tapada.add(r + ':' + c);
  }

  /*
   * Anchos y ocultas, como en Excel.
   *
   * `wpx` es el ancho en PIXELES que calculo el propio Excel: usarlo tal cual
   * es lo unico que deja el contenido como en Forma. Y las columnas ocultas se
   * saltan igual que las hojas ocultas: en el reporte semanal hay columnas
   * agrupadas y plegadas, y ensenarlas descuadraba la lectura.
   */
  const cols = sh['!cols'] || [];
  const alturas = sh['!rows'] || [];
  const anchoDe = (c) => {
    const x = cols[c];
    if (!x) return ANCHO_COL;
    if (x.wpx) return Math.max(20, Math.min(600, Math.round(x.wpx)));
    if (x.wch) return Math.max(20, Math.min(600, Math.round(x.wch * 7.2)));
    return ANCHO_COL;
  };
  const visibles = [];
  for (let c = R.s.c; c <= finCol; c++) if (!(cols[c] && cols[c].hidden)) visibles.push(c);
  HJ.colsVis = visibles;          // lo que de verdad se dibuja, para las imagenes

  /*
   * EL ANCHO DE LA TABLA, EN PIXELES Y EXPLICITO.
   *
   * Aqui estaba el fallo que quedaba. Con `table-layout: fixed` y ancho
   * AUTOMATICO, el navegador no respeta los anchos de cada columna: reparte el
   * espacio disponible entre todas por igual. Por eso una hoja de 41 columnas
   * salia con 41 columnas de 25 px y el texto partido letra a letra, aunque los
   * anchos que llegan del archivo fueran correctos.
   *
   * Dandole a la tabla el ancho TOTAL en pixeles, el reparto fijo respeta cada
   * columna tal como la tiene Excel y lo que sobra se va al desplazamiento
   * horizontal, que es lo que hace Excel tambien.
   */
  const anchoTotal = ANCHO_NUM + visibles.reduce((a, c) => a + anchoDe(c), 0);
  let s = `<table class="xlTabla" style="width:${anchoTotal}px">` +
          '<colgroup><col class="xlrnc">';
  for (const c of visibles) s += `<col style="width:${anchoDe(c)}px">`;
  s += '</colgroup><thead><tr><th class="xlrn"></th>';
  for (const c of visibles) s += '<th>' + XLSX.utils.encode_col(c) + '</th>';
  s += '</tr></thead><tbody>';

  const filasVis = [];
  for (let r = R.s.r; r <= finFila; r++) {
    if (alturas[r] && alturas[r].hidden) continue;      // fila oculta en Excel
    filasVis.push(r);
  }
  HJ.filasVis = filasVis;
  for (const r of filasVis) {
    const hr = alturas[r] && (alturas[r].hpx || (alturas[r].hpt && alturas[r].hpt * 4 / 3));
    s += '<tr' + (hr ? ` style="height:${Math.max(14, Math.round(hr))}px"` : '') +
         '><th class="xlrn">' + (r + 1) + '</th>';
    for (const c of visibles) {
      if (tapada.has(r + ':' + c)) continue;
      const cel = sh[XLSX.utils.encode_cell({ r, c })];
      const txt = textoCelda(cel);
      const a = ancla.get(r + ':' + c);
      const num = cel && cel.t === 'n';
      const hit = q && sinTildes(txt).includes(q);
      s += '<td' +
        (a && a.cs > 1 ? ` colspan="${a.cs}"` : '') +
        (a && a.rs > 1 ? ` rowspan="${a.rs}"` : '') +
        (num || hit ? ` class="${num ? 'xlnum' : ''}${num && hit ? ' ' : ''}${hit ? 'xlhit' : ''}"` : '') +
        (cel && cel.f ? ` title="=${escAttr(cel.f)}"` : '') +
        '>' + esc(txt) + '</td>';
    }
    s += '</tr>';
  }
  s += '</tbody></table>';

  const quedan = R.e.r - finFila;
  let pie = '';
  if (quedan > 0) {
    pie = '<div class="xlmas"><button class="sm" id="xlMas">Ver ' +
          Math.min(500, quedan).toLocaleString('es-PE') + ' filas mas (quedan ' +
          quedan.toLocaleString('es-PE') + ')</button></div>';
  }
  /*
   * La tabla va dentro de un envoltorio POSICIONADO y con una capa encima: las
   * imagenes se colocan ahi en coordenadas relativas a la rejilla, no a la
   * ventana, asi que acompanan al desplazamiento sin recalcular nada.
   */
  host.innerHTML = '<div class="xlwrap">' + s + '<div id="xlImgs" class="xlimgs"></div></div>' + pie;
  const bm = $('xlMas');
  if (bm) bm.onclick = () => { HJ.tope += 500; pintaHoja(); };

  const filas = R.e.r - R.s.r + 1, columnas = R.e.c - R.s.c + 1;
  $('xlInfo').textContent =
    `${HJ.hoja} \u00b7 ${filas.toLocaleString('es-PE')} filas \u00d7 ${columnas} columnas` +
    (finFila < R.e.r ? ` \u00b7 mostrando hasta la ${finFila + 1}` : '') +
    (columnas > HJ_COLS ? ` \u00b7 solo las primeras ${HJ_COLS} columnas` : '') +
    (q ? ` \u00b7 ${aciertos} coincidencia(s)` : '') +
    (imgs ? ` \u00b7 ${imgs} imagen(es)` : '') +
    (HJ.dib && HJ.dib.graficos ? ` \u00b7 ${HJ.dib.graficos} grafico(s) de Excel no se dibujan` : '');

  // Las imagenes se colocan DESPUES: hace falta la rejilla ya medida.
  // Asincrona: un try normal no atraparia su rechazo.
  if (imgs) { pintaImagenes(R, finFila, finCol, HJ.hoja).catch(() => {}); }
}

/** El boton "Ver la hoja" del Gantt solo tiene sentido si hay libro cargado. */
function pintaBotonHoja() {
  const b = $('crHoja');
  if (b) b.style.display = HJ.wb ? '' : 'none';
}

function abreGanttDeHoja() {
  if (!HJ.tareas || !HJ.tareas.length) return;
  CR.tareas = HJ.tareas;
  CR.nombre = HJ.nombre + (HJ.hojaGantt ? '  \u00b7  hoja ' + HJ.hojaGantt : '') +
              (HJ.carpeta ? '  \u00b7  ' + HJ.carpeta : '');
  CR.hoy = null;
  CR.mapa = null;
  $('crWin').classList.remove('hidden');
  pintaCronograma();
  pintaParamsCr();
  pintaBotonHoja();
}

/** Todo lo del libro se olvida al cambiar de proyecto. */
function limpiaHoja() {
  soltaUrls();
  HJ = { wb: null, buf: null, nombre: '', carpeta: '', hoja: '',
         tareas: null, hojaGantt: '', tope: 0, q: '',
         ocultas: new Set(), verOcultas: false, dib: null, urls: new Map() };
  const w = $('xlWin');
  if (w) w.classList.add('hidden');
  pintaBotonHoja();
}

// ---------- Conexiones del visor de hojas ----------

if ($('xlClose')) $('xlClose').onclick = () => $('xlWin').classList.add('hidden');
if ($('xlGantt')) $('xlGantt').onclick = abreGanttDeHoja;
if ($('crHoja')) $('crHoja').onclick = () => {
  if (!HJ.wb) return;
  $('xlWin').classList.remove('hidden');
  pintaPestanasHoja();
  pintaHoja();
};
if ($('xlBaja')) $('xlBaja').onclick = () => {
  if (!HJ.buf) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([HJ.buf], { type: 'application/octet-stream' }));
  a.download = HJ.nombre || 'hoja.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
if ($('xlBuscar')) {
  let esperaBusq = null;
  $('xlBuscar').oninput = () => {
    if (esperaBusq) clearTimeout(esperaBusq);
    // Con teclas seguidas no se rastrea la hoja entera en cada pulsacion.
    esperaBusq = setTimeout(() => {
      HJ.q = $('xlBuscar').value || '';
      pintaHoja();
    }, 220);
  };
}
pintaBotonHoja();


/* ============================================================================
 * IMAGENES INCRUSTADAS EN LA HOJA  (v1.60)
 *
 * SheetJS lee celdas, no dibujos: por eso la pestana LAYOUT salia vacia cuando
 * lo unico que tiene es una imagen del sectorizado pegada encima de la rejilla.
 * Y esa imagen es justo la que interesa mirar con el modelo delante.
 *
 * Un .xlsx es un ZIP. Aqui se abre con el MISMO lector de ZIP que ya usa el
 * visor para los KMZ (leeZip/descomprime, en gis.js: sin librerias y sin
 * internet) y se sacan tres cosas:
 *
 *   xl/workbook.xml                    que hoja es cada sheetN.xml
 *   xl/worksheets/_rels/sheetN.xml.rels   que dibujo le corresponde
 *   xl/drawings/drawingN.xml           donde va cada imagen, en celdas
 *   xl/drawings/_rels/...rels          y a que archivo de xl/media apunta
 *
 * La posicion en un xlsx no esta en pixeles sino en CELDAS mas un desfase en
 * EMU (914.400 por pulgada, 9.525 por pixel a 96 ppp). Por eso las imagenes se
 * colocan midiendo las celdas YA DIBUJADAS: se anclan a la rejilla real, y si
 * una fila crece porque el texto envuelve, la imagen la acompana.
 */
const EMU_PX = 9525;

/** Primer descendiente cuyo nombre local coincide (sin pelearse con prefijos). */
function hijoLocal(el, local) {
  if (!el) return null;
  const t = el.getElementsByTagName('*');
  for (const e of t) if (e.localName === local) return e;
  return null;
}
function hijosLocal(el, local) {
  const out = [];
  if (!el) return out;
  for (const e of el.getElementsByTagName('*')) if (e.localName === local) out.push(e);
  return out;
}
/** Atributo por nombre local: r:embed y embed son el mismo atributo. */
function attrLocal(el, local) {
  if (!el) return '';
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return '';
}
const numLocal = (padre, local) => {
  const e = hijoLocal(padre, local);
  return e ? (parseInt(e.textContent, 10) || 0) : 0;
};

/** Mapa rId -> destino de un archivo .rels, con la ruta ya resuelta. */
function leeRels(xml, base) {
  const m = new Map();
  if (!xml) return m;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const r of doc.getElementsByTagName('*')) {
    if (r.localName !== 'Relationship') continue;
    m.set(r.getAttribute('Id'),
          { destino: resuelveRuta(base, r.getAttribute('Target') || ''),
            tipo: r.getAttribute('Type') || '' });
  }
  return m;
}

/** "xl/worksheets" + "../drawings/drawing1.xml" -> "xl/drawings/drawing1.xml" */
function resuelveRuta(base, rel) {
  if (/^\//.test(rel)) return rel.replace(/^\//, '');
  const partes = (base ? base.split('/') : []).concat(rel.split('/'));
  const pila = [];
  for (const p of partes) {
    if (!p || p === '.') continue;
    if (p === '..') pila.pop(); else pila.push(p);
  }
  return pila.join('/');
}

/**
 * Dibujos de todas las hojas del libro.
 * Devuelve { porHoja: Map<nombreHoja, [anclaje]>, zip } o null si no hay.
 */
async function leeDibujos(buf) {
  if (typeof leeZip !== 'function') return null;
  const zip = await leeZip(buf);
  const texto = async (ruta) => {
    const e = zip.get(ruta);
    if (!e) return '';
    return new TextDecoder('utf-8').decode(await descomprime(e));
  };

  const wbXml = await texto('xl/workbook.xml');
  if (!wbXml) return null;                         // .xls, .csv, .ods: aqui no hay ZIP OOXML
  const wbRels = leeRels(await texto('xl/_rels/workbook.xml.rels'), 'xl');

  const doc = new DOMParser().parseFromString(wbXml, 'application/xml');
  const porHoja = new Map();
  let total = 0, graficos = 0;

  for (const s of doc.getElementsByTagName('*')) {
    if (s.localName !== 'sheet') continue;
    const nombre = s.getAttribute('name') || '';
    const rid = attrLocal(s, 'id');
    const rel = wbRels.get(rid);
    if (!nombre || !rel) continue;

    const ruta = rel.destino;                       // xl/worksheets/sheet1.xml
    const carpeta = ruta.slice(0, ruta.lastIndexOf('/'));
    const hojaRels = leeRels(
      await texto(carpeta + '/_rels/' + ruta.slice(ruta.lastIndexOf('/') + 1) + '.rels'), carpeta);

    let rutaDib = '';
    for (const r of hojaRels.values()) if (/\/drawing$/.test(r.tipo)) rutaDib = r.destino;
    if (!rutaDib) continue;

    const dibXml = await texto(rutaDib);
    if (!dibXml) continue;
    const cDib = rutaDib.slice(0, rutaDib.lastIndexOf('/'));
    const dibRels = leeRels(
      await texto(cDib + '/_rels/' + rutaDib.slice(rutaDib.lastIndexOf('/') + 1) + '.rels'), cDib);

    const anclas = leeAnclas(dibXml, dibRels);
    graficos += anclas.filter(a => !a.medio).length;
    const conImagen = anclas.filter(a => a.medio);
    if (conImagen.length) { porHoja.set(nombre, conImagen); total += conImagen.length; }
  }
  return total || graficos ? { porHoja, zip, total, graficos } : null;
}

/** Anclajes de un drawing: donde empieza, donde acaba y que archivo pinta. */
function leeAnclas(xml, rels) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const a of doc.documentElement.children) {
    const tipo = a.localName;                       // twoCellAnchor | oneCellAnchor | absoluteAnchor
    const desde = hijoLocal(a, 'from');
    const hasta = hijoLocal(a, 'to');
    const ext = hijoLocal(a, 'ext');
    const blip = hijoLocal(a, 'blip');
    const medio = blip ? (rels.get(attrLocal(blip, 'embed')) || {}).destino : '';
    const nombreEl = hijoLocal(a, 'cNvPr');
    /*
     * GIRO. Erick vio el plano del sectorizado tumbado 90 grados respecto a
     * Excel. La imagen guardada en xl/media esta girada y Excel la endereza con
     * `rot` en la transformacion del dibujo; el navegador, que no lee ese
     * atributo, la pintaba tal cual. `rot` viene en sesentamilesimas de grado:
     * 5.400.000 son 90 grados.
     */
    const xfrm = hijoLocal(a, 'xfrm');
    const rot = xfrm ? (parseInt(xfrm.getAttribute('rot'), 10) || 0) / 60000 : 0;
    out.push({
      tipo,
      col: desde ? numLocal(desde, 'col') : 0,
      colOff: desde ? numLocal(desde, 'colOff') : 0,
      fila: desde ? numLocal(desde, 'row') : 0,
      filaOff: desde ? numLocal(desde, 'rowOff') : 0,
      aCol: hasta ? numLocal(hasta, 'col') : -1,
      aColOff: hasta ? numLocal(hasta, 'colOff') : 0,
      aFila: hasta ? numLocal(hasta, 'row') : -1,
      aFilaOff: hasta ? numLocal(hasta, 'rowOff') : 0,
      cx: ext ? (parseInt(ext.getAttribute('cx'), 10) || 0) : 0,
      cy: ext ? (parseInt(ext.getAttribute('cy'), 10) || 0) : 0,
      medio: medio || '',
      giro: ((Math.round(rot) % 360) + 360) % 360,
      volteaH: !!(xfrm && /^(1|true)$/i.test(xfrm.getAttribute('flipH') || '')),
      volteaV: !!(xfrm && /^(1|true)$/i.test(xfrm.getAttribute('flipV') || '')),
      titulo: nombreEl ? (nombreEl.getAttribute('name') || '') : '',
    });
  }
  return out;
}

/**
 * Direccion de blob para un archivo de xl/media, creada una sola vez.
 *
 * EMF y WMF se apartan: son metarchivos vectoriales de Windows —lo que sale al
 * pegar desde AutoCAD— y ningun navegador los dibuja. Vale mas decirlo que
 * dejar un hueco sin explicacion.
 */
const MIME_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                   gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
                   webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

async function urlDeMedio(ruta) {
  if (HJ.urls.has(ruta)) return HJ.urls.get(ruta);
  const ext = (ruta.split('.').pop() || '').toLowerCase();
  if (!MIME_IMG[ext]) { HJ.urls.set(ruta, ''); return ''; }
  const ent = HJ.dib && HJ.dib.zip && HJ.dib.zip.get(ruta);
  if (!ent) { HJ.urls.set(ruta, ''); return ''; }
  const bytes = await descomprime(ent);
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_IMG[ext] }));
  HJ.urls.set(ruta, url);
  return url;
}

/**
 * Coloca las imagenes de la hoja sobre la rejilla ya dibujada.
 *
 * Se mide la fila de cabecera (una celda por columna, sin combinaciones) para
 * las equis, y la columna de numeros de fila para las yes. Son las dos unicas
 * partes de la tabla donde no hay colspan ni rowspan, asi que dan la rejilla
 * limpia aunque el contenido este lleno de celdas combinadas.
 */
async function pintaImagenes(R, finFila, finCol, hojaPedida) {
  const capa = $('xlImgs');
  const envoltorio = document.querySelector('#xlLienzo .xlwrap');
  const tabla = document.querySelector('#xlLienzo .xlTabla');
  if (!capa || !tabla || !envoltorio) return;
  capa.innerHTML = '';
  const anclas = (HJ.dib && HJ.dib.porHoja.get(HJ.hoja)) || [];
  if (!anclas.length) return;

  const cab = tabla.tHead && tabla.tHead.rows[0];
  const filas = tabla.tBodies[0] ? tabla.tBodies[0].rows : [];
  if (!cab || !filas.length) return;

  /*
   * Se mide con rectangulos y no con offsetTop/offsetLeft.
   *
   * El elemento de referencia de una fila de tabla no es el mismo en todos los
   * navegadores, asi que offsetTop podia venir contado desde el cuerpo de la
   * tabla o desde el envoltorio, y en un caso las imagenes bajaban justo el
   * alto de la cabecera. Restar rectangulos da siempre la misma cifra, y
   * ademas no le afecta el desplazamiento: los dos rectangulos se mueven
   * juntos.
   */
  const base = envoltorio.getBoundingClientRect();
  /*
   * Con columnas o filas OCULTAS, la celda numero N de la tabla ya no es la
   * columna N de Excel. Por eso se mide contra las listas de lo realmente
   * dibujado, y a lo oculto se le da el borde derecho de lo anterior: es lo
   * que hace Excel, donde una columna oculta ocupa cero.
   */
  const xs = [], ws = [];
  let ultimoX = 0;
  const listaC = HJ.colsVis || [];
  for (let i = 0; i < listaC.length; i++) {
    const th = cab.cells[i + 1];                    // la 0 es la esquina
    const rc = th && th.getBoundingClientRect();
    const c = listaC[i];
    xs[c] = rc ? rc.left - base.left : ultimoX;
    ws[c] = rc ? rc.width : 0;
    // Las columnas saltadas heredan el borde derecho de la anterior.
    for (let k = (i ? listaC[i - 1] + 1 : R.s.c); k < c; k++) { xs[k] = ultimoX; ws[k] = 0; }
    ultimoX = xs[c] + ws[c];
  }
  const ys = [], hs = [];
  let ultimoY = 0;
  const listaF = HJ.filasVis || [];
  for (let i = 0; i < listaF.length; i++) {
    const tr = filas[i];
    const rc = tr && tr.getBoundingClientRect();
    const r = listaF[i];
    ys[r] = rc ? rc.top - base.top : ultimoY;
    hs[r] = rc ? rc.height : 0;
    for (let k = (i ? listaF[i - 1] + 1 : R.s.r); k < r; k++) { ys[k] = ultimoY; hs[k] = 0; }
    ultimoY = ys[r] + hs[r];
  }
  const xDe = (c, off) => (xs[c] != null ? xs[c] : (xs[finCol] || 0) + (ws[finCol] || 64)) + off / EMU_PX;
  const yDe = (r, off) => (ys[r] != null ? ys[r] : (ys[finFila] || 0) + (hs[finFila] || 20)) + off / EMU_PX;

  let fuera = 0;
  for (const a of anclas) {
    if (a.fila > finFila) { fuera++; continue; }    // esta mas abajo de lo dibujado
    const url = await urlDeMedio(a.medio);
    // Descomprimir tarda: si mientras tanto se cambio de pestana, estas
    // imagenes ya no son las de la hoja que se esta viendo.
    if (hojaPedida && HJ.hoja !== hojaPedida) return;
    const izq = xDe(a.col, a.colOff);
    const arr = yDe(a.fila, a.filaOff);
    let an, al;
    if (a.tipo === 'twoCellAnchor' && a.aCol >= 0) {
      an = Math.max(12, xDe(a.aCol, a.aColOff) - izq);
      al = Math.max(12, yDe(a.aFila, a.aFilaOff) - arr);
    } else {
      an = Math.max(12, a.cx / EMU_PX);
      al = Math.max(12, a.cy / EMU_PX);
    }
    const caja = document.createElement('div');
    caja.className = 'xlimg';
    caja.style.cssText = `left:${Math.round(izq)}px;top:${Math.round(arr)}px;` +
                         `width:${Math.round(an)}px;height:${Math.round(al)}px`;
    if (url) {
      const im = document.createElement('img');
      im.src = url;
      im.alt = a.titulo || 'Imagen de la hoja';
      im.title = (a.titulo || 'Imagen') + ' \u2014 clic para verla en grande';
      im.onclick = () => window.open(url, '_blank', 'noopener');
      const partes = [];
      if (a.giro) partes.push('rotate(' + a.giro + 'deg)');
      if (a.volteaH) partes.push('scaleX(-1)');
      if (a.volteaV) partes.push('scaleY(-1)');
      if (partes.length) {
        /*
         * A 90 y 270 grados la imagen ocupa la caja al reves: se le dan las
         * medidas cambiadas y se centra ANTES de girar, para que al girar
         * llene exactamente el hueco en vez de salirse por los lados.
         */
        const cuarto = a.giro === 90 || a.giro === 270;
        if (cuarto) {
          im.style.position = 'absolute';
          im.style.width = Math.round(al) + 'px';
          im.style.height = Math.round(an) + 'px';
          im.style.left = Math.round((an - al) / 2) + 'px';
          im.style.top = Math.round((al - an) / 2) + 'px';
        }
        im.style.transform = partes.join(' ');
      }
      caja.appendChild(im);
    } else {
      // EMF/WMF u otro formato que el navegador no dibuja.
      caja.classList.add('nodibuja');
      caja.textContent = 'Imagen en formato ' +
        ((a.medio.split('.').pop() || '?').toUpperCase()) +
        ': el navegador no la dibuja. Descarga el archivo para verla en Excel.';
    }
    capa.appendChild(caja);
  }
  if (fuera) {
    const av = $('xlInfo');
    if (av) av.textContent += ` \u00b7 ${fuera} imagen(es) mas abajo: pulsa "Ver mas filas"`;
  }
}


/* ============================================================================
 * CRONOGRAMA DESDE MODELO  (v1.73)
 *
 * El Gantt sale de los propios parametros del modelo, sin archivo de
 * cronograma: cada partida —o cada partida por sector— es una barra que va de
 * la primera a la ultima fecha de sus elementos. Y como cada barra sabe que
 * elementos tiene, el cursor del Gantt aisla en el 3D sin enlazar nada a mano:
 * el enlace 4D que en el cronograma de archivo hay que adivinar por codigos,
 * aqui viene dado.
 *
 * Reutiliza el visor de Gantt del modulo Cronograma (CR, pintaCronograma,
 * mueve4D): un solo dibujo para los dos origenes.
 */

/** Parametros que parecen de fecha: por nombre, o porque sus valores parsean. */
function paramsDeFecha() {
  const out = [];
  for (const p of (props.params || [])) {
    const n = sinTildes(p);
    if (/fecha|date|inicio|fin\b|termino|entrega|liberacion|start|finish|end\b/.test(n)) {
      out.push(p); continue;
    }
    // Sin pista en el nombre: se prueba una muestra de valores.
    const m = props.byParam.get(p);
    if (!m) continue;
    let vistos = 0, fechas = 0;
    for (const v of m.keys()) {
      if (++vistos > 12) break;
      if (parseaFechaValor(v, null) !== null || /^\d{6,8}$/.test(String(v).trim())) fechas++;
    }
    if (vistos && fechas / vistos >= 0.6) out.push(p);
  }
  return out;
}

function pintaPanelCrModelo() {
  const ini = $('crmIni'), fin = $('crmFin');
  if (!ini || !fin) return;
  const lista = paramsDeFecha();
  const ops = lista.map(p => `<option value="${escAttr(p)}">${esc(nombreCorto(p))}</option>`).join('');
  const vIni = ini.value, vFin = fin.value;
  ini.innerHTML = ops || '<option value="">(no hay parametros de fecha en el modelo)</option>';
  fin.innerHTML = '<option value="">(misma que inicio: hitos)</option>' + ops;
  if (lista.includes(vIni)) ini.value = vIni;
  if (lista.includes(vFin)) fin.value = vFin;
  $('crmInfo').textContent = lista.length
    ? lista.length + ' parametro(s) de fecha en el modelo. Cada barra va de la primera a la ' +
      'ultima fecha de los elementos de esa partida.'
    : 'Carga un modelo con parametros de fecha para armar el Gantt.';
}

/**
 * Fecha de cada elemento segun un parametro: usa la mascara y el formato de la
 * linea de tiempo si ya se definio para ese filtro; si no, prueba el formato
 * elegido y, en auto, el que mas fechas consiga.
 */
function fechasPorClave(param, fmt) {
  const m = props.byParam.get(param);
  if (!m) return new Map();
  const f = (typeof filters !== 'undefined') ? filters.find(x => x.param === param && x.tl) : null;
  const mascara = f ? f.tl.mascara : null;
  const intenta = (modo) => {
    const out = new Map();
    for (const [v, ids] of m) {
      const ts = parseaFechaValor(v, modo, mascara);
      if (ts === null) continue;
      for (const k of ids) out.set(k, ts);
    }
    return out;
  };
  if (fmt) return intenta(fmt);
  if (f && f.tl.modo) return intenta(f.tl.modo);
  const a = intenta(null);
  if (a.size) return a;
  const y = intenta('ymd'), d = intenta('dmy');
  return y.size >= d.size ? y : d;
}

function ganttDesdeModelo() {
  const pIni = $('crmIni').value;
  if (!pIni) return alert('Elige el parametro de fecha de inicio.');
  const pFin = $('crmFin').value;
  const fmt = $('crmFmt').value || null;
  const porSector = $('crmSector').checked;

  const idx = (typeof indiceTabla === 'function') ? indiceTabla() : null;
  if (!idx || !idx.cod || (!idx.cod.size && !idx.nom.size)) {
    return alert('El modelo no trae codigo ni nombre de partida: no hay con que armar las barras.');
  }
  const fIni = fechasPorClave(pIni, fmt);
  const fFin = pFin ? fechasPorClave(pFin, fmt) : fIni;
  if (!fIni.size) {
    return alert('Ninguna fecha de ese parametro se entendio. Prueba con otro formato, o ' +
      'define antes la linea de tiempo del filtro (ahi puedes poner los separadores).');
  }

  // Sector de cada elemento, si se pide una barra por partida y sector.
  const secDe = new Map();
  if (porSector && typeof GRUPOS_VIRT !== 'undefined') {
    const g = GRUPOS_VIRT.find(x => x.id === 'sector');
    if (g) for (const p of paramsDeGrupo(g)) {
      const mm = props.byParam.get(p);
      if (!mm) continue;
      for (const [v, ids] of mm) for (const k of ids) if (!secDe.has(k)) secDe.set(k, String(v).trim());
    }
  }

  // Una barra por (codigo, sector): de la primera a la ultima fecha.
  const barras = new Map();
  for (const [k, ts] of fIni) {
    const cod = idx.cod.get(k) || '';
    const nom = idx.nom.get(k) || '';
    if (!cod && !nom) continue;
    const sec = porSector ? (secDe.get(k) || '(sin sector)') : '';
    const id = cod + (sec ? ' @ ' + sec : '');
    let b = barras.get(id);
    if (!b) { b = { id, cod, nom, sec, ini: ts, fin: ts, claves: [], noms: new Map() }; barras.set(id, b); }
    const tf = fFin.get(k);
    b.ini = Math.min(b.ini, ts);
    b.fin = Math.max(b.fin, tf != null ? tf : ts, ts);
    b.claves.push(k);
    if (nom) b.noms.set(nom, (b.noms.get(nom) || 0) + 1);
  }
  if (!barras.size) return alert('Ningun elemento con fecha tiene partida: no hay barras.');

  const tareas = [];
  for (const b of barras.values()) {
    let nombre = b.nom, n = -1;
    for (const [t, c] of b.noms) if (c > n) { nombre = t; n = c; }
    tareas.push({
      id: b.id,
      tid: b.id,                                     // v1.182: clic, vinculos y CPM
      nombre: (nombre || '(sin nombre)') + (b.sec ? ' \u2014 ' + b.sec : '') +
              ' \u00b7 ' + b.claves.length + ' elem.',
      ini: new Date(b.ini), fin: new Date(Math.max(b.fin, b.ini + 86400000)),
      pct: 0, nivel: 1, wbs: b.cod, claves: b.claves,
    });
  }
  tareas.sort((a, b) => (a.wbs || '').localeCompare(b.wbs || '', 'es', { numeric: true }) ||
                        (a.id || '').localeCompare(b.id || '', 'es'));

  // Al visor de Gantt, con el enlace 4D ya resuelto.
  CR.tareas = tareas;
  CR.nombre = 'Cronograma desde modelo \u00b7 ' + nombreCorto(pIni) +
              (pFin ? ' \u2192 ' + nombreCorto(pFin) : '');
  CR.hoy = null;
  CR.mapa = new Map(tareas.map(t => [t.id, t.claves]));
  CR.params = [pIni]; CR.param = pIni;
  $('crWin').classList.remove('hidden');
  pintaCronograma();
  pintaParamsCr();
  // v1.182: vinculos y ruta critica INFERIDOS por fechas (rotulado como tal).
  crInfiereVinculos(tareas, 2);
  crRutaCriticaDe(tareas);
  $('crEnlace').textContent = tareas.length + ' partida(s) con sus elementos ya enlazados desde el modelo. ' +
    'Vinculos y ruta critica INFERIDOS por fechas (FS, hasta 2 dias entre fin e inicio): ' +
    'son la secuencia que las fechas dibujan, no el contractual.';
  const r = $('crFecha');
  if (r) { r.min = 0; r.max = 100; r.value = 100; }
  if ($('crFechaTxt')) $('crFechaTxt').textContent = CR.fin.toLocaleDateString('es-PE');
}

if ($('crmGantt')) $('crmGantt').onclick = () => { try { ganttDesdeModelo(); } catch (e) { alert('No se pudo armar el Gantt: ' + e.message); } };


/* ============================================================================
 * PRESUPUESTOS BC3 (FIEBDC-3)  (v1.77)
 *
 * El archivo nativo de Presto (.presto / .PrestoObra) es binario cerrado. Lo
 * que Presto —y buena parte del software de costos— sabe intercambiar es el
 * BC3: formato de texto con especificacion publica (FIEBDC-3). Trae los
 * conceptos (codigo, unidad, resumen, precio), la descomposicion (que lleva
 * cada partida), las mediciones (lineas con largo, ancho, alto) y los textos
 * largos. Es decir: TODA la metadata del presupuesto, en un formato que si se
 * puede leer.
 *
 * Se convierte en un libro de tres hojas y se abre con el visor de Excel que
 * ya existe: nada nuevo que dibujar, y de paso queda a un paso de cruzarse
 * con el Codigo de partida del modelo.
 */
function leeBc3(buf) {
  /*
   * BC3 va casi siempre en Windows-1252 (ANSI); leerlo como UTF-8 destroza las
   * enes y las tildes de todos los resumenes. Si el archivo declara otra
   * codificacion en su cabecera ~V, se respeta.
   */
  let txt = new TextDecoder('windows-1252').decode(buf);
  const cab = txt.match(/~V\|[^~]*/);
  if (cab && /UTF-?8/i.test(cab[0])) txt = new TextDecoder('utf-8').decode(buf);

  const conceptos = new Map();   // codigo -> {unidad, resumen, precio, fecha, tipo}
  const textos = new Map();      // codigo -> texto largo
  const descomp = [];            // {padre, hijo, factor, rendimiento}
  const medic = [];              // {padre, hijo, total, tipo, comentario, unidades, largo, ancho, alto}
  const limpia = (c) => String(c || '').replace(/#+$/, '').trim();
  const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : ''; };

  for (const reg of txt.split('~')) {
    const tipo = reg[0];
    if (!tipo || reg[1] !== '|') continue;
    const campos = reg.slice(2).split('|');
    if (tipo === 'C') {
      // ~C|CODIGO|UNIDAD|RESUMEN|PRECIO|FECHA|TIPO|
      const cod = limpia(campos[0]);
      if (!cod) continue;
      const esCap = /#$/.test(campos[0] || '');
      conceptos.set(cod, {
        unidad: (campos[1] || '').trim(), resumen: (campos[2] || '').trim(),
        precio: num((campos[3] || '').split('\\')[0]),
        fecha: (campos[4] || '').split('\\')[0].trim(),
        tipo: (campos[5] || '').split('\\')[0].trim(), capitulo: esCap,
      });
    } else if (tipo === 'D' || tipo === 'Y') {
      // ~D|PADRE|HIJO\FACTOR\RENDIMIENTO\HIJO\FACTOR\RENDIMIENTO...|
      const padre = limpia(campos[0]);
      const t = (campos[1] || '').split('\\');
      for (let i = 0; i + 2 < t.length + 1 && i < t.length; i += 3) {
        const hijo = limpia(t[i]);
        if (!hijo) continue;
        descomp.push({ padre, hijo, factor: num(t[i + 1]), rendimiento: num(t[i + 2]) });
      }
    } else if (tipo === 'T') {
      textos.set(limpia(campos[0]), (campos[1] || '').replace(/\s+/g, ' ').trim());
    } else if (tipo === 'M' || tipo === 'N') {
      // ~M|[PADRE\]HIJO|POSICION|TOTAL|TIPO\COMENTARIO\UNIDADES\LARGO\ANCHO\ALTO\...|
      const pc = (campos[0] || '').split('\\');
      const hijo = limpia(pc.pop());
      const padre = limpia(pc.pop());
      const total = num(campos[2]);
      const lineas = (campos[3] || '').split('\\');
      let alguna = false;
      for (let i = 0; i + 5 < lineas.length + 1 && i < lineas.length; i += 6) {
        const fila = { padre, hijo, total, tipo: (lineas[i] || '').trim(),
          comentario: (lineas[i + 1] || '').trim(), unidades: num(lineas[i + 2]),
          largo: num(lineas[i + 3]), ancho: num(lineas[i + 4]), alto: num(lineas[i + 5]) };
        if (fila.comentario || fila.unidades !== '' || fila.largo !== '') { medic.push(fila); alguna = true; }
      }
      if (!alguna) medic.push({ padre, hijo, total, tipo: '', comentario: '', unidades: '', largo: '', ancho: '', alto: '' });
    }
  }
  return { conceptos, textos, descomp, medic };
}

/** BC3 -> libro de tres hojas -> visor de Excel. */
async function abreBc3(buf, nombre, carpeta) {
  await cargaSheetJS();
  const b = leeBc3(buf);
  if (!b.conceptos.size) throw new Error('el BC3 no trae conceptos (~C)');

  const hoja1 = [['Codigo', 'Capitulo', 'Unidad', 'Resumen', 'Precio', 'Fecha', 'Tipo', 'Texto largo']];
  for (const [cod, c] of b.conceptos) {
    hoja1.push([cod, c.capitulo ? 'Si' : '', c.unidad, c.resumen, c.precio, c.fecha, c.tipo,
                b.textos.get(cod) || '']);
  }
  const hoja2 = [['Padre', 'Hijo', 'Factor', 'Rendimiento', 'Resumen del hijo', 'Unidad', 'Precio']];
  for (const d of b.descomp) {
    const h = b.conceptos.get(d.hijo) || {};
    hoja2.push([d.padre, d.hijo, d.factor, d.rendimiento, h.resumen || '', h.unidad || '', h.precio ?? '']);
  }
  const hoja3 = [['Padre', 'Partida', 'Total', 'Tipo', 'Comentario', 'Unidades', 'Largo', 'Ancho', 'Alto']];
  for (const m of b.medic) {
    hoja3.push([m.padre, m.hijo, m.total, m.tipo, m.comentario, m.unidades, m.largo, m.ancho, m.alto]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja1), 'Conceptos');
  if (hoja2.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja2), 'Descomposicion');
  if (hoja3.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja3), 'Mediciones');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await abreHoja(out, nombre + ' (BC3)', carpeta || '', false);
  $('xlWin').classList.remove('hidden');
  pintaPestanasHoja();
  pintaHoja();
  return b;
}
