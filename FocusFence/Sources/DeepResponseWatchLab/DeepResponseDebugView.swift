import SwiftUI

struct DeepResponseDebugView: View {
    @StateObject private var client = DeepResponseRealtimeClient()
    @State private var isStreaming = false
    @State private var sentChunks = 0
    @State private var status = "Ready"
    @State private var streamTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 10) {
            Text("Deep")
                .font(.headline.weight(.bold))

            statusBadge

            VStack(spacing: 4) {
                Text(client.endpointDisplay)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .multilineTextAlignment(.center)
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
                Text("sent \(sentChunks) · recv \(client.receivedAudioChunks)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                Text("bytes \(client.receivedAudioBytes)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                if let timing = client.lastMessage?.timing {
                    Text("total \(timing.voicePipelineTotalMs ?? 0)ms")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 8) {
                Button {
                    Task { await client.checkHealth() }
                } label: {
                    Image(systemName: "network")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await client.runHTTPProbe() }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await toggleConnect() }
                } label: {
                    Image(systemName: client.isConnected ? "xmark" : "bolt.horizontal")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await toggleStream() }
                } label: {
                    Image(systemName: isStreaming ? "stop.fill" : "waveform")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!client.isConnected)

                Button {
                    Task { await client.sendBargeIn() }
                } label: {
                    Image(systemName: "hand.raised.fill")
                }
                .buttonStyle(.bordered)
                .disabled(!client.isConnected)
            }
        }
        .padding()
        .onDisappear {
            streamTask?.cancel()
            client.disconnect()
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

    private func toggleConnect() async {
        if client.isConnected {
            client.disconnect()
            status = "Disconnected"
            return
        }

        do {
            try await client.connect()
            status = "Connected"
        } catch {
            status = error.localizedDescription
        }
    }

    private func toggleStream() async {
        if isStreaming {
            streamTask?.cancel()
            streamTask = nil
            isStreaming = false
            await client.stopInput()
            status = "Stopped"
            return
        }

        sentChunks = 0
        isStreaming = true
        status = "Streaming"
        streamTask = Task {
            for await chunk in Self.toneChunks(duration: 1.0, chunkDuration: 0.1) {
                guard !Task.isCancelled else { return }
                do {
                    try await client.sendAudio(chunk)
                    await MainActor.run {
                        sentChunks += 1
                    }
                } catch {
                    await MainActor.run {
                        status = error.localizedDescription
                        isStreaming = false
                    }
                    return
                }
            }
            await client.stopInput()
            await MainActor.run {
                status = "Echo sent"
                isStreaming = false
            }
        }
    }

    private static func toneChunks(duration: TimeInterval, chunkDuration: TimeInterval) -> AsyncStream<Data> {
        AsyncStream { continuation in
            Task {
                let sampleRate = 16_000
                let totalSamples = max(1, Int(duration * Double(sampleRate)))
                let samplesPerChunk = max(1, Int(chunkDuration * Double(sampleRate)))
                var offset = 0

                while offset < totalSamples {
                    let count = min(samplesPerChunk, totalSamples - offset)
                    var data = Data(capacity: count * MemoryLayout<Int16>.size)
                    for sampleIndex in offset..<(offset + count) {
                        let envelope = min(1.0, Double(sampleIndex) / 320.0, Double(totalSamples - sampleIndex) / 320.0)
                        let sample = sin(2.0 * .pi * 440.0 * Double(sampleIndex) / Double(sampleRate))
                        var value = Int16(max(-1, min(1, sample * 0.22 * envelope)) * Double(Int16.max)).littleEndian
                        data.append(Data(bytes: &value, count: MemoryLayout<Int16>.size))
                    }
                    continuation.yield(data)
                    offset += count
                    try? await Task.sleep(nanoseconds: UInt64(chunkDuration * 1_000_000_000))
                }
                continuation.finish()
            }
        }
    }
}
