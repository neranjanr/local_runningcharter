<#
.SYNOPSIS
    Stops local_runningchart web service on port 8082 (Scheduled Task + local_runningchart.exe process).
    Data is preserved (runningcharter.db + localStorage untouched).
#>

$Port = 8082
$WorkDir = $PSScriptRoot
$TaskName = "local_runningchart"
$LegacyTaskName = "LocalRunningCharterService"

Write-Host ("Web Service stop process started at {0} on {1}" -f (Get-Date -Format "HH:mm:ss"), (Get-Date -Format "dd-MM-yyyy")) -ForegroundColor Cyan

# Ensure running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges to stop the service..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Set-Location -LiteralPath $WorkDir

Write-Host "Stopping web service on port $Port (data preserved)..." -ForegroundColor Cyan

# --- Stop and disable scheduled task if exists (new + legacy names) ---
$foundAny = $false
foreach ($tn in @($TaskName, $LegacyTaskName)) {
    $task = $null
    try { $task = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue } catch {}
    if ($task) {
        $foundAny = $true
        Write-Host "  Found scheduled task $tn - stopping..." -ForegroundColor DarkCyan
        try { Stop-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue | Out-Null; Write-Host "  Task $tn stopped." -ForegroundColor DarkCyan } catch { Write-Host "  Stop-ScheduledTask ${tn}: $($_.Exception.Message)" -ForegroundColor Yellow }
        try { Disable-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue | Out-Null; Write-Host "  Task $tn disabled (won't auto-start at logon)." -ForegroundColor DarkCyan } catch {}
    }
}
if (-not $foundAny) {
    Write-Host "  No scheduled task $TaskName / $LegacyTaskName found." -ForegroundColor DarkCyan
}

# --- Kill any process listening on $Port (local_runningchart / Node) ---
$killed = 0
try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -and $procId -ne 0 -and $procId -ne 4) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Stopping PID $procId ($($proc.ProcessName)) listening on :$Port" -ForegroundColor Yellow
                try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; $killed++ } catch { Write-Host "  Failed to stop PID $procId : $($_.Exception.Message)" -ForegroundColor Yellow }
            }
        }
    }
} catch { Write-Host "  Get-NetTCPConnection failed: $($_.Exception.Message)" -ForegroundColor Yellow }

# Fallback via netstat if nothing killed yet
if ($killed -eq 0) {
    try {
        $lines = netstat -ano | Select-String ":$Port"
        foreach ($line in $lines) {
            if ($line -match '\s+(\d+)\s*$') {
                $pidStr = $Matches[1]
                if ($pidStr -ne '0' -and $pidStr -ne '4') {
                    $proc = Get-Process -Id $pidStr -ErrorAction SilentlyContinue
                    $name = if ($proc) { $proc.ProcessName } else { "PID $pidStr" }
                    Write-Host "  Stopping $name on :$Port via netstat" -ForegroundColor Yellow
                    try { Stop-Process -Id $pidStr -Force -ErrorAction SilentlyContinue; $killed++ } catch {}
                }
            }
        }
    } catch {}
}

Start-Sleep -Seconds 2

# Verify port free
$stillListening = $false
try {
    $check = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($check) { $stillListening = $true }
} catch {
    try { $check2 = netstat -ano | Select-String ":$Port.*LISTENING"; if ($check2) { $stillListening = $true } } catch {}
}

if ($stillListening) {
    Write-Host "  Warning: port $Port still appears to be listening - a process may have respawned. Check Task Manager." -ForegroundColor Yellow
} else {
    Write-Host "  Port $Port is now free." -ForegroundColor Green
}

Write-Host ""
Write-Host ("Web Service stopped at {0} on {1} - port {2} free." -f (Get-Date -Format "HH:mm:ss"), (Get-Date -Format "dd-MM-yyyy"), $Port) -ForegroundColor Green
Write-Host "  Data preserved: $WorkDir\runningcharter.db and browser localStorage (fleetledger_*) untouched." -ForegroundColor DarkCyan
Write-Host "  Task $TaskName (legacy $LegacyTaskName) is disabled. To restart: .\start-service.ps1  To fully remove task: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false" -ForegroundColor DarkCyan
Write-Host "  Process name: local_runningchart.exe (was node.exe)" -ForegroundColor DarkCyan

# Also kill any stale Next.js build procs that might hold locks (harmless)
try {
    $buildProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('node.exe','local_runningchart.exe') -and $_.CommandLine -like "*next*build*" }
    foreach ($bp in $buildProcs) {
        Write-Host "  Killing stale next build PID $($bp.ProcessId) ($($bp.Name))" -ForegroundColor Yellow
        try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
} catch {}
