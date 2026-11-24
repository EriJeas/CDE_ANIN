/*
 * FLUJOS DE REVISION Y APROBACION: configurables por proyecto, al estilo de los "approval workflows" de Autodesk Docs
 * (nombre, descripcion, iniciadores, pasos con revisor unico o varios, revisores por organizacion/rol/usuario, dias
 * permitidos, copiar los aprobados a una carpeta) y con lo que ACC no tiene: ETAPAS con pasos EN PARALELO. Una etapa
 * agrupa uno o mas pasos que corren a la vez; la ronda avanza a la etapa siguiente cuando todos los pasos de la etapa
 * actual quedan decididos. Cualquier "devolver" cierra la ronda (como el rechazo en ACC).
 *
 * Modelo (config.flujos[]):
 *   { id, nombre, descripcion, activo,
 *     iniciadores: [{ tipo: 'org'|'rol'|'usuario'|'*', valor }],
 *     etapas: [{ nombre, pasos: [{ id, nombre, tipo: 'uno'|'todos'|'minimo', minimo, revisores (CLAVE): [{ tipo, valor }], opcionales: [...], dias, devolverAlIniciador }] }],
 *     estados: [{ id, valor: 'aprobado'|'rechazado', etiqueta, icono }]   (los "estados de revision" de Forma: los 3 de serie + los que anada el gestor)
 *     alAprobar: { estado: 'PUBLICADO'|'COMPARTIDO', idoneidad: 'A1', cuando: 'todas'|'aprobados', copiarA: 'ruta', iniciadorPuedeCambiar, aprobadoresPuedenCambiar, incluirMarcas, actualizarAtributos: { atributo: valor } },
 *     etiquetas: { aprobada, 'aprobada-con-comentarios', devuelta }   (derivadas de estados; se conservan por compatibilidad) }
 * Revisores CLAVE: su decision cuenta para completar el paso. OPCIONALES: pueden opinar (queda registrado) pero no hacen avanzar ni bloquean.
 * Es independiente del tipo de documento: cualquier contenedor COMPARTIDO puede entrar en cualquier flujo activo.
 *
 * v0.6.6 — REVISION EN PARALELO CON CONSENSO, RECOMENDACIONES Y DECISOR (el flujo DC → especialistas → Gerente de Proyecto):
 *   - Revisores por CARGO: { tipo: 'cargo', valor: 'DC', org: 'ANIN' } = los miembros con ese cargo (y, si se indica, de esa organizacion).
 *   - Etapa con  modo: 'consenso'  (p. ej. la revision de calidad de los dos Document Control): un rechazo NO cierra la ronda; se espera
 *     al otro paso. Todos aceptan → sigue; todos rechazan (o el otro se ADHIERE al rechazo del primero) → se rechaza con la firma de
 *     todos; uno acepta y otro rechaza → decide el ARBITRO (arbitro: [...], p. ej. el Gerente de Proyecto).
 *     alVencer: 'avanzar' → vencido el plazo (dias): si alguien rechazo y el otro no termino, se rechaza con las observaciones del
 *     primero; si nadie rechazo, pasa a la etapa siguiente como aceptada por todos.
 *   - Paso con  recomienda: true : TODOS sus revisores opinan (aceptar / rechazar) y eso es una RECOMENDACION: no cierra la ronda.
 *     Con  decide: [...]  (p. ej. el KP1 de la Supervision), cuando todos recomendaron, ese decisor emite el resultado del paso.
 *   - Etapa con  etiquetas: { aprobada, devuelta }  propias (p. ej. «QA Accepted» / «QA Rejected»).
 */
'use strict';
const ISO = require('./iso19650');

const TIPOS_PASO = ['uno', 'todos', 'minimo'];
const ETIQUETAS = { aprobada: 'Aprobado', 'aprobada-con-comentarios': 'Aprobado con comentarios', devuelta: 'Rechazado / devuelto' };
const ICONOS = ['check', 'check-doble', 'comentario', 'x', 'alerta', 'reloj', 'estrella', 'bandera', 'ojo', 'candado'];
const ESTADOS_BASE = () => [{ id: 'aprobada', valor: 'aprobado', etiqueta: ETIQUETAS.aprobada, icono: 'check', base: true }, { id: 'aprobada-con-comentarios', valor: 'aprobado', etiqueta: ETIQUETAS['aprobada-con-comentarios'], icono: 'comentario', base: true }, { id: 'devuelta', valor: 'rechazado', etiqueta: ETIQUETAS.devuelta, icono: 'x', base: true }];
/** Estados de revision: los tres de serie (no se quitan, si se reetiquetan) mas los que anada el gestor. */
function normalizaEstados(lista, etiquetas) {
  const base = ESTADOS_BASE(); if (etiquetas) for (const b of base) if (etiquetas[b.id]) b.etiqueta = String(etiquetas[b.id]).slice(0, 60);
  const out = base.slice();
  for (const e of (Array.isArray(lista) ? lista : [])) {
    if (!e || typeof e !== 'object') continue;
    const b = out.find(x => x.id === e.id);
    if (b) { if (e.etiqueta) b.etiqueta = String(e.etiqueta).slice(0, 60); if (ICONOS.includes(e.icono)) b.icono = e.icono; continue; }
    const etiqueta = String(e.etiqueta || '').trim().slice(0, 60); if (!etiqueta) continue;
    let id = slug(e.id || etiqueta); if (out.some(x => x.id === id)) id = id + '-' + (out.length + 1);
    out.push({ id, valor: e.valor === 'rechazado' ? 'rechazado' : 'aprobado', etiqueta, icono: ICONOS.includes(e.icono) ? e.icono : (e.valor === 'rechazado' ? 'x' : 'check'), base: false });
  }
  return out.slice(0, 12);
}
/** A que decision de fondo corresponde un estado: aprobada | aprobada-con-comentarios | devuelta. */
function decisionDeEstado(flujo, id) { const e = (flujo.estados || ESTADOS_BASE()).find(x => x.id === id); if (!e) return ''; if (e.base) return e.id; return e.valor === 'rechazado' ? 'devuelta' : 'aprobada'; }

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'flujo';

function normalizaQuien(lista) {
  const out = [];
  for (const e of (Array.isArray(lista) ? lista : [])) {
    const tipo = e.tipo === '*' || e.tipo === 'todos' ? '*' : ['usuario', 'rol', 'org', 'cargo'].includes(e.tipo) ? e.tipo : e.tipo === 'organizacion' ? 'org' : '';
    if (!tipo) continue;
    const valor = tipo === '*' ? '' : tipo === 'usuario' ? String(e.valor || '').trim().toLowerCase() : tipo === 'rol' ? String(e.valor || '').trim().toLowerCase() : String(e.valor || '').trim().toUpperCase();
    if (tipo !== '*' && !valor) continue;
    if (tipo === 'rol' && !(valor in ISO.RANGO_ROL)) continue;
    const org = tipo === 'cargo' ? String(e.org || '').trim().toUpperCase() : '';
    if (!out.some(x => x.tipo === tipo && x.valor === valor && (x.org || '') === org)) out.push(org ? { tipo, valor, org } : { tipo, valor });
  }
  return out;
}

/** Valida y normaliza un flujo. Devuelve { flujo } o { error }. */
function normaliza(f, existentes) {
  if (!f || typeof f !== 'object') return { error: 'Flujo vacio.' };
  const nombre = String(f.nombre || '').trim().slice(0, 120); if (!nombre) return { error: 'El flujo necesita un nombre.' };
  let id = String(f.id || '').trim() || slug(nombre);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) id = slug(id);
  const iniciadores = normalizaQuien(f.iniciadores); if (!iniciadores.length) iniciadores.push({ tipo: '*', valor: '' });
  const etapas = [];
  for (const [i, e] of (Array.isArray(f.etapas) ? f.etapas : []).entries()) {
    const pasos = [];
    for (const [j, p] of (Array.isArray(e && e.pasos) ? e.pasos : []).entries()) {
      const revisores = normalizaQuien(p.revisores); if (!revisores.length) return { error: 'El paso "' + (p.nombre || (i + 1) + '.' + (j + 1)) + '" no tiene revisores.' };
      const tipo = TIPOS_PASO.includes(p.tipo) ? p.tipo : 'uno';
      const minimo = tipo === 'minimo' ? Math.max(1, parseInt(p.minimo, 10) || 1) : (tipo === 'todos' ? 0 : 1);
      const opcionales = normalizaQuien(p.opcionales).filter(o => !revisores.some(r => r.tipo === o.tipo && r.valor === o.valor));
      const recomienda = !!p.recomienda, decide = recomienda ? normalizaQuien(p.decide) : [];
      const paso = { id: String(p.id || ('p' + (i + 1) + '-' + (j + 1))).slice(0, 20), nombre: String(p.nombre || 'Paso ' + (i + 1) + '.' + (j + 1)).trim().slice(0, 120), tipo: recomienda ? 'todos' : tipo, minimo: recomienda ? 0 : minimo, revisores, opcionales, dias: Math.max(0, Math.min(365, parseInt(p.dias, 10) || 0)), devolverAlIniciador: p.devolverAlIniciador !== false, nota: String(p.nota || '').slice(0, 300) };
      if (recomienda) { paso.recomienda = true; if (decide.length) paso.decide = decide; }
      pasos.push(paso);
    }
    if (!pasos.length) return { error: 'La etapa ' + (i + 1) + ' no tiene pasos.' };
    const ids = pasos.map(p => p.id); if (new Set(ids).size !== ids.length) return { error: 'Hay pasos con el mismo id en la etapa ' + (i + 1) + '.' };
    const et = { nombre: String((e && e.nombre) || (pasos.length > 1 ? 'Etapa ' + (i + 1) + ' (en paralelo)' : pasos[0].nombre)).slice(0, 120), pasos };
    if (e && e.modo === 'consenso' && pasos.length > 1 && !pasos.some(x => x.recomienda)) { et.modo = 'consenso'; const arb = normalizaQuien(e.arbitro); if (arb.length) et.arbitro = arb; if (e.alVencer === 'avanzar') et.alVencer = 'avanzar'; }
    if (e && e.etiquetas && typeof e.etiquetas === 'object') { const q = {}; for (const k of ['aprobada', 'devuelta']) if (e.etiquetas[k]) q[k] = String(e.etiquetas[k]).trim().slice(0, 40); if (Object.keys(q).length) et.etiquetas = q; }
    etapas.push(et);
  }
  if (!etapas.length) return { error: 'El flujo necesita al menos una etapa con un paso.' };
  const todosIds = etapas.flatMap(e => e.pasos.map(p => p.id)); if (new Set(todosIds).size !== todosIds.length) return { error: 'Hay pasos con el mismo id en distintas etapas.' };
  const a = f.alAprobar || {};
  const estado = ['PUBLICADO', 'COMPARTIDO'].includes(a.estado) ? a.estado : 'PUBLICADO';
  const idon = String(a.idoneidad || (estado === 'PUBLICADO' ? 'A1' : 'S4')).toUpperCase();
  if (!(ISO.IDONEIDAD[estado] || []).includes(idon)) return { error: 'El codigo de estado ' + idon + ' no corresponde a ' + estado + '.' };
  const atributos = {}; if (a.actualizarAtributos && typeof a.actualizarAtributos === 'object') for (const [k, v] of Object.entries(a.actualizarAtributos).slice(0, 30)) if (String(k).trim()) atributos[String(k).trim().slice(0, 60)] = String(v == null ? '' : v).slice(0, 200);
  const reglas = {}; if (a.atributosReglas && typeof a.atributosReglas === 'object') for (const [k, v] of Object.entries(a.atributosReglas).slice(0, 30)) if (v && typeof v === 'object' && (v.incremento || v.requerido)) reglas[String(k).trim().slice(0, 60)] = { incremento: !!v.incremento, requerido: !!v.requerido };
  const alAprobar = { estado, idoneidad: idon, cuando: a.cuando === 'aprobados' ? 'aprobados' : 'todas', copiarA: String(a.copiarA || '').replace(/^\/+|\/+$/g, '').slice(0, 300), iniciadorPuedeCambiar: !!a.iniciadorPuedeCambiar, aprobadoresPuedenCambiar: !!a.aprobadoresPuedenCambiar, incluirMarcas: a.incluirMarcas !== false, actualizarAtributos: atributos, atributosEn: a.atributosEn === 'ambas' ? 'ambas' : 'destino', revisoresEditanAtributos: !!a.revisoresEditanAtributos, atributosReglas: reglas };
  const estados = normalizaEstados(f.estados, f.etiquetas);
  const etiquetas = Object.assign({}, ETIQUETAS); for (const e of estados) if (e.base) etiquetas[e.id] = e.etiqueta;
  if (Array.isArray(existentes) && existentes.some(x => x.id === id && x !== f && x.id !== f.id)) id = id + '-' + Date.now().toString(36).slice(-4);
  return { flujo: { id, nombre, descripcion: String(f.descripcion || '').slice(0, 1000), activo: f.activo !== false, iniciadores, etapas, estados, alAprobar, etiquetas, creado: f.creado || new Date().toISOString(), actualizado: new Date().toISOString() } };
}

/** El usuario { email, rol, organizacion, admin } encaja con alguna entrada de la lista. */
function encaja(lista, u) {
  for (const e of (lista || [])) {
    if (e.tipo === '*') return true;
    if (e.tipo === 'usuario' && u.email && u.email.toLowerCase() === e.valor) return true;
    if (e.tipo === 'rol') { const r = String(u.rol || '').toLowerCase(); if (r === e.valor || ISO.familia(r) === e.valor) return true; }
    if (e.tipo === 'org' && String(u.organizacion || '').toUpperCase() === e.valor) return true;
    if (e.tipo === 'cargo' && String(u.cargo || '').toUpperCase() === e.valor && (!e.org || String(u.organizacion || '').toUpperCase() === e.org)) return true;
  }
  return false;
}
/** Correos de los miembros que encajan con los revisores de un paso (para "todos" y para la columna "siguiente accion de"). */
function candidatos(paso, miembros) {
  const out = [];
  for (const m of (miembros || [])) { const u = { email: m.email, rol: m.rol, organizacion: m.organizacion, cargo: m.cargo }; if (encaja(paso.revisores, u) && !out.includes(m.email)) out.push(m.email); }
  return out;
}
/** Texto corto de quien revisa un paso. */
function describe(lista) { return (lista || []).map(e => e.tipo === '*' ? 'cualquier miembro' : e.tipo === 'rol' ? 'rol ' + e.valor : e.tipo === 'cargo' ? e.valor + (e.org ? ' de ' + e.org : '') : e.tipo === 'org' ? e.valor : e.valor).join(', '); }

/** Fecha limite de la etapa: inicio + el mayor "dias" de sus pasos (dias naturales, como ACC). '' si ningun paso lo fija. */
function venceEtapa(etapa, inicioIso) {
  const d = Math.max(0, ...etapa.pasos.map(p => p.dias || 0)); if (!d) return '';
  const t = new Date(inicioIso || Date.now()); t.setUTCDate(t.getUTCDate() + d); return t.toISOString();
}

/**
 * Estado de la ronda a partir de las decisiones registradas (r.pasos = [{ etapa, paso, decision, por, fecha, comentario }]).
 * Devuelve por paso de la etapa actual: decididos, pendientes (candidatos que faltan) y si el paso esta completo.
 */
function estadoEtapa(flujo, r, miembros) {
  const etapa = flujo.etapas[r.paso || 0]; if (!etapa) return { completa: true, pasos: [] };
  const uDe = (email) => { const m = (miembros || []).find(x => x.email === email); return m ? { email: m.email, rol: m.rol, organizacion: m.organizacion, cargo: m.cargo } : null; };
  const pasos = etapa.pasos.map(p => {
    const dec = (r.pasos || []).filter(d => d.etapa === (r.paso || 0) && d.paso === p.id);
    const cand = candidatos(p, miembros), opc = candidatos({ revisores: p.opcionales || [] }, miembros).filter(e => !cand.includes(e));
    // solo las decisiones de revisores CLAVE completan el paso (un administrador cuenta como clave); las opcionales quedan registradas
    const esClave = (email) => { const m = uDe(email); return !m || m.rol === 'administrador' || encaja(p.revisores, m); };
    const base = { id: p.id, nombre: p.nombre, tipo: p.tipo, minimo: p.minimo, revisores: p.revisores, opcionales: p.opcionales || [], dias: p.dias, decisiones: dec, candidatos: cand, candidatosOpcionales: opc };
    if (p.recomienda) {
      // RECOMENDACIONES: opinan todos los revisores; con decisor, el paso se completa cuando el decisor emite el resultado del equipo
      const rec = dec.filter(d => d.clase !== 'decision-equipo' && !d.opcional), hechos = rec.map(d => d.por), fin = dec.find(d => d.clase === 'decision-equipo' || d.clase === 'auto');
      const conDec = !!(p.decide && p.decide.length);
      // sin miembros con ese cargo: basta una revision (del administrador) y, si hay quien decide por el equipo, puede decidir sin esperar
      const recomendado = cand.length > 0 ? cand.every(c => hechos.includes(c)) : (rec.length >= 1 || conDec), decisores = p.decide && p.decide.length ? candidatos({ revisores: p.decide }, miembros) : [];
      const completo = p.decide && p.decide.length ? !!fin : (recomendado || !!fin);
      return Object.assign(base, { recomienda: true, decide: p.decide || [], decisores, recomendado, esperaDecision: !!(p.decide && p.decide.length) && recomendado && !fin, pendientes: recomendado ? (fin || !(p.decide && p.decide.length) ? [] : decisores) : cand.filter(c => !hechos.includes(c)), completo,
        resultado: fin ? (fin.decision === 'devuelta' ? 'devuelta' : 'aprobada') : (completo ? (rec.some(d => d.decision === 'devuelta') ? 'devuelta' : 'aprobada') : ''), sinVoto: conDec, revisados: rec.length, aFavor: rec.filter(d => d.clase === 'recomendacion' && d.decision !== 'devuelta').length, enContra: rec.filter(d => d.clase === 'recomendacion' && d.decision === 'devuelta').length });
    }
    const clave = dec.filter(d => esClave(d.por) || d.clase === 'auto'), hechos = clave.map(d => d.por);
    let completo = false;
    if (clave.some(d => d.clase === 'auto')) completo = true;
    else if (p.tipo === 'uno') completo = clave.length >= 1;
    else if (p.tipo === 'minimo') completo = clave.length >= p.minimo;
    else completo = cand.length > 0 && cand.every(c => hechos.includes(c));
    return Object.assign(base, { pendientes: cand.filter(c => !hechos.includes(c)), completo, resultado: completo ? (clave.some(d => d.decision === 'devuelta') ? 'devuelta' : 'aprobada') : (clave.some(d => d.decision === 'devuelta') ? 'devuelta' : '') });
  });
  const out = { etapa: r.paso || 0, nombre: etapa.nombre, modo: etapa.modo || '', etiquetas: etapa.etiquetas || null, alVencer: etapa.alVencer || '', pasos, completa: pasos.every(p => p.completo) };
  if (etapa.modo === 'consenso') {
    // CONSENSO: nadie cierra solo. aceptada (todos aceptan) | rechazada (todos rechazan o se adhieren) | conflicto (decide el arbitro)
    const arb = (r.pasos || []).find(d => d.etapa === (r.paso || 0) && d.clase === 'arbitraje');
    const res = pasos.map(p => p.completo ? p.resultado : ''), todos = res.every(Boolean);
    out.arbitro = etapa.arbitro || []; out.arbitros = etapa.arbitro ? candidatos({ revisores: etapa.arbitro }, miembros) : [];
    out.rechazos = pasos.filter(p => p.resultado === 'devuelta').map(p => p.id);
    out.consenso = arb ? (arb.decision === 'devuelta' ? 'rechazada' : 'aceptada') : !todos ? (out.rechazos.length ? 'rechazo-en-espera' : 'en-curso') : res.every(x => x === 'aprobada') ? 'aceptada' : res.every(x => x === 'devuelta') ? 'rechazada' : 'conflicto';
    out.completa = out.consenso === 'aceptada' || out.consenso === 'rechazada';
  }
  return out;
}

/** Pasos de la etapa actual que este usuario puede decidir ahora (encaja y no ha decidido ya). Cada uno lleva `accion`:
 *  'decidir' (paso normal) | 'recomendar' | 'decidir-equipo' (el decisor de un paso con recomendaciones) | 'arbitrar' (conflicto de consenso). */
function pasosDecidibles(flujo, r, u, miembros) {
  if (!flujo || r.estado !== 'abierta') return [];
  const est = estadoEtapa(flujo, r, miembros), esAdmin = u.admin || u.rol === 'administrador', out = [];
  for (const p of est.pasos) {
    if (p.recomienda) {
      // con decisor (p. ej. KP1 de la Supervision) los especialistas solo ENVIAN su revision (incidencias y comentarios): la recomendacion es del equipo sin decisor
      if (!p.completo && !p.recomendado && !p.decisiones.some(d => d.por === u.email) && (encaja(p.revisores, u) || encaja(p.opcionales || [], u) || (esAdmin && !p.candidatos.length))) out.push(Object.assign({}, p, { accion: p.sinVoto ? 'revisar' : 'recomendar' }));
      else if (p.esperaDecision && (esAdmin || encaja(p.decide, u))) out.push(Object.assign({}, p, { accion: 'decidir-equipo' }));
      continue;
    }
    if (!p.completo && !p.decisiones.some(d => d.por === u.email) && (esAdmin || encaja(p.revisores, u) || encaja(p.opcionales || [], u))) out.push(Object.assign({}, p, { accion: 'decidir' }));
  }
  if (est.modo === 'consenso' && est.consenso === 'conflicto' && (esAdmin || encaja(est.arbitro, u))) out.push({ id: '__arbitro', nombre: 'Decisión del conflicto (' + describe(est.arbitro) + ')', accion: 'arbitrar', revisores: est.arbitro, opcionales: [], decisiones: [], candidatos: est.arbitros, pendientes: est.arbitros, completo: false });
  return out;
}

/**
 * FLUJOS DE LA DEO (23/11/2026): cuatro flujos. Los inicia el Document Control (cargo DC) del contratista, salvo el 4 (la Supervisión):
 *  1. Revisión ANIN y Supervisión en Paralelo — el que se llamaba «Revision de especialistas en paralelo y aprobacion» (misma estructura).
 *  2. Revisión de especialistas ANIN — QA del DC de ANIN → recomendación de cada especialista de ANIN → aprobación del GP.
 *  3. Revisión de especialistas de Supervisión — QA del DC de la Supervisión → recomendación de cada especialista de la Supervisión,
 *     que cierra el KP1 de la Supervisión con la Aceptación o el Rechazo de cada documento → aprobación del GP.
 *  4. Revisión de Supervisión a GP — lo inicia la Supervisión: QA del DC de ANIN → recomendación de los especialistas de ANIN → aprobación del GP.
 * Se retiran «Revision de la Supervision y aprobacion de la Entidad», «Revisión en paralelo: Document Control, especialistas y Gerente de
 * Proyecto» y «Coordinacion interna». La respuesta de toda revisión vence a los DIAS_RESPUESTA días de su envío; con QA Rejected se reinicia.
 */
const DIAS_RESPUESTA = 14;
const QA = { aprobada: 'QA Accepted', devuelta: 'QA Rejected' };
const ESTADOS_GP = [{ id: 'aprobada', etiqueta: 'Aceptado' }, { id: 'aprobada-con-comentarios', etiqueta: 'Aceptado con comentarios' }, { id: 'devuelta', etiqueta: 'Rechazado' }];
const ordenOrgs = (orgs) => Object.assign({ contr: 'CONTRATISTA', super: 'SUPERVISION', entidad: 'ANIN' }, orgs || {});
/** 1 · Revisión ANIN y Supervisión en Paralelo (la estructura del antiguo «especialistas en paralelo»: control documentario → especialistas de la Supervisión ∥ de la Entidad → gestor). */
function revisionAninSupervision(orgs) {
  const o = ordenOrgs(orgs);
  return { id: 'especialistas-paralelo', nombre: 'Revisión ANIN y Supervisión en Paralelo',
    descripcion: 'Lo inicia el Document Control del contratista. Participan los especialistas de ' + o.entidad + ' y de la Supervisión en las revisiones de los documentos.',
    iniciadores: [{ tipo: 'cargo', valor: 'DC', org: o.contr }],
    etapas: [{ nombre: 'Control documentario', etiquetas: QA, pasos: [{ id: 'control', nombre: 'Control documentario', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'revisor' }], dias: 2 }] },
      { nombre: 'Revision tecnica en paralelo', pasos: [{ id: 'esp-super', nombre: 'Especialistas de la Supervision', tipo: 'uno', revisores: [{ tipo: 'org', valor: o.super }], dias: 9 }, { id: 'esp-entidad', nombre: 'Especialistas de la Entidad', tipo: 'uno', revisores: [{ tipo: 'org', valor: o.entidad }], dias: 9 }] },
      { nombre: 'Aprobacion', pasos: [{ id: 'gestor', nombre: 'Gerente de proyecto', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'gestor' }], dias: 3 }] }],
    alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: '', iniciadorPuedeCambiar: true } };
}
/** 2 y 4 · QA del DC de ANIN → recomendación de los especialistas de ANIN → aprobación del GP. Cambia quién lo inicia. */
function revisionEquipoAnin(orgs, id, nombre, iniciador, descripcion) {
  const o = ordenOrgs(orgs), gp = [{ tipo: 'cargo', valor: 'GP', org: o.entidad }];
  return { id, nombre, descripcion, iniciadores: [{ tipo: 'cargo', valor: 'DC', org: iniciador }],
    etapas: [{ nombre: 'Paso 1 · DC ' + o.entidad + ': revisión de calidad de documentos (QA)', etiquetas: QA, pasos: [{ id: 'dc-anin', nombre: 'DC ' + o.entidad, tipo: 'uno', revisores: [{ tipo: 'cargo', valor: 'DC', org: o.entidad }], dias: 2 }] },
      { nombre: 'Paso 2 · Especialistas ' + o.entidad + ': recomendación de Aceptación o Rechazo', etiquetas: { aprobada: 'Aceptar', devuelta: 'Rechazar' }, pasos: [{ id: 'esp-anin', nombre: 'Especialistas ' + o.entidad, recomienda: true, revisores: [{ tipo: 'cargo', valor: 'ESPECIALISTA', org: o.entidad }], dias: 9 }] },
      { nombre: 'Paso 3 · Gerente de Proyecto: aprobación (Aceptación o Rechazo de cada documento)', etiquetas: { aprobada: 'Aceptado', devuelta: 'Rechazado' }, pasos: [{ id: 'gp', nombre: 'Gerente de Proyecto', tipo: 'uno', revisores: gp, dias: 3 }] }],
    estados: ESTADOS_GP, alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: '', iniciadorPuedeCambiar: true } };
}
const revisionAnin = (orgs) => { const o = ordenOrgs(orgs); return revisionEquipoAnin(o, 'revision-especialistas-anin', 'Revisión de especialistas ANIN', o.contr, 'Lo inicia el Document Control del contratista y lo revisa solo el equipo de ' + o.entidad + '. Paso 1: el DC de ' + o.entidad + ' revisa la calidad de los documentos (QA). Paso 2: cada especialista de ' + o.entidad + ' que revisa recomienda Aceptación o Rechazo. Paso 3: el GP aprueba (Aceptación o Rechazo de cada documento).'); };
const supervisionAGp = (orgs) => { const o = ordenOrgs(orgs); return revisionEquipoAnin(o, 'revision-supervision-gp', 'Revisión de Supervisión a GP', o.super, 'Lo inicia el Document Control de la Supervisión. Paso 1: el DC de ' + o.entidad + ' revisa la calidad de los documentos (QA). Paso 2: cada especialista de ' + o.entidad + ' que revisa recomienda Aceptación o Rechazo. Paso 3: el GP aprueba (Aceptación o Rechazo de cada documento).'); };
/** 3 · Revisión de especialistas de Supervisión: QA del DC de la Supervisión → recomendación de sus especialistas que cierra el KP1 → aprobación del GP. */
function revisionSupervision(orgs) {
  const o = ordenOrgs(orgs), gp = [{ tipo: 'cargo', valor: 'GP', org: o.entidad }];
  return { id: 'revision-especialistas-supervision', nombre: 'Revisión de especialistas de Supervisión',
    descripcion: 'Lo inicia el Document Control del contratista y lo revisa solo el equipo de la Supervisión. Paso 1: el DC de la Supervisión revisa la calidad de los documentos (QA). Paso 2: cada especialista de la Supervisión recomienda Aceptación o Rechazo; el paso lo cierra el KP1 de la Supervisión con la Aceptación o el Rechazo de cada documento, tomando como base la recomendación de su equipo. Paso 3: el GP aprueba (Aceptación o Rechazo de cada documento).',
    iniciadores: [{ tipo: 'cargo', valor: 'DC', org: o.contr }],
    etapas: [{ nombre: 'Paso 1 · DC Supervisión: revisión de calidad de documentos (QA)', etiquetas: QA, pasos: [{ id: 'dc-super', nombre: 'DC Supervisión', tipo: 'uno', revisores: [{ tipo: 'cargo', valor: 'DC', org: o.super }], dias: 2 }] },
      { nombre: 'Paso 2 · Especialistas de Supervisión: recomendación; cierra el KP1', etiquetas: { aprobada: 'Aceptar', devuelta: 'Rechazar' }, pasos: [{ id: 'esp-super', nombre: 'Especialistas de Supervisión', recomienda: true, decide: [{ tipo: 'cargo', valor: 'KP1', org: o.super }], revisores: [{ tipo: 'cargo', valor: 'ESPECIALISTA', org: o.super }], dias: 9 }] },
      { nombre: 'Paso 3 · Gerente de Proyecto: aprobación (Aceptación o Rechazo de cada documento)', etiquetas: { aprobada: 'Aceptado', devuelta: 'Rechazado' }, pasos: [{ id: 'gp', nombre: 'Gerente de Proyecto', tipo: 'uno', revisores: gp, dias: 3 }] }],
    estados: ESTADOS_GP, alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: '', iniciadorPuedeCambiar: true } };
}
const FLUJOS_DEO = [revisionAninSupervision, revisionAnin, revisionSupervision, supervisionAGp];
const RETIRADOS = ['supervision-entidad', 'paralelo-dc-especialistas-gp', 'coordinacion'];
const VERSION_FLUJOS = 2;

/** Flujos por defecto de un proyecto nuevo (editables): los cuatro de la DEO. */
function porDefecto(orgs) { return FLUJOS_DEO.map(fn => normaliza(fn(orgs)).flujo); }
/** Los flujos que se retiraron (sirven de plantilla y para las pruebas del motor de consenso). */
function plantillasAnteriores(orgs) {
  const o = ordenOrgs(orgs);
  return {
    supervisionEntidad: { id: 'supervision-entidad', nombre: 'Revision de la Supervision y aprobacion de la Entidad', iniciadores: [{ tipo: 'org', valor: o.contr }, { tipo: 'rol', valor: 'gestor' }],
      etapas: [{ nombre: 'Revision de la Supervision', pasos: [{ id: 'super', nombre: 'Revision de la Supervision', tipo: 'uno', revisores: [{ tipo: 'org', valor: o.super }], dias: 7 }] }, { nombre: 'Aprobacion de la Entidad', pasos: [{ id: 'anin', nombre: 'Aprobacion de la Entidad', tipo: 'uno', revisores: [{ tipo: 'org', valor: o.entidad }], dias: 5 }] }],
      alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: '', iniciadorPuedeCambiar: true } },
    coordinacion: { id: 'coordinacion', nombre: 'Coordinacion interna (queda COMPARTIDO)', descripcion: 'Un revisor de la propia organizacion; al aprobar el contenedor sigue COMPARTIDO con codigo S4.', iniciadores: [{ tipo: '*', valor: '' }],
      etapas: [{ nombre: 'Revision interna', pasos: [{ id: 'interna', nombre: 'Revision interna', tipo: 'uno', revisores: [{ tipo: 'rol', valor: 'revisor' }], dias: 3 }] }], alAprobar: { estado: 'COMPARTIDO', idoneidad: 'S4', copiarA: '', iniciadorPuedeCambiar: false } },
    paraleloDc: paraleloDc(o)
  };
}
/** Empresas del proyecto (contratista, Supervisión, Entidad) leídas de los flujos que ya tiene. */
function orgsDeFlujos(lista) {
  const o = {}, F = (id) => (lista || []).find(f => f.id === id), rev = (f, paso) => { if (!f) return ''; for (const e of f.etapas || []) for (const x of e.pasos || []) if (x.id === paso) { const r = (x.revisores || []).find(y => y.tipo === 'org' || (y.tipo === 'cargo' && y.org)); if (r) return r.tipo === 'org' ? r.valor : r.org; } return ''; };
  const ini = (f) => { const r = f && (f.iniciadores || []).find(y => y.tipo === 'org' || (y.tipo === 'cargo' && y.org)); return r ? (r.tipo === 'org' ? r.valor : r.org) : ''; };
  o.contr = ini(F('supervision-entidad')) || ini(F('paralelo-dc-especialistas-gp')) || ini(F('revision-especialistas-anin')) || '';
  o.super = rev(F('especialistas-paralelo'), 'esp-super') || rev(F('paralelo-dc-especialistas-gp'), 'dc-super') || rev(F('supervision-entidad'), 'super') || '';
  o.entidad = rev(F('especialistas-paralelo'), 'esp-entidad') || rev(F('paralelo-dc-especialistas-gp'), 'dc-anin') || '';
  for (const k of Object.keys(o)) if (!o[k]) delete o[k];
  return o;
}
/**
 * Lleva los flujos de un proyecto existente a los cuatro de la DEO (una sola vez: cfg.flujosVersion). Renombra el de especialistas en
 * paralelo (se queda con su estructura y sus revisores), quita los retirados (si tienen rondas abiertas se desactivan: las rondas siguen con
 * su copia del flujo) y añade los nuevos. Los desencadenadores de carpeta que usaban un flujo retirado pasan al flujo 1. Devuelve un resumen o null.
 */
function actualizaFlujos(cfg, enUso, orgsExtra) {
  if (!cfg || cfg.flujosVersion >= VERSION_FLUJOS) return null;
  const lista = Array.isArray(cfg.flujos) ? cfg.flujos.slice() : [], o = ordenOrgs(Object.assign({}, orgsExtra || {}, orgsDeFlujos(lista))), hecho = { renombrado: false, quitados: [], desactivados: [], anadidos: [], disparadores: [] };
  const usados = new Set(enUso || []);
  const i1 = lista.findIndex(f => f.id === 'especialistas-paralelo'), base = revisionAninSupervision(o);
  if (i1 >= 0) {
    const f = JSON.parse(JSON.stringify(lista[i1])); f.nombre = base.nombre; f.descripcion = base.descripcion; f.iniciadores = base.iniciadores;
    if (f.etapas[0] && !f.etapas[0].etiquetas) f.etapas[0].etiquetas = QA;
    const def = [[2], [10, 10], [3]]; if (f.etapas.length === 3 && f.etapas.every((e, k) => e.pasos.length === def[k].length && e.pasos.every((x, m) => x.dias === def[k][m]))) for (const x of f.etapas[1].pasos) x.dias = 9;   // días de serie → suman 14
    const n = normaliza(f); if (n.flujo) { n.flujo.creado = lista[i1].creado; lista[i1] = n.flujo; hecho.renombrado = true; }
  } else { lista.unshift(normaliza(base).flujo); hecho.anadidos.push(base.nombre); }
  for (const id of RETIRADOS) { const k = lista.findIndex(f => f.id === id); if (k < 0) continue; if (usados.has(id)) { lista[k] = Object.assign({}, lista[k], { activo: false }); hecho.desactivados.push(lista[k].nombre); } else { hecho.quitados.push(lista[k].nombre); lista.splice(k, 1); } }
  for (const fn of FLUJOS_DEO.slice(1)) { const t = fn(o); if (!lista.some(f => f.id === t.id)) { lista.push(normaliza(t).flujo); hecho.anadidos.push(t.nombre); } }
  // orden: los cuatro de la DEO primero, luego los que haya creado el gestor
  const ids = FLUJOS_DEO.map(fn => fn(o).id); lista.sort((a, b) => (ids.includes(a.id) ? ids.indexOf(a.id) : 99) - (ids.includes(b.id) ? ids.indexOf(b.id) : 99));
  for (const c of (cfg.carpetas || [])) if (c.disparador && RETIRADOS.includes(c.disparador.flujo)) { hecho.disparadores.push(c.ruta + ': ' + c.disparador.flujo + ' → especialistas-paralelo'); c.disparador = Object.assign({}, c.disparador, { flujo: 'especialistas-paralelo' }); }
  cfg.flujos = lista; cfg.flujosVersion = VERSION_FLUJOS;
  return hecho;
}
/** La etapa es la revisión de calidad (QA): por consenso de dos DC o con las etiquetas «QA Accepted / QA Rejected». */
const esQA = (etapa) => !!etapa && (etapa.modo === 'consenso' || /^QA\b/i.test(String((etapa.etiquetas || {}).devuelta || (etapa.etiquetas || {}).aprobada || '')));
const tieneQA = (flujo) => !!(flujo && (flujo.etapas || []).some(esQA));
/** Fecha (AAAA-MM-DD) en hora de Lima. */
function fechaLocal(iso) { const d = iso ? new Date(iso) : new Date(); if (isNaN(d)) return ''; return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
/** Fecha de respuesta: el día de emisión del flujo + DIAS_RESPUESTA días calendario (AAAA-MM-DD). */
function fechaRespuesta(iso, dias) { const f = fechaLocal(iso); if (!f) return ''; const [a, m, d] = f.split('-').map(Number), t = new Date(Date.UTC(a, m - 1, d + (dias || DIAS_RESPUESTA))); return t.toISOString().slice(0, 10); }

/**
 * FLUJO DE REVISION EN PARALELO (DEO, 10/11/2026): Iniciador → Paso 1 Document Control (DC ANIN ∥ DC Supervision: calidad, 2 dias,
 * por consenso, arbitra el Gerente de Proyecto) → Paso 2 especialistas (equipo del GP ∥ equipo de la Supervision: recomiendan; por
 * la Supervision decide su KP1) → Paso 3 el Gerente de Proyecto emite el estado con el que se responde al contratista.
 * Los revisores van por CARGO (Miembros → Cargo): DC, ESPECIALISTA, KP1, GP.
 */
function paraleloDc(orgs) {
  const o = Object.assign({ contr: 'CONTRATISTA', super: 'SUPERVISION', entidad: 'ANIN' }, orgs || {}), gp = [{ tipo: 'cargo', valor: 'GP', org: o.entidad }];
  return { id: 'paralelo-dc-especialistas-gp', nombre: 'Revisión en paralelo: Document Control, especialistas y Gerente de Proyecto',
    descripcion: 'Paso 1: los Document Control de ' + o.entidad + ' y de la Supervisión revisan la calidad a la vez (2 días; el rechazo por calidad necesita a los dos, o lo decide el Gerente de Proyecto). Paso 2: los especialistas del equipo del GP y de la Supervisión revisan en paralelo y recomiendan Aceptar o Rechazar; por la Supervisión decide su KP1. Paso 3: el Gerente de Proyecto emite el estado de revisión con el que se responde al contratista.',
    iniciadores: [{ tipo: 'org', valor: o.contr }, { tipo: 'rol', valor: 'gestor' }],
    etapas: [
      { nombre: 'Paso 1 · Document Control: revisión de calidad de documentos', modo: 'consenso', arbitro: gp, alVencer: 'avanzar', etiquetas: { aprobada: 'QA Accepted', devuelta: 'QA Rejected' },
        pasos: [{ id: 'dc-anin', nombre: 'DC ' + o.entidad, tipo: 'uno', revisores: [{ tipo: 'cargo', valor: 'DC', org: o.entidad }], dias: 2 }, { id: 'dc-super', nombre: 'DC Supervisión', tipo: 'uno', revisores: [{ tipo: 'cargo', valor: 'DC', org: o.super }], dias: 2 }] },
      { nombre: 'Paso 2 · Especialistas ' + o.entidad + ' y Supervisión: revisión técnica en paralelo', etiquetas: { aprobada: 'Aceptar', devuelta: 'Rechazar' },
        pasos: [{ id: 'esp-gp', nombre: 'Equipo de proyecto del GP', recomienda: true, revisores: [{ tipo: 'cargo', valor: 'ESPECIALISTA', org: o.entidad }], dias: 7 }, { id: 'esp-super', nombre: 'Equipo de Supervisión', recomienda: true, decide: [{ tipo: 'cargo', valor: 'KP1', org: o.super }], revisores: [{ tipo: 'cargo', valor: 'ESPECIALISTA', org: o.super }], dias: 7 }] },
      { nombre: 'Paso 3 · Gerente de Proyecto: emisión del estado de revisión', etiquetas: { aprobada: 'Aceptado', devuelta: 'Rechazado' },
        pasos: [{ id: 'gp', nombre: 'Gerente de Proyecto', tipo: 'uno', revisores: gp, dias: 3 }] }],
    estados: [{ id: 'aprobada', etiqueta: 'Aceptado' }, { id: 'aprobada-con-comentarios', etiqueta: 'Aceptado con comentarios' }, { id: 'devuelta', etiqueta: 'Rechazado' }],
    alAprobar: { estado: 'PUBLICADO', idoneidad: 'A1', copiarA: '', iniciadorPuedeCambiar: true } };
}

/** Convierte los flujos de la v0.2 (pasos lineales con quien/rol) al modelo nuevo. */
function migraV02(flujosViejos, estructura) {
  const out = [];
  for (const f of (flujosViejos || [])) {
    if (Array.isArray(f.etapas)) { const n = normaliza(f); if (n.flujo) out.push(n.flujo); continue; }
    const etapas = (f.pasos || []).map((p, i) => ({ nombre: p.nombre, pasos: [{ id: 'p' + (i + 1), nombre: p.nombre, tipo: 'uno', revisores: p.quien === '*' || !p.quien || p.quien === 'parte-origen' ? [{ tipo: 'rol', valor: p.rol || 'revisor' }] : [{ tipo: 'org', valor: orgDeParte(estructura, p.quien) || p.quien }], dias: 7, nota: p.nota }] }));
    const n = normaliza({ id: f.id, nombre: f.nombre, descripcion: f.descripcion || '', iniciadores: [{ tipo: '*', valor: '' }], etapas, alAprobar: { estado: f.alAprobar || 'PUBLICADO', idoneidad: f.idoneidad } });
    if (n.flujo) out.push(n.flujo);
  }
  return out;
}
function orgDeParte(est, codigo) { const p = est && Array.isArray(est.partes) ? est.partes.find(x => x.codigo === codigo) : null; return p && p.organizaciones && p.organizaciones[0]; }

module.exports = { paraleloDc, DIAS_RESPUESTA, VERSION_FLUJOS, RETIRADOS, revisionAninSupervision, revisionAnin, revisionSupervision, supervisionAGp, plantillasAnteriores, orgsDeFlujos, actualizaFlujos, esQA, tieneQA, fechaLocal, fechaRespuesta, CARGOS: ['DC', 'ESPECIALISTA', 'KP1', 'GP'], TIPOS_PASO, ETIQUETAS, ICONOS, ESTADOS_BASE, normalizaEstados, decisionDeEstado, normaliza, normalizaQuien, encaja, candidatos, describe, venceEtapa, estadoEtapa, pasosDecidibles, porDefecto, migraV02, slug };
