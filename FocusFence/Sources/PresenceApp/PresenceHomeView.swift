import AVFoundation
import SwiftUI

struct PresenceHomeView: View {
    @EnvironmentObject private var store: PresenceRecordStore

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    overview
                    insightStrip
                    recordsSection
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 18)
            }
            .background(PresenceTheme.background.ignoresSafeArea())
            .navigationTitle("与神同在")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.light, for: .navigationBar)
        }
        .preferredColorScheme(.light)
        .tint(PresenceTheme.gold)
    }

    private var recentRecords: [PresenceRecord] {
        store.records.filter {
            $0.createdAt >= Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        }
    }

    private var topTags: [(key: String, value: Int)] {
        Dictionary(grouping: recentRecords.flatMap(\.tags), by: \.name)
            .mapValues(\.count)
            .sorted { $0.value > $1.value }
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("今天也在祂面前")
                        .font(.title2.weight(.bold))
                    Text("记录、辨明、回应")
                        .font(.subheadline)
                        .foregroundStyle(PresenceTheme.muted)
                }
                Spacer()
                Image(systemName: "applewatch")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PresenceTheme.gold)
                    .frame(width: 40, height: 40)
                    .background(PresenceTheme.gold.opacity(0.14))
                    .clipShape(Circle())
            }

            HStack(spacing: 12) {
                metric("7 天记录", "\(recentRecords.count)")
                metric("已整理", "\(recentRecords.filter { $0.state == .ready }.count)")
                metric("处理中", "\(recentRecords.filter { $0.state != .ready && $0.state != .failed }.count)")
            }
        }
        .cardStyle()
    }

    private var insightStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("最近出现较多")
                .font(.headline.weight(.semibold))

            if topTags.isEmpty {
                Text("多记录几次后，这里会浮现重复主题。")
                    .font(.subheadline)
                    .foregroundStyle(PresenceTheme.muted)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(topTags.prefix(6), id: \.key) { item in
                        Text("\(item.key) \(item.value)")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(PresenceTheme.gold.opacity(0.15))
                            .foregroundStyle(PresenceTheme.ink)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .cardStyle()
    }

    private var recordsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("记录")
                    .font(.title3.weight(.bold))
                Spacer()
                Text("\(store.records.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(PresenceTheme.muted)
            }

            if store.records.isEmpty {
                ContentUnavailableView(
                    "还没有记录",
                    systemImage: "mic.circle",
                    description: Text("按 Action Button 开始第一条记录。")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            } else {
                ForEach(store.records) { record in
                    HStack(alignment: .top, spacing: 10) {
                        NavigationLink {
                            PresenceRecordDetailView(recordID: record.id)
                        } label: {
                            PresenceRecordRow(record: record)
                        }
                        .buttonStyle(.plain)

                        Button(role: .destructive) {
                            store.deleteRecord(record)
                        } label: {
                            Image(systemName: "trash")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.red.opacity(0.82))
                                .frame(width: 34, height: 34)
                                .background(Color.red.opacity(0.1))
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("删除记录")
                    }
                    .cardStyle()
                }
            }
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(PresenceTheme.muted)
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(PresenceTheme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PresenceRecordRow: View {
    let record: PresenceRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: record.type.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(accentColor)
                    .frame(width: 30, height: 30)
                    .background(accentColor.opacity(0.12))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(record.watchResponse.headline)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(PresenceTheme.ink)
                        .lineLimit(1)
                    Text(record.createdAt.formatted(date: .omitted, time: .shortened))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(PresenceTheme.muted)
                    if let durationText {
                        Text(durationText)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(PresenceTheme.muted)
                    }
                }

                Spacer()

                Text(record.type.title)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(accentColor.opacity(0.12))
                    .foregroundStyle(accentColor)
                    .clipShape(Capsule())
            }

            Text(record.summary)
                .font(.subheadline)
                .foregroundStyle(PresenceTheme.ink.opacity(0.82))
                .lineLimit(2)

            if !record.detail.scripture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "book.closed.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(PresenceTheme.gold)
                    Text(record.detail.scripture)
                        .font(.caption)
                        .foregroundStyle(PresenceTheme.muted)
                        .lineLimit(2)
                }
            }

            if record.state != .ready {
                processingStatus
            }

            if !record.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(record.tags.prefix(4)) { tag in
                        Text(tag.name)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(PresenceTheme.softFill)
                            .foregroundStyle(PresenceTheme.muted)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var processingStatus: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: statusSystemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
                Text(record.processingTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
            }

            if record.state != .ready, record.state != .failed {
                ProgressView(value: record.processingProgress)
                    .tint(statusColor)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(statusColor.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var durationText: String? {
        guard let duration = record.duration, duration > 0 else {
            return nil
        }

        let totalSeconds = max(0, Int(duration.rounded()))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    private var statusSystemImage: String {
        switch record.state {
        case .received:
            return "tray.and.arrow.down"
        case .uploading:
            return "arrow.up.circle"
        case .transcribing:
            return "text.bubble"
        case .analyzing:
            return "sparkles"
        case .ready:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }

    private var statusColor: Color {
        switch record.state {
        case .received, .uploading, .transcribing:
            return .blue
        case .analyzing:
            return .orange
        case .ready:
            return .green
        case .failed:
            return .red
        }
    }

    private var accentColor: Color {
        switch record.type {
        case .turning, .prayer:
            return PresenceTheme.gold
        case .idea:
            return .orange
        case .bibleQuestion:
            return .indigo
        case .generalQuestion:
            return .blue
        case .task:
            return .green
        case .journal:
            return .teal
        case .unknown:
            return .secondary
        }
    }
}

private struct PresenceRecordDetailView: View {
    @EnvironmentObject private var store: PresenceRecordStore
    let recordID: UUID

    private var record: PresenceRecord? {
        store.record(withID: recordID)
    }

    var body: some View {
        Group {
            if let record {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        detailHero(record)

                        if record.state != .ready {
                            PresenceProcessingStatusView(record: record)
                                .cardStyle()
                        }

                        if let processingTiming = record.processingTiming {
                            PresenceTimingBreakdownView(timing: processingTiming, state: record.state)
                                .cardStyle()
                        }

                        PresenceAudioPlayerView(localURL: store.audioURL(for: record), remoteURL: record.audioRemoteURL)
                            .cardStyle()

                        if !record.detail.primaryText.isEmpty || !record.detail.answer.isEmpty {
                            detailSection("整理", systemImage: "sparkles") {
                if !record.detail.primaryText.isEmpty {
                    Text(record.detail.primaryText)
                        .font(.body)
                        .foregroundStyle(PresenceTheme.ink)
                }
                                if !record.detail.answer.isEmpty {
                                    Text(record.detail.answer)
                                        .font(.body)
                                        .foregroundStyle(PresenceTheme.ink)
                                }
                            }
                        }

                        if !record.detail.scripture.isEmpty || !record.detail.prayer.isEmpty || !record.detail.action.isEmpty {
                            detailSection("回应", systemImage: "hands.sparkles") {
                                if !record.detail.scripture.isEmpty {
                                    keyValue("经文", record.detail.scripture)
                                }
                                if !record.detail.prayer.isEmpty {
                                    keyValue("祷告", record.detail.prayer)
                                }
                                if !record.detail.action.isEmpty {
                                    keyValue("行动", record.detail.action)
                                }
                            }
                        }

                        if !record.detail.nextSteps.isEmpty {
                            detailSection("下一步", systemImage: "checklist") {
                                ForEach(record.detail.nextSteps, id: \.self) { step in
                                    Label(step, systemImage: "checkmark.circle")
                                        .font(.body)
                                }
                            }
                        }

                        if !record.tags.isEmpty {
                            detailSection("标签", systemImage: "tag") {
                                FlowLayout(spacing: 8) {
                                    ForEach(record.tags) { tag in
                                        Text(tag.name)
                                            .font(.subheadline.weight(.medium))
                                            .padding(.horizontal, 11)
                                            .padding(.vertical, 7)
                                            .background(PresenceTheme.softFill)
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }

                        detailSection("转写", systemImage: "text.quote") {
                            Text(transcriptText(for: record))
                                .font(.body)
                                .foregroundStyle(PresenceTheme.muted)
                        }

                        if let realtimeDiagnostic = record.realtimeDiagnostic,
                           !realtimeDiagnostic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            detailSection("实时诊断", systemImage: "stethoscope") {
                                Text(realtimeDiagnostic)
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(PresenceTheme.muted)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 18)
                }
                .background(PresenceTheme.background.ignoresSafeArea())
            } else {
                ContentUnavailableView("记录不存在", systemImage: "waveform")
            }
        }
        .navigationTitle(record?.createdAt.formatted(date: .omitted, time: .shortened) ?? "记录")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detailHero(_ record: PresenceRecord) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label(record.type.title, systemImage: record.type.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PresenceTheme.gold)
                Spacer()
                Text(record.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(PresenceTheme.muted)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(record.watchResponse.eyebrow)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PresenceTheme.muted)
                Text(record.watchResponse.headline)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(PresenceTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Text(record.watchResponse.body)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PresenceTheme.ink.opacity(0.78))
            }

            if !record.summary.isEmpty {
                Text(record.summary)
                    .font(.body)
                    .foregroundStyle(PresenceTheme.muted)
            }
        }
        .cardStyle()
    }

    private func detailSection<Content: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.headline.weight(.semibold))
                .foregroundStyle(PresenceTheme.ink)
            content()
        }
        .cardStyle()
    }

    private func keyValue(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(PresenceTheme.muted)
            Text(value)
                .font(.body)
                .foregroundStyle(PresenceTheme.ink)
        }
    }

    private func transcriptText(for record: PresenceRecord) -> String {
        if record.transcript == "录音已到达，但保存失败。" {
            return "这条记录还没有完成整理。"
        }
        return record.transcript
    }

    private func tagPlaceholder(for record: PresenceRecord) -> String {
        switch record.state {
        case .ready, .failed:
            return "暂无标签"
        case .received, .uploading, .transcribing, .analyzing:
            return "正在识别"
        }
    }
}

private struct PresenceProcessingStatusView: View {
    let record: PresenceRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: statusSystemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(statusColor)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 3) {
                    Text(record.processingTitle)
                        .font(.headline)
                        .foregroundStyle(PresenceTheme.ink)
                    Text(record.processingNextStep)
                        .font(.subheadline)
                        .foregroundStyle(PresenceTheme.muted)
                }
            }

            ProgressView(value: record.processingProgress)
                .tint(statusColor)

            Text(record.processingDetail)
                .font(.subheadline)
                .foregroundStyle(PresenceTheme.muted)
        }
        .padding(.vertical, 4)
    }

    private var statusSystemImage: String {
        switch record.state {
        case .received:
            return "tray.and.arrow.down"
        case .uploading:
            return "arrow.up.circle"
        case .transcribing:
            return "text.bubble"
        case .analyzing:
            return "sparkles"
        case .ready:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }

    private var statusColor: Color {
        switch record.state {
        case .received, .uploading, .transcribing:
            return .blue
        case .analyzing:
            return .orange
        case .ready:
            return .green
        case .failed:
            return .red
        }
    }
}

private struct PresenceTimingBreakdownView: View {
    let timing: PresenceProcessingTiming
    let state: PresenceRecord.ProcessingState

    private var rows: [(String, Int)] {
        [
            ("上传保存", timing.uploadMs),
            ("生成播放链接", timing.signedUrlMs),
            ("语音转写", timing.transcriptionMs),
            ("主分析", timing.primaryAnalysisMs),
            ("主结果入库", timing.primaryUpsertMs),
            ("主流程总耗时", timing.primaryTotalMs),
            ("一屏回应", timing.quickAnalysisMs),
            ("快速入库", timing.quickUpsertMs),
            ("快速总耗时", timing.quickTotalMs),
            ("完整整理", timing.fullAnalysisMs),
            ("语音回复", timing.fullVoiceMs),
            ("完整入库", timing.fullUpsertMs),
            ("完整总耗时", timing.fullTotalMs)
        ].compactMap { label, value in
            guard let value else { return nil }
            return (label, value)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("处理耗时", systemImage: "timer")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(PresenceTheme.ink)
                Spacer()
                Text(state == .ready ? "已完成" : "更新中")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(state == .ready ? .green : .orange)
            }

            if rows.isEmpty {
                Text("服务端还没有返回耗时数据。")
                    .font(.subheadline)
                    .foregroundStyle(PresenceTheme.muted)
            } else {
                VStack(spacing: 9) {
                    ForEach(rows, id: \.0) { row in
                        HStack {
                            Text(row.0)
                                .font(.subheadline)
                                .foregroundStyle(PresenceTheme.muted)
                            Spacer()
                            Text(format(ms: row.1))
                                .font(.subheadline.monospacedDigit().weight(.semibold))
                                .foregroundStyle(PresenceTheme.ink)
                        }
                    }
                }
            }
        }
    }

    private func format(ms: Int) -> String {
        if ms >= 1_000 {
            return String(format: "%.1fs", Double(ms) / 1_000)
        }
        return "\(ms)ms"
    }
}

private struct PresenceAudioPlayerView: View {
    @StateObject private var player = PresenceAudioPlayer()
    let localURL: URL
    let remoteURL: URL?

    private var localFileExists: Bool {
        FileManager.default.fileExists(atPath: localURL.path)
    }

    private var canPlay: Bool {
        localFileExists || remoteURL != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "waveform")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PresenceTheme.gold)
                    .frame(width: 30, height: 30)

                VStack(alignment: .leading, spacing: 3) {
                    Text(player.sourceTitle(localExists: localFileExists, hasRemote: remoteURL != nil))
                        .font(.headline)
                    Text(player.statusText(localExists: localFileExists, hasRemote: remoteURL != nil))
                        .font(.caption)
                        .foregroundStyle(PresenceTheme.muted)
                }

                Spacer()
            }

            Slider(
                value: Binding(
                    get: { player.currentTime },
                    set: { player.seekPreview(to: $0) }
                ),
                in: 0...max(player.duration, 1),
                onEditingChanged: { editing in
                    player.setSeeking(editing)
                    if !editing {
                        player.seek(to: player.currentTime)
                    }
                }
            )
            .disabled(!player.isReady)

            HStack {
                Text(player.currentTimeText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(PresenceTheme.muted)
                Spacer()
                Text(player.durationText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(PresenceTheme.muted)
            }

            HStack(spacing: 18) {
                Button {
                    player.skip(by: -15)
                } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title3.weight(.semibold))
                        .frame(width: 44, height: 38)
                }
                .buttonStyle(.bordered)
                .disabled(!player.isReady)

                Button {
                    player.toggle(localURL: localURL, remoteURL: remoteURL)
                } label: {
                    Image(systemName: player.buttonSystemImage)
                        .font(.title2.weight(.bold))
                        .frame(width: 74, height: 42)
                }
                .buttonStyle(.borderedProminent)
                .tint(PresenceTheme.gold)
                .disabled(!canPlay || player.isLoading)

                Button {
                    player.skip(by: 15)
                } label: {
                    Image(systemName: "goforward.15")
                        .font(.title3.weight(.semibold))
                        .frame(width: 44, height: 38)
                }
                .buttonStyle(.bordered)
                .disabled(!player.isReady)
            }
            .frame(maxWidth: .infinity)
        }
        .onAppear {
            player.prepare(localURL: localURL, remoteURL: remoteURL)
        }
        .onDisappear {
            player.stop()
        }
    }
}

@MainActor
private final class PresenceAudioPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isPlaying = false
    @Published private(set) var isLoading = false
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var isReady = false

    private var localPlayer: AVAudioPlayer?
    private var progressTask: Task<Void, Never>?
    private var isSeeking = false

    var buttonSystemImage: String {
        if isLoading {
            return "arrow.down.circle"
        }
        return isPlaying ? "pause.fill" : "play.fill"
    }

    var currentTimeText: String {
        format(duration: currentTime)
    }

    var durationText: String {
        duration > 0 ? format(duration: duration) : "--:--"
    }

    func sourceTitle(localExists: Bool, hasRemote: Bool) -> String {
        if isLoading {
            return "正在准备录音"
        }
        if localExists {
            return "本地原始录音"
        }
        if hasRemote {
            return "服务器原始录音"
        }
        return "原始录音同步中"
    }

    func statusText(localExists: Bool, hasRemote: Bool) -> String {
        if isLoading {
            return "正在保存到 iPhone，稍后即可稳定播放。"
        }
        if isReady {
            return "可以播放、暂停、拖动和前后跳转。"
        }
        if hasRemote {
            return "服务器已有录音，点播放会先缓存到本机。"
        }
        return "录音还没有到达 iPhone。"
    }

    func prepare(localURL: URL, remoteURL: URL?) {
        if localPlayer != nil || isLoading {
            return
        }

        guard FileManager.default.fileExists(atPath: localURL.path) else {
            isReady = false
            duration = 0
            currentTime = 0
            if let remoteURL {
                Task {
                    await downloadRemote(remoteURL, localURL: localURL, autoplay: false)
                }
            }
            return
        }

        do {
            let player = try AVAudioPlayer(contentsOf: localURL)
            player.delegate = self
            player.prepareToPlay()
            self.localPlayer = player
            duration = player.duration
            currentTime = player.currentTime
            isReady = true
        } catch {
            isReady = false
        }
    }

    func toggle(localURL: URL, remoteURL: URL?) {
        if localPlayer == nil {
            prepare(localURL: localURL, remoteURL: remoteURL)
        }

        if let localPlayer {
            toggleLocal(localPlayer)
            return
        }

        guard let remoteURL else {
            return
        }

        Task {
            await downloadRemote(remoteURL, localURL: localURL, autoplay: true)
        }
    }

    func stop() {
        localPlayer?.stop()
        localPlayer = nil
        progressTask?.cancel()
        progressTask = nil
        isPlaying = false
        isLoading = false
        isReady = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [])
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            isPlaying = false
            currentTime = 0
            player.currentTime = 0
        }
    }

    func seekPreview(to time: TimeInterval) {
        currentTime = min(max(time, 0), max(duration, 0))
    }

    func setSeeking(_ seeking: Bool) {
        isSeeking = seeking
    }

    func seek(to time: TimeInterval) {
        guard let localPlayer else {
            return
        }
        let target = min(max(time, 0), max(duration, 0))
        localPlayer.currentTime = target
        currentTime = target
    }

    func skip(by delta: TimeInterval) {
        seek(to: currentTime + delta)
    }

    private func toggleLocal(_ player: AVAudioPlayer) {
        if player.isPlaying {
            player.pause()
            isPlaying = false
        } else {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
            isPlaying = true
            startProgressUpdates()
        }
    }

    private func downloadRemote(_ remoteURL: URL, localURL: URL, autoplay: Bool) async {
        guard !isLoading else {
            return
        }

        isLoading = true

        do {
            try FileManager.default.createDirectory(
                at: localURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                isLoading = false
                return
            }

            if FileManager.default.fileExists(atPath: localURL.path) {
                try FileManager.default.removeItem(at: localURL)
            }
            try FileManager.default.moveItem(at: temporaryURL, to: localURL)
            localPlayer = nil
            prepare(localURL: localURL, remoteURL: remoteURL)
            isLoading = false

            if autoplay, let localPlayer {
                toggleLocal(localPlayer)
            }
        } catch {
            isLoading = false
            isReady = false
        }
    }

    private func startProgressUpdates() {
        progressTask?.cancel()
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard let self else {
                    return
                }
                if let localPlayer = self.localPlayer {
                    if !self.isSeeking {
                        self.currentTime = localPlayer.currentTime
                    }
                    self.duration = localPlayer.duration
                    self.isPlaying = localPlayer.isPlaying
                }
            }
        }
    }

    deinit {
        progressTask?.cancel()
    }

    private func format(duration: TimeInterval) -> String {
        guard duration.isFinite, duration > 0 else {
            return "已保存"
        }
        let seconds = Int(duration.rounded())
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

private enum PresenceTheme {
    static let background = Color(red: 0.965, green: 0.955, blue: 0.925)
    static let card = Color.white
    static let ink = Color(red: 0.13, green: 0.12, blue: 0.10)
    static let muted = Color(red: 0.43, green: 0.39, blue: 0.33)
    static let gold = Color(red: 0.72, green: 0.52, blue: 0.18)
    static let softFill = Color(red: 0.91, green: 0.88, blue: 0.80)
}

private extension View {
    func cardStyle() -> some View {
        self
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(PresenceTheme.card)
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.black.opacity(0.04), lineWidth: 1)
                    }
                    .shadow(color: .black.opacity(0.045), radius: 16, x: 0, y: 8)
            }
    }
}
