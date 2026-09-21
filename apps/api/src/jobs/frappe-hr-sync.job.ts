import { Injectable, Logger } from "@nestjs/common";
import { Processor, WorkerHost, InjectQueue } from "@nestjs/bullmq";
import { Cron } from "@nestjs/schedule";
import { Queue, Job } from "bullmq";
import { runFrappeHrSync } from "./frappe-hr-sync";

export const FRAPPE_HR_SYNC_QUEUE = "frappe-hr-sync";

/**
 * Scheduled trigger: enqueues a sync job on the cron defined by
 * FRAPPE_SYNC_CRON (.env.example default: every 2 hours). Runs through
 * BullMQ rather than @Cron directly calling runFrappeHrSync() so sync runs
 * get retry/backoff, are visible in a queue dashboard later, and don't
 * block the Nest event loop for the duration of a large sync.
 */
@Injectable()
export class FrappeHrSyncScheduler {
  private readonly logger = new Logger(FrappeHrSyncScheduler.name);

  constructor(@InjectQueue(FRAPPE_HR_SYNC_QUEUE) private readonly queue: Queue) {}

  @Cron(process.env.FRAPPE_SYNC_CRON ?? "0 */2 * * *")
  async triggerScheduledSync() {
    this.logger.log("Enqueuing scheduled Frappe HR sync");
    await this.queue.add("sync", {}, { removeOnComplete: 20, removeOnFail: 50 });
  }
}

@Processor(FRAPPE_HR_SYNC_QUEUE)
export class FrappeHrSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(FrappeHrSyncProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.log(`Running Frappe HR sync (job ${job.id})`);
    const result = await runFrappeHrSync();
    this.logger.log(
      `Frappe HR sync complete: ${result.employeesSynced} employees, ${result.departmentsSynced} departments, ` +
        `${result.errors.length} error(s), mode=${result.mode}`,
    );
    if (result.errors.length > 0) {
      this.logger.warn(`Sync errors: ${result.errors.join("; ")}`);
    }
  }
}
