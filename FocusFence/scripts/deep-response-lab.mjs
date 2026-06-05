#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { runHTTPAbortProbe, parseHTTPAbortArgs } from "./test-deep-response-http-abort.mjs";
import { runHTTPConversationProbe, parseHTTPConversationArgs } from "./test-deep-response-http-conversation.mjs";
import { runHTTPIdleProbe } from "./test-deep-response-http-smoke.mjs";
import { runWatchSimFakeMic } from "./run-deep-response-watch-sim-fakemic.mjs";

const DEFAULT_ENDPOINT = "http://124.174.96.149:8797";
const DEFAULT_FIXTURE = "Resources/DeepResponseWatchLab/simulated-mic-speech.pcm";
const REQUIRED_SCENARIOS = [
  "normal_turn",
  "multi_turn",
  "silent_recovery",
  "goodbye_end",
  "interrupt_entry"
];

export function parseDeepResponseLabArgs(argv) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    outDir: `/private/tmp/deep-response-lab-selftest-${stamp}`,
    fixturePath: DEFAULT_FIXTURE,
    turns: 4,
    watchTurns: 2,
    derivedDataPath: "/private/tmp/focus-deepresponse-watchlab-lab",
    device: "",
    skipBuild: false,
    skipSim: false,
    failFast: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[index + 1] || args.outDir;
      index += 1;
    } else if (arg === "--fixture") {
      args.fixturePath = argv[index + 1] || args.fixturePath;
      index += 1;
    } else if (arg === "--turns") {
      args.turns = Number(argv[index + 1] || args.turns);
      index += 1;
    } else if (arg === "--watch-turns") {
      args.watchTurns = Number(argv[index + 1] || args.watchTurns);
      index += 1;
    } else if (arg === "--derived-data") {
      args.derivedDataPath = argv[index + 1] || args.derivedDataPath;
      index += 1;
    } else if (arg === "--device") {
      args.device = argv[index + 1] || args.device;
      index += 1;
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
    } else if (arg === "--skip-sim") {
      args.skipSim = true;
    } else if (arg === "--fail-fast") {
      args.failFast = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.turns) || args.turns < 2) {
    throw new Error("--turns must be an integer >= 2");
  }
  if (!Number.isInteger(args.watchTurns) || args.watchTurns < 1) {
    throw new Error("--watch-turns must be a positive integer");
  }
  return args;
}

export function auditPCM16Audio(buffer, {
  sampleRate = 24_000,
  actualDrainMs = null,
  minRMS = 0.001,
  maxClippingRatio = 0.01
} = {}) {
  const bytes = buffer?.byteLength || 0;
  const samples = Math.floor(bytes / 2);
  let sumSquares = 0;
  let peak = 0;
  let clippedSamples = 0;

  for (let offset = 0; offset + 1 < bytes; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const normalized = Math.abs(sample) / 32768;
    peak = Math.max(peak, normalized);
    sumSquares += normalized * normalized;
    if (Math.abs(sample) >= 32760) {
      clippedSamples += 1;
    }
  }

  const rms = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;
  const durationMs = samples > 0 ? Math.round(samples / sampleRate * 1_000) : 0;
  const clippingRatio = samples > 0 ? clippedSamples / samples : 0;
  const failures = [];
  if (samples <= 0) {
    failures.push("audio is empty");
  }
  if (rms < minRMS || peak === 0) {
    failures.push("audio is silent or below RMS threshold");
  }
  if (clippingRatio > maxClippingRatio) {
    failures.push(`audio clipping ratio ${clippingRatio.toFixed(4)} exceeds ${maxClippingRatio}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    bytes,
    sampleRate,
    samples,
    durationMs,
    expectedDrainMs: durationMs,
    actualDrainMs,
    rms: Number(rms.toFixed(6)),
    peak: Number(peak.toFixed(6)),
    clippedSamples,
    clippingRatio: Number(clippingRatio.toFixed(6))
  };
}

export function judgeLabResults({
  mouth = { ok: false, scenarios: [] },
  eye = { ok: false, screenshots: [] },
  ear = { ok: false, audits: [] },
  server = { ok: false, sessions: [] }
} = {}) {
  const failures = [];
  const scenarioMap = new Map((mouth.scenarios || []).map((scenario) => [scenario.name, scenario]));
  for (const name of REQUIRED_SCENARIOS) {
    const scenario = scenarioMap.get(name);
    if (!scenario?.ok) {
      failures.push(`missing or failed mouth scenario: ${name}`);
    }
  }
  if (!mouth.ok) {
    failures.push("mouth category failed");
  }
  if (!eye.ok || !Array.isArray(eye.screenshots) || eye.screenshots.length === 0) {
    failures.push("eye category needs at least one passing Watch UI screenshot");
  }
  if (!ear.ok || !Array.isArray(ear.audits) || ear.audits.length === 0 || ear.audits.some((audit) => !audit.ok)) {
    failures.push("ear category needs passing non-silent audio audit evidence");
  }
  if (!server.ok || !Array.isArray(server.sessions) || server.sessions.length === 0) {
    failures.push("server category needs passing session/turn/generation evidence");
  }

  return {
    ok: failures.length === 0,
    failures,
    requiredScenarios: REQUIRED_SCENARIOS
  };
}

export function buildLabSummary({
  reportDir,
  startedAt,
  finishedAt,
  endpoint = DEFAULT_ENDPOINT,
  mouth = { ok: false, scenarios: [] },
  eye = { ok: false, screenshots: [] },
  ear = { ok: false, audits: [] },
  server = { ok: false, sessions: [] },
  artifacts = {}
} = {}) {
  const judge = judgeLabResults({ mouth, eye, ear, server });
  return {
    overall: judge.ok ? "PASS" : "FAIL",
    endpoint,
    reportDir,
    startedAt,
    finishedAt,
    mouth,
    eye,
    ear,
    server,
    judge,
    artifacts
  };
}

function compactServerEvent(event, source) {
  if (!event || typeof event !== "object") {
    return null;
  }
  return {
    source,
    seq: event.seq,
    at: event.at,
    receivedAtMs: event.receivedAtMs,
    type: event.type,
    sessionID: event.sessionID,
    turnID: event.turnID,
    generationID: event.generationID,
    segment: event.segment,
    text: event.text,
    delta: event.delta,
    reason: event.reason,
    timing: event.timing,
    providerMeta: event.providerMeta,
    error: event.error,
    message: event.message,
    persisted: event.persisted,
    store: event.store,
    turnCount: event.turnCount,
    summary: event.summary
  };
}

export function collectLabServerEvents({ conversation = null, idle = null, abort = null } = {}) {
  const events = [];
  const pushEvent = (event, source) => {
    const compact = compactServerEvent(event, source);
    if (compact) {
      events.push(compact);
    }
  };

  for (const turn of conversation?.turns || []) {
    for (const event of turn.evidence?.events || []) {
      pushEvent(event, "conversation_turn");
    }
  }
  pushEvent(conversation?.sessionEnd, "conversation_lifecycle");
  pushEvent(conversation?.memoryCandidate, "conversation_lifecycle");
  pushEvent(conversation?.memoryRecalled, "conversation_lifecycle");

  for (const event of idle?.evidence?.events || []) {
    pushEvent(event, "idle");
  }
  for (const event of abort?.evidence?.events || []) {
    pushEvent(event, "abort");
  }
  for (const event of abort?.nextTurn?.evidence?.events || []) {
    pushEvent(event, "abort_next_turn");
  }

  return events;
}

export async function runDeepResponseLabSelfTest(args) {
  const startedAt = new Date().toISOString();
  mkdirSync(args.outDir, { recursive: true });
  const artifacts = {
    summaryJson: join(args.outDir, "summary.json"),
    summaryMd: join(args.outDir, "summary.md"),
    serverEvents: join(args.outDir, "server-events.json"),
    turns: join(args.outDir, "turns.json"),
    timing: join(args.outDir, "timing.json"),
    audioAudit: join(args.outDir, "audio-audit.json"),
    screenshotsDir: join(args.outDir, "screenshots"),
    audioDir: join(args.outDir, "audio")
  };
  mkdirSync(artifacts.screenshotsDir, { recursive: true });
  mkdirSync(artifacts.audioDir, { recursive: true });

  const mouth = { ok: false, scenarios: [], fixture: args.fixturePath };
  const ear = { ok: false, audits: [], limitation: "PCM audit verifies Watch-received/queued audio bytes and timing proxies, not real speaker output or human hearing." };
  const server = { ok: false, sessions: [], events: [], timing: [] };
  const eye = {
    ok: false,
    screenshots: [],
    stateFlow: [
      "Listening",
      "Recording",
      "Thinking",
      "Speaking",
      "Waiting playback",
      "Listening",
      "Done"
    ],
    checkedFields: ["you", "god", "timing", "error"],
    observationMethod: "Watch Simulator fake-mic screenshots plus DeepResponseWatchLab source/state-machine gates; no OCR.",
    limitation: "Simulator screenshots are archived as UI evidence; OCR-free state assertions are backed by source/state-machine tests."
  };

  try {
    const conversation = await runHTTPConversationProbe(parseHTTPConversationArgs([
      "--endpoint", args.endpoint,
      "--pcm", args.fixturePath,
      "--turns", String(args.turns),
      "--chunk-ms", "1000",
      "--upload-sleep-ms", "1000",
      "--poll-ms", "50",
      "--wait-ms", "800",
      "--timeout-ms", "180000",
      "--pipeline-mode", "cascade",
      "--end-reason", "user_goodbye",
      "--expect-session-end",
      "--expect-late-audio-409",
      "--expect-memory-candidate",
      "--expect-llm-started-from-partial",
      "--max-stop-to-first-audio-ms", "3000",
      "--max-first-audio-after-first-phrase-ms", "1000",
      "--include-evidence"
    ]));
    mouth.scenarios.push({ name: "normal_turn", ok: conversation.turns.some((turn) => turn.transcript && turn.text && turn.audioByteLength > 0) });
    mouth.scenarios.push({ name: "multi_turn", ok: conversation.turns.length >= 2 && conversation.turns.every((turn) => turn.turnDone) });
    mouth.scenarios.push({ name: "goodbye_end", ok: conversation.sessionEnd?.reason === "user_goodbye" && conversation.lateAudioRejected?.status === 409 });
    server.sessions.push({ sessionID: conversation.sessionID, kind: "conversation", ok: conversation.ok });
    server.timing.push(...conversation.turns.map((turn) => ({ turnID: turn.turnID, generationID: turn.generationID, timing: turn.timing })));

    for (const turn of conversation.turns) {
      const audio = Buffer.concat((turn.evidence?.audioChunks || [])
        .map((chunk) => Buffer.from(chunk.audioBase64 || "", "base64"))
        .filter((chunk) => chunk.byteLength > 0));
      const audioPath = join(artifacts.audioDir, `${turn.turnID}.pcm`);
      writeFileSync(audioPath, audio);
      const sampleRate = Number(turn.evidence?.audioChunks?.find((chunk) => chunk.sampleRate)?.sampleRate || 24_000);
      ear.audits.push({
        turnID: turn.turnID,
        generationID: turn.generationID,
        path: audioPath,
        receivedBytes: turn.audioByteLength,
        queuedBytes: turn.audioByteLength,
        scheduledBytes: turn.audioByteLength,
        completedBytes: turn.audioByteLength,
        actualDrainMs: turn.turnDoneReceivedAtMs,
        ...auditPCM16Audio(audio, { sampleRate, actualDrainMs: turn.turnDoneReceivedAtMs })
      });
    }

    const idle = await runHTTPIdleProbe({
      endpoint: args.endpoint,
      idleTimeoutMs: 150,
      idleObserveMs: 5_000,
      pollMs: 50,
      idleGoodbye: true,
      expectMemoryCandidate: true,
      expectMemoryPersisted: false
    });
    mouth.scenarios.push({ name: "silent_recovery", ok: idle.ok && idle.endReason === "idle_timeout" });
    server.sessions.push({ sessionID: idle.sessionID, kind: "idle", ok: idle.ok });

    const abort = await runHTTPAbortProbe(parseHTTPAbortArgs([
      "--endpoint", args.endpoint,
      "--pcm", args.fixturePath,
      "--chunk-ms", "1000",
      "--upload-sleep-ms", "1000",
      "--poll-ms", "50",
      "--observe-ms", "3000",
      "--pipeline-mode", "cascade",
      "--expect-next-turn"
    ]));
    mouth.scenarios.push({ name: "interrupt_entry", ok: abort.ok && abort.staleAudioChunks === 0 && abort.nextTurn?.ok === true });
    server.sessions.push({ sessionID: abort.sessionID, kind: "abort", ok: abort.ok });
    server.events.push(...collectLabServerEvents({ conversation, idle, abort }));
    mouth.ok = mouth.scenarios.every((scenario) => scenario.ok);
    ear.ok = ear.audits.length > 0 && ear.audits.every((audit) => audit.ok);
    server.ok = server.sessions.length > 0 && server.sessions.every((session) => session.ok);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mouth.error = message;
    server.error = message;
    if (args.failFast) {
      throw error;
    }
  }

  if (!args.skipSim) {
    try {
      const watch = runWatchSimFakeMic({
        endpoint: args.endpoint,
        derivedDataPath: args.derivedDataPath,
        outDir: artifacts.screenshotsDir,
        turns: args.watchTurns,
        device: args.device,
        skipBuild: args.skipBuild
      });
      for (const filePath of Object.values(watch.screenshots || {})) {
        if (existsSync(filePath)) {
          eye.screenshots.push(filePath);
        }
      }
      eye.watch = watch;
      eye.ok = watch.ok && eye.screenshots.length > 0;
    } catch (error) {
      eye.error = error instanceof Error ? error.message : String(error);
      if (args.failFast) {
        throw error;
      }
    }
  } else {
    eye.ok = false;
    eye.skipped = true;
    eye.screenshots.push("simulator skipped by --skip-sim; source/UI state gates run in npm run test:node");
  }

  if (existsSync(args.fixturePath)) {
    copyFileSync(args.fixturePath, join(args.outDir, basename(args.fixturePath)));
  }

  const finishedAt = new Date().toISOString();
  const summary = buildLabSummary({
    reportDir: args.outDir,
    startedAt,
    finishedAt,
    endpoint: args.endpoint,
    mouth,
    eye,
    ear,
    server,
    artifacts
  });

  writeFileSync(artifacts.serverEvents, JSON.stringify(server.events, null, 2));
  writeFileSync(artifacts.turns, JSON.stringify(server.sessions, null, 2));
  writeFileSync(artifacts.timing, JSON.stringify(server.timing, null, 2));
  writeFileSync(artifacts.audioAudit, JSON.stringify(ear.audits, null, 2));
  writeFileSync(artifacts.summaryJson, JSON.stringify(summary, null, 2));
  writeFileSync(artifacts.summaryMd, renderSummaryMarkdown(summary));
  return summary;
}

export function renderSummaryMarkdown(summary) {
  const judgeLines = summary.judge.ok
    ? ["- PASS"]
    : summary.judge.failures.map((failure) => `- FAIL: ${failure}`);
  const lines = [
    "# DeepResponse Product Self-Test Lab",
    "",
    `Overall: **${summary.overall}**`,
    `Endpoint: \`${summary.endpoint}\``,
    `Report dir: \`${summary.reportDir}\``,
    "",
    "## Judge",
    "",
    ...judgeLines,
    "",
    "## Scenarios",
    "",
    "| Scenario | Result |",
    "| --- | --- |",
    ...summary.mouth.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.ok ? "PASS" : "FAIL"} |`),
    "",
    "## Evidence",
    "",
    `- Mouth: ${summary.mouth.ok ? "PASS" : "FAIL"}`,
    `- Eye: ${summary.eye.ok ? "PASS" : "FAIL"} (${summary.eye.screenshots.length} screenshot references)`,
    `- Ear: ${summary.ear.ok ? "PASS" : "FAIL"} (${summary.ear.audits.length} audio audits)`,
    `- Server: ${summary.server.ok ? "PASS" : "FAIL"} (${summary.server.sessions.length} sessions)`,
    "",
    "## Limits",
    "",
    `- ${summary.ear.limitation || "Audio audit does not replace real speaker/human hearing checks."}`,
    `- ${summary.eye.limitation || "Simulator screenshots do not replace real-device ergonomics checks."}`,
    ""
  ];
  if (summary.eye.stateFlow?.length) {
    lines.splice(lines.indexOf("## Evidence"), 0, "## Watch State Flow", "", `- ${summary.eye.stateFlow.join(" -> ")}`, "");
  }
  return lines.flat().join("\n");
}

function printHelp() {
  console.log(`Usage: node scripts/deep-response-lab.mjs [options]

Options:
  --endpoint <url>       DeepResponse endpoint. Default: ${DEFAULT_ENDPOINT}
  --out-dir <path>       Report directory. Default: /private/tmp/deep-response-lab-selftest-<timestamp>
  --fixture <path>       PCM speech fixture. Default: ${DEFAULT_FIXTURE}
  --turns <n>            Server conversation turns. Default: 4
  --watch-turns <n>      Watch simulator fake-mic turns. Default: 2
  --device <udid>        watchOS simulator UDID.
  --derived-data <path>  Xcode derived data path.
  --skip-build           Reuse an existing WatchLab simulator build.
  --skip-sim             Skip Watch simulator screenshots.
  --fail-fast            Throw on first runner failure.
`);
}

function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseDeepResponseLabArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runDeepResponseLabSelfTest(args);
      console.log(JSON.stringify({
        overall: summary.overall,
        reportDir: summary.reportDir,
        summaryJson: summary.artifacts.summaryJson,
        summaryMd: summary.artifacts.summaryMd,
        failures: summary.judge.failures
      }, null, 2));
      if (summary.overall !== "PASS") {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
