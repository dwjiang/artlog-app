import CoreLocation
import ExpoModulesCore
import MapKit
import UIKit

final class LookAroundThrottledException: Exception, @unchecked Sendable {
  override var code: String { "ERR_LOOK_AROUND_THROTTLED" }
  override var reason: String { "Apple Maps is limiting Look Around requests from this device" }
}

final class LookAroundUnreachableException: Exception, @unchecked Sendable {
  override var code: String { "ERR_LOOK_AROUND_UNREACHABLE" }
  override var reason: String { "Apple Maps could not be reached" }
}

final class LookAroundSceneMissingException: Exception, @unchecked Sendable {
  override var code: String { "ERR_LOOK_AROUND_NO_SCENE" }
  override var reason: String { "Look Around has no imagery near this place" }
}

final class LookAroundBadInputException: Exception, @unchecked Sendable {
  override var code: String { "ERR_LOOK_AROUND_BAD_INPUT" }
  override var reason: String { "Look Around needs a valid coordinate and a positive size" }
}

public final class LookAroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LookAround")

    // Apple's terms allow Map Data to be stored only temporarily, so stills last one app session.
    OnCreate {
      try? FileManager.default.removeItem(at: LookAroundStills.directory)
    }

    AsyncFunction("snapshot") { (lat: Double, lng: Double, width: Double, height: Double) async throws -> String? in
      let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
      guard CLLocationCoordinate2DIsValid(coordinate), width > 0, height > 0 else { throw LookAroundBadInputException() }
      guard let scene = try await LookAroundStills.scene(at: coordinate) else { return nil }
      return try await LookAroundStills.still(of: scene, size: CGSize(width: width, height: height)).absoluteString
    }

    AsyncFunction("open") { (lat: Double, lng: Double) async throws in
      let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
      guard CLLocationCoordinate2DIsValid(coordinate) else { throw LookAroundBadInputException() }
      guard let scene = try await LookAroundStills.scene(at: coordinate) else { throw LookAroundSceneMissingException() }
      await MainActor.run {
        let viewer = MKLookAroundViewController(scene: scene)
        viewer.showsRoadLabels = true
        viewer.pointOfInterestFilter = .includingAll
        // MapKit positions its badge from the view's top edge, so keep that edge below the navigation bar.
        viewer.edgesForExtendedLayout = [.bottom]
        // A navigation bar gives the full-screen viewer a Done button; MapKit adds none when it is presented directly.
        let navigation = UINavigationController(rootViewController: viewer)
        viewer.navigationItem.rightBarButtonItem = UIBarButtonItem(
          systemItem: .done,
          primaryAction: UIAction { [weak navigation] _ in navigation?.dismiss(animated: true) }
        )
        navigation.modalPresentationStyle = .fullScreen
        self.appContext?.utilities?.currentViewController()?.present(navigation, animated: true)
      }
    }
  }
}

enum LookAroundStills {
  static let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("look-around", isDirectory: true)

  static func scene(at coordinate: CLLocationCoordinate2D) async throws -> MKLookAroundScene? {
    do {
      return try await MKLookAroundSceneRequest(coordinate: coordinate).scene
    } catch {
      throw mapped(error)
    }
  }

  static func still(of scene: MKLookAroundScene, size: CGSize) async throws -> URL {
    let options = MKLookAroundSnapshotter.Options()
    options.size = size
    let snapshot: MKLookAroundSnapshotter.Snapshot
    do {
      snapshot = try await MKLookAroundSnapshotter(scene: scene, options: options).snapshot
    } catch {
      throw mapped(error)
    }
    guard let data = snapshot.image.jpegData(compressionQuality: 0.85) else { throw LookAroundUnreachableException() }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("\(UUID().uuidString).jpg")
    try data.write(to: file, options: .atomic)
    return file
  }

  /// Throttling and lost connections are expected on a phone; anything else passes through for error reporting.
  private static func mapped(_ error: Error) -> Error {
    let nsError = error as NSError
    if nsError.domain == MKError.errorDomain, nsError.code == Int(MKError.Code.loadingThrottled.rawValue) {
      return LookAroundThrottledException().causedBy(error)
    }
    if nsError.domain == NSURLErrorDomain
      || (nsError.domain == MKError.errorDomain && nsError.code == Int(MKError.Code.serverFailure.rawValue)) {
      return LookAroundUnreachableException().causedBy(error)
    }
    return error
  }
}
