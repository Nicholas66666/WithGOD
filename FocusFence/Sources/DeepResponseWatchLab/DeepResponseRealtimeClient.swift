import Foundation

enum DeepResponseClientError: LocalizedError {
    case missingEndpoint

    var errorDescription: String? {
        switch self {
        case .missingEndpoint:
            return "DeepResponse server endpoint is not configured."
        }
    }
}

@MainActor
final class DeepResponseRealtimeClient: ObservableObject {
    private static let httpFastPollNanoseconds: UInt64 = 40_000_000
    private static let httpSteadyPollNanoseconds: UInt64 = 120_000_000
    private static let httpFastPollWaitMilliseconds = 800
    private static let httpSteadyPollWaitMilliseconds = 250

    @Published private(set) var lastError: String?
    @Published private(set) var lastErrorCode: String?
    @Published private(set) var lastHealthStatus: String?
    @Published private(set) var endpointDisplay: String = (try? endpointURL().absoluteString) ?? "Endpoint missing"
    @Published private(set) var connectionStage = "idle"
    @Published private(set) var receivedAudioBytes = 0
    @Published private(set) var receivedAudioChunks = 0
    @Published private(set) var uploadedAudioChunks = 0
    @Published private(set) var uploadedAudioBytes = 0
    @Published private(set) var uploadedEncodedBytes = 0
    @Published private(set) var httpSessionID: String?
    @Published private(set) var lastTurnTranscript: String?
    @Published private(set) var lastTurnText: String?
    @Published private(set) var lastTurnFirstText: String?
    @Published private(set) var lastTurnFollowupText: String?
    @Published private(set) var lastTurnTotalMs: Int?
    @Published private(set) var lastTurnTiming: DeepResponseTiming?
    @Published private(set) var lastClientTimingText: String?
    @Published private(set) var lastAbortTimingText: String?
    @Published private(set) var lastSessionEndText: String?
    @Published private(set) var lastMemoryStatusText: String?
    @Published private(set) var canAbortHTTPSessionTurn = false
    @Published private(set) var isHTTPSessionPlaybackActive = false
    @Published private(set) var isHTTPSessionEnded = false
    var onHTTPSessionPlaybackDrained: (() -> Void)?

    private let player = DeepResponseAudioPlayer()
    private var httpTurnID: String?
    private var httpGenerationID: String?
    private var httpAudioSeq = 0
    private var httpEventCursor = 0
    private var httpOutputAudioCursor = 0
    private var httpUploadQueue: [Data] = []
    private var httpPendingUploadAudio = Data()
    private var httpUploadFailureCount = 0
    private var isDrainingHTTPUploads = false
    private var httpStopStartedAt: Date?
    private var httpUploadDrainMs: Int?
    private var httpInputStopResponseMs: Int?
    private var httpFirstTextMs: Int?
    private var httpFirstAudioMs: Int?
    private var httpAbortStartedAt: Date?
    private var httpAbortLocalStopMs: Int?
    private var httpAbortServerStopMs: Int?
    private var httpStaleAudioAfterAbortCount = 0
    private let httpUploadBatchBytes = 32_000
    private var httpSessionPollTask: Task<Void, Error>?
    private var isAbortingHTTPSessionTurn = false
    private var canceledHTTPGenerationIDs = Set<String>()

    init() {
        player.onPlaybackDrained = { [weak self] in
            Task { @MainActor in
                self?.isHTTPSessionPlaybackActive = false
                self?.onHTTPSessionPlaybackDrained?()
            }
        }
    }

    func checkHealth() async {
        do {
            connectionStage = "health:start"
            let url = try Self.healthURL()
            let (_, response) = try await URLSession.shared.data(from: url)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Health \(statusCode)"
            lastError = statusCode == 200 ? nil : "Health \(statusCode)"
            connectionStage = "health:\(statusCode)"
        } catch {
            lastHealthStatus = "Health fail"
            setError("Health: \(Self.describe(error))", error: error)
            connectionStage = "health:fail"
        }
    }

    func runHTTPProbe() async {
        do {
            connectionStage = "http_probe:start"
            var request = URLRequest(url: try Self.httpProbeURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")

            let payload = Data("watch-probe".utf8)
            let (_, response) = try await URLSession.shared.upload(for: request, from: payload)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Probe \(statusCode)"
            lastError = statusCode == 200 ? nil : "Probe \(statusCode)"
            lastErrorCode = nil
            connectionStage = "http_probe:\(statusCode)"
        } catch {
            lastHealthStatus = "Probe fail"
            setError("Probe: \(Self.describe(error))", error: error)
            connectionStage = "http_probe:fail"
        }
    }

    func runHTTPEcho(_ audio: Data) async {
        do {
            connectionStage = "http_echo:start"
            var request = URLRequest(url: try Self.httpEchoURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Echo \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Echo \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_echo:\(statusCode)"
                return
            }
            lastError = nil
            lastErrorCode = nil
            receivedAudioBytes += data.count
            receivedAudioChunks += 1
            player.enqueuePCM16(data, sampleRate: 16_000)
            connectionStage = "http_echo:200"
        } catch {
            lastHealthStatus = "Echo fail"
            setError("Echo: \(Self.describe(error))", error: error)
            connectionStage = "http_echo:fail"
        }
    }

    func runHTTPEchoFixture() async {
        let audio = Self.fixturePCMChunks(durationSeconds: 1, chunkMilliseconds: 1_000)
            .reduce(into: Data()) { result, chunk in
                result.append(chunk)
            }
        await runHTTPEcho(audio)
    }

    func runHTTPTurn(_ audio: Data) async {
        do {
            connectionStage = "http_turn:start"
            var request = URLRequest(url: try Self.httpTurnURL())
            request.httpMethod = "POST"
            request.timeoutInterval = 60
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Deep-Response-Session")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Turn \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Turn \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_turn:\(statusCode)"
                return
            }
            let turn = try JSONDecoder().decode(DeepResponseHTTPTurnResponse.self, from: data)
            guard turn.ok, let audioData = Data(base64Encoded: turn.audioBase64) else {
                lastError = "Bad HTTP turn response"
                lastErrorCode = nil
                connectionStage = "http_turn:bad_response"
                return
            }
            lastError = nil
            lastErrorCode = nil
            lastTurnTranscript = turn.transcript.isEmpty ? nil : turn.transcript
            lastTurnText = turn.text.isEmpty ? nil : turn.text
            lastTurnTotalMs = turn.timing?.voicePipelineTotalMs
            lastTurnTiming = turn.timing
            receivedAudioBytes += audioData.count
            receivedAudioChunks += 1
            player.enqueuePCM16(audioData, sampleRate: turn.sampleRate)
            connectionStage = "http_turn:200"
        } catch {
            lastHealthStatus = "Turn fail"
            setError("Turn: \(Self.describe(error))", error: error)
            connectionStage = "http_turn:fail"
        }
    }

    func runSegmentedHTTPTurn(_ audio: Data) async {
        do {
            connectionStage = "http_turn_v2:start"
            var request = URLRequest(url: try Self.httpTurnV2URL())
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Deep-Response-Session")

            let (data, response) = try await URLSession.shared.upload(for: request, from: audio)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Turn2 \(statusCode)"
            guard statusCode == 200 else {
                lastError = "Turn2 \(statusCode)"
                lastErrorCode = nil
                connectionStage = "http_turn_v2:\(statusCode)"
                return
            }
            let turn = try JSONDecoder().decode(DeepResponseSegmentedHTTPTurnResponse.self, from: data)
            guard turn.ok else {
                lastError = "Bad HTTP turn v2 response"
                lastErrorCode = nil
                connectionStage = "http_turn_v2:bad_response"
                return
            }

            lastError = nil
            lastErrorCode = nil
            lastTurnTranscript = turn.transcript.isEmpty ? nil : turn.transcript
            lastTurnFirstText = turn.segment(kind: "first")?.text
            lastTurnFollowupText = turn.segment(kind: "followup")?.text
            lastTurnText = [lastTurnFirstText, lastTurnFollowupText]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if lastTurnText?.isEmpty == true {
                lastTurnText = nil
            }
            lastTurnTotalMs = turn.timing?.voicePipelineTotalMs
            lastTurnTiming = turn.timing

            for segment in turn.segments {
                guard let audioData = Data(base64Encoded: segment.audioBase64), !audioData.isEmpty else {
                    continue
                }
                receivedAudioBytes += audioData.count
                receivedAudioChunks += 1
                player.enqueuePCM16(audioData, sampleRate: turn.sampleRate)
            }
            connectionStage = "http_turn_v2:200"
        } catch {
            lastHealthStatus = "Turn2 fail"
            setError("Turn2: \(Self.describe(error))", error: error)
            connectionStage = "http_turn_v2:fail"
        }
    }

    func startHTTPSessionTurn() async throws {
        let sessionID = try await ensureHTTPSession()
        httpTurnID = "turn-\(UUID().uuidString)"
        httpGenerationID = nil
        httpAudioSeq = 0
        httpUploadQueue = []
        httpPendingUploadAudio = Data()
        httpUploadFailureCount = 0
        isDrainingHTTPUploads = false
        httpStopStartedAt = nil
        httpUploadDrainMs = nil
        httpInputStopResponseMs = nil
        httpFirstTextMs = nil
        httpFirstAudioMs = nil
        httpAbortStartedAt = nil
        httpAbortLocalStopMs = nil
        httpAbortServerStopMs = nil
        httpStaleAudioAfterAbortCount = 0
        isHTTPSessionPlaybackActive = false
        isHTTPSessionEnded = false
        canAbortHTTPSessionTurn = false
        isAbortingHTTPSessionTurn = false
        httpSessionPollTask?.cancel()
        httpSessionPollTask = Task { [weak self] in
            guard let self else { return }
            try await self.pollHTTPSessionUntilDone(sessionID: sessionID)
        }
        uploadedAudioChunks = 0
        uploadedAudioBytes = 0
        uploadedEncodedBytes = 0
        receivedAudioChunks = 0
        receivedAudioBytes = 0
        lastError = nil
        lastErrorCode = nil
        lastTurnTranscript = nil
        lastTurnText = nil
        lastTurnFirstText = nil
        lastTurnFollowupText = nil
        lastTurnTiming = nil
        lastTurnTotalMs = nil
        lastClientTimingText = nil
        lastAbortTimingText = nil
        connectionStage = "http_session:ready"
    }

    private func ensureHTTPSession() async throws -> String {
        if let httpSessionID {
            connectionStage = "http_session:reuse"
            return httpSessionID
        }

        connectionStage = "http_session:create"
        var request = URLRequest(url: try Self.httpSessionURL(path: "/deep-response/sessions"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
        request.httpBody = #"{"sampleRate":16000,"pipelineMode":"cascade"}"#.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        lastHealthStatus = "Session \(statusCode)"
        guard statusCode == 200 else {
            throw NSError(domain: "DeepResponseHTTP", code: statusCode, userInfo: [
                NSLocalizedDescriptionKey: "Session \(statusCode)"
            ])
        }
        let created = try JSONDecoder().decode(DeepResponseHTTPSessionCreateResponse.self, from: data)
        guard created.ok else {
            throw NSError(domain: "DeepResponseHTTP", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Bad session response"
            ])
        }
        httpSessionID = created.sessionID
        httpEventCursor = 0
        httpOutputAudioCursor = 0
        lastSessionEndText = nil
        lastMemoryStatusText = nil
        return created.sessionID
    }

    func enqueueHTTPSessionAudio(_ audio: Data) {
        guard !audio.isEmpty else {
            return
        }
        httpPendingUploadAudio.append(audio)
        while httpPendingUploadAudio.count >= httpUploadBatchBytes {
            let chunk = httpPendingUploadAudio.prefix(httpUploadBatchBytes)
            queueHTTPSessionUpload(Data(chunk))
            httpPendingUploadAudio.removeFirst(chunk.count)
        }
    }

    private func flushHTTPSessionAudio() {
        guard !httpPendingUploadAudio.isEmpty else {
            return
        }
        queueHTTPSessionUpload(httpPendingUploadAudio)
        httpPendingUploadAudio = Data()
    }

    private func queueHTTPSessionUpload(_ audio: Data) {
        guard !audio.isEmpty else {
            return
        }
        httpUploadQueue.append(audio)
        guard !isDrainingHTTPUploads else {
            return
        }
        isDrainingHTTPUploads = true
        Task { [weak self] in
            await self?.drainHTTPSessionUploadQueue()
        }
    }

    private func drainHTTPSessionUploadQueue() async {
        while !httpUploadQueue.isEmpty {
            let audio = httpUploadQueue.removeFirst()
            let uploaded = await uploadHTTPSessionAudio(audio)
            if !uploaded {
                httpUploadFailureCount += 1
            }
        }
        isDrainingHTTPUploads = false
        if !httpUploadQueue.isEmpty {
            isDrainingHTTPUploads = true
            Task { [weak self] in
                await self?.drainHTTPSessionUploadQueue()
            }
        }
    }

    private func uploadHTTPSessionAudio(_ audio: Data) async -> Bool {
        guard let sessionID = httpSessionID,
              let turnID = httpTurnID,
              !audio.isEmpty else {
            return true
        }
        let seq = httpAudioSeq
        httpAudioSeq += 1
        for attempt in 1...3 {
            do {
                let uploadBody = audio
                let path = "/deep-response/sessions/\(sessionID)/audio"
                var request = URLRequest(url: try Self.httpSessionURL(path: path))
                request.httpMethod = "POST"
                request.timeoutInterval = 20
                request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                request.setValue(turnID, forHTTPHeaderField: "X-Deep-Response-Turn")
                request.setValue(String(seq), forHTTPHeaderField: "X-Deep-Response-Seq")
                request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
                let (_, response) = try await URLSession.shared.upload(for: request, from: uploadBody)
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                if statusCode == 200 {
                    uploadedAudioChunks += 1
                    uploadedAudioBytes += audio.count
                    uploadedEncodedBytes += uploadBody.count
                    connectionStage = "http_session:up \(uploadedAudioChunks)"
                    return true
                }
                lastError = "Upload \(statusCode)"
                connectionStage = "http_session:upload_\(statusCode)"
            } catch {
                setError("Upload: \(Self.describe(error))", error: error)
                connectionStage = "http_session:upload_fail \(attempt)"
            }

            if attempt < 3 {
                try? await Task.sleep(nanoseconds: UInt64(attempt) * 300_000_000)
            }
        }
        return false
    }

    func finishHTTPSessionTurn() async {
        guard let sessionID = httpSessionID,
              let turnID = httpTurnID else {
            lastError = "No HTTP session"
            return
        }
        do {
            let stopStartedAt = Date()
            httpStopStartedAt = stopStartedAt
            httpFirstAudioMs = nil
            lastClientTimingText = nil
            connectionStage = "http_session:stop"
            flushHTTPSessionAudio()
            await waitForPendingHTTPSessionUploads()
            let uploadMs = Self.elapsedMs(since: stopStartedAt)
            httpUploadDrainMs = uploadMs
            updateHTTPClientTimingText()
            guard httpUploadFailureCount == 0 else {
                lastError = "Upload failed \(httpUploadFailureCount)"
                connectionStage = "http_session:upload_failed"
                return
            }
            var request = URLRequest(url: try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/input-stop"))
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            request.httpBody = #"{"turnID":"\#(turnID)"}"#.data(using: .utf8)
            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Session \(statusCode)"
            guard statusCode == 200 else {
                lastError = "InputStop \(statusCode)"
                connectionStage = "http_session:stop_\(statusCode)"
                return
            }
            let stopped = try JSONDecoder().decode(DeepResponseHTTPSessionInputStopResponse.self, from: data)
            httpGenerationID = stopped.generationID
            canAbortHTTPSessionTurn = true
            let inputStopMs = Self.elapsedMs(since: stopStartedAt)
            httpInputStopResponseMs = inputStopMs
            updateHTTPClientTimingText()
            try await httpSessionPollTask?.value
            let doneMs = Self.elapsedMs(since: stopStartedAt)
            updateHTTPClientTimingText(doneMs: doneMs)
            canAbortHTTPSessionTurn = false
            connectionStage = "http_session:done"
        } catch is CancellationError {
            if isAbortingHTTPSessionTurn {
                canAbortHTTPSessionTurn = false
                connectionStage = "http_session:aborted"
            } else {
                setError("Session: cancelled")
                connectionStage = "http_session:cancelled"
            }
        } catch {
            setError("Session: \(Self.describe(error))", error: error)
            canAbortHTTPSessionTurn = false
            connectionStage = "http_session:fail"
        }
    }

    func beginAbortHTTPSessionTurn() -> Task<Void, Never>? {
        guard let sessionID = httpSessionID else {
            return nil
        }

        let abortStartedAt = Date()
        let abortTurnID = httpTurnID ?? ""
        let abortGenerationID = httpGenerationID ?? ""
        httpAbortStartedAt = abortStartedAt
        httpAbortLocalStopMs = nil
        httpAbortServerStopMs = nil
        httpStaleAudioAfterAbortCount = 0
        isAbortingHTTPSessionTurn = true
        canAbortHTTPSessionTurn = false
        if !abortGenerationID.isEmpty {
            canceledHTTPGenerationIDs.insert(abortGenerationID)
        }
        isHTTPSessionPlaybackActive = false
        player.stop()
        httpAbortLocalStopMs = Self.elapsedMs(since: abortStartedAt)
        updateHTTPAbortTimingText()
        httpSessionPollTask?.cancel()
        httpSessionPollTask = nil
        connectionStage = "http_session:abort_local"

        return Task { [weak self] in
            await self?.finishHTTPSessionAbort(
                sessionID: sessionID,
                abortTurnID: abortTurnID,
                abortGenerationID: abortGenerationID,
                abortStartedAt: abortStartedAt
            )
        }
    }

    func abortHTTPSessionTurn() async {
        guard let abortTask = beginAbortHTTPSessionTurn() else {
            return
        }
        await abortTask.value
    }

    private func finishHTTPSessionAbort(
        sessionID: String,
        abortTurnID: String,
        abortGenerationID: String,
        abortStartedAt: Date
    ) async {
        do {
            var request = URLRequest(url: try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/abort"))
            request.httpMethod = "POST"
            request.timeoutInterval = 10
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("DeepLab-watchOS", forHTTPHeaderField: "X-Deep-Response-Client")
            let body = DeepResponseHTTPSessionAbortRequest(
                turnID: abortTurnID,
                generationID: abortGenerationID,
                reason: "watch_local_abort"
            )
            request.httpBody = try JSONEncoder().encode(body)
            let (_, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            lastHealthStatus = "Abort \(statusCode)"
            httpAbortServerStopMs = Self.elapsedMs(since: abortStartedAt)
            updateHTTPAbortTimingText()
            if statusCode == 200 {
                lastError = nil
                lastErrorCode = nil
                connectionStage = "http_session:aborted"
            } else {
                lastError = "Abort \(statusCode)"
                connectionStage = "http_session:abort_\(statusCode)"
            }
        } catch {
            setError("Abort: \(Self.describe(error))", error: error)
            connectionStage = "http_session:abort_fail"
        }
    }

    func runHTTPSessionFixtureTurn() async {
        do {
            try await startHTTPSessionTurn()
            connectionStage = "http_fixture:upload"
            for chunk in Self.fixturePCMChunks(durationSeconds: 4, chunkMilliseconds: 500) {
                enqueueHTTPSessionAudio(chunk)
                try await Task.sleep(nanoseconds: 30_000_000)
            }
            await finishHTTPSessionTurn()
        } catch {
            setError("Fixture: \(Self.describe(error))", error: error)
            connectionStage = "http_fixture:fail"
        }
    }

    private func waitForPendingHTTPSessionUploads() async {
        while isDrainingHTTPUploads || !httpUploadQueue.isEmpty {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    private func pollHTTPSessionUntilDone(sessionID: String) async throws {
        let startedAt = Date()
        var isDone = false
        while !isDone && Date().timeIntervalSince(startedAt) < 120 {
            let waitMilliseconds = Self.httpPollWaitMilliseconds(hasReceivedFirstAudio: httpFirstAudioMs != nil)
            let eventsURL = try Self.httpSessionURL(path: "/deep-response/sessions/\(sessionID)/events?cursor=\(httpEventCursor)&wait_ms=\(waitMilliseconds)")
            var audioPath = "/deep-response/sessions/\(sessionID)/audio?cursor=\(httpOutputAudioCursor)&wait_ms=\(waitMilliseconds)"
            if let httpGenerationID {
                audioPath += "&generation_id=\(httpGenerationID)"
            }
            let audioURL = try Self.httpSessionURL(path: audioPath)
            async let eventResult = URLSession.shared.data(from: eventsURL)
            async let audioResult = URLSession.shared.data(from: audioURL)

            let (eventData, eventResponse) = try await eventResult
            if (eventResponse as? HTTPURLResponse)?.statusCode == 200 {
                let batch = try JSONDecoder().decode(DeepResponseHTTPSessionEventsResponse.self, from: eventData)
                httpEventCursor = batch.nextCursor
                for event in batch.events {
                    handleHTTPSessionEvent(event)
                    if event.type == "turn_done" || event.type == "session_end" {
                        isDone = true
                    }
                }
            }

            let (audioData, audioResponse) = try await audioResult
            if (audioResponse as? HTTPURLResponse)?.statusCode == 200 {
                let batch = try JSONDecoder().decode(DeepResponseHTTPSessionAudioResponse.self, from: audioData)
                httpOutputAudioCursor = batch.nextCursor
                var playbackAudio = Data()
                var playbackSampleRate: Double?
                for chunk in batch.chunks {
                    if canceledHTTPGenerationIDs.contains(chunk.generationID) {
                        httpStaleAudioAfterAbortCount += 1
                        updateHTTPAbortTimingText()
                        continue
                    }
                    if let currentGenerationID = httpGenerationID,
                       chunk.generationID != currentGenerationID {
                        continue
                    }
                    guard let data = Data(base64Encoded: chunk.audioBase64), !data.isEmpty else {
                        continue
                    }
                    receivedAudioChunks += 1
                    receivedAudioBytes += data.count
                    playbackSampleRate = chunk.sampleRate ?? playbackSampleRate ?? 24_000
                    playbackAudio.append(data)
                }
                if !playbackAudio.isEmpty {
                    if httpFirstAudioMs == nil, let stopStartedAt = httpStopStartedAt {
                        httpFirstAudioMs = Self.elapsedMs(since: stopStartedAt)
                        updateHTTPClientTimingText()
                    }
                    isHTTPSessionPlaybackActive = true
                    player.enqueuePCM16(playbackAudio, sampleRate: playbackSampleRate ?? 24_000)
                }
            }

            if !isDone {
                try await Task.sleep(nanoseconds: Self.httpPollDelayNanoseconds(hasReceivedFirstAudio: httpFirstAudioMs != nil))
            }
        }
        if !isDone {
            throw NSError(domain: "DeepResponseHTTP", code: -1001, userInfo: [
                NSLocalizedDescriptionKey: "HTTP session timeout"
            ])
        }
    }

    private static func httpPollDelayNanoseconds(hasReceivedFirstAudio: Bool) -> UInt64 {
        hasReceivedFirstAudio ? httpSteadyPollNanoseconds : httpFastPollNanoseconds
    }

    private static func httpPollWaitMilliseconds(hasReceivedFirstAudio: Bool) -> Int {
        hasReceivedFirstAudio ? httpSteadyPollWaitMilliseconds : httpFastPollWaitMilliseconds
    }

    private func handleHTTPSessionEvent(_ event: DeepResponseHTTPSessionEvent) {
        if event.type == "transcript_final" {
            lastTurnTranscript = event.text
        } else if event.type == "assistant_text_delta" {
            if event.segment == "followup" {
                lastTurnFollowupText = Self.appendText(lastTurnFollowupText, event.delta)
            } else {
                lastTurnFirstText = Self.appendText(lastTurnFirstText, event.delta)
                if httpFirstTextMs == nil, let stopStartedAt = httpStopStartedAt {
                    httpFirstTextMs = Self.elapsedMs(since: stopStartedAt)
                    updateHTTPClientTimingText()
                }
            }
            lastTurnText = [lastTurnFirstText, lastTurnFollowupText]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        } else if event.type == "timing" {
            lastTurnTiming = event.timing
            lastTurnTotalMs = event.timing?.voicePipelineTotalMs
        } else if event.type == "session_end" {
            isHTTPSessionEnded = true
            canAbortHTTPSessionTurn = false
            lastSessionEndText = event.reason.map { "end \($0)" } ?? "end"
            connectionStage = event.reason.map { "http_session:ended \($0)" } ?? "http_session:ended"
        } else if event.type == "memory_candidate" {
            lastMemoryStatusText = Self.memoryStatusText(for: event)
        } else if event.type == "error" {
            lastError = event.message ?? "HTTP session error"
        }
    }

    private func updateHTTPClientTimingText(doneMs: Int? = nil) {
        var parts: [String] = []
        if let httpUploadDrainMs {
            parts.append("upl \(httpUploadDrainMs)")
        }
        if let httpInputStopResponseMs {
            parts.append("stop \(httpInputStopResponseMs)")
        }
        if let httpFirstTextMs {
            parts.append("txt \(httpFirstTextMs)")
        }
        if let httpFirstAudioMs {
            parts.append("first \(httpFirstAudioMs)")
        }
        if let doneMs {
            parts.append("done \(doneMs)")
        }
        lastClientTimingText = parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func updateHTTPAbortTimingText() {
        var parts: [String] = []
        if let httpAbortLocalStopMs {
            parts.append("local \(httpAbortLocalStopMs)")
        }
        if let httpAbortServerStopMs {
            parts.append("server \(httpAbortServerStopMs)")
        }
        parts.append("stale \(httpStaleAudioAfterAbortCount)")
        lastAbortTimingText = parts.joined(separator: " · ")
    }

    private static func appendText(_ current: String?, _ delta: String?) -> String? {
        guard let delta, !delta.isEmpty else {
            return current
        }
        return (current ?? "") + delta
    }

    private static func memoryStatusText(for event: DeepResponseHTTPSessionEvent) -> String {
        let persistedText = event.persisted == true ? "saved" : "memory"
        let storeText = event.store.map { " \($0)" } ?? ""
        let turnText = event.turnCount.map { " \($0)t" } ?? ""
        return "\(persistedText)\(storeText)\(turnText)"
    }

    fileprivate func setError(_ message: String, error: Error? = nil) {
        lastError = message
        lastErrorCode = error.map(Self.compactCode)
    }

    private static func endpointURL() throws -> URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "DeepResponseRealtimeEndpoint") as? String,
           !configured.isEmpty,
           !configured.hasPrefix("$("),
           let url = URL(string: configured) {
            return url
        }
        guard let fallback = URL(string: "https://withgod-deep-response.onrender.com") else {
            throw DeepResponseClientError.missingEndpoint
        }
        return fallback
    }

    private static func healthURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        components?.path = "/health"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpProbeURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        components?.path = "/debug/http-probe"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpEchoURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        components?.path = "/debug/http-echo"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpTurnURL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        components?.path = "/deep-response/http-turn"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpTurnV2URL() throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        components?.path = "/deep-response/http-turn-v2"
        components?.query = nil
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpSessionURL(path: String) throws -> URL {
        let endpoint = try endpointURL()
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.scheme = httpTransportScheme(for: endpoint)
        if let questionIndex = path.firstIndex(of: "?") {
            components?.path = String(path[..<questionIndex])
            components?.percentEncodedQuery = String(path[path.index(after: questionIndex)...])
        } else {
            components?.path = path
            components?.query = nil
        }
        guard let url = components?.url else {
            throw DeepResponseClientError.missingEndpoint
        }
        return url
    }

    private static func httpTransportScheme(for endpoint: URL) -> String {
        switch endpoint.scheme?.lowercased() {
        case "https":
            return "https"
        case "wss":
            return "https"
        default:
            return "http"
        }
    }

    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        var details = "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            details += " | \(underlying.domain) \(underlying.code): \(underlying.localizedDescription)"
        }
        return details
    }

    private static func compactCode(_ error: Error) -> String {
        let nsError = error as NSError
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            return "\(nsError.domain) \(nsError.code) | \(underlying.domain) \(underlying.code)"
        }
        return "\(nsError.domain) \(nsError.code)"
    }

    private static func elapsedMs(since start: Date) -> Int {
        Int(Date().timeIntervalSince(start) * 1_000)
    }

    private static func fixturePCMChunks(durationSeconds: Int, chunkMilliseconds: Int) -> [Data] {
        let sampleRate = 16_000
        let totalFrames = durationSeconds * sampleRate
        let framesPerChunk = max(1, sampleRate * chunkMilliseconds / 1_000)
        var chunks: [Data] = []
        var chunk = Data(capacity: framesPerChunk * MemoryLayout<Int16>.size)

        for frame in 0..<totalFrames {
            let envelope = sin(Double(frame) / Double(sampleRate) * .pi)
            let carrier = sin(2 * .pi * 220 * Double(frame) / Double(sampleRate))
            var sample = Int16(max(-1, min(1, carrier * envelope)) * 7_000)
            withUnsafeBytes(of: &sample) { bytes in
                chunk.append(contentsOf: bytes)
            }
            if chunk.count >= framesPerChunk * MemoryLayout<Int16>.size {
                chunks.append(chunk)
                chunk = Data(capacity: framesPerChunk * MemoryLayout<Int16>.size)
            }
        }

        if !chunk.isEmpty {
            chunks.append(chunk)
        }
        return chunks
    }
}

private struct DeepResponseHTTPTurnResponse: Decodable {
    let ok: Bool
    let audioBase64: String
    let sampleRate: Double
    let transcript: String
    let text: String
    let timing: DeepResponseTiming?
}

private struct DeepResponseSegmentedHTTPTurnResponse: Decodable {
    let ok: Bool
    let transcript: String
    let segments: [DeepResponseHTTPTurnSegment]
    let sampleRate: Double
    let timing: DeepResponseTiming?

    func segment(kind: String) -> DeepResponseHTTPTurnSegment? {
        segments.first { $0.kind == kind }
    }
}

private struct DeepResponseHTTPTurnSegment: Decodable {
    let kind: String
    let text: String
    let audioBase64: String
    let audioByteLength: Int
}

private struct DeepResponseHTTPSessionCreateResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let state: String
    let sampleRate: Double
}

private struct DeepResponseHTTPSessionInputStopResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let turnID: String
    let generationID: String
}

private struct DeepResponseHTTPSessionAbortRequest: Encodable {
    let turnID: String
    let generationID: String
    let reason: String
}

private struct DeepResponseHTTPSessionEventsResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let cursor: Int
    let nextCursor: Int
    let events: [DeepResponseHTTPSessionEvent]
}

private struct DeepResponseHTTPSessionEvent: Decodable {
    let seq: Int
    let type: String
    let turnID: String?
    let generationID: String?
    let segment: String?
    let text: String?
    let delta: String?
    let message: String?
    let reason: String?
    let timing: DeepResponseTiming?
    let persisted: Bool?
    let store: String?
    let turnCount: Int?
}

private struct DeepResponseHTTPSessionAudioResponse: Decodable {
    let ok: Bool
    let sessionID: String
    let cursor: Int
    let nextCursor: Int
    let chunks: [DeepResponseHTTPSessionAudioChunk]
}

private struct DeepResponseHTTPSessionAudioChunk: Decodable {
    let seq: Int
    let turnID: String
    let generationID: String
    let segment: String
    let audioBase64: String
    let audioByteLength: Int
    let sampleRate: Double?
}
