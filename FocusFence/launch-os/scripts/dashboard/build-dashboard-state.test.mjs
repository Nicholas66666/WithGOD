import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildDashboardState } from './build-dashboard-state.mjs';

test('buildDashboardState summarizes daily notes and decisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'launch-os-dashboard-'));
  await mkdir(join(root, 'daily'), { recursive: true });
  await mkdir(join(root, 'decisions'), { recursive: true });
  await mkdir(join(root, 'data/processed'), { recursive: true });

  await writeFile(
    join(root, 'daily/2026-06-08.md'),
    [
      '# Daily Review: 2026-06-08',
      '',
      '## Goal',
      'Create the launch operating system.',
      '',
      '## Completed',
      '- Confirmed $149 pricing.',
      '',
      '## Tomorrow',
      '- Pull SEMrush data.',
      '',
    ].join('\n'),
  );

  await writeFile(
    join(root, 'decisions/001-price.md'),
    [
      '# Decision 001: Price',
      '',
      '## Decision',
      'Set price at $149.',
      '',
      '## Reversal Criteria',
      'Revisit if checkout behavior is weak.',
      '',
    ].join('\n'),
  );

  const state = await buildDashboardState({ root, now: '2026-06-08T12:00:00.000Z' });
  const saved = JSON.parse(await readFile(join(root, 'data/processed/dashboard-state.json'), 'utf8'));

  assert.equal(state.status.generatedAt, '2026-06-08T12:00:00.000Z');
  assert.equal(state.daily[0].date, '2026-06-08');
  assert.equal(state.daily[0].sections.Goal, 'Create the launch operating system.');
  assert.equal(state.decisions[0].title, 'Decision 001: Price');
  assert.equal(state.decisions[0].decision, 'Set price at $149.');
  assert.deepEqual(state.nextActions, ['Pull SEMrush data.']);
  assert.deepEqual(saved.nextActions, state.nextActions);
});

