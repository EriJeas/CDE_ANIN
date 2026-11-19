@echo off
rem Reinicia el CDE ANIN: detiene el servidor (node) que escucha en el puerto del .env (8090 por defecto) y lo vuelve a arrancar con 2-inicia.bat.
rem   Las sesiones abiertas en el navegador se conservan. Lo que hizo queda en reinicia.txt.
setlocal
cd /d "%~dp0"
set "PUERTO=8090"
for /f "tokens=2 delims==" %%p in ('findstr /b /c:"PORT=" ".env" 2^>nul') do set "PUERTO=%%p"
echo === Reinicio %date% %time% (puerto %PUERTO%) === > reinicia.txt
rem El servidor es el proceso node dueno de las conexiones con puerto local %PUERTO% (Get-NetTCPConnection: en esta PC netstat no lista la escucha y su texto cambia con el idioma)
for /f "usebackq" %%i in (`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PUERTO% -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique | Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -eq 'node' }"`) do (
  echo Deteniendo el servidor, proceso %%i >> reinicia.txt
  taskkill /pid %%i /f >> reinicia.txt 2>&1
)
set /a ESPERA=0
:espera
timeout /t 1 /nobreak >nul
set /a ESPERA+=1
curl.exe -s -o nul -m 2 "http://localhost:%PUERTO%/" && if %ESPERA% lss 10 goto :espera
if %ESPERA% geq 10 echo AVISO: el CDE seguia respondiendo despues de 10 s >> reinicia.txt
echo Arrancando de nuevo >> reinicia.txt
endlocal
call "%~dp02-inicia.bat"
