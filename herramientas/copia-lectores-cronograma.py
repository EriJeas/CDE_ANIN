# Copia al portal los lectores puros de cronogramas del visor (XER, XML de P6 y de Project, MPX, Excel y ruta crítica).
# Uso, desde la carpeta del CDE:  python herramientas/copia-lectores-cronograma.py
src = open('public/js/visor-origen/cronograma.js', encoding='utf-8').read().split('\n')

def bloque(ini, fin):
    i = next(k for k, l in enumerate(src) if l.startswith(ini))
    j = next(k for k in range(i + 1, len(src)) if src[k].startswith(fin))
    return '\n'.join(src[i:j]).rstrip()

partes = [bloque('function conFuente', 'const fecha = '), bloque('const fecha = ', '/** XML de Microsoft Project'), bloque('function leeXml', '/**'),
          bloque('function xerTablas', '/** El tipo de vinculo'), bloque('function xerTipoVinculo', '/** El desfase'), bloque('function xerLag', 'function leeXer'),
          bloque('function leeXer', '/** MPX'), bloque('function leeMpx', '/*'), bloque('function crInfiereVinculos', '/** CPM'),
          bloque('function crRutaCriticaDe', '// ---------- Gantt'), bloque('function fechaExcel', 'function leeExcel'), bloque('function leeExcel', '/* ====')]
cab = """/* LECTORES DE CRONOGRAMAS para Planificación (Seguimiento de obra): Primavera P6 (XER y XML), Microsoft Project (XML y MPX) y Excel.
 * Son, sin cambios, las funciones puras del visor (public/js/visor-origen/cronograma.js): se copian aquí con
 * herramientas/copia-lectores-cronograma.py para que el portal las use sin cargar el visor. No editar a mano: corregir allá y volver a copiar. */
(function () {
"""
pie = """

  CDE.N.OBX = CDE.N.OBX || {};
  CDE.N.OBX.lectores = { leeXml, leeXer, leeMpx, leeExcel, crInfiereVinculos, crRutaCriticaDe, xerTablas };
})();
"""
open('public/js/modulos/obra-plan-lectores.js', 'w', encoding='utf-8').write(cab + '\n\n'.join(partes) + pie)
print('public/js/modulos/obra-plan-lectores.js actualizado')
