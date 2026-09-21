import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AnalyticsService } from "./analytics.service";

/** First and last instant of the calendar month containing `on`, in local time. */
export function monthBounds(on: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(on.getFullYear(), on.getMonth(), 1, 0, 0, 0, 0);
  const periodEnd = new Date(on.getFullYear(), on.getMonth() + 1, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}

/**
 * Recomputes the current month's analytics nightly.
 *
 * Recomputed rather than accumulated, because the inputs are not final: a flag
 * dismissed today restores work to a period that was already computed, and an
 * accumulating counter would never pick that up. Recomputation makes the stored
 * row a cache of a pure function over current facts, which is also what makes
 * a disputed figure reproducible.
 */
@Injectable()
export class AnalyticsJob {
  private readonly logger = new Logger(AnalyticsJob.name);
  private running = false;

  constructor(private readonly analytics: AnalyticsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "analytics-period" })
  async nightly(): Promise<void> {
    if (this.running) {
      this.logger.warn("Previous analytics pass still running; skipping this tick");
      return;
    }
    this.running = true;
    try {
      const { periodStart, periodEnd } = monthBounds(new Date());
      const r = await this.analytics.computeAll(periodStart, periodEnd);
      this.logger.log(`Analytics pass: ${r.computed}/${r.employees} employee(s) computed`);
    } catch (err) {
      this.logger.error(`Analytics pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
