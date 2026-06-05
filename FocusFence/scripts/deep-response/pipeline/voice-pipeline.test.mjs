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
    async generate({ transcript, streamFull, messages, maxTokens }) {
      llmCalls.push({ transcript, streamFull, messages, maxTokens });
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
  assert.equal(llmCalls[0].maxTokens, 72);
  assert.match(llmCalls[0].transcript, /我今天很累/);
  assert.doesNotMatch(llmCalls[0].transcript, /已经说过的第一句/);
  const prompt = llmCalls[0].messages.at(-1).content;
  assert.match(prompt, /第一句.*6-14 个中文字符/);
  assert.match(prompt, /第一句.*不要直接引用经文/);
  assert.match(prompt, /总长度控制在 45 个中文字符以内/);
  assert.match(prompt, /不要原样重复上一轮完整回复/);
  assert.match(prompt, /不要朗读整段经文/);
  assert.match(prompt, /如果用户是在要安慰/);
  assert.match(prompt, /不要说“我给你找一句”“我给你读一句”“你还想听”/);
  assert.match(prompt, /不要说“你还是想听安慰的话”“你又想听安慰的话”/);
  assert.match(prompt, /绝对不要说“你还想听安慰呀”/);
  assert.match(prompt, /不要把回答开成查经或找经文动作/);
  assert.match(prompt, /不要把安慰请求转成圣经知识问答/);
  assert.match(prompt, /不要问用户想从哪卷书或哪句经文开始/);
  assert.match(prompt, /不要问用户想从哪里开始听/);
  assert.match(prompt, /不要连续多轮都用同一个开头/);
});

test("VoicePipeline prompt explicitly forbids repeating previous assistant reply", async () => {
  let prompt = "";
  const asr = {
    async transcribe() {
      return {
        transcript: "今天我有点累，想听一句安慰的话。",
        timing: {}
      };
    }
  };
  const llm = {
    async generate({ messages }) {
      prompt = messages.at(-1).content;
      return {
        text: "我听见你又提到这份累。",
        firstPhrase: "我听见你又提到这份累。",
        timing: {}
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: {}
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2]) });
  await pipeline.runSegmented({
    audioChunks: [Buffer.from("voice")],
    context: [
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "那咱不听了，先好好歇着。主耶稣说过，他会赐给我们安息。" }
    ]
  });

  assert.match(prompt, /上一轮 assistant 回复：那咱不听了/);
  assert.match(prompt, /本轮禁止输出与上一轮相同/);
});

test("VoicePipeline prompt forbids repeating any recent assistant reply in session context", async () => {
  let prompt = "";
  const asr = {
    async transcribe() {
      return {
        transcript: "今天我有点累，想听一句安慰的话。",
        timing: {}
      };
    }
  };
  const llm = {
    async generate({ messages }) {
      prompt = messages.at(-1).content;
      return {
        text: "先把这口气放下。",
        firstPhrase: "先把这口气放下。",
        timing: {}
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: {}
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2]) });
  await pipeline.runSegmented({
    audioChunks: [Buffer.from("voice")],
    context: [
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "主与你同在。“我会坚固你，帮助你。”（以赛亚书 41:10）" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "那咱靠着主歇一歇。“我的恩典够你用的。”（哥林多后书 12:9）" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "主知道你累了。“凡劳苦担重担的人，可以到我这里来。”（马太福音 11:28）" }
    ]
  });

  assert.match(prompt, /最近 assistant 回复/);
  assert.match(prompt, /主与你同在/);
  assert.match(prompt, /那咱靠着主歇一歇/);
  assert.match(prompt, /主知道你累了/);
  assert.match(prompt, /本轮禁止输出与最近任意一条 assistant 回复相同/);
});

test("VoicePipeline prompt keeps enough assistant replies for the eight-turn conversation gate", async () => {
  let prompt = "";
  const asr = {
    async transcribe() {
      return {
        transcript: "今天我有点累，想听一句安慰的话。",
        timing: {}
      };
    }
  };
  const llm = {
    async generate({ messages }) {
      prompt = messages.at(-1).content;
      return {
        text: "这次我们换一种说法陪你慢下来。",
        firstPhrase: "这次我们换一种说法陪你慢下来。",
        timing: {}
      };
    }
  };
  const tts = {
    async synthesize({ text }) {
      return {
        audioChunks: [Buffer.from(text)],
        timing: {}
      };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2]) });
  await pipeline.runSegmented({
    audioChunks: [Buffer.from("voice")],
    context: [
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "那今天就歇着。主会成为你的力量，使你重新得力。" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "先别急着撑。主会扶住你，让你慢慢恢复气力。" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "你可以先停一下。主会成为你的避难所，陪你喘口气。" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "今天先把肩放松。主看见你的累，也会给你力量。" },
      { role: "user", content: "今天我有点累，想听一句安慰的话。" },
      { role: "assistant", content: "不用急着证明什么。主会托住你，让你重新站稳。" }
    ]
  });

  assert.match(prompt, /那今天就歇着/);
  assert.match(prompt, /先别急着撑/);
  assert.match(prompt, /你可以先停一下/);
  assert.match(prompt, /今天先把肩放松/);
  assert.match(prompt, /不用急着证明什么/);
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

test("VoicePipeline streamCascadeTurn normalizes lookup-style comfort openings before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你还想听安慰呀。《以赛亚书》里说，那等候耶和华的，必从新得力。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const textDeltas = events.filter((event) => event.type === "assistant_text_delta").map((event) => event.delta);
  const phrases = events.filter((event) => event.type === "assistant_phrase").map((event) => event.text);
  assert.equal(textDeltas[0], "我听见你真的累了。");
  assert(phrases.includes("那等候耶和华的，必从新得力。"));
  assert.deepEqual(ttsTexts, ["我听见你真的累了。", "那等候耶和华的，必从新得力。"]);
  assert.doesNotMatch(textDeltas.join(""), /你还想听/);
  assert.doesNotMatch(textDeltas.join(""), /《[^》]+》(?:里)?说/);
});

test("VoicePipeline streamCascadeTurn normalizes harsh repeated-comfort openings before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你还在喊累呀。《诗篇》里说，他必坚固你。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-harsh-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^我听见你真的累了。/);
  assert.doesNotMatch(text, /喊累/);
  assert.deepEqual(ttsTexts, ["我听见你真的累了。", "他必坚固你。"]);
});

test("VoicePipeline streamCascadeTurn normalizes awkward meta comfort openings before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那来句贴心的。“你们要休息，要知道我是神。”" };
      yield { type: "delta", delta: "那来靠一靠。主是你的避难所。" };
      yield { type: "delta", delta: "那缓缓神吧。“我的心哪，你当默默无声，专等候神。”" };
      yield { type: "delta", delta: "那听这句：“你们得力在乎平静安稳。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-awkward-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-awkward",
    generationID: "gen-awkward",
    maxSpokenReplyChars: 120
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^那我轻轻陪你一下。/);
  assert.match(text, /那我陪你靠一靠。/);
  assert.match(text, /那缓一缓吧。/);
  assert.match(text, /我陪你慢慢缓过来。/);
  assert.doesNotMatch(text, /那来|来句|听这句|缓缓神/);
  assert.deepEqual(ttsTexts, [
    "那我轻轻陪你一下。",
    "“你们要休息，要知道我是神。”",
    "那我陪你靠一靠。",
    "主是你的避难所。",
    "那缓一缓吧。",
    "“我的心哪，你当默默无声，专等候神。”",
    "我陪你慢慢缓过来。",
    "“你们得力在乎平静安稳。”"
  ]);
});

test("VoicePipeline streamCascadeTurn normalizes mechanical repeated-tired openings before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你今天还是觉得累。《诗篇》说，他会赐下能力，让你重新得力。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-mechanical-tired-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^我听见你真的累了。/);
  assert.doesNotMatch(text, /你今天还是觉得累|你又觉得累|你又感到累/);
  assert.deepEqual(ttsTexts, ["我听见你真的累了。", "他会赐下能力，让你重新得力。"]);
});

test("VoicePipeline streamCascadeTurn normalizes repeated-fatigue variants observed remotely", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你又感到疲惫了。《以赛亚书》里说，神会让你如鹰展翅上腾。" };
      yield { type: "delta", delta: "今天你又累了，我陪着你。主必赐你安息。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-fatigue-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^我听见你真的累了。/);
  assert.doesNotMatch(text, /今天你又累|你又累|你又感到疲惫|你又觉得疲惫/);
  assert.deepEqual(ttsTexts, [
    "我听见你真的累了。",
    "神会让你如鹰展翅上腾。",
    "我听见你真的累了。我陪着你。",
    "主必赐你安息。"
  ]);
});

test("VoicePipeline streamCascadeTurn rotates overused opening stems from context before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那咱再歇会儿。“你们要休息，要知道我是神。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-opening-rotated" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-3",
    generationID: "gen-3",
    maxSpokenReplyChars: 80,
    context: [
      { role: "assistant", content: "那咱就缓缓。“主是我的力量。”" },
      { role: "assistant", content: "那咱歇一下吧。“疲乏的，他赐能力。”" }
    ]
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^我陪你慢下来。/);
  assert.doesNotMatch(text, /^那咱/);
  assert.deepEqual(ttsTexts, ["我陪你慢下来。", "“你们要休息，要知道我是神。”"]);
});

test("VoicePipeline streamCascadeTurn rotates high-frequency comfort stems after one recent use", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "我在呢，这份累我和你一起担着。《诗篇》里说，“他必坚固你。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-high-frequency-opening-rotated" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-8",
    generationID: "gen-8",
    maxSpokenReplyChars: 80,
    context: [
      { role: "assistant", content: "我在呢，这累我陪你担着。《诗篇》里说，“他的右手扶持我。”" }
    ]
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.match(text, /^我陪你慢下来。/);
  assert.doesNotMatch(text, /^我在/);
  assert.deepEqual(ttsTexts, ["我陪你慢下来。", "“他必坚固你。”"]);
});

test("VoicePipeline streamCascadeTurn avoids repeating the previous opening stem", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "先把这口气放下。主会让你重新得力。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-previous-opening-rotated" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-previous-opening",
    generationID: "gen-previous-opening",
    maxSpokenReplyChars: 80,
    context: [
      { role: "assistant", content: "先把这口气放下。主会使你得力。" }
    ]
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.doesNotMatch(text, /^先把/);
  assert.notEqual(ttsTexts[0], "先把这口气放下。");
});

test("VoicePipeline streamCascadeTurn removes dangling particles after normalized comfort openings", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你还是感到累了。了。“主必赐你平安。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-dangling-particle-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "我听见你真的累了。“主必赐你平安。”");
  assert.doesNotMatch(text, /。了。/);
  assert.deepEqual(ttsTexts, ["我听见你真的累了。", "“主必赐你平安。”"]);
});

test("VoicePipeline streamCascadeTurn removes dangling modal particles after normalized comfort openings", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你还是觉得累了呢。“主必赐你平安。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-modal-particle-normalized" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "我听见你真的累了。“主必赐你平安。”");
  assert.doesNotMatch(text, /。呢。/);
  assert.deepEqual(ttsTexts, ["我听见你真的累了。", "“主必赐你平安。”"]);
});

test("VoicePipeline streamCascadeTurn removes repeated modal typo before speech", async () => {
  const spokenTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我有点累，想听一句安慰的话。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "不用硬撑着。主会赐下吗吗安息，让你恢复精力。" };
      yield { type: "done", timing: { llm_total_ms: 700 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      spokenTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(text), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2, 3]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    maxSpokenReplyChars: 48
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "不用硬撑着。主会赐下安息，让你恢复精力。");
  assert.doesNotMatch(text, /吗吗/u);
  assert.deepEqual(spokenTexts, ["不用硬撑着。", "主会赐下安息，让你恢复精力。"]);
});

test("VoicePipeline streamCascadeTurn removes dangling la particle after normalized tired opening", async () => {
  const spokenTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我有点累，想听一句安慰的话。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "你又累了啦。主会让你如鹰展翅上腾。" };
      yield { type: "done", timing: { llm_total_ms: 700 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      spokenTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(text), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2, 3]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    maxSpokenReplyChars: 48
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.doesNotMatch(text, /啦。/u);
  assert.equal(text, "我听见你真的累了。主会让你如鹰展翅上腾。");
  assert.deepEqual(spokenTexts, ["我听见你真的累了。", "主会让你如鹰展翅上腾。"]);
});

test("VoicePipeline streamCascadeTurn removes dangling quote lead-ins before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那咱靠着主歇会儿。主说：“到我这里来，我就使你们得安息。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-dangling-quote-lead-in" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 20
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "那咱靠着主歇会儿。");
  assert.doesNotMatch(text, /[：:]$/u);
  assert.deepEqual(ttsTexts, ["那咱靠着主歇会儿。"]);
});

test("VoicePipeline streamCascadeTurn removes formulaic scripture intro before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "我陪你慢下来。《诗篇》里说，“他必坚固你。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-formulaic-scripture-intro" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "我陪你慢下来。“他必坚固你。”");
  assert.doesNotMatch(text, /《诗篇》里说/);
  assert.deepEqual(ttsTexts, ["我陪你慢下来。", "“他必坚固你。”"]);
});

test("VoicePipeline streamCascadeTurn removes generic scripture lead-in before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那咱缓缓。经上说，“我的帮助从造天地的耶和华而来。”" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-generic-scripture-lead-in" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 80
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(text, "那咱缓缓。“我的帮助从造天地的耶和华而来。”");
  assert.doesNotMatch(text, /经上说|圣经说|主说|神说/);
  assert.deepEqual(ttsTexts, ["那咱缓缓。", "“我的帮助从造天地的耶和华而来。”"]);
});

test("VoicePipeline streamCascadeTurn removes biblical story analogies before speech", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我很累，想听一句安慰。", timing: { transcript_final_ms: 1000 } };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那今天就松快些。主会赐给你力量，像大卫面对歌利亚时那样。" };
      yield { type: "delta", delta: "不用硬撑着。主会赐下能力，像给摩西的杖那样。" };
      yield { type: "delta", delta: "先把这口气放下。主会赐下歇息的地方，像给以利亚的那棵树。" };
      yield { type: "delta", delta: "那咱就歇会儿。主会赐下平安，像赐给约书亚的那地。" };
      yield { type: "done", timing: { llm_first_token_ms: 100, llm_total_ms: 200 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 }, connectID: "tts-biblical-analogy" };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-1",
    generationID: "gen-1",
    maxSpokenReplyChars: 160
  })) {
    events.push(event);
  }

  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta)
    .join("");
  assert.equal(
    text,
    "那今天就松快些。主会赐给你力量。不用硬撑着。主会赐下能力。先把这口气放下。主会赐下歇息的地方。那咱就歇会儿。主会赐下平安。"
  );
  assert.doesNotMatch(text, /大卫|歌利亚|摩西|耶路撒冷城墙|牧人引领羊群|以利亚|约书亚/u);
  assert.deepEqual(ttsTexts, [
    "那今天就松快些。",
    "主会赐给你力量。",
    "不用硬撑着。",
    "主会赐下能力。",
    "先把这口气放下。",
    "主会赐下歇息的地方。",
    "那咱就歇会儿。",
    "主会赐下平安。"
  ]);
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

test("VoicePipeline streamCascadeTurn stops queuing TTS after short spoken reply limit", async () => {
  const ttsTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "我今天很累。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "我听见你今天很累。" };
      yield { type: "delta", delta: "我们先安静一下。" };
      yield { type: "delta", delta: "接下来我还想继续讲很多很多内容。" };
      yield { type: "done", timing: { llm_total_ms: 500 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      ttsTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 80 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 10, 20, 30]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    turnID: "turn-short",
    generationID: "gen-short",
    maxSpokenReplyChars: 18
  })) {
    events.push(event);
  }

  assert.deepEqual(ttsTexts, ["我听见你今天很累。", "我们先安静一下。"]);
  assert(!events.some((event) => event.type === "assistant_phrase" && /很多很多内容/u.test(event.text)));
  const done = events.find((event) => event.type === "turn_done");
  assert.equal(done.assistantText, "我听见你今天很累。我们先安静一下。");
  const timing = events.find((event) => event.type === "timing");
  assert.equal(timing.timing.reply_truncated_for_length, 1);
});

test("VoicePipeline streamCascadeTurn shortens an overlong first phrase before speech", async () => {
  const spokenTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_partial", transcript: "今天我有点累，想听一句安慰的话。" };
      yield { type: "transcript_final", transcript: "今天我有点累，想听一句安慰的话。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield {
        delta: "主会看顾你的。“我的神必照他荣耀的丰富，在基督耶稣里使你一切所需用的都充足。”"
      };
      yield { type: "done", timing: { llm_total_ms: 900 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      spokenTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(text), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2, 3]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    maxSpokenReplyChars: 48
  })) {
    events.push(event);
  }

  const deltas = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta);
  const phrases = events
    .filter((event) => event.type === "assistant_phrase")
    .map((event) => event.text);
  const timing = events.find((event) => event.type === "timing");

  assert.deepEqual(deltas, ["主会看顾你的。"]);
  assert.deepEqual(phrases, ["主会看顾你的。"]);
  assert.deepEqual(spokenTexts, ["主会看顾你的。"]);
  assert.equal(timing.timing.reply_truncated_for_length, 1);
});

test("VoicePipeline streamCascadeTurn adds a short fallback when truncation would leave a placeholder reply", async () => {
  const spokenTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我有点累，想停一下。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "那停一下吧。" };
      yield { type: "delta", delta: "“我的神必照他荣耀的丰富，在基督耶稣里使你一切所需用的都充足，也继续扶着你往前走。”" };
      yield { type: "done", timing: { llm_total_ms: 900 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      spokenTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(text), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2, 3]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    maxSpokenReplyChars: 48,
    minSpokenReplyChars: 8
  })) {
    events.push(event);
  }

  const deltas = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta);
  const phrases = events
    .filter((event) => event.type === "assistant_phrase")
    .map((event) => event.text);
  const done = events.find((event) => event.type === "turn_done");
  const timing = events.find((event) => event.type === "timing");

  assert.deepEqual(deltas, ["那停一下吧。", "我陪你慢慢缓过来。"]);
  assert.deepEqual(phrases, ["那停一下吧。", "我陪你慢慢缓过来。"]);
  assert.deepEqual(spokenTexts, ["那停一下吧。", "我陪你慢慢缓过来。"]);
  assert.equal(done.assistantText, "那停一下吧。我陪你慢慢缓过来。");
  assert.equal(timing.timing.reply_truncated_for_length, 1);
});

test("VoicePipeline streamCascadeTurn adds a short fallback when complete reply is below minimum", async () => {
  const spokenTexts = [];
  const asr = {
    async *transcribeStream() {
      yield { type: "transcript_final", transcript: "今天我有点累，想听一句安慰的话。" };
    }
  };
  const llm = {
    async *streamTokens() {
      yield { type: "delta", delta: "我陪你慢下来。" };
      yield { type: "done", timing: { llm_total_ms: 700 } };
    }
  };
  const tts = {
    async *synthesizeStream({ text }) {
      spokenTexts.push(text);
      yield { type: "audio_chunk", audioChunk: Buffer.from(text), sampleRate: 24000 };
      yield { type: "done", timing: { tts_first_audio_ms: 10 } };
    }
  };

  const pipeline = new VoicePipeline({ asr, llm, tts, clock: fakeClock([0, 1, 2, 3]) });
  const events = [];
  for await (const event of pipeline.streamCascadeTurn({
    audioChunks: [Buffer.from("voice")],
    maxSpokenReplyChars: 48,
    minSpokenReplyChars: 8
  })) {
    events.push(event);
  }

  const deltas = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta);
  const done = events.find((event) => event.type === "turn_done");
  const timing = events.find((event) => event.type === "timing");

  assert.deepEqual(deltas, ["我陪你慢下来。", "我陪你慢慢缓过来。"]);
  assert.deepEqual(spokenTexts, ["我陪你慢下来。", "我陪你慢慢缓过来。"]);
  assert.equal(done.assistantText, "我陪你慢下来。我陪你慢慢缓过来。");
  assert.equal(timing.timing.short_reply_fallback, 1);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
