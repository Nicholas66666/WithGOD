import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVADCalibrationCases,
  extractWatchVADConfiguration,
  summarizeVADCalibration,
  voiceActivityLevelPCM16
} from "./watch-vad-calibration.mjs";

const recorderSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseMicrophoneRecorder.swift", "utf8");

test("extractWatchVADConfiguration reads Watch endpointing constants", () => {
  const config = extractWatchVADConfiguration(recorderSource);

  assert.equal(config.voiceActivityThreshold, 0.012);
  assert.equal(config.minimumSpeechMilliseconds, 240);
  assert.equal(config.endSilenceMilliseconds, 900);
  assert.equal(config.maximumSpeechMilliseconds, 8_000);
});

test("voiceActivityLevelPCM16 matches average absolute Int16 amplitude", () => {
  const pcm = Buffer.alloc(8);
  pcm.writeInt16LE(0, 0);
  pcm.writeInt16LE(1_000, 2);
  pcm.writeInt16LE(-1_000, 4);
  pcm.writeInt16LE(2_000, 6);

  assert.equal(voiceActivityLevelPCM16(pcm), 4_000 / 4 / 32767);
});

test("buildVADCalibrationCases separates silence noise and speech fixtures", () => {
  const config = extractWatchVADConfiguration(recorderSource);
  const cases = buildVADCalibrationCases(config);
  const summary = summarizeVADCalibration(cases, config);

  assert.deepEqual(
    summary.map((item) => [item.name, item.isVoice]),
    [
      ["digital_silence", false],
      ["low_room_noise", false],
      ["quiet_speech", true],
      ["normal_speech", true]
    ]
  );

  assert(summary.find((item) => item.name === "low_room_noise").margin < 0);
  assert(summary.find((item) => item.name === "quiet_speech").margin > 0);
});
