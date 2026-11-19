/*
 * CARPETAS DEL PROYECTO: arbol editable con permisos por carpeta, al estilo de Autodesk Docs (ACC):
 *   - cada carpeta puede tener sus propias entradas de permiso (por organizacion, rol, usuario o todos) con uno de los
 *     6 niveles de ACC: ver | ver-descargar | subir | ver-descargar-subir | ver-descargar-subir-editar | control;
 *   - si una carpeta no tiene entradas propias, hereda las de la carpeta padre mas cercana que si las tenga;
 *   - el administrador y el gestor del proyecto tienen "control" en todas.
 * Ademas cada carpeta puede llevar una "zona" ISO 19650 (wip | compartido | publicado | archivo): lo que se sube a una
 * carpeta de zona compartido nace COMPARTIDO; al resto nace WIP. Nada mas: el estado es un atributo del contenedor.
 *
 * El arbol vive en config.carpetas = [{ ruta, nota, zona, permisos: [{ tipo, valor, nivel }] | null }].
 * La plantilla inicial reproduce la estructura que la DEO ya usa en Autodesk Docs para el Hospital La Caleta.
 */
'use strict';

const FAMILIA = (rol) => rol === 'miembro' || rol === 'document-control' ? 'autor' : rol === 'revisor-dc' ? 'revisor' : rol;
const NIVELES = ['ver', 'ver-descargar', 'subir', 'ver-descargar-subir', 'ver-descargar-subir-editar', 'control'];
const RANGO = { ver: 1, 'ver-descargar': 2, subir: 2, 'ver-descargar-subir': 3, 'ver-descargar-subir-editar': 4, control: 5 };
/** Que puede hacer cada nivel (tabla de permisos de carpeta de Autodesk Docs, resumida). */
const ACCIONES = {
  ver: { leer: true, descargar: false, subir: false, editar: false, control: false },
  'ver-descargar': { leer: true, descargar: true, subir: false, editar: false, control: false },
  subir: { leer: false, descargar: false, subir: true, editar: false, control: false },
  'ver-descargar-subir': { leer: true, descargar: true, subir: true, editar: false, control: false },
  'ver-descargar-subir-editar': { leer: true, descargar: true, subir: true, editar: true, control: false },
  control: { leer: true, descargar: true, subir: true, editar: true, control: true }
};
const NADA = { leer: false, descargar: false, subir: false, editar: false, control: false, nivel: '' };
const ZONAS = ['', 'wip', 'compartido', 'publicado', 'archivo'];

const limpia = (r) => String(r || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
const padreDe = (ruta) => ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '';
const nombreDe = (ruta) => ruta.includes('/') ? ruta.slice(ruta.lastIndexOf('/') + 1) : ruta;

/** La definicion de una carpeta (o null). */
function def(carpetas, ruta) { ruta = limpia(ruta); return (carpetas || []).find(c => c.ruta === ruta) || null; }

/** Las entradas de permiso que rigen una ruta: las propias o, si no tiene, las del ancestro mas cercano que tenga. */
function entradasVigentes(carpetas, ruta) {
  let r = limpia(ruta);
  for (;;) {
    const d = def(carpetas, r);
    if (d && Array.isArray(d.permisos) && d.permisos.length) return { entradas: d.permisos, heredadasDe: r === limpia(ruta) ? '' : r };
    if (!r) return { entradas: [], heredadasDe: '' };
    r = padreDe(r);
  }
}

/** Una entrada aplica al usuario si coincide con su correo, su rol, su organizacion, o es para todos. */
function aplica(entrada, u) {
  const v = String(entrada.valor || '').toLowerCase();
  if (entrada.tipo === '*' || entrada.tipo === 'todos') return true;
  if (entrada.tipo === 'usuario') return !!u.email && u.email.toLowerCase() === v;
  if (entrada.tipo === 'rol') { const r = String(u.rol || '').toLowerCase(); return r === v || FAMILIA(r) === v; }   // «autor» lo cumplen miembro y document-control; «revisor», los dos revisores
  if (entrada.tipo === 'funcion') return !!u.funcion && String(u.funcion).toLowerCase() === v;   // la Funcion del usuario: EMPRESA-CARGO-DISCIPLINA (A-ESP-DOC)
  if (entrada.tipo === 'org' || entrada.tipo === 'organizacion') return !!u.organizacion && String(u.organizacion).toLowerCase() === v;
  return false;
}

/** Permiso efectivo de un usuario { email, rol, organizacion, admin } sobre una ruta. El nivel mas alto que le aplique. */
function permiso(carpetas, u, ruta) {
  if (!u) return Object.assign({}, NADA);
  if (u.admin || u.rol === 'administrador' || u.rol === 'gestor') return Object.assign({}, ACCIONES.control, { nivel: 'control', motivo: u.rol === 'gestor' ? 'gestor del proyecto' : 'administrador' });
  const { entradas, heredadasDe } = entradasVigentes(carpetas, ruta);
  let mejor = '';
  for (const e of entradas) if (aplica(e, u) && RANGO[e.nivel] && (!mejor || RANGO[e.nivel] > RANGO[mejor])) mejor = e.nivel;
  if (!mejor) return Object.assign({}, NADA, { heredadasDe });
  // Topes por nivel de acceso: los revisores solo leen lo que esta en WIP; el miembro no carga ni edita fuera de WIP (a compartido pasa Document Control).
  const zona = zonaDe(carpetas, ruta), rol = String(u.rol || ''), soloLee = ((rol === 'revisor' || rol === 'revisor-dc') && zona === 'wip') || ((rol === 'miembro' || rol === 'autor') && (zona === 'compartido' || zona === 'publicado'));
  if (soloLee && (ACCIONES[mejor].subir || ACCIONES[mejor].editar)) { if (mejor === 'subir') return Object.assign({}, NADA, { heredadasDe, tope: rol }); return Object.assign({}, ACCIONES['ver-descargar'], { nivel: 'ver-descargar', heredadasDe, tope: rol }); }
  return Object.assign({}, ACCIONES[mejor], { nivel: mejor, heredadasDe });
}

/** Zona ISO de una ruta: la propia o la del ancestro mas cercano con zona. */
function zonaDe(carpetas, ruta) {
  let r = limpia(ruta);
  for (;;) { const d = def(carpetas, r); if (d && d.zona) return d.zona; if (!r) return ''; r = padreDe(r); }
}

/** Valida un nombre de carpeta (sin / ni caracteres raros). */
function nombreValido(n) { return /^[^\/\\:*?"<>|]{1,120}$/.test(String(n || '').trim()) && String(n).trim() !== '.' && String(n).trim() !== '..'; }

/** Normaliza y ordena el arbol; completa padres que falten. Devuelve una copia nueva. */
function normaliza(carpetas) {
  const m = new Map();
  for (const c of (carpetas || [])) {
    const ruta = limpia(c.ruta); if (!ruta) continue;
    const x = { ruta, nota: String(c.nota || '').slice(0, 300), zona: ZONAS.includes(c.zona) ? c.zona : '', permisos: normalizaPermisos(c.permisos) };
    if (c.disparador && c.disparador.flujo) x.disparador = { flujo: String(c.disparador.flujo).slice(0, 60) };
    if (c.norma) x.norma = String(c.norma).slice(0, 40);   // norma de nomenclatura propia ('libre' = sin norma; vacio = hereda)
    m.set(ruta, x);
  }
  for (const ruta of [...m.keys()]) { let p = padreDe(ruta); while (p && !m.has(p)) { m.set(p, { ruta: p, nota: '', zona: '', permisos: null }); p = padreDe(p); } }
  return [...m.values()].sort(ordenRutas);
}
/** Orden del arbol: por nombre, salvo las raices WIP / COM / PUB (y sus 'WIP CLIENTE'...) que van en el orden del flujo ISO 19650. Pura. */
const ORDEN_ISO = { WIP: 0, COM: 1, PUB: 2, ARCH: 3 };
function ordenRutas(a, b) {
  const A = a.ruta.split('/'), B = b.ruta.split('/');
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] === B[i]) continue;
    const ka = ORDEN_ISO[A[i].toUpperCase().split(' ')[0]], kb = ORDEN_ISO[B[i].toUpperCase().split(' ')[0]];
    if (ka !== undefined && kb !== undefined && ka !== kb) return ka - kb;
    if ((ka !== undefined) !== (kb !== undefined)) return ka !== undefined ? -1 : 1;
    return A[i].localeCompare(B[i], 'es', { numeric: true, sensitivity: 'base' });
  }
  return A.length - B.length;
}
function normalizaPermisos(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const out = [];
  for (const e of lista) {
    const tipo = e.tipo === '*' || e.tipo === 'todos' ? '*' : ['usuario', 'rol', 'org', 'funcion'].includes(e.tipo) ? e.tipo : (e.tipo === 'organizacion' ? 'org' : '');
    if (!tipo || !NIVELES.includes(e.nivel)) continue;
    const valor = tipo === '*' ? '' : tipo === 'usuario' ? String(e.valor || '').trim().toLowerCase() : String(e.valor || '').trim().toUpperCase();
    if (tipo !== '*' && !valor) continue;
    if (!out.some(x => x.tipo === tipo && x.valor === valor)) out.push({ tipo, valor, nivel: e.nivel });
  }
  return out.length ? out : null;
}

/** El arbol como lo ve un usuario: solo las carpetas que puede ver (o en las que puede subir), con su permiso y conteo. */
function arbol(carpetas, u, conteos, extras) {
  const todas = normaliza(carpetas);
  // carpetas que tienen contenedores pero no estan definidas (p.ej. de antes de aplicar la plantilla): se muestran igual
  for (const ruta of Object.keys(conteos || {})) if (ruta && !todas.some(c => c.ruta === ruta)) { for (const x of normaliza([{ ruta }])) if (!todas.some(c => c.ruta === x.ruta)) todas.push(Object.assign(x, { fuera: true })); }
  todas.sort(ordenRutas);
  const out = [];
  for (const c of todas) {
    const pm = permiso(carpetas, u, c.ruta);
    const nAbajo = Object.entries(conteos || {}).filter(([r]) => r === c.ruta || r.startsWith(c.ruta + '/')).reduce((s, [, n]) => s + n, 0);
    if (!pm.leer && !pm.subir && !(extras && extras.todo)) continue;
    out.push({ ruta: c.ruta, nombre: nombreDe(c.ruta), nivel: c.ruta.split('/').length - 1, nota: c.nota, zona: c.zona, zonaEfectiva: zonaDe(carpetas, c.ruta), fuera: !!c.fuera,
      permiso: pm.nivel, leer: pm.leer, descargar: pm.descargar, subir: pm.subir, editar: pm.editar, control: pm.control, propios: !!(c.permisos && c.permisos.length), heredadasDe: pm.heredadasDe || '',
      n: (conteos || {})[c.ruta] || 0, nAbajo, disparador: c.disparador ? c.disparador.flujo : '', norma: c.norma || '' });
  }
  // carpetas "de paso": si alguien tiene acceso a E1/WIP/WIP CONTRATISTA pero no a E1/WIP, ve E1/WIP para llegar (sin su contenido), como en Autodesk Docs
  const incl = new Set(out.map(c => c.ruta)), mapa = new Map(todas.map(c => [c.ruta, c]));
  for (const c of out.slice()) { const ps = c.ruta.split('/'); for (let i = 1; i < ps.length; i++) { const a = ps.slice(0, i).join('/'); if (incl.has(a)) continue; incl.add(a); const d = mapa.get(a) || {};
    out.push({ ruta: a, nombre: nombreDe(a), nivel: i - 1, nota: d.nota || '', zona: d.zona || '', zonaEfectiva: zonaDe(carpetas, a), fuera: !!d.fuera, paso: true, permiso: '', leer: false, descargar: false, subir: false, editar: false, control: false, propios: !!(d.permisos && d.permisos.length), heredadasDe: '', n: 0, nAbajo: 0, disparador: '' }); } }
  out.sort(ordenRutas);
  return out;
}

/** Crea una carpeta; devuelve el arbol nuevo o { error }. */
function crea(carpetas, padre, nombre, opciones) {
  const o = opciones || {}, p = limpia(padre), n = String(nombre || '').trim();
  if (!nombreValido(n)) return { error: 'El nombre de carpeta no es valido (sin / \\ : * ? " < > |, hasta 120 caracteres).' };
  if (p && !def(carpetas, p)) return { error: 'La carpeta padre no existe.' };
  const ruta = p ? p + '/' + n : n;
  if (def(carpetas, ruta)) return { error: 'Ya existe una carpeta con ese nombre ahi.' };
  const lista = normaliza(carpetas); lista.push({ ruta, nota: String(o.nota || '').slice(0, 300), zona: ZONAS.includes(o.zona) ? o.zona : '', permisos: normalizaPermisos(o.permisos) });
  return { carpetas: normaliza(lista), ruta };
}
/** Renombra (solo el ultimo tramo). Devuelve el arbol nuevo y el mapa de rutas viejas → nuevas para mover contenedores. */
function renombra(carpetas, ruta, nuevoNombre) {
  const r = limpia(ruta), n = String(nuevoNombre || '').trim();
  if (!def(carpetas, r)) return { error: 'La carpeta no existe.' };
  if (!nombreValido(n)) return { error: 'El nombre de carpeta no es valido.' };
  const nueva = (padreDe(r) ? padreDe(r) + '/' : '') + n;
  if (nueva === r) return { carpetas: normaliza(carpetas), de: r, a: r };
  if (def(carpetas, nueva)) return { error: 'Ya existe una carpeta con ese nombre.' };
  const lista = normaliza(carpetas).map(c => c.ruta === r || c.ruta.startsWith(r + '/') ? Object.assign({}, c, { ruta: nueva + c.ruta.slice(r.length) }) : c);
  return { carpetas: normaliza(lista), de: r, a: nueva };
}
/** Borra una carpeta y sus hijas (el que llama comprueba que no tengan contenedores). */
function borra(carpetas, ruta) {
  const r = limpia(ruta); if (!def(carpetas, r)) return { error: 'La carpeta no existe.' };
  return { carpetas: normaliza(carpetas).filter(c => !(c.ruta === r || c.ruta.startsWith(r + '/'))) };
}
/** Cambia nota / zona / permisos de una carpeta (permisos: lista, o null/[] para volver a heredar). */
function edita(carpetas, ruta, cambios) {
  const r = limpia(ruta), lista = normaliza(carpetas), d = lista.find(c => c.ruta === r);
  if (!d) return { error: 'La carpeta no existe.' };
  if (cambios.nota !== undefined) d.nota = String(cambios.nota || '').slice(0, 300);
  if (cambios.zona !== undefined) { if (!ZONAS.includes(cambios.zona)) return { error: 'Zona no valida (wip, compartido, publicado, archivo o vacia).' }; d.zona = cambios.zona; }
  if (cambios.permisos !== undefined) d.permisos = normalizaPermisos(cambios.permisos);
  if (cambios.disparador !== undefined) { if (cambios.disparador && cambios.disparador.flujo) d.disparador = { flujo: String(cambios.disparador.flujo).slice(0, 60) }; else delete d.disparador; }
  if (cambios.norma !== undefined) { if (cambios.norma) d.norma = String(cambios.norma).slice(0, 40); else delete d.norma; }
  return { carpetas: lista };
}

/**
 * PLANTILLA "ACC La Caleta": la estructura que la DEO usa en Autodesk Docs (Archivos de proyecto), con las carpetas de
 * administracion por organizacion, las etapas (E2, E3...) y dentro de cada etapa las zonas ISO 19650. Los nombres de los
 * subentregables son los de la Presentacion 4.0 tal como estan en ACC; se agregan o renombran desde la web.
 * opciones: { orgContr: 'GHEMET', orgSuper: 'SUPERVISION', etapas: [{ codigo:'E3', nombre:'DISEÑO PRELIMINAR', presentaciones:[...] }] }
 */
/** PLANTILLA POR ETAPAS CON WIP / COM / PUB (v0.5.2, la de Erick, 9/11/2026: "la etapa debe mandar").
 *  Cada etapa (E1..E6, con nombre opcional: E3_DISEÑO PRELIMINAR) contiene WIP, COM y PUB; WIP y COM tienen una carpeta por
 *  parte (WIP CLIENTE · WIP CONTRATISTA · WIP SUPERVISIÓN) y PUB solo PUB CLIENTE. En el portal, los botones WIP · COM · PUB
 *  filtran el arbol para mostrar esa zona en todas las etapas.
 *  Opciones: orgCliente (ANIN), orgContr, orgSuper, conContr / conSuper (false = administracion directa: sin esas carpetas),
 *  etapas [{ codigo: 'E1', nombre: '' }...].
 *  Permisos: WIP de cada parte lo edita esa organizacion (el cliente ve las tres); COM lo ve todo el proyecto y lo sube la
 *  organizacion duena; PUB lo ve todo el proyecto y lo llena el cliente (o el flujo de revision al aprobar). */
const PARTES = { CLIENTE: 'CLIENTE', CONTRATISTA: 'CONTRATISTA', SUPERVISION: 'SUPERVISIÓN' };
function etapaNombre(e) { return e.codigo + (e.nombre ? '_' + e.nombre : ''); }
function plantillaWcp(opciones) {
  const o = { orgCliente: 'ANIN', orgContr: 'CONTRATISTA', orgSuper: 'SUPERVISION', conContr: true, conSuper: true, etapas: null };
  for (const [k, v] of Object.entries(opciones || {})) if (v !== undefined && v !== null && v !== '') o[k] = v;
  const A = String(o.orgCliente).toUpperCase(), C = String(o.orgContr).toUpperCase(), S = String(o.orgSuper).toUpperCase();
  const etapas = (Array.isArray(o.etapas) && o.etapas.length ? o.etapas : [1, 2, 3, 4, 5, 6].map(n => ({ codigo: 'E' + n, nombre: '' }))).map(e => ({ codigo: String(e.codigo || '').trim().toUpperCase(), nombre: String(e.nombre || '').trim() })).filter(e => e.codigo);
  const todosVen = [{ tipo: '*', valor: '', nivel: 'ver-descargar' }], edita = (org) => ({ tipo: 'org', valor: org, nivel: 'ver-descargar-subir-editar' }), ve = (org) => ({ tipo: 'org', valor: org, nivel: 'ver-descargar' });
  const L = [], add = (ruta, zona, permisos, nota) => L.push({ ruta, zona: zona || '', permisos: permisos || null, nota: nota || '' });
  const partes = [[PARTES.CLIENTE, A]].concat(o.conContr ? [[PARTES.CONTRATISTA, C]] : [], o.conSuper ? [[PARTES.SUPERVISION, S]] : []);
  for (const e of etapas) {
    const base = etapaNombre(e);
    add(base, '', todosVen, 'Etapa ' + e.codigo + (e.nombre ? ' · ' + e.nombre : ''));
    // WIP: privado por parte (el cliente ve las tres; cada organizacion edita la suya)
    add(base + '/WIP', 'wip', [ve(A)], 'Trabajo en progreso de la etapa ' + e.codigo + ': cada parte trabaja en su carpeta');
    for (const [parte, org] of partes) add(base + '/WIP/WIP ' + parte, 'wip', parte === PARTES.CLIENTE ? [edita(A)] : [edita(org), ve(A)], 'WIP de ' + parte + ' (' + org + ')');
    // COM: compartido con todo el proyecto; sube la parte duena
    add(base + '/COM', 'compartido', todosVen, 'Compartido de la etapa ' + e.codigo + ': lo que cada parte pone a disposicion de las demas');
    for (const [parte, org] of partes) add(base + '/COM/COM ' + parte, 'compartido', [edita(org)].concat(todosVen), 'Compartido por ' + parte + ' (' + org + ')');
    // PUB: solo el cliente; lo llena el flujo de revision al aprobar
    add(base + '/PUB', 'publicado', [edita(A)].concat(todosVen), 'Publicado de la etapa ' + e.codigo + ': informacion aprobada por el cliente');
    add(base + '/PUB/PUB ' + PARTES.CLIENTE, 'publicado', [edita(A)].concat(todosVen), 'Publicado por ' + A);
  }
  return normaliza(L);
}
/** PLANTILLA POR ZONAS (v0.6.6, DEO 10/11/2026): la zona manda y dentro va la etapa.
 *    WIP › ETAPA 1..4 › CONTRATISTA · SUPERVISION        (trabajo en progreso: cada parte en su carpeta; el cliente las ve)
 *    COM › ETAPA 1..4 › CONTRATISTA · SUPERVISION        (compartido: lo ve todo el proyecto; sube la parte duena)
 *    PUB › ETAPA 1..4 › PUB CLIENTE                      (publicado, como en la plantilla por etapas: lo llena el cliente o el flujo al aprobar)
 *  Opciones: las de plantillaWcp; etapas [{ codigo: 'E1', nombre: '' }] (por defecto 4). La carpeta de la etapa se llama «ETAPA n» (+ « - NOMBRE»). */
function etapaZona(e) { const n = /(\d+)/.exec(e.codigo); return (n ? 'ETAPA ' + parseInt(n[1], 10) : e.codigo) + (e.nombre ? ' - ' + e.nombre : ''); }
function plantillaZonas(opciones) {
  const o = { orgCliente: 'ANIN', orgContr: 'CONTRATISTA', orgSuper: 'SUPERVISION', conContr: true, conSuper: true, etapas: null };
  for (const [k, v] of Object.entries(opciones || {})) if (v !== undefined && v !== null && v !== '') o[k] = v;
  const A = String(o.orgCliente).toUpperCase(), C = String(o.orgContr).toUpperCase(), S = String(o.orgSuper).toUpperCase();
  const etapas = (Array.isArray(o.etapas) && o.etapas.length ? o.etapas : [1, 2, 3, 4].map(n => ({ codigo: 'E' + n, nombre: '' }))).map(e => ({ codigo: String(e.codigo || '').trim().toUpperCase(), nombre: String(e.nombre || '').trim() })).filter(e => e.codigo);
  const todosVen = [{ tipo: '*', valor: '', nivel: 'ver-descargar' }], edita = (org) => ({ tipo: 'org', valor: org, nivel: 'ver-descargar-subir-editar' }), ve = (org) => ({ tipo: 'org', valor: org, nivel: 'ver-descargar' });
  const L = [], add = (ruta, zona, permisos, nota) => L.push({ ruta, zona: zona || '', permisos: permisos || null, nota: nota || '' });
  const partes = (o.conContr ? [['CONTRATISTA', C]] : []).concat(o.conSuper ? [['SUPERVISION', S]] : []);
  add('WIP', 'wip', [ve(A)], 'Trabajo en progreso: cada parte trabaja en su carpeta de la etapa');
  for (const e of etapas) { const b = 'WIP/' + etapaZona(e); add(b, 'wip', [ve(A)], 'Trabajo en progreso de la ' + etapaZona(e)); for (const [parte, org] of partes) add(b + '/' + parte, 'wip', [edita(org), ve(A)], 'WIP de ' + parte + ' (' + org + ')'); }
  add('COM', 'compartido', todosVen, 'Compartido: lo que cada parte pone a disposicion de las demas (de aqui salen las revisiones)');
  for (const e of etapas) { const b = 'COM/' + etapaZona(e); add(b, 'compartido', todosVen, 'Compartido de la ' + etapaZona(e)); for (const [parte, org] of partes) add(b + '/' + parte, 'compartido', [edita(org)].concat(todosVen), 'Compartido por ' + parte + ' (' + org + ')'); }
  add('PUB', 'publicado', [edita(A)].concat(todosVen), 'Publicado: informacion aprobada por el cliente');
  for (const e of etapas) { const b = 'PUB/' + etapaZona(e); add(b, 'publicado', [edita(A)].concat(todosVen), 'Publicado de la ' + etapaZona(e)); add(b + '/PUB ' + PARTES.CLIENTE, 'publicado', [edita(A)].concat(todosVen), 'Publicado por ' + A); }
  return normaliza(L);
}
/** Las partes de la plantilla (para saber cual es la carpeta WIP / COM de cada organizacion). Pura. */
function partesWcp(opciones) {
  const o = Object.assign({ orgCliente: 'ANIN', orgContr: 'CONTRATISTA', orgSuper: 'SUPERVISION', conContr: true, conSuper: true }, opciones || {});
  const r = { [PARTES.CLIENTE]: String(o.orgCliente).toUpperCase() };
  if (o.conContr) r[PARTES.CONTRATISTA] = String(o.orgContr).toUpperCase();
  if (o.conSuper) r[PARTES.SUPERVISION] = String(o.orgSuper).toUpperCase();
  return r;
}
/** Mueve una carpeta (con sus hijas) dentro de otra ('' = la raiz). Devuelve { carpetas, de, a } o { error }. Pura. */
function mueve(carpetas, ruta, destino) {
  const r = limpia(ruta), d = limpia(destino || '');
  if (!def(carpetas, r)) return { error: 'La carpeta no existe.' };
  if (d && !def(carpetas, d)) return { error: 'La carpeta de destino no existe.' };
  if (d === r || d.startsWith(r + '/')) return { error: 'Una carpeta no se puede mover dentro de si misma.' };
  if (padreDe(r) === d) return { error: 'La carpeta ya esta ahi.' };
  const nueva = (d ? d + '/' : '') + nombreDe(r);
  if (def(carpetas, nueva)) return { error: 'En el destino ya hay una carpeta llamada "' + nombreDe(r) + '".' };
  const lista = normaliza(carpetas).map(c => c.ruta === r || c.ruta.startsWith(r + '/') ? Object.assign({}, c, { ruta: nueva + c.ruta.slice(r.length) }) : c);
  return { carpetas: normaliza(lista), de: r, a: nueva };
}

function plantillaAcc(opciones) {
  const o = { orgContr: 'CONTRATISTA', orgSuper: 'SUPERVISION', orgEntidad: 'ANIN' };
  for (const [k, v] of Object.entries(opciones || {})) if (v !== undefined && v !== null && v !== '') o[k] = v;
  const C = String(o.orgContr).toUpperCase(), S = String(o.orgSuper).toUpperCase(), A = String(o.orgEntidad).toUpperCase();
  const todosVen = [{ tipo: '*', valor: '', nivel: 'ver-descargar' }];
  const L = [];
  const add = (ruta, zona, permisos, nota) => L.push({ ruta, zona: zona || '', permisos: permisos || null, nota: nota || '' });
  // administracion: cada organizacion edita la suya; la entidad ve todo
  add('00_ADMIN_CONTRATISTA', '', [{ tipo: 'org', valor: C, nivel: 'ver-descargar-subir-editar' }, { tipo: 'org', valor: A, nivel: 'ver-descargar' }], 'Documentos administrativos del Contratista');
  add('00_ADMIN_ENTIDAD', '', [{ tipo: 'org', valor: A, nivel: 'ver-descargar-subir-editar' }, { tipo: 'org', valor: C, nivel: 'ver-descargar' }, { tipo: 'org', valor: S, nivel: 'ver-descargar' }], 'Contrato, PGP, informacion de referencia de la entidad');
  for (const sub of ['01_PLAN DE GESTION', '02_ORDENES DE SERVICIO', '03_INFORMES', '04_OFICIOS', '05_REPORTES', '06_PRESENTACIONES', '07_REGISTROS FOTOGRÁFICOS', '08_SSOMA', '09_STAKEHOLDERS', '10_COMUNICACIONES', '11_PRENSA', '12_MEJORA CONTINUA', '13_BASES INTEGRADAS', '14_VIÁTICOS', '15_GESTION BIM', '16_AMBIENTAL']) add('00_ADMIN_ENTIDAD/' + sub);
  add('00_ADMIN_SUPERVISIÓN', '', [{ tipo: 'org', valor: S, nivel: 'ver-descargar-subir-editar' }, { tipo: 'org', valor: A, nivel: 'ver-descargar' }], 'Documentos administrativos de la Supervision');
  add('E2_PREINVERSIÓN', '', [{ tipo: 'org', valor: A, nivel: 'ver-descargar-subir-editar' }].concat(todosVen), 'Expediente de preinversion (referencia)');
  // Etapas tal como estan en Autodesk Docs (La Caleta): E2..E6; cada una con sus zonas y presentaciones contractuales
  const etapas = Array.isArray(o.etapas) && o.etapas.length ? o.etapas : [
    { codigo: 'E2', nombre: 'PREINVERSIÓN', presentaciones: [{ nombre: 'E2.1.Módulo de Identificación - Presentación 1 (P1)' }, { nombre: 'E2.2.Módulo de Formulación y Módulo de Evaluación - Presentación 2 (P2)' }, { nombre: 'E2.3. Perfil Final - Presentación 3 (P3)' }] },
    { codigo: 'E3', nombre: 'DISEÑO PRELIMINAR', presentaciones: [{
      nombre: 'E3. Desarrollo de Ingeniería - Presentación 4.0 (P4.0)',
      subentregables: ['E3.04.0.02 Arquitectura y Señalización', 'E3.04.0.04 Ingeniería Estructural', 'E3.04.0.05 Infraestructura Civil', 'E3.04.0.18 Plan de Costos - NRM Elemental Contract Sum Analysis', 'E3.04.0.20 BIM', 'E3.04.0.21 Plan de Ejecución del Proyecto', 'E3.04.0.22 Obras Provisionales', 'E3.04.0.23 Investigación sobre el terreno', 'E3.04.0.24 Documentos de Gestión']
    }, { nombre: 'E3. Desarrollo de Ingeniería- Presentación 4 (P4)' }] },
    { codigo: 'E4', nombre: 'DISEÑO DEFINITIVO', presentaciones: [] },
    { codigo: 'E5', nombre: 'CONSTRUCCIÓN', presentaciones: [] },
    { codigo: 'E6', nombre: 'CIERRE', simple: true }
  ];
  for (const e of etapas) {
    const base = e.codigo + '_' + e.nombre;
    add(base, '', [{ tipo: 'org', valor: C, nivel: 'ver-descargar-subir' }, { tipo: 'org', valor: S, nivel: 'ver-descargar-subir' }, { tipo: 'org', valor: A, nivel: 'ver-descargar-subir-editar' }], 'Etapa ' + e.codigo);
    if (e.simple) continue;
    // zona WIP: una carpeta privada por organizacion (solo la ve quien la trabaja; la entidad la ve)
    add(base + '/' + e.codigo + '.00_TRABAJO EN PROGRESO (WIP)', 'wip', [{ tipo: 'org', valor: A, nivel: 'ver-descargar' }], 'Trabajo en progreso: cada organizacion solo ve su carpeta');
    add(base + '/' + e.codigo + '.00_TRABAJO EN PROGRESO (WIP)/' + C, 'wip', [{ tipo: 'org', valor: C, nivel: 'ver-descargar-subir-editar' }]);
    add(base + '/' + e.codigo + '.00_TRABAJO EN PROGRESO (WIP)/' + S, 'wip', [{ tipo: 'org', valor: S, nivel: 'ver-descargar-subir-editar' }]);
    // zona compartida: lo que se presenta a revision (numeracion como en ACC)
    const comp = base + '/' + e.codigo + '.01_COMPARTIDO (SHARED)';
    add(comp, 'compartido', null, 'Informacion compartida para revision y coordinacion');
    add(comp + '/01. REVISIONES PREVIAS', 'compartido', null, 'Revisiones informales antes de la presentacion contractual');
    add(comp + '/02. REVISIÓN DE PRESENTACIONES CONTRACTUALES', 'compartido', null, 'Presentaciones contractuales (una carpeta por presentacion)');
    for (const pr of (e.presentaciones || [])) {
      add(comp + '/02. REVISIÓN DE PRESENTACIONES CONTRACTUALES/' + pr.nombre, 'compartido');
      for (const sub of (pr.subentregables || [])) add(comp + '/02. REVISIÓN DE PRESENTACIONES CONTRACTUALES/' + pr.nombre + '/' + sub, 'compartido');
    }
    // zona publicada: la llena el flujo al aprobar (nadie sube a mano salvo la entidad)
    add(base + '/' + e.codigo + '.02_PUBLICADO (PUBLISHED)', 'publicado', [{ tipo: 'org', valor: A, nivel: 'ver-descargar-subir-editar' }].concat(todosVen), 'Informacion aprobada: la copia aqui el flujo de revision');
    add(base + '/' + e.codigo + '.03_ARCHIVADO (ARCHIVE)', 'archivo', [{ tipo: 'org', valor: A, nivel: 'ver-descargar-subir-editar' }].concat(todosVen), 'Archivo de la etapa');
  }
  return normaliza(L);
}

module.exports = { plantillaZonas, etapaZona, plantillaWcp, partesWcp, mueve, PARTES, NIVELES, RANGO, ACCIONES, ZONAS, limpia, padreDe, nombreDe, def, permiso, entradasVigentes, zonaDe, normaliza, arbol, crea, renombra, borra, edita, plantillaAcc, nombreValido };
