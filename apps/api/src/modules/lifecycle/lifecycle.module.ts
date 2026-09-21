import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { HandoverService } from "./handover.service";

@Module({
  imports: [AuditModule],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class LifecycleModule {}
