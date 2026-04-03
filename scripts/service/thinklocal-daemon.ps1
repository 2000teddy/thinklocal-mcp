# thinklocal-mcp Daemon — Windows Service Wrapper (via nssm oder als Task)
#
# Option 1: Als Scheduled Task (empfohlen, kein Admin noetig)
# Option 2: Als Windows-Service via nssm
#
# Nutzung:
#   .\thinklocal-daemon.ps1 install   — Task erstellen
#   .\thinklocal-daemon.ps1 start     — Daemon starten
#   .\thinklocal-daemon.ps1 stop      — Daemon stoppen
#   .\thinklocal-daemon.ps1 status    — Status pruefen
#   .\thinklocal-daemon.ps1 uninstall — Task entfernen

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("install", "start", "stop", "status", "uninstall")]
    [string]$Action
)

$TaskName = "thinklocal-daemon"
$InstallDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$TsxPath = Join-Path $InstallDir "packages\daemon\node_modules\.bin\tsx.cmd"
$EntryPoint = Join-Path $InstallDir "packages\daemon\src\index.ts"
$DataDir = Join-Path $env:USERPROFILE ".thinklocal"
$LogDir = Join-Path $DataDir "logs"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

switch ($Action) {
    "install" {
        $argString = "$TsxPath $EntryPoint"
        $trigger = New-ScheduledTaskTrigger -AtLogon
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $action = New-ScheduledTaskAction -Execute $NodePath -Argument $argString -WorkingDirectory $InstallDir
        Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings -Description "thinklocal-mcp Mesh Daemon" -Force
        Write-Host "Task '$TaskName' erstellt. Startet automatisch bei Anmeldung."
    }
    "start" {
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "Daemon gestartet."
    }
    "stop" {
        Stop-ScheduledTask -TaskName $TaskName
        Write-Host "Daemon gestoppt."
    }
    "status" {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $TaskName
            Write-Host "Status: $($task.State)"
            Write-Host "Letzte Ausfuehrung: $($info.LastRunTime)"
            Write-Host "Naechste Ausfuehrung: $($info.NextRunTime)"
            # Health-Check
            try {
                $response = Invoke-WebRequest -Uri "http://localhost:9440/health" -TimeoutSec 3 -ErrorAction Stop
                Write-Host "Health: OK ($($response.StatusCode))"
            } catch {
                Write-Host "Health: Nicht erreichbar"
            }
        } else {
            Write-Host "Task nicht installiert."
        }
    }
    "uninstall" {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' entfernt."
    }
}
