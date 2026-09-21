import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SlaJob } from "./sla.job";
import { SlaService } from "./sla.service";

@Module({
  imports: [AuditModule],
  providers: [SlaService, SlaJob],
  exports: [SlaService],
})
export class SlaModule {}
