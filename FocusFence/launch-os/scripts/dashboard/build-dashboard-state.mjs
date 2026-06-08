import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseSections(markdown) {
  const sections = {};
  let current = null;
  const buffer = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (current) sections[current] = buffer.join('\n').trim();
      current = match[1].trim();
      buffer.length = 0;
      continue;
    }
    if (current) buffer.push(line);
  }

  if (current) sections[current] = buffer.join('\n').trim();
  return sections;
}

function parseTitle(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function parseBullets(text = '') {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function firstSection(sections, names, fallback = '') {
  for (const name of names) {
    if (sections[name]) return sections[name];
  }
  return fallback;
}

async function readMarkdownFiles(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = names.filter((name) => name.endsWith('.md')).sort();
  const records = [];
  for (const name of files) {
    const path = join(dir, name);
    const markdown = await readFile(path, 'utf8');
    records.push({ name, path, markdown });
  }
  return records;
}

async function readJSON(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function buildDashboardState({ root = process.cwd(), now = new Date().toISOString() } = {}) {
  const project = await readJSON(join(root, 'config/project.json'), {
    product: 'Scripture companion wearable',
    price: '$149',
    publicUrl: '',
    currentChannel: 'SEMrush research preparation',
    costNote: 'Cost not recorded yet.',
  });
  const dailyFiles = await readMarkdownFiles(join(root, 'daily'));
  const decisionFiles = await readMarkdownFiles(join(root, 'decisions'));
  const operationFiles = await readMarkdownFiles(join(root, 'ops'));
  const semrushKeywords = await readJSON(join(root, 'data/processed/semrush-keywords.json'), []);
  const semrushUniverse = await readJSON(join(root, 'data/processed/semrush-keyword-universe.json'), []);
  const semrushPaidResults = await readJSON(join(root, 'data/processed/semrush-paid-results.json'), []);
  const semrushPaidDomains = await readJSON(join(root, 'data/processed/semrush-paid-domain-summary.json'), []);
  const semrushNoPaid = await readJSON(join(root, 'data/processed/semrush-paid-no-results.json'), []);
  const semrushAdCopies = await readJSON(join(root, 'data/processed/semrush-ad-copies.json'), []);
  const semrushAdCopyDomains = await readJSON(join(root, 'data/processed/semrush-ad-copy-domain-summary.json'), []);
  const semrushPriority = await readJSON(join(root, 'data/processed/semrush-keyword-priority.json'), []);
  const semrushNegatives = await readJSON(join(root, 'data/processed/semrush-negative-keywords.json'), []);
  const semrushPlanSummary = await readJSON(join(root, 'data/processed/semrush-sem-plan-summary.json'), null);

  const daily = dailyFiles.map((file) => {
    const sections = parseSections(file.markdown);
    const date = basename(file.name, '.md');
    return {
      date,
      title: parseTitle(file.markdown, `Daily Review: ${date}`),
      sections,
      goal: firstSection(sections, ['目标', 'Goal']),
      completed: parseBullets(firstSection(sections, ['完成', 'Completed'])),
      dataFindings: firstSection(sections, ['数据发现', 'Data Findings']),
      decisionsMade: firstSection(sections, ['已做决策', 'Decisions Made']),
      corrections: firstSection(sections, ['错误或修正', 'Mistakes Or Corrections']),
      tomorrow: parseBullets(firstSection(sections, ['明日事项', 'Tomorrow'])),
      openQuestions: parseBullets(firstSection(sections, ['待确认问题', 'Open Questions'])),
    };
  });

  const decisions = decisionFiles.map((file) => {
    const sections = parseSections(file.markdown);
    return {
      id: basename(file.name, '.md'),
      title: parseTitle(file.markdown, basename(file.name, '.md')),
      decision: firstSection(sections, ['决策', 'Decision']),
      evidence: parseBullets(firstSection(sections, ['证据', 'Evidence'])),
      reversalCriteria: firstSection(sections, ['推翻条件', 'Reversal Criteria']),
    };
  });

  const operations = operationFiles.map((file) => {
    const sections = parseSections(file.markdown);
    return {
      id: basename(file.name, '.md'),
      title: parseTitle(file.markdown, basename(file.name, '.md')),
      summary: firstSection(sections, ['摘要', 'Summary']),
      resources: parseBullets(firstSection(sections, ['资源', 'Resources'])),
      cost: firstSection(sections, ['成本', 'Cost']),
      verification: parseBullets(firstSection(sections, ['验证', 'Verification'])),
    };
  });

  const latestDaily = daily.at(-1);
  const state = {
    project,
    status: {
      generatedAt: now,
      currentStage: project.currentChannel || 'Launch OS 已上线，准备 SEMrush 数据研究',
      target: `拿到第一笔美国市场 ${project.price || '$149'} 圣经智能手表真实订单`,
    },
    daily,
    decisions,
    operations,
    semrush: {
      keywordRows: semrushKeywords.length,
      uniqueKeywords: semrushUniverse.length,
      actionSummary: Object.entries(
        semrushUniverse.reduce((summary, row) => {
          const action = row.recommended_action || '未分类';
          summary[action] = (summary[action] || 0) + 1;
          return summary;
        }, {}),
      ).map(([action, count]) => ({ action, count })),
      clusterSummary: Object.entries(
        semrushUniverse.reduce((summary, row) => {
          const cluster = row.cluster || '未分类';
          summary[cluster] = (summary[cluster] || 0) + 1;
          return summary;
        }, {}),
      ).map(([cluster, count]) => ({ cluster, count })),
      paidRows: semrushPaidResults.length,
      paidDomains: semrushPaidDomains.length,
      noPaidKeywords: semrushNoPaid.length,
      topPaidDomains: semrushPaidDomains.slice(0, 8),
      adCopyRows: semrushAdCopies.length,
      adCopyDomains: semrushAdCopyDomains.length,
      topAdCopyDomains: semrushAdCopyDomains.slice(0, 8),
      priorityKeywords: semrushPriority.length,
      negativeKeywords: semrushNegatives.length,
      semPlanSummary: semrushPlanSummary,
      clusters: await readJSON(join(root, 'config/seed-keywords.json'), { clusters: [] }),
    },
    nextActions: latestDaily?.tomorrow || [],
  };

  const outPath = join(root, 'data/processed/dashboard-state.json');
  await mkdir(join(root, 'data/processed'), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

async function main() {
  await buildDashboardState({ root: join(fileURLToPath(new URL('../..', import.meta.url))) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
