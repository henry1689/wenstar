@echo off
chcp 65001 >nul
cd /d "%~dp0"

title 太虚境 · 启动器

echo ==============================
echo   太虚境 · 一键启动
echo ==============================
echo.

:: 先杀残留进程
echo [1/3] 清理残留进程...
taskkill /F /FI "WINDOWTITLE eq node webui" 2>nul
taskkill /F /FI "WINDOWTITLE eq node vite" 2>nul
timeout /t 2 /nobreak >nul

:: 启动后端
echo [2/3] 启动后端 (端口 3000)...
start "node webui" /min npx tsx src/webui/server.ts
timeout /t 10 /nobreak >nul

:: 启动前端+守护
echo [3/3] 启动前端 (端口 5174) + 守护...
:restart_vite
start "node vite" /min npx vite --host --port 5174

:watchdog
timeout /t 10 /nobreak >nul
tasklist /FI "WINDOWTITLE eq node vite" 2>nul | find "node.exe" >nul
if errorlevel 1 (
    echo [%date% %time%] Vite异常退出，正在重启... >> start-all.log
    echo [%date% %time%] Vite异常退出，正在重启...
    start "node vite" /min npx vite --host --port 5174
)
goto watchdog
