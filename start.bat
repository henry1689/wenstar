@echo off
REM ============================================
REM 文曲星·玉瑶 一键启动
REM 同时拉起 WebUI后端(3000) + 粒子前端(5173)
REM ============================================
title 文曲星·玉瑶

echo.
echo ╔══════════════════════════════════════╗
echo ║    文曲星·玉瑶  启动中...           ║
echo ╚══════════════════════════════════════╝
echo.

REM 设置 API Key（如果已配置环境变量则优先使用）
if "%DEEPSEEK_API_KEY%"=="" (
  echo [INFO] 未设置 DEEPSEEK_API_KEY 环境变量
  echo [INFO] 可在启动后通过 WebUI 设置面板录入
)

REM 启动 WebUI 后端
echo [1/2] 启动玉瑶 WebUI (port 3000)...
start "玉瑶-WebUI" cmd /c "cd /d D:\wenstar && npx tsx src/webui/server.ts"

REM 等待后端就绪
timeout /t 6 /nobreak >nul

REM 启动 3D 粒子前端
echo [2/2] 启动粒子可视化 (port 5173)...
start "玉瑶-粒子" cmd /c "cd /d D:\wenstar\ui && npx vite --host 0.0.0.0 --port 5173"

timeout /t 3 /nobreak >nul

echo.
echo ✅ 两个服务已启动：
echo.
echo   📡  WebUI:  http://localhost:3000
echo   🌟  粒子:   http://localhost:5173
echo.
echo   ⚠️  首次启动需要几分钟加载依赖
echo   ⚙️  设置 API Key 请打开粒子界面左下角齿轮
echo.
pause
