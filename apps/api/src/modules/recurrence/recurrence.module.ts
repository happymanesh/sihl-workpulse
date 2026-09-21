import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RecurrenceJob } from "./recurrence.job";
import { RecurrenceService } from "./recurrence.service";

@Module({
  imports: [AuditModule],
  providers: [RecurrenceService, RecurrenceJob],
  exports: [RecurrenceService],
})
export class RecurrenceModule {}
