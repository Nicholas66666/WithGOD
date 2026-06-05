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

test("continuous loop enters assistantSpeaking when first audio arrives", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "first_audio_received" }
  ]);

  assert.equal(result.state.conversationState, "assistantSpeaking");
  assert.equal(result.state.isRecording, false);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, ["wait_for_playback"]);
});

test("late first audio is ignored while a new local recording is active", () => {
  const afterFirstAudio = applyDeepResponseWatchEvent({
    isContinuousMode: false,
    isRecording: true,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "userSpeaking"
  }, { type: "first_audio_received" });

  assert.equal(afterFirstAudio.state.conversationState, "userSpeaking");
  assert.equal(afterFirstAudio.state.isRecording, true);
  assert.deepEqual(afterFirstAudio.actions, []);
});

test("late first audio is ignored after a local HTTP session error", () => {
  const afterFirstAudio = applyDeepResponseWatchEvent({
    isContinuousMode: false,
    isRecording: false,
    isWaitingForResponse: true,
    isHTTPSessionEnded: false,
    lastError: "HTTP session failed",
    conversationState: "assistantThinking"
  }, { type: "first_audio_received" });

  assert.equal(afterFirstAudio.state.conversationState, "assistantThinking");
  assert.equal(afterFirstAudio.state.isWaitingForResponse, true);
  assert.equal(afterFirstAudio.state.lastError, "HTTP session failed");
  assert.deepEqual(afterFirstAudio.actions, []);
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

test("continuous loop keeps listening after an empty recording", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "empty_recording" }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.deepEqual(result.actions, ["start_recording:auto_listening"]);
});

test("turning continuous mode off stops active recording", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "toggle_continuous", enabled: false }
  ]);

  assert.equal(result.state.isContinuousMode, false);
  assert.equal(result.state.conversationState, "listening");
  assert.equal(result.state.isRecording, false);
  assert.deepEqual(result.actions, ["stop_recording"]);
});

test("turning continuous mode off during assistant speech stops local playback", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "first_audio_received" },
    { type: "toggle_continuous", enabled: false }
  ]);

  assert.equal(result.state.isContinuousMode, false);
  assert.equal(result.state.conversationState, "listening");
  assert.equal(result.state.isRecording, false);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "local_stop_playback"
  ]);
});

test("turning continuous mode off while assistant is thinking clears waiting state", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "toggle_continuous", enabled: false }
  ]);

  assert.equal(result.state.isContinuousMode, false);
  assert.equal(result.state.conversationState, "listening");
  assert.equal(result.state.isRecording, false);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, ["wait_for_playback"]);
});

test("in-flight playback after continuous mode off still shows speaking until drained", () => {
  const afterFirstAudio = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "toggle_continuous", enabled: false },
    { type: "first_audio_received" }
  ]);

  assert.equal(afterFirstAudio.state.isContinuousMode, false);
  assert.equal(afterFirstAudio.state.conversationState, "assistantSpeaking");
  assert.equal(afterFirstAudio.state.isRecording, false);
  assert.equal(afterFirstAudio.state.isWaitingForResponse, false);

  const afterDrain = applyDeepResponseWatchEvent(afterFirstAudio.state, {
    type: "playback_drained"
  });

  assert.equal(afterDrain.state.isContinuousMode, false);
  assert.equal(afterDrain.state.conversationState, "listening");
  assert.deepEqual(afterDrain.actions, []);
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

test("mic press during assistant speaking performs local-first barge-in", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "first_audio_received" },
    { type: "mic_pressed" }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "local_stop_playback",
    "post_abort:background",
    "start_recording:barge_in"
  ]);
});

test("mic press during assistant thinking aborts generation and starts barge-in", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "mic_pressed" }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "post_abort:background",
    "start_recording:barge_in"
  ]);
});

test("mic press during post-turn playback stops local audio without server abort", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "first_audio_received" },
    { type: "turn_done" },
    { type: "mic_pressed", canAbort: false }
  ]);

  assert.equal(result.state.conversationState, "userSpeaking");
  assert.equal(result.state.isRecording, true);
  assert.equal(result.state.isWaitingForResponse, false);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "local_stop_playback",
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

test("session end without active playback enters ending before final ended state", () => {
  const afterSessionEnd = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "assistantThinking"
  }, { type: "session_end" });

  assert.equal(afterSessionEnd.state.conversationState, "ending");
  assert.equal(afterSessionEnd.state.isHTTPSessionEnded, true);
  assert.deepEqual(afterSessionEnd.actions, ["stop_auto_listen", "finalize_session_end"]);

  const afterFinalized = applyDeepResponseWatchEvent(afterSessionEnd.state, {
    type: "session_end_finalized"
  });

  assert.equal(afterFinalized.state.conversationState, "ended");
  assert.equal(afterFinalized.state.isRecording, false);
  assert.equal(afterFinalized.state.isWaitingForResponse, false);
});

test("session end during assistant playback waits for playback drain before final ended", () => {
  const afterSessionEnd = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "assistantSpeaking"
  }, { type: "session_end" });

  assert.equal(afterSessionEnd.state.conversationState, "ending");
  assert.equal(afterSessionEnd.state.isHTTPSessionEnded, true);
  assert.equal(afterSessionEnd.state.isRecording, false);
  assert.deepEqual(afterSessionEnd.actions, [
    "stop_auto_listen",
    "wait_for_playback_drain"
  ]);

  const afterPlaybackDrain = applyDeepResponseWatchEvent(afterSessionEnd.state, {
    type: "playback_drained"
  });

  assert.equal(afterPlaybackDrain.state.conversationState, "ended");
  assert.deepEqual(afterPlaybackDrain.actions, ["finalize_session_end"]);
});

test("session end waits for playback drain when playback is active before speaking state", () => {
  const afterSessionEnd = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: true,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "assistantThinking"
  }, { type: "session_end", playbackActive: true });

  assert.equal(afterSessionEnd.state.conversationState, "ending");
  assert.equal(afterSessionEnd.state.isHTTPSessionEnded, true);
  assert.equal(afterSessionEnd.state.isRecording, false);
  assert.deepEqual(afterSessionEnd.actions, [
    "stop_auto_listen",
    "wait_for_playback_drain"
  ]);

  const afterPlaybackDrain = applyDeepResponseWatchEvent(afterSessionEnd.state, {
    type: "playback_drained"
  });

  assert.equal(afterPlaybackDrain.state.conversationState, "ended");
  assert.deepEqual(afterPlaybackDrain.actions, ["finalize_session_end"]);
});

test("session end stops active recorder before ending the loop", () => {
  const afterSessionEnd = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: true,
    isWaitingForResponse: false,
    isHTTPSessionEnded: false,
    lastError: null,
    conversationState: "userSpeaking"
  }, { type: "session_end" });

  assert.equal(afterSessionEnd.state.conversationState, "ending");
  assert.equal(afterSessionEnd.state.isRecording, false);
  assert.equal(afterSessionEnd.state.isHTTPSessionEnded, true);
  assert.deepEqual(afterSessionEnd.actions, [
    "stop_recording",
    "stop_auto_listen",
    "finalize_session_end"
  ]);
});

test("late abort ack after session end does not resume barge-in recording", () => {
  const result = simulateDeepResponseWatchEvents([
    { type: "toggle_continuous", enabled: true },
    { type: "recording_started" },
    { type: "recording_finished", playbackActive: true },
    { type: "abort_requested" },
    { type: "session_end" },
    { type: "abort_finished", sessionEnded: false, error: null },
    { type: "session_end_finalized" }
  ]);

  assert.equal(result.state.conversationState, "ended");
  assert.equal(result.state.isRecording, false);
  assert.equal(result.state.isHTTPSessionEnded, true);
  assert.deepEqual(result.actions, [
    "wait_for_playback",
    "local_stop_playback",
    "post_abort:background",
    "start_recording:barge_in",
    "stop_recording",
    "stop_auto_listen",
    "finalize_session_end"
  ]);
});

test("view disappear ends server session and stops local runtime", () => {
  const afterDisappear = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: true,
    isWaitingForResponse: true,
    isHTTPSessionEnded: false,
    lastError: "old error",
    conversationState: "userSpeaking"
  }, { type: "view_disappeared" });

  assert.equal(afterDisappear.state.conversationState, "ended");
  assert.equal(afterDisappear.state.isContinuousMode, false);
  assert.equal(afterDisappear.state.isRecording, false);
  assert.equal(afterDisappear.state.isWaitingForResponse, false);
  assert.equal(afterDisappear.state.isHTTPSessionEnded, false);
  assert.deepEqual(afterDisappear.actions, [
    "post_end:watch_teardown",
    "stop_runtime",
    "stop_recording"
  ]);
});

test("view appear resets reusable debug screen state", () => {
  const afterAppear = applyDeepResponseWatchEvent({
    isContinuousMode: true,
    isRecording: false,
    isWaitingForResponse: true,
    isHTTPSessionEnded: true,
    lastError: "old error",
    conversationState: "ended"
  }, { type: "view_appeared" });

  assert.equal(afterAppear.state.conversationState, "listening");
  assert.equal(afterAppear.state.isContinuousMode, false);
  assert.equal(afterAppear.state.isRecording, false);
  assert.equal(afterAppear.state.isWaitingForResponse, false);
  assert.equal(afterAppear.state.isHTTPSessionEnded, false);
  assert.equal(afterAppear.state.lastError, null);
  assert.deepEqual(afterAppear.actions, ["clear_client_diagnostics"]);
});
