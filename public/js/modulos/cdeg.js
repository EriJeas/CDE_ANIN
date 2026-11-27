/*
 * GEOMETRIA DEL CDE (.cdeg, docs/FORMATO-PAQUETE.md, formato 2) A PARTIR DE UN MODELO ABIERTO EN EL VISOR DE AUTODESK.
 * Para los modelos traidos de Forma que el CDE no puede leer solo (NWD): Autodesk ya los tradujo para verlos en Forma; el visor
 * de Autodesk los abre en el navegador y de ahi se leen las mallas con la MISMA receta del Visor BIM (trisDeFragmento de app.js:
 * la lista de fragmentos o, en SVF2, el proxy de render), pieza por pieza, juntando las piezas de cada elemento (dbId).
 * El dbId es el mismo id que el indice de parametros (objectid de la base de propiedades), asi el visor del CDE los cruza.
 * Sin dependencias: corre en el navegador (CDE.N.cdeg) y en Node (pruebas).
 */
(function (raiz) {
  'use strict';
  /** La geometria cruda de una pieza (receta del visor): { ib, pos, paso, lineas, M } o null. */
  function geomPieza(modelo, visor, fid, Matriz) {
    const saca = (g) => {
      if (!g) return null;
      const ib = g.ib || (g.index && g.index.array) || (g.attributes && g.attributes.index && g.attributes.index.array);
      let pos = null, paso = 3, des = 0;
      if (g.vb && g.vbstride) { pos = g.vb; paso = g.vbstride; des = (g.vblayout && g.vblayout.position && g.vblayout.position.offset) || 0; }
      else if (g.attributes && g.attributes.position) { const at = g.attributes.position; if (at.data && at.data.stride) { pos = at.data.array; paso = at.data.stride; des = at.offset || 0; } else { pos = at.array; paso = at.itemSize || 3; } }
      if (!pos) return null;
      const lineas = !!(g.isLines || g.isWideLines || g.isPoints);
      let ibx = ib; if (!ibx && !lineas) { const nv = Math.floor((pos.length - des) / paso); ibx = new Uint32Array(nv - nv % 3); for (let k = 0; k < ibx.length; k++) ibx[k] = k; }   // sin indices: triangulos seguidos
      // color propio por vertice (las lineas de un arbol CAD 3D o de un escudo traen el suyo): rgb 0-255 o null
      let colorDe = null;
      try {
        // v0.13.12: el visor de Autodesk guarda el color dentro del mismo vb (desplazamiento en unidades de 4 bytes), unas veces
        // descrito en vblayout y otras solo en attributes.color sin arreglo propio (asi vienen las lineas del BM de 100020)
        const vc = g.vblayout && g.vblayout.color, ac = g.attributes && g.attributes.color, acSuelto = ac && !ac.array && !(ac.data && ac.data.array);
        if (g.vb && pos === g.vb && (vc || (acSuelto && ac.offset != null))) {
          const k = vc || ac, co = k.offset || 0, bpi = k.bytesPerItem || 1;
          if (bpi === 1 && pos.buffer) { const cb = new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength); colorDe = (v) => { const o = (v * paso + co) * 4; return o + 2 < cb.length ? [cb[o], cb[o + 1], cb[o + 2]] : null; }; }
          else if (bpi === 4) colorDe = (v) => { const o = v * paso + co; return o + 2 < pos.length ? [pos[o] * 255, pos[o + 1] * 255, pos[o + 2] * 255].map(Math.round) : null; };
        } else if (ac && !acSuelto) { const ar = ac.data ? ac.data.array : ac.array, st = ac.data ? ac.data.stride : (ac.itemSize || 3), of = ac.offset || 0, f = !(ar instanceof Uint8Array); colorDe = (v) => { const o = v * st + of; return o + 2 < ar.length ? (f ? [ar[o] * 255, ar[o + 1] * 255, ar[o + 2] * 255].map(Math.round) : [ar[o], ar[o + 1], ar[o + 2]]) : null; }; }
      } catch (e) { colorDe = null; }
      // un color que no se pueda leer nunca detiene el armado: la linea queda con el color de su material
      if (colorDe) { const leer = colorDe; colorDe = (v) => { try { const c = leer(v); return c && c.every((x) => x >= 0 && x <= 255) ? c : null; } catch (e) { return null; } }; }
      return { ib: ibx, pos, paso, des, lineas, colorDe };
    };
    let d = null, M = null;
    try { d = saca(modelo.getFragmentList().getGeometry(fid)); } catch (e) {}
    if (!d && visor && visor.impl && visor.impl.getRenderProxy) { try { const px = visor.impl.getRenderProxy(modelo, fid); if (px && px.geometry) { d = saca(px.geometry); if (d && px.matrixWorld) M = px.matrixWorld.elements.slice(); } } catch (e) {} }
    if (!d) return null;
    if (!M) { const m = new Matriz(); modelo.getFragmentList().getWorldMatrix(fid, m); M = Array.from(m.elements); }
    d.M = M; return d;
  }
  /** Color sRGB [r,g,b,a] (0-255) del material de una pieza; gris si no se puede leer. */
  function colorPieza(modelo, fid) {
    try {
      const m = modelo.getFragmentList().getMaterial(fid);
      const c = m && (m.color || (m.uniforms && m.uniforms.diffuse && m.uniforms.diffuse.value));
      const op = m && m.transparent ? (typeof m.opacity === 'number' ? m.opacity : 1) : 1;
      if (c && typeof c.r === 'number') return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(Math.max(0.15, Math.min(1, op)) * 255)];
    } catch (e) {}
    return [200, 200, 200, 255];
  }
  /**
   * Lectura por tramos (asi el navegador no se congela con cientos de miles de piezas): prepara(modelo, o) -> lectura;
   * leeTramo(lectura, desde, hasta); cierra(lectura) -> L. o: { visor, Matriz (THREE.Matrix4) }.
   * L = { elems: [{ e, piezas: [{ d, rgba }] }], escala, arriba, yArriba, origen, aZ, sinMalla, lineas, piezas }.
   */
  function prepara(modelo, o) {
    o = o || {};
    const fl = modelo.getFragmentList(), n = fl.getCount ? fl.getCount() : (fl.fragments && fl.fragments.length) || 0;
    const f2d = fl.fragments && fl.fragments.fragId2dbId;
    let dbDe = (fid) => (f2d ? f2d[fid] : -1);
    if (!f2d) {   // sin la tabla interna: el arbol de instancias
      const m = new Map(), it = modelo.getInstanceTree && modelo.getInstanceTree();
      if (it) it.enumNodeChildren(it.getRootId(), (db) => { it.enumNodeFragments(db, (f) => { m.set(f, db); }, false); }, true);
      dbDe = (fid) => (m.has(fid) ? m.get(fid) : -1);
    }
    let escala = 1; try { escala = Number(modelo.getUnitScale()) || 1; } catch (e) {}
    let arriba = [0, 0, 1]; try { const u = modelo.getUpVector && modelo.getUpVector(); if (u && u.length === 3) arriba = Array.from(u); } catch (e) {}
    let go = { x: 0, y: 0, z: 0 }; try { const g = modelo.getData().globalOffset; if (g) go = { x: +g.x || 0, y: +g.y || 0, z: +g.z || 0 }; } catch (e) {}
    const yArriba = Math.abs(arriba[1]) > 0.9 && Math.abs(arriba[2]) < 0.1;
    const aZ = (x, y, z) => (yArriba ? [x, -z, y] : [x, y, z]);   // al eje del CDE (Z arriba, como Revit)
    return { modelo, o, n, dbDe, escala, arriba, yArriba, aZ, origen: aZ(go.x * escala, go.y * escala, go.z * escala), porE: new Map(), sinMalla: 0, lineas: 0 };
  }
  function leeTramo(L, desde, hasta) {
    for (let fid = desde; fid < Math.min(hasta, L.n); fid++) {
      const db = L.dbDe(fid); if (db == null || db < 0) continue;
      const d = geomPieza(L.modelo, L.o.visor, fid, L.o.Matriz);
      if (!d) { L.sinMalla++; continue; }
      if (d.lineas || !d.ib || !d.ib.length) { L.lineas++; continue; }
      if (!L.porE.has(db)) L.porE.set(db, []);
      L.porE.get(db).push({ d, rgba: colorPieza(L.modelo, fid) });
    }
  }
  function cierra(L) {
    return { elems: [...L.porE].sort((a, b) => a[0] - b[0]).map(([e, piezas]) => ({ e, piezas })), escala: L.escala, arriba: L.arriba, yArriba: L.yArriba, origen: L.origen, aZ: L.aZ, sinMalla: L.sinMalla, lineas: L.lineas, piezas: L.n };
  }
  /**
   * Junta las piezas en su ELEMENTO, el mismo que el indice (clase 1): en un NWD la malla cuelga de nodos hijos (los solidos)
   * del elemento de Revit, y el visor del CDE filtra, colorea y muestra propiedades por elemento. esElem(id) -> bool;
   * padreDe(id) -> id del padre (o null). Una pieza sin elemento antecesor se queda con su propio id.
   */
  function agrupa(L, esElem, padreDe) {
    const porE = new Map(), memo = new Map(); let sinElem = 0;
    const destino = (db) => {
      if (memo.has(db)) return memo.get(db);
      let d = db, k = 0, r = null; const camino = [];
      while (d != null && d > 0 && k++ < 60) { if (memo.has(d)) { r = memo.get(d); break; } camino.push(d); if (esElem(d)) { r = d; break; } d = padreDe(d); }
      for (const c of camino) memo.set(c, r);
      return r;
    };
    for (const x of L.elems) { let t = destino(x.e); if (t == null) { t = x.e; sinElem++; } if (!porE.has(t)) porE.set(t, []); porE.get(t).push(...x.piezas); }
    return Object.assign({}, L, { elems: [...porE].sort((a, b) => a[0] - b[0]).map(([e, piezas]) => ({ e, piezas })), sinElemento: sinElem });
  }
  function leeModelo(modelo, o) { const L = prepara(modelo, o); leeTramo(L, 0, L.n); return cierra(L); }
  /** Arma el .cdeg (formato 2) con lo que devolvio leeModelo. meta: { modelo, herramienta, ... }. Devuelve { partes: [ArrayBuffer...], nElem, nVert, nIdx }. */
  function escribe(L, meta) {
    const elems = L.elems; let nVert = 0, nIdx = 0;
    // primero las piezas opacas y al final las translucidas (vidrio): el visor dibuja translucidos los ultimos icTr indices
    for (const x of elems) { x.piezas.sort((a, b) => (a.rgba[3] < 250) - (b.rgba[3] < 250)); for (const p of x.piezas) { nVert += Math.floor((p.d.pos.length - p.d.des) / p.d.paso); nIdx += p.d.ib.length; } }
    const pos = new Float32Array(nVert * 3), idx = new Uint32Array(nIdx), col = new Uint8Array(nVert * 3 + ((4 - (nVert * 3) % 4) % 4));
    const tabla = new DataView(new ArrayBuffer(24 * elems.length)), icTr = new Uint32Array(elems.length);
    const s = L.escala, o0 = L.origen; let vo = 0, io = 0;
    elems.forEach((x, i) => {
      const v0 = vo, i0 = io; let tr = 0;
      for (const p of x.piezas) {
        const d = p.d, e = d.M, nv = Math.floor((d.pos.length - d.des) / d.paso);
        for (let k = 0; k < nv; k++) {
          const b = k * d.paso + d.des, X = d.pos[b], Y = d.pos[b + 1], Z = d.pos[b + 2];
          const w = L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s);
          const t = (vo + k) * 3; pos[t] = w[0]; pos[t + 1] = w[1]; pos[t + 2] = w[2]; col[t] = p.rgba[0]; col[t + 1] = p.rgba[1]; col[t + 2] = p.rgba[2];
        }
        const base = vo - v0; for (let k = 0; k < d.ib.length; k++) idx[io + k] = d.ib[k] + base;
        if (p.rgba[3] < 250) tr += d.ib.length;
        vo += nv; io += d.ib.length;
      }
      const todoVidrio = tr && tr === io - i0, c = x.piezas[0].rgba, off = i * 24;
      tabla.setUint32(off, x.e >>> 0, true); tabla.setUint32(off + 4, v0, true); tabla.setUint32(off + 8, vo - v0, true); tabla.setUint32(off + 12, i0, true); tabla.setUint32(off + 16, io - i0, true);
      tabla.setUint8(off + 20, c[0]); tabla.setUint8(off + 21, c[1]); tabla.setUint8(off + 22, c[2]); tabla.setUint8(off + 23, todoVidrio ? Math.min(c[3], 199) : 255);
      icTr[i] = todoVidrio ? 0 : tr;
    });
    const m = new TextEncoder().encode(JSON.stringify(Object.assign({ unidades: 'm', ejeArriba: 'Z', origen: o0, fecha: new Date().toISOString() }, meta || {})));
    const cab = new DataView(new ArrayBuffer(36 + m.length + ((4 - (36 + m.length) % 4) % 4)));
    'CDEG'.split('').forEach((ch, k) => cab.setUint8(k, ch.charCodeAt(0)));
    cab.setUint32(4, 2, true); cab.setUint32(8, elems.length, true); cab.setUint32(12, nVert, true); cab.setUint32(16, nIdx, true);
    cab.setFloat32(20, o0[0], true); cab.setFloat32(24, o0[1], true); cab.setFloat32(28, o0[2], true); cab.setUint32(32, m.length, true);
    new Uint8Array(cab.buffer).set(m, 36);
    return { partes: [cab.buffer, tabla.buffer, pos.buffer, idx.buffer, icTr.buffer, col.buffer], nElem: elems.length, nVert, nIdx };
  }

  /* ───────── MODELOS GRANDES (federados NWD): con el criterio del complemento de Navisworks del CDE (complemento-navisworks/
   * src/Paquete.cs, detalle «medio»): el acero de refuerzo va solo con propiedades y, si el modelo pasa del tope de 4 millones de
   * triangulos, lo pesado (mas de 300 triangulos por pieza) se aligera colapsando aristas SIN mover la superficie mas de 1 cm
   * (Decima). La forma manda: si aun asi pasa del tope, se deja (mejor triangulos de mas que letras y perfiles deformados). Antes
   * se juntaban vertices en una rejilla hasta llegar a un numero de triangulos: partia letras y vidrios en astillas.
   * El navegador si tiene un limite: si el resultado pasara de 10 millones de triangulos (el tope del detalle «alto» del
   * complemento), los elementos mas chicos van como su caja (12 triangulos: se ven, se seleccionan y se filtran); nunca se
   * deforma nada. Cada elemento lleva sus aristas precalculadas (como el complemento), para que el visor no las calcule.
   * Un federado reutiliza la malla de las piezas repetidas (puertas, aparatos): cada malla repetida se aligera una sola vez.
   * 1) censo: por pieza, sus triangulos, su caja, su color y su malla (sin tocar los vertices);
   * 2) plan: que pieza se aligera; 3) armado: de los elementos mas grandes a los mas chicos, escribiendo en trozos. */
  const OPC = { tope: 4000000, topeSeguro: 10000000, topePieza: 20000, liviano: 300, tolerancia: 0.01 };
  const esAcero = (s) => /armadura|refuerzo|rebar|reinforc|acoplador|coupler/i.test(String(s || ''));
  function censa(modelo, o) {
    const L = prepara(modelo, o), n = L.n;
    Object.assign(L, { tri: new Uint32Array(n), caja: new Float32Array(n * 6), rgba: new Uint8Array(n * 4), tipo: new Uint8Array(n), triEntrada: 0, nMalla: 0, gid: new Int32Array(n).fill(-1), gmap: new Map(), gcount: [] });
    L.B = o && o.Caja ? new o.Caja() : null;
    return L;
  }
  function censaTramo(L, desde, hasta) {
    const fl = L.modelo.getFragmentList(), B = L.B, s = L.escala;
    for (let fid = desde; fid < Math.min(hasta, L.n); fid++) {
      const db = L.dbDe(fid); if (db == null || db < 0) continue;
      let g = null; try { g = fl.getGeometry(fid); } catch (e) {}
      if (!g && L.o.visor && L.o.visor.impl && L.o.visor.impl.getRenderProxy) { try { const px = L.o.visor.impl.getRenderProxy(L.modelo, fid); g = px && px.geometry; } catch (e) {} }
      if (!g) { L.sinMalla++; continue; }
      if (g.isLines || g.isWideLines || g.isPoints) { L.lineas++; L.tipo[fid] = 2; continue; }
      const ib = g.ib || (g.index && g.index.array) || (g.attributes && g.attributes.index && g.attributes.index.array);
      let nIdx = ib ? ib.length : 0;
      if (!nIdx) { const d = geomPieza(L.modelo, L.o.visor, fid, L.o.Matriz); nIdx = d && d.ib ? d.ib.length : 0; }
      if (!nIdx) { L.sinMalla++; continue; }
      let a = null, b = null;
      if (B && fl.getWorldBounds) { try { fl.getWorldBounds(fid, B); a = L.aZ(B.min.x * s, B.min.y * s, B.min.z * s); b = L.aZ(B.max.x * s, B.max.y * s, B.max.z * s); } catch (e) { a = null; } }
      if (!a) {   // sin cajas del visor: se mide la pieza
        const d = geomPieza(L.modelo, L.o.visor, fid, L.o.Matriz); if (!d) { L.sinMalla++; continue; }
        const e = d.M, nv = Math.floor((d.pos.length - d.des) / d.paso); a = [Infinity, Infinity, Infinity]; b = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < nv; k++) { const q = k * d.paso + d.des, X = d.pos[q], Y = d.pos[q + 1], Z = d.pos[q + 2]; const w = L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); for (let j = 0; j < 3; j++) { if (w[j] < a[j]) a[j] = w[j]; if (w[j] > b[j]) b[j] = w[j]; } }
      }
      const o6 = fid * 6; for (let j = 0; j < 3; j++) { L.caja[o6 + j] = Math.min(a[j], b[j]); L.caja[o6 + 3 + j] = Math.max(a[j], b[j]); }
      const c = colorPieza(L.modelo, fid); L.rgba.set(c, fid * 4);
      L.tri[fid] = Math.floor(nIdx / 3); L.tipo[fid] = 1; L.triEntrada += L.tri[fid]; L.nMalla++;
      if (L.gmap && g && typeof g === 'object') { let k = L.gmap.get(g); if (k === undefined) { k = L.gcount.length; L.gmap.set(g, k); L.gcount.push(0); } L.gid[fid] = k; L.gcount[k]++; }   // la malla (repetida o no)
    }
  }
  const ext = (L, f, j) => L.caja[f * 6 + 3 + j] - L.caja[f * 6 + j];
  const diag = (L, f) => Math.hypot(ext(L, f, 0), ext(L, f, 1), ext(L, f, 2));
  /** Decide que hace con cada pieza. fuera(fid) -> true para omitirla (acero de refuerzo). Devuelve { modo, meta, cifras, op }:
   *  modo 0 fuera, 1 tal cual, 2 aligerada con la tolerancia hacia meta triangulos (sin pasar de la tolerancia). Como el
   *  complemento: si el modelo cabe, solo lo que pasa de 20.000 triangulos por pieza; si pasa del tope, todo lo pesado. */
  function planifica(L, fuera, op) {
    op = Object.assign({}, OPC, op || {});
    const n = L.n, modo = new Uint8Array(n), meta = new Uint32Array(n);
    let T = 0, nAcero = 0, triAcero = 0, piezas = 0;
    for (let f = 0; f < n; f++) { if (L.tipo[f] !== 1) continue; if (fuera && fuera(f)) { nAcero++; triAcero += L.tri[f]; continue; } piezas++; T += L.tri[f]; }
    const pasa = T > op.tope * 1.25;   // el visor dibuja bien unos millones mas o menos
    const C = { triEntrada: L.triEntrada, triCandidatas: T, piezas, nAcero, triAcero, nAligeradas: 0, nTalCual: 0, tope: op.tope, topeSeguro: op.topeSeguro, tolerancia: op.tolerancia, pasaDelTope: pasa };
    for (let f = 0; f < n; f++) {
      if (L.tipo[f] !== 1 || (fuera && fuera(f))) continue;
      if (pasa ? L.tri[f] > op.liviano : L.tri[f] > op.topePieza) { modo[f] = 2; meta[f] = pasa ? 12 : op.topePieza; C.nAligeradas++; }
      else { modo[f] = 1; C.nTalCual++; }
    }
    return { modo, meta, cifras: C, op };
  }
  /** Los elementos de lo que mas se ve a lo que menos: el tamano de su silueta (el producto de las dos medidas mayores de su
   *  caja, en m2). Un muro, una losa, un panel del cerco o un equipo van antes que un tubo largo y delgado (que como caja
   *  orientada casi no cambia) y que una union de 10 cm. Si algo tiene que ir como caja por el limite del navegador, que sea
   *  lo que menos se nota. Devuelve una lista nueva. */
  function silueta(L, plan, x) {
    const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; let hay = false;
    for (const f of x.fids) if (plan.modo[f]) { hay = true; for (let j = 0; j < 3; j++) { a[j] = Math.min(a[j], L.caja[f * 6 + j]); b[j] = Math.max(b[j], L.caja[f * 6 + 3 + j]); } }
    if (!hay) return -1;
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]].sort((p, q) => q - p);
    return e[0] * e[1];
  }
  function ordena(L, plan, elems) {
    const t = elems.map((x) => [silueta(L, plan, x), x]);
    t.sort((a, b) => b[0] - a[0]);
    return t.map((p) => p[1]);
  }
  /*
   * ALIGERADO POR COLAPSO DE ARISTAS CON ERROR CUADRATICO (QEM, Garland-Heckbert): el MISMO de Decima en Paquete.cs del
   * complemento de Navisworks, llevado a JavaScript. Quita primero las aristas cuyo colapso casi no cambia la forma y no colapsa
   * nada que mueva la superficie mas que tol (un marco de ventana, una letra o un poste delgado no se deforman aunque falte
   * llegar al objetivo). Los bordes abiertos, el borde de una lamina de dos caras (vidrios, placas y letreros modelados como
   * dos caras opuestas con los mismos vertices) y las aristas de 3 o mas caras se sujetan con un plano de mucho peso: sin eso,
   * en un vidrio de dos caras mover una esquina sobre la otra no tenia error y medio vidrio desaparecia (ventanas "rotas" en
   * triangulos). Al final, un vertice se comparte entre las caras cuya normal difiere menos de 40 grados y se separa en las
   * aristas vivas (las esquinas siguen nitidas). P: posiciones (x,y,z) en las unidades de tol; I: indices; q: lo que se suelda
   * (0,1 mm en metros, como el complemento). Devuelve { P: Float32Array, I: Uint32Array } o null si no cambio nada.
   */
  function decima(P0, I0, nv0, objetivo, tol, q) {
    const ni0 = I0.length; if (!nv0 || ni0 / 3 <= objetivo || objetivo < 4) return null;
    const umbral = tol > 0 ? 4 * tol * tol : Infinity, iq = 1 / (q || 1e-4);
    // 1) soldar vertices por posicion (los separados por la normal vuelven a ser uno)
    let cap = 16; while (cap < nv0 * 2) cap *= 2;
    const hT = new Int32Array(cap).fill(-1), mapa = new Int32Array(nv0), kx = new Float64Array(nv0), ky = new Float64Array(nv0), kz = new Float64Array(nv0), P = new Float64Array(nv0 * 3);
    let nv = 0;
    for (let v = 0; v < nv0; v++) {
      const X = Math.floor(P0[v * 3] * iq), Y = Math.floor(P0[v * 3 + 1] * iq), Z = Math.floor(P0[v * 3 + 2] * iq);
      let h = (Math.imul(X | 0, 73856093) ^ Math.imul(Y | 0, 19349663) ^ Math.imul(Z | 0, 83492791)) & (cap - 1), w;
      for (;;) { w = hT[h]; if (w < 0 || (kx[w] === X && ky[w] === Y && kz[w] === Z)) break; h = (h + 1) & (cap - 1); }
      if (w < 0) { w = nv++; hT[h] = w; kx[w] = X; ky[w] = Y; kz[w] = Z; P[w * 3] = P0[v * 3]; P[w * 3 + 1] = P0[v * 3 + 1]; P[w * 3 + 2] = P0[v * 3 + 2]; }
      mapa[v] = w;
    }
    const cara = new Int32Array(ni0); let nc = 0;
    for (let t = 0; t + 2 < ni0; t += 3) { const a = mapa[I0[t]], b = mapa[I0[t + 1]], c = mapa[I0[t + 2]]; if (a !== b && b !== c && a !== c) { cara[nc++] = a; cara[nc++] = b; cara[nc++] = c; } }
    const nf = nc / 3; if (nf <= objetivo) return null;
    const N = [0, 0, 0, 0];   // nx, ny, nz, area
    const normal = (a, b, c) => {
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l > 1e-20) { N[0] = nx / l; N[1] = ny / l; N[2] = nz / l; N[3] = l / 2; } else { N[0] = N[1] = N[2] = 0; N[3] = 0; }
      return N;
    };
    const Q = new Float64Array(nv * 10), viva = new Uint8Array(nf).fill(1), vc = new Array(nv);
    for (let v = 0; v < nv; v++) vc[v] = [];
    const suma = (v, a, b, c, d, w) => { const o = v * 10; Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d; Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d; Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d; };
    const claves = new Float64Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      const a = cara[f * 3], b = cara[f * 3 + 1], c = cara[f * 3 + 2]; vc[a].push(f); vc[b].push(f); vc[c].push(f);
      claves[f * 3] = a < b ? a * nv + b : b * nv + a; claves[f * 3 + 1] = b < c ? b * nv + c : c * nv + b; claves[f * 3 + 2] = c < a ? c * nv + a : a * nv + c;
      normal(a, b, c); if (N[3] <= 0) continue;
      const nx = N[0], ny = N[1], nz = N[2], d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
      suma(a, nx, ny, nz, d, 1); suma(b, nx, ny, nz, d, 1); suma(c, nx, ny, nz, d, 1);   // peso 1: el error queda en m^2
    }
    claves.sort();
    const aristas = []; for (let k = 0; k < claves.length; k++) if (k === 0 || claves[k] !== claves[k - 1]) aristas.push(claves[k]);
    // bordes abiertos, laminas de dos caras y aristas de 3 o mas caras: un plano perpendicular al borde, con mucho peso
    const deArista = [0, 0, 0];
    for (const kk of aristas) {
      const a = Math.floor(kk / nv), b = kk - a * nv; let nCaras = 0;
      for (const f of vc[a]) { const x = cara[f * 3], y = cara[f * 3 + 1], z = cara[f * 3 + 2]; if (x === b || y === b || z === b) { if (nCaras < 3) deArista[nCaras] = f; nCaras++; } }
      if (nCaras === 0) continue;
      if (nCaras === 2) {
        const f0 = deArista[0], f1 = deArista[1];
        normal(cara[f0 * 3], cara[f0 * 3 + 1], cara[f0 * 3 + 2]); const n0x = N[0], n0y = N[1], n0z = N[2], a0 = N[3];
        normal(cara[f1 * 3], cara[f1 * 3 + 1], cara[f1 * 3 + 2]); const a1 = N[3];
        if (a0 > 0 && a1 > 0 && n0x * N[0] + n0y * N[1] + n0z * N[2] > -0.5) continue;   // arista interior comun: sin plano extra
      }
      const f = deArista[0]; normal(cara[f * 3], cara[f * 3 + 1], cara[f * 3 + 2]); if (N[3] <= 0) continue;
      const nx = N[0], ny = N[1], nz = N[2], ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
      let qx = ey * nz - ez * ny, qy = ez * nx - ex * nz, qz = ex * ny - ey * nx; const l = Math.sqrt(qx * qx + qy * qy + qz * qz); if (l <= 0) continue;
      qx /= l; qy /= l; qz /= l; const d = -(qx * P[a * 3] + qy * P[a * 3 + 1] + qz * P[a * 3 + 2]);
      suma(a, qx, qy, qz, d, 10); suma(b, qx, qy, qz, d, 10);
    }
    const err = (a, b, x, y, z) => {
      const oa = a * 10, ob = b * 10, q0 = Q[oa] + Q[ob], q1 = Q[oa + 1] + Q[ob + 1], q2 = Q[oa + 2] + Q[ob + 2], q3 = Q[oa + 3] + Q[ob + 3], q4 = Q[oa + 4] + Q[ob + 4], q5 = Q[oa + 5] + Q[ob + 5], q6 = Q[oa + 6] + Q[ob + 6], q7 = Q[oa + 7] + Q[ob + 7], q8 = Q[oa + 8] + Q[ob + 8], q9 = Q[oa + 9] + Q[ob + 9];
      return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
    };
    // 2) colapsos, de menor a mayor error (monticulo binario con marcas de version)
    const ver = new Int32Array(nv), muerto = new Uint8Array(nv), hC = [], hI = [], eA = [], eB = [], eVa = [], eVb = [], eO = [];
    const subeH = (c, id) => { hC.push(c); hI.push(id); let i = hC.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hC[p] <= hC[i]) break; const tc = hC[p]; hC[p] = hC[i]; hC[i] = tc; const ti = hI[p]; hI[p] = hI[i]; hI[i] = ti; i = p; } };
    const sacaH = () => {
      const id = hI[0], u = hC.length - 1; hC[0] = hC[u]; hI[0] = hI[u]; hC.pop(); hI.pop(); let i = 0; const n = hC.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && hC[l] < hC[m]) m = l; if (r < n && hC[r] < hC[m]) m = r; if (m === i) break; const tc = hC[m]; hC[m] = hC[i]; hC[i] = tc; const ti = hI[m]; hI[m] = hI[i]; hI[i] = ti; i = m; }
      return id;
    };
    const punto = (a, b, opc, j) => opc === 0 ? P[a * 3 + j] : opc === 1 ? P[b * 3 + j] : (P[a * 3 + j] + P[b * 3 + j]) / 2;
    const mete = (a, b) => {
      if (a === b || muerto[a] || muerto[b]) return;
      let best = Infinity, donde = 0;   // se prueba dejar el vertice en a, en b o en el medio; el de menor error
      for (let opc = 0; opc < 3; opc++) { const e = err(a, b, punto(a, b, opc, 0), punto(a, b, opc, 1), punto(a, b, opc, 2)); if (e < best) { best = e; donde = opc; } }
      const id = eA.length; eA.push(a); eB.push(b); eVa.push(ver[a]); eVb.push(ver[b]); eO.push(donde); subeH(best, id);
    };
    for (const kk of aristas) { const a = Math.floor(kk / nv); mete(a, kk - a * nv); }
    let vivas = nf; const vecinos = new Set();
    while (vivas > objetivo && hC.length) {
      if (hC[0] > umbral) break;   // lo que queda cambiaria la forma mas que la tolerancia
      const id = sacaH(), a = eA[id], b = eB[id]; if (muerto[a] || muerto[b] || ver[a] !== eVa[id] || ver[b] !== eVb[id]) continue;
      const opc = eO[id], x = punto(a, b, opc, 0), y = punto(a, b, opc, 1), z = punto(a, b, opc, 2);
      // no se colapsa si alguna cara se da vuelta
      let vuelta = false;
      for (let s2 = 0; s2 < 2 && !vuelta; s2++) {
        const vv = s2 === 0 ? a : b;
        for (const f of vc[vv]) {
          if (!viva[f]) continue; const i0 = cara[f * 3], i1 = cara[f * 3 + 1], i2 = cara[f * 3 + 2];
          const conA = i0 === a || i1 === a || i2 === a, conB = i0 === b || i1 === b || i2 === b; if (conA && conB) continue;
          normal(i0, i1, i2); if (N[3] <= 0) continue; const n0x = N[0], n0y = N[1], n0z = N[2];
          const sx = P[vv * 3], sy = P[vv * 3 + 1], sz = P[vv * 3 + 2]; P[vv * 3] = x; P[vv * 3 + 1] = y; P[vv * 3 + 2] = z;
          normal(i0, i1, i2); P[vv * 3] = sx; P[vv * 3 + 1] = sy; P[vv * 3 + 2] = sz;
          if (N[3] <= 0 || n0x * N[0] + n0y * N[1] + n0z * N[2] < 0.3) { vuelta = true; break; }
        }
      }
      if (vuelta) continue;
      // b se junta en a
      P[a * 3] = x; P[a * 3 + 1] = y; P[a * 3 + 2] = z; for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
      muerto[b] = 1; ver[a]++;
      const la = vc[a];
      for (const f of vc[b]) {
        if (!viva[f]) continue; const o = f * 3;
        if (cara[o] === a || cara[o + 1] === a || cara[o + 2] === a) { viva[f] = 0; vivas--; continue; }
        for (let k = 0; k < 3; k++) if (cara[o + k] === b) cara[o + k] = a;
        la.push(f);
      }
      vc[b] = null;
      // caras vivas de a (sin repetir) y sus vecinos: se recalculan sus aristas
      vecinos.clear(); let w = 0;
      for (let r = 0; r < la.length; r++) { const f = la[r]; if (!viva[f]) continue; let rep = false; for (let r2 = 0; r2 < w; r2++) if (la[r2] === f) { rep = true; break; } if (rep) continue; la[w++] = f; for (let k = 0; k < 3; k++) { const u = cara[f * 3 + k]; if (u !== a) vecinos.add(u); } }
      la.length = w;
      for (const u of vecinos) mete(Math.min(a, u), Math.max(a, u));
    }
    if (vivas >= nf) return null;
    // 3) se reescribe: un vertice se comparte entre caras de normal parecida (menos de 40 grados) y se separa en las aristas vivas
    const nP = [], nI = [], grupos = new Array(nv), COS40 = 0.766;
    for (let f = 0; f < nf; f++) {
      if (!viva[f]) continue; const i0 = cara[f * 3], i1 = cara[f * 3 + 1], i2 = cara[f * 3 + 2];
      normal(i0, i1, i2); if (N[3] <= 0) continue; const nx = N[0], ny = N[1], nz = N[2];
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? i0 : k === 1 ? i1 : i2, gl = grupos[v] || (grupos[v] = []); let g = -1;
        for (let j = 0; j < gl.length; j += 4) if (gl[j] * nx + gl[j + 1] * ny + gl[j + 2] * nz > COS40) { g = gl[j + 3]; break; }
        if (g < 0) { g = nP.length / 3; gl.push(nx, ny, nz, g); nP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
        nI.push(g);
      }
    }
    if (!nI.length) return null;   // nunca se borra la pieza entera
    return { P: Float32Array.from(nP), I: Uint32Array.from(nI) };
  }
  /** Las partes del .cdeg se escriben en trozos: ningun arreglo pasa de unas decenas de MB (en un federado, el total no cabria). */
  function escritor() {
    const CH = 1 << 21;   // 2 M (x3 floats por vertice: 24 MB por trozo de posiciones)
    const W = { tp: [], ti: [], tc: [], p: null, i: null, c: null, up: 0, ui: 0, uc: 0, nV: 0, nI: 0, tabla: [], icTr: [] };
    W.reserva = (nv, ni) => {
      if (!W.p || W.up + nv * 3 > W.p.length) { if (W.p) { W.tp.push(W.p.subarray(0, W.up)); W.tc.push(W.c.subarray(0, W.uc)); } W.p = new Float32Array(Math.max(CH * 3, nv * 3)); W.c = new Uint8Array(Math.max(CH * 3, nv * 3)); W.up = 0; W.uc = 0; }
      if (!W.i || W.ui + ni > W.i.length) { if (W.i) W.ti.push(W.i.subarray(0, W.ui)); W.i = new Uint32Array(Math.max(CH * 3, ni)); W.ui = 0; }
    };
    return W;
  }
  /** La pieza aligerada con la tolerancia (en metros), en el mundo. La malla repetida se aligera una vez, en sus coordenadas
   *  (la tolerancia y la soldadura se pasan a sus unidades con la escala de la pieza) y se reutiliza en las demas. */
  function aligeraPieza(L, W, f, d, meta, tol) {
    const e = d.M, s = L.escala, sc = s * Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])) || s;
    const gid = L.gid ? L.gid[f] : -1, rep = gid >= 0 && L.gcount && L.gcount[gid] > 1;
    let loc = rep ? W.cache.get(gid) : null;
    if (loc && Math.abs(loc.sc - sc) > sc * 0.02) loc = null;   // otra escala: se aligera aparte
    if (loc) W.reusadas++;
    else {
      const nv = Math.floor((d.pos.length - d.des) / d.paso), Pl = new Float32Array(nv * 3);
      for (let q = 0; q < nv; q++) { const o = q * d.paso + d.des; Pl[q * 3] = d.pos[o]; Pl[q * 3 + 1] = d.pos[o + 1]; Pl[q * 3 + 2] = d.pos[o + 2]; }
      const r = decima(Pl, d.ib, nv, meta, tol / sc, 1e-4 / sc);
      loc = { sc, P: r ? r.P : Pl, I: r ? r.I : d.ib, cambio: !!r };
      if (rep && !W.cache.has(gid)) W.cache.set(gid, loc);
    }
    const nv = loc.P.length / 3, Pn = new Float32Array(nv * 3);
    for (let q = 0; q < nv; q++) { const X = loc.P[q * 3], Y = loc.P[q * 3 + 1], Z = loc.P[q * 3 + 2]; const w = L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); Pn[q * 3] = w[0]; Pn[q * 3 + 1] = w[1]; Pn[q * 3 + 2] = w[2]; }
    if (loc.cambio) { W.aligeradas++; W.triAntes += Math.floor(d.ib.length / 3); W.triDespues += Math.floor(loc.I.length / 3); }
    return { P: Pn, I: loc.I, nv };
  }
  const CARAS_CAJA = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  /*
   * ARISTAS DE CADA ELEMENTO, como las dibuja el visor (EdgesGeometry de three.js a 28 grados): el MISMO AristasDe de Paquete.cs
   * del complemento de Navisworks, llevado a JavaScript. Viajan en el .cdeg (seccion "ARIS") y el visor las muestra de entrada sin
   * calcular nada: con millones de triangulos, EdgesGeometry no podia (un objeto con una propiedad por arista: «Too many properties
   * to enumerate»). Se dibuja la arista si alguna orientacion de caras (normales a menos de 28 grados) la usa una sola vez (borde
   * abierto, arista viva, borde de una lamina de dos caras) o si se juntan planos distintos que no son las dos caras de una misma
   * lamina; no las de dentro de una cara plana aunque venga dos veces (anverso y reverso, como las letras delgadas). P: posiciones
   * del elemento (m), I: indices, nv. Devuelve los pares de vertices (Uint32Array) del elemento.
   */
  function aristasDe(P, I, nv) {
    const COS28 = 0.88294759;
    let cap = 16; while (cap < nv * 2) cap *= 2;
    const hT = new Int32Array(cap).fill(-1), canon = new Int32Array(nv), rep = new Int32Array(nv), kx = new Float64Array(nv), ky = new Float64Array(nv), kz = new Float64Array(nv);
    let nc = 0;
    for (let v = 0; v < nv; v++) {
      const X = Math.floor(P[v * 3] * 10000), Y = Math.floor(P[v * 3 + 1] * 10000), Z = Math.floor(P[v * 3 + 2] * 10000);
      let h = (Math.imul(X | 0, 73856093) ^ Math.imul(Y | 0, 19349663) ^ Math.imul(Z | 0, 83492791)) & (cap - 1), w;
      for (;;) { w = hT[h]; if (w < 0 || (kx[w] === X && ky[w] === Y && kz[w] === Z)) break; h = (h + 1) & (cap - 1); }
      if (w < 0) { w = nc++; hT[h] = w; kx[w] = X; ky[w] = Y; kz[w] = Z; rep[w] = v; }
      canon[v] = w;
    }
    const nf = Math.floor(I.length / 3), nrm = new Float64Array(nf * 3);
    let capA = 16; while (capA < nf * 6) capA *= 2;
    const aT = new Int32Array(capA).fill(-1), ep = new Int32Array(nf * 3), eq = new Int32Array(nf * 3), cuenta = new Int32Array(nf * 3), caras = new Int32Array(nf * 12).fill(-1);
    let na = 0;
    for (let f = 0; f < nf; f++) {
      const i0 = I[f * 3], i1 = I[f * 3 + 1], i2 = I[f * 3 + 2]; if (i0 >= nv || i1 >= nv || i2 >= nv) continue;
      const a = canon[i0], b = canon[i1], c = canon[i2]; if (a === b || b === c || a === c) continue;
      const ux = P[i1 * 3] - P[i0 * 3], uy = P[i1 * 3 + 1] - P[i0 * 3 + 1], uz = P[i1 * 3 + 2] - P[i0 * 3 + 2], vx = P[i2 * 3] - P[i0 * 3], vy = P[i2 * 3 + 1] - P[i0 * 3 + 1], vz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l <= 1e-12) continue;
      nrm[f * 3] = nx / l; nrm[f * 3 + 1] = ny / l; nrm[f * 3 + 2] = nz / l;
      for (let e = 0; e < 3; e++) {
        let p = e === 0 ? a : e === 1 ? b : c, q = e === 0 ? b : e === 1 ? c : a; if (p > q) { const t = p; p = q; q = t; }
        let h = (Math.imul(p, 73856093) ^ Math.imul(q, 19349663)) & (capA - 1), k;
        for (;;) { k = aT[h]; if (k < 0 || (ep[k] === p && eq[k] === q)) break; h = (h + 1) & (capA - 1); }
        if (k < 0) { k = na++; aT[h] = k; ep[k] = p; eq[k] = q; }
        const n = cuenta[k]; if (n < 4) caras[k * 4 + n] = f; cuenta[k] = n + 1;
      }
    }
    const sal = []; const gx = [0, 0, 0, 0], gy = [0, 0, 0, 0], gz = [0, 0, 0, 0], gn = [0, 0, 0, 0];
    for (let k = 0; k < na; k++) {
      const n = cuenta[k]; let dibuja;
      if (n === 1 || n > 4) dibuja = true;
      else {
        let ng = 0;
        for (let t = 0; t < n; t++) {
          const f = caras[k * 4 + t], x = nrm[f * 3], y = nrm[f * 3 + 1], z = nrm[f * 3 + 2]; let g = -1;
          for (let h = 0; h < ng; h++) if (gx[h] * x + gy[h] * y + gz[h] * z > COS28) { g = h; break; }
          if (g < 0) { g = ng++; gx[g] = x; gy[g] = y; gz[g] = z; gn[g] = 0; }
          gn[g]++;
        }
        dibuja = false;
        for (let h = 0; h < ng && !dibuja; h++) if (gn[h] === 1) dibuja = true;
        for (let h = 0; h < ng && !dibuja; h++) for (let h2 = h + 1; h2 < ng; h2++) if (gx[h] * gx[h2] + gy[h] * gy[h2] + gz[h] * gz[h2] > -0.95) { dibuja = true; break; }
      }
      if (dibuja) sal.push(rep[ep[k]], rep[eq[k]]);
    }
    return Uint32Array.from(sal);
  }
  /** Las piezas de un elemento en el mundo (en m): [{ f, Pn, In, nv }]. modo 2 se aligera (con la cache de mallas repetidas);
   *  conAligerar = false las trae tal cual (para la caja orientada). */
  function piezasDe(L, plan, W, fids, conAligerar) {
    const s = L.escala, op = plan.op || OPC, out = [];
    for (const f of fids) {
      const d = geomPieza(L.modelo, L.o.visor, f, L.o.Matriz); if (!d || !d.ib || !d.ib.length || d.lineas) { L.vaciadas = (L.vaciadas || 0) + 1; continue; }
      if (conAligerar && plan.modo[f] === 2) { const A = aligeraPieza(L, W, f, d, plan.meta[f], op.tolerancia); out.push({ f, Pn: A.P, In: A.I, nv: A.nv }); continue; }
      const e = d.M, nv = Math.floor((d.pos.length - d.des) / d.paso), Pn = new Float32Array(nv * 3);
      for (let q = 0; q < nv; q++) { const o = q * d.paso + d.des, X = d.pos[o], Y = d.pos[o + 1], Z = d.pos[o + 2]; const w = L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); Pn[q * 3] = w[0]; Pn[q * 3 + 1] = w[1]; Pn[q * 3 + 2] = w[2]; }
      out.push({ f, Pn, In: d.ib, nv });
    }
    return out;
  }
  /** Cuantos triangulos quedaria cada elemento tal como se dibujaria (aligerado con la tolerancia), sin escribir nada: primera
   *  pasada, para decidir con cifras reales que va completo y que como caja. Por tramos: mide(L, plan, lista, W, desde, hasta). */
  function mide(L, plan, lista, W, desde, hasta) {
    const op = plan.op || OPC;
    if (!W.cache) Object.assign(W, { cache: new Map(), reusadas: 0, aligeradas: 0, triAntes: 0, triDespues: 0 });
    if (!W.costo || W.costo.length !== lista.length) W.costo = new Float64Array(lista.length);
    for (let k = desde; k < Math.min(hasta, lista.length); k++) {
      let c = 0;
      for (const f of lista[k].fids) {
        if (!plan.modo[f]) continue;
        if (plan.modo[f] === 1) { c += L.tri[f]; continue; }
        const gid = L.gid ? L.gid[f] : -1, loc = gid >= 0 && L.gcount && L.gcount[gid] > 1 ? W.cache.get(gid) : null;
        if (loc) { c += Math.floor(loc.I.length / 3); continue; }
        const d = geomPieza(L.modelo, L.o.visor, f, L.o.Matriz); if (!d || !d.ib || !d.ib.length || d.lineas) continue;
        const a0 = W.aligeradas, t0 = W.triAntes, t1 = W.triDespues, A = aligeraPieza(L, W, f, d, plan.meta[f], op.tolerancia);
        W.aligeradas = a0; W.triAntes = t0; W.triDespues = t1;   // se cuentan al escribir
        c += Math.floor(A.I.length / 3);
      }
      W.costo[k] = c;
    }
  }
  /** Con lo medido, que va completo (1) y que como caja (2), sin pasar de topeSeguro: de lo que mas se ve a lo que menos; si
   *  uno no cabe va como caja y se sigue con los demas (los chicos que si caben van completos). */
  function elige(plan, lista, W) {
    const op = plan.op || OPC, n = lista.length, dec = new Uint8Array(n);
    let quedan = 0; for (let k = 0; k < n; k++) if (lista[k].fids.some(f => plan.modo[f])) quedan++;
    let usado = 0;
    for (let k = 0; k < n; k++) {
      if (!lista[k].fids.some(f => plan.modo[f])) continue;
      quedan--;
      if (!op.topeSeguro || usado + W.costo[k] + 12 * quedan <= op.topeSeguro) { dec[k] = 1; usado += W.costo[k]; } else { dec[k] = 2; usado += 12; }
    }
    W.dec = dec; W.restantes = 0; W.modoCaja = false;
    return dec;
  }
  /** La caja ORIENTADA de unos puntos (en m): sus ejes principales (de la covarianza, por Jacobi). Un tubo en diagonal queda como
   *  una barra delgada y no como una losa. 8 vertices en el orden de CARAS_CAJA. */
  function cajaOrientada(Ps) {
    let n = 0, mx = 0, my = 0, mz = 0;
    for (const P of Ps) for (let q = 0; q < P.length; q += 3) { mx += P[q]; my += P[q + 1]; mz += P[q + 2]; n++; }
    if (!n) return null; mx /= n; my /= n; mz /= n;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const P of Ps) for (let q = 0; q < P.length; q += 3) { const d = [P[q] - mx, P[q + 1] - my, P[q + 2] - mz]; for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) C[i][j] += d[i] * d[j]; }
    C[1][0] = C[0][1]; C[2][0] = C[0][2]; C[2][1] = C[1][2];
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let it = 0; it < 30; it++) {   // Jacobi: anula el mayor fuera de la diagonal
      let p = 0, q = 1; if (Math.abs(C[0][2]) > Math.abs(C[p][q])) { p = 0; q = 2; } if (Math.abs(C[1][2]) > Math.abs(C[p][q])) { p = 1; q = 2; }
      if (Math.abs(C[p][q]) < 1e-15) break;
      const th = 0.5 * Math.atan2(2 * C[p][q], C[q][q] - C[p][p]), c = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) { const a = C[k][p], b = C[k][q]; C[k][p] = c * a - sn * b; C[k][q] = sn * a + c * b; }
      for (let k = 0; k < 3; k++) { const a = C[p][k], b = C[q][k]; C[p][k] = c * a - sn * b; C[q][k] = sn * a + c * b; }
      for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - sn * b; V[k][q] = sn * a + c * b; }
    }
    const ej = [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const P of Ps) for (let q = 0; q < P.length; q += 3) for (let j = 0; j < 3; j++) { const t = (P[q] - mx) * ej[j][0] + (P[q + 1] - my) * ej[j][1] + (P[q + 2] - mz) * ej[j][2]; if (t < lo[j]) lo[j] = t; if (t > hi[j]) hi[j] = t; }
    for (let j = 0; j < 3; j++) if (hi[j] - lo[j] < 0.002) { const m = (hi[j] + lo[j]) / 2; lo[j] = m - 0.001; hi[j] = m + 0.001; }   // al menos 2 mm
    const out = new Float32Array(24), esq = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    esq.forEach(([i, j, k], v) => { const t = [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]]; for (let d = 0; d < 3; d++) out[v * 3 + d] = (d === 0 ? mx : d === 1 ? my : mz) + t[0] * ej[0][d] + t[1] * ej[1][d] + t[2] * ej[2][d]; });
    // que las caras miren hacia afuera (si los ejes quedaron con giro izquierdo, se espejan)
    const det = ej[0][0] * (ej[1][1] * ej[2][2] - ej[1][2] * ej[2][1]) - ej[0][1] * (ej[1][0] * ej[2][2] - ej[1][2] * ej[2][0]) + ej[0][2] * (ej[1][0] * ej[2][1] - ej[1][1] * ej[2][0]);
    if (det < 0) for (const [a, b] of [[1, 3], [5, 7]]) for (let d = 0; d < 3; d++) { const t = out[a * 3 + d]; out[a * 3 + d] = out[b * 3 + d]; out[b * 3 + d] = t; }
    return out;
  }
  /** Arma los elementos (lista de { e, fids }) con el plan. Por tramos: arma(L, plan, elems, W, desde, hasta). Conviene pasar los
   *  elementos ordenados (ordena): si el resultado fuera a pasar del limite del navegador (topeSeguro), los que faltan (los mas
   *  chicos) van como su caja (12 triangulos): asi todos se ven, se seleccionan y se filtran; nunca se deforma nada. */
  function arma(L, plan, elems, W, desde, hasta) {
    const s = L.escala, op = plan.op || OPC;
    if (!W.cache) Object.assign(W, { cache: new Map(), reusadas: 0, aligeradas: 0, triAntes: 0, triDespues: 0 });
    if (!W.armando) { Object.assign(W, { armando: true, enCaja: 0, triEnCaja: 0, restantes: 0, modoCaja: false }); for (const x of elems) if (x.fids.some(f => plan.modo[f])) W.restantes++; }
    for (let k = desde; k < Math.min(hasta, elems.length); k++) {
      const x = elems[k], fids = x.fids.filter(f => plan.modo[f]).sort((a, b) => (L.rgba[a * 4 + 3] < 250) - (L.rgba[b * 4 + 3] < 250));
      if (!fids.length) continue;
      W.restantes--;
      let piezas = null;
      const dk = W.dec ? W.dec[k] : 0;
      if (dk === 1) piezas = piezasDe(L, plan, W, fids, true);
      else if (!dk && !W.modoCaja) {
        piezas = []; let costo = 0;
        for (const f of fids) {
          const m = plan.modo[f]; let Pn = null, In = null, nv = 0;
          const d = geomPieza(L.modelo, L.o.visor, f, L.o.Matriz);
          if (d && d.ib && d.ib.length && !d.lineas) {
            if (m === 2) { const A = aligeraPieza(L, W, f, d, plan.meta[f], op.tolerancia); Pn = A.P; In = A.I; nv = A.nv; }
            else {
              const e = d.M; nv = Math.floor((d.pos.length - d.des) / d.paso); Pn = new Float32Array(nv * 3);
              for (let q = 0; q < nv; q++) { const o = q * d.paso + d.des, X = d.pos[o], Y = d.pos[o + 1], Z = d.pos[o + 2]; const w = L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); Pn[q * 3] = w[0]; Pn[q * 3 + 1] = w[1]; Pn[q * 3 + 2] = w[2]; }
              In = d.ib;
            }
          }
          if (!Pn) { L.vaciadas = (L.vaciadas || 0) + 1; continue; }   // la malla ya no estaba (no deberia pasar tras el censo)
          piezas.push({ f, Pn, In, nv }); costo += In.length / 3;
        }
        if (op.topeSeguro && W.nI / 3 + costo + 12 * W.restantes > op.topeSeguro) { W.modoCaja = true; piezas = null; }
      }
      if (!piezas) {   // la caja del elemento: orientada con sus piezas (o, si no se pueden leer, la de sus cajas)
        for (const f of fids) W.triEnCaja += L.tri[f];
        const pz = dk === 2 ? piezasDe(L, plan, W, fids, false) : [];
        let Pc = pz.length ? cajaOrientada(pz.map(p => p.Pn)) : null;
        if (!Pc) { const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; for (const f of fids) for (let j = 0; j < 3; j++) { a[j] = Math.min(a[j], L.caja[f * 6 + j]); b[j] = Math.max(b[j], L.caja[f * 6 + 3 + j]); } Pc = new Float32Array([a[0], a[1], a[2], b[0], a[1], a[2], b[0], b[1], a[2], a[0], b[1], a[2], a[0], a[1], b[2], b[0], a[1], b[2], b[0], b[1], b[2], a[0], b[1], b[2]]); }
        piezas = [{ f: fids[0], Pn: Pc, In: CARAS_CAJA, nv: 8 }];
        W.enCaja++;
      }
      const v0 = W.nV, i0 = W.nI; let tr = 0, nvE = 0, niE = 0;
      for (const p of piezas) { nvE += p.nv; niE += p.In.length; }
      const Pe = new Float32Array(nvE * 3), Ie = new Uint32Array(niE); let pv = 0, pi = 0;
      for (const p of piezas) {
        const f = p.f, r = L.rgba[f * 4], g = L.rgba[f * 4 + 1], b = L.rgba[f * 4 + 2], vidrio = L.rgba[f * 4 + 3] < 250, nv = p.nv, Pn = p.Pn, In = p.In;
        W.reserva(nv, In.length);
        const base = W.nV - v0;
        for (let q = 0; q < nv * 3; q++) W.p[W.up + q] = Pn[q];
        for (let q = 0; q < nv; q++) { W.c[W.uc + q * 3] = r; W.c[W.uc + q * 3 + 1] = g; W.c[W.uc + q * 3 + 2] = b; }
        for (let q = 0; q < In.length; q++) W.i[W.ui + q] = In[q] + base;
        Pe.set(Pn, pv * 3); for (let q = 0; q < In.length; q++) Ie[pi + q] = In[q] + pv; pv += nv; pi += In.length;
        W.up += nv * 3; W.uc += nv * 3; W.ui += In.length; W.nV += nv; W.nI += In.length; if (vidrio) tr += In.length;
      }
      if (W.nI === i0) continue;
      const c0 = fids[0] * 4, todoVidrio = tr > 0 && tr === W.nI - i0;
      W.tabla.push(x.e >>> 0, v0, W.nV - v0, i0, W.nI - i0, L.rgba[c0] | (L.rgba[c0 + 1] << 8) | (L.rgba[c0 + 2] << 16) | ((todoVidrio ? Math.min(L.rgba[c0 + 3], 199) : 255) << 24));
      W.icTr.push(todoVidrio ? 0 : tr);
      // sus aristas (pares de vertices relativos al primer vertice del elemento)
      const ar = aristasDe(Pe, Ie, nvE);
      if (!W.ta) { W.ta = []; W.a = null; W.ua = 0; W.nA = 0; W.tabA = []; }
      if (!W.a || W.ua + ar.length > W.a.length) { if (W.a) W.ta.push(W.a.subarray(0, W.ua)); W.a = new Uint32Array(Math.max(1 << 22, ar.length)); W.ua = 0; }
      W.a.set(ar, W.ua); W.ua += ar.length; W.tabA.push(W.nA, ar.length / 2); W.nA += ar.length / 2;
    }
  }
  /*
   * DIBUJOS EN LINEAS (arboles CAD 3D, escudos, contornos de letras): como el complemento de Navisworks, viajan en la seccion
   * "LINS" del .cdeg (el visor ya las dibuja y las filtra con su elemento), con el color propio de cada linea. No se dibujan las
   * de categorias auxiliares (aux: ejes, lineas de centro, rejillas, analiticas...). lineas: [{ e, fids }] (elementosDe).
   * topeSeg: limite de segmentos (los dibujos mas grandes primero).
   */
  function armaLineas(L, lineas, W, aux, topeSeg) {
    const s = L.escala; topeSeg = topeSeg || 3000000;
    W.lin = { filas: [], tp: [], tc: [], nS: 0, omitidas: 0, aux: 0 };
    const lista = lineas.filter((x) => { if (aux && aux.has(x.e)) { W.lin.aux += x.fids.length; return false; } return true; });
    for (const x of lista) {
      if (W.lin.nS >= topeSeg) { W.lin.omitidas += x.fids.length; continue; }
      const P = [], C = []; let base = null;
      for (const f of x.fids) {
        const d = geomPieza(L.modelo, L.o.visor, f, L.o.Matriz); if (!d || !d.lineas || !d.pos) continue;
        if (!base) { const c = colorPieza(L.modelo, f); base = c; }
        const e = d.M, nv = Math.floor((d.pos.length - d.des) / d.paso), ib = d.ib;
        const pt = (v) => { const o = v * d.paso + d.des, X = d.pos[o], Y = d.pos[o + 1], Z = d.pos[o + 2]; return L.aZ((e[0] * X + e[4] * Y + e[8] * Z + e[12]) * s, (e[1] * X + e[5] * Y + e[9] * Z + e[13]) * s, (e[2] * X + e[6] * Y + e[10] * Z + e[14]) * s); };
        const n2 = ib ? ib.length : nv - nv % 2;
        for (let q = 0; q + 1 < n2; q += 2) {
          const a = ib ? ib[q] : q, b = ib ? ib[q + 1] : q + 1; if (a >= nv || b >= nv) continue;
          const pa = pt(a), pb = pt(b); P.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
          const c = (d.colorDe && d.colorDe(a)) || base || [60, 60, 60]; C.push(c[0], c[1], c[2]);
        }
      }
      if (!P.length) continue;
      const n = P.length / 6, b0 = base || [60, 60, 60];
      W.lin.filas.push(x.e >>> 0, W.lin.nS, n, (b0[0] | (b0[1] << 8) | (b0[2] << 16) | (255 << 24)) >>> 0);
      W.lin.tp.push(Float32Array.from(P)); W.lin.tc.push(Uint8Array.from(C)); W.lin.nS += n;
    }
    return W.lin;
  }
  /** Cierra el escritor: devuelve las partes del .cdeg (formato 2) para un Blob. */
  function cierraEscritor(W, origen, meta) {
    W.cache = null;   // las mallas aligeradas repetidas ya se escribieron
    if (W.p) { W.tp.push(W.p.subarray(0, W.up)); W.tc.push(W.c.subarray(0, W.uc)); W.ti.push(W.i.subarray(0, W.ui)); W.p = W.i = W.c = null; }
    const nE = W.icTr.length, tabla = new DataView(new ArrayBuffer(24 * nE));
    for (let k = 0; k < nE; k++) { const o = k * 24, t = k * 6; tabla.setUint32(o, W.tabla[t], true); tabla.setUint32(o + 4, W.tabla[t + 1], true); tabla.setUint32(o + 8, W.tabla[t + 2], true); tabla.setUint32(o + 12, W.tabla[t + 3], true); tabla.setUint32(o + 16, W.tabla[t + 4], true); tabla.setUint32(o + 20, W.tabla[t + 5] >>> 0, true); }
    const m = new TextEncoder().encode(JSON.stringify(Object.assign({ unidades: 'm', ejeArriba: 'Z', origen, fecha: new Date().toISOString() }, meta || {})));
    const cab = new DataView(new ArrayBuffer(36 + m.length + ((4 - (36 + m.length) % 4) % 4)));
    'CDEG'.split('').forEach((ch, k) => cab.setUint8(k, ch.charCodeAt(0)));
    cab.setUint32(4, 2, true); cab.setUint32(8, nE, true); cab.setUint32(12, W.nV, true); cab.setUint32(16, W.nI, true);
    cab.setFloat32(20, origen[0], true); cab.setFloat32(24, origen[1], true); cab.setFloat32(28, origen[2], true); cab.setUint32(32, m.length, true);
    new Uint8Array(cab.buffer).set(m, 36);
    const relleno = (4 - (W.nV * 3) % 4) % 4;
    // seccion opcional de aristas precalculadas (la del complemento de Navisworks): "ARIS", pares; por elemento (en el orden de la
    // tabla) primer par y cuantos; luego los pares de vertices, relativos al primer vertice de su elemento
    // seccion opcional de lineas (la del complemento de Navisworks): "LINS", filas, segmentos; por fila: elemento, primer
    // segmento, cuantos, rgba; luego 6 float por segmento (en metros, como las mallas) y 3 bytes de color por segmento
    let lins = [];
    if (W.lin && W.lin.nS) {
      const c = new DataView(new ArrayBuffer(12)); 'LINS'.split('').forEach((ch, k) => c.setUint8(k, ch.charCodeAt(0))); c.setUint32(4, W.lin.filas.length / 4, true); c.setUint32(8, W.lin.nS, true);
      const r2 = (4 - (W.lin.nS * 3) % 4) % 4;
      lins = [c.buffer, new Uint32Array(W.lin.filas)].concat(W.lin.tp, W.lin.tc, r2 ? [new Uint8Array(r2)] : []);
    }
    let aris = [];
    if (W.tabA && W.tabA.length === nE * 2) {
      if (W.a) { W.ta.push(W.a.subarray(0, W.ua)); W.a = null; }
      const c = new DataView(new ArrayBuffer(8)); 'ARIS'.split('').forEach((ch, k) => c.setUint8(k, ch.charCodeAt(0))); c.setUint32(4, W.nA, true);
      aris = [c.buffer, new Uint32Array(W.tabA)].concat(W.ta);
    }
    return { partes: [cab.buffer, tabla.buffer].concat(W.tp, W.ti, [new Uint32Array(W.icTr)], W.tc, relleno ? [new Uint8Array(relleno)] : [], lins, aris), nElem: nE, nVert: W.nV, nIdx: W.nI, nAristas: W.nA || 0, nSegmentos: (W.lin && W.lin.nS) || 0 };
  }
  /** El elemento del indice de cada pieza (su antecesor que el indice reconoce como elemento) y la lista de elementos. */
  function elementosDe(L, esElem, padreDe, op) {
    const memo = new Map(); let sinElem = 0;
    const destino = (db) => {
      if (memo.has(db)) return memo.get(db);
      let d = db, k = 0, r = null; const camino = [];
      while (d != null && d > 0 && k++ < 60) { if (memo.has(d)) { r = memo.get(d); break; } camino.push(d); if (esElem(d)) { r = d; break; } d = padreDe(d); }
      for (const c of camino) memo.set(c, r);
      return r;
    };
    const porE = new Map(), sin = [], deFid = new Int32Array(L.n).fill(-1), enIndice = new Set(), linE = new Map(); let linSin = 0;
    for (let f = 0; f < L.n; f++) {
      if (L.tipo[f] === 2) { let t = destino(L.dbDe(f)); if (t == null) { linSin++; if (!(op && op.lineasSueltas)) continue; t = L.dbDe(f); /* v0.27.1: se dibuja igual, con su propio id */ } deFid[f] = t; let x = linE.get(t); if (!x) linE.set(t, x = []); x.push(f); continue; }   // lineas: solo las de un elemento del indice
      if (L.tipo[f] !== 1) continue; const db = L.dbDe(f); let t = destino(db); if (t == null) { t = db; sinElem++; if (sin.length < 15 && !sin.includes(db)) sin.push(db); } else enIndice.add(t); deFid[f] = t; let x = porE.get(t); if (!x) porE.set(t, x = []); x.push(f); }
    return { elems: [...porE].sort((a, b) => a[0] - b[0]).map(([e, fids]) => ({ e, fids, indice: enIndice.has(e) })), deFid, sinElemento: sinElem, muestraSin: sin, lineas: [...linE].sort((a, b) => a[0] - b[0]).map(([e, fids]) => ({ e, fids })), lineasSinElemento: linSin };
  }
  const API = { geomPieza, colorPieza, prepara, leeTramo, cierra, agrupa, leeModelo, escribe, OPC, esAcero, censa, censaTramo, planifica, ordena, silueta, decima, aristasDe, escritor, mide, elige, cajaOrientada, arma, armaLineas, cierraEscritor, elementosDe };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else { raiz.CDEG = API; if (raiz.CDE && raiz.CDE.N) raiz.CDE.N.cdeg = API; }
})(typeof window !== 'undefined' ? window : this);
