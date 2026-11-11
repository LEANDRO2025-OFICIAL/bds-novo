@echo off
rem Inicia o Banco de Preços LS e abre o navegador.
cd /d "%~dp0"
set "NODE=node"
rem Se o "node" do PATH for o shim do fnm sem ambiente configurado, usa a instalação do fnm direto.
node -v >nul 2>nul || for /d %%D in ("%APPDATA%\fnm\node-versions\v*") do if exist "%%D\installation\node.exe" set "NODE=%%D\installation\node.exe"
"%NODE%" -v >nul 2>nul || (echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo. & pause & exit /b 1)
start "" http://localhost:5600/
"%NODE%" server\server.mjs
pause
