import Foundation

struct PresenceAnalysis {
    let type: PresenceEntryType
    let summary: String
    let tags: [PresenceTag]
    let watchResponse: WatchInstantResponse
    let detail: PresenceRecordDetail
    let responseMode: PresenceResponseMode
}

struct PresenceAnalyzer {
    func analyze(transcript: String) -> PresenceAnalysis {
        let text = transcript.lowercased()
        let type = classify(text)
        let tags = tags(for: type, text: text)
        let responseMode: PresenceResponseMode = shouldUseVoice(text) ? .watchVoice : .watchText

        switch type {
        case .turning:
            return turningAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .prayer:
            return prayerAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .idea:
            return ideaAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .bibleQuestion:
            return bibleQuestionAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .generalQuestion:
            return generalQuestionAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .task:
            return taskAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        case .journal, .unknown:
            return journalAnalysis(transcript: transcript, tags: tags, responseMode: responseMode)
        }
    }

    private func classify(_ text: String) -> PresenceEntryType {
        if containsAny(["语音回答", "回答我", "什么是", "什么意思", "怎么做", "为什么", "这个叫什么", "天气"], in: text) {
            if containsAny(["圣经", "经文", "耶稣", "保罗", "福音", "旧约", "新约"], in: text) {
                return .bibleQuestion
            }
            return .generalQuestion
        }

        if containsAny(["主啊", "神啊", "祷告", "代祷", "感恩", "交托", "求你"], in: text) {
            if containsAny(["生气", "怒", "冒犯", "悔改", "认罪", "赦免", "论断", "饶恕"], in: text) {
                return .turning
            }
            return .prayer
        }

        if containsAny(["生气", "怒", "冒犯", "焦虑", "担心", "悔改", "认罪", "犯错", "论断", "饶恕"], in: text) {
            return .turning
        }

        if containsAny(["想到", "灵感", "idea", "文章", "写一篇", "选题", "产品", "创意"], in: text) {
            return .idea
        }

        if containsAny(["提醒我", "记得", "待办", "明天", "下午", "几点", "要做", "买", "发给"], in: text) {
            return .task
        }

        if containsAny(["今天", "刚才", "记录一下", "我觉得", "我发现"], in: text) {
            return .journal
        }

        return .unknown
    }

    private func tags(for type: PresenceEntryType, text: String) -> [PresenceTag] {
        var tags: [PresenceTag] = [
            PresenceTag(name: type.title, category: .content, confidence: 0.72)
        ]

        addTag("怒气", .emotion, 0.9, when: ["生气", "怒", "气", "烦", "火大"], in: text, to: &tags)
        addTag("委屈", .emotion, 0.82, when: ["委屈", "不公平", "被误解", "难受"], in: text, to: &tags)
        addTag("焦虑", .emotion, 0.78, when: ["焦虑", "担心", "怕", "压力", "紧张"], in: text, to: &tags)
        addTag("被冒犯", .situation, 0.86, when: ["冒犯", "他说", "她说", "语气", "顶撞"], in: text, to: &tags)
        addTag("控制感", .spiritualTheme, 0.82, when: ["控制", "必须", "一定要", "按我的", "受不了"], in: text, to: &tags)
        addTag("悔改", .spiritualTheme, 0.88, when: ["悔改", "认罪", "回转", "饶恕", "赦免"], in: text, to: &tags)
        addTag("写作", .content, 0.82, when: ["文章", "写一篇", "提纲", "选题"], in: text, to: &tags)
        addTag("允许语音", .action, 0.94, when: ["语音回答", "说出来", "用声音"], in: text, to: &tags)

        return Array(tags.prefix(6))
    }

    private func addTag(
        _ name: String,
        _ category: PresenceTag.Category,
        _ confidence: Double,
        when keywords: [String],
        in text: String,
        to tags: inout [PresenceTag]
    ) {
        guard keywords.contains(where: { text.contains($0.lowercased()) }) else {
            return
        }
        tags.append(PresenceTag(name: name, category: category, confidence: confidence))
    }

    private func shouldUseVoice(_ text: String) -> Bool {
        containsAny(["语音回答", "直接说出来", "用声音告诉我", "用语音回应", "回答我一下"], in: text)
    }

    private func containsAny(_ keywords: [String], in text: String) -> Bool {
        keywords.contains { text.contains($0.lowercased()) }
    }

    private func turningAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        let names = Set(tags.map(\.name))
        if names.contains("焦虑") {
            return PresenceAnalysis(
                type: .turning,
                summary: "这段记录像是在焦虑里练习交托。",
                tags: tags,
                watchResponse: WatchInstantResponse(
                    eyebrow: "先交托结果",
                    headline: "今天只负责下一步",
                    body: "应当一无挂虑，只要凡事借着祷告告诉神。腓 4:6",
                    footnote: "把不可控的先交给神",
                    accent: .green
                ),
                detail: PresenceRecordDetail(
                    title: "焦虑里的交托",
                    primaryText: "你可能正在试图提前承担还没有发生的结果。",
                    scripture: "应当一无挂虑，只要凡事借着祷告、祈求和感谢，将你们所要的告诉神。腓 4:6",
                    prayer: "主啊，我把这个结果交给你，求你给我今天够用的顺服。",
                    action: "写下一个现在能做的小行动，其余先交托。",
                    question: "这件事里，哪些是我能负责的，哪些不是？",
                    answer: "",
                    nextSteps: ["只列一个下一步", "晚些时候回顾焦虑是否下降"]
                ),
                responseMode: responseMode
            )
        }

        return PresenceAnalysis(
            type: .turning,
            summary: "这段记录像是在被触发时练习回转。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: "先回到神面前",
                headline: "先不回应 1 分钟",
                body: "快快地听，慢慢地说，慢慢地动怒。雅 1:19",
                footnote: "把这口气交给神",
                accent: .green
            ),
            detail: PresenceRecordDetail(
                title: "被触发时的回转",
                primaryText: "你可能正在被一句话、一个态度或一种不被尊重的感觉触发。",
                scripture: "各人要快快地听，慢慢地说，慢慢地动怒。雅 1:19",
                prayer: "主啊，求你先掌管我的舌头和心，不让我急着证明自己。",
                action: "先不回应 1 分钟，只做一次深呼吸祷告。",
                question: "我现在最想保护的是面子、控制感，还是被理解？",
                answer: "",
                nextSteps: ["不要立刻发消息", "必要时写下但先不发送"]
            ),
            responseMode: responseMode
        )
    }

    private func prayerAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .prayer,
            summary: "这是一段可以保存和回顾的祷告。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: "已成为祷告",
                headline: "把结果交托",
                body: "你已经把这件事带到神面前，不需要马上靠自己抓住它。",
                footnote: "完整祷告已保存",
                accent: .gold
            ),
            detail: PresenceRecordDetail(
                title: "祷告记录",
                primaryText: "这段内容更像是祷告、交托或寻求。",
                scripture: "你要专心仰赖耶和华，不可倚靠自己的聪明。箴 3:5",
                prayer: transcript,
                action: "稍后回顾这件事如何被带领。",
                question: "我是否愿意接受神给出的不同方向？",
                answer: "",
                nextSteps: ["加入祷告回顾", "记录后续结果"]
            ),
            responseMode: responseMode
        )
    }

    private func ideaAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .idea,
            summary: "这是一个可以后续展开的想法。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: "已记下灵感",
                headline: "这是一个想法种子",
                body: "先保存原始表达，稍后可以整理成提纲、文章或任务。",
                footnote: "不要现在打断自己",
                accent: .blue
            ),
            detail: PresenceRecordDetail(
                title: "灵感记录",
                primaryText: "这条记录适合后续发展为文章、产品想法或行动计划。",
                scripture: "",
                prayer: "",
                action: "先生成一个 3-5 点提纲。",
                question: "这个想法最适合服务哪个具体目标？",
                answer: "可以从原始表达里提取主题、标题和下一步。",
                nextSteps: ["提取主题", "生成提纲", "决定是否进入写作"]
            ),
            responseMode: responseMode
        )
    }

    private func bibleQuestionAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .bibleQuestion,
            summary: "这是一个需要谨慎回答的圣经相关问题。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: responseMode == .watchVoice ? "可以语音回答" : "已收到问题",
                headline: "先给谨慎答案",
                body: "圣经问题会保留经文依据、解释和应用，完整内容放在 iPhone。",
                footnote: responseMode == .watchVoice ? "将播放简短回答" : "默认不播放声音",
                accent: .gold
            ),
            detail: PresenceRecordDetail(
                title: "圣经问题",
                primaryText: "这类问题需要给出经文依据，并清楚区分解释和应用。",
                scripture: "你的话是我脚前的灯，是我路上的光。诗 119:105",
                prayer: "",
                action: "先查看完整回答，再决定是否继续追问。",
                question: transcript,
                answer: "这条问题已保存。接入服务端后会生成带经文依据、解释、应用和不确定性说明的回答。",
                nextSteps: ["生成完整回答", "列出相关经文", "保留可追问入口"]
            ),
            responseMode: responseMode
        )
    }

    private func generalQuestionAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .generalQuestion,
            summary: "这是一个普通 AI 问答。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: responseMode == .watchVoice ? "正在回答" : "已收到问题",
                headline: responseMode == .watchVoice ? "可以语音回应" : "默认静默保存",
                body: responseMode == .watchVoice ? "你已经明确要求语音回答，Watch 可以播放简短解释。" : "我会在 iPhone 里给出完整答案。",
                footnote: "完整内容已保存",
                accent: .blue
            ),
            detail: PresenceRecordDetail(
                title: "AI 问答",
                primaryText: "这是一个普通问题，可以由 AI 给出简短答案和完整解释。",
                scripture: "",
                prayer: "",
                action: "",
                question: transcript,
                answer: "这条问题已保存。接入服务端后会生成可直接使用的回答。",
                nextSteps: []
            ),
            responseMode: responseMode
        )
    }

    private func taskAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .task,
            summary: "这条记录像是一个待办或提醒。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: "已记下待办",
                headline: "稍后整理成任务",
                body: "我会从语音里提取对象、时间和下一步。",
                footnote: "iPhone 里确认后再执行",
                accent: .gray
            ),
            detail: PresenceRecordDetail(
                title: "待办记录",
                primaryText: "这条内容适合后续整理成任务。",
                scripture: "",
                prayer: "",
                action: "确认任务内容和时间。",
                question: "这件事是否需要提醒？",
                answer: "",
                nextSteps: ["提取任务", "确认时间", "后续可同步提醒事项"]
            ),
            responseMode: responseMode
        )
    }

    private func journalAnalysis(transcript: String, tags: [PresenceTag], responseMode: PresenceResponseMode) -> PresenceAnalysis {
        PresenceAnalysis(
            type: .journal,
            summary: "这是一段日常观察或反思。",
            tags: tags,
            watchResponse: WatchInstantResponse(
                eyebrow: "已保存",
                headline: "这是一段真实记录",
                body: "先保留原始表达，稍后再从里面看见主题和趋势。",
                footnote: "完整内容在 iPhone",
                accent: .gray
            ),
            detail: PresenceRecordDetail(
                title: "日常记录",
                primaryText: "这段内容先作为原始观察保存。",
                scripture: "",
                prayer: "",
                action: "稍后看是否需要整理成想法、祷告或任务。",
                question: "这里面最值得保留的一点是什么？",
                answer: "",
                nextSteps: ["保留原文", "后续自动归类"]
            ),
            responseMode: responseMode
        )
    }
}
