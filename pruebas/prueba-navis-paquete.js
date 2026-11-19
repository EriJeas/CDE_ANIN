/*
 * Prueba del complemento de Navisworks sin Navisworks: compila con mono (mcs) Paquete.cs + ClienteCde.cs + una prueba que
 * arma un modelo de dos elementos (muro con vidrio y panel de vidrio, en UTM) y lo publica al servidor con llave, como el boton
 * "Publicar al CDE". Luego revisa que el CDE lo indexo y que la geometria .cdeg (formato 2) trae colores, vidrio y origen.
 * Uso: node pruebas/prueba-navis-paquete.js   (necesita mono: mcs y mono en el PATH; si no estan, se salta)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, execFile } = require('child_process');
try { execFileSync('mcs', ['--version'], { stdio: 'ignore' }); } catch (e) { console.log('Sin mono (mcs): prueba saltada.'); process.exit(0); }
/** Lee las secciones opcionales del .cdeg (LINS, ARIS) desde 'ol' (fin de los colores). Devuelve { lin, aris, fin }. */
function secciones(b, d, ol, nE) {
  ol += (4 - ol % 4) % 4; let lin = null, aris = null;
  while (ol + 8 <= b.length) {
    const tag = b.toString('latin1', ol, ol + 4);
    if (tag === 'LINS') {
      const nF = d.getUint32(ol + 4, true), nS = d.getUint32(ol + 8, true); ol += 12; const filas = [];
      for (let i = 0; i < nF; i++, ol += 16) filas.push({ e: d.getUint32(ol, true), so: d.getUint32(ol + 4, true), sc: d.getUint32(ol + 8, true) });
      let z0 = 1e9, z1 = -1e9, x0 = 1e9, x1 = -1e9; for (let k = 0; k < nS * 2; k++) { const x = d.getFloat32(ol + k * 12, true), z = d.getFloat32(ol + k * 12 + 8, true); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      ol += nS * 24 + nS * 3; ol += (4 - ol % 4) % 4; lin = { nF, nS, filas, x0, x1, z0, z1 };
    } else if (tag === 'ARIS') {
      const n = d.getUint32(ol + 4, true); ol += 8; const por = [], tab = ol; ol += nE * 8; let ok = true;
      // cada par apunta a vertices de su elemento (se comprueba contra el vertCount de la tabla de elementos)
      const L = d.getUint32(32, true); let to = 36 + L; to += (4 - to % 4) % 4;
      for (let i = 0; i < nE; i++) { const a0 = d.getUint32(tab + i * 8, true), c = d.getUint32(tab + i * 8 + 4, true), vc = d.getUint32(to + i * 24 + 8, true); por.push(c); for (let q = a0 * 2; q < (a0 + c) * 2; q++) if (d.getUint32(ol + q * 4, true) >= vc) ok = false; }
      ol += n * 8; aris = { n, por, ok };
    } else break;
  }
  return { lin, aris, fin: ol };
}
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-navis-'));
Object.assign(process.env, { DATOS_DIR: DATOS, MODO_ACCESO: 'local', ACCESO_CLAVE: 'prueba', ADMIN_EMAILS: 'admin@anin.gob.pe', SESSION_SECRET: 'secreto-de-prueba', PORT: '0' });
const { app } = require('../servidor');
let fallos = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log('  ok  ' + m); else { fallos++; console.log('  FALLA ' + m); } };
const RAIZ = path.join(__dirname, '..');
(async () => {
  const srv = app.listen(0); await new Promise(r => srv.on('listening', r));
  const B = 'http://localhost:' + srv.address().port; let galleta = '';
  const pide = async (ruta, o) => {
    o = o || {}; o.headers = Object.assign({ cookie: galleta }, o.headers || {});
    if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); delete o.json; }
    const r = await fetch(B + ruta, o); const sc = r.headers.get('set-cookie'); if (sc) galleta = sc.split(';')[0];
    const ct = r.headers.get('content-type') || ''; return { status: r.status, j: /json/.test(ct) ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  try {
    let r = await pide('/api/acceso/local', { json: { email: 'admin@anin.gob.pe', clave: 'prueba' } });
    r = await pide('/api/proyectos', { json: { codigo: 'SECHURA', nombre: 'Centro de Salud Sechura I-4' } }); const pid = r.j.id;
    r = await pide('/api/proyectos/' + pid + '/llaves', { json: { nombre: 'Navisworks prueba' } }); const llave = r.j.llave; ok(llave && llave.length >= 32, 'llave del complemento');
    const exe = path.join(DATOS, 'PruebaPaquete.exe');
    execFileSync('mcs', ['-langversion:latest', '-out:' + exe, '-r:System.Net.Http.dll', '-r:System.Runtime.Serialization.dll', '-r:System.IO.Compression.dll', '-r:System.Core.dll',
      path.join(RAIZ, 'complemento-navisworks/src/Paquete.cs'), path.join(RAIZ, 'complemento-revit/src/ClienteCde.cs'), path.join(RAIZ, 'complemento-revit/src/Modelos.cs'), path.join(__dirname, 'navis/PruebaPaquete.cs')], { stdio: 'inherit' });
    ok(fs.existsSync(exe), 'compila Paquete.cs + ClienteCde.cs con mono');
    // el servidor corre en este mismo proceso: la prueba de mono se lanza sin bloquear (con execFileSync no podria responderle)
    const salida = (await new Promise((res, rej) => execFile('mono', [exe, B, llave, pid, 'SECHURA-GHE-ZZ-XX-M3-A-0009-P01.nwd'], { encoding: 'utf8', timeout: 120000 }, (e, so, se) => e ? rej(new Error((se || '') + e.message)) : res(so)))).trim().split('\n').pop();
    const res = JSON.parse(salida); ok(res.elementos === 3 && res.conGeometria === 3, 'publica: 3 elementos con geometria ' + salida);
    ok(res.simplificados === 1 && res.antes === 80000 && res.triangulos - 36 <= 25000 && res.triangulos - 36 > 2000, 'la pieza densa (80.000 triangulos) se simplifica al tope: ' + (res.triangulos - 36));
    let est = null; for (let i = 0; i < 60; i++) { r = await pide('/api/modelos/' + pid + '/' + res.version + '/estado'); est = r.j; if (est.estado === 'listo' || est.estado === 'error') break; await new Promise(z => setTimeout(z, 250)); }
    ok(est && est.estado === 'listo', 'el CDE arma el indice: ' + JSON.stringify(est).slice(0, 120));
    r = await pide('/api/modelos/' + pid + '/' + res.version + '/elementos'); const C = r.j.columnas, D = r.j.diccionarios;
    ok(C && C.e.length === 3 && D.cat[C.cat[1]] === 'Paneles de muro cortina' && D.modelo[C.modelo[1]] === 'SECHURA-EST.nwc', 'elementos con categoria y archivo de origen');
    r = await pide('/api/modelos/' + pid + '/' + res.version + '/geometria'); const b = r.j, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ver = dv.getUint32(4, true), nE = dv.getUint32(8, true), nV = dv.getUint32(12, true), nI = dv.getUint32(16, true), L = dv.getUint32(32, true);
    ok(b.slice(0, 4).toString() === 'CDEG' && ver === 2 && nE === 3 && nV === res.vertices && nI === res.triangulos * 3, 'cabecera formato 2: ' + [ver, nE, nV, nI].join('/'));
    ok(Math.round(dv.getFloat32(20, true)) === 520116 && Math.round(dv.getFloat32(24, true)) === 9384802, 'origen UTM en la cabecera');
    const meta = JSON.parse(b.slice(36, 36 + L).toString()); ok(meta.origen && meta.origen[1] === 9384802, 'origen exacto en los metadatos');
    let off = 36 + L; off += (4 - off % 4) % 4; const fila = (i) => ({ e: dv.getUint32(off + i * 24, true), vo: dv.getUint32(off + i * 24 + 4, true), vc: dv.getUint32(off + i * 24 + 8, true), io: dv.getUint32(off + i * 24 + 12, true), ic: dv.getUint32(off + i * 24 + 16, true), a: dv.getUint8(off + i * 24 + 23) });
    const f0 = fila(0), f1 = fila(1); ok(f0.e === 1 && f0.vc === 48 && f0.ic === 72 && f0.a === 255 && f1.e === 2 && f1.a < 200, 'tabla: muro opaco (alfa 255) y panel todo vidrio (alfa ' + f1.a + ')');
    const pos = off + nE * 24, idx = pos + nV * 12, tr = idx + nI * 4, col = tr + nE * 4;
    ok(dv.getUint32(tr, true) === 36 && dv.getUint32(tr + 4, true) === 0, 'icTr: el vidrio del muro al final (36 indices); el panel va entero translucido');
    let mx = 0; for (let v = 0; v < nV; v++) mx = Math.max(mx, Math.abs(dv.getFloat32(pos + v * 12, true))); ok(mx < 14, 'posiciones cerca del origen (sin perder precision): max ' + mx.toFixed(2));
    const f2 = fila(2); let r0 = 0, rmin = 9, rmax = 0;   // la esfera simplificada conserva su forma (radio 0.5 alrededor de 8, 1, 1)
    for (let v = f2.vo; v < f2.vo + f2.vc; v++) { const x = dv.getFloat32(pos + v * 12, true) - 8, y = dv.getFloat32(pos + v * 12 + 4, true) - 1, z = dv.getFloat32(pos + v * 12 + 8, true) - 1; r0 = Math.hypot(x, y, z); rmin = Math.min(rmin, r0); rmax = Math.max(rmax, r0); }
    ok(rmin > 0.47 && rmax < 0.51 && f2.ic / 3 <= 25000, 'la esfera simplificada conserva su forma: radio ' + rmin.toFixed(3) + '–' + rmax.toFixed(3) + ', ' + f2.ic / 3 + ' triangulos');
    const rgb = (v) => [b[col + v * 3], b[col + v * 3 + 1], b[col + v * 3 + 2]].join(',');
    ok(rgb(0) === '245,245,245' && rgb(24) === '0,128,192' && rgb(48) === '250,250,250', 'colores por vertice: muro, vidrio azul propio y vidrio claro con su color de Navisworks (' + [rgb(0), rgb(24), rgb(48)].join(' | ') + ')');
    { const S = secciones(b, dv, col + nV * 3, nE); ok(S.aris && S.fin === b.length && S.aris.por[0] === 24 && S.aris.por[1] === 12 && S.aris.por[2] === 0 && S.aris.ok, 'aristas precalculadas (seccion ARIS): ' + (S.aris ? S.aris.n : 0) + ' pares; muro + vano (dos cajas) 24, panel 12, esfera lisa 0 (sin diagonales ni lineas en lo curvo): ' + (S.aris ? S.aris.por.slice(0, 3).join(', ') : '-') + '; el archivo cuadra'); }
    // 2) sin servidor: rejilla comun (1 cm) + tope total (20.000) sobre ~60.000 triangulos
    const t = JSON.parse((await new Promise((res, rej) => execFile('mono', [exe, 'tope'], { encoding: 'utf8', timeout: 120000 }, (e, so, se) => e ? rej(new Error((se || '') + e.message)) : res(so)))).trim().split('\n').pop());
    ok(t.leidos === 12 + 12 + 500 + 10 * 7200 + 12 + 4 * 1200 && t.triangulos <= 25000 && t.triangulos > 4000, 'tope total: ' + t.leidos + ' leidos → ' + t.sinTope + ' tras rejilla y tope por elemento → ' + t.triangulos + ' (tope 20.000, se acepta hasta +25 %)');
    const g = fs.readFileSync(t.ruta), gv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    const gE = gv.getUint32(8, true), gV = gv.getUint32(12, true), gI = gv.getUint32(16, true), gL = gv.getUint32(32, true);
    let go = 36 + gL; go += (4 - go % 4) % 4; const gPos = go + gE * 24, gIdx = gPos + gV * 12, gTr = gIdx + gI * 4, gCol = gTr + gE * 4;
    const gS = secciones(g, gv, gCol + gV * 3, gE);
    ok(gE === 13 && gV === t.vertices && gI === t.triangulos * 3 && gS.fin === g.length && gS.aris && gS.aris.ok, 'el .cdeg reescrito cuadra: ' + gE + ' elementos, ' + gV + ' vertices, ' + gI + ' indices, ' + (gS.aris ? gS.aris.n : 0) + ' aristas (pares dentro de cada elemento), ' + g.length + ' bytes');
    let bien = true, vSum = 0, iSum = 0; const fl = [];
    for (let i = 0; i < gE; i++) {
      const q = go + i * 24, f = { e: gv.getUint32(q, true), vo: gv.getUint32(q + 4, true), vc: gv.getUint32(q + 8, true), io: gv.getUint32(q + 12, true), ic: gv.getUint32(q + 16, true), a: gv.getUint8(q + 23), tr: gv.getUint32(gTr + i * 4, true) };
      fl.push(f); if (f.vo !== vSum || f.io !== iSum || f.tr > f.ic) bien = false; vSum += f.vc; iSum += f.ic;
      for (let k = 0; k < f.ic; k++) if (gv.getUint32(gIdx + (f.io + k) * 4, true) >= f.vc) { bien = false; break; }
    }
    ok(bien && vSum === gV && iSum === gI, 'tabla contigua e indices dentro de cada elemento');
    ok(fl[0].ic === 36 && fl[1].ic === 36, 'el muro (12) queda intacto y los 500 tornillos de 2 mm desaparecen con la rejilla de 1 cm: ' + fl[0].ic / 3 + ' y ' + fl[1].ic / 3);
    ok(fl.slice(2, 10).every(f => f.ic / 3 < 7200 && f.ic / 3 > 200), 'las esferas pesadas se aligeran: ' + fl.slice(2, 10).map(f => f.ic / 3).join(', '));
    ok(fl[10].tr > 0 && fl[10].tr < fl[10].ic && fl[10].a === 255 && fl[11].tr === 0 && fl[11].a < 200, 'el vidrio sigue separado tras reescribir: mixto icTr ' + fl[10].tr + '/' + fl[10].ic + ', todo vidrio icTr 0 alfa ' + fl[11].a);
    let rmn = 9, rmx = 0; for (let v = fl[5].vo; v < fl[5].vo + fl[5].vc; v++) { const d = Math.hypot(gv.getFloat32(gPos + v * 12, true) - 18, gv.getFloat32(gPos + v * 12 + 4, true) - 10, gv.getFloat32(gPos + v * 12 + 8, true) - 1); rmn = Math.min(rmn, d); rmx = Math.max(rmx, d); }
    ok(rmn > 0.4 && rmx < 0.52, 'una esfera aligerada conserva su forma: radio ' + rmn.toFixed(3) + '–' + rmx.toFixed(3));
    { // el marco de ventana: se aligera, pero ningun triangulo cruza el vano de 0,8 m (x 44,1..44,9; z 0,1..0,9 respecto al origen)
      const f = fl[12]; let cruza = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      const P = (i) => [gv.getFloat32(gPos + i * 12, true), gv.getFloat32(gPos + i * 12 + 4, true), gv.getFloat32(gPos + i * 12 + 8, true)];
      for (let k = 0; k < f.ic; k += 3) {
        const a = P(f.vo + gv.getUint32(gIdx + (f.io + k) * 4, true)), b = P(f.vo + gv.getUint32(gIdx + (f.io + k + 1) * 4, true)), c = P(f.vo + gv.getUint32(gIdx + (f.io + k + 2) * 4, true));
        const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
        if (cx > 44.12 && cx < 44.88 && cz > 0.12 && cz < 0.88) cruza++;
        for (const p of [a, b, c]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
      }
      ok(f.ic / 3 < 4800 && cruza === 0 && Math.abs(x1 - x0 - 1) < 0.02 && Math.abs(z1 - z0 - 1) < 0.02, 'el marco de ventana se aligera (' + 4800 + ' → ' + f.ic / 3 + ' triangulos) sin triangulos cruzando el vano (' + cruza + ') y con su tamano (' + (x1 - x0).toFixed(3) + ' x ' + (z1 - z0).toFixed(3) + ' m)');
    }
    fs.rmSync(path.dirname(t.ruta), { recursive: true, force: true });
    // 3) lo mismo con 4 hilos (como en Navisworks: se simplifica mientras se lee): el orden de los elementos puede cambiar pero
    //    cada elemento debe quedar igual; y con el aligerado de 1 cm al leer, menos triangulos y el vano de la ventana limpio
    const corre = async (args) => JSON.parse((await new Promise((res, rej) => execFile('mono', [exe, ...args], { encoding: 'utf8', timeout: 120000 }, (e, so, se) => e ? rej(new Error((se || '') + e.message)) : res(so)))).trim().split('\n').pop());
    const leeCdeg = (ruta) => {
      const b = fs.readFileSync(ruta), d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const nE = d.getUint32(8, true), nV = d.getUint32(12, true), nI = d.getUint32(16, true), L = d.getUint32(32, true);
      let o = 36 + L; o += (4 - o % 4) % 4; const pPos = o + nE * 24, pIdx = pPos + nV * 12, pTr = pIdx + nI * 4;
      const por = new Map(); let contigua = true, vs = 0, is = 0, cruza = 0;
      for (let i = 0; i < nE; i++) {
        const q = o + i * 24, f = { e: d.getUint32(q, true), vo: d.getUint32(q + 4, true), vc: d.getUint32(q + 8, true), io: d.getUint32(q + 12, true), ic: d.getUint32(q + 16, true), tr: d.getUint32(pTr + i * 4, true) };
        if (f.vo !== vs || f.io !== is || f.tr > f.ic) contigua = false; vs += f.vc; is += f.ic; por.set(f.e, f);
        for (let k = 0; k < f.ic; k++) if (d.getUint32(pIdx + (f.io + k) * 4, true) >= f.vc) { contigua = false; break; }
        if (f.e === 13) for (let k = 0; k < f.ic; k += 3) {
          let cx = 0, cz = 0; for (let j = 0; j < 3; j++) { const v = f.vo + d.getUint32(pIdx + (f.io + k + j) * 4, true); cx += d.getFloat32(pPos + v * 12, true) / 3; cz += d.getFloat32(pPos + v * 12 + 8, true) / 3; }
          if (cx > 44.12 && cx < 44.88 && cz > 0.12 && cz < 0.88) cruza++;
        }
      }
      // secciones opcionales (LINS, ARIS) despues de los colores
      const S = secciones(b, d, pTr + nE * 4 + nV * 3, nE); const lin = S.lin; if (lin) lin.largo = S.fin === b.length;
      fs.rmSync(path.dirname(ruta), { recursive: true, force: true });
      return { nE, contigua: contigua && vs === nV && is === nI, por, cruza, lin };
    };
    const t4 = await corre(['tope', '4']), c4 = leeCdeg(t4.ruta);
    const iguales = fl.every(f => c4.por.has(f.e) && c4.por.get(f.e).ic === f.ic && c4.por.get(f.e).tr === f.tr);
    ok(t4.leidos === t.leidos && t4.triangulos === t.triangulos && t4.vertices === t.vertices && c4.nE === 13 && c4.contigua && iguales, 'con 4 hilos sale lo mismo: ' + t4.triangulos + ' triangulos, ' + t4.vertices + ' vertices, 13 elementos iguales uno a uno, tabla contigua');
    const tA = await corre(['tope', '4', 'aligera']), cA = leeCdeg(tA.ruta);
    ok(tA.triangulos - (cA.por.has(15) ? cA.por.get(15).ic / 3 : 0) <= t.triangulos && cA.nE === 14 && cA.contigua && cA.cruza === 0 && cA.por.get(1).ic === 36, 'aligerando al leer (1 cm, 4 hilos): ' + (tA.triangulos - (cA.por.has(15) ? cA.por.get(15).ic / 3 : 0)) + ' triangulos sin la ventana 15 (sin aligerar al leer ' + t.triangulos + '), muro intacto, vano de la ventana limpio (' + cA.cruza + ')');
    const v15 = cA.por.get(15);
    ok(v15 && v15.tr === 16 * 3 && v15.ic > v15.tr, 'los 4 vidrios de dos caras de una ventana aligerada quedan enteros: ' + (v15 ? v15.tr / 3 : 0) + ' triangulos de vidrio de 16 (marco ' + (v15 ? (v15.ic - v15.tr) / 3 : 0) + ')');
    const LN = cA.lin;
    ok(LN && LN.nF === 1 && LN.filas[0].e === 14 && LN.nS === tA.segmentos && tA.segmentosLeidos === 12040 && LN.nS <= 2000 && LN.nS > 300 && LN.largo && !cA.por.has(14),
      'el arbol de solo lineas viaja en la seccion LINS: ' + (LN ? LN.nS : 0) + ' segmentos de ' + tA.segmentosLeidos + ' (tope 2.000), sin triangulos y el archivo cuadra');
    ok(LN && LN.z1 - LN.z0 > 4.6 && LN.z0 < 0.3 && LN.x1 - LN.x0 > 2.6, 'el arbol conserva su silueta: alto ' + (LN ? (LN.z1 - LN.z0).toFixed(2) : 0) + ' m, ancho ' + (LN ? (LN.x1 - LN.x0).toFixed(2) : 0) + ' m (tronco + copa de 3 m)');
    r = await pide('/api/modelos/' + pid + '/lista'); const arr = Array.isArray(r.j) ? r.j : (r.j.modelos || r.j.lista || []);
    ok(arr.some(m => m.vid === res.version && m.indice && m.indice.estado === 'listo'), 'aparece en la lista del visor como modelo listo');
  } catch (e) { fallos++; console.log('  FALLA ' + (e.stack || e)); }
  srv.close(); console.log('\n' + (n - fallos) + ' de ' + n + ' comprobaciones correctas.'); process.exit(fallos ? 1 : 0);
})();
