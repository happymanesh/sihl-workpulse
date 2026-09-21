import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { BullModule } from "@nestjs/bullmq";
import { HealthModule } from "./modules/health/health.module";
import { EmployeeModule } from "./modules/employee/employee.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JobsModule } from "./jobs/jobs.module";
import { TrpcModule } from "./trpc/trpc.module";
import { DeskCardModule } from "./modules/desk-card/desk-card.module";
import { TaskModule } from "./modules/task/task.module";
import { RecurrenceModule } from "./modules/recurrence/recurrence.module";
import { CapacityModule } from "./modules/capacity/capacity.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";
import { GovernanceModule } from "./modules/governance/governance.module";
import { ProjectModule } from "./modules/project/project.module";
import { SlaModule } from "./modules/sla/sla.module";
import { IntakeModule } from "./modules/intake/intake.module";
import { LifecycleModule } from "./modules/lifecycle/lifecycle.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { CommandCentreModule } from "./modules/command-centre/command-centre.module";
import { PredictionModule } from "./modules/prediction/prediction.module";
import { AppraisalModule } from "./modules/appraisal/appraisal.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // powers the Frappe HR sync cron in Phase 0;
    // SLA/escalation/recurrence jobs plug into this same mechanism in Phase 1+
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    }),
    AuditModule, // imported early: other modules inject AuditService to log changes
    AuthModule,
    HealthModule,
    EmployeeModule,
    JobsModule,
    DeskCardModule,
    TaskModule,
    RecurrenceModule,
    CapacityModule,
    WorkflowModule,
    GovernanceModule,
    ProjectModule,
    SlaModule,
    IntakeModule,
    LifecycleModule,
    AnalyticsModule,
    CommandCentreModule,
    PredictionModule,
    AppraisalModule,
    TrpcModule,
  ],
})
export class AppModule {}
