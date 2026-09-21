import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ProjectService } from "./project.service";

@Module({
  imports: [AuditModule],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
