import test from "node:test";
import assert from "node:assert/strict";
import { parseWatchSimFakeMicArgs } from "./run-deep-response-watch-sim-fakemic.mjs";

test("parseWatchSimFakeMicArgs accepts simulator fake mic options", () => {
  const args = parseWatchSimFakeMicArgs([
    "--endpoint", "http://example.test:8797",
    "--device", "watch-udid",
    "--turns", "3",
    "--out-dir", "/tmp/out",
    "--derived-data", "/tmp/dd",
    "--skip-build"
  ]);

  assert.equal(args.endpoint, "http://example.test:8797");
  assert.equal(args.device, "watch-udid");
  assert.equal(args.turns, 3);
  assert.equal(args.outDir, "/tmp/out");
  assert.equal(args.derivedDataPath, "/tmp/dd");
  assert.equal(args.skipBuild, true);
});

test("parseWatchSimFakeMicArgs rejects invalid turn count", () => {
  assert.throws(
    () => parseWatchSimFakeMicArgs(["--turns", "0"]),
    /positive integer/
  );
});
