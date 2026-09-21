import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CommandCentreService } from "./command-centre.service";

/**
 * Refreshes the Command Centre feed.
 *
 * Every 30 minutes, matching the SLA escalation pass: an executive feed that
 * lagged the escalation people actually received would be answering a different
 * question from the one being asked in the room.
 *
 * The pass is idempotent by dedupe key, so a tick that finds nothing changed
 * writes nothing.
 */
@Injectable()
export class CommandCentreJob {
  private readonly logger = new Logger(CommandCentreJob.name);
  private running = false;

  constructor(private readonly commandCentre: CommandCentreService) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: "command-centre-refresh" })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn("Previous Command Centre pass still running; skipping this tick");
      return;
    }
    this.running = true;
    try {
      const r = await this.commandCentre.refresh();
      if (r.raised > 0 || r.resolved > 0) {
        this.logger.log(`Command Centre: ${r.raised} raised, ${r.resolved} resolved`);
      }
    } catch (err) {
      this.logger.error(`Command Centre pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
