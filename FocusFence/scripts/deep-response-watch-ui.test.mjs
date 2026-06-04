import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const debugViewSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseDebugView.swift", "utf8");
const realtimeClientSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift", "utf8");
const audioPlayerSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseAudioPlayer.swift", "utf8");
const recorderSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseMicrophoneRecorder.swift", "utf8");

test("DeepResponse Watch debug UI presents assistant reply as one god field", () => {
  assert.match(debugViewSource, /Text\("god: \\\(/);
  assert.doesNotMatch(debugViewSource, /Text\("first: /);
  assert.doesNotMatch(debugViewSource, /Text\("more: /);
});

test("DeepResponse Watch HTTP session requests cascade pipeline mode", () => {
  assert.match(realtimeClientSource, /"pipelineMode"\s*:\s*"cascade"/);
  assert.doesNotMatch(realtimeClientSource, /request\.httpBody = #"\{"sampleRate":16000\}"#/);
});

test("DeepResponse Watch HTTP session appends streaming assistant deltas", () => {
  assert.match(realtimeClientSource, /lastTurnFirstText = Self\.appendText\(lastTurnFirstText, event\.delta\)/);
  assert.match(realtimeClientSource, /lastTurnFollowupText = Self\.appendText\(lastTurnFollowupText, event\.delta\)/);
  assert.doesNotMatch(realtimeClientSource, /lastTurnFirstText = event\.delta/);
  assert.doesNotMatch(realtimeClientSource, /lastTurnFollowupText = event\.delta/);
});

test("DeepResponse Watch audio player reports when queued playback drains", () => {
  assert.match(audioPlayerSource, /var onPlaybackDrained: \(\(\) -> Void\)\?/);
  assert.match(audioPlayerSource, /pendingBufferCount/);
  assert.match(audioPlayerSource, /notifyPlaybackDrainedIfNeeded\(\)/);
  assert.match(audioPlayerSource, /completionCallbackType: \.dataPlayedBack/);
});

test("DeepResponse Watch audio player detaches stopped nodes before reprepare", () => {
  assert.match(audioPlayerSource, /if isPrepared \{/);
  assert.match(audioPlayerSource, /engine\.detach\(player\)/);
});

test("DeepResponse Watch client exposes HTTP playback-drained callback", () => {
  assert.match(realtimeClientSource, /var onHTTPSessionPlaybackDrained: \(\(\) -> Void\)\?/);
  assert.match(realtimeClientSource, /player\.onPlaybackDrained = \{ \[weak self\] in/);
  assert.match(realtimeClientSource, /self\?\.onHTTPSessionPlaybackDrained\?\(\)/);
});

test("DeepResponse Watch debug UI has an HTTP continuous auto-listen loop", () => {
  assert.match(debugViewSource, /@State private var isContinuousMode = false/);
  assert.match(debugViewSource, /Image\(systemName: isContinuousMode \? "repeat\.circle\.fill" : "repeat\.circle"\)/);
  assert.match(debugViewSource, /client\.onHTTPSessionPlaybackDrained = \{/);
  assert.match(debugViewSource, /handlePlaybackDrained\(\)/);
  assert.match(debugViewSource, /startRecordingTurn\(reason: "Auto listening"\)/);
});

test("DeepResponse Watch recorder exposes local silence endpointing hooks", () => {
  assert.match(recorderSource, /struct Configuration/);
  assert.match(recorderSource, /isEndpointingEnabled/);
  assert.match(recorderSource, /endSilenceMilliseconds/);
  assert.match(recorderSource, /onSilence: \(\(\) -> Void\)\?/);
  assert.match(recorderSource, /voiceActivityLevel\(in data: Data\)/);
  assert.match(recorderSource, /emitSilenceIfNeeded\(\)/);
});

test("DeepResponse Watch continuous mode auto-finishes a turn on recorder silence", () => {
  assert.match(debugViewSource, /configuration: \.init\(isEndpointingEnabled: isContinuousMode\)/);
  assert.match(debugViewSource, /onSilence: \{/);
  assert.match(debugViewSource, /await finishRecordingTurn\(reason: "Auto silence"\)/);
});

test("DeepResponse Watch lab does not expose Watch WebSocket transport", () => {
  assert.doesNotMatch(realtimeClientSource, /URLSessionWebSocketTask/);
  assert.doesNotMatch(realtimeClientSource, /webSocketTask/);
  assert.doesNotMatch(realtimeClientSource, /DeepResponseWebSocketDelegate/);
  assert.doesNotMatch(realtimeClientSource, /func connect\(\) async throws/);
  assert.doesNotMatch(realtimeClientSource, /connectionStage = "ws:/);
});

test("DeepResponse Watch continuous mode has explicit conversation state transitions", () => {
  assert.match(debugViewSource, /enum DeepResponseConversationState/);
  for (const state of ["listening", "userSpeaking", "assistantSpeaking", "bargeIn", "idleWaiting", "ended"]) {
    assert.match(debugViewSource, new RegExp(`case ${state}`));
  }
  assert.match(debugViewSource, /@State private var conversationState: DeepResponseConversationState = \.listening/);
  assert.match(debugViewSource, /conversationState = \.userSpeaking/);
  assert.match(debugViewSource, /conversationState = \.idleWaiting/);
  assert.match(debugViewSource, /conversationState = \.assistantSpeaking/);
  assert.match(debugViewSource, /conversationState = \.bargeIn/);
  assert.match(debugViewSource, /conversationState = \.ended/);
});

test("DeepResponse Watch simulator autoruns a continuous HTTP fixture loop", () => {
  assert.match(debugViewSource, /DEEP_RESPONSE_AUTORUN_CONTINUOUS_FIXTURE/);
  assert.match(debugViewSource, /runContinuousFixtureLoop\(turns: 3\)/);
  assert.match(debugViewSource, /for turnIndex in 1\.\.\.turns/);
  assert.match(debugViewSource, /await client\.runHTTPSessionFixtureTurn\(\)/);
  assert.match(debugViewSource, /status = client\.lastError == nil \? "Loop fixture done" : "Loop fixture failed"/);
  assert.match(debugViewSource, /conversationState = \.ended/);
});
