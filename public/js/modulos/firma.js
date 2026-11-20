/* FIRMA DIGITAL (v0.25.0): ventana para firmar un PDF que pasó la Validación QA y aún no lleva la firma de quien lo elaboró.
 *   1) «Firmar con ReFirma»: el CDE llama a ReFirma Invoker de RENIEC (script oficial); ReFirma descarga el PDF del CDE, la persona
 *      firma con su DNIe o certificado y ReFirma lo devuelve firmado. Cada paso queda en el «Registro de la llamada», para ver
 *      exactamente dónde se detiene.
 *   2) Ruta manual: descargar el PDF, firmarlo en ReFirma PDF (u otro firmador) y subir el archivo firmado.
 * En ambos casos el CDE verifica la firma (íntegra, vigente, de quien dice «ELAB. POR») y recién entonces deja continuar.
 * Uso: N.firmaDlg(token, { alFirmar(blob, estado), titulo }) */
(function () {
  const N = CDE.N, { esc, api, ventana } = N;
  const QUIEN = { navegador: 'Navegador', servidor: 'CDE', refirma: 'ReFirma' };
  const hora = (t) => { try { return new Date(t).toLocaleTimeString('es-PE', { hour12: false }); } catch (e) { return ''; } };

  N.firmaDlg = async (token, o) => {
    o = o || {}; let P, E;
    try { [P, E] = await Promise.all([api('/api/firma/pend/' + token), api('/api/firma/estado')]); } catch (e) { N.toast(esc(e.message), 'mal'); return; }
    const v = ventana('Firma digital · ' + P.nombre, '<div class="fd">' +
      '<div class="aviso azul">Este PDF pasó la Validación QA. ' + (o.opcional ? 'En este proyecto la firma digital es <b>opcional</b>: si lo firmas, el PDF firmado se guarda como <b>versión firmada</b> (misma revisión). Debe firmarlo' : 'Para entrar al compartido debe llevar la <b>firma digital de quien lo elaboró</b>:') + ' <b>' + esc(P.elabPor || '— (la portada no dice quién elaboró)') + '</b> (columna «ELAB. POR» del cuadro de revisiones).</div>' +
      '<div class="fd-cols"><div class="fd-op"><h4>1 · Firmar con ReFirma (desde el CDE)</h4><p class="pista">El CDE abre ReFirma en esta PC, ReFirma descarga el PDF, firmas con tu DNIe o certificado y vuelve firmado solo.</p>' +
        '<div class="fila" style="gap:6px;align-items:center"><button class="primario" id="fdRf">Firmar con ReFirma</button><select id="fdModo" title="Cómo se abre ReFirma en esta PC"><option value="clickonce">ClickOnce (Edge / Chrome en Windows)</option><option value="java">Java Web Start</option></select></div>' +
        '<div class="fd-cred ' + (E.credenciales ? 'ok' : 'mal') + '">' + (E.credenciales ? '✓ Credenciales de RENIEC configuradas en el servidor.' : '⚠ El servidor no tiene las credenciales de RENIEC (REFIRMA_CLIENT_ID / REFIRMA_CLIENT_SECRET): la llamada se hace igual, en modo diagnóstico, para ver hasta dónde llega.') + '</div></div>' +
        '<div class="fd-op"><h4>2 · Firmar por tu cuenta y subir el PDF firmado</h4><ol class="fd-pasos"><li><a class="boton" id="fdBaja" href="/api/firma/pend/' + esc(token) + '/original">Descargar el PDF</a></li><li>Ábrelo en <b>ReFirma PDF</b> (u otro firmador) y fírmalo.</li><li><button id="fdSube">Subir el PDF firmado</button> <span class="pista">(p. ej. «…[R].pdf»)</span></li></ol><input type="file" id="fdIn" accept=".pdf,application/pdf" class="oculto"></div></div>' +
      '<div id="fdRes"></div>' +
      '<details class="fd-reg" open><summary>Registro de la llamada <span class="pista" id="fdEst"></span></summary><div class="fd-log" id="fdLog"></div></details>' +
      '<details class="fd-raices"><summary>Entidades de certificación de confianza (' + E.raices.length + ')</summary><div id="fdRaices"></div></details>' +
      '<div class="pie"><span class="crece"></span><button id="fdCerrar">Cerrar</button><button class="primario" id="fdOk" disabled>Continuar con el PDF firmado</button></div></div>',
      { ancho: Math.min(900, innerWidth - 40), alto: Math.min(760, innerHeight - 40), alCerrar: () => { vivo = false; quita(); } });
    const win = v.closest('.ventana'), $ = (s) => v.querySelector(s); let vivo = true, espera = null, args = null, oyentes = [];
    const quita = () => { oyentes.forEach(([e, f]) => window.removeEventListener(e, f)); oyentes = []; clearTimeout(espera); };
    const oye = (e, f) => { window.addEventListener(e, f); oyentes.push([e, f]); };
    const anota = (ev, detalle) => api('/api/firma/pend/' + token + '/evento', { json: { ev, detalle } }).catch(() => {}).then(refresca);
    const pintaRaices = () => { $('#fdRaices').innerHTML = (E.raices.length ? '<table class="chica"><tbody>' + E.raices.map(r => '<tr><td><b>' + esc(r.nombre) + '</b><div class="pista">' + esc(r.organizacion) + ' · vence ' + esc(r.hasta.slice(0, 10)) + '</div></td><td class="mono pista" style="word-break:break-all">' + esc(r.huella.slice(0, 47)) + '…</td>' + (E.admin ? '<td><button class="mini" data-qr="' + esc(r.huella) + '">Quitar</button></td>' : '') + '</tr>').join('') + '</tbody></table>' : '<p class="pista">Aún no hay ninguna: el CDE comprueba que la firma sea válida y de quién es, pero <b>no</b> que el certificado venga de una entidad reconocida (RENIEC, Llama.pe…). Carga sus certificados raíz para que también se compruebe.</p>') +
        (E.admin ? '<button class="mini" id="fdRaizMas">Cargar certificado raíz (.cer / .crt / .pem)</button><input type="file" id="fdRaizIn" accept=".cer,.crt,.pem,.der" class="oculto">' : '<p class="pista">Las carga el administrador del CDE.</p>');
      const mas = $('#fdRaizMas'); if (mas) { mas.onclick = () => $('#fdRaizIn').click(); $('#fdRaizIn').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const r = await fetch('/api/firma/raices', { method: 'POST', body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) return N.toast(esc(j.mensaje || 'No se pudo cargar'), 'mal'); N.toast('Entidad de confianza cargada', 'ok'); E = await api('/api/firma/estado'); pintaRaices(); }; }
      v.querySelectorAll('[data-qr]').forEach(b => b.onclick = async () => { await api('/api/firma/raices/' + encodeURIComponent(b.dataset.qr.replace(/:/g, '')), { method: 'DELETE' }).catch(e => N.toast(esc(e.message), 'mal')); E = await api('/api/firma/estado'); pintaRaices(); });
    };
    const pinta = () => {
      $('#fdLog').innerHTML = P.eventos.map(e => '<div class="fd-ev ' + esc(e.de) + (/(error|rechaz|sin-respuesta|cancel)/i.test(e.ev) ? ' mal' : /firmado|invokerOk/.test(e.ev) ? ' ok' : '') + '"><span class="mono">' + hora(e.t) + '</span><b>' + esc(QUIEN[e.de] || e.de) + '</b><span>' + esc(e.detalle || e.ev) + '</span></div>').join('');
      $('#fdLog').scrollTop = 1e6; $('#fdEst').textContent = '· ' + ({ pendiente: 'esperando la firma', firmado: 'firmado y verificado', rechazado: 'el PDF que llegó no sirve' })[P.estado];
      const lista = (P.checks || []).map(c => '<div class="fa-h ' + (c.ok ? (c.aviso ? 'aviso' : 'ok') : 'mal') + '"><i>' + (c.ok ? (c.aviso ? '⚠' : '✓') : '✗') + '</i><div><b>' + esc(c.titulo) + '</b><small>' + esc(c.detalle) + '</small></div></div>').join('');
      $('#fdRes').innerHTML = P.estado === 'firmado' ? '<div class="aviso verde">✓ Firmado por <b>' + esc(P.firmante ? P.firmante.nombre : '') + '</b>' + (P.firmante && P.firmante.emisor ? ' · certificado de ' + esc(P.firmante.emisor) : '') + '. La firma se verificó en el CDE.</div><div class="fa-lista">' + lista + '</div>'
        : P.estado === 'rechazado' ? '<div class="aviso rojo">✗ El PDF firmado que llegó no sirve. Corrige y vuelve a firmar (el pedido sigue abierto).</div><div class="fa-lista">' + lista + '</div>' : '';
      $('#fdOk').disabled = P.estado !== 'firmado';
    };
    const refresca = async () => { if (!vivo) return; try { P = await api('/api/firma/pend/' + token); pinta(); } catch (e) {} };
    const ciclo = async () => { while (vivo && P.estado !== 'firmado') { await new Promise(r => setTimeout(r, 2500)); await refresca(); } };
    pinta(); pintaRaices(); ciclo();
    $('#fdCerrar').onclick = () => { vivo = false; quita(); win.remove(); };
    $('#fdBaja').onclick = () => setTimeout(refresca, 800);
    $('#fdSube').onclick = () => $('#fdIn').click();
    $('#fdIn').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#fdSube').disabled = true; $('#fdSube').textContent = 'Verificando la firma…';
      try { const r = await fetch('/api/firma/pend/' + token + '/subir-firmado', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: f }); const j = await r.json().catch(() => null); if (j && j.estado) { P = j; pinta(); } else N.toast(esc((j && j.mensaje) || 'No se pudo subir'), 'mal'); } catch (err) { N.toast(esc(err.message), 'mal'); }
      $('#fdSube').disabled = false; $('#fdSube').textContent = 'Subir el PDF firmado';
    };
    $('#fdOk').onclick = async () => {
      $('#fdOk').disabled = true; $('#fdOk').textContent = 'Trayendo el PDF firmado…';
      try { const r = await fetch('/api/firma/pend/' + token + '/firmado'); if (!r.ok) throw new Error('No se pudo traer el PDF firmado'); const blob = await r.blob(); vivo = false; quita(); win.remove(); if (o.alFirmar) o.alFirmar(blob, P); }
      catch (e) { N.toast(esc(e.message), 'mal'); $('#fdOk').disabled = false; $('#fdOk').textContent = 'Continuar con el PDF firmado'; }
    };
    // ── la llamada a ReFirma Invoker ──
    $('#fdRf').onclick = async () => {
      const b = $('#fdRf'), modo = $('#fdModo').value, src = E.invoker[modo]; b.disabled = true; quita();
      try {
        await anota('clic', 'Se pulsó «Firmar con ReFirma» (' + (modo === 'java' ? 'Java Web Start' : 'ClickOnce') + ') · ' + navigator.userAgent.replace(/^.*?\)\s*/, '').slice(0, 90));
        const a = await api('/api/firma/pend/' + token + '/argumentos'); args = a.args; await refresca();
        if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) await anota('aviso', 'El CDE no está en https: ReFirma puede negarse a descargar o devolver el PDF.');
        oye('getArguments', (e) => { clearTimeout(espera); anota('getArguments', 'ReFirma está instalado y respondió: pidió los argumentos (tipo ' + ((e && e.detail) || 'W') + '). Se le entregan.'); try { window.dispatchEventClient('sendArguments', args); espera = setTimeout(() => anota('sin-respuesta', 'ReFirma recibió los argumentos pero no descargó el PDF en 90 s: lo más probable es que rechazó las credenciales (clientId / clientSecret de RENIEC) o no alcanza la dirección del CDE.'), 90000); } catch (err) { anota('error', 'No se pudieron entregar los argumentos: ' + err.message); } });
        oye('invokerOk', () => { clearTimeout(espera); anota('invokerOk', 'ReFirma avisó que terminó de firmar y devolvió el PDF.'); });
        oye('invokerCancel', () => { clearTimeout(espera); anota('invokerCancel', 'ReFirma avisó que la firma se canceló (la persona canceló, no eligió certificado o ReFirma rechazó la operación).'); b.disabled = false; });
        try { if (!window.jQuery) await N.carga('vendor/jquery-1.12.4.min.js', 'jQuery'); } catch (e) {}
        try { await N.carga(src, 'initInvoker'); } catch (e) { await anota('error', 'No se pudo cargar el script de RENIEC (' + src + '): sin salida a internet, bloqueado por la red o RENIEC fuera de servicio.'); b.disabled = false; return; }
        if (typeof window.initInvoker !== 'function' || typeof window.dispatchEventClient !== 'function') { await anota('error', 'El script de RENIEC cargó pero no trae initInvoker / dispatchEventClient: puede haber cambiado de versión.'); b.disabled = false; return; }
        await anota('script', 'Script de ReFirma Invoker cargado desde RENIEC. Se llama a initInvoker(\'W\').');
        try { window.initInvoker('W'); } catch (e) { await anota('error', 'initInvoker falló: ' + e.message); b.disabled = false; return; }
        espera = setTimeout(() => { anota('sin-respuesta', 'ReFirma no respondió en 45 s. Causas habituales: ReFirma no está instalado en esta PC; el navegador no abre ClickOnce (usa Edge, o Chrome con la extensión ClickOnce) o falta Java (modo Java Web Start); o se canceló la ventana que pide permiso para abrir ReFirma.'); b.disabled = false; }, 45000);
      } catch (e) { await anota('error', e.message); b.disabled = false; }
    };
  };
})();
