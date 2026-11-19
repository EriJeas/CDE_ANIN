/* MODELOS DE FORMA EN EL VISOR DEL CDE (portal). Un NWD traido de Forma se ve en el visor del CDE con la traduccion que Autodesk
 * ya tiene del archivo. El trabajo lo hace forma-paso.html (pagina propia, incrustada aqui a la izquierda: se ve el modelo mientras
 * se lee); esta ventana muestra los pasos y permite pasar varios modelos seguidos. Ventana movible y redimensionable.
 * N.formaAlVisor(p, [vid...], luego). El visor del CDE usa la misma pagina al abrir un NWD de Forma (visor.js). */
(function () {
  const N = CDE.N, { esc, api } = N;
  const F = (pid) => '/api/proyectos/' + pid + '/forma';
  const PASOS = [['prep', 'Preparar'], ['abrir', 'Abrir la traducción de Autodesk'], ['geo', 'Traer la geometría'], ['mallas', 'Revisar las piezas'], ['indice', 'Índice de parámetros (en el servidor)'], ['armar', 'Aligerar y armar la geometría del CDE'], ['subir', 'Guardar en el CDE']];
  /** Corre forma-paso.html para una version en el contenedor dado. alPaso({k,e,t,p,archivo}); devuelve { ok, error, ... }. */
  N.formaPaso = function (pid, vid, contenedor, alPaso) {
    let ifr = null, oye = null;
    const promesa = new Promise((ok) => {
      oye = (ev) => {
        const m = ev.data; if (ev.origin !== location.origin || !m || !m.cdePaso || m.vid !== vid) return;
        if (m.fin) { window.removeEventListener('message', oye); ok(m); } else if (alPaso) alPaso(m);
      };
      window.addEventListener('message', oye);
      contenedor.innerHTML = ''; ifr = document.createElement('iframe'); ifr.title = 'Visor de Autodesk (preparando el modelo)';
      ifr.style.cssText = 'border:0;width:100%;height:100%;display:block'; ifr.src = 'forma-paso.html?pid=' + encodeURIComponent(pid) + '&vid=' + encodeURIComponent(vid);
      contenedor.appendChild(ifr);
    });
    return { promesa, parar: () => { try { ifr.contentWindow.postMessage({ cdeParar: true }, location.origin); } catch (e) {} }, quita: () => { if (oye) window.removeEventListener('message', oye); if (ifr) ifr.remove(); } };
  };
  N.formaPasos = PASOS;

  N.formaAlVisor = async function (p, vids, luego) {
    vids = [...new Set(vids || [])]; if (!vids.length) return;
    const pid = p.id; let parar = false, actual = null; const cola = vids.map((vid) => ({ vid, estado: 'espera', nombre: vid, pasos: {} }));
    let vidActual = '';
    const cancela = () => { if (parar) return; parar = true; if (actual) actual.parar(); if (vidActual) api(F(pid) + '/modelos/' + vidActual + '/cancelar', { json: {} }).catch(() => {}); };
    const v = N.ventana('Ver en el visor del CDE · modelos de Forma', '<div class="fvx"><div class="fvlmv" id="fvLmv"></div><div class="fvpasos"><div id="fvCola"></div><div id="fvMsg"></div>' +
      '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:10px"><button id="fvParar">Cancelar</button><button class="primario oculto" id="fvAbrir">Abrir en el visor del CDE</button></div></div></div>', { ancho: 1000, alto: 600, alCerrar: () => { cancela(); if (actual) actual.quita(); } });
    const g = (i) => v.querySelector('#' + i);
    const pinta = () => {
      g('fvCola').innerHTML = cola.map((c) => '<div class="fvmod ' + c.estado + '"><b class="mono">' + esc(c.nombre) + '</b>' + (c.estado === 'listo' ? ' <a href="visor.html?pid=' + encodeURIComponent(pid) + '&vid=' + encodeURIComponent(c.vid) + '" target="_blank" rel="noopener">Abrir en el visor</a>' : '') +
        (c.estado === 'trabajando' || c.estado === 'listo' || c.estado === 'error' ? '<div class="fvlista">' + PASOS.map(([k, t]) => { const s = c.pasos[k] || {}; return '<div class="fvpaso ' + (s.e || '') + '"><i>' + (s.e === 'ok' ? '✓' : s.e === 'mal' ? '✗' : s.e === 'va' ? '…' : '·') + '</i><span>' + t + (s.t ? ' <span class="pista">' + esc(s.t) + '</span>' : '') + '</span>' + (s.e === 'va' && typeof s.p === 'number' ? '<div class="fcbar"><i style="width:' + Math.round(s.p * 100) + '%"></i></div>' : '') + '</div>'; }).join('') + '</div>' : '') +
        (c.error ? '<div class="fcpend">' + esc(c.error) + '</div>' : '') + '</div>').join('');
    };
    g('fvParar').onclick = () => { g('fvParar').disabled = true; cancela(); };
    pinta();
    for (const c of cola) {
      if (parar) break;
      c.estado = 'trabajando'; vidActual = c.vid; pinta();
      actual = N.formaPaso(pid, c.vid, g('fvLmv'), (m) => { if (m.archivo) c.nombre = m.archivo; if (m.k) c.pasos[m.k] = { e: m.e, t: m.t, p: m.p }; pinta(); });
      const r = await actual.promesa; vidActual = '';
      if (r.ok) c.estado = 'listo';
      else { c.estado = 'error'; c.error = r.error; for (const k of Object.keys(c.pasos)) if (c.pasos[k].e === 'va') c.pasos[k].e = 'mal'; }
      pinta();
    }
    const listos = cola.filter((c) => c.estado === 'listo');
    g('fvMsg').innerHTML = '<div class="aviso ' + (listos.length === cola.length ? 'verde' : listos.length ? '' : 'rojo') + '" style="margin-top:8px">' + listos.length + ' de ' + cola.length + ' modelo(s) en el visor del CDE.' + (listos.length ? ' Ya no dependen de Forma: quedan guardados en el CDE.' : '') + '</div>';
    g('fvParar').textContent = 'Cerrar'; g('fvParar').disabled = false; g('fvParar').onclick = () => { const w = v.closest('.ventana'); if (actual) actual.quita(); if (w) w.remove(); };
    if (listos.length) { const b = g('fvAbrir'); b.classList.remove('oculto'); b.onclick = () => window.open('visor.html?pid=' + encodeURIComponent(pid) + '&vid=' + encodeURIComponent(listos[0].vid), '_blank'); }
    if (luego) luego();
  };
  /** Lista de modelos de un enlace (o del proyecto) con su estado en el visor. */
  N.formaModelos = async function (p, eid) { return api(F(p.id) + '/modelos' + (eid ? '?enlace=' + encodeURIComponent(eid) : '')); };
})();
