#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { buildDeepResponseEnv, loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";

export function parseFixtureArgs(argv) {
  const args = {
    text: "我现在真的很累，也有一点害怕。",
    outPath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--text") {
      args.text = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--out") {
      args.outPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.outPath) {
    throw new Error("Missing required --out path/to/output.wav");
  }

  return args;
}

async function main() {
  const args = parseFixtureArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const env = buildDeepResponseEnv(loadDeepResponseEnv());
  requireDeepResponseCredentials(env);

  const audio = await synthesizeFixtureWav(env, args.text);
  writeFileSync(args.outPath, audio);
  console.log(JSON.stringify({
    outPath: args.outPath,
    text: args.text,
    audioBytes: audio.byteLength
  }, null, 2));
}

async function synthesizeFixtureWav(env, text) {
  const response = await fetch(env.DOUBAO_TTS_HTTP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer;${env.DOUBAO_SPEECH_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      app: {
        appid: env.DOUBAO_SPEECH_APP_ID,
        token: env.DOUBAO_SPEECH_ACCESS_TOKEN,
        cluster: "volcano_tts"
      },
      user: { uid: "focusfence-deep-response-fixture" },
      audio: {
        voice_type: env.DOUBAO_TTS_SPEAKER_ID,
        encoding: "wav",
        speed_ratio: 1.0,
        volume_ratio: 1.0,
        pitch_ratio: 1.0
      },
      request: {
        reqid: crypto.randomUUID(),
        text,
        operation: "query"
      }
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`fixture_tts_failed ${response.status}: ${raw}`);
  }
  const data = JSON.parse(raw);
  if (data.code !== 3000 || !data.data) {
    throw new Error(`fixture_tts_bad_response ${data.code}: ${data.message || ""}`);
  }
  return Buffer.from(data.data, "base64");
}

function printHelp() {
  console.log(`Usage: node scripts/deep-response-generate-fixture.mjs --out /private/tmp/speech.wav [options]

Options:
  --out <path>   Required. Output WAV path.
  --text <text>  Text to synthesize. Default is a short distress sentence.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
