import { Module } from "@nestjs/common";
import { AuthModule } from "../modules/auth/auth.module";
import { SlaModule } from "../modules/sla/sla.module";
import { LifecycleModule } from "../modules/lifecycle/lifecycle.module";
import { AnalyticsModule } from "../modules/analytics/analytics.module";
import { CommandCentreModule } from "../modules/command-centre/command-centre.module";
import { PredictionModule } from "../modules/prediction/prediction.module";
import { AppraisalModule } from "../modules/appraisal/appraisal.module";
import { ProjectModule } from "../modules/project/project.module";
import { GovernanceModule } from "../modules/governance/governance.module";
import { WorkflowModule } from "../modules/workflow/workflow.module";
import { CapacityModule } from "../modules/capacity/capacity.module";
import { DeskCardModule } from "../modules/desk-card/desk-card.module";
import { EmployeeModule } from "../modules/employee/employee.module";
import { ReferenceModule } from "../modules/reference/reference.module";
import { TaskModule } from "../modules/task/task.module";
import { AttachmentModule } from "../modules/attachment/attachment.module";
import { TrpcService } from "./trpc.service";

@Module({
  imports: [AuthModule, EmployeeModule, DeskCardModule, TaskModule, ReferenceModule, CapacityModule, WorkflowModule, GovernanceModule, ProjectModule, SlaModule, LifecycleModule, AnalyticsModule, CommandCentreModule, PredictionModule, AppraisalModule, AttachmentModule],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}
