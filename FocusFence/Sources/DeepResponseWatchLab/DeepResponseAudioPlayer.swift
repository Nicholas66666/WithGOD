import AVFoundation
import Foundation

final class DeepResponseAudioPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var isPrepared = false

    func enqueuePCM16(_ data: Data, sampleRate: Double) {
        guard !data.isEmpty,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = data.pcm16MonoBuffer(format: format) else {
            return
        }

        do {
            try prepareIfNeeded(format: format)
            player.scheduleBuffer(buffer, completionHandler: nil)
            if !player.isPlaying {
                player.play()
            }
        } catch {
            return
        }
    }

    func stop() {
        player.stop()
        engine.stop()
        isPrepared = false
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
