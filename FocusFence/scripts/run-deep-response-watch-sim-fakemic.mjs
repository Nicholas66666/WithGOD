#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://124.174.96.149:8797";
const DEFAULT_DERIVED_DATA = "/private/tmp/focus-deepresponse-watchlab-sim";
const DEFAULT_OUT_DIR = "/private/tmp/deep-response-watch-sim-fakemic";
const BUNDLE_ID = "com.nicho.DeepResponseWatchLab";

export function parseWatchSimFakeMicArgs(argv) {
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    derivedDataPath: DEFAULT_DERIVED_DATA,
    outDir: DEFAULT_OUT_DIR,
    turns: 2,
    device: "",
    skipBuild: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--derived-data") {
      args.derivedDataPath = argv[index + 1] || args.derivedDataPath;
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[index + 1] || args.outDir;
      index += 1;
    } else if (arg === "--turns") {
      args.turns = Number.parseInt(argv[index + 1] || `${args.turns}`, 10);
      index += 1;
    } else if (arg === "--device") {
      args.device = argv[index + 1] || args.device;
      index += 1;
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.turns) || args.turns < 1) {
    throw new Error("--turns must be a positive integer");
  }
  return args;
}

export function findBootedWatchDevice() {
  const raw = execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  let firstAvailable = null;
  for (const [runtime, devices] of Object.entries(parsed.devices || {})) {
    if (!runtime.toLowerCase().includes("watchos")) {
      continue;
    }
    const booted = devices.find((device) => device.state === "Booted");
    if (booted?.udid) {
      return booted.udid;
    }
    firstAvailable ||= devices.find((device) => device.isAvailable && device.udid)?.udid || null;
  }
  if (!firstAvailable) {
    throw new Error("No available watchOS simulator found.");
  }
  execFileSync("xcrun", ["simctl", "boot", firstAvailable], { stdio: "ignore" });
  return firstAvailable;
}

export function runWatchSimFakeMic(args) {
  const device = args.device || findBootedWatchDevice();
  if (!args.skipBuild) {
    execFileSync("xcodebuild", [
      "-project", "Focus.xcodeproj",
      "-scheme", "DeepResponseWatchLab",
      "-configuration", "Debug",
      "-destination", `id=${device}`,
      "-derivedDataPath", args.derivedDataPath,
      "build"
    ], {
      stdio: "inherit",
      env: { ...process.env, DEEP_RESPONSE_REALTIME_ENDPOINT: args.endpoint }
    });
  }

  const appPath = join(args.derivedDataPath, "Build/Products/Debug-watchsimulator/DeepLab.app");
  if (!existsSync(appPath)) {
    throw new Error(`DeepLab simulator app not found: ${appPath}`);
  }

  mkdirSync(args.outDir, { recursive: true });
  execFileSync("open", ["-a", "Simulator"], { stdio: "inherit" });
  execFileSync("xcrun", ["simctl", "install", device, appPath], { stdio: "inherit" });
  try {
    execFileSync("xcrun", ["simctl", "terminate", device, BUNDLE_ID], { stdio: "ignore" });
  } catch {
    // App may not be running.
  }
  execFileSync("xcrun", ["simctl", "launch", "--terminate-running-process", device, BUNDLE_ID], {
    stdio: "inherit",
    env: {
      ...process.env,
      SIMCTL_CHILD_DEEP_RESPONSE_SIMULATED_MIC: "1",
      SIMCTL_CHILD_DEEP_RESPONSE_AUTORUN_SIMULATED_MIC_CONTINUOUS: "1",
      SIMCTL_CHILD_DEEP_RESPONSE_AUTORUN_SIMULATED_MIC_TURNS: `${args.turns}`
    }
  });
  try {
    execFileSync("osascript", ["-e", "tell application \"Simulator\" to activate"], { stdio: "ignore" });
  } catch {
    // The run still works if activation is unavailable.
  }

  const runningShot = join(args.outDir, "running.png");
  const doneShot = join(args.outDir, "done.png");
  execFileSync("sleep", ["5"]);
  execFileSync("xcrun", ["simctl", "io", device, "screenshot", runningShot], { stdio: "inherit" });
  execFileSync("sleep", [`${Math.max(12, args.turns * 12)}`]);
  execFileSync("xcrun", ["simctl", "io", device, "screenshot", doneShot], { stdio: "inherit" });

  return {
    ok: true,
    device,
    turns: args.turns,
    appPath,
    screenshots: {
      running: runningShot,
      done: doneShot
    }
  };
}

function printHelp() {
  console.log(`Usage: node scripts/run-deep-response-watch-sim-fakemic.mjs [options]

Options:
  --endpoint <url>       DeepResponse server endpoint. Default: ${DEFAULT_ENDPOINT}
  --device <udid>        watchOS simulator UDID. Default: first booted watchOS simulator.
  --turns <n>            Number of simulated mic turns. Default: 2
  --out-dir <path>       Screenshot output directory. Default: ${DEFAULT_OUT_DIR}
  --derived-data <path>  Xcode derived data path. Default: ${DEFAULT_DERIVED_DATA}
  --skip-build           Reuse an existing simulator build.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseWatchSimFakeMicArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      console.log(JSON.stringify(runWatchSimFakeMic(args), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
