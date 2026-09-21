import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// ESLint 9 flat config. eslint-config-next 16 ships native flat-config arrays
// on its subpath exports, so they are spread directly - passing them through
// @eslint/eslintrc's FlatCompat throws on the plugin graph's circular refs.
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
