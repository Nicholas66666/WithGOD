import SwiftUI

struct DeepResponseDebugView: View {
    @StateObject private var client = DeepResponseRealtimeClient()
    @State private var isRecording = false
    @State private var sentChunks = 0
    @State private var status = "Ready"
    @State private var recorder = DeepResponseMicrophoneRecorder()

    var body: some View {
        VStack(spacing: 8) {
            Text("Deep v2")
                .font(.headline.weight(.bold))

            statusBadge

            VStack(spacing: 3) {
                if let health = client.lastHealthStatus {
                    Text(health)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text(client.connectionStage)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
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
            status = "Sending voice"
            let audio = recorder.stop()
            sentChunks = max(1, audio.count / 3_200)
            guard !audio.isEmpty else {
                status = "No audio"
                return
            }
            await client.runSegmentedHTTPTurn(audio)
            status = client.lastError == nil ? "Voice turn v2 done" : "Voice turn v2 failed"
            return
        }

        do {
            sentChunks = 0
            status = "Recording"
            try await recorder.start()
            isRecording = true
        } catch {
            status = error.localizedDescription
        }
    }
}
