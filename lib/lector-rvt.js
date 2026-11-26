/*
 * LECTOR RVT DEL CDE (sin Revit ni Autodesk): pasa un .rvt a IFC con rvt-rs (licencia Apache-2.0, lector libre hecho
 * desde observaciones publicas del formato) y ese IFC sigue el mismo camino que cualquier IFC (lib/lector-ifc.js).
 *
 * Lo que rvt-rs recupera depende de la version de Revit en que se guardo el archivo (su matriz de soporte): en 2023-2025
 * los elementos con geometria (aproximada en parte) y pocos parametros; en otras versiones, menos. Por eso es una lectura
 * "lo mejor posible": la via completa (geometria exacta y todos los parametros) sigue siendo el complemento de Revit.
 *
 * Herramienta, en este orden:
 *   1. RVT_IFC (cde.env): ruta a un ejecutable rvt-ifc.
 *   2. herramientas/rvt/rvt-ifc.exe (Windows) o herramientas/rvt/rvt-ifc (Linux/macOS), que viajan con el CDE.
 *   3. Python con el paquete rvt (pip install rvt): python3 / python / py -3.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { spawn, spawnSync } = require('child_process');

const DIR_HERR = path.join(__dirname, '..', 'herramientas', 'rvt'), DIR_LINUX = path.join(DIR_HERR, 'linux');
const PY_SCRIPT = [
  'import sys, rvt',
  'f = rvt.RevitFile(sys.argv[1], max_stream_bytes=2*1024**3, max_inflate_bytes=8*1024**3)',
  'out = f.write_ifc()',
  'open(sys.argv[2], "w", encoding="utf-8").write(out)',
  'print("REVIT", f.version or "")'
].join('\n');

let cacheHerramienta;
/** { tipo: 'cli'|'python', cmd, args0 } o null si no hay ninguna. */
function herramienta() {
  if (cacheHerramienta !== undefined) return cacheHerramienta;
  const ejecutable = process.platform === 'win32' ? 'rvt-ifc.exe' : 'rvt-ifc';
  const candidatos = [process.env.RVT_IFC, path.join(DIR_HERR, ejecutable)].filter(Boolean);
  for (const c of candidatos) if (fs.existsSync(c)) return (cacheHerramienta = { tipo: 'cli', cmd: c, args0: [] });
  // v0.25.7: en Linux x64 (el servidor en la nube) el lector viaja con el CDE (herramientas/rvt/linux, rvt-rs para Python): solo hace falta Python 3.8+
  const propio = process.platform === 'linux' && process.arch === 'x64' && fs.existsSync(path.join(DIR_LINUX, 'rvt')) ? Object.assign({}, process.env, { PYTHONPATH: DIR_LINUX + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '') }) : null;
  for (const env of [propio, undefined]) {
    if (env === null) continue;
    for (const [cmd, a0] of [['python3', []], ['python', []], ['py', ['-3']]]) {
      try { const r = spawnSync(cmd, a0.concat(['-c', 'import rvt; print(rvt.__version__ if hasattr(rvt, "__version__") else "ok")']), { timeout: 20000, encoding: 'utf8', windowsHide: true, env }); if (r.status === 0) return (cacheHerramienta = { tipo: 'python', cmd, args0: a0, env }); } catch (e) {}
    }
  }
  return (cacheHerramienta = null);
}
const disponible = () => !!herramienta();
const QUE_FALTA = 'Para leer RVT sin Revit falta el lector rvt-rs: en Windows viaja con el CDE (herramientas\\rvt\\rvt-ifc.exe); en Linux viaja también (herramientas/rvt/linux) y necesita Python 3.8 o superior en el servidor. Mientras tanto, publica el modelo con el complemento de Revit o carga su IFC.';

/** La version de Revit del archivo, leida de su cabecera (BasicFileInfo, en UTF-16): '2024' o ''. Sin herramientas externas. */
function versionRevit(ruta) {
  try {
    const fd = fs.openSync(ruta, 'r'), tam = Math.min(fs.fstatSync(fd).size, 8 * 1024 * 1024), b = Buffer.alloc(tam);
    fs.readSync(fd, b, 0, tam, 0); fs.closeSync(fd);
    const t = b.toString('utf16le'), m = /Autodesk Revit (20\d\d)/.exec(t) || /Format: (20\d\d)/.exec(t) || /Revit (20\d\d)/.exec(t);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

/** RVT -> IFC. Resuelve { ok, ifc, revit, salida } o { ok: false, error }. */
function aIfc(rutaRvt, rutaIfc, alAvanzar) {
  const h = herramienta();
  if (!h) return Promise.resolve({ ok: false, error: QUE_FALTA });
  return new Promise((resuelve) => {
    const diag = rutaIfc.replace(/\.ifc$/i, '') + '.diagnostico.json';
    const args = h.tipo === 'cli' ? h.args0.concat([rutaRvt, '-o', rutaIfc, '--diagnostics', diag, '--large-model', '--allow-partial']) : h.args0.concat(['-c', PY_SCRIPT, rutaRvt, rutaIfc]);
    let salida = '', fin = false;
    const p = spawn(h.cmd, args, { windowsHide: true, env: h.env });
    const reloj = setTimeout(() => { if (!fin) { try { p.kill(); } catch (e) {} } }, 45 * 60 * 1000);
    p.stdout.on('data', (d) => { salida += d; if (alAvanzar) alAvanzar('rvt', 0, 0); });
    p.stderr.on('data', (d) => { salida += d; });
    p.on('error', (e) => { fin = true; clearTimeout(reloj); resuelve({ ok: false, error: 'No se pudo ejecutar el lector RVT: ' + e.message }); });
    p.on('close', (code) => {
      fin = true; clearTimeout(reloj);
      const hay = fs.existsSync(rutaIfc) && fs.statSync(rutaIfc).size > 0;
      let diagnostico = null; try { diagnostico = JSON.parse(fs.readFileSync(diag, 'utf8')); } catch (e) {}
      const revit = (/REVIT (20\d\d)/.exec(salida) || [])[1] || versionRevit(rutaRvt);
      if (!hay) return resuelve({ ok: false, error: 'El lector libre no pudo pasar este RVT a IFC' + (revit ? ' (Revit ' + revit + ')' : '') + '. ' + (salida.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400)) });
      resuelve({ ok: true, ifc: rutaIfc, revit, codigo: code, salida: salida.slice(-2000), diagnostico });
    });
  });
}

module.exports = { aIfc, disponible, herramienta, versionRevit, QUE_FALTA };
