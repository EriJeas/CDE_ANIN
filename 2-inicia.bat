@echo off
rem Arranca el CDE ANIN en una ventana minimizada ("CDE ANIN") y lo abre en el navegador: http://localhost:8090
rem   Si ya esta corriendo, solo abre el navegador. Para detenerlo: cierra la ventana "CDE ANIN". Para reiniciarlo: 4-reinicia.bat
rem   Lo que escribe el servidor queda en servidor.txt.
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
set "PUERTO=8090"
for /f "tokens=2 delims==" %%p in ('findstr /b /c:"PORT=" ".env" 2^>nul') do set "PUERTO=%%p"
set "URL=http://localhost:%PUERTO%"
rem Ya corre si responde (se pregunta al CDE, no a netstat: su texto cambia con el idioma de Windows)
curl.exe -s -o nul -m 3 "%URL%/" && goto :abre
start "CDE ANIN" /min cmd /c "echo CDE ANIN corriendo en %URL% & echo No cierres esta ventana: al cerrarla se detiene el CDE. Puedes minimizarla. & node servidor.js > servidor.txt 2>&1"
set /a ESPERA=0
:espera
timeout /t 1 /nobreak >nul
set /a ESPERA+=1
curl.exe -s -o nul -m 2 "%URL%/" && goto :abre
if %ESPERA% lss 30 goto :espera
echo El CDE no arranco en 30 s. Revisa servidor.txt
pause
exit /b 1
:abre
start "" "%URL%"
endlocal
