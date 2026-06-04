import test from "node:test";
import assert from "node:assert/strict";

import { chunkLLMText } from "./phrase-chunker.mjs";

test("chunkLLMText flushes speakable Chinese phrases on punctuation", () => {
  const chunks = chunkLLMText([
    "我听见",
    "你真的很累。",
    "我们先慢一点。"
  ]);

  assert.deepEqual(chunks, [
    { index: 0, text: "我听见你真的很累。", reason: "punctuation" },
    { index: 1, text: "我们先慢一点。", reason: "punctuation" }
  ]);
});

test("chunkLLMText flushes a low-latency phrase when text grows past maxChars", () => {
  const chunks = chunkLLMText([
    "我知道你今天已经撑了很久",
    "我们先慢一点"
  ], { maxChars: 10 });

  assert.deepEqual(chunks, [
    { index: 0, text: "我知道你今天已经撑了很久", reason: "max_chars" },
    { index: 1, text: "我们先慢一点", reason: "final" }
  ]);
});

test("chunkLLMText does not flush an unfinished scripture reference fragment", () => {
  const chunks = chunkLLMText([
    "圣经说，耶和华靠近伤心的人。",
    "（诗篇 ",
    "34:18）",
    "我们先停在这里。"
  ], { maxChars: 12 });

  assert.deepEqual(chunks, [
    { index: 0, text: "圣经说，耶和华靠近伤心的人。", reason: "punctuation" },
    { index: 1, text: "（诗篇 34:18）我们先停在这里。", reason: "punctuation" }
  ]);
});

test("chunkLLMText flushes the lead-in before a scripture quote", () => {
  const chunks = chunkLLMText([
    "那我就给你读一句《圣经》里的话吧：",
    "“你们得力在乎平静安稳。”"
  ], { maxChars: 24 });

  assert.deepEqual(chunks, [
    { index: 0, text: "那我就给你读一句《圣经》里的话吧：", reason: "quote_intro" },
    { index: 1, text: "“你们得力在乎平静安稳。”", reason: "punctuation" }
  ]);
});
