import CoreML
import CryptoKit
import Foundation
import UIKit

private struct CalibrationImage: Decodable {
    let url: String
    let file: String
    let pixel_sha256: String
}

enum Benchmark {
    static func residentBytes() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? info.resident_size : 0
    }

    static func image(_ file: URL, size: Int, hash: String) throws -> MLFeatureProvider {
        let rgb = try Data(contentsOf: file)
        guard rgb.count == size * size * 3,
              SHA256.hash(data: rgb).map({ String(format: "%02x", $0) }).joined() == hash else {
            throw NSError(domain: "Invalid calibration pixels", code: 1)
        }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, size, size, kCVPixelFormatType_32BGRA,
                                  [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary,
                                  &buffer) == kCVReturnSuccess, let buffer else {
            throw NSError(domain: "Pixel buffer allocation", code: 1)
        }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        let pixels = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        for y in 0..<size {
            for x in 0..<size {
                let source = (y * size + x) * 3
                let target = y * stride + x * 4
                pixels[target] = rgb[source + 2]
                pixels[target + 1] = rgb[source + 1]
                pixels[target + 2] = rgb[source]
                pixels[target + 3] = 255
            }
        }
        return try MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(pixelBuffer: buffer)])
    }

    static func embedding(_ model: MLModel, input: MLFeatureProvider) throws -> [Double] {
        let prediction = try model.prediction(from: input)
        guard let array = prediction.featureValue(for: "embedding")?.multiArrayValue,
              array.count == 1536 else {
            throw NSError(domain: "Unexpected embedding shape", code: 1)
        }
        let vector = (0..<array.count).map { array[$0].doubleValue }
        guard vector.allSatisfy(\.isFinite), vector.contains(where: { $0 != 0 }) else {
            throw NSError(domain: "Nonfinite or zero embedding", code: 1)
        }
        return vector
    }

    static func run() async throws -> String {
        let args = ProcessInfo.processInfo.arguments
        func argument(_ flag: String, fallback: String) -> String {
            guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return fallback }
            return args[index + 1]
        }
        let name = argument("--model", fallback: "CRadioV3B")
        let units = argument("--units", fallback: "cpuAndNeuralEngine")
        guard let size = Int(argument("--size", fallback: "512")), [448, 512].contains(size),
              ["all", "cpuAndNeuralEngine"].contains(units) else {
            throw NSError(domain: "Invalid benchmark arguments", code: 1)
        }
        let documents = URL.documentsDirectory
        let source = documents.appending(path: "\(name).mlpackage")
        let weights = try Data(contentsOf: source.appending(path: "Data/com.apple.CoreML/weights/weight.bin"), options: .mappedIfSafe)
        let weightsHash = SHA256.hash(data: weights).map { String(format: "%02x", $0) }.joined()
        let calibration = documents.appending(path: "calibration-\(size)")
        let manifest = try JSONDecoder().decode([CalibrationImage].self,
            from: Data(contentsOf: calibration.appending(path: "manifest.json")))
        guard let first = manifest.first else { throw NSError(domain: "Empty calibration", code: 1) }
        let input = try image(calibration.appending(path: first.file), size: size, hash: first.pixel_sha256)
        let thermalBefore = ProcessInfo.processInfo.thermalState.rawValue
        let configuration = MLModelConfiguration()
        configuration.computeUnits = units == "all" ? .all : .cpuAndNeuralEngine
        let compilationStart = CFAbsoluteTimeGetCurrent()
        let compiled = try await MLModel.compileModel(at: source)
        let compileMs = (CFAbsoluteTimeGetCurrent() - compilationStart) * 1000
        let baseline = residentBytes()
        let loadStart = CFAbsoluteTimeGetCurrent()
        let model = try MLModel(contentsOf: compiled, configuration: configuration)
        let loadMs = (CFAbsoluteTimeGetCurrent() - loadStart) * 1000
        let loaded = residentBytes()
        var peak = loaded
        for _ in 0..<5 { _ = try embedding(model, input: input) }
        var timings: [Double] = []
        for _ in 0..<50 {
            let start = CFAbsoluteTimeGetCurrent()
            _ = try autoreleasepool { try embedding(model, input: input) }
            timings.append((CFAbsoluteTimeGetCurrent() - start) * 1000)
            peak = max(peak, residentBytes())
        }
        let plan = try await MLComputePlan.load(contentsOf: compiled, configuration: configuration)
        var operations: [[String: Any]] = []
        func visit(_ block: MLModelStructure.Program.Block) {
            for op in block.operations {
                let usage = plan.deviceUsage(for: op)
                let preferred = usage.map { String(describing: $0.preferred) }
                operations.append(["operator": op.operatorName,
                    "outputs": op.outputs.map(\.name),
                    "preferred": preferred ?? "unassigned",
                    "estimated_cost": plan.estimatedCost(of: op)?.weight as Any? ?? NSNull()])
                op.blocks.forEach(visit)
            }
        }
        if case .program(let program) = plan.modelStructure {
            program.functions.values.forEach { visit($0.block) }
        }
        var embeddings: [String: [Double]] = [:]
        for record in manifest {
            embeddings[record.url] = try autoreleasepool {
                let features = try image(calibration.appending(path: record.file), size: size, hash: record.pixel_sha256)
                return try embedding(model, input: features)
            }
            peak = max(peak, residentBytes())
        }
        let sorted = timings.sorted()
        let report: [String: Any] = [
            "model": name, "size": size, "compute_units": units,
            "weights_sha256": weightsHash,
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "compile_ms": compileMs, "load_ms": loadMs,
            "prediction_median_ms": (sorted[24] + sorted[25]) / 2,
            "prediction_ms": timings, "warmup_count": 5,
            "resident_baseline_bytes": baseline, "resident_loaded_bytes": loaded,
            "resident_sampled_peak_bytes": peak,
            "thermal_before": thermalBefore,
            "thermal_after": ProcessInfo.processInfo.thermalState.rawValue,
            "operations": operations, "embedding_count": embeddings.count,
        ]
        let reportURL = documents.appending(path: "\(name)-\(units)-report.json")
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: reportURL, options: .atomic)
        try JSONSerialization.data(withJSONObject: embeddings, options: [.sortedKeys])
            .write(to: documents.appending(path: "\(name)-\(units)-embeddings.json"), options: .atomic)
        let summary = "\(name), \(units): median \((sorted[24] + sorted[25]) / 2) ms; \(embeddings.count) embeddings.\nSaved \(reportURL.lastPathComponent)"
        print(summary)
        return summary
    }
}
