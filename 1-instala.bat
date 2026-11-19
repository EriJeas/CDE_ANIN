@echo off
rem Prepara el CDE ANIN en esta PC. Uso: doble clic en 1-instala.bat (no necesita permisos de administrador).
rem   1) Node.js 22.13 o posterior: usa el de la PC; si no hay, deja uno portatil en .\node (de nodejs.org, con la suma SHA-256 verificada).
rem   2) Dependencias (node_modules) y configuracion (.env) si faltan.
rem   3) Complementos: compila e instala el de Revit y el de Navisworks para cada version instalada (cierra Revit y Navisworks antes).
rem   El resultado queda en instala.txt. Despues: 2-inicia.bat abre el CDE en http://localhost:8090
setlocal EnableExtensions
cd /d "%~dp0"
set "RAIZ=%~dp0"
set "LOG=%RAIZ%instala.txt"
echo === Instalacion del CDE ANIN en %COMPUTERNAME% - %date% %time% === > "%LOG%"

echo [1/4] Node.js >> "%LOG%"
if exist "%RAIZ%node\node.exe" set "PATH=%RAIZ%node;%PATH%"
call :versionNode
if defined NODEOK goto :dependencias
call :descargaNode
if exist "%RAIZ%node\node.exe" set "PATH=%RAIZ%node;%PATH%"
call :versionNode
if not defined NODEOK (
  echo ERROR: no hay Node.js 22.13 o posterior. Instala la version LTS de https://nodejs.org y vuelve a ejecutar 1-instala.bat >> "%LOG%"
  goto :fin
)

:dependencias
echo [2/4] Dependencias y configuracion >> "%LOG%"
if exist "%RAIZ%node_modules\express\package.json" (
  echo Dependencias: ya instaladas >> "%LOG%"
) else (
  call npm install --omit=dev --no-audit --no-fund >> "%LOG%" 2>&1
)
if exist "%RAIZ%.env" (
  echo Configuracion: .env ya existe, no se toca >> "%LOG%"
) else (
  call :creaEnv
)
call :creaConfigComplemento

echo [3/4] Complemento de Revit >> "%LOG%"
tasklist /fi "imagename eq Revit.exe" 2>nul | find /i "Revit.exe" >nul && (
  echo OMITIDO: Revit esta abierto. Cierralo y ejecuta 3-compila-revit.bat >> "%LOG%"
) || (
  call "%RAIZ%3-compila-revit.bat"
  type "%RAIZ%compila-revit.txt" >> "%LOG%"
)

echo [4/4] Complemento de Navisworks >> "%LOG%"
tasklist /fi "imagename eq Roamer.exe" 2>nul | find /i "Roamer.exe" >nul && (
  echo OMITIDO: Navisworks esta abierto. Cierralo y ejecuta 5-compila-navisworks.bat >> "%LOG%"
  goto :resumen
)
for %%v in (2024 2025 2026 2027) do (
  if exist "C:\Program Files\Autodesk\Navisworks Manage %%v\Autodesk.Navisworks.Api.dll" (
    call "%RAIZ%5-compila-navisworks.bat" %%v
    type "%RAIZ%compila-navisworks.txt" >> "%LOG%"
  ) else if exist "C:\Program Files\Autodesk\Navisworks Simulate %%v\Autodesk.Navisworks.Api.dll" (
    call "%RAIZ%5-compila-navisworks.bat" %%v
    type "%RAIZ%compila-navisworks.txt" >> "%LOG%"
  )
)

:resumen
echo === Instalado === >> "%LOG%"
dir /b /s "%APPDATA%\Autodesk\Revit\Addins\*CdeAnin*" >> "%LOG%" 2>nul
dir /b /s "%APPDATA%\Autodesk\ApplicationPlugins\CdeAnin.Navis.bundle\Contents\*.dll" >> "%LOG%" 2>nul

:fin
echo === FIN %date% %time% === >> "%LOG%"
endlocal
exit /b 0

:versionNode
set "NODEOK="
where node >nul 2>&1 || exit /b 0
for /f "delims=" %%n in ('where node') do echo Node.js: %%n >> "%LOG%"
node -p "process.version" >> "%LOG%" 2>&1
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]==22&&v[1]>=13)?0:1)" && set "NODEOK=1"
exit /b 0

:descargaNode
echo No hay Node.js 22.13 o posterior: se descarga la version LTS 24 de nodejs.org en .\node >> "%LOG%"
set "BASE=https://nodejs.org/dist/latest-v24.x"
set "NODESHA="
set "NODEZIP="
curl.exe -fsSL -o "%TEMP%\cde-node-sumas.txt" "%BASE%/SHASUMS256.txt" >> "%LOG%" 2>&1
if errorlevel 1 ( echo ERROR: sin acceso a nodejs.org >> "%LOG%" & exit /b 1 )
for /f "tokens=1,2" %%a in ('findstr /c:"-win-x64.zip" "%TEMP%\cde-node-sumas.txt"') do (
  set "NODESHA=%%a"
  set "NODEZIP=%%b"
)
if not defined NODEZIP ( echo ERROR: no se encontro el ZIP de Windows en SHASUMS256.txt >> "%LOG%" & exit /b 1 )
echo Descargando %NODEZIP% >> "%LOG%"
curl.exe -fsSL -o "%TEMP%\%NODEZIP%" "%BASE%/%NODEZIP%" >> "%LOG%" 2>&1
if errorlevel 1 ( echo ERROR: no se pudo descargar %NODEZIP% >> "%LOG%" & exit /b 1 )
set "SUMA="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%TEMP%\%NODEZIP%" SHA256') do if not defined SUMA set "SUMA=%%h"
set "SUMA=%SUMA: =%"
if /i not "%SUMA%"=="%NODESHA%" (
  echo ERROR: la suma SHA-256 del ZIP no coincide con la de nodejs.org; no se instala >> "%LOG%"
  del "%TEMP%\%NODEZIP%"
  exit /b 1
)
echo Suma SHA-256 verificada: %SUMA% >> "%LOG%"
tar -xf "%TEMP%\%NODEZIP%" -C "%RAIZ%." >> "%LOG%" 2>&1
ren "%RAIZ%%NODEZIP:.zip=%" node >> "%LOG%" 2>&1
del "%TEMP%\%NODEZIP%"
exit /b 0

:creaEnv
set "ADMINS="
for /f "tokens=1* delims==" %%a in ('findstr /b /c:"ADMIN_EMAILS=" "%RAIZ%.env.example"') do for /f "tokens=1" %%c in ("%%b") do set "ADMINS=%%c"
set "SECRETO="
for /f "delims=" %%s in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')"') do set "SECRETO=%%s"
if not defined SECRETO set "SECRETO=%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
(
  echo PORT=8090
  echo NOMBRE_CDE=CDE ANIN - DEO
  echo DATOS_DIR=./datos
  echo SESSION_SECRET=%SECRETO%
  echo SESION_HORAS=10
  echo ADMIN_EMAILS=%ADMINS%
  echo MODO_ACCESO=local
  echo ACCESO_CLAVE=prueba
) > "%RAIZ%.env"
echo Configuracion: .env creado (acceso local; la clave esta en ACCESO_CLAVE) >> "%LOG%"
exit /b 0

:creaConfigComplemento
if exist "%APPDATA%\CdeAnin\complemento.json" ( echo Complementos: %APPDATA%\CdeAnin\complemento.json ya existe, no se toca >> "%LOG%" & exit /b 0 )
if not exist "%APPDATA%\CdeAnin" mkdir "%APPDATA%\CdeAnin"
(
  echo {
  echo   "servidor": "http://localhost:8090",
  echo   "llave": "PEGA-AQUI-LA-LLAVE-DEL-CDE",
  echo   "detalle": "medio"
  echo }
) > "%APPDATA%\CdeAnin\complemento.json"
echo Complementos: %APPDATA%\CdeAnin\complemento.json creado con el servidor http://localhost:8090 >> "%LOG%"
exit /b 0
