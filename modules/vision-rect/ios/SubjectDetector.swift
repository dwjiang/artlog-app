import CoreGraphics
import CoreVideo
import Foundation
import Vision

/// Product tuning for subject lifting on the captured still.
enum SubjectDetectorTuning {
  /// Long side of the image the mask is computed on; corner precision is bounded by it.
  static let analysisMaxPixelSize = 1024
  static let maskThreshold: Float = 0.5
  /// Instances whose largest connected region covers less of the image than this are dropped.
  static let minimumAreaFraction = 0.02
  static let maximumSubjects = 4
  /// Boundary points within this fraction of a side's length from the side are used to fit it.
  static let sideInlierTolerance = 0.04
  /// Portion of a side, from each corner, excluded from the fit: segmentation masks round corners.
  static let sideCornerMargin = 0.15
  static let sideMinimumPoints = 16
  /// A fitted corner farther than this fraction of the quad diagonal from the extreme point is discarded.
  static let maximumCornerShift = 0.06
  /// When nothing lifts from the whole image, lifting retries inside the largest rectangle if it covers at least this share.
  static let retryFrameMinimumArea: CGFloat = 0.2
}

/// Corners are normalized to the upright image with the origin at the top-left, in the order
/// top-left, top-right, bottom-right, bottom-left.
struct DetectedSubject {
  /// Share of the image covered by the instance's largest connected region.
  let area: Double
  /// Axis-aligned bounds of that region.
  let bounds: [CGPoint]
  /// Corners from the region's sides, fitted as lines so rounded mask corners still meet at a point.
  let quad: [CGPoint]
  /// Region area divided by the quad area: about 1 for a quadrilateral, further off for rounder shapes.
  let quadFill: Double

  /// Maps a subject found inside `frame` (normalized, top-left origin) into whole-image coordinates.
  func mapped(into frame: CGRect) -> DetectedSubject {
    func map(_ point: CGPoint) -> CGPoint { CGPoint(x: frame.minX + point.x * frame.width, y: frame.minY + point.y * frame.height) }
    return DetectedSubject(area: area * Double(frame.width * frame.height), bounds: bounds.map(map), quad: quad.map(map), quadFill: quadFill)
  }
}

struct SubjectDetection {
  /// Largest first.
  let subjects: [DetectedSubject]
  /// Why nothing was lifted, when `subjects` is empty: no instances, or what each instance's mask looked like.
  let note: String?
}

enum SubjectDetector {
  /// Lifts subjects from the whole image, or from `frame` (normalized, top-left origin) when given; results are
  /// always in whole-image coordinates.
  static func detect(handler: VNImageRequestHandler, imageSize: CGSize, within frame: CGRect? = nil) throws -> SubjectDetection {
    let request = VNGenerateForegroundInstanceMaskRequest()
    if let frame {
      // Vision's region of interest has a bottom-left origin.
      request.regionOfInterest = CGRect(x: frame.minX, y: 1 - frame.maxY, width: frame.width, height: frame.height)
    }
    try handler.perform([request])
    return try subjects(from: request.results?.first, handler: handler, imageSize: imageSize, frame: frame)
  }

  static func subjects(
    from observation: VNInstanceMaskObservation?, handler: VNImageRequestHandler, imageSize: CGSize, frame: CGRect? = nil
  ) throws -> SubjectDetection {
    guard let observation, !observation.allInstances.isEmpty else { return SubjectDetection(subjects: [], note: "no instances lifted") }
    var subjects: [DetectedSubject] = []
    var rejected: [String] = []
    for instance in observation.allInstances {
      let mask = try observation.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler)
      let bitmap = MaskBitmap(mask: mask, threshold: SubjectDetectorTuning.maskThreshold)
      // A region-of-interest mask may come back at the region's size rather than the image's.
      let coversImage = abs(bitmap.width - Int(imageSize.width)) <= 2 && abs(bitmap.height - Int(imageSize.height)) <= 2
      if let subject = SubjectGeometry.analyze(mask: bitmap) {
        subjects.append(frame != nil && !coversImage ? subject.mapped(into: frame!) : subject)
      } else {
        rejected.append("\(bitmap.formatDescription) \(bitmap.width)×\(bitmap.height) covering \(Int((bitmap.coverage * 100).rounded()))%")
      }
    }
    subjects.sort { $0.area > $1.area }
    return SubjectDetection(
      subjects: Array(subjects.prefix(SubjectDetectorTuning.maximumSubjects)),
      note: subjects.isEmpty ? "\(rejected.count) instance(s) rejected: " + rejected.joined(separator: "; ") : nil
    )
  }
}

struct MaskBitmap {
  let width: Int
  let height: Int
  private(set) var pixels: [Bool]
  /// The mask's Core Video pixel format as its four-character code.
  let formatDescription: String

  init(width: Int, height: Int, pixels: [Bool], formatDescription: String = "bool") {
    self.width = width
    self.height = height
    self.pixels = pixels
    self.formatDescription = formatDescription
  }

  /// Thresholds a one-component mask: 32-bit float or 8-bit, whichever Vision returns.
  init(mask: CVPixelBuffer, threshold: Float) {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    width = CVPixelBufferGetWidth(mask)
    height = CVPixelBufferGetHeight(mask)
    let format = CVPixelBufferGetPixelFormatType(mask)
    formatDescription = String((0..<4).map { Character(UnicodeScalar(UInt8((format >> (8 * (3 - $0))) & 0xff))) })
    let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
    var pixels = [Bool](repeating: false, count: width * height)
    if let base = CVPixelBufferGetBaseAddress(mask) {
      for y in 0..<height {
        let row = base.advanced(by: y * bytesPerRow)
        if format == kCVPixelFormatType_OneComponent8 {
          let bytes = row.assumingMemoryBound(to: UInt8.self)
          for x in 0..<width where Float(bytes[x]) / 255 >= threshold {
            pixels[y * width + x] = true
          }
        } else {
          let floats = row.assumingMemoryBound(to: Float.self)
          for x in 0..<width where floats[x] >= threshold {
            pixels[y * width + x] = true
          }
        }
      }
    }
    self.pixels = pixels
  }

  /// Share of the mask that is set.
  var coverage: Double {
    Double(pixels.lazy.filter { $0 }.count) / Double(max(pixels.count, 1))
  }

  subscript(x: Int, y: Int) -> Bool {
    x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x]
  }

  /// The largest 4-connected set of true pixels as its own bitmap, with its pixel count.
  func largestRegion() -> (bitmap: MaskBitmap, count: Int)? {
    var labels = [Int32](repeating: 0, count: pixels.count)
    var bestLabel: Int32 = 0
    var bestCount = 0
    var nextLabel: Int32 = 1
    var queue: [Int] = []
    for start in pixels.indices where pixels[start] && labels[start] == 0 {
      let label = nextLabel
      nextLabel += 1
      var count = 0
      queue.removeAll(keepingCapacity: true)
      queue.append(start)
      labels[start] = label
      var head = 0
      while head < queue.count {
        let index = queue[head]
        head += 1
        count += 1
        let x = index % width
        let y = index / width
        for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] where self[nx, ny] {
          let neighbor = ny * width + nx
          if labels[neighbor] == 0 {
            labels[neighbor] = label
            queue.append(neighbor)
          }
        }
      }
      if count > bestCount {
        bestCount = count
        bestLabel = label
      }
    }
    guard bestCount > 0 else { return nil }
    let region = labels.map { $0 == bestLabel }
    return (MaskBitmap(width: width, height: height, pixels: region), bestCount)
  }

  /// Centers of the true pixels that touch a false pixel or the image edge.
  func boundaryPoints() -> [CGPoint] {
    var points: [CGPoint] = []
    for y in 0..<height {
      for x in 0..<width where pixels[y * width + x] {
        if !self[x - 1, y] || !self[x + 1, y] || !self[x, y - 1] || !self[x, y + 1] {
          points.append(CGPoint(x: CGFloat(x) + 0.5, y: CGFloat(y) + 0.5))
        }
      }
    }
    return points
  }
}

enum SubjectGeometry {
  static func analyze(mask: MaskBitmap) -> DetectedSubject? {
    guard let (region, count) = mask.largestRegion() else { return nil }
    let area = Double(count) / Double(mask.width * mask.height)
    guard area >= SubjectDetectorTuning.minimumAreaFraction else { return nil }
    let boundary = region.boundaryPoints()
    let extremes = extremeCorners(boundary)
    // Fitted sides of a subject that runs off the image extrapolate past it; the warp needs corners inside.
    let quad = fitSides(extremes, boundary: boundary).map {
      CGPoint(x: min(max($0.x, 0), CGFloat(mask.width)), y: min(max($0.y, 0), CGFloat(mask.height)))
    }
    let xs = boundary.map(\.x)
    let ys = boundary.map(\.y)
    let bounds = [
      CGPoint(x: xs.min()! - 0.5, y: ys.min()! - 0.5), CGPoint(x: xs.max()! + 0.5, y: ys.min()! - 0.5),
      CGPoint(x: xs.max()! + 0.5, y: ys.max()! + 0.5), CGPoint(x: xs.min()! - 0.5, y: ys.max()! + 0.5),
    ]
    let size = CGSize(width: CGFloat(mask.width), height: CGFloat(mask.height))
    return DetectedSubject(
      area: area,
      bounds: bounds.map { normalize($0, size) },
      quad: quad.map { normalize($0, size) },
      quadFill: Double(count) / max(Double(quadArea(quad)), 1)
    )
  }

  private static func normalize(_ point: CGPoint, _ size: CGSize) -> CGPoint {
    CGPoint(x: point.x / size.width, y: point.y / size.height)
  }

  /// The boundary points farthest along the four diagonal directions, in top-left, top-right,
  /// bottom-right, bottom-left order.
  static func extremeCorners(_ points: [CGPoint]) -> [CGPoint] {
    let scores: [(CGPoint) -> CGFloat] = [{ -($0.x + $0.y) }, { $0.x - $0.y }, { $0.x + $0.y }, { $0.y - $0.x }]
    return scores.map { score in points.max { score($0) < score($1) }! }
  }

  /// Fits each side of the quad as a line through the boundary points near it, away from the corners,
  /// and replaces each corner with the intersection of its two sides when the fit stays close.
  static func fitSides(_ corners: [CGPoint], boundary: [CGPoint]) -> [CGPoint] {
    let diagonal = max(hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y),
                       hypot(corners[3].x - corners[1].x, corners[3].y - corners[1].y))
    let lines: [Line?] = (0..<4).map { index in
      let a = corners[index]
      let b = corners[(index + 1) % 4]
      let length = hypot(b.x - a.x, b.y - a.y)
      guard length > 0 else { return nil }
      let ux = (b.x - a.x) / length
      let uy = (b.y - a.y) / length
      let inliers = boundary.filter { point in
        let along = ((point.x - a.x) * ux + (point.y - a.y) * uy) / length
        guard along >= SubjectDetectorTuning.sideCornerMargin, along <= 1 - SubjectDetectorTuning.sideCornerMargin else { return false }
        let across = abs((point.x - a.x) * uy - (point.y - a.y) * ux)
        return across <= SubjectDetectorTuning.sideInlierTolerance * length
      }
      return inliers.count >= SubjectDetectorTuning.sideMinimumPoints ? Line.fit(inliers) : nil
    }
    return (0..<4).map { index in
      guard let before = lines[(index + 3) % 4], let after = lines[index], let point = before.intersection(after),
            hypot(point.x - corners[index].x, point.y - corners[index].y) <= SubjectDetectorTuning.maximumCornerShift * diagonal
      else { return corners[index] }
      return point
    }
  }
}

struct Line {
  let origin: CGPoint
  let direction: CGPoint

  /// Total least squares: the principal axis of the points.
  static func fit(_ points: [CGPoint]) -> Line {
    let count = CGFloat(points.count)
    let mean = CGPoint(x: points.reduce(0) { $0 + $1.x } / count, y: points.reduce(0) { $0 + $1.y } / count)
    var sxx: CGFloat = 0, sxy: CGFloat = 0, syy: CGFloat = 0
    for point in points {
      let dx = point.x - mean.x
      let dy = point.y - mean.y
      sxx += dx * dx
      sxy += dx * dy
      syy += dy * dy
    }
    let angle = 0.5 * atan2(2 * sxy, sxx - syy)
    return Line(origin: mean, direction: CGPoint(x: cos(angle), y: sin(angle)))
  }

  func intersection(_ other: Line) -> CGPoint? {
    let cross = direction.x * other.direction.y - direction.y * other.direction.x
    guard abs(cross) > 1e-9 else { return nil }
    let dx = other.origin.x - origin.x
    let dy = other.origin.y - origin.y
    let t = (dx * other.direction.y - dy * other.direction.x) / cross
    return CGPoint(x: origin.x + direction.x * t, y: origin.y + direction.y * t)
  }
}
