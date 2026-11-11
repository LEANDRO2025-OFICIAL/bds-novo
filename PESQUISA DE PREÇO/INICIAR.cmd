@echo off
rem Inicia o Banco de Precos LS neste computador (porta 5600) e abre o navegador.
rem  - se o sistema ja estiver aberto, so abre o navegador;
rem  - se a porta estiver com outro programa, avisa e sai sem iniciar nada;
rem  - o navegador so abre depois que o servidor estiver respondendo (quem abre e o proprio servidor).
rem Sem blocos entre parenteses de proposito: funciona mesmo se a pasta tiver ")" ou espacos no nome.
setlocal EnableExtensions
title Banco de Precos LS
cd /d "%~dp0"
if errorlevel 1 goto sem_pasta
if not defined PORT set "PORT=5600"

set "NODE=node"
rem Se o "node" do PATH for o shim do fnm sem ambiente configurado, usa a instalacao do fnm direto.
node -v >nul 2>nul || for /d %%D in ("%APPDATA%\fnm\node-versions\v*") do if exist "%%D\installation\node.exe" set "NODE=%%D\installation\node.exe"
"%NODE%" -v >nul 2>nul || goto sem_node
"%NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto node_antigo

rem Pasta dos dados (banco SQLite e backups). O servidor tambem cria, mas aqui o erro aparece antes e mais claro.
if not exist "data\" mkdir "data"
if not exist "data\" goto sem_dados

rem Quem esta na porta?  0 = livre   10 = o proprio Banco de Precos LS   20 = outro programa
"%NODE%" server\verificar-porta.mjs %PORT%
if errorlevel 20 goto porta_ocupada
if errorlevel 10 goto ja_aberto

echo Iniciando o Banco de Precos LS em http://localhost:%PORT%/
echo Deixe esta janela aberta enquanto usa o sistema. Para encerrar, feche-a ou pressione Ctrl+C.
echo.
set "ABRIR_NAVEGADOR=1"
"%NODE%" --disable-warning=ExperimentalWarning server\server.mjs
echo.
echo O servidor foi encerrado.
pause
exit /b

:ja_aberto
echo O Banco de Precos LS ja esta aberto neste computador. Abrindo o navegador...
start "" "http://localhost:%PORT%/"
timeout /t 3 /nobreak >nul
exit /b 0

:porta_ocupada
echo.
echo ATENCAO: a porta %PORT% esta em uso por OUTRO programa.
echo O Banco de Precos LS NAO foi iniciado e nada foi alterado.
echo.
echo Como resolver:
echo   1. Feche o programa que esta usando a porta %PORT% e abra o INICIAR.cmd de novo.
echo   2. Para descobrir qual programa, rode no Prompt de Comando:
echo        netstat -ano ^| findstr :%PORT%
echo      O numero da ultima coluna (PID) aparece no Gerenciador de Tarefas, aba Detalhes.
echo.
pause
exit /b 1

:sem_node
echo Node.js nao encontrado. Instale a versao 22.13 ou superior em https://nodejs.org e tente de novo.
pause
exit /b 1

:node_antigo
echo O Node.js instalado e antigo. O sistema precisa da versao 22.13 ou superior.
echo Versao encontrada:
"%NODE%" -v
echo Atualize em https://nodejs.org e tente de novo.
pause
exit /b 1

:sem_dados
echo Nao foi possivel criar a pasta de dados "%~dp0data".
echo Verifique se voce tem permissao de escrita nesta pasta ou mova o sistema para Documentos.
pause
exit /b 1

:sem_pasta
echo Nao foi possivel acessar a pasta do sistema.
pause
exit /b 1
