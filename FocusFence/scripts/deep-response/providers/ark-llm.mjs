export class ArkLLMProvider {
  constructor({ env, clock = performance.now.bind(performance) }) {
    this.env = env;
    this.clock = clock;
  }

  async generate({
    transcript,
    context = [],
    signal,
    streamFull = false,
    maxTokens = 180,
    minChars = 14,
    model,
    baseURL,
    temperature,
    messages,
    firstPhraseExtractor = findSpeakableFirstPhrase
  } = {}) {
    let text = "";
    let firstPhrase = "";
    let first80Chars = "";
    let streamChunkCount = 0;
    const streamChunks = [];
    let timing = {};

    for await (const event of this.streamTokens({
      transcript,
      context,
      signal,
      maxTokens,
      model,
      baseURL,
      temperature,
      messages
    })) {
      if (event.type === "done") {
        timing = event.timing || timing;
        streamChunkCount = event.streamChunkCount || streamChunkCount;
        break;
      }
      const delta = event.delta || "";
      streamChunks.push(delta);
      text += delta;
      if (!first80Chars && [...text].length >= 80) {
        first80Chars = [...text].slice(0, 80).join("");
        timing.llm_first_80_chars_ms ??= event.elapsedMs;
      }
      firstPhrase ||= firstPhraseExtractor(text, { minChars });
      if (firstPhrase && timing.llm_first_phrase_ms === undefined) {
        timing.llm_first_phrase_ms = event.elapsedMs;
      }
      if (firstPhrase && !streamFull && this.env.DEEP_RESPONSE_LLM_STREAM_FULL !== "true") {
        text = firstPhrase;
        break;
      }
    }

    if (!firstPhrase) {
      firstPhrase = splitFirstPhrase(text);
    }

    return { text, firstPhrase, timing, streamChunkCount, streamChunks };
  }

  async *streamTokens({
    transcript,
    context = [],
    signal,
    maxTokens = 180,
    model,
    baseURL,
    temperature,
    messages
  } = {}) {
    const startedAt = this.clock();
    const timing = { llm_request_start_ms: 0 };
    let text = "";
    let streamChunkCount = 0;

    const requestMessages = messages || [
      { role: "system", content: deepResponseSystemPrompt() },
      ...context,
      { role: "user", content: transcript }
    ];
    const response = await fetch(`${(baseURL || this.env.ARK_BASE_URL).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.ARK_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({
        model: model || this.env.ARK_MODEL,
        stream: true,
        temperature: Number(temperature ?? 0.4),
        max_tokens: maxTokens,
        messages: requestMessages
      })
    });

    if (!response.ok) {
      throw new Error(`ark_llm_failed ${response.status}: ${await response.text()}`);
    }

    for await (const line of readSSELines(response.body)) {
      const delta = extractArkStreamDelta(line);
      if (!delta) {
        continue;
      }
      streamChunkCount += 1;
      timing.llm_first_token_ms ??= elapsed(this.clock, startedAt);
      text += delta;
      yield {
        type: "delta",
        delta,
        elapsedMs: elapsed(this.clock, startedAt)
      };
    }

    timing.llm_total_ms = elapsed(this.clock, startedAt);
    yield {
      type: "done",
      text,
      timing,
      streamChunkCount
    };
  }
}

export function extractArkStreamDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return null;
  }
  const data = JSON.parse(payload);
  return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? null;
}

export function splitFirstPhrase(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const match = cleaned.match(/^.{1,36}?[。！？!?；;]/u);
  return match ? match[0] : cleaned.slice(0, 36);
}

export function findSpeakableFirstPhrase(text, { minChars = 8 } = {}) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const match = cleaned.match(/^.{1,36}?[。！？!?；;]/u);
  if (match) {
    return match[0];
  }
  return cleaned.length >= minChars ? cleaned.slice(0, 36) : "";
}

export async function* readSSELines(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        yield line;
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    yield buffer.trim();
  }
}

function deepResponseSystemPrompt() {
  return [
    "你是一个以圣经为中心的属灵陪伴者，帮助用户和圣经对话；不代替神，不代替圣灵，不替用户解释神的隐藏旨意。",
    "用户现在可能处在强情绪中。先承接痛苦，再进入经文。",
    "第一句必须短、稳、具体，适合语音播放。",
    "每轮回应 1-3 句话，一次只问一个小问题。",
    "禁止说“我是神”“圣灵现在告诉你”“神一定要你这样做”“这件事发生是因为神要教你”。",
    "如果用户表达自伤、伤人或立即危险，要温柔建议联系现实中的可信任人和当地紧急支持。"
  ].join("\n");
}

function elapsed(clock, startedAt) {
  return Math.round(clock() - startedAt);
}
