# Public Deployment: 2026-06-08

## Public URL

```text
http://124.174.96.149:8798/
```

## Server

- Provider: Volcengine ECS
- Instance: `drs-test-ecs`
- EIP: `124.174.96.149`
- Service: `launch-os`
- Port: `8798`
- Existing DeepResponse port `8797` was not changed.

## Deployment Shape

The Day 1 deployment uses a zero-dependency Node static server:

```text
/opt/launch-os/launch-os
  -> launch-os/scripts/server/static-server.mjs
  -> launch-os/dashboard/public
  -> launch-os/data/processed/dashboard-state.json
```

systemd service:

```text
/etc/systemd/system/launch-os.service
```

## Security Group Change

Added one ingress rule to security group `sg-2f8f59lo5jp4w4f4pzyq8cq72`:

```text
tcp 8798 0.0.0.0/0 accept Launch OS dashboard
```

This was required because requests to port `8798` did not reach the ECS before the rule was added. OS firewall was inactive and local `127.0.0.1:8798` worked before the security group change.

## Verification

Public HTML:

```bash
curl -sS -m 10 -i http://124.174.96.149:8798/ | head -40
```

Public dashboard data:

```bash
curl -sS -m 10 http://124.174.96.149:8798/data/processed/dashboard-state.json
```

Expected data includes:

```text
First real $149 US order for the Scripture companion wearable
decisions=3
daily=1
```

## Next Hardening

- Add a domain and HTTPS reverse proxy.
- Replace port-based public access with `https://<domain>/`.
- Add automated deployment once the launch branch is pushed to GitHub.
- Add SEMrush data refresh jobs after the API key is wired into the server environment.

