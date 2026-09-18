// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const RE_EXPORT = 'Re-export: import the symbol from the module that defines it';
const ALIAS = 'Alias export: give the declaration one name and export that';

// Flags forwarding another module's binding (`export ... from`, `export { imported }`,
// `export default imported`, `export const x = imported`) and second names for a local one
// (`export const y = x`, `export { x as y }`).
const noReExports = {
  create(context) {
    const check = (node, name, renamed) => {
      const variable = context.sourceCode.getScope(node).set.get(name);
      if (!variable) return;
      if (variable.defs.some((def) => def.type === 'ImportBinding')) context.report({ node, message: RE_EXPORT });
      else if (renamed) context.report({ node, message: ALIAS });
    };
    return {
      ExportAllDeclaration: (node) => context.report({ node, message: RE_EXPORT }),
      ExportNamedDeclaration(node) {
        if (node.source) return context.report({ node, message: RE_EXPORT });
        for (const specifier of node.specifiers) {
          check(specifier, specifier.local.name, specifier.exported.name !== specifier.local.name);
        }
        for (const declarator of node.declaration?.declarations ?? []) {
          if (declarator.init?.type === 'Identifier') check(declarator, declarator.init.name, true);
        }
      },
      ExportDefaultDeclaration(node) {
        if (node.declaration.type === 'Identifier') check(node, node.declaration.name, false);
      },
    };
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      '.agents/**',
      '.context/**',
      'dist/**',
      'convex/_generated/**',
      'src/db/migrations/**',
      'ios/**',
      'android/**',
      'coverage/**',
      'scripts/data/**',
    ],
  },
  {
    // Jest manual mocks mirror the mocked package's surface, so forwarding is their job.
    ignores: ['__mocks__/**'],
    plugins: { artlog: { rules: { 'no-re-exports': noReExports } } },
    rules: { 'artlog/no-re-exports': 'error' },
  },
  {
    // Convex functions read real server env vars; Metro's static inlining does not apply.
    files: ['convex/**'],
    rules: { 'expo/no-dynamic-env-var': 'off' },
  },
]);
