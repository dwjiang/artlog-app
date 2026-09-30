import CoreGraphics
import Foundation
import ImageIO
import Vision

struct StillAnalysis {
  /// Upright size of the still in pixels.
  let width: Int
  let height: Int
  /// Largest first.
  let rectangles: [DetectedRectangle]
  /// Largest first.
  let subjects: [DetectedSubject]
  /// Why subject lifting produced nothing, when it did: its error, or what it rejected.
  let subjectNote: String?
}

enum StillAnalyzer {
  /// Detects rectangles and lifts foreground subjects on the still, decoded and downscaled once for both.
  static func analyze(fileURL: URL) throws -> StillAnalysis {
    let properties = try ImageFile.properties(of: fileURL)
    let image = try ImageFile.thumbnail(fileURL, maxPixelSize: SubjectDetectorTuning.analysisMaxPixelSize)
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    let rectangles = try RectangleDetector.detect(cgImage: image)
    let imageSize = CGSize(width: image.width, height: image.height)
    var subjects: [DetectedSubject] = []
    var subjectNote: String?
    do {
      var detection = try SubjectDetector.detect(handler: handler, imageSize: imageSize)
      if detection.subjects.isEmpty, let frame = rectangles.first, frame.area >= SubjectDetectorTuning.retryFrameMinimumArea {
        // A photo shown on a screen or a print behind a mat lifts nothing as a whole: the largest rectangle is
        // that screen or mat, so lift inside it.
        let inside = try SubjectDetector.detect(handler: handler, imageSize: imageSize, within: frame.bounds)
        let notes = [detection.note, inside.note.map { "inside the largest rectangle: \($0)" }].compactMap { $0 }
        detection = SubjectDetection(subjects: inside.subjects, note: inside.subjects.isEmpty ? notes.joined(separator: "; ") : nil)
      }
      subjects = detection.subjects
      subjectNote = detection.note
    } catch {
      // The iOS Simulator cannot run the mask model ("Could not create inference context"); the rectangles stand alone.
      subjectNote = error.localizedDescription
    }
    return StillAnalysis(
      width: properties.uprightWidth,
      height: properties.uprightHeight,
      rectangles: rectangles,
      subjects: subjects,
      subjectNote: subjectNote
    )
  }
}

extension ImageFile {
  /// Decodes the image upright, downscaled so the long side is at most `maxPixelSize`.
  static func thumbnail(_ url: URL, maxPixelSize: Int) throws -> CGImage {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
      kCGImageSourceShouldCache: false,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(try source(url), 0, options as CFDictionary) else {
      throw VisionRectError("Cannot decode image at \(url.path)")
    }
    return image
  }
}
