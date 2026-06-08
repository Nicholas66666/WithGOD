# 操作记录：Launch OS 启动

## 摘要

创建第一版 Launch OS 项目系统，完成公网部署，并提交 Day 1 实现。

## 资源

- 复用现有火山引擎 ECS 实例 `drs-test-ecs`。
- 复用现有 EIP `124.174.96.149`。
- 新增 systemd 服务 `launch-os`。
- 新增零依赖 Node 静态服务，监听端口 `8798`。
- 为安全组新增一条 `tcp/8798`、来源 `0.0.0.0/0` 的入站规则。
- 没有改动现有 `8797` 端口上的 DeepResponse 服务。
- 没有新建 ECS 服务器。
- 没有在 ECS 上安装 Docker。
- 没有提交云服务或 API 密钥。

## 成本

这次操作没有新建服务器。公网看板目前运行在已经存在的后付费火山引擎 ECS 实例 `ecs.g4i.large` 和 5 Mbps EIP 上。Launch OS 复用现有实例时增量成本预计很低，但实际云账单必须以火山引擎账单控制台为准，因为后付费 ECS、带宽、存储和流量都是账户级计费项。

## 验证

- `npm run test:node` passed with 301 tests.
- `npm run launch:verify` passed with 5 Launch OS tests.
- `curl http://124.174.96.149:8798/` returned HTTP 200.
- `curl http://124.174.96.149:8798/data/processed/dashboard-state.json` returned dashboard JSON.
- `systemctl is-active launch-os` returned `active`.
