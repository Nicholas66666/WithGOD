#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildDeepResponseEnv, loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import {
  PROMPT_VARIANTS,
  buildArkCandidates,
  buildBenchmarkMessages,
  checkBenchmarkOutput,
  coerceFirstPhraseMs,
  createBlindReviewRows,
  extractVariantCFirstPhrase,
  filterBenchmarkPlan,
  parseJSONL,
  summarizeLLMBenchmarkResults,
  toJSONL
} from "./deep-response/lib/llm-benchmark.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";

export function parseBenchmarkArgs(argv) {
  const args = {
    pcmPath: "",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 100,
    samplesPath: "",
    candidatesPath: "",
    outDir: "",
    runs: 1,
    promptVariants: PROMPT_VARIANTS,
    reviewResultsPath: "",
    models: [],
    sampleIDs: []
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
      args.replayIntervalMs = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--tts-http-fallback") {
      process.env.DEEP_RESPONSE_TTS_HTTP_FALLBACK = "1";
    } else if (arg === "--samples") {
      args.samplesPath = argv[index + 1] || "";
      args.mode = "llm";
      index += 1;
    } else if (arg === "--candidates") {
      args.candidatesPath = argv[index + 1] || "";
      args.mode = "llm";
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[index + 1] || "";
      args.mode = "llm";
      index += 1;
    } else if (arg === "--runs") {
      args.runs = Number(argv[index + 1] || 1);
      args.mode = "llm";
      index += 1;
    } else if (arg === "--prompt-variants") {
      args.promptVariants = String(argv[index + 1] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      args.mode = "llm";
      index += 1;
    } else if (arg === "--review-results") {
      args.reviewResultsPath = argv[index + 1] || "";
      args.mode = "llm";
      index += 1;
    } else if (arg === "--models") {
      args.models = splitCSV(argv[index + 1] || "");
      args.mode = "llm";
      index += 1;
    } else if (arg === "--sample-ids") {
      args.sampleIDs = splitCSV(argv[index + 1] || "");
      args.mode = "llm";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && args.mode === "llm" && !args.samplesPath) {
    throw new Error("Missing required --samples data/deep-response/llm-benchmark/samples.jsonl");
  }
  if (!args.help && args.mode !== "llm" && !args.pcmPath) {
    throw new Error("Missing required --pcm path/to/16k-mono-int16-speech.pcm");
  }

  if (args.mode !== "llm") {
    delete args.samplesPath;
    delete args.candidatesPath;
    delete args.outDir;
    delete args.runs;
    delete args.promptVariants;
    delete args.reviewResultsPath;
    delete args.models;
    delete args.sampleIDs;
  }

  return args;
}

async function main() {
  const args = parseBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.mode === "llm") {
    await runLLMBenchmark(args);
    return;
  }

  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const env = buildDeepResponseEnv(loadDeepResponseEnv());
  requireDeepResponseCredentials(env);

  const audio = readFileSync(args.pcmPath);
  const audioChunks = realtimeAudioChunks(chunkPCM16(audio, { sampleRate: 16_000, chunkMs: 100 }), args.replayIntervalMs);
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

async function runLLMBenchmark(args) {
  if (!existsSync(args.samplesPath)) {
    throw new Error(`Samples JSONL not found: ${args.samplesPath}`);
  }
  if (args.candidatesPath && !existsSync(args.candidatesPath)) {
    throw new Error(`Candidates JSON not found: ${args.candidatesPath}`);
  }

  const env = buildDeepResponseEnv(loadDeepResponseEnv());
  requireDeepResponseCredentials(env);
  const allSamples = parseJSONL(readFileSync(args.samplesPath, "utf8"));
  const configured = args.candidatesPath ? JSON.parse(readFileSync(args.candidatesPath, "utf8")) : [];
  const allCandidates = buildArkCandidates({ env, configured });
  const { candidates, samples } = filterBenchmarkPlan({
    candidates: allCandidates,
    samples: allSamples,
    modelFilter: args.models,
    sampleIDFilter: args.sampleIDs
  });
  const outDir = args.outDir || "data/deep-response/llm-benchmark";
  const rawDir = `${outDir}/raw`;
  mkdirSync(rawDir, { recursive: true });
  const resultsPath = `${outDir}/results.jsonl`;
  writeFileSync(resultsPath, "");

  const llm = new ArkLLMProvider({ env });
  const rows = [];
  for (let runIndex = 0; runIndex < args.runs; runIndex += 1) {
    for (const candidate of candidates) {
      for (const variant of args.promptVariants) {
        for (const sample of samples) {
          const row = await runLLMSample({ llm, sample, candidate, variant, runIndex, rawDir });
          rows.push(row);
          appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
          console.log(JSON.stringify({
            sample_id: row.sample_id,
            model: row.model,
            prompt_variant: row.prompt_variant,
            first_token_ms: row.first_token_ms,
            first_phrase_ms: row.first_phrase_ms,
            pass: row.checks.pass
          }));
        }
      }
    }
  }

  const { blindRows, reviewMap } = createBlindReviewRows(rows);
  const manualScores = args.reviewResultsPath && existsSync(args.reviewResultsPath)
    ? parseJSONL(readFileSync(args.reviewResultsPath, "utf8"))
    : [];
  const summary = summarizeLLMBenchmarkResults({ rows, manualScores, reviewMap });

  writeFileSync(resultsPath, toJSONL(rows));
  writeFileSync(`${outDir}/blind-review.jsonl`, toJSONL(blindRows));
  writeFileSync(`${outDir}/blind-review-map.json`, `${JSON.stringify(reviewMap, null, 2)}\n`);
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.recommendation, null, 2));
}

async function runLLMSample({ llm, sample, candidate, variant, runIndex, rawDir }) {
  const requestStartedAt = new Date().toISOString();
  const timeoutMs = Number(candidate.requestTimeoutMs || 10_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let llmResult = { text: "", firstPhrase: "", timing: {}, streamChunkCount: 0, streamChunks: [] };
  let streamError = "";
  let timedOut = false;
  try {
    llmResult = await llm.generate({
      messages: buildBenchmarkMessages({ sample, variant }),
      model: candidate.model,
      baseURL: candidate.baseURL,
      temperature: candidate.temperature,
      maxTokens: candidate.maxTokens,
      signal: controller.signal,
      streamFull: true,
      firstPhraseExtractor: variant === "C"
        ? (text) => extractVariantCFirstPhrase(text)
        : undefined
    });
  } catch (error) {
    timedOut = controller.signal.aborted;
    streamError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
  }

  const parsedC = variant === "C" ? parseVariantCOutput(llmResult.text) : null;
  const firstPhrase = parsedC?.first_phrase || llmResult.firstPhrase || "";
  const outputText = parsedC ? `${parsedC.first_phrase}${parsedC.continuation}` : llmResult.text;
  const firstPhraseMs = coerceFirstPhraseMs({
    firstPhrase,
    firstPhraseMs: llmResult.timing.llm_first_phrase_ms,
    totalMs: llmResult.timing.llm_total_ms
  });
  const checks = checkBenchmarkOutput({
    sample,
    variant,
    firstPhrase,
    outputText: llmResult.text,
    streamError,
    timeout: timedOut
  });
  const rawOutputPath = `${rawDir}/${sample.id}-${candidate.model}-${variant}-run${runIndex + 1}.json`.replace(/[^/A-Za-z0-9_.-]/g, "_");
  const row = {
    sample_id: sample.id,
    category: sample.category,
    risk: sample.risk,
    provider: candidate.provider,
    model: candidate.model,
    prompt_variant: variant,
    run_index: runIndex + 1,
    request_started_at: requestStartedAt,
    first_token_ms: llmResult.timing.llm_first_token_ms ?? null,
    first_phrase_ms: firstPhraseMs,
    first_80_chars_ms: llmResult.timing.llm_first_80_chars_ms ?? null,
    total_ms: llmResult.timing.llm_total_ms ?? null,
    output_chars: [...String(outputText || "")].length,
    first_phrase_chars: [...String(firstPhrase || "").replace(/\s+/g, "")].length,
    first_phrase_text: firstPhrase,
    stream_chunk_count: llmResult.streamChunkCount || 0,
    stream_error: streamError,
    timeout: timedOut,
    raw_output_path: rawOutputPath,
    checks,
    first_phrase: firstPhrase,
    continuation: parsedC?.continuation || "",
    output_text: outputText
  };
  writeFileSync(rawOutputPath, `${JSON.stringify({ row, candidate, sample, text: llmResult.text, streamChunks: llmResult.streamChunks }, null, 2)}\n`);
  return row;
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
  --replay-interval-ms  Optional delay between 100ms PCM chunks. Default 100.
  --tts-http-fallback   Allow diagnostic HTTP TTS fallback when WebSocket TTS fails.

LLM-only benchmark:
  --samples <path>      JSONL sample set.
  --candidates <path>   Optional Ark candidates JSON.
  --out-dir <path>      Output directory. Default data/deep-response/llm-benchmark.
  --prompt-variants A,B,C
  --runs <n>            Repetitions per sample/model/variant. Default 1.
  --review-results <path> Optional blind-review score JSONL.
  --models <id,id>      Optional model id filter for segmented runs.
  --sample-ids <id,id>  Optional sample id filter for segmented runs.
`);
}

function splitCSV(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseVariantCOutput(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    if (typeof parsed.first_phrase === "string" && typeof parsed.continuation === "string") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
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
