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
    const replyText = replyLLM.text || replyLLM.firstPhrase || "";
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
    const replyText = replyLLM.text || replyLLM.firstPhrase || "";
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
      maxTokens: 96,
      temperature: 0.2
    });
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
  return [
    { role: "system", content: scriptureCompanionSystemPrompt() },
    ...context,
    {
      role: "user",
      content: [
        "请直接生成这一轮要说出的完整中文语音回复。",
        "不要拆成 first/more，不要输出 JSON，不要输出标题、编号或 Markdown。",
        "1-2 句即可，整体尽量短，但必须真实回应用户刚说的话。",
        "先自然承接用户，再在合适时轻轻带到经文；不要每次都固定用同一句开头。",
        "如果用户只是日常闲聊或报平安，可以自然回应，不要强行讲道。",
        "",
        `用户说：${transcript}`
      ].join("\n")
    }
  ];
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
  if (text.length < 4) {
    return false;
  }
  return text.length >= 8 || /(累|疲惫|害怕|恐惧|焦虑|孤单|孤独|羞耻|内疚|开心|感恩|平安)/u.test(text);
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

async function* toAsyncIterable(chunks) {
  if (chunks?.[Symbol.asyncIterator]) {
    yield* chunks;
    return;
  }
  for (const chunk of chunks || []) {
    yield chunk;
  }
}
