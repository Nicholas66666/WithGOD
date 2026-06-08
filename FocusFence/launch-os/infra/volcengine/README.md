# Volcengine Deployment Scaffold

## Recommended Day 1 Shape

Use the existing Volcengine ECS instance with a zero-dependency Node static server for Day 1.

This keeps the public demo simple:

- Node serves the dashboard and processed data.
- systemd owns service lifecycle.
- The first public demo uses port `8798` to avoid disturbing the existing DeepResponse service on `8797`.
- Docker Compose and Caddy can be added later when a domain and HTTPS cutover are ready.
- SEMrush and dashboard scripts run from the repo or a scheduled job later.

## Required Environment Variables

Set these on your local machine or ECS host. Do not commit real values.

```bash
export VOLCENGINE_ACCESS_KEY_ID=...
export VOLCENGINE_SECRET_ACCESS_KEY=...
export VOLCENGINE_REGION=...
export LAUNCH_OS_PUBLIC_HOST=launch.example.com
export LAUNCH_OS_PUBLIC_EMAIL=ops@example.com
```

## Manual ECS Setup

1. Create a small ECS instance in the configured Volcengine region.
2. Allow inbound ports `80` and `443`.
3. Install Node.js 22+ on the instance.
4. Clone or copy this repository to `/opt/launch-os`.
5. Build dashboard state locally or on the host:

```bash
node launch-os/scripts/dashboard/build-dashboard-state.mjs
```

6. Start the public dashboard:

```bash
sudo cp launch-os/infra/volcengine/systemd/launch-os.service /etc/systemd/system/launch-os.service
sudo systemctl daemon-reload
sudo systemctl enable --now launch-os
```

## DNS

Point the selected domain to the ECS public IP. After the domain is ready, put Caddy or another reverse proxy in front of port `8798` for HTTPS.

## Rollback

```bash
cd /opt/launch-os
git log --oneline -5
git checkout <known-good-sha>
node launch-os/scripts/dashboard/build-dashboard-state.mjs
sudo systemctl restart launch-os
```

## Security Notes

- Do not print Volcengine AK/SK in scripts.
- Do not commit `.env.local`.
- Keep SSH access limited to trusted keys.
- Rotate keys if any secret is accidentally exposed.
