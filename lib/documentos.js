/*
 * BUSCAR - REGISTRO DE DOCUMENTOS (v0.6.2): lo que hace la busqueda de Aconex (Documentos › Buscar), sobre los documentos del CDE.
 *
 *  - Busqueda en TODOS los campos del documento (numero/nombre, titulo/descripcion, campos del nombre, atributos, revision,
 *    codigo de estado) y, si se pide, en el CONTENIDO del archivo (versiones.texto: lo que extrae lib/resumen.js al cargar;
 *    lo que aun no tenga texto se extrae aqui la primera vez, con tope).
 *  - Campos de Aconex ↔ CDE: No. de documento = nombre del contenedor · Titulo = descripcion (atributo o resumen) · Tipo,
 *    Direccion/Sector, Originador, Volumen/Sistema (Activo), Nivel, Disciplina, Etapa = campos de la nomenclatura
 *    (DOCPG002 o la norma del proyecto; se leen del nombre con lib/nomenclatura) · Estatus = codigo de estado (S2…A7 / P, S, A)
 *    · Revision = revision del nombre (R00 / P01 / C01) · Proyecto = proyectos del CDE donde el usuario es miembro (busqueda
 *    cruzada, como "Cross Project Search") · Etapas de revision = paso del flujo en curso · Estatus de revision = resultado de
 *    la ultima revision · Bloqueado = con revision abierta · Fecha: creacion / modificacion / vencimiento de la revision.
 *  - v0.9.5: «Nombre o descripcion del documento» (un solo campo: cada palabra en el nombre, el archivo o la descripcion),
 *    «Carpeta» (WIP / COM / PUB / archivado; PUB incluye las copias publicadas) y «Formato» (PDF, Revit, Word… por extension).
 *  - Mostrar historial de documentos: una fila por VERSION (si no, solo la ultima de cada contenedor).
 *  - Busquedas guardadas por usuario (tabla busquedas_guardadas).
 *  - Ficha "Propiedades del documento": historial de versiones (revision, estado, fecha, #version, transmision en que llego),
 *    propiedades, paquetes (conjuntos), elementos relacionados (vinculados, incidencias, revisiones), enviado(s)
 *    (informes de transmision y correos con la version adjunta), descargado (auditoria) e historial de eventos.
 *  Se monta despues de forma.js (usa ctx.cdeInterno).
 */
'use strict';
const { q, abreJson, json, id, ahora, audita } = require('./bd');
const NOM = require('./nomenclatura');
const ISO = require('./iso19650');
const D2 = require('./docpg002');
const RS = require('./resumen');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS busquedas_guardadas (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, nombre TEXT NOT NULL, consulta TEXT DEFAULT '{}', creado TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_bg ON busquedas_guardadas (email);`;

const obj = (v) => (v && typeof v === 'object' ? v : json(v, {}));   // atributos / campos: ya abiertos (abreJson) o aun en texto
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ESTADO_REV = { abierta: 'En revision', aprobada: 'Aprobada', 'aprobada-con-comentarios': 'Aprobada con comentarios', devuelta: 'Rechazada', anulada: 'Anulada' };
/** Nombre canonico de un campo de la norma (para casar "Codigo de proyecto", "Originador", "Activo"...). */
/** Formatos de archivo para el filtro «Formato»: [id, nombre, extensiones]. Una extension que no este aqui forma su propio formato. */
const FORMATOS = [
  ['pdf', 'PDF', ['pdf']], ['revit', 'Revit', ['rvt', 'rfa', 'rte']], ['ifc', 'IFC', ['ifc', 'ifczip', 'ifcxml']], ['navisworks', 'Navisworks', ['nwd', 'nwc', 'nwf']],
  ['autocad', 'AutoCAD', ['dwg', 'dxf', 'dwf', 'dwfx']], ['word', 'Word', ['doc', 'docx', 'dotx', 'odt', 'rtf']], ['excel', 'Excel', ['xls', 'xlsx', 'xlsm', 'csv', 'ods']],
  ['powerpoint', 'PowerPoint', ['ppt', 'pptx', 'odp']], ['cronograma', 'Cronograma', ['mpp', 'xer']], ['sketchup', 'SketchUp', ['skp']], ['nube', 'Nube de puntos', ['rcp', 'rcs', 'las', 'laz', 'e57']],
  ['bcf', 'BCF', ['bcf', 'bcfzip']], ['imagen', 'Imagen', ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp', 'heic']], ['video', 'Video', ['mp4', 'mov', 'avi', 'mkv']],
  ['comprimido', 'Comprimido', ['zip', 'rar', '7z']], ['texto', 'Texto', ['txt', 'md', 'json', 'xml']]
];
const extDe = (v) => String((v && (v.extension || (String(v.archivo || '').includes('.') ? String(v.archivo).split('.').pop() : ''))) || '').toLowerCase().replace(/^\./, '');
const formatoDe = (ext) => { const f = FORMATOS.find(x => x[2].includes(ext)); return f ? f[0] : (ext || 'sin-extension'); };
const formatoTxt = (ext) => { const f = FORMATOS.find(x => x[2].includes(ext)); return (f ? f[1] : (ext ? ext.toUpperCase() : 'Sin extensión')) + (ext ? ' (.' + ext + ')' : ''); };
const CAMPO = { proyecto: /proyecto|project/, originador: /originador|originator/, volumen: /activo|volumen|sistema|volume|system/, nivel: /nivel|level/, tipo: /tipo|type/, disciplina: /disciplina|especialidad|discipline/, etapa: /etapa|stage|fase/, numero: /secuencial|numero|number/ };

function monta(app, ctx) {
  const { requiereSesion, express, db } = ctx;
  db.exec(ESQUEMA);
  const I = ctx.cdeInterno; const J = express.json({ limit: '2mb' });
  const { proyecto, yo, permisoEn, flujosDe, miembrosDe } = I;
  const puedeLeer = (p, u, c) => permisoEn(p, u, c.carpeta).leer || (c.carpeta_publicada && permisoEn(p, u, c.carpeta_publicada).leer) || (c.retencion && permisoEn(p, u, c.retencion).subir);
  const proyectosDe = (req) => q.todos('SELECT * FROM proyectos WHERE activo = 1 ORDER BY codigo').map(p => abreJson(p, ['config'])).filter(p => ctx.rolEn(req.quien, p.id) || req.admin);

  /** Los campos "de Aconex" de un contenedor: del nombre (segun la norma de su carpeta) + atributos. */
  function camposDe(p, c, v) {
    const val = v ? NOM.valida(p.config, c.retencion || c.carpeta, v.archivo) : { campos: {}, revision: '', norma: null };
    let campos = val.campos && Object.keys(val.campos).length ? val.campos : {};
    if (!Object.keys(campos).length && v) {   // carpeta libre (WIP) o nombre no conforme: se intenta con la norma por defecto del proyecto y, si no, con lo leido al cargar
      const nd = (p.config.normas || []).find(n => n.id === p.config.normaPorDefecto) || (p.config.normas || [])[0];
      if (nd) { const r2 = ISO.valida(v.archivo, { nomenclatura: { campos: nd.campos, conRevision: nd.conRevision } }); if (r2.campos && Object.keys(r2.campos).length && ISO.partes(v.archivo).campos.length === nd.campos.length) campos = r2.campos; }
      if (!Object.keys(campos).length) campos = obj(c.campos);
    }
    const out = { proyecto: '', originador: '', volumen: '', nivel: '', tipo: '', disciplina: '', etapa: '', numero: '' };
    for (const [k, x] of Object.entries(campos)) { const nk = norm(k); for (const [cc, rx] of Object.entries(CAMPO)) if (!out[cc] && rx.test(nk)) { out[cc] = String(x || ''); break; } }
    const at = obj(c.atributos);
    const rs = v ? json(v.resumen, {}) : {};
    return Object.assign(out, { campos, atributos: at, titulo: at.descripcion || obj(c.campos).descripcion || obj(c.campos).titulo || '', revision: (v && v.revision) || val.revision || '', estatus: (v && v.idoneidad) || '', norma: val.norma ? val.norma.nombre : '', conforme: !!val.ok, sector: at.sector || at['direccion-sector'] || at.direccion_sector || '' });
  }
  const descTipo = (cod) => { const t = D2.TABLAS.tiposDocumento.find(x => x[0] === cod); return t ? t[1] : ''; };
  const descDisc = (cod) => { const t = D2.TABLAS.disciplinas.find(x => x[0] === cod); return t ? t[1] : ''; };
  const descActivo = (cod) => { const t = D2.TABLAS.activos.find(x => x[0] === cod); return t ? t[1] : ''; };
  const descNivel = (cod) => { const t = D2.TABLAS.niveles.find(x => x[0] === cod); return t ? t[1] : ''; };
  const descEtapa = (cod) => { const t = D2.TABLAS.etapas.find(x => x[0] === cod); return t ? t[1] : ''; };
  const descEstado = (cod) => { const t = D2.TABLAS.estados.find(x => x[0] === cod); return t ? t[1] : (ISO.IDONEIDAD && Object.values(ISO.IDONEIDAD).flat().includes(cod) ? cod : ''); };

  /** Catalogos para los desplegables del formulario (como "Seleccionar valores..." de Aconex): lo de la libreria + lo que hay en los proyectos. */
  app.get('/api/documentos/catalogos', requiereSesion, (req, res) => {
    const ps = proyectosDe(req);
    const usados = { tipo: new Set(), originador: new Set(), volumen: new Set(), nivel: new Set(), disciplina: new Set(), etapa: new Set(), estatus: new Set(), sector: new Set(), revision: new Set(), etapaRev: new Set() }, porFormato = {}, extsDe = {};
    for (const p of ps) {
      for (const c of q.todos("SELECT c.*, v.archivo, v.revision, v.idoneidad, v.resumen FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id WHERE c.proyecto_id = ? AND c.borrado = '' AND v.n = c.version_actual", p.id).map(r => abreJson(r, ['campos', 'atributos']))) {
        const f = camposDe(p, c, c); for (const k of ['tipo', 'originador', 'volumen', 'nivel', 'disciplina', 'etapa']) if (f[k]) usados[k].add(f[k]); if (f.estatus) usados.estatus.add(f.estatus); if (f.revision) usados.revision.add(f.revision); if (f.sector) usados.sector.add(f.sector);
        const ext = extDe(c), fm = formatoDe(ext); porFormato[fm] = (porFormato[fm] || 0) + 1; (extsDe[fm] = extsDe[fm] || new Set()).add(ext);
      }
      for (const fl of flujosDe(p)) for (const e of fl.etapas) usados.etapaRev.add(e.nombre);
    }
    const lista = (tabla, set) => { const out = tabla.map(([v, d]) => ({ valor: v, texto: v + ' - ' + d, enUso: set.has(v) })); for (const v of set) if (!tabla.some(x => x[0] === v)) out.push({ valor: v, texto: v, enUso: true }); return out; };
    res.json({
      proyectos: ps.map(p => ({ id: p.id, codigo: p.codigo, nombre: p.nombre })),
      tipo: lista(D2.TABLAS.tiposDocumento, usados.tipo), estatus: lista(D2.TABLAS.estados.concat([['P', 'Preliminar (WIP)']]), usados.estatus), sector: lista(D2.TABLAS.sectores, usados.sector),
      originador: [...usados.originador].sort().map(v => ({ valor: v, texto: v, enUso: true })).concat([{ valor: 'ANIN1', texto: 'ANIN1 - Autoridad Nacional de Infraestructura', enUso: usados.originador.has('ANIN1') }].filter(x => !usados.originador.has(x.valor))),
      volumen: lista(D2.TABLAS.activos, usados.volumen), nivel: lista(D2.TABLAS.niveles, usados.nivel), disciplina: lista(D2.TABLAS.disciplinas, usados.disciplina), etapa: lista(D2.TABLAS.etapas, usados.etapa),
      formato: FORMATOS.map(([v, t, ex]) => ({ valor: v, texto: t + ' - .' + ex.join(', .') + (porFormato[v] ? ' · ' + porFormato[v] + ' documento(s)' : ''), enUso: !!porFormato[v] }))
        .concat(Object.keys(porFormato).filter(v => !FORMATOS.some(x => x[0] === v)).sort().map(v => ({ valor: v, texto: (v === 'sin-extension' ? 'Sin extensión' : v.toUpperCase() + ' - .' + v) + ' · ' + porFormato[v] + ' documento(s)', enUso: true }))),
      revision: [...usados.revision].sort(), etapaRev: [...usados.etapaRev].sort(), estatusRev: Object.entries(ESTADO_REV).map(([v, t]) => ({ valor: v, texto: t })),
      tiposFecha: [['creacion', 'Fecha de creación'], ['modificacion', 'Fecha de modificación'], ['carga', 'Fecha de carga de la versión'], ['vencimiento', 'Fecha límite de la revisión'], ['revision', 'Fecha de la última revisión']].map(([v, t]) => ({ valor: v, texto: t })),
      columnas: COLUMNAS
    });
  });
  const COLUMNAS = [['archivo', 'Archivo'], ['numero', 'No. de documento'], ['titulo', 'Descripción'], ['revision', 'Revisión'], ['version', 'Versión'], ['estatusRev', 'Estatus de revisión'], ['bloqueado', 'Bloqueado'], ['estatus', 'Estatus'], ['modificado', 'Fecha de modificación'], ['tipo', 'Tipo'], ['disciplina', 'Disciplina'], ['proyecto', 'Proyecto'], ['originador', 'Originador'], ['volumen', 'Volumen / Sistema'], ['nivel', 'Nivel'], ['etapa', 'Etapa'], ['sector', 'Dirección/Sector'], ['etapaRev', 'Etapa de revisión'], ['carpeta', 'Carpeta'], ['estadoCde', 'Estado ISO 19650'], ['formato', 'Formato'], ['tamano', 'Tamaño'], ['creado', 'Fecha de creación'], ['por', 'Cargado por'], ['org', 'Organización'], ['vence', 'Fecha límite de revisión'], ['conforme', 'Nomenclatura'], ['norma', 'Norma']];

  /** La busqueda. body: { q, contenido, historial, proyectos[], filtros{...}, fechas[{tipo,desde,hasta}], pagina, porPagina, orden, dir } */
  app.post('/api/documentos/buscar', requiereSesion, J, async (req, res) => {
    const b = req.body || {}, f = b.filtros || {}, texto = norm(b.q || '').trim(), ps = proyectosDe(req).filter(p => !Array.isArray(b.proyectos) || !b.proyectos.length || b.proyectos.includes(p.id));
    const lista = (k) => (Array.isArray(f[k]) ? f[k] : (f[k] ? [f[k]] : [])).map(x => norm(x).trim()).filter(Boolean);
    const F = { tipo: lista('tipo'), estatus: lista('estatus'), sector: lista('sector'), originador: lista('originador'), volumen: lista('volumen'), nivel: lista('nivel'), disciplina: lista('disciplina'), etapa: lista('etapa'), etapaRev: lista('etapaRev'), estatusRev: lista('estatusRev'), estadoCde: lista('estadoCde'), carpeta: lista('carpeta'), formato: lista('formato') };
    const palabras = norm(f.nombre || '').trim().split(/\s+/).filter(Boolean);   // «Nombre o descripción del documento»: cada palabra en el nombre, el archivo o la descripción
    const numero = norm(f.numero || '').trim(), titulo = norm(f.titulo || '').trim(), revision = norm(f.revision || '').trim();
    const fechas = (Array.isArray(b.fechas) ? b.fechas : []).filter(x => x && x.tipo && (x.desde || x.hasta));
    const filas = []; let extraidos = 0;
    for (const p of ps) {
      const u = yo(req, p), miembros = miembrosDe(p.id), orgDe = {}; for (const m of miembros) orgDe[m.email] = m.organizacion;
      const conts = q.todos("SELECT * FROM contenedores WHERE proyecto_id = ? AND borrado = ''" + (F.estadoCde.length ? ' AND (LOWER(estado) IN (' + F.estadoCde.map(() => '?').join(',') + ')' + (F.estadoCde.includes('publicado') ? " OR carpeta_publicada <> ''" : '') + ')' : ''), p.id, ...F.estadoCde).map(c => abreJson(c, ['campos', 'atributos']));
      for (const c of conts) {
        if (!puedeLeer(p, u, c)) continue;
        if (F.carpeta.length && !F.carpeta.some(k => norm(c.carpeta).startsWith(k))) continue;
        const vers = b.historial ? q.todos('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC', c.id) : q.todos('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
        const revs = q.todos('SELECT * FROM revisiones WHERE contenedor_id = ? ORDER BY ronda DESC', c.id).map(r => abreJson(r, ['pasos', 'flujo_def']));
        const abierta = revs.find(r => r.estado === 'abierta'), ultRev = revs[0];
        let etapaRev = ''; if (abierta) { const fl = abierta.flujo_def && abierta.flujo_def.etapas ? abierta.flujo_def : I.flujoDe(p, abierta.flujo_id); etapaRev = fl && fl.etapas[abierta.paso] ? fl.etapas[abierta.paso].nombre : ''; }
        for (const v of vers) {
          const ext = extDe(v);
          if (F.formato.length && !F.formato.includes(formatoDe(ext))) continue;
          const x = camposDe(p, c, v);
          const fila = {
            proyecto_id: p.id, proyecto: p.codigo + ' ' + p.nombre, cid: c.id, vid: v.id, archivo: v.archivo, extension: ext, formato: formatoTxt(ext), tipoc: c.tipo, numero: c.nombre, titulo: x.titulo, revision: x.revision, version: v.n,
            estatusRev: ultRev ? (ESTADO_REV[ultRev.estado] || ultRev.estado) : '', estatusRevId: ultRev ? ultRev.estado : '', bloqueado: !!abierta, estatus: x.estatus ? x.estatus + (descEstado(x.estatus) ? ' - ' + descEstado(x.estatus) : '') : '', estatusCod: x.estatus,
            modificado: c.actualizado, creado: c.creado, carga: v.fecha, tipo: x.tipo ? x.tipo + (descTipo(x.tipo) ? ' - ' + descTipo(x.tipo) : '') : (c.tipo || ''), tipoCod: x.tipo, disciplina: x.disciplina ? x.disciplina + (descDisc(x.disciplina) ? ' - ' + descDisc(x.disciplina) : '') : '', disciplinaCod: x.disciplina,
            originador: x.originador, volumen: x.volumen ? x.volumen + (descActivo(x.volumen) ? ' - ' + descActivo(x.volumen) : '') : '', volumenCod: x.volumen, nivel: x.nivel ? x.nivel + (descNivel(x.nivel) ? ' - ' + descNivel(x.nivel) : '') : '', nivelCod: x.nivel, etapa: x.etapa ? x.etapa + (descEtapa(x.etapa) ? ' - ' + descEtapa(x.etapa) : '') : '', etapaCod: x.etapa,
            sector: x.sector, etapaRev, carpeta: c.carpeta, estadoCde: c.estado, tamano: v.tamano, por: v.subido_por, org: orgDe[v.subido_por] || '', vence: abierta ? (abierta.vence || '') : '', fechaRev: ultRev ? (ultRev.cerrada || ultRev.abierta) : '', conforme: x.conforme ? 'Cumple' : 'No cumple', norma: x.norma, atributos: x.atributos, campos: x.campos
          };
          // filtros de campo
          if (palabras.length) { const bn = norm(c.nombre + ' ' + v.archivo + ' ' + (fila.titulo || '')); if (!palabras.every(w => bn.includes(w))) continue; }
          if (numero && !norm(c.nombre).includes(numero) && !norm(v.archivo).includes(numero)) continue;
          if (titulo && !norm(fila.titulo).includes(titulo)) continue;
          if (revision && !norm(fila.revision).includes(revision)) continue;
          const pasa = (k, val) => !F[k].length || F[k].some(w => norm(val) === w || norm(val).startsWith(w + ' ') || norm(val).includes(w));
          if (!pasa('tipo', fila.tipoCod || fila.tipo) || !pasa('estatus', fila.estatusCod) || !pasa('sector', fila.sector) || !pasa('originador', fila.originador) || !pasa('volumen', fila.volumenCod) || !pasa('nivel', fila.nivelCod) || !pasa('disciplina', fila.disciplinaCod) || !pasa('etapa', fila.etapaCod) || !pasa('etapaRev', fila.etapaRev)) continue;
          if (F.estatusRev.length && !F.estatusRev.includes(norm(fila.estatusRevId))) continue;
          let okF = true; for (const fe of fechas) { const d = { creacion: fila.creado, modificacion: fila.modificado, carga: fila.carga, vencimiento: fila.vence, revision: fila.fechaRev }[fe.tipo] || ''; const dd = String(d).slice(0, 10); if (!dd) { okF = false; break; } if (fe.desde && dd < String(fe.desde).slice(0, 10)) { okF = false; break; } if (fe.hasta && dd > String(fe.hasta).slice(0, 10)) { okF = false; break; } }
          if (!okF) continue;
          // texto libre: todos los campos del documento (y el contenido si se pide)
          if (texto) {
            const bolsa = norm([c.nombre, v.archivo, fila.titulo, fila.revision, fila.estatus, fila.tipo, fila.disciplina, fila.originador, fila.volumen, fila.nivel, fila.etapa, fila.sector, c.carpeta, Object.values(x.atributos).join(' '), Object.values(x.campos).join(' '), (json(v.resumen, {}).ideas || []).join(' '), json(v.resumen, {}).objetivo, json(v.resumen, {}).conclusiones].join(' \u0001 '));
            let hay = bolsa.includes(texto);
            if (b.contenido) {
              let t = v.texto || '';
              if (!t && extraidos < 25) { extraidos++; try { const buf = ctx.almacen.existe(v.ruta_almacen) && v.tamano <= 60 * 1024 * 1024 ? require('fs').readFileSync(ctx.almacen.rutaAbsoluta(v.ruta_almacen)) : null; if (buf) { const ex = RS.extraeTexto(buf, v.archivo); t = ex.texto || ''; if (!t && ex.tipo === 'pdf') t = await RS.textoPdfJs(buf); t = t.slice(0, 400000); q.corre('UPDATE versiones SET texto = ? WHERE id = ?', t || '-', v.id); } } catch (e) {} }
              const enTexto = t && t !== '-' && norm(t).includes(texto); hay = hay || enTexto;
              if (enTexto) { const i = norm(t).indexOf(texto); fila.fragmento = t.slice(Math.max(0, i - 80), i + texto.length + 120).replace(/\s+/g, ' '); }
            }
            if (!hay) continue;
          }
          delete fila.atributos; delete fila.campos;
          filas.push(fila);
        }
      }
    }
    const orden = String(b.orden || 'numero'), dir = b.dir === 'desc' ? -1 : 1;
    filas.sort((a, c) => { const x = a[orden], y = c[orden]; if (x == null && y == null) return 0; if (typeof x === 'number' || typeof y === 'number') return ((x || 0) - (y || 0)) * dir; return String(x || '').localeCompare(String(y || ''), 'es', { numeric: true }) * dir || a.numero.localeCompare(c.numero, 'es', { numeric: true }); });
    const porPagina = Math.max(10, Math.min(500, Number(b.porPagina) || 100)), pagina = Math.max(1, Number(b.pagina) || 1);
    res.json({ total: filas.length, pagina, porPagina, paginas: Math.max(1, Math.ceil(filas.length / porPagina)), filas: filas.slice((pagina - 1) * porPagina, pagina * porPagina), proyectos: ps.length });
  });

  // busquedas guardadas (por usuario), como "Guardar busqueda como..."
  app.get('/api/documentos/busquedas', requiereSesion, (req, res) => res.json({ busquedas: q.todos('SELECT * FROM busquedas_guardadas WHERE email = ? ORDER BY nombre', String(req.quien).toLowerCase()).map(b => abreJson(b, ['consulta'])) }));
  app.post('/api/documentos/busquedas', requiereSesion, J, (req, res) => { const b = req.body || {}, nombre = String(b.nombre || '').trim().slice(0, 120); if (!nombre) return res.status(400).json({ error: 'datos', mensaje: 'Falta el nombre.' }); const bid = id('bq'); q.corre('INSERT INTO busquedas_guardadas (id, email, nombre, consulta, creado) VALUES (?,?,?,?,?)', bid, String(req.quien).toLowerCase(), nombre, JSON.stringify(b.consulta || {}), ahora()); res.json({ ok: true, id: bid }); });
  app.delete('/api/documentos/busquedas/:bid', requiereSesion, (req, res) => { q.corre('DELETE FROM busquedas_guardadas WHERE id = ? AND email = ?', req.params.bid, String(req.quien).toLowerCase()); res.json({ ok: true }); });

  /** Propiedades del documento (la pagina de Aconex): historial, propiedades, paquetes, relacionados, enviados, descargado, eventos. */
  app.get('/api/documentos/:pid/:cid', requiereSesion, (req, res) => {
    const p = proyecto(req.params.pid); if (!p) return res.status(404).json({ error: 'no-existe' });
    const u = yo(req, p); if (!(u.rol || u.admin)) return res.status(403).json({ error: 'sin-permiso' });
    const c = abreJson(q.uno("SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.cid, p.id), ['campos', 'atributos']); if (!c) return res.status(404).json({ error: 'no-existe' });
    if (!puedeLeer(p, u, c)) return res.status(403).json({ error: 'sin-permiso' });
    const vers = q.todos('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC', c.id).map(v => abreJson(v, ['meta', 'resumen']));
    const revs = q.todos('SELECT * FROM revisiones WHERE contenedor_id = ? ORDER BY ronda DESC', c.id).map(r => abreJson(r, ['pasos', 'flujo_def']));
    const trans = q.todos('SELECT * FROM transmisiones WHERE proyecto_id = ? ORDER BY numero DESC', p.id).map(t => abreJson(t, ['archivos', 'destinatarios']));
    const correos = q.todos("SELECT id, numero, asunto, de_email, de_org, para, creado, enviado, adjuntos, estado FROM correos WHERE proyecto_id = ? AND adjuntos LIKE '%version%'", p.id).map(m => abreJson(m, ['adjuntos', 'para']));
    const historial = vers.map(v => { const x = camposDe(p, c, v), rv = revs.filter(r => r.version_id === v.id), tr = trans.filter(t => t.archivos.some(a => a.version_id === v.id)), cr = correos.filter(m => (m.adjuntos || []).some(a => a.tipo === 'version' && a.id === v.id));
      return { vid: v.id, n: v.n, archivo: v.archivo, revision: x.revision, estatus: x.estatus, estatusTexto: descEstado(x.estatus), fecha: v.fecha, por: v.subido_por, origen: v.origen, tamano: v.tamano, revision_estado: rv[0] ? (ESTADO_REV[rv[0].estado] || rv[0].estado) : '', revision_numero: rv[0] ? rv[0].numero : null, revision_id: rv[0] ? rv[0].id : '', recibidoEn: tr.map(t => ({ id: t.id, numero: t.numero, titulo: t.titulo })).concat(cr.map(m => ({ correo: m.id, numero: m.numero, asunto: m.asunto }))), resumen: v.resumen || {} }; });
    const ult = vers[0] || null, x = ult ? camposDe(p, c, ult) : camposDe(p, c, null);
    const abierta = revs.find(r => r.estado === 'abierta'); let etapaRev = ''; if (abierta) { const fl = abierta.flujo_def && abierta.flujo_def.etapas ? abierta.flujo_def : I.flujoDe(p, abierta.flujo_id); etapaRev = fl && fl.etapas[abierta.paso] ? fl.etapas[abierta.paso].nombre : ''; }
    const prop = { numero: c.nombre, titulo: x.titulo, tipo: x.tipo, tipoTexto: descTipo(x.tipo), revision: x.revision, estatus: x.estatus, estatusTexto: descEstado(x.estatus), sector: x.sector, proyecto: p.codigo + ' ' + p.nombre, etapaRev, originador: x.originador, volumen: x.volumen, volumenTexto: descActivo(x.volumen), nivel: x.nivel, nivelTexto: descNivel(x.nivel), disciplina: x.disciplina, disciplinaTexto: descDisc(x.disciplina), etapa: x.etapa, etapaTexto: descEtapa(x.etapa), confidencial: !!x.atributos.confidencial, notas: x.atributos.notas || x.atributos.notasEmision || '', contrato: x.atributos.contrato || '', fechaHito: x.atributos.fechaHito || '', fechaEnvio: x.atributos.fechaEnvio || '', estatusRev: revs[0] ? (ESTADO_REV[revs[0].estado] || revs[0].estado) : '', version: ult ? ult.n : 0, origenRev: revs[0] ? '#' + revs[0].numero + ' · ' + (revs[0].flujo_def && revs[0].flujo_def.nombre || '') : '', estadoCde: c.estado, carpeta: c.carpeta, carpetaPublicada: c.carpeta_publicada || '', norma: x.norma, conforme: x.conforme, atributos: x.atributos, campos: x.campos, creado: c.creado, creadoPor: c.creado_por, actualizado: c.actualizado, extension: ult ? ult.extension : '', tamano: ult ? ult.tamano : 0, bloqueado: !!abierta };
    const paquetes = q.todos("SELECT * FROM conjuntos WHERE proyecto_id = ? AND borrado = ''", p.id).map(s => abreJson(s, ['items'])).filter(s => s.items.some(i => i.contenedor_id === c.id)).map(s => ({ id: s.id, nombre: s.nombre, n: s.items.length, por: s.por, actualizado: s.actualizado }));
    const relacionados = [];
    for (const v of vers) { const va = v.meta && v.meta.vinculadoA; if (va) { const cv = q.uno('SELECT id, nombre, estado FROM contenedores WHERE id = ?', va); if (cv) relacionados.push({ relacion: 'Vinculado a', cid: cv.id, numero: cv.nombre, estado: cv.estado, version: v.n }); } }
    for (const r of q.todos("SELECT v.n, c2.id, c2.nombre, c2.estado FROM versiones v JOIN contenedores c2 ON c2.id = v.contenedor_id WHERE c2.proyecto_id = ? AND c2.borrado = '' AND v.meta LIKE ?", p.id, '%"vinculadoA":"' + c.id + '"%')) relacionados.push({ relacion: 'Archivo vinculado', cid: r.id, numero: r.nombre, estado: r.estado, version: r.n });
    for (const i of q.todos("SELECT id, numero, codigo, titulo, estado FROM incidencias WHERE contenedor_id = ? AND borrado = ''", c.id)) relacionados.push({ relacion: 'Incidencia', incidencia: i.id, numero: i.codigo || '#' + i.numero, titulo: i.titulo, estado: i.estado });
    for (const r of revs) relacionados.push({ relacion: 'Revision', revision: r.id, numero: '#' + r.numero, titulo: r.nombre || '', estado: ESTADO_REV[r.estado] || r.estado });
    const enviados = []; for (const t of trans) for (const a of t.archivos) { const v = vers.find(z => z.id === a.version_id); if (v) enviados.push({ tipo: 'transmision', id: t.id, numero: t.numero, revision: camposDe(p, c, v).revision, version: v.n, asunto: t.titulo, remitente: t.por, fecha: t.creado, estatus: t.estado, correo: t.correo_id }); }
    for (const m of correos) for (const a of (m.adjuntos || [])) { const v = vers.find(z => z.id === a.id && a.tipo === 'version'); if (v) enviados.push({ tipo: 'correo', id: m.id, numero: m.numero, revision: camposDe(p, c, v).revision, version: v.n, asunto: m.asunto, remitente: m.de_email, fecha: m.enviado || m.creado, estatus: m.estado }); }
    const descargado = q.todos("SELECT fecha, quien, detalle FROM auditoria WHERE proyecto_id = ? AND accion IN ('version.descargar', 'compartido.descargar') AND objeto = ? ORDER BY id DESC LIMIT 300", p.id, c.id).map(r => Object.assign({ fecha: r.fecha, quien: r.quien }, json(r.detalle, {})));
    const eventos = q.todos("SELECT fecha, quien, accion, detalle FROM auditoria WHERE proyecto_id = ? AND (objeto = ? OR objeto = ?) ORDER BY id DESC LIMIT 500", p.id, c.id, c.nombre).map(r => ({ fecha: r.fecha, quien: r.quien, accion: r.accion, detalle: json(r.detalle, {}) }));
    const transiciones = q.todos('SELECT * FROM transiciones WHERE contenedor_id = ? ORDER BY id DESC', c.id);
    res.json({ proyecto: { id: p.id, codigo: p.codigo, nombre: p.nombre }, contenedor: { id: c.id, nombre: c.nombre, tipo: c.tipo, estado: c.estado, carpeta: c.carpeta }, propiedades: prop, historial, paquetes, relacionados, enviados, descargado, eventos, transiciones, puedoDescargar: permisoEn(p, u, c.carpeta).descargar || !!c.carpeta_publicada && permisoEn(p, u, c.carpeta_publicada).descargar });
  });
}
module.exports = { monta, CAMPO };
