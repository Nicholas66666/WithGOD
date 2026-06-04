import AVFoundation
import Foundation

final class DeepResponseAudioPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var isPrepared = false
    private let stateQueue = DispatchQueue(label: "deeplab.audio-player")
    private var pendingBufferCount = 0
    var onPlaybackDrained: (() -> Void)?

    func enqueuePCM16(_ data: Data, sampleRate: Double) {
        guard !data.isEmpty,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = data.pcm16MonoBuffer(format: format) else {
            return
        }

        do {
            try prepareIfNeeded(format: format)
            stateQueue.sync {
                pendingBufferCount += 1
            }
            player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                self?.markBufferPlayed()
            }
            if !player.isPlaying {
                player.play()
            }
        } catch {
            return
        }
    }

    func stop() {
        stateQueue.sync {
            pendingBufferCount = 0
        }
        player.stop()
        engine.stop()
        if isPrepared {
            engine.detach(player)
            isPrepared = false
        }
    }

    private func markBufferPlayed() {
        let shouldNotify = stateQueue.sync {
            pendingBufferCount = max(0, pendingBufferCount - 1)
            return pendingBufferCount == 0
        }
        if shouldNotify {
            notifyPlaybackDrainedIfNeeded()
        }
    }

    private func notifyPlaybackDrainedIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            self?.onPlaybackDrained?()
        }
    }

    private func prepareIfNeeded(format: AVAudioFormat) throws {
        guard !isPrepared else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        isPrepared = true
    }
}

private extension Data {
    func pcm16MonoBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let frameCount = count / MemoryLayout<Int16>.size
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)),
              let channel = buffer.floatChannelData?[0] else {
            return nil
        }

        buffer.frameLength = AVAudioFrameCount(frameCount)
        withUnsafeBytes { rawBuffer in
            guard let samples = rawBuffer.bindMemory(to: Int16.self).baseAddress else {
                return
            }
            for index in 0..<frameCount {
                channel[index] = Float(samples[index]) / Float(Int16.max)
            }
        }
        return buffer
    }
}
