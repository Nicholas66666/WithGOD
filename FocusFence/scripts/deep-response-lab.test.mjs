import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHTTPConversationArgs,
  summarizeTurn
} from "./test-deep-response-http-conversation.mjs";

test("parseHTTPConversationArgs accepts lab evidence mode", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "/tmp/speech.pcm",
    "--include-evidence"
  ]);

  assert.equal(args.includeEvidence, true);
});

test("summarizeTurn includes raw evidence only when requested", () => {
  const turn = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 400,
    firstAudioAt: 200,
    uploadChunks: 1,
    encodedUploadBytes: 4,
    decodedUploadBytes: 4,
    includeEvidence: true,
    events: [
      { seq: 1, type: "transcript_final", turnID: "turn-1", generationID: "gen-1", text: "hello", at: "now" },
      { seq: 2, type: "timing", turnID: "turn-1", generationID: "gen-1", timing: { llm_total_ms: 123 }, at: "now" },
      { seq: 3, type: "turn_done", turnID: "turn-1", generationID: "gen-1", at: "now" }
    ],
    audioChunks: [
      { seq: 1, turnID: "turn-1", generationID: "gen-1", audioBase64: "AQI=", audioByteLength: 2, sampleRate: 24_000 }
    ]
  });

  assert.equal(turn.evidence.events.length, 3);
  assert.equal(turn.evidence.audioChunks.length, 1);
  assert.equal(turn.evidence.audioChunks[0].audioBase64, "AQI=");

  const compact = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 400,
    firstAudioAt: 200,
    uploadChunks: 1,
    encodedUploadBytes: 4,
    decodedUploadBytes: 4,
    events: [],
    audioChunks: []
  });
  assert.equal(compact.evidence, undefined);
});

import {
  auditPCM16Audio,
  buildLabSummary,
  collectLabServerEvents,
  judgeLabResults,
  parseDeepResponseLabArgs
} from "./deep-response-lab.mjs";

test("parseDeepResponseLabArgs accepts self-test options", () => {
  const args = parseDeepResponseLabArgs([
    "--endpoint", "http://example.test:8797",
    "--out-dir", "/tmp/deep-lab",
    "--fixture", "/tmp/speech.pcm",
    "--turns", "5",
    "--watch-turns", "3",
    "--skip-build",
    "--skip-sim",
    "--fail-fast"
  ]);

  assert.equal(args.endpoint, "http://example.test:8797");
  assert.equal(args.outDir, "/tmp/deep-lab");
  assert.equal(args.fixturePath, "/tmp/speech.pcm");
  assert.equal(args.turns, 5);
  assert.equal(args.watchTurns, 3);
  assert.equal(args.skipBuild, true);
  assert.equal(args.skipSim, true);
  assert.equal(args.failFast, true);
});

test("auditPCM16Audio rejects silent audio", () => {
  const silent = Buffer.alloc(16_000 * 2);
  const audit = auditPCM16Audio(silent, { sampleRate: 16_000 });

  assert.equal(audit.ok, false);
  assert.match(audit.failures.join("\n"), /silent/i);
  assert.equal(audit.bytes, silent.byteLength);
  assert.equal(audit.durationMs, 1_000);
  assert.equal(audit.rms, 0);
  assert.equal(audit.peak, 0);
});

test("auditPCM16Audio passes non-silent audio and reports drain metrics", () => {
  const pcm = Buffer.alloc(16_000 * 2);
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    pcm.writeInt16LE(offset % 4 === 0 ? 2_000 : -2_000, offset);
  }

  const audit = auditPCM16Audio(pcm, { sampleRate: 16_000, actualDrainMs: 1_050 });

  assert.equal(audit.ok, true);
  assert.equal(audit.bytes, pcm.byteLength);
  assert.equal(audit.durationMs, 1_000);
  assert.equal(audit.expectedDrainMs, 1_000);
  assert.equal(audit.actualDrainMs, 1_050);
  assert.ok(audit.rms > 0);
  assert.ok(audit.peak > 0);
  assert.equal(audit.clippedSamples, 0);
});

test("buildLabSummary always contains five evidence categories", () => {
  const summary = buildLabSummary({
    reportDir: "/tmp/deep-lab",
    startedAt: "2026-06-05T00:00:00.000Z",
    finishedAt: "2026-06-05T00:01:00.000Z",
    mouth: {
      ok: true,
      scenarios: [
        { name: "normal_turn", ok: true },
        { name: "multi_turn", ok: true },
        { name: "silent_recovery", ok: true },
        { name: "goodbye_end", ok: true },
        { name: "interrupt_entry", ok: true }
      ]
    },
    eye: { ok: true, screenshots: ["running.png"] },
    ear: { ok: true, audits: [{ ok: true }] },
    server: { ok: true, sessions: [{ sessionID: "s1" }] }
  });

  assert.equal(summary.overall, "PASS");
  assert.equal(summary.reportDir, "/tmp/deep-lab");
  assert.equal(summary.mouth.ok, true);
  assert.equal(summary.eye.ok, true);
  assert.equal(summary.ear.ok, true);
  assert.equal(summary.server.ok, true);
  assert.equal(summary.judge.ok, true);
});

test("judgeLabResults fails when required scenarios are missing", () => {
  const judge = judgeLabResults({
    mouth: {
      ok: true,
      scenarios: [
        { name: "normal_turn", ok: true },
        { name: "multi_turn", ok: true }
      ]
    },
    eye: { ok: true, screenshots: ["running.png"] },
    ear: { ok: true, audits: [{ ok: true }] },
    server: { ok: true, sessions: [{ sessionID: "s1" }] }
  });

  assert.equal(judge.ok, false);
  assert.match(judge.failures.join("\n"), /silent_recovery/);
  assert.match(judge.failures.join("\n"), /goodbye_end/);
  assert.match(judge.failures.join("\n"), /interrupt_entry/);
});

test("collectLabServerEvents preserves lifecycle idle and abort evidence", () => {
  const events = collectLabServerEvents({
    conversation: {
      turns: [
        {
          evidence: {
            events: [
              { type: "turn_done", sessionID: "conversation", turnID: "turn-1", generationID: "gen-1" }
            ]
          }
        }
      ],
      sessionEnd: { type: "session_end", sessionID: "conversation", reason: "user_goodbye" },
      memoryCandidate: { type: "memory_candidate", sessionID: "conversation", summary: "User: hello" }
    },
    idle: {
      evidence: {
        events: [
          { type: "session_end", sessionID: "idle", reason: "idle_timeout" },
          { type: "audio_done", sessionID: "idle", reason: "idle_goodbye_complete" }
        ]
      }
    },
    abort: {
      evidence: {
        events: [
          { type: "abort", sessionID: "abort", turnID: "turn-abort", generationID: "gen-abort" }
        ]
      },
      nextTurn: {
        evidence: {
          events: [
            { type: "turn_done", sessionID: "abort", turnID: "turn-after-abort", generationID: "gen-after-abort" }
          ]
        }
      }
    }
  });

  assert.deepEqual(
    events.map((event) => [event.source, event.type, event.reason || ""]),
    [
      ["conversation_turn", "turn_done", ""],
      ["conversation_lifecycle", "session_end", "user_goodbye"],
      ["conversation_lifecycle", "memory_candidate", ""],
      ["idle", "session_end", "idle_timeout"],
      ["idle", "audio_done", "idle_goodbye_complete"],
      ["abort", "abort", ""],
      ["abort_next_turn", "turn_done", ""]
    ]
  );
});
