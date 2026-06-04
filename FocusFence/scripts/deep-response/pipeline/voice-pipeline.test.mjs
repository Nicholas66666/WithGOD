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

test("VoicePipeline creates one complete spoken reply without followup generation", async () => {
  const llmCalls = [];
  const spokenTexts = [];
  const asr = {
    async transcribe() {
      return {
        transcript: "我今天很累",
        timing: { transcript_final_ms: 100 }
      };
    }
  };
  const llm = {
    async generate({ transcript, streamFull, messages }) {
      llmCalls.push({ transcript, streamFull, messages });
      return {
        text: "我听见你真的很累，我们先慢慢停一下，记得主靠近伤心的人。",
        firstPhrase: "我听见你真的很累，我们先慢慢停一下，记得主靠近伤心的人。",
        timing: { llm_first_token_ms: 120, llm_total_ms: 340 }
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      spokenTexts.push(text);
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
  assert.equal(result.first.text, "我听见你真的很累，我们先慢慢停一下，记得主靠近伤心的人。");
  assert.equal(result.followup.text, "");
  assert.equal(Buffer.concat(result.first.audioChunks).toString("utf8"), "我听见你真的很累，我们先慢慢停一下，记得主靠近伤心的人。");
  assert.deepEqual(result.followup.audioChunks, []);
  assert.deepEqual(spokenTexts, ["我听见你真的很累，我们先慢慢停一下，记得主靠近伤心的人。"]);
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].streamFull, true);
  assert.match(llmCalls[0].transcript, /我今天很累/);
  assert.doesNotMatch(llmCalls[0].transcript, /已经说过的第一句/);
  const prompt = llmCalls[0].messages.at(-1).content;
  assert.match(prompt, /第一句.*6-14 个中文字符/);
  assert.match(prompt, /第一句.*不要直接引用经文/);
});

test("VoicePipeline streamSegmented emits one reply segment and no followup segment", async () => {
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
    async generate({ transcript, streamFull, messages }) {
      llmCalls.push({ transcript, streamFull, messages });
      return {
        text: "我听见你真的很累，我们先慢一点。",
        firstPhrase: "我听见你真的很累，我们先慢一点。",
        timing: { llm_first_token_ms: 120, llm_total_ms: 300 }
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
  const events = [];
  for await (const event of pipeline.streamSegmented({ audioChunks: [Buffer.from("voice")] })) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ["transcript_final", "segment", "timing"]
  );
  assert.equal(events[1].segment, "reply");
  assert.equal(events[1].text, "我听见你真的很累，我们先慢一点。");
  assert.equal(Buffer.concat(events[1].audioChunks).toString("utf8"), "我听见你真的很累，我们先慢一点。");
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].streamFull, true);
  assert.match(llmCalls[0].messages.at(-1).content, /完整中文语音回复/);
});

test("VoicePipeline streamSegmented yields streaming reply audio before TTS completes", async () => {
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
    async generate() {
      return {
        text: "我听见你真的很累。",
        firstPhrase: "我听见你真的很累。",
        timing: { llm_total_ms: 200 }
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
      segment: "reply",
      text: "我听见你真的很累。"
    },
    done: false
  });

  const firstAudio = await iterator.next();
  assert.equal(firstAudio.done, false);
  assert.equal(firstAudio.value.type, "audio_chunk");
  assert.equal(firstAudio.value.segment, "reply");
  assert.equal(firstAudio.value.audioChunk.toString("utf8"), "我听见你真的很累。:first");

  releaseSecondAudio();
  const secondAudio = await iterator.next();
  assert.equal(secondAudio.done, false);
  assert.equal(secondAudio.value.type, "audio_chunk");
  assert.equal(secondAudio.value.segment, "reply");
  assert.equal(secondAudio.value.audioChunk.toString("utf8"), "我听见你真的很累。:second");
});

test("VoicePipeline streamSegmented with streaming ASR waits for final transcript before one reply", async () => {
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
      return {
        text: "听起来你今天真的有些累，我们先停一下，听听耶稣怎样安慰劳苦的人。",
        firstPhrase: "听起来你今天真的有些累，我们先停一下，听听耶稣怎样安慰劳苦的人。",
        timing: { llm_total_ms: 1200 }
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
        connectID: "tts-reply"
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

  const pendingNext = iterator.next();
  const early = await Promise.race([
    pendingNext.then(() => "yielded"),
    delay(10).then(() => "waiting")
  ]);
  assert.equal(early, "waiting");
  assert.equal(llmCalls.length, 0);

  releaseFinal();
  const finalTranscript = await pendingNext;
  assert.equal(finalTranscript.done, false);
  assert.equal(finalTranscript.value.type, "transcript_final");
  assert.equal(finalTranscript.value.transcript, "今天我有点累，想听一句安慰的话。");
  const replyText = await iterator.next();
  assert.equal(replyText.done, false);
  assert.equal(replyText.value.type, "segment_text");
  assert.equal(replyText.value.segment, "reply");
  assert.equal(replyText.value.text, "听起来你今天真的有些累，我们先停一下，听听耶稣怎样安慰劳苦的人。");
  const replyAudio = await iterator.next();
  assert.equal(replyAudio.done, false);
  assert.equal(replyAudio.value.type, "audio_chunk");
  assert.equal(replyAudio.value.segment, "reply");
  assert.equal(replyAudio.value.audioChunk.toString("utf8"), "听起来你今天真的有些累，我们先停一下，听听耶稣怎样安慰劳苦的人。:audio");
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].streamFull, true);
  assert.equal(llmCalls[0].transcript, "今天我有点累，想听一句安慰的话。");
});

test("VoicePipeline streamCascadeTurn emits first phrase audio before LLM stream completes", async () => {
  let releaseRemainingLLM;
  const remainingLLMGate = new Promise((resolve) => {
    releaseRemainingLLM = resolve;
  });
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_partial", transcript: "今天我很累" };
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens({ transcript }) {
      assert.equal(transcript, "今天我很累，想听一句安慰。");
      yield { type: "delta", delta: "我听见你真的很累。" };
      await remainingLLMGate;
      yield { type: "delta", delta: "我们先慢一点。" };
      yield { type: "done", timing: { llm_first_token_ms: 120, llm_total_ms: 500 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: `tts-${ttsTexts.length}` };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const iterator = pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1"
  })[Symbol.asyncIterator]();

  assert.deepEqual((await iterator.next()).value, {
    type: "transcript_partial",
    transcript: "今天我很累"
  });
  assert.deepEqual((await iterator.next()).value, {
    type: "transcript_final",
    transcript: "今天我很累，想听一句安慰。"
  });
  assert.deepEqual((await iterator.next()).value, {
    type: "assistant_text_delta",
    turnID: "turn-1",
    generationID: "gen-1",
    delta: "我听见你真的很累。"
  });
  assert.deepEqual((await iterator.next()).value, {
    type: "assistant_phrase",
    turnID: "turn-1",
    generationID: "gen-1",
    phraseIndex: 0,
    text: "我听见你真的很累。",
    reason: "punctuation"
  });

  const firstAudio = await iterator.next();
  assert.equal(firstAudio.done, false);
  assert.equal(firstAudio.value.type, "audio_chunk");
  assert.equal(firstAudio.value.generationID, "gen-1");
  assert.equal(firstAudio.value.phraseIndex, 0);
  assert.equal(firstAudio.value.audioChunk.toString("utf8"), "我听见你真的很累。:audio");
  assert.deepEqual(ttsTexts, ["我听见你真的很累。"]);

  const beforeRelease = await Promise.race([
    iterator.next().then(() => "yielded"),
    delay(10).then(() => "waiting")
  ]);
  assert.equal(beforeRelease, "waiting");

  releaseRemainingLLM();
  const remainingEvents = [];
  for await (const event of iterator) {
    remainingEvents.push(event);
  }
  assert(remainingEvents.some((event) => event.type === "assistant_phrase" && event.text === "我们先慢一点。"));
  assert(remainingEvents.some((event) => event.type === "audio_chunk" && event.phraseIndex === 1));
  const timing = remainingEvents.find((event) => event.type === "timing");
  assert.equal(typeof timing?.timing.voice_pipeline_total_ms, "number");
  assert.equal(remainingEvents.at(-1).type, "turn_done");
  assert.deepEqual(ttsTexts, ["我听见你真的很累。", "我们先慢一点。"]);
});

test("VoicePipeline streamCascadeTurn keeps reading LLM while first phrase TTS is active", async () => {
  let releaseFirstTTSDone;
  const firstTTSDoneGate = new Promise((resolve) => {
    releaseFirstTTSDone = resolve;
  });
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "我今天很累。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "我听见你很累。" };
      yield { type: "delta", delta: "我们先慢慢呼吸。" };
      yield { type: "done", timing: { llm_total_ms: 300 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:first`), sampleRate: 24000 };
      if (text === "我听见你很累。") {
        await firstTTSDoneGate;
      }
      yield { type: "done", timing: { tts_first_audio_ms: 80 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const iterator = pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1"
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, "transcript_final");
  assert.equal((await iterator.next()).value.delta, "我听见你很累。");
  assert.equal((await iterator.next()).value.type, "assistant_phrase");

  const eventsWhileFirstTTSIsOpen = [];
  for (let index = 0; index < 3; index += 1) {
    const next = await Promise.race([
      iterator.next(),
      delay(10).then(() => ({ value: { type: "timeout" }, done: false }))
    ]);
    eventsWhileFirstTTSIsOpen.push(next.value);
    if (next.value.type === "assistant_text_delta" && next.value.delta === "我们先慢慢呼吸。") {
      break;
    }
  }
  assert(eventsWhileFirstTTSIsOpen.some(
    (event) => event.type === "assistant_text_delta" && event.delta === "我们先慢慢呼吸。"
  ));

  releaseFirstTTSDone();
  const remainingEvents = [];
  for await (const event of iterator) {
    remainingEvents.push(event);
  }
  assert(remainingEvents.some((event) => event.type === "audio_chunk" && event.phraseIndex === 1));
});

test("VoicePipeline streamCascadeTurn starts LLM from usable partial transcript before ASR final", async () => {
  let releaseASRFinal;
  const asrFinalGate = new Promise((resolve) => {
    releaseASRFinal = resolve;
  });
  const llmTranscripts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_partial", transcript: "今天我真的很累" };
      await asrFinalGate;
      yield { type: "transcript_final", transcript: "今天我真的很累，想听一句安慰。", timing: { transcript_final_ms: 1400 } };
    }
  };
  const llm = {
    async *streamTokens({ transcript }) {
      llmTranscripts.push(transcript);
      yield { type: "delta", delta: "我听见你很累。" };
      yield { type: "done", timing: { llm_first_token_ms: 120, llm_total_ms: 260 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 70 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const iterator = pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-partial",
    generationID: "gen-partial"
  })[Symbol.asyncIterator]();

  assert.deepEqual((await iterator.next()).value, {
    type: "transcript_partial",
    transcript: "今天我真的很累"
  });

  assert.deepEqual((await iterator.next()).value, {
    type: "assistant_text_delta",
    turnID: "turn-partial",
    generationID: "gen-partial",
    delta: "我听见你很累。"
  });
  assert.equal((await iterator.next()).value.type, "assistant_phrase");
  const firstAudio = await iterator.next();
  assert.equal(firstAudio.value.type, "audio_chunk");
  assert.equal(firstAudio.value.audioChunk.toString("utf8"), "我听见你很累。:audio");
  assert.deepEqual(llmTranscripts, ["今天我真的很累"]);

  const pendingAfterAudio = iterator.next();
  const beforeFinal = await Promise.race([
    pendingAfterAudio.then(() => "yielded"),
    delay(10).then(() => "waiting")
  ]);
  assert.equal(beforeFinal, "waiting");

  releaseASRFinal();
  const firstAfterFinal = await pendingAfterAudio;
  const remainingEvents = [];
  remainingEvents.push(firstAfterFinal.value);
  for await (const event of iterator) {
    remainingEvents.push(event);
  }
  assert(remainingEvents.some(
    (event) => event.type === "transcript_final" && event.transcript === "今天我真的很累，想听一句安慰。"
  ));
  const done = remainingEvents.find((event) => event.type === "turn_done");
  assert.equal(done.transcript, "今天我真的很累，想听一句安慰。");
  const timing = remainingEvents.find((event) => event.type === "timing");
  assert.equal(timing.timing.llm_started_from_partial, 1);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
