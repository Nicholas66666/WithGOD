import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

test('static server exposes dashboard and processed data', async () => {
  const port = 18998;
  const child = spawn(process.execPath, ['launch-os/scripts/server/static-server.mjs'], {
    env: { ...process.env, LAUNCH_OS_HOST: '127.0.0.1', LAUNCH_OS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await once(child.stdout, 'data');
    const html = await fetch(`http://127.0.0.1:${port}/`);
    const state = await fetch(`http://127.0.0.1:${port}/data/processed/dashboard-state.json`);

    assert.equal(html.status, 200);
    assert.match(await html.text(), /Launch OS/);
    assert.equal(state.status, 200);
    assert.equal((await state.json()).status.target.includes('$149'), true);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
