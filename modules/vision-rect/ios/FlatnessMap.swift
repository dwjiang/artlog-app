import CoreGraphics
import Foundation

/// Product tuning for telling a plain surround (wall, mat, page) from painted texture.
enum FlatnessTuning {
  /// Long side of the luminance map; downscaling the analysis image averages away sensor noise.
  static let mapMaxPixelSize = 512
  /// Half-width, in map pixels, of the window a pixel's texture is averaged over.
  static let windowRadius = 3
  /// Mean luminance step between neighbors (0–1) under which a window is flat: blank wall, mat or page, rarely paint.
  /// `selectCaptureQuad`'s flat-share thresholds were measured at this level.
  static let flatGradient: Float = 0.012
}

/// Marks the pixels of an image without visible texture, so a region's share of blank surround can be measured.
struct FlatnessMap {
  let width: Int
  let height: Int
  /// `rowCounts[y * (width + 1) + x]` counts the flat pixels in row `y` left of `x`.
  private let rowCounts: [Int32]

  init(image: CGImage) throws {
    let scale = min(1, Double(FlatnessTuning.mapMaxPixelSize) / Double(max(image.width, image.height)))
    let width = max(1, Int((Double(image.width) * scale).rounded()))
    let height = max(1, Int((Double(image.height) * scale).rounded()))
    var gray = [UInt8](repeating: 0, count: width * height)
    let drawn = gray.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
      ) else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { throw VisionRectError("Cannot create luminance map") }

    let gradient = Self.gradientMagnitude(gray, width: width, height: height)
    let local = Self.boxMean(gradient, width: width, height: height, radius: FlatnessTuning.windowRadius)
    var rowCounts = [Int32](repeating: 0, count: (width + 1) * height)
    for y in 0..<height {
      var count: Int32 = 0
      for x in 0..<width {
        if local[y * width + x] < FlatnessTuning.flatGradient { count += 1 }
        rowCounts[y * (width + 1) + x + 1] = count
      }
    }
    self.width = width
    self.height = height
    self.rowCounts = rowCounts
  }

  /// Share of the pixels inside a convex quad (normalized, top-left origin) that are flat; 0 when it covers none.
  func flatShare(_ quad: [CGPoint]) -> Double {
    let points = quad.map { CGPoint(x: $0.x * CGFloat(width), y: $0.y * CGFloat(height)) }
    var flat = 0
    var total = 0
    for y in 0..<height {
      let center = CGFloat(y) + 0.5
      var low = CGFloat.infinity
      var high = -CGFloat.infinity
      for index in points.indices {
        let a = points[index]
        let b = points[(index + 1) % points.count]
        guard (a.y <= center) != (b.y <= center) else { continue }
        let x = a.x + (center - a.y) / (b.y - a.y) * (b.x - a.x)
        low = min(low, x)
        high = max(high, x)
      }
      guard low <= high else { continue }
      let first = max(0, Int((low - 0.5).rounded(.up)))
      let last = min(width - 1, Int((high - 0.5).rounded(.down)))
      guard first <= last else { continue }
      flat += Int(rowCounts[y * (width + 1) + last + 1] - rowCounts[y * (width + 1) + first])
      total += last - first + 1
    }
    return total > 0 ? Double(flat) / Double(total) : 0
  }

  /// Central-difference gradient magnitude of 8-bit luminance, scaled to 0–1 per pixel step.
  private static func gradientMagnitude(_ gray: [UInt8], width: Int, height: Int) -> [Float] {
    var magnitude = [Float](repeating: 0, count: width * height)
    for y in 0..<height {
      let up = max(y - 1, 0) * width
      let down = min(y + 1, height - 1) * width
      for x in 0..<width {
        let dx = Float(gray[y * width + min(x + 1, width - 1)]) - Float(gray[y * width + max(x - 1, 0)])
        let dy = Float(gray[down + x]) - Float(gray[up + x])
        magnitude[y * width + x] = (dx * dx + dy * dy).squareRoot() / 510
      }
    }
    return magnitude
  }

  /// Mean over the (2 · radius + 1)² window around each pixel, clipped at the image edges.
  private static func boxMean(_ values: [Float], width: Int, height: Int, radius: Int) -> [Float] {
    var integral = [Double](repeating: 0, count: (width + 1) * (height + 1))
    for y in 0..<height {
      var row = 0.0
      for x in 0..<width {
        row += Double(values[y * width + x])
        integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row
      }
    }
    var mean = [Float](repeating: 0, count: width * height)
    for y in 0..<height {
      let top = max(0, y - radius)
      let bottom = min(height, y + radius + 1)
      for x in 0..<width {
        let left = max(0, x - radius)
        let right = min(width, x + radius + 1)
        let sum = integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right]
          - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left]
        mean[y * width + x] = Float(sum / Double((right - left) * (bottom - top)))
      }
    }
    return mean
  }
}
