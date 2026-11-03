@echo off
set "NODEDIR=%LOCALAPPDATA%\Programs\node-v26.13.0-win-x64"
set "PATH=%NODEDIR%;%PATH%"
set "SHIM=%~dp0hostname-ascii.cjs"
set "NODE_OPTIONS=--require "%SHIM:\=/%""
call "%NODEDIR%\vercel.cmd" %*
