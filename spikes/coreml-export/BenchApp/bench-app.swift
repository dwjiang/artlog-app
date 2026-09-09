import SwiftUI

@main
struct BenchApp: App {
    @State private var status = "Ready"

    var body: some Scene {
        WindowGroup {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("CoreML export benchmark").font(.title)
                    Text(status).textSelection(.enabled)
                }.padding()
            }
            .preferredColorScheme(.light)
            .task {
                UIApplication.shared.isIdleTimerDisabled = true
                status = "Benchmark running…"
                do {
                    let report = try await Task.detached(priority: .userInitiated) {
                        try await Benchmark.run()
                    }.value
                    status = report
                } catch {
                    status = "Failed: \(error)"
                    print(status)
                    if ProcessInfo.processInfo.arguments.contains("--exit-after-run") { exit(1) }
                }
                UIApplication.shared.isIdleTimerDisabled = false
                if ProcessInfo.processInfo.arguments.contains("--exit-after-run") { exit(0) }
            }
        }
    }
}
