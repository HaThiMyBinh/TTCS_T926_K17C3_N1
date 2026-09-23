@echo off
title He Thong Quan Ly Tai Khoan
chcp 65001 >nul
echo ===================================================
echo   DANG KHOI DONG DU AN QUAN LY TAI KHOAN...
echo ===================================================

cd backend

:: 1. Tự động kiểm tra nếu chưa có thư viện thì tự cài đặt
if not exist node_modules (
    echo [1/3] May chua co thu vien, dang tu dong cai dat (khoang vai giay)...
    call npm install express cors
) else (
    echo [1/3] Thu vien da san sang!
)

:: 2. Bat Server Backend chay ngam
echo [2/3] Dang bat Server Backend tai cong 5000...
start /b node server.js

:: 3. Cho 2 giay de server khoi dong xong roi tu bat trinh duyet
timeout /t 2 >nul
echo [3/3] Dang mo giao dien tren trinh duyet...
start ../frontend/index.html

echo.
echo ===================================================
echo   DU AN DA KHOI DONG THANH CONG!
echo   (Vui long khong tat cua so nay khi dang su dung)
echo ===================================================
pause
