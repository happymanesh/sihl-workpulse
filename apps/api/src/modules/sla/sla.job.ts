import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { SlaService } from "./sla.service";

/**
 * Escalation evaluation.
 *
 * Every 15 minutes: a chain whose first level fires at 4 hours is meaningless
 * if it is only checked nightly. The pass is idempotent - TaskEscalation has a
 * unique constraint on (taskId, level), so a level cannot fire twice.
 */
@Injectable()
export class SlaJob {
  private readonly logger = new Logger(SlaJob.name);
  private running = false;

  constructor(private readonly sla: SlaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: "sla-escalation" })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn("Previous escalation pass still running; skipping this tick");
      return;
    }
    this.running = true;
    try {
      const r = await this.sla.runEscalations();
      if (r.escalationsFired > 0 || r.errors.length > 0) {
        this.logger.log(
          `SLA pass: ${r.escalationsFired} escalation(s) from ${r.tasksAssessed} task(s), ` +
            `${r.breaches} breached${r.errors.length ? `, ${r.errors.length} error(s)` : ""}`,
        );
      }
    } catch (err) {
      this.logger.error(`SLA pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
