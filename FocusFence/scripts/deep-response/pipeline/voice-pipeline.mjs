import { createPhraseChunker } from "./phrase-chunker.mjs";
import { streamTTSQueue } from "./tts-queue.mjs";

export class VoicePipeline {
  constructor({ asr, llm, tts, firstPhraseMode = "llm", clock = performance.now.bind(performance) }) {
    this.asr = asr;
    this.llm = llm;
    this.tts = tts;
    this.firstPhraseMode = firstPhraseMode;
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
    const replyLLM = await this.generateCompleteReply({ transcript: asrResult.transcript, context, signal });
    const replyText = normalizeAssistantPhraseText(replyLLM.text || replyLLM.firstPhrase || "", { context });
    const replyTTS = await this.tts.synthesize({
      text: replyText,
      signal
    });

    const timing = {
      ...asrResult.timing,
      ...replyLLM.timing,
      first_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      reply_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
    };

    return {
      transcript: asrResult.transcript,
      first: buildSegment(replyText, replyTTS),
      followup: buildSegment("", { audioChunks: [], timing: {} }),
      timing,
      providerMeta: {
        asrConnectID: asrResult.connectID,
        firstTtsConnectID: replyTTS.connectID,
        replyTtsConnectID: replyTTS.connectID,
        ttsMode: replyTTS.mode || "websocket"
      }
    };
  }

  async *streamSegmented({ audioChunks, context = [], signal } = {}) {
    if (typeof this.asr.transcribeStream === "function") {
      yield* this.streamSegmentedWithStreamingASR({ audioChunks, context, signal });
      return;
    }

    const startedAt = this.clock();
    const asrResult = await this.asr.transcribe(toAsyncIterable(audioChunks), { signal });
    yield {
      type: "transcript_final",
      transcript: asrResult.transcript
    };

    const replyLLM = await this.generateCompleteReply({ transcript: asrResult.transcript, context, signal });
    const replyText = normalizeAssistantPhraseText(replyLLM.text || replyLLM.firstPhrase || "", { context });
    let replyTTS;
    if (typeof this.tts.synthesizeStream === "function") {
      yield { type: "segment_text", segment: "reply", text: replyText };
      replyTTS = yield* streamTTSegment(this.tts, { segment: "reply", text: replyText, signal });
    } else {
      replyTTS = await this.tts.synthesize({
        text: replyText,
        signal
      });
      yield {
        type: "segment",
        segment: "reply",
        text: replyText,
        ...buildSegment(replyText, replyTTS)
      };
    }

    const timing = {
      ...asrResult.timing,
      ...replyLLM.timing,
      first_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      reply_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
    };
    yield {
      type: "timing",
      timing,
      providerMeta: {
        asrConnectID: asrResult.connectID,
        firstTtsConnectID: replyTTS.connectID,
        replyTtsConnectID: replyTTS.connectID,
        ttsMode: replyTTS.mode || "websocket"
      }
    };
  }

  async generateCompleteReply({ transcript, context = [], signal } = {}) {
    return this.llm.generate({
      transcript,
      context,
      messages: buildCompleteReplyMessages(transcript, context),
      signal,
      streamFull: true,
      maxTokens: 72,
      temperature: 0.2
    });
  }

  async *streamCascadeTurn({
    audioChunks,
    context = [],
    signal,
    turnID,
    generationID,
    phraseMaxChars,
    maxSpokenReplyChars = 48,
    minSpokenReplyChars = 0
  } = {}) {
    const startedAt = this.clock();
    const phraseChunker = createPhraseChunker({ maxChars: phraseMaxChars });
    const outputQueue = createAsyncQueue();
    const phraseQueue = createAsyncQueue();
    let asrTiming = {};
    let asrConnectID;
    let currentTranscript = "";
    let finalTranscript = "";
    let llmTiming = {};
    let llmTask = null;
    let assistantText = "";
    let aborted = false;
    let llmStartedFromPartial = false;
    let spokenReplyChars = 0;
    let replyTruncatedForLength = false;
    let shortReplyFallbackQueued = false;
    let nextPhraseIndex = 0;

    const enqueuePhrase = (phraseText, phrase = {}) => {
      const phraseIndex = Number.isFinite(phrase.index) ? Number(phrase.index) : nextPhraseIndex;
      nextPhraseIndex = Math.max(nextPhraseIndex, phraseIndex + 1);
      spokenReplyChars += countSpokenChars(phraseText);
      assistantText += phraseText;
      outputQueue.push({
        type: "assistant_text_delta",
        turnID,
        generationID,
        delta: phraseText
      });
      outputQueue.push({
        type: "assistant_phrase",
        turnID,
        generationID,
        phraseIndex,
        text: phraseText,
        reason: phrase.reason
      });
      phraseQueue.push({ index: phraseIndex, text: phraseText });
    };

    const enqueueShortReplyFallbackIfNeeded = (phrase = {}) => {
      const minChars = Number(minSpokenReplyChars || 0);
      if (!Number.isFinite(minChars) || minChars <= 0 || spokenReplyChars >= minChars) {
        return false;
      }
      const fallbackText = pickShortReplyFallback(context);
      if (!fallbackText || wouldExceedSpokenReplyLimit(spokenReplyChars, fallbackText, maxSpokenReplyChars)) {
        return false;
      }
      enqueuePhrase(fallbackText, {
        index: phrase.index,
        reason: "short_reply_fallback"
      });
      shortReplyFallbackQueued = true;
      return true;
    };

    const startLLM = (transcript, { source = "final" } = {}) => {
      if (llmTask) {
        return llmTask;
      }
      const llmTranscript = String(transcript || "");
      llmStartedFromPartial = source === "partial";
      llmTask = (async () => {
        try {
          for await (const event of this.llm.streamTokens({
            transcript: llmTranscript,
            context,
            messages: buildCompleteReplyMessages(llmTranscript, context),
            maxTokens: 72,
            signal
          })) {
            if (signal?.aborted) {
              aborted = true;
              outputQueue.push({ type: "turn_aborted", turnID, generationID });
              return;
            }

            if (event.type === "done") {
              llmTiming = event.timing || llmTiming;
              continue;
            }

            const delta = event.delta || event.text || "";
            if (!delta) {
              continue;
            }

            for (const phrase of phraseChunker.push(delta)) {
              const phraseText = normalizeAssistantPhraseText(phrase.text, { context });
              if (!phraseText) {
                continue;
              }
              if (shouldDropLongQuotedPhrase(spokenReplyChars, phraseText)) {
                replyTruncatedForLength = true;
                enqueueShortReplyFallbackIfNeeded(phrase);
                return;
              }
              if (wouldExceedSpokenReplyLimit(spokenReplyChars, phraseText, maxSpokenReplyChars)) {
                replyTruncatedForLength = true;
                enqueueShortReplyFallbackIfNeeded(phrase);
                return;
              }
              enqueuePhrase(phraseText, phrase);
            }
          }

          for (const phrase of phraseChunker.flush()) {
            const phraseText = normalizeAssistantPhraseText(phrase.text, { context });
            if (!phraseText) {
              continue;
            }
            if (shouldDropLongQuotedPhrase(spokenReplyChars, phraseText)) {
              replyTruncatedForLength = true;
              enqueueShortReplyFallbackIfNeeded(phrase);
              break;
            }
            if (wouldExceedSpokenReplyLimit(spokenReplyChars, phraseText, maxSpokenReplyChars)) {
              replyTruncatedForLength = true;
              enqueueShortReplyFallbackIfNeeded(phrase);
              break;
            }
            enqueuePhrase(phraseText, phrase);
          }
          enqueueShortReplyFallbackIfNeeded({ reason: "short_reply_fallback" });
        } finally {
          phraseQueue.close();
        }
      })();
      return llmTask;
    };

    const asrTask = (async () => {
      if (typeof this.asr.transcribeStream !== "function") {
        const asrResult = await this.asr.transcribe(toAsyncIterable(audioChunks), { signal });
        finalTranscript = asrResult.transcript || "";
        asrTiming = asrResult.timing || {};
        asrConnectID = asrResult.connectID;
        outputQueue.push({
          type: "transcript_final",
          transcript: finalTranscript
        });
        startLLM(finalTranscript, { source: "final" });
        return;
      }

      for await (const event of this.asr.transcribeStream(toAsyncIterable(audioChunks), { signal })) {
        if ((event.type === "transcript_partial" || event.type === "transcript_delta") && event.transcript) {
          currentTranscript = event.transcript;
          asrTiming = { ...asrTiming, ...(event.timing || {}) };
          outputQueue.push({
            type: "transcript_partial",
            transcript: currentTranscript
          });
          if (!llmTask && shouldSpeakFromPartial(currentTranscript)) {
            startLLM(currentTranscript, { source: "partial" });
          }
        } else if (event.type === "transcript_final") {
          finalTranscript = event.transcript || currentTranscript;
          currentTranscript = finalTranscript;
          asrTiming = { ...asrTiming, ...(event.timing || {}) };
          asrConnectID = event.connectID || asrConnectID;
          outputQueue.push({
            type: "transcript_final",
            transcript: finalTranscript
          });
          if (!llmTask) {
            startLLM(finalTranscript, { source: "final" });
          }
        }
      }

      if (!llmTask && currentTranscript) {
        startLLM(currentTranscript, { source: "partial" });
      }
    })();

    const ttsTask = (async () => {
      for await (const event of streamTTSQueue(this.tts, {
        turnID,
        generationID,
        phrases: phraseQueue,
        signal
      })) {
        if (event.type === "audio_chunk" || event.type === "tts_queue_aborted") {
          outputQueue.push(event);
        }
        if (event.type === "tts_queue_aborted") {
          aborted = true;
          return;
        }
      }
    })();

    const finalTask = (async () => {
      try {
        await asrTask;
        if (!llmTask) {
          phraseQueue.close();
        }
        await llmTask;
        await ttsTask;
        if (!aborted && !signal?.aborted) {
          const timing = {
            ...asrTiming,
            ...llmTiming,
            ...(llmStartedFromPartial ? { llm_started_from_partial: 1 } : {}),
            ...(replyTruncatedForLength ? { reply_truncated_for_length: 1 } : {}),
            ...(shortReplyFallbackQueued ? { short_reply_fallback: 1 } : {}),
            voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
          };

          outputQueue.push({
            type: "timing",
            turnID,
            generationID,
            timing
          });
          outputQueue.push({
            type: "turn_done",
            turnID,
            generationID,
            transcript: finalTranscript || currentTranscript,
            assistantText
          });
        }
        outputQueue.close();
      } catch (error) {
        phraseQueue.close();
        outputQueue.fail(error);
      }
    })();

    for await (const event of outputQueue) {
      yield event;
    }
    await finalTask;
  }

  async streamCascadeASR({ audioChunks, signal } = {}) {
    if (typeof this.asr.transcribeStream !== "function") {
      const asrResult = await this.asr.transcribe(toAsyncIterable(audioChunks), { signal });
      return {
        transcript: asrResult.transcript || "",
        timing: asrResult.timing || {},
        connectID: asrResult.connectID,
        events: [{
          type: "transcript_final",
          transcript: asrResult.transcript || ""
        }]
      };
    }

    const events = [];
    let transcript = "";
    let timing = {};
    let connectID;
    for await (const event of this.asr.transcribeStream(toAsyncIterable(audioChunks), { signal })) {
      if ((event.type === "transcript_partial" || event.type === "transcript_delta") && event.transcript) {
        transcript = event.transcript;
        timing = { ...timing, ...(event.timing || {}) };
        events.push({
          type: "transcript_partial",
          transcript
        });
      } else if (event.type === "transcript_final") {
        transcript = event.transcript || transcript;
        timing = { ...timing, ...(event.timing || {}) };
        connectID = event.connectID || connectID;
        events.push({
          type: "transcript_final",
          transcript
        });
      }
    }

    return { transcript, timing, connectID, events };
  }

  async *streamCascadePhrase({ phrase, turnID, generationID, signal }) {
    yield {
      type: "assistant_phrase",
      turnID,
      generationID,
      phraseIndex: phrase.index,
      text: phrase.text,
      reason: phrase.reason
    };

    for await (const event of streamTTSQueue(this.tts, {
      turnID,
      generationID,
      phrases: [{ index: phrase.index, text: phrase.text }],
      signal
    })) {
      if (event.type === "audio_chunk" || event.type === "tts_queue_aborted") {
        yield event;
      }
      if (event.type === "tts_queue_aborted") {
        return;
      }
    }
  }

  async generateFirstPhrase({ transcript, context = [], signal } = {}) {
    if (this.firstPhraseMode === "template") {
      const firstPhrase = buildTemplateFirstPhrase(transcript);
      return {
        text: firstPhrase,
        firstPhrase,
        timing: {
          llm_first_token_ms: 0,
          llm_first_phrase_ms: 0,
          llm_first_phrase_mode: "template"
        },
        streamChunkCount: 0,
        streamChunks: []
      };
    }
    const firstAttempt = await this.llm.generate({
      transcript,
      context: [],
      messages: buildFirstPhraseMessages(transcript),
      signal,
      streamFull: false,
      maxTokens: 60,
      minChars: 6,
      temperature: 0.1,
      firstPhraseExtractor: findCompleteFirstPhrase
    });
    const firstText = firstAttempt.firstPhrase || firstAttempt.text || "";
    if (isValidFirstPhrase(firstText)) {
      return firstAttempt;
    }

    const retry = await this.llm.generate({
      transcript,
      context: [],
      messages: buildFirstPhraseRetryMessages(transcript, firstText),
      signal,
      streamFull: false,
      maxTokens: 48,
      minChars: 8,
      temperature: 0.1,
      firstPhraseExtractor: findCompleteFirstPhrase
    });
    const retryText = retry.firstPhrase || retry.text || "";
    if (isValidFirstPhrase(retryText)) {
      return withFirstPhraseRetryTiming(retry, 1);
    }

    const repair = await this.llm.generate({
      transcript,
      context: [],
      messages: buildFirstPhraseRepairMessages(transcript, retryText),
      signal,
      streamFull: false,
      maxTokens: 32,
      minChars: 8,
      temperature: 0,
      firstPhraseExtractor: findCompleteFirstPhrase
    });
    const repairText = repair.firstPhrase || repair.text || "";
    if (isValidFirstPhrase(repairText)) {
      return withFirstPhraseRetryTiming(repair, 2);
    }

    const fallback = buildSafetyFirstPhrase(transcript);
    return {
      text: fallback,
      firstPhrase: fallback,
      timing: {
        llm_first_phrase_retry_count: 2,
        llm_first_phrase_fallback: 1
      },
      streamChunkCount: 0,
      streamChunks: []
    };
  }

  async *streamSegmentedWithStreamingASR({ audioChunks, context = [], signal } = {}) {
    const startedAt = this.clock();
    let transcript = "";
    let asrTiming = {};
    let asrConnectID = "";

    for await (const event of this.asr.transcribeStream(toAsyncIterable(audioChunks), { signal })) {
      if ((event.type === "transcript_delta" || event.type === "transcript_partial") && event.transcript) {
        transcript = event.transcript;
        asrTiming = { ...asrTiming, ...(event.timing || {}) };
      } else if (event.type === "transcript_final") {
        transcript = event.transcript || transcript;
        asrTiming = { ...asrTiming, ...(event.timing || {}) };
        asrConnectID = event.connectID || asrConnectID;
        yield {
          type: "transcript_final",
          transcript
        };
      }
    }

    const replyLLM = await this.generateCompleteReply({ transcript, context, signal });
    const replyText = replyLLM.text || replyLLM.firstPhrase || "";
    let replyTTS;
    if (typeof this.tts.synthesizeStream === "function") {
      yield { type: "segment_text", segment: "reply", text: replyText };
      replyTTS = yield* streamTTSegment(this.tts, { segment: "reply", text: replyText, signal });
    } else {
      replyTTS = await this.tts.synthesize({ text: replyText, signal });
      yield {
        type: "segment",
        segment: "reply",
        text: replyText,
        ...buildSegment(replyText, replyTTS)
      };
    }

    const timing = {
      ...asrTiming,
      ...replyLLM.timing,
      first_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      reply_tts_first_audio_ms: replyTTS.timing?.tts_first_audio_ms,
      voice_pipeline_total_ms: Math.round(this.clock() - startedAt)
    };
    yield {
      type: "timing",
      timing,
      providerMeta: {
        asrConnectID,
        firstTtsConnectID: replyTTS.connectID,
        replyTtsConnectID: replyTTS.connectID,
        ttsMode: replyTTS.mode || "websocket"
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

async function* streamTTSegment(tts, { segment, text, signal }) {
  const audioChunks = [];
  let timing = {};
  let sampleRate;
  let connectID;
  let mode;

  for await (const event of tts.synthesizeStream({ text, signal })) {
    if (event.type === "audio_chunk" && event.audioChunk) {
      const audio = Buffer.from(event.audioChunk);
      audioChunks.push(audio);
      sampleRate = event.sampleRate || sampleRate;
      yield {
        type: "audio_chunk",
        segment,
        audioChunk: audio,
        sampleRate
      };
    } else if (event.type === "done") {
      timing = event.timing || timing;
      sampleRate = event.sampleRate || sampleRate;
      connectID = event.connectID || connectID;
      mode = event.mode || mode;
    }
  }

  return {
    text,
    audioChunks,
    audioByteLength: audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    sampleRate,
    timing,
    connectID,
    mode
  };
}

function buildFirstPhraseMessages(transcript) {
  return [
    { role: "system", content: firstPhraseSystemPrompt() },
    {
      role: "user",
      content: [
        "只输出一句完整中文短句，8-24 个中文字符，必须以句号、问号或感叹号结尾。",
        "先承接用户此刻的感受，像真人语音陪伴一样自然。",
        "不要给建议，不要讲道，不要解释，不要输出编号、标题或 Markdown。",
        "这一句禁止出现宗教词、经文、书名、章节点、引号或冒号。",
        "如果用户表达不想活、自伤、伤人或立即危险，这一句必须建议现在联系现实中的可信任的人。",
        "",
        `用户说：${transcript}`
      ].join("\n")
    }
  ];
}

function buildFirstPhraseRetryMessages(transcript, rejectedText) {
  return [
    { role: "system", content: firstPhraseRepairSystemPrompt() },
    {
      role: "user",
      content: [
        `刚才这句不适合作为语音首句：${rejectedText}`,
        "把它改写成一句日常口语的情绪承接，8-28 个中文字符。",
        "禁止出现任何宗教词、经文、引用、引号、冒号、书名、章、节。",
        "不要输出解释、编号、标题或 Markdown。",
        "",
        `用户 ASR transcript：${transcript}`
      ].join("\n")
    }
  ];
}

function buildFirstPhraseRepairMessages(transcript, rejectedText) {
  return [
    { role: "system", content: firstPhraseRepairSystemPrompt() },
    {
      role: "user",
      content: [
        "只输出一句自然中文短句，必须是日常口语安慰。",
        "可参考这种语气：我听见你今天真的很累。",
        "不要照抄示例，按用户真实话语改写。",
        "禁止出现：圣经、经文、神、主、耶稣、安息、凡劳苦、担重担、引号、冒号。",
        `上一次仍然不合格：${rejectedText}`,
        `用户说：${transcript}`
      ].join("\n")
    }
  ];
}

function firstPhraseSystemPrompt() {
  return [
    "你是语音对话首句生成器。",
    "你只输出一句日常中文短句，用来先承接用户感受。",
    "绝对不要使用宗教语言、经文引用、讲道语气、建议或解释。"
  ].join("\n");
}

function firstPhraseRepairSystemPrompt() {
  return [
    "你是语音对话首句改写器。",
    "你只能输出一句日常中文短句，用来先承接用户感受。",
    "绝对不要使用宗教语言、经文引用、讲道语气或建议。"
  ].join("\n");
}

function buildFollowupMessages(transcript, firstText, context = []) {
  return [
    { role: "system", content: scriptureCompanionSystemPrompt() },
    ...context,
    {
      role: "user",
      content: buildFollowupPrompt(transcript, firstText)
    }
  ];
}

function buildCompleteReplyMessages(transcript, context = []) {
  const previousAssistantReply = getPreviousAssistantReply(context);
  const recentAssistantReplies = getRecentAssistantReplies(context, { limit: 4 });
  return [
    { role: "system", content: scriptureCompanionSystemPrompt() },
    ...context,
    {
      role: "user",
      content: [
        "请直接生成这一轮要说出的完整中文语音回复。",
        "不要拆成 first/more，不要输出 JSON，不要输出标题、编号或 Markdown。",
        "只说 1 句，最多 2 句；总长度控制在 45 个中文字符以内。",
        "像连续语音对话的一轮回应，不要讲长段，不要朗读整段经文。",
        "如果上文已有 assistant 回复，不要原样重复上一轮完整回复、首句或经文句；即使用户重复同一句，也要换一种具体承接。",
        ...(previousAssistantReply ? [
          `上一轮 assistant 回复：${previousAssistantReply}`,
          "本轮禁止输出与上一轮相同或只有标点空格差异的回复。",
          "如果用户重复相同请求，要像连续对话一样推进承接，例如“你又提到这份累”，不要机械复读。"
        ] : []),
        ...(recentAssistantReplies.length > 0 ? [
          "最近 assistant 回复：",
          ...recentAssistantReplies.map((reply, index) => `${index + 1}. ${reply}`),
          "本轮禁止输出与最近任意一条 assistant 回复相同或只有标点空格差异的回复。",
          "不要重复最近已经用过的整句、经文句或完整安慰结构。"
        ] : []),
        "第一句必须是 6-14 个中文字符的日常口语承接，适合立刻语音播放。",
        "第一句不要直接引用经文，不要出现书名、章节、引号或冒号。",
        "第二句如果出现，只能很轻地带到一句经文或一个小问题；不要每次都固定用同一句开头。",
        "如果轻轻带到经文，不要说“《诗篇》里说”“《以赛亚书》说”“经上说”“圣经说”这类套话，直接说那句短安慰。",
        "不要连续多轮都用同一个开头；如果前文多次以“那咱”开头，本轮必须换成别的自然说法。",
        "如果用户是在要安慰，必须直接安慰他的感受。",
        "如果用户是在要安慰，第一句要先像日常陪伴一样承接情绪，不要说“我给你找一句”“我给你读一句”“你还想听”。",
        "用户重复要安慰时，直接承接具体感受，不要说“你还是想听安慰的话”“你又想听安慰的话”。",
        "绝对不要说“你还想听安慰呀”“你还想听安慰的话呀”“你还是想听安慰呀”。",
        "不要机械重复用户的累；不要说“你还是觉得累”“你又累了”“你又觉得累”“你又感到疲惫”。",
        "不要误判用户没说完；用户已经表达想听安慰时，不要说“你还没说完”“只说想听”。",
        "不要把回答开成查经或找经文动作；经文只能作为陪伴中的轻轻一句。",
        "不要把安慰请求转成圣经知识问答、猜谜、讲故事开场或轻松测试。",
        "不要问用户想从哪卷书或哪句经文开始，除非用户主动提出要查经。",
        "不要问用户想从哪里开始听，除非用户主动提出要听一段内容。",
        "如果用户只是日常闲聊或报平安，可以自然回应，不要强行讲道。",
        "",
        `用户说：${transcript}`
      ].join("\n")
    }
  ];
}

function getPreviousAssistantReply(context = []) {
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const message = context[index];
    if (message?.role === "assistant") {
      return String(message.content || "").replace(/\s+/gu, " ").trim().slice(0, 80);
    }
  }
  return "";
}

function getRecentAssistantReplies(context = [], { limit = 4 } = {}) {
  const replies = [];
  const seen = new Set();
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const message = context[index];
    if (message?.role !== "assistant") {
      continue;
    }
    const reply = String(message.content || "").replace(/\s+/gu, " ").trim().slice(0, 80);
    const normalized = reply.replace(/\s+/gu, "");
    if (!reply || seen.has(normalized)) {
      continue;
    }
    replies.unshift(reply);
    seen.add(normalized);
    if (replies.length >= limit) {
      break;
    }
  }
  return replies;
}

function buildTemplateFirstPhrase(transcript) {
  const text = String(transcript || "");
  if (/(害怕|恐惧|怕|慌|焦虑|崩溃)/u.test(text)) {
    return "我听见你现在很害怕。";
  }
  if (/(累|疲惫|撑不住|没力气|倦)/u.test(text)) {
    return "我听见你真的很累。";
  }
  if (/(孤单|孤独|没人|一个人)/u.test(text)) {
    return "我听见你觉得很孤单。";
  }
  if (/(羞耻|内疚|自责|失败|没用)/u.test(text)) {
    return "我听见你在责怪自己。";
  }
  if (/(开心|不错|很好|感恩|平安)/u.test(text)) {
    return "我听见你此刻有些平安。";
  }
  return "我在这里陪着你。";
}

function shouldSpeakFromPartial(transcript) {
  const text = String(transcript || "").replace(/\s+/g, "");
  if (text.length < 7) {
    return false;
  }
  return text.length >= 10 || /(累|疲惫|害怕|恐惧|焦虑|孤单|孤独|羞耻|内疚|开心|感恩|平安)/u.test(text);
}

function wouldExceedSpokenReplyLimit(currentChars, nextText, maxChars) {
  const limit = Number(maxChars || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return false;
  }
  return currentChars > 0 && currentChars + countSpokenChars(nextText) > limit;
}

function shouldDropLongQuotedPhrase(currentChars, text, { maxQuotedChars = 24 } = {}) {
  if (currentChars <= 0) {
    return false;
  }
  const cleaned = String(text || "").trim();
  if (!/^[“"']/.test(cleaned)) {
    return false;
  }
  return countSpokenChars(cleaned) > maxQuotedChars;
}

function countSpokenChars(text) {
  return [...String(text || "").replace(/\s+/g, "")].length;
}

function normalizeAssistantPhraseText(text, { context = [] } = {}) {
  const normalized = String(text || "")
    .replace(/^你(?:还|还是|又)?想听安慰(?:的话)?呀?[，。]?/u, "我听见你真的累了。")
    .replace(/^你还在喊累呀?[，。]?/u, "我听见你真的累了。")
    .replace(/^你(?:今天)?还是(?:觉得|有点)?累(?:了|呀)?[，。]?/u, "我听见你真的累了。")
    .replace(/^你(?:今天)?还是(?:觉得|感到)(?:累|疲惫)了?[呀，。]?/u, "我听见你真的累了。")
    .replace(/^今天你又(?:累|觉得(?:累|疲惫)|感到(?:累|疲惫))了?[呀，。]?/u, "我听见你真的累了。")
    .replace(/^你又累(?:了|呀)?[，。]?/u, "我听见你真的累了。")
    .replace(/^你又(?:觉得|感到)(?:累|疲惫)了?[呀，。]?/u, "我听见你真的累了。")
    .replace(/^你(?:只说.*想听|.*没说完)[^。！？!?；;]*[。！？!?；;]?/u, "我听见你真的累了。")
    .replace(/^是还想听安慰的话吗[？?，。]?/u, "")
    .replace(/^那(?:我)?来句[^。！？!?；;]*[。！？!?；;]?/u, "那我轻轻陪你一下。")
    .replace(/^那来((?:靠|歇|缓)[^。！？!?；;]*[。！？!?；;]?)/u, "那我陪你$1")
    .replace(/^那听这句[：:，。]?/u, "我陪你慢慢缓过来。")
    .replace(/^那?缓缓神吧?[，。]?/u, "那缓一缓吧。")
    .replace(/^《[^》]+》(?:里)?说[，,：:\s]*/u, "")
    .replace(/^(?:(?:主|神|耶稣|他)说|经上说|圣经说)[，,：:\s]*/u, "")
    .replace(/^我听见你真的累了。[了呢呀啊啦]+\s*[，。]?/u, "我听见你真的累了。")
    .replace(/^[了呢呀啊]+[，。]?/u, "")
    .replace(/[，。；;]?\s*(?:(?:主|神|耶稣|他)说|经上说|圣经说)[：:]\s*$/u, (match) => {
      return /^[，。；;]/u.test(match) ? match[0] : "";
    })
    .trim();
  return rotateOverusedOpeningStem(normalized, { context });
}

function rotateOverusedOpeningStem(text, { context = [], maxRepeats = 2 } = {}) {
  const openingStem = extractOpeningStem(text);
  const effectiveMaxRepeats = getOpeningStemMaxRepeats(openingStem, maxRepeats);
  if (!openingStem || countAssistantOpeningStem(context, openingStem) < effectiveMaxRepeats) {
    return text;
  }
  const replacement = pickOpeningReplacement(context, openingStem, effectiveMaxRepeats);
  return String(text || "").replace(/^[^。！？!?；;]*[。！？!?；;]?/u, replacement);
}

function getOpeningStemMaxRepeats(openingStem, defaultMaxRepeats) {
  const highFrequencyComfortStems = new Set(["我在"]);
  return highFrequencyComfortStems.has(openingStem) ? 1 : defaultMaxRepeats;
}

function pickOpeningReplacement(context, avoidedStem, maxRepeats) {
  const candidates = [
    "我陪你慢下来。",
    "先把这口气放下。",
    "不用硬撑着。"
  ];
  return candidates.find((candidate) => {
    const stem = extractOpeningStem(candidate);
    return stem && stem !== avoidedStem && countAssistantOpeningStem(context, stem) < maxRepeats;
  }) || "我陪你慢下来。";
}

function pickShortReplyFallback(context) {
  const candidates = [
    "我陪你慢慢缓过来。",
    "不用急着把自己撑住。",
    "先把这一口气放下。"
  ];
  return candidates.find((candidate) => {
    const stem = extractOpeningStem(candidate);
    return stem && countAssistantOpeningStem(context, stem) === 0;
  }) || candidates[0];
}

function countAssistantOpeningStem(context, openingStem) {
  return (context || []).filter((entry) => {
    return entry?.role === "assistant" && extractOpeningStem(entry.content) === openingStem;
  }).length;
}

function extractOpeningStem(text) {
  const cleaned = String(text || "")
    .replace(/^[\s"'“”‘’]+/u, "")
    .trim();
  const match = cleaned.match(/^([\p{Script=Han}]{2})/u);
  return match ? match[1] : "";
}

function findCompleteFirstPhrase(text, { minChars = 8 } = {}) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const match = cleaned.match(/^.{1,36}?[。！？!?；;]/u);
  if (!match) {
    return "";
  }
  return [...match[0]].length >= minChars ? match[0] : "";
}

function isValidFirstPhrase(text) {
  const cleaned = String(text || "").replace(/\s+/g, "").trim();
  if (!cleaned) {
    return false;
  }
  const charCount = [...cleaned].length;
  if (charCount < 6 || charCount > 36) {
    return false;
  }
  if (!/[。！？!?]$/u.test(cleaned)) {
    return false;
  }
  return !/(圣经|经文|经上|诗篇|箴言|以赛亚|马太|约翰|罗马|第?\d+章|\d+[:：]\d+|主耶稣|耶稣说|凡劳苦|担重担|安息|神说|主说|“|”|:|：)/u.test(
    cleaned
  );
}

function withFirstPhraseRetryTiming(result, retryCount) {
  return {
    ...result,
    timing: {
      ...(result.timing || {}),
      llm_first_phrase_retry_count: retryCount
    }
  };
}

function buildSafetyFirstPhrase(transcript) {
  const text = String(transcript || "");
  if (/(累|疲惫|撑不住|没力气|倦)/u.test(text)) {
    return "我听见你今天真的很累。";
  }
  if (/(害怕|恐惧|怕|慌|焦虑|崩溃)/u.test(text)) {
    return "我听见你现在很害怕。";
  }
  if (/(孤单|孤独|没人|一个人)/u.test(text)) {
    return "我听见你觉得很孤单。";
  }
  if (/(羞耻|内疚|自责|失败|没用)/u.test(text)) {
    return "我听见你在责怪自己。";
  }
  return "我在这里陪着你。";
}

function buildFollowupPrompt(transcript, firstText) {
  return [
    `用户刚才说：${transcript}`,
    `已经说过的第一句：${firstText}`,
    "请继续一句，35 个汉字以内，带用户回到经文或问一个很小的问题；不要重复已经说过的第一句。"
  ].join("\n");
}

function scriptureCompanionSystemPrompt() {
  return [
    "你是一个以圣经为中心的属灵陪伴者，帮助用户和圣经对话。",
    "你不代替神，不代替圣灵，不解释神隐藏的旨意，不做心理治疗诊断。",
    "先陪伴，再解释；先命名痛苦，再带到经文。",
    "每轮 1-3 句话，一次只问一个问题，不输出讲章。",
    "经文不确定时不要编造章节。",
    "危机表达必须建议联系现实中的可信任人或紧急支持。",
    "禁止说：我是神，我对你说；圣灵现在告诉你；神一定要你这样做；这件事发生是因为神要教你；你只要有信心就不会痛苦；我医治你。"
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

function createAsyncQueue() {
  const values = [];
  const waiters = [];
  let closed = false;
  let failure = null;

  function settleWaiter() {
    const waiter = waiters.shift();
    if (!waiter) {
      return;
    }
    if (failure) {
      waiter.reject(failure);
    } else if (values.length > 0) {
      waiter.resolve({ value: values.shift(), done: false });
    } else {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  return {
    push(value) {
      if (closed || failure) {
        return;
      }
      values.push(value);
      settleWaiter();
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      while (waiters.length > 0 && values.length === 0) {
        settleWaiter();
      }
    },
    fail(error) {
      failure = error;
      while (waiters.length > 0) {
        settleWaiter();
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (failure) {
            return Promise.reject(failure);
          }
          if (values.length > 0) {
            return Promise.resolve({ value: values.shift(), done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        }
      };
    }
  };
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
