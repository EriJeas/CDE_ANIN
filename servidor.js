/*
 * CDE ANIN — Entorno Comun de Datos propio (desarrollo institucional, aparte del Visor BIM).
 *
 * Que es: el lugar donde viven los contenedores de informacion de los proyectos (modelos, planos, documentos) con sus
 * versiones, estados ISO 19650 (WIP → COMPARTIDO → PUBLICADO → ARCHIVADO), revisiones por rondas, incidencias (BCF) y
 * auditoria; y donde los modelos llegan desde Revit / Navisworks con un complemento (como Revizto) o desde Autodesk
 * Forma con el conector, ya convertidos en un indice de parametros + geometria liviana que se ve en el navegador.
 *
 * Que reutiliza del visor (carpeta compartido-visor/, sin cambios): la clase Indice (SQLite) y las consultas sobre el
 * indice, y los clasificadores (● Modelo / Categoria / Familia / Tipo / Nivel), para que las cifras coincidan.
 *
 * Arranque:  npm install && npm start   (lee .env si existe; ver .env.example)
 */
'use strict';
const fs = require('fs'), path = require('path');
// .env (o cde.env) sencillo, sin dependencia: KEY=valor por linea. Lo que dice el archivo del CDE manda sobre las variables
// de entorno de Windows (otro programa pudo dejar, por ejemplo, otro APS_CLIENT_ID). Un comentario al final (« # ...») no es
// parte del valor, y una clave vacía no cuenta. Entre .env y cde.env manda el primero que la tenga.
const ENV_DE_ARCHIVO = new Set(), ENV_TAPADAS = [];
for (const archivoEnv of ['.env', 'cde.env']) try { for (const l of fs.readFileSync(path.join(__dirname, archivoEnv), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(l); if (!m || ENV_DE_ARCHIVO.has(m[1])) continue;
  const v = m[2].replace(/(^|\s)#.*$/, '').trim().replace(/^"(.*)"$/, '$1'); if (v === '') continue;
  if (process.env[m[1]] !== undefined && process.env[m[1]] !== v) ENV_TAPADAS.push(m[1]);
  process.env[m[1]] = v; ENV_DE_ARCHIVO.add(m[1]);
} } catch (e) {}
if (ENV_TAPADAS.length) console.log('Configuracion: el .env del CDE manda sobre variables de entorno de Windows para ' + ENV_TAPADAS.join(', '));

const express = require('express'), cookieParser = require('cookie-parser'), compression = require('compression'), crypto = require('crypto');
const BD = require('./lib/bd'), ACC = require('./lib/acceso'), { AlmacenDisco } = require('./lib/almacen');

const PUERTO = Number(process.env.PORT) || 8090;
const DATOS = path.resolve(process.env.DATOS_DIR || path.join(__dirname, 'datos'));
const VERSION = require('./package.json').version;

BD.abre(DATOS);
const almacen = new AlmacenDisco(path.join(DATOS, 'archivos'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);   // detras del proxy de la plataforma (Render): la sesion viaja por HTTPS
// en un servidor publico no se arranca con la puerta de pruebas ni con el secreto de fabrica
if (process.env.NODE_ENV === 'production') {
  if ((process.env.MODO_ACCESO || 'local').toLowerCase() === 'local') { console.error('MODO_ACCESO=local es solo para pruebas en una PC. En el servidor usa MODO_ACCESO=cuentas (o microsoft).'); process.exit(1); }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24) { console.error('Falta SESSION_SECRET (minimo 24 caracteres).'); process.exit(1); }
}
app.get('/api/salud', (req, res) => res.json({ ok: true }));
app.use(compression());
app.use(cookieParser());
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', etag: true, lastModified: true, setHeaders: (res, ruta) => { res.setHeader('Cache-Control', /[\\/]vendor[\\/]/.test(ruta) ? 'public, max-age=86400' : 'no-cache'); } }   /* no-cache: el navegador pregunta siempre si cambio (asi una version nueva del CDE se ve sin Ctrl+F5) */));

// llave interna para que el conector de Forma entre por la misma puerta que los complementos (cambia en cada arranque)
const llaveInterna = crypto.randomBytes(24).toString('hex');
BD.q.corre("UPDATE llaves SET revocada = 1 WHERE nombre = 'conector-forma-interno'");
BD.q.corre('INSERT INTO llaves (id, nombre, huella, proyecto_id, creada, por) VALUES (?,?,?,?,?,?)', BD.id('lk'), 'conector-forma-interno', crypto.createHash('sha256').update(llaveInterna).digest('hex'), '', BD.ahora(), 'servidor');

const ctx = { express, datosDir: DATOS, almacen, puerto: PUERTO, llaveInterna, nombreServidor: process.env.NOMBRE_CDE || 'CDE ANIN',
  requiereSesion: ACC.requiereSesion, requiereRol: ACC.requiereRol, requiereLlave: ACC.requiereLlave, creaLlave: ACC.creaLlave, rolEn: ACC.rolEn, esAdminGlobal: ACC.esAdminGlobal, sesionDe: ACC.sesionDe };

app.get('/api/estado', (req, res) => res.json({ nombre: ctx.nombreServidor, version: VERSION, modoAcceso: ACC.MODO, visor: require('./compartido-visor/reporte-forma').versionVisor, hora: BD.ahora() }));
ACC.monta(app);
require('./lib/correspondencia').monta(app, Object.assign({ db: BD.db }, ctx));   // crea sus tablas antes de que cde.js las consulte
require('./lib/gestion').monta(app, Object.assign({ db: BD.db }, ctx));           // compartir, suprimidos, marcas, atributos (tablas marcas/compartidos antes que cde.js)
require('./lib/resumen').monta(app, ctx);                                          // resumen automatico de cada archivo (deja ctx.resumenes para cde.js)
require('./lib/cde').monta(app, ctx);
require('./lib/forma').monta(app, Object.assign(ctx, { db: BD.db }));             // normas por carpeta, conjuntos, puentes, transmisiones, incidencias suprimidas, pagina de revision (usa ctx.cdeInterno)
require('./lib/documentos').monta(app, ctx);                                       // Buscar - Registro de documentos (como Aconex), sobre los documentos del CDE (usa ctx.cdeInterno)
require('./lib/modelos').monta(app, ctx);
require('./lib/obra').monta(app, ctx);                                             // Seguimiento de obra: planos del CDE con tareas, fotos, partes diarios y presupuesto (usa ctx.cdeInterno)
require('./lib/conector-forma').monta(app, ctx);
require('./lib/conector-aconex').monta(app, ctx);
require('./lib/conector-microsoft').monta(app, ctx);   // OneDrive y SharePoint (Microsoft Graph)
require('./lib/contrato').monta(app, ctx);   // Línea de tiempo contractual

app.use('/api', (req, res) => res.status(404).json({ error: 'no-existe', mensaje: 'Ruta no encontrada.' }));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(err.status || 500).json({ error: 'servidor', mensaje: err.message || 'Error interno.' }); });

if (require.main === module) {
  // Un fallo suelto (una promesa sin atender de una libreria, un archivo raro) no debe tumbar el servidor: se anota en datos/servidor.log y se sigue atendiendo.
  const anota = (tipo, e) => { const l = '[' + new Date().toISOString() + '] ' + tipo + ': ' + ((e && e.stack) || e) + '\n'; console.error(l); try { fs.appendFileSync(path.join(DATOS, 'servidor.log'), l); } catch (x) {} };
  process.on('unhandledRejection', (e) => anota('promesa sin atender', e));
  process.on('uncaughtException', (e) => anota('excepcion no capturada', e));
  app.listen(PUERTO, () => console.log(ctx.nombreServidor + ' v' + VERSION + ' escuchando en http://localhost:' + PUERTO + '  (acceso: ' + ACC.MODO + ', datos: ' + DATOS + ')'));
}
module.exports = { app, ctx };
