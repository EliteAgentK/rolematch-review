#!/usr/bin/env bash
# Prepares a new Ubuntu 24.04 server for RoleMatch, once, as the ubuntu user with sudo: Docker, the firewall, a safety swap file, the folders and the nightly jobs. Safe to run again.
set -euo pipefail
if ! command -v docker >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 git curl unattended-upgrades netfilter-persistent iptables-persistent
  sudo systemctl enable --now docker
fi
sudo usermod -aG docker "$USER"

# Oracle's Ubuntu image rejects everything but SSH in its own firewall, ahead of any rule added at the end. Open only web traffic, ahead of that rejection.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# A little swap so a brief memory peak slows the machine rather than killing a process.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo install -d -m 755 -o "$USER" /opt/rolematch /opt/rolematch/source
sudo install -d -m 700 /etc/rolematch /var/backups/rolematch
# The nightly backup, at 01:00 UTC.
echo '0 1 * * * root /opt/rolematch/backup.sh >> /var/log/rolematch-backup.log 2>&1' | sudo tee /etc/cron.d/rolematch-backup >/dev/null
echo "Server prepared."
