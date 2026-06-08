import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildKeywordOverviewURL, redactURLForLog, requireSemrushApiKey } from './semrush-client.mjs';

function getArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const phrase = getArg('phrase');
if (!phrase) throw new Error('--phrase is required');

const database = getArg('database', 'us');
const apiKey = requireSemrushApiKey();
const url = buildKeywordOverviewURL({ apiKey, phrase, database });

console.log(`Fetching SEMrush keyword overview: ${redactURLForLog(url)}`);
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`SEMrush request failed with HTTP ${response.status}`);
}

const body = await response.text();
const safeName = phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join(root, 'data/raw/semrush');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `${database}-${safeName}.csv`);
await writeFile(outPath, body);
console.log(`Wrote ${outPath}`);

