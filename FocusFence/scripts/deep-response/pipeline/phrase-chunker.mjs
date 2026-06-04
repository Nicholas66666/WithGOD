const DEFAULT_MAX_CHARS = 28;
const FLUSH_PUNCTUATION = /[。！？；!?;]/u;

export function chunkLLMText(deltas, options = {}) {
  const maxChars = Number(options.maxChars || DEFAULT_MAX_CHARS);
  const chunks = [];
  let buffer = "";

  for (const delta of deltas || []) {
    buffer += String(delta || "");
    let next;
    while ((next = nextFlush(buffer, { maxChars }))) {
      chunks.push({
        index: chunks.length,
        text: next.text,
        reason: next.reason
      });
      buffer = buffer.slice(next.length).trimStart();
    }
  }

  const finalText = buffer.trim();
  if (finalText) {
    chunks.push({
      index: chunks.length,
      text: finalText,
      reason: "final"
    });
  }

  return chunks;
}

export async function* streamLLMPhrases(tokenEvents, options = {}) {
  const maxChars = Number(options.maxChars || DEFAULT_MAX_CHARS);
  let buffer = "";
  let index = 0;

  for await (const event of tokenEvents || []) {
    const delta = typeof event === "string" ? event : event?.delta;
    if (!delta) {
      continue;
    }
    buffer += String(delta);
    let next;
    while ((next = nextFlush(buffer, { maxChars }))) {
      yield {
        type: "assistant_phrase",
        index,
        text: next.text,
        reason: next.reason
      };
      index += 1;
      buffer = buffer.slice(next.length).trimStart();
    }
  }

  const finalText = buffer.trim();
  if (finalText) {
    yield {
      type: "assistant_phrase",
      index,
      text: finalText,
      reason: "final"
    };
  }
}

export function createPhraseChunker(options = {}) {
  const maxChars = Number(options.maxChars || DEFAULT_MAX_CHARS);
  let buffer = "";
  let index = 0;

  return {
    push(delta) {
      buffer += String(delta || "");
      const chunks = [];
      let next;
      while ((next = nextFlush(buffer, { maxChars }))) {
        chunks.push({
          index,
          text: next.text,
          reason: next.reason
        });
        index += 1;
        buffer = buffer.slice(next.length).trimStart();
      }
      return chunks;
    },
    flush() {
      const finalText = buffer.trim();
      if (!finalText) {
        return [];
      }
      buffer = "";
      return [{
        index: index++,
        text: finalText,
        reason: "final"
      }];
    }
  };
}

function nextFlush(buffer, { maxChars }) {
  const text = String(buffer || "");
  if (!text.trim()) {
    return null;
  }

  for (let index = 0; index < text.length; index += 1) {
    if (isQuoteIntroBoundary(text, index)) {
      const candidate = text.slice(0, index + 1).trim();
      if (candidate && isSpeakable(candidate)) {
        return {
          text: candidate,
          length: index + 1,
          reason: "quote_intro"
        };
      }
    }
    if (FLUSH_PUNCTUATION.test(text[index]) || isClosingQuoteAfterPunctuation(text, index)) {
      const candidate = text.slice(0, index + 1).trim();
      if (candidate && isSpeakable(candidate)) {
        return {
          text: candidate,
          length: index + 1,
          reason: "punctuation"
        };
      }
    }
  }

  const trimmed = text.trim();
  if ([...trimmed].length >= maxChars && isSpeakable(trimmed)) {
    return {
      text: trimmed,
      length: text.length,
      reason: "max_chars"
    };
  }

  return null;
}

function isQuoteIntroBoundary(text, index) {
  if (!/[：:]/u.test(text[index])) {
    return false;
  }
  const next = text[index + 1] || "";
  return /[“"「『]/u.test(next);
}

function isClosingQuoteAfterPunctuation(text, index) {
  if (!/[”"」』]/u.test(text[index])) {
    return false;
  }
  return index > 0 && FLUSH_PUNCTUATION.test(text[index - 1]);
}

function isSpeakable(text) {
  return !hasUnclosedBracket(text);
}

function hasUnclosedBracket(text) {
  const opens = (String(text).match(/[（(《「『“]/gu) || []).length;
  const closes = (String(text).match(/[）)》」』”]/gu) || []).length;
  return opens > closes;
}
