import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ProjectModule } from "../project/project.module";
import { TaskService } from "./task.service";
import { TaskCommentService } from "./task-comment.service";

@Module({
  imports: [AuditModule, ProjectModule],
  providers: [TaskService, TaskCommentService],
  exports: [TaskService, TaskCommentService],
})
export class TaskModule {}
