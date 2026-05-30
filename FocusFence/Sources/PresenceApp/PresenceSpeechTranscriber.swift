import AVFoundation
import Foundation
import Speech

struct PresenceSpeechTranscriber {
    func transcribe(audioURL: URL) async -> String {
        let status = await requestAuthorization()
        guard status == .authorized,
              let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")),
              recognizer.isAvailable else {
            return fallbackTranscript(for: audioURL)
        }

        return await withCheckedContinuation { continuation in
            let request = SFSpeechURLRecognitionRequest(url: audioURL)
            request.shouldReportPartialResults = false
            var didResume = false

            recognizer.recognitionTask(with: request) { result, error in
                guard !didResume else {
                    return
                }

                if let result, result.isFinal {
                    didResume = true
                    continuation.resume(returning: result.bestTranscription.formattedString)
                } else if error != nil {
                    didResume = true
                    continuation.resume(returning: fallbackTranscript(for: audioURL))
                }
            }
        }
    }

    private func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func fallbackTranscript(for audioURL: URL) -> String {
        let asset = AVURLAsset(url: audioURL)
        let seconds = CMTimeGetSeconds(asset.duration)
        if seconds.isFinite, seconds > 0 {
            return "已收到一段约 \(Int(seconds.rounded())) 秒的回转录音。语音识别权限开启后，这里会显示完整文字。"
        }
        return "已收到一段回转录音。语音识别权限开启后，这里会显示完整文字。"
    }
}
