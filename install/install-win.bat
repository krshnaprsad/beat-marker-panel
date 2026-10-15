@echo off
rem Installs the Beat Markers panel for Premiere Pro and After Effects (current user, Windows).
set "SRC=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.krshnaprsad.beatmarkerpanel"
if exist "%DEST%" rmdir /S /Q "%DEST%"
mkdir "%DEST%"
xcopy "%SRC%\CSXS" "%DEST%\CSXS\" /E /I /Y >nul
xcopy "%SRC%\css" "%DEST%\css\" /E /I /Y >nul
xcopy "%SRC%\js" "%DEST%\js\" /E /I /Y >nul
xcopy "%SRC%\jsx" "%DEST%\jsx\" /E /I /Y >nul
copy /Y "%SRC%\index.html" "%DEST%\" >nul
rem Allow unsigned panels
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo Installed to: %DEST%
echo Now fully quit and reopen Premiere Pro / After Effects, then open Window ^> Extensions ^> Beat Markers.
pause
