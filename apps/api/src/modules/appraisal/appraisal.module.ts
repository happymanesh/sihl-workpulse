import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AuditModule } from "../audit/audit.module";
import { AppraisalService } from "./appraisal.service";

@Module({
  imports: [AuditModule, AnalyticsModule],
  providers: [AppraisalService],
  exports: [AppraisalService],
})
export class AppraisalModule {}
