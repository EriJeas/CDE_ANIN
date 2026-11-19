@echo off
rem Compila e instala el complemento de Revit "Publicar al CDE". Uso: 3-compila-revit.bat [version]
rem   Sin argumentos compila para cada Revit instalado (2024, 2025, 2026, 2027 en C:\Program Files\Autodesk).
rem   3-compila-revit.bat 2024   (solo esa version)
rem Cierra Revit antes: tiene la DLL abierta. Queda en %AppData%\Autodesk\Revit\Addins\<version>\. El resultado queda en compila-revit.txt.
setlocal
cd /d "%~dp0complemento-revit"
set "VERS=%~1"
if "%VERS%"=="" for %%v in (2024 2025 2026 2027) do if exist "C:\Program Files\Autodesk\Revit %%v\RevitAPI.dll" call set "VERS=%%VERS%% %%v"
if "%VERS%"=="" (
  echo No se encontro Revit 2024 a 2027 en C:\Program Files\Autodesk > ..\compila-revit.txt
  exit /b 1
)
(
for %%v in (%VERS%) do (
  echo === DOTNET BUILD Revit %%v ===
  dotnet build CdeAnin.csproj -c Release -p:RevitVersion=%%v -p:OutDir=bin\Release\%%v\ -p:IntermediateOutputPath=obj\Release\%%v\ 2>&1
  if errorlevel 1 if %%v GEQ 2026 (
    echo === Revit %%v: se compila de nuevo para .NET 10 [las actualizaciones recientes de Revit usan .NET 10] ===
    dotnet build CdeAnin.csproj -c Release -p:RevitVersion=%%v -p:RevitTfm=net10.0-windows -p:OutDir=bin\Release\%%v\ -p:IntermediateOutputPath=obj\Release\%%v-net10\ 2>&1
  )
)
echo === FIN ===
) > ..\compila-revit.txt 2>&1
endlocal
