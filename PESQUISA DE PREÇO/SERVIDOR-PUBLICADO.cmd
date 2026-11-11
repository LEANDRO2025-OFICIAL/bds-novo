@echo off
rem Servidor publicado (porta 5601, login obrigatório). Chamado pela tarefa agendada via iniciar-oculto.vbs.
cd /d "%~dp0"
set "PORT=5601"
set "USUARIOS_ARQUIVO=%~dp0usuarios.txt"
set "NODE=node"
node -v >nul 2>nul || for /d %%D in ("%APPDATA%\fnm\node-versions\v*") do if exist "%%D\installation\node.exe" set "NODE=%%D\installation\node.exe"
"%NODE%" server\server.mjs >> "%TEMP%\banco-precos-publicado.log" 2>&1
