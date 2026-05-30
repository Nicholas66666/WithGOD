export const DEEP_RESPONSE_EVENTS = {
  SessionStart: "session.start",
  SessionReady: "session.ready",
  InputStop: "input.stop",
  BargeIn: "barge_in",
  TranscriptFinal: "transcript.final",
  AssistantTextDelta: "assistant.text_delta",
  AudioDone: "audio.done",
  Timing: "timing",
  Error: "error"
};

export const DEEP_RESPONSE_REALTIME_PATH = "/deep-response/realtime";

export function buildDeepResponseURL(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported endpoint protocol: ${url.protocol}`);
  }

  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}${DEEP_RESPONSE_REALTIME_PATH}`;
  url.search = "";
  return url;
}

export function isDeepResponseRealtimePath(path) {
  return (path || "").split("?", 1)[0] === DEEP_RESPONSE_REALTIME_PATH;
}

export function encodeDeepResponseMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

export function decodeDeepResponseMessage(text) {
  const message = JSON.parse(text);
  if (!message || typeof message.type !== "string") {
    throw new Error("deep_response_message_missing_type");
  }
  return message;
}
