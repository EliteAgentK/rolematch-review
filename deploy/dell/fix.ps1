# Repairs a part-finished Dell setup, in PowerShell run as administrator. Safe to run again. Asks for nothing: the rolematch user gets a long random password nobody ever sees, and is reached only by the SSH key.
$ErrorActionPreference = "Continue"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host ""
  Write-Host "=== THIS WINDOW IS NOT RUNNING AS ADMINISTRATOR. Nothing was changed. ===" -ForegroundColor Yellow
  Write-Host "Close it. Click Start, type powershell, right-click Windows PowerShell, choose Run as administrator, click Yes, and run this again."
  return
}
Write-Host "Running as administrator: yes"
cmd /c "net user rolematch >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  $chars = (48..57) + (65..90) + (97..122)
  $pw = "aA1" + (-join ($chars | Get-Random -Count 28 | ForEach-Object { [char]$_ }))
  cmd /c "net user rolematch $pw /add /y /fullname:`"RoleMatch test`" /expires:never"
  Remove-Variable pw
}
cmd /c "net localgroup Users rolematch /add >nul 2>&1"
try { $u = [ADSI]"WinNT://./rolematch,user"; $u.UserFlags.value = $u.UserFlags.value -bor 0x10000; $u.SetInfo() } catch { Write-Host "Could not stop the password expiring: $_" }
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
  Write-Host "Installing OpenSSH. This can take several minutes."
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
}
Set-Service sshd -StartupType Automatic
Start-Service sshd
$keys = "$env:ProgramData\ssh\rolematch_authorized_keys"
Set-Content $keys "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIlXXIrPD92XJ6Gj7/87cPZpmoAruWF8AXykD1UuEx/5 rolematch-dell-test" -Encoding ascii
icacls $keys /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" /grant "rolematch:R" > $null
$conf = "$env:ProgramData\ssh\sshd_config"
$body = Get-Content $conf -Raw
if ($body -notmatch "AllowUsers rolematch") {
  Set-Content $conf ("AllowUsers rolematch`r`n" + $body + "`r`nMatch User rolematch`r`n  AuthorizedKeysFile __PROGRAMDATA__/ssh/rolematch_authorized_keys`r`n  PasswordAuthentication no`r`n") -Encoding ascii
}
Restart-Service sshd
if (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name OpenSSH-Server-In-TCP -Enabled True -Action Allow -RemoteAddress LocalSubnet -Profile Any
} else {
  New-NetFirewallRule -Name OpenSSH-Server-In-TCP -DisplayName "OpenSSH Server" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -RemoteAddress LocalSubnet -Profile Any > $null
}
powercfg /change standby-timeout-ac 0
cmd /c "net user rolematch >nul 2>&1"
$userOk = $LASTEXITCODE -eq 0
$sshOk = (Get-Service sshd -ErrorAction SilentlyContinue).Status -eq "Running"
Write-Host ""
Write-Host "=== RESULT ==="
Write-Host ("rolematch user: " + $userOk)
Write-Host ("SSH service: " + (Get-Service sshd -ErrorAction SilentlyContinue).Status)
Write-Host ("Firewall rule on: " + (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue).Enabled)
Write-Host ("Virtualisation on: " + (Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled)
if ($userOk -and $sshOk) { Write-Host "=== Ready. Tell Claude: done ===" } else { Write-Host "=== NOT finished. Tell Claude these lines ===" }
