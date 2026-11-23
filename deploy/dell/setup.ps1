# Prepares the Dell as a test machine, once, in PowerShell run as administrator. A separate standard user, SSH from the local network only with one key and no password, no sleep on mains, WSL installed.
# The Dell is never part of the public service, and holds invented documents only. To remove access, delete C:\ProgramData\ssh\rolematch_authorized_keys.
$pw = Read-Host "Choose a password for the new rolematch user (not for Claude)" -AsSecureString
New-LocalUser rolematch -Password $pw -FullName "RoleMatch test" -PasswordNeverExpires
Add-LocalGroupMember -Group Users -Member rolematch
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic; Start-Service sshd
$keys = "$env:ProgramData\ssh\rolematch_authorized_keys"
Set-Content $keys "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIlXXIrPD92XJ6Gj7/87cPZpmoAruWF8AXykD1UuEx/5 rolematch-dell-test" -Encoding ascii
icacls $keys /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" /grant "rolematch:R"
$conf = "$env:ProgramData\ssh\sshd_config"
$body = Get-Content $conf -Raw
Set-Content $conf ("AllowUsers rolematch`r`n" + $body + "`r`nMatch User rolematch`r`n  AuthorizedKeysFile __PROGRAMDATA__/ssh/rolematch_authorized_keys`r`n  PasswordAuthentication no`r`n") -Encoding ascii
Restart-Service sshd
Set-NetFirewallRule -Name OpenSSH-Server-In-TCP -RemoteAddress LocalSubnet -Profile Any
powercfg /change standby-timeout-ac 0
wsl --install --no-distribution
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object IPAddress
