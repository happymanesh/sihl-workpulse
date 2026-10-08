/**
 * Generate recurring tasks now, rather than waiting for the hourly cron.
 *
 *   npm run run:recurrence -w apps/api
 *
 * Useful during setup and demonstrations: an activity approved a minute ago
 * produces nothing visible until the job next runs, which makes the desk card
 * look broken when it is merely waiting.
 *
 * Identical to what the scheduled job calls, so this proves the real path.
 */
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "../app.module";
import { RecurrenceService } from "../modules/recurrence/recurrence.service";

async function main() {
  const log = new Logger("run-recurrence");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const result = await app.get(RecurrenceService).generateDue();
    log.error(`generated=${JSON.stringify(result)}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
