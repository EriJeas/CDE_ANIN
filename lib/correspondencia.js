/*
 * CORRESPONDENCIA DEL PROYECTO (lo que en Aconex es "Mail") y REGISTROS NEC (alertas tempranas y eventos compensables).
 *
 * Como en Aconex: cada correo tiene un TIPO definido por el proyecto (el administrador decide cuales existen y que
 * organizaciones pueden emitirlos), un numero correlativo por organizacion y tipo (GHEMET-RFI-000012), destinatarios
 * Para / CC, "respuesta requerida" con fecha limite que gobierna el estado (pendiente → vencido → respondido → cerrado),
 * hilo (responder / reenviar), adjuntos (versiones del CDE, incidencias, otros correos o archivos sueltos) y campos
 * propios del tipo. Lo enviado no se edita: queda como registro. Los borradores los ve la organizacion del autor.
 *
 * NEC4 ECC (lo que ACONEX suele configurar como tipos de correo y Unifier trae como modulo NEC):
 *   - Alerta temprana (cl. 15.1): la notifica quien se percata; va al Registro de Alertas Tempranas (15.2) y se trata en
 *     reunion (15.3). Se cierra cuando deja de ser un riesgo.
 *   - Evento compensable (cl. 60-66): se notifica (61.3: el Contratista dentro de las 8 semanas de percatarse; o el
 *     Gerente de Proyecto cuando instruye), el Gerente responde en 1 semana (61.4), se instruye cotizar, el Contratista
 *     cotiza en 3 semanas (62.3), el Gerente responde en 2 semanas (62.3), si no acepta evalua el (64) y el evento queda
 *     implementado (66). Cada paso deja un correo del tipo que corresponde y mueve el estado del registro.
 */
'use strict';
const path = require('path');
const { q, ahora, id, audita, abreJson } = require('./bd');

const RESPUESTAS = ['ninguna', 'informacion', 'respuesta', 'aprobacion', 'accion'];
const ESTADOS_AT = ['abierta', 'en-seguimiento', 'cerrada'];
const ESTADOS_EC = ['notificado', 'no-es-evento', 'cotizacion-instruida', 'cotizacion-presentada', 'cotizacion-aceptada', 'cotizacion-revisada', 'evaluado-por-gerente', 'implementado', 'retirado'];
const PLAZOS_NEC = { notificar_ec_semanas: 8, respuesta_notificacion_semanas: 1, cotizacion_semanas: 3, respuesta_cotizacion_semanas: 2 };

/** Tipos de correo con los que nace un proyecto (editables en Ajustes → Correspondencia). */
function tiposPorDefecto() {
  return [
    { id: 'carta', nombre: 'Carta', prefijo: 'CAR', respuesta: 'ninguna', dias: 0, emiten: ['*'], campos: [], auto: [] },
    { id: 'transmittal', nombre: 'Transmittal (envio de documentos)', prefijo: 'TRA', respuesta: 'informacion', dias: 0, emiten: ['*'], campos: [{ id: 'proposito', nombre: 'Proposito', valores: ['Para revision', 'Para aprobacion', 'Para informacion', 'Para construccion'] }], auto: [] },
    { id: 'rfi', nombre: 'Consulta tecnica (RFI)', prefijo: 'RFI', respuesta: 'respuesta', dias: 7, emiten: ['*'], campos: [{ id: 'disciplina', nombre: 'Disciplina' }, { id: 'referencia', nombre: 'Documento / plano de referencia' }], auto: [] },
    { id: 'instruccion', nombre: 'Instruccion del Gerente de Proyecto (NEC4 cl. 14.3)', prefijo: 'INS', respuesta: 'informacion', dias: 0, emiten: ['ANIN'], campos: [{ id: 'clausula', nombre: 'Clausula' }], auto: [] },
    { id: 'alerta-temprana', nombre: 'Alerta temprana (NEC4 cl. 15.1)', prefijo: 'AT', respuesta: 'accion', dias: 7, emiten: ['*'], campos: [{ id: 'asunto_riesgo', nombre: 'Asunto que podria afectar', valores: ['Precio total', 'Plazo de terminacion', 'Fecha clave', 'Desempeno de la obra en uso', 'Otro'] }, { id: 'reunion', nombre: 'Se solicita reunion de alerta temprana', valores: ['Si', 'No'] }], auto: [], registro: 'alerta-temprana' },
    { id: 'notificacion-ec', nombre: 'Notificacion de evento compensable (NEC4 cl. 61.3)', prefijo: 'NEC', respuesta: 'respuesta', dias: 7, emiten: ['*'], campos: [{ id: 'clausula', nombre: 'Clausula 60.1 (n)', valores: ['60.1(1) Instruccion que cambia el Alcance', '60.1(2) No se da acceso', '60.1(3) No se entrega algo que debia entregar el Cliente', '60.1(4) Instruccion de detener o no iniciar', '60.1(5) Trabajos de otros', '60.1(6) No se responde a tiempo', '60.1(7) Objetos de valor', '60.1(8) Cambio de decision', '60.1(9) Retencion de aceptacion', '60.1(10) Ensayo o inspeccion innecesaria', '60.1(11) Ensayo que causa demora', '60.1(12) Condiciones fisicas', '60.1(13) Clima', '60.1(14) Evento de riesgo del Cliente', '60.1(15) Toma de posesion anticipada', '60.1(16) No provision de materiales', '60.1(17) Correccion de una suposicion', '60.1(18) Incumplimiento del Cliente', '60.1(19) Evento que impide terminar', '60.1(20) Cotizacion para propuesta', '60.1(21) Otro de las Opciones'] }, { id: 'alerta_temprana', nombre: 'Alerta temprana relacionada (numero)' }], auto: [], registro: 'evento-compensable' },
    { id: 'respuesta-ec', nombre: 'Respuesta a la notificacion de evento compensable (cl. 61.4)', prefijo: 'REC', respuesta: 'informacion', dias: 0, emiten: ['ANIN'], campos: [{ id: 'decision', nombre: 'Decision', valores: ['Es un evento compensable: cotizar', 'No es un evento compensable', 'Se requiere mas informacion'] }], auto: [] },
    { id: 'cotizacion-ec', nombre: 'Cotizacion de evento compensable (cl. 62)', prefijo: 'COT', respuesta: 'respuesta', dias: 14, emiten: ['*'], campos: [{ id: 'monto', nombre: 'Cambio en los Precios (S/)' }, { id: 'dias', nombre: 'Cambio en el Plazo (dias)' }], auto: [] },
    { id: 'respuesta-cotizacion', nombre: 'Respuesta a la cotizacion (cl. 62.3)', prefijo: 'RCO', respuesta: 'informacion', dias: 0, emiten: ['ANIN'], campos: [{ id: 'decision', nombre: 'Decision', valores: ['Cotizacion aceptada', 'Se instruye cotizacion revisada', 'El Gerente evaluara el evento (cl. 64)'] }], auto: [] },
    { id: 'evaluacion-ec', nombre: 'Evaluacion del Gerente de Proyecto (cl. 64)', prefijo: 'EVA', respuesta: 'informacion', dias: 0, emiten: ['ANIN'], campos: [{ id: 'monto', nombre: 'Cambio en los Precios (S/)' }, { id: 'dias', nombre: 'Cambio en el Plazo (dias)' }], auto: [] },
    { id: 'acta', nombre: 'Acta de reunion', prefijo: 'ACT', respuesta: 'informacion', dias: 0, emiten: ['*'], campos: [{ id: 'fecha_reunion', nombre: 'Fecha de la reunion' }], auto: [] },
    { id: 'notificacion', nombre: 'Notificacion general', prefijo: 'NOT', respuesta: 'informacion', dias: 0, emiten: ['*'], campos: [], auto: [] }
  ];
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS correos (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero TEXT DEFAULT '', tipo TEXT NOT NULL, asunto TEXT NOT NULL, cuerpo TEXT DEFAULT '',
  de_email TEXT NOT NULL, de_org TEXT DEFAULT '', para TEXT DEFAULT '[]', cc TEXT DEFAULT '[]',
  respuesta TEXT DEFAULT 'ninguna', vence TEXT DEFAULT '', estado TEXT NOT NULL,          -- borrador | enviado
  hilo_id TEXT DEFAULT '', responde_a TEXT DEFAULT '', adjuntos TEXT DEFAULT '[]', campos TEXT DEFAULT '{}',
  respondido TEXT DEFAULT '', cerrado TEXT DEFAULT '', cerrado_por TEXT DEFAULT '', registro_tipo TEXT DEFAULT '', registro_id TEXT DEFAULT '',
  creado TEXT NOT NULL, enviado TEXT DEFAULT '', actualizado TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_correos ON correos (proyecto_id, estado, enviado);
CREATE TABLE IF NOT EXISTS correo_lecturas (correo_id TEXT NOT NULL, email TEXT NOT NULL, fecha TEXT NOT NULL, PRIMARY KEY (correo_id, email));
CREATE TABLE IF NOT EXISTS alertas_tempranas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, codigo TEXT NOT NULL, titulo TEXT NOT NULL, descripcion TEXT DEFAULT '',
  asunto_riesgo TEXT DEFAULT '', notificada_por TEXT NOT NULL, org TEXT DEFAULT '', fecha TEXT NOT NULL, correo_id TEXT DEFAULT '',
  acciones TEXT DEFAULT '', responsable TEXT DEFAULT '', fecha_reunion TEXT DEFAULT '', estado TEXT NOT NULL, cerrada TEXT DEFAULT '', evento_id TEXT DEFAULT '',
  historial TEXT DEFAULT '[]', UNIQUE (proyecto_id, numero));
CREATE TABLE IF NOT EXISTS eventos_compensables (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, numero INTEGER NOT NULL, codigo TEXT NOT NULL, titulo TEXT NOT NULL, descripcion TEXT DEFAULT '',
  clausula TEXT DEFAULT '', notificado_por TEXT NOT NULL, org TEXT DEFAULT '', fecha_notificacion TEXT NOT NULL, fecha_percatado TEXT DEFAULT '',
  correo_id TEXT DEFAULT '', alerta_id TEXT DEFAULT '', estado TEXT NOT NULL,
  plazo_respuesta TEXT DEFAULT '', plazo_cotizacion TEXT DEFAULT '', plazo_respuesta_cotizacion TEXT DEFAULT '',
  monto REAL DEFAULT 0, dias INTEGER DEFAULT 0, historial TEXT DEFAULT '[]', actualizado TEXT NOT NULL, UNIQUE (proyecto_id, numero));
`;

const sumaDias = (iso, dias) => { const t = new Date(iso || Date.now()); t.setUTCDate(t.getUTCDate() + dias); return t.toISOString().slice(0, 10); };
const hoyIso = () => new Date().toISOString().slice(0, 10);

function monta(app, ctx) {
  const { requiereSesion, requiereRol, almacen, express, db } = ctx;
  db.exec(ESQUEMA);
  try { db.exec('ALTER TABLE correos ADD COLUMN reenvio INTEGER DEFAULT 0'); } catch (e) { /* ya existe */ }
  const J = express.json({ limit: '2mb' });
  const proyecto = (pid) => abreJson(q.uno('SELECT * FROM proyectos WHERE id = ?', pid), ['config']);
  const miembro = (pid, email) => q.uno('SELECT rol, organizacion FROM miembros WHERE proyecto_id = ? AND email = ?', pid, String(email || '').toLowerCase());
  function yo(req, p) { const m = miembro(p.id, req.quien); const admin = !!req.admin; return { email: req.quien, rol: admin ? 'administrador' : (m ? m.rol : req.rol || 'lector'), organizacion: (m && m.organizacion) || (admin ? 'ANIN' : ''), admin }; }
  // «Retroalimentación» (el FB de Aconex): el tipo con el que cualquiera responde dentro de una linea de comunicacion. Existe siempre, aunque el proyecto haya editado sus tipos.
  const RETRO = { id: 'retroalimentacion', nombre: 'Retroalimentación', prefijo: 'FB', respuesta: 'ninguna', dias: 0, emiten: ['*'], campos: [], auto: [] };
  const tiposDe = (p) => { const L = (Array.isArray(p.config.tiposCorreo) && p.config.tiposCorreo.length ? p.config.tiposCorreo : tiposPorDefecto()); return L.some(t => t.id === RETRO.id) ? L : L.concat([RETRO]); };
  const tipoDe = (p, tid) => tiposDe(p).find(t => t.id === tid) || null;
  const abre = (c) => abreJson(c, ['para', 'cc', 'adjuntos', 'campos']);
  const esGestor = (u) => u.admin || u.rol === 'gestor' || u.rol === 'administrador';

  /** Estado de respuesta calculado (como las columnas de Aconex). */
  function estadoRespuesta(c) {
    if (c.estado !== 'enviado') return 'borrador';
    if (c.cerrado) return 'cerrado';
    if (c.respondido) return 'respondido';
    if (c.respuesta === 'ninguna' || !c.vence) return 'n/a';   // como en Aconex: sin fecha limite no hay seguimiento
    if (c.vence && c.vence < hoyIso()) return 'vencido';
    return 'pendiente';
  }
  /** Un destinatario es { email } o { org }. El correo "me llega" si estoy en Para/CC por correo o por organizacion. */
  const meLlega = (c, u) => [...c.para, ...c.cc].some(d => (d.email && d.email === u.email) || (d.org && d.org === u.organizacion));
  const puedeVer = (c, u) => esGestor(u) || c.de_email === u.email || (c.estado === 'borrador' ? c.de_org === u.organizacion : (c.de_org === u.organizacion || meLlega(c, u)));
  function normalizaDest(lista, pid) {
    const out = [];
    for (const d of (Array.isArray(lista) ? lista : [])) {
      if (typeof d === 'string') { if (/@/.test(d)) out.push({ email: d.trim().toLowerCase() }); else if (d.trim()) out.push({ org: d.trim().toUpperCase() }); continue; }
      if (d && d.email) { const e = String(d.email).trim().toLowerCase(); const m = miembro(pid, e); out.push({ email: e, org: (m && m.organizacion) || String(d.org || '').toUpperCase() }); }
      else if (d && d.org) out.push({ org: String(d.org).trim().toUpperCase() });
    }
    return out.filter((d, i, a) => a.findIndex(x => x.email === d.email && x.org === d.org) === i).slice(0, 100);
  }
  function siguienteNumero(pid, org, prefijo) {
    const pref = (org || 'SIN-ORG') + '-' + prefijo + '-';
    const ult = q.uno("SELECT numero FROM correos WHERE proyecto_id = ? AND numero LIKE ? ORDER BY numero DESC LIMIT 1", pid, pref + '%');
    const n = ult ? parseInt(ult.numero.slice(pref.length), 10) + 1 : 1;
    return pref + String(n).padStart(6, '0');
  }
  function completa(c, u) {
    c.estadoRespuesta = estadoRespuesta(c);
    c.leido = u ? !!q.uno('SELECT 1 FROM correo_lecturas WHERE correo_id = ? AND email = ?', c.id, u.email) : false;
    c.respuestas = q.uno("SELECT COUNT(*) AS n FROM correos WHERE responde_a = ? AND estado = 'enviado'", c.id).n;
    return c;
  }

  /**
   * LINEA DE COMUNICACION (el panel izquierdo de «Ver correo» en Aconex): todos los correos enviados de un hilo, como arbol
   * (cada uno cuelga del correo al que responde o reenvia), en orden de envio. Todos comparten el NUMERO DE REFERENCIA: el numero
   * del correo que abrio la linea. Solo salen los que el usuario puede ver; si uno intermedio no es visible, sus respuestas cuelgan
   * del antecesor visible mas cercano.
   */
  function hiloDe(p, hid, u) {
    const filas = q.todos("SELECT * FROM correos WHERE proyecto_id = ? AND hilo_id = ? AND estado = 'enviado' ORDER BY enviado, creado", p.id, hid).map(abre);
    const todos = new Map(filas.map(c => [c.id, c])), vis = new Map(filas.filter(c => puedeVer(c, u)).map(c => [c.id, c]));
    const padreVisible = (c) => { let x = c.responde_a, n = 0; while (x && n++ < 500) { if (vis.has(x)) return x; const o = todos.get(x); x = o ? o.responde_a : ''; } return ''; };
    const hijos = new Map(), raices = [];
    for (const c of vis.values()) { const pv = padreVisible(c); c._padre = pv; if (pv) { if (!hijos.has(pv)) hijos.set(pv, []); hijos.get(pv).push(c); } else raices.push(c); }
    const out = [], nombres = Object.fromEntries(tiposDe(p).map(t => [t.id, t.nombre]));
    const anda = (c, nivel) => { out.push({ id: c.id, numero: c.numero, tipo: c.tipo, tipoNombre: nombres[c.tipo] || c.tipo, asunto: c.asunto, de_email: c.de_email, de_org: c.de_org, enviado: c.enviado, responde_a: c._padre, nivel, nPara: c.para.length, nCc: c.cc.length, nAdj: c.adjuntos.length, estadoRespuesta: estadoRespuesta(c), respuesta: c.respuesta, vence: c.vence, respondido: c.respondido, cerrado: c.cerrado, reenvio: !!c.reenvio, registro_tipo: c.registro_tipo || '' }); for (const h of hijos.get(c.id) || []) anda(h, nivel + 1); };
    raices.forEach(r => anda(r, 0));
    return out;
  }
  const numeroDe = (mid) => (q.uno('SELECT numero FROM correos WHERE id = ?', mid) || {}).numero || '';
  /** Responde dentro de una linea de comunicacion desde un registro NEC (alerta temprana / evento compensable): el correo cuelga del ultimo
   *  de ese registro en la linea, lleva el mismo numero de referencia y deja respondido al que contesta. Devuelve { id, numero }. */
  function respondeEnLinea(p, u, o) {
    const origen = o.correoOrigen ? abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', o.correoOrigen, p.id)) : null;
    const hid = origen ? (origen.hilo_id || origen.id) : '';
    // el ultimo correo del registro en la linea (si no, el de origen)
    const ultimo = hid ? abre(q.uno("SELECT * FROM correos WHERE proyecto_id = ? AND hilo_id = ? AND estado = 'enviado' AND ((registro_tipo = ? AND registro_id = ?) OR id = ?) ORDER BY enviado DESC, creado DESC LIMIT 1", p.id, hid, o.registroTipo, o.registroId, origen.id)) || origen : null;
    const t = o.tipo, mid = id('m'), fecha = ahora(), numero = siguienteNumero(p.id, u.organizacion, t.prefijo);
    // destinatarios: quien escribio lo que se contesta + los Para de la linea, menos quien responde; CC: los CC del correo que abrio la linea
    let para = o.para, cc = [];
    if (ultimo) {
      const mio = (d) => (d.email && d.email === u.email) || (!d.email && d.org && d.org === u.organizacion);
      const cand = [{ email: ultimo.de_email, org: ultimo.de_org }].concat(ultimo.para, origen.para, [{ email: origen.de_email, org: origen.de_org }]).filter(d => !mio(d));
      const unicos = cand.filter((d, i, a) => a.findIndex(x => (x.email || '') === (d.email || '') && (x.email ? true : x.org === d.org)) === i);
      if (!para || !para.length) para = unicos.length ? unicos : ultimo.para;
      cc = origen.cc.filter(d => !mio(d) && !para.some(x => (x.email || '') === (d.email || '') && x.org === d.org));
    }
    const asunto = ultimo ? (/^re:/i.test(o.asunto) ? o.asunto : 'Re: ' + o.asunto) : o.asunto;
    q.corre('INSERT INTO correos (id, proyecto_id, numero, tipo, asunto, cuerpo, de_email, de_org, para, cc, respuesta, vence, estado, hilo_id, responde_a, adjuntos, campos, registro_tipo, registro_id, creado, enviado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      mid, p.id, numero, t.id, String(asunto).slice(0, 300), String(o.cuerpo || '').slice(0, 50000), u.email, u.organizacion, JSON.stringify(para || []), JSON.stringify(cc), t.respuesta, (t.respuesta !== 'ninguna' && t.dias) ? sumaDias(fecha, t.dias) : '', 'enviado', hid || mid, ultimo ? ultimo.id : '', '[]', JSON.stringify(o.campos || {}), o.registroTipo, o.registroId, fecha, fecha, fecha);
    if (ultimo && !ultimo.respondido) q.corre('UPDATE correos SET respondido = ?, actualizado = ? WHERE id = ?', fecha, fecha, ultimo.id);
    return { id: mid, numero };
  }

  // Lo usa lib/cde.js para llevar cada revision por su linea de correspondencia (envio, QA, rondas y estado final)
  module.exports.interno = { respondeEnLinea, tipoDe, normalizaDest };

  // ---------- tipos ----------
  app.get('/api/proyectos/:pid/correspondencia/tipos', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    res.json({ tipos: tiposDe(p).map(t => Object.assign({}, t, { puedoEmitir: esGestor(u) || !t.emiten || !t.emiten.length || t.emiten.includes('*') || t.emiten.includes(u.organizacion) })), respuestas: RESPUESTAS, organizaciones: organizaciones(req.pid), miembros: q.todos('SELECT email, rol, organizacion FROM miembros WHERE proyecto_id = ? ORDER BY organizacion, email', req.pid) });
  });
  app.put('/api/proyectos/:pid/correspondencia/tipos', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), lista = Array.isArray(req.body && req.body.tipos) ? req.body.tipos : null;
    if (!lista) return res.status(400).json({ error: 'datos' });
    const out = [];
    for (const t of lista) {
      const nombre = String(t.nombre || '').trim().slice(0, 120), prefijo = String(t.prefijo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (!nombre || !prefijo) return res.status(400).json({ error: 'datos', mensaje: 'Cada tipo necesita nombre y prefijo (letras/numeros).' });
      const tid = String(t.id || '').trim() || nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (out.some(x => x.id === tid || x.prefijo === prefijo)) return res.status(400).json({ error: 'datos', mensaje: 'Id o prefijo repetido: ' + tid + ' / ' + prefijo });
      out.push({ id: tid, nombre, prefijo, respuesta: RESPUESTAS.includes(t.respuesta) ? t.respuesta : 'ninguna', dias: Math.max(0, parseInt(t.dias, 10) || 0), emiten: Array.isArray(t.emiten) && t.emiten.length ? t.emiten.map(x => String(x).trim().toUpperCase() === '*' ? '*' : String(x).trim().toUpperCase()).filter(Boolean) : ['*'],
        campos: (Array.isArray(t.campos) ? t.campos : []).map(c => ({ id: String(c.id || c.nombre || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40), nombre: String(c.nombre || c.id || '').slice(0, 80), valores: Array.isArray(c.valores) && c.valores.length ? c.valores.map(String) : undefined, obligatorio: !!c.obligatorio })).filter(c => c.id),
        auto: normalizaDest(t.auto, req.pid), registro: ['alerta-temprana', 'evento-compensable'].includes(t.registro) ? t.registro : '' });
    }
    p.config.tiposCorreo = out; q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(p.config), req.pid);
    audita(req.quien, 'correspondencia.tipos', req.pid, '', { n: out.length }); res.json({ ok: true, tipos: out });
  });
  function organizaciones(pid) { const s = new Set(q.todos("SELECT DISTINCT organizacion FROM miembros WHERE proyecto_id = ? AND organizacion <> ''", pid).map(r => r.organizacion)); s.add('ANIN'); return [...s].sort(); }

  // ---------- bandeja ----------
  app.get('/api/proyectos/:pid/correspondencia', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), f = req.query || {};
    const bandeja = String(f.bandeja || 'recibidos');
    let lista = q.todos('SELECT * FROM correos WHERE proyecto_id = ? ORDER BY COALESCE(NULLIF(enviado, \'\'), creado) DESC LIMIT 5000', req.pid).map(abre).filter(c => puedeVer(c, u));
    if (bandeja === 'recibidos') lista = lista.filter(c => c.estado === 'enviado' && meLlega(c, u) && c.de_email !== u.email);
    else if (bandeja === 'enviados') lista = lista.filter(c => c.estado === 'enviado' && (c.de_email === u.email || c.de_org === u.organizacion));
    else if (bandeja === 'borradores') lista = lista.filter(c => c.estado === 'borrador');
    else lista = lista.filter(c => c.estado === 'enviado');
    if (f.tipo) lista = lista.filter(c => c.tipo === f.tipo);
    // numero de referencia = numero del correo que abrio la linea de comunicacion (lo comparten todas sus respuestas); buscarlo trae la linea entera
    const numDe = new Map(q.todos('SELECT id, numero FROM correos WHERE proyecto_id = ?', req.pid).map(x => [x.id, x.numero])), enHilo = new Map();
    for (const x of q.todos("SELECT hilo_id, COUNT(*) AS n FROM correos WHERE proyecto_id = ? AND estado = 'enviado' GROUP BY hilo_id", req.pid)) enHilo.set(x.hilo_id, x.n);
    for (const c of lista) { c.referencia = numDe.get(c.hilo_id || c.id) || c.numero; c.enLinea = enHilo.get(c.hilo_id || c.id) || 1; }
    if (f.q) { const s = String(f.q).toLowerCase(); lista = lista.filter(c => (c.asunto + ' ' + c.numero + ' ' + c.referencia + ' ' + c.cuerpo).toLowerCase().includes(s)); }
    if (f.hilo) lista = lista.filter(c => (c.hilo_id || c.id) === String(f.hilo));
    for (const c of lista) { completa(c, u); delete c.cuerpo; }
    if (f.estadoRespuesta) lista = lista.filter(c => c.estadoRespuesta === f.estadoRespuesta);
    const todos = q.todos('SELECT * FROM correos WHERE proyecto_id = ? AND estado = \'enviado\'', req.pid).map(abre).filter(c => puedeVer(c, u));
    const conteo = { recibidos: 0, sinLeer: 0, pendientesMios: 0, vencidosMios: 0, enviados: 0, borradores: q.todos("SELECT * FROM correos WHERE proyecto_id = ? AND estado = 'borrador'", req.pid).map(abre).filter(c => puedeVer(c, u)).length };
    for (const c of todos) { const er = estadoRespuesta(c); if (meLlega(c, u) && c.de_email !== u.email) { conteo.recibidos++; if (!q.uno('SELECT 1 FROM correo_lecturas WHERE correo_id = ? AND email = ?', c.id, u.email)) conteo.sinLeer++; if (c.para.some(d => (d.email && d.email === u.email) || (d.org && d.org === u.organizacion))) { if (er === 'pendiente') conteo.pendientesMios++; if (er === 'vencido') conteo.vencidosMios++; } } if (c.de_email === u.email || c.de_org === u.organizacion) conteo.enviados++; }
    res.json({ correos: lista.slice(0, 1000), conteo, yo: { email: u.email, organizacion: u.organizacion } });
  });

  app.get('/api/proyectos/:pid/correspondencia/:mid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!puedeVer(c, u)) return res.status(403).json({ error: 'sin-permiso' });
    if (c.estado === 'enviado' && c.de_email !== u.email) q.corre('INSERT OR IGNORE INTO correo_lecturas (correo_id, email, fecha) VALUES (?,?,?)', c.id, u.email, ahora());
    completa(c, u);
    c.hilo = hiloDe(p, c.hilo_id || c.id, u);
    c.referencia = numeroDe(c.hilo_id || c.id) || c.numero;
    if (c.responde_a) { const o = q.uno('SELECT numero, asunto FROM correos WHERE id = ?', c.responde_a); if (o) c.respondeA = { id: c.responde_a, numero: o.numero, asunto: o.asunto }; }
    if (c.registro_id) { const rg = c.registro_tipo === 'alerta-temprana' ? q.uno('SELECT codigo, estado FROM alertas_tempranas WHERE id = ?', c.registro_id) : q.uno('SELECT codigo, estado FROM eventos_compensables WHERE id = ?', c.registro_id); if (rg) c.registro = { tipo: c.registro_tipo, codigo: rg.codigo, estado: rg.estado }; }
    c.lecturas = q.todos('SELECT email, fecha FROM correo_lecturas WHERE correo_id = ? ORDER BY fecha', c.id);
    c.tipoDef = tipoDe(p, c.tipo);
    for (const a of c.adjuntos) { if (a.tipo === 'version') { const v = q.uno('SELECT v.n, v.revision, v.archivo, c.nombre, c.id AS cid FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ?', a.id); if (v) Object.assign(a, { nombre: v.archivo, contenedor: v.nombre, cid: v.cid, revision: v.revision }); } if (a.tipo === 'incidencia') { const i = q.uno('SELECT codigo, titulo FROM incidencias WHERE id = ?', a.id); if (i) Object.assign(a, { nombre: i.codigo + ' ' + i.titulo }); } if (a.tipo === 'correo') { const x = q.uno('SELECT numero, asunto FROM correos WHERE id = ?', a.id); if (x) Object.assign(a, { nombre: x.numero + ' ' + x.asunto }); } }
    c.puedoResponder = c.estado === 'enviado';   // como en Aconex: quien ve un correo puede responderlo o reenviarlo dentro de su linea (tambien el que lo envio, para dar seguimiento)
    c.puedoCerrar = c.estado === 'enviado' && !c.cerrado && (c.de_email === u.email || esGestor(u));
    c.puedoEditar = c.estado === 'borrador' && (c.de_email === u.email || c.de_org === u.organizacion || esGestor(u));
    res.json(c);
  });

  /** Crear (borrador o enviar directo) o responder. body: { tipo, asunto, cuerpo, para, cc, respuesta, vence, campos, adjuntos, responde_a, enviar } */
  app.post('/api/proyectos/:pid/correspondencia', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const t = tipoDe(p, String(b.tipo || '')); if (!t) return res.status(400).json({ error: 'tipo', mensaje: 'Tipo de correo no valido.' });
    if (!(esGestor(u) || t.emiten.includes('*') || t.emiten.includes(u.organizacion))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Tu organizacion no emite correos de tipo "' + t.nombre + '".' });
    const asunto = String(b.asunto || '').trim().slice(0, 300); if (!asunto) return res.status(400).json({ error: 'datos', mensaje: 'Falta el asunto.' });
    let hilo = '', responde_a = String(b.responde_a || '');
    if (responde_a) { const o = q.uno('SELECT id, hilo_id FROM correos WHERE id = ? AND proyecto_id = ?', responde_a, req.pid); if (!o) return res.status(404).json({ error: 'no-existe', mensaje: 'No existe el correo al que respondes.' }); hilo = o.hilo_id || o.id; }
    const mid = id('m'), fecha = ahora();
    const para = normalizaDest(b.para, req.pid), cc = normalizaDest(b.cc, req.pid);
    for (const d of (t.auto || [])) if (!para.some(x => x.email === d.email && x.org === d.org) && !cc.some(x => x.email === d.email && x.org === d.org)) cc.push(d);  // distribucion automatica del tipo (Aconex: no se puede quitar)
    const respuesta = RESPUESTAS.includes(b.respuesta) ? b.respuesta : t.respuesta;
    let vence = String(b.vence || '').slice(0, 10); if (!vence && respuesta !== 'ninguna' && t.dias) vence = sumaDias(fecha, t.dias);
    const campos = {}; for (const cdef of (t.campos || [])) { const v = b.campos && b.campos[cdef.id]; if (v !== undefined && v !== null && v !== '') campos[cdef.id] = String(v).slice(0, 2000); }
    const adjuntos = (Array.isArray(b.adjuntos) ? b.adjuntos : []).filter(a => a && ['version', 'incidencia', 'correo'].includes(a.tipo) && a.id).map(a => ({ tipo: a.tipo, id: String(a.id) })).slice(0, 50);
    q.corre('INSERT INTO correos (id, proyecto_id, numero, tipo, asunto, cuerpo, de_email, de_org, para, cc, respuesta, vence, estado, hilo_id, responde_a, adjuntos, campos, creado, actualizado, reenvio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      mid, req.pid, '', t.id, asunto, String(b.cuerpo || '').slice(0, 50000), u.email, u.organizacion, JSON.stringify(para), JSON.stringify(cc), respuesta, vence, 'borrador', hilo || mid, responde_a, JSON.stringify(adjuntos), JSON.stringify(campos), fecha, fecha, responde_a && b.reenvio ? 1 : 0);
    audita(req.quien, 'correo.crear', req.pid, asunto, { tipo: t.id, borrador: !b.enviar });
    if (b.enviar) return envia(req, res, p, u, mid);
    res.json({ ok: true, id: mid, estado: 'borrador' });
  });
  app.put('/api/proyectos/:pid/correspondencia/:mid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (c.estado !== 'borrador') return res.status(409).json({ error: 'enviado', mensaje: 'Lo enviado no se edita: responde o reenvia.' });
    if (!(c.de_email === u.email || c.de_org === u.organizacion || esGestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    const t = tipoDe(p, String(b.tipo || c.tipo)) || tipoDe(p, c.tipo);
    const campos = {}; for (const cdef of (t.campos || [])) { const v = b.campos && b.campos[cdef.id]; if (v !== undefined && v !== null && v !== '') campos[cdef.id] = String(v).slice(0, 2000); }
    const adjuntos = Array.isArray(b.adjuntos) ? b.adjuntos.filter(a => a && ['version', 'incidencia', 'correo', 'archivo'].includes(a.tipo) && a.id).slice(0, 50) : c.adjuntos;
    q.corre('UPDATE correos SET tipo = ?, asunto = ?, cuerpo = ?, para = ?, cc = ?, respuesta = ?, vence = ?, campos = ?, adjuntos = ?, actualizado = ? WHERE id = ?',
      t.id, String(b.asunto !== undefined ? b.asunto : c.asunto).trim().slice(0, 300), String(b.cuerpo !== undefined ? b.cuerpo : c.cuerpo).slice(0, 50000), JSON.stringify(b.para !== undefined ? normalizaDest(b.para, req.pid) : c.para), JSON.stringify(b.cc !== undefined ? normalizaDest(b.cc, req.pid) : c.cc), RESPUESTAS.includes(b.respuesta) ? b.respuesta : c.respuesta, String(b.vence !== undefined ? b.vence : c.vence).slice(0, 10), JSON.stringify(b.campos !== undefined ? campos : c.campos), JSON.stringify(adjuntos), ahora(), c.id);
    if (b.enviar) return envia(req, res, p, u, c.id);
    res.json({ ok: true });
  });
  /** Adjuntar un archivo suelto a un borrador: cuerpo = archivo, x-nombre. */
  app.post('/api/proyectos/:pid/correspondencia/:mid/adjuntar', requiereSesion, requiereRol('autor'), async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c) { req.resume(); return res.status(404).json({ error: 'no-existe' }); }
    if (c.estado !== 'borrador' || !(c.de_email === u.email || c.de_org === u.organizacion || esGestor(u))) { req.resume(); return res.status(409).json({ error: 'enviado', mensaje: 'Solo se adjunta a un borrador propio.' }); }
    let nombre = ''; try { nombre = decodeURIComponent(String(req.get('x-nombre') || '')); } catch (e) {} nombre = path.basename(nombre.replace(/\\/g, '/')) || 'adjunto';
    try {
      const aid = id('a'), g = await almacen.guarda(req.pid, 'correos', c.id + '-' + aid, nombre, req);
      c.adjuntos.push({ tipo: 'archivo', id: aid, nombre, tamano: g.tamano, ruta: g.ruta, sha256: g.sha256 });
      q.corre('UPDATE correos SET adjuntos = ?, actualizado = ? WHERE id = ?', JSON.stringify(c.adjuntos), ahora(), c.id);
      res.json({ ok: true, adjunto: { tipo: 'archivo', id: aid, nombre, tamano: g.tamano } });
    } catch (e) { res.status(500).json({ error: 'almacen', mensaje: e.message }); }
  });
  app.get('/api/proyectos/:pid/correspondencia/:mid/adjunto/:aid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c || !puedeVer(c, u)) return res.status(404).json({ error: 'no-existe' });
    const a = c.adjuntos.find(x => x.tipo === 'archivo' && x.id === req.params.aid); if (!a || !almacen.existe(a.ruta)) return res.status(404).json({ error: 'no-existe' });
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(a.nombre)); almacen.flujo(a.ruta).pipe(res);
  });
  app.post('/api/proyectos/:pid/correspondencia/:mid/enviar', requiereSesion, requiereRol('autor'), J, (req, res) => { const p = proyecto(req.pid), u = yo(req, p); envia(req, res, p, u, req.params.mid); });
  function envia(req, res, p, u, mid) {
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', mid, p.id)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (c.estado !== 'borrador') return res.status(409).json({ error: 'enviado', mensaje: 'Ya estaba enviado.' });
    if (!(c.de_email === u.email || c.de_org === u.organizacion || esGestor(u))) return res.status(403).json({ error: 'sin-permiso' });
    const t = tipoDe(p, c.tipo) || { campos: [], prefijo: 'COR' };
    if (!c.para.length) return res.status(400).json({ error: 'datos', mensaje: 'Indica al menos un destinatario en Para.' });
    for (const cdef of (t.campos || [])) if (cdef.obligatorio && !c.campos[cdef.id]) return res.status(400).json({ error: 'datos', mensaje: 'Falta el campo obligatorio "' + cdef.nombre + '".' });
    const numero = siguienteNumero(p.id, c.de_org, t.prefijo), fecha = ahora();
    q.corre("UPDATE correos SET estado = 'enviado', numero = ?, enviado = ?, de_email = ?, actualizado = ? WHERE id = ?", numero, fecha, c.de_email, fecha, c.id);
    if (c.responde_a && !c.reenvio) { const o = q.uno('SELECT id, respondido FROM correos WHERE id = ?', c.responde_a); if (o && !o.respondido) q.corre('UPDATE correos SET respondido = ?, actualizado = ? WHERE id = ?', fecha, fecha, o.id); }   // reenviar no cuenta como respuesta
    // registros NEC: el tipo puede abrir una alerta temprana o un evento compensable
    let registro = null;
    if (t.registro === 'alerta-temprana') registro = creaAlerta(p, u, c, fecha);
    if (t.registro === 'evento-compensable') registro = creaEvento(p, u, c, fecha);
    if (registro) q.corre('UPDATE correos SET registro_tipo = ?, registro_id = ? WHERE id = ?', t.registro, registro.id, c.id);
    audita(u.email, 'correo.enviar', p.id, numero, { tipo: c.tipo, para: c.para, registro: registro && registro.codigo });
    res.json({ ok: true, id: c.id, numero, registro });
  }
  app.post('/api/proyectos/:pid/correspondencia/:mid/cerrar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (c.estado !== 'enviado' || c.cerrado) return res.status(409).json({ error: 'estado' });
    if (!(c.de_email === u.email || esGestor(u))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Cierra el correo quien lo emitio o el gestor.' });
    q.corre('UPDATE correos SET cerrado = ?, cerrado_por = ?, actualizado = ? WHERE id = ?', ahora(), u.email, ahora(), c.id);
    audita(u.email, 'correo.cerrar', req.pid, c.numero, { comentario: (req.body || {}).comentario }); res.json({ ok: true });
  });
  app.delete('/api/proyectos/:pid/correspondencia/:mid', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abre(q.uno('SELECT * FROM correos WHERE id = ? AND proyecto_id = ?', req.params.mid, req.pid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (c.estado !== 'borrador' || !(c.de_email === u.email || c.de_org === u.organizacion || esGestor(u))) return res.status(409).json({ error: 'estado', mensaje: 'Solo se borran borradores propios.' });
    q.corre('DELETE FROM correos WHERE id = ?', c.id); res.json({ ok: true });
  });

  // ---------- registro de alertas tempranas (NEC4 cl. 15) ----------
  function creaAlerta(p, u, c, fecha) {
    const numero = (q.uno('SELECT MAX(numero) AS m FROM alertas_tempranas WHERE proyecto_id = ?', p.id).m || 0) + 1, aid = id('at');
    const codigo = 'AT-' + String(numero).padStart(3, '0');
    q.corre('INSERT INTO alertas_tempranas (id, proyecto_id, numero, codigo, titulo, descripcion, asunto_riesgo, notificada_por, org, fecha, correo_id, estado, historial) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      aid, p.id, numero, codigo, c.asunto, c.cuerpo.slice(0, 4000), c.campos.asunto_riesgo || '', u.email, u.organizacion, fecha, c.id, 'abierta', JSON.stringify([{ fecha, por: u.email, accion: 'notificada', correo: c.numero || '' }]));
    return { id: aid, codigo, tipo: 'alerta-temprana' };
  }
  app.get('/api/proyectos/:pid/alertas-tempranas', requiereSesion, requiereRol('lector'), (req, res) => {
    const lista = q.todos('SELECT * FROM alertas_tempranas WHERE proyecto_id = ? ORDER BY numero DESC', req.pid).map(a => abreJson(a, ['historial']));
    for (const a of lista) { const c = a.correo_id ? q.uno('SELECT numero FROM correos WHERE id = ?', a.correo_id) : null; a.correo_numero = c ? c.numero : ''; a.dias_abierta = Math.floor((Date.now() - Date.parse(a.fecha)) / 86400000); }
    res.json({ alertas: lista, estados: ESTADOS_AT });
  });
  app.post('/api/proyectos/:pid/alertas-tempranas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    // alta directa en el registro (sin correo): para cargar las que ya existen o las que surgen en una reunion
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, fecha = ahora();
    const titulo = String(b.titulo || '').trim().slice(0, 300); if (!titulo) return res.status(400).json({ error: 'datos', mensaje: 'Falta el titulo.' });
    const numero = (q.uno('SELECT MAX(numero) AS m FROM alertas_tempranas WHERE proyecto_id = ?', req.pid).m || 0) + 1, aid = id('at'), codigo = 'AT-' + String(numero).padStart(3, '0');
    q.corre('INSERT INTO alertas_tempranas (id, proyecto_id, numero, codigo, titulo, descripcion, asunto_riesgo, notificada_por, org, fecha, correo_id, acciones, responsable, fecha_reunion, estado, historial) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      aid, req.pid, numero, codigo, titulo, String(b.descripcion || '').slice(0, 4000), String(b.asunto_riesgo || '').slice(0, 80), u.email, u.organizacion, String(b.fecha || fecha), '', String(b.acciones || '').slice(0, 4000), String(b.responsable || '').slice(0, 120), String(b.fecha_reunion || '').slice(0, 10), 'abierta', JSON.stringify([{ fecha, por: u.email, accion: 'registrada' }]));
    audita(u.email, 'alerta.crear', req.pid, codigo, { titulo }); res.json({ ok: true, id: aid, codigo });
  });
  app.post('/api/proyectos/:pid/alertas-tempranas/:aid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const a = abreJson(q.uno('SELECT * FROM alertas_tempranas WHERE id = ? AND proyecto_id = ?', req.params.aid, req.pid), ['historial']); if (!a) return res.status(404).json({ error: 'no-existe' });
    const cambios = {}; for (const k of ['acciones', 'responsable', 'fecha_reunion', 'evento_id', 'titulo', 'descripcion', 'asunto_riesgo']) if (b[k] !== undefined) cambios[k] = String(b[k]).slice(0, 4000);
    if (b.estado !== undefined) { if (!ESTADOS_AT.includes(b.estado)) return res.status(400).json({ error: 'estado' }); if (b.estado === 'cerrada' && !esGestor(u) && a.notificada_por !== u.email) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Cierra la alerta el gestor o quien la notifico.' }); cambios.estado = b.estado; if (b.estado === 'cerrada') cambios.cerrada = ahora(); }
    if (!Object.keys(cambios).length && !b.nota) return res.status(400).json({ error: 'datos' });
    a.historial.push({ fecha: ahora(), por: u.email, accion: cambios.estado ? 'estado: ' + cambios.estado : 'actualizacion', nota: String(b.nota || '').slice(0, 2000), cambios: Object.keys(cambios) });
    cambios.historial = JSON.stringify(a.historial);
    q.corre('UPDATE alertas_tempranas SET ' + Object.keys(cambios).map(k => k + ' = ?').join(', ') + ' WHERE id = ?', ...Object.values(cambios), a.id);
    // Como en Aconex: lo que se acuerda o decide sobre la alerta queda como «Retroalimentación» en la linea de comunicacion del correo que la notifico
    let correoNumero = '';
    if (a.correo_id && b.correo !== false && (b.nota || cambios.estado || cambios.acciones !== undefined || cambios.fecha_reunion !== undefined)) {
      const lineas = []; if (cambios.estado) lineas.push('Estado de la alerta: ' + cambios.estado + '.'); if (b.nota) lineas.push(String(b.nota).slice(0, 2000)); if (cambios.acciones !== undefined && cambios.acciones !== a.acciones) lineas.push('Acciones acordadas: ' + cambios.acciones); if (cambios.responsable !== undefined && cambios.responsable !== a.responsable) lineas.push('Responsable: ' + cambios.responsable); if (cambios.fecha_reunion !== undefined && cambios.fecha_reunion !== a.fecha_reunion) lineas.push('Reunion de alerta temprana: ' + cambios.fecha_reunion);
      if (lineas.length) { try { correoNumero = respondeEnLinea(p, u, { correoOrigen: a.correo_id, registroTipo: 'alerta-temprana', registroId: a.id, tipo: tipoDe(p, 'retroalimentacion'), asunto: a.codigo + ' · ' + a.titulo, cuerpo: lineas.join('\n') }).numero; const h = abreJson(q.uno('SELECT historial FROM alertas_tempranas WHERE id = ?', a.id), ['historial']).historial; h[h.length - 1].correo = correoNumero; q.corre('UPDATE alertas_tempranas SET historial = ? WHERE id = ?', JSON.stringify(h), a.id); } catch (err) { console.warn('[alerta → linea]', err.message); } }
    }
    audita(u.email, 'alerta.actualizar', req.pid, a.codigo, { cambios: Object.keys(cambios), correo: correoNumero }); res.json({ ok: true, correo: correoNumero });
  });

  // ---------- registro de eventos compensables (NEC4 cl. 60-66) ----------
  function creaEvento(p, u, c, fecha) {
    const numero = (q.uno('SELECT MAX(numero) AS m FROM eventos_compensables WHERE proyecto_id = ?', p.id).m || 0) + 1, eid = id('ec');
    const codigo = 'EC-' + String(numero).padStart(3, '0');
    const alerta = c.campos.alerta_temprana ? q.uno('SELECT id FROM alertas_tempranas WHERE proyecto_id = ? AND (codigo = ? OR id = ?)', p.id, String(c.campos.alerta_temprana).toUpperCase(), c.campos.alerta_temprana) : null;
    q.corre('INSERT INTO eventos_compensables (id, proyecto_id, numero, codigo, titulo, descripcion, clausula, notificado_por, org, fecha_notificacion, correo_id, alerta_id, estado, plazo_respuesta, historial, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      eid, p.id, numero, codigo, c.asunto, c.cuerpo.slice(0, 4000), c.campos.clausula || '', u.email, u.organizacion, fecha, c.id, alerta ? alerta.id : '', 'notificado', sumaDias(fecha, 7 * PLAZOS_NEC.respuesta_notificacion_semanas), JSON.stringify([{ fecha, por: u.email, accion: 'notificado', correo: c.numero || '', estado: 'notificado' }]), fecha);
    if (alerta) q.corre('UPDATE alertas_tempranas SET evento_id = ? WHERE id = ?', eid, alerta.id);
    return { id: eid, codigo, tipo: 'evento-compensable' };
  }
  /** Transiciones del evento: accion → estado nuevo, tipo de correo que lo documenta y plazo que arranca. */
  const PASOS_EC = {
    'aceptar': { de: ['notificado'], a: 'cotizacion-instruida', correo: 'respuesta-ec', plazo: 'plazo_cotizacion', semanas: PLAZOS_NEC.cotizacion_semanas, quien: 'ANIN', texto: 'Es un evento compensable: se instruye presentar cotizacion (cl. 61.4 / 62.1).' },
    'rechazar': { de: ['notificado'], a: 'no-es-evento', correo: 'respuesta-ec', quien: 'ANIN', texto: 'No es un evento compensable (cl. 61.4).' },
    'cotizar': { de: ['cotizacion-instruida', 'cotizacion-revisada'], a: 'cotizacion-presentada', correo: 'cotizacion-ec', plazo: 'plazo_respuesta_cotizacion', semanas: PLAZOS_NEC.respuesta_cotizacion_semanas, quien: 'CONTR', texto: 'Cotizacion presentada (cl. 62.2).' },
    'aceptar-cotizacion': { de: ['cotizacion-presentada'], a: 'cotizacion-aceptada', correo: 'respuesta-cotizacion', quien: 'ANIN', texto: 'Cotizacion aceptada (cl. 62.3).' },
    'pedir-revision': { de: ['cotizacion-presentada'], a: 'cotizacion-revisada', correo: 'respuesta-cotizacion', plazo: 'plazo_cotizacion', semanas: PLAZOS_NEC.cotizacion_semanas, quien: 'ANIN', texto: 'Se instruye una cotizacion revisada (cl. 62.3 / 62.4).' },
    'evaluar': { de: ['cotizacion-presentada', 'cotizacion-revisada', 'cotizacion-instruida'], a: 'evaluado-por-gerente', correo: 'evaluacion-ec', quien: 'ANIN', texto: 'El Gerente de Proyecto evalua el evento (cl. 64).' },
    'implementar': { de: ['cotizacion-aceptada', 'evaluado-por-gerente'], a: 'implementado', correo: 'notificacion', quien: 'ANIN', texto: 'Evento compensable implementado (cl. 66).' },
    'retirar': { de: ['notificado', 'cotizacion-instruida', 'cotizacion-presentada', 'cotizacion-revisada'], a: 'retirado', correo: 'notificacion', quien: '*', texto: 'Notificacion retirada.' }
  };
  app.get('/api/proyectos/:pid/eventos-compensables', requiereSesion, requiereRol('lector'), (req, res) => {
    const lista = q.todos('SELECT * FROM eventos_compensables WHERE proyecto_id = ? ORDER BY numero DESC', req.pid).map(e => abreJson(e, ['historial']));
    const hoy = hoyIso();
    for (const e of lista) { const c = e.correo_id ? q.uno('SELECT numero FROM correos WHERE id = ?', e.correo_id) : null; e.correo_numero = c ? c.numero : ''; e.plazo_vigente = e.estado === 'notificado' ? e.plazo_respuesta : ['cotizacion-instruida', 'cotizacion-revisada'].includes(e.estado) ? e.plazo_cotizacion : e.estado === 'cotizacion-presentada' ? e.plazo_respuesta_cotizacion : ''; e.vencido = !!(e.plazo_vigente && e.plazo_vigente < hoy); e.siguiente = Object.entries(PASOS_EC).filter(([, d]) => d.de.includes(e.estado)).map(([k, d]) => ({ accion: k, quien: d.quien, texto: d.texto })); const a = e.alerta_id ? q.uno('SELECT codigo FROM alertas_tempranas WHERE id = ?', e.alerta_id) : null; e.alerta_codigo = a ? a.codigo : ''; }
    res.json({ eventos: lista, estados: ESTADOS_EC, plazos: PLAZOS_NEC, resumen: { abiertos: lista.filter(e => !['implementado', 'no-es-evento', 'retirado'].includes(e.estado)).length, vencidos: lista.filter(e => e.vencido).length, monto: lista.filter(e => e.estado === 'implementado').reduce((s, e) => s + (e.monto || 0), 0), dias: lista.filter(e => e.estado === 'implementado').reduce((s, e) => s + (e.dias || 0), 0) } });
  });
  app.post('/api/proyectos/:pid/eventos-compensables', requiereSesion, requiereRol('autor'), J, (req, res) => {
    // alta directa (p.ej. el Gerente notifica un evento al instruir, cl. 61.1): crea el registro y el correo de notificacion
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, fecha = ahora();
    const titulo = String(b.titulo || '').trim().slice(0, 300); if (!titulo) return res.status(400).json({ error: 'datos', mensaje: 'Falta el titulo.' });
    const numero = (q.uno('SELECT MAX(numero) AS m FROM eventos_compensables WHERE proyecto_id = ?', req.pid).m || 0) + 1, eid = id('ec'), codigo = 'EC-' + String(numero).padStart(3, '0');
    q.corre('INSERT INTO eventos_compensables (id, proyecto_id, numero, codigo, titulo, descripcion, clausula, notificado_por, org, fecha_notificacion, fecha_percatado, correo_id, alerta_id, estado, plazo_respuesta, historial, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      eid, req.pid, numero, codigo, titulo, String(b.descripcion || '').slice(0, 4000), String(b.clausula || '').slice(0, 120), u.email, u.organizacion, fecha, String(b.fecha_percatado || '').slice(0, 10), '', String(b.alerta_id || ''), 'notificado', sumaDias(fecha, 7 * PLAZOS_NEC.respuesta_notificacion_semanas), JSON.stringify([{ fecha, por: u.email, accion: 'notificado', estado: 'notificado' }]), fecha);
    audita(u.email, 'evento.crear', req.pid, codigo, { titulo }); res.json({ ok: true, id: eid, codigo });
  });
  app.post('/api/proyectos/:pid/eventos-compensables/:eid/avanzar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const e = abreJson(q.uno('SELECT * FROM eventos_compensables WHERE id = ? AND proyecto_id = ?', req.params.eid, req.pid), ['historial']); if (!e) return res.status(404).json({ error: 'no-existe' });
    const paso = PASOS_EC[String(b.accion || '')]; if (!paso) return res.status(400).json({ error: 'accion', mensaje: 'Accion no valida (' + Object.keys(PASOS_EC).join(', ') + ').' });
    if (!paso.de.includes(e.estado)) return res.status(409).json({ error: 'estado', mensaje: 'Desde "' + e.estado + '" no se puede "' + b.accion + '".' });
    if (paso.quien === 'ANIN' && !(esGestor(u) || u.organizacion === 'ANIN')) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Esta decision la toma el Gerente de Proyecto (Entidad).' });
    if (paso.quien === 'CONTR' && !(esGestor(u) || u.organizacion === e.org)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'La cotizacion la presenta quien notifico el evento (' + e.org + ').' });
    const fecha = ahora(), cambios = { estado: paso.a, actualizado: fecha };
    if (paso.plazo) cambios[paso.plazo] = sumaDias(fecha, 7 * paso.semanas);
    if (b.monto !== undefined) cambios.monto = Number(b.monto) || 0; if (b.dias !== undefined) cambios.dias = parseInt(b.dias, 10) || 0;
    // el correo que documenta el paso (al estilo Aconex/Unifier: cada decision es una comunicacion)
    let correoNumero = '';
    if (b.correo !== false) {
      const t = tipoDe(p, paso.correo) || tipoDe(p, 'notificacion');
      if (t) {
        const destino = paso.quien === 'ANIN' ? [{ org: e.org }] : [{ org: 'ANIN' }];
        const campos = {}; if (t.id === 'respuesta-ec') campos.decision = paso.a === 'no-es-evento' ? 'No es un evento compensable' : 'Es un evento compensable: cotizar'; if (t.id === 'respuesta-cotizacion') campos.decision = paso.a === 'cotizacion-aceptada' ? 'Cotizacion aceptada' : paso.a === 'cotizacion-revisada' ? 'Se instruye cotizacion revisada' : 'El Gerente evaluara el evento (cl. 64)'; if (b.monto !== undefined) campos.monto = String(b.monto); if (b.dias !== undefined) campos.dias = String(b.dias);
        // Como en Aconex: cada paso del evento es un correo de SU linea de comunicacion (cuelga del ultimo correo del evento, mismo numero de referencia)
        const rr = respondeEnLinea(p, u, { correoOrigen: e.correo_id, registroTipo: 'evento-compensable', registroId: e.id, tipo: t, asunto: e.codigo + ' · ' + e.titulo + ' · ' + paso.texto, cuerpo: String(b.comentario || paso.texto), para: e.correo_id ? null : destino, campos });
        const numero = rr.numero; if (!e.correo_id) cambios.correo_id = rr.id;
        correoNumero = numero;
      }
    }
    e.historial.push({ fecha, por: u.email, accion: b.accion, estado: paso.a, correo: correoNumero, comentario: String(b.comentario || '').slice(0, 2000), monto: cambios.monto, dias: cambios.dias });
    cambios.historial = JSON.stringify(e.historial);
    q.corre('UPDATE eventos_compensables SET ' + Object.keys(cambios).map(k => k + ' = ?').join(', ') + ' WHERE id = ?', ...Object.values(cambios), e.id);
    audita(u.email, 'evento.' + b.accion, req.pid, e.codigo, { estado: paso.a, correo: correoNumero }); res.json({ ok: true, estado: paso.a, correo: correoNumero });
  });
}

module.exports = { monta, tiposPorDefecto, RESPUESTAS, ESTADOS_AT, ESTADOS_EC, PLAZOS_NEC };
