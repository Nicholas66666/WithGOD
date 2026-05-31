#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { DEFAULT_DEEP_RESPONSE_ENV, loadDeepResponseEnv } from "./deep-response/lib/env.mjs";
import { buildRenderConfig, loadDotenv } from "./render-deploy.mjs";

const RENDER_API_BASE_URL = "https://api.render.com/v1";

export const DEEP_RESPONSE_RENDER_ENV_KEYS = [
  "DEEP_RESPONSE_MODE",
  "DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS",
  "DEEP_RESPONSE_FIRST_PHRASE_MODE",
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_MODEL",
  "ARK_FALLBACK_MODEL",
  "DOUBAO_SPEECH_APP_ID",
  "DOUBAO_SPEECH_ACCESS_TOKEN",
  "DOUBAO_ASR_WS_URL",
  "DOUBAO_ASR_RESOURCE_ID",
  "DOUBAO_ASR_MODEL_NAME",
  "DOUBAO_ASR_SAMPLE_RATE",
  "DOUBAO_ASR_AUDIO_FORMAT",
  "DOUBAO_ASR_AUDIO_CODEC",
  "DOUBAO_ASR_AUDIO_BITS",
  "DOUBAO_ASR_AUDIO_CHANNELS",
  "DOUBAO_ASR_END_WINDOW_SIZE_MS",
  "DOUBAO_TTS_WS_URL",
  "DOUBAO_TTS_HTTP_URL",
  "DOUBAO_TTS_RESOURCE_ID",
  "DOUBAO_TTS_MODEL",
  "DOUBAO_TTS_SPEAKER_ID",
  "DOUBAO_TTS_AUDIO_FORMAT",
  "DOUBAO_TTS_SAMPLE_RATE",
  "DOUBAO_TTS_SPEECH_RATE",
  "DOUBAO_TTS_LOUDNESS_RATE",
  "DEEP_RESPONSE_TTS_HTTP_FALLBACK"
];

const SECRET_KEYS = new Set([
  "ARK_API_KEY",
  "DOUBAO_SPEECH_APP_ID",
  "DOUBAO_SPEECH_ACCESS_TOKEN"
]);

export function collectDeepResponseRenderEnv(env, { mode = "provider" } = {}) {
  const source = {
    ...DEFAULT_DEEP_RESPONSE_ENV,
    ...env,
    DEEP_RESPONSE_MODE: mode
  };
  const selected = {};
  for (const key of DEEP_RESPONSE_RENDER_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined && String(value) !== "") {
      selected[key] = String(value);
    }
  }
  return selected;
}

export function buildEnvVarUpdateRequest({ serviceId, apiKey, key, value }) {
  return {
    url: `${RENDER_API_BASE_URL}/services/${serviceId}/env-vars/${encodeURIComponent(key)}`,
    options: {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ value })
    }
  };
}

export function redactValue(key, value) {
  if (!SECRET_KEYS.has(key)) {
    return value;
  }
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function updateEnvVar(config, key, value, { fetchImpl = fetch } = {}) {
  const request = buildEnvVarUpdateRequest({ ...config, key, value });
  const response = await fetchImpl(request.url, request.options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Render env update failed ${key} ${response.status}: ${text}`);
  }
}

export async function runRenderSyncDeepEnv(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const dotenv = loadDotenv();
  const config = buildRenderConfig({ ...dotenv, ...process.env });
  const localEnv = loadDeepResponseEnv();
  const mode = argv.includes("--echo") ? "echo" : "provider";
  const selected = collectDeepResponseRenderEnv(localEnv, { mode });

  for (const [key, value] of Object.entries(selected)) {
    await updateEnvVar(config, key, value, { fetchImpl });
    console.log(`Render env ${key}=${redactValue(key, value)}`);
  }
  return selected;
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  runRenderSyncDeepEnv().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
