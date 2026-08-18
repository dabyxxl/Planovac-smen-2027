@echo off
cd /d "%~dp0.."
set "PATH=C:\Users\daber\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\daber\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%PATH%"
start "" http://localhost:3000/
pnpm dev
