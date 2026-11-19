/* SEGUIMIENTO DE OBRA, segunda parte: especificaciones, consultas (RFI), órdenes de cambio, recorrido 360 por visita,
 * dibujo y medición sobre el plano, calendario y Gantt de tareas, código QR y planos desde la nube.
 * Usa lo que publica obra.js en N.OBX (rutas, estados, cabecera, ventana de tarea, PDF y miniaturas). */
(function () {
  const N = CDE.N, { esc, api, fecha, tam, dia, aviso, app } = N;
  const X = N.OBX = N.OBX || {};
  const O = (pid) => '/api/proyectos/' + pid + '/obra';
  const corto = (e) => String(e || '').split('@')[0];
  const hoy = () => new Date().toISOString().slice(0, 10);
  const plata = (v, m) => (m || 'S/') + ' ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cierraV = (v) => { const w = v.closest('.ventana'); if (w) w.remove(); };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const aDia = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const diasEntre = (a, b) => Math.round((b - a) / 864e5);

  // ═════════ VISOR 360: una esfera con la foto equirectangular por dentro ═════════
  const VISORES = new Set();
  X.limpia = () => { VISORES.forEach(v => { if (!v.cont.closest('.ventana') || !document.body.contains(v.cont)) v.dispone(); }); };
  X.registra = () => {};
  let TRES = null;
  const tres = () => TRES || (TRES = import('../../vendor/three.module.js'));
  /** Monta el visor en `cont`. Devuelve { fija(yaw, pitch, fov), mira(), carga(url), dispone() }. `alMover` avisa de cada giro. */
  X.visor360 = async function (cont, url, op) {
    op = op || {};
    const T = await tres();
    cont.innerHTML = ''; cont.classList.add('ob360v');
    let rend;
    try { rend = new T.WebGLRenderer({ antialias: true }); } catch (e) { cont.innerHTML = '<img src="' + url + '" alt="" style="max-width:100%;max-height:100%"><div class="ob360nota">Este equipo no puede mostrar la vista 360; se muestra la foto extendida.</div>'; throw e; }
    rend.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const esc3 = new T.Scene(), cam = new T.PerspectiveCamera(75, 1, 0.1, 1100), geo = new T.SphereGeometry(500, 64, 40); geo.scale(-1, 1, 1);
    const mat = new T.MeshBasicMaterial({ color: 0x222222 }), malla = new T.Mesh(geo, mat); esc3.add(malla);
    cont.appendChild(rend.domElement);
    const nota = document.createElement('div'); nota.className = 'ob360nota'; nota.textContent = 'Cargando la toma…'; cont.appendChild(nota);
    const S = { yaw: op.yaw || 0, pitch: op.pitch || 0, fov: op.fov || 75, vivo: true, sucio: true };
    const pinta = () => {
      if (!S.vivo) return; if (!document.body.contains(cont)) return V.dispone();
      S.sucio = false; const w = cont.clientWidth || 2, h = cont.clientHeight || 2;
      if (rend.domElement.width !== Math.round(w * rend.getPixelRatio()) || rend.domElement.height !== Math.round(h * rend.getPixelRatio())) { rend.setSize(w, h, false); cam.aspect = w / h; }
      cam.fov = S.fov; cam.updateProjectionMatrix();
      const phi = T.MathUtils.degToRad(90 - S.pitch), th = T.MathUtils.degToRad(S.yaw);
      cam.lookAt(500 * Math.sin(phi) * Math.cos(th), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(th)); rend.render(esc3, cam);
    };
    const pide = () => { if (!S.sucio && S.vivo) { S.sucio = true; requestAnimationFrame(pinta); } };
    const carga = (u) => new Promise((ok) => { nota.style.display = ''; nota.textContent = 'Cargando la toma…'; new T.TextureLoader().load(u, (tx) => { if (!S.vivo) return tx.dispose(); tx.colorSpace = T.SRGBColorSpace; if (mat.map) mat.map.dispose(); mat.map = tx; mat.color.set(0xffffff); mat.needsUpdate = true; nota.style.display = 'none'; S.sucio = false; pide(); ok(true); }, undefined, () => { nota.textContent = 'No se pudo abrir la toma.'; ok(false); }); });
    let arr = null;
    const el = rend.domElement; el.style.touchAction = 'none'; el.style.cursor = 'grab';
    el.onpointerdown = (e) => { arr = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch }; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
    el.onpointermove = (e) => { if (!arr) return; const k = S.fov / (cont.clientHeight || 400); S.yaw = arr.yaw - (e.clientX - arr.x) * k; S.pitch = Math.max(-85, Math.min(85, arr.pitch + (e.clientY - arr.y) * k)); pide(); if (op.alMover) op.alMover(V.mira()); };
    el.onpointerup = el.onpointercancel = () => { arr = null; el.style.cursor = 'grab'; };
    el.addEventListener('wheel', (e) => { e.preventDefault(); S.fov = Math.max(25, Math.min(100, S.fov + (e.deltaY > 0 ? 4 : -4))); pide(); if (op.alMover) op.alMover(V.mira()); }, { passive: false });
    const ro = new ResizeObserver(() => { S.sucio = false; pide(); }); ro.observe(cont);
    const V = { cont, mira: () => ({ yaw: S.yaw, pitch: S.pitch, fov: S.fov }), fija: (y, p, f) => { S.yaw = y; S.pitch = p; if (f) S.fov = f; pide(); }, carga,
      dispone: () => { if (!S.vivo) return; S.vivo = false; VISORES.delete(V); ro.disconnect(); if (mat.map) mat.map.dispose(); mat.dispose(); geo.dispose(); rend.dispose(); try { rend.forceContextLoss(); } catch (e) {} if (el.parentNode) el.parentNode.removeChild(el); } };
    VISORES.add(V); S.sucio = false; pide(); await carga(url); return V;
  };

  /** Foto corriente (no esférica: una vista aérea de dron, por ejemplo) con la misma interfaz que el visor 360: rueda para acercar, arrastre para mover. */
  X.visorPlano = async function (cont, url) {
    cont.innerHTML = ''; cont.classList.add('ob360v', 'obplana'); const im = document.createElement('img'); im.alt = ''; im.draggable = false; cont.appendChild(im);
    const S = { z: 1, x: 0, y: 0 }, pon = () => { im.style.transform = 'translate(' + S.x + 'px,' + S.y + 'px) scale(' + S.z + ')'; };
    cont.onwheel = (e) => { e.preventDefault(); S.z = Math.max(1, Math.min(8, S.z * (e.deltaY > 0 ? 0.88 : 1.14))); if (S.z === 1) { S.x = 0; S.y = 0; } pon(); };
    let a = null; im.style.cursor = 'grab'; im.onpointerdown = (e) => { a = { x: e.clientX - S.x, y: e.clientY - S.y }; im.setPointerCapture(e.pointerId); };
    im.onpointermove = (e) => { if (!a) return; S.x = e.clientX - a.x; S.y = e.clientY - a.y; pon(); }; im.onpointerup = im.onpointercancel = () => { a = null; };
    const carga = (u) => new Promise((ok) => { S.z = 1; S.x = 0; S.y = 0; pon(); im.onload = () => ok(true); im.onerror = () => ok(false); im.src = u; });
    const V = { cont, plano: true, mira: () => ({ yaw: 0, pitch: 0, fov: 75 }), fija: () => {}, carga, dispone: () => { cont.onwheel = null; cont.classList.remove('obplana'); cont.innerHTML = ''; } };
    await carga(url); return V;
  };
  /** El visor que corresponde a la toma: esfera si es 360, foto extendida si no. */
  X.visorToma = (cont, pid, t, op) => (t.es360 === 0 ? X.visorPlano : X.visor360)(cont, X.urlFoto(pid, t.foto_id), op || {});

  // ═════════ CÓDIGO QR de una tarea, consulta u orden ═════════
  X.qr = async function (url, titulo, sub) {
    await N.carga('vendor/qrcode.js', 'qrcode');
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), m = 4, px = 10, lado = (n + m * 2) * px, c = document.createElement('canvas'); c.width = c.height = lado;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, lado, lado); g.fillStyle = '#000';
    for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (q.isDark(f, k)) g.fillRect((k + m) * px, (f + m) * px, px, px);
    const png = c.toDataURL('image/png');
    const v = N.ventana('Código QR', '<div class="obqr"><img src="' + png + '" alt="Código QR" id="qrImg"><div><b>' + esc(titulo) + '</b><div class="pista">' + esc(sub || '') + '</div><div class="pista mono" style="word-break:break-all;margin-top:8px">' + esc(url) + '</div>' +
      '<p class="pista">Pega el código en el sitio de obra: al leerlo con el teléfono se abre este registro en el CDE (hay que tener sesión y acceso al proyecto).</p>' +
      '<div class="fila" style="gap:8px"><a class="boton primario" id="qrDes" download="' + esc(titulo.replace(/[^\w\-. áéíóúñÁÉÍÓÚÑ]+/g, ' ').trim().replace(/\s+/g, '-')) + '-QR.png" href="' + png + '">Descargar PNG</a><button id="qrImp">Imprimir etiqueta</button></div></div></div>', { ancho: 620, alto: 400 });
    v.querySelector('#qrImp').onclick = () => { const w = window.open('', '_blank', 'width=520,height=640'); if (!w) return N.toast('El navegador bloqueó la ventana de impresión.', 'mal');
      w.document.write('<title>' + esc(titulo) + '</title><body style="font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:24px"><img src="' + png + '" style="width:300px;height:300px"><h2 style="margin:10px 0 2px;font-weight:600">' + esc(titulo) + '</h2><div style="color:#555">' + esc(sub || '') + '</div><div style="font:11px Consolas,monospace;color:#777;margin-top:10px;word-break:break-all">' + esc(url) + '</div></body>'); w.document.close(); w.onload = () => w.print(); setTimeout(() => { try { w.print(); } catch (e) {} }, 400); };
  };

  // ═════════ CALENDARIO Y GANTT de tareas (se pintan dentro de la vista de tareas) ═════════
  const rango = (t) => { const a = aDia(t.inicio), b = aDia(t.fin); return a && b ? (a <= b ? [a, b] : [b, a]) : a ? [a, a] : b ? [b, b] : null; };
  X.calendario = function (L, OB) {
    const E = X.EST, mes = /^\d{4}-\d{2}$/.test(OB.mes || '') ? OB.mes : hoy().slice(0, 7), y = +mes.slice(0, 4), m = +mes.slice(5) - 1;
    const uno = new Date(y, m, 1), ini = new Date(y, m, 1 - ((uno.getDay() + 6) % 7)), mueve = (k) => iso(new Date(y, m + k, 1)).slice(0, 7), hoyS = hoy();
    const con = L.map(t => ({ t, r: rango(t) })).filter(x => x.r), sin = L.filter(t => !rango(t));
    let celdas = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i), s = iso(d); if (i >= 35 && d.getMonth() !== m && i % 7 === 0) break;
      const del = con.filter(x => x.r[0] <= d && d <= x.r[1]);
      celdas += '<div class="obcdia' + (d.getMonth() !== m ? ' fuera' : '') + (s === hoyS ? ' hoy' : '') + '"><div class="obcnum">' + d.getDate() + '</div>' +
        del.slice(0, 4).map(x => '<div class="obcev' + (iso(x.r[0]) === s ? ' cini' : '') + (iso(x.r[1]) === s ? ' cfin' : '') + '" data-t="' + x.t.id + '" style="--c:' + (E[x.t.estado] || E.p2).color + '" title="#' + x.t.numero + ' ' + esc(x.t.titulo || 'Sin título') + ' · ' + esc(x.t.inicio || '') + (x.t.fin && x.t.fin !== x.t.inicio ? ' → ' + esc(x.t.fin) : '') + '">#' + x.t.numero + ' ' + esc(x.t.titulo || 'Sin título') + '</div>').join('') +
        (del.length > 4 ? '<div class="pista obcmas">+' + (del.length - 4) + ' más</div>' : '') + '</div>';
    }
    return '<div class="obcal"><div class="obcalcab"><button class="mini" data-mes="' + mueve(-1) + '" title="Mes anterior">‹</button><b>' + MESES[m] + ' de ' + y + '</b><button class="mini" data-mes="' + mueve(1) + '" title="Mes siguiente">›</button><button class="mini" data-mes="' + hoyS.slice(0, 7) + '">Hoy</button><span class="crece"></span><span class="pista">' + con.length + ' tarea(s) con fecha · se muestran entre su fecha de inicio y de finalización</span></div>' +
      '<div class="obcsem">' + ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(d => '<div>' + d + '</div>').join('') + '</div><div class="obcgrid">' + celdas + '</div>' +
      (sin.length ? '<details class="obcsin"><summary>' + sin.length + ' tarea(s) sin fecha</summary><div class="obchips" style="margin-top:8px">' + sin.map(t => '<span class="obrel clic" data-t="' + t.id + '">' + X.punto(t.estado) + ' #' + t.numero + ' ' + esc(t.titulo || 'Sin título') + '</span>').join('') + '</div></details>' : '') + '</div>';
  };
  X.gantt = function (L, OB) {
    const E = X.EST, con = L.map(t => ({ t, r: rango(t) })).filter(x => x.r).sort((a, b) => a.r[0] - b.r[0] || a.t.numero - b.t.numero), sin = L.filter(t => !rango(t));
    if (!con.length) return '<div class="tarjeta"><div class="pista" style="padding:24px">Ninguna tarea tiene fecha de inicio o de finalización. Ponlas en «Atributos de tarea» y aparecerán aquí como barras.</div></div>';
    const hoyD = aDia(hoy()); let a = new Date(Math.min.apply(null, con.map(x => +x.r[0]).concat([+hoyD]))), b = new Date(Math.max.apply(null, con.map(x => +x.r[1]).concat([+hoyD])));
    a = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 3); b = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 7);
    const dias = diasEntre(a, b) + 1, W = dias > 240 ? 6 : dias > 120 ? 10 : dias > 60 ? 16 : 26, ancho = dias * W;
    let meses = '', diasH = '', fondo = '';
    for (let i = 0; i < dias;) { const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0), n = Math.min(dias - i, fin.getDate() - d.getDate() + 1); meses += '<div style="left:' + (i * W) + 'px;width:' + (n * W) + 'px">' + (n * W > 60 ? MESES[d.getMonth()] + ' ' + d.getFullYear() : MESES[d.getMonth()].slice(0, 3)) + '</div>'; i += n; }
    for (let i = 0; i < dias; i++) { const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i), fs = d.getDay() === 0 || d.getDay() === 6;
      if (W >= 16 || d.getDay() === 1) diasH += '<div style="left:' + (i * W) + 'px;width:' + (W >= 16 ? W : W * 7) + 'px">' + d.getDate() + '</div>';
      if (fs) fondo += '<i style="left:' + (i * W) + 'px;width:' + W + 'px"></i>'; }
    const xh = diasEntre(a, hoyD) * W + W / 2;
    const filas = con.map(x => { const x0 = diasEntre(a, x.r[0]) * W, w = (diasEntre(x.r[0], x.r[1]) + 1) * W, hito = !(x.t.inicio && x.t.fin), c = (E[x.t.estado] || E.p2).color, hechos = x.t.checklist.length ? x.t.checklist.filter(k => k.hecho).length / x.t.checklist.length : (/^p\d$/.test(x.t.estado) ? 0 : 1);
      return '<div class="obgfila" data-t="' + x.t.id + '"><div class="obgnom" title="' + esc(x.t.titulo || 'Sin título') + '">' + X.punto(x.t.estado, x.t.numero) + '<span>' + esc(x.t.titulo || 'Sin título') + '</span><i>' + esc(corto(x.t.responsable)) + '</i></div><div class="obgbar" style="width:' + ancho + 'px">' +
        (hito ? '<b class="obghito" style="left:' + (x0 + W / 2) + 'px;--c:' + c + '" title="' + esc((x.t.inicio ? 'Inicio ' : 'Fin ') + (x.t.inicio || x.t.fin)) + '"></b>' : '<b class="obgbarra" style="left:' + x0 + 'px;width:' + w + 'px;--c:' + c + '" title="' + esc(x.t.inicio + ' → ' + x.t.fin + ' · ' + (diasEntre(x.r[0], x.r[1]) + 1) + ' día(s)') + '"><u style="width:' + Math.round(hechos * 100) + '%"></u></b>') + '</div></div>'; }).join('');
    return '<div class="obgantt"><div class="obgcab"><div class="obgnom"><b>Tarea</b></div><div class="obgbar obgesc" style="width:' + ancho + 'px"><div class="obgmes">' + meses + '</div><div class="obgdia">' + diasH + '</div></div></div>' +
      '<div class="obgcuerpo"><div class="obgfondo" style="left:var(--gnom);width:' + ancho + 'px">' + fondo + '<s style="left:' + xh + 'px" title="Hoy"></s></div>' + filas + '</div></div>' +
      '<div class="pista" style="margin-top:8px">La barra va de la fecha de inicio a la de finalización; el relleno oscuro es el avance del checklist. Un rombo es una tarea con una sola fecha.' + (sin.length ? ' ' + sin.length + ' tarea(s) sin fecha no aparecen.' : '') + '</div>';
  };

  // ═════════ ÍNDICE del PDF: secciones (marcadores), ir a página y búsqueda de texto ═════════
  X.indice = async function (doc, cont, ir, esp) {
    if (!cont) return; let arbol = []; try { arbol = (await doc.getOutline()) || []; } catch (e) {}
    if (!arbol.length && !esp && doc.numPages < 2) return;
    const planos = []; (function baja(L, niv) { L.forEach(x => { planos.push({ titulo: x.title, dest: x.dest, niv }); if (x.items && x.items.length && niv < 2) baja(x.items, niv + 1); }); })(arbol, 0);
    const pagDe = async (dest) => { try { const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest; if (!d) return null; return typeof d[0] === 'object' ? (await doc.getPageIndex(d[0])) + 1 : d[0] + 1; } catch (e) { return null; } };
    cont.innerHTML = '<div class="obind"><div class="fila" style="align-items:center;gap:6px"><h2 style="margin:0;flex:1">' + (esp ? 'Secciones' : 'Hojas') + '</h2><input id="oiPag" type="number" min="1" max="' + doc.numPages + '" placeholder="pág." title="Ir a la página" style="width:70px"></div>' +
      (planos.length ? '<div class="obindl">' + planos.slice(0, 400).map((x, i) => '<a href="#" data-i="' + i + '" style="padding-left:' + (6 + x.niv * 14) + 'px">' + esc(x.titulo) + '</a>').join('') + '</div>' : (esp ? '<div class="pista" style="margin:6px 0">Este PDF no trae marcadores de sección. Usa la búsqueda o el número de página.</div>' : '')) +
      '<div class="fila" style="gap:6px;margin-top:8px"><input id="oiQ" placeholder="Buscar texto en el documento" style="flex:1"><button class="mini" id="oiB">Buscar</button></div><div id="oiRes" class="obindl"></div></div>';
    cont.querySelector('#oiPag').onchange = (e) => { const n = Math.max(1, Math.min(doc.numPages, parseInt(e.target.value, 10) || 1)); ir(n); };
    cont.querySelectorAll('[data-i]').forEach(a => a.onclick = async (e) => { e.preventDefault(); const n = await pagDe(planos[+a.dataset.i].dest); if (n) { ir(n); cont.querySelectorAll('.obindl a').forEach(z => z.classList.remove('activa')); a.classList.add('activa'); } else N.toast('Ese marcador no apunta a una página.', 'mal'); });
    let turno = 0;
    const busca = async () => { const q = cont.querySelector('#oiQ').value.trim().toLowerCase(), R = cont.querySelector('#oiRes'), mio = ++turno; if (q.length < 2) { R.innerHTML = ''; return; }
      R.innerHTML = '<div class="pista">Buscando…</div>'; const hall = [];
      for (let n = 1; n <= doc.numPages && hall.length < 60; n++) { const tx = (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' '); if (mio !== turno) return; const low = tx.toLowerCase(); let k = low.indexOf(q), veces = 0, frag = ''; while (k >= 0) { if (!veces) frag = tx.slice(Math.max(0, k - 30), k + q.length + 40); veces++; k = low.indexOf(q, k + q.length); } if (veces) hall.push({ n, veces, frag }); }
      R.innerHTML = hall.length ? hall.map(h => '<a href="#" data-p="' + h.n + '"><b>Pág. ' + h.n + '</b>' + (h.veces > 1 ? ' <span class="pista">(' + h.veces + ')</span>' : '') + '<br><span class="pista">…' + esc(h.frag) + '…</span></a>').join('') : '<div class="pista">Sin coincidencias (un PDF escaneado no tiene texto que buscar).</div>';
      R.querySelectorAll('[data-p]').forEach(a => a.onclick = (e) => { e.preventDefault(); ir(+a.dataset.p); }); };
    cont.querySelector('#oiB').onclick = busca; cont.querySelector('#oiQ').onkeydown = (e) => { if (e.key === 'Enter') busca(); };
  };
})();

/* ───────── DIBUJO Y MEDICIÓN sobre la hoja: un SVG en puntos del PDF encima del lienzo ───────── */
(function () {
  const N = CDE.N, { esc, api } = N, X = N.OBX, O = (pid) => '/api/proyectos/' + pid + '/obra';
  const HERR = [['mano', 'Seleccionar', 'M5 3l12 9-5 1 3 6-2 1-3-6-4 3z'], ['linea', 'Línea', 'M4 20L20 4'], ['flecha', 'Flecha', 'M4 20L20 4M11 4h9v9'], ['rect', 'Rectángulo', 'M4 6h16v12H4z'], ['elipse', 'Elipse', 'M12 5c5 0 8 3 8 7s-3 7-8 7-8-3-8-7 3-7 8-7z'],
    ['nube', 'Nube de revisión', 'M7 18a4 4 0 0 1-1-7.9A5 5 0 0 1 15.6 8 4.5 4.5 0 0 1 17 18z'], ['lapiz', 'Lápiz', 'M4 20l1-5L16 4l4 4L9 19z'], ['texto', 'Texto', 'M5 6h14M12 6v13'], ['distancia', 'Medir distancia', 'M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2'], ['area', 'Medir área', 'M4 19V8l8-4 8 6v9z'], ['borrar', 'Borrar una marca', 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13']];
  const COLORES = ['#d92d20', '#f79009', '#16a34a', '#2563eb', '#7c3aed', '#111827'];
  const metros = (m) => m >= 100 ? m.toFixed(1) + ' m' : m >= 1 ? m.toFixed(2) + ' m' : (m * 100).toFixed(1) + ' cm';
  const m2 = (a) => a >= 10000 ? (a / 10000).toFixed(2) + ' ha' : a.toFixed(2) + ' m²';

  X.herramientas = function (o) {
    const { pid, cid, papel, S, svg, barra, puedo } = o;
    const H = { marcas: [], escala: o.plano.escala || null, tool: 'mano', color: COLORES[0], grosor: 2, ver: true, w: 0, h: 0, tmp: null };
    const k = () => (H.w / (papel.clientWidth || H.w || 1));                        // puntos del PDF por pixel de pantalla
    const P = (p) => [p[0] * H.w, p[1] * H.h];
    const largo = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) { const a = P(pts[i - 1]), b = P(pts[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
    const area = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = P(pts[i]), b = P(pts[(i + 1) % pts.length]); s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
    const etiqueta = (x, y, t, c) => { const f = 12 * k(), an = (t.length * 0.6 + 1) * f; return '<rect x="' + (x - an / 2) + '" y="' + (y - f * 0.85) + '" width="' + an + '" height="' + (f * 1.5) + '" rx="' + (f * 0.3) + '" fill="#fff" stroke="' + c + '" vector-effect="non-scaling-stroke" stroke-width="1"/><text x="' + x + '" y="' + (y + f * 0.28) + '" font-size="' + f + '" text-anchor="middle" fill="' + c + '" font-family="Segoe UI, Arial, sans-serif" font-weight="600">' + esc(t) + '</text>'; };
    const nubeD = (a, b) => { const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), r0 = 9 * k(); let d = 'M' + x0 + ' ' + y0;
      const lado = (ax, ay, bx, by) => { const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / (r0 * 2))); for (let i = 1; i <= n; i++) { const r = L / n / 2; d += ' A' + r + ' ' + r + ' 0 0 1 ' + (ax + (bx - ax) * i / n) + ' ' + (ay + (by - ay) * i / n); } };
      lado(x0, y0, x1, y0); lado(x1, y0, x1, y1); lado(x1, y1, x0, y1); lado(x0, y1, x0, y0); return d + 'Z'; };
    /** El SVG de una marca: la forma visible y, debajo, un trazo ancho invisible para poder acertarle al borrar. */
    function forma(m, previa) {
      const d = m.datos, c = d.color || '#d92d20', pts = (d.puntos || []).map(P), g = (d.grosor || 2), at = 'fill="none" stroke="' + c + '" stroke-width="' + g + '" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"';
      if (!pts.length) return ''; const a = pts[0], b = pts[pts.length - 1]; let cuerpo = '', toque = '';
      const linea = 'M' + pts.map(p => p[0] + ' ' + p[1]).join(' L');
      if (m.tipo === 'linea' || m.tipo === 'lapiz') { cuerpo = '<path d="' + linea + '" ' + at + '/>'; toque = linea; }
      else if (m.tipo === 'flecha') { const an = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 13 * k(), p1 = [b[0] - L * Math.cos(an - 0.42), b[1] - L * Math.sin(an - 0.42)], p2 = [b[0] - L * Math.cos(an + 0.42), b[1] - L * Math.sin(an + 0.42)];
        cuerpo = '<path d="' + linea + '" ' + at + '/><path d="M' + p1[0] + ' ' + p1[1] + ' L' + b[0] + ' ' + b[1] + ' L' + p2[0] + ' ' + p2[1] + '" ' + at + '/>'; toque = linea; }
      else if (m.tipo === 'rect') { toque = 'M' + a[0] + ' ' + a[1] + ' H' + b[0] + ' V' + b[1] + ' H' + a[0] + 'Z'; cuerpo = '<path d="' + toque + '" ' + at + '/>'; }
      else if (m.tipo === 'elipse') { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2; toque = 'M' + (cx - rx) + ' ' + cy + ' A' + rx + ' ' + ry + ' 0 1 0 ' + (cx + rx) + ' ' + cy + ' A' + rx + ' ' + ry + ' 0 1 0 ' + (cx - rx) + ' ' + cy + 'Z'; cuerpo = '<path d="' + toque + '" ' + at + '/>'; }
      else if (m.tipo === 'nube') { toque = nubeD(a, b); cuerpo = '<path d="' + toque + '" ' + at + '/>'; }
      else if (m.tipo === 'texto') { const f = 14 * k(), t = d.texto || '', an = (t.length * 0.58 + 1) * f; toque = 'M' + a[0] + ' ' + (a[1] - f) + ' h' + an + ' v' + (f * 1.4) + ' h' + (-an) + 'Z';
        cuerpo = '<rect x="' + (a[0] - f * 0.3) + '" y="' + (a[1] - f) + '" width="' + an + '" height="' + (f * 1.4) + '" fill="#fffbe6" fill-opacity=".92" stroke="' + c + '" stroke-width="1" vector-effect="non-scaling-stroke"/><text x="' + a[0] + '" y="' + a[1] + '" font-size="' + f + '" fill="' + c + '" font-family="Segoe UI, Arial, sans-serif" font-weight="600">' + esc(t) + '</text>'; }
      else if (m.tipo === 'distancia') { const an = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, t = 6 * k(), tx = t * Math.cos(an), ty = t * Math.sin(an), pt = Math.hypot(b[0] - a[0], b[1] - a[1]);
        cuerpo = '<path d="' + linea + ' M' + (a[0] - tx) + ' ' + (a[1] - ty) + ' L' + (a[0] + tx) + ' ' + (a[1] + ty) + ' M' + (b[0] - tx) + ' ' + (b[1] - ty) + ' L' + (b[0] + tx) + ' ' + (b[1] + ty) + '" ' + at + '/>' + etiqueta((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, H.escala ? metros(pt * H.escala.mPorPt) : 'sin escala', c); toque = linea; }
      else if (m.tipo === 'area') { toque = linea + (previa ? '' : 'Z'); const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        cuerpo = '<path d="' + toque + '" ' + at + ' fill="' + c + '" fill-opacity=".12" style="fill:' + c + ';fill-opacity:.12"/>' + (pts.length > 2 ? etiqueta(cx, cy, H.escala ? m2(area(d.puntos) * H.escala.mPorPt * H.escala.mPorPt) : 'sin escala', c) : ''); }
      return '<g class="obm" data-m="' + (m.id || '') + '">' + cuerpo + (previa ? '' : '<path class="obmtoque" d="' + toque + '" fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke"><title>' + esc((HERR.find(h => h[0] === m.tipo) || [0, m.tipo])[1] + ' · ' + String(m.autor || '').split('@')[0]) + '</title></path>') + '</g>';
    }
    function pinta(w, h) {
      if (w) { H.w = w; H.h = h; } if (!H.w) return;
      svg.setAttribute('viewBox', '0 0 ' + H.w + ' ' + H.h); svg.setAttribute('preserveAspectRatio', 'none');
      svg.innerHTML = (H.ver ? H.marcas.filter(m => (m.pagina || 1) === S.pag).map(m => forma(m)).join('') : '') + (H.tmp ? forma(H.tmp, true) : '');
      if (H.tool === 'borrar') svg.querySelectorAll('.obm[data-m]').forEach(g => g.onclick = async (e) => { e.stopPropagation(); const id = g.dataset.m; if (!id) return; try { await api(O(pid) + '/marcas/' + id, { method: 'DELETE' }); H.marcas = H.marcas.filter(m => m.id !== id); pinta(); cuenta(); } catch (err) { N.toast(esc(err.message), 'mal'); } });
    }
    const cuenta = () => { const el = barra.querySelector('#hvN'); if (el) el.textContent = H.marcas.filter(m => (m.pagina || 1) === S.pag).length + ' marca(s) en esta hoja'; };
    function herramienta(t) {
      H.tool = t; H.tmp = null; papel.classList.toggle('dibujando', t !== 'mano'); papel.classList.toggle('borrando', t === 'borrar');
      barra.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('activa', b.dataset.h === t));
      const ay = barra.querySelector('#hvAyuda'); if (ay) ay.textContent = t === 'area' ? 'Haz clic en cada vértice; doble clic o Enter para cerrar el área.' : t === 'calibrar' ? 'Marca los dos extremos de una medida que conozcas (una cota, un eje).' : t === 'texto' ? 'Haz clic donde va el texto.' : t === 'borrar' ? 'Haz clic sobre la marca que quieres quitar.' : t === 'mano' ? '' : 'Arrastra sobre el plano. Esc cancela.';
      pinta();
    }
    async function guarda(tipo, puntos, texto) {
      try { const r = await api(O(pid) + '/planos/' + cid + '/marcas', { json: { tipo, pagina: S.pag, puntos, color: H.color, grosor: H.grosor, texto: texto || '' } });
        H.marcas.push({ id: r.id, tipo, pagina: S.pag, datos: { puntos, color: H.color, grosor: H.grosor, texto: texto || '' }, autor: (N.YO || {}).email || '', mia: true }); } catch (e) { N.toast(esc(e.message), 'mal'); }
      H.tmp = null; pinta(); cuenta();
    }
    function pintaBarra() {
      barra.innerHTML = (puedo ? HERR.map(h => '<button class="obhb' + (h[0] === H.tool ? ' activa' : '') + '" data-h="' + h[0] + '" title="' + h[1] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + h[2] + '"/></svg></button>' + (h[0] === 'mano' || h[0] === 'texto' || h[0] === 'area' ? '<i></i>' : '')).join('') +
        '<span class="obhcol">' + COLORES.map(c => '<button data-c="' + c + '" class="' + (c === H.color ? 'activa' : '') + '" style="--c:' + c + '" title="Color"></button>').join('') + '</span><select id="hvG" title="Grosor del trazo">' + [1, 2, 3, 5].map(g => '<option value="' + g + '"' + (g === H.grosor ? ' selected' : '') + '>' + g + ' px</option>').join('') + '</select><i></i>' : '') +
        '<button class="mini" id="hvEsc" title="' + (puedo ? 'Definir la escala de esta hoja para medir' : 'Escala de la hoja') + '">Escala: ' + esc(H.escala ? (H.escala.texto || 'calibrada') : 'sin definir') + '</button><label class="rvchk" style="margin:0"><input type="checkbox" id="hvVer"' + (H.ver ? ' checked' : '') + '> ver marcas</label><span class="pista" id="hvN"></span><span class="pista" id="hvAyuda" style="flex:1;text-align:right"></span>';
      barra.querySelectorAll('[data-h]').forEach(b => b.onclick = () => herramienta(H.tool === b.dataset.h ? 'mano' : b.dataset.h));
      barra.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { H.color = b.dataset.c; barra.querySelectorAll('[data-c]').forEach(z => z.classList.toggle('activa', z === b)); });
      const g = barra.querySelector('#hvG'); if (g) g.onchange = () => { H.grosor = +g.value; };
      barra.querySelector('#hvVer').onchange = (e) => { H.ver = e.target.checked; pinta(); };
      barra.querySelector('#hvEsc').onclick = () => { if (puedo) ventanaEscala(); else N.toast(H.escala ? 'Escala de la hoja: ' + esc(H.escala.texto || 'calibrada') : 'Esta hoja aún no tiene escala.', ''); };
      cuenta();
    }
    async function fijaEscala(mPorPt, texto) { try { const r = await api(O(pid) + '/planos/' + cid + '/escala', { method: 'PUT', json: { mPorPt, texto } }); H.escala = r.escala; pintaBarra(); herramienta('mano'); N.toast(H.escala ? 'Escala guardada: ' + esc(H.escala.texto) : 'Escala quitada.', 'bien'); } catch (e) { N.toast(esc(e.message), 'mal'); } }
    function ventanaEscala() {
      const v = N.ventana('Escala de la hoja', '<p class="pista" style="margin-top:0">Las medidas de distancia y de área usan esta escala. Vale para todas las hojas de este documento.</p>' +
        '<label>Escala del plano</label><div class="fila" style="gap:6px;align-items:center"><span>1 :</span><input id="esN" type="number" min="1" step="1" value="' + (H.escala && /^1:(\d+)/.test(H.escala.texto || '') ? RegExp.$1 : 100) + '" style="width:110px"><button class="primario" id="esOk">Usar esta escala</button></div>' +
        '<div class="pista" style="margin:4px 0 14px">Solo es exacta si el PDF se generó a tamaño real de impresión (A1, A0…).</div>' +
        '<label>O calibra con una medida conocida</label><div class="fila" style="gap:6px"><button id="esCal">Marcar dos puntos en el plano…</button>' + (H.escala ? '<button id="esDel">Quitar la escala</button>' : '') + '</div>', { ancho: 460, alto: 330 });
      const cierra = () => { const w = v.closest('.ventana'); if (w) w.remove(); };
      v.querySelector('#esOk').onclick = () => { const n = Number(v.querySelector('#esN').value); if (!(n > 0)) return N.toast('Escribe la escala, por ejemplo 100.', 'mal'); cierra(); fijaEscala(n * 0.0254 / 72, '1:' + n); };
      v.querySelector('#esCal').onclick = () => { cierra(); herramienta('calibrar'); };
      const d = v.querySelector('#esDel'); if (d) d.onclick = () => { cierra(); fijaEscala(0, ''); };
    }
    // ── gestos sobre el SVG
    const rel = (e) => { const r = papel.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    const DOS = ['linea', 'flecha', 'rect', 'elipse', 'nube', 'distancia', 'calibrar'];
    let traza = null;
    svg.onpointerdown = (e) => {
      const t = H.tool; if (t === 'mano' || t === 'borrar' || e.button !== 0) return; e.preventDefault(); const p = rel(e);
      if (t === 'texto') { N.pide('Texto sobre el plano', 'Texto', '', 'Colocar').then(tx => { if (tx && tx.trim()) guarda('texto', [p], tx.trim()); }); return; }
      if (t === 'area') { if (!H.tmp) H.tmp = { tipo: 'area', datos: { puntos: [p, p], color: H.color, grosor: H.grosor } }; else { const pts = H.tmp.datos.puntos; pts[pts.length - 1] = p; pts.push(p); } pinta(); return; }
      svg.setPointerCapture(e.pointerId); traza = t;
      H.tmp = { tipo: t === 'calibrar' ? 'distancia' : t, datos: { puntos: [p, p], color: t === 'calibrar' ? '#7c3aed' : H.color, grosor: H.grosor } }; pinta();
    };
    svg.onpointermove = (e) => { if (!H.tmp) return; const p = rel(e), pts = H.tmp.datos.puntos;
      if (H.tool === 'lapiz' && traza) { const u = P(pts[pts.length - 1]), n = P(p); if (Math.hypot(n[0] - u[0], n[1] - u[1]) > 2.5 * k()) pts.push(p); } else pts[pts.length - 1] = p; pinta(); };
    svg.onpointerup = async (e) => {
      if (!traza || !H.tmp) return; const t = traza, pts = H.tmp.datos.puntos; traza = null;
      if (largo(pts) < 4 * k()) { H.tmp = null; return pinta(); }
      if (t === 'calibrar') { const pt = largo(pts), txt = await N.pide('Calibrar la escala', 'Longitud real entre los dos puntos, en metros', '', 'Calibrar'), L = Number(String(txt || '').replace(',', '.')); H.tmp = null; pinta(); if (!(L > 0)) return herramienta('mano'); return fijaEscala(L / pt, 'calibrada (' + metros(L) + ')'); }
      if (t === 'lapiz' && pts.length > 400) { const paso = Math.ceil(pts.length / 400); H.tmp.datos.puntos = pts.filter((_, i) => i % paso === 0 || i === pts.length - 1); }
      if (DOS.includes(t) || t === 'lapiz') guarda(t, H.tmp.datos.puntos);
    };
    const cierraArea = () => { if (H.tool !== 'area' || !H.tmp) return; const pts = H.tmp.datos.puntos.slice(0, -1).filter((p, i, A) => !i || Math.hypot(p[0] - A[i - 1][0], p[1] - A[i - 1][1]) > 1e-4); if (pts.length < 3) { H.tmp = null; return pinta(); } guarda('area', pts); };
    svg.ondblclick = (e) => { e.preventDefault(); cierraArea(); };
    const tecla = (e) => { if (!document.body.contains(svg)) return document.removeEventListener('keydown', tecla); if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) return;
      if (e.key === 'Escape' && H.tool !== 'mano') { if (H.tmp) { H.tmp = null; traza = null; pinta(); } else herramienta('mano'); } if (e.key === 'Enter') cierraArea(); };
    document.addEventListener('keydown', tecla);
    pintaBarra();
    api(O(pid) + '/planos/' + cid + '/marcas').then(r => { H.marcas = r.marcas || []; H.escala = r.escala || H.escala; pintaBarra(); pinta(); }).catch(() => {});
    return { pinta: (w, h) => { pinta(w, h); cuenta(); }, herramienta };
  };
})();

/* ───────── ESPECIFICACIONES, CONSULTAS (RFI), ÓRDENES DE CAMBIO y PLANOS DESDE LA NUBE ───────── */
(function () {
  const N = CDE.N, { esc, api, fecha, aviso, app } = N, X = N.OBX, O = (pid) => '/api/proyectos/' + pid + '/obra';
  const corto = (e) => String(e || '').split('@')[0], hoy = () => new Date().toISOString().slice(0, 10);
  const plata = (v, m) => (m || 'S/') + ' ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cierraV = (v) => { const w = v.closest('.ventana'); if (w) w.remove(); };
  const RX = N.OBR = N.OBR || { rfi: { vista: 'lista', est: '', q: '' }, cambio: { vista: 'lista', est: '', q: '' }, esq: '' };
  const COL = { borrador: '#667085', abierta: '#f79009', respondida: '#2563eb', cerrada: '#16a34a', solicitada: '#f79009', pendiente: '#7c3aed', aprobada: '#16a34a', rechazada: '#d92d20' };
  const chip = (e, t) => '<span class="obchip" style="--c:' + (COL[e] || '#667085') + '">' + esc(t || e) + '</span>';
  const DEF = { rfi: { uno: 'consulta', una: 'Consulta', plural: 'Consultas (RFI)', vacio: 'consultas (RFI)', nueva: '+ Nueva consulta', ruta: 'rfi', sigla: 'RFI' }, cambio: { uno: 'orden de cambio', una: 'Orden de cambio', plural: 'Órdenes de cambio', vacio: 'órdenes de cambio', nueva: '+ Nueva orden de cambio', ruta: 'cambios', sigla: 'OC' } };
  const MOTIVOS = ['Solicitud del cliente', 'Condición de sitio imprevista', 'Error u omisión de diseño', 'Cambio normativo', 'Mejora propuesta por el contratista', 'Otro'];
  const vencida = (r) => r.datos.vence && r.datos.vence < hoy() && !/^(cerrada|aprobada|rechazada|respondida)$/.test(r.estado);

  // ── ESPECIFICACIONES: los PDF de especificaciones técnicas del CDE, por libro y división
  X.vistaEspecs = async function (p, res) {
    const pid = p.id, d = await api(O(pid) + '/planos?tipo=espec'), q = RX.esq.toLowerCase(), recarga = async () => X.vistaEspecs(p, await api(O(pid) + '/resumen'));
    const L = d.planos.filter(x => !q || (x.nombre + ' ' + x.coleccion + ' ' + x.carpeta + ' ' + (x.titulo || '')).toLowerCase().includes(q)), libros = {};
    L.forEach(x => { ((libros[x.coleccion || 'Especificaciones'] = libros[x.coleccion || 'Especificaciones'] || {})[x.carpeta || 'General'] = libros[x.coleccion || 'Especificaciones'][x.carpeta || 'General'] || []).push(x); });
    app.innerHTML = X.cabecera(p, 'especs', res, res.puedoEditar ? '<button class="primario" id="oeAdd">+ Añadir especificaciones</button>' : '') +
      (d.planos.length ? '<div class="obfiltros"><input id="oeQ" placeholder="Buscar por nombre, libro o división" value="' + esc(RX.esq) + '" style="width:320px"><span class="pista">' + L.length + ' de ' + d.planos.length + ' documento(s)</span></div>' +
        Object.keys(libros).map(l => '<div class="tarjeta obcol"><h2>' + esc(l) + '</h2>' + Object.keys(libros[l]).sort().map(dv => '<details open><summary><b>' + esc(dv) + '</b> <span class="pista">(' + libros[l][dv].length + ')</span></summary><div class="acctabla"><table><thead><tr><th>Documento</th><th>Versión</th><th>Estado</th><th>Tareas</th><th></th></tr></thead><tbody>' +
          libros[l][dv].map(x => '<tr class="clic" data-esp="' + esc(x.id) + '"><td><b class="mono">' + esc(x.nombre) + '</b>' + (x.titulo ? '<div class="pista">' + esc(x.titulo) + '</div>' : '') + '</td><td>V' + x.n + (x.revision ? ' · ' + esc(x.revision) : '') + '</td><td>' + esc(x.estado || '') + '</td><td>' + (x.tareas ? x.tareas + (x.abiertas ? ' <span class="pista">(' + x.abiertas + ' abiertas)</span>' : '') : '<span class="pista">—</span>') + '</td><td style="text-align:right;white-space:nowrap"><a class="boton mini" href="#/p/' + pid + '/c/' + esc(x.id) + '" data-noabre title="Ficha del documento en el CDE">Ficha</a>' + (res.puedoEditar ? ' <button class="mini" data-qesp="' + esc(x.id) + '" title="Quitar de Especificaciones (el documento sigue en el CDE)">✕</button>' : '') + '</td></tr>').join('') + '</tbody></table></div></details>').join('') + '</div>').join('')
        : '<div class="tarjeta"><div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay especificaciones.</b><br>Elige los PDF de especificaciones técnicas que ya están en Documentos de proyecto. Se abren siempre en su versión vigente, con índice de secciones, búsqueda de texto, marcas y tareas sobre la página.' + (res.puedoEditar ? '<br><br><button class="primario" id="oeAdd2">+ Añadir especificaciones</button>' : '') + '</div></div></div>') + N.cierra();
    ['oeAdd', 'oeAdd2'].forEach(i => { const b = document.getElementById(i); if (b) b.onclick = () => X.ventanaAgregaPlanos(p, d.planos, recarga, 'espec'); });
    const iq = document.getElementById('oeQ'); if (iq) iq.onkeydown = (e) => { if (e.key === 'Enter') { RX.esq = iq.value; recarga(); } };
    app.querySelectorAll('[data-esp]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('[data-noabre],[data-qesp]')) return; location.hash = '#/p/' + pid + '/obra/espec/' + tr.dataset.esp; });
    app.querySelectorAll('[data-qesp]').forEach(b => b.onclick = async () => { if (!confirm('¿Quitar este documento de Especificaciones? Sigue en el CDE, y sus tareas y marcas se conservan.')) return; try { await api(O(pid) + '/planos/' + b.dataset.qesp, { method: 'DELETE' }); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
  };

  // ── CONSULTAS y ÓRDENES DE CAMBIO: resumen por estado, lista o tablero, y la ventana de cada registro
  X.vistaRegistros = async function (p, res, tipo, ide) {
    const pid = p.id, D = DEF[tipo], F = RX[tipo], d = await api(O(pid) + '/registros/' + tipo), m = d.moneda, q = F.q.toLowerCase();
    const recarga = async () => { if (document.body.contains(app) && new RegExp('/obra/' + D.ruta).test(location.hash)) X.vistaRegistros(p, await api(O(pid) + '/resumen'), tipo); };
    const T = d.registros, L = T.filter(r => (!F.est || r.estado === F.est) && (!q || ('#' + r.numero + ' ' + r.titulo + ' ' + (r.datos.para || '') + ' ' + (r.datos.disciplina || '') + ' ' + (r.datos.motivo || '') + ' ' + r.creado_por).toLowerCase().includes(q)));
    const tarj = d.estados.map(e => { const G = T.filter(r => r.estado === e[0]); return '<button class="obrcard' + (F.est === e[0] ? ' activa' : '') + '" data-est="' + e[0] + '" style="--c:' + COL[e[0]] + '" title="Ver solo: ' + e[1] + '"><span>' + e[1] + '</span><b>' + G.length + '</b>' + (tipo === 'cambio' ? '<i>' + plata(G.reduce((s, r) => s + (r.datos.monto || 0), 0), m) + '</i>' : (e[0] === 'abierta' ? '<i>' + G.filter(vencida).length + ' vencida(s)</i>' : '<i>&nbsp;</i>')) + '</button>'; }).join('');
    const fila = (r) => '<tr class="clic" data-r="' + r.id + '"><td class="num">' + D.sigla + '-' + String(r.numero).padStart(3, '0') + '</td><td><b>' + esc(r.titulo || 'Sin título') + '</b></td><td>' + chip(r.estado, r.estadoTxt) + '</td>' +
      (tipo === 'rfi' ? '<td>' + esc(r.datos.disciplina || '') + '</td><td>' + (r.datos.para ? N.avatarMini(r.datos.para) + ' ' + esc(corto(r.datos.para)) : '<span class="pista">—</span>') + '</td><td>' + (r.datos.impactoCosto ? 'Costo ' : '') + (r.datos.impactoPlazo ? 'Plazo' : '') + '</td>'
        : '<td>' + esc(r.datos.motivo || '') + '</td><td class="num">' + plata(r.datos.monto, m) + '</td><td class="num">' + (r.datos.dias ? r.datos.dias + ' d' : '') + '</td>') +
      '<td' + (vencida(r) ? ' style="color:var(--rojo);font-weight:600" title="Vencida"' : '') + '>' + esc(r.datos.vence || '') + '</td><td>' + esc(corto(r.creado_por)) + '</td><td class="pista">' + fecha(r.actualizado) + '</td></tr>';
    const carta = (r) => '<div class="obcard" data-r="' + r.id + '"><div class="obcinfo"><div class="pista">' + D.sigla + '-' + String(r.numero).padStart(3, '0') + (vencida(r) ? ' · <b style="color:var(--rojo)">vencida</b>' : '') + '</div><div class="obttit">' + esc(r.titulo || 'Sin título') + '</div><div class="pista">' + (tipo === 'cambio' ? plata(r.datos.monto, m) + (r.datos.dias ? ' · ' + r.datos.dias + ' d' : '') : esc([r.datos.disciplina, r.datos.vence ? 'vence ' + r.datos.vence : ''].filter(Boolean).join(' · '))) + '</div><div class="obcpie">' + N.avatarMini(tipo === 'rfi' && r.datos.para ? r.datos.para : r.creado_por) + '</div></div></div>';
    const cuerpo = !T.length ? '<div class="tarjeta"><div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay ' + D.vacio + '.</b><br>' + (tipo === 'rfi' ? 'Una consulta de obra se dirige a quien debe responderla, lleva fecha límite, puede apuntar a un plano o a una tarea, y queda con su respuesta y todo el historial.' : 'Una orden de cambio reúne el motivo, las partidas con su monto y los días de plazo; se solicita y un gestor del proyecto la aprueba o la rechaza. Las aprobadas se suman en Presupuesto.') + '</div></div></div>'
      : F.vista === 'tablero' ? '<div class="obtablero" style="grid-template-columns:repeat(' + d.estados.length + ',minmax(210px,1fr))">' + d.estados.map(e => { const C = L.filter(r => r.estado === e[0]); return '<div class="obcolu"><div class="obcolcab" style="--c:' + COL[e[0]] + '"><b>' + e[1] + '</b><span>' + C.length + '</span></div><div class="obcolcu">' + (C.map(carta).join('') || '<div class="pista obvacia">Ninguna</div>') + '</div></div>'; }).join('') + '</div>'
        : '<div class="acctabla"><table><thead><tr><th>N.º</th><th>' + (tipo === 'rfi' ? 'Asunto' : 'Nombre') + '</th><th>Estado</th>' + (tipo === 'rfi' ? '<th>Disciplina</th><th>Dirigida a</th><th>Impacto</th>' : '<th>Motivo</th><th class="num">Monto</th><th class="num">Plazo</th>') + '<th>Vence</th><th>Creada por</th><th>Actualizada</th></tr></thead><tbody>' + (L.map(fila).join('') || '<tr><td colspan="9" class="pista">Nada coincide con el filtro.</td></tr>') + '</tbody>' +
          (tipo === 'cambio' && L.length ? '<tfoot><tr><th colspan="4">Total de lo que se ve</th><th class="num">' + plata(L.reduce((s, r) => s + (r.datos.monto || 0), 0), m) + '</th><th class="num">' + L.reduce((s, r) => s + (r.datos.dias || 0), 0) + ' d</th><th colspan="3"></th></tr></tfoot>' : '') + '</table></div>';
    app.innerHTML = X.cabecera(p, D.ruta, res, (d.puedoEditar ? '<button class="primario" id="orNueva">' + D.nueva + '</button> ' : '') + (T.length ? '<button id="orInf">Generar informe</button>' : '')) +
      '<div class="obrcards">' + tarj + '</div><div class="obfiltros">' + (F.est ? '<button class="mini" id="orTodas">✕ Quitar filtro de estado</button>' : '') + '<span class="crece"></span><input id="orQ" placeholder="Buscar" value="' + esc(F.q) + '" style="width:220px"><div class="obvistas"><button data-v="lista" class="' + (F.vista === 'lista' ? 'activa' : '') + '">Lista</button><button data-v="tablero" class="' + (F.vista === 'tablero' ? 'activa' : '') + '">Tablero</button></div></div>' + cuerpo + N.cierra();
    app.querySelectorAll('[data-est]').forEach(b => b.onclick = () => { F.est = F.est === b.dataset.est ? '' : b.dataset.est; recarga(); });
    app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { F.vista = b.dataset.v; recarga(); });
    app.querySelectorAll('[data-r]').forEach(c => c.onclick = () => X.abreRegistro(pid, c.dataset.r, recarga));
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    on('orTodas', () => { F.est = ''; recarga(); });
    document.getElementById('orQ').onkeydown = (e) => { if (e.key === 'Enter') { F.q = e.target.value; recarga(); } };
    on('orNueva', async () => { try { const r = await api(O(pid) + '/registros/' + tipo, { json: { titulo: '' } }); await recarga(); X.abreRegistro(pid, r.id, recarga, true); } catch (e) { N.toast(esc(e.message), 'mal'); } });
    on('orInf', async () => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new();
      const cab = tipo === 'rfi' ? ['N.º', 'Asunto', 'Estado', 'Disciplina', 'Dirigida a', 'Vence', 'Impacto en costo', 'Impacto en plazo', 'Consulta', 'Respuesta', 'Respondida por', 'Creada por', 'Creada'] : ['N.º', 'Nombre', 'Estado', 'Motivo', 'Monto', 'Días de plazo', 'Vence', 'Descripción', 'Decidida por', 'Creada por', 'Creada'];
      const filas = L.slice().reverse().map(r => tipo === 'rfi' ? [r.numero, r.titulo, r.estadoTxt, r.datos.disciplina, r.datos.para, r.datos.vence, r.datos.impactoCosto ? 'Sí' : 'No', r.datos.impactoPlazo ? 'Sí' : 'No', r.datos.pregunta, r.datos.respuesta, r.datos.respondidaPor, r.creado_por, (r.creado || '').slice(0, 10)] : [r.numero, r.titulo, r.estadoTxt, r.datos.motivo, r.datos.monto || 0, r.datos.dias || 0, r.datos.vence, r.datos.descripcion, r.datos.decididaPor, r.creado_por, (r.creado || '').slice(0, 10)]);
      XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([cab].concat(filas)), tipo === 'rfi' ? 'Consultas' : 'Ordenes de cambio');
      XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Estado', 'Cantidad'].concat(tipo === 'cambio' ? ['Monto'] : [])].concat(d.estados.map(e => [e[1], T.filter(r => r.estado === e[0]).length].concat(tipo === 'cambio' ? [T.filter(r => r.estado === e[0]).reduce((s, r) => s + (r.datos.monto || 0), 0)] : [])))), 'Resumen');
      XL.writeFile(wb, (tipo === 'rfi' ? 'consultas-rfi-' : 'ordenes-de-cambio-') + p.codigo + '-' + hoy() + '.xlsx'); });
    if (ide) X.abreRegistro(pid, ide, recarga);
  };

  X.abreRegistro = async function (pid, rid, luego, nuevo) {
    let r, mm = [], tareas = [], planos = [], rfis = [], cfg = { categorias: [] };
    const trae = async () => { r = await api(O(pid) + '/registro/' + rid); };
    try { await trae(); [mm, tareas, planos, cfg] = await Promise.all([api('/api/proyectos/' + pid + '/miembros').then(x => x.miembros || []).catch(() => []), api(O(pid) + '/tareas').then(x => x.tareas).catch(() => []), api(O(pid) + '/planos').then(x => x.planos).catch(() => []), api(O(pid) + '/config').then(x => x.config).catch(() => ({ categorias: [] }))]);
      if (r.tipo === 'cambio') rfis = await api(O(pid) + '/registros/rfi').then(x => x.registros).catch(() => []); } catch (e) { return N.toast(esc(e.message), 'mal'); }
    const tipo = r.tipo, D = DEF[tipo], cod = () => D.sigla + '-' + String(r.numero).padStart(3, '0');
    document.querySelectorAll('.ventana[data-obr]').forEach(x => x.remove());
    const v = N.ventana(D.una + ' ' + cod(), '', { ancho: 1000, alto: 720 }); v.closest('.ventana').dataset.obr = rid;
    const quien = (e) => { const m = mm.find(x => x.email === e); return m && m.nombre ? m.nombre : corto(e); };
    const guarda = async (cambio, callar) => { try { await api(O(pid) + '/registro/' + rid, { method: 'PUT', json: cambio }); await trae(); pinta(); if (luego) luego(); return true; } catch (e) { if (!callar) N.toast(esc(e.message), 'mal'); await trae().catch(() => {}); pinta(); return false; } };
    const url = () => location.origin + location.pathname + '#/p/' + pid + '/obra/' + D.ruta + '/' + rid;
    function pinta() {
      const d = r.datos, ed = r.puedoEditar, dis = ed ? '' : ' disabled', m = r.moneda;
      const sel = (id, ops, val, vacio, off) => '<select id="' + id + '"' + (off ? ' disabled' : dis) + '>' + (vacio ? '<option value="">' + vacio + '</option>' : '') + ops.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
      const act = r.actividad.map(a => a.tipo === 'cambio' ? '<div class="obact cambio"><span>' + esc(a.texto) + '</span><i>' + esc(corto(a.autor)) + ' · ' + fecha(a.fecha) + '</i></div>' : '<div class="obact">' + N.avatarMini(a.autor) + '<div><b>' + esc(quien(a.autor)) + '</b> <i>' + fecha(a.fecha) + '</i><div class="obmsg">' + esc(a.texto) + '</div></div></div>').join('');
      const fotos = r.fotos.map(f => '<a href="#" class="obthumb" data-foto="' + f.id + '" title="' + esc(f.nombre) + '"><img src="' + X.urlFoto(pid, f.id) + '" alt="" loading="lazy"></a>').join('');
      const pasos = r.estados.map(e => '<span class="obrpaso' + (e[0] === r.estado ? ' activa' : '') + '" style="--c:' + COL[e[0]] + '">' + e[1] + '</span>').join('<i>›</i>');
      let acciones = '';
      if (tipo === 'rfi') acciones = (r.estado === 'borrador' && ed ? '<button class="primario" data-pasa="abierta">Enviar consulta</button>' : '') + (r.puedoResponder ? '<button class="primario" data-pasa="respondida">Registrar respuesta</button>' : '') + (r.estado === 'respondida' && ed ? '<button class="primario" data-pasa="cerrada">Cerrar consulta</button><button data-pasa="abierta" title="La respuesta no resuelve la consulta">Reabrir</button>' : '') + (r.estado === 'abierta' && ed && (r.soyAutor || r.puedoBorrar) ? '<button data-pasa="cerrada" title="Cerrar sin respuesta">Cerrar</button>' : '');
      else acciones = (r.estado === 'borrador' && ed ? '<button class="primario" data-pasa="solicitada">Solicitar aprobación</button>' : '') + (r.puedoDecidir ? (r.estado === 'solicitada' ? '<button data-pasa="pendiente" title="Queda en evaluación">Pasar a pendiente</button>' : '') + '<button class="primario" data-pasa="aprobada">Aprobar</button><button data-pasa="rechazada">Rechazar</button>' : '');
      const partidas = (d.partidas || []);
      v.innerHTML = '<div class="obtarea"><div class="obtizq"><div class="obrpasos">' + pasos + '</div><div class="obtcab"><span class="obrcod">' + cod() + '</span><input id="rgTit" class="obtinput" value="' + esc(r.titulo) + '" placeholder="' + (tipo === 'rfi' ? 'Asunto de la consulta' : 'Nombre de la orden de cambio') + '"' + dis + '></div>' +
        (tipo === 'rfi' ? '<h3>Consulta</h3><textarea id="rgPre" rows="5" placeholder="Describe la consulta: qué se necesita aclarar, dónde y por qué."' + dis + '>' + esc(d.pregunta || '') + '</textarea>' +
          '<h3>Respuesta' + (d.respondidaPor ? ' <span class="pista">· ' + esc(quien(d.respondidaPor)) + ' · ' + fecha(d.respondidaFecha) + '</span>' : '') + '</h3><textarea id="rgRes" rows="4" placeholder="' + (r.puedoResponder ? 'Escribe la respuesta y pulsa «Registrar respuesta».' : r.estado === 'borrador' ? 'La respuesta se escribe cuando la consulta esté enviada.' : 'Aún sin respuesta.') + '"' + (r.puedoResponder ? '' : ' disabled') + '>' + esc(d.respuesta || '') + '</textarea>'
          : '<h3>Descripción del cambio</h3><textarea id="rgDes" rows="4" placeholder="Qué cambia respecto de lo contratado y por qué."' + dis + '>' + esc(d.descripcion || '') + '</textarea>' +
            '<h3>Partidas</h3><table class="chica obrpart"><thead><tr><th>Descripción</th><th class="num" style="width:150px">Monto (' + esc(m) + ')</th><th style="width:30px"></th></tr></thead><tbody>' + partidas.map((x, i) => '<tr><td><input data-pd="' + i + '" value="' + esc(x.descripcion) + '"' + dis + '></td><td><input data-pm="' + i + '" type="number" step="0.01" value="' + x.monto + '"' + dis + ' style="text-align:right"></td><td>' + (ed ? '<a href="#" data-pq="' + i + '" title="Quitar la partida">×</a>' : '') + '</td></tr>').join('') +
            (ed ? '<tr><td><input id="rgPn" placeholder="+ Nueva partida (Enter)"></td><td><input id="rgPnm" type="number" step="0.01" placeholder="0.00" style="text-align:right"></td><td></td></tr>' : '') + '</tbody><tfoot><tr><th>Total' + (partidas.length ? '' : ' <span class="pista">(sin partidas: escribe el monto a la derecha)</span>') + '</th><th class="num">' + plata(d.monto, m) + '</th><th></th></tr></tfoot></table>' +
            (d.decididaPor ? '<div class="pista" style="margin-top:8px">' + (r.estado === 'aprobada' ? 'Aprobada' : 'Rechazada') + ' por ' + esc(quien(d.decididaPor)) + ' · ' + fecha(d.decididaFecha) + (d.motivoDecision ? ' · «' + esc(d.motivoDecision) + '»' : '') + '</div>' : '')) +
        '<h3>Fotos y adjuntos</h3><div class="obrfotos">' + (fotos || '<span class="pista">Sin fotos.</span>') + '</div>' +
        '<h3>Actividad</h3><div class="obactiv" id="rgAct">' + (act || '<div class="pista">Sin actividad.</div>') + '</div>' +
        '<div class="obenvia"><textarea id="rgMsg" placeholder="Escribe un comentario…" rows="2"></textarea><div class="fila" style="gap:6px;align-items:center">' + (ed || r.puedoResponder ? '<input type="file" id="rgFile" accept="image/*" multiple style="display:none"><button class="mini" id="rgFoto">📷 Foto</button>' : '') + '<span class="crece"></span><button class="mini" id="rgComp">Compartir ▾</button><button class="primario mini" id="rgEnv">Comentar</button></div></div></div>' +
        '<div class="obtder"><h3 style="margin-top:0">Estado</h3><div style="margin-bottom:8px">' + chip(r.estado, r.estadoTxt) + (vencida(r) ? ' <b style="color:var(--rojo)">vencida</b>' : '') + '</div><div class="obracc">' + (acciones || '<span class="pista">' + (/^(cerrada|aprobada|rechazada)$/.test(r.estado) ? 'Registro cerrado: ya no se modifica.' : 'No hay acciones para tu rol en este estado.') + '</span>') + '</div>' +
        '<h3>Datos</h3>' + (tipo === 'rfi'
          ? '<div class="obattr"><label>Dirigida a</label>' + sel('rgPara', mm.map(x => [x.email, x.nombre || corto(x.email)]), d.para, '(sin asignar)') + '</div><div class="obattr"><label>Responder antes de</label><input type="date" id="rgVen" value="' + esc(d.vence || '') + '"' + dis + '></div><div class="obattr"><label>Disciplina</label><input id="rgDis" list="rgDisL" value="' + esc(d.disciplina || '') + '"' + dis + '><datalist id="rgDisL">' + (cfg.categorias || []).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
            '<div class="obattr"><label>Plano</label>' + sel('rgPla', planos.map(x => [x.id, x.nombre]), d.plano_id, '(ninguno)') + '</div><div class="obattr"><label>Tarea</label>' + sel('rgTar', tareas.map(x => [x.id, '#' + x.numero + ' ' + (x.titulo || 'Sin título')]), d.tarea_id, '(ninguna)') + '</div>' +
            '<div class="obattr"><label>Impacto</label><div><label class="rvchk" style="margin:0"><input type="checkbox" id="rgIc"' + (d.impactoCosto ? ' checked' : '') + dis + '> en costo</label> <label class="rvchk" style="margin:0"><input type="checkbox" id="rgIp"' + (d.impactoPlazo ? ' checked' : '') + dis + '> en plazo</label></div></div>'
          : '<div class="obattr"><label>Motivo</label>' + sel('rgMot', MOTIVOS.concat(d.motivo && !MOTIVOS.includes(d.motivo) ? [d.motivo] : []).map(x => [x, x]), d.motivo, '(elige)') + '</div><div class="obattr"><label>Monto (' + esc(m) + ')</label><input type="number" step="0.01" id="rgMon" value="' + (d.monto || 0) + '"' + (ed && !partidas.length ? '' : ' disabled') + (partidas.length ? ' title="Es la suma de las partidas"' : '') + '></div><div class="obattr"><label>Días de plazo</label><input type="number" step="1" id="rgDia" value="' + (d.dias || 0) + '"' + dis + '></div><div class="obattr"><label>Decidir antes de</label><input type="date" id="rgVen" value="' + esc(d.vence || '') + '"' + dis + '></div>' +
            '<div class="obattr"><label>Consulta (RFI)</label>' + sel('rgRfi', rfis.map(x => [x.id, 'RFI-' + String(x.numero).padStart(3, '0') + ' ' + (x.titulo || '')]), d.rfi_id, '(ninguna)') + '</div><div class="obattr"><label>Tarea</label>' + sel('rgTar', tareas.map(x => [x.id, '#' + x.numero + ' ' + (x.titulo || 'Sin título')]), d.tarea_id, '(ninguna)') + '</div>') +
        '<h3>Enlaces</h3><div class="obrenl">' + ([r.plano ? '<a href="#/p/' + pid + '/obra/plano/' + esc(r.plano.id) + '" data-cierra>📐 ' + esc(r.plano.nombre) + '</a>' : '', r.tarea ? '<a href="#" id="rgIrT">' + X.punto(r.tarea.estado, r.tarea.numero) + ' ' + esc(r.tarea.titulo || 'Sin título') + '</a>' : '', r.rfi ? '<a href="#" id="rgIrR">RFI-' + String(r.rfi.numero).padStart(3, '0') + ' ' + esc(r.rfi.titulo || '') + '</a>' : ''].filter(Boolean).join('') || '<span class="pista">Sin enlaces.</span>') + '</div>' +
        (tipo === 'rfi' && ed ? '<div class="fila" style="gap:6px;margin-top:10px;flex-wrap:wrap"><button class="mini" id="rgAOC" title="Crea una orden de cambio enlazada a esta consulta">→ Orden de cambio</button><button class="mini" id="rgAT" title="Crea una tarea de obra enlazada a esta consulta">→ Tarea</button></div>' : '') +
        '<div class="pista" style="margin-top:14px">Creada por ' + esc(quien(r.creado_por)) + ' · ' + fecha(r.creado) + '</div>' + (r.puedoBorrar ? '<button class="mini" id="rgDel" style="margin-top:10px">Suprimir</button>' : '') + '</div></div>';
      const g = (id) => v.querySelector('#' + id), campo = (id, clave, fn) => { const el = g(id); if (el) el.onchange = () => guarda({ [clave]: fn ? fn(el) : el.value }); };
      campo('rgTit', 'titulo'); campo('rgPre', 'pregunta'); campo('rgDes', 'descripcion'); campo('rgPara', 'para'); campo('rgVen', 'vence'); campo('rgDis', 'disciplina'); campo('rgPla', 'plano_id'); campo('rgTar', 'tarea_id'); campo('rgRfi', 'rfi_id'); campo('rgMot', 'motivo'); campo('rgMon', 'monto'); campo('rgDia', 'dias');
      campo('rgIc', 'impactoCosto', el => el.checked); campo('rgIp', 'impactoPlazo', el => el.checked);
      const ponP = (P2) => guarda({ partidas: P2 });
      v.querySelectorAll('[data-pd]').forEach(i => i.onchange = () => { const P2 = partidas.slice(); P2[+i.dataset.pd] = { descripcion: i.value, monto: P2[+i.dataset.pd].monto }; ponP(P2); });
      v.querySelectorAll('[data-pm]').forEach(i => i.onchange = () => { const P2 = partidas.slice(); P2[+i.dataset.pm] = { descripcion: P2[+i.dataset.pm].descripcion, monto: Number(i.value) || 0 }; ponP(P2); });
      v.querySelectorAll('[data-pq]').forEach(a => a.onclick = (e) => { e.preventDefault(); ponP(partidas.filter((_, i) => i !== +a.dataset.pq)); });
      const pn = g('rgPn'), pnm = g('rgPnm'), mete = () => { if (pn.value.trim()) ponP(partidas.concat([{ descripcion: pn.value.trim(), monto: Number(pnm.value) || 0 }])); };
      if (pn) { pn.onkeydown = pnm.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); mete(); } }; }
      v.querySelectorAll('[data-pasa]').forEach(b => b.onclick = async () => { const e = b.dataset.pasa, c = { estado: e };
        if (tipo === 'rfi') { if (g('rgTit')) c.titulo = g('rgTit').value; if (e === 'abierta' && g('rgPre') && !g('rgPre').disabled) c.pregunta = g('rgPre').value; if (e === 'respondida') c.respuesta = g('rgRes').value; }
        else { if (g('rgTit') && !g('rgTit').disabled) c.titulo = g('rgTit').value; if (e === 'aprobada' || e === 'rechazada') { const mot = await N.pide(e === 'aprobada' ? 'Aprobar la orden de cambio' : 'Rechazar la orden de cambio', e === 'aprobada' ? 'Comentario de la aprobación (opcional). Una orden aprobada ya no se modifica.' : 'Motivo del rechazo', '', e === 'aprobada' ? 'Aprobar' : 'Rechazar'); if (mot === null || mot === undefined) return; if (e === 'rechazada' && !String(mot).trim()) return N.toast('Escribe el motivo del rechazo.', 'mal'); c.motivoDecision = mot; } }
        if (await guarda(c)) N.toast(D.una + ' ' + cod() + ': ' + esc(r.estadoTxt.toLowerCase()) + '.', 'bien'); });
      const env = async () => { const t = g('rgMsg').value.trim(); if (!t) return; try { await api(O(pid) + '/registro/' + rid + '/mensaje', { json: { texto: t } }); await trae(); pinta(); const a = g('rgAct'); a.scrollTop = a.scrollHeight; } catch (e) { N.toast(esc(e.message), 'mal'); } };
      g('rgEnv').onclick = env; g('rgMsg').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) env(); };
      const bf = g('rgFoto'); if (bf) { bf.onclick = () => g('rgFile').click(); g('rgFile').onchange = async (e) => { for (const a of e.target.files) { try { await X.subeFoto(O(pid) + '/fotos?parte=' + rid, a); } catch (err) { N.toast(esc(err.message), 'mal'); } } await trae(); pinta(); }; }
      v.querySelectorAll('[data-foto]').forEach(a => a.onclick = (e) => { e.preventDefault(); const f = r.fotos.find(x => x.id === a.dataset.foto); if (f) X.abreFoto(pid, f, ed ? async () => { await trae(); pinta(); } : null); });
      v.querySelectorAll('[data-cierra]').forEach(a => a.onclick = () => cierraV(v));
      const it = g('rgIrT'); if (it) it.onclick = (e) => { e.preventDefault(); X.abreTarea(pid, r.tarea.id, luego); };
      const ir = g('rgIrR'); if (ir) ir.onclick = (e) => { e.preventDefault(); X.abreRegistro(pid, r.rfi.id, luego); };
      g('rgComp').onclick = (e) => { e.stopPropagation(); const u = url(); N.menuFlotante(g('rgComp'), [{ texto: 'Copiar enlace', accion: () => navigator.clipboard.writeText(u).then(() => N.toast('Enlace copiado.', 'bien'), () => N.toast('No se pudo copiar.', 'mal')) }, { texto: 'Enviar por correo', accion: () => { location.href = 'mailto:' + encodeURIComponent(d.para || '') + '?subject=' + encodeURIComponent(D.una + ' ' + cod() + ' · ' + r.titulo) + '&body=' + encodeURIComponent(u); } }, { sep: true }, { texto: 'Exportar como PDF', accion: () => imprime(r, quien) }, { texto: 'Exportar código QR', accion: () => X.qr(u, D.una + ' ' + cod() + ' · ' + (r.titulo || 'Sin título'), ((N.PROY_ACTUAL || {}).codigo || '') + ' · Seguimiento de obra') }]); };
      const oc = g('rgAOC'); if (oc) oc.onclick = async () => { try { const n = await api(O(pid) + '/registros/cambio', { json: { titulo: r.titulo, descripcion: 'Deriva de la consulta ' + cod() + '.\n' + (d.respuesta || d.pregunta || ''), rfi_id: rid, tarea_id: d.tarea_id || '' } }); N.toast('Orden de cambio creada en borrador.', 'bien'); X.abreRegistro(pid, n.id, luego); } catch (e) { N.toast(esc(e.message), 'mal'); } };
      const at = g('rgAT'); if (at) at.onclick = async () => { try { const n = await api(O(pid) + '/tareas', { json: { titulo: r.titulo || cod(), estado: 'p2', plano_id: d.plano_id || '', categoria: d.disciplina || '' } }); await guarda({ tarea_id: n.id }, true); X.abreTarea(pid, n.id, luego, true); } catch (e) { N.toast(esc(e.message), 'mal'); } };
      const del = g('rgDel'); if (del) del.onclick = async () => { if (!confirm('¿Suprimir ' + D.uno + ' ' + cod() + '?')) return; try { await api(O(pid) + '/registro/' + rid, { method: 'DELETE' }); cierraV(v); if (luego) luego(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
      if (nuevo) { nuevo = false; const t = g('rgTit'); if (t) t.focus(); }
    }
    function imprime(r, quien) {
      const d = r.datos, w = window.open('', '_blank'); if (!w) return N.toast('El navegador bloqueó la ventana de impresión.', 'mal');
      const f = (k, val) => val ? '<tr><th>' + k + '</th><td>' + esc(String(val)) + '</td></tr>' : '';
      w.document.write('<title>' + esc(D.una + ' ' + cod()) + '</title><style>body{font:13px Segoe UI,Arial,sans-serif;color:#1f2328;margin:28px}h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}th{width:190px;color:#555;font-weight:600}.n{text-align:right}pre{white-space:pre-wrap;font:inherit;margin:0}</style>' +
        '<div style="color:#666">' + esc(((N.PROY_ACTUAL || {}).codigo || '') + ' · ' + ((N.PROY_ACTUAL || {}).nombre || '')) + ' · Seguimiento de obra</div><h1>' + esc(D.una + ' ' + cod() + ' · ' + (r.titulo || 'Sin título')) + '</h1><div>Estado: <b>' + esc(r.estadoTxt) + '</b></div><h2>Datos</h2><table>' +
        (tipo === 'rfi' ? f('Dirigida a', d.para && quien(d.para)) + f('Responder antes de', d.vence) + f('Disciplina', d.disciplina) + f('Plano', r.plano && r.plano.nombre) + f('Tarea', r.tarea && '#' + r.tarea.numero + ' ' + r.tarea.titulo) + f('Impacto', [d.impactoCosto ? 'en costo' : '', d.impactoPlazo ? 'en plazo' : ''].filter(Boolean).join(', '))
          : f('Motivo', d.motivo) + f('Monto', plata(d.monto, r.moneda)) + f('Días de plazo', d.dias) + f('Decidir antes de', d.vence) + f('Consulta (RFI)', r.rfi && 'RFI-' + String(r.rfi.numero).padStart(3, '0') + ' ' + r.rfi.titulo) + f('Decisión', d.decididaPor && (r.estadoTxt + ' por ' + quien(d.decididaPor) + ' · ' + String(d.decididaFecha || '').slice(0, 10) + (d.motivoDecision ? ' · ' + d.motivoDecision : '')))) +
        f('Creada por', quien(r.creado_por) + ' · ' + String(r.creado || '').slice(0, 10)) + '</table>' +
        (tipo === 'rfi' ? '<h2>Consulta</h2><pre>' + esc(d.pregunta || '') + '</pre><h2>Respuesta' + (d.respondidaPor ? ' · ' + esc(quien(d.respondidaPor)) + ' · ' + esc(String(d.respondidaFecha || '').slice(0, 10)) : '') + '</h2><pre>' + esc(d.respuesta || '(sin respuesta)') + '</pre>'
          : '<h2>Descripción</h2><pre>' + esc(d.descripcion || '') + '</pre>' + ((d.partidas || []).length ? '<h2>Partidas</h2><table>' + d.partidas.map(x => '<tr><td>' + esc(x.descripcion) + '</td><td class="n">' + plata(x.monto, r.moneda) + '</td></tr>').join('') + '<tr><th>Total</th><td class="n"><b>' + plata(d.monto, r.moneda) + '</b></td></tr></table>' : '')) +
        '<h2>Actividad</h2><table>' + r.actividad.map(a => '<tr><th>' + esc(String(a.fecha).slice(0, 16).replace('T', ' ')) + '<br>' + esc(quien(a.autor)) + '</th><td>' + esc(a.texto) + '</td></tr>').join('') + '</table>'); w.document.close(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
    }
    pinta();
  };

  // ── PLANOS DESDE LA NUBE: enlaces compartidos de Dropbox, OneDrive / SharePoint y Box
  X.ventanaNube = async function (p, planos, luego) {
    const pid = p.id, cols = [...new Set(planos.map(x => x.coleccion).filter(Boolean))], cars = [...new Set(planos.map(x => x.carpeta).filter(Boolean))];
    const v = N.ventana('Planos desde la nube', '', { ancho: 780, alto: 620 }); let d = { enlaces: [], carpetaCde: '' };
    const NOM = { dropbox: 'Dropbox', onedrive: 'OneDrive', sharepoint: 'SharePoint', box: 'Box' };
    const pinta = (msg) => {
      v.innerHTML = '<p class="pista" style="margin-top:0">Pega el enlace compartido de un PDF en Dropbox, OneDrive / SharePoint o Box. El archivo se descarga al CDE' + (d.carpetaCde ? ' (carpeta <b>' + esc(d.carpetaCde) + '</b>)' : '') + ' y aparece en Planos. Con «Sincronizar» se vuelve a comprobar cada enlace: si el archivo cambió en la nube, entra como versión nueva del mismo documento.</p>' +
        '<label>Enlace compartido</label><input id="nuUrl" placeholder="https://www.dropbox.com/…  ·  https://1drv.ms/…  ·  https://app.box.com/s/…">' +
        '<div class="fila" style="gap:8px;margin-top:8px"><div style="flex:1"><label>Colección</label><input id="nuCol" list="nuColL" value="' + esc(cols[0] || p.nombre) + '"><datalist id="nuColL">' + cols.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div><div style="flex:1"><label>Carpeta de obra</label><input id="nuCar" list="nuCarL" placeholder="Arquitectura, Estructuras…"><datalist id="nuCarL">' + cars.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div><div style="align-self:flex-end"><button class="primario" id="nuOk">Traer el plano</button></div></div>' +
        '<div class="pista" style="margin-top:6px">El enlace debe ser de <b>un archivo PDF</b> (no de una carpeta) y permitir verlo a «cualquier persona con el enlace». No se piden ni se guardan contraseñas de la nube.</div><div id="nuMsg">' + (msg || '') + '</div>' +
        '<div class="fila" style="align-items:center;margin-top:16px"><h2 style="margin:0;flex:1">Enlaces del proyecto</h2>' + (d.enlaces.length ? '<button id="nuSinc">⟳ Sincronizar ahora</button>' : '') + '</div>' +
        (d.enlaces.length ? '<div class="acctabla" style="margin-top:8px"><table><thead><tr><th>Plano</th><th>Origen</th><th>Última comprobación</th><th></th></tr></thead><tbody>' + d.enlaces.map(e => '<tr><td><b class="mono">' + esc(e.nombre) + '</b>' + (e.error ? '<div style="color:var(--rojo)">' + esc(e.error) + '</div>' : '') + '<div class="pista">' + esc([e.coleccion, e.carpeta].filter(Boolean).join(' / ')) + '</div></td><td>' + esc(NOM[e.proveedor] || e.proveedor) + '<div class="pista" title="' + esc(e.url) + '" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.url) + '</div></td><td class="pista">' + fecha(e.sincronizado) + '<br>' + esc(corto(e.por)) + '</td><td style="white-space:nowrap">' + (e.contenedor_id ? '<a class="boton mini" href="#/p/' + pid + '/obra/plano/' + esc(e.contenedor_id) + '" data-cierra>Abrir</a> ' : '') + '<button class="mini" data-qn="' + e.id + '" title="Dejar de sincronizar (el plano sigue en el CDE)">✕</button></td></tr>').join('') + '</tbody></table></div>' : '<div class="pista" style="margin-top:8px">Todavía no se ha traído ningún plano desde la nube.</div>');
      v.querySelector('#nuOk').onclick = async () => { const u = v.querySelector('#nuUrl').value.trim(), M = v.querySelector('#nuMsg'), b = v.querySelector('#nuOk'); if (!u) return N.toast('Pega el enlace compartido.', 'mal'); b.disabled = true; b.textContent = 'Descargando…'; M.innerHTML = '';
        try { const r = await api(O(pid) + '/nube', { json: { url: u, coleccion: v.querySelector('#nuCol').value, carpeta: v.querySelector('#nuCar').value } }); d = await api(O(pid) + '/nube'); pinta('<div class="aviso verde" style="margin-top:8px">«' + esc(r.nombre) + '» se cargó desde ' + esc(NOM[r.proveedor] || r.proveedor) + ' en ' + esc(r.carpetaCde || '') + '.</div>'); if (luego) luego(); } catch (e) { b.disabled = false; b.textContent = 'Traer el plano'; aviso(M, e); } };
      const s = v.querySelector('#nuSinc'); if (s) s.onclick = async () => { s.disabled = true; s.textContent = 'Sincronizando…'; try { const r = await api(O(pid) + '/nube/sincronizar', { json: {} }); d = await api(O(pid) + '/nube'); pinta('<div class="aviso ' + (r.errores ? 'rojo' : 'verde') + '" style="margin-top:8px">' + r.resultados.length + ' enlace(s) comprobados: ' + r.actualizados + ' con versión nueva, ' + (r.resultados.length - r.actualizados - r.errores) + ' sin cambios' + (r.errores ? ', ' + r.errores + ' con error' : '') + '.</div>'); if (r.actualizados && luego) luego(); } catch (e) { s.disabled = false; s.textContent = '⟳ Sincronizar ahora'; aviso(v.querySelector('#nuMsg'), e); } };
      v.querySelectorAll('[data-qn]').forEach(b => b.onclick = async () => { if (!confirm('¿Dejar de sincronizar este enlace? El plano y sus versiones siguen en el CDE.')) return; try { await api(O(pid) + '/nube/' + b.dataset.qn, { method: 'DELETE' }); d = await api(O(pid) + '/nube'); pinta(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
      v.querySelectorAll('[data-cierra]').forEach(a => a.onclick = () => cierraV(v));
    };
    v.innerHTML = '<div class="pista">Cargando…</div>'; try { d = await api(O(pid) + '/nube'); pinta(); } catch (e) { aviso(v, e); }
  };
})();

/* ───────── RECORRIDO 360: tomas esféricas por visita, ubicadas sobre el plano de cada nivel, y comparación entre visitas ───────── */
(function () {
  const N = CDE.N, { esc, api, fecha, aviso, app } = N, X = N.OBX, O = (pid) => '/api/proyectos/' + pid + '/obra';
  const corto = (e) => String(e || '').split('@')[0], hoy = () => new Date().toISOString().slice(0, 10);
  const cierraV = (v) => { const w = v.closest('.ventana'); if (w) w.remove(); };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const visitaTxt = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? +m[3] + ' ' + MES[+m[2] - 1] + ' ' + m[1] : s; };
  const RC = N.OBRC = N.OBRC || { visita: '', nivel: null, toma: '', mapa: true, tipo: 'piso' };
  const nomToma = (t) => [t.codigo, t.nombre].filter(Boolean).join(' · ') || 'Toma sin nombre';
  /** La toma de `lista` que equivale a `t`: mismo código y nivel; si no, la más cercana en el mismo plano. */
  const pareja = (t, lista) => { if (!t) return null; const mismo = lista.filter(x => x.plano_id === t.plano_id); let p = t.codigo ? mismo.find(x => x.codigo === t.codigo) : null; if (p) return p;
    if (t.x == null) return null; let mejor = null, dm = 0.08; mismo.forEach(x => { if (x.x == null) return; const d = Math.hypot(x.x - t.x, x.y - t.y); if (d < dm) { dm = d; mejor = x; } }); return mejor; };

  const MAPAS = new Map();
  /** La primera hoja del plano del nivel, a buen tamaño para ubicar las tomas. */
  async function mapa(pid, plano, ancho) {
    const k = plano.version_id + ':' + (ancho || 1000); if (MAPAS.has(k)) return MAPAS.get(k);
    const doc = await X.pdfDe(pid, plano.version_id), pg = await doc.getPage(1), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: (ancho || 1000) / v0.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const u = c.toDataURL('image/jpeg', 0.82); MAPAS.set(k, u); if (MAPAS.size > 8) MAPAS.delete(MAPAS.keys().next().value); return u;
  }

  X.vistaRecorrido = async function (p, res) {
    const pid = p.id, [d, dp] = await Promise.all([api(O(pid) + '/recorrido'), api(O(pid) + '/planos')]), planos = dp.planos, PL = Object.fromEntries(planos.map(x => [x.id, x]));
    const recarga = async () => { if (/\/obra\/recorrido/.test(location.hash)) X.vistaRecorrido(p, await api(O(pid) + '/resumen')); };
    if (!d.visitas.some(v => v.fecha === RC.visita)) RC.visita = (d.visitas[0] || {}).fecha || '';
    if (!d.tomas.some(t => t.tipo === RC.tipo)) RC.tipo = d.tomas.length && !d.tomas.some(t => t.tipo !== 'aerea') ? 'aerea' : 'piso';   // en piso (recorrido a pie) o aéreas (dron)
    const delTipo = d.tomas.filter(t => t.tipo === RC.tipo), deVisita = delTipo.filter(t => t.visita === RC.visita), nTipo = (k) => d.tomas.filter(t => t.visita === RC.visita && t.tipo === k).length;
    const niveles = [...new Set(delTipo.map(t => t.plano_id))].sort((a, b) => ((PL[a] || {}).nombre || 'zzz').localeCompare((PL[b] || {}).nombre || 'zzz'));
    if (RC.nivel === null || !niveles.includes(RC.nivel)) RC.nivel = (deVisita[0] || {}).plano_id !== undefined ? deVisita[0].plano_id : (niveles[0] !== undefined ? niveles[0] : '');
    const delNivel = deVisita.filter(t => t.plano_id === RC.nivel);
    let actual = delNivel.find(t => t.id === RC.toma) || delNivel[0] || null; RC.toma = actual ? actual.id : '';
    const nomNivel = (id) => id ? ((PL[id] || {}).nombre || 'Plano retirado') : 'Sin plano';
    const acciones = (d.puedoEditar ? '<button class="primario" id="rcNueva">+ Nueva toma 360</button> ' : '') + (d.visitas.length > 1 ? '<button id="rcComp" title="Dos visitas lado a lado, girando a la vez">◫ Comparar visitas</button> ' : '') + (actual ? '<button id="rcBim" title="La toma a un lado y el modelo BIM del CDE al otro">◧ Foto y modelo</button> ' : '') + (d.puedoEditar && delNivel.length && RC.nivel && PL[RC.nivel] ? '<button id="rcUbi" title="Ubicar de corrido las tomas de este nivel sobre el plano">⌖ Ubicar en el plano</button> ' : '') + (d.tomas.length ? '<button id="rcEst">Estado</button> <button id="rcReg">Registro</button> ' : '') + '<button id="rcAyuda">Ayuda</button>';
    if (!d.tomas.length) {
      app.innerHTML = X.cabecera(p, 'recorrido', res, acciones) + '<div class="tarjeta"><div class="intro-vacio">' + N.ICO.obra + '<div><b>Aún no hay tomas 360.</b><br>Sube las fotos esféricas de cada visita a obra (las que entrega una cámara 360, en proporción 2:1) y ubícalas sobre el plano del nivel. Después se recorre la obra punto por punto y se comparan dos visitas lado a lado para ver el avance.' + (d.puedoEditar ? '<br><br><button class="primario" id="rcNueva2">+ Nueva toma 360</button>' : '') + '</div></div></div>' + N.cierra();
    } else {
      app.innerHTML = X.cabecera(p, 'recorrido', res, acciones) + '<div class="obrec"><aside class="obrlado"><label>Visita</label><select id="rcVis">' + d.visitas.map(v => '<option value="' + v.fecha + '"' + (v.fecha === RC.visita ? ' selected' : '') + '>' + visitaTxt(v.fecha) + ' · ' + v.tomas + ' toma(s)</option>').join('') + '</select>' +
        '<div class="obrtipo"><button data-tipo="piso" class="' + (RC.tipo === 'piso' ? 'activa' : '') + '" title="Tomas del recorrido a pie">En piso <b>' + nTipo('piso') + '</b></button><button data-tipo="aerea" class="' + (RC.tipo === 'aerea' ? 'activa' : '') + '" title="Vistas aéreas tomadas con dron">Aéreas <b>' + nTipo('aerea') + '</b></button></div>' +
        '<h3>' + (RC.tipo === 'aerea' ? 'Planos de conjunto' : 'Niveles') + '</h3><div class="obrniv">' + niveles.map(n => { const c = deVisita.filter(t => t.plano_id === n).length; return '<button data-niv="' + esc(n) + '" class="' + (n === RC.nivel ? 'activa' : '') + (c ? '' : ' vacio') + '" title="' + esc(nomNivel(n)) + '"><span>' + esc(nomNivel(n)) + '</span><b>' + c + '</b></button>'; }).join('') + '</div>' +
        '<h3>Ambientes <span class="pista">' + delNivel.length + '</span></h3><div class="obramb">' + (delNivel.map(t => '<button data-toma="' + t.id + '" class="' + (actual && t.id === actual.id ? 'activa' : '') + '" title="' + esc(nomToma(t)) + '">' + esc(t.codigo || t.nombre || 'Toma') + '</button>').join('') || '<span class="pista">Este nivel no tiene tomas en la visita elegida.</span>') + '</div></aside>' +
        '<div class="obrvis"><div class="obrtit"><b id="rcTit">' + (actual ? esc(nomToma(actual)) : 'Sin toma') + '</b><span class="pista">' + esc(nomNivel(RC.nivel)) + ' · visita del ' + visitaTxt(RC.visita) + (actual ? ' · ' + esc(corto(actual.autor)) : '') + '</span><span class="crece"></span>' +
        (actual ? '<button class="mini" id="rcAnt" title="Toma anterior">‹</button><span class="pista" id="rcCnt">' + (delNivel.indexOf(actual) + 1) + ' / ' + delNivel.length + '</span><button class="mini" id="rcSig" title="Toma siguiente">›</button><label class="rvchk" style="margin:0"><input type="checkbox" id="rcMapa"' + (RC.mapa ? ' checked' : '') + '> plano</label>' + (d.puedoEditar ? '<button class="mini" id="rcEdit">Editar</button>' : '') + '<a class="boton mini" href="' + X.urlFoto(pid, actual.foto_id) + '?descargar=1" title="Descargar la foto 360">Descargar</a>' : '') + '</div>' +
        '<div class="obrlienzo"><div id="rcVisor" class="obrvisor">' + (actual ? '' : '<div class="pista" style="color:#cbd5e1;padding:30px">Elige un nivel con tomas o cambia de visita.</div>') + '</div>' + (actual && RC.nivel && PL[RC.nivel] ? '<div class="obrmini' + (RC.mapa ? '' : ' oculto') + '" id="rcMini"><div class="obrmapa" id="rcMapaC"><span class="pista">Cargando el plano…</span></div></div>' : '') + '</div></div></div>' + N.cierra();
    }
    const on = (i, fn) => { const el = document.getElementById(i); if (el) el.onclick = fn; };
    on('rcNueva', () => ventanaToma(p, planos, d, null, recarga)); on('rcNueva2', () => ventanaToma(p, planos, d, null, recarga));
    on('rcAyuda', () => N.ventana('Recorrido 360', '<ol class="obrayuda"><li><b>Visita.</b> Cada fecha en que se recorrió la obra con la cámara 360. El selector cambia toda la pantalla a esa visita.</li><li><b>Niveles.</b> Son los planos sobre los que hay tomas. El número es cuántas tomas tiene ese nivel en la visita elegida.</li><li><b>Ambientes.</b> Cada botón es una toma; conviene ponerle el código del ambiente (por ejemplo «A-101») y usar el mismo código en todas las visitas.</li><li><b>Visor.</b> Arrastra para girar y usa la rueda para acercar. En el plano de la esquina, el punto resaltado es dónde estás; pulsa otro punto para saltar a esa toma.</li><li><b>Comparar visitas.</b> Abre dos visitas lado a lado. Si la toma tiene el mismo código (o está en el mismo sitio del plano) en ambas, se emparejan sola y giran a la vez.</li><li><b>En piso / Aéreas.</b> Separa las tomas del recorrido a pie de las vistas de dron; cada grupo tiene sus planos y sus visitas.</li><li><b>Ubicar en el plano.</b> Marca de corrido dónde va cada toma del nivel, o dibuja la ruta del recorrido y repártelas sobre ella. Una toma con el mismo código que en una visita anterior cae sola en el mismo punto.</li><li><b>Foto y modelo.</b> La toma a un lado y el modelo BIM del CDE al otro.</li><li><b>Estado.</b> Cuántas tomas tiene cada nivel en cada visita, para ver qué falta por recorrer.</li><li><b>Registro.</b> La lista completa de tomas, con quién la subió, para editar o suprimir.</li></ol>', { ancho: 620, alto: 460 }));
    on('rcEst', () => { const v = N.ventana('Estado del recorrido', '<p class="pista" style="margin-top:0">Tomas por nivel en cada visita. Una celda vacía es un nivel que no se recorrió ese día.</p><div class="acctabla"><table><thead><tr><th>Nivel</th>' + d.visitas.map(x => '<th class="num">' + visitaTxt(x.fecha) + '</th>').join('') + '</tr></thead><tbody>' + niveles.map(n => '<tr><td><b>' + esc(nomNivel(n)) + '</b></td>' + d.visitas.map(x => { const c = d.tomas.filter(t => t.visita === x.fecha && t.plano_id === n).length; return '<td class="num">' + (c ? '<a href="#" data-ev="' + x.fecha + '" data-en="' + esc(n) + '">' + c + '</a>' : '<span class="pista">—</span>') + '</td>'; }).join('') + '</tr>').join('') + '</tbody><tfoot><tr><th>Total</th>' + d.visitas.map(x => '<th class="num">' + x.tomas + '</th>').join('') + '</tr></tfoot></table></div>', { ancho: 760, alto: 460 });
      v.querySelectorAll('[data-ev]').forEach(a => a.onclick = (e) => { e.preventDefault(); RC.visita = a.dataset.ev; RC.nivel = a.dataset.en; RC.toma = ''; cierraV(v); recarga(); }); });
    on('rcReg', () => { const v = N.ventana('Registro de tomas 360', '<div class="acctabla"><table><thead><tr><th>Visita</th><th>Nivel</th><th>Código</th><th>Ambiente</th><th>Subida por</th><th>Fecha</th><th></th></tr></thead><tbody>' + d.tomas.map(t => '<tr><td>' + visitaTxt(t.visita) + '</td><td>' + esc(nomNivel(t.plano_id)) + '</td><td class="mono">' + esc(t.codigo) + '</td><td>' + esc(t.nombre) + '</td><td>' + esc(corto(t.autor)) + '</td><td class="pista">' + fecha(t.fecha) + '</td><td style="white-space:nowrap"><button class="mini" data-ver="' + t.id + '">Ver</button>' + (d.puedoEditar ? ' <button class="mini" data-ed="' + t.id + '">Editar</button> <button class="mini" data-del="' + t.id + '">✕</button>' : '') + '</td></tr>').join('') + '</tbody></table></div><div class="fila" style="justify-content:flex-end;margin-top:10px"><button id="rgXls">Descargar en Excel</button></div>', { ancho: 900, alto: 560 });
      const T = (id) => d.tomas.find(t => t.id === id);
      v.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const t = T(b.dataset.ver); RC.visita = t.visita; RC.nivel = t.plano_id; RC.toma = t.id; cierraV(v); recarga(); });
      v.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { cierraV(v); ventanaToma(p, planos, d, T(b.dataset.ed), recarga); });
      v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('¿Suprimir esta toma 360?')) return; try { await api(O(pid) + '/recorrido/' + b.dataset.del, { method: 'DELETE' }); cierraV(v); recarga(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
      v.querySelector('#rgXls').onclick = async () => { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Visita', 'Nivel', 'Código', 'Ambiente', 'Subida por', 'Fecha']].concat(d.tomas.map(t => [t.visita, nomNivel(t.plano_id), t.codigo, t.nombre, t.autor, String(t.fecha).slice(0, 16).replace('T', ' ')]))), 'Tomas 360'); XL.writeFile(wb, 'recorrido-360-' + p.codigo + '-' + hoy() + '.xlsx'); }; });
    on('rcComp', () => comparar(p, d, PL, actual));
    on('rcUbi', () => ubicar(p, PL[RC.nivel], delNivel, recarga)); on('rcBim', () => fotoYModelo(p, PL, delNivel, actual));
    if (!d.tomas.length) return;
    app.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { if (!d.tomas.some(t => t.tipo === b.dataset.tipo)) return N.toast(b.dataset.tipo === 'aerea' ? 'Aún no hay vistas aéreas: súbelas con «+ Nueva toma 360» eligiendo el tipo «Aérea (dron)».' : 'Aún no hay tomas en piso.', 'mal'); RC.tipo = b.dataset.tipo; RC.nivel = null; RC.toma = ''; recarga(); });
    if (RC.ubicar && document.getElementById('rcUbi')) { RC.ubicar = false; document.getElementById('rcUbi').click(); } RC.ubicar = false;
    document.getElementById('rcVis').onchange = (e) => { RC.visita = e.target.value; RC.toma = ''; const hay = d.tomas.filter(t => t.visita === RC.visita); if (!hay.some(t => t.plano_id === RC.nivel)) RC.nivel = hay.length ? hay[0].plano_id : RC.nivel; recarga(); };
    app.querySelectorAll('[data-niv]').forEach(b => b.onclick = () => { RC.nivel = b.dataset.niv; RC.toma = ''; recarga(); });
    if (!actual) return;
    const visor = await X.visorToma(document.getElementById('rcVisor'), pid, actual).catch(() => null);
    const pintaPuntos = () => { const c = document.getElementById('rcMapaC'); if (!c) return; c.querySelectorAll('.obrpto').forEach(x => x.remove());
      delNivel.filter(t => t.x != null).forEach(t => { const b = document.createElement('button'); b.className = 'obrpto' + (t.id === actual.id ? ' activa' : ''); b.style.left = (t.x * 100) + '%'; b.style.top = (t.y * 100) + '%'; b.title = nomToma(t); b.textContent = delNivel.indexOf(t) + 1; b.onclick = (e) => { e.stopPropagation(); ir(t); }; c.appendChild(b); }); };
    const ir = async (t) => { if (!t || t.id === actual.id) return; if ((t.es360 === 0) !== (actual.es360 === 0)) { RC.toma = t.id; return recarga(); } actual = t; RC.toma = t.id; document.getElementById('rcTit').textContent = nomToma(t); app.querySelectorAll('[data-toma]').forEach(b => b.classList.toggle('activa', b.dataset.toma === t.id)); pintaPuntos();
      const cnt = document.getElementById('rcCnt'); if (cnt) cnt.textContent = (delNivel.indexOf(t) + 1) + ' / ' + delNivel.length;
      const dl = app.querySelector('.obrtit a.boton'); if (dl) dl.href = X.urlFoto(pid, t.foto_id) + '?descargar=1'; if (visor) await visor.carga(X.urlFoto(pid, t.foto_id)); };
    app.querySelectorAll('[data-toma]').forEach(b => b.onclick = () => ir(delNivel.find(t => t.id === b.dataset.toma)));
    on('rcAnt', () => ir(delNivel[(delNivel.indexOf(actual) - 1 + delNivel.length) % delNivel.length])); on('rcSig', () => ir(delNivel[(delNivel.indexOf(actual) + 1) % delNivel.length]));
    on('rcEdit', () => ventanaToma(p, planos, d, actual, recarga));
    const chk = document.getElementById('rcMapa'); if (chk) chk.onchange = () => { RC.mapa = chk.checked; const m = document.getElementById('rcMini'); if (m) m.classList.toggle('oculto', !RC.mapa); };
    const mc = document.getElementById('rcMapaC'); if (mc) { try { const u = await mapa(pid, PL[RC.nivel]); if (document.body.contains(mc)) { mc.innerHTML = '<img src="' + u + '" alt="">'; pintaPuntos(); } } catch (e) { mc.innerHTML = '<span class="pista">Sin vista del plano.</span>'; }
      const mini = document.getElementById('rcMini'); mini.ondblclick = () => mini.classList.toggle('grande'); mini.title = 'Doble clic para agrandar o reducir el plano'; }
  };

  /** ¿La foto no es esférica? Las de una cámara 360 vienen en proporción 2:1. */
  const esPlana = (f) => new Promise((ok) => { const im = new Image(), u = URL.createObjectURL(f); im.onload = () => { URL.revokeObjectURL(u); const r = im.naturalWidth / (im.naturalHeight || 1); ok(r < 1.9 || r > 2.1); }; im.onerror = () => { URL.revokeObjectURL(u); ok(false); }; im.src = u; });

  /** Ubicar de corrido: se marca en el plano dónde va cada toma, una tras otra, o se dibuja la ruta del recorrido y las tomas se reparten sobre ella. */
  async function ubicar(p, plano, lista, luego) {
    const pid = p.id, pos = new Map(lista.filter(t => t.x != null).map(t => [t.id, [t.x, t.y]])), antes = new Map(pos), ruta = []; let sel = (lista.find(t => !pos.has(t.id)) || lista[0]).id, modo = 'punto';
    const v = N.ventana('Ubicar las tomas en el plano', '<div class="obrform"><div class="obrfizq"><div class="obrtipo"><button data-m="punto" class="activa" title="Cada clic en el plano ubica la toma elegida y pasa a la siguiente">Punto a punto</button><button data-m="ruta" title="Dibuja el camino recorrido; las tomas se reparten sobre él en orden">Sobre una ruta</button></div><div class="pista" id="ubP" style="margin:8px 0"></div><div class="obrubl" id="ubL"></div>' +
      '<div class="fila" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button id="ubRep" class="oculto">Repartir sobre la ruta</button><button id="ubBor" class="oculto">Borrar ruta</button><span class="crece"></span><button class="primario" id="ubOk">Guardar</button></div></div><div class="obrfder"><div class="obrmapa grande libre" id="ubM"><span class="pista">Cargando el plano…</span></div></div></div>', { ancho: 1180, alto: 700 });
    const g = (i) => v.querySelector('#' + i), M = g('ubM');
    const pinta = () => { g('ubP').textContent = modo === 'punto' ? 'Elige una toma y haz clic en el plano donde se tomó. Pasa sola a la siguiente sin ubicar.' : 'Haz clic en el plano para dibujar el camino del recorrido (' + ruta.length + ' punto(s)) y pulsa «Repartir sobre la ruta».';
      g('ubL').innerHTML = lista.map((t, i) => '<button data-t="' + t.id + '" class="' + (t.id === sel ? 'activa' : '') + '"><b>' + (i + 1) + '</b><span>' + esc(nomToma(t)) + '</span><i>' + (pos.has(t.id) ? 'ubicada' : 'sin ubicar') + '</i></button>').join('');
      g('ubL').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { sel = b.dataset.t; pinta(); });
      g('ubRep').classList.toggle('oculto', modo !== 'ruta'); g('ubBor').classList.toggle('oculto', modo !== 'ruta');
      const H = M.querySelector('.obrhoja'); if (!H) return; H.querySelectorAll('.obrpto, svg').forEach(x => x.remove());
      if (ruta.length) { H.insertAdjacentHTML('beforeend', '<svg class="obrruta" viewBox="0 0 1 1" preserveAspectRatio="none"><polyline points="' + ruta.map(q => q[0] + ',' + q[1]).join(' ') + '" vector-effect="non-scaling-stroke"/></svg>'); }
      lista.forEach((t, i) => { const q = pos.get(t.id); if (!q) return; const b = document.createElement('span'); b.className = 'obrpto' + (t.id === sel ? ' activa' : ''); b.style.left = (q[0] * 100) + '%'; b.style.top = (q[1] * 100) + '%'; b.textContent = i + 1; b.title = nomToma(t); H.appendChild(b); }); };
    v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { modo = b.dataset.m; v.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('activa', x === b)); pinta(); });
    M.onclick = (e) => { const im = M.querySelector('img'); if (!im) return; const r = im.getBoundingClientRect(), q = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
      if (modo === 'ruta') ruta.push(q); else { pos.set(sel, q); const i = lista.findIndex(t => t.id === sel), sig = lista.slice(i + 1).concat(lista.slice(0, i)).find(t => !pos.has(t.id)); if (sig) sel = sig.id; } pinta(); };
    g('ubBor').onclick = () => { ruta.length = 0; pinta(); };
    g('ubRep').onclick = () => { if (ruta.length < 2) return N.toast('Dibuja la ruta con al menos dos puntos.', 'mal'); const pend = lista.filter(t => !pos.has(t.id)), T = pend.length ? pend : lista;
      const tr = []; let largo = 0; for (let i = 1; i < ruta.length; i++) { const l = Math.hypot(ruta[i][0] - ruta[i - 1][0], ruta[i][1] - ruta[i - 1][1]); tr.push(l); largo += l; }
      T.forEach((t, k) => { let s = (T.length === 1 ? 0.5 : k / (T.length - 1)) * largo, i = 0; while (i < tr.length - 1 && s > tr[i]) { s -= tr[i]; i++; } const f = tr[i] ? Math.min(1, s / tr[i]) : 0; pos.set(t.id, [ruta[i][0] + (ruta[i + 1][0] - ruta[i][0]) * f, ruta[i][1] + (ruta[i + 1][1] - ruta[i][1]) * f]); });
      N.toast(T.length + ' toma(s) repartidas sobre la ruta. Corrige la que haga falta con «Punto a punto».', 'bien'); pinta(); };
    g('ubOk').onclick = async () => { const b = g('ubOk'); b.disabled = true; let n = 0; try { for (const t of lista) { const q = pos.get(t.id), a = antes.get(t.id); if (!q || (a && a[0] === q[0] && a[1] === q[1])) continue; await api(O(pid) + '/recorrido/' + t.id, { method: 'PUT', json: { x: q[0], y: q[1] } }); n++; } cierraV(v); N.toast(n + ' toma(s) ubicadas.', 'bien'); luego(); } catch (e) { b.disabled = false; N.toast(esc(e.message), 'mal'); } };
    pinta(); try { const u = await mapa(pid, plano, 1500); M.innerHTML = '<div class="obrhoja"><img src="' + u + '" alt="" draggable="false"></div>'; pinta(); } catch (e) { M.innerHTML = '<span class="pista">No se pudo abrir el plano.</span>'; }
  }

  /** La toma a un lado y el Visor GIS/BIM del CDE al otro, para contrastar lo construido con el modelo. */
  async function fotoYModelo(p, PL, lista, desde) {
    const pid = p.id; let t = desde;
    const v = N.ventana('Foto y modelo', '<div class="obrcmp"><div class="obrcbar"><button class="mini" id="fmA" title="Toma anterior">‹</button><select id="fmT">' + lista.map(x => '<option value="' + x.id + '"' + (x.id === t.id ? ' selected' : '') + '>' + esc(nomToma(x)) + '</option>').join('') + '</select><button class="mini" id="fmS" title="Toma siguiente">›</button><span class="crece"></span><span class="pista">A la derecha, elige el modelo y lleva la cámara al mismo ambiente.</span></div>' +
      '<div class="obrcdos"><div class="obrclado"><div class="obrctit"><b>Obra</b><span class="pista" id="fmN"></span></div><div class="obrvisor" id="fmV"></div></div><div class="obrclado"><div class="obrctit"><b>Modelo BIM</b><span class="crece"></span><a class="boton mini" href="visor.html?pid=' + encodeURIComponent(pid) + '" target="_blank" rel="noopener">Abrir aparte</a></div><iframe class="obrmodelo" src="visor.html?pid=' + encodeURIComponent(pid) + '" title="Visor GIS/BIM"></iframe></div></div></div>', { ancho: Math.min(1500, innerWidth - 40), alto: Math.min(800, innerHeight - 40) });
    const g = (i) => v.querySelector('#' + i); let V = null;
    const pon = async () => { g('fmT').value = t.id; g('fmN').textContent = ((PL[t.plano_id] || {}).nombre || 'Sin plano') + ' · visita del ' + visitaTxt(t.visita); if (V && !!V.plano === (t.es360 === 0)) return V.carga(X.urlFoto(pid, t.foto_id)); if (V) V.dispone(); V = await X.visorToma(g('fmV'), pid, t).catch(() => null); };
    g('fmT').onchange = (e) => { t = lista.find(x => x.id === e.target.value); pon(); };
    g('fmA').onclick = () => { t = lista[(lista.indexOf(t) - 1 + lista.length) % lista.length]; pon(); }; g('fmS').onclick = () => { t = lista[(lista.indexOf(t) + 1) % lista.length]; pon(); };
    pon();
  }

  /** Alta o edición de una toma: foto, visita, nivel, código, ambiente y su punto en el plano. */
  function ventanaToma(p, planos, d, toma, luego) {
    const pid = p.id, niveles = planos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)), codigos = [...new Set(d.tomas.map(t => t.codigo).filter(Boolean))];
    const v = N.ventana(toma ? 'Editar toma 360' : 'Nueva toma 360', '<div class="obrform"><div class="obrfizq">' +
      (toma ? '' : '<label>Fotos 360 (equirectangulares, 2:1)</label><input type="file" id="tmF" accept="image/jpeg,image/png,image/webp" multiple><div class="pista" id="tmFi" style="margin:2px 0 8px">Puedes elegir varias: quedan en la misma visita y nivel, y luego las ubicas de corrido sobre el plano. Una foto que no sea esférica (la de un dron, por ejemplo) se muestra extendida.</div>') +
      '<label>Tipo de toma</label><select id="tmT"><option value="piso">En piso (recorrido a pie)</option><option value="aerea"' + ((toma ? toma.tipo : RC.tipo) === 'aerea' ? ' selected' : '') + '>Aérea (dron)</option></select>' +
      '<label>Visita (fecha del recorrido)</label><input type="date" id="tmV" value="' + esc(toma ? toma.visita : hoy()) + '">' +
      '<label>Nivel (plano)</label><select id="tmN"><option value="">(sin plano)</option>' + niveles.map(x => '<option value="' + esc(x.id) + '"' + ((toma ? toma.plano_id : RC.nivel) === x.id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('') + '</select>' + (niveles.length ? '' : '<div class="pista">Añade antes los planos de cada nivel en la pestaña Planos para poder ubicar las tomas.</div>') +
      '<label>Código del ambiente</label><input id="tmC" list="tmCL" placeholder="A-101" value="' + esc(toma ? toma.codigo : '') + '"><datalist id="tmCL">' + codigos.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist><label>Ambiente</label><input id="tmNom" placeholder="Sala de espera" value="' + esc(toma ? toma.nombre : '') + '">' +
      '<div id="tmMsg"></div><div class="fila" style="gap:8px;margin-top:12px">' + (toma ? '<button id="tmDel">Suprimir</button>' : '') + '<span class="crece"></span><button class="primario" id="tmOk">' + (toma ? 'Guardar' : 'Subir') + '</button></div></div>' +
      '<div class="obrfder"><label>Ubicación en el plano <span class="pista" id="tmPos"></span></label><div class="obrmapa grande" id="tmMapa"><span class="pista">Elige el nivel para marcar dónde se tomó la foto.</span></div></div></div>', { ancho: 940, alto: 620 });
    let pos = toma && toma.x != null ? [toma.x, toma.y] : null;
    const g = (i) => v.querySelector('#' + i), M = g('tmMapa');
    const pintaPos = () => { M.querySelectorAll('.obrpto').forEach(x => x.remove()); g('tmPos').textContent = pos ? '· marcada' : '· haz clic en el plano'; if (!pos || !M.querySelector('img')) return; const b = document.createElement('span'); b.className = 'obrpto activa'; b.style.left = (pos[0] * 100) + '%'; b.style.top = (pos[1] * 100) + '%'; M.appendChild(b); };
    const cargaMapa = async () => { const pl = planos.find(x => x.id === g('tmN').value); if (!pl) { M.innerHTML = '<span class="pista">Sin plano: la toma queda en «Sin plano» y no se ubica.</span>'; g('tmPos').textContent = ''; return; }
      M.innerHTML = '<span class="pista">Cargando el plano…</span>'; try { const u = await mapa(pid, pl); M.innerHTML = '<img src="' + u + '" alt="" draggable="false">'; pintaPos(); } catch (e) { M.innerHTML = '<span class="pista">No se pudo abrir el plano.</span>'; } };
    M.onclick = (e) => { const im = M.querySelector('img'); if (!im) return; const r = im.getBoundingClientRect(); pos = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; pintaPos(); };
    g('tmN').onchange = () => { pos = null; cargaMapa(); }; cargaMapa();
    const del = g('tmDel'); if (del) del.onclick = async () => { if (!confirm('¿Suprimir esta toma 360?')) return; try { await api(O(pid) + '/recorrido/' + toma.id, { method: 'DELETE' }); cierraV(v); luego(); } catch (e) { aviso(g('tmMsg'), e); } };
    g('tmOk').onclick = async () => {
      const visita = g('tmV').value, plano = g('tmN').value, codigo = g('tmC').value.trim(), nombre = g('tmNom').value.trim(), b = g('tmOk');
      try {
        const tipo = g('tmT').value;
        if (toma) { const c = { visita, plano_id: plano, codigo, nombre, tipo }; if (pos) { c.x = pos[0]; c.y = pos[1]; } await api(O(pid) + '/recorrido/' + toma.id, { method: 'PUT', json: c }); RC.visita = visita; RC.nivel = plano; RC.toma = toma.id; cierraV(v); return luego(); }
        const F = [...g('tmF').files]; if (!F.length) return N.toast('Elige al menos una foto 360.', 'mal'); b.disabled = true; let ultimo = '';
        for (let i = 0; i < F.length; i++) { b.textContent = 'Subiendo ' + (i + 1) + ' de ' + F.length + '…'; const pl = await esPlana(F[i]), qs = new URLSearchParams({ visita, plano, tipo, codigo: F.length > 1 && codigo ? codigo + '-' + (i + 1) : codigo, nombre: nombre || F[i].name.replace(/\.[^.]+$/, '') }); if (pos && i === 0) { qs.set('x', pos[0]); qs.set('y', pos[1]); }
          ultimo = (await X.subeFoto(O(pid) + '/recorrido?' + qs.toString() + (pl ? '&plana=1&es360=0' : '&es360=1'), F[i])).id; }
        RC.visita = visita; RC.nivel = plano; RC.toma = ultimo; RC.tipo = tipo; RC.ubicar = F.length > 1 && !!plano; cierraV(v); N.toast(F.length + ' toma(s) subidas.' + (RC.ubicar ? ' Ahora ubícalas sobre el plano.' : ''), 'bien'); luego();
      } catch (e) { b.disabled = false; b.textContent = toma ? 'Guardar' : 'Subir'; aviso(g('tmMsg'), e); }
    };
  }

  /** Dos visitas lado a lado. La toma de la derecha es la pareja de la izquierda, y ambas giran a la vez. */
  async function comparar(p, d, PL, desde) {
    const pid = p.id, vis = d.visitas.map(x => x.fecha), E = { a: desde ? desde.visita : vis[0], b: '', toma: desde || null, sinc: true };
    E.b = vis.find(x => x !== E.a) || E.a;
    const v = N.ventana('Comparar visitas', '<div class="obrcmp"><div class="obrcbar"><label>Toma</label><select id="cmT"></select><label class="rvchk" style="margin:0"><input type="checkbox" id="cmS" checked> girar a la vez</label><span class="crece"></span><span class="pista">Arrastra para girar · rueda para acercar</span></div>' +
      '<div class="obrcdos"><div class="obrclado"><div class="obrctit"><select id="cmA">' + vis.map(x => '<option value="' + x + '">' + visitaTxt(x) + '</option>').join('') + '</select><span id="cmAn" class="pista"></span></div><div class="obrvisor" id="cmVa"></div></div><div class="obrclado"><div class="obrctit"><select id="cmB">' + vis.map(x => '<option value="' + x + '">' + visitaTxt(x) + '</option>').join('') + '</select><span id="cmBn" class="pista"></span></div><div class="obrvisor" id="cmVb"></div></div></div></div>', { ancho: Math.min(1400, innerWidth - 60), alto: Math.min(760, innerHeight - 60) });
    const g = (i) => v.querySelector('#' + i); g('cmA').value = E.a; g('cmB').value = E.b;
    const V = { a: null, b: null }; let quieto = false;
    const monta = async (lado, t) => { const c = g(lado === 'a' ? 'cmVa' : 'cmVb'), n = g(lado === 'a' ? 'cmAn' : 'cmBn'); n.textContent = t ? nomToma(t) + ' · ' + ((PL[t.plano_id] || {}).nombre || 'Sin plano') : '';
      if (!t) { if (V[lado]) { V[lado].dispone(); V[lado] = null; } c.classList.remove('ob360v'); c.innerHTML = '<div class="pista" style="color:#cbd5e1;padding:30px;text-align:center">Esta visita no tiene una toma equivalente<br>(mismo código, o mismo punto del plano).</div>'; return; }
      const u = X.urlFoto(pid, t.foto_id); if (V[lado] && !!V[lado].plano !== (t.es360 === 0)) { V[lado].dispone(); V[lado] = null; } if (V[lado]) return V[lado].carga(u);
      if (t.es360 === 0) { V[lado] = await X.visorPlano(c, u); return; }
      const otro = lado === 'a' ? 'b' : 'a'; V[lado] = await X.visor360(c, u, { alMover: (m) => { if (quieto || !E.sinc || !V[otro]) return; quieto = true; V[otro].fija(m.yaw, m.pitch, m.fov); quieto = false; } }).catch(() => null);
      if (V[lado] && V[otro] && E.sinc) { const m = V[otro].mira(); V[lado].fija(m.yaw, m.pitch, m.fov); } };
    const pinta = async () => { const LA = d.tomas.filter(t => t.visita === E.a), LB = d.tomas.filter(t => t.visita === E.b);
      if (!E.toma || E.toma.visita !== E.a) E.toma = pareja(E.toma, LA) || LA[0] || null;
      g('cmT').innerHTML = LA.map(t => '<option value="' + t.id + '"' + (E.toma && t.id === E.toma.id ? ' selected' : '') + '>' + esc(((PL[t.plano_id] || {}).nombre || 'Sin plano') + ' · ' + nomToma(t)) + (pareja(t, LB) ? '' : '  (solo en esta visita)') + '</option>').join('');
      await monta('a', E.toma); await monta('b', E.a === E.b ? E.toma : pareja(E.toma, LB)); };
    g('cmA').onchange = (e) => { E.a = e.target.value; pinta(); }; g('cmB').onchange = (e) => { E.b = e.target.value; pinta(); };
    g('cmT').onchange = (e) => { E.toma = d.tomas.find(t => t.id === e.target.value); pinta(); };
    g('cmS').onchange = (e) => { E.sinc = e.target.checked; if (E.sinc && V.a && V.b) { const m = V.a.mira(); V.b.fija(m.yaw, m.pitch, m.fov); } };
    pinta();
  }
})();
