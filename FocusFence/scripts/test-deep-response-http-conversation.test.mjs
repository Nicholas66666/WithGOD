import test from "node:test";
import assert from "node:assert/strict";

import {
  collectSessionLifecycleEvents,
  collectForbiddenConversationTextFailures,
  parseHTTPConversationArgs,
  summarizeTurn
} from "./test-deep-response-http-conversation.mjs";

test("parseHTTPConversationArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--wait-ms", "750"
  ]);

  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.waitMs, 750);
});

test("parseHTTPConversationArgs accepts session-end validation options", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "fixtures/speech.pcm",
    "--turns", "8",
    "--end-reason", "user_goodbye",
    "--expect-session-end",
    "--expect-late-audio-409",
    "--expect-memory-candidate",
    "--expect-memory-persisted",
    "--expect-memory-recalled",
    "--forbid-text-pattern", "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"
  ]);

  assert.equal(args.turns, 8);
  assert.equal(args.endReason, "user_goodbye");
  assert.equal(args.expectSessionEnd, true);
  assert.equal(args.expectLateAudio409, true);
  assert.equal(args.expectMemoryCandidate, true);
  assert.equal(args.expectMemoryPersisted, true);
  assert.equal(args.expectMemoryRecalled, true);
  assert.deepEqual(args.forbiddenTextPatterns, ["你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"]);
});

test("summarizeTurn concatenates streaming text deltas without inserting spaces", () => {
  const summary = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 500,
    firstAudioAt: 250,
    uploadChunks: 1,
    encodedUploadBytes: 10,
    decodedUploadBytes: 10,
    events: [
      { type: "transcript_final", text: "今天我累。" },
      { type: "assistant_text_delta", delta: "我听见" },
      { type: "assistant_text_delta", delta: "你真的很累。" },
      { type: "timing", timing: { voice_pipeline_total_ms: 400 } }
    ],
    audioChunks: [{ audioByteLength: 100 }]
  });

  assert.equal(summary.text, "我听见你真的很累。");
  assert.equal(summary.stopToFirstAudioMs, 150);
});

test("summarizeTurn reports HTTP phrase and audio receive timing", () => {
  const summary = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 600,
    firstAudioAt: 260,
    uploadChunks: 1,
    encodedUploadBytes: 10,
    decodedUploadBytes: 10,
    events: [
      { type: "transcript_final", text: "今天我累。" },
      { type: "assistant_phrase", text: "我听见你。", receivedAtMs: 220 },
      { type: "assistant_text_delta", delta: "我听见你。" },
      { type: "timing", timing: { transcript_final_ms: 900 } }
    ],
    audioChunks: [{ audioByteLength: 100, receivedAtMs: 260 }]
  });

  assert.equal(summary.timing.http_stop_to_first_phrase_ms, 120);
  assert.equal(summary.timing.http_stop_to_first_audio_ms, 160);
  assert.equal(summary.timing.http_first_audio_after_first_phrase_ms, 40);
});

test("summarizeTurn records authoritative turn_done completion", () => {
  const summary = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 600,
    firstAudioAt: 260,
    uploadChunks: 1,
    encodedUploadBytes: 10,
    decodedUploadBytes: 10,
    events: [
      { type: "audio_done", generationID: "gen-1" },
      { type: "turn_done", generationID: "gen-1" }
    ],
    audioChunks: [{ audioByteLength: 100, receivedAtMs: 260 }]
  });

  assert.equal(summary.audioDone, true);
  assert.equal(summary.turnDone, true);
});

test("collectSessionLifecycleEvents keeps memory candidate from same batch as session end", () => {
  const state = collectSessionLifecycleEvents([
    { type: "memory_recalled", count: 2, store: "jsonl" },
    { type: "session_end", reason: "memory_probe_complete" },
    { type: "memory_candidate", summary: "User: tired" }
  ], {
    endReason: "memory_probe_complete",
    sessionEnd: null,
    memoryCandidate: null,
    memoryRecalled: null
  });

  assert.equal(state.sessionEnd.reason, "memory_probe_complete");
  assert.equal(state.memoryCandidate.summary, "User: tired");
  assert.equal(state.memoryRecalled.count, 2);
  assert.equal(state.memoryRecalled.store, "jsonl");
});

test("collectForbiddenConversationTextFailures flags turn text and memory summaries", () => {
  const failures = collectForbiddenConversationTextFailures({
    turns: [
      { turnID: "turn-1", text: "我听见你真的累了。" },
      { turnID: "turn-2", text: "你还想听安慰的话呀。《诗篇》里说，神是我们的避难所。" },
      { turnID: "turn-3", text: "你还在喊累呀。《诗篇》里说，神是我们的力量。" },
      { turnID: "turn-4", text: "你今天还是觉得累。《诗篇》说，他会赐下能力。" },
      { turnID: "turn-5", text: "你又感到疲惫了。《以赛亚书》里说，神会让你如鹰展翅上腾。" }
    ],
    memoryCandidate: {
      summary: "User: 今天我累\nAI: 你还是想听安慰的话呀。\nAI: 你还在喊累呀。\nAI: 你又觉得累了。\nAI: 你又累了。"
    }
  }, ["你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"]);

  assert.deepEqual(failures, [
    {
      source: "turn",
      turnID: "turn-2",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还想听安慰的话呀。《诗篇》里说，神是我们的避难所。"
    },
    {
      source: "turn",
      turnID: "turn-3",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还在喊累呀。《诗篇》里说，神是我们的力量。"
    },
    {
      source: "turn",
      turnID: "turn-4",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你今天还是觉得累。《诗篇》说，他会赐下能力。"
    },
    {
      source: "turn",
      turnID: "turn-5",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你又感到疲惫了。《以赛亚书》里说，神会让你如鹰展翅上腾。"
    },
    {
      source: "memory_candidate",
      turnID: "",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "User: 今天我累\nAI: 你还是想听安慰的话呀。\nAI: 你还在喊累呀。\nAI: 你又觉得累了。\nAI: 你又累了。"
    }
  ]);
});
