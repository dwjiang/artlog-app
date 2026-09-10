// macOS harness for the coreml-embed Swift core: loads the fetched .mlmodelc exactly as the phone
// does and embeds letterboxed crops, so the pixel path and numerics can be checked without a device.
//
//   swiftc -O -framework CoreML -framework ImageIO \
//     modules/coreml-embed/ios/Embedder.swift modules/coreml-embed/scripts/mac-harness.swift -o /tmp/coreml-embed-harness
//   /tmp/coreml-embed-harness modules/coreml-embed/ios/Models <crop.png>... > embeddings.json
import Foundation

@main
struct Harness {
  static func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
  }

  static func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count >= 3 else { fail("usage: <models-dir> <crop>...") }
    let embedder = try Embedder(modelsDirectory: URL(fileURLWithPath: arguments[1]))
    let warm = try embedder.warmUp()
    var embeddings: [String: [Float]] = [:]
    var timings: [Double] = []
    for path in arguments.dropFirst(2) {
      let started = Date()
      embeddings[path] = try embedder.embed(fileURL: URL(fileURLWithPath: path))
      timings.append(Date().timeIntervalSince(started) * 1000)
    }
    let sorted = timings.sorted()
    let report: [String: Any] = [
      "modelVersion": embedder.manifest.modelVersion,
      "weightsSha256": embedder.manifest.weightsSha256,
      "computeUnits": "\(Embedder.computeUnits)",
      "loadMs": warm.loadMs,
      "warmPredictMs": warm.predictMs,
      "count": timings.count,
      "medianMs": sorted.isEmpty ? 0 : sorted[sorted.count / 2],
      "embeddings": embeddings,
    ]
    let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardError.write("load \(Int(warm.loadMs)) ms, \(timings.count) crops, median \(report["medianMs"]!) ms\n".data(using: .utf8)!)
  }
}
