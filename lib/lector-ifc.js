/*
 * LECTOR IFC DEL CDE (sin Autodesk): convierte un .ifc al paquete de modelo del CDE (docs/FORMATO-PAQUETE.md) —
 * los trozos del indice (formato de exporta-indice.js del Visor BIM) y la geometria liviana geometria.cdeg — para
 * que el visor del CDE lo muestre y lo filtre igual que un modelo publicado con el complemento de Revit.
 *
 * Usa web-ifc (ThatOpen, licencia MPL-2.0, copia sin cambios en lib/vendor/web-ifc), que lee IFC2X3 / IFC4 / IFC4X3.
 *
 * Clasificacion (las 5 canonicas del visor):
 *  - Modelo     = nombre del archivo.
 *  - Categoria / Familia / Tipo: si el IFC viene de Revit, su nombre trae "Categoria : Familia : Tipo" (exportador 2023+)
 *    o el tipo trae la propiedad "Categoria"/"Category"; si no, la clase IFC traducida a la categoria de Revit equivalente
 *    (IfcWall -> Muros, IfcDoor -> Puertas...) y Familia:Tipo del ObjectType o del objeto tipo.
 *  - Nivel      = el IfcBuildingStorey que lo contiene (subiendo por agregaciones: paneles de muro cortina, tramos de escalera).
 * Parametros: todos los conjuntos de propiedades y de cantidades del elemento y de su tipo ("Conjunto / Propiedad"), los
 * atributos IFC (clase, nombre, ObjectType, etiqueta, GlobalId), el material y "Identidad / IfcGUID" / "ElementId".
 * Id de elemento (e): la etiqueta del IFC si es el ElementId de Revit (numerica y unica: estable entre versiones, como en el
 * complemento); si no, un numero derivado del GlobalId (tambien estable entre versiones).
 * Coordenadas: metros, ejes de Revit (Z arriba). Si el modelo esta georreferenciado lejos del origen (UTM), se acerca al
 * origen para no perder precision y el desplazamiento queda en la cabecera del .cdeg (campo "origen").
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const DIR_WASM = path.join(__dirname, 'vendor', 'web-ifc') + path.sep;
let W = null;
const webIfc = () => W || (W = require('./vendor/web-ifc/web-ifc-api-node.js'));

/** Clase IFC -> categoria de Revit (en espanol, como las nombra el visor). */
const CATEGORIA_IFC = {
  IFCWALL: 'Muros', IFCWALLSTANDARDCASE: 'Muros', IFCWALLELEMENTEDCASE: 'Muros', IFCCURTAINWALL: 'Muros cortina', IFCSLAB: 'Suelos', IFCSLABSTANDARDCASE: 'Suelos',
  IFCSLABELEMENTEDCASE: 'Suelos', IFCROOF: 'Cubiertas', IFCDOOR: 'Puertas', IFCDOORSTANDARDCASE: 'Puertas', IFCWINDOW: 'Ventanas', IFCWINDOWSTANDARDCASE: 'Ventanas',
  IFCCOLUMN: 'Pilares estructurales', IFCCOLUMNSTANDARDCASE: 'Pilares estructurales', IFCBEAM: 'Armazón estructural', IFCBEAMSTANDARDCASE: 'Armazón estructural',
  IFCMEMBER: 'Armazón estructural', IFCPLATE: 'Paneles de muro cortina', IFCFOOTING: 'Cimentación estructural', IFCPILE: 'Cimentación estructural',
  IFCSTAIR: 'Escaleras', IFCSTAIRFLIGHT: 'Escaleras', IFCRAMP: 'Rampas', IFCRAMPFLIGHT: 'Rampas', IFCRAILING: 'Barandillas', IFCCOVERING: 'Techos',
  IFCFURNISHINGELEMENT: 'Mobiliario', IFCFURNITURE: 'Mobiliario', IFCSYSTEMFURNITUREELEMENT: 'Sistemas de mobiliario', IFCSPACE: 'Habitaciones',
  IFCBUILDINGELEMENTPROXY: 'Modelos genéricos', IFCBUILDINGELEMENTPART: 'Piezas', IFCREINFORCINGBAR: 'Armadura estructural', IFCREINFORCINGMESH: 'Malla de armadura',
  IFCPIPESEGMENT: 'Tuberías', IFCPIPEFITTING: 'Uniones de tubería', IFCDUCTSEGMENT: 'Conductos', IFCDUCTFITTING: 'Uniones de conducto', IFCAIRTERMINAL: 'Terminales de aire',
  IFCCABLECARRIERSEGMENT: 'Bandejas de cables', IFCCABLECARRIERFITTING: 'Uniones de bandeja de cables', IFCCABLESEGMENT: 'Cables', IFCLIGHTFIXTURE: 'Luminarias',
  IFCLAMP: 'Luminarias', IFCELECTRICAPPLIANCE: 'Equipos eléctricos', IFCOUTLET: 'Dispositivos eléctricos', IFCSWITCHINGDEVICE: 'Dispositivos de iluminación',
  IFCSANITARYTERMINAL: 'Aparatos sanitarios', IFCFLOWTERMINAL: 'Aparatos sanitarios', IFCVALVE: 'Accesorios de tubería', IFCPUMP: 'Equipos mecánicos',
  IFCFLOWMOVINGDEVICE: 'Equipos mecánicos', IFCFLOWCONTROLLER: 'Accesorios de tubería', IFCFLOWFITTING: 'Uniones de tubería', IFCFLOWSEGMENT: 'Tuberías',
  IFCENERGYCONVERSIONDEVICE: 'Equipos mecánicos', IFCUNITARYEQUIPMENT: 'Equipos mecánicos', IFCDISTRIBUTIONCONTROLELEMENT: 'Dispositivos de seguridad',
  IFCFIRESUPPRESSIONTERMINAL: 'Rociadores', IFCALARM: 'Dispositivos de alarma de incendio', IFCSENSOR: 'Dispositivos de seguridad', IFCTRANSPORTELEMENT: 'Equipos especializados',
  IFCGEOGRAPHICELEMENT: 'Topografía', IFCCIVILELEMENT: 'Elementos civiles', IFCELEMENTASSEMBLY: 'Ensamblajes', IFCCHIMNEY: 'Modelos genéricos', IFCSHADINGDEVICE: 'Modelos genéricos',
  IFCDISCRETEACCESSORY: 'Accesorios', IFCMECHANICALFASTENER: 'Conexiones estructurales', IFCFASTENER: 'Conexiones estructurales', IFCTENDON: 'Armadura estructural',
  IFCBEARING: 'Apoyos', IFCCOURSE: 'Pavimentos', IFCPAVEMENT: 'Pavimentos', IFCKERB: 'Bordillos', IFCEARTHWORKSFILL: 'Rellenos', IFCEARTHWORKSCUT: 'Cortes',
  IFCROAD: 'Carreteras', IFCBRIDGE: 'Puentes', IFCALIGNMENT: 'Alineaciones', IFCVIRTUALELEMENT: 'Elementos virtuales', IFCANNOTATION: 'Anotaciones'
};
/** rvt-rs entrega en ingles las categorias, familias de sistema y grupos de parametros de Revit: se pasan a los nombres de
 *  Revit en espanol (los del exportador IFC de Revit en espanol y del complemento), para que las cifras coincidan entre formatos. */
const ES_CATEGORIA = {
  'Walls': 'Muros', 'Walls: Wall Sweeps': 'Barridos de muro', 'Wall Sweeps': 'Barridos de muro', 'Walls: Reveals': 'Telares de muro', 'Floors': 'Suelos', 'Ceilings': 'Techos', 'Roofs': 'Cubiertas',
  'Doors': 'Puertas', 'Windows': 'Ventanas', 'Generic Models': 'Modelos genéricos', 'Plumbing Fixtures': 'Aparatos sanitarios', 'Specialty Equipment': 'Equipos especializados',
  'Curtain Panels': 'Paneles de muro cortina', 'Curtain Wall Mullions': 'Montantes de muro cortina', 'Curtain Systems': 'Sistemas de muro cortina', 'Furniture': 'Mobiliario',
  'Furniture Systems': 'Sistemas de mobiliario', 'Casework': 'Mobiliario de obra', 'Rooms': 'Habitaciones', 'Areas': 'Áreas', 'Spaces': 'Espacios', 'Columns': 'Pilares',
  'Structural Columns': 'Pilares estructurales', 'Structural Framing': 'Armazón estructural', 'Structural Foundations': 'Cimentación estructural', 'Structural Rebar': 'Armadura estructural',
  'Stairs': 'Escaleras', 'Railings': 'Barandillas', 'Ramps': 'Rampas', 'Lighting Fixtures': 'Luminarias', 'Lighting Devices': 'Dispositivos de iluminación', 'Electrical Equipment': 'Equipos eléctricos',
  'Electrical Fixtures': 'Aparatos eléctricos', 'Mechanical Equipment': 'Equipos mecánicos', 'Medical Equipment': 'Equipos médicos', 'Food Service Equipment': 'Equipos de servicio de comida',
  'Pipes': 'Tuberías', 'Pipe Fittings': 'Uniones de tubería', 'Pipe Accessories': 'Accesorios de tubería', 'Flex Pipes': 'Tuberías flexibles', 'Ducts': 'Conductos', 'Duct Fittings': 'Uniones de conducto',
  'Duct Accessories': 'Accesorios de conducto', 'Flex Ducts': 'Conductos flexibles', 'Air Terminals': 'Terminales de aire', 'Cable Trays': 'Bandejas de cables', 'Cable Tray Fittings': 'Uniones de bandeja de cables',
  'Conduits': 'Tubos', 'Conduit Fittings': 'Uniones de tubo', 'Sprinklers': 'Rociadores', 'Fire Alarm Devices': 'Dispositivos de alarma de incendio', 'Data Devices': 'Dispositivos de datos',
  'Communication Devices': 'Dispositivos de comunicación', 'Security Devices': 'Dispositivos de seguridad', 'Nurse Call Devices': 'Dispositivos de llamada a enfermería', 'Telephone Devices': 'Dispositivos telefónicos',
  'Topography': 'Topografía', 'Site': 'Emplazamiento', 'Parking': 'Aparcamiento', 'Planting': 'Vegetación', 'Entourage': 'Entorno', 'Mass': 'Masa', 'Parts': 'Piezas', 'Assemblies': 'Ensamblajes'
};
const ES_FAMILIA = { 'Basic Wall': 'Muro básico', 'Curtain Wall': 'Muro cortina', 'Stacked Wall': 'Muro apilado', 'Wall Sweep': 'Barrido de muro', 'Reveal': 'Telar', 'Floor': 'Suelo', 'Foundation Slab': 'Losa de cimentación',
  'Compound Ceiling': 'Techo compuesto', 'Basic Ceiling': 'Techo básico', 'Basic Roof': 'Cubierta básica', 'System Panel': 'Panel de sistema', 'Rectangular Mullion': 'Montante rectangular',
  'Railing': 'Barandilla', 'Assembled Stair': 'Escalera ensamblada', 'Cast-In-Place Stair': 'Escalera moldeada in situ', 'Precast Stair': 'Escalera prefabricada', 'Wall Foundation': 'Cimentación de muro',
  'Pipe Types': 'Tipos de tubería', 'Duct': 'Conducto', 'Cable Tray with Fittings': 'Bandeja de cables con uniones', 'Conduit with Fittings': 'Tubo con uniones', 'Room': 'Habitación', 'Area': 'Área' };
const ES_GRUPO = { 'Constraints': 'Restricciones', 'Identity Data': 'Datos de identidad', 'Other': 'Otros', 'Phasing': 'Proceso por fases', 'Dimensions': 'Cotas', 'Materials and Finishes': 'Materiales y acabados',
  'Construction': 'Construcción', 'Graphics': 'Gráficos', 'Structural': 'Estructura', 'Analytical Properties': 'Propiedades analíticas', 'Text': 'Texto', 'IFC Parameters': 'Parámetros IFC', 'General': 'General',
  'Mechanical': 'Mecánica', 'Electrical': 'Electricidad', 'Plumbing': 'Fontanería', 'Visibility': 'Visibilidad', 'Data': 'Datos', 'Energy Analysis': 'Análisis energético' };
const ES_PARAM = { 'Level': 'Nivel', 'Base Constraint': 'Restricción de base', 'Top Constraint': 'Restricción superior', 'Base Offset': 'Desfase de base', 'Top Offset': 'Desfase superior', 'Unconnected Height': 'Altura desconectada',
  'Type Name': 'Nombre de tipo', 'Category': 'Categoría', 'Family': 'Familia', 'Family and Type': 'Familia y tipo', 'Family Name': 'Nombre de familia', 'Type': 'Tipo', 'Type Id': 'ID de tipo',
  'Phase Created': 'Fase de creación', 'Phase Demolished': 'Fase de derribo', 'Mark': 'Marca', 'Type Mark': 'Marca de tipo', 'Comments': 'Comentarios', 'Type Comments': 'Comentarios de tipo', 'Description': 'Descripción',
  'Model': 'Modelo', 'Manufacturer': 'Fabricante', 'Width': 'Anchura', 'Height': 'Altura', 'Length': 'Longitud', 'Area': 'Área', 'Volume': 'Volumen', 'Thickness': 'Grosor', 'Perimeter': 'Perímetro',
  'Name': 'Nombre', 'Number': 'Número', 'Material': 'Material', 'Structural Material': 'Material estructural', 'Function': 'Función', 'Host': 'Anfitrión', 'Elevation from Level': 'Elevación desde el nivel' };
const traduceNombre = (n) => { const i = n.indexOf(' / '); if (i < 0) return n; const g = n.slice(0, i), p = n.slice(i + 3); return (ES_GRUPO[g] || g) + ' / ' + (ES_GRUPO[g] ? (ES_PARAM[p] || p) : p); };
const SI_PREFIJO = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 100, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9 };
const TOPE_ELEM_TROZO = 50000, TOPE_PARES_TROZO = 1000000;

const txt = (x) => { if (x == null) return ''; if (typeof x === 'object') { if ('value' in x && x.value != null) return typeof x.value === 'object' ? '' : String(x.value); if ('_representationValue' in x) return String(x._representationValue); return ''; } return String(x); };
const ref = (x) => (x && typeof x === 'object' && x.type === 5 ? x.value : null);
const lista = (x) => (Array.isArray(x) ? x : (x == null ? [] : [x]));
const redondea = (n, d) => { const f = Math.pow(10, d); return (Math.round(n * f) / f).toFixed(d); };

/** Hash estable de un texto a un id de 31 bits (> 0). */
function hash31(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return (h & 0x7fffffff) || 1; }

/**
 * Convierte un IFC. opciones: { modelo (nombre a mostrar), dirSalida, alAvanzar(fase, n, total), herramienta }.
 * Devuelve { elementos, parametros, pares, triangulos, trozos, geometria (ruta del .cdeg o ''), esquema, avisos[] }.
 */
async function convierte(rutaIfc, opciones) {
  const o = Object.assign({ modelo: path.basename(rutaIfc), alAvanzar: () => {}, herramienta: 'CDE · lector IFC (web-ifc)' }, opciones || {});
  fs.mkdirSync(o.dirSalida, { recursive: true });
  const WI = webIfc(), api = new WI.IfcAPI();
  api.SetWasmPath(DIR_WASM, true);
  await api.Init();
  try { api.SetLogLevel && api.SetLogLevel(WI.LogLevel ? WI.LogLevel.LOG_LEVEL_OFF : 6); } catch (e) {}
  const datos = new Uint8Array(fs.readFileSync(rutaIfc)), avisos = [];
  o.alAvanzar('abriendo', 0, 0);
  // 1. abrir; si esta georreferenciado lejos del origen, reabrir acercandolo (la precision de la malla lo exige)
  let mid = api.OpenModel(datos, { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 12 });
  if (mid < 0) throw new Error('El archivo no se pudo abrir como IFC.');
  const esquema = String(api.GetModelSchema(mid) || '');
  let lejos = false;
  try { for (const tipo of [WI.IFCSITE, WI.IFCBUILDING]) { const ids = api.GetLineIDsWithType(mid, tipo); for (let i = 0; i < ids.size() && !lejos; i++) { const l = api.GetLine(mid, ids.get(i)); const pl = ref(l.ObjectPlacement); if (pl) { const m = api.GetWorldTransformMatrix(mid, pl); if (Math.abs(m[12]) > 20000 || Math.abs(m[13]) > 20000 || Math.abs(m[14]) > 20000) lejos = true; } } } } catch (e) {}
  if (lejos) { api.CloseModel(mid); mid = api.OpenModel(datos, { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 12 }); }
  let origen = [0, 0, 0];   // se lee despues de la geometria: web-ifc fija el desplazamiento con la primera malla

  const linea = (id) => { try { return api.GetLine(mid, id, false); } catch (e) { return null; } };
  const claseDe = (id) => { try { return String(api.GetNameFromTypeCode(api.GetLineType(mid, id)) || ''); } catch (e) { return ''; } };   // "IfcWall"
  const tipoDe = (id) => claseDe(id).toUpperCase();
  const idsDe = (t) => { const out = []; if (t == null) return out; try { const v = api.GetLineIDsWithType(mid, t); for (let i = 0; i < v.size(); i++) out.push(v.get(i)); } catch (e) {} return out; };

  // 2. unidades del proyecto (para las cantidades y medidas de las propiedades)
  let fLong = 1;
  try {
    for (const pid of idsDe(WI.IFCPROJECT)) {
      const p = linea(pid), ua = p && linea(ref(p.UnitsInContext)); if (!ua) continue;
      for (const u of lista(ua.Units)) {
        const ul = linea(ref(u)); if (!ul || txt(ul.UnitType) !== 'LENGTHUNIT') continue;
        if (ul.Prefix !== undefined || ul.Name) { const pre = txt(ul.Prefix); if (txt(ul.Name) === 'METRE') fLong = pre ? (SI_PREFIJO[pre] || 1) : 1; }
        if (ul.ConversionFactor) { const mw = linea(ref(ul.ConversionFactor)); const n = txt(ul.Name).toUpperCase(); fLong = /FOOT|FEET/.test(n) ? 0.3048 : /INCH/.test(n) ? 0.0254 : (mw ? Number(txt(mw.ValueComponent)) || 1 : 1); }
      }
    }
  } catch (e) {}
  const conUnidad = (medida, n) => {
    if (!Number.isFinite(n)) return '';
    const M = String(medida || '').toUpperCase();
    if (/LENGTHMEASURE|POSITIVELENGTH|NONNEGATIVELENGTH/.test(M)) return redondea(n * fLong, 3) + ' m';
    if (/AREAMEASURE/.test(M)) return redondea(n * fLong * fLong, 3) + ' m²';
    if (/VOLUMEMEASURE/.test(M)) return redondea(n * fLong * fLong * fLong, 3) + ' m³';
    if (/PLANEANGLE/.test(M)) return redondea(Math.abs(n) <= 2 * Math.PI + 1e-9 ? n * 180 / Math.PI : n, 2) + '°';
    if (/MASSMEASURE/.test(M)) return redondea(n, 2) + ' kg';
    if (/BOOLEAN|LOGICAL/.test(M)) return n ? 'Sí' : 'No';
    return Number.isInteger(n) ? String(n) : redondea(n, 3).replace(/\.?0+$/, '');
  };
  const valorTexto = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(valorTexto).filter(Boolean).join(', ');
    if (typeof v !== 'object') return String(v);
    const nom = String(v.name || ''), x = v.value !== undefined ? v.value : v._representationValue;
    if (/BOOLEAN|LOGICAL/i.test(nom)) return x === true || x === 'T' || x === '.T.' ? 'Sí' : x === false || x === 'F' || x === '.F.' ? 'No' : String(x == null ? '' : x);
    if (typeof x === 'number') return conUnidad(nom, x);
    if (x != null && typeof x !== 'object' && /MEASURE|REAL|INTEGER|COUNT/i.test(nom) && x !== '' && !isNaN(Number(x))) return conUnidad(nom, Number(x));
    return x == null || typeof x === 'object' ? '' : String(x);
  };

  // 3. relaciones: contencion espacial, agregacion, tipos, propiedades, materiales
  o.alAvanzar('relaciones', 0, 0);
  const contenidoEn = new Map(), padreDe = new Map(), tipoObjDe = new Map(), psetsDe = new Map(), materialDe = new Map();
  for (const rid of idsDe(WI.IFCRELCONTAINEDINSPATIALSTRUCTURE)) { const r = linea(rid); if (!r) continue; const s = ref(r.RelatingStructure); for (const e of lista(r.RelatedElements)) { const id = ref(e); if (id) contenidoEn.set(id, s); } }
  for (const T of [WI.IFCRELAGGREGATES, WI.IFCRELNESTS]) for (const rid of idsDe(T)) { const r = linea(rid); if (!r) continue; const pa = ref(r.RelatingObject); for (const e of lista(r.RelatedObjects)) { const id = ref(e); if (id && !padreDe.has(id)) padreDe.set(id, pa); } }
  for (const rid of idsDe(WI.IFCRELDEFINESBYTYPE)) { const r = linea(rid); if (!r) continue; const t = ref(r.RelatingType); for (const e of lista(r.RelatedObjects)) { const id = ref(e); if (id) tipoObjDe.set(id, t); } }
  for (const rid of idsDe(WI.IFCRELDEFINESBYPROPERTIES)) { const r = linea(rid); if (!r) continue; const defs = lista(r.RelatingPropertyDefinition).map(ref).filter(Boolean); for (const e of lista(r.RelatedObjects)) { const id = ref(e); if (!id) continue; let l = psetsDe.get(id); if (!l) { l = []; psetsDe.set(id, l); } l.push(...defs); } }
  const nombresMaterial = (id, prof) => {
    if (!id || prof > 6) return []; const m = linea(id); if (!m) return []; const t = tipoDe(id);
    if (t === 'IFCMATERIAL') return [txt(m.Name)];
    if (t === 'IFCMATERIALLAYERSETUSAGE') return nombresMaterial(ref(m.ForLayerSet), prof + 1);
    if (t === 'IFCMATERIALLAYERSET') return lista(m.MaterialLayers).flatMap(x => nombresMaterial(ref(x), prof + 1));
    if (t === 'IFCMATERIALLAYER') return nombresMaterial(ref(m.Material), prof + 1);
    if (t === 'IFCMATERIALCONSTITUENTSET') return lista(m.MaterialConstituents).flatMap(x => nombresMaterial(ref(x), prof + 1));
    if (t === 'IFCMATERIALCONSTITUENT') return nombresMaterial(ref(m.Material), prof + 1);
    if (t === 'IFCMATERIALLIST') return lista(m.Materials).flatMap(x => nombresMaterial(ref(x), prof + 1));
    if (t === 'IFCMATERIALPROFILESETUSAGE') return nombresMaterial(ref(m.ForProfileSet), prof + 1);
    if (t === 'IFCMATERIALPROFILESET') return lista(m.MaterialProfiles).flatMap(x => nombresMaterial(ref(x), prof + 1));
    if (t === 'IFCMATERIALPROFILE') return nombresMaterial(ref(m.Material), prof + 1);
    return [];
  };
  for (const rid of idsDe(WI.IFCRELASSOCIATESMATERIAL)) { const r = linea(rid); if (!r) continue; const ns = [...new Set(nombresMaterial(ref(r.RelatingMaterial), 0).filter(Boolean))]; if (!ns.length) continue; for (const e of lista(r.RelatedObjects)) { const id = ref(e); if (id) materialDe.set(id, ns.join(', ')); } }
  const cachePset = new Map();
  /** Las propiedades de un conjunto: [[nombre "Conjunto / Propiedad", valor]]. */
  const propsDePset = (pid) => {
    if (cachePset.has(pid)) return cachePset.get(pid);
    const out = [], ps = linea(pid), t = tipoDe(pid);
    if (ps) {
      const grupo = txt(ps.Name) || (t === 'IFCELEMENTQUANTITY' ? 'Cantidades' : 'Propiedades');
      const una = (pr, prefijo) => {
        const p = linea(ref(pr)); if (!p) return; const tp = tipoDe(ref(pr)), n = (prefijo ? prefijo + '.' : '') + txt(p.Name); let v = '';
        if (tp === 'IFCPROPERTYSINGLEVALUE') v = valorTexto(p.NominalValue);
        else if (tp === 'IFCPROPERTYENUMERATEDVALUE') v = valorTexto(p.EnumerationValues);
        else if (tp === 'IFCPROPERTYLISTVALUE') v = valorTexto(p.ListValues);
        else if (tp === 'IFCPROPERTYBOUNDEDVALUE') v = [valorTexto(p.LowerBoundValue), valorTexto(p.UpperBoundValue)].filter(Boolean).join(' – ');
        else if (tp === 'IFCCOMPLEXPROPERTY') { for (const h of lista(p.HasProperties)) una(h, n); return; }
        else if (/^IFCQUANTITY/.test(tp)) { const k = Object.keys(p).find(x => /Value$/.test(x) && x !== 'Formula'); const x = k ? p[k] : null; const num = Number(txt(x)); v = Number.isFinite(num) ? conUnidad(tp === 'IFCQUANTITYLENGTH' ? 'LENGTHMEASURE' : tp === 'IFCQUANTITYAREA' ? 'AREAMEASURE' : tp === 'IFCQUANTITYVOLUME' ? 'VOLUMEMEASURE' : tp === 'IFCQUANTITYWEIGHT' ? 'MASSMEASURE' : 'COUNT', num) : ''; }
        if (n && v !== '') out.push([grupo + ' / ' + n, v]);
      };
      for (const pr of lista(ps.HasProperties)) una(pr, '');
      for (const pr of lista(ps.Quantities)) una(pr, '');
    }
    cachePset.set(pid, out); return out;
  };
  const cacheNivel = new Map();
  const nivelDe = (id, prof) => {
    if (!id || (prof || 0) > 30) return '';
    if (cacheNivel.has(id)) return cacheNivel.get(id);
    const t = tipoDe(id); let n = '';
    if (t === 'IFCBUILDINGSTOREY') { const l = linea(id); n = txt(l && (l.Name || l.LongName)) || ('Nivel ' + id); }
    else if (contenidoEn.has(id)) n = nivelDe(contenidoEn.get(id), (prof || 0) + 1);
    else if (padreDe.has(id)) n = nivelDe(padreDe.get(id), (prof || 0) + 1);
    cacheNivel.set(id, n); return n;
  };

  // 4. geometria: una pasada por todas las mallas (y los espacios), escrita en archivos temporales
  const tmpPos = path.join(o.dirSalida, 'pos.tmp'), tmpIdx = path.join(o.dirSalida, 'idx.tmp'), tmpCol = path.join(o.dirSalida, 'col.tmp');
  const fdP = fs.openSync(tmpPos, 'w'), fdI = fs.openSync(tmpIdx, 'w'), fdC = fs.openSync(tmpCol, 'w');
  const tabla = [], porProducto = new Map();   // expressID -> { vo, vc, io, ic, color, tri }
  let nVert = 0, nIdx = 0, nMallas = 0;
  const alMalla = (m) => {
    nMallas++; if (nMallas % 500 === 0) o.alAvanzar('geometria', nMallas, 0);
    const pid = m.expressID, pg = m.geometries;
    if (porProducto.has(pid)) return;   // un producto llega una sola vez (los espacios van en una pasada aparte)
    const partes = [];   // cada geometria del producto con su propio color (marco, vidrio, tirador...)
    for (let i = 0; i < pg.size(); i++) {
      const g = pg.get(i); let geo;
      try { geo = api.GetGeometry(mid, g.geometryExpressID); } catch (e) { continue; }
      const va = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()), ia = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
      const T = g.flatTransformation, nv = va.length / 6;
      if (nv && ia.length) {
        const P = new Float32Array(nv * 3);
        for (let k = 0, j = 0; k < va.length; k += 6, j += 3) {
          const vx = va[k], vy = va[k + 1], vz = va[k + 2];
          const X = T[0] * vx + T[4] * vy + T[8] * vz + T[12], Y = T[1] * vx + T[5] * vy + T[9] * vz + T[13], Z = T[2] * vx + T[6] * vy + T[10] * vz + T[14];
          P[j] = X; P[j + 1] = -Z; P[j + 2] = Y;   // web-ifc entrega Y arriba; el .cdeg va en ejes de Revit (Z arriba)
        }
        const c = g.color, a = c.w == null ? 1 : c.w, tr = a < 0.9;
        let rgb = [Math.round(c.x * 255), Math.round(c.y * 255), Math.round(c.z * 255)];
        // vidrio casi blanco o invisible (lo habitual en el IFC de Revit): se tine como el vidrio de Revit / Forma, azul grisaceo
        if (tr && (0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z > 0.78 || a < 0.05)) rgb = [58, 72, 88];   // vidrio sin color propio: oscuro, como se ve una ventana desde fuera
        // vidrio con color propio (p. ej. paneles azules de muro cortina): se respeta el color del modelo, como en Forma
        partes.push({ P, I: Uint32Array.from(ia), nv, color: rgb.concat([Math.round(Math.max(a, 0.25) * 255)]), tr });
      }
      try { geo.delete(); } catch (e) {}
    }
    if (!partes.length) return;
    // opacos primero y vidrio al final: asi el visor deja la parte opaca solida y el vidrio translucido (formato 2, icTr)
    const opacos = partes.filter(x => !x.tr), vidrios = partes.filter(x => x.tr), orden = opacos.concat(vidrios);
    const dominante = (L) => L.reduce((a, b) => (b.I.length > a.I.length ? b : a)).color;
    const color = opacos.length ? dominante(opacos) : dominante(vidrios);
    const x = { pid, vo: nVert, vc: 0, io: nIdx, ic: 0, icTr: 0, color };
    for (const pt of orden) {
      const I = new Uint32Array(pt.I.length); for (let k = 0; k < I.length; k++) I[k] = pt.I[k] + x.vc;
      const C = Buffer.alloc(pt.nv * 3); for (let k = 0; k < pt.nv; k++) { C[k * 3] = pt.color[0]; C[k * 3 + 1] = pt.color[1]; C[k * 3 + 2] = pt.color[2]; }
      fs.writeSync(fdP, Buffer.from(pt.P.buffer, pt.P.byteOffset, pt.P.byteLength)); fs.writeSync(fdC, C);
      fs.writeSync(fdI, Buffer.from(I.buffer, I.byteOffset, I.byteLength));
      x.vc += pt.nv; x.ic += I.length; if (pt.tr && opacos.length) x.icTr += I.length;
    }
    nVert += x.vc; nIdx += x.ic; porProducto.set(pid, x); tabla.push(x);
  };
  o.alAvanzar('geometria', 0, 0);
  api.StreamAllMeshes(mid, alMalla);
  const espacios = idsDe(WI.IFCSPACE).filter(id => !porProducto.has(id));
  if (espacios.length) { try { api.StreamAllMeshesWithTypes(mid, [WI.IFCSPACE], alMalla); } catch (e) { avisos.push('Los espacios (ambientes) no se pudieron leer: ' + e.message); } }
  fs.closeSync(fdP); fs.closeSync(fdI); fs.closeSync(fdC);
  if (lejos) {
    try {   // la matriz de coordinacion lleva al origen; el desplazamiento (en ejes de Revit) es su inversa
      const c = api.GetCoordinationMatrix(mid); origen = [-c[12], c[14], -c[13]].map(v => (Math.abs(v) < 1e-9 ? 0 : v));
      avisos.push('Modelo georreferenciado: se acercó al origen para conservar la precisión (desplazamiento ' + origen.map(v => v.toFixed(2)).join(', ') + ' m, guardado en el paquete).');
    } catch (e) {}
  }

  // 5. elementos e indice
  o.alAvanzar('parametros', 0, tabla.length);
  const usados = new Set(), etiquetas = new Map();
  for (const x of tabla) { const l = linea(x.pid); const tag = txt(l && l.Tag); if (/^\d{1,10}$/.test(tag) && Number(tag) > 0 && Number(tag) <= 0xffffffff) etiquetas.set(tag, (etiquetas.get(tag) || 0) + 1); }
  const attrs = new Map(), vals = new Map(), porPar = new Map(); let pares = 0;
  const aid = (n) => { let k = attrs.get(n); if (k == null) { k = attrs.size + 1; attrs.set(n, k); } return k; };
  const vid = (v) => { let k = vals.get(v); if (k == null) { k = vals.size + 1; vals.set(v, k); } return k; };
  const pon = (e, n, v) => { if (v == null || v === '') return; const a = aid(n), w = vid(String(v).slice(0, 2000)); const key = a * 4294967296 + w; let l = porPar.get(key); if (!l) { l = [a, w, []]; porPar.set(key, l); } l[2].push(e); pares++; };
  const elem = [];
  let k = 0;
  for (const x of tabla) {
    if (++k % 2000 === 0) o.alAvanzar('parametros', k, tabla.length);
    const l = linea(x.pid) || {}, clase = tipoDe(x.pid), claseTxt = claseDe(x.pid), gid = txt(l.GlobalId), tag = txt(l.Tag);
    let e = (/^\d{1,10}$/.test(tag) && etiquetas.get(tag) === 1) ? Number(tag) : hash31(gid || String(x.pid));
    while (usados.has(e)) e = (e % 0x7fffffff) + 1;
    usados.add(e); x.e = e;
    const nombre = txt(l.Name), objType = txt(l.ObjectType), tObj = tipoObjDe.get(x.pid), tl = tObj ? linea(tObj) : null, tNombre = txt(tl && tl.Name);
    // propiedades del elemento y de su tipo (las del elemento mandan)
    const props = new Map();
    for (const ps of (tl ? lista(tl.HasPropertySets).map(ref).filter(Boolean) : [])) for (const [n, v] of propsDePset(ps)) props.set(n, v);
    for (const ps of (psetsDe.get(tObj) || [])) for (const [n, v] of propsDePset(ps)) props.set(n, v);
    for (const ps of (psetsDe.get(x.pid) || [])) for (const [n, v] of propsDePset(ps)) props.set(n, v);
    if (o.traducir) { const t = new Map(); for (const [n, v] of props) t.set(traduceNombre(n), v); props.clear(); for (const [n, v] of t) props.set(n, v); }
    const busca = (rx) => { for (const [n, v] of props) if (rx.test(n.split(' / ').pop())) return v; return ''; };
    // Categoria / Familia / Tipo
    let cat = '', fam = '', tip = '';
    const trio = /^(.+?) : (.+?) : (.+)$/.exec(nombre) || /^(.+?) : (.+?) : (.+)$/.exec(tNombre);
    if (trio) { cat = trio[1].trim(); fam = trio[2].trim(); tip = trio[3].trim(); }
    if (!cat) cat = busca(/^(categor[ií]a|category)$/i);
    if (!fam || !tip) {
      const ft = busca(/^(familia y tipo|family and type)$/i) || objType || tNombre;
      const m2 = /^(.+?)\s*:\s*(.+)$/.exec(ft || '');
      if (m2) { fam = fam || m2[1].trim(); tip = tip || m2[2].trim(); } else { fam = fam || busca(/^(nombre de familia|family name|familia|family)$/i) || tNombre || clase; tip = tip || busca(/^(nombre de tipo|type name)$/i) || objType || tNombre || nombre || clase; }
    }
    if (!cat) cat = CATEGORIA_IFC[clase] || claseTxt || 'Sin categoría';
    if (o.traducir) { cat = ES_CATEGORIA[cat] || cat; fam = ES_FAMILIA[fam] || fam; }
    // ambientes (IfcSpace): como Revit, Familia y Tipo = Habitacion (o Area); el nombre y el numero van como parametros
    let nomAmb = '', numAmb = '';
    if (clase === 'IFCSPACE') {
      const area = /^(area|área)\b/i.test(nombre) || /^(area|área)\b/i.test(tNombre) || /^(Áreas|Areas)$/.test(cat);
      cat = area ? 'Áreas' : (/^(Espacios|Spaces)$/.test(cat) ? 'Espacios' : 'Habitaciones'); fam = area ? 'Área' : 'Habitación'; tip = fam;
      numAmb = /^(room|area)-\d+$/i.test(nombre) ? '' : nombre.replace(/:\d+$/, '');
      nomAmb = txt(l.LongName) || (tNombre ? tNombre.replace(/:\d+$/, '').replace(numAmb ? new RegExp('\\s*' + numAmb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : /$^/, '').trim() : '') || numAmb;
    }
    if (!fam || fam.toUpperCase() === clase) fam = cat;
    if (!tip || tip.toUpperCase() === clase) tip = nombre || cat;
    const niv = nivelDe(x.pid);
    const visible = tip || nombre || clase;
    elem.push([e, visible + ' [' + (etiquetas.get(tag) === 1 ? tag : e) + ']', o.modelo, cat, fam, tip, niv, 1]);
    pon(e, '● Modelo', o.modelo); pon(e, '● Categoria', cat); pon(e, '● Familia', fam); pon(e, '● Tipo', tip); pon(e, '● Nivel', niv);
    pon(e, 'IFC / Clase', claseTxt); if (nomAmb) pon(e, 'Identidad / Nombre', nomAmb); if (numAmb) pon(e, 'Identidad / Número', numAmb); pon(e, 'IFC / Nombre', nombre); pon(e, 'IFC / Tipo de objeto', objType); pon(e, 'IFC / Descripción', txt(l.Description));
    pon(e, 'IFC / Tipo predefinido', txt(l.PredefinedType)); pon(e, 'IFC / Tipo', tNombre);
    pon(e, 'Identidad / IfcGUID', gid); if (etiquetas.get(tag) === 1) pon(e, 'Identidad / ElementId', tag); else pon(e, 'IFC / Etiqueta', tag);
    pon(e, 'Materiales y acabados / Material', materialDe.get(x.pid) || (tObj && materialDe.get(tObj)) || '');
    for (const [n, v] of props) pon(e, n, v);
  }

  // 6. trozos del indice (gzip): elementos, diccionarios, pares (en diferencias, como exporta-indice.js del visor)
  o.alAvanzar('escribiendo', 0, 0);
  let nTrozo = 0; const escribe = (obj) => { nTrozo++; fs.writeFileSync(path.join(o.dirSalida, nTrozo + '.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(obj)))); };
  for (let i = 0; i < elem.length; i += TOPE_ELEM_TROZO) escribe({ elem: elem.slice(i, i + TOPE_ELEM_TROZO) });
  escribe({ attrs: [...attrs].map(([n, i]) => [i, n]), vals: [...vals].map(([v, i]) => [i, v]) });
  const grupos = [...porPar.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let lote = [], enLote = 0;
  for (const [a, w, es] of grupos) {
    es.sort((p, q) => p - q); const d = [a, w]; let prev = 0; for (const e of es) { d.push(e - prev); prev = e; }
    lote.push(d); enLote += es.length;
    if (enLote >= TOPE_PARES_TROZO) { escribe({ eavd: lote }); lote = []; enLote = 0; }
  }
  if (lote.length) escribe({ eavd: lote });

  // 7. geometria.cdeg: cabecera + metadatos + tabla + posiciones + indices (docs/FORMATO-PAQUETE.md)
  let rutaGeo = '';
  if (tabla.length) {
    rutaGeo = path.join(o.dirSalida, 'geometria.cdeg');
    const meta = Buffer.from(JSON.stringify({ modelo: o.modelo, unidades: 'm', ejeArriba: 'Z', herramienta: o.herramienta, ifc: { esquema, archivo: path.basename(rutaIfc) }, origen: origen,   // el exacto (la cabecera lo lleva en f32)
      fecha: new Date().toISOString() }));
    const cab = Buffer.alloc(36); cab.write('CDEG', 0, 'latin1'); cab.writeUInt32LE(2, 4); /* formato 2: + vidrio por elemento + color por vertice */ cab.writeUInt32LE(tabla.length, 8); cab.writeUInt32LE(nVert, 12); cab.writeUInt32LE(nIdx, 16);
    cab.writeFloatLE(origen[0], 20); cab.writeFloatLE(origen[1], 24); cab.writeFloatLE(origen[2], 28); cab.writeUInt32LE(meta.length, 32);
    const pad = (4 - (36 + meta.length) % 4) % 4, tb = Buffer.alloc(24 * tabla.length);
    tabla.forEach((x, i) => { const c = x.color || [200, 200, 200, 255]; tb.writeUInt32LE(x.e >>> 0, i * 24); tb.writeUInt32LE(x.vo, i * 24 + 4); tb.writeUInt32LE(x.vc, i * 24 + 8); tb.writeUInt32LE(x.io, i * 24 + 12); tb.writeUInt32LE(x.ic, i * 24 + 16); tb.writeUInt8(c[0], i * 24 + 20); tb.writeUInt8(c[1], i * 24 + 21); tb.writeUInt8(c[2], i * 24 + 22); tb.writeUInt8(Math.max(30, c[3]), i * 24 + 23); });
    const fd = fs.openSync(rutaGeo, 'w');
    fs.writeSync(fd, cab); fs.writeSync(fd, meta); if (pad) fs.writeSync(fd, Buffer.alloc(pad)); fs.writeSync(fd, tb);
    const copia = (ruta) => { const fi = fs.openSync(ruta, 'r'), b = Buffer.alloc(8 * 1024 * 1024); let n; while ((n = fs.readSync(fi, b, 0, b.length, null)) > 0) fs.writeSync(fd, b, 0, n); fs.closeSync(fi); };
    copia(tmpPos); copia(tmpIdx);
    const tr = Buffer.alloc(4 * tabla.length); tabla.forEach((x, i) => tr.writeUInt32LE(x.icTr || 0, i * 4)); fs.writeSync(fd, tr);
    copia(tmpCol); const padC = (4 - (nVert * 3) % 4) % 4; if (padC) fs.writeSync(fd, Buffer.alloc(padC));
    fs.closeSync(fd);
  } else avisos.push('El IFC no trae geometría visible (solo datos).');
  for (const t of [tmpPos, tmpIdx, tmpCol]) { try { fs.unlinkSync(t); } catch (e) {} }
  api.CloseModel(mid);
  return { elementos: elem.length, parametros: attrs.size, pares, triangulos: nIdx / 3, trozos: nTrozo, geometria: rutaGeo, esquema, avisos, modelo: o.modelo };
}

module.exports = { convierte, CATEGORIA_IFC };
