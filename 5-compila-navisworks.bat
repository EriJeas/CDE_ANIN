@echo off
rem Compila e instala el complemento de Navisworks "Publicar al CDE". Uso: 5-compila-navisworks.bat [version] [carpeta de Navisworks]
rem   Sin argumentos busca la version instalada (2027, 2026, 2025, 2024; Manage o Simulate en C:\Program Files\Autodesk).
rem   5-compila-navisworks.bat 2027 "H:\Autodesk\Navisworks Manage 2027"
rem Cierra Navisworks antes: tiene la DLL abierta. El resultado queda en compila-navisworks.txt.
cd /d "%~dp0complemento-navisworks"
set NAVIS=
set DIRNAVIS=
if not "%~1"=="" set NAVIS=%~1
if not "%~2"=="" set DIRNAVIS=-p:NavisDir="%~2"
if "%NAVIS%"=="" for %%v in (2027 2026 2025 2024) do if not defined NAVIS if exist "C:\Program Files\Autodesk\Navisworks Manage %%v\Autodesk.Navisworks.Api.dll" set NAVIS=%%v
if "%NAVIS%"=="" for %%v in (2027 2026 2025 2024) do if not defined NAVIS if exist "C:\Program Files\Autodesk\Navisworks Simulate %%v\Autodesk.Navisworks.Api.dll" set NAVIS=%%v
if "%NAVIS%"=="" set NAVIS=2026
(
echo === DOTNET BUILD Navisworks %NAVIS% === & dotnet build -c Release -p:NavisVersion=%NAVIS% %DIRNAVIS% 2>&1
echo === FIN ===
) > ..\compila-navisworks.txt 2>&1
