/*
 * VISOR DEL CDE (Three.js, sin Autodesk) — v0.4: "como el Visor BIM Federado".
 *
 * Lo que se ve (tema oscuro negro/oro del Visor BIM Federado, css/visor.css):
 *  - barra superior: proyecto, modelo/version, cifras, usuario, Volver al CDE;
 *  - carril de modulos a la izquierda: Visor con filtros · Inventario · Conjuntos e interferencias · Comparar versiones ·
 *    Planos (PDF) · Incidencias · Elemento · Atajos. Cada modulo abre su panel al lado del carril (se arrastra) o una
 *    ventana grande (inventario, planos, resultados) que se mueve y se agranda;
 *  - barra de herramientas flotante abajo: Encuadrar, Aislar, Ocultar, Mostrar todo, Seccion, Medir, Aristas, estilo, Incidencia.
 *
 * Lo que hace este archivo: escena, carga del .cdeg, seleccion, filtros ("+ Añadir filtro" sobre cualquier parametro del
 * indice, con valores y conteos; barras dinamicas por categoria/nivel/familia/modelo; colorear por), seccion, medir,
 * incidencias (abrir y crear) y el armazon de modulos. Inventario, conjuntos/interferencias, comparar versiones y
 * planos viven en visor-modulos.js, que recibe el objeto V (estado y funciones compartidas) al arrancar.
 *
 * Como lee el .cdeg: docs/FORMATO-PAQUETE.md (tabla de elementos con rangos de vertices/indices; opacos y translucidos
 * en dos BufferGeometry que comparten posiciones y colores; ocultar = reescribir los indices visibles).
 */
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { GTAOPass } from '../vendor/pp/postprocessing/GTAOPass.js';

const { esc, api, num, ventana, barras } = CDE;
const Q = new URLSearchParams(location.search), PID = Q.get('pid') || '';
let VID = Q.get('vid') || '';
const INC = Q.get('inc') || '';
const $ = (id) => document.getElementById(id);
const f3 = (n) => (Math.round(n * 1000) / 1000).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const DIMS = { modelo: 'Modelo', cat: 'Categoría', fam: 'Familia', tip: 'Tipo', niv: 'Nivel' };

// estado compartido por el bucle de dibujo (se declara antes de arrancarlo)
const MEDIR = { modo: null, puntos: [], objetos: [], etiquetas: [], temporal: null, ventana: null, marcador: null };
let PLANOS = [];

// ---------- escena ----------
const cont = $('lienzo'), render = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
render.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1) * 1.5, 2.5));   // algo mas que la pantalla: suaviza bordes y aristas render.setClearColor(0x000000, 0);
// v0.13.10: el mismo tono neutro (Khronos PBR Neutral, la misma curva: los blancos se quedan blancos y los medios no cambian) pero
// SIN desaturar lo que brilla: con la desaturacion de 0,15 un rojo puro al sol salia rosado (227,67,68) y en Forma es (240,7,7);
// un azul de vidrio o el naranja de un muro tambien perdian fuerza. Asi los colores intensos quedan vivos, como en Forma.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }',
  'vec3 CustomToneMapping( vec3 color ) {\n\tconst float StartCompression = 0.8 - 0.04;\n\tcolor *= toneMappingExposure;\n\tfloat x = min( color.r, min( color.g, color.b ) );\n\tfloat offset = x < 0.08 ? x - 6.25 * x * x : 0.04;\n\tcolor -= offset;\n\tfloat peak = max( color.r, max( color.g, color.b ) );\n\tif ( peak < StartCompression ) return color;\n\tfloat d = 1. - StartCompression;\n\tfloat newPeak = 1. - d * d / ( peak + d - StartCompression );\n\treturn color * ( newPeak / peak );\n}');
const TONO_VIVO = THREE.ShaderChunk.tonemapping_pars_fragment.includes('newPeak / peak );\n}');
render.outputColorSpace = THREE.SRGBColorSpace; render.toneMapping = TONO_VIVO ? THREE.CustomToneMapping : THREE.NeutralToneMapping; render.toneMappingExposure = 1.0;   // neutro sin desaturar (si el three.js no trae el hueco, el neutro de siempre)
render.shadowMap.enabled = true; render.shadowMap.type = THREE.PCFSoftShadowMap; render.localClippingEnabled = true;
cont.appendChild(render.domElement);
const escena = new THREE.Scene();
// entorno de cielo (como Forma): azul arriba, horizonte claro, suelo gris. Lo que mira al cielo (cubiertas, losas) toma un tono azulado;
// los muros quedan blancos al sol y gris frio a la sombra
function cieloEntorno() {
  const esc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { arriba: { value: new THREE.Color(0x9ab6e0) }, horizonte: { value: new THREE.Color(0xeceff2) }, abajo: { value: new THREE.Color(0xc4c5c2) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 arriba, horizonte, abajo; varying vec3 vD; void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(horizonte, arriba, pow(h, 0.55)) : mix(horizonte, abajo, pow(-h, 0.35)); gl_FragColor = vec4(c, 1.0); }' });
  esc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  return esc;
}
const pmrem = new THREE.PMREMGenerator(render); escena.environment = pmrem.fromScene(cieloEntorno(), 0).texture;
const camara = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
const control = new OrbitControls(camara, render.domElement); control.screenSpacePanning = true; control.enableDamping = true; control.dampingFactor = 0.12;
// v0.25.8 · desplazar (paneo) como en Forma / Navisworks: botón central (apretar la rueda) o derecho y arrastrar; la rueda acerca hacia donde
// apunta el ratón; y la herramienta «Mover» hace que arrastrar con el botón izquierdo desplace en vez de girar.
control.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }; control.zoomToCursor = true; control.keyPanSpeed = 28;
let MOVER = false;
function ponMover(si) {
  MOVER = !!si; control.mouseButtons.LEFT = MOVER ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; control.touches.ONE = MOVER ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  render.domElement.style.cursor = MOVER ? 'grab' : ''; const b = document.querySelector('.herramientas button[data-h="mover"]'); if (b) b.classList.toggle('activo', MOVER);
}
render.domElement.addEventListener('pointerdown', () => { if (MOVER) render.domElement.style.cursor = 'grabbing'; });
window.addEventListener('pointerup', () => { if (MOVER) render.domElement.style.cursor = 'grab'; });
/** Desplaza la vista dx, dy píxeles de pantalla (flechas del teclado). */
function desplaza(dx, dy) {
  const d = camara.position.distanceTo(control.target), alto = 2 * d * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)), k = alto / Math.max(1, render.domElement.clientHeight);
  const der = new THREE.Vector3().setFromMatrixColumn(camara.matrix, 0), arr = new THREE.Vector3().setFromMatrixColumn(camara.matrix, 1), m = der.multiplyScalar(-dx * k).add(arr.multiplyScalar(dy * k));
  camara.position.add(m); control.target.add(m); control.update();
}
// luz de cielo azulada desde arriba y gris neutro desde abajo (sin tinte lila en las sombras): lo que mira al cielo (cubiertas, losas) toma el tono del cielo
const hemi = new THREE.HemisphereLight(0xbfd3ee, 0xd6d8d6, 0.22); escena.add(hemi);
// fondo: degradado claro (gris azulado arriba, calido abajo)
{ const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256; const g2 = cv.getContext('2d'), gr = g2.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#dde4ea'); gr.addColorStop(0.55, '#ebebe8'); gr.addColorStop(1, '#f1ebe3'); g2.fillStyle = gr; g2.fillRect(0, 0, 4, 256); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; escena.background = tx; }
const sol = new THREE.DirectionalLight(0xffffff, 2.3); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.radius = 9; sol.shadow.blurSamples = 16; sol.shadow.bias = -0.0005; sol.shadow.normalBias = 0.02; escena.add(sol); escena.add(sol.target);
const etiquetas = document.createElement('div'); etiquetas.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; cont.appendChild(etiquetas);
// oclusion ambiental (GTAO): oscurece los encuentros y rincones, lo que da el volumen que tienen Revit y Forma.
// El modelo se dibuja directo en pantalla, con el antialias del navegador (asi las lineas finas y juntas de 1-2 cm, como las
// punteadas de los parapetos, se ven igual que en Forma); la oclusion se calcula aparte y se multiplica encima.
let gtao = null, AO = true;
try {
  gtao = new GTAOPass(escena, camara, 4, 4); gtao.output = GTAOPass.OUTPUT.Off; gtao.blendIntensity = 1.1;
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.5, rings: 2, samples: 16 });
} catch (e) { console.warn('sin oclusion ambiental', e); gtao = null; }
function ajusta() { const w = cont.clientWidth, h = cont.clientHeight, pr = render.getPixelRatio(); render.setSize(w, h); if (gtao) gtao.setSize(Math.round(w * pr), Math.round(h * pr)); camara.aspect = w / h; camara.updateProjectionMatrix(); }
/** Un cuadro: el modelo directo en pantalla y, en estilo realista (sin planos de seccion ni modelos enormes), la oclusion encima. */
function cuadro() {
  let g = null; try { g = G; } catch (e) {}   // (G se declara mas abajo: el primer cuadro llega antes)
  if (g && g.caja) { ajustaPlanos(g.caja); luzDeCamara(g.caja); }
  render.render(escena, camara);
  const conAO = gtao && AO && g && $('estilo').value === 'realista' && !PLANOS.length && g.nIdx / 3 <= 6000000;
  if (conAO) {
    try {
      gtao.render(render, null, null);   // normales, oclusion y suavizado, en sus propios buffers
      const b = gtao.blendMaterial; b.uniforms.intensity.value = gtao.blendIntensity; b.uniforms.tDiffuse.value = gtao.pdRenderTarget.texture;
      gtao.renderPass(render, b, null);   // multiplica la oclusion sobre lo ya dibujado
    } catch (e) { console.warn('oclusion ambiental', e); gtao = null; }
  }
}
// sol que acompana a la camara (desde arriba a la izquierda de quien mira, como la luz de Forma): la fachada que se mira queda
// blanca, la cubierta un poco mas oscura y azulada por el cielo, y el costado en gris claro. Gira con la vista, no con el modelo.
// v0.25.8: el sol sube de 25° a 38° (cubiertas y losas ya no quedan apagadas vistas desde arriba) y una luz de relleno, sin sombra,
// entra por el otro lado de la vista: las caras que el sol no toca conservan su color en vez de irse a un gris azulado oscuro.
const relleno = new THREE.DirectionalLight(0xffffff, 0.9); escena.add(relleno); escena.add(relleno.target);
const LUZ = { elev: THREE.MathUtils.degToRad(38), giro: THREE.MathUtils.degToRad(35), elevR: THREE.MathUtils.degToRad(30), giroR: THREE.MathUtils.degToRad(75) }, _f = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
function luzDeCamara(caja) {
  caja.getCenter(_c); _f.subVectors(camara.position, control.target); _f.y = 0;
  if (_f.lengthSq() < 1e-9) camara.getWorldDirection(_f).negate().setY(0);
  if (_f.lengthSq() < 1e-9) _f.set(0, 0, 1);
  _f.normalize();
  const az = Math.atan2(_f.x, _f.z) - LUZ.giro;   // girado hacia la izquierda de la vista
  _d.set(Math.sin(az) * Math.cos(LUZ.elev), Math.sin(LUZ.elev), Math.cos(az) * Math.cos(LUZ.elev));
  const rad = caja.getSize(_f).length() / 2 || 1;
  sol.position.copy(_c).addScaledVector(_d, rad * 1.8); sol.target.position.copy(_c); sol.target.updateMatrixWorld();
  const azR = az + LUZ.giro + LUZ.giroR;   // a la derecha de quien mira
  _d.set(Math.sin(azR) * Math.cos(LUZ.elevR), Math.sin(LUZ.elevR), Math.cos(azR) * Math.cos(LUZ.elevR));
  relleno.position.copy(_c).addScaledVector(_d, rad * 1.8); relleno.target.position.copy(_c); relleno.target.updateMatrixWorld();
}
const ESF = new THREE.Sphere();
/** Planos de recorte de la camara segun donde esta: el cercano lo mas lejos posible sin cortar nada que se vea. Con un plano
 *  cercano fijo muy chico (0.02 m) la profundidad pierde precision y las capas de 1 mm que modela Revit (pintura sobre
 *  tarrajeo) se pelean en pantalla: manchas punteadas en las fachadas. */
function ajustaPlanos(caja) {
  caja.getBoundingSphere(ESF);
  const d = camara.position.distanceTo(ESF.center), r = ESF.radius, dObj = camara.position.distanceTo(control.target);
  const near = Math.max(0.02, d > r ? (d - r) * 0.8 : 0, Math.min(dObj * 0.02, 0.3)), far = d + r * 3 + 50;
  if (Math.abs(camara.near - near) > near * 0.05 || Math.abs(camara.far - far) > far * 0.05) { camara.near = near; camara.far = far; camara.updateProjectionMatrix(); }
}
window.addEventListener('resize', ajusta); ajusta();
// dibuja cuando algo cambio (camara, estado) y, por si acaso, 4 veces por segundo: en una laptop sin GPU dedicada el visor
// deja de consumir el procesador cuando nadie lo mueve (en el Visor BIM Federado lo hace el propio Autodesk Viewer)
let SUCIO = true, ULTIMO = 0;
const dibuja = () => { SUCIO = true; };
control.addEventListener('change', dibuja); window.addEventListener('pointermove', () => { if (MEDIR.modo) SUCIO = true; });
(function bucle() { requestAnimationFrame(bucle); const movio = control.update(), t = performance.now(); if (movio || SUCIO || t - ULTIMO > 250) { cuadro(); pintaEtiquetas(); ULTIMO = t; SUCIO = false; } })();

// ---------- modelo ----------
let G = null;        // { elem, porE, geoOp, geoTr, mallaOp, mallaTr, abs, absTr, meta, colores0, colores, caja, aristas, cajas }
let EL = null;       // { columnas, diccionarios, idx }
let VIS = null;      // Set de e visibles (null = todos)
let OCULTOS = new Set();
let SEL = null;      // { e, nombre, uid, idx }
let LISTA = [];      // [{ vid, cid, contenedor, n, revision, estado, archivo }] versiones con geometria del proyecto
let PROY = null, QUIEN = null;
const ROT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // Z arriba (Revit) -> Y arriba (Three)
const COLOR_SEL = [0.78, 0.63, 0.29];   // oro
const srgbLin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

const MAT = {
  opaco: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.53, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),   // (el desfase deja las aristas por delante de su cara)
  vidrio: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.25, envMapIntensity: 0.45, side: THREE.DoubleSide, depthWrite: false }),   // v0.9.15: 0,25 (75 % de transparencia, la del vidrio de Revit y Navisworks; antes 0,34 y el muro cortina salia azul fuerte)
  mono: new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  monoVidrio: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.9, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  aristas: new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.9 }),
  punteadas: new THREE.LineDashedMaterial({ color: 0x8c8c8c, transparent: true, opacity: 0.85, dashSize: 0.05, gapSize: 0.07 }),
  fantasma: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  lineas: new THREE.LineBasicMaterial({ vertexColors: true })   // v0.9.15: vegetacion dibujada con lineas (arboles CAD 3D de Revit, via Navisworks)
};

// v0.9.15: las aristas se aclaran con la distancia (enteras hasta 8 m, hasta el 15 % a 45 m): de lejos, una fachada con muchas
// ventanas ya no se ve negra por la suma de lineas de los perfiles (de cerca se ven igual que antes)
MAT.aristas.onBeforeCompile = (sh) => {
  sh.vertexShader = 'varying float vDistAr;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vDistAr = -mvPosition.z;');
  sh.fragmentShader = 'varying float vDistAr;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= clamp(1.0 - (vDistAr - 8.0) / 37.0, 0.15, 1.0);');
};
MAT.aristas.customProgramCacheKey = () => 'aristas-distancia-2';
const LUT8 = new Float32Array(256); for (let k = 0; k < 256; k++) LUT8[k] = srgbLin(k / 255);   // byte sRGB -> lineal
/** Lee un .cdeg a arreglos (sin tocar la escena). Lo usa el modelo principal y Comparar versiones (la version antigua). */
function parseaCdeg(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CDEG') throw new Error('Archivo de geometria no reconocido.');
  const version = dv.getUint32(4, true), nElem = dv.getUint32(8, true), nVert = dv.getUint32(12, true), nIdx = dv.getUint32(16, true), L = dv.getUint32(32, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 36, L)));
  let off = 36 + L; off += (4 - off % 4) % 4;
  // rgb8: el color original de cada vertice en bytes (para volver a el tras colorear): v0.9.15, antes una copia en float del
  // arreglo de colores (con 18 millones de vertices eran 212 MB; asi 55 MB)
  const elem = [], porE = new Map(), colores = new Float32Array(nVert * 3), rgb8 = new Uint8Array(nVert * 3);
  for (let i = 0; i < nElem; i++, off += 24) {
    const x = { e: dv.getUint32(off, true), vo: dv.getUint32(off + 4, true), vc: dv.getUint32(off + 8, true), io: dv.getUint32(off + 12, true), ic: dv.getUint32(off + 16, true), c: [dv.getUint8(off + 20) / 255, dv.getUint8(off + 21) / 255, dv.getUint8(off + 22) / 255], a: dv.getUint8(off + 23) };
    x.vidrio = x.a < 200; elem.push(x); porE.set(x.e, i);
    const c8 = [dv.getUint8(off + 20), dv.getUint8(off + 21), dv.getUint8(off + 22)];
    for (let v = x.vo; v < x.vo + x.vc; v++) { rgb8[v * 3] = c8[0]; rgb8[v * 3 + 1] = c8[1]; rgb8[v * 3 + 2] = c8[2]; }
  }
  const posiciones = new Float32Array(buf, off, nVert * 3).slice(); off += nVert * 12;
  const indices = new Uint32Array(buf, off, nIdx).slice(); off += nIdx * 4;   // copia: asi el archivo bajado (cientos de MB) se libera
  // formato 2 (lector IFC/RVT del CDE): color por vertice (un elemento con varios materiales: marcos oscuros, vidrio claro)
  // y, por elemento, cuantos indices del final son vidrio (ventanas y puertas: marco opaco + vidrio translucido)
  let offFin = -1;
  if (version >= 2 && off + nElem * 4 + nVert * 3 <= buf.byteLength) {
    const icTr = new Uint32Array(buf, off, nElem); off += nElem * 4;
    const rgb = new Uint8Array(buf, off, nVert * 3); offFin = off + nVert * 3;
    for (let i = 0; i < nElem; i++) { const x = elem[i]; x.icTr = !x.vidrio && icTr[i] <= x.ic ? icTr[i] : 0; }
    rgb8.set(rgb);
  }
  for (let v = 0; v < nVert * 3; v++) colores[v] = LUT8[rgb8[v]];
  // v0.9.15: secciones opcionales al final (las escribe el complemento de Navisworks; un visor anterior las ignora):
  //  "LINS" dibujos en lineas (arboles CAD 3D, escudos): por fila elemento, primer segmento, cuantos y rgba; luego 6 float por
  //         segmento y 3 bytes de color por segmento.
  //  "ARIS" aristas precalculadas: por elemento (orden de la tabla) primer par y cuantos; luego pares de vertices relativos al
  //         primer vertice del elemento. Asi el visor muestra las aristas de entrada sin calcularlas.
  let lineas = null, arisPre = null;
  if (offFin > 0) {
    let ol = offFin + (4 - offFin % 4) % 4;
    while (ol + 8 <= buf.byteLength) {
      const tag = String.fromCharCode(dv.getUint8(ol), dv.getUint8(ol + 1), dv.getUint8(ol + 2), dv.getUint8(ol + 3));
      if (tag === 'LINS' && ol + 12 <= buf.byteLength) {
        const nF = dv.getUint32(ol + 4, true), nS = dv.getUint32(ol + 8, true); ol += 12;
        if (ol + nF * 16 + nS * 27 > buf.byteLength) break;
        const filas = []; for (let i = 0; i < nF; i++, ol += 16) filas.push({ e: dv.getUint32(ol, true), so: dv.getUint32(ol + 4, true), sc: dv.getUint32(ol + 8, true) });
        const lp = new Float32Array(buf, ol, nS * 6).slice(); ol += nS * 24; const lc = new Uint8Array(buf, ol, nS * 3); ol += nS * 3; ol += (4 - ol % 4) % 4;
        // color en bytes ya lineales (atributo normalizado): la cuarta parte de memoria que en float
        const col = new Uint8Array(nS * 6); for (let q = 0; q < nS; q++) for (let j = 0; j < 3; j++) { const c = Math.round(LUT8[lc[q * 3 + j]] * 255); col[q * 6 + j] = c; col[q * 6 + 3 + j] = c; }
        const w = new THREE.Vector3(); for (let i = 0; i < nS * 2; i++) { w.set(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]).applyMatrix4(ROT); lp[i * 3] = w.x; lp[i * 3 + 1] = w.y; lp[i * 3 + 2] = w.z; }
        lineas = { filas, pos: lp, col, nS };
      } else if (tag === 'ARIS') {
        const nP = dv.getUint32(ol + 4, true); ol += 8;
        if (ol + nElem * 8 + nP * 8 > buf.byteLength) break;
        const tab = new Uint32Array(buf, ol, nElem * 2); ol += nElem * 8; const rel = new Uint32Array(buf, ol, nP * 2); ol += nP * 8;
        arisPre = new Uint32Array(nP * 2);
        for (let i = 0; i < nElem; i++) { const x = elem[i], a0 = tab[i * 2], n = tab[i * 2 + 1]; x.ao = a0; x.ac = n; for (let q = a0 * 2; q < (a0 + n) * 2; q++) arisPre[q] = rel[q] + x.vo; }
      } else break;
    }
  }
  const D0 = { elem, indices }; reparte(D0); const { abs, absTr } = D0;
  // a Y arriba, aqui mismo (todas las cajas y medidas se hacen en coordenadas de la escena)
  const v = new THREE.Vector3(); for (let i = 0; i < nVert; i++) { v.set(posiciones[i * 3], posiciones[i * 3 + 1], posiciones[i * 3 + 2]).applyMatrix4(ROT); posiciones[i * 3] = v.x; posiciones[i * 3 + 1] = v.y; posiciones[i * 3 + 2] = v.z; }
  return { elem, porE, posiciones, colores, rgb8, abs, absTr, indices, meta, nElem, nVert, nIdx, lineas, arisPre };
}
/** Reparte los indices en opacos (abs) y translucidos (absTr) segun x.vidrio de cada elemento (se repite si cambia).
 *  Un elemento con vidrio propio (x.icTr, formato 2) deja su parte opaca en abs y su vidrio en absTr (x.ioAbsTr). */
function reparte(D) {
  let nOp = 0, nTr = 0; for (const x of D.elem) { const tr = x.vidrio ? x.ic : (x.icTr || 0); nTr += tr; nOp += x.ic - tr; }
  const abs = new Uint32Array(nOp), absTr = new Uint32Array(nTr); let ko = 0, kt = 0;
  for (const x of D.elem) {
    if (x.vidrio) { x.ioAbs = kt; for (let q = x.io; q < x.io + x.ic; q++) absTr[kt++] = D.indices[q] + x.vo; continue; }
    const op = x.ic - (x.icTr || 0); x.ioAbs = ko; for (let q = x.io; q < x.io + op; q++) abs[ko++] = D.indices[q] + x.vo;
    if (x.icTr) { x.ioAbsTr = kt; for (let q = x.io + op; q < x.io + x.ic; q++) absTr[kt++] = D.indices[q] + x.vo; }
  }
  D.abs = abs; D.absTr = absTr;
}
/** Los tramos de indices de un elemento: [[arreglo, inicio, cantidad, esVidrio], ...] (uno o, si tiene vidrio propio, dos). */
function trozosDe(x, D) {
  D = D || G; if (x.vidrio || !x.icTr) return [[x.vidrio ? D.absTr : D.abs, x.ioAbs, x.ic, !!x.vidrio]];
  return [[D.abs, x.ioAbs, x.ic - x.icTr, false], [D.absTr, x.ioAbsTr, x.icTr, true]];
}
/** Los AMBIENTES (Habitaciones, Rooms, Spaces: la misma expresion que el visor) vienen opacos de Revit: se vuelven de vidrio y
 *  se ocultan mientras no se pida verlos (Niveles / Ambientes), como hace el Autodesk Viewer. */
const ROOM_RE = /^(revit\s+)?(rooms?|habitaci[oó]n(es)?|ambientes?|spaces?|espacios?|mep\s*spaces?|ifcspace)$/i;
let MOSTRAR_AMB = false;
function marcaAmbientes() {
  G.ambientes = new Set(); if (!EL) return;
  const C = EL.columnas, D = EL.diccionarios; let cambio = false;
  for (let i = 0; i < C.e.length; i++) if (ROOM_RE.test(D.cat[C.cat[i]])) { const e = C.e[i]; G.ambientes.add(e); const k = G.porE.get(e); if (k != null && !G.elem[k].vidrio) { G.elem[k].vidrio = true; cambio = true; } }
  if (cambio) reparte(G);
  if (G.ambientes.size) reconstruyeIndices();
}
/** La caja [minx,miny,minz,maxx,maxy,maxz] de cada elemento (una vez por geometria). */
function cajasDe(D) {
  if (D.cajas) return D.cajas;
  const C = new Map(), p = D.posiciones;
  for (const x of D.elem) {
    let a = Infinity, b = Infinity, c = Infinity, d = -Infinity, e = -Infinity, f = -Infinity;
    for (let k = x.vo; k < x.vo + x.vc; k++) { const X = p[k * 3], Y = p[k * 3 + 1], Z = p[k * 3 + 2]; if (X < a) a = X; if (Y < b) b = Y; if (Z < c) c = Z; if (X > d) d = X; if (Y > e) e = Y; if (Z > f) f = Z; }
    C.set(x.e, x.vc ? [a, b, c, d, e, f] : null);
  }
  D.cajas = C; return C;
}
// v0.13.11: caja de lo dibujado con lineas (vegetacion, escudos), solo para encuadrar; las interferencias y la comparacion siguen con cajasDe
function cajasLinDe(D) {
  if (D.cajasLin) return D.cajasLin;
  const C = new Map();
  if (D.lineas) { const L = D.lineas.pos; for (const r of D.lineas.filas) { let k = C.get(r.e); if (!k) { k = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; C.set(r.e, k); }
    for (let i = r.so * 2; i < (r.so + r.sc) * 2; i++) for (let j = 0; j < 3; j++) { const v = L[i * 3 + j]; if (v < k[j]) k[j] = v; if (v > k[j + 3]) k[j + 3] = v; } } }
  D.cajasLin = C; return C;
}

async function cargaLista() {
  const [p, qn] = await Promise.all([api('/api/proyectos/' + PID), api('/api/acceso/quien').catch(() => null)]);
  PROY = p; QUIEN = qn;
  $('proyectoNombre').textContent = (p.codigo ? p.codigo + ' · ' : '') + (p.nombre || PID); $('proyectoNombre').title = $('proyectoNombre').textContent;
  if (qn) $('quien').innerHTML = '<span class="av">' + esc((qn.nombre || qn.email || '?').slice(0, 2).toUpperCase()) + '</span><span>' + esc(qn.nombre || qn.email) + '</span>';
  // todos los modelos del proyecto, de CUALQUIER carpeta (WIP, compartido, publicado), con lo que el CDE sabe de cada version
  const d = await api('/api/modelos/' + PID + '/lista');
  LISTA = d.modelos.map(m => ({ vid: m.vid, cid: m.cid, contenedor: m.contenedor, carpeta: m.carpeta, n: m.n, revision: m.revision, estado: m.estado, archivo: m.archivo, fecha: m.fecha, formato: m.formato, origen: m.origen || '', indice: m.indice, geometria: !!(m.indice && m.indice.geometria && m.indice.estado === 'listo'), elementos: m.indice && m.indice.elementos }));
  const txtEstado = (x) => { const ix = x.indice; if (esForma(x) && (!ix || ix.estado !== 'listo')) return 'de Forma: se prepara al abrirlo'; if (!ix) return x.formato === 'nwd' ? 'sin lector libre' : 'sin procesar'; if (ix.estado === 'no-legible' && x.formato === 'rvt') return 'falta el lector de RVT en el servidor'; return ix.estado === 'listo' ? (ix.elementos ? num(ix.elementos) + ' elem.' : 'listo') : (ESTADO_MODELO[ix.estado] || ix.estado).toLowerCase(); };
  // v0.25.7: el nombre lleva su extensión (.rvt, .nwd, .ifc): un RVT y un NWD pueden tener el mismo código
  const extDe = (x) => { const m = /\.[A-Za-z0-9]{2,5}$/.exec(x.archivo || ''); return m && !String(x.contenedor || '').toLowerCase().endsWith(m[0].toLowerCase()) ? m[0].toLowerCase() : ''; };
  const grupos = new Map(); for (const x of LISTA) { if (!grupos.has(x.carpeta)) grupos.set(x.carpeta, []); grupos.get(x.carpeta).push(x); }
  const sel = $('selModelo'); sel.innerHTML = '<option value="">' + (LISTA.length ? 'Elige un modelo del CDE (cualquier carpeta)…' : 'Este proyecto aún no tiene modelos IFC / RVT') + '</option>' + [...grupos].map(([carp, L]) => '<optgroup label="' + esc(carp || 'Archivos de proyecto') + '">' + L.map(x => '<option value="' + x.vid + '"' + (x.vid === VID ? ' selected' : '') + '>' + esc(x.contenedor) + esc(extDe(x)) + ' · v' + x.n + ' ' + esc(x.revision || '') + ' · ' + esc(txtEstado(x)) + '</option>').join('') + '</optgroup>').join('');
  sel.onchange = () => { VID = sel.value; if (VID) { history.replaceState(null, '', '?pid=' + PID + '&vid=' + VID); cargaModelo(); } };
  if (VID) cargaModelo(); else { $('estadoCarga').textContent = 'Elige un modelo arriba.'; abreModulo('filtros'); }
}
$('btnVolver').onclick = () => { const x = LISTA.find(l => l.vid === VID); location.href = 'index.html#/p/' + PID + (x ? '/c/' + x.cid : ''); };

const ESTADO_MODELO = { 'en-cola': 'En cola', convirtiendo: 'Leyendo el modelo', armando: 'Armando el índice', recibiendo: 'Recibiendo', listo: 'Listo', error: 'No se pudo leer', 'no-legible': 'Sin lector libre' };
const FASE_MODELO = { abriendo: 'abriendo el IFC', rvt: 'leyendo el RVT con el lector libre', relaciones: 'leyendo niveles y tipos', geometria: 'leyendo la geometría', parametros: 'leyendo los parámetros', escribiendo: 'guardando' };
let VIGIA = null;
/* ───── NWD traido de Autodesk Forma: no hay lector libre, pero Autodesk ya lo tradujo para Forma. Al abrirlo aqui, el CDE lo
   prepara solo con esa traduccion (forma-paso.html, incrustada en el lienzo: se ve el modelo de Autodesk mientras se lee) y
   despues lo abre en este visor. La primera vez tarda unos minutos; desde entonces abre directo (queda guardado en el CDE). */
// v0.25.7: también los RVT traídos de Forma que el CDE no leyó por su cuenta: se abren con la traducción de Autodesk (geometría exacta y todos sus parámetros)
const esForma = (x) => !!x && x.origen === 'forma' && (/\.(nwd|nwc|nwf)$/i.test(x.archivo || '') || (/\.rvt$/i.test(x.archivo || '') && !(x.indice && ['listo', 'en-cola', 'convirtiendo', 'armando', 'recibiendo'].includes(x.indice.estado) && (x.indice.estado !== 'listo' || x.geometria))));
let FPASO = null;
const PASOS_FORMA = [['prep', 'Preparar'], ['abrir', 'Abrir la traducción de Autodesk'], ['geo', 'Traer la geometría'], ['mallas', 'Revisar las piezas'], ['indice', 'Índice de parámetros (en el servidor)'], ['armar', 'Aligerar y armar la geometría del CDE'], ['subir', 'Guardar en el CDE']];
function paraFormaPaso() {
  if (!FPASO) return;
  try { FPASO.ifr.contentWindow.postMessage({ cdeParar: true }, location.origin); } catch (e) {}
  if (!FPASO.fin) api('/api/proyectos/' + PID + '/forma/modelos/' + FPASO.vid + '/cancelar', { json: {} }).catch(() => {});
  window.removeEventListener('message', FPASO.oye); FPASO.ifr.remove(); FPASO = null; $('estadoCarga').classList.remove('lado');
}
function pasaDesdeForma(vid, x, detalle) {
  const caja = $('estadoCarga');
  if (FPASO && FPASO.vid === vid && !FPASO.fin) return;   // ya se esta preparando
  paraFormaPaso();
  const pasos = {}, P = { vid, fin: false };
  const pinta = (extra) => {
    caja.classList.remove('oculto'); caja.classList.add('lado');
    caja.innerHTML = '<b>' + esc(x.contenedor || x.archivo) + '</b><br><small>Vino de Autodesk Forma. El CDE lo prepara con la traducción que Autodesk ya hizo (no se encarga una nueva). La primera vez tarda unos minutos; después abre directo.</small>' +
      '<div class="fpasos">' + PASOS_FORMA.map(([k, t]) => { const s = pasos[k] || {}; return '<div class="fpaso ' + (s.e || '') + '"><i>' + (s.e === 'ok' ? '✓' : s.e === 'mal' ? '✗' : s.e === 'va' ? '…' : '·') + '</i> ' + t + (s.t ? ' <small>' + esc(s.t) + '</small>' : '') + (s.e === 'va' && typeof s.p === 'number' ? ' <small>' + Math.round(s.p * 100) + ' %</small>' : '') + '</div>'; }).join('') + '</div>' + (extra || '');
  };
  P.oye = (ev) => {
    const m = ev.data; if (ev.origin !== location.origin || !m || !m.cdePaso || m.vid !== vid || FPASO !== P) return;
    if (m.k) { pasos[m.k] = { e: m.e, t: m.t, p: m.p }; pinta('<button id="fpParar" class="mini" style="margin-top:8px">Cancelar</button>'); const b = $('fpParar'); if (b) b.onclick = () => { paraFormaPaso(); caja.innerHTML = 'Cancelado. <button id="fpOtra" class="mini">Preparar de nuevo</button>'; $('fpOtra').onclick = () => pasaDesdeForma(vid, x); }; }
    if (m.fin) {
      P.fin = true; window.removeEventListener('message', P.oye);
      if (m.ok) { P.ifr.remove(); FPASO = null; caja.classList.remove('lado'); if (vid === VID) { const l = LISTA.find(z => z.vid === vid); if (l) { l.indice = { estado: 'listo', geometria: true, elementos: m.elementos }; l.geometria = true; } cargaModelo(); } return; }
      for (const k of Object.keys(pasos)) if (pasos[k].e === 'va') pasos[k].e = 'mal';
      const que = m.status === 403 ? 'Tu nivel de acceso no permite prepararlo: pídeselo a un autor del proyecto.' : m.codigo === 'forma-sin-conexion' || m.status === 401 ? 'Conecta tu cuenta de Autodesk: Integración con otros CDE → Autodesk Forma → Conectar.' : m.error;
      pinta('<div style="margin-top:8px;color:#e8a49a">' + esc(que) + '</div><button id="fpOtra" class="mini" style="margin-top:8px">Intentar de nuevo</button>');
      $('fpOtra').onclick = () => { paraFormaPaso(); pasaDesdeForma(vid, x); };
    }
  };
  window.addEventListener('message', P.oye);
  P.ifr = document.createElement('iframe'); P.ifr.id = 'fpaso'; P.ifr.title = 'Visor de Autodesk (preparando el modelo de Forma)';
  P.ifr.src = 'forma-paso.html?pid=' + encodeURIComponent(PID) + '&vid=' + encodeURIComponent(vid) + (detalle ? '&detalle=' + encodeURIComponent(detalle) : '');
  document.body.appendChild(P.ifr); FPASO = P; pinta();
}
/** Antes de bajar la geometria: ¿el CDE ya termino de leer este modelo? Si lo esta leyendo, muestra el avance y espera. */
async function modeloListo(vid) {
  clearTimeout(VIGIA);
  let st; try { st = await api('/api/modelos/' + PID + '/' + vid + '/estado'); } catch (e) { st = { estado: 'error', error: e.message }; }
  if (vid !== VID) return false;
  const x = LISTA.find(l => l.vid === vid) || {}, legible = /\.(ifc|rvt)$/i.test(x.archivo || ''), caja = $('estadoCarga');
  // un NWD de Forma armado antes de la v0.13.6 (sin pasar los ids de SVF2 a los del indice: piezas en elementos equivocados) o de la
  // v0.13.7 (tipos de Revit como elementos y aligerado por rejilla) o de la v0.13.8 (ejes sin malla como elementos, sin aristas
  // precalculadas) o de la v0.13.9 (lo que va completo elegido por el largo, cajas sin orientar) se rehace solo; reutiliza el
  // indice que ya tiene el CDE
  // v0.25.9: un RVT de Forma armado antes de esta versión (todo el modelo como un solo elemento: una caja) también se rehace solo
  const rsF = st.resumen || {}, rvtForma = !!x && x.origen === 'forma' && /\.rvt$/i.test(x.archivo || ''), formaSinIds = (esForma(x) || rvtForma) && st.estado === 'listo' && st.geometria && rsF.origen === 'Traducción de Autodesk Forma' && !(rsF.ids && (rsF.arbol === 'navisworks-3' || rsF.arbol === 'navisworks-4' || rsF.arbol === 'no-aplica') && rsF.aristas && rsF.criterio === 'cdeg-4' && (!rvtForma || rsF.reglaElem === 2));
  if (st.estado === 'listo' && st.geometria && !formaSinIds) return true;
  caja.classList.remove('oculto');
  if ((esForma(x) || formaSinIds) && !['en-cola', 'convirtiendo', 'armando', 'recibiendo'].includes(st.estado)) { pasaDesdeForma(vid, x); return false; }
  if (st.estado === 'sin-indice' && legible) {   // aun no se proceso: se pide ahora
    try { await api('/api/modelos/' + PID + '/' + vid + '/procesar', { method: 'POST' }); st = { estado: 'en-cola' }; } catch (e) { caja.textContent = 'Este modelo aún no se ha procesado y tu nivel de acceso no permite procesarlo: pídeselo a quien lo cargó.'; return false; }
  }
  if (['en-cola', 'convirtiendo', 'armando', 'recibiendo'].includes(st.estado)) {
    const a = st.avance || {}, fase = a.fase && FASE_MODELO[a.fase] ? FASE_MODELO[a.fase] + (a.total ? ' ' + Math.round(100 * a.n / a.total) + ' %' : '') : '';
    caja.innerHTML = 'El CDE está leyendo ' + esc(x.contenedor || 'el modelo') + ': ' + esc((ESTADO_MODELO[st.estado] || st.estado).toLowerCase()) + (fase ? ' — ' + esc(fase) : '') + '…<br><small>Se abrirá solo cuando termine.</small>';
    VIGIA = setTimeout(() => { if (vid === VID) cargaModelo(); }, 3000); return false;
  }
  if (st.estado === 'listo') { caja.textContent = 'El modelo se leyó, pero no trae geometría visible (solo datos).'; return false; }
  caja.innerHTML = esc(ESTADO_MODELO[st.estado] || 'Este archivo no tiene modelo para el visor') + (st.error ? ': ' + esc(st.error) : '.') + (legible ? '<br><button id="reproc" class="mini" style="margin-top:8px">Volver a procesar</button>' : '') +
    '';
  const b = $('reproc'); if (b) b.onclick = async () => { b.disabled = true; try { await api('/api/modelos/' + PID + '/' + vid + '/procesar', { method: 'POST' }); cargaModelo(); } catch (e) { caja.textContent = e.message; } };
  return false;
}
async function cargaModelo() {
  if (FPASO && FPASO.vid !== VID) paraFormaPaso();
  $('estadoCarga').classList.remove('oculto'); $('estadoCarga').textContent = 'Bajando geometría…';
  limpiaMedidas(); quitaSeccion(); limpiaCapa(); V.alCambiarModelo.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
  if (G) { escena.remove(G.mallaOp, G.mallaTr, G.sombra); if (G.aristas) escena.remove(G.aristas); if (G.mallaLin) { escena.remove(G.mallaLin); G.mallaLin.geometry.dispose(); } G.geoOp.dispose(); G.geoTr.dispose(); G = null; }
  SEL = null; VIS = null; OCULTOS = new Set(); FILTROS.length = 0; COLOREAR = '';
  if (!(await modeloListo(VID))) return;
  $('estadoCarga').textContent = 'Bajando geometría…';
  // v0.27.0 · un modelo pesado llega por partes (niveles y sectores), completas: se cargan las elegidas o las que entran en el presupuesto
  const sel = await partesACargar(); if (sel === false) return;
  const r = await fetch('/api/modelos/' + PID + '/' + VID + '/geometria' + (sel && PARTES && sel.length < PARTES.partes.length ? '?partes=' + sel.join(',') : '')   /* todas las partes = el archivo completo (ya comprimido en el servidor) */, { cache: 'no-store' }); if (!r.ok) { $('estadoCarga').textContent = 'Esta versión no trae geometría.'; return; }
  let D; try { D = parseaCdeg(await r.arrayBuffer()); } catch (e) { $('estadoCarga').textContent = e.message; return; }
  const pos = new THREE.BufferAttribute(D.posiciones, 3), col = new THREE.BufferAttribute(D.colores, 3);
  const geoOp = new THREE.BufferGeometry(); geoOp.setAttribute('position', pos); geoOp.setAttribute('color', col); // las normales se calculan con TODOS los triangulos (opacos y vidrio): si no, el vidrio queda sin normal y se ve negro
  { const todo = new Uint32Array(D.abs.length + D.absTr.length); todo.set(D.abs, 0); todo.set(D.absTr, D.abs.length); geoOp.setIndex(new THREE.BufferAttribute(todo, 1)); geoOp.computeVertexNormals(); geoOp.computeBoundingBox(); geoOp.computeBoundingSphere(); }
  geoOp.setIndex(new THREE.BufferAttribute(D.abs, 1));
  const geoTr = new THREE.BufferGeometry(); geoTr.setAttribute('position', pos); geoTr.setAttribute('color', col); geoTr.setAttribute('normal', geoOp.attributes.normal); geoTr.setIndex(new THREE.BufferAttribute(D.absTr, 1)); geoTr.boundingBox = geoOp.boundingBox; geoTr.boundingSphere = geoOp.boundingSphere;
  const mallaOp = new THREE.Mesh(geoOp, MAT.opaco); mallaOp.castShadow = true; mallaOp.receiveShadow = false;   // el volumen lo da la oclusion ambiental; la sombra arrojada va solo al suelo, suave
  const mallaTr = new THREE.Mesh(geoTr, MAT.vidrio); mallaTr.renderOrder = 2;
  escena.add(mallaOp, mallaTr);
  let mallaLin = null;   // v0.9.15: vegetacion dibujada con lineas
  if (D.lineas && D.lineas.nS) { const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.BufferAttribute(D.lineas.pos, 3)); gl.setAttribute('color', new THREE.BufferAttribute(D.lineas.col, 3, true)); mallaLin = new THREE.LineSegments(gl, MAT.lineas); escena.add(mallaLin); }
  const caja = geoOp.boundingBox.clone(), tam = caja.getSize(new THREE.Vector3()), centro = caja.getCenter(new THREE.Vector3());
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(tam.x * 3 + 20, tam.z * 3 + 20), new THREE.ShadowMaterial({ opacity: 0.2 }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.set(centro.x, caja.min.y - 0.02, centro.z); sombra.receiveShadow = true; escena.add(sombra);
  const rad = tam.length() / 2; sol.position.copy(centro).add(new THREE.Vector3(rad * 1.25, rad * 1.2, rad * 0.38)); sol.target.position.copy(centro);
  const sc = sol.shadow.camera; sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 0.1; sc.far = rad * 5; sc.updateProjectionMatrix();
  G = Object.assign(D, { geoOp, geoTr, mallaOp, mallaTr, mallaLin, colores: col, caja, sombra, aristas: null, pos });
  encuadra();
  $('cifras').textContent = num(D.nElem) + ' elementos · ' + num(D.nIdx / 3) + ' triángulos' + (mallaLin ? ' · ' + num(D.lineas.nS) + ' líneas' : '') + ' · ' + (D.meta.modelo || '');
  pintaFidelidad(D.meta);
  $('estadoCarga').textContent = 'Leyendo el índice…';
  EL = await api('/api/modelos/' + PID + '/' + VID + '/elementos');
  EL.idx = new Map(EL.columnas.e.map((e, i) => [e, i]));
  PARAMS = null; MOSTRAR_AMB = false; marcaAmbientes();
  $('estadoCarga').classList.add('oculto');
  aplicaEstilo(); selecciona(null);
  if ((G.arisPre || D.nIdx / 3 <= 6000000) && !(G.aristas && G.aristas.visible)) muestraAristas(true);   // v0.9.15: con aristas precalculadas, siempre   // como Revit / Forma: los bordes de cada elemento, de entrada (se apagan con «Aristas»)
  if (!MODULO || MODULO === 'filtros') abreModulo('filtros'); else abreModulo(MODULO, true);
  V.alCargarModelo.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
  cuentaIncidencias();
  if (INC && !G.incAbierta) { G.incAbierta = true; abreIncidencia(INC).catch(e => console.warn(e)); }
}

function encuadra(caja) {
  if (!G) return;
  const b = caja || G.caja, c = b.getCenter(new THREE.Vector3()), r = Math.max(0.5, b.getSize(new THREE.Vector3()).length() / 2);
  const dir = new THREE.Vector3().subVectors(camara.position, control.target); if (dir.lengthSq() < 1e-6 || !caja) dir.set(1, 0.8, 1);
  dir.normalize();
  camara.position.copy(c).add(dir.multiplyScalar(r * 1.9)); camara.near = Math.max(0.02, r / 2000); camara.far = Math.max(2000, r * 60); camara.updateProjectionMatrix();
  control.target.copy(c); control.update();
}
function cajaDe(set, D) {
  D = D || G; const C = cajasDe(D), CL = cajasLinDe(D), b = new THREE.Box3();
  for (const e of set) for (const c of [C.get(e), CL.get(e)]) { if (c) { b.min.x = Math.min(b.min.x, c[0]); b.min.y = Math.min(b.min.y, c[1]); b.min.z = Math.min(b.min.z, c[2]); b.max.x = Math.max(b.max.x, c[3]); b.max.y = Math.max(b.max.y, c[4]); b.max.z = Math.max(b.max.z, c[5]); } }
  return b.isEmpty() ? G.caja : b;
}

// ---------- estilos ----------
function aplicaEstilo() {
  if (!G) return;
  const e = $('estilo').value;
  if (e === 'mono') { G.mallaOp.material = MAT.mono; G.mallaTr.material = MAT.monoVidrio; render.shadowMap.enabled = false; if (!G.aristas) muestraAristas(true); else G.aristas.visible = true; herr('aristas').classList.add('activo'); }
  else { G.mallaOp.material = MAT.opaco; G.mallaTr.material = MAT.vidrio; render.shadowMap.enabled = e === 'realista'; sol.intensity = e === 'realista' ? 2.3 : 2.0; hemi.intensity = e === 'realista' ? 0.22 : 0.3; MAT.opaco.envMapIntensity = e === 'realista' ? 0.53 : 0.5; }
  relleno.visible = e !== 'mono';
  G.sombra.visible = e === 'realista';
  for (const m of [MAT.opaco, MAT.vidrio, MAT.mono, MAT.monoVidrio]) m.needsUpdate = true;
}
$('estilo').onchange = aplicaEstilo;
/** Aristas de lo opaco y del vidrio en una sola geometria (las del vidrio marcan las divisiones de puertas y mamparas). */
function aristasDe(geos) {
  const partes = geos.filter(g => g && g.index && g.index.count).map(g => new THREE.EdgesGeometry(g, 28));
  if (partes.length === 1) return partes[0];
  let n = 0; for (const p of partes) n += p.attributes.position.array.length;
  const a = new Float32Array(n); let o = 0;
  for (const p of partes) { a.set(p.attributes.position.array, o); o += p.attributes.position.array.length; p.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g;
}
// Lineas punteadas grises (como las que se ven en Forma): los bordes de muros, losas y techos que quedan justo detras del
// acabado (hasta 2 cm: pintura, tarrajeo). Dejan ver donde estan columnas, vigas y panos de ladrillo bajo el acabado. Se dibujan
// acercadas 2 cm a la camara: lo que esta mas al fondo sigue oculto. No se calculan para ventanas, puertas, mobiliario ni equipos.
const PUNTEADA_CM = 2, CAT_PUNTEADAS = /^(Muros|Suelos|Techos|Cubiertas|Pilares|Pilares estructurales|Armaz[oó]n estructural|Losas|Barridos de muro|Cimentaci[oó]n estructural)$/;
MAT.punteadas.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  mvPosition.xyz *= max(0.0, 1.0 - ' + (PUNTEADA_CM / 100).toFixed(4) + ' / max(length(mvPosition.xyz), 1e-3)); gl_Position = projectionMatrix * mvPosition;'); };
MAT.punteadas.customProgramCacheKey = () => 'punteadas-' + PUNTEADA_CM;
function punteadasDe() {
  if (!EL || !EL.idx || !G.geoOp.index) return null;
  const DC = EL.diccionarios, C = EL.columnas, si = new Uint8Array(G.geoOp.attributes.position.count);
  for (const x of G.elem) { const i = EL.idx.get(x.e); if (i != null && CAT_PUNTEADAS.test(DC.cat[C.cat[i]] || '')) si.fill(1, x.vo, x.vo + x.vc); }
  const idx = G.geoOp.index.array; let n = 0;
  for (let t = 0; t < idx.length; t += 3) if (si[idx[t]]) n += 3;
  if (!n) return null;
  const sel = new Uint32Array(n); let o = 0;
  for (let t = 0; t < idx.length; t += 3) if (si[idx[t]]) { sel[o++] = idx[t]; sel[o++] = idx[t + 1]; sel[o++] = idx[t + 2]; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', G.geoOp.attributes.position); g.setIndex(new THREE.BufferAttribute(sel, 1));
  const ls = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), MAT.punteadas); ls.computeLineDistances(); ls.renderOrder = 2.5;
  return ls;
}
/** v0.9.15: con las aristas precalculadas del .cdeg, el indice de las de los elementos visibles (sin calcular nada). */
function visibleAr() { const amb = G.ambientes && G.ambientes.size && !MOSTRAR_AMB ? G.ambientes : null; return (!VIS && !amb) ? null : (e) => (VIS ? VIS.has(e) : !amb.has(e)); }
function indiceAristasPre() {
  const ve = visibleAr(); if (!ve) return G.arisPre;
  let n = 0; for (const x of G.elem) if (x.ac && ve(x.e)) n += x.ac * 2;
  const out = new Uint32Array(n); let o = 0;
  for (const x of G.elem) if (x.ac && ve(x.e)) { out.set(G.arisPre.subarray(x.ao * 2, (x.ao + x.ac) * 2), o); o += x.ac * 2; }
  return out;
}
/** Las punteadas (muros, losas... detras del acabado) desde las aristas precalculadas: segmentos sueltos con su distancia. */
function punteadasPre() {
  if (!EL || !EL.idx) return null;
  const DC = EL.diccionarios, C = EL.columnas, P = G.posiciones, ve = visibleAr(), sel = [];
  let n = 0; for (const x of G.elem) { if (!x.ac || (ve && !ve(x.e))) continue; const i = EL.idx.get(x.e); if (i != null && CAT_PUNTEADAS.test(DC.cat[C.cat[i]] || '')) { sel.push(x); n += x.ac; } }
  if (!n) return null;
  const a = new Float32Array(n * 6); let o = 0;
  for (const x of sel) for (let q = x.ao * 2; q < (x.ao + x.ac) * 2; q++) { const v = G.arisPre[q]; a[o++] = P[v * 3]; a[o++] = P[v * 3 + 1]; a[o++] = P[v * 3 + 2]; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const ls = new THREE.LineSegments(g, MAT.punteadas); ls.computeLineDistances(); ls.renderOrder = 2.5; return ls;
}
function muestraAristas(si) {
  if (!G) return;
  if (si && !G.aristas && G.arisPre) {   // precalculadas: al instante, compartiendo las posiciones del modelo
    const g = new THREE.BufferGeometry(); g.setAttribute('position', G.pos); g.setIndex(new THREE.BufferAttribute(indiceAristasPre(), 1));
    G.aristas = new THREE.LineSegments(g, MAT.aristas); G.aristas.renderOrder = 3; const pu = punteadasPre(); if (pu) G.aristas.add(pu); escena.add(G.aristas);
  } else if (si && !G.aristas) {
    $('estadoCarga').classList.remove('oculto'); $('estadoCarga').textContent = 'Calculando aristas…';
    setTimeout(() => {
      try { const eg = aristasDe([G.geoOp, G.geoTr]); G.aristas = new THREE.LineSegments(eg, MAT.aristas); G.aristas.renderOrder = 3; const pu = punteadasDe(); if (pu) G.aristas.add(pu); escena.add(G.aristas); } catch (e) { alert('No se pudieron calcular las aristas: ' + e.message); }
      $('estadoCarga').classList.add('oculto');
    }, 30);
  } else if (G.aristas) G.aristas.visible = si;
  herr('aristas').classList.toggle('activo', si);
}

// ---------- visibilidad ----------
function reconstruyeIndices() {
  if (!G) return;
  const amb = G.ambientes && G.ambientes.size && !MOSTRAR_AMB ? G.ambientes : null;
  if (!VIS && !amb) { G.geoOp.setIndex(new THREE.BufferAttribute(G.abs, 1)); G.geoTr.setIndex(new THREE.BufferAttribute(G.absTr, 1)); }
  else {
    const o = [], t = [];
    // un ambiente oculto por defecto se ve si se lo pide expresamente (VIS lo trae: "abrir el ambiente")
    for (const x of G.elem) if (VIS ? VIS.has(x.e) : !amb.has(x.e)) for (const [src, ini, n, tr] of trozosDe(x)) { const dest = tr ? t : o; for (let k = ini; k < ini + n; k++) dest.push(src[k]); }
    G.geoOp.setIndex(new THREE.BufferAttribute(new Uint32Array(o), 1)); G.geoTr.setIndex(new THREE.BufferAttribute(new Uint32Array(t), 1));
  }
  if (G.mallaLin) {   // las lineas (vegetacion) siguen los mismos filtros y ocultos
    if (!VIS && !amb) G.mallaLin.geometry.setIndex(null);
    else { const l = []; for (const f of G.lineas.filas) if (VIS ? VIS.has(f.e) : !amb.has(f.e)) for (let q = f.so; q < f.so + f.sc; q++) l.push(q * 2, q * 2 + 1); G.mallaLin.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(l), 1)); }
  }
  if (G.aristas && G.arisPre) {   // precalculadas: solo se cambia el indice (la geometria comparte las posiciones: no se libera)
    G.aristas.geometry.setIndex(new THREE.BufferAttribute(indiceAristasPre(), 1));
    for (const h of [...G.aristas.children]) { G.aristas.remove(h); h.geometry.dispose(); }
    const pu = punteadasPre(); if (pu) G.aristas.add(pu);
  } else if (G.aristas) { escena.remove(G.aristas); G.aristas.traverse(o => { if (o.geometry) o.geometry.dispose(); }); G.aristas = null; if (herr('aristas').classList.contains('activo')) muestraAristas(true); }
  dibuja();
}
/** Deja visibles SOLO estos elementos (null = todos salvo ocultos) y encuadra si se pide. */
function muestraSolo(set, encuadrar) { VIS = set ? new Set(set) : null; if (OCULTOS.size) { VIS = VIS || new Set(G.elem.map(x => x.e)); for (const e of OCULTOS) VIS.delete(e); } reconstruyeIndices(); pintaEstadoFiltros(); if (encuadrar && VIS) encuadra(cajaDe(VIS)); }

// ---------- colores por elemento ----------
function pintaColor(x, rgb) { const c = G.colores.array, c0 = G.rgb8; for (let v = x.vo; v < x.vo + x.vc; v++) { if (rgb) { c[v * 3] = rgb[0]; c[v * 3 + 1] = rgb[1]; c[v * 3 + 2] = rgb[2]; } else { c[v * 3] = LUT8[c0[v * 3]]; c[v * 3 + 1] = LUT8[c0[v * 3 + 1]]; c[v * 3 + 2] = LUT8[c0[v * 3 + 2]]; } } G.colores.needsUpdate = true; }
let TINTES = new Map();   // e -> rgb lineal (colorear por / comparacion / conjuntos); la seleccion va encima
function aplicaTintes() { if (!G) return; for (const x of G.elem) pintaColor(x, TINTES.get(x.e) || null); if (SEL && G.porE.has(SEL.e)) pintaColor(G.elem[G.porE.get(SEL.e)], COLOR_SEL); for (const x of SELS) pintaColor(x, COLOR_SEL); dibuja(); }
const PALETA = ['#c8a24a', '#5aa9e6', '#7fc47f', '#e07a6a', '#b58bd8', '#f0b640', '#4fd1c5', '#e68ac0', '#9ab0c0', '#d4a373', '#8ecae6', '#ffafcc', '#a7c957', '#f4a261', '#90be6d', '#577590'];
const hexLin = (h) => [1, 3, 5].map(i => srgbLin(parseInt(h.slice(i, i + 2), 16) / 255));
let COLOREAR = '';
function coloreaPor(dim) {
  COLOREAR = dim; TINTES = new Map();
  if (dim && EL) { const C = EL.columnas, D = EL.diccionarios, mapa = new Map(); for (let i = 0; i < C.e.length; i++) { const k = D[dim][C[dim][i]]; if (!mapa.has(k)) mapa.set(k, hexLin(PALETA[mapa.size % PALETA.length])); TINTES.set(C.e[i], mapa.get(k)); } COLOREAR_LEY = mapa; }
  aplicaTintes(); pintaLeyenda();
}
let COLOREAR_LEY = new Map();
function pintaLeyenda() { const l = $('leyendaColor'); if (!l) return; if (!COLOREAR) { l.innerHTML = ''; return; } const it = [...COLOREAR_LEY.keys()].slice(0, 40); l.innerHTML = it.map((k, i) => '<span><i style="background:' + PALETA[i % PALETA.length] + '"></i>' + esc(k || '(vacío)') + '</span>').join('') + (COLOREAR_LEY.size > 40 ? '<span class="pista">… ' + (COLOREAR_LEY.size - 40) + ' más</span>' : ''); }

// ---------- filtros ("+ Añadir filtro", como el Visor BIM Federado) ----------
/** FILTROS: [{ id, tipo: 'dim'|'param', dim, param: { id, nombre }, valores: Set, vacio, elems: Set|null, cache: Map(valor -> Set e) }] */
const FILTROS = [];
let PARAMS = null, NF = 0;
async function parametros() { if (!PARAMS) PARAMS = await api('/api/modelos/' + PID + '/' + VID + '/parametros'); return PARAMS; }
/** El conjunto de elementos que pasa un filtro (null = no acota). */
function pasaFiltro(f) {
  if (f.tipo === 'grupo') { if (!f.valores.size) return null; const out = new Set(); for (const x of (f.lista || [])) if (f.valores.has(x.value)) for (const e of x.ids) out.add(e); return out; }
  if (f.tipo === 'dim') { if (!f.valores.size) return null; const C = EL.columnas, D = EL.diccionarios, out = new Set(); for (let i = 0; i < C.e.length; i++) if (f.valores.has(D[f.dim][C[f.dim][i]])) out.add(C.e[i]); return out; }
  if (!f.valores.size && !f.vacio) return null;
  const out = new Set(); for (const v of f.valores) for (const e of (f.cache.get(v) || [])) out.add(e); if (f.vacio) for (const e of (f.cache.get('__vacio__') || [])) out.add(e);
  return out;
}
/** Elementos que pasan todos los filtros salvo `sin` (para contar los valores de ese filtro). */
function pasanTodos(sin) {
  let out = null;
  for (const f of FILTROS) { if (f === sin) continue; const s = pasaFiltro(f); if (!s) continue; if (!out) out = new Set(s); else for (const e of out) if (!s.has(e)) out.delete(e); }
  return out;   // null = todos
}
async function cargaValoresParam(f) {
  // los valores del parametro en el ambito de los otros filtros de dimension (el servidor filtra por modelo/cat/fam/tip/niv)
  const qs = new URLSearchParams({ param: f.param.id, conCero: '1' });
  for (const g of FILTROS) if (g !== f && g.tipo === 'dim' && g.valores.size) qs.set(g.dim, [...g.valores].join('\u0001'));
  const r = await api('/api/modelos/' + PID + '/' + VID + '/valores?' + qs);
  f.lista = r.valores;   // [{ v, n, hueco }]
}
async function elementosConValor(f, v) {
  if (f.cache.has(v)) return f.cache.get(v);
  const qs = new URLSearchParams({ param: f.param.id }); if (v === '__vacio__') qs.set('vacio', '1'); else qs.set('valores', v);
  const r = await api('/api/modelos/' + PID + '/' + VID + '/elementos-con?' + qs); const s = new Set(r.e); f.cache.set(v, s); return s;
}
function recalcula(encuadrar) {
  if (!G || !EL) return;
  const s = pasanTodos(null);
  VIS = s ? new Set(s) : null;
  if (OCULTOS.size) { VIS = VIS || new Set(G.elem.map(x => x.e)); for (const e of OCULTOS) VIS.delete(e); }
  reconstruyeIndices(); pintaFiltros(); pintaEstadoFiltros();
  if (encuadrar && VIS && FILTROS.some(f => f.valores.size || f.vacio)) encuadra(cajaDe(VIS));
  V.alRecalcular.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } });
}
function pintaEstadoFiltros() { const n = $('filtrosN'); if (!n) return; const act = FILTROS.filter(f => f.valores.size || f.vacio).length; n.textContent = (VIS ? num(VIS.size) + ' de ' : '') + num(G ? G.nElem : 0) + ' elementos' + (act ? ' · ' + act + ' filtro(s)' : '') + (OCULTOS.size ? ' · ' + OCULTOS.size + ' ocultos' : ''); }
async function anadeFiltro(def) {
  const f = Object.assign({ id: ++NF, valores: new Set(), vacio: false, cache: new Map(), lista: null, q: '' }, def);
  FILTROS.push(f);
  if (f.tipo === 'param') await cargaValoresParam(f);
  pintaFiltros(); return f;
}
function quitaFiltro(f) { const i = FILTROS.indexOf(f); if (i >= 0) FILTROS.splice(i, 1); recalcula(false); }
async function alternaValor(f, v, si) {
  if (si) { if (f.tipo === 'param') await elementosConValor(f, v); f.valores.add(v); } else f.valores.delete(v);
  if (f.tipo === 'grupo') { f.cache.set(v, new Set(((f.lista || []).find(x => x.value === v) || { ids: [] }).ids)); }
  recalcula(true);
}
/** Las barras dinamicas de una dimension (cuentan lo que pasa el resto de filtros). */
function cuentaDim(dim, sinFiltroDe) {
  const base = pasanTodos(sinFiltroDe), C = EL.columnas, D = EL.diccionarios, cuenta = new Map();
  for (let i = 0; i < C.e.length; i++) { if (base && !base.has(C.e[i])) continue; const k = D[dim][C[dim][i]]; cuenta.set(k, (cuenta.get(k) || 0) + 1); }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
}
let DIM = 'cat';
function pintaFiltros() {
  if ((MODULO !== 'filtros' && MODULO !== 'sectores') || !$('filtrosLista')) return;   // 'sectores' = el mismo panel (Filtro con sectores)
  const cont = $('filtrosLista');
  cont.innerHTML = FILTROS.map(f => {
    const titulo = f.tipo === 'dim' ? DIMS[f.dim] : f.tipo === 'grupo' ? f.titulo : f.param.nombre;
    let vals;
    if (f.tipo === 'grupo') vals = (f.lista || []).map(x => ({ v: x.value, n: x.ids.length }));
    else if (f.tipo === 'dim') { const fd = FILTROS.find(g => g.tipo === 'dim' && g.dim === f.dim); vals = cuentaDim(f.dim, fd).map(([v, n]) => ({ v, n })); }
    else vals = (f.lista || []).map(x => ({ v: x.v, n: x.n, hueco: x.hueco }));
    const q = (f.q || '').toLowerCase(); if (q) vals = vals.filter(x => String(x.v).toLowerCase().includes(q));
    const marcados = vals.filter(x => f.valores.has(x.v)), resto = vals.filter(x => !f.valores.has(x.v));
    const fila = (x) => '<label class="val' + (x.hueco ? ' hueco' : '') + '"><input type="checkbox" data-f="' + f.id + '" data-v="' + esc(x.v) + '"' + (f.valores.has(x.v) ? ' checked' : '') + '><span title="' + esc(x.v) + '">' + esc(x.v || '(vacío)') + '</span><i>' + num(x.n) + '</i></label>';
    return '<div class="filtro" data-f="' + f.id + '"><div class="ft"><b title="' + esc(titulo) + '">' + esc(titulo) + '</b><span class="pista">' + (f.valores.size ? f.valores.size + ' ✓' : '') + '</span><button data-limpia="' + f.id + '" title="Quitar valores">○</button><button data-quita="' + f.id + '" title="Quitar filtro">✕</button></div>' +
      '<input data-q="' + f.id + '" placeholder="Buscar valor…" value="' + esc(f.q || '') + '" style="margin:4px 0;padding:3px 6px;font-size:12px">' +
      '<div class="vals">' + marcados.map(fila).join('') + (f.tipo === 'param' ? '<label class="val hueco"><input type="checkbox" data-f="' + f.id + '" data-v="__vacio__"' + (f.vacio ? ' checked' : '') + '><span>(sin valor)</span><i></i></label>' : '') + resto.slice(0, 400).map(fila).join('') + (resto.length > 400 ? '<div class="pista">… ' + (resto.length - 400) + ' valores más: usa el buscador</div>' : '') + '</div></div>';
  }).join('') || '<p class="pista">Sin filtros. Pulsa <b>+ Añadir filtro</b> y elige un parámetro: aparecen sus valores con el número de elementos; marca los que quieras ver.</p>';
  cont.querySelectorAll('input[type=checkbox]').forEach(ch => ch.onchange = () => { const f = FILTROS.find(x => x.id === +ch.dataset.f); if (ch.dataset.v === '__vacio__') { f.vacio = ch.checked; if (ch.checked) elementosConValor(f, '__vacio__').then(() => recalcula(true)); else recalcula(true); } else alternaValor(f, ch.dataset.v, ch.checked); });
  cont.querySelectorAll('input[data-q]').forEach(i => i.oninput = () => { const f = FILTROS.find(x => x.id === +i.dataset.q); f.q = i.value; const pos = i.selectionStart; pintaFiltros(); const j = $('filtrosLista').querySelector('input[data-q="' + f.id + '"]'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } });
  cont.querySelectorAll('button[data-quita]').forEach(b => b.onclick = () => quitaFiltro(FILTROS.find(x => x.id === +b.dataset.quita)));
  cont.querySelectorAll('button[data-limpia]').forEach(b => b.onclick = () => { const f = FILTROS.find(x => x.id === +b.dataset.limpia); f.valores.clear(); f.vacio = false; recalcula(false); });
  // barras dinamicas
  const fd = FILTROS.find(g => g.tipo === 'dim' && g.dim === DIM), items = cuentaDim(DIM, fd).slice(0, 300);
  const l = $('barrasDim'); if (l) {
    l.innerHTML = barras(items, fd && fd.valores.size === 1 ? [...fd.valores][0] : '', null);
    l.querySelectorAll('.barra[data-k]').forEach(b => b.onclick = async () => { let f = fd; if (!f) f = await anadeFiltro({ tipo: 'dim', dim: DIM }); if (f.valores.has(b.dataset.k)) f.valores.delete(b.dataset.k); else { if (f.valores.size === 1) f.valores.clear(); f.valores.add(b.dataset.k); } recalcula(true); });
  }
  V.alPintarFiltros.forEach(fn => { try { fn(cont); } catch (e) { console.warn(e); } });
}
/** El selector de parametro: Normalizado (Modelo/Categoría/…) + Parámetros del proyecto agrupados por su prefijo ("Identidad / UniqueId" -> grupo Identidad). */
async function selectorParametro(ancla, alElegir) {
  const P = await parametros(), lista = Array.isArray(P) ? P : (P.parametros || []);
  const grupos = new Map(); for (const p of lista) { if (/^●/.test(p.nombre)) continue; const i = p.nombre.indexOf(' / '); const g = i > 0 ? p.nombre.slice(0, i) : 'Otros'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); }
  const d = document.createElement('div'); d.className = 'selparam'; const r = ancla.getBoundingClientRect(); d.style.left = Math.min(r.left, innerWidth - 340) + 'px'; d.style.top = Math.min(r.bottom + 4, innerHeight - 390) + 'px';
  d.innerHTML = '<input placeholder="Buscar parámetro…"><div class="lista"></div>'; document.body.appendChild(d);
  const pinta = (q) => {
    q = (q || '').toLowerCase(); let h = '';
    const norm = Object.entries(DIMS).filter(([k, n]) => !q || n.toLowerCase().includes(q)); if (norm.length) h += '<div class="g">Normalizado</div>' + norm.map(([k, n]) => '<div class="o" data-dim="' + k + '">● ' + n + '</div>').join('');
    for (const [g, ps] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) { const f = ps.filter(p => !q || p.nombre.toLowerCase().includes(q)); if (!f.length) continue; h += '<div class="g">' + esc(g) + '</div>' + f.slice(0, 200).map(p => '<div class="o" data-p="' + p.id + '" title="' + esc(p.nombre) + '">' + esc(p.nombre.slice(p.nombre.indexOf(' / ') > 0 ? p.nombre.indexOf(' / ') + 3 : 0)) + '</div>').join(''); }
    d.querySelector('.lista').innerHTML = h || '<div class="o pista">Nada coincide.</div>';
    d.querySelectorAll('.o[data-dim]').forEach(o => o.onclick = () => { cierra(); alElegir({ tipo: 'dim', dim: o.dataset.dim }); });
    d.querySelectorAll('.o[data-p]').forEach(o => o.onclick = () => { cierra(); const p = lista.find(x => x.id === +o.dataset.p); alElegir({ tipo: 'param', param: p }); });
  };
  const cierra = () => { d.remove(); document.removeEventListener('mousedown', fuera); };
  const fuera = (e) => { if (!d.contains(e.target)) cierra(); };
  setTimeout(() => document.addEventListener('mousedown', fuera), 0);
  d.querySelector('input').oninput = (e) => pinta(e.target.value); pinta(''); d.querySelector('input').focus();
}

// ---------- paneles y modulos ----------
let MODULO = '';
const herr = (k) => document.querySelector('.herramientas button[data-h="' + k + '"]');
/**
 * v0.27.0 · PARTES DEL MODELO. Un modelo pesado no se recorta: el servidor lo sirve por partes (cada nivel y, si es grande, sus
 * sectores) con todo su detalle, y aquí se elige cuáles cargar. Por defecto, las que entran en el presupuesto de triángulos de este
 * equipo. El índice (filtros, inventario, propiedades) es siempre el del modelo completo.
 */
let PARTES = null;   // { partes, total, sel } del modelo abierto, o null si va entero
const PRESUP = () => Number(localStorage.getItem('cde-visor-presupuesto')) || 12000000;   // por defecto 12 M: lo que el visor ya abría entero
async function partesACargar() {
  PARTES = null; const b = $('partes'); if (b) b.classList.add('oculto');
  let p;
  for (let k = 0; ; k++) {
    try { p = await api('/api/modelos/' + PID + '/' + VID + '/partes'); } catch (e) { return null; }   // sin partes: el modelo entero, como siempre
    if (!p.aplica) return null;
    if (p.estado === 'listo') break;
    if (p.estado === 'error') { $('estadoCarga').textContent = 'No se pudo dividir el modelo en partes: ' + (p.error || ''); return false; }
    $('estadoCarga').textContent = 'Modelo pesado (' + num(p.triangulos || 0) + ' triángulos): el CDE lo está dividiendo en partes. Solo la primera vez…';
    if (k > 900) { $('estadoCarga').textContent = 'El CDE no terminó de dividir el modelo.'; return false; }
    await new Promise(ok => setTimeout(ok, 2000));
  }
  let sel = null; try { const g = JSON.parse(localStorage.getItem('cde-visor-partes-' + VID) || 'null'); if (g && g.de === p.partes.length && Array.isArray(g.sel) && g.sel.length) sel = g.sel.filter(n => p.partes[n]); } catch (e) {}
  if (!sel || !sel.length) { sel = []; let t = 0; for (const x of p.partes) { if (sel.length && t + x.triangulos > PRESUP()) continue; sel.push(x.n); t += x.triangulos; } }
  PARTES = { partes: p.partes, total: p.total, sel };
  const tri = sel.reduce((s, n) => s + p.partes[n].triangulos, 0);
  $('estadoCarga').textContent = 'Bajando ' + sel.length + ' de ' + p.partes.length + ' partes (' + num(tri) + ' triángulos)…';
  pintaPartes();
  return sel;
}
function pintaPartes() {
  const b = $('partes'); if (!b || !PARTES) return;
  const P = PARTES, tri = (l) => l.reduce((s, n) => s + P.partes[n].triangulos, 0), todo = P.sel.length === P.partes.length;
  b.classList.remove('oculto'); b.classList.toggle('parcial', !todo);
  b.textContent = todo ? 'Modelo completo · ' + P.partes.length + ' partes' : 'Partes: ' + P.sel.length + ' de ' + P.partes.length + ' · ' + Math.round(100 * tri(P.sel) / Math.max(1, P.total.triangulos)) + ' % del modelo';
  b.title = 'Este modelo es pesado y se carga por partes (niveles y sectores), cada una completa. Clic para elegir cuáles ver.';
  b.onclick = () => {
    const marc = new Set(P.sel), grupos = new Map(); for (const x of P.partes) { if (!grupos.has(x.grupo)) grupos.set(x.grupo, []); grupos.get(x.grupo).push(x); }
    const c = panel('Partes del modelo', '<p>El modelo tiene <b>' + num(P.total.triangulos) + '</b> triángulos en <b>' + P.partes.length + '</b> partes. Cada parte se carga <b>completa</b>, sin simplificar. Marca las que quieres ver; los filtros y el inventario siguen siendo de todo el modelo.</p>' +
      '<p class="pista">Presupuesto de este equipo: <select id="ptPres">' + [4, 8, 12, 20, 30].map(m => '<option value="' + m * 1e6 + '"' + (PRESUP() === m * 1e6 ? ' selected' : '') + '>' + m + ' millones de triángulos</option>').join('') + '</select></p>' +
      '<p><button class="mini" id="ptEntra">Lo que entre en el presupuesto</button> <button class="mini" id="ptNada">Ninguna</button> <button class="mini" id="ptTodo">Todas</button></p>' +
      '<div class="ptlista">' + [...grupos].map(([g, l]) => '<div class="ptgrupo"><label><input type="checkbox" data-g="' + esc(g) + '"> <b>' + esc(g) + '</b> <span class="pista">' + num(l.reduce((s, x) => s + x.triangulos, 0)) + ' triángulos' + (l.length > 1 ? ' · ' + l.length + ' sectores' : '') + '</span></label>' +
        (l.length > 1 ? l.map(x => '<label class="ptsec"><input type="checkbox" data-n="' + x.n + '"> ' + esc(x.etiqueta.replace(g + ' · ', '')) + ' <span class="pista">' + num(x.elementos) + ' elem. · ' + num(x.triangulos) + ' tri.</span></label>').join('') : '') + '</div>').join('') + '</div>' +
      '<p id="ptSuma" style="margin-top:8px"></p><p><button class="mini primario" id="ptCarga">Cargar la selección</button></p>');
    const refresca = () => {
      c.querySelectorAll('[data-n]').forEach(i => { i.checked = marc.has(Number(i.dataset.n)); });
      c.querySelectorAll('[data-g]').forEach(i => { const l = grupos.get(i.dataset.g), k = l.filter(x => marc.has(x.n)).length; i.checked = k === l.length; i.indeterminate = k > 0 && k < l.length; });
      const t = tri([...marc]), pasa = t > PRESUP();
      c.querySelector('#ptSuma').innerHTML = '<b>' + marc.size + '</b> partes · <b>' + num(t) + '</b> triángulos (' + Math.round(100 * t / Math.max(1, P.total.triangulos)) + ' % del modelo)' + (pasa ? '<br><span style="color:#f0cf7a">Pasa del presupuesto de este equipo: puede ir lento o cerrar la pestaña.</span>' : '');
      c.querySelector('#ptCarga').disabled = !marc.size;
    };
    c.querySelectorAll('[data-n]').forEach(i => i.onchange = () => { const n = Number(i.dataset.n); if (i.checked) marc.add(n); else marc.delete(n); refresca(); });
    c.querySelectorAll('[data-g]').forEach(i => i.onchange = () => { for (const x of grupos.get(i.dataset.g)) { if (i.checked) marc.add(x.n); else marc.delete(x.n); } refresca(); });
    c.querySelector('#ptPres').onchange = (e) => { localStorage.setItem('cde-visor-presupuesto', e.target.value); refresca(); };
    c.querySelector('#ptEntra').onclick = () => { marc.clear(); let t = 0; for (const x of P.partes) { if (marc.size && t + x.triangulos > PRESUP()) continue; marc.add(x.n); t += x.triangulos; } refresca(); };
    c.querySelector('#ptNada').onclick = () => { marc.clear(); refresca(); };
    c.querySelector('#ptTodo').onclick = () => { for (const x of P.partes) marc.add(x.n); refresca(); };
    c.querySelector('#ptCarga').onclick = () => { localStorage.setItem('cde-visor-partes-' + VID, JSON.stringify({ de: P.partes.length, sel: [...marc].sort((a, b) => a - b) })); $('panel').classList.add('oculto'); cargaModelo(); };
    refresca();
  };
}
/**
 * v0.26.0 · FIDELIDAD DE LA GEOMETRÍA. Un modelo de Forma muy pesado no entra completo en el navegador: al prepararlo, el CDE simplifica
 * piezas, deja el acero de refuerzo solo con propiedades y, pasado el límite, dibuja elementos como su caja. Eso ya no pasa en silencio:
 * el botón de la barra superior dice si la geometría va completa o aligerada, con las cifras, y deja volver a prepararla con más detalle.
 */
function fidelidadDe(meta) {
  const f = meta && meta.fidelidad, a = meta && meta.aligerado;
  if (f) return f;
  if (a) return { detalle: 'normal', triangulosEntrada: a.triangulosEntrada, triangulos: a.triangulos, piezasAligeradas: a.piezasAligeradas, tolerancia: a.tolerancia, enCaja: a.enCaja, topeSeguro: a.topeSeguro, acero: a.acero, antigua: true };
  return null;
}
function pintaFidelidad(meta) {
  const b = $('fidelidad'); if (!b) return;
  const f = fidelidadDe(meta), deForma = /Autodesk Forma/.test((meta && meta.herramienta) || '');
  if (!f && !deForma) { b.classList.add('oculto'); return; }
  const reducida = !!f && ((f.piezasAligeradas || 0) + (f.enCaja || 0) + (f.acero || 0) + (f.lineasAuxiliares || 0) + (f.lineasOmitidas || 0) + (f.lineasSinElemento || 0) > 0);
  const sueltas = !!f && ((f.piezasSinElemento || 0) + (f.lineasSueltas || 0) > 0);   // v0.27.1: dibujadas, pero sin unir a su elemento del índice
  b.classList.remove('oculto'); b.classList.toggle('reducida', reducida || sueltas);
  b.textContent = !f ? 'Geometría: sin informe' : reducida ? '⚠ Geometría aligerada' : sueltas ? '⚠ Geometría completa · piezas sin vincular' : '✓ Geometría completa';
  b.title = 'Qué tan fiel es esta geometría a la de Autodesk Forma (clic para ver el detalle)';
  b.onclick = () => {
    const fila = (n, t, mal) => '<tr' + (mal && n ? ' class="fmal"' : '') + '><td class="n">' + num(n || 0) + '</td><td>' + t + '</td></tr>';
    const cm = f && f.tolerancia ? (f.tolerancia * 100).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' cm' : '1 cm';
    const NOM = { normal: 'Normal (4 M de triángulos de objetivo)', alto: 'Alto (10 M de objetivo, 25 M de límite)', maximo: 'Máximo (sin simplificar)' };
    const x = LISTA.find(z => z.vid === VID);
    const c = panel('Fidelidad de la geometría', !f ? '<p>Este modelo se preparó con una versión anterior del CDE y no guardó su informe. Vuelve a prepararlo para tenerlo.</p>' :
      '<p>Triángulos en Autodesk Forma: <b>' + num(f.triangulosEntrada || 0) + '</b> · en el CDE: <b>' + num(f.triangulos || 0) + '</b>' + (f.triangulosEntrada ? ' (' + Math.round(100 * (f.triangulos || 0) / f.triangulosEntrada) + ' %)' : '') + '<br>Nivel de detalle con que se preparó: <b>' + (NOM[f.detalle] || NOM.normal) + '</b></p>' +
      '<table class="tfid">' +
      fila(f.enCaja, 'elemento(s) dibujados como su <b>caja</b> (no con su forma) por pasar de ' + num(f.topeSeguro || 0) + ' triángulos', true) +
      fila(f.acero, 'pieza(s) de <b>acero de refuerzo</b> sin geometría (solo propiedades)', true) +
      fila(f.piezasAligeradas, 'pieza(s) <b>simplificadas</b> sin mover su superficie más de ' + cm + (f.triAntes ? ' (' + num(f.triAntes) + ' → ' + num(f.triDespues) + ' triángulos)' : ''), false) +
      fila(f.lineasAuxiliares, 'pieza(s) de <b>líneas auxiliares</b> (ejes, líneas de modelo, líneas de centro) no dibujadas', true) +
      fila(f.lineasOmitidas, 'pieza(s) de líneas no dibujadas por pasar el límite de segmentos', true) +
      fila(f.lineasSinElemento, 'pieza(s) de líneas no dibujadas por no tener elemento en el índice', true) +
      fila((f.piezasSinElemento || 0) + (f.lineasSueltas || 0), 'pieza(s) <b>dibujadas pero sin vincular</b> a un elemento del índice (se ven, pero no responden a los filtros ni muestran propiedades)', true) +
      '</table>' + (reducida ? '<p class="pista">Las propiedades de todos los elementos están completas en cualquier caso: lo que cambia es el dibujo.</p>' : sueltas ? '<p>No se simplificó ni se dejó fuera nada del dibujo, pero hay piezas sin vincular a sus propiedades.</p>' : '<p>Nada se simplificó ni se dejó fuera.</p>') +
      (f.diagnostico ? '<p style="margin-top:8px"><b>Diagnóstico de las piezas sin vincular</b> <button class="mini" id="fdCopia">Copiar</button></p><textarea id="fdTxt" readonly style="width:100%;height:110px;font:11px monospace">' + esc(f.diagnostico) + '</textarea>' : '')
      + (x && x.origen === 'forma' ? '<p style="margin-top:10px"><b>Volver a preparar con más detalle</b><br><span class="pista">Lo hace tu navegador con tu cuenta de Autodesk y reemplaza la geometría para todos. A más detalle, más memoria y tiempo: «Máximo» pide un equipo con 16 GB o más y puede cerrar la pestaña en modelos muy grandes.</span></p>' +
        '<p><button class="mini" data-det="normal">Normal</button> <button class="mini" data-det="alto">Alto</button> <button class="mini" data-det="maximo">Máximo</button></p>' : ''));
    { const bc = c.querySelector('#fdCopia'); if (bc) bc.onclick = () => { const t = c.querySelector('#fdTxt'); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } bc.textContent = 'Copiado'; }; }
    c.querySelectorAll('[data-det]').forEach(bt => bt.onclick = () => { $('panel').classList.add('oculto'); pasaDesdeForma(VID, x, bt.dataset.det); });
  };
}
function panel(titulo, html) { $('ptitulo').textContent = titulo; $('pcuerpo').innerHTML = html; $('panel').classList.remove('oculto'); return $('pcuerpo'); }
function cierraPanel() { $('panel').classList.add('oculto'); MODULO = ''; document.querySelectorAll('.carril .mod').forEach(m => m.classList.remove('activo')); }
$('pcerrar').onclick = cierraPanel;
(function arrastrePanel() { const p = $('panel'), cab = $('pcab'); let a = null; cab.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; a = { x: e.clientX - p.offsetLeft, y: e.clientY - p.offsetTop }; e.preventDefault(); }); window.addEventListener('mousemove', (e) => { if (!a) return; p.style.left = Math.max(0, e.clientX - a.x) + 'px'; p.style.top = Math.max(48, e.clientY - a.y) + 'px'; }); window.addEventListener('mouseup', () => { a = null; }); })();
const MODULOS = {};   // nombre -> (cuerpo) => void   (los de visor-modulos.js se registran al arrancar)
function abreModulo(m, silencioso) {
  if (MODULO === m && !silencioso && !$('panel').classList.contains('oculto')) { cierraPanel(); return; }
  MODULO = m; document.querySelectorAll('.carril .mod').forEach(x => x.classList.toggle('activo', x.dataset.m === m));
  if (MODULOS[m]) MODULOS[m](); else panel(m, '<p class="pista">Este módulo aún no está disponible.</p>');
}
document.querySelectorAll('.carril .mod').forEach(m => m.onclick = () => abreModulo(m.dataset.m));

MODULOS.filtros = () => {
  const c = panel('Filtros', '<div class="filab"><button class="primario" id="fAnade">+ Añadir filtro</button><button id="fLimpia" title="Quitar todos los filtros">Limpiar</button><span class="pista" id="filtrosN" style="margin-left:auto"></span></div>' +
    '<div id="filtrosLista"></div>' +
    '<div class="grupo"><h4>Colorear por<span class="hint">pinta cada valor de un color</span></h4><select id="fColor"><option value="">Colores del material</option>' + Object.entries(DIMS).map(([k, n]) => '<option value="' + k + '"' + (COLOREAR === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select><div class="leyenda" id="leyendaColor"></div></div>' +
    '<div class="grupo"><h4>Resumen<span class="hint">clic en una barra filtra</span></h4><div class="lienzo-pestanas">' + Object.entries(DIMS).filter(([k]) => k !== 'tip').map(([k, n]) => '<button data-d="' + k + '"' + (DIM === k ? ' class="activa"' : '') + '>' + n + '</button>').join('') + '</div><div id="barrasDim" class="pista">' + (EL ? '' : 'Elige un modelo.') + '</div></div>');
  c.querySelector('#fAnade').onclick = (e) => { if (!EL) return; selectorParametro(e.currentTarget, (def) => anadeFiltro(def).then(() => { const el = $('filtrosLista').querySelector('.filtro:last-child'); if (el) el.scrollIntoView({ block: 'nearest' }); })); };
  c.querySelector('#fLimpia').onclick = () => { FILTROS.length = 0; OCULTOS = new Set(); recalcula(false); encuadra(); };
  c.querySelector('#fColor').onchange = (e) => coloreaPor(e.target.value);
  c.querySelectorAll('.lienzo-pestanas button').forEach(b => b.onclick = () => { DIM = b.dataset.d; c.querySelectorAll('.lienzo-pestanas button').forEach(x => x.classList.toggle('activa', x === b)); pintaFiltros(); });
  if (EL) { pintaFiltros(); pintaEstadoFiltros(); pintaLeyenda(); }
  V.alAbrirFiltros.forEach(fn => { try { fn(c); } catch (e) { console.warn(e); } });
};
MODULOS.elemento = () => { panel('Elemento', '<div id="elemFicha" class="elemficha"></div>'); pintaElemento(); };
MODULOS.ayuda = () => panel('Atajos', '<div class="grupo"><h4>Ratón</h4><p>Arrastrar: girar · Rueda: acercar hacia donde apunta el ratón · <b>Desplazar (paneo):</b> apretar la rueda (botón central) o el botón derecho y arrastrar, Shift + arrastrar, o activar <b>Mover</b> en la barra de abajo y arrastrar · Clic: seleccionar · Doble clic: acercar al elemento.</p></div><div class="grupo"><h4>Teclas</h4><p><b>Esc</b> quita la selección o cancela la medida · <b>Enter</b> cierra un área · <b>P</b> activa o quita Mover · <b>Flechas</b> desplazan la vista (con Shift, más) · <b>F</b> encuadra · <b>H</b> oculta la selección · <b>I</b> aísla · <b>T</b> muestra todo.</p></div><div class="grupo"><h4>Módulos</h4><p>Cada módulo del carril abre su panel (se arrastra por el título). Las ventanas grandes (inventario, planos, resultados) se mueven por su cabecera y se agrandan por la esquina o con ▢.</p></div>');

// ---------- herramientas ----------
document.querySelectorAll('.herramientas button[data-h]').forEach(b => b.onclick = () => {
  const h = b.dataset.h; if (h === 'mover') { ponMover(!MOVER); return; }
  if (!G) return;
  if (h === 'encuadrar') encuadra(VIS ? cajaDe(VIS) : (SEL ? cajaDe(new Set([SEL.e])) : null));
  if (h === 'aislar' && SEL) { muestraSolo(new Set([SEL.e]), true); }
  if (h === 'ocultar' && SEL) { OCULTOS.add(SEL.e); selecciona(null); recalcula(false); }
  if (h === 'todo') { FILTROS.length = 0; OCULTOS = new Set(); V.alMostrarTodo.forEach(f => { try { f(); } catch (e) {} }); recalcula(false); encuadra(); }
  if (h === 'seccion') abreSeccion();
  if (h === 'medir') abreMedir();
  if (h === 'aristas') muestraAristas(!(G.aristas && G.aristas.visible));
  if (h === 'incidencia') nuevaIncidencia(SEL ? [SEL.e] : []);
});

// ---------- seleccion ----------
function pintaSeleccion(x, si) { pintaColor(x, si ? COLOR_SEL : (TINTES.get(x.e) || null)); }
function selecciona(x, sinPanel) {
  if (SEL && G && G.porE.has(SEL.e)) pintaSeleccion(G.elem[G.porE.get(SEL.e)], false);
  SEL = x ? { e: x.e, idx: G.porE.get(x.e) } : null;
  if (x) pintaSeleccion(x, true); dibuja();
  for (const k of ['aislar', 'ocultar', 'incidencia']) herr(k).disabled = !x;
  if (x && EL && EL.idx.has(x.e)) { const i = EL.idx.get(x.e), D = EL.diccionarios, C = EL.columnas; SEL.nombre = C.nombre[i]; SEL.cat = D.cat[C.cat[i]]; SEL.niv = D.niv[C.niv[i]]; SEL.fam = D.fam[C.fam[i]]; SEL.tip = D.tip[C.tip[i]]; }
  if (!sinPanel && x && MODULO !== 'elemento' && MODULO !== 'comparar' && MODULO !== 'conjuntos' && MODULO !== 'inventario') abreModulo('elemento', true);
  pintaElemento();
  V.alSeleccionar.forEach(f => { try { f(SEL); } catch (e) {} });
}
function pintaElemento() {
  const d = $('elemFicha'); if (!d) return;
  if (!SEL) { d.innerHTML = '<p class="pista">Haz clic en el modelo para ver el elemento. Doble clic: acercar.</p>'; return; }
  const tam = cajaDe(new Set([SEL.e])).getSize(new THREE.Vector3());
  d.innerHTML = '<b>' + esc(SEL.nombre || ('id ' + SEL.e)) + '</b><div class="pista">' + [SEL.cat, SEL.fam, SEL.tip, SEL.niv].filter(Boolean).map(esc).join(' · ') + '</div><div class="pista mono">id ' + SEL.e + ' · caja ' + f3(tam.x) + ' × ' + f3(tam.z) + ' × ' + f3(tam.y) + ' m</div>' +
    '<div class="filab" style="margin-top:8px"><button id="elAislar">Aislar</button><button id="elOcultar">Ocultar</button><button id="elEnc">Acercar</button><button id="elInc">Incidencia</button></div><input id="elQ" placeholder="Buscar propiedad…" style="margin:8px 0 4px"><div id="elProps" class="pista">Cargando propiedades…</div>';
  d.querySelector('#elAislar').onclick = () => muestraSolo(new Set([SEL.e]), true); d.querySelector('#elOcultar').onclick = () => { OCULTOS.add(SEL.e); selecciona(null); recalcula(false); };
  d.querySelector('#elEnc').onclick = () => encuadra(cajaDe(new Set([SEL.e]))); d.querySelector('#elInc').onclick = () => nuevaIncidencia([SEL.e]);
  const e = SEL.e;
  api('/api/modelos/' + PID + '/' + VID + '/elemento/' + e).then(r => {
    if (!SEL || SEL.e !== e) return;
    SEL.uid = (r.propiedades.find(p => /UniqueId/i.test(p[0])) || [])[1] || '';
    const pinta = (q) => { q = (q || '').toLowerCase(); const ps = r.propiedades.filter(p => !q || (p[0] + ' ' + p[1]).toLowerCase().includes(q)); const el = d.querySelector('#elProps'); if (el) el.innerHTML = '<table>' + ps.map(p => '<tr><td class="pista" style="max-width:150px;word-break:break-word">' + esc(p[0]) + '</td><td style="word-break:break-word">' + esc(p[1]) + '</td></tr>').join('') + '</table>' + (ps.length ? '' : '<div class="pista">Nada coincide.</div>'); };
    pinta(''); const q = d.querySelector('#elQ'); if (q) q.oninput = () => pinta(q.value);
  }).catch(() => {});
}

const ray = new THREE.Raycaster(); let bajo = null;
function golpea(ev) {
  if (!G) return null;
  const r = render.domElement.getBoundingClientRect();
  ray.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }, camara);
  const objetos = [G.mallaOp, G.mallaTr].concat(V.extraRaycast.filter(Boolean));
  const hs = ray.intersectObjects(objetos, false);
  for (const h of hs) { if (PLANOS.every(p => p.distanceToPoint(h.point) >= 0)) return h; }
  return null;
}
function elementoDe(h, D) {
  D = D || G; const idx = h.object.geometry.index, vIdx = idx.getX(h.faceIndex * 3);
  let lo = 0, hi = D.elem.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, x = D.elem[m]; if (vIdx < x.vo) hi = m - 1; else if (vIdx >= x.vo + x.vc) lo = m + 1; else return x; }
  return null;
}
render.domElement.addEventListener('pointerdown', (e) => { bajo = [e.clientX, e.clientY]; });
render.domElement.addEventListener('pointerup', (e) => {
  if (!G || !bajo || Math.hypot(e.clientX - bajo[0], e.clientY - bajo[1]) > 4 || e.button !== 0) return;
  if (MEDIR.modo) { clicMedida(e); return; }
  const h = golpea(e);
  if (h && h.object.userData.fantasma) { V.alClicFantasma.forEach(f => f(h)); return; }
  selecciona(h ? elementoDe(h) : null);
});
render.domElement.addEventListener('dblclick', (e) => { if (MEDIR.modo) return; const h = golpea(e); if (h && !h.object.userData.fantasma) { const x = elementoDe(h); if (x) encuadra(cajaDe(new Set([x.e]))); } });
render.domElement.addEventListener('pointermove', (e) => { if (MEDIR.modo) muevePuntero(e); });
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'Escape') { if (MEDIR.modo) cancelaMedida(); else selecciona(null); }
  if (e.key === 'Enter' && MEDIR.modo === 'area') cierraArea();
  if (!G) return;
  if (e.key === 'p' || e.key === 'P') ponMover(!MOVER);
  { const paso = e.shiftKey ? 240 : 80, fl = { ArrowLeft: [paso, 0], ArrowRight: [-paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] }[e.key]; if (fl) { e.preventDefault(); desplaza(fl[0], fl[1]); } }
  if (e.key === 'f' || e.key === 'F') herr('encuadrar').click(); if ((e.key === 'h' || e.key === 'H') && SEL) herr('ocultar').click(); if ((e.key === 'i' || e.key === 'I') && SEL) herr('aislar').click(); if (e.key === 't' || e.key === 'T') herr('todo').click();
});

// ---------- seccion: caja (6 planos) y plano ----------
let CAJA = null;
function aplicaPlanos() { for (const m of [MAT.opaco, MAT.vidrio, MAT.mono, MAT.monoVidrio, MAT.aristas, MAT.punteadas, MAT.fantasma, MAT.lineas]) { m.clippingPlanes = PLANOS; m.clipShadows = true; m.needsUpdate = true; } }
function quitaSeccion() { PLANOS = []; aplicaPlanos(); if (CAJA && CAJA.helper) { escena.remove(CAJA.helper); CAJA = null; } if (SEC.plano) { escena.remove(SEC.plano); SEC.plano = null; } }
const SEC = { ventana: null, plano: null };
function abreSeccion() {
  if (!G) return;
  if (SEC.ventana && document.body.contains(SEC.ventana)) { SEC.ventana.closest('.ventana').remove(); SEC.ventana = null; herr('seccion').classList.remove('activo'); return; }
  const b = G.caja, mn = b.min, mx = b.max, ejes = [['x', 'X (este)', mn.x, mx.x], ['y', 'Z (altura)', mn.y, mx.y], ['z', 'Y (norte)', mn.z, mx.z]];
  const html = '<h3 style="margin-top:0">Caja de sección</h3><label><input type="checkbox" id="scCaja" style="width:auto"> Activar caja</label>' +
    ejes.map(([k, n, a, z]) => '<div class="ctl"><b>' + n[0] + '</b><input type="range" id="scMin' + k + '" min="' + a + '" max="' + z + '" step="' + ((z - a) / 400) + '" value="' + a + '" title="mínimo ' + n + '"><input type="range" id="scMax' + k + '" min="' + a + '" max="' + z + '" step="' + ((z - a) / 400) + '" value="' + z + '" title="máximo ' + n + '"></div>').join('') +
    '<div class="pista" id="scCajaTxt"></div>' +
    '<h3>Plano de sección</h3><label><input type="checkbox" id="scPlano" style="width:auto"> Activar plano</label><div class="filab"><select id="scEje" style="width:170px"><option value="y">Horizontal (planta)</option><option value="x">Vertical X (este-oeste)</option><option value="z">Vertical Y (norte-sur)</option></select><label style="margin:0"><input type="checkbox" id="scInv" style="width:auto"> Invertir lado</label></div><input type="range" id="scPos" min="0" max="1" step="0.0025" value="0.5" style="margin-top:6px"><div class="pista mono" id="scPosTxt"></div>' +
    '<div class="filab"><button id="scQuitar">Quitar sección</button></div>';
  SEC.ventana = ventana('Sección', html, { x: window.innerWidth - 400, y: 70, ancho: 370, alto: 440, alCerrar: () => { SEC.ventana = null; herr('seccion').classList.remove('activo'); } });
  herr('seccion').classList.add('activo');
  const v = SEC.ventana, g = (id) => v.querySelector('#' + id);
  function recalculaSec() {
    PLANOS = [];
    if (g('scCaja').checked) {
      const lim = {}; for (const [k] of ejes) { let a = +g('scMin' + k).value, z = +g('scMax' + k).value; if (a > z) [a, z] = [z, a]; lim[k] = [a, z]; }
      PLANOS.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -lim.x[0]), new THREE.Plane(new THREE.Vector3(-1, 0, 0), lim.x[1]), new THREE.Plane(new THREE.Vector3(0, 1, 0), -lim.y[0]), new THREE.Plane(new THREE.Vector3(0, -1, 0), lim.y[1]), new THREE.Plane(new THREE.Vector3(0, 0, 1), -lim.z[0]), new THREE.Plane(new THREE.Vector3(0, 0, -1), lim.z[1]));
      const bx = new THREE.Box3(new THREE.Vector3(lim.x[0], lim.y[0], lim.z[0]), new THREE.Vector3(lim.x[1], lim.y[1], lim.z[1]));
      if (!CAJA) { CAJA = { helper: new THREE.Box3Helper(bx, 0xc8a24a) }; escena.add(CAJA.helper); } else CAJA.helper.box.copy(bx);
      CAJA.helper.visible = true;
      g('scCajaTxt').textContent = 'Caja: ' + f3(lim.x[1] - lim.x[0]) + ' × ' + f3(lim.z[1] - lim.z[0]) + ' × ' + f3(lim.y[1] - lim.y[0]) + ' m';
    } else { if (CAJA) CAJA.helper.visible = false; g('scCajaTxt').textContent = ''; }
    if (g('scPlano').checked) {
      const k = g('scEje').value, a = mn[k], z = mx[k], p = a + (z - a) * +g('scPos').value, inv = g('scInv').checked;
      const n = new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0); if (!inv) n.negate();
      PLANOS.push(new THREE.Plane(n, -n.dot(new THREE.Vector3(k === 'x' ? p : 0, k === 'y' ? p : 0, k === 'z' ? p : 0))));
      if (!SEC.plano) { SEC.plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xc8a24a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })); escena.add(SEC.plano); }
      const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      SEC.plano.visible = true; SEC.plano.position.copy(c); SEC.plano.position[k] = p; SEC.plano.rotation.set(0, 0, 0);
      if (k === 'y') { SEC.plano.rotation.x = -Math.PI / 2; SEC.plano.scale.set(s.x * 1.1, s.z * 1.1, 1); } else if (k === 'x') { SEC.plano.rotation.y = Math.PI / 2; SEC.plano.scale.set(s.z * 1.1, s.y * 1.1, 1); } else SEC.plano.scale.set(s.x * 1.1, s.y * 1.1, 1);
      g('scPosTxt').textContent = 'Plano en ' + (k === 'y' ? 'Z = ' + f3(p) : k === 'x' ? 'X = ' + f3(p) : 'Y = ' + f3(-p)) + ' m (coordenadas compartidas)';
    } else { if (SEC.plano) SEC.plano.visible = false; g('scPosTxt').textContent = ''; }
    aplicaPlanos();
  }
  v.querySelectorAll('input, select').forEach(i => i.addEventListener('input', recalculaSec));
  g('scQuitar').onclick = () => { g('scCaja').checked = false; g('scPlano').checked = false; recalculaSec(); };
}

// ---------- medir ----------
const MAT_LINEA = new THREE.LineBasicMaterial({ color: 0xe9d29a, depthTest: false, transparent: true });
const MAT_PUNTO = new THREE.MeshBasicMaterial({ color: 0xc8a24a, depthTest: false });
function abreMedir() {
  if (!G) return;
  if (MEDIR.ventana && document.body.contains(MEDIR.ventana)) { MEDIR.ventana.closest('.ventana').remove(); MEDIR.ventana = null; cancelaMedida(); herr('medir').classList.remove('activo'); return; }
  const html = '<div class="filab">' + [['distancia', 'Distancia'], ['area', 'Área'], ['angulo', 'Ángulo'], ['punto', 'Coordenadas'], ['perp', 'Distancia a cara']].map(([k, t]) => '<button data-m="' + k + '">' + t + '</button>').join('') + '</div>' +
    '<p class="pista">Clic en el modelo marca puntos; el imán salta a vértices y puntos medios cercanos. Área: cierra con Enter o clic en el primer punto. Esc cancela.</p><label><input type="checkbox" id="mdIman" checked style="width:auto"> Imán a vértices y puntos medios</label>' +
    '<h3>Medidas</h3><div id="mdLista" class="pista">Ninguna.</div><div class="filab"><button id="mdBorrar">Borrar medidas</button></div>';
  MEDIR.ventana = ventana('Medir', html, { x: window.innerWidth - 400, y: 70, ancho: 370, alto: 420, alCerrar: () => { MEDIR.ventana = null; cancelaMedida(); herr('medir').classList.remove('activo'); } });
  herr('medir').classList.add('activo');
  MEDIR.ventana.querySelectorAll('button[data-m]').forEach(b => b.onclick = () => { cancelaMedida(); MEDIR.modo = b.dataset.m; MEDIR.ventana.querySelectorAll('button[data-m]').forEach(x => x.classList.toggle('activo', x === b)); pista({ distancia: 'Distancia: marca 2 puntos', area: 'Área: marca los vértices del polígono, Enter para cerrar', angulo: 'Ángulo: marca el vértice y luego un punto en cada lado', punto: 'Coordenadas: marca un punto', perp: 'Distancia a cara: marca un punto y luego una cara' }[MEDIR.modo]); render.domElement.style.cursor = 'crosshair'; });
  MEDIR.ventana.querySelector('#mdBorrar').onclick = limpiaMedidas;
}
function pista(t) { const p = $('pista2'); if (!t) { p.classList.add('oculto'); return; } p.textContent = t; p.classList.remove('oculto'); }
function cancelaMedida() { MEDIR.modo = null; MEDIR.puntos = []; if (MEDIR.temporal) { escena.remove(MEDIR.temporal); MEDIR.temporal = null; } if (MEDIR.marcador) { escena.remove(MEDIR.marcador); MEDIR.marcador = null; } pista(null); render.domElement.style.cursor = ''; if (MEDIR.ventana) MEDIR.ventana.querySelectorAll('button[data-m]').forEach(x => x.classList.remove('activo')); }
function limpiaMedidas() { cancelaMedida(); for (const o of MEDIR.objetos) escena.remove(o); MEDIR.objetos = []; for (const e of MEDIR.etiquetas) e.remove(); MEDIR.etiquetas = []; const l = MEDIR.ventana && MEDIR.ventana.querySelector('#mdLista'); if (l) l.innerHTML = 'Ninguna.'; }
function puntoDe(h) {
  const iman = !(MEDIR.ventana && MEDIR.ventana.querySelector('#mdIman') && !MEDIR.ventana.querySelector('#mdIman').checked);
  if (!iman) return { p: h.point.clone(), tipo: 'libre' };
  const idx = h.object.geometry.index, pos = h.object.geometry.attributes.position, a = idx.getX(h.faceIndex * 3), b = idx.getX(h.faceIndex * 3 + 1), c = idx.getX(h.faceIndex * 3 + 2);
  const P = [a, b, c].map(i => new THREE.Vector3().fromBufferAttribute(pos, i));
  const cand = P.map(p => ({ p, tipo: 'vertice' })).concat([[0, 1], [1, 2], [2, 0]].map(([i, j]) => ({ p: P[i].clone().add(P[j]).multiplyScalar(0.5), tipo: 'medio' })));
  const r = render.domElement.getBoundingClientRect(), sp = (p) => { const v = p.clone().project(camara); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; };
  const h2 = sp(h.point); let mejor = null, dm = 14;
  for (const k of cand) { const s = sp(k.p), d = Math.hypot(s[0] - h2[0], s[1] - h2[1]); if (d < dm) { dm = d; mejor = k; } }
  return mejor ? { p: mejor.p.clone(), tipo: mejor.tipo } : { p: h.point.clone(), tipo: 'libre' };
}
function marcador(p, color) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), color ? new THREE.MeshBasicMaterial({ color, depthTest: false }) : MAT_PUNTO); m.position.copy(p); m.renderOrder = 9; escalaMarcador(m); escena.add(m); return m; }
function escalaMarcador(m) { const d = m.position.distanceTo(camara.position); m.scale.setScalar(Math.max(0.01, d * 0.004)); }
function linea(pts, cerrada) { const g = new THREE.BufferGeometry().setFromPoints(cerrada ? pts.concat([pts[0]]) : pts); const l = new THREE.Line(g, MAT_LINEA); l.renderOrder = 8; escena.add(l); return l; }
function etiqueta(p, texto, clase) { const d = document.createElement('div'); d.className = 'etq' + (clase ? ' ' + clase : ''); d.textContent = texto; d._p = p.clone(); etiquetas.appendChild(d); return d; }
function pintaEtiquetas() {
  if (!etiquetas.children.length && !MEDIR.marcador) return;
  const r = render.domElement.getBoundingClientRect();
  for (const d of etiquetas.children) { const v = d._p.clone().project(camara); const vis = v.z < 1 && (!PLANOS.length || PLANOS.every(pl => pl.distanceToPoint(d._p) >= -0.01)); d.style.display = vis ? '' : 'none'; d.style.left = ((v.x + 1) / 2 * r.width) + 'px'; d.style.top = ((1 - v.y) / 2 * r.height) + 'px'; }
  for (const o of MEDIR.objetos) if (o.isMesh && o.geometry.type === 'SphereGeometry') escalaMarcador(o);
  if (MEDIR.marcador) escalaMarcador(MEDIR.marcador);
}
const aRevit = (p) => [p.x, -p.z, p.y];
function muevePuntero(e) {
  const h = golpea(e);
  if (!h) { if (MEDIR.marcador) MEDIR.marcador.visible = false; return; }
  const k = puntoDe(h);
  if (!MEDIR.marcador) MEDIR.marcador = marcador(k.p, 0xc8a24a);
  MEDIR.marcador.visible = true; MEDIR.marcador.position.copy(k.p); MEDIR.marcador.material.color.set(k.tipo === 'vertice' ? 0xe07a6a : k.tipo === 'medio' ? 0x7fc47f : 0xc8a24a);
  if (MEDIR.puntos.length && (MEDIR.modo === 'distancia' || MEDIR.modo === 'area' || MEDIR.modo === 'angulo')) {
    if (MEDIR.temporal) escena.remove(MEDIR.temporal);
    MEDIR.temporal = linea([MEDIR.puntos[MEDIR.puntos.length - 1], k.p]);
    if (MEDIR.modo === 'distancia') pista('Distancia: ' + f3(MEDIR.puntos[0].distanceTo(k.p)) + ' m (clic para fijar)');
  }
}
function clicMedida(e) {
  const h = golpea(e); if (!h) return;
  const k = puntoDe(h), p = k.p, m = MEDIR.modo;
  if (m === 'punto') { const c = aRevit(p); MEDIR.objetos.push(marcador(p)); anotaMedida('Punto', 'X ' + f3(c[0]) + '  Y ' + f3(c[1]) + '  Z ' + f3(c[2]) + ' m', p); return; }
  if (m === 'perp') {
    if (!MEDIR.puntos.length) { MEDIR.puntos.push(p); MEDIR.objetos.push(marcador(p)); pista('Ahora haz clic en la cara'); return; }
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize(), q = MEDIR.puntos[0], d = Math.abs(n.dot(q.clone().sub(h.point))), pie = q.clone().sub(n.clone().multiplyScalar(n.dot(q.clone().sub(h.point))));
    MEDIR.objetos.push(linea([q, pie]), marcador(pie)); anotaMedida('Distancia a cara', f3(d) + ' m', q.clone().add(pie).multiplyScalar(0.5)); MEDIR.puntos = []; pista('Distancia a cara: marca un punto y luego una cara'); return;
  }
  if (m === 'distancia') {
    MEDIR.puntos.push(p); MEDIR.objetos.push(marcador(p));
    if (MEDIR.puntos.length === 2) {
      const [a, b] = MEDIR.puntos, d = a.distanceTo(b), ra = aRevit(a), rb = aRevit(b);
      MEDIR.objetos.push(linea([a, b]));
      anotaMedida('Distancia', f3(d) + ' m', a.clone().add(b).multiplyScalar(0.5), 'ΔX ' + f3(Math.abs(rb[0] - ra[0])) + ' · ΔY ' + f3(Math.abs(rb[1] - ra[1])) + ' · ΔZ ' + f3(Math.abs(rb[2] - ra[2])));
      MEDIR.puntos = []; if (MEDIR.temporal) { escena.remove(MEDIR.temporal); MEDIR.temporal = null; } pista('Distancia: marca 2 puntos');
    }
    return;
  }
  if (m === 'angulo') {
    MEDIR.puntos.push(p); MEDIR.objetos.push(marcador(p));
    if (MEDIR.puntos.length === 3) {
      const [v, a, b] = MEDIR.puntos, u1 = a.clone().sub(v).normalize(), u2 = b.clone().sub(v).normalize(), ang = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(u1.dot(u2), -1, 1)));
      MEDIR.objetos.push(linea([a, v, b])); anotaMedida('Ángulo', ang.toFixed(2) + '°', v);
      MEDIR.puntos = []; if (MEDIR.temporal) { escena.remove(MEDIR.temporal); MEDIR.temporal = null; } pista('Ángulo: marca el vértice y luego un punto en cada lado');
    }
    return;
  }
  if (m === 'area') {
    if (MEDIR.puntos.length >= 3 && p.distanceTo(MEDIR.puntos[0]) < 1e-6) { cierraArea(); return; }
    MEDIR.puntos.push(p); MEDIR.objetos.push(marcador(p));
    if (MEDIR.puntos.length > 1) MEDIR.objetos.push(linea(MEDIR.puntos.slice(-2)));
  }
}
function cierraArea() {
  const P = MEDIR.puntos; if (P.length < 3) return;
  const n = new THREE.Vector3(); for (let i = 1; i + 1 < P.length; i++) n.add(P[i].clone().sub(P[0]).cross(P[i + 1].clone().sub(P[0])));
  const area = n.length() / 2, per = P.reduce((s, q, i) => s + q.distanceTo(P[(i + 1) % P.length]), 0), c = P.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / P.length);
  MEDIR.objetos.push(linea([P[P.length - 1], P[0]])); anotaMedida('Área', f3(area) + ' m²', c, 'perímetro ' + f3(per) + ' m · ' + P.length + ' vértices');
  MEDIR.puntos = []; if (MEDIR.temporal) { escena.remove(MEDIR.temporal); MEDIR.temporal = null; } pista('Área: marca los vértices del polígono, Enter para cerrar');
}
function anotaMedida(tipo, valor, p, extra) {
  MEDIR.etiquetas.push(etiqueta(p, valor));
  const l = MEDIR.ventana && MEDIR.ventana.querySelector('#mdLista'); if (!l) return;
  if (/Ninguna/.test(l.textContent)) l.innerHTML = '';
  l.innerHTML += '<div><b>' + esc(tipo) + '</b>: <span class="mono">' + esc(valor) + '</span>' + (extra ? '<div class="pista mono">' + esc(extra) + '</div>' : '') + '</div>';
}

// ---------- incidencias ----------
let SELS = [];
async function cuentaIncidencias() { try { const d = await api('/api/proyectos/' + PID + '/incidencias?version_id=' + VID); const n = d.incidencias.filter(i => !i.version_id || i.version_id === VID).length; $('cntInc').textContent = n ? String(n) : ''; } catch (e) {} }
async function abreIncidencia(iid) {
  const i = await api('/api/proyectos/' + PID + '/incidencias/' + iid);
  for (const x of SELS) pintaSeleccion(x, false); SELS = [];
  const propios = (i.elementos || []).map(el => el.e != null && G.porE.has(Number(el.e)) ? G.elem[G.porE.get(Number(el.e))] : null).filter(Boolean);
  for (const x of propios) { pintaSeleccion(x, true); SELS.push(x); }
  if (propios.length) { selecciona(propios[0], true); for (const x of propios) pintaSeleccion(x, true); }
  const c = i.camara || {};
  if (c.pos && c.dir) {
    const pos = new THREE.Vector3(c.pos[0], c.pos[2], -c.pos[1]), dir = new THREE.Vector3(c.dir[0], c.dir[2], -c.dir[1]).normalize();
    camara.position.copy(pos); const objetivo = propios.length ? cajaDe(new Set(propios.map(x => x.e))).getCenter(new THREE.Vector3()) : pos.clone().add(dir.multiplyScalar(20));
    control.target.copy(objetivo); if (c.fov) camara.fov = c.fov; camara.updateProjectionMatrix(); control.update();
  } else if (propios.length) encuadra(cajaDe(new Set(propios.map(x => x.e))));
  const lista = (i.elementos || []).map(el => (el.e != null ? 'id ' + el.e : '') + (el.uid ? ' · ' + el.uid.slice(0, 14) + '…' : '') + (el.modelo ? ' · ' + el.modelo : '')).join('<br>');
  const v = ventana(i.codigo || ('#' + i.numero), '<b>' + esc(i.titulo) + '</b> <span class="estado ' + esc(i.estado) + '">' + esc(i.estado) + '</span> · ' + esc(i.tipo) + ' · ' + esc(i.prioridad) + (i.contractual ? ' · <span class="estado COMPARTIDO">contractual</span>' : '') +
    '<p>' + esc(i.descripcion || '') + '</p><div class="pista">' + [i.disciplina && 'Disciplina ' + i.disciplina, i.etapa && 'Etapa / RIBA ' + i.etapa, i.tipo_revision && 'Revisión ' + i.tipo_revision, i.entregable && 'Entregable ' + i.entregable, i.asignado && 'Asignada a ' + i.asignado, i.inicio && 'Inicio ' + i.inicio].filter(Boolean).map(esc).join(' · ') + '</div>' +
    '<div class="pista" style="margin-top:6px">' + propios.length + ' de ' + (i.elementos || []).length + ' elemento(s) encontrados en esta versión' + (lista ? ':<br>' + lista : '') + '</div>' +
    '<div class="filab"><button id="incEnc">Encuadrar</button><button id="incAis">Aislar</button><a class="boton" href="index.html#/p/' + PID + '/incidencias/' + i.id + '" target="_blank">Ficha completa</a></div>', { x: window.innerWidth - 420, y: 70, ancho: 390, alto: 340 });
  v.querySelector('#incEnc').onclick = () => propios.length && encuadra(cajaDe(new Set(propios.map(x => x.e))));
  v.querySelector('#incAis').onclick = () => propios.length && muestraSolo(new Set(propios.map(x => x.e)), true);
}
/** Crear una incidencia con la camara actual y los elementos dados (ids e). */
function nuevaIncidencia(es, prellenado) {
  if (!G) return;
  const p = camara.position, d = camara.getWorldDirection(new THREE.Vector3());
  const cam = { pos: [p.x, -p.z, p.y], dir: [d.x, -d.z, d.y], up: [0, 0, 1], fov: camara.fov };
  const TIPOS = ['observacion', 'interferencia', 'consulta', 'no-conformidad', 'cambio-de-diseno', 'mejora'], IMP = ['plazo', 'costo', 'calidad', 'seguridad', 'alcance'];
  const info = (e) => { if (!EL || !EL.idx.has(e)) return { nombre: 'id ' + e, cat: '', niv: '' }; const i = EL.idx.get(e), D = EL.diccionarios, C = EL.columnas; return { nombre: C.nombre[i], cat: D.cat[C.cat[i]], niv: D.niv[C.niv[i]] }; };
  const i0 = es.length ? info(es[0]) : { nombre: '', cat: '', niv: '' }, pre = prellenado || {};
  const c = ventana('Incidencia' + (es.length ? ' · ' + es.length + ' elemento(s)' : ''), '<label>Título</label><input id="iT" value="' + esc(pre.titulo || ((i0.cat ? i0.cat + ' · ' : '') + i0.nombre + (es.length ? ': ' : ''))) + '"><label>Descripción</label><textarea id="iD">' + esc(pre.descripcion || '') + '</textarea>' +
    '<div class="fila"><div style="flex:1"><label>Tipo</label><select id="iTipo">' + TIPOS.map(t => '<option' + (t === (pre.tipo || 'observacion') ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div><div style="flex:1"><label>Prioridad</label><select id="iP"><option>baja</option><option selected>media</option><option>alta</option><option>critica</option></select></div></div>' +
    '<div class="fila"><div style="flex:1"><label>Disciplina</label><input id="iDis"></div><div style="flex:1"><label>Etapa / RIBA</label><input id="iEt" placeholder="E3 · RIBA 04"></div></div>' +
    '<div class="fila"><div style="flex:1"><label>Tipo de revisión</label><input id="iTR" placeholder="Avance"></div><div style="flex:1"><label>N.º entregable</label><input id="iEn" placeholder="E3 - Presentación 4 (P4)"></div></div>' +
    '<label>Impacto</label><div>' + IMP.map(x => '<label style="display:inline-block;margin-right:10px"><input type="checkbox" class="iImp" value="' + x + '" style="width:auto"> ' + x + '</label>').join('') + '</div>' +
    '<label><input type="checkbox" id="iC" style="width:auto"> Contractual (alto impacto)</label><div style="margin-top:10px"><button class="primario" id="iOk">Crear</button></div><div id="iMsg"></div>', { ancho: 560, alto: 560 });
  c.querySelector('#iOk').onclick = async () => {
    try {
      const r = await api('/api/proyectos/' + PID + '/incidencias', { json: { titulo: c.querySelector('#iT').value, descripcion: c.querySelector('#iD').value, tipo: c.querySelector('#iTipo').value, prioridad: c.querySelector('#iP').value, disciplina: c.querySelector('#iDis').value, etapa: c.querySelector('#iEt').value, tipo_revision: c.querySelector('#iTR').value, entregable: c.querySelector('#iEn').value, nivel: i0.niv || '', impacto: [...c.querySelectorAll('.iImp:checked')].map(x => x.value), origen: 'auditoria-modelo', contractual: c.querySelector('#iC').checked, version_id: VID, elementos: es.map(e => ({ e, uid: (SEL && SEL.e === e && SEL.uid) || '', modelo: G.meta.modelo || '' })), camara: cam } });
      c.querySelector('#iMsg').innerHTML = '<div class="aviso verde">Creada la incidencia ' + esc(r.codigo || ('#' + r.numero)) + '.</div>'; cuentaIncidencias();
    } catch (e) { c.querySelector('#iMsg').innerHTML = '<div class="aviso rojo">' + esc(/failed to fetch|networkerror|load failed/i.test(e.message) ? 'No hubo respuesta del servidor del CDE (¿se está reiniciando o se cerró su ventana?). La incidencia NO se creó: comprueba que el servidor esté arrancado y pulsa Crear otra vez.' : e.message) + '</div>'; }
  };
}
MODULOS.incidencias = async () => {
  const c = panel('Incidencias', '<div class="filab"><input id="incQ" placeholder="Buscar…"><select id="incE" style="width:120px"><option value="">Todas</option><option>abierta</option><option>en-curso</option><option>respondida</option><option>cerrada</option></select><button class="primario" id="incNueva" title="Nueva incidencia con la selección">+ Nueva</button></div><div id="incLista" class="pista">Cargando…</div>');
  c.querySelector('#incNueva').onclick = () => nuevaIncidencia(SEL ? [SEL.e] : []);
  let d; try { d = await api('/api/proyectos/' + PID + '/incidencias'); } catch (e) { c.querySelector('#incLista').textContent = e.message; return; }
  const pinta = () => {
    const q = c.querySelector('#incQ').value.toLowerCase(), est = c.querySelector('#incE').value;
    const L = d.incidencias.filter(i => (!est || i.estado === est) && (!q || (i.titulo + ' ' + (i.codigo || '') + ' ' + (i.descripcion || '')).toLowerCase().includes(q)));
    c.querySelector('#incLista').innerHTML = L.map(i => '<div class="filtro" style="cursor:pointer" data-i="' + i.id + '"><div class="ft"><b>' + esc(i.codigo || '#' + i.numero) + ' · ' + esc(i.titulo) + '</b><span class="estado ' + esc(i.estado) + '">' + esc(i.estado) + '</span></div><div class="pista">' + esc(i.tipo) + ' · ' + esc(i.prioridad) + (i.nivel ? ' · ' + esc(i.nivel) : '') + ' · ' + (i.elementos || []).length + ' elem.' + (i.version_id === VID ? ' · esta versión' : i.version_id ? ' · otra versión' : '') + '</div></div>').join('') || '<p class="pista">Sin incidencias.</p>';
    c.querySelectorAll('[data-i]').forEach(x => x.onclick = () => abreIncidencia(x.dataset.i).catch(e => alert(e.message)));
  };
  c.querySelector('#incQ').oninput = pinta; c.querySelector('#incE').onchange = pinta; pinta();
};

// ---------- capa de dibujo (rutas, marcas) y vista en planta, para los modulos ----------
const CAPA = new THREE.Group(); CAPA.renderOrder = 20; escena.add(CAPA);
function limpiaCapa() { while (CAPA.children.length) { const o = CAPA.children.pop(); if (o.geometry) o.geometry.dispose(); } dibuja(); }
/** Una polilinea gruesa (tubos) por puntos de la escena, con esferas en los extremos si se pide. */
function dibujaRuta(pts, color, o) {
  const O = o || {}, mat = new THREE.MeshBasicMaterial({ color: color || 0xc8a24a, transparent: true, opacity: 0.9, depthTest: false });
  const r = O.radio || 0.09;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = a.distanceTo(b); if (!(L > 1e-6)) continue;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 6, 1), mat); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); c.renderOrder = 20; CAPA.add(c);
  }
  if (O.inicio && pts.length) { const s = new THREE.Mesh(new THREE.SphereGeometry(r * 3.5, 12, 12), new THREE.MeshBasicMaterial({ color: O.inicio, depthTest: false })); s.position.copy(pts[0]); s.renderOrder = 21; CAPA.add(s); }
  if (O.fin && pts.length) { const s = new THREE.Mesh(new THREE.SphereGeometry(r * 3.5, 12, 12), new THREE.MeshBasicMaterial({ color: O.fin, depthTest: false })); s.position.copy(pts[pts.length - 1]); s.renderOrder = 21; CAPA.add(s); }
  dibuja();
}
/** Corta el modelo a la altura y (escena, = cota Z de Revit) y lo mira desde arriba encuadrando la caja (la seccion en planta del visor). */
function cortaPlanta(y, caja) {
  PLANOS = [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)]; aplicaPlanos();
  if (caja) vistaPlanta(caja); dibuja();
}
function quitaCortePlanta() { PLANOS = []; aplicaPlanos(); dibuja(); }
function vistaPlanta(caja) {
  const c = caja.getCenter(new THREE.Vector3()), s = caja.getSize(new THREE.Vector3()), r = Math.max(4, Math.hypot(s.x, s.z) / 2);
  camara.position.set(c.x + r * 0.02, c.y + r * 1.9, c.z + r * 0.02); control.target.copy(c); camara.near = 0.05; camara.far = Math.max(2000, r * 60); camara.updateProjectionMatrix(); control.update(); dibuja();
}
/** Los triangulos de un elemento como [ax,ay,az, bx,by,bz, cx,cy,cz, ...] en coordenadas de la escena. */
function triangulosDe(x, D) { D = D || G; const P = D.posiciones, out = new Float32Array(x.ic * 3); let k = 0; for (const [src, ini, n] of trozosDe(x, D)) for (let q = ini; q < ini + n; q++) { const i = src[q]; out[k++] = P[i * 3]; out[k++] = P[i * 3 + 1]; out[k++] = P[i * 3 + 2]; } return out; }
/** Un rayo hacia arriba desde un punto de la escena: true si no toca el modelo en "alcance" metros (cielo abierto). */
function cieloAbierto(p, alcance) { if (!G) return null; ray.set(p, new THREE.Vector3(0, 1, 0)); ray.far = alcance || 40; const h = ray.intersectObject(G.mallaOp, false); ray.far = Infinity; return !h.length; }

// ---------- lo compartido con visor-modulos.js ----------
const V = { trozosDe,
  THREE, escena, camara, control, render, MAT, PID, api, esc, num, ventana, barras, panel, abreModulo, MODULOS, DIMS, PALETA, hexLin, f3,
  get VID() { return VID; }, get G() { return G; }, get EL() { return EL; }, get VIS() { return VIS; }, get SEL() { return SEL; }, get LISTA() { return LISTA; }, get FILTROS() { return FILTROS; }, get TINTES() { return TINTES; }, set TINTES(t) { TINTES = t; },
  parseaCdeg, cajasDe, cajaDe, encuadra, dibuja, CAPA, limpiaCapa, dibujaRuta, cortaPlanta, quitaCortePlanta, vistaPlanta, triangulosDe, cieloAbierto, ROOM_RE, reconstruyeIndices,
  get MOSTRAR_AMB() { return MOSTRAR_AMB; }, set MOSTRAR_AMB(v) { MOSTRAR_AMB = !!v; reconstruyeIndices(); }, get QUIEN() { return QUIEN; }, get PROY() { return PROY; }, muestraSolo, recalcula, selecciona, aplicaTintes, pintaColor, nuevaIncidencia, abreIncidencia, pasanTodos, cuentaDim,
  elementoDe, info: (e) => { if (!EL || !EL.idx.has(e)) return null; const i = EL.idx.get(e), D = EL.diccionarios, C = EL.columnas; return { e, nombre: C.nombre[i], modelo: D.modelo[C.modelo[i]], cat: D.cat[C.cat[i]], fam: D.fam[C.fam[i]], tip: D.tip[C.tip[i]], niv: D.niv[C.niv[i]] }; },
  alCargarModelo: [], alCambiarModelo: [], alSeleccionar: [], alMostrarTodo: [], alClicFantasma: [], extraRaycast: [],
  // v0.6.2: lo que necesita visor-puente.js para correr los modulos del Visor BIM Federado tal cual
  alRecalcular: [], alPintarFiltros: [], alAbrirFiltros: [], anadeFiltro, quitaFiltro, pintaFiltros, pintaEstadoFiltros, get MODULO() { return MODULO; }, get OCULTOS() { return OCULTOS; }, COLOR_SEL, srgbLin
};
V.pintaFidelidad = pintaFidelidad; V.partes = () => PARTES; window.VISOR = V; window.V = V;   // para depurar desde la consola del navegador y para visor-puente.js
import('./visor-modulos.js?v=108').then(m => m.monta(V)).catch(e => console.error('visor-modulos', e));
import('./visor-ambientes.js').then(m => m.monta(V)).catch(e => console.error('visor-ambientes', e));

if (!PID) $('estadoCarga').textContent = 'Falta el proyecto (?pid=).'; else cargaLista().catch(e => { $('estadoCarga').textContent = e.message; });
