#!/usr/bin/env bash
# Prepares a new Ubuntu 24.04 cloud server (Azure or AWS) to run live exactly as the PC's RoleMatch Linux does (docs/architecture/PLAN_MOVE_OFF_THE_PC.md):
# the same folders (/srv/rolematch, /etc/rolematch), Docker, and nothing reachable from the internet but SSH with a key. Live is reached only through the
# Cloudflare tunnel, which makes outgoing connections, so no web port is ever opened. Owner, 12 Nov 2026: "all the updates, the backups ... we'll do
# ourselves": security updates install by themselves every night; everything else stays ours. Run once as root; safe to run again.
#   sudo bash prepare-server.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
. /etc/os-release; [ "${ID:-}" = ubuntu ] && [ "${VERSION_ID%%.*}" -ge 24 ] || { echo "Made for Ubuntu 24.04 or later; this is ${PRETTY_NAME:-unknown}."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 git curl jq python3 postgresql-client unattended-upgrades ufw fail2ban cron
systemctl enable --now docker cron fail2ban

# Security updates by themselves, every night (restarts stay ours, at a quiet time).
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# The only way in from outside: SSH, by key only, never as root and never with a password.
sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/; s/^#?PermitRootLogin .*/PermitRootLogin no/; s/^#?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
grep -q '^PasswordAuthentication no' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config
systemctl reload ssh 2>/dev/null || systemctl reload sshd
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow 22/tcp >/dev/null; ufw --force enable >/dev/null

# Containers' logs kept small (a full disk stops a database).
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || { echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' > /etc/docker/daemon.json; systemctl restart docker; }

# A little swap, so a brief memory peak slows the server rather than stopping a process.
if [ ! -f /swapfile ]; then fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

# The same places as on the PC, so every deploy script runs unchanged.
install -d -m 755 /srv/rolematch /srv/rolematch/status /srv/build /srv/test
install -d -m 700 /srv/rolematch/backups /etc/rolematch
DEPLOY_USER="${SUDO_USER:-rolematch}"; id "$DEPLOY_USER" >/dev/null 2>&1 && usermod -aG docker "$DEPLOY_USER"

echo "Prepared: Docker $(docker --version | cut -d' ' -f3 | tr -d ,), firewall on (SSH only), security updates nightly, /srv/rolematch and /etc/rolematch ready."
echo "Next (docs/architecture/PLAN_MOVE_OFF_THE_PC.md, steps 3 and 4): copy the settings, start the database pair and the tunnel at next.rolematch.co.za, copy live, check."
