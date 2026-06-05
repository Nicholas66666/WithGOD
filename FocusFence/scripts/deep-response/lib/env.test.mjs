import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DEEP_RESPONSE_ENV,
  buildDeepResponseEnv,
  parseEnvContent,
  requireDeepResponseCredentials
} from "./env.mjs";

test("parseEnvContent reads dotenv values without comments or surrounding quotes", () => {
  const env = parseEnvContent(`
    # local secrets
    ARK_API_KEY="ark_test"
    DOUBAO_SPEECH_APP_ID='speech-app'
    EMPTY=
  `);

  assert.deepEqual(env, {
    ARK_API_KEY: "ark_test",
    DOUBAO_SPEECH_APP_ID: "speech-app",
    EMPTY: ""
  });
});

test("buildDeepResponseEnv applies non-secret provider defaults", () => {
  const env = buildDeepResponseEnv({
    ARK_API_KEY: "ark_test",
    DOUBAO_SPEECH_APP_ID: "app",
    DOUBAO_SPEECH_ACCESS_TOKEN: "token"
  });

  assert.equal(env.ARK_BASE_URL, DEFAULT_DEEP_RESPONSE_ENV.ARK_BASE_URL);
  assert.equal(env.ARK_MODEL, "doubao-seed-character-251128");
  assert.equal(env.ARK_FALLBACK_MODEL, "");
  assert.notEqual(env.ARK_MODEL, "doubao-seed-2-0-lite-260215");
  assert.notEqual(env.ARK_FALLBACK_MODEL, "doubao-seed-2-0-pro-260215");
  assert.equal(env.DOUBAO_ASR_RESOURCE_ID, "volc.bigasr.sauc.duration");
  assert.equal(env.DOUBAO_ASR_END_WINDOW_SIZE_MS, "300");
  assert.equal(env.DOUBAO_TTS_RESOURCE_ID, "volc.service_type.10029");
  assert.equal(env.DEEP_RESPONSE_TTS_HTTP_FALLBACK, "1");
});

test("requireDeepResponseCredentials rejects missing or placeholder credentials", () => {
  assert.throws(
    () => requireDeepResponseCredentials({
      ARK_API_KEY: "ark_YOUR_API_KEY",
      DOUBAO_SPEECH_APP_ID: "app",
      DOUBAO_SPEECH_ACCESS_TOKEN: "token"
    }),
    /ARK_API_KEY/
  );
});
