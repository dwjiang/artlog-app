import ExpoModulesCore
import UIKit

public final class BackButtonTintModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackButtonTint")

    Function("setTint") { (color: UIColor) in
      Task { @MainActor in BackButtonTint.install(color: color) }
    }
  }
}

/// iOS 26 draws the glass back chevron in its monochrome style and ignores `navigationBar.tintColor`, where
/// react-native-screens puts `headerTintColor`; only a tint on the back item itself colors it. RNSScreenStack calls
/// `setViewControllers:animated:` with the screens below right before every push, so tinting their back items there
/// covers each screen a pushed screen returns to.
@MainActor
private enum BackButtonTint {
  private static var color: UIColor?

  static func install(color: UIColor) {
    guard #available(iOS 26.0, *) else { return }
    let isInstalled = Self.color != nil
    Self.color = color
    guard !isInstalled, let stackClass = NSClassFromString("RNSNavigationController") else { return }

    // Replaced on react-native-screens' subclass only, never on UIKit's class.
    let selector = #selector(UINavigationController.setViewControllers(_:animated:))
    guard let method = class_getInstanceMethod(stackClass, selector) else { return }
    typealias Implementation = @convention(c) (UINavigationController, Selector, NSArray, Bool) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Implementation.self)
    let replacement: @convention(block) (UINavigationController, NSArray, Bool) -> Void = {
      navigation, controllers, animated in
      MainActor.assumeIsolated { tintBackItems(of: controllers as? [UIViewController] ?? []) }
      original(navigation, selector, controllers, animated)
    }
    class_replaceMethod(stackClass, selector, imp_implementationWithBlock(replacement), method_getTypeEncoding(method))
  }

  private static func tintBackItems(of controllers: [UIViewController]) {
    guard let color else { return }
    for controller in controllers where controller.navigationItem.backBarButtonItem == nil {
      // A nil title keeps the chevron-only button and the screen titles in the long-press menu; "" blanks the menu
      // rows and a real title shows a titled capsule. The tint must be set before assignment to show.
      let item = UIBarButtonItem()
      item.tintColor = color
      controller.navigationItem.backBarButtonItem = item
    }
  }
}
