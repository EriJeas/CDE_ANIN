/*
 * PASO DE UN MODELO DE FORMA AL VISOR DEL CDE (pagina propia, para incrustar en el portal o en el visor del CDE).
 * forma-paso.html?pid=&vid=   Aisla la biblioteca del visor de Autodesk de las paginas del CDE (su THREE y sus estilos).
 *  1. pide al CDE que prepare la version (el servidor empieza el indice de parametros con la base de propiedades de Autodesk);
 *  2. abre la traduccion que Autodesk ya tiene del archivo (la misma que se ve en Forma) y espera toda la geometria;
 *  3. lee las mallas por tramos (cdeg.js, receta del visor BIM), espera el indice, junta las piezas por elemento y las envia.
 * Avisa a la pagina que la contiene con postMessage: { cdePaso, vid, k, e, t, p } por paso y { cdePaso, vid, fin, ok, error }.
 * Acepta { cdeParar: true } para cancelar.
 */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search), PID = Q.get('pid') || '', VID = Q.get('vid') || '';
  const F = '/api/proyectos/' + encodeURIComponent(PID) + '/forma', C = window.CDEG;
  const SOLO_INDICE = Q.get('solo') === 'indice';   // v0.28.0 · para el Visor de Autodesk Forma: solo se deja el índice en el CDE (no se arma geometría propia)
  const TOPE = Number(Q.get('tope')) || 0;   // tope de triangulos distinto del de siempre (pruebas y diagnostico)
  // v0.26.0 · nivel de detalle que elige quien prepara el modelo: normal (4 M de triángulos de objetivo, 10 M de límite), alto (10 M / 25 M)
  // o máximo (nada se simplifica; solo irían como caja los elementos que pasen de 60 M). En alto y máximo también se dibujan las líneas auxiliares.
  const DETALLE = ['alto', 'maximo'].includes(Q.get('detalle')) ? Q.get('detalle') : 'normal';
  const OP_DETALLE = { normal: {}, alto: { tope: 10000000, topeSeguro: 25000000 }, maximo: { tope: 1000000000, topeSeguro: 60000000, topePieza: 1000000000 } }[DETALLE];
  const duerme = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let parar = false, visor = null;
  const avisa = (m) => { try { if (parent !== window) parent.postMessage(Object.assign({ cdePaso: true, vid: VID }, m), location.origin); } catch (e) {} };
  let pasoActual = '', datosPaso = {};
  const paso = (k, e, t, p) => { if (e === 'va') pasoActual = k; avisa({ k, e, t: t || '', p }); };
  const memoria = () => { try { const m = performance.memory; return m ? Math.round(m.usedJSHeapSize / 1048576) + ' / ' + Math.round(m.jsHeapSizeLimit / 1048576) + ' MB' : ''; } catch (e) { return ''; } };
  /** Deja constancia en el servidor (DATOS/forma-visor.log) de lo que pasa en el navegador: cifras de cada paso. */
  const nota = (pasoN, datos) => { datosPaso = Object.assign(datosPaso, datos || {}); fetch(F + '/modelos/' + encodeURIComponent(VID) + '/bitacora', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ paso: pasoN, datos: Object.assign({ memoria: memoria() }, datos || {}) }) }).catch(() => {}); };
  const msg = (t) => { const s = document.querySelector('#msg span'); if (s) { s.textContent = t; s.parentNode.style.display = t ? '' : 'none'; } };
  window.addEventListener('message', (ev) => { if (ev.origin === location.origin && ev.data && ev.data.cdeParar) parar = true; });
  async function api(url, o) {
    o = o || {};
    const r = await fetch(url, { method: o.json ? 'POST' : 'GET', headers: o.json ? { 'Content-Type': 'application/json' } : {}, body: o.json ? JSON.stringify(o.json) : undefined, credentials: 'same-origin', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error(j.mensaje || j.error || ('El CDE respondió ' + r.status)); e.status = r.status; e.codigo = j.error || ''; throw e; }
    return j;
  }
  const corta = () => { if (parar) throw new Error('Cancelado.'); };
  function cargaLmv() {
    if (window.Autodesk && window.Autodesk.Viewing) return Promise.resolve();
    return new Promise((ok, mal) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/lmv/7.*/style.min.css'; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = '/lmv/7.*/viewer3D.min.js';
      s.onload = () => (window.Autodesk && window.Autodesk.Viewing ? ok() : mal(new Error('La biblioteca del visor de Autodesk no se inició.')));
      s.onerror = () => mal(new Error('No se pudo descargar el visor de Autodesk: el servidor del CDE necesita salida a internet (developer.api.autodesk.com).'));
      document.head.appendChild(s);
    });
  }
  /*
   * LOS IDS. El visor de Autodesk abre la traduccion SVF2, cuyos ids de objeto NO son los de la base de propiedades (SVF), con la
   * que el servidor arma el indice: sin traducirlos, las piezas caen en elementos equivocados (en el BM de 100020: 63.280 «Eje»).
   * Autodesk publica la correspondencia (dbid.idx) y su visor la carga si se le pide (como en el ejemplo de Autodesk «mapping
   * between SVF1 and SVF2 IDs»): PropDbLoader con needsDbIdRemap y el resultado dbidOldToNew (indice SVF -> id SVF2).
   */
  function pideCorrespondencia() {
    const PL = Autodesk.Viewing.Private && Autodesk.Viewing.Private.PropDbLoader;
    if (!PL || !PL.prototype || PL.prototype.__cdeIds) return !!(PL && PL.prototype && PL.prototype.__cdeIds);
    const carga = PL.prototype.load, procesa = PL.prototype.processLoadResult;
    PL.prototype.load = function () { this.needsDbIdRemap = true; return carga.apply(this, arguments); };
    PL.prototype.processLoadResult = function (result) { const r = procesa.apply(this, arguments); try { if (result && result.dbidOldToNew && this.model) this.model.idRemap = result.dbidOldToNew; } catch (e) {} return r; };
    PL.prototype.__cdeIds = true; return true;
  }
  /** Espera el arbol y la base de propiedades del visor y devuelve { v1(id SVF2) -> id SVF (o -1), v2(id SVF) -> id SVF2, tipo }. */
  async function correspondencia(modelo) {
    const t0 = Date.now();
    for (;;) {
      let ok = false; try { const p = modelo.getPropertyDb && modelo.getPropertyDb(); ok = !!(modelo.getInstanceTree() && (!p || !p.isLoadDone || p.isLoadDone())); } catch (e) {}
      if (ok && (modelo.idRemap || Date.now() - t0 > 4000)) break;
      if (Date.now() - t0 > 600000) throw new Error('El visor de Autodesk no terminó de cargar el árbol del modelo.');
      await duerme(800); corta();
    }
    let otg = false; try { otg = !!((modelo.isOTG && modelo.isOTG()) || (modelo.isSVF2 && modelo.isSVF2())); } catch (e) {}
    const rm = modelo.idRemap || null;
    if (!rm) {
      if (otg) throw new Error('El visor de Autodesk no entregó la correspondencia de identificadores SVF2 → SVF (dbid.idx): sin ella las piezas caerían en elementos equivocados, así que no se arma el modelo.');
      return { v1: (d) => d, v2: (d) => d, tipo: 'svf', n: 0 };
    }
    let max = 0; for (let i = 0; i < rm.length; i++) if (rm[i] > max) max = rm[i];
    const inv = new Int32Array(max + 1).fill(-1); for (let o = 1; o < rm.length; o++) { const n = rm[o]; if (n > 0 && inv[n] < 0) inv[n] = o; }
    const A = { v1: (d) => (d > 0 && d < inv.length ? inv[d] : -1), v2: (d) => (d > 0 && d < rm.length ? rm[d] : -1), tipo: 'svf2', n: rm.length };
    // por si el arreglo viniera al reves (id SVF2 -> SVF): la comprobacion de nombres elige la lectura que coincide
    const B = { v1: (d) => (d > 0 && d < rm.length ? rm[d] : -1), v2: (d) => (d > 0 && d < inv.length ? inv[d] : -1), tipo: 'svf2-inv', n: rm.length };
    A.otra = B; return A;
  }
  const inicia = (region) => new Promise((ok) => Autodesk.Viewing.Initializer({
    env: 'AutodeskProduction2', api: region === 'EMEA' ? 'streamingV2_EU' : 'streamingV2',
    getAccessToken: async (cb) => { for (let i = 0; i < 3; i++) { try { const t = await api('/api/forma/token-visor'); return cb(t.access_token, t.expires_in); } catch (e) { await duerme(1500); } } },
  }, ok));
  /** Espera a que el visor de Autodesk traiga TODA la geometria (con avance). */
  function esperaGeometria(modelo, avance) {
    return new Promise((ok) => {
      let listo = false; const fin = () => { if (!listo) { listo = true; clearInterval(mira); ok(); } };
      const mira = setInterval(() => { try { if (modelo.isLoadDone && modelo.isLoadDone()) fin(); } catch (e) {} if (parar) fin(); }, 1500);
      try { if (modelo.isLoadDone && modelo.isLoadDone()) return fin(); } catch (e) {}
      visor.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, fin);
      visor.addEventListener(Autodesk.Viewing.PROGRESS_UPDATE_EVENT, (e) => { if (!listo && e && typeof e.percent === 'number') avance(e.percent / 100); });
    });
  }
  function sube(url, blob, info, avance) {
    return new Promise((ok, mal) => {
      const x = new XMLHttpRequest(); x.open('POST', url); x.setRequestHeader('Content-Type', 'application/octet-stream'); x.setRequestHeader('x-cde-geometria', encodeURIComponent(JSON.stringify(info)));
      x.upload.onprogress = (e) => { if (e.lengthComputable) avance(e.loaded / e.total); };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300) ok(j); else mal(new Error(j.mensaje || ('El CDE respondió ' + x.status))); };
      x.onerror = () => mal(new Error('Se cortó el envío de la geometría al CDE.')); x.send(blob);
    });
  }
  /*
   * EL ARBOL ENTERO, con los ids de la base de propiedades (los del indice): el padre de cada nodo. Con el, el CDE ordena el
   * indice de un NWD/NWC como Navisworks (Archivo, Capa y Coleccion son agrupacion; el primer objeto es el elemento, como en
   * el complemento de Navisworks del CDE): sin eso, los nodos de TIPO de Revit quedaban como elementos y sus instancias como
   * partes. En SVF2 se recorre la correspondencia (un id SVF por posicion); en SVF, el arbol del visor.
   */
  async function arbolEntero(it, I) {
    let n = I.n || 0, padre;
    if (n > 1) {
      padre = new Int32Array(n);
      for (let o = 1; o < n; o++) { const d = I.v2(o); if (d > 0) { let p = 0; try { p = it.getNodeParentId(d); } catch (e) {} padre[o] = p > 0 ? Math.max(0, I.v1(p)) : 0; } if ((o & 0x3ffff) === 0) { await duerme(0); corta(); } }
      return padre;
    }
    const ids = []; let max = 0;
    it.enumNodeChildren(it.getRootId(), (d) => { ids.push(d); if (d > max) max = d; }, true);
    padre = new Int32Array(max + 1);
    for (let k = 0; k < ids.length; k++) { const d = ids[k]; let p = 0; try { p = it.getNodeParentId(d); } catch (e) {} padre[d] = p > 0 ? p : 0; if ((k & 0x3ffff) === 0) { await duerme(0); corta(); } }
    return padre;
  }
  async function subeBinario(url, buf) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf, credentials: 'same-origin', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.mensaje || ('El CDE respondió ' + r.status));
    return j;
  }
  const num = (n) => Number(n || 0).toLocaleString('es-PE');
  const tam = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  async function corre() {
    if (!C) throw new Error('Falta cdeg.js.');
    paso('prep', 'va');
    const pr = await api(F + '/modelos/' + encodeURIComponent(VID) + '/preparar', { json: {} });
    avisa({ archivo: pr.archivo }); paso('prep', 'ok', 'versión ' + pr.version + ' en Forma');
    paso('indice', 'va', 'Autodesk entrega la base de propiedades…');
    paso('abrir', 'va'); await cargaLmv(); await inicia(pr.region); corta();
    const conMapa = pideCorrespondencia();
    visor = new Autodesk.Viewing.Viewer3D(document.getElementById('lmv'), {}); visor.start();
    const doc = await new Promise((ok, mal) => Autodesk.Viewing.Document.load('urn:' + pr.urn, ok, (cod, m) => mal(new Error('Autodesk no abrió la traducción del archivo (código ' + cod + (m ? ': ' + m : '') + '). Si el archivo es nuevo en Forma, espera a que Forma termine de procesarlo (que se vea allí) y vuelve a intentarlo.'))));
    const raiz = doc.getRoot(), def = raiz.getDefaultGeometry && raiz.getDefaultGeometry(), tres = raiz.search({ type: 'geometry', role: '3d' });
    const nodo = (def && def.is3D && def.is3D()) ? def : (tres.find((x) => x.data && x.data.isMasterView) || tres[0]);
    if (!nodo) throw new Error('El archivo no tiene una vista 3D traducida en Forma.');
    paso('abrir', 'ok', (nodo.data && nodo.data.name) || ''); corta();
    paso('geo', 'va', '', 0); msg('Trayendo la geometría de Autodesk…');
    const modelo = await visor.loadDocumentNode(doc, nodo, { keepCurrentModels: false });
    const t0 = Date.now(); let nFr = 0; try { nFr = modelo.getFragmentList().getCount(); } catch (e) {} nota('abierto', { vista: (nodo.data && nodo.data.name) || '', fragmentos: nFr, navegador: navigator.userAgent.slice(0, 120) });
    await esperaGeometria(modelo, (x) => paso('geo', 'va', '', x)); corta();
    paso('geo', 'ok'); msg(''); { let nFr = 0; try { nFr = modelo.getFragmentList().getCount(); } catch (e) {} nota('geometria-traida', { segundos: Math.round((Date.now() - t0) / 1000), fragmentos: nFr }); }
    // 1) censo de las piezas (sin tocar los vertices): triangulos, caja y color
    paso('mallas', 'va', '', 0); await duerme(50);
    const L = C.censa(modelo, { visor, Matriz: THREE.Matrix4, Caja: THREE.Box3 }), TRAMO = 4000;
    for (let i = 0; i < L.n; i += TRAMO) { corta(); C.censaTramo(L, i, i + TRAMO); paso('mallas', 'va', num(L.nMalla) + ' piezas', Math.min(1, (i + TRAMO) / L.n)); await duerme(0); }
    if (!L.nMalla) throw new Error('El visor de Autodesk no entregó mallas de este modelo.');
    nota('censo', { fragmentos: L.n, piezas: L.nMalla, triangulos: L.triEntrada, lineas: L.lineas, sinMalla: L.sinMalla });
    paso('mallas', 'ok', num(L.nMalla) + ' piezas · ' + num(L.triEntrada) + ' triángulos');
    // 2) el indice lo arma el servidor: dice cuales nodos son elementos (y cuales son acero de refuerzo)
    for (;;) {
      const st = await api(F + '/modelos/' + encodeURIComponent(VID) + '/estado'), t = st.trabajo;
      if (!t) throw new Error('El CDE perdió el trabajo (¿se reinició?). Vuelve a intentarlo.');
      if (t.error) throw new Error(t.error);
      if (t.indice.estado === 'listo') { paso('indice', 'ok', num((t.indice.resumen || {}).elementos) + ' elementos'); break; }
      paso('indice', 'va', t.indice.texto || ''); await duerme(2000); corta();
    }
    // los ids del visor (SVF2) se pasan a los de la base de propiedades (SVF), los del indice; se comprueba con los nombres
    let I = await correspondencia(modelo); const it = modelo.getInstanceTree(), dbDe2 = L.dbDe, FUERA = 0x40000000;
    const muestraIds = (M) => { const P = []; for (let f = 0, salto = Math.max(1, Math.floor(L.n / 400)); f < L.n && P.length < 400; f += salto) { if (L.tipo[f] !== 1) continue; const d2 = dbDe2(f), d1 = M.v1(d2); if (d1 <= 0) continue; let nm = ''; try { nm = it.getNodeName(d2); } catch (e) {} if (!nm) continue;
      // v0.25.7: con la pieza van sus antecesores: si la pieza no tiene ficha propia en el índice (no lleva propiedades), se comprueba con el primero que sí la tenga
      const fila = [d1, nm]; let p2 = d2; for (let k = 0; k < 6; k++) { let pa = 0; try { pa = it.getNodeParentId(p2); } catch (e) {} if (!(pa > 0)) break; const p1 = M.v1(pa); let pn = ''; try { pn = it.getNodeName(pa); } catch (e) {} if (p1 > 0 && pn) fila.push(p1, pn); p2 = pa; }
      P.push(fila); } return P; };
    let VI = await api(F + '/modelos/' + encodeURIComponent(VID) + '/valida-ids', { json: { pares: muestraIds(I) } });
    if (I.otra && !(VI.total >= 20 && VI.coinciden / VI.total >= 0.8)) { const VB = await api(F + '/modelos/' + encodeURIComponent(VID) + '/valida-ids', { json: { pares: muestraIds(I.otra) } }); if (VB.coinciden > VI.coinciden) { I = I.otra; VI = VB; } }
    if (VI.total >= 20 && VI.coinciden / VI.total < 0.8) throw new Error('Los identificadores del visor de Autodesk no coinciden con los del índice (' + VI.coinciden + ' de ' + VI.total + ' nombres' + (VI.sinFicha ? '; ' + VI.sinFicha + ' sin ficha' : '') + '): no se arma el modelo para no mostrar datos cruzados.' + ((VI.ejemplos || []).length ? ' Ejemplos (id · visor · índice): ' + VI.ejemplos.slice(0, 3).map((x) => x[0] + ' · «' + x[1] + '» · «' + (x[2] == null ? 'sin ficha' : x[2]) + '»').join('; ') : ''));
    const v1 = (d) => { const r = I.v1(d); return r > 0 ? r : FUERA + d; };   // sin correspondencia: un id aparte (no cruza con el indice)
    L.dbDe = (f) => { const d = dbDe2(f); return d == null || d < 0 ? d : v1(d); };
    // el arbol (padres) de las piezas, para juntarlas en su elemento del indice (con ids de la base de propiedades)
    const padres = new Map(); let sinMapa = 0;
    for (let f = 0; f < L.n; f++) { if (L.tipo[f] !== 1 && L.tipo[f] !== 2) continue; let d = dbDe2(f), k = 0; if (L.tipo[f] === 1 && I.v1(d) <= 0) sinMapa++; while (d != null && d > 0 && !padres.has(v1(d)) && k++ < 60) { let pa = null; try { pa = it.getNodeParentId(d); } catch (e) {} padres.set(v1(d), pa > 0 ? v1(pa) : null); d = pa; } if (f % 20000 === 0) await duerme(0); }
    nota('ids', { tipo: I.tipo, correspondencias: I.n, piezasSinCorrespondencia: sinMapa, pedida: conMapa, comprobacion: VI });
    // el indice se ordena como Navisworks (Archivo, Capa y Coleccion no son elementos) antes de juntar las piezas
    paso('indice', 'va', 'Ordenando el índice como Navisworks…');
    { const A = await arbolEntero(it, I); let conP = 0; for (let k = 1; k < A.length; k++) if (A[k] > 0) conP++;
      // que nodos tienen geometria: 1 malla, 2 lineas. Una malla siempre hace elemento; unas lineas, salvo que sean auxiliares
      // (los ejes / lineas de centro de tuberias, ductos y tubos de un modelo MEP); los arboles CAD 3D y los escudos si
      const malla = new Uint8Array(A.length); let conM = 0;
      for (let f = 0; f < L.n; f++) { const t = L.tipo[f]; if (t !== 1 && t !== 2) continue; const id = L.dbDe(f); if (id > 0 && id < A.length) { if (!malla[id]) conM++; malla[id] |= t; } }
      nota('arbol', { nodos: A.length, conPadre: conP, conMalla: conM });
      // CDA2: 'CDA2', n, padre (Int32 x n), malla (Uint8 x n)
      const cab = new Uint32Array(2); cab[0] = 0x32414443; cab[1] = A.length;
      await subeBinario(F + '/modelos/' + encodeURIComponent(VID) + '/arbol', new Blob([cab, A, malla])); }
    for (;;) {
      const st = await api(F + '/modelos/' + encodeURIComponent(VID) + '/estado'), t = st.trabajo, a = t && t.arbol;
      if (!t) throw new Error('El CDE perdió el trabajo (¿se reinició?). Vuelve a intentarlo.');
      if (a && a.estado === 'error') throw new Error(a.error || 'No se pudo ordenar el índice.');
      if (a && a.estado === 'listo') { const r = a.r || {}; paso('indice', 'ok', num(r.elementos || (t.indice.resumen || {}).elementos) + ' elementos' + (r.aplicado ? ' (como Navisworks)' : '')); break; }
      paso('indice', 'va', (a && a.texto) || 'Ordenando el índice como Navisworks…'); await duerme(1500); corta();
    }
    if (SOLO_INDICE) { const ri = await api(F + '/modelos/' + encodeURIComponent(VID) + '/instalar-indice', { json: {} }); nota('indice-solo', { elementos: ri.elementos }); try { visor.finish(); } catch (e) {} return { elementos: ri.elementos || 0, soloIndice: true }; }
    const EI = await api(F + '/modelos/' + encodeURIComponent(VID) + '/elementos-indice'), ids = new Set(EI.e), acero = new Set(EI.acero || []), aux = new Set(EI.aux || []);
    const G = C.elementosDe(L, (d) => ids.has(d), (d) => (padres.has(d) ? padres.get(d) : null), { lineasSueltas: DETALLE !== 'normal' });   // en alto y máximo ninguna línea se deja fuera por no tener elemento
    /*
     * v0.27.1 · Si hay piezas que no se pudieron unir a un elemento del índice, se arma un diagnóstico legible (qué id tiene la pieza en el
     * visor, cuál en el índice, sus antecesores y qué dice el índice de cada uno): el visor lo muestra y se puede corregir con datos.
     */
    let DIAG = '';
    if (G.sinElemento || G.lineasSinElemento) try {
      const filas = [], vistos = new Set();
      for (let f = 0; f < L.n && filas.length < 8; f++) {
        if (L.tipo[f] !== 1 && L.tipo[f] !== 2) continue; const d2 = dbDe2(f); if (d2 == null || d2 <= 0 || vistos.has(d2)) continue;
        let t = L.dbDe(f), k = 0, hay = false; while (t != null && t > 0 && k++ < 60) { if (ids.has(t)) { hay = true; break; } t = padres.has(t) ? padres.get(t) : null; } if (hay) continue;
        vistos.add(d2); const cad = []; let p2 = d2;
        for (let j = 0; j < 7 && p2 > 0; j++) { let nm = ''; try { nm = it.getNodeName(p2) || ''; } catch (e) {} cad.push([p2, I.v1(p2), String(nm).slice(0, 40)]); let pa = 0; try { pa = it.getNodeParentId(p2); } catch (e) {} if (!(pa > 0)) break; p2 = pa; }
        filas.push({ tipo: L.tipo[f] === 2 ? 'línea' : 'sólido', cad });
      }
      const pedir = [...new Set(filas.flatMap((x) => x.cad.map((c) => c[1])).filter((x) => x > 0))];
      const R = await api(F + '/modelos/' + encodeURIComponent(VID) + '/diagnostico-ids', { json: { ids: pedir } }), de = new Map((R.filas || []).map((x) => [x.e, x]));
      DIAG = ['Correspondencia de ids: ' + I.tipo + ' (' + (I.n || 0) + ') · piezas ' + L.n + ' · sin correspondencia ' + sinMapa + ' · sólidos sin elemento ' + (G.sinElemento || 0) + ' · líneas sin elemento ' + (G.lineasSinElemento || 0),
        'Índice: ' + JSON.stringify(R.clases || {}) + ' · elementos (clase 1) recibidos: ' + ids.size + ' · mayor id del índice: ' + (R.maxE || 0) + ' · comprobación de nombres: ' + VI.coinciden + ' de ' + VI.total + (VI.sinFicha ? ' (' + VI.sinFicha + ' sin ficha)' : ''),
        ...filas.map((x, i) => (i + 1) + ') ' + x.tipo + ': ' + x.cad.map((c) => { const r = de.get(c[1]); return '[visor ' + c[0] + ' → índice ' + c[1] + ' «' + c[2] + '» = ' + (c[1] <= 0 ? 'SIN CORRESPONDENCIA' : !r || r.falta ? 'NO ESTÁ' : 'clase ' + r.clase + ' «' + String(r.nombre || '').slice(0, 30) + '» cat «' + (r.cat || '') + '»' + (r.anc ? ' anc ' + r.anc : '')) + ']'; }).join(' ← '))].join('\n').slice(0, 6000);
      nota('diagnostico', { texto: DIAG.slice(0, 3000) });
    } catch (e) { DIAG = 'No se pudo armar el diagnóstico: ' + e.message; }
    const muestra = G.muestraSin.map((d) => { const cadena = []; let x = d, k = 0; while (x != null && x > 0 && k++ < 8) { let nm = ''; try { const x2 = x >= FUERA ? x - FUERA : I.v2(x); nm = it.getNodeName(x2); } catch (e) {} cadena.push(x + ':' + String(nm || '').slice(0, 40)); x = padres.get(x); } return cadena.join(' < '); });
    nota('elementos', { elementosIndice: ids.size, acero: acero.size, grupos: G.elems.length, sinElemento: G.sinElemento, muestraSinElemento: muestra });
    // 3) plan (criterio del complemento de Navisworks: acero solo con propiedades, aligerado con 1 cm de tolerancia) y armado
    //    por trozos, de los elementos mas grandes a los mas chicos
    paso('armar', 'va', '', 0);
    const plan = C.planifica(L, (f) => acero.has(G.deFid[f]), TOPE ? { tope: TOPE, topeSeguro: Math.max(TOPE * 2.5, 1000) } : OP_DETALLE), K = plan.cifras;
    nota('plan', K);
    // de lo que mas se ve a lo que menos; primero se mide cuanto queda cada elemento ya aligerado y con esas cifras se decide
    // que va completo y que como caja (sin pasar del limite del navegador); luego se escribe
    const lista = C.ordena(L, plan, G.elems), W = C.escritor(); let hechos = 0;
    while (hechos < lista.length) { corta(); const t0 = Date.now(); while (hechos < lista.length && Date.now() - t0 < 150) { C.mide(L, plan, lista, W, hechos, hechos + 20); hechos = Math.min(lista.length, hechos + 20); } paso('armar', 'va', 'Midiendo ' + num(hechos) + ' de ' + num(lista.length) + ' elementos', 0.5 * hechos / lista.length); await duerme(0); }
    const dec = C.elige(plan, lista, W); let nCompl = 0, nCaja = 0, triMed = 0; for (let k = 0; k < dec.length; k++) { if (dec[k] === 1) { nCompl++; triMed += W.costo[k]; } else if (dec[k] === 2) nCaja++; }
    nota('eleccion', { completos: nCompl, enCaja: nCaja, triangulosCompletos: triMed, topeSeguro: K.topeSeguro });
    hechos = 0;
    while (hechos < lista.length) { corta(); const t0 = Date.now(); while (hechos < lista.length && Date.now() - t0 < 150) { C.arma(L, plan, lista, W, hechos, hechos + 20); hechos = Math.min(lista.length, hechos + 20); } paso('armar', 'va', num(W.nI / 3) + ' triángulos' + (W.aligeradas ? ' · ' + num(W.aligeradas) + ' piezas aligeradas' : ''), 0.5 + 0.5 * hechos / lista.length); await duerme(0); }
    // los dibujos en lineas (arboles CAD 3D, escudos), con su color; no las auxiliares (ejes, lineas de centro)
    paso('armar', 'va', 'Dibujos en líneas…', 1); await duerme(0);
    const LN = C.armaLineas(L, G.lineas || [], W, DETALLE === 'normal' ? aux : new Set(), DETALLE === 'normal' ? 3000000 : 12000000);
    nota('lineas', { segmentos: LN.nS, elementos: LN.filas.length / 4, auxiliares: LN.aux, omitidas: LN.omitidas, sinElemento: G.lineasSinElemento || 0 });
    const aligerado = K.pasaDelTope || K.nAcero > 0 || W.aligeradas > 0 || W.enCaja > 0;
    const cm = (x) => (x * 100).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' cm';
    const avisos = [];
    if (W.aligeradas) avisos.push('Geometría aligerada como en el complemento de Navisworks: ' + num(W.aligeradas) + ' pieza(s) pesadas simplificadas sin mover su superficie más de ' + cm(K.tolerancia) + ' (' + num(W.triAntes) + ' → ' + num(W.triDespues) + ' triángulos).');
    if (K.nAcero) avisos.push(num(K.nAcero) + ' pieza(s) de acero de refuerzo van solo con propiedades.');
    if (W.enCaja) avisos.push(num(W.enCaja) + ' elemento(s) van como su caja (orientada) para no pasar de ' + num(K.topeSeguro) + ' triángulos en el navegador: primero va completo lo que más se ve. Se ven, se seleccionan y se filtran; sus propiedades están completas.');
    if (LN.nS) avisos.push(num(LN.filas.length / 4) + ' elemento(s) dibujados con líneas (vegetación, escudos…): ' + num(LN.nS) + ' segmentos con su color.');
    if (LN.aux + (G.lineasSinElemento || 0)) avisos.push(num(LN.aux + (G.lineasSinElemento || 0)) + ' pieza(s) de líneas auxiliares (ejes, líneas de centro) no se dibujan, como en el complemento de Navisworks.');
    if (LN.omitidas) avisos.push(num(LN.omitidas) + ' pieza(s) de líneas no se dibujan para no pasar de 3.000.000 de segmentos.');
    if (G.sinElemento) avisos.push(num(G.sinElemento) + ' pieza(s) sin elemento en el índice.');
    const out = C.cierraEscritor(W, L.origen, { modelo: pr.archivo, herramienta: 'Traducción de Autodesk Forma (visor de Autodesk) → CDE', forma: { version: pr.version },
      // v0.26.0: qué tan fiel es esta geometría a la de Autodesk; el visor lo muestra siempre (nada se quita en silencio)
      fidelidad: { detalle: DETALLE, triangulosEntrada: K.triEntrada, triangulos: Math.round(W.nI / 3), piezas: K.piezas, piezasAligeradas: W.aligeradas, triAntes: W.triAntes, triDespues: W.triDespues, tolerancia: K.tolerancia, enCaja: W.enCaja, topeSeguro: K.topeSeguro, acero: K.nAcero, triAcero: K.triAcero, lineasDibujadas: LN.filas.length / 4, lineasAuxiliares: LN.aux, lineasOmitidas: LN.omitidas, lineasSinElemento: DETALLE === 'normal' ? (G.lineasSinElemento || 0) : 0, lineasSueltas: DETALLE === 'normal' ? 0 : (G.lineasSinElemento || 0), piezasSinElemento: G.sinElemento || 0, diagnostico: DIAG },
      aligerado: aligerado ? { criterio: 'complemento de Navisworks (medio)', triangulosEntrada: K.triEntrada, triangulos: Math.round(W.nI / 3), tope: K.tope, tolerancia: K.tolerancia, piezasAligeradas: W.aligeradas, mallasReutilizadas: W.reusadas, acero: K.nAcero, enCaja: W.enCaja, topeSeguro: K.topeSeguro } : null });
    const blob = new Blob(out.partes, { type: 'application/octet-stream' });
    nota('armado', { bytes: blob.size, elementos: out.nElem, vertices: out.nVert, triangulos: Math.round(out.nIdx / 3), vaciadas: L.vaciadas || 0, aligeradas: W.aligeradas, triAntes: W.triAntes, triDespues: W.triDespues, reusadas: W.reusadas, enCaja: W.enCaja, triEnCaja: W.triEnCaja, aristas: out.nAristas });
    paso('armar', 'ok', num(out.nElem) + ' elementos · ' + num(Math.round(out.nIdx / 3)) + ' triángulos' + (aligerado ? ' (aligerada)' : ''));
    try { visor.finish(); } catch (e) {} visor = null; msg('Geometría lista: ' + num(out.nElem) + ' elementos.');
    paso('subir', 'va', tam(blob.size), 0);
    await sube(F + '/modelos/' + encodeURIComponent(VID) + '/geometria', blob, { elementos: out.nElem, triangulos: Math.round(out.nIdx / 3), avisos, ids: { tipo: I.tipo, total: VI.total, coinciden: VI.coinciden }, aristas: out.nAristas, cajas: W.enCaja, criterio: 'cdeg-4', segmentos: out.nSegmentos }, (x) => paso('subir', 'va', tam(blob.size), x));
    for (let k = 0; ; k++) {
      const st = await api(F + '/modelos/' + encodeURIComponent(VID) + '/estado');
      if (st.enVisor) break;
      if (st.trabajo && st.trabajo.error) throw new Error(st.trabajo.error);
      if (k > 600) throw new Error('El CDE no terminó de instalar el modelo.');
      paso('subir', 'va', tam(blob.size) + ' · subida completa; el servidor la está guardando (' + (k + 1) + ' s)…', 100);
      await duerme(1000);
    }
    paso('subir', 'ok', tam(blob.size));
    return { elementos: out.nElem, triangulos: Math.round(out.nIdx / 3), avisos };
  }
  corre().then((r) => avisa(Object.assign({ fin: true, ok: true }, r)), async (e) => {
    if (visor) try { visor.finish(); } catch (x) {}
    msg(e.message);
    try { await api(F + '/modelos/' + encodeURIComponent(VID) + '/cancelar', { json: { motivo: e.message, paso: pasoActual, datos: Object.assign({}, datosPaso, { pila: String(e.stack || '').split('\n').slice(0, 3).join(' | ').slice(0, 400), memoria: memoria() }) } }); } catch (x) {}
    avisa({ fin: true, ok: false, error: e.message, codigo: e.codigo || '', status: e.status || 0 });
  });
})();
