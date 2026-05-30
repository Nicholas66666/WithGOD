import DeviceActivity
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit
import UserNotifications

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var rules = RuleStore()
    @State private var isPickerPresented = false
    @State private var selectionBeforePicker = FamilyActivitySelection()
    @State private var authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var alertSetting: UNNotificationSetting = .notSupported
    @State private var soundSetting: UNNotificationSetting = .notSupported
    @State private var timeSensitiveSetting: UNNotificationSetting = .notSupported
    @State private var isLocked = UserDefaults.focusFence.bool(forKey: FocusFenceConstants.isLockedKey)
    @State private var calmCountdown = 0
    @State private var calmStartTask: Task<Void, Never>?
    @State private var statusMessage = "选择对象后，默认锁住；需要时开启一段使用窗口。"

    private let activityCenter = DeviceActivityCenter()
    private let settingsStore = ManagedSettingsStore()
    private let durations = [60, 300, 600, 900, 1800]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    heroCard
                    primaryControls
                    targetCard
                    budgetCard
                    durationCard
                    behaviorCard
                    gentleReminderCard
                    readinessCard
                    versionFooter
                }
                .padding(18)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Focus")
            .sheet(isPresented: $isPickerPresented, onDismiss: saveSelectionFromPicker) {
                selectionSheet
            }
            .onChange(of: rules.sessionDurationSeconds) { _, _ in rules.save() }
            .onChange(of: rules.extensionMinutes) { _, _ in rules.save() }
            .onChange(of: rules.dailyBudgetMinutes) { _, _ in rules.save() }
            .onChange(of: rules.strictMode) { _, _ in rules.save() }
            .onChange(of: rules.calmStartEnabled) { _, _ in rules.save() }
            .onChange(of: rules.gentleReminderEnabled) { _, _ in
                rules.save()
                syncGentleReminderMonitoring()
            }
            .onChange(of: rules.gentleReminderIntervalMinutes) { _, _ in
                rules.save()
                syncGentleReminderMonitoring()
            }
            .onChange(of: rules.turnTargetName) { _, _ in rules.save() }
            .onChange(of: rules.turnTargetURL) { _, _ in rules.save() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await refreshReadiness() }
            }
            .task {
                await refreshReadiness()
                await requestMissingPermissionsIfNeeded()
                syncGentleReminderMonitoring()
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(mainStateTitle)
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                    Text(mainStateSubtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Image(systemName: isLocked ? "lock.fill" : "timer")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(isLocked ? .green : .orange)
                    .frame(width: 52, height: 52)
                    .background((isLocked ? Color.green : Color.orange).opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            }

            HStack(spacing: 8) {
                StatusPill(title: readinessTitle, color: readinessColor)
                StatusPill(title: selectionPillTitle, color: hasSelection ? .green : .orange)
                StatusPill(title: budgetPillTitle, color: remainingBudgetSeconds > 0 ? .blue : .red)
            }
        }
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private var primaryControls: some View {
        VStack(spacing: 12) {
            Button {
                beginStartFlow()
            } label: {
                Label(primaryButtonTitle, systemImage: calmCountdown > 0 ? "hourglass" : "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(color: .blue))
            .disabled(!canStartWindow)

            HStack(spacing: 12) {
                Button {
                    lockSelectedTargets()
                } label: {
                    Label("锁住", systemImage: "lock.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(!hasSelection)

                Button(role: .destructive) {
                    stopMonitoring()
                } label: {
                    Label("停止", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(rules.strictMode && isLocked)
            }

            if calmCountdown > 0 {
                Button("取消冷静启动") {
                    cancelCalmStart()
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            Text(statusMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var budgetCard: some View {
        CardSection(title: "今日预算", systemImage: "gauge.with.dots.needle.33percent") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text(remainingBudgetText)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("剩余")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                }

                ProgressView(value: budgetProgress)
                    .tint(remainingBudgetSeconds > 0 ? .blue : .red)

                Stepper("每日窗口：\(rules.dailyBudgetMinutes) 分钟", value: $rules.dailyBudgetMinutes, in: 5...60, step: 5)
                    .font(.subheadline)

                Text("预算按你主动开启的使用窗口扣减；到点仍由系统使用时长监控负责锁住。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var targetCard: some View {
        CardSection(title: "管理对象", systemImage: "shield.checkered") {
            Button {
                selectionBeforePicker = rules.selection
                isPickerPresented = true
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(hasSelection ? "已选择" : "选择要限制的 App")
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Text(selectionSummary)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var durationCard: some View {
        CardSection(title: "使用窗口", systemImage: "timer") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
                ForEach(durations, id: \.self) { seconds in
                    Button {
                        rules.sessionDurationSeconds = seconds
                        rules.save()
                    } label: {
                        Text(durationText(seconds))
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(DurationButtonStyle(isSelected: rules.sessionDurationSeconds == seconds))
                }
            }

            Stepper("临时延期：\(rules.extensionMinutes) 分钟", value: $rules.extensionMinutes, in: 1...30, step: 1)
                .font(.subheadline)
                .padding(.top, 4)
        }
    }

    private var behaviorCard: some View {
        CardSection(title: "防失控策略", systemImage: "slider.horizontal.3") {
            VStack(spacing: 14) {
                Toggle(isOn: $rules.calmStartEnabled) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("冷静启动")
                            .font(.subheadline.weight(.semibold))
                        Text("开始前先等 10 秒，给大脑一个反悔点。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Toggle(isOn: $rules.strictMode) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("严格模式")
                            .font(.subheadline.weight(.semibold))
                        Text("锁住后隐藏捷径，避免顺手解除。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var gentleReminderCard: some View {
        CardSection(title: "转向提醒", systemImage: "arrow.triangle.turn.up.right.circle") {
            VStack(alignment: .leading, spacing: 14) {
                Toggle(isOn: $rules.gentleReminderEnabled) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("持续转向")
                            .font(.subheadline.weight(.semibold))
                        Text("把低价值信息流的时间，转向圣经、祷告或你的属灵学习产品。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Stepper("每 \(rules.gentleReminderIntervalMinutes) 分钟提醒", value: $rules.gentleReminderIntervalMinutes, in: 1...30, step: 1)
                    .font(.subheadline)
                    .disabled(!rules.gentleReminderEnabled)

                VStack(alignment: .leading, spacing: 8) {
                    Text("转向目标")
                        .font(.subheadline.weight(.semibold))
                    TextField("例如：圣经学习", text: $rules.turnTargetName)
                        .textInputAutocapitalization(.never)
                        .textFieldStyle(.roundedBorder)
                    TextField("你的圣经产品链接，可稍后填写", text: $rules.turnTargetURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                }

                Button {
                    openTurnTarget()
                } label: {
                    Label("打开转向目标", systemImage: "arrow.up.forward.app")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(turnTargetURL == nil)

                Text("提醒会随累计时长递进：先温柔打断，再明确转向，最后更直接地提醒你离开。Focus 不做圣经阅读器，只把你带到真正要去的地方。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var readinessCard: some View {
        CardSection(title: "系统状态", systemImage: "checklist.checked") {
            VStack(spacing: 12) {
                ReadinessRow(title: "屏幕使用时间", value: statusLabel, color: statusColor)
                ReadinessRow(title: "通知", value: notificationStatusLabel, color: notificationStatusColor)
                ReadinessRow(title: "时效性提醒", value: timeSensitiveStatusLabel, color: timeSensitiveStatusColor)
                ReadinessRow(title: "声音与横幅", value: alertSoundStatusLabel, color: alertSoundStatusColor)

                if shouldShowPermissionActions {
                    VStack(spacing: 8) {
                        Button("重新检查权限") {
                            Task { await refreshReadiness() }
                        }
                        .buttonStyle(SecondaryButtonStyle())

                        if authorizationStatus == .notDetermined || authorizationStatus == .denied {
                            Button("打开自我管理授权") {
                                Task { await requestAuthorization() }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }

                        if notificationStatus == .denied || timeSensitiveSetting != .enabled || alertSetting != .enabled || soundSetting != .enabled {
                            Button("打开系统通知设置") {
                                openNotificationSettings()
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    .padding(.top, 4)
                }
            }
        }
    }

    private var versionFooter: some View {
        Text("\(versionLabel) · Build 16 · 转向提醒")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.bottom, 16)
    }

    private var selectionSheet: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $rules.selection)
                .navigationTitle("选择管理对象")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") {
                            rules.selection = selectionBeforePicker
                            isPickerPresented = false
                        }
                    }

                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") {
                            saveSelectionFromPicker()
                            isPickerPresented = false
                        }
                        .fontWeight(.semibold)
                    }
                }
        }
    }

    private var hasSelection: Bool {
        !rules.selection.applicationTokens.isEmpty ||
        !rules.selection.categoryTokens.isEmpty ||
        !rules.selection.webDomainTokens.isEmpty
    }

    private var mainStateTitle: String {
        if !hasSelection {
            return "设置你的边界"
        }
        return isLocked ? "已守住" : "使用窗口开启"
    }

    private var mainStateSubtitle: String {
        if !hasSelection {
            return "先选最容易失控的 App，Focus 会默认锁住它们。"
        }
        if remainingBudgetSeconds <= 0 {
            return "今天的使用窗口已经用完。明天会自动恢复预算。"
        }
        if isLocked {
            return "所选对象已锁住。需要时开启一段短窗口。"
        }
        return "到达 \(durationLabel) 后会自动重新锁住。"
    }

    private var selectionPillTitle: String {
        hasSelection ? "已选 \(selectedItemCount) 项" : "未选择对象"
    }

    private var selectedItemCount: Int {
        rules.selection.applicationTokens.count + rules.selection.categoryTokens.count + rules.selection.webDomainTokens.count
    }

    private var remainingBudgetSeconds: Int {
        rules.remainingBudgetSeconds
    }

    private var effectiveWindowSeconds: Int {
        min(rules.sessionDurationSeconds, remainingBudgetSeconds)
    }

    private var canStartWindow: Bool {
        hasSelection && remainingBudgetSeconds > 0 && calmCountdown == 0
    }

    private var primaryButtonTitle: String {
        if calmCountdown > 0 {
            return "冷静 \(calmCountdown) 秒"
        }
        if remainingBudgetSeconds <= 0 {
            return "今日预算已用完"
        }
        return "开始 \(effectiveDurationLabel) 使用"
    }

    private var effectiveDurationLabel: String {
        durationText(effectiveWindowSeconds)
    }

    private var budgetPillTitle: String {
        "剩 \(remainingBudgetText)"
    }

    private var remainingBudgetText: String {
        durationText(remainingBudgetSeconds)
    }

    private var budgetProgress: Double {
        guard rules.dailyBudgetMinutes > 0 else {
            return 0
        }
        return min(Double(rules.usedBudgetSeconds) / Double(rules.dailyBudgetMinutes * 60), 1)
    }

    private var readinessTitle: String {
        isReady ? "系统就绪" : "需要检查"
    }

    private var readinessColor: Color {
        isReady ? .green : .orange
    }

    private var isReady: Bool {
        let screenTimeReady = authorizationStatus == .approved || screenTimeHasDataAccess
        let notificationReady = notificationStatus == .authorized || notificationStatus == .provisional || notificationStatus == .ephemeral
        return screenTimeReady && notificationReady
    }

    private var shouldShowPermissionActions: Bool {
        !isReady || timeSensitiveSetting != .enabled || alertSetting != .enabled || soundSetting != .enabled
    }

    private var screenTimeHasDataAccess: Bool {
        if #available(iOS 26.4, *), authorizationStatus == .approvedWithDataAccess {
            return true
        }
        return false
    }

    private var statusLabel: String {
        if screenTimeHasDataAccess {
            return "已授权"
        }

        switch authorizationStatus {
        case .notDetermined:
            return "未授权"
        case .denied:
            return "已拒绝"
        case .approved:
            return "已授权"
        default:
            return "未知"
        }
    }

    private var statusColor: Color {
        authorizationStatus == .approved || screenTimeHasDataAccess ? .green : .orange
    }

    private var notificationStatusLabel: String {
        switch notificationStatus {
        case .authorized:
            return "已允许"
        case .provisional, .ephemeral:
            return "临时允许"
        case .denied:
            return "已拒绝"
        case .notDetermined:
            return "未询问"
        @unknown default:
            return "未知"
        }
    }

    private var notificationStatusColor: Color {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral:
            return .green
        case .denied:
            return .red
        default:
            return .orange
        }
    }

    private var timeSensitiveStatusLabel: String {
        if #available(iOS 15.0, *) {
            switch timeSensitiveSetting {
            case .enabled:
                return "已打开"
            case .disabled:
                return "未打开"
            case .notSupported:
                return "不支持"
            @unknown default:
                return "未知"
            }
        }
        return "不支持"
    }

    private var timeSensitiveStatusColor: Color {
        if #available(iOS 15.0, *) {
            return timeSensitiveSetting == .enabled ? .green : .orange
        }
        return .secondary
    }

    private var alertSoundStatusLabel: String {
        let alertReady = alertSetting == .enabled
        let soundReady = soundSetting == .enabled
        if alertReady && soundReady {
            return "已打开"
        }
        if alertReady {
            return "缺声音"
        }
        if soundReady {
            return "缺横幅"
        }
        return "未打开"
    }

    private var alertSoundStatusColor: Color {
        alertSetting == .enabled && soundSetting == .enabled ? .green : .orange
    }

    private var selectionSummary: String {
        if selectedItemCount == 0 {
            return "建议只选 1-3 个最容易让你失控的 App。"
        }
        return "\(rules.selection.applicationTokens.count) 个 App、\(rules.selection.categoryTokens.count) 个类别、\(rules.selection.webDomainTokens.count) 个网站"
    }

    private var versionLabel: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        return "Focus \(version) (\(build))"
    }

    private var turnTargetURL: URL? {
        let trimmed = rules.turnTargetURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        return URL(string: trimmed)
    }

    private var durationLabel: String {
        durationText(rules.sessionDurationSeconds)
    }

    private func durationText(_ seconds: Int) -> String {
        if seconds < 60 {
            return "\(seconds) 秒"
        }
        return "\(seconds / 60) 分钟"
    }

    private func beginStartFlow() {
        guard hasSelection else {
            statusMessage = "先选择要限制的 App。"
            return
        }
        guard remainingBudgetSeconds > 0 else {
            statusMessage = "今天的使用窗口已经用完。保持锁住，明天会自动恢复。"
            return
        }

        if rules.calmStartEnabled {
            startCalmCountdown()
        } else {
            startFocusSession()
        }
    }

    private func startCalmCountdown() {
        cancelCalmStart()
        calmCountdown = 10
        statusMessage = "先等 10 秒。如果这只是手痒，可以直接取消。"
        calmStartTask = Task {
            while calmCountdown > 0 && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled {
                    return
                }
                await MainActor.run {
                    calmCountdown -= 1
                }
            }
            guard !Task.isCancelled else {
                return
            }
            await MainActor.run {
                startFocusSession()
            }
        }
    }

    private func cancelCalmStart() {
        calmStartTask?.cancel()
        calmStartTask = nil
        calmCountdown = 0
    }

    private func saveSelectionFromPicker() {
        rules.save()
        if hasSelection && isLocked {
            shieldSelectedTargets()
        }
        syncGentleReminderMonitoring()
    }

    private func requestMissingPermissionsIfNeeded() async {
        if authorizationStatus == .notDetermined {
            await requestAuthorization()
        }

        if notificationStatus == .notDetermined {
            await requestNotificationAuthorization()
        }
    }

    private func refreshReadiness() async {
        authorizationStatus = AuthorizationCenter.shared.authorizationStatus
        await refreshNotificationStatus()
    }

    private func requestAuthorization() async {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            statusMessage = "自我管理授权已完成。"
        } catch {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            statusMessage = "自我管理授权失败：\(error.localizedDescription)"
        }
    }

    private func requestNotificationAuthorization() async {
        do {
            var options: UNAuthorizationOptions = [.alert, .sound, .badge]
            if #available(iOS 15.0, *) {
                options.insert(.timeSensitive)
            }
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: options)
            await refreshNotificationStatus()
            statusMessage = granted ? notificationReadinessMessage : "通知未允许；到时间仍会锁住，但不会弹提醒。"
        } catch {
            await refreshNotificationStatus()
            statusMessage = "通知授权失败：\(error.localizedDescription)"
        }
    }

    private func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = settings.authorizationStatus
        alertSetting = settings.alertSetting
        soundSetting = settings.soundSetting
        if #available(iOS 15.0, *) {
            timeSensitiveSetting = settings.timeSensitiveSetting
        } else {
            timeSensitiveSetting = .notSupported
        }
    }

    private func lockSelectedTargets() {
        guard hasSelection else {
            statusMessage = "先选择要限制的 App。"
            return
        }

        rules.save()
        shieldSelectedTargets()
        activityCenter.stopMonitoring([FocusFenceConstants.focusSessionName, FocusFenceConstants.usageSessionName])
        UserDefaults.focusFence.removeObject(forKey: FocusFenceConstants.sessionEndDateKey)
        UserDefaults.focusFence.set(true, forKey: FocusFenceConstants.isLockedKey)
        isLocked = true
        syncGentleReminderMonitoring()
        statusMessage = "已锁住所选对象。需要使用时，开启 \(effectiveDurationLabel) 窗口。"
    }

    private func startFocusSession() {
        cancelCalmStart()
        guard hasSelection else {
            statusMessage = "先选择要限制的 App。"
            return
        }
        guard remainingBudgetSeconds > 0 else {
            statusMessage = "今天的使用窗口已经用完。保持锁住，明天会自动恢复。"
            return
        }

        rules.save()
        let windowSeconds = effectiveWindowSeconds
        clearShield()
        let endDate = scheduleRelock(afterSeconds: windowSeconds, activityName: FocusFenceConstants.focusSessionName)
        scheduleUsageLimit(afterSeconds: windowSeconds)
        scheduleLocalReminder(at: endDate)
        rules.recordWindowStart(seconds: windowSeconds)
        UserDefaults.focusFence.set(endDate, forKey: FocusFenceConstants.sessionEndDateKey)
        UserDefaults.focusFence.set(false, forKey: FocusFenceConstants.isLockedKey)
        isLocked = false
        syncGentleReminderMonitoring()
        statusMessage = "已开启 \(durationText(windowSeconds)) 使用窗口。到时会自动重新锁住。"
    }

    private func shieldSelectedTargets() {
        settingsStore.shield.applications = rules.selection.applicationTokens
        settingsStore.shield.applicationCategories = ShieldSettings.ActivityCategoryPolicy.specific(rules.selection.categoryTokens)
        settingsStore.shield.webDomains = rules.selection.webDomainTokens
    }

    private func clearShield() {
        settingsStore.shield.applications = nil
        settingsStore.shield.applicationCategories = nil
        settingsStore.shield.webDomains = nil
    }

    private func exactDateComponents(from date: Date) -> DateComponents {
        Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    }

    @discardableResult
    private func scheduleRelock(afterSeconds seconds: Int, activityName: DeviceActivityName) -> Date {
        activityCenter.stopMonitoring([activityName])

        let now = Date()
        let relockDate = Calendar.current.date(byAdding: .second, value: seconds, to: now) ?? now.addingTimeInterval(TimeInterval(seconds))
        let endDate = Calendar.current.date(byAdding: .minute, value: 2, to: relockDate) ?? relockDate.addingTimeInterval(120)

        let schedule = DeviceActivitySchedule(
            intervalStart: exactDateComponents(from: relockDate),
            intervalEnd: exactDateComponents(from: endDate),
            repeats: false
        )

        do {
            try activityCenter.startMonitoring(activityName, during: schedule)
        } catch {
            statusMessage = "安排重新锁定失败：\(error.localizedDescription)"
        }

        return relockDate
    }

    private func scheduleUsageLimit(afterSeconds seconds: Int) {
        activityCenter.stopMonitoring([FocusFenceConstants.usageSessionName])

        let now = Date()
        let start = Calendar.current.date(byAdding: .second, value: 1, to: now) ?? now.addingTimeInterval(1)
        let end = Calendar.current.date(byAdding: .hour, value: 8, to: start) ?? start.addingTimeInterval(8 * 60 * 60)

        let schedule = DeviceActivitySchedule(
            intervalStart: exactDateComponents(from: start),
            intervalEnd: exactDateComponents(from: end),
            repeats: false
        )

        let event = DeviceActivityEvent(
            applications: rules.selection.applicationTokens,
            categories: rules.selection.categoryTokens,
            webDomains: rules.selection.webDomainTokens,
            threshold: DateComponents(second: max(seconds, 1))
        )

        do {
            try activityCenter.startMonitoring(
                FocusFenceConstants.usageSessionName,
                during: schedule,
                events: [FocusFenceConstants.limitEventName: event]
            )
        } catch {
            statusMessage = "安排使用时长监控失败：\(error.localizedDescription)"
        }
    }

    private func syncGentleReminderMonitoring() {
        activityCenter.stopMonitoring([FocusFenceConstants.gentleReminderSessionName])

        guard rules.gentleReminderEnabled, hasSelection else {
            return
        }

        let intervalMinutes = max(rules.gentleReminderIntervalMinutes, 1)
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
            repeats: true
        )

        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        for minutes in stride(from: intervalMinutes, through: FocusFenceConstants.gentleReminderMaxMinutes, by: intervalMinutes) {
            events[FocusFenceConstants.gentleReminderEventName(minutes: minutes)] = DeviceActivityEvent(
                applications: rules.selection.applicationTokens,
                categories: rules.selection.categoryTokens,
                webDomains: rules.selection.webDomainTokens,
                threshold: DateComponents(minute: minutes)
            )
        }

        do {
            try activityCenter.startMonitoring(
                FocusFenceConstants.gentleReminderSessionName,
                during: schedule,
                events: events
            )
        } catch {
            statusMessage = "安排温柔提醒失败：\(error.localizedDescription)"
        }
    }

    private func scheduleLocalReminder(at date: Date) {
        scheduleNotification(
            after: max(date.timeIntervalSinceNow, 1),
            identifierPrefix: "focus-local",
            title: "时间到了",
            body: "Focus 已重新锁住。现在离开最省力。"
        )
    }

    private func scheduleNotification(after seconds: TimeInterval, identifierPrefix: String, title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(seconds, 1), repeats: false)
        let request = UNNotificationRequest(identifier: "\(identifierPrefix)-\(Date().timeIntervalSince1970)", content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                print("Focus notification scheduling failed: \(error.localizedDescription)")
            }
        }
    }

    private var notificationReadinessMessage: String {
        if notificationStatus == .denied {
            return "通知被系统拒绝。请打开系统通知设置。"
        }
        if #available(iOS 15.0, *), timeSensitiveSetting != .enabled {
            return "通知已允许；建议打开时效性通知，并把 Focus 加到专注模式允许列表。"
        }
        if alertSetting != .enabled || soundSetting != .enabled {
            return "通知已允许；建议打开横幅、锁屏和声音。"
        }
        return "通知已准备好。"
    }

    private func openNotificationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return
        }
        UIApplication.shared.open(url)
    }

    private func openTurnTarget() {
        guard let url = turnTargetURL else {
            statusMessage = "先填写你的圣经产品链接，之后提醒里就能一键转向。"
            return
        }
        UIApplication.shared.open(url)
    }

    private func stopMonitoring() {
        if rules.strictMode && isLocked {
            statusMessage = "严格模式已开启。锁住后不能从这里一键停止。"
            return
        }
        cancelCalmStart()
        activityCenter.stopMonitoring([
            FocusFenceConstants.sessionName,
            FocusFenceConstants.extensionSessionName,
            FocusFenceConstants.focusSessionName,
            FocusFenceConstants.usageSessionName,
            FocusFenceConstants.gentleReminderSessionName
        ])
        clearShield()
        UserDefaults.focusFence.removeObject(forKey: FocusFenceConstants.sessionEndDateKey)
        UserDefaults.focusFence.set(false, forKey: FocusFenceConstants.isLockedKey)
        isLocked = false
        statusMessage = "已停止并解除当前锁定。"
    }
}

private struct CardSection<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .foregroundStyle(.primary)
            content
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct StatusPill: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())
    }
}

private struct ReadinessRow: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.semibold)
                .foregroundStyle(color)
        }
        .font(.subheadline)
    }
}

private struct PrimaryButtonStyle: ButtonStyle {
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.vertical, 15)
            .background(color.opacity(configuration.isPressed ? 0.75 : 1), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .background(Color(.tertiarySystemGroupedBackground).opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct DurationButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isSelected ? .white : .primary)
            .background(
                (isSelected ? Color.blue : Color(.tertiarySystemGroupedBackground))
                    .opacity(configuration.isPressed ? 0.75 : 1),
                in: RoundedRectangle(cornerRadius: 8)
            )
    }
}
