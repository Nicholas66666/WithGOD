import AVFoundation
import Foundation

struct PresenceServiceClient {
    var isConfigured: Bool {
        processEndpoint != nil
    }

    private var processEndpoint: URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "PresenceProcessEndpoint") as? String,
              !rawValue.isEmpty,
              !rawValue.hasPrefix("$(") else {
            return nil
        }
        return URL(string: rawValue)
    }

    private var clientToken: String? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "PresenceClientToken") as? String,
              !rawValue.isEmpty,
              !rawValue.hasPrefix("$(") else {
            return nil
        }
        return rawValue
    }

    func process(audioURL: URL, localRecordID: UUID) async throws -> PresenceRecord? {
        guard let endpoint = processEndpoint else {
            return nil
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        request.setValue(localRecordID.uuidString, forHTTPHeaderField: "X-Presence-Local-Record-ID")
        request.setValue("iphone", forHTTPHeaderField: "X-Presence-Source")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Presence-Request-ID")
        if let duration = Self.audioDuration(for: audioURL) {
            request.setValue(String(duration), forHTTPHeaderField: "X-Presence-Duration-Seconds")
        }
        if let clientToken {
            request.setValue(clientToken, forHTTPHeaderField: "X-Presence-Client-Token")
        }
        request.httpBody = try Data(contentsOf: audioURL)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder.presence.decode(PresenceServerRecordResponse.self, from: data)
        return decoded.record(localRecordID: localRecordID, audioFileName: audioURL.lastPathComponent)
    }

    func fetchRecentRecords(limit: Int = 20) async throws -> [PresenceRecord] {
        guard let endpoint = processEndpoint else {
            return []
        }

        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        guard let url = components?.url else {
            return []
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let clientToken {
            request.setValue(clientToken, forHTTPHeaderField: "X-Presence-Client-Token")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoded = try JSONDecoder.presence.decode(PresenceServerRecordListResponse.self, from: data)
        return decoded.records.map { $0.record() }
    }

    private static func audioDuration(for audioURL: URL) -> TimeInterval? {
        guard let seconds = (try? AVAudioPlayer(contentsOf: audioURL))?.duration else {
            return nil
        }
        guard seconds.isFinite, seconds > 0 else {
            return nil
        }
        return seconds
    }
}

private struct PresenceServerRecordResponse: Decodable {
    let id: UUID?
    let createdAt: Date?
    let transcript: String
    let type: PresenceEntryType
    let summary: String
    let tags: [PresenceTag]
    let watchResponse: WatchInstantResponse
    let detail: PresenceRecordDetail
    let responseMode: PresenceResponseMode
    let audioResponseURL: URL?
    let realtimeDiagnostic: String?
    let timing: PresenceProcessingTiming?
    let durationSeconds: TimeInterval?

    func record(localRecordID: UUID, audioFileName: String) -> PresenceRecord {
        PresenceRecord(
            id: localRecordID,
            createdAt: createdAt ?? Date(),
            source: .server,
            audioFileName: audioFileName,
            audioRemoteURL: audioResponseURL,
            duration: durationSeconds,
            transcript: transcript,
            type: type,
            summary: summary,
            tags: tags,
            watchResponse: watchResponse,
            detail: detail,
            responseMode: responseMode,
            state: .ready,
            processingTiming: timing,
            realtimeDiagnostic: realtimeDiagnostic
        )
    }
}

private struct PresenceServerRecordListResponse: Decodable {
    let records: [PresenceServerSyncedRecord]
}

private struct PresenceServerSyncedRecord: Decodable {
    let id: UUID
    let createdAt: Date
    let transcript: String
    let type: PresenceEntryType
    let summary: String
    let tags: [PresenceTag]
    let watchResponse: WatchInstantResponse
    let detail: PresenceRecordDetail
    let responseMode: PresenceResponseMode
    let state: PresenceRecord.ProcessingState
    let processingTiming: PresenceProcessingTiming?
    let audioFileName: String
    let audioResponseURL: URL?
    let realtimeDiagnostic: String?
    let durationSeconds: TimeInterval?

    func record() -> PresenceRecord {
        PresenceRecord(
            id: id,
            createdAt: createdAt,
            source: .server,
            audioFileName: audioFileName,
            audioRemoteURL: audioResponseURL,
            duration: durationSeconds,
            transcript: transcript,
            type: type,
            summary: summary,
            tags: tags,
            watchResponse: watchResponse,
            detail: detail,
            responseMode: responseMode,
            state: state,
            processingTiming: processingTiming,
            realtimeDiagnostic: realtimeDiagnostic
        )
    }
}
