import AppIntents
import Foundation

@available(watchOS 11.0, *)
struct StartTurningRecordIntent: AppIntent {
    static var title: LocalizedStringResource = "开始回转记录"
    static var description = IntentDescription("Open 与神同在 on Apple Watch and start a short turning voice record.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchShortcutStore.requestStartRecording()
        return .result(opensIntent: OpenURLIntent(URL(string: "withgod://record/start")!))
    }
}

@available(watchOS 11.0, *)
struct StartPresenceWatchRecordIntent: AppIntent {
    static var title: LocalizedStringResource = "开始回转记录"
    static var description = IntentDescription("Start a short turning voice record on Apple Watch.")
    static var openAppWhenRun = true
    static var isDiscoverable = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchShortcutStore.requestStartRecording()
        return .result(opensIntent: OpenURLIntent(URL(string: "withgod://record/start")!))
    }
}

@available(watchOS 11.0, *)
struct PresenceWatchShortcuts: AppShortcutsProvider {
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
