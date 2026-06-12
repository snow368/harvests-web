@echo off
cd /d "F:\inkflow app\InkFlow_Project\inkflow_harvests"
set BOT_ID=bot_wa_01
set BOT_PROFILE_DIR=F:\inkflow app\InkFlow_Project\inkflow_harvests\data\bot_profiles\bot_wa_01_cloak
set BOT_PROXY_SERVER=socks5://127.0.0.1:10808
set BOT_EXEC_MODE=browse_like
set BOT_SPEED_FACTOR=2.8
set BOT_VARIANCE=0.45
set BOT_BROWSE_ORDER=random
set BOT_POLL_LIMIT=1
set BOT_COMMENT_ENABLED=true
set BOT_COMMENT_REVIEW_MODE=true
REM 审核模式: comment生成后保存到 data/comment_review/，不直接发。审核通过后改为false自动发。
set BOT_HEADLESS=false
REM Force CloakBrowser to download Chromium & cache on F drive
set CLOAKBROWSER_CACHE_DIR=F:\inkflow app\InkFlow_Project\inkflow_harvests\.cloakbrowser_cache

echo [CloakBrowser Test] Starting...
echo   Browser: CloakBrowser (stealth Chromium, 49 C++ patches, humanize=on)
echo   Profile: %BOT_PROFILE_DIR%
echo   Proxy: %BOT_PROXY_SERVER%
echo   Cache: %CLOAKBROWSER_CACHE_DIR%
echo.
echo === Open browser and log into Instagram manually ===
echo === After login, the bot will auto-process tasks ===
echo.

npm run bot:cloak:test
pause
