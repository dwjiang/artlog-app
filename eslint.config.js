// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', 'convex/_generated/**', 'drizzle/**', 'ios/**', 'android/**', 'coverage/**', 'jobs/**'],
  },
]);
