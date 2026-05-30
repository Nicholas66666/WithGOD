import test from "node:test";
import assert from "node:assert/strict";

import { VoicePipeline } from "./voice-pipeline.mjs";

test("VoicePipeline orchestrates ASR to LLM to TTS and records timing", async () => {
  const asr = {
    async transcribe(chunks) {
      const collected = [];
      for await (const chunk of chunks) {
        collected.push(chunk);
      }
      return {
        transcript: `fixture-${collected.length}`,
        timing: {
          asr_ws_connect_ms: 1,
          asr_init_ms: 2,
          first_transcript_delta_ms: 3,
          transcript_final_ms: 4
        }
      };
    }
  };
  const llm = {
    async generate({ transcript }) {
      return {
        text: `${transcript}: 我听见你。`,
        firstPhrase: "我听见你。",
        timing: {
          llm_first_token_ms: 5,
          llm_first_phrase_ms: 6
        }
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: {
          tts_connect_ms: 7,
          tts_first_audio_ms: 8
        }
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10]) });
  const result = await pipeline.run({
    audioChunks: [Buffer.from("a"), Buffer.from("b")]
  });

  assert.equal(result.transcript, "fixture-2");
  assert.equal(result.firstPhrase, "我听见你。");
  assert.equal(result.audioByteLength, Buffer.byteLength("我听见你。"));
  assert.equal(result.timing.voice_pipeline_total_ms, 10);
  assert.equal(result.timing.tts_first_audio_ms, 8);
});

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
