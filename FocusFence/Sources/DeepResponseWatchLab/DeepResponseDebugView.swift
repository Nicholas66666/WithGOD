import SwiftUI

struct DeepResponseDebugView: View {
    @StateObject private var client = DeepResponseRealtimeClient()
    @State private var isRecording = false
    @State private var status = "Ready"
    @State private var recorder = DeepResponseMicrophoneRecorder()
    @State private var didRunAutorunFixture = false
    @State private var isWaitingForResponse = false
    @State private var isContinuousMode = false

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
                    isContinuousMode.toggle()
                    status = isContinuousMode ? "Continuous on" : "Continuous off"
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
                .disabled(isWaitingForResponse)

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
            client.onHTTPSessionPlaybackDrained = nil
            if isRecording {
                _ = recorder.stop()
                isRecording = false
            }
        }
        .onAppear {
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

    private func toggleMicrophoneTurn() async {
        if isRecording {
            isRecording = false
            status = "Finishing"
            let audio = recorder.stop()
            guard !audio.isEmpty || client.uploadedAudioChunks > 0 else {
                status = "No audio"
                return
            }
            isWaitingForResponse = true
            await client.finishHTTPSessionTurn()
            isWaitingForResponse = false
            if isContinuousMode, client.lastError == nil, !client.isHTTPSessionEnded {
                if client.isHTTPSessionPlaybackActive {
                    status = "Waiting playback"
                } else {
                    await startRecordingTurn(reason: "Auto listening")
                }
            } else {
                status = client.lastError == nil ? "HTTP session done" : "HTTP session failed"
            }
            return
        }

        await startRecordingTurn(reason: "Recording")
    }

    private func startRecordingTurn(reason: String) async {
        guard !isRecording, !isWaitingForResponse, !client.isHTTPSessionEnded else {
            return
        }
        do {
            status = "Starting session"
            try await client.startHTTPSessionTurn()
            status = reason
            try await recorder.start { chunk in
                Task { @MainActor in
                    client.enqueueHTTPSessionAudio(chunk)
                }
            }
            isRecording = true
        } catch {
            status = error.localizedDescription
        }
    }

    private func handlePlaybackDrained() {
        guard isContinuousMode,
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

    private func abortCurrentTurn() async {
        isWaitingForResponse = false
        isContinuousMode = false
        await client.abortHTTPSessionTurn()
        status = client.lastError == nil ? "Aborted" : "Abort failed"
    }

    private func runAutorunFixtureIfRequested() async {
        #if targetEnvironment(simulator)
        guard !didRunAutorunFixture,
              ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_FIXTURE"] == "1"
                || ProcessInfo.processInfo.environment["DEEP_RESPONSE_AUTORUN_ECHO"] == "1" else {
            return
        }
        didRunAutorunFixture = true
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
}
