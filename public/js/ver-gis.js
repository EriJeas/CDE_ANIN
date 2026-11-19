/* CAPAS GIS EN EL VISUALIZADOR.
 * Los archivos los leen los lectores del visor (gis.js, tal cual): leeShp + leeDbf + sistemaDePrj, leeKml, leeKmz, leeGpx, leeGeoJson,
 * leeCapasSqlite (GeoPackage / SQLite), leeZip + descomprime (shapefile en .zip) y agregaCapa(); los atributos, con su tablaAtributos()
 * (ventana «Atributos», buscador y CSV) y la ficha de .dbf/.prj con gisFicha(). En el visor esas capas se dibujan SOBRE el modelo 3D
 * (dibujaGis); aqui no hay modelo, asi que se dibujan en un mapa (Leaflet, el mismo del mapa 2D del visor) con sus colores. Las capas
 * en UTM se pasan a grados con utmALatLon() del visor, con la zona del .prj o la que elijas. */
'use strict';
const MAPA = { m: null, base: null, grupos: [], zona: 17, sur: true };

async function gisAbreArchivo(buf, nombre, ext) {
  GIS.capas = [];
  const texto = (b) => new TextDecoder('utf-8').decode(b);
  const zonaDe = (prj) => { const z = /UTM[_ ]?zone[_ ]?(\d+)\s*([NS])?/i.exec(prj || ''); if (z) { MAPA.zona = +z[1]; if (z[2]) MAPA.sur = z[2].toUpperCase() === 'S'; return true; } return false; };
  const shape = (shpBuf, dbfBuf, prjTxt, nom) => {
    const geos = leeShp(shpBuf); if (!geos.length) throw new Error('el shapefile no trae geometria legible');
    if (dbfBuf) { try { const at = leeDbf(dbfBuf); if (at) geos.forEach((g, i) => { g.attr = at[i] || {}; }); } catch (e) {} }
    let sistema = 'utm'; if (prjTxt) { sistema = sistemaDePrj(prjTxt); zonaDe(prjTxt); }
    if (sistema === 'utm' && geos[0] && geos[0].partes[0] && geos[0].partes[0][0]) { const pr = sistemaPorRango(geos[0].partes[0][0]); if (pr !== 'utm') sistema = pr; }
    agregaCapa(nom, geos, sistema); GIS.capas[GIS.capas.length - 1].prj = prjTxt || '';
  };
  if (ext === 'dbf') { verMuestra(''); gisFicha(nombre, buf, null); const w = document.getElementById('gisFichaWin'); w.classList.remove('hidden'); w.classList.add('sola'); return; }
  if (/^(gpkg|sqlite)$/.test(ext)) {
    const res = await leeCapasSqlite(buf, 20000);
    if (!res.capas.length) throw new Error('la base se abrio pero ninguna tabla trae geometria que se pueda dibujar');
    for (const c of res.capas) { const p0 = c.geos[0] && c.geos[0].partes[0] && c.geos[0].partes[0][0]; agregaCapa(nombre + ' · ' + c.tabla, c.geos, p0 ? sistemaPorRango(p0) : 'utm'); }
  } else if (ext === 'kmz') agregaCapa(nombre, await leeKmz(buf), 'grados');
  else if (ext === 'kml') agregaCapa(nombre, leeKml(texto(buf)), 'grados');
  else if (ext === 'gpx') agregaCapa(nombre, leeGpx(texto(buf)), 'grados');
  else if (ext === 'geojson') agregaCapa(nombre, leeGeoJson(JSON.parse(texto(buf))), 'grados');
  else if (ext === 'shp') {
    // los acompañantes (.dbf, .prj) son otras versiones del mismo archivo en el CDE (comparten el nombre sin extension)
    const vs = (VER.cont.versiones || []).slice().sort((a, b) => b.n - a.n), de = (e) => vs.find(v => verExt(v.archivo) === e);
    const d = de('dbf'), p = de('prj');
    shape(buf, d ? await verBaja(d.id) : null, p ? texto(await verBaja(p.id)) : '', nombre);
    if (!d || !p) document.getElementById('mapAviso').innerHTML = 'Falta ' + [!d ? 'el <b>.dbf</b> (atributos)' : '', !p ? 'el <b>.prj</b> (sistema de coordenadas)' : ''].filter(Boolean).join(' y ') + ': cárgalos al CDE con el mismo nombre (quedan como versiones de este archivo) o sube el shapefile completo en un <b>.zip</b>.';
  } else if (ext === 'zip') {
    const zip = await leeZip(buf), claves = [...zip.keys()], saca = async (k) => { const u = await descomprime(zip.get(k)); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
    if (claves.some(k => /\.gdb\//i.test(k))) throw new Error('es una geodatabase de archivos (.gdb): todavía no se visualiza aquí. Expórtala a shapefile, GeoPackage o KML');
    let n = 0;
    for (const k of claves.filter(x => /\.shp$/i.test(x))) { const base = k.replace(/\.shp$/i, ''), par = (fin) => claves.find(x => x.toLowerCase() === (base + fin).toLowerCase()); const kd = par('.dbf'), kp = par('.prj'); shape(await saca(k), kd ? await saca(kd) : null, kp ? texto(await saca(kp)) : '', k.split('/').pop()); n++; }
    for (const k of claves.filter(x => /\.kml$/i.test(x))) { agregaCapa(k.split('/').pop(), leeKml(texto(await saca(k))), 'grados'); n++; }
    for (const k of claves.filter(x => /\.geojson$/i.test(x))) { agregaCapa(k.split('/').pop(), leeGeoJson(JSON.parse(texto(await saca(k)))), 'grados'); n++; }
    for (const k of claves.filter(x => /\.gpx$/i.test(x))) { agregaCapa(k.split('/').pop(), leeGpx(texto(await saca(k))), 'grados'); n++; }
    if (!n) throw new Error('el .zip no trae capas GIS (shapefile, KML, GeoJSON o GPX). Contiene: ' + claves.slice(0, 8).join(', '));
  }
  if (!GIS.capas.length || !GIS.capas.some(c => c.geos.length)) throw new Error('no trae geometria legible');
  mapaArranca();
}

/** Punto de una capa -> [lat, lon]. */
function mapaLatLon(p, sistema) {
  if (sistema === 'grados') return [p[1], p[0]];
  if (sistema === 'webmerc') { const g = webMercAGrados(p[0], p[1]); return [g[1], g[0]]; }
  const g = utmALatLon(p[0], p[1], MAPA.zona, MAPA.sur); return [g.lat, g.lon];
}
function mapaArranca() {
  if (!MAPA.m) {
    MAPA.m = L.map('mapa', { preferCanvas: true, zoomControl: true, attributionControl: true });
    L.control.scale({ imperial: false }).addTo(MAPA.m);
    document.getElementById('mapBase').onchange = mapaBase; document.getElementById('mapZoom').onclick = mapaZoom;
    document.getElementById('mapZona').onchange = (e) => { MAPA.zona = +e.target.value; mapaDibuja(true); }; document.getElementById('mapHem').onchange = (e) => { MAPA.sur = e.target.value === 'S'; mapaDibuja(true); };
  }
  document.getElementById('mapZona').value = String(MAPA.zona); if (document.getElementById('mapZona').value !== String(MAPA.zona)) { const o = document.createElement('option'); o.textContent = MAPA.zona; document.getElementById('mapZona').appendChild(o); document.getElementById('mapZona').value = String(MAPA.zona); }
  document.getElementById('mapHem').value = MAPA.sur ? 'S' : 'N';
  document.getElementById('mapZonaFila').style.display = GIS.capas.some(c => c.sistema === 'utm') ? '' : 'none';
  mapaBase(); mapaDibuja(true);
  setTimeout(() => MAPA.m.invalidateSize(), 60);
}
function mapaBase() {
  const b = document.getElementById('mapBase').value; if (MAPA.base) { MAPA.m.removeLayer(MAPA.base); MAPA.base = null; }
  if (b === 'osm') MAPA.base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '&copy; OpenStreetMap' });
  if (b === 'sat') MAPA.base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagen: Esri, Maxar, Earthstar Geographics' });
  if (MAPA.base) MAPA.base.addTo(MAPA.m).bringToBack();
}
function mapaDibuja(encuadra) {
  MAPA.grupos.forEach(g => MAPA.m.removeLayer(g)); MAPA.grupos = [];
  const ficha = (g, capa) => { const a = g.attr || {}, ks = Object.keys(a); return '<b>' + esc(capa.nombre) + '</b>' + (ks.length ? '<table class="mapficha">' + ks.slice(0, 40).map(k => '<tr><td>' + esc(k) + '</td><td>' + esc(String(a[k] ?? '')) + '</td></tr>').join('') + '</table>' : '<div>(sin atributos)</div>'); };
  GIS.capas.forEach((capa, i) => {
    const grupo = L.featureGroup(); MAPA.grupos[i] = grupo; let malos = 0;
    for (const g of capa.geos) {
      try {
        const col = g.color || capa.color, pts = g.partes.map(parte => parte.filter(p => p && isFinite(p[0]) && isFinite(p[1])).map(p => mapaLatLon(p, capa.sistema)));
        if (pts.some(pp => pp.some(q => !isFinite(q[0]) || !isFinite(q[1]) || Math.abs(q[0]) > 90))) { malos++; continue; }
        let capaL = null;
        if (g.tipo === 'punto') { for (const pp of pts) for (const q of pp) L.circleMarker(q, { radius: 5, color: '#fff', weight: 1, fillColor: col, fillOpacity: 0.95 }).bindPopup(() => ficha(g, capa)).addTo(grupo); continue; }
        if (g.tipo === 'linea') capaL = L.polyline(pts, { color: col, weight: 2.5 });
        else capaL = L.polygon(pts, { color: col, weight: 1.5, fillColor: g.relleno || col, fillOpacity: g.opacidad !== undefined ? g.opacidad : capa.opacidad });
        capaL.bindPopup(() => ficha(g, capa)).addTo(grupo);
      } catch (e) { malos++; }
    }
    capa.__malos = malos; if (capa.visible) grupo.addTo(MAPA.m);
  });
  mapaCapas(); if (encuadra) mapaZoom();
}
function mapaZoom() { let b = null; MAPA.grupos.forEach((g, i) => { if (!GIS.capas[i].visible) return; const x = g.getBounds(); if (x.isValid()) b = b ? b.extend(x) : L.latLngBounds(x.getSouthWest(), x.getNorthEast()); }); if (b) MAPA.m.fitBounds(b.pad(0.08), { maxZoom: 19 }); else MAPA.m.setView([-9.19, -75.02], 5); }
function mapaCapas() {
  const SIS = { grados: 'geográficas (grados)', utm: 'UTM', webmerc: 'Web Mercator' };
  document.getElementById('mapTitulo').textContent = GIS.capas.length + ' capa' + (GIS.capas.length === 1 ? '' : 's') + ' · ' + GIS.capas.reduce((s, c) => s + c.geos.length, 0).toLocaleString('es-PE') + ' geometrías';
  document.getElementById('mapCapas').innerHTML = GIS.capas.map((c, i) => '<div class="mapcapa"><label><input type="checkbox" data-v="' + i + '"' + (c.visible ? ' checked' : '') + '><input type="color" data-c="' + i + '" value="' + esc(c.color) + '" title="Color de la capa"><b title="' + esc(c.nombre) + '">' + esc(c.nombre) + '</b></label><div class="hint">' + [c.cuenta.punto ? c.cuenta.punto.toLocaleString('es-PE') + ' punto(s)' : '', c.cuenta.linea ? c.cuenta.linea.toLocaleString('es-PE') + ' línea(s)' : '', c.cuenta.poligono ? c.cuenta.poligono.toLocaleString('es-PE') + ' polígono(s)' : ''].filter(Boolean).join(' · ') + ' · ' + (SIS[c.sistema] || c.sistema) + (c.sistema === 'utm' ? ' ' + MAPA.zona + (MAPA.sur ? 'S' : 'N') : '') + (c.__malos ? ' · <span class="aviso">' + c.__malos + ' fuera de rango (revisa la zona UTM)</span>' : '') + '</div><div class="frow"><button class="sm" data-z="' + i + '">Zoom</button><button class="sm" data-a="' + i + '">Atributos</button></div></div>').join('');
  const C = document.getElementById('mapCapas');
  C.querySelectorAll('[data-v]').forEach(x => x.onchange = () => { const c = GIS.capas[+x.dataset.v]; c.visible = x.checked; if (c.visible) MAPA.grupos[+x.dataset.v].addTo(MAPA.m); else MAPA.m.removeLayer(MAPA.grupos[+x.dataset.v]); });
  C.querySelectorAll('[data-c]').forEach(x => x.onchange = () => { GIS.capas[+x.dataset.c].color = x.value; mapaDibuja(false); });
  C.querySelectorAll('[data-z]').forEach(x => x.onclick = () => { const b = MAPA.grupos[+x.dataset.z].getBounds(); if (b.isValid()) MAPA.m.fitBounds(b.pad(0.08), { maxZoom: 19 }); });
  C.querySelectorAll('[data-a]').forEach(x => x.onclick = () => tablaAtributos(GIS.capas[+x.dataset.a]));
}
