import Foundation
import WatchConnectivity

final class WatchAudioTransfer: NSObject, WCSessionDelegate {
    static let shared = WatchAudioTransfer()

    private override init() {
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else {
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handle(userInfo)
    }

    private func handle(_ message: [String: Any]) {
        guard message["command"] as? String == "startRecording" else {
            return
        }

        Task { @MainActor in
            WatchShortcutStore.requestStartRecording()
        }
    }
}
