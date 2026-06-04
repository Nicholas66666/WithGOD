#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://124.174.96.149:8797";
const DEFAULT_HOST = "ubuntu@124.174.96.149";
const DEFAULT_KEY = ".volcengine/drs-test-key";
const DEFAULT_BRANCH = "codex/deep-response-lab";

export function parseVolcengineDeployArgs(argv) {
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    host: DEFAULT_HOST,
    keyPath: DEFAULT_KEY,
    branch: DEFAULT_BRANCH,
    skipRestart: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--host") {
      args.host = argv[index + 1] || args.host;
      index += 1;
    } else if (arg === "--key") {
      args.keyPath = argv[index + 1] || args.keyPath;
      index += 1;
    } else if (arg === "--branch") {
      args.branch = argv[index + 1] || args.branch;
      index += 1;
    } else if (arg === "--skip-restart") {
      args.skipRestart = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export async function runVolcengineDeploy(args) {
  if (!existsSync(args.keyPath)) {
    throw new Error(`SSH key not found: ${args.keyPath}`);
  }

  const remoteScript = [
    "set -e",
    "cd /opt/deep-response/repo",
    `sudo git fetch origin ${shellQuote(args.branch)}`,
    `sudo git reset --hard origin/${shellQuote(args.branch)}`,
    "cd FocusFence",
    args.skipRestart ? "true" : "sudo systemctl restart deep-response",
    "systemctl is-active deep-response"
  ].join("\n");

  const output = execFileSync("ssh", [
    "-i", args.keyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=10",
    args.host,
    remoteScript
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const health = await fetchHealth(args.endpoint);
  return {
    ok: health.ok,
    endpoint: args.endpoint,
    host: args.host,
    branch: args.branch,
    remoteOutput: output.trim().split(/\r?\n/).slice(-5),
    health
  };
}

async function fetchHealth(endpoint) {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/health`);
  let body;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return {
    ok: response.status === 200 && body?.ok === true,
    status: response.status,
    body
  };
}

function shellQuote(value) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`Unsafe shell value: ${value}`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/deploy-deep-response-volcengine.mjs [options]

Options:
  --endpoint <url>   DeepResponse endpoint. Default: ${DEFAULT_ENDPOINT}
  --host <ssh-host>  SSH host. Default: ${DEFAULT_HOST}
  --key <path>       SSH private key. Default: ${DEFAULT_KEY}
  --branch <branch>  Git branch to deploy. Default: ${DEFAULT_BRANCH}
  --skip-restart     Pull code and check service without restarting.
`);
}

function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseVolcengineDeployArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runVolcengineDeploy(args);
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
