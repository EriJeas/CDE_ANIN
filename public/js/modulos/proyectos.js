/* MODULO: acceso y lista de proyectos */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, num, ventana, barras, R, NIVEL_TXT, ZONA_TXT, dia, estado, aviso, app } = N;
  // ---------- acceso ----------
  const M = N.MARCA;
  const cabPortada = (extra) => '<div class="pcab"><img src="' + M.logo + '" alt="ANIN"><div class="plema"><b>' + esc(M.entidad) + '</b>' + (M.lema ? '<span>' + esc(M.lema) + '</span>' : '') + '</div><div class="crece"></div>' + (extra || '') + '</div><div class="pfranja"></div>';
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

  // ---------- PORTADA 2 · direcciones ejecutoras: Dirección › Subdirección › Proyecto ----------
  N.ABIERTO_EST = N.ABIERTO_EST || null;
  async function vistaProyectos() {
    const d = await api('/api/estructura'), yo = N.YO || {};
    const AB = N.ABIERTO_EST || (N.ABIERTO_EST = new Set(d.direcciones.flatMap(x => x.subs.some(s => s.proyectos.some(h => h.cde.length)) ? [x.id].concat(x.subs.filter(s => s.proyectos.some(h => h.cde.length)).map(s => x.id + '/' + s.id)) : [])));
    if (!AB.size) d.direcciones.forEach(x => AB.add(x.id));
    const hoja = (dir, sub, h) => h.cde.length ? h.cde.map(p => '<a class="eh con" href="#/p/' + p.id + '/inicio"><span class="en">' + esc(h.nombre) + '</span><span class="pista"><span class="mono">' + esc(p.codigo) + '</span> · ' + esc(p.nombre) + ' · ' + esc(p.rol) + '</span><span class="ek">' + num(p.contenedores) + ' documentos · ' + num(p.incidencias_abiertas) + ' observaciones abiertas</span><i>›</i></a>').join('')
      : '<div class="eh sin"><span class="en">' + esc(h.nombre) + '</span><span class="pista">' + (d.admin ? 'Aún sin CDE' : 'Sin acceso o aún sin CDE') + '</span>' + (d.admin ? '<button class="mini" data-crea="' + esc(dir.id + '|' + sub.id + '|' + h.nombre) + '">Crear su CDE</button>' : '') + '</div>';
    const arbolH = d.direcciones.map(dir => { const ab = AB.has(dir.id), n = dir.subs.reduce((a, s) => a + s.proyectos.reduce((b, h) => b + h.cde.length, 0), 0);
      return '<div class="ed"><button class="et n1" data-ab="' + dir.id + '"><i>' + (ab ? '▾' : '▸') + '</i><b>' + esc(dir.nombre) + ' (' + esc(dir.id) + ')</b><span class="pista">' + n + ' con CDE</span></button>' + (ab ? dir.subs.map(sub => { const k = dir.id + '/' + sub.id, a2 = AB.has(k);
        return '<div class="es"><button class="et n2" data-ab="' + k + '"><i>' + (a2 ? '▾' : '▸') + '</i><b>' + esc(sub.nombre) + (sub.nombre === sub.id ? '' : ' (' + esc(sub.id) + ')') + '</b><span class="pista">' + sub.proyectos.length + ' proyecto(s)</span></button>' + (a2 ? '<div class="ehs">' + sub.proyectos.map(h => hoja(dir, sub, h)).join('') + '</div>' : '') + '</div>'; }).join('') : '') + '</div>'; }).join('');
    app.innerHTML = '<div class="portada p2">' + cabPortada('<button class="redondo usuario" id="menuUsuario" title="' + esc(yo.email || '') + '">' + N.circulo(yo.email, yo.foto) + ' <i>▾</i></button>') +
      '<div class="pcuerpo"><div class="pt"><h1>Direcciones ejecutoras</h1><p class="pista">Elige la Dirección, la Subdirección y el Proyecto con el que vas a trabajar.</p></div>' + (d.admin ? '<div class="pacc"><button class="primario" id="nuevoP">Nuevo proyecto</button></div>' : '') +
      '<div class="tarjeta earbol">' + arbolH + '</div>' +
      (d.sinUbicar.length ? '<div class="tarjeta earbol"><h3 style="margin:0 0 6px">Proyectos del CDE sin ubicar en una Dirección</h3>' + d.sinUbicar.map(p => '<div class="eh con"><a class="en" href="#/p/' + p.id + '/inicio">' + esc(p.nombre) + '</a><span class="pista"><span class="mono">' + esc(p.codigo) + '</span> · ' + esc(p.rol) + '</span>' + (['gestor', 'administrador'].includes(p.rol) || d.admin ? '<button class="mini" data-ubica="' + p.id + '">Ubicar…</button>' : '') + '</div>').join('') + '</div>' : '') +
      '</div><div class="ppie">CDE ANIN · Entorno Común de Datos · ISO 19650</div></div>';
    app.querySelectorAll('[data-ab]').forEach(b => b.onclick = () => { AB.has(b.dataset.ab) ? AB.delete(b.dataset.ab) : AB.add(b.dataset.ab); vistaProyectos(); });
    const mu = document.getElementById('menuUsuario'); if (mu) mu.onclick = (e) => { e.stopPropagation(); N.menuFlotante(mu, [{ texto: '<b>' + esc(yo.email || '') + '</b>', accion: null }, ...(N.menuCuenta ? N.menuCuenta() : []), { texto: 'Cerrar sesión', accion: async () => { await api('/api/acceso/salir', { method: 'POST' }); N.YO = null; location.hash = '#/acceso'; } }], 'derecha'); };
    const selUb = (pre) => '<label>Dirección › Subdirección</label><select id="ubSub">' + d.direcciones.flatMap(x => x.subs.map(sb => '<option value="' + x.id + '|' + sb.id + '"' + (pre && pre[0] === x.id && pre[1] === sb.id ? ' selected' : '') + '>' + esc(x.id + ' › ' + sb.nombre) + '</option>')).join('') + '</select><label>Proyecto del mapa</label><select id="ubProy"></select>';
    const ataUb = (c, pre) => { const ss = c.querySelector('#ubSub'), sp = c.querySelector('#ubProy'); const pinta = () => { const [a, b] = ss.value.split('|'), sb = d.direcciones.find(x => x.id === a).subs.find(x => x.id === b); sp.innerHTML = sb.proyectos.map(h => '<option' + (pre && pre[2] === h.nombre ? ' selected' : '') + '>' + esc(h.nombre) + '</option>').join('') + '<option value="">(otro: usar el nombre del proyecto)</option>'; }; ss.onchange = pinta; pinta(); return () => { const [a, b] = ss.value.split('|'); return { direccion: a, sub: b, proyecto: sp.value }; }; };
    app.querySelectorAll('[data-ubica]').forEach(b => b.onclick = () => { const c = ventana('Ubicar el proyecto en una Dirección', selUb() + '<div style="margin-top:12px"><button class="primario" id="ubOk">Guardar</button></div><div id="ubMsg"></div>', { ancho: 520, alto: 290 }); const lee = ataUb(c); c.querySelector('#ubOk').onclick = async () => { try { await api('/api/proyectos/' + b.dataset.ubica + '/ubicacion', { method: 'PUT', json: lee() }); c.closest('.ventana').remove(); N.ABIERTO_EST = null; vistaProyectos(); } catch (e) { aviso(c.querySelector('#ubMsg'), e); } }; });
    const nuevo = (pre) => {
      const c = ventana('Nuevo proyecto', selUb(pre) + '<label>Código (va como primer campo del nombre de cada archivo)</label><input id="npCod" placeholder="LACALETA"><label>Nombre</label><input id="npNom" placeholder="Hospital La Caleta III-1" value="' + esc(pre ? pre[2] : '') + '"><label>Descripción</label><textarea id="npDes"></textarea><h3>Carpetas iniciales</h3>' + N.plantillaHtml(null, 'np') + '<div style="margin-top:10px"><button class="primario" id="npOk">Crear</button></div><div id="npMsg"></div>', { ancho: 700, alto: 720 });
      N.ataPlantilla(c, 'np'); const lee = ataUb(c, pre);
      c.querySelector('#npOk').onclick = async () => { try { const b = N.leePlantilla(c, 'np'); const r = await api('/api/proyectos', { json: Object.assign(b, { codigo: c.querySelector('#npCod').value, nombre: c.querySelector('#npNom').value, descripcion: c.querySelector('#npDes').value, ubicacion: lee() }) }); N.PROYECTOS = null; N.ABIERTO_EST = null; location.hash = '#/p/' + r.id + '/inicio'; c.closest('.ventana').remove(); } catch (e) { aviso(c.querySelector('#npMsg'), e); } };
    };
    app.querySelectorAll('[data-crea]').forEach(b => b.onclick = () => nuevo(b.dataset.crea.split('|')));
    const n = document.getElementById('nuevoP'); if (n) n.onclick = () => nuevo(null);
  }

  // ---------- PORTADA 3 · inicio del proyecto: los dos grandes módulos ----------
  async function vistaInicioProyecto(pid) {
    const p = await api('/api/proyectos/' + pid), ub = p.ubicacion;
    app.innerHTML = N.marco(p, '/inicio', '', '') +
      '<div class="pmigas">' + (ub ? '<span>' + esc(ub.direccionNombre) + ' (' + esc(ub.direccion) + ')</span> › <span>' + esc(ub.subNombre) + '</span> › ' : '') + '<b>' + esc(p.nombre) + '</b></div>' +
      '<div class="pmods"><a class="pmod" href="#/p/' + pid + '"><span class="pmi"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span><h2>Documentos e información de proyecto</h2><p>La información del proyecto en carpetas WIP, COM y PUB con su nomenclatura y metadatos: carga y búsqueda de documentos, revisión contractual con rondas, avances de proyecto, observaciones contractuales y el visor GIS/BIM de modelos, planos y cronogramas.</p><span class="pir">Ir a Documentos de proyecto ›</span></a>' +
      '<a class="pmod" href="#/p/' + pid + '/correspondencia"><span class="pmi"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span><h2>Comunicaciones de proyecto</h2><p>Las comunicaciones contractuales entre las partes, numeradas y con su línea de respuestas: cartas, transmittals, consultas e instrucciones, y los registros NEC de alertas tempranas y eventos compensables con sus plazos.</p><span class="pir">Ir a Comunicaciones contractuales ›</span></a></div>' + N.cierra();
  }

  Object.assign(N, { vistaAcceso, vistaProyectos, vistaInicioProyecto });
  N.vistas.acceso = vistaAcceso;
  N.vistas.proyectos = vistaProyectos;
  N.vistas.inicioProyecto = vistaInicioProyecto;
})();
