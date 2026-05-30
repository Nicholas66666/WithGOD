import AVFoundation
import Foundation

final class WatchRealtimeAudioStreamer {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "presence.watch.realtime-audio")
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var streamContinuation: AsyncStream<Data>.Continuation?
    private var stream: AsyncStream<Data>?
    private var isRunning = false

    func start() throws {
        guard !isRunning else {
            return
        }

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              inputFormat.channelCount > 0,
              let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: 24_000,
                channels: 1,
                interleaved: true
              ),
              let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw URLError(.cannotDecodeContentData)
        }

        let stream = AsyncStream<Data> { continuation in
            self.streamContinuation = continuation
        }
        self.stream = stream
        self.converter = converter
        self.targetFormat = targetFormat

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2_400, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async {
                self?.handle(buffer: buffer)
            }
        }

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    func stop() {
        guard isRunning else {
            streamContinuation?.finish()
            streamContinuation = nil
            stream = nil
            return
        }

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
        streamContinuation?.finish()
        streamContinuation = nil
        stream = nil
        converter = nil
        targetFormat = nil
    }

    func audioChunks() -> AsyncStream<Data> {
        stream ?? AsyncStream { $0.finish() }
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

        streamContinuation?.yield(data)
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
