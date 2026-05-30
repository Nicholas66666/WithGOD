import AVFoundation
import Foundation
import WatchConnectivity

@MainActor
final class PresenceRecordStore: NSObject, ObservableObject {
    @Published private(set) var records: [PresenceRecord] = []

    private let analyzer = PresenceAnalyzer()
    private let serviceClient = PresenceServiceClient()
    private let transcriber = PresenceSpeechTranscriber()
    private let fileManager = FileManager.default
    private let isDemoMode: Bool
    private var syncTask: Task<Void, Never>?
    private var audioDownloadIDs: Set<UUID> = []
    private var serverPrimaryFallbackIDs: Set<UUID> = []

    private var recordsURL: URL {
        documentsDirectory.appendingPathComponent("presence-records.json")
    }

    private var audioDirectory: URL {
        documentsDirectory.appendingPathComponent("PresenceAudio", isDirectory: true)
    }

    private var documentsDirectory: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    override init() {
        isDemoMode = ProcessInfo.processInfo.arguments.contains("--demo-records")
        super.init()
        if isDemoMode {
            records = PresenceRecord.demoRecords
        } else {
            load()
        }
    }

    func startConnectivity() {
        guard WCSession.isSupported() else {
            startServerSync()
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
        startServerSync()
    }

    func processReceivedAudio(
        at temporaryURL: URL,
        recordID: UUID = UUID(),
        createdAt: Date = Date(),
        serverPrimary: Bool = false
    ) {
        do {
            try fileManager.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
            let fileExtension = temporaryURL.pathExtension.isEmpty ? "m4a" : temporaryURL.pathExtension
            let fileName = "\(UUID().uuidString).\(fileExtension)"
            let destinationURL = audioDirectory.appendingPathComponent(fileName)
            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }
            try fileManager.copyItem(at: temporaryURL, to: destinationURL)

            if let existingIndex = records.firstIndex(where: { $0.id == recordID }) {
                records[existingIndex].audioFileName = fileName
                save()
                if serverPrimary {
                    Task {
                        await refreshFromServer()
                    }
                    scheduleServerPrimaryFallback(recordID: recordID, audioURL: destinationURL)
                } else if records[existingIndex].state != .ready {
                    Task {
                        await analyze(recordID: recordID, audioURL: destinationURL)
                    }
                }
                return
            }

            let record = PresenceRecord.pending(id: recordID, audioFileName: fileName, createdAt: createdAt)
            records.insert(record, at: 0)
            save()

            if serverPrimary {
                Task {
                    await refreshFromServer()
                }
                scheduleServerPrimaryFallback(recordID: record.id, audioURL: destinationURL)
            } else {
                Task {
                    await analyze(recordID: record.id, audioURL: destinationURL)
                }
            }
        } catch {
            var pending = PresenceRecord.pending(id: recordID, audioFileName: temporaryURL.lastPathComponent, createdAt: createdAt)
            pending.state = .received
            pending.summary = "已收到来自 Apple Watch 的记录，正在等待服务端整理结果。"
            pending.transcript = "服务端正在处理这条录音。"
            pending.watchResponse = WatchInstantResponse(
                eyebrow: "已记下",
                headline: "等待整理",
                body: "本地录音暂时没同步到 iPhone，但 Watch 已上传服务端，会继续整理。",
                footnote: "请稍等几秒",
                accent: .blue
            )
            pending.detail = PresenceRecordDetail(
                title: "等待服务端整理",
                primaryText: "本地录音暂时没有完整保存到 iPhone，但这不代表失败。iPhone 会继续同步服务端的转写和回应。",
                scripture: "",
                prayer: "",
                action: "等待服务端结果同步。",
                question: "",
                answer: "",
                nextSteps: []
            )

            if let index = records.firstIndex(where: { $0.id == recordID }) {
                guard records[index].state != .ready else {
                    return
                }
                records[index] = pending
            } else {
                records.insert(pending, at: 0)
            }
            save()
        }
    }

    func audioURL(for record: PresenceRecord) -> URL {
        audioDirectory.appendingPathComponent(record.audioFileName)
    }

    func record(withID id: UUID) -> PresenceRecord? {
        records.first { $0.id == id }
    }

    func deleteRecords(at offsets: IndexSet) {
        let removedRecords = offsets.compactMap { index in
            records.indices.contains(index) ? records[index] : nil
        }

        records.remove(atOffsets: offsets)
        save()

        for record in removedRecords {
            deleteLocalArtifacts(for: record)
        }
    }

    func deleteRecord(_ record: PresenceRecord) {
        guard let index = records.firstIndex(where: { $0.id == record.id }) else {
            return
        }

        let removed = records.remove(at: index)
        save()
        deleteLocalArtifacts(for: removed)
    }

    func refreshFromServer() async {
        guard !isDemoMode else {
            return
        }

        do {
            let remoteRecords = try await serviceClient.fetchRecentRecords()
            merge(remoteRecords)
        } catch {
            return
        }
    }

    private func analyze(recordID: UUID, audioURL: URL) async {
        update(recordID) { record in
            record.state = serviceClient.isConfigured ? .uploading : .transcribing
            record.transcript = serviceClient.isConfigured ? "正在上传服务端整理..." : "正在自动转写..."
        }

        if let remoteRecord = try? await serviceClient.process(audioURL: audioURL, localRecordID: recordID) {
            update(recordID) { record in
                record = remoteRecord
            }
            await cacheRemoteAudioIfNeeded(for: recordID)
            return
        }

        update(recordID) { record in
            record.state = .transcribing
            record.transcript = "正在自动转写..."
        }

        let transcript = await transcriber.transcribe(audioURL: audioURL)
        update(recordID) { record in
            record.transcript = transcript
            record.state = .analyzing
        }

        let analysis = analyzer.analyze(transcript: transcript)
        update(recordID) { record in
            record.type = analysis.type
            record.summary = analysis.summary
            record.tags = analysis.tags
            record.watchResponse = analysis.watchResponse
            record.detail = analysis.detail
            record.responseMode = analysis.responseMode
            record.state = .ready
        }
    }

    private func startServerSync() {
        guard !isDemoMode, syncTask == nil else {
            return
        }

        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshFromServer()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func scheduleServerPrimaryFallback(recordID: UUID, audioURL: URL) {
        guard !serverPrimaryFallbackIDs.contains(recordID) else {
            return
        }

        serverPrimaryFallbackIDs.insert(recordID)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard let self else {
                return
            }
            await self.refreshFromServer()
            guard let record = self.records.first(where: { $0.id == recordID }),
                  record.state != .ready,
                  self.fileManager.fileExists(atPath: audioURL.path) else {
                self.serverPrimaryFallbackIDs.remove(recordID)
                return
            }

            await self.analyze(recordID: recordID, audioURL: audioURL)
            self.serverPrimaryFallbackIDs.remove(recordID)
        }
    }

    private func merge(_ remoteRecords: [PresenceRecord]) {
        var didChange = false

        for remoteRecord in remoteRecords {
            if let index = records.firstIndex(where: { $0.id == remoteRecord.id }) {
                records[index] = merged(existing: records[index], remote: remoteRecord, keepID: records[index].id)
                didChange = true
                continue
            }

            if let index = records.firstIndex(where: { shouldReplaceLocalPlaceholder($0, with: remoteRecord) }) {
                records[index] = merged(existing: records[index], remote: remoteRecord, keepID: records[index].id)
                didChange = true
                continue
            }

            if records.contains(where: { looksLikeSameServerRecord($0, remoteRecord) }) {
                continue
            }

            records.append(remoteRecord)
            didChange = true
        }

        if didChange {
            records.sort { $0.createdAt > $1.createdAt }
            save()
        }

        for record in records where record.audioRemoteURL != nil {
            Task {
                await cacheRemoteAudioIfNeeded(for: record.id)
            }
        }
    }

    private func merged(existing: PresenceRecord, remote: PresenceRecord, keepID id: UUID) -> PresenceRecord {
        var merged = remote
        merged.id = id

        let localURL = audioURL(for: existing)
        if fileManager.fileExists(atPath: localURL.path) {
            merged.audioFileName = existing.audioFileName
        }
        if merged.duration == nil {
            merged.duration = existing.duration
        }

        return merged
    }

    private func shouldReplaceLocalPlaceholder(_ local: PresenceRecord, with remote: PresenceRecord) -> Bool {
        guard local.source == .watch, local.state != .ready else {
            return false
        }
        return abs(local.createdAt.timeIntervalSince(remote.createdAt)) < 180
    }

    private func looksLikeSameServerRecord(_ lhs: PresenceRecord, _ rhs: PresenceRecord) -> Bool {
        guard abs(lhs.createdAt.timeIntervalSince(rhs.createdAt)) < 10 else {
            return false
        }
        if !lhs.transcript.isEmpty, lhs.transcript == rhs.transcript {
            return true
        }
        return lhs.summary == rhs.summary && lhs.watchResponse.headline == rhs.watchResponse.headline
    }

    private func cacheRemoteAudioIfNeeded(for recordID: UUID) async {
        guard let record = records.first(where: { $0.id == recordID }),
              let remoteURL = record.audioRemoteURL,
              !fileManager.fileExists(atPath: audioURL(for: record).path),
              !audioDownloadIDs.contains(recordID) else {
            return
        }

        audioDownloadIDs.insert(recordID)
        defer {
            audioDownloadIDs.remove(recordID)
        }

        do {
            try fileManager.createDirectory(at: audioDirectory, withIntermediateDirectories: true)
            let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                return
            }

            let destinationURL = audioURL(for: record)
            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
            if let duration = audioDuration(for: destinationURL),
               let index = records.firstIndex(where: { $0.id == recordID }) {
                records[index].duration = duration
                save()
            } else {
                objectWillChange.send()
            }
        } catch {
            return
        }
    }

    private func audioDuration(for audioURL: URL) -> TimeInterval? {
        guard let seconds = (try? AVAudioPlayer(contentsOf: audioURL))?.duration else {
            return nil
        }
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }
        return seconds
    }

    private func update(_ id: UUID, mutate: (inout PresenceRecord) -> Void) {
        guard let index = records.firstIndex(where: { $0.id == id }) else {
            return
        }
        mutate(&records[index])
        save()
    }

    private func deleteLocalArtifacts(for record: PresenceRecord) {
        let localURL = audioURL(for: record)
        if fileManager.fileExists(atPath: localURL.path) {
            try? fileManager.removeItem(at: localURL)
        }
        audioDownloadIDs.remove(record.id)
        serverPrimaryFallbackIDs.remove(record.id)
    }

    private func load() {
        guard let data = try? Data(contentsOf: recordsURL),
              let decoded = try? JSONDecoder.presence.decode([PresenceRecord].self, from: data) else {
            records = []
            return
        }
        records = decoded.map(normalized).sorted { $0.createdAt > $1.createdAt }
        save()
    }

    private func normalized(_ record: PresenceRecord) -> PresenceRecord {
        var normalized = record
        if normalized.transcript == "录音已到达，但保存失败。" {
            normalized.summary = "这条记录还没有完成整理。"
            normalized.transcript = "这条记录还没有完成整理。"
        }
        if normalized.duration == nil {
            let localURL = audioURL(for: normalized)
            if fileManager.fileExists(atPath: localURL.path) {
                normalized.duration = audioDuration(for: localURL)
            }
        }
        return normalized
    }

    private func save() {
        guard !isDemoMode else {
            return
        }
        guard let data = try? JSONEncoder.presence.encode(records) else {
            return
        }
        try? data.write(to: recordsURL, options: [.atomic])
    }
}

extension PresenceRecordStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(
        _ session: WCSession,
        didReceive file: WCSessionFile
    ) {
        let createdAt = file.metadata?["createdAt"] as? Date ?? Date()
        let recordID = (file.metadata?["recordID"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
        let rawServerPrimary = file.metadata?["serverPrimary"]
        let serverPrimary = (rawServerPrimary as? Bool) ?? (rawServerPrimary as? NSNumber)?.boolValue ?? false

        Task { @MainActor in
            self.processReceivedAudio(
                at: file.fileURL,
                recordID: recordID,
                createdAt: createdAt,
                serverPrimary: serverPrimary
            )
        }
    }
}

extension JSONEncoder {
    static var presence: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

extension JSONDecoder {
    static var presence: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            if let date = ISO8601DateFormatter.presenceWithFractionalSeconds.date(from: value)
                ?? ISO8601DateFormatter.presence.date(from: value) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }
}

private extension ISO8601DateFormatter {
    static let presence: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let presenceWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
