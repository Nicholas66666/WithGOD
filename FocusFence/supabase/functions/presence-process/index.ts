import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type PresenceTag = {
  name: string;
  category: "emotion" | "spiritualTheme" | "relationship" | "situation" | "content" | "action";
  confidence: number;
};

type WatchResponse = {
  eyebrow: string;
  headline: string;
  body: string;
  footnote: string;
  accent: "green" | "blue" | "gold" | "red" | "gray";
};

type PresenceDetail = {
  title: string;
  primaryText: string;
  scripture: string;
  prayer: string;
  action: string;
  question: string;
  answer: string;
  nextSteps: string[];
};

type PresenceAnalysis = {
  type: "turning" | "prayer" | "idea" | "bibleQuestion" | "generalQuestion" | "task" | "journal" | "unknown";
  summary: string;
  tags: PresenceTag[];
  watchResponse: WatchResponse;
  detail: PresenceDetail;
  responseMode: "silentSave" | "watchText" | "watchVoice" | "iphoneOnly";
};

type QuickPresenceAnalysis = {
  type: PresenceAnalysis["type"];
  summary: string;
  watchResponse: WatchResponse;
  responseMode: PresenceAnalysis["responseMode"];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-presence-client-token, x-presence-source, x-presence-local-record-id, x-presence-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["turning", "prayer", "idea", "bibleQuestion", "generalQuestion", "task", "journal", "unknown"]
    },
    summary: { type: "string" },
    tags: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          category: {
            type: "string",
            enum: ["emotion", "spiritualTheme", "relationship", "situation", "content", "action"]
          },
          confidence: { type: "number" }
        },
        required: ["name", "category", "confidence"]
      }
    },
    watchResponse: {
      type: "object",
      additionalProperties: false,
      properties: {
        eyebrow: { type: "string", minLength: 4, maxLength: 8 },
        headline: { type: "string", minLength: 2, maxLength: 6 },
        body: { type: "string", minLength: 10, maxLength: 28 },
        footnote: { type: "string", minLength: 3, maxLength: 10 },
        accent: { type: "string", enum: ["green", "blue", "gold", "red", "gray"] }
      },
      required: ["eyebrow", "headline", "body", "footnote", "accent"]
    },
    detail: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        primaryText: { type: "string" },
        scripture: { type: "string" },
        prayer: { type: "string" },
        action: { type: "string" },
        question: { type: "string" },
        answer: { type: "string" },
        nextSteps: { type: "array", items: { type: "string" } }
      },
      required: ["title", "primaryText", "scripture", "prayer", "action", "question", "answer", "nextSteps"]
    },
    responseMode: { type: "string", enum: ["silentSave", "watchText", "watchVoice", "iphoneOnly"] }
  },
  required: ["type", "summary", "tags", "watchResponse", "detail", "responseMode"]
};

const quickResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["turning", "prayer", "idea", "bibleQuestion", "generalQuestion", "task", "journal", "unknown"]
    },
    summary: { type: "string" },
    watchResponse: {
      type: "object",
      additionalProperties: false,
      properties: {
        eyebrow: { type: "string", minLength: 4, maxLength: 8 },
        headline: { type: "string", minLength: 2, maxLength: 6 },
        body: { type: "string", minLength: 10, maxLength: 28 },
        footnote: { type: "string", minLength: 3, maxLength: 10 },
        accent: { type: "string", enum: ["green", "blue", "gold", "red", "gray"] }
      },
      required: ["eyebrow", "headline", "body", "footnote", "accent"]
    },
    responseMode: { type: "string", enum: ["silentSave", "watchText", "watchVoice", "iphoneOnly"] }
  },
  required: ["type", "summary", "watchResponse", "responseMode"]
};

Deno.serve(async (request) => {
  if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
    return handleRealtimeSocket(request);
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return json({
        ok: true,
        openaiConfigured: Boolean(requiredEnv("OPENAI_API_KEY", false)),
        supabaseConfigured: Boolean(requiredEnv("SUPABASE_URL", false) && supabaseAdminKey(false))
      });
    }

    if (request.method === "GET") {
      authorizeClient(request);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const records = await listRecords(limit);
      return json({ records });
    }

    if (request.method !== "POST") {
      return json({ error: "not_found" }, 404);
    }

    authorizeClient(request);

    const audio = new Uint8Array(await request.arrayBuffer());
    if (audio.byteLength === 0) {
      return json({ error: "empty_audio" }, 400);
    }

    const contentType = request.headers.get("content-type") || "audio/mp4";
    const source = request.headers.get("x-presence-source") || "unknown";
    const localRecordID = request.headers.get("x-presence-local-record-id");
    const requestID = request.headers.get("x-presence-request-id") || crypto.randomUUID();
    const realtimeDiagnostic = (request.headers.get("x-presence-realtime-diagnostic") || "").trim();
    const durationSeconds = parseDurationSeconds(request.headers.get("x-presence-duration-seconds"));
    const recordID = isUUID(localRecordID) ? localRecordID! : crypto.randomUUID();
    const supabase = supabaseAdmin();
    const audioPath = `${recordID}/recording-${Date.now()}.${audioFileExtension(contentType)}`;
    const timing: ProcessingTiming = { received_at_ms: startedAt };
    if (realtimeDiagnostic) {
      timing.watch_realtime_error = realtimeDiagnostic.slice(0, 900);
    }

    let stageStartedAt = Date.now();
    await uploadObject(supabase, audioPath, audio, contentType);
    timing.upload_ms = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const audioResponseURL = await createSignedURL(supabase, audioPath, 24 * 60 * 60);
    timing.signed_url_ms = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const transcript = await transcribeAudio(audio, contentType);
    timing.transcription_ms = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const quick = await analyzeQuickWatchResponse(transcript);
    timing.quick_analysis_ms = Date.now() - stageStartedAt;
    const quickDetail = quickDetailFor(transcript, quick);

    const quickRecord = {
      id: recordID,
      source: "server",
      client_source: source,
      request_id: requestID,
      audio_path: audioPath,
      voice_path: null,
      duration_seconds: durationSeconds,
      transcript,
      type: quick.type,
      summary: quick.summary,
      tags: [],
      watch_response: quick.watchResponse,
      detail: quickDetail,
      response_mode: quick.responseMode,
      state: "ready",
      processing_ms: Date.now() - startedAt,
      processing_timing: timing
    };

    stageStartedAt = Date.now();
    const { error } = await supabase.from("presence_records").upsert(quickRecord, { onConflict: "id" });
    timing.quick_upsert_ms = Date.now() - stageStartedAt;
    timing.quick_total_ms = Date.now() - startedAt;
    quickRecord.processing_ms = timing.quick_total_ms;
    quickRecord.processing_timing = timing;
    if (error) {
      throw new Error(`record_upsert_failed: ${error.message}`);
    }

    runInBackground(finalizeFullRecord({
      supabase,
      recordID,
      source,
      requestID,
      audioPath,
      durationSeconds,
      transcript,
      quick,
      timing,
      startedAt
    }));

    return json({
      id: recordID,
      createdAt: new Date().toISOString(),
      transcript,
      source,
      ...quick,
      tags: [],
      detail: quickDetail,
      audioResponseURL,
      voiceResponseURL: null,
      durationSeconds,
      realtimeDiagnostic: timing.watch_realtime_error || "",
      timing
    });
  } catch (error) {
    console.error(error);
    return json({
      error: "presence_process_failed",
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

type ProcessingTiming = {
  received_at_ms: number;
  upload_ms?: number;
  signed_url_ms?: number;
  transcription_ms?: number;
  primary_analysis_ms?: number;
  primary_upsert_ms?: number;
  primary_total_ms?: number;
  quick_analysis_ms?: number;
  quick_upsert_ms?: number;
  quick_total_ms?: number;
  full_analysis_ms?: number;
  full_voice_ms?: number;
  full_upsert_ms?: number;
  full_total_ms?: number;
  watch_realtime_error?: string;
};

function handleRealtimeSocket(request: Request) {
  try {
    authorizeClient(request);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const { socket, response } = Deno.upgradeWebSocket(request);
  const startedAt = Date.now();
  const recordID = request.headers.get("x-presence-local-record-id") || crypto.randomUUID();
  let transcript = "";
  let realtimeResponseText = "";
  let sessionReady = false;
  let clientStopped = false;
  let didSendClientError = false;
  let didCreateRealtimeResponse = false;
  let didSendWatchResponse = false;
  const pendingAudio: Uint8Array[] = [];

  function sendRealtimeError(message: string, extra: Record<string, unknown> = {}) {
    if (didSendClientError) {
      return;
    }
    didSendClientError = true;
    try {
      socket.send(JSON.stringify({
        type: "error",
        message,
        ...extra
      }));
    } catch {
      // ignore closed socket
    }
  }

  function sendClientEvent(event: Record<string, unknown>) {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // ignore closed socket
    }
  }

  function commitAudioAndCreateResponse() {
    if (!sessionReady || didCreateRealtimeResponse) {
      return;
    }
    didCreateRealtimeResponse = true;
    openai.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    openai.send(JSON.stringify({
      type: "response.create",
      response: {
        output_modalities: ["text"],
        instructions: realtimeQuickInstructions(),
        max_output_tokens: 500
      }
    }));
    sendClientEvent({
      type: "response_create_sent",
      elapsed_ms: Date.now() - startedAt
    });
  }

  async function sendWatchResponse(quick: QuickPresenceAnalysis) {
    if (didSendWatchResponse) {
      return;
    }
    didSendWatchResponse = true;
    sendClientEvent({
      ...quick,
      type: "watch_response",
      id: recordID,
      transcript,
      timing: {
        total_ms: Date.now() - startedAt
      }
    });
    socket.close(1000, "done");
    openai.close(1000, "done");
  }

  const openai = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-realtime-2",
    [
      "realtime",
      `openai-insecure-api-key.${requiredEnv("OPENAI_API_KEY", true)}`
    ]
  );

  openai.onopen = () => {
    openai.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: realtimeQuickInstructions(),
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000
            },
            transcription: {
              model: "gpt-realtime-whisper",
              language: "zh",
              delay: "minimal"
            },
            turn_detection: null
          }
        }
      }
    }));
  };

  openai.onmessage = async (event) => {
    try {
      const message = JSON.parse(String(event.data));

      if (message.type === "session.updated") {
        sessionReady = true;
        sendClientEvent({
          type: "session_ready",
          elapsed_ms: Date.now() - startedAt
        });
        for (const chunk of pendingAudio.splice(0)) {
          appendRealtimeAudio(openai, chunk);
        }

        if (clientStopped) {
          commitAudioAndCreateResponse();
        }
      }

      if (message.type === "conversation.item.input_audio_transcription.delta" && message.delta) {
        transcript += message.delta;
        sendClientEvent({
          type: "transcript_delta",
          delta: message.delta,
          elapsed_ms: Date.now() - startedAt
        });
      }

      if (message.type === "conversation.item.input_audio_transcription.completed") {
        transcript = message.transcript || transcript;
        sendClientEvent({
          type: "transcript_completed",
          transcript,
          elapsed_ms: Date.now() - startedAt
        });
      }

      if (message.type === "response.output_text.delta" && message.delta) {
        realtimeResponseText += message.delta;
        sendClientEvent({
          type: "output_text_delta",
          delta: message.delta,
          elapsed_ms: Date.now() - startedAt
        });
      }

      if (message.type === "response.output_text.done" && message.text) {
        realtimeResponseText = message.text;
      }

      if (message.type === "response.done") {
        const doneText = extractRealtimeResponseText(message);
        if (doneText) {
          realtimeResponseText = doneText;
        }
        sendClientEvent({
          type: "response_done",
          status: message.response?.status || null,
          status_details: message.response?.status_details || null,
          output_text_length: realtimeResponseText.length,
          elapsed_ms: Date.now() - startedAt
        });
        let quick: QuickPresenceAnalysis;
        try {
          quick = parseQuickPresenceAnalysis(realtimeResponseText);
        } catch {
          quick = await analyzeQuickWatchResponse(transcript);
        }
        await sendWatchResponse(quick);
      }

      if (message.type === "error") {
        sendRealtimeError(message.error?.message || "realtime_error", {
          code: message.error?.code || null,
          event: message
        });
      }
    } catch (error) {
      sendRealtimeError(error instanceof Error ? error.message : String(error));
    }
  };

  openai.onerror = (event) => {
    sendRealtimeError("openai_realtime_error", {
      event: String(event)
    });
  };

  openai.onclose = (event) => {
    if (!didSendClientError && !sessionReady) {
      sendRealtimeError("openai_realtime_closed_before_session", {
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean
      });
    }
  };

  socket.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "stop") {
          clientStopped = true;
          if (sessionReady) {
            commitAudioAndCreateResponse();
          }
        }
      } catch {
        // ignore malformed control message
      }
      return;
    }

    const chunk = new Uint8Array(
      event.data instanceof ArrayBuffer
        ? event.data
        : await event.data.arrayBuffer()
    );

    if (sessionReady) {
      appendRealtimeAudio(openai, chunk);
    } else {
      pendingAudio.push(chunk);
    }
  };

  socket.onclose = () => {
    try {
      openai.close(1000, "client_closed");
    } catch {
      // ignore
    }
  };

  return response;
}

function appendRealtimeAudio(socket: WebSocket, chunk: Uint8Array) {
  socket.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: base64(chunk)
  }));
}

function quickResponseProductRules() {
  return [
    "Quick Response 是用户停止录音后 Watch 第一屏价值：不是摘要、不是流程提示，要让用户当下得到一点真实帮助。",
    "watchResponse 字段长度：eyebrow 4-8字，headline 2-6字，body 10-28字，footnote 3-10字；短到 Apple Watch 一眼读完。",
    "禁止流程话：已记下、正在整理、稍后查看、我会保存、完整整理、完整内容已保存。",
    "禁止长篇讲道；禁止审判、控告、定罪；不要冒充神、圣灵、耶稣直接对用户说话。",
    "安抚强情绪：焦虑、羞耻、创伤、怒气、委屈、孤独时，先稳住人，再给现实/属灵锚点，再给一个极小动作。",
    "危险/危机表达现实支持优先：自伤、自杀、伤人、家暴、被跟踪、严重创伤闪回时，不只给属灵安慰；body 必须指向立刻联系可信的人、当地急救或现实安全动作；accent=red。",
    "祷告/交托：像安静陪伴和确认，不总结待办；可指向交托、信靠、下一件忠心小事。",
    "不要把祷告改写成冥想、正念或心理技巧；用户向主祷告时，body 要保留祷告处境和属灵锚点。",
    "回转/自省/认罪：指向恩典、悔改和一个很小的当下行动，不加羞耻。",
    "关系冲突/怒气：先慢下来，保护言语和边界，再决定是否回应。",
    "灵感/待办/普通记录，不强行属灵化；不给经文，不写神/主/祷告/恩典/悔改，直接给最小下一步。",
    "高确定性经文池：焦虑/交托=腓 4:6 或 太 6:34；怒气/言语=雅 1:19 或 箴 15:1；认罪/赦免=约一 1:9 或 罗 8:1；决定/信靠=箴 3:5 或 箴 3:5-6；软弱/恩典=林后 12:9；惧怕=提后 1:7 或 诗 56:3；忍耐/爱=林前 13:4。",
    "经文出处只允许使用高确定性经文池；不确定就不要写出处，footnote 用小动作或状态，例如：现实支持、先求支持、想法种子、待办记录、可再展开。",
    "推荐结构：情绪/痛苦类 body 包含安抚 + 锚点 + 小动作中的至少两项；普通记录 body 包含可执行下一步。",
    "示例：焦虑祷告 => {\"eyebrow\":\"把心交托\",\"headline\":\"先交托\",\"body\":\"先把焦虑带到主前，慢慢呼吸三次。\",\"footnote\":\"腓 4:6\",\"accent\":\"blue\"}。",
    "示例：普通待办 => {\"eyebrow\":\"两个小事项\",\"headline\":\"先列清\",\"body\":\"八点打电话，路上顺手买牛奶。\",\"footnote\":\"待办记录\",\"accent\":\"gray\"}。",
    "默认 responseMode=watchText；只有用户明确要求语音回答才 watchVoice。"
  ];
}

function realtimeQuickInstructions() {
  return [
    "你是一个 Apple Watch 上的一键语音记录即时回应模型。",
    "听完用户的音频后，直接生成一屏手表回应 JSON。",
    "分类只能是：turning/prayer/idea/bibleQuestion/generalQuestion/task/journal/unknown。",
    ...quickResponseProductRules(),
    "如果音频无法识别，type=unknown，并温和要求用户再试一次。",
    "只输出严格 JSON，不要 markdown，不要解释，不要代码块。",
    `JSON schema: ${JSON.stringify(quickResponseSchema)}`
  ].join("\n");
}

function parseQuickPresenceAnalysis(text: string): QuickPresenceAnalysis {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!jsonText || !jsonText.startsWith("{") || !jsonText.endsWith("}")) {
    throw new Error("realtime_response_missing_json");
  }

  const parsed = JSON.parse(jsonText) as QuickPresenceAnalysis;
  if (!parsed.type || !parsed.summary || !parsed.watchResponse || !parsed.responseMode) {
    throw new Error("realtime_response_incomplete_json");
  }
  return parsed;
}

function extractRealtimeResponseText(message: Record<string, any>): string {
  const output = message.response?.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    if (typeof item?.text === "string") {
      parts.push(item.text);
    }
    if (typeof item?.content === "string") {
      parts.push(item.content);
    }
    if (Array.isArray(item?.content)) {
      for (const content of item.content) {
        if (typeof content?.text === "string") {
          parts.push(content.text);
        }
        if (typeof content?.transcript === "string") {
          parts.push(content.transcript);
        }
      }
    }
  }
  return parts.join("");
}

async function listRecords(limit: number) {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("presence_records")
    .select("id, created_at, audio_path, duration_seconds, transcript, type, summary, tags, watch_response, detail, response_mode, state, processing_ms, processing_timing")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`records_list_failed: ${error.message}`);
  }

  return await Promise.all((data || []).map(async (record) => {
    const audioResponseURL = record.audio_path
      ? await createSignedURL(supabase, record.audio_path, 24 * 60 * 60)
      : null;

    return {
      id: record.id,
      createdAt: new Date(record.created_at).toISOString(),
      transcript: record.transcript || "",
      source: "server",
      type: record.type,
      summary: record.summary || "",
      tags: record.tags || [],
      watchResponse: record.watch_response,
      detail: record.detail,
      responseMode: record.response_mode,
      state: record.state || "ready",
      durationSeconds: record.duration_seconds || null,
      processingMs: record.processing_ms || null,
      processingTiming: record.processing_timing || {},
      realtimeDiagnostic: record.processing_timing?.watch_realtime_error || "",
      audioFileName: record.audio_path ? record.audio_path.split("/").pop() : "server-recording.m4a",
      audioResponseURL
    };
  }));
}

function quickDetailFor(transcript: string, quick: QuickPresenceAnalysis): PresenceDetail {
  return {
    title: quick.watchResponse.headline || "已识别",
    primaryText: quick.summary || transcript,
    scripture: "",
    prayer: "",
    action: quick.watchResponse.body,
    question: quick.type === "bibleQuestion" || quick.type === "generalQuestion" ? transcript : "",
    answer: "",
    nextSteps: []
  };
}

async function finalizeFullRecord(params: {
  supabase: ReturnType<typeof createClient>;
  recordID: string;
  source: string;
  requestID: string;
  audioPath: string;
  durationSeconds: number | null;
  transcript: string;
  quick: QuickPresenceAnalysis;
  timing: ProcessingTiming;
  startedAt: number;
}) {
  const {
    supabase,
    recordID,
    source,
    requestID,
    audioPath,
    durationSeconds,
    transcript,
    quick,
    timing,
    startedAt
  } = params;

  try {
    let stageStartedAt = Date.now();
    const analysis = await analyzeTranscript(transcript);
    timing.full_analysis_ms = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const voicePath = analysis.responseMode === "watchVoice"
      ? await createVoiceResponse(supabase, recordID, analysis)
      : null;
    timing.full_voice_ms = Date.now() - stageStartedAt;

    const record = {
      id: recordID,
      source: "server",
      client_source: source,
      request_id: requestID,
      audio_path: audioPath,
      voice_path: voicePath,
      duration_seconds: durationSeconds,
      transcript,
      type: analysis.type,
      summary: analysis.summary,
      tags: analysis.tags,
      watch_response: analysis.watchResponse,
      detail: analysis.detail,
      response_mode: analysis.responseMode,
      state: "ready",
      processing_ms: Date.now() - startedAt,
      processing_timing: timing
    };

    stageStartedAt = Date.now();
    const { error } = await supabase.from("presence_records").upsert(record, { onConflict: "id" });
    timing.full_upsert_ms = Date.now() - stageStartedAt;
    timing.full_total_ms = Date.now() - startedAt;
    if (error) {
      throw new Error(`record_upsert_failed: ${error.message}`);
    }

    console.info("presence_timing", JSON.stringify({ recordID, ...timing }));
  } catch (error) {
    console.error("full_record_finalize_failed", error);
    const fallbackRecord = {
      id: recordID,
      source: "server",
      client_source: source,
      request_id: requestID,
      audio_path: audioPath,
      duration_seconds: durationSeconds,
      transcript,
      type: quick.type,
      summary: quick.summary,
      tags: [],
      watch_response: quick.watchResponse,
      detail: {
        ...quickDetailFor(transcript, quick),
        action: "即时回应已完成，但完整整理暂时失败，可以稍后重试。"
      },
      response_mode: quick.responseMode,
      state: "failed",
      processing_ms: Date.now() - startedAt,
      processing_timing: timing
    };
    await supabase.from("presence_records").upsert(fallbackRecord, { onConflict: "id" });
  }
}

function runInBackground(promise: Promise<unknown>) {
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return;
  }

  promise.catch((error) => {
    console.error("background_task_failed", error);
  });
}

function parseDurationSeconds(value: string | null) {
  const duration = Number(value || "");
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return Math.round(duration * 10) / 10;
}

function authorizeClient(request: Request) {
  const expected = requiredEnv("PRESENCE_CLIENT_TOKEN", false);
  if (!expected) {
    return;
  }

  const actual = request.headers.get("x-presence-client-token");
  if (actual !== expected) {
    throw new Error("unauthorized_client");
  }
}

function supabaseAdmin() {
  return createClient(
    requiredEnv("SUPABASE_URL", true),
    supabaseAdminKey(true),
    { auth: { persistSession: false } }
  );
}

async function uploadObject(supabase: ReturnType<typeof createClient>, path: string, body: Uint8Array, contentType: string) {
  const { error } = await supabase.storage
    .from("presence-audio")
    .upload(path, body, {
      contentType,
      upsert: true
    });

  if (error) {
    throw new Error(`audio_upload_failed: ${error.message}`);
  }
}

async function createSignedURL(supabase: ReturnType<typeof createClient>, path: string, expiresIn: number) {
  const { data, error } = await supabase.storage
    .from("presence-audio")
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`signed_url_failed: ${error.message}`);
  }

  return data.signedUrl;
}

async function transcribeAudio(audio: Uint8Array, contentType: string) {
  const form = new FormData();
  form.append("model", requiredEnv("OPENAI_TRANSCRIPTION_MODEL", false) || "gpt-4o-transcribe");
  form.append("language", "zh");
  form.append("file", new Blob([audio], { type: contentType }), audioFileName(contentType));

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY", true)}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`transcription_failed ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.text || "";
}

async function analyzeTranscript(transcript: string): Promise<PresenceAnalysis> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY", true)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: requiredEnv("OPENAI_ANALYSIS_MODEL", false) || "gpt-5.5",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "你是一个基督徒个人记录助手，处理用户从 Apple Watch 一键录下的语音。",
                "你必须自动判断类型：回转/祷告/灵感/圣经问题/普通问答/待办/日志。",
                ...quickResponseProductRules(),
                "watchResponse.headline 必须是最核心的大字，不要写完整句子，优先用动词+对象或名词短语，例如：先安静、回到恩典、慢慢松手、继续追问、今天交托。",
                "watchResponse.body 尽量写成两到三个短分句，用中文逗号分开，适合拆成有大有小的词组。",
                "类型为回转：回应要把人带回神面前，body 优先引用一句可靠经文或经文原则，detail 必须包含经文、短祷告、一个小行动。",
                "类型为祷告：watchResponse 像安静陪伴和确认，detail 整理成祷告主题、可继续祷告的一句话。",
                "类型为灵感：watchResponse 不要属灵化过度，给一个极小的延伸动作，例如列成提纲、先保留种子、写一个最小版本。",
                "类型为圣经问题：如果用户没有要求语音回答，watchResponse 给一句简短方向；detail.answer 给谨慎回答，不确定不要编造。",
                "类型为普通问答：只有用户明确要求语音回答时 responseMode=watchVoice，否则 responseMode=watchText 或 iphoneOnly；answer 直接回答问题。",
                "类型为待办：watchResponse 给下一步，detail.nextSteps 拆成可执行事项。",
                "圣经引用必须保守，不确定时不要捏造章节；可以说需要进一步查考。"
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: transcript }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "presence_record_analysis",
          strict: true,
          schema: responseSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`analysis_failed ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content || [])
    .find((content: { type: string; text?: string }) => content.type === "output_text")?.text;

  if (!text) {
    throw new Error("analysis_missing_output_text");
  }

  return JSON.parse(text);
}

async function analyzeQuickWatchResponse(transcript: string): Promise<QuickPresenceAnalysis> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY", true)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: requiredEnv("OPENAI_FAST_ANALYSIS_MODEL", false)
        || "gpt-4.1-nano",
      max_output_tokens: 220,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "生成 Apple Watch 一屏即时回应，必须只回应用户刚说的内容。",
              "分类：turning/prayer/idea/bibleQuestion/generalQuestion/task/journal/unknown。",
              ...quickResponseProductRules(),
              "只输出合法 JSON；不要解释，不要 markdown。"
            ].join("\n")
          }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: transcript || "用户录下一段空白或无法识别的语音。" }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "quick_watch_response",
          strict: true,
          schema: quickResponseSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`quick_analysis_failed ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content || [])
    .find((content: { type: string; text?: string }) => content.type === "output_text")?.text;

  if (!text) {
    throw new Error("quick_analysis_missing_output_text");
  }

  return JSON.parse(text);
}

async function createVoiceResponse(supabase: ReturnType<typeof createClient>, recordID: string, analysis: PresenceAnalysis) {
  const speechText = [
    analysis.detail.answer,
    analysis.watchResponse.body,
    analysis.detail.action
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 260);

  if (!speechText) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY", true)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: requiredEnv("OPENAI_SPEECH_MODEL", false) || "gpt-4o-tts",
      voice: requiredEnv("OPENAI_SPEECH_VOICE", false) || "alloy",
      input: speechText,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    throw new Error(`speech_failed ${response.status}: ${await response.text()}`);
  }

  const path = `${recordID}/voice-${Date.now()}.mp3`;
  await uploadObject(
    supabase,
    path,
    new Uint8Array(await response.arrayBuffer()),
    "audio/mpeg"
  );

  return path;
}

function requiredEnv(name: string, required: true): string;
function requiredEnv(name: string, required: false): string | undefined;
function requiredEnv(name: string, required: boolean) {
  const value = Deno.env.get(name);
  if (required && !value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

function supabaseAdminKey(required: true): string;
function supabaseAdminKey(required: false): string | undefined;
function supabaseAdminKey(required: boolean) {
  const value = Deno.env.get("PRESENCE_SUPABASE_SECRET_KEY")
    || Deno.env.get("SUPABASE_SECRET_KEY")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (required && !value) {
    throw new Error("missing_env:PRESENCE_SUPABASE_SECRET_KEY");
  }
  return value;
}

function isUUID(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function audioFileName(contentType: string) {
  if (contentType.includes("wav")) {
    return "recording.wav";
  }
  if (contentType.includes("aiff") || contentType.includes("aif")) {
    return "recording.aiff";
  }
  if (contentType.includes("mpeg")) {
    return "recording.mp3";
  }
  return "recording.m4a";
}

function audioFileExtension(contentType: string) {
  if (contentType.includes("wav")) {
    return "wav";
  }
  if (contentType.includes("aiff") || contentType.includes("aif")) {
    return "aiff";
  }
  if (contentType.includes("mpeg")) {
    return "mp3";
  }
  if (contentType.includes("aac")) {
    return "aac";
  }
  return "m4a";
}

function base64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
