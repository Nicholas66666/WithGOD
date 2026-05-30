import AVFoundation
import SwiftUI

@MainActor
final class TurningRecorderViewModel: NSObject, ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var isProcessing = false
    @Published private(set) var reflection: TurningReflection?
    @Published private(set) var errorMessage: String?

    private let recorder = WatchAudioRecorder()
    private let realtimeStreamer = WatchRealtimeAudioStreamer()
    private let reflectionService = TurningReflectionService()
    private var silenceTask: Task<Void, Never>?
    private var voicePlayer: AVAudioPlayer?
    private var realtimeSession: WatchRealtimeReflectionSession?
    private var currentRecordID: UUID?
    private var currentCreatedAt: Date?
    private var didStartRealtimeStream = false
    private var lastShortcutActivationHandledAt: Date?
    private let demoMode: DemoMode
    private let shortcutDuplicateWindow: TimeInterval = 1.0

    override init() {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--demo-watch-card") {
            demoMode = .card
        } else if arguments.contains("--demo-watch-recording") {
            demoMode = .recording
        } else {
            demoMode = .none
        }
        super.init()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleShortcutStartRequest),
            name: WatchShortcutStore.startRequestedNotification,
            object: nil
        )
        WatchShortcutStore.addDarwinStartObserver(self)

        if demoMode == .recording {
            isRecording = true
        } else if demoMode == .card {
            reflection = TurningReflection(
                eyebrow: "先回到神面前",
                headline: "先不回应 1 分钟",
                body: "快快地听，慢慢地说，慢慢地动怒。雅 1:19",
                footnote: "把这口气交给神",
                accent: .green,
                responseMode: .watchText,
                voiceResponseURL: nil
            )
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        WatchShortcutStore.removeDarwinStartObserver(self)
    }

    var title: String {
        if isRecording {
            return "正在听你说"
        }
        if isProcessing {
            return "正在上传整理"
        }
        if reflection != nil {
            return reflection?.eyebrow ?? "已整理"
        }
        if errorMessage != nil {
            return "没有录下来"
        }
        return "按下开始回转"
    }

    var subtitle: String {
        if let errorMessage {
            return errorMessage
        }
        if isRecording {
            return "可以停顿，想好再继续说"
        }
        if isProcessing {
            return "录音已保存，正在上传、转写并生成回应"
        }
        if reflection != nil {
            return reflection?.footnote ?? "已完成，完整内容稍后看 iPhone"
        }
        return "Action Button 可直接打开并开始录音"
    }

    var buttonTitle: String {
        isRecording ? "结束记录" : "开始记录"
    }

    var statusSystemImage: String {
        if isRecording {
            return "mic.fill"
        }
        if isProcessing {
            return "hourglass"
        }
        if reflection != nil {
            return "book.closed.fill"
        }
        if errorMessage != nil {
            return "exclamationmark.triangle.fill"
        }
        return "arrow.triangle.turn.up.right.circle.fill"
    }

    var statusColor: Color {
        if isRecording {
            return .red
        }
        if isProcessing {
            return .orange
        }
        if reflection != nil {
            return .green
        }
        if errorMessage != nil {
            return .orange
        }
        return .blue
    }

    func startFromShortcut() {
        WatchShortcutStore.requestStartRecording()
        consumePendingShortcutStartIfNeeded()
    }

    func consumePendingShortcutStartRepeatedly() {
        Task { @MainActor in
            for _ in 0..<12 {
                if consumePendingShortcutStartIfNeeded() {
                    return
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
    }

    @discardableResult
    private func consumePendingShortcutStartIfNeeded() -> Bool {
        guard WatchShortcutStore.shouldStartRecording,
              WatchShortcutStore.wasRequestedRecently else {
            return false
        }

        WatchShortcutStore.shouldStartRecording = false

        guard demoMode == .none else {
            return false
        }

        let now = Date()
        if let lastShortcutActivationHandledAt,
           now.timeIntervalSince(lastShortcutActivationHandledAt) < shortcutDuplicateWindow {
            return true
        }
        lastShortcutActivationHandledAt = now

        if isRecording {
            stopRecording()
            return true
        }

        guard !isProcessing else {
            return true
        }

        reflection = nil
        errorMessage = nil
        startRecording()
        return true
    }

    @objc private func handleShortcutStartRequest() {
        consumePendingShortcutStartRepeatedly()
    }

    func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    func startRecording() {
        guard demoMode == .none else {
            return
        }
        reflection = nil
        errorMessage = nil
        silenceTask?.cancel()

        Task {
            do {
                try await recorder.start()
                let recordID = UUID()
                currentRecordID = recordID
                currentCreatedAt = Date()
                didStartRealtimeStream = false
                realtimeSession = nil
                isRecording = true
                WatchSilentHaptics.shared.playStart()
                startSilenceDetection()
            } catch {
                errorMessage = "请确认手表已允许麦克风权限。"
            }
        }
    }

    func stopRecording() {
        guard isRecording else {
            return
        }

        silenceTask?.cancel()
        silenceTask = nil
        isRecording = false
        isProcessing = true
        let recordID = currentRecordID ?? UUID()
        let createdAt = currentCreatedAt ?? Date()
        let fileURL = recorder.stop()
        WatchSilentHaptics.shared.playStop()

        let duration = Date().timeIntervalSince(createdAt)
        if duration < 3.5 {
            try? FileManager.default.removeItem(at: fileURL)
            realtimeSession?.cancel()
            realtimeSession = nil
            currentRecordID = nil
            currentCreatedAt = nil
            didStartRealtimeStream = false
            isProcessing = false
            errorMessage = "3.5 秒以内的误触录音已丢弃。"
            return
        }

        reflection = nil

        Task {
            let fallbackTask = Task {
                try await reflectionService.reflect(on: fileURL, recordID: recordID, duration: duration)
            }

            do {
                reflection = try await fallbackTask.value
                speakIfExplicitlyAllowed()
            } catch {
                if reflection == nil {
                    errorMessage = "记录已保存，但暂时无法生成反馈。"
                }
            }
            realtimeSession = nil
            currentRecordID = nil
            currentCreatedAt = nil
            didStartRealtimeStream = false
            isProcessing = false
        }
    }

    private func firstAvailableReflection(
        realtimeTask: Task<TurningReflection, Error>,
        fallbackTask: Task<TurningReflection, Error>
    ) async throws -> ReflectionRaceResult {
        try await withThrowingTaskGroup(of: ReflectionRaceResult.self) { group in
            group.addTask {
                .realtime(try await realtimeTask.value)
            }
            group.addTask {
                .fallback(try await fallbackTask.value)
            }

            var firstError: Error?
            for _ in 0..<2 {
                do {
                    if let next = try await group.next() {
                        group.cancelAll()
                        return next
                    }
                } catch {
                    firstError = firstError ?? error
                }
            }
            throw firstError ?? URLError(.unknown)
        }
    }

    func reset() {
        reflection = nil
        errorMessage = nil
    }

    private func speakIfExplicitlyAllowed() {
        guard let reflection,
              reflection.responseMode == .watchVoice,
              let voiceResponseURL = reflection.voiceResponseURL else {
            return
        }

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(from: voiceResponseURL)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200..<300).contains(httpResponse.statusCode) else {
                    return
                }
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                let player = try AVAudioPlayer(data: data)
                voicePlayer = player
                player.prepareToPlay()
                player.play()
            } catch {
                return
            }
        }
    }

    private func startSilenceDetection() {
        silenceTask = Task { [weak self] in
            let startDate = Date()
            var quietStartedAt: Date?

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard let self else { return }

                let elapsed = Date().timeIntervalSince(startDate)
                guard elapsed > 5 else {
                    continue
                }

                let power = await MainActor.run {
                    self.recorder.averagePower()
                }
                let quietLimit: TimeInterval = 60

                if power < -55 {
                    quietStartedAt = quietStartedAt ?? Date()
                    if let quietStartedAt, Date().timeIntervalSince(quietStartedAt) > quietLimit {
                        await MainActor.run {
                            self.stopRecording()
                        }
                        return
                    }
                } else {
                    quietStartedAt = nil
                }
            }
        }
    }
}

private enum ReflectionRaceResult {
    case realtime(TurningReflection)
    case fallback(TurningReflection)

    var reflection: TurningReflection {
        switch self {
        case let .realtime(reflection), let .fallback(reflection):
            return reflection
        }
    }

    var source: ReflectionRaceSource {
        switch self {
        case .realtime:
            return .realtime
        case .fallback:
            return .fallback
        }
    }
}

private enum ReflectionRaceSource {
    case realtime
    case fallback
}

private enum DemoMode {
    case none
    case recording
    case card
}

enum WatchShortcutStore {
    static let startRequestedNotification = Notification.Name("presence.watch.startRecording.requested")
    private static let startRecordingKey = "presence.watch.startRecording"
    private static let startRecordingRequestedAtKey = "presence.watch.startRecording.requestedAt"
    private static let darwinStartNotificationName = "presence.watch.startRecording.darwin"

    static func requestStartRecording() {
        shouldStartRecording = true
        NotificationCenter.default.post(name: startRequestedNotification, object: nil)
        postDarwinStartNotification()
    }

    static func addDarwinStartObserver(_ recorder: TurningRecorderViewModel) {
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(recorder).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else {
                    return
                }
                let recorder = Unmanaged<TurningRecorderViewModel>.fromOpaque(observer).takeUnretainedValue()
                Task { @MainActor in
                    recorder.consumePendingShortcutStartRepeatedly()
                }
            },
            darwinStartNotificationName as CFString,
            nil,
            .deliverImmediately
        )
    }

    static func removeDarwinStartObserver(_ recorder: TurningRecorderViewModel) {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(recorder).toOpaque(),
            CFNotificationName(darwinStartNotificationName as CFString),
            nil
        )
    }

    private static func postDarwinStartNotification() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(darwinStartNotificationName as CFString),
            nil,
            nil,
            true
        )
    }

    static var shouldStartRecording: Bool {
        get { UserDefaults.standard.bool(forKey: startRecordingKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: startRecordingKey)
            UserDefaults.standard.set(newValue ? Date().timeIntervalSince1970 : 0, forKey: startRecordingRequestedAtKey)
            UserDefaults.standard.synchronize()
        }
    }

    static var wasRequestedRecently: Bool {
        let timestamp = UserDefaults.standard.double(forKey: startRecordingRequestedAtKey)
        guard timestamp > 0 else {
            return false
        }
        return Date().timeIntervalSince1970 - timestamp < 20
    }
}
