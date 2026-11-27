/*
 * GEOMETRÍA POR PARTES (v0.27.0) — primera entrega de «carga por partes».
 *
 * Un modelo pesado no entra completo en el navegador. En vez de recortarlo (cajas, piezas simplificadas), el servidor guarda la
 * geometría COMPLETA en su .cdeg y la sirve por partes: cada parte es un grupo de elementos (un nivel, y si el nivel es grande,
 * sus sectores) con todo su detalle. El visor pide las partes que el usuario elige y recibe un .cdeg normal con solo esas.
 *
 * No se duplica el archivo: el «mapa de partes» (<geometria>.partes.json + .partes.bin) solo dice qué elementos van en cada parte;
 * al pedir una selección, compone() lee del .cdeg original los tramos de esos elementos y los escribe en flujo. Nada del modelo
 * se carga entero en memoria (lectura por trozos), así que sirve igual para un .cdeg de varios GB.
 *
 * Formato .cdeg (docs/FORMATO-PAQUETE.md): cabecera 36 B · metadatos JSON · tabla (24 B por elemento: e, vo, vc, io, ic, rgba) ·
 * posiciones (3 f32 por vértice) · índices (u32, relativos al primer vértice del elemento) · [formato 2: icTr u32 por elemento +
 * color rgb por vértice] · secciones opcionales «LINS» (dibujos en líneas) y «ARIS» (aristas).
 */
'use strict';
const fs = require('fs');

const TROZO = 8 * 1024 * 1024, VERSION_MAPA = 1;
const pad4 = (n) => (4 - n % 4) % 4;
const lee = (fd, pos, n) => { const b = Buffer.allocUnsafe(n); let k = 0; while (k < n) { const r = fs.readSync(fd, b, k, n - k, pos + k); if (!r) break; k += r; } return k === n ? b : b.subarray(0, k); };

/** Cabecera, metadatos y dónde empieza cada sección de un .cdeg (sin leer la geometría). */
function cabecera(fd) {
  const tam = fs.fstatSync(fd).size, c = lee(fd, 0, 36);
  if (c.length < 36 || c.toString('latin1', 0, 4) !== 'CDEG') throw new Error('La geometría no es un .cdeg.');
  const H = { tam, version: c.readUInt32LE(4), nElem: c.readUInt32LE(8), nVert: c.readUInt32LE(12), nIdx: c.readUInt32LE(16), origen: Buffer.from(c.subarray(20, 32)), lMeta: c.readUInt32LE(32) };
  H.meta = JSON.parse(lee(fd, 36, H.lMeta).toString('utf8'));
  H.oTabla = 36 + H.lMeta + pad4(36 + H.lMeta); H.oPos = H.oTabla + 24 * H.nElem; H.oIdx = H.oPos + 12 * H.nVert;
  let fin = H.oIdx + 4 * H.nIdx; H.oIcTr = -1; H.oRgb = -1; H.lins = null; H.aris = null;
  if (H.version >= 2 && fin + 4 * H.nElem + 3 * H.nVert <= tam) {
    H.oIcTr = fin; H.oRgb = fin + 4 * H.nElem; let o = H.oRgb + 3 * H.nVert; o += pad4(o);
    while (o + 8 <= tam) {
      const t = lee(fd, o, 12), tag = t.toString('latin1', 0, 4);
      if (tag === 'LINS' && t.length >= 12) { const nF = t.readUInt32LE(4), nS = t.readUInt32LE(8); if (o + 12 + nF * 16 + nS * 27 > tam) break; H.lins = { nF, nS, oFilas: o + 12, oPos: o + 12 + nF * 16, oCol: o + 12 + nF * 16 + nS * 24 }; o = H.lins.oCol + nS * 3; o += pad4(o); }
      else if (tag === 'ARIS') { const nP = t.readUInt32LE(4); if (o + 8 + H.nElem * 8 + nP * 8 > tam) break; H.aris = { nP, oTab: o + 8, oRel: o + 8 + H.nElem * 8 }; o = H.aris.oRel + nP * 8; }
      else break;
    }
  }
  return H;
}

/**
 * Arma el mapa de partes de un .cdeg. grupoDe(e) → etiqueta del grupo natural del elemento (su nivel; '' si no se sabe).
 * Un grupo con más de maxTri triángulos se divide en sectores por el espacio (corte por la mediana del eje más largo).
 * Devuelve { mapa, orden }: mapa (JSON) con las partes y orden (Uint32Array) con las filas de la tabla, parte tras parte.
 */
function arma(ruta, grupoDe, op) {
  const maxTri = Math.max(1000, Number((op || {}).maxTri) || 2000000), fd = fs.openSync(ruta, 'r');
  try {
    const H = cabecera(fd), n = H.nElem, T = lee(fd, H.oTabla, 24 * n);
    const vo = new Uint32Array(n), vc = new Uint32Array(n), ic = new Uint32Array(n), eId = new Uint32Array(n);
    for (let i = 0; i < n; i++) { eId[i] = T.readUInt32LE(i * 24); vo[i] = T.readUInt32LE(i * 24 + 4); vc[i] = T.readUInt32LE(i * 24 + 8); ic[i] = T.readUInt32LE(i * 24 + 16); }
    // caja de cada elemento: un barrido de las posiciones, en el orden en que están en el archivo
    const caja = new Float32Array(n * 6), porVo = Array.from({ length: n }, (_, i) => i).sort((a, b) => vo[a] - vo[b]);
    let buf = null, bIni = 0, bFin = 0;
    for (const i of porVo) {
      let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
      for (let v = vo[i]; v < vo[i] + vc[i];) {
        if (v < bIni || v >= bFin) { const cuantos = Math.min(H.nVert - v, Math.floor(TROZO / 12)); buf = lee(fd, H.oPos + v * 12, cuantos * 12); bIni = v; bFin = v + Math.floor(buf.length / 12); if (bFin <= v) break; }
        const hasta = Math.min(bFin, vo[i] + vc[i]);
        for (; v < hasta; v++) { const o = (v - bIni) * 12; for (let j = 0; j < 3; j++) { const x = buf.readFloatLE(o + j * 4); if (x < a[j]) a[j] = x; if (x > b[j]) b[j] = x; } }
      }
      if (!vc[i]) { a = [0, 0, 0]; b = [0, 0, 0]; }
      caja.set(a, i * 6); caja.set(b, i * 6 + 3);
    }
    // grupos naturales y, si pesan, sectores
    const grupos = new Map(); for (let i = 0; i < n; i++) { const g = String(grupoDe ? grupoDe(eId[i]) || '' : '').trim() || '(sin nivel)'; let l = grupos.get(g); if (!l) { l = []; grupos.set(g, l); } l.push(i); }
    const tri = (l) => { let t = 0; for (const i of l) t += ic[i]; return t / 3; };
    const corta = (l) => {
      if (tri(l) <= maxTri || l.length < 2) return [l];
      const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity], cen = (i, j) => (caja[i * 6 + j] + caja[i * 6 + 3 + j]) / 2;
      for (const i of l) for (let j = 0; j < 3; j++) { const c = cen(i, j); if (c < a[j]) a[j] = c; if (c > b[j]) b[j] = c; }
      let eje = 0; for (let j = 1; j < 3; j++) if (b[j] - a[j] > b[eje] - a[eje]) eje = j;
      const s = l.slice().sort((p, q) => cen(p, eje) - cen(q, eje));
      // corte donde se junta la mitad de los triángulos (no de los elementos): partes parejas en peso
      const mitad = tri(s) / 2; let acum = 0, k = 0; while (k < s.length - 1 && acum + ic[s[k]] / 3 <= mitad) { acum += ic[s[k]] / 3; k++; }
      k = Math.max(1, Math.min(s.length - 1, k));
      return corta(s.slice(0, k)).concat(corta(s.slice(k)));
    };
    const partes = [], orden = new Uint32Array(n); let pos = 0;
    const nat = (x, y) => String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' });
    for (const g of [...grupos.keys()].sort(nat)) {
      const sect = corta(grupos.get(g));
      sect.forEach((l, k) => {
        l.sort((p, q) => vo[p] - vo[q]);   // en el orden del archivo: lecturas seguidas
        const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; let nv = 0, ni = 0;
        for (const i of l) { nv += vc[i]; ni += ic[i]; for (let j = 0; j < 3; j++) { if (caja[i * 6 + j] < a[j]) a[j] = caja[i * 6 + j]; if (caja[i * 6 + 3 + j] > b[j]) b[j] = caja[i * 6 + 3 + j]; } }
        partes.push({ n: partes.length, grupo: g, etiqueta: sect.length > 1 ? g + ' · sector ' + (k + 1) + ' de ' + sect.length : g, elementos: l.length, vertices: nv, triangulos: ni / 3, caja: a.concat(b).map(x => Math.round(x * 100) / 100), desde: pos });
        orden.set(l, pos); pos += l.length;
      });
    }
    const st = fs.statSync(ruta);
    return { mapa: { version: VERSION_MAPA, fuente: { bytes: st.size, mtimeMs: Math.round(st.mtimeMs) }, maxTri, total: { elementos: n, vertices: H.nVert, triangulos: H.nIdx / 3 }, partes }, orden };
  } finally { fs.closeSync(fd); }
}

const rutasMapa = (ruta) => ({ json: ruta + '.partes.json', bin: ruta + '.partes.bin' });
function guarda(ruta, r) { const p = rutasMapa(ruta); fs.writeFileSync(p.bin, Buffer.from(r.orden.buffer, r.orden.byteOffset, r.orden.byteLength)); fs.writeFileSync(p.json, JSON.stringify(r.mapa)); }
/** El mapa guardado, si sigue correspondiendo a esa geometría (mismo tamaño y fecha); si no, null. */
function leeMapa(ruta) {
  try {
    const p = rutasMapa(ruta), m = JSON.parse(fs.readFileSync(p.json, 'utf8')), st = fs.statSync(ruta);
    if (m.version !== VERSION_MAPA || m.fuente.bytes !== st.size || m.fuente.mtimeMs !== Math.round(st.mtimeMs) || !fs.existsSync(p.bin)) return null;
    return m;
  } catch (e) { return null; }
}
function borraMapa(ruta) { const p = rutasMapa(ruta); for (const x of [p.json, p.bin]) try { fs.unlinkSync(x); } catch (e) {} }

/**
 * Escribe en `sale` (un flujo) un .cdeg con solo las partes pedidas (números de parte), leyendo del .cdeg original por trozos.
 * Devuelve una promesa con { elementos, vertices, indices }.
 */
async function compone(ruta, mapa, seleccion, sale) {
  const fd = fs.openSync(ruta, 'r');
  const escribe = (b) => new Promise((ok, mal) => { if (sale.destroyed) return mal(new Error('se cortó la conexión')); if (sale.write(b)) ok(); else sale.once('drain', ok); });
  try {
    const H = cabecera(fd), p = rutasMapa(ruta), elegidas = [...new Set(seleccion.map(Number))].filter(k => mapa.partes[k]).sort((a, b) => a - b);
    const fb = fs.openSync(p.bin, 'r'); let filas;
    try { const tot = elegidas.reduce((s, k) => s + mapa.partes[k].elementos, 0); filas = new Uint32Array(tot); let q = 0; for (const k of elegidas) { const P = mapa.partes[k], b = lee(fb, P.desde * 4, P.elementos * 4); for (let i = 0; i < P.elementos; i++) filas[q++] = b.readUInt32LE(i * 4); } } finally { fs.closeSync(fb); }
    const n = filas.length, T = Buffer.alloc(24 * n), vo = new Uint32Array(n), vc = new Uint32Array(n), io = new Uint32Array(n), ic = new Uint32Array(n);
    let nv = 0, ni = 0; const T0 = lee(fd, H.oTabla, 24 * H.nElem);
    for (let i = 0; i < n; i++) {
      const f = T0.subarray(filas[i] * 24, filas[i] * 24 + 24); vo[i] = f.readUInt32LE(4); vc[i] = f.readUInt32LE(8); io[i] = f.readUInt32LE(12); ic[i] = f.readUInt32LE(16);
      f.copy(T, i * 24); T.writeUInt32LE(nv, i * 24 + 4); T.writeUInt32LE(ni, i * 24 + 12); nv += vc[i]; ni += ic[i];
    }
    // secciones opcionales: qué filas de líneas y qué aristas tocan a los elementos elegidos
    const eSel = new Map(); for (let i = 0; i < n; i++) eSel.set(T.readUInt32LE(i * 24), i);
    let L = null, A = null;
    if (H.lins) { const F = lee(fd, H.lins.oFilas, H.lins.nF * 16), sel = []; let nS = 0; for (let r = 0; r < H.lins.nF; r++) { if (!eSel.has(F.readUInt32LE(r * 16))) continue; const so = F.readUInt32LE(r * 16 + 4), sc = F.readUInt32LE(r * 16 + 8), fila = Buffer.from(F.subarray(r * 16, r * 16 + 16)); fila.writeUInt32LE(nS, 4); sel.push({ fila, so, sc }); nS += sc; } if (sel.length) L = { sel, nS }; }
    if (H.aris) { const tab = Buffer.alloc(n * 8); let nP = 0; const tramos = []; const AT = lee(fd, H.aris.oTab, 8 * H.nElem); for (let i = 0; i < n; i++) { const t = AT.subarray(filas[i] * 8, filas[i] * 8 + 8), a0 = t.readUInt32LE(0), c = t.readUInt32LE(4); tab.writeUInt32LE(nP, i * 8); tab.writeUInt32LE(c, i * 8 + 4); if (c) tramos.push([a0, c]); nP += c; } A = { tab, nP, tramos }; }
    const meta = Buffer.from(JSON.stringify(Object.assign({}, H.meta, { partes: { de: mapa.partes.length, cargadas: elegidas, elementos: n, elementosTotal: mapa.total.elementos, triangulos: ni / 3, triangulosTotal: mapa.total.triangulos } })));
    const cab = Buffer.alloc(36); cab.write('CDEG', 0, 'latin1'); cab.writeUInt32LE(H.version, 4); cab.writeUInt32LE(n, 8); cab.writeUInt32LE(nv, 12); cab.writeUInt32LE(ni, 16); H.origen.copy(cab, 20); cab.writeUInt32LE(meta.length, 32);
    await escribe(cab); await escribe(meta); if (pad4(36 + meta.length)) await escribe(Buffer.alloc(pad4(36 + meta.length))); await escribe(T);
    // copia por tramos seguidos (los elementos de una parte van en el orden del archivo)
    const copia = async (base, ini, cuenta, ancho) => {
      for (let i = 0; i < n;) {
        let j = i, a = ini[i], fin = ini[i] + cuenta[i];
        while (j + 1 < n && ini[j + 1] === fin && (fin - a + cuenta[j + 1]) * ancho <= TROZO) { j++; fin += cuenta[j]; }
        for (let o = a; o < fin;) { const c = Math.min(fin - o, Math.floor(TROZO / ancho)); await escribe(lee(fd, base + o * ancho, c * ancho)); o += c; }
        i = j + 1;
      }
    };
    await copia(H.oPos, vo, vc, 12); await copia(H.oIdx, io, ic, 4);
    if (H.oIcTr >= 0) {
      const tr = Buffer.alloc(4 * n), TR0 = lee(fd, H.oIcTr, 4 * H.nElem); for (let i = 0; i < n; i++) TR0.copy(tr, i * 4, filas[i] * 4, filas[i] * 4 + 4); await escribe(tr);
      await copia(H.oRgb, vo, vc, 3); let fin = nv * 3; if (pad4(fin)) await escribe(Buffer.alloc(pad4(fin)));
      if (L) { const c = Buffer.alloc(12); c.write('LINS', 0, 'latin1'); c.writeUInt32LE(L.sel.length, 4); c.writeUInt32LE(L.nS, 8); await escribe(c); for (const x of L.sel) await escribe(x.fila); for (const x of L.sel) if (x.sc) await escribe(lee(fd, H.lins.oPos + x.so * 24, x.sc * 24)); for (const x of L.sel) if (x.sc) await escribe(lee(fd, H.lins.oCol + x.so * 3, x.sc * 3)); if (pad4(L.nS * 3)) await escribe(Buffer.alloc(pad4(L.nS * 3))); }
      if (A) { const c = Buffer.alloc(8); c.write('ARIS', 0, 'latin1'); c.writeUInt32LE(A.nP, 4); await escribe(c); await escribe(A.tab); for (const [a0, cu] of A.tramos) for (let o = a0; o < a0 + cu;) { const k = Math.min(a0 + cu - o, Math.floor(TROZO / 8)); await escribe(lee(fd, H.aris.oRel + o * 8, k * 8)); o += k; } }
    }
    return { elementos: n, vertices: nv, indices: ni };
  } finally { fs.closeSync(fd); }
}

/** Partes que entran en un presupuesto de triángulos, en el orden del mapa (los primeros niveles primero). Al menos una. */
function porPresupuesto(mapa, maxTri) { const s = []; let t = 0; for (const P of mapa.partes) { if (s.length && t + P.triangulos > maxTri) continue; s.push(P.n); t += P.triangulos; } return s; }

module.exports = { cabecera, arma, guarda, leeMapa, borraMapa, compone, porPresupuesto, rutasMapa, VERSION_MAPA };
