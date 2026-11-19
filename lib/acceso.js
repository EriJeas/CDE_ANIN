/*
 * ACCESO AL CDE. Tres puertas, la misma sesion:
 *  - MODO_ACCESO=autodesk : inicio de sesion con la cuenta de Autodesk (OAuth de 3 patas, el mismo flujo del visor). Sirve
 *                           para el arranque: todos los contratistas ya tienen cuenta Autodesk aunque no tengan licencia.
 *  - MODO_ACCESO=microsoft: cuenta institucional de ANIN (Microsoft Entra). Es la puerta de destino para la entidad; usa el
 *                           mismo registro de aplicacion que ya se pidio a OTI para OneDrive (ver docs/ARQUITECTURA.md).
 *  - MODO_ACCESO=cuentas  : cada persona entra con su correo y su propia clave. Las cuentas las crea un administrador (ADMIN_EMAILS)
 *                           y las claves se guardan resumidas (scrypt), nunca en claro. Es la puerta para un servidor en internet
 *                           (Render) cuando aun no hay cuenta institucional ni se quiere depender de Autodesk.
 *  - MODO_ACCESO=local    : correo + clave compartida (ACCESO_CLAVE). SOLO para pruebas en una PC, sin internet.
 * La sesion viaja en una cookie cifrada (AES-256-GCM con SESSION_SECRET), como en el visor: el navegador no ve nada util.
 *
 * Roles: el administrador global (ADMIN_EMAILS, separados por coma) y, por proyecto, miembros con rol
 * administrador | gestor | revisor | autor | lector (tabla miembros). Los complementos (Revit, Navisworks) no inician
 * sesion: usan una LLAVE creada por un administrador (cabecera x-cde-llave), igual que el complemento del visor.
 */
'use strict';
const crypto = require('crypto');
const { q, ahora, id, audita } = require('./bd');

const MODO = (process.env.MODO_ACCESO || 'local').toLowerCase();
const SECRETO = process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion';
const CLAVE = crypto.scryptSync(SECRETO, 'cde-anin', 32);
const COOKIE = 'cde_sesion';
const SESION_HORAS = Number(process.env.SESION_HORAS) || 10;
const ADMINS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

function cifra(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv);
  const b = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64url');
}
function descifra(txt) {
  try {
    const b = Buffer.from(String(txt || ''), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', CLAVE, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return o && o.exp > Date.now() ? o : null;
  } catch (e) { return null; }
}
function sesionDe(req) { if (req._sesion !== undefined) return req._sesion; req._sesion = descifra(req.cookies && req.cookies[COOKIE]); return req._sesion; }
function abreSesion(res, datos) {
  const s = Object.assign({}, datos, { exp: Date.now() + SESION_HORAS * 3600000 });
  res.cookie(COOKIE, cifra(s), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESION_HORAS * 3600000 });
  return s;
}
function cierraSesion(res) { res.clearCookie(COOKIE); }

const esAdminGlobal = (email) => ADMINS.includes(String(email || '').toLowerCase());
/** El rol de un correo en un proyecto (el administrador global lo es en todos). */
function rolEn(email, proyectoId) {
  if (esAdminGlobal(email)) return 'administrador';
  const m = q.uno('SELECT rol FROM miembros WHERE proyecto_id = ? AND email = ?', proyectoId, String(email || '').toLowerCase());
  return m ? m.rol : '';
}

function requiereSesion(req, res, next) {
  const s = sesionDe(req);
  if (!s) return res.status(401).json({ error: 'sin-sesion', mensaje: 'Inicia sesion para continuar.' });
  req.quien = s.email; req.nombre = s.nombre || s.email; req.admin = esAdminGlobal(s.email);
  // con clave temporal solo se puede cambiar la clave: nada mas responde hasta entonces
  if (s.cambiar && !/^\/api\/acceso\//.test(req.originalUrl || '')) return res.status(403).json({ error: 'cambiar-clave', mensaje: 'Antes de continuar, cambia tu clave temporal.' });
  next();
}
/** Exige un rol minimo en el proyecto de la ruta (:pid). */
function requiereRol(min) {
  const R = require('./iso19650').RANGO_ROL;
  return (req, res, next) => {
    const pid = String(req.params.pid || req.body && req.body.proyecto_id || '');
    const rol = rolEn(req.quien, pid);
    if (!rol) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No eres miembro de este proyecto.' });
    if ((R[rol] || 0) < (R[min] || 0)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta el rol ' + min + ' (tienes ' + rol + ').' });
    req.rol = rol; req.pid = pid; next();
  };
}

// ---------- llaves de complementos ----------
const huella = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
function creaLlave(nombre, proyectoId, por) {
  const llave = crypto.randomBytes(24).toString('hex');
  q.corre('INSERT INTO llaves (id, nombre, huella, proyecto_id, creada, por) VALUES (?,?,?,?,?,?)', id('lk'), String(nombre || 'complemento').slice(0, 80), huella(llave), String(proyectoId || ''), ahora(), por);
  audita(por, 'llave.crear', proyectoId, nombre, '');
  return llave;   // se muestra UNA vez; en la base queda solo la huella
}
function requiereLlave(req, res, next) {
  const k = String(req.get('x-cde-llave') || '');
  const l = k.length >= 32 ? q.uno('SELECT * FROM llaves WHERE huella = ? AND revocada = 0', huella(k)) : null;
  if (!l) return res.status(401).json({ error: 'llave-invalida', mensaje: 'La llave del complemento no es valida (pidela al administrador del CDE).' });
  q.corre('UPDATE llaves SET uso = ? WHERE id = ?', ahora(), l.id);
  req.llave = l; req.quien = 'complemento:' + l.nombre; req.rol = 'autor';
  if (l.proyecto_id && req.params.pid && req.params.pid !== l.proyecto_id) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Esta llave es de otro proyecto.' });
  next();
}

// ---------- rutas de acceso ----------
function monta(app) {
  app.get('/api/acceso/modo', (req, res) => res.json({ modo: MODO, autodesk: !!process.env.APS_CLIENT_ID }));

  // cuentas propias: correo + clave personal
  require('./bd').db.exec("CREATE TABLE IF NOT EXISTS cuentas (email TEXT PRIMARY KEY, nombre TEXT DEFAULT '', sal TEXT NOT NULL, resumen TEXT NOT NULL, debe_cambiar INTEGER DEFAULT 1, creada TEXT NOT NULL, creada_por TEXT DEFAULT '', ultimo TEXT DEFAULT '', intentos INTEGER DEFAULT 0, bloqueada_hasta TEXT DEFAULT '')");
  const JC = require('express').json({ limit: '8kb' }), CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const resume = (clave, sal) => crypto.scryptSync(String(clave), sal, 64).toString('hex');
  const igual = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const guardaClave = (email, clave, debe) => { const sal = crypto.randomBytes(16).toString('hex'); q.corre('UPDATE cuentas SET sal = ?, resumen = ?, debe_cambiar = ?, intentos = 0, bloqueada_hasta = ? WHERE email = ?', sal, resume(clave, sal), debe ? 1 : 0, '', email); };
  const temporal = () => crypto.randomBytes(9).toString('base64url');   // 12 caracteres
  const valida = (c) => String(c || '').length >= 10 ? '' : 'La clave debe tener al menos 10 caracteres.';
  const soloCuentas = (req, res, next) => MODO === 'cuentas' ? next() : res.status(404).json({ error: 'modo', mensaje: 'El acceso con cuentas propias no esta habilitado.' });
  const soloAdmin = (req, res, next) => req.admin ? next() : res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo un administrador del CDE gestiona las cuentas.' });
  app.post('/api/acceso/cuenta', soloCuentas, JC, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(), clave = String((req.body || {}).clave || ''), mal = () => res.status(401).json({ error: 'clave', mensaje: 'Correo o clave incorrectos.' });
    if (!CORREO.test(email) || !clave) return mal();
    let c = q.uno('SELECT * FROM cuentas WHERE email = ?', email);
    // primer arranque: el administrador global entra una vez con ADMIN_CLAVE_INICIAL y queda obligado a poner su clave
    if (!c && esAdminGlobal(email) && process.env.ADMIN_CLAVE_INICIAL && clave === process.env.ADMIN_CLAVE_INICIAL) { q.corre('INSERT INTO cuentas (email, nombre, sal, resumen, debe_cambiar, creada, creada_por) VALUES (?,?,?,?,1,?,?)', email, email.split('@')[0], 'x', 'x', ahora(), 'arranque'); guardaClave(email, clave, true); c = q.uno('SELECT * FROM cuentas WHERE email = ?', email); }
    if (!c) { resume(clave, 'sin-cuenta'); return mal(); }
    if (c.bloqueada_hasta && c.bloqueada_hasta > ahora()) return res.status(429).json({ error: 'bloqueada', mensaje: 'Demasiados intentos. Vuelve a probar en unos minutos.' });
    if (!igual(resume(clave, c.sal), c.resumen)) { const n = (c.intentos || 0) + 1; q.corre('UPDATE cuentas SET intentos = ?, bloqueada_hasta = ? WHERE email = ?', n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : '', email); audita(email, 'sesion.fallo', '', '', 'cuentas'); return mal(); }
    q.corre("UPDATE cuentas SET intentos = 0, bloqueada_hasta = '', ultimo = ? WHERE email = ?", ahora(), email);
    abreSesion(res, { email, nombre: c.nombre || email.split('@')[0], modo: 'cuentas', cambiar: c.debe_cambiar ? 1 : 0 }); audita(email, 'sesion.entrar', '', '', 'cuentas');
    res.json({ ok: true, email, admin: esAdminGlobal(email), cambiar: !!c.debe_cambiar });
  });
  app.post('/api/acceso/clave', soloCuentas, requiereSesion, JC, (req, res) => {
    const c = q.uno('SELECT * FROM cuentas WHERE email = ?', req.quien), b = req.body || {}; if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!igual(resume(String(b.actual || ''), c.sal), c.resumen)) return res.status(401).json({ error: 'clave', mensaje: 'La clave actual no es correcta.' });
    const e = valida(b.nueva); if (e) return res.status(400).json({ error: 'clave-debil', mensaje: e }); if (b.nueva === b.actual) return res.status(400).json({ error: 'igual', mensaje: 'La clave nueva debe ser distinta de la actual.' });
    guardaClave(req.quien, b.nueva, false); abreSesion(res, { email: req.quien, nombre: c.nombre || req.quien.split('@')[0], modo: 'cuentas', cambiar: 0 }); audita(req.quien, 'cuenta.clave', '', '', ''); res.json({ ok: true });
  });
  app.get('/api/acceso/cuentas', soloCuentas, requiereSesion, soloAdmin, (req, res) => res.json({ cuentas: q.todos('SELECT email, nombre, debe_cambiar, creada, creada_por, ultimo, bloqueada_hasta FROM cuentas ORDER BY email').map(c => Object.assign(c, { admin: esAdminGlobal(c.email) })) }));
  app.post('/api/acceso/cuentas', soloCuentas, requiereSesion, soloAdmin, JC, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(), nombre = String((req.body || {}).nombre || '').trim().slice(0, 120); if (!CORREO.test(email)) return res.status(400).json({ error: 'correo', mensaje: 'Escribe un correo valido.' });
    if (q.uno('SELECT email FROM cuentas WHERE email = ?', email)) return res.status(409).json({ error: 'existe', mensaje: 'Ya hay una cuenta con ese correo.' });
    const t = temporal(); q.corre('INSERT INTO cuentas (email, nombre, sal, resumen, debe_cambiar, creada, creada_por) VALUES (?,?,?,?,1,?,?)', email, nombre, 'x', 'x', ahora(), req.quien); guardaClave(email, t, true); audita(req.quien, 'cuenta.crear', '', email, ''); res.json({ ok: true, email, temporal: t });
  });
  app.post('/api/acceso/cuentas/restablecer', soloCuentas, requiereSesion, soloAdmin, JC, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(); if (!q.uno('SELECT email FROM cuentas WHERE email = ?', email)) return res.status(404).json({ error: 'no-existe' });
    const t = temporal(); guardaClave(email, t, true); audita(req.quien, 'cuenta.restablecer', '', email, ''); res.json({ ok: true, email, temporal: t });
  });
  app.post('/api/acceso/cuentas/quitar', soloCuentas, requiereSesion, soloAdmin, JC, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(); if (email === req.quien) return res.status(400).json({ error: 'propia', mensaje: 'No puedes quitar tu propia cuenta.' });
    q.corre('DELETE FROM cuentas WHERE email = ?', email); audita(req.quien, 'cuenta.quitar', '', email, ''); res.json({ ok: true });
  });
  app.get('/api/acceso/quien', (req, res) => {
    const s = sesionDe(req); if (!s) return res.status(401).json({ error: 'sin-sesion' });
    res.json({ email: s.email, nombre: s.nombre || '', admin: esAdminGlobal(s.email), modo: s.modo, cambiar: !!s.cambiar });
  });
  app.post('/api/acceso/salir', (req, res) => { cierraSesion(res); res.json({ ok: true }); });

  // local (pruebas): correo + clave compartida
  app.post('/api/acceso/local', require('express').json({ limit: '8kb' }), (req, res) => {
    if (MODO !== 'local') return res.status(404).json({ error: 'modo', mensaje: 'El acceso local no esta habilitado.' });
    const email = String((req.body || {}).email || '').trim().toLowerCase(), clave = String((req.body || {}).clave || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'correo', mensaje: 'Escribe un correo valido.' });
    if (!process.env.ACCESO_CLAVE || clave !== process.env.ACCESO_CLAVE) return res.status(401).json({ error: 'clave', mensaje: 'Clave incorrecta.' });
    abreSesion(res, { email, nombre: email.split('@')[0], modo: 'local' });
    audita(email, 'sesion.entrar', '', '', 'local');
    res.json({ ok: true, email, admin: esAdminGlobal(email) });
  });

  // Autodesk (3 patas): el mismo flujo del visor, reducido a lo que el CDE necesita (identidad)
  const APS_ID = process.env.APS_CLIENT_ID, APS_SECRETO = process.env.APS_CLIENT_SECRET, APS_VUELTA = process.env.APS_CALLBACK_URL;
  app.get('/api/acceso/autodesk', (req, res) => {
    if (!APS_ID) return res.status(404).send('Acceso con Autodesk no configurado (APS_CLIENT_ID).');
    const u = new URL('https://developer.api.autodesk.com/authentication/v2/authorize');
    u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', APS_ID); u.searchParams.set('redirect_uri', APS_VUELTA);
    u.searchParams.set('scope', 'user-profile:read data:read');   // data:read: para que el conector lea Forma con la sesion del usuario
    const estado = crypto.randomBytes(8).toString('hex'); res.cookie('cde_oauth', estado, { httpOnly: true, sameSite: 'lax', maxAge: 600000 });
    u.searchParams.set('state', estado);
    res.redirect(u.toString());
  });
  app.get('/api/acceso/autodesk/vuelta', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== (req.cookies || {}).cde_oauth) throw new Error('estado invalido');
      const r = await fetch('https://developer.api.autodesk.com/authentication/v2/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(APS_ID + ':' + APS_SECRETO).toString('base64') },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: APS_VUELTA }) });
      const t = await r.json(); if (!r.ok) throw new Error(t.error_description || t.error || ('HTTP ' + r.status));
      const p = await (await fetch('https://api.userprofile.autodesk.com/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
      const email = String(p.email || '').toLowerCase(); if (!email) throw new Error('Autodesk no devolvio el correo');
      abreSesion(res, { email, nombre: p.name || ((p.given_name || '') + ' ' + (p.family_name || '')).trim(), modo: 'autodesk', apsRefresh: t.refresh_token });
      audita(email, 'sesion.entrar', '', '', 'autodesk');
      res.redirect('/');
    } catch (e) { res.status(400).send('No se pudo iniciar sesion con Autodesk: ' + e.message); }
  });
}

module.exports = { monta, sesionDe, requiereSesion, requiereRol, requiereLlave, creaLlave, rolEn, esAdminGlobal, MODO };
