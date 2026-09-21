module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.spec.json" }],
  },
  // superjson and jose are ESM-only. The app itself is fine - Node 24 loads
  // them through require(esm) - but Jest's CommonJS runtime cannot, so they are
  // excluded from the node_modules transform-ignore and transpiled by ts-jest.
  transformIgnorePatterns: ['node_modules/(?!(superjson|copy-anything|is-what|jose)/)'],
  // Loads the repo-root .env before any test module is imported.
  setupFiles: ["<rootDir>/../jest.setup.js"],
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
};
