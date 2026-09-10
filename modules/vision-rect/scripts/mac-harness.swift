// macOS harness for the vision-rect Swift core: runs the same detector and letterbox pipeline
// the phone uses, so detection evidence and Python parity can be checked without a device.
//
//   swiftc -O -framework Vision -framework CoreImage \
//     modules/vision-rect/ios/RectangleDetector.swift modules/vision-rect/ios/Letterbox.swift \
//     modules/vision-rect/scripts/mac-harness.swift -o /tmp/vision-rect-harness
//   /tmp/vision-rect-harness detect <image>...
//   /tmp/vision-rect-harness letterbox <image> <size> <out.png> [--interp medium|low|high|none] [--quad x,y,x,y,x,y,x,y]
import CoreGraphics
import Foundation

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
    guard arguments.count >= 2 else { fail("usage: detect <image>... | letterbox <image> <size> <out.png> [--interp q] [--quad 8 numbers]") }
    switch arguments[1] {
    case "detect": try detect(Array(arguments.dropFirst(2)))
    case "letterbox": try letterbox(arguments)
    default: fail("unknown command \(arguments[1])")
    }
  }

  static func detect(_ paths: [String]) throws {
    for path in paths {
      let started = Date()
      let result = try RectangleDetector.detect(fileURL: URL(fileURLWithPath: path))
      let elapsed = Date().timeIntervalSince(started) * 1000
      let rectangles = result.rectangles.map { rectangle -> [String: Any] in
        [
          "confidence": round4(CGFloat(rectangle.confidence)),
          "area": round4(rectangle.area),
          "corners": rectangle.corners.map { [round4($0.x), round4($0.y)] },
        ]
      }
      print(json([
        "file": (path as NSString).lastPathComponent, "width": result.width, "height": result.height,
        "ms": (elapsed * 10).rounded() / 10, "rectangles": rectangles,
      ]))
    }
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
      "usedQuad": crop.usedQuad.map { [round4($0.x), round4($0.y)] },
    ]))
  }
}
