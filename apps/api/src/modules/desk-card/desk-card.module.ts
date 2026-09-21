import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DeskCardActivityService } from "./desk-card-activity.service";
import { DeskCardService } from "./desk-card.service";

@Module({
  imports: [AuditModule],
  providers: [DeskCardService, DeskCardActivityService],
  exports: [DeskCardService, DeskCardActivityService],
})
export class DeskCardModule {}
