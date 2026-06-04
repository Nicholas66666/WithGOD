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

test("VoicePipeline retries an invalid scripture quote first phrase", async () => {
  const llmCalls = [];
  const asr = {
    async transcribe() {
      return {
        transcript: "今天我有点累，想听一句安慰的话。",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ messages, streamFull }) {
      llmCalls.push({ messages, streamFull });
      if (llmCalls.length === 1) {
        return {
          text: "主耶稣说：“凡劳苦担重担的人。",
          firstPhrase: "主耶稣说：“凡劳苦担重担的人。",
          timing: { llm_first_phrase_ms: 200 }
        };
      }
      if (llmCalls.length === 2) {
        return {
          text: "我听见你今天真的很累。",
          firstPhrase: "我听见你今天真的很累。",
          timing: { llm_first_phrase_ms: 120 }
        };
      }
      return {
        text: "我们先把这口气慢慢放下来。",
        firstPhrase: "我们先把这口气慢慢放下来。",
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

  assert.equal(result.first.text, "我听见你今天真的很累。");
  assert.equal(Buffer.concat(result.first.audioChunks).toString("utf8"), "我听见你今天真的很累。");
  assert.equal(llmCalls.length, 3);
  assert.equal(llmCalls[0].streamFull, false);
  assert.equal(llmCalls[1].streamFull, false);
  assert.match(llmCalls[1].messages.at(-1).content, /刚才这句不适合作为语音首句/);
  assert.equal(result.timing.llm_first_phrase_retry_count, 1);
});

test("VoicePipeline can use a local first phrase template before followup LLM", async () => {
  const llmCalls = [];
  const asr = {
    async transcribe() {
      return {
        transcript: "我今天有点累",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ transcript, streamFull }) {
      llmCalls.push({ transcript, streamFull });
      return {
        text: "我们先停一下，慢慢呼吸。",
        firstPhrase: "我们先停一下，慢慢呼吸。",
        timing: { llm_first_phrase_ms: 200 }
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: { tts_first_audio_ms: 10 }
      };
    }
  };

  const pipeline = new VoicePipeline({
    asr,
    llm,
    tts,
    firstPhraseMode: "template",
    clock: fakeClock([0, 10, 20])
  });
  const result = await pipeline.runSegmented({
    audioChunks: [Buffer.from("voice")]
  });

  assert.equal(result.first.text, "我听见你真的很累。");
  assert.equal(result.timing.llm_first_phrase_ms, 0);
  assert.equal(result.timing.llm_first_phrase_mode, "template");
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].streamFull, true);
  assert.match(llmCalls[0].transcript, /已经说过的第一句：我听见你真的很累。/);
});

test("VoicePipeline streamSegmented yields first audio before followup generation finishes", async () => {
  let releaseFollowup;
  const followupStarted = new Promise((resolve) => {
    releaseFollowup = resolve;
  });
  const asr = {
    async transcribe() {
      return {
        transcript: "我今天很累",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ streamFull }) {
      if (!streamFull) {
        return {
          text: "我听见你真的很累。",
          firstPhrase: "我听见你真的很累。",
          timing: { llm_first_phrase_ms: 200 }
        };
      }
      await followupStarted;
      return {
        text: "我们先停在这里。",
        firstPhrase: "我们先停在这里。",
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

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const iterator = pipeline.streamSegmented({
    audioChunks: [Buffer.from("voice")]
  })[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), {
    value: {
      type: "transcript_final",
      transcript: "我今天很累"
    },
    done: false
  });

  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.type, "segment");
  assert.equal(first.value.segment, "first");
  assert.equal(first.value.text, "我听见你真的很累。");
  assert.equal(Buffer.concat(first.value.audioChunks).toString("utf8"), "我听见你真的很累。");

  releaseFollowup();
  const followup = await iterator.next();
  assert.equal(followup.done, false);
  assert.equal(followup.value.type, "segment");
  assert.equal(followup.value.segment, "followup");
});

test("VoicePipeline streamSegmented yields streaming TTS audio before TTS completes", async () => {
  let releaseSecondAudio;
  const secondAudioGate = new Promise((resolve) => {
    releaseSecondAudio = resolve;
  });
  const asr = {
    async transcribe() {
      return {
        transcript: "我今天很累",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ streamFull }) {
      if (!streamFull) {
        return {
          text: "我听见你真的很累。",
          firstPhrase: "我听见你真的很累。",
          timing: { llm_first_phrase_ms: 200 }
        };
      }
      return {
        text: "",
        firstPhrase: "",
        timing: {}
      };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      yield {
        type: "audio_chunk",
        audioChunk: Buffer.from(`${text}:first`),
        sampleRate: 24000
      };
      await secondAudioGate;
      yield {
        type: "audio_chunk",
        audioChunk: Buffer.from(`${text}:second`),
        sampleRate: 24000
      };
      yield {
        type: "done",
        timing: { tts_first_audio_ms: 10, tts_total_ms: 30 },
        connectID: "tts-stream"
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const iterator = pipeline.streamSegmented({
    audioChunks: [Buffer.from("voice")]
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, "transcript_final");
  assert.deepEqual(await iterator.next(), {
    value: {
      type: "segment_text",
      segment: "first",
      text: "我听见你真的很累。"
    },
    done: false
  });

  const firstAudio = await iterator.next();
  assert.equal(firstAudio.done, false);
  assert.equal(firstAudio.value.type, "audio_chunk");
  assert.equal(firstAudio.value.segment, "first");
  assert.equal(firstAudio.value.audioChunk.toString("utf8"), "我听见你真的很累。:first");

  releaseSecondAudio();
  const secondAudio = await iterator.next();
  assert.equal(secondAudio.done, false);
  assert.equal(secondAudio.value.type, "audio_chunk");
  assert.equal(secondAudio.value.audioChunk.toString("utf8"), "我听见你真的很累。:second");
});

test("VoicePipeline streamSegmented can speak AI first phrase from ASR partial before final transcript", async () => {
  let releaseFinal;
  const finalGate = new Promise((resolve) => {
    releaseFinal = resolve;
  });
  const asr = {
    async *transcribeStream() {
      yield {
        type: "transcript_delta",
        transcript: "今天我有点累",
        timing: { first_transcript_delta_ms: 500 }
      };
      await finalGate;
      yield {
        type: "transcript_final",
        transcript: "今天我有点累，想听一句安慰的话。",
        timing: {
          first_transcript_delta_ms: 500,
          transcript_final_ms: 3500
        },
        connectID: "asr-stream"
      };
    }
  };
  const llmCalls = [];
  const llm = {
    async generate({ transcript, streamFull }) {
      llmCalls.push({ transcript, streamFull });
      if (!streamFull) {
        return {
          text: "听起来你今天真的有些累。",
          firstPhrase: "听起来你今天真的有些累。",
          timing: { llm_first_phrase_ms: 700 }
        };
      }
      return {
        text: "我们先停一下，听听耶稣怎样安慰劳苦的人。",
        firstPhrase: "我们先停一下，听听耶稣怎样安慰劳苦的人。",
        timing: { llm_first_phrase_ms: 1200 }
      };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      yield {
        type: "audio_chunk",
        audioChunk: Buffer.from(`${text}:audio`),
        sampleRate: 24000
      };
      yield {
        type: "done",
        timing: { tts_first_audio_ms: 600 },
        connectID: "tts-first"
      };
    }
  };

  const pipeline = new VoicePipeline({
    asr,
    llm,
    tts,
    clock: fakeClock([0, 10, 20, 30])
  });
  const iterator = pipeline.streamSegmented({
    audioChunks: [Buffer.from("voice")]
  })[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), {
    value: {
      type: "segment_text",
      segment: "first",
      text: "听起来你今天真的有些累。"
    },
    done: false
  });
  const firstAudio = await iterator.next();
  assert.equal(firstAudio.done, false);
  assert.equal(firstAudio.value.type, "audio_chunk");
  assert.equal(firstAudio.value.segment, "first");
  assert.equal(firstAudio.value.audioChunk.toString("utf8"), "听起来你今天真的有些累。:audio");
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].streamFull, false);
  assert.match(llmCalls[0].transcript, /今天我有点累/);

  releaseFinal();
  const finalTranscript = await iterator.next();
  assert.equal(finalTranscript.done, false);
  assert.equal(finalTranscript.value.type, "transcript_final");
  assert.equal(finalTranscript.value.transcript, "今天我有点累，想听一句安慰的话。");
  const followupText = await iterator.next();
  assert.equal(followupText.done, false);
  assert.equal(followupText.value.type, "segment_text");
  assert.equal(followupText.value.segment, "followup");
  assert.equal(llmCalls.length, 2);
  assert.equal(llmCalls[1].streamFull, true);
  assert.match(llmCalls[1].transcript, /今天我有点累，想听一句安慰的话。/);
});

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
