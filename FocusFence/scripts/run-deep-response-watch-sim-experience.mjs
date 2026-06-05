#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { auditPCM16Audio } from "./deep-response-lab.mjs";
import { runWatchSimFakeMic } from "./run-deep-response-watch-sim-fakemic.mjs";

const DEFAULT_ENDPOINT = "http://124.174.96.149:8797";
const DEFAULT_DERIVED_DATA = "/private/tmp/focus-deepresponse-watchlab-experience";

export function parseWatchSimExperienceArgs(argv) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    outDir: `/private/tmp/deep-response-watch-sim-experience-${stamp}`,
    derivedDataPath: DEFAULT_DERIVED_DATA,
    turns: 10,
    device: "",
    skipBuild: false,
    maxOpeningStemRepeats: 2,
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
    } else if (arg === "--derived-data") {
      args.derivedDataPath = argv[index + 1] || args.derivedDataPath;
      index += 1;
    } else if (arg === "--turns") {
      args.turns = Number.parseInt(argv[index + 1] || `${args.turns}`, 10);
      index += 1;
    } else if (arg === "--device") {
      args.device = argv[index + 1] || args.device;
      index += 1;
    } else if (arg === "--max-opening-stem-repeats") {
      args.maxOpeningStemRepeats = Number.parseInt(argv[index + 1] || `${args.maxOpeningStemRepeats}`, 10);
      index += 1;
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.turns) || args.turns < 1) {
    throw new Error("--turns must be a positive integer");
  }
  if (!Number.isInteger(args.maxOpeningStemRepeats) || args.maxOpeningStemRepeats < 1) {
    throw new Error("--max-opening-stem-repeats must be a positive integer");
  }
  return args;
}

export async function runWatchSimExperience(args) {
  mkdirSync(args.outDir, { recursive: true });
  const audioDir = join(args.outDir, "audio");
  mkdirSync(audioDir, { recursive: true });
  const startedAt = new Date().toISOString();

  const watch = runWatchSimFakeMic({
    endpoint: args.endpoint,
    derivedDataPath: args.derivedDataPath,
    outDir: args.outDir,
    turns: args.turns,
    device: args.device,
    skipBuild: args.skipBuild
  });

  const debugEvents = await fetchDebugEvents(args.endpoint);
  const sessionID = findExperienceSessionID(debugEvents, {
    startedAt,
    turns: args.turns
  });
  if (!sessionID) {
    throw new Error(`Could not find a Watch simulator session with ${args.turns} completed turns after ${startedAt}`);
  }

  const sessionEvents = await fetchJSON(buildURL(args.endpoint, `/deep-response/sessions/${encodeURIComponent(sessionID)}/events?cursor=0`));
  const sessionAudio = await fetchJSON(buildURL(args.endpoint, `/deep-response/sessions/${encodeURIComponent(sessionID)}/audio?cursor=0`));
  const turns = summarizeExperienceTurns(sessionEvents.events || [], sessionAudio.chunks || []);
  const audioAudits = writeAudioAudits(turns, sessionAudio.chunks || [], audioDir);
  const summary = buildWatchExperienceSummary({
    endpoint: args.endpoint,
    outDir: args.outDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    requiredTurns: args.turns,
    maxOpeningStemRepeats: args.maxOpeningStemRepeats,
    watch,
    sessionID,
    debugEvents,
    sessionEvents: sessionEvents.events || [],
    audioAudits,
    turns
  });

  const artifacts = {
    summaryJson: join(args.outDir, "summary.json"),
    summaryMd: join(args.outDir, "summary.md"),
    serverEvents: join(args.outDir, "server-events.json"),
    debugEvents: join(args.outDir, "debug-events.json"),
    audioAudit: join(args.outDir, "audio-audit.json"),
    timing: join(args.outDir, "timing.json"),
    turns: join(args.outDir, "turns.json"),
    audioDir
  };
  summary.artifacts = artifacts;
  writeFileSync(artifacts.summaryJson, JSON.stringify(summary, null, 2));
  writeFileSync(artifacts.summaryMd, renderWatchExperienceMarkdown(summary));
  writeFileSync(artifacts.serverEvents, JSON.stringify(sessionEvents.events || [], null, 2));
  writeFileSync(artifacts.debugEvents, JSON.stringify(debugEvents, null, 2));
  writeFileSync(artifacts.audioAudit, JSON.stringify(audioAudits, null, 2));
  writeFileSync(artifacts.timing, JSON.stringify(turns.map((turn) => ({
    turnID: turn.turnID,
    generationID: turn.generationID,
    timing: turn.timing
  })), null, 2));
  writeFileSync(artifacts.turns, JSON.stringify(turns, null, 2));
  return summary;
}

export function findExperienceSessionID(debugEvents = [], { startedAt, turns }) {
  const startedMs = Date.parse(startedAt || "1970-01-01T00:00:00.000Z");
  const groups = new Map();
  for (const event of debugEvents || []) {
    if (!event?.sessionID) {
      continue;
    }
    const group = groups.get(event.sessionID) || [];
    group.push(event);
    groups.set(event.sessionID, group);
  }
  const candidates = [...groups.entries()].map(([sessionID, events]) => {
    const createdAt = events.find((event) => event.type === "http_session_created")?.at || "";
    const eventTimeOK = !createdAt || Date.parse(createdAt) >= startedMs;
    const inputStops = new Set(events.filter((event) => event.type === "http_session_input_stop").map((event) => event.turnID));
    const completes = new Set(events.filter((event) => event.type === "http_session_complete").map((event) => event.turnID));
    return {
      sessionID,
      eventTimeOK,
      inputStops: inputStops.size,
      completes: completes.size,
      lastAt: events[events.length - 1]?.at || ""
    };
  }).filter((candidate) => {
    return candidate.eventTimeOK && candidate.inputStops >= turns && candidate.completes >= turns;
  });
  candidates.sort((a, b) => Date.parse(b.lastAt || 0) - Date.parse(a.lastAt || 0));
  return candidates[0]?.sessionID || "";
}

export function summarizeExperienceTurns(events = [], audioChunks = []) {
  const eventGroups = groupByTurn(events);
  const audioGroups = groupByTurn(audioChunks);
  return [...eventGroups.entries()].filter(([turnID]) => turnID).map(([turnID, turnEvents]) => {
    const generationID = turnEvents.find((event) => event.generationID)?.generationID || "";
    const audio = audioGroups.get(turnID) || [];
    const text = turnEvents
      .filter((event) => event.type === "assistant_text_delta")
      .map((event) => event.delta || "")
      .join("");
    const transcript = turnEvents.find((event) => event.type === "transcript_final")?.text || "";
    return {
      turnID,
      generationID,
      transcript,
      text,
      opening: firstSentence(text),
      openingStem: extractOpeningStem(text),
      audioDone: turnEvents.some((event) => event.type === "audio_done" && event.generationID === generationID),
      turnDone: turnEvents.some((event) => event.type === "turn_done" && event.generationID === generationID),
      timing: turnEvents.find((event) => event.type === "timing" && event.generationID === generationID)?.timing || null,
      eventTypes: [...new Set(turnEvents.map((event) => event.type))],
      audioChunks: audio.length,
      audioBytes: audio.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0),
      sampleRate: Number(audio.find((chunk) => chunk.sampleRate)?.sampleRate || 24_000)
    };
  });
}

export function buildWatchExperienceSummary({
  endpoint,
  outDir,
  startedAt,
  finishedAt,
  requiredTurns,
  maxOpeningStemRepeats = 2,
  watch,
  sessionID,
  debugEvents,
  sessionEvents,
  audioAudits,
  turns
}) {
  const failures = [];
  if (!watch?.ok) {
    failures.push("Watch simulator fake-mic run did not report ok");
  }
  if (!sessionID) {
    failures.push("missing Watch simulator HTTP session id");
  }
  if ((turns || []).length < requiredTurns) {
    failures.push(`expected at least ${requiredTurns} turns, got ${(turns || []).length}`);
  }
  for (const turn of turns || []) {
    if (!turn.transcript) {
      failures.push(`turn ${turn.turnID} missing transcript`);
    }
    if (!turn.text) {
      failures.push(`turn ${turn.turnID} missing assistant text`);
    }
    if (!turn.audioDone || !turn.turnDone) {
      failures.push(`turn ${turn.turnID} missing audio_done or turn_done`);
    }
    if (turn.audioChunks <= 0 || turn.audioBytes <= 0) {
      failures.push(`turn ${turn.turnID} missing assistant audio`);
    }
    if (!turn.timing) {
      failures.push(`turn ${turn.turnID} missing timing`);
    }
  }
  failures.push(...collectExperienceTextFailures(turns, { maxOpeningStemRepeats }));
  failures.push(...collectBlockingErrorFailures(sessionEvents));
  failures.push(...(audioAudits || []).flatMap((audit) => audit.ok ? [] : [`audio audit failed for ${audit.turnID}: ${audit.failures.join("; ")}`]));

  return {
    overall: failures.length === 0 ? "PASS" : "FAIL",
    endpoint,
    reportDir: outDir,
    startedAt,
    finishedAt,
    requiredTurns,
    sessionID,
    watch,
    turns,
    audioAudits,
    debugEventCount: (debugEvents || []).length,
    serverEventCount: (sessionEvents || []).length,
    failures
  };
}

function collectExperienceTextFailures(turns = [], { maxOpeningStemRepeats = 2 } = {}) {
  const failures = [];
  const openingCounts = new Map();
  const openings = new Map();
  let previous = null;
  for (const turn of turns || []) {
    const stem = turn.openingStem || "";
    const opening = turn.opening || "";
    if (previous && stem && stem === previous.openingStem) {
      failures.push(`consecutive repeated opening stem ${stem}: ${previous.turnID} -> ${turn.turnID}`);
    }
    if (opening && openings.has(opening)) {
      failures.push(`repeated opening sentence ${JSON.stringify(opening)}: ${openings.get(opening)} -> ${turn.turnID}`);
    }
    if (opening) {
      openings.set(opening, turn.turnID);
    }
    if (stem) {
      openingCounts.set(stem, (openingCounts.get(stem) || 0) + 1);
    }
    previous = turn;
  }
  for (const [stem, count] of openingCounts.entries()) {
    if (count > maxOpeningStemRepeats) {
      failures.push(`opening stem ${stem} repeated ${count} times, max ${maxOpeningStemRepeats}`);
    }
  }
  return failures;
}

function collectBlockingErrorFailures(events = []) {
  const pattern = /-999|-1001|Volc_Server_Error|provider error|provider_error|empty ASR|empty god|timeout/i;
  return (events || []).filter((event) => {
    return pattern.test(JSON.stringify(event));
  }).map((event) => `blocking error event: ${event.type} ${event.error || event.message || event.reason || ""}`.trim());
}

function writeAudioAudits(turns, audioChunks, audioDir) {
  const audioGroups = groupByTurn(audioChunks);
  return (turns || []).map((turn) => {
    const chunks = audioGroups.get(turn.turnID) || [];
    const audio = Buffer.concat(chunks
      .map((chunk) => Buffer.from(chunk.audioBase64 || "", "base64"))
      .filter((chunk) => chunk.byteLength > 0));
    const path = join(audioDir, `${turn.turnID}.pcm`);
    writeFileSync(path, audio);
    return {
      turnID: turn.turnID,
      generationID: turn.generationID,
      path,
      receivedBytes: turn.audioBytes,
      queuedBytes: turn.audioBytes,
      scheduledBytes: turn.audioBytes,
      completedBytes: turn.audioBytes,
      ...auditPCM16Audio(audio, { sampleRate: turn.sampleRate || 24_000 })
    };
  });
}

function groupByTurn(items = []) {
  const groups = new Map();
  for (const item of items || []) {
    const turnID = item?.turnID || "";
    if (!turnID) {
      continue;
    }
    const group = groups.get(turnID) || [];
    group.push(item);
    groups.set(turnID, group);
  }
  return groups;
}

function firstSentence(text) {
  const match = String(text || "").trim().match(/^[^。！？!?；;]*[。！？!?；;]?/u);
  return match ? match[0] : "";
}

function extractOpeningStem(text) {
  const match = firstSentence(text)
    .replace(/^[\s"'“”‘’]+/u, "")
    .trim()
    .match(/^([\p{Script=Han}]{2})/u);
  return match ? match[1] : "";
}

async function fetchDebugEvents(endpoint) {
  const body = await fetchJSON(buildURL(endpoint, "/debug/events"));
  return body.events || [];
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function buildURL(endpoint, path) {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return `${base}${path}`;
}

export function renderWatchExperienceMarkdown(summary) {
  return [
    "# DeepResponse Watch Simulator 10-Turn Experience",
    "",
    `Overall: **${summary.overall}**`,
    `Endpoint: \`${summary.endpoint}\``,
    `Report dir: \`${summary.reportDir}\``,
    `Session: \`${summary.sessionID || ""}\``,
    "",
    "## Evidence",
    "",
    `- Watch turns requested: ${summary.requiredTurns}`,
    `- Server turns observed: ${summary.turns?.length || 0}`,
    `- Audio audits: ${summary.audioAudits?.filter((audit) => audit.ok).length || 0}/${summary.audioAudits?.length || 0}`,
    `- Server events: ${summary.serverEventCount}`,
    "",
    "## Turns",
    "",
    "| # | Transcript | Assistant | Audio bytes | Timing |",
    "| --- | --- | --- | ---: | --- |",
    ...(summary.turns || []).map((turn, index) => `| ${index + 1} | ${turn.transcript} | ${turn.text} | ${turn.audioBytes} | ${turn.timing?.voice_pipeline_total_ms ?? ""}ms |`),
    "",
    "## Failures",
    "",
    ...(summary.failures?.length ? summary.failures.map((failure) => `- ${failure}`) : ["- none"]),
    ""
  ].join("\n");
}

function printHelp() {
  console.log(`Usage: node scripts/run-deep-response-watch-sim-experience.mjs [options]

Options:
  --endpoint <url>                    DeepResponse endpoint. Default: ${DEFAULT_ENDPOINT}
  --turns <n>                         Number of Watch fake-mic turns. Default: 10
  --out-dir <path>                    Report directory. Default: /private/tmp/deep-response-watch-sim-experience-<timestamp>
  --device <udid>                     watchOS simulator UDID.
  --derived-data <path>               Xcode derived data path. Default: ${DEFAULT_DERIVED_DATA}
  --skip-build                        Reuse an existing simulator build.
  --max-opening-stem-repeats <n>      Fail if any opening stem repeats too often. Default: 2
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseWatchSimExperienceArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runWatchSimExperience(args);
      console.log(JSON.stringify({
        overall: summary.overall,
        reportDir: summary.reportDir,
        summaryJson: summary.artifacts.summaryJson,
        failures: summary.failures
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
