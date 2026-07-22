@echo off
set SCRIPT_DIR=%~dp0
call "%SCRIPT_DIR%\..\..\26.2\bridge\gradlew.bat" -p "%SCRIPT_DIR%" %*
