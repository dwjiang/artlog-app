import CoreGraphics
import CoreImage
import Foundation
import ImageIO

/// Keep resize interpolation and output encoding in sync with the Python letterbox.
enum LetterboxTuning {
  static let interpolation: CGInterpolationQuality = .medium
  static let jpegQuality: CGFloat = 0.95
}

struct LetterboxOutput {
  let image: CGImage
  /// Per-channel mean of the resized image, the pad color.
  let meanColor: (r: Int, g: Int, b: Int)
}

/// Whole-image quad in normalized top-left-origin coordinates.
let wholeImageQuad = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]

private let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
private let rgbxBitmapInfo = CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

/// An 8-bit RGBX bitmap with rows stored top to bottom.
struct RGBXBitmap {
  let width: Int
  let height: Int
  var data: [UInt8]

  var bytesPerRow: Int { width * 4 }

  static func render(
    _ image: CGImage,
    orientation: CGImagePropertyOrientation,
    width: Int,
    height: Int,
    interpolation: CGInterpolationQuality
  ) throws -> RGBXBitmap {
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: sRGB, bitmapInfo: rgbxBitmapInfo
    ) else {
      throw VisionRectError("Cannot create a \(width)×\(height) bitmap")
    }
    context.interpolationQuality = interpolation
    let drawSize = orientation.swapsDimensions
      ? CGSize(width: height, height: width)
      : CGSize(width: width, height: height)
    context.concatenate(orientation.uprightTransform(outputWidth: CGFloat(width), outputHeight: CGFloat(height)))
    context.draw(image, in: CGRect(origin: .zero, size: drawSize))
    guard let pointer = context.data else { throw VisionRectError("Bitmap has no backing store") }
    let bytes = pointer.assumingMemoryBound(to: UInt8.self)
    let data = Array(UnsafeBufferPointer(start: bytes, count: context.bytesPerRow * height))
    if context.bytesPerRow == width * 4 {
      return RGBXBitmap(width: width, height: height, data: data)
    }
    var packed = [UInt8](repeating: 0, count: width * height * 4)
    for row in 0..<height {
      let source = row * context.bytesPerRow
      packed.replaceSubrange(row * width * 4..<(row + 1) * width * 4, with: data[source..<source + width * 4])
    }
    return RGBXBitmap(width: width, height: height, data: packed)
  }

  /// Per-channel arithmetic mean, rounded half up like `int(mean + 0.5)` in `letterbox.py`.
  func meanColor() -> (r: Int, g: Int, b: Int) {
    var sums = (r: 0, g: 0, b: 0)
    var offset = 0
    let count = width * height
    for _ in 0..<count {
      sums.r += Int(data[offset])
      sums.g += Int(data[offset + 1])
      sums.b += Int(data[offset + 2])
      offset += 4
    }
    func round(_ sum: Int) -> Int { Int(Double(sum) / Double(count) + 0.5) }
    return (round(sums.r), round(sums.g), round(sums.b))
  }

  func makeImage() throws -> CGImage {
    guard let provider = CGDataProvider(data: Data(data) as CFData),
          let image = CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: bytesPerRow,
            space: sRGB, bitmapInfo: CGBitmapInfo(rawValue: rgbxBitmapInfo), provider: provider,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent
          ) else {
      throw VisionRectError("Cannot create a CGImage from the bitmap")
    }
    return image
  }
}

extension CGImagePropertyOrientation {
  /// Maps the stored pixels into an upright `outputWidth`×`outputHeight` Core Graphics context (origin bottom-left).
  func uprightTransform(outputWidth w: CGFloat, outputHeight h: CGFloat) -> CGAffineTransform {
    var transform = CGAffineTransform.identity
    switch self {
    case .upMirrored, .downMirrored, .leftMirrored, .rightMirrored:
      transform = transform.translatedBy(x: w, y: 0).scaledBy(x: -1, y: 1)
    default:
      break
    }
    switch self {
    case .up, .upMirrored:
      break
    case .down, .downMirrored:
      transform = transform.translatedBy(x: w, y: h).rotated(by: .pi)
    case .right, .leftMirrored:
      transform = transform.translatedBy(x: 0, y: h).rotated(by: -.pi / 2)
    case .left, .rightMirrored:
      transform = transform.translatedBy(x: w, y: 0).rotated(by: .pi / 2)
    }
    return transform
  }
}

enum Letterbox {
  /// Mirrors `scripts/data/pipeline/letterbox.py`: resize so the long side equals `size`, center on a
  /// `size`×`size` canvas filled with the resized image's per-channel mean.
  static func letterbox(
    _ image: CGImage,
    orientation: CGImagePropertyOrientation = .up,
    size: Int,
    interpolation: CGInterpolationQuality = LetterboxTuning.interpolation
  ) throws -> LetterboxOutput {
    let uprightWidth = orientation.swapsDimensions ? image.height : image.width
    let uprightHeight = orientation.swapsDimensions ? image.width : image.height
    guard size > 0, uprightWidth > 0, uprightHeight > 0 else { throw VisionRectError("Empty image or size") }
    // Same double arithmetic and round-half-to-even as Python's `round(width * scale)`.
    let scale = Double(size) / Double(max(uprightWidth, uprightHeight))
    let resizedWidth = max(1, Int((Double(uprightWidth) * scale).rounded(.toNearestOrEven)))
    let resizedHeight = max(1, Int((Double(uprightHeight) * scale).rounded(.toNearestOrEven)))
    let resized = try RGBXBitmap.render(
      image, orientation: orientation, width: resizedWidth, height: resizedHeight, interpolation: interpolation
    )
    let mean = resized.meanColor()

    var canvas = RGBXBitmap(width: size, height: size, data: [UInt8](repeating: 255, count: size * size * 4))
    for offset in stride(from: 0, to: canvas.data.count, by: 4) {
      canvas.data[offset] = UInt8(mean.r)
      canvas.data[offset + 1] = UInt8(mean.g)
      canvas.data[offset + 2] = UInt8(mean.b)
    }
    let left = (size - resizedWidth) / 2
    let top = (size - resizedHeight) / 2
    for row in 0..<resizedHeight {
      let source = row * resized.bytesPerRow
      let target = (top + row) * canvas.bytesPerRow + left * 4
      canvas.data.replaceSubrange(target..<target + resized.bytesPerRow, with: resized.data[source..<source + resized.bytesPerRow])
    }
    return LetterboxOutput(image: try canvas.makeImage(), meanColor: mean)
  }
}

enum PerspectiveWarper {
  private static let context = CIContext(options: [.cacheIntermediates: false])

  /// Warps the normalized top-left-origin `quad` of the upright image flat and returns it as a CGImage.
  static func warp(url: URL, quad: [CGPoint]) throws -> CGImage {
    guard quad.count == 4 else { throw VisionRectError("A quad needs four corners") }
    guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else {
      throw VisionRectError("Cannot open image at \(url.path)")
    }
    let extent = image.extent
    func vector(_ point: CGPoint) -> CIVector {
      // Core Image uses a bottom-left origin.
      CIVector(x: extent.minX + point.x * extent.width, y: extent.minY + (1 - point.y) * extent.height)
    }
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
      throw VisionRectError("CIPerspectiveCorrection is unavailable")
    }
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(vector(quad[0]), forKey: "inputTopLeft")
    filter.setValue(vector(quad[1]), forKey: "inputTopRight")
    filter.setValue(vector(quad[2]), forKey: "inputBottomRight")
    filter.setValue(vector(quad[3]), forKey: "inputBottomLeft")
    guard let output = filter.outputImage, !output.extent.isInfinite, !output.extent.isEmpty,
          let warped = context.createCGImage(output, from: output.extent, format: .RGBA8, colorSpace: sRGB) else {
      throw VisionRectError("Perspective correction produced no image")
    }
    return warped
  }
}

enum CropEncoding {
  static func write(_ image: CGImage, to url: URL, type: CFString, properties: [CFString: Any] = [:]) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
      throw VisionRectError("Cannot create \(url.path)")
    }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw VisionRectError("Cannot write \(url.path)") }
  }

  static func writeJPEG(_ image: CGImage, to url: URL, quality: CGFloat = LetterboxTuning.jpegQuality) throws {
    try write(image, to: url, type: "public.jpeg" as CFString, properties: [kCGImageDestinationLossyCompressionQuality: quality])
  }

  static func writePNG(_ image: CGImage, to url: URL) throws {
    try write(image, to: url, type: "public.png" as CFString)
  }
}

struct CropResult {
  let output: LetterboxOutput
  /// The region that was warped, normalized to the upright still.
  let usedQuad: [CGPoint]
}

enum CropPipeline {
  static func run(
    url: URL,
    quad: [CGPoint]?,
    size: Int,
    interpolation: CGInterpolationQuality = LetterboxTuning.interpolation
  ) throws -> CropResult {
    if let quad {
      let warped = try PerspectiveWarper.warp(url: url, quad: quad)
      let output = try Letterbox.letterbox(warped, size: size, interpolation: interpolation)
      return CropResult(output: output, usedQuad: quad)
    }
    let (image, orientation) = try ImageFile.load(url)
    let output = try Letterbox.letterbox(image, orientation: orientation, size: size, interpolation: interpolation)
    return CropResult(output: output, usedQuad: wholeImageQuad)
  }
}
