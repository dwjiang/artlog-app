import CoreGraphics
import Foundation
import Vision

struct RecognizedLine {
  let text: String
  let confidence: Float
  /// Normalized upright-image coordinates with a top-left origin.
  let bounds: CGRect
}

struct RecognizedText {
  /// Upright size of the photo in pixels.
  let width: Int
  let height: Int
  /// Reading order: top to bottom, then left to right.
  let lines: [RecognizedLine]
}

enum TextRecognizer {
  /// Two lines whose vertical centres are closer than this share a row and sort left to right.
  private static let rowTolerance: CGFloat = 0.6
  /// Wall labels mix the venue's language with English; Vision picks per line from these hints.
  private static let languages = ["en-US", "es-ES", "fr-FR", "de-DE", "it-IT", "nl-NL", "pt-BR"]

  /// Reads the printed text on a still with the accurate recognizer, using the whole photo at full resolution.
  static func recognize(fileURL: URL) throws -> RecognizedText {
    let (image, orientation) = try ImageFile.load(fileURL)
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { observation -> RecognizedLine? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return nil }
      let box = observation.boundingBox
      return RecognizedLine(
        text: text,
        confidence: candidate.confidence,
        bounds: CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
      )
    }
    let swap = orientation.swapsDimensions
    return RecognizedText(
      width: swap ? image.height : image.width,
      height: swap ? image.width : image.height,
      lines: readingOrder(lines)
    )
  }

  /// Groups lines into rows by vertical overlap, then orders rows top to bottom and each row left to right.
  static func readingOrder(_ lines: [RecognizedLine]) -> [RecognizedLine] {
    var rows: [[RecognizedLine]] = []
    for line in lines.sorted(by: { $0.bounds.midY < $1.bounds.midY }) {
      if let last = rows.last?.last, abs(line.bounds.midY - last.bounds.midY) <= min(line.bounds.height, last.bounds.height) * rowTolerance {
        rows[rows.count - 1].append(line)
      } else {
        rows.append([line])
      }
    }
    return rows.flatMap { $0.sorted { $0.bounds.minX < $1.bounds.minX } }
  }
}
