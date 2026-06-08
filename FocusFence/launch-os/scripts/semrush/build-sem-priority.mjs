import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

const DIRECT_COMMERCIAL = /\b(app|hallow|abide|bible chat|prayer app|bible app|christian meditation app|devotional app|ai bible|ai prayer)\b/;
const CONTENT_MARKERS = /\b(bible verses|scripture|prayer|pray|psalm|proverb|philippians|james)\b/;
const QUESTION_MARKERS = /^(how|what|why|when|can|does|is)\b|\b(how to|what does|what are|where in the bible)\b/;
const NEGATIVE_MARKERS = /\b(free printable|printable|pdf|image|images|wallpaper|tattoo|kids|children|lesson|worksheet|sermon|funny|meme|song|lyrics|clipart|coloring|quotes for instagram)\b/;
const COURT_MARKERS = /\b(court|courts|certificate|certificates|certified|class|classes|course|courses|probation|parole|mandated|requirement|requirements|online class|online classes|program|programs)\b/;
const THERAPY_MARKERS = /\b(therapy|therapist|counseling|counsellor|mental health|disorder|treatment|medication)\b/;

function log10(value) {
  return Math.log10(Math.max(1, value));
}

function trendScore(trend) {
  if (!trend) return 0;
  const values = trend
    .split(',')
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  if (values.length < 4) return 0;
  const recent = values.slice(-3).reduce((sum, value) => sum + value, 0) / 3;
  const earlier = values.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  return Math.max(-1, Math.min(1, recent - earlier));
}

function scenarioFit(row) {
  const k = row.keyword.toLowerCase();
  if (row.cluster === '焦虑/平安') return 1;
  if (row.cluster === '愤怒/反应前暂停') return 1;
  if (row.cluster === '压力/崩溃') return 1;
  if (row.cluster === '冲突/关系') return 1;
  if (/\b(anxiety|worry|fear|panic|peace|calm|stress|overwhelmed|anger|angry|marriage|relationship|forgive|argument|arguing)\b/.test(k)) return 0.85;
  if (CONTENT_MARKERS.test(k) || DIRECT_COMMERCIAL.test(k)) return 0.45;
  return 0.15;
}

function landingPageType(row) {
  const k = row.keyword.toLowerCase();
  if (COURT_MARKERS.test(k) && /\banger\b/.test(k)) return '不建议承接：课程/法院/证书意图偏离';
  if (/\b(anxiety|anxious|worry|panic)\b/.test(k) && CONTENT_MARKERS.test(k)) return '焦虑经文/祷告内容页 -> 一键焦虑 reset CTA';
  if (/\b(anger|angry|wrath|temper|rage)\b/.test(k) && CONTENT_MARKERS.test(k)) return '反应前暂停/Christian Anger Reset 页';
  if (/\b(stress|overwhelmed|peace|calm|strength)\b/.test(k) && CONTENT_MARKERS.test(k)) return '压力/平安 Scripture Reset 内容页';
  if (/\b(marriage|relationship|forgive|reconciliation|arguing|argument)\b/.test(k)) return '关系/冲突祷告内容页 -> 反应前暂停 CTA';
  if (DIRECT_COMMERCIAL.test(k)) return 'AI Scripture Companion / 产品教育页';
  if (QUESTION_MARKERS.test(k)) return '问题型内容页/SEO，付费前需复核';
  if (CONTENT_MARKERS.test(k)) return '泛经文/祷告内容页';
  return '待人工复核页面';
}

function adGroup(row) {
  const k = row.keyword.toLowerCase();
  if (/\b(anxiety|anxious|worry|panic)\b/.test(k)) return 'A01 焦虑经文与祷告';
  if (/\b(anger|angry|wrath|temper|rage)\b/.test(k) && !COURT_MARKERS.test(k)) return 'A02 反应前暂停与愤怒 reset';
  if (/\b(stress|overwhelmed|peace|calm|strength)\b/.test(k)) return 'A03 压力崩溃与平安';
  if (/\b(marriage|relationship|forgive|reconciliation|arguing|argument)\b/.test(k)) return 'A04 冲突关系与婚姻祷告';
  if (DIRECT_COMMERCIAL.test(k)) return 'A05 Prayer/Bible App 替代需求';
  if (COURT_MARKERS.test(k) && /\banger\b/.test(k)) return 'N01 否定：anger course/court';
  return 'R01 待复核长尾';
}

function matchType(row) {
  const k = row.keyword.toLowerCase();
  if (NEGATIVE_MARKERS.test(k) || (COURT_MARKERS.test(k) && /\banger\b/.test(k))) return 'negative exact/phrase';
  if (row.search_volume >= 1000 && row.cpc <= 1.5 && CONTENT_MARKERS.test(k)) return 'phrase';
  if (DIRECT_COMMERCIAL.test(k) && !/\bhallow\b/.test(k)) return 'exact';
  if (/\bhallow\b/.test(k)) return 'competitor exact，仅在品牌政策和预算允许时';
  return 'exact';
}

function risk(row) {
  const k = row.keyword.toLowerCase();
  if (NEGATIVE_MARKERS.test(k)) return '明显免费素材/低质量意图，应否定';
  if (COURT_MARKERS.test(k) && /\banger\b/.test(k)) return '高商业但偏 court/course/certificate，硬件转化风险极高';
  if (THERAPY_MARKERS.test(k)) return '可能涉及医疗/心理治疗表达，广告与页面需避开治疗承诺';
  if (/\bhallow\b/.test(k)) return '竞品品牌词，CPC 高且可能引发品牌/质量分风险';
  if (row.cpc < 0.1 && row.search_volume >= 1000) return 'CPC 极低，用户多半只要免费内容';
  if (row.search_volume < 50) return '量级太小，单独投放意义弱';
  return '可测试，但必须用页面承接验证转化';
}

function recommendedAction(row) {
  const k = row.keyword.toLowerCase();
  if (NEGATIVE_MARKERS.test(k) || (COURT_MARKERS.test(k) && /\banger\b/.test(k))) return '适合否定关键词';
  if (row.search_volume === 0) return '暂不建议使用';
  if (DIRECT_COMMERCIAL.test(k) && row.cpc >= 0.5 && !/\bhallow\b/.test(k)) return '需要 Google Keyword Planner 复核';
  if (/\bhallow\b/.test(k)) return '需要 Google Keyword Planner 复核';
  if (scenarioFit(row) >= 0.85 && CONTENT_MARKERS.test(k) && row.search_volume >= 300) return '适合内容页承接后转产品';
  if (scenarioFit(row) >= 0.85 && QUESTION_MARKERS.test(k)) return '适合 SEO/内容沉淀';
  if (scenarioFit(row) >= 0.85 && row.cpc >= 0.5 && row.search_volume >= 50) return '需要 Google Keyword Planner 复核';
  if (row.search_volume < 50) return '暂不建议使用';
  return row.recommended_action || '需要 Google Keyword Planner 复核';
}

function score(row) {
  const action = recommendedAction(row);
  let value = log10(row.search_volume) * 18 + Math.min(row.cpc, 5) * 4 + row.competition * 10 + scenarioFit(row) * 35 + trendScore(row.trend) * 8;
  if (action === '适合内容页承接后转产品') value += 18;
  if (action === '需要 Google Keyword Planner 复核') value += 8;
  if (action === '适合 SEO/内容沉淀') value += 4;
  if (action === '适合否定关键词') value -= 20;
  if (action === '暂不建议使用') value -= 30;
  if (COURT_MARKERS.test(row.keyword.toLowerCase()) && /\banger\b/.test(row.keyword.toLowerCase())) value -= 25;
  return Math.round(value * 10) / 10;
}

function funnelStage(row) {
  const action = recommendedAction(row);
  if (action === '适合否定关键词') return '排除';
  if (DIRECT_COMMERCIAL.test(row.keyword.toLowerCase())) return '替代方案/产品探索';
  if (CONTENT_MARKERS.test(row.keyword.toLowerCase())) return '痛点即时内容需求';
  if (QUESTION_MARKERS.test(row.keyword.toLowerCase())) return '问题理解';
  return row.funnel_stage || '待复核';
}

const universe = JSON.parse(await readFile(join(root, 'data/processed/semrush-keyword-universe.json'), 'utf8'));
const paidRows = JSON.parse(await readFile(join(root, 'data/processed/semrush-paid-results.json'), 'utf8').catch(() => '[]'));
const paidKeywords = new Set(paidRows.map((row) => row.keyword.toLowerCase()));

const enriched = universe.map((row) => {
  const action = recommendedAction(row);
  return {
    keyword: row.keyword,
    cluster: row.cluster,
    ad_group: adGroup(row),
    search_volume: row.search_volume,
    cpc: row.cpc,
    competition: row.competition,
    trend_score: trendScore(row.trend),
    intent: row.intent_label,
    funnel_stage: funnelStage(row),
    recommended_action: action,
    match_type: matchType(row),
    landing_page_type: landingPageType(row),
    risk: risk(row),
    semrush_paid_result_found: paidKeywords.has(row.keyword.toLowerCase()),
    priority_score: score(row),
    source_files: row.source_files,
  };
});

const strategicActions = new Set([
  '适合内容页承接后转产品',
  '需要 Google Keyword Planner 复核',
  '适合 SEO/内容沉淀',
  '适合否定关键词',
  '暂不建议使用',
]);

const priority = enriched
  .filter((row) => strategicActions.has(row.recommended_action) && row.recommended_action !== '适合否定关键词')
  .sort((a, b) => b.priority_score - a.priority_score || b.search_volume - a.search_volume)
  .slice(0, 220);

const negativeKeywords = enriched
  .filter((row) => row.recommended_action === '适合否定关键词')
  .sort((a, b) => b.search_volume - a.search_volume)
  .slice(0, 80);

const adGroups = [...priority.reduce((map, row) => {
  const entry = map.get(row.ad_group) || {
    ad_group: row.ad_group,
    keyword_count: 0,
    total_volume: 0,
    top_keywords: [],
    landing_page_types: [],
  };
  entry.keyword_count += 1;
  entry.total_volume += row.search_volume;
  if (entry.top_keywords.length < 12) entry.top_keywords.push(row.keyword);
  if (!entry.landing_page_types.includes(row.landing_page_type)) entry.landing_page_types.push(row.landing_page_type);
  map.set(row.ad_group, entry);
  return map;
}, new Map()).values()].sort((a, b) => a.ad_group.localeCompare(b.ad_group));

const summary = {
  generated_at: new Date().toISOString(),
  universe_count: universe.length,
  priority_count: priority.length,
  negative_count: negativeKeywords.length,
  action_summary: Object.entries(priority.reduce((acc, row) => {
    acc[row.recommended_action] = (acc[row.recommended_action] || 0) + 1;
    return acc;
  }, {})).map(([action, count]) => ({ action, count })),
  ad_groups: adGroups,
};

await mkdir(join(root, 'data/processed'), { recursive: true });
await writeFile(join(root, 'data/processed/semrush-keyword-priority.json'), `${JSON.stringify(priority, null, 2)}\n`);
await writeFile(join(root, 'data/processed/semrush-negative-keywords.json'), `${JSON.stringify(negativeKeywords, null, 2)}\n`);
await writeFile(join(root, 'data/processed/semrush-sem-plan-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Built SEM priority list: ${priority.length} candidates, ${negativeKeywords.length} negatives, ${adGroups.length} ad groups`);
