import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDomainReportURL,
  buildKeywordOverviewURL,
  parseEnvFile,
  redactURLForLog,
  requireSemrushApiKey,
} from './semrush-client.mjs';

test('buildKeywordOverviewURL includes database phrase key columns and display limit', () => {
  const url = buildKeywordOverviewURL({
    apiKey: 'secret-key',
    phrase: 'bible verses for anxiety',
    database: 'us',
    displayLimit: 25,
  });

  assert.equal(url.hostname, 'api.semrush.com');
  assert.equal(url.searchParams.get('type'), 'phrase_this');
  assert.equal(url.searchParams.get('key'), 'secret-key');
  assert.equal(url.searchParams.get('phrase'), 'bible verses for anxiety');
  assert.equal(url.searchParams.get('database'), 'us');
  assert.equal(url.searchParams.get('display_limit'), '25');
  assert.equal(url.searchParams.get('export_columns'), 'Ph,Nq,Cp,Co,Nr,Td');
});

test('redactURLForLog removes API key value', () => {
  const url = buildKeywordOverviewURL({
    apiKey: 'secret-key',
    phrase: 'prayer for anxiety',
  });

  const redacted = redactURLForLog(url);

  assert.match(redacted, /key=REDACTED/);
  assert.doesNotMatch(redacted, /secret-key/);
});

test('buildDomainReportURL includes domain report controls', () => {
  const url = buildDomainReportURL({
    apiKey: 'secret-key',
    type: 'domain_adwords_unique',
    domain: 'hallow.com',
    database: 'us',
    displayLimit: 5,
    exportColumns: 'Tt,Ds,Vu,Ur',
  });

  assert.equal(url.hostname, 'api.semrush.com');
  assert.equal(url.searchParams.get('type'), 'domain_adwords_unique');
  assert.equal(url.searchParams.get('key'), 'secret-key');
  assert.equal(url.searchParams.get('domain'), 'hallow.com');
  assert.equal(url.searchParams.get('database'), 'us');
  assert.equal(url.searchParams.get('display_limit'), '5');
  assert.equal(url.searchParams.get('export_columns'), 'Tt,Ds,Vu,Ur');
});

test('requireSemrushApiKey rejects missing keys', () => {
  assert.throws(() => requireSemrushApiKey({}, { loadLocalEnv: false }), /SEMRUSH_API_KEY/);
  assert.equal(requireSemrushApiKey({ SEMRUSH_API_KEY: 'abc123' }), 'abc123');
});

test('parseEnvFile reads launch local env syntax without exposing secrets', () => {
  const values = parseEnvFile(`
    # local only
    SEMRUSH_API_KEY="secret-key"
    EMPTY_VALUE=
  `);

  assert.equal(values.SEMRUSH_API_KEY, 'secret-key');
  assert.equal(values.EMPTY_VALUE, '');
});
