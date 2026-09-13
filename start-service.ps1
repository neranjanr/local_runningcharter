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

Write-Host "Building application for production..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

$NodePath = (Get-Command node).Source
$NextBin = "$WorkDir\node_modules\next\dist\bin\next"

# Create or update Scheduled Task to run at startup and persist when window closed
$TaskName = "LocalRunningCharterService"
$Action = New-ScheduledTaskAction -Execute "$NodePath" -Argument "`"$NextBin`" start -p $Port" -WorkingDirectory "$WorkDir"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -RunLevel Highest -User "NT AUTHORITY\SYSTEM" -Force | Out-Null

Write-Host "Starting background service..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3

Write-Host "Local Running Charter is now running in production on port $Port!" -ForegroundColor Green
Write-Host "Opening http://localhost:$Port in your browser..." -ForegroundColor Cyan
Start-Process "http://localhost:$Port"
