/*
 * Firma digital con ReFirma (v0.25.0): el CDE llama a ReFirma Invoker de RENIEC para que quien elaboró el documento lo firme.
 *
 * Cómo funciona ReFirma Invoker (guía de integración de RENIEC y ejemplo oficial de Gobierno Digital):
 *   1. La página carga el script de RENIEC (dsp.reniec.gob.pe/refirma_invoker/…) y llama initInvoker('W').
 *   2. El componente instalado en la PC pide los argumentos (evento «getArguments») y la página se los da («sendArguments»):
 *      un JSON en base64 con las credenciales de la entidad (clientId / clientSecret que entrega RENIEC), la URL de donde ReFirma
 *      DESCARGA el PDF y la URL a la que lo DEVUELVE firmado (POST multipart, campo = idFile).
 *   3. ReFirma PDF abre, la persona elige su certificado (DNIe o certificado de ReFirma), firma, y sube el PDF firmado.
 *   4. El CDE verifica la firma (lib/firma.js): íntegra, vigente, de una entidad de confianza y de quien dice «ELAB. POR».
 * Las URL de descarga y devolución llevan un código de un solo uso (vence en 2 horas): ReFirma no tiene la sesión del navegador.
 * Cada paso queda anotado (lo que hizo el navegador y lo que hizo ReFirma contra el CDE) para ver exactamente dónde se detiene.
 *
 * Variables de entorno (las escribe el administrador en Render, nunca en el código):
 *   REFIRMA_CLIENT_ID, REFIRMA_CLIENT_SECRET  credenciales de la entidad ante RENIEC (sin ellas la llamada se hace igual, en modo
 *                                             diagnóstico, para ver qué responde ReFirma)
 *   REFIRMA_INVOKER_JS                         script del Invoker (por defecto el de ClickOnce de RENIEC)
 *   REFIRMA_FIRMA_VISIBLE=1                    sello visible de la firma (por defecto la firma va sin sello visible, para no tapar la portada)
 *   URL_PUBLICA                                dirección pública del CDE (si no, la de la petición)
 * Raíces de confianza: certificados raíz/intermedios de RENIEC / ECERNEP en DATOS_DIR/firma-raices (se cargan desde el CDE).
 */
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const FIR = require('./firma');

const VIGENCIA = 2 * 3600e3, TOPE = 100 * 1024 * 1024;
const JS = { clickonce: 'https://dsp.reniec.gob.pe/refirma_invoker/resources/js/clientclickonce.js', java: 'https://dsp.reniec.gob.pe/refirma_invoker/resources/js/client.js' };
let DIR = null;   // DATOS_DIR/firma-pend

// ───────── pendientes de firma ─────────
const P = new Map();
function dirDe(t) { return path.join(DIR, t); }
function crea(o) {
  if (!DIR) throw new Error('firma sin montar');
  const token = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(dirDe(token), { recursive: true }); fs.writeFileSync(path.join(dirDe(token), 'original.pdf'), o.buf);
  const p = { token, pid: o.pid, quien: String(o.quien || '').toLowerCase(), tipo: o.tipo, carpeta: o.carpeta || '', nombre: FIR.sinMarcaReFirma(o.nombre), contenedor: o.contenedor || '', version: o.version || '',
    elabPor: o.elabPor || '', codigo: o.codigo || '', revision: o.revision || '', qaCtx: o.qaCtx || null, estado: 'pendiente', creado: Date.now(), expira: Date.now() + VIGENCIA, eventos: [], checks: [], firmante: null, tamano: o.buf.length };
  P.set(token, p); evento(p, 'servidor', 'creado', 'Documento listo para firmar: ' + p.nombre + (p.elabPor ? ' · debe firmar ' + p.elabPor : ''));
  return p;
}
function evento(p, de, ev, detalle) { p.eventos.push({ t: new Date().toISOString(), de, ev, detalle: String(detalle || '').slice(0, 400) }); if (p.eventos.length > 80) p.eventos.splice(0, p.eventos.length - 80); }
function limpia() { const ya = Date.now(); for (const [t, p] of P) if (p.expira < ya) { P.delete(t); try { fs.rmSync(dirDe(t), { recursive: true, force: true }); } catch (e) {} } }
const vista = (p) => ({ token: p.token, tipo: p.tipo, nombre: p.nombre, estado: p.estado, elabPor: p.elabPor, carpeta: p.carpeta, contenedor: p.contenedor, creado: new Date(p.creado).toISOString(), expira: new Date(p.expira).toISOString(), eventos: p.eventos, checks: p.checks, firmante: p.firmante, mensaje: p.mensaje || '' });

// ───────── raíces de confianza ─────────
let cache = { clave: '', certs: [] };
function dirRaices() { return path.join(path.dirname(DIR), 'firma-raices'); }
function raices() {
  const d = dirRaices(); let clave = '';
  try { clave = fs.readdirSync(d).map(f => f + ':' + fs.statSync(path.join(d, f)).mtimeMs).join('|'); } catch (e) { clave = ''; }
  if (clave !== cache.clave) cache = { clave, certs: FIR.cargaRaices(d) };
  return cache.certs;
}
const vistaRaiz = (c) => ({ nombre: (/(?:^|\n)CN=([^\n]+)/.exec(c.subject) || [])[1] || c.subject.split('\n').pop(), organizacion: (/(?:^|\n)O=([^\n]+)/.exec(c.subject) || [])[1] || '', huella: c.fingerprint256, desde: new Date(c.validFrom).toISOString(), hasta: new Date(c.validTo).toISOString(), autofirmada: c.checkIssued(c), archivo: c.archivo || '' });
function agregaRaiz(der) {
  const c = new crypto.X509Certificate(der); fs.mkdirSync(dirRaices(), { recursive: true });
  const ya = raices().find(x => x.fingerprint256 === c.fingerprint256); if (ya) return { ya: true, raiz: vistaRaiz(ya) };
  const nom = ((/(?:^|\n)CN=([^\n]+)/.exec(c.subject) || [])[1] || 'raiz').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60) + '-' + c.fingerprint256.replace(/:/g, '').slice(0, 12) + '.pem';
  fs.writeFileSync(path.join(dirRaices(), nom), c.toString()); cache.clave = '';
  return { raiz: vistaRaiz(Object.assign(c, { archivo: nom })) };
}

// ───────── cuerpo de la devolución de ReFirma: multipart (campo = idFile) o el PDF tal cual ─────────
function leeCuerpo(req) {
  return new Promise((ok, mal) => { const partes = []; let n = 0; req.on('data', d => { n += d.length; if (n > TOPE) { mal(new Error('El archivo firmado supera 100 MB.')); req.destroy(); } else partes.push(d); }); req.on('end', () => ok(Buffer.concat(partes))); req.on('error', mal); });
}
function archivoDelCuerpo(buf, tipo) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipo || '');
  if (!m) return { datos: buf, campo: '(cuerpo)', archivo: '' };
  const lim = Buffer.from('--' + (m[1] || m[2]).trim()); let i = buf.indexOf(lim); const out = [];
  while (i >= 0) {
    const ini = i + lim.length; if (buf.subarray(ini, ini + 2).toString() === '--') break;
    const finCab = buf.indexOf('\r\n\r\n', ini); if (finCab < 0) break;
    const cab = buf.subarray(ini, finCab).toString('utf8'), sig = buf.indexOf(lim, finCab + 4); if (sig < 0) break;
    const datos = buf.subarray(finCab + 4, sig - 2);
    out.push({ campo: (/name="([^"]*)"/i.exec(cab) || [])[1] || '', archivo: (/filename="([^"]*)"/i.exec(cab) || [])[1] || '', datos }); i = sig;
  }
  return out.find(x => x.archivo && /^%PDF/.test(x.datos.subarray(0, 5).toString('latin1'))) || out.find(x => /^%PDF/.test(x.datos.subarray(0, 5).toString('latin1'))) || out[0] || { datos: Buffer.alloc(0), campo: '', archivo: '' };
}

/** Verifica el PDF firmado que llega (de ReFirma o subido a mano) y deja el pendiente «firmado» o «rechazado». */
async function recibe(p, buf, de, QA) {
  if (!/^%PDF/.test(buf.subarray(0, 5).toString('latin1'))) { p.estado = 'rechazado'; p.mensaje = 'Lo que llegó no es un PDF (' + buf.length + ' bytes).'; evento(p, de, 'rechazado', p.mensaje); return p; }
  const orig = fs.readFileSync(path.join(dirDe(p.token), 'original.pdf'));
  const ev = FIR.evalua(buf, p.elabPor, { raices: raices() });
  let mismo = buf.length > orig.length && buf.subarray(0, orig.length).equals(orig), via = mismo ? 'el PDF firmado contiene, sin cambios, el documento validado (firma incremental)' : '';
  if (!mismo && QA && p.qaCtx) {   // un firmador que reescribe el PDF: se vuelve a validar la portada con el mismo código y revisión
    try { const qa = await QA.validaArchivo(buf, p.nombre, p.qaCtx); if (qa.ok && qa.datos.revision === p.revision) { mismo = true; via = 'el firmador reescribió el PDF; la portada vuelve a pasar la Validación QA (' + p.codigo + ' · ' + p.revision + ')'; } } catch (e) {}
  }
  ev.checks.unshift({ id: 'mismo', titulo: 'Es el documento que pasó la Validación QA', ok: mismo, detalle: mismo ? via : 'El PDF firmado no es el que se preparó para firmar (cambió su contenido o su portada).' });
  p.checks = ev.checks; p.firmante = ev.firmante; p.ok = ev.ok && mismo;
  if (p.ok) { fs.writeFileSync(path.join(dirDe(p.token), 'firmado.pdf'), buf); p.estado = 'firmado'; p.mensaje = 'Firmado por ' + (ev.firmante ? ev.firmante.nombre : '¿?') + '.'; evento(p, de, 'firmado', p.mensaje + ' Firma verificada en el CDE.'); }
  else { p.estado = 'rechazado'; p.mensaje = ev.checks.filter(c => !c.ok).map(c => c.titulo + ': ' + c.detalle).join(' · '); evento(p, de, 'rechazado', p.mensaje); }
  return p;
}

function monta(app, ctx) {
  const { requiereSesion, esAdminGlobal } = ctx;
  DIR = path.join(ctx.datosDir, 'firma-pend'); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} fs.mkdirSync(DIR, { recursive: true });
  const t = setInterval(limpia, 10 * 60e3); if (t.unref) t.unref();
  const QA = require('./qa');
  const base = (req) => (process.env.URL_PUBLICA || '').replace(/\/$/, '') || (req.protocol + '://' + req.get('host'));
  const credenciales = () => !!(String(process.env.REFIRMA_CLIENT_ID || '').trim() && String(process.env.REFIRMA_CLIENT_SECRET || '').trim());
  const suyo = (req, res) => { limpia(); const p = P.get(String(req.params.token)); if (!p) { res.status(404).json({ error: 'no-existe', mensaje: 'Ese pedido de firma ya venció o no existe: vuelve a validar el documento.' }); return null; } if (p.quien !== String(req.quien || '').toLowerCase() && !esAdminGlobal(req.quien)) { res.status(403).json({ error: 'sin-permiso' }); return null; } return p; };
  const deReFirma = (req, res) => { limpia(); const p = P.get(String(req.params.token)); if (!p) { res.status(404).type('text/plain').send('Pedido de firma vencido o inexistente.'); return null; } return p; };
  const quienPide = (req) => (req.get('user-agent') || 'sin user-agent').slice(0, 160) + ' · ' + (req.ip || '');

  app.get('/api/firma/estado', requiereSesion, (req, res) => res.json({ credenciales: credenciales(), invoker: { clickonce: JS.clickonce, java: JS.java, porDefecto: process.env.REFIRMA_INVOKER_JS || JS.clickonce }, visible: process.env.REFIRMA_FIRMA_VISIBLE === '1', raices: raices().map(vistaRaiz), admin: !!esAdminGlobal(req.quien), base: base(req) }));

  // ── lo que pide el navegador (con sesión) ──
  app.get('/api/firma/pend/:token', requiereSesion, (req, res) => { const p = suyo(req, res); if (p) res.json(vista(p)); });
  app.post('/api/firma/pend/:token/evento', requiereSesion, ctx.express.json({ limit: '20kb' }), (req, res) => { const p = suyo(req, res); if (!p) return; const b = req.body || {}; evento(p, 'navegador', String(b.ev || '').slice(0, 40), b.detalle); res.json({ ok: true }); });
  app.get('/api/firma/pend/:token/argumentos', requiereSesion, (req, res) => {
    const p = suyo(req, res); if (!p) return;
    if (p.estado === 'firmado') return res.status(409).json({ error: 'firmado', mensaje: 'El documento ya está firmado.' });
    const b = base(req), u = b + '/api/firma/refirma/' + p.token, cred = credenciales();
    const args = { app: 'pdf', clientId: String(process.env.REFIRMA_CLIENT_ID || '').trim(), clientSecret: String(process.env.REFIRMA_CLIENT_SECRET || '').trim(), idFile: 'documento', type: 'W', protocol: /^https:/i.test(b) ? 'S' : 'T',
      fileDownloadUrl: u + '/documento.pdf', fileDownloadLogoUrl: u + '/logo.png', fileDownloadStampUrl: u + '/sello.png', fileUploadUrl: u + '/firmado',
      contentFile: p.nombre, reason: 'Soy el autor del documento', isSignatureVisible: process.env.REFIRMA_FIRMA_VISIBLE === '1' ? 'true' : 'false', stampAppearanceId: '0', pageNumber: '0', posx: '5', posy: '5', fontSize: '7',
      dcfilter: '.*FIR.*|.*FAU.*', timestamp: 'false', outputFile: p.nombre.replace(/\.pdf$/i, '[R].pdf'), maxFileSize: String(TOPE) };
    if (p.estado === 'rechazado') { p.estado = 'pendiente'; p.checks = []; p.mensaje = ''; }
    evento(p, 'servidor', 'argumentos', (cred ? 'Argumentos con las credenciales de la entidad' : 'Argumentos SIN credenciales de RENIEC (REFIRMA_CLIENT_ID / REFIRMA_CLIENT_SECRET vacías): modo diagnóstico') + ' · protocolo ' + args.protocol + ' · descarga ' + args.fileDownloadUrl.replace(p.token, '…'));
    res.json({ args: Buffer.from(JSON.stringify(args), 'utf8').toString('base64'), credenciales: cred, protocolo: args.protocol, descarga: args.fileDownloadUrl, devolucion: args.fileUploadUrl, salida: args.outputFile });
  });
  app.get('/api/firma/pend/:token/original', requiereSesion, (req, res) => { const p = suyo(req, res); if (!p) return; evento(p, 'navegador', 'descarga-manual', 'Se descargó el PDF para firmarlo en ReFirma PDF'); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(p.nombre)); res.sendFile(path.join(dirDe(p.token), 'original.pdf')); });
  app.get('/api/firma/pend/:token/firmado', requiereSesion, (req, res) => { const p = suyo(req, res); if (!p) return; if (p.estado !== 'firmado') return res.status(409).json({ error: 'sin-firmar', mensaje: 'Aún no llega el PDF firmado.' }); res.setHeader('Content-Type', 'application/pdf'); res.sendFile(path.join(dirDe(p.token), 'firmado.pdf')); });
  app.post('/api/firma/pend/:token/subir-firmado', requiereSesion, async (req, res) => {   // ruta manual: el [R].pdf firmado en ReFirma PDF
    const p = suyo(req, res); if (!p) return;
    try { const buf = await leeCuerpo(req), a = archivoDelCuerpo(buf, req.get('content-type')); evento(p, 'navegador', 'subida-manual', 'Llegó el PDF firmado a mano (' + a.datos.length + ' bytes)'); await recibe(p, a.datos, 'navegador', QA); res.status(p.estado === 'firmado' ? 200 : 422).json(vista(p)); }
    catch (e) { res.status(400).json({ error: 'firma', mensaje: e.message }); }
  });

  // ── lo que pide ReFirma desde la PC (sin sesión: el código del pedido es la llave) ──
  app.get('/api/firma/refirma/:token/documento.pdf', (req, res) => { const p = deReFirma(req, res); if (!p) return; evento(p, 'refirma', 'descarga', 'ReFirma descargó el PDF del CDE · ' + quienPide(req)); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(p.nombre)); res.sendFile(path.join(dirDe(p.token), 'original.pdf')); });
  app.get('/api/firma/refirma/:token/:img(logo|sello).png', (req, res) => { const p = deReFirma(req, res); if (!p) return; evento(p, 'refirma', req.params.img, 'ReFirma pidió la imagen del ' + req.params.img); res.sendFile(path.join(__dirname, '..', 'public', 'img', 'anin-logo.png')); });
  app.post('/api/firma/refirma/:token/firmado', async (req, res) => {
    const p = deReFirma(req, res); if (!p) return;
    try {
      const buf = await leeCuerpo(req), a = archivoDelCuerpo(buf, req.get('content-type'));
      evento(p, 'refirma', 'devolucion', 'ReFirma devolvió el PDF firmado (' + a.datos.length + ' bytes, campo «' + a.campo + '»' + (a.archivo ? ', archivo «' + a.archivo + '»' : '') + ') · ' + quienPide(req));
      await recibe(p, a.datos, 'refirma', QA);
      res.status(200).type('text/plain').send(p.estado === 'firmado' ? 'OK' : 'RECHAZADO: ' + p.mensaje.slice(0, 300));
    } catch (e) { evento(p, 'refirma', 'error', e.message); res.status(400).type('text/plain').send(e.message); }
  });

  // ── raíces de confianza (administrador del CDE) ──
  app.get('/api/firma/raices', requiereSesion, (req, res) => res.json({ raices: raices().map(vistaRaiz) }));
  app.post('/api/firma/raices', requiereSesion, async (req, res) => {
    if (!esAdminGlobal(req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo el administrador del CDE carga raíces de confianza.' });
    try { const buf = await leeCuerpo(req), certs = FIR.certsDeArchivo(buf), out = certs.map(c => agregaRaiz(c.raw)); require('./bd').audita(req.quien, 'firma.raiz.agregar', '', '', { raices: out.map(o => o.raiz.nombre + ' ' + o.raiz.huella) }); res.json({ ok: true, agregadas: out }); }
    catch (e) { res.status(400).json({ error: 'certificado', mensaje: 'No es un certificado X.509 (.cer / .crt / .pem): ' + e.message }); }
  });
  app.delete('/api/firma/raices/:huella', requiereSesion, (req, res) => {
    if (!esAdminGlobal(req.quien)) return res.status(403).json({ error: 'sin-permiso' });
    const c = raices().find(x => x.fingerprint256.replace(/:/g, '') === String(req.params.huella).replace(/:/g, '').toUpperCase()); if (!c) return res.status(404).json({ error: 'no-existe' });
    fs.rmSync(path.join(dirRaices(), c.archivo), { force: true }); cache.clave = ''; require('./bd').audita(req.quien, 'firma.raiz.quitar', '', '', { raiz: c.fingerprint256 }); res.json({ ok: true });
  });
  /** Confiar en la entidad que emitió una firma ya verificada: agrega el certificado más alto de su cadena (el administrador
   *  compara antes su huella con la que publica RENIEC). */
  app.post('/api/firma/raices/desde', requiereSesion, ctx.express.json(), (req, res) => {
    if (!esAdminGlobal(req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo el administrador del CDE agrega raíces de confianza.' });
    const b = req.body || {}, R = ctx.cdeInterno && ctx.cdeInterno.archivoDeVersion ? ctx.cdeInterno.archivoDeVersion(String(b.proyecto || ''), String(b.contenedor || '')) : null;
    if (!R) return res.status(404).json({ error: 'no-existe', mensaje: 'No se encontró el PDF de ese documento.' });
    const v = FIR.verificaPdf(fs.readFileSync(R), { raices: [] }), f = v.firmas.find(x => x._cadenaCerts && x._cadenaCerts.length);
    if (!f) return res.status(409).json({ error: 'sin-cadena', mensaje: 'La firma no trae los certificados de su entidad de certificación.' });
    const tope = f._cadenaCerts[f._cadenaCerts.length - 1];
    if (!b.huella || String(b.huella) !== tope.fingerprint256) return res.json({ confirmar: true, raiz: vistaRaiz(tope) });   // primero se muestra para confirmar
    const r = agregaRaiz(tope.raw); require('./bd').audita(req.quien, 'firma.raiz.agregar', String(b.proyecto || ''), '', { desde: b.contenedor, raiz: r.raiz.nombre + ' ' + r.raiz.huella }); res.json(Object.assign({ ok: true }, r));
  });
}

module.exports = { monta, crea, raices, get pendientes() { return P; } };
