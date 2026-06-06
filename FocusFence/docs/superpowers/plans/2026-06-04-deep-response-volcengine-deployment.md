# Deep Response Volcengine Test Deployment

日期：2026-06-04

目的：把 DeepResponse dedicated Node server 从 Render 迁移到火山 ECS 测试环境，验证靠近火山/豆包 provider 后的首响改善。

## Current Endpoint

```text
http://124.174.96.149:8797
```

Health:

```bash
curl -s http://124.174.96.149:8797/health
```

Expected:

```json
{"ok":true,"service":"deep-response","mode":"provider","providerConfigured":true}
```

## Resources

- Region: `cn-beijing`
- Zone: `cn-beijing-a`
- VPC: `vpc-2f8f58w0r2zgg4f4pzyvq1rpw`
- Route table: `vtb-2f8f58xzs71fk4f4pzyhhyuqj`
- Subnet: `subnet-1c197y7hkhu685e8j71rmq8vd`
- Security group: `sg-2f8f59lo5jp4w4f4pzyq8cq72`
- ECS: `i-yenp6zqgao4c5qvvn50z`
- Instance type: `ecs.g4i.large`，2 vCPU / 8 GiB
- Image: `image-z0dpqndnmy8rpzcad9rz`，Ubuntu 24.04 with OpenClaw 64 bit
- EIP allocation: `eip-33mkxq8awna4g1kl2anva1fr7`
- EIP address: `124.174.96.149`
- EIP billing: post-paid by bandwidth
- EIP bandwidth: `5Mbps`

Security group inbound rules added:

- TCP `22` from `0.0.0.0/0` for SSH debug
- TCP `80` from `0.0.0.0/0` for future HTTP reverse proxy
- TCP `443` from `0.0.0.0/0` for future HTTPS reverse proxy
- TCP `8797` from `0.0.0.0/0` for current DeepResponse HTTP server

## Local-Only Files

These are intentionally ignored by Git:

- `.env.local`
- `.volcengine/drs-test-key`
- `.volcengine/drs-test-key.pub`
- `.volcengine/drs-test-password.txt`

Do not print or commit secrets from these files.

## Deployment

The ECS currently runs:

```text
/opt/deep-response/repo/FocusFence
```

Git branch:

```text
codex/deep-response-lab
```

Systemd service:

```bash
deep-response.service
```

Service command:

```bash
npm run deep:server:provider
```

Default local deploy command:

```bash
npm run deep:volc:deploy
```

The script deploys the current `codex/deep-response-lab` branch from GitHub on the ECS, restarts `deep-response.service`, then checks `/health`. It must either return JSON with `ok: true` or fail with a clear missing-key/SSH/service/health error.

Useful SSH diagnostics:

```bash
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 'systemctl status deep-response --no-pager'
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 'journalctl -u deep-response -n 100 --no-pager'
```

Manual redeploy from the latest pushed branch:

```bash
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 '
  cd /opt/deep-response/repo &&
  sudo git fetch origin codex/deep-response-lab &&
  sudo git reset --hard origin/codex/deep-response-lab &&
  cd FocusFence &&
  sudo systemctl restart deep-response &&
  systemctl is-active deep-response
'
```

## Verification

Default verification gate:

```bash
npm run deep:provider:check
npm run deep:volc:deploy
curl -s http://124.174.96.149:8797/health
npm run deep:volc:smoke:full
npm run deep:volc:conversation:full
npm run deep:watchlab:build:volc
npm run deep:lab:selftest
npm run test:node
```

Underlying smoke command:

```bash
npm run deep:http-smoke:test -- \
  --endpoint http://124.174.96.149:8797 \
  --pcm /private/tmp/deep-response-http-speed.pcm \
  --turns 2 \
  --chunk-ms 1000 \
  --upload-sleep-ms 1000 \
  --poll-ms 50 \
  --timeout-ms 120000 \
  --observe-ms 3000 \
  --max-stop-to-first-audio-ms 3000
```

Latest passing result after increasing EIP bandwidth to 5Mbps:

- health: `200`
- turn 1 stop-to-first-audio: `448ms`
- turn 2 stop-to-first-audio: `454ms`
- turn 1 provider total: `7833ms`
- turn 2 provider total: `8179ms`
- abort stale audio chunks: `0`
- abort stale audio bytes: `0`

Latest passing smoke on 2026-06-06 after deploying `7deca61`:

- health: `200`
- turn 1 stop-to-first-audio: `195ms`
- turn 2 stop-to-first-audio: `200ms`
- abort stale audio chunks: `0`
- abort stale audio bytes: `0`
- failures: `[]`

Latest passing conversation on 2026-06-06:

- turns: `8/8`
- stop-to-first-audio range: `171ms-237ms`
- p50: about `188ms`
- p90: below `250ms`
- all forbidden/repeated/latency/audio-order failure arrays: `[]`

Render comparison from previous baseline:

- Render stop-to-first-audio was about `1682ms` / `1993ms`.
- Fire-and-smoke baseline on Volcengine is about `4x` faster for stop-to-first-audio in the script harness.

## Render Rollback

Render is no longer the default deploy, test, WatchLab build, or self-test path. Keep it only as an explicit rollback while Volcengine remains the main endpoint.

Rollback scripts:

```bash
npm run deep:rollback:render:sync-env
npm run deep:rollback:render:deploy
```

If rollback is used, pass the Render endpoint explicitly to ad hoc tests or builds. Do not change package defaults, WatchLab fallback, or self-test defaults back to Render unless Volcengine is unavailable and the rollback decision is recorded.

## Current Issues

- Instance cloud-init initially failed because GitHub clone from inside the ECS had a transient TLS interruption. Manual retry succeeded.
- No HTTPS/domain is configured yet. Current Watch endpoint would be plain HTTP by IP.
- Security group currently exposes SSH from the internet for speed of testing. Tighten this before production.
- The service is process-managed by systemd only; no Nginx/Caddy, TLS, deploy hook, or log shipping yet.

## Next Steps

1. Keep `npm run deep:volc:deploy` as the default deploy entrypoint.
2. Keep DeepLab build and self-test defaults pointed at `http://124.174.96.149:8797`.
3. Use the default verification gate above before claiming the Volcengine path is healthy.
4. Add HTTPS/domain before any broader TestFlight or product integration.
5. Keep Render only as an explicit rollback path.
