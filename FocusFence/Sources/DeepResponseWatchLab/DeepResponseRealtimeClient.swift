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
    @Published private(set) var receivedAudioBytes = 0
    @Published private(set) var receivedAudioChunks = 0

    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private let player = DeepResponseAudioPlayer()

    func connect() async throws {
        guard task == nil else { return }

        let request = URLRequest(url: try Self.endpointURL())
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        task.resume()
        isConnected = true
        lastError = nil
        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
        try await sendText(DeepResponseMessageEncoder.sessionStart(sessionID: UUID()))
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
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
        player.stop()
    }

    private func sendText(_ text: String) async throws {
        try await task?.send(.string(text))
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
                    lastError = error.localizedDescription
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
}
