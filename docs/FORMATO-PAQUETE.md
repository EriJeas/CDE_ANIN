# Paquete de modelo del CDE (lo que produce el complemento y lee el visor liviano)

Un modelo publicado al CDE viaja en **dos partes**, por el mismo protocolo que el visor usa con su portal
(`inicio → trozos → fin`, ver `lib/modelos.js`):

## 1. Indice de parametros (trozos JSON, gzip)

**Formato identico al de `public/js/exporta-indice.js` del Visor BIM** (asi las cifras del CDE son las del visor y el
servidor arma el SQLite con la clase `Indice` del visor sin cambios):

```jsonc
// primer(os) trozo(s): los elementos con su clasificacion
{ "elem": [ [e, "nombre", "modelo (archivo)", "categoria", "familia", "tipo", "nivel", clase], ... ] }
// clase: 1 = elemento, 2 = parte/geometria de un elemento (hereda la clasificacion), 0 = contenedor

// siguientes: parametros, valores y pares (parametro, valor) -> elementos
{ "attrs": [ [a, "Grupo / Nombre"], ... ],            // ids de parametro (enteros, unicos en todo el paquete)
  "vals":  [ [v, "texto del valor"], ... ],           // ids de valor (enteros, unicos en todo el paquete)
  "eavd":  [ [a, v, e1, e2-e1, e3-e2, ...], ... ] }   // por cada (parametro, valor): sus elementos ORDENADOS y en diferencias
```

Los parametros canonicos del visor deben venir con su nombre exacto (prefijo `● `):
`● Modelo`, `● Categoria`, `● Familia`, `● Tipo`, `● Nivel`. Los demas van como `"Grupo / Nombre"`
(p. ej. `"Cotas / Volumen"`, `"Datos de identidad / Marca"`, `"Tipo / Descripcion"`). Los numeros se escriben con su unidad
tal como los muestra Revit al usuario (`"3.50 m³"`), igual que el visor.

Tamano recomendado por trozo: 50.000 elementos o 1.000.000 de pares (como el visor).

## 2. Geometria liviana: `geometria.cdeg` (binario, little-endian)

```
offset  tipo        contenido
0       char[4]     "CDEG"
4       u32         version del formato = 1
8       u32         nElem    (elementos con geometria)
12      u32         nVert    (vertices totales)
16      u32         nIdx     (indices totales = triangulos x 3)
20      f32[3]      origen: desplazamiento (m) del punto base del proyecto respecto del origen interno (para federar)
32      u32         L = longitud en bytes del JSON de metadatos
36      bytes[L]    JSON UTF-8: { "modelo", "unidades": "m", "ejeArriba": "Z", "herramienta", "revit": { "version", "archivo" }, "fecha" }
36+L    relleno     hasta multiplo de 4
        nElem x 24  tabla de elementos: e u32 (el MISMO id que en el indice), vertOff u32, vertCount u32, idxOff u32, idxCount u32, rgba u8[4]
        f32[nVert*3] posiciones en METROS, ejes de Revit (X este, Y norte, Z arriba); el visor web las pasa a Y arriba
        u32[nIdx]    indices de triangulos, RELATIVOS al vertOff de su elemento
```

**Formato 2** (lo escriben los lectores IFC / RVT del CDE y, desde v0.9.12, los complementos de Revit y de Navisworks; el visor lee 1 y 2): la cabecera dice `version = 2` y, despues de
los indices, vienen dos bloques mas:

```
        u32[nElem]   icTr: cuantos indices del FINAL de cada elemento son vidrio (marco opaco + vidrio translucido); 0 = ninguno
        u8[nVert*3]  color RGB por vertice (un elemento con varios materiales), relleno hasta multiplo de 4
```

**Lineas (opcional, desde v0.9.15)**: el complemento de Navisworks agrega al final los dibujos en lineas (los arboles "CAD 3D"
de las familias de Revit y los escudos importados llegan a Navisworks como miles de lineas y ningun triangulo). Un lector que no
conoce el bloque lo ignora (va despues de todo lo anterior):

```
        char[4]      "LINS"
        u32          nFilas, u32 nSeg
        nFilas x 16  por elemento: e u32 (el mismo id del indice), primer segmento u32, cuantos u32, rgba u8[4]
        f32[nSeg*6]  extremos de cada segmento en METROS, ejes de Revit, ya sin el origen (igual que las posiciones)
        u8[nSeg*3]   color RGB de cada segmento, relleno hasta multiplo de 4
```

**Aristas precalculadas (opcional, desde v0.9.15)**: el complemento de Navisworks calcula las aristas de cada elemento como
las dibuja el visor (bordes abiertos y aristas entre caras de mas de 28 grados) y las agrega despues de las lineas; el visor
las muestra al abrir el modelo sin calcular nada:

```
        char[4]      "ARIS"
        u32          nPares
        nElem x 8    por elemento, en el orden de la tabla: primer par u32, cuantos pares u32
        u32[nPares*2] pares de vertices, relativos al vertOff de su elemento
```

Si el modelo esta georreferenciado lejos del origen (coordenadas compartidas UTM, mas de 20 km), el complemento y el lector
IFC restan el desplazamiento antes de escribir las posiciones en float32 (a 9.000 km el paso de un float32 es de 1 m) y lo
guardan en `origen` (cabecera, float32) y exacto en el JSON de metadatos (`"origen": [x, y, z]`).

Decisiones: metros y ejes de Revit (lo que ya usan el visor y las incidencias); color por elemento (el del material
principal, como las miniaturas del visor), sin texturas; sin normales (el visor las calcula). Un federado de 3 millones
de objetos cabe: la tabla pesa 24 bytes por elemento y los vertices lo que pese la malla.

## 3. Incidencias

Las incidencias del CDE guardan `elementos: [{ modelo, uid, ifcGuid, e }]` y `camara: { pos, dir, up, fov }` en metros,
ejes de Revit. Se exportan a **BCF 2.1** (`/api/proyectos/:pid/incidencias.bcfzip`) y asi llegan a Revit, Navisworks,
Solibri, BIMcollab y Autodesk Forma. El `uid` es el `UniqueId` de Revit: con el, el complemento hace el "switchback"
(abrir en Revit el elemento de la incidencia).
