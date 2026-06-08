import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildKeywordOverviewURL, redactURLForLog, requireSemrushApiKey } from './semrush-client.mjs';

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
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = getArg('database', config.database || 'us');
const force = hasFlag('force');
const apiKey = requireSemrushApiKey();
const outDir = join(root, 'data/raw/semrush');
await mkdir(outDir, { recursive: true });

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
  const key = `${database}:${phrase.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const outPath = join(outDir, `${database}-${safeKeywordName(phrase)}.csv`);
  if (!force && (await fileExists(outPath))) {
    skipped += 1;
    console.log(`Skip existing ${cluster}: ${phrase}`);
    continue;
  }

  const url = buildKeywordOverviewURL({ apiKey, phrase, database });
  console.log(`Fetch ${cluster}: ${redactURLForLog(url)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SEMrush request failed for "${phrase}" with HTTP ${response.status}`);
  }
  const body = await response.text();
  await writeFile(outPath, body);
  fetched += 1;
}

console.log(`SEMrush fetch complete: fetched=${fetched}, skipped=${skipped}, total=${seen.size}`);
