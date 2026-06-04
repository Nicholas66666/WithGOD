#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildDeepResponseEnv, loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { chunkPCM16 } from "./test-deep-response-http-session.mjs";

export function parseCascadeProviderArgs(argv) {
  const args = {
    pcmPath: "",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 50,
    phraseMaxChars: 28,
    turns: 1
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
    } else if (arg === "--phrase-max-chars") {
      args.phraseMaxChars = Number(argv[index + 1] || args.phraseMaxChars);
      index += 1;
    } else if (arg === "--turns") {
      args.turns = Number(argv[index + 1] || args.turns);
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

export async function runCascadeProviderProbe(args) {
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
    tts: new DoubaoTTSProvider({ env }),
    firstPhraseMode: env.DEEP_RESPONSE_FIRST_PHRASE_MODE || "llm"
  });

  const turns = [];
  const audioChunks = [];
  for (let turnIndex = 0; turnIndex < args.turns; turnIndex += 1) {
    const startedAt = performance.now();
    const events = [];
    for await (const event of pipeline.streamCascadeTurn({
      audioChunks: replayChunks(chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: 100 }), args.replayIntervalMs),
      context,
      turnID: `turn_${turnIndex + 1}`,
      generationID: `gen_${turnIndex + 1}`,
      phraseMaxChars: args.phraseMaxChars
    })) {
      const receivedAtMs = Math.round(performance.now() - startedAt);
      events.push({ ...event, receivedAtMs });
      if (event.type === "audio_chunk" && event.audioChunk) {
        audioChunks.push(Buffer.from(event.audioChunk));
      }
    }
    turns.push(summarizeCascadeEvents({
      elapsedMs: Math.round(performance.now() - startedAt),
      events
    }));
  }

  if (args.outputAudioPath) {
    writeFileSync(args.outputAudioPath, Buffer.concat(audioChunks));
  }

  return {
    ok: turns.every((turn) => turn.ok),
    turns
  };
}

export function summarizeCascadeEvents({ elapsedMs, events }) {
  const transcriptFinal = events.findLast((event) => event.type === "transcript_final");
  const turnDone = events.findLast((event) => event.type === "turn_done");
  const timingEvent = events.findLast((event) => event.type === "timing");
  const phraseEvents = events.filter((event) => event.type === "assistant_phrase");
  const audioEvents = events.filter((event) => event.type === "audio_chunk");
  const firstPhraseIndex = events.findIndex((event) => event.type === "assistant_phrase");
  const firstAudioIndex = events.findIndex((event) => event.type === "audio_chunk");
  const firstPhraseEvent = firstPhraseIndex === -1 ? null : events[firstPhraseIndex];
  const firstAudioEvent = firstAudioIndex === -1 ? null : events[firstAudioIndex];
  const turnDoneIndex = events.findIndex((event) => event.type === "turn_done");
  const audioByteLength = audioEvents.reduce((sum, event) => sum + Buffer.from(event.audioChunk || []).byteLength, 0);
  const timing = timingEvent?.timing || {};

  return {
    ok: Boolean(transcriptFinal?.transcript && turnDone?.assistantText && audioByteLength > 0),
    transcript: transcriptFinal?.transcript || "",
    assistantText: turnDone?.assistantText || "",
    firstPhrase: phraseEvents[0]?.text || "",
    phraseCount: phraseEvents.length,
    audioChunkCount: audioEvents.length,
    audioByteLength,
    timing: {
      transcript_final_ms: timing.transcript_final_ms ?? 0,
      llm_first_token_ms: timing.llm_first_token_ms ?? 0,
      first_phrase_elapsed_ms: firstPhraseEvent?.receivedAtMs ?? 0,
      first_phrase_after_transcript_final_ms: firstPhraseEvent?.receivedAtMs && timing.transcript_final_ms
        ? firstPhraseEvent.receivedAtMs - timing.transcript_final_ms
        : 0,
      first_audio_elapsed_ms: firstAudioEvent?.receivedAtMs ?? 0,
      first_audio_after_transcript_final_ms: firstAudioEvent?.receivedAtMs && timing.transcript_final_ms
        ? firstAudioEvent.receivedAtMs - timing.transcript_final_ms
        : 0,
      first_audio_after_first_phrase_ms: firstAudioEvent?.receivedAtMs && firstPhraseEvent?.receivedAtMs
        ? firstAudioEvent.receivedAtMs - firstPhraseEvent.receivedAtMs
        : 0,
      first_phrase_event_index: firstPhraseIndex,
      first_audio_event_index: firstAudioIndex,
      first_audio_before_turn_done: firstAudioIndex !== -1 && turnDoneIndex !== -1 && firstAudioIndex < turnDoneIndex,
      voice_pipeline_total_ms: timing.voice_pipeline_total_ms ?? 0,
      elapsed_ms: elapsedMs
    }
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
  console.log(`Usage: node scripts/test-deep-response-cascade-provider.mjs --pcm path/to/speech.pcm [options]

Options:
  --pcm <path>              Required. Raw 16kHz mono int16 PCM speech fixture.
  --context <path>          Optional JSON context array.
  --out-audio <path>        Optional output path for returned PCM bytes.
  --replay-interval-ms <ms> Replay delay between chunks. Default: 50.
  --phrase-max-chars <n>    Max chars before low-latency phrase flush. Default: 28.
  --turns <n>               Number of repeated fixture turns. Default: 1.
  --tts-http-fallback       Allow diagnostic HTTP TTS fallback.
`);
}

function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseCascadeProviderArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runCascadeProviderProbe(args);
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
