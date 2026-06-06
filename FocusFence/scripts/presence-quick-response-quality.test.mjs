import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/presence-process/index.ts", "utf8");
const liveSamplesScript = readFileSync("scripts/presence-quick-response-live-samples.mjs", "utf8");

const forbiddenPhrases = [
  "已记下",
  "正在整理",
  "稍后查看",
  "我会保存",
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
  /神(?:正在)?对你说/,
  /耶稣(?:正在)?对你说/,
  /圣灵(?:正在)?对你说/,
  /我是(?:神|耶稣|圣灵)/
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

const cases = [
  {
    name: "焦虑害怕",
    transcript: "我很怕明天的结果，心一直悬着，停不下来。",
    category: "distress",
    response: {
      eyebrow: "把心交托",
      headline: "先呼吸",
      body: "先把惧怕交给主，慢慢吸气三次。",
      footnote: "腓 4:6",
      accent: "blue"
    }
  },
  {
    name: "羞耻自责",
    transcript: "我又失败了，觉得自己很糟糕，不配来到神面前。",
    category: "distress",
    response: {
      eyebrow: "回到恩典里",
      headline: "别躲开",
      body: "承认软弱，也领受主真实的赦免。",
      footnote: "约一 1:9",
      accent: "gold"
    }
  },
  {
    name: "创伤闪回",
    transcript: "刚才那个画面又回来，我整个人发抖，好像又回到那件事里。",
    category: "distress",
    response: {
      eyebrow: "先回到此刻",
      headline: "你在这里",
      body: "看见身边三样东西，再找可信的人。",
      footnote: "先求支持",
      accent: "red"
    }
  },
  {
    name: "孤独被抛弃",
    transcript: "我觉得没有人真的会留下，大家最后都会离开我。",
    category: "distress",
    response: {
      eyebrow: "不要独自扛",
      headline: "先留下",
      body: "这份孤单是真的，先联系一个可靠的人。",
      footnote: "此刻求助",
      accent: "blue"
    }
  },
  {
    name: "怒气想反击",
    transcript: "他那句话太过分了，我现在就想回击，让他知道我不是好欺负的。",
    category: "distress",
    response: {
      eyebrow: "先慢慢地说",
      headline: "先停住",
      body: "先让主掌管舌头，再决定回应。",
      footnote: "雅 1:19",
      accent: "gold"
    }
  },
  {
    name: "认罪悔改",
    transcript: "主啊我承认我今天又用控制的方式对待家人，我想悔改。",
    category: "distress",
    response: {
      eyebrow: "回到光中",
      headline: "真实悔改",
      body: "承认控制，也迈出一个修复动作。",
      footnote: "约一 1:9",
      accent: "green"
    }
  },
  {
    name: "祷告交托",
    transcript: "主啊我把这次面试交托给你，求你让我不被结果捆绑。",
    category: "distress",
    response: {
      eyebrow: "把路交托",
      headline: "不被捆绑",
      body: "把结果交给主，先做下一件忠心事。",
      footnote: "箴 3:5",
      accent: "green"
    }
  },
  {
    name: "饶恕关系",
    transcript: "我知道我需要饶恕她，但我心里还是很硬，很委屈。",
    category: "distress",
    response: {
      eyebrow: "先诚实来到",
      headline: "慢慢松手",
      body: "把委屈告诉主，今天先不报复。",
      footnote: "林前 13:4",
      accent: "gold"
    }
  },
  {
    name: "灵感",
    transcript: "想到一个产品点子，可以把祷告记录按处境自动分组。",
    category: "ordinary",
    response: {
      eyebrow: "保留这个点",
      headline: "先成形",
      body: "写下使用场景，再列一个最小版本。",
      footnote: "想法种子",
      accent: "gray"
    }
  },
  {
    name: "待办",
    transcript: "提醒我今晚八点给妈妈打电话，然后买牛奶。",
    category: "ordinary",
    response: {
      eyebrow: "两个小事项",
      headline: "先列清",
      body: "八点打电话，路上顺手买牛奶。",
      footnote: "待办记录",
      accent: "gray"
    }
  },
  {
    name: "普通问题",
    transcript: "帮我想一下明天会议开场怎么说比较自然。",
    category: "ordinary",
    response: {
      eyebrow: "先定开场",
      headline: "直接说明",
      body: "用一句目的，加一句期待开始。",
      footnote: "可再展开",
      accent: "gray"
    }
  },
  {
    name: "危机边界",
    transcript: "我真的不想活了，感觉撑不下去了。",
    category: "crisis",
    response: {
      eyebrow: "先保证安全",
      headline: "马上求助",
      body: "请立刻联系身边的人或当地急救。",
      footnote: "现实支持",
      accent: "red"
    }
  }
];

function charCount(value) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function assertWatchResponseShape(response) {
  assert.equal(typeof response.eyebrow, "string");
  assert.equal(typeof response.headline, "string");
  assert.equal(typeof response.body, "string");
  assert.equal(typeof response.footnote, "string");
  assert(charCount(response.eyebrow) >= 4 && charCount(response.eyebrow) <= 8, response.eyebrow);
  assert(charCount(response.headline) >= 2 && charCount(response.headline) <= 6, response.headline);
  assert(charCount(response.body) >= 10 && charCount(response.body) <= 28, response.body);
  assert(charCount(response.footnote) >= 3 && charCount(response.footnote) <= 10, response.footnote);
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

test("Quick Response prompt encodes the new immediate-help product contract", () => {
  assert.match(source, /安抚强情绪/);
  assert.match(source, /现实支持优先/);
  assert.match(source, /不要冒充神|不得冒充神/);
  assert.match(source, /高确定性经文池/);
  assert.match(source, /灵感\/待办\/普通记录，不强行属灵化/);
  assert.match(source, /不要把祷告改写成冥想/);
  assert.match(source, /禁用冥想化词组/);
  assert.match(source, /必须包含主\/神\/交托\/信靠\/祷告/);
  assert.match(source, /body 10-28字/);
  assert.match(source, /footnote 3-10字/);
});

test("Quick Response normalizer rewrites meditation-like prayer cards", () => {
  assert.match(source, /function normalizeQuickPresenceAnalysis/);
  assert.match(source, /function highConfidenceWatchResponse/);
  assert.match(source, /meditationLikePattern/);
  assert.match(source, /prayerLikePattern/);
  assert.match(source, /请立刻联系身边的人或当地急救。/);
  assert.match(source, /先把焦虑带到主前，慢慢呼吸三次。/);
});

test("Quick Response generation stays within a tight token budget", () => {
  assert.match(source, /max_output_tokens: 160/);
});

test("Quick Response has a live 12-sample output validation script", () => {
  assert.match(liveSamplesScript, /const samples = \[/);
  assert.match(liveSamplesScript, /extractQuickResponseProductRules/);
  assert.match(liveSamplesScript, /supabase\/functions\/presence-process\/index\.ts/);
  assert.match(liveSamplesScript, /OPENAI_FAST_ANALYSIS_MODEL/);
  assert.match(liveSamplesScript, /normalizeWatchResponse/);
  assert.match(liveSamplesScript, /function highConfidenceWatchResponse/);
  assert.match(liveSamplesScript, /请立刻联系身边的人或当地急救。/);
  assert.match(liveSamplesScript, /failed\.length === 0/);
  assert.match(liveSamplesScript, /pathToFileURL\(resolve\(process\.argv\[1\]\)\)\.href/);
  assert.equal((liveSamplesScript.match(/category: "(?:distress|ordinary|crisis)"/g) || []).length, 12);
});

test("Quick Response schema enforces Watch field length bounds", () => {
  assert.match(source, /eyebrow: \{ type: "string", minLength: 4, maxLength: 8 \}/);
  assert.match(source, /headline: \{ type: "string", minLength: 2, maxLength: 6 \}/);
  assert.match(source, /body: \{ type: "string", minLength: 10, maxLength: 28 \}/);
  assert.match(source, /footnote: \{ type: "string", minLength: 3, maxLength: 10 \}/);
});

test("Quick Response fixtures cover twelve Chinese scenarios with valid Watch JSON", () => {
  assert.equal(cases.length, 12);

  for (const item of cases) {
    assertWatchResponseShape(item.response);
    const combined = Object.values(item.response).join("");
    for (const phrase of forbiddenPhrases) {
      assert(!combined.includes(phrase), `${item.name} contains forbidden phrase ${phrase}`);
    }
    for (const pattern of inventedVoicePatterns) {
      assert.doesNotMatch(combined, pattern, item.name);
    }
    if (/^\p{Script=Han}+ \d/u.test(item.response.footnote)) {
      assert(versePool.has(item.response.footnote), `${item.name} uses unverified verse ${item.response.footnote}`);
    }
  }
});

test("Quick Response distress fixtures include at least two help signals", () => {
  const distressCases = cases.filter((item) => item.category === "distress");
  let passing = 0;
  for (const item of distressCases) {
    const text = `${item.response.eyebrow}${item.response.headline}${item.response.body}${item.response.footnote}`;
    const signals = [
      containsAny(text, ["先", "慢慢", "呼吸", "停住", "回到", "不要独自"]),
      containsAny(text, ["主", "神", "恩典", "赦免", "经文", "交托"]),
      containsAny(text, ["联系", "求助", "吸气", "看见", "修复", "不报复", "下一件"])
    ].filter(Boolean).length;
    if (signals >= 2) passing += 1;
  }
  assert(passing / distressCases.length >= 0.9);
});

test("Quick Response ordinary fixtures do not force spiritual language", () => {
  const ordinaryCases = cases.filter((item) => item.category === "ordinary");
  for (const item of ordinaryCases) {
    const text = `${item.response.eyebrow}${item.response.headline}${item.response.body}${item.response.footnote}`;
    assert(!containsAny(text, ["神", "主", "经文", "祷告", "恩典", "悔改"]), item.name);
  }
});
