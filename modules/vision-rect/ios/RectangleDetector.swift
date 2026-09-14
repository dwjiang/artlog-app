import CoreGraphics
import CoreMedia
import Foundation
import ImageIO
import Vision

enum RectangleDetectorTuning {
  static let minimumConfidence: Float = 0.6
  static let minimumAspectRatio: Float = 0.3
  static let maximumAspectRatio: Float = 1.0
  static let minimumSize: Float = 0.2
  static let maximumObservations = 3
  static let quadratureTolerance: Float = 20
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

  static func detect(sampleBuffer: CMSampleBuffer, orientation: CGImagePropertyOrientation) throws -> [DetectedRectangle] {
    let handler = VNImageRequestHandler(cmSampleBuffer: sampleBuffer, orientation: orientation, options: [:])
    return try detect(handler: handler)
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
