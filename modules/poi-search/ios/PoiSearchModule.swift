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

    AsyncFunction("searchByName") { (query: String, lat: Double?, lng: Double?, promise: Promise) in
      let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !name.isEmpty else {
        promise.reject("bad_input", "The search needs a name")
        return
      }
      var center: CLLocationCoordinate2D?
      if let lat, let lng {
        let candidate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        if CLLocationCoordinate2DIsValid(candidate) { center = candidate }
      }
      PoiSearcher.search(name: name, near: center) { result in
        switch result {
        case .success(let records): promise.resolve(records.map(\.dictionary))
        case .failure(let error): promise.reject("search_failed", error.localizedDescription)
        }
      }
    }
  }
}
