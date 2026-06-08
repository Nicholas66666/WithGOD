export function requireSemrushApiKey(env = process.env) {
  const apiKey = env.SEMRUSH_API_KEY;
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

