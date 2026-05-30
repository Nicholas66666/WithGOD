import FamilyControls
import Foundation

@MainActor
final class RuleStore: ObservableObject {
    @Published var selection = FamilyActivitySelection()
    @Published var sessionDurationSeconds = 300
    @Published var extensionMinutes = 5
    @Published var dailyBudgetMinutes = 15
    @Published var usedBudgetSeconds = 0
    @Published var strictMode = false
    @Published var calmStartEnabled = true
    @Published var gentleReminderEnabled = true
    @Published var gentleReminderIntervalMinutes = 5
    @Published var turnTargetName = "圣经学习"
    @Published var turnTargetURL = ""

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .focusFence) {
        self.defaults = defaults
        load()
    }

    func load() {
        resetBudgetIfNeeded()

        sessionDurationSeconds = defaults.integer(forKey: FocusFenceConstants.sessionDurationSecondsKey)
        if sessionDurationSeconds <= 0 {
            let legacyMinutes = defaults.integer(forKey: FocusFenceConstants.dailyLimitMinutesKey)
            sessionDurationSeconds = legacyMinutes > 0 ? legacyMinutes * 60 : 300
        }

        extensionMinutes = defaults.integer(forKey: FocusFenceConstants.extensionMinutesKey)
        if extensionMinutes <= 0 {
            extensionMinutes = 5
        }

        dailyBudgetMinutes = defaults.integer(forKey: FocusFenceConstants.dailyBudgetMinutesKey)
        if dailyBudgetMinutes <= 0 {
            dailyBudgetMinutes = 15
        }

        usedBudgetSeconds = defaults.integer(forKey: FocusFenceConstants.usedBudgetSecondsKey)
        strictMode = defaults.bool(forKey: FocusFenceConstants.strictModeKey)

        if defaults.object(forKey: FocusFenceConstants.calmStartEnabledKey) == nil {
            calmStartEnabled = true
        } else {
            calmStartEnabled = defaults.bool(forKey: FocusFenceConstants.calmStartEnabledKey)
        }

        if defaults.object(forKey: FocusFenceConstants.gentleReminderEnabledKey) == nil {
            gentleReminderEnabled = true
        } else {
            gentleReminderEnabled = defaults.bool(forKey: FocusFenceConstants.gentleReminderEnabledKey)
        }

        gentleReminderIntervalMinutes = defaults.integer(forKey: FocusFenceConstants.gentleReminderIntervalMinutesKey)
        if gentleReminderIntervalMinutes <= 0 {
            gentleReminderIntervalMinutes = 5
        }

        if let savedTargetName = defaults.string(forKey: FocusFenceConstants.turnTargetNameKey),
           !savedTargetName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            turnTargetName = savedTargetName
        }
        turnTargetURL = defaults.string(forKey: FocusFenceConstants.turnTargetURLKey) ?? ""

        guard let data = defaults.data(forKey: FocusFenceConstants.selectionKey),
              let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
            return
        }
        selection = decoded
    }

    func save() {
        if let data = try? JSONEncoder().encode(selection) {
            defaults.set(data, forKey: FocusFenceConstants.selectionKey)
        }
        defaults.set(sessionDurationSeconds, forKey: FocusFenceConstants.sessionDurationSecondsKey)
        defaults.set(extensionMinutes, forKey: FocusFenceConstants.extensionMinutesKey)
        defaults.set(dailyBudgetMinutes, forKey: FocusFenceConstants.dailyBudgetMinutesKey)
        defaults.set(usedBudgetSeconds, forKey: FocusFenceConstants.usedBudgetSecondsKey)
        defaults.set(strictMode, forKey: FocusFenceConstants.strictModeKey)
        defaults.set(calmStartEnabled, forKey: FocusFenceConstants.calmStartEnabledKey)
        defaults.set(gentleReminderEnabled, forKey: FocusFenceConstants.gentleReminderEnabledKey)
        defaults.set(gentleReminderIntervalMinutes, forKey: FocusFenceConstants.gentleReminderIntervalMinutesKey)
        defaults.set(turnTargetName, forKey: FocusFenceConstants.turnTargetNameKey)
        defaults.set(turnTargetURL, forKey: FocusFenceConstants.turnTargetURLKey)
        defaults.set(Self.todayKey, forKey: FocusFenceConstants.budgetDateKey)
    }

    var remainingBudgetSeconds: Int {
        max(dailyBudgetMinutes * 60 - usedBudgetSeconds, 0)
    }

    func recordWindowStart(seconds: Int) {
        resetBudgetIfNeeded()
        usedBudgetSeconds = min(usedBudgetSeconds + seconds, dailyBudgetMinutes * 60)
        save()
    }

    private func resetBudgetIfNeeded() {
        guard defaults.string(forKey: FocusFenceConstants.budgetDateKey) != Self.todayKey else {
            return
        }
        usedBudgetSeconds = 0
        defaults.set(0, forKey: FocusFenceConstants.usedBudgetSecondsKey)
        defaults.set(Self.todayKey, forKey: FocusFenceConstants.budgetDateKey)
    }

    private static var todayKey: String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return "\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
    }
}

extension UserDefaults {
    static var focusFence: UserDefaults {
        UserDefaults(suiteName: FocusFenceConstants.appGroupIdentifier) ?? .standard
    }
}
