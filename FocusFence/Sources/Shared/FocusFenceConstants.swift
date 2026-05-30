import DeviceActivity
import Foundation

enum FocusFenceConstants {
    static let appGroupIdentifier = Bundle.main.object(forInfoDictionaryKey: "FocusFenceAppGroupIdentifier") as? String ?? "group.com.nicho.FocusFence"
    static let selectionKey = "protectedSelection"
    static let dailyLimitMinutesKey = "dailyLimitMinutes"
    static let sessionDurationSecondsKey = "sessionDurationSeconds"
    static let extensionMinutesKey = "extensionMinutes"
    static let dailyBudgetMinutesKey = "dailyBudgetMinutesV2"
    static let usedBudgetSecondsKey = "usedBudgetSeconds"
    static let budgetDateKey = "budgetDate"
    static let strictModeKey = "strictMode"
    static let calmStartEnabledKey = "calmStartEnabled"
    static let gentleReminderEnabledKey = "gentleReminderEnabled"
    static let gentleReminderIntervalMinutesKey = "gentleReminderIntervalMinutes"
    static let turnTargetNameKey = "turnTargetName"
    static let turnTargetURLKey = "turnTargetURL"
    static let sessionEndDateKey = "sessionEndDate"
    static let isLockedKey = "isLocked"
    static let turnNotificationCategoryIdentifier = "focus.turn"
    static let openTurnTargetActionIdentifier = "focus.open-turn-target"
    static let focusSessionName = DeviceActivityName("focus-fence.focus-session")
    static let usageSessionName = DeviceActivityName("focus-fence.usage-session")
    static let gentleReminderSessionName = DeviceActivityName("focus-fence.gentle-reminders")
    static let sessionName = DeviceActivityName("focus-fence.daily")
    static let extensionSessionName = DeviceActivityName("focus-fence.extension")
    static let limitEventName = DeviceActivityEvent.Name("focus-fence.limit")
    static let gentleReminderMaxMinutes = 360

    static func gentleReminderEventName(minutes: Int) -> DeviceActivityEvent.Name {
        DeviceActivityEvent.Name("focus-fence.gentle-reminder.\(minutes)")
    }
}
