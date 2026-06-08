import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launchRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function parseEnvFile(content = '') {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadLaunchEnv(envPath = join(launchRoot, '.env.local')) {
  if (!existsSync(envPath)) return {};
  return parseEnvFile(readFileSync(envPath, 'utf8'));
}

export function requireSemrushApiKey(env = process.env, { loadLocalEnv = true } = {}) {
  const apiKey = env.SEMRUSH_API_KEY || (loadLocalEnv ? loadLaunchEnv().SEMRUSH_API_KEY : undefined);
  if (!apiKey) {
    throw new Error('SEMRUSH_API_KEY is required');
  }
  return apiKey;
}

export function buildKeywordOverviewURL({
  apiKey,
  phrase,
  database = 'us',
  displayLimit = 50,
  exportColumns = 'Ph,Nq,Cp,Co,Nr,Td',
} = {}) {
  if (!apiKey) throw new Error('apiKey is required');
  if (!phrase) throw new Error('phrase is required');

  const url = new URL('https://api.semrush.com/');
  url.searchParams.set('type', 'phrase_this');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('phrase', phrase);
  url.searchParams.set('database', database);
  url.searchParams.set('display_limit', String(displayLimit));
  url.searchParams.set('export_columns', exportColumns);
  return url;
}

export function buildKeywordReportURL({
  apiKey,
  type,
  phrase,
  database = 'us',
  displayLimit = 50,
  displaySort = 'nq_desc',
  exportColumns = 'Ph,Nq,Cp,Co,Nr,Td',
} = {}) {
  if (!apiKey) throw new Error('apiKey is required');
  if (!type) throw new Error('type is required');
  if (!phrase) throw new Error('phrase is required');

  const url = new URL('https://api.semrush.com/');
  url.searchParams.set('type', type);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('phrase', phrase);
  url.searchParams.set('database', database);
  url.searchParams.set('display_limit', String(displayLimit));
  url.searchParams.set('display_sort', displaySort);
  url.searchParams.set('export_columns', exportColumns);
  return url;
}

export function redactURLForLog(url) {
  const copy = new URL(url.toString());
  if (copy.searchParams.has('key')) copy.searchParams.set('key', 'REDACTED');
  return copy.toString();
}

export function parseSemrushCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(';').map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}
