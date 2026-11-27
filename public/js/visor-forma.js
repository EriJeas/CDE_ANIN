/*
 * VISOR DE AUTODESK FORMA (v0.28.0) · visor-forma.html?pid=&vid=
 *
 * El modelo lo DIBUJA el visualizador de Autodesk con la traducción que Forma ya tiene del archivo (forma-lienzo.html, en un marco
 * aparte): la geometría es la de Forma, completa, sin armar ni aligerar nada en el CDE. Encima van las funciones del visor del CDE,
 * que trabajan con el ÍNDICE DE PARÁMETROS del CDE (las mismas rutas /api/modelos/... que usa visor.js).
 *
 * Regla del proyecto: no reimplementar lo que ya funciona. Por eso:
 *   - los filtros, el resumen y la ficha del elemento son los de visor.js (misma lógica, mismas rutas), cambiando solo a quién se le
 *     pide dibujar: aquí manda sobre el visualizador de Autodesk (aislar / ocultar / colorear / seleccionar / encuadrar);
 *   - Inventario y Planos (PDF) son los de visor-modulos.js, tal cual;
 *   - Filtro con sectores, Tablero (métricas BIM), COBie / Uniclass y Modelos / Planos son los del Visor BIM Federado, tal cual,
 *     por visor-puente.js (que solo necesita el objeto V de abajo).
 * Aún solo en el Visor GIS/BIM (necesitan la geometría propia del CDE): Niveles / Ambientes, Conjuntos e interferencias, Comparar
 * versiones, Flujos hospitalarios e Incidencias.
 *
 * LOS IDS. El índice usa los ids de la base de propiedades de Autodesk (SVF); el visualizador, los de SVF2. forma-lienzo.js trae la
 * correspondencia de Autodesk y aquí se comprueba con los nombres contra el índice (ruta visor-ids) antes de vincular nada: si no
 * coinciden, el modelo se ve, pero las funciones del CDE no se activan (no se muestran datos cruzados).
 */
(function () {
  'use strict';
  const { esc, api, num, ventana, barras } = CDE;
  const Q = new URLSearchParams(location.search), PID = Q.get('pid') || '';
  let VID = Q.get('vid') || '';
  const F = '/api/proyectos/' + encodeURIComponent(PID) + '/forma';
  const $ = (id) => document.getElementById(id);
  const f3 = (n) => (Math.round(n * 1000) / 1000).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const DIMS = { modelo: 'Modelo', cat: 'Categoría', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' };
  const srgbLin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const linSrgb = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const COLOR_SEL = [0.78, 0.63, 0.29];
  const duerme = (ms) => new Promise((ok) => setTimeout(ok, ms));

  // ---------- estado ----------
  let LZ = null;       // window.LIENZO del marco (visualizador de Autodesk)
  let I = null;        // correspondencia de ids { v1, v2 }
  let G = null;        // { elem: [{ e }], porE, nElem }: los elementos del índice (sin geometría propia: la dibuja Autodesk)
  let EL = null;       // { columnas, diccionarios, idx }
  let BASE = null;     // lo que dejan los filtros / aislar (null = todo)
  let VIS = null;      // BASE menos lo oculto (null = todo)
  let OCULTOS = new Set();
  let SEL = null, SUELTO = null;   // elemento del índice seleccionado · pieza seleccionada sin elemento en el índice
  let LISTA = [], PROY = null, QUIEN = null, INFO = null, VINC = null, FANTASMA = false;
  const idsV = (set) => { const out = []; if (!I) return out; for (const e of set) { const d = I.v2(e); if (d > 0) out.push(d); } return out; };

  // ---------- lista de modelos ----------
  async function cargaLista() {
    const [p, qn] = await Promise.all([api('/api/proyectos/' + PID), api('/api/acceso/quien').catch(() => null)]);
    PROY = p; QUIEN = qn;
    $('proyectoNombre').textContent = (p.codigo ? p.codigo + ' · ' : '') + (p.nombre || PID); $('proyectoNombre').title = $('proyectoNombre').textContent;
    if (qn) $('quien').innerHTML = '<span class="av">' + esc((qn.nombre || qn.email || '?').slice(0, 2).toUpperCase()) + '</span><span>' + esc(qn.nombre || qn.email) + '</span>';
    const d = await api(F + '/modelos');
    LISTA = d.modelos.map(m => ({ vid: m.vid, cid: m.cid, contenedor: m.nombre, carpeta: m.carpeta, n: m.n, revision: '', estado: '', archivo: m.archivo, indice: m.estadoIndice === 'listo', vigente: m.vigente }));
    const extDe = (x) => { const m = /\.[A-Za-z0-9]{2,5}$/.exec(x.archivo || ''); return m && !String(x.contenedor || '').toLowerCase().endsWith(m[0].toLowerCase()) ? m[0].toLowerCase() : ''; };
    const grupos = new Map(); for (const x of LISTA) { if (!grupos.has(x.carpeta)) grupos.set(x.carpeta, []); grupos.get(x.carpeta).push(x); }
    const sel = $('selModelo');
    sel.innerHTML = '<option value="">' + (LISTA.length ? 'Elige un modelo traído de Autodesk Forma…' : 'Este proyecto aún no tiene modelos traídos de Autodesk Forma') + '</option>' + [...grupos].map(([carp, L]) => '<optgroup label="' + esc(carp || 'Archivos de proyecto') + '">' + L.map(x => '<option value="' + x.vid + '"' + (x.vid === VID ? ' selected' : '') + '>' + esc(x.contenedor) + esc(extDe(x)) + ' · v' + x.n + (x.vigente ? '' : ' (anterior)') + ' · ' + (x.indice ? 'índice listo' : 'el índice se prepara al abrirlo') + '</option>').join('') + '</optgroup>').join('');
    sel.onchange = () => { if (sel.value) location.href = 'visor-forma.html?pid=' + encodeURIComponent(PID) + '&vid=' + encodeURIComponent(sel.value); };   // otro modelo = página nueva (el visualizador de Autodesk arranca limpio)
    if (VID) abre().catch(falla); else { $('estadoCarga').innerHTML = LISTA.length ? 'Elige un modelo arriba.' : 'Este proyecto aún no tiene modelos traídos de Autodesk Forma.<br><small>Se traen en Integración con otros CDE → Autodesk Forma.</small>'; abreModulo('filtros'); }
  }
  $('btnVolver').onclick = () => { const x = LISTA.find(l => l.vid === VID); location.href = 'index.html#/p/' + PID + (x ? '/c/' + x.cid : ''); };
  $('btnPropio').onclick = () => window.open('visor.html?pid=' + encodeURIComponent(PID) + (VID ? '&vid=' + encodeURIComponent(VID) : ''), '_blank');
  function falla(e) {
    const caja = $('estadoCarga'); caja.classList.remove('oculto', 'lado');
    const cod = e.codigo || (e.datos && e.datos.error) || '', que = cod === 'forma-sin-conexion' || e.status === 401 ? 'Conecta tu cuenta de Autodesk: en el CDE, Integración con otros CDE → Autodesk Forma → Conectar. Después vuelve a abrir este visor.' : e.message;
    caja.innerHTML = esc(que) + '<br><button id="vfOtra" class="mini" style="margin-top:8px">Intentar de nuevo</button>'; $('vfOtra').onclick = () => location.reload();
  }

  // ---------- el índice, si el CDE aún no lo tiene: forma-paso.html?solo=indice (el mismo paso de siempre, sin armar geometría) ----------
  const PASOS = [['prep', 'Preparar'], ['abrir', 'Abrir la traducción de Autodesk'], ['geo', 'Traer la geometría'], ['mallas', 'Revisar las piezas'], ['indice', 'Índice de parámetros (en el servidor)']];
  function preparaIndice() {
    return new Promise((ok, mal) => {
      const caja = $('estadoCarga'), pasos = {}, x = LISTA.find(l => l.vid === VID) || {};
      const pinta = (extra) => { caja.classList.remove('oculto'); caja.classList.add('lado'); caja.innerHTML = '<b>' + esc(x.contenedor || x.archivo || 'Modelo') + '</b><br><small>' + (INFO && INFO.reordenar ? 'El índice de este modelo se ordenó con una regla anterior: el CDE lo vuelve a ordenar (las líneas de centro pasan a ser elementos, como en Forma). No se arma geometría. Tarda unos minutos, una sola vez.' : 'Primera vez que se abre: el CDE arma su índice de parámetros con la base de propiedades de Autodesk (no se arma geometría). Tarda unos minutos; después abre directo.') + '</small><div class="fpasos">' + PASOS.map(([k, t]) => { const s = pasos[k] || {}; return '<div class="fpaso ' + (s.e || '') + '"><i>' + (s.e === 'ok' ? '✓' : s.e === 'mal' ? '✗' : s.e === 'va' ? '…' : '·') + '</i> ' + t + (s.t ? ' <small>' + esc(s.t) + '</small>' : '') + (s.e === 'va' && typeof s.p === 'number' ? ' <small>' + Math.round(s.p * 100) + ' %</small>' : '') + '</div>'; }).join('') + '</div>' + (extra || ''); };
      const ifr = document.createElement('iframe'); ifr.id = 'fpaso'; ifr.title = 'Preparando el índice del modelo';
      const oye = (ev) => {
        const m = ev.data; if (ev.origin !== location.origin || !m || !m.cdePaso || m.vid !== VID) return;
        if (m.k) { pasos[m.k] = { e: m.e, t: m.t, p: m.p }; pinta(); }
        if (m.fin) {
          window.removeEventListener('message', oye);
          if (m.ok) { ifr.remove(); caja.classList.remove('lado'); ok(); return; }
          for (const k of Object.keys(pasos)) if (pasos[k].e === 'va') pasos[k].e = 'mal';
          ifr.remove(); caja.classList.remove('lado');
          mal(Object.assign(new Error(m.status === 403 ? 'El índice de este modelo aún no está en el CDE y tu nivel de acceso no permite prepararlo: pídeselo a un miembro del proyecto (basta con que lo abra una vez aquí).' : m.error || 'No se pudo preparar el índice.'), { codigo: m.codigo, status: m.status }));
        }
      };
      window.addEventListener('message', oye);
      ifr.src = 'forma-paso.html?pid=' + encodeURIComponent(PID) + '&vid=' + encodeURIComponent(VID) + '&solo=indice';
      document.body.appendChild(ifr); pinta();
    });
  }

  // ---------- abrir el modelo ----------
  async function abre() {
    const caja = $('estadoCarga'); caja.classList.remove('oculto', 'lado'); caja.textContent = 'Consultando el modelo…';
    INFO = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-forma');
    if (!INFO.indice) { await preparaIndice(); INFO = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-forma'); }
    caja.classList.remove('lado'); caja.textContent = 'Abriendo el visualizador de Autodesk…';
    const ifr = document.createElement('iframe'); ifr.id = 'lienzoForma'; ifr.title = 'Visualizador de Autodesk';
    await new Promise((ok, mal) => { ifr.onload = ok; ifr.onerror = () => mal(new Error('No se pudo abrir el lienzo.')); ifr.src = 'forma-lienzo.html?v=292'; document.body.appendChild(ifr); });
    LZ = ifr.contentWindow.LIENZO; if (!LZ) throw new Error('El lienzo no se inició.');
    LZ.alGeometria = () => { GEO = 1; pintaCifras(); };
    LZ.alAvance = (p) => { if (GEO < 1) { GEO = Math.min(0.99, p); pintaCifras(); } if (!caja.classList.contains('oculto') && caja.dataset.fase === 'geo') caja.textContent = 'Autodesk entrega la geometría… ' + Math.round(p * 100) + ' %'; };
    caja.dataset.fase = 'geo'; caja.textContent = 'Autodesk entrega el modelo…';
    const r = await LZ.abre({ urn: INFO.urn, region: INFO.region });
    try { if (LZ.modelo && LZ.modelo.isLoadDone && LZ.modelo.isLoadDone()) GEO = 1; } catch (e) {}
    caja.dataset.fase = ''; caja.textContent = 'Leyendo el índice del CDE…';
    if (INFO.indice) { try { EL = await api('/api/modelos/' + PID + '/' + VID + '/elementos'); EL.idx = new Map(EL.columnas.e.map((e, i) => [e, i])); } catch (e) { EL = null; } }
    // los ids: se elige la lectura de la correspondencia que coincide con los nombres del índice; si ninguna coincide, no se vincula
    let aviso = '';
    I = LZ.I;
    const P = LZ.piezas(400);
    if (!EL) aviso = 'Este modelo aún no tiene índice en el CDE: se ve el modelo, pero las funciones del CDE no están activas.';
    else if (!I) aviso = 'El visualizador de Autodesk no entregó la correspondencia de identificadores: se ve el modelo, pero las funciones del CDE no se activan para no mostrar datos cruzados.';
    else {
      const pares = (M) => P.muestra.map((d2) => { const fila = [M.v1(d2), LZ.nombreDe(d2)]; let p2 = d2; for (let k = 0; k < 6; k++) { const pa = LZ.padreDe(p2); if (!pa) break; const p1 = M.v1(pa), pn = LZ.nombreDe(pa); if (p1 > 0 && pn) fila.push(p1, pn); p2 = pa; } return fila; }).filter(f => f[0] > 0 && f[1]);
      const vale = (v) => !(v.total >= 20 && v.coinciden / v.total < 0.8);
      let VI = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-ids', { json: { pares: pares(I) } });
      if (I.otra && !(VI.total >= 20 && VI.coinciden / VI.total >= 0.8)) { const VB = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-ids', { json: { pares: pares(I.otra) } }); if (VB.coinciden > VI.coinciden) { I = I.otra; VI = VB; } }
      if (!vale(VI)) { aviso = 'Los identificadores del visualizador de Autodesk no coinciden con los del índice del CDE (' + VI.coinciden + ' de ' + VI.total + ' nombres): se ve el modelo, pero las funciones del CDE no se activan para no mostrar datos cruzados.'; EL = null; }
      INFO.ids = VI;
    }
    if (EL) {
      G = { elem: EL.columnas.e.map(e => ({ e })), porE: new Map(EL.columnas.e.map((e, i) => [e, i])), nElem: EL.columnas.e.length };
      // el vínculo: de una muestra de piezas con geometría, cuántas llegan (ellas o un antecesor) a un elemento del índice
      let con = 0; const sin = [], sinIds = [];
      for (const d of P.muestra) { if (elementoDePieza(d) != null) con++; else { if (sin.length < 12) sin.push(LZ.nombreDe(d) || ('id ' + d)); sinIds.push(d); } }
      VINC = { piezas: P.total, muestra: P.muestra.length, con, sin, sinIds, aux: 0, cats: [] };
      // v0.28.2 · de las piezas sin elemento, cuáles son líneas auxiliares (ejes, líneas de centro): el índice las deja fuera a propósito y no cuentan como fallo del vínculo
      if (sinIds.length) try {
        const R = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-diagnostico', { json: { ids: sinIds.map(d => I.v1(d)).filter(x => x > 0) } }), cats = new Map();
        const de = new Map((R.filas || []).map(x => [x.e, x])), queda = [], quedaIds = [];
        for (const d of sinIds) { const r = de.get(I.v1(d)); if (r && r.aux) { VINC.aux++; cats.set(r.cat, (cats.get(r.cat) || 0) + 1); } else { quedaIds.push(d); if (queda.length < 12) queda.push((LZ.nombreDe(d) || ('id ' + d)) + (r && r.cat ? ' (' + r.cat + ')' : '')); } }
        VINC.sin = queda; VINC.sinIds = quedaIds; VINC.cats = [...cats];
      } catch (e) { console.warn('diagnóstico del vínculo', e); }
    } else { G = null; VINC = null; }
    CIFRAS = (EL ? num(EL.columnas.e.length) + ' elementos en el índice · ' : '') + num(P.total) + ' piezas con geometría · ' + (INFO.archivo || '') + ' · v' + (INFO.version || '?') + ' de Forma'; pintaCifras();
    pintaVinculo(aviso);
    if (aviso) { caja.classList.add('lado'); caja.innerHTML = esc(aviso) + '<br><button id="vfCierra" class="mini" style="margin-top:8px">Entendido</button>'; $('vfCierra').onclick = () => caja.classList.add('oculto'); } else caja.classList.add('oculto');
    LZ.alSeleccionar = alSeleccionarEnVisor;
    FILTROS.length = 0; PARAMS = null; selecciona(null, true);
    abreModulo(MODULO && MODULOS[MODULO] ? MODULO : 'filtros', true);
    V.alCargarModelo.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
    if (EL) setTimeout(() => { try { if (window.PUENTE && window.PUENTE.cargaProps) window.PUENTE.cargaProps().catch(() => {}); } catch (e) {} }, 800);   // v0.29.2: el índice entero se adelanta en segundo plano
  }
  // v0.28.1 · mientras Autodesk sigue entregando geometría (las líneas y los vidrios llegan al final) la cabecera lo dice: el modelo aún no está completo
  let CIFRAS = '', GEO = 0;
  function pintaCifras() { const c = $('cifras'); if (!c) return; c.innerHTML = (GEO < 1 ? '<b style="color:#f0b640">⏳ Autodesk sigue entregando geometría… ' + Math.round(GEO * 100) + ' %</b> · ' : '<span style="color:#8fd18f">✓ geometría completa</span> · ') + esc(CIFRAS); }
  /** v0.28.1 · De las piezas de la muestra sin elemento: su cadena de antecesores y lo que el índice dice de cada uno (texto para copiar). */
  async function diagnosticoVinculo() {
    const cad = VINC.sinIds.slice(0, 10).map(d => { const c = []; let p = d; for (let k = 0; k < 9 && p > 0; k++) { c.push([p, I.v1(p), LZ.nombreDe(p).slice(0, 36)]); p = LZ.padreDe(p); } return c; });
    const pedir = [...new Set(cad.flatMap(c => c.map(x => x[1])).filter(x => x > 0))];
    const R = await api(F + '/modelos/' + encodeURIComponent(VID) + '/visor-diagnostico', { json: { ids: pedir } }), de = new Map((R.filas || []).map(x => [x.e, x]));
    return ['Visor de Autodesk Forma · ' + (INFO.archivo || '') + ' · v' + INFO.version + ' de Forma · ids ' + I.tipo + ' · árbol ' + (R.arbol || '-') + ' · regla ' + (R.reglaElem || '-') + (R.soloIndice ? ' · solo índice' : ''),
      'Índice: ' + JSON.stringify(R.clases || {}) + ' · elementos ' + EL.columnas.e.length + ' · piezas ' + VINC.piezas + ' · muestra ' + VINC.con + ' de ' + VINC.muestra + ' vinculadas',
      ...cad.map((c, i) => (i + 1) + ') ' + c.map(x => { const r = de.get(x[1]); return '[' + x[0] + '→' + x[1] + ' «' + x[2] + '» ' + (x[1] <= 0 ? 'SIN CORRESPONDENCIA' : !r || r.falta ? 'NO ESTÁ' : 'clase ' + r.clase + (r.icono ? ' icono «' + r.icono + '»' : '') + ' cat «' + r.cat + '»' + (r.anc ? ' anc ' + r.anc : '')) + ']'; }).join(' ← '))].join('\n');
  }
  /** De una pieza del visualizador (id SVF2) a su elemento del índice: ella misma o su primer antecesor que lo sea. null si ninguno. */
  function elementoDePieza(d) {
    if (!EL || !I || !LZ) return null;
    for (let k = 0; d > 0 && k < 60; k++) { const e = I.v1(d); if (e > 0 && EL.idx.has(e)) return e; d = LZ.padreDe(d); }
    return null;
  }
  function pintaVinculo(aviso) {
    const b = $('vinculo'); b.classList.remove('oculto');
    const base = VINC ? VINC.muestra - (VINC.aux || 0) : 0, pct = VINC && base ? Math.round(100 * VINC.con / base) : (VINC && VINC.muestra ? 100 : 0), bien = !aviso && VINC && pct >= 98;
    b.classList.toggle('reducida', !bien);
    b.textContent = aviso ? '⚠ Sin vínculo con el índice' : (bien ? '✓ ' : '⚠ ') + 'Vínculo con el índice: ' + pct + ' %';
    b.title = 'Geometría: la de Autodesk Forma, completa. Datos: el índice de parámetros del CDE. Pulsa para ver el detalle.';
    b.onclick = () => {
      const fila = (a, t) => '<tr><td style="text-align:right;padding-right:8px;white-space:nowrap"><b>' + a + '</b></td><td>' + t + '</td></tr>';
      ventana('Geometría y datos de este modelo', '<div class="tfid"><p><b>Geometría:</b> la dibuja el visualizador de Autodesk con la traducción de Forma (versión ' + esc(String((INFO || {}).version || '?')) + '). El CDE no arma, simplifica ni omite nada.</p><p><b>Datos:</b> el índice de parámetros del CDE.</p>' +
        (aviso ? '<div class="aviso ambar">' + esc(aviso) + '</div>' : '<table>' + fila(num(EL.columnas.e.length), 'elementos en el índice del CDE') + fila(num(VINC.piezas), 'piezas con geometría en el modelo de Autodesk') + fila(num(VINC.con) + ' de ' + num(base), 'piezas de la muestra que llegan a un elemento del índice (<b>' + pct + ' %</b>)') + (VINC.aux ? fila(num(VINC.aux) + ' de ' + num(VINC.muestra), 'piezas de la muestra que son <b>líneas auxiliares</b> (' + VINC.cats.map(c => esc(c[0]) + ': ' + c[1]).join(', ') + '). Por regla del índice no son elementos, igual que en el complemento de Navisworks: se dibujan, pero no entran en filtros ni conteos') : '') +
          (INFO.ids ? fila(INFO.ids.coinciden + ' de ' + INFO.ids.total, 'nombres que coinciden entre el visualizador y el índice (comprobación de identificadores, ' + esc(I.tipo) + ')') : '') + '</table>' +
          (VINC.sin.length ? '<p class="pista" style="margin-top:8px">Piezas de la muestra sin elemento en el índice (se ven, pero no responden a los filtros; al pulsarlas se muestran las propiedades de Autodesk): ' + VINC.sin.map(esc).join(' · ') + '</p>' : '<p class="pista" style="margin-top:8px">Todas las piezas de la muestra están vinculadas a su elemento.</p>') + (VINC.sinIds.length ? '<p style="margin-top:8px"><button class="mini" id="vdHaz">Diagnóstico de las piezas sin vincular</button> <button class="mini oculto" id="vdCopia">Copiar</button></p><textarea id="vdTxt" class="oculto" readonly style="width:100%;height:150px;font:11px monospace"></textarea>' : '')) + '</div>', { ancho: 620, alto: 460 });
      const bh = document.getElementById('vdHaz'); if (bh) bh.onclick = async () => { const t = document.getElementById('vdTxt'), bc = document.getElementById('vdCopia'); bh.disabled = true; t.classList.remove('oculto'); t.value = 'Consultando…'; try { t.value = await diagnosticoVinculo(); bc.classList.remove('oculto'); bc.onclick = () => { t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } bc.textContent = 'Copiado'; }; } catch (e) { t.value = 'No se pudo armar: ' + e.message; } bh.disabled = false; };
    };
  }

  // ---------- visibilidad y colores (sobre el visualizador de Autodesk) ----------
  function aplicaVis() {
    VIS = BASE ? new Set(BASE) : null;
    if (OCULTOS.size && G) { VIS = VIS || new Set(EL.columnas.e); for (const e of OCULTOS) VIS.delete(e); }
    if (LZ && I) LZ.visibles(BASE ? idsV(BASE) : null, OCULTOS.size ? idsV(OCULTOS) : null);
  }
  function muestraSolo(set, encuadrar) { BASE = set ? new Set(set) : null; aplicaVis(); pintaEstadoFiltros(); if (encuadrar && VIS) encuadra(cajaDe(VIS)); }
  /** En este visor no hay cajas propias: «la caja de un conjunto» es el conjunto mismo, y encuadrar se lo pide al visualizador. */
  function cajaDe(set) { const ids = [...(set || [])], cero = { x: 0, y: 0, z: 0, length: () => 0 }; return { __ids: ids, isEmpty: () => !ids.length, getSize: () => cero, getCenter: () => cero }; }
  function encuadra(caja) { if (!LZ || !I) return; if (caja && caja.__ids) LZ.encuadra(idsV(caja.__ids)); else LZ.encuadra(null); }
  let TINTES = new Map();   // e -> rgb lineal (igual que en visor.js: lo que escriben «colorear por» y los módulos)
  let rafT = 0;
  function aplicaTintes() {
    if (!LZ || !I || rafT) return;
    rafT = requestAnimationFrame(() => { rafT = 0; const pares = []; for (const [e, c] of TINTES) { const d = I.v2(e); if (d > 0) pares.push([d, [linSrgb(c[0]), linSrgb(c[1]), linSrgb(c[2])]]); } LZ.colores(pares); });
  }
  const PALETA = ['#c8a24a', '#5aa9e6', '#7fc47f', '#e07a6a', '#b58bd8', '#f0b640', '#4fd1c5', '#e68ac0', '#9ab0c0', '#d4a373', '#8ecae6', '#ffafcc', '#a7c957', '#f4a261', '#90be6d', '#577590'];
  const hexLin = (h) => [1, 3, 5].map(i => srgbLin(parseInt(h.slice(i, i + 2), 16) / 255));
  let COLOREAR = '', COLOREAR_LEY = new Map();
  function coloreaPor(dim) {
    COLOREAR = dim; TINTES = new Map();
    if (dim && EL) { const C = EL.columnas, D = EL.diccionarios, mapa = new Map(); for (let i = 0; i < C.e.length; i++) { const k = D[dim][C[dim][i]]; if (!mapa.has(k)) mapa.set(k, hexLin(PALETA[mapa.size % PALETA.length])); TINTES.set(C.e[i], mapa.get(k)); } COLOREAR_LEY = mapa; }
    aplicaTintes(); pintaLeyenda();
  }
  function pintaLeyenda() { const l = $('leyendaColor'); if (!l) return; if (!COLOREAR) { l.innerHTML = ''; return; } const it = [...COLOREAR_LEY.keys()].slice(0, 40); l.innerHTML = it.map((k, i) => '<span><i style="background:' + PALETA[i % PALETA.length] + '"></i>' + esc(k || '(vacío)') + '</span>').join('') + (COLOREAR_LEY.size > 40 ? '<span class="pista">… ' + (COLOREAR_LEY.size - 40) + ' más</span>' : ''); }

  // ---------- filtros (los de visor.js: misma lógica y mismas rutas del índice) ----------
  const FILTROS = [];
  let PARAMS = null, NF = 0;
  async function parametros() { if (!PARAMS) PARAMS = await api('/api/modelos/' + PID + '/' + VID + '/parametros'); return PARAMS; }
  function pasaFiltro(f) {
    if (f.tipo === 'grupo') { if (!f.valores.size) return null; const out = new Set(); for (const x of (f.lista || [])) if (f.valores.has(x.value)) for (const e of x.ids) out.add(e); return out; }
    if (f.tipo === 'dim') { if (!f.valores.size) return null; const C = EL.columnas, D = EL.diccionarios, out = new Set(); for (let i = 0; i < C.e.length; i++) if (f.valores.has(D[f.dim][C[f.dim][i]])) out.add(C.e[i]); return out; }
    if (!f.valores.size && !f.vacio) return null;
    const out = new Set(); for (const v of f.valores) for (const e of (f.cache.get(v) || [])) out.add(e); if (f.vacio) for (const e of (f.cache.get('__vacio__') || [])) out.add(e);
    return out;
  }
  function pasanTodos(sin) {
    let out = null;
    for (const f of FILTROS) { if (f === sin) continue; const s = pasaFiltro(f); if (!s) continue; if (!out) out = new Set(s); else for (const e of out) if (!s.has(e)) out.delete(e); }
    return out;
  }
  async function cargaValoresParam(f) {
    const qs = new URLSearchParams({ param: f.param.id, conCero: '1' });
    for (const g of FILTROS) if (g !== f && g.tipo === 'dim' && g.valores.size) qs.set(g.dim, [...g.valores].join('\u0001'));
    const r = await api('/api/modelos/' + PID + '/' + VID + '/valores?' + qs);
    f.lista = r.valores;
  }
  async function elementosConValor(f, v) {
    if (f.cache.has(v)) return f.cache.get(v);
    const qs = new URLSearchParams({ param: f.param.id }); if (v === '__vacio__') qs.set('vacio', '1'); else qs.set('valores', v);
    const r = await api('/api/modelos/' + PID + '/' + VID + '/elementos-con?' + qs); const s = new Set(r.e); f.cache.set(v, s); return s;
  }
  function recalcula(encuadrar) {
    if (!G || !EL) return;
    const s = pasanTodos(null);
    BASE = s ? new Set(s) : null; aplicaVis();
    pintaFiltros(); pintaEstadoFiltros();
    if (encuadrar && VIS && FILTROS.some(f => f.valores.size || f.vacio)) encuadra(cajaDe(VIS));
    V.alRecalcular.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
  }
  function pintaEstadoFiltros() { const n = $('filtrosN'); if (!n) return; const act = FILTROS.filter(f => f.valores.size || f.vacio).length; n.textContent = (VIS ? num(VIS.size) + ' de ' : '') + num(G ? G.nElem : 0) + ' elementos' + (act ? ' · ' + act + ' filtro(s)' : '') + (OCULTOS.size ? ' · ' + OCULTOS.size + ' ocultos' : ''); }
  async function anadeFiltro(def) {
    const f = Object.assign({ id: ++NF, valores: new Set(), vacio: false, cache: new Map(), lista: null, q: '' }, def);
    FILTROS.push(f);
    if (f.tipo === 'param') await cargaValoresParam(f);
    pintaFiltros(); return f;
  }
  function quitaFiltro(f) { const i = FILTROS.indexOf(f); if (i >= 0) FILTROS.splice(i, 1); recalcula(false); }
  async function alternaValor(f, v, si) {
    if (si) { if (f.tipo === 'param') await elementosConValor(f, v); f.valores.add(v); } else f.valores.delete(v);
    if (f.tipo === 'grupo') { f.cache.set(v, new Set(((f.lista || []).find(x => x.value === v) || { ids: [] }).ids)); }
    recalcula(true);
  }
  function cuentaDim(dim, sinFiltroDe) {
    const base = pasanTodos(sinFiltroDe), C = EL.columnas, D = EL.diccionarios, cuenta = new Map();
    for (let i = 0; i < C.e.length; i++) { if (base && !base.has(C.e[i])) continue; const k = D[dim][C[dim][i]]; cuenta.set(k, (cuenta.get(k) || 0) + 1); }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
  }
  let DIM = 'cat';
  function pintaFiltros() {
    if ((MODULO !== 'filtros' && MODULO !== 'sectores') || !$('filtrosLista') || !EL) return;
    const cont = $('filtrosLista');
    cont.innerHTML = FILTROS.map(f => {
      const titulo = f.tipo === 'dim' ? DIMS[f.dim] : f.tipo === 'grupo' ? f.titulo : f.param.nombre;
      let vals;
      if (f.tipo === 'grupo') vals = (f.lista || []).map(x => ({ v: x.value, n: x.ids.length }));
      else if (f.tipo === 'dim') { const fd = FILTROS.find(g => g.tipo === 'dim' && g.dim === f.dim); vals = cuentaDim(f.dim, fd).map(([v, n]) => ({ v, n })); }
      else vals = (f.lista || []).map(x => ({ v: x.v, n: x.n, hueco: x.hueco }));
      const q = (f.q || '').toLowerCase(); if (q) vals = vals.filter(x => String(x.v).toLowerCase().includes(q));
      const marcados = vals.filter(x => f.valores.has(x.v)), resto = vals.filter(x => !f.valores.has(x.v));
      const fila = (x) => '<label class="val' + (x.hueco ? ' hueco' : '') + '"><input type="checkbox" data-f="' + f.id + '" data-v="' + esc(x.v) + '"' + (f.valores.has(x.v) ? ' checked' : '') + '><span title="' + esc(x.v) + '">' + esc(x.v || '(vacío)') + '</span><i>' + num(x.n) + '</i></label>';
      return '<div class="filtro" data-f="' + f.id + '"><div class="ft"><b title="' + esc(titulo) + '">' + esc(titulo) + '</b><span class="pista">' + (f.valores.size ? f.valores.size + ' ✓' : '') + '</span><button data-limpia="' + f.id + '" title="Quitar valores">○</button><button data-quita="' + f.id + '" title="Quitar filtro">✕</button></div>' +
        '<input data-q="' + f.id + '" placeholder="Buscar valor…" value="' + esc(f.q || '') + '" style="margin:4px 0;padding:3px 6px;font-size:12px">' +
        '<div class="vals">' + marcados.map(fila).join('') + (f.tipo === 'param' ? '<label class="val hueco"><input type="checkbox" data-f="' + f.id + '" data-v="__vacio__"' + (f.vacio ? ' checked' : '') + '><span>(sin valor)</span><i></i></label>' : '') + resto.slice(0, 400).map(fila).join('') + (resto.length > 400 ? '<div class="pista">… ' + (resto.length - 400) + ' valores más: usa el buscador</div>' : '') + '</div></div>';
    }).join('') || '<p class="pista">Sin filtros. Pulsa <b>+ Añadir filtro</b> y elige un parámetro: aparecen sus valores con el número de elementos; marca los que quieras ver.</p>';
    cont.querySelectorAll('input[type=checkbox]').forEach(ch => ch.onchange = () => { const f = FILTROS.find(x => x.id === +ch.dataset.f); if (ch.dataset.v === '__vacio__') { f.vacio = ch.checked; if (ch.checked) elementosConValor(f, '__vacio__').then(() => recalcula(true)); else recalcula(true); } else alternaValor(f, ch.dataset.v, ch.checked); });
    cont.querySelectorAll('input[data-q]').forEach(i => i.oninput = () => { const f = FILTROS.find(x => x.id === +i.dataset.q); f.q = i.value; const pos = i.selectionStart; pintaFiltros(); const j = $('filtrosLista').querySelector('input[data-q="' + f.id + '"]'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } });
    cont.querySelectorAll('button[data-quita]').forEach(b => b.onclick = () => quitaFiltro(FILTROS.find(x => x.id === +b.dataset.quita)));
    cont.querySelectorAll('button[data-limpia]').forEach(b => b.onclick = () => { const f = FILTROS.find(x => x.id === +b.dataset.limpia); f.valores.clear(); f.vacio = false; recalcula(false); });
    const fd = FILTROS.find(g => g.tipo === 'dim' && g.dim === DIM), items = cuentaDim(DIM, fd).slice(0, 300);
    const l = $('barrasDim'); if (l) {
      l.innerHTML = barras(items, fd && fd.valores.size === 1 ? [...fd.valores][0] : '', null);
      l.querySelectorAll('.barra[data-k]').forEach(b => b.onclick = async () => { let f = fd; if (!f) f = await anadeFiltro({ tipo: 'dim', dim: DIM }); if (f.valores.has(b.dataset.k)) f.valores.delete(b.dataset.k); else f.valores.add(b.dataset.k); recalcula(true); });   // v0.29.1: cada clic suma o quita (varias a la vez)
      if (fd) l.querySelectorAll('.barra[data-k]').forEach(b => b.classList.toggle('activa', fd.valores.has(b.dataset.k)));
    }
    V.alPintarFiltros.forEach(fn => { try { fn(cont); } catch (e) { console.warn(e); } });
  }
  async function selectorParametro(ancla, alElegir) {
    const P = await parametros(), lista = Array.isArray(P) ? P : (P.parametros || []);
    const grupos = new Map(); for (const p of lista) { if (/^●/.test(p.nombre)) continue; const i = p.nombre.indexOf(' / '); const g = i > 0 ? p.nombre.slice(0, i) : 'Otros'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); }
    const d = document.createElement('div'); d.className = 'selparam'; const r = ancla.getBoundingClientRect(); d.style.left = Math.min(r.left, innerWidth - 340) + 'px'; d.style.top = Math.min(r.bottom + 4, innerHeight - 390) + 'px';
    d.innerHTML = '<input placeholder="Buscar parámetro…"><div class="lista"></div>'; document.body.appendChild(d);
    const pinta = (q) => {
      q = (q || '').toLowerCase(); let h = '';
      const norm = Object.entries(DIMS).filter(([k, n]) => !q || n.toLowerCase().includes(q)); if (norm.length) h += '<div class="g">Normalizado</div>' + norm.map(([k, n]) => '<div class="o" data-dim="' + k + '">● ' + n + '</div>').join('');
      for (const [g, ps] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) { const f = ps.filter(p => !q || p.nombre.toLowerCase().includes(q)); if (!f.length) continue; h += '<div class="g">' + esc(g) + '</div>' + f.slice(0, 200).map(p => '<div class="o" data-p="' + p.id + '" title="' + esc(p.nombre) + '">' + esc(p.nombre.slice(p.nombre.indexOf(' / ') > 0 ? p.nombre.indexOf(' / ') + 3 : 0)) + '</div>').join(''); }
      d.querySelector('.lista').innerHTML = h || '<div class="o pista">Nada coincide.</div>';
      d.querySelectorAll('.o[data-dim]').forEach(o => o.onclick = () => { cierra(); alElegir({ tipo: 'dim', dim: o.dataset.dim }); });
      d.querySelectorAll('.o[data-p]').forEach(o => o.onclick = () => { cierra(); const p = lista.find(x => x.id === +o.dataset.p); alElegir({ tipo: 'param', param: p }); });
    };
    const cierra = () => { d.remove(); document.removeEventListener('mousedown', fuera); };
    const fuera = (e) => { if (!d.contains(e.target)) cierra(); };
    setTimeout(() => document.addEventListener('mousedown', fuera), 0);
    d.querySelector('input').oninput = (e) => pinta(e.target.value); pinta(''); d.querySelector('input').focus();
  }

  // ---------- paneles y módulos ----------
  let MODULO = '';
  const herr = (k) => document.querySelector('.herramientas button[data-h="' + k + '"]');
  function panel(titulo, html) { $('ptitulo').textContent = titulo; $('pcuerpo').innerHTML = html; $('panel').classList.remove('oculto'); return $('pcuerpo'); }
  function cierraPanel() { $('panel').classList.add('oculto'); MODULO = ''; document.querySelectorAll('.carril .mod').forEach(m => m.classList.remove('activo')); }
  $('pcerrar').onclick = cierraPanel;
  (function arrastrePanel() { const p = $('panel'), cab = $('pcab'); let a = null; cab.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; a = { x: e.clientX - p.offsetLeft, y: e.clientY - p.offsetTop }; e.preventDefault(); document.body.classList.add('arrastrando'); const lz = $('lienzoForma'); if (lz) lz.style.pointerEvents = 'none'; }); window.addEventListener('mousemove', (e) => { if (!a) return; p.style.left = Math.max(0, e.clientX - a.x) + 'px'; p.style.top = Math.max(48, e.clientY - a.y) + 'px'; }); window.addEventListener('mouseup', () => { a = null; const lz = $('lienzoForma'); if (lz) lz.style.pointerEvents = ''; }); })();
  // las ventanas del CDE se arrastran por encima del marco del visualizador: mientras se arrastra o se agranda una, el marco no captura el ratón
  document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.ventana, .flota')) { const lz = $('lienzoForma'); if (lz) { lz.style.pointerEvents = 'none'; const suelta = () => { lz.style.pointerEvents = ''; window.removeEventListener('mouseup', suelta); }; window.addEventListener('mouseup', suelta); } } }, true);
  const MODULOS = {}, CON_INDICE = { sectores: 'Filtro Sectores', mbim: 'Tablero (métricas BIM)', cobie: 'COBie / Uniclass', modplanos: 'Modelos / Planos' };
  function abreModulo(m, silencioso) {
    if (MODULO === m && !silencioso && !$('panel').classList.contains('oculto')) { cierraPanel(); return; }
    MODULO = m; document.querySelectorAll('.carril .mod').forEach(x => x.classList.toggle('activo', x.dataset.m === m));
    // v0.29.2: los módulos que necesitan el índice entero responden al instante: primero el aviso de carga, después su contenido
    const lento = CON_INDICE[m] && VID && EL && !(window.props && window.props.total);
    if (lento) panel(CON_INDICE[m], '<p class="pista vfcarga">⏳ Cargando el índice de parámetros del modelo… Solo tarda la primera vez que se abre este modelo.</p>');
    let r; if (MODULOS[m]) r = MODULOS[m](); else panel(m, '<p class="pista">Este módulo aún no está disponible.</p>');
    if (lento && r && r.then) r.then(() => { if ($('pcuerpo').querySelector('.vfcarga')) $('panel').classList.add('oculto'); }, (e) => { const c = $('pcuerpo').querySelector('.vfcarga'); if (c) c.textContent = 'No se pudo cargar el índice: ' + e.message; });
  }
  document.querySelectorAll('.carril .mod').forEach(m => m.onclick = () => abreModulo(m.dataset.m));
  const sinDatos = () => '<p class="pista">' + (VID ? 'Las funciones del CDE no están activas en este modelo (pulsa el aviso de arriba para ver por qué).' : 'Elige un modelo arriba.') + '</p>';
  MODULOS.filtros = () => {
    const c = panel('Filtros', '<div class="filab"><button class="primario" id="fAnade">+ Añadir filtro</button><button id="fLimpia" title="Quitar todos los filtros">Limpiar</button><span class="pista" id="filtrosN" style="margin-left:auto"></span></div>' +
      '<div id="filtrosLista"></div>' +
      '<div class="grupo"><h4>Colorear por<span class="hint">pinta cada valor de un color</span></h4><select id="fColor"><option value="">Colores del modelo</option>' + Object.entries(DIMS).map(([k, n]) => '<option value="' + k + '"' + (COLOREAR === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select><div class="leyenda" id="leyendaColor"></div></div>' +
      '<div class="grupo"><h4>Resumen<span class="hint">clic en una barra la suma al filtro; otro clic la quita</span></h4><div class="lienzo-pestanas">' + Object.entries(DIMS).filter(([k]) => k !== 'tip').map(([k, n]) => '<button data-d="' + k + '"' + (DIM === k ? ' class="activa"' : '') + '>' + n + '</button>').join('') + '</div><div id="barrasDim" class="pista">' + (EL ? '' : (VID ? 'Las funciones del CDE no están activas en este modelo.' : 'Elige un modelo.')) + '</div></div>');
    c.querySelector('#fAnade').onclick = (e) => { if (!EL) return; selectorParametro(e.currentTarget, (def) => anadeFiltro(def).then(() => { const el = $('filtrosLista').querySelector('.filtro:last-child'); if (el) el.scrollIntoView({ block: 'nearest' }); })); };
    c.querySelector('#fLimpia').onclick = () => { FILTROS.length = 0; OCULTOS = new Set(); recalcula(false); encuadra(); };
    c.querySelector('#fColor').onchange = (e) => coloreaPor(e.target.value);
    c.querySelectorAll('.lienzo-pestanas button').forEach(b => b.onclick = () => { DIM = b.dataset.d; c.querySelectorAll('.lienzo-pestanas button').forEach(x => x.classList.toggle('activa', x === b)); pintaFiltros(); });
    if (EL) { pintaFiltros(); pintaEstadoFiltros(); pintaLeyenda(); }
    V.alAbrirFiltros.forEach(fn => { try { fn(c); } catch (e) { console.warn(e); } });
  };
  MODULOS.elemento = () => { panel('Elemento', '<div id="elemFicha" class="elemficha"></div>'); pintaElemento(); };
  MODULOS.ayuda = () => panel('Ayuda', '<div class="grupo"><h4>Qué es este visor</h4><p>El modelo lo dibuja el <b>visualizador de Autodesk</b> con la traducción que Forma ya tiene del archivo: la geometría es la de Forma, completa. Las funciones de la izquierda son las del visor del CDE y trabajan con el índice de parámetros del CDE.</p></div>' +
    '<div class="grupo"><h4>Dónde está cada cosa</h4><p><b>Izquierda:</b> módulos del CDE (filtros, sectores, inventario, planos, tableros, elemento). <b>Abajo a la izquierda:</b> Encuadrar, Aislar, Ocultar, Mostrar todo y Silueta. <b>Abajo al centro</b> (barra de Autodesk): órbita, encuadre, medir, sección, explosión, navegador del modelo, propiedades de Autodesk y ajustes. <b>Arriba a la derecha:</b> el cubo de vistas.</p></div>' +
    '<div class="grupo"><h4>Ratón</h4><p>Arrastrar: girar · Rueda: acercar · Botón central o derecho: desplazar · Clic: seleccionar (abre «Elemento») · Doble clic: acercar al elemento.</p></div>' +
    '<div class="grupo"><h4>Aún solo en el Visor GIS/BIM</h4><p>Niveles / Ambientes, Conjuntos e interferencias, Comparar versiones, Flujos hospitalarios e Incidencias necesitan la geometría propia del CDE. El botón <b>Visor GIS/BIM</b> de la cabecera abre este mismo modelo allí.</p></div>');
  for (const [k, t] of [['ambientes', 'Niveles / Ambientes'], ['conjuntos', 'Conjuntos e interferencias'], ['comparar', 'Comparar versiones'], ['flujos', 'Flujos hospitalarios'], ['incidencias', 'Incidencias']])
    MODULOS[k] = () => { const c = panel(t, '<p class="pista">Este módulo trabaja con la geometría propia del CDE y por ahora solo está en el <b>Visor GIS/BIM</b>. Se irá incorporando aquí.</p><div class="filab"><button id="vfPropio">Abrir este modelo en el Visor GIS/BIM</button></div>'); c.querySelector('#vfPropio').onclick = () => $('btnPropio').click(); };

  // ---------- herramientas ----------
  document.querySelectorAll('.herramientas button[data-h]').forEach(b => b.onclick = () => {
    const h = b.dataset.h; if (!LZ) return;
    if (h === 'fantasma') { FANTASMA = !FANTASMA; LZ.fantasma(FANTASMA); b.classList.toggle('activo', FANTASMA); return; }
    if (h === 'encuadrar') { if (VIS && EL) encuadra(cajaDe(VIS)); else if (SEL) encuadra(cajaDe(new Set([SEL.e]))); else LZ.encuadra(null); return; }
    if (!G) return;
    if (h === 'aislar' && SEL) muestraSolo(new Set([SEL.e]), true);
    if (h === 'ocultar' && SEL) { OCULTOS.add(SEL.e); selecciona(null); recalcula(false); }
    if (h === 'todo') { FILTROS.length = 0; OCULTOS = new Set(); V.alMostrarTodo.forEach(f => { try { f(); } catch (e) {} }); BASE = null; recalcula(false); aplicaVis(); encuadra(); }
  });

  // ---------- selección ----------
  /** x: { e } del índice (o null). deVisor: la selección la hizo el usuario en el visualizador (no se le vuelve a pedir que seleccione). */
  function selecciona(x, sinPanel, deVisor) {
    SEL = x ? { e: x.e, idx: G ? G.porE.get(x.e) : undefined } : null; if (x) SUELTO = null;
    if (LZ && I && !deVisor) LZ.selecciona(x ? idsV([x.e]) : []);
    for (const k of ['aislar', 'ocultar']) { const b = herr(k); if (b) b.disabled = !x; }
    if (x && EL && EL.idx.has(x.e)) { const i = EL.idx.get(x.e), D = EL.diccionarios, C = EL.columnas; SEL.nombre = C.nombre[i]; SEL.cat = D.cat[C.cat[i]]; SEL.niv = D.niv[C.niv[i]]; SEL.fam = D.fam[C.fam[i]]; SEL.tip = D.tip[C.tip[i]]; }
    if (!sinPanel && (x || SUELTO) && MODULO !== 'elemento' && MODULO !== 'inventario') abreModulo('elemento', true);
    pintaElemento();
    V.alSeleccionar.forEach(f => { try { f(SEL); } catch (e) {} });
  }
  function alSeleccionarEnVisor(dbIds) {
    if (!dbIds || !dbIds.length) { SUELTO = null; selecciona(null, true, true); return; }
    const d = dbIds[0], e = elementoDePieza(d);
    if (e != null) { selecciona({ e }, false, true); return; }
    SUELTO = { d, nombre: LZ.nombreDe(d) }; selecciona(null, false, true);
  }
  function pintaElemento() {
    const d = $('elemFicha'); if (!d) return;
    const tabla = (ps, q) => { q = (q || '').toLowerCase(); const fs = ps.filter(p => !q || (p[0] + ' ' + p[1]).toLowerCase().includes(q)); return '<table>' + fs.map(p => '<tr><td class="pista" style="max-width:150px;word-break:break-word">' + esc(p[0]) + '</td><td style="word-break:break-word">' + esc(p[1]) + '</td></tr>').join('') + '</table>' + (fs.length ? '' : '<div class="pista">Nada coincide.</div>'); };
    if (!SEL && SUELTO) {   // una pieza que no llega a ningún elemento del índice: se dice, y se muestran las propiedades que da Autodesk
      const s = SUELTO;
      d.innerHTML = '<b>' + esc(s.nombre || ('id ' + s.d)) + '</b><div class="aviso ambar" style="margin:6px 0">' + (EL ? 'Esta pieza no está vinculada a un elemento del índice del CDE: no responde a los filtros.' : 'Sin índice del CDE para este modelo.') + ' Estas son las propiedades que entrega Autodesk.</div><input id="elQ" placeholder="Buscar propiedad…" style="margin:8px 0 4px"><div id="elProps" class="pista">Cargando propiedades…</div>';
      LZ.propiedades(s.d).then(r => { if (SUELTO !== s) return; const ps = ((r && r.properties) || []).filter(p => !p.hidden).map(p => [(p.displayCategory ? p.displayCategory + ' / ' : '') + p.displayName, String(p.displayValue == null ? '' : p.displayValue) + (p.units ? ' ' + p.units : '')]); const el = d.querySelector('#elProps'); if (el) el.innerHTML = tabla(ps, ''); const q = d.querySelector('#elQ'); if (q) q.oninput = () => { const e2 = d.querySelector('#elProps'); if (e2) e2.innerHTML = tabla(ps, q.value); }; });
      return;
    }
    if (!SEL) { d.innerHTML = '<p class="pista">Haz clic en el modelo para ver el elemento. Doble clic: acercar.</p>'; return; }
    d.innerHTML = '<b>' + esc(SEL.nombre || ('id ' + SEL.e)) + '</b><div class="pista">' + [SEL.cat, SEL.fam, SEL.tip, SEL.niv].filter(Boolean).map(esc).join(' · ') + '</div><div class="pista mono">id ' + SEL.e + '</div>' +
      '<div class="filab" style="margin-top:8px"><button id="elAislar">Aislar</button><button id="elOcultar">Ocultar</button><button id="elEnc">Acercar</button></div><input id="elQ" placeholder="Buscar propiedad…" style="margin:8px 0 4px"><div id="elProps" class="pista">Cargando propiedades…</div>';
    d.querySelector('#elAislar').onclick = () => muestraSolo(new Set([SEL.e]), true); d.querySelector('#elOcultar').onclick = () => { OCULTOS.add(SEL.e); selecciona(null); recalcula(false); };
    d.querySelector('#elEnc').onclick = () => encuadra(cajaDe(new Set([SEL.e])));
    const e = SEL.e;
    api('/api/modelos/' + PID + '/' + VID + '/elemento/' + e).then(r => {
      if (!SEL || SEL.e !== e) return;
      SEL.uid = (r.propiedades.find(p => /UniqueId/i.test(p[0])) || [])[1] || '';
      const el = d.querySelector('#elProps'); if (el) el.innerHTML = tabla(r.propiedades, ''); const q = d.querySelector('#elQ'); if (q) q.oninput = () => { const e2 = d.querySelector('#elProps'); if (e2) e2.innerHTML = tabla(r.propiedades, q.value); };
    }).catch(() => {});
  }

  // ---------- V: lo que esperan visor-modulos.js y visor-puente.js del visor (misma forma que en visor.js) ----------
  class Vector4 { constructor(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w == null ? 1 : w; } }
  const noAqui = () => alert('Las incidencias sobre el modelo aún se crean desde el Visor GIS/BIM (botón «Visor GIS/BIM» de la cabecera).');
  const V = {
    THREE: { Vector4 }, PID, api, esc, num, ventana, barras, panel, abreModulo, MODULOS, DIMS, PALETA, hexLin, f3, FORMA: true,
    get VID() { return VID; }, get G() { return G; }, get EL() { return EL; }, get VIS() { return VIS; }, get SEL() { return SEL; }, get LISTA() { return LISTA; }, get FILTROS() { return FILTROS; }, get TINTES() { return TINTES; }, set TINTES(t) { TINTES = t; },
    get QUIEN() { return QUIEN; }, get PROY() { return PROY; }, get MODULO() { return MODULO; }, get OCULTOS() { return OCULTOS; }, get LIENZO() { return LZ; }, get INFO() { return INFO; }, get VINCULO() { return VINC; },
    cajaDe, encuadra, dibuja: () => {}, muestraSolo, recalcula, selecciona, aplicaTintes, pasanTodos, cuentaDim, anadeFiltro, quitaFiltro, pintaFiltros, pintaEstadoFiltros, elementoDePieza, idsV,
    nuevaIncidencia: noAqui, abreIncidencia: noAqui,
    info: (e) => { if (!EL || !EL.idx.has(e)) return null; const i = EL.idx.get(e), D = EL.diccionarios, C = EL.columnas; return { e, nombre: C.nombre[i], modelo: D.modelo[C.modelo[i]], cat: D.cat[C.cat[i]], fam: D.fam[C.fam[i]], tip: D.tip[C.tip[i]], niv: D.niv[C.niv[i]] }; },
    alCargarModelo: [], alCambiarModelo: [], alSeleccionar: [], alMostrarTodo: [], alClicFantasma: [], extraRaycast: [], alRecalcular: [], alPintarFiltros: [], alAbrirFiltros: [], COLOR_SEL, srgbLin
  };
  window.VISOR = V; window.V = V;
  // Inventario y Planos (PDF): los de visor-modulos.js. Sus otros dos módulos (conjuntos, comparar) usan la geometría propia: se dejan con el aviso de arriba.
  import('./visor-modulos.js?v=108').then(m => { const antes = { conjuntos: MODULOS.conjuntos, comparar: MODULOS.comparar }; m.monta(V); MODULOS.conjuntos = antes.conjuntos; MODULOS.comparar = antes.comparar; }).catch(e => console.error('visor-modulos', e));

  cargaLista().catch(e => { $('estadoCarga').textContent = 'No se pudo cargar: ' + e.message; });
})();
