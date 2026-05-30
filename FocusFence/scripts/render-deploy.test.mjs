import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRenderConfig,
  buildTriggerDeployRequest,
  isTerminalDeployStatus,
  redactRenderKey
} from "./render-deploy.mjs";

test("buildRenderConfig reads Render credentials without exposing the API key", () => {
  const config = buildRenderConfig({
    RENDER_API_KEY: "rnd_secret",
    RENDER_DEEP_RESPONSE_SERVICE_ID: "srv_test"
  });

  assert.equal(config.serviceId, "srv_test");
  assert.equal(config.apiKey, "rnd_secret");
  assert.equal(redactRenderKey(config.apiKey), "rnd_...cret");
});

test("buildRenderConfig rejects missing Render credentials", () => {
  assert.throws(() => buildRenderConfig({}), /Missing RENDER_API_KEY/);
  assert.throws(() => buildRenderConfig({ RENDER_API_KEY: "rnd_secret" }), /Missing RENDER_DEEP_RESPONSE_SERVICE_ID/);
});

test("buildTriggerDeployRequest creates latest-commit deploy payload", () => {
  const request = buildTriggerDeployRequest({
    serviceId: "srv_test",
    apiKey: "rnd_secret",
    clearCache: false
  });

  assert.equal(request.url, "https://api.render.com/v1/services/srv_test/deploys");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer rnd_secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    clearCache: "do_not_clear",
    deployMode: "build_and_deploy"
  });
});

test("isTerminalDeployStatus recognizes Render deploy terminal states", () => {
  assert.equal(isTerminalDeployStatus("live"), true);
  assert.equal(isTerminalDeployStatus("build_failed"), true);
  assert.equal(isTerminalDeployStatus("queued"), false);
});
