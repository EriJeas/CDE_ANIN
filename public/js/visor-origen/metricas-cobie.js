/* ORIGEN: Visor BIM Federado (visor-bim-anin v3.1.0, public/js/app.js). Copia TAL CUAL de las lineas indicadas; no se edita aqui.
 * Lo que este codigo espera del visor (props, filters, viewer, models, $...) lo da visor-puente.js. */
// --- app.js 21566-22196: Metricas BIM del modelo cargado (v1.129/1.134) y Mantenimiento - COBIE (v1.133) ---

/* ============================== METRICAS BIM ==============================
 * v1.129: las metricas 6, 7 y 8 SOBRE EL MODELO CARGADO, con clic-al-
 * elemento. 6) completitud de parametros obligatorios (LOIN del PEB),
 * 7) genericos / sin clasificar, 8) conteo por categoria y su DELTA contra
 * una FOTO guardada (compara la version que cargues despues). La cosecha
 * usa getBulkProperties2 modelo por modelo (el federado carga varios) y
 * cada barra o fila AISLA en el visor los elementos que senala — los demas
 * se ocultan — y "Mostrar todo" lo deshace. Cero llamadas al servidor:
 * todo sale del modelo ya cargado.
 */
const MB = { filas: [], props: [], cats: null };
// v1.132: nombres de la propiedad de categoria, PROPIOS del modulo. El bug de
// "no carga nada" era este: NOMBRES es una constante local de otra funcion, y
// referenciarla aqui reventaba la promesa sin catch — el "Cosechando..." se
// quedaba eterno.
const MB_CAT = ['Categoria', 'Category', 'Categor\u00eda'];

function mbModelos() {
  try {
    if (viewer && viewer.getVisibleModels) return viewer.getVisibleModels() || [];
    if (viewer && viewer.impl && viewer.impl.modelQueue)
      return viewer.impl.modelQueue().getModels() || [];
  } catch (e) {}
  return [];
}

/** Las HOJAS del arbol de un modelo (los elementos de verdad). */
function mbHojas(m) {
  const t = m.getInstanceTree && m.getInstanceTree();
  if (!t) return [];
  const ids = [];
  t.enumNodeChildren(t.getRootId(), (id) => {
    if (!t.getChildCount(id)) ids.push(id);
  }, true);
  return ids;
}

/** Cosecha categoria + parametros pedidos de TODOS los modelos visibles,
 * POR LOTES y con progreso. v1.133: los ids SIN respuesta tambien cuentan —
 * en NWD el propFilter omite elementos enteros y eso falseaba el censo (el
 * "0 cosechados"): ahora CADA id del arbol entra, con o sin propiedades, y
 * los lotes que fallan se cuentan y se dicen. */
function mbCosecha(props, avisa) {
  const filas = [];
  const trozos = [];
  const LOTE = 20000;
  let total = 0;
  for (const m of mbModelos()) {
    const ids = mbHojas(m);
    total += ids.length;
    for (let i = 0; i < ids.length; i += LOTE)
      trozos.push({ m: m, ids: ids.slice(i, i + LOTE) });
  }
  let hechos = 0, fallos = 0, motivo = '';
  const uno = (t) => new Promise((res) => {
    const cierra = (lote) => {
      const porId = new Map();
      for (const el of lote || []) porId.set(el.dbId, el);
      for (const id of t.ids) {
        const el = porId.get(id);
        let cat = '';
        const vals = {};
        for (const pr of (el && el.properties) || []) {
          const dn = pr.displayName || pr.attributeName || '';
          if (!cat && MB_CAT.indexOf(dn) >= 0) cat = String(pr.displayValue || '');
          if (props.indexOf(dn) >= 0 && vals[dn] == null) vals[dn] = pr.displayValue;
        }
        filas.push({ m: t.m, id: id, cat: cat, vals: vals });
      }
      hechos += t.ids.length;
      if (avisa) avisa(hechos, total);
      res();
    };
    t.m.getBulkProperties2(t.ids, { propFilter: MB_CAT.concat(props),
                                    needsExternalId: false },
      cierra,
      (err) => {
        fallos++;
        if (!motivo) motivo = (err && err.message) || String(err || 'sin motivo');
        cierra([]);
      });
  });
  return trozos.reduce((p, t) => p.then(() => uno(t)), Promise.resolve())
    .then(() => ({ filas: filas, total: total, fallos: fallos, motivo: motivo }));
}

/** Reduce la cosecha a las metricas 6/7/8. Pura. */
function mbResumen(filas, props) {
  const total = filas.length;
  const porParam = props.map((pn) => {
    let sin = 0;
    for (const f of filas) {
      const v = f.vals[pn];
      if (v == null || String(v).trim() === '') sin++;
    }
    return { pn: pn, sin: sin,
             pct: total ? Math.round(100 * (total - sin) / total) : 0 };
  });
  let completos = 0;
  for (const f of filas)
    if (props.every((pn) => {
      const v = f.vals[pn];
      return v != null && String(v).trim() !== '';
    })) completos++;
  const esGen = (c) => /generic|gen[e\u00e9]rico|proxy|sin categor/i
    .test(String(c || '(sin categoria)'));
  let genericos = 0;
  const porCat = new Map();
  for (const f of filas) {
    const c = f.cat || '(sin categoria)';
    porCat.set(c, (porCat.get(c) || 0) + 1);
    if (esGen(c)) genericos++;
  }
  const cats = [...porCat.entries()].map(([k, n]) => ({ k: k, n: n }))
    .sort((a, b) => b.n - a.n);
  return { total: total, porParam: porParam, completos: completos,
           genericos: genericos, cats: cats };
}

/** Delta de categorias contra la foto guardada. Pura. */
function mbDelta(fotoCats, cats) {
  const antes = new Map((fotoCats || []).map((c) => [c.k, c.n]));
  const ahora = new Map((cats || []).map((c) => [c.k, c.n]));
  const claves = new Set([...antes.keys(), ...ahora.keys()]);
  return [...claves].map((k) => {
    const a = antes.get(k) || 0, b = ahora.get(k) || 0;
    return { k: k, antes: a, ahora: b, d: b - a };
  }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || y.ahora - x.ahora);
}

/** Aisla en el visor los elementos cosechados que cumplen pred; los modelos
 * sin ninguno se OCULTAN enteros. Devuelve cuantos aislo. */
function mbAisla(pred, rotulo) {
  const porM = new Map();
  let n = 0;
  for (const f of MB.filas) if (pred(f)) {
    if (!porM.has(f.m)) porM.set(f.m, []);
    porM.get(f.m).push(f.id);
    n++;
  }
  try { viewer.setGhosting(false); } catch (e) {}   // v1.134: sin esto, el aislado era invisible
  for (const m of mbModelos()) {
    const ids = porM.get(m) || [];
    const t = m.getInstanceTree && m.getInstanceTree();
    if (ids.length) {
      if (t) viewer.show(t.getRootId(), m);
      viewer.isolate(ids, m);
    } else if (t) {
      viewer.isolate([], m);
      viewer.hide(t.getRootId(), m);
    }
  }
  try { if (n) viewer.fitToView(); } catch (e) {}
  if ($('mbInfo')) $('mbInfo').textContent = n
    ? 'Aislados ' + n.toLocaleString('es-PE') + ' elemento(s): ' + rotulo +
      ' - "Mostrar todo" lo deshace.'
    : 'Ningun elemento cumple: ' + rotulo;
  return n;
}

function mbTodo() {
  for (const m of mbModelos()) {
    const t = m.getInstanceTree && m.getInstanceTree();
    viewer.isolate([], m);
    if (t) viewer.show(t.getRootId(), m);
  }
  try { viewer.setGhosting(true); } catch (e) {}
  if ($('mbInfo')) $('mbInfo').textContent = '';
}

function mbFoto() {
  try { return JSON.parse(localStorage.getItem('mbFoto') || 'null'); }
  catch (e) { return null; }
}

function mbGuardaFoto() {
  if (!MB.cats) return alert('Analiza primero: la foto guarda el conteo por categoria.');
  localStorage.setItem('mbFoto', JSON.stringify(
    { fecha: new Date().toISOString().slice(0, 10), cats: MB.cats }));
  $('mbInfo').textContent = 'Foto guardada. Carga otra version del modelo, ' +
    'pulsa Analizar, y el delta aparecera solo.';
}

function mbAbre() {
  if (!mbModelos().length && $('mbInfo'))
    $('mbInfo').textContent = 'Carga un modelo (o el federado) y pulsa Analizar.';
}

/** Casa cada nombre pedido con los parametros del indice que lo CONTIENEN. */
function mbParamsQueCalzan(token) {
  const t = sinTildes(token);
  return (props.params || []).filter(p => !p.startsWith('\u25cf') &&
    sinTildes(p).includes(t));
}

/** v1.134: metricas 6/7/8 desde el INDICE de Filtro Sectores. */
function mbDesdeIndice(tokens) {
  MB.modo = 'indice';
  const total = props.total;
  const porTok = tokens.map(tok => {
    const ps = mbParamsQueCalzan(tok);
    const F = new Set();
    for (const p of ps)
      for (const id of cbLlenos(props.byParam.get(p))) F.add(id);
    return { tok: tok, ps: ps, F: F };
  });
  let completos = 0;
  if (porTok.length && porTok.every(x => x.F.size)) {
    const menor = porTok.reduce((a, b) => (a.F.size <= b.F.size ? a : b));
    for (const id of menor.F) if (porTok.every(x => x.F.has(id))) completos++;
  }
  const cp = cbCanon(['categoria', 'category']);
  const catMap = (cp && props.byParam.get(cp)) || new Map();
  const cats = [];
  const catIds = new Map();
  const genIds = new Set();
  let categorizados = 0;
  for (const [v, ids] of catMap) {
    const k = String(v).trim() || '(sin categoria)';
    cats.push({ k: k, n: ids.length });
    catIds.set(k, ids);
    categorizados += ids.length;
    if (/generic|gen[e\u00e9]rico|proxy/i.test(k)) for (const id of ids) genIds.add(id);
  }
  const sinCat = Math.max(0, total - categorizados);
  if (sinCat) cats.push({ k: '(sin categoria)', n: sinCat });
  cats.sort((a, b) => b.n - a.n);
  MB.idx = { porTok: porTok, genIds: genIds, catIds: catIds };
  MB.cats = cats;
  $('mbInfo').textContent = 'Fuente: el INDICE de Filtro Sectores (' +
    total.toLocaleString('es-PE') + ' elementos), al instante. Cada nombre pedido ' +
    'agrupa a TODOS los parametros del indice que lo contienen.';
  mbPinta({
    total: total,
    fuente: 'indice',
    porParam: porTok.map(x => ({
      pn: x.tok + ' [' + x.ps.length + ' param. del indice]',
      tok: x.tok,
      sin: total - x.F.size,
      pct: Math.round(100 * x.F.size / total),
    })),
    completos: completos,
    genericos: genIds.size + sinCat,
    cats: cats,
  });
}

async function mbAnaliza() {
  const pedidos = String($('mbProps').value || '').split(',')
    .map((s) => s.trim()).filter(Boolean);
  if (!mbModelos().length) return alert('Carga un modelo primero.');
  if (!pedidos.length) return alert('Indica al menos un parametro obligatorio.');
  $('mbZona').innerHTML = '';
  MB.props = props;
  // v1.134: si el indice de Filtro Sectores existe, las metricas salen de
  // AHI — al instante, con los nombres reales del modelo (en NWD la cosecha
  // directa por displayName se queda corta). Sin indice, cosecha por lotes.
  if (typeof props !== 'undefined' && props && props.total) {
    try { return mbDesdeIndice(pedidos); } catch (e) {
      $('mbInfo').textContent = 'Fallo leyendo el indice: ' + (e.message || e);
      return;
    }
  }
  $('mbInfo').textContent = 'Cosechando propiedades del modelo...';
  try {
    MB.modo = 'filas';
    const cos = await mbCosecha(pedidos, (h, t) => {
      $('mbInfo').textContent = 'Cosechando propiedades... ' +
        h.toLocaleString('es-PE') + ' de ' + t.toLocaleString('es-PE') + ' elementos';
    });
    if (!cos.total) {
      $('mbInfo').textContent = 'El arbol del modelo no entrego elementos: ' +
        'espera a que termine de cargar del todo y vuelve a Analizar.';
      return;
    }
    MB.filas = cos.filas;
    const r = mbResumen(MB.filas, pedidos);
    MB.cats = r.cats;
    $('mbInfo').textContent = cos.fallos
      ? 'Ojo: ' + cos.fallos + ' lote(s) de propiedades fallaron (' + cos.motivo +
        ') - los conteos pueden quedarse cortos.'
      : '';
    mbPinta(r);
  } catch (e) {
    // v1.132: si algo revienta, se DICE — nada de "Cosechando..." eterno.
    $('mbInfo').textContent = 'Fallo la cosecha: ' + (e && e.message ? e.message : e);
  }
}

function mbPinta(r) {
  const barra = (pct, k, extra, atributos) => '<div ' + atributos +
    ' style="cursor:pointer;display:flex;align-items:center;gap:8px;margin:3px 0">' +
    '<div style="width:190px;font-size:11px;overflow:hidden;text-overflow:ellipsis;' +
    'white-space:nowrap" title="' + escAttr(k) + '">' + esc(k) + '</div>' +
    '<div style="flex:1;background:#1b232b;border-radius:4px;height:12px">' +
    '<div style="height:12px;border-radius:4px;width:' + Math.max(0, Math.min(100, pct)) +
    '%;background:' + (pct >= 90 ? '#2e9e4f' : pct >= 60 ? '#d29a2b' : '#c0392b') +
    '"></div></div><div style="width:150px;font-size:11px;text-align:right">' +
    esc(extra) + '</div></div>';
  const kpi = (v, t, sub) => '<div style="min-width:140px"><div style="font-size:22px;' +
    'font-weight:700">' + v + '</div><div class="hint">' + t + '</div>' +
    '<div class="hint" style="opacity:.7">' + sub + '</div></div>';
  const caja = (tit, cuerpo) => '<div style="background:#141a20;border:1px solid #232c34;' +
    'border-radius:6px;padding:8px;margin-bottom:10px"><div class="hint" ' +
    'style="font-weight:600;margin-bottom:4px">' + tit + '</div>' + cuerpo + '</div>';
  const pctLoin = r.total ? Math.round(100 * r.completos / r.total) : 0;
  let h = '<div style="display:flex;gap:20px;flex-wrap:wrap;margin:8px 0 10px">' +
    kpi(r.total.toLocaleString('es-PE'), 'elementos cosechados',
        r.fuente === 'indice' ? 'del INDICE de Filtro Sectores'
                              : mbModelos().length + ' modelo(s) visibles') +
    kpi(pctLoin + '%', 'completitud LOIN',
        r.completos.toLocaleString('es-PE') + ' con TODOS los parametros') +
    kpi(r.genericos.toLocaleString('es-PE'), 'genericos / sin clasificar',
        (r.total ? Math.round(100 * r.genericos / r.total) : 0) + '% del modelo') +
    kpi(r.cats.length, 'categorias', 'clic en una: aislarla') + '</div>';
  h += caja('6. Completitud por parametro obligatorio (clic: aislar los que NO lo tienen)',
    r.porParam.map((p) => barra(p.pct, p.pn,
      p.sin.toLocaleString('es-PE') + ' sin dato (' + p.pct + '% lleno)',
      'data-mb="param" data-k="' + escAttr(p.tok || p.pn) + '"')).join('') || '<div class="hint">(sin parametros)</div>');
  h += caja('7. Genericos / sin clasificar (clic: aislarlos)',
    '<div data-mb="gen" style="cursor:pointer" class="hint">' +
    r.genericos.toLocaleString('es-PE') + ' elemento(s) en categorias genericas o sin categoria - clic para verlos solos</div>');
  const foto = mbFoto();
  let t8 = r.cats.slice(0, 20).map((c) => barra(
    r.total ? 100 * c.n / (r.cats[0].n || 1) : 0, c.k,
    c.n.toLocaleString('es-PE') + ' elem.',
    'data-mb="cat" data-k="' + escAttr(c.k) + '"')).join('');
  if (foto && foto.cats) {
    const d = mbDelta(foto.cats, r.cats).filter((x) => x.d !== 0).slice(0, 15);
    t8 += '<div class="hint" style="font-weight:600;margin:8px 0 4px">Delta contra la foto del ' +
      esc(foto.fecha) + (d.length ? '' : ' - sin cambios') + '</div>' +
      d.map((x) => '<div class="hint">' + esc(x.k) + ': ' + x.antes + ' \u2192 ' + x.ahora +
        ' (<span style="color:' + (x.d > 0 ? '#2e9e4f' : '#c0392b') + '">' +
        (x.d > 0 ? '+' : '') + x.d + '</span>)</div>').join('');
  }
  h += caja('8. Elementos por categoria' + (foto ? ' y delta entre versiones' : ''), t8);
  $('mbZona').innerHTML = h;
  $('mbZona').querySelectorAll('[data-mb]').forEach((el) => el.onclick = () => {
    const tipo = el.getAttribute('data-mb'), k = el.getAttribute('data-k') || '';
    if (MB.modo === 'indice') {
      // v1.134: en modo indice se aisla con los ids del indice (via cbAisla,
      // que ya apaga el fantasma). El mensaje cae en mbInfo, no en cbInfo.
      const di = $('cbInfo');
      const aqui = (setIds, rot) => {
        cbAisla(setIds, rot);
        if (di && $('mbInfo')) { $('mbInfo').textContent = di.textContent; di.textContent = ''; }
      };
      if (tipo === 'param') {
        const x = (MB.idx.porTok || []).find(t => t.tok === k);
        if (!x) return;
        const sin = new Set();
        for (const [, ids] of MB.idx.catIds) for (const id of ids) if (!x.F.has(id)) sin.add(id);
        aqui(sin, 'sin "' + k + '" (de los categorizados por el indice)');
      } else if (tipo === 'gen') {
        aqui(MB.idx.genIds, 'genericos segun el indice');
      } else if (tipo === 'cat') {
        aqui(new Set(MB.idx.catIds.get(k) || []), 'categoria "' + k + '"');
      }
      return;
    }
    if (tipo === 'param')
      mbAisla((f) => { const v = f.vals[k];
        return v == null || String(v).trim() === ''; }, 'sin "' + k + '"');
    else if (tipo === 'gen')
      mbAisla((f) => /generic|gen[e\u00e9]rico|proxy|sin categor/i
        .test(String(f.cat || '(sin categoria)')), 'genericos / sin clasificar');
    else if (tipo === 'cat')
      mbAisla((f) => (f.cat || '(sin categoria)') === k, 'categoria "' + k + '"');
  });
}

if ($('mbAnaliza')) $('mbAnaliza').onclick = () => { mbAnaliza(); };
if ($('mbFotoBtn')) $('mbFotoBtn').onclick = mbGuardaFoto;
if ($('mbTodoBtn')) $('mbTodoBtn').onclick = mbTodo;
if ($('mbCerrar')) $('mbCerrar').onclick = () => {
  try { activaModulo('mbim'); }
  catch (e) { $('mbPanel').classList.add('hidden'); }
};

/* ========================== MANTENIMIENTO - COBIE ==========================
 * v1.133: los parametros COBie y Uniclass del INDICE de Filtro Sectores
 * (props.byParam) — nada de cosechar en paralelo: se reusa lo ya elaborado.
 * Grupos por segmento (COBie.Floor.* -> "Floor", COBie.Component.* ->
 * "Component"; todo lo Uniclass, en "Uniclass"). Por grupo: % de llenado de
 * cada parametro con clic para AISLAR a los que NO lo tienen, y a la
 * derecha el tablero de % llenado por CATEGORIA y por TIPO, cruzando los
 * ids del propio indice (las canonicas "● Categoria" / "● Tipo" que el
 * indexador ya repara). Requiere haber indexado; si no, lo dice.
 */
const CB = { grupo: '', universo: null };

/** Agrupa nombres de parametro: COBie.<Grupo>.* y Uniclass. Pura. */
function cbGrupos(params) {
  const g = new Map();
  for (const p of params || []) {
    const m = /cobie[._ ]*([a-z0-9]+)/i.exec(p);
    let k = '';
    if (m) k = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    else if (/uniclass/i.test(p)) k = 'Uniclass';
    if (!k) continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  return [...g.entries()].map(([k, ps]) => ({ k: k, params: ps.sort() }))
    .sort((a, b) => b.params.length - a.params.length || a.k.localeCompare(b.k));
}

/** Ids con valor NO vacio en un mapa valor->ids del indice. Pura. */
function cbLlenos(mapaVals) {
  const s = new Set();
  if (!mapaVals) return s;
  for (const [v, ids] of mapaVals) {
    if (!String(v).trim()) continue;
    for (const id of ids) s.add(id);
  }
  return s;
}

/** El parametro del indice cuyo nombre, normalizado a solo letras, calza. */
function cbCanon(nombres) {
  // v1.134: primero las canonicas del indice (\u25cf Categoria / \u25cf Tipo,
  // reconstruidas del arbol); solo si no existen, cualquier otro parametro
  // que calce — el "Tipo" suelto de un NWD traia valores 0/1 de relleno.
  const calza = (p) => nombres.includes(sinTildes(p).replace(/[^a-z]/g, ''));
  for (const p of props.params || []) if (p.startsWith('\u25cf') && calza(p)) return p;
  for (const p of props.params || []) if (calza(p)) return p;
  return '';
}

function cbUniverso() {
  if (CB.universo && CB.universo.total === props.total) return CB.universo.u;
  const u = new Set();
  const cp = cbCanon(['categoria', 'category']);
  const mapa = cp && props.byParam.get(cp);
  if (mapa) for (const [, ids] of mapa) for (const id of ids) u.add(id);
  CB.universo = { u: u, total: props.total };
  return u;
}

function cbBarra(pct, k, extra, atributos) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return '<div ' + (atributos || '') + ' style="' + (atributos ? 'cursor:pointer;' : '') +
    'display:flex;align-items:center;gap:8px;margin:3px 0">' +
    '<div style="width:190px;font-size:11px;overflow:hidden;text-overflow:ellipsis;' +
    'white-space:nowrap" title="' + escAttr(k) + '">' + esc(k) + '</div>' +
    '<div style="flex:1;background:#1b232b;border-radius:4px;height:12px">' +
    '<div style="height:12px;border-radius:4px;width:' + p + '%;background:' +
    (p >= 90 ? '#2e9e4f' : p >= 60 ? '#d29a2b' : '#c0392b') + '"></div></div>' +
    '<div style="width:175px;font-size:11px;text-align:right">' + esc(extra) + '</div></div>';
}

function cbAisla(setIds, rotulo) {
  // v1.134: calcado de tsAislar — el visor corre en modo fantasma y sin
  // setGhosting(false) el aislado se veia igual que el modelo entero.
  const per = models.map(() => []);
  for (const k of setIds) { const mi = decMi(k); if (per[mi]) per[mi].push(decId(k)); }
  let n = 0;
  try { viewer.setGhosting(false); } catch (e) {}
  models.forEach((m, mi) => {
    try {
      n += per[mi].length;
      if (per[mi].length) viewer.isolate(per[mi], m);
      else { const t = m.getInstanceTree(); if (t) viewer.hide(t.getRootId(), m); }
    } catch (e) {}
  });
  try { if (n) viewer.fitToView(); } catch (e) {}
  $('cbInfo').textContent = n
    ? 'Aislados ' + n.toLocaleString('es-PE') + ' elemento(s): ' + rotulo +
      ' - "Mostrar todo" lo deshace.'
    : 'Ningun elemento: ' + rotulo;
}

function cbTodo() {
  for (const mm of models || []) {
    if (!mm) continue;
    try {
      const t = mm.getInstanceTree && mm.getInstanceTree();
      viewer.isolate([], mm);
      if (t) viewer.show(t.getRootId(), mm);
    } catch (e) {}
  }
  try { viewer.setGhosting(true); } catch (e) {}   // el fantasma vuelve: es el modo de la casa
  $('cbInfo').textContent = '';
}

function cbTablero(F, rotulo) {
  CB.tabla = { cat: new Map(), tip: new Map() };
  const filasDe = (nombres, titulo, llaveTab) => {
    const cp = cbCanon(nombres);
    const mapa = cp && props.byParam.get(cp);
    if (!mapa) return '<div class="hint">(' + titulo + ' no esta en el indice)</div>';
    const filas = [];
    let cubre = 0;
    for (const [v, ids] of mapa) {
      if (!String(v).trim()) continue;
      let con = 0;
      for (const id of ids) if (F.has(id)) con++;
      filas.push({ k: String(v), n: ids.length, con: con, ids: ids });
      cubre += ids.length;
    }
    filas.sort((a, b) => b.n - a.n);
    for (const f of filas) CB.tabla[llaveTab].set(f.k, f);
    const aviso = cubre < (props.total || 1) * 0.5
      ? '<div class="hint" style="opacity:.7">"' + esc(cp) + '" solo cubre ' +
        cubre.toLocaleString('es-PE') + ' de ' + props.total.toLocaleString('es-PE') +
        ' elementos en este modelo.</div>'
      : '';
    return '<div class="hint" style="opacity:.7">parametro: ' + esc(cp) +
      ' - clic en una fila: aislar los de esa fila SIN dato del grupo</div>' + aviso +
      (filas.slice(0, 18).map(f => {
        const p = Math.round(1000 * f.con / f.n) / 10;
        return cbBarra(p, f.k,
          f.con.toLocaleString('es-PE') + ' de ' + f.n.toLocaleString('es-PE') +
          ' (' + p + '%)',
          'data-cbb="' + llaveTab + '" data-cbv="' + escAttr(f.k) + '"');
      }).join('') || '<div class="hint">(sin valores)</div>');
  };
  $('cbTableroZona').innerHTML =
    '<div class="hint" style="font-weight:600;margin-bottom:4px">% con algun parametro de ' +
    esc(rotulo) + ' lleno, por CATEGORIA</div>' +
    filasDe(['categoria', 'category'], 'Categoria', 'cat') +
    '<div class="hint" style="font-weight:600;margin:10px 0 4px">... y por TIPO</div>' +
    filasDe(['tipo', 'typename', 'nombredetipo', 'type'], 'Tipo', 'tip');
  $('cbTableroZona').querySelectorAll('[data-cbb]').forEach(el => el.onclick = () => {
    const ent = CB.tabla[el.getAttribute('data-cbb')].get(el.getAttribute('data-cbv'));
    if (!ent) return;
    const sin = new Set();
    for (const id of ent.ids) if (!CB.F.has(id)) sin.add(id);
    cbAisla(sin, '"' + el.getAttribute('data-cbv') + '" sin dato del grupo');
  });
}

function cbPintaGrupo(g) {
  const uni = cbUniverso();
  const total = uni.size || props.total || 1;
  const unionF = new Set();
  let h = '<div class="hint" style="font-weight:600;margin-bottom:4px">Grupo ' + esc(g.k) +
    ': llenado por parametro (clic: aislar los que NO lo tienen)</div>';
  for (const p of g.params) {
    const F = cbLlenos(props.byParam.get(p));
    for (const id of F) unionF.add(id);
    const pct = Math.round(1000 * F.size / total) / 10;
    h += cbBarra(pct, p,
      F.size.toLocaleString('es-PE') + ' de ' + total.toLocaleString('es-PE') +
      ' (' + pct + '%)',
      'data-cbp="' + escAttr(p) + '"');
  }
  CB.F = unionF;
  CB.total = total;
  $('cbParamsZona').innerHTML = h;
  $('cbParamsZona').querySelectorAll('[data-cbp]').forEach(el => el.onclick = () => {
    const p = el.getAttribute('data-cbp');
    const F = cbLlenos(props.byParam.get(p));
    const sin = new Set();
    for (const id of cbUniverso()) if (!F.has(id)) sin.add(id);
    cbAisla(sin, 'sin "' + p + '"');
  });
  cbTablero(unionF, g.k);
}

function cbAbre() {
  const limpia = () => {
    $('cbGruposZona').innerHTML = '';
    $('cbParamsZona').innerHTML = '';
    $('cbTableroZona').innerHTML = '';
  };
  if (!props || !props.total) {
    $('cbInfo').textContent = 'Este modulo lee el INDICE de Filtro Sectores: abre ese ' +
      'modulo y pulsa "Indexar TODO" primero (con eso ya elaborado, aqui no se cosecha nada).';
    limpia();
    return;
  }
  const grupos = cbGrupos(props.params);
  if (!grupos.length) {
    $('cbInfo').textContent = 'El indice trae ' + props.params.length +
      ' propiedades y ninguna es COBie ni Uniclass en este modelo.';
    limpia();
    return;
  }
  $('cbInfo').textContent = grupos.reduce((s, g) => s + g.params.length, 0) +
    ' parametro(s) COBie/Uniclass en ' + grupos.length + ' grupo(s), sobre ' +
    props.total.toLocaleString('es-PE') + ' elementos indexados.';
  if (!CB.grupo || !grupos.some(g => g.k === CB.grupo)) CB.grupo = grupos[0].k;
  $('cbGruposZona').innerHTML = grupos.map(g =>
    '<button class="sm" data-cbg="' + escAttr(g.k) + '"' +
    (CB.grupo === g.k ? ' style="background:#2f7fd1"' : '') + '>' +
    esc(g.k) + ' (' + g.params.length + ')</button>').join('') +
    ' <button class="sm" id="cbTodo">Mostrar todo</button>';
  $('cbGruposZona').querySelectorAll('[data-cbg]').forEach(b => b.onclick = () => {
    CB.grupo = b.getAttribute('data-cbg');
    cbAbre();
  });
  if ($('cbTodo')) $('cbTodo').onclick = cbTodo;
  cbPintaGrupo(grupos.find(g => g.k === CB.grupo));
}

/** v1.134: panel flotante que se ARRASTRA por su cabecera y se AGRANDA por
 * la esquina (resize nativo). Pedido con toda la razon. */
function panelMueble(idPanel) {
  const p = $(idPanel);
  if (!p) return;
  p.style.resize = 'both';
  p.style.overflow = 'auto';
  const asa = p.firstElementChild;
  if (!asa) return;
  asa.style.cursor = 'move';
  let ax = 0, ay = 0, px = 0, py = 0, va = false;
  asa.addEventListener('pointerdown', (e) => {
    if (e.target.closest('span,button,input')) return;   // la X y controles mandan
    va = true; ax = e.clientX; ay = e.clientY;
    const r = p.getBoundingClientRect();
    px = r.left; py = r.top;
    p.style.right = 'auto'; p.style.left = px + 'px'; p.style.top = py + 'px';
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!va) return;
    p.style.left = (px + e.clientX - ax) + 'px';
    p.style.top = (py + e.clientY - ay) + 'px';
  });
  window.addEventListener('pointerup', () => { va = false; });
}
panelMueble('cbPanel');
panelMueble('mbPanel');
panelMueble('nrPanel');

if ($('cbCerrar')) $('cbCerrar').onclick = () => {
  try { activaModulo('cobie'); }
  catch (e) { $('cbPanel').classList.add('hidden'); }
};