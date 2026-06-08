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

export async function buildDashboardState({ root = process.cwd(), now = new Date().toISOString() } = {}) {
  const dailyFiles = await readMarkdownFiles(join(root, 'daily'));
  const decisionFiles = await readMarkdownFiles(join(root, 'decisions'));

  const daily = dailyFiles.map((file) => {
    const sections = parseSections(file.markdown);
    const date = basename(file.name, '.md');
    return {
      date,
      title: parseTitle(file.markdown, `Daily Review: ${date}`),
      sections,
      completed: parseBullets(sections.Completed),
      tomorrow: parseBullets(sections.Tomorrow),
      openQuestions: parseBullets(sections['Open Questions']),
    };
  });

  const decisions = decisionFiles.map((file) => {
    const sections = parseSections(file.markdown);
    return {
      id: basename(file.name, '.md'),
      title: parseTitle(file.markdown, basename(file.name, '.md')),
      decision: sections.Decision || '',
      evidence: parseBullets(sections.Evidence),
      reversalCriteria: sections['Reversal Criteria'] || '',
    };
  });

  const latestDaily = daily.at(-1);
  const state = {
    status: {
      generatedAt: now,
      currentStage: 'Launch OS setup and SEMrush research preparation',
      target: 'First real $149 US order for the Scripture companion wearable',
    },
    daily,
    decisions,
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

