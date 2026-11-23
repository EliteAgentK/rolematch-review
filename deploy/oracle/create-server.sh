#!/usr/bin/env bash
# Keeps asking Oracle for the free ARM server until it has capacity, in Oracle's Cloud Shell (already signed in, nothing to install). Only ever asks for the Always Free shape in the home region.
# Sets up the network once, with only ports 22, 80 and 443 open. Stops as soon as a server exists; safe to start again. OCPUS and MEMORY can be lowered for a smaller free server, which can be grown later.
set -u
C="$OCI_TENANCY"; NAME=rolematch-live; OCPUS="${OCPUS:-2}"; MEMORY="${MEMORY:-12}"; WAIT="${WAIT:-120}"
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINIZnwgwt+1dx8/uO62cP9hhh5GTRvd1Xm3dY+JASARe rolematch-staging-deploy'
q() { oci "$@" 2>/dev/null; }
existing() { q compute instance list -c "$C" --display-name "$NAME" --query 'data[?"lifecycle-state"!=`TERMINATED`].id | [0]' --raw-output; }
SUBNET=$(q network subnet list -c "$C" --query 'data[?"prohibit-public-ip-on-vnic"==`false`].id | [0]' --raw-output)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  VCN=$(q network vcn create -c "$C" --display-name rolematch-vcn --cidr-block 10.0.0.0/16 --wait-for-state AVAILABLE --query 'data.id' --raw-output)
  GW=$(q network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name rolematch-gw --wait-for-state AVAILABLE --query 'data.id' --raw-output)
  RT=$(q network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
  q network route-table update --rt-id "$RT" --force --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$GW\"}]" >/dev/null
  SUBNET=$(q network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name rolematch-public --wait-for-state AVAILABLE --query 'data.id' --raw-output)
fi
VCN=$(q network subnet get --subnet-id "$SUBNET" --query 'data."vcn-id"' --raw-output)
SL=$(q network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
rule() { echo "{\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":$1,\"max\":$1}}}"; }
q network security-list update --security-list-id "$SL" --force --ingress-security-rules "[$(rule 22),$(rule 80),$(rule 443)]" >/dev/null
AD=$(q iam availability-domain list -c "$C" --query 'data[0].name' --raw-output)
IMG=$(q compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version 24.04 --shape VM.Standard.A1.Flex --sort-by TIMECREATED --query 'data[0].id' --raw-output)
echo "network ready; image ${IMG: -8}; asking for $OCPUS OCPU, $MEMORY GB every $WAIT s"
printf '%s\n' "$KEY" > /tmp/rm.pub
n=0
while :; do
  n=$((n + 1)); ID=$(existing)
  if [ -n "$ID" ] && [ "$ID" != "null" ]; then break; fi
  OUT=$(oci compute instance launch -c "$C" --display-name "$NAME" --availability-domain "$AD" --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY}" --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true --boot-volume-size-in-gbs 100 --ssh-authorized-keys-file /tmp/rm.pub 2>&1)
  case "$OUT" in
    *'"lifecycle-state"'*) echo "CREATED on attempt $n"; ID=$(existing); break ;;
    *[Oo]ut\ of\ [Hh]ost\ [Cc]apacity*|*[Oo]ut\ of\ capacity*) echo "$(date -u +%H:%M) attempt $n: no capacity" ;;
    *TooManyRequests*) echo "$(date -u +%H:%M) attempt $n: asked too fast, slowing"; sleep "$WAIT" ;;
    *) echo "$(date -u +%H:%M) attempt $n: STOPPED, unexpected answer:"; echo "$OUT" | grep -E '"(code|message)"' | head -3; exit 1 ;;
  esac
  sleep "$WAIT"
done
for _ in $(seq 1 30); do IP=$(q compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output); [ -n "$IP" ] && [ "$IP" != "null" ] && break; sleep 10; done
echo "SERVER READY: $NAME public IP $IP"
