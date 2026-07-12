@echo off
title Build Base64 DLL Tool
color 0a

echo =========================================
echo    Building Base64 DLL Tool (v0.0.8)
echo =========================================
echo.
echo Please wait, compiling main.js to executable...
echo (Requires internet connection for the first time to download Node.js binaries via npx)
echo.

:: Используем npx для запуска pkg (сборщика Node.js проектов в .exe)
call npx pkg main.js --targets node18-win-x64 --output Base64_DLL_Tool.exe

echo.
if exist Base64_DLL_Tool.exe (
    echo [SUCCESS] Build complete! File created: Base64_DLL_Tool.exe
) else (
    color 0c
    echo [ERROR] Build failed. Make sure you have Node.js and npm installed.
)
echo.
pause
