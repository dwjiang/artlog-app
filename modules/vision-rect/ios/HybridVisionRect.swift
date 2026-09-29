import CoreMedia
import Foundation
import ImageIO
import NitroModules
import VisionCamera

final class HybridVisionRect: HybridVisionRectSpec {
  /// Counts every `detect` call so the stride is independent of any reporting window.
  private var frameCounter: UInt64 = 0
  private let stillQueue = DispatchQueue(label: "app.artlog.vision-rect.still", qos: .userInitiated)

  func detect(frame: any HybridFrameSpec, stride: Double) throws -> RectDetection? {
    frameCounter &+= 1
    let stride = UInt64(max(1, Int(stride)))
    guard frameCounter % stride == 0 else { return nil }
    guard let nativeFrame = frame as? any NativeFrame, let sampleBuffer = nativeFrame.sampleBuffer else {
      throw RuntimeError.error(withMessage: "Frame has no sample buffer")
    }
    let orientation = frame.orientation.cgOrientation(mirrored: frame.isMirrored)
    let rectangles = try RectangleDetector.detect(sampleBuffer: sampleBuffer, orientation: orientation)
    let swap = orientation.swapsDimensions
    return RectDetection(
      width: swap ? frame.height : frame.width,
      height: swap ? frame.width : frame.height,
      observations: rectangles.map(Self.observation)
    )
  }

  func detectStill(photoPath: String) throws -> Promise<StillDetection> {
    return Promise.parallel(stillQueue) {
      let analysis = try StillAnalyzer.analyze(fileURL: URL(fileURLWithPath: photoPath))
      return StillDetection(
        width: Double(analysis.width),
        height: Double(analysis.height),
        rectangles: analysis.rectangles.map { rectangle in
          StillRectObservation(
            confidence: Double(rectangle.confidence),
            corners: rectangle.corners.map { RectPoint(x: $0.x, y: $0.y) },
            flatShare: analysis.flatness.flatShare(rectangle.corners)
          )
        },
        subjects: analysis.subjects.map { subject in
          SubjectObservation(
            area: subject.area,
            quadFill: subject.quadFill,
            quad: subject.quad.map { RectPoint(x: $0.x, y: $0.y) },
            flatShare: analysis.flatness.flatShare(subject.quad)
          )
        },
        subjectNote: analysis.subjectNote
      )
    }
  }

  func warpAndLetterbox(photoPath: String, quad: [RectPoint]?, size: Double) throws -> Promise<LetterboxResult> {
    return Promise.parallel(stillQueue) {
      let corners = quad?.map { CGPoint(x: $0.x, y: $0.y) }
      let crop = try CropPipeline.run(url: URL(fileURLWithPath: photoPath), quad: corners, size: Int(size))
      let directory = try Self.cropDirectory()
      let cropURL = directory.appendingPathComponent("\(UUID().uuidString.lowercased()).jpg")
      try CropEncoding.writeJPEG(crop.output.image, to: cropURL)
      return LetterboxResult(
        cropPath: cropURL.path,
        contentBounds: CropContentBounds(
          x: Double(crop.output.contentBounds.minX), y: Double(crop.output.contentBounds.minY),
          width: Double(crop.output.contentBounds.width), height: Double(crop.output.contentBounds.height)
        ),
        usedQuad: crop.usedQuad.map { RectPoint(x: $0.x, y: $0.y) },
        meanColor: [Double(crop.output.meanColor.r), Double(crop.output.meanColor.g), Double(crop.output.meanColor.b)]
      )
    }
  }

  func recognizeText(photoPath: String) throws -> Promise<TextRecognition> {
    return Promise.parallel(stillQueue) {
      let recognized = try TextRecognizer.recognize(fileURL: URL(fileURLWithPath: photoPath))
      return TextRecognition(
        width: Double(recognized.width),
        height: Double(recognized.height),
        lines: recognized.lines.map { line in
          TextLine(
            text: line.text, confidence: Double(line.confidence),
            x: Double(line.bounds.minX), y: Double(line.bounds.minY), width: Double(line.bounds.width), height: Double(line.bounds.height)
          )
        }
      )
    }
  }

  private static func observation(_ rectangle: DetectedRectangle) -> RectObservation {
    return RectObservation(
      confidence: Double(rectangle.confidence),
      corners: rectangle.corners.map { RectPoint(x: $0.x, y: $0.y) }
    )
  }

  /// `Paths.cache/crops` in expo-file-system terms.
  private static func cropDirectory() throws -> URL {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw VisionRectError("No caches directory")
    }
    let directory = caches.appendingPathComponent("crops", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }
}

extension CameraOrientation {
  func cgOrientation(mirrored: Bool) -> CGImagePropertyOrientation {
    switch self {
    case .up: return mirrored ? .upMirrored : .up
    case .down: return mirrored ? .downMirrored : .down
    case .left: return mirrored ? .leftMirrored : .left
    case .right: return mirrored ? .rightMirrored : .right
    }
  }
}
