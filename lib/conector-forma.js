/*
 * CONECTOR AUTODESK FORMA -> CDE: trae al CDE lo que esta en Autodesk Forma (Docs), carpeta por carpeta y con sus versiones.
 *
 * Como funciona:
 *  1. CONECTAR. Cada usuario conecta su cuenta de Autodesk (OAuth de 3 patas, solo lectura: data:read). Es aparte del modo
 *     de acceso del CDE: sirve igual con acceso local, Microsoft o Autodesk. El permiso de renovacion se guarda cifrado.
 *  2. ENLAZAR. Un enlace une una carpeta de Forma con una carpeta del CDE: con o sin subcarpetas, todas las versiones o solo
 *     la vigente, una vez o con sincronizacion automatica.
 *  3. TRAER. Se recorre la carpeta de Forma, se baja cada version que falta (descarga firmada de OSS) y se carga en el CDE
 *     por la MISMA puerta que la web y los complementos (/subir), asi que valen la nomenclatura de la carpeta, los permisos,
 *     el lector de modelos IFC / RVT y los desencadenadores. Cada version de Forma queda como una version del documento.
 *  4. SINCRONIZAR. A mano («Sincronizar ahora»), sola cada FORMA_INTERVALO_MIN minutos para los enlaces automaticos, o al
 *     instante por webhook si el CDE tiene direccion publica (URL_PUBLICA).
 *
 * Solo usa APIs sin costo de Autodesk Platform Services (Authentication, Data Management, Webhooks); nada de Model Derivative.
 * La aplicacion APS (APS_CLIENT_ID / APS_CLIENT_SECRET) debe estar agregada como integracion en la cuenta de Forma y tener
 * registrada la direccion de retorno que muestra la pantalla del conector.
 */
'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');
const { q, ahora, id, audita, json } = require('./bd');
const CAR = require('./carpetas');
const ISO = require('./iso19650');
const NOM = require('./nomenclatura');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS forma_cuentas (
  email TEXT PRIMARY KEY, cuenta TEXT DEFAULT '', nombre TEXT DEFAULT '', refresco TEXT NOT NULL, conectada TEXT NOT NULL, error TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS forma_enlaces (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, hub TEXT NOT NULL, hub_nombre TEXT DEFAULT '', proyecto_forma TEXT NOT NULL, proyecto_nombre TEXT DEFAULT '',
  carpeta TEXT NOT NULL, carpeta_nombre TEXT DEFAULT '', carpeta_cde TEXT NOT NULL, organizacion TEXT DEFAULT '', subcarpetas INTEGER DEFAULT 1, versiones TEXT DEFAULT 'todas',
  automatico INTEGER DEFAULT 0, por TEXT NOT NULL, creado TEXT NOT NULL, ultimo TEXT DEFAULT '', resumen TEXT DEFAULT '{}', error TEXT DEFAULT '', quitado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_forma_enlaces ON forma_enlaces (proyecto_id, quitado);
CREATE TABLE IF NOT EXISTS forma_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, enlace_id TEXT NOT NULL, proyecto_id TEXT NOT NULL, item TEXT NOT NULL, version TEXT NOT NULL, n_forma INTEGER DEFAULT 0,
  nombre TEXT NOT NULL, ruta TEXT DEFAULT '', tamano INTEGER DEFAULT 0, autor TEXT DEFAULT '', fecha_forma TEXT DEFAULT '', contenedor_id TEXT DEFAULT '', n_cde INTEGER DEFAULT 0,
  estado TEXT NOT NULL, detalle TEXT DEFAULT '', fecha TEXT NOT NULL, UNIQUE (enlace_id, version));
CREATE INDEX IF NOT EXISTS ix_forma_items ON forma_items (enlace_id, estado);
CREATE TABLE IF NOT EXISTS forma_incidencias (
  proyecto_id TEXT NOT NULL, issue_id TEXT NOT NULL, incidencia_id TEXT NOT NULL, enlace_id TEXT DEFAULT '', display_id INTEGER DEFAULT 0, actualizado_forma TEXT DEFAULT '',
  estado_forma TEXT DEFAULT '', extra TEXT DEFAULT '{}', adjuntos TEXT DEFAULT '[]', comentarios TEXT DEFAULT '[]', fecha TEXT NOT NULL, PRIMARY KEY (proyecto_id, issue_id));
CREATE TABLE IF NOT EXISTS forma_nombres (
  enlace_id TEXT NOT NULL, item TEXT NOT NULL, nombre TEXT NOT NULL, revision TEXT DEFAULT '', idoneidad TEXT DEFAULT '', atributos TEXT DEFAULT '{}', por TEXT DEFAULT '', fecha TEXT NOT NULL, PRIMARY KEY (enlace_id, item));
`;

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express } = ctx, I = ctx.cdeInterno;
  require('./bd').db.exec(ESQUEMA);
  try { require('./bd').db.exec("ALTER TABLE forma_items ADD COLUMN nombre_cde TEXT DEFAULT ''"); } catch (e) {}
  try { require('./bd').db.exec('ALTER TABLE forma_enlaces ADD COLUMN incidencias INTEGER DEFAULT 1'); } catch (e) {}
  try { require('./bd').db.exec("ALTER TABLE forma_cuentas ADD COLUMN alcance TEXT DEFAULT ''"); } catch (e) {}          // permisos concedidos (data:read account:read)
  try { require('./bd').db.exec('ALTER TABLE forma_incidencias ADD COLUMN mapeo INTEGER DEFAULT 1'); } catch (e) {}      // v0.13.2: campos personalizados de Forma   // v0.13.1: tambien las incidencias de los documentos
  const J = express.json({ limit: '1mb' });
  /** Chincheta de una incidencia de Forma sobre la hoja del PDF. Forma guarda el punto como fraccion del ancho y del alto de la
   *  hoja, medido desde la esquina superior izquierda (lo mismo que usa el CDE). Solo hojas 2D; no pisa una chincheta que ya exista. */
  function ponPin(iid, extra, versionId) {
    const pos = extra && extra.posicion; if (!pos || extra.es3D || !versionId) return false;
    const x = Number(pos.x), y = Number(pos.y); if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return false;
    const i = q.uno('SELECT posicion FROM incidencias WHERE id = ?', iid); if (!i || json(i.posicion, {}).version_id) return false;
    const v = q.uno('SELECT archivo FROM versiones WHERE id = ?', versionId); if (!v || !/\.pdf$/i.test(v.archivo || '')) return false;
    const mh = /^\s*\(?\s*(\d+)\s*\)?\s*$/.exec(String(extra.hoja || '')), pag = mh ? Math.max(1, parseInt(mh[1], 10)) : 1;   // en un PDF la hoja viene como «(3)»
    q.corre('UPDATE incidencias SET posicion = ? WHERE id = ?', JSON.stringify({ version_id: versionId, pagina: pag, x, y, deForma: true }), iid); return true;
  }
  // las incidencias traidas antes de v0.16.0 reciben su chincheta al arrancar, sin esperar a la siguiente sincronizacion
  try { let n = 0; for (const f of q.todos("SELECT f.incidencia_id, f.extra, i.version_id FROM forma_incidencias f JOIN incidencias i ON i.id = f.incidencia_id WHERE i.version_id <> '' AND (i.posicion IS NULL OR i.posicion IN ('', '{}'))")) if (ponPin(f.incidencia_id, json(f.extra, {}), f.version_id)) n++; if (n) console.log('[forma] chinchetas de Forma colocadas: ' + n); } catch (e) { console.error('[forma] chinchetas:', e.message); }
  const SECRETO_WEBHOOK = process.env.FORMA_WEBHOOK_SECRET || '';
  // En pruebas, un servidor local hace de Autodesk (solo direcciones 127.0.0.1).
  const base = () => { const p = process.env.FORMA_APS_PRUEBA || ''; return /^http:\/\/127\.0\.0\.1:\d+$/.test(p) ? p : 'https://developer.api.autodesk.com'; };
  const perfil = () => { const p = process.env.FORMA_APS_PRUEBA || ''; return /^http:\/\/127\.0\.0\.1:\d+$/.test(p) ? p + '/userinfo' : 'https://api.userprofile.autodesk.com/userinfo'; };
  const configurado = () => !!(process.env.APS_CLIENT_ID && process.env.APS_CLIENT_SECRET);
  const retorno = (req) => process.env.APS_FORMA_CALLBACK || ((process.env.URL_PUBLICA || '').replace(/\/$/, '') || (req.protocol + '://' + req.get('host'))) + '/api/forma/vuelta';
  const basica = () => 'Basic ' + Buffer.from(String(process.env.APS_CLIENT_ID).trim() + ':' + String(process.env.APS_CLIENT_SECRET).trim()).toString('base64');
  const MAX_MB = Number(process.env.FORMA_MAX_MB) || 8192;
  const fallo = (res, e) => res.status(e.status || 400).json({ error: e.codigo || 'forma', mensaje: e.message });
  const err = (msg, codigo, status) => Object.assign(new Error(msg), { codigo, status });

  // ───────── el permiso de renovacion se guarda cifrado con el secreto de sesion del CDE
  const CLAVE = crypto.scryptSync(process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion', 'cde-anin-forma', 32);
  const cifra = (t) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv), b = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64url'); };
  const descifra = (t) => { try { const b = Buffer.from(String(t || ''), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', CLAVE, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch (e) { return ''; } };

  // ───────── fichas de acceso: una por usuario conectado, renovada cuando falta menos de un minuto para que venza
  const FICHAS = new Map(), RENOVANDO = new Map();
  async function pideFicha(cuerpo) {
    const r = await fetch(base() + '/authentication/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basica() }, body: new URLSearchParams(cuerpo) });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw err(t.error_description || t.developerMessage || ('Autodesk no entregó el acceso (' + r.status + ').'), 'forma-acceso'); return t;
  }
  async function ficha(email) {
    email = String(email || '').toLowerCase(); const f = FICHAS.get(email); if (f && f.vence > Date.now() + 60000) return f.token;
    if (RENOVANDO.has(email)) return RENOVANDO.get(email);
    const tarea = (async () => {
      const c = q.uno('SELECT * FROM forma_cuentas WHERE email = ?', email), ref = c && descifra(c.refresco);
      if (!ref) throw err('Conecta tu cuenta de Autodesk para usar el conector de Forma.', 'forma-sin-conexion', 409);
      try {
        const t = await pideFicha({ grant_type: 'refresh_token', refresh_token: ref });
        if (t.refresh_token) q.corre("UPDATE forma_cuentas SET refresco = ?, error = '' WHERE email = ?", cifra(t.refresh_token), email);   // Autodesk entrega uno nuevo en cada renovacion
        FICHAS.set(email, { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000 }); return t.access_token;
      } catch (e) { q.corre('UPDATE forma_cuentas SET error = ? WHERE email = ?', String(e.message).slice(0, 300), email); throw err('La conexión con Autodesk venció o fue revocada: vuelve a conectar la cuenta. (' + e.message + ')', 'forma-sin-conexion', 409); }
    })();
    RENOVANDO.set(email, tarea); try { return await tarea; } finally { RENOVANDO.delete(email); }
  }
  /** GET a la API de Autodesk con la ficha del usuario; espera y reintenta si Autodesk pide ir mas despacio (429). */
  async function aps(ruta, email, cab) {
    const url = /^https?:\/\//.test(ruta) ? ruta : base() + ruta;
    for (let intento = 0; ; intento++) {
      const r = await fetch(url, { headers: Object.assign({ Authorization: 'Bearer ' + await ficha(email) }, cab || {}) });
      if (r.status === 429 && intento < 4) { await new Promise(ok => setTimeout(ok, Math.min(30, Number(r.headers.get('retry-after')) || 2 * (intento + 1)) * 1000)); continue; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err(r.status === 403 ? 'Autodesk no permite ver ese contenido con tu cuenta (403). Revisa tus permisos en Forma y que la aplicación esté agregada como integración en la cuenta.' : r.status === 404 ? 'Autodesk no encuentra ese elemento (404).' : 'Autodesk respondió ' + r.status + ((j.errors && j.errors[0] && j.errors[0].detail) ? ': ' + j.errors[0].detail : '') + '.', 'forma', 502);
      return j;
    }
  }
  /** Todas las paginas de una lista de Data Management. */
  async function paginas(ruta, email, tope) {
    const todo = [], inc = []; let url = ruta, n = 0;
    while (url && n++ < (tope || 200)) { const j = await aps(url, email); (j.data || []).forEach(x => todo.push(x)); (j.included || []).forEach(x => inc.push(x)); const sig = j.links && j.links.next && j.links.next.href; url = sig && /^http:\/\/127\.0\.0\.1|^https:\/\/developer\.api\.autodesk\.com\//.test(sig) ? sig : ''; }
    return { data: todo, included: inc };
  }

  // ───────── conectar / desconectar la cuenta de Autodesk
  const cuentaDe = (email) => q.uno('SELECT email, cuenta, nombre, conectada, error, alcance FROM forma_cuentas WHERE email = ?', String(email || '').toLowerCase());
  app.get('/api/forma/estado', requiereSesion, (req, res) => { const c = cuentaDe(req.quien); res.json({ configurado: configurado(), app: configurado() ? String(process.env.APS_CLIENT_ID).trim().slice(-4) : '', retorno: retorno(req), conectado: !!c, cuenta: c ? { correo: c.cuenta, nombre: c.nombre, desde: c.conectada, error: c.error, sinNombres: !/account:read/.test(c.alcance || '') } : null, intervaloMin: INTERVALO, webhook: /^https:\/\//.test(process.env.URL_PUBLICA || '') }); });
  app.get('/api/forma/conectar', requiereSesion, async (req, res) => {
    if (!configurado()) return res.status(400).send('Falta configurar APS_CLIENT_ID y APS_CLIENT_SECRET en el archivo .env (o cde.env) de la carpeta del CDE.');
    const estado = crypto.randomBytes(18).toString('hex'), pid = String(req.query.pid || '').replace(/[^\w-]/g, '').slice(0, 60);
    if (req.query.sinComprobar !== '1') {
      const dg = await diagnostico(req).catch(() => null);
      if (dg && (dg.credenciales === false || dg.retornoOk === false)) return res.redirect('/?forma=' + encodeURIComponent('error:' + dg.detalle) + '#/' + (pid ? 'p/' + pid + '/puente' : ''));
    }
    res.cookie('cde_forma', estado + '.' + pid, { httpOnly: true, sameSite: 'lax', maxAge: 600000 });
    res.redirect(authorizeUrl(req, estado));
  });
  app.get('/api/forma/vuelta', requiereSesion, async (req, res) => {
    const [estado, pid] = String((req.cookies && req.cookies.cde_forma) || '').split('.'); res.clearCookie('cde_forma');
    const a = (msg) => res.redirect('/?forma=' + encodeURIComponent(msg) + '#/' + (pid ? 'p/' + pid + '/puente' : ''));
    try {
      if (req.query.error) return a('error:' + String(req.query.error_description || req.query.error).slice(0, 200));
      if (!estado || String(req.query.state || '') !== estado) return a('error:La respuesta de Autodesk no corresponde a esta sesión. Vuelve a pulsar «Conectar con Autodesk».');
      const t = await pideFicha({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: retorno(req) });
      if (!t.refresh_token) return a('error:Autodesk no entregó el permiso de renovación.');
      let p = {}; try { p = await (await fetch(perfil(), { headers: { Authorization: 'Bearer ' + t.access_token } })).json(); } catch (e) {}
      const email = String(req.quien).toLowerCase();
      q.corre("INSERT INTO forma_cuentas (email, cuenta, nombre, refresco, conectada, error, alcance) VALUES (?,?,?,?,?,'',?) ON CONFLICT(email) DO UPDATE SET cuenta = excluded.cuenta, nombre = excluded.nombre, refresco = excluded.refresco, conectada = excluded.conectada, error = '', alcance = excluded.alcance",
        email, String(p.email || '').slice(0, 200), String(p.name || ((p.given_name || '') + ' ' + (p.family_name || '')).trim()).slice(0, 200), cifra(t.refresh_token), ahora(), alcanceDe(t.access_token) || String(t.scope || ''));
      FICHAS.set(email, { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000 });
      audita(req.quien, 'forma.conectar', pid || '', String(p.email || ''), {}); a('conectado');
    } catch (e) { a('error:' + String(e.message).slice(0, 200)); }
  });
  /** De dónde salen las credenciales: del .env del CDE (o de su cde.env, donde la instalación guarda la configuración) o de variables de entorno de Windows. */
  function origenCredenciales() {
    const fs = require('fs'), path = require('path'), actual = String(process.env.APS_CLIENT_ID || '').trim();
    for (const n of ['.env', 'cde.env']) { try { const t = fs.readFileSync(path.join(__dirname, '..', n), 'utf8'), m = /^\s*APS_CLIENT_ID\s*=(.*)$/m.exec(t), v = m ? m[1].replace(/(^|\s)#.*$/, '').trim().replace(/^"(.*)"$/, '$1') : ''; if (v && v === actual) return 'archivo ' + n + ' del CDE'; } catch (e) {} }
    return 'variables de entorno de Windows (ni .env ni cde.env del CDE tienen APS_CLIENT_ID)';
  }
  /** data:read para carpetas, archivos e incidencias; account:read para los nombres de personas, empresas y roles del proyecto. */
  const ALCANCE = 'data:read account:read';
  const alcanceDe = (tok) => { try { const r = JSON.parse(Buffer.from(String(tok).split('.')[1] || '', 'base64url').toString('utf8')); return (Array.isArray(r.scope) ? r.scope : String(r.scope || '').split(/\s+/)).filter(Boolean).join(' '); } catch (e) { return ''; } };
  const authorizeUrl = (req, estado) => { const u = new URL(base() + '/authentication/v2/authorize'); u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', String(process.env.APS_CLIENT_ID).trim()); u.searchParams.set('redirect_uri', retorno(req)); u.searchParams.set('scope', ALCANCE); u.searchParams.set('state', estado); return u.toString(); };
  /** Comprueba con Autodesk, desde el servidor, las credenciales y la dirección de retorno. Nunca devuelve el secreto. */
  async function diagnostico(req) {
    const d = { configurado: configurado(), app: configurado() ? String(process.env.APS_CLIENT_ID).trim().slice(-4) : '', origen: configurado() ? origenCredenciales() : '', retorno: retorno(req), credenciales: null, retornoOk: null, detalle: '' };
    if (!d.configurado) return d;
    const idRaro = /\s|"|'/.test(process.env.APS_CLIENT_ID) || /\s|"|'/.test(process.env.APS_CLIENT_SECRET);
    try { await pideFicha({ grant_type: 'client_credentials', scope: 'data:read' }); d.credenciales = true; }
    catch (e) { d.credenciales = false; d.detalle = 'Autodesk no acepta el Client ID y el secreto: ' + e.message + (idRaro ? ' (el valor trae espacios o comillas)' : ''); return d; }
    try {
      let url = authorizeUrl(req, 'diagnostico'), r;
      for (let i = 0; i < 6; i++) {
        r = await fetch(url, { redirect: 'manual', headers: { 'accept-language': 'es' } });
        const loc = r.headers.get('location') || ''; if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).toString(); if (url.startsWith(d.retorno)) { r = null; break; } if (/request-error|error=|invalid/i.test(url)) break; const h = new URL(url).host; if (!(/(^|\.)autodesk\.com$/.test(new URL(url).hostname) || h === new URL(base()).host)) break; continue; } break;
      }
      const cuerpo = r && r.status === 200 ? (await r.text().catch(() => '')).slice(0, 4000) : '';
      d.retornoOk = url.startsWith(d.retorno) && !/[?&]error=/.test(url) ? true : !(/request-error|redirect_uri|invalid_request|invalid_client/i.test(url) || /request-error/i.test(cuerpo) || (r && r.status >= 400));
      d.destino = new URL(url).hostname + new URL(url).pathname;
      if (!d.retornoOk) d.detalle = 'Autodesk rechaza la dirección de retorno ' + d.retorno + ' para la aplicación con Client ID terminado en ' + d.app + '.';
    } catch (e) { d.detalle = 'No se pudo comprobar la dirección de retorno: ' + e.message; }
    return d;
  }
  app.get('/api/forma/diagnostico', requiereSesion, async (req, res) => { try { res.json(await diagnostico(req)); } catch (e) { fallo(res, e); } });
  app.post('/api/forma/desconectar', requiereSesion, (req, res) => { const e = String(req.quien).toLowerCase(); q.corre('DELETE FROM forma_cuentas WHERE email = ?', e); FICHAS.delete(e); audita(req.quien, 'forma.desconectar', '', '', {}); res.json({ ok: true }); });

  // ───────── navegar Forma desde el CDE: cuentas (hubs) -> proyectos -> carpetas
  app.get('/api/forma/hubs', requiereSesion, async (req, res) => { try { res.json((await paginas('/project/v1/hubs', req.quien)).data.map(h => ({ id: h.id, nombre: h.attributes.name, region: h.attributes.region || '' }))); } catch (e) { fallo(res, e); } });
  app.get('/api/forma/hubs/:hub/proyectos', requiereSesion, async (req, res) => { try { res.json((await paginas('/project/v1/hubs/' + encodeURIComponent(req.params.hub) + '/projects?page[limit]=200', req.quien)).data.map(p => ({ id: p.id, nombre: p.attributes.name })).sort((a, b) => a.nombre.localeCompare(b.nombre))); } catch (e) { fallo(res, e); } });
  app.get('/api/forma/proyectos/:proj/contenido', requiereSesion, async (req, res) => {
    try {
      const proj = encodeURIComponent(req.params.proj);
      const j = req.query.carpeta ? await paginas('/data/v1/projects/' + proj + '/folders/' + encodeURIComponent(req.query.carpeta) + '/contents?page[limit]=200', req.quien) : await paginas('/project/v1/hubs/' + encodeURIComponent(String(req.query.hub || '')) + '/projects/' + proj + '/topFolders', req.quien);
      res.json(j.data.map(x => ({ id: x.id, tipo: x.type === 'folders' ? 'carpeta' : 'archivo', nombre: x.attributes.displayName || x.attributes.name, modificado: x.attributes.lastModifiedTime || '', oculta: !!x.attributes.hidden })).filter(x => !x.oculta).sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre) : a.tipo === 'carpeta' ? -1 : 1)));
    } catch (e) { fallo(res, e); }
  });

  // ───────── copiar la ESTRUCTURA de un proyecto de Forma: su arbol de carpetas (sin archivos) y sus atributos personalizados
  // El estado se guarda en la base: si el servicio se reinicia a media copia, lo ya creado se conserva y la ventana lo dice.
  require('./bd').db.exec("CREATE TABLE IF NOT EXISTS forma_copias (proyecto_id TEXT PRIMARY KEY, estado TEXT NOT NULL, datos TEXT DEFAULT '{}', actualizado TEXT NOT NULL)");
  try { q.corre("UPDATE forma_copias SET estado = 'interrumpida' WHERE estado = 'en-curso'"); } catch (e) {}
  const COPIAS = new Map();   // proyecto del CDE -> estado en memoria de la copia en curso
  const anotaCopia = (pid, t) => { try { q.corre('INSERT INTO forma_copias (proyecto_id, estado, datos, actualizado) VALUES (?,?,?,?) ON CONFLICT(proyecto_id) DO UPDATE SET estado = excluded.estado, datos = excluded.datos, actualizado = excluded.actualizado', pid, t.estado, JSON.stringify(t), ahora()); } catch (e) {} };
  const slug = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'atr';
  const conTope = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('Forma no respondió a tiempo')), ms))]);   // una consulta colgada no detiene la copia
  async function copiaEstructura(pid, email, b, t) {
    const proj = String(b.proyecto || ''), hub = String(b.hub || ''), zonas = b.zonas && typeof b.zonas === 'object' ? b.zonas : {};
    const tops = (await paginas('/project/v1/hubs/' + encodeURIComponent(hub) + '/projects/' + encodeURIComponent(proj) + '/topFolders', email)).data;
    const raiz = tops.find(x => /^(project files|archivos de proyecto)$/i.test(x.attributes.name || '') || /^(project files|archivos de proyecto)$/i.test(x.attributes.displayName || '')) || tops.find(x => !(x.attributes && x.attributes.hidden));
    if (!raiz) throw err('No se encontró la carpeta «Archivos de proyecto» en ese proyecto de Forma.', 'sin-raiz');
    // las carpetas se crean por tandas mientras se lee Forma: lo leido queda guardado aunque la copia no llegue al final
    let pend = [];
    // Se anaden en bloque (una sola normalizacion por tanda): crear de una en una recorre toda la lista cada vez y, con miles de
    // carpetas, deja al servidor sin responder.
    const vuelca = async () => { if (!pend.length) return; const p = I.proyecto(pid), L = Array.isArray(p.config.carpetas) ? p.config.carpetas : [], hay = new Set(L.map(c => c.ruta));
      for (const c of pend.sort((m, n) => m.nivel - n.nivel)) { if (hay.has(c.ruta)) { t.existentes++; continue; } if (c.padre && !hay.has(c.padre)) { if (t.avisos.length < 20) t.avisos.push(c.ruta + ': no se creó (falta su carpeta padre).'); continue; }
        const z = c.nivel === 1 ? String(zonas[c.nombre] || '') : ''; L.push({ ruta: c.ruta, nota: c.nivel === 1 ? 'Estructura copiada de Autodesk Forma' : '', zona: ['wip', 'compartido', 'publicado', 'archivo'].includes(z) ? z : '', permisos: null }); hay.add(c.ruta); t.creadas++; }
      pend = []; p.config.carpetas = CAR.normaliza(L); I.guardaConfig(p); anotaCopia(pid, t); await new Promise(ok => setImmediate(ok)); };
    const conAtr = [raiz.id]; let nivelActual = [{ id: raiz.id, ruta: '', nivel: 0 }], total = 0;
    while (nivelActual.length && total < 6000) {   // nivel a nivel, varias carpetas a la vez
      const sig = []; let k = 0;
      const obrero = async () => { while (k < nivelActual.length) { const c = nivelActual[k++]; t.actual = c.ruta || 'Archivos de proyecto'; let j;
          try { j = await conTope(paginas('/data/v1/projects/' + encodeURIComponent(proj) + '/folders/' + encodeURIComponent(c.id) + '/contents?filter[type]=folders&page[limit]=200', email), 90000); } catch (e) { if (t.avisos.length < 20) t.avisos.push((c.ruta || 'raíz') + ': no se pudo leer (' + e.message + ')'); continue; }
          for (const x of j.data.filter(x => x.type === 'folders' && !(x.attributes && x.attributes.hidden))) { const nombre = nombreCarpeta(x.attributes.displayName || x.attributes.name), ruta = c.ruta ? c.ruta + '/' + nombre : nombre;
            pend.push({ ruta, padre: c.ruta, nombre, nivel: c.nivel + 1 }); total++; t.vistas = total; if (c.nivel < 1 && conAtr.length < 40) conAtr.push(x.id); if (c.nivel < 14) sig.push({ id: x.id, ruta, nivel: c.nivel + 1 }); } } };
      await Promise.all([obrero(), obrero(), obrero()]);
      sig.sort((m, n) => m.ruta.localeCompare(n.ruta, 'es', { numeric: true })); await vuelca(); nivelActual = sig;
    }
    await vuelca(); t.fase = 'atributos'; t.actual = 'Atributos personalizados'; anotaCopia(pid, t);
    // atributos personalizados: en la raiz y en las carpetas principales (en Forma los heredan las subcarpetas); con tope de tiempo
    const atrs = new Map(), tope = Date.now() + 90000;
    if (b.atributos !== false) for (const fid of conAtr) { if (Date.now() > tope) { t.avisos.push('La lectura de atributos tardó demasiado: se copiaron los leídos hasta ese momento.'); break; }
      try { const j = await conTope(aps('/bim360/docs/v1/projects/' + encodeURIComponent(proj.replace(/^b\./, '')) + '/folders/' + encodeURIComponent(fid) + '/custom-attribute-definitions?limit=200', email), 30000);
        for (const d of (j.results || [])) { const kk = String(d.name || '').trim().toLowerCase(); if (kk && !atrs.has(kk)) atrs.set(kk, { nombre: String(d.name).trim().slice(0, 60), tipo: d.type === 'date' ? 'fecha' : d.type === 'array' ? 'lista' : 'texto', valores: Array.isArray(d.arrayValues) ? d.arrayValues.map(v => String(v).slice(0, 80)) : [] }); }
      } catch (e) { if (!t.avisos.some(a => /atributos de Forma/.test(a))) t.avisos.push('No se pudieron leer los atributos de Forma (' + e.message + '). Las carpetas sí se copiaron.'); break; } }
    if (atrs.size) { const p = I.proyecto(pid); p.config.atributos = Array.isArray(p.config.atributos) ? p.config.atributos : [];
      for (const d of atrs.values()) { if (p.config.atributos.some(x => String(x.nombre).trim().toLowerCase() === d.nombre.toLowerCase())) continue; if (p.config.atributos.length >= 60) { t.avisos.push('El proyecto admite 60 atributos: quedaron fuera los restantes.'); break; }
        let aid = slug(d.nombre); if (p.config.atributos.some(x => x.id === aid)) aid = aid + '-' + (p.config.atributos.length + 1); p.config.atributos.push({ id: aid, nombre: d.nombre, tipo: d.tipo, descripcion: 'Atributo de Autodesk Forma', valores: d.valores.slice(0, 200), obligatorio: false }); t.atributos++; }
      I.guardaConfig(p); }
    audita(email, 'forma.estructura', pid, proj, { carpetas: t.creadas, atributos: t.atributos });
  }
  app.post('/api/proyectos/:pid/forma/estructura', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const b = req.body || {}; if (!b.hub || !b.proyecto) return res.status(400).json({ error: 'faltan', mensaje: 'Elige la cuenta y el proyecto de Forma.' });
    const en = COPIAS.get(req.pid); if (en && en.estado === 'en-curso') return res.status(409).json({ error: 'en-curso', mensaje: 'Ya se está copiando una estructura en este proyecto.' });
    const t = { estado: 'en-curso', fase: 'carpetas', vistas: 0, actual: '', creadas: 0, existentes: 0, atributos: 0, avisos: [], error: '', inicio: ahora() }; COPIAS.set(req.pid, t); anotaCopia(req.pid, t);
    copiaEstructura(req.pid, req.quien, b, t).then(() => { t.estado = 'lista'; }).catch(e => { t.estado = 'error'; t.error = e.message; }).finally(() => { t.actual = ''; t.fin = ahora(); anotaCopia(req.pid, t); });
    res.json({ ok: true });
  });
  app.get('/api/proyectos/:pid/forma/estructura', requiereSesion, requiereRol('lector'), (req, res) => {
    const m = COPIAS.get(req.pid); if (m) return res.json(m);
    const g = q.uno('SELECT * FROM forma_copias WHERE proyecto_id = ?', req.pid); if (!g) return res.json({ estado: '' });
    res.json(Object.assign(json(g.datos, {}), { estado: g.estado, actualizado: g.actualizado }));
  });

  // ───────── enlaces: carpeta de Forma -> carpeta del CDE
  const TRABAJOS = new Map();   // enlace -> { estado, fase, vistos, total, nuevos, iguales, errores, actual, inicio, parar }
  const abre = (e) => e && Object.assign(e, { resumen: json(e.resumen, {}), subcarpetas: !!e.subcarpetas, automatico: !!e.automatico, incidencias: e.incidencias === undefined || e.incidencias === null ? true : !!e.incidencias, trabajo: (() => { const t = TRABAJOS.get(e.id); return t ? { estado: t.estado, fase: t.fase, vistos: t.vistos, total: t.total, hechos: t.hechos, nuevos: t.nuevos, iguales: t.iguales, errores: t.errores, pendientes: t.pendientes, incidencias: t.inc ? t.inc.vistas : 0, actual: t.actual } : null; })() });
  const enlaceDe = (pid, eid) => abre(q.uno("SELECT * FROM forma_enlaces WHERE proyecto_id = ? AND id = ? AND quitado = ''", pid, eid));
  const P = '/api/proyectos/:pid/forma';
  /** La organizacion con la que se carga: la de quien crea el enlace si puede subir ahi; si no, la primera parte del proyecto que pueda. */
  function organizacionPara(p, u, carpeta) {
    const cand = [...new Set([String(u.organizacion || '').toUpperCase()].concat(Object.values(p.config.partes || {}).map(x => String(x).toUpperCase()), ['CONTRATISTA', 'SUPERVISION', 'ANIN']).filter(Boolean))];
    return cand.find(org => I.permisoEn(p, { email: 'complemento:forma', rol: 'document-control', organizacion: org, admin: false }, carpeta).subir) || '';
  }
  app.get(P + '/enlaces', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos("SELECT * FROM forma_enlaces WHERE proyecto_id = ? AND quitado = '' ORDER BY creado DESC", req.pid).map(abre);
    const n = new Map(q.todos("SELECT enlace_id, SUM(CASE WHEN estado = 'traido' THEN 1 ELSE 0 END) AS traidos, SUM(CASE WHEN estado = 'error' THEN 1 ELSE 0 END) AS errores, COUNT(DISTINCT CASE WHEN estado = 'traido' THEN item END) AS documentos, COUNT(DISTINCT CASE WHEN estado = 'nomenclatura' THEN item END) AS pendientes FROM forma_items WHERE proyecto_id = ? GROUP BY enlace_id", req.pid).map(x => [x.enlace_id, x]));
    const ni = new Map(q.todos("SELECT f.enlace_id, COUNT(*) AS n FROM forma_incidencias f JOIN incidencias i ON i.id = f.incidencia_id AND i.borrado = '' WHERE f.proyecto_id = ? GROUP BY f.enlace_id", req.pid).map(x => [x.enlace_id, x.n]));
    L.forEach(e => Object.assign(e, { traidos: (n.get(e.id) || {}).traidos || 0, conError: (n.get(e.id) || {}).errores || 0, documentos: (n.get(e.id) || {}).documentos || 0, pendientes: (n.get(e.id) || {}).pendientes || 0, nIncidencias: ni.get(e.id) || 0 }, ctx.forma.modelosDeEnlace ? ctx.forma.modelosDeEnlace(e.id) : {}));
    const p = I.proyecto(req.pid), u = I.yo(req, p);
    res.json({ enlaces: L, puedoCrear: ISO.RANGO_ROL[ISO.familia ? ISO.familia(u.rol) : u.rol] >= 1 || u.admin, soyGestor: u.admin || u.rol === 'gestor' || u.rol === 'administrador', yo: u.email });
  });
  app.post(P + '/enlaces', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const b = req.body || {}, p = I.proyecto(req.pid), u = I.yo(req, p), carpetaCde = CAR.limpia(b.carpetaCde);
      if (!b.hub || !b.proyecto || !b.carpeta) throw err('Elige la cuenta, el proyecto y la carpeta de Forma.', 'datos');
      if (!carpetaCde || !CAR.def(p.config.carpetas, carpetaCde)) throw err('Elige la carpeta del CDE donde se cargará.', 'datos');
      if (!u.admin && !I.permisoEn(p, u, carpetaCde).subir) throw err('No tienes permiso de carga en ' + carpetaCde + '.', 'sin-permiso', 403);
      const zona = CAR.zonaDe(p.config.carpetas, carpetaCde);
      if (b.subcarpetas && !u.admin && !ISO.puedeCrearCarpeta(u.rol, zona)) throw err('Tu nivel de acceso no crea carpetas en esa zona: elige otra carpeta o desmarca «Incluir subcarpetas».', 'sin-permiso', 403);
      const org = organizacionPara(p, u, carpetaCde); if (!org) throw err('Ninguna organización del proyecto puede cargar en ' + carpetaCde + '.', 'sin-permiso', 403);
      await ficha(req.quien);   // sin conexion vigente no tiene sentido crear el enlace
      if (q.uno("SELECT 1 FROM forma_enlaces WHERE proyecto_id = ? AND carpeta = ? AND carpeta_cde = ? AND quitado = ''", req.pid, String(b.carpeta), carpetaCde)) throw err('Esa carpeta de Forma ya está enlazada con esa carpeta del CDE.', 'repetido', 409);
      const eid = id('fe');
      q.corre('INSERT INTO forma_enlaces (id, proyecto_id, hub, hub_nombre, proyecto_forma, proyecto_nombre, carpeta, carpeta_nombre, carpeta_cde, organizacion, subcarpetas, versiones, automatico, por, creado, incidencias) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        eid, req.pid, String(b.hub), String(b.hubNombre || '').slice(0, 200), String(b.proyecto), String(b.proyectoNombre || '').slice(0, 200), String(b.carpeta), String(b.carpetaNombre || '').slice(0, 500), carpetaCde, org, b.subcarpetas === false ? 0 : 1, b.versiones === 'ultima' ? 'ultima' : 'todas', b.automatico ? 1 : 0, String(req.quien).toLowerCase(), ahora(), b.incidencias === false ? 0 : 1);
      audita(req.quien, 'forma.enlace', req.pid, String(b.carpetaNombre || b.carpeta), { destino: carpetaCde });
      arranca(enlaceDe(req.pid, eid), req.socket.localPort); res.json({ ok: true, id: eid });
    } catch (e) { fallo(res, e); }
  });
  const puedeTocar = (req, e) => { const p = I.proyecto(req.pid), u = I.yo(req, p); return u.admin || u.rol === 'gestor' || u.rol === 'administrador' || e.por === u.email; };
  app.put(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid), b = req.body || {}; if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo modifica quien creó el enlace o un gestor.' });
    q.corre('UPDATE forma_enlaces SET automatico = ?, versiones = ?, incidencias = ? WHERE id = ?', b.automatico === undefined ? (e.automatico ? 1 : 0) : (b.automatico ? 1 : 0), b.versiones === 'ultima' || b.versiones === 'todas' ? b.versiones : e.versiones, b.incidencias === undefined ? (e.incidencias ? 1 : 0) : (b.incidencias ? 1 : 0), e.id); res.json({ ok: true });
  });
  app.post(P + '/enlaces/:eid/sincronizar', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
      if (!puedeTocar(req, e)) throw err('Lo sincroniza quien creó el enlace o un gestor.', 'sin-permiso', 403);
      if ((TRABAJOS.get(e.id) || {}).estado === 'corriendo') throw err('Ya se está sincronizando.', 'ocupado', 409);
      await ficha(e.por === String(req.quien).toLowerCase() ? e.por : req.quien);
      if ((req.body || {}).reintentar) q.corre("DELETE FROM forma_items WHERE enlace_id = ? AND estado = 'error'", e.id);
      arranca(e, req.socket.localPort, String(req.quien).toLowerCase()); res.json({ ok: true });
    } catch (x) { fallo(res, x); }
  });
  app.post(P + '/enlaces/:eid/detener', requiereSesion, requiereRol('autor'), (req, res) => { const e = enlaceDe(req.pid, req.params.eid), t = e && TRABAJOS.get(e.id); if (!e) return res.status(404).json({ error: 'no-existe' }); if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso' }); if (t && t.estado === 'corriendo') t.parar = true; res.json({ ok: true }); });
  app.get(P + '/enlaces/:eid/items', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    res.json({ enlace: e, items: q.todos('SELECT id, item, n_forma, nombre, nombre_cde, ruta, tamano, autor, fecha_forma, contenedor_id, n_cde, estado, detalle, fecha FROM forma_items WHERE enlace_id = ? ORDER BY (estado = \'error\') DESC, (estado = \'nomenclatura\') DESC, ruta, nombre, n_forma LIMIT 5000', e.id) });
  });
  /** Lo que no entró por nomenclatura: un renglón por documento de Forma, con la carpeta del CDE a la que va. */
  app.get(P + '/enlaces/:eid/pendientes', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    const L = q.todos("SELECT item, nombre, ruta, MAX(tamano) AS tamano, MAX(n_forma) AS n, detalle FROM forma_items WHERE enlace_id = ? AND estado = 'nomenclatura' GROUP BY item ORDER BY ruta, nombre", e.id);
    res.json({ enlace: e, pendientes: L.map(x => Object.assign(x, { carpeta: e.carpeta_cde + (x.ruta ? '/' + x.ruta : '') })) });
  });
  /** Los nombres conformes que se eligieron en la rejilla: se guardan por documento de Forma y se vuelve a sincronizar. */
  app.post(P + '/enlaces/:eid/nombres', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo completa quien creó el enlace o un gestor.' });
    const p = I.proyecto(req.pid), malos = [], buenos = [];
    for (const a of (Array.isArray((req.body || {}).asignaciones) ? req.body.asignaciones : []).slice(0, 2000)) {
      const pend = q.uno("SELECT ruta FROM forma_items WHERE enlace_id = ? AND item = ? LIMIT 1", e.id, String(a.item || '')); if (!pend) continue;
      const nombre = require('path').basename(String(a.nombre || '').replace(/\\/g, '/')).slice(0, 250), val = NOM.valida(p.config, e.carpeta_cde + (pend.ruta ? '/' + pend.ruta : ''), nombre);
      if (!val.ok) { malos.push({ item: a.item, nombre, errores: val.errores }); continue; }
      q.corre('INSERT INTO forma_nombres (enlace_id, item, nombre, revision, idoneidad, atributos, por, fecha) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(enlace_id, item) DO UPDATE SET nombre = excluded.nombre, revision = excluded.revision, idoneidad = excluded.idoneidad, atributos = excluded.atributos, por = excluded.por, fecha = excluded.fecha',
        e.id, String(a.item), nombre, String(a.revision || '').toUpperCase().slice(0, 8), String(a.idoneidad || '').toUpperCase().slice(0, 4), JSON.stringify(a.atributos && typeof a.atributos === 'object' ? a.atributos : {}).slice(0, 20000), String(req.quien).toLowerCase(), ahora());
      q.corre("DELETE FROM forma_items WHERE enlace_id = ? AND item = ? AND estado IN ('nomenclatura','error')", e.id, String(a.item)); buenos.push(a.item);
    }
    if (buenos.length) { audita(req.quien, 'forma.nombres', req.pid, e.carpeta_nombre, { documentos: buenos.length }); arranca(e, req.socket.localPort, String(req.quien).toLowerCase()); }
    res.json({ ok: true, aceptados: buenos.length, rechazados: malos });
  });
  app.delete(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    if (!puedeTocar(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Lo quita quien creó el enlace o un gestor.' });
    const t = TRABAJOS.get(e.id); if (t) t.parar = true;
    q.corre('UPDATE forma_enlaces SET quitado = ?, automatico = 0 WHERE id = ?', ahora(), e.id); audita(req.quien, 'forma.enlace.quitar', req.pid, e.carpeta_nombre, {}); res.json({ ok: true });
  });

  // ───────── traer: recorrer la carpeta de Forma y cargar en el CDE cada version que falta
  const nombreCarpeta = (n) => { let s = String(n || '').replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120); if (!s || s === '.' || s === '..') s = 'carpeta'; return s; };
  /** Asegura que exista la subcarpeta en el CDE (hereda zona y permisos de la carpeta del enlace). */
  function aseguraCarpeta(pid, ruta) {
    const p = I.proyecto(pid); if (CAR.def(p.config.carpetas, ruta)) return;
    const partes = ruta.split('/'); let padre = '';
    for (const n of partes) { const r = padre ? padre + '/' + n : n; if (!CAR.def(p.config.carpetas, r)) { const c = CAR.crea(p.config.carpetas, padre, n, {}); if (c.error) throw err('No se pudo crear la carpeta ' + r + ': ' + c.error, 'carpeta'); p.config.carpetas = c.carpetas; I.guardaConfig(p); audita('complemento:forma', 'carpeta.crear', pid, r, { origen: 'forma' }); } padre = r; }
  }
  const anota = (e, it, v, estado, detalle, extra) => q.corre('INSERT INTO forma_items (enlace_id, proyecto_id, item, version, n_forma, nombre, nombre_cde, ruta, tamano, autor, fecha_forma, contenedor_id, n_cde, estado, detalle, fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(enlace_id, version) DO UPDATE SET estado = excluded.estado, detalle = excluded.detalle, nombre_cde = excluded.nombre_cde, contenedor_id = excluded.contenedor_id, n_cde = excluded.n_cde, fecha = excluded.fecha',
    e.id, e.proyecto_id, it.id, v.id, v.n, v.nombre, (extra && extra.nombre) || v.nombre, it.ruta, v.tamano, v.autor, v.fecha, (extra && extra.cid) || '', (extra && extra.n) || 0, estado, String(detalle || '').slice(0, 500), ahora());
  const version = (v) => { const a = v.attributes || {}, st = v.relationships && v.relationships.storage && v.relationships.storage.data && v.relationships.storage.data.id; return { id: v.id, n: Number(a.versionNumber) || 1, nombre: a.displayName || a.name || 'sin nombre', tamano: Number(a.storageSize) || 0, autor: a.lastModifiedUserName || a.createUserName || '', fecha: a.lastModifiedTime || a.createTime || '', almacen: st || '', tipo: (a.extension && a.extension.type) || '' }; };

  async function recorre(e, email, t, carpetaForma, rutaRel, lista) {
    if (t.parar) return; t.actual = rutaRel || e.carpeta_nombre;
    const j = await paginas('/data/v1/projects/' + encodeURIComponent(e.proyecto_forma) + '/folders/' + encodeURIComponent(carpetaForma) + '/contents?page[limit]=200', email);
    const puntas = new Map(j.included.filter(x => x.type === 'versions').map(x => [x.relationships && x.relationships.item && x.relationships.item.data && x.relationships.item.data.id, x]));
    for (const x of j.data) {
      if (x.attributes && x.attributes.hidden) continue;
      if (x.type === 'items') { lista.push({ id: x.id, ruta: rutaRel, punta: puntas.get(x.id) || null }); t.vistos = lista.length; }
      else if (x.type === 'folders' && e.subcarpetas) await recorre(e, email, t, x.id, (rutaRel ? rutaRel + '/' : '') + nombreCarpeta(x.attributes.displayName || x.attributes.name), lista);
      if (t.parar) return;
    }
  }
  async function carga(e, it, v, email, puerto, cde) {
    cde = cde || { nombre: v.nombre };
    if (!v.almacen) return anota(e, it, v, 'omitido', 'Autodesk no guarda un archivo descargable para este elemento.');
    if (v.tamano > MAX_MB * 1048576) return anota(e, it, v, 'omitido', 'Pesa más de ' + MAX_MB + ' MB (límite FORMA_MAX_MB).');
    const m = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(v.almacen); if (!m) return anota(e, it, v, 'omitido', 'Almacenamiento no reconocido.');
    const firmado = await aps('/oss/v2/buckets/' + encodeURIComponent(m[1]) + '/objects/' + encodeURIComponent(m[2]) + '/signeds3download', email);
    if (!firmado.url) throw err('Autodesk no entregó la descarga del archivo.', 'forma');
    const archivo = await fetch(firmado.url); if (!archivo.ok || !archivo.body) throw err('La descarga desde Autodesk falló (' + archivo.status + ').', 'forma');
    const carpeta = e.carpeta_cde + (it.ruta ? '/' + it.ruta : ''); if (it.ruta) aseguraCarpeta(e.proyecto_id, carpeta);
    const meta = { forma: { hub: e.hub_nombre, proyecto: e.proyecto_nombre, carpeta: e.carpeta_nombre + (it.ruta ? '/' + it.ruta : ''), item: it.id, version: v.id, numero: v.n, nombreOriginal: v.nombre, por: v.autor, fecha: v.fecha, traidoPor: email } };
    if (cde.atributos && Object.keys(cde.atributos).length) meta.atributos = cde.atributos;
    const r = await fetch('http://127.0.0.1:' + (puerto || ctx.puerto) + '/api/proyectos/' + e.proyecto_id + '/subir?origen=forma&organizacion=' + encodeURIComponent(e.organizacion) + '&carpeta=' + encodeURIComponent(carpeta) + (cde.revision ? '&revision=' + encodeURIComponent(cde.revision) : '') + (cde.idoneidad ? '&idoneidad=' + encodeURIComponent(cde.idoneidad) : ''),
      { method: 'POST', headers: { 'x-cde-llave': ctx.llaveInterna, 'x-cde-por': email, 'x-nombre': encodeURIComponent(cde.nombre), 'x-meta': encodeURIComponent(JSON.stringify(meta)) }, body: Readable.fromWeb(archivo.body), duplex: 'half' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(j.mensaje || j.error || ('El CDE no aceptó el archivo (' + r.status + ').'), 'cde');
    const cid = (j.contenedor && j.contenedor.id) || j.contenedor || j.contenedor_id || '', n = Number(j.n) || 0;
    anota(e, it, v, 'traido', '', { cid, n, nombre: cde.nombre }); return true;
  }
  async function sincroniza(e, email, puerto, t) {
    const lista = []; t.fase = 'leyendo'; await recorre(e, email, t, e.carpeta, '', lista);
    t.fase = 'trayendo'; t.total = lista.length; let i = 0;
    for (const it of lista) {
      if (t.parar) break; t.hechos = ++i;
      try {
        let vs;
        if (e.versiones === 'ultima') vs = [version(it.punta || (await aps('/data/v1/projects/' + encodeURIComponent(e.proyecto_forma) + '/items/' + encodeURIComponent(it.id) + '/tip', email)).data)];
        else {
          // si la version vigente ya se trajo, no hace falta pedir la lista de versiones
          if (it.punta && q.uno("SELECT 1 FROM forma_items WHERE enlace_id = ? AND version = ? AND estado IN ('traido','omitido')", e.id, it.punta.id)) { t.iguales++; continue; }
          vs = (await paginas('/data/v1/projects/' + encodeURIComponent(e.proyecto_forma) + '/items/' + encodeURIComponent(it.id) + '/versions?page[limit]=100', email)).data.map(version).sort((a, b) => a.n - b.n);
        }
        // de un mismo documento solo se trae lo posterior a lo ya traido, para que las versiones queden en orden
        const ultima = (q.uno("SELECT MAX(n_forma) AS n FROM forma_items WHERE enlace_id = ? AND item = ? AND estado = 'traido'", e.id, it.id) || {}).n || 0;
        let nuevo = false, tropiezo = false;
        // el nombre con el que entra al CDE: el de Forma o el que se completó en la rejilla de nomenclatura
        const asig = q.uno('SELECT nombre, revision, idoneidad, atributos FROM forma_nombres WHERE enlace_id = ? AND item = ?', e.id, it.id), pc = I.proyecto(e.proyecto_id);
        const carpetaIt = e.carpeta_cde + (it.ruta ? '/' + it.ruta : ''), ret = !!(pc.config.conformidad && pc.config.conformidad.areaRetencion);
        let pendientes = vs.filter(v => !(v.n <= ultima || q.uno("SELECT 1 FROM forma_items WHERE enlace_id = ? AND version = ? AND estado IN ('traido','omitido')", e.id, v.id)));
        // con un nombre asignado en la rejilla entra la versión vigente: las anteriores llevarían el mismo nombre (y la misma revisión)
        if (asig && pendientes.length > 1) { pendientes.slice(0, -1).forEach(v => anota(e, it, v, 'omitido', 'Versión anterior de Forma: con el nombre asignado en la rejilla entra solo la vigente (V' + pendientes[pendientes.length - 1].n + ').', { nombre: asig.nombre })); pendientes = pendientes.slice(-1); }
        for (const v of pendientes) {
          if (t.parar) break;
          const cde = asig ? { nombre: asig.nombre, atributos: json(asig.atributos, {}), revision: v === pendientes[pendientes.length - 1] ? asig.revision : '', idoneidad: v === pendientes[pendientes.length - 1] ? asig.idoneidad : '' } : { nombre: v.nombre };
          const val = NOM.valida(pc.config, carpetaIt, cde.nombre);
          if (!val.ok && !(ret && val.extension)) { anota(e, it, v, 'nomenclatura', (val.errores || []).join(' · ') || 'No cumple la nomenclatura de la carpeta.'); tropiezo = true; t.pendientes++; break; }   // sin descargar: se completa en la rejilla
          t.actual = (it.ruta ? it.ruta + '/' : '') + v.nombre + ' (V' + v.n + ')';
          try { if (await carga(e, it, v, email, puerto, cde)) { t.nuevos++; nuevo = true; } }
          catch (x) { t.errores++; tropiezo = true; anota(e, it, v, 'error', x.message, { nombre: cde.nombre }); if (x.codigo === 'forma-sin-conexion') throw x; break; }   // si una version falla, las siguientes de ese documento esperan al reintento
        }
        if (!nuevo && !tropiezo) t.iguales++;
      } catch (x) { if (x.codigo === 'forma-sin-conexion') throw x; t.errores++; anota(e, it, { id: 'item:' + it.id, n: 0, nombre: (it.punta && version(it.punta).nombre) || it.id, tamano: 0, autor: '', fecha: '' }, 'error', x.message); }
    }
  }
  // ───────── INCIDENCIAS de Forma (Issues API de Autodesk Construction Cloud): las de los documentos que trajo el enlace
  const REGIONES = new Map();
  async function regionDe(e, email) {
    if (REGIONES.has(e.hub)) return REGIONES.get(e.hub);
    let r = 'US'; try { const j = await aps('/project/v1/hubs/' + encodeURIComponent(e.hub), email); r = String(((j.data || {}).attributes || {}).region || 'US').toUpperCase(); } catch (x) {}
    REGIONES.set(e.hub, r); return r;
  }
  /** El identificador del archivo de Forma, igual en el elemento (dm.lineage:X) y en sus versiones (fs.file:vf.X?version=n). */
  const fichaDoc = (urn) => (/(?:lineage:|vf\.)([^?&/]+)/.exec(String(urn || '')) || [])[1] || String(urn || '').split('?')[0];
  /** Estado de Forma -> estado de la incidencia del CDE. */
  const ESTADO_FORMA = { open: 'abierta', pending: 'en-analisis', in_progress: 'en-analisis', in_review: 'respondida', completed: 'respondida', not_approved: 'en-analisis', in_dispute: 'en-analisis', closed: 'cerrada', void: 'rechazada' };
  const ESTADO_FORMA_TXT = { open: 'Abierta', pending: 'Pendiente', in_progress: 'En curso', in_review: 'En revisión', completed: 'Completada', not_approved: 'No aprobada', in_dispute: 'En disputa', closed: 'Cerrada', void: 'Anulada', draft: 'Borrador' };
  /** Tipo de Forma (titulo del tipo y subtipo) -> tipo de la incidencia del CDE. */
  function tipoCde(txt) {
    const t = String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/clash|interferen|coordinac|choque|conflict/.test(t)) return 'interferencia';
    if (/rfi|consulta|pregunta|question|informacion/.test(t)) return 'consulta';
    if (/calidad|quality|no conform|nonconform|ncr|defect|deficien/.test(t)) return 'no-conformidad';
    if (/cambio|change|rediseno/.test(t)) return 'cambio-de-diseno';
    if (/mejora|improve|sugeren/.test(t)) return 'mejora';
    return 'observacion';
  }
  async function todasPaginasAcc(ruta, email, cab, tope) {
    const out = []; let offset = 0, total = 1, n = 0;
    while (offset < total && n++ < (tope || 200)) {
      const j = await aps(ruta + (ruta.includes('?') ? '&' : '?') + 'limit=100&offset=' + offset, email, cab);
      const L = j.results || j.attachments || j.data || []; L.forEach(x => out.push(x));
      total = Number((j.pagination || {}).totalResults); if (!isFinite(total)) total = L.length < 100 ? 0 : offset + 200; offset += 100; if (!L.length) break;
    }
    return out;
  }
  async function traeIncidencias(e, email, t) {
    const traidos = q.todos("SELECT item, n_forma, contenedor_id, n_cde FROM forma_items WHERE enlace_id = ? AND estado = 'traido' AND contenedor_id <> ''", e.id);
    if (!traidos.length) return;
    const docs = new Map(); for (const x of traidos) { const k = fichaDoc(x.item); if (!k) continue; const d = docs.get(k) || { cid: x.contenedor_id, item: x.item, vs: new Map() }; d.vs.set(x.n_forma, x.n_cde); d.cid = x.contenedor_id; docs.set(k, d); }
    const proj = String(e.proyecto_forma).replace(/^b\./, ''), RI = '/construction/issues/v1/projects/' + encodeURIComponent(proj), cab = { 'x-ads-region': await regionDe(e, email) };
    t.actual = 'Leyendo las incidencias del proyecto en Forma…';
    let todas;
    try { todas = await todasPaginasAcc(RI + '/issues', email, cab, 300); }
    catch (x) { if (x.status === 403 || /403/.test(x.message)) throw err('Autodesk no permite leer las incidencias de este proyecto con tu cuenta (403): revisa que tengas acceso a la herramienta Incidencias en Forma.', 'forma'); throw x; }
    const propias = todas.filter(x => x && !x.deleted && x.status !== 'draft' && (x.linkedDocuments || []).some(ld => docs.has(fichaDoc(ld.urn))));
    t.inc.vistas = propias.length; if (!propias.length) return;
    // catalogos: tipos y subtipos; personas del proyecto (si la cuenta puede verlas)
    const tipos = new Map(); try { for (const ty of await todasPaginasAcc(RI + '/issue-types?include=subtypes', email, cab, 5)) { tipos.set(ty.id, ty.title || ''); for (const st of (ty.subtypes || [])) tipos.set(st.id, st.title || ''); } } catch (x) {}
    const campos = new Map(); try { for (const a of await todasPaginasAcc(RI + '/issue-attribute-definitions', email, cab, 10)) campos.set(a.id, { titulo: String(a.title || '').trim(), tipo: a.dataType, opciones: new Map((((a.metadata || {}).list || {}).options || []).map(o => [o.id, o.value])) }); } catch (x) {}
    const causas = new Map(); try { for (const c of await todasPaginasAcc(RI + '/issue-root-cause-categories?include=rootcauses', email, cab, 5)) for (const r of (c.rootCauses || [])) causas.set(r.id, [c.title, r.title].filter(Boolean).join(' › ')); } catch (x) {}
    // personas, empresas y roles (Admin API: requiere el permiso account:read de la cuenta conectada)
    const gente = new Map(), empresas = new Map(), roles = new Map(); let sinNombres = false;
    try {
      for (const u of await todasPaginasAcc('/construction/admin/v1/projects/' + encodeURIComponent(proj) + '/users', email, cab, 30)) {
        const k = u.autodeskId || u.id; if (k) gente.set(k, { nombre: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '), email: String(u.email || '').toLowerCase() });
        if (u.id && u.id !== k) gente.set(u.id, gente.get(k));
        if (u.companyId && u.companyName) empresas.set(u.companyId, u.companyName);
        for (const r of (u.roles || [])) if (r.id && r.name) roles.set(r.id, r.name);
      }
    } catch (x) { sinNombres = true; }
    try { for (const c of await todasPaginasAcc('/construction/admin/v1/accounts/' + encodeURIComponent(String(e.hub).replace(/^b\./, '')) + '/companies', email, cab, 20)) if (c.id && c.name) empresas.set(c.id, c.name); } catch (x) {}
    t.inc.sinNombres = sinNombres;
    const quien = (idA) => { const g = gente.get(idA); return g ? (g.email || g.nombre) : (idA ? 'usuario de Autodesk ' + String(idA).slice(0, 8) : 'Autodesk Forma'); };
    /** A quien se asigno en Forma: una persona (correo), una empresa o un rol del proyecto (su nombre). */
    const asignadoDe = (x) => !x.assignedTo ? '' : x.assignedToType === 'user' ? quien(x.assignedTo) : x.assignedToType === 'company' ? (empresas.get(x.assignedTo) || 'empresa de Forma ' + String(x.assignedTo).slice(0, 8)) : x.assignedToType === 'role' ? (roles.get(x.assignedTo) || 'rol de Forma ' + String(x.assignedTo).slice(0, 8)) : String(x.assignedTo);
    /** Campos personalizados de la incidencia en Forma: [{ titulo, valor }] (las listas, con el texto de la opcion). */
    const camposDe = (x) => (x.customAttributes || []).map(a => { const d = campos.get(a.attributeDefinitionId) || {}, v = a.value; const val = v == null || v === '' ? '' : d.opciones && d.opciones.has(v) ? d.opciones.get(v) : Array.isArray(v) ? v.map(z => (d.opciones && d.opciones.get(z)) || z).join(', ') : String(v); return { titulo: d.titulo || a.title || '', valor: val }; }).filter(a => a.titulo && a.valor);
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    /** Los campos de Forma que tienen su lugar en la incidencia del CDE (Disciplina, RIBA = Etapa, Tipo de revision, N.o entregable). */
    const delCde = (cs) => { const busca = (...res) => { for (const re of res) { const a = cs.find(c => re.test(norm(c.titulo))); if (a) return a.valor; } return ''; };
      return { disciplina: busca(/^disciplina/, /^especialidad( principal)?$/, /^especialidad/), etapa: busca(/^riba\b/, /^etapa/, /^fase\b/), tipo_revision: busca(/tipo de revision/, /^revision$/), entregable: busca(/entregable/) }; };
    const diaLocal = (iso) => { const d = new Date(iso || Date.now()); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const p = I.proyecto(e.proyecto_id);
    for (const x of propias) {
      if (t.parar) break;
      t.actual = 'Incidencia de Forma #' + (x.displayId || '') + ' · ' + String(x.title || '').slice(0, 80);
      const ld = (x.linkedDocuments || []).find(l => docs.has(fichaDoc(l.urn))), d = docs.get(fichaDoc(ld.urn));
      const nCde = d.vs.get(Number(ld.createdAtVersion)) || Math.max(...d.vs.values()), ver = q.uno('SELECT id FROM versiones WHERE contenedor_id = ? AND n = ?', d.cid, nCde);
      const det = ld.details || {}, vw = det.viewable || {}, pos = det.position || {};
      const tipoTxt = [tipos.get(x.issueTypeId), tipos.get(x.issueSubtypeId)].filter(Boolean).join(' › ');
      const asignado = asignadoDe(x), cs = camposDe(x), dc = delCde(cs), inicio = /^\d{4}-\d{2}-\d{2}/.test(String(x.startDate || '')) ? String(x.startDate).slice(0, 10) : diaLocal(x.createdAt);
      const extra = { tipo: tipoTxt, estado: ESTADO_FORMA_TXT[x.status] || x.status || '', asignadoTipo: x.assignedToType || '', asignadoA: asignado, campos: cs, causa: causas.get(x.rootCauseId) || '', hoja: vw.name || '', es3D: !!vw.is3D, version: Number(ld.createdAtVersion) || 0,
        posicion: (pos && pos.x !== undefined) ? { x: pos.x, y: pos.y, z: pos.z } : null, elemento: det.externalId || '', ubicacion: x.locationDetails || '', creadoPor: quien(x.createdBy), cerradoPor: x.closedBy ? quien(x.closedBy) : '', documento: d.item };
      const estado = ESTADO_FORMA[x.status] || 'abierta', dia = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '';
      const ya = q.uno('SELECT * FROM forma_incidencias WHERE proyecto_id = ? AND issue_id = ?', e.proyecto_id, String(x.id));
      let iid, comentariosHechos = [], adjuntosHechos = [], cambio = !ya || ya.actualizado_forma !== String(x.updatedAt || '') || (Number(ya.mapeo) || 1) < 2;   // mapeo < 2: traida antes de leer los campos personalizados
      if (!ya) {
        const numero = (q.uno('SELECT MAX(numero) AS m FROM incidencias WHERE proyecto_id = ?', e.proyecto_id).m || 0) + 1; iid = id('i');
        q.corre("INSERT INTO incidencias (id, proyecto_id, numero, codigo, titulo, descripcion, estado, tipo, prioridad, contractual, autor, asignado, creado, vencimiento, cerrado, contenedor_id, version_id, elementos, camara, captura, origen, referencia, inicio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          iid, e.proyecto_id, numero, 'INC-' + p.codigo + '-' + String(numero).padStart(4, '0'), String(x.title || 'Incidencia de Forma').slice(0, 300), String(x.description || '').slice(0, 8000), estado, tipoCde(tipoTxt + ' ' + (x.title || '')), 'media', 0,
          quien(x.createdBy), asignado.includes('@') ? asignado.toLowerCase() : asignado.slice(0, 160), String(x.createdAt || ahora()), dia(x.dueDate), x.closedAt ? String(x.closedAt) : '', d.cid, ver ? ver.id : '', JSON.stringify(det.externalId ? [{ modelo: d.cid, uid: det.externalId }] : []), '{}', '', 'autodesk-forma', 'Autodesk Forma #' + (x.displayId || ''), inicio);
        q.corre('UPDATE incidencias SET disciplina = ?, etapa = ?, tipo_revision = ?, entregable = ? WHERE id = ?', dc.disciplina.slice(0, 120), dc.etapa.slice(0, 60), dc.tipo_revision.slice(0, 80), dc.entregable.slice(0, 120), iid);
        q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', iid, quien(x.createdBy), String(x.createdAt || ahora()), 'Creada en Autodesk Forma (#' + (x.displayId || '') + (tipoTxt ? ' · ' + tipoTxt : '') + ') sobre ' + (vw.name ? 'la hoja «' + vw.name + '» de ' : '') + 'la versión ' + (Number(ld.createdAtVersion) || '') + ' del documento.', estado);
        q.corre('INSERT INTO forma_incidencias (proyecto_id, issue_id, incidencia_id, enlace_id, display_id, actualizado_forma, estado_forma, extra, fecha, mapeo) VALUES (?,?,?,?,?,?,?,?,?,2)', e.proyecto_id, String(x.id), iid, e.id, Number(x.displayId) || 0, String(x.updatedAt || ''), String(x.status || ''), JSON.stringify(extra), ahora());
        t.inc.nuevas++;
      } else {
        iid = ya.incidencia_id; comentariosHechos = json(ya.comentarios, []); adjuntosHechos = json(ya.adjuntos, []);
        if (!q.uno('SELECT 1 FROM incidencias WHERE id = ?', iid)) continue;   // la borraron del CDE: no se revive
        if (cambio) {
          q.corre('UPDATE incidencias SET titulo = ?, descripcion = ?, asignado = ?, vencimiento = ?, cerrado = ?, inicio = ?, disciplina = ?, etapa = ?, tipo_revision = ?, entregable = ? WHERE id = ?', String(x.title || '').slice(0, 300), String(x.description || '').slice(0, 8000), asignado.includes('@') ? asignado.toLowerCase() : asignado.slice(0, 160), dia(x.dueDate), x.closedAt ? String(x.closedAt) : '', inicio,
            dc.disciplina.slice(0, 120), dc.etapa.slice(0, 60), dc.tipo_revision.slice(0, 80), dc.entregable.slice(0, 120), iid);
          if (ya.estado_forma !== String(x.status || '')) { q.corre('UPDATE incidencias SET estado = ? WHERE id = ?', estado, iid); q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', iid, 'Autodesk Forma', String(x.updatedAt || ahora()), 'Estado en Forma: ' + (ESTADO_FORMA_TXT[x.status] || x.status), estado); }
          q.corre('UPDATE forma_incidencias SET actualizado_forma = ?, estado_forma = ?, extra = ?, enlace_id = ?, mapeo = 2 WHERE proyecto_id = ? AND issue_id = ?', String(x.updatedAt || ''), String(x.status || ''), JSON.stringify(extra), e.id, e.proyecto_id, String(x.id));
          t.inc.actualizadas++;
        }
      }
      if (ver) ponPin(iid, extra, ver.id);   // la chincheta, en el mismo punto de la hoja que en Forma (si aqui nadie la ha movido)
      // comentarios de Forma que faltan (en el orden en que se escribieron)
      if (cambio || (Number(x.commentCount) || 0) > comentariosHechos.length) {
        try {
          const cs = (await todasPaginasAcc(RI + '/issues/' + encodeURIComponent(x.id) + '/comments', email, cab, 20)).filter(c => c && !c.deletedAt && !comentariosHechos.includes(c.id)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
          for (const c of cs) { q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', iid, quien(c.createdBy), String(c.createdAt || ahora()), String(c.body || '').slice(0, 8000) || '(comentario vacío)', ''); comentariosHechos.push(c.id); t.inc.comentarios++; }
          q.corre('UPDATE forma_incidencias SET comentarios = ? WHERE proyecto_id = ? AND issue_id = ?', JSON.stringify(comentariosHechos), e.proyecto_id, String(x.id));
        } catch (y) { if (y.codigo === 'forma-sin-conexion') throw y; }
      }
      // adjuntos (fotos, croquis…): se copian al CDE para que queden aunque se quite el enlace
      if (cambio || (Number(x.attachmentCount) || 0) > adjuntosHechos.length) {
        try {
          const as = await todasPaginasAcc(RI + '/attachments/' + encodeURIComponent(x.id) + '/items', email, cab, 10);
          for (const a of as) {
            const aid = String(a.attachmentId || a.id || ''), nom = String(a.name || a.displayName || a.fileName || 'adjunto').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 150);
            if (!aid || adjuntosHechos.some(z => z.id === aid) || a.deletedAt) continue;
            const m = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(String(a.storageUrn || a.urn || '')); if (!m) continue;
            if ((Number(a.fileSize || a.size) || 0) > 300 * 1048576) { adjuntosHechos.push({ id: aid, nombre: nom, tam: Number(a.fileSize || a.size) || 0, ruta: '', nota: 'Pesa más de 300 MB: se ve en Forma.' }); continue; }
            const firmado = await aps('/oss/v2/buckets/' + encodeURIComponent(m[1]) + '/objects/' + encodeURIComponent(m[2]) + '/signeds3download', email);
            const r = firmado.url && await fetch(firmado.url); if (!r || !r.ok) continue;
            const buf = Buffer.from(await r.arrayBuffer()), dir = ctx.almacen.carpeta(e.proyecto_id, 'forma-incidencias', iid), arch = adjuntosHechos.length + 1 + '-' + nom;
            require('fs').writeFileSync(require('path').join(dir, arch), buf);
            adjuntosHechos.push({ id: aid, nombre: nom, tam: buf.length, ruta: require('path').relative(ctx.almacen.raiz, require('path').join(dir, arch)).split(require('path').sep).join('/'), fecha: String(a.createdOn || a.createdAt || '') }); t.inc.adjuntos++;
          }
          q.corre('UPDATE forma_incidencias SET adjuntos = ? WHERE proyecto_id = ? AND issue_id = ?', JSON.stringify(adjuntosHechos), e.proyecto_id, String(x.id));
        } catch (y) { if (y.codigo === 'forma-sin-conexion') throw y; }
      }
    }
    audita(email, 'forma.incidencias', e.proyecto_id, e.carpeta_nombre, { nuevas: t.inc.nuevas, actualizadas: t.inc.actualizadas, comentarios: t.inc.comentarios, adjuntos: t.inc.adjuntos });
  }
  app.get(P + '/enlaces/:eid/incidencias', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req.pid, req.params.eid); if (!e) return res.status(404).json({ error: 'no-existe' });
    res.json({ incidencias: q.todos("SELECT f.issue_id, f.display_id, f.estado_forma, f.extra, f.adjuntos, i.id, i.codigo, i.titulo, i.estado, i.vencimiento, i.contenedor_id, c.nombre AS documento FROM forma_incidencias f JOIN incidencias i ON i.id = f.incidencia_id AND i.borrado = '' LEFT JOIN contenedores c ON c.id = i.contenedor_id WHERE f.enlace_id = ? ORDER BY f.display_id", e.id)
      .map(x => Object.assign(x, { extra: json(x.extra, {}), adjuntos: json(x.adjuntos, []).length })) });
  });
  /** Lo que la incidencia trae de Forma (para la ficha de la incidencia) y sus adjuntos. */
  app.get('/api/proyectos/:pid/forma/incidencias/:iid', requiereSesion, requiereRol('lector'), (req, res) => {
    const f = q.uno('SELECT * FROM forma_incidencias WHERE proyecto_id = ? AND incidencia_id = ?', req.pid, req.params.iid); if (!f) return res.status(404).json({ error: 'no-existe' });
    const e = q.uno('SELECT carpeta_nombre, proyecto_nombre, hub_nombre FROM forma_enlaces WHERE id = ?', f.enlace_id) || {};
    res.json({ displayId: f.display_id, estadoForma: f.estado_forma, extra: json(f.extra, {}), adjuntos: json(f.adjuntos, []).map((a, k) => ({ k, nombre: a.nombre, tam: a.tam, nota: a.nota || '', hay: !!a.ruta })), actualizado: f.actualizado_forma, enlace: e });
  });
  app.get('/api/proyectos/:pid/forma/incidencias/:iid/adjuntos/:k', requiereSesion, requiereRol('lector'), (req, res) => {
    const f = q.uno('SELECT adjuntos FROM forma_incidencias WHERE proyecto_id = ? AND incidencia_id = ?', req.pid, req.params.iid), a = f && json(f.adjuntos, [])[Number(req.params.k)];
    if (!a || !a.ruta || !ctx.almacen.existe(a.ruta)) return res.status(404).json({ error: 'no-existe' });
    res.setHeader('Content-Disposition', (req.query.ver ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(a.nombre)); res.type(require('path').extname(a.nombre) || 'application/octet-stream');
    ctx.almacen.flujo(a.ruta).pipe(res);
  });

  /** Lanza la sincronizacion de un enlace en segundo plano (una a la vez por enlace). */
  function arranca(e, puerto, comoQuien) {
    if (!e || (TRABAJOS.get(e.id) || {}).estado === 'corriendo') return null;
    const t = { estado: 'corriendo', fase: 'leyendo', vistos: 0, total: 0, hechos: 0, nuevos: 0, iguales: 0, errores: 0, pendientes: 0, inc: null, actual: '', inicio: Date.now(), parar: false }; TRABAJOS.set(e.id, t);
    const email = comoQuien || e.por;
    t.promesa = (async () => {
      let error = '';
      try { await sincroniza(e, email, puerto, t); } catch (x) { error = x.message; }
      if (!error && !t.parar && e.incidencias !== false) { t.fase = 'incidencias'; t.inc = { vistas: 0, nuevas: 0, actualizadas: 0, comentarios: 0, adjuntos: 0, error: '' }; try { await traeIncidencias(e, email, t); } catch (x) { t.inc.error = x.message; } }
      t.estado = error ? 'error' : t.parar ? 'detenido' : 'listo'; t.actual = '';
      const resumen = { documentos: t.total, nuevos: t.nuevos, sinCambios: t.iguales, pendientes: t.pendientes, errores: t.errores, incidencias: t.inc ? { nuevas: t.inc.nuevas, actualizadas: t.inc.actualizadas, comentarios: t.inc.comentarios, adjuntos: t.inc.adjuntos, error: t.inc.error, sinNombres: !!t.inc.sinNombres } : null, segundos: Math.round((Date.now() - t.inicio) / 1000), detenido: !!t.parar, por: email };
      q.corre('UPDATE forma_enlaces SET ultimo = ?, resumen = ?, error = ? WHERE id = ?', ahora(), JSON.stringify(resumen), String(error).slice(0, 300), e.id);
      audita(email, 'forma.sincronizar', e.proyecto_id, e.carpeta_nombre, resumen);
      setTimeout(() => { if (TRABAJOS.get(e.id) === t) TRABAJOS.delete(e.id); }, 120000).unref();
    })();
    return t;
  }
  // sincronizacion automatica: cada cierto tiempo, los enlaces marcados, con la cuenta de quien los creo
  const INTERVALO = Math.max(5, Number(process.env.FORMA_INTERVALO_MIN) || 30);
  const reloj = setInterval(() => { if (!configurado()) return; try { q.todos("SELECT * FROM forma_enlaces WHERE automatico = 1 AND quitado = ''").map(abre).forEach(e => arranca(e)); } catch (x) { console.error('conector Forma:', x.message); } }, INTERVALO * 60000); reloj.unref();
  ctx.forma = { arranca, TRABAJOS, enlaceDe };

  // ───────── MODELOS DE FORMA EN EL VISOR DEL CDE
  // Un NWD no tiene lector libre, pero Autodesk ya lo tradujo para verlo en Forma. Se usa esa traduccion:
  //  · el INDICE de parametros, en el servidor, de la base de propiedades de la traduccion (extractor del visor, en un hilo);
  //  · la GEOMETRIA, en el navegador del usuario: el visor de Autodesk abre la traduccion y el CDE lee sus mallas (cdeg.js).
  // Cuando llegan las dos, el modelo queda instalado en el CDE como cualquier otro (y se ve aunque luego se quite el enlace).
  const pathM = require('path'), fsM = require('fs'), { Worker } = require('worker_threads');
  const EXT_MODELO = /\.(nwd|nwc|nwf|rvt|ifc|dwg|dgn|fbx|3dm|skp|stp|step|ipt|iam|f3d)$/i;
  const saneoM = (x) => String(x || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const urnDe = (v) => Buffer.from(String(v)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const TRAD = new Map();   // vid -> traduccion en curso
  /** Bitacora del paso de modelos de Forma al visor (DATOS/forma-visor.log, una linea JSON por evento): para saber, sin la
   *  pantalla del usuario, en que paso y por que fallo (los datos del navegador llegan por /bitacora y por /cancelar). */
  const BITACORA = () => pathM.join(ctx.datosDir, 'forma-visor.log');
  function bitacora(t, evento, datos) {
    try {
      const r = BITACORA(); try { if (fsM.statSync(r).size > 5 * 1048576) fsM.renameSync(r, r + '.1'); } catch (e) {}
      fsM.appendFileSync(r, JSON.stringify(Object.assign({ fecha: new Date().toISOString(), vid: t.vid, archivo: t.archivo, quien: t.quien, evento }, datos || {})) + '\n');
    } catch (e) {}
  }
  const fuenteDe = (pid, vid) => q.uno("SELECT v.id AS vid, v.n, v.archivo, v.origen, c.id AS cid, c.nombre, c.carpeta, fi.version AS version_forma, fi.n_forma, fi.enlace_id, e.hub, e.proyecto_forma FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id LEFT JOIN forma_items fi ON fi.contenedor_id = c.id AND fi.n_cde = v.n AND fi.estado = 'traido' LEFT JOIN forma_enlaces e ON e.id = fi.enlace_id WHERE v.id = ? AND c.proyecto_id = ? ORDER BY fi.id DESC LIMIT 1", vid, pid);
  const estadoTrad = (t) => t ? { indice: { estado: t.indice.estado, texto: t.indice.texto, error: t.indice.error, resumen: t.indice.resumen || null }, geometria: !!t.geometria, geoInfo: t.geoInfo || null, arbol: t.arbol ? { estado: t.arbol.estado, texto: t.arbol.texto, error: t.arbol.error, r: t.arbol.r } : null, instalado: !!t.instalado, error: t.error || '', desde: t.inicio } : null;
  function intentaInstalar(t) {
    if (t.instalado || t.error || t.indice.estado !== 'listo' || !t.geometria || (t.arbol && t.arbol.estado !== 'listo')) return;
    try {
      const r = Object.assign({}, t.indice.resumen || {}, { origen: 'Traducción de Autodesk Forma', elementosConGeometria: (t.geoInfo || {}).elementos || 0, ids: (t.geoInfo || {}).ids || null, aristas: (t.geoInfo || {}).aristas || 0, criterio: (t.geoInfo || {}).criterio || '' });
      if (!r.elementos) r.elementos = r.elementosConGeometria;
      ctx.modelos.instala({ pid: t.pid, vid: t.vid, indice: t.indice.ruta, geometria: t.geometria, resumen: r, aviso: [].concat((t.indice.resumen || {}).avisos || [], (t.geoInfo || {}).avisos || []).join(' ').slice(0, 1500), meta: { origen_paquete: 'forma-autodesk', herramienta: 'Traducción de Autodesk Forma', modelo: t.archivo }, quien: t.quien });
      try { fsM.unlinkSync(t.indice.ruta.replace(/\.sqlite$/, '.json')); } catch (e) {}
      t.instalado = true; audita(t.quien, 'forma.modelo.visor', t.pid, t.archivo, { elementos: r.elementos, conGeometria: r.elementosConGeometria }); bitacora(t, 'instalado', { elementos: r.elementos, conGeometria: r.elementosConGeometria });
    } catch (e) { t.error = 'No se pudo instalar el modelo en el CDE: ' + e.message; bitacora(t, 'instalar-error', { error: e.message }); }
    setTimeout(() => { if (TRAD.get(t.vid) === t) TRAD.delete(t.vid); }, 30 * 60000).unref();
  }
  function arrancaIndice(t, email, f, region) {
    const dir = ctx.modelos.dirIndices; t.indice = { estado: 'leyendo', texto: 'Pidiendo a Autodesk la base de propiedades del modelo…', ruta: pathM.join(dir, saneoM(t.vid) + '.forma.sqlite'), error: '' };
    try { fsM.unlinkSync(t.indice.ruta); } catch (e) {}
    let w;
    ficha(email).then((token) => {
      w = new Worker(pathM.join(__dirname, 'trabajador-forma-indice.js'), { workerData: { token, base: base(), urn: urnDe(f.version_forma), archivo: f.archivo, rutaIndice: t.indice.ruta, dirTemporal: pathM.join(dir, 'tmp-forma'), region, maxMb: Number(process.env.FORMA_INDICE_MAX_MB) || 6000 } });
      t.w = w;
      w.on('message', async (m) => {
        if (m.avance) { if (m.avance.texto !== t.indice.texto && Date.now() - (t.ultNota || 0) > 20000) { t.ultNota = Date.now(); bitacora(t, 'indice-avance', { texto: m.avance.texto }); } t.indice.texto = m.avance.texto; return; }
        if (m.pideToken) { try { w.postMessage({ token: await ficha(email) }); } catch (e) { w.postMessage({ token: '' }); } return; }
        if (m.ok) { t.indice.estado = 'listo'; t.indice.resumen = m.resumen; t.indice.texto = 'Índice listo'; let mb = 0; try { mb = Math.round(fsM.statSync(t.indice.ruta).size / 1048576); fsM.writeFileSync(t.indice.ruta.replace(/\.sqlite$/, '.json'), JSON.stringify({ versionForma: t.versionForma, resumen: m.resumen, fecha: ahora() })); } catch (e) {} bitacora(t, 'indice-listo', { resumen: m.resumen, mb, segundos: Math.round((Date.now() - t.t0) / 1000) }); intentaInstalar(t); }
        else { t.indice.estado = 'error'; t.indice.error = m.error; t.error = 'Índice: ' + m.error; bitacora(t, 'indice-error', { error: m.error }); }
        try { w.terminate(); } catch (e) {}
      });
      w.on('error', (e) => { t.indice.estado = 'error'; t.indice.error = String(e.message || e); t.error = 'Índice: ' + t.indice.error; bitacora(t, 'indice-error', { error: t.indice.error }); });
      w.on('exit', (cod) => { if (t.indice.estado === 'leyendo' && TRAD.get(t.vid) === t) { t.indice.estado = 'error'; t.indice.error = 'El hilo del índice terminó sin terminar el índice (código ' + cod + '; ¿memoria?).'; t.error = 'Índice: ' + t.indice.error; bitacora(t, 'indice-error', { error: t.indice.error }); } });
    }).catch((e) => { t.indice.estado = 'error'; t.indice.error = e.message; t.error = e.message; });
  }
  /** El token de Autodesk del usuario, para que el visor de Autodesk de SU navegador abra la traduccion (solo lectura). */
  app.get('/api/forma/token-visor', requiereSesion, async (req, res) => {
    try { const token = await ficha(req.quien), f = FICHAS.get(String(req.quien).toLowerCase()); res.set('Cache-Control', 'no-store'); res.json({ access_token: token, expires_in: Math.max(60, Math.round(((f && f.vence) || Date.now() + 1800000) - Date.now()) / 1000 | 0) }); }
    catch (e) { fallo(res, e); }
  });
  /** Los modelos traidos de Forma (y si ya estan en el visor del CDE). ?enlace= para los de un enlace; ?ultimas=1 solo la version vigente de cada uno. */
  app.get(P + '/modelos', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = I.proyecto(req.pid), u = I.yo(req, p), filtroE = String(req.query.enlace || '');
    const L = q.todos("SELECT v.id AS vid, v.n, v.archivo, v.tamano, v.fecha, c.id AS cid, c.nombre, c.carpeta, fi.enlace_id, fi.n_forma, fi.item, i.estado AS ie, i.ruta_geometria AS geo, i.error AS ierr FROM forma_items fi JOIN contenedores c ON c.id = fi.contenedor_id JOIN versiones v ON v.contenedor_id = c.id AND v.n = fi.n_cde LEFT JOIN indices_modelo i ON i.version_id = v.id WHERE fi.proyecto_id = ? AND fi.estado = 'traido'" + (filtroE ? ' AND fi.enlace_id = ?' : '') + " ORDER BY c.nombre, v.n DESC", ...[req.pid].concat(filtroE ? [filtroE] : []))
      .filter(x => EXT_MODELO.test(x.archivo) && (u.admin || I.permisoEn(p, u, x.carpeta).leer));
    const vistos = new Set(), out = [];
    for (const x of L) { if (vistos.has(x.vid)) continue; vistos.add(x.vid); const vigente = !out.some(y => y.cid === x.cid); if (req.query.ultimas === '1' && !vigente) continue;
      out.push({ vid: x.vid, cid: x.cid, nombre: x.nombre, carpeta: x.carpeta, n: x.n, nForma: x.n_forma, archivo: x.archivo, tamano: x.tamano, vigente, enVisor: x.ie === 'listo' && !!x.geo, estadoIndice: x.ie || '', error: x.ie === 'listo' ? '' : (x.ierr || ''), trabajo: estadoTrad(TRAD.get(x.vid)) }); }
    res.json({ modelos: out });
  });
  app.post(P + '/modelos/:vid/preparar', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const f = fuenteDe(req.pid, req.params.vid); if (!f) throw err('Esa versión no existe en este proyecto.', 'no-existe', 404);
      if (!f.version_forma) throw err('Esta versión no vino de Autodesk Forma: el CDE no tiene de dónde traer su traducción.', 'no-forma', 409);
      if (!EXT_MODELO.test(f.archivo)) throw err('Este archivo no es un modelo 3D.', 'no-modelo', 409);
      const p = I.proyecto(req.pid), u = I.yo(req, p); if (!u.admin && !I.permisoEn(p, u, f.carpeta).leer) throw err('No tienes acceso a esa carpeta.', 'sin-permiso', 403);
      const email = String(req.quien).toLowerCase(); await ficha(email);
      const region = await regionDe({ hub: f.hub }, email);
      let t = TRAD.get(f.vid);
      if (!t || t.error || t.instalado) {
        if (t && t.w) try { t.w.terminate(); } catch (e) {}
        t = { pid: req.pid, vid: f.vid, archivo: f.archivo, quien: email, inicio: ahora(), t0: Date.now(), geometria: '', geoInfo: null, instalado: false, error: '' }; TRAD.set(f.vid, t);
        t.versionForma = f.version_forma; bitacora(t, 'preparar', { region, versionForma: f.n_forma });
        const rI = pathM.join(ctx.modelos.dirIndices, saneoM(f.vid) + '.forma.sqlite'), rJ = rI.replace(/\.sqlite$/, '.json'); let previo = null;
        if (!(req.body || {}).rehacer) try { const j = JSON.parse(fsM.readFileSync(rJ, 'utf8')); if (j.versionForma === f.version_forma && fsM.existsSync(rI)) previo = j; } catch (e) {}
        if (previo) { t.indice = { estado: 'listo', texto: 'Índice listo (de un intento anterior)', ruta: rI, error: '', resumen: previo.resumen }; bitacora(t, 'indice-reutilizado', { de: previo.fecha, resumen: previo.resumen }); }
        else if (!(req.body || {}).rehacer && (() => { const i = q.uno('SELECT estado, ruta_sqlite, resumen FROM indices_modelo WHERE version_id = ?', f.vid); let rs = {}; try { rs = JSON.parse((i && i.resumen) || '{}'); } catch (e) {} if (i && i.estado === 'listo' && i.ruta_sqlite && rs.origen === 'Traducción de Autodesk Forma' && fsM.existsSync(i.ruta_sqlite)) { t.instalado0 = { ruta: i.ruta_sqlite, resumen: rs }; return true; } return false; })()) {
          // el indice instalado (mismos ids de la base de propiedades): se copia para rehacer solo la geometria
          const { ruta: rO, resumen: rs } = t.instalado0; const resumen = { nodos: rs.nodos, pares: rs.pares, elementos: rs.elementos, origen: 'base', vista: rs.vista, completo: rs.completo !== false, avisos: [] };
          t.indice = { estado: 'leyendo', texto: 'Copiando el índice que ya tenía el CDE…', ruta: rI, error: '' };
          fsM.copyFile(rO, rI, (e) => { if (e) { t.indice.estado = 'error'; t.indice.error = e.message; t.error = 'Índice: ' + e.message; bitacora(t, 'indice-error', { error: e.message }); return; } t.indice.estado = 'listo'; t.indice.texto = 'Índice listo (el que ya tenía el CDE)'; t.indice.resumen = resumen; bitacora(t, 'indice-reutilizado', { de: 'instalado', resumen }); });
        }
        else { try { fsM.unlinkSync(rJ); } catch (e) {} arrancaIndice(t, email, f, region); }
      }
      res.json({ vid: f.vid, archivo: f.archivo, urn: urnDe(f.version_forma), region, version: f.n_forma, trabajo: estadoTrad(t) });
    } catch (e) { fallo(res, e); }
  });
  /** La geometria (.cdeg) que leyo el navegador; llega en flujo (puede pesar cientos de MB). */
  app.post(P + '/modelos/:vid/geometria', requiereSesion, requiereRol('autor'), (req, res) => {
    const t = TRAD.get(String(req.params.vid)); if (!t || t.pid !== req.pid) return res.status(409).json({ error: 'sin-preparar', mensaje: 'Vuelve a empezar: el CDE no tiene este modelo en preparación (¿se reinició el servidor?).' });
    const destino = pathM.join(ctx.modelos.dirIndices, saneoM(t.vid) + '.forma.cdeg'), w = fsM.createWriteStream(destino); let bytes = 0, firma = null;
    req.on('data', (c) => { bytes += c.length; if (firma === null) firma = c.subarray(0, 4).toString('latin1'); });
    req.on('error', () => { try { w.destroy(); } catch (e) {} });
    w.on('finish', () => {
      if (firma !== 'CDEG') { try { fsM.unlinkSync(destino); } catch (e) {} return res.status(400).json({ error: 'formato', mensaje: 'La geometría no llegó completa (falta la firma CDEG).' }); }
      let info = {}; try { info = JSON.parse(decodeURIComponent(String(req.get('x-cde-geometria') || '%7B%7D'))); } catch (e) {}
      t.geometria = destino; t.geoInfo = { bytes, elementos: Number(info.elementos) || 0, triangulos: Number(info.triangulos) || 0, avisos: Array.isArray(info.avisos) ? info.avisos.slice(0, 8).map(String) : [], ids: info.ids && typeof info.ids === 'object' ? { tipo: String(info.ids.tipo || '').slice(0, 10), total: Number(info.ids.total) || 0, coinciden: Number(info.ids.coinciden) || 0 } : null, aristas: Number(info.aristas) || 0, cajas: Number(info.cajas) || 0, criterio: String(info.criterio || '').slice(0, 20) }; bitacora(t, 'geometria', t.geoInfo);
      intentaInstalar(t); res.json({ ok: true, bytes, trabajo: estadoTrad(t) });
    });
    w.on('error', (e) => res.status(500).json({ error: 'disco', mensaje: e.message }));
    req.pipe(w);
  });
  /** El arbol del modelo (el padre de cada nodo, con los ids de la base de propiedades) que lee el navegador en el visor de
   *  Autodesk. Con el, un NWD/NWC se reordena con la regla de elemento de Navisworks (lib/arbol-navisworks.js: Archivo, Capa
   *  y Coleccion son agrupacion; el primer objeto es el elemento), en un hilo. El navegador espera por /estado (trabajo.arbol). */
  app.post(P + '/modelos/:vid/arbol', requiereSesion, requiereRol('autor'), (req, res) => {
    const t = TRAD.get(String(req.params.vid)); if (!t || t.pid !== req.pid || !t.indice || t.indice.estado !== 'listo') return res.status(409).json({ error: 'sin-indice', mensaje: 'El índice aún no está listo.' });
    if (t.arbol && t.arbol.estado === 'va') { req.resume(); return res.json({ trabajo: estadoTrad(t) }); }
    const destino = t.indice.ruta.replace(/\.sqlite$/, '.arbol.bin'), w = fsM.createWriteStream(destino); let bytes = 0, corto = false;
    req.on('data', (c) => { bytes += c.length; if (bytes > 512 * 1048576 && !corto) { corto = true; req.unpipe(w); w.destroy(); try { fsM.unlinkSync(destino); } catch (e) {} res.status(413).json({ error: 'grande', mensaje: 'El árbol del modelo pesa demasiado.' }); } });
    req.on('error', () => { try { w.destroy(); } catch (e) {} });
    w.on('error', (e) => { if (!corto) res.status(500).json({ error: 'disco', mensaje: e.message }); });
    w.on('finish', () => {
      if (corto) return;
      let completo = false; try { const fd = fsM.openSync(destino, 'r'), cab = Buffer.alloc(8); fsM.readSync(fd, cab, 0, 8, 0); fsM.closeSync(fd); completo = bytes >= 8 && cab.toString('latin1', 0, 4) === 'CDA2' ? bytes >= 8 + cab.readUInt32LE(4) * 5 : bytes > 0 && bytes % 4 === 0; } catch (e) {}
      if (!completo) { try { fsM.unlinkSync(destino); } catch (e) {} return res.status(400).json({ error: 'formato', mensaje: 'El árbol del modelo no llegó completo.' }); }
      t.arbol = { estado: 'va', texto: 'Ordenando el índice como Navisworks…', error: '', r: null, t0: Date.now() }; bitacora(t, 'arbol-recibido', { bytes });
      const wk = new Worker(pathM.join(__dirname, 'trabajador-forma-arbol.js'), { workerData: { ruta: t.indice.ruta, rutaArbol: destino } }); t.wa = wk;
      wk.on('message', (m) => {
        if (m.avance) { t.arbol.texto = m.avance; return; }
        if (m.ok) {
          const r = m.r || {}; t.arbol.estado = 'listo'; t.arbol.r = r; t.arbol.texto = '';
          const rs = t.indice.resumen = Object.assign({}, t.indice.resumen || {});
          rs.arbol = r.aplicado ? 'navisworks-3' : 'no-aplica'; if (r.aplicado && r.elementos) rs.elementos = r.elementos;
          try { const rJ = t.indice.ruta.replace(/\.sqlite$/, '.json'); if (fsM.existsSync(rJ)) { const j = JSON.parse(fsM.readFileSync(rJ, 'utf8')); j.resumen = rs; fsM.writeFileSync(rJ, JSON.stringify(j)); } } catch (e) {}
          bitacora(t, 'arbol', { r, segundos: Math.round((Date.now() - t.arbol.t0) / 1000) });
        } else { t.arbol.estado = 'error'; t.arbol.error = m.error; bitacora(t, 'arbol-error', { error: m.error, comprobacion: m.comprobacion || null }); }
        try { wk.terminate(); } catch (e) {}
      });
      wk.on('error', (e) => { t.arbol.estado = 'error'; t.arbol.error = String(e.message || e); bitacora(t, 'arbol-error', { error: t.arbol.error }); });
      wk.on('exit', (cod) => { if (t.arbol.estado === 'va') { t.arbol.estado = 'error'; t.arbol.error = 'El hilo que ordena el índice terminó antes de tiempo (código ' + cod + ').'; bitacora(t, 'arbol-error', { error: t.arbol.error }); } });
      res.json({ ok: true, trabajo: estadoTrad(t) });
    });
    req.pipe(w);
  });
  /** Comprueba que los ids del visor de Autodesk (ya pasados de SVF2 a SVF con la correspondencia de Autodesk) apuntan a los
   *  mismos objetos del indice: compara nombres de una muestra. Si no coinciden, no se arma el modelo (datos cruzados). */
  app.post(P + '/modelos/:vid/valida-ids', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = TRAD.get(String(req.params.vid)); if (!t || t.pid !== req.pid || !t.indice || t.indice.estado !== 'listo') return res.status(409).json({ error: 'sin-indice', mensaje: 'El índice aún no está listo.' });
    const norm = (x) => String(x == null ? '' : x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\[\d+\]\s*$/, '').replace(/\s+/g, ' ').trim();
    let db; try {
      const { DatabaseSync } = require('node:sqlite'); db = new DatabaseSync(t.indice.ruta, { readOnly: true }); const st = db.prepare('SELECT nombre FROM elem WHERE e = ?');
      let total = 0, coinciden = 0; const ejemplos = [];
      for (const [e, nm] of ((req.body || {}).pares || []).slice(0, 600)) { const r = st.get(Number(e)); total++; const a = norm(r && r.nombre), b = norm(nm); if (a && b && (a === b || a.startsWith(b) || b.startsWith(a))) coinciden++; else if (ejemplos.length < 6) ejemplos.push([Number(e), String(nm).slice(0, 60), r ? String(r.nombre).slice(0, 60) : null]); }
      bitacora(t, 'valida-ids', { total, coinciden, ejemplos }); res.json({ total, coinciden, ejemplos });
    } catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); } finally { try { db && db.close(); } catch (e) {} }
  });
  /** Los nodos que el indice reconoce como ELEMENTOS (clase 1): el navegador junta en ellos las piezas de la malla. */
  app.get(P + '/modelos/:vid/elementos-indice', requiereSesion, requiereRol('autor'), (req, res) => {
    const t = TRAD.get(String(req.params.vid)); if (!t || t.pid !== req.pid || !t.indice || t.indice.estado !== 'listo') return res.status(409).json({ error: 'sin-indice', mensaje: 'El índice aún no está listo.' });
    let db; try { const { DatabaseSync } = require('node:sqlite'); db = new DatabaseSync(t.indice.ruta, { readOnly: true }); const acero = db.prepare("SELECT e FROM elem WHERE clase = 1 AND (lower(cat) LIKE '%armadura%' OR lower(cat) LIKE '%refuerzo%' OR lower(cat) LIKE '%rebar%' OR lower(cat) LIKE '%reinforc%' OR lower(cat) LIKE '%acoplador%' OR lower(cat) LIKE '%coupler%')").all().map(r => Number(r.e));
      const aux = db.prepare('SELECT e, cat FROM elem WHERE clase = 1').all().filter(r => require('./arbol-navisworks').lineaAuxiliar(r.cat)).map(r => Number(r.e));   // sus lineas no se dibujan
      res.json({ e: db.prepare('SELECT e FROM elem WHERE clase = 1 ORDER BY e').all().map(r => Number(r.e)), acero, aux }); }
    catch (e) { res.status(500).json({ error: 'indice', mensaje: e.message }); } finally { try { db && db.close(); } catch (e) {} }
  });
  app.get(P + '/modelos/:vid/estado', requiereSesion, requiereRol('lector'), (req, res) => {
    const t = TRAD.get(String(req.params.vid)), i = q.uno('SELECT estado, ruta_geometria FROM indices_modelo WHERE version_id = ?', String(req.params.vid));
    res.json({ trabajo: t && t.pid === req.pid ? estadoTrad(t) : null, enVisor: !!(i && i.estado === 'listo' && i.ruta_geometria) });
  });
  app.post(P + '/modelos/:vid/bitacora', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = TRAD.get(String(req.params.vid)); if (t && t.pid === req.pid) bitacora(t, 'navegador', { paso: String((req.body || {}).paso || '').slice(0, 60), datos: (req.body || {}).datos || null });
    res.json({ ok: true });
  });
  app.post(P + '/modelos/:vid/cancelar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const t = TRAD.get(String(req.params.vid)), b = req.body || {};
    if (t && t.pid === req.pid) { bitacora(t, 'cancelar', { motivo: String(b.motivo || 'el usuario canceló').slice(0, 1500), paso: String(b.paso || '').slice(0, 60), datos: b.datos || null }); if (b.motivo && !t.instalado) audita(t.quien, 'forma.modelo.error', t.pid, t.archivo, { motivo: String(b.motivo).slice(0, 500), paso: String(b.paso || '').slice(0, 60) }); }
    if (t && t.pid === req.pid && !t.instalado) { if (t.w) try { t.w.terminate(); } catch (e) {} if (t.wa) try { t.wa.terminate(); } catch (e) {} const guarda = t.indice && t.indice.estado === 'listo' && !b.borrar; for (const r of [t.geometria].concat(guarda ? [] : [t.indice && t.indice.ruta, t.indice && t.indice.ruta && t.indice.ruta.replace(/\.sqlite$/, '.json')])) if (r) try { fsM.unlinkSync(r); } catch (e) {} TRAD.delete(t.vid); }
    res.json({ ok: true });
  });
  /** La biblioteca del visor de Autodesk, servida por el CDE (cacheada en DATOS/lmv-cache): sus hilos (workers) se cargan
   *  del mismo origen. A los hilos se les antepone un envoltorio de WebSocket que acepta el subprotocolo como objeto (algunos
   *  navegadores dejaron de tolerarlo). Los datos del modelo van directo del navegador a Autodesk. */
  const SHIM_WS = "/*CDE-WS*/;(function(){try{var W=self.WebSocket;if(!W||W.__cde)return;var F=function(u,p){if(p&&typeof p==='object'&&!Array.isArray(p)){var q=p.protocol||p.protocols;p=(typeof q==='string'||Array.isArray(q))?q:undefined;}return p===undefined?new W(u):new W(u,p);};F.prototype=W.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){F[k]=W[k];});F.__cde=1;self.WebSocket=F;}catch(e){}})();\n";
  const MIME_LMV = { js: 'application/javascript', css: 'text/css', wasm: 'application/wasm', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', ico: 'image/x-icon', html: 'text/html' };
  app.get('/lmv/:ver/*', async (req, res) => {
    const ver = String(req.params.ver || ''), ruta = String(req.params[0] || '');
    if (!/^7\.(\d+(\.\d+)*|\*)$/.test(ver) || !ruta || ruta.includes('..')) return res.status(400).send('ruta no válida');
    const tipo = MIME_LMV[(ruta.split('.').pop() || '').toLowerCase()] || 'application/octet-stream', hilo = /worker[^/]*\.js$/i.test(ruta);
    const archivo = pathM.join(ctx.datosDir, 'lmv-cache', ver.replace('*', '_'), ruta.replace(/[^a-zA-Z0-9._/-]/g, '_'));
    if (fsM.existsSync(archivo)) { res.type(tipo); res.set('Cache-Control', 'public, max-age=86400'); return fsM.createReadStream(archivo).pipe(res); }
    try {
      const r = await fetch(base() + '/modelderivative/v2/viewers/' + ver + '/' + ruta); if (!r.ok) return res.status(r.status).send('Autodesk: ' + r.status);
      let buf = Buffer.from(await r.arrayBuffer()); if (hilo) buf = Buffer.concat([Buffer.from(SHIM_WS), buf]);
      fsM.mkdir(pathM.dirname(archivo), { recursive: true }, () => fsM.writeFile(archivo, buf, () => {}));
      res.type(tipo); res.set('Cache-Control', 'public, max-age=86400'); res.send(buf);
    } catch (e) { res.status(502).send('No se pudo traer la biblioteca del visor de Autodesk: ' + e.message); }
  });
  // conteo de modelos por enlace (para la fila del enlace): cuantos modelos vigentes y cuantos ya estan en el visor
  ctx.forma.modelosDeEnlace = (eid) => {
    const L = q.todos("SELECT fi.contenedor_id AS cid, MAX(fi.n_cde) AS n FROM forma_items fi WHERE fi.enlace_id = ? AND fi.estado = 'traido' GROUP BY fi.contenedor_id", eid);
    let modelos = 0, enVisor = 0;
    for (const x of L) { const v = q.uno('SELECT v.id, v.archivo, i.estado, i.ruta_geometria FROM versiones v LEFT JOIN indices_modelo i ON i.version_id = v.id WHERE v.contenedor_id = ? AND v.n = ?', x.cid, x.n); if (!v || !EXT_MODELO.test(v.archivo)) continue; modelos++; if (v.estado === 'listo' && v.ruta_geometria) enVisor++; }
    return { modelos, enVisor };
  };

  // ───────── aviso inmediato de Autodesk (webhook), solo si el CDE tiene direccion publica https
  app.post('/api/proyectos/:pid/forma/vigilar', requiereSesion, requiereRol('gestor'), J, async (req, res) => {
    try {
      const e = enlaceDe(req.pid, String((req.body || {}).enlace || '')); if (!e) throw err('Elige el enlace que se vigilará.', 'datos');
      const url = (process.env.URL_PUBLICA || '').replace(/\/$/, '') + '/api/forma/webhook';
      if (!/^https:\/\//.test(url)) throw err('El aviso inmediato necesita que el CDE tenga una dirección pública https (URL_PUBLICA). Sin ella, usa la sincronización automática.', 'datos');
      const r = await fetch(base() + '/webhooks/v1/systems/data/events/dm.version.added/hooks', { method: 'POST', headers: { Authorization: 'Bearer ' + await ficha(req.quien), 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: url, scope: { folder: e.carpeta }, hookAttribute: { cde_enlace: e.id } }) });
      if (!r.ok && r.status !== 409) throw err('Autodesk no registró el aviso (' + r.status + '): ' + (await r.text()).slice(0, 200), 'forma');
      q.corre('UPDATE forma_enlaces SET automatico = 1 WHERE id = ?', e.id); audita(req.quien, 'forma.vigilar', req.pid, e.carpeta_nombre, {}); res.json({ ok: true });
    } catch (e) { fallo(res, e); }
  });
  /** Lo que llama Autodesk al subirse una version: se comprueba la firma y se sincroniza el enlace que vigila esa carpeta. */
  app.post('/api/forma/webhook', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
    try {
      if (!SECRETO_WEBHOOK) return res.status(503).end();   // sin secreto no se puede comprobar quien llama
      const firma = Buffer.from(String(req.get('x-adsk-signature') || '')), esperada = Buffer.from('sha1hash=' + crypto.createHmac('sha1', SECRETO_WEBHOOK).update(req.body).digest('hex'));
      if (firma.length !== esperada.length || !crypto.timingSafeEqual(firma, esperada)) return res.status(401).end();
      res.status(200).end();
      const ev = JSON.parse(req.body.toString('utf8')), eid = ((ev.hook || {}).hookAttribute || {}).cde_enlace;
      const e = eid && abre(q.uno("SELECT * FROM forma_enlaces WHERE id = ? AND quitado = ''", String(eid))); if (e) arranca(e);
    } catch (e) { if (!res.headersSent) res.status(200).end(); }
  });
}

module.exports = { monta };
