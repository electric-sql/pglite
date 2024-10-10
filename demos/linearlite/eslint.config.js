import rootConfig from "../../eslint.config.js";
import pluginReact from "@eslint-react/eslint-plugin";
// @ts-expect-error no types
import pluginReactCompiler from "eslint-plugin-react-compiler";
// @ts-expect-error no types
import pluginReactHooks from "eslint-plugin-react-hooks";

export default [
  ...rootConfig,
  {
    files: ["**/*.{ts,tsx}"],
    ...pluginReact.configs.recommended,
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-compiler": pluginReactCompiler,
    },
    rules: {
      "react-compiler/react-compiler": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/test/**"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "react-compiler/react-compiler": "off",
    },
  },
];
