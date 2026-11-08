@echo off
setlocal EnableExtensions
cd /d "%~dp0"

 title Paradox Command Center - Windows Builder
 echo ==================================================
 echo   PARADOX COMMAND CENTER 1.0.0 - WINDOWS BUILDER
 echo ==================================================
 echo.

 if not exist "package.json" (
   echo ERROR: package.json was not found.
   echo Place this BAT file in the extracted project root folder,
   echo next to package.json, then run it again.
   goto :failed
 )

 where node >nul 2>nul
 if errorlevel 1 (
   echo ERROR: Node.js is not installed or is not on PATH.
   echo Install Node.js 22 or newer, then reopen this window.
   echo https://nodejs.org/
   goto :failed
 )

 where npm >nul 2>nul
 if errorlevel 1 (
   echo ERROR: npm was not found. Reinstall Node.js with npm included.
   goto :failed
 )

 for /f "tokens=1 delims=v." %%V in ('node --version') do set "NODE_MAJOR=%%V"
 if not defined NODE_MAJOR (
   echo ERROR: Could not read the Node.js version.
   goto :failed
 )
 if %NODE_MAJOR% LSS 22 (
   echo ERROR: Node.js 22 or newer is required. Found:
   node --version
   goto :failed
 )

 echo Detected Node.js:
 node --version
 echo Detected npm:
 npm --version
 echo.
 echo Installing project dependencies. Internet access is required.
 call npm install --no-audit --no-fund
 if errorlevel 1 goto :failed

 echo.
 echo Building the Windows x64 installer and portable EXE...
 call npm run dist:win
 if errorlevel 1 goto :failed

 echo.
 echo ==================================================
 echo BUILD COMPLETE
 echo ==================================================
 echo Output folder:
 echo %CD%\release
 echo.
 if exist "release" explorer "%CD%\release"
 pause
 exit /b 0

:failed
 echo.
 echo BUILD DID NOT COMPLETE.
 echo Read the error above. Check internet access and try again.
 echo If npm reports a permissions or antivirus error, do not disable security software;
 echo use a trusted Windows account and review the specific error instead.
 echo.
 pause
 exit /b 1
