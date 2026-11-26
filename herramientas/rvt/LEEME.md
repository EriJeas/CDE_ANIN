# Lector RVT libre (rvt-rs)

`rvt-ifc.exe` es el exportador a IFC de **rvt-rs v0.19.0** (licencia Apache-2.0, ver `LICENSE` y `NOTICE`), copiado sin
cambios de su publicación oficial (`rvt-rs-v0.19.0-x86_64-pc-windows-msvc.zip`). Lee archivos de Revit sin Revit ni
ningún componente de Autodesk.

El CDE lo usa en `lib/lector-rvt.js`: RVT → IFC → lector IFC del CDE → visor. Lo que recupera depende de la versión de
Revit del archivo (su matriz de soporte): la vía completa, con geometría exacta y todos los parámetros, es el
complemento de Revit del CDE.

- Otra ubicación del ejecutable: variable `RVT_IFC` en `cde.env`.
- En Linux x64 (servidor): `linux/rvt/` es el mismo lector para Python (**rvt 0.25.0**, rueda oficial `manylinux2014_x86_64`, sin cambios; misma licencia). El CDE lo usa solo: basta con que el servidor tenga Python 3.8 o superior.
- En macOS u otra plataforma: `pip install rvt` o el binario de esa plataforma aquí como `rvt-ifc`.
