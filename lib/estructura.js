/*
 * ESTRUCTURA ORGANICA para la portada «Direcciones ejecutoras»: Direccion › Subdireccion › Proyecto.
 * Es el mapa de proyectos de la entidad; cada proyecto del CDE se ubica en una hoja (config.ubicacion) o, si aun no se
 * le asigno, por coincidencia de nombre. Los proyectos del mapa que todavia no tienen CDE se muestran igual (sin enlace).
 */
'use strict';
const DIRECCIONES = [
  { id: 'DIME', nombre: 'Dirección de Intervención Multisectorial y de Emergencias', subs: [
    { id: 'SEJDI', nombre: 'SEJDI', proyectos: ['Proyecto 1'] },
    { id: 'SESDI', nombre: 'SESDI', proyectos: ['Proyecto 1'] }] },
  { id: 'DEO', nombre: 'Dirección de Estudios y Obras', subs: [
    { id: 'SES', nombre: 'Subdirección de Estudios', proyectos: ['Paquete 11', 'Hospital La Caleta', 'Hospital La Esperanza', 'Carretera Otuzco', 'Carretera Santiago de Chuco', 'Carretera Cachicadan', 'Control de Inundaciones del Río Piura', 'Quebradas del Río Piura', 'Programa Río RIMAC'] },
    { id: 'SEO', nombre: 'Subdirección de Obras', proyectos: ['Hospital Iren Sur', 'Carretera Yungay Yanama', 'Carretera Chulucanas', 'Canal Miguel Checa', 'Proyecto Río RIMAC'] }] }
];
const llano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Donde cae un proyecto del CDE: su config.ubicacion o, si no tiene, la hoja cuyo nombre esta contenido en el suyo. */
function ubicacionDe(p) {
  const u = (p.config && p.config.ubicacion) || null;
  if (u && u.direccion) { const d = DIRECCIONES.find(x => x.id === u.direccion), s = d && d.subs.find(x => x.id === u.sub); if (d && s) return { direccion: d.id, direccionNombre: d.nombre, sub: s.id, subNombre: s.nombre, proyecto: u.proyecto || '', asignada: true }; }
  const n = llano(p.nombre);
  for (const d of DIRECCIONES) for (const s of d.subs) for (const pr of s.proyectos) { if (/^proyecto \d+$/i.test(pr)) continue; const k = llano(pr); if (k && (n.includes(k) || k.includes(n))) return { direccion: d.id, direccionNombre: d.nombre, sub: s.id, subNombre: s.nombre, proyecto: pr, asignada: false }; }
  return null;
}
/** El arbol de la portada con los proyectos del CDE que ve el usuario colgados de su hoja. */
function arbol(proyectos) {
  const ub = proyectos.map(p => ({ p, u: ubicacionDe(p) }));
  const dirs = DIRECCIONES.map(d => ({ id: d.id, nombre: d.nombre, subs: d.subs.map(s => {
    const hojas = s.proyectos.map(nombre => ({ nombre, cde: ub.filter(x => x.u && x.u.direccion === d.id && x.u.sub === s.id && x.u.proyecto === nombre).map(x => x.p) }));
    const sueltos = ub.filter(x => x.u && x.u.direccion === d.id && x.u.sub === s.id && !s.proyectos.includes(x.u.proyecto)).map(x => ({ nombre: x.p.nombre, cde: [x.p] }));
    return { id: s.id, nombre: s.nombre, proyectos: hojas.concat(sueltos) };
  }) }));
  return { direcciones: dirs, sinUbicar: ub.filter(x => !x.u).map(x => x.p) };
}
module.exports = { DIRECCIONES, ubicacionDe, arbol };
