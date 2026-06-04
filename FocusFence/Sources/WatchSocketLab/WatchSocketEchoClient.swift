import Foundation

struct WatchSocketClientEvent {
    let name: String
    let fields: [String: Any]
}

final class WatchSocketEchoClient: NSObject, URLSessionWebSocketDelegate {
    var onEvent: ((WatchSocketClientEvent) -> Void)?

    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var openContinuation: CheckedContinuation<Int, Error>?
    private var connectStartedAt: Date?
    private var receiveTask: Task<Void, Never>?
    private var pendingSendMs: [UInt64: Int64] = [:]

    var isConnected: Bool {
        task != nil
    }

    func connect(url: URL) async throws -> Int {
        disconnect(closeCode: .goingAway)

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 30

        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        connectStartedAt = Date()

        return try await withCheckedThrowingContinuation { continuation in
            openContinuation = continuation
            task.resume()
        }
    }

    func startReceiving() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    func sendBinary(generation: UInt32, sequence: UInt64) async throws {
        guard let task else {
            throw URLError(.notConnectedToInternet)
        }

        let payload = Self.makePayload(generation: generation, sequence: sequence)
        pendingSendMs[sequence] = Self.nowMs()
        try await task.send(.data(payload))
        emit("send_binary", [
            "generation": Int(generation),
            "seq": Int(sequence),
            "bytes": payload.count,
        ])
    }

    func sendAbort(generation: UInt32) async throws {
        guard let task else {
            throw URLError(.notConnectedToInternet)
        }
        pendingSendMs.removeAll()
        let payload = #"{"type":"abort","generation":\#(generation)}"#
        try await task.send(.string(payload))
        emit("abort_send", ["generation": Int(generation)])
    }

    func disconnect(closeCode: URLSessionWebSocketTask.CloseCode = .normalClosure) {
        receiveTask?.cancel()
        receiveTask = nil
        task?.cancel(with: closeCode, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        pendingSendMs.removeAll()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        let elapsedMs = Int(Date().timeIntervalSince(connectStartedAt ?? Date()) * 1_000)
        openContinuation?.resume(returning: elapsedMs)
        openContinuation = nil
        emit("connect_success", ["connect_ms": elapsedMs])
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        emit("disconnect", [
            "close_code": closeCode.rawValue,
            "reason": reason.flatMap { String(data: $0, encoding: .utf8) } ?? "",
        ])
        task = nil
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            guard let task else {
                return
            }

            do {
                let message = try await task.receive()
                switch message {
                case .data(let data):
                    handleBinary(data)
                case .string(let string):
                    emit("text_receive", ["text": string])
                @unknown default:
                    emit("unknown_receive")
                }
            } catch {
                emit("receive_error", ["error": Self.describe(error)])
                return
            }
        }
    }

    private func handleBinary(_ data: Data) {
        let seq = Self.readUInt64(data, offset: 8) ?? 0
        let sentMs = pendingSendMs.removeValue(forKey: seq) ?? Self.readInt64(data, offset: 16)
        let rttMs = sentMs.map { Int(Self.nowMs() - $0) }
        emit("binary_echo", [
            "seq": Int(seq),
            "bytes": data.count,
            "rtt_ms": rttMs ?? -1,
        ])
    }

    private func emit(_ name: String, _ fields: [String: Any] = [:]) {
        onEvent?(WatchSocketClientEvent(name: name, fields: fields))
    }

    private static func makePayload(generation: UInt32, sequence: UInt64) -> Data {
        var data = Data()
        data.append(contentsOf: [0x57, 0x53, 0x4c, 0x31])
        appendUInt32(generation, to: &data)
        appendUInt64(sequence, to: &data)
        appendInt64(nowMs(), to: &data)
        for index in 0..<296 {
            data.append(UInt8((Int(sequence) + index) % 255))
        }
        return data
    }

    private static func appendUInt32(_ value: UInt32, to data: inout Data) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    private static func appendUInt64(_ value: UInt64, to data: inout Data) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    private static func appendInt64(_ value: Int64, to data: inout Data) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    private static func readUInt64(_ data: Data, offset: Int) -> UInt64? {
        guard data.count >= offset + 8 else {
            return nil
        }
        return data[offset..<(offset + 8)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }

    private static func readInt64(_ data: Data, offset: Int) -> Int64? {
        readUInt64(data, offset: offset).map { Int64(bitPattern: $0) }
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }

    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        return "\(nsError.domain)#\(nsError.code): \(nsError.localizedDescription)"
    }
}
