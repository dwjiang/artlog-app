module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Drizzle's generated migration bundle imports .sql files as strings.
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
