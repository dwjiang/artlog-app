import ExpoModulesCore
import React
import UIKit

public final class SignInDiagnosticsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SignInDiagnostics")

    AsyncFunction("snapshot") { () -> [String: Any] in
      MainActor.assumeIsolated {
        // Match Google Sign-In's presenter lookup without loading or changing any view.
        let presenter = RCTPresentedViewController()
        let state: String
        switch UIApplication.shared.applicationState {
        case .active: state = "active"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: state = "unknown"
        }
        return [
          "applicationState": state,
          "guidedAccess": UIAccessibility.isGuidedAccessEnabled,
          "hasPresenter": presenter != nil,
          // Expo AppleAuthentication uses this same lookup for its presentation anchor.
          "hasApplePresentationWindow": Utilities.keyWindow() != nil,
          "presenterHasWindow": presenter?.viewIfLoaded?.window != nil,
          "presenterBeingPresented": presenter?.isBeingPresented ?? false,
          "presenterBeingDismissed": presenter?.isBeingDismissed ?? false,
          "presenterHasTransition": presenter?.transitionCoordinator != nil,
        ]
      }
    }.runOnQueue(.main)
  }
}
