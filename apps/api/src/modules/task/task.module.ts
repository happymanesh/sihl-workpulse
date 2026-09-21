import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ProjectModule } from "../project/project.module";
import { TaskService } from "./task.service";

@Module({
  imports: [AuditModule, ProjectModule],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
