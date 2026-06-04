import Foundation
import Network

final class WatchSocketNWClient {
    var onEvent: ((WatchSocketClientEvent) -> Void)?

    private var connection: NWConnection?
    private let queue = DispatchQueue(label: "watch-socket-lab.nw")

    func probe(url: URL, timeoutSeconds: UInt64 = 15) async throws -> (connectMs: Int, rttMs: Int) {
        let connectMs = try await connect(url: url, timeoutSeconds: timeoutSeconds)
        let sentAt = Date()
        let payload = Data([0x4e, 0x57, 0x53, 0x4c, 0x01])
        try await sendBinary(payload)
        let received = try await receiveMessage(timeoutSeconds: timeoutSeconds)
        guard received == payload else {
            emit("nw_binary_mismatch", [
                "sent_bytes": payload.count,
                "received_bytes": received.count,
            ])
            throw URLError(.badServerResponse)
        }

        let rttMs = Int(Date().timeIntervalSince(sentAt) * 1_000)
        emit("nw_binary_echo", ["rtt_ms": rttMs, "bytes": payload.count])
        return (connectMs, rttMs)
    }

    func connect(url: URL, timeoutSeconds: UInt64 = 15) async throws -> Int {
        disconnect()

        guard let host = url.host else {
            throw URLError(.badURL)
        }
        let path = url.path.isEmpty ? "/" : url.path

        let tls = NWProtocolTLS.Options()
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true

        let parameters = NWParameters(tls: tls)
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)

        let connection = NWConnection(to: .url(url), using: parameters)
        self.connection = connection
        let started = Date()

        return try await withThrowingTaskGroup(of: Int.self) { group in
            group.addTask { [weak self] in
                try await withCheckedThrowingContinuation { continuation in
                    var completed = false
                    func resumeOnce(_ result: Result<Int, Error>) {
                        guard !completed else {
                            return
                        }
                        completed = true
                        switch result {
                        case .success(let elapsed):
                            continuation.resume(returning: elapsed)
                        case .failure(let error):
                            continuation.resume(throwing: error)
                        }
                    }

                    connection.stateUpdateHandler = { state in
                        self?.emit("nw_state", [
                            "state": String(describing: state),
                            "host": host,
                            "path": path,
                        ])
                        switch state {
                        case .ready:
                            let elapsedMs = Int(Date().timeIntervalSince(started) * 1_000)
                            resumeOnce(.success(elapsedMs))
                        case .failed(let error):
                            resumeOnce(.failure(error))
                        case .cancelled:
                            resumeOnce(.failure(URLError(.cancelled)))
                        default:
                            break
                        }
                    }
                    connection.start(queue: self?.queue ?? .global())
                }
            }
            group.addTask { [weak self] in
                try await Task.sleep(nanoseconds: timeoutSeconds * 1_000_000_000)
                self?.disconnect()
                throw URLError(.timedOut)
            }

            guard let elapsed = try await group.next() else {
                throw URLError(.cannotConnectToHost)
            }
            group.cancelAll()
            return elapsed
        }
    }

    func disconnect() {
        connection?.cancel()
        connection = nil
    }

    private func sendBinary(_ payload: Data) async throws {
        guard let connection else {
            throw URLError(.notConnectedToInternet)
        }

        let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
        let context = NWConnection.ContentContext(identifier: "watch-socket-lab.binary", metadata: [metadata])

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: payload, contentContext: context, isComplete: true, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }

    private func receiveMessage(timeoutSeconds: UInt64) async throws -> Data {
        try await withThrowingTaskGroup(of: Data.self) { group in
            group.addTask { [weak self] in
                guard let connection = self?.connection else {
                    throw URLError(.notConnectedToInternet)
                }
                return try await withCheckedThrowingContinuation { continuation in
                    connection.receiveMessage { content, context, _, error in
                        if let error {
                            continuation.resume(throwing: error)
                            return
                        }
                        guard let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
                              metadata.opcode == .binary,
                              let content else {
                            continuation.resume(throwing: URLError(.badServerResponse))
                            return
                        }
                        continuation.resume(returning: content)
                    }
                }
            }
            group.addTask { [weak self] in
                try await Task.sleep(nanoseconds: timeoutSeconds * 1_000_000_000)
                self?.disconnect()
                throw URLError(.timedOut)
            }

            guard let data = try await group.next() else {
                throw URLError(.badServerResponse)
            }
            group.cancelAll()
            return data
        }
    }

    private func emit(_ name: String, _ fields: [String: Any] = [:]) {
        onEvent?(WatchSocketClientEvent(name: name, fields: fields))
    }
}
