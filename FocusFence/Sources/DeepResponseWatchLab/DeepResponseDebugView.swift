import SwiftUI

enum DeepResponseConversationState {
    case listening
    case userSpeaking
    case assistantThinking
    case assistantSpeaking
    case bargeIn
    case idleWaiting
    case ending
    case ended
}

struct DeepResponseDebugView: View {
    @StateObject private var client = DeepResponseRealtimeClient()
    @State private var isRecording = false
    @State private var status = "Ready"
    @State private var recorder = DeepResponseMicrophoneRecorder()
    @State private var didRunAutorunFixture = false
    @State private var isWaitingForResponse = false
    @State private var isContinuousMode = false
    @State private var conversationState: DeepResponseConversationState = .listening

    var body: some View {
        VStack(spacing: 8) {
            Text("Deep HTTP")
                .font(.headline.weight(.bold))

            statusBadge

            VStack(spacing: 3) {
                if let health = client.lastHealthStatus {
                    Text(health)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text("up \(client.uploadedAudioChunks) \(client.uploadedEncodedBytes)/\(client.uploadedAudioBytes)b · down \(client.receivedAudioChunks) \(client.receivedAudioBytes)b")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let clientTiming = client.lastClientTimingText {
                    Text(clientTiming)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                if let abortTiming = client.lastAbortTimingText {
                    Text(abortTiming)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                if let sessionEnd = client.lastSessionEndText {
                    Text(sessionEnd)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                if let memoryStatus = client.lastMemoryStatusText {
                    Text(memoryStatus)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                Text(client.connectionStage)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let errorCode = client.lastErrorCode {
                    Text(errorCode)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                        .minimumScaleFactor(0.55)
                        .multilineTextAlignment(.center)
                }
                if let transcript = client.lastTurnTranscript {
                    Text("you: \(transcript)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.65)
                        .multilineTextAlignment(.center)
                }
                if let reply = client.lastTurnText, !reply.isEmpty {
                    Text("god: \(reply)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(3)
                        .minimumScaleFactor(0.65)
                        .multilineTextAlignment(.center)
                }
                if let totalMs = client.lastTurnTotalMs {
                    Text("turn \(totalMs)ms")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if let timing = client.lastTurnTiming {
                    Text("asr \(timing.transcriptFinalMs ?? 0) · llm \(timing.llmFirstPhraseMs ?? 0) · tts \(timing.ttsFirstAudioMs ?? timing.firstTTSFirstAudioMs ?? 0)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
            }

            HStack {
                Button {
                    Task { await toggleContinuousMode() }
                } label: {
                    Image(systemName: isContinuousMode ? "repeat.circle.fill" : "repeat.circle")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await toggleMicrophoneTurn() }
                } label: {
                    Image(systemName: isRecording ? "stop.circle.fill" : "mic.circle.fill")
                }
                .buttonStyle(.borderedProminent)

                if client.canAbortHTTPSessionTurn {
                    Button {
                        Task { await abortCurrentTurn() }
                    } label: {
                        Image(systemName: "hand.raised.fill")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding()
        .onDisappear {
            client.onHTTPSessionFirstAudioReceived = nil
            client.onHTTPSessionPlaybackDrained = nil
            _ = client.beginEndHTTPSessionRuntime(reason: "watch_teardown")
            client.stopHTTPSessionRuntime()
            if isRecording {
                _ = recorder.stop()
                isRecording = false
            }
            conversationState = .ended
        }
        .onAppear {
            status = "Ready"
            isWaitingForResponse = false
            isContinuousMode = false
            conversationState = .listening
            client.resetDebugViewState()
            client.onHTTPSessionFirstAudioReceived = {
                handleFirstAudioReceived()
            }
            client.onHTTPSessionPlaybackDrained = {
                handlePlaybackDrained()
            }
        }
        .task {
            await runAutorunFixtureIfRequested()
        }
    }

    private var statusBadge: some View {
        Text(client.lastError ?? status)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(client.lastError == nil ? .green : .orange)
            .lineLimit(4)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.center)
    }

    private func toggleContinuousMode() async {
        isContinuousMode.toggle()
        status = isContinuousMode ? "Continuous on" : "Continuous off"
        if isContinuousMode,
           !isRecording,
           !isWaitingForResponse,
           !client.isHTTPSessionEnded {
            await startRecordingTurn(reason: "Auto listening")
            return
        }
        if !isContinuousMode,
           isRecording {
            _ = recorder.stop()
            isRecording = false
            isWaitingForResponse = false
            conversationState = .listening
        }
        if !isContinuousMode,
           (conversationState == .assistantSpeaking || client.isHTTPSessionPlaybackActive) {
            client.stopHTTPSessionPlaybackForBargeIn()
            isWaitingForResponse = false
            conversationState = .listening
        }
        if !isContinuousMode,
           (conversationState == .assistantThinking || isWaitingForResponse) {
            isWaitingForResponse = false
            conversationState = .listening
        }
    }

    private func toggleMicrophoneTurn() async {
        if isRecording {
            await finishRecordingTurn(reason: "Finishing")
            return
        }

        if client.canAbortHTTPSessionTurn,
           (conversationState == .assistantThinking || conversationState == .assistantSpeaking || client.isHTTPSessionPlaybackActive) {
            await abortCurrentTurn()
            return
        }

        if conversationState == .assistantSpeaking || client.isHTTPSessionPlaybackActive {
            client.stopHTTPSessionPlaybackForBargeIn()
            await startRecordingTurn(reason: "Barge-in recording")
            return
        }

        await startRecordingTurn(reason: "Recording")
    }

    private func startRecordingTurn(reason: String) async {
        guard !isRecording, !isWaitingForResponse, !client.isHTTPSessionEnded else {
            if client.isHTTPSessionEnded {
                markSessionEnded()
            }
            return
        }
        do {
            status = "Starting session"
            conversationState = .idleWaiting
            try await client.startHTTPSessionTurn()
            status = reason
            try await recorder.start(
                configuration: .init(isEndpointingEnabled: isContinuousMode),
                onChunk: { chunk in
                    Task { @MainActor in
                        client.enqueueHTTPSessionAudio(chunk)
                    }
                },
                onSilence: {
                    Task { @MainActor in
                        await finishRecordingTurn(reason: "Auto silence")
                    }
                })
            isRecording = true
            conversationState = .userSpeaking
        } catch {
            status = error.localizedDescription
            conversationState = .listening
        }
    }

    private func finishRecordingTurn(reason: String) async {
        guard isRecording else {
            return
        }
        isRecording = false
        status = reason
        conversationState = .idleWaiting
        let audio = recorder.stop()
        guard !audio.isEmpty || client.uploadedAudioChunks > 0 else {
            status = "No audio"
            if isContinuousMode,
               client.lastError == nil,
               !client.isHTTPSessionEnded {
                await startRecordingTurn(reason: "Auto listening")
                return
            }
            conversationState = .listening
            return
        }
        isWaitingForResponse = true
        conversationState = .assistantThinking
        await client.finishHTTPSessionTurn()
        isWaitingForResponse = false
        if isContinuousMode, client.lastError == nil, !client.isHTTPSessionEnded {
            if client.isHTTPSessionPlaybackActive {
                status = "Waiting playback"
                conversationState = .assistantSpeaking
                await waitForPlaybackDrainAfterTurnDone()
            } else {
                await startRecordingTurn(reason: "Auto listening")
            }
        } else {
            status = client.lastError == nil ? "HTTP session done" : "HTTP session failed"
            if client.isHTTPSessionEnded {
                markSessionEnded()
            } else {
                conversationState = .listening
            }
        }
    }

    private func waitForPlaybackDrainAfterTurnDone() async {
        let deadline = Date().addingTimeInterval(client.estimatedHTTPSessionPlaybackWatchdogSeconds())
        while client.isHTTPSessionPlaybackActive,
              Date() < deadline,
              isContinuousMode,
              !isRecording,
              !isWaitingForResponse,
              client.lastError == nil,
              !client.isHTTPSessionEnded {
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        guard isContinuousMode,
              !isRecording,
              !isWaitingForResponse,
              client.lastError == nil,
              !client.isHTTPSessionEnded else {
            return
        }
        if client.isHTTPSessionPlaybackActive {
            client.finishHTTPSessionPlaybackAfterTimeout()
        }
        handlePlaybackDrained()
    }

    private func handlePlaybackDrained() {
        if client.isHTTPSessionEnded {
            markSessionEnded()
            return
        }
        if !isContinuousMode,
           conversationState == .assistantSpeaking {
            conversationState = .listening
            return
        }
        if client.canAbortHTTPSessionTurn {
            return
        }
        guard isContinuousMode,
              !client.canAbortHTTPSessionTurn,
              !isRecording,
              !isWaitingForResponse,
              client.lastError == nil,
              !client.isHTTPSessionEnded else {
            return
        }
        Task {
            await startRecordingTurn(reason: "Auto listening")
        }
    }

    private func handleFirstAudioReceived() {
        guard !isRecording,
              !client.isHTTPSessionEnded,
              conversationState != .ending,
              conversationState != .ended,
              client.lastError == nil else {
            return
        }
        isWaitingForResponse = false
        conversationState = .assistantSpeaking
    }

    private func abortCurrentTurn() async {
        let shouldResumeListening = isContinuousMode
        isWaitingForResponse = false
        conversationState = .bargeIn
        let abortTask = client.beginAbortHTTPSessionTurn()
        if shouldResumeListening,
           client.lastError == nil,
           !client.isHTTPSessionEnded {
            await startRecordingTurn(reason: "Barge-in recording")
            await abortTask?.value
            if client.isHTTPSessionEnded {
                markSessionEnded()
            }
        } else {
            await abortTask?.value
            status = client.lastError == nil ? "Aborted" : "Abort failed"
            if client.isHTTPSessionEnded {
                markSessionEnded()
            } else {
                conversationState = .listening
            }
        }
    }

    private func markSessionEnded() {
        if isRecording {
            _ = recorder.stop()
        }
        isRecording = false
        isWaitingForResponse = false
        conversationState = .ending
        if client.isHTTPSessionPlaybackActive {
            return
        }
        conversationState = .ended
    }

    private func runAutorunFixtureIfRequested() async {
        #if targetEnvironment(simulator)
        guard !didRunAutorunFixture,
              ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_FIXTURE"] == "1"
                || ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_ECHO"] == "1"
                || ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_CONTINUOUS_FIXTURE"] == "1" else {
            return
        }
        didRunAutorunFixture = true
        if ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_CONTINUOUS_FIXTURE"] == "1" {
            await runContinuousFixtureLoop(turns: 3)
            return
        }
        if ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_ECHO"] == "1" {
            status = "Echo fixture"
            await client.runHTTPEchoFixture()
            status = client.lastError == nil ? "Echo fixture done" : "Echo fixture failed"
            return
        }
        status = "Fixture"
        await client.runHTTPSessionFixtureTurn()
        status = client.lastError == nil ? "Fixture done" : "Fixture failed"
        #endif
    }

    private func runContinuousFixtureLoop(turns: Int) async {
        #if targetEnvironment(simulator)
        isContinuousMode = true
        for turnIndex in 1...turns {
            status = "Loop fixture \(turnIndex)"
            conversationState = .userSpeaking
            await client.runHTTPSessionFixtureTurn()
            if client.lastError != nil || client.isHTTPSessionEnded {
                break
            }
            conversationState = client.isHTTPSessionPlaybackActive ? .assistantSpeaking : .idleWaiting
            await waitForFixturePlaybackDrain()
            conversationState = .listening
        }
        isContinuousMode = false
        conversationState = .ended
        status = client.lastError == nil ? "Loop fixture done" : "Loop fixture failed"
        #endif
    }

    private func waitForFixturePlaybackDrain() async {
        #if targetEnvironment(simulator)
        let deadline = Date().addingTimeInterval(30)
        while client.isHTTPSessionPlaybackActive,
              client.lastError == nil,
              !client.isHTTPSessionEnded,
              Date() < deadline {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        if client.isHTTPSessionPlaybackActive {
            status = "Loop fixture playback timeout"
            client.stopHTTPSessionPlaybackForBargeIn()
        }
        #endif
    }
}
