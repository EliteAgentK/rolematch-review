#!/usr/bin/env bash
# Creates RoleMatch's server in Azure, Johannesburg (South Africa North). Run by the owner in Azure Cloud Shell (the >_ button at the top of the portal,
# choose Bash), after the startup credits show as a subscription and a budget alert is set (docs/architecture/PLAN_MOVE_OFF_THE_PC.md):
#   bash azure-create-server.sh
# One server, 2 processors and 8 GB (owner, 12 Nov 2026: "while in development ... just a live server and database"), a 128 GB fast disk, and only SSH
# open, by key. Claude's deploy key is the only key; no password is set, so nothing here is a secret. Prints the server's address at the end.
set -euo pipefail
RG="${RG:-rolematch}"; LOC="${LOC:-southafricanorth}"; NAME="${NAME:-rolematch-live}"; SIZE="${SIZE:-Standard_D2s_v5}"
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH07TQygLoU2fZsw7u4A6NjsQoKdm6KDxu2ongFTOUde rolematch-cloud-deploy'

# The startup credits are a sponsored subscription (its quota id starts "Sponsored"); anything else would be charged to the card.
SUB=$(az account show --query name -o tsv); QUOTA=$(az account show --query subscriptionPolicies.quotaId -o tsv)
echo "Subscription: $SUB ($QUOTA)"
case "$QUOTA" in Sponsored*|*Sponsor*) ;; *)
  echo "This subscription does not look like the startup credits (Azure Sponsorship). Stopping, so nothing is charged to a card by mistake."
  echo "Switch to the credits first:  az account set --subscription \"<its name>\"   (or run with FORCE=1 if this is right)"; [ "${FORCE:-0}" = 1 ] || exit 1;;
esac
az group create -n "$RG" -l "$LOC" -o none
az vm create -g "$RG" -n "$NAME" -l "$LOC" --image Canonical:ubuntu-24_04-lts:server:latest --size "$SIZE" \
  --admin-username rolematch --ssh-key-values "$KEY" --authentication-type ssh \
  --os-disk-size-gb 128 --storage-sku Premium_LRS --public-ip-sku Standard --nsg-rule SSH -o none
IP=$(az vm show -d -g "$RG" -n "$NAME" --query publicIps -o tsv)
echo "Done. Server $NAME in $LOC, size $SIZE, address $IP"
echo "Send Claude this address. Nothing else is needed from this window."
