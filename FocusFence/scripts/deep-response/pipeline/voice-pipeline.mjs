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
