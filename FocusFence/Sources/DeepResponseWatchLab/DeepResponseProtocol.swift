import Foundation

enum DeepResponseEvent {
    static let sessionStart = "session.start"
    static let sessionReady = "session.ready"
    static let inputStop = "input.stop"
    static let bargeIn = "barge_in"
    static let audioDone = "audio.done"
    static let timing = "timing"
    static let error = "error"
}

struct DeepResponseMessage: Decodable {
    let type: String
    let sessionID: String?
    let mode: String?
    let sampleRate: Int?
    let reason: String?
    let turnID: Int?
    let code: String?
    let message: String?
    let timing: DeepResponseTiming?

    var diagnosticText: String {
        if let code, let message {
            return "\(code): \(message)"
        }
        return message ?? code ?? type
    }
}

struct DeepResponseTiming: Decodable, Equatable {
    let voicePipelineTotalMs: Int?
    let chunksIn: Int?
    let chunksOut: Int?
    let bargeIns: Int?

    enum CodingKeys: String, CodingKey {
        case voicePipelineTotalMs = "voice_pipeline_total_ms"
        case chunksIn = "chunks_in"
        case chunksOut = "chunks_out"
        case bargeIns = "barge_ins"
    }
}

enum DeepResponseMessageEncoder {
    static func sessionStart(sessionID: UUID, sampleRate: Int = 16_000) -> String {
        encode([
            "type": DeepResponseEvent.sessionStart,
            "sessionID": sessionID.uuidString,
            "sampleRate": sampleRate,
            "audioFormat": "pcm_s16le"
        ])
    }

    static func inputStop() -> String {
        encode(["type": DeepResponseEvent.inputStop])
    }

    static func bargeIn() -> String {
        encode(["type": DeepResponseEvent.bargeIn])
    }

    private static func encode(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"type":"error","message":"encode_failed"}"#
        }
        return text
    }
}
