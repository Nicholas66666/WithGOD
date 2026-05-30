import SwiftUI

@main
struct PresenceWatchApp: App {
    @StateObject private var recorder = TurningRecorderViewModel()

    var body: some Scene {
        WindowGroup {
            WatchTurningView()
                .environmentObject(recorder)
                .onAppear {
                    WatchAudioTransfer.shared.activate()
                    WatchRealtimeSmokeTester.runIfRequested()
                }
                .onOpenURL { _ in
                    recorder.startFromShortcut()
                }
        }
    }
}
