/*
 * CONECTOR MICROSOFT 365 -> CDE: trae al CDE los archivos de una carpeta de OneDrive o de una biblioteca de SharePoint.
 *
 * Como funciona (el mismo recorrido que el conector de Autodesk Forma):
 *  1. CONECTAR. Cada usuario conecta su cuenta de Microsoft 365 (OAuth con codigo de autorizacion, solo lectura:
 *     Files.Read.All y Sites.Read.All delegados). El permiso de renovacion se guarda cifrado. Una sola conexion sirve para
 *     OneDrive y para SharePoint.
 *  2. ENLAZAR. Un enlace une una carpeta de OneDrive / SharePoint con una carpeta del CDE, con o sin subcarpetas.
 *  3. TRAER. Se recorre la carpeta, se baja cada archivo que falta o que cambio (Microsoft Graph) y se carga en el CDE por
 *     la MISMA puerta que la web y los complementos (/subir): valen la nomenclatura de la carpeta, los permisos, el lector
 *     de modelos y los flujos automaticos. Un archivo que cambia en la nube entra como una version nueva de su documento.
 *  4. SINCRONIZAR. A mano («Sincronizar ahora») o sola cada MS_INTERVALO_MIN minutos para los enlaces automaticos.
 *
 * Configuracion (.env o cde.env del CDE): MS_CLIENT_ID, MS_CLIENT_SECRET y, si la aplicacion es de un solo inquilino,
 * MS_TENANT (id o dominio del directorio; por defecto «organizations»). La aplicacion se registra en Microsoft Entra con la
 * direccion de retorno que muestra la pantalla del conector. El CDE no escribe ni borra nada en Microsoft 365.
 */
'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');
const { q, ahora, id, audita, json } = require('./bd');
const CAR = require('./carpetas');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS ms_cuentas (
  email TEXT PRIMARY KEY, cuenta TEXT DEFAULT '', nombre TEXT DEFAULT '', refresco TEXT NOT NULL, conectada TEXT NOT NULL, error TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS ms_enlaces (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, origen TEXT NOT NULL, sitio TEXT DEFAULT '', sitio_nombre TEXT DEFAULT '', unidad TEXT NOT NULL, unidad_nombre TEXT DEFAULT '',
  carpeta TEXT NOT NULL, carpeta_nombre TEXT DEFAULT '', carpeta_cde TEXT NOT NULL, organizacion TEXT DEFAULT '', subcarpetas INTEGER DEFAULT 1, automatico INTEGER DEFAULT 0,
  por TEXT NOT NULL, creado TEXT NOT NULL, ultimo TEXT DEFAULT '', resumen TEXT DEFAULT '{}', error TEXT DEFAULT '', quitado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_ms_enlaces ON ms_enlaces (proyecto_id, quitado);
CREATE TABLE IF NOT EXISTS ms_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, enlace_id TEXT NOT NULL, proyecto_id TEXT NOT NULL, item TEXT NOT NULL, marca TEXT NOT NULL, nombre TEXT NOT NULL, ruta TEXT DEFAULT '',
  tamano INTEGER DEFAULT 0, autor TEXT DEFAULT '', fecha_nube TEXT DEFAULT '', contenedor_id TEXT DEFAULT '', n_cde INTEGER DEFAULT 0, estado TEXT NOT NULL, detalle TEXT DEFAULT '',
  fecha TEXT NOT NULL, UNIQUE (enlace_id, item, marca));
CREATE INDEX IF NOT EXISTS ix_ms_items ON ms_items (enlace_id, estado);
`;
const ORIGENES = { onedrive: 'OneDrive', sharepoint: 'SharePoint' };

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express } = ctx, I = ctx.cdeInterno;
  require('./bd').db.exec(ESQUEMA);
  const J = express.json({ limit: '1mb' });
  // En pruebas, un servidor local hace de Microsoft (solo direcciones 127.0.0.1).
  const prueba = () => { const p = process.env.MS_PRUEBA || ''; return /^http:\/\/127\.0\.0\.1:\d+$/.test(p) ? p : ''; };
  const inquilino = () => String(process.env.MS_TENANT || 'organizations').trim().replace(/[^\w.-]/g, '') || 'organizations';
  const acceso = () => prueba() ? prueba() + '/' + inquilino() + '/oauth2/v2.0' : 'https://login.microsoftonline.com/' + inquilino() + '/oauth2/v2.0';
  const grafo = () => prueba() ? prueba() + '/v1.0' : 'https://graph.microsoft.com/v1.0';
  const configurado = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
  const retorno = (req) => process.env.MS_CALLBACK || ((process.env.URL_PUBLICA || '').replace(/\/$/, '') || (req.protocol + '://' + req.get('host'))) + '/api/microsoft/vuelta';
  const ALCANCE = 'offline_access User.Read Files.Read.All Sites.Read.All';
  const MAX_MB = Number(process.env.MS_MAX_MB) || 4096, INTERVALO = Math.max(5, Number(process.env.MS_INTERVALO_MIN) || 30);
  const err = (msg, codigo, status) => Object.assign(new Error(msg), { codigo, status });
  const fallo = (res, e) => res.status(e.status || 400).json({ error: e.codigo || 'microsoft', mensaje: e.message });
  const limpiaId = (x) => String(x || '').replace(/[^\w!.,\-]/g, '').slice(0, 300);

  // ───────── el permiso de renovacion se guarda cifrado con el secreto de sesion del CDE
  const CLAVE = crypto.scryptSync(process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion', 'cde-anin-microsoft', 32);
  const cifra = (t) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv), b = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64url'); };
  const descifra = (t) => { try { const b = Buffer.from(String(t || ''), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', CLAVE, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch (e) { return ''; } };

  // ───────── fichas de acceso: una por usuario conectado, renovada cuando falta menos de un minuto para que venza
  const FICHAS = new Map(), RENOVANDO = new Map();
  async function pideFicha(cuerpo) {
    const r = await fetch(acceso() + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.assign({ client_id: String(process.env.MS_CLIENT_ID).trim(), client_secret: String(process.env.MS_CLIENT_SECRET).trim(), scope: ALCANCE }, cuerpo)) });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw err(String(t.error_description || t.error || ('Microsoft no entregó el acceso (' + r.status + ').')).split('\r\n')[0].slice(0, 300), 'microsoft-acceso'); return t;
  }
  async function ficha(email) {
    email = String(email || '').toLowerCase(); const f = FICHAS.get(email); if (f && f.vence > Date.now() + 60000) return f.token;
    if (RENOVANDO.has(email)) return RENOVANDO.get(email);
    const tarea = (async () => {
      const c = q.uno('SELECT * FROM ms_cuentas WHERE email = ?', email), ref = c && descifra(c.refresco);
      if (!ref) throw err('Conecta tu cuenta de Microsoft 365 para usar OneDrive y SharePoint.', 'microsoft-sin-conexion', 409);
      try {
        const t = await pideFicha({ grant_type: 'refresh_token', refresh_token: ref });
        if (t.refresh_token) q.corre("UPDATE ms_cuentas SET refresco = ?, error = '' WHERE email = ?", cifra(t.refresh_token), email);
        FICHAS.set(email, { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000 }); return t.access_token;
      } catch (e) { q.corre('UPDATE ms_cuentas SET error = ? WHERE email = ?', String(e.message).slice(0, 300), email); throw err('La conexión con Microsoft 365 venció o fue revocada: vuelve a conectar la cuenta. (' + e.message + ')', 'microsoft-sin-conexion', 409); }
    })();
    RENOVANDO.set(email, tarea); try { return await tarea; } finally { RENOVANDO.delete(email); }
  }
  const esDeGrafo = (u) => /^https:\/\/graph\.microsoft\.com\//.test(u) || (prueba() && u.startsWith(prueba() + '/'));
  /** GET a Microsoft Graph con la ficha del usuario; espera y reintenta si Microsoft pide ir mas despacio (429 / 503). */
  async function ms(ruta, email) {
    const url = /^https?:\/\//.test(ruta) ? ruta : grafo() + ruta; if (!esDeGrafo(url)) throw err('Dirección de Microsoft no admitida.', 'microsoft');
    for (let intento = 0; ; intento++) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + await ficha(email) } });
      if ((r.status === 429 || r.status === 503) && intento < 4) { await new Promise(ok => setTimeout(ok, Math.min(30, Number(r.headers.get('retry-after')) || 2 * (intento + 1)) * 1000)); continue; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err(r.status === 403 ? 'Microsoft no permite ver ese contenido con tu cuenta (403). Revisa tus permisos y que la aplicación tenga concedidos Files.Read.All y Sites.Read.All.' : r.status === 404 ? 'Microsoft no encuentra ese elemento (404).' : 'Microsoft respondió ' + r.status + ((j.error && j.error.message) ? ': ' + String(j.error.message).slice(0, 200) : '') + '.', 'microsoft', 502);
      return j;
    }
  }
  async function paginas(ruta, email, tope) {
    const todo = []; let url = ruta, n = 0;
    while (url && n++ < (tope || 100)) { const j = await ms(url, email); (j.value || []).forEach(x => todo.push(x)); const sig = j['@odata.nextLink']; url = sig && esDeGrafo(sig) ? sig : ''; }
    return todo;
  }

  // ───────── conectar / desconectar la cuenta de Microsoft 365
  const cuentaDe = (email) => q.uno('SELECT email, cuenta, nombre, conectada, error FROM ms_cuentas WHERE email = ?', String(email || '').toLowerCase());
  const vuelveA = (pid, origen) => '#/' + (pid ? 'p/' + pid + '/puente' : '');
  app.get('/api/microsoft/estado', requiereSesion, (req, res) => { const c = cuentaDe(req.quien); res.json({ configurado: configurado(), app: configurado() ? String(process.env.MS_CLIENT_ID).trim().slice(-4) : '', inquilino: inquilino(), retorno: retorno(req), conectado: !!c, cuenta: c ? { correo: c.cuenta, nombre: c.nombre, desde: c.conectada, error: c.error } : null, intervaloMin: INTERVALO, maxMb: MAX_MB }); });
  app.get('/api/microsoft/conectar', requiereSesion, (req, res) => {
    if (!configurado()) return res.status(400).send('Falta configurar MS_CLIENT_ID y MS_CLIENT_SECRET en el archivo .env (o cde.env) de la carpeta del CDE.');
    const estado = crypto.randomBytes(18).toString('hex'), pid = String(req.query.pid || '').replace(/[^\w-]/g, '').slice(0, 60), origen = ORIGENES[req.query.origen] ? String(req.query.origen) : 'onedrive';
    res.cookie('cde_ms', estado + '.' + pid + '.' + origen, { httpOnly: true, sameSite: 'lax', maxAge: 600000 });
    const u = new URL(acceso() + '/authorize'); u.searchParams.set('client_id', String(process.env.MS_CLIENT_ID).trim()); u.searchParams.set('response_type', 'code'); u.searchParams.set('redirect_uri', retorno(req)); u.searchParams.set('response_mode', 'query'); u.searchParams.set('scope', ALCANCE); u.searchParams.set('state', estado); u.searchParams.set('prompt', 'select_account');
    res.redirect(u.toString());
  });
  app.get('/api/microsoft/vuelta', requiereSesion, async (req, res) => {
    const [estado, pid, origen] = String((req.cookies && req.cookies.cde_ms) || '').split('.'); res.clearCookie('cde_ms');
    const a = (msg) => res.redirect('/?microsoft=' + encodeURIComponent(msg) + '&nube=' + (ORIGENES[origen] ? origen : 'onedrive') + vuelveA(pid));
    try {
      if (req.query.error) return a('error:' + String(req.query.error_description || req.query.error).split('\r\n')[0].slice(0, 240));
      if (!estado || String(req.query.state || '') !== estado) return a('error:La respuesta de Microsoft no corresponde a esta sesión. Vuelve a pulsar «Conectar con Microsoft 365».');
      const t = await pideFicha({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: retorno(req) });
      if (!t.refresh_token) return a('error:Microsoft no entregó el permiso de renovación (falta el permiso offline_access en la aplicación).');
      let p = {}; try { p = await (await fetch(grafo() + '/me', { headers: { Authorization: 'Bearer ' + t.access_token } })).json(); } catch (e) {}
      const email = String(req.quien).toLowerCase();
      q.corre("INSERT INTO ms_cuentas (email, cuenta, nombre, refresco, conectada, error) VALUES (?,?,?,?,?,'') ON CONFLICT(email) DO UPDATE SET cuenta = excluded.cuenta, nombre = excluded.nombre, refresco = excluded.refresco, conectada = excluded.conectada, error = ''",
        email, String(p.mail || p.userPrincipalName || '').slice(0, 200), String(p.displayName || '').slice(0, 200), cifra(t.refresh_token), ahora());
      FICHAS.set(email, { token: t.access_token, vence: Date.now() + (Number(t.expires_in) || 3000) * 1000 });
      audita(req.quien, 'microsoft.conectar', pid || '', String(p.mail || p.userPrincipalName || ''), {}); a('conectado');
    } catch (e) { a('error:' + String(e.message).slice(0, 240)); }
  });
  app.post('/api/microsoft/desconectar', requiereSesion, (req, res) => { const email = String(req.quien).toLowerCase(); q.corre('DELETE FROM ms_cuentas WHERE email = ?', email); FICHAS.delete(email); audita(req.quien, 'microsoft.desconectar', '', '', {}); res.json({ ok: true }); });

  // ───────── explorar: OneDrive del usuario, sitios de SharePoint, bibliotecas y carpetas
  const CAMPOS = '$select=id,name,size,folder,file,eTag,cTag,lastModifiedDateTime,lastModifiedBy,parentReference&$top=200';
  const fila = (x) => ({ id: x.id, nombre: x.name, carpeta: !!x.folder, hijos: x.folder ? Number(x.folder.childCount) || 0 : 0, tamano: Number(x.size) || 0, modificado: x.lastModifiedDateTime || '', por: (x.lastModifiedBy && x.lastModifiedBy.user && x.lastModifiedBy.user.displayName) || '', marca: String(x.cTag || x.eTag || x.lastModifiedDateTime || '') });
  const hijosDe = async (unidad, item, email) => (await paginas('/drives/' + encodeURIComponent(unidad) + (item ? '/items/' + encodeURIComponent(item) : '/root') + '/children?' + CAMPOS, email)).map(fila).sort((a, b) => (b.carpeta - a.carpeta) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  app.get('/api/microsoft/onedrive', requiereSesion, async (req, res) => { try { const d = await ms('/me/drive?$select=id,name,driveType,owner', req.quien); res.json({ unidad: d.id, nombre: 'OneDrive' + ((d.owner && d.owner.user && d.owner.user.displayName) ? ' de ' + d.owner.user.displayName : '') }); } catch (e) { fallo(res, e); } });
  app.get('/api/microsoft/sitios', requiereSesion, async (req, res) => {
    try {
      const b = String(req.query.q || '').trim().slice(0, 80);
      const L = b ? await paginas('/sites?search=' + encodeURIComponent(b) + '&$select=id,displayName,name,webUrl&$top=50', req.quien, 2) : await paginas('/me/followedSites?$select=id,displayName,name,webUrl', req.quien, 2).catch(() => []);
      const sitios = (L.length || b ? L : await paginas('/sites?search=*&$select=id,displayName,name,webUrl&$top=50', req.quien, 1).catch(() => [])).map(s => ({ id: s.id, nombre: s.displayName || s.name || s.webUrl, url: s.webUrl || '' })).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es', { numeric: true }));
      res.json({ sitios, buscado: b });
    } catch (e) { fallo(res, e); }
  });
  app.get('/api/microsoft/sitios/:sid/bibliotecas', requiereSesion, async (req, res) => { try { const L = await paginas('/sites/' + encodeURIComponent(limpiaId(req.params.sid)) + '/drives?$select=id,name,driveType', req.quien, 3); res.json({ bibliotecas: L.map(d => ({ id: d.id, nombre: d.name })).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) }); } catch (e) { fallo(res, e); } });
  app.get('/api/microsoft/unidades/:unidad/contenido', requiereSesion, async (req, res) => { try { res.json({ items: await hijosDe(limpiaId(req.params.unidad), limpiaId(req.query.item), req.quien) }); } catch (e) { fallo(res, e); } });

  // ───────── enlaces: carpeta de la nube ↔ carpeta del CDE
  const P = '/api/proyectos/:pid/microsoft';
  const TAREAS = new Map();   // enlace -> { fase, total, hecho, nombre }
  const abre = (e) => Object.assign({}, e, { resumen: json(e.resumen, {}), origenNombre: ORIGENES[e.origen] || e.origen, enCurso: TAREAS.get(e.id) || null });
  const enlaceDe = (req) => q.uno("SELECT * FROM ms_enlaces WHERE id = ? AND proyecto_id = ? AND quitado = ''", String(req.params.eid), req.pid);
  app.get(P + '/enlaces', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = I.proyecto(req.pid), u = I.yo(req, p), origen = ORIGENES[req.query.origen] ? String(req.query.origen) : '';
    const L = q.todos("SELECT * FROM ms_enlaces WHERE proyecto_id = ? AND quitado = ''" + (origen ? ' AND origen = ?' : '') + ' ORDER BY creado DESC', ...(origen ? [req.pid, origen] : [req.pid])).filter(e => I.permisoEn(p, u, e.carpeta_cde).leer || u.admin).map(abre);
    const cuenta = {}; for (const r of q.todos("SELECT origen, COUNT(*) AS n FROM ms_enlaces WHERE proyecto_id = ? AND quitado = '' GROUP BY origen", req.pid)) cuenta[r.origen] = r.n;
    res.json({ enlaces: L, cuenta, puedoCrear: u.admin || ['autor', 'miembro', 'document-control', 'gestor', 'administrador'].includes(u.rol) });
  });
  app.post(P + '/enlaces', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    try {
      const p = I.proyecto(req.pid), u = I.yo(req, p), b = req.body || {}, origen = ORIGENES[b.origen] ? b.origen : '';
      if (!origen) throw err('Indica si la carpeta es de OneDrive o de SharePoint.', 'datos');
      const unidad = limpiaId(b.unidad), carpeta = limpiaId(b.carpeta), carpetaCde = CAR.limpia(b.carpeta_cde).slice(0, 300);
      if (!unidad) throw err('Elige la carpeta de ' + ORIGENES[origen] + '.', 'datos');
      if (!carpetaCde || !CAR.def(p.config.carpetas || [], carpetaCde)) throw err('Elige la carpeta del CDE donde se cargará.', 'carpeta');
      if (!I.permisoEn(p, u, carpetaCde).subir) throw err('No tienes permiso de carga en ' + carpetaCde + '.', 'sin-permiso', 403);
      await ms('/drives/' + encodeURIComponent(unidad) + (carpeta ? '/items/' + encodeURIComponent(carpeta) : '/root') + '?$select=id,name', req.quien);   // existe y la cuenta la ve
      const e = { id: id('ms'), proyecto_id: req.pid, origen, sitio: limpiaId(b.sitio), sitio_nombre: String(b.sitio_nombre || '').slice(0, 200), unidad, unidad_nombre: String(b.unidad_nombre || '').slice(0, 200), carpeta, carpeta_nombre: String(b.carpeta_nombre || '').slice(0, 400),
        carpeta_cde: carpetaCde, organizacion: u.organizacion || '', subcarpetas: b.subcarpetas === false ? 0 : 1, automatico: b.automatico ? 1 : 0, por: String(req.quien).toLowerCase(), creado: ahora() };
      q.corre('INSERT INTO ms_enlaces (id, proyecto_id, origen, sitio, sitio_nombre, unidad, unidad_nombre, carpeta, carpeta_nombre, carpeta_cde, organizacion, subcarpetas, automatico, por, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        e.id, e.proyecto_id, e.origen, e.sitio, e.sitio_nombre, e.unidad, e.unidad_nombre, e.carpeta, e.carpeta_nombre, e.carpeta_cde, e.organizacion, e.subcarpetas, e.automatico, e.por, e.creado);
      audita(req.quien, 'microsoft.enlazar', req.pid, e.carpeta_cde, { origen, de: (e.sitio_nombre ? e.sitio_nombre + ' › ' : '') + e.unidad_nombre + (e.carpeta_nombre ? '/' + e.carpeta_nombre : '') });
      lanza(e, e.por, req.socket.localPort);
      res.json({ ok: true, enlace: abre(e) });
    } catch (e) { fallo(res, e); }
  });
  const puedeSobre = (req, e) => { const p = I.proyecto(req.pid), u = I.yo(req, p); return u.admin || u.rol === 'gestor' || u.rol === 'administrador' || e.por === String(req.quien).toLowerCase(); };
  app.post(P + '/enlaces/:eid/sincronizar', requiereSesion, requiereRol('autor'), (req, res) => {
    const e = enlaceDe(req); if (!e) return res.status(404).json({ error: 'no-existe' });
    if (TAREAS.has(e.id)) return res.status(409).json({ error: 'en-curso', mensaje: 'Este enlace ya se está sincronizando.' });
    lanza(e, String(req.quien).toLowerCase(), req.socket.localPort); res.json({ ok: true });
  });
  app.put(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const e = enlaceDe(req); if (!e) return res.status(404).json({ error: 'no-existe' }); if (!puedeSobre(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien creó el enlace o un gestor puede cambiarlo.' });
    q.corre('UPDATE ms_enlaces SET automatico = ? WHERE id = ?', (req.body || {}).automatico ? 1 : 0, e.id); res.json({ ok: true });
  });
  app.delete(P + '/enlaces/:eid', requiereSesion, requiereRol('autor'), (req, res) => {
    const e = enlaceDe(req); if (!e) return res.status(404).json({ error: 'no-existe' }); if (!puedeSobre(req, e)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo quien creó el enlace o un gestor puede quitarlo.' });
    q.corre('UPDATE ms_enlaces SET quitado = ? WHERE id = ?', ahora(), e.id); audita(req.quien, 'microsoft.desenlazar', req.pid, e.carpeta_cde, { origen: e.origen }); res.json({ ok: true });
  });
  app.get(P + '/enlaces/:eid/items', requiereSesion, requiereRol('lector'), (req, res) => {
    const e = enlaceDe(req); if (!e) return res.status(404).json({ error: 'no-existe' });
    res.json({ enlace: abre(e), items: q.todos('SELECT nombre, ruta, tamano, autor, fecha_nube, contenedor_id, n_cde, estado, detalle, fecha FROM ms_items WHERE enlace_id = ? ORDER BY id DESC LIMIT 2000', e.id) });
  });

  // ───────── traer
  function aseguraCarpeta(pid, ruta) {
    const p = I.proyecto(pid); if (CAR.def(p.config.carpetas, ruta)) return;
    let padre = '';
    for (const n of ruta.split('/')) { const r = padre ? padre + '/' + n : n; if (!CAR.def(p.config.carpetas, r)) { const c = CAR.crea(p.config.carpetas, padre, n, {}); if (c.error) throw err('No se pudo crear la carpeta ' + r + ': ' + c.error, 'carpeta'); p.config.carpetas = c.carpetas; I.guardaConfig(p); audita('conector:microsoft', 'carpeta.crear', pid, r, { origen: 'microsoft' }); } padre = r; }
  }
  const anota = (e, it, estado, detalle, extra) => q.corre('INSERT INTO ms_items (enlace_id, proyecto_id, item, marca, nombre, ruta, tamano, autor, fecha_nube, contenedor_id, n_cde, estado, detalle, fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(enlace_id, item, marca) DO UPDATE SET estado = excluded.estado, detalle = excluded.detalle, contenedor_id = excluded.contenedor_id, n_cde = excluded.n_cde, fecha = excluded.fecha',
    e.id, e.proyecto_id, it.id, it.marca, it.nombre, it.ruta || '', it.tamano || 0, it.por || '', it.modificado || '', (extra && extra.cid) || '', (extra && extra.n) || 0, estado, String(detalle || '').slice(0, 400), ahora());
  async function recorre(e, email, t, item, ruta, lista, nivel) {
    for (const x of await hijosDe(e.unidad, item, email)) {
      if (x.carpeta) { if (e.subcarpetas && (nivel || 0) < 12) await recorre(e, email, t, x.id, ruta ? ruta + '/' + x.nombre : x.nombre, lista, (nivel || 0) + 1); }
      else lista.push(Object.assign(x, { ruta }));
      t.vistos = lista.length;
    }
  }
  async function trae(e, it, email, puerto) {
    if (q.uno("SELECT 1 FROM ms_items WHERE enlace_id = ? AND item = ? AND marca = ? AND estado = 'traido'", e.id, it.id, it.marca)) return false;
    if (it.tamano > MAX_MB * 1048576) { anota(e, it, 'omitido', 'Pesa más de ' + MAX_MB + ' MB (MS_MAX_MB).'); return false; }
    const archivo = await fetch(grafo() + '/drives/' + encodeURIComponent(e.unidad) + '/items/' + encodeURIComponent(it.id) + '/content', { headers: { Authorization: 'Bearer ' + await ficha(email) }, redirect: 'follow' });
    if (!archivo.ok || !archivo.body) throw err('La descarga desde Microsoft falló (' + archivo.status + ').', 'microsoft');
    const carpeta = e.carpeta_cde + (it.ruta ? '/' + it.ruta : ''); if (it.ruta) aseguraCarpeta(e.proyecto_id, carpeta);
    const meta = { microsoft: { origen: e.origen, sitio: e.sitio_nombre, unidad: e.unidad_nombre, carpeta: (e.carpeta_nombre || '') + (it.ruta ? '/' + it.ruta : ''), item: it.id, marca: it.marca, por: it.por, fecha: it.modificado, traidoPor: email } };
    const r = await fetch('http://127.0.0.1:' + (puerto || ctx.puerto) + '/api/proyectos/' + e.proyecto_id + '/subir?origen=' + e.origen + '&organizacion=' + encodeURIComponent(e.organizacion) + '&carpeta=' + encodeURIComponent(carpeta),
      { method: 'POST', headers: { 'x-cde-llave': ctx.llaveInterna, 'x-cde-por': email, 'x-nombre': encodeURIComponent(it.nombre), 'x-meta': encodeURIComponent(JSON.stringify(meta)) }, body: Readable.fromWeb(archivo.body), duplex: 'half' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(j.mensaje || j.error || ('El CDE no aceptó el archivo (' + r.status + ').'), j.error || 'cde');
    anota(e, it, 'traido', '', { cid: (j.contenedor && j.contenedor.id) || j.contenedor || '', n: Number(j.n) || 0 }); return true;
  }
  async function sincroniza(e, email, puerto, t) {
    const lista = []; t.fase = 'leyendo'; await recorre(e, email, t, e.carpeta, '', lista, 0);
    t.fase = 'trayendo'; t.total = lista.length; const R = { archivos: lista.length, traidos: 0, yaEstaban: 0, noEntraron: 0, omitidos: 0 };
    for (const it of lista) {
      t.hecho = (t.hecho || 0) + 1; t.nombre = it.nombre;
      try { if (await trae(e, it, email, puerto)) R.traidos++; else if (q.uno("SELECT 1 FROM ms_items WHERE enlace_id = ? AND item = ? AND marca = ? AND estado = 'omitido'", e.id, it.id, it.marca)) R.omitidos++; else R.yaEstaban++; }
      catch (x) { if (x.codigo === 'microsoft-sin-conexion') throw x; R.noEntraron++; anota(e, it, 'pendiente', x.codigo === 'nomenclatura' ? 'El nombre no cumple la norma de la carpeta de destino: enlaza hacia una carpeta de trabajo en progreso (WIP) y desde ahí cópialo o muévelo al compartido.' : x.message); }
    }
    return R;
  }
  function lanza(e, email, puerto) {
    if (TAREAS.has(e.id)) return; const t = { fase: 'leyendo', total: 0, hecho: 0, vistos: 0, nombre: '', desde: ahora() }; TAREAS.set(e.id, t);
    sincroniza(e, email, puerto, t).then(R => { q.corre("UPDATE ms_enlaces SET ultimo = ?, resumen = ?, error = '' WHERE id = ?", ahora(), JSON.stringify(R), e.id); audita(email, 'microsoft.sincronizar', e.proyecto_id, e.carpeta_cde, Object.assign({ origen: e.origen }, R)); })
      .catch(x => { q.corre('UPDATE ms_enlaces SET ultimo = ?, error = ? WHERE id = ?', ahora(), String(x.message).slice(0, 300), e.id); })
      .finally(() => TAREAS.delete(e.id));
  }
  // enlaces automaticos: se vuelven a recorrer cada MS_INTERVALO_MIN minutos con la cuenta de quien los creo
  const reloj = setInterval(() => { if (!configurado()) return; for (const e of q.todos("SELECT * FROM ms_enlaces WHERE automatico = 1 AND quitado = ''")) if (cuentaDe(e.por)) lanza(e, e.por, ctx.puerto); }, INTERVALO * 60000);
  if (reloj.unref) reloj.unref();
}

module.exports = { monta };
