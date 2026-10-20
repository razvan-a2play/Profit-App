# Registers a Windows Scheduled Task that pings the FBA Fee Auditor's
# notification check endpoint every morning at 08:00 local time. The endpoint
# does nothing if no enabled rule breaches its threshold, so it's safe to run
# unconditionally. Run this script ONCE in PowerShell as your normal user (no
# admin needed for user-level tasks).

$taskName = "FBA Fee Auditor - Daily Notification Check"
$url = "http://localhost:3002/api/notifications/check"

# Delete any prior version of the task so re-running this script upgrades it.
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop } catch {}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"try { Invoke-WebRequest -Uri '$url' -Method POST -UseBasicParsing -TimeoutSec 120 | Out-Null } catch { }`""

$trigger = New-ScheduledTaskTrigger -Daily -At 8am

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::FromMinutes(5))

Register-ScheduledTask `
    -TaskName $taskName `
    -Description "FBA Fee Auditor: daily 08:00 stranded-inventory alert check." `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings | Out-Null

Write-Host ""
Write-Host "Registered: '$taskName' at 08:00 daily." -ForegroundColor Green
Write-Host "URL: $url"
Write-Host ""
Write-Host "Manage in Task Scheduler (taskschd.msc)."
Write-Host "To remove: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
