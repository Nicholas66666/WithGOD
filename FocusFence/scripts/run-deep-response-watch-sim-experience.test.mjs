import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWatchExperienceSummary,
  findExperienceSessionID,
  parseWatchSimExperienceArgs,
  summarizeExperienceTurns
} from "./run-deep-response-watch-sim-experience.mjs";

test("parseWatchSimExperienceArgs defaults to the product 10-turn Fire experience gate", () => {
  const args = parseWatchSimExperienceArgs([]);

  assert.equal(args.endpoint, "http://124.174.96.149:8797");
  assert.equal(args.turns, 10);
  assert.equal(args.maxOpeningStemRepeats, 2);
  assert.equal(args.skipBuild, false);
});

test("findExperienceSessionID picks a post-start Watch session with enough completed turns", () => {
  const startedAt = "2026-06-05T05:00:00.000Z";
  const events = [
    { at: "2026-06-05T04:59:59.000Z", type: "http_session_created", sessionID: "old" },
    ...turnEvents("old", "o", 10, "2026-06-05T05:00:02.000Z"),
    { at: "2026-06-05T05:00:01.000Z", type: "http_session_created", sessionID: "short" },
    ...turnEvents("short", "s", 4, "2026-06-05T05:00:03.000Z"),
    { at: "2026-06-05T05:00:04.000Z", type: "http_session_created", sessionID: "target" },
    ...turnEvents("target", "t", 10, "2026-06-05T05:01:00.000Z")
  ];

  assert.equal(findExperienceSessionID(events, { startedAt, turns: 10 }), "target");
});

test("summarizeExperienceTurns records transcript text audio timing and completion evidence", () => {
  const events = [
    { type: "transcript_final", turnID: "t1", generationID: "g1", text: "我有点累" },
    { type: "assistant_text_delta", turnID: "t1", generationID: "g1", delta: "我陪你慢下来。" },
    { type: "audio_done", turnID: "t1", generationID: "g1" },
    { type: "timing", turnID: "t1", generationID: "g1", timing: { voice_pipeline_total_ms: 850 } },
    { type: "turn_done", turnID: "t1", generationID: "g1" }
  ];
  const audio = [
    { turnID: "t1", sampleRate: 24_000, audioByteLength: 1600, audioBase64: Buffer.alloc(1600, 1).toString("base64") }
  ];

  assert.deepEqual(summarizeExperienceTurns(events, audio), [{
    turnID: "t1",
    generationID: "g1",
    transcript: "我有点累",
    text: "我陪你慢下来。",
    opening: "我陪你慢下来。",
    openingStem: "我陪",
    audioDone: true,
    turnDone: true,
    timing: { voice_pipeline_total_ms: 850 },
    eventTypes: ["transcript_final", "assistant_text_delta", "audio_done", "timing", "turn_done"],
    audioChunks: 1,
    audioBytes: 1600,
    sampleRate: 24_000
  }]);
});

test("buildWatchExperienceSummary fails repeated opening stems from a real 10-turn path", () => {
  const summary = buildWatchExperienceSummary({
    endpoint: "http://example.test",
    outDir: "/tmp/out",
    startedAt: "2026-06-05T05:00:00.000Z",
    finishedAt: "2026-06-05T05:02:00.000Z",
    requiredTurns: 2,
    watch: { ok: true },
    sessionID: "session",
    debugEvents: [],
    sessionEvents: [],
    audioAudits: [okAudit("t1"), okAudit("t2")],
    turns: [
      okTurn({ turnID: "t1", text: "先把这口气放下。主会使你得力。" }),
      okTurn({ turnID: "t2", text: "先把这口气放下。主会扶住你。" })
    ]
  });

  assert.equal(summary.overall, "FAIL");
  assert(summary.failures.some((failure) => failure.includes("consecutive repeated opening stem 先把")));
  assert(summary.failures.some((failure) => failure.includes("repeated opening sentence")));
});

test("buildWatchExperienceSummary passes complete non-repeating turn evidence", () => {
  const turns = [
    okTurn({ turnID: "t1", text: "我陪你慢下来。先不用硬撑。" }),
    okTurn({ turnID: "t2", text: "先别急着撑住。把气放一放。" }),
    okTurn({ turnID: "t3", text: "这会儿慢一点。主会扶住你。" })
  ];
  const summary = buildWatchExperienceSummary({
    endpoint: "http://example.test",
    outDir: "/tmp/out",
    startedAt: "2026-06-05T05:00:00.000Z",
    finishedAt: "2026-06-05T05:02:00.000Z",
    requiredTurns: 3,
    watch: { ok: true },
    sessionID: "session",
    debugEvents: [],
    sessionEvents: [],
    audioAudits: turns.map((turn) => okAudit(turn.turnID)),
    turns
  });

  assert.equal(summary.overall, "PASS");
  assert.deepEqual(summary.failures, []);
});

function turnEvents(sessionID, prefix, count, at) {
  return Array.from({ length: count }, (_, index) => [
    { at, type: "http_session_input_stop", sessionID, turnID: `${prefix}${index}` },
    { at, type: "http_session_complete", sessionID, turnID: `${prefix}${index}` }
  ]).flat();
}

function okTurn({ turnID, text }) {
  return {
    turnID,
    generationID: `g-${turnID}`,
    transcript: "我有点累",
    text,
    opening: text.match(/^[^。]+。/u)?.[0] || text,
    openingStem: text.match(/^([\p{Script=Han}]{2})/u)?.[1] || "",
    audioDone: true,
    turnDone: true,
    timing: { voice_pipeline_total_ms: 900 },
    eventTypes: ["transcript_final", "assistant_text_delta", "audio_done", "timing", "turn_done"],
    audioChunks: 3,
    audioBytes: 4096,
    sampleRate: 24_000
  };
}

function okAudit(turnID) {
  return {
    turnID,
    ok: true,
    failures: [],
    bytes: 4096,
    durationMs: 86,
    rms: 0.1,
    peak: 0.4
  };
}
