import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "fixtures/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // cross-platform-safety skill: the red flags, enforced by the linter
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          // why: not a real ban — refined by the selector below; kept off to avoid noise
          message: "",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='HOME']",
          message: "Use os.homedir() (honoring BATON_HOME), never process.env.HOME.",
        },
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: "shell: true is forbidden — spawn with an args array (execa).",
        },
        {
          selector: "CallExpression[callee.name='exec'] > TemplateLiteral",
          message: "No shell strings — use execa(bin, argsArray).",
        },
      ],
    },
  },
  {
    // no-restricted-properties above would flag every process.env read; disable it and
    // rely on the precise selector instead.
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["**/*.test.ts", "scripts/**/*.mjs", "src/test-utils/**/*.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Node globals for plain .mjs scripts (typescript-eslint handles the .ts files).
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
);
