@echo off
REM CenaPronta Uploader — processo persistente no Windows.
REM Agendar no Agendador de Tarefas (na inicializacao) ou registrar com NSSM:
REM   nssm install CenaProntaUploader "%ProgramFiles%\nodejs\node.exe" "%~dp0..\..\apps\uploader\src\index.mjs"
REM   nssm set CenaProntaUploader AppDirectory "%~dp0..\.."
setlocal
cd /d "%~dp0..\.."
title CenaPronta Uploader
node apps/uploader/src/index.mjs
