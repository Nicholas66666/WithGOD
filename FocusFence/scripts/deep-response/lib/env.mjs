import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_DEEP_RESPONSE_ENV = {
  DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS: "50",
  DEEP_RESPONSE_FIRST_PHRASE_MODE: "template",
  ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
  ARK_MODEL: "doubao-seed-character-251128",
  ARK_FALLBACK_MODEL: "doubao-seed-2-0-pro-260215",
  DOUBAO_ASR_WS_URL: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
  DOUBAO_ASR_RESOURCE_ID: "volc.bigasr.sauc.duration",
  DOUBAO_ASR_MODEL_NAME: "bigmodel",
  DOUBAO_ASR_SAMPLE_RATE: "16000",
  DOUBAO_ASR_AUDIO_FORMAT: "pcm",
  DOUBAO_ASR_AUDIO_CODEC: "raw",
  DOUBAO_ASR_AUDIO_BITS: "16",
  DOUBAO_ASR_AUDIO_CHANNELS: "1",
  DOUBAO_ASR_END_WINDOW_SIZE_MS: "300",
  DOUBAO_TTS_WS_URL: "wss://openspeech.bytedance.com/api/v3/tts/bidirection",
  DOUBAO_TTS_HTTP_URL: "https://openspeech.bytedance.com/api/v1/tts",
  DOUBAO_TTS_RESOURCE_ID: "volc.service_type.10029",
  DOUBAO_TTS_MODEL: "",
  DOUBAO_TTS_SPEAKER_ID: "zh_male_shaonianzixin_moon_bigtts",
  DOUBAO_TTS_AUDIO_FORMAT: "pcm",
  DOUBAO_TTS_SAMPLE_RATE: "24000",
  DOUBAO_TTS_SPEECH_RATE: "0",
  DOUBAO_TTS_LOUDNESS_RATE: "0"
};

const REQUIRED_CREDENTIALS = [
  "ARK_API_KEY",
  "DOUBAO_SPEECH_APP_ID",
  "DOUBAO_SPEECH_ACCESS_TOKEN"
];

export function parseEnvContent(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      env[key] = value;
    }
  }

  return env;
}

export function loadEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  return parseEnvContent(readFileSync(path, "utf8"));
}

export function buildDeepResponseEnv(...sources) {
  return Object.assign({}, DEFAULT_DEEP_RESPONSE_ENV, ...sources);
}

export function loadDeepResponseEnv({ root = process.cwd() } = {}) {
  const rootEnv = loadEnvFile(`${root}/.env.local`);
  const supabaseEnv = loadEnvFile(`${root}/supabase/.env.local`);
  return buildDeepResponseEnv(rootEnv, supabaseEnv, process.env);
}

export function requireDeepResponseCredentials(env) {
  const missing = REQUIRED_CREDENTIALS.filter((name) => {
    const value = env[name]?.trim() || "";
    return !value || /YOUR_|ark_YOUR|sk-\.\.\./.test(value);
  });

  if (missing.length > 0) {
    throw new Error(`Missing DeepResponse credential(s): ${missing.join(", ")}`);
  }

  return {
    arkAPIKey: env.ARK_API_KEY.trim(),
    doubaoAppID: env.DOUBAO_SPEECH_APP_ID.trim(),
    doubaoAccessToken: env.DOUBAO_SPEECH_ACCESS_TOKEN.trim()
  };
}

export function numberFromEnv(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}
