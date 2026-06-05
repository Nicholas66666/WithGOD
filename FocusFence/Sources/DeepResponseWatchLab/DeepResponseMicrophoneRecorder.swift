import AVFoundation
import Foundation

final class DeepResponseMicrophoneRecorder {
    struct Configuration {
        var isEndpointingEnabled = false
        var voiceActivityThreshold = 0.012
        var minimumSpeechMilliseconds = 240
        var endSilenceMilliseconds = 900
    }

    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "deeplab.microphone-recorder")
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var chunks: [Data] = []
    private var onChunk: ((Data) -> Void)?
    private var onSilence: (() -> Void)?
    private var onVoiceStart: (() -> Void)?
    private var configuration = Configuration()
    private var recordingStartedAt: Date?
    private var speechStartedAt: Date?
    private var lastVoiceAt: Date?
    private var didEmitSilence = false
    private var didEmitVoiceStart = false
    private var isRunning = false
    #if targetEnvironment(simulator)
    private var simulatedMicTask: Task<Void, Never>?
    #endif

    func start(
        configuration: Configuration = .init(),
        onChunk: ((Data) -> Void)? = nil,
        onSilence: (() -> Void)? = nil,
        onVoiceStart: (() -> Void)? = nil
    ) async throws {
        guard !isRunning else {
            return
        }

        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["DEEP_RESPONSE_SIMULATED_MIC"] == "1" {
            startSimulatedMicrophone(configuration: configuration, onChunk: onChunk, onSilence: onSilence)
            return
        }
        #endif

        try await requestRecordPermission()

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [])
        try session.setActive(true)

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              inputFormat.channelCount > 0,
              let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: 16_000,
                channels: 1,
                interleaved: true
              ),
              let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw URLError(.cannotDecodeContentData)
        }

        queue.sync {
            chunks = []
            self.onChunk = onChunk
            self.onSilence = onSilence
            self.onVoiceStart = onVoiceStart
            self.configuration = configuration
            recordingStartedAt = Date()
            speechStartedAt = nil
            lastVoiceAt = nil
            didEmitSilence = false
            didEmitVoiceStart = false
        }
        self.converter = converter
        self.targetFormat = targetFormat

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_600, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async {
                self?.handle(buffer: buffer)
            }
        }

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    func stop() -> Data {
        #if targetEnvironment(simulator)
        simulatedMicTask?.cancel()
        simulatedMicTask = nil
        #endif
        if isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            isRunning = false
        }
        converter = nil
        targetFormat = nil
        queue.sync {
            onChunk = nil
            onSilence = nil
            onVoiceStart = nil
            recordingStartedAt = nil
            speechStartedAt = nil
            lastVoiceAt = nil
            didEmitSilence = false
            didEmitVoiceStart = false
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: [])

        return queue.sync {
            let audio = chunks.reduce(into: Data()) { partial, chunk in
                partial.append(chunk)
            }
            chunks = []
            return audio
        }
    }

    #if targetEnvironment(simulator)
    private func startSimulatedMicrophone(
        configuration: Configuration,
        onChunk: ((Data) -> Void)?,
        onSilence: (() -> Void)?
    ) {
        queue.sync {
            chunks = []
            self.onChunk = onChunk
            self.onSilence = onSilence
            self.onVoiceStart = nil
            self.configuration = configuration
            recordingStartedAt = Date()
            speechStartedAt = Date()
            lastVoiceAt = Date()
            didEmitSilence = false
            didEmitVoiceStart = false
        }
        isRunning = true
        simulatedMicTask = Task { [weak self] in
            guard let self else { return }
            let speech = Self.simulatedSpeechPCM()
            let chunkBytes = 16_000 * MemoryLayout<Int16>.size / 10
            var offset = 0
            while offset < speech.count, !Task.isCancelled {
                let end = min(offset + chunkBytes, speech.count)
                let chunk = speech.subdata(in: offset..<end)
                queue.async {
                    self.chunks.append(chunk)
                    self.onChunk?(chunk)
                    self.lastVoiceAt = Date()
                }
                offset = end
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled else { return }
            queue.async {
                self.emitSilenceIfNeeded()
            }
        }
    }

    private static func simulatedSpeechPCM() -> Data {
        if let url = Bundle.main.url(forResource: "simulated-mic-speech", withExtension: "pcm"),
           let data = try? Data(contentsOf: url),
           !data.isEmpty {
            return data
        }

        let sampleRate = 16_000
        let totalFrames = sampleRate * 2
        var data = Data(capacity: totalFrames * MemoryLayout<Int16>.size)
        for frame in 0..<totalFrames {
            let envelope = sin(Double(frame) / Double(totalFrames) * .pi)
            let carrier = sin(2 * .pi * 220 * Double(frame) / Double(sampleRate))
            var sample = Int16(max(-1, min(1, carrier * envelope)) * 7_000)
            withUnsafeBytes(of: &sample) { bytes in
                data.append(contentsOf: bytes)
            }
        }
        return data
    }
    #endif

    private func requestRecordPermission() async throws {
        let session = AVAudioSession.sharedInstance()
        if session.recordPermission == .granted {
            return
        }
        if session.recordPermission == .denied {
            throw URLError(.userAuthenticationRequired)
        }

        let granted = await withCheckedContinuation { continuation in
            session.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
        if !granted {
            throw URLError(.userAuthenticationRequired)
        }
    }

    private func handle(buffer: AVAudioPCMBuffer) {
        guard let converter,
              let targetFormat,
              let converted = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * targetFormat.sampleRate / buffer.format.sampleRate) + 32
              ) else {
            return
        }

        var error: NSError?
        var didProvideBuffer = false
        converter.convert(to: converted, error: &error) { _, status in
            if didProvideBuffer {
                status.pointee = .noDataNow
                return nil
            }
            didProvideBuffer = true
            status.pointee = .haveData
            return buffer
        }

        guard error == nil,
              converted.frameLength > 0,
              let data = converted.pcm16Data() else {
            return
        }

        chunks.append(data)
        onChunk?(data)
        updateEndpointing(with: data)
    }

    private func updateEndpointing(with data: Data) {
        guard configuration.isEndpointingEnabled, !didEmitSilence else {
            return
        }

        let now = Date()
        if Self.voiceActivityLevel(in: data) >= configuration.voiceActivityThreshold {
            if speechStartedAt == nil {
                speechStartedAt = now
            }
            lastVoiceAt = now
            if let speechStartedAt,
               !didEmitVoiceStart,
               now.timeIntervalSince(speechStartedAt) * 1_000 >= Double(configuration.minimumSpeechMilliseconds) {
                didEmitVoiceStart = true
                onVoiceStart?()
            }
            return
        }

        guard let speechStartedAt, let lastVoiceAt else {
            return
        }

        let speechMilliseconds = now.timeIntervalSince(speechStartedAt) * 1_000
        let silenceMilliseconds = now.timeIntervalSince(lastVoiceAt) * 1_000
        if speechMilliseconds >= Double(configuration.minimumSpeechMilliseconds),
           silenceMilliseconds >= Double(configuration.endSilenceMilliseconds) {
            emitSilenceIfNeeded()
        }
    }

    private func emitSilenceIfNeeded() {
        guard !didEmitSilence else {
            return
        }
        didEmitSilence = true
        onSilence?()
    }

    private static func voiceActivityLevel(in data: Data) -> Double {
        let sampleCount = data.count / MemoryLayout<Int16>.size
        guard sampleCount > 0 else {
            return 0
        }

        let total = data.withUnsafeBytes { rawBuffer -> Int64 in
            guard let samples = rawBuffer.bindMemory(to: Int16.self).baseAddress else {
                return 0
            }
            var sum: Int64 = 0
            for index in 0..<sampleCount {
                sum += Int64(abs(Int32(samples[index])))
            }
            return sum
        }
        return Double(total) / Double(sampleCount) / Double(Int16.max)
    }
}

private extension AVAudioPCMBuffer {
    func pcm16Data() -> Data? {
        guard let int16ChannelData else {
            return nil
        }

        let frameCount = Int(frameLength)
        let channelCount = Int(format.channelCount)
        guard frameCount > 0, channelCount > 0 else {
            return nil
        }

        if format.isInterleaved {
            return Data(
                bytes: int16ChannelData[0],
                count: frameCount * channelCount * MemoryLayout<Int16>.size
            )
        }

        var data = Data(capacity: frameCount * MemoryLayout<Int16>.size)
        let channel = int16ChannelData[0]
        for index in 0..<frameCount {
            var sample = channel[index]
            withUnsafeBytes(of: &sample) { bytes in
                data.append(contentsOf: bytes)
            }
        }
        return data
    }
}
