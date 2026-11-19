# Visor del CDE: integración de los módulos del Visor BIM Federado (plan de portado)

Decisión (10/11/2026): el visor del CDE sigue dibujando con geometría propia (`.cdeg`, sin Autodesk) y los módulos del
Visor BIM Federado se **portan uno a uno reutilizando su lógica** (sus funciones puras y sus archivos), no reescribiéndolos.

## Inventario verificado del Visor BIM Federado (public/js/interfaz-nueva.js, COMPONENTES)

| Grupo | Componente | Archivo(s) de origen | Depende de | Estado en el CDE |
|---|---|---|---|---|
| Filtros | Visor con filtros | app.js, llenado.js | índice (IV) + viewer | ✔ existe (`filtros`) |
| Filtros | Filtro con sectores | app.js (mismo panel + Sector/Zona) | índice | ✔ portado v0.6.2 (`visor-origen/sectores.js` tal cual + `visor-puente.js`; carril «Filtro con sectores»: barra de sectores, línea de tiempo, tabla acumulado/semanas, clic en celda aísla) |
| Filtros | Filtro horizontales | app.js (horiz) | índice | ✘ portar |
| Interferencias | Por conjuntos | app.js (clash) | viewer (cajas) + conjuntos | ✔ existe (`conjuntos`) |
| Interferencias | Integrales | integral.js | índice + viewer (aislar/colorear) | ✘ portar |
| Documentos Forma | Cronograma | cronograma.js, clase-cronograma.js | archivo Project/Primavera + índice | ◐ v0.6.5: Gantt y Hoja de cálculo tal cual en el **Visualizador de archivos** del portal (`ver.html` + `ver-puente.js`); falta en el Visor 3D el enlace 4D con el modelo y la clase AACE (`clase-cronograma.js`) |
| Documentos Forma | Archivos GIS | gis.js | archivos GIS del proyecto | ◐ v0.6.5: lectores tal cual (shp/dbf/prj, kml, kmz, gpx, geojson, gpkg, zip) y tabla de atributos en el **Visualizador de archivos**, dibujados en un mapa (Leaflet); falta en el Visor 3D el dibujo sobre el modelo (`dibujaGis`) y la geodatabase .gdb (`gdb.js`) |
| Documentos Forma | Visor GIS | visor-gis.js | viewer (terreno, ortofotos, capas) | ✘ portar (grande: 168 KB, 48 usos del viewer) |
| Documentos Forma | Documentos | planolink.js | carpetas de Forma + viewer | ✘ portar sobre las carpetas del CDE |
| Documentos Forma | Extracción de datos de Forma | docforma | API de Forma | ✘ equivalente: ya es el propio CDE |
| Documentos Forma | Modelos / Planos | modelos-planos.js | índice | ✔ portado v0.6.2 (`visor-origen/modelos-planos.js`; índice de planos desde las carpetas del CDE: `GET /api/proyectos/:pid/planos-indice`; abre el PDF con pdf.js) |
| Documentos Forma | Documentos del elemento | documentos-elemento.js | índice + documentos del CDE | ✘ portar |
| Información | Modelos en proyecto | app.js (modelosP) | lista de modelos | ✔ existe (lista de versiones) |
| Información | Aconex | app.js | API Aconex | ✔ equivalente propio v0.6.2: módulo **Documentos** del portal (`#/p/<id>/documentos`, «Buscar - Registro de documentos» como Aconex, sobre los documentos del CDE) + Correspondencia/Transmisiones |
| Información | Niveles / Ambientes | app.js | índice | ✔ existe (`ambientes`) |
| Información | Edición de parámetros | editor-parametros.js | índice + complemento Revit | ✘ portar (el complemento del CDE ya aplica cambios) |
| Análisis | Avance de modelado | avance-modelado.js | índice por versión + curva S (dfCurvaSvg…) | ✘ portar |
| Información | Tablero (métricas BIM) | app.js (mbim) | índice | ✔ portado v0.6.2 (`visor-origen/metricas-cobie.js`; cantidades por elemento desde `POST /api/modelos/:pid/:vid/cantidades`) |
| Información | Tablero | app.js (#dash) | índice | ✔ parcial (barras del panel de filtros) |
| Análisis | Cronograma desde modelo | app.js (crmodelo) | índice (parámetros de fecha) | ✘ portar |
| Análisis | Auditor de diseño | disenio.js | índice + geometría (distancias) | ✘ portar |
| Análisis | Auditor de PMA | norma-rm045.js, pma-*.js | índice (ambientes) + PMA | ✘ portar |
| Análisis | Verificación de LOD | lod.js, lod3d.js | índice (familias) | ✘ portar |
| Análisis | Comparar modelos | app.js (comparar) | dos modelos cargados | ✘ portar |
| Análisis | Comparar versiones | comparar-versiones.js | índice de dos versiones | ✔ existe (`comparar`, lib/comparar.js) |
| Análisis | Verificar levantamiento | verifica-levantamiento | incidencias + índice | ✘ portar |
| Análisis | Flujos hospitalarios | flujos-hospitalarios.js | índice (ambientes/UPSS) + viewer | ✔ existe (`flujos`) — revisar contra el original |
| Mantenimiento | COBie / Uniclass | app.js (cobie) | índice | ✔ portado v0.6.2 (`visor-origen/metricas-cobie.js`; parámetros COBie.* / Uniclass desde `GET /api/modelos/:pid/:vid/props`) |
| Mantenimiento | Operación y mantenimiento | mantenimiento.js | índice + servidor (activos/OT) | ✘ portar |
| Variados | Verificar planos vs modelos | app.js (verifica) | planos PDF + índice | ✘ portar |
| Variados | Inteligencia asistida | asistente.js | índice + IA | ✘ portar (el CDE ya tiene IA_CLAVE) |

Lo que el visor del CDE tiene y **no** está así en el Visor BIM Federado (se revisará con Erick si se mantiene):
`inventario` (en el original el inventario vive en el portal: inventario.js), `planos` (dos revisiones de un PDF superpuestas), `incidencias` (en el original es «Agregar interferencias»), `elemento`, `ayuda`.

## Cómo se porta cada módulo (regla)
1. El módulo original se copia a `public/js/visor-origen/<archivo>.js` sin tocar su lógica.
2. `public/js/visor-puente.js` da lo que el módulo espera del Visor BIM Federado: el índice `IV` (mismo formato que
   `modelos-local.js`/`exporta-indice.js`, armado desde el índice SQLite del CDE), el objeto `viewer` con lo que usan
   (isolate / show / hide / select / getSelection / setThemingColor / clearThemingColors / fitToView / eventos) sobre el
   visor `.cdeg`, y los ayudantes de app.js que necesite (api, ventana, dfCurvaSvg…), uno por uno y verificados.
3. Lo que el módulo guardaba en el servidor del visor (fotos de avance, metas, activos de mantenimiento, etc.) se guarda en
   el CDE con la misma forma (`lib/visor-datos.js`).
4. Se prueba con la semilla y se marca ✔ en esta tabla.

## Orden propuesto (por dependencia: primero lo que solo necesita el índice)
1. Filtro con sectores · Filtro horizontales · Tablero (métricas BIM) · COBie/Uniclass · Cronograma desde modelo
2. Avance de modelado · Verificación de LOD · Modelos/Planos · Documentos del elemento · Edición de parámetros
3. Interferencias integrales · Auditor de diseño · Auditor de PMA · Verificar levantamiento · Operación y mantenimiento
4. Cronograma (Project/Primavera) · Archivos GIS · Documentos (planolink) · Verificar planos vs modelos
5. Visor GIS · Comparar modelos · Inteligencia asistida
