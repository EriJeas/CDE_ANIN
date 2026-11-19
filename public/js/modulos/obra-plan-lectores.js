/* LECTORES DE CRONOGRAMAS para Planificación (Seguimiento de obra): Primavera P6 (XER y XML), Microsoft Project (XML y MPX) y Excel.
 * Son, sin cambios, las funciones puras del visor (public/js/visor-origen/cronograma.js): se copian aquí con
 * herramientas/copia-lectores-cronograma.py para que el portal las use sin cargar el visor. No editar a mano: corregir allá y volver a copiar. */
(function () {
function conFuente(arr, txt, tipo) {
  try { Object.defineProperty(arr, '__fuente', { value: { txt: String(txt || ''), tipo }, configurable: true }); } catch (e) {}
  return arr;
}

const fecha = (s) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isFinite(d.getTime()) ? d : null;
};

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

function xerTipoVinculo(t) {
  return ({ PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' })[t] || (t || 'FS').replace(/^PR_/, '');
}

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

  CDE.N.OBX = CDE.N.OBX || {};
  CDE.N.OBX.lectores = { leeXml, leeXer, leeMpx, leeExcel, crInfiereVinculos, crRutaCriticaDe, xerTablas };
})();
