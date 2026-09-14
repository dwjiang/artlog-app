import CoreGraphics
import CoreML
import CoreVideo
import Foundation
import ImageIO

/// `model-manifest.json`, written by `scripts/model/export_coreml.py` next to the compiled model.
struct ModelManifest: Decodable {
  let modelVersion: String
  let modelName: String
  let inputSize: Int
  let embeddingDim: Int
  let inputName: String
  let outputName: String
  let weightsSha256: String

  static func load(from url: URL) throws -> ModelManifest {
    try JSONDecoder().decode(ModelManifest.self, from: Data(contentsOf: url))
  }
}

enum EmbedError: Error, CustomStringConvertible {
  case modelMissing(String)
  case badInput(String)
  case badOutput(String)

  var code: String {
    switch self {
    case .modelMissing: return "model_missing"
    case .badInput: return "bad_input"
    case .badOutput: return "bad_output"
    }
  }

  var description: String {
    switch self {
    case .modelMissing(let message), .badInput(let message), .badOutput(let message): return message
    }
  }
}

struct WarmUpResult {
  let loadMs: Double
  let predictMs: Double
  let alreadyLoaded: Bool
}

/// Loads the compiled model once and turns upright `inputSize`×`inputSize` crop files into
/// L2-normalized vectors. Safe to call from several threads; loading holds the lock.
final class Embedder {
  /// Measured at the same latency as `.all` with ~80 MB less resident memory.
  static let computeUnits: MLComputeUnits = .cpuAndNeuralEngine

  let manifest: ModelManifest
  private let modelURL: URL
  private let lock = NSLock()
  private var model: MLModel?

  init(modelURL: URL, manifest: ModelManifest) {
    self.modelURL = modelURL
    self.manifest = manifest
  }

  /// A directory laid out as `npm run model:fetch` leaves it: `model-manifest.json` plus the `.mlmodelc`.
  convenience init(modelsDirectory: URL) throws {
    let manifestURL = modelsDirectory.appendingPathComponent("model-manifest.json")
    guard FileManager.default.fileExists(atPath: manifestURL.path) else {
      throw EmbedError.modelMissing("No model-manifest.json in \(modelsDirectory.path)")
    }
    let manifest = try ModelManifest.load(from: manifestURL)
    self.init(modelURL: modelsDirectory.appendingPathComponent("\(manifest.modelName).mlmodelc"), manifest: manifest)
  }

  func warmUp() throws -> WarmUpResult {
    let loadStarted = Date()
    let (model, alreadyLoaded) = try loadedModel()
    let loadMs = alreadyLoaded ? 0 : Date().timeIntervalSince(loadStarted) * 1000
    let predictStarted = Date()
    _ = try predict(model, buffer: try PixelBuffers.black(size: manifest.inputSize))
    return WarmUpResult(loadMs: loadMs, predictMs: Date().timeIntervalSince(predictStarted) * 1000, alreadyLoaded: alreadyLoaded)
  }

  func embed(fileURL: URL) throws -> [Float] {
    let (model, _) = try loadedModel()
    let image = try ImageFiles.decode(fileURL)
    let size = manifest.inputSize
    guard image.width == size, image.height == size else {
      throw EmbedError.badInput("Expected a \(size)×\(size) crop, got \(image.width)×\(image.height): \(fileURL.lastPathComponent)")
    }
    return try Self.normalized(try predict(model, buffer: try PixelBuffers.bgra(from: image)))
  }

  private func loadedModel() throws -> (MLModel, Bool) {
    lock.lock()
    defer { lock.unlock() }
    if let model { return (model, true) }
    guard FileManager.default.fileExists(atPath: modelURL.path) else {
      throw EmbedError.modelMissing("\(modelURL.lastPathComponent) is not bundled; run `npm run model:fetch` and rebuild")
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = Self.computeUnits
    let model = try MLModel(contentsOf: modelURL, configuration: configuration)
    self.model = model
    return (model, false)
  }

  private func predict(_ model: MLModel, buffer: CVPixelBuffer) throws -> [Float] {
    let input = try MLDictionaryFeatureProvider(dictionary: [manifest.inputName: MLFeatureValue(pixelBuffer: buffer)])
    let output = try model.prediction(from: input)
    guard let array = output.featureValue(for: manifest.outputName)?.multiArrayValue else {
      throw EmbedError.badOutput("The model returned no \(manifest.outputName) output")
    }
    guard array.count == manifest.embeddingDim else {
      throw EmbedError.badOutput("The model returned \(array.count) values, expected \(manifest.embeddingDim)")
    }
    return (0..<array.count).map { array[$0].floatValue }
  }

  static func normalized(_ vector: [Float]) throws -> [Float] {
    var sum = 0.0
    for value in vector {
      guard value.isFinite else { throw EmbedError.badOutput("The embedding contains a non-finite value") }
      sum += Double(value) * Double(value)
    }
    let norm = sum.squareRoot()
    guard norm > 0 else { throw EmbedError.badOutput("The embedding is all zeros") }
    return vector.map { Float(Double($0) / norm) }
  }
}

enum ImageFiles {
  /// The stored pixels; crops are written upright by the vision-rect module, so EXIF orientation is not applied.
  static func decode(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw EmbedError.badInput("Cannot decode the image at \(url.path)")
    }
    return image
  }
}

enum PixelBuffers {
  private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
  private static let bgraBitmapInfo = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

  static func black(size: Int) throws -> CVPixelBuffer {
    let buffer = try allocate(width: size, height: size)
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw EmbedError.badInput("Pixel buffer has no backing store") }
    memset(base, 0, CVPixelBufferGetBytesPerRow(buffer) * size)
    return buffer
  }

  /// A 32BGRA buffer holding the image's sRGB pixels copied 1:1, without resampling.
  static func bgra(from image: CGImage) throws -> CVPixelBuffer {
    let buffer = try allocate(width: image.width, height: image.height)
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(buffer),
          let context = CGContext(
            data: base, width: image.width, height: image.height, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: sRGB, bitmapInfo: bgraBitmapInfo
          ) else {
      throw EmbedError.badInput("Cannot draw into the pixel buffer")
    }
    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return buffer
  }

  private static func allocate(width: Int, height: Int) throws -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
      [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer
    )
    guard status == kCVReturnSuccess, let buffer else {
      throw EmbedError.badInput("Cannot allocate a \(width)×\(height) pixel buffer (\(status))")
    }
    return buffer
  }
}
