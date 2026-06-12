param(
  [string]$ProjectDir = "F:\inkflow app\InkFlow_Project\inkflow_harvests",
  [string]$BotId = "bot_wa_01",
  [string]$BotAccountIds = "acc_wa_01",
  [string]$CdpUrl = "http://127.0.0.1:9222",
  [string]$ChromeProfileDir = "F:\bots\profiles\bot_wa_01",
  [string]$ApiBase = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Wait-ApiHealthy($url, $maxRetry = 25, $sleepSec = 2) {
  for ($i = 1; $i -le $maxRetry; $i++) {
    try {
      $r = Invoke-RestMethod "$url/api/health" -TimeoutSec 3
      if ($r.status -eq "ok") { return $true }
    } catch {}
    Start-Sleep -Seconds $sleepSec
  }
  return $false
}

function Wait-CdpHealthy($cdpUrl, $maxRetry = 20, $sleepSec = 1) {
  for ($i = 1; $i -le $maxRetry; $i++) {
    try {
      $null = Invoke-RestMethod "$cdpUrl/json/version" -TimeoutSec 3
      return $true
    } catch {}
    Start-Sleep -Seconds $sleepSec
  }
  return $false
}

Write-Step "ProjectDir = $ProjectDir"
if (!(Test-Path "$ProjectDir\package.json")) {
  throw "package.json not found under $ProjectDir"
}

Write-Step "Stopping stale Node processes (safe restart)"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Step "Starting API server in new window"
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$ProjectDir`"; npm run dev"
)

Write-Step "Waiting API health..."
if (-not (Wait-ApiHealthy -url $ApiBase)) {
  throw "API health check failed at $ApiBase"
}
Write-Step "API is healthy"

Write-Step "Starting Chrome CDP with profile: $ChromeProfileDir"
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$ChromeProfileDir"
)

Write-Step "Waiting CDP endpoint..."
if (-not (Wait-CdpHealthy -cdpUrl $CdpUrl)) {
  throw "CDP endpoint not ready: $CdpUrl"
}
Write-Step "CDP is healthy"

Write-Step "Starting bot worker in new window"
$workerCmd = @"
cd "$ProjectDir"
`$env:BOT_ID="$BotId"
`$env:BOT_ACCOUNT_IDS="$BotAccountIds"
`$env:BOT_CDP_URL="$CdpUrl"
`$env:BOT_EXEC_MODE="browse_only"
`$env:BOT_SPEED_FACTOR="2.8"
`$env:BOT_VARIANCE="0.45"
`$env:BOT_BROWSE_ORDER="random"
`$env:BOT_POLL_LIMIT="1"
npm run bot:worker:real
"@
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $workerCmd)

Write-Step "Waiting bot online state..."
Start-Sleep -Seconds 3
try {
  $online = Invoke-RestMethod "$ApiBase/api/bot/online" -TimeoutSec 5
  Write-Host "bot online: $($online.online)/$($online.total)" -ForegroundColor Green
} catch {
  Write-Host "bot online check failed (worker may still be booting)" -ForegroundColor Yellow
}

Write-Step "Queue snapshot"
try {
  $tasks = Invoke-RestMethod "$ApiBase/api/scrape/tasks" -TimeoutSec 5
  $runningCount = @($tasks | Where-Object { $_.status -eq "running" }).Count
  Write-Host "scrape tasks total=$(@($tasks).Count), running=$runningCount" -ForegroundColor Green
} catch {
  Write-Host "scrape task check failed" -ForegroundColor Yellow
}

Write-Step "Done. Server + CDP + Worker started."
Write-Host "Use Ctrl+C inside worker window to stop bot gracefully." -ForegroundColor Magenta
