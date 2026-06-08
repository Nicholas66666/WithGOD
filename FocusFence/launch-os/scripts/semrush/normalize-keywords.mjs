import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSemrushCsv } from './semrush-client.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const rawDir = join(root, 'data/raw/semrush');
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
  const reportType = name.includes('-phrase_related-')
    ? 'phrase_related'
    : name.includes('-phrase_questions-')
      ? 'phrase_questions'
      : 'phrase_this';
  for (const row of parseSemrushCsv(csv)) {
    rows.push({
      source_file: name,
      report_type: reportType,
      keyword: row.Keyword || row.Ph || '',
      search_volume: Number(row['Search Volume'] || row.Nq || 0),
      cpc: Number(row.CPC || row.Cp || 0),
      competition: Number(row.Competition || row.Com || row.Co || 0),
      results: Number(row['Number of Results'] || row.Results || row.Nr || 0),
      trend: row.Trends || row.Trend || row.Td || '',
      related_relevance: Number(row['Related Relevance'] || row.Rr || 0),
      serp_features: row['SERP Features'] || row.Fk || '',
      intent: row.Intent || row.In || '',
      keyword_difficulty: Number(row['Keyword Difficulty'] || row.Kd || 0),
    });
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'semrush-keywords.json'), `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Normalized ${rows.length} keyword rows`);
