import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PredictionService } from "./prediction.service";

/**
 * SLA-breach risk sweep.
 *
 * Hourly. A risk estimate that is a day old is not a prediction, it is a
 * history lesson - by the time a supervisor reads it the window it was
 * assessing has usually closed.
 *
 * Outcomes are backfilled in the same pass. Recording what actually happened is
 * not an optional extra here: without it the model's accuracy is unknowable and
 * nobody can say honestly whether it is worth keeping.
 */
@Injectable()
export class PredictionJob {
  private readonly logger = new Logger(PredictionJob.name);
  private running = false;

  constructor(private readonly prediction: PredictionService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "sla-risk-sweep" })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn("Previous risk sweep still running; skipping this tick");
      return;
    }
    this.running = true;
    try {
      const outcomes = await this.prediction.recordOutcomes();
      const sweep = await this.prediction.runSweep();
      if (sweep.recorded > 0 || outcomes.updated > 0) {
        this.logger.log(
          `SLA risk: ${sweep.recorded} assessed of ${sweep.open} open, ${outcomes.updated} outcome(s) recorded` +
            (sweep.errors.length ? `, ${sweep.errors.length} error(s)` : ""),
        );
      }
    } catch (err) {
      this.logger.error(`SLA risk sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
