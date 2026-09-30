@echo off
rem solo-keel dashboard launcher for Windows: runs serve.ps1 (menu to pick Node.js, PHP or Python 3).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
