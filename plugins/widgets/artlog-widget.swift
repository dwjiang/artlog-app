import CoreText
import Foundation
import SwiftUI
import WidgetKit
internal import ExpoWidgets

private let widgetKind = "ArtlogWidget"

private var sharedDirectory: URL? {
  guard let group = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String else { return nil }
  return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
    .appendingPathComponent("ExpoWidgets/artlog", isDirectory: true)
}

private struct ArtlogEntry: TimelineEntry {
  let date: Date
  let props: [String: Any]?
}

private struct ArtlogProvider: TimelineProvider {
  func placeholder(in context: Context) -> ArtlogEntry { ArtlogEntry(date: Date(), props: nil) }

  private func collection() -> (entries: [[String: Any]], interval: TimeInterval) {
    guard let file = sharedDirectory?.appendingPathComponent("collection.json"),
          let data = try? Data(contentsOf: file),
          let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let entries = manifest["entries"] as? [[String: Any]] else { return ([], 21600) }
    return (entries, max(3600, manifest["interval"] as? TimeInterval ?? 21600))
  }

  private func entry(at date: Date, entries: [[String: Any]], interval: TimeInterval) -> ArtlogEntry {
    guard !entries.isEmpty else { return ArtlogEntry(date: date, props: nil) }
    let index = Int(floor(date.timeIntervalSince1970 / interval)) % entries.count
    return ArtlogEntry(date: date, props: entries[index])
  }

  func getSnapshot(in context: Context, completion: @escaping (ArtlogEntry) -> Void) {
    let data = collection()
    completion(entry(at: Date(), entries: data.entries, interval: data.interval))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ArtlogEntry>) -> Void) {
    let data = collection(), now = Date()
    let current = entry(at: now, entries: data.entries, interval: data.interval)
    guard data.entries.count > 1 else { completion(Timeline(entries: [current], policy: .never)); return }
    let next = (floor(now.timeIntervalSince1970 / data.interval) + 1) * data.interval
    let upcoming = (0..<4).map { step in
      entry(at: Date(timeIntervalSince1970: next + Double(step) * data.interval), entries: data.entries, interval: data.interval)
    }
    completion(Timeline(entries: [current] + upcoming, policy: .after(Date(timeIntervalSince1970: next + 4 * data.interval))))
  }
}

private struct ArtlogEntryView: View {
  @Environment(\.self) private var environment
  let entry: ArtlogEntry

  init(entry: ArtlogEntry) {
    self.entry = entry
    if let font = sharedDirectory?.appendingPathComponent("space-grotesk-semibold.ttf") {
      CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil)
    }
  }

  private var background: Color {
    let value = entry.props?["background"] as? String ?? "#FFFFFF"
    let rgb = UInt64(value.dropFirst(), radix: 16) ?? 0xFFFFFF
    return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
  }

  var body: some View {
    if let props = entry.props,
       let layout = WidgetsStorage.getString(forKey: "__expo_widgets_\(widgetKind)_layout") {
      GeometryReader { geometry in
        let values = getWidgetEnvironment(environment: environment).merging([
          "timestamp": Int(entry.date.timeIntervalSince1970 * 1000),
          "width": geometry.size.width, "height": geometry.size.height
        ]) { _, new in new }
        let node = evaluateLayout(layout: layout, props: props, environment: values)
        WidgetsDynamicView(name: widgetKind, kind: .widget, node: node)
      }
      .containerBackground(background, for: .widget)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(entry.props?["label"] as? String ?? "Saved painting")
    } else {
      VStack(alignment: .leading, spacing: 8) {
        Text("Your art here").font(.headline)
        Text("Open Artlog to choose saved paintings.").font(.caption)
      }
      .foregroundStyle(Color(red: 27/255, green: 37/255, blue: 49/255))
      .padding(20)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .containerBackground(Color.white, for: .widget)
      .widgetURL(URL(string: "artlog://widgets"))
    }
  }
}

struct ArtlogWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: widgetKind, provider: ArtlogProvider()) { ArtlogEntryView(entry: $0) }
      .configurationDisplayName("Saved paintings")
      .description("Bring your collection and past museum visits to your Home Screen.")
      .supportedFamilies([.systemSmall, .systemMedium])
      .contentMarginsDisabled()
  }
}
