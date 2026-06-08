import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildKeywordReportURL, redactURLForLog, requireSemrushApiKey } from './semrush-client.mjs';

function getArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function safeKeywordName(phrase) {
  return phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const configPath = getArg('config', join(root, 'config/sem-paid-research-keywords.json'));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = getArg('database', config.database || 'us');
const displayLimit = Number(getArg('limit', String(config.displayLimit || 10)));
const force = hasFlag('force');
const apiKey = requireSemrushApiKey();
const outDir = join(root, 'data/raw/semrush-paid');
await mkdir(outDir, { recursive: true });

const entries = [];
for (const group of config.keywords || []) {
  for (const keyword of group.keywords || []) {
    entries.push({ cluster: group.cluster, keyword });
  }
}

const seen = new Set();
let fetched = 0;
let skipped = 0;
for (const { cluster, keyword } of entries) {
  const key = `${database}:${keyword.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const outPath = join(outDir, `${database}-phrase_adwords-${safeKeywordName(keyword)}.csv`);
  if (!force && (await fileExists(outPath))) {
    skipped += 1;
    console.log(`Skip existing paid results ${cluster}: ${keyword}`);
    continue;
  }

  const url = buildKeywordReportURL({
    apiKey,
    type: 'phrase_adwords',
    phrase: keyword,
    database,
    displayLimit,
    displaySort: 'vu_desc',
    exportColumns: 'Dn,Ur,Vu',
  });
  console.log(`Fetch paid results ${cluster}: ${redactURLForLog(url)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SEMrush paid results request failed for "${keyword}" with HTTP ${response.status}`);
  }
  await writeFile(outPath, await response.text());
  fetched += 1;
}

console.log(`SEMrush paid results complete: fetched=${fetched}, skipped=${skipped}, total=${seen.size}`);
