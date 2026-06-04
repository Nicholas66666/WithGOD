export async function* streamTTSQueue(tts, {
  phrases,
  turnID,
  generationID,
  signal
} = {}) {
  if (signal?.aborted) {
    yield abortedEvent({ turnID, generationID });
    return;
  }

  for await (const phrase of toAsyncIterable(phrases || [])) {
    if (signal?.aborted) {
      yield abortedEvent({ turnID, generationID });
      return;
    }

    const phraseIndex = Number(phrase.index || 0);
    const text = String(phrase.text || "");
    let audioIndex = 0;
    let timing = {};
    let connectID;
    let sampleRate;
    let audioByteLength = 0;

    for await (const event of tts.synthesizeStream({ text, signal })) {
      if (signal?.aborted) {
        yield abortedEvent({ turnID, generationID });
        return;
      }

      if (event.type === "audio_chunk" && event.audioChunk) {
        const audioChunk = Buffer.from(event.audioChunk);
        audioByteLength += audioChunk.byteLength;
        sampleRate = event.sampleRate || sampleRate;
        yield {
          type: "audio_chunk",
          turnID,
          generationID,
          phraseIndex,
          audioIndex,
          text,
          audioChunk,
          sampleRate
        };
        audioIndex += 1;
      } else if (event.type === "done") {
        timing = event.timing || timing;
        connectID = event.connectID || connectID;
        sampleRate = event.sampleRate || sampleRate;
      }
    }

    yield {
      type: "tts_phrase_done",
      turnID,
      generationID,
      phraseIndex,
      text,
      audioChunkCount: audioIndex,
      audioByteLength,
      sampleRate,
      timing,
      connectID
    };
  }

  yield {
    type: "tts_queue_done",
    turnID,
    generationID
  };
}

function abortedEvent({ turnID, generationID }) {
  return {
    type: "tts_queue_aborted",
    turnID,
    generationID
  };
}

async function* toAsyncIterable(value) {
  if (value?.[Symbol.asyncIterator]) {
    yield* value;
    return;
  }
  for (const item of value || []) {
    yield item;
  }
}
