#!/usr/bin/env node
/**
 * Refuses to run a schema-changing Prisma command unless DATABASE_URL points at
 * workPulse's own database.
 *
 * Five projects on this machine share one Postgres server (workpulse, sihl_one,
 * sihl_synapse, khargharcha_maharaja, ...). A DATABASE_URL that names the wrong
 * one is invisible until something destructive runs - and `prisma migrate dev`
 * will happily reshape whatever database it is pointed at, dropping tables it
 * does not recognise.
 *
 * This turns that silent catastrophe into a loud, cheap error. It guards
 * db:migrate, db:migrate:deploy, db:seed and db:push.
 */
const path = require("path");
const fs = require("fs");

const EXPECTED_DB = "workpulse";

// Prisma loads the root .env itself, but this runs first, so load it here too.
const envPath = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const url = process.env.DATABASE_URL;

function fail(lines) {
  console.error("\n  ┌─ REFUSING TO RUN ──────────────────────────────────────────");
  for (const l of lines) console.error(`  │ ${l}`);
  console.error("  └────────────────────────────────────────────────────────────\n");
  process.exit(1);
}

if (!url) {
  fail([
    "DATABASE_URL is not set.",
    "",
    `Expected a connection to the "${EXPECTED_DB}" database.`,
    "See docs/phase-0-setup.md.",
  ]);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(["DATABASE_URL is not a valid URL.", "", "Expected: postgresql://user:pass@host:port/dbname"]);
}

// Strip the leading slash; ignore any ?schema= suffix, which URL already splits off.
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

if (dbName !== EXPECTED_DB) {
  fail([
    `DATABASE_URL points at the database "${dbName}".`,
    `This command only ever runs against "${EXPECTED_DB}".`,
    "",
    "Other databases on this server belong to other projects.",
    "Migrating one of them would drop its tables.",
    "",
    `Fix DATABASE_URL in .env so it ends with /${EXPECTED_DB}, then retry.`,
  ]);
}

console.log(`✓ target database is "${dbName}" (user "${parsed.username}")`);
