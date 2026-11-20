/*
 * EL CDE PROPIAMENTE: proyectos y miembros, carpetas con permisos (lib/carpetas.js), contenedores de informacion con sus
 * versiones y estados ISO 19650, flujos de revision configurables con etapas en paralelo (lib/flujos.js), incidencias
 * (metadatos de la Guia Nacional BIM / ISO 19650 y exportacion BCF), llaves de complementos y auditoria.
 * La correspondencia y los registros NEC estan en lib/correspondencia.js. Todo lo que cambia algo deja fila en auditoria.
 *
 * v0.3: carpetas editables con permisos por organizacion/rol/usuario (6 niveles de Autodesk Docs), plantilla tomada de la
 * estructura de la DEO en ACC, flujos editables (iniciadores, pasos uno/todos/minimo, dias, copiar al aprobar) con etapas
 * en paralelo e independientes del tipo de documento.
 */
'use strict';
const path = require('path');
const { q, ahora, id, json, audita, abreJson, extDe, contenedorPorNombre } = require('./bd');
const ISO = require('./iso19650');
const BCF = require('./bcf');
const CAR = require('./carpetas');
const FL = require('./flujos');
const EST = require('./estructura');
const CATU = require('./catalogo-usuarios');
const NOM = require('./nomenclatura');
const D2 = require('./docpg002');
const QA = require('./qa');

const ESTADOS_INC = ['abierta', 'en-analisis', 'respondida', 'verificada', 'cerrada', 'rechazada'];
const TIPOS_INC = ['observacion', 'interferencia', 'consulta', 'no-conformidad', 'cambio-de-diseno', 'mejora'];
const IMPACTOS = ['plazo', 'costo', 'calidad', 'seguridad', 'alcance'];
const ORIGENES = ['revision-documentaria', 'coordinacion-3d', 'auditoria-modelo', 'reunion', 'obra', 'otro', 'autodesk-forma'];
const ESTADO_LEGADO = { 'en-curso': 'en-analisis' };

function monta(app, ctx) {
  const { requiereSesion, requiereRol, requiereLlave, creaLlave, rolEn, esAdminGlobal, almacen, express } = ctx;
  const J = express.json({ limit: '2mb' });
  const resumenes = ctx.resumenes || null;   // lib/resumen.js: cola de resumenes automaticos (si esta montado)
  const quien = (req) => req.quien;
  /** El proyecto con su config ya abierta y migrada al modelo v0.3 (carpetas + flujos). */
  function proyecto(pid) {
    const p = abreJson(q.uno('SELECT * FROM proyectos WHERE id = ?', pid), ['config']); if (!p) return null;
    if (migraConfig(p.config)) q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(p.config), p.id);
    return p;
  }
  /** v0.2 → v0.3: la "estructura por partes" se retira; sus flujos se convierten al modelo nuevo. Devuelve true si cambio algo. */
  function migraConfig(cfg) {
    let cambio = false;
    if (cfg.estructura) { if (!Array.isArray(cfg.flujos) || !cfg.flujos.length) cfg.flujos = FL.migraV02(cfg.estructura.flujos, cfg.estructura); delete cfg.estructura; cambio = true; }
    if (Array.isArray(cfg.flujos) && cfg.flujos.some(f => !Array.isArray(f.etapas))) { cfg.flujos = FL.migraV02(cfg.flujos); cambio = true; }
    if (!Array.isArray(cfg.carpetas) && Array.isArray(cfg.carpetasLibres)) { cfg.carpetas = CAR.normaliza(cfg.carpetasLibres.map(r => ({ ruta: r }))); cambio = true; }
    if (NOM.migra(cfg)) cambio = true;   // v0.6: varias normas de nomenclatura + area de retencion
    return cambio;
  }
  /** Quien es el usuario dentro del proyecto: correo, rol, organizacion. */
  function yo(req, p) {
    const m = q.uno('SELECT rol, organizacion, cargo, funcion FROM miembros WHERE proyecto_id = ? AND email = ?', p.id, String(req.quien || '').toLowerCase());
    const admin = !!req.admin || esAdminGlobal(req.quien);
    return { email: String(req.quien || '').toLowerCase(), rol: admin ? 'administrador' : (m ? m.rol : (req.rol || '')), organizacion: (m && m.organizacion) || (admin ? 'ANIN' : ''), cargo: (m && m.cargo) || '', funcion: (m && m.funcion) || '', admin };
  }
  const miembrosDe = (pid) => q.todos('SELECT email, rol, organizacion, cargo FROM miembros WHERE proyecto_id = ?', pid);
  const permisoEn = (p, u, ruta) => CAR.permiso(p.config.carpetas, u, ruta);
  const conLlaveOSesion = (min) => (req, res, next) => req.get('x-cde-llave') ? requiereLlave(req, res, next) : requiereSesion(req, res, () => requiereRol(min)(req, res, next));
  const guardaConfig = (p) => q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(p.config), p.id);
  /** La carpeta de trabajo en progreso de una organizacion: la carpeta de zona wip en la que puede subir (preferible la que lleva su nombre). */
  /** Las opciones de la plantilla WIP / COM / PUB tal como llegan del portal (saneadas). */
  function opcionesWcp(b, orgs) {
    const o = { orgCliente: String(b.orgCliente || (orgs && orgs.cliente) || 'ANIN').toUpperCase(), orgContr: (orgs && orgs.contr) || 'CONTRATISTA', orgSuper: (orgs && orgs.super) || 'SUPERVISION', conContr: b.conContr !== false && b.conContr !== 'false' && b.conContr !== 0, conSuper: b.conSuper !== false && b.conSuper !== 'false' && b.conSuper !== 0 };
    if (Array.isArray(b.etapas) && b.etapas.length) o.etapas = b.etapas.slice(0, 12).map(e => ({ codigo: String(e.codigo || '').slice(0, 6), nombre: String(e.nombre || '').slice(0, 80) }));
    return o;
  }
  function carpetaWipDe(p, u) {
    let lista = CAR.arbol(p.config.carpetas, u, {}).filter(c => c.subir && c.zonaEfectiva === 'wip');
    const etapa = String(p.config.etapaActual || '').toUpperCase();   // p.ej. 'E3': la etapa en curso manda sobre las demas (carpeta 'E3' o 'E3_...' en cualquier nivel)
    const nEt = (/(\d+)/.exec(etapa) || [])[1], deEtapa = (c) => c.ruta.toUpperCase().split('/').some(s => s === etapa || s.startsWith(etapa + '_') || s.startsWith(etapa + ' ') || (nEt && (s === 'ETAPA ' + parseInt(nEt, 10) || s.startsWith('ETAPA ' + parseInt(nEt, 10) + ' '))));   // 'E1', 'E1_NOMBRE' o 'ETAPA 1' (plantilla por zonas)
    if (etapa && lista.some(deEtapa)) lista = lista.filter(deEtapa);
    const sinTilde = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim(), org = sinTilde(u.organizacion);
    const parte = Object.entries(p.config.partes || {}).find(([k, v]) => sinTilde(v) === org);   // plantilla por etapas: WIP CLIENTE / WIP CONTRATISTA / WIP SUPERVISION
    const propia = lista.find(c => sinTilde(c.nombre) === org) || (parte && lista.find(c => sinTilde(c.nombre) === 'WIP ' + sinTilde(parte[0]) || sinTilde(c.nombre) === sinTilde(parte[0])));
    return (propia || lista.find(c => !lista.some(h => h.ruta !== c.ruta && c.ruta.startsWith(h.ruta + '/'))) || lista[0] || {}).ruta || '';
  }
  /** Cuando una carpeta cambia de ruta (renombrar o desplazar), los contenedores, sus copias y los destinos de los flujos la siguen. */
  function trasladaRutas(p, de, a) {
      for (const col of ['carpeta', 'carpeta_publicada', 'carpeta_compartida', 'carpeta_origen']) q.corre('UPDATE contenedores SET ' + col + ' = ? || SUBSTR(' + col + ', ?) WHERE proyecto_id = ? AND (' + col + ' = ? OR ' + col + ' LIKE ?)', a, de.length + 1, p.id, de, de + '/%');
      for (const f of p.config.flujos || []) if (f.alAprobar && (f.alAprobar.copiarA === de || f.alAprobar.copiarA.startsWith(de + '/'))) f.alAprobar.copiarA = a + f.alAprobar.copiarA.slice(de.length);
      // los enlaces de Forma, Aconex y OneDrive/SharePoint que cargaban en esa carpeta (o debajo) siguen cargando en la carpeta renombrada
      for (const t of ['forma_enlaces', 'aconex_enlaces', 'ms_enlaces']) { try { q.corre('UPDATE ' + t + ' SET carpeta_cde = ? || SUBSTR(carpeta_cde, ?) WHERE proyecto_id = ? AND (carpeta_cde = ? OR carpeta_cde LIKE ?)', a, de.length + 1, p.id, de, de + '/%'); } catch (e) {} }
      guardaConfig(p);
  }
  const conteosDe = (pid) => { const m = {}; for (const r of q.todos("SELECT carpeta, COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? AND borrado = '' GROUP BY carpeta", pid)) m[r.carpeta] = r.n; for (const r of q.todos("SELECT carpeta_publicada AS c, COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND carpeta_publicada <> '' GROUP BY carpeta_publicada", pid)) m[r.c] = (m[r.c] || 0) + r.n; return m; };

  // ---------- proyectos ----------
  app.get('/api/proyectos', requiereSesion, (req, res) => {
    const todos = q.todos('SELECT * FROM proyectos WHERE activo = 1 ORDER BY nombre');
    const mios = todos.filter(p => rolEn(req.quien, p.id)).map(p => Object.assign(abreJson(p, ['config']), { rol: rolEn(req.quien, p.id),
      carpetas: Array.isArray(p.config.carpetas) ? p.config.carpetas.length : 0,
      contenedores: q.uno('SELECT COUNT(*) AS n FROM contenedores WHERE proyecto_id = ?', p.id).n,
      incidencias_abiertas: q.uno("SELECT COUNT(*) AS n FROM incidencias WHERE proyecto_id = ? AND estado NOT IN ('cerrada','rechazada')", p.id).n }));
    for (const p of mios) { migraConfig(p.config); p.ubicacion = EST.ubicacionDe(p); delete p.config.carpetas; delete p.config.flujos; delete p.config.tiposCorreo; }
    res.json({ proyectos: mios, admin: req.admin });
  });
  // Portada «Direcciones ejecutoras»: Direccion › Subdireccion › Proyecto, con los proyectos del CDE que ve el usuario
  app.get('/api/estructura', requiereSesion, (req, res) => {
    const mios = q.todos('SELECT * FROM proyectos WHERE activo = 1 ORDER BY nombre').filter(p => rolEn(req.quien, p.id)).map(p => abreJson(p, ['config']));
    const lim = (p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, rol: rolEn(req.quien, p.id), contenedores: q.uno('SELECT COUNT(*) AS n FROM contenedores WHERE proyecto_id = ?', p.id).n, incidencias_abiertas: q.uno("SELECT COUNT(*) AS n FROM incidencias WHERE proyecto_id = ? AND estado NOT IN ('cerrada','rechazada')", p.id).n });
    const a = EST.arbol(mios);
    res.json({ admin: req.admin, direcciones: a.direcciones.map(d => ({ id: d.id, nombre: d.nombre, subs: d.subs.map(s => ({ id: s.id, nombre: s.nombre, proyectos: s.proyectos.map(h => ({ nombre: h.nombre, cde: h.cde.map(lim) })) })) })), sinUbicar: a.sinUbicar.map(lim) });
  });
  /** Ubicar un proyecto del CDE en el mapa: { direccion, sub, proyecto } (proyecto = nombre de la hoja; vacio = el suyo). */
  app.put('/api/proyectos/:pid/ubicacion', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {}, d = EST.DIRECCIONES.find(x => x.id === String(b.direccion || '')), sb = d && d.subs.find(x => x.id === String(b.sub || ''));
    if (!d || !sb) return res.status(400).json({ error: 'datos', mensaje: 'Dirección o subdirección no válida.' });
    p.config.ubicacion = { direccion: d.id, sub: sb.id, proyecto: String(b.proyecto || '').slice(0, 120) }; guardaConfig(p);
    audita(req.quien, 'proyecto.ubicacion', req.pid, d.id + ' / ' + sb.id, p.config.ubicacion);
    res.json({ ok: true, ubicacion: EST.ubicacionDe(p) });
  });
  app.post('/api/proyectos', requiereSesion, J, (req, res) => {
    if (!req.admin) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo un administrador global crea proyectos.' });
    const b = req.body || {}, nombre = String(b.nombre || '').trim(), codigo = String(b.codigo || '').trim().toUpperCase();
    if (!nombre || !/^[A-Z0-9_-]{2,30}$/.test(codigo)) return res.status(400).json({ error: 'datos', mensaje: 'Nombre y codigo (letras, numeros, - y _) son obligatorios.' });
    if (q.uno('SELECT 1 FROM proyectos WHERE codigo = ?', codigo)) return res.status(409).json({ error: 'repetido', mensaje: 'Ya hay un proyecto con ese codigo.' });
    const pid = id('p'), cfg = b.config || configPorDefecto(codigo), orgs = { contr: String((b.estructura || {}).orgContr || b.orgContr || 'CONTRATISTA').toUpperCase(), super: String((b.estructura || {}).orgSuper || b.orgSuper || 'SUPERVISION').toUpperCase(), entidad: 'ANIN' };
    if (b.plantilla === 'acc' || b.plantilla === 'hospitales') { cfg.carpetas = CAR.plantillaAcc({ orgContr: orgs.contr, orgSuper: orgs.super }); cfg.etapaActual = String(b.etapaActual || 'E3').toUpperCase().slice(0, 4); }
    if (b.plantilla === 'wcp') { const ow = opcionesWcp(b, orgs); cfg.carpetas = CAR.plantillaWcp(ow); cfg.partes = CAR.partesWcp(ow); cfg.etapaActual = String(b.etapaActual || 'E1').toUpperCase().slice(0, 4); }
    if (b.plantilla === 'zonas') { const ow = opcionesWcp(b, orgs); cfg.carpetas = CAR.plantillaZonas(ow); cfg.partes = CAR.partesWcp(ow); cfg.etapaActual = String(b.etapaActual || 'E1').toUpperCase().slice(0, 4); }
    if (!Array.isArray(cfg.flujos) || !cfg.flujos.length) cfg.flujos = FL.porDefecto(orgs);
    // Norma de nomenclatura con la que nace: los proyectos con plantilla de carpetas de la ANIN (los que se crean desde la web) usan la
    // Libreria Maestra DOCPG002 en COMPARTIDO y PUBLICADO (WIP libre); sin plantilla, la regla ISO 19650 de configPorDefecto. b.norma la elige.
    NOM.migra(cfg); const normaInicial = String(b.norma || (b.plantilla ? D2.ID : ''));
    if (normaInicial && (cfg.normas || []).some(n => n.id === normaInicial)) { cfg.normaPorDefecto = normaInicial; NOM.sincronizaLegado(cfg); }
    if (b.ubicacion && EST.DIRECCIONES.some(d => d.id === b.ubicacion.direccion && d.subs.some(x => x.id === b.ubicacion.sub))) cfg.ubicacion = { direccion: String(b.ubicacion.direccion), sub: String(b.ubicacion.sub), proyecto: String(b.ubicacion.proyecto || '').slice(0, 120) };
    q.corre('INSERT INTO proyectos (id, codigo, nombre, descripcion, hub_forma, proyecto_forma, config, creado, creado_por) VALUES (?,?,?,?,?,?,?,?,?)',
      pid, codigo, nombre, String(b.descripcion || ''), String(b.hub_forma || ''), String(b.proyecto_forma || ''), JSON.stringify(cfg), ahora(), quien(req));
    q.corre('INSERT INTO miembros (proyecto_id, email, rol, organizacion, agregado, por) VALUES (?,?,?,?,?,?)', pid, req.quien, 'administrador', 'ANIN', ahora(), quien(req));
    audita(quien(req), 'proyecto.crear', pid, codigo, { nombre, plantilla: b.plantilla || '' });
    res.json({ ok: true, id: pid });
  });
  app.get('/api/proyectos/:pid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid); if (!p) return res.status(404).json({ error: 'no-existe' });
    const u = yo(req, p);
    p.rol = u.rol; p.organizacion = u.organizacion; p.admin = u.admin;
    p.miembros = (u.rol === 'gestor' || u.rol === 'administrador') ? q.todos('SELECT email, rol, organizacion, cargo, grupo, nombre, empresa, puesto, disciplina, funcion, agregado FROM miembros WHERE proyecto_id = ? ORDER BY organizacion, rol, email', req.pid) : undefined;
    p.organizaciones = organizacionesDe(req.pid);
    const conteos = conteosDe(req.pid);
    p.arbol = CAR.arbol(p.config.carpetas, u, conteos, { todo: u.rol === 'gestor' || u.rol === 'administrador' });
    for (const c of p.arbol) { const n = NOM.normaDe(p.config, c.ruta); c.normaEfectiva = n.norma ? n.norma.id : ''; c.normaOrigen = n.origen; }
    p.retenidos = q.uno("SELECT COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND retencion <> ''", req.pid).n;
    p.carpetasEscribibles = p.arbol.filter(c => c.subir && !c.fuera).map(c => c.ruta);
    p.carpetaWip = carpetaWipDe(p, u);
    p.ubicacion = EST.ubicacionDe(p);
    p.conCarpetas = Array.isArray(p.config.carpetas) && p.config.carpetas.length > 0;
    p.flujos = flujosDe(p).map(f => Object.assign({}, f, { puedoIniciar: u.admin || u.rol === 'administrador' || FL.encaja(f.iniciadores, u) }));
    p.niveles = CAR.NIVELES;
    p.resumen = {
      porEstado: Object.fromEntries(q.todos("SELECT estado, COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? AND borrado = '' GROUP BY estado", req.pid).map(r => [r.estado, r.n])),
      porTipo: Object.fromEntries(q.todos('SELECT tipo, COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? GROUP BY tipo', req.pid).map(r => [r.tipo, r.n])),
      incidencias: Object.fromEntries(q.todos("SELECT estado, COUNT(*) AS n FROM incidencias WHERE proyecto_id = ? AND borrado = '' GROUP BY estado", req.pid).map(r => [ESTADO_LEGADO[r.estado] || r.estado, r.n])),
      revisionesAbiertas: q.uno("SELECT COUNT(*) AS n FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ? AND r.estado = 'abierta'", req.pid).n,
      correosPendientes: q.uno("SELECT COUNT(*) AS n FROM correos WHERE proyecto_id = ? AND estado = 'enviado' AND respuesta <> 'ninguna' AND vence <> '' AND respondido = '' AND cerrado = ''", req.pid).n,
      alertasAbiertas: q.uno("SELECT COUNT(*) AS n FROM alertas_tempranas WHERE proyecto_id = ? AND estado <> 'cerrada'", req.pid).n,
      eventosAbiertos: q.uno("SELECT COUNT(*) AS n FROM eventos_compensables WHERE proyecto_id = ? AND estado NOT IN ('implementado','no-es-evento','retirado')", req.pid).n
    };
    res.json(p);
  });
  function organizacionesDe(pid) { const s = new Set(q.todos("SELECT DISTINCT organizacion FROM miembros WHERE proyecto_id = ? AND organizacion <> ''", pid).map(r => r.organizacion)); s.add('ANIN'); return [...s].sort(); }
  app.put('/api/proyectos/:pid/config', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const cfg = req.body && req.body.config; if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'datos' });
    migraConfig(cfg);
    if (cfg.carpetas !== undefined) cfg.carpetas = CAR.normaliza(cfg.carpetas);
    if (Array.isArray(cfg.flujos)) { const out = []; for (const f of cfg.flujos) { const n = FL.normaliza(f, out); if (n.error) return res.status(400).json({ error: 'flujo', mensaje: n.error }); out.push(n.flujo); } cfg.flujos = out; }
    q.corre('UPDATE proyectos SET config = ? WHERE id = ?', JSON.stringify(cfg), req.pid);
    audita(quien(req), 'proyecto.config', req.pid, '', { claves: Object.keys(cfg) }); res.json({ ok: true });
  });
  // Catalogo de usuarios del proyecto (empresas, cargos y disciplinas con codigo): la base + lo que el proyecto agregue
  app.get('/api/proyectos/:pid/catalogo-usuarios', requiereSesion, requiereRol('lector'), (req, res) => res.json(CATU.deProyecto(proyecto(req.pid).config)));
  app.post('/api/proyectos/:pid/catalogo-usuarios', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {}, r = CATU.agrega(p.config, String(b.lista || ''), b.nombre, b.codigo);
    if (r.error) return res.status(400).json({ error: 'catalogo', mensaje: r.error });
    guardaConfig(p); audita(req.quien, 'catalogo-usuarios.agregar', req.pid, b.lista, r.item);
    res.json({ ok: true, item: r.item, catalogo: CATU.deProyecto(p.config) });
  });
  app.post('/api/proyectos/:pid/miembros', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(), rolPedido = String((req.body || {}).rol || 'lector'), rol = rolPedido === 'autor' ? 'miembro' : rolPedido;   /* «autor» ya no existe: es «miembro» */
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !(rol in ISO.RANGO_ROL)) return res.status(400).json({ error: 'datos', mensaje: 'Correo o rol no valido.' });
    if (ISO.RANGO_ROL[rol] > ISO.RANGO_ROL[req.rol]) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No puedes dar un rol mayor que el tuyo.' });
    // cargo: la funcion de la persona en el proyecto (DC, ESPECIALISTA, KP1, GP...); con el se arman los revisores de los flujos. Si no se envia, se conserva el que tenia.
    const previo = q.uno('SELECT cargo FROM miembros WHERE proyecto_id = ? AND email = ?', req.pid, email), cargo = (req.body || {}).cargo !== undefined ? String((req.body || {}).cargo || '').trim().toUpperCase().slice(0, 30) : ((previo && previo.cargo) || '');
    // grupo: Cliente (equipo de proyecto | transversal | otras direcciones) · Contratista · Subcontratista. Si no se envia, se conserva.
    const ant = q.uno('SELECT * FROM miembros WHERE proyecto_id = ? AND email = ?', req.pid, email) || {}, B = req.body || {}, pM = proyecto(req.pid);
    // Formato estandar del registro de usuarios: Nombres y apellidos · Empresa · Cargo · Disciplina → Funcion (EMPRESA-CARGO-DISCIPLINA)
    const dato = (k) => B[k] !== undefined ? String(B[k] || '').trim().slice(0, 120) : (ant[k] || '');
    const fx = CATU.resuelve(pM.config, { empresa: dato('empresa'), puesto: dato('puesto'), disciplina: dato('disciplina') });
    if ((B.empresa || B.puesto || B.disciplina) && !fx.funcion) return res.status(400).json({ error: 'catalogo', mensaje: 'Empresa, cargo y disciplina deben estar en el catálogo de usuarios del proyecto (' + [!fx.empresa && 'empresa «' + dato('empresa') + '»', !fx.puesto && 'cargo «' + dato('puesto') + '»', !fx.disciplina && 'disciplina «' + dato('disciplina') + '»'].filter(Boolean).join(', ') + ' no está).' });
    const partes = pM.config.partes || {}, llanoE = String(fx.empresa).normalize('NFD').replace(/[̀-ͯ]/g, '');
    // lo que no se envia se deduce de la funcion: organizacion (parte del proyecto), rol en revisiones y grupo
    const orgAuto = !fx.empresa ? '' : llanoE === 'ANIN' ? 'ANIN' : /^CONTRATISTA/.test(llanoE) ? (partes.CONTRATISTA || 'CONTRATISTA') : llanoE === 'SUPERVISION' ? (partes.SUPERVISION || 'SUPERVISION') : llanoE;
    const organizacion = B.organizacion !== undefined && String(B.organizacion).trim() ? String(B.organizacion).trim().toUpperCase() : (orgAuto || ant.organizacion || '');
    const cargoAuto = /-ESP-DOC$/.test(fx.funcion) ? 'DC' : /-GTE-PRY$/.test(fx.funcion) ? 'GP' : /-ESP-/.test(fx.funcion) ? 'ESPECIALISTA' : '';
    const cargoF = B.cargo !== undefined ? cargo : (ant.cargo || cargoAuto);
    const gAuto = llanoE === 'ANIN' ? 'cliente-equipo' : /^CONTRATISTA/.test(llanoE) ? 'contratista' : llanoE === 'SUBCONTRATISTA' ? 'subcontratista' : llanoE === 'SUPERVISION' ? 'supervision' : llanoE === 'EXTERNO' ? 'externo' : '';
    const gNuevo = B.grupo !== undefined && String(B.grupo || '') ? String(B.grupo) : (B.empresa !== undefined && gAuto ? gAuto : (ant.grupo || gAuto)), grupo = GRUPOS.includes(gNuevo) ? gNuevo : '';
    q.corre('INSERT OR REPLACE INTO miembros (proyecto_id, email, rol, organizacion, agregado, por, cargo, grupo, nombre, empresa, puesto, disciplina, funcion) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', req.pid, email, rol, organizacion, ant.agregado || ahora(), quien(req), cargoF, grupo, dato('nombre'), fx.empresa, fx.puesto, fx.disciplina, fx.funcion);
    audita(quien(req), 'miembro.agregar', req.pid, email, { rol });
    // con cuentas propias, quien entra por primera vez a un proyecto recibe su cuenta: la clave temporal vuelve una sola vez
    const temporal = require('./acceso').aseguraCuenta(email, dato('nombre'), quien(req)); res.json(temporal ? { ok: true, cuentaNueva: { email, temporal } } : { ok: true });
  });
  app.delete('/api/proyectos/:pid/miembros/:email', requiereSesion, requiereRol('gestor'), (req, res) => {
    q.corre('DELETE FROM miembros WHERE proyecto_id = ? AND email = ?', req.pid, String(req.params.email || '').toLowerCase());
    audita(quien(req), 'miembro.quitar', req.pid, req.params.email, ''); res.json({ ok: true });
  });

  // ---------- carpetas (arbol editable con permisos; gestor/administrador o quien tenga "control" sobre la carpeta) ----------
  const puedeControlar = (p, u, ruta) => permisoEn(p, u, ruta).control;
  app.post('/api/proyectos/:pid/carpetas/plantilla', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {};
    if (!['acc', 'hospitales', 'wcp', 'zonas'].includes(b.plantilla)) return res.status(400).json({ error: 'plantilla', mensaje: 'Plantilla no conocida (zonas | wcp | acc).' });
    const op = {}; for (const k of ['orgContr', 'orgSuper', 'orgEntidad', 'orgCliente']) if (b[k]) op[k] = String(b[k]).trim().toUpperCase();
    if (Array.isArray(b.etapas) && b.etapas.length) op.etapas = b.etapas;
    const ow = opcionesWcp(b, { contr: op.orgContr, super: op.orgSuper, cliente: op.orgCliente });
    const nuevas = b.plantilla === 'zonas' ? CAR.plantillaZonas(ow) : b.plantilla === 'wcp' ? CAR.plantillaWcp(ow) : CAR.plantillaAcc(op);
    if (b.plantilla === 'wcp' || b.plantilla === 'zonas') p.config.partes = CAR.partesWcp(ow); else delete p.config.partes;
    // conservar carpetas propias y permisos editados si se pide "fusionar"
    // Sin "fusionar" la plantilla reemplaza el arbol, pero NUNCA deja archivos huerfanos: las carpetas anteriores que tienen archivos (y sus carpetas madre) se conservan.
    const conArchivos = q.todos("SELECT DISTINCT carpeta FROM contenedores WHERE proyecto_id = ? AND carpeta <> ''", req.pid).map(x => x.carpeta);
    const seQuedan = (c) => conArchivos.some(r => r === c.ruta || r.startsWith(c.ruta + '/'));
    const previas = Array.isArray(p.config.carpetas) ? p.config.carpetas.filter(c => !nuevas.some(n => n.ruta === c.ruta) && (b.fusionar || seQuedan(c))) : [];
    p.config.carpetas = previas.length ? CAR.normaliza(nuevas.concat(previas)) : nuevas;
    if (!Array.isArray(p.config.flujos) || !p.config.flujos.length || b.flujosPorDefecto) p.config.flujos = FL.porDefecto({ contr: op.orgContr, super: op.orgSuper });
    // el flujo en paralelo (DC → especialistas → GP) se anade si el proyecto aun no lo tiene
    if (!p.config.flujos.some(f => f.id === 'paralelo-dc-especialistas-gp')) { const n = FL.normaliza(FL.paraleloDc({ contr: op.orgContr || ow.orgContr, super: op.orgSuper || ow.orgSuper, entidad: ow.orgCliente }), p.config.flujos); if (n.flujo) p.config.flujos.push(n.flujo); }
    p.config.etapaActual = String(b.etapaActual || p.config.etapaActual || (b.plantilla === 'acc' || b.plantilla === 'hospitales' ? 'E3' : 'E1')).toUpperCase().slice(0, 4);
    guardaConfig(p);
    audita(quien(req), 'carpetas.plantilla', req.pid, b.plantilla, op);
    res.json({ ok: true, carpetas: p.config.carpetas.length, flujos: p.config.flujos.length, conservadas: b.fusionar ? [] : previas.map(c => c.ruta) });
  });
  app.get('/api/proyectos/:pid/carpetas', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    res.json({ carpetas: CAR.arbol(p.config.carpetas, u, conteosDe(req.pid), { todo: u.rol === 'gestor' || u.rol === 'administrador' }), niveles: CAR.NIVELES, zonas: CAR.ZONAS, organizaciones: organizacionesDe(req.pid) });
  });
  app.get('/api/proyectos/:pid/carpetas/permisos', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), ruta = CAR.limpia(req.query.ruta);
    if (!puedeControlar(p, u, ruta) && !permisoEn(p, u, ruta).leer) return res.status(403).json({ error: 'sin-permiso' });
    const d = CAR.def(p.config.carpetas, ruta), v = CAR.entradasVigentes(p.config.carpetas, ruta);
    res.json({ ruta, propios: !!(d && d.permisos && d.permisos.length), entradas: v.entradas, heredadasDe: v.heredadasDe, nota: d ? d.nota : '', zona: d ? d.zona : '', zonaEfectiva: CAR.zonaDe(p.config.carpetas, ruta), miPermiso: permisoEn(p, u, ruta) });
  });
  app.post('/api/proyectos/:pid/carpetas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, padre = CAR.limpia(b.padre);
    // Quien crea carpetas, segun su nivel de acceso y la zona: miembro solo en WIP; Document Control en WIP y compartido; Revisor DC solo en compartido; revisor, en ninguna.
    const zonaP = CAR.zonaDe(p.config.carpetas || [], padre);
    if (!ISO.puedeCrearCarpeta(u.rol, zonaP)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Tu nivel de acceso (' + u.rol + ') no crea carpetas ' + (zonaP ? 'en la zona ' + zonaP : 'fuera de las zonas WIP / compartido') + '.' });
    const pmP = padre ? permisoEn(p, u, padre) : {};
    if (!puedeControlar(p, u, padre) && !(padre && (pmP.editar || (u.rol === 'revisor-dc' && zonaP === 'compartido' && pmP.leer)))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Para crear subcarpetas hace falta "editar" o "control" sobre la carpeta padre.' });
    const r = CAR.crea(p.config.carpetas || [], padre, b.nombre, { nota: b.nota, zona: b.zona, permisos: b.permisos }); if (r.error) return res.status(400).json({ error: 'carpeta', mensaje: r.error });
    p.config.carpetas = r.carpetas; guardaConfig(p); audita(quien(req), 'carpeta.crear', req.pid, r.ruta, {}); res.json({ ok: true, ruta: r.ruta });
  });
  app.put('/api/proyectos/:pid/carpetas', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, ruta = CAR.limpia(b.ruta);
    if (!CAR.def(p.config.carpetas, ruta)) return res.status(404).json({ error: 'no-existe', mensaje: 'La carpeta no existe.' });
    if (b.permisos !== undefined || b.zona !== undefined || b.disparador !== undefined || b.norma !== undefined) { if (!puedeControlar(p, u, ruta)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Los permisos, la zona y el desencadenador los cambia quien tiene "control" sobre la carpeta.' }); }
    if (b.disparador && b.disparador.flujo && !flujoDe(p, String(b.disparador.flujo))) return res.status(400).json({ error: 'flujo', mensaje: 'El flujo del desencadenador no existe.' });
    if (b.norma && b.norma !== 'libre' && !(p.config.normas || []).some(n => n.id === b.norma)) return res.status(400).json({ error: 'norma', mensaje: 'Esa norma de nomenclatura no existe.' });
    else if (!permisoEn(p, u, ruta).editar) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta "editar" sobre la carpeta.' });
    let carpetas = p.config.carpetas, de = ruta, a = ruta;
    if (b.nombre !== undefined && String(b.nombre).trim() !== CAR.nombreDe(ruta)) { const r = CAR.renombra(carpetas, ruta, b.nombre); if (r.error) return res.status(400).json({ error: 'carpeta', mensaje: r.error }); carpetas = r.carpetas; de = r.de; a = r.a; }
    const r2 = CAR.edita(carpetas, a, { nota: b.nota, zona: b.zona, permisos: b.permisos, disparador: b.disparador, norma: b.norma }); if (r2.error) return res.status(400).json({ error: 'carpeta', mensaje: r2.error });
    p.config.carpetas = r2.carpetas; guardaConfig(p);
    if (de !== a) trasladaRutas(p, de, a);
    audita(quien(req), 'carpeta.editar', req.pid, a, { de, cambios: Object.keys(b) }); res.json({ ok: true, ruta: a });
  });
  /** Desplazar una carpeta (con todo lo que tiene) dentro de otra: el "Desplazar" de Autodesk Docs. */
  app.post('/api/proyectos/:pid/carpetas/mover', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, ruta = CAR.limpia(b.ruta), destino = CAR.limpia(b.destino || '');
    if (!CAR.def(p.config.carpetas, ruta)) return res.status(404).json({ error: 'no-existe', mensaje: 'La carpeta no existe.' });
    if (!(permisoEn(p, u, ruta).editar || puedeControlar(p, u, ruta))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta "editar" sobre la carpeta que se desplaza.' });
    if (destino ? !(permisoEn(p, u, destino).editar || puedeControlar(p, u, destino)) : !(u.admin || ['gestor', 'administrador'].includes(u.rol))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta "editar" sobre la carpeta de destino.' });
    // Validación QA: si la carpeta pasa de WIP al compartido, todos sus documentos PDF y Word deben pasarla
    const aprobados = [], cpsQ = p.config.carpetas || [];
    if (destino && CAR.zonaDe(cpsQ, destino) === 'compartido' && CAR.zonaDe(cpsQ, ruta) !== 'compartido') {
      const malos = [];
      for (const c of q.todos("SELECT * FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND retencion = '' AND (carpeta = ? OR carpeta LIKE ?)", req.pid, ruta, ruta + '/%')) {
        const v = q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); if (!v) continue;
        if (!QA.aplica(v.archivo, tipoDocDe(json(c.campos, {}))).aplica) continue;
        const qa = almacen.existe(v.ruta_almacen) ? await qaDe(p, almacen.rutaAbsoluta(v.ruta_almacen), v.archivo, { codigo: ISO.partes(v.archivo).base, esperada: QA.revisionEsperada(revisionesDe(c.id).slice(0, -1), true) }) : { ok: false, checks: [{ id: 'lectura', titulo: 'Lectura de la portada', ok: false, detalle: 'El archivo no está en el almacén del CDE.' }], datos: {} };
        if (qa.ok) aprobados.push({ c, v, qa }); else malos.push({ id: c.id, nombre: v.archivo, qa });
      }
      if (malos.length) { audita(quien(req), 'qa.rechazada', req.pid, ruta, { a: destino, documentos: malos.map(m => m.nombre) }); return res.status(422).json({ error: 'qa', mensaje: malos.length + ' documento(s) de la carpeta no pasan la Validación QA de su portada: ' + malos.map(m => m.nombre).join(', ') + '. Corrígelos (o sácalos de la carpeta) antes de desplazarla al compartido.', resultados: malos }); }
    }
    const r = CAR.mueve(p.config.carpetas, ruta, destino); if (r.error) return res.status(400).json({ error: 'carpeta', mensaje: r.error });
    p.config.carpetas = r.carpetas; guardaConfig(p); trasladaRutas(p, r.de, r.a);
    for (const a of aprobados) aplicaQA(a.c, a.v, a.qa, quien(req), req.pid);
    audita(quien(req), 'carpeta.desplazar', req.pid, r.a, { de: r.de }); res.json({ ok: true, ruta: r.a });
  });
  /** "Descargar archivos de origen": la ultima version de cada contenedor de la carpeta (y sus subcarpetas) en un ZIP que se
   *  escribe al vuelo (sin cargar los archivos en memoria), con las subcarpetas como rutas dentro del ZIP. */
  app.get('/api/proyectos/:pid/carpetas/descargar', requiereSesion, requiereRol('lector'), async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), ruta = CAR.limpia(req.query.ruta || '');
    if (ruta && !CAR.def(p.config.carpetas, ruta)) return res.status(404).json({ error: 'no-existe' });
    const filas = q.todos("SELECT c.id, c.nombre, c.carpeta, v.archivo, v.tamano, v.ruta_almacen, v.n FROM contenedores c JOIN versiones v ON v.contenedor_id = c.id AND v.n = c.version_actual WHERE c.proyecto_id = ? AND c.borrado = '' AND (? = '' OR c.carpeta = ? OR c.carpeta LIKE ?) ORDER BY c.carpeta, c.nombre", req.pid, ruta, ruta, ruta + '/%');
    const entradas = [];
    for (const f of filas) { if (!permisoEn(p, u, f.carpeta).descargar || !almacen.existe(f.ruta_almacen)) continue; const rel = (ruta ? f.carpeta.slice(ruta.length).replace(/^\//, '') : f.carpeta); entradas.push({ nombre: (rel ? rel + '/' : '') + f.archivo, ruta: almacen.rutaAbsoluta(f.ruta_almacen), tamano: f.tamano }); }
    if (!entradas.length) return res.status(404).json({ error: 'vacia', mensaje: 'No hay archivos que puedas descargar en esta carpeta.' });
    const total = entradas.reduce((t, e) => t + (e.tamano || 0), 0);
    if (total > 3.5 * 1024 * 1024 * 1024) return res.status(413).json({ error: 'grande', mensaje: 'La carpeta pesa mas de 3,5 GB: descarga sus subcarpetas por separado.' });
    audita(req.quien, 'carpeta.descargar', req.pid, ruta || '(raiz)', { archivos: entradas.length, tamano: total });
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent((ruta ? CAR.nombreDe(ruta) : p.codigo) + '.zip'));
    try { await require('./zipflujo').escribe(res, entradas); } catch (e) { res.destroy(e); }
  });
  app.delete('/api/proyectos/:pid/carpetas', requiereSesion, requiereRol('autor'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), ruta = CAR.limpia(req.query.ruta);
    if (!CAR.def(p.config.carpetas, ruta)) return res.status(404).json({ error: 'no-existe' });
    if (!puedeControlar(p, u, ruta) && !permisoEn(p, u, ruta).editar) return res.status(403).json({ error: 'sin-permiso' });
    const n = q.uno("SELECT COUNT(*) AS n FROM contenedores WHERE proyecto_id = ? AND (carpeta = ? OR carpeta LIKE ? OR carpeta_publicada = ? OR carpeta_publicada LIKE ?)", req.pid, ruta, ruta + '/%', ruta, ruta + '/%').n;
    if (n) return res.status(409).json({ error: 'con-contenido', mensaje: 'La carpeta (o alguna subcarpeta) tiene ' + n + ' contenedor(es): muevelos antes.' });
    const r = CAR.borra(p.config.carpetas, ruta); p.config.carpetas = r.carpetas; guardaConfig(p);
    audita(quien(req), 'carpeta.borrar', req.pid, ruta, {}); res.json({ ok: true });
  });

  // ---------- validacion de nombre ----------
  app.post('/api/proyectos/:pid/valida-nombre', conLlaveOSesion('lector'), J, (req, res) => {
    const p = proyecto(req.params.pid); if (!p) return res.status(404).json({ error: 'no-existe' });
    const b = req.body || {};
    // sin carpeta (complemento de Revit): la misma regla que aplicara la carga -> la carpeta del contenedor si ya existe y, si es
    // nuevo, la carpeta de trabajo (WIP) de la organizacion. Asi el complemento no exige la norma ISO donde la carpeta es libre.
    let carpetaVal = b.carpeta;
    if (carpetaVal === undefined && Array.isArray(p.config.carpetas) && p.config.carpetas.length) {
      const base0 = ISO.partes(path.basename(String(b.nombre || '').replace(/\\/g, '/'))).base;
      const c0 = base0 ? contenedorPorNombre(req.params.pid, base0, extDe(b.nombre)) : null;
      if (c0) carpetaVal = c0.retencion || c0.carpeta || '';
      else {
        const u0 = req.llave ? { email: req.quien, rol: 'document-control', organizacion: String(req.llave.organizacion || 'CONTRATISTA').toUpperCase(), admin: false } : yo(req, p);
        if (req.llave) { const m = q.uno('SELECT rol, organizacion FROM miembros WHERE proyecto_id = ? AND email = ?', req.params.pid, String(req.quien || '').toLowerCase()); if (m) { u0.rol = m.rol; u0.organizacion = m.organizacion || u0.organizacion; } }
        carpetaVal = carpetaWipDe(p, u0);
      }
    }
    const r = carpetaVal !== undefined ? NOM.valida(p.config, CAR.limpia(carpetaVal), String(b.nombre || '')) : ISO.valida(String(b.nombre || ''), p.config);
    const ex0 = r.base ? contenedorPorNombre(req.params.pid, r.base, extDe(b.nombre)) : null, existente = ex0 ? { id: ex0.id, estado: ex0.estado, version_actual: ex0.version_actual, carpeta: ex0.carpeta, retencion: ex0.retencion } : null;
    const ret = !!(p.config.conformidad && p.config.conformidad.areaRetencion);
    res.json(Object.assign(r, { contenedor: existente || null, tipo: ISO.tipoPorExtension(r.extension), areaRetencion: ret, retenido: !r.ok && !r.libre && ret }));
  });

  /** Mascara ("XXX## o XXXX#", "#####") -> regex. X = letra, # = digito. '' si la pista no trae mascara. */
  function rxDeMascara(pista) {
    const t = String(pista || '').match(/[X#]{2,}|(?<![A-Za-z])[X#](?![A-Za-z])/g) || [];
    return t.length ? '^(' + [...new Set(t)].map(m => m.replace(/X+/g, x => '[A-Z]{' + x.length + '}').replace(/#+/g, x => '[0-9]{' + x.length + '}')).join('|') + ')$' : '';
  }
  /**
   * REJILLA DE CONFORMIDAD (la ventana "Cargar archivos" de Forma cuando la carpeta tiene norma): para una carpeta y unos nombres
   * devuelve la norma con sus campos (valores, etiquetas, mascara), los atributos relacionados (codigo de estado, revision, parte
   * designada, contrato), los atributos personalizados del proyecto y, por archivo, sus partes ya repartidas campo a campo con el
   * error de cada una. Sirve igual para cargar que para desplazar de WIP a compartido/publicado.
   */
  app.post('/api/proyectos/:pid/valida-nombres', requiereSesion, requiereRol('lector'), J, (req, res) => {
    const p = proyecto(req.pid), b = req.body || {}, carpeta = CAR.limpia(b.carpeta);
    const { norma, origen } = NOM.normaDe(p.config, carpeta);
    const nombres = (Array.isArray(b.nombres) ? b.nombres : []).slice(0, 1000).map(x => String(x || ''));
    const ret = !!(p.config.conformidad && p.config.conformidad.areaRetencion);
    const contDe = (base, nombre) => {
      const c = base ? contenedorPorNombre(req.pid, base, extDe(nombre)) : null; if (!c) return null;
      const v = q.uno('SELECT n, revision, idoneidad FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id) || {};
      return { id: c.id, estado: c.estado, carpeta: c.retencion || c.carpeta, version: v.n || 0, revision: v.revision || '', siguiente: ISO.siguienteRevision(v.revision, c.estado), idoneidad: v.idoneidad || '', atributos: json(c.atributos, {}) };
    };
    if (!norma) return res.json({ carpeta, libre: true, origen, areaRetencion: ret, norma: null, filas: nombres.map(n => { const v = NOM.valida(p.config, carpeta, n); return { nombre: n, ok: v.ok, errores: v.errores, partes: [], erroresCampo: [], revision: v.revision, extension: v.extension, contenedor: contDe(v.base, n) }; }) });
    const D = require('./docpg002'), tablaDe = { 'Activo': 'activos', 'Nivel': 'niveles', 'Tipo de documento': 'tiposDocumento', 'Disciplina': 'disciplinas', 'Etapa': 'etapas' };
    const campos = norma.campos.map(c => {
      const n = c.longitud || (c.valores && c.valores.length ? Math.max(...c.valores.map(v => v.length)) : (/\{(\d+)\}/.exec(c.regex || '') || [])[1] || 4), ch = c.caracteres === 'numeros' ? '#' : 'X';
      const o = { nombre: c.nombre, descripcion: c.descripcion || '', tipo: c.valores && c.valores.length ? 'lista' : 'texto', valores: c.valores || [], longitud: c.longitud || 0, caracteres: c.caracteres || 'alfanumerico', obligatorio: c.obligatorio !== false, mascara: ch.repeat(Math.min(12, Math.max(1, +n))) };
      if (norma.id === D.ID && tablaDe[c.nombre] && D.TABLAS[tablaDe[c.nombre]]) o.etiquetas = Object.fromEntries(D.TABLAS[tablaDe[c.nombre]]);
      return o;
    });
    const a = norma.atributos || {}, iCampo = norma.campos.findIndex(c => c.nombre.toLowerCase() === String(a.parteDesignada || '').toLowerCase());
    const iOrig = iCampo >= 0 ? iCampo : norma.campos.findIndex(c => /^originador$/i.test(c.nombre));
    const atributos = {
      codigosEstado: a.codigosEstado || [],
      revision: { pista: a.revision || 'P##', requerido: true },
      // «Parte designada» y «Contrato» ya no se piden al cargar (retirados de la rejilla): se devuelven vacios para que la interfaz no los muestre ni los exija
      parteDesignada: { pista: '', rx: '', campo: -1, requerido: false },
      contrato: { pista: '', rx: '', requerido: false }
    };
    const filas = nombres.map(nombre => {
      const v = NOM.valida(p.config, carpeta, nombre), pr = ISO.partes(nombre), n = campos.length;
      let partes = pr.campos.slice(); if (partes.length > n) partes = partes.slice(0, n - 1).concat(partes.slice(n - 1).join('-')); while (partes.length < n) partes.push('');
      const erroresCampo = norma.campos.map((def, i) => partes[i] === '' && def.obligatorio !== false ? 'Campo "' + def.nombre + '": es obligatorio.' : ISO.errorCampo(def, partes[i]));
      return { nombre, ok: v.ok, errores: v.errores, partes, erroresCampo, revision: pr.revision, extension: pr.ext, contenedor: contDe(v.base, nombre) };
    });
    res.json({ carpeta, libre: false, origen, areaRetencion: ret, norma: { id: norma.id, nombre: norma.nombre, conRevision: norma.conRevision !== false, campos }, atributos,
      personalizados: (Array.isArray(p.config.atributos) ? p.config.atributos : []).map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, valores: d.valores || [], obligatorio: !!d.obligatorio })), filas });
  });

  // ---------- contenedores y versiones ----------
  app.get('/api/proyectos/:pid/contenedores', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), f = req.query || {};
    const w = ['proyecto_id = ?', "borrado = ''", f.retenidos === '1' ? "retencion <> ''" : (f.retenidos === 'todos' ? '1 = 1' : "retencion = ''")], a = [req.pid];
    if (f.estado) { w.push('estado = ?'); a.push(String(f.estado)); }
    if (f.tipo) { w.push('tipo = ?'); a.push(String(f.tipo)); }
    if (f.q) { w.push('nombre LIKE ?'); a.push('%' + String(f.q) + '%'); }
    const carpeta = CAR.limpia(f.carpeta), sub = f.sub === '1';
    const enCarpeta = (c) => !carpeta ? true : sub ? (c === carpeta || c.startsWith(carpeta + '/')) : c === carpeta;
    const lista = q.todos('SELECT * FROM contenedores WHERE ' + w.join(' AND ') + ' ORDER BY actualizado DESC LIMIT 5000', ...a).map(c => abreJson(c, ['campos', 'atributos']));
    const out = [];
    for (const c of lista) {
      const puedo = c.retencion ? (permisoEn(p, u, c.retencion).subir || permisoEn(p, u, c.retencion).leer) : permisoEn(p, u, c.carpeta).leer;
      if (puedo && enCarpeta(c.carpeta)) out.push(c);
      if (c.carpeta_publicada && enCarpeta(c.carpeta_publicada) && (carpeta || !puedo) && permisoEn(p, u, c.carpeta_publicada).leer) out.push(Object.assign({}, c, { copia: true, carpeta_vista: c.carpeta_publicada }));
    }
    const orgDe = {}; for (const m of miembrosDe(req.pid)) orgDe[m.email] = m.organizacion;
    for (const c of out) {
      c.ultima = q.uno('SELECT id, n, archivo, revision, idoneidad, subido_por, fecha, origen, tamano, resumen FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
      if (c.ultima) { c.ultima.resumen = json(c.ultima.resumen, {}); c.ultima.org = orgDe[c.ultima.subido_por] || ''; const i = q.uno('SELECT estado, ruta_geometria FROM indices_modelo WHERE version_id = ?', c.ultima.id); c.ultima.modelo = !!(i && i.estado === 'listo' && i.ruta_geometria); }
      c.revision_abierta = !!q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id);
      // Estado que se muestra en COM y PUB: En revision (flujo en curso) | Aceptado | Rechazado, segun la ultima ronda; y quien aprobo el flujo
      const ur = q.uno("SELECT estado, revisor, numero, ronda FROM revisiones WHERE contenedor_id = ? AND estado <> 'anulada' ORDER BY ronda DESC LIMIT 1", c.id);
      c.estado_revision = ur ? (ur.estado === 'abierta' ? 'en-revision' : ur.estado === 'devuelta' ? 'rechazado' : 'aceptado') : (c.estado === 'PUBLICADO' ? 'aceptado' : '');
      c.aprobado_por = ur && ur.estado !== 'abierta' && ur.estado !== 'devuelta' ? (ur.revisor || '') : ''; c.aprobado_org = c.aprobado_por ? (orgDe[c.aprobado_por] || '') : '';
      c.n_incidencias = q.uno("SELECT COUNT(*) AS n FROM incidencias WHERE contenedor_id = ? AND estado NOT IN ('cerrada','rechazada')", c.id).n;
      c.n_marcas = c.ultima ? q.uno("SELECT COUNT(*) AS n FROM marcas WHERE version_id = ? AND borrada = '' AND (publicada = 1 OR autor = ?)", c.ultima.id, u.email).n : 0;
      c.descripcion = (c.atributos && c.atributos.descripcion) || (c.campos && (c.campos.descripcion || c.campos.titulo)) || '';   // el resumen automatico va en la ficha, no en la columna Descripcion
    }
    res.json({ contenedores: out.slice(0, 2000) });
  });
  app.get('/api/proyectos/:pid/contenedores/:cid', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = abreJson(q.uno('SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ?', req.params.cid, req.pid), ['campos', 'atributos']);
    if (!c) return res.status(404).json({ error: 'no-existe' });
    const perm = permisoEn(p, u, c.carpeta);
    if (!perm.leer && !(c.carpeta_publicada && permisoEn(p, u, c.carpeta_publicada).leer)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No tienes lectura sobre la carpeta de este contenedor.' });
    c.versiones = q.todos('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC', c.id).map(v => abreJson(v, ['meta']));
    for (const v of c.versiones) { const i = q.uno('SELECT estado, resumen, ruta_geometria, error FROM indices_modelo WHERE version_id = ?', v.id); v.indice = i ? { estado: i.estado, geometria: !!i.ruta_geometria, resumen: json(i.resumen, {}), error: i.error || '' } : null; }
    c.formatoModelo = ctx.modelos ? ctx.modelos.formatoDe((c.versiones[0] || {}).archivo) : '';
    c.transiciones = q.todos('SELECT * FROM transiciones WHERE contenedor_id = ? ORDER BY id DESC', c.id);
    const miembros = miembrosDe(req.pid);
    c.revisiones = q.todos('SELECT * FROM revisiones WHERE contenedor_id = ? ORDER BY ronda DESC', c.id).map(r => abreJson(r, ['pasos'])).map(r => decoraRevision(p, u, r, miembros));
    c.incidencias = q.todos('SELECT id, numero, codigo, titulo, estado, prioridad, contractual, autor, asignado, creado, version_id FROM incidencias WHERE contenedor_id = ? ORDER BY numero DESC', c.id);
    for (const v of c.versiones) v.n_marcas = q.uno("SELECT COUNT(*) AS n FROM marcas WHERE version_id = ? AND borrada = '' AND (publicada = 1 OR autor = ?)", v.id, u.email).n;
    c.compartidos = q.todos("SELECT id, modo, version_id, para, nota, token, por, creado, caduca, proyecto_destino FROM compartidos WHERE contenedor_id = ? AND revocado = '' ORDER BY creado DESC", c.id).map(x => abreJson(x, ['para']));
    c.atributosDef = Array.isArray(p.config.atributos) ? p.config.atributos : [];
    c.correos = q.todos("SELECT id, numero, tipo, asunto, de_org, enviado FROM correos WHERE proyecto_id = ? AND estado = 'enviado' AND adjuntos LIKE ? ORDER BY enviado DESC LIMIT 50", req.pid, '%' + c.id + '%').concat(c.versiones.length ? q.todos("SELECT id, numero, tipo, asunto, de_org, enviado FROM correos WHERE proyecto_id = ? AND estado = 'enviado' AND (" + c.versiones.map(() => 'adjuntos LIKE ?').join(' OR ') + ') ORDER BY enviado DESC LIMIT 50', req.pid, ...c.versiones.map(v => '%' + v.id + '%')) : []).filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
    const zona = CAR.zonaDe(p.config.carpetas, c.carpeta);
    const arbolU = CAR.arbol(p.config.carpetas, u, {});
    c.permisos = { leer: perm.leer, descargar: perm.descargar, escribir: perm.subir, editar: perm.editar, control: perm.control, nivel: perm.nivel, esWip: zona === 'wip', zona,
      carpetasCompartir: arbolU.filter(x => x.subir && x.zonaEfectiva !== 'wip' && x.zonaEfectiva !== 'publicado' && x.zonaEfectiva !== 'archivo').map(x => x.ruta),
      carpetasMover: perm.editar ? arbolU.filter(x => x.subir).map(x => x.ruta) : [] };
    c.flujos = flujosDe(p).filter(f => f.activo !== false).map(f => Object.assign({}, f, { puedoIniciar: u.admin || u.rol === 'administrador' || FL.encaja(f.iniciadores, u) }));
    res.json(c);
  });

  /** SUBIR UNA VERSION: cuerpo = el archivo; x-nombre; ?carpeta=. Valida nomenclatura y permiso de subida sobre la carpeta. */
  // ---------- VALIDACIÓN QA de portadas: obligatoria para los documentos PDF y Word que ENTRAN al compartido (cargar, desplazar o
  //            copiar; también al desplazar una carpeta de WIP al compartido). Lo que traen los conectores de otros CDE no se valida aquí. ----------
  const tipoDocDe = (campos) => { const o = campos && typeof campos === 'object' ? campos : {}; const k = Object.keys(o).find(x => /tipo\s*de\s*documento/i.test(x)) || Object.keys(o).find(x => /^tipo\b/i.test(x)); return k ? String(o[k] || '') : ''; };
  const direccionDe = (p) => { try { return (EST.ubicacionDe(p) || {}).direccionNombre || ''; } catch (e) { return ''; } };
  const revisionesDe = (cid) => cid ? q.todos('SELECT revision FROM versiones WHERE contenedor_id = ? ORDER BY n', cid).map(v => v.revision) : [];
  const qaDe = (p, rutaAbs, archivo, o) => QA.validaArchivo(rutaAbs, archivo, { codigo: o.codigo, esperada: o.esperada, direccion: direccionDe(p), conformeCon: o.conformeCon });
  const resumenQA = (qa) => qa ? { ok: qa.ok, fecha: qa.fecha, revision: qa.datos.revision || '', emision: qa.datos.emision || '', codigo: qa.datos.codigoPortada || '', titulo: qa.datos.titulo || '', fallas: qa.checks.filter(x => !x.ok).map(x => x.id) } : null;
  const esCargaDeConector = (req) => !!(req.llave && /^conector-(forma|aconex|microsoft)-interno$/.test(req.llave.nombre || '') && ['forma', 'aconex', 'onedrive', 'sharepoint'].includes(String(req.query.origen || '')));
  const mensajeQA = (qa) => 'El documento no pasó la Validación QA de su portada (' + qa.checks.filter(x => !x.ok).length + ' observación(es)): ' + qa.checks.filter(x => !x.ok).map(x => x.titulo).join(' · ') + '.';
  /** Lo que aprobó la QA queda en el documento: la revisión de la portada en su última versión y el nombre de la portada como descripción. */
  function aplicaQA(c, v, qa, por, pid) {
    const mv = json(v.meta, {}); mv.qa = resumenQA(qa);
    q.corre('UPDATE versiones SET revision = ?, meta = ? WHERE id = ?', qa.datos.revision, JSON.stringify(mv), v.id);
    if (qa.datos.titulo) { const at = json((q.uno('SELECT atributos FROM contenedores WHERE id = ?', c.id) || {}).atributos, {}); at.descripcion = qa.datos.titulo; q.corre('UPDATE contenedores SET atributos = ? WHERE id = ?', JSON.stringify(at), c.id); }
    audita(por, 'qa.aprobada', pid, c.nombre, { revision: qa.datos.revision, emision: qa.datos.emision, titulo: qa.datos.titulo });
  }
  /** Validación previa (sin cambiar nada) de lo que se va a desplazar o copiar a una carpeta compartida: { ids } o { rutas } (carpetas). */
  app.post('/api/proyectos/:pid/qa/contenedores', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {}, cps = p.config.carpetas || [], carpeta = CAR.limpia(b.carpeta || ''), copia = !!b.copia;
    if (!cps.length || CAR.zonaDe(cps, carpeta) !== 'compartido') return res.json({ ok: true, resultados: [], motivo: 'La carpeta de destino no es compartida: no hace falta la Validación QA.' });
    let cs = [];
    if (Array.isArray(b.ids)) cs = b.ids.slice(0, 300).map(x => q.uno("SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ? AND borrado = ''", String(x), req.pid)).filter(Boolean);
    if (Array.isArray(b.rutas)) for (const r of b.rutas.slice(0, 20)) { const rr = CAR.limpia(r); cs = cs.concat(q.todos("SELECT * FROM contenedores WHERE proyecto_id = ? AND borrado = '' AND retencion = '' AND (carpeta = ? OR carpeta LIKE ?)", req.pid, rr, rr + '/%')); }
    const out = [];
    for (const c of cs) {
      const actual = c.retencion || c.carpeta; if (!(u.admin || permisoEn(p, u, actual).leer)) continue;
      const v = q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); if (!v) continue;
      if (!copia && !c.retencion && CAR.zonaDe(cps, actual) === 'compartido') { out.push({ id: c.id, nombre: v.archivo, aplica: false, motivo: 'Ya está en el compartido.' }); continue; }
      const ap = QA.aplica(v.archivo, tipoDocDe(json(c.campos, {})));
      if (!ap.aplica) { out.push({ id: c.id, nombre: v.archivo, aplica: false, motivo: ap.motivo }); continue; }
      if (!almacen.existe(v.ruta_almacen)) { out.push({ id: c.id, nombre: v.archivo, aplica: true, ok: false, qa: { ok: false, checks: [{ id: 'lectura', titulo: 'Lectura de la portada', ok: false, detalle: 'El archivo no está en el almacén del CDE.' }], datos: {} } }); continue; }
      const ext = path.extname(v.archivo), conforme = !copia && NOM.valida(p.config, carpeta, v.archivo).ok;   // ¿su nombre ya sirve en el destino? (una copia siempre lleva otro nombre)
      const qa = await qaDe(p, almacen.rutaAbsoluta(v.ruta_almacen), v.archivo, { codigo: conforme ? ISO.partes(v.archivo).base : null, esperada: QA.revisionEsperada(copia ? [] : revisionesDe(c.id).slice(0, -1), true), conformeCon: (cod) => NOM.valida(p.config, carpeta, cod + ext).ok });
      out.push({ id: c.id, nombre: v.archivo, aplica: true, ok: qa.ok, qa, renombrar: !conforme && qa.datos.codigoPortada ? qa.datos.codigoPortada + ext : '' });
    }
    res.json({ ok: out.every(x => !x.aplica || x.ok), resultados: out });
  });

  app.post('/api/proyectos/:pid/subir', conLlaveOSesion('autor'), async (req, res) => {
    const pid = String(req.params.pid), p = proyecto(pid);
    if (!p) return res.status(404).json({ error: 'no-existe' });
    // el conector de Forma (llave interna del servidor) carga a nombre de la persona del CDE que trajo el archivo
    if (req.llave && req.llave.nombre === 'conector-forma-interno' && req.get('x-cde-por')) { const por = String(req.get('x-cde-por')).toLowerCase().trim(); if (/^[^\s@]+@[^\s@]+$/.test(por)) req.quien = por; }
    const u = req.llave ? { email: req.quien, rol: 'document-control', organizacion: String(req.query.organizacion || req.llave.organizacion || 'CONTRATISTA').toUpperCase(), admin: false } : yo(req, p);
    if (req.llave) { const m = q.uno('SELECT rol, organizacion FROM miembros WHERE proyecto_id = ? AND email = ?', pid, String(req.quien || '').toLowerCase()); if (m) { u.rol = m.rol; u.organizacion = m.organizacion || u.organizacion; } }
    if (req.llave && /^conector-(forma|aconex|microsoft)-interno$/.test(req.llave.nombre || '') && esAdminGlobal(req.quien)) u.admin = true;   // el administrador del CDE trae a su nombre aunque no sea miembro del proyecto
    let nombre = ''; try { nombre = decodeURIComponent(String(req.get('x-nombre') || '')); } catch (e) {}
    nombre = path.basename(nombre.replace(/\\/g, '/'));
    const conCarpetas = Array.isArray(p.config.carpetas) && p.config.carpetas.length > 0;
    const ext = extDe(nombre);   // el formato forma parte de la identidad: el .pdf y el .docx del mismo codigo son dos documentos
    let c = contenedorPorNombre(pid, ISO.partes(nombre).base, ext);
    let carpeta = CAR.limpia(req.query.carpeta || (c && (c.retencion || c.carpeta)) || '').slice(0, 300);
    if (conCarpetas && !carpeta && !c) carpeta = carpetaWipDe(p, u) || ((CAR.arbol(p.config.carpetas, u, {}).find(x => x.subir && x.zonaEfectiva !== 'publicado' && x.zonaEfectiva !== 'archivo') || {}).ruta || '');
    // la norma la pone la CARPETA (WIP libre; COM/PUB con norma). Con area de retencion activada, lo no conforme se carga "retenido".
    const val = conCarpetas ? NOM.valida(p.config, carpeta, nombre) : ISO.valida(nombre, p.config);
    let retencion = '';
    if (!val.ok) {
      if (p.config.conformidad && p.config.conformidad.areaRetencion && val.extension) { retencion = carpeta; }
      else { req.resume(); return res.status(400).json({ error: 'nomenclatura', mensaje: 'El nombre no cumple la norma de nomenclatura de la carpeta' + (val.norma ? ' (' + val.norma.nombre + ')' : '') + '.', errores: val.errores }); }
    }
    const tipo = ISO.tipoPorExtension(val.extension), fecha = ahora();
    if (conCarpetas && !carpeta) { req.resume(); return res.status(400).json({ error: 'carpeta', mensaje: 'Indica la carpeta de destino: tu organizacion (' + (u.organizacion || 'sin organizacion') + ') no tiene carpeta de trabajo en progreso.' }); }
    if (conCarpetas && !CAR.def(p.config.carpetas, carpeta)) { req.resume(); return res.status(400).json({ error: 'carpeta', mensaje: 'La carpeta "' + carpeta + '" no existe en el proyecto.' }); }
    if (conCarpetas && !permisoEn(p, u, carpeta).subir) { req.resume(); return res.status(403).json({ error: 'sin-permiso', mensaje: 'Tu organizacion (' + (u.organizacion || 'sin organizacion') + ') no puede subir a la carpeta ' + carpeta + '.' }); }
    if (c && (c.retencion || c.carpeta) !== carpeta && req.query.carpeta) { req.resume(); return res.status(409).json({ error: 'carpeta', mensaje: 'Este contenedor vive en ' + (c.retencion || c.carpeta || '(raiz)') + '; las versiones nuevas van a la misma carpeta (el flujo o "mover" lo cambian de sitio).' }); }
    if (!c && q.uno("SELECT 1 FROM contenedores WHERE proyecto_id = ? AND nombre = ? AND (ext = ? OR ext = '') AND borrado <> ''", pid, val.base, ext)) { req.resume(); return res.status(409).json({ error: 'suprimido', mensaje: 'Ese archivo esta en Elementos suprimidos: restauralo antes de subir una version nueva.' }); }
    if (c && c.estado === 'ARCHIVADO') { req.resume(); return res.status(409).json({ error: 'archivado', mensaje: 'El contenedor esta ARCHIVADO: no admite versiones nuevas.' }); }
    if (c && c.estado === 'PUBLICADO' && val.revision && !/^C/i.test(val.revision)) { /* solo si la norma lleva la revision en el nombre (con DOCPG002 la revision es un atributo: R##, C##, M##) */ req.resume(); return res.status(409).json({ error: 'revision', mensaje: 'El contenedor esta PUBLICADO: una version nueva debe llevar revision contractual (C01, C02...). Si es trabajo nuevo, el gestor debe devolverlo a WIP.' }); }
    if (c && q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) { req.resume(); return res.status(409).json({ error: 'revision-abierta', mensaje: 'Hay una revision abierta sobre este contenedor: lo que se revisa no puede cambiar. Espera la decision o pide que lo devuelvan.' }); }
    const zonaDest = conCarpetas && carpeta ? CAR.zonaDe(p.config.carpetas, carpeta) : '';
    const qaAp = zonaDest === 'compartido' && !retencion && !esCargaDeConector(req) ? QA.aplica(nombre, tipoDocDe(val.campos)) : { aplica: false, motivo: '' };
    let nuevo = false;
    if (!c) {
      nuevo = true;
      const zona = CAR.zonaDe(p.config.carpetas, carpeta), estadoInicial = zona === 'compartido' ? 'COMPARTIDO' : zona === 'publicado' ? 'PUBLICADO' : zona === 'archivo' ? 'ARCHIVADO' : 'WIP';
      c = { id: id('c'), proyecto_id: pid, nombre: val.base, tipo, carpeta: retencion ? '' : carpeta, estado: retencion ? 'WIP' : estadoInicial, campos: JSON.stringify(val.campos), version_actual: 0, creado: fecha, creado_por: req.quien, actualizado: fecha, retencion };
      q.corre('INSERT INTO contenedores (id, proyecto_id, nombre, tipo, carpeta, estado, campos, version_actual, creado, creado_por, actualizado, carpeta_compartida, retencion, ext) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', c.id, pid, c.nombre, c.tipo, c.carpeta, c.estado, c.campos, 0, fecha, req.quien, fecha, estadoInicial === 'COMPARTIDO' && !retencion ? carpeta : '', retencion, ext);
    }
    if (!c.ext && ext) { q.corre("UPDATE contenedores SET ext = ? WHERE id = ? AND ext = ''", ext, c.id); c.ext = ext; }
    const n = (c.version_actual || 0) + 1, vid = id('v');
    const prev = q.uno('SELECT revision FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    // revision: la del nombre; si la norma no la lleva en el nombre (DOCPG002), la que se indico en la rejilla de carga (?revision=R00); si no, la siguiente
    const revPedida = String(req.query.revision || '').toUpperCase().slice(0, 8), revDada = val.revision || (ISO.RX_REVISION.test(revPedida) ? revPedida : '');
    if (revPedida && !val.revision && !revDada) { req.resume(); return res.status(400).json({ error: 'revision', mensaje: 'La revision "' + revPedida + '" no es valida (P01, R00, C01, M01...).' }); }
    let revision = revDada || ISO.siguienteRevision(prev && prev.revision, c.estado);   // con Validación QA manda la revisión de la portada
    if (!qaAp.aplica && prev && prev.revision && revDada && compRevision(revDada, prev.revision) <= 0) { req.resume(); return res.status(409).json({ error: 'revision', mensaje: 'La revision ' + revDada + ' no es posterior a la ultima (' + prev.revision + ').' }); }
    try {
      const g = await almacen.guarda(pid, c.id, vid, nombre, req);
      let qa = null;
      if (qaAp.aplica) {
        qa = await qaDe(p, almacen.rutaAbsoluta(g.ruta), nombre, { codigo: val.base, esperada: QA.revisionEsperada(revisionesDe(nuevo ? null : c.id), nuevo) });
        if (!qa.ok) {
          almacen.borraCarpeta(pid, c.id, vid); if (nuevo) q.corre('DELETE FROM contenedores WHERE id = ? AND version_actual = 0', c.id);
          audita(req.quien, 'qa.rechazada', pid, val.base, { carpeta, archivo: nombre, revision: qa.datos.revision || '', fallas: qa.checks.filter(x => !x.ok).map(x => x.id) });
          return res.status(422).json({ error: 'qa', mensaje: mensajeQA(qa), qa });
        }
        revision = qa.datos.revision;
      }
      const idon = String(req.query.idoneidad || (c.estado === 'WIP' ? 'S0' : 'S1')).toUpperCase().slice(0, 4);
      const meta = {}; try { Object.assign(meta, JSON.parse(decodeURIComponent(String(req.get('x-meta') || '')) || '{}')); } catch (e) {}
      if (val.libre) meta.nomenclatura = { libre: true, conforme: val.conforme !== false }; if (retencion) meta.nomenclatura = { retenido: true, errores: val.errores };
      if (qa) { meta.qa = resumenQA(qa); if (qa.datos.titulo) meta.atributos = Object.assign({}, meta.atributos || {}, { descripcion: qa.datos.titulo }); }   // el nombre de la portada es la descripción
      q.corre('INSERT INTO versiones (id, contenedor_id, n, archivo, extension, tamano, sha256, revision, idoneidad, estado_al_subir, origen, ruta_almacen, meta, subido_por, fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        vid, c.id, n, nombre, val.extension, g.tamano, g.sha256, revision, idon, c.estado, String(req.query.origen || (req.llave ? 'complemento' : 'web')).slice(0, 40), g.ruta, JSON.stringify(meta), req.quien, fecha);
      q.corre('UPDATE contenedores SET version_actual = ?, actualizado = ?, tipo = ? WHERE id = ?', n, fecha, tipo, c.id);
      // atributos que llegan con la carga (rejilla de conformidad): parte designada, contrato y los personalizados del proyecto
      if (meta.atributos && typeof meta.atributos === 'object') {
        const permitidas = new Set(['parteDesignada', 'contrato', 'descripcion'].concat((Array.isArray(p.config.atributos) ? p.config.atributos : []).map(d => d.id))), act = json((q.uno('SELECT atributos FROM contenedores WHERE id = ?', c.id) || {}).atributos, {});
        let toca = false; for (const [k, v2] of Object.entries(meta.atributos)) if (permitidas.has(k) && v2 != null && String(v2) !== '') { act[k] = String(v2).slice(0, 500); toca = true; }
        if (toca) q.corre('UPDATE contenedores SET atributos = ? WHERE id = ?', JSON.stringify(act), c.id);
      }
      audita(req.quien, 'version.subir', pid, c.nombre, { version: n, revision, archivo: nombre, tamano: g.tamano, carpeta, origen: req.llave ? 'complemento' : 'web' });
      if (qa) audita(req.quien, 'qa.aprobada', pid, c.nombre, { revision, emision: qa.datos.emision, titulo: qa.datos.titulo });
      // desencadenador automatico de la carpeta (como en Autodesk Docs): lo COMPARTIDO que llega aqui entra solo al flujo configurado
      let automatica = null;
      const dsp = (CAR.def(p.config.carpetas, carpeta) || {}).disparador;
      if (dsp && dsp.flujo && c.estado === 'COMPARTIDO' && !q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) {
        const fl = flujoDe(p, dsp.flujo);
        if (fl && fl.activo !== false) { try { const r = abreRonda(pid, c, fl, req.quien, 'Iniciada automaticamente al cargar en ' + carpeta, fl.alAprobar.copiarA || '', ''); automatica = { id: r.id, ronda: r.ronda, flujo: fl.nombre }; audita(req.quien, 'revision.automatica', pid, c.nombre, { flujo: fl.id, carpeta }); } catch (e) { console.warn('[desencadenador]', e.message); } }
      }
      // lo que trae el conector de Forma entra con la llave interna, pero es un archivo nativo sin indice propio: el CDE lo lee como si se hubiera cargado por la web
      const sinIndicePropio = !req.llave || ['forma', 'aconex', 'onedrive', 'sharepoint'].includes(String(req.query.origen || ''));
      const esModeloLegible = sinIndicePropio && ctx.modelos && ['ifc', 'rvt'].includes(ctx.modelos.formatoDe(nombre)) && !c.retencion;
      if (resumenes && !esModeloLegible) resumenes.encola(pid, c.id, vid);   // resumen automatico (el de un modelo IFC / RVT se escribe cuando el CDE termina de leerlo)
      // modelos IFC / RVT: el CDE los lee por su cuenta (lib/lector-ifc.js, lib/lector-rvt.js). El complemento de Revit manda
      // su propio indice y geometria despues de subir el RVT, por eso lo que llega con llave no se convierte aqui.
      if (sinIndicePropio && ctx.modelos && ctx.modelos.formatoDe(nombre) && !c.retencion) { try { ctx.modelos.procesa(pid, vid, req.quien); } catch (e) { console.error('lector de modelos:', e.message); } }
      if (ctx.puentes && !c.retencion) ctx.puentes.sincroniza(pid, c.id, vid, req.quien).catch(() => {});   // puente: copia sola al otro proyecto (descripcion, ideas, objetivo, conclusiones) en segundo plano
      res.json({ ok: true, contenedor: c.id, version: vid, n, revision, estado: c.estado, tipo, carpeta: c.retencion ? '' : carpeta, retenido: !!c.retencion, retencion: c.retencion || '', libre: !!val.libre, conforme: val.conforme !== false, sha256: g.sha256, tamano: g.tamano, revisionAutomatica: automatica, qa: qa ? resumenQA(qa) : (zonaDest === 'compartido' && qaAp.motivo ? { aplica: false, motivo: qaAp.motivo } : undefined) });
    } catch (e) { almacen.borraCarpeta(pid, c.id, vid); res.status(500).json({ error: 'almacen', mensaje: e.message }); }
  });

  app.get('/api/proyectos/:pid/versiones/:vid/descargar', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const v = q.uno('SELECT v.*, c.carpeta, c.carpeta_publicada FROM versiones v JOIN contenedores c ON c.id = v.contenedor_id WHERE v.id = ? AND c.proyecto_id = ?', req.params.vid, req.pid);
    if (!v || !almacen.existe(v.ruta_almacen)) return res.status(404).json({ error: 'no-existe' });
    const pm = permisoEn(p, u, v.carpeta), pm2 = v.carpeta_publicada ? permisoEn(p, u, v.carpeta_publicada) : null;
    if (!(pm.descargar || (pm2 && pm2.descargar))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Tu permiso sobre la carpeta no incluye descargar.' });
    audita(req.quien, 'version.descargar', req.pid, v.contenedor_id, { version: v.n, archivo: v.archivo });
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(v.archivo)); res.setHeader('Content-Length', v.tamano);
    almacen.flujo(v.ruta_almacen).pipe(res);
  });

  // ---------- transiciones de estado (manuales; el flujo de revision usa la misma funcion) ----------
  function transita(p, u, c, a, opciones) {
    const o = opciones || {}, cps = p.config.carpetas || [], de = c.estado, conCarpetas = cps.length > 0;
    const t = ISO.puedeTransitar(de, a, u.rol); if (!t.ok && !o.porFlujo) return { error: 403, mensaje: t.motivo };
    if (!c.version_actual) return { error: 409, mensaje: 'El contenedor no tiene ninguna version.' };
    const idon = String(o.idoneidad || '').toUpperCase();
    if (idon && !(ISO.IDONEIDAD[a] || []).includes(idon)) return { error: 400, mensaje: 'El codigo ' + idon + ' no corresponde al estado ' + a + ' (' + (ISO.IDONEIDAD[a] || []).join(', ') + ').' };
    if (a === 'PUBLICADO' && !o.porFlujo && q.uno("SELECT COUNT(*) AS n FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id).n) return { error: 409, mensaje: 'Hay una revision abierta: cierrala antes de publicar.' };
    let carpeta = c.carpeta, compartida = c.carpeta_compartida || '', publicada = c.carpeta_publicada || '', origen = c.carpeta_origen || '';
    if (conCarpetas) {
      const zona = CAR.zonaDe(cps, c.carpeta);
      if (a === 'COMPARTIDO' && de === 'WIP') {
        const destino = CAR.limpia(o.carpeta_destino || c.carpeta_compartida || '');
        if (zona === 'wip' && !destino) return { error: 400, mensaje: 'Indica a que carpeta compartida pasa el contenedor (sale de trabajo en progreso).' };
        if (destino && destino !== c.carpeta) {
          if (!CAR.def(cps, destino)) return { error: 400, mensaje: 'La carpeta de destino no existe.' };
          if (CAR.zonaDe(cps, destino) === 'wip') return { error: 400, mensaje: 'La carpeta de destino no puede ser de trabajo en progreso.' };
          if (!permisoEn(p, u, destino).subir && !o.porFlujo) return { error: 403, mensaje: 'No puedes subir a ' + destino + '.' };
          origen = c.carpeta; carpeta = destino;
        }
        compartida = carpeta;
      }
      if ((a === 'COMPARTIDO' || a === 'PUBLICADO') && !o.porFlujo) { const vv = q.uno('SELECT archivo FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); const val = vv ? NOM.valida(p.config, a === 'PUBLICADO' && o.copiarA ? CAR.limpia(o.copiarA) : carpeta, vv.archivo) : { ok: true }; if (!val.ok) return { error: 409, mensaje: 'Para pasar a ' + a + ' el nombre debe cumplir la norma de nomenclatura' + (val.norma ? ' «' + val.norma.nombre + '»' : '') + ': ' + val.errores.join(' ') }; }
      if (a === 'WIP' && de !== 'WIP') { compartida = c.carpeta; if (origen && CAR.def(cps, origen)) carpeta = origen; }
      if (a === 'PUBLICADO') { const d = CAR.limpia(o.copiarA || ''); if (d && CAR.def(cps, d)) publicada = d; }
      if (a === 'ARCHIVADO') { const d = CAR.limpia(o.carpeta_destino || ''); if (d && CAR.def(cps, d)) publicada = d; else { const arch = cps.find(x => x.zona === 'archivo' && x.ruta.split('/')[0] === c.carpeta.split('/')[0]) || cps.find(x => x.zona === 'archivo'); if (arch) publicada = publicada || arch.ruta; } }
    }
    const v = q.uno('SELECT id FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    q.corre('UPDATE contenedores SET estado = ?, carpeta = ?, carpeta_compartida = ?, carpeta_publicada = ?, carpeta_origen = ?, actualizado = ? WHERE id = ?', a, carpeta, compartida, publicada, origen, ahora(), c.id);
    if (idon) q.corre('UPDATE versiones SET idoneidad = ? WHERE id = ?', idon, v.id);
    q.corre('INSERT INTO transiciones (contenedor_id, version_id, de, a, por, fecha, comentario) VALUES (?,?,?,?,?,?,?)', c.id, v.id, de, a, o.por || u.email || '', ahora(), String(o.comentario || '').slice(0, 2000) + (carpeta !== c.carpeta ? ' [' + (c.carpeta || '(raiz)') + ' → ' + carpeta + ']' : '') + (a === 'PUBLICADO' && publicada ? ' [copia en ' + publicada + ']' : ''));
    return { ok: true, estado: a, carpeta, carpeta_publicada: publicada };
  }
  app.post('/api/proyectos/:pid/contenedores/:cid/estado', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = q.uno('SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ?', req.params.cid, req.pid); if (!c) return res.status(404).json({ error: 'no-existe' });
    const a = String((req.body || {}).estado || '').toUpperCase(); if (!ISO.ESTADOS.includes(a)) return res.status(400).json({ error: 'estado', mensaje: 'Estado no valido.' });
    const pm = permisoEn(p, u, c.carpeta);
    if (!(pm.subir || pm.editar)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No tienes permiso de subida/edicion sobre la carpeta del contenedor.' });
    const r = transita(p, u, c, a, { idoneidad: (req.body || {}).idoneidad, comentario: (req.body || {}).comentario, carpeta_destino: (req.body || {}).carpeta_destino, copiarA: (req.body || {}).copiarA, por: req.quien });
    if (r.error) return res.status(r.error).json({ error: 'transicion', mensaje: r.mensaje });
    audita(req.quien, 'contenedor.estado', req.pid, c.nombre, { de: c.estado, a, carpeta: r.carpeta, publicada: r.carpeta_publicada });
    res.json(r);
  });
  /** MOVER un contenedor de carpeta (sin ronda abierta). Hace falta "editar" sobre la carpeta de origen y "subir" en la de destino. */
  /** COPIAR A OTRA CARPETA (v0.14.3): deja el original donde esta y crea OTRO documento en la carpeta de destino con la ultima version.
   *  body: { carpeta, nombre (con extension; el que sale de la rejilla de metadatos), atributos, revision, idoneidad }.
   *  La copia entra por la misma carga de siempre (/subir, con la sesion de quien copia): asi valen la norma de la carpeta, el permiso de
   *  subida, los metadatos, el flujo automatico de la carpeta, el resumen y la lectura del modelo, sin repetir nada aqui.
   *  El CDE identifica cada documento por su nombre dentro del proyecto: la copia necesita un nombre que aun no exista. */
  app.post('/api/proyectos/:pid/contenedores/:cid/copiar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const c = q.uno("SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ? AND borrado = ''", req.params.cid, req.pid); if (!c) return res.status(404).json({ error: 'no-existe' });
    const v = q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); if (!v) return res.status(409).json({ error: 'sin-version', mensaje: 'El documento no tiene ninguna version que copiar.' });
    const actual = c.retencion || c.carpeta, carpeta = CAR.limpia(b.carpeta).slice(0, 300), cps = p.config.carpetas || [];
    if (!carpeta || (cps.length && !CAR.def(cps, carpeta))) return res.status(400).json({ error: 'carpeta', mensaje: 'La carpeta de destino no existe en el proyecto.' });
    const pe = permisoEn(p, u, actual); if (!(pe.descargar || pe.editar || u.admin || u.rol === 'gestor')) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Sin permiso para copiar desde ' + (actual || 'la carpeta actual') + '.' });
    if (!almacen.existe(v.ruta_almacen)) return res.status(409).json({ error: 'almacen', mensaje: 'El archivo de la ultima version no esta en el almacen.' });
    const nombre = path.basename(String(b.nombre || v.archivo).replace(/\\/g, '/')).slice(0, 240), base = ISO.partes(nombre).base;
    const ya = contenedorPorNombre(req.pid, base, extDe(nombre), true);
    if (ya) return res.status(409).json({ error: 'existe', mensaje: ya.borrado ? 'Hay un documento suprimido con el nombre «' + base + '»: restauralo o da otro nombre a la copia.' : 'Ya existe un documento llamado «' + base + '» en ' + (ya.retencion || ya.carpeta || 'el proyecto') + '. Cada documento del proyecto lleva un nombre unico: da otro nombre a la copia o usa «Mover a otra carpeta».' });
    // metadatos de la copia: los del original (descripcion y atributos) y, encima, los que se completaron en la rejilla
    const atributos = Object.assign({}, json(c.atributos, {}), (b.atributos && typeof b.atributos === 'object') ? b.atributos : {});
    const meta = { atributos, copiaDe: { contenedor: c.id, version: v.id, nombre: c.nombre, carpeta: actual, n: v.n } };
    const qs = new URLSearchParams({ carpeta, origen: 'copia' }); if (b.revision) qs.set('revision', String(b.revision)); if (b.idoneidad) qs.set('idoneidad', String(b.idoneidad));
    const sale = require('http').request({ host: '127.0.0.1', port: req.socket.localPort, method: 'POST', path: '/api/proyectos/' + encodeURIComponent(req.pid) + '/subir?' + qs.toString(),
      headers: { cookie: req.headers.cookie || '', 'content-type': 'application/octet-stream', 'x-nombre': encodeURIComponent(nombre), 'x-meta': encodeURIComponent(JSON.stringify(meta)) } }, (r) => {
      let t = ''; r.setEncoding('utf8'); r.on('data', d => { t += d; }); r.on('end', () => {
        let j = {}; try { j = JSON.parse(t); } catch (e) { j = { mensaje: t.slice(0, 300) }; }
        if (r.statusCode !== 200) return res.status(r.statusCode || 500).json(j);
        q.corre('INSERT INTO transiciones (contenedor_id, version_id, de, a, por, fecha, comentario) VALUES (?,?,?,?,?,?,?)', c.id, v.id, c.estado, c.estado, req.quien, ahora(), 'Copiado [' + (actual || '(raiz)') + ' → ' + carpeta + '] como ' + base);
        audita(req.quien, 'contenedor.copiar', req.pid, c.nombre, { de: actual, a: carpeta, como: base, version: v.n });
        res.json(Object.assign(j, { copiaDe: c.id }));
      });
    });
    sale.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: 'copia', mensaje: e.message }); });
    almacen.flujo(v.ruta_almacen).on('error', (e) => { sale.destroy(e); }).pipe(sale);
  });

  app.post('/api/proyectos/:pid/contenedores/:cid/mover', requiereSesion, requiereRol('autor'), J, async (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const c = q.uno('SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ?', req.params.cid, req.pid); if (!c) return res.status(404).json({ error: 'no-existe' });
    const carpeta = CAR.limpia((req.body || {}).carpeta).slice(0, 300), copia = !!(req.body || {}).copia;
    // Como en Autodesk Docs: se desplaza a CUALQUIER carpeta, aunque el archivo tenga o haya tenido revisiones (la ronda sigue; solo cambia de sitio).
    // copia=true: lo que se mueve es la COPIA PUBLICADA (la que dejo el flujo), no el original.
    const cps = p.config.carpetas || [], actual = copia ? c.carpeta_publicada : (c.retencion || c.carpeta);
    if (copia && !c.carpeta_publicada) return res.status(409).json({ error: 'copia', mensaje: 'Este archivo no tiene copia publicada.' });
    if (carpeta === actual) return res.status(409).json({ error: 'carpeta', mensaje: 'Ya esta en esa carpeta.' });
    if (cps.length && !CAR.def(cps, carpeta)) return res.status(400).json({ error: 'carpeta', mensaje: 'La carpeta no existe en el proyecto.' });
    if (!(permisoEn(p, u, actual).editar || u.admin || u.rol === 'gestor')) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Hace falta "editar" sobre la carpeta actual.' });
    if (cps.length && !permisoEn(p, u, carpeta).subir) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Sin permiso de subida sobre ' + carpeta + '.' });
    const v = q.uno('SELECT * FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    // La norma se exige solo al ENTRAR a una carpeta con norma desde una libre (WIP / retencion); lo que ya esta en COM/PUB (aceptado o rechazado por un flujo) se desplaza sin revalidar, como en Forma.
    if (cps.length && v && !copia) { const antes = NOM.valida(p.config, actual, v.archivo), val = NOM.valida(p.config, carpeta, v.archivo); if (!val.ok && (antes.libre || c.retencion)) return res.status(409).json({ error: 'nomenclatura', mensaje: 'Para ir a ' + carpeta + ' el nombre debe cumplir la norma ' + (val.norma ? '«' + val.norma.nombre + '»' : '') + ': cambia el nombre primero.', errores: val.errores }); }
    // Validación QA obligatoria al ENTRAR al compartido (de WIP, de una carpeta libre o del área de retención)
    let qa = null;
    if (!copia && v && cps.length && CAR.zonaDe(cps, carpeta) === 'compartido' && (c.retencion || CAR.zonaDe(cps, actual) !== 'compartido')) {
      const ap = QA.aplica(v.archivo, tipoDocDe(json(c.campos, {})));
      if (ap.aplica) {
        if (!almacen.existe(v.ruta_almacen)) return res.status(409).json({ error: 'almacen', mensaje: 'El archivo de la última versión no está en el almacén: no se puede validar su portada.' });
        qa = await qaDe(p, almacen.rutaAbsoluta(v.ruta_almacen), v.archivo, { codigo: ISO.partes(v.archivo).base, esperada: QA.revisionEsperada(revisionesDe(c.id).slice(0, -1), true) });
        if (!qa.ok) { audita(req.quien, 'qa.rechazada', req.pid, c.nombre, { a: carpeta, revision: qa.datos.revision || '', fallas: qa.checks.filter(x => !x.ok).map(x => x.id) }); return res.status(422).json({ error: 'qa', mensaje: mensajeQA(qa), qa }); }
      }
    }
    if (copia) q.corre('UPDATE contenedores SET carpeta_publicada = ?, actualizado = ? WHERE id = ?', carpeta, ahora(), c.id);
    // El estado ISO 19650 acompana a la carpeta (como al cargar: lo que entra a una carpeta compartida queda COMPARTIDO y se puede enviar a revision; lo que vuelve a WIP queda WIP).
    // No se toca si hay una revision abierta (la ronda manda) ni lo PUBLICADO/ARCHIVADO.
    let estadoNuevo = c.estado;
    if (!copia && cps.length && !q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) {
      const zona = CAR.zonaDe(cps, carpeta);
      if (zona === 'compartido' && c.estado === 'WIP') estadoNuevo = 'COMPARTIDO';
      else if (zona === 'publicado' && (c.estado === 'WIP' || c.estado === 'COMPARTIDO')) estadoNuevo = 'PUBLICADO';
      else if (zona === 'wip' && c.estado === 'COMPARTIDO') estadoNuevo = 'WIP';
    }
    if (copia) q.corre('UPDATE contenedores SET carpeta_publicada = ?, actualizado = ? WHERE id = ?', carpeta, ahora(), c.id);
    else q.corre("UPDATE contenedores SET carpeta = ?, retencion = '', estado = ?, carpeta_compartida = CASE WHEN ? = 'COMPARTIDO' THEN ? ELSE carpeta_compartida END, actualizado = ? WHERE id = ?", carpeta, estadoNuevo, estadoNuevo, carpeta, ahora(), c.id);
    q.corre('INSERT INTO transiciones (contenedor_id, version_id, de, a, por, fecha, comentario) VALUES (?,?,?,?,?,?,?)', c.id, (v || {}).id || null, c.estado, estadoNuevo, req.quien, ahora(), (copia ? 'Copia publicada movida [' : (c.retencion ? 'Sale del area de retencion [' : 'Movido [')) + (actual || '(raiz)') + ' → ' + carpeta + ']');
    audita(req.quien, 'contenedor.mover', req.pid, c.nombre, { de: actual, a: carpeta, copia });
    if (qa) aplicaQA(c, v, qa, req.quien, req.pid);
    res.json({ ok: true, carpeta, copia, estado: estadoNuevo, qa: qa ? resumenQA(qa) : undefined });
  });

  // ---------- flujos de revision (configurables, con etapas en paralelo) ----------
  function flujosDe(p) { if (Array.isArray(p.config.flujos) && p.config.flujos.length) return p.config.flujos; return FL.porDefecto(); }
  /** Abre una ronda de revision (lo usan "iniciar revision" y el desencadenador automatico de una carpeta). */
  function abreRonda(pid, c, fl, quienEmail, comentario, destino, plazoPedido, extra) {
    const x = extra || {};
    const v = q.uno('SELECT id FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id);
    const ronda = (q.uno('SELECT MAX(ronda) AS m FROM revisiones WHERE contenedor_id = ?', c.id).m || 0) + 1, rid = id('r'), fecha = ahora();
    const numero = (q.uno('SELECT MAX(r.numero) AS m FROM revisiones r JOIN contenedores k ON k.id = r.contenedor_id WHERE k.proyecto_id = ?', pid).m || 0) + 1;   // #121, como en Forma: correlativo del proyecto
    const plazo = String(plazoPedido || '').slice(0, 10) || FL.venceEtapa(fl.etapas[0], fecha).slice(0, 10);
    q.corre('INSERT INTO revisiones (id, contenedor_id, version_id, ronda, estado, revisor, solicitada_por, abierta, plazo, comentario, flujo_id, paso, pasos, vence, destino, flujo_def, numero, nombre, notas, lote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      rid, c.id, v.id, ronda, 'abierta', '', quienEmail, fecha, plazo, String(comentario || '').slice(0, 2000), fl.id, 0, '[]', FL.venceEtapa(fl.etapas[0], fecha), destino, JSON.stringify(fl), numero, String(x.nombre || c.nombre).slice(0, 200), String(x.notas || '').slice(0, 4000), String(x.lote || '').slice(0, 40));
    audita(quienEmail, 'revision.abrir', pid, c.nombre, { ronda, numero, flujo: fl.id, destino });
    return { ok: true, id: rid, ronda, numero, flujo: fl.nombre, etapas: fl.etapas.map(e => e.pasos.map(x => x.nombre)), pasos: fl.etapas.flatMap(e => e.pasos.map(x => x.nombre)), vence: FL.venceEtapa(fl.etapas[0], fecha) };
  }
  const flujoDe = (p, fid) => flujosDe(p).find(f => f.id === fid) || null;
  app.get('/api/proyectos/:pid/flujos', requiereSesion, requiereRol('lector'), (req, res) => { const p = proyecto(req.pid), u = yo(req, p); res.json({ flujos: flujosDe(p).map(f => Object.assign({}, f, { puedoIniciar: u.admin || u.rol === 'administrador' || FL.encaja(f.iniciadores, u), enUso: q.uno("SELECT COUNT(*) AS n FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ? AND r.flujo_id = ? AND r.estado = 'abierta'", req.pid, f.id).n })), roles: Object.keys(ISO.RANGO_ROL), organizaciones: organizacionesDe(req.pid), miembros: q.todos('SELECT email, rol, organizacion, cargo, nombre, empresa, puesto, disciplina, funcion FROM miembros WHERE proyecto_id = ? ORDER BY nombre, email', req.pid), idoneidad: ISO.IDONEIDAD }); });
  app.post('/api/proyectos/:pid/flujos', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), lista = flujosDe(p).slice(); const b = Object.assign({}, req.body || {}); delete b.id;
    const n = FL.normaliza(b, lista); if (n.error) return res.status(400).json({ error: 'flujo', mensaje: n.error });
    if (n.flujo.alAprobar.copiarA && !CAR.def(p.config.carpetas, n.flujo.alAprobar.copiarA)) return res.status(400).json({ error: 'flujo', mensaje: 'La carpeta de destino "' + n.flujo.alAprobar.copiarA + '" no existe.' });
    lista.push(n.flujo); p.config.flujos = lista; guardaConfig(p); audita(req.quien, 'flujo.crear', req.pid, n.flujo.id, { nombre: n.flujo.nombre }); res.json({ ok: true, flujo: n.flujo });
  });
  app.put('/api/proyectos/:pid/flujos/:fid', requiereSesion, requiereRol('gestor'), J, (req, res) => {
    const p = proyecto(req.pid), lista = flujosDe(p).slice(), i = lista.findIndex(f => f.id === req.params.fid); if (i < 0) return res.status(404).json({ error: 'no-existe' });
    const n = FL.normaliza(Object.assign({}, req.body || {}, { id: req.params.fid, creado: lista[i].creado }), lista.filter(f => f.id !== req.params.fid)); if (n.error) return res.status(400).json({ error: 'flujo', mensaje: n.error });
    if (n.flujo.alAprobar.copiarA && !CAR.def(p.config.carpetas, n.flujo.alAprobar.copiarA)) return res.status(400).json({ error: 'flujo', mensaje: 'La carpeta de destino "' + n.flujo.alAprobar.copiarA + '" no existe.' });
    lista[i] = n.flujo; p.config.flujos = lista; guardaConfig(p); audita(req.quien, 'flujo.editar', req.pid, n.flujo.id, { nombre: n.flujo.nombre }); res.json({ ok: true, flujo: n.flujo, aviso: 'Las rondas ya abiertas siguen con la version del flujo con la que empezaron.' });
  });
  app.post('/api/proyectos/:pid/flujos/:fid/duplicar', requiereSesion, requiereRol('gestor'), (req, res) => {
    const p = proyecto(req.pid), lista = flujosDe(p).slice(), f = lista.find(x => x.id === req.params.fid); if (!f) return res.status(404).json({ error: 'no-existe' });
    const n = FL.normaliza(Object.assign(JSON.parse(JSON.stringify(f)), { id: f.id + '-copia', nombre: f.nombre + ' (copia)', creado: undefined }), lista); lista.push(n.flujo); p.config.flujos = lista; guardaConfig(p); res.json({ ok: true, flujo: n.flujo });
  });
  app.delete('/api/proyectos/:pid/flujos/:fid', requiereSesion, requiereRol('gestor'), (req, res) => {
    const p = proyecto(req.pid), lista = flujosDe(p).slice(), i = lista.findIndex(f => f.id === req.params.fid); if (i < 0) return res.status(404).json({ error: 'no-existe' });
    if (q.uno("SELECT COUNT(*) AS n FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ? AND r.flujo_id = ? AND r.estado = 'abierta'", req.pid, req.params.fid).n) return res.status(409).json({ error: 'en-uso', mensaje: 'Hay rondas abiertas con este flujo: desactivalo en vez de borrarlo.' });
    lista.splice(i, 1); p.config.flujos = lista; guardaConfig(p); audita(req.quien, 'flujo.borrar', req.pid, req.params.fid, {}); res.json({ ok: true });
  });
  /** Una ronda con todo lo que la web necesita: flujo (la copia guardada en la ronda), estado de la etapa, que puedo decidir. */
  function decoraRevision(p, u, r, miembros) {
    const fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : flujoDe(p, r.flujo_id);
    r.flujo = fl ? { id: fl.id, nombre: fl.nombre, etapas: fl.etapas.map(e => ({ nombre: e.nombre, modo: e.modo || '', arbitro: e.arbitro ? FL.describe(e.arbitro) : '', alVencer: e.alVencer || '', etiquetas: e.etiquetas || null, pasos: e.pasos.map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, minimo: x.minimo, revisores: x.revisores, dias: x.dias, quien: FL.describe(x.revisores), recomienda: !!x.recomienda, decide: x.decide ? FL.describe(x.decide) : '' })) })), alAprobar: fl.alAprobar, etiquetas: fl.etiquetas, estados: fl.estados || FL.ESTADOS_BASE() } : null;
    r.etapaActual = fl && r.estado === 'abierta' ? FL.estadoEtapa(fl, r, miembros) : null;
    const dcd = fl ? FL.pasosDecidibles(fl, r, u, miembros) : [];
    r.decidibles = dcd.map(x => x.id);
    r.acciones = dcd.map(x => ({ paso: x.id, nombre: x.nombre, accion: x.accion || 'decidir' }));   // decidir | recomendar | decidir-equipo | arbitrar
    r.puedoDecidir = r.decidibles.length > 0;
    r.soyOpcional = r.puedoDecidir && !(u.admin || u.rol === 'administrador') && !dcd.some(x => x.accion === 'decidir-equipo' || x.accion === 'arbitrar' || FL.encaja(x.revisores, u));
    r.siguienteAccionDe = r.etapaActual ? (r.etapaActual.consenso === 'conflicto' ? [{ paso: 'Decisión del conflicto', pendientes: r.etapaActual.arbitros.length ? r.etapaActual.arbitros : [FL.describe(r.etapaActual.arbitro)] }] : r.etapaActual.pasos.filter(x => !x.completo).map(x => ({ paso: x.nombre + (x.esperaDecision ? ' (decisión del equipo)' : ''), pendientes: x.pendientes.length ? x.pendientes : [FL.describe(x.esperaDecision ? x.decide : x.revisores)] }))) : [];
    // Resumen por etapa y paso de lo ya decidido: recomendaciones a favor / en contra y el resultado de cada equipo (lo que recibe el GP).
    r.resumen = fl ? fl.etapas.map((e, i) => ({ etapa: i, nombre: e.nombre, etiquetas: e.etiquetas || null, pasos: e.pasos.map(x => {
      const ds = (r.pasos || []).filter(d => d.etapa === i && d.paso === x.id), rec = ds.filter(d => d.clase === 'recomendacion'), fin = ds.filter(d => d.clase !== 'recomendacion' && d.clase !== 'revision' && !d.opcional);
      const dev = fin.some(d => d.decision === 'devuelta'), ult = fin[fin.length - 1];
      return { id: x.id, nombre: x.nombre, recomienda: !!x.recomienda, sinVoto: !!(x.decide && x.decide.length), revisados: ds.filter(d => d.clase === 'revision').length, aFavor: rec.filter(d => d.decision !== 'devuelta').length, enContra: rec.filter(d => d.decision === 'devuelta').length,
        resultado: !fin.length ? '' : dev ? 'devuelta' : fin.some(d => d.decision === 'aprobada-con-comentarios') ? 'aprobada-con-comentarios' : 'aprobada', por: ult ? ult.por : '', clase: ult ? (ult.clase || '') : '' };
    }).concat((r.pasos || []).filter(d => d.etapa === i && d.paso === '__arbitro').map(d => ({ id: '__arbitro', nombre: 'Decisión del desacuerdo (' + FL.describe(e.arbitro || []) + ')', recomienda: false, aFavor: 0, enContra: 0, resultado: d.decision === 'devuelta' ? 'devuelta' : 'aprobada', por: d.por, clase: 'arbitraje' }))) })).filter(e => e.pasos.some(x => x.aFavor || x.enContra || x.revisados || x.resultado)) : [];
    if (r.correo_id) { const k = q.uno('SELECT id, numero, hilo_id FROM correos WHERE id = ?', r.correo_id); r.correo = k ? { id: k.id, numero: k.numero, enLinea: q.uno("SELECT COUNT(*) AS n FROM correos WHERE hilo_id = ? AND estado = 'enviado'", k.hilo_id || k.id).n } : null; }
    r.aprobadoPor = r.estado !== 'abierta' && r.pasos.length ? r.pasos[r.pasos.length - 1].por : '';
    r.vencida = !!(r.estado === 'abierta' && r.vence && r.vence < ahora());
    delete r.flujo_def;
    return r;
  }
  app.post('/api/proyectos/:pid/contenedores/:cid/revisiones', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const c = q.uno('SELECT * FROM contenedores WHERE id = ? AND proyecto_id = ?', req.params.cid, req.pid); if (!c) return res.status(404).json({ error: 'no-existe' });
    // Lo que esta en una carpeta compartida se puede enviar a revision aunque siga marcado WIP (se desplazo alli): pasa a COMPARTIDO en el acto.
    if (c.estado === 'WIP' && !c.retencion && CAR.zonaDe(p.config.carpetas || [], c.carpeta) === 'compartido') {
      q.corre("UPDATE contenedores SET estado = 'COMPARTIDO', carpeta_compartida = ?, actualizado = ? WHERE id = ?", c.carpeta, ahora(), c.id);
      q.corre('INSERT INTO transiciones (contenedor_id, version_id, de, a, por, fecha, comentario) VALUES (?,?,?,?,?,?,?)', c.id, null, 'WIP', 'COMPARTIDO', req.quien, ahora(), 'Esta en una carpeta compartida: pasa a COMPARTIDO al enviarse a revision');
      c.estado = 'COMPARTIDO'; c.carpeta_compartida = c.carpeta;
    }
    if (c.estado !== 'COMPARTIDO') return res.status(409).json({ error: 'estado', mensaje: 'Solo se revisa lo que esta en una carpeta compartida: desplaza primero el archivo de WIP a una carpeta compartida.' });
    if (!(permisoEn(p, u, c.carpeta).subir || permisoEn(p, u, c.carpeta).editar)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Inicia la revision quien puede subir a la carpeta del contenedor.' });
    if (q.uno("SELECT 1 FROM revisiones WHERE contenedor_id = ? AND estado = 'abierta'", c.id)) return res.status(409).json({ error: 'abierta', mensaje: 'Ya hay una revision abierta.' });
    const fl = flujoDe(p, String(b.flujo || '')) || flujosDe(p).find(f => f.activo !== false);
    if (!fl || fl.activo === false) return res.status(400).json({ error: 'flujo', mensaje: 'Flujo no valido o inactivo.' });
    if (!(u.admin || u.rol === 'administrador' || FL.encaja(fl.iniciadores, u))) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Este flujo lo inician: ' + FL.describe(fl.iniciadores) + '.' });
    let destino = fl.alAprobar.copiarA || '';
    if (b.copiarA !== undefined && String(b.copiarA) !== destino) { if (!fl.alAprobar.iniciadorPuedeCambiar) return res.status(403).json({ error: 'destino', mensaje: 'Este flujo no permite al iniciador cambiar la carpeta de destino.' }); destino = CAR.limpia(b.copiarA); if (destino && !CAR.def(p.config.carpetas, destino)) return res.status(400).json({ error: 'destino', mensaje: 'La carpeta de destino no existe.' }); }
    const r = abreRonda(req.pid, c, fl, req.quien, String(b.comentario || ''), destino, String(b.plazo || ''), { nombre: b.nombre, notas: b.notas, lote: b.lote });
    // Correspondencia de la revision: (a) ronda siguiente → el levantamiento de observaciones va por la MISMA linea; (b) se pide crearla al enviar; (c) se suma a la del lote
    try {
      const fila = q.uno('SELECT * FROM revisiones WHERE id = ?', r.id), bc = b.correspondencia || {}, adjV = [{ tipo: 'version', id: fila.version_id }], ref = 'Revisión #' + r.numero + ' · ' + c.nombre;
      const previa = q.uno("SELECT correo_id, ronda, numero FROM revisiones WHERE contenedor_id = ? AND correo_id <> '' AND id <> ? ORDER BY ronda DESC LIMIT 1", c.id, r.id);
      let cid2 = '', rr = null;
      if (previa) {
        cid2 = previa.correo_id;
        rr = correoRevision(p, u, { correo_id: cid2 }, c, { tipo: 'transmittal', asunto: ref + ' — ronda ' + r.ronda + ': levantamiento de observaciones', adjuntos: adjV,
          cuerpo: 'Se envía nuevamente a revisión el documento ' + c.nombre + ' (ronda ' + r.ronda + ') con el levantamiento de las observaciones de la ronda ' + previa.ronda + ' (revisión #' + previa.numero + ').\n\nFlujo de revisión: ' + fl.nombre + '.\nVersión enviada: adjunta a este correo.' + (b.notas || b.comentario ? '\n\nNotas del iniciador:\n' + String(b.notas || b.comentario) : '') });
      } else if (bc.id && q.uno('SELECT 1 FROM correos WHERE id = ? AND proyecto_id = ?', String(bc.id), req.pid)) {
        cid2 = String(bc.id); const k = abreJson(q.uno('SELECT adjuntos, cuerpo FROM correos WHERE id = ?', cid2), ['adjuntos']);
        q.corre('UPDATE correos SET adjuntos = ?, cuerpo = ? WHERE id = ?', JSON.stringify((k.adjuntos || []).concat(adjV)), k.cuerpo + '\n· ' + c.nombre + ' (revisión #' + r.numero + ')', cid2);
      } else if (bc.crear) {
        const K = CORR(), para = K && Array.isArray(bc.para) && bc.para.length ? K.normalizaDest(bc.para, req.pid) : destinatariosFlujo(p, fl, u);
        rr = correoRevision(p, u, { correo_id: '' }, c, { nuevo: true, tipo: String(bc.tipo || 'transmittal'), para, adjuntos: adjV, asunto: String(bc.asunto || '').trim() || (String(b.nombre || c.nombre) + ' — envío a revisión'),
          cuerpo: (bc.cuerpo ? String(bc.cuerpo) + '\n\n' : '') + 'Se envía a revisión el documento que se adjunta.\n\nFlujo de revisión: ' + fl.nombre + '.\n' + fl.etapas.map((e, i) => (i + 1) + '. ' + e.nombre + ' — ' + e.pasos.map(x => x.nombre + (x.dias ? ' (' + x.dias + ' d)' : '')).join(' | ')).join('\n') + '\n\nDocumentos:\n· ' + c.nombre + ' (revisión #' + r.numero + ')' });
        if (rr) cid2 = rr.id;
      }
      if (cid2) { q.corre('UPDATE revisiones SET correo_id = ? WHERE id = ?', cid2, r.id); r.correo = { id: cid2, numero: rr ? rr.numero : (q.uno('SELECT numero FROM correos WHERE id = ?', cid2) || {}).numero || '' }; }
    } catch (e) { console.warn('[correspondencia al abrir la revision]', e.message); }
    res.json(r);
  });
  /** Decidir un paso de la etapa actual: aprobar | aprobar-con-comentarios | devolver. body.paso = id del paso (si tengo varios). */
  app.post('/api/proyectos/:pid/revisiones/:rid/decidir', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p), b = req.body || {};
    const r = abreJson(q.uno('SELECT r.* FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE r.id = ? AND c.proyecto_id = ?', req.params.rid, req.pid), ['pasos', 'flujo_def']);
    if (!r || r.estado !== 'abierta') return res.status(404).json({ error: 'no-existe', mensaje: 'No hay una revision abierta con ese id.' });
    const c = q.uno('SELECT * FROM contenedores WHERE id = ?', r.contenedor_id), fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : flujoDe(p, r.flujo_id);
    if (!fl) return res.status(409).json({ error: 'flujo', mensaje: 'El flujo de esta ronda ya no existe.' });
    let decision = String(b.decision || b.estado || (b.adhiere ? 'devolver' : '')), estadoId = '';
    if (!['aprobada', 'aprobar', 'aprobada-con-comentarios', 'aprobar-con-comentarios', 'devuelta', 'devolver'].includes(decision)) { const base = FL.decisionDeEstado(fl, decision); if (!base) return res.status(400).json({ error: 'decision', mensaje: 'Decision no valida.' }); estadoId = decision; decision = base; }
    else estadoId = /devuelta|devolver/.test(decision) ? 'devuelta' : /con-comentarios/.test(decision) ? 'aprobada-con-comentarios' : 'aprobada';
    const miembros = miembrosDe(req.pid), decidibles = FL.pasosDecidibles(fl, r, u, miembros);
    if (!decidibles.length) return res.status(403).json({ error: 'sin-permiso', mensaje: 'No tienes un paso pendiente en la etapa actual (' + fl.etapas[r.paso].pasos.map(x => x.nombre + ': ' + FL.describe(x.revisores)).join('; ') + ').' });
    const paso = b.paso ? decidibles.find(x => x.id === b.paso) : (decidibles.length === 1 ? decidibles[0] : null);
    if (!paso) return res.status(400).json({ error: 'paso', mensaje: 'Indica que paso decides: ' + decidibles.map(x => x.id + ' (' + x.nombre + ')').join(', ') + '.' });
    const etDef = fl.etapas[r.paso || 0], consenso = etDef.modo === 'consenso', accion = paso.accion || 'decidir', fecha = ahora();
    if (accion === 'revisar') { decision = 'aprobada'; estadoId = 'aprobada'; }   /* enviar la revision (incidencias y comentarios) sin recomendar: decide el responsable del equipo */
    // ADHESION (consenso): el otro revisor no hace su propia revision y pide que el rechazo proceda con la del primero
    const adhiere = consenso && accion === 'decidir' && !!b.adhiere;
    if (adhiere) { const otro = r.pasos.find(x => x.etapa === (r.paso || 0) && x.paso !== paso.id && x.decision === 'devuelta'); if (!otro) return res.status(409).json({ error: 'adhesion', mensaje: 'Nadie ha rechazado todavia en esta etapa: no hay un rechazo al que adherirse.' }); decision = 'devuelta'; estadoId = 'devuelta'; if (!b.comentario) b.comentario = 'Procede el rechazo con la revision de ' + otro.por + ' (' + otro.nombre + ').'; }
    const comentario = String(b.comentario || '').slice(0, 4000), dev = /devuelta|devolver/.test(decision), conCom = /con-comentarios/.test(decision);
    const estadoTxt = (etDef.etiquetas && etDef.etiquetas[dev ? 'devuelta' : 'aprobada']) || ((fl.estados || []).find(x => x.id === estadoId) || {}).etiqueta || '';
    const opcional = (accion === 'decidir' || accion === 'recomendar' || accion === 'revisar') && !FL.encaja(paso.revisores, u) && !(u.admin || u.rol === 'administrador');   // revisor opcional: opina, no decide
    const clase = accion === 'revisar' ? 'revision' : accion === 'recomendar' ? 'recomendacion' : accion === 'decidir-equipo' ? 'decision-equipo' : accion === 'arbitrar' ? 'arbitraje' : adhiere ? 'adhesion' : '';
    r.pasos.push({ etapa: r.paso || 0, paso: paso.id, nombre: paso.nombre, decision: dev ? 'devuelta' : conCom ? 'aprobada-con-comentarios' : 'aprobada', estado: estadoId, etiqueta: accion === 'revisar' ? 'Revisión enviada' : estadoTxt, opcional, clase, por: u.email, fecha, comentario });
    const guarda = () => q.corre('UPDATE revisiones SET pasos = ?, comentario = ? WHERE id = ?', JSON.stringify(r.pasos), comentario, r.id);
    if (opcional) { q.corre('UPDATE revisiones SET pasos = ? WHERE id = ?', JSON.stringify(r.pasos), r.id); audita(u.email, 'revision.opinion', req.pid, c.nombre, { ronda: r.ronda, paso: paso.nombre, estado: estadoId }); return res.json({ ok: true, estado: 'abierta', opcional: true, etapa: r.paso }); }
    const ref = '#' + r.numero + ' · ' + c.nombre;
    // ---- arbitraje del conflicto (uno acepta y otro rechaza): decide el arbitro
    if (accion === 'arbitrar') {
      audita(u.email, 'revision.arbitraje', req.pid, c.nombre, { ronda: r.ronda, decision: dev ? 'rechazar' : 'continuar' });
      return res.json(dev ? cierraDevuelta(p, u, r, c, fl, 'Decision del conflicto: ' + estadoTxt, comentario) : avanzaOAprueba(p, u, r, c, fl, b, comentario));
    }
    // ---- recomendaciones (y decision del equipo): nunca cierran la ronda; al completarse la etapa, sigue
    if (accion === 'recomendar' || accion === 'revisar' || accion === 'decidir-equipo') {
      const est = FL.estadoEtapa(fl, r, miembros), ep = est.pasos.find(x => x.id === paso.id);
      audita(u.email, accion === 'recomendar' ? 'revision.recomendar' : accion === 'revisar' ? 'revision.revisar' : 'revision.decision-equipo', req.pid, c.nombre, { ronda: r.ronda, paso: paso.nombre, decision: dev ? 'rechazar' : 'aceptar' });
      if (est.completa) return res.json(avanzaOAprueba(p, u, r, c, fl, b, comentario));
      guarda();
      if (accion !== 'decidir-equipo' && ep && ep.esperaDecision) avisaRevision(req.pid, u, ep.decisores, 'Revisión ' + ref + ': tu equipo terminó de revisar, falta tu decisión', 'Todos los especialistas de «' + paso.nombre + '» enviaron su revisión (incidencias y comentarios).\nTe corresponde decidir, por todo el equipo, si el documento se Acepta o se Rechaza.\n\n' + resumenDecisiones(r, r.paso || 0), r.version_id);
      return res.json({ ok: true, estado: 'abierta', etapa: r.paso, paso: r.paso, recomendacion: accion === 'recomendar', revisado: accion === 'revisar', esperaDecision: !!(ep && ep.esperaDecision), pendientes: est.pasos.filter(x => !x.completo).map(x => x.nombre) });
    }
    // ---- etapa por CONSENSO (los dos Document Control): un rechazo no cierra; se espera al otro
    if (consenso) {
      const est = FL.estadoEtapa(fl, r, miembros);
      audita(u.email, dev ? 'revision.rechazo-calidad' : 'revision.paso', req.pid, c.nombre, { ronda: r.ronda, paso: paso.nombre, etapa: r.paso, consenso: est.consenso, adhiere });
      if (est.consenso === 'aceptada') return res.json(avanzaOAprueba(p, u, r, c, fl, b, comentario));
      if (est.consenso === 'rechazada') return res.json(cierraDevuelta(p, u, r, c, fl, estadoTxt + ' con la firma y validacion de ' + est.pasos.map(x => x.nombre).join(' y '), comentario));
      guarda();
      const otros = est.pasos.filter(x => x.id !== paso.id);
      if (est.consenso === 'conflicto') {
        avisaRevision(req.pid, u, est.arbitros, 'Revisión ' + ref + ': los revisores de calidad no coinciden, te toca decidir', 'En «' + etDef.nombre + '» un revisor quiere pasar el documento a la etapa siguiente y otro quiere rechazarlo.\nDecide si se rechaza (' + ((etDef.etiquetas || {}).devuelta || 'Rechazado') + ') o si pasa a la etapa siguiente.\n\n' + resumenDecisiones(r, r.paso || 0), r.version_id);
        return res.json({ ok: true, estado: 'abierta', etapa: r.paso, paso: r.paso, espera: 'arbitro', mensaje: 'No hay acuerdo: decide ' + FL.describe(etDef.arbitro || [{ tipo: 'rol', valor: 'gestor' }]) + '.' });
      }
      if (dev && b.notificar !== false) avisaRevision(req.pid, u, otros.flatMap(x => x.pendientes), 'Revisión ' + ref + ': ' + paso.nombre + ' quiere rechazar por calidad', paso.nombre + ' terminó su revisión de calidad y quiere RECHAZAR el documento (' + estadoTxt + ').\n\nSus observaciones:\n' + (comentario || '(sin comentario; revisa las incidencias del documento)') + '\n\nCuando termines tu revisión se enviarán al contratista los comentarios e incidencias de ambos. Si prefieres que el rechazo proceda solo con esta revisión, abre la revisión y elige «Proceder con el rechazo del otro revisor». Si no terminas antes del ' + String(r.vence || '').slice(0, 10) + ', se trasladarán directamente estas observaciones.', r.version_id);
      return res.json({ ok: true, estado: 'abierta', etapa: r.paso, paso: r.paso, espera: 'otro-revisor', notificado: !!(dev && b.notificar !== false), pendientes: otros.filter(x => !x.completo).map(x => x.nombre) });
    }
    if (dev) { audita(u.email, 'revision.devolver', req.pid, c.nombre, { ronda: r.ronda, paso: paso.nombre }); return res.json(cierraDevuelta(p, u, r, c, fl, paso.nombre, comentario)); }
    const est = FL.estadoEtapa(fl, r, miembros);
    if (!est.completa) { guarda(); audita(u.email, 'revision.paso', req.pid, c.nombre, { ronda: r.ronda, paso: paso.nombre, etapa: r.paso }); return res.json({ ok: true, estado: 'abierta', etapa: r.paso, paso: r.paso, pendientes: est.pasos.filter(x => !x.completo).map(x => x.nombre) }); }
    res.json(avanzaOAprueba(p, u, r, c, fl, b, comentario));
  });
  // ───────── Revision ↔ correspondencia: cada revision puede llevar una linea de comunicacion (el correo que la envia y sus respuestas)
  const CORR = () => require('./correspondencia').interno || null;
  const escH = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  /** Quien firma las respuestas del Gerente de Proyecto: el arbitro de la primera etapa o el aprobador final; si nadie tiene ese cargo, quien actua. */
  function autorGP(p, fl, u) {
    const mm = miembrosDe(p.id), ult = fl.etapas[fl.etapas.length - 1], quien = fl.etapas[0].arbitro && fl.etapas[0].arbitro.length ? fl.etapas[0].arbitro : ult.pasos[0].revisores;
    const e = FL.candidatos({ revisores: quien }, mm)[0], m = e && mm.find(x => x.email === e);
    return m ? { email: m.email, organizacion: m.organizacion || '' } : { email: u.email, organizacion: u.organizacion || '' };
  }
  /** Destinatarios por defecto del envio a revision: los revisores del flujo (personas; si nadie tiene el cargo, sus organizaciones). */
  function destinatariosFlujo(p, fl, u) {
    const mm = miembrosDe(p.id), emails = [...new Set(fl.etapas.flatMap(e => e.pasos.flatMap(x => FL.candidatos(x, mm)).concat(e.arbitro ? FL.candidatos({ revisores: e.arbitro }, mm) : [])))].filter(e => e !== u.email);
    if (emails.length) return emails.map(e => ({ email: e, org: (mm.find(m => m.email === e) || {}).organizacion || '' }));
    const orgs = [...new Set(fl.etapas.flatMap(e => e.pasos.flatMap(x => (x.revisores || []).map(rv => rv.tipo === 'org' ? rv.valor : rv.org || ''))))].filter(Boolean);
    return orgs.length ? orgs.map(o => ({ email: '', org: o })) : [{ email: u.email, org: u.organizacion || '' }];
  }
  /** Reporte de incidencias del documento (HTML imprimible) guardado como adjunto de correo. Devuelve el adjunto o null. */
  function reporteIncidencias(p, c, r, fl, titulo) {
    try {
      const inc = q.todos('SELECT * FROM incidencias WHERE proyecto_id = ? AND contenedor_id = ? ORDER BY numero', p.id, c.id), ab = inc.filter(i => !['cerrada', 'rechazada'].includes(i.estado)).length;
      const fila = (i) => '<tr><td>INC-' + escH(p.codigo) + '-' + String(i.numero).padStart(4, '0') + '</td><td><b>' + escH(i.titulo) + '</b>' + (i.descripcion ? '<br>' + escH(i.descripcion) : '') + '</td><td>' + escH(i.tipo) + '</td><td>' + escH(i.prioridad) + '</td><td>' + escH(i.estado) + '</td><td>' + escH(i.autor) + '</td><td>' + escH(i.asignado || '—') + '</td><td>' + escH(String(i.inicio || i.creado || '').slice(0, 10)) + '</td><td>' + escH(i.entregable || '—') + '</td></tr>';
      const dec = (r.pasos || []).filter(x => !x.nota).map(x => '<tr><td>' + ((x.etapa || 0) + 1) + '</td><td>' + escH(x.nombre) + '</td><td>' + escH(x.etiqueta || x.decision) + '</td><td>' + escH(x.por) + '</td><td>' + escH(String(x.fecha || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + escH(x.comentario || '') + '</td></tr>').join('');
      const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de incidencias · ' + escH(c.nombre) + '</title><style>body{font:13px/1.45 Arial,Helvetica,sans-serif;margin:28px;color:#1b1f24}h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd4da;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eef1f4}.m{color:#5b6570}.k td:first-child{width:210px;background:#f6f7f9;font-weight:bold}</style></head><body>' +
        '<h1>Reporte de incidencias</h1><div class="m">' + escH(p.codigo) + ' · ' + escH(p.nombre) + '</div>' +
        '<h2>Documento y revisión</h2><table class="k"><tr><td>Documento</td><td>' + escH(c.nombre) + '</td></tr><tr><td>Carpeta</td><td>' + escH(c.carpeta) + '</td></tr><tr><td>Revisión</td><td>#' + r.numero + ' · ronda ' + r.ronda + ' · ' + escH(fl.nombre) + '</td></tr><tr><td>Estado</td><td>' + escH(titulo) + '</td></tr><tr><td>Iniciada por</td><td>' + escH(r.solicitada_por) + '</td></tr><tr><td>Emitido</td><td>' + escH(ahora().slice(0, 16).replace('T', ' ')) + ' UTC</td></tr><tr><td>Incidencias</td><td>' + inc.length + ' en total · ' + ab + ' abiertas</td></tr></table>' +
        '<h2>Incidencias del documento (' + inc.length + ')</h2>' + (inc.length ? '<table><tr><th>N.º</th><th>Título y descripción</th><th>Tipo</th><th>Prioridad</th><th>Estado</th><th>Autor</th><th>Asignado a</th><th>Inicio</th><th>N.º entregable</th></tr>' + inc.map(fila).join('') + '</table>' : '<p>El documento no tiene incidencias registradas.</p>') +
        '<h2>Respuestas de la revisión</h2>' + (dec ? '<table><tr><th>Paso</th><th>Equipo</th><th>Respuesta</th><th>Por</th><th>Fecha</th><th>Comentario</th></tr>' + dec + '</table>' : '<p>Sin respuestas registradas.</p>') + '</body></html>';
      const aid = id('a'), buf = Buffer.from(html, 'utf8'), nombre = 'Reporte-incidencias-REV' + String(r.numero).padStart(4, '0') + '-R' + r.ronda + '.html';
      const dir = almacen.carpeta(p.id, 'correos', 'rev-' + r.id + '-' + aid), destino = require('path').join(dir, nombre); require('fs').writeFileSync(destino, buf);
      return { tipo: 'archivo', id: aid, nombre, tamano: buf.length, ruta: require('path').relative(almacen.raiz, destino).split(require('path').sep).join('/'), sha256: require('crypto').createHash('sha256').update(buf).digest('hex'), incidencias: inc.length, abiertas: ab };
    } catch (e) { console.warn('[reporte de incidencias]', e.message); return null; }
  }
  /** Escribe en la linea de correspondencia de la revision (o la abre, con o.nuevo). Devuelve { id, numero } o null. */
  function correoRevision(p, autor, r, c, o) {
    try {
      const K = CORR(); if (!K || (!r.correo_id && !o.nuevo)) return null;
      const t = K.tipoDe(p, o.tipo) || K.tipoDe(p, 'notificacion') || K.tipoDe(p, 'retroalimentacion');
      const rr = K.respondeEnLinea(p, autor, { correoOrigen: r.correo_id || '', registroTipo: 'revision', registroId: c.id, tipo: t, asunto: o.asunto, cuerpo: o.cuerpo, para: o.para, campos: {} });
      if (o.adjuntos && o.adjuntos.length) q.corre('UPDATE correos SET adjuntos = ? WHERE id = ?', JSON.stringify(o.adjuntos.filter(Boolean)), rr.id);
      audita(autor.email, 'revision.correspondencia', p.id, c.nombre, { numero: rr.numero, asunto: o.asunto });
      return rr;
    } catch (e) { console.warn('[correspondencia de la revision]', e.message); return null; }
  }
  const GRUPOS = ['cliente-equipo', 'cliente-transversal', 'cliente-otras', 'contratista', 'subcontratista', 'supervision', 'externo'];
  const SISTEMA = { email: 'sistema', rol: 'administrador', organizacion: 'CDE', admin: true };
  const flujoNuevo = (fl) => fl.etapas.some(e => e.modo === 'consenso' || e.pasos.some(x => x.recomienda));
  /** Las decisiones de una etapa, en texto (para los avisos). */
  function resumenDecisiones(r, etapa) {
    const L = r.pasos.filter(x => etapa === undefined || x.etapa === etapa).map(x => '· ' + x.nombre + ' — ' + (x.etiqueta || x.decision) + (x.clase === 'revision' ? ' (revisión del especialista)' : x.clase === 'recomendacion' ? ' (recomendación)' : x.clase === 'decision-equipo' ? ' (decisión del equipo)' : x.clase === 'adhesion' ? ' (se adhiere)' : x.clase === 'arbitraje' ? ' (decisión del conflicto)' : x.clase === 'auto' ? ' (automático por plazo)' : '') + ' — ' + x.por + (x.comentario ? ': ' + x.comentario : ''));
    return L.length ? L.join('\n') : '(sin decisiones registradas)';
  }
  /** Aviso de una revision: un correo de tipo «notificacion» (REV-000001) en el buzon de cada destinatario, con la version adjunta. */
  function avisaRevision(pid, u, paraEmails, asunto, cuerpo, vid) {
    try {
      const para = [...new Set((paraEmails || []).filter(e => e && e !== u.email))]; if (!para.length) return '';
      const mid = id('m'), fecha = ahora(), dest = para.map(e => ({ email: e, org: '' }));   /* aviso personal: no a toda la organizacion */
      const numero = 'REV-' + String((q.uno("SELECT COUNT(*) AS n FROM correos WHERE proyecto_id = ? AND numero LIKE 'REV-%'", pid).n || 0) + 1).padStart(6, '0');
      q.corre('INSERT INTO correos (id, proyecto_id, numero, tipo, asunto, cuerpo, de_email, de_org, para, cc, respuesta, vence, estado, hilo_id, responde_a, adjuntos, campos, creado, enviado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        mid, pid, numero, 'notificacion', String(asunto).slice(0, 300), String(cuerpo).slice(0, 20000), u.email, u.organizacion || '', JSON.stringify(dest), '[]', 'ninguna', '', 'enviado', mid, '', JSON.stringify(vid ? [{ tipo: 'version', id: vid }] : []), '{}', fecha, fecha, fecha);
      return numero;
    } catch (e) { console.warn('[aviso de revision]', e.message); return ''; }
  }
  /** Cierra la ronda como devuelta / rechazada: el contenedor vuelve a WIP y (en los flujos en paralelo) se avisa al iniciador con los comentarios de todos. */
  function cierraDevuelta(p, u, r, c, fl, motivo, comentario) {
    const fecha = ahora();
    q.corre('UPDATE revisiones SET estado = ?, revisor = ?, cerrada = ?, comentario = ?, pasos = ? WHERE id = ?', 'devuelta', u.email, fecha, String(comentario || '').slice(0, 4000), JSON.stringify(r.pasos), r.id);
    const t = transita(p, u, c, 'WIP', { porFlujo: true, comentario: 'Devuelto en la ronda ' + r.ronda + ' (' + motivo + ')', por: u.email });
    audita(u.email, 'revision.devolver', p.id, c.nombre, { ronda: r.ronda, motivo });
    if (r.correo_id) { const etD = fl.etapas[r.paso || 0] || {}, qa = etD.modo === 'consenso', et = qa ? ((etD.etiquetas || {}).devuelta || 'Rechazado') : (((fl.estados || []).find(x => x.id === 'devuelta') || {}).etiqueta || 'Rechazado'), rep = reporteIncidencias(p, c, r, fl, et);
      correoRevision(p, qa ? autorGP(p, fl, u) : u, r, c, { tipo: 'notificacion', adjuntos: [{ tipo: 'version', id: r.version_id }, rep], asunto: 'Revisión #' + r.numero + ' · ' + c.nombre + ' — ' + (qa ? et : 'estado de revisión: ' + et.toUpperCase()),
        cuerpo: (qa ? 'Validación de calidad: ' + et + '.\n\nEl documento ' + c.nombre + ' no superó «' + etD.nombre + '» y vuelve al iniciador.' : 'Estado de revisión de los documentos:\n· ' + c.nombre + ' — ' + et.toUpperCase()) + '\nMotivo: ' + motivo + '.' + (comentario ? '\n\nNotas:\n' + comentario : '') + '\n\nRespuestas de la revisión:\n' + resumenDecisiones(r) + '\n\nSe adjunta el reporte de incidencias del documento' + (rep ? ' (' + rep.incidencias + ' incidencias, ' + rep.abiertas + ' abiertas).' : '.') + '\nCorrige el documento, carga la versión nueva e inicia la ronda ' + (r.ronda + 1) + ': el levantamiento de observaciones se enviará por esta misma línea de correspondencia.' }); }
    if (flujoNuevo(fl)) { const nInc = q.uno("SELECT COUNT(*) AS n FROM incidencias WHERE proyecto_id = ? AND contenedor_id = ? AND estado <> 'cerrada'", p.id, c.id).n; avisaRevision(p.id, u, [r.solicitada_por], 'Revisión #' + r.numero + ' · ' + c.nombre + ': RECHAZADO (' + motivo + ')', 'El documento ' + c.nombre + ' fue rechazado en la revisión #' + r.numero + ' (' + fl.nombre + ').\nMotivo: ' + motivo + '.\n\nComentarios de los revisores:\n' + resumenDecisiones(r) + '\n\nIncidencias abiertas sobre el documento: ' + nInc + ' (módulo Incidencias).\nCorrige, carga una versión nueva y vuelve a enviarlo a revisión.', r.version_id); }
    return { ok: true, estado: 'devuelta', motivo, contenedor: t };
  }
  /** La etapa actual quedo completa: pasa a la siguiente o, si era la ultima, aprueba (publica, copia, actualiza atributos). */
  function avanzaOAprueba(p, u, r, c, fl, b, comentario) {
    b = b || {}; const fecha = ahora(), siguiente = (r.paso || 0) + 1;
    if (siguiente < fl.etapas.length) {
      const vence = FL.venceEtapa(fl.etapas[siguiente], fecha), de = fl.etapas[r.paso || 0];
      q.corre('UPDATE revisiones SET paso = ?, pasos = ?, comentario = ?, vence = ? WHERE id = ?', siguiente, JSON.stringify(r.pasos), String(comentario || ''), vence, r.id);
      audita(u.email, 'revision.etapa', p.id, c.nombre, { ronda: r.ronda, de: de.nombre, a: fl.etapas[siguiente].nombre });
      if (flujoNuevo(fl)) { const mm = miembrosDe(p.id); avisaRevision(p.id, u, fl.etapas[siguiente].pasos.flatMap(x => FL.candidatos(x, mm)), 'Revisión #' + r.numero + ' · ' + c.nombre + ': te toca revisar (' + fl.etapas[siguiente].nombre + ')', 'El documento ' + c.nombre + ' pasó a «' + fl.etapas[siguiente].nombre + '»' + (vence ? ' (plazo: ' + vence.slice(0, 10) + ')' : '') + '.\n\nLo decidido en «' + de.nombre + '»:\n' + resumenDecisiones(r, r.paso || 0), r.version_id); }
      // QA Accepted: el Gerente de Proyecto responde la correspondencia de la revision con la validacion de calidad
      if (r.correo_id && de.modo === 'consenso') { const et = (de.etiquetas || {}).aprobada || 'Aceptado';
        correoRevision(p, autorGP(p, fl, u), r, c, { tipo: 'notificacion', asunto: 'Revisión #' + r.numero + ' · ' + c.nombre + ' — ' + et, cuerpo: 'Validación de calidad: ' + et + '.\n\nEl documento ' + c.nombre + ' superó «' + de.nombre + '» y pasa a «' + fl.etapas[siguiente].nombre + '»' + (vence ? ' (plazo: ' + vence.slice(0, 10) + ')' : '') + '.\n\nRespuestas de la etapa:\n' + resumenDecisiones(r, r.paso || 0) }); }
      return { ok: true, estado: 'abierta', etapa: siguiente, paso: siguiente, siguiente: fl.etapas[siguiente].nombre, vence };
    }
    const idon = String(b.idoneidad || fl.alAprobar.idoneidad || '').toUpperCase(), algunoConCom = r.pasos.some(x => x.decision === 'aprobada-con-comentarios');
    q.corre('UPDATE revisiones SET estado = ?, revisor = ?, cerrada = ?, comentario = ?, pasos = ?, paso = ?, idoneidad = ? WHERE id = ?', algunoConCom ? 'aprobada-con-comentarios' : 'aprobada', u.email, fecha, String(comentario || ''), JSON.stringify(r.pasos), siguiente, idon, r.id);
    let t = null;
    if (fl.alAprobar.estado === 'PUBLICADO' && c.estado !== 'PUBLICADO') t = transita(p, u, c, 'PUBLICADO', { porFlujo: true, idoneidad: idon, copiarA: r.destino || fl.alAprobar.copiarA, comentario: 'Aprobado en la ronda ' + r.ronda + ' (' + fl.nombre + ')', por: u.email });
    else if (idon) { const v = q.uno('SELECT id FROM versiones WHERE contenedor_id = ? ORDER BY n DESC LIMIT 1', c.id); q.corre('UPDATE versiones SET idoneidad = ? WHERE id = ?', idon, v.id); }
    // "Actualizar atributos al cerrar" (Forma): lo que el flujo o la revision pidan cambiar en los atributos personalizados del archivo
    const attrs = Object.assign({}, fl.alAprobar.actualizarAtributos || {}, (b.atributos && typeof b.atributos === 'object' && (fl.alAprobar.revisoresEditanAtributos || fl.alAprobar.aprobadoresPuedenCambiar)) ? b.atributos : {}), reglas = fl.alAprobar.atributosReglas || {};
    const act = json(c.atributos, {});
    for (const [k, rg] of Object.entries(reglas)) { if (rg.incremento) { const cur = String(attrs[k] !== undefined ? attrs[k] : (act[k] || '')), m = /^(.*?)(\d+)$/.exec(cur); attrs[k] = m ? m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0') : (cur ? cur + '1' : '1'); } }
    if (Object.keys(attrs).length) { Object.assign(act, attrs); q.corre('UPDATE contenedores SET atributos = ?, actualizado = ? WHERE id = ?', JSON.stringify(act), fecha, c.id); }
    audita(u.email, 'revision.aprobar', p.id, c.nombre, { ronda: r.ronda, destino: fl.alAprobar.estado, copia: t && t.carpeta_publicada });
    if (r.correo_id) { const etF = ((fl.estados || []).find(x => x.id === (algunoConCom ? 'aprobada-con-comentarios' : 'aprobada')) || {}).etiqueta || 'Aceptado', rep = reporteIncidencias(p, c, r, fl, etF);
      correoRevision(p, u, r, c, { tipo: 'notificacion', adjuntos: [{ tipo: 'version', id: r.version_id }, rep], asunto: 'Revisión #' + r.numero + ' · ' + c.nombre + ' — estado de revisión: ' + etF.toUpperCase(),
        cuerpo: 'Estado de revisión de los documentos:\n· ' + c.nombre + ' — ' + etF.toUpperCase() + (idon ? ' (código de estado ' + idon + ')' : '') + '\n\nFlujo: ' + fl.nombre + ' · ronda ' + r.ronda + '.' + (comentario ? '\n\nNotas del Gerente de Proyecto:\n' + comentario : '') + '\n\nRespuestas de la revisión:\n' + resumenDecisiones(r) + '\n\nSe adjunta el reporte de incidencias del documento' + (rep ? ' (' + rep.incidencias + ' incidencias, ' + rep.abiertas + ' abiertas).' : '.') }); }
    if (flujoNuevo(fl)) avisaRevision(p.id, u, [r.solicitada_por], 'Revisión #' + r.numero + ' · ' + c.nombre + ': ACEPTADO', 'El documento ' + c.nombre + ' fue aceptado en la revisión #' + r.numero + ' (' + fl.nombre + ').\n\nDecisiones:\n' + resumenDecisiones(r), r.version_id);
    return { ok: true, estado: algunoConCom ? 'aprobada-con-comentarios' : 'aprobada', contenedor: t };
  }
  /**
   * PLAZOS: las etapas con alVencer = 'avanzar' (la revision de calidad de los Document Control, 2 dias) no se quedan esperando.
   * Vencido el plazo: si un revisor rechazo y el otro no termino, se rechaza con las observaciones del primero; si nadie rechazo,
   * la ronda pasa sola a la etapa siguiente como aceptada por todos. Un conflicto pendiente del arbitro no vence solo.
   * Se llama al listar las revisiones y cada pocos minutos.
   */
  function procesaVencidas(pid) {
    let n = 0;
    try {
      const filas = q.todos("SELECT r.*, c.proyecto_id AS pid FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE r.estado = 'abierta' AND r.vence <> '' AND r.vence < ?" + (pid ? ' AND c.proyecto_id = ?' : ''), ...(pid ? [ahora(), pid] : [ahora()]));
      for (const f of filas) {
        const r = abreJson(f, ['pasos', 'flujo_def']), p = proyecto(f.pid); if (!p) continue;
        const fl = r.flujo_def && r.flujo_def.etapas ? r.flujo_def : flujoDe(p, r.flujo_id), et = fl && fl.etapas[r.paso || 0]; if (!et || et.alVencer !== 'avanzar') continue;
        const c = q.uno('SELECT * FROM contenedores WHERE id = ?', r.contenedor_id), est = FL.estadoEtapa(fl, r, miembrosDe(f.pid)); if (!c || est.consenso === 'conflicto') continue;
        const rech = est.pasos.filter(x => x.resultado === 'devuelta');
        if (rech.length) cierraDevuelta(p, SISTEMA, r, c, fl, 'venció el plazo de «' + et.nombre + '»: se trasladan las observaciones de ' + rech.map(x => x.nombre).join(' y '), 'Venció el plazo sin la revisión de ' + est.pasos.filter(x => !x.completo).map(x => x.nombre).join(' y ') + '.');
        else {
          for (const x of est.pasos.filter(y => !y.completo)) r.pasos.push({ etapa: r.paso || 0, paso: x.id, nombre: x.nombre, decision: 'aprobada', estado: 'aprobada', etiqueta: (et.etiquetas && et.etiquetas.aprobada) || 'Aprobado', opcional: false, clase: 'auto', por: 'sistema', fecha: ahora(), comentario: 'Venció el plazo de revisión (' + String(r.vence).slice(0, 10) + ') sin rechazo: pasa automáticamente.' });
          avanzaOAprueba(p, SISTEMA, r, c, fl, {}, 'Venció el plazo de «' + et.nombre + '»: pasa a la etapa siguiente.');
        }
        n++;
      }
    } catch (e) { console.warn('[plazos de revision]', e.message); }
    return n;
  }
  const relojPlazos = setInterval(() => procesaVencidas(), 5 * 60 * 1000); if (relojPlazos.unref) relojPlazos.unref();
  app.post('/api/proyectos/:pid/revisiones/:rid/anular', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const p = proyecto(req.pid), u = yo(req, p);
    const r = q.uno('SELECT r.* FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE r.id = ? AND c.proyecto_id = ?', req.params.rid, req.pid); if (!r || r.estado !== 'abierta') return res.status(404).json({ error: 'no-existe' });
    if (!(u.admin || u.rol === 'gestor' || u.rol === 'administrador' || r.solicitada_por === u.email)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Anula la ronda quien la inicio o el gestor.' });
    q.corre("UPDATE revisiones SET estado = 'anulada', revisor = ?, cerrada = ?, comentario = ? WHERE id = ?", u.email, ahora(), String((req.body || {}).comentario || '').slice(0, 2000), r.id);
    audita(u.email, 'revision.anular', req.pid, r.contenedor_id, { ronda: r.ronda }); res.json({ ok: true });
  });
  app.post('/api/proyectos/:pid/revisiones/:rid/cerrar', (req, res, next) => { req.url = '/api/proyectos/' + req.params.pid + '/revisiones/' + req.params.rid + '/decidir'; app.handle(req, res, next); });
  app.get('/api/proyectos/:pid/revisiones', requiereSesion, requiereRol('lector'), (req, res) => {
    procesaVencidas(req.pid);
    const p = proyecto(req.pid), u = yo(req, p), miembros = miembrosDe(req.pid);
    const lista = q.todos("SELECT r.*, c.nombre AS contenedor, c.carpeta, c.estado AS estado_contenedor FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ? AND c.borrado = '' ORDER BY r.abierta DESC LIMIT 1000", req.pid).map(r => abreJson(r, ['pasos', 'flujo_def'])).map(r => decoraRevision(p, u, r, miembros));
    for (const r of lista) { r.flujoNombre = r.flujo ? r.flujo.nombre : ''; r.etapaNombre = r.etapaActual ? r.etapaActual.nombre : ''; }
    res.json({ revisiones: lista });
  });

  // ---------- incidencias ----------
  /** Dia (AAAA-MM-DD) en la hora de este servidor, no en UTC. */
  const diaLocal = (iso) => { const d = new Date(iso || Date.now()); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const normInc = (i) => { if (!i) return i; i.estado = ESTADO_LEGADO[i.estado] || i.estado; if (!i.inicio) i.inicio = diaLocal(i.creado); /* por defecto, la fecha de inicio es la de creacion */ if (!i.contenedor_id && i.version_id) { const v = q.uno('SELECT contenedor_id FROM versiones WHERE id = ?', i.version_id); if (v) i.contenedor_id = v.contenedor_id; } return i; };
  app.get('/api/proyectos/:pid/incidencias', requiereSesion, requiereRol('lector'), (req, res) => {
    const f = req.query || {}, w = ['proyecto_id = ?', f.suprimidas === '1' ? "borrado <> ''" : "borrado = ''"], a = [req.pid];
    for (const k of ['estado', 'disciplina', 'etapa', 'tipo', 'prioridad', 'responsable_org', 'asignado', 'contenedor_id', 'version_id', 'autor', 'tipo_revision', 'entregable']) if (f[k]) { w.push(k + ' = ?'); a.push(String(f[k])); }
    if (f.vence_desde) { w.push('vencimiento >= ?'); a.push(String(f.vence_desde)); } if (f.vence_hasta) { w.push("vencimiento <> '' AND vencimiento <= ?"); a.push(String(f.vence_hasta)); }
    if (f.contractual === '1') w.push('contractual = 1');
    if (f.q) { w.push('(titulo LIKE ? OR descripcion LIKE ? OR codigo LIKE ?)'); a.push('%' + f.q + '%', '%' + f.q + '%', '%' + f.q + '%'); }
    const lista = q.todos('SELECT * FROM incidencias WHERE ' + w.join(' AND ') + ' ORDER BY numero DESC LIMIT 5000', ...a).map(i => normInc(abreJson(i, ['elementos', 'camara', 'impacto', 'posicion'])));
    const hoy = Date.now();
    for (const i of lista) { i.antiguedad_dias = Math.floor((hoy - Date.parse(i.creado)) / 86400000); i.vencida = !!(i.vencimiento && !['cerrada', 'rechazada'].includes(i.estado) && Date.parse(i.vencimiento) < hoy); }
    if (f.detalle === '1') {   // para tableros y exportaciones: el documento, su carpeta y la revision de cada incidencia
      const C = new Map(q.todos('SELECT id, nombre, carpeta FROM contenedores WHERE proyecto_id = ?', req.pid).map(c => [c.id, c]));
      const RV = new Map(q.todos('SELECT r.id, r.numero, r.nombre FROM revisiones r JOIN contenedores c ON c.id = r.contenedor_id WHERE c.proyecto_id = ?', req.pid).map(r => [r.id, r]));
      for (const i of lista) { const c = C.get(i.contenedor_id), r = RV.get(i.revision_id); i.documento = c ? c.nombre : ''; i.carpeta = c ? c.carpeta : ''; i.revision_numero = r ? r.numero : 0; }
    }
    res.json({ incidencias: lista, catalogos: { estados: ESTADOS_INC, tipos: TIPOS_INC, impactos: IMPACTOS, origenes: ORIGENES } });
  });
  app.post('/api/proyectos/:pid/incidencias', conLlaveOSesion('autor'), J, (req, res) => {
    const b = req.body || {}, pid = String(req.params.pid), p = proyecto(pid);
    if (!p) return res.status(404).json({ error: 'no-existe' });
    const titulo = String(b.titulo || '').trim().slice(0, 300); if (!titulo) return res.status(400).json({ error: 'datos', mensaje: 'Falta el titulo.' });
    const numero = (q.uno('SELECT MAX(numero) AS m FROM incidencias WHERE proyecto_id = ?', pid).m || 0) + 1, iid = id('i');
    const codigo = 'INC-' + p.codigo + '-' + String(numero).padStart(4, '0');
    let nivel = String(b.nivel || ''), contenedor_id = String(b.contenedor_id || ''), version_id = String(b.version_id || '');
    if (version_id && !contenedor_id) { const v = q.uno('SELECT contenedor_id FROM versiones WHERE id = ?', version_id); if (v) contenedor_id = v.contenedor_id; }
    const u = req.llave ? { organizacion: String(req.query.organizacion || 'CONTRATISTA') } : yo(req, p);
    const impacto = Array.isArray(b.impacto) ? b.impacto.filter(x => IMPACTOS.includes(x)) : [];
    const tipo = TIPOS_INC.includes(b.tipo) ? b.tipo : 'observacion', origen = ORIGENES.includes(b.origen) ? b.origen : (req.llave ? 'auditoria-modelo' : 'revision-documentaria');
    q.corre('INSERT INTO incidencias (id, proyecto_id, numero, codigo, titulo, descripcion, estado, tipo, prioridad, contractual, autor, asignado, creado, vencimiento, contenedor_id, version_id, elementos, camara, captura, disciplina, etapa, nivel, ambiente, impacto, origen, responsable_org, referencia, revision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      iid, pid, numero, codigo, titulo, String(b.descripcion || '').slice(0, 8000), 'abierta', tipo, String(b.prioridad || 'media').slice(0, 20), b.contractual ? 1 : 0,
      req.quien, String(b.asignado || '').toLowerCase(), ahora(), String(b.vencimiento || ''), contenedor_id, version_id, JSON.stringify(Array.isArray(b.elementos) ? b.elementos.slice(0, 500) : []), JSON.stringify(b.camara || {}), '',
      String(b.disciplina || '').slice(0, 120), String(b.etapa || '').slice(0, 60), nivel.slice(0, 80), String(b.ambiente || '').slice(0, 120), JSON.stringify(impacto), origen, String(b.responsable_org || '').toUpperCase().slice(0, 40), String(b.referencia || '').slice(0, 300), String(b.revision_id || ''));
    if (b.posicion && typeof b.posicion === 'object') q.corre('UPDATE incidencias SET posicion = ? WHERE id = ?', JSON.stringify({ version_id: String(b.posicion.version_id || version_id), pagina: Math.max(0, parseInt(b.posicion.pagina, 10) || 0), x: Math.min(1, Math.max(0, +b.posicion.x || 0)), y: Math.min(1, Math.max(0, +b.posicion.y || 0)) }), iid);
    q.corre('UPDATE incidencias SET inicio = ?, tipo_revision = ?, entregable = ? WHERE id = ?', /^\d{4}-\d{2}-\d{2}$/.test(String(b.inicio || '')) ? String(b.inicio) : diaLocal(), String(b.tipo_revision || '').slice(0, 80), String(b.entregable || '').slice(0, 120), iid);
    if (b.descripcion || b.comentario) q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', iid, req.quien, ahora(), 'Creada' + (u.organizacion ? ' por ' + u.organizacion : ''), 'abierta');
    audita(req.quien, 'incidencia.crear', pid, codigo, { titulo, tipo, disciplina: b.disciplina, etapa: b.etapa }); res.json({ ok: true, id: iid, numero, codigo });
  });
  app.post('/api/proyectos/:pid/incidencias/:iid/comentar', requiereSesion, requiereRol('autor'), J, (req, res) => {
    const i = q.uno('SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ?', req.params.iid, req.pid); if (!i) return res.status(404).json({ error: 'no-existe' });
    const b = req.body || {}, texto = String(b.texto || '').slice(0, 8000); let estado = String(b.estado || ''); estado = ESTADO_LEGADO[estado] || estado;
    const cambios = {}; for (const k of ['asignado', 'vencimiento', 'prioridad', 'responsable_org', 'disciplina', 'etapa', 'nivel', 'ambiente', 'referencia', 'tipo_revision', 'entregable']) if (b[k] !== undefined) cambios[k] = String(b[k]).slice(0, 120);
    if (Array.isArray(b.impacto)) cambios.impacto = JSON.stringify(b.impacto.filter(x => IMPACTOS.includes(x)));
    if (!texto && !estado && !Object.keys(cambios).length) return res.status(400).json({ error: 'datos' });
    const R = ISO.RANGO_ROL;
    if (estado) {
      if (!ESTADOS_INC.includes(estado)) return res.status(400).json({ error: 'estado', mensaje: 'Estado no valido (' + ESTADOS_INC.join(', ') + ').' });
      if (['cerrada', 'rechazada', 'verificada'].includes(estado) && !(req.quien === i.autor || R[req.rol] >= R.revisor)) return res.status(403).json({ error: 'sin-permiso', mensaje: 'Solo el autor o un revisor verifica, cierra o rechaza la incidencia.' });
      cambios.estado = estado; if (estado === 'cerrada' || estado === 'rechazada') cambios.cerrado = ahora(); if (estado === 'respondida') cambios.respondido = ahora(); if (estado === 'verificada') cambios.verificado_por = req.quien;
    }
    if (Object.keys(cambios).length) q.corre('UPDATE incidencias SET ' + Object.keys(cambios).map(k => k + ' = ?').join(', ') + ' WHERE id = ?', ...Object.values(cambios), i.id);
    q.corre('INSERT INTO comentarios (incidencia_id, autor, fecha, texto, estado_nuevo) VALUES (?,?,?,?,?)', i.id, req.quien, ahora(), texto || (Object.keys(cambios).filter(k => k !== 'estado').length ? 'Actualizo ' + Object.keys(cambios).filter(k => k !== 'estado').join(', ') : ''), estado);
    audita(req.quien, 'incidencia.comentar', req.pid, i.codigo || ('#' + i.numero), { estado, cambios: Object.keys(cambios) }); res.json({ ok: true });
  });
  app.get('/api/proyectos/:pid/incidencias/:iid', requiereSesion, requiereRol('lector'), (req, res) => {
    const i = normInc(abreJson(q.uno('SELECT * FROM incidencias WHERE id = ? AND proyecto_id = ?', req.params.iid, req.pid), ['elementos', 'camara', 'impacto', 'posicion'])); if (!i) return res.status(404).json({ error: 'no-existe' });
    i.comentarios = q.todos('SELECT * FROM comentarios WHERE incidencia_id = ? ORDER BY id', i.id);
    if (i.contenedor_id) { const c = q.uno('SELECT nombre, carpeta, estado FROM contenedores WHERE id = ?', i.contenedor_id); i.contenedor = c || null; }
    if (i.version_id) { const v = q.uno('SELECT n, revision, archivo FROM versiones WHERE id = ?', i.version_id), ix = q.uno('SELECT estado, ruta_geometria FROM indices_modelo WHERE version_id = ?', i.version_id); i.version = v || null; i.modelo_visible = !!(ix && ix.estado === 'listo' && ix.ruta_geometria); }
    res.json(i);
  });
  app.get('/api/proyectos/:pid/incidencias.bcfzip', requiereSesion, requiereRol('lector'), (req, res) => {
    const p = q.uno('SELECT codigo, nombre FROM proyectos WHERE id = ?', req.pid);
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    const lista = (ids.length ? q.todos('SELECT * FROM incidencias WHERE proyecto_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')', req.pid, ...ids) : q.todos('SELECT * FROM incidencias WHERE proyecto_id = ? ORDER BY numero', req.pid)).map(i => normInc(abreJson(i, ['elementos', 'camara', 'impacto'])));
    for (const i of lista) { i.comentarios = q.todos('SELECT * FROM comentarios WHERE incidencia_id = ? ORDER BY id', i.id); if (i.version_id) { const v = q.uno('SELECT archivo FROM versiones WHERE id = ?', i.version_id); i.archivo = v ? v.archivo : ''; } }
    const zip = BCF.exporta(p, lista);
    audita(req.quien, 'incidencia.exportar-bcf', req.pid, '', { n: lista.length });
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="' + (p.codigo || 'incidencias') + '.bcfzip"'); res.end(zip);
  });

  // ---------- llaves de complementos ----------
  app.post('/api/proyectos/:pid/llaves', requiereSesion, requiereRol('administrador'), J, (req, res) => {
    const llave = creaLlave((req.body || {}).nombre, req.pid, req.quien); res.json({ ok: true, llave, aviso: 'Copia la llave ahora: no se vuelve a mostrar.' });
  });
  app.get('/api/proyectos/:pid/llaves', requiereSesion, requiereRol('administrador'), (req, res) => res.json({ llaves: q.todos('SELECT id, nombre, creada, por, uso, revocada FROM llaves WHERE proyecto_id = ? OR proyecto_id = \'\' ORDER BY creada DESC', req.pid) }));
  app.post('/api/proyectos/:pid/llaves/:lid/revocar', requiereSesion, requiereRol('administrador'), (req, res) => { q.corre('UPDATE llaves SET revocada = 1 WHERE id = ?', req.params.lid); audita(req.quien, 'llave.revocar', req.pid, req.params.lid, ''); res.json({ ok: true }); });

  // ---------- auditoria ----------
  app.get('/api/proyectos/:pid/auditoria', requiereSesion, requiereRol('revisor'), (req, res) => res.json({ auditoria: q.todos('SELECT * FROM auditoria WHERE proyecto_id = ? ORDER BY id DESC LIMIT ?', req.pid, Math.min(Number(req.query.n) || 300, 5000)) }));

  // ---------- complemento ----------
  app.get('/api/complemento/:pid/incidencias', requiereLlave, (req, res) => {
    const lista = q.todos("SELECT id, numero, codigo, titulo, estado, prioridad, contractual, autor, asignado, creado, version_id, elementos, camara, disciplina, nivel FROM incidencias WHERE proyecto_id = ? AND estado NOT IN ('cerrada','rechazada') ORDER BY numero DESC LIMIT 2000", req.params.pid).map(i => normInc(abreJson(i, ['elementos', 'camara'])));
    res.json({ incidencias: lista });
  });
  ctx.cdeInterno = { procesaVencidas, proyecto, yo, miembrosDe, permisoEn, flujosDe, flujoDe, decoraRevision, abreRonda, transita, guardaConfig, organizacionesDe, carpetaWipDe, trasladaRutas };
  app.get('/api/complemento/proyectos', requiereLlave, (req, res) => {
    const lista = req.llave.proyecto_id ? q.todos('SELECT id, codigo, nombre, config FROM proyectos WHERE id = ? AND activo = 1', req.llave.proyecto_id) : q.todos('SELECT id, codigo, nombre, config FROM proyectos WHERE activo = 1 ORDER BY nombre');
    res.json({ proyectos: lista.map(p => { const o = abreJson(p, ['config']); migraConfig(o.config); o.carpetas = (o.config.carpetas || []).map(c => c.ruta).filter(r => { const z = CAR.zonaDe(o.config.carpetas, r); return z !== 'publicado' && z !== 'archivo'; }); delete o.config; return o; }), llave: req.llave.nombre, servidor: ctx.nombreServidor });
  });
}

function describeQuien(paso) { if (!paso) return 'un revisor'; const q = paso.quien === 'parte-origen' ? 'la parte que presenta el contenedor' : paso.quien === '*' || !paso.quien ? 'cualquier parte' : 'la parte ' + paso.quien; return q + ' con rol ' + (paso.rol || 'revisor'); }
/** P01 < P02 < C01 < C02. */
function compRevision(a, b) { const A = ISO.RX_REVISION.exec(a) || [], B = ISO.RX_REVISION.exec(b) || []; const la = A[1] === 'C' ? 1 : 0, lb = B[1] === 'C' ? 1 : 0; return la !== lb ? la - lb : (parseInt(A[2] || '0', 10) - parseInt(B[2] || '0', 10)); }

/** La configuracion con la que nace un proyecto: nomenclatura ISO 19650 tipica de ANIN (7 campos + revision). Editable despues. */
function configPorDefecto(codigo) {
  return {
    nomenclatura: {
      separador: '-', conRevision: true,
      campos: [
        { nombre: 'Proyecto', regex: '^' + codigo.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '$' },
        { nombre: 'Originador', regex: '^[A-Z0-9]{2,6}$' },
        { nombre: 'Volumen', regex: '^[A-Z0-9]{2,4}$' },
        { nombre: 'Nivel', regex: '^[A-Z0-9]{2,4}$' },
        { nombre: 'Tipo', valores: ['M3', 'M2', 'DR', 'DM', 'RP', 'PH', 'SP', 'PL', 'CR', 'SH', 'MR', 'IE'] },
        { nombre: 'Disciplina', valores: ['A', 'S', 'E', 'M', 'P', 'C', 'G', 'T', 'Z', 'I', 'H', 'K', 'Q', 'L'] },
        { nombre: 'Numero', regex: '^[0-9]{3,6}$' }
      ]
    },
    carpetas: CAR.normaliza(['01 Arquitectura', '02 Estructuras', '03 Instalaciones', '04 Equipamiento', '05 Coordinacion', '06 Gestion'].map(r => ({ ruta: r, permisos: [{ tipo: '*', valor: '', nivel: 'ver-descargar-subir-editar' }] }))),
    disciplinas: ['Arquitectura', 'Estructuras', 'Instalaciones Sanitarias', 'Instalaciones Electricas', 'Instalaciones Mecanicas', 'TIC', 'Equipamiento', 'Seguridad y Evacuacion', 'Coordinacion BIM', 'Gestion'],
    etapas: ['P01', 'P02', 'P03', 'P04', 'SGM']
  };
}

module.exports = { monta, configPorDefecto, compRevision, ESTADOS_INC, TIPOS_INC, IMPACTOS, ORIGENES };
