/*
 * GIS: shapefile, GeoJSON y KML sobre el modelo
 * ----------------------------------------------
 * Pensado para proyectos lineales: ejes de via, redes, servidumbres, predios.
 * Dibuja la geometria dentro del visor, en las coordenadas del modelo, para que
 * se pueda comparar con lo modelado sin salir a otra herramienta.
 *
 * Formatos:
 *   .shp (+ .dbf, + .prj)  shapefile; se leen los tres a la vez si los sueltas juntos
 *   .geojson / .json       GeoJSON
 *   .kml                   KML (el KMZ hay que descomprimirlo antes)
 *
 * El shapefile se lee a mano. Es un formato binario documentado y sencillo
 * (cabecera de 100 bytes y registros con un tipo y una lista de puntos), asi que
 * sale mas barato leerlo que arrastrar una libreria y su cadena de dependencias.
 *
 * Sobre coordenadas: el visor ya sabe emplazar el modelo en UTM, y aqui se
 * reutiliza ese mismo emplazamiento. Si el shapefile viene en grados
 * (geograficas), se proyecta a UTM antes de dibujar; si ya viene en UTM, se usa
 * tal cual. Lo que NO se hace es adivinar el datum: si el .prj dice algo raro se
 * avisa, porque un metro de error en una servidumbre no es un detalle.
 */

let GIS = { capas: [], overlay: 'gis-capas' };

// ---------- Entrada ----------

function abreGis() {
  const i = document.createElement('input');
  i.type = 'file';
  i.multiple = true;      // shp + dbf + prj van juntos
  i.accept = '.shp,.dbf,.prj,.shx,.idx,.cpg,.geojson,.json,.topojson,.kml,.kmz,.gpx';
  i.onchange = async () => {
    const fs = [...(i.files || [])];
    if (!fs.length) return;
    busy(true, 'Leyendo el archivo GIS...');
    try {
      const shp = fs.find(f => /\.shp$/i.test(f.name));
      if (shp) {
        const base = shp.name.replace(/\.shp$/i, '');
        const dbf = fs.find(f => new RegExp('^' + escapaRx(base) + '\\.dbf$', 'i').test(f.name));
        const prj = fs.find(f => new RegExp('^' + escapaRx(base) + '\\.prj$', 'i').test(f.name));
        await cargaShape(shp, dbf, prj);
      } else {
        for (const f of fs) {
          if (/\.(dbf|prj|shx|cpg|idx)$/i.test(f.name)) {
            // v1.199: sin .shp en la seleccion, un acompanante suelto ya no se
            // ignora en silencio: se ABRE su contenido.
            gisFicha(f.name, await f.arrayBuffer(), null);
            continue;
          }
          let geos = null;
          if (/\.kmz$/i.test(f.name)) geos = await leeKmz(await f.arrayBuffer());
          else if (/\.kml$/i.test(f.name)) geos = leeKml(await f.text());
          else if (/\.gpx$/i.test(f.name)) geos = leeGpx(await f.text());
          else {
            const j = JSON.parse(await f.text());
            geos = leeGeoJson(j);
          }
          if (!geos || !geos.length) throw new Error('"' + f.name + '" no trae geometria legible');
          agregaCapa(f.name, geos, 'grados');
        }
      }
      $('gisWin').classList.remove('hidden');
      pintaCapas();
      dibujaGis();
    } catch (e) {
      alert('No se pudo leer: ' + e.message);
    }
    busy(false);
  };
  i.click();
}

const escapaRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Shapefile ----------

async function cargaShape(shp, dbf, prj) {
  const buf = await shp.arrayBuffer();
  const geos = leeShp(buf);
  if (!geos.length) throw new Error('el shapefile no trae geometria legible');

  let atributos = null;
  if (dbf) { try { atributos = leeDbf(await dbf.arrayBuffer()); } catch (e) {} }
  if (atributos) geos.forEach((g, i) => { g.attr = atributos[i] || {}; });

  let sistema = 'utm';
  if (prj) {
    const t = await prj.text();
    sistema = sistemaDePrj(t);          // grados | utm | webmerc
    const zona = t.match(/UTM\s*zone\s*(\d+)\s*([NS])/i);
    if (zona && typeof utmZona !== 'undefined' && +zona[1] !== utmZona) {
      alert(`La capa esta en la zona UTM ${zona[1]}${zona[2]} y el modelo se emplaza ` +
            `en la ${utmZona}${utmSur ? 'S' : 'N'}.\n\n` +
            'Se dibujara igualmente, pero comprueba el emplazamiento: una zona ' +
            'equivocada desplaza la capa cientos de kilometros.');
    }
    if (!/WGS[_ ]?1?984|SIRGAS|PSAD/i.test(t)) {
      console.warn('[GIS] Datum no reconocido en el .prj; revisa el emplazamiento.');
    }
  }
  // Sin .prj —o con uno que solo dice PROJCS— manda el RANGO.
  if (sistema === 'utm' && geos[0] && geos[0].partes[0] && geos[0].partes[0][0]) {
    const porRango = sistemaPorRango(geos[0].partes[0][0]);
    if (porRango !== 'utm') sistema = porRango;
  }
  agregaCapa(shp.name, geos, sistema);
}

/** Cabecera de 100 bytes y luego registros. Todo big-endian salvo lo indicado. */
function leeShp(buf) {
  const v = new DataView(buf);
  if (v.getInt32(0, false) !== 9994) throw new Error('no parece un .shp');
  const fin = v.getInt32(24, false) * 2;      // longitud en palabras de 16 bits
  const out = [];
  let p = 100;

  while (p + 8 <= fin && p + 8 <= buf.byteLength) {
    const largo = v.getInt32(p + 4, false) * 2;
    const tipo = v.getInt32(p + 8, true);
    const d = p + 12;

    if (tipo === 1 || tipo === 11 || tipo === 21) {           // punto
      out.push({ tipo: 'punto', partes: [[[v.getFloat64(d, true), v.getFloat64(d + 8, true)]]] });
    } else if (tipo === 8 || tipo === 18 || tipo === 28) {     // multipunto
      // Faltaba: una capa de puntos guardada como MultiPoint (pozos, postes,
      // buzones agrupados) se leia como cero geometrias y la capa salia vacia.
      const nPuntos = v.getInt32(d + 32, true);
      const ini = d + 36;
      for (let i = 0; i < nPuntos; i++) {
        out.push({ tipo: 'punto',
                   partes: [[[v.getFloat64(ini + i * 16, true),
                              v.getFloat64(ini + i * 16 + 8, true)]]] });
      }
    } else if (tipo === 3 || tipo === 5 || tipo === 13 || tipo === 15 ||
               tipo === 23 || tipo === 25) {                   // linea o poligono
      const nPartes = v.getInt32(d + 32, true);
      const nPuntos = v.getInt32(d + 36, true);
      const iniPartes = d + 40;
      const iniPuntos = iniPartes + nPartes * 4;
      const cortes = [];
      for (let i = 0; i < nPartes; i++) cortes.push(v.getInt32(iniPartes + i * 4, true));
      cortes.push(nPuntos);
      const partes = [];
      for (let i = 0; i < nPartes; i++) {
        const pts = [];
        for (let j = cortes[i]; j < cortes[i + 1]; j++) {
          pts.push([v.getFloat64(iniPuntos + j * 16, true),
                    v.getFloat64(iniPuntos + j * 16 + 8, true)]);
        }
        if (pts.length > 1) partes.push(pts);
      }
      if (partes.length) {
        out.push({ tipo: (tipo === 5 || tipo === 15 || tipo === 25) ? 'poligono' : 'linea', partes });
      }
    }
    p += 8 + largo;
  }
  return out;
}

/** dBase III: cabecera con la definicion de campos y luego registros de texto. */
function leeDbf(buf) {
  const v = new DataView(buf);
  const nReg = v.getInt32(4, true);
  const iniDatos = v.getInt16(8, true);
  const largoReg = v.getInt16(10, true);
  const campos = [];
  for (let p = 32; v.getUint8(p) !== 0x0d && p < iniDatos; p += 32) {
    let n = '';
    for (let i = 0; i < 11; i++) {
      const c = v.getUint8(p + i);
      if (!c) break;
      n += String.fromCharCode(c);
    }
    campos.push({ n, largo: v.getUint8(p + 16) });
  }
  const dec = new TextDecoder('latin1');
  const out = [];
  for (let r = 0; r < nReg; r++) {
    let p = iniDatos + r * largoReg + 1;      // +1: marca de borrado
    if (p + largoReg > buf.byteLength) break;
    const o = {};
    for (const c of campos) {
      o[c.n] = dec.decode(new Uint8Array(buf, p, c.largo)).trim();
      p += c.largo;
    }
    out.push(o);
  }
  return out;
}

/*
 * v1.199 — VER EL CONTENIDO DE LOS ACOMPANANTES (a pedido). Un shapefile no
 * es un archivo sino una FAMILIA, y cada miembro guarda una cosa distinta:
 *   .shp  la geometria           .dbf  la tabla de atributos
 *   .shx  el indice de registros .prj  el sistema de coordenadas (texto)
 *   .cpg  la codificacion        .idx  indice propietario de ESRI
 * La ficha los abre con los MISMOS lectores que ya usa el visor para
 * dibujar (leeShp, leeDbf, sistemaDePrj): una sola verdad.
 */

/** El tipo de geometria de un shapefile, por su codigo oficial. Pura. */
function gisTipoShp(c) {
  const t = { 0: 'Nulo', 1: 'Punto', 3: 'Linea', 5: 'Poligono', 8: 'Multipunto',
    11: 'Punto Z', 13: 'Linea Z', 15: 'Poligono Z', 18: 'Multipunto Z',
    21: 'Punto M', 23: 'Linea M', 25: 'Poligono M', 28: 'Multipunto M',
    31: 'MultiParche' };
  return t[c] || ('desconocido (codigo ' + c + ')');
}

/** La cabecera de 100 bytes, comun a .shp y .shx (big endian + little). Pura. */
function gisCabShp(buf) {
  if (!buf || buf.byteLength < 100) return null;
  const v = new DataView(buf);
  if (v.getInt32(0, false) !== 9994) return null;      // firma de shapefile
  return {
    bytes: v.getInt32(24, false) * 2,                  // la cabecera cuenta palabras
    tipo: v.getInt32(32, true),
    xmin: v.getFloat64(36, true), ymin: v.getFloat64(44, true),
    xmax: v.getFloat64(52, true), ymax: v.getFloat64(60, true),
  };
}

/** Lo que hay dentro de un archivo de la familia shapefile. Pura. */
function gisFichaDe(nombre, buf) {
  const ext = (String(nombre).split('.').pop() || '').toLowerCase();
  const f = { ext, lineas: [], tabla: null, texto: null, nota: '' };
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  f.lineas.push(['Archivo', nombre]);
  f.lineas.push(['Tamano', kb(buf.byteLength)]);

  if (ext === 'prj' || ext === 'cpg') {
    const txt = new TextDecoder('utf-8').decode(buf).trim();
    f.texto = txt;
    if (ext === 'prj') {
      const nom = /PROJCS\s*\[\s*"([^"]+)"/i.exec(txt) || /GEOGCS\s*\[\s*"([^"]+)"/i.exec(txt);
      const zona = /UTM[_ ]?zone[_ ]?(\d+)\s*([NS])/i.exec(txt);
      const uni = /UNIT\s*\[\s*"([^"]+)"/i.exec(txt);
      f.lineas.push(['Sistema declarado', nom ? nom[1] : '(sin nombre en el texto)']);
      if (zona) f.lineas.push(['Zona UTM', zona[1] + zona[2].toUpperCase()]);
      if (uni) f.lineas.push(['Unidad', uni[1]]);
      f.lineas.push(['Como lo lee el visor', sistemaDePrj(txt)]);
      f.nota = 'Este archivo es el que le dice al visor en que sistema estan las ' +
        'coordenadas del .shp hermano.';
    } else {
      f.lineas.push(['Codificacion declarada', txt || '(vacio)']);
      f.nota = 'Indica con que codificacion leer los textos del .dbf (tildes y enes).';
    }
    return f;
  }

  if (ext === 'dbf') {
    let regs = [];
    try { regs = leeDbf(buf) || []; } catch (e) { f.nota = 'No se pudo leer: ' + e.message; return f; }
    const cols = regs.length ? Object.keys(regs[0]) : [];
    f.lineas.push(['Registros', regs.length.toLocaleString('es-PE')]);
    f.lineas.push(['Campos', cols.length + (cols.length ? ': ' + cols.join(', ') : '')]);
    f.tabla = { cols, filas: regs };
    f.nota = 'Es la TABLA DE ATRIBUTOS del shapefile: una fila por geometria, en el ' +
      'mismo orden que el .shp.';
    return f;
  }

  const cab = gisCabShp(buf);
  if (ext === 'shp' || ext === 'shx') {
    if (!cab) { f.nota = 'No tiene la firma de un shapefile (¿archivo incompleto?).'; return f; }
    f.lineas.push(['Tipo de geometria', gisTipoShp(cab.tipo)]);
    f.lineas.push(['Extension (bbox)', 'X ' + cab.xmin.toFixed(3) + ' a ' + cab.xmax.toFixed(3) +
      '  ·  Y ' + cab.ymin.toFixed(3) + ' a ' + cab.ymax.toFixed(3)]);
    f.lineas.push(['Sistema por el rango', sistemaPorRango([cab.xmin, cab.ymin])]);
    if (cab.bytes !== buf.byteLength)
      f.lineas.push(['OJO', 'la cabecera declara ' + kb(cab.bytes) + ' y llegaron ' +
        kb(buf.byteLength) + ': archivo incompleto']);
    if (ext === 'shx') {
      f.lineas.push(['Registros indexados', Math.max(0, Math.floor((buf.byteLength - 100) / 8))]);
      f.nota = 'Es el INDICE del .shp: dice en que byte empieza cada geometria. El visor ' +
        'no lo necesita (recorre el .shp entero), pero ArcGIS y QGIS lo usan para ir rapido.';
    } else {
      let geos = [];
      try { geos = leeShp(buf) || []; } catch (e) {}
      const cuenta = {};
      for (const x of geos) cuenta[x.tipo] = (cuenta[x.tipo] || 0) + 1;
      f.lineas.push(['Geometrias leidas', geos.length + (geos.length
        ? ' (' + Object.entries(cuenta).map(([k, n]) => n + ' ' + k).join(', ') + ')' : '')]);
      f.nota = 'Es la GEOMETRIA. Marcalo directamente para dibujarlo como capa sobre el modelo.';
    }
    return f;
  }

  f.nota = 'Es un indice propietario de ESRI (' + ext + '): guarda posiciones para acelerar ' +
    'busquedas, no datos del proyecto. Ni el visor ni QGIS lo necesitan; se puede no subir.';
  return f;
}

function gisPintaFicha(nombre, ficha, extras) {
  const win = $('gisFichaWin');
  if (!win) return;
  $('gisFichaTit').textContent = 'Contenido · ' + nombre;
  const filas = (ficha.tabla && ficha.tabla.filas) || [];
  const cols = (ficha.tabla && ficha.tabla.cols) || [];
  const vista = filas.slice(0, 2000);
  $('gisFichaCuerpo').innerHTML =
    '<table class="tstabla"><tbody>' + ficha.lineas.map(([k, v]) =>
      '<tr><td class="tsnom">' + esc(k) + '</td><td>' + esc(String(v)) + '</td></tr>').join('') +
    '</tbody></table>' +
    (ficha.nota ? '<div class="hint" style="margin:6px 0">' + esc(ficha.nota) + '</div>' : '') +
    (ficha.texto != null
      ? '<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;' +
        'background:#0d141b;border:1px solid #232c34;border-radius:6px;padding:8px">' +
        esc(ficha.texto) + '</pre>'
      : '') +
    (cols.length
      ? '<table class="tstabla"><thead><tr><th>#</th>' +
        cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        vista.map((r, i) => '<tr><td class="tsnom">' + (i + 1) + '</td>' +
          cols.map(c => '<td>' + esc(String(r[c] ?? '')) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>' +
        (filas.length > vista.length
          ? '<div class="hint">Se ensenan 2.000 de ' + filas.length.toLocaleString('es-PE') +
            ': baja el CSV para el resto.</div>' : '')
      : '');
  const bCsv = $('gisFichaCsv');
  bCsv.classList.toggle('hidden', !cols.length);
  bCsv.onclick = () => {
    const col = (v) => '"' + String(v ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
    const txt = [cols.map(col).join(';')]
      .concat(filas.map(r => cols.map(c => col(r[c])).join(';'))).join('\n');
    const b = new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = nombre.replace(/[^\w.-]+/g, '_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const bCapa = $('gisFichaCapa');
  bCapa.classList.toggle('hidden', !extras || !extras.cargar);
  if (extras && extras.cargar) {
    bCapa.textContent = 'Cargar la capa (' + (extras.nombreCapa || '.shp hermano') + ')';
    bCapa.onclick = () => { win.classList.add('hidden'); extras.cargar(); };
  }
  win.classList.remove('hidden');
}

/** Abre la ficha de un archivo de la familia shapefile. */
function gisFicha(nombre, buf, extras) {
  try { gisPintaFicha(nombre, gisFichaDe(nombre, buf), extras); }
  catch (e) { alert('No se pudo leer "' + nombre + '": ' + e.message); }
}

/* ----------------------------------------------------------------------------
 * BASES SQLITE CON GEOMETRIA: .sqlite de InfraWorks, .imx, GeoPackage
 *
 * Ni el .sqlite nativo de InfraWorks ni el .imx tienen derivado de
 * visualizacion en Forma (por eso dan 404 al intentar federarlos): no son
 * formatos que la plataforma traduzca. Pero los dos son, por dentro, BASES
 * SQLITE — el .imx guarda en tablas las geometrias 2.5D representativas
 * (huellas, ejes, superficies) y el .sqlite es el modelo nativo entero—, y
 * el visor ya lee SQLite en el navegador (sql.js del inspector). Asi que lo
 * que SI se puede hacer, y es mucho, es sacar sus geometrias y dibujarlas
 * como CAPAS sobre el modelo, con sus atributos.
 *
 * La geometria puede venir en tres codificaciones; se detecta por sus
 * primeros bytes y se leen las tres:
 *   WKB          el estandar (SpatiaLite, PostGIS, casi todo)
 *   GeoPackage   cabecera "GP" + envolvente y, dentro, WKB
 *   FGF          el binario de Autodesk FDO (el que usan .imx y .sqlite)
 * Lo que no encaje en ninguna se dice, no se adivina.
 */

/** Lee una geometria WKB desde dv[pos]. Devuelve {geo, fin} o null. Pura. */
function geomWkb(dv, pos) {
  if (pos + 5 > dv.byteLength) return null;
  const little = dv.getUint8(pos) === 1;
  let tipo = dv.getUint32(pos + 1, little);
  let p = pos + 5;
  const zEwkb = !!(tipo & 0x80000000), mEwkb = !!(tipo & 0x40000000);
  if (tipo & 0x20000000) p += 4;                       // SRID embebido (EWKB)
  tipo = tipo & 0xffff;
  const alto = tipo > 3000 ? 3000 : tipo > 2000 ? 2000 : tipo > 1000 ? 1000 : 0;
  const base = tipo - alto;
  const dims = 2 + ((zEwkb || alto === 1000 || alto === 3000) ? 1 : 0) +
                   ((mEwkb || alto === 2000 || alto === 3000) ? 1 : 0);
  const paso = dims * 8;
  const punto = () => {
    const c = [dv.getFloat64(p, little), dv.getFloat64(p + 8, little)];
    p += paso;
    return c;
  };
  const tira = () => {
    const n = dv.getUint32(p, little); p += 4;
    if (p + n * paso > dv.byteLength) return null;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(punto());
    return pts;
  };
  if (base === 1) {
    if (p + paso > dv.byteLength) return null;
    return { geo: { tipo: 'punto', partes: [[punto()]] }, fin: p };
  }
  if (base === 2) {
    const pts = tira();
    return pts && pts.length > 1 ? { geo: { tipo: 'linea', partes: [pts] }, fin: p } : null;
  }
  if (base === 3) {
    const nA = dv.getUint32(p, little); p += 4;
    const partes = [];
    for (let i = 0; i < nA; i++) { const a = tira(); if (!a) return null; if (a.length > 2) partes.push(a); }
    return partes.length ? { geo: { tipo: 'poligono', partes }, fin: p } : null;
  }
  if (base >= 4 && base <= 7) {
    const n = dv.getUint32(p, little); p += 4;
    const partes = [];
    let tipoHijo = 'punto';
    for (let i = 0; i < n; i++) {
      const h = geomWkb(dv, p);
      if (!h) return null;
      p = h.fin;
      tipoHijo = h.geo.tipo;
      for (const parte of h.geo.partes) partes.push(parte);
    }
    return partes.length ? { geo: { tipo: tipoHijo, partes }, fin: p } : null;
  }
  return null;
}

/** Lee una geometria FGF (Autodesk FDO). Devuelve {geo, fin} o null. Pura. */
function geomFgf(dv, pos) {
  if (pos + 8 > dv.byteLength) return null;
  const tipo = dv.getInt32(pos, true);
  const dim = dv.getInt32(pos + 4, true);
  if (tipo < 1 || tipo > 7 || dim < 0 || dim > 3) return null;
  const dims = 2 + (dim === 1 || dim === 3 ? 1 : 0) + (dim === 2 || dim === 3 ? 1 : 0);
  const paso = dims * 8;
  let p = pos + 8;
  const punto = () => { const c = [dv.getFloat64(p, true), dv.getFloat64(p + 8, true)]; p += paso; return c; };
  const tira = () => {
    if (p + 4 > dv.byteLength) return null;
    const n = dv.getInt32(p, true); p += 4;
    if (n < 0 || p + n * paso > dv.byteLength) return null;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(punto());
    return pts;
  };
  if (tipo === 1) {
    if (p + paso > dv.byteLength) return null;
    return { geo: { tipo: 'punto', partes: [[punto()]] }, fin: p };
  }
  if (tipo === 2) {
    const pts = tira();
    return pts && pts.length > 1 ? { geo: { tipo: 'linea', partes: [pts] }, fin: p } : null;
  }
  if (tipo === 3) {
    if (p + 4 > dv.byteLength) return null;
    const nA = dv.getInt32(p, true); p += 4;
    const partes = [];
    for (let i = 0; i < nA; i++) { const a = tira(); if (!a) return null; if (a.length > 2) partes.push(a); }
    return partes.length ? { geo: { tipo: 'poligono', partes }, fin: p } : null;
  }
  if (p + 4 > dv.byteLength) return null;
  const n = dv.getInt32(p, true); p += 4;         // 4,5,6,7: coleccion de hijos
  const partes = [];
  let tipoHijo = 'punto';
  for (let i = 0; i < n; i++) {
    const h = geomFgf(dv, p);
    if (!h) return null;
    p = h.fin;
    tipoHijo = h.geo.tipo;
    for (const parte of h.geo.partes) partes.push(parte);
  }
  return partes.length ? { geo: { tipo: tipoHijo, partes }, fin: p } : null;
}

/** Que codificacion trae el blob y que geometria hay dentro. Pura. */
function geomDeBlob(u8) {
  if (!u8 || u8.length < 9) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // GeoPackage: "GP" + version + banderas; la envolvente va antes del WKB.
  if (u8[0] === 0x47 && u8[1] === 0x50) {
    const banderas = u8[3];
    const env = (banderas >> 1) & 7;
    const bytesEnv = [0, 32, 48, 48, 64][env] || 0;
    const r = geomWkb(dv, 8 + bytesEnv);
    return r ? r.geo : null;
  }
  if (u8[0] === 0x00 || u8[0] === 0x01) {          // WKB a secas
    const r = geomWkb(dv, 0);
    if (r) return r.geo;
  }
  const f = geomFgf(dv, 0);                        // FGF de Autodesk
  return f ? f.geo : null;
}

/** Saca capas dibujables de una base SQLite (InfraWorks, IMX, GeoPackage). */
async function leeCapasSqlite(buf, tope) {
  const SQL = await cargaSqlJs();
  const db = new SQL.Database(new Uint8Array(buf));
  const TOPE = tope || 20000;
  const out = { capas: [], tablas: [], diag: [] };
  const esc = (n) => '"' + String(n).replace(/"/g, '""') + '"';
  try {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const nombres = r.length ? r[0].values.map(v => String(v[0])) : [];
    out.diag.push(nombres.length + ' tabla(s) en la base');
    // Las tablas de metadatos dicen donde esta la geometria, si las hay.
    const declaradas = new Map();
    for (const meta of ['gpkg_geometry_columns', 'geometry_columns']) {
      if (!nombres.includes(meta)) continue;
      try {
        const q = db.exec('SELECT * FROM ' + esc(meta));
        if (!q.length) continue;
        const cols = q[0].columns.map(c => c.toLowerCase());
        const iT = cols.findIndex(c => /table_name|f_table_name/.test(c));
        const iC = cols.findIndex(c => /column_name|f_geometry_column/.test(c));
        if (iT < 0 || iC < 0) continue;
        for (const v of q[0].values) declaradas.set(String(v[iT]), String(v[iC]));
        out.diag.push(meta + ': ' + q[0].values.length + ' tabla(s) con geometria declarada');
      } catch (e) {}
    }
    for (const n of nombres) {
      if (/^(sqlite_|gpkg_|rtree_|spatial_ref|geometry_columns|views_|virts_|idx_)/i.test(n)) continue;
      let total = 0, cols = [], fila0 = null;
      try {
        const c = db.exec('SELECT COUNT(*) FROM ' + esc(n));
        total = c.length ? c[0].values[0][0] : 0;
        const q = db.exec('SELECT * FROM ' + esc(n) + ' LIMIT 1');
        if (q.length) { cols = q[0].columns; fila0 = q[0].values[0]; }
      } catch (e) { continue; }
      out.tablas.push({ nombre: n, total, cols });
      if (!total || !fila0) continue;
      // La columna de geometria: la declarada, o la primera que PARSEE.
      let iGeo = -1;
      const dec = declaradas.get(n);
      if (dec) iGeo = cols.findIndex(c => c.toLowerCase() === dec.toLowerCase());
      if (iGeo < 0) {
        for (let i = 0; i < cols.length; i++) {
          const v = fila0[i];
          if (v instanceof Uint8Array && geomDeBlob(v)) { iGeo = i; break; }
        }
      }
      if (iGeo < 0) continue;
      let geos = [], malos = 0;
      try {
        const q = db.exec('SELECT * FROM ' + esc(n) + ' LIMIT ' + TOPE);
        if (q.length) {
          for (const v of q[0].values) {
            const g = (v[iGeo] instanceof Uint8Array) ? geomDeBlob(v[iGeo]) : null;
            if (!g) { malos++; continue; }
            const attr = {};
            q[0].columns.forEach((c, i) => {
              if (i !== iGeo && !(v[i] instanceof Uint8Array)) attr[c] = v[i];
            });
            g.attr = attr;
            geos.push(g);
          }
        }
      } catch (e) { out.diag.push(n + ': ' + e.message); continue; }
      if (geos.length) {
        out.capas.push({ tabla: n, geos, total });
        out.diag.push(n + ': ' + geos.length + ' geometria(s)' +
          (malos ? ' (' + malos + ' ilegibles)' : '') +
          (total > TOPE ? ' de ' + total + ' filas (tope ' + TOPE + ')' : ''));
      } else if (malos) out.diag.push(n + ': ' + malos + ' blob(s) de geometria no reconocidos');
    }
  } finally { db.close(); }
  return out;
}

// ---------- GeoJSON y KML ----------

function leeGeoJson(j) {
  const out = [];
  const mete = (g, attr) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') return (g.geometries || []).forEach(x => mete(x, attr));
    const t = g.type, c = g.coordinates;
    if (t === 'Point') out.push({ tipo: 'punto', partes: [[c]], attr });
    else if (t === 'MultiPoint') c.forEach(p => out.push({ tipo: 'punto', partes: [[p]], attr }));
    else if (t === 'LineString') out.push({ tipo: 'linea', partes: [c], attr });
    else if (t === 'MultiLineString') out.push({ tipo: 'linea', partes: c, attr });
    else if (t === 'Polygon') out.push({ tipo: 'poligono', partes: c, attr });
    else if (t === 'MultiPolygon') c.forEach(p => out.push({ tipo: 'poligono', partes: p, attr }));
  };
  if (j.type === 'FeatureCollection') (j.features || []).forEach(f => mete(f.geometry, f.properties || {}));
  else if (j.type === 'Feature') mete(j.geometry, j.properties || {});
  else mete(j, {});
  return out;
}

/*
 * KML, con los COLORES del propio archivo.
 *
 * Dos cambios frente a la version anterior, y los dos van al mismo sitio: que
 * la capa se vea COMO SE VE en Google Earth o QGIS.
 *
 *   1. Los elementos se buscan por nombre LOCAL (getElementsByTagNameNS con
 *      comodin). Un KML exportado con prefijo (<kml:Placemark>) devolvia cero
 *      resultados con getElementsByTagName y el archivo salia vacio sin decir
 *      por que.
 *   2. Se leen <Style>, <StyleMap> y <styleUrl>: cada geometria se queda con
 *      SU color de linea y de relleno. Antes toda la capa iba de un color
 *      unico y un KML de zonificacion (cada uso un color) salia monocromo.
 */
const localTag = (raiz, nom) => [...raiz.getElementsByTagNameNS('*', nom)];

/** aabbggrr de KML -> {css, opacidad}. */
function colorKml(txt) {
  const t = String(txt || '').trim();
  if (!/^[0-9a-f]{8}$/i.test(t)) return null;
  const a = parseInt(t.slice(0, 2), 16) / 255;
  const b = t.slice(2, 4), g = t.slice(4, 6), r = t.slice(6, 8);
  return { css: '#' + r + g + b, op: a };
}

function estilosKml(doc) {
  const est = new Map();
  for (const st of localTag(doc, 'Style')) {
    const id = st.getAttribute('id');
    if (!id) continue;
    const linea = localTag(st, 'LineStyle')[0];
    const relle = localTag(st, 'PolyStyle')[0];
    const icono = localTag(st, 'IconStyle')[0];
    const c = (nodo) => {
      if (!nodo) return null;
      const c0 = localTag(nodo, 'color')[0];
      return c0 ? colorKml(c0.textContent) : null;
    };
    est.set('#' + id, { linea: c(linea) || c(icono), relleno: c(relle) });
  }
  // StyleMap: el estado "normal" apunta al Style de verdad.
  for (const sm of localTag(doc, 'StyleMap')) {
    const id = sm.getAttribute('id');
    if (!id) continue;
    for (const par of localTag(sm, 'Pair')) {
      const k = (localTag(par, 'key')[0] || {}).textContent || '';
      const u = (localTag(par, 'styleUrl')[0] || {}).textContent || '';
      if (/normal/i.test(k) && est.has(u.trim())) est.set('#' + id, est.get(u.trim()));
    }
  }
  return est;
}

function leeKml(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const est = estilosKml(doc);
  const out = [];
  for (const pm of localTag(doc, 'Placemark')) {
    const nom = (localTag(pm, 'name')[0] || {}).textContent || '';
    const url = ((localTag(pm, 'styleUrl')[0] || {}).textContent || '').trim();
    let stl = est.get(url) || null;
    if (!stl) {                       // <Style> escrito dentro del propio Placemark
      const propio = localTag(pm, 'Style')[0];
      if (propio) {
        const c = (n) => {
          const nodo = localTag(propio, n)[0];
          if (!nodo) return null;
          const c0 = localTag(nodo, 'color')[0];
          return c0 ? colorKml(c0.textContent) : null;
        };
        stl = { linea: c('LineStyle') || c('IconStyle'), relleno: c('PolyStyle') };
      }
    }
    const pinta = stl ? { color: stl.linea && stl.linea.css,
                          relleno: stl.relleno && stl.relleno.css,
                          opacidad: stl.relleno ? stl.relleno.op : undefined } : {};

    const lee = c => c.textContent.trim().split(/\s+/).map(s2 => {
      const p = s2.split(',').map(Number);
      return [p[0], p[1]];
    }).filter(p => isFinite(p[0]) && isFinite(p[1]));

    /*
     * Un Polygon se lee UNA vez, con cada anillo (exterior e interiores) como
     * PARTE propia. Antes el Polygon y sus LinearRing internos se emitian por
     * separado (dos pasadas sobre los mismos anillos) y los anillos de un
     * mismo poligono acababan encadenados: el "trazo hecho a mano" de tu KML
     * de cuencas era eso, lineas saltando de un anillo a otro.
     */
    for (const pg of localTag(pm, 'Polygon')) {
      const partes = localTag(pg, 'coordinates').map(lee).filter(p => p.length > 1);
      if (partes.length) out.push({ tipo: 'poligono', partes, attr: { nombre: nom }, ...pinta });
    }
    for (const ls of localTag(pm, 'LineString')) {
      const c = localTag(ls, 'coordinates')[0];
      if (!c) continue;
      const pts = lee(c);
      if (pts.length > 1) out.push({ tipo: 'linea', partes: [pts], attr: { nombre: nom }, ...pinta });
    }
    for (const lr of localTag(pm, 'LinearRing')) {
      let p = lr.parentNode, dentroDePg = false;
      while (p && p.nodeType === 1) {
        if (p.localName === 'Polygon') { dentroDePg = true; break; }
        p = p.parentNode;
      }
      if (dentroDePg) continue;                       // ya leido con su Polygon
      const c = localTag(lr, 'coordinates')[0];
      if (!c) continue;
      const pts = lee(c);
      if (pts.length > 1) out.push({ tipo: 'poligono', partes: [pts], attr: { nombre: nom }, ...pinta });
    }
    for (const pt of localTag(pm, 'Point')) {
      const c = localTag(pt, 'coordinates')[0];
      if (!c) continue;
      const pts = lee(c);
      if (pts.length) out.push({ tipo: 'punto', partes: [pts], attr: { nombre: nom }, ...pinta });
    }
  }
  return out;
}

// ---------- KMZ: un ZIP con un KML dentro ----------

/*
 * Lector de ZIP minimo, sin librerias.
 *
 * Un KMZ es un ZIP que lleva el KML (normalmente doc.kml) y sus recursos. El
 * codigo anterior lo decodificaba como texto y le hacia JSON.parse: de ahi el
 * "Unexpected token 'P', "PK\x03\x04..." is not valid JSON" — PK son las dos
 * primeras letras de TODO archivo ZIP.
 *
 * Se lee el DIRECTORIO CENTRAL (al final del archivo), que es donde el ZIP
 * dice que trae y donde esta cada cosa. Para descomprimir se usa
 * DecompressionStream, que ya viene en el navegador: nada de arrastrar una
 * libreria de 100 KB para leer un KMZ.
 */
async function leeZip(buf) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // Fin del directorio central (EOCD): 0x06054b50. Se busca hacia atras.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no parece un ZIP/KMZ valido');
  const nEnt = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);          // inicio del directorio central

  const salida = new Map();
  for (let i = 0; i < nEnt && p + 46 <= buf.byteLength; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const compLen = v.getUint32(p + 20, true);
    const nomLen = v.getUint16(p + 28, true);
    const extLen = v.getUint16(p + 30, true);
    const comLen = v.getUint16(p + 32, true);
    const desplaz = v.getUint32(p + 42, true);
    const nombre = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nomLen));
    p += 46 + nomLen + extLen + comLen;

    // La cabecera LOCAL dice el tamano real de SUS campos variables.
    if (v.getUint32(desplaz, true) !== 0x04034b50) continue;
    const lNom = v.getUint16(desplaz + 26, true);
    const lExt = v.getUint16(desplaz + 28, true);
    const ini = desplaz + 30 + lNom + lExt;
    const crudo = u8.subarray(ini, ini + compLen);
    salida.set(nombre, { metodo, crudo });
  }
  return salida;
}

async function descomprime(ent) {
  if (ent.metodo === 0) return ent.crudo;                    // guardado tal cual
  if (ent.metodo !== 8) throw new Error('compresion ZIP no soportada (metodo ' + ent.metodo + ')');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('este navegador no sabe descomprimir ZIP. Descomprime el KMZ ' +
                    'y carga el .kml que lleva dentro.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const flujo = new Blob([ent.crudo]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** El KML que lleva dentro un KMZ. */
async function leeKmz(buf) {
  const zip = await leeZip(buf);
  // doc.kml es el nombre de norma; si no esta, vale el primer .kml que haya.
  let clave = [...zip.keys()].find(k => /(^|\/)doc\.kml$/i.test(k)) ||
              [...zip.keys()].find(k => /\.kml$/i.test(k));
  if (!clave) throw new Error('el KMZ no lleva ningun .kml dentro');
  const bytes = await descomprime(zip.get(clave));
  return leeKml(new TextDecoder('utf-8').decode(bytes));
}

// ---------- GPX: trazas y waypoints de GPS ----------

/*
 * GPX es lo que sale de un GPS de campo y de casi cualquier app de topografia
 * ligera. Es XML y siempre en grados WGS84, asi que se lee igual que el KML.
 */
function leeGpx(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const out = [];
  const pt = (n) => [parseFloat(n.getAttribute('lon')), parseFloat(n.getAttribute('lat'))];
  const nombreDe = (n) => (localTag(n, 'name')[0] || {}).textContent || '';

  for (const trk of localTag(doc, 'trk')) {
    for (const seg of localTag(trk, 'trkseg')) {
      const pts = localTag(seg, 'trkpt').map(pt).filter(c => isFinite(c[0]) && isFinite(c[1]));
      if (pts.length > 1) out.push({ tipo: 'linea', partes: [pts], attr: { nombre: nombreDe(trk) } });
    }
  }
  for (const rte of localTag(doc, 'rte')) {
    const pts = localTag(rte, 'rtept').map(pt).filter(c => isFinite(c[0]) && isFinite(c[1]));
    if (pts.length > 1) out.push({ tipo: 'linea', partes: [pts], attr: { nombre: nombreDe(rte) } });
  }
  for (const wp of localTag(doc, 'wpt')) {
    const c = pt(wp);
    if (isFinite(c[0]) && isFinite(c[1]))
      out.push({ tipo: 'punto', partes: [[c]], attr: { nombre: nombreDe(wp) } });
  }
  return out;
}

// ---------- Proyeccion ----------

/*
 * WEB MERCATOR (EPSG:3857) a grados.
 *
 * Esta es la explicacion de los 13.819 km de tu DREN_EXISTENTE.shp. Piura en
 * Web Mercator cae cerca de (-8.972.000, -580.000); leidos como si fueran UTM
 * y comparados con un modelo en 17S, la distancia da justo eso. La capa no
 * estaba mal: estaba en otro sistema y nadie lo miraba. Es el sistema en el
 * que exportan casi todos los visores web, asi que aparece a menudo.
 */
const R_MERC = 6378137;

function webMercAGrados(x, y) {
  return [x * 180 / (Math.PI * R_MERC),
          (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * 180 / Math.PI];
}

/** Que sistema declara un .prj. */
function sistemaDePrj(t) {
  const txt = String(t || '');
  if (/mercator_auxiliary_sphere|popular[_ ]?visualisation|web[_ ]?mercator|pseudo[- ]?mercator|3857|900913/i.test(txt))
    return 'webmerc';
  if (/GEOGCS/i.test(txt) && !/PROJCS/i.test(txt)) return 'grados';
  return 'utm';
}

/*
 * Sin .prj, el sistema se deduce del RANGO de la primera coordenada:
 *   |x| <= 180          grados
 *   |x| <= 1.000.000    UTM (el Este va de 100.000 a 900.000)
 *   mas alla            Web Mercator (llega a 20.037.508)
 * Antes solo habia dos casos y todo lo grande caia en "UTM".
 */
function sistemaPorRango(p) {
  // El == null va DELANTE a proposito: isFinite(null) devuelve true porque null
  // se convierte en 0, y una coordenada vacia acababa clasificada como grados.
  if (!p || p[0] == null || p[1] == null || !isFinite(p[0]) || !isFinite(p[1])) return 'utm';
  const x = Math.abs(p[0]), y = Math.abs(p[1]);
  if (x <= 180 && y <= 90) return 'grados';
  if (x <= 1000000 && y <= 10000001) return 'utm';
  return 'webmerc';
}


/**
 * Grados a UTM (WGS84). Formulas de Karney simplificadas, suficientes para
 * situar una capa sobre el modelo: el error propio del metodo esta por debajo
 * del centimetro dentro de la zona.
 */
function aUtm(lon, lat, zonaForzada) {
  const a = 6378137, f = 1 / 298.257223563;
  const e2 = f * (2 - f), n = f / (2 - f);
  const zona = zonaForzada || Math.floor((lon + 180) / 6) + 1;
  const lon0 = (zona - 1) * 6 - 180 + 3;
  const r = Math.PI / 180;
  const phi = lat * r, dl = (lon - lon0) * r;

  const t = Math.sinh(Math.atanh(Math.sin(phi)) -
            (2 * Math.sqrt(n) / (1 + n)) * Math.atanh(2 * Math.sqrt(n) / (1 + n) * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));

  const A = a / (1 + n) * (1 + n * n / 4 + n * n * n * n / 64);
  const al = [n / 2 - 2 * n * n / 3 + 5 * n * n * n / 16,
              13 * n * n / 48 - 3 * n * n * n / 5,
              61 * n * n * n / 240];
  let x = eta, y = xi;
  for (let j = 1; j <= 3; j++) {
    x += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { e: 0.9996 * A * x + 500000,
           n: 0.9996 * A * y + (lat < 0 ? 10000000 : 0),
           zona };
}

/**
 * De coordenadas UTM a las del visor.
 *
 * El visor ya trabaja emplazado: modeloUTM() define que las coordenadas UTM son
 * (posicion en el visor + desplazamiento global) x escala de unidad. Aqui se
 * despeja al reves. Se reutiliza ese mismo emplazamiento a proposito, para que
 * la capa GIS y la imagen satelital caigan exactamente igual y no haya dos
 * verdades sobre donde esta la obra.
 */
function utmAModelo(e, n) {
  if (!models.length) return null;
  const u = uScale();
  /*
   * Si el modelo no viene en UTM (coordenadas internas del proyecto), el
   * ORIGEN MANUAL manda: el usuario escribe una vez el Este/Norte del punto
   * base y la capa cae donde toca. Queda guardado en la sesion.
   */
  // v1.269: el origen manual SOLO si el modelo no esta en UTM (asi lo muestra el
  // panel: con modelo en UTM la fila del origen se oculta). Un origen guardado
  // de antes ya no desvia las capas de un modelo que si esta en UTM.
  if (session.gisOrigen && isFinite(session.gisOrigen.e) && !gisModeloEnUtm()) {
    return { x: (e - session.gisOrigen.e) / u, y: (n - session.gisOrigen.n) / u };
  }
  let off = { x: 0, y: 0, z: 0 };
  try { const gg = models[0].getData().globalOffset; if (gg) off = gg; } catch (x) {}
  return { x: e / u - off.x, y: n / u - off.y };
}

/** v1.269: ¿el modelo (su parte georreferenciada) esta en UTM? Se calcula una vez por dibujo. */
function gisModeloEnUtm() {
  if (GIS.utmOk === undefined) {
    const g = (typeof modeloUTM === 'function') ? modeloUTM() : null;
    GIS.utmOk = !!(g && g.e1 >= 100000 && g.e1 <= 1000000 && Math.abs(g.n1) <= 10000000);
  }
  return GIS.utmOk;
}

/**
 * v1.269: el CENTRO de la obra para la guarda de distancia. Con grupos
 * separados, el del grupo georreferenciado: el centro de la caja entera caia en
 * el vacio entre los dos grupos y la guarda descartaba las capas bien puestas.
 */
function gisCentro() {
  try {
    const gi = (typeof GS !== 'undefined' && GS.porModelo) ? GS.porModelo.get(models[0]) : null;
    const g = gi && gi.grupos && gi.grupos[gi.principal];
    if (g && g.geo && g.caja) return new THREE.Vector3((g.caja.min.x + g.caja.max.x) / 2, (g.caja.min.y + g.caja.max.y) / 2,
                                                       (g.caja.min.z + g.caja.max.z) / 2);
  } catch (e) {}
  try {
    const bb0 = models[0].getBoundingBox();
    return bb0.center ? bb0.center(new THREE.Vector3()) : bb0.getCenter(new THREE.Vector3());
  } catch (e) { return null; }
}

/** Cota a la que se dibuja la capa: el suelo del modelo mas lo que pidas. */
function cotaGis(alto) {
  const g = (typeof modeloUTM === 'function') ? modeloUTM() : null;
  const base = g ? g.z : 0;
  return base + (alto || 0) / uScale();
}

// ---------- Dibujo en el visor ----------

function agregaCapa(nombre, geos, sistema) {
  const cuenta = { punto: 0, linea: 0, poligono: 0 };
  for (const g of geos) if (cuenta[g.tipo] !== undefined) cuenta[g.tipo]++;
  GIS.capas.push({ nombre, geos, sistema, visible: true, cuenta,
                   color: ['#c0763a', '#4f9d69', '#a15a9e', '#4d7fbf'][GIS.capas.length % 4],
                   relleno: true, opacidad: 0.3, punto: 0, alto: 0 });
}

// ---------- Anillos: que es contorno y que es agujero ----------

/** Area con signo de un anillo (sirve para ordenar por tamano). */
function areaAnillo(a) {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j].x * a[i].y - a[i].x * a[j].y;
  return s / 2;
}

/** Punto dentro de anillo, por cruces de rayo. */
function dentroDeAnillo(p, a) {
  let dentro = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const yi = a[i].y, yj = a[j].y;
    if ((yi > p.y) !== (yj > p.y) &&
        p.x < (a[j].x - a[i].x) * (p.y - yi) / (yj - yi) + a[i].x) dentro = !dentro;
  }
  return dentro;
}

/*
 * Reparte los anillos de una geometria en CONTORNOS y sus AGUJEROS.
 *
 * Antes se daba por hecho que el primer anillo era el contorno y todos los
 * demas agujeros. Con eso, un poligono de varias piezas —una cuenca con dos
 * lobulos, un predio partido por una via, un archipielago— perdia todas las
 * piezas menos la primera: se dibujaban como huecos de ella. De ahi que la
 * capa "no se viera como es realmente".
 *
 * Ahora se ordenan por tamano y se mira ANIDAMIENTO: un anillo contenido en
 * un numero PAR de anillos mayores es contorno; en un numero IMPAR, agujero
 * del contorno mas pequeno que lo contiene. Asi salen islas dentro de lagos
 * dentro de islas, que es lo que dice el estandar.
 */
function clasificaAnillos(anillos) {
  const it = anillos.map(a => ({ a, area: Math.abs(areaAnillo(a)) }))
                    .sort((u, v) => v.area - u.area);
  it.forEach((r, i) => {
    let d = 0;
    for (let j = 0; j < i; j++) if (dentroDeAnillo(r.a[0], it[j].a)) d++;
    r.d = d;
  });
  const grupos = [];
  for (const r of it) if (r.d % 2 === 0) { r.g = { ext: r.a, huecos: [] }; grupos.push(r.g); }
  for (const r of it) {
    if (r.d % 2 === 0) continue;
    let padre = null;                       // el ultimo que contiene es el menor
    for (const s of it) if (s.g && dentroDeAnillo(r.a[0], s.a)) padre = s;
    if (padre) padre.g.huecos.push(r.a);
  }
  return grupos;
}

/* ----------------------------------------------------------------------------
 * LA RUEDA DEL RATON: RETIRADA
 *
 * Aqui vivia un acercamiento propio que escribi yo. Era matematicamente
 * correcto —la distancia no podia invertirse, y la bateria lo demostraba con
 * 4.000 golpes— y aun asi ROMPIA EL VISOR. Dos motivos, los dos mios:
 *
 *  1. MOVIA EL OBJETIVO SIN MOVER EL OJO. Para "acercarse hacia el cursor"
 *     deslizaba el objetivo hacia el punto bajo el raton. Con el ojo quieto,
 *     cambiar el objetivo cambia la DIRECCION DE LA CAMARA: no es un
 *     acercamiento, es un giro. Eso es exactamente lo que Erick describio —
 *     "pareciera que el modelo se gira ligeramente conforme se acerca el
 *     zoom". No era una impresion: se giraba de verdad, y lo giraba yo.
 *
 *  2. ESCRIBIA LA POSICION A PELO. En una camara ORTOGRAFICA —la que usan
 *     estas vistas— acercar NO es mover el ojo, es cambiar la escala
 *     ortografica. Mover el ojo no agranda nada: solo desplaza los planos de
 *     recorte. De ahi las lineas raras en el plano de seccion y el aspecto
 *     sucio y "quemado" del modelo: el buffer de profundidad quedaba mal
 *     ajustado y la geometria peleaba consigo misma.
 *
 * La leccion: que una funcion sea correcta por dentro no la hace correcta en
 * su sitio. El acercamiento del visor esta atado a su proyeccion, sus planos
 * de recorte y su escala ortografica; sustituirlo por fuera no podia salir
 * bien. Se devuelve el camino nativo, que lleva anos funcionando.
 *
 * Sobre la inversion que motivo todo esto: el visor puede cruzar el punto al
 * que se acerca y a partir de ahi la rueda se siente al reves. La salida es el
 * boton de INICIO de la barra (la casita), que recoloca la camara. No voy a
 * volver a tocar la camara por fuera para arreglarlo.
 */
/*
 * NADA. Y ese es el arreglo.
 *
 * Aqui quedaba mi ultimo resto: una llamada a setReverseZoomDirection(false)
 * que se ejecutaba al cargar CADA modelo. Parecia inofensiva —"que ninguna capa
 * deje el sentido invertido"— y era justo la causa de que la rueda saliera
 * invertida desde el primer modelo: ese ajuste tiene un valor por defecto que
 * viene del perfil del visor, y yo lo estaba forzando al contrario de lo que
 * Erick tenia.
 *
 * Antes de la v1.22 NADIE tocaba la rueda. Funcionaba. Estas dos funciones se
 * quedan vacias a proposito, para no romper a quien las llama y para dejar
 * constancia: la rueda es del visor y no se toca.
 */
function ruedaGlobal() { /* la rueda es del visor */ }
function fijaRuedaGis() { /* la rueda es del visor */ }

/*
 * v1.194 — EL ORIGEN UTM, SOLO (como InfraWorks). Cuando el modelo no viene
 * en coordenadas compartidas, ANTES de pedir el Este/Norte a mano se busca
 * en el INDICE el "Punto base del proyecto" de Revit (o "Project Base
 * Point") y se leen sus propiedades E/O y N/S: ese elemento EXISTE en casi
 * todo RVT y trae exactamente lo que la ventana pide. Si aparece y es
 * plausible (UTM), el origen se aplica solo y se dice de donde salio; si
 * no, la ventana manual sigue siendo la de siempre. Un solo intento por
 * sesion: nada de bucles.
 */
function gisNumero(v) {
  let t = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}

async function leePuntoBase(m, dbId, diag) {
  const p = await new Promise((res) => {
    try { m.getProperties(dbId, res, () => res(null)); } catch (e) { res(null); }
  });
  if (!p || !p.properties) { diag.push('  dbId ' + dbId + ': sin propiedades'); return null; }
  let e = null, n = null, elev = null;
  const vistos = [];
  for (const q of p.properties) {
    const d = String(q.displayName || '').trim();
    vistos.push(d);
    if (e == null && /^(e\/o|e-o|e\/w|e-w|este)$/i.test(d)) e = gisNumero(q.displayValue);
    if (n == null && /^(n\/s|n-s|norte)$/i.test(d)) n = gisNumero(q.displayValue);
    if (elev == null && /^elev/i.test(d)) elev = gisNumero(q.displayValue);
  }
  if (e == null || n == null) {
    diag.push('  dbId ' + dbId + ': sin E/N entre [' + vistos.slice(0, 25).join(', ') + ']');
    return null;
  }
  if (!(e >= 100000 && e <= 1000000 && Math.abs(n) <= 10000000)) {
    diag.push('  dbId ' + dbId + ': E/N fuera de rango UTM (' + e + ', ' + n + ')');
    return null;
  }
  return { e, n, elev };
}

/*
 * v1.196 — TRES ESTRATEGIAS EN CASCADA (definitivo, sin suposiciones):
 *  A) el indice, por CATEGORIA "Punto base del proyecto" (lo de antes);
 *  B) el indice, por el PARAMETRO E/O directamente (cualquier pestana):
 *     sus claves son los puntos base aunque la categoria se llame distinto;
 *  C) la BUSQUEDA NATIVA del visor (m.search), que NO depende del indice:
 *     encuentra el elemento aunque no este indexado.
 * Cada intento queda ANOTADO en GIS.pbDiag: el boton "Diagnostico PB" lo
 * ensena tal cual, para que un fallo diga SU causa y no toque adivinar.
 */
async function origenDesdePuntoBase() {
  const diag = [];
  GIS.pbDiag = diag;
  try {
    if (typeof props === 'undefined' || !props || !props.byParam) {
      diag.push('sin indice (props.byParam vacio)');
      return null;
    }
    // --- A) por categoria del indice ---
    const cat = props.byParam.get('\u25cf Categoria');
    if (cat) {
      let claves = null, nombreCat = '';
      for (const [nombre, ids] of cat)
        if (/punto base del proyecto|project base point/i.test(nombre)) {
          claves = ids; nombreCat = nombre; break;
        }
      if (claves && claves.length) {
        diag.push('A) categoria "' + nombreCat + '": ' + claves.length + ' candidato(s)');
        for (const clave of Array.from(claves).slice(0, 4)) {
          const mi = decMi(Number(clave)), dbId = decId(Number(clave));
          const m = models[mi];
          if (!m) { diag.push('  clave ' + clave + ': modelo ' + mi + ' no cargado'); continue; }
          const o = await leePuntoBase(m, dbId, diag);
          if (o) { diag.push('  LEIDO por A: ' + o.e + ', ' + o.n); return o; }
        }
      } else {
        const parecidos = [...cat.keys()].filter(k => /punto|base point/i.test(k));
        diag.push('A) sin categoria de punto base; parecidas: [' +
          (parecidos.join(', ') || 'ninguna') + ']');
      }
    } else diag.push('A) el indice no trae \u25cf Categoria');
    // --- B) por el parametro E/O del indice, en cualquier pestana ---
    let hechoB = false;
    for (const [pk, vals] of props.byParam) {
      const nombre = String(pk).split('\u0000')[0].trim();
      if (!/^(e\/o|e-o|e\/w)$/i.test(nombre)) continue;
      hechoB = true;
      const claves = [];
      for (const ids of vals.values()) for (const c of ids) { claves.push(c); if (claves.length >= 4) break; }
      diag.push('B) parametro "' + nombre + '": ' + claves.length + ' candidato(s)');
      for (const clave of claves) {
        const mi = decMi(Number(clave)), dbId = decId(Number(clave));
        const m = models[mi];
        if (!m) continue;
        const o = await leePuntoBase(m, dbId, diag);
        if (o) { diag.push('  LEIDO por B: ' + o.e + ', ' + o.n); return o; }
      }
    }
    if (!hechoB) diag.push('B) el indice no trae el parametro E/O (¿faltaria "Indexar TODO"?)');
    // --- C) la busqueda nativa del visor: no depende del indice ---
    diag.push('modelos cargados: ' + models.length);
    for (let mi = 0; mi < models.length; mi++) {
      const m = models[mi];
      if (!m) continue;
      if (typeof m.search !== 'function') {
        diag.push('C) modelo ' + mi + ': m.search NO disponible en este visor');
        continue;
      }
      for (const txt of ['Punto base del proyecto', 'Project Base Point']) {
        const ids = await new Promise((res) => {
          try { m.search(txt, res, () => res([])); } catch (e) { res([]); }
        });
        if (!ids || !ids.length) continue;
        diag.push('C) m.search("' + txt + '") en modelo ' + mi + ': ' + ids.length + ' resultado(s)');
        for (const dbId of ids.slice(0, 3)) {
          const o = await leePuntoBase(m, dbId, diag);
          if (o) { diag.push('  LEIDO por C: ' + o.e + ', ' + o.n); return o; }
        }
      }
    }
    diag.push('C) la busqueda nativa tampoco hallo E/N legibles');
    /*
     * v1.197 — D) LA GEORREFERENCIA OFICIAL DEL DERIVADO. El elemento
     * "Punto base del proyecto" NORMALMENTE NI VIAJA en la traduccion de
     * APS (es un elemento oculto de Revit): por eso A/B/C, que lo buscan
     * entre las propiedades, pueden no verlo jamas. Pero APS escribe la
     * georreferencia del RVT en el AecModelData del documento
     * (refPointTransformation): su traslacion ES el punto base en
     * coordenadas compartidas. No depende del indice ni de que el elemento
     * exista. Conceptualmente, lo mismo que usa InfraWorks.
     */
    try {
      const AV = (typeof Autodesk !== 'undefined' && Autodesk.Viewing) ? Autodesk.Viewing : null;
      if (!AV || !AV.Document || !AV.Document.getAecModelData) {
        diag.push('D) getAecModelData no disponible en esta version del visor');
      } else for (let mi = 0; mi < models.length; mi++) {
        const m = models[mi];
        const node = m && typeof m.getDocumentNode === 'function' ? m.getDocumentNode() : null;
        if (!node) { diag.push('D) modelo ' + mi + ': sin nodo de documento'); continue; }
        const aec = await Promise.resolve(AV.Document.getAecModelData(node)).catch(() => null);
        const tr = aec && aec.refPointTransformation;
        if (!tr || tr.length < 12) {
          diag.push('D) modelo ' + mi + ': sin refPointTransformation en AecModelData');
          continue;
        }
        /*
         * v1.198 — LAS UNIDADES (el hallazgo del diagnostico de Erick): el
         * refPoint viene en las unidades INTERNAS del modelo — en Revit,
         * PIES SIEMPRE, aunque el proyecto muestre metros. El Porvenir dio
         * (1985273.04, 30949114.95): entre 3.28084 son EXACTOS los
         * 605111.2238 E, 9433290.2360 N de la captura de Revit. Se prueba
         * primero el factor oficial del modelo (getUnitScale: modelo ->
         * metros) y luego los factores comunes (m, pies, cm, mm); gana el
         * primero que caiga en rango UTM, y el diagnostico dice cual y por
         * que. Asi no se repite con ningun otro tipo de modelo o unidad.
         */
        const bru = [Number(tr[9]), Number(tr[10]), Number(tr[11])];
        diag.push('D) modelo ' + mi + ': refPoint bruto = (' + bru[0] + ', ' + bru[1] + ', ' + bru[2] + ')');
        if (!bru[0] && !bru[1]) { diag.push('  D descartado: refPoint en el origen (0,0)'); continue; }
        const factores = [];
        try {
          const u = (typeof m.getUnitScale === 'function') ? Number(m.getUnitScale()) : null;
          if (u && isFinite(u) && u > 0) factores.push({ f: u, de: 'getUnitScale' });
        } catch (e3) {}
        for (const f of [1, 0.3048, 0.01, 0.001])
          if (!factores.some(x => Math.abs(x.f - f) < 1e-9)) factores.push({ f, de: 'tanteo' });
        let hallado = null;
        for (const { f, de } of factores) {
          const e = bru[0] * f, n = bru[1] * f, elev = bru[2] * f;
          if (e >= 100000 && e <= 1000000 && Math.abs(n) <= 10000000) {
            diag.push('  factor ' + f + ' (' + de + ') -> (' + e.toFixed(4) + ', ' + n.toFixed(4) + ')');
            diag.push('  LEIDO por D: ' + e.toFixed(4) + ', ' + n.toFixed(4));
            hallado = { e, n, elev: isFinite(elev) ? elev : null };
            break;
          }
        }
        if (hallado) return hallado;
        diag.push('  D descartado: ningun factor de unidades (' +
          factores.map(x => x.f).join(', ') + ') cae en rango UTM');
      }
    } catch (e2) { diag.push('D) excepcion: ' + (e2.message || e2)); }
    return null;
  } catch (err) { diag.push('excepcion: ' + (err.message || err)); return null; }
}

async function pbDiagnostico() {
  // v1.197: el boton ya no solo informa — REINTENTA la lectura en vivo
  // (el indice puede haber terminado despues del primer intento) y, si
  // encuentra, aplica el origen ahi mismo.
  const o = await origenDesdePuntoBase();
  if (o) {
    session.gisOrigen = { e: o.e, n: o.n };
    try { if (typeof saveSession === 'function') saveSession(); } catch (e2) {}
    if ($('gisOrigE')) $('gisOrigE').value = o.e.toFixed(2);
    if ($('gisOrigN')) $('gisOrigN').value = o.n.toFixed(2);
    $('gisAviso').textContent = 'Origen LEIDO y aplicado (' + o.e.toFixed(1) + ' E, ' +
      o.n.toFixed(1) + ' N). Redibujando...';
    try { dibujaGis(); } catch (e2) {}
  }
  const d = (GIS.pbDiag && GIS.pbDiag.length) ? GIS.pbDiag.join('\n')
    : 'Sin rastro: no habia modelos o el modulo no corrio.';
  alert('DIAGNOSTICO del Punto base (reintento en vivo)\n' + '='.repeat(40) + '\n' + d +
    (o ? '\n\nLEIDO Y APLICADO: ' + o.e + ' E, ' + o.n + ' N.'
       : '\n\nManda una captura de esto y la causa exacta queda a la vista.'));
}
if (typeof document !== 'undefined') setTimeout(() => {
  const b = document.getElementById('gisPbDiag');
  if (b) b.onclick = pbDiagnostico;
}, 0);

function dibujaGis() {
  if (!viewer || !models.length) return;
  try { viewer.impl.removeOverlayScene(GIS.overlay); } catch (e) {}
  viewer.impl.createOverlayScene(GIS.overlay);

  /*
   * Sin coordenadas compartidas no se dibuja nada. Es deliberado: se podria
   * colocar la capa junto al origen del modelo y "verse bien", pero estaria en
   * el sitio equivocado, y en un trazado lineal eso se traduce en decisiones
   * mal tomadas. Mejor decirlo.
   */
  const g = (typeof modeloUTM === 'function') ? modeloUTM() : null;
  const utmOk = g && g.e1 >= 100000 && g.e1 <= 1000000 && Math.abs(g.n1) <= 10000000;
  GIS.utmOk = !!utmOk;                         // v1.269: lo mismo para utmAModelo en este dibujo
  const manual = session.gisOrigen && isFinite(session.gisOrigen.e);
  if (!utmOk && !manual) {
    // v1.194: primero se intenta SOLO, leyendo el Punto base del proyecto
    // del indice (un intento por sesion). Si aparece, se aplica y redibuja.
    if (!GIS.autoOrigenProbado) {
      GIS.autoOrigenProbado = true;
      $('gisAviso').textContent = 'Buscando el Punto base del proyecto en el modelo...';
      origenDesdePuntoBase().then((o) => {
        if (!o) { $('gisAviso').textContent =
          'El modelo no esta en coordenadas UTM compartidas y no pude leer su Punto ' +
          'base (3 estrategias probadas: pulsa "Diagnostico PB" para ver que fallo). ' +
          'Escribe abajo el Este y Norte (UTM), Aplicar, y las capas caeran en su sitio.';
          return; }
        session.gisOrigen = { e: o.e, n: o.n };
        try { if (typeof saveSession === 'function') saveSession(); } catch (e2) {}
        if ($('gisOrigE')) $('gisOrigE').value = o.e.toFixed(2);
        if ($('gisOrigN')) $('gisOrigN').value = o.n.toFixed(2);
        $('gisAviso').textContent = 'Origen tomado SOLO del Punto base del proyecto (' +
          o.e.toFixed(1) + ' E, ' + o.n.toFixed(1) + ' N). Editable abajo si hiciera falta.';
        try { dibujaGis(); } catch (e2) {}
      });
    } else {
      $('gisAviso').textContent =
        'El modelo no esta en coordenadas UTM compartidas. Escribe abajo el Este y ' +
        'Norte (UTM) del punto base del proyecto, Aplicar, y las capas caeran en su sitio.';
    }
    $('gisInfo').textContent = '';
    const or2 = $('gisOrigenFila');
    if (or2) or2.classList.remove('hidden');
    ruedaGlobal();
    return;
  }
  $('gisAviso').textContent = manual && !utmOk
    ? 'Capas emplazadas con el ORIGEN MANUAL (' + session.gisOrigen.e.toFixed(1) +
      ' E, ' + session.gisOrigen.n.toFixed(1) + ' N). Editable abajo.'
    : '';
  // v1.269: modelo con grupos separados: se dice sobre que grupo caen las capas.
  try {
    const gi = (typeof GS !== 'undefined' && GS.porModelo) ? GS.porModelo.get(models[0]) : null;
    const gp = gi && gi.grupos && gi.grupos[gi.principal];
    if (utmOk && gp && gp.geo) $('gisAviso').textContent = 'Modelo con la obra en grupos separados: las capas se emplazan ' +
      'en UTM sobre el grupo georreferenciado (' + gp.rotulo + '). Usa "Ir a" en Filtros para verlo.';
  } catch (e) {}
  const orF = $('gisOrigenFila');
  if (orF) orF.classList.toggle('hidden', utmOk);

  // Centro del modelo: sirve para la guarda de distancia, parte por parte.
  // v1.269: con grupos separados, el del grupo georreferenciado (gisCentro).
  let centro = null, uu = uScale();
  centro = gisCentro();
  const LEJOS = 100000 / uu;                  // 100 km en unidades del modelo

  let dibujadas = 0, fuera = 0, descartadas = 0, puntos = 0;
  for (const capa of GIS.capas) {
    if (!capa.visible) continue;
    const z = cotaGis(capa.alto);

    /*
     * ZONA UNICA por capa: la zona UTM se decide UNA vez (la del modelo si se
     * conoce; si no, la del primer punto de la capa). Antes se calculaba por
     * VERTICE: un dataset que roce el meridiano -78 (frontera 17/18) mezclaba
     * zonas y las formas salian rotas. Con zona fija, cada forma conserva su
     * geometria.
     */
    let zonaCapa = (typeof utmZona !== 'undefined' && utmZona) ? utmZona : null;
    if (!zonaCapa && capa.sistema !== 'utm') {
      let p0 = capa.geos[0] && capa.geos[0].partes[0] && capa.geos[0].partes[0][0];
      if (p0 && capa.sistema === 'webmerc') p0 = webMercAGrados(p0[0], p0[1]);
      if (p0) zonaCapa = Math.floor((p0[0] + 180) / 6) + 1;
    }

    /*
     * SANEO. Un solo vertice NaN o disparado envenena la caja envolvente de la
     * malla, y con una caja envolvente invalida el visor calcula mal los planos
     * de recorte y la distancia de zoom: la rueda se vuelve loca aunque la capa
     * parezca bien puesta. Aqui NO pasa nada que no sea finito y cercano.
     */
    const proyecta = (parte) => {
      const pts = [];
      let malos = 0;
      for (const p of parte) {
        let e = p[0], n = p[1];
        // isFinite(null) es TRUE (null se convierte en 0), asi que un vertice
        // con hueco en un GeoJSON mal formado colaba como el origen de la zona.
        if (e == null || n == null || !isFinite(e) || !isFinite(n)) { malos++; continue; }
        if (capa.sistema === 'webmerc') {           // EPSG:3857 -> grados
          const g2 = webMercAGrados(e, n);
          e = g2[0]; n = g2[1];
        }
        if (capa.sistema === 'grados' || capa.sistema === 'webmerc') {
          if (Math.abs(e) > 180 || Math.abs(n) > 90) { malos++; continue; }
          const u = aUtm(e, n, zonaCapa);
          e = u.e; n = u.n;
        }
        const m = utmAModelo(e, n);
        if (!m || !isFinite(m.x) || !isFinite(m.y)) { malos++; continue; }
        if (centro && Math.hypot(m.x - centro.x, m.y - centro.y) > LEJOS) { malos++; continue; }
        // v1.424: con el Visor GIS activo, cada vertice a su cota (la Z de la capa o la del terreno); si no, como siempre
        const zv = typeof GIS.zVertice === 'function' ? GIS.zVertice(capa, e, n, p) : null;
        pts.push(new THREE.Vector3(m.x, m.y, zv != null && isFinite(zv) ? zv : z));
      }
      if (malos) descartadas += 0;             // se contabiliza fuera, por parte
      pts.__malos = malos;
      return pts;
    };

    // Guarda de capa entera: si la MUESTRA cae lejisimos, la zona o el origen
    // estan mal y no tiene sentido dibujar nada de ella.
    {
      const p0 = capa.geos[0] && capa.geos[0].partes[0] && capa.geos[0].partes[0][0];
      if (p0 && centro) {
        let e = p0[0], n = p0[1];
        if (capa.sistema === 'webmerc') { const g3 = webMercAGrados(e, n); e = g3[0]; n = g3[1]; }
        if (capa.sistema !== 'utm') { const u = aUtm(e, n, zonaCapa); e = u.e; n = u.n; }
        const m = utmAModelo(e, n);
        if (m && isFinite(m.x)) {
          const km = Math.hypot(m.x - centro.x, m.y - centro.y) * uu / 1000;
          if (km > 100) { capa.__lejosKm = Math.round(km); fuera++; continue; }
          capa.__lejosKm = 0;
        }
      }
    }

    // Tamano del aspa de los puntos: proporcional a la extension de la capa,
    // para que un pozo se vea igual de bien en un predio que en una cuenca.
    let tamPunto = capa.punto > 0 ? capa.punto / uu : 0;
    if (!tamPunto) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n0 = 0;
      for (const geo of capa.geos) {
        for (const parte of geo.partes) for (const p of parte) {
          if (!isFinite(p[0]) || !isFinite(p[1])) continue;
          x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]);
          y1 = Math.min(y1, p[1]); y2 = Math.max(y2, p[1]);
          if (++n0 > 5000) break;
        }
        if (n0 > 5000) break;
      }
      const diag = (isFinite(x1) ? Math.hypot(x2 - x1, y2 - y1) : 0) *
                   (capa.sistema === 'grados' ? 111000 : 1);   // grados -> metros
      tamPunto = Math.max(0.6, Math.min(25, diag * 0.004)) / uu;
    }

    const material = (col) => new THREE.LineBasicMaterial({
      color: new THREE.Color(col), depthTest: true, depthWrite: false });
    /*
     * PROFUNDIDAD NORMAL (depthTest true): con depthTest apagado, superficies
     * enormes flotando "delante de todo" confundian el punto de anclaje del
     * zoom y la rueda se sentia invertida.
     */
    const matRelleno = (col, op) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(col), transparent: true, opacity: op,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false });

    const linea = (pts, col) => {
      let malla;
      // El visor puede traer una version antigua de la libreria grafica, en la
      // que la geometria se arma de otra forma. Se cubren las dos.
      if (typeof THREE.Geometry === 'function') {
        const gg = new THREE.Geometry();
        gg.vertices = pts;
        try { gg.computeBoundingSphere(); } catch (e) {}
        malla = new THREE.Line(gg, material(col));
      } else {
        const bg = new THREE.BufferGeometry();
        const arr = new Float32Array(pts.length * 3);
        pts.forEach((v, i) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; });
        bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        try { bg.computeBoundingSphere(); } catch (e) {}
        malla = new THREE.Line(bg, material(col));
      }
      viewer.impl.addOverlay(GIS.overlay, malla);
      dibujadas++;
    };

    // v1.424: con el Visor GIS activo, los rellenos (y las lineas sin Z) van pintados EN el terreno (visor-gis.js)
    const enSuelo = typeof GIS.enSuelo === 'function' ? GIS.enSuelo(capa) : null;
    for (const geo of capa.geos) {
      const colLinea = geo.color || capa.color;
      const colRelle = geo.relleno || geo.color || capa.color;
      const opRelle = geo.opacidad !== undefined ? geo.opacidad : capa.opacidad;

      /*
       * PUNTOS. Faltaban ENTEROS: el bucle de dibujo descartaba toda parte con
       * menos de dos vertices, asi que una capa de puntos (pozos, postes,
       * buzones, hitos) se cargaba, decia "N geometrias" y no pintaba nada.
       * Se dibujan como aspa mas cuadro, que se lee en planta y en 3D.
       */
      if (geo.tipo === 'punto') {
        for (const parte of geo.partes) {
          const pts = proyecta(parte);
          if (!pts.length) { descartadas++; continue; }
          for (const c0 of pts) {
            const r = tamPunto;
            linea([new THREE.Vector3(c0.x - r, c0.y - r, c0.z),
                   new THREE.Vector3(c0.x + r, c0.y + r, c0.z)], colLinea);
            linea([new THREE.Vector3(c0.x - r, c0.y + r, c0.z),
                   new THREE.Vector3(c0.x + r, c0.y - r, c0.z)], colLinea);
            linea([new THREE.Vector3(c0.x - r, c0.y - r, c0.z),
                   new THREE.Vector3(c0.x + r, c0.y - r, c0.z),
                   new THREE.Vector3(c0.x + r, c0.y + r, c0.z),
                   new THREE.Vector3(c0.x - r, c0.y + r, c0.z),
                   new THREE.Vector3(c0.x - r, c0.y - r, c0.z)], colLinea);
            puntos++;
          }
        }
        continue;
      }

      if (geo.tipo === 'poligono' && capa.relleno && !(enSuelo && enSuelo.relleno)) {
        try {
          const anillos = geo.partes.map(proyecta).filter(a => a.length > 2);
          for (const gr of clasificaAnillos(anillos)) {
            const forma = new THREE.Shape(gr.ext.map(v => new THREE.Vector2(v.x, v.y)));
            for (const h of gr.huecos) {
              forma.holes.push(new THREE.Path(h.map(v => new THREE.Vector2(v.x, v.y))));
            }
            const sg = new THREE.ShapeGeometry(forma);
            try { sg.computeBoundingSphere(); } catch (e) {}
            const relleno = new THREE.Mesh(sg, matRelleno(colRelle, opRelle));
            relleno.position.z = z;
            viewer.impl.addOverlay(GIS.overlay, relleno);
          }
        } catch (e) { /* si la forma es degenerada, queda el contorno */ }
      }

      if (enSuelo && (geo.tipo === 'poligono' || enSuelo.lineas)) continue;   // v1.424: ya van en el terreno
      for (const parte of geo.partes) {
        const pts = proyecta(parte);
        if (pts.length < 2) { descartadas++; continue; }
        if (geo.tipo === 'poligono' && pts.length > 2) pts.push(pts[0].clone());
        linea(pts, colLinea);
      }
    }
  }
  viewer.impl.invalidate(true, true, true);
  ruedaGlobal();
  try { if (typeof GIS.trasDibujo === 'function') GIS.trasDibujo(); } catch (e) {}   // v1.424: el Visor GIS completa las cotas que falten

  const lejos = GIS.capas.filter(c => c.visible && c.__lejosKm > 0);
  $('gisInfo').textContent = (dibujadas
    ? dibujadas.toLocaleString('es-PE') + ' trazos dibujados' +
      (puntos ? ' (' + puntos.toLocaleString('es-PE') + ' puntos)' : '') + '.'
    : 'Nada que dibujar: revisa el sistema de coordenadas de la capa.') +
    (descartadas ? ' ' + descartadas + ' parte(s) sin proyectar (coordenadas fuera de rango).' : '') +
    (dibujadas ? ' Rueda anclada al centro del modelo mientras haya capas.' : '') +
    (lejos.length
      ? ' OMITIDAS ' + lejos.length + ' capa(s) que caen lejos del modelo (' +
        lejos.map(c => c.nombre + ': ' + c.__lejosKm + ' km').join(', ') +
        '): revisa la zona UTM o el origen manual.'
      : '');
}

const ETI_SIS = { grados: 'geograficas', webmerc: 'Web Mercator', utm: 'UTM' };

/** Caja envolvente de una capa, en coordenadas del visor. */
function cajaDeCapa(capa) {
  const caja = new THREE.Box3();
  let hubo = false;
  const z = cotaGis(capa.alto);
  let zonaCapa = (typeof utmZona !== 'undefined' && utmZona) ? utmZona : null;
  for (const geo of capa.geos) {
    for (const parte of geo.partes) {
      for (const p of parte) {
        let e = p[0], n = p[1];
        if (e == null || n == null || !isFinite(e) || !isFinite(n)) continue;
        if (capa.sistema === 'webmerc') { const g = webMercAGrados(e, n); e = g[0]; n = g[1]; }
        if (capa.sistema !== 'utm') {
          if (Math.abs(e) > 180 || Math.abs(n) > 90) continue;
          const u = aUtm(e, n, zonaCapa); e = u.e; n = u.n;
        }
        const m = utmAModelo(e, n);
        if (!m || !isFinite(m.x) || !isFinite(m.y)) continue;
        caja.expandByPoint(new THREE.Vector3(m.x, m.y, z));
        hubo = true;
      }
    }
  }
  return hubo ? caja : null;
}

function zoomACapa(capa) {
  const caja = cajaDeCapa(capa);
  if (!caja) return alert('Esa capa no tiene ninguna coordenada utilizable para encuadrar.');
  // Un poco de aire alrededor, y un minimo para capas de un solo punto.
  const s = caja.size ? caja.size() : caja.getSize(new THREE.Vector3());
  const r = Math.max(Math.hypot(s.x, s.y) * 0.08, 2 / uScale());
  caja.expandByVector
    ? caja.expandByVector(new THREE.Vector3(r, r, r))
    : (caja.min.x -= r, caja.min.y -= r, caja.max.x += r, caja.max.y += r);
  try { viewer.navigation.fitBounds(false, caja); } catch (e) {}
}

function zoomATodas() {
  const caja = new THREE.Box3();
  let hubo = false;
  for (const c of GIS.capas) {
    if (!c.visible) continue;
    const b = cajaDeCapa(c);
    if (b) { caja.union(b); hubo = true; }
  }
  if (!hubo) return alert('No hay capas visibles con coordenadas utilizables.');
  try { viewer.navigation.fitBounds(false, caja); } catch (e) {}
}

function quitaCapa(i) {
  const c = GIS.capas[i];
  GIS.capas.splice(i, 1);
  // La ficha del panel de archivos tiene que soltar su capa, o al pulsarla
  // otra vez creeria que sigue dibujada y solo alternaria una capa fantasma.
  try {
    if (typeof gisFiles !== 'undefined') {
      const g = gisFiles.find(x => x.capa === c);
      if (g) { g.capa = null; renderGisFiles(); }
    }
  } catch (e) {}
  pintaCapas();
  dibujaGis();
}

function pintaCapas() {
  $('gisCapas').innerHTML = GIS.capas.map((c, i) => {
    const q = c.cuenta || { punto: 0, linea: 0, poligono: 0 };
    // El desglose por tipo es el contraste honesto contra QGIS: si el archivo
    // trae 412 puntos y aqui dice 412, lo que ves es lo que hay.
    const desglose = [q.poligono ? q.poligono.toLocaleString('es-PE') + ' pol\u00edgonos' : '',
                      q.linea ? q.linea.toLocaleString('es-PE') + ' l\u00edneas' : '',
                      q.punto ? q.punto.toLocaleString('es-PE') + ' puntos' : '']
                     .filter(Boolean).join(' \u00b7 ') || '0 geometrias';
    const lejos = c.__lejosKm > 0
      ? `<div class="hint aviso">Cae a ${c.__lejosKm.toLocaleString('es-PE')} km del modelo: ` +
        `revisa el sistema de coordenadas (ahora: ${ETI_SIS[c.sistema] || c.sistema}).</div>` : '';
    return `<div class="gcapa">
      <div class="gcabe">
        <label class="chk"><input type="checkbox" data-v="${i}"${c.visible ? ' checked' : ''}>
        <span class="gnom">${esc(c.nombre)}</span></label>
        <input type="color" data-c="${i}" value="${c.color}" title="Color de la capa">
        <button class="sm" data-z="${i}" title="Encuadrar esta capa">Zoom</button>
        <button class="sm" data-t="${i}" title="Ver los atributos de cada geometria (dbf, properties, ExtendedData)">Atributos</button>
        <button class="sm gquita" data-q="${i}" title="Quitar la capa">&times;</button>
      </div>
      <div class="hint">${desglose} \u00b7 ${ETI_SIS[c.sistema] || 'UTM'}</div>
      ${lejos}
      <div class="gctl">
        <label>Sistema
          <select data-s="${i}" title="Si la capa cae lejos o deformada, casi siempre es esto">
            <option value="utm"${c.sistema === 'utm' ? ' selected' : ''}>UTM</option>
            <option value="grados"${c.sistema === 'grados' ? ' selected' : ''}>Geograficas</option>
            <option value="webmerc"${c.sistema === 'webmerc' ? ' selected' : ''}>Web Mercator</option>
          </select></label>
        <label>Altura (m)<input type="number" data-h="${i}" value="${c.alto}" step="0.5"></label>
      </div>
      ${q.poligono ? `<div class="gctl">
        <label class="chk"><input type="checkbox" data-r="${i}"${c.relleno ? ' checked' : ''}> Relleno</label>
        <input type="range" data-o="${i}" min="0.05" max="0.9" step="0.05" value="${c.opacidad}"
               title="Opacidad del relleno">
      </div>` : ''}
      ${q.punto ? `<div class="gctl">
        <label>Punto (m)<input type="number" data-p="${i}" value="${c.punto || 0}" step="0.5" min="0"
               title="0 = automatico segun la extension de la capa"></label>
      </div>` : ''}
    </div>`;
  }).join('');

  const cablea = (attr, fn) => $('gisCapas').querySelectorAll('[data-' + attr + ']')
    .forEach(el => { el[el.tagName === 'BUTTON' ? 'onclick' : 'onchange'] =
      () => fn(GIS.capas[+el.getAttribute('data-' + attr)], el, +el.getAttribute('data-' + attr)); });

  cablea('v', (c, el) => { c.visible = el.checked; dibujaGis(); });
  cablea('h', (c, el) => { c.alto = parseFloat(el.value) || 0; dibujaGis(); });
  cablea('r', (c, el) => { c.relleno = el.checked; dibujaGis(); });
  cablea('o', (c, el) => { c.opacidad = parseFloat(el.value) || 0.3; dibujaGis(); });
  cablea('p', (c, el) => { c.punto = Math.max(0, parseFloat(el.value) || 0); dibujaGis(); });
  cablea('c', (c, el) => { c.color = el.value; dibujaGis(); pintaCapas(); });
  /*
   * SISTEMA a mano. La deteccion automatica acierta casi siempre, pero un .prj
   * mal escrito manda a la capa a 13.000 km y hasta ahora no habia manera de
   * corregirlo desde el visor. Ahora se cambia aqui y se ve al momento.
   */
  cablea('s', (c, el) => { c.sistema = el.value; c.__lejosKm = 0; dibujaGis(); pintaCapas(); });
  cablea('t', (c) => tablaAtributos(c));
  cablea('z', (c) => zoomACapa(c));
  cablea('q', (c, el, i) => quitaCapa(i));
  try { if (typeof GIS.trasCambio === 'function') GIS.trasCambio(); } catch (e) {}   // v1.424: el Visor GIS se entera (arbol, mapa 2D, terreno)
}

// ---------- Conexiones ----------

/*
 * El boton "Capas GIS" abre LA VENTANA de capas, que es lo que su nombre
 * promete. Hasta ahora abria el selector de archivos del sistema, asi que para
 * ver las capas ya cargadas no habia ningun camino: la ventana solo aparecia
 * sola al abrir un archivo. Para traer un archivo esta "Abrir archivo", dentro
 * de la propia ventana.
 */
$('btnCapasGis').onclick = () => {
  const w = $('gisWin');
  w.classList.toggle('hidden');
  if (!w.classList.contains('hidden')) {
    pintaCapas();
    if (GIS.capas.length) dibujaGis();
    try { arrastraFlotantes(); } catch (e) {}
  }
};
$('gisClose').onclick = () => {
  $('gisWin').classList.add('hidden');
  try { viewer.impl.removeOverlayScene(GIS.overlay); viewer.impl.invalidate(true); } catch (e) {}
  ruedaGlobal();                // la rueda estable es global, no del GIS
};
$('gisAbrir').onclick = abreGis;
$('gisZoomTodo').onclick = zoomATodas;
$('gisRedibuja').onclick = dibujaGis;
// El interruptor de la rueda actua en el acto, sin tener que redibujar.

$('gisLimpiar').onclick = () => {
  GIS.capas = [];
  pintaCapas();
  try { viewer.impl.removeOverlayScene(GIS.overlay); viewer.impl.invalidate(true); } catch (e) {}
  ruedaGlobal();                // la rueda estable es global, no del GIS
  $('gisInfo').textContent = '';
};


// Origen UTM manual: se guarda en la sesion y se redibuja al aplicar.
(function cablesOrigenGis() {
  const b = $('gisOrigAplica');
  if (!b) return;
  if (session.gisOrigen) {
    if ($('gisOrigE')) $('gisOrigE').value = session.gisOrigen.e;
    if ($('gisOrigN')) $('gisOrigN').value = session.gisOrigen.n;
  }
  b.onclick = () => {
    const e = parseFloat($('gisOrigE').value);
    const n = parseFloat($('gisOrigN').value);
    if (!isFinite(e) || !isFinite(n))
      return alert('Escribe el Este y el Norte en metros UTM (p. ej. 471250.00 y 9497800.00).');
    session.gisOrigen = { e, n };
    try { saveSession(); } catch (x) {}
    dibujaGis();
  };
})();


/* ============================================================================
 * CAPAS GIS DESDE DOCS  (v1.74)
 *
 * El mismo lector que ya funciona con archivos locales, alimentado desde el
 * proyecto: el selector de modelos manda aqui los KML, KMZ, GPX, SHP y GeoJSON
 * marcados, se bajan por la puerta de siempre (/api/archivo, en flujo) y se
 * dibujan como capas. El .dbf del .shp —los atributos— se busca solo entre los
 * hermanos de la misma carpeta, y el .prj tambien, para acertar el sistema.
 *
 * Si aun no hay modelos federados, la capa queda EN ESPERA y se carga sola al
 * terminar la federacion: una capa se dibuja SOBRE el modelo, y sin modelo no
 * hay ni suelo ni punto base donde ponerla.
 */
let gisPendDocs = [];

async function cargaGisDeDocs(it, proyecto, hermanos) {
  if (!models.length) {
    gisPendDocs.push({ it, proyecto, hermanos: hermanos || [] });
    alert('La capa "' + it.name + '" queda en espera: se cargara sola en cuanto ' +
          'federes los modelos (una capa se dibuja SOBRE el modelo).');
    return;
  }
  busy(true, 'Bajando la capa ' + it.name + '...');
  try {
    const buf = await bajaArchivo({ project: proyecto, item: it.id });
    const nombre = it.name;
    const ext = (nombre.split('.').pop() || '').toLowerCase();
    const texto = () => new TextDecoder('utf-8').decode(buf);

    let geos = null, sistema = 'grados';
    if (/^(sqlite|sqlite3|db|db3|imx|gpkg)$/.test(ext)) {
      // v1.200: base SQLite con geometria (InfraWorks, IMX, GeoPackage):
      // cada tabla con geometria se vuelve UNA CAPA, con sus atributos.
      busy(true, 'Leyendo la base ' + nombre + ' (' +
        (buf.byteLength / 1048576).toFixed(1) + ' MB)...');
      const res = await leeCapasSqlite(buf, 20000);
      GIS.sqliteDiag = res.diag;
      if (!res.capas.length) {
        const tabs = res.tablas.slice(0, 40)
          .map(t => '  ' + t.nombre + ' (' + t.total + ' filas)').join('\n');
        throw new Error('la base se abrio pero ninguna tabla trae geometria que se ' +
          'pueda dibujar.\n\nTablas:\n' + (tabs || '  (ninguna)') +
          '\n\nDetalle:\n  ' + res.diag.join('\n  '));
      }
      for (const c of res.capas) {
        const p0 = c.geos[0] && c.geos[0].partes[0] && c.geos[0].partes[0][0];
        agregaCapa(nombre + ' · ' + c.tabla, c.geos, p0 ? sistemaPorRango(p0) : 'utm');
      }
      $('gisWin').classList.remove('hidden');
      pintaCapas();
      dibujaGis();
      busy(false);
      alert('Base leida: ' + res.capas.length + ' capa(s) dibujadas.\n\n' +
        res.diag.join('\n'));
      return;
    }
    if (ext === 'kmz') geos = await leeKmz(buf);
    else if (ext === 'kml') geos = leeKml(texto());
    else if (ext === 'gpx') geos = leeGpx(texto());
    else if (ext === 'geojson') geos = leeGeoJson(JSON.parse(texto()));
    else if (ext === 'shp') {
      geos = leeShp(buf);
      sistema = 'utm';
      const base = nombre.replace(/\.shp$/i, '');
      const busca = (fin) => (hermanos || []).find(h =>
        h.type === 'file' && h.name.toLowerCase() === (base + fin).toLowerCase());
      const hDbf = busca('.dbf');
      if (hDbf) {
        try {
          const atributos = leeDbf(await bajaArchivo({ project: proyecto, item: hDbf.id }));
          if (atributos) geos.forEach((g, i) => { g.attr = atributos[i] || {}; });
        } catch (e) { console.warn('[GIS] .dbf de Docs no legible:', e.message); }
      }
      const hPrj = busca('.prj');
      if (hPrj) {
        try {
          const t = new TextDecoder('utf-8')
            .decode(await bajaArchivo({ project: proyecto, item: hPrj.id }));
          sistema = sistemaDePrj(t);
        } catch (e) {}
      }
      if (sistema === 'utm' && geos[0] && geos[0].partes[0] && geos[0].partes[0][0]) {
        const porRango = sistemaPorRango(geos[0].partes[0][0]);
        if (porRango !== 'utm') sistema = porRango;
      }
    }
    if (!geos || !geos.length) throw new Error('no trae geometria legible');

    agregaCapa(nombre + ' (Docs)', geos, sistema);
    $('gisWin').classList.remove('hidden');
    pintaCapas();
    dibujaGis();
  } catch (e) {
    alert('No se pudo cargar la capa "' + it.name + '": ' + e.message);
  }
  busy(false);
}

function procesaGisPend() {
  if (!gisPendDocs.length || !models.length) return;
  const cola = gisPendDocs;
  gisPendDocs = [];
  (async () => { for (const x of cola) await cargaGisDeDocs(x.it, x.proyecto, x.hermanos); })();
}

/* ----------------------------------------------------------------------------
 * TABLA DE ATRIBUTOS
 *
 * "Que me carguen todas sus propiedades": en una capa GIS las propiedades son
 * los atributos de cada geometria —el .dbf del shapefile, el properties del
 * GeoJSON, el ExtendedData del KML—. Ya se leian; faltaba poder VERLOS. La
 * tabla lista una fila por geometria con todas sus columnas, con buscador y
 * CSV. No entran al indice de filtros porque una capa no es un modelo: sus
 * geometrias no son elementos del visor y no se pueden seleccionar ni aislar
 * como tales — eso seria fingir una integracion que no existe.
 */
function tablaAtributos(capa) {
  const geos = capa.geos || [];
  const cols = [];
  const vistos = new Set();
  for (const g of geos) for (const k of Object.keys(g.attr || {})) {
    if (!vistos.has(k)) { vistos.add(k); cols.push(k); }
    if (cols.length >= 40) break;
  }
  if (!cols.length) return alert('Esta capa no trae atributos (solo geometria).');

  const win = $('gisAttrWin');
  if (!win) return;
  if (!win.__cerrar) { win.__cerrar = true; $('gisAttrClose').onclick = () => win.classList.add('hidden'); }
  // v1.199: la ficha de contenido se cierra igual que las demas ventanas.
  if ($('gisFichaClose')) $('gisFichaClose').onclick = () => $('gisFichaWin').classList.add('hidden');
  $('gisAttrTit').textContent = 'Atributos \u00b7 ' + capa.nombre;

  const pinta = (q) => {
    const t = sinTildes(q || '');
    const filas = [];
    for (const g of geos) {
      const a = g.attr || {};
      if (t && !cols.some(c => sinTildes(String(a[c] ?? '')).includes(t))) continue;
      filas.push(a);
      if (filas.length >= 2000) break;
    }
    $('gisAttrTabla').innerHTML =
      '<thead><tr><th>#</th>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      filas.map((a, i) => `<tr><td class="tsnom">${i + 1}</td>` +
        cols.map(c => `<td>${esc(String(a[c] ?? ''))}</td>`).join('') + '</tr>').join('') +
      '</tbody>';
    $('gisAttrInfo').textContent = filas.length.toLocaleString('es-PE') + ' de ' +
      geos.length.toLocaleString('es-PE') + ' geometrias \u00b7 ' + cols.length + ' columna(s)' +
      (filas.length >= 2000 ? ' \u00b7 se ensenan 2.000: usa el buscador o baja el CSV completo' : '');
  };
  pinta('');
  $('gisAttrBusca').oninput = () => pinta($('gisAttrBusca').value);
  $('gisAttrCsv').onclick = () => {
    const col = (v) => '"' + String(v ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
    const filas = [cols.map(col).join(';')];
    for (const g of geos) filas.push(cols.map(c => col((g.attr || {})[c])).join(';'));
    const b = new Blob(['\ufeff' + filas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'atributos-' + capa.nombre.replace(/[^\w.-]+/g, '_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  win.classList.remove('hidden');
}
