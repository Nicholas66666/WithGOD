# 火山引擎部署脚手架

## Day 1 推荐形态

Day 1 使用现有火山引擎 ECS 实例和零依赖 Node 静态服务。

这样可以让公网 demo 保持简单：

- Node 负责提供看板和处理后数据。
- systemd 负责服务生命周期。
- 第一版公网 demo 使用端口 `8798`，避免影响 `8797` 上的现有 DeepResponse 服务。
- 域名和 HTTPS 准备好后，再加入 Docker Compose 和 Caddy。
- SEMrush 和看板脚本后续可从仓库或定时任务运行。

## 所需环境变量

在本机或 ECS 主机设置这些变量。不要提交真实值。

```bash
export VOLCENGINE_ACCESS_KEY_ID=...
export VOLCENGINE_SECRET_ACCESS_KEY=...
export VOLCENGINE_REGION=...
export LAUNCH_OS_PUBLIC_HOST=launch.example.com
export LAUNCH_OS_PUBLIC_EMAIL=ops@example.com
```

## 手动 ECS 设置

1. 在配置好的火山引擎区域创建小型 ECS 实例。
2. 放行入站端口 `80` 和 `443`。
3. 在实例上安装 Node.js 22+。
4. 将本仓库 clone 或复制到 `/opt/launch-os`。
5. 在本地或主机上构建看板状态：

```bash
node launch-os/scripts/dashboard/build-dashboard-state.mjs
```

6. 启动公网看板：

```bash
sudo cp launch-os/infra/volcengine/systemd/launch-os.service /etc/systemd/system/launch-os.service
sudo systemctl daemon-reload
sudo systemctl enable --now launch-os
```

## DNS

将选定域名指向 ECS 公网 IP。域名准备好后，用 Caddy 或其他反向代理把 HTTPS 接到 `8798`。

## 回滚

```bash
cd /opt/launch-os
git log --oneline -5
git checkout <known-good-sha>
node launch-os/scripts/dashboard/build-dashboard-state.mjs
sudo systemctl restart launch-os
```

## 安全说明

- 不要在脚本里打印火山引擎 AK/SK。
- 不要提交 `.env.local`。
- SSH 访问限制在可信 key 范围内。
- 如果任何密钥意外暴露，立即轮换。
