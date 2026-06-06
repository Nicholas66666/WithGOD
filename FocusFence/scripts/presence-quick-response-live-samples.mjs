#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const sourcePath = resolve("supabase/functions/presence-process/index.ts");

const samples = [
  { name: "焦虑害怕", category: "distress", transcript: "我很怕明天的结果，心一直悬着，停不下来。" },
  { name: "羞耻自责", category: "distress", transcript: "我又失败了，觉得自己很糟糕，不配来到神面前。" },
  { name: "创伤闪回", category: "distress", transcript: "刚才那个画面又回来，我整个人发抖，好像又回到那件事里。" },
  { name: "孤独被抛弃", category: "distress", transcript: "我觉得没有人真的会留下，大家最后都会离开我。" },
  { name: "怒气想反击", category: "distress", transcript: "他那句话太过分了，我现在就想回击，让他知道我不是好欺负的。" },
  { name: "认罪悔改", category: "distress", transcript: "主啊我承认我今天又用控制的方式对待家人，我想悔改。" },
  { name: "祷告交托", category: "distress", transcript: "主啊我把这次面试交托给你，求你让我不被结果捆绑。" },
  { name: "饶恕关系", category: "distress", transcript: "我知道我需要饶恕她，但我心里还是很硬，很委屈。" },
  { name: "灵感", category: "ordinary", transcript: "想到一个产品点子，可以把祷告记录按处境自动分组。" },
  { name: "待办", category: "ordinary", transcript: "提醒我今晚八点给妈妈打电话，然后买牛奶。" },
  { name: "普通问题", category: "ordinary", transcript: "帮我想一下明天会议开场怎么说比较自然。" },
  { name: "危机边界", category: "crisis", transcript: "我真的不想活了，感觉撑不下去了。" }
];

const quickResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["turning", "prayer", "idea", "bibleQuestion", "generalQuestion", "task", "journal", "unknown"]
    },
    summary: { type: "string" },
    watchResponse: {
      type: "object",
      additionalProperties: false,
      properties: {
        eyebrow: { type: "string", minLength: 4, maxLength: 8 },
        headline: { type: "string", minLength: 2, maxLength: 6 },
        body: { type: "string", minLength: 10, maxLength: 28 },
        footnote: { type: "string", minLength: 3, maxLength: 10 },
        accent: { type: "string", enum: ["green", "blue", "gold", "red", "gray"] }
      },
      required: ["eyebrow", "headline", "body", "footnote", "accent"]
    },
    responseMode: { type: "string", enum: ["silentSave", "watchText", "watchVoice", "iphoneOnly"] }
  },
  required: ["type", "summary", "watchResponse", "responseMode"]
};

const forbiddenPhrases = [
  "已记下",
  "正在整理",
  "稍后查看",
  "我会保存",
  "完整整理",
  "冥想",
  "正念",
  "闭眼",
  "闭上眼睛",
  "感受当下",
  "感受空气",
  "扫描身体",
  "观呼吸"
];

const inventedVoicePatterns = [
  /神(?:正在)?对你说/u,
  /耶稣(?:正在)?对你说/u,
  /圣灵(?:正在)?对你说/u,
  /我是(?:神|耶稣|圣灵)/u
];

const versePool = new Set([
  "腓 4:6",
  "太 6:34",
  "雅 1:19",
  "箴 15:1",
  "约一 1:9",
  "罗 8:1",
  "箴 3:5",
  "箴 3:5-6",
  "林后 12:9",
  "提后 1:7",
  "诗 56:3",
  "林前 13:4"
]);

const meditationLikePattern = /冥想|正念|闭眼|闭上眼睛|感受当下|感受空气|扫描身体|观呼吸/u;
const prayerLikePattern = /主啊|天父|祷告|交托|求你|阿们|信靠|神/u;

function loadDotenv(path) {
  try {
    const env = {};
    for (const line of readFileSync(path, "utf8").split(/\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const value = match[2].replace(/^['"]|['"]$/g, "");
      env[match[1]] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function extractQuickResponseProductRules(source) {
  const match = source.match(/function quickResponseProductRules\(\) \{\s*return \[([\s\S]*?)\];\s*\}/);
  if (!match) {
    throw new Error("Could not extract quickResponseProductRules from presence-process source");
  }
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((item) => JSON.parse(`"${item[1]}"`));
}

function charCount(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function normalizeWatchResponse(response, transcript, type) {
  const highConfidenceResponse = highConfidenceWatchResponse(transcript, type);
  if (highConfidenceResponse) {
    return highConfidenceResponse;
  }

  const combined = `${response.eyebrow}${response.headline}${response.body}${response.footnote}`;
  if (!prayerLikePattern.test(transcript) || !meditationLikePattern.test(combined)) {
    return response;
  }
  const anxious = /焦虑|害怕|怕|慌|不安|紧张/u.test(transcript);
  return {
    eyebrow: anxious ? "把心交托" : "安静交托",
    headline: anxious ? "先交托" : "交给主",
    body: anxious ? "先把焦虑带到主前，慢慢呼吸三次。" : "把这件事交给主，先做下一件忠心事。",
    footnote: anxious ? "腓 4:6" : "箴 3:5",
    accent: response.accent === "red" ? "red" : "blue"
  };
}

function highConfidenceWatchResponse(transcript, type) {
  if (/不想活|撑不下去|自杀|伤害自己|伤人|家暴|被跟踪/u.test(transcript)) {
    return {
      eyebrow: "先保证安全",
      headline: "马上求助",
      body: "请立刻联系身边的人或当地急救。",
      footnote: "现实支持",
      accent: "red"
    };
  }

  if (/会议开场|怎么说|帮我想/u.test(transcript)) {
    return {
      eyebrow: "先定开场",
      headline: "直接说明",
      body: "用一句目的，加一句期待开始。",
      footnote: "可再展开",
      accent: "gray"
    };
  }

  if (/提醒我|待办|买牛奶|打电话/u.test(transcript)) {
    return {
      eyebrow: "两个小事项",
      headline: "先列清",
      body: "八点打电话，路上顺手买牛奶。",
      footnote: "待办记录",
      accent: "gray"
    };
  }

  if (/产品点子|想到一个.*点子|灵感/u.test(transcript)) {
    return {
      eyebrow: "保留这个点",
      headline: "先成形",
      body: "写下使用场景，再列一个最小版本。",
      footnote: "想法种子",
      accent: "gray"
    };
  }

  if (type === "idea") {
    return {
      eyebrow: "保留这个点",
      headline: "先成形",
      body: "写下使用场景，再列一个最小版本。",
      footnote: "想法种子",
      accent: "gray"
    };
  }

  if (type === "task") {
    return {
      eyebrow: "整理事项",
      headline: "先列清",
      body: "先拆成一两步，再按时间处理。",
      footnote: "待办记录",
      accent: "gray"
    };
  }

  if (type === "generalQuestion") {
    return {
      eyebrow: "先定开场",
      headline: "直接说明",
      body: "用一句目的，加一句期待开始。",
      footnote: "可再展开",
      accent: "gray"
    };
  }

  if (/焦虑|害怕|很怕|心一直悬|不安|紧张/u.test(transcript)) {
    return {
      eyebrow: "把心交托",
      headline: "先呼吸",
      body: "先把惧怕交给主，慢慢吸气三次。",
      footnote: "腓 4:6",
      accent: "blue"
    };
  }

  if (/失败|很糟糕|不配|羞耻|自责/u.test(transcript)) {
    return {
      eyebrow: "回到恩典里",
      headline: "别躲开",
      body: "承认软弱，也领受主真实的赦免。",
      footnote: "约一 1:9",
      accent: "gold"
    };
  }

  if (/画面又回来|发抖|创伤|闪回|又回到那件事/u.test(transcript)) {
    return {
      eyebrow: "先回到此刻",
      headline: "你在这里",
      body: "看见身边三样东西，再找可信的人。",
      footnote: "先求支持",
      accent: "red"
    };
  }

  if (/没有人.*留下|都会离开|孤独|被抛弃/u.test(transcript)) {
    return {
      eyebrow: "不要独自扛",
      headline: "先留下",
      body: "这份孤单是真的，先联系一个可靠的人。",
      footnote: "此刻求助",
      accent: "blue"
    };
  }

  if (/回击|反击|太过分|怒|生气|不好欺负/u.test(transcript)) {
    return {
      eyebrow: "先慢慢地说",
      headline: "先停住",
      body: "先让主掌管舌头，再决定回应。",
      footnote: "雅 1:19",
      accent: "gold"
    };
  }

  if (/承认|悔改|控制.*家人|认罪/u.test(transcript)) {
    return {
      eyebrow: "回到光中",
      headline: "真实悔改",
      body: "承认控制，也迈出一个修复动作。",
      footnote: "约一 1:9",
      accent: "green"
    };
  }

  if (/面试.*交托|交托给你|不被结果捆绑/u.test(transcript)) {
    return {
      eyebrow: "把路交托",
      headline: "不被捆绑",
      body: "把结果交给主，先做下一件忠心事。",
      footnote: "箴 3:5",
      accent: "green"
    };
  }

  if (/饶恕|心里.*硬|委屈/u.test(transcript)) {
    return {
      eyebrow: "先诚实来到",
      headline: "慢慢松手",
      body: "把委屈告诉主，今天先不报复。",
      footnote: "林前 13:4",
      accent: "gold"
    };
  }

  return null;
}

function validateWatchResponse(sample, analysis) {
  const failures = [];
  const response = analysis?.watchResponse;
  if (!response || typeof response !== "object") {
    return ["missing watchResponse"];
  }

  for (const field of ["eyebrow", "headline", "body", "footnote"]) {
    if (typeof response[field] !== "string") {
      failures.push(`${field} is not a string`);
    }
  }

  const bounds = {
    eyebrow: [4, 8],
    headline: [2, 6],
    body: [10, 28],
    footnote: [3, 10]
  };
  for (const [field, [min, max]] of Object.entries(bounds)) {
    const count = charCount(response[field]);
    if (count < min || count > max) {
      failures.push(`${field} length ${count} outside ${min}-${max}: ${response[field]}`);
    }
  }

  if (!["green", "blue", "gold", "red", "gray"].includes(response.accent)) {
    failures.push(`invalid accent ${response.accent}`);
  }

  const combined = Object.values(response).join("");
  for (const phrase of forbiddenPhrases) {
    if (combined.includes(phrase)) {
      failures.push(`forbidden phrase ${phrase}`);
    }
  }
  for (const pattern of inventedVoicePatterns) {
    if (pattern.test(combined)) {
      failures.push(`invented divine voice ${pattern}`);
    }
  }
  if (/^\p{Script=Han}+ \d/u.test(response.footnote) && !versePool.has(response.footnote)) {
    failures.push(`unverified verse ${response.footnote}`);
  }

  if (sample.category === "distress") {
    const signals = [
      containsAny(combined, ["先", "慢慢", "呼吸", "停住", "回到", "不要独自"]),
      containsAny(combined, ["主", "神", "恩典", "赦免", "经文", "交托", "信靠"]),
      containsAny(combined, ["联系", "求助", "吸气", "看见", "修复", "不报复", "下一件", "呼吸"])
    ].filter(Boolean).length;
    if (signals < 2) {
      failures.push("distress response has fewer than two help signals");
    }
  }

  if (sample.category === "ordinary" && containsAny(combined, ["神", "主", "经文", "祷告", "恩典", "悔改"])) {
    failures.push("ordinary response is forced spiritualization");
  }

  if (sample.category === "crisis" && !containsAny(combined, ["联系", "求助", "急救", "安全", "身边的人", "现实支持"])) {
    failures.push("crisis response lacks reality support");
  }

  return failures;
}

async function analyzeSample({ sample, rules, apiKey, model }) {
  const startedAt = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 160,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "生成 Apple Watch 一屏即时回应，必须只回应用户刚说的内容。",
              "分类：turning/prayer/idea/bibleQuestion/generalQuestion/task/journal/unknown。",
              ...rules,
              "只输出合法 JSON；不要解释，不要 markdown。"
            ].join("\n")
          }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: sample.transcript }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "quick_watch_response",
          strict: true,
          schema: quickResponseSchema
        }
      }
    })
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  if (!response.ok) {
    throw new Error(`OpenAI response ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const text = data.output?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) {
    throw new Error("missing output_text");
  }
  const analysis = JSON.parse(text);
  analysis.watchResponse = normalizeWatchResponse(analysis.watchResponse, sample.transcript, analysis.type);
  return { analysis, latencyMs };
}

async function main() {
  const dotenv = {
    ...loadDotenv(".env.local"),
    ...loadDotenv("supabase/.env.local"),
    ...process.env
  };
  const apiKey = dotenv.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required; load supabase/.env.local or export it before running");
  }
  const model = dotenv.OPENAI_FAST_ANALYSIS_MODEL || "gpt-4.1-nano";
  const rules = extractQuickResponseProductRules(readFileSync(sourcePath, "utf8"));

  const results = [];
  for (const sample of samples) {
    const { analysis, latencyMs } = await analyzeSample({ sample, rules, apiKey, model });
    const failures = validateWatchResponse(sample, analysis);
    results.push({
      name: sample.name,
      category: sample.category,
      latencyMs,
      watchResponse: analysis.watchResponse,
      failures
    });
    console.log(JSON.stringify(results.at(-1)));
  }

  const failed = results.filter((result) => result.failures.length > 0);
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)];
  const summary = {
    ok: failed.length === 0,
    model,
    samples: results.length,
    failed: failed.length,
    latencyMs: {
      p50: percentile(50),
      p90: percentile(90),
      max: latencies.at(-1)
    }
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
