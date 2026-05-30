import Foundation

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
    @Published private(set) var lastTurnTranscript: String?
    @Published private(set) var lastTurnText: String?
    @Published private(set) var lastTurnTotalMs: Int?

    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var session: URLSession?
    private var sessionDelegate: DeepResponseWebSocketDelegate?
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var isIntentionalDisconnect = false
    private let player = DeepResponseAudioPlayer()

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
}

private struct DeepResponseHTTPTurnResponse: Decodable {
    let ok: Bool
    let audioBase64: String
    let sampleRate: Double
    let transcript: String
    let text: String
    let timing: DeepResponseTiming?
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
