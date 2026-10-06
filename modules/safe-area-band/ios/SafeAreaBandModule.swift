import ExpoModulesCore
import UIKit

public final class SafeAreaBandModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SafeAreaBand")

    View(SafeAreaBandView.self) {}
  }
}

/// A band drawn across the top of a screen, under the status bar. Its screen's safe area grows by the part of the band
/// below the status bar, so the navigation bar, large title, scroll insets and React Native safe-area insets all start
/// under the band rather than behind it. react-native-screens and expo-router expose no top inset of their own.
final class SafeAreaBandView: ExpoView {
  private weak var screen: UIViewController?

  override func layoutSubviews() {
    super.layoutSubviews()
    reserve()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reserve()
  }

  override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if newSuperview == nil { release() }
  }

  private func reserve() {
    guard let screen = owningScreen(), let view = screen.view, view.window != nil else { return }
    self.screen = screen
    // Off-window views report no safe area, so the inherited inset is only known while the screen is shown; a tab
    // that is not selected reserves its band when it next appears, before that frame draws.
    let inherited = view.safeAreaInsets.top - screen.additionalSafeAreaInsets.top
    let inset = max(0, convert(bounds, to: view).maxY - inherited)
    guard abs(screen.additionalSafeAreaInsets.top - inset) >= 0.5 else { return }
    screen.additionalSafeAreaInsets.top = inset
  }

  private func release() {
    screen?.additionalSafeAreaInsets.top = 0
    screen = nil
  }

  private func owningScreen() -> UIViewController? {
    var responder = next
    while let current = responder {
      if let controller = current as? UIViewController { return controller }
      responder = current.next
    }
    return nil
  }
}
