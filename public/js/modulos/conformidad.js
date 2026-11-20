/* REJILLA DE CONFORMIDAD — la ventana «Cargar archivos» de Autodesk Forma cuando la carpeta de destino tiene norma de nomenclatura.
 * Cada archivo sale repartido campo a campo (Código del proyecto - Originador - Activo - Nivel - …) con lo que no cumple en rojo, más
 * los atributos relacionados con la norma (Código de estado, Revisión, Parte designada, Contrato) y los atributos personalizados del
 * proyecto. Hasta que todo cumple no se puede cargar: así los metadatos entran bien.
 *   - «Editar todo»: panel lateral con las pestañas Nombre de archivo / Atributos para cambiar en masa (a los marcados, o a todos);
 *     en los campos numéricos se elige «El mismo número» o «Números consecutivos»; muestra la vista preliminar de los nombres.
 *   - «Eliminar todo», «Mostrar solo archivos con errores», «Añadir archivos», «Mostrar valores de atributo de la versión anterior».
 * La usan Cargar (archivos.js → ventanaCargar) y Desplazar (de una carpeta libre —WIP o retención— a una con norma —compartido/publicado—).
 * Quien valida es el servidor (POST /valida-nombres): aquí no se repite ninguna regla de la norma. */
(function () {
  const N = CDE.N, { esc, api, tam, ventana } = N;
  const RX_REV = /^(P|R|C|M)(\d{2})(\.\d{2})?$/i;
  const ICO_ERR = '<span class="cf-ico mal" title="No cumple">!</span>', ICO_OK = '<span class="cf-ico ok" title="Cumple">✓</span>';

  /** items: [{ nombre, tam?, ref, inicial?: { revision, atributos } }]. opciones: { modo: 'cargar'|'desplazar'|'copiar', boton?, sinAnadir? }. Resuelve null (cancelado) o
   *  [{ ref, file?, nombre, revision, idoneidad, atributos, ok }] con los archivos que quedaron en la rejilla. */
  function rejillaConformidad(p, carpeta, items, opciones) {
    const o = Object.assign({ modo: 'cargar' }, opciones || {}), pid = p.id, copiar = o.modo === 'copiar', mover = o.modo === 'desplazar' || copiar;
    return new Promise(async (resuelve) => {
      let D; try { D = await api('/api/proyectos/' + pid + '/valida-nombres', { json: { carpeta, nombres: items.map(x => x.nombre) } }); } catch (e) { N.toast(esc(e.message), 'mal'); return resuelve(null); }
      if (D.libre || !D.norma) return resuelve(items.map(x => ({ ref: x.ref, nombre: x.nombre, revision: '', idoneidad: '', atributos: {}, ok: true })));
      // v0.24.1 · en el compartido (Validación QA) la portada da la revisión, la descripción y el código: la rejilla solo se abre para
      // los archivos cuyo nombre no cumple la norma, y solo con los campos del nombre (más algún atributo que el proyecto exija).
      if (o.qa) {
        const exigidos = (D.personalizados || []).some(d => d.obligatorio && d.id !== 'descripcion') || D.atributos.parteDesignada.requerido || D.atributos.contrato.requerido;
        const listos = [], faltan = [], filasF = [];
        items.forEach((it, i) => { const f = D.filas[i]; if (f && f.ok && !exigidos) listos.push({ ref: it.ref, file: it.file, nombre: it.nombre, revision: '', idoneidad: '', atributos: {}, ok: true }); else { faltan.push(it); filasF.push(f); } });
        if (!faltan.length) return resuelve(listos);
        if (listos.length) { items = faltan; D = Object.assign({}, D, { filas: filasF }); }
        o.soloNombre = true; o.listos = listos;
      }
      const OC = o.soloNombre ? ' cf-oc' : '', ocP = (d) => o.soloNombre && d.id !== 'descripcion' && !d.obligatorio ? 'cf-oc' : '';   // la descripción (de la portada) siempre a la vista
      const NORMA = D.norma, A = D.atributos, PERS = [{ id: 'descripcion', nombre: 'Descripción', tipo: 'texto', obligatorio: !o.qa, valores: [] }]   /* en el compartido la descripción la pone la Validación QA: el nombre del documento en su portada */.concat((D.personalizados || []).filter(d => d.id !== 'descripcion')), nC = NORMA.campos.length;
      const rxParte = A.parteDesignada.rx ? new RegExp(A.parteDesignada.rx) : null, rxContrato = A.contrato.rx ? new RegExp(A.contrato.rx) : null;
      let previa = true; try { previa = localStorage.getItem('cde.cf.previa') !== '0'; } catch (e) {}
      let contratoUlt = ''; try { contratoUlt = localStorage.getItem('cde.cf.contrato.' + pid) || ''; } catch (e) {}
      let soloErrores = false, hecho = false, sec = 0;
      const filas = [];
      const nuevaFila = (it, f) => {
        const c = f.contenedor, at = (c && c.atributos) || {}, orig = A.parteDesignada.campo >= 0 ? f.partes[A.parteDesignada.campo] : '';
        const r = { ref: it.ref, file: it.file, orig: it.nombre, tam: it.tam || 0, ext: f.extension, partes: f.partes.slice(), cont: c, tocado: {}, errC: f.erroresCampo.slice(), errores: f.errores.slice(), okNombre: f.ok, marcado: false,
          rev: f.revision || (c ? (mover ? c.revision : c.siguiente) : ''), idon: '', parte: '', contrato: '', pers: {} };
        if (mover && c && !f.revision) r.rev = c.revision;
        if (previa && c) { r.idon = mover ? c.idoneidad : ''; r.parte = at.parteDesignada || ''; r.contrato = at.contrato || ''; for (const d of PERS) if (at[d.id]) r.pers[d.id] = at[d.id]; }
        if (c && at.descripcion && !r.pers.descripcion) r.pers.descripcion = at.descripcion;   // la descripcion que ya tiene el documento
        if (it.inicial) { if (!f.revision && it.inicial.revision && RX_REV.test(it.inicial.revision)) r.rev = it.inicial.revision.toUpperCase(); for (const [k, v] of Object.entries(it.inicial.atributos || {})) if (v && !r.pers[k]) r.pers[k] = String(v); }   // lo que trae el otro CDE (p. ej. el título de Aconex)
        if (!r.parte && orig && (!rxParte || rxParte.test(orig))) r.parte = orig;
        if (!r.contrato) r.contrato = contratoUlt;
        return r;
      };
      items.forEach((it, i) => filas.push(nuevaFila(it, D.filas[i])));
      const it0 = (f) => f.ref && f.ref.id;
      const compone = (r) => r.partes.join('-') + (NORMA.conRevision && r.rev ? '-' + r.rev.toUpperCase() : '') + (r.ext ? '.' + r.ext : '');
      /** Errores de los atributos de una fila: { rev, parte, contrato, pers: {id} }. */
      const errAtr = (r) => {
        const e = { pers: {} };
        if (o.qa && !r.rev) { /* en el compartido la revisión la pone la portada (Validación QA): R00 la primera vez, luego R01, R02… */ } else if (!r.rev) e.rev = 'La revisión es obligatoria (' + A.revision.pista + ').'; else if (!RX_REV.test(r.rev)) e.rev = 'Revisión no válida: una letra (P, R, C o M) y dos dígitos, p. ej. ' + (/R/.test(A.revision.pista) ? 'R00' : 'P01') + '.';
        else if (!mover && r.cont && r.cont.revision && r.rev.toUpperCase() === r.cont.revision) e.rev = 'La última versión ya lleva la revisión ' + r.cont.revision + ': la nueva debe ser posterior.';
        if (A.parteDesignada.requerido) { if (!r.parte) e.parte = 'La parte designada es obligatoria (' + A.parteDesignada.pista + ').'; else if (rxParte && !rxParte.test(r.parte)) e.parte = 'No cumple el formato: ' + A.parteDesignada.pista + '.'; }
        if (A.contrato.requerido) { if (!r.contrato) e.contrato = 'El contrato es obligatorio (' + A.contrato.pista + ').'; else if (rxContrato && !rxContrato.test(r.contrato)) e.contrato = 'No cumple el formato: ' + A.contrato.pista + '.'; }
        for (const d of PERS) if (d.obligatorio && !r.pers[d.id]) e.pers[d.id] = d.nombre + ' es obligatorio.';
        return e;
      };
      const malAtr = (r) => { const e = errAtr(r); return !!(e.rev || e.parte || e.contrato || Object.keys(e.pers).length); };
      const malNombre = (r) => !r.okNombre;

      const cab = '<th class="chk"><input type="checkbox" id="cfTodos"></th><th class="cf-nom">Nombre de archivo</th>' + NORMA.campos.map((c, i) => '<th title="' + esc(c.descripcion) + '">' + esc(c.nombre) + (c.obligatorio ? ' <i>*</i>' : '') + '</th>' + (i < nC - 1 ? '<th class="cf-g"></th>' : '')).join('') +
        '<th class="cf-sep' + OC + '">Código de estado</th><th class="' + OC + '">Revisión' + (o.qa ? '' : ' <i>*</i>') + '</th>' + (A.parteDesignada.pista ? '<th class="' + (A.parteDesignada.requerido ? '' : OC) + '" title="' + esc(A.parteDesignada.pista) + '">Parte designada' + (A.parteDesignada.requerido ? ' <i>*</i>' : '') + '</th>' : '') + (A.contrato.pista ? '<th class="' + (A.contrato.requerido ? '' : OC) + '" title="' + esc(A.contrato.pista) + '">Contrato' + (A.contrato.requerido ? ' <i>*</i>' : '') + '</th>' : '') + PERS.map(d => '<th class="' + ocP(d) + '">' + esc(d.nombre) + (d.obligatorio ? ' <i>*</i>' : '') + '</th>').join('') + '<th></th>';
      const listas = NORMA.campos.map((c, i) => c.tipo === 'lista' && c.valores.length > 5000 ? '<datalist id="cfdl' + i + '">' + c.valores.map(v => '<option value="' + esc(v) + '">' + esc(c.etiquetas && c.etiquetas[v] ? v + ' - ' + c.etiquetas[v] : v) + '</option>').join('') + '</datalist>' : '').join('');
      const v = ventana(copiar ? 'Copiar a otra carpeta' : mover ? 'Desplazar archivos' : 'Cargar archivos', '<div class="cf">' +
        '<div class="cf-aviso" id="cfAviso"></div>' +
        '<div class="cf-barra"><span id="cfCuenta"></span><button class="primario" id="cfEditar">' + N.ICO.lapiz + ' Editar todo</button><a href="#" id="cfBorra">Eliminar todo</a><span class="crece"></span><span class="pista">Norma: <b>' + esc(NORMA.nombre) + '</b></span></div>' +
        '<div class="cf-tabla"><table><thead><tr>' + cab + '</tr></thead><tbody id="cfCuerpo"></tbody></table></div>' + listas +
        '<div class="cf-pie">' + (mover || o.sinAnadir ? '' : '<a href="#" id="cfMas">Añadir archivos</a><input type="file" id="cfIn" multiple class="oculto">') + '<label class="cf-int"><input type="checkbox" id="cfPrev"' + (previa ? ' checked' : '') + '><span></span> Mostrar valores de atributo de la versión anterior</label><span class="crece"></span><span class="pista" id="cfRet"></span><button class="enlace" id="cfNo">Cancelar</button><button class="primario" id="cfOk">' + esc(o.boton || (copiar ? 'Copiar' : mover ? 'Desplazar' : 'Cargar')) + '</button></div>' +
        '<div class="cf-lado oculto" id="cfLado"></div></div>',
        { ancho: Math.min(1900, innerWidth - 24), alto: Math.min(920, innerHeight - 24), x: 12, y: 12, alCerrar: () => { if (!hecho) { hecho = true; resuelve(null); } } });
      const win = v.closest('.ventana'), Q = (s) => v.querySelector(s);

      const opcionesDe = (c, val) => (val && !c.valores.includes(val) ? '<option value="' + esc(val) + '" selected>' + esc(val) + ' ✗</option>' : '') + '<option value=""' + (val ? '' : ' selected') + '>Selec…</option>' + c.valores.map(x => '<option value="' + esc(x) + '"' + (x === val ? ' selected' : '') + '>' + esc(c.etiquetas && c.etiquetas[x] ? x + ' - ' + c.etiquetas[x] : x) + '</option>').join('');
      const celdaCampo = (r, c, i) => c.tipo === 'lista' && c.valores.length <= 5000 ? '<select data-f="' + i + '">' + opcionesDe(c, r.partes[i]) + '</select>' : '<input data-f="' + i + '" value="' + esc(r.partes[i]) + '" placeholder="' + esc(c.mascara) + '"' + (c.tipo === 'lista' ? ' list="cfdl' + i + '"' : '') + ' autocomplete="off" spellcheck="false">';
      const celdaPers = (r, d) => d.tipo === 'lista' && d.valores.length ? '<select data-p="' + esc(d.id) + '"><option value="">Selec…</option>' + d.valores.map(x => '<option' + (r.pers[d.id] === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '<input data-p="' + esc(d.id) + '" value="' + esc(r.pers[d.id] || '') + '"' + (d.tipo === 'fecha' ? ' type="date"' : '') + (o.qa && d.id === 'descripcion' ? ' readonly class="cf-deportada" placeholder="Se llena con el título de la portada" title="En el compartido la descripción es el título del recuadro de la portada (Validación QA)"' : '') + '>';
      function pintaFila(r) {
        if (!r.tr) { r.tr = document.createElement('tr'); }
        r.tr.innerHTML = '<td class="chk"><input type="checkbox" data-x="m"' + (r.marcado ? ' checked' : '') + '></td><td class="cf-nom"><div class="fila" style="gap:8px;align-items:center"><span data-x="ico"></span><div style="min-width:0"><div class="mono n1" title="' + esc(r.orig) + '">' + esc(r.orig) + '</div><div class="mono n2" data-x="nuevo"></div></div></div></td>' +
          NORMA.campos.map((c, i) => '<td>' + celdaCampo(r, c, i) + '</td>' + (i < nC - 1 ? '<td class="cf-g">-</td>' : '')).join('') +
          '<td class="cf-sep' + OC + '"><select data-a="idon"><option value="">Selec…</option>' + A.codigosEstado.map(x => '<option value="' + esc(x.valor) + '"' + (r.idon === x.valor ? ' selected' : '') + ' title="' + esc(x.descripcion) + '">' + esc(x.valor + ' - ' + x.descripcion) + '</option>').join('') + '</select></td>' +
          '<td class="' + OC + '"><input data-a="rev" value=""' + esc(r.rev) + '" placeholder="' + (o.qa ? 'De la portada' : /R/.test(A.revision.pista) ? 'R00' : 'P01') + '" title="' + (o.qa ? 'En el compartido la revisión la pone la portada (Validación QA)' : '') + '" maxlength="6"></td>' +
          (A.parteDesignada.pista ? '<td class="' + (A.parteDesignada.requerido ? '' : OC) + '"><input data-a="parte" value="' + esc(r.parte) + '" placeholder="XXXXX" maxlength="20"></td>' : '') + (A.contrato.pista ? '<td class="' + (A.contrato.requerido ? '' : OC) + '"><input data-a="contrato" value="' + esc(r.contrato) + '" placeholder="#####" maxlength="40"></td>' : '') +
          PERS.map(d => '<td class="' + ocP(d) + '">' + celdaPers(r, d) + '</td>').join('') + '<td><button class="cf-x" data-x="quita" title="Quitar de la lista">✕</button></td>';
        r.tr.querySelectorAll('[data-f]').forEach(el => { const i = +el.dataset.f; const pone = () => { let x = el.value; if (el.tagName === 'INPUT') { const y = x.replace(/[-\s]/g, ''); if (y !== x) { el.value = y; x = y; } } r.partes[i] = x; if (i === A.parteDesignada.campo && !r.tocado.parte && (!rxParte || rxParte.test(x))) { r.parte = x; const pe = r.tr.querySelector('[data-a="parte"]'); if (pe) pe.value = x; } marca(r); valida(); }; el.oninput = pone; el.onchange = pone; });
        r.tr.querySelectorAll('[data-a]').forEach(el => { const k = el.dataset.a; const pone = () => { r[k] = k === 'rev' || k === 'parte' ? el.value.trim().toUpperCase() : el.value.trim(); r.tocado[k] = true; marca(r); if (k === 'rev' && NORMA.conRevision) valida(); else resumen(); }; el.oninput = pone; el.onchange = pone; });
        r.tr.querySelectorAll('[data-p]').forEach(el => { const pone = () => { r.pers[el.dataset.p] = el.value.trim(); marca(r); resumen(); }; el.oninput = pone; el.onchange = pone; });
        r.tr.querySelector('[data-x="m"]').onchange = (e) => { r.marcado = e.target.checked; };
        r.tr.querySelector('[data-x="quita"]').onclick = () => { filas.splice(filas.indexOf(r), 1); r.tr.remove(); if (!filas.length) return cierra(null); resumen(); };
        marca(r);
      }
      /** Pone en rojo lo que no cumple, sin rehacer la fila (para no perder el foco mientras se escribe). */
      function marca(r) {
        if (!r.tr) return; const e = errAtr(r);
        r.tr.querySelectorAll('[data-f]').forEach(el => { const m = r.errC[+el.dataset.f] || ''; el.classList.toggle('mal', !!m); el.title = m || NORMA.campos[+el.dataset.f].descripcion || ''; });
        const pon = (sel, m) => { const el = r.tr.querySelector(sel); if (el) { el.classList.toggle('mal', !!m); el.title = m || ''; } };
        pon('[data-a="rev"]', e.rev); pon('[data-a="parte"]', e.parte); pon('[data-a="contrato"]', e.contrato); for (const d of PERS) pon('[data-p="' + d.id + '"]', e.pers[d.id]);
        const mal = malNombre(r) || malAtr(r), nuevo = compone(r);
        r.tr.querySelector('[data-x="ico"]').innerHTML = mal ? ICO_ERR : ICO_OK; r.tr.querySelector('[data-x="ico"]').firstChild.title = mal ? r.errores.concat([e.rev, e.parte, e.contrato].filter(Boolean), Object.values(e.pers)).join('\n') : 'Cumple la norma';
        const n2 = r.tr.querySelector('[data-x="nuevo"]'); n2.textContent = nuevo; n2.title = nuevo; n2.classList.toggle('igual', nuevo === r.orig);
        r.tr.classList.toggle('conerror', mal); r.tr.style.display = soloErrores && !mal ? 'none' : '';
      }
      function resumen() {
        const nn = filas.filter(malNombre).length, na = filas.filter(malAtr).length, n = filas.filter(r => malNombre(r) || malAtr(r)).length;
        Q('#cfAviso').className = 'cf-aviso ' + (n ? 'mal' : 'ok');
        Q('#cfAviso').innerHTML = n ? '<span class="cf-ban">⊗</span><span class="crece">' + n + ' archivo' + (n > 1 ? 's no cumplen' : ' no cumple') + ' con la configuración de cumplimiento. Resuelva errores con: ' + [nn ? 'norma de nomenclatura (' + nn + ')' : '', na ? 'atributos necesarios (' + na + ')' : ''].filter(Boolean).join(', y ') + '.</span><label><input type="checkbox" id="cfSolo"' + (soloErrores ? ' checked' : '') + '> Mostrar solo archivos con errores</label>'
          : '<span class="cf-ban">✓</span><span class="crece">Todos los archivos cumplen la norma de nomenclatura y tienen sus atributos necesarios.</span>';
        const so = Q('#cfSolo'); if (so) so.onchange = () => { soloErrores = so.checked; filas.forEach(marca); }; else if (soloErrores) { soloErrores = false; filas.forEach(marca); }
        Q('#cfCuenta').innerHTML = '<b>' + filas.length + ' archivo' + (filas.length === 1 ? '' : 's') + '</b> en espera para ' + (copiar ? 'copiarse a' : mover ? 'desplazarse a' : 'cargarse en') + ' <b>Archivos de proyecto/' + esc(carpeta) + '</b>';
        const ret = !mover && D.areaRetencion && nn && !na;
        Q('#cfRet').textContent = ret ? 'Área de retención activada: lo que no cumple la norma se cargará retenido.' : '';
        Q('#cfOk').disabled = !filas.length || (n > 0 && !ret);
        Q('#cfOk').title = Q('#cfOk').disabled ? 'Corrige lo marcado en rojo (o quita esos archivos) para continuar' : '';
      }
      let tmr = null;
      function valida(ya) {
        clearTimeout(tmr); const yo = ++sec;
        tmr = setTimeout(async () => {
          const L = filas.slice();
          try {
            const r = await api('/api/proyectos/' + pid + '/valida-nombres', { json: { carpeta, nombres: L.map(compone) } }); if (yo !== sec) return;
            L.forEach((f, i) => { const x = r.filas[i]; if (!x) return; f.okNombre = x.ok; f.errores = x.errores; f.errC = x.partes.join('\u0001') === f.partes.join('\u0001') ? x.erroresCampo : f.partes.map((pv, k) => /-/.test(pv) ? 'No puede llevar guiones.' : (x.erroresCampo[k] || '')); if (mover && x.contenedor && it0(f) && x.contenedor.id !== it0(f)) { f.okNombre = false; f.errores = ['Ya hay otro archivo con ese nombre en el proyecto (' + (x.contenedor.carpeta || 'raíz') + ').']; } if (!mover && x.contenedor && x.contenedor.carpeta !== carpeta && x.ok) { f.okNombre = false; f.errores = ['Ese archivo ya existe en ' + (x.contenedor.carpeta || 'la raíz') + ': sus versiones nuevas se cargan en esa misma carpeta (o desplázalo primero).']; } if (!mover) { const antes = f.cont && f.cont.id; f.cont = x.contenedor; if (f.cont && f.cont.id !== antes && !f.tocado.rev && !NORMA.conRevision) { f.rev = f.cont.siguiente; const el = f.tr && f.tr.querySelector('[data-a="rev"]'); if (el) el.value = f.rev; } } marca(f); });
            // dos archivos de la lista no pueden quedar con el mismo nombre
            const vistos = new Map(); for (const f of L) { const k = f.partes.join('-').toUpperCase() + '.' + String(f.ext || '').toLowerCase(); if (vistos.has(k) && f.okNombre) { f.okNombre = false; f.errores = ['Otro archivo de esta lista queda con el mismo nombre.']; marca(f); } else vistos.set(k, f); }
            resumen();
          } catch (e) { N.toast(esc(e.message), 'mal'); }
        }, ya ? 0 : 260);
      }
      const pintaTodo = () => { const tb = Q('#cfCuerpo'); tb.innerHTML = ''; for (const r of filas) { pintaFila(r); tb.appendChild(r.tr); } resumen(); };
      function cierra(res) { if (hecho) return; hecho = true; win.remove(); resuelve(res && o.listos ? o.listos.concat(res) : res); }

      // ---------- Editar todo ----------
      function editarTodo() {
        const L = Q('#cfLado'), obj = () => { const m = filas.filter(r => r.marcado); return m.length ? m : filas; };
        let tab = 'nombre'; const val = { f: {}, modo: {}, a: {}, p: {} };
        const comun = (fn) => { const s = new Set(obj().map(fn)); return s.size === 1 ? [...s][0] : null; };
        const ph = (x) => x === null ? 'Varios valores' : (x === '' ? 'Sin valores' : '');
        const aplicaA = (r, k) => { const c = Object.assign({}, r, { partes: r.partes.slice() }); NORMA.campos.forEach((cm, i) => { const x = val.f[i]; if (x === undefined || x === '') return; if (val.modo[i] === 'sec' && /^\d+$/.test(x)) c.partes[i] = String(parseInt(x, 10) + k).padStart(x.length, '0'); else c.partes[i] = x; }); if (val.a.rev) c.rev = val.a.rev.toUpperCase(); return c; };
        const pinta = () => {
          const T = obj();
          L.innerHTML = '<div class="cf-ltit"><h3>Editar</h3><button class="cf-x" id="ceX">✕</button></div><div class="tabs chicas"><button data-t="nombre" class="' + (tab === 'nombre' ? 'activa' : '') + '">Nombre de archivo</button><button data-t="atributos" class="' + (tab === 'atributos' ? 'activa' : '') + '">Atributos</button></div><div class="cf-lcuerpo">' +
            (tab === 'nombre' ? '<p class="pista">Los cambios realizados en los campos de nombre del documento también afectan al nombre de archivo. Se aplican a ' + (T.length === filas.length ? 'los ' + T.length + ' archivos' : 'los ' + T.length + ' archivos marcados') + '; lo que dejes en blanco no cambia.</p><div class="cf-vp"><b>Vista preliminar:</b><div id="ceVp"></div></div>' +
              NORMA.campos.map((c, i) => { const cm = comun(r => r.partes[i]), num = c.caracteres === 'numeros' && c.tipo !== 'lista'; return '<div class="cf-lc"><div class="fila" style="align-items:center"><label class="crece" title="' + esc(c.descripcion) + '">' + esc(c.nombre) + '</label>' + (num ? '<select data-em="' + i + '" class="cf-modo"><option value="mismo"' + (val.modo[i] !== 'sec' ? ' selected' : '') + '>☰ El mismo número</option><option value="sec"' + (val.modo[i] === 'sec' ? ' selected' : '') + '>☰ Números consecutivos</option></select>' : '') + '</div>' + (c.tipo === 'lista' && c.valores.length <= 5000 ? '<select data-ef="' + i + '"><option value="">' + (cm === null ? 'Varios valores' : cm === '' ? 'Sin valores' : esc(cm) + ' (sin cambio)') + '</option>' + c.valores.map(x => '<option value="' + esc(x) + '"' + (val.f[i] === x ? ' selected' : '') + '>' + esc(c.etiquetas && c.etiquetas[x] ? x + ' - ' + c.etiquetas[x] : x) + '</option>').join('') + '</select>' : '<input data-ef="' + i + '" value="' + esc(val.f[i] || '') + '" placeholder="' + esc(ph(cm) || cm) + '"' + (c.tipo === 'lista' ? ' list="cfdl' + i + '"' : '') + ' autocomplete="off">') + '</div>'; }).join('')
              : '<p class="pista">Atributos relacionados con la norma y atributos del proyecto. Lo que dejes en blanco no cambia.</p>' +
                '<div class="cf-lc"><label>Código de estado</label><select data-ea="idon"><option value="">' + (ph(comun(r => r.idon)) || 'Sin cambio') + '</option>' + A.codigosEstado.map(x => '<option value="' + esc(x.valor) + '"' + (val.a.idon === x.valor ? ' selected' : '') + '>' + esc(x.valor + ' - ' + x.descripcion) + '</option>').join('') + '</select></div>' +
                '<div class="cf-lc"><label>Revisión</label><input data-ea="rev" value="' + esc(val.a.rev || '') + '" placeholder="' + esc(ph(comun(r => r.rev)) || comun(r => r.rev)) + '"></div>' +
                (A.parteDesignada.pista ? '<div class="cf-lc"><label>Parte designada</label><input data-ea="parte" value="' + esc(val.a.parte || '') + '" placeholder="' + esc(ph(comun(r => r.parte)) || comun(r => r.parte)) + '"></div>' : '') +
                (A.contrato.pista ? '<div class="cf-lc"><label>Contrato</label><input data-ea="contrato" value="' + esc(val.a.contrato || '') + '" placeholder="' + esc(ph(comun(r => r.contrato)) || comun(r => r.contrato)) + '"></div>' : '') +
                PERS.map(d => '<div class="cf-lc"><label>' + esc(d.nombre) + '</label>' + (d.tipo === 'lista' && d.valores.length ? '<select data-ep="' + esc(d.id) + '"><option value="">Sin cambio</option>' + d.valores.map(x => '<option' + (val.p[d.id] === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '<input data-ep="' + esc(d.id) + '" value="' + esc(val.p[d.id] || '') + '"' + (d.tipo === 'fecha' ? ' type="date"' : '') + '>') + '</div>').join('')) +
            '</div><div class="cf-lpie"><button class="primario" id="ceOk">Guardar</button></div>';
          const vp = () => { const el = L.querySelector('#ceVp'); if (el) el.innerHTML = T.slice(0, 6).map((r, k) => '<div class="mono" title="' + esc(compone(aplicaA(r, k))) + '">' + esc(compone(aplicaA(r, k))) + '</div>').join('') + (T.length > 6 ? '<div class="pista">… y ' + (T.length - 6) + ' más</div>' : ''); };
          vp();
          L.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; pinta(); });
          L.querySelectorAll('[data-ef]').forEach(el => { const f = () => { val.f[+el.dataset.ef] = el.tagName === 'INPUT' ? el.value.replace(/[-\s]/g, '') : el.value; vp(); }; el.oninput = f; el.onchange = f; });
          L.querySelectorAll('[data-em]').forEach(el => el.onchange = () => { val.modo[+el.dataset.em] = el.value; vp(); });
          L.querySelectorAll('[data-ea]').forEach(el => { const f = () => { val.a[el.dataset.ea] = el.value.trim(); }; el.oninput = f; el.onchange = f; });
          L.querySelectorAll('[data-ep]').forEach(el => { const f = () => { val.p[el.dataset.ep] = el.value.trim(); }; el.oninput = f; el.onchange = f; });
          L.querySelector('#ceX').onclick = () => L.classList.add('oculto');
          L.querySelector('#ceOk').onclick = () => {
            T.forEach((r, k) => { const c = aplicaA(r, k); r.partes = c.partes; if (val.a.rev) { r.rev = val.a.rev.toUpperCase(); r.tocado.rev = true; } if (val.a.idon) r.idon = val.a.idon; if (val.a.parte) { r.parte = val.a.parte.toUpperCase(); r.tocado.parte = true; } else if (A.parteDesignada.campo >= 0 && val.f[A.parteDesignada.campo] && !r.tocado.parte) r.parte = r.partes[A.parteDesignada.campo]; if (val.a.contrato) r.contrato = val.a.contrato; for (const [k2, x] of Object.entries(val.p)) if (x) r.pers[k2] = x; });
            L.classList.add('oculto'); pintaTodo(); valida(true);
          };
        };
        L.classList.remove('oculto'); pinta();
      }

      Q('#cfEditar').onclick = editarTodo;
      Q('#cfBorra').onclick = (e) => { e.preventDefault(); cierra(null); };
      Q('#cfNo').onclick = () => cierra(null);
      Q('#cfTodos').onchange = (e) => { filas.forEach(r => { r.marcado = e.target.checked; const x = r.tr && r.tr.querySelector('[data-x="m"]'); if (x) x.checked = r.marcado; }); };
      Q('#cfPrev').onchange = (e) => { previa = e.target.checked; try { localStorage.setItem('cde.cf.previa', previa ? '1' : '0'); } catch (err) {} for (const r of filas) { const at = (r.cont && r.cont.atributos) || {}; if (!r.cont) continue; if (previa) { if (!r.parte) r.parte = at.parteDesignada || r.parte; if (!r.contrato) r.contrato = at.contrato || ''; if (mover && !r.idon) r.idon = r.cont.idoneidad || ''; for (const d of PERS) if (!r.pers[d.id] && at[d.id]) r.pers[d.id] = at[d.id]; } else { if (!r.tocado.parte && r.parte === at.parteDesignada) r.parte = ''; if (!r.tocado.contrato && r.contrato === at.contrato) r.contrato = ''; if (!r.tocado.idon) r.idon = ''; for (const d of PERS) if (r.pers[d.id] === at[d.id]) delete r.pers[d.id]; } } pintaTodo(); };
      const mas = Q('#cfMas'); if (mas) { mas.onclick = (e) => { e.preventDefault(); Q('#cfIn').click(); }; Q('#cfIn').onchange = async (e) => { const fs = [...e.target.files].filter(f => !filas.some(r => r.orig === f.name)); e.target.value = ''; if (!fs.length) return; try { const r = await api('/api/proyectos/' + pid + '/valida-nombres', { json: { carpeta, nombres: fs.map(f => f.name) } }); fs.forEach((f, i) => filas.push(nuevaFila({ nombre: f.name, tam: f.size, file: f, ref: null }, r.filas[i]))); pintaTodo(); valida(true); } catch (err) { N.toast(esc(err.message), 'mal'); } }; }
      Q('#cfOk').onclick = () => {
        const c0 = filas.find(r => r.contrato); if (c0) try { localStorage.setItem('cde.cf.contrato.' + pid, c0.contrato); } catch (e) {}
        cierra(filas.map(r => { const at = {}; if (r.parte) at.parteDesignada = r.parte; if (r.contrato) at.contrato = r.contrato; for (const d of PERS) if (r.pers[d.id]) at[d.id] = r.pers[d.id]; return { ref: r.ref, file: r.file, nombre: compone(r), original: r.orig, revision: (r.rev || '').toUpperCase(), idoneidad: r.idon, atributos: at, ok: !malNombre(r) && !malAtr(r), contenedor: r.cont }; }));
      };
      pintaTodo(); valida(true);
    });
  }
  Object.assign(N, { rejillaConformidad });
})();
