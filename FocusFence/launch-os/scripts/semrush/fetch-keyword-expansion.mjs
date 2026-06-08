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
const configPath = getArg('config', join(root, 'config/seed-keywords.json'));
const reportType = getArg('type', 'phrase_related');
const limit = Number(getArg('limit', '50'));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = getArg('database', config.database || 'us');
const force = hasFlag('force');
const apiKey = requireSemrushApiKey();
const outDir = join(root, 'data/raw/semrush');
await mkdir(outDir, { recursive: true });

const exportColumns =
  reportType === 'phrase_related'
    ? 'Ph,Nq,Cp,Co,Nr,Td,Rr,Fk,In'
    : 'Ph,Nq,Cp,Co,Nr,Td,In,Kd';

const phrases = [];
for (const cluster of config.clusters || []) {
  for (const keyword of cluster.keywords || []) {
    phrases.push({ cluster: cluster.name, phrase: keyword });
  }
}

const seen = new Set();
let fetched = 0;
let skipped = 0;
for (const { cluster, phrase } of phrases) {
  const key = `${database}:${reportType}:${phrase.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const outPath = join(outDir, `${database}-${reportType}-${safeKeywordName(phrase)}.csv`);
  if (!force && (await fileExists(outPath))) {
    skipped += 1;
    console.log(`Skip existing ${reportType} ${cluster}: ${phrase}`);
    continue;
  }

  const url = buildKeywordReportURL({
    apiKey,
    type: reportType,
    phrase,
    database,
    displayLimit: limit,
    displaySort: 'nq_desc',
    exportColumns,
  });
  console.log(`Fetch ${reportType} ${cluster}: ${redactURLForLog(url)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SEMrush ${reportType} request failed for "${phrase}" with HTTP ${response.status}`);
  }
  await writeFile(outPath, await response.text());
  fetched += 1;
}

console.log(`SEMrush ${reportType} expansion complete: fetched=${fetched}, skipped=${skipped}, total=${seen.size}`);
