#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildDeepResponseEnv, loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";

export function parseBenchmarkArgs(argv) {
  const args = {
    pcmPath: "",
    contextPath: "",
    outputAudioPath: ""
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

async function main() {
  const args = parseBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const env = buildDeepResponseEnv(loadDeepResponseEnv());
  requireDeepResponseCredentials(env);

  const audio = readFileSync(args.pcmPath);
  const audioChunks = realtimeAudioChunks(chunkPCM16(audio, { sampleRate: 16_000, chunkMs: 100 }), 100);
  const context = args.contextPath ? JSON.parse(readFileSync(args.contextPath, "utf8")) : [];
  const pipeline = new VoicePipeline({
    asr: new DoubaoASRProvider({ env }),
    llm: new ArkLLMProvider({ env }),
    tts: new DoubaoTTSProvider({ env })
  });

  const result = await pipeline.run({
    audioChunks,
    context
  });

  if (args.outputAudioPath) {
    writeFileSync(args.outputAudioPath, Buffer.concat(result.audioChunks));
  }

  console.log(JSON.stringify(summarizeBenchmarkResult(result), null, 2));
}

export function summarizeBenchmarkResult(result) {
  return {
    transcript: result.transcript,
    responseText: result.responseText,
    firstPhrase: result.firstPhrase,
    audioByteLength: result.audioByteLength,
    timing: result.timing,
    providerMeta: result.providerMeta
  };
}

export function* chunkPCM16(pcm, { sampleRate = 16_000, chunkMs = 100 } = {}) {
  const bytesPerChunk = Math.max(2, Math.round(sampleRate * chunkMs / 1_000) * 2);
  for (let offset = 0; offset < pcm.byteLength; offset += bytesPerChunk) {
    yield pcm.subarray(offset, Math.min(offset + bytesPerChunk, pcm.byteLength));
  }
}

async function* realtimeAudioChunks(chunks, intervalMs) {
  for (const chunk of chunks) {
    yield chunk;
    await sleep(intervalMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/deep-response-benchmark.mjs --pcm path/to/speech.pcm [options]

Options:
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --context <path>      Optional JSON array of chat messages for Ark context.
  --out-audio <path>    Optional path to write returned TTS audio bytes.
  --tts-http-fallback   Allow diagnostic HTTP TTS fallback when WebSocket TTS fails.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
