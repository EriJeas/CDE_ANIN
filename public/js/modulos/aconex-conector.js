/* CONECTOR ORACLE ACONEX (pestaña «Oracle Aconex» de Integración con otros CDE): conectar la cuenta de Aconex y traer al CDE
 *  - Documentos: el registro de documentos de un proyecto de Aconex (todo o con filtro) a una carpeta del CDE, con sus revisiones;
 *  - Correo: el registro de correo (entrada y enviados), con su cuerpo al abrirlo;
 *  - Registro de documentos: el de Aconex cruzado con el CDE (qué está y qué falta).
 * Correo y registro también se cargan con los Excel que exporta Aconex, sin credenciales. */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, app } = N;
  const cierraV = (v) => { const w = v.closest('.ventana'); if (w) w.remove(); };
  const A = (pid) => '/api/proyectos/' + pid + '/aconex';
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const fd = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '';
  let reloj = null;
  const S = { sub: 'documentos', proyectos: null, correo: { filtro: '', tipo: '', q: '' }, registro: { filtro: '', q: '' } };

  // ───────── lectura de los Excel de Aconex (las columnas se reconocen por su título, en inglés o en español)
  const COLS_CORREO = {
    numero: /^(mail ?no\.?|n[ºo°.]* ?(de )?correo|n[uú]mero( de correo)?|nro\.? de correo|ref\.?|n[ºo°]\.?)$|mail ?number|n[uú]m(ero)? de correo/i,
    asunto: /^(subject|asunto)$/i,
    tipo: /^(type|tipo|mail type|tipo de correo|correspondence type|tipo de correspondencia)$/i,
    para: /^(to|para|destinatarios?|recipients?|to users?)$/i,
    de: /^(from|de|remitente|enviado por|from user|sender)$/i,
    org: /from org|organizaci[oó]n( del remitente| remitente)?$|^organization$|^empresa$|from company/i,
    fecha: /^(sent|sent date|date sent|enviado|fecha( de env[ií]o)?|fecha enviado|date)$/i,
    vence: /response due|due date|respuesta requerida|fecha (l[ií]mite|de respuesta)|vence|vencimiento|^respond by$/i,
    respondido: /^(responded|respondido|fecha respondido|replied|closed( date)?|cerrado)$/i,
    estado: /^(status|estado|estatus)$/i,
    motivo: /reason for issue|motivo/i,
    referencia: /reference number|^referencia$|in ref/i,
    contrato: /^(\((ecc|psc)\)\s*)?contra(to|ct)$/i,
  };
  const COLS_DOC = {
    numero: /^(document ?no\.?|document number|doc ?no\.?|n[ºo°.]* ?(de )?documento|n[uú]mero de documento|nro\.? de documento|documento)$/i,
    revision: /^(revision|revisi[oó]n|rev\.?)$/i,
    titulo: /^(title|t[ií]tulo)$/i,
    tipo: /^(type|document type|tipo|tipo de documento)$/i,
    estado: /^(status|estado|estatus)$/i,
    disciplina: /^(discipline|disciplina)$/i,
    fecha: /^(date modified|date|fecha|fecha de modificaci[oó]n|revision date|fecha de revisi[oó]n|date of issue|fecha de emisi[oó]n)$/i,
    archivo: /^(file|filename|file name|archivo|nombre de(l)? archivo)$/i,
  };
  const FECHAS = new Set(['fecha', 'vence', 'respondido']);
  const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  function fechaDe(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    m = /^(\d{1,2})[\s/.-]+([a-záéíóú]{3})[a-záéíóú]*\.?[\s/.-]+(\d{2,4})/i.exec(s); if (m && MESES[norm(m[2]).slice(0, 3)]) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(MESES[norm(m[2]).slice(0, 3)]).padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
  }
  function detecta(cab, muestra, COLS) {
    const out = {}, usadas = new Set(), nf = (i) => muestra.reduce((n, f) => n + (f && fechaDe(f[i]) ? 1 : 0), 0);
    for (const [k, re] of Object.entries(COLS)) {
      out[k] = -1; const cand = [];
      cab.forEach((t, i) => { t = String(t == null ? '' : t).trim(); if (!usadas.has(i) && t && re.test(t)) cand.push(i); });
      if (!cand.length) continue; let mejor = cand[0];
      if (FECHAS.has(k) && cand.length > 1) { let max = nf(mejor); for (const i of cand.slice(1)) { const n = nf(i); if (n > max) { max = n; mejor = i; } } }
      out[k] = mejor; usadas.add(mejor);
    }
    return out;
  }
  /** Un libro de Excel (o CSV) exportado de Aconex: si es de correo o de documentos, y sus filas. */
  function leeLibro(XL, datos, nombre) {
    const wb = XL.read(datos, { type: 'array', cellDates: true });
    for (const nh of wb.SheetNames) {
      const a = XL.utils.sheet_to_json(wb.Sheets[nh], { header: 1, raw: true, defval: '', blankrows: false });
      for (let i = 0; i < Math.min(15, a.length); i++) {
        const mc = detecta(a[i], a.slice(i + 1, i + 60), COLS_CORREO), md = detecta(a[i], a.slice(i + 1, i + 60), COLS_DOC);
        const esCorreo = (mc.numero >= 0 || mc.asunto >= 0) && (mc.fecha >= 0 || mc.de >= 0 || mc.vence >= 0) && md.numero < 0;
        const esDoc = md.numero >= 0 && (md.revision >= 0 || md.titulo >= 0);
        if (!esCorreo && !esDoc) continue;
        const M = esCorreo ? mc : md, filas = [];
        for (const f of a.slice(i + 1)) {
          const o = {}; for (const [k, j] of Object.entries(M)) if (j >= 0) o[k] = FECHAS.has(k) ? fechaDe(f[j]) : String(f[j] == null ? '' : f[j]).trim();
          if (esCorreo ? (o.numero || o.asunto) : o.numero) filas.push(o);
        }
        return { tipo: esCorreo ? 'correo' : 'documentos', hoja: nh, filas, columnas: Object.entries(M).filter(([, j]) => j >= 0).map(([k, j]) => [k, String(a[i][j])]) };
      }
    }
    return { error: 'No reconocí «' + nombre + '» como un informe de Aconex: se buscan títulos como «Mail No.» / «Nº de correo», «Subject» / «Asunto», «Sent» / «Enviado» (correo) o «Document No.» / «Nº de documento», «Revision», «Title» (documentos).' };
  }
  async function importaExcel(p, luego) {
    const pid = p.id, inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let L; try { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'); L = leeLibro(XL, new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { return N.toast('No se pudo leer el archivo: ' + esc(e.message), 'mal'); }
      if (L.error) return N.toast(esc(L.error), 'mal');
      const nombres = { numero: 'número', asunto: 'asunto', tipo: 'tipo', para: 'para', de: 'de', org: 'organización', fecha: 'fecha', vence: 'respuesta requerida', respondido: 'respondido', estado: 'estado', motivo: 'motivo', referencia: 'referencia', contrato: 'contrato', revision: 'revisión', titulo: 'título', disciplina: 'disciplina', archivo: 'archivo' };
      const v = N.ventana('Importar Excel de Aconex', '<div class="acimp"><p><b>' + esc(f.name) + '</b> · hoja «' + esc(L.hoja) + '»: es un informe de <b>' + (L.tipo === 'correo' ? 'correo' : 'registro de documentos') + '</b> con <b>' + L.filas.length + '</b> fila(s).</p>' +
        '<div class="pista">Columnas reconocidas: ' + L.columnas.map(([k, t]) => '<span class="acchip">' + esc(nombres[k] || k) + ' ← «' + esc(t) + '»</span>').join(' ') + '</div>' +
        '<div class="acprev"><table><thead><tr>' + L.columnas.map(([k]) => '<th>' + esc(nombres[k] || k) + '</th>').join('') + '</tr></thead><tbody>' + L.filas.slice(0, 8).map(o => '<tr>' + L.columnas.map(([k]) => '<td>' + esc(FECHAS.has(k) ? fd(o[k]) : o[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
        '<p class="pista">Lo que ya está (mismo número) se actualiza; lo nuevo se agrega. No se borra nada.</p><div class="fila" style="justify-content:flex-end;gap:8px"><button id="aiNo">Cancelar</button><button class="primario" id="aiOk">Importar ' + L.filas.length + ' fila(s)</button></div></div>', { ancho: 860, alto: 520 });
      v.querySelector('#aiNo').onclick = () => cierraV(v);
      v.querySelector('#aiOk').onclick = async (ev) => { ev.target.disabled = true; try { const r = await api(A(pid) + '/importar', { json: { tipo: L.tipo, archivo: f.name, filas: L.filas } }); cierraV(v); N.toast(r.importados + ' fila(s) importadas de ' + esc(f.name) + '.', 'bien'); S.sub = L.tipo === 'correo' ? 'correo' : 'registro'; luego(); } catch (e) { ev.target.disabled = false; N.toast(esc(e.message), 'mal'); } };
    };
    inp.click();
  }
  const exporta = async (nombre, cab, filas) => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([cab].concat(filas)), 'Aconex'); XL.writeFile(wb, nombre); };
  const proyectosAcx = async () => { if (!S.proyectos) S.proyectos = await api('/api/aconex/proyectos'); return S.proyectos; };
  /** Ventana corta para elegir el proyecto de Aconex (para correo y registro). */
  async function eligeProyecto(titulo, boton, inicial, extra) {
    let L; try { L = await proyectosAcx(); } catch (e) { N.toast(esc(e.message), 'mal'); return null; }
    return new Promise(ok => {
      const v = N.ventana(titulo, '<label>Proyecto de Aconex</label><select id="apP">' + L.map(x => '<option value="' + esc(x.id) + '"' + (x.id === inicial ? ' selected' : '') + '>' + esc(x.nombre) + (x.corto ? ' · ' + esc(x.corto) : '') + '</option>').join('') + '</select>' + (extra || '') +
        '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:14px"><button id="apNo">Cancelar</button><button class="primario" id="apOk">' + esc(boton) + '</button></div>', { ancho: 520, alto: extra ? 300 : 230, alCerrar: () => ok(null) });
      v.querySelector('#apNo').onclick = () => { cierraV(v); ok(null); };
      v.querySelector('#apOk').onclick = () => { const s = v.querySelector('#apP'), x = L.find(y => y.id === s.value); const auto = v.querySelector('#apAuto'); cierraV(v); ok(x ? { acxProyecto: x.id, acxNombre: x.nombre, automatico: auto ? auto.checked : undefined } : null); };
    });
  }

  async function vista(p, d) {
    const pid = p.id; clearTimeout(reloj);
    const m = /[?&]aconex=([^&#]*)/.exec(location.search); let vuelta = '';
    if (m) { vuelta = decodeURIComponent(m[1]); history.replaceState(null, '', location.pathname + location.hash); }
    let est, L, nForma = 0;
    try { [est, L] = await Promise.all([api('/api/aconex/estado'), api(A(pid) + '/enlaces')]); nForma = N.formaConector ? (await api('/api/proyectos/' + pid + '/forma/enlaces').catch(() => ({ enlaces: [] }))).enlaces.length : 0; }
    catch (e) { app.innerHTML = N.marco(p, '/puente', '', '') + '<div class="aviso rojo">' + esc(e.message) + '</div>' + N.cierra(); return; }
    const t = (k, txt, n) => '<button data-t="' + k + '" class="' + (k === 'aconex' ? 'activa' : '') + '">' + txt + (n === '' ? '' : ' <span class="pista">' + n + '</span>') + '</button>';
    const conectado = est.configurado && est.conectado, puedo = L.puedoCrear && conectado;
    const cuenta = !est.configurado
      ? '<div class="fcx sin"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Falta registrar la aplicación de Oracle Aconex en este CDE.</b><div class="pista">Mientras tanto puedes cargar el correo y el registro de documentos con los <b>Excel que exporta Aconex</b>. <a href="#" id="acComo">Ver cómo se conecta por API</a></div></div></div>'
      : est.conectado
        ? '<div class="fcx ok"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Conectado con Aconex como ' + esc(est.cuenta.nombre || est.cuenta.usuario || 'tu cuenta') + '</b><div class="pista">' + esc(est.cuenta.usuario || '') + ' · desde ' + fecha(est.cuenta.desde) + ' · solo lectura: el CDE no envía ni modifica nada en Aconex' + (est.cuenta.venceRenovacion ? ' · si no se usa, la conexión vence el ' + fecha(est.cuenta.venceRenovacion) : '') + '</div>' + (est.cuenta.error ? '<div style="color:var(--rojo)">' + esc(est.cuenta.error) + '</div>' : '') + '</div><button id="acOtra">Reconectar</button><button id="acSalir">Desconectar</button></div>'
        : '<div class="fcx"><div class="fcxi">' + N.ICO.enlace + '</div><div class="crece"><b>Conecta tu cuenta de Aconex</b><div class="pista">El CDE lee Aconex con tus mismos permisos y solo en lectura. Entras con tu usuario de Oracle (Lobby de Construction and Engineering).</div></div><button class="primario" id="acConectar">Conectar con Aconex</button></div>' +
          '<div class="fcret" id="acDiag"><span class="pista">Comprobando la configuración con Oracle…</span></div>';
    const sub = (k, txt, n) => '<button class="acsub' + (S.sub === k ? ' activa' : '') + '" data-sub="' + k + '">' + txt + ' <span class="pista">' + n + '</span></button>';
    app.innerHTML = N.marco(p, '/puente', '', '') +
      '<div class="acctabs"><div class="tabs">' + t('salientes', 'Compartidas con otros proyectos', d.salientes.length) + t('entrantes', 'Recibidas de otros proyectos', d.entrantes.length) + (N.formaConector ? t('forma', 'Autodesk Forma', nForma) : '') + t('aconex', 'Oracle Aconex', L.enlaces.length + (L.cuentas.correos ? ' · ' + L.cuentas.correos : '')) + (N.tabsNube ? N.tabsNube('') : '') + '</div></div>' +
      (vuelta ? '<div class="aviso ' + (vuelta === 'conectado' ? 'verde' : 'rojo') + '" style="margin-top:12px">' + (vuelta === 'conectado' ? 'Cuenta de Aconex conectada. Ya puedes traer documentos y correo.' : esc(vuelta.replace(/^error:/, 'No se pudo conectar: '))) + '</div>' : '') +
      '<div style="margin-top:12px">' + cuenta + '</div>' +
      '<div class="acsubs">' + sub('documentos', 'Documentos', L.enlaces.length) + (L.puedoCorreo ? sub('correo', 'Correo', L.cuentas.correos) : '') + sub('registro', 'Registro de documentos', L.cuentas.registro) + '</div>' +
      '<div id="acCuerpo"></div>' + N.cierra();
    app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { clearTimeout(reloj); N.FPU = b.dataset.t; N.vistas.puente(pid); });
    app.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { S.sub = b.dataset.sub; vista(p, d); });
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    const conecta = () => { location.href = '/api/aconex/conectar?pid=' + encodeURIComponent(pid); };
    on('acConectar', conecta); on('acOtra', conecta);
    on('acSalir', async () => { if (!(await N.confirma('¿Desconectar la cuenta de Aconex?', 'Lo ya traído se queda en el CDE. Los enlaces automáticos dejarán de sincronizarse hasta que vuelvas a conectar.', 'Desconectar', true))) return; try { await api('/api/aconex/desconectar', { json: {} }); S.proyectos = null; vista(p, d); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    on('acComo', (e) => { e.preventDefault(); ayuda(est); });
    const diag = async () => { const el = document.getElementById('acDiag'); if (!el) return;
      let g; try { g = await api('/api/aconex/diagnostico'); } catch (e) { el.innerHTML = '<span class="pista">No se pudo comprobar: ' + esc(e.message) + '</span>'; return; }
      const linea = (okv, txt) => '<div class="fcdl ' + (okv === true ? 'si' : okv === false ? 'no' : '') + '"><i>' + (okv === true ? '✓' : okv === false ? '✗' : '·') + '</i><span>' + txt + '</span></div>';
      el.className = 'fcret' + (g.credenciales ? ' ok' : '');
      el.innerHTML = '<b>Configuración de Oracle Aconex en este CDE</b> <button class="mini" id="acRe">Volver a comprobar</button>' +
        linea(null, 'Aplicación de Oracle: Client ID terminado en <b class="mono">' + esc(g.app) + '</b> · Lobby ' + esc(g.lobby.replace(/^https?:\/\//, '')) + ' · API ' + esc(g.servidor.replace(/^https?:\/\//, '')) + '.') +
        linea(g.credenciales, g.credenciales ? 'Oracle reconoce la aplicación.' : esc(g.detalle || 'Oracle no reconoce el Client ID y el secreto.')) +
        linea(null, 'Dirección de retorno que debe estar registrada en la aplicación: <span class="mono">' + esc(g.retorno) + '</span> <button class="mini" id="acCop">Copiar</button>' + (g.detalle && g.credenciales ? '<br>' + esc(g.detalle) : ''));
      on('acRe', diag); on('acCop', () => navigator.clipboard.writeText(g.retorno).then(() => N.toast('Dirección copiada.', 'bien'), () => N.toast('No se pudo copiar: selecciónala y cópiala a mano.', 'mal'))); };
    if (est.configurado && !est.conectado) diag();
    const cuerpo = document.getElementById('acCuerpo'), recarga = () => vista(p, d);
    if (S.sub === 'correo' && L.puedoCorreo) return vistaCorreo(p, cuerpo, est, L, recarga);
    if (S.sub === 'registro') return vistaRegistro(p, cuerpo, est, L, recarga);
    vistaDocumentos(p, cuerpo, est, L, puedo, recarga);
  }

  function ayuda(est) {
    const v = N.ventana('Conectar el CDE con Oracle Aconex por API', '<ol class="obrayuda"><li><b>Aplicación OAuth en Oracle.</b> Quien administra Aconex en la organización registra en el Lobby de Oracle Construction and Engineering una aplicación de tipo <b>Web Server Application</b> (código de autorización) para la API de Aconex, con esta dirección de retorno: <span class="mono">' + esc(est.retorno) + '</span> <button class="mini" id="ahCop">Copiar</button></li>' +
      '<li><b>Credenciales en el CDE.</b> En el archivo <span class="mono">.env</span> de la carpeta del CDE (o en <span class="mono">cde.env</span>, si la instalación guarda ahí su configuración; se abre con el Bloc de notas) completa <span class="mono">ACONEX_CLIENT_ID</span> y <span class="mono">ACONEX_CLIENT_SECRET</span> (y <span class="mono">ACONEX_SERVIDOR</span> si la instancia no es api.aconex.com), guarda y reinicia con <span class="mono">4-reinicia.bat</span>. El secreto no se escribe en ninguna pantalla del CDE.</li>' +
      '<li><b>Cada usuario conecta su cuenta</b> con «Conectar con Aconex»: el CDE verá en Aconex lo mismo que esa persona.</li></ol>' +
      '<p class="pista">Sin la aplicación registrada puedes usar ya los <b>Excel que exporta Aconex</b>: Correo → Exportar (bandeja de entrada, enviados o todos) y Documentos → Registro → Exportar a Excel. Se cargan con «Importar Excel de Aconex».</p>', { ancho: 700, alto: 430 });
    const c = v.querySelector('#ahCop'); if (c) c.onclick = () => navigator.clipboard.writeText(est.retorno).then(() => N.toast('Dirección copiada.', 'bien'), () => N.toast('No se pudo copiar.', 'mal'));
  }

  // ───────── DOCUMENTOS
  function vistaDocumentos(p, el, est, L, puedo, recarga) {
    const pid = p.id;
    const barra = (e) => { const tr = e.trabajo; if (!tr || tr.estado !== 'corriendo') return ''; const pc = tr.total ? Math.round((tr.hechos || 0) / tr.total * 100) : 0;
      return '<div class="fcprog"><div class="fcbar"><i style="width:' + (tr.fase === 'leyendo' ? 8 : Math.max(8, pc)) + '%"></i></div><div class="pista">' + (tr.fase === 'leyendo' ? 'Leyendo el registro de Aconex…' : 'Trayendo ' + (tr.hechos || 0) + ' de ' + tr.total + ' · ' + tr.nuevos + ' nuevas' + (tr.pendientes ? ' · ' + tr.pendientes + ' sin nomenclatura' : '') + (tr.errores ? ' · ' + tr.errores + ' con error' : '')) + (tr.actual ? '<br>' + esc(tr.actual) : '') + '</div></div>'; };
    const fila = (e) => { const corre = e.trabajo && e.trabajo.estado === 'corriendo', mio = L.soyGestor || e.por === L.yo, r = e.resumen || {};
      return '<tr><td class="fccol"><b title="' + esc(e.acx_nombre) + '">' + esc(e.acx_nombre || 'Proyecto ' + e.acx_proyecto) + '</b><div class="pista">' + (e.filtro ? 'Filtro: <span class="mono">' + esc(e.filtro) + '</span>' : 'Todo el registro de documentos') + '</div></td>' +
        '<td>' + esc(e.carpeta_cde) + '<div class="pista">' + (e.versiones === 'todas' ? 'todas las revisiones' : 'solo la revisión vigente') + ' · nombre: ' + (e.nombrar === 'archivo' ? 'el del archivo' : 'Nº de documento') + '</div></td>' +
        '<td>' + (e.automatico ? '<span class="estado abierta">AUTOMÁTICA</span><div class="pista">cada ' + est.intervaloMin + ' min</div>' : '<span class="estado WIP">Automática según solicitud</span>') + '</td><td style="text-align:right"><b>' + e.documentos + '</b><div class="pista">' + e.traidos + ' revisión(es)</div></td>' +
        '<td>' + (corre ? barra(e) : (e.ultimo ? fecha(e.ultimo) + '<div class="pista">' + (r.nuevos || 0) + ' nuevas · ' + (r.sinCambios || 0) + ' sin cambios' + (r.detenido ? ' · detenida' : '') + '</div>' : '<span class="pista">—</span>') + (e.error ? '<div style="color:var(--rojo)">' + esc(e.error) + '</div>' : '') +
          (e.pendientes ? '<div class="fcpend"><b>' + e.pendientes + ' sin nomenclatura</b>' + (mio ? ' <button class="mini" data-nom="' + e.id + '">Completar nomenclatura</button>' : '') + '</div>' : '') + (e.conError ? '<div><a href="#" data-det="' + e.id + '" style="color:var(--rojo)">' + e.conError + ' con error</a></div>' : '')) + '</td>' +
        '<td><div class="fcacc">' + (corre ? (mio ? '<button class="mini" data-para="' + e.id + '">Detener</button>' : '') : (mio && est.conectado ? '<button class="mini primario" data-sinc="' + e.id + '">Sincronizar ahora</button>' : '')) + '<div><span title="Creado por ' + esc(e.por) + '">' + N.avatarMini(e.por) + '</span><button class="mini" data-det="' + e.id + '">Detalle</button>' + (mio ? '<button class="mini" data-mas="' + e.id + '" title="Más acciones">⋯</button>' : '') + '</div></div></td></tr>'; };
    el.innerHTML = '<div class="tarjeta" style="margin-top:12px"><div class="acbar">' + (puedo ? '<button class="primario" id="adNuevo">+ Traer documentos de Aconex</button>' : est.configurado ? '<span class="pista">Conecta tu cuenta de Aconex para traer documentos.</span>' : '<span class="pista">Traer los archivos de Aconex necesita la conexión por API. El registro y el correo se pueden cargar ya desde Excel.</span>') + '</div><div class="acctabla">' +
      (L.enlaces.length ? '<table><thead><tr><th>Registro de Aconex</th><th>Carpeta del CDE</th><th>Sincronización</th><th style="text-align:right">Documentos</th><th>Última sincronización</th><th></th></tr></thead><tbody>' + L.enlaces.map(fila).join('') + '</tbody></table>'
        : '<div class="intro-vacio">' + N.ICO.enlace + '<div><b>Aún no se ha traído nada de Aconex.</b><br>' + (est.conectado ? 'Pulsa «+ Traer documentos de Aconex», elige el proyecto (y si quieres, un filtro como <span class="mono">discipline:BM</span>) y la carpeta del CDE donde deben quedar.' : 'Primero conecta tu cuenta de Aconex.') + '</div></div>') +
      '<div class="accpie">Cada documento entra con su Nº de documento de Aconex; si la carpeta tiene norma y el número no la cumple, queda «sin nomenclatura» (sin descargarse) para completarlo en la rejilla. En Aconex no se modifica nada.</div></div></div>';
    const on = (i, fn) => { const x = document.getElementById(i); if (x) x.onclick = fn; };
    on('adNuevo', () => ventanaTraer(p, recarga));
    el.querySelectorAll('[data-sinc]').forEach(b => b.onclick = async () => { try { await api(A(pid) + '/enlaces/' + b.dataset.sinc + '/sincronizar', { json: {} }); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    el.querySelectorAll('[data-para]').forEach(b => b.onclick = async () => { try { await api(A(pid) + '/enlaces/' + b.dataset.para + '/detener', { json: {} }); N.toast('Se detendrá al terminar el documento en curso.', ''); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    el.querySelectorAll('[data-det]').forEach(b => b.onclick = (ev) => { ev.preventDefault(); ventanaDetalle(p, b.dataset.det, recarga); });
    el.querySelectorAll('[data-nom]').forEach(b => b.onclick = () => N.completaNomenclatura(p, A(pid) + '/enlaces/' + b.dataset.nom, recarga));
    el.querySelectorAll('[data-mas]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); const e = L.enlaces.find(x => x.id === b.dataset.mas), put = async (o) => { try { await api(A(pid) + '/enlaces/' + e.id, { method: 'PUT', json: o }); recarga(); } catch (x) { N.toast(esc(x.message), 'mal'); } };
      N.menuFlotante(b, [{ texto: e.automatico ? 'Pasar a automática según solicitud' : 'Sincronizar automáticamente (cada ' + est.intervaloMin + ' min)', accion: () => put({ automatico: !e.automatico }) },
        { texto: e.versiones === 'ultima' ? 'Traer todas las revisiones' : 'Traer solo la revisión vigente', accion: () => put({ versiones: e.versiones === 'ultima' ? 'todas' : 'ultima' }) },
        { texto: e.nombrar === 'archivo' ? 'Nombrar con el Nº de documento de Aconex' : 'Nombrar con el nombre del archivo', accion: () => put({ nombrar: e.nombrar === 'archivo' ? 'numero' : 'archivo' }) },
        { texto: 'Reintentar los que dieron error', off: e.conError ? false : 'No hay documentos con error', accion: async () => { try { await api(A(pid) + '/enlaces/' + e.id + '/sincronizar', { json: { reintentar: true } }); recarga(); } catch (x) { N.toast(esc(x.message), 'mal'); } } },
        { sep: true }, { texto: 'Quitar el enlace', peligro: true, accion: async () => { if (!(await N.confirma('¿Quitar el enlace?', 'Lo ya traído se queda en el CDE; solo deja de sincronizarse.', 'Quitar', true))) return; try { await api(A(pid) + '/enlaces/' + e.id, { method: 'DELETE' }); recarga(); } catch (x) { N.toast(esc(x.message), 'mal'); } } }]); });
    if (L.enlaces.some(e => e.trabajo && e.trabajo.estado === 'corriendo')) reloj = setTimeout(() => { if (/\/puente/.test(location.hash) && N.FPU === 'aconex' && S.sub === 'documentos' && !document.querySelector('.menuf')) recarga(); }, 2500);
  }
  async function ventanaTraer(p, luego) {
    const pid = p.id, v = N.ventana('Traer documentos de Oracle Aconex', '<div class="fctraer"><label>Proyecto de Aconex</label><select id="atP"><option value="">Cargando…</option></select>' +
      '<label style="margin-top:10px">Filtro (opcional, búsqueda de Aconex)</label><div class="fila" style="gap:8px"><input id="atF" class="crece mono" placeholder="p. ej. discipline:BM   ·   doctype:Plano   ·   docno:100017-*"><button id="atVer">Ver qué trae</button></div><div id="atPrev" class="acprev"></div>' +
      '<label style="margin-top:10px">Carpeta del CDE donde se cargará</label><div class="fila" style="gap:8px;align-items:center"><span class="mono crece" id="atDest"><span class="pista">Sin elegir</span></span><button id="atElige">Elegir carpeta…</button></div>' +
      '<div class="fcops"><label class="rvchk"><input type="radio" name="atV" value="ultima" checked> Solo la revisión vigente de cada documento</label><label class="rvchk"><input type="radio" name="atV" value="todas"> Todas las revisiones (cada una entra como versión)</label>' +
      '<label class="rvchk"><input type="radio" name="atN" value="numero" checked> Nombre en el CDE: Nº de documento de Aconex + extensión</label><label class="rvchk"><input type="radio" name="atN" value="archivo"> Nombre en el CDE: el del archivo</label>' +
      '<label class="rvchk"><input type="checkbox" id="atA"> Sincronizar automáticamente</label></div>' +
      '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><span class="pista crece" id="atSel"></span><button class="primario" id="atOk" disabled>Traer al CDE</button></div></div>', { ancho: 760, alto: 640 });
    const g = (i) => v.querySelector('#' + i), E = { destino: '' };
    const listo = () => { g('atOk').disabled = !(g('atP').value && E.destino); };
    try { const L = await proyectosAcx(); g('atP').innerHTML = '<option value="">Elige el proyecto…</option>' + L.map(x => '<option value="' + esc(x.id) + '">' + esc(x.nombre) + (x.corto ? ' · ' + esc(x.corto) : '') + '</option>').join(''); } catch (e) { g('atP').innerHTML = '<option value="">' + esc(e.message) + '</option>'; }
    g('atP').onchange = listo;
    g('atVer').onclick = async () => { if (!g('atP').value) return N.toast('Elige el proyecto de Aconex.', ''); g('atPrev').innerHTML = '<span class="pista">Consultando Aconex…</span>';
      try { const r = await api('/api/aconex/proyectos/' + encodeURIComponent(g('atP').value) + '/documentos?filtro=' + encodeURIComponent(g('atF').value.trim()));
        g('atPrev').innerHTML = '<div class="pista"><b>' + r.total + '</b> documento(s) coinciden' + (r.total > r.documentos.length ? ' (se muestran los primeros ' + r.documentos.length + ')' : '') + '.</div><table><thead><tr><th>Nº de documento</th><th>Rev.</th><th>Título</th><th>Archivo</th><th>Estado</th></tr></thead><tbody>' + r.documentos.map(x => '<tr><td class="mono">' + esc(x.numero) + '</td><td>' + esc(x.revision) + '</td><td>' + esc(x.titulo) + '</td><td>' + esc(x.archivo || '—') + (x.tamano ? ' <span class="pista">' + tam(x.tamano) + '</span>' : '') + '</td><td>' + esc(x.estado) + '</td></tr>').join('') + '</tbody></table>';
      } catch (e) { g('atPrev').innerHTML = '<span style="color:var(--rojo)">' + esc(e.message) + '</span>'; } };
    g('atElige').onclick = async () => { const r = await N.eligeDestino(p, { titulo: 'Carpeta del CDE donde se cargará', boton: 'Seleccionar', inicial: E.destino, permitida: (c) => c.subir, motivo: () => 'Sin permiso de carga' }); if (r !== null && r !== undefined && r !== '') { E.destino = r; g('atDest').textContent = r; listo(); } };
    g('atOk').onclick = async () => {
      const s = g('atP'), b = { acxProyecto: s.value, acxNombre: s.selectedOptions[0].textContent.replace(/ · [^·]*$/, ''), filtro: g('atF').value.trim(), carpetaCde: E.destino, versiones: v.querySelector('[name=atV]:checked').value, nombrar: v.querySelector('[name=atN]:checked').value, automatico: g('atA').checked };
      g('atOk').disabled = true; try { await api(A(pid) + '/enlaces', { json: b }); cierraV(v); N.toast('Trayendo documentos de Aconex a ' + esc(E.destino) + '…', 'bien'); luego(); } catch (e) { g('atOk').disabled = false; N.toast(esc(e.message), 'mal'); }
    };
  }
  async function ventanaDetalle(p, eid, luego) {
    const pid = p.id; let d; try { d = await api(A(pid) + '/enlaces/' + eid + '/items'); } catch (e) { return N.toast(esc(e.message), 'mal'); }
    const E = { traido: ['Traído', 'var(--verde)'], error: ['Error', 'var(--rojo)'], omitido: ['Omitido', 'var(--suave)'], nomenclatura: ['Sin nomenclatura', '#b54708'] }; let filtro = '';
    const n = (k) => d.items.filter(x => x.estado === k).length;
    const v = N.ventana('Detalle · ' + (d.enlace.acx_nombre || 'Aconex') + ' → ' + d.enlace.carpeta_cde, '<div class="fila" style="gap:6px;flex-wrap:wrap" id="adF"></div><div class="acctabla" style="margin-top:8px"><table><thead><tr><th>Nº de documento</th><th>Rev.</th><th>Título · nombre en el CDE</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id="adB"></tbody></table></div><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:8px"><button class="mini" id="adX">Exportar a Excel</button></div>', { ancho: 1000, alto: 600 });
    const pinta = () => {
      v.querySelector('#adF').innerHTML = [['', 'Todo', d.items.length], ['traido', 'Traídos', n('traido')], ['nomenclatura', 'Sin nomenclatura', n('nomenclatura')], ['error', 'Con error', n('error')], ['omitido', 'Omitidos', n('omitido')]].map(([k, t, c]) => '<button class="acsub' + (filtro === k ? ' activa' : '') + '" data-f="' + k + '">' + t + ' <span class="pista">' + c + '</span></button>').join('');
      v.querySelector('#adB').innerHTML = d.items.filter(x => !filtro || x.estado === filtro).map(x => '<tr><td class="mono">' + esc(x.item) + '</td><td>' + esc(x.revision) + '</td><td>' + esc(x.titulo) + (x.nombre_cde ? '<div class="pista mono">→ ' + esc(x.nombre_cde) + '</div>' : '') + '</td><td><b style="color:' + (E[x.estado] || ['', ''])[1] + '">' + (E[x.estado] || [x.estado])[0] + '</b>' + (x.n_cde ? '<div class="pista">versión ' + x.n_cde + ' en el CDE</div>' : '') + '</td><td class="pista">' + esc(x.detalle) + '</td></tr>').join('') || '<tr><td colspan="5" class="pista">Nada que mostrar.</td></tr>';
      v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; pinta(); });
    };
    pinta();
    if (n('nomenclatura')) { const bN = document.createElement('button'); bN.className = 'mini primario'; bN.textContent = 'Completar nomenclatura'; bN.onclick = () => { cierraV(v); N.completaNomenclatura(p, A(pid) + '/enlaces/' + eid, luego); }; v.querySelector('#adX').before(bN); }
    v.querySelector('#adX').onclick = () => exporta('aconex-detalle.xlsx', ['Nº de documento', 'Revisión', 'Título', 'Archivo en Aconex', 'Nombre en el CDE', 'Estado', 'Detalle', 'Fecha'], d.items.map(x => [x.item, x.revision, x.titulo, x.nombre, x.nombre_cde, (E[x.estado] || [x.estado])[0], x.detalle, x.fecha]));
  }

  // ───────── CORREO
  async function vistaCorreo(p, el, est, L, recarga) {
    const pid = p.id; let d; try { d = await api(A(pid) + '/correo'); } catch (e) { el.innerHTML = '<div class="aviso rojo">' + esc(e.message) + '</div>'; return; }
    const hoy = d.hoy, en7 = new Date(Date.parse(hoy) + 7 * 86400000).toISOString().slice(0, 10), C = S.correo;
    const cerrado = (c) => !!c.respondido || /cerr|closed|respond|atendid|complet/i.test(c.estado || '');
    const vencido = (c) => c.vence && c.vence < hoy && !cerrado(c), porVencer = (c) => c.vence && c.vence >= hoy && c.vence <= en7 && !cerrado(c);
    const pasa = (c) => (!C.filtro || (C.filtro === 'entrada' ? c.buzon === 'entrada' || c.buzon === 'ambos' : C.filtro === 'enviados' ? c.buzon === 'enviados' || c.buzon === 'ambos' : C.filtro === 'vencidos' ? vencido(c) : C.filtro === 'porvencer' ? porVencer(c) : true)) && (!C.tipo || (c.tipo || '(sin tipo)') === C.tipo) &&
      (!C.q || norm([c.numero, c.asunto, c.de, c.org, c.para, c.tipo, c.contrato].join(' ')).includes(norm(C.q)));
    const lista = d.correos.filter(pasa), tipos = new Map(); d.correos.filter(c => (!C.filtro || pasa(Object.assign({}, c, { tipo: C.tipo || c.tipo })))).forEach(c => { const k = c.tipo || '(sin tipo)'; tipos.set(k, (tipos.get(k) || 0) + 1); });
    const chip = (k, t, nn) => '<button class="acsub' + (C.filtro === k ? ' activa' : '') + '" data-cf="' + k + '">' + t + ' <span class="pista">' + nn + '</span></button>';
    const tiposOrd = [...tipos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), max = Math.max(1, ...tiposOrd.map(x => x[1]));
    const v = L.vinculo || {};
    el.innerHTML = '<div class="tarjeta" style="margin-top:12px"><div class="acbar">' + (est.conectado ? '<button class="primario" id="acTraer">' + (v.acx_proyecto ? 'Actualizar correo de Aconex' : 'Traer correo de Aconex') + '</button>' : '') + '<button id="acImp">Importar Excel de Aconex</button><button id="acExp"' + (lista.length ? '' : ' disabled') + '>Exportar a Excel</button><span class="crece"></span>' +
      (v.acx_proyecto ? '<span class="pista">' + esc(v.acx_nombre || v.acx_proyecto) + (v.correo_ultimo ? ' · actualizado ' + fecha(v.correo_ultimo) : '') + (v.automatico ? ' · se actualiza solo' : '') + '</span>' : '') + (L.soyGestor && d.correos.length ? '<button class="mini" id="acVaciar" title="Quitar del CDE todo el correo importado">Vaciar</button>' : '') + '</div>' +
      (d.correos.length ? '<div class="acgrid"><div><div class="acsubs" style="margin:0 0 8px">' + chip('', 'Todos', d.correos.length) + chip('entrada', 'Entrada', d.correos.filter(c => c.buzon !== 'enviados').length) + chip('enviados', 'Enviados', d.correos.filter(c => c.buzon === 'enviados' || c.buzon === 'ambos').length) + chip('vencidos', 'Respuesta vencida', d.correos.filter(vencido).length) + chip('porvencer', 'Vence en 7 días', d.correos.filter(porVencer).length) + '</div>' +
        '<input id="acQ" placeholder="Buscar por número, asunto, remitente, organización…" value="' + esc(C.q) + '" style="width:100%"></div>' +
        '<div class="acgraf"><div class="pista" style="margin-bottom:4px">Por tipo de correo (clic para filtrar)</div>' + tiposOrd.map(([k, nn]) => '<div class="acbarra' + (C.tipo === k ? ' activa' : '') + '" data-tipo="' + esc(k) + '" title="' + esc(k) + '"><span>' + esc(k) + '</span><i style="width:' + Math.round(100 * nn / max) + '%"></i><b>' + nn + '</b></div>').join('') + (C.tipo ? '<a href="#" id="acTodosT" class="pista">Quitar filtro de tipo</a>' : '') + '</div></div>' +
        '<div class="acctabla"><table><thead><tr><th>Nº de correo</th><th>Asunto · tipo</th><th>De</th><th>Enviado</th><th>Respuesta requerida</th><th>Estado</th></tr></thead><tbody>' +
        lista.slice(0, 1500).map(c => '<tr class="acfila" data-c="' + c.id + '"><td class="mono">' + esc(c.numero) + (c.buzon === 'enviados' ? ' <span class="acchip">enviado</span>' : '') + '</td><td><b>' + esc(c.asunto) + '</b>' + (c.adjuntos ? ' <span class="pista" title="Adjuntos">📎' + c.adjuntos + '</span>' : '') + '<div class="pista">' + esc([c.tipo, c.contrato].filter(Boolean).join(' · ')) + '</div></td><td>' + esc(c.de) + '<div class="pista">' + esc(c.org) + '</div></td><td>' + fd(c.fecha) + '</td>' +
          '<td>' + (c.vence ? '<span class="acvence ' + (vencido(c) ? 'mal' : porVencer(c) ? 'pronto' : cerrado(c) ? 'ok' : '') + '">' + fd(c.vence) + '</span>' : '<span class="pista">—</span>') + (c.respondido ? '<div class="pista">respondido ' + fd(c.respondido) + '</div>' : '') + '</td><td>' + esc(c.estado) + '</td></tr>').join('') + '</tbody></table>' +
        (lista.length > 1500 ? '<div class="pista" style="padding:8px">Se muestran 1500 de ' + lista.length + ': usa la búsqueda o exporta a Excel.</div>' : '') + '</div><div class="accpie">Mostrando ' + Math.min(lista.length, 1500) + ' de ' + d.correos.length + ' correo(s). Solo lectura: en Aconex no se envía ni se marca nada.</div>'
        : '<div class="intro-vacio">' + N.ICO.enlace + '<div><b>Aún no hay correo de Aconex en este proyecto.</b><br>' + (est.conectado ? 'Pulsa «Traer correo de Aconex» y elige el proyecto, o ' : '') + 'carga el Excel que exporta Aconex (Correo → Exportar) con «Importar Excel de Aconex».</div></div>') + '</div>';
    const on = (i, fn) => { const x = document.getElementById(i); if (x) x.onclick = fn; };
    on('acTraer', async () => { const r = await eligeProyecto('Traer correo de Aconex', 'Traer correo', v.acx_proyecto, '<label class="rvchk" style="margin-top:10px"><input type="checkbox" id="apAuto"' + (v.automatico ? ' checked' : '') + '> Actualizar solo cada ' + est.intervaloMin + ' min</label>'); if (!r) return;
      N.toast('Leyendo el correo de Aconex…', ''); try { const x = await api(A(pid) + '/correo/traer', { json: r }); N.toast(x.entrada + ' correo(s) de entrada y ' + x.enviados + ' enviados leídos de Aconex.', 'bien'); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    on('acImp', () => importaExcel(p, recarga));
    on('acExp', () => exporta('correo-aconex.xlsx', ['Nº de correo', 'Bandeja', 'Asunto', 'Tipo', 'De', 'Organización', 'Para', 'Enviado', 'Respuesta requerida', 'Respondido', 'Estado', 'Motivo', 'Referencia', 'Contrato', 'Adjuntos'], lista.map(c => [c.numero, c.buzon, c.asunto, c.tipo, c.de, c.org, c.para, c.fecha, c.vence, c.respondido, c.estado, c.motivo, c.referencia, c.contrato, c.adjuntos])));
    on('acVaciar', async () => { if (!(await N.confirma('¿Vaciar el correo de Aconex del CDE?', 'Se quita del CDE todo el correo traído o importado. En Aconex no cambia nada y se puede volver a traer.', 'Vaciar', true))) return; try { await api(A(pid) + '/correo', { method: 'DELETE' }); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    on('acTodosT', (e) => { e.preventDefault(); C.tipo = ''; vistaCorreo(p, el, est, L, recarga); });
    el.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { C.filtro = b.dataset.cf; vistaCorreo(p, el, est, L, recarga); });
    el.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { C.tipo = C.tipo === b.dataset.tipo ? '' : b.dataset.tipo; vistaCorreo(p, el, est, L, recarga); });
    const q = document.getElementById('acQ'); if (q) { let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { C.q = q.value; vistaCorreo(p, el, est, L, recarga).then(() => { const q2 = document.getElementById('acQ'); if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); } }); }, 250); }; }
    el.querySelectorAll('[data-c]').forEach(tr => tr.onclick = () => abreCorreo(p, +tr.dataset.c));
  }
  async function abreCorreo(p, cid) {
    const v = N.ventana('Correo de Aconex', '<div class="pista" style="padding:12px">Leyendo…</div>', { ancho: 780, alto: 560 });
    let c; try { c = await api(A(p.id) + '/correo/' + cid); } catch (e) { v.innerHTML = '<div class="aviso rojo">' + esc(e.message) + '</div>'; return; }
    const w = v.closest('.ventana'); if (w) w.querySelector('.vcab b').textContent = c.numero + ' · ' + c.asunto;
    const dato = (k, t) => t ? '<div class="acdato"><span>' + k + '</span><div>' + t + '</div></div>' : '';
    v.innerHTML = '<div class="accorreo">' + dato('Nº de correo', '<span class="mono">' + esc(c.numero) + '</span>') + dato('Asunto', '<b>' + esc(c.asunto) + '</b>') + dato('Tipo', esc(c.tipo)) + dato('De', esc(c.de) + (c.org ? ' · ' + esc(c.org) : '')) + dato('Para', esc(c.para)) +
      dato('Enviado', fd(c.fecha)) + dato('Respuesta requerida', fd(c.vence)) + dato('Respondido', fd(c.respondido)) + dato('Estado', esc(c.estado)) + dato('Motivo', esc(c.motivo)) + dato('Referencia', esc(c.referencia)) + dato('Contrato', esc(c.contrato)) +
      dato('Adjuntos', (c.anexos || []).length ? c.anexos.map(a => esc(a.nombre) + (a.tam ? ' <span class="pista">' + tam(a.tam) + '</span>' : '')).join('<br>') + '<div class="pista">Se descargan desde Aconex.</div>' : (c.adjuntos ? c.adjuntos + ' (se ven en Aconex)' : '')) +
      '<div class="accuerpo">' + (c.cuerpo ? esc(c.cuerpo).replace(/\n/g, '<br>') : '<span class="pista">' + (c.aviso ? esc(c.aviso) : c.origen === 'excel' ? 'El Excel de Aconex no trae el texto del correo. Con la cuenta conectada y el correo traído por API, el texto se lee al abrirlo.' : 'Sin texto.') + '</span>') + '</div>' +
      '<div class="pista" style="margin-top:8px">' + (c.origen === 'api' ? 'Traído de Aconex por API' : 'Importado de un Excel de Aconex') + ' · ' + fecha(c.importado) + '</div></div>';
  }

  // ───────── REGISTRO DE DOCUMENTOS (cruzado con el CDE)
  async function vistaRegistro(p, el, est, L, recarga) {
    const pid = p.id; let d; try { d = await api(A(pid) + '/registro'); } catch (e) { el.innerHTML = '<div class="aviso rojo">' + esc(e.message) + '</div>'; return; }
    const R = S.registro, pasa = (r) => (!R.filtro || (R.filtro === 'en' ? !!r.enCde : !r.enCde)) && (!R.q || norm([r.numero, r.titulo, r.tipo, r.estado, r.disciplina, r.archivo].join(' ')).includes(norm(R.q)));
    const lista = d.registro.filter(pasa), v = L.vinculo || {}, falta = d.registro.length - d.enCde;
    const chip = (k, t, nn) => '<button class="acsub' + (R.filtro === k ? ' activa' : '') + '" data-rf="' + k + '">' + t + ' <span class="pista">' + nn + '</span></button>';
    const pc = d.registro.length ? Math.round(100 * d.enCde / d.registro.length) : 0;
    el.innerHTML = '<div class="tarjeta" style="margin-top:12px"><div class="acbar">' + (est.conectado ? '<button class="primario" id="arLeer">' + (v.registro_ultimo ? 'Actualizar registro de Aconex' : 'Leer registro de Aconex') + '</button>' : '') + '<button id="arImp">Importar Excel de Aconex</button><button id="arExp"' + (lista.length ? '' : ' disabled') + '>Exportar a Excel</button><span class="crece"></span>' +
      (v.registro_ultimo ? '<span class="pista">' + esc(v.acx_nombre || '') + ' · leído ' + fecha(v.registro_ultimo) + '</span>' : '') + (L.soyGestor && d.registro.length ? '<button class="mini" id="arVaciar">Vaciar</button>' : '') + '</div>' +
      (d.registro.length ? '<div class="acavance"><div class="acbig"><b>' + pc + '%</b><span class="pista">del registro de Aconex está en el CDE</span></div><div class="fcbar crece" style="height:10px"><i style="width:' + pc + '%"></i></div></div>' +
        '<div class="fila" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' + chip('', 'Todos', d.registro.length) + chip('en', 'En el CDE', d.enCde) + chip('falta', 'Faltan en el CDE', falta) + '<input id="arQ" class="crece" placeholder="Buscar por número, título, tipo, disciplina…" value="' + esc(R.q) + '"></div>' +
        '<div class="acctabla"><table><thead><tr><th>Nº de documento</th><th>Rev.</th><th>Título</th><th>Tipo</th><th>Estado</th><th>Disciplina</th><th>Fecha</th><th>En el CDE</th></tr></thead><tbody>' +
        lista.slice(0, 2000).map(r => '<tr><td class="mono">' + esc(r.numero) + '</td><td>' + esc(r.revision) + '</td><td>' + esc(r.titulo) + '</td><td>' + esc(r.tipo) + '</td><td>' + esc(r.estado) + '</td><td>' + esc(r.disciplina) + '</td><td>' + fd(r.fecha) + '</td><td>' + (r.enCde ? '<a href="#/p/' + pid + '/c/' + r.enCde.id + '" class="acen" title="Abrir el documento en el CDE">✓ ' + esc(r.enCde.carpeta) + '</a><div class="pista">' + esc(r.enCde.estado) + ' · v' + r.enCde.version + '</div>' : '<span class="acfalta">Falta</span>') + '</td></tr>').join('') + '</tbody></table>' +
        (lista.length > 2000 ? '<div class="pista" style="padding:8px">Se muestran 2000 de ' + lista.length + ': usa la búsqueda o exporta a Excel.</div>' : '') + '</div><div class="accpie">Un documento cuenta como «en el CDE» si existe un documento con el mismo Nº (o el mismo nombre de archivo), o si lo trajo el conector con otro nombre.</div>'
        : '<div class="intro-vacio">' + N.ICO.enlace + '<div><b>Aún no hay registro de documentos de Aconex.</b><br>' + (est.conectado ? 'Pulsa «Leer registro de Aconex», o ' : '') + 'carga el Excel del registro (Documentos → Registro → Exportar a Excel) con «Importar Excel de Aconex» para ver qué documentos faltan en el CDE.</div></div>') + '</div>';
    const on = (i, fn) => { const x = document.getElementById(i); if (x) x.onclick = fn; };
    on('arLeer', async () => { const r = await eligeProyecto('Leer el registro de documentos de Aconex', 'Leer registro', v.acx_proyecto); if (!r) return; N.toast('Leyendo el registro de Aconex…', ''); try { const x = await api(A(pid) + '/registro/leer', { json: r }); N.toast(x.documentos + ' documento(s) leídos del registro de Aconex.', 'bien'); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    on('arImp', () => importaExcel(p, recarga));
    on('arExp', () => exporta('registro-aconex-vs-cde.xlsx', ['Nº de documento', 'Revisión', 'Título', 'Tipo', 'Estado', 'Disciplina', 'Fecha', 'Archivo', 'En el CDE', 'Carpeta del CDE', 'Estado en el CDE'], lista.map(r => [r.numero, r.revision, r.titulo, r.tipo, r.estado, r.disciplina, r.fecha, r.archivo, r.enCde ? 'Sí' : 'No', r.enCde ? r.enCde.carpeta : '', r.enCde ? r.enCde.estado : ''])));
    on('arVaciar', async () => { if (!(await N.confirma('¿Vaciar el registro de Aconex del CDE?', 'Se quita la copia del registro (no los documentos del CDE). Se puede volver a leer o importar.', 'Vaciar', true))) return; try { await api(A(pid) + '/registro', { method: 'DELETE' }); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    el.querySelectorAll('[data-rf]').forEach(b => b.onclick = () => { R.filtro = b.dataset.rf; vistaRegistro(p, el, est, L, recarga); });
    const q = document.getElementById('arQ'); if (q) { let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { R.q = q.value; vistaRegistro(p, el, est, L, recarga).then(() => { const q2 = document.getElementById('arQ'); if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); } }); }, 250); }; }
  }

  N.aconexConector = { vista, leeLibro };
})();
