#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { chunkPCM16 } from "./test-deep-response-http-session.mjs";

export function parseHTTPConversationArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    turns: 2,
    chunkMs: 1000,
    uploadSleepMs: null,
    pollMs: 50,
    waitMs: 800,
    timeoutMs: 90_000,
    pipelineMode: "",
    endReason: "probe_complete",
    expectSessionEnd: false,
    expectLateAudio409: false,
    expectMemoryCandidate: false,
    expectMemoryPersisted: false,
    expectMemoryRecalled: false,
    expectLLMStartedFromPartial: false,
    expectAudioBeforeTurnDone: false,
    forbidRepeatedMemoryLines: false,
    forbidIdenticalConsecutiveReplies: false,
    maxOpeningStemRepeats: 0,
    maxMemoryOpeningStemRepeats: 0,
    maxAssistantReplyChars: 0,
    minAssistantReplyChars: 0,
    maxStopToFirstAudioMs: 0,
    maxFirstAudioAfterFirstPhraseMs: 0,
    forbiddenTextPatterns: [],
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--pcm") {
      args.pcmPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--turns") {
      args.turns = Number(argv[index + 1] || args.turns);
      index += 1;
    } else if (arg === "--chunk-ms") {
      args.chunkMs = Number(argv[index + 1] || args.chunkMs);
      index += 1;
    } else if (arg === "--upload-sleep-ms") {
      args.uploadSleepMs = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--poll-ms") {
      args.pollMs = Number(argv[index + 1] || args.pollMs);
      index += 1;
    } else if (arg === "--wait-ms") {
      args.waitMs = Number(argv[index + 1] || args.waitMs);
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      args.pipelineMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--end-reason") {
      args.endReason = argv[index + 1] || args.endReason;
      index += 1;
    } else if (arg === "--expect-session-end") {
      args.expectSessionEnd = true;
    } else if (arg === "--expect-late-audio-409") {
      args.expectLateAudio409 = true;
    } else if (arg === "--expect-memory-candidate") {
      args.expectMemoryCandidate = true;
    } else if (arg === "--expect-memory-persisted") {
      args.expectMemoryPersisted = true;
      args.expectMemoryCandidate = true;
    } else if (arg === "--expect-memory-recalled") {
      args.expectMemoryRecalled = true;
    } else if (arg === "--expect-llm-started-from-partial") {
      args.expectLLMStartedFromPartial = true;
    } else if (arg === "--expect-audio-before-turn-done") {
      args.expectAudioBeforeTurnDone = true;
    } else if (arg === "--forbid-repeated-memory-lines") {
      args.forbidRepeatedMemoryLines = true;
    } else if (arg === "--forbid-identical-consecutive-replies") {
      args.forbidIdenticalConsecutiveReplies = true;
    } else if (arg === "--max-opening-stem-repeats") {
      args.maxOpeningStemRepeats = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--max-memory-opening-stem-repeats") {
      args.maxMemoryOpeningStemRepeats = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--max-assistant-reply-chars") {
      args.maxAssistantReplyChars = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--min-assistant-reply-chars") {
      args.minAssistantReplyChars = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--max-stop-to-first-audio-ms") {
      args.maxStopToFirstAudioMs = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--max-first-audio-after-first-phrase-ms") {
      args.maxFirstAudioAfterFirstPhraseMs = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--forbid-text-pattern") {
      args.forbiddenTextPatterns.push(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--verbose") {
      args.verbose = true;
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

export async function runHTTPConversationProbe(args) {
  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const startedAt = performance.now();
  const pcm = readFileSync(args.pcmPath);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: args.chunkMs })];
  const uploadSleepMs = args.uploadSleepMs ?? args.chunkMs;
  const created = await postJSON(buildURL(args.endpoint, "/deep-response/sessions"), {
    sampleRate: 16_000,
    ...(args.pipelineMode ? { pipelineMode: args.pipelineMode } : {})
  });
  const sessionID = created.sessionID;
  const basePath = `/deep-response/sessions/${encodeURIComponent(sessionID)}`;
  let eventCursor = 0;
  let audioCursor = 0;
  let memoryRecalled = null;
  const turns = [];

  if (args.expectMemoryRecalled) {
    if (Number(created.memoryRecallCount || 0) <= 0) {
      throw new Error(`Expected memory recall count > 0, got ${JSON.stringify(created)}`);
    }
    await waitFor(async () => {
      const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}${buildWaitQuery(args.waitMs)}`));
      eventCursor = eventBatch.nextCursor;
      ({ memoryRecalled } = collectSessionLifecycleEvents(eventBatch.events, {
        memoryRecalled
      }));
      return Number(memoryRecalled?.count || 0) > 0;
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });
  }

  for (let turnIndex = 0; turnIndex < args.turns; turnIndex += 1) {
    const turnStartedAt = performance.now();
    const turnID = `turn_${Date.now()}_${turnIndex + 1}`;
    let encodedUploadBytes = 0;
    let decodedUploadBytes = 0;
    let firstAudioAt = null;
    const uploadStartedAt = performance.now();
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const uploaded = await postBytes(
        buildURL(args.endpoint, `${basePath}/audio?turn_id=${turnID}&seq=${chunkIndex}`),
        chunks[chunkIndex]
      );
      encodedUploadBytes += uploaded.encodedBytes || chunks[chunkIndex].byteLength;
      decodedUploadBytes += uploaded.bytes || chunks[chunkIndex].byteLength;
      if (uploadSleepMs > 0) {
        await sleep(uploadSleepMs);
      }
    }
    const uploadEndedAt = performance.now();
    const stopped = await postJSON(buildURL(args.endpoint, `${basePath}/input-stop`), { turnID });
    const generationID = stopped.generationID;
    const events = [];
    const audioChunks = [];

    await waitFor(async () => {
      const [eventResult, audioResult] = await Promise.all([
        fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}${buildWaitQuery(args.waitMs)}`))
          .then((batch) => ({
            batch,
            receivedAtMs: Math.round(performance.now() - turnStartedAt)
          })),
        fetchJSON(buildURL(args.endpoint, `${basePath}/audio?cursor=${audioCursor}&generation_id=${encodeURIComponent(generationID)}${buildWaitQuery(args.waitMs)}`))
          .then((batch) => ({
            batch,
            receivedAtMs: Math.round(performance.now() - turnStartedAt)
          }))
      ]);

      const eventBatch = eventResult.batch;
      eventCursor = eventBatch.nextCursor;
      const eventReceivedAtMs = eventResult.receivedAtMs;
      const turnEvents = eventBatch.events.filter((event) => event.turnID === turnID || event.type === "session_ready");
      events.push(...turnEvents.map((event) => ({ ...event, receivedAtMs: eventReceivedAtMs })));
      if (args.verbose && turnEvents.length > 0) {
        for (const event of turnEvents) {
          console.log("event", JSON.stringify(event));
        }
      }

      const audioBatch = audioResult.batch;
      audioCursor = audioBatch.nextCursor;
      const turnAudio = audioBatch.chunks.filter((chunk) => chunk.generationID === generationID);
      if (firstAudioAt == null && turnAudio.length > 0) {
        firstAudioAt = performance.now();
      }
      const audioReceivedAtMs = audioResult.receivedAtMs;
      audioChunks.push(...turnAudio.map((chunk) => ({ ...chunk, receivedAtMs: audioReceivedAtMs })));
      return events.some((event) => event.type === "timing" && event.generationID === generationID)
        && events.some((event) => event.type === "audio_done" && event.generationID === generationID)
        && events.some((event) => event.type === "turn_done" && event.generationID === generationID);
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });

    turns.push(summarizeTurn({
      turnID,
      generationID,
      turnStartedAt,
      uploadStartedAt,
      uploadEndedAt,
      endedAt: performance.now(),
      firstAudioAt,
      uploadChunks: chunks.length,
      encodedUploadBytes,
      decodedUploadBytes,
      events,
      audioChunks
    }));
  }

  const ended = await postJSON(buildURL(args.endpoint, `${basePath}/end`), { reason: args.endReason });
  let sessionEnd = null;
  let memoryCandidate = null;
  if (args.expectSessionEnd) {
    await waitFor(async () => {
      const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}${buildWaitQuery(args.waitMs)}`));
      eventCursor = eventBatch.nextCursor;
      ({ sessionEnd, memoryCandidate } = collectSessionLifecycleEvents(eventBatch.events, {
        endReason: args.endReason,
        sessionEnd,
        memoryCandidate,
        memoryRecalled
      }));
      return sessionEnd?.reason === args.endReason;
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });
  }
  if (args.expectMemoryCandidate && !memoryCandidate) {
    await waitFor(async () => {
      const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}${buildWaitQuery(args.waitMs)}`));
      eventCursor = eventBatch.nextCursor;
      ({ sessionEnd, memoryCandidate } = collectSessionLifecycleEvents(eventBatch.events, {
        endReason: args.endReason,
        sessionEnd,
        memoryCandidate,
        memoryRecalled
      }));
      return memoryCandidate?.summary;
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });
  }
  if (args.expectMemoryPersisted) {
    if (memoryCandidate?.persisted !== true || !memoryCandidate?.store) {
      throw new Error(`Expected persisted memory candidate, got ${JSON.stringify(memoryCandidate)}`);
    }
  }
  const forbiddenTextFailures = collectForbiddenConversationTextFailures({
    turns,
    memoryCandidate
  }, args.forbiddenTextPatterns);
  if (forbiddenTextFailures.length > 0) {
    throw new Error(`Forbidden conversation text failures: ${JSON.stringify(forbiddenTextFailures, null, 2)}`);
  }
  const repeatedMemoryLineFailures = args.forbidRepeatedMemoryLines
    ? collectRepeatedMemoryLineFailures(memoryCandidate)
    : [];
  if (repeatedMemoryLineFailures.length > 0) {
    throw new Error(`Repeated memory line failures: ${JSON.stringify(repeatedMemoryLineFailures, null, 2)}`);
  }
  const repeatedOpeningStemFailures = collectRepeatedOpeningStemFailures(turns, {
    maxRepeats: args.maxOpeningStemRepeats
  });
  if (repeatedOpeningStemFailures.length > 0) {
    throw new Error(`Repeated opening stem failures: ${JSON.stringify(repeatedOpeningStemFailures, null, 2)}`);
  }
  const repeatedMemoryOpeningStemFailures = collectRepeatedMemoryOpeningStemFailures(memoryCandidate, {
    maxRepeats: args.maxMemoryOpeningStemRepeats
  });
  if (repeatedMemoryOpeningStemFailures.length > 0) {
    throw new Error(`Repeated memory opening stem failures: ${JSON.stringify(repeatedMemoryOpeningStemFailures, null, 2)}`);
  }
  const repeatedReplyFailures = args.forbidIdenticalConsecutiveReplies
    ? collectRepeatedConversationReplyFailures(turns)
    : [];
  if (repeatedReplyFailures.length > 0) {
    throw new Error(`Repeated conversation reply failures: ${JSON.stringify(repeatedReplyFailures, null, 2)}`);
  }
  const longReplyFailures = collectLongConversationReplyFailures(turns, {
    maxChars: args.maxAssistantReplyChars
  });
  if (longReplyFailures.length > 0) {
    throw new Error(`Long conversation reply failures: ${JSON.stringify(longReplyFailures, null, 2)}`);
  }
  const shortReplyFailures = collectShortConversationReplyFailures(turns, {
    minChars: args.minAssistantReplyChars
  });
  if (shortReplyFailures.length > 0) {
    throw new Error(`Short conversation reply failures: ${JSON.stringify(shortReplyFailures, null, 2)}`);
  }
  const stopToFirstAudioFailures = collectStopToFirstAudioFailures(turns, {
    maxMs: args.maxStopToFirstAudioMs
  });
  if (stopToFirstAudioFailures.length > 0) {
    throw new Error(`Stop-to-first-audio failures: ${JSON.stringify(stopToFirstAudioFailures, null, 2)}`);
  }
  const firstAudioAfterFirstPhraseFailures = collectFirstAudioAfterFirstPhraseFailures(turns, {
    maxMs: args.maxFirstAudioAfterFirstPhraseMs
  });
  if (firstAudioAfterFirstPhraseFailures.length > 0) {
    throw new Error(`First-audio-after-first-phrase failures: ${JSON.stringify(firstAudioAfterFirstPhraseFailures, null, 2)}`);
  }
  const partialStartFailures = args.expectLLMStartedFromPartial
    ? collectConversationPartialStartFailures(turns)
    : [];
  if (partialStartFailures.length > 0) {
    throw new Error(`Conversation partial-start failures: ${JSON.stringify(partialStartFailures, null, 2)}`);
  }
  const audioBeforeTurnDoneFailures = args.expectAudioBeforeTurnDone
    ? collectAudioBeforeTurnDoneFailures(turns)
    : [];
  if (audioBeforeTurnDoneFailures.length > 0) {
    throw new Error(`Audio-before-turn-done failures: ${JSON.stringify(audioBeforeTurnDoneFailures, null, 2)}`);
  }

  let lateAudioRejected = null;
  if (args.expectLateAudio409) {
    const late = await fetch(buildURL(args.endpoint, `${basePath}/audio?turn_id=late-after-end&seq=0`), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late-audio")
    });
    let lateBody = null;
    try {
      lateBody = await late.json();
    } catch {
      lateBody = null;
    }
    lateAudioRejected = {
      status: late.status,
      error: lateBody?.error || ""
    };
    if (late.status !== 409 || lateBody?.error !== "session_ended") {
      throw new Error(`Expected late audio 409 session_ended, got ${late.status} ${JSON.stringify(lateBody)}`);
    }
  }

  return {
    ok: true,
    endpoint: args.endpoint,
    sessionID,
    ended,
    sessionEnd,
    memoryRecalled,
    memoryCandidate,
    forbiddenTextFailures,
    repeatedMemoryLineFailures,
    repeatedOpeningStemFailures,
    repeatedMemoryOpeningStemFailures,
    repeatedReplyFailures,
    longReplyFailures,
    shortReplyFailures,
    stopToFirstAudioFailures,
    firstAudioAfterFirstPhraseFailures,
    partialStartFailures,
    audioBeforeTurnDoneFailures,
    lateAudioRejected,
    elapsedMs: Math.round(performance.now() - startedAt),
    turns
  };
}

export function summarizeTurn({
  turnID,
  generationID,
  turnStartedAt,
  uploadStartedAt,
  uploadEndedAt,
  endedAt,
  firstAudioAt,
  uploadChunks,
  encodedUploadBytes,
  decodedUploadBytes,
  events,
  audioChunks
}) {
  const transcript = events.find((event) => event.type === "transcript_final")?.text || "";
  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta || "")
    .join("");
  const timing = events.find((event) => event.type === "timing")?.timing || null;
  const audioDone = events.some((event) => event.type === "audio_done" && event.generationID === generationID);
  const turnDoneEvent = events.find((event) => event.type === "turn_done" && event.generationID === generationID);
  const turnDone = Boolean(turnDoneEvent);
  const firstPhraseEvent = events.find((event) => event.type === "assistant_phrase");
  const firstAudioChunk = audioChunks[0] || null;
  const stopAtMs = Math.round(uploadEndedAt - turnStartedAt);
  const firstPhraseAtMs = Number.isFinite(firstPhraseEvent?.receivedAtMs) ? firstPhraseEvent.receivedAtMs : null;
  const firstAudioAtMs = Number.isFinite(firstAudioChunk?.receivedAtMs)
    ? firstAudioChunk.receivedAtMs
    : (firstAudioAt != null ? Math.round(firstAudioAt - turnStartedAt) : null);
  const timingWithHTTP = {
    ...(timing || {}),
    ...(firstPhraseAtMs != null ? { http_stop_to_first_phrase_ms: firstPhraseAtMs - stopAtMs } : {}),
    ...(firstAudioAtMs != null ? { http_stop_to_first_audio_ms: firstAudioAtMs - stopAtMs } : {}),
    ...(firstPhraseAtMs != null && firstAudioAtMs != null
      ? { http_first_audio_after_first_phrase_ms: firstAudioAtMs - firstPhraseAtMs }
      : {})
  };
  return {
    turnID,
    generationID,
    elapsedMs: Math.round(endedAt - turnStartedAt),
    uploadMs: Math.round(uploadEndedAt - uploadStartedAt),
    firstAudioMs: firstAudioAt != null ? Math.round(firstAudioAt - turnStartedAt) : null,
    stopToFirstAudioMs: firstAudioAt != null ? Math.round(firstAudioAt - uploadEndedAt) : null,
    uploadChunks,
    encodedUploadBytes,
    decodedUploadBytes,
    transcript,
    text,
    audioDone,
    turnDone,
    turnDoneReceivedAtMs: Number.isFinite(turnDoneEvent?.receivedAtMs) ? turnDoneEvent.receivedAtMs : null,
    audioByteLength: audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0),
    audioChunks: audioChunks.length,
    timing: timingWithHTTP
  };
}

export function collectSessionLifecycleEvents(events, {
  endReason = "",
  sessionEnd = null,
  memoryCandidate = null,
  memoryRecalled = null
} = {}) {
  for (const event of events || []) {
    if (event.type === "session_end" && (!endReason || event.reason === endReason)) {
      sessionEnd = event;
    } else if (event.type === "memory_candidate" && event.summary) {
      memoryCandidate = event;
    } else if (event.type === "memory_recalled" && Number(event.count || 0) > 0) {
      memoryRecalled = event;
    }
  }
  return { sessionEnd, memoryCandidate, memoryRecalled };
}

export function collectForbiddenConversationTextFailures({
  turns = [],
  memoryCandidate = null
} = {}, forbiddenTextPatterns = []) {
  const patterns = forbiddenTextPatterns
    .filter(Boolean)
    .map((pattern) => ({ source: pattern, regexp: new RegExp(pattern, "u") }));
  const failures = [];
  for (const turn of turns || []) {
    const text = turn?.text || "";
    for (const pattern of patterns) {
      if (pattern.regexp.test(text)) {
        failures.push({
          source: "turn",
          turnID: turn?.turnID || "",
          forbiddenPattern: pattern.source,
          text
        });
      }
    }
  }
  const memoryText = memoryCandidate?.summary || "";
  for (const pattern of patterns) {
    if (pattern.regexp.test(memoryText)) {
      failures.push({
        source: "memory_candidate",
        turnID: "",
        forbiddenPattern: pattern.source,
        text: memoryText
      });
    }
  }
  return failures;
}

export function collectRepeatedMemoryLineFailures(memoryCandidate = null) {
  const lines = String(memoryCandidate?.summary || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const counts = new Map();
  const samples = new Map();
  for (const line of lines) {
    const key = line.replace(/\s+/gu, "");
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!samples.has(key)) {
      samples.set(key, line);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({
      line: samples.get(key),
      count
    }));
}

export function collectRepeatedMemoryOpeningStemFailures(memoryCandidate = null, { maxRepeats = 0 } = {}) {
  const limit = Number(maxRepeats || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const groups = new Map();
  const lines = String(memoryCandidate?.summary || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^AI:\s*/u.test(line));
  for (const line of lines) {
    const openingStem = extractMemoryAssistantOpeningStem(line);
    if (!openingStem) {
      continue;
    }
    const group = groups.get(openingStem) || { openingStem, lines: [] };
    group.lines.push(line);
    groups.set(openingStem, group);
  }
  return [...groups.values()]
    .filter((group) => group.lines.length > limit)
    .map((group) => ({
      openingStem: group.openingStem,
      count: group.lines.length,
      maxRepeats: limit,
      lines: group.lines.slice(0, 3)
    }));
}

export function collectRepeatedOpeningStemFailures(turns = [], { maxRepeats = 0 } = {}) {
  const limit = Number(maxRepeats || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const groups = new Map();
  for (const turn of turns || []) {
    const text = String(turn?.text || "").trim();
    const openingStem = extractOpeningStem(text);
    if (!openingStem) {
      continue;
    }
    const group = groups.get(openingStem) || { openingStem, turnIDs: [], samples: [] };
    group.turnIDs.push(turn?.turnID || "");
    group.samples.push(text);
    groups.set(openingStem, group);
  }
  return [...groups.values()]
    .filter((group) => group.turnIDs.length > limit)
    .map((group) => ({
      openingStem: group.openingStem,
      count: group.turnIDs.length,
      maxRepeats: limit,
      turnIDs: group.turnIDs,
      samples: group.samples.slice(0, 3)
    }));
}

export function collectRepeatedConversationReplyFailures(turns = []) {
  const failures = [];
  const seen = new Map();
  for (const turn of turns || []) {
    const text = String(turn?.text || "").trim();
    const normalizedText = normalizeConversationReplyText(text);
    const previous = normalizedText ? seen.get(normalizedText) : null;
    if (previous) {
      failures.push({
        turnID: turn?.turnID || "",
        previousTurnID: previous.turnID,
        repeatedText: text
      });
    }
    if (normalizedText && !seen.has(normalizedText)) {
      seen.set(normalizedText, {
        turnID: turn?.turnID || "",
        normalizedText
      });
    }
  }
  return failures;
}

export function collectLongConversationReplyFailures(turns = [], { maxChars = 0 } = {}) {
  const limit = Number(maxChars || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const failures = [];
  for (const turn of turns || []) {
    const text = String(turn?.text || "").trim();
    const charCount = countConversationReplyChars(text);
    if (charCount > limit) {
      failures.push({
        turnID: turn?.turnID || "",
        maxChars: limit,
        charCount,
        text
      });
    }
  }
  return failures;
}

export function collectShortConversationReplyFailures(turns = [], { minChars = 0 } = {}) {
  const limit = Number(minChars || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const failures = [];
  for (const turn of turns || []) {
    const text = String(turn?.text || "").trim();
    const charCount = countConversationReplyChars(text);
    if (charCount < limit) {
      failures.push({
        turnID: turn?.turnID || "",
        minChars: limit,
        charCount,
        text
      });
    }
  }
  return failures;
}

export function collectStopToFirstAudioFailures(turns = [], { maxMs = 0 } = {}) {
  const limit = Number(maxMs || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const failures = [];
  for (const turn of turns || []) {
    const stopToFirstAudioMs = Number.isFinite(turn?.stopToFirstAudioMs)
      ? Number(turn.stopToFirstAudioMs)
      : null;
    if (stopToFirstAudioMs == null || stopToFirstAudioMs > limit) {
      failures.push({
        turnID: turn?.turnID || "",
        maxMs: limit,
        stopToFirstAudioMs,
        text: String(turn?.text || "").trim()
      });
    }
  }
  return failures;
}

export function collectFirstAudioAfterFirstPhraseFailures(turns = [], { maxMs = 0 } = {}) {
  const limit = Number(maxMs || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const failures = [];
  for (const turn of turns || []) {
    const firstAudioAfterFirstPhraseMs = Number.isFinite(turn?.timing?.http_first_audio_after_first_phrase_ms)
      ? Number(turn.timing.http_first_audio_after_first_phrase_ms)
      : null;
    if (firstAudioAfterFirstPhraseMs == null || firstAudioAfterFirstPhraseMs < 0 || firstAudioAfterFirstPhraseMs > limit) {
      failures.push({
        turnID: turn?.turnID || "",
        maxMs: limit,
        firstAudioAfterFirstPhraseMs,
        text: String(turn?.text || "").trim()
      });
    }
  }
  return failures;
}

export function collectConversationPartialStartFailures(turns = []) {
  return (turns || [])
    .filter((turn) => turn?.timing?.llm_started_from_partial !== 1)
    .map((turn) => ({
      turnID: turn?.turnID || "",
      expected: "llm_started_from_partial",
      actual: turn?.timing?.llm_started_from_partial == null ? "" : String(turn.timing.llm_started_from_partial)
    }));
}

export function collectAudioBeforeTurnDoneFailures(turns = []) {
  return (turns || [])
    .filter((turn) => {
      const firstAudioMs = Number.isFinite(turn?.firstAudioMs) ? Number(turn.firstAudioMs) : null;
      const turnDoneReceivedAtMs = Number.isFinite(turn?.turnDoneReceivedAtMs)
        ? Number(turn.turnDoneReceivedAtMs)
        : null;
      return firstAudioMs == null || turnDoneReceivedAtMs == null || firstAudioMs >= turnDoneReceivedAtMs;
    })
    .map((turn) => ({
      turnID: turn?.turnID || "",
      firstAudioMs: Number.isFinite(turn?.firstAudioMs) ? Number(turn.firstAudioMs) : null,
      turnDoneReceivedAtMs: Number.isFinite(turn?.turnDoneReceivedAtMs) ? Number(turn.turnDoneReceivedAtMs) : null,
      text: String(turn?.text || "").trim()
    }));
}

function normalizeConversationReplyText(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

function countConversationReplyChars(text) {
  return [...String(text || "").replace(/\s+/g, "")].length;
}

function extractOpeningStem(text) {
  const cleaned = String(text || "")
    .replace(/^[\s"'“”‘’]+/u, "")
    .trim();
  const match = cleaned.match(/^([\p{Script=Han}]{2})/u);
  return match ? match[1] : "";
}

function extractMemoryAssistantOpeningStem(line) {
  const cleaned = String(line || "")
    .replace(/^AI:\s*/u, "")
    .replace(/^[\s"'“”‘’]+/u, "")
    .trim();
  const match = cleaned.match(/^([^。！？；，,]{2,12})/u);
  return match ? match[1].trim() : "";
}

function buildURL(endpoint, path) {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return `${base}${path}`;
}

function buildWaitQuery(waitMs) {
  return Number(waitMs) > 0 ? `&wait_ms=${Math.round(Number(waitMs))}` : "";
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postBytes(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function waitFor(predicate, { timeoutMs = 2_000, intervalMs = 25 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error("waitFor timeout");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-http-conversation.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>      DeepResponse HTTP server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --turns <n>           Number of consecutive turns in one session. Default: 2
  --chunk-ms <ms>       Upload chunk duration. Default: 1000
  --upload-sleep-ms <ms>
                        Sleep after each upload. Default: chunk-ms. Use 0 for network drain timing.
  --poll-ms <ms>        Poll interval for events/audio. Default: 50
  --wait-ms <ms>        Server long-poll wait for events/audio. Default: 800
  --timeout-ms <ms>     Probe timeout. Default: 90000
  --pipeline-mode <m>   Optional HTTP session pipeline mode, e.g. cascade.
  --end-reason <reason> Reason sent to /end after all turns. Default: probe_complete
  --expect-session-end  Require a matching session_end event after /end.
  --expect-late-audio-409
                        Verify audio upload after session end returns 409 session_ended.
  --expect-memory-candidate
                        Require an async memory_candidate event after session end.
  --expect-memory-persisted
                        Require memory_candidate.persisted=true and a non-empty store.
  --expect-memory-recalled
                        Require session creation to recall persisted memory into context.
  --expect-llm-started-from-partial
                        Require every conversation turn to start LLM from usable ASR partial.
  --expect-audio-before-turn-done
                        Require first audio to arrive before turn_done for every turn.
  --forbid-identical-consecutive-replies
                        Fail if any assistant replies in the same session are identical.
  --max-memory-opening-stem-repeats <n>
                        Fail if any assistant opening phrase appears too often in memory summary.
  --max-assistant-reply-chars <n>
                        Fail if any assistant reply exceeds this spoken character budget.
  --max-stop-to-first-audio-ms <n>
                        Fail if any turn has no first audio or exceeds this latency budget after upload stops.
  --forbid-text-pattern <regex>
                        Fail if any turn text or memory summary matches the regex. Repeatable.
  --verbose             Print turn event batches.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseHTTPConversationArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runHTTPConversationProbe(args);
      console.log(JSON.stringify(summary, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
