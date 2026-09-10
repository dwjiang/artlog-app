import ExpoModulesCore

enum ModelBundle {
  /// The pod is a static framework, so CocoaPods copies the model into the app bundle; keep the
  /// `Bundle(for:)` lookup first in case the linkage changes (decision 006).
  private static func url(_ name: String, _ ext: String) -> URL? {
    Bundle(for: CoremlEmbedModule.self).url(forResource: name, withExtension: ext)
      ?? Bundle.main.url(forResource: name, withExtension: ext)
  }

  static func embedder() throws -> Embedder {
    guard let manifestURL = url("model-manifest", "json") else {
      throw EmbedError.modelMissing("model-manifest.json is not bundled; run `npm run model:fetch` and rebuild")
    }
    let manifest = try ModelManifest.load(from: manifestURL)
    guard let modelURL = url(manifest.modelName, "mlmodelc") else {
      throw EmbedError.modelMissing("\(manifest.modelName).mlmodelc is not bundled; run `npm run model:fetch` and rebuild")
    }
    return Embedder(modelURL: modelURL, manifest: manifest)
  }
}

public final class CoremlEmbedModule: Module {
  private let embedder = Result { try ModelBundle.embedder() }
  // Model loading and prediction must not occupy Expo's shared async queue (including SecureStore).
  private let inferenceQueue = DispatchQueue(label: "app.artlog.coreml-embed", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("CoremlEmbed")

    Constants {
      let manifest = try? self.embedder.get().manifest
      return [
        "modelVersion": manifest?.modelVersion,
        "inputSize": manifest?.inputSize,
        "embeddingDim": manifest?.embeddingDim,
        "weightsSha256": manifest?.weightsSha256,
      ]
    }

    AsyncFunction("warmUp") { () -> [String: Any] in
      let result = try self.run { try $0.warmUp() }
      return ["loadMs": result.loadMs, "predictMs": result.predictMs, "alreadyLoaded": result.alreadyLoaded]
    }.runOnQueue(inferenceQueue)

    AsyncFunction("embed") { (path: String) -> [Float] in
      try self.run { try $0.embed(fileURL: URL(fileURLWithPath: path)) }
    }.runOnQueue(inferenceQueue)
  }

  private func run<T>(_ body: (Embedder) throws -> T) throws -> T {
    do {
      return try body(try embedder.get())
    } catch let error as EmbedError {
      throw Exception(name: "CoremlEmbedError", description: error.description, code: error.code)
    }
  }
}
