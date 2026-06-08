import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDomainReportURL, redactURLForLog, requireSemrushApiKey } from './semrush-client.mjs';

function getArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function safeDomainName(domain) {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
const configPath = getArg('config', join(root, 'config/sem-ad-copy-domains.json'));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = getArg('database', config.database || 'us');
const displayLimit = Number(getArg('limit', String(config.displayLimit || 5)));
const force = hasFlag('force');
const apiKey = requireSemrushApiKey();
const outDir = join(root, 'data/raw/semrush-ad-copies');
await mkdir(outDir, { recursive: true });

let fetched = 0;
let skipped = 0;
for (const entry of config.domains || []) {
  const domain = entry.domain;
  const outPath = join(outDir, `${database}-domain_adwords_unique-${safeDomainName(domain)}.csv`);
  if (!force && (await fileExists(outPath))) {
    skipped += 1;
    console.log(`Skip existing ad copies ${entry.group}: ${domain}`);
    continue;
  }

  const url = buildDomainReportURL({
    apiKey,
    type: 'domain_adwords_unique',
    domain,
    database,
    displayLimit,
    exportColumns: 'Tt,Ds,Vu,Ur',
  });
  console.log(`Fetch ad copies ${entry.group}: ${redactURLForLog(url)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SEMrush ad copies request failed for "${domain}" with HTTP ${response.status}`);
  }
  await writeFile(outPath, await response.text());
  fetched += 1;
}

console.log(`SEMrush ad copies complete: fetched=${fetched}, skipped=${skipped}, total=${(config.domains || []).length}`);
