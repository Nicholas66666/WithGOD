import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRemoteDeployScript,
  parseVolcengineDeployArgs
} from "./deploy-deep-response-volcengine.mjs";

test("Volcengine deploy script retries transient git fetch failures", () => {
  const args = parseVolcengineDeployArgs([]);
  const script = buildRemoteDeployScript(args);

  assert.match(script, /for attempt in 1 2 3; do/);
  assert.match(script, /sudo git fetch origin codex\/deep-response-lab/);
  assert.match(script, /sleep \$\(\(attempt \* 2\)\)/);
  assert.match(script, /sudo git reset --hard origin\/codex\/deep-response-lab/);
  assert.match(script, /sudo systemctl restart deep-response/);
});

test("Volcengine deploy script can pull without restarting for diagnosis", () => {
  const args = parseVolcengineDeployArgs(["--skip-restart"]);
  const script = buildRemoteDeployScript(args);

  assert.doesNotMatch(script, /sudo systemctl restart deep-response/);
  assert.match(script, /systemctl is-active deep-response/);
});
