import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSemrushCsv } from './semrush-client.mjs';

function domainFromFilename(name) {
  return name
    .replace(/^us-domain_adwords_unique-/, '')
    .replace(/\.csv$/, '')
    .replaceAll('-', '.');
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const rawDir = join(root, 'data/raw/semrush-ad-copies');
const outDir = join(root, 'data/processed');

let names = [];
try {
  names = await readdir(rawDir);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const rows = [];
for (const name of names.filter((value) => value.endsWith('.csv')).sort()) {
  const csv = await readFile(join(rawDir, name), 'utf8');
  const domain = domainFromFilename(name);
  for (const row of parseSemrushCsv(csv)) {
    const title = row.Title || row.Tt || '';
    const description = row.Description || row.Ds || '';
    const url = row.Url || row.URL || row.Ur || '';
    const visibleUrl = row['Visible Url'] || row.Vu || '';
    if (!title && !description && !url) continue;
    rows.push({
      source_file: name,
      domain,
      title,
      description,
      visible_url: visibleUrl,
      url,
    });
  }
}

const byDomain = Object.values(
  rows.reduce((summary, row) => {
    const entry = summary[row.domain] || {
      domain: row.domain,
      copy_count: 0,
      sample_titles: [],
      sample_descriptions: [],
      urls: [],
    };
    entry.copy_count += 1;
    if (row.title && !entry.sample_titles.includes(row.title) && entry.sample_titles.length < 5) entry.sample_titles.push(row.title);
    if (row.description && !entry.sample_descriptions.includes(row.description) && entry.sample_descriptions.length < 5) entry.sample_descriptions.push(row.description);
    if (row.url && !entry.urls.includes(row.url) && entry.urls.length < 5) entry.urls.push(row.url);
    summary[row.domain] = entry;
    return summary;
  }, {}),
).sort((a, b) => b.copy_count - a.copy_count || a.domain.localeCompare(b.domain));

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'semrush-ad-copies.json'), `${JSON.stringify(rows, null, 2)}\n`);
await writeFile(join(outDir, 'semrush-ad-copy-domain-summary.json'), `${JSON.stringify(byDomain, null, 2)}\n`);
console.log(`Normalized ${rows.length} ad copy rows across ${byDomain.length} domains`);
