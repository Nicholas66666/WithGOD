import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

function classifyCluster(keyword) {
  const k = keyword.toLowerCase();
  if (/\b(anxiety|anxious|worry|fear|panic)\b/.test(k)) return '焦虑/平安';
  if (/\b(anger|angry|wrath|temper|rage)\b/.test(k) || /slow to anger/.test(k)) return '愤怒/反应前暂停';
  if (/\b(stress|overwhelmed|peace|calm|strength)\b/.test(k) || /emotional strength/.test(k)) return '压力/崩溃';
  if (/\b(conflict|conversation|relationship|marriage|forgive|reconciliation)\b/.test(k) || /\bargu/.test(k)) return '冲突/关系';
  if (/\b(prayer|pray)\b/.test(k)) return '祷告泛需求';
  if (/\b(bible|scripture|verse|verses|psalm|proverb|james|philippians)\b/.test(k)) return '经文泛需求';
  return '其他/待人工复核';
}

function classifyIntent(keyword) {
  const k = keyword.toLowerCase();
  if (/(app|book|course|counseling|therapy|therapist|coach|program|management|help|tool)/.test(k)) {
    return '潜在商业/解决方案';
  }
  if (/^(how|what|why|when|can|does|is)\b/.test(k) || /\b(how to|what does|what are)\b/.test(k)) {
    return '问题型内容';
  }
  if (/(bible verses|scripture|verse|verses|prayer|psalm|proverb)/.test(k)) {
    return '内容消费';
  }
  return '混合/待复核';
}

function recommend(row) {
  const intent = classifyIntent(row.keyword);
  const k = row.keyword.toLowerCase();
  if (row.search_volume === 0) return '暂不建议使用';
  if (/(free|pdf|images|wallpaper|quotes|tattoo|kids|children|sermon|lesson|worksheet)/.test(k)) {
    return '适合否定关键词';
  }
  if (intent === '潜在商业/解决方案' && (row.cpc >= 0.5 || row.competition >= 0.5)) {
    return '适合直接投 Search';
  }
  if (intent === '内容消费' && row.search_volume >= 500) {
    return '适合内容页承接后转产品';
  }
  if (intent === '问题型内容') return '适合 SEO/内容沉淀';
  return '需要 Google Keyword Planner 复核';
}

function funnelStage(row) {
  const intent = classifyIntent(row.keyword);
  if (recommend(row) === '适合直接投 Search') return '解决方案探索';
  if (intent === '内容消费') return '痛点/内容需求';
  if (intent === '问题型内容') return '问题理解';
  return '待复核';
}

const rows = JSON.parse(await readFile(join(root, 'data/processed/semrush-keywords.json'), 'utf8'));
const byKeyword = new Map();
for (const row of rows) {
  const key = row.keyword.toLowerCase();
  const existing = byKeyword.get(key);
  if (!existing) {
    byKeyword.set(key, { ...row, source_files: [row.source_file], report_types: [row.report_type] });
    continue;
  }
  existing.search_volume = Math.max(existing.search_volume, row.search_volume);
  existing.cpc = Math.max(existing.cpc, row.cpc);
  existing.competition = Math.max(existing.competition, row.competition);
  existing.results = Math.max(existing.results, row.results);
  existing.related_relevance = Math.max(existing.related_relevance || 0, row.related_relevance || 0);
  if (!existing.trend && row.trend) existing.trend = row.trend;
  if (!existing.intent && row.intent) existing.intent = row.intent;
  if (!existing.serp_features && row.serp_features) existing.serp_features = row.serp_features;
  if (!existing.source_files.includes(row.source_file)) existing.source_files.push(row.source_file);
  if (!existing.report_types.includes(row.report_type)) existing.report_types.push(row.report_type);
}

const universe = [...byKeyword.values()]
  .filter((row) => row.keyword)
  .map((row) => {
    const intentLabel = classifyIntent(row.keyword);
    return {
      keyword: row.keyword,
      cluster: classifyCluster(row.keyword),
      intent_label: intentLabel,
      funnel_stage: funnelStage(row),
      recommended_action: recommend(row),
      search_volume: row.search_volume,
      cpc: row.cpc,
      competition: row.competition,
      results: row.results,
      related_relevance: row.related_relevance || 0,
      semrush_intent: row.intent || '',
      serp_features: row.serp_features || '',
      trend: row.trend || '',
      source_files: row.source_files,
      report_types: row.report_types,
    };
  })
  .sort((a, b) => {
    if (b.search_volume !== a.search_volume) return b.search_volume - a.search_volume;
    return b.cpc - a.cpc;
  });

await mkdir(join(root, 'data/processed'), { recursive: true });
await writeFile(join(root, 'data/processed/semrush-keyword-universe.json'), `${JSON.stringify(universe, null, 2)}\n`);
console.log(`Built keyword universe: ${universe.length} unique keywords from ${rows.length} raw rows`);
