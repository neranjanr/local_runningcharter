<#
.SYNOPSIS
    Builds and starts Local Running Charter in production mode on port 8082 as a persistent background service (Windows Scheduled Task).
#>

$AppName = "LocalRunningCharter"
$Port = 8082
$WorkDir = $PSScriptRoot

# --- Mobile private build: Apps Script URL source of truth ---
# Option A (recommended): leave empty and keep URL in gitignored config/sheet.local.json { scriptUrl } — build script reads it.
# Option B: paste URL here to override config file and inject directly via PS1 (still not pushed to git if PS1 is local).
$ScriptUrl = ""  # e.g. "https://script.google.com/macros/s/AKfycbyf.../exec"

# Ensure running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges to set up the background service..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Set-Location -LiteralPath $WorkDir

Write-Host ("-- attempting to start service at {0} on {1}" -f (Get-Date -Format "HH:mm"), (Get-Date -Format "dd-MM-yyyy")) -ForegroundColor Cyan

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

# --- Guard against concurrent Next.js build (common when service was not cleanly stopped) ---
Write-Host "  Checking for stale Next.js build lock..." -ForegroundColor DarkCyan
try {
    $buildProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*next*build*" }
    foreach ($bp in $buildProcs) {
        Write-Host "  Killing stale next build PID $($bp.ProcessId)" -ForegroundColor Yellow
        try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
} catch {}
$traceLock = Join-Path $WorkDir ".next\trace"
$buildLock = Join-Path $WorkDir ".next\build.lock"
foreach ($lock in @($traceLock, $buildLock)) {
    if (Test-Path -LiteralPath $lock) {
        for ($i=0; $i -lt 5; $i++) {
            try { Remove-Item -LiteralPath $lock -Force -ErrorAction Stop; Write-Host "  Removed stale lock $lock" -ForegroundColor DarkCyan; break } catch { Start-Sleep -Seconds 1 }
        }
    }
}
Start-Sleep -Seconds 2

$buildAttempts = 0
$buildSuccess = $false
while ($buildAttempts -lt 3 -and -not $buildSuccess) {
    $buildAttempts++
    if ($buildAttempts -gt 1) { Write-Host "  Retrying build (attempt $buildAttempts)..." -ForegroundColor Yellow; Start-Sleep -Seconds 2 }
    npm run build
    if ($LASTEXITCODE -eq 0) { $buildSuccess = $true }
    else {
        Write-Host "  Build attempt $buildAttempts failed with exit code $LASTEXITCODE" -ForegroundColor Yellow
        # Clean lock again before retry
        foreach ($lock in @($traceLock, $buildLock)) {
            if (Test-Path -LiteralPath $lock) { try { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue } catch {} }
        }
        # Kill any orphaned next build procs before retry
        try {
            $bps2 = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*next*build*" }
            foreach ($bp in $bps2) { try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
        } catch {}
    }
}
if (-not $buildSuccess) {
    Write-Host "Build failed after $buildAttempts attempts!" -ForegroundColor Red
    Write-Host "  Tip: Close any other terminal running 'npm run build' or 'next build', then re-run this script." -ForegroundColor Yellow
    pause
    exit 1
}

# --- Build Mobile private file from PS1 / config ---
Write-Host "Building Mobile private file (Mobile_with_url_private.html)..." -ForegroundColor Cyan
try {
    # If $ScriptUrl is set in this PS1, prefer it (env override); otherwise scripts/build-mobile.js reads config/sheet.local.json
    if ($ScriptUrl -and $ScriptUrl.Trim() -ne "") {
        $env:SCRIPT_URL = $ScriptUrl.Trim()
        Write-Host "  Using Script URL from PS1 (`$ScriptUrl)" -ForegroundColor DarkCyan
    } else {
        # Also try config/sheet.local.json for logging
        $cfg = Join-Path $WorkDir "config\sheet.local.json"
        if (Test-Path -LiteralPath $cfg) {
            try {
                $j = Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json
                if ($j.scriptUrl) { Write-Host "  Using Script URL from config/sheet.local.json" -ForegroundColor DarkCyan }
            } catch {}
        }
        Remove-Item Env:SCRIPT_URL -ErrorAction SilentlyContinue
    }
    npm run build:mobile
    if ($LASTEXITCODE -ne 0) { Write-Host "Mobile build failed (non-fatal)!" -ForegroundColor Yellow }
    else {
        # PS1 direct injection fallback: ensure private file has PS1 URL if build script used placeholder
        if ($ScriptUrl -and $ScriptUrl.Trim() -ne "") {
            $priv = Join-Path $WorkDir "quicktrip-mobile\dist\Mobile_with_url_private.html"
            $pub  = Join-Path $WorkDir "quicktrip-mobile\dist\mobile_app_public.html"
            if (Test-Path -LiteralPath $priv) {
                $html = Get-Content -LiteralPath $priv -Raw
                if ($html -match 'const SCRIPT_URL_DEFAULT\s*=\s*""') {
                    $html = $html -replace 'const SCRIPT_URL_DEFAULT\s*=\s*""', ('const SCRIPT_URL_DEFAULT = "' + $ScriptUrl.Trim() + '"')
                    Set-Content -LiteralPath $priv -Value $html -NoNewline
                    Write-Host "  PS1 patched private file directly" -ForegroundColor DarkCyan
                }
            }
        }
    }
} catch {
    Write-Host "  Mobile build error: $($_.Exception.Message)" -ForegroundColor Yellow
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
