/* MODULO: Usuarios de proyecto. Registro con el formato estándar: Nombres y apellidos · Correo · Empresa · Cargo · Disciplina / Especialidad → Función. */
(function () {
  const N = CDE.N, { esc, api, fecha, R, aviso, app } = N;
  const ACCESOS = [['lector', 'Lector'], ['miembro', 'Miembro'], ['document-control', 'Document Control'], ['revisor', 'Revisor'], ['revisor-dc', 'Revisor DC'], ['gestor', 'Gestor del proyecto'], ['administrador', 'Administrador']];
  const llano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  /** Acceso al CDE que se propone según la empresa y el cargo (se puede cambiar en cada fila). */
  const accesoSugerido = (empresa, cargo, disciplina) => { const e = llano(empresa), c = llano(cargo), dc = llano(disciplina) === 'CONTROL DOCUMENTARIO'; return c === 'VISUALIZADOR' ? 'lector' : c === 'ADMINISTRADOR' && e === 'ANIN' ? 'gestor' : e === 'ANIN' ? (dc ? 'revisor-dc' : 'revisor') : dc ? 'document-control' : e === 'SUPERVISION' ? 'revisor' : 'miembro'; };

  async function vistaMiembros(pid) {
    const [p, cat0] = await Promise.all([api('/api/proyectos/' + pid), api('/api/proyectos/' + pid + '/catalogo-usuarios')]);
    let cat = cat0;
    const gestor = R[p.rol] >= 3, q = (N.FM || '').toLowerCase();
    const lista = (p.miembros || []).filter(m => !q || [m.email, m.nombre, m.organizacion, m.rol, m.cargo, m.empresa, m.puesto, m.disciplina, m.funcion].join(' ').toLowerCase().includes(q));
    // Usuarios en tres partes: Cliente (equipo de proyecto · transversal · otras direcciones), Contratista y Subcontratista
    const GRUPOS = [['cliente-equipo', 'Cliente', 'Equipo de proyecto'], ['cliente-transversal', 'Cliente', 'Transversal'], ['cliente-otras', 'Cliente', 'Otras Direcciones'], ['contratista', 'Contratista', ''], ['subcontratista', 'Subcontratista', ''], ['supervision', 'Supervisión', ''], ['externo', 'Externo', ''], ['', 'Sin clasificar', '']];
    const orgContr = String(((p.config || {}).partes || {}).CONTRATISTA || '').toUpperCase();
    const orgSuper = String(((p.config || {}).partes || {}).SUPERVISION || '').toUpperCase(), empL = (m) => llano(m.empresa);
    const grupoDe = (m) => m.grupo || (empL(m) === 'SUPERVISION' ? 'supervision' : empL(m) === 'EXTERNO' ? 'externo' : empL(m) === 'SUBCONTRATISTA' ? 'subcontratista' : m.organizacion === 'ANIN' ? 'cliente-equipo' : orgContr && m.organizacion === orgContr ? 'contratista' : orgSuper && m.organizacion === orgSuper ? 'supervision' : '');
    const selGrupo = (idc, val) => '<div style="flex:1"><label>Grupo</label><select id="' + idc + '">' + GRUPOS.map(g => '<option value="' + g[0] + '"' + (g[0] === (val || '') ? ' selected' : '') + '>' + (g[0] ? g[1] + (g[2] ? ' · ' + g[2] : '') : '(automático según la empresa)') + '</option>').join('') + '</select></div>';
    const NC = 9, vac = '<span class="pista">—</span>';
    const fila = (m) => '<tr class="item"><td>' + (m.nombre ? '<b>' + esc(m.nombre) + '</b>' : N.avatar(m.email, '')) + '</td><td>' + esc(m.email) + '</td><td>' + esc(m.empresa || m.organizacion || '—') + (m.empresa && m.organizacion && llano(m.empresa) !== llano(m.organizacion) ? ' <span class="pista mono">' + esc(m.organizacion) + '</span>' : '') + '</td><td>' + (m.puesto ? esc(m.puesto) : vac) + '</td><td>' + (m.disciplina ? esc(m.disciplina) : vac) + '</td><td>' + (m.funcion ? '<span class="etq mono">' + esc(m.funcion) + '</span>' : vac) + '</td><td>' + esc((ACCESOS.find(a => a[0] === m.rol) || [0, m.rol])[1]) + '</td><td>' + fecha(m.agregado) + '</td>' + (gestor ? '<td class="accion"><button class="mini puntos" data-q="' + esc(m.email) + '">⋮</button></td>' : '<td></td>') + '</tr>';
    app.innerHTML = N.marco(p, '/miembros', '', gestor ? '<button id="mCat">Catálogo de funciones</button><button class="primario" id="mAdd">Añadir usuarios</button>' : '') +
      '<div class="accbarra" style="margin-top:4px"><div class="crece"></div><div class="buscar"><input id="fm" placeholder="Buscar por nombre, correo, cargo, disciplina o función" value="' + esc(N.FM || '') + '" style="width:340px"></div></div>' +
      '<div class="acctabla"><table><thead><tr><th>Nombres y apellidos</th><th>Correo electrónico</th><th>Empresa</th><th>Cargo</th><th>Disciplina / Especialidad</th><th>Función</th><th>Acceso al CDE</th><th>Añadido el</th><th class="accion"></th></tr></thead><tbody>' +
      (p.miembros ? (() => { let out = '', cab = ''; for (const g of GRUPOS) { const ms = lista.filter(m => grupoDe(m) === g[0]); if (!ms.length && (!g[0] || q)) continue; if (g[1] !== cab) { cab = g[1]; out += '<tr class="grupo"><td colspan="' + NC + '"><div class="ugrupo">' + g[1] + ' <small>' + lista.filter(m => (GRUPOS.find(x => x[0] === grupoDe(m)) || [])[1] === g[1]).length + ' usuario(s)</small></div></td></tr>'; } if (g[2]) out += '<tr class="grupo"><td colspan="' + NC + '"><div class="usub">' + g[2] + ' · ' + ms.length + '</div></td></tr>'; out += ms.length ? ms.map(fila).join('') : '<tr><td colspan="' + NC + '" class="pista" style="padding-left:22px">Sin usuarios.</td></tr>'; } return out; })() : '<tr><td colspan="' + NC + '" class="vacio">Solo el administrador del proyecto ve la lista de usuarios.</td></tr>') +
      '</tbody></table></div><div class="accpie">Mostrando ' + lista.length + ' de ' + (p.miembros || []).length + '</div><div id="mMsg"></div>' + N.cierra();
    document.getElementById('fm').oninput = (e) => { N.FM = e.target.value; clearTimeout(N._fmT); N._fmT = setTimeout(() => vistaMiembros(pid), 250); };

    // ── catálogo: empresas, cargos y disciplinas con su código; se pueden agregar más ──
    const LISTAS = { empresas: 'Empresa', cargos: 'Cargo', disciplinas: 'Disciplina / Especialidad' };
    const nuevoItem = (lista, luego) => {
      const v = N.ventana('Nuevo: ' + LISTAS[lista], '<label>Nombre</label><input id="ciNom" placeholder="' + (lista === 'cargos' ? 'RESIDENTE' : lista === 'empresas' ? 'CONSULTOR' : 'INSTALACIONES ESPECIALES') + '"><label>Código (va en la función; letras, números y _)</label><input id="ciCod" placeholder="' + (lista === 'cargos' ? 'RES' : lista === 'empresas' ? 'CN' : 'IES') + '" style="width:160px;text-transform:uppercase"><div class="fila" style="justify-content:flex-end;gap:8px;margin-top:14px"><button id="ciNo">Cancelar</button><button class="primario" id="ciOk">Agregar</button></div><div id="ciMsg"></div>', { ancho: 440, alto: 290 });
      v.querySelector('#ciNo').onclick = () => v.closest('.ventana').remove();
      v.querySelector('#ciOk').onclick = async () => { try { const r = await api('/api/proyectos/' + pid + '/catalogo-usuarios', { json: { lista, nombre: v.querySelector('#ciNom').value, codigo: v.querySelector('#ciCod').value } }); cat = r.catalogo; v.closest('.ventana').remove(); N.toast('«' + esc(r.item.nombre) + '» (' + esc(r.item.codigo) + ') agregado al catálogo.', 'bien'); if (luego) luego(r.item); } catch (e) { aviso(v.querySelector('#ciMsg'), e); } };
      v.querySelector('#ciNom').focus();
    };
    const verCatalogo = () => {
      const v = N.ventana('Catálogo de funciones', '', { ancho: 900, alto: 620 });
      const pinta = () => { v.innerHTML = '<p class="pista" style="margin-top:0">La <b>función</b> de cada usuario se arma con los códigos de su empresa, cargo y disciplina: <span class="mono">EMPRESA-CARGO-DISCIPLINA</span> (por ejemplo <span class="mono">A-ESP-DOC</span>). Puedes agregar más a cada lista; los de la librería base no se modifican.</p><div class="catcols">' +
        Object.keys(LISTAS).map(k => '<div><div class="fila" style="align-items:center"><h3 style="margin:0;flex:1">' + LISTAS[k] + ' <span class="pista">' + cat[k].length + '</span></h3><button class="mini" data-nl="' + k + '">＋ Agregar</button></div><div class="catlista">' + cat[k].map(x => '<div><span class="mono etq">' + esc(x.codigo) + '</span> ' + esc(x.nombre) + (x.propio ? ' <span class="pista">· del proyecto</span>' : '') + '</div>').join('') + '</div></div>').join('') + '</div>';
        v.querySelectorAll('[data-nl]').forEach(b => b.onclick = () => nuevoItem(b.dataset.nl, pinta)); };
      pinta();
    };
    const bc = document.getElementById('mCat'); if (bc) bc.onclick = verCatalogo;

    // ── Añadir usuarios: rejilla con el formato estándar del registro ──
    const add = document.getElementById('mAdd'); if (add) add.onclick = () => {
      let filas = [{}];
      const v = N.ventana('Añadir usuarios', '', { ancho: 1280, alto: 660 });
      const opc = (L, val, k) => '<option value="">Seleccionar…</option>' + L.map(x => '<option value="' + esc(x.nombre) + '"' + (llano(x.nombre) === llano(val) || x.codigo === String(val || '').toUpperCase() ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('') + '<option value="__nuevo">＋ Agregar otro…</option>';
      const cod = (L, val) => (L.find(x => llano(x.nombre) === llano(val)) || {}).codigo || '';
      const funcion = (f) => { const a = cod(cat.empresas, f.empresa), b = cod(cat.cargos, f.puesto), c = cod(cat.disciplinas, f.disciplina); return a && b && c ? a + '-' + b + '-' + c : ''; };
      const lee = () => { v.querySelectorAll('tr[data-i]').forEach(tr => { const f = filas[+tr.dataset.i]; tr.querySelectorAll('[data-k]').forEach(x => { if (x.value !== '__nuevo') f[x.dataset.k] = x.value; }); }); };
      const pinta = () => {
        v.innerHTML = '<div class="fila" style="align-items:center;gap:8px;margin-bottom:10px"><span class="pista" style="flex:1">Registro de usuarios con el formato estándar. La <b>Función</b> se arma sola con la empresa, el cargo y la disciplina.</span><input type="file" id="uXls" accept=".xlsx,.xls,.csv" style="display:none"><button id="uImp">Importar Excel (formato estándar)</button><button id="uPega" title="Copia las filas en Excel (Nombres, Correo, Empresa, Cargo, Disciplina) y pégalas aquí">Pegar desde Excel</button></div>' +
          '<div class="acctabla" style="max-height:380px"><table class="chica ureg"><thead><tr><th style="width:36px">Nro</th><th>Nombres y apellidos</th><th>Correo electrónico</th><th>Empresa</th><th>Cargo</th><th>Disciplina / Especialidad</th><th>Función</th><th>Acceso al CDE</th><th style="width:34px"></th></tr></thead><tbody>' +
          filas.map((f, i) => { const fn = funcion(f); return '<tr data-i="' + i + '"><td class="pista">' + (i + 1) + '</td><td><input data-k="nombre" value="' + esc(f.nombre || '') + '" placeholder="Nombres y apellidos"></td><td><input data-k="email" type="email" value="' + esc(f.email || '') + '" placeholder="nombre@empresa.com"></td><td><select data-k="empresa" data-l="empresas">' + opc(cat.empresas, f.empresa) + '</select></td><td><select data-k="puesto" data-l="cargos">' + opc(cat.cargos, f.puesto) + '</select></td><td><select data-k="disciplina" data-l="disciplinas">' + opc(cat.disciplinas, f.disciplina) + '</select></td><td>' + (fn ? '<span class="etq mono">' + esc(fn) + '</span>' : '<span class="pista">—</span>') + '</td><td><select data-k="rol">' + ACCESOS.map(a => '<option value="' + a[0] + '"' + ((f.rol || accesoSugerido(f.empresa, f.puesto, f.disciplina)) === a[0] ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select></td><td><button class="mini" data-fq="' + i + '" title="Quitar la fila">✕</button></td></tr>' + (f.error ? '<tr><td></td><td colspan="8" class="rojo" style="font-size:12px;padding-top:0">' + esc(f.error) + '</td></tr>' : ''); }).join('') +
          '</tbody></table></div><div style="margin:10px 0"><button id="uMas">＋ Agregar fila</button></div>' +
          '<p class="pista">El <b>acceso al CDE</b> se propone según la empresa, el cargo y la disciplina, y lo puedes cambiar. <b>Lector</b>: ve y descarga. <b>Miembro</b>: trabaja en WIP (carga y crea carpetas ahí); no pasa documentos a compartido. <b>Document Control</b>: lo del miembro, y además pasa documentos de WIP a compartido y crea carpetas en compartido. <b>Revisor</b>: solo lee lo que está en WIP; pone marcas de revisión y observaciones a lo compartido; no crea carpetas. <b>Revisor DC</b>: lo del revisor, y además crea carpetas en compartido. <b>Gestor</b>: administra el proyecto. Los permisos de cada carpeta se dan después, por función, en Documentos de proyecto → Permisos.</p>' +
          '<div class="fila" style="justify-content:flex-end;gap:8px"><button id="uNo">Cancelar</button><button class="primario" id="uOk">Añadir usuarios</button></div><div id="uMsg"></div>';
        v.querySelectorAll('select[data-k]').forEach(x => x.onchange = () => { const tr = x.closest('tr'), f = filas[+tr.dataset.i]; if (x.value === '__nuevo') { lee(); return nuevoItem(x.dataset.l, (it) => { f[x.dataset.k] = it.nombre; pinta(); }); } lee(); if (x.dataset.k !== 'rol') { f.rol = accesoSugerido(f.empresa, f.puesto, f.disciplina); pinta(); } });
        v.querySelectorAll('[data-fq]').forEach(b => b.onclick = () => { lee(); filas.splice(+b.dataset.fq, 1); if (!filas.length) filas = [{}]; pinta(); });
        v.querySelector('#uMas').onclick = () => { lee(); const u = filas[filas.length - 1] || {}; filas.push({ empresa: u.empresa || '' }); pinta(); const ins = v.querySelectorAll('input[data-k="nombre"]'); ins[ins.length - 1].focus(); };
        v.querySelector('#uNo').onclick = () => v.closest('.ventana').remove();
        v.querySelector('#uPega').onclick = async () => { let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) {} if (!t) t = prompt('Pega aquí las filas copiadas de Excel (Nombres y apellidos, Correo, Empresa, Cargo, Disciplina):') || ''; lee(); agregaFilas(t.split(/\r?\n/).map(l => l.split('\t'))); };
        v.querySelector('#uImp').onclick = () => v.querySelector('#uXls').click();
        v.querySelector('#uXls').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const XL = await N.carga('vendor/xlsx.full.min.js', 'XLSX'), wb = XL.read(await f.arrayBuffer()), hoja = wb.Sheets[wb.SheetNames.find(n => /est[aá]ndar/i.test(n)) || wb.SheetNames[0]]; lee(); agregaFilas(XL.utils.sheet_to_json(hoja, { header: 1, defval: '' }), true); } catch (err) { aviso(v.querySelector('#uMsg'), err); } };
        v.querySelector('#uOk').onclick = async () => {
          lee(); const L = filas.filter(f => (f.email || '').trim() || (f.nombre || '').trim()); if (!L.length) return aviso(v.querySelector('#uMsg'), new Error('Completa al menos un usuario.'));
          let ok = 0; for (const f of L) { f.error = ''; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((f.email || '').trim())) { f.error = 'Falta un correo electrónico válido.'; continue; } if (!funcion(f)) { f.error = 'Elige la empresa, el cargo y la disciplina.'; continue; }
            try { await api('/api/proyectos/' + pid + '/miembros', { json: { email: f.email.trim(), nombre: (f.nombre || '').trim(), empresa: f.empresa, puesto: f.puesto, disciplina: f.disciplina, rol: f.rol || accesoSugerido(f.empresa, f.puesto, f.disciplina) } }); f.hecho = true; ok++; } catch (e) { f.error = e.message; } }
          filas = filas.filter(f => !f.hecho && ((f.email || '').trim() || (f.nombre || '').trim())); if (ok) N.toast(ok + ' usuario(s) añadido(s).', 'bien');
          if (!filas.length) { v.closest('.ventana').remove(); vistaMiembros(pid); } else pinta();
        };
      };
      /** Filas venidas de Excel: busca la cabecera (si la hay) y toma Nombres, Correo, Empresa, Cargo, Disciplina. */
      const agregaFilas = (M, conCab) => {
        let col = { nombre: 0, email: 1, empresa: 2, puesto: 3, disciplina: 4 }, ini = 0;
        const ic = M.findIndex(r => r.some(c => /correo/i.test(String(c))));
        if (ic >= 0) { const h = M[ic].map(c => llano(c)); col = { nombre: h.findIndex(c => /NOMBRES/.test(c)), email: h.findIndex(c => /CORREO/.test(c)), empresa: h.findIndex(c => /^EMPRESA/.test(c)), puesto: h.findIndex(c => /^CARGO/.test(c)), disciplina: h.findIndex(c => /DISCIPLINA/.test(c)) }; ini = ic + 1; }
        else if (conCab) return N.toast('No encontré la fila de cabecera (Nombres y apellidos, Correo electrónico, Empresa, Cargo, Disciplina / Especialidad).', 'mal');
        else if (M[0] && /^\d+$/.test(String(M[0][0]).trim()) && M[0].length >= 6) col = { nombre: 1, email: 2, empresa: 3, puesto: 4, disciplina: 5 };
        const val = (L, x) => { const k = L.find(y => llano(y.nombre) === llano(x) || y.codigo === llano(x)); return k ? k.nombre : ''; };
        const nuevas = M.slice(ini).map(r => { const g = (k) => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : ''; const f = { nombre: g('nombre'), email: g('email').toLowerCase(), empresa: val(cat.empresas, g('empresa')), puesto: val(cat.cargos, g('puesto')), disciplina: val(cat.disciplinas, g('disciplina')) }; const falta = [['empresa', g('empresa')], ['cargo', g('puesto')], ['disciplina', g('disciplina')]].filter((x, i) => x[1] && ![f.empresa, f.puesto, f.disciplina][i]).map(x => x[0] + ' «' + x[1] + '»'); if (falta.length) f.error = 'No está en el catálogo: ' + falta.join(', ') + '. Elígelo en la lista o agrégalo con «＋ Agregar otro…».'; return f; }).filter(f => /@/.test(f.email));
        if (!nuevas.length) return N.toast('No encontré filas con correo electrónico.', 'mal');
        filas = filas.filter(f => (f.email || '').trim() || (f.nombre || '').trim()).concat(nuevas); pinta(); N.toast(nuevas.length + ' fila(s) cargadas. Revísalas y pulsa «Añadir usuarios».', 'bien');
      };
      pinta();
    };

    // ── editar / quitar ──
    app.querySelectorAll('.puntos[data-q]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const email = b.dataset.q; N.menuFlotante(b, [{ texto: 'Editar usuario', accion: () => {
      const m = p.miembros.find(x => x.email === email);
      const sel = (idc, L, val, lista) => '<select id="' + idc + '" data-l="' + lista + '"><option value="">Seleccionar…</option>' + L.map(x => '<option value="' + esc(x.nombre) + '"' + (llano(x.nombre) === llano(val) ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('') + '</select>';
      const v = N.ventana('Editar usuario', '<div class="pista mono" style="margin-bottom:6px">' + esc(email) + '</div><label>Nombres y apellidos</label><input id="eNom" value="' + esc(m.nombre || '') + '">' +
        '<div class="fila"><div style="flex:1"><label>Empresa</label>' + sel('eEmp', cat.empresas, m.empresa, 'empresas') + '</div><div style="flex:1"><label>Cargo</label>' + sel('ePue', cat.cargos, m.puesto, 'cargos') + '</div><div style="flex:1.4"><label>Disciplina / Especialidad</label>' + sel('eDis', cat.disciplinas, m.disciplina, 'disciplinas') + '</div></div>' +
        '<div class="fila"><div style="flex:1"><label>Acceso al CDE</label><select id="eRol">' + ACCESOS.map(a => '<option value="' + a[0] + '"' + (a[0] === m.rol ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select></div><div style="flex:1"><label>Organización (dueña de carpetas y correos)</label><input id="eOrg" value="' + esc(m.organizacion || '') + '" list="dlOrgs"><datalist id="dlOrgs">' + (p.organizaciones || []).map(o => '<option value="' + esc(o) + '">').join('') + '</datalist></div><div style="flex:1"><label>Papel en las revisiones</label><input id="eCargo" list="dlCargos" value="' + esc(m.cargo || '') + '" placeholder="DC · ESPECIALISTA · KP1 · GP"><datalist id="dlCargos"><option value="DC">Document Control</option><option value="ESPECIALISTA">Especialista</option><option value="KP1">Decide por la Supervisión</option><option value="GP">Gerente de Proyecto</option></datalist></div>' + selGrupo('eGrupo', m.grupo) + '</div>' +
        '<div class="fila" style="justify-content:flex-end;gap:8px;margin-top:14px"><button id="eNo">Cancelar</button><button class="primario" id="eOk">Guardar</button></div><div id="eMsg"></div>', { ancho: 940, alto: 400 });
      v.querySelector('#eNo').onclick = () => v.closest('.ventana').remove();
      v.querySelector('#eOk').onclick = async () => { try { const b = { email, nombre: v.querySelector('#eNom').value, rol: v.querySelector('#eRol').value, organizacion: v.querySelector('#eOrg').value, cargo: v.querySelector('#eCargo').value.trim().toUpperCase(), grupo: v.querySelector('#eGrupo').value }; const em = v.querySelector('#eEmp').value, pu = v.querySelector('#ePue').value, di = v.querySelector('#eDis').value; if (em || pu || di) Object.assign(b, { empresa: em, puesto: pu, disciplina: di }); await api('/api/proyectos/' + pid + '/miembros', { json: b }); v.closest('.ventana').remove(); vistaMiembros(pid); } catch (err) { aviso(v.querySelector('#eMsg'), err); } };
    } }, { texto: 'Quitar del proyecto', peligro: true, accion: async () => { if (!confirm('¿Quitar a ' + email + ' del proyecto?')) return; await api('/api/proyectos/' + pid + '/miembros/' + encodeURIComponent(email), { method: 'DELETE' }); vistaMiembros(pid); } }], 'derecha'); });
  }
  N.vistas.miembros = vistaMiembros;
})();
