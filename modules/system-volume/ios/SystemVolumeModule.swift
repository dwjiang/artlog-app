import ExpoModulesCore

public final class SystemVolumeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SystemVolume")

    View(SystemVolumeView.self) {
      Prop("minimumTrackColor") { (view: SystemVolumeView, color: UIColor) in
        view.minimumTrackColor = color
      }
      Prop("maximumTrackColor") { (view: SystemVolumeView, color: UIColor) in
        view.maximumTrackColor = color
      }
    }
  }
}
