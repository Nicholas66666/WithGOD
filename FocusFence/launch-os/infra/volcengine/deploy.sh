#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  VOLCENGINE_ACCESS_KEY_ID
  VOLCENGINE_SECRET_ACCESS_KEY
  VOLCENGINE_REGION
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
done

echo "Launch OS deploy scaffold"
echo "Region: ${VOLCENGINE_REGION}"
echo "Secrets: loaded from environment and not printed"
echo
echo "Run on the ECS host after syncing the repo to /opt/launch-os:"
echo "  sudo cp launch-os/infra/volcengine/systemd/launch-os.service /etc/systemd/system/launch-os.service"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now launch-os"
