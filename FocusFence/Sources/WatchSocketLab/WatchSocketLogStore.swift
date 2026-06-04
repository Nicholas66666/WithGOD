import Foundation

struct WatchSocketLogStore {
    private(set) var lines: [String] = []

    var text: String {
        lines.joined(separator: "\n")
    }

    mutating func append(_ event: String, fields: [String: Any] = [:]) {
        var object = fields
        object["ts"] = ISO8601DateFormatter().string(from: Date())
        object["event"] = event

        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else {
            lines.append("{\"event\":\"log_encoding_failed\"}")
            return
        }

        lines.append(line)
        if lines.count > 400 {
            lines.removeFirst(lines.count - 400)
        }
    }
}
