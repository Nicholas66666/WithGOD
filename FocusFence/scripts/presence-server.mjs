import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

loadLocalEnv();

const port = Number(process.env.PRESENCE_PORT || 8787);
const openAIKey = process.env.OPENAI_API_KEY || "";
const transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";
const analysisModel = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.5";
const speechModel = process.env.OPENAI_SPEECH_MODEL || "gpt-4o-tts";
const speechVoice = process.env.OPENAI_SPEECH_VOICE || "alloy";
const voiceResponses = new Map();

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
        eyebrow: { type: "string" },
        headline: { type: "string" },
        body: { type: "string" },
        footnote: { type: "string" },
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJSON(response, 200, {
        ok: true,
        openaiConfigured: Boolean(openAIKey),
        voiceResponses: voiceResponses.size
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/presence/voice/")) {
      const id = url.pathname.split("/").pop()?.replace(/\.mp3$/, "");
      const item = id ? voiceResponses.get(id) : undefined;
      if (!item || item.expiresAt < Date.now()) {
        if (id) {
          voiceResponses.delete(id);
        }
        sendJSON(response, 404, { error: "voice_response_not_found" });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store"
      });
      response.end(item.audio);
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/presence/process") {
      sendJSON(response, 404, { error: "not_found" });
      return;
    }

    const audio = await readBody(request);
    const source = request.headers["x-presence-source"] || "unknown";
    const localRecordID = request.headers["x-presence-local-record-id"];

    const transcript = openAIKey
      ? await transcribeAudio(audio, request.headers["content-type"] || "audio/mp4")
      : "服务端已收到录音，但本机尚未配置 OPENAI_API_KEY，暂时无法真实转写。";

    const analysis = openAIKey
      ? await analyzeTranscript(transcript)
      : fallbackAnalysis(transcript);
    const voiceResponseURL = openAIKey && analysis.responseMode === "watchVoice"
      ? await createVoiceResponseURL(analysis, request)
      : null;

    sendJSON(response, 200, {
      id: localRecordID || randomUUID(),
      createdAt: new Date().toISOString(),
      transcript,
      source,
      ...analysis,
      audioResponseURL: null,
      voiceResponseURL
    });
  } catch (error) {
    console.error(error);
    sendJSON(response, 500, {
      error: "presence_process_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Presence server listening on http://0.0.0.0:${port}`);
});

function loadLocalEnv() {
  const envPath = new URL("../.env.local", import.meta.url);
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function transcribeAudio(audio, contentType) {
  const form = new FormData();
  form.append("model", transcriptionModel);
  form.append("language", "zh");
  form.append("file", new Blob([audio], { type: contentType }), "recording.m4a");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`transcription_failed ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.text || "";
}

async function analyzeTranscript(transcript) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAIKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: analysisModel,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "你是一个基督徒个人记录助手，帮助用户处理 Apple Watch 上的一键语音记录。",
                "你必须自动判断类型：回转/祷告/灵感/圣经问题/普通问答/待办/日志。",
                "默认绝不允许语音回应；只有用户明确说“语音回答/用声音告诉我/直接说出来”时 responseMode 才能是 watchVoice。",
                "watchResponse 必须能在 Apple Watch 一屏展示：eyebrow <= 8字，headline <= 8字，body <= 28字，footnote <= 8字。",
                "回转类回应要简洁、有智慧、指向神，优先给经文、祷告和一个非常小的行动。",
                "圣经引用要保守，不确定时不要捏造章节；可用常见可靠经文。"
              ].join("\\n")
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
  const text = data.output?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;

  if (!text) {
    throw new Error("analysis_missing_output_text");
  }

  return JSON.parse(text);
}

async function createVoiceResponseURL(analysis, request) {
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
      Authorization: `Bearer ${openAIKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: speechModel,
      voice: speechVoice,
      input: speechText,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    throw new Error(`speech_failed ${response.status}: ${await response.text()}`);
  }

  const id = randomUUID();
  const audio = Buffer.from(await response.arrayBuffer());
  voiceResponses.set(id, {
    audio,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  pruneExpiredVoiceResponses();

  const host = request.headers.host || `127.0.0.1:${port}`;
  return `http://${host}/presence/voice/${id}.mp3`;
}

function pruneExpiredVoiceResponses() {
  const now = Date.now();
  for (const [id, item] of voiceResponses) {
    if (item.expiresAt < now) {
      voiceResponses.delete(id);
    }
  }
}

function fallbackAnalysis(transcript) {
  return {
    type: "unknown",
    summary: "服务端已收到录音，但还没有接入 OpenAI 转写和分析。",
    tags: [
      { name: "待配置", category: "action", confidence: 1 }
    ],
    watchResponse: {
      eyebrow: "已收到",
      headline: "还未接入AI",
      body: "先保存这次记录，配置密钥后会真实整理。",
      footnote: "已进服务端",
      accent: "gray"
    },
    detail: {
      title: "服务端待配置",
      primaryText: "录音已经到达服务端，但 OPENAI_API_KEY 尚未配置。",
      scripture: "",
      prayer: "",
      action: "在本机设置 OPENAI_API_KEY 后重新启动服务端。",
      question: "",
      answer: "",
      nextSteps: ["配置 OPENAI_API_KEY", "重启 npm run presence:server", "重新录一条测试"]
    },
    responseMode: "watchText"
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJSON(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
