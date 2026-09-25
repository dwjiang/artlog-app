import CoreGraphics
import CoreImage
import CoreMedia
import Foundation
import ImageIO
import Vision

enum RectangleDetectorTuning {
  /// Vision reported 1.0 for every rectangle it returned on 49 gallery photographs, so a floor only ever drops candidates.
  static let minimumConfidence: Float = 0
  static let minimumAspectRatio: Float = 0.3
  static let maximumAspectRatio: Float = 1.0
  static let minimumSize: Float = 0.15
  static let maximumObservations = 5
  static let quadratureTolerance: Float = 30
  /// Vision's candidates come and go with input resolution: a framed portrait found at 1440 px vanished at 960 px
  /// and returned at 640 px. Each image is analyzed at its own size and at these fractions of it, and the union
  /// found the painting in 13 of 14 wall photographs against 10 for the full size alone.
  static let extraScales: [CGFloat] = [2.0 / 3.0, 4.0 / 9.0]
  /// Normalized corner distance under which candidates from different scales are the same rectangle.
  static let duplicateDistance: CGFloat = 0.02
}

/// Corners are normalized to the upright image with the origin at the top-left, in the order
/// top-left, top-right, bottom-right, bottom-left.
struct DetectedRectangle {
  let confidence: Float
  let corners: [CGPoint]

  var area: CGFloat { quadArea(corners) }

  /// Axis-aligned bounds of the corners.
  var bounds: CGRect {
    let xs = corners.map(\.x)
    let ys = corners.map(\.y)
    return CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
  }
}

func quadArea(_ corners: [CGPoint]) -> CGFloat {
  var twiceArea: CGFloat = 0
  for index in corners.indices {
    let a = corners[index]
    let b = corners[(index + 1) % corners.count]
    twiceArea += a.x * b.y - b.x * a.y
  }
  return abs(twiceArea) / 2
}

enum RectangleDetector {
  /// Without one, Vision builds its own Core Image context for every scaled handler, twice per live frame.
  private static let ciContext = CIContext()

  static func makeRequest() -> VNDetectRectanglesRequest {
    let request = VNDetectRectanglesRequest()
    request.minimumConfidence = RectangleDetectorTuning.minimumConfidence
    request.minimumAspectRatio = RectangleDetectorTuning.minimumAspectRatio
    request.maximumAspectRatio = RectangleDetectorTuning.maximumAspectRatio
    request.minimumSize = RectangleDetectorTuning.minimumSize
    request.maximumObservations = RectangleDetectorTuning.maximumObservations
    request.quadratureTolerance = RectangleDetectorTuning.quadratureTolerance
    return request
  }

  static func detect(handler: VNImageRequestHandler) throws -> [DetectedRectangle] {
    let request = makeRequest()
    try handler.perform([request])
    return rectangles(from: request)
  }

  /// Runs every handler and merges the candidates, keeping the first of any duplicates. Largest first.
  static func detect(handlers: [VNImageRequestHandler]) throws -> [DetectedRectangle] {
    var merged: [DetectedRectangle] = []
    for handler in handlers {
      for rectangle in try detect(handler: handler) where !merged.contains(where: { isDuplicate($0, rectangle) }) {
        merged.append(rectangle)
      }
    }
    return merged.sorted { $0.area > $1.area }
  }

  private static func isDuplicate(_ a: DetectedRectangle, _ b: DetectedRectangle) -> Bool {
    return zip(a.corners, b.corners).allSatisfy { hypot($0.x - $1.x, $0.y - $1.y) < RectangleDetectorTuning.duplicateDistance }
  }

  private static func scaledHandlers(_ image: CIImage, orientation: CGImagePropertyOrientation) -> [VNImageRequestHandler] {
    return RectangleDetectorTuning.extraScales.map { scale in
      VNImageRequestHandler(
        ciImage: image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
        orientation: orientation,
        options: [.ciContext: ciContext]
      )
    }
  }

  /// Detects at the image's own size and at each of `extraScales`.
  static func detect(cgImage: CGImage) throws -> [DetectedRectangle] {
    let full = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    return try detect(handlers: [full] + scaledHandlers(CIImage(cgImage: cgImage), orientation: .up))
  }

  /// Largest first.
  static func rectangles(from request: VNDetectRectanglesRequest) -> [DetectedRectangle] {
    let rectangles = (request.results ?? []).map { observation in
      // Vision reports normalized corners with the origin at the bottom-left.
      let corners = [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]
      return DetectedRectangle(
        confidence: observation.confidence,
        corners: corners.map { CGPoint(x: $0.x, y: 1 - $0.y) }
      )
    }
    return rectangles.sorted { $0.area > $1.area }
  }

  /// Detects at the frame's own size and at each of `extraScales`.
  static func detect(sampleBuffer: CMSampleBuffer, orientation: CGImagePropertyOrientation) throws -> [DetectedRectangle] {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw VisionRectError("Frame has no image buffer")
    }
    let full = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    return try detect(handlers: [full] + scaledHandlers(CIImage(cvPixelBuffer: pixelBuffer), orientation: orientation))
  }
}

struct VisionRectError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

struct ImageFileProperties {
  let pixelWidth: Int
  let pixelHeight: Int
  let orientation: CGImagePropertyOrientation

  var uprightWidth: Int { orientation.swapsDimensions ? pixelHeight : pixelWidth }
  var uprightHeight: Int { orientation.swapsDimensions ? pixelWidth : pixelHeight }
}

extension CGImagePropertyOrientation {
  var swapsDimensions: Bool {
    switch self {
    case .left, .right, .leftMirrored, .rightMirrored: return true
    default: return false
    }
  }
}

enum ImageFile {
  static func source(_ url: URL) throws -> CGImageSource {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0 else {
      throw VisionRectError("Cannot open image at \(url.path)")
    }
    return source
  }

  static func properties(of url: URL) throws -> ImageFileProperties {
    return try properties(of: try source(url), path: url.path)
  }

  static func properties(of source: CGImageSource, path: String) throws -> ImageFileProperties {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int else {
      throw VisionRectError("Cannot read image size of \(path)")
    }
    let rawOrientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
    return ImageFileProperties(
      pixelWidth: width,
      pixelHeight: height,
      orientation: CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    )
  }

  static func load(_ url: URL) throws -> (image: CGImage, orientation: CGImagePropertyOrientation) {
    let source = try self.source(url)
    let properties = try self.properties(of: source, path: url.path)
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let image = CGImageSourceCreateImageAtIndex(source, 0, options) else {
      throw VisionRectError("Cannot decode image at \(url.path)")
    }
    return (image, properties.orientation)
  }
}
