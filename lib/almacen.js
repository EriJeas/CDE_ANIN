/*
 * ALMACEN DE ARCHIVOS. Donde viven los RVT, NWD, IFC, PDF, DWG... y los paquetes de los complementos (indice + geometria).
 * Hoy: disco local (DATOS_DIR/archivos), que en un servidor de la entidad es un disco con respaldo. La interfaz es la misma
 * para los dos destinos que vienen despues (docs/ARQUITECTURA.md):
 *  - SharePoint de ANIN (Microsoft Graph, el mismo registro de aplicacion que OneDrive): la entidad ya lo paga y OTI lo controla;
 *  - un deposito S3/MinIO si OTI prefiere objeto.
 * El CDE nunca compone rutas con lo que escribe el usuario: cada version se guarda en una carpeta propia por id.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

class AlmacenDisco {
  constructor(raiz) { this.raiz = raiz; fs.mkdirSync(raiz, { recursive: true }); }
  /** La carpeta de una version: archivos/<proyecto>/<contenedor>/<version>/ */
  carpeta(pid, cid, vid) { const d = path.join(this.raiz, saneo(pid), saneo(cid), saneo(vid)); fs.mkdirSync(d, { recursive: true }); return d; }
  /** Guarda un Buffer o un flujo; devuelve { ruta (relativa al almacen), tamano, sha256 }. */
  async guarda(pid, cid, vid, nombre, origen) {
    const dir = this.carpeta(pid, cid, vid), destino = path.join(dir, saneoNombre(nombre));
    const h = crypto.createHash('sha256'); let tamano = 0;
    if (Buffer.isBuffer(origen)) { h.update(origen); tamano = origen.length; fs.writeFileSync(destino, origen); }
    else await new Promise((ok, mal) => {
      const w = fs.createWriteStream(destino);
      origen.on('data', (b) => { h.update(b); tamano += b.length; }); origen.on('error', mal); w.on('error', mal); w.on('finish', ok); origen.pipe(w);
    });
    return { ruta: path.relative(this.raiz, destino).split(path.sep).join('/'), tamano, sha256: h.digest('hex') };
  }
  rutaAbsoluta(rel) { const p = path.join(this.raiz, rel); if (!p.startsWith(this.raiz)) throw new Error('ruta fuera del almacen'); return p; }
  existe(rel) { try { return fs.existsSync(this.rutaAbsoluta(rel)); } catch (e) { return false; } }
  flujo(rel) { return fs.createReadStream(this.rutaAbsoluta(rel)); }
  borraCarpeta(pid, cid, vid) { try { fs.rmSync(path.join(this.raiz, saneo(pid), saneo(cid), saneo(vid)), { recursive: true, force: true }); } catch (e) {} }
}

const saneo = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_';
const saneoNombre = (s) => String(s || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);

module.exports = { AlmacenDisco, saneoNombre };
