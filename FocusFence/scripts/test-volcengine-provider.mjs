import crypto from "node:crypto";
import fs from "node:fs";
import tls from "node:tls";
import zlib from "node:zlib";

const rootEnv = loadEnv(".env.local");
const supabaseEnv = loadEnv("supabase/.env.local");
const env = { ...rootEnv, ...supabaseEnv };

const checks = [];

function loadEnv(path) {
  if (!fs.existsSync(path)) {
    return {};
  }
  const out = {};
  for (const rawLine of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mark(name, ok, detail) {
  checks.push({ name, ok, detail });
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${name}${detail ? ` - ${detail}` : ""}`);
}

function info(name, detail) {
  console.log(`INFO ${name}${detail ? ` - ${detail}` : ""}`);
}

function requireEnv(name) {
  const value = env[name]?.trim();
  const ok = Boolean(value) && !/YOUR_|ark_YOUR|sk-\.\.\./.test(value);
  mark(`env ${name}`, ok, ok ? "set" : "missing or placeholder");
  return ok ? value : "";
}

function compareEnv(name) {
  const a = rootEnv[name]?.trim();
  const b = supabaseEnv[name]?.trim();
  if (!a || !b) {
    mark(`env consistency ${name}`, false, "missing in one file");
    return;
  }
  mark(`env consistency ${name}`, a === b, a === b ? "matches" : "differs between .env.local files");
}

async function testArk() {
  const apiKey = requireEnv("ARK_API_KEY");
  const baseURL = env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = env.ARK_MODEL || "doubao-seed-2-0-lite-260215";
  if (!apiKey) {
    return;
  }

  try {
    const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复 OK" }],
        max_tokens: 8,
        temperature: 0
      })
    });
    const text = await response.text();
    const detail = response.ok
      ? `status ${response.status}`
      : `status ${response.status}: ${redactError(text)}`;
    mark("ark chat completion", response.ok, detail);
  } catch (error) {
    mark("ark chat completion", false, error.message);
  }
}

async function websocketHandshake(name, wsURL, headers) {
  if (!wsURL) {
    mark(name, false, "missing URL");
    return;
  }

  const url = new URL(wsURL);
  const key = crypto.randomBytes(16).toString("base64");
  const requestHeaders = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    ...Object.entries(headers).map(([header, value]) => `${header}: ${value}`),
    "",
    ""
  ].join("\r\n");

  await new Promise((resolve) => {
    const socket = tls.connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      timeout: 10_000
    });

    let buffer = "";
    let done = false;

    function finish(ok, detail) {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      mark(name, ok, detail);
      resolve();
    }

    socket.on("secureConnect", () => {
      socket.write(requestHeaders);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\r\n\r\n")) {
        return;
      }
      const statusLine = buffer.split("\r\n", 1)[0] || "";
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/);
      const status = match ? Number(match[1]) : 0;
      const logid = buffer.match(/\r\nX-Tt-Logid:\s*([^\r\n]+)/i)?.[1] || "";
      finish(status === 101, `status ${status || "unknown"}${logid ? `, logid ${logid}` : ""}`);
    });
    socket.on("timeout", () => finish(false, "timeout"));
    socket.on("error", (error) => finish(false, error.message));
    socket.on("end", () => {
      if (!done) {
        finish(false, "connection ended before handshake response");
      }
    });
  });
}

function buildWebSocketFrame(payload) {
  const length = payload.length;
  const parts = [Buffer.from([0x82])];
  if (length < 126) {
    parts.push(Buffer.from([0x80 | length]));
  } else if (length < 65536) {
    const header = Buffer.alloc(3);
    header[0] = 0x80 | 126;
    header.writeUInt16BE(length, 1);
    parts.push(header);
  } else {
    const header = Buffer.alloc(9);
    header[0] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 1);
    parts.push(header);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  parts.push(mask, masked);
  return Buffer.concat(parts);
}

function tryReadWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("websocket frame too large");
    }
    length = Number(big);
    offset = 10;
  }
  const masked = Boolean(buffer[1] & 0x80);
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }
  return { opcode: buffer[0] & 0x0f, payload };
}

function volcHeader(messageType, flags = 0, serialMethod = 1, compressionType = 1) {
  return Buffer.from([
    0x11,
    (messageType << 4) | flags,
    (serialMethod << 4) | compressionType,
    0x00
  ]);
}

function buildVolcASRInitRequest() {
  const payload = zlib.gzipSync(Buffer.from(JSON.stringify({
    app: {
      appid: env.DOUBAO_SPEECH_APP_ID,
      cluster: env.DOUBAO_ASR_CLUSTER || "volcengine_input_common",
      token: env.DOUBAO_SPEECH_ACCESS_TOKEN
    },
    user: { uid: "focusfence-api-test" },
    request: {
      reqid: crypto.randomUUID(),
      workflow: "audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate",
      show_utterances: true,
      result_type: "single",
      sequence: 1,
      end_window_size: Number(env.DOUBAO_ASR_END_WINDOW_SIZE_MS || 800)
    },
    audio: {
      format: env.DOUBAO_ASR_AUDIO_FORMAT || "pcm",
      codec: env.DOUBAO_ASR_AUDIO_CODEC || "raw",
      rate: Number(env.DOUBAO_ASR_SAMPLE_RATE || 16000),
      bits: Number(env.DOUBAO_ASR_AUDIO_BITS || 16),
      channel: Number(env.DOUBAO_ASR_AUDIO_CHANNELS || 1),
      sample_rate: Number(env.DOUBAO_ASR_SAMPLE_RATE || 16000)
    }
  })));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  return Buffer.concat([volcHeader(0x01), length, payload]);
}

function parseVolcResponse(payload) {
  if (payload.length < 12) {
    return { ok: false, detail: `short response ${payload.length} bytes` };
  }
  const messageType = payload[1] >> 4;
  if (messageType === 0x0f) {
    const code = payload.length >= 8 ? payload.readUInt32BE(4) : 0;
    const msg = payload.length >= 12 ? payload.subarray(12).toString("utf8") : "";
    return { ok: false, detail: `server error ${code}${msg ? `: ${redactError(msg)}` : ""}` };
  }
  for (const offset of [4, 8, 12]) {
    const body = payload.subarray(offset).toString("utf8");
    try {
      const data = JSON.parse(body);
      const code = data.code ?? data.payload_msg?.code;
      return {
        ok: code === undefined || code === 1000,
        detail: `code ${code ?? "none"}, offset ${offset}, keys ${Object.keys(data).slice(0, 8).join(",")}`
      };
    } catch {
      // Try the next known response layout.
    }
  }
  return { ok: false, detail: `unparseable response: ${redactError(payload.toString("utf8"))}` };
}

async function testASRInitRequest() {
  const appID = env.DOUBAO_SPEECH_APP_ID?.trim();
  const accessToken = env.DOUBAO_SPEECH_ACCESS_TOKEN?.trim();
  if (!appID || !accessToken) return;

  const url = new URL(env.DOUBAO_ASR_WS_URL);
  const key = crypto.randomBytes(16).toString("base64");
  const headers = {
    "X-Api-App-Key": appID,
    "X-Api-Access-Key": accessToken,
    "X-Api-Resource-Id": env.DOUBAO_ASR_RESOURCE_ID || "volc.bigasr.sauc.duration",
    "X-Api-Connect-Id": crypto.randomUUID()
  };
  const requestHeaders = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    ...Object.entries(headers).map(([header, value]) => `${header}: ${value}`),
    "",
    ""
  ].join("\r\n");

  await new Promise((resolve) => {
    const socket = tls.connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      timeout: 10_000
    });
    let handshake = Buffer.alloc(0);
    let frames = Buffer.alloc(0);
    let upgraded = false;
    let done = false;

    function finish(ok, detail) {
      if (done) return;
      done = true;
      socket.destroy();
      mark("doubao asr init request", ok, detail);
      resolve();
    }

    socket.on("secureConnect", () => socket.write(requestHeaders));
    socket.on("data", (chunk) => {
      if (!upgraded) {
        handshake = Buffer.concat([handshake, chunk]);
        const marker = handshake.indexOf("\r\n\r\n");
        if (marker === -1) return;
        const headerText = handshake.subarray(0, marker).toString("utf8");
        const status = Number(headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] || 0);
        if (status !== 101) {
          finish(false, `handshake status ${status || "unknown"}`);
          return;
        }
        upgraded = true;
        frames = handshake.subarray(marker + 4);
        socket.write(buildWebSocketFrame(buildVolcASRInitRequest()));
      } else {
        frames = Buffer.concat([frames, chunk]);
      }

      const frame = tryReadWebSocketFrame(frames);
      if (!frame) return;
      if (frame.opcode === 0x8) {
        finish(false, "server closed after init request");
        return;
      }
      const parsed = parseVolcResponse(frame.payload);
      finish(parsed.ok, parsed.detail);
    });
    socket.on("timeout", () => finish(false, "timeout"));
    socket.on("error", (error) => finish(false, error.message));
    socket.on("end", () => {
      if (!done) finish(false, "connection ended before init response");
    });
  });
}

async function testSpeechWebSockets() {
  const appID = requireEnv("DOUBAO_SPEECH_APP_ID");
  const accessToken = requireEnv("DOUBAO_SPEECH_ACCESS_TOKEN");
  const speechAPIKey = env.DOUBAO_SPEECH_API_KEY?.trim() || "";
  const asrResourceID = env.DOUBAO_ASR_RESOURCE_ID || "volc.bigasr.sauc.duration";
  const ttsResourceID = env.DOUBAO_TTS_RESOURCE_ID || "volc.service_type.10029";
  const common = appID && accessToken ? {
    "X-Api-App-Key": appID,
    "X-Api-Access-Key": accessToken
  } : null;

  if (!common) {
    return;
  }

  await websocketHandshake("doubao asr websocket handshake", env.DOUBAO_ASR_WS_URL, {
    ...common,
    "X-Api-Resource-Id": asrResourceID,
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  await websocketHandshake("doubao asr websocket handshake non-async variant", "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel", {
    ...common,
    "X-Api-Resource-Id": asrResourceID,
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  await websocketHandshake("doubao asr websocket handshake 1.0 resource variant", env.DOUBAO_ASR_WS_URL, {
    ...common,
    "X-Api-Resource-Id": "volc.bigasr.sauc.duration",
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  await websocketHandshake("doubao tts websocket handshake", env.DOUBAO_TTS_WS_URL, {
    ...common,
    "X-Api-Resource-Id": ttsResourceID,
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  await websocketHandshake("doubao tts websocket handshake app-id header variant", env.DOUBAO_TTS_WS_URL, {
    "X-Api-App-Id": appID,
    "X-Api-Access-Key": accessToken,
    "X-Api-Resource-Id": ttsResourceID,
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  await websocketHandshake("doubao tts websocket handshake legacy resource variant", env.DOUBAO_TTS_WS_URL, {
    ...common,
    "X-Api-Resource-Id": "volc.service_type.10029",
    "X-Api-Connect-Id": crypto.randomUUID()
  });

  if (speechAPIKey && !/YOUR_/.test(speechAPIKey)) {
    const before = checks.length;
    await websocketHandshake("doubao tts websocket handshake api-key variant", env.DOUBAO_TTS_WS_URL, {
      "X-Api-Key": speechAPIKey,
      "X-Api-Resource-Id": ttsResourceID,
      "X-Api-Connect-Id": crypto.randomUUID()
    });
    const optional = checks.splice(before, checks.length - before)[0];
    info("optional api-key variant", optional.ok ? optional.detail : `${optional.detail}; not used by default POC path`);
  } else {
    info("optional api-key variant", "skipped because DOUBAO_SPEECH_API_KEY is empty");
  }
}

async function testTTSHTTP() {
  const appID = env.DOUBAO_SPEECH_APP_ID?.trim();
  const accessToken = env.DOUBAO_SPEECH_ACCESS_TOKEN?.trim();
  const voice = env.DOUBAO_TTS_SPEAKER_ID?.trim() || "zh_male_shaonianzixin_moon_bigtts";
  if (!appID || !accessToken) {
    return;
  }
  try {
    const response = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer;${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app: {
          appid: appID,
          token: accessToken,
          cluster: "volcano_tts"
        },
        user: {
          uid: "focusfence-api-test"
        },
        audio: {
          voice_type: voice,
          encoding: "mp3",
          speed_ratio: 1.0,
          volume_ratio: 1.0,
          pitch_ratio: 1.0
        },
        request: {
          reqid: crypto.randomUUID(),
          text: "测试",
          operation: "query"
        }
      })
    });
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Keep response text redacted below.
    }
    const ok = response.ok && data.code === 3000 && Boolean(data.data);
    mark("doubao tts http synthesis", ok, ok
      ? `status ${response.status}, code ${data.code}, audio_base64_chars ${String(data.data).length}`
      : `status ${response.status}: ${redactError(text)}`);
  } catch (error) {
    mark("doubao tts http synthesis", false, error.message);
  }
}

function redactError(text) {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(/(api[_-]?key["':\s]+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 500);
}

compareEnv("ARK_API_KEY");
compareEnv("DOUBAO_SPEECH_APP_ID");
compareEnv("DOUBAO_SPEECH_ACCESS_TOKEN");
await testArk();
await testSpeechWebSockets();
await testASRInitRequest();
await testTTSHTTP();

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`FAILED ${failed.length}/${checks.length} checks`);
  process.exit(1);
}

console.log(`PASSED ${checks.length}/${checks.length} checks`);
