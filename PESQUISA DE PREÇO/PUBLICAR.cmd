@echo off
chcp 65001 >nul
rem Publica o Banco de Preços LS na internet pelo Tailscale Funnel, com login obrigatório.
rem Fechar esta janela (ou Ctrl+C) tira o link do ar. O uso local em INICIAR.cmd (porta 5600) não é afetado.
title Banco de Preços LS - publicado
cd /d "%~dp0"
set "PORT=5601"
set "USUARIOS_ARQUIVO=%~dp0usuarios.txt"

set "NODE=node"
node -v >nul 2>nul || for /d %%D in ("%APPDATA%\fnm\node-versions\v*") do if exist "%%D\installation\node.exe" set "NODE=%%D\installation\node.exe"
"%NODE%" -v >nul 2>nul || (echo Node.js não encontrado. Instale em https://nodejs.org e tente de novo. & pause & exit /b 1)

set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" (echo Tailscale não instalado. Baixe em https://tailscale.com/download/windows e tente de novo. & pause & exit /b 1)

if not exist usuarios.txt (
  > usuarios.txt echo # Um usuário por linha no formato nome:senha - senha com 8 ou mais caracteres, sem ponto e vírgula.
  >> usuarios.txt echo # Exemplo: maria:Troque-Esta-Senha-123
  echo Cadastre a equipe no usuarios.txt que vai abrir agora. Salve, feche e rode PUBLICAR.cmd de novo.
  notepad usuarios.txt
  exit /b 1
)

"%TS%" status >nul 2>nul || "%TS%" up

start "Banco de Preços LS - servidor publicado" /min "%NODE%" server\server.mjs
timeout /t 3 /nobreak >nul
curl -s -o nul http://127.0.0.1:%PORT%/api/sessao || (echo O servidor não iniciou. Confira se usuarios.txt tem ao menos um usuário válido. & pause & exit /b 1)

echo.
echo Envie à equipe o link https://... que aparece abaixo. Para tirar do ar, feche esta janela.
echo.
"%TS%" funnel %PORT%
pause
