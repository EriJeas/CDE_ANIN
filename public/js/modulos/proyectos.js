/* MODULO: acceso y lista de proyectos */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, num, ventana, barras, R, NIVEL_TXT, ZONA_TXT, dia, estado, aviso, app } = N;
  // ---------- acceso ----------
  const M = N.MARCA;
  const cabPortada = (extra) => '<div class="pcab"><img src="' + M.logo + '" alt="ANIN"><div class="plema"><b>' + esc(M.entidad) + '</b>' + (M.lema ? '<span>' + esc(M.lema) + '</span>' : '') + '</div><div class="crece"></div>' + (N.botonTema ? N.botonTema() : '') + (extra || '') + '</div><div class="pfranja"></div>';
  // ---------- PORTADA 1 · acceso ----------
  async function vistaAcceso() {
    const m = await api('/api/acceso/modo');
    app.innerHTML = '<div class="portada p1">' + cabPortada() + '<div class="pcentro"><div class="tarjeta acceso"><h1>CDE ANIN</h1><p>' + esc(M.sistema) + ' · ' + esc(M.entidad) + '</p>' +
      (m.modo === 'cuentas' ? '<label>Correo</label><input id="aEmail" type="email" placeholder="nombre@anin.gob.pe" autocomplete="username"><label>Clave</label><input id="aClave" type="password" autocomplete="current-password"><div style="margin-top:14px"><button class="primario" id="aEntrar">Entrar</button></div><div id="aMsg"></div><p class="pista" style="margin-top:12px">Si no tienes cuenta u olvidaste tu clave, pídesela al administrador del CDE.</p>'
        : m.modo === 'local' ? '<label>Correo</label><input id="aEmail" type="email" placeholder="nombre@anin.gob.pe"><label>Clave</label><input id="aClave" type="password"><div style="margin-top:14px"><button class="primario" id="aEntrar">Entrar</button></div><div id="aMsg"></div><p class="pista" style="margin-top:12px">Modo local (pruebas). En producción se entra con la cuenta institucional o con la cuenta de Autodesk.</p>'
        : m.modo === 'autodesk' ? '<a class="boton primario" href="/api/acceso/autodesk">Entrar con la cuenta de Autodesk</a>' : '<div class="aviso ambar">Acceso con cuenta institucional (Microsoft Entra): pendiente del registro de la aplicación por OTI.</div>') + '</div></div><div class="ppie">CDE ANIN · Entorno Común de Datos · ISO 19650</div></div>';
    const b = document.getElementById('aEntrar'); if (b) b.onclick = async () => {
      try { await api(m.modo === 'cuentas' ? '/api/acceso/cuenta' : '/api/acceso/local', { json: { email: document.getElementById('aEmail').value, clave: document.getElementById('aClave').value } }); N.YO = null; N.PROYECTOS = null; location.hash = '#/'; }
      catch (e) { aviso(document.getElementById('aMsg'), e); }
    };
    const ent = document.getElementById('aClave'); if (ent) ent.onkeydown = (e) => { if (e.key === 'Enter') b.click(); };
  }

  // ---------- PORTADA 2 · direcciones ejecutoras, en tres paneles: Direcciones › Proyectos › Opciones ----------
  // Se elige la Subdirección (panel 1), el proyecto (panel 2) y una de sus 4 opciones (panel 3); cada opción abre el proyecto solo con sus módulos.
  const PALABRAS_MENORES = /^(de|del|la|las|el|los|y|e|en|para|por|a)$/i;
  const siglas = (t) => { const w = String(t || '').split(/\s+/).filter(x => x && !PALABRAS_MENORES.test(x)); if (!w.length) return '?'; return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase(); };   // «Hospital La Caleta» → HC
  const icoOp = (o) => '<span class="p2ico">' + (N.ICO['op_' + o.id] || '') + '</span>';
  /** Las 4 opciones de un proyecto como tarjetas (portada 2 y opciones del proyecto). extra[id] = línea de datos de esa opción. */
  N.opcionesHtml = (pid, extra) => '<div class="p2ops">' + N.OPCIONES.map(o => '<a class="p2op" href="#/p/' + pid + o.inicio + '" data-op="' + o.id + '" data-pid="' + esc(pid) + '">' + icoOp(o) +
    '<div><b>' + esc(o.nombre) + '</b><small>' + esc(o.desc) + '</small><span class="p2mods">' + N.modulosDe(o).map(esc).join(' · ') + '</span>' + (extra && extra[o.id] ? '<span class="p2dato">' + extra[o.id] + '</span>' : '') + '</div><i>›</i></a>').join('') + '</div>';
  const ataOpciones = (cont) => cont.querySelectorAll('[data-op]').forEach(a => a.onclick = (e) => { e.preventDefault(); N.irOpcion(a.dataset.pid, a.dataset.op); });
  const memP2 = (x) => { try { if (x) localStorage.setItem('cde.p2', JSON.stringify(x)); return JSON.parse(localStorage.getItem('cde.p2') || '{}'); } catch (e) { return x || {}; } };

  async function vistaProyectos() {
    const d = await api('/api/estructura'), yo = N.YO || {}, SEL = memP2();
    const SUBS = d.direcciones.flatMap(dir => dir.subs.map(sub => ({ k: dir.id + '/' + sub.id, dir, sub, n: sub.proyectos.length, nCde: sub.proyectos.reduce((a, h) => a + h.cde.length, 0) })));
    if (d.sinUbicar.length) SUBS.push({ k: '__sin', sin: true, n: d.sinUbicar.length, nCde: d.sinUbicar.length });
    if (!SUBS.some(x => x.k === SEL.sub)) SEL.sub = (SUBS.find(x => x.nCde) || SUBS[0] || {}).k;
    const proyectosDe = (k) => { const x = SUBS.find(y => y.k === k); if (!x) return []; return x.sin ? d.sinUbicar.map(p => ({ p, h: null })) : x.sub.proyectos.flatMap(h => h.cde.length ? h.cde.map(p => ({ p, h })) : [{ p: null, h }]); };
    const todos = SUBS.flatMap(x => proyectosDe(x.k)).filter(e => e.p), elegido = () => (todos.find(e => e.p.id === SEL.pid) || {}).p;

    const pinta = () => {
      const tema = N.tema(), sub = SUBS.find(x => x.k === SEL.sub), lista = proyectosDe(SEL.sub), con = lista.filter(e => e.p), sin = lista.filter(e => !e.p);
      if (!con.some(e => e.p.id === SEL.pid) && con.length === 1) SEL.pid = con[0].p.id;   // un solo proyecto con CDE en la Subdirección: queda elegido
      const pe = con.some(e => e.p.id === SEL.pid) ? elegido() : null;   // las opciones son siempre de un proyecto de la Subdirección que se ve
      const panel = (cls, titulo, cuerpo, ext) => '<section class="upanel ' + cls + '"><header><h2>' + titulo + '</h2>' + (ext || '') + '</header><div class="upcuerpo">' + cuerpo + '</div></section>';
      // panel 1 · Direcciones y sus Subdirecciones
      const dirs = d.direcciones.map(dir => { const n = dir.subs.reduce((a, s) => a + s.proyectos.reduce((b, h) => b + h.cde.length, 0), 0);
        return '<div class="ucsec"><div class="ucgt"><b>' + esc(dir.nombre) + ' (' + esc(dir.id) + ')</b><span>' + n + ' con CDE</span></div><div class="p2subs">' + dir.subs.map(s => { const x = SUBS.find(y => y.k === dir.id + '/' + s.id);
          return '<button class="p2sub' + (x.k === SEL.sub ? ' activa' : '') + (x.nCde ? '' : ' cero') + '" data-sub="' + esc(x.k) + '"><span><b>' + esc(s.nombre) + (s.nombre === s.id ? '' : ' (' + esc(s.id) + ')') + '</b><small>' + x.n + ' proyecto' + (x.n === 1 ? '' : 's') + ' · ' + x.nCde + ' con CDE</small></span><i>›</i></button>'; }).join('') + '</div></div>'; }).join('') +
        (d.sinUbicar.length ? '<div class="ucsec"><div class="ucgt"><b>Sin ubicar en una Dirección</b><span>' + d.sinUbicar.length + ' con CDE</span></div><div class="p2subs"><button class="p2sub' + (SEL.sub === '__sin' ? ' activa' : '') + '" data-sub="__sin"><span><b>Proyectos del CDE sin ubicar</b><small>Ubícalos en su Dirección y Subdirección</small></span><i>›</i></button></div></div>' : '');
      // panel 2 · Proyectos de la Subdirección elegida
      const tarjeta = (e) => { const p = e.p, h = e.h, nombre = h ? h.nombre : p.nombre;
        return '<div class="ucard g p2proy' + (pe && pe.id === p.id ? ' activa' : '') + '" data-pid="' + esc(p.id) + '" tabindex="0" title="Ver las opciones de ' + esc(nombre) + '"><i class="ini">' + esc(siglas(nombre)) + '</i><div><b>' + esc(nombre) + '</b><small><span class="mono">' + esc(p.codigo) + '</span> · ' + esc(p.nombre) + '</small><small>' + esc(N.ROLES_TXT && N.ROLES_TXT[p.rol] || p.rol) + (h ? ' · ' + num(p.contenedores) + ' documentos · ' + num(p.incidencias_abiertas) + ' observaciones abiertas' : '') + '</small>' +
          (!h && (['gestor', 'administrador'].includes(p.rol) || d.admin) ? '<button class="mini" data-ubica="' + esc(p.id) + '">Ubicar…</button>' : '') + '</div></div>'; };
      const tarjetaSin = (h) => '<div class="ucard p2proy sin"><i class="ini">' + esc(siglas(h.nombre)) + '</i><div><b>' + esc(h.nombre) + '</b><small>' + (d.admin ? 'Aún sin CDE' : 'Sin acceso o aún sin CDE') + '</small>' + (d.admin ? '<button class="mini" data-crea="' + esc(sub.dir.id + '|' + sub.sub.id + '|' + h.nombre) + '">Crear su CDE</button>' : '') + '</div></div>';
      const tituloSub = sub ? (sub.sin ? 'Proyectos sin ubicar' : esc(sub.sub.nombre) + ' · ' + esc(sub.dir.id)) : '';
      const proys = !sub ? '<div class="pista">No hay Subdirecciones.</div>' : '<div class="usect">' + tituloSub + '</div>' +
        '<div class="usect">Con CDE <span>' + con.length + '</span></div>' + (con.length ? '<div class="ucards g p2lista">' + con.map(tarjeta).join('') + '</div>' : '<div class="pista p2vacio">Ningún proyecto de esta Subdirección tiene CDE todavía' + (d.admin ? ': créalo desde «Aún sin CDE».' : '.') + '</div>') +
        (sin.length ? '<div class="usect p2sep">Aún sin CDE <span>' + sin.length + '</span></div><div class="ucards p2lista">' + sin.map(e => tarjetaSin(e.h)).join('') + '</div>' : '');
      // panel 3 · Opciones del proyecto elegido
      const ops = pe ? '<div class="usect">' + esc(pe.nombre) + ' <span class="mono">' + esc(pe.codigo) + '</span></div>' + N.opcionesHtml(pe.id, { gestion: num(pe.contenedores) + ' documentos · ' + num(pe.incidencias_abiertas) + ' observaciones abiertas' })
        : '<div class="p2espera">' + N.OPCIONES.map(o => '<div class="p2op off">' + icoOp(o) + '<div><b>' + esc(o.nombre) + '</b></div></div>').join('') + '<p class="pista">Elige un proyecto con CDE para abrir una de sus opciones.</p></div>';
      app.innerHTML = '<div class="portada p2">' + cabPortada('<button class="redondo usuario" id="menuUsuario" title="' + esc(yo.email || '') + '">' + N.circulo(yo.email, yo.foto) + ' <i>▾</i></button>') +
        '<div class="pcuerpo p2cuerpo"><div class="pt"><h1>Direcciones ejecutoras</h1><p class="pista">Elige la Dirección, el proyecto y la opción con la que vas a trabajar.</p></div>' +
        '<div class="usu ' + tema + '"><div class="p2grid">' + panel('p2dir', 'Direcciones', dirs) + panel('p2pro', 'Proyectos', proys, d.admin ? '<button class="primario mini" id="nuevoP">Nuevo proyecto</button>' : '') + panel('p2opc', 'Opciones', ops) + '</div></div>' +
        '</div><div class="ppie">CDE ANIN · Entorno Común de Datos · ISO 19650</div></div>';
      app.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { SEL.sub = b.dataset.sub; memP2(SEL); pinta(); });
      app.querySelectorAll('.p2proy[data-pid]').forEach(c => { const elige = () => { SEL.pid = c.dataset.pid; memP2(SEL); pinta(); const o = app.querySelector('.p2opc'); if (o && innerWidth < 1100) o.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        c.onclick = (e) => { if (e.target.closest('button')) return; elige(); }; c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elige(); } };
        c.ondblclick = (e) => { if (e.target.closest('button')) return; N.irOpcion(c.dataset.pid, memOpcion(c.dataset.pid)); }; });
      ataOpciones(app);
      const mu = document.getElementById('menuUsuario'); if (mu) mu.onclick = (e) => { e.stopPropagation(); N.menuFlotante(mu, [{ texto: '<b>' + esc(yo.email || '') + '</b>', accion: null }, ...(N.menuCuenta ? N.menuCuenta() : []), { texto: 'Cerrar sesión', accion: async () => { await api('/api/acceso/salir', { method: 'POST' }); N.YO = null; location.hash = '#/acceso'; } }], 'derecha'); };
      app.querySelectorAll('[data-ubica]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const c = ventana('Ubicar el proyecto en una Dirección', selUb() + '<div style="margin-top:12px"><button class="primario" id="ubOk">Guardar</button></div><div id="ubMsg"></div>', { ancho: 520, alto: 290 }); const lee = ataUb(c); c.querySelector('#ubOk').onclick = async () => { try { await api('/api/proyectos/' + b.dataset.ubica + '/ubicacion', { method: 'PUT', json: lee() }); c.closest('.ventana').remove(); vistaProyectos(); } catch (err) { aviso(c.querySelector('#ubMsg'), err); } }; });
      app.querySelectorAll('[data-crea]').forEach(b => b.onclick = (e) => { e.stopPropagation(); nuevo(b.dataset.crea.split('|')); });
      const n = document.getElementById('nuevoP'); if (n) n.onclick = () => nuevo(sub && !sub.sin ? [sub.dir.id, sub.sub.id, ''] : null);
    };
    const memOpcion = (pid) => { try { return localStorage.getItem('cde.opcion.' + pid) || 'gestion'; } catch (e) { return 'gestion'; } };
    const selUb = (pre) => '<label>Dirección › Subdirección</label><select id="ubSub">' + d.direcciones.flatMap(x => x.subs.map(sb => '<option value="' + x.id + '|' + sb.id + '"' + (pre && pre[0] === x.id && pre[1] === sb.id ? ' selected' : '') + '>' + esc(x.id + ' › ' + sb.nombre) + '</option>')).join('') + '</select><label>Proyecto del mapa</label><select id="ubProy"></select>';
    const ataUb = (c, pre) => { const ss = c.querySelector('#ubSub'), sp = c.querySelector('#ubProy'); const pintaU = () => { const [a, b] = ss.value.split('|'), sb = d.direcciones.find(x => x.id === a).subs.find(x => x.id === b); sp.innerHTML = sb.proyectos.map(h => '<option' + (pre && pre[2] === h.nombre ? ' selected' : '') + '>' + esc(h.nombre) + '</option>').join('') + '<option value="">(otro: usar el nombre del proyecto)</option>'; }; ss.onchange = pintaU; pintaU(); return () => { const [a, b] = ss.value.split('|'); return { direccion: a, sub: b, proyecto: sp.value }; }; };
    const nuevo = (pre) => {
      const c = ventana('Nuevo proyecto', selUb(pre) + '<label>Código (va como primer campo del nombre de cada archivo)</label><input id="npCod" placeholder="LACALETA"><label>Nombre</label><input id="npNom" placeholder="Hospital La Caleta III-1" value="' + esc(pre ? pre[2] : '') + '"><label>Descripción</label><textarea id="npDes"></textarea><h3>Carpetas iniciales</h3>' + N.plantillaHtml(null, 'np') + '<div style="margin-top:10px"><button class="primario" id="npOk">Crear</button></div><div id="npMsg"></div>', { ancho: 700, alto: 720 });
      N.ataPlantilla(c, 'np'); const lee = ataUb(c, pre);
      c.querySelector('#npOk').onclick = async () => { try { const b = N.leePlantilla(c, 'np'); const r = await api('/api/proyectos', { json: Object.assign(b, { codigo: c.querySelector('#npCod').value, nombre: c.querySelector('#npNom').value, descripcion: c.querySelector('#npDes').value, ubicacion: lee() }) }); N.PROYECTOS = null; memP2(Object.assign(SEL, { pid: r.id })); location.hash = '#/p/' + r.id + '/inicio'; c.closest('.ventana').remove(); } catch (e) { aviso(c.querySelector('#npMsg'), e); } };
    };
    pinta();
  }

  // ---------- PORTADA 3 · opciones del proyecto: las mismas 4 opciones, dentro del marco del proyecto ----------
  async function vistaInicioProyecto(pid) {
    const p = await api('/api/proyectos/' + pid), ub = p.ubicacion;
    memP2(Object.assign(memP2(), { pid }));
    app.innerHTML = N.marco(p, '/inicio', '', '') +
      '<div class="pmigas">' + (ub ? '<span>' + esc(ub.direccionNombre) + ' (' + esc(ub.direccion) + ')</span> › <span>' + esc(ub.subNombre) + '</span> › ' : '') + '<b>' + esc(p.nombre) + '</b></div>' +
      '<div class="usu ' + N.tema() + '"><section class="upanel p2inicio"><header><h2>Elige una opción</h2></header><div class="upcuerpo"><p class="pista" style="margin-top:0">Cada opción abre el proyecto solo con sus módulos. Para pasar de una a otra, usa «Ir a» en la barra superior.</p>' + N.opcionesHtml(pid) + '</div></section></div>' + N.cierra();
    ataOpciones(app);
  }

  Object.assign(N, { vistaAcceso, vistaProyectos, vistaInicioProyecto });
  N.vistas.acceso = vistaAcceso;
  N.vistas.proyectos = vistaProyectos;
  N.vistas.inicioProyecto = vistaInicioProyecto;
})();
