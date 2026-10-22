import { Module } from "@nestjs/common";
import { ReferenceService } from "./reference.service";
import { TaskTypeService } from "./task-type.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [ReferenceService, TaskTypeService],
  exports: [ReferenceService, TaskTypeService],
})
export class ReferenceModule {}
