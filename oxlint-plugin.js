const path = require("node:path");

const RE_EXPORT = "Re-export: import the symbol from the module that defines it";
const ALIAS = "Alias export: give the declaration one name and export that";
const PREFER_ALIAS = "Parent-relative import: use the @/ path alias";

// tsconfig `paths` except @/assets/*, which Jest's `^@/(.*)$` mapping shadows; convex/ and modules/ have no alias.
const ALIASED_DIRS = [
  ["src", "@"],
  ["shared", "@/shared"],
];
const JEST_MODULE_METHODS = new Set(["mock", "doMock", "unmock", "dontMock", "requireActual", "requireMock"]);

// Flags forwarding another module's binding (`export ... from`, `export { imported }`,
// `export default imported`, `export const x = imported`) and second names for a local one
// (`export const y = x`, `export { x as y }`).
const noReExports = {
  create(context) {
    const check = (node, name, renamed) => {
      const variable = context.sourceCode.getScope(node).set.get(name);
      if (!variable) return;
      if (variable.defs.some((def) => def.type === "ImportBinding")) {
        context.report({ node, message: RE_EXPORT });
      } else if (renamed) {
        context.report({ node, message: ALIAS });
      }
    };
    return {
      ExportAllDeclaration: (node) => context.report({ node, message: RE_EXPORT }),
      ExportNamedDeclaration(node) {
        if (node.source) return context.report({ node, message: RE_EXPORT });
        for (const specifier of node.specifiers) {
          check(specifier, specifier.local.name, specifier.exported.name !== specifier.local.name);
        }
        for (const declarator of node.declaration?.declarations ?? []) {
          if (declarator.init?.type === "Identifier") {
            check(declarator, declarator.init.name, true);
          }
        }
      },
      ExportDefaultDeclaration(node) {
        if (node.declaration.type === "Identifier") {
          check(node, node.declaration.name, false);
        }
      },
    };
  },
};

// Rewrites `../` specifiers that land in an aliased tree, including jest module-path calls.
// `require()` is left alone: asset requires would need @/assets/*, which Jest cannot resolve.
const preferAliasImports = {
  meta: { fixable: "code" },
  create(context) {
    const check = (source) => {
      if (typeof source?.value !== "string" || !source.value.startsWith("../")) return;
      const target = path.relative(__dirname, path.resolve(path.dirname(context.filename), source.value));
      const aliased = ALIASED_DIRS.find(([dir]) => target.startsWith(`${dir}/`));
      if (!aliased) return;
      const [dir, alias] = aliased;
      const specifier = `${alias}/${target.slice(dir.length + 1)}`;
      context.report({
        node: source,
        message: PREFER_ALIAS,
        fix: (fixer) => fixer.replaceText(source, JSON.stringify(specifier)),
      });
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
      CallExpression({ callee, arguments: [first] }) {
        const isJestModuleCall =
          callee.type === "MemberExpression"
          && callee.object.type === "Identifier"
          && callee.object.name === "jest"
          && JEST_MODULE_METHODS.has(callee.property.name);
        if (isJestModuleCall && first?.type === "Literal") check(first);
      },
    };
  },
};

module.exports = {
  meta: { name: "artlog" },
  rules: {
    "no-re-exports": noReExports,
    "prefer-alias-imports": preferAliasImports,
  },
};
