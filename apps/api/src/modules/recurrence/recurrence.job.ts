import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RecurrenceService } from "./recurrence.service";

/**
 * Scheduled generation pass.
 *
 * Runs hourly rather than nightly so an activity approved during the day starts
 * producing work the same day. The pass is idempotent, so running often costs
 * nothing beyond a cheap query when there is nothing due.
 *
 * BullMQ is the platform's job system and owns anything that needs queueing,
 * retries or fan-out. This one is a single short database pass on a timer, so
 * it uses @nestjs/schedule directly - putting it on a queue would add moving
 * parts without adding reliability. SLA evaluation and escalation in Phase 5
 * genuinely need BullMQ; this does not.
 */
@Injectable()
export class RecurrenceJob {
  private readonly logger = new Logger(RecurrenceJob.name);
  private running = false;

  constructor(private readonly recurrence: RecurrenceService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "generate-recurring-tasks" })
  async run(): Promise<void> {
    // A slow pass must not overlap itself; the second run would race the first
    // on lastGeneratedFor.
    if (this.running) {
      this.logger.warn("Previous generation pass still running; skipping this tick");
      return;
    }

    this.running = true;
    try {
      const result = await this.recurrence.generateDue();
      if (result.tasksGenerated > 0 || result.errors.length > 0) {
        this.logger.log(
          `Recurrence pass: ${result.tasksGenerated} generated from ${result.activitiesConsidered} activities, ` +
            `${result.tasksMarkedMissed} missed${result.errors.length ? `, ${result.errors.length} error(s)` : ""}`,
        );
      }
    } catch (err) {
      this.logger.error(`Recurrence pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
