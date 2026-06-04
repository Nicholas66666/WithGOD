import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDeepResponseWatchEvent,
  simulateDeepResponseWatchEvents
} from "./watch-continuous-state-machine.mjs";

test("continuous loop restarts listening after playback drains", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "playback_drained" }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "start_recording:auto_listening"
  ]);
});

test("continuous loop enters assistantThinking after speech before playback starts", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true }
  ]);

  assert.equal(result.state.conversationState, "assistantThinking");
  assert.equal(result.state.isRecording, false);
  assert.deepEqual(result.actions, ["wait_for_playback"]);
});

test("continuous loop restarts immediately when a turn has no queued playback", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: false }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.deepEqual(result.actions, ["start_recording:auto_listening"]);
});

test("continuous barge-in abort resumes recording after local-first stop", () => {
  const afterAbort = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "assistantSpeaking"
  }, { type: "abort_finished", sessionEnded: false, error: null });

  assert.equal(afterAbort.state.conversationState, "userSpeaking");
  assert.equal(afterAbort.state.isRecording, true);
  assert.deepEqual(afterAbort.actions, [
    "local_stop_playback",
    "start_recording:barge_in"
  ]);
});

test("continuous barge-in starts recording on local abort request before server ack", () => {
  const afterAbortRequest = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "assistantSpeaking"
  }, { type: "abort_requested" });

  assert.equal(afterAbortRequest.state.conversationState, "userSpeaking");
  assert.equal(afterAbortRequest.state.isRecording, true);
  assert.deepEqual(afterAbortRequest.actions, [
    "local_stop_playback",
    "post_abort:background",
    "start_recording:barge_in"
  ]);
});

test("session end blocks auto-listen and keeps the loop ended", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true, sessionEnded: true },
    { type: "playback_drained" }
  ]);

  assert.equal(result.state.conversationState, "ended");
  assert.equal(result.state.isRecording, false);
  assert.deepEqual(result.actions, []);
});
