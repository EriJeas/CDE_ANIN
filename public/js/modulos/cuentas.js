/* CDE ANIN · Cuentas propias (MODO_ACCESO=cuentas): cambio de clave y, para el administrador del CDE, alta de cuentas. */
(function () {
  const N = CDE.N, { esc, api, fecha, app } = N;
  /** Cambio de clave. Con clave temporal ocupa toda la pantalla y no deja seguir hasta cambiarla. */
  N.cambiaClave = function (obligado) {
    const cuerpo = (obligado ? '<p class="pista" style="margin:0 0 12px">Entraste con una clave temporal. Pon una clave propia para continuar.</p>' : '') + '<label>' + (obligado ? 'Clave temporal' : 'Clave actual') + '</label><input type="password" id="ccA" autocomplete="current-password"><label>Clave nueva (mínimo 10 caracteres)</label><input type="password" id="ccN" autocomplete="new-password"><label>Repite la clave nueva</label><input type="password" id="ccR" autocomplete="new-password"><div id="ccMsg" class="pista" style="margin-top:8px;color:var(--aninr)"></div><div style="margin-top:14px"><button class="primario" id="ccOk">Guardar la clave</button></div>';
    let raiz; if (obligado) { app.innerHTML = '<div class="portada p1"><div class="pcentro"><div class="tarjeta acceso"><h1>Cambia tu clave</h1>' + cuerpo + '</div></div></div>'; raiz = app; } else raiz = N.ventana('Cambiar mi clave', cuerpo, { ancho: 440, alto: 400 });
    const g = (i) => raiz.querySelector('#' + i);
    g('ccOk').onclick = async () => { if (g('ccN').value !== g('ccR').value) { g('ccMsg').textContent = 'Las dos claves nuevas no coinciden.'; return; }
      try { await api('/api/acceso/clave', { json: { actual: g('ccA').value, nueva: g('ccN').value } }); N.YO = null; N.toast('Clave cambiada.', 'bien'); if (obligado) { location.hash = '#/'; N.ruta && N.ruta(); } else raiz.closest('.ventana').remove(); } catch (e) { g('ccMsg').textContent = e.message; } };
  };
  /** Cuentas de acceso (solo el administrador del CDE): crear, restablecer la clave y quitar. La clave temporal se muestra una sola vez. */
  N.gestionaCuentas = async function () {
    const v = N.ventana('Cuentas de acceso', '<div class="fila" style="gap:8px;align-items:flex-end"><div style="flex:2"><label>Correo</label><input id="cuE" type="email" placeholder="nombre@anin.gob.pe"></div><div style="flex:2"><label>Nombre</label><input id="cuN" placeholder="Nombre y apellido"></div><button class="primario" id="cuAdd">Crear cuenta</button></div><div id="cuT" class="aviso verde oculto" style="margin-top:10px"></div><div class="acctabla" style="margin-top:12px"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody id="cuL"></tbody></table></div><p class="pista" style="margin-top:10px">Crear la cuenta solo permite entrar. Lo que cada persona ve lo decide su rol en cada proyecto (Usuarios de proyecto).</p>', { ancho: 900, alto: 620 });
    const g = (i) => v.querySelector('#' + i), temporal = (r) => { const t = g('cuT'); t.classList.remove('oculto'); t.innerHTML = 'Clave temporal de <b>' + esc(r.email) + '</b>: <span class="mono" style="font-size:15px;user-select:all">' + esc(r.temporal) + '</span><br><span class="pista">Entrégasela por un medio seguro: no se vuelve a mostrar. Al entrar tendrá que cambiarla.</span>'; };
    const pinta = async () => { const d = await api('/api/acceso/cuentas');
      g('cuL').innerHTML = d.cuentas.map(c => '<tr><td class="mono">' + esc(c.email) + '</td><td>' + esc(c.nombre) + (c.admin ? ' <span class="pista">· administrador del CDE</span>' : '') + '</td><td>' + (c.debe_cambiar ? 'Con clave temporal' : 'Activa') + '</td><td class="pista">' + (c.ultimo ? fecha(c.ultimo) : 'nunca') + '</td><td style="text-align:right"><button class="mini" data-r="' + esc(c.email) + '">Restablecer clave</button> <button class="mini" data-x="' + esc(c.email) + '">Quitar</button></td></tr>').join('');
      g('cuL').querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { if (!confirm('¿Restablecer la clave de ' + b.dataset.r + '?')) return; try { temporal(await api('/api/acceso/cuentas/restablecer', { json: { email: b.dataset.r } })); pinta(); } catch (e) { N.toast(esc(e.message), 'mal'); } });
      g('cuL').querySelectorAll('[data-x]').forEach(b => b.onclick = async () => { if (!confirm('¿Quitar la cuenta de ' + b.dataset.x + '? Ya no podrá entrar.')) return; try { await api('/api/acceso/cuentas/quitar', { json: { email: b.dataset.x } }); pinta(); } catch (e) { N.toast(esc(e.message), 'mal'); } }); };
    g('cuAdd').onclick = async () => { try { temporal(await api('/api/acceso/cuentas', { json: { email: g('cuE').value, nombre: g('cuN').value } })); g('cuE').value = ''; g('cuN').value = ''; pinta(); } catch (e) { N.toast(esc(e.message), 'mal'); } };
    pinta();
  };
  /** La imagen elegida, recortada al centro en cuadrado y reducida a 256 x 256 px (JPG): pesa poco y se ve nítida en el círculo. */
  const recorta = (archivo) => new Promise((ok, mal) => { const img = new Image(), url = URL.createObjectURL(archivo);
    img.onload = () => { const l = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.naturalWidth - l) / 2, (img.naturalHeight - l) / 2, l, l, 0, 0, 256, 256); URL.revokeObjectURL(url); c.toBlob(bl => bl ? ok(bl) : mal(new Error('imagen')), 'image/jpeg', 0.88); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('imagen')); }; img.src = url; });
  /** Mi foto de perfil (administradores y gestores). Queda guardada en la base del CDE: no hay que volver a cargarla tras una actualización. */
  N.miFoto = function () {
    const yo = N.YO || {}, actual = yo.foto ? '<img src="' + N.fotoUrl(yo.foto) + '" alt="">' : '<span>' + esc(N.iniciales(yo.email)) + '</span>';
    const v = N.ventana('Mi foto de perfil', '<div class="mfoto"><div class="mfprev" id="mfPrev">' + actual + '</div><div class="mfcol">' +
      '<p class="pista" style="margin-top:0">Tu foto aparece en el círculo de arriba a la derecha y junto a tu nombre en «Usuarios de proyecto». Se recorta al centro en cuadrado. Admite JPG, PNG o WEBP.</p>' +
      '<input type="file" id="mfArch" accept="image/jpeg,image/png,image/webp" class="oculto"><div class="fila" style="gap:8px;flex-wrap:wrap"><button id="mfElegir">Elegir imagen…</button>' + (yo.foto ? '<button class="peligro" id="mfQuitar">Quitar mi foto</button>' : '') + '</div>' +
      '<div class="fila" style="gap:8px;margin-top:16px"><button class="primario" id="mfOk" disabled>Guardar foto</button><button id="mfNo">Cancelar</button></div><div id="mfMsg" class="pista" style="margin-top:8px"></div></div></div>', { ancho: 560, alto: 330 });
    const g = (i) => v.querySelector('#' + i); let foto = null;
    const cierra = () => v.closest('.ventana').remove(), listo = (f, txt) => { N.YO.foto = f; cierra(); N.toast(txt, 'bien'); if (N.ruta) N.ruta(); };
    g('mfElegir').onclick = () => g('mfArch').click();
    g('mfArch').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { foto = await recorta(f); g('mfPrev').innerHTML = '<img src="' + URL.createObjectURL(foto) + '" alt="">'; g('mfOk').disabled = false; g('mfMsg').textContent = 'Así se verá. Pulsa «Guardar foto».'; } catch (err) { g('mfMsg').textContent = 'No se pudo leer esa imagen. Prueba con un JPG o PNG.'; } };
    g('mfOk').onclick = async () => { if (!foto) return; g('mfOk').disabled = true;
      try { const r = await fetch('/api/perfil/foto', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: foto, credentials: 'same-origin' }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.mensaje || 'No se pudo guardar la foto.'); listo(j.foto, 'Foto guardada.'); } catch (err) { g('mfOk').disabled = false; g('mfMsg').textContent = err.message; } };
    const qx = g('mfQuitar'); if (qx) qx.onclick = async () => { try { await api('/api/perfil/foto', { method: 'DELETE' }); listo(null, 'Foto quitada.'); } catch (err) { g('mfMsg').textContent = err.message; } };
    g('mfNo').onclick = cierra;
  };
  /** Lo que se añade al menú del usuario: su foto (administradores y gestores) y, con cuentas propias, la clave. */
  N.menuCuenta = () => { if (!N.YO) return []; const foto = N.YO.puedeFoto ? [{ texto: N.YO.foto ? 'Cambiar mi foto' : 'Poner mi foto', accion: () => N.miFoto() }] : [];
    return foto.concat(N.YO.modo !== 'cuentas' ? [] : [{ texto: 'Cambiar mi clave', accion: () => N.cambiaClave(false) }].concat(N.YO.admin ? [{ texto: 'Cuentas de acceso', accion: () => N.gestionaCuentas() }] : [])); };
})();
