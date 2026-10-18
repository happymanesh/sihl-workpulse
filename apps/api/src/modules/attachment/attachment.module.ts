import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AttachmentController } from "./attachment.controller";
import { AttachmentService } from "./attachment.service";
import { AttachmentStorage } from "./attachment.storage";

@Module({
  imports: [AuditModule],
  controllers: [AttachmentController],
  providers: [AttachmentService, AttachmentStorage],
  exports: [AttachmentService],
})
export class AttachmentModule {}
