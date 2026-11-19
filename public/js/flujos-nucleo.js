/*
 * NUCLEO DE "FLUJOS HOSPITALARIOS": COPIA LITERAL de la parte pura de public/js/flujos-hospitalarios.js del Visor BIM
 * Federado (v1.417; se prueba en Node alla y aqui). Reglas de clases de ambiente por su nombre, UPSS por el nombre,
 * sondas de una puerta, la red ambientes-puertas (flRed), Dijkstra, rutas, matriz entre UPSS, relaciones exigidas, cruces,
 * bandas a la salida, niveles de una ruta y contornos de huellas. NO SE EDITA AQUI: si cambia en el visor, se vuelve a
 * copiar (herramientas/actualiza-clasificadores.js lo hara cuando se le ensene este archivo).
 * Convencion de coordenadas: las cajas { x1, y1, z1, x2, y2, z2 } con z VERTICAL (las de Revit); m = unidades por metro.
 */
const flNorm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
/** Las clases de ambiente por su nombre (expresiones editables por el administrador; sin tildes, en minusculas). */
const CLASES_DEF = {
  sucio: 'residu|sucio|desech|acopio|lavachata|septico|ropa sucia|cuarto de limpieza|limpieza',
  residuosCentral: 'central de residuos|acopio central|almacen (central )?de residuos|residuos solidos|almacenamiento final',
  cadaver: 'mortuori|morgue|necropsi|cadaver|deposito de cadaveres',
  esteril: 'esteril|esteriliz|ropa limpia|material limpio|almacen de material esteril|cye\\b',
  publico: 'espera|hall|vestibulo|admision|informes|recepcion|atencion al publico|cafeter|ss\\.?hh\\.? publico',
  circulacion: 'circulacion|corredor|pasillo|pasadizo|hall|vestibulo|escalera|ascensor|montacamilla|rampa|esclusa',
  ascensor: 'ascensor|montacamilla|elevador|montacarga',
  escalera: 'escalera',
  exterior: 'exterior|patio|zona segura|plaza|area libre|jardin|anden|patio de maniobras',
};
const CLASES_NOMBRE = { sucio: 'Sucio / residuos', residuosCentral: 'Almacén central de residuos', cadaver: 'Mortuorio', esteril: 'Material estéril / limpio', publico: 'Público / espera',
  circulacion: 'Circulación', ascensor: 'Ascensor / montacamillas', escalera: 'Escalera', exterior: 'Exterior / zona segura' };
function flRegla(txt) { try { return new RegExp(String(txt || '$^'), 'i'); } catch (e) { return /$^/; } }
/** Las clases de un ambiente por su nombre. reglas: { clave: RegExp }. Pura. */
function flClases(nombre, reglas) {
  const n = flNorm(nombre), out = [];
  for (const k in reglas) if (reglas[k].test(n)) out.push(k);
  return out;
}
/** Las UPSS mas comunes, por el NOMBRE del ambiente, cuando el modelo no trae CGM_Subdepartamento. Pura. */
const UPSS_POR_NOMBRE = [
  ['Emergencia', /emergenc|urgenc|trauma shock|triaje|triage/], ['Centro quirúrgico', /quirurg|quirofano|sala de operaciones|recuperacion post|urpa/],
  ['Cuidados intensivos', /\buci\b|\buti\b|cuidados intensivos|cuidados intermedios/], ['Centro obstétrico', /obstetric|sala de parto|dilatacion|\bparto/],
  ['Neonatología', /neonat|\bucin\b|atencion inmediata del recien/], ['Diagnóstico por imágenes', /imagen|rayos x|radiolog|tomograf|resonanc|ecograf|mamograf|densitometr/],
  ['Hospitalización', /hospitaliz|habitacion|cama/], ['Consulta externa', /consulta externa|consultorio/], ['Patología clínica', /laboratorio|patologia clinica|toma de muestras/],
  ['Farmacia', /farmacia|dispensa/], ['Central de esterilización', /esteriliz|\bcye\b/], ['Nutrición', /nutricion|cocina|dietetica/], ['Lavandería', /lavanderi/],
  ['Mortuorio', /mortuori|morgue|necropsi/], ['Medicina de rehabilitación', /rehabilit|fisioterap|terapia fisica/], ['Hemodiálisis', /hemodialisis|dialisis/],
  ['Administración', /administraci|direccion|jefatura|secretaria/],
];
function flUpssPorNombre(nombre) { const n = flNorm(nombre); for (const [u, rx] of UPSS_POR_NOMBRE) if (rx.test(n)) return u; return ''; }
/** El eje delgado de una puerta (por donde se la atraviesa): el lado horizontal mas corto de su caja. caja: { x1..z2 }. Pura. */
function flEjePuerta(c) { return (c.x2 - c.x1) <= (c.y2 - c.y1) ? 'x' : 'y'; }
/** Los dos puntos a cada lado de una puerta, a "fuera" metros de su cara y a 1 m sobre su base (m: unidades por metro). Pura. */
function flSondas(c, m, fuera) {
  const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2, z = c.z1 + 1.0 * m, d = (fuera || 0.6) * m;
  if (flEjePuerta(c) === 'x') { const h = (c.x2 - c.x1) / 2; return [{ x: cx - h - d, y: cy, z }, { x: cx + h + d, y: cy, z }]; }
  const h = (c.y2 - c.y1) / 2; return [{ x: cx, y: cy - h - d, z }, { x: cx, y: cy + h + d, z }];
}
/** El ancho de paso de una puerta por su caja (el lado horizontal mas largo; incluye el marco). Pura. */
function flAnchoCaja(c) { return Math.max(c.x2 - c.x1, c.y2 - c.y1); }
const centroCaja = (c) => ({ x: (c.x1 + c.x2) / 2, y: (c.y1 + c.y2) / 2, z: (c.z1 + c.z2) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** ¿Se solapan en planta dos cajas (al menos "parte" de la menor)? Pura. */
function flSolapePlanta(a, b, parte) {
  const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (ox <= 0 || oy <= 0) return false;
  const am = Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1));
  return am > 0 && ox * oy >= (parte || 0.5) * am;
}
/** ¿Se tocan dos cajas en planta (a menos de "t") y en el mismo piso? Pura. */
function flContiguas(a, b, t) {
  return a.x1 <= b.x2 + t && a.x2 >= b.x1 - t && a.y1 <= b.y2 + t && a.y2 >= b.y1 - t && Math.abs(a.z1 - b.z1) < 1.2 * t / 0.3 && !(a.x1 < b.x2 - t && a.x2 > b.x1 + t && a.y1 < b.y2 - t && a.y2 > b.y1 + t);
}
/**
 * La red. amb: [{ caja, nombre, clases: [] }]; pue: [{ caja, ancho (m, o 0), nombre }]; enAmb(p) -> indice del ambiente que
 * contiene el punto (o -1). m: unidades del visor por metro. op: { vanos: bool }. Devuelve los nodos (puertas y "pasos"
 * verticales o vanos), las aristas y lo que hay a cada lado de cada puerta. Pura (salvo enAmb, que se le pasa).
 */
function flRed(amb, pue, enAmb, m, op) {
  const O = op || {};
  const nodos = [], lados = [], deAmb = amb.map(() => []), ady = [];
  const nodo = (p, tipo, extra) => { const i = nodos.length; nodos.push(Object.assign({ p, tipo }, extra || {})); ady.push([]); return i; };
  const arista = (a, b, w, via, tipo) => { if (a === b) return; ady[a].push({ to: b, w, via, tipo: tipo || '' }); ady[b].push({ to: a, w, via, tipo: tipo || '' }); };
  // las puertas: a que ambientes da cada una
  pue.forEach((d, k) => {
    const [p1, p2] = flSondas(d.caja, m, 0.6);
    const a = enAmb(p1), b = enAmb(p2);
    const c = centroCaja(d.caja); c.z = d.caja.z1 + 1.0 * m;
    const i = nodo(c, 'puerta', { k, ancho: d.ancho || 0, nombre: d.nombre || 'Puerta', a, b, fuera: a < 0 ? p1 : b < 0 ? p2 : null });
    lados.push([a, b]);
    if (a >= 0) deAmb[a].push(i);
    if (b >= 0 && b !== a) deAmb[b].push(i);
  });
  // los ascensores y escaleras sin puerta (su puerta suele ser parte del equipo): un paso al pasillo que toca
  const tieneClase = (i, c) => (amb[i].clases || []).indexOf(c) >= 0;
  const esVertical = (i) => tieneClase(i, 'ascensor') || tieneClase(i, 'escalera');
  const t = 0.3 * m;
  const conPuerta = deAmb.map(L => L.length > 0);
  for (let i = 0; i < amb.length; i++) {
    const sinPuerta = esVertical(i) && !conPuerta[i];   // (siempre: un ascensor sin puerta propia se une a la circulacion que toca)
    if (!sinPuerta && !O.vanos) continue;
    for (let j = 0; j < amb.length; j++) {
      if (j === i || !tieneClase(j, 'circulacion') || esVertical(j)) continue;
      if (!sinPuerta && tieneClase(i, 'circulacion') && j < i) continue;   // (dos circulaciones: una sola vez)
      if (!flContiguas(amb[i].caja, amb[j].caja, t)) continue;
      const a = amb[i].caja, b = amb[j].caja;
      const p = { x: (Math.max(a.x1, b.x1) + Math.min(a.x2, b.x2)) / 2, y: (Math.max(a.y1, b.y1) + Math.min(a.y2, b.y2)) / 2, z: Math.max(a.z1, b.z1) + 1.0 * m };
      const n = nodo(p, 'vano', { a: i, b: j, nombre: 'Paso sin puerta' });
      lados.push([i, j]); deAmb[i].push(n); deAmb[j].push(n);
    }
  }
  // dentro de cada ambiente, de cada paso a cada otro paso: en linea recta
  for (let r = 0; r < amb.length; r++) {
    const L = deAmb[r];
    for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) arista(L[x], L[y], dist(nodos[L[x]].p, nodos[L[y]].p), r, '');
  }
  // los ascensores y escaleras de un piso con los del piso de arriba (el que se solapa en planta, el mas cercano)
  let vert = 0;
  for (const tipo of ['ascensor', 'escalera']) {
    const V = amb.map((a, i) => i).filter(i => tieneClase(i, tipo));
    for (const i of V) {
      let mejor = -1, dz = Infinity;
      for (const j of V) {
        if (j === i) continue;
        const d = amb[j].caja.z1 - amb[i].caja.z1;
        if (d > 1.5 * m && d < dz && flSolapePlanta(amb[i].caja, amb[j].caja, 0.4)) { dz = d; mejor = j; }
      }
      if (mejor < 0) continue;
      const peso = tipo === 'ascensor' ? 8 * m + dz : 2 * dz;   // ascensor: espera y viaje (~8 m de recorrido equivalente); escalera: el doble de lo que sube
      for (const a of deAmb[i]) for (const b of deAmb[mejor]) arista(a, b, peso, -1, tipo);
      vert++;
    }
  }
  return { nodos, ady, lados, deAmb, vert };
}
/** Un monticulo binario minimo (para Dijkstra). */
function Monton() { this.k = []; this.v = []; }
Monton.prototype.mete = function (k, v) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= K[i]) break; [K[p], K[i]] = [K[i], K[p]]; [V[p], V[i]] = [V[i], V[p]]; i = p; } };
Monton.prototype.saca = function () { const K = this.k, V = this.v; const k = K[0], v = V[0], uk = K.pop(), uv = V.pop(); if (K.length) { K[0] = uk; V[0] = uv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < K.length && K[l] < K[m]) m = l; if (r < K.length && K[r] < K[m]) m = r; if (m === i) break; [K[m], K[i]] = [K[i], K[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m; } } return [k, v]; };
/**
 * Caminos minimos desde varias fuentes. R: la red; fuentes: [[nodo, distancia inicial]]; bloquea(nodo) / bloqueaArista(arista):
 * lo que no se puede usar (la camilla). Pura.
 */
function flDijkstra(R, fuentes, bloquea, bloqueaArista) {
  const n = R.nodos.length, D = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), via = new Int32Array(n).fill(-2), tipo = new Array(n);
  const H = new Monton();
  for (const [s, d0] of fuentes) { if (bloquea && bloquea(s)) continue; if (d0 < D[s]) { D[s] = d0; H.mete(d0, s); } }
  while (H.k.length) {
    const [d, u] = H.saca();
    if (d > D[u]) continue;
    for (const e of R.ady[u]) {
      if (bloquea && bloquea(e.to)) continue;
      if (bloqueaArista && bloqueaArista(e)) continue;
      const nd = d + e.w;
      if (nd < D[e.to]) { D[e.to] = nd; prev[e.to] = u; via[e.to] = e.via; tipo[e.to] = e.tipo; H.mete(nd, e.to); }
    }
  }
  return { D, prev, via, tipo };
}
/**
 * La ruta minima de un grupo de ambientes a otro. centros[i]: el punto de partida/llegada de cada ambiente. Devuelve
 * { d (unidades del visor), nodos: [...], ambientes: [indices atravesados, en orden], vertical: { ascensor, escalera } } o null. Pura.
 */
function flRuta(R, A, B, centros, bloquea, bloqueaArista) {
  const SA = new Set(A), SB = new Set(B);
  for (const a of A) if (SB.has(a)) return { d: 0, nodos: [], ambientes: [a], vertical: { ascensor: 0, escalera: 0 }, desde: a, hasta: a };
  const fuentes = [];
  for (const a of A) for (const n of R.deAmb[a] || []) fuentes.push([n, dist(centros[a], R.nodos[n].p)]);
  const S = flDijkstra(R, fuentes, bloquea, bloqueaArista);
  let mejor = Infinity, fin = -1, finAmb = -1;
  for (const b of B) for (const n of R.deAmb[b] || []) { const d = S.D[n] + dist(R.nodos[n].p, centros[b]); if (d < mejor) { mejor = d; fin = n; finAmb = b; } }
  if (fin < 0 || !isFinite(mejor)) return null;
  const cadena = [], vias = [], tipos = [];
  for (let u = fin; u >= 0; u = S.prev[u]) { cadena.push(u); vias.push(S.via[u]); tipos.push(S.tipo[u]); }
  cadena.reverse(); vias.reverse(); tipos.reverse();
  // el ambiente de partida: el de A que toca el primer paso (el mas cercano a el)
  const n0 = cadena[0];
  let desde = -1, dd = Infinity;
  for (const a of A) if ((R.deAmb[a] || []).indexOf(n0) >= 0) { const d = dist(centros[a], R.nodos[n0].p); if (d < dd) { dd = d; desde = a; } }
  const ambientes = [desde];
  for (let i = 1; i < cadena.length; i++) { const v = vias[i]; if (v >= 0 && ambientes[ambientes.length - 1] !== v) ambientes.push(v); }
  if (ambientes[ambientes.length - 1] !== finAmb) ambientes.push(finAmb);
  const vertical = { ascensor: tipos.filter(t => t === 'ascensor').length, escalera: tipos.filter(t => t === 'escalera').length };
  return { d: mejor, nodos: cadena, ambientes, vertical, desde, hasta: finAmb };
}
/** Las distancias de cada grupo a cada otro (una pasada de Dijkstra por grupo). grupos: [[nombre, [ambientes]]]. Pura. */
function flMatriz(R, grupos, centros, bloquea, bloqueaArista) {
  const n = grupos.length, M = [];
  for (let i = 0; i < n; i++) {
    const fuentes = [];
    for (const a of grupos[i][1]) for (const x of R.deAmb[a] || []) fuentes.push([x, dist(centros[a], R.nodos[x].p)]);
    const S = flDijkstra(R, fuentes, bloquea, bloqueaArista);
    const fila = [];
    for (let j = 0; j < n; j++) {
      if (j === i) { fila.push(0); continue; }
      let m = Infinity;
      for (const b of grupos[j][1]) for (const x of R.deAmb[b] || []) { const d = S.D[x] + dist(R.nodos[x].p, centros[b]); if (d < m) m = d; }
      fila.push(m);
    }
    M.push(fila);
  }
  return M;
}
/**
 * ¿Cumple una relacion exigida? rel: { a, b, tipo ('directa' | 'cercana' | 'indirecta'), maxM }; ruta: la de flRuta (con d en
 * metros: dM); upssDe(i): la UPSS de cada ambiente; esCirc(i): si es circulacion. Pura.
 */
function flEvaluaRelacion(rel, ruta, dM, upssDe, esCirc) {
  if (!ruta) return { cumple: false, motivo: 'No hay camino entre las dos (revisa puertas y conexiones verticales).' };
  const otras = [];
  for (const i of ruta.ambientes.slice(1, -1)) { const u = upssDe(i); if (u && u !== rel.a && u !== rel.b && !esCirc(i) && otras.indexOf(u) < 0) otras.push(u); }
  const motivos = [];
  if (rel.tipo === 'directa' && otras.length) motivos.push('atraviesa ' + otras.join(', '));
  if (rel.maxM > 0 && dM > rel.maxM) motivos.push(Math.round(dM - rel.maxM) + ' m más que el máximo (' + rel.maxM + ' m)');
  if (rel.tipo === 'directa' && (ruta.vertical.ascensor || ruta.vertical.escalera) && rel.mismoNivel) motivos.push('cambia de nivel');
  return { cumple: !motivos.length, motivo: motivos.join('; '), otras };
}
/** Los ambientes de una ruta que tienen alguna clase prohibida (sin contar el origen ni el destino). Pura. */
function flCruces(ruta, clasesDe, prohibidas) {
  const out = [];
  if (!ruta) return out;
  for (const i of ruta.ambientes.slice(1, -1)) { const c = clasesDe(i).filter(k => prohibidas.indexOf(k) >= 0); if (c.length) out.push({ i, clases: c }); }
  return out;
}
/** La banda de una distancia a la salida: 0 (hasta la mitad del maximo), 1 (hasta el maximo), 2 (mas), 3 (sin salida). Pura. */
function flBanda(dM, maxM) { if (!isFinite(dM)) return 3; if (!(maxM > 0)) return dM <= 30 ? 0 : dM <= 60 ? 1 : 2; return dM <= maxM / 2 ? 0 : dM <= maxM ? 1 : 2; }

/**
 * v1.416 — Los NIVELES por los que pasa una ruta, para la seccion en planta. zs: la cota de cada punto de la ruta (unidades
 * del visor; cada punto va 1 m sobre el piso de su ambiente o de su puerta); m: unidades por metro; corteM: la altura del
 * corte sobre el piso. Junta los puntos a menos de 1,5 m de altura entre si y devuelve, de abajo hacia arriba,
 * { zMin, zMax, n, piso, corte }: el piso (1 m bajo el punto mas bajo) y la cota del corte (corteM sobre el piso, y nunca
 * por debajo de un punto del recorrido de ese nivel). Pura.
 */
function flNivelesRuta(zs, m, corteM) {
  const M = m > 0 ? m : 1, c = corteM > 0 ? corteM : 1.5;
  const L = (zs || []).filter(z => typeof z === 'number' && isFinite(z)).sort((a, b) => a - b);
  const out = [];
  for (const z of L) {
    const g = out[out.length - 1];
    if (g && z - g.zMin <= 1.5 * M) { g.zMax = z; g.n++; } else out.push({ zMin: z, zMax: z, n: 1 });
  }
  for (const g of out) { g.piso = g.zMin - 1.0 * M; g.corte = Math.max(g.piso + c * M, g.zMax + 0.3 * M); }
  return out;
}
/** v1.416 — El nivel (indice de flNivelesRuta) de una cota: el que la contiene o, si ninguno, el mas cercano. Pura. */
function flNivelDe(niveles, z) {
  let k = -1, d = Infinity;
  (niveles || []).forEach((g, i) => { const e = z < g.zMin ? g.zMin - z : z > g.zMax ? z - g.zMax : 0; if (e < d) { d = e; k = i; } });
  return k;
}
/** v1.416 — El plano de la seccion en planta a la cota "corte" (setCutPlanes conserva lo que da negativo: lo de abajo). Pura. */
function flPlanoPlanta(corte) { return { x: 0, y: 0, z: 1, w: -corte }; }
/**
 * v1.417 — El CONTORNO de una huella en planta: las aristas de sus triangulos que no comparte ningun otro (el borde del
 * ambiente, con sus huecos). T: [ax, ay, bx, by, cx, cy, ...]; q: la tolerancia para juntar vertices (unidades del
 * visor). Devuelve [x1, y1, x2, y2, ...]. Pura.
 */
function flBordes(T, q) {
  const Q = q > 0 ? q : 1e-3, cuenta = new Map(), seg = new Map();
  const k = (x, y) => Math.round(x / Q) + ',' + Math.round(y / Q);
  for (let i = 0; i + 5 < (T ? T.length : 0); i += 6) {
    const v = [[T[i], T[i + 1]], [T[i + 2], T[i + 3]], [T[i + 4], T[i + 5]]];
    for (let j = 0; j < 3; j++) {
      const a = v[j], b = v[(j + 1) % 3], ka = k(a[0], a[1]), kb = k(b[0], b[1]);
      if (ka === kb) continue;
      const e = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      cuenta.set(e, (cuenta.get(e) || 0) + 1);
      if (!seg.has(e)) seg.set(e, [a[0], a[1], b[0], b[1]]);
    }
  }
  const out = [];
  for (const [e, n] of cuenta) if (n === 1) out.push(...seg.get(e));
  return out;
}
/**
 * v1.417 — Un recorrido en la planta de UN nivel: segs (i: el tramo de pts[i] a pts[i+1], los dos en el nivel k) y los
 * cambios de nivel (en que punto del nivel k sube o baja, y de/a que nivel). pts: [{ x, y, z }]; niveles: los de
 * flNivelesRuta. Pura.
 */
function flTramosNivel(pts, niveles, k) {
  const nv = (pts || []).map(p => flNivelDe(niveles, p.z));
  const segs = [], cambios = [];
  for (let i = 0; i + 1 < nv.length; i++) {
    if (nv[i] === k && nv[i + 1] === k) segs.push(i);
    else if (nv[i] === k) cambios.push({ i, otro: nv[i + 1], sube: nv[i + 1] > k, sale: true });
    else if (nv[i + 1] === k) cambios.push({ i: i + 1, otro: nv[i], sube: nv[i] < k, sale: false });
  }
  return { segs, cambios, en: nv.map(x => x === k) };
}

export const P = { flNorm, CLASES_DEF, CLASES_NOMBRE, flRegla, flClases, flUpssPorNombre, flEjePuerta, flSondas, flAnchoCaja, flSolapePlanta, flContiguas, flRed, flDijkstra, flRuta, flMatriz, flEvaluaRelacion, flCruces, flBanda,
  flNivelesRuta, flNivelDe, flPlanoPlanta, flBordes, flTramosNivel };
export { flNorm, CLASES_DEF, CLASES_NOMBRE, flRegla, flClases, flUpssPorNombre, flEjePuerta, flSondas, flAnchoCaja, flSolapePlanta, flContiguas, flRed, flDijkstra, flRuta, flMatriz, flEvaluaRelacion, flCruces, flBanda, flNivelesRuta, flNivelDe, flPlanoPlanta, flBordes, flTramosNivel };
