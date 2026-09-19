@echo off
setlocal
title Reader App - Metro Tunnel
cd /d "%~dp0"

if not exist "node_modules\.bin\expo.cmd" (
  echo.
  echo 未找到项目依赖。请先在此项目目录安装依赖。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在以 Tunnel 模式启动 Reader App Metro...
echo 请保持此窗口打开；按 Ctrl+C 可停止服务。
echo.
call "node_modules\.bin\expo.cmd" start --dev-client --tunnel

echo.
echo Metro 已停止。
pause
