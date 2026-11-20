/*
 * CONECTOR ORACLE ACONEX -> CDE: trae al CDE la informacion que el proyecto tiene en Aconex.
 *
 *  1. DOCUMENTOS. Un enlace une el registro de documentos de un proyecto de Aconex (todo, o lo que cumpla un filtro de busqueda
 *     de Aconex) con una carpeta del CDE. Se baja cada documento que falta y se carga por la MISMA puerta que la web (/subir):
 *     valen la nomenclatura de la carpeta, los permisos, el lector de modelos y los desencadenadores. Lo que no cumple la norma
 *     de la carpeta no se descarga: queda «sin nomenclatura» y se completa en la rejilla de conformidad del CDE.
 *     Por defecto el documento entra con el Nº DE DOCUMENTO de Aconex (que suele ser el codigo del proyecto) y la extension de
 *     su archivo; tambien puede entrar con el nombre del archivo.
 *  2. CORREO. El registro de correo del proyecto (bandeja de entrada y enviados): numero, asunto, tipo, remitente, destinatarios,
 *     fechas, estado. El cuerpo de cada correo se lee al abrirlo. Solo lectura: nada se envia ni se marca en Aconex.
 *  3. REGISTRO. El registro de documentos de Aconex, cruzado con el CDE: que documentos de Aconex ya estan en el CDE y cuales no.
 *  Correo y registro tambien se cargan desde los informes en Excel que exporta Aconex (sin credenciales de API).
 *
 * Acceso: OAuth de Oracle (Lobby de Construction and Engineering), aplicacion web de tipo «Web Server Application» registrada
 * por el administrador de la organizacion en Aconex (ACONEX_CLIENT_ID / ACONEX_CLIENT_SECRET) con la direccion de retorno que
 * muestra la pantalla del conector. Cada usuario conecta su propia cuenta: el CDE ve en Aconex lo mismo que ve esa persona.
 * El permiso de renovacion se guarda cifrado; Oracle lo da por 7 dias, asi que si nadie usa el conector una semana hay que
 * volver a conectar.
 */
'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');
const { q, ahora, id, audita, json } = require('./bd');
const CAR = require('./carpetas');
const ISO = require('./iso19650');
const NOM = require('./nomenclatura');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS aconex_cuentas (
  email TEXT PRIMARY KEY, usuario TEXT DEFAULT '', nombre TEXT DEFAULT '', servidor TEXT DEFAULT '', refresco TEXT NOT NULL, conectada TEXT NOT NULL, renovada TEXT DEFAULT '', error TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS aconex_enlaces (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, acx_proyecto TEXT NOT NULL, acx_nombre TEXT DEFAULT '', filtro TEXT DEFAULT '', carpeta_cde TEXT NOT NULL, organizacion TEXT DEFAULT '',
  versiones TEXT DEFAULT 'ultima', nombrar TEXT DEFAULT 'numero', automatico INTEGER DEFAULT 0, por TEXT NOT NULL, creado TEXT NOT NULL, ultimo TEXT DEFAULT '', resumen TEXT DEFAULT '{}', error TEXT DEFAULT '', quitado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_aconex_enlaces ON aconex_enlaces (proyecto_id, quitado);
CREATE TABLE IF NOT EXISTS aconex_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, enlace_id TEXT NOT NULL, proyecto_id TEXT NOT NULL, item TEXT NOT NULL, documento TEXT NOT NULL, revision TEXT DEFAULT '', titulo TEXT DEFAULT '',
  nombre TEXT DEFAULT '', nombre_cde TEXT DEFAULT '', tamano INTEGER DEFAULT 0, fecha_acx TEXT DEFAULT '', contenedor_id TEXT DEFAULT '', n_cde INTEGER DEFAULT 0,
  estado TEXT NOT NULL, detalle TEXT DEFAULT '', fecha TEXT NOT NULL, UNIQUE (enlace_id, documento));
CREATE INDEX IF NOT EXISTS ix_aconex_items ON aconex_items (enlace_id, estado);
CREATE TABLE IF NOT EXISTS aconex_nombres (
  enlace_id TEXT NOT NULL, item TEXT NOT NULL, nombre TEXT NOT NULL, revision TEXT DEFAULT '', idoneidad TEXT DEFAULT '', atributos TEXT DEFAULT '{}', por TEXT DEFAULT '', fecha TEXT NOT NULL, PRIMARY KEY (enlace_id, item));
CREATE TABLE IF NOT EXISTS aconex_vinculos (
  proyecto_id TEXT PRIMARY KEY, acx_proyecto TEXT NOT NULL, acx_nombre TEXT DEFAULT '', automatico INTEGER DEFAULT 0, por TEXT DEFAULT '', correo_ultimo TEXT DEFAULT '', registro_ultimo TEXT DEFAULT '', error TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS aconex_correos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, proyecto_id TEXT NOT NULL, acx_proyecto TEXT DEFAULT '', mail_id TEXT DEFAULT '', numero TEXT NOT NULL, buzon TEXT DEFAULT '', asunto TEXT DEFAULT '',
  tipo TEXT DEFAULT '', de TEXT DEFAULT '', org TEXT DEFAULT '', para TEXT DEFAULT '', fecha TEXT DEFAULT '', vence TEXT DEFAULT '', estado TEXT DEFAULT '', motivo TEXT DEFAULT '',
  referencia TEXT DEFAULT '', contrato TEXT DEFAULT '', respondido TEXT DEFAULT '', adjuntos INTEGER DEFAULT 0, cuerpo TEXT DEFAULT '', anexos TEXT DEFAULT '[]', origen TEXT DEFAULT '', importado TEXT NOT NULL, por TEXT DEFAULT '', UNIQUE (proyecto_id, numero));
CREATE INDEX IF NOT EXISTS ix_aconex_correos ON aconex_correos (proyecto_id, fecha);
CREATE TABLE IF NOT EXISTS aconex_registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT, proyecto_id TEXT NOT NULL, acx_proyecto TEXT DEFAULT '', documento TEXT DEFAULT '', numero TEXT NOT NULL, revision TEXT DEFAULT '', titulo TEXT DEFAULT '',
  tipo TEXT DEFAULT '', estado TEXT DEFAULT '', disciplina TEXT DEFAULT '', fecha TEXT DEFAULT '', archivo TEXT DEFAULT '', tamano INTEGER DEFAULT 0, origen TEXT DEFAULT '', importado TEXT NOT NULL, por TEXT DEFAULT '', UNIQUE (proyecto_id, numero));
`;

// ───────── lectura del XML de Aconex (lo justo, sin dependencias; si alguna instancia respondiera JSON, tambien se entiende)
const xTexto = (s) => String(s == null ? '' : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
  .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const xLinea = (s) => xTexto(s).replace(/\s+/g, ' ').trim();
function xCampo(bloque, nombres) {
  for (const n of nombres) { const m = new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i').exec(bloque); if (m) return m[1]; }
  return '';
}
const xValor = (bloque, nombres) => xLinea(xCampo(bloque, nombres));
const xAttr = (attrs, n) => (new RegExp(n + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs || '') || [])[1] || '';
function xBloques(t, tag) {
  const re = new RegExp('<' + tag + '(\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'gi'), out = []; let m;
  while ((m = re.exec(String(t || '')))) out.push({ attrs: m[1] || '', cuerpo: m[2] });
  return out;
}
const dia = (v) => { const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };
const recorta = (v, n) => String(v == null ? '' : v).slice(0, n);
/** Proyectos de GET /api/projects (ProjectResults > Project). Pura. */
function proyectosDe(t) {
  return xBloques(t, 'Project').map(b => ({ id: xValor(b.cuerpo, ['ProjectId', 'ProjectID']) || xAttr(b.attrs, 'ProjectId'), nombre: xValor(b.cuerpo, ['ProjectName']), corto: xValor(b.cuerpo, ['ProjectShortName', 'ProjectCode']) }))
    .filter(p => p.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
/** Documentos de GET /register (RegisterSearch > SearchResults > Document DocumentId="…"). Pura. */
function documentosDe(t) {
  return xBloques(t, 'Document').map(b => {
    const c = b.cuerpo;
    return { id: xAttr(b.attrs, 'DocumentId') || xValor(c, ['DocumentId']), numero: recorta(xValor(c, ['DocumentNumber', 'DocNo', 'DocumentNo']), 200), titulo: recorta(xValor(c, ['Title']), 400),
      revision: recorta(xValor(c, ['Revision']), 30), archivo: recorta(xValor(c, ['Filename', 'FileName']), 250), tamano: Number(xValor(c, ['FileSize'])) || 0,
      estado: recorta(xValor(c, ['DocumentStatus', 'Status', 'StatusId']), 80), tipo: recorta(xValor(c, ['DocumentType', 'DocType', 'Type']), 80), disciplina: recorta(xValor(c, ['Discipline']), 80),
      fecha: dia(xValor(c, ['DateModified', 'Registered', 'DateRegistered', 'RegisteredDate', 'DateUpdated', 'DateCreated'])) };
  }).filter(d => d.id);
}
/** Correos de GET /mail (MailSearch > SearchResults > Mail MailId="…"). Pura. */
function correosDe(t, buzon) {
  return xBloques(t, 'Mail').map(b => {
    const c = b.cuerpo, de = xCampo(c, ['FromUserDetails', 'FromUser']);
    const para = xBloques(xCampo(c, ['ToUsers']), 'Recipient').map(r => { const n = xValor(r.cuerpo, ['Name', 'FullName']), o = xValor(r.cuerpo, ['OrganizationName', 'TradingName']); return n + (o ? ' (' + o + ')' : ''); }).filter(Boolean);
    return { mailId: xAttr(b.attrs, 'MailId') || xValor(c, ['MailId']), numero: recorta(xValor(c, ['MailNo', 'DocumentNo', 'DocNo']), 120), asunto: recorta(xValor(c, ['Subject']), 500),
      tipo: recorta(xValor(c, ['CorrespondenceType', 'CorrType']), 120), de: recorta(xValor(de, ['Name', 'FullName']), 160), org: recorta(xValor(de, ['OrganizationName', 'TradingName']), 200),
      para: recorta(para.join('; '), 2000), fecha: dia(xValor(c, ['SentDate'])), vence: dia(xValor(c, ['ResponseRequiredDate', 'ResponseDate', 'ResponseDue'])),
      estado: recorta(xValor(c, ['Status', 'MailStatus', 'ToStatus']), 80), motivo: recorta(xValor(c, ['ReasonForIssue']), 120), referencia: recorta(xValor(c, ['ReferenceNumber', 'InRefToMailNo']), 120),
      adjuntos: Number(xValor(c, ['AllAttachmentCount', 'AttachedDocumentCount'])) || 0, buzon: buzon || '' };
  }).filter(m => m.numero || m.asunto);
}
const paginasDe = (t) => { const m = /TotalPages\s*=\s*"(\d+)"/i.exec(String(t || '')); return m ? Math.max(1, +m[1]) : 1; };
/** Orden de los DocumentId (numeros largos). */
const compId = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express } = ctx, I = ctx.cdeInterno;
  const BD = require('./bd'); BD.db.exec(ESQUEMA);
  const J = express.json({ limit: '1mb' }), JG = express.json({ limit: '25mb' });
  // En pruebas, un servidor local hace de Oracle (solo 127.0.0.1).
  const prueba = () => { const p = process.env.ACONEX_PRUEBA || ''; return /^http:\/\/127\.0\.0\.1:\d+$/.test(p) ? p : ''; };
  const httpsOk = (u) => /^https:\/\/[\w.-]+(:\d+)?$/.test(String(u || '').replace(/\/$/, ''));
  const lobby = () => prueba() || (httpsOk(process.env.ACONEX_LOBBY) ? process.env.ACONEX_LOBBY.replace(/\/$/, '') : 'https://constructionandengineering.oraclecloud.com');
  const servidorDe = (c) => prueba() || (httpsOk(process.env.ACONEX_SERVIDOR) ? process.env.ACONEX_SERVIDOR.replace(/\/$/, '') : (c && httpsOk(c.servidor) ? c.servidor : 'https://api.aconex.com'));
  const configurado = () => !!(process.env.ACONEX_CLIENT_ID && process.env.ACONEX_CLIENT_SECRET);
  const retorno = (req) => process.env.ACONEX_CALLBACK || ((process.env.URL_PUBLICA || '').replace(/\/$/, '') || (req.protocol + '://' + req.get('host'))) + '/api/aconex/vuelta';
  const basica = () => 'Basic ' + Buffer.from(String(process.env.ACONEX_CLIENT_ID).trim() + ':' + String(process.env.ACONEX_CLIENT_SECRET).trim()).toString('base64');
  const MAX_MB = Number(process.env.ACONEX_MAX_MB) || 4096;
  const fallo = (res, e) => res.status(e.status || 400).json({ error: e.codigo || 'aconex', mensaje: e.message });
  const err = (msg, codigo, status) => Object.assign(new Error(msg), { codigo, status });

  const CLAVE = crypto.scryptSync(process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion', 'cde-anin-aconex', 32);
  const cifra = (t) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv), b = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64url'); };
  const descifra = (t) => { try { const b = Buffer.from(String(t || ''), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', CLAVE, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch (e) { return ''; } };
  /** Lo que dice la ficha de Oracle de quien se conecto (sin comprobar firma: solo para mostrar el nombre). */
  const reclamos = (tok) => { try { return JSON.parse(Buffer.from(String(tok).split('.')[1] || '', 'base64url').toString('utf8')) || {}; } catch (e) { return {}; } };
  const sitioDe = (r) => { const s = String(r.user_site || r.site || '').trim(); if (/^https:\/\/[\w.-]+\.aconex\.com\/?$/i.test(s)) return s.replace(/\/$/, ''); if (/^[\w.-]+\.aconex\.com$/i.test(s)) return 'https://' + s; return ''; };

  // ───────── fichas de acceso: una por usuario conectado
  const FICHAS = new Map(), RENOVANDO = new Map();
  async function pideFicha(cuerpo) {
    const r = await fetch(lobby() + '/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basica(), Accept: 'application/json' }, body: new URLSearchParams(cuerpo) });
    const t = await r.json().catch(() => ({})); if (!r.ok || !t.access_token) throw err(t.error_description || t.error || ('Oracle no entregó el acceso (' + r.status + ').'), 'aconex-acceso'); return t;
  }
  async function ficha(email) {
    email = String(email || '').toLowerCase(); const f = FICHAS.get(email); if (f && f.vence > Date.now() + 60000) return f;
    if (RENOVANDO.has(email)) return RENOVANDO.get(email);
    const tarea = (async () => {
      const c = q.uno('SELECT * FROM aconex_cuentas WHERE email = ?', email), ref = c && descifra(c.refresco);
      if (!ref) throw err('Conecta tu cuenta de Aconex para usar el conector.', 'aconex-sin-conexion', 409);
      try {
        const t = await pideFicha({ grant_type: 'refresh_token', refresh_token: ref });
        q.corre("UPDATE aconex_cuentas SET refresco = ?, renovada = ?, error = '' WHERE email = ?", cifra(t.refresh_token || ref), ahora(), email);
        const nf = { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000, servidor: c.servidor }; FICHAS.set(email, nf); return nf;
      } catch (e) { q.corre('UPDATE aconex_cuentas SET error = ? WHERE email = ?', String(e.message).slice(0, 300), email); throw err('La conexión con Aconex venció (Oracle la da por 7 días sin uso) o fue revocada: vuelve a conectar la cuenta. (' + e.message + ')', 'aconex-sin-conexion', 409); }
    })();
    RENOVANDO.set(email, tarea); try { return await tarea; } finally { RENOVANDO.delete(email); }
  }
  /** Peticion a la API de Aconex con la ficha del usuario. Devuelve la respuesta (para leer texto o bajar el archivo). */
  async function acx(ruta, email, opciones) {
    const f = await ficha(email), url = servidorDe(f) + ruta, cab = Object.assign({ Authorization: 'Bearer ' + f.token }, (opciones && opciones.cabeceras) || {});
    if (process.env.ACONEX_APP_KEY) cab['X-Application-Key'] = process.env.ACONEX_APP_KEY;
    for (let intento = 0; ; intento++) {
      const r = await fetch(url, { headers: cab });
      if ((r.status === 429 || r.status === 503) && intento < 4) { await new Promise(ok => setTimeout(ok, Math.min(30, Number(r.headers.get('retry-after')) || 2 * (intento + 1)) * 1000)); continue; }
      if (!r.ok) {
        const txt = (await r.text().catch(() => '')).slice(0, 2000), msg = xValor(txt, ['ErrorDescription', 'Description', 'Message']) || xValor(txt, ['Error']);
        if (r.status === 401) { FICHAS.delete(String(email).toLowerCase()); throw err('Aconex no aceptó el acceso (401): vuelve a conectar la cuenta.' + (msg ? ' ' + msg : ''), 'aconex-sin-conexion', 409); }
        throw err(r.status === 403 ? 'Aconex no permite ver eso con tu cuenta (403).' + (msg ? ' ' + msg : '') : r.status === 404 ? 'Aconex no encuentra ese elemento (404).' : 'Aconex respondió ' + r.status + (msg ? ': ' + msg : '.'), 'aconex', r.status === 403 ? 403 : 502);
      }
      return r;
    }
  }
  const acxTexto = async (ruta, email, cab) => (await acx(ruta, email, { cabeceras: cab })).text();
  /** Todas las paginas de una busqueda PAGED de Aconex. */
  async function todasLasPaginas(ruta, email, lector, tope, cab) {
    const out = []; let n = 1, total = 1;
    do { const t = await acxTexto(ruta + (ruta.includes('?') ? '&' : '?') + 'search_type=PAGED&page_size=500&page_number=' + n, email, cab); lector(t).forEach(x => out.push(x)); total = paginasDe(t); n++; } while (n <= total && n <= (tope || 40));
    return out;
  }

  // ───────── conectar / desconectar la cuenta de Aconex
  const cuentaDe = (email) => q.uno('SELECT email, usuario, nombre, servidor, conectada, renovada, error FROM aconex_cuentas WHERE email = ?', String(email || '').toLowerCase());
  const authorizeUrl = (req, estado) => { const u = new URL(lobby() + '/auth/authorize'); u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', String(process.env.ACONEX_CLIENT_ID).trim()); u.searchParams.set('redirect_uri', retorno(req)); u.searchParams.set('state', estado); if (process.env.ACONEX_SCOPE) u.searchParams.set('scope', process.env.ACONEX_SCOPE); return u.toString(); };
  app.get('/api/aconex/estado', requiereSesion, (req, res) => {
    const c = cuentaDe(req.quien), venceRef = c && (c.renovada || c.conectada) ? new Date(Date.parse(c.renovada || c.conectada) + 7 * 86400000).toISOString() : '';
    res.json({ configurado: configurado(), app: configurado() ? String(process.env.ACONEX_CLIENT_ID).trim().slice(-4) : '', retorno: retorno(req), lobby: lobby(), servidor: servidorDe(c), conectado: !!c,
      cuenta: c ? { usuario: c.usuario, nombre: c.nombre, desde: c.conectada, renovada: c.renovada, venceRenovacion: venceRef, error: c.error } : null, intervaloMin: INTERVALO });
  });
  app.get('/api/aconex/conectar', requiereSesion, (req, res) => {
    if (!configurado()) return res.status(400).send('Falta configurar ACONEX_CLIENT_ID y ACONEX_CLIENT_SECRET en el archivo .env (o cde.env) de la carpeta del CDE.');
    const estado = crypto.randomBytes(18).toString('hex'), pid = String(req.query.pid || '').replace(/[^\w-]/g, '').slice(0, 60);
    res.cookie('cde_aconex', estado + '.' + pid, { httpOnly: true, sameSite: 'lax', maxAge: 600000 });
    res.redirect(authorizeUrl(req, estado));
  });
  app.get('/api/aconex/vuelta', requiereSesion, async (req, res) => {
    const [estado, pid] = String((req.cookies && req.cookies.cde_aconex) || '').split('.'); res.clearCookie('cde_aconex');
    const a = (msg) => res.redirect('/?aconex=' + encodeURIComponent(msg) + '#/' + (pid ? 'p/' + pid + '/puente' : ''));
    try {
      if (req.query.error) return a('error:' + String(req.query.error_description || req.query.error).slice(0, 200));
      if (!estado || String(req.query.state || '') !== estado) return a('error:La respuesta de Oracle no corresponde a esta sesión. Vuelve a pulsar «Conectar con Aconex».');
      const t = await pideFicha({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: retorno(req) });
      if (!t.refresh_token) return a('error:Oracle no entregó el permiso de renovación (revisa que la aplicación sea de tipo «Web Server Application»).');
      const r = reclamos(t.access_token), email = String(req.quien).toLowerCase(), servidor = sitioDe(r);
      const usuario = recorta(r.user_name || r.preferred_username || r.email || r.sub || r.user_id || '', 200), nombre = recorta(r.name || [r.given_name, r.family_name].filter(Boolean).join(' ') || '', 200);
      q.corre("INSERT INTO aconex_cuentas (email, usuario, nombre, servidor, refresco, conectada, renovada, error) VALUES (?,?,?,?,?,?,'','') ON CONFLICT(email) DO UPDATE SET usuario = excluded.usuario, nombre = excluded.nombre, servidor = excluded.servidor, refresco = excluded.refresco, conectada = excluded.conectada, renovada = '', error = ''",
        email, usuario, nombre, servidor, cifra(t.refresh_token), ahora());
      FICHAS.set(email, { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000, servidor });
      audita(req.quien, 'aconex.conectar', pid || '', usuario, {}); a('conectado');
    } catch (e) { a('error:' + String(e.message).slice(0, 200)); }
  });
  /** Comprueba, desde el servidor, que Oracle acepte la aplicacion. Nunca devuelve el secreto. */
  app.get('/api/aconex/diagnostico', requiereSesion, async (req, res) => {
    const d = { configurado: configurado(), app: configurado() ? String(process.env.ACONEX_CLIENT_ID).trim().slice(-4) : '', retorno: retorno(req), lobby: lobby(), servidor: servidorDe(null), credenciales: null, detalle: '' };
    if (!d.configurado) return res.json(d);
    try {
      // con un codigo inventado, Oracle contesta «invalid_grant» si reconoce la aplicacion e «invalid_client» si no
      const r = await fetch(lobby() + '/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basica(), Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: 'diagnostico-cde', redirect_uri: d.retorno }) });
      const t = await r.json().catch(() => ({})), e = String(t.error || '');
      d.credenciales = e === 'invalid_client' || r.status === 401 ? false : true;
      d.detalle = d.credenciales ? (e === 'invalid_grant' || e === 'invalid_request' ? '' : 'Oracle respondió ' + r.status + (e ? ' (' + e + ')' : '') + '.') : 'Oracle no reconoce el Client ID y el secreto' + (t.error_description ? ': ' + t.error_description : '.');
      if (/redirect/i.test(String(t.error_description || ''))) d.detalle = 'Oracle no acepta la dirección de retorno ' + d.retorno + ': regístrala en la aplicación del Lobby.';
    } catch (e) { d.detalle = 'No se pudo hablar con Oracle: ' + e.message; }
    res.json(d);
  });
  app.post('/api/aconex/desconectar', requiereSesion, (req, res) => { const e = String(req.quien).toLowerCase(); q.corre('DELETE FROM aconex_cuentas WHERE email = ?', e); FICHAS.delete(e); audita(req.quien, 'aconex.desconectar', '', '', {}); res.json({ ok: true }); });
  app.get('/api/aconex/proyectos', requiereSesion, async (req, res) => { try { res.json(proyectosDe(await acxTexto('/api/projects', req.quien))); } catch (e) { fallo(res, e); } });
  /** Vista previa de lo que trae un filtro (las primeras 25 coincidencias y el total). */
  app.get('/api/aconex/proyectos/:acx/documentos', requiereSesion, async (req, res) => {
    try {
      const qs = new URLSearchParams({ return_fields: 'docno,title,revision,filename,fileSize,statusid,doctype,discipline,registered', search_type: 'PAGED', page_size: '25', page_number: '1', sort_field: 'docno' }); if (req.query.filtro) qs.set('search_query', String(req.query.filtro).slice(0, 500));
      const t = await acxTexto('/api/projects/' + encodeURIComponent(req.params.acx) + '/register?' + qs, req.quien), total = Number((/TotalResults\s*=\s*"(\d+)"/i.exec(t) || [])[1]) || 0;
      res.json({ total, documentos: documentosDe(t) });
    } catch (e) { fallo(res, e); }
  });

  // ───────── DOCUMENTOS: enlaces registro de Aconex -> carpeta del CDE
  const TRABAJOS = new Map();
  const abre = (e) => e && Object.assign(e, { resumen: json(e.resumen, {}), automatico: !!e.automatico, trabajo: (() => { const t = TRABAJOS.get(e.id); return t ? { estado: t.estado, fase: t.fase, total: t.total, hechos: t.hechos, nuevos: t.nuevos, iguales: t.iguales, errores: t.errores, pendientes: t.pendientes, actual: t.actual } : null; })() });
  const enlaceDe = (pid, eid) => abre(q.uno("SELECT * FROM aconex_enlaces WHERE proyecto_id = ? AND id = ? AND quitado = ''", pid, eid));
  const P = '/api/proyectos/:pid/aconex';
  function organizacionPara(p, u, carpeta) {
    const cand = [...new Set([String(u.organizacion || '').toUpperCase()].concat(Object.values(p.config.partes || {}).map(x => String(x).toUpperCase()), ['CONTRATISTA', 'SUPERVISION', 'ANIN']).filter(Boolean))];
    return cand.find(org => I.permisoEn(p, { email: 'complemento:aconex', rol: 'document-control', organizacion: org, admin: false }, carpeta).subir) || (
      // carpetas sin permisos dados (p. ej. una estructura recien copiada): si quien enlaza es gestor o administrador, se trae a su nombre
      (u.admin || u.rol === 'gestor' || u.rol === 'administrador') ? String(u.organizacion || (p.config.partes || {}).cliente || 'ANIN').toUpperCase() : '');
  }
  const puedeTocar = (req, e) => { const p = I.proyecto(req.pid), u = I.yo(req, p); return u.admin || u.rol === 'gestor' || u.rol === 'administrador' || e.por === u.email; };
  app.get(P + '/enlaces', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos("SELECT * FROM aconex_enlaces WHERE proyecto_id = ? AND quitado = '' ORDER BY creado DESC", req.pid).map(abre);
    const n = new Map(q.todos("SELECT enlace_id, SUM(CASE WHEN estado = 'traido' THEN 1 ELSE 0 END) AS traidos, SUM(CASE WHEN estado = 'error' THEN 1 ELSE 0 END) AS errores, COUNT(DISTINCT CASE WHEN estado = 'traido' THEN item END) AS documentos, COUNT(DISTINCT CASE WHEN estado = 'nomenclatura' THEN item END) AS pendientes FROM aconex_items WHERE proyecto_id = ? GROUP BY enlace_id", req.pid).map(x => [x.enlace_id, x]));
    L.forEach(e => { const x = n.get(e.id) || {}; Object.assign(e, { traidos: x.traidos || 0, conError: x.errores || 0, documentos: x.documentos || 0, pendientes: x.pendientes || 0 }); });
    const p = I.proyecto(req.pid), u = I.yo(req, p), v = q.uno('SELECT * FROM aconex_vinculos WHERE proyecto_id = ?', req.pid);
    const cuentas = { correos: (q.uno('SELECT COUNT(*) AS n FROM aconex_correos WHERE proyecto_id = ?', req.pid) || {}).n || 0, registro: (q.uno('SELECT COUNT(*) AS n FROM aconex_registro WHERE proyecto_id = ?', req.pid) || {}).n || 0 };
    res.json({ enlaces: L, vinculo: v || null, cuentas, puedoCrear: (ISO.RANGO_ROL[ISO.familia(u.rol)] || 0) >= 1 || u.admin, soyGestor: u.admin || u.rol === 'gestor' || u.rol === 'administrador', puedoCorreo: u.admin || (ISO.RANGO_ROL[u.rol] || 0) >= 1, yo: u.email });
  });
  app.post(P + '/enlaces', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const b = req.body || {}, p = I.proyecto(req.pid), u = I.yo(req, p), carpetaCde = CAR.limpia(b.carpetaCde);
      if (!b.acxProyecto) throw err('Elige el proyecto de Aconex.', 'datos');
      if (!carpetaCde || !CAR.def(p.config.carpetas, carpetaCde)) throw err('Elige la carpeta del CDE donde se cargará.', 'datos');
      if (!u.admin && !I.permisoEn(p, u, carpetaCde).subir) throw err('No tienes permiso de carga en ' + carpetaCde + '.', 'sin-permiso', 403);
      const org = organizacionPara(p, u, carpetaCde); if (!org) throw err('Nadie tiene permiso de carga en ' + carpetaCde + ': la carpeta no tiene permisos asignados. Asígnalos en Documentos de proyecto → Permisos → Agregar permisos, o pide a un gestor del proyecto que cree el enlace.', 'sin-permiso', 403);
      await ficha(req.quien);
      const filtro = String(b.filtro || '').trim().slice(0, 500);
      if (q.uno("SELECT 1 FROM aconex_enlaces WHERE proyecto_id = ? AND acx_proyecto = ? AND filtro = ? AND carpeta_cde = ? AND quitado = ''", req.pid, String(b.acxProyecto), filtro, carpetaCde)) throw err('Ese registro de Aconex (con ese filtro) ya está enlazado con esa carpeta del CDE.', 'repetido', 409);
      const eid = id('ae');
      q.corre('INSERT INTO aconex_enlaces (id, proyecto_id, acx_proyecto, acx_nombre, filtro, carpeta_cde, organizacion, versiones, nombrar, automatico, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        eid, req.pid, String(b.acxProyecto).slice(0, 40), String(b.acxNombre || '').slice(0, 200), filtro, carpetaCde, org, b.versiones === 'todas' ? 'todas' : 'ultima', b.nombrar === 'archivo' ? 'archivo' : 'numero', b.automatico ? 1 : 0, String(req.quien).toLowerCase(), ahora());
      audita(req.quien, 'aconex.enlace', req.pid, String(b.acxNombre || b.acxProyecto), { destino: carpetaCde, filtro });
      arranca(enlaceDe(req.pid, eid), req.socket.localPort); res.json({ ok: true, id: eid });
    } catch (e) { fallo(res, e); }
  });
  app.put(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid), b = req.body || {}; if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo modifica quien creó el enlace o un gestor.' });
    q.corre('UPDATE aconex_enlaces SET automatico = ?, versiones = ?, nombrar = ? WHERE id = ?', b.automatico === undefined ? (e.automatico ? 1 : 0) : (b.automatico ? 1 : 0), b.versiones === 'ultima' || b.versiones === 'todas' ? b.versiones : e.versiones, b.nombrar === 'archivo' || b.nombrar === 'numero' ? b.nombrar : e.nombrar, e.id);
    res.json({ ok: true });
  });
  app.post(P + '/enlaces/:eid/sincronizar', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
      if (!puedeTocar(req, e)) throw err('Lo sincroniza quien creó el enlace o un gestor.', 'sin-permiso', 403);
      if ((TRABAJOS.get(e.id) || {}).estado === 'corriendo') throw err('Ya se está sincronizando.', 'ocupado', 409);
      await ficha(req.quien);
      if ((req.body || {}).reintentar) q.corre("DELETE FROM aconex_items WHERE enlace_id = ? AND estado = 'error'", e.id);
      arranca(e, req.socket.localPort, String(req.quien).toLowerCase()); res.json({ ok: true });
    } catch (x) { fallo(res, x); }
  });
  app.post(P + '/enlaces/:eid/detener', requiereSesion, requiereRol('autor'), (req, res) => { const e = enlaceDe(req.pid, req.params.eid), t = e && TRABAJOS.get(e.id); if (!e) return res.status(404).json({ error: 'no-existe' }); if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso' }); if (t) t.parar = true; res.json({ ok: true }); });
  app.get(P + '/enlaces/:eid/items', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    res.json({ enlace: e, items: q.todos("SELECT id, item, documento, revision, titulo, nombre, nombre_cde, tamano, fecha_acx, contenedor_id, n_cde, estado, detalle, fecha FROM aconex_items WHERE enlace_id = ? ORDER BY (estado = 'error') DESC, (estado = 'nomenclatura') DESC, item, id LIMIT 10000", e.id) });
  });
  app.get(P + '/enlaces/:eid/pendientes', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    const L = q.todos("SELECT item, MAX(nombre_cde) AS nombre, MAX(tamano) AS tamano, MAX(titulo) AS titulo, MAX(revision) AS revision, detalle FROM aconex_items WHERE enlace_id = ? AND estado = 'nomenclatura' GROUP BY item ORDER BY item", e.id);
    res.json({ enlace: e, pendientes: L.map(x => Object.assign(x, { carpeta: e.carpeta_cde })) });
  });
  app.post(P + '/enlaces/:eid/nombres', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo completa quien creó el enlace o un gestor.' });
    const p = I.proyecto(req.pid), malos = [], buenos = [];
    for (const a of (Array.isArray((req.body || {}).asignaciones) ? req.body.asignaciones : []).slice(0, 5000)) {
      if (!q.uno('SELECT 1 FROM aconex_items WHERE enlace_id = ? AND item = ? LIMIT 1', e.id, String(a.item || ''))) continue;
      const nombre = require('path').basename(String(a.nombre || '').replace(/\\/g, '/')).slice(0, 250), val = NOM.valida(p.config, e.carpeta_cde, nombre);
      if (!val.ok) { malos.push({ item: a.item, nombre, errores: val.errores }); continue; }
      q.corre('INSERT INTO aconex_nombres (enlace_id, item, nombre, revision, idoneidad, atributos, por, fecha) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(enlace_id, item) DO UPDATE SET nombre = excluded.nombre, revision = excluded.revision, idoneidad = excluded.idoneidad, atributos = excluded.atributos, por = excluded.por, fecha = excluded.fecha',
        e.id, String(a.item), nombre, String(a.revision || '').toUpperCase().slice(0, 8), String(a.idoneidad || '').toUpperCase().slice(0, 4), JSON.stringify(a.atributos && typeof a.atributos === 'object' ? a.atributos : {}).slice(0, 20000), String(req.quien).toLowerCase(), ahora());
      q.corre("DELETE FROM aconex_items WHERE enlace_id = ? AND item = ? AND estado IN ('nomenclatura','error')", e.id, String(a.item)); buenos.push(a.item);
    }
    if (buenos.length) { audita(req.quien, 'aconex.nombres', req.pid, e.acx_nombre, { documentos: buenos.length }); arranca(e, req.socket.localPort, String(req.quien).toLowerCase()); }
    res.json({ ok: true, aceptados: buenos.length, rechazados: malos });
  });
  app.delete(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo quita quien creó el enlace o un gestor.' });
    const t = TRABAJOS.get(e.id); if (t) t.parar = true;
    q.corre('UPDATE aconex_enlaces SET quitado = ?, automatico = 0 WHERE id = ?', ahora(), e.id); audita(req.quien, 'aconex.enlace.quitar', req.pid, e.acx_nombre, {}); res.json({ ok: true });
  });

  const anota = (e, d, estado, detalle, extra) => q.corre('INSERT INTO aconex_items (enlace_id, proyecto_id, item, documento, revision, titulo, nombre, nombre_cde, tamano, fecha_acx, contenedor_id, n_cde, estado, detalle, fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(enlace_id, documento) DO UPDATE SET estado = excluded.estado, detalle = excluded.detalle, nombre_cde = excluded.nombre_cde, contenedor_id = excluded.contenedor_id, n_cde = excluded.n_cde, fecha = excluded.fecha',
    e.id, e.proyecto_id, d.clave, d.id, d.revision, d.titulo, d.archivo, (extra && extra.nombre) || nombreCde(e, d), d.tamano, d.fecha, (extra && extra.cid) || '', (extra && extra.n) || 0, estado, String(detalle || '').slice(0, 500), ahora());
  /** El nombre con el que entra al CDE: el Nº de documento con la extension del archivo (o el nombre del archivo). */
  function nombreCde(e, d) {
    const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(d.archivo || '') || [])[1] || '';
    if (e.nombrar === 'archivo' || !d.numero) return d.archivo || (d.numero + (ext ? '.' + ext : ''));
    const num = d.numero.replace(/[\/\\:*?"<>|]/g, '_').trim(); return ext && !num.toLowerCase().endsWith('.' + ext.toLowerCase()) ? num + '.' + ext : num;
  }
  async function carga(e, d, email, puerto, cde) {
    if (!d.archivo) return anota(e, d, 'omitido', 'El documento de Aconex no tiene archivo (marcador de posición).');
    if (d.tamano > MAX_MB * 1048576) return anota(e, d, 'omitido', 'Pesa más de ' + MAX_MB + ' MB (límite ACONEX_MAX_MB).');
    const archivo = await acx('/api/projects/' + encodeURIComponent(e.acx_proyecto) + '/register/' + encodeURIComponent(d.id), email);
    if (!archivo.body) throw err('Aconex no entregó el archivo.', 'aconex');
    const meta = { aconex: { proyecto: e.acx_nombre || e.acx_proyecto, documento: d.id, numero: d.numero, revision: d.revision, titulo: d.titulo, estado: d.estado, tipo: d.tipo, disciplina: d.disciplina, archivoOriginal: d.archivo, fecha: d.fecha, traidoPor: email } };
    const atr = Object.assign({}, d.titulo ? { descripcion: d.titulo } : {}, cde.atributos || {}); if (Object.keys(atr).length) meta.atributos = atr;
    const sube = async (cuerpo, conRevision) => {
      const r = await fetch('http://127.0.0.1:' + (puerto || ctx.puerto) + '/api/proyectos/' + e.proyecto_id + '/subir?origen=aconex&organizacion=' + encodeURIComponent(e.organizacion) + '&carpeta=' + encodeURIComponent(e.carpeta_cde) + (conRevision && cde.revision ? '&revision=' + encodeURIComponent(cde.revision) : '') + (cde.idoneidad ? '&idoneidad=' + encodeURIComponent(cde.idoneidad) : ''),
        { method: 'POST', headers: { 'x-cde-llave': ctx.llaveInterna, 'x-cde-por': email, 'x-nombre': encodeURIComponent(cde.nombre), 'x-meta': encodeURIComponent(JSON.stringify(meta)) }, body: cuerpo, duplex: 'half' });
      return { r, j: await r.json().catch(() => ({})) };
    };
    // la revision de Aconex entra como revision del CDE si tiene la forma de la norma (R00, C01…); si no, queda en los metadatos
    let { r, j } = await sube(Readable.fromWeb(archivo.body), true);
    if (!r.ok && cde.revision && j.error === 'revision') { const otra = await acx('/api/projects/' + encodeURIComponent(e.acx_proyecto) + '/register/' + encodeURIComponent(d.id), email); ({ r, j } = await sube(Readable.fromWeb(otra.body), false)); }
    if (!r.ok) throw err(j.mensaje || j.error || ('El CDE no aceptó el archivo (' + r.status + ').'), 'cde');
    anota(e, d, 'traido', '', { cid: (j.contenedor && j.contenedor.id) || j.contenedor || '', n: Number(j.n) || 0, nombre: cde.nombre }); return true;
  }
  async function sincroniza(e, email, puerto, t) {
    t.fase = 'leyendo';
    const qs = new URLSearchParams({ return_fields: 'docno,title,revision,filename,fileSize,statusid,doctype,discipline,registered', sort_field: 'docno' });
    if (e.filtro) qs.set('search_query', e.filtro); if (e.versiones === 'todas') qs.set('show_document_history', 'true');
    const docs = await todasLasPaginas('/api/projects/' + encodeURIComponent(e.acx_proyecto) + '/register?' + qs, email, documentosDe, 100);
    // un documento = su Nº de documento; sus revisiones, en el orden en que se registraron
    const grupos = new Map(); for (const d of docs) { d.clave = d.numero || ('id:' + d.id); if (!grupos.has(d.clave)) grupos.set(d.clave, []); grupos.get(d.clave).push(d); }
    t.fase = 'trayendo'; t.total = grupos.size; let i = 0;
    const pc = I.proyecto(e.proyecto_id), ret = !!(pc.config.conformidad && pc.config.conformidad.areaRetencion);
    for (const [clave, vs] of grupos) {
      if (t.parar) break; t.hechos = ++i; vs.sort((a, b) => compId(a.id, b.id));
      try {
        const asig = q.uno('SELECT nombre, revision, idoneidad, atributos FROM aconex_nombres WHERE enlace_id = ? AND item = ?', e.id, clave);
        let pend = vs.filter(d => !q.uno("SELECT 1 FROM aconex_items WHERE enlace_id = ? AND documento = ? AND estado IN ('traido','omitido')", e.id, d.id));
        const yaHay = vs.some(d => q.uno("SELECT 1 FROM aconex_items WHERE enlace_id = ? AND documento = ? AND estado = 'traido'", e.id, d.id));
        if (yaHay) { const ult = Math.max(...vs.map((d, k) => q.uno("SELECT 1 FROM aconex_items WHERE enlace_id = ? AND documento = ? AND estado = 'traido'", e.id, d.id) ? k : -1)); pend = pend.filter(d => vs.indexOf(d) > ult); }   // nada anterior a lo ya traido
        if (asig && pend.length > 1) { pend.slice(0, -1).forEach(d => anota(e, d, 'omitido', 'Revisión anterior de Aconex: con el nombre asignado en la rejilla entra solo la vigente (' + (pend[pend.length - 1].revision || 'última') + ').', { nombre: asig.nombre })); pend = pend.slice(-1); }
        let nuevo = false, tropiezo = false;
        for (const d of pend) {
          if (t.parar) break;
          if (!d.archivo) { anota(e, d, 'omitido', 'El documento de Aconex no tiene archivo (marcador de posición).'); continue; }
          const ult = d === pend[pend.length - 1], revAcx = String(d.revision || '').toUpperCase();
          const cde = asig ? { nombre: asig.nombre, atributos: json(asig.atributos, {}), revision: ult ? (asig.revision || (ISO.RX_REVISION.test(revAcx) ? revAcx : '')) : '', idoneidad: ult ? asig.idoneidad : '' }
            : { nombre: nombreCde(e, d), revision: ISO.RX_REVISION.test(revAcx) ? revAcx : '' };
          const val = NOM.valida(pc.config, e.carpeta_cde, cde.nombre);
          if (!val.ok && !(ret && val.extension)) { anota(e, d, 'nomenclatura', (val.errores || []).join(' · ') || 'No cumple la nomenclatura de la carpeta.', { nombre: cde.nombre }); tropiezo = true; t.pendientes++; break; }
          t.actual = (d.numero || d.archivo) + (d.revision ? ' (rev. ' + d.revision + ')' : '');
          try { if (await carga(e, d, email, puerto, cde)) { t.nuevos++; nuevo = true; } }
          catch (x) { t.errores++; tropiezo = true; anota(e, d, 'error', x.message, { nombre: cde.nombre }); if (x.codigo === 'aconex-sin-conexion') throw x; break; }
        }
        if (!nuevo && !tropiezo) t.iguales++;
      } catch (x) { if (x.codigo === 'aconex-sin-conexion') throw x; t.errores++; }
    }
  }
  function arranca(e, puerto, comoQuien) {
    if (!e || (TRABAJOS.get(e.id) || {}).estado === 'corriendo') return null;
    const t = { estado: 'corriendo', fase: 'leyendo', total: 0, hechos: 0, nuevos: 0, iguales: 0, errores: 0, pendientes: 0, actual: '', inicio: Date.now(), parar: false }; TRABAJOS.set(e.id, t);
    const email = comoQuien || e.por;
    t.promesa = (async () => {
      let error = '';
      try { await sincroniza(e, email, puerto, t); } catch (x) { error = x.message; }
      t.estado = error ? 'error' : t.parar ? 'detenido' : 'listo'; t.actual = '';
      const resumen = { documentos: t.total, nuevos: t.nuevos, sinCambios: t.iguales, pendientes: t.pendientes, errores: t.errores, segundos: Math.round((Date.now() - t.inicio) / 1000), detenido: !!t.parar, por: email };
      q.corre('UPDATE aconex_enlaces SET ultimo = ?, resumen = ?, error = ? WHERE id = ?', ahora(), JSON.stringify(resumen), String(error).slice(0, 300), e.id);
      audita(email, 'aconex.sincronizar', e.proyecto_id, e.acx_nombre, resumen);
      setTimeout(() => { if (TRABAJOS.get(e.id) === t) TRABAJOS.delete(e.id); }, 120000).unref();
    })();
    return t;
  }

  // ───────── CORREO y REGISTRO
  const guardaCorreo = (pid, acxP, m, origen, por) => {
    const r = q.corre('INSERT INTO aconex_correos (proyecto_id, acx_proyecto, mail_id, numero, buzon, asunto, tipo, de, org, para, fecha, vence, estado, motivo, referencia, contrato, respondido, adjuntos, origen, importado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
      "ON CONFLICT(proyecto_id, numero) DO UPDATE SET acx_proyecto = CASE WHEN excluded.acx_proyecto <> '' THEN excluded.acx_proyecto ELSE acx_proyecto END, mail_id = CASE WHEN excluded.mail_id <> '' THEN excluded.mail_id ELSE mail_id END, " +
      "buzon = CASE WHEN buzon <> '' AND excluded.buzon <> '' AND buzon <> excluded.buzon THEN 'ambos' WHEN excluded.buzon <> '' THEN excluded.buzon ELSE buzon END, asunto = excluded.asunto, tipo = excluded.tipo, de = excluded.de, org = excluded.org, " +
      "para = CASE WHEN excluded.para <> '' THEN excluded.para ELSE para END, fecha = excluded.fecha, vence = excluded.vence, estado = excluded.estado, motivo = CASE WHEN excluded.motivo <> '' THEN excluded.motivo ELSE motivo END, referencia = CASE WHEN excluded.referencia <> '' THEN excluded.referencia ELSE referencia END, contrato = CASE WHEN excluded.contrato <> '' THEN excluded.contrato ELSE contrato END, respondido = CASE WHEN excluded.respondido <> '' THEN excluded.respondido ELSE respondido END, adjuntos = MAX(adjuntos, excluded.adjuntos), origen = excluded.origen, importado = excluded.importado, por = excluded.por",
      pid, acxP || '', m.mailId || '', recorta(m.numero || ('SIN-NUMERO-' + crypto.createHash('sha1').update((m.asunto || '') + (m.fecha || '')).digest('hex').slice(0, 8)), 120), m.buzon || '', recorta(m.asunto, 500), recorta(m.tipo, 120), recorta(m.de, 160), recorta(m.org, 200), recorta(m.para, 2000),
      dia(m.fecha), dia(m.vence), recorta(m.estado, 80), recorta(m.motivo, 120), recorta(m.referencia, 120), recorta(m.contrato, 160), dia(m.respondido), Number(m.adjuntos) || 0, origen, ahora(), por);
    return r;
  };
  const guardaRegistro = (pid, acxP, d, origen, por) => q.corre('INSERT INTO aconex_registro (proyecto_id, acx_proyecto, documento, numero, revision, titulo, tipo, estado, disciplina, fecha, archivo, tamano, origen, importado, por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(proyecto_id, numero) DO UPDATE SET acx_proyecto = excluded.acx_proyecto, documento = excluded.documento, revision = excluded.revision, titulo = excluded.titulo, tipo = excluded.tipo, estado = excluded.estado, disciplina = excluded.disciplina, fecha = excluded.fecha, archivo = excluded.archivo, tamano = excluded.tamano, origen = excluded.origen, importado = excluded.importado, por = excluded.por',
    pid, acxP || '', recorta(d.id || '', 40), recorta(d.numero, 200), recorta(d.revision, 30), recorta(d.titulo, 400), recorta(d.tipo, 80), recorta(d.estado, 80), recorta(d.disciplina, 80), dia(d.fecha), recorta(d.archivo, 250), Number(d.tamano) || 0, origen, ahora(), por);
  const vincula = (pid, acxP, nombre, por) => q.corre("INSERT INTO aconex_vinculos (proyecto_id, acx_proyecto, acx_nombre, por) VALUES (?,?,?,?) ON CONFLICT(proyecto_id) DO UPDATE SET acx_proyecto = excluded.acx_proyecto, acx_nombre = excluded.acx_nombre, por = excluded.por", pid, String(acxP).slice(0, 40), String(nombre || '').slice(0, 200), por);
  async function traeCorreo(pid, acxP, email) {
    const campos = 'docno,subject,sentdate,corrtypeid,fromUserDetails,mailRecipients,reasonforissueid,responsedate,tostatusid,inreftomailno,allAttachmentCount';
    const n = { inbox: 0, sentbox: 0 };
    for (const buzon of ['inbox', 'sentbox']) {
      const L = await todasLasPaginas('/api/projects/' + encodeURIComponent(acxP) + '/mail?mail_box=' + buzon + '&return_fields=' + campos + '&sort_field=sentdate&sort_direction=DESC', email, (t) => correosDe(t, buzon === 'inbox' ? 'entrada' : 'enviados'), 60, { Accept: 'application/vnd.aconex.mail.v2+xml' });
      BD.db.exec('BEGIN'); try { L.forEach(m => guardaCorreo(pid, acxP, m, 'api', email)); BD.db.exec('COMMIT'); } catch (x) { BD.db.exec('ROLLBACK'); throw x; }
      n[buzon] = L.length;
    }
    q.corre('UPDATE aconex_vinculos SET correo_ultimo = ?, error = \'\' WHERE proyecto_id = ?', ahora(), pid);
    return n;
  }
  async function leeRegistro(pid, acxP, email) {
    const L = await todasLasPaginas('/api/projects/' + encodeURIComponent(acxP) + '/register?return_fields=docno,title,revision,filename,fileSize,statusid,doctype,discipline,registered&sort_field=docno', email, documentosDe, 100);
    BD.db.exec('BEGIN'); try { L.filter(d => d.numero).forEach(d => guardaRegistro(pid, acxP, d, 'api', email)); BD.db.exec('COMMIT'); } catch (x) { BD.db.exec('ROLLBACK'); throw x; }
    q.corre('UPDATE aconex_vinculos SET registro_ultimo = ?, error = \'\' WHERE proyecto_id = ?', ahora(), pid);
    return L.length;
  }
  const verCorreo = requiereRol('autor');
  app.post(P + '/correo/traer', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const b = req.body || {}; if (!b.acxProyecto) throw err('Elige el proyecto de Aconex.', 'datos');
      vincula(req.pid, b.acxProyecto, b.acxNombre, String(req.quien).toLowerCase()); if (b.automatico !== undefined) q.corre('UPDATE aconex_vinculos SET automatico = ? WHERE proyecto_id = ?', b.automatico ? 1 : 0, req.pid);
      const n = await traeCorreo(req.pid, String(b.acxProyecto), req.quien);
      audita(req.quien, 'aconex.correo', req.pid, String(b.acxNombre || b.acxProyecto), n); res.json({ ok: true, entrada: n.inbox, enviados: n.sentbox });
    } catch (e) { q.corre('UPDATE aconex_vinculos SET error = ? WHERE proyecto_id = ?', String(e.message).slice(0, 300), req.pid); fallo(res, e); }
  });
  app.post(P + '/registro/leer', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const b = req.body || {}; if (!b.acxProyecto) throw err('Elige el proyecto de Aconex.', 'datos');
      vincula(req.pid, b.acxProyecto, b.acxNombre, String(req.quien).toLowerCase());
      const n = await leeRegistro(req.pid, String(b.acxProyecto), req.quien); audita(req.quien, 'aconex.registro', req.pid, String(b.acxNombre || b.acxProyecto), { documentos: n }); res.json({ ok: true, documentos: n });
    } catch (e) { fallo(res, e); }
  });
  /** Informes en Excel exportados de Aconex (leidos en el navegador): correo o registro de documentos. */
  app.post(P + '/importar', requiereSesion, requiereRol('autor'), JG, (req, res) => {
    const b = req.body || {}, filas = Array.isArray(b.filas) ? b.filas.slice(0, 50000) : [], tipo = b.tipo === 'documentos' ? 'documentos' : 'correo', por = String(req.quien).toLowerCase(); let n = 0;
    BD.db.exec('BEGIN');
    try {
      for (const f of filas) {
        if (!f || typeof f !== 'object') continue;
        if (tipo === 'correo') { if (!(f.numero || f.asunto)) continue; guardaCorreo(req.pid, '', f, 'excel', por); }
        else { if (!f.numero) continue; guardaRegistro(req.pid, '', f, 'excel', por); }
        n++;
      }
      BD.db.exec('COMMIT');
    } catch (e) { BD.db.exec('ROLLBACK'); return fallo(res, e); }
    audita(req.quien, 'aconex.importar', req.pid, String(b.archivo || '').slice(0, 200), { tipo, filas: n }); res.json({ ok: true, tipo, importados: n });
  });
  app.get(P + '/correo', requiereSesion, verCorreo, (req, res) => {
    res.json({ correos: q.todos('SELECT id, numero, buzon, asunto, tipo, de, org, para, fecha, vence, estado, motivo, referencia, contrato, respondido, adjuntos, origen, importado, mail_id <> \'\' AS api FROM aconex_correos WHERE proyecto_id = ? ORDER BY fecha DESC, numero DESC LIMIT 50000', req.pid), hoy: ahora().slice(0, 10) });
  });
  /** Un correo con su cuerpo: si vino por la API y aun no se leyo, se pide a Aconex (y queda guardado). */
  app.get(P + '/correo/:cid', requiereSesion, verCorreo, async (req, res) => {
    const c = q.uno('SELECT * FROM aconex_correos WHERE proyecto_id = ? AND id = ?', req.pid, Number(req.params.cid)); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!c.cuerpo && c.mail_id && c.acx_proyecto && cuentaDe(req.quien)) {
      try {
        const t = await acxTexto('/api/projects/' + encodeURIComponent(c.acx_proyecto) + '/mail/' + encodeURIComponent(c.mail_id), req.quien, { Accept: 'application/vnd.aconex.mail.v2+xml' });
        const cuerpo = xTexto(xCampo(t, ['MailData'])).slice(0, 200000), vence = dia(xValor(xCampo(t, ['ResponseRequired']), ['ResponseRequiredDate'])) || c.vence;
        const anexos = xBloques(xCampo(t, ['Attachments']), '[A-Za-z]*Attachment').map(a => ({ id: xAttr(a.attrs, 'AttachmentId') || xValor(a.cuerpo, ['AttachmentId']), nombre: xValor(a.cuerpo, ['FileName', 'Filename', 'Name', 'DocumentNo', 'Title']), tam: Number(xValor(a.cuerpo, ['FileSize'])) || 0 })).filter(a => a.nombre).slice(0, 200);
        q.corre('UPDATE aconex_correos SET cuerpo = ?, vence = ?, anexos = ? WHERE id = ?', cuerpo || '(sin texto)', vence, JSON.stringify(anexos), c.id); Object.assign(c, { cuerpo: cuerpo || '(sin texto)', vence, anexos: JSON.stringify(anexos) });
      } catch (e) { c.aviso = e.message; }
    }
    c.anexos = json(c.anexos, []); res.json(c);
  });
  app.delete(P + '/correo', requiereSesion, requiereRol('gestor'), (req, res) => { q.corre('DELETE FROM aconex_correos WHERE proyecto_id = ?', req.pid); audita(req.quien, 'aconex.correo.vaciar', req.pid, '', {}); res.json({ ok: true }); });
  app.delete(P + '/registro', requiereSesion, requiereRol('gestor'), (req, res) => { q.corre('DELETE FROM aconex_registro WHERE proyecto_id = ?', req.pid); audita(req.quien, 'aconex.registro.vaciar', req.pid, '', {}); res.json({ ok: true }); });
  /** El registro de Aconex cruzado con el CDE: cada Nº de documento, si ya existe en el CDE (mismo nombre base) y en que carpeta. */
  app.get(P + '/registro', requiereSesion, requiereRol('lector'), (req, res) => {
    const base = (s) => String(s || '').toUpperCase().replace(/\.[A-Z0-9]{1,8}$/, '').trim();
    const cde = new Map(q.todos("SELECT id, nombre, carpeta, estado, version_actual FROM contenedores WHERE proyecto_id = ? AND (borrado IS NULL OR borrado = '')", req.pid).map(c => [base(c.nombre), c]));
    // lo que trajo el conector entra con otro nombre si se completó la nomenclatura: también cuenta
    const porId = new Map([...cde.values()].map(c => [c.id, c])), traidos = new Map(q.todos("SELECT item, MAX(contenedor_id) AS cid FROM aconex_items WHERE proyecto_id = ? AND estado = 'traido' AND contenedor_id <> '' GROUP BY item", req.pid).map(x => [x.item, porId.get(x.cid)]));
    const L = q.todos('SELECT id, documento, numero, revision, titulo, tipo, estado, disciplina, fecha, archivo, tamano, origen, importado FROM aconex_registro WHERE proyecto_id = ? ORDER BY numero LIMIT 50000', req.pid)
      .map(r => { const c = traidos.get(r.numero) || cde.get(base(r.numero)) || cde.get(base(r.archivo)); return Object.assign(r, c ? { enCde: { id: c.id, carpeta: c.carpeta, estado: c.estado, version: c.version_actual } } : { enCde: null }); });
    res.json({ registro: L, enCde: L.filter(r => r.enCde).length });
  });

  // sincronizacion automatica: enlaces marcados y correo de los proyectos con «Traer correo automaticamente»
  const INTERVALO = Math.max(5, Number(process.env.ACONEX_INTERVALO_MIN) || 60);
  const reloj = setInterval(() => {
    if (!configurado()) return;
    try { q.todos("SELECT * FROM aconex_enlaces WHERE automatico = 1 AND quitado = ''").map(abre).forEach(e => arranca(e)); } catch (x) { console.error('conector Aconex:', x.message); }
    for (const v of q.todos('SELECT * FROM aconex_vinculos WHERE automatico = 1')) traeCorreo(v.proyecto_id, v.acx_proyecto, v.por).catch(x => q.corre('UPDATE aconex_vinculos SET error = ? WHERE proyecto_id = ?', String(x.message).slice(0, 300), v.proyecto_id));
  }, INTERVALO * 60000); reloj.unref();
  ctx.aconex = { arranca, TRABAJOS, enlaceDe };
}

module.exports = { monta, proyectosDe, documentosDe, correosDe };
