module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Drizzle's generated drizzle/migrations.js imports the .sql files as strings.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
