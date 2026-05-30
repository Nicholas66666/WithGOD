import DeviceActivity
import Foundation
import ManagedSettings

final class FocusFenceShieldAction: ShieldActionDelegate {
    private let store = ManagedSettingsStore()

    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        handle(action: action, completionHandler: completionHandler)
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        handle(action: action, completionHandler: completionHandler)
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        handle(action: action, completionHandler: completionHandler)
    }

    private func handle(action: ShieldAction, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            store.shield.applications = nil
            store.shield.applicationCategories = nil
            store.shield.webDomains = nil
            UserDefaults.focusFence.set(false, forKey: FocusFenceConstants.isLockedKey)
            scheduleRelock()
            completionHandler(.defer)
        default:
            completionHandler(.none)
        }
    }

    private func scheduleRelock() {
        let minutes = max(UserDefaults.focusFence.integer(forKey: FocusFenceConstants.extensionMinutesKey), 1)
        let center = DeviceActivityCenter()
        let now = Date()
        let end = Calendar.current.date(byAdding: .minute, value: minutes, to: now) ?? now.addingTimeInterval(TimeInterval(minutes * 60))

        let schedule = DeviceActivitySchedule(
            intervalStart: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: end),
            intervalEnd: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Calendar.current.date(byAdding: .minute, value: 1, to: end) ?? end),
            repeats: false
        )

        try? center.startMonitoring(FocusFenceConstants.extensionSessionName, during: schedule)
    }
}
