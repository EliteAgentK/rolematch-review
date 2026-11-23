# Keeps the RoleMatch Linux (WSL) running on the Dell, from the Dell itself: before 10 Nov 2026 only the Mac held it open (deploy/mac/com.rolematch.pc-keepalive.plist),
# so live depended on the Mac being awake and on the network. Runs as SYSTEM at startup (install-watchdog.ps1) and holds one session open through the limited
# rolematch account, over SSH to this PC, with a key that may do nothing else (its line in rolematch_authorized_keys forces this one command). When the session
# ends, it waits 10 seconds and opens it again; each end is logged. The Mac's keep-alive may stay: two sessions hold Linux open as well as one.
param([string]$Root = "C:\ProgramData\RoleMatch")
$log = Join-Path $Root "logs\keepalive.log"; $key = Join-Path $Root "keepalive_key"; $known = Join-Path $Root "known_hosts"
while ($true) {
  $started = Get-Date
  # -v: when a session fails at once, SSH's own account of why is kept (12 Nov 2026: it failed every 10 s and the reason had been thrown away). The last
  # lines only, written to keepalive-failure.log, which the rolematch account can read; they hold host names and the key's file name, never the key itself.
  $said = & "$env:windir\System32\OpenSSH\ssh.exe" -v -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$known" `
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 rolematch@127.0.0.1 "wsl -d RoleMatch -u root -- sleep infinity" 2>&1 | Select-Object -Last 30
  $code = $LASTEXITCODE
  if (((Get-Date) - $started).TotalSeconds -lt 5) { Set-Content (Join-Path $Root "logs\keepalive-failure.log") (@("at $((Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')) exit $code") + ($said | ForEach-Object { "$_" })) }
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.old" -Force }
  Add-Content $log ("{0} session ended after {1:N0} s (exit {2}); opening again in 10 s" -f (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz"), ((Get-Date) - $started).TotalSeconds, $code)
  Start-Sleep 10
}
