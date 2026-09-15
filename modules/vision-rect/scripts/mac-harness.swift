// macOS harness for the vision-rect Swift core: runs the same detector and letterbox pipeline
// the phone uses, so detection evidence and Python parity can be checked without a device.
//
//   swiftc -O -framework Vision -framework CoreImage \
//     modules/vision-rect/ios/RectangleDetector.swift modules/vision-rect/ios/SubjectDetector.swift \
//     modules/vision-rect/ios/StillAnalyzer.swift modules/vision-rect/ios/Letterbox.swift \
//     modules/vision-rect/scripts/mac-harness.swift -o /tmp/vision-rect-harness
//   /tmp/vision-rect-harness analyze <image>... [--out <dir>]
//     --out writes <name>-analysis.png (subject quads red, bounds dotted, rectangles blue) and <name>-crop.png (top subject warped)
//   /tmp/vision-rect-harness letterbox <image> <size> <out.png> [--interp medium|low|high|none] [--quad x,y,x,y,x,y,x,y]
import CoreGraphics
import Foundation
import ImageIO

@main
struct Harness {
  static func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
  }

  static func json(_ value: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    return String(data: data, encoding: .utf8)!
  }

  static func round4(_ value: CGFloat) -> Double { (Double(value) * 10000).rounded() / 10000 }

  static func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count >= 2 else { fail("usage: analyze <image>... [--out dir] | letterbox <image> <size> <out.png> [--interp q] [--quad 8 numbers]") }
    switch arguments[1] {
    case "analyze": try analyze(Array(arguments.dropFirst(2)))
    case "letterbox": try letterbox(arguments)
    case "self-test": try testContentBounds()
    default: fail("unknown command \(arguments[1])")
    }
  }

  static func testContentBounds() throws {
    var bitmap = RGBXBitmap(width: 4, height: 2, data: [UInt8](repeating: 255, count: 32))
    for index in 0..<8 {
      bitmap.data[index * 4] = UInt8(index * 30)
      bitmap.data[index * 4 + 1] = UInt8(255 - index * 20)
      bitmap.data[index * 4 + 2] = UInt8(index * 10)
    }
    let image = try bitmap.makeImage()
    for orientation in [CGImagePropertyOrientation.up, .upMirrored, .down, .downMirrored, .left, .leftMirrored, .right, .rightMirrored] {
      let crop = try Letterbox.letterbox(image, orientation: orientation, size: 4, interpolation: .none)
      let expected = orientation.swapsDimensions ? CGRect(x: 1, y: 0, width: 2, height: 4) : CGRect(x: 0, y: 1, width: 4, height: 2)
      guard crop.contentBounds == expected else { fail("Incorrect rotated content bounds: \(orientation)") }
      let output = try RGBXBitmap.render(crop.image, orientation: .up, width: 4, height: 4, interpolation: .none)
      let upright = try RGBXBitmap.render(image, orientation: orientation, width: Int(expected.width), height: Int(expected.height), interpolation: .none)
      for y in 0..<4 {
        for x in 0..<4 {
          let offset = (y * 4 + x) * 4
          if expected.contains(CGPoint(x: CGFloat(x) + 0.5, y: CGFloat(y) + 0.5)) {
            let source = ((y - Int(expected.minY)) * upright.width + x - Int(expected.minX)) * 4
            guard output.data[offset..<offset + 3] == upright.data[source..<source + 3] else { fail("Content pixels changed") }
          } else {
            guard Array(output.data[offset..<offset + 3]) == [UInt8(crop.meanColor.r), UInt8(crop.meanColor.g), UInt8(crop.meanColor.b)] else { fail("Padding pixels changed") }
          }
        }
      }
    }
    let odd = try RGBXBitmap(width: 3, height: 2, data: [UInt8](repeating: 100, count: 24)).makeImage()
    let oddCrop = try Letterbox.letterbox(odd, size: 4)
    guard oddCrop.contentBounds == CGRect(x: 0, y: 0, width: 4, height: 3) else { fail("Odd padding must be asymmetric") }
    let portrait = try Letterbox.letterbox(odd, orientation: .right, size: 4)
    guard portrait.contentBounds == CGRect(x: 0, y: 0, width: 3, height: 4) else { fail("Incorrect portrait bounds") }
    print("PASS: content pixels, mean-color padding, odd bounds, and all eight orientations")
  }

  static func analyze(_ arguments: [String]) throws {
    var paths: [String] = []
    var outDir: String?
    var index = 0
    while index < arguments.count {
      if arguments[index] == "--out" { outDir = arguments[index + 1]; index += 2 } else { paths.append(arguments[index]); index += 1 }
    }
    for path in paths {
      let url = URL(fileURLWithPath: path)
      let started = Date()
      let result = try StillAnalyzer.analyze(fileURL: url)
      let elapsed = Date().timeIntervalSince(started) * 1000
      let subjects = result.subjects.map { subject -> [String: Any] in
        [
          "area": round4(CGFloat(subject.area)),
          "quadFill": round4(CGFloat(subject.quadFill)),
          "bounds": subject.bounds.map { [round4($0.x), round4($0.y)] },
          "quad": subject.quad.map { [round4($0.x), round4($0.y)] },
        ]
      }
      print(json([
        "file": url.lastPathComponent, "width": result.width, "height": result.height, "ms": (elapsed * 10).rounded() / 10,
        "subjects": subjects,
        "subjectNote": result.subjectNote ?? NSNull(),
        "rectangles": result.rectangles.map { ["confidence": round4(CGFloat($0.confidence)), "area": round4($0.area), "corners": $0.corners.map { [round4($0.x), round4($0.y)] }] },
      ]))
      guard let outDir else { continue }
      let name = url.deletingPathExtension().lastPathComponent
      let outURL = URL(fileURLWithPath: outDir)
      try FileManager.default.createDirectory(at: outURL, withIntermediateDirectories: true)
      try writeOverlay(url: url, subjects: result.subjects, rectangles: result.rectangles, to: outURL.appendingPathComponent("\(name)-analysis.png"))
      if let top = result.subjects.first {
        let crop = try CropPipeline.run(url: url, quad: top.quad, size: 512)
        try CropEncoding.writePNG(crop.output.image, to: outURL.appendingPathComponent("\(name)-crop.png"))
      }
    }
  }

  /// Draws every subject quad (red, bounds dotted) and rectangle candidate (blue) over the analysis-size image.
  static func writeOverlay(url: URL, subjects: [DetectedSubject], rectangles: [DetectedRectangle], to output: URL) throws {
    let image = try ImageFile.thumbnail(url, maxPixelSize: SubjectDetectorTuning.analysisMaxPixelSize)
    let width = image.width, height = image.height
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      fail("Cannot create overlay context")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    // Core Graphics has a bottom-left origin; the quads use top-left.
    func stroke(_ corners: [CGPoint], color: CGColor, width lineWidth: CGFloat, dash: [CGFloat] = []) {
      context.setStrokeColor(color)
      context.setLineWidth(lineWidth)
      context.setLineDash(phase: 0, lengths: dash)
      context.beginPath()
      for (index, corner) in corners.enumerated() {
        let point = CGPoint(x: corner.x * CGFloat(width), y: (1 - corner.y) * CGFloat(height))
        if index == 0 { context.move(to: point) } else { context.addLine(to: point) }
      }
      context.closePath()
      context.strokePath()
    }
    for rectangle in rectangles { stroke(rectangle.corners, color: CGColor(srgbRed: 0.2, green: 0.4, blue: 1, alpha: 1), width: 3) }
    for (index, subject) in subjects.enumerated() {
      let alpha: CGFloat = index == 0 ? 1 : 0.5
      stroke(subject.bounds, color: CGColor(srgbRed: 1, green: 0.8, blue: 0, alpha: alpha), width: 2, dash: [6, 6])
      stroke(subject.quad, color: CGColor(srgbRed: 1, green: 0.1, blue: 0.1, alpha: alpha), width: 4)
    }
    guard let overlay = context.makeImage() else { fail("Cannot render overlay") }
    try CropEncoding.writePNG(overlay, to: output)
  }

  static func letterbox(_ arguments: [String]) throws {
    guard arguments.count >= 5, let size = Int(arguments[3]) else { fail("letterbox <image> <size> <out.png>") }
    var interpolation = LetterboxTuning.interpolation
    var quad: [CGPoint]?
    var index = 5
    while index < arguments.count {
      switch arguments[index] {
      case "--interp":
        switch arguments[index + 1] {
        case "none": interpolation = .none
        case "low": interpolation = .low
        case "medium": interpolation = .medium
        case "high": interpolation = .high
        default: fail("unknown interpolation \(arguments[index + 1])")
        }
        index += 2
      case "--quad":
        let numbers = arguments[index + 1].split(separator: ",").compactMap { Double($0) }
        guard numbers.count == 8 else { fail("--quad needs 8 numbers") }
        quad = stride(from: 0, to: 8, by: 2).map { CGPoint(x: numbers[$0], y: numbers[$0 + 1]) }
        index += 2
      default:
        fail("unknown option \(arguments[index])")
      }
    }
    let started = Date()
    let crop = try CropPipeline.run(url: URL(fileURLWithPath: arguments[2]), quad: quad, size: size, interpolation: interpolation)
    let elapsed = Date().timeIntervalSince(started) * 1000
    try CropEncoding.writePNG(crop.output.image, to: URL(fileURLWithPath: arguments[4]))
    print(json([
      "out": arguments[4], "ms": (elapsed * 10).rounded() / 10,
      "meanColor": [crop.output.meanColor.r, crop.output.meanColor.g, crop.output.meanColor.b],
      "contentBounds": [
        "x": crop.output.contentBounds.minX, "y": crop.output.contentBounds.minY,
        "width": crop.output.contentBounds.width, "height": crop.output.contentBounds.height,
      ],
      "usedQuad": crop.usedQuad.map { [round4($0.x), round4($0.y)] },
    ]))
  }
}
