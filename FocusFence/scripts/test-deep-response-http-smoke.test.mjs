import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDeepResponseServer } from "./deep-response-server.mjs";
import {
  collectDebugConfigFailures,
  collectForbiddenTextFailures,
  collectPartialStartFailures,
  collectRepeatedReplyFailures,
  parseHTTPSmokeArgs,
  runHTTPIdleProbe
} from "./test-deep-response-http-smoke.mjs";

test("parseHTTPSmokeArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPSmokeArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--wait-ms", "750",
    "--retries", "0",
    "--idle-timeout-ms", "50",
    "--idle-observe-ms", "1000",
    "--idle-goodbye",
    "--expect-abort-next-turn",
    "--expect-memory-recalled",
    "--expect-memory-persisted",
    "--expect-idle-memory-candidate",
    "--expect-llm-started-from-partial",
    "--expect-ark-model", "doubao-seed-character-251128",
    "--expect-ark-fallback-model", "",
    "--forbid-identical-consecutive-replies",
    "--forbid-text-pattern", "大卫.*歌利亚",
    "--forbid-text-pattern", "你知道.*为什么",
    "--forbid-text-pattern", "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"
  ]);

  assert.equal(args.pcmPath, "fixtures/speech.pcm");
  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.waitMs, 750);
  assert.equal(args.retries, 0);
  assert.equal(args.idleTimeoutMs, 50);
  assert.equal(args.idleObserveMs, 1000);
  assert.equal(args.idleGoodbye, true);
  assert.equal(args.expectAbortNextTurn, true);
  assert.equal(args.expectMemoryRecalled, true);
  assert.equal(args.expectMemoryPersisted, true);
  assert.equal(args.expectIdleMemoryCandidate, true);
  assert.equal(args.expectIdleMemoryPersisted, false);
  assert.equal(args.expectLLMStartedFromPartial, true);
  assert.equal(args.expectArkModel, "doubao-seed-character-251128");
  assert.equal(args.expectArkFallbackModel, "");
  assert.equal(args.forbidIdenticalConsecutiveReplies, true);
  assert.deepEqual(args.forbiddenTextPatterns, [
    "大卫.*歌利亚",
    "你知道.*为什么",
    "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"
  ]);
});

test("collectDebugConfigFailures flags Ark model drift", () => {
  assert.deepEqual(collectDebugConfigFailures({
    arkModel: "doubao-seed-2-0-lite-260215",
    arkFallbackModel: "doubao-seed-2-0-pro-260215"
  }, {
    expectArkModel: "doubao-seed-character-251128",
    expectArkFallbackModel: ""
  }), [
    {
      configField: "arkModel",
      expected: "doubao-seed-character-251128",
      actual: "doubao-seed-2-0-lite-260215"
    },
    {
      configField: "arkFallbackModel",
      expected: "",
      actual: "doubao-seed-2-0-pro-260215"
    }
  ]);
});

test("collectForbiddenTextFailures flags obvious comfort-intent derailments", () => {
  const failures = collectForbiddenTextFailures([
    { turnID: "turn-1", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" },
    { turnID: "turn-2", text: "我听见你很累，先慢慢歇一下。" }
  ], ["大卫.*歌利亚", "你知道.*为什么"]);

  assert.deepEqual(failures, [
    { turnID: "turn-1", forbiddenPattern: "大卫.*歌利亚", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" },
    { turnID: "turn-1", forbiddenPattern: "你知道.*为什么", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" }
  ]);
});

test("collectForbiddenTextFailures flags lookup-style and mechanical comfort replies", () => {
  const failures = collectForbiddenTextFailures([
    { turnID: "turn-1", text: "那我再给你找一句。《耶利米书》里说，神会赐你平安。" },
    { turnID: "turn-2", text: "你还想听的话，我们可以继续看一节经文。" },
    { turnID: "turn-3", text: "你还是想听安慰的话呀。《诗篇》里说，神是我们的避难所。" },
    { turnID: "turn-4", text: "你还在喊累呀。《诗篇》里说，他是你的力量。" },
    { turnID: "turn-5", text: "你今天还是觉得累。《诗篇》说，他会赐下能力。" },
    { turnID: "turn-6", text: "你又感到累了。《诗篇》说，他会赐下能力。" },
    { turnID: "turn-7", text: "你又感到疲惫了。《马太福音》里说，神会给你安息。" },
    { turnID: "turn-8", text: "你又累了。《诗篇》里说，神是你的力量。" },
    { turnID: "turn-9", text: "我听见你真的很累，我们先慢慢停一下。" }
  ], ["给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)"]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-1",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "那我再给你找一句。《耶利米书》里说，神会赐你平安。"
    },
    {
      turnID: "turn-2",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还想听的话，我们可以继续看一节经文。"
    },
    {
      turnID: "turn-3",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还是想听安慰的话呀。《诗篇》里说，神是我们的避难所。"
    },
    {
      turnID: "turn-4",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你还在喊累呀。《诗篇》里说，他是你的力量。"
    },
    {
      turnID: "turn-5",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你今天还是觉得累。《诗篇》说，他会赐下能力。"
    },
    {
      turnID: "turn-6",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你又感到累了。《诗篇》说，他会赐下能力。"
    },
    {
      turnID: "turn-7",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你又感到疲惫了。《马太福音》里说，神会给你安息。"
    },
    {
      turnID: "turn-8",
      forbiddenPattern: "给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)",
      text: "你又累了。《诗篇》里说，神是你的力量。"
    }
  ]);
});

test("collectPartialStartFailures flags turns that waited for ASR final", () => {
  const failures = collectPartialStartFailures([
    { turnID: "turn-1", timing: { llm_started_from_partial: 1 } },
    { turnID: "turn-2", timing: { transcript_final_ms: 4000 } }
  ]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      expected: "llm_started_from_partial",
      actual: ""
    }
  ]);
});

test("collectRepeatedReplyFailures flags identical consecutive assistant replies", () => {
  const failures = collectRepeatedReplyFailures([
    { turnID: "turn-1", text: "我在这里陪着你。" },
    { turnID: "turn-2", text: " 我在这里陪着你。 " },
    { turnID: "turn-3", text: "这一次我们先慢慢呼吸。" }
  ]);

  assert.deepEqual(failures, [
    {
      turnID: "turn-2",
      previousTurnID: "turn-1",
      repeatedText: "我在这里陪着你。"
    }
  ]);
});

test("runHTTPIdleProbe verifies idle session end and rejects late audio", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false
  });

  try {
    const summary = await runHTTPIdleProbe({
      endpoint: `http://127.0.0.1:${server.port}`,
      idleTimeoutMs: 20,
      idleObserveMs: 1_000,
      pollMs: 25
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.endReason, "idle_timeout");
    assert.equal(summary.rejectedStatus, 409);
  } finally {
    await server.close();
  }
});

test("runHTTPIdleProbe can require gentle idle goodbye audio before session end", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deep-response-idle-memory-"));
  const memoryPath = join(tempDir, "memory.jsonl");
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    env: {
      DEEP_RESPONSE_MEMORY_JSONL_PATH: memoryPath
    },
    createPipeline: () => ({
      tts: {
        async *synthesizeStream({ text }) {
          yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
          yield { type: "done", timing: {} };
        }
      }
    })
  });

  try {
    const summary = await runHTTPIdleProbe({
      endpoint: `http://127.0.0.1:${server.port}`,
      idleTimeoutMs: 20,
      idleObserveMs: 1_000,
      pollMs: 25,
      idleGoodbye: true,
      expectMemoryCandidate: true
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.endReason, "idle_timeout");
    assert.equal(summary.idleGoodbye.text.includes("拜拜"), true);
    assert.equal(summary.idleGoodbye.audioChunks, 1);
    assert.equal(summary.memoryCandidate.persisted, false);
    assert.equal(summary.memoryCandidate.store, "jsonl");
    assert.equal(summary.memoryCandidate.reason, "idle_timeout");
    assert.equal(typeof summary.memoryCandidate.summary, "string");
    assert.doesNotMatch(summary.memoryCandidate.summary, /我先安静到这里|愿你平安|拜拜/u);
    assert.equal(existsSync(memoryPath), false);
  } finally {
    await server.close();
  }
});
