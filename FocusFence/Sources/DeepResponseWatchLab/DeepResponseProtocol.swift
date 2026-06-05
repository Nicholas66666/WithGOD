import Foundation

struct DeepResponseTiming: Decodable, Equatable {
    let voicePipelineTotalMs: Int?
    let transcriptFinalMs: Int?
    let llmFirstTokenMs: Int?
    let llmTotalMs: Int?
    let llmFirstPhraseMs: Int?
    let ttsFirstAudioMs: Int?
    let firstTTSFirstAudioMs: Int?
    let followupLLMFirstPhraseMs: Int?
    let followupTTSFirstAudioMs: Int?
    let chunksIn: Int?
    let chunksOut: Int?
    let bargeIns: Int?

    enum CodingKeys: String, CodingKey {
        case voicePipelineTotalMs = "voice_pipeline_total_ms"
        case transcriptFinalMs = "transcript_final_ms"
        case llmFirstTokenMs = "llm_first_token_ms"
        case llmTotalMs = "llm_total_ms"
        case llmFirstPhraseMs = "llm_first_phrase_ms"
        case ttsFirstAudioMs = "tts_first_audio_ms"
        case firstTTSFirstAudioMs = "first_tts_first_audio_ms"
        case followupLLMFirstPhraseMs = "followup_llm_first_phrase_ms"
        case followupTTSFirstAudioMs = "followup_tts_first_audio_ms"
        case chunksIn = "chunks_in"
        case chunksOut = "chunks_out"
        case bargeIns = "barge_ins"
    }

    var watchSummaryText: String {
        var parts = ["asr \(transcriptFinalMs ?? 0)"]

        if llmFirstTokenMs != nil || llmTotalMs != nil {
            parts.append("llm1 \(llmFirstTokenMs ?? 0)")
            parts.append("llm \(llmTotalMs ?? llmFirstTokenMs ?? 0)")
        } else {
            parts.append("llm \(llmFirstPhraseMs ?? 0)")
            parts.append("tts \(ttsFirstAudioMs ?? firstTTSFirstAudioMs ?? 0)")
        }

        return parts.joined(separator: " · ")
    }
}
