/*
 * PLANOS DESDE LA NUBE (Seguimiento de obra): baja un PDF desde un enlace compartido de Dropbox, OneDrive / SharePoint o Box.
 *
 *  - Solo enlaces «cualquiera con el enlace puede ver»: no se piden cuentas ni contraseñas, y el CDE no guarda credenciales de nadie.
 *  - Solo https y solo los dominios de esos servicios; cada salto de la redireccion se comprueba (nunca una direccion privada o local),
 *    con tope de tamaño y de saltos. El archivo debe ser un PDF.
 *  - El enlace se convierte a su forma de descarga directa: Dropbox ?dl=1 · OneDrive: API de enlaces compartidos · SharePoint ?download=1
 *    · Box: /shared/static/<id>.pdf (Box solo sirve descarga directa en cuentas que la permiten).
 */
'use strict';
const dns = require('dns').promises, net = require('net');

const TOPE = 300 * 1024 * 1024, SALTOS = 6;
const PROVEEDORES = [
  { id: 'Dropbox', rx: /(^|\.)dropbox\.com$|(^|\.)dropboxusercontent\.com$/i },
  { id: 'OneDrive', rx: /(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$|(^|\.)onedrive\.com$|(^|\.)sharepoint\.com$|(^|\.)live\.com$|(^|\.)1drv\.com$|(^|\.)live\.net$|(^|\.)microsoft\.com$|(^|\.)sharepoint-df\.com$|(^|\.)storage\.live\.com$/i },
  { id: 'Box', rx: /(^|\.)box\.com$|(^|\.)boxcloud\.com$|(^|\.)boxcdn\.net$/i }
];
const proveedorDe = (host) => (PROVEEDORES.find(p => p.rx.test(host)) || {}).id || '';
const error = (m, s) => { const e = new Error(m); e.status = s || 400; return e; };
const PRUEBA = () => process.env.OBRA_NUBE_PRUEBA === '1';   // solo para las pruebas automaticas: admite el servidor local de prueba

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
  if (/1drv\.ms$|onedrive\.live\.com$/.test(h)) return 'https://api.onedrive.com/v1.0/shares/u!' + Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-') + '/root/content';
  if (/sharepoint\.com$/.test(h)) { u.searchParams.set('download', '1'); return u.toString(); }
  const m = /box\.com$/.test(h) && /^\/s\/([A-Za-z0-9]+)/.exec(u.pathname); if (m) return 'https://' + h + '/shared/static/' + m[1] + '.pdf';
  return u.toString();
}
const nombreDe = (res, u) => {
  const cd = res.headers.get('content-disposition') || '', m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let n = ''; try { n = m ? decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')) : decodeURIComponent(u.pathname.split('/').pop() || ''); } catch (e) { n = m ? m[1] : ''; }
  n = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim(); if (!/\.pdf$/i.test(n)) n = (n.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'plano') + '.pdf'; return n.slice(0, 180);
};

/** Baja el PDF del enlace compartido. Devuelve { datos, nombre, proveedor }. */
async function descarga(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch (e) { throw error('El enlace no es válido.'); }
  const proveedor = await comprueba(u); let actual = new URL(directa(u.toString())), res = null;
  for (let i = 0; i <= SALTOS; i++) {
    await comprueba(actual);
    res = await fetch(actual, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (CDE)', accept: 'application/pdf,*/*' }, signal: AbortSignal.timeout(120000) }).catch(e => { throw error('No se pudo conectar con ' + actual.hostname + ': ' + e.message, 502); });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { if (i === SALTOS) throw error('El enlace redirige demasiadas veces.', 502); actual = new URL(res.headers.get('location'), actual); continue; }
    break;
  }
  if (res.status === 401 || res.status === 403) throw error('El enlace no es público: en ' + proveedor + ', compártelo como «cualquier persona con el enlace puede ver».', 400);
  if (!res.ok) throw error(proveedor + ' respondió ' + res.status + '. Revisa que el enlace siga vigente y sea de un archivo (no de una carpeta).', 502);
  if (Number(res.headers.get('content-length') || 0) > TOPE) throw error('El archivo supera los 300 MB.');
  const datos = Buffer.from(await res.arrayBuffer());
  if (datos.length > TOPE) throw error('El archivo supera los 300 MB.');
  if (datos.slice(0, 5).toString('latin1') !== '%PDF-') throw error('El enlace no entrega un PDF. Debe ser el enlace compartido de un archivo PDF (no de una carpeta ni de una página de vista previa).');
  return { datos, nombre: nombreDe(res, actual), proveedor };
}

module.exports = { descarga, directa, proveedorDe };
