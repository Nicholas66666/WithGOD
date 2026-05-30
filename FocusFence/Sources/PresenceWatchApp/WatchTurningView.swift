import SwiftUI
import WatchKit

struct WatchTurningView: View {
    @EnvironmentObject private var recorder: TurningRecorderViewModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .task {
                recorder.consumePendingShortcutStartRepeatedly()
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                recorder.consumePendingShortcutStartRepeatedly()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let reflection = recorder.reflection {
            reflectionView(reflection)
        } else {
            recorderView
        }
    }

    private var recorderView: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 0)

            statusIcon

            VStack(spacing: 5) {
                Text(recorder.title)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text(recorder.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                recorder.toggleRecording()
            } label: {
                Text(recorder.buttonTitle)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? .red : .blue)

            Spacer(minLength: 0)
        }
        .padding()
    }

    private var statusIcon: some View {
        ZStack {
            Circle()
                .fill(recorder.statusColor.opacity(0.18))
                .frame(width: 54, height: 54)
            Image(systemName: recorder.statusSystemImage)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(recorder.statusColor)
        }
    }

    private func reflectionView(_ reflection: TurningReflection) -> some View {
        GeometryReader { proxy in
            QuickResponseCardView(
                reflection: reflection,
                accent: accentColor(reflection.accent),
                onDone: recorder.reset
            )
            .frame(width: proxy.size.width, height: proxy.size.height)
            .persistentSystemOverlays(.hidden)
        }
    }

    private func accentColor(_ accent: WatchResponseAccent) -> Color {
        switch accent {
        case .green:
            return Color(red: 0.86, green: 0.68, blue: 0.24)
        case .blue:
            return .blue
        case .gold:
            return Color(red: 0.86, green: 0.68, blue: 0.24)
        case .red:
            return .red
        case .gray:
            return .gray
        }
    }
}

private struct QuickResponseCardView: View {
    let reflection: TurningReflection
    let accent: Color
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Circle()
                    .fill(accent)
                    .frame(width: 8, height: 8)
                Text(clean(reflection.eyebrow))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            Text(clean(reflection.headline))
                .font(.system(size: 30, weight: .black))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.62)

            Text(clean(reflection.body))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary.opacity(0.86))
                .lineLimit(4)
                .minimumScaleFactor(0.68)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)

            if !clean(reflection.footnote).isEmpty {
                Text(debugExpandedFootnote(reflection.footnote))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(accent)
                    .lineLimit(isRealtimeFailure(reflection.footnote) ? 6 : 2)
                    .minimumScaleFactor(isRealtimeFailure(reflection.footnote) ? 0.55 : 0.7)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.black)
        .contentShape(Rectangle())
        .onTapGesture(perform: onDone)
    }

    private func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func isRealtimeFailure(_ text: String) -> Bool {
        text.contains("实时失败")
    }

    private func debugExpandedFootnote(_ text: String) -> String {
        guard isRealtimeFailure(text) else {
            return clean(text)
        }
        return text
            .replacingOccurrences(of: " · 实时失败:", with: "\n实时失败：")
            .replacingOccurrences(of: "实时失败:", with: "实时失败：")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct ScripturePosterResponseView: View {
    let reflection: TurningReflection
    let accent: Color
    let scale: CGFloat
    let onDone: () -> Void

    private var lines: [String] {
        splitResponseBody(reflection.body)
    }

    var body: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width / 206, proxy.size.height / 242)
            let horizontal = 10 * s
            let contentWidth = proxy.size.width - horizontal * 2

            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 5 * s)
                topBand(s, width: contentWidth)
                hairline.padding(.vertical, 5 * s)
                headlineBand(s, width: contentWidth)
                hairline.padding(.vertical, 5 * s)
                bodyBand(s, width: contentWidth)
                Spacer(minLength: 2 * s)
                bottomBand(s, width: contentWidth)
            }
            .padding(.horizontal, horizontal)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .background(.black)
        .contentShape(Rectangle())
        .onTapGesture(perform: onDone)
    }

    private func topBand(_ s: CGFloat, width: CGFloat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7 * s) {
            PosterText(clean(reflection.eyebrow), size: 22, weight: .black, scale: s)
            if !clean(reflection.footnote).isEmpty {
                PosterText(clean(reflection.footnote), size: 18, weight: .heavy, color: accent, scale: s)
            }
        }
        .frame(width: width, alignment: .leading)
    }

    private func headlineBand(_ s: CGFloat, width: CGFloat) -> some View {
        let headline = clean(reflection.headline)
        return VStack(alignment: .leading, spacing: -3 * s) {
            if headline.count > 5 {
                let parts = splitHeadline(headline)
                PosterText(parts.lead, size: 31, weight: .black, color: .white.opacity(0.88), scale: s)
                PosterText(parts.core, size: headlineCoreSize(parts.core), weight: .black, color: accent, scale: s)
            } else {
                PosterText(headline, size: headlineCoreSize(headline), weight: .black, color: accent, scale: s)
            }
        }
        .frame(width: width, alignment: .leading)
    }

    private func bodyBand(_ s: CGFloat, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 2 * s) {
            ForEach(Array(lines.prefix(3).enumerated()), id: \.offset) { index, line in
                PosterText(
                    line,
                    size: bodySize(index: index, text: line),
                    weight: index == 1 ? .black : .heavy,
                    color: bodyColor(index: index),
                    scale: s
                )
                .frame(width: width, alignment: .leading)
            }
        }
    }

    private func bottomBand(_ s: CGFloat, width: CGFloat) -> some View {
        HStack(spacing: 7 * s) {
            Rectangle()
                .fill(.white.opacity(0.18))
                .frame(height: 1)
            let footnote = clean(reflection.footnote)
            if !footnote.isEmpty {
                Text(footnote)
                    .font(.system(size: 12 * s, weight: .bold))
                    .foregroundStyle(accent.opacity(0.95))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Rectangle()
                .fill(.white.opacity(0.18))
                .frame(height: 1)
        }
        .frame(width: width)
    }

    private var hairline: some View {
        Rectangle()
            .fill(.white.opacity(0.16))
            .frame(height: 1)
    }

    private func splitHeadline(_ text: String) -> (lead: String, core: String) {
        let text = clean(text)
        guard text.count > 5 else {
            return ("", text)
        }
        let split = text.index(text.endIndex, offsetBy: -min(3, max(2, text.count / 2)))
        return (String(text[..<split]), String(text[split...]))
    }

    private func splitResponseBody(_ text: String) -> [String] {
        let cleaned = clean(text)
        let chunks = cleaned
            .split(whereSeparator: { "，,；;。".contains($0) })
            .map { clean(String($0)) }
            .filter { !$0.isEmpty }

        if chunks.count >= 2 {
            return chunks.map { clamp($0, max: 12) }
        }

        return splitByLength(cleaned, maxLength: 9).prefix(3).map { $0 }
    }

    private func splitByLength(_ text: String, maxLength: Int) -> [String] {
        guard !text.isEmpty else { return [] }
        var result: [String] = []
        var current = ""
        for character in text {
            current.append(character)
            if current.count >= maxLength {
                result.append(current)
                current = ""
            }
        }
        if !current.isEmpty {
            result.append(current)
        }
        return result
    }

    private func headlineCoreSize(_ text: String) -> CGFloat {
        switch text.count {
        case 0...2: 76
        case 3: 68
        case 4: 60
        case 5...6: 50
        default: 42
        }
    }

    private func bodySize(index: Int, text: String) -> CGFloat {
        if index == 1 {
            return text.count <= 6 ? 37 : 31
        }
        return text.count <= 7 ? 27 : 23
    }

    private func bodyColor(index: Int) -> Color {
        switch index {
        case 1: accent
        case 2: .white.opacity(0.72)
        default: .white
        }
    }

    private func clamp(_ text: String, max length: Int) -> String {
        let text = clean(text)
        guard text.count > length else { return text }
        return String(text.prefix(length))
    }

    private func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct PosterText: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    let color: Color
    let scale: CGFloat

    init(_ text: String, size: CGFloat, weight: Font.Weight, color: Color = .white, scale: CGFloat) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.scale = scale
    }

    var body: some View {
        Text(text)
            .font(.system(size: size * scale, weight: weight))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.42)
            .allowsTightening(true)
    }
}

private struct WordCloudResponseView: View {
    let reflection: TurningReflection
    let accent: Color
    let scale: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 8 * scale) {
            topLine
            divider
            headlineBlock
            divider
            bodyCloud
            sourceLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var topLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5 * scale) {
            Text(clamp(reflection.eyebrow, max: 8))
                .font(.system(size: 19 * scale, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            Text(clamp(reflection.footnote, max: 8))
                .font(.system(size: 18 * scale, weight: .heavy))
                .foregroundStyle(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.58)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headlineBlock: some View {
        let parts = headlineParts(reflection.headline)
        return VStack(alignment: .leading, spacing: -6 * scale) {
            if let lead = parts.lead {
                Text(lead)
                    .font(.system(size: 31 * scale, weight: .heavy))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.58)
            }

            Text(parts.core)
                .font(.system(size: coreFontSize(for: parts.core) * scale, weight: .black))
                .foregroundStyle(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.48)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let tail = parts.tail {
                Text(tail)
                    .font(.system(size: 29 * scale, weight: .heavy))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.58)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var bodyCloud: some View {
        let lines = splitBody(reflection.body)
        return VStack(alignment: .leading, spacing: 0) {
            if lines.count >= 2 {
                HStack(alignment: .firstTextBaseline, spacing: 7 * scale) {
                    Text(lines[0])
                        .font(.system(size: 22 * scale, weight: .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.52)
                    Text(lines[1])
                        .font(.system(size: 17 * scale, weight: .bold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.52)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if let first = lines.first {
                Text(first)
                    .font(.system(size: 22 * scale, weight: .heavy))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.52)
            }

            if lines.count >= 3 {
                Text(lines[2])
                    .font(.system(size: 25 * scale, weight: .black))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                    .minimumScaleFactor(0.52)
            }
        }
    }

    private var sourceLine: some View {
        HStack(spacing: 8 * scale) {
            Rectangle()
                .fill(.white.opacity(0.16))
                .frame(height: 1)
            Text(sourceText(from: reflection.body))
                .font(.system(size: 12 * scale, weight: .bold))
                .foregroundStyle(accent.opacity(0.92))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Rectangle()
                .fill(.white.opacity(0.16))
                .frame(height: 1)
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(.white.opacity(0.14))
            .frame(height: 1)
            .padding(.horizontal, 6 * scale)
    }

    private func headlineParts(_ text: String) -> (lead: String?, core: String, tail: String?) {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)

        let digitStart = cleaned.firstIndex(where: { $0.isNumber })
        if let digitStart {
            let lead = String(cleaned[..<digitStart]).trimmingCharacters(in: .whitespaces)
            let core = String(cleaned[digitStart...]).trimmingCharacters(in: .whitespaces)
            return (lead.isEmpty ? nil : lead, core, nil)
        }

        if cleaned.count <= 4 {
            return (nil, cleaned, nil)
        }

        let separators = ["，", ",", "。", " "]
        if let separator = separators.first(where: { cleaned.contains($0) }),
           let range = cleaned.range(of: separator) {
            let lead = String(cleaned[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
            let core = String(cleaned[range.upperBound...]).trimmingCharacters(in: .whitespaces)
            return (lead.isEmpty ? nil : lead, core.isEmpty ? cleaned : core, nil)
        }

        let splitIndex = cleaned.index(cleaned.startIndex, offsetBy: max(2, cleaned.count - 2))
        return (String(cleaned[..<splitIndex]), String(cleaned[splitIndex...]), nil)
    }

    private func splitBody(_ text: String) -> [String] {
        var cleaned = text
            .replacingOccurrences(of: "。", with: "")
            .replacingOccurrences(of: "，", with: "，")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        ["雅 1:19", "腓 4:6", "约一 1:9", "箴 3:5", "诗 119:105"].forEach { reference in
            cleaned = cleaned.replacingOccurrences(of: reference, with: "")
        }

        let withoutSource = cleaned
            .replacingOccurrences(of: "。", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let chunks = withoutSource
            .split(whereSeparator: { "，,；;".contains($0) })
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        if chunks.isEmpty {
            return [clamp(cleaned, max: 13)]
        }

        return Array(chunks.prefix(3)).map { clamp($0, max: 13) }
    }

    private func sourceText(from text: String) -> String {
        let references = ["雅 1:19", "腓 4:6", "约一 1:9", "箴 3:5", "诗 119:105"]
        if let reference = references.first(where: { text.contains($0) }) {
            return reference
        }
        return "完整内容已保存"
    }

    private func coreFontSize(for text: String) -> CGFloat {
        switch text.count {
        case 0...3:
            return 47
        case 4...5:
            return 43
        case 6...8:
            return 37
        default:
            return 31
        }
    }

    private func clamp(_ text: String, max length: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > length else {
            return trimmed
        }
        return String(trimmed.prefix(length))
    }
}
