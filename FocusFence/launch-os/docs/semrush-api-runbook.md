# SEMrush API 操作手册

## 密钥设置

不要把 key 粘贴到会被提交的文件里。当前推荐放在：

```text
launch-os/.env.local
```

格式：

```text
SEMRUSH_API_KEY=...
```

脚本会自动读取 `launch-os/.env.local`。如果进程环境变量里已经有 `SEMRUSH_API_KEY`，则优先使用进程环境变量。

## 种子关键词

种子词簇存放在 `launch-os/config/seed-keywords.json`。

当前词簇：

- `anxiety-worry`
- `anger-reaction`
- `overwhelmed-peace`
- `conflict-relationships`

## 预览请求，不拉取数据

```bash
node launch-os/scripts/semrush/fetch-seed-keywords.mjs
```

这个命令只打印脱敏 API URL，不暴露 API key。

## 拉取单个关键词

```bash
node launch-os/scripts/semrush/fetch-keyword-overview.mjs --phrase="bible verses for anxiety"
```

原始 CSV 写入：

```text
launch-os/data/raw/semrush/
```

## 标准化

```bash
npm run launch:semrush:normalize
npm run launch:dashboard:build
npm run launch:verify
```

处理后的关键词行写入：

```text
launch-os/data/processed/semrush-keywords.json
```

## 分析问题

第一批数据拉取后必须回答：

- 哪些需求词簇在美国有真实搜索量？
- 哪些词的 CPC 足以说明有商业竞争？
- 哪些词更像纯免费内容意图，应该避免或谨慎处理？
- 第一批否定关键词应该是什么？
- 每个广告组应该对应什么类型的落地页？
