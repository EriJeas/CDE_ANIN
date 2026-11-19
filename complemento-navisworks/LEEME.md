# Complemento de Navisworks "Publicar al CDE" (CDE ANIN)

Hace con los modelos de Navisworks lo mismo que el complemento de Revit: desde el modelo abierto (**NWD, NWF o NWC**, con
todos sus archivos anexados) sube el archivo al CDE como version del contenedor y envia el **indice de propiedades** y la
**geometria** para verlo en el visor del CDE, sin licencia de Autodesk para quien lo revisa.

**Requisito:** Navisworks **Manage** o **Simulate** 2024, 2025, 2026 o 2027. Navisworks **Freedom no carga complementos**
(limitacion de Autodesk): el complemento lo usa quien ya tiene Navisworks, normalmente el contratista que arma el federado.

## Botones (pestana "Complementos" de Navisworks)
| Boton | Que hace |
|---|---|
| **Publicar al CDE** | Elige proyecto y nombre (se valida contra el CDE mientras escribes) → sube el NWD / NWC tal cual (un NWF, que solo trae vinculos, se sube **empaquetado como NWD**) → extrae y envia indice + geometria. Al final muestra archivos de origen, elementos, propiedades, triangulos y tiempo. |
| **Configurar CDE** | Abre `%AppData%\CdeAnin\complemento.json`: el **mismo archivo y la misma llave** que el complemento de Revit. |

Si Navisworks esta en otra PC de la oficina, en `servidor` va la direccion de la PC del CDE en la red (p. ej.
`http://192.168.1.20:8090`; se acepta http sin cifrar solo para direcciones de la red local) y el puerto debe estar abierto
en el firewall de esa PC (lo configura soporte de ANIN).

## Compilar e instalar
1. En la PC con Navisworks Manage o Simulate, con el SDK de .NET (el mismo que compila el complemento de Revit).
2. Cierra Navisworks y ejecuta `5-compila-navisworks.bat` (Navisworks 2026 en `C:\Program Files\Autodesk\Navisworks Manage 2026`).
   Otra version u otra carpeta: `5-compila-navisworks.bat 2027 "H:\Autodesk\Navisworks Manage 2027"`.
   El resultado queda en `compila-navisworks.txt`.
3. La compilacion lo instala en `%AppData%\Autodesk\ApplicationPlugins\CdeAnin.Navis.bundle\` (una DLL por version en
   `Contents\<version>\`; Navisworks carga la suya). Abre Navisworks: los botones aparecen en **Complementos**.

## Que extrae (src/ExtractorNavis.cs)
- **Elemento** = el "primer objeto" de cada geometria (lo que Navisworks selecciona con la resolucion *Primer objeto*: en un
  NWC de Revit, el muro, la puerta...).
- `● Modelo` = el archivo de origen (cada NWC anexado), `● Categoria`, `● Familia`, `● Tipo`, `● Nivel` de las propiedades
  de Revit / IFC (en espanol o en ingles); si no las hay, de la clase y la capa de Navisworks.
- Todas las propiedades como `"Pestana / Propiedad"` con el valor como lo muestra Navisworks, mas `Identidad / ElementId`
  (Id. de elemento de Revit) y `Identidad / GUID`.
- Geometria con la API COM (fragmentos → triangulos en el mundo), en metros, formato 2 de `docs/FORMATO-PAQUETE.md`: el color
  y la transparencia de **cada geometria**, el vidrio al final de cada elemento (el visor lo dibuja translucido) y, si el
  modelo esta georreferenciado (UTM), acercado al origen sin perder precision.
- Limites: el color es el de cada nodo de geometria (en un NWC de Revit hay un nodo por material, asi que ventanas y puertas
  salen con marco y vidrio); las texturas no viajan (la API de Navisworks no las entrega).

## Estado y pruebas
- **Compilado y probado en Navisworks Manage 2027** (pestana *Complementos de la herramienta 1*).
- IFC de Sechura abierto en Navisworks (988 elementos, 592.000 triangulos): publicado en 19 s; en el visor se ve igual que el
  IFC leido por el CDE y que el RVT publicado desde Revit (colores, vidrio, divisiones, punteadas, propiedades).
- Federado grande (NWD de 612 MB del proyecto 100017: 18 modelos, mas de 2,4 millones de nodos, unos 400.000 elementos y mas
  de 350 millones de triangulos). Lo que tardaba no eran los triangulos sino **recorrer el arbol**: cada nodo que se toca de la
  API de Navisworks es un objeto con memoria nativa; si no se suelta en el momento (Dispose), se acumulan cientos de miles y la
  recoleccion de memoria de .NET llega a costar milisegundos por nodo. Pedir los hijos (Children) o el padre (Parent) de cada
  nodo empeora todo. Como se publica ahora:
  1. **Propiedades**, en una sola pasada por el arbol (`DescendantsAndSelf`): al llegar a un elemento se leen sus propiedades y lo
     de abajo se salta de una vez; cada nodo se suelta al terminar y no se guarda ninguno (se anota su posicion en el recorrido). No se leen la apariencia de los materiales (decenas de valores por elemento: colores,
     texturas) ni los datos del archivo (iguales en todos). Los numeros se escriben en m, m², m³ y grados.
  2. **Geometria**, primero lo que da forma al edificio (muros, losas, techos, columnas, vigas, escaleras), luego puertas y
     ventanas, equipos y mobiliario, tuberias y ductos, y al final accesorios y piezas chicas; una geometria repetida en muchas
     instancias se le pide a Navisworks una sola vez.
  3. **Sin limite de tiempo por defecto** (`medio` y `alto`): todos los elementos con su forma. Una caja en lugar de un
     accesorio es un falso positivo seguro al buscar interferencias. Con `minutos` en `complemento.json` (12 por defecto en
     `bajo`) se pone un tope: lo que no alcanza va como la caja del elemento, salvo lo voluminoso (las dos medidas mayores de
     su caja pasan de 1 m: una torre, un equipo grande), que se lee igual (hasta 3 min de mas).
  4. **Acero de refuerzo** (barras, mallas, acopladores) solo con propiedades: son millones de barras redondas. `"acero":
     "incluir"` en `complemento.json` para dibujarlo.
  Resultado con el federado 100017 en Navisworks Manage 2027: publicado completo (P15) en **26 min 43 s**: propiedades de los
  418.092 elementos en 7 min, geometria de los 384.061 restantes (todos con su forma, ninguno como caja; 56.000 instancias
  reutilizadas), 160 millones de triangulos leidos y 3,99 millones publicados tras el aligerado (2 min 30 s). En otra corrida
  (P14, sin el colapso de aristas) las propiedades tardaron 4 min 35 s y el total 18 min 22 s: el tiempo depende de lo que
  tarde Navisworks en entregar los datos.
  Con la v0.9.15 en `medio` (P20): **33 min 14 s**, todo con su forma (ninguna caja), rejilla de 2 mm, 160 millones de
  triangulos leidos → 11,3 millones publicados con 1 cm de diferencia maxima (el aligerado corrio mientras se leia; la pasada
  final tardo 20 s y las aristas 46 s), 4 millones de segmentos de lineas (arboles, escudo) y 10,6 millones de aristas
  precalculadas. El visor lo abre en unos 12 a 24 s con las aristas puestas (unos 1,9 GB de memoria en el navegador).
  La barra de avance de Navisworks tiene **Cancelar** y el registro (`%AppData%\CdeAnin\registro.txt`) anota cada 10 s cuanto
  va y en que se fue el tiempo (propiedades, arbol, triangulos de Navisworks).
  Al empezar anota tambien la vista actual de Navisworks (posicion en metros y rotacion de la camara), para poner la misma
  camara en el visor del CDE y comparar.
- Aligerado de la geometria, segun `detalle` en `complemento.json` (`bajo`, `medio` por defecto, `alto`):

  | | bajo | medio | alto |
  |---|---|---|---|
  | **Diferencia maxima con Navisworks** (lo que el aligerado puede mover la superficie) | 5 cm | **1 cm** | 5 mm |
  | Rejilla comun al leer (vertices mas cercanos se juntan; lo menor desaparece) | 1/8.000 del modelo, hasta 12 mm | 1/20.000 del modelo, hasta 2 mm | sin rejilla |
  | Piezas menores que dos celdas (tornillos, arandelas) | no se leen | no se leen (menos de 4 mm) | se leen |
  | Tope por elemento (si con la diferencia maxima no se llega, se deja asi) | 6.000 | 20.000 | 40.000 |
  | Tope de todo el modelo (al final, en los elementos de mas de 24 triangulos) | 2 millones | 4 millones (sin pasar de 1 cm) | 10 millones (sin pasar de 5 mm) |
  | Tiempo maximo | 12 min | sin limite | sin limite |
  | Normales | de la cara | de la cara | de Navisworks |

  **Para interferencias en el CDE con un modelo publicado en `medio`, usar una tolerancia de 1 cm o mas** (la diferencia
  maxima del aligerado). Para el resultado exacto de Navisworks, el modulo Conjuntos e interferencias del visor lee el XML de
  Clash Detective.

  Todo el aligerado es por **colapso de aristas con error cuadratico (QEM) y con tolerancia**: se quitan primero las aristas
  cuyo colapso casi no cambia la forma y nunca se mueve la superficie mas que la tolerancia. Asi un tubo delgado pierde lados
  pero no desaparece, una losa con muchos triangulos queda en pocos, y las letras, los perfiles de ventana y los mastiles
  conservan su forma; los bordes, los cambios de color y las aristas vivas (mas de 40 grados) se protegen.
  - Un elemento que pasa su tope (arboles, equipos de fabricante): colapso hasta la diferencia maxima; si aun queda por
    encima, se deja asi (la forma manda). Solo en `bajo` se sigue a 10 cm y, si hace falta, agrupado por rejilla.
  - Todo el modelo, si pasa el tope en mas de un 25 %: una pasada mas sin pasar la diferencia maxima (en `bajo`, 1; 2,5 y
    5 cm). Si aun se pasa, se deja asi: mejor mas triangulos que letras, perfiles y vidrios deformados. Si las pasadas ya
    llevan 6 min no se empieza otra.
  - La rejilla al leer es fina a proposito: una rejilla de 1,3 cm (la de antes en el federado) rompia los letreros, las
    ventanas, el mastil y las hojas de los arboles; con 5 mm aun faltaba la "I" de MINSA.
  - El **vidrio va con su color de Navisworks** (antes el vidrio claro se pintaba azul oscuro y las ventanas se veian negras).
  - Los **vidrios, placas y letreros de dos caras** (la cara de atras con los mismos vertices, como los exporta Revit) tienen
    su borde protegido: antes el colapso de aristas los veia "cerrados" y podia quitar medio vidrio sin error (las ventanas
    "rotas" en triangulos y letras del logo que faltaban).
  - El aligerado se hace **en otros hilos mientras Navisworks sigue entregando triangulos** (se dejan dos nucleos para
    Navisworks y Windows): en un modelo de mas de 40.000 elementos cada uno se aligera con 1 cm al cerrarlo, asi que al
    final casi no queda trabajo (antes era una pasada de 6 min despues de leer todo). Las pasadas finales, si hacen falta,
    usan todos los nucleos.
- **Dibujos en lineas**: los arboles y arbustos "CAD 3D" de las familias de Revit y los escudos o dibujos importados llegan a
  Navisworks como miles de lineas, sin ningun triangulo, y no aparecian en el CDE. Ahora las lineas se leen en todas las
  categorias salvo ejes, lineas de centro, lineas de modelo y del modelo analitico, y viajan en un bloque aparte del `.cdeg`
  (`docs/FORMATO-PAQUETE.md`); el visor las dibuja y siguen los filtros y ocultos. En la vegetacion se le pide a Navisworks
  el color de cada linea. Tope de segmentos por elemento: 1.500 / 20.000 / 40.000 (bajo / medio / alto); si se pasa, se
  juntan los extremos cercanos y la silueta se conserva.
- **Aristas precalculadas**: el complemento calcula las aristas de cada elemento (bordes y aristas de mas de 28 grados, como
  las dibuja el visor) en todos los nucleos y las manda en el `.cdeg`: **el visor abre el modelo con las aristas puestas**,
  sin calcular nada, por grande que sea (antes solo con 4 millones de triangulos o menos, y calcularlas tardaba).
- En el visor, el vidrio va con 75 % de transparencia (la del vidrio de Revit y Navisworks) y las aristas se aclaran con la
  distancia (enteras hasta 8 m, 15 % a 45 m): de lejos una fachada con muchas ventanas ya no se ve negra por la suma de lineas.
- La geometria viaja comprimida (gzip) del servidor al navegador. Al terminar, el mensaje dice cuantos triangulos se leyeron
  y cuantos viajaron.
- El historial del CDE anota la publicacion con origen **complemento-navisworks** (antes salia complemento-revit).
- `src/Paquete.cs` (indice, geometria y simplificacion) y la publicacion con `ClienteCde.cs` tambien se prueban **sin
  Navisworks**: `node pruebas/prueba-navis-paquete.js` (necesita mono).

## Lo que sigue
- Incidencias desde Navisworks (como el boton del complemento de Revit): crear desde la seleccion y abrir una del CDE
  seleccionando el elemento y poniendo la camara.
