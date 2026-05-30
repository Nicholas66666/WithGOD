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

test("VoicePipeline creates first and followup spoken segments", async () => {
  const llmCalls = [];
  const asr = {
    async transcribe() {
      return {
        transcript: "我今天很累",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ transcript, streamFull }) {
      llmCalls.push({ transcript, streamFull });
      if (llmCalls.length === 1) {
        return {
          text: "我听见你真的很累。",
          firstPhrase: "我听见你真的很累。",
          timing: { llm_first_phrase_ms: 200 }
        };
      }
      return {
        text: "我们先停在这里，耶和华靠近伤心的人。",
        firstPhrase: "我们先停在这里，耶和华靠近伤心的人。",
        timing: { llm_followup_done_ms: 300 }
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: { tts_first_audio_ms: text.length }
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20]) });
  const result = await pipeline.runSegmented({
    audioChunks: [Buffer.from("voice")]
  });

  assert.equal(result.transcript, "我今天很累");
  assert.equal(result.first.text, "我听见你真的很累。");
  assert.equal(result.followup.text, "我们先停在这里，耶和华靠近伤心的人。");
  assert.equal(Buffer.concat(result.first.audioChunks).toString("utf8"), "我听见你真的很累。");
  assert.equal(Buffer.concat(result.followup.audioChunks).toString("utf8"), "我们先停在这里，耶和华靠近伤心的人。");
  assert.equal(llmCalls[0].streamFull, false);
  assert.equal(llmCalls[1].streamFull, true);
  assert.match(llmCalls[1].transcript, /不要重复已经说过的第一句/);
});

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
