import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { deepResponseWatchConversationStates } from "./deep-response/lib/watch-continuous-state-machine.mjs";

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

test("DeepResponse Watch continuous mode off stops active recording", () => {
  assert.match(debugViewSource, /Task \{ await toggleContinuousMode\(\) \}/);
  const toggleFunction = debugViewSource.match(/private func toggleContinuousMode\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(toggleFunction, /isContinuousMode\.toggle\(\)/);
  assert.match(toggleFunction, /if !isContinuousMode,[\s\S]*?isRecording \{[\s\S]*?_ = recorder\.stop\(\)/);
  assert.match(toggleFunction, /conversationState = \.listening/);
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

test("DeepResponse Watch continuous mode resumes after an empty recording", () => {
  const emptyRecordingStart = debugViewSource.indexOf("guard !audio.isEmpty || client.uploadedAudioChunks > 0 else {");
  const responseStart = debugViewSource.indexOf("isWaitingForResponse = true", emptyRecordingStart);
  const emptyRecordingBranch = debugViewSource.slice(emptyRecordingStart, responseStart);
  assert.match(emptyRecordingBranch, /status = "No audio"/);
  assert.match(emptyRecordingBranch, /if isContinuousMode,/);
  assert.match(emptyRecordingBranch, /await startRecordingTurn\(reason: "Auto listening"\)/);
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
  for (const state of deepResponseWatchConversationStates) {
    assert.match(debugViewSource, new RegExp(`case ${state}`));
  }
  assert.match(debugViewSource, /@State private var conversationState: DeepResponseConversationState = \.listening/);
  assert.match(debugViewSource, /conversationState = \.userSpeaking/);
  assert.match(debugViewSource, /conversationState = \.idleWaiting/);
  assert.match(debugViewSource, /conversationState = \.assistantThinking/);
  assert.match(debugViewSource, /conversationState = \.assistantSpeaking/);
  assert.match(debugViewSource, /conversationState = \.bargeIn/);
  assert.match(debugViewSource, /conversationState = \.ending/);
  assert.match(debugViewSource, /conversationState = \.ended/);
});

test("DeepResponse Watch marks session closure as ending before ended", () => {
  assert.match(debugViewSource, /case ending/);
  assert.match(debugViewSource, /conversationState = \.ending[\s\S]*?conversationState = \.ended/);
});

test("DeepResponse Watch session closure stops an active recorder", () => {
  const markFunction = debugViewSource.match(/private func markSessionEnded\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(markFunction, /if isRecording \{[\s\S]*?_ = recorder\.stop\(\)/);
  assert.match(markFunction, /isRecording = false/);
  assert.match(markFunction, /conversationState = \.ending[\s\S]*?conversationState = \.ended/);
});

test("DeepResponse Watch view teardown stops local HTTP session runtime", () => {
  const disappearBlock = debugViewSource.match(/\.onDisappear \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(disappearBlock, /client\.stopHTTPSessionRuntime\(\)/);

  const cleanupFunction = realtimeClientSource.match(/func stopHTTPSessionRuntime\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(cleanupFunction, /httpSessionPollTask\?\.cancel\(\)/);
  assert.match(cleanupFunction, /httpSessionPollTask = nil/);
  assert.match(cleanupFunction, /player\.stop\(\)/);
  assert.match(cleanupFunction, /isHTTPSessionPlaybackActive = false/);
  assert.match(cleanupFunction, /canAbortHTTPSessionTurn = false/);
});

test("DeepResponse Watch teardown cancels pending HTTP audio uploads", () => {
  assert.match(realtimeClientSource, /private var httpUploadDrainTask: Task<Void, Never>\?/);
  assert.match(realtimeClientSource, /httpUploadDrainTask = Task \{ \[weak self\] in/);

  const cleanupFunction = realtimeClientSource.match(/func stopHTTPSessionRuntime\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(cleanupFunction, /httpUploadDrainTask\?\.cancel\(\)/);
  assert.match(cleanupFunction, /httpUploadDrainTask = nil/);
  assert.match(cleanupFunction, /httpUploadQueue = \[\]/);
  assert.match(cleanupFunction, /httpPendingUploadAudio = Data\(\)/);
  assert.match(cleanupFunction, /isDrainingHTTPUploads = false/);
});

test("DeepResponse Watch teardown clears reusable HTTP session identity", () => {
  const cleanupFunction = realtimeClientSource.match(/func stopHTTPSessionRuntime\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(cleanupFunction, /httpSessionID = nil/);
  assert.match(cleanupFunction, /httpTurnID = nil/);
  assert.match(cleanupFunction, /httpGenerationID = nil/);
  assert.match(cleanupFunction, /httpAudioSeq = 0/);
  assert.match(cleanupFunction, /httpEventCursor = 0/);
  assert.match(cleanupFunction, /httpOutputAudioCursor = 0/);
  assert.match(cleanupFunction, /isHTTPSessionEnded = false/);
});

test("DeepResponse Watch teardown best-effort ends the server HTTP session", () => {
  const disappearBlock = debugViewSource.match(/\.onDisappear \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(disappearBlock, /client\.beginEndHTTPSessionRuntime\(reason: "watch_teardown"\)/);
  assert.match(disappearBlock, /client\.stopHTTPSessionRuntime\(\)/);

  assert.match(realtimeClientSource, /func beginEndHTTPSessionRuntime\(reason: String\) -> Task<Void, Never>\?/);
  assert.match(realtimeClientSource, /let sessionID = httpSessionID/);
  assert.match(realtimeClientSource, /finishHTTPSessionEnd\(sessionID: sessionID, reason: reason\)/);
  assert.match(realtimeClientSource, /private func finishHTTPSessionEnd\(sessionID: String, reason: String\) async/);
  assert.match(realtimeClientSource, /httpSessionURL\(path: "\/deep-response\/sessions\/\\\(sessionID\)\/end"\)/);
  assert.match(realtimeClientSource, /request\.httpMethod = "POST"/);
  assert.match(realtimeClientSource, /DeepResponseHTTPSessionEndRequest\(reason: reason\)/);
});

test("DeepResponse Watch resets reusable debug state when the view appears", () => {
  const appearBlock = debugViewSource.match(/\.onAppear \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(appearBlock, /status = "Ready"/);
  assert.match(appearBlock, /isWaitingForResponse = false/);
  assert.match(appearBlock, /isContinuousMode = false/);
  assert.match(appearBlock, /conversationState = \.listening/);
});

test("DeepResponse Watch clears stale client diagnostics when the view appears", () => {
  const appearBlock = debugViewSource.match(/\.onAppear \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(appearBlock, /client\.resetDebugViewState\(\)/);

  const resetFunction = realtimeClientSource.match(/func resetDebugViewState\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(resetFunction, /lastError = nil/);
  assert.match(resetFunction, /lastErrorCode = nil/);
  assert.match(resetFunction, /connectionStage = "idle"/);
  assert.match(resetFunction, /receivedAudioBytes = 0/);
  assert.match(resetFunction, /uploadedAudioChunks = 0/);
  assert.match(resetFunction, /lastTurnTranscript = nil/);
  assert.match(resetFunction, /lastTurnText = nil/);
  assert.match(resetFunction, /lastClientTimingText = nil/);
  assert.match(resetFunction, /lastAbortTimingText = nil/);
  assert.match(resetFunction, /lastSessionEndText = nil/);
  assert.match(resetFunction, /lastMemoryStatusText = nil/);
});

test("DeepResponse Watch marks server wait as assistantThinking before playback", () => {
  const finishFunction = debugViewSource.match(/private func finishRecordingTurn\(reason: String\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(finishFunction, /isWaitingForResponse = true[\s\S]*?conversationState = \.assistantThinking[\s\S]*?await client\.finishHTTPSessionTurn\(\)/);
  assert.match(finishFunction, /client\.isHTTPSessionPlaybackActive[\s\S]*?conversationState = \.assistantSpeaking/);
});

test("DeepResponse Watch enters assistantSpeaking on first streamed audio", () => {
  assert.match(realtimeClientSource, /var onHTTPSessionFirstAudioReceived: \(\(\) -> Void\)\?/);
  assert.match(realtimeClientSource, /httpFirstAudioMs = Self\.elapsedMs\(since: stopStartedAt\)[\s\S]*?onHTTPSessionFirstAudioReceived\?\(\)/);

  const appearBlock = debugViewSource.match(/\.onAppear \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(appearBlock, /client\.onHTTPSessionFirstAudioReceived = \{/);
  assert.match(appearBlock, /handleFirstAudioReceived\(\)/);

  const firstAudioFunction = debugViewSource.match(/private func handleFirstAudioReceived\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(firstAudioFunction, /isWaitingForResponse = false/);
  assert.match(firstAudioFunction, /conversationState = \.assistantSpeaking/);
});

test("DeepResponse Watch simulator autoruns a continuous HTTP fixture loop", () => {
  assert.match(debugViewSource, /DEEP_RESPONSE_AUTORUN_CONTINUOUS_FIXTURE/);
  assert.match(debugViewSource, /runContinuousFixtureLoop\(turns: 3\)/);
  assert.match(debugViewSource, /for turnIndex in 1\.\.\.turns/);
  assert.match(debugViewSource, /await client\.runHTTPSessionFixtureTurn\(\)/);
  assert.match(debugViewSource, /status = client\.lastError == nil \? "Loop fixture done" : "Loop fixture failed"/);
  assert.match(debugViewSource, /conversationState = \.ended/);
});

test("DeepResponse Watch HTTP polling is low-latency before first audio", () => {
  assert.match(realtimeClientSource, /private static let httpFastPollNanoseconds: UInt64 = 40_000_000/);
  assert.match(realtimeClientSource, /private static let httpSteadyPollNanoseconds: UInt64 = 120_000_000/);
  assert.match(realtimeClientSource, /private static let httpFastPollWaitMilliseconds = 800/);
  assert.match(realtimeClientSource, /private static let httpSteadyPollWaitMilliseconds = 250/);
  assert.match(realtimeClientSource, /Self\.httpPollDelayNanoseconds\(hasReceivedFirstAudio: httpFirstAudioMs != nil\)/);
  assert.match(realtimeClientSource, /Self\.httpPollWaitMilliseconds\(hasReceivedFirstAudio: httpFirstAudioMs != nil\)/);
  assert.match(realtimeClientSource, /events\?cursor=\\\(httpEventCursor\)&wait_ms=\\\(waitMilliseconds\)/);
  assert.match(realtimeClientSource, /audio\?cursor=\\\(httpOutputAudioCursor\)&wait_ms=\\\(waitMilliseconds\)/);
});

test("DeepResponse Watch abort records local-first and stale-audio timing traces", () => {
  assert.match(realtimeClientSource, /@Published private\(set\) var lastAbortTimingText: String\?/);
  assert.match(realtimeClientSource, /private var httpAbortStartedAt: Date\?/);
  assert.match(realtimeClientSource, /private var httpAbortLocalStopMs: Int\?/);
  assert.match(realtimeClientSource, /private var httpAbortServerStopMs: Int\?/);
  assert.match(realtimeClientSource, /private var httpStaleAudioAfterAbortCount = 0/);
  assert.match(realtimeClientSource, /let abortStartedAt = Date\(\)[\s\S]*?player\.stop\(\)[\s\S]*?httpAbortLocalStopMs = Self\.elapsedMs\(since: abortStartedAt\)/);
  assert.match(realtimeClientSource, /httpAbortServerStopMs = Self\.elapsedMs\(since: abortStartedAt\)/);
  assert.match(realtimeClientSource, /httpStaleAudioAfterAbortCount \+= 1/);
  assert.match(realtimeClientSource, /stale \\\(httpStaleAudioAfterAbortCount\)/);
  assert.match(debugViewSource, /client\.lastAbortTimingText/);
});

test("DeepResponse Watch continuous abort resumes recording as barge-in", () => {
  const abortFunction = debugViewSource.match(/private func abortCurrentTurn\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(debugViewSource, /let shouldResumeListening = isContinuousMode/);
  assert.doesNotMatch(abortFunction, /isContinuousMode = false/);
  assert.match(debugViewSource, /let abortTask = client\.beginAbortHTTPSessionTurn\(\)[\s\S]*?if shouldResumeListening,[\s\S]*?!client\.isHTTPSessionEnded[\s\S]*?await startRecordingTurn\(reason: "Barge-in recording"\)/);
});

test("DeepResponse Watch continuous barge-in starts recording before abort ack", () => {
  const abortFunction = debugViewSource.match(/private func abortCurrentTurn\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(realtimeClientSource, /func beginAbortHTTPSessionTurn\(\) -> Task<Void, Never>\?/);
  assert.match(realtimeClientSource, /let abortTurnID = httpTurnID \?\? ""/);
  assert.match(realtimeClientSource, /let abortGenerationID = httpGenerationID \?\? ""/);
  assert.match(realtimeClientSource, /DeepResponseHTTPSessionAbortRequest\([\s\S]*?turnID: abortTurnID,[\s\S]*?generationID: abortGenerationID,/);
  assert.match(abortFunction, /let abortTask = client\.beginAbortHTTPSessionTurn\(\)/);
  assert.match(abortFunction, /if shouldResumeListening,[\s\S]*?!client\.isHTTPSessionEnded[\s\S]*?await startRecordingTurn\(reason: "Barge-in recording"\)[\s\S]*?await abortTask\?\.value/);
});

test("DeepResponse Watch mic press during assistant speech triggers local-first barge-in", () => {
  const toggleFunction = debugViewSource.match(/private func toggleMicrophoneTurn\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(toggleFunction, /if client\.canAbortHTTPSessionTurn,[\s\S]*?\(conversationState == \.assistantSpeaking \|\| client\.isHTTPSessionPlaybackActive\) \{[\s\S]*?await abortCurrentTurn\(\)[\s\S]*?return/);
  assert.doesNotMatch(toggleFunction, /await startRecordingTurn\(reason: "Recording"\)[\s\S]*?if client\.canAbortHTTPSessionTurn/);
});

test("DeepResponse Watch mic press during post-turn playback stops local audio", () => {
  const toggleFunction = debugViewSource.match(/private func toggleMicrophoneTurn\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(toggleFunction, /if conversationState == \.assistantSpeaking \|\| client\.isHTTPSessionPlaybackActive \{[\s\S]*?client\.stopHTTPSessionPlaybackForBargeIn\(\)[\s\S]*?await startRecordingTurn\(reason: "Barge-in recording"\)[\s\S]*?return/);
  assert.match(realtimeClientSource, /func stopHTTPSessionPlaybackForBargeIn\(\) \{[\s\S]*?player\.stop\(\)[\s\S]*?isHTTPSessionPlaybackActive = false/);
});

test("DeepResponse Watch continuous barge-in handles session end after abort ack", () => {
  const abortFunction = debugViewSource.match(/private func abortCurrentTurn\(\) async \{[\s\S]*?\n    \}/)?.[0] || "";
  const continuousBranch = abortFunction.match(/if shouldResumeListening,[\s\S]*?\{([\s\S]*?)\n        \} else \{/)?.[1] || "";
  assert.match(continuousBranch, /await startRecordingTurn\(reason: "Barge-in recording"\)/);
  assert.match(continuousBranch, /await abortTask\?\.value/);
  assert.match(continuousBranch, /if client\.isHTTPSessionEnded \{[\s\S]*?markSessionEnded\(\)/);
});

test("DeepResponse Watch HTTP polling waits for turn_done or session_end, not audio_done", () => {
  const pollFunction = realtimeClientSource.match(/private func pollHTTPSessionUntilDone\(sessionID: String\) async throws \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.doesNotMatch(pollFunction, /event\.type == "audio_done"[\s\S]*?isDone = true/);
  assert.match(pollFunction, /event\.type == "turn_done"[\s\S]*?isDone = true/);
  assert.match(pollFunction, /event\.type == "session_end"[\s\S]*?isDone = true/);
});

test("DeepResponse Watch shows session end and memory persistence diagnostics", () => {
  assert.match(realtimeClientSource, /@Published private\(set\) var lastSessionEndText: String\?/);
  assert.match(realtimeClientSource, /@Published private\(set\) var lastMemoryStatusText: String\?/);
  assert.match(realtimeClientSource, /lastSessionEndText = event\.reason\.map \{ "end \\\(\$0\)" \} \?\? "end"/);
  assert.match(realtimeClientSource, /event\.type == "memory_candidate"/);
  assert.match(realtimeClientSource, /lastMemoryStatusText = Self\.memoryStatusText\(for: event\)/);
  assert.match(realtimeClientSource, /let persisted: Bool\?/);
  assert.match(realtimeClientSource, /let store: String\?/);
  assert.match(realtimeClientSource, /let turnCount: Int\?/);
  assert.match(debugViewSource, /client\.lastSessionEndText/);
  assert.match(debugViewSource, /client\.lastMemoryStatusText/);
});
