/* CDE ANIN · Línea de tiempo contractual: del texto de un contrato se sacan las entregas que pide (qué documento, en qué plazo y
 * contado desde qué hecho) y, con la fecha de inicio, se proyectan sus fechas estimadas. La lectura es por reglas (no sale nada
 * del servidor) y siempre pasa por la validación de una persona antes de guardarse. */
const { q, json, id, ahora, audita } = require('./bd');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS contrato_lineas (
  id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, nombre TEXT NOT NULL, origen TEXT DEFAULT '', inicio TEXT DEFAULT '',
  parametros TEXT DEFAULT '{}', items TEXT DEFAULT '[]', por TEXT NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, borrado TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_contrato_lineas ON contrato_lineas (proyecto_id, borrado);
`;

// ───────── lectura del contrato
const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veinticinco: 25, veintiocho: 28, treinta: 30, cuarenta: 40, cuarentaicinco: 45, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100 };
const llano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const N_RX = '(\\d{1,3}|[a-z]+(?:\\s+y\\s+[a-z]+)?)(?:\\s*\\(\\s*(\\d{1,3})\\s*\\))?';
const U_RX = '(dias?|semanas?|mes(?:es)?)(\\s+(?:calendarios?|naturales|habiles|utiles|laborables))?';
const numero = (pal, par) => { if (par) return +par; if (/^\d+$/.test(pal)) return +pal; const t = pal.split(/\s+y\s+/); let n = 0; for (const x of t) { if (NUM[x] == null) return 0; n += NUM[x]; } return n; };
const unidad = (u) => /^sem/.test(u) ? 'semanas' : /^mes/.test(u) ? 'meses' : 'dias';
/** Plazos que reconoce: «dentro de (los) N días…», «en un plazo (máximo/no mayor) de N…», «a los N días…», «N días después/contados…». */
const PLAZOS = [
  new RegExp('(?:dentro\\s+de(?:l\\s+plazo\\s+de)?(?:\\s+l[oa]s)?(?:\\s+primer[oa]s)?|en\\s+(?:un\\s+|el\\s+)?plazo\\s+(?:maximo\\s+|no\\s+mayor\\s+(?:a|de)\\s+)?de(?:\\s+hasta)?|plazo\\s+(?:maximo\\s+)?de|a\\s+mas\\s+tardar\\s+(?:a\\s+)?l[oa]s|a\\s+l[oa]s|hasta\\s+l[oa]s|no\\s+mayor\\s+(?:a|de))\\s+' + N_RX + '\\s+' + U_RX, 'g'),
  new RegExp(N_RX + '\\s+' + U_RX + '\\s+(?:despues|posteriores|siguientes|contados|contadas|computados|a\\s+partir|desde|antes|previos)', 'g')
];
const PERIODOS = [[/\b(mensual(?:es|mente)?|cada\s+mes|todos\s+los\s+meses)\b/, 1, 'meses'], [/\b(quincenal(?:es|mente)?|cada\s+quince\s+dias|cada\s+15\s+dias)\b/, 15, 'dias'], [/\b(semanal(?:es|mente)?|cada\s+semana)\b/, 1, 'semanas'], [/\b(bimestral(?:es|mente)?|cada\s+dos\s+meses)\b/, 2, 'meses'], [/\b(trimestral(?:es|mente)?|cada\s+tres\s+meses)\b/, 3, 'meses']];
/** Lo que se entrega: de más específico a más general. */
const ENTREGAS = [/entregable\s*(?:n[°º.o]*\s*)?\d+[a-z]?(?:\s*[:\-–]\s*[^.;,\n]{3,70})?/, /plan\s+de\s+ejecucion\s+bim(?:\s*\(?(?:peb|bep)\)?)?/, /\b(?:peb|bep|midp|tidp)\b[^.;,\n]{0,40}/, /programa\s+(?:de\s+)?(?:trabajo|obra|ejecucion|aceptado|revisado|inicial)?[^.;,\n]{0,40}/, /cronograma[^.;,\n]{0,50}/, /informe[^.;,\n]{0,70}/, /reporte[^.;,\n]{0,60}/,
  /expediente\s+tecnico[^.;,\n]{0,50}/, /plan\s+de\s+[^.;,\n]{3,60}/, /(?:modelos?|maquetas?)\s+(?:bim|federados?|de\s+informacion)[^.;,\n]{0,50}/, /planos?[^.;,\n]{0,50}/, /memorias?\s+(?:descriptivas?|de\s+calculo)[^.;,\n]{0,40}/, /estudios?\s+(?:de|basicos?)[^.;,\n]{3,50}/, /(?:matriz|registro|acta|manual|protocolo|garantia|poliza|carta\s+fianza|liquidacion|valorizacion|metrados?|presupuesto|especificaciones\s+tecnicas)[^.;,\n]{0,50}/];
const INICIO_RX = /(fecha\s+de\s+inicio|inicio\s+del?\s+(?:contrato|servicio|plazo|la\s+prestacion|las\s+prestaciones)|suscripcion|firma\s+del\s+contrato|perfeccionamiento\s+del\s+contrato|orden\s+de\s+(?:inicio|servicio|proceder)|fecha\s+de\s+(?:comienzo|arranque)|starting\s+date|vigencia\s+del\s+contrato|notificacion\s+de\s+la\s+orden)/;
const EVENTO_RX = /(aprobacion|aceptacion|conformidad|levantamiento|absolucion|observaciones|recepcion|entrega|presentacion|notificacion|comunicacion|solicitud|requerimiento|culminacion|termino|fin\s+de|cierre|hito|fecha\s+clave)[^.;\n]{0,90}/;
const QUIEN_RX = /(contratista|consultor|proyectista|supervisor|supervision|entidad|gerente\s+de(?:l)?\s+proyecto|project\s+manager|cliente|contratante|locador)/;

/** Texto → entregas candidatas. Trabaja frase a frase; cada candidata lleva la cita de donde salió y la cláusula más cercana. */
function extrae(texto) {
  const crudo = String(texto || '').replace(/\r/g, '').replace(/[ \t]+/g, ' '), salida = [], vistos = new Set();
  let clausula = '', pagina = 0;
  // frases: se cortan en punto seguido de mayúscula, punto y coma o salto doble; los saltos simples dentro de un párrafo se unen
  const bloques = crudo.split(/\n{2,}|\n(?=\s*(?:cl[aá]usula\s+|art[ií]culo\s+|[A-Z]?\d{1,3}(?:\.\d{1,3}){0,3}[.)]?\s+[A-ZÁÉÍÓÚÑ]|entregable\s*(?:n[°º.o]*\s*)?\d))/i);
  for (const b of bloques) {
    const mp = /@@PAG (\d+)@@/.exec(b); if (mp) { pagina = +mp[1]; if (b.replace(/@@PAG \d+@@/g, '').trim().length < 25) continue; }
    const cab = /^\s*((?:cl[aá]usula|art[ií]culo)\s+[\w.]+|[A-Z]?\d{1,3}(?:\.\d{1,3}){0,3})[.)]?\s/i.exec(b); if (cab) clausula = cab[1].trim();
    for (const frase of b.replace(/@@PAG \d+@@/g, ' ').replace(/\n/g, ' ').split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ(«"])/)) {
      try {
      const f = frase.trim(); if (f.length < 25 || f.length > 900) continue; const L = llano(f);
      const plazos = []; for (const rx of PLAZOS) { rx.lastIndex = 0; let m; while ((m = rx.exec(L))) { const n = numero(m[1], m[2]); if (n > 0 && n <= 1500) plazos.push({ n, u: unidad(m[3]), hab: /habil|util|laborable/.test(m[4] || ''), fin: m.index + m[0].length, ini: m.index }); } }
      const per = PERIODOS.find(p => p[0].test(L));
      if (!plazos.length && !per) continue;
      const ent = ENTREGAS.map(rx => rx.exec(L)).filter(Boolean).sort((a, b2) => a.index - b2.index)[0]; if (!ent) continue;   // sin algo que entregar no es una entrega
      if (/(penalidad|multa|interes|pago\s+se\s+efectua|pagara|vigencia\s+de\s+la\s+garantia|resolver\s+el\s+contrato|arbitraje|conciliacion)/.test(L) && !/(present|entreg|remit|emit)/.test(L)) continue;
      const pz = plazos.sort((a, b2) => a.ini - b2.ini)[0] || null, cola = pz ? L.slice(pz.fin, pz.fin + 220) : L;
      let ref = 'evento', refTexto = '';
      const mr = /(?:de\s+|desde\s+|a\s+partir\s+de\s+|contad[oa]s\s+(?:desde|a\s+partir\s+de)\s+|siguientes\s+a\s+|posteriores\s+a\s+|despues\s+de\s+|luego\s+de\s+|tras\s+)(?:la\s+|el\s+|los\s+|las\s+|su\s+)?([^.;,]{4,120})/.exec(cola);
      if (!pz) ref = 'inicio';   // entrega periódica sin plazo propio: se repite desde el inicio
      else if (INICIO_RX.test(cola) || (!mr && INICIO_RX.test(L))) ref = 'inicio';
      else if (mr && EVENTO_RX.test(mr[1])) refTexto = f.slice(pz.fin).replace(/^[\s,]+/, '').slice(0, 140);
      else if (EVENTO_RX.test(cola)) refTexto = (EVENTO_RX.exec(cola) || [''])[0];
      else ref = 'inicio';
      const nombre = f.substr(ent.index, ent[0].length).replace(/\s+/g, ' ').replace(/\s+(dentro|en un plazo|a l[oa]s|a más tardar|hasta|que|el cual|la cual|deberán?|serán?|se|debe|después|luego|tras|antes|incluyendo|incluidos?|conforme|según|de acuerdo|para su|al gerente|a la entidad|al supervisor)(?=\s|$).*$/i, '').replace(/[\s:–\-]+$/, '').slice(0, 110);
      const antes = pz && /\b(antes|previos|anterior)/.test(cola.slice(0, 40)), quien = (QUIEN_RX.exec(L) || [''])[0];
      const k = llano(nombre) + '|' + (pz ? pz.n + pz.u : '') + '|' + (per ? per[1] + per[2] : '') + '|' + ref; if (vistos.has(k)) continue; vistos.add(k);
      salida.push({ id: id('ce'), nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), clausula, pagina, cita: f.slice(0, 420), cantidad: pz ? pz.n : 0, unidad: pz ? pz.u : 'dias', habiles: !!(pz && pz.hab), antes: !!antes,
        ref, refTexto, refItem: '', periodo: per ? { cada: per[1], unidad: per[2], delMes: per[2] === 'meses' && /(de\s+cada\s+mes|del\s+mes\s+siguiente|primeros)/.test(L) } : null, quien, incluir: true });
      } catch (e) { /* frase que no se pudo leer: se salta */ }
    }
  }
  // un plazo condicionado se encadena a la entrega que nombra («…aprobación del Entregable 1») o, si no nombra ninguna, a la anterior
  salida.forEach((it, i) => { if (it.ref !== 'evento') return; const t = llano(it.refTexto), n = /entregable\s*(?:n[°º.o]*\s*)?(\d+)/.exec(t);
    let dest = n ? salida.find(x => x !== it && new RegExp('entregable\\s*(?:n[°º.o]*\\s*)?' + n[1] + '\\b').test(llano(x.nombre))) : null;
    if (!dest) dest = salida.find(x => x !== it && llano(x.nombre).length > 6 && t.includes(llano(x.nombre).slice(0, 28)));
    if (!dest && i > 0 && /(entregable|informe|documento|producto)\s+(anterior|precedente)|(dicho|mismo)\s+(entregable|informe|documento|producto)/.test(t)) dest = salida[i - 1];
    if (dest) { it.ref = 'item'; it.refItem = dest.id; } else it.incluir = false; });   // sin hecho de referencia reconocible: queda fuera hasta que alguien diga a qué se encadena
  const dur = /plazo\s+(?:de\s+ejecucion|total|contractual|del\s+contrato|del\s+servicio)[^.;]{0,120}?(\d{1,4})\s*\)?\s*(dias|meses|semanas)/.exec(llano(crudo));
  return { items: salida.slice(0, 400), duracion: dur ? { cantidad: +dur[1], unidad: unidad(dur[2]) } : null, caracteres: crudo.length };
}

// ───────── proyección de fechas
const aD = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const aS = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function suma(d, n, u, hab) { const x = new Date(d.getTime()); if (u === 'meses') x.setMonth(x.getMonth() + n); else if (u === 'semanas') x.setDate(x.getDate() + n * 7);
  else if (hab) { let k = Math.abs(n), s = n < 0 ? -1 : 1; while (k > 0) { x.setDate(x.getDate() + s); if (x.getDay() !== 0 && x.getDay() !== 6) k--; } } else x.setDate(x.getDate() + n); return x; }
/** Fechas estimadas de cada entrega. Solo hace falta la fecha de inicio: lo condicionado se encadena con los días de revisión estimados. */
function proyecta(items, inicio, par) {
  const d0 = aD(inicio); if (!d0) return [];
  const rev = Math.max(0, Number(par && par.revision) || 15), durM = Math.max(1, Number(par && par.duracionMeses) || 12), fin = suma(d0, durM, 'meses'), F = new Map(), out = [];
  const fechaDe = (it, pila) => { if (F.has(it.id)) return F.get(it.id); if (pila.has(it.id)) return null; pila.add(it.id);
    let base = d0, tipo = 'firme';
    if (it.ref === 'item') { const o = items.find(x => x.id === it.refItem), fo = o ? fechaDe(o, pila) : null; if (fo) { base = suma(fo.fecha, rev, 'dias'); tipo = 'estimada'; } else tipo = 'supuesta'; }
    else if (it.ref === 'evento') { base = it.desfase != null && it.desfase !== '' ? suma(d0, Number(it.desfase) || 0, 'dias') : d0; tipo = it.desfase != null && it.desfase !== '' ? 'estimada' : 'supuesta'; }
    const r = { fecha: suma(base, (it.antes ? -1 : 1) * (Number(it.cantidad) || 0), it.unidad, it.habiles), tipo }; F.set(it.id, r); return r; };
  for (const it of items) { if (it.incluir === false) continue; const r = fechaDe(it, new Set()); if (!r) continue;
    if (it.periodo && it.periodo.delMes) { let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1), n = 1;   // «dentro de los primeros N días de cada mes»: se cuenta desde el día 1
      while (m <= fin && n <= 240) { const f = it.cantidad ? suma(new Date(m.getFullYear(), m.getMonth(), 0), it.cantidad, it.unidad, it.habiles) : m; out.push({ id: it.id, n, nombre: it.nombre + ' · ' + n, fecha: aS(f), tipo: 'periodica', clausula: it.clausula, quien: it.quien }); m = new Date(m.getFullYear(), m.getMonth() + it.periodo.cada, 1); n++; } }
    else if (it.periodo && it.periodo.cada > 0) { let f = it.cantidad ? r.fecha : suma(d0, it.periodo.cada, it.periodo.unidad), n = 1; while (f <= fin && n <= 240) { out.push({ id: it.id, n, nombre: it.nombre + ' · ' + n, fecha: aS(f), tipo: 'periodica', clausula: it.clausula, quien: it.quien }); f = suma(f, it.periodo.cada, it.periodo.unidad); n++; } }
    else out.push({ id: it.id, n: 0, nombre: it.nombre, fecha: aS(r.fecha), tipo: r.tipo, clausula: it.clausula, quien: it.quien }); }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
const limpia = (L) => (Array.isArray(L) ? L : []).slice(0, 500).map(x => ({ id: txt(x.id, 40) || id('ce'), nombre: txt(x.nombre, 200), clausula: txt(x.clausula, 60), pagina: Math.max(0, parseInt(x.pagina, 10) || 0), cita: txt(x.cita, 600), cantidad: Math.max(0, Math.min(3000, Number(x.cantidad) || 0)), unidad: ['dias', 'semanas', 'meses'].includes(x.unidad) ? x.unidad : 'dias', habiles: !!x.habiles, antes: !!x.antes,
  ref: ['inicio', 'item', 'evento'].includes(x.ref) ? x.ref : 'inicio', refTexto: txt(x.refTexto, 200), refItem: txt(x.refItem, 40), desfase: x.desfase === '' || x.desfase == null ? '' : Math.max(0, Math.min(5000, Number(x.desfase) || 0)), periodo: x.periodo && Number(x.periodo.cada) > 0 ? { cada: Math.min(365, Number(x.periodo.cada)), unidad: ['dias', 'semanas', 'meses'].includes(x.periodo.unidad) ? x.periodo.unidad : 'meses', delMes: !!x.periodo.delMes } : null, quien: txt(x.quien, 60), incluir: x.incluir !== false })).filter(x => x.nombre);

function monta(app, ctx) {
  const { requiereSesion, requiereRol, express, db } = ctx; db.exec(ESQUEMA);
  const J = express.json({ limit: '12mb' }), P = '/api/proyectos/:pid/contrato';
  const abre = (r) => r && Object.assign(r, { parametros: json(r.parametros, {}), items: json(r.items, []) });
  const una = (pid, lid) => abre(q.uno("SELECT * FROM contrato_lineas WHERE proyecto_id = ? AND id = ? AND borrado = ''", pid, lid));
  const dia = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  const par = (b) => ({ revision: Math.max(0, Math.min(365, Number((b || {}).revision) || 15)), duracionMeses: Math.max(1, Math.min(240, Number((b || {}).duracionMeses) || 12)) });
  app.get(P, requiereSesion, requiereRol('lector'), (req, res) => {
    const L = q.todos("SELECT * FROM contrato_lineas WHERE proyecto_id = ? AND borrado = '' ORDER BY creado DESC", req.pid).map(abre).map(r => { const pr = proyecta(r.items, r.inicio, r.parametros); return { id: r.id, nombre: r.nombre, origen: r.origen, inicio: r.inicio, entregas: r.items.filter(x => x.incluir !== false).length, fechas: pr.length, primera: pr.length ? pr[0].fecha : '', ultima: pr.length ? pr[pr.length - 1].fecha : '', por: r.por, creado: r.creado, actualizado: r.actualizado }; });
    res.json({ lineas: L, puedoEditar: ['gestor', 'administrador'].includes(req.rol) || !!req.admin });
  });
  // PDF del CDE que pueden ser el contrato (el navegador les saca el texto y lo manda a «analizar»)
  app.get(P + '/documentos', requiereSesion, requiereRol('gestor'), (req, res) => {
    res.json({ documentos: q.todos("SELECT c.id, c.nombre, c.carpeta, v.id AS version_id, v.archivo, v.n, v.tamano FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id AND v.n = (SELECT MAX(n) FROM versiones WHERE contenedor_id = c.id) WHERE c.proyecto_id = ? AND c.borrado = '' AND LOWER(v.archivo) LIKE '%.pdf' ORDER BY c.carpeta, c.nombre LIMIT 3000", req.pid) });
  });
  app.post(P + '/analizar', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const t = String((req.body || {}).texto || ''); if (t.replace(/\s/g, '').length < 200) return res.status(400).json({ error: 'sin-texto', mensaje: 'El archivo no trae texto que se pueda leer (suele pasar con contratos escaneados). Hace falta un PDF con texto seleccionable.' });
    res.json(extrae(t.slice(0, 6000000)));
  });
  app.post(P + '/proyectar', requiereSesion, requiereRol('lector'), J, (req, res) => { const b = req.body || {}; res.json({ fechas: proyecta(limpia(b.items), dia(b.inicio), par(b.parametros)) }); });
  app.get(P + '/:lid', requiereSesion, requiereRol('lector'), (req, res) => { const r = una(req.pid, req.params.lid); if (!r) return res.status(404).json({ error: 'no-existe' }); r.fechas = proyecta(r.items, r.inicio, r.parametros); r.puedoEditar = ['gestor', 'administrador'].includes(req.rol) || !!req.admin; res.json(r); });
  app.post(P, requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const b = req.body || {}, nombre = txt(b.nombre, 160).trim(); if (!nombre) return res.status(400).json({ error: 'nombre', mensaje: 'Ponle un nombre a la línea de tiempo.' });
    const lid = id('cl'); q.corre('INSERT INTO contrato_lineas (id, proyecto_id, nombre, origen, inicio, parametros, items, por, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)', lid, req.pid, nombre, txt(b.origen, 200), dia(b.inicio), JSON.stringify(par(b.parametros)), JSON.stringify(limpia(b.items)), req.quien, ahora(), ahora());
    try { audita(req.pid, req.quien, 'contrato.linea.crear', lid, { nombre }); } catch (e) {} res.json({ ok: true, id: lid });
  });
  app.put(P + '/:lid', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const r = una(req.pid, req.params.lid), b = req.body || {}; if (!r) return res.status(404).json({ error: 'no-existe' });
    q.corre('UPDATE contrato_lineas SET nombre = ?, inicio = ?, parametros = ?, items = ?, actualizado = ? WHERE id = ?', b.nombre !== undefined ? (txt(b.nombre, 160).trim() || r.nombre) : r.nombre, b.inicio !== undefined ? dia(b.inicio) : r.inicio, JSON.stringify(b.parametros !== undefined ? par(b.parametros) : r.parametros), JSON.stringify(b.items !== undefined ? limpia(b.items) : r.items), ahora(), r.id);
    res.json({ ok: true });
  });
  app.delete(P + '/:lid', requiereSesion, requiereRol('gestor'), (req, res) => { const r = una(req.pid, req.params.lid); if (!r) return res.status(404).json({ error: 'no-existe' }); q.corre('UPDATE contrato_lineas SET borrado = ? WHERE id = ?', ahora(), r.id); res.json({ ok: true }); });
}

module.exports = { monta, extrae, proyecta };
