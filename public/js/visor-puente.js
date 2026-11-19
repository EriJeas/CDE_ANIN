/*
 * PUENTE entre el visor del CDE (visor.js, geometria propia .cdeg) y los modulos del Visor BIM Federado que se cargan
 * TAL CUAL desde public/js/visor-origen/ (copias literales de su app.js / modelos-planos.js / ventanas.js).
 *
 * Regla (Erick): no reimplementar; reutilizar la logica del visor. Por eso aqui no hay logica de negocio: solo lo que esos
 * archivos esperan de SU visor y que el visor del CDE da de otra forma:
 *   props     el indice en memoria (params, byParam: parametro -> valor -> [elementos], total), como modelos-local.js /
 *             exporta-indice.js; sale de GET /api/modelos/:pid/:vid/props (tablas attr/val/eav del indice SQLite del visor).
 *   filters   los filtros en la forma del visor ({ param, values: [{ value, ids, color }], selected: Set, tl, tActivo... }),
 *             reflejo de los FILTROS del visor del CDE (misma seleccion; las barras de fecha viven en el reflejo).
 *   viewer    isolate / hide / show / select / fitToView / setThemingColor / clearThemingColors / setGhosting sobre el .cdeg.
 *   models, decMi/decId/encId: un solo modelo; la clave del elemento ES su id (e).
 *   $, esc, escAttr, recorta, nombreCorto, cssHex, hexRgb, CANON_PREFIX, modulosOn, activaModulo, applyView, renderFilters,
 *   refrescaDock, guardaSesion, hideModel, leeSeleccionInv, filtroO.
 *   Modelos/Planos: IDX (indice de planos: GET /api/proyectos/:pid/planos-indice), nav, busIndiceCarga, busRehaceIndice,
 *   planos, anadePlano, abrirPlano (abre el PDF junto al modelo en una ventana del CDE) y hazFlotante (ventanas.js, tal cual).
 * Los modulos portados se registran en el carril: sectores (Filtro con sectores), mbim (Tablero metricas BIM), cobie
 * (COBie / Uniclass) y modplanos (Modelos / Planos). Ver docs/VISOR-PORTADO.md.
 */
(function () {
  'use strict';
  const CANON = '● ';
  // ---------- globales que esperan los archivos de origen ----------
  window.CANON_PREFIX = CANON;
  window.$ = (id) => document.getElementById(id);
  window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.escAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  window.recorta = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  window.nombreCorto = (p) => String(p || '').startsWith(CANON) ? '● ' + String(p).slice(CANON.length) : String(p || '');
  window.hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  window.cssHex = (c) => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  window.filtroO = false;
  window.modulosOn = new Set();
  window.props = { total: 0, params: [], byParam: new Map() };
  window.filters = [];
  window.models = [{ getInstanceTree: () => ({ getRootId: () => -1 }), id: 1 }];
  window.decMi = () => 0;
  window.decId = (k) => k;
  window.encId = (mi, id) => id;
  window.guardaSesion = () => {};
  window.refrescaDock = () => {};
  window.leeSeleccionInv = () => { const V = window.V; return V && V.SEL ? [V.SEL.e] : []; };
  window.nav = { project: '' };
  window.planos = [];
  window.IDX = null;

  const ESPERA = setInterval(() => { if (window.V && window.V.PID !== undefined) { clearInterval(ESPERA); arranca(window.V); } }, 60);

  function arranca(V) {
    const { api, esc: escV, num } = V;
    window.nav.project = V.PID; window.THREE = V.THREE;
    const PUENTE = { cargando: null, vid: '', tintesBarra: new Map(), rafTinte: 0 };
    window.PUENTE = PUENTE;

    // ---------- props: el indice entero, como el IV del visor ----------
    async function cargaProps() {
      if (!V.VID) return;
      if (PUENTE.vid === V.VID && props.total) return;
      if (PUENTE.cargando && PUENTE.vid === V.VID) return PUENTE.cargando;
      PUENTE.vid = V.VID;
      PUENTE.cargando = (async () => {
        const d = await api('/api/modelos/' + V.PID + '/' + V.VID + '/props');
        const by = new Map();
        for (const [ip, lista] of d.byParam) { const m = new Map(); for (const [iv, es] of lista) m.set(d.vals[iv], es); by.set(d.params[ip], m); }
        window.props = { total: d.total, params: d.params.slice(), byParam: by, omitidos: d.omitidos || [] };
        PUENTE.cargando = null;
        return window.props;
      })();
      return PUENTE.cargando;
    }
    V.alCargarModelo.push(() => { window.props = { total: 0, params: [], byParam: new Map() }; PUENTE.vid = ''; window.filters.length = 0; ESPEJO.clear(); if (modulosOn.size) cargaProps().then(() => refrescaModulos()); });

    // ---------- viewer: lo que usan los modulos sobre el .cdeg ----------
    const lin = (x) => V.srgbLin(x);
    const pintaTintes = () => { if (PUENTE.rafTinte) return; PUENTE.rafTinte = requestAnimationFrame(() => { PUENTE.rafTinte = 0; V.aplicaTintes(); }); };
    window.viewer = {
      setGhosting: () => {},
      isolate: (ids) => { const L = ids ? [...ids] : []; V.muestraSolo(L.length ? new Set(L) : null, false); },   // isolate([]) en el visor = ver todo
      hide: () => { V.muestraSolo(new Set(), false); },
      show: () => {},
      select: (ids) => { for (const [e] of PUENTE.sel) V.TINTES.delete(e); PUENTE.sel = new Map(); for (const e of ids || []) { PUENTE.sel.set(e, 1); V.TINTES.set(e, V.COLOR_SEL); } pintaTintes(); },
      getSelection: () => [...PUENTE.sel.keys()],
      fitToView: (ids) => { if (ids && ids.length) V.encuadra(V.cajaDe(ids)); else V.encuadra(V.VIS ? V.cajaDe(V.VIS) : undefined); },
      clearThemingColors: () => { for (const e of PUENTE.tintesBarra.keys()) V.TINTES.delete(e); PUENTE.tintesBarra = new Map(); pintaTintes(); },
      setThemingColor: (id, vec) => { const rgb = [lin(vec.x), lin(vec.y), lin(vec.z)]; PUENTE.tintesBarra.set(id, rgb); V.TINTES.set(id, rgb); pintaTintes(); },
      getVisibleModels: () => window.models,
      impl: { modelQueue: () => ({ getModels: () => window.models }) }
    };
    PUENTE.sel = new Map();
    window.hideModel = () => viewer.hide();
    window.applyView = () => V.recalcula(false);
    window.renderFilters = () => V.pintaFiltros();
    window.activaModulo = (m) => V.abreModulo(m);

    // ---------- filters: reflejo de los FILTROS del CDE en la forma del visor ----------
    const ESPEJO = new Map();   // id del filtro del CDE -> objeto en la forma del visor (conserva tl / tActivo entre repintados)
    const PALETA_RGB = (i) => (typeof colorFor === 'function' ? colorFor(i) : [200, 162, 74]);
    function valoresDe(f) {
      if (f.tipo === 'grupo') return (f.lista || []).map((x, i) => ({ value: x.value, ids: x.ids, color: x.color || PALETA_RGB(i) }));
      const nombre = f.tipo === 'dim' ? CANON + ({ modelo: 'Modelo', cat: 'Categoria', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' })[f.dim] : f.param.nombre;
      const m = props.byParam.get(nombre); if (!m) return [];
      let i = 0; return [...m.entries()].map(([v, ids]) => ({ value: v, ids, color: PALETA_RGB(i++) }));
    }
    function sincronizaFiltros() {
      const vivos = new Set();
      window.filters.length = 0;
      for (const f of V.FILTROS) {
        vivos.add(f.id);
        let e = ESPEJO.get(f.id);
        const nombre = f.tipo === 'grupo' ? f.param : f.tipo === 'dim' ? CANON + ({ modelo: 'Modelo', cat: 'Categoria', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' })[f.dim] : f.param.nombre;
        if (!e) { e = { param: nombre, values: [], selected: new Set(), cde: f }; ESPEJO.set(f.id, e); }
        if (!e.values.length || e.values.length !== (f.tipo === 'grupo' ? (f.lista || []).length : (props.byParam.get(nombre) || new Map()).size)) { e.values = valoresDe(f); if (typeof ordenaValoresFiltro === 'function' && e.values.length) ordenaValoresFiltro(e); }
        e.selected = new Set([...f.valores]);
        window.filters.push(e);
      }
      for (const k of [...ESPEJO.keys()]) if (!vivos.has(k)) ESPEJO.delete(k);
    }
    // tras cada repintado de filtros: reflejo + barras de fecha (montaTimeline del visor) + barra de sectores
    V.alPintarFiltros.push((cont) => {
      if (!props.total) return;
      sincronizaFiltros();
      for (const e of window.filters) { const card = cont.querySelector('.filtro[data-f="' + e.cde.id + '"]'); if (card && typeof montaTimeline === 'function') { try { montaTimeline(e, card); } catch (x) { console.warn(x); } } }
      if (modulosOn.has('sectores')) pintaSecBar();
    });
    V.alRecalcular.push(() => { if (!props.total) return; sincronizaFiltros(); if (window.filters.some(f => f.tl && f.tActivo != null && f.tOn !== false) && typeof aplicaTiempos === 'function') { try { aplicaTiempos(); } catch (x) { console.warn(x); } } });

    // ---------- Filtro con sectores: la barra Sector / Zona / Partida / Bloque (GRUPOS_VIRT del visor) ----------
    function secBarHtml() {
      return '<div class="panel" id="secBar"><div class="row">' + (typeof GRUPOS_VIRT !== 'undefined' ? GRUPOS_VIRT : []).map(g => '<button id="btnSec' + g.id.charAt(0).toUpperCase() + g.id.slice(1) + '" class="sm secbtn" data-g="' + g.id + '">' + esc(g.etiqueta) + '</button>').join('') + '</div><div class="hint" id="secInfo"></div></div>';
    }
    function pintaSecBar() {
      const lista = $('filtrosLista'); if (!lista) return;
      let bar = $('secBar');
      if (!bar) { lista.insertAdjacentHTML('beforebegin', secBarHtml()); bar = $('secBar'); bar.querySelectorAll('button[data-g]').forEach(b => b.onclick = () => alternaGrupo(b.dataset.g)); }
      const t = $('ptitulo'); if (t) t.textContent = 'Filtro Sectores';
      if (typeof pintaBarraSectores === 'function') { try { pintaBarraSectores(); } catch (x) { console.warn(x); } }
    }
    async function alternaGrupo(gid) {
      const g = (typeof GRUPOS_VIRT !== 'undefined' ? GRUPOS_VIRT : []).find(x => x.id === gid); if (!g) return;
      const ya = V.FILTROS.find(f => f.tipo === 'grupo' && f.param === g.clave);
      if (ya) { V.quitaFiltro(ya); return; }
      const vals = valoresDeGrupo(g);
      if (!vals.length) { alert('Ningun parametro de este modelo contiene "' + g.etiqueta + '".'); return; }
      const f = await V.anadeFiltro({ tipo: 'grupo', param: g.clave, titulo: VIRT_PREFIX + g.etiqueta + ' (todos los parametros)', grupo: g.id, lista: vals });
      const e = ESPEJO.get(f.id); if (e && typeof ordenaValoresFiltro === 'function') { ordenaValoresFiltro(e); f.lista = e.values; V.pintaFiltros(); }
    }
    function quitaSecBar() { const b = $('secBar'); if (b) b.remove(); const t = $('ptitulo'); if (t && V.MODULO === 'filtros') t.textContent = 'Filtros'; }

    // ---------- registro de los modulos en el carril del CDE ----------
    const M = V.MODULOS;
    const conProps = (fn) => async () => { if (!V.VID) { V.panel('Sin modelo', '<p class="pista">Elige un modelo arriba.</p>'); return; } await cargaProps(); fn(); };
    M.sectores = conProps(() => {
      modulosOn.add('sectores');
      M.filtros();                                    // el MISMO panel de filtros (como en el visor) ...
      document.querySelectorAll('.carril .mod').forEach(x => x.classList.toggle('activo', x.dataset.m === 'sectores'));
      pintaSecBar();                                  // ... mas la barra de acceso directo a Sector / Zona / Partida / Bloque
      if (window.filters.some(f => f.tl && f.tActivo != null) && typeof aplicaTiempos === 'function') aplicaTiempos();
    });
    V.alAbrirFiltros.push(() => { if (V.MODULO === 'filtros') { modulosOn.delete('sectores'); quitaSecBar(); try { const w = $('tsWin'); if (w) w.classList.add('hidden'); } catch (e) {} } });
    M.mbim = conProps(() => { modulosOn.add('mbim'); $('mbPanel').classList.remove('hidden'); if (typeof mbAbre === 'function') mbAbre(); });
    M.cobie = conProps(() => { modulosOn.add('cobie'); $('cbPanel').classList.remove('hidden'); if (typeof cbAbre === 'function') cbAbre(); });
    M.modplanos = conProps(() => { modulosOn.add('modplanos'); if (typeof mpAlterna === 'function') mpAlterna(true, { sinFiltros: true }); });
    // activaModulo(m) del visor cierra el panel al pulsar la X: aqui apaga el modulo y oculta su panel
    window.activaModulo = (m) => {
      if (m === 'mbim') { modulosOn.delete('mbim'); $('mbPanel').classList.add('hidden'); return; }
      if (m === 'cobie') { modulosOn.delete('cobie'); $('cbPanel').classList.add('hidden'); return; }
      if (m === 'filtros') { V.abreModulo('filtros'); return; }
      V.abreModulo(m);
    };
    function refrescaModulos() { if (modulosOn.has('mbim') && typeof mbAbre === 'function') mbAbre(); if (modulosOn.has('cobie') && typeof cbAbre === 'function') cbAbre(); }

    // ---------- cantidades (area / longitud / volumen) para la tabla de sectores: del indice del CDE, por lotes ----------
    window.pideCantidades = (claves, cuandoAcabe) => {
      if (PUENTE.pidiendo) return;
      const faltan = []; for (const k of claves) if (!cacheCant.has(k)) { faltan.push(k); if (faltan.length >= 40000) break; }
      if (!faltan.length) return;
      PUENTE.pidiendo = true;
      api('/api/modelos/' + V.PID + '/' + V.VID + '/cantidades', { json: { e: faltan } }).then(r => {
        let alguno = false;
        for (const k of faltan) { const c = r.cantidades[k]; cacheCant.set(k, c ? { area: c.area || 0, largo: c.largo || 0, vol: c.vol || 0 } : null); if (c) alguno = true; }
        PUENTE.pidiendo = false; if (alguno && cuandoAcabe) { try { cuandoAcabe(); } catch (e) {} }
      }).catch(() => { for (const k of faltan) cacheCant.set(k, null); PUENTE.pidiendo = false; });
    };

    // ---------- Modelos / Planos: indice de planos del CDE y apertura del PDF junto al modelo ----------
    window.busIndiceCarga = async () => { const d = await api('/api/proyectos/' + V.PID + '/planos-indice'); window.IDX = Object.assign(d, { project: V.PID }); return window.IDX; };
    window.busRehaceIndice = window.busIndiceCarga;
    window.anadePlano = (f, ruta) => { if (!window.planos.some(p => p.item === f.id)) window.planos.push({ item: f.id, name: f.name, desc: f.desc || '', ruta: ruta || '' }); };
    window.abrirPlano = async (p) => abrePdf(p);
    async function abrePdf(p) {
      if (PUENTE.pdfWin && document.body.contains(PUENTE.pdfWin)) PUENTE.pdfWin.closest('.ventana').remove();
      const w = V.ventana('Plano · ' + escV(p.name), '<div class="planos" style="display:flex;flex-direction:column;height:100%"><div class="filab" style="margin:0;align-items:center;gap:6px"><button class="mini" id="pdPrev">‹</button><span class="pista" id="pdPag">…</span><button class="mini" id="pdNext">›</button><button class="mini" id="pdMenos">－</button><button class="mini" id="pdMas">＋</button><span class="pista" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escV(p.desc || '') + '</span><a class="mini boton" href="/api/proyectos/' + V.PID + '/versiones/' + p.item + '/descargar" title="Descargar el PDF">⤓</a></div><div id="pdHoja" style="flex:1;overflow:auto;background:#1b1812;cursor:grab;position:relative"><canvas id="pdCv"></canvas></div></div>', { ancho: Math.min(760, innerWidth * 0.48), alto: Math.min(680, innerHeight - 80), x: innerWidth - Math.min(760, innerWidth * 0.48) - 20, y: 60 });
      PUENTE.pdfWin = w;
      let doc = null, pag = 1, escala = 1;
      const pinta = async () => {
        try {
          if (!doc) { if (!window.pdfjsLib) throw new Error('pdf.js no cargó.'); pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; const r = await fetch('/api/proyectos/' + V.PID + '/versiones/' + p.item + '/descargar'); if (!r.ok) throw new Error('No se pudo bajar el PDF (' + r.status + ')'); doc = await pdfjsLib.getDocument({ data: await r.arrayBuffer() }).promise; }
          const page = await doc.getPage(pag), hoja = w.querySelector('#pdHoja'), vp0 = page.getViewport({ scale: 1 }), s = (Math.max(300, hoja.clientWidth - 16) / vp0.width) * escala, vp = page.getViewport({ scale: s }), cv = w.querySelector('#pdCv');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height); await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          w.querySelector('#pdPag').textContent = 'Página ' + pag + ' de ' + doc.numPages;
        } catch (e) { w.querySelector('#pdHoja').innerHTML = '<div class="aviso rojo">' + escV(e.message) + '</div>'; }
      };
      w.querySelector('#pdPrev').onclick = () => { if (pag > 1) { pag--; pinta(); } }; w.querySelector('#pdNext').onclick = () => { if (doc && pag < doc.numPages) { pag++; pinta(); } };
      w.querySelector('#pdMas').onclick = () => { escala = Math.min(5, escala * 1.25); pinta(); }; w.querySelector('#pdMenos').onclick = () => { escala = Math.max(0.3, escala / 1.25); pinta(); };
      const hoja = w.querySelector('#pdHoja'); let arr = null;
      hoja.onmousedown = (e) => { arr = { x: e.clientX, y: e.clientY, l: hoja.scrollLeft, t: hoja.scrollTop }; hoja.style.cursor = 'grabbing'; };
      window.addEventListener('mousemove', (e) => { if (!arr) return; hoja.scrollLeft = arr.l - (e.clientX - arr.x); hoja.scrollTop = arr.t - (e.clientY - arr.y); });
      window.addEventListener('mouseup', () => { arr = null; hoja.style.cursor = 'grab'; });
      hoja.onwheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); escala = Math.max(0.3, Math.min(5, escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); pinta(); };
      pinta();
    }

    // ventana "Sectores por fecha": la de origen (tsWin) se mueve por su cabecera y se agranda por la esquina (hazFlotante, de ventanas.js)
    try { const w = $('tsWin'); if (w && typeof hazFlotante === 'function') { w.querySelector('.fbar').setAttribute('data-arrastre', '1'); hazFlotante(w); } } catch (e) {}
    try { const nombres = { sectores: 'Filtro con sectores', mbim: 'Tablero (métricas BIM)', cobie: 'COBie / Uniclass', modplanos: 'Modelos / Planos' }; console.info('visor-puente: modulos del Visor BIM Federado listos:', Object.keys(nombres).join(', ')); } catch (e) {}
  }
})();
