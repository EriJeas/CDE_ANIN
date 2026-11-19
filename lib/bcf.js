/*
 * EXPORTACION BCF 2.1 (BIM Collaboration Format, buildingSMART): la forma neutral de llevar las incidencias del CDE a
 * Revit, Navisworks, Solibri, BIMcollab y a Autodesk Forma. Un .bcfzip es un ZIP con bcf.version, y por incidencia una
 * carpeta <guid>/ con markup.bcf (titulo, estado, comentarios, componentes) y viewpoint.bcfv (camara y elementos).
 * El ZIP se escribe aqui mismo (metodo STORE, sin compresion): son XML chicos y asi no hay dependencias.
 */
'use strict';
const crypto = require('crypto'), zlib = require('zlib');

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const guidDe = (texto) => { const h = crypto.createHash('md5').update(String(texto)).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); };
const fecha = (s) => { const d = s ? new Date(s) : new Date(); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };

const ESTADO_BCF = { abierta: 'Open', 'en-curso': 'In Progress', 'en-analisis': 'In Progress', respondida: 'Resolved', verificada: 'Resolved', cerrada: 'Closed', rechazada: 'Closed' };
const PRIORIDAD_BCF = { baja: 'Low', media: 'Medium', alta: 'High', critica: 'Critical' };

function markup(i, guid, proyecto) {
  const comps = (i.elementos || []).filter(e => e.ifcGuid || e.uid).map(e =>
    '      <Component' + (e.ifcGuid ? ' IfcGuid="' + esc(e.ifcGuid) + '"' : '') + '>' + (e.uid ? '<AuthoringToolId>' + esc(e.uid) + '</AuthoringToolId>' : '') + (e.modelo ? '<OriginatingSystem>' + esc(e.modelo) + '</OriginatingSystem>' : '') + '</Component>').join('\n');
  const coms = (i.comentarios || []).map(c => '  <Comment Guid="' + guidDe(i.id + ':' + c.id) + '">\n    <Date>' + fecha(c.fecha) + '</Date>\n    <Author>' + esc(c.autor) + '</Author>\n    <Comment>' + esc(c.texto || ('Estado: ' + c.estado_nuevo)) + '</Comment>\n    <Viewpoint Guid="' + guidDe(i.id + ':vp') + '"/>\n  </Comment>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
    '  <Header>\n    <File IsExternal="true"><Filename>' + esc(i.archivo || '') + '</Filename><Date>' + fecha(i.creado) + '</Date></File>\n  </Header>\n' +
    '  <Topic Guid="' + guid + '" TopicType="' + esc(i.tipo || 'Issue') + '" TopicStatus="' + (ESTADO_BCF[i.estado] || 'Open') + '">\n' +
    '    <Title>' + esc('#' + i.numero + ' ' + i.titulo) + '</Title>\n    <Priority>' + (PRIORIDAD_BCF[i.prioridad] || 'Medium') + '</Priority>\n    <Index>' + Number(i.numero) + '</Index>\n' +
    (i.contractual ? '    <Labels>Contractual</Labels>\n' : '') + (i.disciplina ? '    <Labels>' + esc(i.disciplina) + '</Labels>\n' : '') + (i.etapa ? '    <Stage>' + esc(i.etapa) + '</Stage>\n' : '') +
    '    <CreationDate>' + fecha(i.creado) + '</CreationDate>\n    <CreationAuthor>' + esc(i.autor) + '</CreationAuthor>\n' +
    (i.asignado ? '    <AssignedTo>' + esc(i.asignado) + '</AssignedTo>\n' : '') + (i.vencimiento ? '    <DueDate>' + fecha(i.vencimiento) + '</DueDate>\n' : '') +
    '    <Description>' + esc(i.descripcion || '') + '</Description>\n  </Topic>\n' + (coms ? coms + '\n' : '') +
    '  <Viewpoints Guid="' + guidDe(i.id + ':vp') + '"><Viewpoint>viewpoint.bcfv</Viewpoint>' + (i.captura ? '<Snapshot>snapshot.png</Snapshot>' : '') + '</Viewpoints>\n' +
    '</Markup>\n' + (comps ? '<!-- componentes: ver viewpoint.bcfv -->\n' : '');
}
function viewpoint(i) {
  const c = i.camara || {}, p = c.pos || [0, 0, 0], d = c.dir || [0, 1, 0], u = c.up || [0, 0, 1];
  const comps = (i.elementos || []).filter(e => e.ifcGuid || e.uid).map(e => '      <Component' + (e.ifcGuid ? ' IfcGuid="' + esc(e.ifcGuid) + '"' : '') + '>' + (e.uid ? '<AuthoringToolId>' + esc(e.uid) + '</AuthoringToolId>' : '') + (e.modelo ? '<OriginatingSystem>' + esc(e.modelo) + '</OriginatingSystem>' : '') + '</Component>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<VisualizationInfo Guid="' + guidDe(i.id + ':vp') + '">\n' +
    (comps ? '  <Components>\n    <Selection>\n' + comps + '\n    </Selection>\n  </Components>\n' : '') +
    (c.pos ? '  <PerspectiveCamera>\n    <CameraViewPoint><X>' + p[0] + '</X><Y>' + p[1] + '</Y><Z>' + p[2] + '</Z></CameraViewPoint>\n    <CameraDirection><X>' + d[0] + '</X><Y>' + d[1] + '</Y><Z>' + d[2] + '</Z></CameraDirection>\n    <CameraUpVector><X>' + u[0] + '</X><Y>' + u[1] + '</Y><Z>' + u[2] + '</Z></CameraUpVector>\n    <FieldOfView>' + (c.fov || 60) + '</FieldOfView>\n  </PerspectiveCamera>\n' : '') +
    '</VisualizationInfo>\n';
}

/** Exporta una lista de incidencias (con .comentarios) a un Buffer .bcfzip. */
function exporta(proyecto, incidencias) {
  const archivos = [['bcf.version', '<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>\n'],
    ['project.bcfp', '<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension><Project ProjectId="' + guidDe('p:' + (proyecto && proyecto.codigo)) + '"><Name>' + esc(proyecto && proyecto.nombre) + '</Name></Project><ExtensionSchema/></ProjectExtension>\n']];
  for (const i of incidencias) { const g = guidDe(i.id); archivos.push([g + '/markup.bcf', markup(i, g, proyecto)], [g + '/viewpoint.bcfv', viewpoint(i)]); }
  return zipStore(archivos);
}

/** ZIP minimo (STORE). entradas: [[nombre, texto|Buffer]]. */
function zipStore(entradas) {
  const locales = [], centrales = []; let off = 0;
  const ahora = new Date(), dosTime = ((ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)) & 0xffff, dosDate = (((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()) & 0xffff;
  for (const [nombre, cont] of entradas) {
    const n = Buffer.from(nombre, 'utf8'), d = Buffer.isBuffer(cont) ? cont : Buffer.from(cont, 'utf8'), crc = zlib.crc32 ? zlib.crc32(d) : crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(off, 42);
    locales.push(h, n, d); centrales.push(c, n); off += h.length + n.length + d.length;
  }
  const cd = Buffer.concat(centrales), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(0, 4); fin.writeUInt16LE(0, 6); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16); fin.writeUInt16LE(0, 20);
  return Buffer.concat([...locales, cd, fin]);
}
let TABLA = null;
function crc32(buf) {
  if (!TABLA) { TABLA = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLA[i] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0;
}

module.exports = { exporta, zipStore, guidDe };
