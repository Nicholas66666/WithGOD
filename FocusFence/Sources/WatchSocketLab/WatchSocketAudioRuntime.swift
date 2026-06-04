import AVFoundation
import Foundation

struct WatchSocketAudioState {
    let label: String
    let route: String
    let inputSampleRate: Double
    let outputSampleRate: Double
}

final class WatchSocketAudioRuntime {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var didAttachPlayer = false

    func activateVoiceChat() async throws -> WatchSocketAudioState {
        stopEngine()

        let session = AVAudioSession.sharedInstance()
        try await requestRecordPermission(session)
        try session.setCategory(.playAndRecord, mode: .voiceChat)
        try session.setActive(true)

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { _, _ in
            // Keeping a real input tap active is the purpose of this spike.
        }

        if !didAttachPlayer {
            engine.attach(player)
            didAttachPlayer = true
        }
        let outputFormat = engine.outputNode.inputFormat(forBus: 0)
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
        engine.prepare()
        try engine.start()
        scheduleSilence(format: outputFormat)
        player.play()

        return WatchSocketAudioState(
            label: "playAndRecord.voiceChat.activeStream",
            route: routeDescription(session),
            inputSampleRate: inputFormat.sampleRate,
            outputSampleRate: outputFormat.sampleRate
        )
    }

    func deactivate() {
        stopEngine()
        try? AVAudioSession.sharedInstance().setActive(false, options: [])
    }

    func currentRoute() -> String {
        routeDescription(AVAudioSession.sharedInstance())
    }

    private func requestRecordPermission(_ session: AVAudioSession) async throws {
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

    private func stopEngine() {
        if engine.isRunning {
            engine.inputNode.removeTap(onBus: 0)
            player.stop()
            engine.stop()
        }
    }

    private func scheduleSilence(format: AVAudioFormat) {
        guard format.sampleRate > 0,
              format.channelCount > 0,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(format.sampleRate / 10)
              ) else {
            return
        }
        buffer.frameLength = buffer.frameCapacity

        let options: AVAudioPlayerNodeBufferOptions = [.loops]
        player.scheduleBuffer(buffer, at: nil, options: options)
    }

    private func routeDescription(_ session: AVAudioSession) -> String {
        let inputs = session.currentRoute.inputs.map(\.portType.rawValue)
        let outputs = session.currentRoute.outputs.map(\.portType.rawValue)
        return "in=\(inputs.joined(separator: "+"));out=\(outputs.joined(separator: "+"))"
    }
}
