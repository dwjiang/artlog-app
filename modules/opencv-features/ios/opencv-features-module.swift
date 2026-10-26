import ExpoModulesCore

public final class OpenCVFeaturesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenCVFeatures")

    AsyncFunction("detectOrb") { (path: String, maxKeypoints: Int) -> [String: Any] in
      try OpenCVExtractor.orb(atPath: path, maxKeypoints: maxKeypoints)
    }

    AsyncFunction("measureTriage") { (path: String, size: Int, glareLevel: Int) -> [String: NSNumber] in
      try OpenCVExtractor.triage(atPath: path, size: size, glareLevel: glareLevel)
    }
  }
}
