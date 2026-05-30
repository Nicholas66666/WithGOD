# 与神同在 Supabase 生产服务端

## 架构

- Apple Watch / iPhone 只调用一个 HTTPS Edge Function。
- Edge Function 接收音频，保存到私有 Supabase Storage bucket `presence-audio`。
- Edge Function 调 OpenAI 完成转写、分类、标签、一屏回应和可选语音回应。
- 整理结果写入 `public.presence_records`。
- 默认不会语音回应；只有用户明确要求语音回答时，函数才生成临时语音文件并返回 signed URL。

## 需要提供的参数

把下面内容放到 `supabase/.env.local`，不要提交到 git：

```bash
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_ACCESS_TOKEN=sbp_YOUR_SUPABASE_ACCESS_TOKEN
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SB_SECRET_KEY
PRESENCE_SUPABASE_SECRET_KEY=不用手填，部署脚本会从 SUPABASE_SECRET_KEY 复制
SUPABASE_DB_PASSWORD=YOUR_DATABASE_PASSWORD
OPENAI_API_KEY=sk-...
PRESENCE_CLIENT_TOKEN=一串足够长的随机字符串
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_ANALYSIS_MODEL=gpt-5.5
OPENAI_SPEECH_MODEL=gpt-4o-tts
OPENAI_SPEECH_VOICE=alloy
```

iPhone / Watch 端还需要两个构建配置：

```bash
PRESENCE_PROCESS_ENDPOINT=https://YOUR_PROJECT_REF.functions.supabase.co/presence-process
PRESENCE_CLIENT_TOKEN=同上
```

## 部署

```bash
npm run presence:supabase:deploy
```

部署后检查：

```bash
curl https://YOUR_PROJECT_REF.functions.supabase.co/presence-process/health
```

应该看到：

```json
{"ok":true,"openaiConfigured":true,"supabaseConfigured":true}
```
