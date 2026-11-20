/*
 * PLANOS DESDE LA NUBE (Seguimiento de obra): baja un PDF desde un enlace compartido de Dropbox, OneDrive / SharePoint o Box.
 *
 *  - Solo enlaces «cualquiera con el enlace puede ver»: no se piden cuentas ni contraseñas, y el CDE no guarda credenciales de nadie.
 *  - Solo https y solo los dominios de esos servicios; cada salto de la redireccion se comprueba (nunca una direccion privada o local),
 *    con tope de tamaño y de saltos. El archivo debe ser un PDF.
 *  - El enlace se convierte a su forma de descarga directa: Dropbox ?dl=1 · SharePoint ?download=1
 *    · Box: /shared/static/<id>.pdf (Box solo sirve descarga directa en cuentas que la permiten).
 *  - OneDrive personal (1drv.ms / onedrive.live.com): desde 2024 la API de enlaces compartidos responde 401 a los enlaces
 *    nuevos (1drv.ms/b/c/…) aunque sean de «Cualquier persona». Se pide entonces el archivo como lo hace la propia página
 *    de OneDrive con un visitante sin sesión: una ficha de visitante anónimo (no es una cuenta ni una contraseña, y no da
 *    acceso a nada que el enlace no comparta) → el elemento compartido → su dirección de descarga temporal. Los enlaces
 *    antiguos (1drv.ms/…/s!…) siguen probándose también por la API de siempre.
 */
'use strict';
const dns = require('dns').promises, net = require('net');

const TOPE = 300 * 1024 * 1024, SALTOS = 6;
const PROVEEDORES = [
  { id: 'Dropbox', rx: /(^|\.)dropbox\.com$|(^|\.)dropboxusercontent\.com$/i },
  { id: 'OneDrive', rx: /(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$|(^|\.)onedrive\.com$|(^|\.)sharepoint\.com$|(^|\.)live\.com$|(^|\.)1drv\.com$|(^|\.)live\.net$|(^|\.)microsoft\.com$|(^|\.)sharepoint-df\.com$|(^|\.)storage\.live\.com$|(^|\.)microsoftpersonalcontent\.com$|(^|\.)livefilestore\.com$|(^|\.)svc\.ms$/i },
  { id: 'Box', rx: /(^|\.)box\.com$|(^|\.)boxcloud\.com$|(^|\.)boxcdn\.net$/i }
];
const proveedorDe = (host) => (PROVEEDORES.find(p => p.rx.test(host)) || {}).id || '';
const error = (m, s) => { const e = new Error(m); e.status = s || 400; return e; };
const PRUEBA = () => process.env.OBRA_NUBE_PRUEBA === '1';   // solo para las pruebas automaticas: admite el servidor local de prueba
const UA = 'Mozilla/5.0 (CDE)';
// Direcciones de Microsoft para OneDrive personal (en las pruebas automaticas, un servidor local hace de Microsoft).
const MSB = () => (PRUEBA() && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.OBRA_NUBE_PRUEBA_MS || '')) ? process.env.OBRA_NUBE_PRUEBA_MS : '';
const EP = {
  ficha: () => (MSB() || 'https://api-badgerp.svc.ms') + '/v1.0/token',
  api: () => (MSB() || 'https://api.onedrive.com') + '/v1.0/shares/',
  personal: () => (MSB() || 'https://my.microsoftpersonalcontent.com') + '/_api/v2.0/shares/'
};
const APP_VISITANTE = '5cbed6ac-a083-4e14-b191-b4ba07653de2';   // la aplicacion publica con la que la web de OneDrive atiende a visitantes sin sesion
const esPersonal = (u) => /(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$/i.test(u.hostname) || (PRUEBA() && u.hostname === '127.0.0.1' && u.pathname.startsWith('/1drv/'));
const b64u = (t) => Buffer.from(String(t)).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

function privada(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const s = ip.toLowerCase(); return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('::ffff:');
}
async function comprueba(u) {
  if (PRUEBA() && u.hostname === '127.0.0.1') return 'Prueba';
  if (u.protocol !== 'https:') throw error('Solo se admiten enlaces https.');
  if (u.username || u.password || net.isIP(u.hostname)) throw error('El enlace no es de Dropbox, OneDrive / SharePoint ni Box.');
  const prov = proveedorDe(u.hostname); if (!prov) throw error('El enlace no es de Dropbox, OneDrive / SharePoint ni Box (' + u.hostname + ').');
  const dir = await dns.lookup(u.hostname, { all: true }).catch(() => []); if (!dir.length || dir.some(d => privada(d.address))) throw error('No se pudo resolver ' + u.hostname + '.', 502);
  return prov;
}
/** El enlace que la persona copia → la direccion que entrega el archivo. */
function directa(url) {
  const u = new URL(url), h = u.hostname.toLowerCase();
  if (/dropbox\.com$/.test(h)) { u.searchParams.set('dl', '1'); return u.toString(); }
  if (/1drv\.ms$|onedrive\.live\.com$/.test(h)) return EP.api() + 'u!' + b64u(url) + '/root/content';   // solo enlaces antiguos; los nuevos van por onedrivePersonal()
  if (/sharepoint\.com$/.test(h)) { u.searchParams.set('download', '1'); return u.toString(); }
  const m = /box\.com$/.test(h) && /^\/s\/([A-Za-z0-9]+)/.exec(u.pathname); if (m) return 'https://' + h + '/shared/static/' + m[1] + '.pdf';
  return u.toString();
}
const nombreDe = (res, u, deLaNube) => {
  const cd = res.headers.get('content-disposition') || '', m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let n = ''; try { n = m ? decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')) : (deLaNube || decodeURIComponent(u.pathname.split('/').pop() || '')); } catch (e) { n = m ? m[1] : (deLaNube || ''); }
  n = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim(); if (!/\.pdf$/i.test(n)) n = (n.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'plano') + '.pdf'; return n.slice(0, 180);
};

/** Pide una direccion siguiendo sus redirecciones; cada salto se comprueba. La ficha (Authorization) nunca pasa a otro salto. */
async function sigue(url, cabeceras) {
  let actual = new URL(url), res = null, cab = Object.assign({ 'user-agent': UA }, cabeceras || {});
  for (let i = 0; i <= SALTOS; i++) {
    await comprueba(actual);
    res = await fetch(actual, { redirect: 'manual', headers: cab, signal: AbortSignal.timeout(120000) }).catch(e => { throw error('No se pudo conectar con ' + actual.hostname + ': ' + e.message, 502); });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (i === SALTOS) throw error('El enlace redirige demasiadas veces.', 502);
      actual = new URL(res.headers.get('location'), actual); cab = Object.assign({}, cab); delete cab.Authorization; delete cab.Prefer; continue;
    }
    break;
  }
  return { res, actual };
}

// ───────── OneDrive personal: ficha de visitante anonimo (vale unos dias; se guarda en memoria y se renueva si OneDrive la rechaza)
let VISITANTE = null;
async function fichaVisitante(renueva) {
  if (!renueva && VISITANTE && VISITANTE.vence > Date.now()) return VISITANTE.token;
  const url = new URL(EP.ficha()); await comprueba(url);
  const r = await fetch(url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' }, body: JSON.stringify({ appId: APP_VISITANTE }), signal: AbortSignal.timeout(30000) })
    .catch(e => { throw error('sin conexión con ' + url.hostname + ' (' + e.message + ')', 502); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw error('OneDrive no entregó el acceso de visitante (' + r.status + ')', 502);
  VISITANTE = { token: String(j.token), vence: Date.now() + 6 * 3600 * 1000 }; return VISITANTE.token;
}
async function onedrivePersonal(u) {
  const ids = [], pon = (id) => { if (id && !ids.includes(id)) ids.push(id); }, notas = [];
  pon('u!' + b64u(u.toString())); if (u.search) pon('u!' + b64u(u.origin + u.pathname));
  // el enlace corto redirige a onedrive.live.com/?redeem=<enlace codificado>: ese codigo tambien identifica lo compartido
  try {
    await comprueba(u);
    const r0 = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }), loc = r0.headers.get('location');
    const red = loc && new URL(loc, u).searchParams.get('redeem'); if (red) pon('u!' + red.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-'));
  } catch (e) { /* sin redireccion: se sigue con el enlace tal cual */ }
  let ficha = '', renovada = false;
  try { ficha = await fichaVisitante(false); } catch (e) { notas.push('acceso de visitante: ' + e.message); }
  if (ficha) {
    for (const sid of ids) for (const base of [EP.api(), EP.personal()]) {
      const host = new URL(base).hostname;
      try {
        const cab = () => ({ Authorization: 'Badger ' + ficha, Prefer: 'autoredeem', accept: 'application/json' });
        let r = await sigue(base + sid + '/driveItem', cab());
        if ((r.res.status === 401 || r.res.status === 403) && !renovada) { renovada = true; ficha = await fichaVisitante(true).catch(() => ficha); r = await sigue(base + sid + '/driveItem', cab()); }
        if (!r.res.ok) { notas.push(host + ' ' + r.res.status); continue; }
        const it = await r.res.json().catch(() => ({}));
        if (it.folder) throw Object.assign(error('Ese enlace es de una carpeta de OneDrive: comparte el archivo PDF, no la carpeta.'), { final: true });
        const dl = it['@content.downloadUrl'] || it['@microsoft.graph.downloadUrl'];
        const d = dl ? await sigue(dl, { accept: 'application/pdf,*/*' }) : await sigue(base + sid + '/driveItem/content', cab());
        if (d.res.ok) return { r: d, nombre: String(it.name || '') };
        notas.push('descarga ' + d.res.status);
      } catch (e) { if (e.final) throw e; notas.push(host + ': ' + e.message); }
    }
  }
  // enlaces antiguos (1drv.ms/…/s!…): la API de enlaces compartidos todavia los entrega sin iniciar sesion
  try { const leg = await sigue(EP.api() + ids[0] + '/root/content', { accept: 'application/pdf,*/*' }); if (leg.res.ok) return { r: leg, nombre: '' }; notas.push('api anterior ' + leg.res.status); }
  catch (e) { notas.push('api anterior: ' + e.message); }
  throw error('OneDrive no entregó el archivo sin iniciar sesión. Revisa que el vínculo sea de «Cualquier persona» y de un archivo PDF (no de una carpeta). Detalle técnico: ' + notas.join(' · ') + '.', 502);
}

/** Baja el PDF del enlace compartido. Devuelve { datos, nombre, proveedor }. */
async function descarga(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch (e) { throw error('El enlace no es válido.'); }
  const proveedor = await comprueba(u); let r, deLaNube = '';
  if (esPersonal(u)) { const od = await onedrivePersonal(u); r = od.r; deLaNube = od.nombre; }
  else r = await sigue(directa(u.toString()), { accept: 'application/pdf,*/*' });
  const res = r.res;
  if (res.status === 401 || res.status === 403) throw error('El enlace no es público: en ' + proveedor + ', compártelo como «cualquier persona con el enlace puede ver».', 400);
  if (!res.ok) throw error(proveedor + ' respondió ' + res.status + '. Revisa que el enlace siga vigente y sea de un archivo (no de una carpeta).', 502);
  if (Number(res.headers.get('content-length') || 0) > TOPE) throw error('El archivo supera los 300 MB.');
  const datos = Buffer.from(await res.arrayBuffer());
  if (datos.length > TOPE) throw error('El archivo supera los 300 MB.');
  if (datos.slice(0, 5).toString('latin1') !== '%PDF-') throw error('El enlace no entrega un PDF. Debe ser el enlace compartido de un archivo PDF (no de una carpeta ni de una página de vista previa).');
  return { datos, nombre: nombreDe(res, r.actual, deLaNube), proveedor };
}

module.exports = { descarga, directa, proveedorDe, olvidaFicha: () => { VISITANTE = null; } };
