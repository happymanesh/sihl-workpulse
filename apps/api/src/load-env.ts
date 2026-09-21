import { config } from "dotenv";
import { existsSync } from "fs";
import { dirname, resolve } from "path";

/**
 * Loads the repo-root .env into process.env.
 *
 * This must be imported FIRST in main.ts, before anything that reads
 * configuration. Two things depend on it:
 *
 *  - The Prisma client in @workpulse/db reads DATABASE_URL when it is
 *    constructed, which happens at import time - too early for Nest's
 *    ConfigModule to have run.
 *  - Nest processes start with their own workspace as the working directory
 *    (apps/api), so ConfigModule would look for apps/api/.env and find nothing.
 *
 * The root is found by walking up rather than with a fixed "../../../.env",
 * because the compiled layout is apps/api/dist/src/main.js while the source
 * layout is apps/api/src/main.ts - one level apart, so any hard-coded depth is
 * correct for exactly one of them and silently wrong for the other.
 *
 * `override: false` is the default and is what we want: a real environment
 * variable set by the platform always beats the file, so staging and production
 * are unaffected by a stray .env.
 */
function findRepoEnv(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "package.json")) && existsSync(resolve(dir, ".env"))) {
      return resolve(dir, ".env");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envPath = findRepoEnv(__dirname);
if (envPath) {
  config({ path: envPath });
} else {
  // Not fatal: a real deployment injects environment variables directly and has
  // no .env at all. Only local development depends on the file.
  console.warn("[load-env] no .env found by walking up from " + __dirname);
}
