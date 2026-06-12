@echo off
title 太虚境 · 一键启动
cd /d C:\Users\Administrator

echo ═══════════════════════════════════════════
echo   太虚境 · 全系统启动
echo ═══════════════════════════════════════════
echo.

:: ===== 1. wenstar 后端 (3001) =====
echo [1/4] 启动 wenstar 后端...
start "wenstar-backend" cmd /c "cd /d C:\Users\Administrator\wenstar && set PORT=3001 && npx tsx src/webui/server.ts"
timeout /t 5 /nobreak >nul

:: ===== 2. Vite 前端 (5174) =====
echo [2/4] 启动 Vite 前端...
start "vite-frontend" cmd /c "cd /d C:\Users\Administrator\wenstar\ui && npx vite --host 0.0.0.0"
timeout /t 3 /nobreak >nul

:: ===== 3. 仿生智脑 (7200) =====
echo [3/4] 启动仿生智脑...
start "bionic-brain" cmd /c "cd /d C:\Users\Administrator\bionic-cognitive-engine && .\venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 7200"
timeout /t 5 /nobreak >nul

:: ===== 4. TTS 语音 (8765) =====
echo [4/4] 启动 TTS 语音...
start "tts-server" cmd /c "cd /d C:\Users\Administrator\wenstar\src\webui && C:\Users\Administrator\bionic-cognitive-engine\venv\Scripts\python tts_server.py 8765"
timeout /t 3 /nobreak >nul

:: ===== 验证 =====
echo.
echo ═══════════════════════════════════════════
echo   等待服务就绪...
echo ═══════════════════════════════════════════
timeout /t 8 /nobreak >nul

echo.
echo 验证服务状态:
echo   wenstar : http://localhost:3001
echo   Vite    : http://localhost:5174
echo   仿生智脑: http://localhost:7200
echo   TTS     : http://localhost:8765
echo.
echo 所有服务启动完毕！
echo 按任意键关闭此窗口（服务仍在后台运行）
pause >nul
