@echo off
setlocal
cd /d "%~dp0"
set "PATH=%CD%\runtime;%PATH%"

if not exist "node_modules\vinext" (
  echo Pripravuji aplikaci pro prvni spusteni...
  echo Tento krok vyzaduje pripojeni k internetu a muze trvat nekolik minut.
  "runtime\node.exe" "runtime\pnpm\bin\pnpm.mjs" install --frozen-lockfile
  if errorlevel 1 (
    echo.
    echo Priprava aplikace se nezdarila. Zkontrolujte pripojeni k internetu.
    pause
    exit /b 1
  )
)

start "" http://localhost:3000/
"runtime\node.exe" "runtime\pnpm\bin\pnpm.mjs" dev

