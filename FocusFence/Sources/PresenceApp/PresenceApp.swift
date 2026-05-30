import SwiftUI

@main
struct PresenceApp: App {
    @StateObject private var store = PresenceRecordStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            PresenceHomeView()
                .environmentObject(store)
                .onAppear {
                    store.startConnectivity()
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else {
                        return
                    }
                    Task {
                        await store.refreshFromServer()
                    }
                }
        }
    }
}
