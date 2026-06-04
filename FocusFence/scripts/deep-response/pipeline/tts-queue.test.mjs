import test from "node:test";
import assert from "node:assert/strict";

import { streamTTSQueue } from "./tts-queue.mjs";

test("streamTTSQueue synthesizes phrase chunks in order and tags audio chunks", async () => {
  const ttsCalls = [];
  const tts = {
    async *synthesizeStream({ text }) {
      ttsCalls.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:a`), sampleRate: 24000 };
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:b`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 }, connectID: `tts-${ttsCalls.length}` };
    }
  };

  const events = [];
  for await (const event of streamTTSQueue(tts, {
    turnID: "turn-1",
    generationID: "gen-1",
    phrases: [
      { index: 0, text: "我听见你真的很累。" },
      { index: 1, text: "我们先慢一点。" }
    ]
  })) {
    events.push(event);
  }

  assert.deepEqual(ttsCalls, ["我听见你真的很累。", "我们先慢一点。"]);
  assert.deepEqual(events.map((event) => event.type), [
    "audio_chunk",
    "audio_chunk",
    "tts_phrase_done",
    "audio_chunk",
    "audio_chunk",
    "tts_phrase_done",
    "tts_queue_done"
  ]);
  assert.equal(events[0].turnID, "turn-1");
  assert.equal(events[0].generationID, "gen-1");
  assert.equal(events[0].phraseIndex, 0);
  assert.equal(events[0].audioIndex, 0);
  assert.equal(events[0].audioChunk.toString("utf8"), "我听见你真的很累。:a");
  assert.equal(events[3].phraseIndex, 1);
  assert.equal(events[3].audioIndex, 0);
});

test("streamTTSQueue stops immediately when abort signal fires", async () => {
  const controller = new AbortController();
  let releaseSecondAudio;
  const secondAudioGate = new Promise((resolve) => {
    releaseSecondAudio = resolve;
  });
  const tts = {
    async *synthesizeStream({ text }) {
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:first`) };
      await secondAudioGate;
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:stale`) };
      yield { type: "done", timing: {} };
    }
  };

  const iterator = streamTTSQueue(tts, {
    turnID: "turn-1",
    generationID: "gen-1",
    phrases: [{ index: 0, text: "旧回复。" }],
    signal: controller.signal
  })[Symbol.asyncIterator]();

  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.audioChunk.toString("utf8"), "旧回复。:first");

  controller.abort();
  releaseSecondAudio();

  const done = await iterator.next();
  assert.equal(done.done, false);
  assert.equal(done.value.type, "tts_queue_aborted");
  assert.equal(done.value.generationID, "gen-1");
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});
