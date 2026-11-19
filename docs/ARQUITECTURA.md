# CDE ANIN — Arquitectura

Desarrollo institucional, **aparte del Visor BIM** (repositorio y despliegue propios), que reutiliza del visor lo que ya
resuelve y no lo reimplementa.

## 1. Las piezas

```
 Revit ──[complemento "Publicar al CDE"]──┐
 Navisworks ──[complemento, fase 2]───────┤    paquete = indice (formato del visor) + geometria .cdeg
 Autodesk Forma ──[conector: webhooks]────┤──►  SERVIDOR DEL CDE (Node/Express, servidor de la entidad)
 IFC / archivos ──[web: arrastrar]────────┘        ├─ cde.sqlite    proyectos, contenedores, versiones, estados ISO 19650,
                                                   │                revisiones por rondas, incidencias, llaves, auditoria
                                                   ├─ archivos/     los RVT/NWD/IFC/PDF/DWG tal cual (almacen: disco → SharePoint/S3)
                                                   └─ indices/      por version: <vid>.sqlite (clase Indice del visor) + <vid>.cdeg
                                                           │
                              web del CDE (contenedores, estados, revisiones, incidencias, BCF) + visor liviano (Three.js)
```

| Carpeta | Que hay | Origen |
|---|---|---|
| `servidor.js` | arranque, estaticos, montaje de modulos | propio |
| `lib/bd.js` | esquema SQLite y auditoria | propio |
| `lib/estructura.js` | estructura de carpetas **por partes** (plantilla Hospitales: A ANIN · B CONTR/SUPER/ANIN2 · C E4.01.xx), permisos por parte, carpeta WIP, destino de publicacion, flujos por defecto | propio, segun la lamina de Erick y el chat "Estructura de carpetas ISO 19650" |
| `lib/iso19650.js` | estados, transiciones, codigos de idoneidad y revision, **validacion de nombre** | propio; la regla por defecto es `validaNombre19650` del visor |
| `lib/acceso.js` | sesion cifrada, modos local / Autodesk / Microsoft, roles por proyecto, **llaves de complementos** | derivado del visor (sesion AES-GCM, llaves con huella) |
| `lib/almacen.js` | donde viven los archivos (disco hoy; interfaz para SharePoint/S3) | propio |
| `lib/cde.js` | proyectos, contenedores, versiones, transiciones, revisiones, incidencias, BCF, llaves, auditoria | propio |
| `lib/modelos.js` | recibe el paquete (inicio → trozos → geometria → fin), arma el indice en un hilo aparte, consultas | protocolo del visor (`/api/modelos/.../indice/*`) |
| `lib/trabajador-indice.js` | worker que arma el SQLite con la clase `Indice` del visor | idea del `trabajador-indice.js` del visor |
| `lib/comparar.js` | **comparar dos versiones** de un modelo por UniqueId sobre sus indices (nuevo / eliminado / modificado / igual, parametros cambiados, cambios globales apartados, cache junto al indice) | reglas de `comparar-versiones.js` del visor (volatiles, numeros iguales) |
| `lib/modelos.js` (v0.5) | `/ambientes` y `/puertas` del indice (expresiones de buildRooms / leeAnchos del visor), configuracion de Flujos hospitalarios por proyecto (`config.flujosHospitalarios`) | visor |
| `public/ver.html` (v0.6.5) | **Visualizador de archivos** (sin servidor nuevo: baja la versión por `/versiones/:vid/descargar`). Carga tal cual `visor-origen/cronograma.js` (Gantt + Hoja de cálculo), `gis.js` (lectores GIS, atributos), `buscador.js` (lector de ZIP/Word/PowerPoint), `app-utm.js` (UTM inversa) y la hoja `css/visor-origen-main.css`; `js/ver-puente.js` les da lo que daba app.js y elige la ventana según la extensión; `js/ver-doc.js` pinta Word/PowerPoint/texto; `js/ver-gis.js` dibuja las capas en Leaflet (`vendor/leaflet`), `vendor/sql-wasm` para GeoPackage | `archivos.js` (`N.verArchivo`), `documentos.js` (pestaña Visualizador) |
| `lib/flujos.js` + `lib/cde.js` (v0.6.6) | Motor de flujos ampliado: revisor `{tipo:'cargo', valor, org}` (columna `miembros.cargo`); etapa `modo:'consenso'` + `arbitro` + `alVencer:'avanzar'` + `etiquetas`; paso `recomienda` + `decide`. `decidir` acepta `adhiere` y `notificar`; cada decisión guarda `clase` (recomendacion, decision-equipo, adhesion, arbitraje, auto). `procesaVencidas` (al listar revisiones y cada 5 min) aplica el plazo. `decoraRevision` entrega `acciones` y `resumen`. Avisos: correos `notificacion` numerados `REV-`. `lib/carpetas.js → plantillaZonas`. |
| `lib/correspondencia.js` (v0.6.4) | **Línea de comunicación** (Aconex): `hiloDe()` arma el hilo como árbol (`responde_a`) filtrado por lo que el usuario puede ver; `referencia` = número del correo raíz (`hilo_id`); tipo fijo **Retroalimentación** (FB); `reenvio` (no cuenta como respuesta); `respondeEnLinea()` hace que los pasos de eventos compensables y las actualizaciones de alertas tempranas cuelguen del último correo del registro; la lista busca por referencia (`?q=`, `?hilo=`) | `public/js/modulos/correspondencia.js` (`vistaCorreo`), `registros.js` |
| `lib/cde.js` (v0.6.3) | `POST /valida-nombres` (rejilla de conformidad: norma de la carpeta con campos, etiquetas y máscaras; atributos relacionados; por archivo, partes y error de cada campo — usa `ISO.errorCampo`); `/subir` acepta `?revision=` y `x-meta.atributos` (parte designada, contrato, personalizados); `/mover` ajusta el estado a la zona de destino (WIP↔COMPARTIDO, →PUBLICADO) salvo revisión abierta; `/revisiones` admite lo que está en carpeta compartida aunque siga WIP. `PUT /atributos` (gestion.js) acepta además `revision` e `idoneidad` de la última versión. `servidor.js` anota en `datos/servidor.log` los fallos no capturados y sigue atendiendo | `public/js/modulos/conformidad.js` (`N.rejillaConformidad`), `archivos.js` (Cargar, Desplazar), `gestion.js` (visualizador de PDF) |
| `lib/documentos.js` (v0.6.2) | **Buscar - Registro de documentos** (Aconex): `GET /api/documentos/catalogos` (valores de las tablas DOCPG002 marcando los en uso), `POST /api/documentos/buscar` (texto libre en todos los campos, contenido del archivo vía `versiones.texto` —se extrae a demanda, tope 25 por consulta, pdf.js como segundo lector—, historial por versión, filtros, fechas, orden, paginación), búsquedas guardadas (tabla `busquedas_guardadas`), `GET /api/documentos/:pid/:cid` (ficha: propiedades, historial, paquetes, relacionados, enviados, descargado, eventos). Los campos salen de `camposDe()`: norma de la carpeta → norma por defecto del proyecto → `c.campos` | `public/js/modulos/documentos.js` |
| `lib/modelos.js` (v0.6.2) | `GET /:pid/:vid/props` (parámetros y valores para el código portado del visor), `POST /:pid/:vid/cantidades` (área/largo/volumen por elemento, lotes de 900), `GET /api/proyectos/:pid/planos-indice` (PDF del proyecto como «índice de planos») | `public/js/visor-puente.js`, `public/js/visor-origen/*` |
| `lib/nomenclatura.js` (v0.6) | Motor de **varias normas** de nomenclatura (`config.normas`, `normaPorDefecto`, `conformidad.areaRetencion / wipLibre`), norma por carpeta (`carpeta.norma`, `libre` corta la herencia; WIP sin norma), `valida()`, vista preliminar, duplicados; `sincronizaLegado` refleja la norma por defecto en `config.nomenclatura` (lo viejo sigue funcionando) | — |
| `lib/resumen.js` (v0.6) | **Resumen automático** de cada versión (`versiones.resumen`): extrae texto (PDF, docx/pptx/xlsx, txt/md/csv/json/ifc), lo resume por reglas o con la API de Claude (`IA_CLAVE`, `IA_MODELO`); cola en segundo plano tras `/subir`; `GET/POST /versiones/:vid/resumen` | — |
| `lib/forma.js` (v0.6) | Lo demás del video de Forma: normas CRUD y conformidad, **cambiar nombre**, **conjuntos** (tabla `conjuntos`), **puentes** (`config.puentes`, copia inicial + `sincroniza` al cargar), **informes de transmisión** (tabla `transmisiones`: crear, destinatarios, descarga ZIP), incidencias (suprimir/restaurar/editar/duplicar/posición, configuración), **página de revisión** (`GET/PUT /revisiones/:rid`, comentar, omitir-paso, volver-paso), desencadenadores. Usa `ctx.cdeInterno` que exporta `cde.js`; se monta después de `cde.js` compartiendo el mismo `ctx` | — |
| `lib/gestion.js` (v0.5.3) | Compartir (tabla `compartidos`: miembros → correo de Correspondencia; vínculo público `/compartido/:token` con caducidad; copia a otro proyecto), Elementos suprimidos (`contenedores.borrado` + `config.suprimidas` para carpetas con lote), marcas de revisión (tabla `marcas`: pagina/x/y, privadas hasta `publicada`), atributos personalizados (`config.atributos`, `contenedores.atributos`), Configuración de archivos (`PUT /archivos/configuracion`: atributos, nomenclatura/conformidad, etiqueta de revisión, paquetes, avanzada). Se monta antes que `cde.js` | — |
| `public/js/flujos-nucleo.js` | **copia literal** de la parte pura de `flujos-hospitalarios.js` del visor (red, Dijkstra, rutas, relaciones, bandas, contornos) | visor |
| `public/js/visor-ambientes.js` | Niveles / Ambientes (regla elementsInRoom del visor) y Flujos hospitalarios sobre la geometria .cdeg (cajas, huellas, rayo al cielo) | visor |
| `lib/zipflujo.js` | ZIP al vuelo (store, CRC-32 en streaming) para «Descargar archivos de origen» de una carpeta | propio |
| `lib/bcf.js` | exportacion BCF 2.1 (ZIP sin dependencias) | propio |
| `lib/conector-forma.js` | navegar Forma, vigilar carpetas (webhooks), bajar versiones nuevas al CDE | APIs sin costo de APS |
| `compartido-visor/` | **copias literales del visor**: `indice-modelos.js`, `extractor-modelos.js`, clasificadores generados desde `app.js` | visor (ver su LEEME) |
| `public/` | web (`index.html` + `js/nucleo.js` + `js/modulos/*`), visor (`visor.html` + `js/visor.js` escena/filtros/seccion/medir/incidencias + `js/visor-modulos.js` inventario/conjuntos e interferencias/comparar versiones/planos PDF; tema `css/visor.css`), Three.js, pdf.js, SheetJS y fuentes Cinzel/Cormorant/Inter en `vendor/` | visor (tema, modulos, logica pura de comparar-versiones.js, inventario) |
| `complemento-revit/` | complemento C# "Publicar al CDE" (extractor, cliente, pestana, switchback) | derivado de `VisorBimCambios` del visor |
| `pruebas/pruebas-arranque.js` | prueba de punta a punta (169 comprobaciones) | propio |
| `pruebas/semilla-visor.js` | servidor de prueba con un modelo de dos versiones (y dos PDF) para probar el visor a mano | propio |

## 2. Lo que se reutiliza del visor, y como

1. **Clasificadores** (`● Modelo / Categoria / Familia / Tipo / Nivel`, nombres de archivo, tipos genericos, huecos):
   `herramientas/actualiza-clasificadores.js` los extrae del `app.js` del visor con la propia `declaracion()` del visor y
   los deja en `compartido-visor/clasificadores-visor.js`. No se copian a mano ni se reescriben.
2. **Indice SQLite**: la clase `Indice` de `extractor-modelos.js` (tablas `attr`, `val`, `valh`, `eav`, `elem`, `meta`) y
   `trozoVisor()` reciben exactamente lo que sube `exporta-indice.js` del visor. El complemento de Revit produce ese
   mismo formato, asi que un modelo publicado desde Revit y el mismo modelo extraido desde el visor dan las mismas cifras.
3. **Consultas** (`tablero`, `parametros`, `llenado`, `valores`, `inventario`): `indice-modelos.js` del visor, sin cambios.
   El CDE añade dos consultas propias (`elementos`, `elemento/:e`) que solo LEEN la tabla `elem`/`eav`.
4. **Protocolo de subida** inicio → trozos → fin: el mismo del portal "Modelos DEO - Estudios", para que el dia que se
   quiera publicar al CDE desde el visor (modelos de Forma de contratos vigentes) baste con apuntar `exporta-indice.js`
   al servidor del CDE.
5. **Complemento de Revit**: cliente HTTP con llave, configuracion en `%AppData%`, compilacion por version de Revit y
   pruebas fuera de Revit, tal como `VisorBimCambios`.

## 2b. Carpetas, permisos, estados ISO 19650 y flujos (v0.3)
Modelo tomado de Autodesk Docs (ACC) y de Aconex, verificado contra su documentacion:
- **Carpetas** (`config.carpetas`): arbol editable desde la web (crear, renombrar, borrar, nota). Cada carpeta puede tener entradas de permiso por **organizacion, rol, usuario o todos** con los 6 niveles de ACC (`ver`, `ver-descargar`, `subir`, `ver-descargar-subir`, `ver-descargar-subir-editar`, `control`); si no tiene entradas propias **hereda** las del ancestro mas cercano. Gestor y administrador tienen control en todas. Plantilla "ACC": la estructura de la DEO para La Caleta (00_ADMIN_*, E2, E3 con WIP por organizacion, COMPARTIDO con REVISIONES PREVIAS y REVISIÓN DE PRESENTACIONES CONTRACTUALES → Presentacion 4.0 → subentregables E3.04.0.xx, PUBLICADO, ARCHIVADO).
- **Zona ISO 19650** por carpeta (`wip | compartido | publicado | archivo`, heredable): lo que se sube a zona `compartido` nace COMPARTIDO; al resto nace WIP. WIP→COMPARTIDO desde una carpeta de zona wip pide la carpeta compartida de destino y recuerda la de origen (si se devuelve, vuelve ahi). PUBLICADO: el flujo copia (misma version, sin duplicar archivo) a la carpeta que indique el flujo (`alAprobar.copiarA`), tipicamente E3.02_PUBLICADO. ARCHIVADO: copia a la carpeta de zona archivo de la misma etapa.
- **Flujos** (`config.flujos`, editables en Revisiones → Flujos de trabajo): nombre, descripcion, **iniciadores** (quien puede iniciar), **etapas en secuencia** y dentro de cada etapa **pasos en paralelo**; cada paso: revisores (organizacion / rol / usuario / todos), tipo `uno` (un revisor basta) / `todos` (cada miembro que encaja debe decidir) / `minimo N`, dias permitidos (fecha limite por etapa), y al aprobar el ultimo paso: estado (PUBLICADO o COMPARTIDO), codigo (A1, S4...), carpeta de copia y si el iniciador puede cambiarla. Etiquetas de decision configurables. "Devolver" en cualquier paso cierra la ronda (el contenedor vuelve a WIP); "anular" la cierra sin efecto. La ronda guarda la copia del flujo con la que empezo (`revisiones.flujo_def`), asi editar un flujo no altera lo que esta en curso. Son independientes del tipo de documento.
- **Correspondencia** (`lib/correspondencia.js`, tablas `correos`, `correo_lecturas`): como el Mail de Aconex: tipos definidos por el proyecto (`config.tiposCorreo`: nombre, prefijo, respuesta requerida por defecto, dias, organizaciones que lo emiten, campos propios, distribucion automatica, registro), numero `ORG-PREFIJO-000001` al enviar, Para/CC por organizacion o persona, fecha limite → estado `pendiente | vencido | respondido | cerrado | n/a`, hilo (responder), adjuntos (versiones, incidencias, correos, archivos), lecturas. Lo enviado no se edita.
- **Registros NEC4 ECC** (`alertas_tempranas`, `eventos_compensables`): un correo de tipo con `registro` abre la fila; la alerta (cl. 15) lleva asunto afectado, acciones, responsable, reunion y estado; el evento (cl. 60-66) avanza con acciones (aceptar / rechazar / cotizar / aceptar cotizacion / pedir revision / evaluar / implementar / retirar) que dejan el correo del tipo correspondiente y calculan los plazos: respuesta del Gerente 1 semana (61.4), cotizacion 3 semanas (62.3), respuesta a la cotizacion 2 semanas (62.3); monto y dias quedan en el registro.

## 2c. Incidencias (metadatos)
Codigo `INC-<proyecto>-0001`, tipo (observacion, interferencia, consulta, no-conformidad, cambio-de-diseno, mejora), prioridad, contractual, disciplina, etapa/paquete, nivel, ambiente/UPSS, impacto (plazo, costo, calidad, seguridad, alcance), origen (revision documentaria, coordinacion 3D, auditoria de modelo, reunion, obra), parte responsable, asignado, vencimiento, referencia, contenedor + version + elementos (UniqueId) + camara, historial con marcas de respondida/verificada/cerrada. Estados: abierta → en-analisis → respondida → verificada → cerrada | rechazada. Exporta a BCF 2.1 con Stage y Labels; desde la lista o la ficha, "Abrir en el modelo" abre el visor en la version, resalta los elementos y pone la camara; desde Revit, el complemento hace lo mismo por UniqueId.

## 3. Los dos caminos para que los modelos lleguen

**Camino 1 — Complemento (contratos nuevos, como Revizto).** El EIR/TDR exige publicar al CDE con el complemento: valida
el nombre, sube el RVT (o manifiesto si es modelo de nube), envia indice + geometria. Sin licencias de Forma para ANIN
ni Model Derivative. Ida y vuelta de incidencias por `UniqueId` (switchback) y BCF.

**Camino 2 — Forma (contratos vigentes).** El contratista sigue en Forma. `conector-forma.js` vigila carpetas con
webhooks (`dm.version.added`) y baja cada version nueva al CDE por la misma puerta que la web (`/subir`, con validacion).
Los parametros/geometria de esos modelos se obtienen abriendolos en el **Visor BIM** y publicando su indice al CDE (sin
traducciones nuevas, que es lo que Autodesk cobra). Pendiente: probar contra un hub real con la integracion agregada.

## 4. Decisiones que conviene cerrar con OTI y legal
- **Servidor**: una VM o contenedor de la entidad (Node 22, disco con respaldo diario de `datos/`). No Render.
- **Identidad**: `MODO_ACCESO=microsoft` con el registro de aplicacion en Entra (el mismo tramite ya iniciado para
  OneDrive); mientras tanto `autodesk` (los contratistas ya tienen cuenta). `local` solo para pruebas.
- **Archivos**: disco local hoy; adaptador SharePoint (Graph) cuando OTI lo apruebe (versiones, retencion, auditoria
  propias de M365). La interfaz de `lib/almacen.js` esta pensada para eso.
- **Propiedad**: codigo y datos de ANIN; el visor sigue siendo de Erick y el CDE lo consume por su API, no al reves.
- **Instalador** del complemento firmado por ANIN y exigido en el EIR de los contratos nuevos.

## 5. Hoja de ruta
1. Compilar el complemento en una PC con Revit y publicar un modelo real de La Caleta → comparar cifras con el visor.
2. Pantalla de transmittals (envio formal de un conjunto de contenedores) y notificaciones por correo (nodemailer, como el visor).
3. Complemento de Navisworks (mismo paquete desde el federado NWD/NWF).
4. Conector Forma probado con el hub de ANIN; publicacion desde el visor al CDE.
5. IFC en el servidor (web-ifc / That Open) para Tekla, ArchiCAD y Civil 3D.
6. Acceso Microsoft Entra y almacen SharePoint.
