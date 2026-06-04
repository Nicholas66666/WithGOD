import SwiftUI

struct WatchSocketLabView: View {
    @StateObject private var model = WatchSocketLabModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("SocketLab")
                    .font(.headline)

                TextField("wss://host/ws/echo", text: $model.wssURLString)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)

                metric("State", model.state)
                metric("Audio", model.audioState)
                metric("Route", model.route)
                metric("Health", model.healthStatus)
                metric("Connect", model.connectMs.map { "\($0) ms" } ?? "-")
                metric("NW", model.nwConnectMs.map { "\($0) ms" } ?? "-")
                metric("NW RTT", model.nwRTTMs.map { "\($0) ms" } ?? "-")
                metric("First RTT", model.firstBinaryRTTMs.map { "\($0) ms" } ?? "-")
                metric("Sent", "\(model.framesSent)")
                metric("Recv", "\(model.framesReceived)")
                metric("Disc", "\(model.disconnectCount)")
                metric("Duration", "\(model.durationSeconds)s")

                if !model.lastError.isEmpty {
                    Text(model.lastError)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }

                HStack {
                    Button("Health") { model.checkHealth() }
                    Button("Audio") { model.activateAudio() }
                }
                HStack {
                    Button("Connect") { model.connect() }
                    Button("NW") { model.probeNetworkWebSocket() }
                }
                HStack {
                    Button("Echo") { model.startBinaryEcho() }
                    Button("Abort") { model.simulateAbort() }
                }
                HStack {
                    Button("Stop") { model.stop() }
                    Button("Summary") { model.markSummary() }
                }

                Text(model.logText)
                    .font(.system(size: 8, design: .monospaced))
            }
            .padding(.horizontal, 8)
        }
    }

    private func metric(_ name: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(name)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer(minLength: 6)
            Text(value)
                .font(.caption2.monospacedDigit())
                .multilineTextAlignment(.trailing)
        }
    }
}
