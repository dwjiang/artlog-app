import CoreLocation
import ExpoModulesCore

public final class PoiSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PoiSearch")

    AsyncFunction("searchNearby") { (lat: Double, lng: Double, radiusMeters: Double, promise: Promise) in
      let center = CLLocationCoordinate2D(latitude: lat, longitude: lng)
      guard CLLocationCoordinate2DIsValid(center), radiusMeters.isFinite, radiusMeters > 0 else {
        promise.reject("bad_input", "The search needs a valid coordinate and a positive radius")
        return
      }
      PoiSearcher.search(center: center, radius: radiusMeters) { result in
        switch result {
        case .success(let records): promise.resolve(records.map(\.dictionary))
        case .failure(let error): promise.reject("search_failed", error.localizedDescription)
        }
      }
    }
  }
}
