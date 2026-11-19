# CDE ANIN en Render

El CDE corre en Render como un servicio web con un disco persistente. No depende de Autodesk: cada persona entra con su
correo y su propia clave (`MODO_ACCESO=cuentas`). Los conectores de Autodesk Forma, Aconex, OneDrive y SharePoint quedan
apagados mientras no se les pongan credenciales.

## 1. Subir el proyecto a GitHub

Crea un repositorio **privado** y sube el contenido del ZIP completo. No se suben `node_modules`, `datos`, `.env` ni
`cde.env` (ya están en `.gitignore`).

## 2. Crear el servicio

En Render: **New → Blueprint**, elige el repositorio. Render lee `render.yaml` y crea el servicio `cde-anin` con su disco
`cde-datos` montado en `/var/data`. Al crearlo pide dos valores:

| Variable | Qué poner |
|---|---|
| `ADMIN_EMAILS` | Correo del administrador del CDE (varios, separados por coma) |
| `ADMIN_CLAVE_INICIAL` | Una clave larga para el primer ingreso del administrador |

`SESSION_SECRET` la genera Render. No la cambies después: con ella se cifran las sesiones.

## 3. Primer ingreso

1. Abre la dirección del servicio y entra con el correo de `ADMIN_EMAILS` y la `ADMIN_CLAVE_INICIAL`.
2. El CDE obliga a poner una clave propia.
3. Borra `ADMIN_CLAVE_INICIAL` de las variables del servicio en Render.

## 4. Dar acceso al equipo

Menú del usuario (arriba a la derecha) → **Cuentas de acceso** → escribe el correo y el nombre → **Crear cuenta**. El CDE
muestra una clave temporal una sola vez; al entrar, la persona la cambia por la suya. Luego asígnale su rol en cada
proyecto desde **Usuarios de proyecto**. Desde la misma ventana se restablece una clave olvidada o se quita una cuenta.

Cinco intentos fallidos seguidos bloquean la cuenta quince minutos.

## 5. Datos y respaldo

Todo lo que se carga vive en el disco `/var/data` (`cde.sqlite` y la carpeta `archivos`). Un despliegue nuevo no lo toca.
Render guarda instantáneas diarias del disco; conviene además descargar un respaldo periódico. Si el disco se queda corto,
se amplía desde el panel (no se puede reducir).

## 6. Traer los datos de una PC

Detén el CDE de la PC, comprime su carpeta `datos` y súbela al disco desde la consola del servicio (Shell) o con `scp`,
de modo que `cde.sqlite` y `archivos` queden directamente en `/var/data`. Reinicia el servicio.

## Variables opcionales

`SESION_HORAS` (duración de la sesión, 10 por defecto) · `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (OneDrive y
SharePoint) · `ACONEX_*` (Aconex) · `APS_CLIENT_ID`, `APS_CLIENT_SECRET` (Autodesk Forma; sin ellas el conector no se usa).
