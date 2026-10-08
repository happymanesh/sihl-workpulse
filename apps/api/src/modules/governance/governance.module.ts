import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CoverageService } from "./coverage.service";
import { ManualService } from "./manual.service";
import { ProcessService } from "./process.service";

@Module({
  imports: [AuditModule],
  providers: [CoverageService, ManualService, ProcessService],
  exports: [CoverageService, ManualService, ProcessService],
})
export class GovernanceModule {}
