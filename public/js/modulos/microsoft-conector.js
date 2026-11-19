/* CONECTOR MICROSOFT 365 (Integración con otros CDE → OneDrive / SharePoint): conecta la cuenta de Microsoft 365 de cada usuario
 * y trae al CDE los archivos de una carpeta de OneDrive o de una biblioteca de SharePoint. Una sola conexión sirve para los dos.
 * El servidor es lib/conector-microsoft.js; lo que se trae entra por la carga de siempre. */
(function () {
  const N = CDE.N, { esc, api, fecha, app } = N, tam = CDE.tam;
  const NOMBRE = { onedrive: 'OneDrive', sharepoint: 'SharePoint' };
  const M = (pid) => '/api/proyectos/' + pid + '/microsoft';
  let reloj = null;
  N.tabsNube = (activa) => ['onedrive', 'sharepoint'].map(k => '<button data-t="' + k + '" class="' + (activa === k ? 'activa' : '') + '">' + NOMBRE[k] + '</button>').join('');

  async function vista(p, d, origen) {
    const pid = p.id, nom = NOMBRE[origen]; clearTimeout(reloj);
    const m = /[?&]microsoft=([^&#]*)/.exec(location.search); let vuelta = '';
    if (m) { vuelta = decodeURIComponent(m[1]); history.replaceState(null, '', location.pathname + location.hash); }
    let est, L;
    try { [est, L] = await Promise.all([api('/api/microsoft/estado'), api(M(pid) + '/enlaces?origen=' + origen)]); }
    catch (e) { app.innerHTML = N.marco(p, '/puente', '', '') + '<div class="aviso rojo">' + esc(e.message) + '</div>' + N.cierra(); return; }
    const t = (k, txt, n) => '<button data-t="' + k + '">' + txt + (n === '' ? '' : ' <span class="pista">' + n + '</span>') + '</button>';
    const puedo = L.puedoCrear && est.configurado && est.conectado;
    const cuenta = !est.configurado
      ? '<div class="fcx sin"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Falta registrar la aplicación de Microsoft 365 en este CDE.</b><div class="pista">Se registra una sola vez en Microsoft Entra y sirve para OneDrive y SharePoint. <a href="#" id="msComo">Ver cómo se registra</a></div></div></div>'
      : est.conectado
        ? '<div class="fcx ok"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Conectado con Microsoft 365 como ' + esc(est.cuenta.nombre || est.cuenta.correo || 'tu cuenta') + '</b><div class="pista">' + esc(est.cuenta.correo || '') + ' · desde ' + fecha(est.cuenta.desde) + ' · solo lectura: el CDE no escribe ni borra nada en ' + nom + '</div>' + (est.cuenta.error ? '<div style="color:var(--rojo)">' + esc(est.cuenta.error) + '</div>' : '') + '</div><button id="msOtra">Reconectar</button><button id="msSalir">Desconectar</button></div>'
        : '<div class="fcx"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Conecta tu cuenta de Microsoft 365</b><div class="pista">El CDE lee ' + nom + ' con tus mismos permisos y solo en lectura: verás las carpetas a las que tú tienes acceso. <a href="#" id="msComo">Dirección de retorno y registro</a></div></div><button class="primario" id="msConectar">Conectar con Microsoft 365</button></div>';
    const prog = (e) => { const c = e.enCurso; return c ? '<span class="estado abierta">' + (c.fase === 'leyendo' ? 'LEYENDO' : 'TRAYENDO') + '</span><div class="pista">' + (c.fase === 'leyendo' ? (c.vistos || 0) + ' archivo(s) vistos' : (c.hecho || 0) + ' de ' + (c.total || 0) + (c.nombre ? ' · ' + esc(c.nombre) : '')) + '</div>' : ''; };
    const resumen = (e) => { const r = e.resumen || {}; if (e.error) return '<span style="color:var(--rojo)">' + esc(e.error) + '</span>'; if (!e.ultimo) return '<span class="pista">Aún no se ha traído</span>'; return '<b>' + (r.traidos || 0) + '</b> traído(s) · ' + (r.yaEstaban || 0) + ' ya estaban' + (r.noEntraron ? ' · <span style="color:var(--rojo)">' + r.noEntraron + ' no entraron</span>' : '') + (r.omitidos ? ' · ' + r.omitidos + ' omitido(s)' : '') + '<div class="pista">' + fecha(e.ultimo) + '</div>'; };
    const fila = (e) => '<tr><td><b>' + esc((e.sitio_nombre ? e.sitio_nombre + ' › ' : '') + (e.unidad_nombre || nom)) + '</b><div class="pista">' + esc(e.carpeta_nombre || 'Carpeta principal') + (e.subcarpetas ? ' · con subcarpetas' : '') + '</div></td><td><a href="#/p/' + pid + '">' + esc(e.carpeta_cde) + '</a></td><td>' + (e.automatico ? '<span class="estado abierta">AUTOMÁTICA</span><div class="pista">cada ' + est.intervaloMin + ' min</div>' : '<span class="estado WIP">Automática según solicitud</span>') + '</td><td>' + (prog(e) || resumen(e)) + '</td><td>' + N.avatarMini(e.por) + '</td><td style="white-space:nowrap"><button class="mini" data-sync="' + esc(e.id) + '"' + (e.enCurso || !puedo ? ' disabled' : '') + '>Sincronizar ahora</button> <button class="mini" data-ver="' + esc(e.id) + '">Ver archivos</button> <button class="mini peligro" data-quita="' + esc(e.id) + '">Quitar</button></td></tr>';
    app.innerHTML = N.marco(p, '/puente', '', puedo ? '<button class="primario" id="msTraer">+ Traer carpeta de ' + nom + '</button>' : '') +
      '<div class="acctabs"><div class="tabs">' + t('salientes', 'Compartidas con otros proyectos', d.salientes.length) + t('entrantes', 'Recibidas de otros proyectos', d.entrantes.length) + (N.formaConector ? t('forma', 'Autodesk Forma', '') : '') + (N.aconexConector ? t('aconex', 'Oracle Aconex', '') : '') + N.tabsNube(origen) + '</div></div>' +
      (vuelta ? '<div class="aviso ' + (vuelta === 'conectado' ? 'verde' : 'rojo') + '" style="margin-bottom:12px">' + (vuelta === 'conectado' ? 'Cuenta de Microsoft 365 conectada.' : esc(vuelta.replace(/^error:/, ''))) + '</div>' : '') + cuenta +
      '<div class="tarjeta" style="margin-top:12px"><div class="acctabla">' + (L.enlaces.length ? '<table><thead><tr><th>Carpeta de ' + nom + '</th><th>Carpeta del CDE</th><th>Sincronización</th><th>Último resultado</th><th>Creado por</th><th></th></tr></thead><tbody>' + L.enlaces.map(fila).join('') + '</tbody></table>'
        : '<div class="intro-vacio">' + N.ICO.enlace + '<div>Aún no se ha traído ninguna carpeta de ' + nom + '. ' + (puedo ? 'Pulsa «Traer carpeta de ' + nom + '», elige la carpeta y la carpeta del CDE donde se cargará.' : est.configurado ? 'Conecta tu cuenta de Microsoft 365 para empezar.' : '') + '</div></div>') +
      '</div><div class="accpie">Mostrando ' + L.enlaces.length + ' enlace(s) · Cada archivo entra por la carga del CDE: si cambia en ' + nom + ', la siguiente sincronización lo trae como una versión nueva del mismo documento.</div></div>' + N.cierra();
    const on = (i, fn) => { const e = document.getElementById(i); if (e) e.onclick = (ev) => { ev.preventDefault(); fn(ev); }; };
    app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { clearTimeout(reloj); N.FPU = b.dataset.t; N.vistas.puente(pid); });
    const conecta = () => { location.href = '/api/microsoft/conectar?pid=' + encodeURIComponent(pid) + '&origen=' + origen; };
    on('msConectar', conecta); on('msOtra', conecta);
    on('msSalir', async () => { if (!(await N.confirma('¿Desconectar la cuenta de Microsoft 365?', 'Lo ya traído se queda en el CDE. Los enlaces automáticos que creaste dejan de sincronizarse hasta que vuelvas a conectar.', 'Desconectar', true))) return; await api('/api/microsoft/desconectar', { method: 'POST' }); vista(p, d, origen); });
    on('msComo', () => N.ventana('Registrar la aplicación de Microsoft 365', '<ol class="obrayuda"><li><b>Aplicación en Microsoft Entra.</b> En entra.microsoft.com → Identidad → Aplicaciones → Registros de aplicaciones → «Nuevo registro». En «URI de redirección» elige plataforma <b>Web</b> y pega exactamente esta dirección:<div class="fcret"><span class="mono">' + esc(est.retorno) + '</span> <button class="mini" id="msCopia">Copiar</button></div></li>' +
      '<li><b>Permisos.</b> En «Permisos de API» agrega, de Microsoft Graph y de tipo <b>delegado</b>: <span class="mono">User.Read</span>, <span class="mono">Files.Read.All</span>, <span class="mono">Sites.Read.All</span> y <span class="mono">offline_access</span>. Si la organización lo exige, un administrador concede el consentimiento.</li>' +
      '<li><b>Secreto.</b> En «Certificados y secretos» crea un secreto de cliente y copia su <b>valor</b>.</li>' +
      '<li><b>Credenciales en el CDE.</b> En el archivo <span class="mono">.env</span> de la carpeta del CDE (o en <span class="mono">cde.env</span>, si la instalación guarda ahí su configuración; se abre con el Bloc de notas) completa <span class="mono">MS_CLIENT_ID</span> (Id. de aplicación), <span class="mono">MS_CLIENT_SECRET</span> y, si la aplicación es de un solo directorio, <span class="mono">MS_TENANT</span> (Id. de directorio); guarda y reinicia el CDE con <span class="mono">4-reinicia.bat</span>. El secreto no se escribe en ninguna pantalla del CDE.</li></ol><div class="pista">La misma aplicación sirve para OneDrive y SharePoint. El CDE solo lee: no escribe ni borra nada en Microsoft 365.</div>', { ancho: 640, alto: 520 }));
    document.addEventListener('click', function copia(e) { if (e.target && e.target.id === 'msCopia') { navigator.clipboard && navigator.clipboard.writeText(est.retorno); N.toast('Dirección copiada'); } }, { once: false });
    on('msTraer', () => traer(p, d, origen));
    app.querySelectorAll('[data-sync]').forEach(b => b.onclick = async () => { try { await api(M(pid) + '/enlaces/' + b.dataset.sync + '/sincronizar', { method: 'POST' }); vista(p, d, origen); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    app.querySelectorAll('[data-quita]').forEach(b => b.onclick = async () => { if (!(await N.confirma('¿Quitar el enlace?', 'Lo ya traído se queda en el CDE; solo deja de sincronizarse.', 'Quitar', true))) return; try { await api(M(pid) + '/enlaces/' + b.dataset.quita, { method: 'DELETE' }); vista(p, d, origen); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    app.querySelectorAll('[data-ver]').forEach(b => b.onclick = async () => {
      try { const r = await api(M(pid) + '/enlaces/' + b.dataset.ver + '/items'); const EST = { traido: ['Traído', 'aprobada'], pendiente: ['No entró', 'rechazada'], omitido: ['Omitido', 'WIP'] };
        N.ventana('Archivos traídos de ' + nom, r.items.length ? '<div class="acctabla"><table><thead><tr><th>Archivo</th><th>Subcarpeta</th><th class="num">Tamaño</th><th>Modificado en ' + nom + '</th><th>Estado</th><th>En el CDE</th></tr></thead><tbody>' + r.items.map(i => '<tr><td>' + esc(i.nombre) + '</td><td class="pista">' + esc(i.ruta || '—') + '</td><td class="num">' + tam(i.tamano) + '</td><td>' + (i.fecha_nube ? fecha(i.fecha_nube) : '—') + (i.autor ? '<div class="pista">' + esc(i.autor) + '</div>' : '') + '</td><td><span class="estado ' + (EST[i.estado] || ['', 'WIP'])[1] + '">' + (EST[i.estado] || [i.estado])[0] + '</span>' + (i.detalle ? '<div class="pista" style="max-width:320px;white-space:normal">' + esc(i.detalle) + '</div>' : '') + '</td><td>' + (i.contenedor_id ? '<a href="#/p/' + pid + '/c/' + esc(i.contenedor_id) + '">Versión ' + i.n_cde + '</a>' : '—') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="pista">Todavía no hay archivos registrados para este enlace.</div>', { ancho: 980, alto: 600 });
      } catch (e) { N.toast(esc(e.message), 'mal'); } });
    if (L.enlaces.some(e => e.enCurso)) reloj = setTimeout(() => { if (location.hash.includes('/puente') && N.FPU === origen) vista(p, d, origen); }, 2000);
  }

  /** Elegir la carpeta de la nube y la del CDE. */
  function traer(p, d, origen) {
    const pid = p.id, nom = NOMBRE[origen], sp = origen === 'sharepoint';
    const v = N.ventana('Traer carpeta de ' + nom, '<div class="fctraer">' +
      (sp ? '<div class="fila" style="gap:12px;align-items:flex-end"><div style="flex:2"><label>Sitio de SharePoint</label><div class="fila" style="gap:6px"><input id="mtBusca" placeholder="Buscar un sitio por su nombre" class="crece"><button id="mtBuscar">Buscar</button></div></div></div>' +
        '<div class="fila" style="gap:12px;margin-top:10px"><div style="flex:1"><label>Sitio</label><select id="mtSitio"><option value="">Cargando…</option></select></div><div style="flex:1"><label>Biblioteca de documentos</label><select id="mtBib" disabled><option value="">Elige primero el sitio…</option></select></div></div>' : '') +
      '<label style="margin-top:10px">Carpeta de ' + nom + '</label><div class="fcmigas" id="mtMigas"><span class="pista">Cargando…</span></div><div class="fclista" id="mtLista"></div>' +
      '<label style="margin-top:10px">Carpeta del CDE donde se cargará</label><div class="fila" style="gap:8px;align-items:center"><span class="mono crece" id="mtDest">Sin elegir</span><button id="mtElige">Elegir carpeta</button></div>' +
      '<div class="pista" style="margin-top:4px">Los nombres de ' + nom + ' no siguen la nomenclatura del proyecto: elige una carpeta de trabajo en progreso (WIP) y luego copia o mueve al compartido lo que corresponda.</div>' +
      '<div class="fila" style="gap:22px;margin-top:12px"><label class="chk"><input type="checkbox" id="mtSub" checked> Incluir subcarpetas</label><label class="chk"><input type="checkbox" id="mtAuto"> Sincronizar automáticamente</label></div>' +
      '<div class="fila" style="margin-top:14px;align-items:center;gap:10px"><span class="pista crece" id="mtResumen"></span><button class="enlace" id="mtNo">Cancelar</button><button class="primario" id="mtOk" disabled>Traer</button></div></div>', { ancho: 720, alto: 640 });
    const win = v.closest('.ventana'), g = (i) => v.querySelector('#' + i);
    const S = { unidad: '', unidadNombre: '', sitio: '', sitioNombre: '', ruta: [], destino: (p.carpetaWip || '') };
    const aviso = (el, e) => { el.innerHTML = '<span style="color:var(--rojo)">' + esc(e.message || e) + '</span>'; };
    const listo = () => { g('mtDest').textContent = S.destino || 'Sin elegir'; g('mtOk').disabled = !(S.unidad && S.destino); g('mtResumen').textContent = S.unidad ? (S.sitioNombre ? S.sitioNombre + ' › ' : '') + S.unidadNombre + (S.ruta.length ? '/' + S.ruta.map(x => x.nombre).join('/') : '') : ''; };
    const lista = async () => {
      const Lc = g('mtLista'); if (!S.unidad) { Lc.innerHTML = ''; g('mtMigas').innerHTML = '<span class="pista">' + (sp ? 'Elige el sitio y la biblioteca.' : 'Cargando…') + '</span>'; return listo(); }
      g('mtMigas').innerHTML = '<a href="#" data-m="-1">' + esc(S.unidadNombre) + '</a>' + S.ruta.map((x, i) => ' › <a href="#" data-m="' + i + '">' + esc(x.nombre) + '</a>').join('');
      g('mtMigas').querySelectorAll('[data-m]').forEach(a => a.onclick = (e) => { e.preventDefault(); S.ruta = S.ruta.slice(0, +a.dataset.m + 1); lista(); });
      Lc.innerHTML = '<div class="pista" style="padding:10px 12px">Cargando…</div>'; listo();
      try {
        const r = await api('/api/microsoft/unidades/' + encodeURIComponent(S.unidad) + '/contenido' + (S.ruta.length ? '?item=' + encodeURIComponent(S.ruta[S.ruta.length - 1].id) : ''));
        const car = r.items.filter(x => x.carpeta), arc = r.items.filter(x => !x.carpeta);
        Lc.innerHTML = (car.map(x => '<div class="fcfila" data-i="' + esc(x.id) + '" data-n="' + esc(x.nombre) + '"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span>' + esc(x.nombre) + '</span><i>' + x.hijos + ' elemento(s)</i></div>').join('') +
          arc.slice(0, 200).map(x => '<div class="fcfila arch"><span class="mono">' + esc(x.nombre) + '</span><i>' + tam(x.tamano) + '</i></div>').join('')) || '<div class="pista" style="padding:10px 12px">Esta carpeta está vacía.</div>';
        Lc.querySelectorAll('.fcfila[data-i]').forEach(f => f.onclick = () => { S.ruta.push({ id: f.dataset.i, nombre: f.dataset.n }); lista(); });
        g('mtResumen').textContent += ' · ' + car.length + ' carpeta(s), ' + arc.length + ' archivo(s) aquí';
      } catch (e) { Lc.innerHTML = ''; aviso(Lc, e); }
    };
    if (sp) {
      const sitios = async (qq) => { g('mtSitio').innerHTML = '<option value="">Cargando…</option>'; try { const r = await api('/api/microsoft/sitios' + (qq ? '?q=' + encodeURIComponent(qq) : '')); S.sitios = r.sitios; g('mtSitio').innerHTML = '<option value="">' + (r.sitios.length ? 'Elige el sitio… (' + r.sitios.length + ')' : 'Ningún sitio: busca por su nombre') + '</option>' + r.sitios.map(s => '<option value="' + esc(s.id) + '">' + esc(s.nombre) + '</option>').join(''); } catch (e) { g('mtSitio').innerHTML = '<option value="">' + esc(e.message) + '</option>'; } };
      g('mtBuscar').onclick = () => sitios(g('mtBusca').value.trim()); g('mtBusca').onkeydown = (e) => { if (e.key === 'Enter') sitios(g('mtBusca').value.trim()); };
      g('mtSitio').onchange = async () => { const s = (S.sitios || []).find(x => x.id === g('mtSitio').value); S.sitio = s ? s.id : ''; S.sitioNombre = s ? s.nombre : ''; S.unidad = ''; S.ruta = []; lista(); g('mtBib').disabled = true; if (!s) return;
        g('mtBib').innerHTML = '<option value="">Cargando…</option>'; try { const r = await api('/api/microsoft/sitios/' + encodeURIComponent(s.id) + '/bibliotecas'); S.bibs = r.bibliotecas; g('mtBib').innerHTML = '<option value="">Elige la biblioteca… (' + r.bibliotecas.length + ')</option>' + r.bibliotecas.map(b => '<option value="' + esc(b.id) + '">' + esc(b.nombre) + '</option>').join(''); g('mtBib').disabled = false; } catch (e) { g('mtBib').innerHTML = '<option value="">' + esc(e.message) + '</option>'; } };
      g('mtBib').onchange = () => { const b = (S.bibs || []).find(x => x.id === g('mtBib').value); S.unidad = b ? b.id : ''; S.unidadNombre = b ? b.nombre : ''; S.ruta = []; lista(); };
      sitios(''); lista();
    } else api('/api/microsoft/onedrive').then(r => { S.unidad = r.unidad; S.unidadNombre = r.nombre; lista(); }).catch(e => aviso(g('mtMigas'), e));
    g('mtElige').onclick = async () => { const r = await N.eligeDestino(p, { titulo: 'Carpeta del CDE donde se cargará', boton: 'Seleccionar', inicial: S.destino, permitida: (c) => !!c.subir, motivo: () => 'Sin permiso de carga en esta carpeta' }); if (r !== null) { S.destino = r; listo(); } };
    g('mtNo').onclick = () => win.remove();
    g('mtOk').onclick = async () => {
      g('mtOk').disabled = true;
      try { await api(M(pid) + '/enlaces', { json: { origen, sitio: S.sitio, sitio_nombre: S.sitioNombre, unidad: S.unidad, unidad_nombre: S.unidadNombre, carpeta: S.ruta.length ? S.ruta[S.ruta.length - 1].id : '', carpeta_nombre: S.ruta.map(x => x.nombre).join('/'), carpeta_cde: S.destino, subcarpetas: g('mtSub').checked, automatico: g('mtAuto').checked } });
        win.remove(); N.toast('Trayendo la carpeta de ' + nom + '…'); vista(p, d, origen); }
      catch (e) { N.toast(esc(e.message), 'mal'); g('mtOk').disabled = false; }
    };
    listo();
  }
  N.microsoftConector = { vista };
})();
