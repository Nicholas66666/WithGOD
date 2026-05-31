import SwiftUI

struct DeepResponseDebugView: View {
    @StateObject private var client = DeepResponseRealtimeClient()
    @State private var isRecording = false
    @State private var status = "Ready"
    @State private var recorder = DeepResponseMicrophoneRecorder()
    @State private var didRunAutorunFixture = false

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
                if let first = client.lastTurnFirstText {
                    Text("first: \(first)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                        .multilineTextAlignment(.center)
                }
                if let followup = client.lastTurnFollowupText {
                    Text("more: \(followup)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
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
                if let timing = client.lastTurnTiming,
                   timing.followupLLMFirstPhraseMs != nil || timing.followupTTSFirstAudioMs != nil {
                    Text("more llm \(timing.followupLLMFirstPhraseMs ?? 0) · tts \(timing.followupTTSFirstAudioMs ?? 0)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
            }

            HStack {
                Button {
                    Task { await toggleMicrophoneTurn() }
                } label: {
                    Image(systemName: isRecording ? "stop.circle.fill" : "mic.circle.fill")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .onDisappear {
            if isRecording {
                _ = recorder.stop()
                isRecording = false
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
            await client.finishHTTPSessionTurn()
            status = client.lastError == nil ? "HTTP session done" : "HTTP session failed"
            return
        }

        do {
            status = "Starting session"
            try await client.startHTTPSessionTurn()
            status = "Recording"
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
