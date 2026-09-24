import ExpoModulesCore
import MediaPlayer
import UIKit

/// MPVolumeView is the public way to show and set the device's media volume: it follows the
/// hardware buttons and the audio route, and suppresses the system volume HUD while on screen.
final class SystemVolumeView: ExpoView {
  private static let trackHeight: CGFloat = 6
  private let volumeView = LayoutObservingVolumeView()
  // An empty bar in the slider's place when the route has no adjustable volume (a fixed-volume
  // AirPlay receiver, or the simulator); MPVolumeView's own "No Volume Available" label never gets a size here.
  private let placeholder = UIView()

  var minimumTrackColor = UIColor.systemGray {
    didSet { volumeView.setMinimumVolumeSliderImage(Self.track(minimumTrackColor, rounding: .left), for: .normal) }
  }
  var maximumTrackColor = UIColor.systemGray5 {
    didSet {
      volumeView.setMaximumVolumeSliderImage(Self.track(maximumTrackColor, rounding: .right), for: .normal)
      placeholder.backgroundColor = maximumTrackColor
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Deprecated in favor of AVRoutePickerView, yet MPVolumeView still adds an AirPlay button unless told not to.
    volumeView.showsRouteButton = false
    volumeView.setVolumeThumbImage(UIImage(), for: .normal)
    volumeView.setMinimumVolumeSliderImage(Self.track(minimumTrackColor, rounding: .left), for: .normal)
    volumeView.setMaximumVolumeSliderImage(Self.track(maximumTrackColor, rounding: .right), for: .normal)
    volumeView.onLayout = { [weak self] in self?.updatePlaceholder() }
    placeholder.backgroundColor = maximumTrackColor
    placeholder.layer.cornerRadius = Self.trackHeight / 2
    placeholder.isAccessibilityElement = true
    placeholder.accessibilityLabel = "Volume"
    placeholder.accessibilityTraits = .notEnabled
    addSubview(placeholder)
    addSubview(volumeView)
    // With no thumb to grab, a touch anywhere on the bar sets the level and a drag follows the finger.
    let press = UILongPressGestureRecognizer(target: self, action: #selector(adjust))
    press.minimumPressDuration = 0
    addGestureRecognizer(press)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let height = volumeView.sizeThatFits(bounds.size).height
    volumeView.frame = CGRect(x: 0, y: (bounds.height - height) / 2, width: bounds.width, height: height)
    placeholder.frame = CGRect(
      x: 0, y: (bounds.height - Self.trackHeight) / 2, width: bounds.width, height: Self.trackHeight)
  }

  private var slider: UISlider? {
    volumeView.subviews.lazy.compactMap { $0 as? UISlider }.first { !$0.isHidden && $0.alpha > 0 }
  }

  private func updatePlaceholder() {
    placeholder.isHidden = slider != nil
  }

  // MPVolumeView's slider writes the system volume when its value changes; it has no public setter.
  @objc private func adjust(_ press: UILongPressGestureRecognizer) {
    guard let slider else { return }
    let track = slider.trackRect(forBounds: slider.bounds)
    let fraction = (press.location(in: slider).x - track.minX) / track.width
    slider.setValue(Float(min(max(fraction, 0), 1)), animated: false)
    slider.sendActions(for: .valueChanged)
  }

  private enum Rounding { case left, right }

  private static func track(_ color: UIColor, rounding: Rounding) -> UIImage {
    let radius = trackHeight / 2
    let size = CGSize(width: trackHeight + 1, height: trackHeight)
    let corners: UIRectCorner = rounding == .left ? [.topLeft, .bottomLeft] : [.topRight, .bottomRight]
    let image = UIGraphicsImageRenderer(size: size).image { _ in
      color.setFill()
      UIBezierPath(
        roundedRect: CGRect(origin: .zero, size: size),
        byRoundingCorners: corners,
        cornerRadii: CGSize(width: radius, height: radius)
      ).fill()
    }
    return image.resizableImage(withCapInsets: UIEdgeInsets(top: 0, left: radius, bottom: 0, right: radius))
  }
}

/// MPVolumeView lays itself out again when it swaps its slider for a label on a route change.
private final class LayoutObservingVolumeView: MPVolumeView {
  var onLayout: () -> Void = {}

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout()
  }
}
