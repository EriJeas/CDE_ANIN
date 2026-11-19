# compartido-visor — lo que el CDE reutiliza del Visor BIM (sin reimplementar)

| Archivo | Origen en el visor | Cambios |
|---|---|---|
| `indice-modelos.js` | `indice-modelos.js` | ninguno (copia literal) |
| `extractor-modelos.js` | `extractor-modelos.js` | ninguno (copia literal); el CDE usa su clase `Indice` (SQLite) y `trozoVisor()` |
| `clasificadores-visor.js` | `public/js/app.js` y `public/js/llenado.js` | GENERADO con `herramientas/actualiza-clasificadores.js` (usa la `declaracion()` del propio visor) |
| `reporte-forma.js` | `reporte-forma.js` | puente: solo `fuentesComunes` / `fuentesDeArchivo`, leyendo de `clasificadores-visor.js` |

Regla: estos archivos NO se editan aqui. Si el visor cambia, se vuelve a copiar / generar:

    node herramientas/actualiza-clasificadores.js "D:\Proyectos IA\visor-bim-anin"

El formato de los trozos de indice que recibe el CDE (`/api/modelos/:id/indice/...`) es el MISMO que sube
`public/js/exporta-indice.js` del visor: `{ elem: [[e, nombre, modelo, cat, fam, tip, niv, clase]] }` y
`{ attrs: [[id, nombre]], vals: [[id, texto]], eavd: [[a, v, e1, d2, d3, ...]] }`. El complemento de Revit del CDE
produce ese mismo formato, por eso las cifras del CDE coinciden con las del visor.
