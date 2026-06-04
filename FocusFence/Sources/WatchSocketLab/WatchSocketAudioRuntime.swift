import AVFoundation
import Foundation

struct WatchSocketAudioState {
    let label: String
    let route: String
}

final class WatchSocketAudioRuntime {
    func activateVoiceChat() async throws -> WatchSocketAudioState {
        let session = AVAudioSession.sharedInstance()
        try await requestRecordPermission(session)
        try session.setCategory(.playAndRecord, mode: .voiceChat)
        try session.setActive(true)
        return WatchSocketAudioState(label: "playAndRecord.voiceChat", route: routeDescription(session))
    }

    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [])
    }

    func currentRoute() -> String {
        routeDescription(AVAudioSession.sharedInstance())
    }

    private func requestRecordPermission(_ session: AVAudioSession) async throws {
        if session.recordPermission == .granted {
            return
        }
        if session.recordPermission == .denied {
            throw URLError(.userAuthenticationRequired)
        }

        let granted = await withCheckedContinuation { continuation in
            session.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
        if !granted {
            throw URLError(.userAuthenticationRequired)
        }
    }

    private func routeDescription(_ session: AVAudioSession) -> String {
        let inputs = session.currentRoute.inputs.map(\.portType.rawValue)
        let outputs = session.currentRoute.outputs.map(\.portType.rawValue)
        return "in=\(inputs.joined(separator: "+"));out=\(outputs.joined(separator: "+"))"
    }
}
