const { withXcodeProject } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// Expo builds the extension and JS renderer; this provider keeps the local rotation running while the app is closed.
module.exports = function withArtlogWidget(config) {
  // Source-generating dangerous mods run first; patch the generated target only after those finish.
  return withXcodeProject(config, (mod) => {
    const target = path.join(mod.modRequest.platformProjectRoot, "ExpoWidgetsTarget");
    fs.copyFileSync(require.resolve("./widgets/artlog-widget.swift"), path.join(target, "ArtlogWidget.swift"));
    fs.writeFileSync(
      path.join(target, "index.swift"),
      "import SwiftUI\nimport WidgetKit\n\n@main\nstruct ArtlogWidgetBundle: WidgetBundle {\n  var body: some Widget { ArtlogWidget() }\n}\n",
    );
    return mod;
  });
};
