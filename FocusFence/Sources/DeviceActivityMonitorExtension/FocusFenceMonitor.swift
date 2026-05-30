import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import UserNotifications

final class FocusFenceMonitor: DeviceActivityMonitor {
    private let store = ManagedSettingsStore()

    override func intervalDidStart(for activity: DeviceActivityName) {
        if activity == FocusFenceConstants.gentleReminderSessionName {
            return
        }

        guard activity == FocusFenceConstants.extensionSessionName || activity == FocusFenceConstants.focusSessionName,
              let selection = loadSelection() else {
            return
        }

        shield(selection)
        UserDefaults.focusFence.set(true, forKey: FocusFenceConstants.isLockedKey)
        notifyTimeExpired()
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        if activity == FocusFenceConstants.gentleReminderSessionName {
            notifyGentleReminder(for: event)
            return
        }

        guard event == FocusFenceConstants.limitEventName,
              (activity == FocusFenceConstants.sessionName || activity == FocusFenceConstants.usageSessionName),
              let selection = loadSelection() else {
            return
        }

        shield(selection)
        UserDefaults.focusFence.set(true, forKey: FocusFenceConstants.isLockedKey)
        notifyTimeExpired()
    }

    private func shield(_ selection: FamilyActivitySelection) {
        store.shield.applications = selection.applicationTokens
        store.shield.applicationCategories = ShieldSettings.ActivityCategoryPolicy.specific(selection.categoryTokens)
        store.shield.webDomains = selection.webDomainTokens
    }

    private func loadSelection() -> FamilyActivitySelection? {
        guard let data = UserDefaults.focusFence.data(forKey: FocusFenceConstants.selectionKey) else {
            return nil
        }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    private func notifyTimeExpired() {
        let content = UNMutableNotificationContent()
        content.title = "时间到了"
        content.body = "Focus 已重新锁住。现在离开最省力。"
        content.sound = .default
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }

        let request = UNNotificationRequest(
            identifier: "focus-fence-time-expired-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func notifyGentleReminder(for event: DeviceActivityEvent.Name) {
        guard let minutes = gentleReminderMinutes(for: event) else {
            return
        }

        let content = UNMutableNotificationContent()
        let targetName = turnTargetName()
        let copy = turnReminderCopy(minutes: minutes, targetName: targetName)
        content.title = copy.title
        content.body = copy.body
        content.sound = .default
        content.categoryIdentifier = FocusFenceConstants.turnNotificationCategoryIdentifier
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }

        let request = UNNotificationRequest(
            identifier: "focus-gentle-reminder-\(minutes)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func gentleReminderMinutes(for event: DeviceActivityEvent.Name) -> Int? {
        for minutes in 1...FocusFenceConstants.gentleReminderMaxMinutes {
            if event == FocusFenceConstants.gentleReminderEventName(minutes: minutes) {
                return minutes
            }
        }
        return nil
    }

    private func turnTargetName() -> String {
        let saved = UserDefaults.focusFence.string(forKey: FocusFenceConstants.turnTargetNameKey) ?? ""
        let trimmed = saved.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "圣经学习" : trimmed
    }

    private func turnReminderCopy(minutes: Int, targetName: String) -> (title: String, body: String) {
        switch minutes {
        case ..<10:
            return (
                "停 10 秒，转向",
                "你已经被信息流牵引约 \(minutes) 分钟。先停一下，把下一分钟交还给 \(targetName)。"
            )
        case 10..<15:
            return (
                "现在转向更值得",
                "这 \(minutes) 分钟很难真正喂养你。离开这里，读一小段、祷告一句，重新收回你的心。"
            )
        case 15..<20:
            return (
                "你已经知道该离开了",
                "已经约 \(minutes) 分钟了。不要继续被拖走。现在打开 \(targetName)，只做一个很小的开始。"
            )
        default:
            return (
                "立刻停下，重新选择",
                "这已经不是休息，是被信息流牵走了。现在退出，安静 10 秒，然后转向 \(targetName)。"
            )
        }
    }
}
