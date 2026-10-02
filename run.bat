@echo off
setlocal enabledelayedexpansion
title He Thong Quan Ly Thuc Tap Sinh & Phan Quyen
cd /d "%~dp0backend"

echo ========================================================
echo   DANG KIEM TRA MOI TRUONG CHAY DU AN
echo ========================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [LOI] Khong tim thay Node.js tren may tinh nay!
  echo Vui long cai dat Node.js ^(ban LTS^) tai: https://nodejs.org/
  echo Sau khi cai xong, hay chay lai file run.bat nay.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/4] Chua co thu vien node_modules, dang tu dong cai dat...
  call npm install
  if !errorlevel! neq 0 (
    echo [LOI] Cai dat thu vien that bai! Vui long kiem tra ket noi Internet roi thu lai.
    pause
    exit /b 1
  )
)

echo [2/4] Dang khoi dong Server Backend tai cong 5000...
start "Backend Server - KHONG TAT CUA SO NAY" cmd /k "node server.js"

echo [3/4] Dang cho Backend san sang (kiem tra qua /api/health)...

where curl >nul 2>nul
if %errorlevel% neq 0 (
  echo [CANH BAO] Khong tim thay lenh "curl" tren may nay, se dung PowerShell de kiem tra thay the.
  set "USE_POWERSHELL=1"
) else (
  set "USE_POWERSHELL=0"
)

set "SERVER_OK=0"
set "HEALTH_URL=http://127.0.0.1:5000/api/health"

for /l %%i in (1,1,20) do (
  if "!SERVER_OK!"=="0" (
    if "!USE_POWERSHELL!"=="1" (
      powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    ) else (
      curl -s -o nul -w "%%{http_code}" --max-time 2 "%HEALTH_URL%" > "%TEMP%\um_health_status.txt" 2>nul
      set /p HTTP_CODE=<"%TEMP%\um_health_status.txt"
    )

    if "!USE_POWERSHELL!"=="1" (
      if !errorlevel! equ 0 set "SERVER_OK=1"
    ) else (
      if "!HTTP_CODE!"=="200" set "SERVER_OK=1"
    )

    if "!SERVER_OK!"=="0" timeout /t 1 >nul
  )
)

if "%SERVER_OK%"=="0" (
  echo.
  echo ========================================================
  echo   [LOI] BACKEND CHUA KHOI DONG DUOC SAU 20 GIAY!
  echo ========================================================
  echo   Nguyen nhan thuong gap:
  echo   - MySQL Server chua bat, hoac sai thong tin trong backend\db_config.json
  echo   - Cong 5000 dang bi chuong trinh khac su dung
  echo   - Thieu thu vien: hay xoa thu muc node_modules roi chay lai run.bat
  echo.
  echo   HAY XEM CUA SO "Backend Server" vua duoc mo de doc thong bao loi
  echo   chi tiet tu Node.js, roi khac phuc va chay lai run.bat.
  echo ========================================================
  pause
  exit /b 1
)

echo [4/4] Backend da san sang! Dang mo trang Dang Nhap tren trinh duyet mac dinh...
start http://localhost:5000/login.html

echo.
echo ========================================================
echo   DA KHOI DONG THANH CONG! (da kiem tra qua /api/health)
echo   - Neu trinh duyet chua tu mo, hay truy cap: http://localhost:5000/login.html
echo   - Dung tat cua so "Backend Server" trong khi su dung he thong.
echo ========================================================
pause
