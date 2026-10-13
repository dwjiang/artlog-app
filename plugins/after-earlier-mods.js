const { withBaseMod } = require("expo/config-plugins");

// `withMod` actions run before the mods of plugins listed earlier; this runs after them, so it sees their results.
module.exports = function withModAfterEarlierPlugins(config, { platform, mod, action }) {
  return withBaseMod(config, {
    platform,
    mod,
    isProvider: false,
    async action({ modRequest: { nextMod, ...modRequest }, ...config }) {
      return action(await nextMod({ ...config, modRequest }));
    },
  });
};
