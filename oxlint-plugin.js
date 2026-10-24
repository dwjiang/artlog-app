const path = require("node:path");

const RE_EXPORT = "Re-export: import the symbol from the module that defines it";
const ALIAS = "Alias export: give the declaration one name and export that";
const PREFER_ALIAS = "Parent-relative import: use the @/ path alias";
const SAFE_AREA_SCROLL =
  "Safe-area list: use SafeAreaScrollView, SafeAreaFlatList or SafeAreaSectionList from @/components/safe-area-scroll";
const SCROLL_COMPONENTS = new Set(["ScrollView", "FlatList", "SectionList"]);

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

// UIKit adjusts only the scrolling axis for the safe area, so a vertical React Native list that adjusts leaves rows
// under a side bar (the iPhone Duo's rail); the safe-area wrappers pad across the axis.
const safeAreaScroll = {
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !SCROLL_COMPONENTS.has(node.name.name)) return;
        const attribute = (name) =>
          node.attributes.find((item) => item.type === "JSXAttribute" && item.name.name === name);
        const behavior = attribute("contentInsetAdjustmentBehavior");
        if (!behavior || behavior.value?.value === "never" || attribute("horizontal")) return;
        let scope = context.sourceCode.getScope(node);
        while (scope && !scope.set.has(node.name.name)) scope = scope.upper;
        const fromReactNative = scope?.set
          .get(node.name.name)
          .defs.some((def) => def.type === "ImportBinding" && def.parent.source.value === "react-native");
        if (fromReactNative) context.report({ node, message: SAFE_AREA_SCROLL });
      },
    };
  },
};

module.exports = {
  meta: { name: "artlog" },
  rules: {
    "no-re-exports": noReExports,
    "prefer-alias-imports": preferAliasImports,
    "safe-area-scroll": safeAreaScroll,
  },
};
