# 公网部署：2026-06-08

## 公网地址

```text
http://124.174.96.149:8798/
```

## 服务器

- 云服务商：火山引擎 ECS
- 实例：`drs-test-ecs`
- EIP：`124.174.96.149`
- 服务：`launch-os`
- 端口：`8798`
- 没有改动现有 DeepResponse 端口 `8797`。

## 部署形态

Day 1 部署使用零依赖 Node 静态服务：

```text
/opt/launch-os/launch-os
  -> launch-os/scripts/server/static-server.mjs
  -> launch-os/dashboard/public
  -> launch-os/data/processed/dashboard-state.json
```

systemd 服务：

```text
/etc/systemd/system/launch-os.service
```

## 安全组变更

为安全组 `sg-2f8f59lo5jp4w4f4pzyq8cq72` 新增一条入站规则：

```text
tcp 8798 0.0.0.0/0 accept Launch OS dashboard
```

新增规则前，公网请求无法到达 ECS 的 `8798` 端口。操作系统防火墙处于 inactive，且本机 `127.0.0.1:8798` 已经可用，因此问题定位为安全组入站限制。

## 验证

公网 HTML：

```bash
curl -sS -m 10 -i http://124.174.96.149:8798/ | head -40
```

公网看板数据：

```bash
curl -sS -m 10 http://124.174.96.149:8798/data/processed/dashboard-state.json
```

期望数据包含：

```text
拿到第一笔美国市场 $149 圣经智能手表真实订单
decisions=3
daily=1
```

## 后续加固

- 增加域名和 HTTPS 反向代理。
- 用 `https://<domain>/` 替代端口访问。
- 上线分支推送到 GitHub 后增加自动部署。
- SEMrush API key 接入服务端环境后，增加数据刷新任务。
