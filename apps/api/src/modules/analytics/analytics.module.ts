import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SlaModule } from "../sla/sla.module";
import { AnalyticsJob } from "./analytics.job";
import { AnalyticsService } from "./analytics.service";
import { AntiGamingJob } from "./antigaming.job";
import { FlagService } from "./flag.service";
import { MisService } from "./mis.service";
import { ShadowScoreService } from "./shadow-score.service";

@Module({
  imports: [AuditModule, SlaModule],
  providers: [MisService, AnalyticsService, FlagService, ShadowScoreService, AnalyticsJob, AntiGamingJob],
  exports: [MisService, AnalyticsService, FlagService, ShadowScoreService, AntiGamingJob],
})
export class AnalyticsModule {}
