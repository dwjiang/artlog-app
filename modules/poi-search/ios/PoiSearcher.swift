import CoreLocation
import Foundation
import MapKit

struct PoiRecord {
  let name: String
  let lat: Double
  let lng: Double
  let city: String?
  let country: String?
  let website: String?
  let category: String
  let distanceMeters: Double?

  var dictionary: [String: Any] {
    var value: [String: Any] = ["name": name, "lat": lat, "lng": lng, "category": category]
    if let distanceMeters { value["distanceMeters"] = distanceMeters }
    if let city { value["city"] = city }
    if let country { value["country"] = country }
    if let website { value["website"] = website }
    return value
  }
}

/// Museum-category and "art gallery" text searches run together: SFMOMA was missing
/// from the museum filter (classified as a landmark), so neither request alone is complete.
enum PoiSearcher {
  static let maxResults = 8
  /// Two hits closer than this with the same normalized name are one place listed twice.
  static let duplicateDistanceMeters = 50.0
  /// A typed name is searched around the last fix at this radius; MapKit treats the region as a hint, not a bound.
  static let nameSearchRadiusMeters = 50_000.0

  static func search(center: CLLocationCoordinate2D, radius: Double, completion: @escaping (Result<[PoiRecord], Error>) -> Void) {
    let museums = MKLocalPointsOfInterestRequest(center: center, radius: radius)
    museums.pointOfInterestFilter = MKPointOfInterestFilter(including: [.museum])

    let galleries = MKLocalSearch.Request()
    galleries.naturalLanguageQuery = "art gallery"
    galleries.region = MKCoordinateRegion(center: center, latitudinalMeters: radius * 2, longitudinalMeters: radius * 2)
    galleries.resultTypes = .pointOfInterest

    let group = DispatchGroup()
    var items: [MKMapItem] = []
    var failure: Error?
    let lock = NSLock()

    func run(_ search: MKLocalSearch) {
      group.enter()
      search.start { response, error in
        lock.lock()
        if let response {
          items.append(contentsOf: response.mapItems)
        } else if let error, !isNoResults(error) {
          failure = failure ?? error
        }
        lock.unlock()
        group.leave()
      }
    }
    run(MKLocalSearch(request: museums))
    run(MKLocalSearch(request: galleries))

    group.notify(queue: .global(qos: .userInitiated)) {
      let records = merge(items, center: center, radius: radius)
      if records.isEmpty, let failure {
        completion(.failure(failure))
      } else {
        completion(.success(records))
      }
    }
  }

  /// A name typed into the visit form: any place kind, so a gallery MapKit files under "store" or a university museum still appears.
  static func search(name: String, near center: CLLocationCoordinate2D?, completion: @escaping (Result<[PoiRecord], Error>) -> Void) {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = name
    request.resultTypes = .pointOfInterest
    if let center {
      request.region = MKCoordinateRegion(center: center, latitudinalMeters: nameSearchRadiusMeters * 2, longitudinalMeters: nameSearchRadiusMeters * 2)
    }
    MKLocalSearch(request: request).start { response, error in
      if let response {
        completion(.success(merge(response.mapItems, center: center, radius: nil)))
      } else if let error, !isNoResults(error) {
        completion(.failure(error))
      } else {
        completion(.success([]))
      }
    }
  }

  private static func isNoResults(_ error: Error) -> Bool {
    let nsError = error as NSError
    return nsError.domain == MKErrorDomain && nsError.code == MKError.placemarkNotFound.rawValue
  }

  /// Without a center the results keep MapKit's order and carry no distance; a radius drops anything farther.
  static func merge(_ items: [MKMapItem], center: CLLocationCoordinate2D?, radius: Double?) -> [PoiRecord] {
    let origin = center.map { CLLocation(latitude: $0.latitude, longitude: $0.longitude) }
    var candidates = items.compactMap { item -> PoiRecord? in
      guard let name = item.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
      let coordinate = coordinate(of: item)
      guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
      let distance = origin?.distance(from: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
      if let radius, let distance, distance > radius { return nil }
      return PoiRecord(
        name: name, lat: coordinate.latitude, lng: coordinate.longitude,
        city: item.placemark.locality, country: item.placemark.isoCountryCode, website: item.url?.absoluteString,
        category: category(of: item), distanceMeters: distance
      )
    }
    if origin != nil { candidates.sort { ($0.distanceMeters ?? .infinity) < ($1.distanceMeters ?? .infinity) } }

    var merged: [PoiRecord] = []
    for candidate in candidates {
      let duplicate = merged.contains { existing in
        normalize(existing.name) == normalize(candidate.name) &&
          CLLocation(latitude: existing.lat, longitude: existing.lng)
            .distance(from: CLLocation(latitude: candidate.lat, longitude: candidate.lng)) <= duplicateDistanceMeters
      }
      if !duplicate { merged.append(candidate) }
      if merged.count == maxResults { break }
    }
    return merged
  }

  private static func coordinate(of item: MKMapItem) -> CLLocationCoordinate2D {
    if #available(iOS 26.0, *) {
      return item.location.coordinate
    }
    return item.placemark.coordinate
  }

  /// MapKit's raw category without its `MKPOICategory` prefix, e.g. `museum`, `landmark`; `unknown` when unset.
  private static func category(of item: MKMapItem) -> String {
    guard let raw = item.pointOfInterestCategory?.rawValue else { return "unknown" }
    let prefix = "MKPOICategory"
    let trimmed = raw.hasPrefix(prefix) ? String(raw.dropFirst(prefix.count)) : raw
    return trimmed.lowercased()
  }

  private static func normalize(_ name: String) -> String {
    name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
      .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
  }
}
