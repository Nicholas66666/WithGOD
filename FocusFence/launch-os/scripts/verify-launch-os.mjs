import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

async function mustExist(path) {
  await access(join(root, path));
}

await Promise.all([
  mustExist('launch-os/README.md'),
  mustExist('launch-os/dashboard/public/index.html'),
  mustExist('launch-os/data/processed/dashboard-state.json'),
  mustExist('launch-os/scripts/semrush/semrush-client.mjs'),
  mustExist('launch-os/infra/volcengine/docker-compose.yml'),
  mustExist('launch-os/infra/volcengine/Caddyfile'),
]);

const state = JSON.parse(await readFile(join(root, 'launch-os/data/processed/dashboard-state.json'), 'utf8'));
assert.ok(Array.isArray(state.daily), 'dashboard state must include daily array');
assert.ok(Array.isArray(state.decisions), 'dashboard state must include decisions array');

const checkIgnore = spawnSync('git', ['check-ignore', '-v', '.env.local', 'supabase/.env.local'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(checkIgnore.status, 0, '.env.local files must be ignored');

const semrushClient = await readFile(join(root, 'launch-os/scripts/semrush/semrush-client.mjs'), 'utf8');
assert.doesNotMatch(semrushClient, /VOLCENGINE_SECRET_ACCESS_KEY\s*=/, 'script must not embed Volcengine secrets');
assert.doesNotMatch(semrushClient, /SEMRUSH_API_KEY\s*=\s*['"][^'"]+['"]/, 'script must not embed SEMrush key');

console.log('Launch OS verification passed');
