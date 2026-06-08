import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildKeywordOverviewURL, redactURLForLog, requireSemrushApiKey } from './semrush-client.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const configPath = join(root, 'config/seed-keywords.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = config.database || 'us';
const apiKey = requireSemrushApiKey();

for (const cluster of config.clusters) {
  for (const phrase of cluster.keywords) {
    const url = buildKeywordOverviewURL({ apiKey, phrase, database });
    console.log(`${cluster.name}: ${redactURLForLog(url)}`);
  }
}

console.log('');
console.log('Use fetch-keyword-overview.mjs for actual pulls, then normalize-keywords.mjs.');

