param([int]$Port = 8799)
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $existing) {
  if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Milliseconds 300
$env:PORT = "$Port"
$env:NODE_USE_ENV_PROXY = "1"
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = "http://127.0.0.1:7897" }
if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = "http://127.0.0.1:7897" }
if (-not $env:ALL_PROXY) { $env:ALL_PROXY = "http://127.0.0.1:7897" }
Write-Host "Starting Investment MVP on http://localhost:$Port"
node server.mjs
