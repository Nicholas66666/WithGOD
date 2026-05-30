#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const RENDER_API_BASE_URL = "https://api.render.com/v1";
const TERMINAL_DEPLOY_STATUSES = new Set([
  "live",
  "deactivated",
  "build_failed",
  "update_failed",
  "canceled",
  "pre_deploy_failed"
]);

export function buildRenderConfig(env = process.env) {
  const apiKey = env.RENDER_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing RENDER_API_KEY");
  }
  const serviceId = env.RENDER_DEEP_RESPONSE_SERVICE_ID || "";
  if (!serviceId) {
    throw new Error("Missing RENDER_DEEP_RESPONSE_SERVICE_ID");
  }
  return { apiKey, serviceId };
}

export function buildTriggerDeployRequest({ serviceId, apiKey, clearCache = false }) {
  return {
    url: `${RENDER_API_BASE_URL}/services/${serviceId}/deploys`,
    options: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        clearCache: clearCache ? "clear" : "do_not_clear",
        deployMode: "build_and_deploy"
      })
    }
  };
}

export function isTerminalDeployStatus(status) {
  return TERMINAL_DEPLOY_STATUSES.has(status);
}

export function redactRenderKey(apiKey) {
  if (apiKey.length <= 8) {
    return "***";
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function loadDotenv(path = ".env.local") {
  if (!fs.existsSync(path)) {
    return {};
  }
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

async function renderFetch(url, options, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Render API ${response.status}: ${body.message || text || response.statusText}`);
  }
  return body;
}

async function triggerDeploy(config, { clearCache = false, fetchImpl = fetch } = {}) {
  const request = buildTriggerDeployRequest({ ...config, clearCache });
  return renderFetch(request.url, request.options, { fetchImpl });
}

async function getDeploy(config, deployId, { fetchImpl = fetch } = {}) {
  return renderFetch(`${RENDER_API_BASE_URL}/services/${config.serviceId}/deploys/${deployId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`
    }
  }, { fetchImpl });
}

async function waitForDeploy(config, deployId, { fetchImpl = fetch, timeoutMs = 600_000, intervalMs = 5_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const deploy = await getDeploy(config, deployId, { fetchImpl });
    console.log(`Render deploy ${deploy.id} status=${deploy.status}`);
    if (isTerminalDeployStatus(deploy.status)) {
      return deploy;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for Render deploy ${deployId}`);
}

export async function runRenderDeploy(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const dotenv = loadDotenv();
  const config = buildRenderConfig({ ...dotenv, ...process.env });
  const shouldWait = !argv.includes("--no-wait");
  const clearCache = argv.includes("--clear-cache");

  console.log(`Render service=${config.serviceId} key=${redactRenderKey(config.apiKey)}`);
  const deploy = await triggerDeploy(config, { clearCache, fetchImpl });
  console.log(`Render deploy ${deploy.id} status=${deploy.status}`);
  if (!shouldWait) {
    return deploy;
  }
  return waitForDeploy(config, deploy.id, { fetchImpl });
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  runRenderDeploy().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
