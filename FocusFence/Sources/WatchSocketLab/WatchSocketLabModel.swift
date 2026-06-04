import Foundation

@MainActor
final class WatchSocketLabModel: ObservableObject {
    @Published var wssURLString: String
    @Published private(set) var state = "idle"
    @Published private(set) var audioState = "inactive"
    @Published private(set) var route = "-"
    @Published private(set) var connectMs: Int?
    @Published private(set) var firstBinaryRTTMs: Int?
    @Published private(set) var framesSent = 0
    @Published private(set) var framesReceived = 0
    @Published private(set) var disconnectCount = 0
    @Published private(set) var durationSeconds = 0
    @Published private(set) var lastError = ""
    @Published private(set) var logText = ""

    private let runID = ISO8601DateFormatter().string(from: Date())
    private let audio = WatchSocketAudioRuntime()
    private let client = WatchSocketEchoClient()
    private var logs = WatchSocketLogStore()
    private var streamTask: Task<Void, Never>?
    private var runStartedAt: Date?
    private var generation: UInt32 = 1
    private var nextSequence: UInt64 = 1

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "WatchSocketLabDefaultWSSURL") as? String ?? ""
        if configured.hasPrefix("wss://") || configured.hasPrefix("ws://") {
            wssURLString = configured
        } else {
            wssURLString = "wss://YOUR_VALID_TLS_DOMAIN/ws/echo"
        }

        client.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }

        appendLog("app_start", [
            "run_id": runID,
            "bundle_id": Bundle.main.bundleIdentifier ?? "",
        ])
    }

    func activateAudio() {
        Task {
            do {
                state = "audio:start"
                let activated = try await audio.activateVoiceChat()
                audioState = activated.label
                route = activated.route
                state = "audio:active"
                appendLog("audio_active", [
                    "run_id": runID,
                    "audio_session": activated.label,
                    "route": activated.route,
                ])
            } catch {
                setError("audio_error", error)
            }
        }
    }

    func connect() {
        Task {
            guard let url = URL(string: wssURLString) else {
                lastError = "Bad WSS URL"
                appendLog("connect_error", ["run_id": runID, "error": "bad_url"])
                return
            }

            do {
                state = "connecting"
                connectMs = nil
                appendLog("connect_start", [
                    "run_id": runID,
                    "wss_url": url.absoluteString,
                    "audio_session": audioState,
                    "route": route,
                ])
                let elapsed = try await client.connect(url: url)
                connectMs = elapsed
                state = "connected"
                lastError = ""
                runStartedAt = Date()
                client.startReceiving()
            } catch {
                setError("connect_error", error)
            }
        }
    }

    func startBinaryEcho() {
        guard client.isConnected else {
            state = "connect_first"
            appendLog("stream_blocked", [
                "run_id": runID,
                "reason": "websocket_not_open",
            ])
            return
        }
        guard streamTask == nil else {
            return
        }

        state = "streaming"
        runStartedAt = runStartedAt ?? Date()
        appendLog("stream_start", [
            "run_id": runID,
            "generation": Int(generation),
            "interval_ms": 100,
        ])

        streamTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else {
                    return
                }
                let generation = self.generation
                let sequence = self.nextSequence
                self.incrementSequenceBeforeSend()

                do {
                    try await self.client.sendBinary(generation: generation, sequence: sequence)
                    self.markSent()
                } catch {
                    self.setError("send_error", error)
                    return
                }

                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
    }

    func simulateAbort() {
        Task {
            let started = Date()
            generation += 1
            streamTask?.cancel()
            streamTask = nil
            appendLog("abort_local_stop", [
                "run_id": runID,
                "generation": Int(generation),
                "abort_local_stop_ms": Int(Date().timeIntervalSince(started) * 1_000),
            ])

            do {
                try await client.sendAbort(generation: generation)
                state = "aborted"
            } catch {
                setError("abort_error", error)
            }
        }
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
        client.disconnect()
        audio.deactivate()
        durationSeconds = currentDurationSeconds()
        state = "stopped"
        appendSummary(event: "summary")
    }

    func markSummary() {
        durationSeconds = currentDurationSeconds()
        appendSummary(event: "manual_summary")
    }

    private func handle(_ event: WatchSocketClientEvent) {
        switch event.name {
        case "binary_echo":
            framesReceived += 1
            if firstBinaryRTTMs == nil, let rtt = event.fields["rtt_ms"] as? Int, rtt >= 0 {
                firstBinaryRTTMs = rtt
            }
        case "disconnect", "receive_error":
            disconnectCount += 1
            state = event.name
        case "text_receive":
            if let text = event.fields["text"] as? String, text.contains("abort_ack") {
                state = "abort_ack"
            }
        default:
            break
        }

        var fields = event.fields
        fields["run_id"] = runID
        appendLog(event.name, fields)
        durationSeconds = currentDurationSeconds()
    }

    private func incrementSequenceBeforeSend() {
        nextSequence += 1
    }

    private func markSent() {
        framesSent += 1
        durationSeconds = currentDurationSeconds()
    }

    private func setError(_ event: String, _ error: Error) {
        let nsError = error as NSError
        let message = "\(nsError.domain)#\(nsError.code): \(nsError.localizedDescription)"
        lastError = message
        state = event
        appendLog(event, [
            "run_id": runID,
            "error": message,
            "audio_session": audioState,
            "route": route,
        ])
    }

    private func appendSummary(event: String) {
        appendLog(event, [
            "run_id": runID,
            "audio_session": audioState,
            "background_modes": ["audio"],
            "connect_ms": connectMs ?? -1,
            "first_binary_rtt_ms": firstBinaryRTTMs ?? -1,
            "duration_s": durationSeconds,
            "frames_sent": framesSent,
            "frames_received": framesReceived,
            "disconnect_count": disconnectCount,
            "last_error": lastError,
            "wss_url": wssURLString,
        ])
    }

    private func appendLog(_ event: String, _ fields: [String: Any] = [:]) {
        logs.append(event, fields: fields)
        logText = logs.text
    }

    private func currentDurationSeconds() -> Int {
        guard let runStartedAt else {
            return 0
        }
        return Int(Date().timeIntervalSince(runStartedAt))
    }
}
