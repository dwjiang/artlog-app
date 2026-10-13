const withModAfterEarlierPlugins = require("./after-earlier-mods");

// expo-dev-launcher's Release strip phase runs before Xcode writes Info.plist, so without this its local-network keys,
// whose purpose string names Expo Dev Launcher, ship to the App Store.
module.exports = function withReleaseInfoPlist(config) {
  if (process.env.EAS_BUILD_PROFILE !== "production") return config;
  return withModAfterEarlierPlugins(config, {
    platform: "ios",
    mod: "infoPlist",
    action: (config) => {
      delete config.modResults.NSBonjourServices;
      delete config.modResults.NSLocalNetworkUsageDescription;
      return config;
    },
  });
};
