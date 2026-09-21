import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { WorkflowService } from "./workflow.service";

@Module({
  imports: [AuditModule],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
