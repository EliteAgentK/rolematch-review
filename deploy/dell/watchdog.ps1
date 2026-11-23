# RoleMatch watchdog on the Dell (incident 10 Nov 2026: Windows powered off the RoleMatch Linux at 04:59, the forced stop jammed the WSL service, and live
# stayed down until someone restarted the PC at 06:08; every watcher ran inside the Linux that had stopped). Runs every minute as SYSTEM, from
# C:\ProgramData\RoleMatch\bin, where only administrators can change it (install-watchdog.ps1). The limited rolematch account can read its log.
#
# It acts only when Linux itself is gone: the API does not answer on this PC AND Linux's heartbeat (a cron line writing the time to
# C:\ProgramData\RoleMatch\linux\heartbeat every minute) is older than HeartbeatStaleSeconds. An API that is down while Linux is alive (a release, a bad
# image, a database outage) is logged and left to Docker and to people: restarting WSL or the PC would not fix it.
# Ladder, once MissesBeforeAction minutes in a row are missed: 1) restart the WSL service (the keep-alive task then starts Linux again), 2) if Linux is
# still gone after GraceMinutes, restart the PC: once per outage, and never within RebootGapMinutes of the last restart. Past that it only logs, once an
# hour: a person must look. The ladder starts again only after the API has answered.
#   -DryRun  decides and logs what it would do and takes no action; with -Root pointing at a test folder (its own watchdog.json, linux\heartbeat,
#            state and log) it rehearses the ladder without touching the real one.
param([switch]$DryRun, [string]$Root = "C:\ProgramData\RoleMatch")
$ErrorActionPreference = "Stop"
$conf = Get-Content (Join-Path $Root "watchdog.json") -Raw | ConvertFrom-Json
$logDir = Join-Path $Root "logs"; $log = Join-Path $logDir "watchdog.log"; $stateFile = Join-Path $logDir "watchdog-state.json"   # its lastRunAt shows it is running
$now = Get-Date

function Write-Log([string]$msg) {
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.old" -Force }
  Add-Content $log ("{0} {1}{2}" -f $now.ToString("yyyy-MM-ddTHH:mm:sszzz"), $(if ($DryRun) { "[dry run] " } else { "" }), $msg)
}
function Get-Time($v) { if ($v) { [datetime]::Parse($v) } else { [datetime]::MinValue } }

$state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
foreach ($k in "misses", "level") { if ($null -eq $state.$k) { $state | Add-Member $k 0 -Force } }
foreach ($k in "lastActionAt", "lastRebootAt", "lastNoticeAt", "appDownSince") { if ($null -eq $state.$k) { $state | Add-Member $k "" -Force } }
function Save-State { if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }; $state | Add-Member lastRunAt $now.ToString("o") -Force; $state | ConvertTo-Json | Set-Content $stateFile }

# Is the API answering on this PC? (/api/health touches nothing, not even the database.)
$apiOk = $false
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "http://127.0.0.1:$($conf.Port)/api/health"; $apiOk = $r.StatusCode -eq 200 -and $r.Content -match '"ok":\s*true' } catch { }
# Is Linux alive? Its heartbeat holds the Unix time it last wrote.
$beatAge = [double]::PositiveInfinity
$beatFile = Join-Path $Root "linux\heartbeat"
if (Test-Path $beatFile) { $t = 0L; if ([long]::TryParse((Get-Content $beatFile -Raw).Trim(), [ref]$t)) { $beatAge = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $t } }
$linuxOk = $beatAge -le $conf.HeartbeatStaleSeconds

if ($apiOk) {
  if ($state.misses -gt 0 -or $state.level -gt 0 -or $state.appDownSince) { Write-Log "healthy again (missed $($state.misses), ladder step $($state.level))" }
  $state.misses = 0; $state.level = 0; $state.appDownSince = ""; Save-State; exit 0
}
if ($linuxOk) {
  # Linux is alive; the app is not. Not ours to fix by restarting.
  if (-not $state.appDownSince) { $state.appDownSince = $now.ToString("o"); Write-Log "API not answering but Linux is alive (heartbeat $([int]$beatAge) s): no action, Docker and people handle this" }
  $state.misses = 0; Save-State; exit 0
}

# Just after Windows starts, Linux and the containers take a few minutes to come up: not a miss. (Milliseconds since boot, wrapping every 49.7 days.)
$upMinutes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([Environment]::TickCount), 0) / 60000
if ($upMinutes -lt $conf.BootGraceMinutes) { Save-State; exit 0 }

$state.misses++
$beat = if ([double]::IsInfinity($beatAge)) { "none" } else { "$([int]$beatAge) s old" }
Write-Log "Linux not answering: API down, heartbeat $beat (miss $($state.misses))"
if ($state.misses -lt $conf.MissesBeforeAction) { Save-State; exit 0 }
if ($now -lt (Get-Time $state.lastActionAt).AddMinutes($conf.GraceMinutes)) { Save-State; exit 0 }   # the last step is still taking effect

if ($state.level -lt 1) {
  Write-Log "step 1: restarting the WSL service"
  if (-not $DryRun) {
    $job = Start-Job { Restart-Service WSLService -Force }
    if (-not (Wait-Job $job -Timeout 90)) {
      Write-Log "the WSL service did not restart within 90 s: ending its processes"
      Get-Process wslservice, wsl, wslhost, wslrelay -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep 5; Start-Service WSLService -ErrorAction SilentlyContinue
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName "RoleMatch KeepAlive" -ErrorAction SilentlyContinue
  }
  $state.level = 1; $state.lastActionAt = $now.ToString("o"); Save-State; exit 0
}
if ($state.level -lt 2 -and $now -ge (Get-Time $state.lastRebootAt).AddMinutes($conf.RebootGapMinutes)) {
  Write-Log "step 2: Linux still gone $($conf.GraceMinutes) min after the WSL restart: restarting the PC"
  $state.level = 2; $state.lastActionAt = $now.ToString("o"); $state.lastRebootAt = $now.ToString("o"); Save-State
  if (-not $DryRun) { Restart-Computer -Force }
  exit 0
}
if ($now -ge (Get-Time $state.lastNoticeAt).AddMinutes(60)) { Write-Log "still down after every step it may take (one WSL restart and at most one PC restart per outage, none within $($conf.RebootGapMinutes) min of the last): a person must look"; $state.lastNoticeAt = $now.ToString("o") }
Save-State
