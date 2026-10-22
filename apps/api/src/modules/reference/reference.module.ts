import { Module } from "@nestjs/common";
import { ReferenceService } from "./reference.service";
import { TaskTypeService } from "./task-type.service";
import { OrgMasterService } from "./org-master.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [ReferenceService, TaskTypeService, OrgMasterService],
  exports: [ReferenceService, TaskTypeService, OrgMasterService],
})
export class ReferenceModule {}
