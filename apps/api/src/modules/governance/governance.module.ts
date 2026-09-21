import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CoverageService } from "./coverage.service";
import { ManualService } from "./manual.service";

@Module({
  imports: [AuditModule],
  providers: [CoverageService, ManualService],
  exports: [CoverageService, ManualService],
})
export class GovernanceModule {}
