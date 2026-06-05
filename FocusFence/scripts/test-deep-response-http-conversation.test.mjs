import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  collectSessionLifecycleEvents,
  collectForbiddenConversationTextFailures,
  collectRepeatedOpeningStemFailures,
  collectRepeatedMemoryOpeningStemFailures,
  collectRepeatedMemoryLineFailures,
  collectRepeatedConversationReplyFailures,
  collectLongConversationReplyFailures,
  collectShortConversationReplyFailures,
  collectStopToFirstAudioFailures,
  collectFirstAudioAfterFirstPhraseFailures,
  collectConversationPartialStartFailures,
  collectAudioBeforeTurnDoneFailures,
  parseHTTPConversationArgs,
  summarizeTurn
} from "./test-deep-response-http-conversation.mjs";

const conversationProbeSource = readFileSync("scripts/test-deep-response-http-conversation.mjs", "utf8");

test("HTTP conversation probe polls events and audio concurrently", () => {
  assert.match(conversationProbeSource, /Promise\.all\(\[/);
  assert.match(conversationProbeSource, /\/events\?cursor=/);
  assert.match(conversationProbeSource, /\/audio\?cursor=/);
  assert.match(conversationProbeSource, /generation_id=\$\{encodeURIComponent\(generationID\)\}/);
});

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
    "--expect-llm-started-from-partial",
    "--expect-audio-before-turn-done",
    "--forbid-repeated-memory-lines",
    "--forbid-identical-consecutive-replies",
    "--max-opening-stem-repeats", "2",
    "--max-memory-opening-stem-repeats", "2",
    "--max-assistant-reply-chars", "48",
    "--min-assistant-reply-chars", "8",
    "--max-stop-to-first-audio-ms", "3500",
    "--max-first-audio-after-first-phrase-ms", "1000",
    "--forbid-text-pattern", "[:：]\\s*$|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|是还想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"
  ]);

  assert.equal(args.turns, 8);
  assert.equal(args.endReason, "user_goodbye");
  assert.equal(args.expectSessionEnd, true);
  assert.equal(args.expectLateAudio409, true);
  assert.equal(args.expectMemoryCandidate, true);
  assert.equal(args.expectMemoryPersisted, true);
  assert.equal(args.expectMemoryRecalled, true);
  assert.equal(args.expectLLMStartedFromPartial, true);
  assert.equal(args.expectAudioBeforeTurnDone, true);
  assert.equal(args.forbidRepeatedMemoryLines, true);
  assert.equal(args.forbidIdenticalConsecutiveReplies, true);
  assert.equal(args.maxOpeningStemRepeats, 2);
  assert.equal(args.maxMemoryOpeningStemRepeats, 2);
  assert.equal(args.maxAssistantReplyChars, 48);
  assert.equal(args.minAssistantReplyChars, 8);
  assert.equal(args.maxStopToFirstAudioMs, 3500);
  assert.equal(args.maxFirstAudioAfterFirstPhraseMs, 1000);
  assert.deepEqual(args.forbiddenTextPatterns, ["[:：]\\s*$|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|是还想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"]);
});

test("collectConversationPartialStartFailures flags turns that waited for ASR final", () => {
  const failures = collectConversationPartialStartFailures([
    { turnID: "turn-1", timing: { llm_started_from_partial: 1 } },
    { turnID: "turn-2", timing: { llm_started_from_partial: 0 } },
    { turnID: "turn-3", timing: {} }
  ]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      expected: "llm_started_from_partial",
      actual: "0"
    },
    {
      turnID: "turn-3",
      expected: "llm_started_from_partial",
      actual: ""
    }
  ]);
});

test("collectAudioBeforeTurnDoneFailures flags non-streamed turn completion order", () => {
  const failures = collectAudioBeforeTurnDoneFailures([
    {
      turnID: "turn-1",
      firstAudioMs: 210,
      turnDoneReceivedAtMs: 480,
      text: "我陪你慢慢来。"
    },
    {
      turnID: "turn-2",
      firstAudioMs: 520,
      turnDoneReceivedAtMs: 520,
      text: "这轮音频和完成同时到达。"
    },
    {
      turnID: "turn-3",
      firstAudioMs: null,
      turnDoneReceivedAtMs: 500,
      text: "这轮没有音频。"
    }
  ]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      firstAudioMs: 520,
      turnDoneReceivedAtMs: 520,
      text: "这轮音频和完成同时到达。"
    },
    {
      turnID: "turn-3",
      firstAudioMs: null,
      turnDoneReceivedAtMs: 500,
      text: "这轮没有音频。"
    }
  ]);
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
      { type: "turn_done", generationID: "gen-1", receivedAtMs: 460 }
    ],
    audioChunks: [{ audioByteLength: 100, receivedAtMs: 260 }]
  });

  assert.equal(summary.audioDone, true);
  assert.equal(summary.turnDone, true);
  assert.equal(summary.turnDoneReceivedAtMs, 460);
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
      { turnID: "turn-5", text: "你又感到疲惫了。《以赛亚书》里说，神会让你如鹰展翅上腾。" },
      { turnID: "turn-6", text: "那缓缓神吧。“我的心哪，你当默默无声。”" },
      { turnID: "turn-7", text: "那听这句：“你们得力在乎平静安稳。”" },
      { turnID: "turn-8", text: "那来靠一靠。主是你的避难所。" }
    ],
    memoryCandidate: {
      summary: "User: 今天我累\nAI: 你还是想听安慰的话呀。\nAI: 你还在喊累呀。\nAI: 你又觉得累了。\nAI: 你又累了。"
    }
  }, [
    "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
    "那来|来句|听这句|缓缓神"
  ]);

  assert.deepEqual(failures, [
    {
      source: "turn",
      turnID: "turn-2",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还想听安慰的话呀。《诗篇》里说，神是我们的避难所。"
    },
    {
      source: "turn",
      turnID: "turn-3",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还在喊累呀。《诗篇》里说，神是我们的力量。"
    },
    {
      source: "turn",
      turnID: "turn-4",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你今天还是觉得累。《诗篇》说，他会赐下能力。"
    },
    {
      source: "turn",
      turnID: "turn-5",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你又感到疲惫了。《以赛亚书》里说，神会让你如鹰展翅上腾。"
    },
    {
      source: "turn",
      turnID: "turn-6",
      forbiddenPattern: "那来|来句|听这句|缓缓神",
      text: "那缓缓神吧。“我的心哪，你当默默无声。”"
    },
    {
      source: "turn",
      turnID: "turn-7",
      forbiddenPattern: "那来|来句|听这句|缓缓神",
      text: "那听这句：“你们得力在乎平静安稳。”"
    },
    {
      source: "turn",
      turnID: "turn-8",
      forbiddenPattern: "那来|来句|听这句|缓缓神",
      text: "那来靠一靠。主是你的避难所。"
    },
    {
      source: "memory_candidate",
      turnID: "",
      forbiddenPattern: "你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "User: 今天我累\nAI: 你还是想听安慰的话呀。\nAI: 你还在喊累呀。\nAI: 你又觉得累了。\nAI: 你又累了。"
    }
  ]);
});

test("collectRepeatedMemoryLineFailures flags repeated memory summary lines", () => {
  const failures = collectRepeatedMemoryLineFailures({
    summary: [
      "User: 今天我有点累，想听一句安慰的话。",
      "AI: 我陪你慢下来。",
      "User: 今天我有点累，想听一句安慰的话。",
      "AI: 我会记得你最近容易累。"
    ].join("\n")
  });

  assert.deepEqual(failures, [
    {
      line: "User: 今天我有点累，想听一句安慰的话。",
      count: 2
    }
  ]);
});

test("collectRepeatedMemoryOpeningStemFailures flags overused assistant memory openings", () => {
  const failures = collectRepeatedMemoryOpeningStemFailures({
    summary: [
      "User: 今天很累。",
      "AI: 我陪你慢下来。主会扶持你。",
      "AI: 我陪你慢下来。主会安慰你。",
      "AI: 我陪你慢下来。主会赐力量。",
      "AI: 先歇一歇吧。主会看顾你。"
    ].join("\n")
  }, { maxRepeats: 2 });

  assert.deepEqual(failures, [
    {
      openingStem: "我陪你慢下来",
      count: 3,
      maxRepeats: 2,
      lines: [
        "AI: 我陪你慢下来。主会扶持你。",
        "AI: 我陪你慢下来。主会安慰你。",
        "AI: 我陪你慢下来。主会赐力量。"
      ]
    }
  ]);
});

test("collectRepeatedOpeningStemFailures flags overused session openings", () => {
  const failures = collectRepeatedOpeningStemFailures([
    { turnID: "turn-1", text: "那咱就缓缓。“主是我的力量。”" },
    { turnID: "turn-2", text: "那咱歇一下吧。“疲乏的，他赐能力。”" },
    { turnID: "turn-3", text: "那你先歇一歇。“你们得力在乎平静安稳。”" },
    { turnID: "turn-4", text: "那咱再歇会儿。“你们要休息。”" },
    { turnID: "turn-5", text: "我陪你慢下来。“主必加添你的力量。”" }
  ], { maxRepeats: 2 });

  assert.deepEqual(failures, [
    {
      openingStem: "那咱",
      count: 3,
      maxRepeats: 2,
      turnIDs: ["turn-1", "turn-2", "turn-4"],
      samples: [
        "那咱就缓缓。“主是我的力量。”",
        "那咱歇一下吧。“疲乏的，他赐能力。”",
        "那咱再歇会儿。“你们要休息。”"
      ]
    }
  ]);
});

test("collectRepeatedConversationReplyFailures flags identical replies anywhere in the same session", () => {
  const failures = collectRepeatedConversationReplyFailures([
    { turnID: "turn-1", text: "你还没说完呢，是不是累得慌？“主赐能力给软弱的人。”" },
    { turnID: "turn-2", text: "我陪你慢下来。“主赐能力给软弱的人。”" },
    { turnID: "turn-3", text: " 你还没说完呢，是不是累得慌？“主赐能力给软弱的人。” " }
  ]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-3",
      previousTurnID: "turn-1",
      repeatedText: "你还没说完呢，是不是累得慌？“主赐能力给软弱的人。”"
    }
  ]);
});

test("collectLongConversationReplyFailures flags overlong assistant replies", () => {
  const failures = collectLongConversationReplyFailures([
    { turnID: "turn-1", text: "主会看顾你的。“我的神必照他荣耀的丰富，在基督耶稣里使你一切所需用的都充足，也继续扶着你往前走。”" },
    { turnID: "turn-2", text: "我陪你慢下来。“我的恩典够你用的。”" }
  ], { maxChars: 48 });

  assert.deepEqual(failures, [
    {
      turnID: "turn-1",
      maxChars: 48,
      charCount: 49,
      text: "主会看顾你的。“我的神必照他荣耀的丰富，在基督耶稣里使你一切所需用的都充足，也继续扶着你往前走。”"
    }
  ]);
});

test("collectShortConversationReplyFailures flags placeholder-length assistant replies", () => {
  const failures = collectShortConversationReplyFailures([
    { turnID: "turn-1", text: "那停一下吧。" },
    { turnID: "turn-2", text: "那咱缓缓。“你们要休息，要知道我是神。”" },
    { turnID: "turn-3", text: "" }
  ], { minChars: 8 });

  assert.deepEqual(failures, [
    {
      turnID: "turn-1",
      minChars: 8,
      charCount: 6,
      text: "那停一下吧。"
    },
    {
      turnID: "turn-3",
      minChars: 8,
      charCount: 0,
      text: ""
    }
  ]);
});

test("collectStopToFirstAudioFailures flags long-tail first audio latency", () => {
  const failures = collectStopToFirstAudioFailures([
    { turnID: "turn-1", stopToFirstAudioMs: 1840, text: "我陪你。" },
    { turnID: "turn-2", stopToFirstAudioMs: 5119, text: "我在这里。" },
    { turnID: "turn-3", stopToFirstAudioMs: null, text: "这轮没有音频。" }
  ], { maxMs: 3000 });

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      maxMs: 3000,
      stopToFirstAudioMs: 5119,
      text: "我在这里。"
    },
    {
      turnID: "turn-3",
      maxMs: 3000,
      stopToFirstAudioMs: null,
      text: "这轮没有音频。"
    }
  ]);
});

test("collectFirstAudioAfterFirstPhraseFailures flags delayed phrase-to-audio cascade", () => {
  const failures = collectFirstAudioAfterFirstPhraseFailures([
    {
      turnID: "turn-1",
      timing: { http_first_audio_after_first_phrase_ms: 120 },
      text: "我陪你慢下来。"
    },
    {
      turnID: "turn-2",
      timing: { http_first_audio_after_first_phrase_ms: 1250 },
      text: "这一轮 TTS 等太久。"
    },
    {
      turnID: "turn-3",
      timing: {},
      text: "这一轮没有 phrase/audio 顺序。"
    }
  ], { maxMs: 1000 });

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      maxMs: 1000,
      firstAudioAfterFirstPhraseMs: 1250,
      text: "这一轮 TTS 等太久。"
    },
    {
      turnID: "turn-3",
      maxMs: 1000,
      firstAudioAfterFirstPhraseMs: null,
      text: "这一轮没有 phrase/audio 顺序。"
    }
  ]);
});
