import Foundation
import WatchKit

@MainActor
final class WatchSilentHaptics {
    static let shared = WatchSilentHaptics()

    private init() {}

    func playStart() {
        playPattern([.directionUp], interval: 0)
    }

    func playStop() {
        playPattern([.directionDown], interval: 0)
    }

    private func playPattern(_ haptics: [WKHapticType], interval: UInt64) {
        Task { [weak self] in
            guard let self else { return }
            for (index, haptic) in haptics.enumerated() {
                if index > 0 {
                    try? await Task.sleep(nanoseconds: interval)
                }
                self.play(haptic)
            }
        }
    }

    private func play(_ haptic: WKHapticType) {
        WKInterfaceDevice.current().play(haptic)
    }
}
