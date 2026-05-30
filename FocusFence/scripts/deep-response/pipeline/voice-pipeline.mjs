export class VoicePipeline {
  constructor({ asr, llm, tts, clock = performance.now.bind(performance) }) {
    this.asr = asr;
    this.llm = llm;
    this.tts = tts;
    this.clock = clock;
  }

  async run({ audioChunks, context = [], signal } = {}) {
    const startedAt = this.clock();
    const asrResult = await this.asr.transcribe(toAsyncIterable(audioChunks), { signal });
    const llmResult = await this.llm.generate({
      transcript: asrResult.transcript,
      context,
      signal
    });
    const ttsResult = await this.tts.synthesize({
      text: llmResult.firstPhrase || llmResult.text,
      signal
    });

    const audioChunksOut = ttsResult.audioChunks || [];
    const audioByteLength = audioChunksOut.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const timing = {
      ...asrResult.timing,
      ...llmResult.timing,
      ...ttsResult.timing,
      first_playable_audio_ms: ttsResult.timing?.tts_first_audio_ms,
      voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
    };

    return {
      transcript: asrResult.transcript,
      responseText: llmResult.text,
      firstPhrase: llmResult.firstPhrase,
      audioChunks: audioChunksOut,
      audioByteLength,
      timing,
      providerMeta: {
        asrConnectID: asrResult.connectID,
        ttsConnectID: ttsResult.connectID,
        ttsMode: ttsResult.mode || "websocket"
      }
    };
  }

  async runSegmented({ audioChunks, context = [], signal } = {}) {
    const startedAt = this.clock();
    const asrResult = await this.asr.transcribe(toAsyncIterable(audioChunks), { signal });
    const firstLLM = await this.llm.generate({
      transcript: asrResult.transcript,
      context,
      signal,
      streamFull: false,
      maxTokens: 80,
      minChars: 14
    });
    const firstText = firstLLM.firstPhrase || firstLLM.text || "";
    const firstTTS = await this.tts.synthesize({
      text: firstText,
      signal
    });

    const followupLLM = await this.llm.generate({
      transcript: buildFollowupPrompt(asrResult.transcript, firstText),
      context,
      signal,
      streamFull: true,
      maxTokens: 64
    });
    const followupText = removeRepeatedPrefix(followupLLM.text || followupLLM.firstPhrase || "", firstText);
    const followupTTS = followupText
      ? await this.tts.synthesize({ text: followupText, signal })
      : { audioChunks: [], timing: {} };

    const timing = {
      ...asrResult.timing,
      ...firstLLM.timing,
      first_tts_first_audio_ms: firstTTS.timing?.tts_first_audio_ms,
      ...prefixTiming(followupLLM.timing, "followup_"),
      followup_tts_first_audio_ms: followupTTS.timing?.tts_first_audio_ms,
      voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
    };

    return {
      transcript: asrResult.transcript,
      first: buildSegment(firstText, firstTTS),
      followup: buildSegment(followupText, followupTTS),
      timing,
      providerMeta: {
        asrConnectID: asrResult.connectID,
        firstTtsConnectID: firstTTS.connectID,
        followupTtsConnectID: followupTTS.connectID,
        ttsMode: firstTTS.mode || followupTTS.mode || "websocket"
      }
    };
  }
}

function buildSegment(text, ttsResult) {
  const audioChunks = ttsResult.audioChunks || [];
  return {
    text,
    audioChunks,
    audioByteLength: audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    sampleRate: ttsResult.sampleRate
  };
}

function buildFollowupPrompt(transcript, firstText) {
  return [
    `用户刚才说：${transcript}`,
    `已经说过的第一句：${firstText}`,
    "请继续一句，35 个汉字以内，带用户回到经文或问一个很小的问题；不要重复已经说过的第一句。"
  ].join("\n");
}

function removeRepeatedPrefix(text, prefix) {
  const cleaned = String(text || "").trim();
  const repeated = String(prefix || "").trim();
  if (repeated && cleaned.startsWith(repeated)) {
    return cleaned.slice(repeated.length).trim();
  }
  return cleaned;
}

function prefixTiming(timing = {}, prefix) {
  return Object.fromEntries(Object.entries(timing).map(([key, value]) => [`${prefix}${key}`, value]));
}

async function* toAsyncIterable(chunks) {
  if (chunks?.[Symbol.asyncIterator]) {
    yield* chunks;
    return;
  }
  for (const chunk of chunks || []) {
    yield chunk;
  }
}
