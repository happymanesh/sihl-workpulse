// Jest does not read .env, so DATABASE_URL and friends are absent unless we
// load them here. Without this every test that touches Prisma fails with
// "Environment variable not found: DATABASE_URL" rather than a real assertion.
//
// The repo root .env is the single source for local config - apps/api has no
// .env of its own, and adding one would create two places to keep in step.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
