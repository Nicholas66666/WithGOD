import Foundation
import Compression

enum DeepResponseClientError: LocalizedError {
    case missingEndpoint

    var errorDescription: String? {
        switch self {
        case .missingEndpoint:
            return "DeepResponse server endpoint is not configured."
        }
    }
}

@MainActor
final class DeepResponseRealtimeClient: ObservableObject {
    @Published private(set) var isConnected = false
    @Published private(set) var lastMessage: DeepResponseMessage?
    @Published private(set) var lastError: String?
    @Published private(set) var lastErrorCode: String?
    @Published private(set) var lastHealthStatus: String?
    @Published private(set) var endpointDisplay: String = (try? endpointURL().absoluteString) ?? "Endpoint missing"
    @Published private(set) var connectionStage = "idle"
    @Published private(set) var receivedAudioBytes = 0
    @Published private(set) var receivedAudioChunks = 0
    @Published private(set) var uploadedAudioChunks = 0
    @Published private(set) var uploadedAudioBytes = 0
    @Published private(set) var uploadedEncodedBytes = 0
    @Published private(set) var httpSessionID: String?
    @Published private(set) var lastTurnTranscript: String?
    @Published private(set) var lastTurnText: String?
    @Published private(set) var lastTurnFirstText: String?
    @Published private(set) var lastTurnFollowupText: String?
    @Published private(set) var lastTurnTotalMs: Int?
    @Published private(set) var lastTurnTiming: DeepResponseTiming?
    @Published private(set) var lastClientTimingText: String?

    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var session: URLSession?
    private var sessionDelegate: DeepResponseWebSocketDelegate?
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var isIntentionalDisconnect = false
    private let player = DeepResponseAudioPlayer()
    private var httpTurnID: String?
    private var httpGenerationID: String?
    private var httpAudioSeq = 0
    private var httpEventCursor = 0
    private var httpOutputAudioCursor = 0
    private var httpUploadQueue: [Data] = []
    private var httpPendingUploadAudio = Data()
    private var httpUploadFailureCount = 0
    private var isDrainingHTTPUploads = false
    private var httpStopStartedAt: Date?
    private var httpFirstAudioMs: Int?
    private let httpUploadBatchBytes = 64_000

    func checkHealth() async {
        do {
            connectionStage = "health:start"
            let url = try Self.healthURL()
            let (_, response) = try await URLSession.shared.data(from: url)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Health \(statusCode)"
            lastError = statusCode == 200 ? nil : "Health \(statusCode)"
            connectionStage = "health:\(statusCode)"
        } catch {
            lastHealthStatus = "Health fail"
            setError("Health: \(Self.describe(error))", error: error)
            connectionStage = "health:fail"
        }
    }

    func runHTTPProbe() async {
        do {
            connectionStage = "http_probe:start"
            var request = URLRequest(url: try Self.httpProbeURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")

            let payload = Data("watch-probe".utf8)
            let (_, response) = try await URLSession.shared.upload(for: request, from: payload)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Probe \(statusCode)"
            lastError = statusCode == 200 ? nil : "Probe \(statusCode)"
            lastErrorCode = nil
            connectionStage = "http_probe:\(statusCode)"
        } catch {
            lastHealthStatus = "Probe fail"
            setError("Probe: \(Self.describe(error))", error: error)
            connectionStage = "http_probe:fail"
        }
    }

    func runHTTPEcho(_ audio: Data) async {
        do {
            connectionStage = "http_echo:start"
            var request = URLRequest(url: try Self.httpEchoURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Echo \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Echo \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_echo:\(statusCode)"
                return
            }
            lastError = nil
            lastErrorCode = nil
            receivedAudioBytes += data.count
            receivedAudioChunks += 1
            player.enqueuePCM16(data, sampleRate: 16_000)
            connectionStage = "http_echo:200"
        } catch {
            lastHealthStatus = "Echo fail"
            setError("Echo: \(Self.describe(error))", error: error)
            connectionStage = "http_echo:fail"
        }
    }

    func runHTTPTurn(_ audio: Data) async {
        do {
            connectionStage = "http_turn:start"
            var request = URLRequest(url: try Self.httpTurnURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 60
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Deep-Response-Session")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Turn \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Turn \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_turn:\(statusCode)"
                return
            }
            let turn = try JSONDecoder().decode(DeepResponseHTTPTurnResponse.self, from: data)
            guard turn.ok, let audioData = Data(base64Encoded: turn.audioBase64) else {
                lastError = "Bad HTTP turn response"
                lastErrorCode = nil
                connectionStage = "http_turn:bad_response"
                return
            }
            lastError = nil
            lastErrorCode = nil
            lastTurnTranscript = turn.transcript.isEmpty ? nil : turn.transcript
            lastTurnText = turn.text.isEmpty ? nil : turn.text
            lastTurnTotalMs = turn.timing?.voicePipelineTotalMs
            lastTurnTiming = turn.timing
            receivedAudioBytes += audioData.count
            receivedAudioChunks += 1
            player.enqueuePCM16(audioData, sampleRate: turn.sampleRate)
            connectionStage = "http_turn:200"
        } catch {
            lastHealthStatus = "Turn fail"
            setError("Turn: \(Self.describe(error))", error: error)
            connectionStage = "http_turn:fail"
        }
    }

    func runSegmentedHTTPTurn(_ audio: Data) async {
        do {
            connectionStage = "http_turn_v2:start"
            var request = URLRequest(url: try Self.httpTurnV2URL())
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Deep-Response-Session")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Turn2 \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Turn2 \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_turn_v2:\(statusCode)"
                return
            }
            let turn = try JSONDecoder().decode(DeepResponseSegmentedHTTPTurnResponse.self, from: data)
            guard turn.ok else {
                lastError = "Bad HTTP turn v2 response"
                lastErrorCode = nil
                connectionStage = "http_turn_v2:bad_response"
                return
            }

            lastError = nil
            lastErrorCode = nil
            lastTurnTranscript = turn.transcript.isEmpty ? nil : turn.transcript
            lastTurnFirstText = turn.segment(kind: "first")?.text
            lastTurnFollowupText = turn.segment(kind: "followup")?.text
            lastTurnText = [lastTurnFirstText, lastTurnFollowupText]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if lastTurnText?.isEmpty == true {
                lastTurnText = nil
            }
            lastTurnTotalMs = turn.timing?.voicePipelineTotalMs
            lastTurnTiming = turn.timing

            for segment in turn.segments {
                guard let audioData = Data(base64Encoded: segment.audioBase64), !audioData.isEmpty else {
                    continue
                }
                receivedAudioBytes += audioData.count
                receivedAudioChunks += 1
                player.enqueuePCM16(audioData, sampleRate: turn.sampleRate)
            }
            connectionStage = "http_turn_v2:200"
        } catch {
            lastHealthStatus = "Turn2 fail"
            setError("Turn2: \(Self.describe(error))", error: error)
            connectionStage = "http_turn_v2:fail"
        }
    }

    func startHTTPSessionTurn() async throws {
        connectionStage = "http_session:create"
        var request = URLRequest(url: try Self.httpSessionURL(path: "/deep-response/sessions"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
        request.httpBody = #"{"sampleRate":16000}"#.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        lastHealthStatus = "Session \(statusCode)"
        guard statusCode == 200 else {
            throw NSError(domain: "DeepResponseHTTP", code: statusCode, userInfo: [
                NSLocalizedDescriptionKey: "Session \(statusCode)"
            ])
        }
        let created = try JSONDecoder().decode(DeepResponseHTTPSessionCreateResponse.self, from: data)
        guard created.ok else {
            throw NSError(domain: "DeepResponseHTTP", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Bad session response"
            ])
        }
        httpSessionID = created.sessionID
        httpTurnID = "turn-\(UUID().uuidString)"
        httpGenerationID = nil
        httpAudioSeq = 0
        httpEventCursor = 0
        httpOutputAudioCursor = 0
        httpUploadQueue = []
        httpPendingUploadAudio = Data()
        httpUploadFailureCount = 0
        isDrainingHTTPUploads = false
        httpStopStartedAt = nil
        httpFirstAudioMs = nil
        uploadedAudioChunks = 0
        uploadedAudioBytes = 0
        uploadedEncodedBytes = 0
        receivedAudioChunks = 0
        receivedAudioBytes = 0
        lastError = nil
        lastErrorCode = nil
        lastTurnTranscript = nil
        lastTurnText = nil
        lastTurnFirstText = nil
        lastTurnFollowupText = nil
        lastTurnTiming = nil
        lastTurnTotalMs = nil
        lastClientTimingText = nil
        connectionStage = "http_session:ready"
    }

    func enqueueHTTPSessionAudio(_ audio: Data) {
        guard !audio.isEmpty else {
            return
        }
        httpPendingUploadAudio.append(audio)
        while httpPendingUploadAudio.count >= httpUploadBatchBytes {
            let chunk = httpPendingUploadAudio.prefix(httpUploadBatchBytes)
            queueHTTPSessionUpload(Data(chunk))
            httpPendingUploadAudio.removeFirst(chunk.count)
        }
    }

    private func flushHTTPSessionAudio() {
        guard !httpPendingUploadAudio.isEmpty else {
            return
        }
        queueHTTPSessionUpload(httpPendingUploadAudio)
        httpPendingUploadAudio = Data()
    }

    private func queueHTTPSessionUpload(_ audio: Data) {
        guard !audio.isEmpty else {
            return
        }
        httpUploadQueue.append(audio)
        guard !isDrainingHTTPUploads else {
            return
        }
        isDrainingHTTPUploads = true
        Task { [weak self] in
            await self?.drainHTTPSessionUploadQueue()
        }
    }

    private func drainHTTPSessionUploadQueue() async {
        while !httpUploadQueue.isEmpty {
            let audio = httpUploadQueue.removeFirst()
            let uploaded = await uploadHTTPSessionAudio(audio)
            if !uploaded {
                httpUploadFailureCount += 1
            }
        }
        isDrainingHTTPUploads = false
        if !httpUploadQueue.isEmpty {
            isDrainingHTTPUploads = true
            Task { [weak self] in
                await self?.drainHTTPSessionUploadQueue()
            }
        }
    }

    private func uploadHTTPSessionAudio(_ audio: Data) async -> Bool {
        guard let sessionID = httpSessionID,
              let turnID = httpTurnID,
              !audio.isEmpty else {
            return true
        }
        let seq = httpAudioSeq
        httpAudioSeq += 1
        for attempt in 1...3 {
            do {
                let uploadBody = audio.deflated() ?? audio
                let path = "/deep-response/sessions/\(sessionID)/audio?turn_id=\(turnID)&seq=\(seq)"
                var request = URLRequest(url: try Self.httpSessionURL(path: path))
                request.httpMethod = "POST"
                request.timeoutInterval = 20
                request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                if uploadBody.count != audio.count {
                    request.setValue("deflate", forHTTPHeaderField: "Content-Encoding")
                }
                request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
                let (_, response) = try await URLSession.shared.upload(for: request, from: uploadBody)
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if statusCode == 200 {
                    uploadedAudioChunks += 1
                    uploadedAudioBytes += audio.count
                    uploadedEncodedBytes += uploadBody.count
                    connectionStage = "http_session:up \(uploadedAudioChunks)"
                    return true
                }
                lastError = "Upload \(statusCode)"
                connectionStage = "http_session:upload_\(statusCode)"
            } catch {
                setError("Upload: \(Self.describe(error))", error: error)
                connectionStage = "http_session:upload_fail \(attempt)"
            }

            if attempt < 3 {
                try? await Task.sleep(nanoseconds: UInt64(attempt) * 300_000_000)
            }
        }
        return false
    }

    func finishHTTPSessionTurn() async {
        guard let sessionID = httpSessionID,
              let turnID = httpTurnID else {
            lastError = "No HTTP session"
            return
        }
        do {
            let stopStartedAt = Date()
            httpStopStartedAt = stopStartedAt
            httpFirstAudioMs = nil
            lastClientTimingText = nil
            connectionStage = "http_session:stop"
            flushHTTPSessionAudio()
            await waitForPendingHTTPSessionUploads()
            let uploadMs = Self.elapsedMs(since: stopStartedAt)
            lastClientTimingText = "upl \(uploadMs)"
            guard httpUploadFailureCount == 0 else {
                lastError = "Upload failed \(httpUploadFailureCount)"
                connectionStage = "http_session:upload_failed"
                return
            }
            var request = URLRequest(url: try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/input-stop"))
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.httpBody = #"{"turnID":"\#(turnID)"}"#.data(using: .utf8)
            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Session \(statusCode)"
            guard statusCode == 200 else {
                lastError = "InputStop \(statusCode)"
                connectionStage = "http_session:stop_\(statusCode)"
                return
            }
            let stopped = try JSONDecoder().decode(DeepResponseHTTPSessionInputStopResponse.self, from: data)
            httpGenerationID = stopped.generationID
            let inputStopMs = Self.elapsedMs(since: stopStartedAt)
            lastClientTimingText = "upl \(uploadMs) · stop \(inputStopMs)"
            try await pollHTTPSessionUntilDone(sessionID: sessionID)
            let doneMs = Self.elapsedMs(since: stopStartedAt)
            lastClientTimingText = "upl \(uploadMs) · first \(httpFirstAudioMs ?? 0) · done \(doneMs)"
            connectionStage = "http_session:done"
        } catch {
            setError("Session: \(Self.describe(error))", error: error)
            connectionStage = "http_session:fail"
        }
    }

    private func waitForPendingHTTPSessionUploads() async {
        while isDrainingHTTPUploads || !httpUploadQueue.isEmpty {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    private func pollHTTPSessionUntilDone(sessionID: String) async throws {
        let startedAt = Date()
        var isDone = false
        while !isDone && Date().timeIntervalSince(startedAt) < 120 {
            let eventsURL = try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/events?cursor=\(httpEventCursor)")
            let (eventData, eventResponse) = try await URLSession.shared.data(from: eventsURL)
            if (eventResponse as? HTTPURLResponse)?.statusCode == 200 {
                let batch = try JSONDecoder().decode(DeepResponseHTTPSessionEventsResponse.self, from: eventData)
                httpEventCursor = batch.nextCursor
                for event in batch.events {
                    handleHTTPSessionEvent(event)
                    if event.type == "audio_done" {
                        isDone = true
                    }
                }
            }

            let audioURL = try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/audio?cursor=\(httpOutputAudioCursor)")
            let (audioData, audioResponse) = try await URLSession.shared.data(from: audioURL)
            if (audioResponse as? HTTPURLResponse)?.statusCode == 200 {
                let batch = try JSONDecoder().decode(DeepResponseHTTPSessionAudioResponse.self, from: audioData)
                httpOutputAudioCursor = batch.nextCursor
                var playbackAudio = Data()
                var playbackSampleRate: Double?
                for chunk in batch.chunks {
                    guard let data = Data(base64Encoded: chunk.audioBase64), !data.isEmpty else {
                        continue
                    }
                    receivedAudioChunks += 1
                    receivedAudioBytes += data.count
                    playbackSampleRate = chunk.sampleRate ?? playbackSampleRate ?? 24_000
                    playbackAudio.append(data)
                }
                if !playbackAudio.isEmpty {
                    if httpFirstAudioMs == nil, let stopStartedAt = httpStopStartedAt {
                        httpFirstAudioMs = Self.elapsedMs(since: stopStartedAt)
                        let uploadText = lastClientTimingText ?? "upl ?"
                        lastClientTimingText = "\(uploadText) · first \(httpFirstAudioMs ?? 0)"
                    }
                    player.enqueuePCM16(playbackAudio, sampleRate: playbackSampleRate ?? 24_000)
                }
            }

            if !isDone {
                try await Task.sleep(nanoseconds: 350_000_000)
            }
        }
        if !isDone {
            throw NSError(domain: "DeepResponseHTTP", code: -1001, userInfo: [
                NSLocalizedDescriptionKey: "HTTP session timeout"
            ])
        }
    }

    private func handleHTTPSessionEvent(_ event: DeepResponseHTTPSessionEvent) {
        if event.type == "transcript_final" {
            lastTurnTranscript = event.text
        } else if event.type == "assistant_text_delta" {
            if event.segment == "followup" {
                lastTurnFollowupText = event.delta
            } else {
                lastTurnFirstText = event.delta
            }
            lastTurnText = [lastTurnFirstText, lastTurnFollowupText]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        } else if event.type == "timing" {
            lastTurnTiming = event.timing
            lastTurnTotalMs = event.timing?.voicePipelineTotalMs
        } else if event.type == "error" {
            lastError = event.message ?? "HTTP session error"
        }
    }

    func connect() async throws {
        guard task == nil else { return }

        connectionStage = "ws:open"
        var request = URLRequest(url: try Self.endpointURL())
        request.timeoutInterval = 20
        let sessionDelegate = DeepResponseWebSocketDelegate(client: self)
        let session = Self.makeRealtimeSession(delegate: sessionDelegate)
        self.sessionDelegate = sessionDelegate
        let task = session.webSocketTask(with: request)
        self.session = session
        self.task = task
        isIntentionalDisconnect = false
        task.resume()
        lastError = nil
        lastErrorCode = nil
        lastMessage = nil
        do {
            try await waitForWebSocketOpen()
            connectionStage = "ws:receive"
            receiveTask = Task { [weak self] in
                await self?.receiveLoop()
            }
            connectionStage = "ws:session_start"
            try await sendText(DeepResponseMessageEncoder.sessionStart(sessionID: UUID()))
            try await waitForSessionReady()
            connectionStage = "ws:ready"
            isConnected = true
        } catch {
            disconnect()
            setError(Self.describe(error), error: error)
            connectionStage = "ws:failed"
            throw error
        }
    }

    func sendAudio(_ data: Data) async throws {
        try await task?.send(.data(data))
    }

    func sendBargeIn() async {
        player.stop()
        try? await sendText(DeepResponseMessageEncoder.bargeIn())
    }

    func stopInput() async {
        try? await sendText(DeepResponseMessageEncoder.inputStop())
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        isIntentionalDisconnect = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        sessionDelegate = nil
        openContinuation?.resume(throwing: CancellationError())
        openContinuation = nil
        isConnected = false
        player.stop()
    }

    private func sendText(_ text: String) async throws {
        try await task?.send(.string(text))
    }

    fileprivate func setError(_ message: String, error: Error? = nil) {
        lastError = message
        lastErrorCode = error.map(Self.compactCode)
    }

    private func waitForSessionReady() async throws {
        let startedAt = ContinuousClock.now
        while startedAt.duration(to: .now).components.seconds < 5 {
            if lastMessage?.type == DeepResponseEvent.sessionReady {
                return
            }
            if let lastError {
                throw NSError(domain: "DeepResponseRealtimeClient", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: lastError
                ])
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "DeepResponseRealtimeClient", code: -1001, userInfo: [
            NSLocalizedDescriptionKey: "WS timeout waiting for session_ready"
        ])
    }

    private func waitForWebSocketOpen() async throws {
        if connectionStage == "ws:didOpen" {
            return
        }

        let startedAt = ContinuousClock.now
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                openContinuation = continuation
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    while startedAt.duration(to: .now).components.seconds < 10 {
                        if self.connectionStage.hasPrefix("ws:didOpen") {
                            return
                        }
                        if let lastError = self.lastError {
                            self.openContinuation?.resume(throwing: NSError(domain: "DeepResponseRealtimeClient", code: -1, userInfo: [
                                NSLocalizedDescriptionKey: lastError
                            ]))
                            self.openContinuation = nil
                            return
                        }
                        try? await Task.sleep(nanoseconds: 100_000_000)
                    }
                    let timeout = NSError(domain: "DeepResponseRealtimeClient", code: -1001, userInfo: [
                        NSLocalizedDescriptionKey: "WS timeout waiting for didOpen"
                    ])
                    self.setError(Self.describe(timeout), error: timeout)
                    self.connectionStage = "ws:didOpen_timeout"
                    self.openContinuation?.resume(throwing: timeout)
                    self.openContinuation = nil
                }
            }
        } onCancel: {
            Task { @MainActor in
                self.openContinuation?.resume(throwing: CancellationError())
                self.openContinuation = nil
            }
        }
    }

    fileprivate func handleWebSocketOpen(protocolName: String?) {
        connectionStage = protocolName.map { "ws:didOpen \($0)" } ?? "ws:didOpen"
        openContinuation?.resume()
        openContinuation = nil
    }

    fileprivate func handleWebSocketClose(code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) }
        connectionStage = reasonText.map { "ws:didClose \(code.rawValue) \($0)" } ?? "ws:didClose \(code.rawValue)"
        openContinuation?.resume(throwing: NSError(domain: "DeepResponseRealtimeClient", code: Int(code.rawValue), userInfo: [
            NSLocalizedDescriptionKey: "WebSocket closed before ready: \(code.rawValue)"
        ]))
        openContinuation = nil
    }

    fileprivate func handleTaskComplete(error: Error?) {
        guard let error else { return }
        if isIntentionalDisconnect && openContinuation == nil {
            return
        }
        if !connectionStage.hasPrefix("ws:didOpen") {
            setError(Self.describe(error), error: error)
            connectionStage = "ws:task_complete"
            openContinuation?.resume(throwing: error)
            openContinuation = nil
        }
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            do {
                guard let task else { return }
                let message = try await task.receive()
                switch message {
                case let .string(text):
                    handleText(text)
                case let .data(data):
                    receivedAudioBytes += data.count
                    receivedAudioChunks += 1
                    player.enqueuePCM16(data, sampleRate: 16_000)
                @unknown default:
                    continue
                }
            } catch {
                if !Task.isCancelled {
                    setError(Self.describe(error), error: error)
                    connectionStage = "ws:receive_fail"
                    isConnected = false
                }
                return
            }
        }
    }

    private func handleText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(DeepResponseMessage.self, from: data) else {
            lastError = "Bad server message"
            return
        }
        lastMessage = message
        if message.type == DeepResponseEvent.error {
            lastError = message.diagnosticText
        }
    }

    private static func endpointURL() throws -> URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "DeepResponseRealtimeEndpoint") as? String,
           !configured.isEmpty,
           !configured.hasPrefix("$("),
           let url = URL(string: configured) {
            return url
        }
        guard let fallback = URL(string: "ws://127.0.0.1:8797/deep-response/realtime") else {
            throw DeepResponseClientError.missingEndpoint
        }
        return fallback
    }

    private static func healthURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        components?.path = "/health"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpProbeURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        components?.path = "/debug/http-probe"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpEchoURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        components?.path = "/debug/http-echo"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpTurnURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        components?.path = "/deep-response/http-turn"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpTurnV2URL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        components?.path = "/deep-response/http-turn-v2"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpSessionURL(path: String) throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = endpoint.scheme == "wss" ? "https" : "http"
        if let questionIndex = path.firstIndex(of: "?") {
            components?.path = String(path[..<questionIndex])
            components?.percentEncodedQuery = String(path[path.index(after: questionIndex)...])
        } else {
            components?.path = path
            components?.query = nil
        }
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func makeRealtimeSession(delegate: URLSessionWebSocketDelegate) -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.allowsCellularAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        var details = "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            details += " | \(underlying.domain) \(underlying.code): \(underlying.localizedDescription)"
        }
        return details
    }

    private static func compactCode(_ error: Error) -> String {
        let nsError = error as NSError
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            return "\(nsError.domain) \(nsError.code) | \(underlying.domain) \(underlying.code)"
        }
        return "\(nsError.domain) \(nsError.code)"
    }

    private static func elapsedMs(since start: Date) -> Int {
        Int(Date().timeIntervalSince(start) * 1_000)
    }
}

private extension Data {
    func deflated() -> Data? {
        guard !isEmpty else {
            return nil
        }

        return withUnsafeBytes { sourceBuffer in
            guard let sourcePointer = sourceBuffer.bindMemory(to: UInt8.self).baseAddress else {
                return nil
            }
            let destinationCapacity = count + 64
            let destinationPointer = UnsafeMutablePointer<UInt8>.allocate(capacity: destinationCapacity)
            defer { destinationPointer.deallocate() }

            let encodedSize = compression_encode_buffer(
                destinationPointer,
                destinationCapacity,
                sourcePointer,
                count,
                nil,
                COMPRESSION_ZLIB
            )
            guard encodedSize > 0, encodedSize < count else {
                return nil
            }
            return Data(bytes: destinationPointer, count: encodedSize)
        }
    }
}

private struct DeepResponseHTTPTurnResponse: Decodable {
    let ok: Bool
    let audioBase64: String
    let sampleRate: Double
    let transcript: String
    let text: String
    let timing: DeepResponseTiming?
}

private struct DeepResponseSegmentedHTTPTurnResponse: Decodable {
    let ok: Bool
    let transcript: String
    let segments: [DeepResponseHTTPTurnSegment]
    let sampleRate: Double
    let timing: DeepResponseTiming?

    func segment(kind: String) -> DeepResponseHTTPTurnSegment? {
        segments.first { $0.kind == kind }
    }
}

private struct DeepResponseHTTPTurnSegment: Decodable {
    let kind: String
    let text: String
    let audioBase64: String
    let audioByteLength: Int
}

private struct DeepResponseHTTPSessionCreateResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let state: String
    let sampleRate: Double
}

private struct DeepResponseHTTPSessionInputStopResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let turnID: String
    let generationID: String
}

private struct DeepResponseHTTPSessionEventsResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let cursor: Int
    let nextCursor: Int
    let events: [DeepResponseHTTPSessionEvent]
}

private struct DeepResponseHTTPSessionEvent: Decodable {
    let seq: Int
    let type: String
    let turnID: String?
    let generationID: String?
    let segment: String?
    let text: String?
    let delta: String?
    let message: String?
    let timing: DeepResponseTiming?
}

private struct DeepResponseHTTPSessionAudioResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let cursor: Int
    let nextCursor: Int
    let chunks: [DeepResponseHTTPSessionAudioChunk]
}

private struct DeepResponseHTTPSessionAudioChunk: Decodable {
    let seq: Int
    let turnID: String
    let generationID: String
    let segment: String
    let audioBase64: String
    let audioByteLength: Int
    let sampleRate: Double?
}

private final class DeepResponseWebSocketDelegate: NSObject, URLSessionWebSocketDelegate {
    private weak var client: DeepResponseRealtimeClient?

    init(client: DeepResponseRealtimeClient) {
        self.client = client
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocolName: String?
    ) {
        Task { @MainActor [weak client] in
            client?.handleWebSocketOpen(protocolName: protocolName)
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor [weak client] in
            client?.handleWebSocketClose(code: closeCode, reason: reason)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        Task { @MainActor [weak client] in
            client?.handleTaskComplete(error: error)
        }
    }
}
