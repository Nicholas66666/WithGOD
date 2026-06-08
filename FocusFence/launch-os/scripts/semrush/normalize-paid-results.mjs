import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSemrushCsv } from './semrush-client.mjs';

function keywordFromFilename(name) {
  return name
    .replace(/^us-phrase_adwords-/, '')
    .replace(/\.csv$/, '')
    .replaceAll('-', ' ');
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const rawDir = join(root, 'data/raw/semrush-paid');
const outDir = join(root, 'data/processed');
const configPath = join(root, 'config/sem-paid-research-keywords.json');

let names = [];
try {
  names = await readdir(rawDir);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const rows = [];
const keywordsWithRows = new Set();
for (const name of names.filter((value) => value.endsWith('.csv')).sort()) {
  const csv = await readFile(join(rawDir, name), 'utf8');
  const keyword = keywordFromFilename(name);
  for (const row of parseSemrushCsv(csv)) {
    const domain = row.Domain || row.Dn || '';
    const url = row.Url || row.URL || row.Ur || '';
    if (!domain && !url) continue;
    keywordsWithRows.add(keyword);
    rows.push({
      source_file: name,
      keyword,
      domain,
      url,
      visible_url: row['Visible Url'] || row.Vu || '',
    });
  }
}

const byDomain = new Map();
for (const row of rows) {
  const entry = byDomain.get(row.domain) || {
    domain: row.domain,
    keyword_count: 0,
    keywords: [],
    urls: [],
  };
  if (!entry.keywords.includes(row.keyword)) entry.keywords.push(row.keyword);
  if (row.url && !entry.urls.includes(row.url)) entry.urls.push(row.url);
  entry.keyword_count = entry.keywords.length;
  byDomain.set(row.domain, entry);
}

const summary = [...byDomain.values()].sort((a, b) => b.keyword_count - a.keyword_count || a.domain.localeCompare(b.domain));

let configuredKeywords = [];
try {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  configuredKeywords = (config.keywords || []).flatMap((group) =>
    (group.keywords || []).map((keyword) => ({
      cluster: group.cluster,
      keyword: keyword.toLowerCase(),
    })),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const noPaidResults = configuredKeywords
  .filter((entry) => !keywordsWithRows.has(entry.keyword))
  .sort((a, b) => a.cluster.localeCompare(b.cluster) || a.keyword.localeCompare(b.keyword));

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'semrush-paid-results.json'), `${JSON.stringify(rows, null, 2)}\n`);
await writeFile(join(outDir, 'semrush-paid-domain-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(join(outDir, 'semrush-paid-no-results.json'), `${JSON.stringify(noPaidResults, null, 2)}\n`);
console.log(`Normalized ${rows.length} paid result rows across ${summary.length} domains; no paid results for ${noPaidResults.length} configured keywords`);
