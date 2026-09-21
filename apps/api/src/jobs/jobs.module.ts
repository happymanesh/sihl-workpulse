import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { FRAPPE_HR_SYNC_QUEUE, FrappeHrSyncProcessor, FrappeHrSyncScheduler } from "./frappe-hr-sync.job";

@Module({
  imports: [BullModule.registerQueue({ name: FRAPPE_HR_SYNC_QUEUE })],
  providers: [FrappeHrSyncScheduler, FrappeHrSyncProcessor],
})
export class JobsModule {}
