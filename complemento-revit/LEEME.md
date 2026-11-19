# Complemento de Revit "Publicar al CDE" (CDE ANIN)

Lleva el modelo abierto en Revit al CDE institucional, como hace el complemento de Revizto, pero hacia **nuestro**
entorno: valida la nomenclatura ISO 19650 antes de publicar, sube el archivo como version del contenedor y envia el
**indice de parametros** (en el formato del Visor BIM: las cifras del CDE son las del visor) y la **geometria liviana**
para verlo en el navegador sin licencia de Autodesk. Tambien hace el "switchback": desde una incidencia del CDE abre en
Revit el elemento y la camara, y crea incidencias desde la seleccion.

Deriva del complemento `VisorBimCambios` del Visor BIM (misma compilacion, misma conversacion por llave, mismas pruebas
fuera de Revit). Estado: **compilado y probado en Revit 2024 (tambien en modo Visor)**: publica el RVT, el indice y la
geometria, y el modelo se ve en el visor del CDE con los colores de Revit, el vidrio translucido y las aristas.

## Botones (pestana "CDE ANIN")
| Boton | Que hace |
|---|---|
| **Publicar al CDE** | Elige proyecto y nombre (se valida contra el CDE mientras escribes) → sube el RVT (o un manifiesto `.cde` si el modelo es de nube) → extrae y envia indice + geometria. Al final muestra elementos, parametros, valores, triangulos y tiempo. |
| **Incidencias del CDE** | Lista las abiertas del proyecto; "Abrir en Revit" selecciona el elemento (por UniqueId) y orienta la vista 3D con la camara guardada. "Crear desde la seleccion" manda al CDE una incidencia con los elementos seleccionados y la camara actual. |
| **Configurar** | Abre `%AppData%\CdeAnin\complemento.json`: `servidor` (https://...), `llave` (la crea el administrador del proyecto en la web del CDE → Ajustes → Llaves) y `detalle` de la geometria (`bajo` / `medio` / `alto`). |

## Compilar e instalar
1. Windows con Visual Studio 2022 (o el SDK de .NET) y Revit instalado.
2. En esta carpeta: `dotnet build -c Release -p:RevitVersion=2024` (2025 y 2026 compilan para .NET 8; Revit 2026.5 o posterior usa .NET 10: `-p:RevitTfm=net10.0-windows`, lo hace solo `3-compila-revit.bat`; 2023 y
   anteriores para .NET Framework 4.8). La compilacion copia `CdeAnin.addin` y `CdeAnin\CdeAnin.dll` a
   `%AppData%\Autodesk\Revit\Addins\<version>\`.
3. Abre Revit y acepta cargar el complemento.
4. Para distribuirlo a los contratistas: un instalador firmado por ANIN (MSI o el `.bundle` de Autodesk) que deje la
   DLL en `%ProgramData%\Autodesk\Revit\Addins\<version>\` para todos los usuarios de la PC.

## Que extrae (Extractor.cs)
- Elementos de categoria **Modelo** (no anotaciones ni vistas), con `● Modelo`, `● Categoria`, `● Familia`, `● Tipo`,
  `● Nivel` como los reconoce el visor; nombre "Tipo [id]" como los nombra la traduccion de Autodesk.
- Todos los parametros de **ejemplar** y de **tipo** como `"Grupo / Nombre"` con el valor que muestra Revit (unidades
  incluidas), mas `Identidad / UniqueId`, `Identidad / ElementId` e `Identidad / IfcGUID`.
- Geometria (formato 2): solidos y mallas (instancias anidadas incluidas), triangulados, en **metros** y **coordenadas
  compartidas**, con el color de sombreado del material de **cada cara** (sin material: el de la subcategoria o la categoria,
  como una vista sombreada de Revit). Las caras de materiales transparentes van al final de cada elemento y el visor las
  dibuja como vidrio. Si el modelo esta georreferenciado (UTM), se acerca al origen y el desplazamiento va en el paquete.
- Para compilar de nuevo hay que **cerrar Revit** (tiene la DLL abierta): `3-compila-revit.bat` y volver a abrir Revit.
- Formato exacto en `docs/FORMATO-PAQUETE.md`.

## Pruebas fuera de Revit
`pruebas/` reutiliza la idea del visor: un imitador de la API de Revit (RevitStub.cs) para probar Extractor y
ClienteCde sin abrir Revit. Pendiente de completar junto con la primera compilacion.

## Lo que sigue
- **Navisworks**: mismo paquete desde un NWD/NWF federado (API COM/.NET de Navisworks: `ModelItem` → propiedades y
  `ComApi` para la geometria). Reutiliza ClienteCde y el formato; cambia solo el recorrido.
- **Civil 3D / IFC**: IFC se sube directo al CDE y se indexa en el servidor (web-ifc / That Open); Civil 3D exporta IFC o
  LandXML.
- **Design Automation** (Revit en la nube, sin pantalla): el mismo Extractor con `IExternalDBApplication`, como ya esta
  planteado en el visor; cobra por minuto de motor, por eso el camino principal es el complemento.
