#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildDeepResponseEnv, loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";
import { chunkPCM16 } from "./test-deep-response-http-session.mjs";

export function parseStreamingProviderArgs(argv) {
  const args = {
    pcmPath: "",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 50
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pcm") {
      args.pcmPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--context") {
      args.contextPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--out-audio") {
      args.outputAudioPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--replay-interval-ms") {
      args.replayIntervalMs = Number(argv[index + 1] || args.replayIntervalMs);
      index += 1;
    } else if (arg === "--tts-http-fallback") {
      process.env.DEEP_RESPONSE_TTS_HTTP_FALLBACK = "1";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.pcmPath) {
    throw new Error("Missing required --pcm path/to/16k-mono-int16-speech.pcm");
  }
  return args;
}

export async function runStreamingProviderProbe(args) {
  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const env = buildDeepResponseEnv(loadDeepResponseEnv());
  requireDeepResponseCredentials(env);
  const pcm = readFileSync(args.pcmPath);
  const context = args.contextPath ? JSON.parse(readFileSync(args.contextPath, "utf8")) : [];
  const pipeline = new VoicePipeline({
    asr: new DoubaoASRProvider({ env }),
    llm: new ArkLLMProvider({ env }),
    tts: new DoubaoTTSProvider({ env })
  });

  const result = await pipeline.runSegmented({
    audioChunks: replayChunks(chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: 100 }), args.replayIntervalMs),
    context
  });

  if (args.outputAudioPath) {
    writeFileSync(args.outputAudioPath, Buffer.concat([
      ...result.first.audioChunks,
      ...result.followup.audioChunks
    ].map((chunk) => Buffer.from(chunk))));
  }

  return summarizeStreamingProviderResult(result);
}

export function summarizeStreamingProviderResult(result) {
  const asrFinalMs = result.timing?.transcript_final_ms ?? result.timing?.asr_final_ms ?? 0;
  const llmFirstPhraseMs = result.timing?.llm_first_phrase_ms ?? 0;
  const ttsFirstAudioMs = result.timing?.first_tts_first_audio_ms ?? result.timing?.tts_first_audio_ms ?? 0;
  return {
    ok: Boolean(result.transcript && result.first?.text && result.first?.audioByteLength > 0),
    transcript: result.transcript || "",
    firstText: result.first?.text || "",
    followupText: result.followup?.text || "",
    audioByteLength: Number(result.first?.audioByteLength || 0) + Number(result.followup?.audioByteLength || 0),
    timing: {
      asr_final_ms: asrFinalMs,
      llm_first_phrase_ms: llmFirstPhraseMs,
      tts_first_audio_ms: ttsFirstAudioMs,
      first_playable_audio_ms: asrFinalMs + llmFirstPhraseMs + ttsFirstAudioMs,
      total_ms: result.timing?.voice_pipeline_total_ms ?? 0
    },
    providerMeta: result.providerMeta || {}
  };
}

async function* replayChunks(chunks, intervalMs) {
  let isFirst = true;
  for (const chunk of chunks || []) {
    if (!isFirst && intervalMs > 0) {
      await sleep(intervalMs);
    }
    isFirst = false;
    yield chunk;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-streaming-provider.mjs --pcm path/to/speech.pcm [options]

Options:
  --pcm <path>              Required. Raw 16kHz mono int16 PCM speech fixture.
  --context <path>          Optional JSON context array.
  --out-audio <path>        Optional output path for returned PCM bytes.
  --replay-interval-ms <ms> Replay delay between chunks. Default: 50.
  --tts-http-fallback       Allow diagnostic HTTP TTS fallback.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const args = parseStreamingProviderArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else {
    runStreamingProviderProbe(args).then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
