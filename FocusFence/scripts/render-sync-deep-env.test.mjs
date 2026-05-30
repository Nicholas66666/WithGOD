import test from "node:test";
import assert from "node:assert/strict";

import {
  DEEP_RESPONSE_RENDER_ENV_KEYS,
  buildEnvVarUpdateRequest,
  collectDeepResponseRenderEnv,
  redactValue
} from "./render-sync-deep-env.mjs";

test("collectDeepResponseRenderEnv copies only the DeepResponse Render whitelist", () => {
  const env = collectDeepResponseRenderEnv({
    RENDER_API_KEY: "rnd_secret",
    RENDER_DEEP_RESPONSE_SERVICE_ID: "srv_test",
    DEEP_RESPONSE_MODE: "echo",
    ARK_API_KEY: "ark_secret",
    DOUBAO_SPEECH_APP_ID: "app",
    DOUBAO_SPEECH_ACCESS_TOKEN: "token",
    UNRELATED: "ignore"
  }, { mode: "provider" });

  assert.equal(env.DEEP_RESPONSE_MODE, "provider");
  assert.equal(env.ARK_API_KEY, "ark_secret");
  assert.equal(env.DOUBAO_SPEECH_APP_ID, "app");
  assert.equal(env.DOUBAO_SPEECH_ACCESS_TOKEN, "token");
  assert.equal(env.UNRELATED, undefined);
  assert(DEEP_RESPONSE_RENDER_ENV_KEYS.includes("DOUBAO_TTS_SAMPLE_RATE"));
});

test("collectDeepResponseRenderEnv skips empty optional values", () => {
  const env = collectDeepResponseRenderEnv({
    ARK_API_KEY: "ark_secret",
    DOUBAO_SPEECH_APP_ID: "app",
    DOUBAO_SPEECH_ACCESS_TOKEN: "token",
    DOUBAO_TTS_MODEL: ""
  });

  assert.equal(env.DOUBAO_TTS_MODEL, undefined);
});

test("buildEnvVarUpdateRequest creates a single Render env-var PUT", () => {
  const request = buildEnvVarUpdateRequest({
    serviceId: "srv_test",
    apiKey: "rnd_secret",
    key: "ARK_API_KEY",
    value: "ark_secret"
  });

  assert.equal(request.url, "https://api.render.com/v1/services/srv_test/env-vars/ARK_API_KEY");
  assert.equal(request.options.method, "PUT");
  assert.equal(request.options.headers.Authorization, "Bearer rnd_secret");
  assert.deepEqual(JSON.parse(request.options.body), { value: "ark_secret" });
});

test("redactValue hides secrets and shows non-secret mode", () => {
  assert.equal(redactValue("ARK_API_KEY", "ark_secret_value"), "ark_...alue");
  assert.equal(redactValue("DEEP_RESPONSE_MODE", "provider"), "provider");
});
