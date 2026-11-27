/*
 * LIENZO DEL VISOR DE AUTODESK FORMA (v0.28.0). Página propia, incrustada por visor-forma.html: aísla la biblioteca del visualizador de
 * Autodesk (su THREE y sus estilos) de las páginas del CDE, igual que forma-paso.html. Aquí NO hay funciones del CDE: solo se abre la
 * traducción que Autodesk ya tiene del archivo (la misma que se ve en Forma) y se ofrece a la página que lo contiene, en window.LIENZO,
 * lo que necesita para mandar sobre el dibujo: aislar, ocultar, colorear, seleccionar, encuadrar y leer el árbol.
 *
 * LOS IDS. El visualizador abre la traducción SVF2, cuyos ids NO son los de la base de propiedades (SVF) con la que el CDE arma su índice.
 * Autodesk publica la correspondencia (dbid.idx): se pide como en forma-paso.js (PropDbLoader con needsDbIdRemap -> dbidOldToNew).
 * LIENZO.I = { v1(id del visualizador) -> id del índice (o -1), v2(id del índice) -> id del visualizador, tipo, otra }.
 */
(function () {
  'use strict';
  const duerme = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function api(url) {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error(j.mensaje || j.error || ('El CDE respondió ' + r.status)); e.status = r.status; e.codigo = j.error || ''; throw e; }
    return j;
  }
  function cargaLmv() {
    if (window.Autodesk && window.Autodesk.Viewing) return Promise.resolve();
    return new Promise((ok, mal) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/lmv/7.*/style.min.css'; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = '/lmv/7.*/viewer3D.min.js';
      s.onload = () => (window.Autodesk && window.Autodesk.Viewing ? ok() : mal(new Error('La biblioteca del visualizador de Autodesk no se inició.')));
      s.onerror = () => mal(new Error('No se pudo descargar el visualizador de Autodesk: el servidor del CDE necesita salida a internet (developer.api.autodesk.com).'));
      document.head.appendChild(s);
    });
  }
  function pideCorrespondencia() {
    const PL = Autodesk.Viewing.Private && Autodesk.Viewing.Private.PropDbLoader;
    if (!PL || !PL.prototype || PL.prototype.__cdeIds) return !!(PL && PL.prototype && PL.prototype.__cdeIds);
    const carga = PL.prototype.load, procesa = PL.prototype.processLoadResult;
    PL.prototype.load = function () { this.needsDbIdRemap = true; return carga.apply(this, arguments); };
    PL.prototype.processLoadResult = function (result) { const r = procesa.apply(this, arguments); try { if (result && result.dbidOldToNew && this.model) this.model.idRemap = result.dbidOldToNew; } catch (e) {} return r; };
    PL.prototype.__cdeIds = true; return true;
  }
  async function correspondencia(modelo) {
    const t0 = Date.now();
    for (;;) {
      let ok = false; try { const p = modelo.getPropertyDb && modelo.getPropertyDb(); ok = !!(modelo.getInstanceTree() && (!p || !p.isLoadDone || p.isLoadDone())); } catch (e) {}
      if (ok && (modelo.idRemap || Date.now() - t0 > 4000)) break;
      if (Date.now() - t0 > 600000) throw new Error('El visualizador de Autodesk no terminó de cargar el árbol del modelo.');
      await duerme(500);
    }
    let otg = false; try { otg = !!((modelo.isOTG && modelo.isOTG()) || (modelo.isSVF2 && modelo.isSVF2())); } catch (e) {}
    const rm = modelo.idRemap || null;
    if (!rm) { if (otg) return null; return { v1: (d) => d, v2: (d) => d, tipo: 'svf', n: 0 }; }   // null: SVF2 sin correspondencia (no se vinculan datos)
    let max = 0; for (let i = 0; i < rm.length; i++) if (rm[i] > max) max = rm[i];
    const inv = new Int32Array(max + 1).fill(-1); for (let o = 1; o < rm.length; o++) { const n = rm[o]; if (n > 0 && inv[n] < 0) inv[n] = o; }
    const A = { v1: (d) => (d > 0 && d < inv.length ? inv[d] : -1), v2: (d) => (d > 0 && d < rm.length ? rm[d] : -1), tipo: 'svf2', n: rm.length };
    const B = { v1: (d) => (d > 0 && d < rm.length ? rm[d] : -1), v2: (d) => (d > 0 && d < inv.length ? inv[d] : -1), tipo: 'svf2-inv', n: rm.length };
    A.otra = B; return A;
  }
  const inicia = (region) => new Promise((ok) => Autodesk.Viewing.Initializer({
    env: 'AutodeskProduction2', api: region === 'EMEA' ? 'streamingV2_EU' : 'streamingV2',
    getAccessToken: async (cb) => { for (let i = 0; i < 3; i++) { try { const t = await api('/api/forma/token-visor'); return cb(t.access_token, t.expires_in); } catch (e) { await duerme(1500); } } },
  }, ok));

  let visor = null, modelo = null, it = null, tanda = 0, callado = false;
  const L = window.LIENZO = {
    I: null, alSeleccionar: null, alAvance: null, alGeometria: null,
    get visor() { return visor; }, get modelo() { return modelo; },
    /** Abre la traducción de Autodesk. d: { urn, region }. Devuelve { vista, ids } cuando ya se puede mandar sobre el dibujo (la geometría sigue llegando). */
    async abre(d) {
      await cargaLmv(); await inicia(d.region); pideCorrespondencia();
      visor = new Autodesk.Viewing.GuiViewer3D(document.getElementById('lmv'), {}); visor.start();
      const doc = await new Promise((ok, mal) => Autodesk.Viewing.Document.load('urn:' + d.urn, ok, (cod, m) => mal(new Error('Autodesk no abrió la traducción del archivo (código ' + cod + (m ? ': ' + m : '') + '). Si el archivo es nuevo en Forma, espera a que Forma termine de procesarlo (que se vea allí) y vuelve a intentarlo.'))));
      const raiz = doc.getRoot(), def = raiz.getDefaultGeometry && raiz.getDefaultGeometry(), tres = raiz.search({ type: 'geometry', role: '3d' });
      const nodo = (def && def.is3D && def.is3D()) ? def : (tres.find((x) => x.data && x.data.isMasterView) || tres[0]);
      if (!nodo) throw new Error('El archivo no tiene una vista 3D traducida en Forma.');
      visor.addEventListener(Autodesk.Viewing.PROGRESS_UPDATE_EVENT, (e) => { if (e && typeof e.percent === 'number' && L.alAvance) try { L.alAvance(e.percent / 100); } catch (x) {} });
      visor.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => { if (L.alGeometria) try { L.alGeometria(); } catch (x) {} });
      modelo = await visor.loadDocumentNode(doc, nodo, { keepCurrentModels: false });
      L.I = await correspondencia(modelo); it = modelo.getInstanceTree();
      visor.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, (e) => { if (callado || !L.alSeleccionar) return; try { L.alSeleccionar((e && e.dbIdArray) || []); } catch (x) { console.warn(x); } });
      return { vista: (nodo.data && nodo.data.name) || '', ids: L.I ? L.I.tipo : 'sin-correspondencia' };
    },
    // ----- el árbol -----
    padreDe(d) { try { const p = it.getNodeParentId(d); return p > 0 ? p : 0; } catch (e) { return 0; } },
    nombreDe(d) { try { return it.getNodeName(d) || ''; } catch (e) { return ''; } },
    /** Una muestra de nodos con geometría (piezas), repartida por todo el árbol: [id del visualizador]. */
    piezas(max) {
      const todos = []; try { it.enumNodeChildren(it.getRootId(), (d) => { let n = 0; it.enumNodeFragments(d, () => { n++; }, false); if (n) todos.push(d); }, true); } catch (e) {}
      const salto = Math.max(1, Math.floor(todos.length / (max || 400))), out = []; for (let i = 0; i < todos.length && out.length < (max || 400); i += salto) out.push(todos[i]);
      return { total: todos.length, muestra: out };
    },
    propiedades(d) { return new Promise((ok) => { try { visor.getProperties(d, (r) => ok(r || {}), () => ok({})); } catch (e) { ok({}); } }); },
    // ----- el dibujo (ids del visualizador) -----
    /** ids: arreglo -> solo eso; null -> todo. ocultos: arreglo que además se oculta. */
    visibles(ids, ocultos) {
      if (!visor || !modelo) return;
      if (ids == null) visor.showAll(); else if (!ids.length) { visor.showAll(); visor.hide(it.getRootId(), modelo); } else visor.isolate(ids, modelo);
      if (ocultos && ocultos.length) visor.hide(ocultos, modelo);
    },
    fantasma(si) { if (visor) visor.setGhosting(!!si); },
    /** pares: [[id, [r, g, b] en sRGB 0..1], …]. Sustituye los colores anteriores. Por tandas, para no congelar la página con cientos de miles. */
    async colores(pares) {
      if (!visor || !modelo) return; const mia = ++tanda; visor.clearThemingColors(modelo);
      const V4 = THREE.Vector4, cache = new Map();
      for (let i = 0; i < pares.length; i++) {
        const c = pares[i][1], k = c[0] + ',' + c[1] + ',' + c[2]; let v = cache.get(k); if (!v) { v = new V4(c[0], c[1], c[2], 1); cache.set(k, v); }
        visor.setThemingColor(pares[i][0], v, modelo, true);
        if ((i & 0x3fff) === 0x3fff) { await duerme(0); if (mia !== tanda) return; }
      }
      try { visor.impl.invalidate(true, true, false); } catch (e) {}
    },
    selecciona(ids) { if (!visor || !modelo) return; callado = true; try { visor.select(ids || [], modelo); } finally { callado = false; } },
    encuadra(ids) { if (!visor) return; if (ids && ids.length) visor.fitToView(ids, modelo); else visor.fitToView(); },
    // ----- v0.29.3 · la geometría, para los módulos que calculan con ella (interferencias, incidencias con cámara). Coordenadas del CDE:
    //       metros y Z arriba, las mismas del .cdeg del visor propio (CDEG.censa: la receta del paso de Forma, ya probada). -----
    /** Censo de piezas: { n, db(f) -> id del visualizador, caja Float32Array(6 por pieza), tipo (1 malla, 2 líneas) }. Se hace una vez. */
    async censo(alAvance) {
      if (L._censo) return L._censo; if (!modelo || !window.CDEG) throw new Error('El modelo aún no está listo.');
      const C = window.CDEG, Lc = C.censa(modelo, { visor, Matriz: THREE.Matrix4, Caja: THREE.Box3 }), TRAMO = 4000;
      for (let i = 0; i < Lc.n; i += TRAMO) { C.censaTramo(Lc, i, i + TRAMO); if (alAvance) try { alAvance(Math.min(1, (i + TRAMO) / Lc.n)); } catch (e) {} await duerme(0); }
      L._L = Lc; L._censo = { n: Lc.n, db: (f) => Lc.dbDe(f), caja: Lc.caja, tipo: Lc.tipo, escala: Lc.escala }; return L._censo;
    },
    /** Los triángulos de unas piezas, ya en coordenadas del CDE: Float32Array de 9 números por triángulo (tope de triángulos; null si se pasa). */
    triangulos(fids, tope) {
      const Lc = L._L; if (!Lc) return null; const C = window.CDEG, s = Lc.escala; let total = 0; const partes = [];
      for (const f of fids) {
        if (Lc.tipo[f] !== 1) continue; const d = C.geomPieza(modelo, visor, f, THREE.Matrix4); if (!d || !d.ib || d.lineas) continue;
        total += d.ib.length / 3; if (tope && total > tope) return null;
        const e = d.M, out = new Float32Array(d.ib.length * 3);
        for (let k = 0; k < d.ib.length; k++) { const q = d.ib[k] * d.paso + d.des, X = d.pos[q], Y = d.pos[q + 1], Z = d.pos[q + 2]; const w = Lc.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); out[k * 3] = w[0]; out[k * 3 + 1] = w[1]; out[k * 3 + 2] = w[2]; }
        partes.push(out);
      }
      let n = 0; for (const p of partes) n += p.length; const todo = new Float32Array(n); let o = 0; for (const p of partes) { todo.set(p, o); o += p.length; } return todo;
    },
    /** La cámara, en coordenadas del CDE (las que guarda una incidencia): { pos, dir, up, fov }. */
    camara() {
      const Lc = L._L || window.CDEG.prepara(modelo, {}), s = Lc.escala, nav = visor.navigation, p = nav.getPosition(), t = nav.getTarget();
      const pos = Lc.aZ(p.x * s, p.y * s, p.z * s), ob = Lc.aZ(t.x * s, t.y * s, t.z * s), d = [ob[0] - pos[0], ob[1] - pos[1], ob[2] - pos[2]], m = Math.hypot(d[0], d[1], d[2]) || 1;
      let fov = 45; try { fov = nav.getVerticalFov(); } catch (e) {}
      return { pos, dir: [d[0] / m, d[1] / m, d[2] / m], up: [0, 0, 1], fov };
    },
    /** Lleva la cámara a una guardada. objetivo: punto del CDE al que mirar (o null: 20 m hacia delante). */
    ponCamara(c, objetivo) {
      const Lc = L._L || window.CDEG.prepara(modelo, {}), s = Lc.escala || 1, inv = (v) => (Lc.yArriba ? [v[0], v[2], -v[1]] : [v[0], v[1], v[2]]);
      const ob = objetivo || [c.pos[0] + c.dir[0] * 20, c.pos[1] + c.dir[1] * 20, c.pos[2] + c.dir[2] * 20], a = inv(c.pos), b = inv(ob), arr = inv([0, 0, 1]);
      const V3 = THREE.Vector3; visor.navigation.setView(new V3(a[0] / s, a[1] / s, a[2] / s), new V3(b[0] / s, b[1] / s, b[2] / s));
      try { visor.navigation.setCameraUpVector(new V3(arr[0], arr[1], arr[2])); if (c.fov) visor.navigation.setVerticalFov(c.fov, true); } catch (e) {}
    },
    cierra() { try { if (visor) visor.finish(); } catch (e) {} visor = null; modelo = null; it = null; }
  };
})();
