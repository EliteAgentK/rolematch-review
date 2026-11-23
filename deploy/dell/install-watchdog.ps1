# Installs the RoleMatch watchdog and keep-alive on the Dell, once, in PowerShell run as administrator (the limited rolematch account may not restart the WSL
# service or the PC, which is what the incident of 10 Nov 2026 needed):
#   powershell -ExecutionPolicy Bypass -File install-watchdog.ps1           install or update (safe to run again)
#   powershell -ExecutionPolicy Bypass -File install-watchdog.ps1 -Remove   remove everything it added
# What it adds: C:\ProgramData\RoleMatch (scripts only administrators can change; logs the rolematch account can read; one folder Linux writes its
# heartbeat to), a key that can only hold Linux open, added to rolematch_authorized_keys with that one command forced, and two tasks run by SYSTEM:
# "RoleMatch Watchdog" every minute and "RoleMatch KeepAlive" at startup. See watchdog.ps1 for what the watchdog may do and when.
param([switch]$Remove, [int]$Port = 18787)
$ErrorActionPreference = "Stop"
$root = "C:\ProgramData\RoleMatch"; $keys = "C:\ProgramData\ssh\rolematch_authorized_keys"; $tag = "rolematch-pc-keepalive"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this in PowerShell opened with 'Run as administrator'."
}

foreach ($t in "RoleMatch Watchdog", "RoleMatch KeepAlive") {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -Confirm:$false }
}
if (Test-Path $keys) { $kept = Get-Content $keys | Where-Object { $_ -notmatch [regex]::Escape($tag) }; Set-Content $keys $kept -Encoding ascii }
if ($Remove) {
  if (Test-Path $root) { Remove-Item $root -Recurse -Force }
  "Removed the RoleMatch watchdog, keep-alive, their key and $root."; exit 0
}

# Folders and who may do what. SYSTEM must never run anything the rolematch account can change.
foreach ($d in "", "bin", "logs", "linux") { New-Item -ItemType Directory -Force (Join-Path $root $d) | Out-Null }
icacls $root /inheritance:r /grant "SYSTEM:(OI)(CI)F" /grant "Administrators:(OI)(CI)F" | Out-Null
icacls "$root\bin" /grant "rolematch:(OI)(CI)RX" | Out-Null
icacls "$root\logs" /grant "rolematch:(OI)(CI)RX" | Out-Null
icacls "$root\linux" /grant "rolematch:(OI)(CI)M" | Out-Null
icacls $root /grant "rolematch:RX" | Out-Null   # this folder itself only, to reach logs and linux
Copy-Item (Join-Path $PSScriptRoot "watchdog.ps1"), (Join-Path $PSScriptRoot "keepalive.ps1") "$root\bin" -Force
@{ Port = $Port; MissesBeforeAction = 5; HeartbeatStaleSeconds = 180; GraceMinutes = 6; RebootGapMinutes = 60; BootGraceMinutes = 10 } | ConvertTo-Json | Set-Content "$root\watchdog.json"
icacls "$root\watchdog.json" /grant "rolematch:R" | Out-Null

# The keep-alive key: readable by SYSTEM and administrators only; on the server side it may run one command and nothing else.
if (-not (Test-Path "$root\keepalive_key")) { & "$env:windir\System32\OpenSSH\ssh-keygen.exe" -q -t ed25519 -N '""' -C $tag -f "$root\keepalive_key" | Out-Null }
icacls "$root\keepalive_key" /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
# SYSTEM uses the key, so SYSTEM must own it: made by the administrator running this, it belonged to them, and SSH refuses a key another account owns
# (12 Nov 2026: every keep-alive session was dropped while signing in, "Connection reset by authenticating user rolematch [preauth]").
icacls "$root\keepalive_key" /setowner SYSTEM | Out-Null
# ssh-keygen also gave the administrator who made it their own entry on the key, which /inheritance:r keeps; SSH ignores a key anyone but SYSTEM and
# Administrators may read (12 Nov 2026, keepalive-failure.log: "Bad permissions. Try removing permissions for user: ...\<the owner's account>"), so it is removed.
icacls "$root\keepalive_key" /remove:g "$env:USERDOMAIN\$env:USERNAME" | Out-Null
$pub = (Get-Content "$root\keepalive_key.pub" -Raw).Trim()
Add-Content $keys ('restrict,command="wsl -d RoleMatch -u root -- sleep infinity" ' + $pub) -Encoding ascii

$run = { param($file) New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$root\bin\$file`"" }
$system = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$everyMinute = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "RoleMatch Watchdog" -Action (& $run "watchdog.ps1") -Trigger $everyMinute -Principal $system -Description "Restarts WSL, then the PC, when the RoleMatch Linux stops answering. deploy/dell/watchdog.ps1" `
  -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) | Out-Null
Register-ScheduledTask -TaskName "RoleMatch KeepAlive" -Action (& $run "keepalive.ps1") -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $system -Description "Holds the RoleMatch Linux open. deploy/dell/keepalive.ps1" `
  -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) | Out-Null
Start-ScheduledTask -TaskName "RoleMatch KeepAlive"

"Installed. Watchdog runs every minute from $((Get-Date).AddMinutes(1).ToString('HH:mm')); keep-alive started."
"Logs: $root\logs (watchdog.log, keepalive.log). To remove: run this again with -Remove."
