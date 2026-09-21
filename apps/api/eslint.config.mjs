import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.mjs", "jest.config.js", "jest.setup.js"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // CLAUDE.md: no `any` without a comment explaining why. The two auth
      // guards that augment the Express request are the accepted exceptions
      // and carry inline eslint-disable comments naming the reason.
      "@typescript-eslint/no-explicit-any": "error",
      // A leading underscore marks a parameter that is deliberately unused -
      // signature placeholders on the auth and tRPC context stubs, which must
      // keep their shape so the real implementation drops straight in.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
);
