/* MODULO ARCHIVOS: arbol de carpetas (editable, con permisos), contenedores, subir, ficha del contenedor con estados y rondas */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, num, ventana, barras, R, NIVEL_TXT, ZONA_TXT, dia, estado, aviso, app } = N;
  // ---------- un proyecto ----------
  // ======================= ARCHIVOS: replica de "Archivos" de Autodesk Docs =======================
  const ICO_CARP = '<svg class="icf" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const ICO_CARPZ = '<svg class="icf" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="17" cy="16" r="3" fill="#fff"/><path d="M15.8 16l.9.9 1.6-1.8"/></svg>';
  const ICO_ARCH = { modelo: '<svg class="icf" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>', plano: '<svg class="icf" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>', documento: '<svg class="icf" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>', otro: '<svg class="icf" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/></svg>' };
  const COLS = [
    ['nombre', 'Nombre', 1], ['descripcion', 'Descripción', 1], ['version', 'Versión', 1], ['indicadores', 'Indicadores', 1], ['marcas', 'Marcas de revisión', 1], ['incidencias', 'Incidencias', 1], ['tamano', 'Tamaño', 1], ['actualizado', 'Última actualización', 1], ['por', 'Actualizado por', 1], ['aprobado', 'Aprobado por', 1], ['estado', 'Estado', 1], ['carpeta', 'Carpeta', 0], ['tipo', 'Tipo', 0], ['creado', 'Creado', 0]
  ];
  const colsVisibles = (p) => { const nom = ((p.config.nomenclatura || {}).campos || []).map(c => ['n:' + c.nombre, c.nombre, 1]); let g = null; try { g = JSON.parse(localStorage.getItem('cde.columnas.' + p.id) || 'null'); } catch (e) {} const todas = COLS.concat(nom); return todas.map(c => ({ id: c[0], nombre: c[1], on: g ? g.includes(c[0]) : !!c[2] })); };
  const hijosDe = (arbol, ruta) => arbol.filter(c => (ruta ? c.ruta.startsWith(ruta + '/') && c.ruta.slice(ruta.length + 1).indexOf('/') < 0 : c.ruta.indexOf('/') < 0));

  // ---------- WIP · COM · PUB: la etapa manda en el arbol; los tres botones eligen que zona se ve en todas las etapas ----------
  const ZONAS_VISTA = [['wip', 'WIP', 'Trabajo en progreso'], ['compartido', 'COM', 'Compartido'], ['publicado', 'PUB', 'Publicado']];
  /** El formato del documento junto al código: el .pdf y el .docx del mismo código son dos documentos distintos. */
  const extTxt = (c) => { const e = c.ext || (c.ultima && c.ultima.extension) || ''; return e ? '<span class="ext">.' + esc(String(e).toLowerCase()) + '</span>' : ''; };
  const conZonas = (p) => p.arbol.some(c => c.zonaEfectiva === 'wip' || c.zonaEfectiva === 'compartido' || c.zonaEfectiva === 'publicado');
  function zonaVista(p) { if (p._zona !== undefined) return p._zona; let z = ''; try { z = localStorage.getItem('cde.zona.' + p.id) || ''; } catch (e) {} p._zona = conZonas(p) ? (ZONAS_VISTA.some(x => x[0] === z) ? z : 'wip') : ''; return p._zona; }
  /** ¿Se ve esta carpeta con la zona elegida? Las carpetas sin zona (las etapas, las de administracion) se ven siempre. Pura. */
  const zonaOk = (p, c) => { const z = zonaVista(p), ze = (c && c.zonaEfectiva) || ''; return !z || !ze || ze === z || (z === 'publicado' && ze === 'archivo'); };
  const arbolVisible = (p) => p.arbol.filter(c => zonaOk(p, c));
  /** Al elegir una zona se despliega su estructura en todas las etapas (E1 › WIP › WIP CLIENTE...). */
  function despliegaZona(p) {
    const z = zonaVista(p), vis = arbolVisible(p), porRuta = new Map(vis.map(c => [c.ruta, c]));
    for (const c of vis) {
      const padre = c.ruta.split('/').slice(0, -1).join('/');
      if (c.zonaEfectiva === z && !(porRuta.get(padre) || {}).zonaEfectiva) { const ps = c.ruta.split('/'); for (let i = 1; i <= ps.length; i++) N.ABIERTAS.add(ps.slice(0, i).join('/')); }
    }
  }
  const zonasHtml = (p) => conZonas(p) ? '<div class="zonasbtn">' + ZONAS_VISTA.map(([k, t, l]) => '<button class="z-' + k + (zonaVista(p) === k ? ' activa' : '') + '" data-zv="' + k + '" title="' + esc(l) + ': muestra esta zona en todas las etapas"><span><i></i>' + t + '</span><small>' + esc(l) + '</small></button>').join('') + '</div>' : '';

  function arbolHtml(p) {
    const sel = N.FILTRO.carpeta, A = N.ABIERTAS, lista = arbolVisible(p);
    if (sel) { const ps = sel.split('/'); for (let i = 1; i < ps.length; i++) A.add(ps.slice(0, i).join('/')); }
    const visible = (r) => { const ps = r.split('/'); for (let i = 1; i < ps.length; i++) if (!A.has(ps.slice(0, i).join('/'))) return false; return true; };
    const conHijos = new Set(lista.map(c => c.ruta.split('/').slice(0, -1).join('/')));
    return zonasHtml(p) + '<div class="arbolacc"><div class="nodo raiz' + (!sel ? ' activo' : '') + '" data-c=""><span class="chev">⌄</span>' + ICO_CARP + '<span class="nom">Archivos de proyecto</span><button class="mini puntos" data-m="" title="Acciones">⋮</button></div>' +
      lista.filter(c => visible(c.ruta)).map(c => '<div class="nodo' + (sel === c.ruta ? ' activo' : '') + (c.zonaEfectiva === 'wip' ? ' wip' : '') + '" style="padding-left:' + (c.nivel * 18 + 26) + 'px" data-c="' + esc(c.ruta) + '" title="' + esc((c.nota ? c.nota + ' · ' : '') + (c.paso ? 'sin acceso al contenido (carpeta de paso)' : (NIVEL_TXT[c.permiso] || 'sin acceso')) + (c.heredadasDe ? ' (heredado de ' + c.heredadasDe + ')' : '')) + '">' + (conHijos.has(c.ruta) ? '<span class="chev" data-p="' + esc(c.ruta) + '">' + (A.has(c.ruta) ? '⌄' : '›') + '</span>' : '<span class="chev"></span>') + (c.zonaEfectiva && c.zonaEfectiva !== 'wip' ? ICO_CARPZ : ICO_CARP) + '<span class="nom">' + esc(c.nombre) + '</span>' + (c.disparador ? '<span class="disp" title="Desencadenador automático: inicia un flujo al cargar">▶</span>' : '') + '<button class="mini puntos" data-m="' + esc(c.ruta) + '" title="Acciones">⋮</button></div>').join('') + '</div>';
  }

  // ---------- utilidades de las acciones ----------
  const recargaDe = (p) => () => vistaProyecto(p.id);
  const copia = async (texto) => { try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(texto); return true; } } catch (e) {} const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} t.remove(); return ok; };
  const enlaceDe = (hash) => location.origin + location.pathname + hash;
  function compartir(titulo, hash, nota) {
    const url = enlaceDe(hash);
    const v = ventana('Compartir · ' + titulo, '<p class="pista">' + esc(nota || 'Cualquier miembro del proyecto con permiso sobre esta carpeta la abre directamente con este enlace; quien no tiene permiso no ve su contenido.') + '</p><div class="fila"><input id="cmU" readonly value="' + esc(url) + '" style="flex:1"><button class="primario" id="cmC">Copiar enlace</button></div><div id="cmM"></div>', { ancho: 620, alto: 210, x: Math.max(20, innerWidth / 2 - 310), y: 140 });
    v.querySelector('#cmU').onclick = (e) => e.target.select();
    v.querySelector('#cmC').onclick = async () => { const ok = await copia(url); v.querySelector('#cmM').innerHTML = ok ? '<div class="aviso verde">Enlace copiado.</div>' : '<div class="aviso ambar">Selecciona el enlace y cópialo (Ctrl+C).</div>'; };
  }
  /** "Seleccionar carpeta de destino" (el de Autodesk Docs): arbol con las carpetas donde no se puede en gris. Devuelve la ruta ('' = raiz) o null. */
  function eligeDestino(p, o) {
    return new Promise((ok) => {
      let sel = null, hecho = false; const fin = (x) => { if (!hecho) { hecho = true; ok(x); } };
      const A = new Set(), ini = o.inicial || ''; if (ini) { const ps = ini.split('/'); for (let i = 1; i <= ps.length; i++) A.add(ps.slice(0, i).join('/')); }
      const v = ventana(o.titulo || 'Seleccionar carpeta de destino', '<div class="destino-dlg">' + (o.texto ? '<div class="pista" style="margin-bottom:8px">' + o.texto + '</div>' : '') + '<div class="destarbol"></div><div class="pie"><span class="pista crece" id="dsSel"></span><button class="enlace" id="dsNo">Cancelar</button><button class="primario" id="dsOk" disabled>' + esc(o.boton || 'Desplazar') + '</button></div></div>', { ancho: 640, alto: 580, x: Math.max(20, innerWidth / 2 - 320), y: 70, alCerrar: () => fin(null) });
      const win = v.closest('.ventana'), lista = p.arbol, conHijos = new Set(lista.map(c => c.ruta.split('/').slice(0, -1).join('/')));
      const motivo = (ruta, c) => { const ap = o.apagada ? o.apagada(ruta, c) : ''; if (ap) return ap; if (ruta === '') return o.raiz ? '' : 'Aquí no'; if (c && c.paso) return 'Sin acceso a esta carpeta'; return o.permitida && !o.permitida(c) ? (o.motivo ? o.motivo(c) : 'Sin permiso') : ''; };
      const pinta = () => {
        const visible = (r) => { const s = r.split('/'); for (let i = 1; i < s.length; i++) if (!A.has(s.slice(0, i).join('/'))) return false; return true; };
        const nodo = (ruta, nombre, nivel, c) => { const m = motivo(ruta, c), hijos = ruta === '' || conHijos.has(ruta); return '<div class="nodo' + (m ? ' off' : '') + (sel === ruta ? ' sel' : '') + '" data-r="' + esc(ruta) + '" style="padding-left:' + (nivel * 22 + 6) + 'px"' + (m ? ' title="' + esc(m) + '"' : '') + '>' + (hijos ? '<span class="chev" data-t="' + esc(ruta) + '">' + (ruta === '' || A.has(ruta) ? '⌄' : '›') + '</span>' : '<span class="chev"></span>') + (c && c.zonaEfectiva && c.zonaEfectiva !== 'wip' ? ICO_CARPZ : ICO_CARP) + '<span>' + esc(nombre) + '</span></div>'; };
        v.querySelector('.destarbol').innerHTML = nodo('', 'Archivos de proyecto', 0, null) + lista.filter(c => visible(c.ruta)).map(c => nodo(c.ruta, c.nombre, c.nivel + 1, c)).join('');
        v.querySelectorAll('.destarbol .nodo').forEach(n => n.onclick = (e) => {
          const r = n.dataset.r, t = e.target.closest('.chev');
          if ((t && t.dataset.t !== undefined && r !== '') || (n.classList.contains('off') && conHijos.has(r))) { if (A.has(r)) A.delete(r); else A.add(r); return pinta(); }
          if (n.classList.contains('off')) return;
          sel = r; if (r && conHijos.has(r)) A.add(r); pinta();
        });
        v.querySelector('#dsOk').disabled = sel === null;
        v.querySelector('#dsSel').textContent = sel === null ? '' : 'Destino: ' + (sel || 'Archivos de proyecto');
      };
      v.querySelector('#dsNo').onclick = () => { win.remove(); fin(null); };
      v.querySelector('#dsOk').onclick = () => { win.remove(); fin(sel); };
      pinta();
    });
  }
  /** Se puede enviar a revision: lo COMPARTIDO, y lo que esta en una carpeta compartida aunque siga marcado WIP (se desplazo alli). */
  /** Estado que ve el usuario: en WIP el del contenedor; en COM y PUB el de la revisión — En revisión (flujo en curso), Aceptado o Rechazado. */
  const ER_TXT = { 'en-revision': 'EN REVISIÓN', aceptado: 'ACEPTADO', rechazado: 'RECHAZADO' }, ER_CLS = { 'en-revision': 'en-curso', aceptado: 'PUBLICADO', rechazado: 'rechazado' };
  const zonaFila = (p, c) => ((p.arbol || []).find(x => x.ruta === (c.carpeta_vista || c.carpeta)) || {}).zonaEfectiva || '';
  const estadoTxtFila = (p, c) => { const z = zonaFila(p, c); return z === 'compartido' || z === 'publicado' ? (ER_TXT[c.estado_revision] || 'SIN REVISIÓN') : c.estado; };
  const estadoFila = (p, c) => { const z = zonaFila(p, c); if (!(z === 'compartido' || z === 'publicado')) return estado(c.estado); const e = c.estado_revision; return e ? '<span class="estado ' + ER_CLS[e] + '">' + ER_TXT[e] + '</span>' : '<span class="estado ARCHIVADO" title="Aún no se ha enviado a revisión">SIN REVISIÓN</span>'; };
  const zonaDeCarpeta = (p, ruta) => ((p.arbol || []).find(x => x.ruta === ruta) || {}).zonaEfectiva || '';
  const revisable = (p, c) => !c.copia && !c.revision_abierta && !c.retencion && (c.estado === 'COMPARTIDO' || (c.estado === 'WIP' && zonaDeCarpeta(p, c.carpeta) === 'compartido'));
  const esPdf = (c) => /\.pdf$/i.test((c.ultima && c.ultima.archivo) || '');
  /** Lo que el Visualizador de archivos (ver.html) sabe abrir con los lectores del Visor BIM: Excel, Word, PowerPoint, Project, Primavera y GIS. */
  const RX_VER = /\.(xlsx|xlsm|xlsb|xls|csv|ods|docx|doc|pptx|ppt|txt|md|xer|mpx|mpp|xml|shp|dbf|prj|cpg|shx|kml|kmz|gpx|geojson|gpkg|zip)$/i;
  const seVe = (c) => RX_VER.test((c.ultima && c.ultima.archivo) || '');
  /** Abre el archivo en su visualizador: ventana flotante (se mueve, se agranda) con ver.html dentro. */
  function verArchivo(p, c, vid) {
    const u = c.ultima || {}, v = ventana(esc(u.archivo || c.nombre), '<iframe class="veriframe" src="ver.html?pid=' + encodeURIComponent(p.id) + '&cid=' + encodeURIComponent(c.id) + '&vid=' + encodeURIComponent(vid || u.id || '') + '" title="Visualizador"></iframe>', { ancho: innerWidth - 32, alto: innerHeight - 24, x: 16, y: 12, acciones: '<a class="boton mini" href="#/p/' + p.id + '/c/' + c.id + '" data-ficha title="Versiones, estado, historial y revisiones del archivo">Ficha</a>' });
    const w = v.closest('.ventana'); w.classList.add('verventana'); const f = w.querySelector('[data-ficha]'); if (f) f.onclick = () => w.remove();
  }
  const ZONA_DE_ESTADO = { WIP: 'wip', COMPARTIDO: 'compartido', PUBLICADO: 'publicado', ARCHIVADO: 'archivo' };
  async function desplazaContenedores(p, lista) {
    if (!lista.length) return;
    // Como en Autodesk Docs: a CUALQUIER carpeta en la que se pueda cargar (sin importar la zona ni si el archivo pasó o está en revisión).
    const aqui = new Set(lista.map(c => c.copia ? c.carpeta_publicada : (c.retencion || c.carpeta)));
    const dest = await eligeDestino(p, { titulo: 'Seleccionar carpeta de destino', boton: 'Desplazar', inicial: [...aqui][0], texto: (lista.length > 1 ? lista.length + ' elementos' : esc(lista[0].nombre)) + (lista.some(c => c.copia) ? ' <span class="etq">copia publicada</span>' : ''),
      apagada: (r) => aqui.size === 1 && aqui.has(r) ? 'Ya está aquí' : '', permitida: (c) => !!c.subir, motivo: () => 'Sin permiso de carga en esta carpeta' });
    if (dest === null) return;
    // De una carpeta libre (WIP o área de retención) a una con norma (compartido / publicado): la misma rejilla de Forma que al cargar,
    // para dejar el nombre conforme y los atributos puestos ANTES de desplazar. Entre carpetas con norma se desplaza sin más (como hasta ahora).
    const errores = [], normaDe = (r) => ((p.arbol || []).find(x => x.ruta === r) || {}).normaEfectiva || '';
    let conRejilla = normaDe(dest) ? lista.filter(c => !c.copia && c.ultima && (c.retencion || !normaDe(c.carpeta))) : [], arreglos = new Map();
    if (conRejilla.length) {
      const res = await N.rejillaConformidad(p, dest, conRejilla.map(c => ({ nombre: c.ultima.archivo, tam: c.ultima.tamano, ref: c })), { modo: 'desplazar' });
      if (!res) return;
      for (const r of res) arreglos.set(r.ref.id, r);
      lista = lista.filter(c => !conRejilla.includes(c) || arreglos.has(c.id));   // lo que se quitó de la rejilla no se desplaza
    }
    for (const c of lista) {
      try {
        const a = arreglos.get(c.id);
        if (a) {
          if (a.nombre !== a.original) await api('/api/proyectos/' + p.id + '/contenedores/' + c.id + '/renombrar', { json: { nombre: a.nombre, carpeta: dest } });
          await api('/api/proyectos/' + p.id + '/contenedores/' + c.id + '/atributos', { method: 'PUT', json: { atributos: a.atributos, revision: a.revision || undefined, idoneidad: a.idoneidad || undefined } });
        }
        await api('/api/proyectos/' + p.id + '/contenedores/' + c.id + '/mover', { json: { carpeta: dest, copia: !!c.copia } });
      } catch (e) { errores.push(c.nombre + ': ' + e.message); }
    }
    N.toast(errores.length ? esc(errores.join(' · ')) : (lista.length > 1 ? lista.length + ' elementos desplazados' : 'Desplazado') + ' a ' + esc(dest.split('/').pop() || 'Archivos de proyecto'), errores.length ? 'mal' : '');
    vistaProyecto(p.id);
  }
  /** «Copiar a otra carpeta» (v0.14.3): el original se queda donde está y en el destino nace otro documento con la última versión.
   *  Si el destino tiene norma (compartido / publicado) se abre la misma rejilla de la carga para completar los metadatos que esa carpeta
   *  exige; si es una carpeta libre, se pide el nombre de la copia. Cada documento del proyecto lleva un nombre único. */
  async function copiaContenedores(p, lista) {
    lista = lista.filter(c => c.ultima && !c.copia); if (!lista.length) return N.toast('No hay nada que copiar en la selección.', 'mal');
    const aqui = new Set(lista.map(c => c.retencion || c.carpeta));
    const dest = await eligeDestino(p, { titulo: 'Copiar a otra carpeta', boton: 'Copiar aquí', inicial: [...aqui][0], texto: (lista.length > 1 ? lista.length + ' documentos' : esc(lista[0].nombre)) + ' <span class="etq">se copia; el original se queda</span>',
      apagada: () => '', permitida: (c) => !!c.subir, motivo: () => 'Sin permiso de carga en esta carpeta' });
    if (dest === null) return;
    const normaDe = (r) => ((p.arbol || []).find(x => x.ruta === r) || {}).normaEfectiva || '', errores = [], hechos = [];
    let planes = [];
    if (normaDe(dest)) {
      const res = await N.rejillaConformidad(p, dest, lista.map(c => ({ nombre: c.ultima.archivo, tam: c.ultima.tamano, ref: c, inicial: { atributos: c.atributos || {} } })), { modo: 'copiar', sinAnadir: true });
      if (!res) return;
      planes = res.map(r => ({ c: r.ref, nombre: r.nombre, atributos: r.atributos, revision: r.revision, idoneidad: r.idoneidad }));
    } else {
      for (const c of lista) {
        const ar = c.ultima.archivo, pt = ar.lastIndexOf('.'), base = pt > 0 ? ar.slice(0, pt) : ar, ext = pt > 0 ? ar.slice(pt) : '';
        let n = base + ' - copia';
        if (lista.length === 1) { n = await N.pide('Copiar a otra carpeta', 'Nombre de la copia (el original conserva el suyo)', n, 'Copiar'); if (!n) return; n = n.trim(); if (ext && n.toLowerCase().endsWith(ext.toLowerCase())) n = n.slice(0, -ext.length); }
        planes.push({ c, nombre: n + ext });
      }
    }
    for (const pl of planes) {
      try { await api('/api/proyectos/' + p.id + '/contenedores/' + pl.c.id + '/copiar', { json: { carpeta: dest, nombre: pl.nombre, atributos: pl.atributos || {}, revision: pl.revision || undefined, idoneidad: pl.idoneidad || undefined } }); hechos.push(pl.nombre); }
      catch (e) { errores.push(pl.c.nombre + ': ' + e.message); }
    }
    const donde = esc(dest.split('/').pop() || 'Archivos de proyecto');
    N.toast(errores.length ? (hechos.length ? hechos.length + ' copiado(s) a ' + donde + '. ' : '') + 'No se copió: ' + esc(errores.join(' · ')) : (hechos.length > 1 ? hechos.length + ' documentos copiados' : 'Copiado') + ' a ' + donde, errores.length ? 'mal' : '');
    vistaProyecto(p.id);
  }
  async function desplazaCarpetas(p, rutas) {
    const padres = new Set(rutas.map(r => r.split('/').slice(0, -1).join('/')));
    const dest = await eligeDestino(p, { titulo: 'Seleccionar carpeta de destino', boton: 'Desplazar', inicial: [...padres][0], texto: rutas.length > 1 ? rutas.length + ' carpetas' : 'Carpeta <b>' + esc(rutas[0].split('/').pop()) + '</b>',
      apagada: (r) => rutas.some(x => r === x || r.startsWith(x + '/')) ? 'No se puede desplazar dentro de sí misma' : (padres.size === 1 && padres.has(r) ? 'Ya está aquí' : ''), permitida: (c) => c.editar || c.control, motivo: () => 'Hace falta permiso de edición', raiz: R[p.rol] >= 3 });
    if (dest === null) return;
    if (!(await N.confirma('¿Mover carpeta?', 'La carpeta heredará los permisos de la carpeta de destino. Si se aplica una norma de nomenclatura propia, se conservará esa configuración. Los archivos que no cumplan la norma del destino no se mueven.', 'Continuar'))) return;
    const errores = []; let ultima = '';
    for (const r of rutas) { try { const x = await api('/api/proyectos/' + p.id + '/carpetas/mover', { json: { ruta: r, destino: dest } }); ultima = x.ruta; } catch (e) { errores.push(r.split('/').pop() + ': ' + e.message); } }
    if (ultima && rutas.length === 1) N.FILTRO.carpeta = dest; if (dest) N.ABIERTAS.add(dest);
    N.toast(errores.length ? esc(errores.join(' · ')) : 'Desplazada a ' + esc(dest.split('/').pop() || 'Archivos de proyecto'), errores.length ? 'mal' : '');
    p._zona = undefined; vistaProyecto(p.id);
  }
  /** Suprimir carpetas (con sus subcarpetas y archivos): van a «Elementos suprimidos» y se pueden restaurar. */
  async function suprimeCarpetas(p, rutas) {
    rutas = rutas.filter(r => r && !rutas.some(x => x !== r && r.startsWith(x + '/')));
    if (!rutas.length || !(await N.confirma('Eliminar ' + (rutas.length > 1 ? rutas.length + ' carpetas' : 'la carpeta «' + rutas[0].split('/').pop() + '»'), 'Se eliminan también sus subcarpetas y archivos. Todo va a «Elementos suprimidos» y se puede restaurar.', 'Eliminar'))) return;
    const errores = []; let nc = 0, na = 0;
    for (const ruta of rutas) { try { const r = await api('/api/proyectos/' + p.id + '/carpetas/suprimir', { json: { ruta } }); nc += r.carpetas; na += r.archivos; if (N.FILTRO.carpeta === ruta || N.FILTRO.carpeta.startsWith(ruta + '/')) N.FILTRO.carpeta = ruta.split('/').slice(0, -1).join('/'); } catch (e) { errores.push(ruta.split('/').pop() + ': ' + e.message); } }
    N.toast(errores.length ? esc(errores.join(' · ')) : 'Carpeta eliminada (' + nc + ' carpeta(s), ' + na + ' archivo(s)) · <a href="#/p/' + p.id + '/archivos/suprimidos">ver suprimidos</a>', errores.length ? 'mal' : '');
    recargaDe(p)();
  }
  async function suprimeContenedores(p, lista) {
    if (!lista.length || !confirm('¿Suprimir ' + (lista.length > 1 ? lista.length + ' archivos' : '«' + lista[0].nombre + '»') + '? Van a «Elementos suprimidos» y se pueden restaurar.')) return;
    const errores = []; for (const c of lista) { try { await api('/api/proyectos/' + p.id + '/contenedores/' + c.id, { method: 'DELETE' }); } catch (e) { errores.push(c.nombre + ': ' + e.message); } }
    N.toast(errores.length ? esc(errores.join(' · ')) : (lista.length > 1 ? lista.length + ' archivos suprimidos' : 'Archivo suprimido') + ' · <a href="#/p/' + p.id + '/archivos/suprimidos">ver suprimidos</a>', errores.length ? 'mal' : '');
    vistaProyecto(p.id);
  }
  /** Exportar registro de archivos: la lista de la carpeta (y subcarpetas) a Excel, como el de Autodesk Docs. */
  async function exportaRegistro(p, ruta, soloIds, formato) {
    try {
      const [d, XL] = await Promise.all([api('/api/proyectos/' + p.id + '/contenedores?carpeta=' + encodeURIComponent(ruta || '') + '&sub=1'), N.carga('vendor/xlsx.full.min.js', 'XLSX')]);
      const L = d.contenedores.filter(c => !soloIds || soloIds.includes(c.id));
      const cab = ['Nombre', 'Descripción', 'Versión', 'Revisión', 'Idoneidad', 'Estado', 'Aprobado por', 'Tipo', 'Carpeta', 'Tamaño (bytes)', 'Última actualización', 'Actualizado por', 'Organización', 'Creado', 'Creado por', 'En revisión'];
      const filas = [['Registro de archivos'], ['Proyecto', p.codigo + ' · ' + p.nombre], ['Carpeta', ruta || 'Archivos de proyecto'], ['Exportado', new Date().toLocaleString('es-PE') + ' por ' + ((N.YO && N.YO.email) || '')], [], cab]
        .concat(L.map(c => { const u = c.ultima || {}; return [c.nombre, c.descripcion || '', u.n ? 'V' + u.n : '', u.revision || '', u.idoneidad || '', estadoTxtFila(p, c), c.aprobado_por || '', c.tipo, c.carpeta_vista || c.carpeta, u.tamano || 0, c.actualizado || '', u.subido_por || '', u.org || '', c.creado || '', c.creado_por || '', c.revision_abierta ? 'sí' : '']; }));
      const ws = XL.utils.aoa_to_sheet(filas); ws['!cols'] = cab.map((x, i) => ({ wch: i === 0 ? 38 : i === 7 ? 46 : 16 })); const wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, ws, 'Registro de archivos');
      const base = p.codigo + '-registro-' + (ruta ? ruta.split('/').pop() : 'proyecto').replace(/[\/:*?"<>|]+/g, '_') + '-' + new Date().toISOString().slice(0, 10);
      if (formato === 'csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + XL.utils.sheet_to_csv(XL.utils.aoa_to_sheet(filas.slice(5)), { FS: ';' })], { type: 'text/csv' })); a.download = base + '.csv'; a.click(); }
      else XL.writeFile(wb, base + '.xlsx');
      N.toast(L.length + ' archivo(s) exportados');
    } catch (e) { N.toast(esc(e.message), 'mal'); }
  }
  /** «Exportar registro» (Excel o CSV): primero pregunta el alcance — todo lo de la carpeta o los documentos que se elijan. */
  async function exportarRegistroDlg(p, ruta, formato, preSel) {
    const d = await api('/api/proyectos/' + p.id + '/contenedores?carpeta=' + encodeURIComponent(ruta || '') + '&sub=1'), L = d.contenedores, pre = new Set(preSel || []);
    const v = ventana('Exportar registro · ' + (formato === 'csv' ? 'CSV' : 'Excel'), '<div class="pista" style="margin-bottom:8px">Carpeta: <b>' + esc(ruta || 'Archivos de proyecto') + '</b> (incluye subcarpetas) · ' + L.length + ' documento(s)</div>' +
      '<label class="rvchk"><input type="radio" name="exA" value="todo"' + (pre.size ? '' : ' checked') + '> <b>Exportar todo en carpeta</b></label><label class="rvchk"><input type="radio" name="exA" value="sel"' + (pre.size ? ' checked' : '') + '> <b>Seleccionar documentos</b></label>' +
      '<div id="exLista" class="exlista"><label class="rvchk"><input type="checkbox" id="exTodos"> <i>Marcar / desmarcar todos</i></label>' + L.map(c => '<label class="rvchk"><input type="checkbox" data-ex="' + c.id + '"' + (pre.has(c.id) ? ' checked' : '') + '> <span class="mono">' + esc(c.nombre) + '</span> <span class="pista">' + esc(c.carpeta_vista || c.carpeta) + '</span></label>').join('') + '</div>' +
      '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><button id="exNo">Cancelar</button><button class="primario" id="exOk">Exportar</button></div>', { ancho: 640, alto: 520 });
    const lista = v.querySelector('#exLista'), modo = () => v.querySelector('input[name="exA"]:checked').value, pinta = () => { lista.style.display = modo() === 'sel' ? '' : 'none'; };
    v.querySelectorAll('input[name="exA"]').forEach(x => x.onchange = pinta); pinta();
    v.querySelector('#exTodos').onchange = (e) => v.querySelectorAll('[data-ex]').forEach(x => x.checked = e.target.checked);
    v.querySelector('#exNo').onclick = () => v.closest('.ventana').remove();
    v.querySelector('#exOk').onclick = () => { const ids = modo() === 'sel' ? [...v.querySelectorAll('[data-ex]:checked')].map(x => x.dataset.ex) : null; if (ids && !ids.length) return N.toast('Marca al menos un documento.', 'mal'); v.closest('.ventana').remove(); exportaRegistro(p, ruta, ids, formato); };
  }
  /** Crear informe de transmision: un transmittal (correspondencia) con la ultima version de los archivos adjunta. */
  /** Crear informe de transmision desde una carpeta, un archivo o la seleccion: abre el dialogo de Informes de transmision con los archivos ya puestos. */
  async function transmision(p, ruta, lista) {
    try {
      const L = (lista || (await api('/api/proyectos/' + p.id + '/contenedores?carpeta=' + encodeURIComponent(ruta || '') + '&sub=1')).contenedores).filter(c => c.ultima && c.ultima.id && !c.copia).slice(0, 1000);
      if (!L.length) return N.toast('No hay archivos con versión que transmitir aquí.', 'mal');
      N.crearInformeCon(p, L, ruta ? 'Transmisión · ' + ruta.split('/').pop() : L.length === 1 ? 'Transmisión · ' + L[0].nombre : '', () => {});
    } catch (e) { N.toast(esc(e.message), 'mal'); }
  }
  /** Detalles del desencadenador automatico: al cargar en la carpeta, lo COMPARTIDO entra solo al flujo elegido. */
  async function disparadorDlg(p, ruta) {
    const c = p.arbol.find(x => x.ruta === ruta) || {}, fd = await api('/api/proyectos/' + p.id + '/flujos'), flujos = fd.flujos.filter(f => f.activo !== false), puede = !!c.control;
    const actual = c.disparador || '', fl = (id) => flujos.find(f => f.id === id);
    const v = ventana('Desencadenador automático · ' + ruta.split('/').pop(), '<p class="pista">Como en Autodesk Docs: cuando alguien carga un archivo en esta carpeta y queda <b>COMPARTIDO</b>, se inicia solo el flujo de revisión elegido (lo inicia quien carga; el comentario lo dice).</p>' +
      (c.zonaEfectiva !== 'compartido' ? '<div class="aviso ambar">Esta carpeta es de zona <b>' + esc(ZONA_TXT[c.zonaEfectiva] || 'sin zona') + '</b>: lo que se carga aquí no nace COMPARTIDO y el desencadenador no se dispara. Úsalo en una carpeta COM.</div>' : '') +
      '<label>Flujo que se inicia al cargar</label><select id="dsF"' + (puede ? '' : ' disabled') + '><option value="">(ninguno: sin desencadenador)</option>' + flujos.map(f => '<option value="' + esc(f.id) + '"' + (f.id === actual ? ' selected' : '') + '>' + esc(f.nombre) + '</option>').join('') + '</select><div id="dsTxt" class="pista" style="margin-top:6px"></div>' +
      (puede ? '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="primario" id="dsOk">Guardar</button></div>' : '<p class="pista">Solo quien tiene <b>control</b> sobre la carpeta cambia el desencadenador.</p>') + '<div id="dsMsg"></div>', { ancho: 600, alto: 380, x: Math.max(20, innerWidth / 2 - 300), y: 110 });
    const s = v.querySelector('#dsF'), txt = () => { const f = fl(s.value); v.querySelector('#dsTxt').innerHTML = f ? f.etapas.map((e, i) => (i + 1) + '. ' + esc(e.nombre) + (e.pasos.length > 1 ? ' (en paralelo)' : '')).join(' → ') + ' · al aprobar: ' + esc(f.alAprobar.estado) : ''; };
    s.onchange = txt; txt();
    const okb = v.querySelector('#dsOk'); if (okb) okb.onclick = async () => { try { await api('/api/proyectos/' + p.id + '/carpetas', { method: 'PUT', json: { ruta, disparador: s.value ? { flujo: s.value } : null } }); v.closest('.ventana').remove(); N.toast(s.value ? 'Desencadenador guardado' : 'Desencadenador quitado'); vistaProyecto(p.id); } catch (e) { aviso(v.querySelector('#dsMsg'), e); } };
  }
  async function propiedades(p, ruta) {
    const c = p.arbol.find(x => x.ruta === ruta) || {}; let d = {}; try { d = await api('/api/proyectos/' + p.id + '/carpetas/permisos?ruta=' + encodeURIComponent(ruta)); } catch (e) {}
    ventana('Propiedades · ' + ruta.split('/').pop(), '<table><tr><td class="pista">Ruta</td><td class="mono">' + esc(ruta) + '</td></tr><tr><td class="pista">Zona ISO 19650</td><td>' + esc(ZONA_TXT[c.zonaEfectiva] || 'sin zona') + (c.zona ? '' : c.zonaEfectiva ? ' <span class="pista">(heredada)</span>' : '') + '</td></tr><tr><td class="pista">Tu permiso</td><td>' + esc(c.paso ? 'sin acceso (carpeta de paso)' : NIVEL_TXT[c.permiso] || '—') + '</td></tr><tr><td class="pista">Permisos</td><td>' + (d.propios ? 'propios' : d.heredadasDe ? 'heredados de ' + esc(d.heredadasDe) : '—') + (d.entradas ? '<div class="pista">' + d.entradas.map(e => esc(e.tipo === '*' ? 'Todos' : e.valor) + ': ' + esc(NIVEL_TXT[e.nivel] || e.nivel)).join(' · ') + '</div>' : '') + '</td></tr><tr><td class="pista">Descripción</td><td>' + (esc(c.nota) || '—') + '</td></tr><tr><td class="pista">Contenido</td><td>' + num(c.nAbajo || 0) + ' contenedor(es) aquí y en subcarpetas</td></tr><tr><td class="pista">Desencadenador</td><td>' + (c.disparador ? esc(c.disparador) : '—') + '</td></tr></table>', { ancho: 620, alto: 360, x: Math.max(20, innerWidth / 2 - 310), y: 110 });
  }

  /** Menu ⋮ de una carpeta: el de Autodesk Docs (imagen de Erick, 9/11/2026). */
  function menuCarpeta(p, ruta, boton) {
    const pid = p.id, gestor = R[p.rol] >= 3, recarga = recargaDe(p), nombre = ruta ? ruta.split('/').pop() : 'Archivos de proyecto';
    const c = ruta ? (p.arbol.find(x => x.ruta === ruta) || {}) : { control: gestor, editar: gestor, subir: !!p.carpetaWip, descargar: true };
    const ed = !!(c.editar || c.control), sinEd = ed ? false : 'Hace falta permiso de edición sobre la carpeta';
    const ordena = (o) => () => { N.FILTRO.orden = o; N.FILTRO.carpeta = ruta; if (ruta) N.ABIERTAS.add(ruta); recarga(); };
    const destCarga = ruta && c.subir ? ruta : (!ruta ? p.carpetaWip : '');
    const ops = [
      { ico: 'mas', texto: 'Añadir subcarpeta', off: sinEd, accion: async () => { const n = await N.pide('Añadir subcarpeta', 'Nombre de la subcarpeta en ' + nombre, '', 'Añadir'); if (!n) return; try { await api('/api/proyectos/' + pid + '/carpetas', { json: { padre: ruta, nombre: n } }); if (ruta) N.ABIERTAS.add(ruta); N.toast('Carpeta «' + esc(n) + '» añadida'); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } } }
    ];
    if (ruta) ops.push(
      { ico: 'lapiz', texto: 'Cambiar nombre', off: sinEd, accion: async () => { const n = await N.pide('Cambiar nombre', 'Nuevo nombre', nombre, 'Guardar'); if (!n || n === nombre) return; try { const r = await api('/api/proyectos/' + pid + '/carpetas', { method: 'PUT', json: { ruta, nombre: n } }); if (N.FILTRO.carpeta === ruta || N.FILTRO.carpeta.startsWith(ruta + '/')) N.FILTRO.carpeta = r.ruta + N.FILTRO.carpeta.slice(ruta.length); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } } },
      { ico: 'desplazar', texto: 'Mover a otra carpeta', off: sinEd, accion: () => desplazaCarpetas(p, [ruta]) },
      { ico: 'papelera', texto: 'Eliminar', off: sinEd, accion: () => suprimeCarpetas(p, [ruta]) }
    );
    ops.push({ ico: 'ordenar', texto: 'Ordenar por', sub: [{ texto: 'Nombre (A → Z)', accion: ordena('nombre') }, { texto: 'Nombre (Z → A)', accion: ordena('-nombre') }, { texto: 'Última actualización', accion: ordena('-fecha') }, { texto: 'Tamaño', accion: ordena('-tamano') }, { texto: 'Estado', accion: ordena('estado') }] });
    if (ruta) ops.push({ ico: 'descargar', texto: 'Descargar carpeta', ayuda: 'La última versión de cada archivo de esta carpeta y de sus subcarpetas, en un ZIP (solo lo que tu permiso deja descargar).', off: c.paso ? 'Sin acceso a esta carpeta' : false, accion: () => { location.href = '/api/proyectos/' + pid + '/carpetas/descargar?ruta=' + encodeURIComponent(ruta); } });
    N.menuFlotante(boton, ops);
  }
  const RX_MODELO = /\.(ifc|rvt|nwd|nwc|nwf)$/i;
  const abreDoc = (p, c) => { const u = c.ultima || {}; if (esPdf(c) && u.id) return N.marcasVentana(p, c, u.id, 'contenido'); if (seVe(c) && u.id) return verArchivo(p, c, u.id); if (u.id && (u.modelo || RX_MODELO.test(u.archivo || ''))) return window.open('visor.html?pid=' + p.id + '&vid=' + u.id, '_blank'); /* un modelo SIEMPRE abre el visor (si aun se esta leyendo, el visor muestra el avance) */ location.hash = '#/p/' + p.id + '/c/' + c.id; };
  const opAbrir = (p, c) => ({ ico: 'abrir', texto: 'Abrir', accion: () => abreDoc(p, c) });
  const opFicha = (p, c) => ({ ico: 'info', texto: 'Ficha de documento', accion: () => { location.hash = '#/p/' + p.id + '/c/' + c.id; } });
  const opDescarga = (p, c) => ({ ico: 'descargar', texto: 'Descargar', off: (c.ultima || {}).id ? false : 'Sin versiones', accion: () => { location.href = '/api/proyectos/' + p.id + '/versiones/' + c.ultima.id + '/descargar'; } });
  /** Menu ⋮ de un documento: solo Abrir, Ficha de documento y Descargar. */
  function menuContenedor(p, c, boton) { N.menuFlotante(boton, [opAbrir(p, c), opFicha(p, c), opDescarga(p, c)], 'derecha'); }
  /** Menu al hacer clic en el documento: Abrir · Opciones de documento ▸ · Flujos y observaciones ▸ */
  function menuDocumento(p, c, ancla, quitaSel) {
    const pid = p.id, u = c.ultima || {}, def = p.arbol.find(x => x.ruta === c.carpeta) || {}, sinEd = !(def.editar || R[p.rol] >= 3) ? 'Hace falta permiso de edición sobre su carpeta' : false;
    N.menuFlotante(ancla, [opAbrir(p, c),
      { ico: 'archivo', texto: 'Opciones de documento', sub: [opFicha(p, c),
        { ico: 'lapiz', texto: 'Cambiar nombre', off: c.copia ? 'Es la copia publicada' : !(def.editar || def.subir || R[p.rol] >= 3) ? 'Hace falta permiso sobre su carpeta' : false, accion: () => N.renombrarDlg(p, c, () => vistaProyecto(pid)) },
        opDescarga(p, c),
        { ico: 'compartir', texto: 'Compartir', accion: () => N.compartirArchivo(p, c) },
        { ico: 'desplazar', texto: 'Mover a otra carpeta', off: sinEd, accion: () => desplazaContenedores(p, [c]) },
        { ico: 'copiar', texto: 'Copiar a otra carpeta', accion: () => copiaContenedores(p, [c]) },
        { ico: 'carpetaMas', texto: 'Agregar a conjunto', accion: () => N.anadirAConjunto(p, [c]) },
        { ico: 'papelera', texto: 'Eliminar', off: c.copia ? 'Es la copia publicada' : c.revision_abierta ? 'Tiene una revisión abierta' : sinEd, accion: () => suprimeContenedores(p, [c]) },
        { ico: 'lapiz', texto: 'Editar metadatos', accion: () => N.atributosDlg(p, c, () => vistaProyecto(pid)) },
        { ico: 'cerrar', texto: 'Quitar selección', accion: () => quitaSel && quitaSel() }] },
      { ico: 'revision', texto: 'Flujos y observaciones', sub: [
        { ico: 'revision', texto: 'Enviar a Revisión contractual', off: revisable(p, c) ? false : c.revision_abierta ? 'Ya tiene una revisión abierta' : c.copia ? 'Es la copia publicada' : 'Se revisa lo que está en una carpeta compartida (muévelo a una carpeta COM)', accion: () => N.nuevaRevision(p, { ids: [c.id] }) },
        { ico: 'transmision', texto: 'Enviar como Avance de Proyecto', off: u.id ? false : 'Sin versiones', accion: () => transmision(p, null, [c]) },
        { ico: 'marca', texto: 'Marcas en documento' + (c.n_marcas ? ' (' + c.n_marcas + ')' : ''), off: u.id ? false : 'Sin versiones', accion: () => N.marcasVentana(p, c, u.id) },
        { ico: 'info', texto: 'Observaciones contractuales' + (c.n_incidencias ? ' (' + c.n_incidencias + ')' : ''), accion: () => { location.hash = '#/p/' + pid + '/c/' + c.id; } }] }]);
  }
  // ─────────── Módulo «Permisos»: Ver permisos · Agregar permisos (por Rol, sobre las carpetas que se elijan) ───────────
  const ROLES_TXT = N.ROLES_TXT;
  /** Lo que se puede elegir como «Rol» al dar permisos: las FUNCIONES de los usuarios del proyecto (A-ESP-DOC…) y, además, los accesos generales. Clave = tipo:valor. */
  const rolesDe = (p) => { const fs = {}; (p.miembros || []).forEach(m => { if (m.funcion) fs[m.funcion] = (fs[m.funcion] || []).concat([m.puesto + ' · ' + m.disciplina + ' (' + m.empresa + ')']); });
    return Object.keys(fs).sort().map(f => ({ clave: 'funcion:' + f, txt: f + ' — ' + fs[f][0] })).concat(['lector', 'miembro', 'document-control', 'revisor', 'revisor-dc', 'gestor'].map(r => ({ clave: 'rol:' + r, txt: 'Acceso: ' + ROLES_TXT[r] }))); };
  const claveDe = (e) => e.tipo + ':' + String(e.valor || '')[e.tipo === 'rol' ? 'toLowerCase' : 'toUpperCase'](), esRol = (e) => e.tipo === 'rol' || e.tipo === 'funcion';
  const NIVELES = Object.keys(NIVEL_TXT);
  /** Árbol de carpetas con casillas para elegir a cuáles se aplican los permisos. Devuelve las rutas elegidas (o null). */
  function eligeCarpetasPermiso(p, pre) {
    return new Promise((ok) => {
      const L = p.arbol.filter(c => !c.paso), puede = (c) => c.control || R[p.rol] >= 3, marc = new Set(pre || []);
      const v = ventana('Agregar permisos · elige las carpetas', '<p class="pista" style="margin-top:0">Marca las carpetas a las que se aplicarán los permisos. Las subcarpetas sin permisos propios heredan los de su carpeta madre.</p><div class="exlista" style="max-height:none;flex:1;overflow:auto">' +
        L.map(c => '<label class="rvchk" style="padding-left:' + (c.ruta.split('/').length - 1) * 20 + 'px"><input type="checkbox" data-pc="' + esc(c.ruta) + '"' + (marc.has(c.ruta) ? ' checked' : '') + (puede(c) ? '' : ' disabled title="Solo quien tiene control sobre la carpeta"') + '> <span class="mico" style="display:inline-block;width:16px;vertical-align:middle">' + (N.ICO.abrir || '') + '</span> <span' + (puede(c) ? '' : ' class="pista"') + '>' + esc(c.ruta.split('/').pop()) + '</span></label>').join('') +
        '</div><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><span class="pista" id="pcN" style="flex:1"></span><button id="pcNo">Cancelar</button><button class="primario" id="pcOk">Continuar</button></div>', { ancho: 560, alto: 600 });
      v.style.display = 'flex'; v.style.flexDirection = 'column';
      const cuenta = () => { v.querySelector('#pcN').textContent = v.querySelectorAll('[data-pc]:checked').length + ' carpeta(s) elegida(s)'; }; v.querySelectorAll('[data-pc]').forEach(x => x.onchange = cuenta); cuenta();
      v.querySelector('#pcNo').onclick = () => { v.closest('.ventana').remove(); ok(null); };
      v.querySelector('#pcOk').onclick = () => { const r = [...v.querySelectorAll('[data-pc]:checked')].map(x => x.dataset.pc); if (!r.length) return N.toast('Marca al menos una carpeta.', 'mal'); v.closest('.ventana').remove(); ok(r); };
    });
  }
  /** «Agregar permisos»: 1) carpetas; 2) filas Rol · Permiso con «+». En una sola carpeta las filas reemplazan sus permisos por rol; en varias, se suman. */
  async function agregarPermisos(p, pre) {
    const rutas = await eligeCarpetasPermiso(p, pre); if (!rutas) return;
    const datos = await Promise.all(rutas.map(r => api('/api/proyectos/' + p.id + '/carpetas/permisos?ruta=' + encodeURIComponent(r))));
    datos.forEach(d => d.entradas.forEach(e => { if (e.tipo === 'rol') e.valor = String(e.valor || '').toLowerCase(); }));
    const una = rutas.length === 1, roles = rolesDe(p);
    let filas = una ? datos[0].entradas.filter(esRol).map(e => ({ rol: claveDe(e), nivel: e.nivel })) : []; if (!filas.length) filas = [{ rol: roles[0].clave, nivel: 'ver-descargar' }];
    const otros = una ? datos[0].entradas.filter(e => !esRol(e)) : [];
    const v = ventana('Permisos', '', { ancho: 620, alto: 500 });
    const pinta = () => {
      v.innerHTML = '<div class="pista">Se aplican a ' + (una ? 'la carpeta' : rutas.length + ' carpetas') + ':</div><div class="mono pista" style="max-height:74px;overflow:auto;margin-bottom:8px">' + rutas.map(esc).join('<br>') + '</div>' +
        '<table class="chica"><thead><tr><th>Rol</th><th>Permiso</th><th style="width:40px"></th></tr></thead><tbody>' + filas.map((f, i) => '<tr><td><select data-fr="' + i + '">' + roles.concat(roles.some(r => r.clave === f.rol) ? [] : [{ clave: f.rol, txt: f.rol.split(':')[1] }]).map(r => '<option value="' + esc(r.clave) + '"' + (r.clave === f.rol ? ' selected' : '') + '>' + esc(r.txt) + '</option>').join('') + '</select></td><td><select data-fn="' + i + '">' + NIVELES.map(k => '<option value="' + k + '"' + (k === f.nivel ? ' selected' : '') + '>' + NIVEL_TXT[k] + '</option>').join('') + '</select></td><td><button class="mini" data-fq="' + i + '" title="Quitar">✕</button></td></tr>').join('') + '</tbody></table>' +
        '<div style="margin:8px 0"><button id="prMas" title="Agregar otro permiso">＋ Agregar otro rol</button></div>' +
        (otros.length ? '<div class="pista">Además se conservan ' + otros.length + ' permiso(s) ya dados por empresa o por usuario en esta carpeta (se ven en «Ver permisos»).</div>' : '') +
        '<p class="pista">El <b>rol</b> es la función de cada usuario (empresa, cargo y disciplina), que se define al agregarlo en «Usuarios de proyecto». ' + (una ? 'Lo que dejes aquí reemplaza los permisos por rol de la carpeta.' : 'En varias carpetas, estos permisos se suman a los que cada una ya tiene.') + '</p>' +
        '<div class="fila" style="gap:8px;margin-top:6px"><button class="primario" id="prOk">Guardar</button>' + (una && datos[0].propios ? '<button id="prHer">Volver a heredar del padre</button>' : '') + '</div><div id="prMsg"></div>';
      v.querySelectorAll('[data-fr]').forEach(x => x.onchange = () => { filas[+x.dataset.fr].rol = x.value; }); v.querySelectorAll('[data-fn]').forEach(x => x.onchange = () => { filas[+x.dataset.fn].nivel = x.value; });
      v.querySelectorAll('[data-fq]').forEach(b => b.onclick = () => { filas.splice(+b.dataset.fq, 1); pinta(); });
      v.querySelector('#prMas').onclick = () => { filas.push({ rol: (roles.find(r => !filas.some(f => f.rol === r.clave)) || roles[0]).clave, nivel: 'ver-descargar' }); pinta(); };
      v.querySelector('#prOk').onclick = async () => {
        const limp = filas.filter((f, i) => filas.findIndex(x => x.rol === f.rol) === i).map(f => ({ tipo: f.rol.split(':')[0], valor: f.rol.slice(f.rol.indexOf(':') + 1), nivel: f.nivel }));
        try { for (let i = 0; i < rutas.length; i++) { const prev = datos[i].entradas, permisos = una ? prev.filter(e => !esRol(e)).concat(limp) : prev.filter(e => !(esRol(e) && limp.some(x => claveDe(x) === claveDe(e)))).concat(limp); await api('/api/proyectos/' + p.id + '/carpetas', { method: 'PUT', json: { ruta: rutas[i], permisos } }); }
          v.closest('.ventana').remove(); N.toast('Permisos guardados en ' + rutas.length + ' carpeta(s).', 'bien'); vistaProyecto(p.id); } catch (e) { aviso(v.querySelector('#prMsg'), e); }
      };
      const h = v.querySelector('#prHer'); if (h) h.onclick = async () => { try { await api('/api/proyectos/' + p.id + '/carpetas', { method: 'PUT', json: { ruta: rutas[0], permisos: [] } }); v.closest('.ventana').remove(); vistaProyecto(p.id); } catch (e) { aviso(v.querySelector('#prMsg'), e); } };
    };
    pinta();
  }
  /** «Ver permisos»: Correo · Rol · Tipo de permiso de cada usuario en la carpeta elegida. */
  async function verPermisos(p, rutaIni) {
    const L = p.arbol.filter(c => !c.paso); if (!L.length) return N.toast('No hay carpetas.', 'mal');
    let ruta = rutaIni && L.some(c => c.ruta === rutaIni) ? rutaIni : L[0].ruta;
    const v = ventana('Ver permisos', '', { ancho: 720, alto: 560 });
    const pinta = async () => {
      let d; try { d = await api('/api/proyectos/' + p.id + '/carpetas/permisos?ruta=' + encodeURIComponent(ruta)); } catch (e) { d = { entradas: [], error: e.message }; }
      const ig = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(), toca = (e, m) => e.tipo === '*' || (e.tipo === 'org' && ig(e.valor, m.organizacion)) || (e.tipo === 'rol' && ig(e.valor, m.rol)) || (e.tipo === 'funcion' && ig(e.valor, m.funcion)) || (e.tipo === 'usuario' && ig(e.valor, m.email));
      const filas = (p.miembros || []).map(m => { const sup = m.rol === 'gestor' || m.rol === 'administrador', ns = d.entradas.filter(e => toca(e, m)).map(e => NIVELES.indexOf(e.nivel)), mx = sup ? NIVELES.length - 1 : Math.max(-1, ...ns); return { m, nivel: mx, sup }; }).sort((a, b) => b.nivel - a.nivel || a.m.email.localeCompare(b.m.email));
      v.innerHTML = '<label>Carpeta</label><select id="vpR">' + L.map(c => '<option value="' + esc(c.ruta) + '"' + (c.ruta === ruta ? ' selected' : '') + '>' + ' '.repeat((c.ruta.split('/').length - 1) * 3) + esc(c.ruta.split('/').pop()) + '</option>').join('') + '</select><div class="pista mono" style="margin:4px 0 8px">' + esc(ruta) + (d.heredadasDe ? ' · hereda de ' + esc(d.heredadasDe) : '') + '</div>' + (d.error ? '<div class="aviso rojo">' + esc(d.error) + '</div>' : '') +
        (p.miembros ? '<div class="acctabla" style="max-height:330px;overflow:auto"><table class="chica"><thead><tr><th>Correo</th><th>Rol</th><th>Tipo de permiso</th></tr></thead><tbody>' + filas.map(f => '<tr><td>' + esc(f.m.email) + ' <span class="pista">' + esc(f.m.organizacion || '') + '</span></td><td>' + (f.m.funcion ? '<span class="etq mono">' + esc(f.m.funcion) + '</span> ' : '') + '<span class="pista">' + esc(ROLES_TXT[f.m.rol] || f.m.rol) + '</span></td><td>' + (f.nivel < 0 ? '<span class="pista">Sin acceso</span>' : '<span class="etq">' + NIVEL_TXT[NIVELES[f.nivel]] + '</span>' + (f.sup ? ' <span class="pista">por ser ' + esc((ROLES_TXT[f.m.rol] || f.m.rol).toLowerCase()) + '</span>' : '')) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="aviso ambar">La lista de usuarios solo la ve el gestor del proyecto.</div>') +
        '<h3 style="margin:12px 0 4px">Permisos dados en la carpeta</h3>' + (d.entradas.length ? '<table class="chica"><thead><tr><th>A quién</th><th>Tipo de permiso</th></tr></thead><tbody>' + d.entradas.map(e => '<tr><td>' + (e.tipo === '*' ? 'Todos los usuarios' : e.tipo === 'funcion' ? 'Función: <span class="mono">' + esc(e.valor) + '</span>' : e.tipo === 'rol' ? 'Acceso: ' + esc(ROLES_TXT[String(e.valor).toLowerCase()] || e.valor) : e.tipo === 'org' ? 'Empresa: ' + esc(e.valor) : esc(e.valor)) + '</td><td>' + esc(NIVEL_TXT[e.nivel] || e.nivel) + '</td></tr>').join('') + '</tbody></table>' : '<div class="pista">Sin permisos definidos: solo la ven el gestor y el administrador.</div>') +
        '<div style="margin-top:10px"><button id="vpAdd">Agregar permisos a esta carpeta</button></div>';
      v.querySelector('#vpR').onchange = (e) => { ruta = e.target.value; pinta(); };
      v.querySelector('#vpAdd').onclick = () => { v.closest('.ventana').remove(); agregarPermisos(p, [ruta]); };
    };
    pinta();
  }
  async function editaPermisos(p, ruta) {
    const d = await api('/api/proyectos/' + p.id + '/carpetas/permisos?ruta=' + encodeURIComponent(ruta));
    let entradas = d.entradas.map(e => Object.assign({}, e)), propios = d.propios;
    const v = ventana('Permisos · ' + ruta.split('/').pop(), '', { ancho: 640, alto: 520 });
    const pinta = () => {
      v.innerHTML = '<div class="pista mono">' + esc(ruta) + '</div>' + (!propios && d.heredadasDe ? '<div class="aviso ambar">Hereda los permisos de <b>' + esc(d.heredadasDe) + '</b>. Al guardar aquí, esta carpeta (y las que cuelgan de ella sin permisos propios) pasan a usar los suyos.</div>' : (!propios ? '<div class="aviso ambar">Sin permisos definidos: solo gestores y administradores la ven.</div>' : '')) +
        '<table><tr><th>Quien</th><th>Nivel</th><th></th></tr>' + entradas.map((e, i) => '<tr><td>' + (e.tipo === '*' ? '<i>Todos los miembros</i>' : esc(e.tipo === 'org' ? 'Organizacion ' + e.valor : e.tipo === 'rol' ? 'Rol ' + e.valor : e.valor)) + '</td><td><select data-i="' + i + '" class="pNivel">' + Object.entries(NIVEL_TXT).map(([k, t]) => '<option value="' + k + '"' + (e.nivel === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td><td><button class="peligro" data-q="' + i + '">Quitar</button></td></tr>').join('') + '</table>' +
        '<div class="fila" style="align-items:flex-end;margin-top:8px"><div><label>Tipo</label><select id="pTipo"><option value="org">Organización</option><option value="rol">Rol</option><option value="usuario">Usuario (correo)</option><option value="*">Todos</option></select></div><div style="flex:1"><label>Valor</label><input id="pValor" list="dlPV" placeholder="GHEMET / revisor / correo"><datalist id="dlPV">' + (p.organizaciones || []).map(o => '<option value="' + esc(o) + '">').join('') + Object.keys(R).map(r => '<option value="' + r + '">').join('') + '</datalist></div><div><label>Nivel</label><select id="pN">' + Object.entries(NIVEL_TXT).map(([k, t]) => '<option value="' + k + '">' + t + '</option>').join('') + '</select></div><button id="pAdd">Agregar</button></div>' +
        '<div class="fila" style="margin-top:10px"><div style="flex:1"><label>Zona ISO 19650 (lo que se sube a una carpeta de zona "compartido" nace COMPARTIDO; al resto nace WIP)</label><select id="pZona">' + Object.entries(ZONA_TXT).map(([k, t]) => '<option value="' + k + '"' + (d.zona === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div><div style="flex:1"><label>Nota</label><input id="pNota" value="' + esc(d.nota) + '"></div></div>' +
        '<div class="fila" style="margin-top:10px"><button class="primario" id="pOk">Guardar</button>' + (propios ? '<button id="pHeredar">Volver a heredar del padre</button>' : '') + '</div><div id="pMsg"></div><p class="pista">Niveles como en Autodesk Docs: Ver · Ver+descargar · Solo subir (sube sin ver el contenido) · +subir · +editar (mover, renombrar, crear subcarpetas) · Control (ademas, permisos). El gestor y el administrador tienen control en todas.</p>';
      v.querySelectorAll('.pNivel').forEach(s => s.onchange = () => { entradas[+s.dataset.i].nivel = s.value; });
      v.querySelectorAll('button[data-q]').forEach(b => b.onclick = () => { entradas.splice(+b.dataset.q, 1); pinta(); });
      v.querySelector('#pAdd').onclick = () => { const tipo = v.querySelector('#pTipo').value, valor = v.querySelector('#pValor').value.trim(); if (tipo !== '*' && !valor) return; entradas.push({ tipo, valor, nivel: v.querySelector('#pN').value }); propios = true; pinta(); };
      v.querySelector('#pOk').onclick = async () => { try { await api('/api/proyectos/' + p.id + '/carpetas', { method: 'PUT', json: { ruta, permisos: entradas, zona: v.querySelector('#pZona').value, nota: v.querySelector('#pNota').value } }); v.closest('.ventana').remove(); vistaProyecto(p.id); } catch (e) { aviso(v.querySelector('#pMsg'), e); } };
      const h = v.querySelector('#pHeredar'); if (h) h.onclick = async () => { try { await api('/api/proyectos/' + p.id + '/carpetas', { method: 'PUT', json: { ruta, permisos: [] } }); v.closest('.ventana').remove(); vistaProyecto(p.id); } catch (e) { aviso(v.querySelector('#pMsg'), e); } };
    };
    pinta();
  }

  /** Orden de la tabla (Ordenar por / clic en la cabecera Nombre). Pura sobre la lista. */
  function ordenaLista(lista, orden, tipo) {
    const o = orden || 'nombre', desc = o.startsWith('-'), k = o.replace(/^-/, '');
    const val = (x) => tipo === 'carpeta' ? (k === 'nombre' ? x.nombre : k === 'tamano' ? x.nAbajo || 0 : x.nombre) : k === 'fecha' ? x.actualizado || '' : k === 'tamano' ? ((x.ultima || {}).tamano || 0) : k === 'estado' ? x.estado : x.nombre;
    return lista.slice().sort((a, b) => { const A = val(a), B = val(b); const r = typeof A === 'number' ? A - B : String(A).localeCompare(String(B), 'es', { numeric: true, sensitivity: 'base' }); return desc ? -r : r; });
  }

  async function vistaProyecto(pid) {
    const p = await api('/api/proyectos/' + pid);
    const F = N.FILTRO, gestor = R[p.rol] >= 3, porRuta = new Map(p.arbol.map(c => [c.ruta, c]));
    if (N.ABIERTAS_DE !== pid) { N.ABIERTAS = new Set(); N.ABIERTAS_DE = pid; if (conZonas(p)) despliegaZona(p); }   // al entrar: la estructura de la zona elegida, desplegada
    // si la carpeta elegida no es de la zona que se esta viendo, se sube a la mas cercana que si
    while (F.carpeta && porRuta.has(F.carpeta) && !zonaOk(p, porRuta.get(F.carpeta))) F.carpeta = F.carpeta.split('/').slice(0, -1).join('/');
    if (F.carpeta && !porRuta.has(F.carpeta) && !p.arbol.length) F.carpeta = '';
    const sel = F.carpeta, puedeSubir = R[p.rol] >= 1 && p.carpetasEscribibles.length > 0;
    const selDef = sel ? porRuta.get(sel) : null;
    const destCarga = sel ? (selDef && selDef.subir ? sel : '') : '';   // en «Archivos de proyecto» (la matriz) no se carga: se elige antes una carpeta
    const d = await api('/api/proyectos/' + pid + '/contenedores?carpeta=' + encodeURIComponent(sel) + (F.sub ? '&sub=1' : '') + (F.estado ? '&estado=' + F.estado : '') + (F.q ? '&q=' + encodeURIComponent(F.q) : ''));
    const enRaiz = !sel && !F.q && !F.estado && !F.sub;   // la matriz solo muestra sus carpetas; los archivos se ven al entrar a cada una (o al buscar / marcar «subcarpetas»)
    const conts = enRaiz ? [] : ordenaLista(d.contenedores.filter(c => { const f = porRuta.get(c.carpeta_vista || c.carpeta); return !f || zonaOk(p, f); }), F.orden);
    const cols = colsVisibles(p), on = (id) => cols.find(c => c.id === id).on, nomCols = cols.filter(x => x.id.startsWith('n:') && x.on);
    const carpetasHijas = (F.q || F.estado) ? [] : ordenaLista(hijosDe(arbolVisible(p), sel), F.orden && /nombre|tamano/.test(F.orden) ? F.orden : 'nombre', 'carpeta');
    const celda = (id, html, cls) => on(id) ? '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>' : '';
    const flechaOrden = (k) => (F.orden || 'nombre').replace(/^-/, '') === k ? ((F.orden || '').startsWith('-') ? ' ↓' : ' ↑') : '';
    const cab = (id, nombre, cls, k) => on(id) ? '<th' + (cls ? ' class="' + cls + '"' : '') + (k ? ' data-orden="' + k + '" style="cursor:pointer"' : '') + '>' + esc(nombre) + (k ? flechaOrden(k) : '') + '</th>' : '';
    const nCols = cols.filter(c => c.on).length;
    const filaCarpeta = (c) => '<tr class="item carpeta" data-c="' + esc(c.ruta) + '"><td class="chk"><input type="checkbox" data-sc="' + esc(c.ruta) + '"></td>' + celda('nombre', (c.zonaEfectiva && c.zonaEfectiva !== 'wip' ? ICO_CARPZ : ICO_CARP) + '<span class="nom">' + esc(c.nombre) + '</span>' + (c.disparador ? ' <span class="disp" title="Desencadenador automático">▶</span>' : ''), 'nombre') + celda('descripcion', esc(c.nota) || '--') + celda('version', '--') + celda('indicadores', c.zonaEfectiva ? '<span class="pista">' + esc(ZONA_TXT[c.zonaEfectiva]) + '</span>' : '--') + celda('marcas', '--') + celda('incidencias', '--') + celda('tamano', c.nAbajo ? c.nAbajo + ' elem.' : '--') + celda('actualizado', '--') + celda('por', '--') + celda('estado', '--') + celda('carpeta', esc(c.ruta)) + celda('tipo', 'carpeta') + celda('creado', '--') + nomCols.map(() => '<td>--</td>').join('') + '<td class="accion"><button class="mini puntos" data-mc="' + esc(c.ruta) + '">⋮</button></td></tr>';
    const filaCont = (c) => { const u = c.ultima || {}; const ind = (c.revision_abierta ? '<span class="ind rev" title="En revisión">⟳</span>' : '') + (u.modelo ? '<span class="ind mod" title="Modelo con geometría publicada (visor 3D)">⬡</span>' : '') + (c.estado === 'PUBLICADO' ? '<span class="ind pub" title="Publicado">✓</span>' : ''); return '<tr class="item" data-h="#/p/' + pid + '/c/' + c.id + '"><td class="chk"><input type="checkbox" data-sx="' + c.id + '"></td>' + celda('nombre', (ICO_ARCH[c.tipo] || ICO_ARCH.otro) + '<span class="nom mono">' + esc(c.nombre) + extTxt(c) + '</span>' + (c.copia ? ' <span class="etq">copia</span>' : ''), 'nombre') + celda('descripcion', esc(c.descripcion) || '--') + celda('version', u.n ? 'V' + u.n : '--', 'num') + celda('indicadores', ind || '--') + celda('marcas', (c.n_marcas ? '<a href="#" data-mk="' + c.id + '" title="Marcas de revisión">' + c.n_marcas + ' ✎</a> ' : '') + (u.revision ? '<span class="mono">' + esc(u.revision) + (u.idoneidad ? ' · ' + esc(u.idoneidad) : '') + '</span>' : '--')) + celda('incidencias', c.n_incidencias ? '<a href="#/p/' + pid + '/incidencias">' + c.n_incidencias + '</a>' : '--', 'num') + celda('tamano', u.tamano ? tam(u.tamano) : '--', 'num') + celda('actualizado', fecha(c.actualizado)) + celda('por', u.subido_por ? N.avatar(u.subido_por, u.org) : '--') + celda('aprobado', c.aprobado_por ? N.avatar(c.aprobado_por, c.aprobado_org) : '--') + celda('estado', estadoFila(p, c)) + celda('carpeta', esc(c.carpeta_vista || c.carpeta)) + celda('tipo', esc(c.tipo)) + celda('creado', fecha(c.creado)) + nomCols.map(x => '<td class="mono">' + (esc((c.campos || {})[x.id.slice(2)]) || '--') + '</td>').join('') + '<td class="accion"><button class="mini puntos" data-mx="' + c.id + '">⋮</button></td></tr>'; };
    const rutaTxt = sel ? sel.split('/').map((x, i, a) => '<a href="#" data-r="' + esc(a.slice(0, i + 1).join('/')) + '">' + esc(x) + '</a>').join(' › ') : '';
    app.innerHTML = N.marco(p, '') +
      '<div class="acctabs"><div class="tabs"><button class="activa">Carpetas</button><button data-t="conjuntos" title="Grupos de archivos con nombre (entregas, paquetes)">Conjuntos</button><button data-t="retencion" title="Archivos que no cumplen la norma de su carpeta y los que están fuera de la estructura">Área de retención' + (p.retenidos ? ' <span class="etq">' + p.retenidos + '</span>' : '') + '</button><button data-t="suprimidos" title="Papelera: archivos y carpetas suprimidos">Elementos suprimidos</button><button data-t="buscar" title="Buscar documentos en todo el proyecto (y en otros) por nombre, descripción, atributos, estado, fechas o contenido">Búsqueda</button></div><a href="#/p/' + pid + '/archivos/configuracion" class="enlace">⚙ Configuración</a><div class="crece"></div><div class="modbarra">' + (puedeSubir ? '<button class="modb primario" id="mdCarga"' + (!destCarga ? ' title="Elige una carpeta en la que puedas cargar"' : '') + '>⇧ Carga de documentos <i>▾</i></button>' : '') + '<button class="modb" id="mdExporta">⇪ Exportar registro <i>▾</i></button><button class="modb" id="mdOpc">Opciones de documento <i>▾</i></button><button class="modb" id="mdFlu">Flujos y observaciones <i>▾</i></button><button class="modb" id="mdPer">Permisos <i>▾</i></button></div></div>' +
      '<div class="acc"><div class="accarbol">' + arbolHtml(p) + '</div>' +
      '<div class="acclista">' +
      '<div class="accbarra"><div class="crece"></div><div class="buscar"><input id="fq" placeholder="Buscar y filtrar" value="' + esc(F.q) + '"><label class="sub"><input type="checkbox" id="fsub"' + (F.sub ? ' checked' : '') + '> subcarpetas</label></div><button class="mini" id="cols" title="Columnas">⚙</button></div>' +
      '<div id="selBarra"></div>' +
      (sel ? '<div class="accruta"><a href="#" data-r="">Archivos de proyecto</a> › ' + rutaTxt + '</div>' : '') +
      '<div class="acctabla"><table><thead><tr><th class="chk"><input type="checkbox" id="todos"></th>' + cab('nombre', 'Nombre', 'nombre', 'nombre') + cab('descripcion', 'Descripción') + cab('version', 'Versión') + cab('indicadores', 'Indicadores') + cab('marcas', 'Marcas de revisión') + cab('incidencias', 'Incidencias') + cab('tamano', 'Tamaño', '', 'tamano') + cab('actualizado', 'Última actualización', '', 'fecha') + cab('por', 'Actualizado por') + cab('aprobado', 'Aprobado por') + cab('estado', 'Estado', '', 'estado') + cab('carpeta', 'Carpeta') + cab('tipo', 'Tipo') + cab('creado', 'Creado') + nomCols.map(x => '<th>' + esc(x.nombre) + '</th>').join('') + '<th class="accion"></th></tr></thead><tbody>' +
      carpetasHijas.map(filaCarpeta).join('') + conts.map(filaCont).join('') +
      (!carpetasHijas.length && !conts.length ? '<tr><td colspan="' + (nCols + 2) + '" class="vacio">' + (sel ? (selDef && selDef.paso ? 'No tienes acceso al contenido de esta carpeta; ábrela hacia la tuya.' : 'Esta carpeta está vacía.' + (destCarga ? ' Arrastra archivos o carpetas aquí o usa Cargar.' : '')) : (p.arbol.length ? 'Nada en esta zona.' : 'Sin carpetas: en Configuración puedes aplicar la plantilla de carpetas.')) + '</td></tr>' : '') + '</tbody></table></div>' +
      '<div class="accpie">Mostrando ' + (carpetasHijas.length + conts.length) + ' elementos</div><div id="sMsg"></div></div></div>' + N.cierra();
    const recarga = () => vistaProyecto(pid);
    app.querySelectorAll('.zonasbtn button[data-zv]').forEach(b => b.onclick = () => { try { localStorage.setItem('cde.zona.' + pid, b.dataset.zv); } catch (e) {} p._zona = b.dataset.zv; despliegaZona(p); recarga(); });
    app.querySelectorAll('.arbolacc .nodo').forEach(n => n.onclick = (e) => { if (e.target.closest('.puntos')) return; const r = n.dataset.c; if (e.target.classList.contains('chev') && e.target.dataset.p !== undefined) { const k = e.target.dataset.p; if (N.ABIERTAS.has(k)) N.ABIERTAS.delete(k); else N.ABIERTAS.add(k); recarga(); return; } F.carpeta = r; F.q = ''; if (r) N.ABIERTAS.add(r); recarga(); });
    app.querySelectorAll('.puntos[data-m]').forEach(b => b.onclick = (e) => { e.stopPropagation(); menuCarpeta(p, b.dataset.m, b); });
    app.querySelectorAll('tr.item.carpeta').forEach(tr => tr.onclick = (e) => { if (e.target.closest('.puntos, .chk')) return; F.carpeta = tr.dataset.c; N.ABIERTAS.add(tr.dataset.c); recarga(); });
    // Como en Forma: un clic sobre un PDF lo abre en el visualizador (paginas, marcas de revision, incidencias, versiones); Excel, Word, PowerPoint, Project, Primavera y GIS, en el Visualizador de archivos; el resto abre su ficha. Clic derecho = menu del archivo.
    app.querySelectorAll('tr.item[data-h]').forEach(tr => { const abre = (e) => { const cid = (/\/c\/([^/]+)$/.exec(tr.dataset.h) || [])[1], c = cid && conts.find(x => x.id === cid); if (!c) { location.hash = tr.dataset.h; return; } const x = e.clientX, y = e.clientY; menuDocumento(p, c, { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) }, () => { const k = tr.querySelector('input[data-sx]'); if (k && k.checked) { k.checked = false; k.dispatchEvent(new Event('change', { bubbles: true })); } }); }; tr.onclick = (e) => { if (e.target.closest('.puntos, .chk, a')) return; e.stopPropagation(); abre(e); }; tr.oncontextmenu = (e) => { e.preventDefault(); abre(e); }; });
    app.querySelectorAll('.puntos[data-mc]').forEach(b => b.onclick = (e) => { e.stopPropagation(); menuCarpeta(p, b.dataset.mc, b); });
    app.querySelectorAll('.puntos[data-mx]').forEach(b => b.onclick = (e) => { e.stopPropagation(); menuContenedor(p, conts.find(c => c.id === b.dataset.mx), b); });
    app.querySelectorAll('.accruta a').forEach(a => a.onclick = (e) => { e.preventDefault(); F.carpeta = a.dataset.r; recarga(); });
    app.querySelectorAll('th[data-orden]').forEach(th => th.onclick = () => { const k = th.dataset.orden, act = F.orden || 'nombre'; F.orden = act === k ? '-' + k : k; recarga(); });
    // seleccion de filas: la barra de acciones de ACC
    const pintaSel = () => {
      const sx = [...app.querySelectorAll('tbody input[data-sx]:checked')].map(x => conts.find(c => c.id === x.dataset.sx)).filter(Boolean), sc = [...app.querySelectorAll('tbody input[data-sc]:checked')].map(x => x.dataset.sc), n = sx.length + sc.length, b = document.getElementById('selBarra');
      if (!n) { b.innerHTML = ''; return; }
      const revisables = sx.filter(c => revisable(p, c));
      b.innerHTML = '<div class="selbarra"><b>' + n + ' seleccionado(s)</b><span class="crece"></span>' + (sx.length && !sc.length ? '<button class="mini" id="sbMov">Desplazar</button>' : '') + (sc.length && !sx.length ? '<button class="mini" id="sbMovC">Desplazar</button>' : '') + (revisables.length && !sc.length ? '<button class="mini" id="sbRev">Enviar para revisión (' + revisables.length + ')</button>' : '') + (sx.length && !sc.length ? '<button class="mini" id="sbTra">Informe de transmisión</button><button class="mini" id="sbExp">Exportar registro</button><button class="mini" id="sbCon">Añadir a un conjunto</button><button class="mini peligro" id="sbSup">Suprimir</button>' : '') + (sc.length && !sx.length ? '<button class="mini" id="sbComC">Compartir</button>' : '') + (sx.length && !sc.length ? '<button class="mini" id="sbComX">Compartir</button>' : '') + '<button class="mini" id="sbNo">Quitar selección</button></div>';
      const on2 = (id, f) => { const x = document.getElementById(id); if (x) x.onclick = f; };
      on2('sbMov', () => desplazaContenedores(p, sx)); on2('sbMovC', () => desplazaCarpetas(p, sc)); on2('sbRev', () => N.nuevaRevision(p, { ids: revisables.map(c => c.id) }));
      on2('sbTra', () => transmision(p, null, sx)); on2('sbCon', () => N.anadirAConjunto(p, sx)); on2('sbComC', () => N.compartirCarpetas(p, sc)); on2('sbComX', () => N.compartirArchivo(p, sx.length === 1 ? sx[0] : sx)); on2('sbSup', () => suprimeContenedores(p, sx.filter(c => !c.copia && !c.revision_abierta))); on2('sbExp', () => exportaRegistro(p, sel, sx.map(c => c.id))); on2('sbNo', () => { app.querySelectorAll('tbody .chk input, #todos').forEach(x => { x.checked = false; }); pintaSel(); });
    };
    app.querySelectorAll('tbody .chk input').forEach(x => x.onchange = pintaSel);
    const t = document.getElementById('todos'); if (t) t.onchange = () => { app.querySelectorAll('tbody .chk input').forEach(x => { x.checked = t.checked; }); pintaSel(); };
    document.getElementById('fq').onkeydown = (e) => { if (e.key === 'Enter') { F.q = e.target.value; recarga(); } };
    F.estado = '';
    document.getElementById('fsub').onchange = (e) => { F.sub = e.target.checked; recarga(); };
    const tb = app.querySelector('button[data-t="retencion"]'); if (tb) tb.onclick = () => vistaRetencion(p);
    const ts = app.querySelector('button[data-t="suprimidos"]'); if (ts) ts.onclick = () => { location.hash = '#/p/' + pid + '/archivos/suprimidos'; };
    const tq = app.querySelector('button[data-t="buscar"]'); if (tq) tq.onclick = () => { location.hash = '#/p/' + pid + '/documentos'; };
    const tj = app.querySelector('button[data-t="conjuntos"]'); if (tj) tj.onclick = () => { location.hash = '#/p/' + pid + '/archivos/conjuntos'; };
    app.querySelectorAll('a[data-mk]').forEach(a => a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const c = conts.find(x => x.id === a.dataset.mk); N.marcasVentana(p, c, c.ultima.id); });
    document.getElementById('cols').onclick = (e) => { N.menuFlotante(e.currentTarget, cols.map(c => ({ texto: '<label><input type="checkbox" ' + (c.on ? 'checked' : '') + ' data-col="' + esc(c.id) + '"> ' + esc(c.nombre) + '</label>', accion: null })).concat([{ texto: '<b>Aplicar</b>', accion: () => { const vis = [...document.querySelectorAll('.menuf [data-col]')].filter(x => x.checked).map(x => x.dataset.col); try { localStorage.setItem('cde.columnas.' + p.id, JSON.stringify(vis)); } catch (err) {} recarga(); } }]), 'derecha'); };
    // ── Los cuatro módulos de la barra: cada uno despliega sus opciones ──
    const selDocs = () => [...app.querySelectorAll('tbody input[data-sx]:checked')].map(x => conts.find(c => c.id === x.dataset.sx)).filter(Boolean);
    const noCarga = destCarga ? false : 'Elige una carpeta en la que puedas cargar';
    const mdC = document.getElementById('mdCarga'); if (mdC) mdC.onclick = (e) => { e.stopPropagation(); const SC = [...app.querySelectorAll('tbody input[data-sc]:checked')].map(x => x.dataset.sc), dm = SC.length === 1 && (p.arbol.find(x => x.ruta === SC[0]) || {}).subir ? SC[0] : '', dest = dm || destCarga, no = dest ? false : (!sel ? '«Archivos de proyecto» es la matriz de carpetas: entra a una carpeta (o márcala) para cargar' : 'Elige o marca una carpeta en la que puedas cargar'); N.menuFlotante(mdC, [
      { texto: dest ? 'Destino: <b>' + esc(dest) + '</b>' : '<i>Sin carpeta de destino</i>', accion: null }, { sep: true },
      { ico: 'archivo', texto: 'Por archivo', off: no, accion: () => ventanaCargar(p, dest, 'archivos') },
      { ico: 'abrir', texto: 'Por carpeta', off: no, accion: () => ventanaCargar(p, dest, 'carpeta') },
      { ico: 'enlace', texto: 'Archivo vinculado', off: no, accion: () => ventanaCargar(p, dest, 'vinculados') }]); };
    document.getElementById('mdExporta').onclick = (e) => { e.stopPropagation(); const pre = selDocs().map(c => c.id); N.menuFlotante(e.currentTarget, [{ ico: 'exportar', texto: 'Excel', accion: () => exportarRegistroDlg(p, sel, 'xlsx', pre) }, { ico: 'archivo', texto: 'CSV', accion: () => exportarRegistroDlg(p, sel, 'csv', pre) }]); };
    const uno = (L) => L.length === 1 ? false : L.length ? 'Marca un solo documento' : 'Marca un documento de la lista', varios = (L) => L.length ? false : 'Marca uno o más documentos de la lista';
    const edit = (c) => { const def = p.arbol.find(x => x.ruta === c.carpeta) || {}; return def.editar || R[p.rol] >= 3; };
    document.getElementById('mdOpc').onclick = (e) => { e.stopPropagation(); const SC = [...app.querySelectorAll('tbody input[data-sc]:checked')].map(x => x.dataset.sc); if (SC.length && !selDocs().length) { const edC = SC.every(r => { const d = p.arbol.find(x => x.ruta === r) || {}; return d.editar || d.control || R[p.rol] >= 3; }) ? false : 'Hace falta permiso de edición sobre la carpeta', solo = 'Aplica a documentos: marca un documento';
      return N.menuFlotante(e.currentTarget, [{ texto: '<b>' + SC.length + ' carpeta(s) marcada(s)</b>', accion: null }, { sep: true }, { ico: 'info', texto: 'Ficha de documento', off: solo }, { ico: 'lapiz', texto: 'Cambiar nombre', off: solo }, { ico: 'descargar', texto: 'Descargar', off: SC.length === 1 ? false : 'Marca una sola carpeta', accion: () => { location.href = '/api/proyectos/' + pid + '/carpetas/descargar?ruta=' + encodeURIComponent(SC[0]); } }, { ico: 'compartir', texto: 'Compartir', accion: () => N.compartirCarpetas(p, SC) }, { ico: 'desplazar', texto: 'Mover a otra carpeta', off: edC, accion: () => desplazaCarpetas(p, SC) }, { ico: 'carpetaMas', texto: 'Agregar a conjunto', off: solo }, { ico: 'papelera', texto: 'Eliminar', off: edC, accion: () => suprimeCarpetas(p, SC) }, { ico: 'lapiz', texto: 'Editar metadatos', off: solo }, { ico: 'cerrar', texto: 'Quitar selección', accion: () => { app.querySelectorAll('tbody .chk input, #todos').forEach(x => { x.checked = false; }); pintaSel(); } }]); }
      const L = selDocs(), c = L[0], u = (c && c.ultima) || {}, sinEd = L.length && !L.every(edit) ? 'Hace falta permiso de edición sobre su carpeta' : false;
      N.menuFlotante(e.currentTarget, [{ texto: L.length ? '<b>' + L.length + ' documento(s) marcado(s)</b>' : '<i>Marca primero el documento en la lista (casilla de la izquierda)</i>', accion: null }, { sep: true },
        { ico: 'info', texto: 'Ficha de documento', off: uno(L), accion: () => { location.hash = '#/p/' + pid + '/c/' + c.id; } },
        { ico: 'lapiz', texto: 'Cambiar nombre', off: uno(L) || (c.copia ? 'Es la copia publicada' : sinEd), accion: () => N.renombrarDlg(p, c, () => vistaProyecto(pid)) },
        { ico: 'descargar', texto: 'Descargar', off: uno(L) || (u.id ? false : 'Sin versiones'), accion: () => { location.href = '/api/proyectos/' + pid + '/versiones/' + u.id + '/descargar'; } },
        { ico: 'compartir', texto: 'Compartir', off: varios(L), accion: () => N.compartirArchivo(p, L.length === 1 ? c : L) },
        { ico: 'desplazar', texto: 'Mover a otra carpeta', off: varios(L) || sinEd, accion: () => desplazaContenedores(p, L) },
        { ico: 'copiar', texto: 'Copiar a otra carpeta', off: varios(L), accion: () => copiaContenedores(p, L) },
        { ico: 'carpetaMas', texto: 'Agregar a conjunto', off: varios(L), accion: () => N.anadirAConjunto(p, L) },
        { ico: 'papelera', texto: 'Eliminar', off: varios(L) || sinEd || (L.some(x => x.copia) ? 'Hay una copia publicada marcada' : L.some(x => x.revision_abierta) ? 'Hay un documento con revisión abierta' : false), accion: () => suprimeContenedores(p, L) },
        { ico: 'lapiz', texto: 'Editar metadatos', off: uno(L), accion: () => N.atributosDlg(p, c, () => vistaProyecto(pid)) },
        { ico: 'cerrar', texto: 'Quitar selección', off: varios(L), accion: () => { app.querySelectorAll('tbody .chk input, #todos').forEach(x => { x.checked = false; }); pintaSel(); } }]); };
    const selCarps = () => [...app.querySelectorAll('tbody input[data-sc]:checked')].map(x => x.dataset.sc);
    document.getElementById('mdPer').onclick = (e) => { e.stopPropagation(); const sc = selCarps(), pre = sc.length ? sc : (sel ? [sel] : []);
      N.menuFlotante(e.currentTarget, [{ ico: 'permisos', texto: 'Ver permisos', accion: () => verPermisos(p, pre[0] || '') }, { ico: 'mas', texto: 'Agregar permisos', accion: () => agregarPermisos(p, pre) }], 'derecha'); };
    document.getElementById('mdFlu').onclick = (e) => { e.stopPropagation(); const SC = selCarps(); if (SC.length && !selDocs().length) { const una = SC.length === 1 ? false : 'Marca una sola carpeta';
      return N.menuFlotante(e.currentTarget, [{ texto: '<b>' + SC.length + ' carpeta(s) marcada(s)</b>', accion: null }, { sep: true }, { ico: 'revision', texto: 'Enviar a Revisión contractual (documentos de la carpeta)', off: una, accion: () => N.nuevaRevision(p, { carpeta: SC[0] }) }, { ico: 'transmision', texto: 'Enviar como Avance de Proyecto (documentos de la carpeta)', off: una, accion: () => transmision(p, SC[0]) }, { ico: 'marca', texto: 'Marcas en documento', off: 'Aplica a documentos: marca un documento' }, { ico: 'info', texto: 'Observaciones contractuales', off: 'Aplica a documentos: marca un documento' }], 'derecha'); }
      const L = selDocs(), c = L[0], u = (c && c.ultima) || {}, rev = L.filter(x => revisable(p, x));
      N.menuFlotante(e.currentTarget, [{ texto: L.length ? '<b>' + L.length + ' documento(s) marcado(s)</b>' : '<i>Marca primero el documento en la lista (casilla de la izquierda)</i>', accion: null }, { sep: true },
        { ico: 'revision', texto: 'Enviar a Revisión contractual' + (L.length > 1 && rev.length ? ' (' + rev.length + ')' : ''), off: varios(L) || (rev.length ? false : 'Se revisa lo que está en una carpeta compartida (COM) y no tiene revisión abierta'), accion: () => N.nuevaRevision(p, { ids: rev.map(x => x.id) }) },
        { ico: 'transmision', texto: 'Enviar como Avance de Proyecto', off: varios(L), accion: () => transmision(p, null, L) },
        { ico: 'marca', texto: 'Marcas en documento', off: uno(L) || (u.id ? false : 'Sin versiones'), accion: () => N.marcasVentana(p, c, u.id) },
        { ico: 'info', texto: 'Observaciones contractuales', off: uno(L), accion: () => { location.hash = '#/p/' + pid + '/c/' + c.id; } }], 'derecha'); };
    // arrastrar archivos o carpetas sobre la tabla: abre "Cargar" con lo soltado (las carpetas se recrean)
    const z = app.querySelector('.acctabla'); if (z && destCarga) { z.ondragover = (e) => { e.preventDefault(); z.classList.add('sobre'); }; z.ondragleave = () => z.classList.remove('sobre'); z.ondrop = (e) => { e.preventDefault(); z.classList.remove('sobre'); const ents = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); ventanaCargar(p, destCarga, '', ents.length ? ents : [...e.dataTransfer.files]); }; }
  }
  /** Area de retencion: contenedores que viven en carpetas que ya no existen en la estructura (p.ej. antes de aplicar la plantilla). */
  N.abreRetencion = (p) => vistaRetencion(p);
  async function vistaRetencion(p) {
    const d = await api('/api/proyectos/' + p.id + '/contenedores?retenidos=todos'), def = new Set(p.arbol.map(c => c.ruta));
    const fuera = d.contenedores.filter(c => !c.copia && (c.retencion || !def.has(c.carpeta)));
    app.innerHTML = N.marco(p, '') + '<div class="acctabs"><div class="tabs"><button data-t="carpetas">Carpetas</button><button class="activa">Área de retención</button><button data-t="suprimidos">Elementos suprimidos</button><button data-t="buscar">Búsqueda</button></div></div><div class="tarjeta" style="margin-top:12px"><p class="pista">El área de retención es una configuración de nivel de proyecto (Archivos → Configuración → Conformidad): si está activada, los archivos que no cumplen la norma de nomenclatura de su carpeta se cargan aquí en vez de rechazarse; al cambiarles el nombre a uno conforme pasan solos a su carpeta. También están aquí los archivos cuya carpeta ya no existe.</p>' + (fuera.length ? '<table><tr><th>Nombre</th><th>Motivo</th><th>Carpeta de destino</th><th>Estado</th><th>Versión</th><th></th></tr>' + fuera.map(c => '<tr><td class="mono">' + esc(c.ultima ? c.ultima.archivo : c.nombre) + '</td><td class="pista">' + (c.retencion ? 'No cumple la norma de la carpeta' : 'La carpeta ya no existe') + '</td><td class="pista">' + esc(c.retencion || c.carpeta || '(raíz)') + '</td><td>' + estado(c.estado) + '</td><td>' + (c.ultima ? 'V' + c.ultima.n + ' ' + esc(c.ultima.revision) : '') + '</td><td><a href="#/p/' + p.id + '/c/' + c.id + '">Abrir</a> · <a href="#" data-rn="' + c.id + '">Cambiar nombre</a> · <a href="#" data-mv="' + c.id + '">Desplazar a una carpeta</a></td></tr>').join('') + '</table>' : '<div class="pista">No hay archivos retenidos ni fuera de la estructura de carpetas.</div>') + '</div>' + N.cierra();
    app.querySelectorAll('a[data-rn]').forEach(a => a.onclick = (e) => { e.preventDefault(); N.renombrarDlg(p, fuera.find(x => x.id === a.dataset.rn), () => vistaRetencion(p)); });
    app.querySelector('button[data-t="carpetas"]').onclick = () => vistaProyecto(p.id);
    app.querySelector('button[data-t="suprimidos"]').onclick = () => { location.hash = '#/p/' + p.id + '/archivos/suprimidos'; };
    app.querySelector('button[data-t="buscar"]').onclick = () => { location.hash = '#/p/' + p.id + '/documentos'; };
    app.querySelectorAll('a[data-mv]').forEach(a => a.onclick = async (e) => { e.preventDefault(); const c = fuera.find(x => x.id === a.dataset.mv); const dest = await eligeDestino(p, { titulo: 'Seleccionar carpeta de destino', boton: 'Desplazar', texto: esc(c.nombre), permitida: (x) => x.subir, motivo: () => 'Sin permiso de carga' }); if (dest === null) return; api('/api/proyectos/' + p.id + '/contenedores/' + c.id + '/mover', { json: { carpeta: dest } }).then(() => vistaRetencion(p)).catch(err => N.toast(esc(err.message), 'mal')); });
  }

  // ======================= CARGAR (la ventana de Autodesk Docs) =======================
  const LIMITES = { archivos: 1000, carpetas: 100, niveles: 10 };
  const ICO_PC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="10" rx="1"/><path d="M3 18h18"/></svg>';
  const ILUS_CARPETA = '<svg width="128" height="104" viewBox="0 0 128 104"><path d="M8 14h34l8 8h58v70H8z" fill="#fff" stroke="#6b7280" stroke-width="1.4"/><path d="M14 36h106l-10 60H8z" fill="#cdd7e1"/></svg>';
  /** Lee lo que se solto (entradas de archivo/carpeta del navegador) a [{ file, rel }], recorriendo las carpetas. */
  async function leeEntradas(entradas) {
    const out = [];
    const archivo = (en) => new Promise((ok, mal) => en.file(ok, mal));
    const hijos = (dir) => new Promise((ok, mal) => { const r = dir.createReader(), todo = []; const sigue = () => r.readEntries((l) => { if (!l.length) return ok(todo); todo.push(...l); sigue(); }, mal); sigue(); });
    const anda = async (en, rel) => { if (en.isFile) out.push({ file: await archivo(en), rel }); else if (en.isDirectory) { const sub = rel ? rel + '/' + en.name : en.name; for (const h of await hijos(en)) await anda(h, sub); } };
    for (const en of entradas) { if (en instanceof File) out.push({ file: en, rel: '' }); else await anda(en, ''); }
    return out;
  }
  function ventanaCargar(p, carpeta, modo, soltado) {
    const pid = p.id; let destino = carpeta || p.carpetaWip || '';
    const cola = [], conocidas = new Set(p.arbol.map(c => c.ruta)); let corriendo = false, mini = null, cambios = 0;
    const v = ventana(modo === 'vinculados' ? 'Cargar archivos vinculados' : 'Cargar', '<div class="cargar">' + (modo === 'vinculados' ? '<div class="aviso azul">Archivos vinculados (p. ej. un RVT anfitrión con sus vínculos): el <b>primero</b> que elijas es el principal y los demás quedan marcados como vinculados a él (se ve en la ficha de cada uno).</div>' : '') + '<div class="destino">Destino: <b id="cgDest"></b><button class="enlace" id="cgCambia">Cambiar</button><span style="flex:1"></span><button class="enlace" id="cgMin" title="Minimizar: la carga sigue en segundo plano">Minimizar ⤡</button></div>' +
      '<div class="elige"><button id="cgArch">' + ICO_PC + 'Seleccionar archivos</button><button id="cgCarp">' + ICO_PC + 'Seleccionar una carpeta</button></div>' +
      '<div class="zona" id="cgZona"><div class="ilus">' + ILUS_CARPETA + '</div><div>Arrastre archivos o carpetas aquí. También puede optar por cargar archivos o carpetas desde el equipo indicado anteriormente.</div><div class="lim">' + N.ICO.info + LIMITES.archivos + ' archivos, ' + LIMITES.carpetas + ' carpetas, ' + LIMITES.niveles + ' niveles de subcarpetas</div></div>' +
      '<div class="lista" id="cgLista"><table><thead><tr><th>Nombre</th><th>Subcarpeta</th><th class="num">Tamaño</th><th>Progreso</th><th>Estado</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="pie"><span class="resumen" id="cgRes"></span><span class="crece"></span><span class="pista">En carpetas con norma (compartido / publicado) se abre la rejilla de nomenclatura y atributos; las subcarpetas se crean solas.</span><button class="primario" id="cgListo" disabled>Listo</button></div>' +
      '<input type="file" id="cgInA" multiple class="oculto"><input type="file" id="cgInC" webkitdirectory directory multiple class="oculto"></div>',
      { ancho: Math.min(1060, innerWidth - 60), alto: Math.min(660, innerHeight - 60), x: Math.max(20, (innerWidth - Math.min(1060, innerWidth - 60)) / 2), y: 40, alCerrar: () => { if (corriendo) { document.getElementById('ventanas').appendChild(win); minimiza(); } else if (cambios) vistaProyecto(pid); } });
    const win = v.closest('.ventana'), $ = (s) => v.querySelector(s);
    const pintaDest = () => { $('#cgDest').textContent = destino || '(elige una carpeta)'; $('#cgDest').title = destino; };
    const resumen = () => { const ok = cola.filter(x => x.estado === 'ok').length, mal = cola.filter(x => x.estado === 'mal').length, n = cola.length; const t = n ? (corriendo ? 'Cargando ' + (ok + mal + 1 > n ? n : ok + mal + 1) + ' de ' + n : ok + ' de ' + n + ' cargado(s)') + (mal ? ' · ' + mal + ' con error' : '') : ''; $('#cgRes').textContent = t; if (mini) mini.querySelector('span').textContent = corriendo ? t : 'Carga terminada · ' + t; $('#cgListo').disabled = corriendo || !n; return t; };
    const fila = (x) => { let tr = x.tr; if (!tr) { tr = document.createElement('tr'); x.tr = tr; $('#cgLista tbody').appendChild(tr); } tr.innerHTML = '<td class="nom mono" title="' + esc(x.nombre ? x.nombre + '  (archivo: ' + x.file.name + ')' : x.file.name) + '">' + esc(x.nombre || x.file.name) + '</td><td class="pista">' + esc(x.rel || '—') + '</td><td class="num">' + tam(x.file.size) + '</td><td><div class="barrita"><i style="width:' + (x.pct || 0) + '%"></i></div></td><td class="est ' + (x.estado === 'ok' ? 'ok' : x.estado === 'mal' ? 'mal' : '') + '">' + x.msg + '</td>'; };
    const minimiza = () => { win.style.display = 'none'; if (!mini) { mini = document.createElement('div'); mini.className = 'minicarga'; mini.innerHTML = N.ICO.cargar.replace('<svg', '<svg width="20" height="20"') + '<span></span><button class="enlace">Mostrar</button>'; mini.onclick = () => { win.style.display = ''; mini.remove(); mini = null; }; document.body.appendChild(mini); } resumen(); };
    const avisa = (html) => { const d = document.createElement('div'); d.className = 'aviso rojo'; d.innerHTML = html; $('#cgZona').after(d); setTimeout(() => d.remove(), 9000); };
    async function agrega(items) {
      if (!items.length) return;
      if (!destino) return avisa('Elige primero la carpeta de destino (Cambiar).');
      const todos = cola.concat(items), dirs = new Set(); let prof = 0;
      for (const x of todos) if (x.rel) { const ps = x.rel.split('/'); prof = Math.max(prof, ps.length); for (let i = 1; i <= ps.length; i++) dirs.add(ps.slice(0, i).join('/')); }
      if (todos.length > LIMITES.archivos || dirs.size > LIMITES.carpetas || prof > LIMITES.niveles) return avisa('Supera el límite de una carga: ' + todos.length + ' archivos, ' + dirs.size + ' carpetas, ' + prof + ' niveles (máximo ' + LIMITES.archivos + ', ' + LIMITES.carpetas + ' y ' + LIMITES.niveles + '). Cárgalo por partes.');
      // Carpeta con norma de nomenclatura (compartido / publicado): primero la rejilla «Cargar archivos» de Forma, campo por campo y con sus atributos.
      // Solo pasa a la cola lo que la rejilla devuelve (ya con su nombre conforme). Las carpetas libres (WIP) cargan como siempre.
      const porCarpeta = new Map(); for (const x of items) { const k = destino + (x.rel ? '/' + x.rel : ''); if (!porCarpeta.has(k)) porCarpeta.set(k, []); porCarpeta.get(k).push(x); }
      const listos = [];
      for (const [carp, grupo] of porCarpeta) {
        const res = await N.rejillaConformidad(p, carp, grupo.map(x => ({ nombre: x.file.name, tam: x.file.size, file: x.file, ref: x })), { modo: 'cargar' });
        if (!res) continue;
        for (const r of res) { const x = r.ref || { file: r.file, rel: grupo[0].rel }; if (r.nombre !== x.file.name) x.nombre = r.nombre; x.revision = r.revision; x.idoneidad = r.idoneidad; x.atributos = r.atributos; listos.push(x); }
      }
      if (!listos.length) return;
      items = listos;
      for (const x of items) { x.estado = 'cola'; x.msg = 'En cola'; x.pct = 0; x.destino = destino; cola.push(x); fila(x); }
      $('#cgZona').classList.add('conlista'); $('#cgLista').classList.add('on'); resumen();
      if (!corriendo) procesa();
    }
    async function asegura(dest, rel) { // crea las subcarpetas que faltan (destino/rel)
      const ps = rel.split('/'); let padre = dest;
      for (const n of ps) { const r = padre + '/' + n; if (!conocidas.has(r)) { await api('/api/proyectos/' + pid + '/carpetas', { json: { padre, nombre: n } }).catch(e => { if (!/Ya existe/.test(e.message)) throw e; }); conocidas.add(r); cambios++; } padre = r; }
      return padre;
    }
    function envia(x, carpeta, meta) {
      return new Promise((ok) => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/proyectos/' + pid + '/subir?carpeta=' + encodeURIComponent(carpeta) + (x.revision ? '&revision=' + encodeURIComponent(x.revision) : '') + (x.idoneidad ? '&idoneidad=' + encodeURIComponent(x.idoneidad) : ''));
        if (x.atributos && Object.keys(x.atributos).length) meta = Object.assign({}, meta || {}, { atributos: x.atributos });
        xhr.setRequestHeader('x-nombre', encodeURIComponent(x.nombre || x.file.name)); xhr.setRequestHeader('Content-Type', 'application/octet-stream'); if (meta) xhr.setRequestHeader('x-meta', encodeURIComponent(JSON.stringify(meta)));
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { x.pct = Math.round(100 * e.loaded / e.total); x.msg = 'Cargando ' + x.pct + ' %'; fila(x); } };
        xhr.onload = () => { let j = {}; try { j = JSON.parse(xhr.responseText); } catch (e) {} ok({ ok: xhr.status >= 200 && xhr.status < 300, j }); };
        xhr.onerror = () => ok({ ok: false, j: { mensaje: 'Se cortó la conexión' } });
        xhr.send(x.file);
      });
    }
    async function procesa() {
      corriendo = true; resumen();
      for (const x of cola) {
        if (x.estado !== 'cola') continue;
        try {
          x.msg = 'Validando nombre…'; fila(x);
          const carpetaX = x.rel ? await asegura(x.destino, x.rel) : x.destino;
          const val = await api('/api/proyectos/' + pid + '/valida-nombre', { json: { nombre: x.nombre || x.file.name, carpeta: carpetaX } });
          if (!val.ok && !val.retenido) { x.estado = 'mal'; x.msg = 'No cumple la norma de la carpeta' + (val.norma ? ' «' + esc(val.norma.nombre) + '»' : '') + ': ' + esc(val.errores.join(' · ')); fila(x); resumen(); continue; }
          const r = await envia(x, carpetaX, modo === 'vinculados' && cola[0] !== x ? { vinculadoA: cola[0].file.name } : null);
          if (r.ok) { x.estado = 'ok'; x.pct = 100; cambios++; x.msg = (r.j.retenido ? '⚠ Retenido (no cumple la norma): queda en el Área de retención hasta que lo renombres' : '✓ V' + r.j.n + ' ' + esc(r.j.revision) + ' · ' + esc(r.j.estado) + (r.j.libre && !r.j.conforme ? ' · nombre libre (WIP): para compartirlo deberá cumplir la norma' : '')) + (r.j.revisionAutomatica ? ' · revisión iniciada (' + esc(r.j.revisionAutomatica.flujo) + ')' : ''); }
          else { x.estado = 'mal'; x.msg = esc(r.j.mensaje || r.j.error || 'Error') + (r.j.errores ? ': ' + esc(r.j.errores.join(' · ')) : ''); }
        } catch (e) { x.estado = 'mal'; x.msg = esc(e.message); }
        fila(x); resumen();
      }
      corriendo = false; resumen();
      if (mini) mini.querySelector('span').textContent = 'Carga terminada · ' + resumen();
    }
    pintaDest();
    $('#cgCambia').onclick = async () => { const d = await eligeDestino(p, { titulo: 'Seleccionar carpeta de destino', boton: 'Seleccionar', inicial: destino, permitida: (c) => c.subir, motivo: () => 'Sin permiso de carga' }); if (d !== null) { destino = d; pintaDest(); } };
    $('#cgMin').onclick = minimiza;
    $('#cgArch').onclick = () => $('#cgInA').click(); $('#cgCarp').onclick = () => $('#cgInC').click();
    $('#cgInA').onchange = (e) => { agrega([...e.target.files].map(f => ({ file: f, rel: '' }))); e.target.value = ''; };
    $('#cgInC').onchange = (e) => { agrega([...e.target.files].map(f => ({ file: f, rel: (f.webkitRelativePath || '').split('/').slice(0, -1).join('/') }))); e.target.value = ''; };
    const zona = $('#cgZona');
    zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('sobre'); }; zona.ondragleave = () => zona.classList.remove('sobre');
    zona.ondrop = async (e) => { e.preventDefault(); zona.classList.remove('sobre'); const ents = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); agrega(await leeEntradas(ents.length ? ents : [...e.dataTransfer.files])); };
    $('#cgListo').onclick = () => { win.remove(); if (mini) mini.remove(); vistaProyecto(pid); };
    if (soltado) leeEntradas(soltado).then(agrega);
    else if (modo === 'archivos' || modo === 'vinculados') $('#cgInA').click(); else if (modo === 'carpeta') $('#cgInC').click();
    return { agrega, cola };
  }
  N.ventanaCargar = ventanaCargar; N.eligeDestino = eligeDestino;

  // ---------- un contenedor ----------
  /** Celda «Modelo» de la ficha: lo que el CDE hizo con el modelo (IFC / RVT los lee solo; NWD no tiene lector libre). */
  const EN_CURSO = ['en-cola', 'convirtiendo', 'armando', 'recibiendo'];
  const FASE_TXT = { abriendo: 'Abriendo el IFC…', rvt: 'Leyendo el RVT (lector libre)…', relaciones: 'Leyendo niveles y tipos…', geometria: 'Leyendo la geometría…', parametros: 'Leyendo los parámetros…', escribiendo: 'Guardando…' };
  const ESTADO_TXT = { 'en-cola': 'En cola', convirtiendo: 'Leyendo el modelo', armando: 'Armando el índice', recibiendo: 'Recibiendo', listo: 'Listo', error: 'No se pudo leer', 'no-legible': 'Sin lector libre' };
  function textoModelo(st) {
    const a = st.avance || {}, fase = a.fase && FASE_TXT[a.fase] ? FASE_TXT[a.fase] + (a.total ? ' ' + Math.round(100 * a.n / a.total) + ' %' : a.n ? ' (' + num(a.n) + ')' : '') : '';
    return '<span class="estado ' + esc(st.estado) + '">' + esc(ESTADO_TXT[st.estado] || st.estado) + '</span>' + (fase ? ' <span class="pista">' + esc(fase) + '</span>' : '');
  }
  function celdaModelo(v, rol) {
    const ix = v.indice, f = /\.(ifc|rvt)$/i.test(v.archivo || ''), nwd = /\.(nwd|nwc|nwf)$/i.test(v.archivo || ''), puede = R[rol] >= 1;
    if (!ix && v.origen === 'forma' && nwd && puede && N.formaAlVisor) return '<button class="mini primario" data-fvis="' + v.id + '" style="white-space:nowrap" title="Vino de Forma: el visor lo prepara con la traducción que Autodesk ya hizo del archivo (la primera vez tarda unos minutos)">Ver en el visor</button>';
    if (!ix) return f && puede ? '<button class="mini" data-proc="' + v.id + '" title="El CDE lee el modelo por su cuenta (sin Autodesk) para verlo y filtrarlo en el visor">Procesar modelo</button>' : nwd ? '<span class="pista" title="Formato cerrado de Navisworks: sin lector libre">Sin lector libre</span>' : '<span class="pista">—</span>';
    let h = '<span data-vigila="' + v.id + '">' + textoModelo({ estado: ix.estado }) + '</span>';
    if (ix.estado === 'listo' && ix.resumen && ix.resumen.elementos) h += ' <span class="pista">' + num(ix.resumen.elementos) + ' elem.</span>';
    if (ix.estado === 'listo' && ix.error) h += ' <span class="pista" title="' + esc(ix.error) + '" style="cursor:help">ⓘ</span>';
    if ((ix.estado === 'error' || ix.estado === 'no-legible') && !(ix.estado === 'no-legible' && v.origen === 'forma' && N.formaAlVisor)) h += '<div class="pista" style="max-width:360px;white-space:normal">' + esc(ix.error || '') + '</div>';
    if ((ix.estado === 'error' || ix.estado === 'no-legible') && f && puede) h += '<button class="mini" data-proc="' + v.id + '">Volver a procesar</button>';
    if (ix.estado !== 'listo' && v.origen === 'forma' && puede && N.formaAlVisor) h += '<button class="mini primario" data-fvis="' + v.id + '" style="white-space:nowrap" title="Vino de Forma: el visor lo prepara con la traducción que Autodesk ya hizo del archivo (la primera vez tarda unos minutos)">Ver en el visor</button>';
    return h;
  }
  async function vistaContenedor(pid, cid) {
    const p = await api('/api/proyectos/' + pid), c = await api('/api/proyectos/' + pid + '/contenedores/' + cid);
    const rol = p.rol, pm = c.permisos;
    const trans = { WIP: ['COMPARTIDO'], COMPARTIDO: ['WIP', 'PUBLICADO', 'ARCHIVADO'], PUBLICADO: ['ARCHIVADO'], ARCHIVADO: [] }[c.estado] || [];
    const revAbierta = c.revisiones.find(r => r.estado === 'abierta');
    const ult = c.versiones[0], flujosOk = c.flujos.filter(f => f.puedoIniciar);
    app.innerHTML = N.marco(p, '', c.nombre) +
      '<div class="fila"><div class="tarjeta" style="flex:2;min-width:520px"><div class="fila" style="align-items:center"><h2 style="margin:0;flex:1" class="mono">' + esc(c.nombre) + extTxt(c) + '</h2>' + estado(c.estado) + '</div>' +
      '<div class="pista">' + esc(c.tipo) + ' · carpeta <span class="mono">' + esc(c.carpeta || '(raiz)') + '</span>' + (c.carpeta_publicada ? ' · copia publicada en <span class="mono">' + esc(c.carpeta_publicada) + '</span>' : '') + ' · creado ' + fecha(c.creado) + ' por ' + esc(c.creado_por) + ' · tu permiso: ' + esc(NIVEL_TXT[pm.nivel] || 'sin acceso directo') + '</div>' +
      (Object.keys(c.campos || {}).length ? '<div style="margin-top:8px">' + Object.entries(c.campos).map(([k, v]) => '<span class="estado WIP" title="' + esc(k) + '">' + esc(k) + ': ' + esc(v) + '</span> ').join('') + '</div>' : '') +
      (c.retencion ? '<div class="aviso ambar">Este archivo está en el <b>Área de retención</b>: no cumple la norma de nomenclatura de <span class="mono">' + esc(c.retencion) + '</span>. Cámbiale el nombre a uno conforme y pasará solo a su carpeta.</div>' : '') +
      (ult && ult.meta && ult.meta.vinculadoA ? '<div class="pista">Archivo vinculado a <span class="mono">' + esc(ult.meta.vinculadoA) + '</span></div>' : '') +
      '<div style="margin-top:8px"><span class="pista">Descripción:</span> ' + ((c.atributos || {}).descripcion ? esc(c.atributos.descripcion) : '<span class="pista">(sin descripción: se escribe al cargar o en «Editar atributos»)</span>') + '</div>' +
      '<div id="resumenIA"></div>' +
      '<div class="fila" style="align-items:center;margin-top:8px;gap:8px"><span class="pista">Atributos:</span>' + ((c.atributosDef || []).map(d => '<span class="estado cerrada" title="' + esc(d.descripcion || d.nombre) + '">' + esc(d.nombre) + ': ' + esc((c.atributos || {})[d.id] || '—') + '</span>').join(' ') || '<span class="pista">(ninguno definido)</span>') + '<span class="crece"></span>' + (R[rol] >= 1 && (pm.escribir || pm.editar) ? '<button class="mini" id="atEd">Editar atributos</button>' : '') + '<button class="mini" id="shAr">' + N.ICO.compartir + ' Compartir</button>' + (R[rol] >= 1 && (pm.escribir || pm.editar) ? '<button class="mini" id="rnAr">' + N.ICO.lapiz + ' Cambiar nombre</button>' : '') + '</div>' +
      '<h3>Versiones</h3><table><tr><th>v</th><th>Archivo</th><th>Rev.</th><th>Idoneidad</th><th>Origen</th><th>Tamano</th><th>Fecha</th><th>Por</th><th>Modelo</th><th>Marcas</th><th></th></tr>' + c.versiones.map(v => '<tr><td class="num">' + v.n + '</td><td class="mono">' + esc(v.archivo) + '</td><td class="mono">' + esc(v.revision) + '</td><td class="mono">' + esc(v.idoneidad) + '</td><td>' + esc(v.origen) + '</td><td class="num">' + tam(v.tamano) + '</td><td>' + fecha(v.fecha) + '</td><td class="pista">' + esc(v.subido_por) + '</td><td>' + celdaModelo(v, rol) + '</td><td><a href="#" data-mkv="' + v.id + '">' + (v.n_marcas || 0) + ' ✎</a></td><td>' + (RX_VER.test(v.archivo || '') ? '<a href="#" data-verv="' + v.id + '">Ver</a> · ' : /\.pdf$/i.test(v.archivo || '') ? '<a href="#" data-mkv="' + v.id + '">Ver</a> · ' : '') + (pm.descargar ? '<a href="/api/proyectos/' + pid + '/versiones/' + v.id + '/descargar">Descargar</a>' : '') + ((v.indice && v.indice.estado === 'listo') || RX_MODELO.test(v.archivo || '') ? ' · <a href="visor.html?pid=' + pid + '&vid=' + v.id + '" target="_blank">Abrir en el visor</a>' : '') + (R[rol] >= 3 && v.n !== c.version_actual && RX_MODELO.test(v.archivo || '') && !(v.indice && ['listo', 'recibiendo', 'armando'].includes(v.indice.estado)) ? ' · <a href="#" data-supv="' + v.id + '" title="Versión de modelo sin índice (publicación cancelada o incompleta): se borra del almacen">Suprimir</a>' : '') + '</td></tr>').join('') + '</table>' +
      '<h3>Historial de estados</h3>' + (c.transiciones.length ? '<table>' + c.transiciones.map(t => '<tr><td>' + fecha(t.fecha) + '</td><td>' + estado(t.de) + ' → ' + estado(t.a) + '</td><td class="pista">' + esc(t.por) + '</td><td>' + esc(t.comentario) + '</td></tr>').join('') + '</table>' : '<div class="pista">Sin cambios de estado todavia.</div>') +
      ((c.compartidos || []).length ? '<h3>Compartido</h3>' + c.compartidos.map(s0 => '<div class="pista">' + (s0.modo === 'vinculo' ? 'Vínculo' + (s0.caduca ? ' (caduca ' + dia(s0.caduca) + ')' : '') + ': <input readonly value="' + esc(location.origin + '/compartido/' + s0.token) + '" style="width:300px;display:inline" onclick="this.select()">' : s0.modo === 'miembros' ? 'Con ' + esc((s0.para || []).join(', ')) : 'Copiado a otro proyecto') + ' · ' + fecha(s0.creado) + ' · ' + esc(s0.por) + (s0.por === N.YO.email || R[rol] >= 3 ? ' <a href="#" data-shx="' + s0.id + '">revocar</a>' : '') + '</div>').join('') : '') +
      (c.correos.length ? '<h3>Correspondencia que lo adjunta</h3>' + c.correos.map(m => '<div><a href="#/p/' + pid + '/correspondencia/' + m.id + '" class="mono">' + esc(m.numero) + '</a> ' + esc(m.asunto) + ' <span class="pista">' + esc(m.de_org) + ' · ' + fecha(m.enviado) + '</span></div>').join('') : '') + '</div>' +
      '<div style="flex:1;min-width:340px">' +
      (trans.length && R[rol] >= 1 && (pm.escribir || pm.editar) ? '<div class="tarjeta"><h2>Cambiar estado a mano</h2><label>Pasar a</label><select id="tEstado">' + trans.map(t => '<option>' + t + '</option>').join('') + '</select>' + (c.estado === 'WIP' && pm.carpetasCompartir.length ? '<label>Carpeta compartida de destino' + (pm.esWip ? ' (sale de trabajo en progreso)' : ' (opcional)') + '</label><select id="tDest">' + (pm.esWip ? '' : '<option value="">(se queda en ' + esc(c.carpeta) + ')</option>') + pm.carpetasCompartir.map(x => '<option' + (x === c.carpeta_compartida ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '') + '<label>Código de estado (idoneidad)</label><input id="tIdon" placeholder="S1, S3, A1..."><label>Comentario</label><textarea id="tCom"></textarea><div style="margin-top:8px"><button class="primario" id="tOk">Aplicar</button></div><div id="tMsg"></div><p class="pista">WIP→COMPARTIDO: quien sube. COMPARTIDO→WIP: revisor. →PUBLICADO/ARCHIVADO: gestor. Lo normal es que PUBLICADO lo ponga el flujo al aprobar.</p></div>' : '') +
      (pm.carpetasMover.length ? '<div class="tarjeta" style="margin-top:12px"><h2>Desplazar</h2><div class="pista mono">' + esc(c.carpeta || '(raíz)') + '</div><div style="margin-top:6px"><button id="mvOk">Desplazar a otra carpeta…</button></div><div id="mvMsg"></div></div>' : '') +
      '<div class="tarjeta" style="margin-top:12px"><h2>Rondas de revisión</h2>' +
      (c.revisiones.length ? c.revisiones.map(r => '<div style="padding:6px 0;border-bottom:1px solid var(--borde)"><b>Ronda ' + r.ronda + '</b> · ' + esc(r.flujo ? r.flujo.nombre : 'revision') + ' <span class="estado ' + (r.estado === 'abierta' ? 'abierta' : r.estado === 'devuelta' ? 'en-curso' : r.estado === 'anulada' ? 'ARCHIVADO' : 'cerrada') + '">' + esc(r.estado) + '</span>' + (r.estado === 'abierta' && (r.solicitada_por === N.YO.email || R[rol] >= 3) ? ' <button class="mini" data-anula="' + r.id + '">anular</button>' : '') + '<div class="pista">iniciada ' + fecha(r.abierta) + ' por ' + esc(r.solicitada_por) + (r.cerrada ? ' · cerrada ' + fecha(r.cerrada) + ' por ' + esc(r.revisor) : '') + (r.destino ? ' · al aprobar copia a ' + esc(r.destino) : '') + '</div>' + N.etapasHtml(r) + N.decisionHtml(r) + '</div>').join('') : '<div class="pista">Sin rondas.</div>') +
      ((c.estado === 'COMPARTIDO' || (c.estado === 'WIP' && !c.retencion && zonaDeCarpeta(p, c.carpeta) === 'compartido')) && !revAbierta && R[rol] >= 1 && (pm.escribir || pm.editar) ? (flujosOk.length ? '<div style="margin-top:8px"><label>Flujo de trabajo</label><select id="rFlujo">' + flujosOk.map(f => '<option value="' + esc(f.id) + '">' + esc(f.nombre) + '</option>').join('') + '</select><div id="rFlujoTxt" class="pista"></div><div id="rDestino"></div><label>Comentario para los revisores</label><textarea id="rCom0"></textarea><div style="margin-top:6px"><button class="primario" id="rAbrir">Iniciar ronda ' + (c.revisiones.length + 1) + '</button></div></div>' : '<div class="pista" style="margin-top:8px">Ningún flujo te permite iniciar revisiones (lo definen los iniciadores de cada flujo).</div>') : (c.estado === 'WIP' ? '<p class="pista" style="margin-top:8px">Para revisar, desplaza primero el archivo a una carpeta compartida (COM).</p>' : '')) + '<div id="rMsg"></div></div>' +
      '<div class="tarjeta" style="margin-top:12px"><h2>Incidencias de este contenedor</h2>' + (c.incidencias.length ? c.incidencias.map(i => '<div><a href="#/p/' + pid + '/incidencias/' + i.id + '" class="mono">' + esc(i.codigo || ('#' + i.numero)) + '</a> ' + esc(i.titulo) + ' <span class="estado ' + esc(i.estado) + '">' + esc(i.estado) + '</span></div>').join('') : '<div class="pista">Ninguna.</div>') + (R[rol] >= 1 ? '<div style="margin-top:8px"><button id="iNueva">Nueva incidencia</button></div>' : '') + '</div></div></div>' + N.cierra();
    const atE = document.getElementById('atEd'); if (atE) atE.onclick = () => N.atributosDlg(p, c, () => vistaContenedor(pid, cid));
    document.getElementById('shAr').onclick = () => N.compartirArchivo(p, c);
    const rnA = document.getElementById('rnAr'); if (rnA) rnA.onclick = () => N.renombrarDlg(p, c, () => vistaContenedor(pid, cid));
    if (ult) N.pintaResumen(p, c, ult, document.getElementById('resumenIA'));
    app.querySelectorAll('a[data-mkv]').forEach(a => a.onclick = (e) => { e.preventDefault(); N.marcasVentana(p, c, a.dataset.mkv); });
    // v0.9.14: suprimir una version de modelo sin indice (solo el gestor; el servidor vuelve a comprobarlo todo)
    app.querySelectorAll('a[data-supv]').forEach(a => a.onclick = async (ev) => {
      ev.preventDefault(); const v = c.versiones.find(x => x.id === a.dataset.supv); if (!v) return;
      if (!confirm('Suprimir la version V' + v.n + ' (' + (v.revision || '') + ', ' + tam(v.tamano) + ') de ' + c.nombre + '?\nEs una version de modelo sin indice. Se borra del almacen y no se puede deshacer.')) return;
      try { await api('/api/proyectos/' + pid + '/versiones/' + v.id, { method: 'DELETE' }); N.toast('Versión V' + v.n + ' suprimida (' + tam(v.tamano) + ' liberados)'); vistaContenedor(pid, cid); } catch (e) { N.toast(esc(e.message), 'mal'); }
    });
    app.querySelectorAll('button[data-fvis]').forEach(b => b.onclick = () => window.open('visor.html?pid=' + encodeURIComponent(pid) + '&vid=' + encodeURIComponent(b.dataset.fvis), '_blank'));   // el visor lo prepara solo con la traduccion de Forma
    app.querySelectorAll('button[data-proc]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'En cola…'; try { const r = await api('/api/modelos/' + pid + '/' + b.dataset.proc + '/procesar', { method: 'POST' }); if (r.mensaje) N.toast(esc(r.mensaje), r.estado === 'no-legible' ? 'mal' : ''); vistaContenedor(pid, cid); } catch (e) { N.toast(esc(e.message), 'mal'); b.disabled = false; b.textContent = 'Procesar modelo'; } });
    // mientras el CDE lee el modelo, la ficha se pone al dia sola (fase y avance)
    const enCurso = c.versiones.filter(v => v.indice && EN_CURSO.includes(v.indice.estado));
    if (enCurso.length) { const vigila = async () => { if (!app.querySelector('[data-vigila]') || location.hash.indexOf(cid) < 0) return; let fin = true; for (const v of enCurso) { try { const st = await api('/api/modelos/' + pid + '/' + v.id + '/estado'); const el = app.querySelector('[data-vigila="' + v.id + '"]'); if (el) el.innerHTML = textoModelo(st); if (EN_CURSO.includes(st.estado)) fin = false; } catch (e) {} } if (fin) vistaContenedor(pid, cid); else setTimeout(vigila, 2500); }; setTimeout(vigila, 2000); }
    app.querySelectorAll('a[data-verv]').forEach(a => a.onclick = (e) => { e.preventDefault(); const vv = c.versiones.find(x => x.id === a.dataset.verv); verArchivo(p, Object.assign({}, c, { ultima: vv }), vv.id); });
    app.querySelectorAll('a[data-shx]').forEach(a => a.onclick = async (e) => { e.preventDefault(); try { await api('/api/proyectos/' + pid + '/compartidos/' + a.dataset.shx, { method: 'DELETE' }); vistaContenedor(pid, cid); } catch (err) { N.toast(esc(err.message), 'mal'); } });
    const tOk = document.getElementById('tOk'); if (tOk) tOk.onclick = async () => { try { await api('/api/proyectos/' + pid + '/contenedores/' + cid + '/estado', { json: { estado: document.getElementById('tEstado').value, idoneidad: document.getElementById('tIdon').value, comentario: document.getElementById('tCom').value, carpeta_destino: (document.getElementById('tDest') || {}).value || '' } }); vistaContenedor(pid, cid); } catch (e) { aviso(document.getElementById('tMsg'), e); } };
    const mv = document.getElementById('mvOk'); if (mv) mv.onclick = async () => { const ok = new Set(pm.carpetasMover); const dest = await eligeDestino(p, { titulo: 'Seleccionar carpeta de destino', boton: 'Desplazar', inicial: c.carpeta, texto: esc(c.nombre), apagada: (r) => r === c.carpeta ? 'Ya está aquí' : '', permitida: (x) => ok.has(x.ruta), motivo: () => 'Sin permiso de carga en esta carpeta' }); if (dest === null) return; try { await api('/api/proyectos/' + pid + '/contenedores/' + cid + '/mover', { json: { carpeta: dest } }); N.toast('Desplazado a ' + esc(dest.split('/').pop())); vistaContenedor(pid, cid); } catch (e) { aviso(document.getElementById('mvMsg'), e); } };
    const rF = document.getElementById('rFlujo'); if (rF) { const pinta = () => { const f = c.flujos.find(x => x.id === rF.value); document.getElementById('rFlujoTxt').innerHTML = f ? (f.descripcion ? esc(f.descripcion) + '<br>' : '') + f.etapas.map((e, i) => (i + 1) + '. ' + esc(e.nombre) + (e.pasos.length > 1 ? ' — en paralelo: ' : ': ') + e.pasos.map(x => esc(x.nombre) + ' <span class="mono">(' + esc(N.quienTxt(x.revisores)) + (x.dias ? ', ' + x.dias + ' d' : '') + ')</span>').join(' | ')).join('<br>') + '<br>Al aprobar: ' + esc(f.alAprobar.estado) + ' ' + esc(f.alAprobar.idoneidad) + (f.alAprobar.copiarA ? ' · copia a ' + esc(f.alAprobar.copiarA) : '') : ''; document.getElementById('rDestino').innerHTML = f && f.alAprobar.iniciadorPuedeCambiar ? '<label>Carpeta a la que se copia al aprobar (puedes cambiarla)</label><select id="rCopiarA"><option value="">(sin copia)</option>' + p.arbol.filter(x => x.zonaEfectiva !== 'wip').map(x => '<option' + (x.ruta === f.alAprobar.copiarA ? ' selected' : '') + '>' + esc(x.ruta) + '</option>').join('') + '</select>' : ''; }; rF.onchange = pinta; pinta(); }
    const rA = document.getElementById('rAbrir'); if (rA) rA.onclick = async () => { try { const b = { flujo: document.getElementById('rFlujo').value, comentario: document.getElementById('rCom0').value }; const ca = document.getElementById('rCopiarA'); if (ca) b.copiarA = ca.value; await api('/api/proyectos/' + pid + '/contenedores/' + cid + '/revisiones', { json: b }); vistaContenedor(pid, cid); } catch (e) { aviso(document.getElementById('rMsg'), e); } };
    N.enlazaDecisiones(pid, () => vistaContenedor(pid, cid));
    const iN = document.getElementById('iNueva'); if (iN) iN.onclick = () => N.nuevaIncidencia(p, { contenedor_id: cid, version_id: ult && ult.id }, () => vistaContenedor(pid, cid));
  }


  Object.assign(N, { verArchivo, seVe, vistaProyecto, vistaContenedor, vistaRetencion, arbolHtml, editaPermisos, transmision, eligeDestino, disparadorDlg, ventanaCargar, desplazaContenedores });
  N.vistas.proyecto = vistaProyecto;
  N.vistas.contenedor = vistaContenedor;
})();
