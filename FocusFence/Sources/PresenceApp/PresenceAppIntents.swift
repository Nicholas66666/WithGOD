import AppIntents
import Foundation
import WatchConnectivity

@available(iOS 17.0, *)
struct StartPresenceWatchRecordIntent: AppIntent {
    static var title: LocalizedStringResource = "开始回转记录"
    static var description = IntentDescription("Start a short turning voice record on Apple Watch.")
    static var openAppWhenRun = false
    static var isDiscoverable = true

    func perform() async throws -> some IntentResult {
        PresenceWatchCommandSender.sendStartRecording()
        return .result()
    }
}

@available(iOS 17.0, *)
struct PresenceAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartPresenceWatchRecordIntent(),
            phrases: [
                "开始\(.applicationName)回转",
                "用\(.applicationName)记录回转",
                "\(.applicationName)开始记录"
            ],
            shortTitle: "回转记录",
            systemImageName: "mic.circle.fill"
        )
    }
}

enum PresenceWatchCommandSender {
    static func sendStartRecording() {
        guard WCSession.isSupported() else {
            return
        }

        let session = WCSession.default
        if session.activationState == .notActivated {
            session.activate()
        }

        let message = [
            "command": "startRecording",
            "requestedAt": Date().timeIntervalSince1970
        ] as [String: Any]

        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { _ in
                session.transferUserInfo(message)
            }
        } else {
            session.transferUserInfo(message)
        }
    }
}
