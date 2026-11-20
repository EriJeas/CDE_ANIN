/**
 * Foto de perfil de las personas del CDE.
 *  - Solo la carga quien administra: el administrador del CDE o quien es gestor o administrador en algún proyecto.
 *  - La foto se guarda dentro de la base de datos del CDE (en Render vive en el disco permanente /var/data),
 *    no en la carpeta del programa: así no se pierde al subir una versión nueva a GitHub ni al redesplegar.
 *  - Se identifica por una clave derivada del correo; el correo no viaja en la dirección de la imagen.
 */
const crypto = require('crypto');
const { q, ahora, audita } = require('./bd');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS perfiles_foto (
  email TEXT PRIMARY KEY,
  clave TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,
  datos BLOB NOT NULL,
  actualizado TEXT NOT NULL
);`;
const TOPE = 400 * 1024;   // la pantalla la reduce a 256 x 256 px (unos 20–40 KB); el tope solo frena abusos

const claveDe = (email) => crypto.createHash('sha256').update('cde-foto:' + String(email || '').toLowerCase().trim()).digest('hex').slice(0, 24);
/** Tipo real de la imagen por sus primeros bytes (no por lo que diga el navegador). */
function tipoDe(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express, db, esAdminGlobal } = ctx; db.exec(ESQUEMA);
  /** Puede poner su foto: el administrador del CDE o quien es gestor o administrador en algún proyecto. */
  const puedeFoto = (email) => !!email && (esAdminGlobal(email) || !!q.uno("SELECT 1 AS x FROM miembros WHERE email = ? AND rol IN ('gestor','administrador') LIMIT 1", String(email).toLowerCase()));
  const fotoDe = (email) => { const r = q.uno('SELECT clave, actualizado FROM perfiles_foto WHERE email = ?', String(email || '').toLowerCase()); return r ? { clave: r.clave, v: r.actualizado } : null; };
  ctx.perfil = (email) => ({ puedeFoto: puedeFoto(email), foto: fotoDe(email) });

  app.get('/api/perfil', requiereSesion, (req, res) => res.json(ctx.perfil(req.quien)));
  app.post('/api/perfil/foto', requiereSesion, express.raw({ type: () => true, limit: TOPE }), (req, res) => {
    if (!puedeFoto(req.quien)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'La foto de perfil la ponen los administradores y los gestores de proyecto.' });
    const b = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), tipo = tipoDe(b);
    if (!tipo) return res.status(400).json({ error: 'formato', mensaje: 'La foto debe ser una imagen JPG, PNG o WEBP.' });
    const email = String(req.quien).toLowerCase(), fecha = ahora();
    q.corre('INSERT INTO perfiles_foto (email, clave, tipo, datos, actualizado) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET tipo = excluded.tipo, datos = excluded.datos, actualizado = excluded.actualizado', email, claveDe(email), tipo, b, fecha);
    audita(req.quien, 'perfil.foto', '', '', { bytes: b.length });
    res.json({ ok: true, foto: fotoDe(email) });
  });
  app.delete('/api/perfil/foto', requiereSesion, (req, res) => {
    q.corre('DELETE FROM perfiles_foto WHERE email = ?', String(req.quien).toLowerCase()); audita(req.quien, 'perfil.foto.quitar', '', '', {}); res.json({ ok: true });
  });
  /** La imagen: la ve cualquier persona con sesión (aparece en las listas de usuarios de los proyectos). */
  app.get('/api/perfil/foto/:clave', requiereSesion, (req, res) => {
    const r = q.uno('SELECT tipo, datos, actualizado FROM perfiles_foto WHERE clave = ?', String(req.params.clave || ''));
    if (!r) return res.status(404).json({ error: 'no-existe' });
    res.set('Content-Type', r.tipo); res.set('Cache-Control', 'private, max-age=604800'); res.set('X-Content-Type-Options', 'nosniff'); res.end(r.datos);
  });
  /** Las fotos de las personas de un proyecto (para Usuarios de proyecto). */
  app.get('/api/proyectos/:pid/fotos', requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos('SELECT f.email, f.clave, f.actualizado FROM perfiles_foto f JOIN miembros m ON m.email = f.email AND m.proyecto_id = ?', req.pid);
    const fotos = {}; for (const r of L) fotos[r.email] = { clave: r.clave, v: r.actualizado };
    const yo = fotoDe(req.quien); if (yo) fotos[String(req.quien).toLowerCase()] = yo;
    res.json({ fotos });
  });
}

module.exports = { monta, tipoDe, claveDe };
