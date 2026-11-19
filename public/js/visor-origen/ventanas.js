/* ============================================================================
 * v1.299 — VENTANAS FLOTANTES QUE SE MUEVEN Y SE AGRANDAN.
 * Toda ventana flotante nueva del visor (Verificacion LOD, Operacion y
 * mantenimiento, valores del Llenado...) se arrastra desde su barra de titulo
 * (lo marcado con data-arrastre) y se agranda o achica desde su esquina
 * inferior derecha. Su posicion y su tamano se recuerdan en este navegador.
 * ========================================================================== */
function hazFlotante(el) {
  if (!el || el.dataset.flotante) return;
  el.dataset.flotante = '1';
  Object.assign(el.style, { resize: 'both', minWidth: '280px', minHeight: '140px', maxWidth: '98vw', maxHeight: '96vh' });
  const clave = 'vbim.ventana.' + (el.id || 'sin-id');
  try {
    const g = JSON.parse(localStorage.getItem(clave) || 'null');
    if (g && isFinite(g.x) && isFinite(g.y)) {
      Object.assign(el.style, { left: Math.max(0, Math.min(innerWidth - 80, g.x)) + 'px', top: Math.max(0, Math.min(innerHeight - 40, g.y)) + 'px', right: 'auto', transform: 'none' });
      if (g.w) el.style.width = g.w + 'px';
      if (g.h) el.style.height = g.h + 'px';
    }
  } catch (e) {}
  // Solo se guarda el tamano que el usuario eligio (el tirador de la esquina pone width/height en linea).
  const guarda = () => {
    try {
      const r = el.getBoundingClientRect();
      localStorage.setItem(clave, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top),
        w: el.style.width ? Math.round(r.width) : null, h: el.style.height ? Math.round(r.height) : null }));
    } catch (e) {}
  };
  el.addEventListener('pointerdown', (e) => {
    const h = e.target.closest && e.target.closest('[data-arrastre]');
    if (!h || !el.contains(h) || e.target.closest('button,select,input,a,textarea,label,option')) return;
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', right: 'auto', transform: 'none' });
    const mueve = (ev) => {
      el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px';
    };
    const suelta = () => { removeEventListener('pointermove', mueve); removeEventListener('pointerup', suelta); guarda(); };
    addEventListener('pointermove', mueve);
    addEventListener('pointerup', suelta);
    e.preventDefault();
  });
  try { new ResizeObserver(() => { clearTimeout(el._vt); el._vt = setTimeout(guarda, 400); }).observe(el); } catch (e) {}
}

(function () {
  const css = document.createElement('style');
  css.textContent = '[data-arrastre]{cursor:move;user-select:none}[data-arrastre] button,[data-arrastre] select,[data-arrastre] input,[data-arrastre] a{cursor:pointer}' +
    '.vt-asa{color:#6f8796;margin-right:6px;letter-spacing:-2px}';
  (document.head || document.documentElement).appendChild(css);
  // v1.308: tambien el Llenado de parametros (su barra de titulo ya decia "arrastra", pero no se movia)
  const engancha = () => ['lodPanel', 'mtPanel', 'llPanel'].forEach(id => { try { hazFlotante(document.getElementById(id)); } catch (e) {} });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', engancha); else engancha();
})();
