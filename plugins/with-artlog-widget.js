const { IOSConfig } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const withModAfterEarlierPlugins = require("./after-earlier-mods");

const TARGET = "ExpoWidgetsTarget";
// expo-widgets keeps widget data in the app group's UserDefaults, which the extension reads.
const PRIVACY_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>1C8F.1</string>
      </array>
    </dict>
  </array>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyTracking</key>
  <false/>
</dict>
</plist>
`;

// Expo builds the extension and JS renderer; this provider keeps the local rotation running while the app is closed.
// The bundle keeps expo-widgets' Live Activity widget, which renders the visit activity's JS layout.
module.exports = function withArtlogWidget(config) {
  // expo-widgets generates the extension's sources in a dangerous mod and adds its target in an Xcode project mod.
  return withModAfterEarlierPlugins(config, {
    platform: "ios",
    mod: "xcodeproj",
    action: (mod) => {
      const target = path.join(mod.modRequest.platformProjectRoot, TARGET);
      fs.copyFileSync(require.resolve("./widgets/artlog-widget.swift"), path.join(target, "ArtlogWidget.swift"));
      fs.writeFileSync(
        path.join(target, "index.swift"),
        [
          "import SwiftUI",
          "import WidgetKit",
          "internal import ExpoWidgets",
          "",
          "@main",
          "struct ArtlogWidgetBundle: WidgetBundle {",
          "  init() {",
          "    registerArtlogFont()",
          "  }",
          "",
          "  var body: some Widget {",
          "    ArtlogWidget()",
          "    WidgetLiveActivity()",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      fs.writeFileSync(path.join(target, "PrivacyInfo.xcprivacy"), PRIVACY_MANIFEST);
      const project = mod.modResults;
      const targetUuid = project.findTargetKey(TARGET);
      // Without its own Resources phase, node-xcode would add the manifest to the app's.
      if (!project.pbxNativeTargetSection()[targetUuid].buildPhases.some(({ comment }) => comment === "Resources")) {
        project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", targetUuid);
      }
      mod.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: "PrivacyInfo.xcprivacy",
        groupName: TARGET,
        project,
        isBuildFile: true,
        targetUuid,
      });
      return mod;
    },
  });
};
