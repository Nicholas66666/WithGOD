import Foundation

struct PresenceRecord: Identifiable, Codable, Equatable {
    enum ProcessingState: String, Codable {
        case received
        case uploading
        case transcribing
        case analyzing
        case ready
        case failed
    }

    var id: UUID
    var createdAt: Date
    var source: PresenceSource
    var audioFileName: String
    var audioRemoteURL: URL?
    var duration: TimeInterval?
    var transcript: String
    var type: PresenceEntryType
    var summary: String
    var tags: [PresenceTag]
    var watchResponse: WatchInstantResponse
    var detail: PresenceRecordDetail
    var responseMode: PresenceResponseMode
    var state: ProcessingState
    var processingTiming: PresenceProcessingTiming? = nil
    var realtimeDiagnostic: String? = nil
}

struct PresenceProcessingTiming: Codable, Equatable {
    var receivedAtMs: Int?
    var uploadMs: Int?
    var signedUrlMs: Int?
    var transcriptionMs: Int?
    var primaryAnalysisMs: Int?
    var primaryUpsertMs: Int?
    var primaryTotalMs: Int?
    var quickAnalysisMs: Int?
    var quickUpsertMs: Int?
    var quickTotalMs: Int?
    var fullAnalysisMs: Int?
    var fullVoiceMs: Int?
    var fullUpsertMs: Int?
    var fullTotalMs: Int?

    enum CodingKeys: String, CodingKey {
        case receivedAtMs = "received_at_ms"
        case uploadMs = "upload_ms"
        case signedUrlMs = "signed_url_ms"
        case transcriptionMs = "transcription_ms"
        case primaryAnalysisMs = "primary_analysis_ms"
        case primaryUpsertMs = "primary_upsert_ms"
        case primaryTotalMs = "primary_total_ms"
        case quickAnalysisMs = "quick_analysis_ms"
        case quickUpsertMs = "quick_upsert_ms"
        case quickTotalMs = "quick_total_ms"
        case fullAnalysisMs = "full_analysis_ms"
        case fullVoiceMs = "full_voice_ms"
        case fullUpsertMs = "full_upsert_ms"
        case fullTotalMs = "full_total_ms"
    }
}

enum PresenceSource: String, Codable, Equatable {
    case watch
    case iphone
    case server
}

enum PresenceEntryType: String, Codable, CaseIterable, Equatable {
    case turning
    case prayer
    case idea
    case bibleQuestion
    case generalQuestion
    case task
    case journal
    case unknown

    var title: String {
        switch self {
        case .turning: "回转"
        case .prayer: "祷告"
        case .idea: "灵感"
        case .bibleQuestion: "圣经问题"
        case .generalQuestion: "问答"
        case .task: "待办"
        case .journal: "日志"
        case .unknown: "待辨明"
        }
    }

    var systemImage: String {
        switch self {
        case .turning: "arrow.triangle.turn.up.right.circle"
        case .prayer: "hands.sparkles"
        case .idea: "lightbulb"
        case .bibleQuestion: "book.closed"
        case .generalQuestion: "questionmark.bubble"
        case .task: "checklist"
        case .journal: "text.book.closed"
        case .unknown: "waveform"
        }
    }
}

enum PresenceResponseMode: String, Codable, Equatable {
    case silentSave
    case watchText
    case watchVoice
    case iphoneOnly
}

struct PresenceTag: Identifiable, Codable, Equatable, Hashable {
    enum Category: String, Codable {
        case emotion
        case spiritualTheme
        case relationship
        case situation
        case content
        case action
    }

    var id: String { "\(category.rawValue)-\(name)" }
    let name: String
    let category: Category
    let confidence: Double
}

struct WatchInstantResponse: Codable, Equatable {
    let eyebrow: String
    let headline: String
    let body: String
    let footnote: String
    let accent: WatchResponseAccent

    static let saving = WatchInstantResponse(
        eyebrow: "已记下",
        headline: "正在整理",
        body: "我会先保存这段声音，再判断它属于回转、祷告、灵感还是问题。",
        footnote: "稍后在 iPhone 查看完整整理",
        accent: .blue
    )
}

enum WatchResponseAccent: String, Codable, Equatable {
    case green
    case blue
    case gold
    case red
    case gray
}

struct PresenceRecordDetail: Codable, Equatable {
    let title: String
    let primaryText: String
    let scripture: String
    let prayer: String
    let action: String
    let question: String
    let answer: String
    let nextSteps: [String]
}

extension PresenceRecord {
    var processingTitle: String {
        switch state {
        case .received:
            return "已收到录音"
        case .uploading:
            return "正在上传"
        case .transcribing:
            return "正在转写"
        case .analyzing:
            return "正在理解"
        case .ready:
            return "已完成"
        case .failed:
            return "处理失败"
        }
    }

    var processingDetail: String {
        switch state {
        case .received:
            return "iPhone 已创建记录，正在准备上传或等待服务端同步结果。"
        case .uploading:
            return "正在把原始录音发送到服务端保存和处理。"
        case .transcribing:
            return "服务端正在把语音识别成文字。"
        case .analyzing:
            return "AI 正在判断类型、生成标签和整理回应。"
        case .ready:
            return "转写、分类、回应和原始录音已经可以查看。"
        case .failed:
            return "这条记录没有完成处理，可以稍后重试或重新录制。"
        }
    }

    var processingNextStep: String {
        switch state {
        case .received:
            return "下一步：上传录音"
        case .uploading:
            return "下一步：语音转文字"
        case .transcribing:
            return "下一步：AI 理解和分类"
        case .analyzing:
            return "下一步：生成完整回应"
        case .ready:
            return "下一步：查看或播放"
        case .failed:
            return "下一步：重新记录"
        }
    }

    var processingProgress: Double {
        switch state {
        case .received:
            return 0.18
        case .uploading:
            return 0.35
        case .transcribing:
            return 0.58
        case .analyzing:
            return 0.78
        case .ready:
            return 1
        case .failed:
            return 1
        }
    }

    static func pending(id: UUID = UUID(), audioFileName: String, createdAt: Date = Date(), duration: TimeInterval? = nil) -> PresenceRecord {
        PresenceRecord(
            id: id,
            createdAt: createdAt,
            source: .watch,
            audioFileName: audioFileName,
            audioRemoteURL: nil,
            duration: duration,
            transcript: "正在整理这次语音记录...",
            type: .unknown,
            summary: "已收到一条来自 Apple Watch 的语音。",
            tags: [],
            watchResponse: .saving,
            detail: PresenceRecordDetail(
                title: "正在辨明",
                primaryText: "这条记录会被自动分类并整理。",
                scripture: "",
                prayer: "",
                action: "等待整理完成",
                question: "",
                answer: "",
                nextSteps: []
            ),
            responseMode: .watchText,
            state: .received,
            processingTiming: nil,
            realtimeDiagnostic: nil
        )
    }

    static var demoRecords: [PresenceRecord] {
        [
            demoTurning,
            demoPrayer,
            demoIdea,
            demoQuestion
        ]
    }

    private static var demoTurning: PresenceRecord {
        PresenceRecord(
            id: UUID(),
            createdAt: Date().addingTimeInterval(-18 * 60),
            source: .watch,
            audioFileName: "demo-anger.m4a",
            audioRemoteURL: nil,
            duration: 24,
            transcript: "主啊，我刚才听到他说那句话的时候里面很生气，觉得自己被冒犯了。我很想马上解释，也想证明我是对的。求你帮助我先慢下来，不要让怒气控制我。",
            type: .turning,
            summary: "一句话触发了被冒犯和想证明自己的反应。",
            tags: [
                PresenceTag(name: "怒气", category: .emotion, confidence: 0.92),
                PresenceTag(name: "被冒犯", category: .situation, confidence: 0.87),
                PresenceTag(name: "控制感", category: .spiritualTheme, confidence: 0.81),
                PresenceTag(name: "骄傲", category: .spiritualTheme, confidence: 0.72)
            ],
            watchResponse: WatchInstantResponse(
                eyebrow: "先回到神面前",
                headline: "先不回应 1 分钟",
                body: "快快地听，慢慢地说，慢慢地动怒。雅 1:19",
                footnote: "把这口气交给神",
                accent: .green
            ),
            detail: PresenceRecordDetail(
                title: "被冒犯时的回转",
                primaryText: "你可能正在被一句话、一个态度或一种不被尊重的感觉触发。",
                scripture: "各人要快快地听，慢慢地说，慢慢地动怒。雅 1:19",
                prayer: "主啊，求你先掌管我的舌头和心，不让我急着证明自己。",
                action: "先不回应 1 分钟，只做一次深呼吸祷告。",
                question: "我现在最想保护的是面子、控制感，还是被理解？",
                answer: "",
                nextSteps: ["先停下来", "必要时晚一点再回应"]
            ),
            responseMode: .watchText,
            state: .ready
        )
    }

    private static var demoPrayer: PresenceRecord {
        PresenceRecord(
            id: UUID(),
            createdAt: Date().addingTimeInterval(-2 * 60 * 60),
            source: .watch,
            audioFileName: "demo-prayer.m4a",
            audioRemoteURL: nil,
            duration: 29,
            transcript: "主啊，我把今天下午这个决定交给你。求你给我清楚、平安，也让我不只是按自己的冲动做选择。",
            type: .prayer,
            summary: "为下午的决定寻求平安和引导。",
            tags: [
                PresenceTag(name: "交托", category: .spiritualTheme, confidence: 0.88),
                PresenceTag(name: "寻求引导", category: .content, confidence: 0.82)
            ],
            watchResponse: WatchInstantResponse(
                eyebrow: "已成为祷告",
                headline: "把结果交托",
                body: "你先求神给清楚和平安，不急着靠冲动决定。",
                footnote: "完整祷告已保存",
                accent: .gold
            ),
            detail: PresenceRecordDetail(
                title: "关于决定的交托祷告",
                primaryText: "这是一段寻求引导的祷告，可以后续回顾神如何带领。",
                scripture: "你要专心仰赖耶和华，不可倚靠自己的聪明。箴 3:5",
                prayer: "主啊，求你让我在清楚、平安和顺服里做决定。",
                action: "写下一个现在能负责的小步骤。",
                question: "我是否愿意接受神给出的不同方向？",
                answer: "",
                nextSteps: ["今天晚些时候回顾这个决定", "记录后续结果"]
            ),
            responseMode: .watchText,
            state: .ready
        )
    }

    private static var demoIdea: PresenceRecord {
        PresenceRecord(
            id: UUID(),
            createdAt: Date().addingTimeInterval(-5 * 60 * 60),
            source: .watch,
            audioFileName: "demo-idea.m4a",
            audioRemoteURL: nil,
            duration: 18,
            transcript: "我突然想到，可以写一篇关于为什么真正的低摩擦记录入口会改变人的刻意练习的文章，从 Apple Watch Action Button 开始讲。",
            type: .idea,
            summary: "一篇关于低摩擦记录入口和刻意练习的文章想法。",
            tags: [
                PresenceTag(name: "写作", category: .content, confidence: 0.9),
                PresenceTag(name: "产品思考", category: .content, confidence: 0.84)
            ],
            watchResponse: WatchInstantResponse(
                eyebrow: "已记下灵感",
                headline: "这是一个文章种子",
                body: "核心是：低摩擦入口会改变刻意练习的发生频率。",
                footnote: "稍后可展开成提纲",
                accent: .blue
            ),
            detail: PresenceRecordDetail(
                title: "低摩擦入口与刻意练习",
                primaryText: "这个想法可以发展成一篇产品思考文章。",
                scripture: "",
                prayer: "",
                action: "先生成一个 5 点文章提纲。",
                question: "这篇文章最想说服谁？",
                answer: "可从 Action Button 的即时性切入，讲它如何降低记录阻力。",
                nextSteps: ["整理提纲", "补一个真实使用场景", "写开头"]
            ),
            responseMode: .watchText,
            state: .ready
        )
    }

    private static var demoQuestion: PresenceRecord {
        PresenceRecord(
            id: UUID(),
            createdAt: Date().addingTimeInterval(-26 * 60 * 60),
            source: .watch,
            audioFileName: "demo-question.m4a",
            audioRemoteURL: nil,
            duration: 12,
            transcript: "这个词是什么意思，语音回答我一下，什么叫做认知失调？",
            type: .generalQuestion,
            summary: "询问“认知失调”的含义，并明确要求语音回答。",
            tags: [
                PresenceTag(name: "AI 问答", category: .content, confidence: 0.91),
                PresenceTag(name: "允许语音", category: .action, confidence: 0.9)
            ],
            watchResponse: WatchInstantResponse(
                eyebrow: "正在回答",
                headline: "可以语音回应",
                body: "你已经明确要求用语音回答，Watch 可以播放简短解释。",
                footnote: "完整解释已保存",
                accent: .blue
            ),
            detail: PresenceRecordDetail(
                title: "什么是认知失调",
                primaryText: "这是一个普通 AI 问答。",
                scripture: "",
                prayer: "",
                action: "",
                question: "什么叫做认知失调？",
                answer: "认知失调是指一个人的信念、行为或新信息彼此冲突时产生的不舒服感。人通常会通过改变解释、调整行为或回避信息来减轻这种不适。",
                nextSteps: []
            ),
            responseMode: .watchVoice,
            state: .ready
        )
    }
}
