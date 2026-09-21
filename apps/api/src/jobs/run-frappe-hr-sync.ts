/**
 * Manual entrypoint: `npm run sync:frappe-hr` (from apps/api, or via the
 * root-level `npm run sync:frappe-hr` workspace passthrough).
 *
 * Runs one sync pass directly, without booting the full Nest app or
 * touching the BullMQ queue - useful for local dev and for a one-off
 * backfill in a deployed environment.
 */
import { runFrappeHrSync } from "./frappe-hr-sync";

runFrappeHrSync()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length > 0) {
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error("Frappe HR sync failed:", err);
    process.exitCode = 1;
  });
