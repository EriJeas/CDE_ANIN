/*
 * NUCLEO DEL PORTAL: estado compartido, enrutador por hash y el marco de pagina (panel lateral por modulos + cabecera).
 * Cada modulo (js/modulos/*.js) registra sus vistas en CDE.N.vistas y usa N.marco(...) / N.cierra() para pintarse
 * dentro del mismo marco. Orden de carga: comun.js → nucleo.js → modulos → arranque (al final de este archivo se
 * engancha el enrutador en DOMContentLoaded, cuando ya cargaron todos los modulos).
 *
 * Rutas:  #/acceso · #/ (proyectos) · #/p/<pid> (archivos) · #/p/<pid>/c/<cid> (contenedor) · #/p/<pid>/revisiones ·
 *         #/p/<pid>/correspondencia[/<mid>] · #/p/<pid>/registros · #/p/<pid>/incidencias[/<iid>] · #/p/<pid>/ajustes
 */
(function () {
  const { esc, api, fecha, tam, num, ventana, barras } = CDE;
  const N = CDE.N = {
    esc, api, fecha, tam, num, ventana, barras,
    app: document.getElementById('app'),
    YO: null,
    FILTRO: { estado: '', tipo: '', carpeta: '', q: '', sub: false },
    ABIERTAS: new Set(),
    BANDEJA: 'recibidos',
    FI: { estado: '', disciplina: '', etapa: '', tipo: '', responsable_org: '', q: '' },
    R: { lector: 0, autor: 1, miembro: 1, 'document-control': 1, revisor: 2, 'revisor-dc': 2, gestor: 3, administrador: 4 },
    ROLES_TXT: { lector: 'Lector', miembro: 'Miembro', 'document-control': 'Document Control', revisor: 'Revisor', 'revisor-dc': 'Revisor DC', gestor: 'Gestor del proyecto', administrador: 'Administrador', autor: 'Miembro' },
    NIVEL_TXT: { ver: 'Ver', 'ver-descargar': 'Ver + descargar', subir: 'Solo subir', 'ver-descargar-subir': 'Ver + descargar + subir', 'ver-descargar-subir-editar': 'Ver + descargar + subir + editar', control: 'Control de la carpeta' },
    ZONA_TXT: { '': '(sin zona)', wip: 'Trabajo en progreso (WIP)', compartido: 'Compartido', publicado: 'Publicado', archivo: 'Archivo' },
    vistas: {}
  };
  N.dia = (s) => s ? String(s).slice(0, 10) : '';
  N.estado = (e) => '<span class="estado ' + esc(e) + '">' + esc(e) + '</span>';
  N.aviso = (el, e) => { if (el) el.innerHTML = '<div class="aviso rojo">' + esc(e.message || e) + '</div>'; };

  /** Modulos del panel lateral: ruta relativa al proyecto, nombre e icono (SVG sencillo, sin librerias). */
  const ICO = {
    archivos: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    documentos: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
    revisiones: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
    incidencias: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    correspondencia: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    registros: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    visor: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    proyectos: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    salir: '<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg>'
  };
  // Identidad de la entidad en las portadas. «lema» es la frase institucional (vacía = no se muestra).
  window.CDE_PORTAL = true;   // comun.js: ventanas centradas y con fondo atenuado (el visor conserva las suyas)
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (document.body.classList.contains('cajon')) { document.body.classList.remove('cajon'); return; } const m = document.querySelector('.menuf'); if (m) { document.querySelectorAll('.menuf').forEach(x => x.remove()); return; } const vs = [...document.querySelectorAll('#ventanas .ventana')].sort((x, y) => (Number(x.style.zIndex) || 0) - (Number(y.style.zIndex) || 0)); const v = vs[vs.length - 1]; if (v && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) { const b = v.querySelector('[data-cerrar]'); if (b) b.click(); } });
  N.MARCA = { logo: 'img/anin-logo.png', entidad: 'Autoridad Nacional de Infraestructura', lema: '', sistema: 'Entorno Común de Datos' };
  N.MODULOS = [
    { r: '/inicio', nombre: 'Opciones del proyecto', ico: 'proyectos', titulo: 'Opciones del proyecto', oculto: true },
    { r: '', nombre: 'Documentos de proyecto', ico: 'archivos', titulo: 'Documentos de proyecto' },
    { r: '/documentos', nombre: 'Búsqueda de documentos', ico: 'documentos', titulo: 'Documentos de proyecto', oculto: true },   // ahora es la pestaña «Búsqueda» de Documentos de proyecto
    { r: '/revisiones', nombre: 'Revisión contractual', ico: 'revisiones', titulo: 'Revisión contractual' },
    { r: '/transmisiones', nombre: 'Avances de proyecto', ico: 'transmisiones', titulo: 'Avances de proyecto' },
    { r: '/incidencias', nombre: 'Observaciones contractuales', ico: 'incidencias', titulo: 'Observaciones contractuales' },
    { r: '/tableros', nombre: 'Tableros de control', ico: 'tableros', titulo: 'Tableros de control' },
    { r: '/contrato', nombre: 'Línea de tiempo contractual', ico: 'contrato', titulo: 'Línea de tiempo contractual' },
    { r: '/correspondencia', nombre: 'Comunicaciones contractuales', ico: 'correspondencia', titulo: 'Comunicaciones contractuales' },
    { r: '/registros', nombre: 'Alertas tempranas y Eventos compensables', ico: 'registros', titulo: 'Alertas tempranas y Eventos compensables' },
    { r: '/obra', nombre: 'Seguimiento de obra', ico: 'obra', titulo: 'Seguimiento de obra' },
    { r: '/puente', nombre: 'Integración con otros CDE', ico: 'puente', titulo: 'Integración con otros CDE' },
    { r: '/miembros', nombre: 'Usuarios de proyecto', ico: 'miembros', titulo: 'Usuarios de proyecto', abajo: true },
    { r: '/ajustes', nombre: 'Configuración', ico: 'ajustes', titulo: 'Configuración', abajo: true }
  ];
  /** Las 4 OPCIONES del proyecto (portada 2 → proyecto → opción). Cada una muestra en el lateral solo sus módulos; Usuarios de proyecto
   *  y Configuración van siempre abajo. «inicio» es el módulo que abre la opción. Un módulo que no es de ninguna (Inicio, Usuarios,
   *  Configuración) conserva la última opción usada en ese proyecto. */
  N.OPCIONES = [
    { id: 'gestion', nombre: 'Gestión documentaria de proyecto', ico: 'archivos', inicio: '', mods: ['', '/documentos', '/revisiones', '/transmisiones', '/incidencias'], visor: true,
      desc: 'Carpetas WIP, COM y PUB con su nomenclatura y metadatos, revisión contractual con rondas, avances de proyecto, observaciones contractuales y el visor GIS/BIM.' },
    { id: 'comunicaciones', nombre: 'Comunicaciones contractuales', ico: 'correspondencia', inicio: '/correspondencia', mods: ['/correspondencia', '/registros'],
      desc: 'Comunicaciones numeradas entre las partes con su línea de respuestas, y los registros NEC de alertas tempranas y eventos compensables con sus plazos.' },
    { id: 'obra', nombre: 'Seguimiento de obra e integración con otros CDE', ico: 'obra', inicio: '/obra', mods: ['/obra', '/puente'],
      desc: 'Planos, tareas, fotos y recorridos de obra, y los conectores que traen la información de Autodesk Forma, Aconex, OneDrive y SharePoint.' },
    { id: 'tableros', nombre: 'Tableros de control', ico: 'tableros', inicio: '/tableros', mods: ['/tableros', '/contrato'],
      desc: 'Tableros de las incidencias por disciplina, carpeta y documento, y la línea de tiempo contractual con las entregas estimadas del contratista.' }
  ];
  const memOp = (pid, id) => { try { if (id) localStorage.setItem('cde.opcion.' + pid, id); return localStorage.getItem('cde.opcion.' + pid) || ''; } catch (e) { return id || ''; } };
  /** Opción a la que pertenece un módulo (y se recuerda como la última del proyecto); si el módulo no es de ninguna, la última usada. */
  N.opcionDe = (pid, modulo) => { const o = N.OPCIONES.find(x => x.mods.includes(modulo)); if (o) { memOp(pid, o.id); return o; } const g = memOp(pid); return N.OPCIONES.find(x => x.id === g) || N.OPCIONES[0]; };
  /** Abre una opción del proyecto en su primer módulo. */
  N.irOpcion = (pid, id) => { const o = N.OPCIONES.find(x => x.id === id) || N.OPCIONES[0], h = '#/p/' + pid + o.inicio; memOp(pid, o.id); if (location.hash === h) N.ruta(); else location.hash = h; };
  /** Nombres de los módulos de una opción, en el orden del lateral. */
  N.modulosDe = (o) => N.MODULOS.filter(x => !x.oculto && !x.abajo && o.mods.includes(x.r)).map(x => x.nombre).concat(o.visor ? ['Visor GIS/BIM', 'Visor de Autodesk Forma'] : []);

  ICO.contrato = '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><circle cx="6" cy="12" r="2"/><circle cx="13" cy="12" r="2"/><path d="M19 9l2 3-2 3"/><path d="M6 10V5M13 14v5"/></svg>';
  ICO.tableros = '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';
  ICO.obra = '<svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6"/><path d="M9 10h6"/></svg>';
  ICO.puente = '<svg viewBox="0 0 24 24"><path d="M4 7h11M12 4l3 3-3 3"/><path d="M20 17H9M12 14l-3 3 3 3"/></svg>';
  ICO.transmisiones = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 14h8"/></svg>';
  ICO.miembros = '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 5"/></svg>';
  ICO.ayuda = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>';
  ICO.cuadros = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  ICO.luna = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  ICO.sol = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>';
  N.ICO = ICO;
  /** Modo claro u oscuro de todo el CDE (lo recuerda cada navegador). Se aplica al <html>: las hojas oscuro.css hacen el resto. */
  N.tema = () => { try { const t = localStorage.getItem('cde.tema'); if (t) return t === 'oscuro' ? 'oscuro' : 'claro'; if (localStorage.getItem('cde.usuTema') === 'oscuro') return 'oscuro'; } catch (e) {} return N._tema || 'claro'; };
  N.ponTema = (t) => { N._tema = t === 'oscuro' ? 'oscuro' : 'claro'; try { localStorage.setItem('cde.tema', N._tema); } catch (e) {} document.documentElement.classList.toggle('tema-oscuro', N._tema === 'oscuro'); document.querySelectorAll('.usu').forEach(u => { u.classList.toggle('oscuro', N._tema === 'oscuro'); u.classList.toggle('claro', N._tema !== 'oscuro'); }); document.querySelectorAll('[data-btema]').forEach(b => { b.innerHTML = N._tema === 'oscuro' ? ICO.sol : ICO.luna; b.title = N._tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'; }); };
  N.botonTema = () => '<button class="redondo" data-btema title="' + (N.tema() === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro') + '" onclick="CDE.N.ponTema(CDE.N.tema() === \'oscuro\' ? \'claro\' : \'oscuro\')">' + (N.tema() === 'oscuro' ? ICO.sol : ICO.luna) + '</button>';
  document.documentElement.classList.toggle('tema-oscuro', N.tema() === 'oscuro');
  N.iniciales = (s) => String(s || '?').split('@')[0].split(/[._\- ]+/).map(x => x[0] || '').join('').slice(0, 2).toUpperCase();
  /** Foto de perfil (si la persona la puso) o sus iniciales, en el círculo. La foto vive en la base del CDE, no en el programa. */
  N.fotoUrl = (f) => f && f.clave ? '/api/perfil/foto/' + encodeURIComponent(f.clave) + '?v=' + encodeURIComponent(f.v || '') : '';
  N.circulo = (email, foto) => foto && foto.clave ? '<i class="ini foto"><img src="' + N.fotoUrl(foto) + '" alt=""></i>' : '<i class="ini">' + N.iniciales(email) + '</i>';
  N.avatar = (email, org) => '<span class="av" data-av="' + esc(email || '') + '"><i class="ini">' + N.iniciales(email) + '</i><span><b>' + esc(String(email || '').split('@')[0]) + '</b><small>' + esc(org || '') + '</small></span></span>';
  N.PROYECTOS = null;  // cache para el selector de proyectos de la barra superior

  /**
   * Marco de pagina al estilo de Autodesk Forma / Docs: barra superior (app, selector de proyecto, ayuda, usuario) +
   * lateral claro con los modulos (los de "abajo" van al pie, como Miembros y Configuracion en ACC) + area principal.
   * p: proyecto (o null); modulo: ruta relativa ('' = Archivos); sub: texto extra de la cabecera; acciones: html a la derecha.
   */
  N.marco = (p, modulo, sub, acciones) => {
    N.PROY_ACTUAL = p;
    const m = N.MODULOS.find(x => x.r === modulo) || N.MODULOS[1];
    const yo = N.YO || {};
    const op = p && modulo !== '/inicio' ? N.opcionDe(p.id, modulo) : null;   // en el inicio del proyecto se eligen las opciones: el lateral las lista todas
    document.body.classList.remove('cajon');   // al cambiar de página, el cajón del celular queda cerrado
    const barra = '<header class="barra">' + (p ? '<button class="redondo hamb" id="hamb" title="Menú" aria-label="Abrir el menú" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' : '') + '<a class="app" href="#/" title="Direcciones ejecutoras"><img class="logoa" src="' + N.MARCA.logo + '" alt="ANIN"><b>CDE</b><span class="sep"></span></a>' +
      (p ? '<button class="selp" id="selProyecto"><span class="mono">' + esc(p.codigo) + '</span><span class="selsep"> · </span>' + esc(p.nombre) + ' <i>▾</i></button>' : '<span class="selp pista">Direcciones ejecutoras</span>') +
      '<div class="crece"></div>' + (op ? '<button class="irA" id="irA" title="Pasar a otra opción del proyecto">Ir a <i>▾</i></button>' : '') + N.botonTema() + '<a class="redondo" href="docs/README.html" target="_blank" title="Ayuda" onclick="return false">' + ICO.ayuda + '</a><button class="redondo usuario" id="menuUsuario" title="' + esc(yo.email || '') + '">' + N.circulo(yo.email, yo.foto) + ' <i>▾</i></button></header>';
    const ub = p && p.ubicacion, donde = p ? '<a class="donde" href="#/p/' + p.id + '/inicio" title="Opciones del proyecto"><small>' + esc(ub ? ub.direccion : 'Sin dirección') + '</small><small class="n2">' + esc(ub ? ub.subNombre : 'Sin subdirección') + '</small><b>' + esc(p.nombre) + '</b></a>' : '';
    const navOp = !p ? '' : op ? '<div class="lopcion" title="Opción del proyecto que tienes abierta">' + esc(op.nombre) + '</div><nav>' + N.MODULOS.filter(x => !x.abajo && !x.oculto && op.mods.includes(x.r)).map(x => '<a class="' + (x.r === modulo ? 'activo' : '') + '" href="#/p/' + p.id + x.r + '">' + ICO[x.ico] + '<span>' + x.nombre + '</span></a>').join('') +
        (op.visor ? '<a href="visor.html?pid=' + p.id + '" target="_blank">' + ICO.visor + '<span>Visor GIS/BIM</span></a><a href="visor-forma.html?pid=' + p.id + '" target="_blank" title="Los modelos traídos de Autodesk Forma, dibujados por el visualizador de Autodesk, con las funciones del visor del CDE">' + ICO.visor + '<span>Visor de Autodesk Forma</span></a>' : '') + '</nav>'
      : '<div class="lopcion">Opciones del proyecto</div><nav>' + N.OPCIONES.map(o => '<a href="#/p/' + p.id + o.inicio + '" data-lop="' + o.id + '">' + ICO[o.ico] + '<span>' + esc(o.nombre) + '</span></a>').join('') + '</nav>';
    const lateral = '<aside class="lateral">' + (p ? donde + navOp + '<div class="crece"></div><nav class="abajo">' + N.MODULOS.filter(x => x.abajo).map(x => '<a class="' + (x.r === modulo ? 'activo' : '') + '" href="#/p/' + p.id + x.r + '">' + ICO[x.ico] + '<span>' + x.nombre + '</span></a>').join('') + '</nav>' : '<nav><a class="activo" href="#/">' + ICO.proyectos + '<span>Direcciones ejecutoras</span></a></nav><div class="crece"></div>') +
      '<button class="plegar" id="plegar" title="Contraer el panel">|←</button></aside>';
    const cab = '<div class="supra"><div><h1>' + (sub ? esc(sub) : (p ? esc(m.titulo) : 'Direcciones ejecutoras')) + '</h1>' + (sub ? '<div class="migas"><a href="#/p/' + p.id + modulo + '">' + esc(m.nombre) + '</a> › <span class="mono">' + esc(sub) + '</span></div>' : '') + '</div><div class="crece"></div>' + (acciones || '') + '</div>';
    setTimeout(() => {
      const sp = document.getElementById('selProyecto'); if (sp) sp.onclick = async (e) => { e.stopPropagation(); let lista = N.PROYECTOS; if (!lista) { try { lista = N.PROYECTOS = (await api('/api/proyectos')).proyectos; } catch (err) { return; } } N.menuFlotante(sp, lista.map(x => ({ texto: '<span class="mono">' + esc(x.codigo) + '</span> · ' + esc(x.nombre), accion: () => { location.hash = '#/p/' + x.id + modulo; } })).concat([{ texto: 'Direcciones ejecutoras (todos los proyectos)', accion: () => { location.hash = '#/'; } }])); };
      const mu = document.getElementById('menuUsuario'); if (mu) mu.onclick = (e) => { e.stopPropagation(); N.menuFlotante(mu, [{ texto: '<b>' + esc(yo.email || '') + '</b>' + (p ? '<br><small>' + esc(p.rol + (p.organizacion ? ' · ' + p.organizacion : '')) + '</small>' : ''), accion: null }, ...(N.menuCuenta ? N.menuCuenta() : []), ...(innerWidth <= 760 ? [{ texto: N.tema() === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', accion: () => N.ponTema(N.tema() === 'oscuro' ? 'claro' : 'oscuro') }] : []), { texto: 'Cerrar sesión', accion: async () => { await api('/api/acceso/salir', { method: 'POST' }); N.YO = null; location.hash = '#/acceso'; } }], 'derecha'); };
      const ir = document.getElementById('irA'); if (ir) ir.onclick = (e) => { e.stopPropagation(); N.menuFlotante(ir, N.OPCIONES.filter(o => o.id !== op.id).map(o => ({ ico: 'op_' + o.id, texto: esc(o.nombre), accion: () => N.irOpcion(p.id, o.id) })), 'derecha'); };
      document.querySelectorAll('[data-lop]').forEach(a => a.onclick = (e) => { e.preventDefault(); N.irOpcion(p.id, a.dataset.lop); });
      // celular: el lateral es un cajón que abre ☰ y se cierra al tocar fuera, al elegir un módulo o con Esc
      const hb = document.getElementById('hamb'), cajon = (abre) => { document.body.classList.toggle('cajon', abre); if (hb) hb.setAttribute('aria-expanded', abre ? 'true' : 'false'); };
      if (hb) hb.onclick = (e) => { e.stopPropagation(); cajon(!document.body.classList.contains('cajon')); };
      const cf = document.getElementById('cajonFondo'); if (cf) cf.onclick = () => cajon(false);
      document.querySelectorAll('.lateral nav a, .lateral .donde').forEach(a => a.addEventListener('click', () => cajon(false)));
      const pl = document.getElementById('plegar'); if (pl) pl.onclick = () => { document.body.classList.toggle('plegado'); try { localStorage.setItem('cde.plegado', document.body.classList.contains('plegado') ? '1' : ''); } catch (err) {} };
      try { if (localStorage.getItem('cde.plegado') === '1') document.body.classList.add('plegado'); } catch (err) {}
    }, 0);
    return '<div class="marco">' + barra + '<div class="cuerpo">' + lateral + '<div class="cajonfondo" id="cajonFondo"></div><main class="principal">' + cab + '<div class="pag">';
  };
  N.cierra = () => '</div></main></div></div>';
  /** Iconos de linea de los menus (los de Autodesk Docs). */
  const SV = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  N.ICO = {
    mas: SV('<path d="M12 5v14M5 12h14"/>'), lapiz: SV('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'), compartir: SV('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>'),
    desplazar: SV('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3"/><path d="M3 7v10a2 2 0 0 0 2 2h7"/><path d="M15 17h7M19 14l3 3-3 3"/>'), papelera: SV('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    ordenar: SV('<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>'), cargar: SV('<path d="M7 18a5 5 0 0 1-.5-9.98A6 6 0 0 1 18 9a4 4 0 0 1 0 8"/><path d="M12 12v8M9 15l3-3 3 3"/>'), descargar: SV('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    exportar: SV('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'), revision: SV('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h3M10 16l2 2 4-4"/>'), transmision: SV('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 14h6"/>'),
    permisos: SV('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6 1.2 0 2.3.3 3.2.9"/><circle cx="17.5" cy="16.5" r="2.5"/><path d="M17.5 12.5v1.5M17.5 19v1.5M21.5 16.5H20M15 16.5h-1.5"/>'), disparador: SV('<path d="M8 5l11 7-11 7z"/>'),
    engranaje: SV('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'), abrir: SV('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    visor: SV('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'), estado: SV('<circle cx="12" cy="12" r="8"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'), enlace: SV('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    copiar: SV('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'), info: SV('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'), carpetaMas: SV('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>'),
    buscar: SV('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'), archivo: SV('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'), marca: SV('<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>')
  };
  /** Menu flotante (como los ⋮ de ACC): opciones [{ texto, accion, peligro, ico, sub: [opciones], ayuda, off, sep }] anclado a un elemento.
   *  Una opcion sin accion ni sub es informativa; { sep: true } dibuja una linea; sub abre un submenu a la derecha. */
  N.menuFlotante = (ancla, opciones, lado) => {
    document.querySelectorAll('.menuf').forEach(x => x.remove());
    const pinta = (ops) => ops.map((o, i) => o.sep ? '<div class="sepm"></div>' : '<div class="op' + (o.accion || o.sub ? '' : ' info') + (o.peligro ? ' peligro' : '') + (o.off ? ' off' : '') + (o.sub ? ' consub' : '') + '" data-i="' + i + '"' + (o.off ? ' title="' + esc(o.off === true ? '' : o.off) + '"' : '') + '>' + (o.ico ? '<span class="mico">' + (N.ICO[o.ico] || '') + '</span>' : '') + '<span class="mtx">' + o.texto + '</span>' + (o.ayuda ? '<span class="mayuda" title="' + esc(o.ayuda) + '">' + N.ICO.info + '</span>' : '') + (o.sub && !o.off ? '<span class="mflecha">›</span>' : '') + '</div>').join('');
    const conIcos = (ops) => ops.some(o => o.ico);
    const r = ancla.getBoundingClientRect(), d = document.createElement('div'); d.className = 'menuf' + (conIcos(opciones) ? ' conicos' : '');
    d.innerHTML = pinta(opciones);
    document.body.appendChild(d);
    const ancho = d.offsetWidth, alto = d.offsetHeight;
    let top = r.bottom + window.scrollY + 4; if (r.bottom + 4 + alto > window.innerHeight - 8) top = Math.max(window.scrollY + 8, r.top + window.scrollY - alto - 4);
    d.style.top = top + 'px'; d.style.left = (lado === 'derecha' ? Math.max(8, r.right - ancho) : Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
    let subm = null;
    const cierraTodo = () => document.querySelectorAll('.menuf').forEach(x => x.remove());
    const abreSub = (el, o) => {
      if (subm) subm.remove(); const s = document.createElement('div'); s.className = 'menuf sub' + (conIcos(o.sub) ? ' conicos' : ''); s.innerHTML = pinta(o.sub); document.body.appendChild(s); subm = s;
      const rr = el.getBoundingClientRect(), w = s.offsetWidth, h = s.offsetHeight;
      s.style.left = (rr.right + w + 4 < window.innerWidth ? rr.right + 2 : Math.max(8, rr.left - w - 2)) + 'px'; s.style.top = (Math.min(rr.top, window.innerHeight - h - 8) + window.scrollY) + 'px';
      s.querySelectorAll('.op').forEach(x => x.onclick = (e) => { e.stopPropagation(); const so = o.sub[+x.dataset.i]; if (so.accion && !so.off) { cierraTodo(); so.accion(); } });
    };
    d.querySelectorAll('.op').forEach(el => {
      const o = opciones[+el.dataset.i];
      if (o.sub && !o.off) { el.onmouseenter = () => abreSub(el, o); el.onclick = (e) => { e.stopPropagation(); abreSub(el, o); }; }
      else { el.onmouseenter = () => { if (subm) { subm.remove(); subm = null; } }; el.onclick = (e) => { e.stopPropagation(); if (o.accion && !o.off) { cierraTodo(); o.accion(); } }; }
    });
    setTimeout(() => document.addEventListener('click', cierraTodo, { once: true }), 0);
    return d;
  };
  /** Pide un texto en una ventanita (en vez de prompt): devuelve el texto o null. */
  N.pide = (titulo, etiqueta, valor, boton) => new Promise((ok) => {
    let hecho = false; const fin = (x) => { if (hecho) return; hecho = true; ok(x); };
    const v = ventana(titulo, '<label>' + esc(etiqueta || '') + '</label><input id="pdV" value="' + esc(valor || '') + '"><div class="fila" style="justify-content:flex-end;margin-top:12px;gap:8px"><button id="pdNo" class="enlace">Cancelar</button><button class="primario" id="pdOk">' + esc(boton || 'Aceptar') + '</button></div>', { ancho: 460, alto: 200, x: Math.max(20, innerWidth / 2 - 230), y: 140, alCerrar: () => fin(null) });
    const i = v.querySelector('#pdV'), cierra = () => { const w = v.closest('.ventana'); if (w) w.remove(); };
    setTimeout(() => { i.focus(); i.select(); }, 30);
    v.querySelector('#pdOk').onclick = () => { const x = i.value.trim(); if (!x) return i.focus(); cierra(); fin(x); };
    v.querySelector('#pdNo').onclick = () => { cierra(); fin(null); };
    i.onkeydown = (e) => { if (e.key === 'Enter') v.querySelector('#pdOk').click(); if (e.key === 'Escape') v.querySelector('#pdNo').click(); };
  });
  /** Panel lateral derecho (como la ficha de incidencia de Forma): sustituye al anterior, se ensancha arrastrando su borde izquierdo.
   *  Devuelve el cuerpo; cerrarlo: el boton ✕ o cuerpo.closest('.ventana').remove() (lleva la clase .ventana por compatibilidad). */
  N.panel = (titulo, html, opciones) => {
    const o = opciones || {}; document.querySelectorAll('.ventana.panel-lado').forEach(x => { x.remove(); });
    const cont = document.getElementById('ventanas') || document.body, v = document.createElement('div'); v.className = 'ventana panel-lado'; if (CDE.sube) v.style.zIndex = CDE.sube();
    v.style.width = Math.min(innerWidth - 40, o.ancho || 640) + 'px';
    v.innerHTML = '<div class="vborde" title="Arrastra para ensanchar"></div><div class="vcab"><b>' + titulo + '</b>' + (o.acciones || '') + '<button title="Ampliar" aria-label="Ampliar" data-max><svg viewBox="0 0 24 24"><path d="M9 5H5v4M15 19h4v-4M5 5l6 6M19 19l-6-6"/></svg></button><button title="Cerrar" aria-label="Cerrar" data-cerrar><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="vcuerpo">' + (html || '') + '</div>';
    cont.appendChild(v);
    let arr = null; const b = v.querySelector('.vborde');
    b.onmousedown = (e) => { arr = { x: e.clientX, w: v.offsetWidth }; e.preventDefault(); };
    window.addEventListener('mousemove', (e) => { if (!arr) return; v.style.width = Math.max(360, Math.min(innerWidth - 40, arr.w + (arr.x - e.clientX))) + 'px'; });
    window.addEventListener('mouseup', () => { arr = null; });
    v.querySelector('[data-cerrar]').onclick = () => { v.remove(); if (o.alCerrar) o.alCerrar(); };
    v.querySelector('[data-max]').onclick = () => { v.classList.toggle('max'); };
    return v.querySelector('.vcuerpo');
  };
  /** Avatar chico (iniciales con color por correo) y lista de avatares apilados, como en Forma. */
  N.avatarMini = (email, titulo) => { const s = String(email || ''); let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) & 0xffff; return '<i class="avm" style="background:hsl(' + (h % 360) + ',55%,45%)" title="' + esc(titulo || s) + '">' + N.iniciales(s) + '</i>'; };
  N.OPCIONES.forEach(o => { N.ICO['op_' + o.id] = SV(String(ICO[o.ico] || '').replace(/^<svg[^>]*>|<\/svg>$/g, '')); });
  N.ICO.ajustes = N.ICO.engranaje; N.ICO.filtro = N.ICO.ordenar; N.ICO.puente = N.ICO.puente || N.ICO.enlace;
  N.avatares = (lista, max) => { const L = [...new Set((lista || []).filter(Boolean))]; return '<span class="avs">' + L.slice(0, max || 3).map(e => N.avatarMini(e)).join('') + (L.length > (max || 3) ? '<i class="avm mas">+' + (L.length - (max || 3)) + '</i>' : '') + '</span>'; };
  /** Aviso breve abajo (el "toast" de ACC). */
  N.toast = (texto, tipo) => { const t = document.createElement('div'); t.className = 'toast ' + (tipo || ''); t.innerHTML = texto; document.body.appendChild(t); setTimeout(() => t.classList.add('fuera'), 3200); setTimeout(() => t.remove(), 3800); };
  /** Carga una libreria de /vendor bajo demanda (p. ej. SheetJS para exportar a Excel). */
  N.carga = (src, global) => window[global] ? Promise.resolve(window[global]) : new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });


  // ---------- enrutador ----------
  async function ruta() {
    const h = location.hash.replace(/^#/, '') || '/';
    if (!N.YO && h !== '/acceso') { try { N.YO = await api('/api/acceso/quien'); } catch (e) { location.hash = '#/acceso'; return; } try { Object.assign(N.YO, await api('/api/perfil')); } catch (e) {} }
    if (N.YO && N.YO.cambiar && h !== '/acceso' && N.cambiaClave) return N.cambiaClave(true);   // clave temporal: primero se cambia
    const V = N.vistas;
    try {
      if (h === '/acceso') return V.acceso();
      let m;
      if ((m = /^\/p\/([^/]+)\/c\/([^/]+)/.exec(h))) return V.contenedor(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/tableros/.exec(h))) return V.tableros(m[1]);
      if ((m = /^\/p\/([^/]+)\/contrato(?:\/([^/]+))?/.exec(h))) return V.contrato(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/incidencias(?:\/([^/]+))?/.exec(h))) return V.incidencias(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/revisiones\/configuracion/.exec(h))) return V.revisionesConfig(m[1]);
      if ((m = /^\/p\/([^/]+)\/revisiones\/([^/]+)/.exec(h))) return V.revision(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/revisiones/.exec(h))) return V.revisiones(m[1]);
      if ((m = /^\/p\/([^/]+)\/obra(?:\/([^/]+))?(?:\/([^/]+))?/.exec(h))) return V.obra(m[1], m[2], m[3]);
      if ((m = /^\/p\/([^/]+)\/puente/.exec(h))) return V.puente(m[1]);
      if ((m = /^\/p\/([^/]+)\/incidencias\/suprimidas/.exec(h))) return V.incidenciasSuprimidas(m[1]);
      if ((m = /^\/p\/([^/]+)\/archivos\/conjuntos(?:\/([^/]+))?/.exec(h))) return V.conjuntos(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/transmisiones(?:\/([^/]+))?/.exec(h))) return V.transmisiones(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/documentos(?:\/([^/]+))?/.exec(h))) return V.documentos(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/archivos\/configuracion(?:\/([^/]+))?/.exec(h))) return V.configArchivos(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/archivos\/suprimidos/.exec(h))) return V.suprimidos(m[1]);
      if ((m = /^\/p\/([^/]+)\/correspondencia(?:\/([^/]+))?/.exec(h))) return V.correspondencia(m[1], m[2]);
      if ((m = /^\/p\/([^/]+)\/registros/.exec(h))) return V.registros(m[1]);
      if ((m = /^\/p\/([^/]+)\/inicio/.exec(h))) return V.inicioProyecto(m[1]);
      if ((m = /^\/p\/([^/]+)\/miembros/.exec(h))) return V.miembros(m[1]);
      if ((m = /^\/p\/([^/]+)\/ajustes/.exec(h))) return V.ajustes(m[1]);
      if ((m = /^\/p\/([^/]+)\/carpeta\/(.+)$/.exec(h))) { N.FILTRO.carpeta = decodeURIComponent(m[2]); N.FILTRO.q = ''; N.FILTRO.estado = ''; N.FILTRO.sub = false; return V.proyecto(m[1]); }
      if ((m = /^\/p\/([^/]+)/.exec(h))) return V.proyecto(m[1]);
      return V.proyectos();
    } catch (e) { N.app.innerHTML = N.marco(null, '') + '<div class="aviso rojo">' + esc(e.message) + '</div><a href="#/">Volver</a>' + N.cierra(); }
  }
  N.ruta = ruta;
  window.addEventListener('hashchange', ruta);
  document.addEventListener('DOMContentLoaded', ruta);
})();
