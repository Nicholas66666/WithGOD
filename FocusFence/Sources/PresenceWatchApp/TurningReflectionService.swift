import Foundation

struct TurningReflection: Equatable {
    let eyebrow: String
    let headline: String
    let body: String
    let footnote: String
    let accent: WatchResponseAccent
    let responseMode: WatchResponseMode
    let voiceResponseURL: URL?

    func taggedFootnote(_ tag: String) -> TurningReflection {
        let cleanTag = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTag.isEmpty else {
            return self
        }

        let base = footnote.trimmingCharacters(in: .whitespacesAndNewlines)
        let tagged = base.isEmpty ? cleanTag : "\(base) · \(cleanTag)"
        return TurningReflection(
            eyebrow: eyebrow,
            headline: headline,
            body: body,
            footnote: tagged,
            accent: accent,
            responseMode: responseMode,
            voiceResponseURL: voiceResponseURL
        )
    }
}

enum WatchResponseAccent: String, Decodable, Equatable {
    case green
    case blue
    case gold
    case red
    case gray
}

enum WatchResponseMode: String, Decodable, Equatable {
    case silentSave
    case watchText
    case watchVoice
    case iphoneOnly
}

struct WatchRealtimeReflectionError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}

struct WatchReflectionConfigurationError: LocalizedError {
    var errorDescription: String? {
        "服务端地址没有写入 Watch App，请重新安装带配置的版本。"
    }
}

struct TurningReflectionService {
    func reflect(on audioURL: URL, recordID: UUID, duration: TimeInterval? = nil, realtimeDiagnostic: String? = nil) async throws -> TurningReflection {
        if let endpoint = Bundle.main.object(forInfoDictionaryKey: "PresenceWatchProcessEndpoint") as? String,
           let url = URL(string: endpoint),
           !endpoint.isEmpty,
           !endpoint.hasPrefix("$(") {
            return try await requestRemoteReflection(
                audioURL: audioURL,
                recordID: recordID,
                endpoint: url,
                duration: duration,
                realtimeDiagnostic: realtimeDiagnostic
            )
        }

        throw WatchReflectionConfigurationError()
    }

    private func requestRemoteReflection(
        audioURL: URL,
        recordID: UUID,
        endpoint: URL,
        duration: TimeInterval?,
        realtimeDiagnostic: String?
    ) async throws -> TurningReflection {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(Self.contentType(for: audioURL), forHTTPHeaderField: "Content-Type")
        request.setValue("watch", forHTTPHeaderField: "X-Presence-Source")
        request.setValue(recordID.uuidString, forHTTPHeaderField: "X-Presence-Local-Record-ID")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Presence-Request-ID")
        if let duration, duration.isFinite, duration > 0 {
            request.setValue(String(duration), forHTTPHeaderField: "X-Presence-Duration-Seconds")
        }
        if let realtimeDiagnostic,
           !realtimeDiagnostic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue(String(realtimeDiagnostic.prefix(900)), forHTTPHeaderField: "X-Presence-Realtime-Diagnostic")
        }
        if let clientToken = Bundle.main.object(forInfoDictionaryKey: "PresenceWatchClientToken") as? String,
           !clientToken.isEmpty,
           !clientToken.hasPrefix("$(") {
            request.setValue(clientToken, forHTTPHeaderField: "X-Presence-Client-Token")
        }
        request.httpBody = try Data(contentsOf: audioURL)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder().decode(RemoteReflectionResponse.self, from: data)
        return TurningReflection(
            eyebrow: decoded.watchResponse.eyebrow,
            headline: decoded.watchResponse.headline,
            body: decoded.watchResponse.body,
            footnote: decoded.watchResponse.footnote,
            accent: decoded.watchResponse.accent,
            responseMode: decoded.responseMode,
            voiceResponseURL: decoded.voiceResponseURL
        )
    }

    static func contentType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "wav":
            return "audio/wav"
        case "mp3":
            return "audio/mpeg"
        case "aac":
            return "audio/aac"
        default:
            return "audio/mp4"
        }
    }
}

@MainActor
final class WatchRealtimeReflectionSession {
    private let task: URLSessionWebSocketTask
    private var receiveTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var continuation: CheckedContinuation<TurningReflection, Error>?
    private var didFinish = false

    init?(recordID: UUID, audioChunks: AsyncStream<Data>) {
        guard let endpoint = Bundle.main.object(forInfoDictionaryKey: "PresenceWatchProcessEndpoint") as? String,
              !endpoint.isEmpty,
              !endpoint.hasPrefix("$("),
              var components = URLComponents(string: endpoint) else {
            return nil
        }

        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.queryItems = [URLQueryItem(name: "realtime", value: "1")]
        guard let url = components.url else {
            return nil
        }

        var request = URLRequest(url: url)
        request.setValue(recordID.uuidString, forHTTPHeaderField: "X-Presence-Local-Record-ID")
        request.setValue("watch", forHTTPHeaderField: "X-Presence-Source")
        if let clientToken = Bundle.main.object(forInfoDictionaryKey: "PresenceWatchClientToken") as? String,
           !clientToken.isEmpty,
           !clientToken.hasPrefix("$(") {
            request.setValue(clientToken, forHTTPHeaderField: "X-Presence-Client-Token")
        }

        task = URLSession.shared.webSocketTask(with: request)
        task.resume()

        sendTask = Task {
            for await chunk in audioChunks {
                guard !Task.isCancelled else {
                    return
                }
                try? await task.send(.data(chunk))
            }
        }
        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    func finish() async throws -> TurningReflection {
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            Task { [weak self] in
                do {
                    try await self?.task.send(.string(#"{"type":"stop"}"#))
                } catch {
                    await MainActor.run {
                        self?.complete(error)
                    }
                }
            }
        }
    }

    func cancel() {
        sendTask?.cancel()
        receiveTask?.cancel()
        task.cancel(with: .goingAway, reason: nil)
        if !didFinish {
            didFinish = true
            continuation?.resume(throwing: URLError(.cancelled))
        }
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                guard case let .string(text) = message,
                      let data = text.data(using: .utf8),
                      let decoded = try? JSONDecoder().decode(RealtimeReflectionResponse.self, from: data) else {
                    continue
                }

                if decoded.type == "watch_response", let watchResponse = decoded.watchResponse {
                    complete(
                        TurningReflection(
                            eyebrow: watchResponse.eyebrow,
                            headline: watchResponse.headline,
                            body: watchResponse.body,
                            footnote: watchResponse.footnote,
                            accent: watchResponse.accent,
                            responseMode: decoded.responseMode ?? .watchText,
                            voiceResponseURL: nil
                        )
                    )
                    return
                }

                if decoded.type == "error" {
                    complete(WatchRealtimeReflectionError(message: decoded.diagnosticLabel))
                    return
                }
            } catch {
                complete(error)
                return
            }
        }
    }

    private func complete(_ reflection: TurningReflection) {
        guard !didFinish else {
            return
        }
        didFinish = true
        sendTask?.cancel()
        task.cancel(with: .normalClosure, reason: nil)
        continuation?.resume(returning: reflection)
    }

    private func complete(_ error: Error) {
        guard !didFinish else {
            return
        }
        didFinish = true
        sendTask?.cancel()
        task.cancel(with: .goingAway, reason: nil)
        continuation?.resume(throwing: error)
    }
}

private struct RemoteReflectionResponse: Decodable {
    let watchResponse: RemoteWatchResponse
    let responseMode: WatchResponseMode
    let voiceResponseURL: URL?
}

private struct RemoteWatchResponse: Decodable {
    let eyebrow: String
    let headline: String
    let body: String
    let footnote: String
    let accent: WatchResponseAccent
}

private struct RealtimeReflectionResponse: Decodable {
    let type: String
    let watchResponse: RemoteWatchResponse?
    let responseMode: WatchResponseMode?
    let message: String?
    let code: String?

    var diagnosticLabel: String {
        let cleanCode = code?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleanMessage = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !cleanCode.isEmpty, !cleanMessage.isEmpty {
            return "\(cleanCode): \(cleanMessage)"
        }
        if !cleanCode.isEmpty {
            return cleanCode
        }
        if !cleanMessage.isEmpty {
            return cleanMessage
        }
        return "unknown"
    }
}
