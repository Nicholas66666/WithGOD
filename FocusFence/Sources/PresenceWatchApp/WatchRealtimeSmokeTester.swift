import Foundation
import OSLog

@MainActor
enum WatchRealtimeSmokeTester {
    private static let logger = Logger(subsystem: "com.nicho.WithGod.watchkitapp", category: "RealtimeSmoke")
    private static var didRun = false

    static func runIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("--realtime-smoke"),
              !didRun else {
            return
        }
        didRun = true

        Task {
            await run()
        }
    }

    private static func run() async {
        let startedAt = Date()
        let recordID = UUID()
        logger.notice("presence_realtime_smoke watch_start recordID=\(recordID.uuidString, privacy: .public)")

        guard let session = WatchRealtimeReflectionSession(
            recordID: recordID,
            audioChunks: toneChunks(duration: 3, chunkDuration: 0.2)
        ) else {
            logger.error("presence_realtime_smoke watch_failed reason=missing_endpoint")
            return
        }

        do {
            try await Task.sleep(nanoseconds: 3_400_000_000)
            let reflection = try await session.finish()
            let elapsed = Date().timeIntervalSince(startedAt)
            logger.notice("presence_realtime_smoke watch_success elapsed=\(String(format: "%.2f", elapsed), privacy: .public) headline=\(reflection.headline, privacy: .public) body=\(reflection.body, privacy: .public)")
        } catch {
            let elapsed = Date().timeIntervalSince(startedAt)
            logger.error("presence_realtime_smoke watch_failed elapsed=\(String(format: "%.2f", elapsed), privacy: .public) error=\(error.localizedDescription, privacy: .public)")
        }
    }

    private static func toneChunks(duration: TimeInterval, chunkDuration: TimeInterval) -> AsyncStream<Data> {
        AsyncStream { continuation in
            Task {
                let sampleRate = 24_000
                let totalSamples = max(1, Int(duration * Double(sampleRate)))
                let samplesPerChunk = max(1, Int(chunkDuration * Double(sampleRate)))
                var offset = 0

                while offset < totalSamples {
                    let count = min(samplesPerChunk, totalSamples - offset)
                    var data = Data(capacity: count * MemoryLayout<Int16>.size)
                    for sampleIndex in offset..<(offset + count) {
                        let envelope = min(1.0, Double(sampleIndex) / 480.0, Double(totalSamples - sampleIndex) / 480.0)
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
