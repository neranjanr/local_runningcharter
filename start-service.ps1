<#
.SYNOPSIS
    Builds and starts Local Running Charter in production mode on port 8082 as a persistent background service (Windows Scheduled Task).
#>

$AppName = "LocalRunningCharter"
$Port = 8082
$WorkDir = $PSScriptRoot

# Ensure running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges to set up the background service..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Set-Location -LiteralPath $WorkDir

# --- Stop any ongoing web server (fresh start, data preserved) ---
$TaskName = "LocalRunningCharterService"
Write-Host "Stopping any ongoing web server on port $Port (data preserved)..." -ForegroundColor Cyan

# Stop scheduled task if exists
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
Start-Sleep -Seconds 1
try { Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch {}

# Kill any process listening on $Port (Next.js / Node)
try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -and $procId -ne 0 -and $procId -ne 4) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Stopping PID $procId ($($proc.ProcessName)) listening on :$Port" -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch {}
# Fallback via netstat if Get-NetTCPConnection not available
if (-not $conns) {
    try {
        $lines = netstat -ano | Select-String ":$Port"
        foreach ($line in $lines) {
            if ($line -match '\s+(\d+)\s*$') {
                $pid = $Matches[1]
                if ($pid -ne '0' -and $pid -ne '4') {
                    try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Write-Host "  Stopped PID $pid via netstat" -ForegroundColor Yellow } catch {}
                }
            }
        }
    } catch {}
}
Start-Sleep -Seconds 2

# Unregister old task (will be re-created) - do NOT delete DB/files
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
Write-Host "  Existing service stopped. DB at $WorkDir\runningcharter.db and browser localStorage are preserved." -ForegroundColor DarkCyan

Write-Host "Building application for production (existing data not harmed)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

$NodePath = (Get-Command node).Source
$NextBin = "$WorkDir\node_modules\next\dist\bin\next"

# Create or update Scheduled Task to run at startup and persist when window closed
$Action = New-ScheduledTaskAction -Execute "$NodePath" -Argument "`"$NextBin`" start -p $Port" -WorkingDirectory "$WorkDir"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -RunLevel Highest -User "NT AUTHORITY\SYSTEM" -Force | Out-Null

Write-Host "Starting fresh background service..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3

Write-Host "Local Running Charter is now running (fresh) in production on port $Port!" -ForegroundColor Green
Write-Host "  Data preserved: runningcharter.db + localStorage (fleetledger_*) untouched" -ForegroundColor DarkCyan
Write-Host "Opening http://localhost:$Port in your browser (hard-refresh Ctrl+Shift+R if you still see old version)..." -ForegroundColor Cyan
Start-Process "http://localhost:$Port"
