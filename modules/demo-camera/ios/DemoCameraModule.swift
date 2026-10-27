import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

final class DemoCameraNoFrameException: Exception, @unchecked Sendable {
  override var reason: String { "The demo video has not shown a frame yet" }
}

final class DemoCameraPhotoException: Exception, @unchecked Sendable {
  override var reason: String { "Could not save the demo video frame" }
}

public final class DemoCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DemoCamera")

    View(DemoCameraView.self) {
      Events("onReady", "onDetection", "onError")

      Prop("source") { (view: DemoCameraView, source: URL) in
        view.load(source)
      }
      Prop("active") { (view: DemoCameraView, active: Bool) in
        view.setActive(active)
      }
      Prop("detectionStride") { (view: DemoCameraView, stride: Int) in
        view.detectionStride = max(1, stride)
      }

      AsyncFunction("takePhoto") { (view: DemoCameraView, promise: Promise) in
        view.takePhoto(promise)
      }.runOnQueue(.main)

      AsyncFunction("play") { (view: DemoCameraView, from: Double, to: Double, loop: Bool) in
        view.play(from: from, to: to, loop: loop)
      }.runOnQueue(.main)
    }
  }
}

/// Plays segments of a video where the camera preview goes and streams its frames through the app's rectangle detector,
/// so a phone without a usable camera scans the way the camera does. The layer cover-fits like the camera preview.
final class DemoCameraView: ExpoView {
  let onReady = EventDispatcher()
  let onDetection = EventDispatcher()
  let onError = EventDispatcher()
  var detectionStride = 3

  private let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()
  private let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  ])
  private let detectionQueue = DispatchQueue(label: "app.artlog.demo-camera.detect", qos: .userInitiated)
  private let photoQueue = DispatchQueue(label: "app.artlog.demo-camera.photo", qos: .userInitiated)
  private static let ciContext = CIContext()
  private var source: URL?
  private var active = false
  private var ready = false
  private var detecting = false
  private var frames: UInt64 = 0
  private var latest: CVPixelBuffer?
  private var segment: (start: CMTime, loop: Bool)?
  /// A segment that does not loop holds its last frame, as a phone held still keeps showing the same view.
  private var holding = false
  private var displayLink: CADisplayLink?
  private var statusObservation: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var boundaryObserver: Any?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    player.isMuted = true
    player.actionAtItemEnd = .none
    player.preventsDisplaySleepDuringVideoPlayback = false
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(playerLayer)
  }

  deinit {
    displayLink?.invalidate()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let boundaryObserver { player.removeTimeObserver(boundaryObserver) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    playerLayer.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      displayLink?.invalidate()
      displayLink = nil
    } else if displayLink == nil {
      let link = CADisplayLink(target: WeakTarget(self), selector: #selector(WeakTarget.tick))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 30, preferred: 30)
      link.add(to: .main, forMode: .common)
      displayLink = link
    }
  }

  func load(_ url: URL) {
    guard url != source else { return }
    source = url
    ready = false
    latest = nil
    segment = nil
    holding = false
    if let boundaryObserver { player.removeTimeObserver(boundaryObserver) }
    boundaryObserver = nil
    let item = AVPlayerItem(url: url)
    item.add(output)
    statusObservation = item.observe(\.status) { [weak self] item, _ in
      guard item.status == .failed else { return }
      let message = item.error?.localizedDescription ?? "The demo video could not play"
      DispatchQueue.main.async { self?.onError(["message": message]) }
    }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    // The last segment ends with the video, where a boundary time may never fire.
    endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) {
      [weak self] _ in
      self?.segmentEnded()
    }
    player.replaceCurrentItem(with: item)
    updatePlayback()
  }

  func setActive(_ active: Bool) {
    self.active = active
    updatePlayback()
  }

  func play(from: Double, to: Double, loop: Bool) {
    let start = CMTime(seconds: from, preferredTimescale: 600)
    // Boundary times fire after the frame at that time is shown, so stop short of the next segment's first frame.
    let end = CMTime(seconds: to - 0.05, preferredTimescale: 600)
    if let boundaryObserver { player.removeTimeObserver(boundaryObserver) }
    boundaryObserver = player.addBoundaryTimeObserver(forTimes: [NSValue(time: end)], queue: .main) { [weak self] in
      self?.segmentEnded()
    }
    segment = (start, loop)
    holding = false
    player.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero)
    updatePlayback()
  }

  /// Saves the frame on screen as a JPEG, as the camera saves a still.
  func takePhoto(_ promise: Promise) {
    guard let buffer = latest else {
      promise.reject(DemoCameraNoFrameException())
      return
    }
    photoQueue.async {
      let image = CIImage(cvPixelBuffer: buffer)
      guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let data = Self.ciContext.jpegRepresentation(of: image, colorSpace: colorSpace, options: [
              kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92,
            ]) else {
        promise.reject(DemoCameraPhotoException())
        return
      }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString.lowercased()).jpg")
      do {
        try data.write(to: url)
        promise.resolve(url.path)
      } catch {
        promise.reject(DemoCameraPhotoException())
      }
    }
  }

  private func segmentEnded() {
    guard let segment else {
      player.seek(to: .zero)
      return
    }
    if segment.loop {
      player.seek(to: segment.start, toleranceBefore: .zero, toleranceAfter: .zero)
    } else {
      holding = true
      updatePlayback()
    }
  }

  private func updatePlayback() {
    if active, !holding, player.currentItem != nil {
      player.play()
    } else {
      player.pause()
    }
  }

  fileprivate func tick() {
    let time = output.itemTime(forHostTime: CACurrentMediaTime())
    guard output.hasNewPixelBuffer(forItemTime: time),
          let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) else { return }
    latest = buffer
    if !ready {
      ready = true
      onReady()
    }
    frames &+= 1
    guard active, !detecting, frames % UInt64(detectionStride) == 0 else { return }
    detecting = true
    detectionQueue.async { [weak self] in
      let rectangles = (try? RectangleDetector.detect(pixelBuffer: buffer, orientation: .up)) ?? []
      let width = CVPixelBufferGetWidth(buffer)
      let height = CVPixelBufferGetHeight(buffer)
      DispatchQueue.main.async {
        guard let self else { return }
        self.detecting = false
        guard self.active else { return }
        self.onDetection([
          "width": width,
          "height": height,
          "observations": rectangles.map { rectangle in
            [
              "confidence": rectangle.confidence,
              "corners": rectangle.corners.map { ["x": $0.x, "y": $0.y] },
            ] as [String: Any]
          },
        ])
      }
    }
  }
}

/// A display link retains its target, so it holds the view weakly and stops when the view goes away.
private final class WeakTarget: NSObject {
  weak var view: DemoCameraView?

  init(_ view: DemoCameraView) {
    self.view = view
  }

  @objc func tick(_ link: CADisplayLink) {
    guard let view else {
      link.invalidate()
      return
    }
    view.tick()
  }
}
