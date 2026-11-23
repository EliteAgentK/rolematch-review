#!/usr/bin/env bash
# Creates RoleMatch's server in AWS, Cape Town (af-south-1). Run by the owner in AWS CloudShell (the >_ button at the top of the console), after the
# Activate credits show under Billing > Credits and a budget alert is set (docs/architecture/PLAN_MOVE_OFF_THE_PC.md):
#   bash aws-create-server.sh
# One server, 2 processors and 8 GB (t3.large, with "standard" CPU credits so bursts never add charges), a 128 GB disk, and only SSH open, by key.
# Cape Town is a region AWS keeps off until it is switched on: this script switches it on and waits (a few minutes, once).
set -euo pipefail
export AWS_DEFAULT_REGION="${REGION:-af-south-1}"; NAME="${NAME:-rolematch-live}"; TYPE="${TYPE:-t3.large}"
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH07TQygLoU2fZsw7u4A6NjsQoKdm6KDxu2ongFTOUde rolematch-cloud-deploy'

status() { aws account get-region-opt-status --region-name "$AWS_DEFAULT_REGION" --query RegionOptStatus --output text --region us-east-1; }
case "$(status)" in
  ENABLED|ENABLED_BY_DEFAULT) ;;
  *) echo "Switching on $AWS_DEFAULT_REGION (once)..."; aws account enable-region --region-name "$AWS_DEFAULT_REGION" --region us-east-1 || true
     until [ "$(status)" = ENABLED ]; do sleep 20; echo "  still switching on..."; done;;
esac
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
aws ec2 describe-key-pairs --key-names rolematch-cloud >/dev/null 2>&1 || aws ec2 import-key-pair --key-name rolematch-cloud --public-key-material "$(printf '%s' "$KEY" | base64 -w0)" >/dev/null
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=rolematch-ssh --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
if [ -z "$SG" ] || [ "$SG" = None ]; then
  SG=$(aws ec2 create-security-group --group-name rolematch-ssh --description "RoleMatch: SSH only; live is reached through the Cloudflare tunnel" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr 0.0.0.0/0 >/dev/null
fi
ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --key-name rolematch-cloud --security-group-ids "$SG" \
  --credit-specification CpuCredits=standard --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=128,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "Done. Server $NAME ($ID) in $AWS_DEFAULT_REGION, type $TYPE, address $IP (the login user is ubuntu)"
echo "Send Claude this address. Nothing else is needed from this window."
